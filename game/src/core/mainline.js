/* ============================================================
 * mainline.js —— 主线分化 P1（地基）：`p.mainline = {line, act, node, flags}`
 *
 * 主人 2026-10-11（design/67 §5）：
 *   「根据不同出身（话说有官府路线出身吗？）以及不同性别玩家所经历的主线也不一样，
 *     比如有的是正派有的是反派…… 如果是 mod 出身则是一条新主线，
 *     玩家不再是强绑定正派或反派剧情而是一种中立视角下的剧情」
 *
 * 已查清（design/67 §0）：**没有官府路线出身**；14 条出身全是属性/物品差异，
 * **剧情上一点不分** —— 选「书香门第」和选「楼里新来的」，走的是同一条主线。
 * 这个模块就是那道地基：**开局按出身定一条线，主线每一步都读它**。
 *
 * 三条线（不是换一套任务，是**同一件事的三种走法**）：
 *   orthodox 正派 —— 庙堂 + 门派（师门信物、名门正朔）
 *   outlaw   反派 —— 仇与债（不指望谁替你主持公道）
 *   neutral  中立 —— 只看利害，不看正邪（mod 出身、无根之人）
 *
 * ⚠️ 分工：这里只管「我是哪条线、走到第几幕第几个节点」，
 *    具体每一步说什么做什么仍在 quests 数据里（`require.line` 分流）。
 * ============================================================ */
'use strict';

const LINES = {
  orthodox: {
    id: 'orthodox', name: '正派',
    desc: '你身上有师门/家世的印子。这条路讲的是规矩与人情，走得慢，但一路有人接得住你。',
  },
  outlaw: {
    id: 'outlaw', name: '反派',
    desc: '你身上背的东西，庙堂管不了。这条路讲的是仇与债，走得快，也没人替你收尾。',
  },
  neutral: {
    id: 'neutral', name: '中立',
    desc: '你没有根。这条路不讲正邪，只讲利害 —— 谁都能合作，谁都能翻脸。',
  },
};

/* 出身 → 线。
   ⚠️ 这张表就是 design/67 §5.2 那三行的落地，改它等于改主线走向，别随手加。 */
const LINE_OF_BIRTH = {
  /* 有根的人（师门、家世、庙堂）→ 正派 */
  noble: 'orthodox',        // 官宦子弟
  monastic: 'orthodox',     // 山门弃婴
  taoist_ward: 'orthodox',  // 道观道童
  nun_ward: 'orthodox',     // 庵堂孤儿
  tomb_keep: 'orthodox',    // 守墓人之后
  wuxue: 'orthodox',        // 武学世家
  scholar: 'orthodox',      // 书香门第
  /* 背着仇与债的人 → 反派 */
  grudge_orphan: 'outlaw',  // 血仇遗孤
  deserter_child: 'outlaw', // 逃卒之后
  brothel_sold: 'outlaw',   // 楼里新来的（已卖身）
  /* 无根的人 → 中立 */
  orphan: 'neutral',        // 孤儿出身
  hunter: 'neutral',        // 猎户之家
  merchant: 'neutral',      // 商贾之后
  border_drift: 'neutral',  // 边地流人
};

/** 这个出身走哪条线（不认识的一律中立 —— 不猜，也不拦） */
function lineOfBirth(birthId) {
  return LINE_OF_BIRTH[birthId] || 'neutral';
}

/** 开局初始化（`createPlayer` 调） */
function init(birthId, gender, opts) {
  const o = opts || {};
  return {
    line: o.line || lineOfBirth(birthId),
    birth: birthId || null,
    gender: gender || 'male',
    act: 1,        // 第几幕（1~5）
    node: 0,       // 这一幕里的第几个节点（0 起）
    flags: {},
    /* Mod 出身（mod 自带的 birth）走中立线 —— 玩家不再是「天选之人」 */
    fromMod: !!o.fromMod,
  };
}

/** 取（必要时补建）玩家身上的主线状态 */
function stateOf(p) {
  if (!p) return null;
  if (!p.mainline || typeof p.mainline !== 'object') {
    p.mainline = init(p.birth || null, p.gender, {});
  }
  if (!p.mainline.flags) p.mainline.flags = {};
  if (typeof p.mainline.act !== 'number') p.mainline.act = 1;
  if (typeof p.mainline.node !== 'number') p.mainline.node = 0;
  if (!LINES[p.mainline.line]) p.mainline.line = 'neutral';
  return p.mainline;
}

function lineInfo(p) { return LINES[(stateOf(p) || {}).line] || LINES.neutral; }

/** 推进到下一个节点（同一幕内；到幕末就交回给任务系统去推 act） */
function advance(p) {
  const m = stateOf(p);
  m.node++;
  return m;
}

/** 进入下一幕 */
function nextAct(p) {
  const m = stateOf(p);
  m.act++;
  m.node = 0;
  return m;
}

function setFlag(p, k, v) { stateOf(p).flags[k] = v === undefined ? true : v; }
function hasFlag(p, k) { return !!stateOf(p).flags[k]; }

/** 给前端的简报（状态面板 / 任务面板显示「你走的哪条线」） */
function briefOf(p) {
  const m = stateOf(p);
  const info = LINES[m.line];
  return {
    line: m.line, lineName: info.name, desc: info.desc,
    act: m.act, node: m.node, fromMod: !!m.fromMod,
  };
}

module.exports = { LINES, LINE_OF_BIRTH, lineOfBirth, init, stateOf, lineInfo, advance, nextAct, setFlag, hasFlag, briefOf };
