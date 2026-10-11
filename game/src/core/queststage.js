/* ============================================================
 * queststage.js —— 阶段解析 / 目标判定的**唯一**实现
 *
 * 为什么单独抽一个模块（2026-10-11）：
 *   这两件事原先各写各的 —— 面板（engine.questList）、自动检查（checkQuestAuto）、
 *   交任务（commands.tryReportQuest）三处各解析一遍。结果是**同一件事三套判据**：
 *     · 面板按 `descByLine` 换说法，交任务那边却读死 `desc`
 *     · 目标判定在 checkQuestAuto 走 `targetDone`（认 flag/item），
 *       在 tryReportQuest 却直接 `getVar` ⇒ **flag 与 item 类目标永远交不了**
 *       （主人报的「破庙搜查完成不了」就是这一族的第二次现形）
 *   凡是「同一概念有多个执行入口」，判定就必须是**同一份代码**。
 *
 * 认的能力（全部**可选**，不写就与从前一字不差）：
 *   · descByLine[line] / descByGender[gender]  —— 同一件事换说法（P2/P4）
 *   · targetsByGender / targetsByLine          —— 换一套目标（P4 的两种解法）
 *   · effectsByGender / effectsByLine          —— 换一段演出
 *   · lock:{flag, quest, name, msg}            —— 前置没做完 → locked:true（不静默）
 * ============================================================ */
'use strict';

let mainline = null;
function ml() { if (!mainline) { try { mainline = require('./mainline'); } catch (e) { mainline = null; } } return mainline; }

/** 玩家走哪条线（拿不到就当中立，绝不抛） */
function lineOf(p) {
  try { const m = ml(); return m ? m.stateOf(p).line : 'neutral'; } catch (e) { return 'neutral'; }
}

function genderOf(p) { return (p && p.gender === 'female') ? 'female' : 'male'; }

/**
 * 解析「这一刻真正生效的 stage」。
 * @param {object} p      玩家
 * @param {object} stage  原始 stage（可能是 undefined）
 * @param {object} [world] 取 lock 指向的任务名用（可省）
 */
function stageResolve(p, stage, world) {
  if (!stage) return null;
  const G = genderOf(p), L = lineOf(p);
  const pick = (obj) => (obj && (obj[G] || obj[L])) || null;
  const out = Object.assign({}, stage, {
    line: L,
    gender: G,
    desc: (stage.descByGender && stage.descByGender[G])
      || (stage.descByLine && stage.descByLine[L])
      || stage.desc || '',
    locked: false,
  });
  if (stage.targetsByGender || stage.targetsByLine) {
    out.targets = pick(stage.targetsByGender) || pick(stage.targetsByLine) || stage.targets || [];
  }
  if (stage.effectsByGender || stage.effectsByLine) {
    out.effects = pick(stage.effectsByGender) || pick(stage.effectsByLine) || stage.effects || [];
  }
  const lk = stage.lock;
  if (lk) {
    const ok = lk.flag ? !!p.hasFlag(lk.flag) : true;
    if (!ok) {
      out.locked = true;
      const q = (lk.quest && world && world.getQuest) ? (world.getQuest(lk.quest) || {}) : {};
      out.lockName = lk.name || q.name || lk.quest || '';
      out.lockMsg = lk.msg || ('这条路还没到时候 —— 先去把「' + (out.lockName || '那桩事') + '」了了。');
    }
  }
  return out;
}

/**
 * 单个任务目标是否达成。判据**按 kind 分开**，不能一律读 var：
 *   · item —— 数身上的物件（`countItem` 按 count 累加，数「堆数」会判错）
 *   · flag —— 看标记设没设（flag 住在 `p.flags`，而 `p.getVar` 读的是 `p.vars`，
 *             两者不是一个地方 —— 这正是破庙那条任务判不出来的原因）
 *   · 其余（room / kill / 自定义）—— 读计数 var
 */
function targetDone(p, qid, t) {
  if (!t) return true;
  if (t.kind === 'item') return p.countItem(t.key) >= (t.count || 1);
  if (t.kind === 'flag') return !!p.hasFlag(t.key);
  const vk = t.var || `q_${qid}_${t.id}`;
  return (p.getVar(vk) || 0) >= (t.count || 1);
}

/** 当前阶段的全部目标是否都达成 */
function targetsAllDone(p, qid, targets) {
  for (const t of (targets || [])) if (!targetDone(p, qid, t)) return false;
  return true;
}

module.exports = { lineOf, genderOf, stageResolve, targetDone, targetsAllDone };
