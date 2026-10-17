/* ============================================================
 * endings.js —— 结局的**落定与兜底**（2026-10-18，半成品审计第 8 项）
 *
 * 病根两层（同一族：不报错就不生效）：
 *   ① 引擎只会把结局写进 `p.ending` 台账，**从不告诉回包**——
 *      前端 `if (d.ending)` 那段「故事终章」弹框从来没被触发过（死代码）；
 *   ② 完成一桩任务时对结局**零校验**——结局只由房间 action 的效果推进，
 *      将来多一条完成通路（mod / 新数据 / 剧情分叉），就会出现
 *      「通关了、p.ending 仍然空着」的静默缺口。
 *
 * 修法：
 *   · `grant()`：唯一落定入口（flag / var / p.ending 三写 + 返回 ending 行）；
 *     modapi 的 `case 'ending'` 与下面的兜底都走它，口径只有一份。
 *   · `onQuestDone()`：任务完成时的兜底——quest 定义上写
 *     `endingOnComplete: "<id>:<标题>"`，完成时**且当前没有 final 结局**才落。
 *     三选一结局先落 final 的路径不会被覆盖（同一效果批里 ending 在 questdone 之前执行）。
 *     兜底 id / 标题归设计 lane；引擎只认字段。
 * ============================================================ */
'use strict';

/** 落定一个结局（幂等；同一 id 重复落不报错）。返回 ending 行。 */
function grant(p, id, title) {
  p.setFlag('ending_' + id, true);
  p.setVar('ending', id);
  p.ending = p.ending || { achieved: {}, final: null };
  p.ending.achieved = p.ending.achieved || {};
  p.ending.achieved[id] = true;
  /* final 跟随刚触发的结局 id（与 setVar('ending', id) 同口径）；
     title 只是展示标题，不进台账。 */
  p.ending.final = id;
  return { kind: 'ending', text: id, title: title || id };
}

/**
 * 任务完成兜底（在两条完成路径上调用：modapi 的 questdone 效果、commands 的交任务）。
 * 返回 ending 行或 null。
 */
function onQuestDone(world, p, qd) {
  if (!p || !qd || !qd.endingOnComplete) return null;
  p.ending = p.ending || { achieved: {}, final: null };
  if (p.ending.final) return null;              /* 已有结局 → 兜底不覆盖 */
  const parts = String(qd.endingOnComplete).split(':');
  const id = (parts[0] || '').trim();
  if (!id) return null;
  return grant(p, id, (parts[1] || '').trim());
}

/** 引擎回包用：从 lines 里认出结局行（exec 的总出口那一处调用） */
function endingOf(lines) {
  const l = (lines || []).find(x => x && x.kind === 'ending');
  return l ? { id: l.text, title: l.title || l.text } : null;
}

module.exports = { grant, onQuestDone, endingOf };
