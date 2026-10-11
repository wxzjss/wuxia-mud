/**
 * practice.js — 「练武学」（主人 2026-10-10 定的）
 *
 * 主人原话拆解：
 *   · 快捷键「练武学」点开 → 面板上列出**已学会的各武学名**，点一个就自动练
 *   · 「会自动消耗内力练，会有进度缓慢提升」
 *   · 「如果内力足够会一直练下去」→ 所以是**连续多轮**，直到内力见底或练到上限
 *   · 「内力上限越高低等级武学练的提升速度越快」→ 两个加速因子：
 *       ① 低等级本身快（`skillExpNeed(level)` 随等级递增，见 character.js）
 *       ② 内力上限越高越快（`1 + maxMp / 1200`，加在 trainMult 里）
 *
 * 与「请教」的分工：
 *   请教 = 师父把口诀讲给你听，**一次学会到 1 级**（force，不过前置校验）
 *   练武学 = 自己一遍遍运功，**把已经会的那门往深里磨**（走前置校验，一步一个脚印）
 */
'use strict';

const MAX_ROUNDS = 60;      // 一次最多连练多少轮（防内力判据出错时死循环）
const MIN_MP = 1;           // 内力见底就停

/**
 * 一口气练一门武学。
 * @returns {{ok:boolean, rounds:number, from:number, to:number, mpUsed:number, hitCap:boolean, lines:Array, reason:string}}
 */
function practice(world, ch, skillId) {
  const sd = world.getSkill(skillId);
  if (!sd) return { ok: false, rounds: 0, lines: [{ kind: 'warn', text: '（没这门武学）' }], reason: 'noskill' };
  if (!ch.learned[skillId]) return { ok: false, rounds: 0, lines: [{ kind: 'warn', text: `你还没学过「${sd.name}」。` }], reason: 'notlearned' };
  if (world.battle) return { ok: false, rounds: 0, lines: [{ kind: 'warn', text: '交着手呢，静不下心练功。' }], reason: 'battle' };

  const from = ch.learned[skillId].level || 0;
  const mp0 = ch.mp || 0;
  const lines = [];
  let rounds = 0, hitCap = false, reason = '';

  for (let i = 0; i < MAX_ROUNDS; i++) {
    const cur = ch.learned[skillId].level || 0;
    if (cur >= ch.effectiveMax(sd)) { hitCap = true; reason = 'cap'; break; }
    if ((ch.mp || 0) <= MIN_MP) { reason = 'mp'; break; }
    const r = ch.learnSkillByTrain(skillId);
    if (!r || !r.ok) { reason = 'blocked'; if (r && r.msg) lines.push({ kind: 'warn', text: r.msg }); break; }
    rounds++;
  }
  const to = ch.learned[skillId].level || 0;
  const mpUsed = Math.round(mp0 - (ch.mp || 0));

  const gainTxt = to > from ? `「${sd.name}」${from} → ${to} 级` : `「${sd.name}」仍是 ${to} 级`;
  const why = reason === 'mp' ? '内力耗尽了' : reason === 'cap' ? '已到你这门功夫的进境极限了' : reason === 'battle' ? '' : '练不下去了';
  lines.unshift({
    kind: 'sys',
    text: `你一遍遍运功拆招，共练 ${rounds} 轮，耗内力 ${mpUsed}——${gainTxt}。` + (why ? `（${why}）` : ''),
  });
  if (reason === 'cap') {
    const need = ch.maxSkillLevelFor(sd);
    lines.push({ kind: 'hint', text: `（${sd.name}的进境上限是 ${ch.effectiveMax(sd)} 级${need > ch.effectiveMax(sd) ? '，受基础武学火候所限' : ''}；想再高，得先把内力上限与悟性提上去。）` });
  }
  return { ok: true, rounds, from, to, mpUsed, hitCap, reason, lines };
}

/**
 * 面板数据：已学会的武学清单（供「练武学」面板渲染）。
 * 按「离上限还差多少」排序 —— 快到头的那几门排在后面，免得玩家盯着没用的点。
 */
function listFor(world, ch) {
  const out = [];
  for (const sid of Object.keys(ch.learned || {})) {
    const sd = world.getSkill(sid);
    if (!sd) continue;
    const lv = ch.learned[sid].level || 0;
    const cap = ch.effectiveMax(sd);
    out.push({
      id: sid, name: sd.name, type: sd.type || '', grade: sd.grade || null,
      level: lv, cap, full: lv >= cap,
      profTier: sd.type ? null : null,
    });
  }
  out.sort((a, b) => (a.full - b.full) || (b.cap - b.level) - (a.cap - a.level));
  return out;
}

module.exports = { practice, listFor, MAX_ROUNDS, MIN_MP };
