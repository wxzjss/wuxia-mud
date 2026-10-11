/* 属性机制重制：删等级系统，属性只与武学功法等级有关，玩家初始是凡人 */
const { GameEngine } = require('../game/src/core/engine.js');

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '✔' : '✘') + ' ' + name + (cond ? '' : ('  → ' + (extra !== undefined ? extra : 'FAIL'))));
  if (!cond) fail++;
};
const section = (t) => console.log('\n== ' + t + ' ==');

/* ============ 1. 凡人初始 ============ */
section('1. 凡人初始');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '凡人', gender: 'male' });
  const w = e.world, p = w.player;
  ok('开局无武学', Object.keys(p.learned).length === 0, Object.keys(p.learned).join(','));
  ok('境界不通武艺', e.realmName(p) === '不通武艺', e.realmName(p));
  ok('气血极低', p.maxHp < 100, 'maxHp=' + p.maxHp);
  ok('攻击极低', p.atk < 20, 'atk=' + p.atk);
}

/* ============ 2. 凡人打不过狼 ============ */
section('2. 凡人连狼都打不过');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '凡人', gender: 'male' });
  const w = e.world, p = w.player;
  const wolf = w.spawnNpc('mob_wolf', 'road_jiangnan_1', 1, true);
  ok('狼攻击远高于凡人', wolf.atk > p.atk * 2, '狼atk=' + wolf.atk + ' 凡人atk=' + p.atk);
  ok('狼气血远高于凡人', wolf.maxHp > p.maxHp * 2, '狼hp=' + wolf.maxHp + ' 凡人hp=' + p.maxHp);
}

/* ============ 3. 属性不随等级（level）变化 ============ */
section('3. 等级不再加属性');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '凡人', gender: 'male' });
  const w = e.world, p = w.player;
  /* 防御力数值读 defFinal —— def 是 NPC 模板对象的字段名（SPRINT1-ENG-02） */
  const a0 = p.atk, h0 = p.maxHp, d0 = p.defFinal;
  p.level = 99; // 直接把等级拉满
  p.recalc();
  ok('等级拉满不加攻击', p.atk === a0, 'atk ' + a0 + '→' + p.atk);
  ok('等级拉满不加气血', p.maxHp === h0, 'hp ' + h0 + '→' + p.maxHp);
  ok('等级拉满不加防御', p.defFinal === d0, 'defFinal ' + d0 + '→' + p.defFinal);
}

/* ============ 4. 练武变强 ============ */
section('4. 练武功法变强');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '凡人', gender: 'male' });
  const w = e.world, p = w.player;
  const a0 = p.atk, realm0 = e.realmName(p);
  p.learnSkill('basic_sword', { force: true });   // 武学重制：门派入门先授基础武学
  p.learnSkill('huashan_sword', { force: true }); // 华山剑法 bonus atk 30
  p.gainSkillExp('huashan_sword', 999999);
  p.recalc();
  ok('练剑法加攻击', p.atk > a0, 'atk ' + a0 + '→' + p.atk);
  ok('境界提升', e.realmName(p) !== realm0, realm0 + '→' + e.realmName(p));
}

/* ============ 5. 内功加气血 ============ */
section('5. 内功加气血内力');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '凡人', gender: 'male' });
  const w = e.world, p = w.player;
  const h0 = p.maxHp;
  // 找一个确定能学的内功
  const basicForce = w.data.skills['basic_force'];
  ok('存在基本内功', !!basicForce);
  if (basicForce) {
    const r = p.learnSkill('basic_force');
    if (r && r.ok !== false) {
      p.gainSkillExp('basic_force', 999999);
      p.recalc();
      ok('练内功加气血', p.maxHp > h0, 'hp ' + h0 + '→' + p.maxHp);
    } else {
      console.log('  （basic_force 有前置，跳过内功气血断言）');
    }
  }
}

console.log('\n' + '='.repeat(42));
console.log(fail === 0 ? '✅ 全部通过' : '❌ 失败 ' + fail + ' 项');
process.exitCode = fail === 0 ? 0 : 1;
