#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j3b_float_shankou_check.js —— 批5 报② 两件真走验收
 *  件② road_xixia_1「对三线的账」（浮名结算，menu 双选 + rep）
 *  件③ beijiang_shankou「递牌」（验牌接引场，双通道 + flag）
 *  --------------------------------------------------------------------------
 *  · 前置未满足 → 动作 cond 挡（真走「现在做不了这个」，不给假入口）
 *  · 三线任意一线 → 件② 可对；双选分支各自落 flag / rep
 *  · 一件只结一次（notFlag 去重：第二次不再出菜单，不重复加声望）
 *  用法：node tools/_j3b_float_shankou_check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}
function pickMenu(r) {
  const l = (r && r.lines || []).find(x => x && x.kind === 'menu');
  return l ? l.options : null;
}
function txt(r) { return JSON.stringify(r && r.lines || []); }

function fresh() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot();
  e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

/* ---------------- 件② 浮名回报件 ---------------- */
console.log('\n① 件② 对三线的账 · 前置与三线通道');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'road_xixia_1';
  let r = e.exec('对账');
  ok('三线全无 → 动作被挡（不给假入口）', !pickMenu(r) && txt(r).indexOf('现在做不了这个') >= 0);
  ok('被挡时不留 flag', !p.hasFlag('act3_mole_named') && !p.hasFlag('act3_mole_withheld'));
}

for (const [line, label] of [['snow_evidence_xixia', '西夏线'], ['ruan_cure', '星宿线'], ['bj_manifest', '血刀线']]) {
  const e = fresh(); const p = e.world.player;
  p.setFlag(line, true);
  p.room = 'road_xixia_1';
  const r = e.exec('对账');
  const menu = pickMenu(r);
  ok(label + ' alone → 件② 可对（' + line + '）', !!(menu && menu.length === 2),
     menu ? menu.map(o => o.label).join('/') : '(无菜单)');
}

console.log('\n② 件② 双选：照实说（浮名入档）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('bj_manifest', true);
  const rep0 = p.reputation['朝廷'] || 0;
  p.room = 'road_xixia_1';
  let r = e.exec('对账');
  const menu = pickMenu(r);
  if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
  ok('照实说 → act3_mole_named', p.hasFlag('act3_mole_named'));
  ok('照实说 → 朝廷声望 +20', (p.reputation['朝廷'] || 0) === rep0 + 20,
     rep0 + ' -> ' + (p.reputation['朝廷'] || 0));
  ok('照实说 → 不落留一手旗', !p.hasFlag('act3_mole_withheld'));
  // 只结一次
  const rep1 = p.reputation['朝廷'] || 0;
  r = e.exec('对账');
  ok('第二次 → 不再出菜单（不重复结算）', !pickMenu(r));
  ok('第二次 → 声望不再涨', (p.reputation['朝廷'] || 0) === rep1);
}

console.log('\n③ 件② 双选：留一手（半交浮名）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('ruan_cure', true);
  const rep0 = p.reputation['朝廷'] || 0;
  p.room = 'road_xixia_1';
  const r = e.exec('对账');
  const menu = pickMenu(r);
  if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
  ok('留一手 → act3_mole_withheld', p.hasFlag('act3_mole_withheld'));
  ok('留一手 → 不入朝廷账（声望不变）', (p.reputation['朝廷'] || 0) === rep0,
     rep0 + ' -> ' + (p.reputation['朝廷'] || 0));
  ok('留一手 → 不落照实说旗', !p.hasFlag('act3_mole_named'));
}

/* ---------------- 件③ 哨卡验牌接引场 ---------------- */
console.log('\n④ 件③ 递牌 · 双通道与去重');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'beijiang_shankou';
  let r = e.exec('递牌');
  ok('无运单无过哨 → 被挡', txt(r).indexOf('现在做不了这个') >= 0 && !p.hasFlag('shankou_card_seen'));
}
for (const [gate, label] of [['bj_manifest', '运单'], ['pass_shankou', '已过哨']]) {
  const e = fresh(); const p = e.world.player;
  p.setFlag(gate, true);
  p.room = 'beijiang_shankou';
  let r = e.exec('递牌');
  ok(label + ' → 递牌放行 + flag', p.hasFlag('shankou_card_seen'),
     (r && r.lines || []).map(l => l.text || '').join(' | ').slice(0, 40));
  const lines = (r && r.lines || []).map(l => l.text || '').join('|');
  ok(label + ' → 接引句出现', lines.indexOf('道认牌不认人') >= 0);
  r = e.exec('递牌');
  ok(label + ' → 第二次不再触发（flag 去重）', txt(r).indexOf('道认牌不认人') < 0);
}

/* ---------------- 两件互不干扰 ---------------- */
console.log('\n⑤ 收紧面');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('bj_manifest', true);
  p.room = 'beijiang_shankou';
  e.exec('递牌');
  p.room = 'road_xixia_1';
  const r = e.exec('对账');
  ok('验牌后仍可对账（shankou_card_seen 不吞件②）', !!pickMenu(r));
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
