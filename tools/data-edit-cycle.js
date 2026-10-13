#!/usr/bin/env node
/* ==========================================================================
 * tools/data-edit-cycle.js —— 改数据三步走：**改前查雷 → 你改 → 改后断言生效**
 * --------------------------------------------------------------------------
 * 为什么要有它（这两条纪律以前只靠人记得）：
 *   · 改前：跑 `data-dup-check --field <字段>`。这个项目 base data 是**多文件拼装**
 *     （world.js 的 loadBaseData 按文件名排序逐个 mergeData），数组默认 `replace`
 *     整段替换 —— 「我把这句话写进 XX.json 了」**不等于**「它生效了」。
 *   · 改后：boot **真引擎**打印字段实际值断言。⚠️ `new World()` 是空壳，
 *     必须 `new GameEngine({seed}).boot()` 再 `.newGame()` —— 而且 `boot()` 不返回 this，
 *     得分两句写。
 *
 * 它干什么：把「验的那半截」变成一条命令。**不代你改数据**，只保证你改完能被验出来。
 *   pre  —— 改前：① 格式守卫 check ② 字段争议检查 ③ 目标字段当前值快照（真引擎）
 *   post —— 改后：① 真引擎读同一路径，与 --expect 比对 ② 格式守卫 check
 *           ③ 与 pre 快照对比 ④ 争议检查复跑
 *   退出码非 0 = 没生效 / 踩雷 / 格式坏了。
 *
 * 用法：
 *   node tools/data-edit-cycle.js pre  --field npcs.talk --get npcs.npcv_154.talk.0
 *   # ……去改数据……
 *   node tools/data-edit-cycle.js post --get npcs.npcv_154.talk.0 --expect "新的第一句"
 *
 *   node tools/data-edit-cycle.js --selftest   # 自验（证明判据会红也会绿）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const guard = require(path.join(__dirname, 'data-write-guard.js'));

const arg = n => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
};
const has = n => process.argv.indexOf('--' + n) >= 0;

const DATA_DIR = path.join(ROOT, 'game', 'data');
const STATE = path.join(__dirname, '_data-edit-cycle.json');
const BASELINE = path.join(__dirname, 'data-format-baseline.json');

/* ================================================================
 *  路径取值：npcs.npcv_154.portrait.hooks.0.rewardHint
 * ================================================================ */
function getPath(obj, p) {
  const segs = String(p || '').split('.').filter(s => s !== '');
  let cur = obj;
  for (let i = 0; i < segs.length; i++) {
    if (cur === null || cur === undefined) return { ok: false, at: segs.slice(0, i).join('.'), why: '中途为 null/undefined' };
    const k = segs[i];
    if (Array.isArray(cur)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cur.length) return { ok: false, at: segs.slice(0, i).join('.'), why: '是数组，下标 ' + k + ' 越界（长度 ' + cur.length + '）' };
      cur = cur[idx];
    } else if (typeof cur === 'object') {
      if (!Object.prototype.hasOwnProperty.call(cur, k)) return { ok: false, at: segs.slice(0, i + 1).join('.'), why: '没有这个键' };
      cur = cur[k];
    } else return { ok: false, at: segs.slice(0, i).join('.'), why: '不是对象/数组（是 ' + typeof cur + '）' };
  }
  return { ok: true, value: cur };
}

/* ================================================================
 *  真引擎 boot
 * ================================================================ */
function boot() {
  const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
  const e = new GameEngine({ seed: 20261010 });
  e.boot();                       // ⚠️ boot() 不返回 this，必须分两句
  e.newGame({ name: '验', gender: 'male' });
  return e;
}

/* ================================================================
 *  ③ id 级 diff：「这次改了哪些 id」
 * --------------------------------------------------------------
 *  为什么不是文本 diff：
 *    `game/data/` 里同一批实体**分片存在多个文件**（73 给 name，82 只补 exits），
 *    文本 diff 全是格式噪声（缩进、键序、换行），看不出「哪些房间真的变了」。
 *    所以这里 diff 的是**解析之后**的结果：真引擎同一条加载链读进来，
 *    按集合算出「新增 / 删除 / 变更」的 id 清单。
 *
 *  ⚠️ 这份清单**不决定跑不跑回归** —— 改 1 句台词也可能炸掉守卫。
 *     它是用来让**人判断重点**的，不是用来省事的。
 * ================================================================ */
const crypto = require('crypto');
const COLLS = ['rooms', 'npcs', 'quests', 'items', 'skills', 'sects', 'regions', 'shops', 'events'];

/* 字段分级：判「这批改动是结构性的还是纯文案的」用的
 *   STRUCTURAL —— 动了它，引用关系就变了（出口指向、区域归属、谁住这儿…）
 *   TEXT       —— 只改说法，不动任何引用关系 */
const TEXT_FIELDS = ['name', 'desc'];
const STRUCTURAL_FIELDS = ['exits', 'region', 'respawn', 'npcs', 'actions', 'private', 'owner',
  'treasurySect', 'treasuryKind', 'onEnter', 'encounter', 'auctionHouse', 'homeTier', 'homeCapacity'];
const WATCH_FIELDS = [].concat(TEXT_FIELDS, STRUCTURAL_FIELDS);

function h1(v) {
  try { return crypto.createHash('md5').update(JSON.stringify(v === undefined ? null : v)).digest('hex').slice(0, 10); }
  catch (_) { return '?'; }
}

/**
 * 真引擎加载链解析一遍 `game/data/`（与闸一同一条路：World#loadBaseData → dataload）。
 * ⚠️ 每个实体存的是 `{_: 整条 hash, name:…, desc:…, exits:…}`，不是单个字符串 ——
 *    只有分字段才能判「这批是改文案还是改结构」，整条 hash 只能判「变了没有」。
 */
function collectIds() {
  const { World } = require(path.join(ROOT, 'game', 'src', 'core', 'world.js'));
  const w = new World({ dataDirs: [DATA_DIR], seed: 1 });
  w.loadBaseData();
  const out = { _when: new Date().toISOString(), _fmt: 2 };
  for (const c of COLLS) {
    const src = w.data[c] || {};
    const m = {};
    for (const id of Object.keys(src)) {
      const ent = src[id] || {};
      const rec = { _: h1(ent) };
      for (const f of WATCH_FIELDS) if (f in ent) rec[f] = h1(ent[f]);
      m[id] = rec;
    }
    out[c] = m;
  }
  return out;
}

/** 兼容旧快照（那时只存整条 hash 字符串） */
function recOf(v) { return (v && typeof v === 'object') ? v : { _: String(v) }; }

/**
 * 判这批改动是「结构性批次」还是「文案批次」。
 *
 * ⚠️ **只打印，不替人决定** —— 跟 id 清单一个道理：清单是让人判断重点的，
 *    不是让人省掉回归的。改 1 句台词也可能炸掉守卫。
 *
 * @returns {{kind:'结构性'|'文案'|'未知', reasons:string[], size:number, fieldOnly:boolean}}
 */
function classifyBatch(before, after) {
  const reasons = [];
  let structural = false, sawText = false, sawChange = false, fieldLevel = true, total = 0;
  let roomsAdd = 0, roomsDel = 0, exitsChanged = 0;

  for (const c of COLLS) {
    const B = (before && before[c]) || {};
    const A = (after && after[c]) || {};
    const added = Object.keys(A).filter(id => !(id in B));
    const removed = Object.keys(B).filter(id => !(id in A));
    const changed = Object.keys(A).filter(id => (id in B) && recOf(B[id])._ !== recOf(A[id])._);
    total += added.length + removed.length + changed.length;
    if (c === 'rooms') { roomsAdd += added.length; roomsDel += removed.length; }
    if (added.length || removed.length || changed.length) sawChange = true;

    for (const id of changed) {
      const b = recOf(B[id]), a = recOf(A[id]);
      /* 旧快照（只有整条 hash）⇒ 判不了字段级，只能整条看 */
      if (Object.keys(b).length <= 1 || Object.keys(a).length <= 1) { fieldLevel = false; continue; }
      const hits = WATCH_FIELDS.filter(f => (f in b || f in a) && b[f] !== a[f]);
      if (!hits.length) { /* 动的是没在监视列表里的字段 —— 保守按结构性算 */ structural = true; reasons.push(c + '.' + id + ' 有非文本字段变更'); continue; }
      for (const f of hits) {
        if (STRUCTURAL_FIELDS.indexOf(f) >= 0) {
          structural = true;
          if (f === 'exits') exitsChanged++;
          reasons.push(c + '.' + id + '.' + f + ' 变更（结构性）');
        } else sawText = true;
      }
    }
  }

  if (roomsAdd || roomsDel) {
    structural = true;
    reasons.unshift('rooms 集合有 id 增删（新增 ' + roomsAdd + ' / 删除 ' + roomsDel + '）—— 这是硬判据');
  }
  if (exitsChanged) reasons.unshift('exits 变更 ' + exitsChanged + ' 处 —— 引用关系动了');

  let kind;
  if (!sawChange) { kind = '文案'; reasons.push('没有任何变化'); }
  else if (structural) kind = '结构性';
  else if (!fieldLevel) { kind = '未知'; reasons.push('快照里没有字段级信息（旧格式），按最保守处理'); }
  else if (sawText) kind = '文案';
  else kind = '未知';

  return { kind, reasons, size: total, fieldLevel };
}

function printBatchVerdict(v) {
  console.log('   批次性质判定（**打印出来让人确认，不替你决定**）：');
  console.log('     ' + (v.kind === '结构性' ? '🔴 结构性批次' : v.kind === '文案' ? '🟢 文案批次' : '⚪ 未知（按最保守处理）'));
  const lim = 6;
  for (const r of v.reasons.slice(0, lim)) console.log('       · ' + r);
  if (v.reasons.length > lim) console.log('       ……另有 ' + (v.reasons.length - lim) + ' 条理由');
  console.log('     变更规模：' + v.size + ' 个实体');
  /* ⚠️ 「没变化」也会被判成文案 —— 但那不是「可以大批量」的依据。
     曾经这里会打出「200 间一把过也行」，而实际上 diff 是空的（你可能
     还没改，也可能改的东西本工具根本没盯）。**空的绿不能当成放行条。** */
  if (v.size === 0 && v.reasons.some(r => /没有任何变化/.test(r))) {
    console.log('     ⇒ **本次没检测到变化** —— 要么你还没改，要么改的是本工具没盯的集合/字段。');
    console.log('        ⚠️ 这不是「可以大批量」的凭据。（只改了没被盯的字段时，这里一样是空的）');
  } else if (v.kind === '结构性') {
    console.log('     ⇒ 建议**按区域分批，每批 ≤ 40 间**（引用关系动了，批次边界就是归因边界）');
  } else if (v.kind === '文案') {
    console.log('     ⇒ 只改了 name/desc，**可以大批量**（200 间一把过也行：不动引用关系，');
    console.log('        dangling-ref-check 不可能因为改文案变红）');
  } else {
    console.log('     ⇒ 判不了，按结构性批次处理（重跑一次 pre 就能拿到字段级信息）');
  }
  console.log('     ⚠️ 不管判成哪种，**回归照跑** —— 改 1 句台词也可能炸掉守卫。');
}

/** @returns {[{c,added,removed,changed,same,total}]} 只有真变了的集合才进结果 */
function diffIds(before, after) {
  const out = [];
  for (const c of COLLS) {
    const B = (before && before[c]) || {};
    const A = (after && after[c]) || {};
    const added = Object.keys(A).filter(id => !(id in B));
    const removed = Object.keys(B).filter(id => !(id in A));
    /* ⚠️ 快照现在是 `{_: 整条hash, 字段: hash}`，比的是 `_` —— 不是整个对象 */
    const changed = Object.keys(A).filter(id => (id in B) && recOf(B[id])._ !== recOf(A[id])._);
    const same = Object.keys(A).filter(id => (id in B) && recOf(B[id])._ === recOf(A[id])._).length;
    if (added.length || removed.length || changed.length) {
      out.push({ c, added, removed, changed, same, total: Object.keys(A).length });
    }
  }
  return out;
}

/** 变更的集合 → 回归重点关照的关键词（给 `--only` 用） */
const FOCUS = {
  rooms: ['map', 'room', 'exit'],
  npcs: ['npc', 'portrait', 'guard'],
  quests: ['quest', 'story', 'sidequest'],
  items: ['item', 'shop'],
  skills: ['skill', 'martial', 'combat'],
  sects: ['sect', 'disciple'],
  regions: ['map', 'region'],
  shops: ['shop', 'item'],
  events: ['event', 'story'],
};

function focusOf(diffs, cap) {
  const seen = [], out = [];
  for (const d of diffs) for (const k of (FOCUS[d.c] || [])) {
    if (seen.indexOf(k) < 0) { seen.push(k); out.push({ kw: k, why: d.c }); }
  }
  return out.slice(0, cap || 4);
}

/** 跑一组定向回归（`--only <kw>`）。
 *  ⚠️ 用**异步 spawn**，不用 spawnSync：实测某些环境下 `spawnSync(node.exe)`
 *     直接 EBUSY（连 `cmd /c echo` 都一样），而 `run-regression.js` 自己用的
 *     就是异步 spawn —— 跟它保持一致，这条路才稳。 */
function runFocus(kw) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(process.execPath, [path.join(__dirname, 'run-regression.js'), '--only', kw],
        { cwd: ROOT, env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { resolve({ status: -1, last: '启动失败: ' + e.message }); return; }
    const keep = c => { out += String(c); if (out.length > 64000) out = out.slice(-64000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', e => resolve({ status: -1, last: '启动失败: ' + e.message }));
    child.on('close', code => {
      const last = out.trim().split('\n').filter(l => /通过 .* 失败/.test(l)).pop() || '';
      resolve({ status: code, last });
    });
  });
}

function printIdDiff(diffs, title) {
  console.log(title);
  if (!diffs.length) { console.log('   没有变化（解析后的 id 集合与上次快照一致）'); return; }
  let total = 0;
  for (const d of diffs) {
    const n = d.added.length + d.removed.length + d.changed.length;
    total += n;
    console.log('   ' + d.c.padEnd(9) + ' +' + d.added.length + '  -' + d.removed.length
      + '  ~' + d.changed.length + '   共 ' + d.total + '（变了 ' + n + '，'
      + (n * 100 / Math.max(1, d.total)).toFixed(1) + '%）');
    const show = (tag, list) => {
      if (!list.length) return;
      const lim = 10;
      console.log('        ' + tag + ' ' + list.slice(0, lim).join(', ') + (list.length > lim ? ' ……另 ' + (list.length - lim) + ' 个' : ''));
    };
    show('新增', d.added); show('删除', d.removed); show('变更', d.changed);
  }
  console.log('   变更规模合计：' + total + ' 个实体');
  console.log('   ⚠️ 这个数**不决定跑不跑回归** —— 改 1 句台词也可能炸掉守卫。');
  console.log('      清单是让你判断**重点**的，不是让你省掉回归的。');
}

/* ================================================================
 *  ① 格式守卫（复用 data-write-guard，不重复实现）
 * ================================================================ */
function fmtCheck(only) {
  if (!fs.existsSync(BASELINE)) return { ok: false, lines: ['没有基线，先跑 node tools/data-write-guard.js --baseline'] };
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const saved = process.argv;
  try {
    /* ⚠️ 必须把 argv **整个换成干净的**：guard.checkDir 会自己去读 process.argv，
       而本脚本自己也有 `--only`（cycle 用来选回归套件的）。透传过去的话，
       `--only mirror` 会被它当成「只扫名字含 mirror 的数据文件」⇒ 扫 0 个
       ⇒ 0 个偏离 ⇒ **假绿**（实测 cycle 里就打出了「✔ 0 个文件」）。
       一个什么都没扫的守卫报绿，比报红更危险。 */
    process.argv = saved.slice(0, 2).concat(only ? ['--only', only] : []);
    const r = guard.checkDir(DATA_DIR, base);
    const lines = r.bad.map(b => '    ' + b.f + '：' + b.items.map(i => i.k + '(期望' + i.want + '/实际' + i.got + ')').join('、'));
    return { ok: r.bad.length === 0, lines, scanned: r.scanned };
  } finally { process.argv = saved; }
}

/* ================================================================
 *  ② 字段争议检查（直接 spawn data-dup-check，不重新实现一遍）
 * ================================================================ */
/* ⚠️ 原来是 spawnSync —— 在这个环境里 spawnSync 直接 EBUSY（连 `cmd /c echo`
 *    都跑不起来），于是 `r.error` 有值 ⇒ 返回 `{ok:false}` 且**不带 ran** ⇒
 *    自检那条「脚本确实跑起来了」永久红。
 *    一条永远红的守卫比没有守卫更糟：它会训练人看到红也往下走。
 *    ⇒ 改成异步 spawn，跟 runFocus / runTool 一致。调用点全部 await。 */
async function dupCheck(field) {
  if (!field) return { ok: true, lines: ['（未给 --field，跳过争议检查）'], ran: false };
  const { spawn } = require('child_process');
  const out = await new Promise((resolve) => {
    let buf = '', child;
    try {
      child = spawn(process.execPath, [path.join(__dirname, 'data-dup-check.js'), '--field', field],
        { cwd: ROOT, env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { resolve(null); return; }
    const keep = c => { buf += String(c); if (buf.length > 64 * 1024 * 1024) buf = buf.slice(-64000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(buf));
  });
  if (out === null) return { ok: false, lines: ['跑不起来：spawn 启动失败'], ran: false };
  /* ⚠️ 判「有没有争议」不能只看有没有输出：脚本本身会打表头。
     真正的争议行是带「×N」且 N>1 的条目；同时**必须**给出反向对照，
     证明「没输出」不是脚本静默失败。 */
  const disputes = out.split('\n').filter(l => /×\s*[2-9]/.test(l) || /×\s*\d{2,}/.test(l));
  return {
    ok: disputes.length === 0,
    lines: disputes.length ? disputes.slice(0, 10) : ['（该字段无争议）'],
    rawHead: out.split('\n').slice(0, 3).join(' | '),
    ran: true,
  };
}

/* ================================================================
 *  pre / post
 * ================================================================ */
async function cmdPre() {
  const field = arg('field'), get = arg('get');
  console.log('===== 改前（pre）=====');
  const f = fmtCheck();
  console.log('① 格式守卫：' + (f.ok ? '✔ ' + f.scanned + ' 个文件与基线一致' : '✘ 有偏离'));
  f.lines.forEach(l => console.log(l));
  const d = await dupCheck(field);
  console.log('② 字段争议（--field ' + (field || '(未给)') + '）：' + (d.ok ? '✔ 无争议' : '✘ 有争议，见下'));
  d.lines.forEach(l => console.log('    ' + l));
  if (d.ran) console.log('    （脚本确实跑了，输出头：' + String(d.rawHead).slice(0, 80) + '）');

  let snap = null;
  if (get) {
    const e = boot();
    const g = getPath(e.world.data, get);
    console.log('③ 当前值（真引擎）：' + (g.ok ? JSON.stringify(g.value) : '✘ 取不到 —— ' + g.at + ' ' + g.why));
    if (g.ok) snap = String(g.value);
  }
  /* ④ id 级快照：改完拿它比，算出「这次动了哪些实体」 */
  const ids = collectIds();
  console.log('④ id 快照（解析级）：'
    + COLLS.map(c => c + ' ' + Object.keys(ids[c]).length).join(' / '));
  fs.writeFileSync(STATE, JSON.stringify({ when: new Date().toISOString(), field, get, snap, ids }, null, 2) + '\n', 'utf8');
  console.log('\n快照已存 ' + path.relative(ROOT, STATE) + '。现在去改数据，改完跑：');
  console.log('  node tools/data-edit-cycle.js post --get ' + (get || '<路径>') + ' --expect "<新值>"');
  process.exit(f.ok && d.ok ? 0 : 1);
}

async function cmdPost() {
  const get = arg('get'), expect = arg('expect'), field = arg('field');
  console.log('===== 改后（post）=====');
  let bad = 0;
  if (!get) { console.log('✘ 必须给 --get'); process.exit(2); }

  const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;

  const e = boot();
  const g = getPath(e.world.data, get);
  console.log('① 真引擎读 ' + get);
  if (!g.ok) { console.log('   ✘ 取不到 —— ' + g.at + ' ' + g.why); bad++; }
  else {
    console.log('   实际 = ' + JSON.stringify(g.value));
    if (arg('expect')) {
      const hit = String(g.value) === expect;
      console.log('   期望 = ' + JSON.stringify(expect) + '  → ' + (hit ? '✔ 生效了' : '✘ **没生效**（这就是 replace 语义把你的改动吞了）'));
      if (!hit) bad++;
    } else console.log('   （未给 --expect，只打印不断言）');
    if (st && st.get === get && st.snap != null) {
      const changed = String(g.value) !== st.snap;
      console.log('   改前快照 = ' + JSON.stringify(st.snap) + '  → ' + (changed ? '✔ 值确实变了' : '✘ **值没变**（你确定改了吗？）'));
      if (!changed) bad++;
    }
  }

  const f = fmtCheck();
  console.log('② 格式守卫：' + (f.ok ? '✔ ' + f.scanned + ' 个文件与基线一致' : '✘ 你这次写入改坏了格式'));
  f.lines.forEach(l => console.log(l));
  if (!f.ok) bad++;

  const d = await dupCheck(field || (st && st.field));
  console.log('③ 字段争议复查：' + (d.ok ? '✔ 无争议' : '✘ 有争议'));
  d.lines.forEach(l => console.log('    ' + l));
  if (!d.ok) bad++;

  /* ④ 这次改了哪些 id（解析级 diff）—— 报告里**必须带上**，定向跑是加分项 */
  const after = collectIds();
  const before = (st && st.ids) || null;
  if (!before) console.log('\n④ id 级 diff：（pre 快照里没有 id 快照，跳过 —— 下次 pre 会带上）');
  else {
    const diffs = diffIds(before, after);
    printIdDiff(diffs, '\n④ 这次改了哪些 id（解析级 diff，不是文本 diff）：');
    console.log('');
    printBatchVerdict(classifyBatch(before, after));
    const focus = focusOf(diffs, 4);
    if (focus.length) {
      console.log('   回归重点关照：' + focus.map(f => '--only ' + f.kw + '（因 ' + f.why + '）').join('  '));
      if (has('run-regression')) {
        for (const f of focus) {
          console.log('   → 跑 node tools/run-regression.js --only ' + f.kw);
          const r = await runFocus(f.kw);
          console.log('       ' + (r.status === 0 ? '✔ ' : '✘ ') + (r.last || ('退出码 ' + r.status)));
          if (r.status !== 0) bad++;
        }
      } else {
        console.log('   （加 --run-regression 就顺手跑这几组定向回归）');
      }
    }
  }

  console.log('\n' + (bad ? '✘ 有 ' + bad + ' 项没过 —— 你的改动**不能算生效**' : '✔ 全部通过，改动确认生效'));
  process.exit(bad ? 1 : 0);
}

/* ================================================================
 *  一步一个工具（异步 spawn —— spawnSync 在有些环境整体 EBUSY，见 runFocus 注释）
 * ================================================================ */
function runTool(file, args) {
  const { spawn } = require('child_process');
  return new Promise((resolve) => {
    let out = '', child;
    try {
      child = spawn(process.execPath, [path.join(__dirname, file)].concat(args || []),
        { cwd: ROOT, env: Object.assign({}, process.env), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (e) { resolve({ status: -1, tail: '启动失败: ' + e.message }); return; }
    const keep = c => { out += String(c); if (out.length > 64000) out = out.slice(-64000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', e => resolve({ status: -1, tail: '启动失败: ' + e.message }));
    child.on('close', code => resolve({
      status: code,
      tail: out.trim().split('\n').slice(-12).map(l => '       ' + l).join('\n'),
    }));
  });
}

/**
 * 串起来跑，**中途任一步红就停**（不继续跑后面的）。
 * ⚠️ 「继续跑完再一起报」是错的：前一步已经红了，后面每一步的结论都不可信
 *    （比如生成失败 → 守卫验的是上一版数据 → 全绿，那是假绿）。
 * @param {[{label, file, args}]} steps
 */
async function runSteps(steps) {
  const done = [];
  for (const s of steps) {
    const r = await runTool(s.file, s.args);
    done.push({ label: s.label, status: r.status });
    console.log('  ' + (r.status === 0 ? '✔ ' : '✘ ') + s.label + (r.status === 0 ? '' : '  ← 退出码 ' + r.status));
    if (r.status !== 0) {
      if (r.tail) console.log(r.tail);
      return { ok: false, failedAt: s.label, done };
    }
  }
  return { ok: true, failedAt: null, done };
}

/* ================================================================
 *  cycle —— 改数 → 生成 → 守卫 → 回归，**一条命令，一步红就停**
 * --------------------------------------------------------------
 *  用法：
 *    node tools/data-edit-cycle.js cycle
 *    node tools/data-edit-cycle.js cycle --gen tools/gen-rooms.js --full
 *    node tools/data-edit-cycle.js cycle --only map
 *
 *  各步（任一步非 0 ⇒ 立刻停，后面的一步都不跑）：
 *    ① 改前：格式守卫 + 字段争议 + id 快照
 *    ② 生成：--gen 指定的脚本（不给就跳过）
 *    ③ 守卫：data-load-check（加载层）+ dangling-ref-check（悬空引用）+ 格式守卫复查
 *    ④ diff：这次改了哪些 id（解析级）
 *    ⑤ 回归：--full 全量 / --only 定向 / 默认按 ④ 的重点定向
 * ================================================================ */
async function cmdCycle() {
  const gen = arg('gen');
  const only = arg('only');
  const full = has('full');
  console.log('===== cycle：改数 → 生成 → 守卫 → 回归（一步红就停）=====');

  console.log('\n① 改前');
  const f0 = fmtCheck();
  console.log('  格式守卫：' + (f0.ok ? '✔ ' + f0.scanned + ' 个文件' : '✘ 有偏离'));
  f0.lines.forEach(l => console.log('    ' + l));
  /* ⚠️ 「扫了 0 个文件」必须当失败 —— 一个什么都没扫的守卫报绿，比报红更危险 */
  if (f0.scanned < 40) {
    console.log('  ✘ 只扫到 ' + f0.scanned + ' 个数据文件（正常应 ≥ 40）—— 这一步等于没验，停');
    process.exit(1);
  }
  const field = arg('field');
  const d0 = await dupCheck(field);
  console.log('  字段争议（--field ' + (field || '(未给，跳过)') + '）：'
    + (field ? (d0.ok ? '✔ 无争议' : '⚠ ' + d0.lines[0]) : '跳过'));
  const idsBefore = collectIds();
  console.log('  id 快照：' + COLLS.map(c => c + ' ' + Object.keys(idsBefore[c]).length).join(' / '));
  if (!f0.ok) { console.log('\n✘ ① 没过，停 —— 后面的结论都不可信'); process.exit(1); }

  const steps = [];
  if (gen) steps.push({ label: '② 生成 ' + gen, file: path.basename(gen), args: [] });
  steps.push({ label: '③ 守卫 data-load-check（加载层 fail-fast）', file: 'data-load-check.js', args: [] });
  steps.push({ label: '③ 守卫 dangling-ref-check（悬空引用）', file: 'dangling-ref-check.js', args: [] });

  console.log('\n②③ 生成 + 守卫');
  const r = await runSteps(steps);
  if (!r.ok) {
    console.log('\n✘ 停在「' + r.failedAt + '」—— 后面的回归**不跑了**（红着往下跑出来的绿是假绿）');
    process.exit(1);
  }

  console.log('\n④ 这次改了哪些 id');
  const idsAfter = collectIds();
  const diffs = diffIds(idsBefore, idsAfter);
  printIdDiff(diffs, '');
  console.log('');
  printBatchVerdict(classifyBatch(idsBefore, idsAfter));

  console.log('\n⑤ 回归');
  let regArgs = ['--only', only || (focusOf(diffs, 1)[0] || {}).kw || 'map'];
  if (full) regArgs = [];
  console.log('  跑 run-regression ' + (regArgs.length ? regArgs.join(' ') : '（全量）'));
  const rr = await runSteps([{ label: '⑤ 回归 ' + (full ? '全量' : regArgs[1]), file: 'run-regression.js', args: regArgs }]);
  if (!rr.ok) { console.log('\n✘ 回归没过'); process.exit(1); }
  console.log('\n✔ cycle 五步全过');
  process.exit(0);
}

/* ================================================================
 *  diff —— 只比 id，不比字段（改完想看「我动了哪些实体」时单独用）
 * ================================================================ */
function cmdDiff() {
  console.log('===== id 级 diff（对比上一次 pre 快照）=====');
  const st = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : null;
  if (!st || !st.ids) {
    console.log('没有 pre 快照（或旧快照里没有 ids）。先跑：');
    console.log('  node tools/data-edit-cycle.js pre  --field <字段> --get <路径>');
    process.exit(2);
  }
  console.log('pre 快照时间：' + st.when + (st.ids._fmt ? '' : '（旧格式快照，判不了字段级）'));
  const now = collectIds();
  printIdDiff(diffIds(st.ids, now), '变化：');
  console.log('');
  printBatchVerdict(classifyBatch(st.ids, now));
  process.exit(0);
}

/* ================================================================
 *  自测：证明判据会红也会绿
 * ================================================================ */
async function selftest() {
  let pass = 0, fail = 0;
  const T = (c, n, extra) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + (extra ? '\n      ' + extra : '')); } };

  /* ① getPath：3 命中 + 3 不命中 */
  const obj = { npcs: { a: { talk: ['一', '二'], portrait: { hooks: [{ rewardHint: '甲' }] } } } };
  const cases = [
    ['npcs.a.talk.0', true, '数组下标'],
    ['npcs.a.portrait.hooks.0.rewardHint', true, '深层路径'],
    ['npcs.a.talk', true, '整个数组'],
    ['npcs.a.talk.9', false, '下标越界应取不到'],
    ['npcs.a.没有这个键', false, '键不存在应取不到'],
    ['npcs.a.talk.0.再往下', false, '标量再往下应取不到'],
  ];
  for (const [p, want, note] of cases) {
    const g = getPath(obj, p);
    T(g.ok === want, 'getPath ' + note + '（' + p + '）→ ' + (want ? '应取到' : '应取不到'));
  }

  /* ② 真引擎能起来且能取到真实字段 */
  const e = boot();
  const n = Object.keys(e.world.data.npcs || {}).length;
  T(n > 800, '真引擎 boot 后 NPC 数 = ' + n + '（证明不是空壳 World）');
  const g = getPath(e.world.data, 'npcs.npcv_154.talk.0');
  T(g.ok, '真引擎能取到 npcs.npcv_154.talk.0 = ' + (g.ok ? JSON.stringify(g.value) : '取不到'));

  /* ③ 期望值比对：对的值应该过，错的值必须不过（否则等于没验） */
  if (g.ok) {
    const right = String(g.value) === String(g.value);
    const wrong = String(g.value) === '一个绝对不存在的值xyzzy';
    T(right === true && wrong === false, '期望值比对：给对的值→过、给错的值→不过（反向对照）');
  }

  /* ④ 格式守卫复用：当前磁盘应与基线一致 */
  const f = fmtCheck();
  T(f.ok, '格式守卫复用：当前 game/data 与基线一致（' + f.scanned + ' 个文件）', f.lines.join('\n'));

  /* ⑤ dup 检查：给一个真实字段，脚本必须真的跑起来（防「静默失败」） */
  const d = await dupCheck('npcs.talk');
  /* ⚠️ 不能只听它自己说 `ran: true` —— 那是**自述**，不是证据。
     要看到脚本自己打出来的「扫描文件 N 个」，才算真的跑了。
     （否则把 dupCheck 改成 `return {ok:true, ran:true}` 这种假绿，
     这条自测依然全绿 —— 那正是「守卫要先证明自己真的在工作」要防的。） */
  /* 注意：脚本自己打的是**全角冒号**「扫描文件：53 个」，正则要两种冒号都认 */
  T(d.ran === true && /扫描文件[：:]\s*\d+\s*个/.test(String(d.rawHead)),
    '争议检查复用 data-dup-check：确实跑起来了，且**看到了它自己打的「扫描文件 N 个」**（head: '
    + String(d.rawHead).slice(0, 60) + '）');

  /* ⑥ id 级 diff：新增 / 删除 / 变更三种都得认出来 */
  {
    const B = { rooms: { a: '1', b: '2', c: '3' }, npcs: { n: '1' } };
    const A = { rooms: { a: '1', b: '9', d: '4' }, npcs: { n: '1' } };
    const dd = diffIds(B, A);
    const rooms = dd.find(x => x.c === 'rooms');
    T(!!rooms, 'id diff：rooms 变了 ⇒ 出现在结果里');
    T(!!rooms && rooms.added.join(',') === 'd', 'id diff：新增 d 被认出来', rooms ? JSON.stringify(rooms.added) : '');
    T(!!rooms && rooms.removed.join(',') === 'c', 'id diff：删除 c 被认出来', rooms ? JSON.stringify(rooms.removed) : '');
    T(!!rooms && rooms.changed.join(',') === 'b', 'id diff：变更 b 被认出来（hash 2→9）', rooms ? JSON.stringify(rooms.changed) : '');
    T(!!rooms && rooms.same === 1, 'id diff：没变的 a 归入 same（' + (rooms ? rooms.same : '?') + '）');
    T(!dd.find(x => x.c === 'npcs'), 'id diff：没变的集合**不进**结果（防噪声刷屏）');
    /* 反向对照：证明上面几条不是「怎么改都过」 */
    T(diffIds(B, B).length === 0, '反向对照：两份一模一样 ⇒ 0 变化（不误报）');
    T(diffIds(B, A).length !== diffIds(A, B).length || diffIds(A, B).length === 1,
      '反向对照：前后对调 ⇒ 新增/删除互换（方向没搞反）');
    const f = focusOf(dd, 4);
    T(f.some(x => x.kw === 'map' || x.kw === 'room'),
      '回归定向：rooms 变了 ⇒ 建议跑 ' + f.map(x => x.kw).join('/') + ' 相关套件');
    T(focusOf([], 4).length === 0, '回归定向：没变化 ⇒ 不硬塞关键词');
  }

  /* ⑦ 真数据：解析级快照跑得起来，房间数合理（防「脚本静默失败」） */
  {
    const ids = collectIds();
    const n = Object.keys(ids.rooms || {}).length;
    T(n > 400, '真数据 id 快照：rooms ' + n + ' 个（证明不是空壳 World）');
    let hashed = 0;
    for (const h of Object.values(ids.rooms)) if (h && h !== '?') hashed++;
    T(hashed === n, '每个房间都算出了 hash（' + hashed + '/' + n + '，没被循环引用卡住）');
  }

  /* ⑧ cycle 的「一步红就停」：第三步**必须根本没跑**
     用真的子进程验（不是模拟）—— 第三步跑完会写一个标记文件，
     断言标记文件不存在 = 它确实没被执行。 */
  {
    const bak = path.join(__dirname, '_bak');
    try { fs.mkdirSync(bak, { recursive: true }); } catch (_) { /* 已存在 */ }
    const mk = path.join(bak, '_cycle_marker.txt');
    try { fs.rmSync(mk, { force: true }); } catch (_) { /* 本来就没有 */ }
    const s1 = path.join(bak, '_step_ok.js'), s2 = path.join(bak, '_step_fail.js'), s3 = path.join(bak, '_step_ok2.js');
    fs.writeFileSync(s1, 'process.exit(0);\n', 'utf8');
    fs.writeFileSync(s2, "console.log('我故意红的'); process.exit(1);\n", 'utf8');
    fs.writeFileSync(s3, "require('fs').writeFileSync(" + JSON.stringify(mk) + ", 'ran');\nprocess.exit(0);\n", 'utf8');
    let res = null, threw = null;
    try {
      res = await runSteps([
        { label: '步1 应该过', file: '_bak/_step_ok.js', args: [] },
        { label: '步2 应该红', file: '_bak/_step_fail.js', args: [] },
        { label: '步3 不该被跑到', file: '_bak/_step_ok2.js', args: [] },
      ]);
    } catch (e) { threw = e; }
    T(!threw, 'cycle runSteps 跑得起来', threw ? String(threw.message) : '');
    T(!!res && res.ok === false, 'cycle 三步里有一步红 ⇒ 整体判失败', JSON.stringify(res && res.done));
    T(!!res && /步2/.test(res.failedAt || ''), 'cycle 报出**停在哪一步**（' + (res && res.failedAt) + '）');
    T(!!res && res.done.length === 2, 'cycle 红在步2 ⇒ 只跑了 2 步（' + (res ? res.done.length : '?') + '）');
    T(!fs.existsSync(mk), '★ cycle **步3 根本没被执行**（标记文件不存在 —— 一步红就停，不是跑完再报）');
    /* 反向对照：三步都绿 ⇒ 三步全跑 */
    const res2 = await runSteps([
      { label: 'a', file: '_bak/_step_ok.js', args: [] },
      { label: 'b', file: '_bak/_step_ok.js', args: [] },
    ]);
    T(res2.ok === true && res2.done.length === 2, '反向对照：全绿 ⇒ 两步都跑了（不误停）');
    try { fs.rmSync(mk, { force: true }); } catch (_) { /* 清不掉不碍事 */ }
    for (const f of [s1, s2, s3]) { try { fs.rmSync(f, { force: true }); } catch (_) { /* 同上 */ } }
  }

  /* ⑨ 批次性质判定：结构性 vs 文案（打印给人看，不替人决定） */
  {
    const base = { rooms: { r1: { _: 'x', name: h1('旧名'), desc: h1('旧文'), exits: h1({ n: 'a' }) } } };
    const onlyText = { rooms: { r1: { _: 'y', name: h1('新名'), desc: h1('新文'), exits: h1({ n: 'a' }) } } };
    const exitsChanged = { rooms: { r1: { _: 'y', name: h1('旧名'), desc: h1('旧文'), exits: h1({ n: 'b' }) } } };
    const addedRoom = { rooms: { r1: base.rooms.r1, r2: { _: 'z', name: h1('新'), desc: h1('新'), exits: h1({}) } } };
    const oldFmtB = { rooms: { r1: 'x' } };      // 旧快照：只有整条 hash
    const oldFmtA = { rooms: { r1: 'y' } };

    T(classifyBatch(base, onlyText).kind === '文案',
      '只改 name/desc ⇒ 判**文案批次**', classifyBatch(base, onlyText).kind);
    T(classifyBatch(base, exitsChanged).kind === '结构性',
      '★ 改了 exits ⇒ 判**结构性批次**', classifyBatch(base, exitsChanged).kind);
    T(classifyBatch(base, addedRoom).kind === '结构性',
      '★ rooms 有 id 增删 ⇒ 判**结构性批次**（硬判据）', classifyBatch(base, addedRoom).kind);
    T(/exits 变更/.test(classifyBatch(base, exitsChanged).reasons.join('|')),
      '结构性批次说得出**为什么**（理由里点名 exits）', classifyBatch(base, exitsChanged).reasons[0]);
    T(classifyBatch(base, base).kind === '文案',
      '反向对照：没变化 ⇒ 不判结构性（不误报）', classifyBatch(base, base).kind);
    /* ⚠️ 空的 diff 曾经也会打出「200 间一把过也行」—— 那等于拿一张空绿当放行条。
       判词里必须能区分「改了但只动文案」和「根本没检测到变化」。 */
    const empty = classifyBatch(base, base);
    T(empty.size === 0 && empty.reasons.some(r => /没有任何变化/.test(r)),
      '★ 没变化 ⇒ 规模 0 且理由里写明「没有任何变化」（不许拿空绿当「可以大批量」）',
      JSON.stringify(empty.reasons));
    T(classifyBatch(oldFmtB, oldFmtA).kind === '未知',
      '反向对照：旧格式快照（无字段级）⇒ 判**未知**，按最保守处理（不装作看得懂）',
      classifyBatch(oldFmtB, oldFmtA).kind);
    /* 理由不许无限长 —— 200 间一把改会刷屏 */
    const big = { rooms: {} };
    for (let i = 0; i < 60; i++) big.rooms['r' + i] = { _: 'a' + i, name: h1('n' + i), desc: h1('d' + i), exits: h1({ n: 'b' + i }) };
    const big2 = { rooms: {} };
    for (let i = 0; i < 60; i++) big2.rooms['r' + i] = { _: 'b' + i, name: h1('n' + i), desc: h1('d' + i), exits: h1({ n: 'c' + i }) };
    const vb = classifyBatch(big, big2);
    T(vb.kind === '结构性' && vb.size === 60, '60 间全改 exits ⇒ 结构性，规模 60（' + vb.size + '）');
  }

  console.log('\n  自测结果：' + pass + '/' + (pass + fail) + ' 通过');
  return fail === 0;
}

/* ================================================================ */
const mode = process.argv[2];
if (has('selftest')) selftest().then(okk => process.exit(okk ? 0 : 1));
if (mode === 'pre') cmdPre().catch(e => { console.error('pre 崩了：' + (e && e.message)); process.exit(3); });
else if (mode === 'post') cmdPost().catch(e => { console.error('post 崩了：' + (e && e.message)); process.exit(3); });
else if (mode === 'diff') cmdDiff();
else if (mode === 'cycle') cmdCycle().catch(e => { console.error('cycle 崩了：' + (e && e.message)); process.exit(3); });
else {
  console.log('用法：');
  console.log('  node tools/data-edit-cycle.js pre  --field npcs.talk --get npcs.<id>.talk.0');
  console.log('  node tools/data-edit-cycle.js post --get npcs.<id>.talk.0 --expect "<新值>"  [--run-regression]');
  console.log('  node tools/data-edit-cycle.js diff            # 只看「这次改了哪些 id」');
  console.log('  node tools/data-edit-cycle.js cycle [--gen tools/gen-x.js] [--only kw|--full]');
  console.log('  node tools/data-edit-cycle.js --selftest');
}
