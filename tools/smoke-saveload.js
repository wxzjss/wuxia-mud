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
/* ---- 老档残留清剿（主人 2026-10-17 真机：出生点仍见山贼×2/游侠×2）----
   漂移期老档手工构造（**在活世界真 spawn 再序列化**，字段结构与真档同构；
   demo 孤儿用真实实例改 defId 造——手工裸对象会被 reviveInstances 的 recalc 打穿）：
   demo 孤儿 + 漂移山贼 + 在岗山贼 + 漂移教头 + 在宅常驻，
   读档两刀（def 孤儿删 / noWander 离岗删）后：两族清零、正常实例分毫不动。 */
{
  const dPost = w.spawnNpc('mob_bandit', 'jm_underground', 1, true);   // 在岗
  w.spawnNpc('mob_bandit', 'road_jiangnan_1', 1, true);                // 漂移到出生点官道
  w.spawnNpc('wg_zhou', 'road_jiangnan_1', 1, true);                   // 教头离岗（无 respawn 岗族）
  const resDef = Object.values(w.data.npcs).find(d => d.room && !d.wander && !d.noWander);
  w.spawnNpc(resDef.id, resDef.room, 1, true);                          // 本房常驻（不能误删）
  const save = JSON.parse(JSON.stringify(w.serialize()));
  /* demo 孤儿：拿一个真实实例结构改 defId——demo mod 默认关后的残留同构 */
  const anyUid = Object.keys(save.instances.npcs).find(k => save.instances.npcs[k] && save.instances.npcs[k].defId !== 'mob_bandit');
  save.instances.npcs['mod_demo_youxia_1'] = Object.assign({}, save.instances.npcs[anyUid], {
    id: 'mod_demo_youxia_1', defId: 'demo_youxia', name: '游侠',
  });

  const e5 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e5.boot();
  e5.world.deserialize(save, []);
  const inst = e5.world.instances.npcs;
  const byDef = id => Object.values(inst).filter(n => n && n.defId === id);
  ok('★ 刀① demo 孤儿实例清零（游侠×1 不再见）', byDef('demo_youxia').length === 0);
  ok('★ 刀② 漂移山贼清掉（出生点官道的山贼不见了）',
    !Object.values(inst).some(n => n && n.defId === 'mob_bandit' && n.room === 'road_jiangnan_1'));
  ok('★ 在岗山贼保留（jm_underground 的不动）',
    Object.values(inst).some(n => n && n.defId === 'mob_bandit' && n.room === 'jm_underground'));
  ok('★ 刀② 漂移教头清掉（离岗 noWander 无 respawn 岗族）',
    !Object.values(inst).some(n => n && n.defId === 'wg_zhou' && n.room !== 'wg_jiangnan'));
  ok('★ 正常常驻实例保留（本房商贩分毫不动）',
    Object.values(inst).some(n => n && n.defId === resDef.id && n.room === resDef.room));
  /* 幂等：再存再读一轮，干净档 no-op，正常实例不二次受创 */
  const save2 = JSON.parse(JSON.stringify(e5.world.serialize()));
  const e6 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e6.boot();
  e6.world.deserialize(save2, []);
  const inst2 = e6.world.instances.npcs;
  ok('★ 二轮读档幂等（在岗山贼/常驻商贩仍在）',
    Object.values(inst2).some(n => n && n.defId === 'mob_bandit' && n.room === 'jm_underground') &&
    Object.values(inst2).some(n => n && n.defId === resDef.id && n.room === resDef.room));
}
/* ---- 剧情动态实例豁免（主人 2026-10-17 退回裁定：剧情生成的人不能被存档维护误删）----
   亲属记仇 witness：运行时注入 def + 动态 spawn。serialize 白名单不存 data，
   读档后 def 必然缺失（刀① 口中的「孤儿」）；又 noWander 且人不在 def.room
   （刀② 口中的「离岗」）——两刀都必须豁免，hostile / favor / avengers 原样。 */
{
  const VIC2 = '__sl_victim', WIT2 = '__sl_witness';
  w.data.npcs[VIC2] = { id: VIC2, name: '苦主', gender: 'female', room: 'road_jiangnan_1', level: 1, hp: 100, mp: 50, sect: 'huashan', leavesCorpse: false };
  w.data.npcs[WIT2] = { id: WIT2, name: '记仇人', gender: 'male', room: 'road_jiangnan_1', level: 1, hp: 100, mp: 50, sect: 'huashan', noWander: true, leavesCorpse: false, rel: [{ id: VIC2, kind: '亲' }] };
  const v2 = w.spawnNpc(VIC2, p.room, 1, true);
  const wi0 = w.spawnNpc(WIT2, p.room, 1, true);
  w.witnessReaction(v2);
  ok('★ 前置：witness 已记仇（avengers 收录 + hostile 翻红 + favor 暴跌）',
    wi0.pstate.avengers && wi0.pstate.avengers.indexOf(VIC2) >= 0 &&
    wi0.hostile === true && (wi0.favor || 0) <= -90,
    'favor=' + wi0.favor);
  const saveW = JSON.parse(JSON.stringify(w.serialize()));
  delete w.data.npcs[VIC2]; delete w.data.npcs[WIT2];   // 还原数据面（serialize 本就不存 data）
  const e7 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e7.boot();
  e7.world.deserialize(saveW, []);
  const wi2 = Object.values(e7.world.instances.npcs).find(n => n && n.defId === WIT2);
  ok('★ 记仇人读档存活（def 缺失 + noWander 离岗双险都不删）', !!wi2);
  ok('★ 记仇人 hostile / favor / avengers 原样',
    wi2 && wi2.hostile === true && (wi2.favor || 0) <= -90 &&
    wi2.pstate && Array.isArray(wi2.pstate.avengers) && wi2.pstate.avengers.indexOf(VIC2) >= 0);
  /* 刀② 豁免反例：离岗但带交情（favor≠0 = 运行时个人化状态）→ 不删 */
  const dr = w.spawnNpc('wg_zhou', 'road_jiangnan_1', 1, true);
  dr.favor = 50;
  const saveF = JSON.parse(JSON.stringify(w.serialize()));
  const e8 = new GameEngine({ seed: 20261010, saveDir: TEST_SAVE_DIR });
  e8.boot();
  e8.world.deserialize(saveF, []);
  ok('★ 刀② 豁免：带交情（favor≠0）的离岗 NPC 保留',
    Object.values(e8.world.instances.npcs).some(n => n && n.defId === 'wg_zhou' && n.favor === 50));
}

/* ================================================================
 * ⑧ 存档本地化（2026-10-18 主人定调：只保留本地存档功能）
 *    服务端 /api/save 只出快照正文（不写盘）、/api/restore 收正文恢复；
 *    权威副本住浏览器 localStorage（renderer/js/savestore.js）；
 *    老档走只读迁移桥一次性导入。这里钉三件：
 *    A 引擎快照/恢复闭环  B WXSAVE 本地组件闭环（vm 真跑）  C 路由/桥的静态判据
 * ================================================================ */
console.log('\n⑧ 存档本地化（快照/恢复 + 本地存档组件 + 迁移桥）');
const fs = require('fs'), path = require('path'), vm = require('vm');
{
  /* ---- A. 引擎快照/恢复闭环（不落盘） ---- */
  const snap = e.snapshot('loc_a');
  ok('⑧A1 snapshot 出正文且不落盘（saves/ 不新增文件）',
    snap.ok && !!snap.data && snap.data.player && snap.data.player.name === '试剑'
    && !fs.existsSync(path.join(TEST_SAVE_DIR, 'loc_a.json')));
  ok('⑧A2 snapshot 正文带 savedAt / clockMinutes（列表元信息靠它）',
    typeof snap.data.savedAt === 'number' && typeof snap.data.clockMinutes === 'number');
  const moneyBefore = w.player.money;
  p.money = 123;
  const rBack = e.restoreFrom(JSON.parse(JSON.stringify(snap.data)));
  ok('⑧A3 restoreFrom 把世界拨回快照（读档＝回当时）', rBack.ok && w.player.money === moneyBefore);
  ok('⑧A4 restoreFrom 回 view 带 player、不带地图（recoverLostPlayer 判据）',
    !!(rBack.view && rBack.view.player) && rBack.view.map === undefined);
  const rBad = e.restoreFrom(null);
  ok('⑧A5 坏正文明确拒绝（不炸世界）', rBad.ok === false && !!rBad.msg);
  ok('⑧A6 loadSave 与 restoreFrom 同一套收口（正文来源不同、收尾只有一份）',
    /loadSave\(id\) \{[\s\S]{0,200}return this\.restoreFrom\(s\);/.test(fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'core', 'engine.js'), 'utf8')));

  /* ---- B. WXSAVE 本地组件（vm 真跑，localStorage 用内存桩） ---- */
  const mkLs = () => { const d = {}; return { getItem: k => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; }, _d: d }; };
  const loadSaveStore = (lsStub) => {
    const env = { window: { localStorage: lsStub } };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'renderer', 'js', 'savestore.js'), 'utf8'),
      vm.createContext({ window: env.window, localStorage: lsStub }), { filename: 'savestore.js' });
    return env.window.WXSAVE;
  };
  const ls1 = mkLs();
  const S1 = loadSaveStore(ls1);
  const blob1 = JSON.parse(JSON.stringify(snap.data));
  ok('⑧B1 put→list 闭环（元信息进索引）',
    S1.put({ id: 's_a', name: '甲', savedAt: 100 }, blob1).ok
    && S1.put({ id: 's_b', name: '乙', savedAt: 200 }, blob1).ok
    && S1.list().length === 2 && S1.list()[0].id === 's_b');
  ok('⑧B2 get 取回正文与写入一致', JSON.stringify(S1.get('s_a')) === JSON.stringify(blob1));
  ok('⑧B3 put 同 id 覆盖（单键+覆盖纪律，不增条目）',
    S1.put({ id: 's_a', name: '甲二', savedAt: 300 }, blob1).ok && S1.list().length === 2
    && S1.list()[0].id === 's_a' && S1.list()[0].name === '甲二');
  ok('⑧B4 remove 连正文带索引一起走', (S1.remove('s_b'), S1.list().length === 1 && S1.get('s_b') === null));
  ok('⑧B5 「刷新不丢」：新组件实例读同一 localStorage 看得见同一批档',
    loadSaveStore(ls1).list().length === 1);
  ok('⑧B6 软上限 12 份：超限明确拒绝（不许静默吞档）',
    (function () {
      const S2 = loadSaveStore(mkLs());
      for (let i = 0; i < S2.KEYS.MAX_SAVES; i++) S2.put({ id: 'k' + i, savedAt: i }, blob1);
      const r = S2.put({ id: 'overflow', savedAt: 999 }, blob1);
      return r.ok === false && /本地最多留/.test(r.msg);
    })());
  ok('⑧B7 quota 爆掉给人话（不抛异常）',
    (function () {
      const bad = mkLs(); bad.setItem = () => { throw new Error('QuotaExceededError'); };
      const S3 = loadSaveStore(bad);
      const r = S3.put({ id: 'q1', savedAt: 1 }, blob1);
      return r.ok === false && /本地空间不足/.test(r.msg);
    })());
  ok('⑧B8 索引坏档当「没有」处理（启动不被脏数据炸）',
    (function () {
      const lsX = mkLs(); lsX.setItem('wx_saves_index', '{oops');
      return loadSaveStore(lsX).list().length === 0;
    })());
  ok('⑧B9 迁移旗语义：默认未迁 / 插旗后不再触发',
    S1.migrated() === false && (S1.markMigrated(), S1.migrated() === true));

  /* ---- C. 路由/桥/接线的静态判据 ---- */
  const APP = fs.readFileSync(path.join(__dirname, '..', 'game/src/renderer/js/app.js'), 'utf8');
  const UI = fs.readFileSync(path.join(__dirname, '..', 'game/src/renderer/js/ui.js'), 'utf8');
  const START = fs.readFileSync(path.join(__dirname, '..', 'game/src/renderer/js/start.js'), 'utf8');
  const SRV = fs.readFileSync(path.join(__dirname, '..', 'server/game-server.js'), 'utf8');
  ok('⑧C1 服务端 /api/save 走 snapshot（不替玩家写盘）',
    /case 'save': \{[\s\S]{0,120}engine\.snapshot\(/.test(SRV));
  ok('⑧C2 服务端 /api/restore 在位（客户端送正文恢复世界）',
    /case 'restore': \{[\s\S]{0,200}engine\.restoreFrom\(json_body && json_body\.data\)/.test(SRV));
  ok('⑧C3 玩家档路由已摘：不再有 case \'load\' / \'deletesave\'',
    !/case 'load':/.test(SRV) && !/case 'deletesave':/.test(SRV));
  ok('⑧C4 只读迁移桥在位（saves + legacy/read，不写世界）',
    /case 'legacy\/read': \{[\s\S]{0,160}engine\.readSave\(/.test(SRV));
  ok('⑧C5 api.save = 快照 + WXSAVE.put（权威副本落本地）',
    /async save\(id\) \{[\s\S]{0,400}api\/save[\s\S]{0,400}WXSAVE\.put\(/.test(APP));
  ok('⑧C6 api.load = 本地正文优先 → /api/restore（老签名不变）',
    /async load\(id\) \{[\s\S]{0,200}WXSAVE\.get\(id\)[\s\S]{0,600}api\/restore/.test(APP));
  ok('⑧C7 api.load 本地没档退只读桥领回（主人档一个不静默消失）',
    /async load\(id\) \{[\s\S]{0,400}legacy\/read[\s\S]{0,400}WXSAVE\.put\(/.test(APP));
  ok('⑧C8 迁移桥触发条件：未迁旗 + 本地无档才跑，跑完插旗',
    /function migrateLegacySaves\(\) \{[\s\S]{0,200}migrated\(\)[\s\S]{0,200}hasAny\(\)[\s\S]{0,600}markMigrated\(\)/.test(START)
    && /await migrateLegacySaves\(\);\s*\n\s*await probeSaves\(\);/.test(START));
  ok('⑧C9 关页「最后一口气」= 同步 XHR 拿快照 + 同步落本地（sendBeacon 已拆）',
    /beforeunload[\s\S]{0,1400}new XMLHttpRequest\(\)[\s\S]{0,600}WXSAVE\.put\(/.test(UI)
    && !/navigator\.sendBeacon|sendBeacon\(/.test(UI));
  ok('⑧C10 savestore 已挂 index.html（9 处戳同源）',
    /<script src="js\/savestore\.js\?v=/.test(fs.readFileSync(path.join(__dirname, '..', 'game/src/renderer/index.html'), 'utf8')));
}
console.log('\n' + '='.repeat(40));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(40));
process.exit(fail ? 1 : 0);
