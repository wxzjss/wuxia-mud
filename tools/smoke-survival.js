/* 第 3 批：生存（饥渴致死/复活）+ 打工 + 青楼 + 时间作息 冒烟测试 */
const { GameEngine } = require('../game/src/core/engine.js');
const survival = require('../game/src/core/survival.js');
const workMod = require('../game/src/core/work.js');

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '✔' : '✘') + ' ' + name + (cond ? '' : ('  → ' + (extra !== undefined ? extra : 'FAIL'))));
  if (!cond) fail++;
};

const section = (t) => console.log('\n== ' + t + ' ==');

/* ============ 1. 饥渴致死 → 复活到最近客栈 ============ */
section('1. 饥渴致死与复活');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  p.food = 0; p.water = 100; p.hp = 3;
  for (let i = 0; i < 6; i++) { e.exec('look'); if (p.room !== 'jiangnan_street') break; }
  ok('饿死触发', p.deathCount >= 1, 'deathCount=' + p.deathCount);
  ok('复活到客栈', /客栈/.test((w.getRoom(p.room) || {}).name || ''), (w.getRoom(p.room) || {}).name);
  ok('复活补满部分饱食', p.food > 0, 'food=' + p.food);
  ok('复活后未死', !p.dead);
}

section('2. 渴死');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  p.food = 100; p.water = 0; p.hp = 3;
  for (let i = 0; i < 6; i++) { e.exec('look'); if (p.room !== 'jiangnan_street') break; }
  ok('渴死触发', p.deathCount >= 1, 'deathCount=' + p.deathCount);
}

/* ============ 2. 打工 ============ */
section('3. 打工');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.money = 100;

  p.room = 'jn_wine_house'; p.food = 100; p.water = 100;
  const before = p.money;
  const r = e.exec('打工');
  ok('酒楼跑堂赚钱', p.money > before, 'money=' + p.money);
  ok('打工耗饱食', p.food < 100, 'food=' + p.food);

  p.room = 'jn_pharmacy'; p.food = 100; p.water = 100;
  const b2 = p.money;
  e.exec('打工');
  ok('药店抓药赚钱', p.money > b2, 'money=' + p.money);

  p.room = 'jiangnan_street';
  const r3 = e.exec('打工');
  ok('非酒楼药店拒绝', (r3.lines || []).some(l => /没有你能干的活计/.test(l.text || '')), (r3.lines || []).map(l => l.text).join(''));

  // 饥渴干不动
  p.room = 'jn_wine_house'; p.food = 0;
  const r4 = e.exec('打工');
  ok('饥渴时拒绝打工', (r4.lines || []).some(l => /饥渴难耐/.test(l.text || '')), (r4.lines || []).map(l => l.text).join(''));
}

/* ============ 3. 青楼 ============ */
section('4. 青楼卖身/接客/赎身');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_brothel';
  p.money = 0;

  const r = e.exec('卖身');
  ok('女玩家卖身成功', !!(p.prostitution && p.prostitution.sold), JSON.stringify(p.prostitution));
  ok('卖身立得卖身银', p.money >= workMod.SELL_PRICE, 'money=' + p.money);
  ok('赎身债 > 卖身银', p.prostitution.debt > p.money, 'debt=' + p.prostitution.debt);

  // 接客
  const d0 = p.prostitution.debt;
  e.exec('接客');
  ok('接客减债', p.prostitution.debt < d0, 'debt ' + d0 + '→' + p.prostitution.debt);

  // 债没还清时赎身应拒绝
  const r1 = e.exec('赎身');
  ok('债未清时赎身拒绝', !!(p.prostitution && p.prostitution.sold), (r1.lines || []).map(l => l.text).join(''));

  // 还清债再赎身
  p.prostitution.debt = 0;
  const r2 = e.exec('赎身');
  ok('还清债后赎身成功', !p.prostitution.sold, JSON.stringify(p.prostitution));
  ok('赎身后自由', p.prostitution.redeemed === true);
}

section('5. 男玩家也能卖身（主人 2026-10-10 改的规矩：男身在楼里另有去处）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const p = e.world.player;
  p.room = 'jiangnan_brothel';
  /* 主人 2026-10-11：男身要先过青楼那条支线才卖得身 */
  const r0 = e.exec('卖身');
  ok('男玩家默认卖不了身', !/画了押/.test((r0.lines || []).map(l => l.text).join('')), (r0.lines || []).map(l => l.text).join('').slice(0, 50));
  p.setFlag('brothel_permit', true);
  const r = e.exec('卖身');
  ok('过了那条支线就卖得成', !!(p.prostitution && p.prostitution.sold), (r.lines || []).map(l => l.text).join('').slice(0, 60));
}

section('6. 卖身后活动范围限制');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_brothel';
  e.exec('卖身');
  // 先下楼到街道，再一路向南走，走出范围后应被拦
  e.exec('d');
  let blocked = false;
  for (let i = 0; i < 8; i++) {
    const r = e.exec('s');
    if ((r.lines || []).some(l => /不能擅离太远/.test(l.text || ''))) { blocked = true; break; }
  }
  ok('卖身后离太远被拦', blocked);
}

section('7. 卖身后复活点改青楼');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_brothel';
  e.exec('卖身');
  p.hp = 1; p.food = 0;
  for (let i = 0; i < 6; i++) { e.exec('look'); if (p.room !== 'jiangnan_brothel') break; }
  ok('卖身者复活回青楼', p.room === 'jiangnan_brothel' || /青楼|勾栏|教坊/.test((w.getRoom(p.room) || {}).name || ''), (w.getRoom(p.room) || {}).name);
}

/* ============ 4. 时间作息 ============ */
section('8. NPC 日夜作息挪位');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world;
  const sched = Object.values(w.data.npcs).find(d => d.schedule && d.schedule.day && d.schedule.night && d.schedule.day !== d.schedule.night);
  ok('存在有作息 NPC', !!sched);
  if (sched) {
    const inst = w.spawnNpc(sched.id, sched.schedule.day, 1, true);
    // 玩家挪到别处，避免「玩家眼前不动」跳过
    w.player.room = 'jiangnan_street';
    w.clockMinutes = 23 * 60; w.worldTick();
    ok('夜晚 NPC 回家', inst.room === sched.schedule.night, (w.getRoom(inst.room) || {}).name);
    w.clockMinutes = 10 * 60; w.worldTick();
    ok('白天 NPC 回工作地', inst.room === sched.schedule.day, (w.getRoom(inst.room) || {}).name);
  }
}

/* ============ 5. 存档往返：卖身状态 ============ */
section('9. 存档往返（卖身状态）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_brothel';
  e.exec('卖身');
  e.exec('接客');
  const before = JSON.stringify(p.prostitution);

  const save = w.serialize();
  const e2 = new GameEngine({ seed: 20261010 });
  e2.boot();
  e2.world.deserialize(JSON.parse(JSON.stringify(save)), []);
  const p2 = e2.world.player;
  ok('卖身状态随档恢复', JSON.stringify(p2.prostitution) === before, JSON.stringify(p2.prostitution));
}

/* ============ 打坐 / 疗伤 的资源约束 ============
   主人报：「运功疗伤消耗内力逐渐疗伤逐渐消耗，还有打坐是瞬间恢复全部内力，
   有些离谱了」。两条都改成有代价的渐进式。 */
section('打坐不是瞬间满蓝（主人报 bug）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '云生', gender: 'male', birth: 'wuxue' });
  const p = e.world.player;
  p.mp = 0;
  e.exec('打坐');
  ok('打坐一次不回满内力', p.mp > 0 && p.mp < p.maxMp, 'mp=' + p.mp + '/' + p.maxMp);
  const oneRound = p.mp;
  ok('单次回复有上限（<40% 上限）', oneRound / p.maxMp < 0.4,
    '回复占比 ' + Math.round(oneRound / p.maxMp * 100) + '%');
  ok('内力已满时打坐不刷回复', (() => {
    p.mp = p.maxMp;
    const r = e.exec('打坐');
    return /充盈|徒然/.test(r.lines.map(l => l.text).join(''));
  })(), '应提示内力已足');
}

section('运功疗伤要耗内力（主人报 bug）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '云生', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  const nei = Object.values(w.data.skills).find(s => s.type === '内功');
  if (nei) { p.learned[nei.id] = { level: 30, exp: 0 }; p.equippedSkills['内功'] = nei.id; p.recalc(); }

  ok('heal 指令已注册（快捷键不再「未知指令」）',
    typeof e.exec === 'function' && /内力/.test(e.exec('heal').lines.map(l => l.text).join('')),
    '疗伤文案里应提到内力');

  p.mp = p.maxMp; p.hp = 1;
  const mp0 = p.mp;
  const r1 = e.exec('heal');
  ok('疗伤真的扣内力', p.mp < mp0, 'mp ' + mp0 + '→' + p.mp);
  ok('疗伤真的回气血', p.hp > 1, 'hp=' + p.hp);
  ok('文案同时报两项（气血+内力）',
    /气血/.test(r1.lines.map(l => l.text).join('')) && /内力/.test(r1.lines.map(l => l.text).join('')));

  p.mp = 0; p.hp = 1;
  const r0 = e.exec('heal');
  ok('内力为零则寸步难行（拒绝疗伤）',
    /丹田空空|一丝内力/.test(r0.lines.map(l => l.text).join('')), '应有拒绝提示');

  p.hp = p.maxHp;
  ok('无伤时疗伤直接拒绝', /没有伤/.test(e.exec('heal').lines.map(l => l.text).join('')));

  /* 暗伤：内力见空还硬撑，三次减气血上限。
     注意用「内力只剩一点」（够付半次代价），不是 mp=0 ——
     mp=0 会被直接拒绝疗伤，那是设计好的，不是暗伤路径。 */
  const cap = p.maxHp;
  let scarMsg = '';
  p.scar = 0;
  for (let i = 0; i < 3; i++) {
    p.mp = 1; p.hp = Math.max(1, p.maxHp - 10);
    const rr = e.exec('heal');
    scarMsg = rr.lines.map(l => l.text).join('');
    ok('内力见底的那回合仍能疗一点（不是白嫖）', p.hp > Math.max(1, p.maxHp - 10) || /丹田空空/.test(scarMsg), 'hp=' + p.hp);
  }
  ok('三次掏空丹田硬撑 → 气血上限下降', p.maxHp < cap, cap + '→' + p.maxHp);
  ok('暗伤有明确文案', /暗积/.test(scarMsg), scarMsg.slice(0, 40));
}

console.log('\n' + '='.repeat(42));
console.log(fail === 0 ? '✅ 全部通过' : '❌ 失败 ' + fail + ' 项');
process.exitCode = fail === 0 ? 0 : 1;
