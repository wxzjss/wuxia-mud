/**
 * survival.js — 生存系统
 *
 * 第 3 批：饥渴致死 + 复活到最近客栈。
 *  - 饥渴值由 world.advanceTime 消耗（见 world.js），这里只负责「归零的后果」。
 *  - 饥渴归零 → 持续掉血 → 饿死/渴死 → 复活到最近客栈。
 *
 * 无第三方依赖；只通过运行时传入的 world 对象调用其方法，避免循环 require。
 */
'use strict';

/** 所有客栈房间 id（复活点候选）。按名字含「客栈」识别。 */
function innRoomIds(world) {
  const out = [];
  const rooms = world.data && world.data.rooms;
  if (!rooms) return out;
  for (const id of Object.keys(rooms)) {
    const r = rooms[id];
    if (r && /客栈/.test(r.name || '')) out.push(id);
  }
  return out;
}

/** BFS 找离 fromRoom 最近的客栈房间 id（找不到返回 null）。 */
function nearestInn(world, fromRoom) {
  if (!fromRoom) return null;
  const inns = new Set(innRoomIds(world));
  if (!inns.size) return null;
  if (inns.has(fromRoom)) return fromRoom;
  const seen = new Set([fromRoom]);
  const q = [fromRoom];
  while (q.length) {
    const id = q.shift();
    const room = world.getRoom(id);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && world.getRoom(t) && !seen.has(t)) {
        if (inns.has(t)) return t;
        seen.add(t);
        q.push(t);
      }
    }
  }
  return null;
}

/** 死亡后复活到最近客栈（补充部分饥渴值，避免刚复活又饿死）。返回客栈房间 id。 */
function respawnAtInn(world, lines) {
  const p = world.player;
  const inn = nearestInn(world, p.room) || innRoomIds(world)[0] || (world.data.meta && world.data.meta.startRoom);
  const innName = (inn && (world.getRoom(inn) || {}).name) || '客栈';
  if (inn) world.movePlayerTo(p, inn);
  p.hp = Math.floor(p.maxHp * 0.4);
  p.mp = Math.floor(p.maxMp * 0.4);
  p.food = Math.max(p.food, Math.floor(p.maxFood * 0.6));
  p.water = Math.max(p.water, Math.floor(p.maxWater * 0.6));
  if (lines) lines.push({ kind: 'die', text: `你悠悠醒转，发现自己躺在${innName}的床榻上，是好心的过路人把你救了回来。` });
  return inn;
}

module.exports = { innRoomIds, nearestInn, respawnAtInn };
