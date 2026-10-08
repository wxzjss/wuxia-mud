/* ============================================================
 * smoke-marry.js —— 婚姻 / 结拜 / 家宅 引擎冒烟测试（第二批）
 *
 * 固定种子，可复现。不依赖网络 / 服务，直接 new GameEngine 跑核心逻辑。
 * 覆盖：
 *   ① 资格判定（性别 / 年龄 / 好感 / 有家 / 已有婚配）
 *   ② 婚礼状态机（提亲扣钱 → 办酒加好感 → 入洞房 → 姻缘簿）
 *   ③ 结缘（同性可 / 45 岁边界 / spreadBond）
 *   ④ 结拜（义父义母 / 义兄弟 / 义姐妹 / 义兄妹 / 断义）
 *   ⑤ 家宅（买宅 / 布置 / 置办 / 婚后操作伴侣家）
 * ============================================================ */
'use strict';

const { GameEngine } = require('../game/src/core/engine.js');
const marriage = require('../game/src/core/marriage.js');
const kinship = require('../game/src/core/kinship.js');
const homeMod = require('../game/src/core/home.js');
const social = require('../game/src/core/social.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}

function pick(w, fn) {
  return Object.values(w.data.npcs).filter(fn)[0];
}

function run(e, cmd) {
  return e.exec(cmd);
}

async function main() {
  /* ---- 准备：男玩家 ---- */
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  p.money = 9999999;

  console.log('\n① 资格判定');
  const fem = pick(w, d => d.socialDone && d.gender === 'female' && d.age >= 18 && d.age < 45 && d.home);
  p.room = (fem.schedule && fem.schedule.day) || fem.room;
  let inst = w.spawnNpc(fem.id, p.room, 1, true);

  /* 好感不够 */
  ok('好感不足时不能提亲', !marriage.canMarry(w, inst).ok);

  /* 刷满好感后可以 */
  social.addFavorTo(w, inst.id, 300, 'test');
  ok('好感达标后可以提亲', marriage.canMarry(w, inst).ok, JSON.stringify(marriage.canMarry(w, inst)));

  /* 同性不能正婚（女玩家 vs 女 NPC） */
  const e2 = new GameEngine({ seed: 20261010 });
  e2.boot(); e2.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w2 = e2.world, p2 = w2.player;
  p2.money = 9999999;
  const fem2 = pick(w2, d => d.socialDone && d.gender === 'female' && d.age >= 18 && d.age < 44 && d.home);
  p2.room = (fem2.schedule && fem2.schedule.day) || fem2.room;
  let inst2 = w2.spawnNpc(fem2.id, p2.room, 1, true);
  social.addFavorTo(w2, inst2.id, 300, 'test');
  const cm2 = marriage.canMarry(w2, inst2);
  ok('同性不能正婚', !cm2.ok, cm2.reason);
  const cb2 = marriage.canBond(w2, inst2);
  ok('同性可以结缘', cb2.ok, JSON.stringify(cb2));

  /* 45 岁边界 */
  const old45 = pick(w, d => d.socialDone && d.gender === 'female' && d.age >= 45 && d.age < 60 && d.home);
  p.room = (old45.schedule && old45.schedule.day) || old45.room;
  let inst3 = w.spawnNpc(old45.id, p.room, 1, true);
  social.addFavorTo(w, inst3.id, 300, 'test');
  ok('45 岁及以上不能结缘', !marriage.canBond(w, inst3).ok, marriage.canBond(w, inst3).reason);

  console.log('\n② 婚礼全流程');
  /* 重新 spawn 目标（上一个房间被 inst3 占了） */
  p.room = (fem.schedule && fem.schedule.day) || fem.room;
  inst = w.spawnNpc(fem.id, p.room, 1, true);
  social.addFavorTo(w, inst.id, 300, 'test');
  const moneyBefore = p.money;
  const pr = marriage.propose(w, inst, 'hall');
  ok('提亲成功', pr.ok);
  ok('提亲扣了钱', p.money < moneyBefore, '扣 ' + (moneyBefore - p.money) + ' 文');
  ok('进入 prepare 阶段', p.marriage.stage === 'prepare', p.marriage.stage);

  /* 请客 */
  const fr = pick(w, d => d.socialDone && d.id !== fem.id && d.age >= 18);
  if (fr) {
    p.room = (fr.schedule && fr.schedule.day) || fr.room;
    let frInst = w.spawnNpc(fr.id, p.room, 1, true);
    social.addFavorTo(w, frInst.id, 200, 'test');
    const iv = marriage.invite(w, fr.id);
    ok('请客成功（好感够）', iv.ok, JSON.stringify(iv));
  }

  /* 办酒 */
  const hf = marriage.holdFeast(w);
  ok('办酒成功', hf.ok, JSON.stringify(hf).slice(0, 120));
  ok('办酒后宾客列表非空', Array.isArray(hf.guests) && hf.guests.length > 0, '宾客 ' + (hf.guests || []).length + ' 位');
  ok('进入 consummate 阶段', p.marriage.stage === 'consummate', p.marriage.stage);

  /* 入洞房：不在家 → 失败 */
  p.room = (fem.schedule && fem.schedule.day) || fem.room;
  const c1 = marriage.consummate(w);
  ok('不在家不能入洞房', !c1.ok, c1.lines.map(l => l.text).join(' '));

  /* 挪到家 → 成功 */
  p.room = fem.home;
  const c2 = marriage.consummate(w);
  ok('在家入洞房成功', c2.ok);
  ok('玩家有正室了', p.marriage.spouse === fem.id, 'spouse=' + p.marriage.spouse);
  ok('NPC 标了 spouse=player', fem.spouse === 'player');

  /* 姻缘簿摘要 */
  const s = marriage.summary(w);
  ok('摘要里 spouse 非空', !!s.spouse && s.spouse.name === fem.name, JSON.stringify(s.spouse));

  /* 已有正室再娶 → 提示纳妾 */
  const femB = pick(w, d => d.socialDone && d.gender === 'female' && d.age >= 18 && d.age < 45 && d.home && d.id !== fem.id);
  if (femB) {
    p.room = (femB.schedule && femB.schedule.day) || femB.room;
    let instB = w.spawnNpc(femB.id, p.room, 1, true);
    social.addFavorTo(w, instB.id, 300, 'test');
    const cmB = marriage.canMarry(w, instB);
    ok('已有正室不能再正婚', !cmB.ok, cmB.reason);
    const ccB = marriage.canConcubine(w, instB);
    ok('但可以纳妾', ccB.ok, JSON.stringify(ccB));
    const tc = marriage.takeConcubine(w, instB);
    ok('纳妾成功', tc.ok);
    ok('妾室入册', p.marriage.concubines.includes(femB.id));
  }

  console.log('\n③ 结缘 spreadBond');
  const e3 = new GameEngine({ seed: 20261010 });
  e3.boot(); e3.newGame({ name: '柳霜', gender: 'female', birth: 'wuxue' });
  const w3 = e3.world, p3 = w3.player;
  p3.money = 9999999;
  const fem3 = pick(w3, d => d.socialDone && d.gender === 'female' && d.age >= 18 && d.age < 44 && d.home);
  p3.room = (fem3.schedule && fem3.schedule.day) || fem3.room;
  let inst3b = w3.spawnNpc(fem3.id, p3.room, 1, true);
  social.addFavorTo(w3, inst3b.id, 300, 'test');
  const mb = marriage.makeBond(w3, inst3b);
  ok('结缘成功', mb.ok);
  ok('结缘入册', p3.marriage.bonds.includes(fem3.id));
  const touched = Object.values(w3.data.npcs).filter(d => d.knows_player_of === fem3.name).length;
  ok('江湖有人知道你与 TA 结缘', touched > 0, touched + ' 人知晓');

  console.log('\n④ 结拜');
  /* 义父（年长 15+ 的男性） */
  const oldM = pick(w3, d => d.socialDone && d.gender === 'male' && d.age >= p3.age + 15 && d.home);
  if (oldM) {
    p3.room = (oldM.schedule && oldM.schedule.day) || oldM.room;
    let oi = w3.spawnNpc(oldM.id, p3.room, 1, true);
    social.addFavorTo(w3, oi.id, 300, 'test');
    const sk = kinship.suggestKind(w3, oi);
    ok('年长 15+ 男性 → 义父', sk.kind === 'father', JSON.stringify(sk));
    const sw = kinship.swear(w3, oi);
    ok('认义父成功', sw.ok);
    ok('义父入册', kinship.summary(w3).father.some(x => x.id === oldM.id));
    /* ⚠ e3 是女玩家「柳霜」，义父管她叫「义女」才对 */
    ok('NPC 管我叫「义女」', kinship.addressMe(w3, oi) === '义女', kinship.addressMe(w3, oi));
  }

  /* 义姐妹（同龄女性） */
  const peerF = pick(w3, d => d.socialDone && d.gender === 'female' && d.age >= p3.age && d.age < p3.age + 15 && d.home && d.id !== fem3.id);
  if (peerF) {
    p3.room = (peerF.schedule && peerF.schedule.day) || peerF.room;
    let pi = w3.spawnNpc(peerF.id, p3.room, 1, true);
    social.addFavorTo(w3, pi.id, 300, 'test');
    const sk = kinship.suggestKind(w3, pi);
    ok('同龄女性 → 姐妹', sk.kind === 'sister', JSON.stringify(sk));
    const sw = kinship.swear(w3, pi);
    ok('结姐妹成功', sw.ok);
  }

  /* 断义 */
  if (oldM) {
    const sev = kinship.sever(w3, oldM.id);
    ok('断义成功', sev.ok);
    ok('义父移出册子', !kinship.summary(w3).father.some(x => x.id === oldM.id));
    ok('断义掉好感', social.favorOf(w3, oldM.id) < 300);
  }

  console.log('\n⑤ 家宅');
  const e4 = new GameEngine({ seed: 20261010 });
  e4.boot(); e4.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w4 = e4.world, p4 = w4.player;
  p4.money = 999999;

  /* 不在衙门 → 不能买 */
  p4.room = 'road_jiangnan_1';
  const b0 = homeMod.buy(w4, 'cottage');
  ok('不在衙门不能买宅', !b0.ok, b0.lines.map(l => l.text).join(' '));

  /* 在衙门 → 能买 */
  p4.room = homeMod.YAMEN_ROOM;
  const b1 = homeMod.buy(w4, 'courtyard');
  ok('衙门买宅成功', b1.ok, JSON.stringify(b1).slice(0, 100));
  ok('玩家有家了', !!p4.home, p4.home);
  ok('房子归玩家', w4.getRoom(p4.home).owner === 'player');

  /* 回家 */
  const gh = homeMod.goHome(w4);
  ok('回家成功', gh.ok && p4.room === p4.home, 'room=' + p4.room);

  /* 布置 */
  const dc = homeMod.decorate(w4, '青石小径，一丛修竹。');
  ok('布置成功', dc.ok);
  ok('描述已改', w4.getRoom(p4.home).desc === '青石小径，一丛修竹。');

  /* 置办 */
  const fu = homeMod.furnish(w4, '八仙桌');
  ok('置办家具成功', fu.ok);
  ok('家具入册', (w4.getRoom(p4.home).furniture || []).includes('table'));

  /* 婚后操作伴侣家 */
  const fem4 = pick(w4, d => d.socialDone && d.gender === 'female' && d.age >= 18 && d.age < 45 && d.home);
  p4.room = (fem4.schedule && fem4.schedule.day) || fem4.room;
  let inst4 = w4.spawnNpc(fem4.id, p4.room, 1, true);
  social.addFavorTo(w4, inst4.id, 300, 'test');
  marriage.propose(w4, inst4, 'home');
  marriage.holdFeast(w4);
  p4.room = fem4.home;
  marriage.consummate(w4);
  ok('婚后能操作伴侣家', homeMod.canOperate(w4, fem4.home));
  const dc2 = homeMod.decorate(w4, '我们的新居，窗明几净。');
  ok('能布置伴侣家', dc2.ok);

  /* 家宅摘要 */
  const hs = homeMod.summary(w4);
  ok('摘要含 partnerHome', !!hs.partnerHome && hs.partnerHome.of === fem4.name);

  console.log('\n' + '='.repeat(44));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(44));
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error('异常:', e.stack); process.exit(1); });
