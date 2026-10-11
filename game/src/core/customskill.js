/**
 * customskill.js — 武学自创（2026-10-11 自拟，上轮清单里我最想做的那件）
 *
 * 武侠里最浪漫的事之一：**把两门功夫揉成一门新的**。
 * 规矩我是这么定的（都写在这儿，免得以后再猜）：
 *
 *   ① **两门得同槽**（都是剑法、都是拳脚…）—— 不同槽的没法揉，
 *      你不可能把轻功和刀法化成一门（那是两回事，不是融合）。
 *   ② **两边都得练到火候**（各 ≥ 280 级）—— 没下过苦功的人谈什么化用。
 *   ③ **成功率**看悟性与资质，也看两门功夫练得多深；**失败会走火**（伤身、掉一点内力上限）。
 *   ④ 一个人**一辈子最多创三门**（`p.customSkills` 里最多 3 条）——
 *      真要满地都是自创武学，江湖就不值钱了。
 *   ⑤ 新功夫**继承两边**：威力取两者较高再往上加一点，槽位同它们，名字由玩家起。
 *
 * ⚠️ 新武学是**运行时生成**的：塞进 `world.data.skills` 之后所有人都取得到
 *    （`getSkill` 就是查那张表）。它随存档走 —— `deserialize` 时要**重新注入**，
 *    否则读档回来这门功夫就成了「不存在的武学」。这一条是本模块最容易忘的地方。
 */
'use strict';

const MIN_LEVEL = 280;      // 两门各要练到这个火候
const MAX_CUSTOM = 3;       // 一辈子最多创几门
const MP_COST = 200;        // 化用一次耗的内力

function hashN(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const pickBy = (arr, seed) => (arr && arr.length ? arr[hashN(seed) % arr.length] : '');

/** 已经创过几门 */
function countOf(p) { return p && p.customSkills ? Object.keys(p.customSkills).length : 0; }

/** 能不能拿这两门来化用 —— 不行就说清楚卡在哪 */
function canFuse(world, p, idA, idB) {
  const a = world.getSkill(idA), b = world.getSkill(idB);
  if (!a || !b) return { ok: false, why: '（没有这门武学）' };
  if (idA === idB) return { ok: false, why: '同一门功夫，揉不出新东西来。' };
  if (!p.learned[idA] || !p.learned[idB]) return { ok: false, why: '两门都得先学会。' };
  if (a.type !== b.type) {
    return { ok: false, why: `${a.name}是${a.type}，${b.name}是${b.type}——不同路的功夫揉不到一处去。` };
  }
  const lvA = p.learned[idA].level || 0, lvB = p.learned[idB].level || 0;
  if (lvA < MIN_LEVEL || lvB < MIN_LEVEL) {
    return {
      ok: false,
      why: `化用得两边都下过苦功（各要 ${MIN_LEVEL} 级）。你现在：${a.name} ${lvA} 级、${b.name} ${lvB} 级。`,
    };
  }
  if (countOf(p) >= MAX_CUSTOM) {
    return { ok: false, why: `一个人一辈子能自创的功夫有限（已创 ${MAX_CUSTOM} 门）。` };
  }
  if ((p.mp || 0) < MP_COST) return { ok: false, why: `内力不够（要 ${MP_COST}）。` };
  return { ok: true, a, b, lvA, lvB };
}

/** 化用的成功率：悟性资质打底，两门练得越深越稳 */
function successRate(p, lvA, lvB) {
  const wis = p.attrTotal('悟性'), apt = p.attrTotal('资质');
  const base = 0.18 + wis * 0.012 + apt * 0.010;
  const depth = Math.min(0.3, ((lvA + lvB) / 2 - MIN_LEVEL) / 2000);
  return Math.max(0.08, Math.min(0.85, base + depth));
}

/**
 * 试着把两门揉成一门新的。
 * @returns {{ok:boolean, skillId?:string, lines:Array}}
 */
function fuse(world, p, idA, idB, newName) {
  const c = canFuse(world, p, idA, idB);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.why }] };
  const name = String(newName || '').trim().slice(0, 10);
  if (name.length < 2) return { ok: false, lines: [{ kind: 'warn', text: '给这门功夫起个像样的名字（两字以上）。' }] };

  p.mp = Math.max(0, p.mp - MP_COST);
  const seed = `${p.name}|${idA}|${idB}|${name}`;
  const rate = successRate(p, c.lvA, c.lvB);
  const lines = [
    { kind: 'story', text: `你把${c.a.name}与${c.b.name}的路子在心里过了一遍又一遍。两门功夫的起手不一样，可到了第三招上，手是往同一个地方去的。` },
  ];

  if (world.rng.next() > rate) {
    /* 走火：伤身 + 掉一点内力上限 */
    const dmg = Math.floor((p.maxHp || 100) * 0.25);
    p.hp = Math.max(1, (p.hp || 1) - dmg);
    p.maxMpBase = Math.max(10, (p.maxMpBase || 50) - 6);
    p.recalc();
    lines.push({ kind: 'warn', text: `想到一半，两股气在胸口撞上了。你眼前一黑，扶着墙才没倒下。` });
    lines.push({ kind: 'sys', text: `走火：气血 −${dmg}，内力上限 −6。（这门功夫没成。）` });
    lines.push({ kind: 'hint', text: '（悟性、资质再高些，或者两门再练深些，成的机会更大。）' });
    return { ok: false, lines };
  }

  /* 成了：造一门新武学 */
  const newId = `custom_${hashN(seed).toString(36)}`;
  const slot = c.a.type;
  const dmg = Math.max(c.a.damageMult || 1, c.b.damageMult || 1) + 0.15;
  const acc = Math.max(10, Math.round(((c.a.accuracy || 80) + (c.b.accuracy || 80)) / 2));
  const skill = {
    id: newId, name,
    type: slot,
    grade: Math.max(c.a.grade || 5, c.b.grade || 5),
    maxLevel: 1000,
    difficulty: 1.8,
    desc: `你自己化出来的一门${slot}。起手是${c.a.name}的路子，到了中段又拐进${c.b.name}。`,
    damageMult: Math.round(dmg * 100) / 100,
    accuracy: acc,
    mpCost: 12,
    trainCost: 140,
    custom: true,
    from: [idA, idB],
    __source: '自创',
  };
  world.data.skills[newId] = skill;

  p.customSkills = p.customSkills || {};
  p.customSkills[newId] = { name, from: [idA, idB], at: world.clockMinutes || 0, slot };
  /* 学会了（走 force：这是你自己化出来的） */
  try { p.learnSkill(newId, { force: true }); } catch (e) { /* 学会失败也保住这门功夫的定义 */ }

  lines.push({ kind: 'story', text: `那一处忽然通了。你站住，把这一路从头到尾走了一遍——走完手心全是汗。` });
  lines.push({ kind: 'sys', text: `你自创了一门${slot}：「${name}」（威力 ${skill.damageMult}，由${c.a.name}与${c.b.name}化出）。` });
  lines.push({ kind: 'hint', text: `（要精进，用「练武学 ${name}」。一个人一辈子能创 ${MAX_CUSTOM} 门。）` });
  /* 自创一门功夫是江湖上最容易被传的一件事（自拟 🅔）——
     走过的、看见的、事后听说的，都会往外说「某某练出个新名堂」。 */
  try {
    const r = require('./rumorfeed').note(world, 'rs_skill_fuse', { vars: { whom: name } });
    if (r) lines.push({ kind: 'hint', text: '（练功的地方总有人守着看。这事捂不住。）' });
  } catch (e) { /* 传不出去不该挡着创功 */ }
  return { ok: true, skillId: newId, lines };
}

/**
 * 🔴 读档之后必须**把自创的功夫重新注回 `data.skills`** ——
 *    新武学只活在运行时的那张表里，存档只存了它的「身份」（id + 名字 + 来源）。
 *    不重新注入的话，读档回来它就成了「不存在的武学」：面板上看不到、练不了、
 *    连战斗里 pickSkill 都取不到（而且不会报错）。
 */
function rehydrate(world, p) {
  if (!p || !p.customSkills) return 0;
  let n = 0;
  for (const id of Object.keys(p.customSkills)) {
    const rec = p.customSkills[id];
    if (world.data.skills[id]) continue;
    const from = rec.from || [];
    const a = world.getSkill(from[0]) || {}, b = world.getSkill(from[1]) || {};
    world.data.skills[id] = {
      id, name: rec.name || '自创武学',
      type: rec.slot || a.type || '拳',
      grade: Math.max(a.grade || 5, b.grade || 5),
      maxLevel: 1000, difficulty: 1.8,
      desc: `你自己化出来的一门${rec.slot || a.type || '拳'}。`,
      damageMult: Math.round((Math.max(a.damageMult || 1, b.damageMult || 1) + 0.15) * 100) / 100,
      accuracy: Math.max(10, Math.round(((a.accuracy || 80) + (b.accuracy || 80)) / 2)),
      mpCost: 12, trainCost: 140, custom: true, from,
      __source: '自创（读档恢复）',
    };
    n++;
  }
  return n;
}

/** 列给面板看 */
function listOf(p) {
  if (!p || !p.customSkills) return [];
  return Object.keys(p.customSkills).map(id => ({
    id, name: p.customSkills[id].name,
    from: p.customSkills[id].from || [],
    slot: p.customSkills[id].slot || '',
  }));
}

module.exports = { fuse, canFuse, successRate, rehydrate, listOf, countOf, MIN_LEVEL, MAX_CUSTOM, MP_COST };
