/**
 * flight.js — 「飞往」的**唯一**门槛与耗内力算法。
 *
 * 主人 2026-10-13：「让飞行现在不限制必须先去到某个区域。」
 *
 * 老规矩是「必须 `visited_<entry>`（去过那个门口）才准飞」，主人不要了 ——
 * 没去过华山也能飞到华山。改成武侠里说得通的两道门槛：
 *
 *   第一道 · **脚下得有轻功**。
 *     不会轻功的人飞不起来 —— 这是常识，不能为了方便就抹掉。
 *     判据：玩家 `learned` 里**至少有一门 `type:'轻功'` 的武学**。
 *     注意不要求「装在 `equippedSkills['轻功']` 那个槽上」：
 *     装槽是打架/赶路的取舍，会飞是另一回事，两者不该绑死。
 *
 *   第二道 · **内力要够**。
 *     远路费内力，内力不够就落不了地。距离按**步行步数**算
 *     （BFS 最短路，和玩家真走一遍的步数同源），轻功练得越深，同样距离越省。
 *
 * ⚠️ 这里只做「算」，不做「扣」。扣内力、扣时间、判战斗/押镖都在
 * commands.js 的「飞往」里，别把两件事搅在一起。
 */
'use strict';

const { clamp } = require('./utils');

/** 单程耗内力的基准：一百步要多少内力（轻功 0 级时）。 */
const BASE_COST_PER_100 = 30;
/** 轻功每 10 级省一成的功底（上限 -60%）。 */
const LV_DISCOUNT_PER_10 = 0.08;
const LV_DISCOUNT_CAP = 0.6;

/**
 * 玩家身上**练得最好的那门轻功**。
 * @returns {{id:string,name:string,level:number}|null}
 */
function bestQinggong(p, w) {
  const skills = (w && w.data && w.data.skills) || {};
  let best = null;
  for (const sid of Object.keys(p.learned || {})) {
    const sd = skills[sid];
    if (!sd || sd.type !== '轻功') continue;
    const lv = p.skillLevel(sid);
    if (!best || lv > best.level) best = { id: sid, name: sd.name || sid, level: lv };
  }
  return best;
}

/**
 * 从 `fromId` 到 `toId` 有多远（步行步数）。走不通（地图上不连通）返回 null。
 * @returns {number|null}
 */
function stepDistance(w, fromId, toId) {
  if (!w || !w.data || !w.data.rooms) return null;
  if (fromId === toId) return 0;
  /* 缓存在 world 上：BFS 一遍要扫全库房间，mapView 每次进地图面板都调，
     不缓存的话同一个房间每刷新一次就重算一次。房间表换了缓存自动失效。 */
  let cache = w._flyDist;
  if (!cache || cache.rooms !== w.data.rooms) cache = w._flyDist = { rooms: w.data.rooms, byFrom: {} };
  let d = cache.byFrom[fromId];
  if (!d) {
    /* 不引 maplayout：这道题只要 BFS，自己写十来行就够，也不怕布局模块改口径。 */
    d = {};
    const rooms = w.data.rooms;
    d[fromId] = 0;
    const q = [fromId];
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      const room = rooms[cur];
      if (!room || !room.exits) continue;
      for (const dir of Object.keys(room.exits)) {
        const t = room.exits[dir];
        if (!rooms[t] || d[t] != null) continue;
        d[t] = d[cur] + 1;
        q.push(t);
      }
    }
    cache.byFrom[fromId] = d;
  }
  return d[toId] == null ? null : d[toId];
}

/**
 * 飞一趟要多少内力。飞不了（没轻功 / 路不通）返回 null。
 * @returns {number|null} 内力点数
 */
function flightCost(p, w, steps) {
  const qg = bestQinggong(p, w);
  if (!qg) return null;
  if (steps == null) return null;
  const discount = Math.min(LV_DISCOUNT_CAP, (qg.level / 10) * LV_DISCOUNT_PER_10);
  const raw = (steps / 100) * BASE_COST_PER_100 * (1 - discount);
  return Math.max(2, Math.ceil(raw));
}

/**
 * 「能不能飞到某个入口」的**完整**判定。mapView 下发 `canFly` 与
 * 「飞往」执行走的是同一个函数 —— 两处各判一套是「前端亮着、后端说不行」的老毛病。
 *
 * @returns {{ok:boolean, reason?:string, cost?:number, steps?:number, qinggong?:object}}
 */
function canFlyTo(p, w, entryId) {
  const fail = (reason) => ({ ok: false, reason });
  if (!entryId || !w.getRoom(entryId)) return fail('那个地方没有可以落脚的入口。');
  if (p.room === entryId) return fail('你已经站在那儿了。');

  const qg = bestQinggong(p, w);
  if (!qg) {
    return fail('你还没练一门轻功，脚底不沾风，飞不起来 —— 先去找门轻功学。');
  }

  const steps = stepDistance(w, p.room, entryId);
  if (steps == null) {
    return fail('那边没有路能过去，脚下再快也飞不到。');
  }

  const cost = flightCost(p, w, steps);
  if (cost == null) return fail('飞不了。');

  return { ok: true, cost, steps, qinggong: qg };
}

/**
 * 够不够内力（够不够是**现在**的事，能不能飞是**练气**的事，两回事分开说）。
 */
function canAfford(p, cost) {
  return (p.mp || 0) >= cost;
}

module.exports = { bestQinggong, stepDistance, flightCost, canFlyTo, canAfford, clamp };
