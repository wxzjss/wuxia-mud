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

/* 昏倒与苏醒的**唯一入口**。
 *
 * ⚠️ 两件必须说清的事：
 * ① 主人明确要求：玩家**不是「死」，是力竭昏过去**，然后在最近客栈醒转。
 *    所以这里的语义与文案一律用「昏倒 / 醒过来」，玩家可见的任何一个字都不许说「死」。
 * ② 结算（掉银钱、折功力）**只在这一处做**。
 *    原来「战斗昏倒」在 `world.playerDeath()` 里扣一次钱，
 *    「饿昏/渴昏」走的是 `engine.postProcess` 的另一段内联代码 —— **两条路各写一份**：
 *      · 内联那份只算了 `lost` 拿去写台词，**根本没扣**（玩家看到的「损失了 N 文钱」是假的）；
 *      · 而且它算的是 `p.money * 0.2` —— 若那一路真扣过钱，报给玩家的数字又是扣后余额的 20%，
 *        跟实际扣的对不上。
 *    两份实现漂移，正是「同一动作有三条路径」的老毛病。现在只有一份。
 *
 * @param world
 * @param lines  可选。会把「昏倒 → 苏醒」的台词推进去
 * @param opts   { anchor } 可选。显式落点（青楼卖身者回青楼由 engine 传进来，
 *               因为 brothelAnchor 在 work 模块，survival 不 require 它以免循环依赖）
 * @returns {{ room, name, lost, expLost, same }}
 */
function respawnAtInn(world, lines, opts) {
  const o = opts || {};
  const p = world.player;
  const from = p.room;
  const anchor = o.anchor
    || nearestInn(world, p.room)
    || innRoomIds(world)[0]
    || (world.data.meta && world.data.meta.startRoom);
  const roomName = (anchor && (world.getRoom(anchor) || {}).name) || '客栈';
  /* 落点就是原地（本来就昏在客栈里）→ 别说「被背回来」，那段路根本没走 */
  const same = !!anchor && anchor === from;

  /* ---- 昏倒的代价（唯一结算点）---- */
  const money0 = Math.max(0, Math.floor(p.money || 0));
  const lost = Math.floor(money0 * 0.2);
  const exp0 = Math.max(0, Math.floor(p.exp || 0));
  const expLost = exp0 - Math.floor(exp0 * 0.9);
  p.money = money0 - lost;
  p.exp = Math.floor(exp0 * 0.9);

  if (anchor) world.movePlayerTo(p, anchor);
  p.hp = Math.floor(p.maxHp * 0.4);
  p.mp = Math.floor(p.maxMp * 0.4);
  p.food = Math.max(p.food || 0, Math.floor(p.maxFood * 0.6));
  p.water = Math.max(p.water || 0, Math.floor(p.maxWater * 0.6));
  p.buffs = [];
  if (typeof p.recalc === 'function') p.recalc();

  if (lines) {
    lines.push({
      kind: 'faint',
      text: same
        ? `你在一阵草药味里醒转，人就躺在${roomName}自己的床榻上。`
        : `不知过了多久，你在一阵草药味里醒转——是${roomName}的伙计把你从路边背了回来。`,
    });
    const parts = [];
    if (lost > 0) parts.push(`银钱少了 ${lost} 文`);
    if (expLost > 0) parts.push('功力折了些');
    if (parts.length) lines.push({ kind: 'sys', text: `（${parts.join('，')}）` });
  }
  return { room: anchor, name: roomName, lost, expLost, same };
}

module.exports = { innRoomIds, nearestInn, respawnAtInn };
