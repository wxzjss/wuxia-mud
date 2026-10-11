/* 功能 Mod 规则引擎 + 删等级后的 realm 条件 + 示例 Mod 修复 回归测试
   run: node tools/smoke-rules.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const { evalCond, evalEffects } = require('../game/src/core/modapi');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};

console.log('① realm 条件（删等级后衡量进度）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  ok('凡人 realm>=0 通过', evalCond('realm>=0', { player: p, world: w }));
  ok('凡人 realm>=1 不通过', !evalCond('realm>=1', { player: p, world: w }));
  ok('凡人 realm<=1 通过', evalCond('realm<=1', { player: p, world: w }));
  // 练武到小有所成
  p.learnSkill('basic_sword', { force: true }); p.learnSkill('basic_force', { force: true });
  p.learnSkill('huashan_sword', { force: true }); p.learnSkill('yijinjing', { force: true });
  p.gainSkillExp('basic_sword', 999999); p.gainSkillExp('basic_force', 999999);
  p.gainSkillExp('huashan_sword', 999999); p.gainSkillExp('yijinjing', 999999);
  ok('练武后 realm>=2 通过', evalCond('realm>=2', { player: p, world: w }));
  ok('练武后 realm>=3（练得更扎实，这一档也过）', evalCond('realm>=3', { player: p, world: w }));
}

console.log('② 战斗状态条件');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  w.battle = null;
  ok('非战斗 !combat 通过', evalCond('!combat', { player: p, world: w }));
  w.battle = {};
  ok('战斗中 !combat 不通过', !evalCond('!combat', { player: p, world: w }));
  w.battle = null;
}

console.log('③ 功能 Mod 规则引擎（multiply / onEvent / additive）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.reload();  // reload 加载所有 demo mod（含 demo_func）
  const w = e.world;
  ok('activeRules 收集到 demo_func 规则', w.activeRules.some(r => r.target === 'pot'));
  e.newGame({ name: '试剑', gender: 'male' });
  const p = w.player;

  // multiply pot（双倍潜能）
  const pot0 = p.potential;
  p.gainPotential(100);
  ok('multiply pot 生效（+100 → +200）', p.potential - pot0 === 200, p.potential - pot0);

  // multiply money（双倍金钱）—— 走 onNpcKilled 才触发，这里直接验证 ruleMult
  ok('ruleMult(money) = 2', w.ruleMult('money') === 2, w.ruleMult('money'));

  // onEvent onTick +hp（脱战回血）
  p.hp = 50;
  w.fireEvent('onTick', {});
  ok('onEvent onTick 脱战回血 +8', p.hp === 58, p.hp);

  // onEvent onKill +pot（击杀额外潜能，被双倍潜能乘成 +30）
  const pot1 = p.potential;
  w.fireEvent('onKill', { npc: { name: 'x' } });
  ok('onEvent onKill 额外潜能生效', p.potential > pot1, p.potential - pot1);

  // additive damageTaken（新手保护 realm<=1 减伤 5）
  ok('ruleAdd(damageTaken) 凡人 -5', w.ruleAdd('damageTaken') === -5, w.ruleAdd('damageTaken'));
}

console.log('④ evalEffects 字符串效果（回归之前 primitive 赋值报错）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  const mp0 = p.mp;
  let threw = false;
  try { evalEffects('+mp:50', { player: p, world: w }); } catch (err) { threw = true; }
  ok('字符串效果不报错', !threw);
  ok('+mp:50 生效', p.mp === Math.min(p.maxMp, mp0 + 50), p.mp - mp0);
}

console.log('⑤ 示例 Mod 修复');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.reload();
  const w = e.world;

  // demo_skill：功法 require 是 realm 门槛，不再是 level
  const sk = w.data.skills['taixu_jianyi'];
  ok('demo_skill 太虚剑意门槛改为 realm', sk && /realm>=/.test(sk.require || ''), sk && sk.require);

  // demo_quest：rewards 是数组形式
  const q = w.data.quests['q_demo_bandit'];
  ok('demo_quest rewards 是数组形式', q && Array.isArray(q.rewards), q && JSON.stringify(q.rewards).slice(0, 60));

  // demo_func：无双倍经验（exp），改为双倍潜能
  ok('demo_func 无双倍经验规则', !w.activeRules.some(r => r.target === 'exp' && r.__mod === 'demo_func'));
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
