/* 师门规矩（主人 2026-10-11 点单）：
 *   ① 门派内可转拜更高职位，转拜后原来那位不再是师父
 *   ② 同时只能拜师一人；能拜成 → 「你已有师门」；本来就不成 → 还是原来那句失败的话
 *   ③ 师父面板有「出师」（条件达成、涨好感；门派师父没有这一条）
 *   ④ 有「退出师门」（掉大量好感 + 只废该门派的传承武学）
 *
 * 跑法：node tools/smoke-discipleship.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const DS = require(path.join(ROOT, 'game/src/core/discipleship.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }
const txt = (r) => ((r && r.lines) || []).map(l => l.text).join(' ');

/** 造一个「够格的师父」：A 层、手上真有货、好感给足 */
function makeMaster(w, id, roomId, favor) {
  const n = w.spawnNpc(id, roomId);
  if (!n) return null;
  n.favor = favor == null ? 60 : favor;
  return n;
}

(async () => {
  /* ================= 一、一人只有一个师门 ================= */
  section('1 同时只能拜师一人');
  const e = new GameEngine({ seed: 2026 });
  await e.boot({});
  e.newGame({ name: '顾长风' });
  const w = e.world, p = w.player;

  /* ⚠️ 挑人要看三样：不 hostile（不然回的是「杀机毕露」）、手上真有货、tier 够。
     第一版随手拿了魔教那位，结果是「对方杀机毕露」—— 断言的题都跑偏了。 */
  const pick = (w, exclude) => Object.keys(w.data.npcs).find(id => {
    const d = w.data.npcs[id];
    return (d.tier || 'C') === 'A' && !d.hostile && d.name && id !== exclude;
  });
  const a = makeMaster(w, 'master_yue', p.room, 60);
  const bId = pick(w, 'master_yue');
  const b = makeMaster(w, bId, p.room, 60);
  ok('摆好两位够格的名宿', !!(a && b), (a && a.name) + ' / ' + (b && b.name));

  const r1 = await e.exec('拜师 ' + a.name);
  ok('★ 第一位拜得成', !!p.masters[a.defId || a.id], txt(r1).slice(0, 60));
  const r2 = await e.exec('拜师 ' + b.name);
  ok('★ 已有师父 → 说「你已有师门」', /已有师门/.test(txt(r2)), txt(r2).slice(0, 80));
  ok('★ 没有偷偷改成两个人', Object.keys(p.masters).length === 1, Object.keys(p.masters).join(','));

  /* 判定**失败**的，不能拿「已有师门」盖掉原来的话 */
  section('2 「能否收你」要判在前面');
  const e2 = new GameEngine({ seed: 9 });
  await e2.boot({});
  e2.newGame({ name: '钱不多' });
  const w2 = e2.world, p2 = w2.player;
  const m1 = makeMaster(w2, 'master_yue', p2.room, 60);
  await e2.exec('拜师 ' + m1.name);
  ok('先有一位师父', Object.keys(p2.masters).length === 1);

  const weak = makeMaster(w2, 'guide_teaman', p2.room, 60);   // 茶摊老汉：C 层、手上没货
  const rw = await e2.exec('拜师 ' + (weak && weak.name));
  ok('★ 对方本来就不收 → 还是原来那句（不是「已有师门」）',
    /粗浅把式|教不了人/.test(txt(rw)) && !/已有师门/.test(txt(rw)), txt(rw).slice(0, 80));

  const cold = makeMaster(w2, pick(w2, 'master_yue'), p2.room, 0);  // 好感不够
  const rc = await e2.exec('拜师 ' + cold.name);
  ok('★ 好感不够 → 还是原来那句（不是「已有师门」）',
    /萍水相逢/.test(txt(rc)) && !/已有师门/.test(txt(rc)), txt(rc).slice(0, 80));
  ok('失败时说清了门槛', /好感需 15/.test(txt(rc)));

  /* ================= 三、门派内转拜更高职位 ================= */
  section('3 门派内转拜高职位');
  const e3 = new GameEngine({ seed: 31 });
  await e3.boot({});
  e3.newGame({ name: '沈青崖' });
  const w3 = e3.world, p3 = w3.player;
  const jr = await e3.exec('拜师 华山派');
  ok('入了华山门墙', p3.sect === 'huashan', txt(jr).slice(0, 60));
  /* 手工摆位：把玩家放到「执事弟子」这一级，好让同门里既有职位低的、也有职位高的 */
  p3.rank = 3;
  p3.sectContribution = 99999;

  const lowRank = makeMaster(w3, 'nv_yue', p3.room, 60);       // 岳灵珊 rank 1（低于你）
  const highRank = makeMaster(w3, 'master_yue', p3.room, 60);  // 岳不群 rank 5（高于你）
  /* 岳灵珊的数据里没写 `learned`，`teachList` 因此是空的 —— 她会的那几手得补上，
     不然连「拜师」都进不去（回的是「我这点本事，教不了人」）。这是测试夹具，不是产品逻辑。 */
  lowRank.def.teach = ['huashan_sword', 'huashan_sword_art'];
  ok('同门高低两位都在场', !!(lowRank && highRank));
  ok('低职位那位手上确实有货（夹具生效）',
    require(path.join(ROOT, 'game/src/core/social.js')).teachList(w3, lowRank).length > 0);

  const rl = await e3.exec('拜师 ' + lowRank.name);
  ok('先拜了低职位的同门', !!p3.masters[lowRank.defId || lowRank.id], txt(rl).slice(0, 60));
  ok('记下了这是门里的师承', !!(p3.masters[lowRank.defId || lowRank.id] || {}).sect,
    JSON.stringify(p3.masters));

  const rh = await e3.exec('拜师 ' + highRank.name);
  ok('★ 转拜高职位成功', /牙牌|内门弟子|执事弟子|首座弟子|副掌门/.test(txt(rh)), txt(rh).slice(0, 90));
  ok('★ 新师父记上了', !!p3.masters[highRank.defId || highRank.id]);
  ok('★ 原来那位同门**不再是**玩家师父', !p3.masters[lowRank.defId || lowRank.id],
    Object.keys(p3.masters).join(','));
  ok('★ 师父还是只有一位', Object.keys(p3.masters).length === 1);
  ok('转拜时给了一句交代', /不必再执弟子礼/.test(txt(rh)));

  /* 新师父的「请教」是免费的（真当了师父） */
  p3.money = 0;
  const freeList = require(path.join(ROOT, 'game/src/core/social.js')).teachList(w3, highRank).filter(s => !s.known);
  if (freeList.length) {
    const rf = await e3.exec('请教 ' + highRank.name + ' ' + freeList[0].name);
    ok('★ 新师父教徒弟不要钱', !!p3.learned[freeList[0].id] && p3.money === 0,
      txt(rf).slice(0, 70));
  }

  /* ================= 四、出师 ================= */
  section('4 出师：好聚好散，好感是涨的');
  ok('★ 门派师父没有「出师」', !DS.canGraduate(w3, p3, highRank).ok,
    DS.canGraduate(w3, p3, highRank).why);
  ok('门派师父的理由说清了怎么办', /更高职位|门派/.test(DS.canGraduate(w3, p3, highRank).why));

  const e4 = new GameEngine({ seed: 55 });
  await e4.boot({});
  e4.newGame({ name: '阿鹤' });
  const w4 = e4.world, p4 = w4.player;
  const solo = makeMaster(w4, 'master_yue', p4.room, 20);
  await e4.exec('拜师 ' + solo.name);
  ok('拜了一位江湖师父（不是门里的）', !!p4.masters[solo.defId || solo.id]);
  ok('★ 好感不够 → 出不了师', !DS.canGraduate(w4, p4, solo).ok);
  const rg0 = await e4.exec('出师');
  ok('★ 命令也拦住，并说明差什么', /好感需 60|处出交情/.test(txt(rg0)), txt(rg0).slice(0, 90));
  ok('名分还留着', !!p4.masters[solo.defId || solo.id]);

  /* 先正经学一门（师父教的），好验「出师不废功夫」 */
  const canLearn4 = require(path.join(ROOT, 'game/src/core/social.js'))
    .teachList(w4, solo).filter(s => !s.known);
  await e4.exec('请教 ' + solo.name + ' ' + canLearn4[0].name);
  const ownedBefore = Object.keys(p4.learned || {}).sort().join(',');

  solo.favor = 80;
  const favBefore = solo.favor;
  const rg = await e4.exec('出师');
  ok('★ 条件达成 → 出师成功', !p4.masters[solo.defId || solo.id], txt(rg).slice(0, 70));
  ok('★ 出师**涨**好感（不是掉）', solo.favor > favBefore, favBefore + ' → ' + solo.favor);
  ok('不再是师父了（面板不会再出请教）', !DS.isMasterOf(p4, solo));
  ok('★ 出师不废任何功夫（跟退出师门正相反）',
    Object.keys(p4.learned || {}).sort().join(',') === ownedBefore && ownedBefore.length > 0,
    ownedBefore);

  /* ================= 五、退出师门 ================= */
  section('5 退出师门：掉好感，且只废该门派的传承武学');
  const e5 = new GameEngine({ seed: 88 });
  await e5.boot({});
  e5.newGame({ name: '许七' });
  const w5 = e5.world, p5 = w5.player;
  await e5.exec('拜师 华山派');
  p5.rank = 3; p5.sectContribution = 99999;
  const hmaster = makeMaster(w5, 'master_yue', p5.room, 60);
  await e5.exec('拜师 ' + hmaster.name);
  ok('有了门派师父', !!p5.masters[hmaster.defId || hmaster.id],
    JSON.stringify(Object.keys(p5.masters)));

  /* 先另学一门**不属于华山**的基本功（用武馆教头），再看它会不会被牵连 */
  const wg = w5.spawnNpc('wg_zhou', p5.room);
  p5.money = 500;
  await e5.exec('请教 ' + wg.name + ' 基本拳脚');
  ok('从武馆学了一门基本功', !!p5.learned.basic_fist);

  const sectIds = DS.sectSkillIds(w5, 'huashan');
  ok('华山有自己的传承武学名单', sectIds.length > 0, sectIds.length + ' 门');
  const owned = Object.keys(p5.learned).filter(s => sectIds.indexOf(s) >= 0);
  ok('玩家身上确实带着华山传的功夫', owned.length > 0, owned.join(','));

  const fav0 = Math.round(hmaster.favor);
  const key = hmaster.defId || hmaster.id;
  const rq = await e5.exec('退出师门 ' + hmaster.name);
  ok('★ 断得成', !p5.masters[key], txt(rq).slice(0, 70));
  ok('★ 好感大掉（一次 60）', Math.round(hmaster.favor) <= fav0 - 55,
    fav0 + ' → ' + Math.round(hmaster.favor));
  ok('★ 该门派的**专属传承**武学被废掉', owned.every(s => !p5.learned[s]),
    '仍在身上的：' + owned.filter(s => p5.learned[s]).join(','));
  /* ★ 基本功不算门派专属：门派入门顺带教，可武馆也 100 文一门随便学，
     把它算进去就会「在武馆花过钱的基本功，叛门时被一并收走」。 */
  ok('★ 基本功不牵连（武馆学的那门原样还在）', !!p5.learned.basic_fist);
  ok('★ 门内入门顺带给的基本功也不收（不是门派专有）',
    ['basic_force', 'basic_parry', 'basic_dodge', 'basic_sword'].every(s => !!p5.learned[s]),
    ['basic_force', 'basic_parry', 'basic_dodge', 'basic_sword'].filter(s => !p5.learned[s]).join(',') || '全在');
  ok('废掉的都是这一家独有的（华山剑法那类）',
    owned.filter(s => !p5.learned[s]).some(s => /^huashan_/.test(s)),
    owned.filter(s => !p5.learned[s]).join(','));
  ok('废功有明说', /收了回去/.test(txt(rq)), txt(rq).match(/师门传的功夫被收了回去：[^）]*/));
  ok('还留在身上的功夫点到了名', /都还在/.test(txt(rq)) || /本来也没什么功夫/.test(txt(rq)));
  ok('★ 装备槽里的也摘干净了（不会挂着不存在的武学）',
    Object.values(p5.equippedSkills || {}).every(v => !v || p5.learned[v]),
    JSON.stringify(Object.entries(p5.equippedSkills || {}).filter(([, v]) => v && !p5.learned[v])));
  ok('★ 顺带脱离了门派', !p5.sect, p5.sect || '(已脱离)');

  /* 个人师父（不挂门派）退出师门：没有武学可废，只说断了 */
  section('6 个人师父：退得掉，但不牵连任何功夫');
  const e6 = new GameEngine({ seed: 12 });
  await e6.boot({});
  e6.newGame({ name: '陈小乙' });
  const w6 = e6.world, p6 = w6.player;
  const solo6 = makeMaster(w6, 'master_yue', p6.room, 70);
  await e6.exec('拜师 ' + solo6.name);
  await e6.exec('练功');
  const before6 = Object.keys(p6.learned).sort().join(',');
  const rq6 = await e6.exec('退出师门');
  ok('★ 无门派师父也能退出', !p6.masters[solo6.defId || solo6.id], txt(rq6).slice(0, 60));
  ok('★ 一门功夫都没废', Object.keys(p6.learned).sort().join(',') === before6);
  ok('没说「收了回去」这种话', !/收了回去/.test(txt(rq6)));
  ok('好感照样掉', Math.round(solo6.favor) < 70, Math.round(solo6.favor) + '');
  const rq6b = await e6.exec('退出师门');
  ok('已经不是师父了 → 再退会被拦', /不是你的师父|还没有拜过师/.test(txt(rq6b)), txt(rq6b).slice(0, 60));

  /* ================= 七、前端按钮 ================= */
  section('7 面板：出师 / 退出师门');
  const UI = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
  const UI2 = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');
  ok('有「出师」按钮', /id="npc-prof-graduate"/.test(UI));
  ok('有「退出师门」按钮', /id="npc-prof-quit"/.test(UI));
  ok('★ 门派师父不出「出师」', /isMaster && !pr\.sectMaster[\s\S]{0,160}npc-prof-graduate/.test(UI));
  ok('★ 退出师门要点确认（防手滑）', /npc-prof-quit[\s\S]{0,700}?confirmBox/.test(UI));
  ok('两个按钮都真绑了事件', /npc-prof-graduate[\s\S]{0,60}?onclick/.test(UI)
    && /npc-prof-quit[\s\S]{0,60}?onclick/.test(UI));
  ok('后退方案：后端也下发了 sectMaster / graduate', (() => {
    const EN = fs.readFileSync(path.join(ROOT, 'game/src/core/engine.js'), 'utf8');
    return /sectMaster:/.test(EN) && /graduate:/.test(EN);
  })());
  ok('两份 ui.js 副本一致', UI === UI2);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
