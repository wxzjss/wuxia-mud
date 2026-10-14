#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act3_case1_check.js —— 案 1 陈语冰「那个名额」真走通验收（design/102 §六）
 *  --------------------------------------------------------------------------
 *  · 接案→5 stage 逐段真走（菜单逐个真选）
 *  · s2 枕下那个字 = 65 现成戏「问抄纸」真触发（warm 分支）
 *  · s4 know_zhenyi 前置锁：置 flag 前交不了（明说 lockhint），置了才能交
 *  · 半交结局前置自查：chen_chaoben 留在手上那条分支 flag 不丢
 *  · 指路三处可见（兴庆集市/巴扎 talk + 盐场尾句）
 *  用法：node tools/_act3_case1_check.js
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
p.setFlag('snow_lead', true);      // 65 房动作的门
p.setFlag('act2_done', true);      // 行路/闸门
p.money = 500;

console.log('\n① 接案与 s0 花厅');
p.quests['hk_npcv_252_minge'] = 0;
p.room = 'jn_brothel_hall';
e.exec('看');
ok('s0 目标房计数', p.getVar('hk_npcv_252_minge_go0') === 1);
p.room = 'jn_brothel_room';
let r = e.exec('交差');
ok('s0 复命推进到 s1', p.questStage('hk_npcv_252_minge') === 1);
let menu = pickMenu(r);
ok('s0 菜单出现（让贤/争到）', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s0 选「劝她让贤」→ flag yield', p.hasFlag('hk_npcv_252_minge_yield'));

console.log('\n② s1 名额从哪来');
p.room = 'jn_brothel_hall';
e.exec('看');
ok('s1 目标房计数', p.getVar('hk_npcv_252_minge_go1') === 1);
p.room = 'jn_brothel_room';
r = e.exec('交差');
ok('s1 复命推进到 s2', p.questStage('hk_npcv_252_minge') === 2);
menu = pickMenu(r);
ok('s1 菜单出现（双通道查户头）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s1 散人通道（塞茶钱）→ salt_link_seen', p.hasFlag('salt_link_seen'), '钱剩 ' + p.money);

console.log('\n③ s2 枕下那个字（65 现成戏「问抄纸」warm 分支）');
p.room = 'jn_brothel_room';
e.exec('看');
ok('s2 目标房计数', p.getVar('hk_npcv_252_minge_go2') === 1);
r = e.exec('问抄纸');
ok('问抄纸真触发', !!(r && r.lines && r.lines.length));
menu = pickMenu(r);
ok('问抄纸菜单出现（双分支）', !!(menu && menu.length === 2));
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('warm 分支：chen_chaoben 置位（半交结局前置）', p.hasFlag('chen_chaoben') && p.hasFlag('252_warm'));
ok('warm 分支：抄本入手', p.countItem('wulin_zhenyi_chaoben') >= 1);
r = e.exec('交差');
ok('s2 复命推进到 s3', p.questStage('hk_npcv_252_minge') === 3);

console.log('\n④ s3 疏勒对货');
p.room = 'xiyu_bazaar';
e.exec('看');
ok('s3 目标房计数（巴扎可达）', p.getVar('hk_npcv_252_minge_go3') === 1);
p.room = 'jn_brothel_room';
r = e.exec('交差');
ok('s3 复命推进到 s4', p.questStage('hk_npcv_252_minge') === 4);
menu = pickMenu(r);
ok('s3 菜单出现（运单底子）', !!(menu && menu.length === 2));
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s3 → cha_route_known', p.hasFlag('cha_route_known'));

console.log('\n⑤ s4 卷终抉择（know_zhenyi 前置锁）');
p.room = 'jn_brothel_hall';
e.exec('看');
ok('s4 目标房计数', p.getVar('hk_npcv_252_minge_go4') === 1);
r = e.exec('交差');
ok('know_zhenyi 未置 → 复命被锁（tryReportQuest skip）',
  p.questStage('hk_npcv_252_minge') === 4);
p.setFlag('know_zhenyi', true);
p.room = 'jn_brothel_room';          // 回 giver 房复命（花厅没有 giver）
r = e.exec('交差');
ok('know_zhenyi 置位 → 复命可交', p.questStage('hk_npcv_252_minge') === 99);
menu = pickMenu(r);
ok('s4 菜单出现（交东厂/留在手上）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('选「留在手上」→ chen_kept + chen_chaoben 仍在（半交结局成立）',
  p.hasFlag('chen_kept') && p.hasFlag('chen_chaoben') && p.countItem('wulin_zhenyi_chaoben') >= 1);

console.log('\n⑥ 指路三处 + 散人自查');
const mkt = W.getRoom('xixia_market');
ok('指路②兴庆集市 talk 含捐银话', JSON.stringify(mkt.talk || []).includes('捐过一笔银子'));
const bzr = W.getRoom('xiyu_bazaar');
ok('指路③巴扎 talk 含常家货栈', JSON.stringify(bzr.talk || []).includes('常家货栈'));
const ycs = JSON.stringify(W.getRoom('xixia_yanchang').actions || []);
ok('指路①盐场问煮盐人尾补捐银句', ycs.includes('捐银'));
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
