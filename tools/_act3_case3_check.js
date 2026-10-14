#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act3_case3_check.js —— 案 3 俞初「三年前那一笔」真走通验收（design/102 §六）
 *  --------------------------------------------------------------------------
 *  · 两连池壳深改造：jiushui 4 stage 真走 + changfu 并入 s3 且删净（悬空引用清零）
 *  · s1/s2 双通道菜单真选（散人线：工棚混抄 / 私拆信）
 *  · s3 对账收口：snow_evidence_xixia 落定（主线三线 flag 补齐——判定接线引擎 lane）
 *  · 指路：兴庆驿 + 冰窖 talk
 *  用法：node tools/_act3_case3_check.js
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

const e = new GameEngine({ seed: 20261008 });
e.boot();
e.newGame({ name: '验收员', gender: 'male', birth: 'wuxue' });
const p = e.world.player;
const W = e.world;
p.setFlag('act2_done', true);
p.money = 500;

console.log('\n① s0 冰窖假账（原壳）');
p.quests['hk_npcv_248_jiushui'] = 0;
p.room = 'xixia_ice';
e.exec('看');
ok('s0 目标房计数', p.getVar('hk_npcv_248_jiushui_go0') === 1);
p.room = 'road_xixia_1';       // 俞初在西夏官道
let r = e.exec('交差');
ok('s0 复命推进到 s1', p.questStage('hk_npcv_248_jiushui') === 1);
let menu = pickMenu(r);
ok('s0 菜单出现（留抄本/当面烧）', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s0 留抄本 → _copy + rep:朝廷', p.hasFlag('hk_npcv_248_jiushui_copy'));

console.log('\n② s1 盐册对页（散人通道：工棚混抄）');
p.room = 'xixia_yanchang';
e.exec('看');
ok('s1 目标房计数（盐场可达）', p.getVar('hk_npcv_248_jiushui_go1') === 1);
p.room = 'road_xixia_1';
r = e.exec('交差');
ok('s1 复命推进到 s2', p.questStage('hk_npcv_248_jiushui') === 2);
menu = pickMenu(r);
ok('s1 菜单出现（门内文书/工棚混抄）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s1 散人通道 → xixia_salt_ledger', p.hasFlag('xixia_salt_ledger'), '钱剩 ' + p.money);

console.log('\n③ s2 官道截信（私拆线）');
p.room = 'xixia_post';
e.exec('看');
ok('s2 目标房计数（兴庆驿可达）', p.getVar('hk_npcv_248_jiushui_go2') === 1);
p.room = 'road_xixia_1';
r = e.exec('交差');
ok('s2 复命推进到 s3', p.questStage('hk_npcv_248_jiushui') === 3);
menu = pickMenu(r);
ok('s2 菜单出现（登记/私拆）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s2 私拆 → xixia_intercept', p.hasFlag('xixia_intercept'));

console.log('\n④ s3 对账收口（changfu 并入）');
p.room = 'road_xixia_1';
e.exec('看');
ok('s3 目标房计数', p.getVar('hk_npcv_248_jiushui_go3') === 1);
r = e.exec('交差');
ok('s3 复命收官（99）', p.questStage('hk_npcv_248_jiushui') === 99);
ok('★ snow_evidence_xixia 落定（西夏线取证，主线三线 flag 补齐）', p.hasFlag('snow_evidence_xixia'));
menu = pickMenu(r);
ok('s3 菜单出现（常拂的清白）', !!(menu && menu.length === 2));
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s3 替常拂递对账 → changfu_clear 并入成立', p.hasFlag('hk_npcv_248_changfu_clear'));

console.log('\n⑤ changfu 删净 + 指路');
ok('changfu 案已删（quests 无此 id）', !W.getQuest('hk_npcv_248_changfu'));
const n248 = (W.data.npcs || {})['npcv_248'] || {};
ok('changfu 悬空引用清零（npcv_248.quests）', !(n248.quests || []).includes('hk_npcv_248_changfu'));
ok('指路：兴庆驿 talk 含三年前那页账', JSON.stringify(W.getRoom('xixia_post').talk || []).includes('三年前有一页账'));
ok('指路：冰窖 talk 含工棚指引', JSON.stringify(W.getRoom('xixia_ice').talk || []).includes('册子在工棚'));
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
