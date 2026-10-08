const { GameEngine } = require('../game/src/core/engine.js');
const social = require('../game/src/core/social.js');
const marriage = require('../game/src/core/marriage.js');
const kinship = require('../game/src/core/kinship.js');
const homeMod = require('../game/src/core/home.js');

const e = new GameEngine({ seed: 20261010 });
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
const e2 = new GameEngine({ seed: 20261010 });
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
console.log('\n' + '='.repeat(40));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(40));
process.exit(fail ? 1 : 0);
