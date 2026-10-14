#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act3_case4_check.js —— 案 4「哨卡的规矩」真走通验收（design/102 §六）
 *  --------------------------------------------------------------------------
 *  · 新写案 4 stage 真走（新 NPC 铁器摊主：出生/定岗/接案动作/挂案）
 *  · 接案走**真实入口**（问铁器摊主动作授案，不直接塞 p.quests）
 *  · s2 双通道菜单真选（散人线：烈酒通路）
 *  · s3 收口：bj_manifest 落定 + 咬合主线 pass_shankou（软咬合不锁）
 *  · 指路：望雪台 talk（数布条/数火把）
 *  用法：node tools/_act3_case4_check.js
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

console.log('\n① 新 NPC 出生与接案（真实入口）');
const room = W.getRoom('beijiang_market');
const npcs = W.npcsIncludingTemplates('beijiang_market') || [];
const smith = npcs.find(n => n.def && n.def.id === 'npc_bj_smith');
ok('铁器摊主出生在冻市', !!smith, npcs.map(n => n.name).join('/'));
ok('noWander 定岗（不会漂到出生点）', smith && smith.def.noWander === true);
p.room = 'beijiang_market';
let r = e.exec('问铁器摊主');
ok('接案动作「问铁器摊主」授案', p.questStage('q_bj_shaogui') === 0, !!r && r.lines.length + ' 行');
e.exec('看');
ok('s0 目标房计数', p.getVar('q_bj_shaogui_go0') === 1);
r = e.exec('交差');
ok('s0 复命推进到 s1', p.questStage('q_bj_shaogui') === 1);
let menu = pickMenu(r);
ok('s0 菜单出现（应下来/先问规矩）', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
if (menu && menu[0]) e.menuPick({ effects: menu[0].effects });
ok('s0 → bj_son_worried + favor 摊主', p.hasFlag('bj_son_worried'));

console.log('\n② s1 摸哨（望雪台）');
p.room = 'beijiang_lookout';
e.exec('看');
ok('s1 目标房计数（望雪台可达）', p.getVar('q_bj_shaogui_go1') === 1);
p.room = 'beijiang_market';
r = e.exec('交差');
ok('s1 复命推进到 s2', p.questStage('q_bj_shaogui') === 2);
ok('s1 → bj_spot_son', p.hasFlag('bj_spot_son'));

console.log('\n③ s2 走一趟雪谷（散人通道：烈酒）');
p.room = 'beijiang_shankou';
e.exec('看');
ok('s2 目标房计数（雪谷山口可达）', p.getVar('q_bj_shaogui_go2') === 1);
p.room = 'beijiang_market';
r = e.exec('交差');
ok('s2 复命推进到 s3', p.questStage('q_bj_shaogui') === 3);
menu = pickMenu(r);
ok('s2 菜单出现（腰牌/烈酒）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s2 散人通道（烈酒通路）→ bj_met_son', p.hasFlag('bj_met_son'), '钱剩 ' + p.money);

console.log('\n④ s3 收口（半页运单）');
p.room = 'beijiang_market';
e.exec('看');
ok('s3 目标房计数', p.getVar('q_bj_shaogui_go3') === 1);
r = e.exec('交差');
ok('s3 复命收官（99）', p.questStage('q_bj_shaogui') === 99);
ok('★ bj_manifest 落定（咬合 hm_blood_saber 人手房名单的旁证）', p.hasFlag('bj_manifest'));
menu = pickMenu(r);
ok('s3 菜单出现（留摊上/描底子）', !!(menu && menu.length === 2));
if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
ok('s3 描底子 → bj_manifest_copy + rep:朝廷', p.hasFlag('bj_manifest_copy'));

console.log('\n⑤ 指路 + 双通道自查');
ok('指路：望雪台 talk 含换防火把', JSON.stringify(W.getRoom('beijiang_lookout').talk || []).includes('换防的火把'));
ok('指路：冻市摊主 talk 含血刀门规矩句（现成）', JSON.stringify(room.talk || []).includes('血刀门的规矩'));
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
