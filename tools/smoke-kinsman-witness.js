/* ============================================================
 * smoke-kinsman-witness.js — 当众杀人·亲属/至交在场反应（任务 #108）
 *
 * 背景（出戏点①）：玩家当着 NPC 面杀了人，若死者是那人的
 *   至亲（夫妻 / 父母子女）或至交，那人却毫无反应，非常出戏。
 * 本脚本验：
 *   ① relBetween 双向识别 亲 / 友 / 仇
 *   ② 至亲在场：暴怒/崩溃反应 + hostile + favor 暴跌 + 记仇(avengers) + 门派声望受损
 *   ③ 至交在场：记仇反应（ milder）
 *   ④ 仇人/无关系在场：不误触发亲属反应（走原通用分支）
 *   ⑤ 有武力的至亲：扑上来那条线（hasMartial 分支）
 *   ⑥ 持久化：serialize → deserialize 后 hostile / favor / avengers 不丢
 *   ⑦ 接线：onNpcKilled 真的会触发亲属反应（整链路不崩）
 * ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261013;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '验亲', gender: 'male', birth: 'wuxue' });
  return e;
}

/* 注入一对可控的临时 NPC（互设关系后删掉，不污染真实数据） */
const VIC = '__victim', WIT = '__witness';
function injectPair(e, opts) {
  const w = e.world;
  opts = opts || {};
  w.data.npcs[VIC] = {
    id: VIC, name: '被害者', gender: 'female', room: w.player.room, level: 1, hp: 100, mp: 50,
    sect: 'huashan', hostile: false, leavesCorpse: false,
  };
  w.data.npcs[WIT] = {
    id: WIT, name: '目击者', gender: 'male', room: w.player.room, level: 1, hp: 100, mp: 50,
    sect: 'huashan', hostile: false, leavesCorpse: false,
    tag: opts.witnessTag || null,
  };
  if (opts.victimRel) w.data.npcs[VIC].rel = opts.victimRel;   // [{id,kind}]
  if (opts.witnessRel) w.data.npcs[WIT].rel = opts.witnessRel;
  const v = w.spawnNpc(VIC, w.player.room, 1, true);
  const wi = w.spawnNpc(WIT, w.player.room, 1, true);
  return { v, wi };
}
function cleanup(e) { delete e.world.data.npcs[VIC]; delete e.world.data.npcs[WIT]; }

function collectStory(w) {
  const lines = [];
  w.on('storyline', ev => { if (ev && ev.line) lines.push(ev.line); });
  return lines;
}

/* ============================================================ */
section('① relBetween 双向识别 亲 / 友 / 仇');
{
  const e = boot();
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '亲' }] });
  ok('victim.rel 指向 witness 且 kind=亲 → relBetween 返回 亲',
    e.world.relBetween(v, wi) === '亲', e.world.relBetween(v, wi));
  ok('反向（witness 视角）也能识别', e.world.relBetween(wi, v) === '亲');
  cleanup(e);
  const e2 = boot();
  const p2 = injectPair(e2, { witnessRel: [{ id: VIC, kind: '友' }] });
  ok('witness.rel 指向 victim 且 kind=友 → 返回 友', e2.world.relBetween(p2.wi, p2.v) === '友');
  cleanup(e2);
  const e3 = boot();
  const p3 = injectPair(e3, { victimRel: [{ id: WIT, kind: '仇' }] });
  ok('kind=仇 不被误判为亲属', e3.world.relBetween(p3.v, p3.wi) === '仇');
  ok('无关系 → null', e3.world.relBetween(p3.v, { defId: '陌生人' }) === null);
  cleanup(e3);
}

/* ============================================================ */
section('② 至亲（夫妻）在场：暴怒/崩溃 + hostile + favor 暴跌 + 记仇 + 门派声望受损');
{
  const e = boot();
  const w = e.world, p = w.player;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '亲' }] });
  p.reputation = p.reputation || {};
  const repBefore = (p.reputation.huashan || 0);
  const wantedBefore = (p.wanted || 0);
  const lines = collectStory(w);
  w.witnessReaction(v);
  const kinLine = lines.find(l => /目眦欲裂|肝肠寸断|不共戴天|至亲|爱妻|夫君/.test(l.text));
  ok('至亲目睹 → 触发专属暴怒/崩溃台词', !!kinLine, kinLine ? kinLine.text : '（无）');
  ok('台词里点出了死者身份（爱妻/夫君/至亲）', !!kinLine && /爱妻|夫君|至亲/.test(kinLine.text));
  ok('目击者 hostile 翻红（势同水火）', wi.hostile === true);
  ok('目击者 favor 暴跌 ≥ 90', (wi.favor || 0) <= -90, 'favor=' + wi.favor);
  ok('目击者记仇：pstate.avengers 收录死者 defId',
    Array.isArray(wi.pstate.avengers) && wi.pstate.avengers.indexOf(VIC) >= 0,
    JSON.stringify(wi.pstate.avengers));
  ok('玩家在死者门派的声望受损（≤ 原值-30）', (p.reputation.huashan || 0) <= repBefore - 30,
    repBefore + ' → ' + (p.reputation.huashan || 0));
  ok('玩家通缉度 +1（目击报案）', (p.wanted || 0) === wantedBefore + 1, 'wanted=' + p.wanted);
  cleanup(e);
}

/* ============================================================ */
section('③ 至交在场：记仇反应（milder，favor 跌 45 档）');
{
  const e = boot();
  const w = e.world, p = w.player;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '友' }] });
  const lines = collectStory(w);
  w.witnessReaction(v);
  const friendLine = lines.find(l => /过命的(兄弟|姊妹)|记下了|好狠的心/.test(l.text));
  ok('至交目睹 → 触发记仇台词', !!friendLine, friendLine ? friendLine.text : '（无）');
  ok('至交 hostile 翻红', wi.hostile === true);
  ok('至交 favor 暴跌（约 45，不低于 -45）', (wi.favor || 0) <= -45, 'favor=' + wi.favor);
  ok('至交同样记仇', Array.isArray(wi.pstate.avengers) && wi.pstate.avengers.indexOf(VIC) >= 0);
  cleanup(e);
}

/* ============================================================ */
section('④ 仇人 / 无关系在场：不误触发亲属反应');
{
  const e = boot();
  const w = e.world;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '仇' }] });
  const lines = collectStory(w);
  w.witnessReaction(v);
  const kinTriggered = lines.some(l => /不共戴天|肝肠寸断|过命的/.test(l.text));
  ok('仇人关系不触发亲属暴怒/崩溃线', !kinTriggered);
  ok('仇人目击者 hostile 未被误翻红', wi.hostile !== true);
  cleanup(e);

  const e2 = boot();
  const w2 = e2.world;
  const p2 = injectPair(e2, {});   // 无任何关系
  const lines2 = collectStory(w2);
  w2.witnessReaction(p2.v);
  const kin2 = lines2.some(l => /不共戴天|肝肠寸断|过命的/.test(l.text));
  ok('无关系不触发亲属线', !kin2);
  ok('无关系走通用反应（惊呼/警惕等）', lines2.length >= 1, lines2.map(l => l.text).join(' | '));
  cleanup(e2);
}

/* ============================================================ */
section('⑤ 有武力的至亲：扑上来那条线（hasMartial 分支）');
{
  const e = boot();
  const w = e.world;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '亲' }], witnessTag: 'swordsman' });
  ok('目击者确有武力（tag=swordsman）', w.npcHasMartialArts(wi) === true);
  const lines = collectStory(w);
  w.witnessReaction(v);
  const charge = lines.find(l => /目眦欲裂|扑将上来|不共戴天/.test(l.text));
  ok('有武力至亲 → 扑上来暴怒线', !!charge, charge ? charge.text : '（无）');
  cleanup(e);
}

/* ============================================================ */
section('⑥ 持久化：serialize → deserialize 后 hostile / favor / avengers 不丢');
{
  const e = boot();
  const w = e.world, p = w.player;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '亲' }] });
  w.witnessReaction(v);
  ok('反应前状态已落', wi.hostile === true && wi.pstate.avengers.indexOf(VIC) >= 0);
  const save = JSON.parse(JSON.stringify(w.serialize()));
  // 确认存档里确实带上了这些字段
  const witSave = Object.values(save.instances.npcs).find(n => n.defId === WIT);
  ok('存档里 witness 带 hostile', witSave && witSave.hostile === true);
  ok('存档里 witness 带 favor（≤-90）', witSave && witSave.favor <= -90, witSave && 'favor=' + witSave.favor);
  ok('存档里 witness 带 pstate.avengers', witSave && witSave.pstate && Array.isArray(witSave.pstate.avengers) && witSave.pstate.avengers.indexOf(VIC) >= 0);

  const e2 = new GameEngine({ seed: SEED });
  e2.boot();
  e2.world.deserialize(save, []);
  const w2 = e2.world;
  const wi2 = Object.values(w2.instances.npcs).find(n => n.defId === WIT);
  ok('读档后 witness 仍是 Character 实例', wi2 && wi2.constructor && wi2.constructor.name === 'Character');
  ok('读档后 hostile 不丢', wi2 && wi2.hostile === true);
  ok('读档后 favor 不丢', wi2 && wi2.favor <= -90, wi2 && 'favor=' + wi2.favor);
  ok('读档后 avengers 不丢', wi2 && wi2.pstate && wi2.pstate.avengers && wi2.pstate.avengers.indexOf(VIC) >= 0);
  cleanup(e);
}

/* ============================================================ */
section('⑦ 接线：onNpcKilled 整链路触发亲属反应且不崩');
{
  const e = boot();
  const w = e.world, p = w.player;
  const { v, wi } = injectPair(e, { victimRel: [{ id: WIT, kind: '亲' }], witnessTag: 'swordsman' });
  p.reputation = p.reputation || {};
  const lines = collectStory(w);
  let crashed = null;
  try {
    v.hp = 0;
    w.onNpcKilled(v, null);   // battle=null → 视为玩家击杀
  } catch (err) { crashed = err; }
  ok('onNpcKilled 全程不抛异常', crashed === null, crashed ? crashed.message : 'OK');
  const kinLine = lines.find(l => /目眦欲裂|不共戴天|扑将上来/.test(l.text));
  ok('整链路真的触发了亲属暴怒线', !!kinLine, kinLine ? kinLine.text : '（无）');
  ok('整链路后 witness 记仇', wi.pstate.avengers && wi.pstate.avengers.indexOf(VIC) >= 0);
  cleanup(e);
}

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(44));
process.exit(fail ? 1 : 0);
