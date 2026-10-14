#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act3_case2_check.js —— 案 2 阮听「丁春秋的解药」真走通验收（design/102 §六）
 *  --------------------------------------------------------------------------
 *  · 接案→5 stage 逐段真走（菜单逐个真选，散人通道：贺兰隘口私贩带路）
 *  · s3 带话 = 65 现成戏「问解药」真触发（warm 分支：ruan_cure+star_cure_item）
 *  · s4 know_zhenyi 前置锁双向验证
 *  · 交回药庐分支：star_cure_item 交出 + rep:星宿海
 *  · 指路：巴扎「瓶子满了」钩子 + 药庐 talk[1] 妹妹钩子（现成）
 *  用法：node tools/_act3_case2_check.js
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
p.setFlag('snow_lead', true);
p.setFlag('act2_done', true);
p.money = 500;

console.log('\n① s0 接案（果子摊）');
p.quests['hk_npcv_090_jieyao'] = 0;
p.room = 'jn_fruit_stall';
e.exec('看');
ok('s0 目标房计数', p.getVar('hk_npcv_090_jieyao_go0') === 1);
let r = e.exec('交差');
ok('s0 复命推进到 s1', p.questStage('hk_npcv_090_jieyao') === 1);
let menu = pickMenu(r);
ok('s0 菜单出现（跑星宿海/劝离开）', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s0 选「替他再跑一趟星宿海」→ hk_gu', p.hasFlag('hk_gu'));

console.log('\n② s1 妹妹那碗药');
p.room = 'jn_fruit_stall';
e.exec('看');
ok('s1 目标房计数', p.getVar('hk_npcv_090_jieyao_go1') === 1);
r = e.exec('交差');
ok('s1 复命推进到 s2', p.questStage('hk_npcv_090_jieyao') === 2);
ok('s1 → ruan_sister_known', p.hasFlag('ruan_sister_known'));

console.log('\n③ s2 星宿取药解（药庐）');
p.room = 'xiyu_herb_hut';
e.exec('看');
ok('s2 目标房计数（药庐可达）', p.getVar('hk_npcv_090_jieyao_go2') === 1);
p.room = 'jn_fruit_stall';          // 回 giver 房复命
r = e.exec('交差');
ok('s2 复命推进到 s3', p.questStage('hk_npcv_090_jieyao') === 3);
menu = pickMenu(r);
ok('s2 菜单出现（双通道取药引）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s2 散人通道（贺兰隘口私贩）→ ruan_formula_known', p.hasFlag('ruan_formula_known'), '钱剩 ' + p.money);

console.log('\n④ s3 带话（65 现成戏「问解药」warm 分支）');
p.room = 'jn_fruit_stall';
e.exec('看');
ok('s3 目标房计数', p.getVar('hk_npcv_090_jieyao_go3') === 1);
r = e.exec('问解药');
ok('问解药真触发', !!(r && r.lines && r.lines.length));
menu = pickMenu(r);
ok('问解药菜单出现（双分支）', !!(menu && menu.length === 2));
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('warm 分支：ruan_cure 置位', p.hasFlag('ruan_cure') && p.hasFlag('npv090_warm'));
ok('warm 分支：star_cure_item 入手', p.countItem('star_cure_item') >= 1);
r = e.exec('交差');
ok('s3 复命推进到 s4', p.questStage('hk_npcv_090_jieyao') === 4);

console.log('\n⑤ s4 交与不交（know_zhenyi 前置锁）');
p.room = 'xiyu_herb_hut';
e.exec('看');
ok('s4 目标房计数', p.getVar('hk_npcv_090_jieyao_go4') === 1);
p.room = 'jn_fruit_stall';          // 回 giver 房复命（阮听在果子摊）
r = e.exec('交差');
ok('know_zhenyi 未置 → 复命被锁', p.questStage('hk_npcv_090_jieyao') === 4);
p.setFlag('know_zhenyi', true);
r = e.exec('交差');
ok('know_zhenyi 置位 → 复命可交', p.questStage('hk_npcv_090_jieyao') === 99);
menu = pickMenu(r);
ok('s4 菜单出现（给他断蛊/交回药庐）', !!(menu && menu.length === 2));
const repBefore = (p.reputation && p.reputation['星宿海']) || 0;
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('交回药庐 → ruan_stay + star_cure_item 交出 + rep:星宿海',
  p.hasFlag('ruan_stay') && p.countItem('star_cure_item') === 0 &&
  ((p.reputation && p.reputation['星宿海']) || 0) > repBefore);

console.log('\n⑥ 指路 + 散人自查');
const bzr = JSON.stringify(W.getRoom('xiyu_bazaar').talk || []);
ok('指路：巴扎 talk 含「瓶子满了」', bzr.includes('瓶子满了'));
const hut = JSON.stringify(W.getRoom('xiyu_herb_hut').talk || []);
ok('指路：药庐 talk 含妹妹钩子（替我试新方子）', hut.includes('试新方子'));
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
