#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-newbie-curve.js —— 新手区战斗曲线（三档写死，可复跑）
 *  口径（team-lead 2026-10-18）：
 *    ① 裸新档（wuxue，只走主线、不练功）
 *    ② +长拳（掏灰授 jh_fist）
 *    ③ +长拳+猎刀（掏灰塞 hunting_knife 并装备）
 *  每档跑 3 个种子（7/8/9），报：胜场 / 中位回合 / 胜时剩血。
 *  判定（软）：
 *    · 裸新档 vs 山贼 ≥2/3 胜，且胜时剩血 ≤60 ⇒ PASS（险胜，不是碾也不是必输）
 *    · ③ 应 ≥ ①（拿刀不能更弱）；现在 ② 的出招选择未接，③ 会低于 ① —— 标 ⚠ 而非 FAIL
 *  用法：
 *    node tools/combat-newbie-curve.js            # 山贼（默认）
 *    node tools/combat-newbie-curve.js mob_wolf   # 换怪
 * ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const ARGS = process.argv.slice(2);
const STRICT = ARGS.includes('--strict');            // 引擎①②接线后用它：③ 低于① 直接 FAIL
const MOB = ARGS.find(a => !a.startsWith('--')) || 'mob_bandit';
const SEEDS = [7, 8, 9];

function fight(seed, build) {
  const e = new GameEngine({ seed });
  e.boot();
  e.newGame({ name: '新档', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  if (build >= 2) p.learnSkill('jh_fist', { force: true });
  if (build >= 3) {
    w.giveItem(p, 'hunting_knife', 1);
    const it = (p.inventory || []).find(x => x.id === 'hunting_knife');
    if (it) w.equipItem(p, it.uid);
  }
  const n = w.spawnNpc(MOB, p.room, 1, true);
  const maxHp = p.maxHp;
  w.startCombat(p, n);
  let rounds = 0;
  while (w.battle && rounds < 40) { e.exec('attack'); rounds++; }
  return { rounds, hp: p.hp, maxHp, win: n.hp <= 0, foeHp: n.hp };
}

const NAMES = ['① 裸新档', '② +长拳', '③ +长拳+猎刀'];
const res = [];
for (let b = 1; b <= 3; b++) {
  const runs = SEEDS.map(s => fight(s, b));
  const wins = runs.filter(r => r.win).length;
  const rounds = runs.map(r => r.rounds).sort((a, c) => a - c);
  const winHps = runs.filter(r => r.win).map(r => r.hp).sort((a, c) => a - c);
  res.push({ b, name: NAMES[b - 1], wins, medRounds: rounds[1], winHp: winHps.length ? winHps[Math.floor(winHps.length / 2)] : null, runs });
}

console.log('\n=== 新手区曲线：' + MOB + '（新档 wuxue，种子 ' + SEEDS.join('/') + '）===');
for (const r of res) {
  console.log(`${r.name}：胜 ${r.wins}/3 · 中位回合 ${r.medRounds} · 胜时剩血 ${r.winHp == null ? '—' : r.winHp + '/' + r.runs[0].maxHp}`);
  console.log('   明细：' + r.runs.map(x => `${x.rounds}回${x.win ? '胜' : '负'}(${x.hp}血/敌${x.foeHp})`).join(' · '));
}

const bare = res[0], knife = res[2];
const passBare = bare.wins >= 2 && (bare.winHp == null || bare.winHp <= 60);
console.log('\n判定：');
console.log('  ' + (passBare ? '✔' : '✘') + ` ① 裸新档 ≥2/3 胜且剩血 ≤60（险胜）`);
const knifeOk = knife.wins >= 2;                     // team-lead 终验：③ ≥2/3
if (!knifeOk && STRICT) {
  console.log(`  ✘ ③ 拿刀档未达标（${knife.wins}/3，要求 ≥2/3）——严格模式 FAIL`);
} else if (knife.wins < bare.wins) {
  console.log(`  ⚠ ③ 拿刀比裸档更弱（${knife.wins}/3 vs ${bare.wins}/3）——等引擎「武器匹配出招 / 拳脚免惩罚」接线后加 --strict 复跑`);
} else {
  console.log(`  ✔ ③ 拿刀不弱于裸档（${knife.wins}/3 vs ${bare.wins}/3）`);
}
process.exit(passBare && (!STRICT || knifeOk) ? 0 : 1);
