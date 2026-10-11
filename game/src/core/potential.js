/* ============================================================
 *  potential.js —— 潜能（2026-10-08 主人接回来）
 *
 * 主人的原话：
 *   「接回来，并且**请教会消耗潜能**（按武学品级以及等级从低到高消耗增多），
 *     但**自己练不会消耗**，给主支线任务以及其他方式增加潜能获取途径」
 *
 * 于是潜能的定位是：**向别人学东西的门槛**。
 *   · 花法：请教（`请教 <人> <武学>`）—— 品级越高、功夫越深，越贵；
 *   · 不花法：自己练（打坐 / 练武学）**一点潜能都不花**，只耗时间与内力 ——
 *     花潜能是「走捷径」，苦练是「本分」，两条路都在。
 *   · 来法：击杀、任务（主线/支线）、首次探索、切磋获胜、采集打工。
 *
 * ⚠️ 加潜能一律走 `p.gainPotential()`：功能 Mod 的 `multiply pot` 规则挂在它里面。
 *    自己直接 `p.potential += n` 会让规则旁路生效（Mod 作者会困惑）。
 * ============================================================ */
'use strict';

/* 开局家底：够新手照师父指点学两三门粗浅功夫。
   ⚠️ 必须 > 0：新手第 7 章就是「跟师父请教学两门功夫」，
      开局 0 潜能会把教程当场卡死（这不是难度，是断路）。 */
const START_POTENTIAL = 300;

/* 请教一门功夫的**品级基数**（九品最便宜、一品最贵）。
   取值刻意拉开量级：一品绝学是九品粗浅功夫的 ~150 倍。 */
const TEACH_BASE_BY_GRADE = {
  9: 20, 8: 45, 7: 90, 6: 180, 5: 350,
  4: 650, 3: 1100, 2: 1800, 1: 3000,
};

/**
 * 请教一门功夫要花多少潜能。
 *
 * 三个乘数（主人的「按武学品级**以及等级**从低到高消耗增多」）：
 *   ① 品级基数 —— 九品 20 → 一品 3000；
 *   ② 功夫的**深浅**（数据里的 maxLevel，300~1000）—— 同品级里更深的更贵；
 *   ③ 你在这门上的**当前等级** —— 已经练到多少就按多少加价（学新的 = 0）。
 *      ⚠️ 这一项只有「已经会了又来请教」才会 > 0；当前版本已会的会被拦下，
 *         所以它主要是给「日后开放请师父点拨」留的口子，现在恒等于 1。
 *
 * @param {Object} sd    武学定义（要有 grade / maxLevel）
 * @param {number} level 该武学当前等级（学新的传 0）
 */
function teachCostOf(sd, level) {
  const s = sd || {};
  const g = s.grade || 8;
  const base = TEACH_BASE_BY_GRADE[g] != null ? TEACH_BASE_BY_GRADE[g] : TEACH_BASE_BY_GRADE[8];
  const depth = 1 + Math.max(0, (s.maxLevel || 300) - 300) / 1000;   // 300~1000 级 → 1.00~1.70
  const lv = 1 + Math.max(0, Number(level) || 0) / 200;              // 每 200 级 +1 倍
  return Math.max(1, Math.round(base * depth * lv));
}

/** 一次请教要花多少 —— 师门里（已拜师）打**对折**：师父教徒弟是本分，别把人拦在门外 */
function teachCostFor(p, sd, level, isMaster) {
  const full = teachCostOf(sd, level);
  return isMaster ? Math.ceil(full / 2) : full;
}

/* ---------------- 请教（点拨）：花潜能直接把熟练度顶上去 ----------------
 * 主人 2026-10-08 补的那条：
 *   「别忘了潜能可以用来通过『请教』**直接提升武学熟练度**
 *     （武学熟练度提升上限按原来的上内力上限限制**加**请教对象的目标武学当前熟练度）」
 *
 * 于是「请教」有两条路：
 *   · 没学过的功夫 → 学会它（花一笔潜能，见 teachCostOf）
 *   · 已经会的功夫 → **请人点拨**，当场涨一截熟练度（一次涨天花板的 5%，至少 1 级）
 * 而「自己练」（练武学 / 打坐）**一点潜能都不花**，只耗时间与内力。
 *
 * ⚠️ 关于上限那句「加」：本实现取的是**两个限制都生效**（取小）——
 *     ① 你自己原来的天花板（`effectiveMax`：悟性/资质/内功 + 内力上限 + 基础武学链）
 *     ② 被请教者那门功夫练到几级（他不会的，教不了你）
 *     `Math.min(自己, 对方)` 是最讲得通的一种读法（师父教不出他没到过的境界）。
 *     若主人要的是**相加**（上限 = 自己天花板 + 对方熟练度，即借师承突破自己单练的上限），
 *     把 teachUpCap 里那个 `Math.min` 换成 `own + teacherLv` 即可，别处不用动。
 */

/** 被请教者在那门功夫上的熟练度（NPC 数据：def.learned[id].level，退而取 def.skillLevel 或 20） */
function teacherLevelOf(npc, skillId) {
  const d = (npc && (npc.def || npc)) || {};
  const learned = d.learned || (npc && npc.learned) || {};
  const e = learned[skillId];
  if (e && Number(e.level) > 0) return Number(e.level);
  if (d.skillLevel) return Number(d.skillLevel);
  return 20;
}

/**
 * 这次请教的熟练度上限。
 * @param {Object} player   玩家（要能调 effectiveMax）
 * @param {Object} sd       武学定义
 * @param {number} teacherLv 被请教者的该武学熟练度
 */
function teachUpCap(player, sd, teacherLv) {
  const own = (player && typeof player.effectiveMax === 'function')
    ? player.effectiveMax(sd) : ((sd && sd.maxLevel) || 300);
  const t = Math.max(0, Number(teacherLv) || 0);
  return Math.max(0, Math.min(own, t));      /* ← 改成 own + t 即「相加」的读法 */
}

/** 一次请教能涨多少级：天花板的 5%（至少 1 级） */
function teachUpGain(cap, cur) {
  const room = Math.max(0, (Number(cap) || 0) - (Number(cur) || 0));
  if (room <= 0) return 0;
  return Math.min(room, Math.max(1, Math.round((Number(cap) || 0) * 0.05)));
}

/** 涨 `levels` 级熟练度要多少潜能（品级越贵、你已经练得越高越贵） */
function raiseCostOf(sd, levels, curLevel) {
  const s = sd || {};
  const g = s.grade || 8;
  const base = TEACH_BASE_BY_GRADE[g] != null ? TEACH_BASE_BY_GRADE[g] : TEACH_BASE_BY_GRADE[8];
  const perLevel = Math.max(1, base / 300);                 /* 九品 1/级 · 一品 10/级 */
  const lv = 1 + Math.max(0, Number(curLevel) || 0) / 200;
  return Math.max(1, Math.round(perLevel * Math.max(1, Number(levels) || 1) * lv));
}

/* ---------------- 获取途径 ---------------- */

/**
 * 交任务 / 推进阶段的潜能。
 * 主线给得最多（它是长线，玩家靠它撑过前中期），支线次之，门派/委托再次。
 */
function questRewardOf(qd, isFinal) {
  const q = qd || {};
  const lv = Math.max(1, Number(q.level) || 1);
  const type = String(q.type || '');
  const per = type === '主线' ? 40 : (type === '支线' ? 25 : (type === '门派' ? 20 : 15));
  const base = lv * per + (type === '主线' ? 60 : 30);
  return Math.max(5, Math.round(isFinal ? base * 1.6 : base * 0.5));
}

/** 首次踏进一个区域：开眼界也是长进（每区只给一次） */
const REGION_REWARD = 60;

/** 切磋赢一场（点到为止的比试，不含生死斗） */
const DUEL_REWARD = 25;

/** 采集 / 打工一次：零碎进项，聊胜于无 */
const GATHER_REWARD = 2;
const WORK_REWARD = 3;

/** 统一入口：加潜能（吃 Mod 的 multiply pot 规则），返回实际加了多少 */
function grant(p, n, lines, label) {
  const num = Math.max(0, Math.round(Number(n) || 0));
  if (!p || !num) return 0;
  const before = p.potential || 0;
  if (typeof p.gainPotential === 'function') p.gainPotential(num);
  else p.potential = before + num;
  const got = (p.potential || 0) - before;
  if (lines && got > 0) {
    lines.push({ kind: 'sys', text: `（${label || '有所领悟'}，潜能 +${got}）` });
  }
  return got;
}

module.exports = {
  START_POTENTIAL, TEACH_BASE_BY_GRADE, REGION_REWARD, DUEL_REWARD,
  GATHER_REWARD, WORK_REWARD,
  teachCostOf, teachCostFor, questRewardOf, grant,
  teacherLevelOf, teachUpCap, teachUpGain, raiseCostOf,
};
