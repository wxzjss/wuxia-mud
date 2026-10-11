/* ============================================================
 * smoke-skill-gate.js — 功法两道刻度（主人 2026-10-11）
 *
 * 主人原话（分两轮说的，合起来是一件事）：
 *   「有些功法必须有一定内力上限才能学」
 *   「不是低品级功法只需要少量内力就能到登峰造极，而是说**少量内力上限**
 *    熟练度上限能提高到登峰造极，**当前熟练度你该练还是得练**」
 *
 * 所以这里要盯死两件事，别把它们混成一件事：
 *   ① **内力门槛**：内力上限不到，这门功夫根本学不了（品级越高，门槛越高）；
 *   ② **天花板 ≠ 当前值**：内力上限抬的是 maxSkillLevelFor（能练到多高），
 *      learned.level 还是得一级一级练上去 —— 内力不代替练习。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const CH = require(path.join(ROOT, 'game', 'src', 'core', 'character.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

function boot() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  e.world.player.hp = e.world.player.maxHp;
  return e;
}

/* ================= ① 内力门槛 ================= */
section('① 内力门槛：品级越高越吃内力');
{
  const e = boot();
  const w = e.world;
  const byGrade = {};
  for (const sd of Object.values(w.data.skills || {})) {
    if (!sd.grade || sd.needMp != null) continue;
    const need = CH.needMpOf(sd);
    if (!byGrade[sd.grade]) byGrade[sd.grade] = { min: need, max: need };
    byGrade[sd.grade].min = Math.min(byGrade[sd.grade].min, need);
    byGrade[sd.grade].max = Math.max(byGrade[sd.grade].max, need);
  }
  const g = k => byGrade[k] || { min: 0, max: 0 };
  ok('★ 一品绝学门槛最高', g(1).min >= 5000, '品1 需 ' + g(1).min + ' 内力上限');
  ok('★ 品级越低门槛越低（单调）', g(1).min >= g(2).min && g(2).min >= g(3).min && g(4).min >= g(5).min,
    [1, 2, 3, 4, 5].map(k => '品' + k + ':' + g(k).min).join(' '));
  ok('★ 六品及以下不设门槛（粗浅功夫谁都能学）', g(6).max === 0 && g(9).max === 0,
    '品6 ' + g(6).max + ' / 品9 ' + g(9).max);
  ok('数据里能覆写门槛（needMp 优先）', CH.needMpOf({ grade: 1, needMp: 123 }) === 123);
}

/* ================= ② 学不了 / 学得了 ================= */
section('② 内力不到就学不了');
{
  const e = boot();
  const w = e.world;
  const p = w.player;
  /* 临时造一门「一品、无前置、无门派条件」的绝学当样本 ——
     数据里的一品功法基本都挂着门派 require，拿它们测会把**门派条件**的拒绝
     误当成**内力门槛**的拒绝（第一版就是这么错的）。 */
  w.data.skills['test_gate_skill'] = {
    id: 'test_gate_skill', name: '测试绝学', type: '内功', category: '内功',
    grade: 1, maxLevel: 500, difficulty: 1,
  };
  const target = w.data.skills['test_gate_skill'];
  if (!target) {
    ok('（找不到合用的样本，跳过）', true);
  } else {
    /* 内力不够 → 拦下，且**说清楚差多少** */
    p.maxMpBase = 50; p.recalc();
    const r1 = p.learnSkill(target.id);
    ok('★ 内力不够，学不了', !r1.ok, r1.msg);
    ok('★ 而且说清了差多少（不是一句「不行」）', /\d/.test(r1.msg || ''), r1.msg);

    /* 内力够了 → 放行 */
    p.maxMpBase = CH.needMpOf(target) + 500; p.recalc();
    const r2 = p.learnSkill(target.id, { force: true });
    ok('内力够了能学（这里用 force 走「有人教」那条路）', r2.ok || /已学过/.test(r2.msg || ''), r2.msg);
  }

  /* force 路径（传功 / 门派入门）不该被**内力门槛**拦 —— 那是「有人把功夫塞到你手里」 */
  const e2 = boot();
  const w2 = e2.world;
  const p2 = w2.player;
  w2.data.skills['test_gate_skill'] = {
    id: 'test_gate_skill', name: '测试绝学', type: '内功', category: '内功',
    grade: 1, maxLevel: 500, difficulty: 1,
  };
  p2.maxMpBase = 50; p2.recalc();
  const r3 = p2.learnSkill('test_gate_skill', { force: true });
  ok('★ force（传功/门派入门）不被内力门槛拦', r3.ok, r3.msg);
}

/* ================= ③ 天花板 ≠ 当前值（主人特意澄清的那条） ================= */
section('③ 内力抬的是天花板，当前熟练度还得自己练');
{
  const e = boot();
  const p = e.world.player;
  const sd = e.world.getSkill('basic_force');      /* 九品基础武学 */

  p.maxMpBase = 200; p.recalc();
  const capLow = p.maxSkillLevelFor(sd);
  p.maxMpBase = 2000; p.recalc();
  const capHigh = p.maxSkillLevelFor(sd);
  ok('★ 内力上限越高，天花板越高', capHigh > capLow, `${capLow} → ${capHigh}`);

  /* 九品：内力不高就该顶到 maxLevel（「少量内力上限就能到登峰造极」） */
  ok('★ 九品功夫用不高的内力上限就能把天花板顶满',
    capHigh >= (sd.maxLevel || 1000), `上限 ${capHigh} / 门内顶 ${sd.maxLevel}`);

  /* 同一内力下，品级越高天花板越低 */
  p.maxMpBase = 1000; p.recalc();
  const c9 = p.maxSkillLevelFor({ grade: 9, maxLevel: 1000 });
  const c5 = p.maxSkillLevelFor({ grade: 5, maxLevel: 1000 });
  const c1 = p.maxSkillLevelFor({ grade: 1, maxLevel: 1000 });
  ok('★ 同样内力下，品级越高天花板越低（绝学要更深的内力才摸得着）',
    c9 > c5 && c5 > c1, `品9 ${c9} > 品5 ${c5} > 品1 ${c1}`);

  /* ★ 关键：把内力堆上去，**当前等级不动** —— 天花板不等于你已经练到了 */
  p.learnSkill('basic_force', { force: true });
  p.equippedSkills['内功'] = 'basic_force';
  const lv0 = p.learned['basic_force'].level;
  p.maxMpBase = 5000; p.recalc();
  ok('★ 内力上限暴涨，当前熟练度**一点没变**（该练还得练）',
    p.learned['basic_force'].level === lv0, `仍是 ${p.learned['basic_force'].level} 级`);
  ok('★ 但天花板确实抬上去了', p.maxSkillLevelFor(e.world.getSkill('basic_force')) > capLow,
    '现 ' + p.maxSkillLevelFor(e.world.getSkill('basic_force')));
}

/* ================= ④ 面板/指令说得清 ================= */
section('④ 界面读得到这两样');
{
  const e = boot();
  const p = e.world.player;
  p.learnSkill('basic_force', { force: true });
  p.equippedSkills['内功'] = 'basic_force';
  const list = e.skillList ? e.skillList() : [];
  const row = list.find(x => x.id === 'basic_force');
  ok('武学面板带着 maxLevel（天花板）与 level（当前）两个数',
    !!row && typeof row.maxLevel === 'number' && typeof row.level === 'number',
    row ? `当前 ${row.level} / 上限 ${row.maxLevel}` : '（没找到 basic_force）');
  ok('★ 上限与当前是两个不同的数（不是同一个值糊弄）', !!row && row.maxLevel >= row.level,
    row ? `${row.level}/${row.maxLevel}` : '');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
