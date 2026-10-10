/* ============================================================
 * smoke-rumor.js — 世界记忆·传闻系统（任务 #109，SPRINT-B W1–W4）
 *
 * 验（根治出戏点③「剧情外失忆」的最小闭环）：
 *   A. 邻接表 + kFlow 运行时预计算（地图静态、零依赖，杜绝传不动的区域）
 *   B. 杀具名 NPC → 目击判定 → 生成传闻实例（subject/about/witnesses/spread 正确）
 *   C. 打听命令：当前区域能听到该传闻的「说法」（含关系态度后缀）
 *   D. 跨日扩散：邻区强度 > 0（传闻真的会传开）
 *   E. 走样：truth 漂移 + 同传闻不同 truth 档文本不同（不同人嘴里说法不一样）
 *   F. 听说：listenRumors 按 region / 关键词检索正确
 *   G. 消亡：ttl 到期后 rumors 清空
 *   H. 持久化：serialize → deserialize 后 rumors / rumorSeq 不丢
 * ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const SEED = 20261014;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}

/* 挑一个有跨区邻区的 region（保证扩散可测） */
function pickRegionWithNeighbor(w) {
  for (const r of Object.keys(w.regionAdj)) {
    if (w.regionAdj[r] && Object.keys(w.regionAdj[r]).length) return r;
  }
  return null;
}
function roomInRegion(w, R) {
  const rm = Object.values(w.data.rooms).find(x => x.region === R);
  return rm ? rm.id : null;
}
let WIT_SEQ = 0;
function injectWitness(e, room) {
  const w = e.world;
  const id = '__wit' + (WIT_SEQ++);
  w.data.npcs[id] = { id, name: '过路客', gender: 'male', room, level: 1, hp: 50, mp: 20, hostile: false, tag: 'commoner' };
  const inst = w.spawnNpc(id, room, 1, true);
  return { id, inst };
}
let VIC_SEQ = 0;
function injectNamedVictim(e, room) {
  const w = e.world;
  const id = '__vic' + (VIC_SEQ++);
  w.data.npcs[id] = {
    id, name: '被害者', gender: 'female', room, level: 1, hp: 100, mp: 50,
    sect: 'huashan', tier: 'A', hostile: false, leavesCorpse: false,
    expReward: 1, potReward: 1, moneyReward: 0,
  };
  const inst = w.spawnNpc(id, room, 1, true);
  inst.hp = 0;
  return { id, inst };
}
function advanceDays(w, n) {
  for (let i = 0; i < n; i++) { w.clockMinutes += 1440; w.dailyRumorTick(); }
}

/* ============================================================ */
section('A. 邻接表 + kFlow 运行时预计算');
{
  const e = boot();
  const w = e.world;
  ok('regionAdj 非空（地图连通，存在跨区边）', Object.keys(w.regionAdj).length > 0, Object.keys(w.regionAdj).length + ' 个区域有邻接');
  const kvals = Object.values(w.kFlow);
  ok('kFlow 全部落在 [0.15, 0.60]（下限钳制生效，杜绝传不动的区域）',
    kvals.length > 0 && kvals.every(v => v >= 0.15 && v <= 0.60),
    'min=' + Math.min.apply(null, kvals).toFixed(2) + ' max=' + Math.max.apply(null, kvals).toFixed(2));
  const R = pickRegionWithNeighbor(w);
  ok('存在一个有邻区的 region 可用于扩散测试', !!R, R || '（无）');
}

/* ============================================================ */
section('B. 杀具名 NPC → 目击判定 → 生成传闻实例');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  const { id: vid, inst } = injectNamedVictim(e, room);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  let crashed = null;
  try { w.onNpcKilled(inst, null); } catch (err) { crashed = err; }
  ok('onNpcKilled 全程不抛异常', crashed === null, crashed ? crashed.message : 'OK');
  ok('杀具名 NPC → 生成 1 条传闻', w.rumors.length === 1, w.rumors.length + ' 条');
  ok('传闻 originRegion 强度 > 0', w.rumors.length === 1 && (w.rumors[0].spread[R] || 0) > 0, 'spread[' + R + ']=' + (w.rumors[0] && w.rumors[0].spread[R]));
  ok('传闻 subject=player、about=受害者 defId', w.rumors[0] && w.rumors[0].subject === 'player' && w.rumors[0].about === vid);
  ok('目击者非空（同房间非 hostile NPC）', w.rumors[0] && w.rumors[0].witnesses.length >= 1, 'witnesses=' + (w.rumors[0] && w.rumors[0].witnesses.length));
  ok('传闻 polarity/weight 取自种子', w.rumors[0] && w.rumors[0].polarity === -1 && w.rumors[0].weight === 3.0);
}

/* ============================================================ */
section('C. 打听命令：当前区域听到该传闻的「说法」');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  const { inst } = injectNamedVictim(e, room);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  w.onNpcKilled(inst, null);
  // 把玩家挪到事发地（仅用于 region 检索）
  w.player.room = room;
  const res = e.exec('打听');
  ok('打听返回有效 lines', res && Array.isArray(res.lines) && res.lines.length > 0);
  ok('听闻含「街谈巷议」标题', res && res.lines.some(l => /街谈巷议/.test(l.text || '')));
  ok('听闻含 NPC 说出的传闻文本', res && res.lines.some(l => /说道/.test(l.text || '')));
  ok('听闻含关系态度后缀（我是听人说的/压低声音/早晚有报应 之一）',
    res && res.lines.some(l => /作不得准|我只跟|不是那样|早晚有报应/.test(l.text || '')));
}

/* ============================================================ */
section('D. 跨日扩散：邻区强度 > 0（传闻真的会传开）');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const nb = Object.keys(w.regionAdj[R])[0];
  const room = roomInRegion(w, R);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  const r = w.addRumor('rs_kill_named', {
    room, who: '试剑', where: '某处', whom: '被害者', subject: 'player', about: '__vic',
    vars: { who: '试剑', where: '某处', whom: '被害者' },
  });
  ok('addRumor 直接生成成功', !!r && w.rumors.length === 1);
  advanceDays(w, 8);
  ok('跨日扩散：邻区 ' + nb + ' 强度 > 0', (w.rumors[0].spread[nb] || 0) > 1, 'spread[' + nb + ']=' + (w.rumors[0].spread[nb] || 0).toFixed(2));
  ok('本地 ' + R + ' 强度仍 > 0', (w.rumors[0].spread[R] || 0) > 0, 'spread[' + R + ']=' + (w.rumors[0].spread[R] || 0).toFixed(2));
}

/* ============================================================ */
section('E. 走样：truth 漂移 + 同传闻不同 truth 档文本不同');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  w.addRumor('rs_kill_named', {
    room, who: '试剑', where: '某处', whom: '被害者', subject: 'player', about: '__vic',
    vars: { who: '试剑', where: '某处', whom: '被害者' },
  });
  advanceDays(w, 8);
  ok('走样发生：hopCount ≥ 3（已扩散多跳）', w.rumors[0].hopCount >= 3, 'hop=' + w.rumors[0].hopCount);
  ok('truth 已偏离 100（发生失真）', w.rumors[0].truth !== 100, 'truth=' + w.rumors[0].truth);
  // 确定性：同一种子、不同 truth 档 → 文本不同（即「不同人嘴里说法不一样」）
  const rT = { seedId: 'rs_kill_named', truth: 100, vars: { who: '试剑', where: '某处', whom: '被害者' } };
  const rF = { seedId: 'rs_kill_named', truth: 30, vars: { who: '试剑', where: '某处', whom: '被害者' } };
  ok('truth≥70 与 <40 档文本不同', w.fillRumorText(rT) !== w.fillRumorText(rF));
  ok('true 档含「一招都没还手」', w.fillRumorText(rT).includes('一招都没还手'));
  ok('false 档更夸张失真（含「跟鬼似的」）', w.fillRumorText(rF).includes('跟鬼似的'));
}

/* ============================================================ */
section('F. 听说：listenRumors 按 region / 关键词检索');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  w.addRumor('rs_kill_named', {
    room, who: '试剑', where: '某处', whom: '被害者', subject: 'player', about: '__vic',
    vars: { who: '试剑', where: '某处', whom: '被害者' },
  });
  ok('listenRumors(事发地region) 返回该传闻', w.listenRumors(R).length === 1, w.listenRumors(R).length + '');
  ok('listenRumors(关键词=玩家名) 命中', w.listenRumors(R, '试剑').length === 1);
  ok('listenRumors(关键词=无关词) 不命中', w.listenRumors(R, '九阴真经').length === 0);
  // 一个不在 spread 里的 region 不应返回
  const remote = Object.keys(w.regionAdj).find(rg => rg !== R && !w.regionAdj[R][rg]);
  if (remote) ok('listenRumors(无关region) 不返回', w.listenRumors(remote).length === 0, 'remote=' + remote);
}

/* ============================================================ */
section('G. 消亡：ttl 到期后 rumors 清空');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  w.addRumor('rs_kill_named', {
    room, who: '试剑', where: '某处', whom: '被害者', subject: 'player', about: '__vic',
    vars: { who: '试剑', where: '某处', whom: '被害者' },
  });
  advanceDays(w, 25); // rs_kill_named ttl=20 天，推过 20 天
  ok('ttl 到期后 rumors 清空', w.rumors.length === 0, 'rumors=' + w.rumors.length);
}

/* ============================================================ */
section('H. 持久化：serialize → deserialize 后 rumors / rumorSeq 不丢');
{
  const e = boot();
  const w = e.world;
  const R = pickRegionWithNeighbor(w);
  const room = roomInRegion(w, R);
  injectWitness(e, room);
  if (!w.player.reputation) w.player.reputation = {};
  w.addRumor('rs_kill_named', {
    room, who: '试剑', where: '某处', whom: '被害者', subject: 'player', about: '__vic',
    vars: { who: '试剑', where: '某处', whom: '被害者' },
  });
  advanceDays(w, 3);
  const uid = w.rumors[0].uid;
  const seqBefore = w.rumorSeq;
  const save = JSON.parse(JSON.stringify(w.serialize()));
  ok('存档含 rumors 数组（1 条）', Array.isArray(save.rumors) && save.rumors.length === 1);
  ok('存档含 rumorSeq 计数', typeof save.rumorSeq === 'number', 'rumorSeq=' + save.rumorSeq);
  const e2 = new GameEngine({ seed: SEED });
  e2.boot();
  e2.world.deserialize(save, []);
  ok('读档后 rumors 不丢', e2.world.rumors.length === 1);
  ok('读档后 uid 一致', e2.world.rumors[0] && e2.world.rumors[0].uid === uid, e2.world.rumors[0] && e2.world.rumors[0].uid);
  ok('读档后 rumorSeq 恢复', e2.world.rumorSeq === seqBefore, e2.world.rumorSeq + ' vs ' + seqBefore);
  ok('读档后 spread 状态恢复（邻区仍 > 0）', (e2.world.rumors[0].spread[R] || 0) > 0);
}

console.log('\n' + '='.repeat(44));
console.log('  世界记忆·传闻专项: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(44));
process.exit(fail ? 1 : 0);
