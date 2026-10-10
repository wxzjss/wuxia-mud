/**
 * smoke-dungeon.js —— 家园地牢（关押 / 提审 / 陪练 / 放出）专项回归
 *
 * 背景（主人第四轮问「家园地牢功能实现了吗？」）：
 *   `estate.js` 里的 `dungeon` 地块**只有定义、没有接线** ——
 *   玩家花 3200 文 + 铁矿石 16 + 丝线 2 开出来的地牢什么也做不了；
 *   `captiveCap` / `tortureRate` / `sparExp` 三个字段全仓**没有任何地方读**，
 *   典型的「不报错就是不生效」。这一套测试守的就是「它真的通了」：
 *     · 没开地牢 → 关押必须被**明确拒绝**（不是静默失败）
 *     · 开了地牢 → 关押真的把人从麻袋押进牢房，且受 captiveCap 限制
 *     · 提审 → 真能套出线索（quest / rel / sect / 钱），且不重复套同一句
 *     · 陪练 → 真涨熟练度，且犯人掉血、掉服从
 *     · 放出 → 真回到世上
 *     · 卖人 → 牢里的人也能出手
 *     · 越狱 → 你不在家时，恨你的人真会跑
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const kidnap = require(path.join(ROOT, 'game', 'src', 'core', 'kidnap.js'));
const home = require(path.join(ROOT, 'game', 'src', 'core', 'home.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}
function sec(t) { console.log('\n§ ' + t); }
const txt = a => (a || []).map(x => String(x.text || '')).join(' | ');

function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261020, saveDir: SAVE_DIR });
  e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}
/** 买宅（跳过衙门校验，测的是地块与地牢逻辑本身） */
function withHome(e, tier) {
  const p = e.world.player;
  p.money = 200000;
  p.room = home.YAMEN_ROOM;
  e.exec('买宅 ' + (tier || 'courtyard'));
  if (!p.home) throw new Error('withHome 失败');
  p.room = p.home;
  p.money = 200000;
  return p.home;
}
/** 把麻袋塞满、把人打倒、装袋 */
function bagOne(e, defId) {
  const w = e.world, p = w.player;
  w.giveItem(p, kidnap.SACK_ID, 3);
  const foe = w.spawnNpc(defId || 'mob_bandit', p.room, 1, true);
  foe.hp = 1;
  w.onNpcDown(foe, null);
  const r = e.exec('装人 ' + foe.name);
  return { foe, r };
}
/** 学一门武学（陪练要用） */
function learnOne(e) {
  const w = e.world, p = w.player;
  const sd = Object.values(w.data.skills).find(s => !s.require && s.type !== '内功');
  p.learnSkill(sd.id, true);
  return sd;
}

/* ================================================================
 * ① 没开地牢 → 四个指令都要**明确拒绝**（不是静默无效）
 * ================================================================ */
sec('① 没地牢时，关押/提审/陪练/放出 都必须明确拒绝');
{
  const e = boot(101);
  const r = e.exec('关押 谁');
  ok('①-1 关押被拒', r.lines.some(l => /还没有地牢/.test(l.text)), txt(r.lines).slice(0, 80));
  ok('①-2 拒绝时给出**怎么开**的指引（不是干巴巴一句「不行」）',
    r.lines.some(l => /开垦 地牢/.test(l.text)), txt(r.lines).slice(0, 120));
  ok('①-3 提审被拒', e.exec('提审 谁').lines.some(l => /还没有地牢/.test(l.text)));
  ok('①-4 陪练被拒', e.exec('陪练 谁').lines.some(l => /还没有地牢/.test(l.text)));
  ok('①-5 放出被拒', e.exec('放出 谁').lines.some(l => /还没有地牢/.test(l.text)));
  ok('①-6 没地牢时 view 里 dungeon.has 为 false（前端整栏不渲染）',
    e.view().kidnap.dungeon.has === false);
}

/* ================================================================
 * ② 开垦地牢 → captiveCap 真的生效（每级 +1）
 * ================================================================ */
sec('② 地牢建起来，captiveCap 真的生效');
{
  const e = boot(102);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 40);
  e.world.giveItem(p, 'silk_thread', 10);
  const r = e.exec('开垦 地牢');
  ok('②-1 开垦成功', r.lines.some(l => /开出了地牢/.test(l.text)), txt(r.lines).slice(0, 90));

  const dg = kidnap.dungeonOf(e.world);
  ok('②-2 dungeonOf 认得出来（has/level/cap）', dg.has && dg.level === 1, JSON.stringify({ has: dg.has, level: dg.level, cap: dg.cap }));
  ok('②-3 ★ cap 来自 estateEffects.captiveCap（1 级 = 1 个），不是写死的',
    dg.cap === 1, 'cap=' + dg.cap);
  ok('②-4 view.kidnap.dungeon 带 has/cap/roomName',
    (() => { const d = e.view().kidnap.dungeon; return d.has === true && d.cap === 1 && !!d.roomName; })(),
    JSON.stringify(e.view().kidnap.dungeon).slice(0, 140));

  /* 升到 2 级 → cap 变 2 */
  p.money = 200000;
  e.exec('开垦 地牢');
  const dg2 = kidnap.dungeonOf(e.world);
  ok('②-5 升一级后 cap 跟着涨（1 → 2）', dg2.level === 2 && dg2.cap === 2,
    JSON.stringify({ level: dg2.level, cap: dg2.cap }));
  ok('②-6 等级越高，tortureRate / sparExp 也在长（不再是死字段）',
    dg2.tortureRate > 0 && dg2.sparExp > 0,
    JSON.stringify({ t: dg2.tortureRate, s: dg2.sparExp }));
}

/* ================================================================
 * ③ 关押：袋里没人拒绝 / 真把人押进去 / 受上限限制
 * ================================================================ */
sec('③ 关押：麻袋 → 牢房');
{
  const e = boot(103);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');

  const empty = e.exec('关押');
  ok('③-1 袋里没人 → 拒绝，并告诉你去哪儿弄人',
    empty.lines.some(l => /袋里没人/.test(l.text)), txt(empty.lines).slice(0, 90));

  const { foe } = bagOne(e, 'mob_bandit');
  const beforeBags = kidnap.data(e.world).bags.length;
  const sacksBefore = p.countItem(kidnap.SACK_ID);
  const r = e.exec('关押 ' + foe.name);
  ok('③-2 ★ 关押成功', r.lines.some(l => /推进地牢的栅门/.test(l.text)), txt(r.lines).slice(0, 100));
  ok('③-3 麻袋腾空了', kidnap.data(e.world).bags.length === beforeBags - 1);
  ok('③-4 人进了 captives', kidnap.captives(e.world).some(c => c.name === foe.name));
  ok('③-5 ★ 麻袋**收回来了**（人进牢房，袋子还你）', p.countItem(kidnap.SACK_ID) === sacksBefore + 1,
    sacksBefore + ' → ' + p.countItem(kidnap.SACK_ID));

  /* 上限：cap=1，再关一个要被拦 */
  bagOne(e, 'mob_wolf');
  const r2 = e.exec('关押');
  ok('③-6 ★ 超过 captiveCap 被拦（不是无限关）',
    r2.lines.some(l => /已经关了|上限/.test(l.text)), txt(r2.lines).slice(0, 90));
}

/* ================================================================
 * ④ 提审：真套得出东西，且不重复
 * ================================================================ */
sec('④ 提审：套得出线索，不重复同一句');
{
  const e = boot(104);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');
  /* 挑一个**有关系数据**的人（rel 有 286 个），保证问得出名堂 */
  const w = e.world;
  const richId = Object.keys(w.data.npcs).find(id => (w.data.npcs[id].rel || []).length > 0 && w.data.npcs[id].tag !== 'doctor');
  const { foe } = bagOne(e, richId);
  e.exec('关押 ' + foe.name);
  const c = kidnap.captives(w)[0];
  ok('④-0 前提：关进去了（且有 rel 数据可问）', !!c, richId);

  const seen = [];
  let firstIntel = null;
  for (let i = 0; i < 40 && seen.length < 3; i++) {
    const r = e.exec('提审 ' + foe.name);
    const line = (r.lines || []).find(l => /【线索】|摸出 \d+ 文/.test(String(l.text || '')));
    if (line) { seen.push(String(line.text)); if (!firstIntel) firstIntel = String(line.text); }
  }
  ok('④-1 ★ 反复提审能套出东西（40 次内至少 3 条，说明概率不是 0）',
    seen.length >= 3, '共套出 ' + seen.length + ' 条：' + seen.join(' ／ ').slice(0, 160));
  ok('④-2 ★ 线索不重复（套过的那条不会再套一遍）',
    new Set(seen).size === seen.length, '去重后 ' + new Set(seen).size);
  ok('④-3 线索是人话（带【线索】或银钱），不是裸字段名',
    seen.every(s => /【线索】|摸出/.test(s)), seen[0] || '-');
  ok('④-4 审过之后，犯人的服从度掉了（用刑有代价）',
    (c.obedience || 0) < 15, 'obedience=' + c.obedience);
  ok('④-5 审过之后，好感也掉了（他记住是你审的他）',
    (c.favor || 0) < 0, 'favor=' + c.favor);
  ok('④-6 记下了审过几次（面板要用）', (c.interrogated || 0) >= 1, 'interrogated=' + c.interrogated);
  ok('④-7 view 里也带上这几个字段',
    (() => { const cc = (e.view().kidnap.dungeon.captives || [])[0]; return cc && cc.interrogated >= 1 && typeof cc.hpRatio === 'number'; })());
}

/* ================================================================
 * ⑤ 陪练：真涨熟练度 + 犯人掉血
 * ================================================================ */
sec('⑤ 陪练：涨熟练度，但他会伤');
{
  const e = boot(105);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');
  const sd = learnOne(e);
  const { foe } = bagOne(e, 'mob_bandit');
  e.exec('关押 ' + foe.name);
  const c = kidnap.captives(e.world)[0];
  const expBefore = (p.learned[sd.id] || {}).exp || 0;
  const lvBefore = (p.learned[sd.id] || {}).level || 0;
  const hpBefore = c.hp;

  const r = e.exec('陪练 ' + foe.name);
  ok('⑤-1 ★ 陪练跑通（有「喂招」文案 + 涨点）',
    r.lines.some(l => /喂招/.test(l.text)) && r.lines.some(l => /陪练共得/.test(l.text)),
    txt(r.lines).slice(0, 110));

  const after = p.learned[sd.id] || {};
  const expAfter = (after.level > lvBefore) ? -1 : (after.exp || 0);
  ok('⑤-2 ★ 熟练度真的涨了（经验 + 或直接升级）',
    after.level > lvBefore || expAfter > expBefore,
    JSON.stringify({ lvBefore, lvNow: after.level, expBefore, expAfter }));
  ok('⑤-3 ★ 犯人掉了血（真拿他挨打）', (c.hp || 1) < hpBefore, hpBefore + ' → ' + c.hp);
  ok('⑤-4 犯人的服从度也掉了', (c.obedience || 0) < 15, 'obedience=' + c.obedience);

  /* sparExp 加成是真的：2 级地牢给的点数应该多于 1 级 */
  const e2 = boot(106);
  withHome(e2, 'courtyard');
  const p2 = e2.world.player;
  e2.world.giveItem(p2, 'iron_ore', 40);
  e2.world.giveItem(p2, 'silk_thread', 10);
  e2.exec('开垦 地牢');
  e2.exec('开垦 地牢');    /* 2 级 */
  const sd2 = learnOne(e2);
  const b2 = bagOne(e2, 'mob_bandit');
  e2.exec('关押 ' + b2.foe.name);
  /* ⚠️ 两个世界的犯人状态必须一样，不然比的是「配合度」不是「sparExp」。
     直接把服从/好感拉平（这也是测试可取之处：只动一个变量）。 */
  const flat = (eng) => { const c = kidnap.captives(eng.world)[0]; c.obedience = 60; c.favor = 0; c.hp = c.maxHp; };
  flat(e2);
  {
    /* 世界 e 的犯人已经被打过一轮，同样拉平 */
    const c = kidnap.captives(e.world)[0];
    if (c) { c.obedience = 60; c.favor = 0; c.hp = c.maxHp; }
  }
  /* 直接读日志里的点数 —— 不看经验簿记，避免「升级重置 exp」之类的干扰 */
  const gainOf = (eng) => {
    const rr = eng.exec('陪练');
    const l = (rr.lines || []).find(x => /陪练共得/.test(String(x.text || '')));
    if (!l) return -1;
    const m = String(l.text).match(/陪练共得 (\d+) 点/);
    return m ? Number(m[1]) : -1;
  };
  const g1 = gainOf(e);
  const g2 = gainOf(e2);
  ok('⑤-5 ★ sparExp 不是死字段：2 级地牢陪练给的点数 > 1 级',
    g1 > 0 && g2 > g1, 'lv1=' + g1 + ' lv2=' + g2);
  void sd2;
}

/* ================================================================
 * ⑥ 放出 / 卖出：牢里的人出得来、也卖得掉
 * ================================================================ */
sec('⑥ 放出与人走：牢里的人也卖得掉');
{
  const e = boot(107);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');
  const { foe } = bagOne(e, 'mob_bandit');
  e.exec('关押 ' + foe.name);
  const dgRoom = kidnap.dungeonOf(e.world).roomId;

  const r = e.exec('放出 ' + foe.name);
  ok('⑥-1 ★ 放人成功', r.lines.some(l => /放了出来/.test(l.text)), txt(r.lines).slice(0, 90));
  ok('⑥-2 牢里清空了', kidnap.captives(e.world).length === 0);
  ok('⑥-3 ★ 人真的回到了世上（在地牢那间屋里）',
    e.world.downedIn(dgRoom).some(n => n.name === foe.name) ||
    e.world.npcsIn(dgRoom).some(n => n.name === foe.name),
    'room=' + dgRoom);

  /* 再关一个，直接卖掉 */
  bagOne(e, 'mob_wolf');
  e.exec('关押');
  const cl = kidnap.captives(e.world);
  ok('⑥-4 前提：又关了一个', cl.length === 1, cl.map(x => x.name).join(','));
  const soldName = cl[0].name;      /* ⚠️ 卖完 captives 就被 splice 了，先留名字 */
  const moneyBefore = p.money;
  const sr = e.exec('卖人 ' + soldName);
  ok('⑥-5 ★ 牢里的人也能卖（原来「卖人」只认麻袋和奴）',
    p.money > moneyBefore && kidnap.captives(e.world).length === 0,
    txt(sr.lines).slice(0, 90));
  ok('⑥-6 卖掉后进了名册（之后还能赎）',
    Array.isArray(e.world.soldSlaves) && e.world.soldSlaves.some(s => s.name === soldName),
    JSON.stringify((e.world.soldSlaves || []).map(s => s.name)));
}

/* ================================================================
 * ⑦ 越狱：你不在家 + 他恨你 → 真会跑
 * ================================================================ */
sec('⑦ 越狱：人不在家时，恨你的人会撬锁');
{
  const e = boot(108);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');
  const { foe } = bagOne(e, 'mob_bandit');
  e.exec('关押 ' + foe.name);
  const c = kidnap.captives(e.world)[0];
  c.favor = -100;      /* 恨到极点 → 必跑（概率最高档） */

  /* 你守在牢门口 → 谁也别想跑 */
  p.room = kidnap.dungeonOf(e.world).roomId;
  kidnap.checkCaptiveEscape(e.world, 120);
  ok('⑦-1 ★ 你守在牢门口时，跑不掉', kidnap.captives(e.world).length === 1);

  /* 你出远门 → 多跑几次总会跑 */
  p.room = 'jn_market_south';
  let escaped = false;
  for (let i = 0; i < 60; i++) {
    const lines = kidnap.checkCaptiveEscape(e.world, 120);
    if (lines.some(l => /越狱/.test(l.text))) { escaped = true; break; }
  }
  ok('⑦-2 ★ 你不在家 + 他恨你 → 真会跑（不是永远关得住）', escaped);
  ok('⑦-3 跑掉之后牢里就没人了', kidnap.captives(e.world).length === 0);
}

/* ================================================================
 * ⑧ 随档：地牢数据要存得下来
 * ================================================================ */
sec('⑧ 地牢的人随存档走');
{
  const e = boot(109);
  withHome(e, 'courtyard');
  const p = e.world.player;
  e.world.giveItem(p, 'iron_ore', 20);
  e.world.giveItem(p, 'silk_thread', 4);
  e.exec('开垦 地牢');
  const { foe } = bagOne(e, 'mob_bandit');
  e.exec('关押 ' + foe.name);
  const sav = e.world.serialize();
  ok('⑧-1 ★ 存档里有 captives（含名字与状态）',
    !!(sav.player.kidnap && Array.isArray(sav.player.kidnap.captives) && sav.player.kidnap.captives.length === 1),
    JSON.stringify((sav.player.kidnap || {}).captives || []).slice(0, 140));
  const c0 = (sav.player.kidnap.captives || [])[0] || {};
  ok('⑧-2 存了 defId（不然读档后复活不回来）', !!c0.defId, String(c0.defId));

  /* 真读回来（serialize → deserialize 往返） */
  const w2 = new (require(path.join(ROOT, 'game', 'src', 'core', 'world.js')).World)();
  w2.dataDirs = e.world.dataDirs;
  w2.loadBaseData();
  w2.deserialize(JSON.parse(JSON.stringify(sav)));
  ok('⑧-3 ★ 读档后地牢里的人还在（不漏字段）',
    kidnap.captives(w2).length === 1 && kidnap.captives(w2)[0].name === foe.name,
    JSON.stringify(kidnap.captives(w2).map(x => x.name)));
  ok('⑧-4 ★ 读档后地牢地块还在 → dungeonOf 仍认得出来',
    kidnap.dungeonOf(w2).has === true, JSON.stringify(kidnap.dungeonOf(w2)));
  ok('⑧-5 读档后还能放出（reviveFromSnapshot 要的字段齐全）',
    (() => {
      const r = kidnap.freeCaptive(w2, foe.name);
      return r.ok && kidnap.captives(w2).length === 0;
    })());
}

console.log('\n' + '='.repeat(48));
console.log(`  家园地牢专项：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
