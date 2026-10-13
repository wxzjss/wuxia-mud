#!/usr/bin/env node
/* ==========================================================================
 * tools/dangling-ref-check.js —— 悬空引用守卫（闸二）
 * --------------------------------------------------------------------------
 * 它守的病：**引用了一个不存在的 id，而游戏不报错。**
 *
 *   房间出口指向一个不存在的房间 ⇒ 玩家走到那儿是**死路**，不报任何错；
 *   NPC 的 `room` 写错 ⇒ 这个 NPC **永远不出现**，不报任何错；
 *   任务目标指向不存在的物品 ⇒ 任务**接了做不了**，不报任何错。
 *
 *   这就是「不报错就是不生效」在**内容侧**的版本，与加载层那个病同族。
 *   下一步是房间重写 200 间 + 补 300 间密度 —— 改房间最容易顺手把出口改坏，
 *   所以这道检查必须**在内容大改开工之前**就位。
 *
 * 判据三条纪律：
 *   ① **只报确定悬空的**。拿不准的（动态 id、模板串、别的命名空间）进
 *      「无法判定」单列，**不许当通过** —— 与 N3 那 834 条同一个规矩。
 *   ② id 宇宙 = **真引擎 boot 后的合并结果**（基础数据 + 已启用 Mod），
 *      不是只看 `game/data/`。否则 Mod 补出来的房间会被误判成悬空。
 *   ③ 存量用**基线**记账（`dangling-ref-baseline.json`）：
 *      · 出现基线里没有的悬空 ⇒ **红**（新增的，不许带进来）
 *      · 基线里某条被修好了 ⇒ **红**（提醒把基线删干净，防基线烂掉）
 *      基线**只许减不许增**。
 *
 * ⚠️ 它自带**注入故障自测**（第 B 组）：每次跑都在临时目录造 15 处已知悬空，
 *    断言全部被抓到。**如果把检查逻辑改成「永远返回 0」，B 组会红 15 条** ——
 *    这条断言不是空断言。
 *
 * 用法：
 *   node tools/dangling-ref-check.js                 # 常规检查（回归收录的就是这个）
 *   node tools/dangling-ref-check.js --baseline      # 把当前存量写进基线
 *   node tools/dangling-ref-check.js --verbose       # 全量列出（含存量）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const BASELINE = path.join(__dirname, 'dangling-ref-baseline.json');

const { World } = require(path.join(ROOT, 'game', 'src', 'core', 'world.js'));
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const VERBOSE = process.argv.includes('--verbose');
const MAKE_BASELINE = process.argv.includes('--baseline');
const LIMIT = 8; // 每类最多列几条（--verbose 时放开）

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); }
};
const head = t => console.log('\n===== ' + t + ' =====');

/* ================================================================
 * 判「这个 id 是不是确定悬空」
 * ================================================================ */

/** 已知的「别的命名空间」前缀 —— 这些不是集合 id，各有各的解析方 */
const KNOWN_NS = {
  'house': '家系统（home.js 按 house:<npcId> 现造房间）',
};

/** 任务目标里**不是集合引用**的 kind：它们的 key 是 flag 名 / 变量名 / 函数名。
 *  ⚠️ 别把它们塞进「无法判定」 —— 它们是**确定不适用**，只是由别的守卫守：
 *    flag 的「有没有人置位」由 check-data-load 第 ⑦ 组守。
 *    混进「无法判定」会稀释那个桶，让人看不出真有问题的那几条。 */
const NA_KINDS = new Set(['flag', 'var', 'fn']);

/** 把「字符串 / 数组 / {rank:[ids]} 这种对象」一律摊平成 id 列表 */
function flatIds(v) {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'object') {
    /* `sects.rankSkills` 是 `{"1":[...], "2":[...]}`（按品级分组），
       不是数组 —— 直接 `[].concat(它)` 会得到一个对象，然后被判成
       「[object Object] 不像 id」的假阳性（实测 43 条，全是这么来的）。 */
    const out = [];
    for (const k of Object.keys(v)) out.push(...flatIds(v[k]));
    return out;
  }
  return [v];
}

/**
 * @returns {'ok'|'dangling'|'unknown'} ok = 该 id 在宇宙里；dangling = 确定悬空；unknown = 无法判定
 */
function classify(value, universe) {
  if (typeof value !== 'string' || !value) return 'unknown';
  if (universe.has(value)) return 'ok';
  const ci = value.indexOf(':');
  if (ci > 0) {
    const ns = value.slice(0, ci);
    if (KNOWN_NS[ns]) return 'ok';           // 已知命名空间 → 不算悬空，但下面会另计一笔
    return 'unknown';                         // 不认识的命名空间 → 无法判定
  }
  if (/[{}$]/.test(value)) return 'unknown';  // 模板串 / 变量 → 无法判定
  if (/[\s　]/.test(value)) return 'unknown';  // 带空格多半不是 id
  return 'dangling';
}

/* ================================================================
 * 引用规则表
 *   from: 源集合   pick: 取出待查 id 的函数（返回 [{value, at}]）
 *   to: 目标集合   note: 人话后果
 * ================================================================ */
const RULES = [
  {
    id: 'rooms.exits→rooms', from: 'rooms', to: 'rooms',
    note: '玩家走到死路（最要命）',
    pick: (r, id) => {
      const out = [];
      const ex = r.exits || {};
      for (const dir of Object.keys(ex)) {
        const v = ex[dir];
        /* ⚠️ 出口有两种写法：字符串房号，或对象 `{to,cond,msg,travel}`
           （带条件的门）。只看字符串会把那 7 扇条件门**整扇漏掉**。 */
        if (typeof v === 'string') out.push({ value: v, at: id + '.exits.' + dir });
        else if (v && typeof v === 'object') {
          /* 出口对象**没有 to** 也是坏的（玩家点这个方向没地方去），
             但它不是「引用了不存在的 id」 —— 归「无法判定」，别混进悬空里。 */
          out.push({ value: v.to, at: id + '.exits.' + dir + '.to', noTo: !v.to });
        }
      }
      return out;
    },
  },
  {
    id: 'npcs.room→rooms', from: 'npcs', to: 'rooms',
    note: 'NPC 永不出现（静默）',
    pick: (n, id) => n.room ? [{ value: n.room, at: id + '.room' }] : [],
  },
  {
    id: 'npcs.home→rooms', from: 'npcs', to: 'rooms',
    note: 'NPC 回不了家（静默）',
    pick: (n, id) => n.home ? [{ value: n.home, at: id + '.home' }] : [],
  },
  {
    id: 'rooms.respawn→npcs', from: 'rooms', to: 'npcs',
    note: '岗位永远招不到人（守门的是空的）',
    pick: (r, id) => [].concat(r.respawn || []).map((x, i) => x && x.npc ? { value: x.npc, at: id + '.respawn[' + i + '].npc' } : null).filter(Boolean),
  },
  {
    id: 'rooms.npcs→npcs', from: 'rooms', to: 'npcs',
    note: '房间里挂了个不存在的 NPC',
    pick: (r, id) => [].concat(r.npcs || []).map((x, i) => ({ value: x, at: id + '.npcs[' + i + ']' })),
  },
  {
    id: 'regions.entry→rooms', from: 'regions', to: 'rooms',
    note: '区域没有入口房间',
    pick: (g, id) => g.entry ? [{ value: g.entry, at: id + '.entry' }] : [],
  },
  {
    id: 'sects.entry→rooms', from: 'sects', to: 'rooms',
    note: '门派进不去',
    pick: (s, id) => s.entry ? [{ value: s.entry, at: id + '.entry' }] : [],
  },
  {
    id: 'quests.giver→npcs', from: 'quests', to: 'npcs',
    note: '任务接不到（委托人不存在）',
    pick: (q, id) => (q.giver || q.npc) ? [{ value: q.giver || q.npc, at: id + '.giver' }] : [],
  },
  {
    id: 'quests.targets→集合', from: 'quests', to: '*',
    note: '任务接了做不了（目标不存在 ⇒ 判定永远 false）',
    /* kind 决定查哪个集合：room→rooms / item→items / kill→npcs */
    pick: (q, id) => {
      const out = [];
      const stages = [].concat(q.stages || []);
      for (let si = 0; si < stages.length; si++) {
        const st = stages[si];
        if (!st) continue;
        const groups = [st.targets];
        for (const g of ['targetsByGender', 'targetsByLine']) {
          if (st[g]) for (const k of Object.keys(st[g])) groups.push(st[g][k]);
        }
        for (const tg of groups) for (const t of [].concat(tg || [])) {
          if (!t || !t.key) continue;
          /* ⚠️ 目标有**两种写法**：`{kind:'var', key}` 和 `{var:'xxx', key:'xxx'}`
             （后者没写 kind）。只认 kind 的话，第二种会被当成「目标集合未定」
             落进「无法判定」—— 实测全库就这一条（`q_brothel_sell`）。
             补上 `var` 字段这个判据，它归到「不适用（不是集合引用）」。 */
          const kind = t.kind || (t.var !== undefined ? 'var' : undefined);
          out.push({ value: t.key, at: id + '.stages[' + si + ']', kind });
        }
      }
      return out;
    },
    toOf: (item) => (item.kind === 'room' ? 'rooms' : item.kind === 'item' ? 'items'
      : (item.kind === 'kill' || item.kind === 'npc' || item.kind === 'talk') ? 'npcs' : null),
  },
  {
    id: 'sects.skills→skills', from: 'sects', to: 'skills',
    note: '门派教一门不存在的武学',
    pick: (s, id) => ['skills', 'entrySkills', 'rankSkills']
      .reduce((o, f) => o.concat(flatIds(s[f]).map((x, i) => ({ value: x, at: id + '.' + f + '[' + i + ']' }))), []),
  },
  {
    id: 'sects.entryItems→items', from: 'sects', to: 'items',
    note: '入门发一件不存在的物品',
    pick: (s, id) => [].concat(s.entryItems || []).map((x, i) => ({ value: x, at: id + '.entryItems[' + i + ']' })),
  },
  {
    id: 'npcs.skills→skills', from: 'npcs', to: 'skills',
    note: 'NPC 会一门不存在的武学',
    pick: (n, id) => [].concat(n.skills || []).map((x, i) => ({ value: (typeof x === 'string' ? x : x && x.id), at: id + '.skills[' + i + ']' })),
  },
  {
    id: 'npcs.carry→items', from: 'npcs', to: 'items',
    note: 'NPC 身上揣着不存在的东西',
    pick: (n, id) => [].concat(n.carry || []).map((x, i) => ({ value: (typeof x === 'string' ? x : x && (x.id || x.item)), at: id + '.carry[' + i + ']' })),
  },
  {
    id: 'items.grantsSkill→skills', from: 'items', to: 'skills',
    note: '道具教一门不存在的武学',
    pick: (it, id) => it.grantsSkill ? [{ value: it.grantsSkill, at: id + '.grantsSkill' }] : [],
  },
  {
    id: 'rooms.treasurySect→sects', from: 'rooms', to: 'sects',
    note: '库房挂了个不存在的门派',
    pick: (r, id) => r.treasurySect ? [{ value: r.treasurySect, at: id + '.treasurySect' }] : [],
  },
];

/* ================================================================
 * 核心：扫一份合并后的 data
 * ================================================================ */
function collect(data) {
  const universes = {};
  for (const c of ['rooms', 'npcs', 'items', 'skills', 'quests', 'sects', 'regions']) {
    universes[c] = new Set(Object.keys(data[c] || {}));
  }
  const findings = [];   // 确定悬空
  const unknown = [];    // 无法判定（**不许当通过**，单列报出来）
  const na = [];         // 确定不适用（flag/var/fn 这类，不是集合引用，由别的守卫守）
  const otherNs = {};    // 已知别的命名空间（house: 等）—— 不算错，但要让人看见
  let scanned = 0;

  for (const rule of RULES) {
    const src = data[rule.from] || {};
    for (const id of Object.keys(src)) {
      const ent = src[id];
      if (!ent || typeof ent !== 'object') continue;
      for (const ref of (rule.pick(ent, id) || [])) {
        scanned++;
        if (ref.noTo) { unknown.push({ rule: rule.id, at: ref.at, value: '(缺 to)', why: '出口对象没写 to，玩家点这个方向没地方去' }); continue; }
        if (ref.value === undefined || ref.value === null || ref.value === '') continue;
        if (ref.kind !== undefined && NA_KINDS.has(ref.kind)) {
          na.push({ rule: rule.id, at: ref.at, value: ref.value, why: 'kind=' + ref.kind + '，key 不是集合 id' });
          continue;
        }
        const coll = rule.toOf ? rule.toOf(ref) : rule.to;
        if (!coll) { unknown.push({ rule: rule.id, at: ref.at, value: ref.value, why: '目标集合未定（kind=' + (ref.kind || '?') + '）' }); continue; }
        const uni = universes[coll];
        if (!uni) { unknown.push({ rule: rule.id, at: ref.at, value: ref.value, why: '没有这个集合 ' + coll }); continue; }
        const verdict = classify(ref.value, uni);
        if (verdict === 'dangling') findings.push({ rule: rule.id, at: ref.at, value: ref.value, to: coll, note: rule.note });
        else if (verdict === 'unknown') unknown.push({ rule: rule.id, at: ref.at, value: ref.value, why: '不像一个 id（含 : / { } / 空格）' });
        else if (typeof ref.value === 'string' && KNOWN_NS[ref.value.slice(0, ref.value.indexOf(':'))]) {
          const ns = ref.value.slice(0, ref.value.indexOf(':'));
          otherNs[ns] = (otherNs[ns] || 0) + 1;
        }
      }
    }
  }
  return { findings, unknown, na, otherNs, scanned, universes };
}

const keyOf = f => f.rule + '|' + f.at + '|' + f.value;

/**
 * 与基线比对（抽成纯函数，好在 B 组里单测 —— 否则「新增会不会红」只能靠改真数据验）。
 * @returns {{newOnes:string[], fixed:string[]}}
 */
function diffBaseline(nowSet, baseSet) {
  const newOnes = [...nowSet].filter(k => !baseSet.has(k));
  const fixed = [...baseSet].filter(k => !nowSet.has(k));
  return { newOnes, fixed };
}

/* ================================================================
 * A 组：真引擎 boot，与基线比对
 * ================================================================ */
function groupA() {
  head('A · 真数据：悬空引用（id 宇宙 = boot 后的合并结果，含 Mod）');
  let e = null, bootErr = null;
  try {
    e = new GameEngine({ seed: 20261012 });
    e.boot({});
  } catch (err) { bootErr = err; }
  ok('★ A0 引擎能起来', !bootErr, bootErr ? String(bootErr.message).slice(0, 300) : '');
  if (!e) return null;

  const r = collect(e.world.data);
  console.log('  扫了 ' + r.scanned + ' 条引用，'
    + Object.keys(r.universes).map(c => c + ' ' + r.universes[c].size).join(' / '));

  /* 按规则分组报数 —— 这个数就是「内容大改能不能开工」的依据 */
  const byRule = {};
  for (const f of r.findings) (byRule[f.rule] = byRule[f.rule] || []).push(f);
  console.log('');
  if (!r.findings.length) console.log('  确定悬空：**0 条**');
  for (const k of Object.keys(byRule).sort((a, b) => byRule[b].length - byRule[a].length)) {
    const list = byRule[k];
    console.log('  ' + String(list.length).padStart(4) + '  ' + k + '   ← ' + list[0].note);
    const lim = VERBOSE ? list.length : LIMIT;
    for (const f of list.slice(0, lim)) console.log('          ' + f.at + ' → ' + f.value);
    if (list.length > lim) console.log('          ……另有 ' + (list.length - lim) + ' 条（--verbose 全列）');
  }

  /* 别的命名空间：不算错，但**必须让人看见**（判据太宽就是从这儿看出来的） */
  if (Object.keys(r.otherNs).length) {
    console.log('');
    for (const ns of Object.keys(r.otherNs)) {
      console.log('  ℹ ' + ns + ': 前缀 ' + r.otherNs[ns] + ' 条 —— ' + KNOWN_NS[ns] + '（不是集合 id，不计悬空）');
    }
  }

  /* 确定不适用（flag / var / fn）：不是集合引用，由别的守卫守 —— 说清是谁守 */
  if (r.na.length) {
    const naBy = {};
    for (const u of r.na) naBy[u.why] = (naBy[u.why] || 0) + 1;
    console.log('');
    for (const w of Object.keys(naBy)) {
      console.log('  · 不适用 ' + String(naBy[w]).padStart(4) + '  任务目标 ' + w
        + '（flag 的「有没有人置位」由 check-data-load 第 ⑦ 组守）');
    }
  }

  /* 无法判定：单列，不许当通过 */
  const unkByRule = {};
  for (const u of r.unknown) (unkByRule[u.rule] = unkByRule[u.rule] || []).push(u);
  console.log('');
  if (!r.unknown.length) console.log('  ℹ 无法判定：0 条');
  else {
    for (const k of Object.keys(unkByRule)) {
      const list = unkByRule[k];
      console.log('  ⚠ 无法判定 ' + String(list.length).padStart(4) + '  ' + k + '（' + list[0].why + '）**单列，不算通过**');
      for (const u of list.slice(0, 5)) console.log('          ' + u.at + ' → ' + u.value);
    }
  }

  /* ---- 与基线比对：只许减不许增 ---- */
  const now = new Set(r.findings.map(keyOf));
  let base = null;
  if (fs.existsSync(BASELINE)) {
    try { base = JSON.parse(fs.readFileSync(BASELINE, 'utf8')); } catch (_) { base = null; }
  }
  if (MAKE_BASELINE) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      _when: new Date().toISOString(),
      _note: '内容大改开工前的存量。只许减不许增 —— 修好一条就删一条。',
      _count: r.findings.length,
      items: r.findings.map(keyOf).sort(),
    }, null, 2) + '\n', 'utf8');
    console.log('\n  基线已写入 ' + path.relative(ROOT, BASELINE) + '（' + r.findings.length + ' 条）');
    return { findings: r.findings, unknown: r.unknown, newOnes: [], fixed: [] };
  }
  if (!base) {
    console.log('\n  没有基线 —— 先跑一次 `--baseline` 把存量记下来。');
    ok('★ 基线存在（没有基线就判不了「新增」）', false, '缺 ' + path.relative(ROOT, BASELINE));
    return { findings: r.findings, unknown: r.unknown, newOnes: [], fixed: [] };
  }
  const baseSet = new Set(base.items || []);
  const { newOnes, fixed } = diffBaseline(now, baseSet);
  console.log('');
  ok('★ A1 没有**新增**悬空（基线 ' + baseSet.size + ' 条 / 现在 ' + now.size + ' 条）',
    newOnes.length === 0, newOnes.length + ' 条新增：' + newOnes.slice(0, 6).join(' ; '));
  ok('★ A2 基线里没有该删未删的（修好了就从基线删掉，防基线烂掉）',
    fixed.length === 0, fixed.length + ' 条已修好但未从基线删除：' + fixed.slice(0, 6).join(' ; '));
  /* 「无法判定」永远不许当通过：有就报出来，但不判 fail —— 判 fail 会让人去改判据而不是改数据 */
  console.log('  ℹ 无法判定 ' + r.unknown.length + ' 条：**单列**，不判通过也不判失败（见上）');
  return { findings: r.findings, unknown: r.unknown, newOnes, fixed };
}

/* ================================================================
 * B 组：注入故障自测 —— 证明判据不是空断言
 * 把检查逻辑改成「永远返回 0」，这一组会红 15 条。
 * ================================================================ */
const INJECT = [
  ['rooms.exits→rooms', '字符串出口指向不存在的房', (d) => { d.rooms.a.exits.n = 'nope_room_1'; }],
  ['rooms.exits→rooms', '对象出口（条件门）的 to 指向不存在的房', (d) => { d.rooms.a.exits.d = { to: 'nope_room_2', cond: {} }; }],
  ['npcs.room→rooms', 'NPC 的 room 不存在', (d) => { d.npcs.n1.room = 'nope_room_3'; }],
  ['npcs.home→rooms', 'NPC 的 home 不存在', (d) => { d.npcs.n1.home = 'nope_room_4'; }],
  ['rooms.respawn→npcs', '房间的 respawn 招不到人', (d) => { d.rooms.a.respawn = [{ npc: 'nope_npc_1' }]; }],
  ['rooms.npcs→npcs', '房间挂了个不存在的 NPC', (d) => { d.rooms.a.npcs = ['nope_npc_2']; }],
  ['regions.entry→rooms', '区域入口房不存在', (d) => { d.regions.rg1.entry = 'nope_room_5'; }],
  ['sects.entry→rooms', '门派入口房不存在', (d) => { d.sects.s1.entry = 'nope_room_6'; }],
  ['quests.giver→npcs', '任务委托人不存�', (d) => { d.quests.q1.giver = 'nope_npc_3'; }],
  ['quests.targets→集合', '任务目标房不存在', (d) => { d.quests.q1.stages = [{ targets: [{ kind: 'room', key: 'nope_room_7' }] }]; }],
  ['sects.skills→skills', '门派教一门不存在的武学', (d) => { d.sects.s1.skills = ['nope_skill_1']; }],
  ['sects.entryItems→items', '入门发一件不存在的物品', (d) => { d.sects.s1.entryItems = ['nope_item_1']; }],
  ['npcs.skills→skills', 'NPC 会一门不存在的武学', (d) => { d.npcs.n1.skills = ['nope_skill_2']; }],
  ['npcs.carry→items', 'NPC 揣着不存在的东西', (d) => { d.npcs.n1.carry = [{ id: 'nope_item_2' }]; }],
  ['items.grantsSkill→skills', '道具教一门不存在的武学', (d) => { d.items.i1.grantsSkill = 'nope_skill_3'; }],
  ['rooms.treasurySect→sects', '库房挂了不存在的门派', (d) => { d.rooms.a.treasurySect = 'nope_sect_1'; }],
];

function groupB() {
  head('B · 注入故障自测（证明判据不是空断言）');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-dangling-'));
  try {
    fs.writeFileSync(path.join(tmp, '01_rooms.json'), JSON.stringify({
      rooms: {
        a: { id: 'a', name: 'A', region: 'rg1', desc: 'a', exits: { s: 'b' } },
        b: { id: 'b', name: 'B', region: 'rg1', desc: 'b', exits: { n: 'a' } },
      },
      npcs: { n1: { id: 'n1', name: 'N1' } },
      items: { i1: { id: 'i1', name: 'I1' } },
      skills: { sk1: { id: 'sk1', name: 'SK1' } },
      sects: { s1: { id: 's1', name: 'S1' } },
      quests: { q1: { id: 'q1', name: 'Q1', stages: [] } },
      regions: { rg1: { id: 'rg1', name: 'RG1', entry: 'a' } },
    }, null, 1), 'utf8');

    const w = new World({ dataDirs: [tmp], seed: 1 });
    w.loadBaseData();
    for (const [, , mut] of INJECT) mut(w.data);
    const r = collect(w.data);

    const byRule = {};
    for (const f of r.findings) (byRule[f.rule] = byRule[f.rule] || []).push(f);
    for (const [rule, desc] of INJECT) {
      const hit = (byRule[rule] || []).some(f => String(f.value).startsWith('nope_'));
      ok('★ ' + rule + ' · ' + desc, hit, '没抓到 —— 判据漏了这一类');
    }
    /* 反向对照：一个**合法**的引用不许被误判 */
    {
      const w2 = new World({ dataDirs: [tmp], seed: 1 });
      w2.loadBaseData();
      /* house: 是家系统的命名空间，不是房间 id —— 绝不能算悬空 */
      w2.data.npcs.n1.home = 'house:n1';
      const r2 = collect(w2.data);
      ok('★ 反向对照：`home: "house:n1"` 不算悬空（家系统命名空间）',
        !r2.findings.some(f => f.value === 'house:n1'),
        r2.findings.filter(f => f.value === 'house:n1').map(f => f.at).join(','));
      ok('　反向对照：合法出口 a.s→b 不算悬空',
        !r2.findings.some(f => f.value === 'b' && f.at === 'a.exits.s'));
      ok('　反向对照：house: 前缀进了「别的命名空间」统计',
        (r2.otherNs['house'] || 0) === 1, JSON.stringify(r2.otherNs));
    }

    /* ---- 基线比对逻辑单测：不动真数据也能证明「新增/已修」会红 ---- */
    const S = arr => new Set(arr);
    const d1 = diffBaseline(S(['x', 'y']), S(['x']));
    ok('★ 基线比对：多出一条 ⇒ 判为「新增」（会红）',
      d1.newOnes.length === 1 && d1.newOnes[0] === 'y' && d1.fixed.length === 0, JSON.stringify(d1));
    const d2 = diffBaseline(S(['x']), S(['x', 'y']));
    ok('★ 基线比对：少了一条 ⇒ 判为「已修未删」（会红）',
      d2.fixed.length === 1 && d2.fixed[0] === 'y' && d2.newOnes.length === 0, JSON.stringify(d2));
    const d3 = diffBaseline(S(['x']), S(['x']));
    ok('　基线比对：两边一致 ⇒ 干净（不误报）',
      d3.newOnes.length === 0 && d3.fixed.length === 0, JSON.stringify(d3));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* 清不掉不碍事 */ }
  }
}

/* ================================================================ */
const a = groupA();
groupB();

console.log('');
console.log('── dangling-ref-check：通过 ' + pass + ' / 失败 ' + fail + ' ──');
if (fail) process.exitCode = 1;

module.exports = { collect, classify, diffBaseline, RULES, KNOWN_NS, NA_KINDS };
