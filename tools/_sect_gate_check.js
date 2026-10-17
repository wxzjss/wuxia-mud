#!/usr/bin/env node
/* ==========================================================================
 *  tools/_sect_gate_check.js —— 门派山门「拜入门下」真走验收
 *  ① 29 个 *_gate：在同房点/敲「拜师 X」必须真入门（p.sect === sectId）
 *  ② 门槛型门派（悟性/力量/karma/性别）：达标入门；不达标必须给明确拒绝语，不许只有空壳 narrate
 *  ③ qa 的复现点：jindao_gate 拜师金刀门
 *  用法：node tools/_sect_gate_check.js
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

function fresh() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot(); e.newGame({ name: '拜师侠', gender: 'male' });
  return e;
}

const D = (() => { const e = fresh(); return e.world.data; })();

// 29 个山门（73 里带 joinSect 的那批）
const GATES = Object.keys(D.rooms)
  .filter(rid => rid.endsWith('_gate') && D.sects[rid.slice(0, -5)])
  .filter(rid => (D.rooms[rid].actions || []).some(a => (a.cmd || '').startsWith('拜师')))
  .sort();

console.log('① ' + GATES.length + ' 个山门：达标玩家必须真入门');
for (const rid of GATES) {
  const sectId = rid.slice(0, -5);
  const e = fresh(); const p = e.world.player;
  // 造一个达标玩家：全属性 30、50 级、karma 按门槛调、性别/种族满足
  p.attr = { 力量: 30, 根骨: 30, 身法: 30, 悟性: 30, 福缘: 30, 定力: 30 };
  p.level = 50;
  const req = (D.sects[sectId] || {}).require || {};
  if (req.karma) p.karma = /^<=/.test(req.karma) ? -99 : 99;
  else p.karma = 0;
  if (req.gender === 'female') p.gender = 'female';
  p.room = rid;
  const cmd = (D.rooms[rid].actions.find(a => (a.cmd || '').startsWith('拜师')).cmd);
  const r = e.exec(cmd);
  ok(sectId + '（' + rid + '）', p.sect === sectId,
     'sect=' + p.sect + ' | ' + txt(r).slice(0, 44));
}

console.log('② qa 复现点：金刀门');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'jindao_gate';
  const r = e.exec('拜师 金刀门');
  ok('山门口直接拜师 → p.sect=jindao', p.sect === 'jindao', 'sect=' + p.sect);
  ok('有入门回执（不是只剩空壳 narrate）', txt(r).indexOf('门徒') >= 0 || txt(r).indexOf('拜入') >= 0, txt(r).slice(0, 60));
}

console.log('③ 门槛不达标：必须给明确拒绝语');
{
  // 桃花岛要悟性 18：基础玩家悟性不够
  const e = fresh(); const p = e.world.player;
  p.room = 'taohua_gate';
  const r = e.exec('拜师 桃花岛');
  ok('悟性不足被拒且说清原因', p.sect !== 'taohua' && (txt(r).indexOf('悟性') >= 0 || txt(r).indexOf('不收') >= 0), txt(r).slice(0, 60));
}

console.log('');
console.log('==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
