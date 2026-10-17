#!/usr/bin/env node
/**
 * _audit_quest_deadends.js —— 任务断头路扫描（只读，不改任何数据）
 *
 * 扫 game/data/60_quests.json + 61_sidequests.json + 66_mainline_act45.json 的全部 quest，
 * 报三类半成品症状：
 *   ① 进行中无出路   E_NEXT_OOB / E_NEXT_EMPTY / E_TAIL_NO_99
 *   ② 可接但前置永假 E_GHOST_FLAG（require/cond/target 引用的 flag 全库无 setter）
 *   ③ 完成后无回响   E_NO_ECHO（questdone_<id> 没有任何读者）
 *
 * 唯一真相源：本脚本自己读磁盘 + 引擎侧写旗规则（character.js:845 setQuestStage(99) 置 questdone_<id>）。
 * 不引引擎实例——本单只查数据静态一致性，跑引擎是另一件事（避免把 load 失败混进结论）。
 *
 * 用法：
 *   node tools/_audit_quest_deadends.js              # 扫真实数据，打印摘要 + TSV
 *   node tools/_audit_quest_deadends.js --tsv <路径>  # TSV 另存
 *   node tools/_audit_quest_deadends.js --selftest    # 只跑已知答案样本自测
 *
 * 自测纪律（本文件自带 ⓪ 段）：判定器是纯函数，样本含 ≥1 命中、≥1 不命中；
 * 自测不过 ⇒ 本脚本不许拿来对数据下结论。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
/**
 * 扫描面：团队长点名 3 个文件是核心层；但全库另有 10 个分片也带 quests（共 290 条 vs 176 条）。
 * 只扫 3 个文件会把「漏扫」说成「干净」——所以默认全扫，摘要里分开报两个口径。
 */
const CORE_FILES = ['60_quests.json', '61_sidequests.json', '66_mainline_act45.json'];
/* ⚠️ arr 必须先声明：它原来在 QUEST_FILES 之后，questFiles() 里的 try/catch 把 TDZ 的
   ReferenceError 一起吞了 → 每个分片都被判「无 quest」→ 扩扫面静默变 0 条（假绿形态之一）。 */
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
function questFiles() {
  const extra = fs.readdirSync(DATA).filter((f) => f.endsWith('.json') && !CORE_FILES.includes(f))
    .filter((f) => {
      try { const j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); return j && arr(j.quests).length > 0; }
      catch (e) { return false; }
    });
  return { core: CORE_FILES, extra, all: CORE_FILES.concat(extra) };
}
const QUEST_FILES = questFiles().all;

/* ============ 纯判定器（自测直考） ============ */

/** ① 阶段 next 合法性：返回 [{code, at, detail}] */
function checkNext(q, file) {
  const out = [];
  const st = arr(q.stages);
  if (!st.length) return out;
  st.forEach((s, i) => {
    const n = s && s.next;
    const isLast = i === st.length - 1;
    if (n === undefined || n === null) {
      out.push(isLast
        ? { code: 'E_TAIL_NO_99', at: file + ':stages[' + i + ']', detail: '末阶段未显式写 next:99（隐式结束）' }
        : { code: 'E_NEXT_EMPTY', at: file + ':stages[' + i + ']', detail: '非末阶段没有 next，进行中卡死' });
      return;
    }
    if (n === 99) return;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n >= st.length)
      out.push({ code: 'E_NEXT_OOB', at: file + ':stages[' + i + ']', detail: 'next=' + JSON.stringify(n) + ' 指不到阶段（共 ' + st.length + ' 段）' });
  });
  return out;
}

/** 槽位化条件 → 引用的 flag / questDone / 目标 flag */
function collectRefs(cond, bag) {
  if (!cond || typeof cond !== 'object') return bag;
  if (typeof cond.flag === 'string') bag.flags.push(cond.flag);
  if (Array.isArray(cond.flag)) cond.flag.forEach((f) => typeof f === 'string' && bag.flags.push(f));
  if (Array.isArray(cond.flagsAny)) cond.flagsAny.forEach((f) => typeof f === 'string' && bag.flags.push(f));
  if (typeof cond.questDone === 'string') bag.done.push(cond.questDone);
  if (Array.isArray(cond.questDone)) cond.questDone.forEach((f) => typeof f === 'string' && bag.done.push(f));
  if (typeof cond.questNotDone === 'string') bag.notDone.push(cond.questNotDone);
  for (const k of ['or', 'and', 'not']) {
    const v = cond[k];
    if (Array.isArray(v)) v.forEach((c) => collectRefs(c, bag));
    else if (v && typeof v === 'object') collectRefs(v, bag);
  }
  return bag;
}

/** ② 幽灵旗：refs 里有、setters 里没有 */
function ghostFlags(refs, setters, engineSet) {
  const out = [];
  for (const f of new Set(refs)) {
    if (setters.has(f)) continue;
    if (engineSet && engineSet(f)) continue;
    out.push(f);
  }
  return out;
}

/**
 * raw 剧本 DSL 解析：`...;flag:jiuye_done;quest:q_main_sect:0` / `怎么过|硬闯>flag:taohua_passed`
 * 返回 { flags:[], quests:[] }。
 * 判据：起于串首或 ; | > 之后的 `flag:` / `quest:` / `questdone:`。
 * ⚠️ 已知局限：say 文本里若原样出现「flag:」会被误算成 setter（当前数据 0 例，真出现再收紧）。
 */
function parseDslSetters(s) {
  const out = { flags: [], quests: [] };
  if (typeof s !== 'string' || (!s.includes('flag:') && !s.includes('quest:'))) return out;
  const re = /(?:^|[;|>])\s*(flag|quest|questdone|unflag|clearflag)\s*:\s*([A-Za-z0-9_]+)/g;
  let m;
  while ((m = re.exec(s))) {
    const kind = m[1].toLowerCase(), name = m[2];
    if (kind === 'flag' || kind === 'questdone') out.flags.push(name === m[2] && kind === 'questdone' ? 'questdone_' + name : name);
    if (kind === 'quest') out.quests.push(name);
    if (kind === 'unflag' || kind === 'clearflag') out.flags.push(name); /* 写过就算有 owner，语义另论 */
  }
  return out;
}

/** ③ 无回响：questdone_<id> 无读者 */
function hasEcho(qid, readers, chainedFrom) {
  return readers.has(qid) || chainedFrom.has(qid);
}

/**
 * ③ 回响的「链」通道：**只在完成任务那一刻**被拉起的后续 quest 才算回响。
 * ⚠️ 这里踩过一次：把 NPC ask / 房间 action 里的 `quest:<id>` 也算成回响，
 *    结果「谁来发起这个任务」被误当成「这个任务完成后有后续」——
 *    发起 ≠ 回响。只认 quest 自己的 rewards / 各阶段 effects 里拉的链。
 */
function completionChains(q) {
  const out = [];
  const add = (effects) => {
    for (const e of arr(effects)) {
      if (!e || typeof e !== 'object') continue;
      const t = typeof e.type === 'string' ? e.type.toLowerCase() : '';
      const a0 = Array.isArray(e.args) && e.args[0] !== undefined ? e.args[0] : (typeof e.raw === 'string' ? e.raw : undefined);
      if (t === 'quest' && typeof a0 === 'string') out.push(a0);
      parseDslSetters(e.raw).quests.forEach((x) => out.push(x));
    }
  };
  add(q.rewards);
  for (const s of arr(q.stages)) add(s.effects);
  return out;
}

/** ③ 交任务当场有没有文本回应（rewards 的 say/narrate 或末段 effects 的 say/narrate） */
function immediateReply(q) {
  const txt = (e) => e && (e.type === 'say' || e.type === 'narrate') && typeof e.raw === 'string' && e.raw.trim();
  if (arr(q.rewards).some(txt)) return true;
  const st = arr(q.stages);
  const last = st[st.length - 1];
  if (last && arr(last.effects).some(txt)) return true;
  return false;
}

/** ③ 回响的另一条通道：奖励里置的 flag 有没有被别处条件读到 */
function rewardFlagEcho(q, flaggedReaders) {
  const outs = [];
  for (const e of arr(q.rewards)) {
    if (!e || typeof e.type !== 'string') continue;
    const t = e.type.toLowerCase();
    const a0 = Array.isArray(e.args) && e.args[0] !== undefined ? e.args[0] : (typeof e.raw === 'string' ? e.raw : undefined);
    if ((t === 'flag' || t === 'setflag') && typeof a0 === 'string') outs.push(a0);
    parseDslSetters(e.raw).flags.forEach((f) => outs.push(f));
  }
  return outs.filter((f) => flaggedReaders.has(f));
}

/* ============ 数据采集 ============ */

function walkParse(file, cb) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return; }
  cb(j);
}

/** 全库 setter / 读者采集：flags、questdone、quest 链 */
function buildIndex() {
  const setters = new Set();   /* 被写过的 flag 名 */
  const readersOfQ = new Set();/* 被 cond.questDone 读过的 quest id */
  const readFlags = new Set(); /* 被任何 cond/require 读过的 flag（回响的 flag 通道） */
  const chained = new Set();   /* 被 effect {type:'quest'} 拉起的 quest id */
  const files = [];
  for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) files.push(path.join(DATA, f));
  const MODS = path.join(ROOT, 'mods');
  if (fs.existsSync(MODS))
    for (const d of fs.readdirSync(MODS))
      for (const f of (() => { try { return fs.readdirSync(path.join(MODS, d)).filter((x) => x.endsWith('.json')); } catch (e) { return []; } })())
        files.push(path.join(MODS, d, f));

  for (const file of files) walkParse(file, (j) => {    const stack = [j];
    while (stack.length) {
      const o = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { for (const x of o) stack.push(x); continue; }
      /* 效果 setter / quest 链 */
      if (typeof o.type === 'string') {
        const t = o.type.toLowerCase();
        const a0 = Array.isArray(o.args) && o.args[0] !== undefined ? o.args[0] : (typeof o.raw === 'string' ? o.raw : undefined);
        if ((t === 'flag' || t === 'setflag') && typeof a0 === 'string') setters.add(a0);
        if ((t === 'questdone' || t === 'finishquest') && typeof a0 === 'string') setters.add('questdone_' + a0);
        if (t === 'quest' && typeof a0 === 'string') chained.add(a0);
      }
      /* raw 剧本 DSL setter：choice/script 的 raw 串里写 flag:x / quest:x（游有方 lane 大量使用） */
      const dsl = parseDslSetters(o.raw);
      dsl.flags.forEach((f) => setters.add(f));
      dsl.quests.forEach((q) => chained.add(q));
      /* 条件读者（cond / require 都是条件对象，用同一采集器） */
      const bag = { flags: [], done: [], notDone: [] };
      collectRefs(o.cond, bag); collectRefs(o.require, bag);
      bag.done.forEach((q) => readersOfQ.add(q));
      bag.flags.forEach((f) => readFlags.add(f));
      /* raw 字符串里的 questdone: 引用（mods 侧常见） */
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && /questdone\s*:/i.test(v)) {
          const m = v.match(/questdone\s*:\s*([A-Za-z0-9_]+)/i);
          if (m) readersOfQ.add(m[1]);
        }
        if (v && typeof v === 'object') stack.push(v);
      }
    }
  });
  /* 世界侧读者：房间动作 / NPC 动作的 cond 里引用 questdone_<id> —— 也算「世界记得你」。
     （2026-10-18 补：原判定只认 quest 内部 cond，会把我新挂的 12 处回响判成无回响。） */
  for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    const scanCond = (c) => {
      if (!c) return;
      const s = JSON.stringify(c);
      let m; const re = /questdone_([a-z0-9_]+)/g;
      while ((m = re.exec(s))) readersOfQ.add(m[1]);
    };
    for (const r of arr(j.rooms)) for (const a of arr(r && r.actions)) scanCond(a && a.cond);
    for (const n of arr(j.npcs)) for (const a of arr(n && n.actions)) scanCond(a && a.cond);
  }
  return { setters, readersOfQ, chained, readFlags, engineSet: makeEngineSet(), ...entityIndex() };
}

/**
 * 实体索引：item / npc / room 的库里真身，用来抓「目标指向不存在的东西」那一族。
 * 判据来源：20_items/61/66 的 items、40_npcs/101/61/66 的 npcs、全部带 rooms 的分片。
 */
function entityIndex() {
  const items = new Set(), npcs = new Set(), rooms = new Set();
  const bag = (o, set) => arr(o).forEach((x) => x && x.id && set.add(x.id));
  for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    bag(j.items, items); bag(j.npcs, npcs);
    if (j.rooms) Object.keys(j.rooms).forEach((r) => rooms.add(r));
    /* items 也可能是 id→def 的字典：键就是 id */
    if (j.items && !Array.isArray(j.items)) Object.keys(j.items).forEach((k) => items.add(k));
  }
  return { itemIds: items, npcIds: npcs, roomIds: rooms };
}

/**
 * 引擎代码里写死的 setter（静态数据扫不到，靠读源码确认，出处写在注释里）：
 *   character.js:541  learnSkill 成功 → setFlag('learned_' + skillId, true)
 *                     ⇒ 数据里 learned_X 只要 X 是真 skillId 就不是幽灵旗；
 *                       若 X 不存在（如 learned_jiuyang 这种简称），才是我要报的笔误。
 */
function makeEngineSet() {
  const skillIds = new Set();
  for (const f of ['10_skills.json', '83_arts.json', '85_sect_arts.json']) {
    const p = path.join(DATA, f);
    if (!fs.existsSync(p)) continue;
    walkParse(p, (j) => { for (const s of arr(j.skills || j.arts)) if (s && s.id) skillIds.add(s.id); });
  }
  return (flag) => {
    if (flag === 'learned_skill') return true;              /* character.js:542 最近学会的那门 */
    if (flag.startsWith('learned_')) return skillIds.has(flag.slice('learned_'.length));
    if (flag.startsWith('questdone_')) return true;          /* 完成即置，由本脚本 ③ 段验证 */
    return false;
  };
}

/* ============ 自测（已知答案样本） ============ */
function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c, got) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + '  « 实际: ' + JSON.stringify(got)); } };

  /* ① next 判定：1 命中 · 1 不命中 */
  const q1 = { stages: [{ next: 5 }, { next: 99 }] };          /* 指到第 5 段，共 2 段 → 命中 */
  const q2 = { stages: [{ next: 1 }, { next: 99 }] };          /* 合法链 → 不命中 */
  const q3 = { stages: [{ next: 1 }, {}] };                    /* 末段无 99 → E_TAIL_NO_99 */
  const r1 = checkNext(q1, 'f').map((x) => x.code);
  const r2 = checkNext(q2, 'f').map((x) => x.code);
  const r3 = checkNext(q3, 'f').map((x) => x.code);
  ok('① next=5/共2段 → E_NEXT_OOB（命中）', r1.includes('E_NEXT_OOB'), r1);
  ok('① next=1→99 合法链 → 无问题（不命中）', r2.length === 0, r2);
  ok('① 末段缺 99 → E_TAIL_NO_99（命中）', r3.includes('E_TAIL_NO_99'), r3);
  ok('① 非末段缺 next → E_NEXT_EMPTY（命中）', checkNext({ stages: [{}, { next: 99 }] }, 'f').map((x) => x.code).includes('E_NEXT_EMPTY'));

  /* ② 条件采集：嵌套 or / flagsAny / questDone */
  const bag = collectRefs({ or: [{ hasSect: true }, { flag: 'act1_recognized' }] }, { flags: [], done: [], notDone: [] });
  ok('② or 内 flag 被抓到', bag.flags.includes('act1_recognized'), bag.flags);
  ok('② flagsAny 逐个抓到', collectRefs({ flagsAny: ['a', 'b'] }, { flags: [], done: [], notDone: [] }).flags.length === 2);
  ok('② questDone 进 done 槽', collectRefs({ questDone: 'q_x' }, { flags: [], done: [], notDone: [] }).done.includes('q_x'));

  /* ② 幽灵旗判定：有 setter 放过 / 无 setter 命中 */
  const g1 = ghostFlags(['temple_searched'], new Set(['temple_searched']));
  const g2 = ghostFlags(['act1_recognized'], new Set(['temple_searched']));
  ok('② 有 setter 的旗不报（不命中）', g1.length === 0, g1);
  ok('② 无 setter 的旗要报（命中）', g2.length === 1 && g2[0] === 'act1_recognized', g2);
  ok('② 引擎按 learned_<skillId> 置的旗，skillId 存在 → 不报（不命中）',
    ghostFlags(['learned_jiuyang_shengong'], new Set(), (f) => f.startsWith('learned_') && f === 'learned_jiuyang_shengong').length === 0);
  ok('② learned_ 简称笔误（skillId 不存在）仍要报（命中）',
    ghostFlags(['learned_jiuyang'], new Set(), (f) => f === 'learned_jiuyang_shengong').length === 1);

  /* ② raw 剧本 DSL：真实数据里的三种写法各一条已知答案 */
  const d1 = parseDslSetters('（拦在车前）>flag:jiuye_fought;say:公文你也敢拦？;narrate:……;flag:know_east_depot;+item:depot_token_half;quest:q_main_sect:0');
  ok('② DSL 多段 ; 分隔 → flag 与 quest 都抓到（命中）',
    d1.flags.includes('jiuye_fought') && d1.flags.includes('know_east_depot') && d1.quests.includes('q_main_sect'), d1);
  const d2 = parseDslSetters('怎么过这个阵|硬闯过去>narrate:……;combat:mob_snake;flag:taohua_passed;flag:taohua_brute');
  ok('② DSL | > 分支后 flag 抓到（命中）', d2.flags.includes('taohua_passed') && d2.flags.includes('taohua_brute'), d2);
  const d3 = parseDslSetters('notFlag:jiuye_done');
  ok('② notFlag 是条件不是 setter → 不算（不命中）', d3.flags.length === 0, d3);

  /* ②b questDone 指到不存在的 quest：永假前置（命中 / 不命中各一） */
  const qids = new Set(['q_a', 'q_b']);
  ok('②b questDone 指向存在的 quest → 不报（不命中）',
    ['q_a'].filter((x) => !qids.has(x)).length === 0);
  ok('②b questDone 指向不存在的 quest → 要报（命中）',
    ['q_ghost'].filter((x) => !qids.has(x)).length === 1);

  /* ③ 回响判定：有读者放过 / 无读者命中 */
  ok('③ questdone 有 cond 读者 → 有回响（不命中）', hasEcho('q_a', new Set(['q_a']), new Set()) === true);
  ok('③ 无任何读者 → 无回响（命中）', hasEcho('q_b', new Set(['q_a']), new Set()) === false);
  ok('③ 被别的 quest 在完成时拉起 → 算回响（不命中）',
    completionChains({ rewards: [{ type: 'quest', args: ['q_c', 0] }] }).includes('q_c'));
  ok('③ 发起≠回响：NPC ask / 房间 action 里的 quest: 不进本判定（样例：quest 自身无完成链 → 空）',
    completionChains({ stages: [{ effects: [{ type: 'say', raw: '嗯。' }] }] }).length === 0);
  ok('③ 奖励置的 flag 被别处读 → 算回响（不命中）',
    rewardFlagEcho({ rewards: [{ type: 'flag', args: ['huashan_member'] }] }, new Set(['huashan_member'])).length === 1);
  ok('③ 奖励置的 flag 没人读 → 不算回响（命中）',
    rewardFlagEcho({ rewards: [{ type: 'flag', args: ['x_none'] }] }, new Set(['huashan_member'])).length === 0);

  console.log('\n自测 ' + pass + '/' + (pass + fail) + ' 通过' + (fail ? '  ✘ 判定器不可信，先修样本或判定器' : ''));
  return fail === 0;
}

/* ============ 主流程 ============ */
if (process.argv.includes('--selftest')) { process.exit(selftest() ? 0 : 1); }

console.log('⓪ 自测（判定器先自验，才许对数据下结论）');
if (!selftest()) { console.error('自测未过，终止。'); process.exit(1); }

console.log('\n§1 采集全库 setter / 读者 …（game/data + mods）');
const idx = buildIndex();
console.log('  setter 旗标 ' + idx.setters.size + ' 个 · questDone 读者 ' + idx.readersOfQ.size + ' 个 · quest 链起点 ' + idx.chained.size + ' 个');
console.log('  实体索引：item ' + idx.itemIds.size + ' · npc ' + idx.npcIds.size + ' · room ' + idx.roomIds.size
  + (idx.itemIds.size && idx.npcIds.size && idx.roomIds.size ? '' : '  ✘ 索引为空，实体类断言不成立'));
if (!idx.itemIds.size || !idx.npcIds.size || !idx.roomIds.size) { console.error('实体索引为空 → 拒绝用它下结论'); process.exit(1); }

const rows = [];
const quests = [];
for (const f of QUEST_FILES) {
  const file = path.join(DATA, f);
  if (!fs.existsSync(file)) { console.log('  ⚠ 缺文件 ' + f); continue; }
  walkParse(file, (j) => {
    for (const q of arr(j.quests)) quests.push({ f, q });
  });
}
const qf = questFiles();
const coreCount = quests.filter(({ f }) => CORE_FILES.includes(f)).length;
console.log('§2 扫描 quest ' + quests.length + ' 条（核心 3 文件 ' + coreCount + ' 条 + 其余 ' + qf.extra.length + ' 个分片 ' + (quests.length - coreCount) + ' 条）\n');

const qidSet = new Set(quests.map(({ q }) => q.id).filter(Boolean));
/* 完成链：别的 quest 在完成那一刻拉起的后续（发起≠回响，见 completionChains 注释） */
const chainTargets = new Set();
for (const { q } of quests) completionChains(q).forEach((x) => chainTargets.add(x));

for (const { f, q } of quests) {
  const qid = q.id || '?';
  /* ① 出路 */
  for (const p of checkNext(q, f)) rows.push({ qid, type: q.type || '', code: p.code, at: p.at, detail: p.detail });

  /* ② 幽灵旗（require + cond + target） */
  const refs = { flags: [], done: [], notDone: [] };
  collectRefs(q.require, refs);
  arr(q.stages).forEach((s, i) => {
    collectRefs(s.cond, refs);
    arr(s.targets).forEach((t) => { if (t.kind === 'flag' && typeof t.key === 'string') refs.flags.push(t.key); });
  });
  for (const g of ghostFlags(refs.flags, idx.setters, idx.engineSet))
    rows.push({ qid, type: q.type || '', code: 'E_GHOST_FLAG', at: f + ':require/cond/target', detail: '旗「' + g + '」全库无 setter' });

  /* ②b questDone 指到不存在的 quest → 前置永远假 */
  for (const d of new Set(refs.done))
    if (!qidSet.has(d))
      rows.push({ qid, type: q.type || '', code: 'E_DANGLING_QUESTDONE', at: f + ':require/cond', detail: 'questDone 指向不存在的 quest「' + d + '」' });

  /* ②c 目标 / 条件指向不存在的实体：item / mob / room —— 同样永假 */
  arr(q.stages).forEach((s, i) => {
    const where = f + ':stages[' + i + ']';
    for (const t of arr(s.targets)) {
      if (t.kind === 'item' && typeof t.key === 'string' && !idx.itemIds.has(t.key))
        rows.push({ qid, type: q.type || '', code: 'E_DANGLING_ITEM', at: where, detail: '目标物品「' + t.key + '」不在物品库' });
      if (t.kind === 'kill') {
        const ks = Array.isArray(t.keys) ? t.keys : t.key ? [t.key] : [];
        for (const k of ks) if (typeof k === 'string' && !idx.npcIds.has(k))
          rows.push({ qid, type: q.type || '', code: 'E_DANGLING_MOB', at: where, detail: '击杀目标「' + k + '」不在 NPC 库' });
      }
      if (t.kind === 'room' && typeof t.key === 'string' && !idx.roomIds.has(t.key))
        rows.push({ qid, type: q.type || '', code: 'E_DANGLING_ROOM', at: where, detail: '目标房间「' + t.key + '」不存在' });
    }
    if (s.cond && typeof s.cond.item === 'string' && !idx.itemIds.has(s.cond.item))
      rows.push({ qid, type: q.type || '', code: 'E_DANGLING_ITEM', at: where + '.cond', detail: '条件物品「' + s.cond.item + '」不在物品库' });
    if (s.cond && typeof s.cond.room === 'string' && !idx.roomIds.has(s.cond.room))
      rows.push({ qid, type: q.type || '', code: 'E_DANGLING_ROOM', at: where + '.cond', detail: '条件房间「' + s.cond.room + '」不存在' });
  });

  /* ③ 无回响：questdone 无人读、无人链 → 再看奖励置的 flag 有没有被别处条件读（第二条回响通道）
     分两档：连交任务当场都没文本 = BARE（掉分）；当场有回应但世界不记得 = QUIET（观感） */
  const viaFlag = rewardFlagEcho(q, idx.readFlags);
  if (!hasEcho(qid, idx.readersOfQ, chainTargets) && viaFlag.length === 0)
    rows.push({
      qid, type: q.type || '',
      code: immediateReply(q) ? 'E_NO_ECHO_QUIET' : 'E_NO_ECHO_BARE',
      at: f,
      detail: immediateReply(q)
        ? 'questdone_' + qid + ' 无读者、无后续；交任务已有当场回应，但世界不记得'
        : 'questdone_' + qid + ' 无读者、无后续；交任务当场也没有任何文本回应',
    });
}

/* 输出 */
const tsv = ['quest_id\ttype\tcode\tlocate\tdetail', ...rows.map((r) => [r.qid, r.type, r.code, r.at, r.detail].join('\t'))].join('\n') + '\n';
const ti = process.argv.indexOf('--tsv');
const outPath = ti > -1 ? path.resolve(ROOT, process.argv[ti + 1]) : path.join(ROOT, '.livetest', 'quest-deadends.tsv');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, tsv, 'utf8');

const byCode = {};
for (const r of rows) byCode[r.code] = (byCode[r.code] || 0) + 1;
const cls = {
  '① 进行中无出路': ['E_NEXT_OOB', 'E_NEXT_EMPTY', 'E_TAIL_NO_99'],
  '② 可接但前置永假': ['E_GHOST_FLAG', 'E_DANGLING_QUESTDONE', 'E_DANGLING_ITEM', 'E_DANGLING_MOB', 'E_DANGLING_ROOM'],
  '③ 完成后无回响': ['E_NO_ECHO_BARE', 'E_NO_ECHO_QUIET'],
};
console.log('§3 摘要');
for (const [name, codes] of Object.entries(cls)) {
  const n = codes.reduce((s, c) => s + (byCode[c] || 0), 0);
  const detail = codes.map((c) => c + '=' + (byCode[c] || 0)).join(' ');
  console.log('  ' + name + '：' + n + ' 条   （' + detail + '）');
}
console.log('  合计 ' + rows.length + ' 条 → ' + path.relative(ROOT, outPath));

/* 幽灵旗去重清单（团队长点名要能自动扫出这一族） */
const ghosts = [...new Set(rows.filter((r) => r.code === 'E_GHOST_FLAG').map((r) => (r.detail.match(/「(.+?)」/) || [])[1]))];
console.log('\n§4 幽灵旗清单（' + ghosts.length + ' 个）：' + (ghosts.join(', ') || '无'));
process.exit(0);
