/**
 * travel.js — 驿站渡口行路网络（design/89 §七·补 裁 2/3/4）。
 *
 * 2026-10-14 主人改判：飞行空投语义全删，区域间移动改为「驿站渡口行路网络」。
 * flight.js 已物理删除（2026-10-13 能力盘点批批准：全库零调用、对照价值存于 git 历史）；
 * 本文件是行路的**唯一**判定与执行。
 *
 * 数据 schema（`world.data.travel`，数据侧游有方供数；无此键 = 该处没有通航节点）：
 *   travel.links: [{
 *     from, to,          // 区域 id（两端）
 *     kind: 'walk'|'cross',
 *                      // walk  = 同片官道，步行直达，免费走
 *                      // cross = 跨区，过门槛才走（89 §七·补 裁 3 三形态）
 *     cond: '…',         // cross 必填，门槛统一归一成 evalCond 字符串（三形态）：
 *                          渡资      → 'money>=200'
 *                          路引      → 'item_wuyin>=1'（数值字段比较）
 *                          船家交情  → 好感变量等数值条件
 *                          剧情 flag → 直接写 flag 名（'act1_done'，evalCond 末段兜底按 flag 求值）
 *     cost: 200,         // 可选，走成扣的渡资（银钱）
 *     gateText: '渡资 200 文',  // 可选，面板上的门槛展示（不给就按 cond 原样显示）
 *     refusal: '…',      // 被挡时的**世界内说法**（说话人写进文案，sectRefusal 范式：
 *                          站在门前的人说，不出系统提示条——89 §七·d 铁律 1）
 *     say: '…',          // 可选，走成时的通航场景句（铁律 2：锁开也是戏）
 *   }]
 */

const { evalCond } = require('./modapi');

/** 从某区域出发的所有行路边（无 travel 数据 = 没有通航节点，返回 []） */
function linksFrom(w, regionId) {
  const t = w && w.data && w.data.travel;
  if (!t || !Array.isArray(t.links)) return [];
  return t.links.filter(l => l && l.from === regionId && l.to);
}

/** 某条边的通行判定：{ ok, state, link, reason }
 *  state: 'walk'（免费直达）| 'ready'（门槛已过，cross）| 'closed'（被挡，带说法） */
function checkLink(w, p, link) {
  if (!link) return { ok: false, state: 'nolink', reason: null };
  if (link.kind !== 'cross') return { ok: true, state: 'walk', link };
  const pass = !link.cond || evalCond(link.cond, { player: p, world: w });
  return pass
    ? { ok: true, state: 'ready', link }
    : { ok: false, state: 'closed', link, reason: link.refusal || '此路暂不通。' };
}

/** 两区域之间的边（不含反向前提：数据侧每条方向各写一条） */
function linkBetween(w, fromRegion, toRegion) {
  return linksFrom(w, fromRegion).find(l => l.to === toRegion) || null;
}

/** 执行一段行路：扣渡资（若有）。位移本身由调用方做（movePlayerTo），
 *  这里只管**钱**和返回故事句，保证判定（checkLink）与扣费不分离。 */
function payIfAny(p, link) {
  const cost = (link && link.cost) || 0;
  if (cost > 0) p.money = Math.max(0, (p.money || 0) - cost);
  return cost;
}

module.exports = { linksFrom, checkLink, linkBetween, payIfAny };
