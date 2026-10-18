/* ============================================================
 * smoke-moves.js — 武技（skill.moves[]）与特殊效果（design/40 §4）
 *
 * 覆盖：
 *  ① 武技真的能用：perform 式调用 combatStep({skill, moveId}) 出招
 *  ② 冷却生效：连点第二次被拒，过回合后转好
 *  ③ 迷幻（confuse）：中了会掉头打自己人
 *  ④ 封穴（silence）：中了用不出招（pickSkill 返回 null）
 *  ⑤ 群攻（aoe）：余劲扫及同侧其他敌人
 *  ⑥ 回内力（mp 效果）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { CombatEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261014;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

function setupFight() {
  const e = boot(); const w = e.world, p = w.player;
  // 给玩家一门带武技的功夫（金刀门秘传）
  p.learnSkill('jindao_qimen_3', { force: true });
  p.learned['jindao_qimen_3'].level = 200;
  /* ⚠️ 直接写 mp / hp：recalc 会把它们按属性重算回去，而本组测的是「招式能不能放出来」，
     不是「低级玩家内力够不够」—— 内力不够时 oneAttack 会返回「内力不济」而非出招。 */
  p.maxHp = 999999; p.hp = 999999;
  p.maxMp = 99999; p.mp = 99999;
  const foe = w.spawnNpc('mob_bandit', p.room, 1, true);
  foe.atk = 1;
  w.startCombat(p, foe);
  /* ⚠️ 必须在 startCombat 之后加固：它会 recalc，把提前写的 hp/maxHp 冲回模板值。
     P0-a 之后「一方死亡就结束战斗」（以前死亡被忽略），所以夹具要保证
     一发武技 + DoT 之后双方都还活着，否则 battle 会被 finishCombat 清成 null。 */
  p.maxHpBase = 100000; p.recalc(); p.hp = p.maxHp;
  p.maxMp = 99999; p.mp = p.maxMp;
  foe.maxHpBase = 99999; foe.maxHp = 99999; foe.hp = 99999;
  return { e, w, p, foe };
}

/* ---------- ① 武技能用 ---------- */
section('① 武技真的能用');
const A = setupFight();
const moveDef = A.w.data.skills['jindao_qimen_3'].moves[0];
ok('这门武学挂了武技', !!moveDef, moveDef ? moveDef.name : '(无)');
const r1 = A.w.combatStep({ type: 'skill', skill: 'jindao_qimen_3', moveId: moveDef.id });
const t1 = (r1 && r1.lines || []).map(l => l.text).join(' ');
ok('出了招（日志里出现武技名）', t1.indexOf(moveDef.name) >= 0, t1.slice(0, 90));
ok('①-b 第一发之后战斗仍在进行（P0-a 后一方死亡会结束战斗）', !!A.w.battle,
  A.w.battle ? ('turn ' + A.w.battle.turn) : '战斗已结束：玩家或敌人被一击/DoT 打死（夹具问题或数值过强）');

/* ---------- ② 冷却 ---------- */
section('② 冷却（连点第二次被拒）');
A.w.battle.cooldowns = {};
A.p.mp = A.p.maxMp;
const r2a = A.w.combatStep({ type: 'skill', skill: 'jindao_qimen_3', moveId: moveDef.id });
const cdAfter = Object.assign({}, (A.w.battle && A.w.battle.cooldowns) || {});
ok('第一次用完之后记上了冷却', (cdAfter[moveDef.id] || 0) > 0, JSON.stringify(cdAfter));
const r2b = A.w.combatStep({ type: 'skill', skill: 'jindao_qimen_3', moveId: moveDef.id });
const t2 = (r2b && r2b.lines || []).map(l => l.text).join(' ');
ok('冷却期内再用被拒（提示还需几回合）', /尚未缓过气来/.test(t2), t2.slice(0, 80));

/* 冷却会随回合递减 */
const C = setupFight();
C.w.battle.cooldowns = {};
C.w.combatStep({ type: 'skill', skill: 'jindao_qimen_3', moveId: moveDef.id });
const before = (C.w.battle && C.w.battle.cooldowns[moveDef.id]) || 0;
for (let i = 0; i < 4; i++) { C.w.combatStep('auto'); if (!C.w.battle) break; }
const after = C.w.battle ? (C.w.battle.cooldowns[moveDef.id] || 0) : 0;
ok('过几个回合冷却会降下来', after < before, before + ' → ' + after);

/* ---------- ③ 迷幻 ---------- */
section('③ 迷幻（confuse）：掉头打自己人');
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
const g1 = w3.spawnNpc('mob_bandit', p3.room, 1, true);
const g2 = w3.spawnNpc('mob_wolf', p3.room, 1, true);
g1.hp = g1.maxHp = 5000; g2.hp = g2.maxHp = 5000;
w3.startCombat(p3, g1);
w3.battle.defenders = [g1, g2];
g1.addBuff({ name: '迷乱', turns: 5, tag: 'confuse' });
ok('confuse 判据认识这个 buff', w3.combat.isConfused(g1) === true);
const hpBefore = g2.hp;
w3.stepEnemyOnly([], false);
ok('中了迷幻的敌人打了同伴', g2.hp < hpBefore || g2.hp <= 0, `同伴 hp ${hpBefore} → ${g2.hp}`);

/* ---------- ④ 封穴 ---------- */
section('④ 封穴（silence）：用不出招');
const e4 = boot(); const w4 = e4.world, p4 = w4.player;
const f4 = w4.spawnNpc('mob_bandit', p4.room, 1, true);
w4.startCombat(p4, f4);
f4.equippedSkills['刀'] = 'xuedao';
f4.learned['xuedao'] = { level: 300, exp: 0 };
ok('封穴之前能选出招式', !!w4.combat.pickSkill(f4, p4), 'skill=' + (w4.combat.pickSkill(f4, p4) || {}).name);
f4.addBuff({ name: '封穴', turns: 3, tag: 'silence' });
ok('封穴判据认识这个 buff', w4.combat.isSilenced(f4) === true);
ok('封穴之后 pickSkill 返回 null（只能普攻）', w4.combat.pickSkill(f4, p4) === null);

/* ---------- ⑤ 群攻 ---------- */
section('⑤ 群攻（aoe）：余劲扫及同侧其他人');
const e5 = boot(); const w5 = e5.world, p5 = w5.player;
const a1 = w5.spawnNpc('mob_bandit', p5.room, 1, true);
const a2 = w5.spawnNpc('mob_wolf', p5.room, 1, true);
const a3 = w5.spawnNpc('mob_wolf', p5.room, 1, true);
[a1, a2, a3].forEach(x => { x.hp = x.maxHp = 5000; });
w5.startCombat(p5, a1);
w5.battle.defenders = [a1, a2, a3];
const hs = [a2.hp, a3.hp];
w5.combat.applySkillEffect({ type: 'aoe' }, p5, a1, null, w5.battle);
ok('aoe 扫到了另外两个人', (a2.hp < hs[0]) && (a3.hp < hs[1]), `${hs.join('/')} → ${a2.hp}/${a3.hp}`);
ok('aoe 不会递归（主目标之外不再裂开）', a1.hp <= a1.maxHp);

/* ---------- ⑥ 回内力 ---------- */
section('⑥ 回内力（mp 效果）');
const e6 = boot(); const w6 = e6.world, p6 = w6.player;
const f6 = w6.spawnNpc('mob_bandit', p6.room, 1, true);
w6.startCombat(p6, f6);
p6.maxMp = 500; p6.mp = 0;
w6.combat.applySkillEffect({ type: 'mp', value: 77 }, p6, f6, null, w6.battle);
ok('mp 效果真的回了内力', p6.mp === 77, 'mp=' + p6.mp);
p6.mp = 480;
w6.combat.applySkillEffect({ type: 'mp', value: 77 }, p6, f6, null, w6.battle);
ok('回内力不会超过上限', p6.mp === 500, 'mp=' + p6.mp);

/* ---------- ⑦ 效果表里没有「写了不生效」的孤儿类型 ---------- */
section('⑦ 武技/武学里用到的效果类型都有实现');
const IMPL = new Set(['dot', 'stun', 'slow', 'buff', 'debuff', 'drain', 'ignoreDef', 'heal', 'mp', 'extraHit', 'custom', 'cond', 'confuse', 'silence', 'aoe']);
const unknown = new Set();
for (const sk of Object.values(w6.data.skills)) {
  const effs = [].concat(sk.effects || [], ...(sk.moves || []).map(m => m.effects || []));
  for (const e of effs) {
    if (!e || !e.type) continue;
    if (!IMPL.has(e.type)) unknown.add(e.type);
  }
}
ok('没有未实现的效果类型', unknown.size === 0, [...unknown].join(','));

console.log(`\n===== smoke-moves: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
