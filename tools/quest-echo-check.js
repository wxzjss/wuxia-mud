#!/usr/bin/env node
/* ==========================================================================
 *  tools/quest-echo-check.js —— 「江湖记得你」回声层守卫（2026-10-18）
 *
 * 判据（team-lead 派单 + design/110 §三.1 池子口径）：
 *   E1 没有完成任何任务 → 一声不响（不刷空话）
 *   E2 有完成 + 有池 → 出回声，{name} 占位替换成玩家名
 *   E3 同区权重 ×3：同区句子被选中的占比显著高于外区（加权，不是硬筛）
 *   E4 频次：冷却 20–30 tick（600–900 分钟），冷却内一声不出
 *   E5 不污染传闻账：world.rumors / p.reputation 一个字节都不动
 *   E6 近期完成 ×2：近 5 条完成内的句子更常被选
 *   E7 数据缺池 → 静默（不报错、不说空话）
 *   E8 同句 24 小时内不重复
 *
 * 用法：node tools/quest-echo-check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const echo = require(path.join(ROOT, 'game', 'src', 'core', 'questecho.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

function fresh() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot();
  e.newGame({ name: '回声侠', gender: 'male', birth: 'wuxue' });
  return e;
}
function seedQuests(w) {
  w.data.quests.q_echo_local = { id: 'q_echo_local', name: '本区的旧事', type: '支线', desc: '', stages: [{ desc: 'x' }] };
  w.data.quests.q_echo_far = { id: 'q_echo_far', name: '远地的事', type: '支线', desc: '', stages: [{ desc: 'y' }] };
  w.data.questEchoes = {
    q_echo_local: [{ text: '{name}在江南办的那件事，茶棚里还有人提。', region: 'jiangnan' }],
    q_echo_far: [{ text: '{name}在北边的事，听说传得很远。', region: 'beihai' }],
  };
}
/** 反复取样（每次清掉同句冷却，单看权重效果） */
function sample(p, w, n) {
  const cnt = { local: 0, far: 0 };
  for (let i = 0; i < n; i++) {
    p.vars.echoTexts = {};
    const hit = echo.pick(w, p);
    if (hit && hit.questId === 'q_echo_local') cnt.local++;
    else if (hit && hit.questId === 'q_echo_far') cnt.far++;
  }
  return cnt;
}

console.log('\n  ── 「江湖记得你」回声层守卫 ──');

/* E1 没有完成任务 → 一声不响 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  ok('E1 ★ 没有完成任何任务 → 一声不响（不刷空话）', echo.tick(w, p) === null);
  ok('E1b 纯函数 pick 同样返回 null', echo.pick(w, p) === null);
}

/* E2 有完成 + 有池 → 出回声，{name} 替换 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  p.setQuestStage('q_echo_local', 99);
  const r = echo.tick(w, p);
  ok('E2 ★ 有完成的任务 → 出一句回声', !!r && typeof r.text === 'string', r && r.text);
  ok('E2b {name} 占位替换成玩家名', !!r && r.text.indexOf('回声侠') >= 0 && r.text.indexOf('{name}') < 0);
}

/* E3 同区权重 ×3（加权随机，测占比） */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  p.setQuestStage('q_echo_local', 99);   // 江南（玩家在此）
  p.setQuestStage('q_echo_far', 99);     // 北边
  const c = sample(p, w, 200);
  const share = c.local / (c.local + c.far);
  ok('E3 ★ 同区权重×3：本区句子占比显著更高（权重 3:1 → 期望 75%）',
    share > 0.6, (share * 100).toFixed(1) + '%（' + c.local + '/' + (c.local + c.far) + '）');
}

/* E4 频次：冷却 20–30 tick */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  p.setQuestStage('q_echo_local', 99);
  const first = echo.tick(w, p);
  const span = (p.vars.echoNext || 0) - (w.clockMinutes || 0);
  const second = echo.tick(w, p);                      // 冷却内
  w.clockMinutes += Math.max(0, span - 1);
  const third = echo.tick(w, p);                       // 差 1 分钟
  w.clockMinutes += 1;
  p.vars.echoTexts = {};                               // 排除同句 24h 干扰，单看冷却
  const fourth = echo.tick(w, p);                      // 过冷却
  ok('E4 ★ 冷却落在 20–30 tick 区间（600–900 分钟）',
    span >= echo.COOLDOWN_MIN_RANGE[0] && span <= echo.COOLDOWN_MIN_RANGE[1], span + ' 分钟');
  ok('E4b 冷却内不出声；过冷却才再响',
    !!first && second === null && third === null && !!fourth);
}

/* E5 不污染传闻账 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  p.setQuestStage('q_echo_local', 99);
  const rumors0 = JSON.stringify(w.rumors || []);
  const rep0 = JSON.stringify(p.reputation || {});
  echo.tick(w, p);
  ok('E5 ★ 回声不写传闻账（world.rumors 零变化）', JSON.stringify(w.rumors || []) === rumors0);
  ok('E5b 回声不动声望账（p.reputation 零变化）', JSON.stringify(p.reputation || {}) === rep0);
}

/* E6 近期完成 ×2（同区内比）——⚠️ 「近期」= 最近 5 条完成内。
   只有两条完成时**两条都在近 5 条里**，权重相同（测不出差异），
   所以要垫 4 条无池子的占位完成，把旧的挤出近 5 条。 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  w.data.questEchoes.q_echo_far[0].region = 'jiangnan';   // 同区，让「近期」成为唯一差异
  for (let i = 1; i <= 4; i++) {
    w.data.quests['q_echo_fill' + i] = { id: 'q_echo_fill' + i, name: '垫场' + i, type: '支线', desc: '', stages: [{ desc: 'z' }] };
  }
  p.timeMinutes = 1000;
  p.setQuestStage('q_echo_local', 99);                    // 旧（会被挤出近 5 条）
  for (let i = 1; i <= 4; i++) { p.timeMinutes = 2000 + i * 100; p.setQuestStage('q_echo_fill' + i, 99); }
  p.timeMinutes = 5000;
  p.setQuestStage('q_echo_far', 99);                      // 近（在最近 5 条内）
  const c = sample(p, w, 200);
  const share = c.far / (c.local + c.far);
  ok('E6 ★ 近期完成权重×2：近 5 条完成内的句子更常被选（权重 2:1 → 期望 67%）',
    share > 0.55, (share * 100).toFixed(1) + '%（' + c.far + '/' + (c.local + c.far) + '）');
}

/* E7 数据缺池 → 静默 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  delete w.data.questEchoes;
  p.setQuestStage('q_echo_local', 99);
  ok('E7 ★ 数据没落池子时静默不出声（不报错、不说空话）', echo.tick(w, p) === null);
}

/* E8 同句 24h 不重复 */
{
  const e = fresh(); const w = e.world, p = w.player;
  seedQuests(w);
  delete w.data.questEchoes.q_echo_far;                   // 只留一条候选，句句同文
  p.setQuestStage('q_echo_local', 99);
  const first = echo.tick(w, p);
  p.vars.echoNext = 0;                                    // 把全局冷却清零，只测同句冷却
  const blocked = echo.tick(w, p);
  w.clockMinutes += echo.SAME_LINE_HOURS * 60;            // 24 小时后
  const again = echo.tick(w, p);
  ok('E8 ★ 同一句 24 小时内不重复（冷却过了也不重播）',
    !!first && blocked === null && !!again);
}

console.log('\n' + (fail ? '✘ ' + fail + ' 项失败：' + fails.join(' / ') : '✔ 全部通过'));
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
