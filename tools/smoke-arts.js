/* ============================================================
 * smoke-arts.js — 重地（R5）+ 战斗外秘技 + 合欢宗 + 结缘门禁
 *
 * 覆盖：
 *  ① 藏经阁：不在重地不给看；三层按身份/贡献拦；抄录扣贡献、学到手
 *  ② 藏宝阁/国库：用贡献兑换；贡献不够被拒
 *  ③ 秘技：须先运起对应功法；只对**弱于自己**的人；成功率随实力差距变大
 *  ④ 五种秘技的效果真的落到了 NPC 身上（迷晕/致幻/暗劲/下毒/催眠）
 *  ⑤ 合欢宗：男身也能卖身；接待满十位才收；采补每次 1/10、同一人至多 10 次；双修双方涨
 *  ⑥ 结缘：表白有门槛；没表白就提亲/纳妾会被拦
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const ARTS = require(path.join(ROOT, 'game', 'src', 'core', 'arts.js'));
const TRE = require(path.join(ROOT, 'game', 'src', 'core', 'treasury.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261017;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

const e0 = boot(); const w0 = e0.world;

/** 造一个**确认弱于玩家**的 NPC：秘技的前提就是「只对实力不如你的人下手」，
 *  不把他压到底，测出来的全是「对方不弱于你」——那不是秘技坏了，是测试没搭好台。 */
function weak(w, id) {
  const n = w.spawnNpc(id, w.player.room, 1, true);
  n.baseAttr = { 力量: 3, 根骨: 3, 身法: 3, 悟性: 3, 福缘: 3, 定力: 3, 资质: 3 };
  n.maxHpBase = 40; n.maxMpBase = 20; n.atkBase = 3;
  n.defBase = 1; n.dodgeBase = 1; n.parryBase = 1; n.speedBase = 5;
  n.learned = {}; n.equippedSkills = {};
  n.recalc();
  return n;
}

/* ---------- ① 藏经阁 ---------- */
section('① 藏经阁');
const e1 = boot(); const w1 = e1.world, p1 = w1.player;
ok('不在重地时不给看', /没有藏经阁/.test(e1.exec('藏经阁').lines[0].text));
p1.sect = 'huashan'; p1.rank = 1; p1.sectContribution = 0;
w1.movePlayerTo(p1, 'huashan_library');
ok('华山有藏经阁这间房', !!w1.data.rooms['huashan_library']);
const v1 = TRE.libraryView(w1, p1);
ok('藏经阁分三层', v1.floors.length === 3, v1.floors.map(f => f.name).join('/'));
ok('身份/贡献不够时进不去（拦住并说明理由）', v1.floors[1].can === false && !!v1.floors[1].why, String(v1.floors[1].why));
p1.sectContribution = 5000; p1.rank = 4;
const v2 = TRE.libraryView(w1, p1);
ok('贡献与身份够了就能进三层', v2.floors.every(f => f.can), v2.floors.map(f => f.can).join(','));
const sh = TRE.shelfView(w1, p1, 1);
ok('外阁里列的是七/八/九品武学', sh.ok === true && sh.lines.some(l => /品：/.test(l.text || '')), (sh.lines.find(l => /品：/.test(l.text || '')) || {}).text);
ok('架上是**非本门派**的武学', !sh.shelf.some(sid => (w1.data.sects.huashan.skills || []).indexOf(sid.id) >= 0));
const before = p1.sectContribution;
const firstBook = sh.shelf[0];
const cr = TRE.copy(w1, p1, firstBook.name);
ok('抄录成功且扣了贡献', cr.ok === true && p1.sectContribution < before, `${before} → ${p1.sectContribution}`);
ok('抄完真的学会了', !!p1.learned[firstBook.id]);
ok('抄本门已有的会被拒', TRE.copy(w1, p1, (w1.getSkill('huashan_sword') || {}).name).ok === false);
p1.sectContribution = 0;
ok('贡献不够抄不了', TRE.copy(w1, p1, (TRE.shelfView(w1, p1, 1).shelf || [{ name: 'x' }])[0].name).ok === false);

/* ---------- ② 藏宝阁 / 国库 ---------- */
section('② 藏宝阁与国库');
const e2 = boot(); const w2 = e2.world, p2 = w2.player;
p2.sect = 'huashan'; p2.rank = 3; p2.sectContribution = 0;
w2.movePlayerTo(p2, 'huashan_vault');
const vv = TRE.vaultView(w2, p2);
ok('藏宝阁列了货（按类分）', vv.ok === true && vv.lines.some(l => /武器：|丹药：|符箓：/.test(l.text || '')));
p2.sectContribution = 0;
const swordName = (w2.getItem('fine_sword') || {}).name;
  ok('贡献不够换不了', TRE.redeem(w2, p2, swordName).ok === false);
p2.sectContribution = 5000;
const rd = TRE.redeem(w2, p2, swordName);
ok('贡献够就能换到手', rd.ok === true && p2.countItem('fine_sword') >= 1, rd.lines.map(l => l.text).join(' ').slice(0, 60));
w2.movePlayerTo(p2, 'palace_treasury');
ok('皇宫国库是一处重地', !!w2.data.rooms['palace_treasury'] && (TRE.vaultView(w2, p2).lines || []).length > 0);
ok('国库里有玄铁剑这样的重器', (TRE.cfg(w2).royal.goods || []).some(g => g.item === 'xuantie_sword'));
ok('衙门库房也是重地', w2.data.rooms['jn_yamen_store'].treasuryKind === 'house');
ok('每处重地都有扫地僧级守卫', !!w2.data.npcs['huashan_keeper'] && !!w2.data.npcs['royal_keeper']);
ok('守卫层级按门派层级配（一流=A）', w2.data.npcs['huashan_keeper'].tier === 'A', w2.data.npcs['huashan_keeper'].tier);
ok('三流门派的看库人更低阶', w2.data.npcs['jindao_keeper'] && w2.data.npcs['jindao_keeper'].tier === 'C', (w2.data.npcs['jindao_keeper'] || {}).tier);

/* ---------- ③ 秘技门槛 ---------- */
section('③ 秘技：须先运起功法 / 只对弱者');
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
p3.learnSkill('basic_poison', { force: true });
  /* ⚠️ learnSkill 会自动把新学的塞进空槽 —— 要验「没运起就用不了」，得先摘下来 */
  p3.equippedSkills['暗器'] = null;
  p3.mp = p3.maxMp = 9999;
const foeStrong = w3.spawnNpc('master_yue', p3.room, 1, true);   // 岳不群：远强于开局玩家
const foeWeak = w3.spawnNpc('npcv_002', p3.room, 1, true);       // 市井平民：弱
foeWeak.maxHp = 100; foeWeak.maxMp = 40; foeWeak.atk = 5; foeWeak.defBase = 2;
ok('没运起功法就用不了（列出缺什么）', (function () { const l = ARTS.listFor(w3, p3, foeWeak).find(a => a.id === 'art_knockout'); return l.can === false && /须先运起/.test(l.why); })(),
  JSON.stringify(ARTS.listFor(w3, p3, foeWeak).find(a => a.id === 'art_knockout')));
p3.equippedSkills['暗器'] = 'basic_poison';
const lWeak = ARTS.listFor(w3, p3, foeWeak).find(a => a.id === 'art_knockout');
const lStrong = ARTS.listFor(w3, p3, foeStrong).find(a => a.id === 'art_knockout');
ok('运起之后对弱者可用', lWeak.can === true, lWeak.chance + '%');
ok('对强者一律使不出来', lStrong.can === false && /不弱于你|不在你之下/.test(lStrong.why || ''), lStrong.why);
/* 差距越大越稳：造两个差距不同的目标 */
const mid = w3.spawnNpc('npcv_016', p3.room, 1, true);
mid.maxHp = 3000; mid.maxMp = 1500; mid.atk = 90; mid.defBase = 60;
const lMid = ARTS.listFor(w3, p3, mid).find(a => a.id === 'art_knockout');
ok('实力差距越大成功率越高', (lWeak.chance || 0) > (lMid.chance || 0), `弱目标 ${lWeak.chance}% > 近敌 ${lMid.chance}%`);

/* ---------- ④ 五种秘技的效果 ---------- */
section('④ 秘技效果真的落到人身上');
const e4 = boot(); const w4 = e4.world, p4 = w4.player;
p4.learnSkill('basic_poison', { force: true });
p4.learnSkill('basic_force', { force: true });
p4.learnSkill('miao_gu', { force: true });
p4.learnSkill('hehuan_qimen_2', { force: true });
p4.equippedSkills['暗器'] = 'basic_poison';
p4.equippedSkills['内功'] = 'basic_force';
p4.standaloneActive = ['miao_gu', 'hehuan_qimen_2'];
p4.mp = p4.maxMp = 99999;
w4.rng.next = () => 0;                    // 让判定必成（我们验的是「效果落没落」）
const target4 = weak(w4, 'npcv_002');

const run = (id) => ARTS.use(w4, p4, target4, id);
const rK = run('art_knockout');
ok('迷晕：人倒地了', rK.win === true && target4.knockedOut === true, JSON.stringify(rK.lines.map(l => l.text)).slice(0, 60));
const w5 = boot().world, p5 = w5.player; p5.learnSkill('miao_gu', { force: true }); p5.standaloneActive = ['miao_gu']; p5.mp = 9999;
const t5 = weak(w5, 'npcv_002');
w5.rng.next = () => 0;
const rS = ARTS.use(w5, p5, t5, 'art_stray');
ok('致幻：身上挂了「迷了路」的印', rS.win === true && !!(t5.vars && t5.vars.stray), ARTS.marksOf(t5).join('/'));
const w6 = boot().world, p6 = w6.player; p6.learnSkill('basic_force', { force: true }); p6.equippedSkills['内功'] = 'basic_force'; p6.mp = 9999;
const t6 = weak(w6, 'npcv_002');
w6.rng.next = () => 0;
const rH = ARTS.use(w6, p6, t6, 'art_hiddenforce');
ok('暗劲：印上了（战斗里才会发作）', rH.win === true && !!(t6.vars && t6.vars.hiddenForce), ARTS.marksOf(t6).join('/'));
/* 暗劲真的让伤害变大：直接比两次 oneAttack 的伤害 */
const w6b = boot().world, p6b = w6b.player;
const A = w6b.spawnNpc('npcv_002', p6b.room, 1, true); A.maxHp = 99999; A.defBase = 40; A.recalc();
const B = w6b.spawnNpc('npcv_002', p6b.room, 1, true); B.maxHp = 99999; B.defBase = 40; B.recalc();
B.vars = { hiddenForce: { left: 999, mult: 1.6 } };
const atk = w6b.spawnNpc('mob_bandit', p6b.room, 1, true); atk.atk = 200; atk.recalc();
w6b.rng.next = () => 0.5;
w6b.startCombat(p6b, A);
const dmgA = (function () { const r = w6b.combat.oneAttack(atk, A, null, w6b.battle, 0); return ((r.text || '').match(/造成 (\d+) 点伤害/) || [])[1]; })();
A.hp = A.maxHp;
w6b.battle.defenders = [B];
const dmgB = (function () { const r = w6b.combat.oneAttack(atk, B, null, w6b.battle, 0); return ((r.text || '').match(/造成 (\d+) 点伤害/) || [])[1]; })();
ok('暗劲：受伤真的变重了', Number(dmgB) > Number(dmgA), `${dmgA} → ${dmgB}`);
const w7 = boot().world, p7 = w7.player; p7.learnSkill('basic_poison', { force: true }); p7.equippedSkills['暗器'] = 'basic_poison'; p7.mp = 9999;
const t7 = weak(w7, 'npcv_002');
w7.rng.next = () => 0;
const rP = ARTS.use(w7, p7, t7, 'art_poison');
ok('下毒：挂上了中毒 buff', rP.win === true && t7.buffs.some(b => b.dot), t7.buffs.map(b => b.name).join('/'));
const w8 = boot().world, p8 = w8.player; p8.learnSkill('hehuan_qimen_2', { force: true }); p8.standaloneActive = ['hehuan_qimen_2']; p8.mp = 9999;
const t8 = weak(w8, 'npcv_002');
const favBefore = t8.favor || 0;
w8.rng.next = () => 0;
const rC = ARTS.use(w8, p8, t8, 'art_hypno');
ok('催眠：好感涨了且挂了「拿住心神」', rC.win === true && (t8.favor || 0) > favBefore && !!(t8.vars && t8.vars.charmed),
  `${favBefore} → ${t8.favor}`);

/* ---------- ⑤ 合欢宗 ---------- */
section('⑤ 合欢宗');
const e9 = boot(); const w9 = e9.world, p9 = w9.player;
ok('合欢宗已在门派表里（二流）', !!w9.data.sects.hehuan && w9.data.sects.hehuan.tier === '二流');
ok('合欢宗有自家山门（据点设在青楼区）', !!w9.data.rooms['hehuan_gate'] && w9.data.rooms['hehuan_gate'].region === 'qinglou');
ok('合欢宗功法里有效果带「惑」的招式', Object.values(w9.data.skills).some(s => s.id.indexOf('hehuan_qimen') === 0 && (s.effects || []).some(e => e.type === 'confuse')));
w9.movePlayerTo(p9, 'jiangnan_brothel');
/* 主人 2026-10-11 改了口径：男身**默认不收**，得先替苗春办成那条青楼支线
   （「楼里的门道」）才挂得上牌子。这里直接给 flag 模拟「已经办完了」。 */
ok('男身默认卖不了身（老鸨不收）', /不留男的/.test(e9.exec('卖身').lines[0].text));
p9.setFlag('brothel_permit', true);
ok('过关之后男身也能卖身青楼', /画了押/.test(e9.exec('卖身').lines[0].text));
p9.prostitution.served = 3;
ok('接待不够时入不了宗', ARTS.hehuanGate(w9, p9).ok === false, ARTS.hehuanGate(w9, p9).msg);
p9.prostitution.served = 10;
ok('接待满十位就能入宗', ARTS.hehuanGate(w9, p9).ok === true);
const jr = e9.exec('入合欢宗');
ok('真拜进去了', p9.sect === 'hehuan', jr.lines.map(l => l.text).join(' ').slice(0, 40));
/* ---- 双修 / 采补：主人 2026-10-11 把它们**从秘技里搬走了** ----
 * 现在的入口在「点 NPC 名字 → 互动面板」的按钮上，流程与判定都在 `dualcultivate.js`。
 * 这一节只守一件事：**秘技里不再有它们**（不然玩家会在两个地方看到同一件事，
 * 而秘技那条既不判晚上、也不判旁边有没有人）。
 * 完整的行为断言见 `tools/smoke-dualcultivate.js`。 */
section('⑤′ 双修 / 采补已从秘技搬到 NPC 面板');
{
  const e10 = boot(); const w10 = e10.world, p10 = w10.player;
  const victim = weak(w10, 'npcv_002');
  const names = ARTS.listFor(w10, p10, victim).map(a => a.name);
  ok('★ 秘技清单里没有「双修」', names.indexOf('双修') < 0, names.join('、').slice(0, 60));
  ok('★ 秘技清单里没有「采补」', names.indexOf('采补') < 0);
  const mi = e10.exec('秘技').lines.map(l => l.text || '').join(' ');
  ok('★ 「秘技」指令的输出里也没有', !/双修/.test(mi) && !/采补/.test(mi));
  ok('★ 判定改由 NPC 面板下发', !!(e10.npcProfileOf(victim) || {}).dual);
  const DC = require(path.join(ROOT, 'game/src/core/dualcultivate.js'));
  ok('新的流程模块在（双修 / 采补两条路）',
    typeof DC.start === 'function' && typeof DC.round === 'function' && typeof DC.evaluate === 'function');
  const cfgList = (ARTS.cfg(w10).list || []);
  ok('配置还留着（数据没删，只是不在这儿露面）',
    cfgList.some(a => a.id === 'art_dual') && cfgList.some(a => a.effect === 'drain'),
    cfgList.map(a => a.id).join(','));
}

/* ---------- ⑥ 结缘门禁 ---------- */
section('⑥ 结缘：必须先表白');
const e12 = boot(); const w12 = e12.world, p12 = w12.player;
const lady = w12.spawnNpc('npcv_075', p12.room, 1, true);
lady.gender = 'female'; lady.favor = 0;
const lowLove = e12.exec('表白 ' + lady.name);
ok('好感不够时表白被婉拒', lowLove.lines.some(l => /不到说这个的时候/.test(l.text || '')), lowLove.lines.map(l => l.text).join(' ').slice(0, 40));
lady.favor = 200;
w12.rng.next = () => 0;
const goodLove = e12.exec('表白 ' + lady.name);
ok('好感够了表白成功', (p12.lovers || []).length === 1, goodLove.lines.map(l => l.text).join(' ').slice(0, 40));
const pr = e12.npcProfileOf(lady.id);
ok('面板上认得出是恋人关系', pr && pr.bonds && pr.bonds.isLover === true);
/* 没表白的人不能提亲 */
const e13 = boot(); const w13 = e13.world, p13 = w13.player;
const other = w13.spawnNpc('npcv_076', p13.room, 1, true);
other.gender = 'female'; other.favor = 300;
const marryDeny = e13.exec('提亲 ' + other.name);
ok('没表白就提亲会被拦', marryDeny.lines.some(l => /还没到那一步/.test(l.text || '')), marryDeny.lines.map(l => l.text).join(' ').slice(0, 40));
const concDeny = e13.exec('纳妾 ' + other.name);
ok('没表白就纳妾同样被拦', concDeny.lines.some(l => /先去「表白」/.test(l.text || '')), concDeny.lines.map(l => l.text).join(' ').slice(0, 40));

console.log(`\n===== smoke-arts: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
