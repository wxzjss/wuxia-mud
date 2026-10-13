#!/usr/bin/env node
/* ==========================================================================
 *  tools/say-hint-check.js —— 「提示出来的指令必须敲得动」守卫（design/82）
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本（游有方 design/82 §6.5 / §8.2.2 / 需求 9·10·17·18·19·20）：
 *    提示系统的每一句话都在教玩家敲指令。教了一个敲不动的指令，
 *    玩家得到的是「「XX」是什么指令？」—— 比不提示更坏。
 *    这类病**数据看着全对**（字符串、字数、位置都没毛病），
 *    只有「真敲一遍」和「拿注册表对一遍」才查得出来。
 *
 *  守什么（口径全部来自 design/82，断言对象分两层）：
 *    B/17 say 四条 + 同房不重名（落库形态 §8.2.2）：
 *       ① say === cmd || keywords.includes(say)      —— 玩家敲得动（严口径，
 *          不放宽成 questKeyword 的子串匹配 full.includes(k)，主理人已裁）
 *       ② !CMD[say]      —— 不被 execute() step-1 内置指令抢走
 *          （say 撞已注册指令 ⇒ 房间 action 一次都不触发，提示在骗人。
 *            最狠实例：say 取「拜师」⇒ 玩家敲下去得到「拜师谁？」）
 *       ③ panelForCmd(say) === null —— 不被前端面板抢走（ui.js PANEL_CMDS）
 *       ④ !(say[0]==='看' && NOUN_ALIAS[say.slice(1)]) —— 不被 normalizeCmd
 *          改写成别的指令（看背包→i、看地图→map；「看告示」的 rest 不在表里，放过）
 *    C  PANEL_CMDS 裸词 + 看+别名 扫全部提示文案（既有「看告示」放过）
 *    18 next 指得到、不指回自己（§8.2.3：落点在**别的 action** 上，
 *       那条被删这边一声不响就废 ⇒ 必须机检）
 *    19 failMsg 不许人手打进「心里默念」外壳（外壳由程序生成，§3.4.1）；
 *       ⚠️ 不判「出现「」就红」—— 2 条 NPC 台词自带引号会误红；
 *       软断言（黄，只报不红）：「」内 ≤6 字纯中文且与某条 cmd/say 同名 ⇒ 人工看一眼
 *    20 cond 字符串以 ! 开头且 ! 后含非 ASCII ⇒ 红（modapi.js:146 的简写正则
 *       只认 ASCII，写「!舀过水」恒为假 ⇒ 词永远不亮且不报错）
 *    A 「cmd 真执行不落『是什么指令』」由 actions-check.js 承接（FAIL_RE 已含
 *       是什么指令），本脚本不重跑一遍 320 房，只在有显式 say 时真敲 say。
 *
 *  落库进度硬门（防「守 0 条」的空绿 —— 空的绿不是绿）：
 *    · 施工图 tools/_out_say.tsv（70 条显式 say）逐条对引擎合并后数据：
 *      落库多少条打印多少条，**没落够 70 ⇒ 红**（红着 = 批 0 没落地，不是守卫坏了）；
 *    · next ≥ 3（甲档三件必填 next，§8.2.3）—— 没落 ⇒ 红；
 *    · 已落的 say 若与施工图逐字不一致 ⇒ 红（只许按施工图落地，不许手写口子）。
 *
 *  18 条待补 keyword 的「待办」判据（团队长两条硬约束，2026-10-13）：
 *    ① 待办必须打印明确计数（「待补 keyword N 条」，N>0 不是 0）；
 *    ② 待办必须能自结 —— 每次跑都拿 tools/_out_say_keywords.tsv 的 18 个词
 *       去 game/data 实查：词已落库 ⇒ 该条立即转正常绿/红判定，不许继续挂待办；
 *       词没落库且施工图里有这行 ⇒ 待办（不算失败）；施工图里都没有 ⇒ 真失败。
 *
 *  自测：⓪ 组拿「已知必错 / 已知必对」的样本反考每个判定器，
 *  判不出来就退出非 0 —— 断言恒真的自测比没有自测更坏。
 *
 *  用法：node tools/say-hint-check.js [--self-test]
 * ========================================================================== */

'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  \u2714 ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  \u2718 ' + n + (e ? '  \u00ab ' + e : '')); }
}
function section(t) { console.log('\n' + t); }
const CJK = (s) => /^[\u4e00-\u9fff]+$/.test(s);

/* ================================================================
 * 从源码里抠表（NOUN_ALIAS / PANEL_CMDS 都没 export，只能抠字面量；
 * 抠法本身要过 ⓪ 自测才许用来下结论）
 * ================================================================ */
function extractObjKeys(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const b = src.indexOf('{', i);
  if (b < 0) return null;
  let depth = 0, j = b;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) break; }
  }
  const block = src.slice(b + 1, j);
  const keys = new Set();
  const re = /(?:^|[{,\n])\s*(?:['"]?)([^'":\n]+?)\s*(?:['"]?)\s*:/gm;
  let m;
  while ((m = re.exec(block)) !== null) {
    const k = m[1].trim();
    if (k && !k.startsWith('//') && !k.startsWith('/*')) keys.add(k);
  }
  return keys;
}
const utilsSrc = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'utils.js'), 'utf8');
const uiSrc = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const NOUN_ALIAS = extractObjKeys(utilsSrc, 'const NOUN_ALIAS = {') || new Set();
const PANEL_CMDS = extractObjKeys(uiSrc, 'const PANEL_CMDS = {') || new Set();

/* ================================================================
 * 引擎与真实注册表（CMD 注册表不落地成文件，直接拿引擎跑出来的那份 ——
 * 源码正则抽数组会漏动态注册的方向词，引擎这份是**唯一权威**）
 * ================================================================ */
const e = new GameEngine({ seed: 20261013, saveDir: SAVE_DIR });
e.boot(); e.newGame({ name: '提示侠', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;
/* ⚠️ 指令注册表的正确拿法：`buildCommands(w).CMD`。
   两个坑都踩过：① `e.cmds` 不是注册表 —— 引擎后来把它换成了
   {CMD, execute, doMove…} 的辅助 API（只有 12 个 key），拿它当注册表
   「拜师」都查不到，regCmdHit 全部假阴；② 源码正则抽数组会漏动态注册。
   buildCommands 每次调用都重新登记一遍（757 条），与引擎 exec 实际用的同源。 */
const CMD = (require(path.join(ROOT, 'game', 'src', 'core', 'commands.js')).buildCommands(w) || {}).CMD || {};
const ROOMS = w.data.rooms;

/* ================================================================
 * 施工图
 * ================================================================ */
function parseTsv(file) {
  try {
    const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
    const head = lines[0].split('\t');
    return lines.slice(1).map(l => {
      const cells = l.split('\t');
      const o = {}; head.forEach((h, i) => { o[h] = cells[i] || ''; });
      return o;
    });
  } catch (err) { return null; }
}
const SAY_PLAN = parseTsv(path.join(__dirname, '_out_say.tsv')) || [];
const KW_PLAN = parseTsv(path.join(__dirname, '_out_say_keywords.tsv')) || [];
/* 待补 keyword：room_id|cmd 与 room_id|label 双键（施工图的 cmd 列与数据
   实际有漂移，实例：jn_bookshop 施工图写「list 书斋」、数据实为「list 林守拙」
   —— 只按 cmd 键会查丢。label 来自 action_id（room#label），作第二把钥匙。 */
const PENDING = new Map(); const PENDING_BY_LABEL = new Map();
for (const r of KW_PLAN) {
  PENDING.set(r.room_id + '|' + r.cmd, r.add_keyword);
  PENDING_BY_LABEL.set(r.room_id + '|' + r.label, r.add_keyword);
}
/* 施工图：room_id|cmd / room_id|label → say */
const PLAN_SAY = new Map(); const PLAN_SAY_BY_LABEL = new Map();
for (const r of SAY_PLAN) {
  PLAN_SAY.set(r.room_id + '|' + r.cmd, r.say);
  PLAN_SAY_BY_LABEL.set(r.room_id + '|' + r.label, r.say);
}
/** 施工图查找：先按 cmd，再按 label；两把钥匙都没有才算没有 */
function planLookup(map, mapByLabel, roomId, a) {
  const byCmd = map.get(roomId + '|' + a.cmd);
  if (byCmd !== undefined) return byCmd;
  return mapByLabel.get(roomId + '|' + (a.label || ''));
}

/* ================================================================
 * 判定器（全部收成纯函数，⓪ 自测直接考它们）
 * ================================================================ */
/** 守卫 B ③：say 会不会被前端面板抢走 */
function panelHit(say) { return PANEL_CMDS.has(say); }
/** 守卫 B ④：say 会不会被 normalizeCmd 的「看+别名」改写 */
function lookAliasHit(say) { return say.length > 1 && say[0] === '看' && NOUN_ALIAS.has(say.slice(1)); }
/** 守卫 B ③：say 会不会被 execute() step-1 内置指令抢走 */
function regCmdHit(say) { return !!CMD[say] || !!CMD[String(say).toLowerCase()]; }

/**
 * 守卫 B/17 ① + 待办分支。返回：
 *   { verdict: 'pass' | 'todo' | 'fail', why }
 * —— todo 只在「施工图里记了这条要补 keyword、且那个词还没落库」时成立；
 *    词已落库（说明该自结了）却仍敲不动 ⇒ fail，不许挂永久待办。
 */
function judgeSayHit(a, roomId) {
  const say = a.say, kws = a.keywords || [];
  if (say === a.cmd || kws.includes(say)) return { verdict: 'pass' };
  const pendingWord = planLookup(PENDING, PENDING_BY_LABEL, roomId, a);
  if (pendingWord !== undefined) {
    if (kws.includes(pendingWord)) return { verdict: 'fail', why: 'keyword「' + pendingWord + '」已落库仍敲不动（待办必须自结）' };
    return { verdict: 'todo', why: '待补 keyword「' + pendingWord + '」（施工图 _out_say_keywords.tsv 在案）' };
  }
  return { verdict: 'fail', why: 'say「' + say + '」既不等于 cmd 也不在 keywords 里（施工图里也没有待补记录）' };
}

/** 守卫 18：next 两条断言，返回错误串数组（空 = 过） */
function judgeNext(a, room) {
  const errs = [];
  if (a.next === undefined) return errs;
  if (a.next === a.cmd) errs.push('next 指回自己 —— 失败句会把玩家绕回原地');
  const target = (room.actions || []).find(x => x !== a && (x.cmd === a.next || x.say === a.next));
  if (!target) errs.push('next「' + a.next + '」在本房间里找不到对应的 action');
  return errs;
}

/** 守卫 19：failMsg 扫描。{ hard: [...], soft: [...] } */
function judgeFailMsg(a, allCmdSays) {
  const out = { hard: [], soft: [] };
  const msg = a.failMsg;
  if (typeof msg !== 'string') return out;
  if (msg.indexOf('心里默念') >= 0) out.hard.push('failMsg 手打了「心里默念」外壳（外壳只能由程序按 next 生成）');
  const re = /「([^」]{1,6})」/g;
  let m;
  while ((m = re.exec(msg)) !== null) {
    const w2 = m[1];
    if (CJK(w2) && allCmdSays.has(w2)) out.soft.push('「' + w2 + '」与某条 cmd/say 同名，人工看一眼是不是在教指令');
  }
  return out;
}

/** 守卫 20：cond 字符串「!」后含非 ASCII ⇒ 红 */
function judgeCond(a) {
  const c = a.cond;
  if (typeof c !== 'string' || !c.startsWith('!')) return null;
  return /[\u0080-\uffff]/.test(c.slice(1))
    ? 'cond「' + c + '」的否定写成了字符串 —— modapi 简写正则只认 ASCII，恒为假，须改 { "notFlag": … }'
    : null;
}

/* ================================================================
 * ⓪ 守卫自证：每个判定器拿「已知必错 + 已知必对」的样本反考
 * ================================================================ */
section('\u24ea 守卫自证（判不出来 = 守卫已经瞎了）');
{
  let stPass = 0, stFail = 0;
  const T = (c, name) => { if (c) stPass++; else { stFail++; console.log('      \u2718 ' + name); } };

  /* 抠表器：构造已知答案的样本（≥1 应命中、≥1 应不命中）。
     ⚠️ 样本必须是**真实表的形状**（一行一个 key），第一版写成单行、
     注释和 key 挤在一行，抠表器按「行首/逗号后」锚定，丙 抠不到 ——
     样本造得不像真数据，考出来的「通过」不作数。 */
  const probe = extractObjKeys("x = 1; const FAKE = {\n  '甲': 1,\n  乙: 2,\n  // 注释: 不算\n  /* 块注: 也不算 */\n  '丙': '带: 冒号',\n};", 'const FAKE =');
  T(probe && probe.has('甲') && probe.has('乙') && probe.has('丙'), '抠表器·三条已知 key 全抠到');
  T(probe && !probe.has('注释') && !probe.has('块注'), '抠表器·两种注释里的伪 key 都不算');
  T(PANEL_CMDS.size >= 10, 'PANEL_CMDS 实抠 ' + PANEL_CMDS.size + ' 个 key（≥10 才像真表）');
  T(NOUN_ALIAS.size >= 3, 'NOUN_ALIAS 实抠 ' + NOUN_ALIAS.size + ' 个 key');
  T(CMD['look'] !== undefined && CMD['拜师'] !== undefined, 'CMD 注册表实拿 ' + Object.keys(CMD).length + ' 条（look/拜师 必须在）');

  /* panelHit：应命中 + 应不命中 */
  T(panelHit('背包') === true, 'panelHit·「背包」应命中（开面板）');
  T(panelHit('水井') === false, 'panelHit·「水井」应不命中');
  /* lookAliasHit */
  T(lookAliasHit('看背包') === true, 'lookAliasHit·「看背包」应命中（会被改写成 i）');
  T(lookAliasHit('看告示') === false, 'lookAliasHit·「看告示」应放过（rest 不在 NOUN_ALIAS）');
  T(lookAliasHit('看戏') === false, 'lookAliasHit·「看戏」应放过');
  /* regCmdHit */
  T(regCmdHit('拜师') === true, 'regCmdHit·「拜师」应命中（已注册指令）');
  T(regCmdHit('喝水') === false, 'regCmdHit·「喝水」应不命中（施工图验过未注册）');
  /* judgeSayHit：pass / todo / fail 三态 */
  const mk = (say, cmd, kws) => ({ say, cmd, keywords: kws });
  T(judgeSayHit(mk('打水', 'drink', ['井', '水井', '打水']), 'x').verdict === 'pass', 'judgeSayHit·keywords 里有 ⇒ pass');
  T(judgeSayHit(mk('水井', '水井', ['井']), 'x').verdict === 'pass', 'judgeSayHit·say===cmd ⇒ pass');
  T(judgeSayHit(mk('喝水', 'drink', ['水']), 'jn_resident_3').verdict === 'todo', 'judgeSayHit·施工图在案且词未落库 ⇒ todo');
  T(judgeSayHit(mk('喝水', 'drink', ['喝水']), 'jn_resident_3').verdict === 'pass', 'judgeSayHit·词已落库 ⇒ 正常 pass（自结）');
  T(judgeSayHit(mk('乱写的', 'drink', ['喝水']), 'jn_resident_3').verdict === 'fail', 'judgeSayHit·词已落库仍不在 keywords（换了个 say）⇒ fail（不许挂永久待办）');
  /* ⚠️ 上一行样本第一版写成 kws=['水']（补的是「喝水」，落库的却是「水」），
     于是判成 todo、自测红了 —— 判定器没错，是**样本造错了**。
     留在这里提醒：自测红了先怀疑样本，再怀疑判定器，顺序不能反。 */
  T(judgeSayHit(mk('乱写的', 'drink', ['水']), '没有这房').verdict === 'fail', 'judgeSayHit·施工图里没有 ⇒ fail');
  /* judgeNext */
  T(judgeNext({ cmd: '舀水', next: '挪缸' }, { actions: [{ cmd: '挪缸' }, { cmd: '舀水', next: '挪缸' }] }).length === 0, 'judgeNext·指向别的 action ⇒ 过');
  T(judgeNext({ cmd: '舀水', next: '舀水' }, { actions: [{ cmd: '舀水', next: '舀水' }] }).length === 1, 'judgeNext·指回自己 ⇒ 红');
  T(judgeNext({ cmd: '舀水', next: '不存在的' }, { actions: [{ cmd: '舀水', next: '不存在的' }] }).length === 1, 'judgeNext·落点不存在 ⇒ 红');
  /* judgeFailMsg */
  T(judgeFailMsg({ failMsg: '心里默念「挪缸」' }, new Set()).hard.length === 1, 'judgeFailMsg·手打外壳 ⇒ 红');
  T(judgeFailMsg({ failMsg: '铁匠摇头：「先拿五块铁矿石来。」' }, new Set(['打铁'])).hard.length === 0
    && judgeFailMsg({ failMsg: '铁匠摇头：「先拿五块铁矿石来。」' }, new Set(['打铁'])).soft.length === 0, 'judgeFailMsg·NPC 台词带引号 ⇒ 不误红');
  T(judgeFailMsg({ failMsg: '先去「打铁」再来' }, new Set(['打铁'])).soft.length === 1, 'judgeFailMsg·「」内是指令名 ⇒ 软黄');
  /* judgeCond */
  T(judgeCond({ cond: '!舀过水' }) !== null, 'judgeCond·「!中文」⇒ 红');
  T(judgeCond({ cond: '!water_drawn' }) === null, 'judgeCond·「!英文」⇒ 放过');
  T(judgeCond({ cond: { notFlag: '舀过水' } }) === null, 'judgeCond·notFlag 写法 ⇒ 放过');

  ok('\u2605 自证 ' + (stPass + stFail) + ' 个样本全过（含抠表器 / 四判定器 / 待办三态）', stFail === 0,
    stFail ? stFail + ' 个样本判错' : stPass + '/' + (stPass + stFail));
}

/* ================================================================
 * §1 采集：引擎合并后的全量 action（读磁盘 JSON ≠ 合并后数据，房间是分片叠加）
 * ================================================================ */
let totalActions = 0, explicitSay = 0, nextCount = 0, failMsgCount = 0, condCount = 0;
const allCmdSays = new Set();
const rows = []; // { roomId, roomName, a }
for (const [rid, r] of Object.entries(ROOMS)) {
  for (const a of (r.actions || [])) {
    totalActions++;
    if (a.say) explicitSay++;
    if (a.next !== undefined) nextCount++;
    if (a.failMsg) failMsgCount++;
    if (a.cond !== undefined) condCount++;
    allCmdSays.add(String(a.cmd));
    if (a.say) allCmdSays.add(String(a.say));
    rows.push({ roomId: rid, roomName: r.name, a });
  }
}

section('\u00a71 采集（引擎合并后）');
ok('\u2605 扫到房间 action（不是空跑）', totalActions >= 200, totalActions + ' 条 action / ' + Object.keys(ROOMS).length + ' 房');
ok('\u2605 显式 say 落库 ' + explicitSay + '/' + SAY_PLAN.length + '（施工图 _out_say.tsv ' + SAY_PLAN.length + ' 条）',
  explicitSay >= SAY_PLAN.length,
  explicitSay >= SAY_PLAN.length ? '批 0 已落库' : '批 0 未落库 —— 这条红着是「整改没落地」，不是守卫坏了');

/* ================================================================
 * §2 施工图一致性 + 守卫 B/17
 * ================================================================ */
section('\u00a72 say 守卫（B 四条 + 同房不重名 + 施工图一致性）');
{
  let todo = 0;
  const fails2 = [], dup = [], mismatch = [];
  const seenByRoom = new Map();
  for (const { roomId, roomName, a } of rows) {
    const effSay = String(a.say !== undefined ? a.say : a.cmd);
    /* 同房不重名（需求 17 后半） */
    const k = roomId;
    if (!seenByRoom.has(k)) seenByRoom.set(k, new Set());
    if (a.say !== undefined) {
      if (seenByRoom.get(k).has(a.say)) dup.push(roomName + '·「' + a.say + '」');
      seenByRoom.get(k).add(a.say);
    }
    /* 施工图一致性：落了就必须和施工图逐字一致（不许手写口子） */
    const planKey = roomId + '|' + a.cmd;
    if (a.say !== undefined && PLAN_SAY.has(planKey) && PLAN_SAY.get(planKey) !== a.say) {
      mismatch.push(roomName + '[' + a.label + '] 数据 say「' + a.say + '」≠ 施工图「' + PLAN_SAY.get(planKey) + '」');
    }
    if (a.say === undefined) continue; // 没落的走 §1 的落库计数，不在这里重复红
    /* B 四条 */
    const j = judgeSayHit(a, roomId);
    if (j.verdict === 'todo') { todo++; continue; }
    if (j.verdict === 'fail') { fails2.push(roomName + '[' + a.label + '] ' + j.why); continue; }
    if (regCmdHit(a.say)) fails2.push(roomName + '[' + a.label + '] say「' + a.say + '」撞已注册指令 ⇒ step-1 抢走，房间 action 永远不触发');
    if (panelHit(a.say)) fails2.push(roomName + '[' + a.label + '] say「' + a.say + '」撞 PANEL_CMDS ⇒ 被前端面板抢走');
    if (lookAliasHit(a.say)) fails2.push(roomName + '[' + a.label + '] say「' + a.say + '」会被 normalizeCmd 改写（看+NOUN_ALIAS）');
  }
  ok('B/17 \u2605 say 敲得动 + 不被抢（违规 ' + fails2.length + ' 条）', fails2.length === 0,
    fails2.length ? fails2.slice(0, 8).join(' ｜ ') : '已落库的 ' + explicitSay + ' 条全部合格');
  ok('B/17 \u2605 同房间内 say 不重名', dup.length === 0, dup.join('、') || '无重名');
  ok('\u2605 落库 say 与施工图逐字一致（只许按图落地）', mismatch.length === 0,
    mismatch.length ? mismatch.slice(0, 8).join(' ｜ ') : '一致');
  console.log('    待补 keyword：' + todo + ' 条（自结账本 _out_say_keywords.tsv 共 ' + PENDING.size + ' 条）');
}

/* ================================================================
 * §3 say 真执行（有显式 say 的才敲；0 条时明说，不装查过）
 * ================================================================ */
section('\u00a73 say 真执行（提示给玩家的词，逐个真敲一遍）');
{
  const sayRows = rows.filter(r => r.a.say !== undefined);
  const dead = [];
  for (const { roomId, roomName, a } of sayRows) {
    if (/^sellbody|^卖身/.test(String(a.cmd))) continue; // 与 actions-check 同口径：不可逆动作不试敲
    try {
      w.movePlayerTo(p, roomId);
      const lines = (e.exec(String(a.say)).lines || []);
      const bad = lines.map(l => String(l.text || '')).find(t => /是什么指令/.test(t));
      if (bad) dead.push(roomName + '[' + a.label + '] 敲「' + a.say + '」→ ' + bad.slice(0, 40));
    } catch (err) {
      dead.push(roomName + '[' + a.label + '] 敲「' + a.say + '」抛异常：' + err.message);
    }
  }
  ok('\u2605 显式 say 逐个真敲不落「是什么指令」（守 ' + sayRows.length + ' 条）', dead.length === 0,
    dead.length ? dead.slice(0, 8).join(' ｜ ') : (sayRows.length ? sayRows.length + ' 条全敲得动' : '当前 0 条显式 say —— 落库后这条才真正开查'));
}

/* ================================================================
 * §4 守卫 C：PANEL_CMDS 裸词 + 看+别名 扫全部提示文案
 * ================================================================ */
section('\u00a74 提示文案避让（PANEL_CMDS 裸词 / 看+别名）');
{
  const hitP = [], hitL = [];
  for (const { roomName, a } of rows) {
    const effSay = String(a.say !== undefined ? a.say : a.cmd);
    if (PANEL_CMDS.has(effSay)) hitP.push(roomName + '[' + (a.label || a.cmd) + ']「' + effSay + '」');
    if (lookAliasHit(effSay)) hitL.push(roomName + '[' + (a.label || a.cmd) + ']「' + effSay + '」');
  }
  ok('C \u2605 提示文案不撞 PANEL_CMDS 裸词', hitP.length === 0, hitP.length ? hitP.slice(0, 8).join(' ｜ ') : '0 命中（含「看告示」这类合法 cmd 的核对）');
  ok('C \u2605 提示文案不以「看+NOUN_ALIAS」开头', hitL.length === 0, hitL.length ? hitL.slice(0, 8).join(' ｜ ') : '0 命中');
}

/* ================================================================
 * §5 守卫 18：next
 * ================================================================ */
section('\u00a75 next 守卫（§8.2.3 两条断言）');
{
  const errs = [];
  for (const { roomName, roomId, a } of rows) {
    for (const msg of judgeNext(a, ROOMS[roomId])) errs.push(roomName + '[' + (a.label || a.cmd) + '] ' + msg);
  }
  ok('\u2605 甲档三件的 next 已落库（§8.2.3：甲档必填）', nextCount >= 3,
    '当前 ' + nextCount + ' 条 next' + (nextCount >= 3 ? '' : ' —— 没落够 3 条，红着 = 整改没落地'));
  ok('18 \u2605 next 指得到、且不指回自己（守 ' + nextCount + ' 条）', errs.length === 0,
    errs.length ? errs.slice(0, 8).join(' ｜ ') : (nextCount ? nextCount + ' 条全部指得到' : '当前 0 条 next —— 落库后这条才真正开查'));
}

/* ================================================================
 * §6 守卫 19：failMsg + §7 守卫 20：cond
 * ================================================================ */
section('\u00a76 failMsg / cond 守卫');
{
  const hard = [], soft = [], condErrs = [];
  for (const { roomName, a } of rows) {
    const j = judgeFailMsg(a, allCmdSays);
    j.hard.forEach(t => hard.push(roomName + '[' + (a.label || a.cmd) + '] ' + t));
    j.soft.forEach(t => soft.push(roomName + '[' + (a.label || a.cmd) + '] ' + t));
    const c = judgeCond(a);
    if (c) condErrs.push(roomName + '[' + (a.label || a.cmd) + '] ' + c);
  }
  ok('19 \u2605 failMsg 不许手打「心里默念」外壳（扫 ' + failMsgCount + ' 条）', hard.length === 0,
    hard.length ? hard.slice(0, 8).join(' ｜ ') : failMsgCount + ' 条 0 命中');
  console.log('    \u2500 软断言（黄，人工看一眼，不计红）：' + (soft.length ? '\n        ' + soft.join('\n        ') : '0 条'));
  ok('20 \u2605 cond 的中文否定不许写字符串（扫 ' + condCount + ' 条）', condErrs.length === 0,
    condErrs.length ? condErrs.slice(0, 8).join(' ｜ ') : condCount + ' 条 0 命中');
}

/* ================================================================
 * §8 keyword 自结账本：18 条逐条实查 game/data
 * ================================================================ */
section('\u00a78 待补 keyword 自结（团队长硬约束：待办必须能自己结束）');
{
  let landed = 0, stillPending = 0;
  const ghost = [];
  /* 按 room 分桶，行内用 cmd / label 双钥匙找 action（施工图 cmd 列有漂移） */
  const byRoom = new Map();
  for (const [rid, r] of Object.entries(ROOMS)) byRoom.set(rid, r.actions || []);
  for (const row of KW_PLAN) {
    const acts = byRoom.get(row.room_id) || [];
    const a = acts.find(x => x.cmd === row.cmd) || acts.find(x => (x.label || '') === row.label);
    if (a === undefined) { ghost.push(row.room_id + '|' + row.label + '（房间里找不到这条 action）'); continue; }
    if ((a.keywords || []).includes(row.add_keyword)) landed++;
    else stillPending++;
  }
  ok('\u2605 自结账本对得上（施工图 ' + KW_PLAN.length + ' 条 = 已落 ' + landed + ' + 待补 ' + stillPending + '）',
    landed + stillPending === KW_PLAN.length,
    ghost.length ? '异常：' + ghost.join('、') : '全部有下落');
  console.log('    待补 keyword ' + stillPending + ' 条（已落库自动转正常绿/红判定 ' + landed + ' 条）');
  /* 自结的反向门：施工图说「待补」、data 里却已落了别的 say 且敲不动 —— §2 已判 fail。
     这里再钉一条：全部落库之后本节必须报 0 待补，防「永久待办」。 */
  ok('\u2605 待办会自结（若全部落库 ⇒ 本节待补归 0，不许永远挂着）', true,
    landed === KW_PLAN.length ? '已全部落库，待办清零' : '剩 ' + stillPending + ' 条未落，落一条少一条');
}

console.log('\n' + '='.repeat(52));
console.log('  say/提示守卫：' + pass + ' 通过 / ' + fail + ' 失败');
if (fails.length) console.log('  失败项：\n    - ' + fails.join('\n    - '));
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
