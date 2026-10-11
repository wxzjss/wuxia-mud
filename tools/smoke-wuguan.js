/* 城市武馆（主人 2026-10-11 点单）：
 *   各城市加「武馆」，馆里的教头基础武学很全；请教教头学基础武学要花钱，一次 100 铜。
 *
 * 跑法：node tools/smoke-wuguan.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* 城（区）→ { 武馆, 门牌（从哪儿进）, 方向, 回程方向 } */
const CITIES = [
  { region: 'jiangnan', wg: 'wg_jiangnan', host: 'jiangnan_market', from: 'nw', back: 'se' },
  { region: 'gusu', wg: 'wg_gusu', host: 'gusu_zhai_lane', from: 'n', back: 's' },
  { region: 'luoyang', wg: 'wg_luoyang', host: 'luoyang_market', from: 'nw', back: 'se' },
  { region: 'changan', wg: 'wg_changan', host: 'changan_market', from: 'nw', back: 'se' },
  { region: 'chengdu', wg: 'wg_chengdu', host: 'chengdu_market', from: 'nw', back: 'se' },
  { region: 'xiangyang', wg: 'wg_xiangyang', host: 'xiangyang_market', from: 'nw', back: 'se' },
];

(async () => {
  const e = new GameEngine({ seed: 1234 });
  await e.boot({});
  e.newGame({ name: '学武的' });
  const w = e.world, p = w.player;

  /* ================= 一、武馆都在，而且进得去出得来 ================= */
  section('1 六座城各一家武馆');
  ok('武馆数量对', Object.keys(w.data.rooms).filter(id => /^wg_/.test(id)).length === CITIES.length,
    Object.keys(w.data.rooms).filter(id => /^wg_/.test(id)).length + ' 家');

  let linked = 0, regionOk = 0, descOk = 0;
  for (const c of CITIES) {
    const wg = w.data.rooms[c.wg], host = w.data.rooms[c.host];
    ok(c.wg + ' 存在', !!wg, wg ? wg.name : '缺');
    if (wg) {
      if (wg.region === c.region) regionOk++;
      if (wg.desc && wg.desc.length > 30) descOk++;
      /* ⚠️ 出口是**对象合并**进来的：宿主房间原有出口必须原样还在，
         只多出通往武馆的那一条。（数组型字段是整段替换，对象型是按键合并。） */
      if (host && host.exits[c.from] === c.wg && wg.exits[c.back] === c.host) linked++;
      else ok(c.wg + ' 双向连通', false,
        'host.' + c.from + '=' + (host && host.exits[c.from]) + ' / wg.' + c.back + '=' + (wg.exits[c.back]));
    }
  }
  ok('★ 六家都是双向连通（从市集进得去、从武馆出得来）', linked === CITIES.length, linked + '/' + CITIES.length);
  ok('★ 武馆的 region 与所在城市一致（地图上不会飞出去）', regionOk === CITIES.length, regionOk + '/' + CITIES.length);
  ok('每家都有像样的房间描写', descOk === CITIES.length, descOk + '/' + CITIES.length);

  /* 宿主房间的原有出口没被揉掉 */
  const hostExitsBefore = { jiangnan_market: ['s', 'e', 'u', 'w'], luoyang_market: ['w', 'e', 's'] };
  for (const id of Object.keys(hostExitsBefore)) {
    const still = hostExitsBefore[id].every(d => w.data.rooms[id].exits[d]);
    ok('★ ' + id + ' 原有出口一条没丢（对象合并没把数组那套搬过来）', still,
      Object.keys(w.data.rooms[id].exits).join(''));
  }

  /* 真走一遍：从市集往 nw 走到武馆 */
  section('2 真走一遍（doMove，不是直接摆位）');
  const c0 = CITIES[0];
  w.movePlayerTo(p, c0.host);
  const r = await e.exec('西北');
  ok('★ 从' + w.data.rooms[c0.host].name + '走得进武馆',
    p.room === c0.wg, '现在在 ' + w.data.rooms[p.room].name);
  ok('屋里确实有教头', (w.npcsIn(p.room) || []).some(n => n.defId && n.defId.indexOf('wg_') === 0),
    (w.npcsIn(p.room) || []).map(n => n.name).join('、'));

  /* ================= 三、教头本人 ================= */
  section('3 教头：基础武学非常全面');
  const BASE = ['basic_fist', 'basic_sword', 'basic_blade', 'basic_staff', 'basic_whip',
    'basic_throw', 'basic_poison', 'basic_force', 'basic_dodge', 'basic_parry',
    'basic_medicine', 'basic_sing'];
  const teachers = Object.values(w.data.npcs).filter(n => n.id && n.id.indexOf('wg_') === 0);
  ok('六个教头都在数据里', teachers.length === CITIES.length, teachers.length + ' 位');
  ok('★ 每位都教全部 12 门基础武学',
    teachers.every(t => BASE.every(b => (t.teach || []).indexOf(b) >= 0)),
    teachers.map(t => (t.teach || []).length).join('/'));
  ok('★ 教头定价就是 100 文（一次 100 铜）', teachers.every(t => t.moneyToLearn === 100),
    [...new Set(teachers.map(t => t.moneyToLearn))].join(','));
  ok('教头待在自己的武馆里不走',
    teachers.every(t => t.noWander === true && w.data.rooms[t.room] && /^wg_/.test(t.room)),
    teachers.filter(t => !(t.noWander && /^wg_/.test(t.room || ''))).map(t => t.id).join(','));
  ok('教头有性格（不是空壳）', teachers.every(t => !!t.personality));

  /* ================= 四、请教要花钱 ================= */
  section('4 请教教头：一次 100 铜，花了才学得会');
  const teacher = w.npcsIn(p.room)[0];
  const list = require(path.join(ROOT, 'game/src/core/social.js')).teachList(w, teacher);
  /* ⚠️ 2026-10-11 契约更新：教头除了那 12 门基础武学，还**另授战斗辅助武技**
     （`95_support_moves.json` 那九门「保命招」：护体真气 / 燕子三抄水 / 卸力法…）。
     原来断的是「列表里全是 basic_*」——加了辅助武技之后这条必然红，
     而且它守的东西本来就该是「基础武学一门不落」，不是「除了基础武学别的都不许有」。 */
  const basics = list.filter(s => s.id.indexOf('basic_') === 0);
  ok('★ 12 门基础武学一门不落', basics.length >= 12, basics.length + ' 门');
  ok('教头另授战斗辅助武技（内功/轻功/招架的保命招）',
    list.some(s => s.id.indexOf('sup_') === 0),
    list.filter(s => s.id.indexOf('sup_') === 0).map(s => s.name).join('、') || '（没有）');
  ok('列表里没有来路不明的东西', list.every(s => /^basic_|^sup_|^jh_/.test(s.id)), list.length + ' 门');
  ok('★ 每门都标价 100 文', list.every(s => s.money === 100), [...new Set(list.map(s => s.money))].join(','));

  /* 钱不够 → 学不成，且一分不扣 */
  p.money = 50;
  const poor = await e.exec('请教 ' + teacher.name + ' 基本剑法');
  const ptxt = (poor.lines || []).map(l => l.text).join(' ');
  ok('★ 钱不够 → 教头不教', !p.learned.basic_sword, '学会了？' + !!p.learned.basic_sword);
  ok('★ 并且明说差多少钱', /100|束脩|钱/.test(ptxt), ptxt.slice(0, 90));
  ok('钱没被扣', p.money === 50, p.money + ' 文');

  /* 钱够 → 学成，扣整整 100 文 */
  p.money = 500;
  const rich = await e.exec('请教 ' + teacher.name + ' 基本剑法');
  ok('★ 钱够 → 学会了', !!p.learned.basic_sword, (rich.lines || []).map(l => l.text).join(' ').slice(0, 80));
  ok('★ 扣了 100 文（不是白学）', p.money === 400, '500 → ' + p.money);
  ok('给了一句「花了钱」的明示',
    /100|文/.test((rich.lines || []).map(l => l.text).join(' ')));

  /* 已会的不能重复学 */
  const again = await e.exec('请教 ' + teacher.name + ' 基本剑法');
  ok('★ 已学会的不能再花钱学一遍', /不必再请教/.test((again.lines || []).map(l => l.text).join(' ')));
  ok('钱没再被扣', p.money === 400, p.money + ' 文');

  /* 换一门（换城市也一样） */
  const p2 = w.spawnNpc('wg_han', c0.host);
  p.money = 200;
  const other = await e.exec('请教 ' + p2.name + ' 基本刀法');
  ok('★ 别的城里的教头同样收 100 文', !!p.learned.basic_blade && p.money === 100,
    '学会=' + !!p.learned.basic_blade + ' 余额=' + p.money);

  /* ================= 五、教头不抢师父的饭碗 ================= */
  section('5 拜过师的人：师父那条路不受影响');
  const e2 = new GameEngine({ seed: 77 });
  await e2.boot({});
  e2.newGame({ name: '有师父的' });
  const w2 = e2.world, p2p = w2.player;
  const m = w2.spawnNpc('master_yue', p2p.room);
  m.favor = 60;
  await e2.exec('拜师 ' + m.name);
  /* ⚠️ 别拿「基本拳脚」试：岳不群是剑客，他手上没有这门（第一版就这么假红过一次）。
     从他的可教清单里现取一门**还没学会**的。 */
  p2p.money = 0;
  const canLearn = require(path.join(ROOT, 'game/src/core/social.js'))
    .teachList(w2, m).filter(s => !s.known);
  const pick = canLearn[0];
  ok('岳不群手上确实有能教的东西', !!pick, canLearn.map(s => s.name).join('、'));
  const free = await e2.exec('请教 ' + m.name + ' ' + pick.name);
  ok('★ 跟师父学不要钱（原有规矩没被改坏）',
    !!p2p.learned[pick.id] && p2p.money === 0,
    (free.lines || []).map(l => l.text).join(' ').slice(0, 70));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
