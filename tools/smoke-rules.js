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
  /* 口径变更（主人 2026-10-11）：开局自带基础功夫 → realm 档位已经是 1（初窥门径），
     所以「realm>=1 不通过」不再成立。改判 2（小有所成）—— 那才是「真的练出样子」。 */
  ok('刚开局 realm>=2 不通过', !evalCond('realm>=2', { player: p, world: w }));
  ok('凡人 realm<=2 通过', evalCond('realm<=2', { player: p, world: w }));
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
  ok('activeRules 收集到 demo_func 规则', w.activeRules.some(r => r.target === 'exp'));
  e.newGame({ name: '试剑', gender: 'male' });
  const p = w.player;

  // multiply exp（双倍经验）—— 施工单 B：demo_func 改挂 exp ×2。
  // gainExp 的溢出会被升级吃掉，所以行为断言用「差半级经验必升级」，
  // 数值断言直接对 ruleMult（消费点 character.js gainExp）。
  // ⚠️ ruleMult(exp) 是全部已启用 mod 的乘积（e2e_cross 还有 ×3），不能直接比 2 ——
  //    按 __mod 归到 demo_func 头上算它自己的贡献
  const demoExpMult = w.activeRules
    .filter(r => r.target === 'exp' && r.__mod === 'demo_func')
    .reduce((a, r) => a * (r.value || 1), 1);
  ok('ruleMult(exp)：demo_func 贡献 ×2（双倍经验）', demoExpMult === 2, 'demo_func=' + demoExpMult + '，全局=' + w.ruleMult('exp'));
  const lv0 = p.level;
  p.gainExp(Math.ceil(p.expNeed(p.level) / 2));
  ok('multiply exp 生效（差半级经验 → 升级）', p.level > lv0, 'level ' + lv0 + ' → ' + p.level);

  // multiply money（双倍金钱）—— 走 onNpcKilled 才触发，这里直接验证 ruleMult
  ok('ruleMult(money) = 2', w.ruleMult('money') === 2, w.ruleMult('money'));

  // onEvent onTick +hp（脱战回血）
  p.hp = 50;
  w.fireEvent('onTick', {});
  ok('onEvent onTick 脱战回血 +8', p.hp === 58, p.hp);

  // onEvent onKill +money:20（击杀额外赏钱，施工单 D 换成玩家可见数值）
  const m1 = p.money;
  w.fireEvent('onKill', { npc: { name: 'x' } });
  ok('onEvent onKill 额外赏钱生效（+20）', p.money - m1 === 20, p.money - m1);

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

  // demo_func：双倍经验在册（施工单 B）；潜能规则已撤（施工单 D，潜能玩家不可见）
  ok('demo_func 双倍经验规则在册', w.activeRules.some(r => r.target === 'exp' && r.__mod === 'demo_func'));
  ok('demo_func 已无 pot 规则（潜能已废除，示例不再挂）', !w.activeRules.some(r => r.target === 'pot' && r.__mod === 'demo_func'));
}

console.log('⑥ 功能 Mod 宏指令（kind: macro —— 一条指令=多条）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.reload();                       // reload 后才有 demo_func 的规则
  e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;

  ok('demo_func 的宏规则进了 activeRules',
    w.activeRules.some(r => r.kind === 'macro' && r.target === '拾取'));
  ok('demo_func 的宏规则 effect 是 get all',
    (w.activeRules.find(r => r.kind === 'macro') || {}).effect === 'get all');

  /* ---- ① 纯展开：_macroOf 一层就换成多条 ---- */
  w.instances.items = { gi_a: { itemId: 'cloth_robe', room: p.room, count: 1 } };
  const m1 = e._macroOf('拾取', '拾取', {});
  ok('地上有东西时「拾取」展开成 get all', m1 && m1.norm === 'get all', m1 && m1.norm);
  /* 无门槛的宏：一条 → 多条（`;` 分段） */
  w.activeRules.push({ kind: 'macro', name: '双查', target: '双查', effect: 'look;score', __mod: 'test' });
  const m2 = e._macroOf('双查', '双查', {});
  ok('无门槛宏「双查」展开成两条指令', m2 && m2.norm === 'look;score', m2 && m2.norm);

  /* ---- ② 门槛：地上没东西时 room.items>0 不成立 → 不展开且**要说话** ----
     （旧代码里 `room.items` 不在条件白名单 ⇒ 整条被跳过 ⇒ 恒为真。这里钉住。） */
  w.instances.items = {};
  const condHere = e._macroOf('拾取', '拾取', {});
  ok('地上没东西时宏不展开（room.items>0 真的起作用）',
    !!condHere && !!condHere.blocked && !condHere.norm,
    condHere && JSON.stringify(condHere));
  const r0 = e.exec('拾取');
  ok('门槛没过时明确回一句「还用不了」，而不是「我不懂这个指令」',
    (r0.lines || []).some(l => /还用不了/.test(l.text || '')),
    (r0.lines || []).map(l => l.text).join(' | ').slice(0, 90));

  /* ---- ③ 端到端：地上放一件，敲「拾取」真的捡起来（展开成 get all） ---- */
  w.instances.items = { gi_macro_t: { itemId: 'cloth_robe', room: p.room, count: 1 } };
  const before = p.inventory.length;
  const r1 = e.exec('拾取');
  ok('宏展开真的执行了（地上那件进了背包）', p.inventory.length === before + 1,
    before + ' -> ' + p.inventory.length);
  ok('宏回包里没有「不懂」类报错',
    !(r1.lines || []).some(l => /不懂|不知道这是什么/.test(l.text || '')));

  /* ---- ④ 一条宏展开成两条指令，两条**都**真的执行了 ---- */
  const rm = e.exec('双查');
  ok('宏「双查」的回包不是空（look + score 都跑了）', (rm.lines || []).length > 0,
    (rm.lines || []).length);

  /* ---- ④ 自指不能死循环（A→A / A→B→A 都要能停） ---- */
  w.activeRules.push({ kind: 'macro', name: '自指', target: '自指', effect: '自指', __mod: 'test' });
  let hung = false;
  const t0 = Date.now();
  const mSelf = e._macroOf('自指', '自指', {});
  if (Date.now() - t0 > 2000) hung = true;
  ok('自指宏不死循环（A→A 立刻收手）', !hung && mSelf === null, JSON.stringify(mSelf));
  w.activeRules.push({ kind: 'macro', name: '甲', target: '甲', effect: '乙', __mod: 'test' });
  w.activeRules.push({ kind: 'macro', name: '乙', target: '乙', effect: '甲', __mod: 'test' });
  const mRing = e._macroOf('甲', '甲', {});
  ok('互指宏不死循环（甲→乙→甲 立刻收手）', mRing === null, JSON.stringify(mRing));

  /* ---- ⑤ 宏套宏（甲→乙→真指令）能一路展开到位 ---- */
  w.activeRules.push({ kind: 'macro', name: '丙', target: '丙', effect: 'look' });
  w.activeRules.push({ kind: 'macro', name: '丁', target: '丁', effect: '丙' });
  const mChain = e._macroOf('丁', '丁', {});
  ok('宏套宏一路展开到真指令（丁→丙→look）', mChain && mChain.norm === 'look', mChain && mChain.norm);

  /* ---- ⑥ 宏名对不上时放行（绝大多数指令走这条，别误伤） ---- */
  ok('无关指令返回 null（不误伤）', e._macroOf('look', 'look', {}) === null);

  /* ---- ⑦ 展开出来的指令要能点亮教程标记（排在 markTutorial 之前的意义） ---- */
  const mT = e._macroOf('拾取', '拾取', {});
  ok('展开结果就是要喂给教程标记的那串', mT && mT.norm === 'get all');
}

console.log('⑦ room.items / room.npcs 条件（以前不在白名单 ⇒ 恒为真）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  w.instances.items = {};
  ok('地上空时 room.items>0 不成立', !evalCond('room.items>0', { player: p, world: w }));
  ok('地上空时 roomItems>0 也不成立', !evalCond({ roomItems: '>0' }, { player: p, world: w }));
  w.instances.items = { gi_c1: { itemId: 'herb', room: p.room, count: 1 } };
  ok('地上有一件时 room.items>0 成立', evalCond('room.items>0', { player: p, world: w }));
  ok('对象写法 {"room.items":">0"} 也成立', evalCond({ 'room.items': '>0' }, { player: p, world: w }));
  ok('room.items > 5 不成立（不是恒真）', !evalCond('room.items>5', { player: p, world: w }));
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
