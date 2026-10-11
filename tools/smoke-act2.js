/* smoke-act2.js —— 第二幕「门派之疑」可通关性回归
   背景（总纲 §7-1 / 故事书 design/10-mainline-story.md §2 第二幕）：
   本批新增 3 个 NPC + 第二幕 q_main_sect（7 段）+ 6 个房间 action。

   本测试锁死四类断点：
     ① 阶段 cond 依赖的 flag **没有任何地方设**（悬空 → 永远推不动）
     ② 房间 action 的 cond 悬空 / 房间不存在 / effects 里 flag 没落地
     ③ 第二幕没挂到任何 NPC 的 def.quests → `交任务` 一个阶段都交不掉
     ④ 真·跑一遍：挪人 → 点 action → 交任务，一路推到 stage=99

   run: node tools/smoke-act2.js */
'use strict';
const fs = require('fs');
const path = require('path');
const { GameEngine } = require('../game/src/core/engine.js');
const { evalCond } = require('../game/src/core/modapi');
/* 存档写进隔离沙盒，绝不碰玩家的saves/（主人 bug B1） */
const TEST_SAVE_DIR = require('./_test-save-dir');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261010, saveDir: TEST_SAVE_DIR });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  return e;
}
const txt = r => (r && r.lines || []).map(l => l.text || '').join('\n');
const Q = 'q_main_sect';

/* 本批 action 落在哪几个房间（测试里要真用这些 id） */
const ACTIONS = [
  ['jn_yamen_office', '翻名录'],
  ['shaolin_daxiong', '问方证'],
  ['huashan_zhengqi', '撞见密会'],
  ['huashan_zhengqi', '禀报冲虚'],
  ['huashan_zhengqi', '按下不提'],
  ['road_beijiang_1', '追囚车'],
];

sec('① 第二幕任务存在且结构完整');
{
  const w = boot().world;
  const q = w.getQuest(Q);
  ok('q_main_sect 存在', !!q, Q);
  if (q) {
    ok('7 个阶段', q.stages.length === 7, 'n=' + q.stages.length);
    ok('名字是「门派之疑」', /门派之疑/.test(q.name), q.name);
    ok('有委托人', !!q.giver, String(q.giver));
    ok('委托人指向真实 NPC', !q.giver || !!w.data.npcs[q.giver], String(q.giver));
    ok('末段 next=99（能走到完成）',
      q.stages[q.stages.length - 1].next === 99,
      JSON.stringify(q.stages[q.stages.length - 1].next));
    /* 阶段链首尾相接：每段 next 恰好指到下一段，不能跳号 */
    let chain = true;
    q.stages.forEach((s, i) => {
      const want = i === q.stages.length - 1 ? 99 : i + 1;
      if (s.next !== want) chain = false;
    });
    ok('阶段链 0→1→…→6→99 首尾相接', chain,
      q.stages.map(s => s.next).join(','));
    ok('desc 全不为空（UI 要显示）', q.stages.every(s => !!(s.desc && s.desc.trim())));
    /* 不用真实文本糊弄：desc 里不能带模板句或乱码 */
    ok('desc 无乱码字符', q.stages.every(s => !/�/.test(s.desc || '')));
    ok('desc 无未替换的模板占位', q.stages.every(s => !/\{\{|\}\}|undefined/.test(s.desc || '')));
  }
  ok('第一幕 q_main_jianghu 仍存在（没被误改）', !!w.getQuest('q_main_jianghu'));
}

sec('② 全库 flag 悬空扫描（第一道保险）');
/* 静态扫：把所有「会设 flag 的地方」收集起来，再回头查所有 cond.flag。
   这套逻辑跟总装脚本的 6b 一致，但独立跑一遍——总装脚本是写入时的护栏，
   这里是读取时的回归，两边都绿才算真没悬空。 */
{
  const w = boot().world;
  const D = w.data;
  const setFlags = new Set();
  const walk = o => {
    /* ⚠️ 字符串要**先**判 —— `menu` 的 `raw` 是一整串效果文本
       （`menu:标题|A>flag:xxx;narrate:…;;B>flag:yyy`）。
       若按「非对象直接 return」写在前面，字符串永远走不到这一支，
       menu 里置的 flag 全漏 → 假报「悬空 flag」
       （三~五幕落地实测踩到：know_east_depot / pass_shankou /
       blood_saber_down / taohua_passed 全在 menu 里置）。
       —— 这个 bug 的第一版就是这么写错的，特此留注。 */
    if (typeof o === 'string') {
      for (const m of o.matchAll(/\b(?:set)?flag:([A-Za-z0-9_]+)/g)) setFlags.add(m[1]);
      return;
    }
    if (!o || typeof o !== 'object') return;
    if ((o.type === 'flag' || o.type === 'setflag') && o.args && o.args[0]) setFlags.add(o.args[0]);
    for (const k in o) walk(o[k]);
  };
  for (const rid of Object.keys(D.rooms)) for (const a of D.rooms[rid].actions || []) walk(a.effects || []);
  for (const qid of Object.keys(D.quests)) {
    walk(D.quests[qid].rewards || []);
    /* ⚠️ stages[].effects 必须收——`chongxu_split_task` 就在这儿 */
    for (const st of D.quests[qid].stages || []) walk(st.effects || []);
  }
  for (const id of Object.keys(D.npcs)) walk(D.npcs[id]);

  const ENGINE = ['killed_', 'learned_', 'visited_', 'questdone_', 'ending_', 'sq_', 'win_', 'lose_'];
  const isEngine = f => ENGINE.some(p => f.startsWith(p));

  const dangling = [];
  const scan = (cond, where) => {
    if (!cond) return;
    for (const f of [cond.flag, cond.notFlag].concat(cond.flagsAll || [], cond.flagsAny || [])) {
      if (!f || isEngine(f)) continue;
      if (!setFlags.has(f)) dangling.push(where + ' → ' + f);
    }
  };
  for (const rid of Object.keys(D.rooms)) for (const a of D.rooms[rid].actions || []) scan(a.cond, '房间 ' + rid + '/' + a.cmd);
  for (const qid of Object.keys(D.quests)) (D.quests[qid].stages || []).forEach((s, i) => scan(s.cond, '任务 ' + qid + ' 阶段' + i));
  ok('全库无悬空 flag（房间 action + 任务阶段 cond）', dangling.length === 0, dangling.slice(0, 6).join(' | '));
  ok('本批 action 依赖的 chongxu_split_task 有人设', setFlags.has('chongxu_split_task'));
}

sec('③ 房间 action 数据自洽');
{
  const w = boot().world;
  for (const [rid, cmd] of ACTIONS) {
    const r = w.getRoom(rid);
    ok('房间存在：' + rid, !!r, rid);
    if (!r) continue;
    const a = (r.actions || []).find(x => x.cmd === cmd);
    ok('action 存在：' + rid + '/' + cmd, !!a);
    if (!a) continue;
    ok('action 有 label（按钮要显示字）：' + cmd, !!(a.label && a.label.trim()));
    ok('action 有 keywords（手输也能触发）：' + cmd, Array.isArray(a.keywords) && a.keywords.length > 0);
    ok('action 有 failMsg（条件不满足要给话）：' + cmd, !!(a.failMsg && a.failMsg.trim()));
    ok('action effects 不空：' + cmd, Array.isArray(a.effects) && a.effects.length > 0);
    /* 至少要落一个 flag，否则点了等于没点 */
    const fs = new Set();
    const walk = o => {
      if (!o || typeof o !== 'object') return;
      if ((o.type === 'flag' || o.type === 'setflag') && o.args && o.args[0]) fs.add(o.args[0]);
      for (const k in o) walk(o[k]);
    };
    walk(a.effects);
    ok('action 真落 flag：' + cmd, fs.size > 0, [...fs].join(','));
    /* 文案不能有乱码 */
    ok('action 文案无乱码：' + cmd,
      !/�/.test((a.failMsg || '') + JSON.stringify(a.effects)));
  }
}

sec('④ 第二幕挂到了 NPC 身上（交任务能找到人）');
{
  const w = boot().world;
  const mounted = [];
  for (const id of Object.keys(w.data.npcs)) {
    const def = w.data.npcs[id];
    if (Array.isArray(def.quests) && def.quests.includes(Q)) mounted.push(id);
  }
  ok('至少一个 NPC 挂 q_main_sect', mounted.length > 0, mounted.join(','));
  for (const mid of mounted) {
    const d = w.data.npcs[mid];
    ok('挂载 NPC 有落脚房间：' + mid, !!(d.room || d.home),
      'room=' + d.room + ' home=' + d.home);
    ok('挂载 NPC 名下真有这个任务：' + mid, !!w.getQuest(Q));
  }
  /* 委托人自己也得能接到（q.giver 指的那个） */
  const q = w.getQuest(Q);
  if (q && q.giver) {
    ok('委托人也能交第二幕', (w.data.npcs[q.giver].quests || []).includes(Q) || mounted.length > 0,
      'giver=' + q.giver + ' 挂=' + mounted.join(','));
  }
}

sec('⑤ 真·跑一遍：点 action → 交任务，一路推到 99');
{
  const e = boot(9090);
  const w = e.world, p = w.player;
  const q = w.getQuest(Q);

  /* 开场先拿第一幕的落点：know_east_depot + 铜牌 + 接第二幕 */
  p.setQuestStage(Q, 0);
  ok('第二幕能接到（stage=0）', p.questStage(Q) === 0, 'stage=' + p.questStage(Q));

  /* 第一段：know_east_depot 由第一幕落。没它就 advance 不了——这正是历史上卡死的点 */
  const st0 = q.stages[0];
  ok('阶段0 未满足（还没 know_east_depot）',
    !evalCond(st0.cond, { player: p, world: w }));
  p.setFlag('know_east_depot', true);
  ok('设 know_east_depot 后阶段0 满足', evalCond(st0.cond, { player: p, world: w }));

  /* 找委托人，挪过去造实例 */
  let giverId = q.giver || Object.keys(w.data.npcs).find(id => (w.data.npcs[id].quests || []).includes(Q));
  const gdef = w.data.npcs[giverId];
  let home = gdef.room || gdef.home;
  if (!home) {
    for (const rid of Object.keys(w.data.rooms)) {
      if ([].concat(w.data.rooms[rid].respawn || []).some(x => x && x.npc === giverId)) { home = rid; break; }
    }
  }
  ok('委托人有个房间能去找他', !!home && !!w.getRoom(home), 'giver=' + giverId + ' room=' + home);

  const report = () => {
    p.room = home;
    if (!w.npcsIn(home).some(n => n.defId === giverId)) w.spawnNpc(giverId, home, 1, true);
    const before = p.questStage(Q);
    /* exec 直接返回结果对象，没有 e.last */
    const out = e.exec('交任务');
    return { before, after: p.questStage(Q), out: txt(out) };
  };

  /* 逐段：凑条件 → 交任务。
     ⚠️ 第二幕 stage1 挂了一道**前置支线锁**（design/67 §5.3 P2，`lock.flag=pre_a2_menfang`）：
     本测试验的是「这一幕的剧情能不能走完」，所以先把 lock flag 置上
     （等价于「门房那桩事已经办过了」）。锁本身的守卫见 `check-data-load.js` ⑦。 */
  const steps = [
    ['① 交铜牌给冲虚（know_east_depot）', () => p.setFlag('know_east_depot', true)],
    ['② 查铜牌来路（翻名录 → clerk_met）', () => {
      p.setFlag('pre_a2_menfang', true);
      p.room = 'jn_yamen_office';
      e.exec('翻名录');
    }],
    ['③ 回武当复命（阶段2 落 chongxu_split_task）', null],
    ['④ 少林问方证（fangzheng_admitted）', () => {
      p.room = 'shaolin_daxiong';
      e.exec('问方证');
    }],
    ['⑤ 华山撞见密会（sect_inner_traitor）', () => {
      p.room = 'huashan_zhengqi';
      e.exec('撞见密会');
    }],
    ['⑥ 抉择（choice_made）', () => {
      p.room = 'huashan_zhengqi';
      e.exec('按下不提');
    }],
    ['⑦ 追囚车（know_xuemao）', () => {
      p.room = 'road_beijiang_1';
      e.exec('追囚车');
    }],
  ];

  let guard = 0;
  for (const [label, fill] of steps) {
    if (guard++ > 12) break;
    /* 每轮独立上限：fill 修不好 cond 时会原地打转，靠外层 guard 拦不住 */
    let spins = 0;
    while (p.questStage(Q) >= 0 && p.questStage(Q) < 99 && spins++ < 6) {
      const st = p.questStage(Q);
      const stage = q.stages[st];
      if (stage && stage.cond && !evalCond(stage.cond, { player: p, world: w })) {
        if (!fill) { ok(label + '：条件卡住且无处可凑（stage=' + st + '）', false, JSON.stringify(stage.cond)); break; }
        fill();
        if (spins >= 6) {
          ok(label + '：反复触发 action 后 cond 仍不成立（stage=' + st + '）', false,
            JSON.stringify(stage.cond) + ' flags=' + JSON.stringify(Object.keys(p.flags || {})));
        }
        continue;
      }
      /* targets 型条件（本幕没有，兜底） */
      if (stage && stage.targets) {
        for (const t of stage.targets) p.setVar(t.var || `q_${Q}_${t.id}`, t.count || 1);
      }
      const r = report();
      if (r.after === r.before) {
        ok(label + '：交任务没推进（停在 stage=' + r.before + '）', false, r.out.slice(0, 120));
      } else {
        ok(label + '：推进 ' + r.before + ' → ' + r.after, true);
      }
      break;
    }
  }
  ok('第二幕真能推到完成（stage=99）', p.questStage(Q) === 99, 'stage=' + p.questStage(Q));
  ok('完成时落了 act2_done', p.hasFlag('act2_done'));
  ok('完成时落了 sect_ashamed', p.hasFlag('sect_ashamed'));
}

sec('⑥ 抉择是互斥的（禀报 / 按下不提）');
{
  const mk = seed => {
    const e = new GameEngine({ seed });
    e.boot(); e.newGame({ name: '试' + seed, gender: 'male' });
    return e;
  };
  const e1 = mk(77), p1 = e1.world.player;
  p1.setFlag('chongxu_split_task', true);
  p1.setFlag('sect_inner_traitor', true);
  p1.room = 'huashan_zhengqi';
  const o1 = e1.exec('禀报冲虚');
  ok('禀报冲虚 → choice_tell_chongxu', p1.hasFlag('choice_tell_chongxu'),
    txt(o1).slice(0, 100));
  ok('禀报冲虚 → 不会同时落 choice_keep_silent', !p1.hasFlag('choice_keep_silent'));
  ok('禀报后落 choice_made', p1.hasFlag('choice_made'));

  const e2 = mk(78), p2 = e2.world.player;
  p2.setFlag('chongxu_split_task', true);
  p2.setFlag('sect_inner_traitor', true);
  p2.room = 'huashan_zhengqi';
  const o2 = e2.exec('按下不提');
  ok('按下不提 → choice_keep_silent', p2.hasFlag('choice_keep_silent'),
    txt(o2).slice(0, 100));
  ok('按下不提 → 不会同时落 choice_tell_chongxu', !p2.hasFlag('choice_tell_chongxu'));
  ok('按下后落 choice_made', p2.hasFlag('choice_made'));

  /* 反面：两个都设了 choice_made，第二个 action 的 notFlag 应挡住重入 */
  const o3 = e2.exec('禀报冲虚');
  ok('已抉择后不能再选另一条（notFlag 挡住）',
    !p2.hasFlag('choice_tell_chongxu'), 'output=' + txt(o3).slice(0, 100));
}

sec('⑦ action 前置不满足时给 failMsg，不静默');
{
  const e = boot(31);
  const w = e.world, p = w.player;
  /* 没 know_east_depot 就去衙门翻名录 */
  p.room = 'jn_yamen_office';
  const r = e.exec('翻名录');
  const out = txt(r);
  ok('前置不满足时拒绝', /连那份名录/.test(out), out.slice(0, 120));
  ok('前置不满足时没落 clerk_met', !p.hasFlag('clerk_met'));

  /* 没 chongxu_split_task 就不许问方证 */
  p.room = 'shaolin_daxiong';
  const r2 = e.exec('问方证');
  ok('没分派就不许问方证', /冲虚让你去问/.test(txt(r2)) || /太急/.test(txt(r2)), txt(r2).slice(0, 120));
  ok('没分派时没落 fangzheng_admitted', !p.hasFlag('fangzheng_admitted'));
  void w;
}

sec('⑧ 三个新 NPC 数据自洽');
{
  const w = boot().world;
  for (const [id, host] of [
    ['depot_master', '东厂'],
    ['depot_shadow', '影卫'],
    ['bureau_clerk', '胡录事'],
  ]) {
    const d = w.data.npcs[id];
    ok('NPC 存在：' + id, !!d, id);
    if (!d) continue;
    ok(id + ' 有真实房间', !!w.getRoom(d.room), 'room=' + d.room);
    ok(id + ' 名字非空', !!(d.name && d.name.trim()));
    ok(id + ' desc 有内容', !!(d.desc && d.desc.trim().length > 10));
    ok(id + ' desc 无乱码', !/�/.test(d.desc || ''));
    ok(id + ' desc 无模板占位', !/\{\{|undefined/.test(d.desc || ''));
    /* 技能引用真实存在 */
    const sids = [].concat(d.skills || []).map(s => typeof s === 'string' ? s : s && s.skill);
    const bad = sids.filter(s => s && !w.getSkill(s));
    ok(id + ' 技能引用全存在', bad.length === 0, bad.join(','));
    /* bossPhases 数据自洽 */
    if (d.bossPhases) {
      const ats = d.bossPhases.map(x => x.at);
      let desc = true;
      for (let i = 1; i < ats.length; i++) if (!(ats[i] < ats[i - 1])) desc = false;
      ok(id + ' bossPhases.at 递减', desc, JSON.stringify(ats));
      const bs = d.bossPhases.map(x => x.skill).filter(Boolean);
      const badS = bs.filter(s => !w.getSkill(s));
      ok(id + ' bossPhases.skill 都存在', badS.length === 0, badS.join(','));
      ok(id + ' 每阶段有台词', d.bossPhases.every(x => !!(x.line || x.raw || x.desc)));
    }
    void host;
  }
  /* 新物品 / 功法 */
  for (const iid of ['xunchun_blade', 'brocade_robe', 'depot_token_half']) {
    ok('物品存在：' + iid, !!w.data.items[iid], iid);
  }
  for (const sid of ['xunchun_blade_art', 'shadow_echo', 'imperial_order']) {
    ok('功法存在：' + sid, !!w.getSkill(sid), sid);
  }
}

sec('⑨ 存读档不丢第二幕进度（真往返）');
{
  const e = boot(4141);
  const w = e.world, p = w.player;
  const SID = 'smoke_act2_tmp';
  p.setQuestStage(Q, 0);
  p.setFlag('know_east_depot', true);
  p.setFlag('clerk_met', true);
  /* 第二幕 stage1 的前置支线锁（design/67 §5.3 P2）：本段验存读档往返，
     不验锁，所以把钥匙直接置上。 */
  p.setFlag('pre_a2_menfang', true);
  /* 冲虚复命（第 1→2 段） */
  p.room = w.data.npcs.wudang_chongxu.room;
  w.spawnNpc('wudang_chongxu', p.room, 1, true);
  const r1 = e.exec('交任务');
  ok('交铜牌 → stage 0→1',
    p.questStage(Q) === 1, 'stage=' + p.questStage(Q) + ' out=' + txt(r1).slice(0, 100));
  /* 查名录 → 交（1→2，阶段2 落 chongxu_split_task） */
  p.room = 'jn_yamen_office';
  e.exec('翻名录');
  ok('翻名录落 clerk_met', p.hasFlag('clerk_met'));
  p.room = w.data.npcs.wudang_chongxu.room;
  const r2 = e.exec('交任务');
  ok('复命 → stage 1→2', p.questStage(Q) === 2, 'stage=' + p.questStage(Q) + ' out=' + txt(r2).slice(0, 120));
  /* ⚠️ 阶段2 的 effects 是在 **2→3** 时执行的（tryReportQuest 取的是「当前阶段」的 effects）。
     1→2 触发的仍是阶段1 的空 effects。少交一次就断言 flag，必然假红。 */
  ok('1→2 时不该有 chongxu_split_task（还没走到阶段2 的 effects）',
    !p.hasFlag('chongxu_split_task'));
  const r2b = e.exec('交任务');
  ok('再复命一次 → stage 2→3', p.questStage(Q) === 3,
    'stage=' + p.questStage(Q) + ' out=' + txt(r2b).slice(0, 140));
  ok('阶段2 落 chongxu_split_task（少林/华山入口的前置）', p.hasFlag('chongxu_split_task'),
    'flags=' + JSON.stringify(Object.keys(p.flags || {})));
  /* 少林 */
  p.room = 'shaolin_daxiong';
  e.exec('问方证');
  ok('问方证落 fangzheng_admitted', p.hasFlag('fangzheng_admitted'));

  /* 真存 → 新引擎真读 */
  const sv = e.save(SID, { _test: true });
  ok('存档成功', sv.ok, sv.msg);
  const e2 = new GameEngine({ seed: 999, saveDir: TEST_SAVE_DIR });
  e2.boot(); e2.newGame({ name: '读档者', gender: 'male' });
  const lr = e2.loadSave(SID);
  ok('读档成功', lr.ok, lr.msg);
  const p2 = e2.world.player;
  ok('读档后第二幕 stage 还在 3', p2.questStage(Q) === 3, 'stage=' + p2.questStage(Q));
  ok('读档后 know_east_depot 还在', p2.hasFlag('know_east_depot'));
  ok('读档后 clerk_met 还在', p2.hasFlag('clerk_met'));
  ok('读档后 chongxu_split_task 还在', p2.hasFlag('chongxu_split_task'));
  ok('读档后 fangzheng_admitted 还在', p2.hasFlag('fangzheng_admitted'));
  /* 读档后还能接着跑：华山入口的 cond 应仍可点 */
  p2.room = 'huashan_zhengqi';
  e2.exec('撞见密会');
  ok('读档后仍能触发华山 action', p2.hasFlag('sect_inner_traitor'));
  /* 交任务在读档后还能用（原型/命令表重建过） */
  p2.room = e2.world.data.npcs.wudang_chongxu.room;
  if (!e2.world.npcsIn(p2.room).some(n => n.defId === 'wudang_chongxu')) {
    e2.world.spawnNpc('wudang_chongxu', p2.room, 1, true);
  }
  const r3 = e2.exec('交任务');
  ok('读档后交任务能推进', p2.questStage(Q) > 3,
    'stage=' + p2.questStage(Q) + ' out=' + txt(r3).slice(0, 120));
  try { e.deleteSave(SID); } catch (_) { /* 临时存档，删不掉也无所谓 */ }
}

console.log('\n' + '─'.repeat(46));
console.log('  第二幕 smoke：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('─'.repeat(46));
void fs; void path;
process.exit(fail ? 1 : 0);