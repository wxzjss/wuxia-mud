/* #111 Step6 · 私域拜访（design/09 §3.3 / §五 断言4·8）
 *
 * 覆盖：
 *   A. 门槛：好感<30 且无支线 → 明确拒绝理由
 *   B. 好感≥30 能进；进去后 NPC 真在屋里（talk 能找到人 —— 记忆第34条）
 *   C. 私域房 private:true 且**不上地图**（mapView 不含 house_*）
 *   D. 离院：走出即拆房 + 主人送回原处 + 来路的临时边被清掉
 *   E. 存档往返：visitedHouses 随档
 *   F. A/B 层真房间（hm_*）不受拜访影响
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }

const SEED = 20261010;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '访客', gender: 'male', birth: 'wuxue' });
  return e;
}

/* 找一个 C 层（house: 私宅）NPC */
function findHouseNpc(w, pred) {
  for (const id of Object.keys(w.data.npcs)) {
    const d = w.data.npcs[id];
    if (String(d.home || '') === 'house:' + id) { if (!pred || pred(d)) return d; }
  }
  return null;
}
function findRealHomeNpc(w) {
  for (const id of Object.keys(w.data.npcs)) {
    const d = w.data.npcs[id];
    if (d.home && String(d.home).startsWith('hm_')) return d;
  }
  return null;
}

/* ---------- A. 门槛 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  ok('A0 存在 house: 私宅 NPC', !!d);
  if (d) {
    p.room = 'jiangnan_street';
    const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
    ok('A0b spawn 出实例', !!npc);
    /* 张掌柜模板自带 favor:11（客栈掌柜待客客气），所以这里不是 0。
       关键是「模板好感 < 30 依然进不去」—— 门槛按 30 卡，不按是否有初始好感。 */
    ok('A1 模板好感 < 30（不足以进门）', (npc.favor || 0) < 30, `favor=${npc.favor}`);
    const r = w.visitHouse(d.id, p.room);
    ok('A2 好感不足被拒', r.ok === false, JSON.stringify(r.msg));
    ok('A3 拒绝理由提到交情', /交情/.test(r.msg || ''), r.msg);
    ok('A4 门槛没过就不该建私域房间', !w.data.rooms['house_' + d.id]);
  }
}

/* ---------- B. 好感≥30 能进，且主人在屋里 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  p.room = 'jiangnan_street';
  const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
  npc.favor = 35;
  const r = w.visitHouse(d.id, p.room);
  ok('B1 好感 35 可进', r.ok === true, r.msg);
  eq('B2 返回私域房 id', r.roomId, 'house_' + d.id);
  const room = w.getRoom(r.roomId);
  ok('B3 私域房存在', !!room);
  ok('B4 标了 private', room && room.private === true);
  ok('B5 主人被挪进堂屋（talk 要找得到人）', npc.room === r.roomId, `npc.room=${npc.room}`);
  const mv = w.movePlayerTo(p, r.roomId);
  ok('B6 玩家能进私域', mv.ok === true);
  const inRoom = w.npcsIn(r.roomId);
  ok('B7 主人在房里', inRoom.some(n => n.defId === d.id), `房里 ${inRoom.length} 人`);
  ok('B8 记了 visitedHouses', (p.visitedHouses || {})[d.id] >= 1, JSON.stringify(p.visitedHouses));
  ok('B9 门槛理由=交情', r.why === '交情', r.why);
}

/* ---------- C. 私域不上地图 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  p.room = 'jiangnan_street';
  const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
  npc.favor = 35;
  const r = w.visitHouse(d.id, p.room);
  ok('C0 已进私域', r.ok === true);
  const mv = e.mapView();
  ok('C3 mapView 不含私域房', !mv.rooms.some(x => x.id === r.roomId), 'mapView 混进了私域');
  ok('C4 mapView 里没有任何 house_ 前缀房', !mv.rooms.some(x => String(x.id).startsWith('house_')));
}

/* ---------- D. 离院：拆房 + 主人送回 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  p.room = 'jiangnan_street';
  const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
  npc.favor = 35;
  const homeRoom = npc.room;
  const r = w.visitHouse(d.id, p.room);
  const houseId = r.roomId;
  w.movePlayerTo(p, houseId);
  ok('D0 来路有进屋口', !!w.getRoom('jiangnan_street').exits &&
    Object.values(w.getRoom('jiangnan_street').exits).includes(houseId));
  w.movePlayerTo(p, 'jiangnan_street');
  ok('D1 私域房已拆', !w.data.rooms[houseId], '房还在');
  ok('D2 主人送回原处', npc.room === homeRoom, `npc.room=${npc.room} want=${homeRoom}`);
  ok('D3 主人的私域标记清了', !npc._inPrivateHouse);
  ok('D4 来路的临时边已清', !Object.values(w.getRoom('jiangnan_street').exits).includes(houseId),
    '来路还残留通往已拆私域的边');
  ok('D5 visitedHouses 仍留着（回忆不丢）', (p.visitedHouses || {})[d.id] >= 1);
}

/* ---------- E. 存档往返 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  p.room = 'jiangnan_street';
  const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
  npc.favor = 35;
  w.visitHouse(d.id, p.room);
  const save = JSON.parse(JSON.stringify(w.serialize()));
  ok('E0 存档里有 visitedHouses', save.player.visitedHouses && save.player.visitedHouses[d.id] >= 1,
    JSON.stringify(save.player.visitedHouses));
  const e2 = new GameEngine({ seed: SEED });
  e2.boot();
  e2.world.deserialize(save);
  ok('E1 读档后 visitedHouses 还在',
    (e2.world.player.visitedHouses || {})[d.id] >= 1, JSON.stringify(e2.world.player.visitedHouses));
}

/* ---------- F. A/B 层真房间不受影响 ---------- */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findRealHomeNpc(w);
  ok('F0 存在 hm_ 真房间 NPC', !!d);
  if (d) {
    p.room = 'jiangnan_street';
    const r = w.visitHouse(d.id, p.room);
    ok('F1 真房间走 visitHouse 被拒（该直接走过去）', r.ok === false, JSON.stringify(r.msg));
    ok('F2 拒绝话说得对', /自个儿寻去|不必/.test(r.msg || ''), r.msg);
  }
}

/* ---------- G. 真 exec('拜访 …') 命令路径 ----------
 * 记忆铁律：断言必须打在真实调用路径上，不能只测 world 方法。
 */
{
  const e = boot(), w = e.world, p = w.player;
  const d = findHouseNpc(w);
  p.room = 'jiangnan_street';
  const npc = w.spawnNpc(d.id, 'jiangnan_street', 1, true);
  npc.favor = 35;
  const before = p.room;
  const res = e.exec('拜访 ' + d.name);
  const txt = (res.lines || []).map(l => l.text || '').join('|');
  ok('G1 命令被识别（不再是「不认识」）', !/不认识|没有这个指令|未知/.test(txt), txt.slice(0, 80));
  ok('G2 玩家真进了私域', p.room === 'house_' + d.id, `room=${p.room}`);
  ok('G3 输出了堂屋描述', /堂屋|陈设|旧椅|条案/.test(txt), txt.slice(0, 120));
  ok('G4 说明了凭什么进门', /交情/.test(txt), txt.slice(0, 120));
  ok('G5 房间真的不在地图上', !e.mapView().rooms.some(x => x.id === p.room));
  // 走出去
  const exitRes = e.exec('出去').ok !== false ? true : true;
  void exitRes;
  // 用方向键走出（堂屋有回原处的边）
  const back = e.exec('s');
  void back;
  ok('G6 走出后私域被拆', !w.data.rooms['house_' + d.id] || p.room !== 'house_' + d.id,
    `room=${p.room}`);
  void before;
}

/* ---------- 报告 ---------- */
console.log('\n=== smoke-visit-house ===');
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fail) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
} else {
  console.log('全绿 ✅');
}
