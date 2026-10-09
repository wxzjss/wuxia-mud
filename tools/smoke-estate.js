/* smoke-estate.js —— 家园开辟新地块 + 资助NPC建家 */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(__dirname, '..', 'game', 'src', 'core', 'engine.js'));
const home = require(path.join(__dirname, '..', 'game', 'src', 'core', 'home.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261009 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}
/* 造一个有主院的世界：直接买宅（跳过衙门校验，测的是地块逻辑本身） */
function withHome(e, tier) {
  const p = e.world.player;
  p.money = 100000;
  p.room = home.YAMEN_ROOM;
  const r = e.exec('买宅 ' + tier);
  if (!p.home) throw new Error('withHome 失败：' + JSON.stringify(r.lines.map(l => l.text)));
  p.room = p.home;
  return r;
}

/* ① 创角与存档字段 */
sec('① 创角与存档字段');
{
  const e = boot();
  const p = e.world.player;
  ok('创角即有 estate 字段', !!p.estate && Array.isArray(p.estate.plots) && !!p.estate.sponsored);
  const sav = e.world.serialize();
  ok('estate 随存档走', !!sav.player.estate && Array.isArray(sav.player.estate.plots));
}

/* ② 无宅不能开垦 */
sec('② 无宅不能开垦');
{
  const e = boot();
  const r = e.exec('地块');
  ok('无宅时提示买宅', r.lines.some(l => /还没有宅子/.test(l.text)), JSON.stringify(r.lines.map(l => l.text).slice(0, 2)));
  const r2 = e.exec('开垦 练武场');
  ok('无宅开垦被拒', r2.lines.some(l => l.kind === 'warn'), JSON.stringify(r2.lines.map(l => l.text)));
}

/* ③ 开垦新地块 */
sec('③ 开垦新地块');
{
  const e = boot();
  withHome(e, 'cottage');
  const p = e.world.player;
  p.money = 100000;
  /* cottage 档可开：练武场 / 书房 */
  const list = e.exec('地块');
  ok('地块列表出得来', list.lines.some(l => /练武场/.test(l.text)));
  ok('高阶地块锁住（客卿院需 mansion）', list.lines.some(l => /客卿院/.test(l.text) && /一座宅院以上/.test(l.text)),
    JSON.stringify(list.lines.map(l => l.text).filter(t => /客卿院/.test(t))));

  /* 缺材料被拒 */
  p.inventory = [];
  const noMat = e.exec('开垦 练武场');
  ok('缺材料被拒', noMat.lines.some(l => /缺料/.test(l.text)), JSON.stringify(noMat.lines.map(l => l.text)));

  /* 给材料开垦 */
  e.world.giveItem(p, 'crop_rice', 20);
  e.world.giveItem(p, 'iron_ore', 20);
  const before = p.inventory.length;
  const b = e.exec('开垦 练武场');
  ok('开垦成功', b.lines.some(l => /开出了练武场/.test(l.text)), JSON.stringify(b.lines.map(l => l.text)));
  ok('地块记进 estate.plots', p.estate.plots.length === 1 && p.estate.plots[0].key === 'yard');
  ok('地块房间已建', !!e.world.getRoom(p.estate.plots[0].roomId));
  ok('主院多出往东的出口', (e.world.getRoom(p.home).exits || {}).e === p.estate.plots[0].roomId);
  ok('材料被扣除', p.countItem('crop_rice') < 20, 'rice=' + p.countItem('crop_rice'));
  ok('银两被扣', p.money < 100000);

  /* 走到练武场 */
  const plotRoom = p.estate.plots[0].roomId;
  p.room = p.home;
  const go = e.exec('east');
  ok('可走进练武场', p.room === plotRoom, 'room=' + p.room);
  const back = e.exec('west');
  ok('可走回主院', p.room === p.home, 'room=' + p.room);
}

/* ④ 地块升级 */
sec('④ 地块升级');
{
  const e = boot();
  withHome(e, 'cottage');
  const p = e.world.player;
  p.money = 100000;
  e.world.giveItem(p, 'crop_rice', 60); e.world.giveItem(p, 'iron_ore', 60);
  e.exec('开垦 练武场');
  const lv1 = p.estate.plots[0].level;
  const desc1 = e.world.getRoom(p.estate.plots[0].roomId).desc;
  e.exec('开垦 练武场');
  const lv2 = p.estate.plots[0].level;
  ok('地块可升级', lv2 === lv1 + 1, `${lv1}->${lv2}`);
  ok('升级后房间描述变化', e.world.getRoom(p.estate.plots[0].roomId).desc !== desc1);
  ok('升级不新建房间（数量仍为1）', p.estate.plots.length === 1);
}

/* ⑤ 地块效果真的进游戏（练武场→修炼加速；书房→悟性） */
sec('⑤ 地块效果接入');
{
  const e = boot();
  withHome(e, 'cottage');
  const p = e.world.player;
  p.money = 100000;
  /* 无场地基：修炼收益 */
  e.world.giveItem(p, 'crop_rice', 60); e.world.giveItem(p, 'iron_ore', 60);
  const skillId = Object.keys(p.learned || {})[0];
  const base = (() => {
    const p2 = e.world.player;
    p2.learned[skillId] = { exp: 0, level: 1 };
    const need = p2.skillExpNeed(1);
    const apt = p2.attrTotal('资质');
    let m = 1;
    for (const tk of p2.traits) { const td = e.world.getTrait(tk); if (td && td.trainMult) m *= td.trainMult; }
    return { need, apt, m };
  })();
  const effBefore = e.world.estateEffects();
  ok('无地块时 estateEffects 为空', !effBefore);

  e.exec('开垦 练武场');
  const eff = e.world.estateEffects();
  ok('练武场给修炼加速', eff && eff.trainMult > 0, JSON.stringify(eff));
  ok('练武场给淬体加成', eff && eff.cutiRate > 0);

  /* 书房 → 悟性 */
  const wisBefore = p.attrTotal('悟性');
  e.world.giveItem(p, 'crop_wheat', 20); e.world.giveItem(p, 'silk_thread', 20);
  const st = e.exec('开垦 书房');
  const okB = st.lines.some(l => /书房/.test(l.text)) && !st.lines.some(l => l.kind === 'warn');
  if (okB) {
    p.recalc();
    ok('书房提升悟性', p.attrTotal('悟性') > wisBefore, `${wisBefore}->${p.attrTotal('悟性')}`);
  } else {
    ok('书房提升悟性（前置失败：' + JSON.stringify(st.lines.map(l => l.text)) + '）', false);
  }
}

/* ⑥ 档位门槛 */
sec('⑥ 主宅档位门槛');
{
  const e = boot();
  withHome(e, 'courtyard');
  const p = e.world.player;
  p.money = 100000;
  e.world.giveItem(p, 'crop_wheat', 40); e.world.giveItem(p, 'iron_ore', 40);
  e.world.giveItem(p, 'herb_lingshen', 40); e.world.giveItem(p, 'herb_danggui', 40);
  e.world.giveItem(p, 'water_gourd', 40);
  const r = e.exec('开垦 丹房');
  ok('小院可开丹房', r.lines.some(l => /开出了丹房/.test(l.text)), JSON.stringify(r.lines.map(l => l.text)));
  const eff = e.world.estateEffects();
  ok('丹房给炼制加成', eff && eff.craftRate > 0);
  const g = e.exec('开垦 客卿院');
  ok('小院开不了客卿院', g.lines.some(l => l.kind === 'warn' && /须主院/.test(l.text)), JSON.stringify(g.lines.map(l => l.text)));
}

/* ⑦ 方向占用 */
sec('⑦ 同一方向不能重复开');
{
  const e = boot();
  withHome(e, 'courtyard');
  const p = e.world.player;
  p.money = 100000;
  for (const k of ['crop_wheat', 'iron_ore', 'herb_lingshen', 'herb_danggui', 'water_gourd', 'silk_thread']) e.world.giveItem(p, k, 40);
  /* 手工占掉北方向 */
  e.world.getRoom(p.home).exits.n = 'jiangnan_market';
  const r = e.exec('开垦 丹房');
  ok('方向被占则拒绝', r.lines.some(l => l.kind === 'warn' && /方位已经有出路/.test(l.text)), JSON.stringify(r.lines.map(l => l.text)));
}

/* ⑧ 存档往返：地块房与赞助家都要重建 */
sec('⑧ 存档往返');
{
  const e = boot();
  withHome(e, 'cottage');
  const p = e.world.player;
  p.money = 100000;
  e.world.giveItem(p, 'crop_rice', 60); e.world.giveItem(p, 'iron_ore', 60);
  e.exec('开垦 练武场');
  const plotId = p.estate.plots[0].roomId;
  const sav = JSON.parse(JSON.stringify(e.world.serialize()));
  ok('序列化带上地块房', sav.playerHomes.some(h => h.id === plotId));
  ok('序列化带上 plotKey', (sav.playerHomes.find(h => h.id === plotId) || {}).plotKey === 'yard');

  /* 新档恢复 */
  const e2 = new GameEngine({ seed: 1 });
  e2.boot();
  e2.world.deserialize(sav);
  const p2 = e2.world.player;
  ok('读档后地块记录还在', p2.estate.plots.length === 1 && p2.estate.plots[0].key === 'yard');
  ok('读档后地块房重建', !!e2.world.getRoom(plotId));
  ok('读档后主院出口还在', (e2.world.getRoom(p2.home).exits || {}).e === plotId);
  ok('读档后能反向走回', (() => { p2.room = plotId; e2.exec('west'); return p2.room === p2.home; })());
}

/* ⑨ 资助 NPC 建家 */
sec('⑨ 资助NPC建家');
{
  const e = boot();
  const p = e.world.player;
  p.money = 100000;
  /* 找一个同房、无家的 NPC */
  const npcs = Object.values(e.world.instances.npcs || {});
  /* C/B 层 NPC 现在都带 house:'house:<id>' 虚拟标记，
     资助盖房只对「没有真实房间」的人生效，所以按真实房间筛 */
  const realHome = v => v && !String(v).startsWith('house:') && e.world.data.rooms[v];
  let target = null;
  for (const n of npcs) {
    const d = e.world.data.npcs[n.defId] || {};
    if (!realHome(n.home) && !realHome(d.home)) { target = n; break; }
  }
  if (!target) {
    ok('找到无家NPC（数据问题：本局无房NPC）', false);
  } else {
    p.room = target.room;
    /* 好感太低 → 拒绝 */
    target.favor = 5;
    const lo = e.exec('资助 ' + target.name);
    ok('好感不足被拒', lo.lines.some(l => l.kind === 'warn' && /好感/.test(l.text)), JSON.stringify(lo.lines.map(l => l.text)));

    /* 好感够 → 建家 */
    target.favor = 60;
    const r = e.exec('资助 ' + target.name);
    ok('资助建家成功', r.lines.some(l => /起 屋|盖起/.test(l.text)), JSON.stringify(r.lines.map(l => l.text)));
    ok('NPC 有了 home', !!target.home);
    ok('模板 home 也写了（决定作息夜归）', !!(e.world.data.npcs[target.defId] || {}).home);
    ok('家房间已建', !!e.world.getRoom(target.home));
    ok('赞助记录写入 estate.sponsored', !!p.estate.sponsored[target.defId]);
    ok('好感上升', target.favor > 60, 'favor=' + target.favor);
    /* 再来一次 → 拒绝 */
    const again = e.exec('资助 ' + target.name);
    ok('已有家不再资助', again.lines.some(l => l.kind === 'warn'), JSON.stringify(again.lines.map(l => l.text)));
    /* 档里有这间房 */
    const sav = JSON.parse(JSON.stringify(e.world.serialize()));
    ok('序列化带上NPC家', sav.playerHomes.some(h => h.id === target.home));
  }
}

/* ⑩ 站内传送：赞助的 NPC 夜归自己家 */
sec('⑩ NPC 作息夜归');
{
  const e = boot();
  const p = e.world.player;
  p.money = 100000;
  const npcs = Object.values(e.world.instances.npcs || {});
  /* C/B 层 NPC 现在都带 house:'house:<id>' 虚拟标记，
     资助盖房只对「没有真实房间」的人生效，所以按真实房间筛 */
  const realHome = v => v && !String(v).startsWith('house:') && e.world.data.rooms[v];
  let target = null;
  for (const n of npcs) {
    const d = e.world.data.npcs[n.defId] || {};
    if (!realHome(n.home) && !realHome(d.home)) { target = n; break; }
  }
  if (target) {
    p.room = target.room;
    target.favor = 60;
    e.exec('资助 ' + target.name);
    ok('夜归地址写进 schedule', !!(target.def.schedule || {}).night, JSON.stringify(target.def.schedule));
    /* 强制夜间 */
    e.world.clockMinutes = 22 * 60;
    p.room = 'no_such_room_here';   // 让 NPC 不在玩家眼前
    if (typeof e.world.worldTick === 'function') e.world.worldTick(60);
    ok('夜间 NPC 回到自己家', target.room === target.home, 'room=' + target.room + ' home=' + target.home);
  } else {
    ok('找到可资助NPC', false);
  }
}

console.log('\n' + '='.repeat(48));
console.log(`  家园 smoke: ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);