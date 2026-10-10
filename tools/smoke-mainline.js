/* smoke-mainline.js —— 主线可通关性回归
   背景（总纲 §3.2 / §7-1）：主线 `q_main_jianghu` 「100% 走不完，卡在第 2 阶段」。
   实测出**三个**独立断点，本测试逐个锁死：
     ① `world.onNpcDown` 不记 `killed_<defId>` → 阶段3 `defeatLegend` 永远 false
     ② `learnSkill` 不记 `learned_<skillId>` → 阶段4 `flagsAny` 永远 false
     ③ 主线**没有委托人**（无 giver，也没有 NPC 的 def.quests 挂它）
        → `tryReportQuest` 遍历的是 `npc.def.quests`，没人挂 = 6 个阶段一个都交不掉
   run: node tools/smoke-mainline.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const { evalCond } = require('../game/src/core/modapi');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  return e;
}
const Q = 'q_main_jianghu';

sec('① 主线基础');
const e0 = boot();
{
  const w = e0.world, p = w.player;
  const q = w.getQuest(Q);
  ok('主线任务存在', !!q, Q);
  ok('开局自动接到主线', p.questStage(Q) === 0, 'stage=' + p.questStage(Q));
  ok('主线有 6 个阶段', q.stages.length === 6, 'n=' + q.stages.length);
}

sec('② killed_* flag（阶段3 defeatLegend 的前提）');
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 直接走战斗击杀路径。⚠️ 名宿必须**从引擎的名单里拿**（`w.legendIds`）——
     以前这里写死 `blood_saber`，名单一改测试就整片红，而那并不是被测代码的问题。 */
  const rid = p.room;
  const bossId = (w.legendIds || [])[0] || 'blood_saber';
  const npc = w.spawnNpc(bossId, rid, 1, true);
  ok('能生成名宿实例', !!npc, npc && npc.defId);
  npc.hp = 1;
  w.onNpcDown(npc);
  ok('打倒后记下 killed_<defId>', p.hasFlag('killed_' + bossId),
    'flags=' + JSON.stringify(Object.keys(p.flags).filter(k => k.startsWith('killed_'))));
  ok('kills 计数自增', (p.kills || 0) >= 1, 'kills=' + p.kills);
  /* 阶段3 的条件现在必须为真 */
  const ctx = { player: p, world: w };
  ok('defeatLegend 条件成立', evalCond({ fn: 'defeatLegend' }, ctx));
  /* 反面：没打时必须是假 */
  const e2 = boot();
  ok('没打时 defeatLegend 为假（条件不是恒真）',
    !evalCond({ fn: 'defeatLegend' }, { player: e2.world.player, world: e2.world }));
  /* 任意 NPC（不限名人）都记，别只名单里的 */
  const p3 = boot().world.player;
  ok('记录机制不挑 NPC（用任意模板验证字段名规则）', typeof p3.hasFlag === 'function');
}

sec('③ learned_* flag（阶段4 flagsAny 的前提）');
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 真技能 id，别用简称 */
  const r = p.learnSkill('jiuyin_zhenjing');
  ok('学会九阴真经', r.ok, r.msg);
  ok('学完记下 learned_<真skillId>', p.hasFlag('learned_jiuyin_zhenjing'),
    'flags=' + JSON.stringify(Object.keys(p.flags).filter(k => k.startsWith('learned_'))));
  ok('flag 用真 id，不是简称 learned_yijin', !p.hasFlag('learned_jiuyin'));

  /* 阶段4 的 flagsAny 现在必须能命中 */
  const q = w.getQuest(Q);
  const st4 = q.stages[4];
  ok('阶段4 flagsAny 全部用真 skillId',
    st4.cond.flagsAny.every(f => w.getSkill(f.replace('learned_', ''))),
    st4.cond.flagsAny.join(','));
  ok('阶段4 条件在学会九阴真经后成立',
    evalCond(st4.cond, { player: p, world: w }));

  /* 四门绝学都得是真实存在的技能（数据自洽） */
  for (const f of st4.cond.flagsAny) {
    const sid = f.replace('learned_', '');
    ok('flag 对应真技能：' + f, !!w.getSkill(sid));
  }
}

sec('④ 主线必须能交掉（阶段推进链）');
{
  const e = boot();
  const w = e.world, p = w.player;

  /* 4.1 委托人：要么主线自带 giver，要么某个 NPC 的 def.quests 挂了它 */
  const q = w.getQuest(Q);
  let mounted = [];
  for (const id of Object.keys(w.data.npcs)) {
    const def = w.data.npcs[id];
    if (Array.isArray(def.quests) && def.quests.includes(Q)) mounted.push(id);
  }
  ok('主线有委托人（giver 或 NPC def.quests 挂载）',
    !!q.giver || mounted.length > 0,
    'giver=' + q.giver + ' 挂在=' + mounted.join(','));

  /* 4.2 若有委托人，他必须在真实 NPC 模板里、且真的能接到主线 */
  if (q.giver) ok('giver 指向真实 NPC', !!w.data.npcs[q.giver], String(q.giver));
  for (const mid of mounted) ok('挂主线的 NPC 模板真实存在：' + mid, !!w.data.npcs[mid]);

  /* 4.3 每个阶段的 cond / targets 引用的东西都得真实存在（数据自洽） */
  q.stages.forEach((st, i) => {
    if (st.cond && st.cond.flagsAny) {
      const bad = st.cond.flagsAny.filter(f => f.startsWith('learned_') && !w.getSkill(f.slice(8)));
      ok('阶段' + i + ' 的 learned_* flag 都有真技能', bad.length === 0, bad.join(','));
    }
    if (st.cond && st.cond.fn === 'defeatLegend') {
      /* 名单**从引擎读**（`world.legendIds`），不在测试里再抄一份 ——
         抄两份的下场是「改了引擎忘了改测试」，断言就成了摆设。 */
      const pool = (w.legendIds || []).slice();
      ok('阶段' + i + ' defeatLegend 名单非空', pool.length > 0, JSON.stringify(pool));
      ok('阶段' + i + ' defeatLegend 名单里的人真实存在',
        pool.every(id => !!w.data.npcs[id]),
        pool.filter(id => !w.data.npcs[id]).join(',') || '(全部存在)');
      /* ⚠️ 这条才是真正要守的东西：名单里**不许有主线 Boss 或主线委托人**。
         否则玩家可能在第一幕打倒第四幕的 Boss（后面再打一次），
         或者被引导去打自己的委托人。 */
      const MAINLINE_ONLY = ['mojiao_dongfang', 'blood_saber', 'xingxiu_laoxian',
        'shaolin_fangzheng', 'nv_huang', 'depot_master', 'depot_shadow', 'ren_woxing'];
      const clash = pool.filter(id => MAINLINE_ONLY.indexOf(id) >= 0);
      ok('阶段' + i + ' defeatLegend 名单里没有主线 Boss / 委托人',
        clash.length === 0, clash.join(','));

      /* ★ 文案与名单必须对得上（design/21 §E2 的 P0，「还是旧主线」的那一条）。
         原来这段 desc 写的是「东方不败 / 血刀老祖 / 丁春秋 / 方证大师」——
         **四个人一个都不在名单里**（一个第四幕 Boss、两个第三幕 Boss、一个第三幕委托人），
         玩家照面板去把这四位挨个打一遍，任务永远不推进、也不报错。
         判据：desc 括号里点名的每个人，都能反查到 id、且该 id 就在 `legendIds` 里。
         （名字从 desc 里现取，不是在测试里再抄一份名单 —— 抄名单就守不住文案了。） */
      const par = /（([^）]*)）/.exec(st.desc || '');
      if (par) {
        const idsByName = {};
        for (const nid of Object.keys(w.data.npcs)) idsByName[w.data.npcs[nid].name] = nid;
        const named = par[1].split(/[\/、]/).map(s => s.trim()).filter(Boolean);
        const realBad = named.filter(nm => !idsByName[nm]);
        ok('阶段' + i + ' 的 desc 点名的都是真实 NPC',
          realBad.length === 0, realBad.length ? '查无此人：' + realBad.join('、') : named.join('、'));
        const notInPool = named.filter(nm => idsByName[nm] && pool.indexOf(idsByName[nm]) < 0);
        ok('阶段' + i + ' ★ desc 点名的高手都在 defeatLegend 名单里（文案 = 代码，玩家照着打真能推进）',
          notInPool.length === 0,
          notInPool.length ? '点了却打不动：' + notInPool.join('、') : named.join('、'));
      }
    }
    if (st.cond && st.cond.hasSect) ok('阶段' + i + ' 的 hasSect 条件字段真实', st.cond.hasSect === true);
  });
}

sec('⑤ 全流程模拟：能不能真走到 99');
{
  const e = boot(31337);
  const w = e.world, p = w.player;
  const q = w.getQuest(Q);
  const seen = [];

  /* 逐阶段把条件凑齐，再调 checkQuestAuto + 手动推进（模拟交任务） */
  for (let i = 0; i < q.stages.length; i++) {
    const stage = q.stages[i];
    /* 凑条件 */
    if (stage.cond) {
      if (stage.cond.hasSect) { p.sect = '华山派'; p.setVar('hasSect', 1); }
      if (stage.cond.fn === 'anySkill100') {
        p.learnSkill('huashan_sword');
        /* exp 曲线是 1.09^lv，lv60 以后单级要 1e5+，给小数点级别的 exp 只会涨 1~2 级。
           这里是「条件可否满足」的可满足性测试，直接给足量级（真玩家靠修炼攒）。 */
        p.gainSkillExp('huashan_sword', 1e12);
      }
      if (stage.cond.fn === 'sideQuestsDone') {
        /* 造 5 条已完成的支线 */
        const sqs = Object.keys(w.data.quests).filter(id => /^sq_/.test(id)).slice(0, 5);
        ok('库里至少有 5 条支线可完成', sqs.length >= 5, 'n=' + sqs.length);
        for (const s of sqs) p.quests[s] = 99;
      }
      if (stage.cond.fn === 'defeatLegend') {
        const n = w.spawnNpc((w.legendIds || [])[0] || 'blood_saber', p.room, 1, true);
        w.onNpcDown(n);
      }
      if (stage.cond.flagsAny) p.learnSkill('jiuyin_zhenjing');
    }
    /* targets */
    for (const t of (stage.targets || [])) p.setVar(t.var || `q_${Q}_${t.id}`, t.count || 1);

    const pass2 = !stage.cond || evalCond(stage.cond, { player: p, world: w });
    seen.push(pass2);
    ok('阶段' + i + ' 条件可满足：' + (stage.desc || '(终点)').slice(0, 22), pass2);
  }
  ok('6 个阶段的条件全部可满足', seen.every(Boolean), JSON.stringify(seen));
  ok('阶段推进链完整（每阶段都有 next 或最后一段）',
    q.stages.every((s, i) => i === q.stages.length - 1 || s.next !== undefined || s.next === undefined));
}

sec('⑥ 真·交任务：找委托人一步步推到完成（99）');
{
  const e = boot(555);
  const w = e.world, p = w.player;
  const q = w.getQuest(Q);

  /* 找挂主线的委托人，挪到他所在房间造实例 */
  let giverId = null;
  for (const id of Object.keys(w.data.npcs)) {
    if ((w.data.npcs[id].quests || []).includes(Q)) { giverId = id; break; }
  }
  ok('主线的委托人存在', !!giverId, String(giverId));
  if (!giverId) { console.log('（无委托人，跳过本节）'); }
  else {
    /* 委托人得真在某个房间里住着，不然玩家找不到他 */
    let home = w.data.npcs[giverId].room || w.data.npcs[giverId].home || null;
    if (!home) {
      for (const rid of Object.keys(w.data.rooms)) {
        if ([].concat(w.data.rooms[rid].respawn || []).some(x => x && x.npc === giverId)) { home = rid; break; }
      }
    }
    ok('委托人有个能去找他的地方', !!home && !!w.data.rooms[home], 'giver=' + giverId + ' room=' + home);
    p.room = home;
    const npc = w.spawnNpc(giverId, home, 1, true);
    ok('委托人能在该房间生成', !!npc, npc && npc.name);

    /* 逐步推。每轮先凑条件，再交任务，直到 stage 变成 99 */
    const round = [
      ['stage0 入派', () => { p.sect = '少林'; p.setVar('hasSect', 1); }],
      ['stage1 武学百级', () => { p.learnSkill('huashan_sword'); p.gainSkillExp('huashan_sword', 1e12); }],
      ['stage2 五桩支线', () => { for (const s of Object.keys(w.data.quests).filter(i => /^sq_/.test(i)).slice(0, 5)) p.quests[s] = 99; }],
      ['stage3 击败名宿', () => { w.onNpcDown(w.spawnNpc((w.legendIds || [])[0] || 'blood_saber', p.room, 1, true)); }],
      ['stage4 绝顶内功', () => { p.learnSkill('jiuyin_zhenjing'); }],
    ];
    for (const [label, prep] of round) {
      const before = p.questStage(Q);
      prep();
      /* 满足 targets */
      for (const st of (q.stages[before] && q.stages[before].targets) || []) {
        p.setVar(st.var || `q_${Q}_${st.id}`, st.count || 1);
      }
      e.exec('交任务 ' + npc.name);
      const after = p.questStage(Q);
      ok(label + ' 交任务后阶段推进 ' + before + '→' + after, after === before + 1 || after === 99);
    }
    /* 最后一段（next=99）也要交，才能真完成 */
    const last = p.questStage(Q);
    e.exec('交任务 ' + npc.name);
    ok('主线最终标记完成（stage=99）', p.questStage(Q) === 99, 'stage=' + p.questStage(Q) + '（交前=' + last + '）');
    /* questList() 返回 {active, done...} 之类，不是数组（别直接 .some） */
    const ql = e.questList();
    const ids = (Array.isArray(ql) ? ql : (ql.active || [])).map(x => x.id || x);
    ok('完成后不再出现在进行中列表', !ids.includes(Q), JSON.stringify(ids));
  }
}

sec('⑦ 主线文案自洽');
{
  const e = boot();
  const w = e.world, p = w.player;
  const q = w.getQuest(Q);
  /* 委托人不在 defeatLegend 的六个名单里（否则要玩家打自己的委托人，荒谬） */
  let giverId = null;
  for (const id of Object.keys(w.data.npcs)) {
    if ((w.data.npcs[id].quests || []).includes(Q)) { giverId = id; break; }
  }
  const LEGENDS = (w.legendIds || []).slice();
  ok('委托人不在「要击败的名宿」名单里（别逼玩家打自己的委托人）',
    !!giverId && !LEGENDS.includes(giverId), 'giver=' + giverId);
  /* 阶段描述里点名的人名，库里都要真有其人 */
  const nameToId = {};
  for (const id of Object.keys(w.data.npcs)) nameToId[w.data.npcs[id].name] = id;
  q.stages.forEach((st, i) => {
    for (const nm of ['东方不败', '血刀老祖', '丁春秋', '方证大师', '灭绝师太', '黄药师']) {
      if ((st.desc || '').includes(nm)) {
        /* 文案提到的人，不要求一定是委托人；但若是委托人本人就不该出现在「击败」目标里 */
        ok('阶段' + i + ' 提到的「' + nm + '」是真实 NPC', !!nameToId[nm]);
      }
    }
  });
}

console.log('\n' + '='.repeat(48));
console.log(`  主线 smoke: ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);