/* 第 4 批：采集（打水/切割/加工）+ 农田 冒烟测试 */
const { GameEngine } = require('../game/src/core/engine.js');
const gather = require('../game/src/core/gather.js');
const farm = require('../game/src/core/farm.js');

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '✔' : '✘') + ' ' + name + (cond ? '' : ('  → ' + (extra !== undefined ? extra : 'FAIL'))));
  if (!cond) fail++;
};
const section = (t) => console.log('\n== ' + t + ' ==');

/* ============ 1. 食物效果 ============ */
section('1. 食物 use 简化对象');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;

  p.food = 50; p.hp = 100;
  w.giveItem(p, 'cooked_meat', 1);
  e.exec('吃 烤肉');
  ok('熟食顶饱', p.food > 50, 'food=' + p.food);

  p.food = 50; p.hp = 100;
  w.giveItem(p, 'raw_meat', 1);
  e.exec('吃 生肉');
  ok('生肉几乎不顶饱', p.food < 55, 'food=' + p.food);
  ok('生肉恶心伤身', p.hp < 100, 'hp=' + p.hp);
}

/* ============ 2. 打水 ============ */
section('2. 打水（需容器）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;

  p.room = 'wild_pool';
  // 移除所有容器
  p.inventory = (p.inventory || []).filter(i => !((w.getItem(i.id) || {}).tags || []).includes('container'));
  ok('无容器时拒绝打水', !gather.hasContainer(w, p));
  p.water = 10;
  const r1 = e.exec('打水');
  /* ⚠️ 别断言 `p.water === 10` —— exec 末尾会 advanceTime(1)，
     现在走路/每分钟都扣 0.125 的水（连续结算，不是 minutes>=10 门槛）。
     所以「失败」的正确判据是「没被打水**补上去**」：扣完只会略低于 10，绝不会涨。 */
  ok('无容器打水失败（水位没被补上）', p.water < 10.5 && p.water > 8,
    'water=' + p.water + ' 期望 ~9.875（10 扣一分钟口渴）');
  ok('无容器打水有明确提示', /容器/.test((r1.lines || []).map(l => l.text).join('')));

  // 有容器
  w.giveItem(p, 'leather_waterskin', 1);
  ok('有容器时能打水', gather.hasContainer(w, p));
  e.exec('打水');
  ok('打水解渴', p.water > 10, 'water=' + p.water);

  // 非水源房间
  p.room = 'jiangnan_gate';
  const r2 = e.exec('打水');
  ok('非水源拒绝', (r2.lines || []).some(l => /没有水/.test(l.text || '')), (r2.lines || []).map(l => l.text).join(''));
}

/* ============ 3. 生肉加工 ============ */
section('3. 生肉加工（客栈/酒楼）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.money = 100;

  p.room = 'jn_wine_house';
  w.giveItem(p, 'raw_meat', 1);
  const before = p.money;
  e.exec('加工');
  ok('加工得熟肉', (p.inventory || []).some(i => i.id === 'cooked_meat'));
  ok('加工耗生肉', !(p.inventory || []).some(i => i.id === 'raw_meat'));
  ok('加工扣费', p.money < before, 'money=' + p.money);

  // 非酒楼客栈拒绝
  p.room = 'jiangnan_street';
  w.giveItem(p, 'raw_meat', 1);
  const r = e.exec('加工');
  ok('非厨房拒绝', (r.lines || []).some(l => /客栈|酒楼/.test(l.text || '')), (r.lines || []).map(l => l.text).join(''));
}

/* ============ 4. 尸体切割 ============ */
section('4. 尸体切割（需利器，只能切野兽）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'wild_forest_2';

  // 无利器
  w.instances.corpses['c1'] = { id: 'c1', name: '野狼的尸体', room: p.room, loot: [], kind: 'beast', desc: '野狼的尸身' };
  const r0 = e.exec('切割');
  ok('无利器拒绝', (r0.lines || []).some(l => /利器/.test(l.text || '')), (r0.lines || []).map(l => l.text).join(''));

  // 有利器切野兽
  w.giveItem(p, 'hunting_knife', 1);
  e.exec('切割');
  ok('切野兽得生肉', (p.inventory || []).some(i => i.id === 'raw_meat'));
  ok('野兽尸体被移除', !w.instances.corpses['c1']);

  // 人的尸体不能切
  w.instances.corpses['c2'] = { id: 'c2', name: '路人甲的尸体', room: p.room, loot: [], kind: 'human', desc: '路人甲的尸身' };
  const r2 = e.exec('切割');
  ok('人尸体拒绝切割', (r2.lines || []).some(l => /下不去手|丧尽天良/.test(l.text || '')), (r2.lines || []).map(l => l.text).join(''));
}

/* ============ 5. 农田 ============ */
section('5. 农田种植');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.money = 1000;

  p.room = 'jn_farm_house';
  e.exec('买地');
  ok('买地成功', !!(p.farm && p.farm.plot), JSON.stringify(p.farm));

  p.room = p.farm.plot;
  w.giveItem(p, 'seed_rice', 1);
  e.exec('种植 稻种');
  ok('种植成功', p.farm.seedId === 'seed_rice', p.farm.seedId);

  const r1 = e.exec('收割');
  ok('未成熟拒绝收割', (r1.lines || []).some(l => /还没长成/.test(l.text || '')), (r1.lines || []).map(l => l.text).join(''));

  // 快进 3 天
  w.clockMinutes += 4320 + 60;
  e.exec('收割');
  ok('成熟后收割得稻米', (p.inventory || []).some(i => i.id === 'rice'));
}

/* ============ 6. 偷庄稼 ============ */
section('6. 偷庄稼');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jn_farm_2';

  const r = e.exec('偷庄稼');
  const gotVeg = (p.inventory || []).some(i => i.id === 'vegetable');
  const wanted = p.wanted > 0;
  ok('偷庄稼要么得青菜要么被抓', gotVeg || wanted, 'gotVeg=' + gotVeg + ' wanted=' + p.wanted);
}

/* ============ 7. 存档往返（农田状态） ============ */
section('7. 存档往返（农田）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.money = 1000;
  p.room = 'jn_farm_house';
  e.exec('买地');
  p.room = p.farm.plot;
  w.giveItem(p, 'seed_vegetable', 1);
  e.exec('种植 菜种');
  const before = JSON.stringify(p.farm);

  const save = w.serialize();
  const e2 = new GameEngine({ seed: 20261010 });
  e2.boot();
  e2.world.deserialize(JSON.parse(JSON.stringify(save)), []);
  ok('农田状态随档恢复', JSON.stringify(e2.world.player.farm) === before, JSON.stringify(e2.world.player.farm));
}

console.log('\n' + '='.repeat(42));
console.log(fail === 0 ? '✅ 全部通过' : '❌ 失败 ' + fail + ' 项');
process.exitCode = fail === 0 ? 0 : 1;
