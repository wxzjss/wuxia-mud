/* ============================================================
 * escort.js —— 镖局 · 送镖（design/67 §4）
 *
 * 主人 2026-10-11：「游戏好像也没有镖局以及送镖（送往其他城市有概率会被劫镖）任务」。
 *
 * 已有的底子（不新造）：
 *   · 两家镖局本来就在地图上：**飞虎镖局**（长安）、**镇远镖局**（洛阳），
 *     各有山门 / 演武场 / 库房，掌门与弟子也都在。
 *   · 两地分属长安与洛阳 —— 天然就是一条跨城镖路。
 *
 * 这个模块把「接镖 → 押镖 → 路上被劫 → 交镖结银」串起来：
 *   · 两家镖局的**山门**柜台接镖单（三种档：常镖 / 重镖 / 暗镖）。
 *   · 接单后进入**押镖态**（`p.escort`，随档走）：押镖期间**不许「行路」**——
 *     能飞就等于没有路，劫镖也就无从谈起。
 *   · 每走一格，按当前区域危险度掷一次**劫镖**；中了就掉一份镖物。
 *   · 到了讫城镖局交镖：按「还剩几分镖物」结镖银 + 镖局好感。
 *
 * ⚠️ 与既有系统的接点（都没新造）：
 *     钱走 `p.money`、好感走 `social`、危险度读 region 的 `tier` 与 `danger`。
 * ============================================================ */
'use strict';

/* 两家镖局（房间 id 取自 50_map，别改错 —— 场景 id 写错是「静默瘫掉」型 bug） */
const HOUSES = {
  feihu: { key: 'feihu', name: '飞虎镖局', gate: 'feihu_gate', city: '长安', toKey: 'zhenyuan' },
  zhenyuan: { key: 'zhenyuan', name: '镇远镖局', gate: 'zhenyuan_gate', city: '洛阳', toKey: 'feihu' },
};

/* 三种档：镖银倍率 / 路上被劫的倍率 / 路引要求 */
const GRADES = [
  { id: 'common', name: '常镖', desc: '寻常货物，走官道，风险最低', pay: 1.0, risk: 1.0, req: '五两' },
  { id: 'heavy', name: '重镖', desc: '货重价高，容易被人盯上', pay: 2.2, risk: 2.4, req: '二十两' },
  { id: 'secret', name: '暗镖', desc: '不走官道，绕路而行 —— 押期长，好处是不打眼', pay: 1.6, risk: 0.7, req: '十两' },
];

/** 我在哪家镖局的柜台上（不在任何镖局 → null） */
function houseHere(world, p) {
  const r = world.getRoom(p && p.room);
  if (!r) return null;
  for (const k of Object.keys(HOUSES)) if (HOUSES[k].gate === r.id) return HOUSES[k];
  return null;
}

/** 当前可接的镖单 */
function listFor(world, p) {
  const house = houseHere(world, p);
  if (!house) return [];
  const to = HOUSES[house.toKey];
  return GRADES.map(g => ({
    id: house.key + '_' + g.id,
    grade: g.name, desc: g.desc,
    from: house.name, to: to.name,
    fromCity: house.city, toCity: to.city,
    pay: Math.round(120 * g.pay), risk: g.risk, req: g.req,
  }));
}

/** 押镖态 */
function statusOf(p) { return (p && p.escort) || null; }

function accept(world, p, n) {
  if (statusOf(p)) return { ok: false, msg: '你手上还押着一趟镖，先把这趟走完。' };
  const list = listFor(world, p);
  if (!list.length) return { ok: false, msg: '这儿没有镖局的柜台，接不了镖。' };
  const idx = Math.max(1, Math.min(list.length, n || 1)) - 1;
  const b = list[idx];
  p.escort = {
    id: b.id, grade: b.grade, from: b.from, to: b.to,
    toRoom: HOUSES[HOUSES[houseHere(world, p).toKey].key].gate,
    fromCity: b.fromCity, toCity: b.toCity,
    pay: b.pay, risk: b.risk, pot: 3, lost: 0, steps: 0,
  };
  return { ok: true, board: b };
}

/* 路上危险度：区域 tier 越「野」越险 */
const DANGER_BY_TIER = { wilderness: 1.6, mountain: 1.3, road: 1.1, village: 0.8, town: 0.5, city: 0.35, capital: 0.3, court: 0.3, sect: 0.6 };

function dangerOf(world, roomId) {
  const r = world.getRoom(roomId);
  const rg = r && world.getRegion(r.region);
  const t = (rg && rg.tier) || 'road';
  return DANGER_BY_TIER[t] !== undefined ? DANGER_BY_TIER[t] : 1.0;
}

/** 走一格之后：掷劫镖。返回要上屏的台词（可能为空数组）。 */
function onMove(world, p, roomId) {
  const st = statusOf(p);
  if (!st || world.battle) return [];
  st.steps = (st.steps || 0) + 1;
  /* 到达讫城镖局：提示交镖 */
  if (roomId === st.toRoom) {
    return [{ kind: 'quest', text: `【镖局】${st.to}到了。进山门找柜上交镖。` }];
  }
  const out = [];
  const chance = 0.06 * st.risk * dangerOf(world, roomId);
  if (world.rng.next() > chance) return out;
  /* 被劫：掉一份镖物（不是全丢 —— 全丢太劝退，掉一份是「疼但不致命」） */
  st.lost = Math.min(st.pot, (st.lost || 0) + 1);
  out.push({ kind: 'warn', text: `道旁窜出几条人影，你护住了箱子，却叫他们摸走了一包货。` });
  out.push({ kind: 'plain', text: `（镖物 ${st.pot - st.lost}/${st.pot}。到讫城交镖时，少一份就扣一份的镖银。）` });
  return out;
}

/** 交镖 */
function deliver(world, p) {
  const st = statusOf(p);
  if (!st) return { ok: false, msg: '你手上没有要交的镖。' };
  const house = houseHere(world, p);
  if (!house) return { ok: false, msg: '这不是镖局的柜台。' };
  if (house.name !== st.to) return { ok: false, msg: `这趟镖是要送到${st.to}的，这儿是${house.name}。` };
  const intact = Math.max(0, st.pot - (st.lost || 0));
  const pay = Math.round(st.pay * intact / st.pot);
  const done = { grade: st.grade, pay, intact, pot: st.pot, steps: st.steps || 0 };
  delete p.escort;
  return { ok: true, done };
}

/** 押镖期间不许「行路」 */
function flyingBlocked(p) { return !!statusOf(p); }

module.exports = { HOUSES, GRADES, houseHere, listFor, statusOf, accept, onMove, deliver, flyingBlocked, dangerOf };
