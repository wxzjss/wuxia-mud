#!/usr/bin/env node
/* ==========================================================================
 *  tools/_sect_errand_check.js —— 114-② 35 派差事 + ③ 巡山 真走验收
 *  ① 35 派：本门弟子在掌门处「可接」列出本派差事；非本门不列
 *  ② 抽两条真走完（room 型 / item 型）：接案→做事→两次交差→contrib 30 到账
 *  ③ 巡山：本门 +5、同日第二次被挡、非本门被挡
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✔ ' + n + (x ? '  ' + x : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (x ? '  « ' + x : '')); }
};
const txt = r => JSON.stringify((r && r.lines) || []);

function boot() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot(); e.newGame({ name: '差事侠', gender: 'male' });
  return e;
}
const D = boot().world.data;

const QUESTS = Object.keys(D.quests).filter(q => /^q_sect_.+_errand$/.test(q)).sort();

console.log('① ' + QUESTS.length + ' 派差事：本门可见 / 非本门不可见');
for (const qid of QUESTS) {
  const q = D.quests[qid];
  const sect = q.require && q.require.sect;
  const giver = q.giver;
  const npc = D.npcs[giver] || {};
  const room = npc.room;
  if (!sect || !room) { ok(qid + ' 结构', false, 'require/giver 房缺失'); continue; }
  const e = boot(); const p = e.world.player;
  p.sect = sect; p.room = room; e.exec('看');
  const seen = (e.exec('任务').lines || []).filter(l => l.quest).map(l => l.quest);
  ok(qid, seen.includes(qid), 'sect=' + sect + ' room=' + room);
  const e2 = boot(); const p2 = e2.world.player;
  p2.sect = (sect === 'jindao' ? 'huashan' : 'jindao'); p2.room = room; e2.exec('看');
  const seen2 = (e2.exec('任务').lines || []).filter(l => l.quest).map(l => l.quest);
  ok(qid + ' 非本门不列', !seen2.includes(qid));
}

console.log('② 真走两条（room 型 / item 型）');
{
  const e = boot(); const p = e.world.player;
  p.sect = 'taishan'; p.room = 'taishan_gate'; e.exec('看');
  p.setQuestStage('q_sect_taishan_errand', 0);
  p.room = 'taishan_hall'; e.exec('看');
  p.room = 'taishan_gate'; e.exec('看');
  e.exec('交差'); e.exec('交差');
  ok('泰山 room 型：完成 + contrib 30', p.questStage('q_sect_taishan_errand') === 99 && p.sectContribution === 30,
     'stage=' + p.questStage('q_sect_taishan_errand') + ' contrib=' + p.sectContribution);
}
{
  const e = boot(); const p = e.world.player;
  p.sect = 'tangmen'; p.room = 'tangmen_gate'; e.exec('看');
  p.setQuestStage('q_sect_tangmen_errand', 0);
  e.world.giveItem(p, 'herb_lingshen', 1);
  p.room = 'tangmen_gate'; e.exec('看');
  e.exec('交差'); e.exec('交差');
  ok('唐门 item 型：完成 + contrib 30', p.questStage('q_sect_tangmen_errand') === 99 && p.sectContribution === 30,
     'stage=' + p.questStage('q_sect_tangmen_errand') + ' contrib=' + p.sectContribution);
}

console.log('③ 巡山：本门 +5 / 同日限次 / 非本门');
for (const [sect, room] of [['jindao', 'jindao_gate'], ['taishan', 'taishan_gate'], ['tangmen', 'tangmen_gate']]) {
  const e = boot(); const p = e.world.player;
  p.sect = sect; p.room = room; e.exec('看');
  e.exec('巡山'); const c1 = p.sectContribution;
  const r2 = e.exec('巡山');
  ok(sect + ' 巡山 +5 且二次被挡', c1 === 5 && p.sectContribution === 5 && txt(r2).indexOf('今日已经做过') >= 0,
     'contrib=' + p.sectContribution);
}
{
  const e = boot(); const p = e.world.player;
  p.sect = 'huashan'; p.room = 'jindao_gate'; e.exec('看');
  e.exec('巡山');
  ok('非本门巡山被挡', p.sectContribution === 0, 'contrib=' + p.sectContribution);
}

console.log('');
console.log('==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
