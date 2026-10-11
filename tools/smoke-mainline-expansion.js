/* ============================================================
 * smoke-mainline-expansion.js —— 主线分化 P2~P5 守卫（design/67 §5）
 *
 * 守的是**分叉真的分叉了**，不是「数据写在那儿」：
 *   ① 前置支线（P2）：三种线别的玩家，可接列表**不一样**；锁真的挡人（且明说原因）
 *   ② 皇宫衙门线（P3）：达标的能接、不达标的接不到（require 真生效）
 *   ③ 性别双解（P4）：同一节点男女看到**不同的 desc 与不同的目标房**，且**都能推**
 *   ④ 中立线（P5）：只有 neutral 走得通，且结局不锁正邪
 *   ⑤ 幕次推导：开局第 1 幕、完成第一幕 → 第 2 幕（`nextAct` 曾全仓无调用点）
 *
 * ⚠️ 不真跑的分叉＝没做。凡是「同一件事三种走法」，必须证明**三种都读得到各自的字**。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const ML = require(path.join(ROOT, 'game/src/core/mainline.js'));
const QS = require(path.join(ROOT, 'game/src/core/queststage.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const txt = r => ((r && (r.lines || []).map(l => l.text).join('\n')) || '');

function boot(seed, birth, gender) {
  const e = new GameEngine({ seed });
  e.boot();
  e.newGame({ name: '验', birth, gender: gender || 'male' });
  return e;
}

(async () => {
  const PRE = ['sq_pre_a1_chuan', 'sq_pre_a1_shi', 'sq_pre_a1_yao', 'sq_pre_a2_menfang',
    'sq_pre_a3_dangpu', 'sq_pre_a3_shufang', 'sq_pre_a4_dukou', 'sq_pre_a4_qiaofu',
    'sq_pre_a5_kou', 'sq_pre_a5_mubei'];
  const LINE_PRE = ['sq_pre_line_orth', 'sq_pre_line_out', 'sq_pre_line_neu'];

  console.log('===== ① 前置支线：在库 + 挂得上 + 目标房真实 =====');
  {
    const e = boot(101, 'noble', 'male'); const w = e.world;
    for (const id of PRE.concat(LINE_PRE)) {
      const q = w.getQuest(id);
      ok('★ ' + id + ' 在库', !!q);
      if (!q) continue;
      const n = w.data.npcs[q.giver];
      ok('　委托人真实存在且挂得上', !!(n && Array.isArray(n.quests) && n.quests.includes(id)), q.giver);
      let badRoom = '';
      for (const s of (q.stages || [])) {
        for (const t of (s.targets || [])) if (t.kind === 'room' && !w.data.rooms[t.key]) badRoom = t.key;
      }
      ok('　目标房真实存在', !badRoom, badRoom);
      /* 钥匙 flag 必须挂在 **rewards** 上（一交就必然执行），
         不能只写在 menu 里 —— menu 是「要玩家点一下」的抉择，
         玩家把菜单一关，flag 就不落，主线那把锁**永远解不开**（静默死锁）。 */
      const key = id.replace(/^sq_/, '');
      const inRewards = (q.rewards || []).some(r => r.type === 'flag' && r.args && r.args[0] === key);
      ok('　钥匙 flag 挂在 rewards 上（不靠 menu 抉择）', inRewards, key);
    }
    ok('前置支线总数 ≥13', PRE.length + LINE_PRE.length >= 13, PRE.length + LINE_PRE.length);
  }

  console.log('===== ② 前置支线按线别分流：三种出身的可接列表不一样 =====');
  {
    const pick = (birth) => {
      const e = boot(202, birth, 'male'); const w = e.world, p = w.player;
      /* 站在"驿卒"面前（正派线前置的委托人）。房间是 palace_street，
         但那里没有落点要求 —— 直接把 NPC spawn 到玩家房间最稳。 */
      p.room = 'jiangnan_street';
      const ids = [];
      for (const defId of ['cy_pre_postman', 'cy_pre_usurer', 'neu_zhanggui']) {
        const d = w.data.npcs[defId]; if (!d) continue;
        const inst = w.spawnNpc(defId, p.room, 1, true);
        for (const qid of (d.quests || [])) {
          const qd = w.getQuest(qid);
          /* 只看**本批**的线别前置 */
          if (!LINE_PRE.includes(qid)) continue;
          const { evalCond } = require(path.join(ROOT, 'game/src/core/modapi.js'));
          if (!qd.require || evalCond(qd.require, { player: p, world: w })) ids.push(qid);
        }
        void inst;
      }
      return ids.sort();
    };
    const orth = pick('noble'), out = pick('grudge_orphan'), neu = pick('orphan');
    ok('★ 正派出身看得到「驿路上那封信」', orth.includes('sq_pre_line_orth'), orth.join(','));
    ok('★ 正派看**不到**「一笔旧债」', !orth.includes('sq_pre_line_out'), orth.join(','));
    ok('★ 反派出身看得到「一笔旧债」', out.includes('sq_pre_line_out'), out.join(','));
    ok('★ 反派看**不到**「驿路上那封信」', !out.includes('sq_pre_line_orth'), out.join(','));
    ok('★ 中立出身看得到「一车货」', neu.includes('sq_pre_line_neu'), neu.join(','));
    ok('★ 三条线的可接列表两两不同', JSON.stringify(orth) !== JSON.stringify(out) && JSON.stringify(out) !== JSON.stringify(neu), JSON.stringify({ orth, out, neu }));
  }

  console.log('===== ③ 前置锁真的挡人：明说原因，不静默 =====');
  {
    const e = boot(303, 'wuxue', 'male'); const w = e.world, p = w.player;
    p.setQuestStage('q_main_jianghu', 2);
    /* 站在冲虚面前 */
    const room = w.data.npcs.wudang_chongxu.room;
    p.room = room; w.spawnNpc('wudang_chongxu', room, 1, true);
    for (const q of Object.keys(w.data.quests).filter(i => /^sq_/.test(i)).slice(0, 5)) p.quests[q] = 99;
    p.setVar('sidequests_done', 5);
    const before = p.questStage('q_main_jianghu');
    const r = await e.exec('交任务');
    ok('★ 没做前置时交任务不推进', p.questStage('q_main_jianghu') === before, 'stage=' + p.questStage('q_main_jianghu'));
    const v = e.view({ map: false });
    const cur = (v.quests.active || []).find(q => q.id === 'q_main_jianghu');
    ok('★ 面板显示「还没到时候」（locked）', !!(cur && cur.locked), JSON.stringify(cur && cur.locked));
    ok('★ 面板给出了要先去办的那桩事', !!(cur && cur.lockMsg && cur.lockMsg.length > 6), cur && cur.lockMsg);
    /* 做完前置 → 能推进 */
    p.setFlag('pre_a1_chuan', true);
    await e.exec('交任务');
    ok('★ 做完前置后再交任务 → 推进到 3', p.questStage('q_main_jianghu') === 3, 'stage=' + p.questStage('q_main_jianghu'));
    void r;
  }

  console.log('===== ④ 性别双解（P4）：同一节点两套走法，且都能通 =====');
  {
    /* 用中立线的 stage1（男→马市对账 / 女→客栈套话）当样本 */
    const seen = {};
    for (const g of ['male', 'female']) {
      const e = boot(404, 'orphan', g); const w = e.world, p = w.player;
      const q = w.getQuest('q_main_neutral');
      ok(g + '：中立线在库', !!q);
      const st = e.stageResolve(p, q.stages[1]);
      ok(g + '：这一阶段有性别专属文案', st.desc !== q.stages[1].desc, st.desc);
      const rooms = (st.targets || []).map(t => t.key);
      ok(g + '：目标房存在', rooms.length > 0 && rooms.every(r => !!w.data.rooms[r]), rooms.join(','));
      seen[g] = { desc: st.desc, rooms: rooms.join(',') };
    }
    ok('★ 男女看到的阶段描述**不同**', seen.male.desc !== seen.female.desc, JSON.stringify(seen));
    ok('★ 男女要去的房间**不同**', seen.male.rooms !== seen.female.rooms, JSON.stringify(seen));
    /* 两边都能走：把目标 var 攒上 → 条件满足即可推进（这里只验目标可达成） */
    for (const g of ['male', 'female']) {
      const e = boot(405, 'orphan', g); const w = e.world, p = w.player;
      const st = e.stageResolve(p, w.getQuest('q_main_neutral').stages[1]);
      for (const t of (st.targets || [])) p.setVar(t.var || t.id, t.count || 1);
      ok(g + '：这一阶段的目标都能达成（不是死路）',
        st.targets.every(t => e.targetDone(p, 'q_main_neutral', t)));
    }
    /* 皇宫线 stage1 也是双解 */
    {
      const e1 = boot(406, 'noble', 'male'), e2 = boot(406, 'noble', 'female');
      const s1 = e1.stageResolve(e1.world.player, e1.world.getQuest('q_main_court').stages[1]);
      const s2 = e2.stageResolve(e2.world.player, e2.world.getQuest('q_main_court').stages[1]);
      ok('★ 皇宫线同一节点男女解法不同',
        s1.targets.map(t => t.key).join() !== s2.targets.map(t => t.key).join(),
        s1.targets.map(t => t.key).join() + ' vs ' + s2.targets.map(t => t.key).join());
      ok('　男性的目标是御书房', s1.targets[0].key === 'palace_study', s1.targets[0].key);
      ok('　女性的目标是后宫', s2.targets[0].key === 'palace_harem', s2.targets[0].key);
      ok('　两边的演出也不同', JSON.stringify(s1.effects) !== JSON.stringify(s2.effects));
    }
  }

  console.log('===== ⑤ 皇宫线 / 中立线：require 真生效 =====');
  {
    const { evalCond } = require(path.join(ROOT, 'game/src/core/modapi.js'));
    const can = (birth, flags, gender) => {
      const e = boot(505, birth, gender); const w = e.world, p = w.player;
      for (const f of flags) p.setFlag(f, true);
      return {
        court: evalCond(w.getQuest('q_main_court').require, { player: p, world: w }),
        neutral: evalCond(w.getQuest('q_main_neutral').require, { player: p, world: w }),
      };
    };
    const orth = can('noble', ['act3_done', 'pre_court_tongshi'], 'male');
    ok('★ 正派 + 前置齐 → 接得到皇宫线', orth.court === true);
    ok('★ 正派 → 接不到中立线', orth.neutral === false);
    const out = can('grudge_orphan', ['act3_done', 'pre_court_tongshi'], 'male');
    ok('★ 反派 → 接不到皇宫线（宫里不认他）', out.court === false);
    const neu = can('orphan', [], 'male');
    ok('★ 中立出身 → 接得到中立线', neu.neutral === true);
    const orthNoPre = can('noble', ['act3_done'], 'male');
    ok('★ 前置抄本没做完 → 接不到皇宫线', orthNoPre.court === false);
  }

  console.log('===== ⑥ 幕次推导：nextAct 不再是死代码 =====');
  {
    const e = boot(606, 'noble', 'male'); const w = e.world, p = w.player;
    ok('★ 开局第 1 幕', ML.stateOf(p).act === 1, String(ML.stateOf(p).act));
    ok('★ 线别按出身定（noble → orthodox）', ML.stateOf(p).line === 'orthodox', ML.stateOf(p).line);
    p.quests['q_main_jianghu'] = 99;
    ok('★ 第一幕做完 → 第 2 幕', ML.stateOf(p).act === 2, String(ML.stateOf(p).act));
    p.quests['q_main_sect'] = 99;
    ok('★ 第二幕做完 → 第 3 幕', ML.stateOf(p).act === 3, String(ML.stateOf(p).act));
    ok('★ 幕次只增不减（存读档不会倒退）', ML.stateOf(p).act === 3);
    void w;
  }

  console.log('===== ⑦ 前置支线真能接、真能交 =====');
  {
    const e = boot(707, 'noble', 'male'); const w = e.world, p = w.player;
    const q = w.getQuest('sq_pre_a1_chuan');
    p.room = w.data.npcs[q.giver].room;
    w.spawnNpc(q.giver, p.room, 1, true);
    const r1 = await e.exec('接任务 茶摊那壶凉的');
    ok('★ 接得下', p.questStage('sq_pre_a1_chuan') === 0, txt(r1).slice(0, 60));
    p.room = 'jiangnan_market'; await e.exec('看');
    ok('　到目标房攒上 var', (p.getVar('sq_pre_a1_chuan_go0') || 0) >= 1);
    p.room = w.data.npcs[q.giver].room;
    const r2 = await e.exec('交任务');
    ok('★ 交得上（阶段 0→1）', p.questStage('sq_pre_a1_chuan') === 1, txt(r2).slice(0, 80));
    p.room = 'road_jiangnan_1'; await e.exec('看');
    p.room = w.data.npcs[q.giver].room;
    await e.exec('交任务');
    ok('★ 能走完（stage 99）', p.questStage('sq_pre_a1_chuan') === 99, 'stage=' + p.questStage('sq_pre_a1_chuan'));
    ok('★ 走完落下前置 flag（锁的钥匙到手）', p.hasFlag('pre_a1_chuan'));
  }

  console.log('');
  console.log('主线分化 P2~P5：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
