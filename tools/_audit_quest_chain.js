#!/usr/bin/env node
/* ==========================================================================
 *  tools/_audit_quest_chain.js —— #152 任务真链路核验（审计用，不进套件）
 *
 *  覆盖：
 *   1) 12 条已挂载任务逐条走「接取 → 推进 → 交付」真链路
 *   2) 2 条未挂载悬赏（q_bounty_bandit / q_bounty_wolf）单独标出
 *   3) q_adv_lantern_ferry 时辰门槛：白天拒 / 夜里可接
 *   4) 两条「带回型」（gall / page）：交付时物品扣除与奖励结算
 *   5) NPC 面板可见性（view().npcs 的 hasQuest / canReport + 任务面板清单）
 *
 *  用法：node tools/_audit_quest_chain.js
 * ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const QIDS = [
  'q_adv_shoe_coin', 'q_adv_frost_well', 'q_adv_lantern_ferry',
  'q_adv_drunk_sword', 'q_adv_new_grave', 'q_siguya_sword',
  'q_bounty_boar', 'q_bounty_snake', 'q_bounty_harbor', 'q_bounty_bear',
  'q_bounty_gall', 'q_bounty_page',
  'q_bounty_bandit', 'q_bounty_wolf',
];

function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261018 });
  e.boot(); e.newGame({ name: '验事', gender: 'male', birth: 'wuxue' });
  return e;
}
const txt = r => ((r && r.lines) || []).map(l => l.text || '').join(' ');

/* 找挂载点：哪个 NPC 的 quests 里挂着这条任务 */
function mountOf(w, qid) {
  for (const [id, n] of Object.entries(w.data.npcs || {})) {
    if (n && Array.isArray(n.quests) && n.quests.includes(qid)) return { id, room: n.room, name: n.name };
    if (n && n.sidequest === qid) return { id, room: n.room, name: n.name };
  }
  /* 62_shops 之类的覆盖片：boot 后应从 npcs 合并进来，这里已覆盖 */
  return null;
}

/* 满足当前阶段的全部 targets；返回是否全部达成 */
function fulfill(e, qid) {
  const w = e.world, p = w.player;
  const st = p.questStage(qid);
  const qd = w.getQuest(qid);
  const stage = qd && qd.stages && qd.stages[st];
  if (!stage || !stage.targets) return true;
  for (const t of stage.targets) {
    const k = t.key;
    if (t.kind === 'room') {
      const back = p.room;
      p.room = k; e.exec('look'); p.room = back; e.exec('look');
    } else if (t.kind === 'kill') {
      const keys = t.key ? [t.key] : (t.keys || []);
      for (let i = 0; i < (t.count || 1); i++) {
        w._killQueue = w._killQueue || [];
        for (const kk of keys) w._killQueue.push(kk);
      }
      e.exec('look');
    } else if (t.kind === 'item') {
      w.giveItem(p, k, t.count || 1);
    } else if (t.kind === 'flag') {
      if (t.var) p.setVar(t.var, t.count || 1);
      else p.setFlag(k, true);
      e.exec('look');
    }
  }
  return true;
}
function targetAllDone(e, qid) {
  const w = e.world, p = w.player;
  const qd = w.getQuest(qid);
  const st = p.questStage(qid);
  const stage = qd && qd.stages && qd.stages[st];
  if (!stage || !stage.targets) return true;
  const qs = require(path.join(ROOT, 'game', 'src', 'core', 'queststage.js'));
  return stage.targets.every(t => qs.targetDone(p, qid, t));
}

function runChain(qid) {
  const e = boot();
  const w = e.world, p = w.player;
  const qd = w.getQuest(qid);
  const m = mountOf(w, qid);
  if (!m) return { qid, mounted: false, pass: false, why: '未挂载到任何 NPC（无法接/交）' };
  /* 站到委托人房间，把委托人放进来 */
  p.room = m.room;
  const giver = w.spawnNpc(m.id, m.room, 1, true);
  if (!giver || !giver.def) return { qid, mounted: true, pass: false, why: '委托人 ' + m.id + ' 生成失败' };
  /* 前置补给：钱/物/等级不挡接取 */
  w.giveItem(p, 'flatbread', 1);
  p.timeMinutes = 20 * 60;   // 统一放夜里，避免 q_adv_lantern_ferry 的时辰门槛干扰链路
  p.quests = p.quests || {};
  const accept = e.exec('接取 ' + qd.name);
  if (p.questStage(qid) !== 0) {
    return { qid, mounted: true, pass: false, why: '接取失败：' + txt(accept).slice(0, 60) };
  }
  const panelAfterAccept = e.view({ map: false });
  const npcCard = (panelAfterAccept.npcs || []).find(n => n.name === giver.name) || {};
  let rounds = 0, reports = 0;
  while (p.questStage(qid) >= 0 && p.questStage(qid) < 99 && rounds++ < 5) {
    fulfill(e, qid);
    if (!targetAllDone(e, qid)) {
      return { qid, mounted: true, pass: false, why: '第 ' + (p.questStage(qid) + 1) + ' 段目标无法达成' };
    }
    const r = e.exec('交任务');
    reports++;
    if (!/任务完成|任务进展/.test(txt(r))) {
      const qd2 = w.getQuest(qid);
      const stg = qd2 && qd2.stages && qd2.stages[p.questStage(qid)];
      let why = '交任务无进展：' + txt(r).slice(0, 50);
      if (stg && stg.cond) {
        const { evalCond } = require(path.join(ROOT, 'game', 'src', 'core', 'modapi.js'));
        if (!evalCond(stg.cond, { player: p, world: w })) why += '（阶段 cond 未满足：' + JSON.stringify(stg.cond) + '）';
      }
      return { qid, mounted: true, pass: false, why };
    }
  }
  return {
    qid, mounted: true, pass: p.questStage(qid) === 99, reports,
    panelHasQuest: !!npcCard.hasQuest, panelCanReport: !!npcCard.canReport,
    why: p.questStage(qid) === 99 ? 'ok' : '阶段停在 ' + p.questStage(qid),
  };
}

function main() {
  console.log('== #152 任务真链路核验 ==\n');
  let okCount = 0;
  const rows = [];
  for (const qid of QIDS) {
    let r;
    try { r = runChain(qid); } catch (err) { r = { qid, pass: false, why: '异常：' + err.message }; }
    rows.push(r);
    if (r.pass) okCount++;
    console.log((r.pass ? '  ✔ ' : '  ✘ ') + qid + '  ' + (r.pass ? '' : '← ' + r.why));
  }
  console.log('\n真链路跑通：' + okCount + '/' + QIDS.length);

  /* 时辰门槛：白天拒 / 夜里可接 */
  console.log('\n== q_adv_lantern_ferry 时辰门槛 ==');
  {
    const qd = require(path.join(ROOT, 'game', 'data', '60_quests.json')).quests.q_adv_lantern_ferry;
    const e = boot(); const w = e.world, p = w.player;
    p.room = 'jiangnan_qiao'; w.spawnNpc('cy_pre_ferryman', 'jiangnan_qiao', 1, true);
    p.timeMinutes = 12 * 60;                      // 白天
    const day = e.exec('接取 ' + qd.name);
    const dayRefused = p.questStage(qd.id) < 0;
    p.timeMinutes = 20 * 60;                      // 夜里（>=1170）
    const night = e.exec('接取 ' + qd.name);
    const nightOk = p.questStage(qd.id) === 0;
    console.log('  白天拒接：' + (dayRefused ? '✔' : '✘') + '  ' + txt(day).slice(0, 46));
    console.log('  夜里可接：' + (nightOk ? '✔' : '✘') + '  ' + txt(night).slice(0, 46));
  }

  /* 带回型：交付结算（物品扣除 + 奖励） */
  console.log('\n== 带回型交付结算 ==');
  for (const [qid, item, need] of [['q_bounty_gall', 'venom_sac', 3], ['q_bounty_page', 'manuscript_page', 1]]) {
    const e = boot(); const w = e.world, p = w.player;
    const m = mountOf(w, qid);
    p.room = m.room; w.spawnNpc(m.id, m.room, 1, true);
    w.giveItem(p, item, need);
    const qd = w.getQuest(qid);
    e.exec('接取 ' + qd.name);
    const before = (p.inventory || []).filter(i => (i.id || i) === item).length;
    const money0 = p.money || 0;
    const r = e.exec('交任务');
    const after = (p.inventory || []).filter(i => (i.id || i) === item).length;
    console.log('  ' + qid + '：交付' + (p.questStage(qid) === 99 ? '✔' : '✘')
      + ' · ' + item + ' ' + before + '→' + after + '（期望 -' + need + '）'
      + ' · 银钱 ' + money0 + '→' + (p.money || 0));
    console.log('     ' + txt(r).slice(0, 80));
  }

  /* NPC 面板可见性：任务面板的可接清单 */
  console.log('\n== NPC 面板可见性 ==');
  {
    const e = boot(); const w = e.world, p = w.player;
    p.room = 'jiangnan_hill'; w.spawnNpc('old_herbalist', 'jiangnan_hill', 1, true);
    e.exec('look');
    const v = e.view({ map: false });
    const card = (v.npcs || []).find(n => n.name === '采药翁') || {};
    const ql = e.exec('任务');
    console.log('  npcfull/slim 卡片 hasQuest=' + !!card.hasQuest + ' canReport=' + !!card.canReport);
    console.log('  任务面板可接清单含「活蛇取胆」：' + /活蛇取胆/.test(txt(ql)));
    console.log('  卡片是否列出任务名：' + (Object.keys(card).some(k => /quests?$/.test(k) && Array.isArray(card[k])) ? '是' : '否（只有旗标）'));
  }
}
main();
