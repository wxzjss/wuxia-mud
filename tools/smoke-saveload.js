const { GameEngine } = require('../game/src/core/engine.js');
const social = require('../game/src/core/social.js');
const marriage = require('../game/src/core/marriage.js');
const kinship = require('../game/src/core/kinship.js');
const homeMod = require('../game/src/core/home.js');
/* 存档写进隔离沙盒，绝不碰玩家的 saves/（主人 bug B1） */
const TEST_SAVE_DIR = require('./_test-save-dir');

const e = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;
p.money = 9999999;

const fem = Object.values(w.data.npcs).find(d => d.socialDone && d.gender==='female' && d.age>=18 && d.age<45 && d.home);
p.room = fem.room; let i1 = w.spawnNpc(fem.id, p.room, 1, true);
social.addFavorTo(w, i1.id, 300, 'x');
marriage.propose(w, i1, 'home'); marriage.holdFeast(w); p.room = fem.home; marriage.consummate(w);

const femB = Object.values(w.data.npcs).find(d => d.socialDone && d.gender==='female' && d.age>=18 && d.age<45 && d.home && d.id!==fem.id);
p.room = femB.room; let i2 = w.spawnNpc(femB.id, p.room, 1, true);
social.addFavorTo(w, i2.id, 300, 'x'); marriage.takeConcubine(w, i2);

// 结缘：第三个女 NPC
const femC = Object.values(w.data.npcs).find(d => d.socialDone && d.gender==='female' && d.age>=18 && d.age<44 && d.home && d.id!==fem.id && d.id!==femB.id);
p.room = femC.room; let i5 = w.spawnNpc(femC.id, p.room, 1, true);
social.addFavorTo(w, i5.id, 300, 'x'); marriage.makeBond(w, i5);
const bondKnowsBefore = Object.values(w.data.npcs).filter(d=>d.knows_player_of).length;

const oldM = Object.values(w.data.npcs).find(d => d.socialDone && d.gender==='male' && d.age >= p.age+15 && d.home);
p.room = oldM.room; let i3 = w.spawnNpc(oldM.id, p.room, 1, true);
social.addFavorTo(w, i3.id, 300, 'x'); kinship.swear(w, i3);

p.room = homeMod.YAMEN_ROOM; homeMod.buy(w, 'courtyard');
homeMod.goHome(w); homeMod.decorate(w, '青石小径'); homeMod.furnish(w, '八仙桌');

const before = {
  spouse: p.marriage.spouse, concubines: p.marriage.concubines.slice(),
  bonds: p.marriage.bonds.slice(), kinFather: p.kinship.father.map(x=>x.id),
  home: p.home, homeName: w.getRoom(p.home).name,
  homeDesc: w.getRoom(p.home).desc, homeFurn: w.getRoom(p.home).furniture.slice(),
  bondKnows: bondKnowsBefore,
};

const save = w.serialize();
const e2 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
e2.boot();
e2.world.deserialize(JSON.parse(JSON.stringify(save)), []);
e2.restoreRelations();
const w2 = e2.world, p2 = w2.player;

let pass = 0, fail = 0;
const ok = (n,c)=>{ if(c){ pass++; console.log('✔ '+n); } else { fail++; console.log('✘ '+n); } };
ok('正室恢复', p2.marriage.spouse === before.spouse);
ok('妾室恢复', JSON.stringify(p2.marriage.concubines) === JSON.stringify(before.concubines));
ok('结缘恢复', JSON.stringify(p2.marriage.bonds) === JSON.stringify(before.bonds));
ok('义父恢复', JSON.stringify(p2.kinship.father.map(x=>x.id)) === JSON.stringify(before.kinFather));
ok('home id 恢复', p2.home === before.home);
const hr = w2.getRoom(p2.home);
ok('宅子房间重建', !!hr && hr.name === before.homeName);
ok('宅子描述保留', hr.desc === before.homeDesc);
ok('宅子家具保留', JSON.stringify(hr.furniture) === JSON.stringify(before.homeFurn));
ok('宅子出口保留(能走出去)', Object.keys(hr.exits||{}).length > 0);
ok('NPC 模板 spouse 打回', w2.data.npcs[before.spouse].spouse === 'player');
const bondKnowsAfter = Object.values(w2.data.npcs).filter(d=>d.knows_player_of).length;
ok('NPC 模板 knows_player_of 传播恢复', bondKnowsAfter > 0, bondKnowsAfter+' 人');
ok('义父 NPC 模板 kin 打回', (w2.data.npcs[before.kinFather[0]].kin||[]).some(x=>x.id==='player'));
console.log('  结缘知晓人数 前'+before.bondKnows+' → 后'+bondKnowsAfter);

/* ---- 血量翻倍老 bug（主人真机 2026-10-16：退出→继续游戏 maxHp 变）----
   根因：deserialize 重建 Character 时不传 hp/mp，构造器落 `def.hp||100`
   兜底 —— 出身血底（meta.startHp=40）全丢，内功修为加过的血底也丢。
   修法：serialize 白名单收编 maxHpBase/maxMpBase，deserialize 喂回；
         老档（无这两字段）回落 meta.startHp/startMp（建号口径）。 */
{
  /* ① 出身血底 + 内功抬过的血底，读档后分毫不变 */
  const raised = p.maxHpBase + 30;              /* 模拟 neigong.js 的运行期加成 */
  p.maxHpBase = raised; p.maxHpBase && (p.recalc ? p.recalc() : null);
  p.hp = p.maxHp;                               /* 满血存档 */
  const s3 = JSON.parse(JSON.stringify(w.serialize()));
  const e3 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e3.boot();
  e3.world.deserialize(s3, []);
  const p3 = e3.world.player;
  ok('★ 血底随档（内功抬过 30 后读档仍准）',
    p3.maxHpBase === raised && p3.maxHp === p.maxHp && p3.hp === p.maxHp,
    `前 base=${raised} maxHp=${p.maxHp} → 后 base=${p3.maxHpBase} maxHp=${p3.maxHp}`);
  ok('★ 内力底随档（读档不变）',
    p3.maxMpBase === p.maxMpBase && p3.maxMp === p.maxMp,
    `前 ${p.maxMp} → 后 ${p3.maxMp}`);
  /* ② 存档真带这两个字段（防白名单被误删） */
  ok('★ 存档白名单含 maxHpBase/maxMpBase',
    s3.player.maxHpBase === raised && s3.player.maxMpBase === p.maxMpBase);
  /* ③ 老档兼容：剥掉两字段，回落 meta.startHp（40），不是 100 兜底 */
  const s4 = JSON.parse(JSON.stringify(s3));
  delete s4.player.maxHpBase; delete s4.player.maxMpBase;
  const e4 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e4.boot();
  e4.world.deserialize(s4, []);
  ok('★ 老档回落建号口径（meta.startHp=40，不是 100）',
    e4.world.player.maxHpBase === w.data.meta.startHp,
    `回落=${e4.world.player.maxHpBase} 期望=${w.data.meta.startHp}`);
  /* ④ 再存再读一轮：二次读档不漂移（幂等）——基线是**回落后的第一轮**，
     不是 ① 里抬过底的 p3（老档回落本来就是另一条血线）。 */
  const midBase = e4.world.player.maxHpBase, midMax = e4.world.player.maxHp;
  const r1 = e4.save(); e4.loadSave(r1.id); const r2 = e4.save(); e4.loadSave(r2.id);
  ok('★ 二轮存读不漂移（退出再进血量分毫不变）',
    e4.world.player.maxHpBase === midBase && e4.world.player.maxHp === midMax,
    `base=${e4.world.player.maxHpBase}/${midBase} maxHp=${e4.world.player.maxHp}/${midMax}`);
}
console.log('\n' + '='.repeat(40));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(40));
process.exit(fail ? 1 : 0);
