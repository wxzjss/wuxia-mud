#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j3b_batch5_check.js —— 批5·卷三第二批 报① 两案真走通验收
 *  （阮听「妹妹那碗药」/ 陈语冰「枕下那个字」，design/105 案A/案B）
 *  --------------------------------------------------------------------------
 *  · 散人全程（不入门派）：接案（NPC 动作）→逐 stage 目标房计数→回 giver 房交差
 *  · 接案 cond 前置实测：前置案未完 → 问妹妹/问那本书 接不了（缺口修复验证）
 *  · 新 3 stage 的指路房动作（问诊/翻试方册/看枕下/翻旧货单）真触发 + flag
 *  · 收束 stage.lock（know_zhenyi）：未置 → 交不了（lockMsg 出现）；置后 → 菜单真选
 *  用法：node tools/_j3b_batch5_check.js
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

const e = new GameEngine({ seed: 20261018 });
e.boot();
e.newGame({ name: '验收侠', gender: 'male' });
const p = e.world.player;
const W = e.world;
ok('散人开局', !p.sect);

/* ---------- 案A · 阮听「妹妹那碗药」 ---------- */
console.log('\n① 案A 前置链（引擎实测：NPC 动作路径 cond）');
p.room = 'jn_fruit_stall';
let r = e.exec('问妹妹');
ok('前置未完（jieyao 未完）→ 问妹妹接不了案',
   p.questStage('hk_npcv_090_meimei') === undefined || p.questStage('hk_npcv_090_meimei') < 0,
   'stage=' + p.questStage('hk_npcv_090_meimei'));
p.setQuestStage('hk_npcv_090_jieyao', 99);   // 前置池壳案视为已完（require questDone）
r = e.exec('问妹妹');
ok('前置已完 → 问妹妹接案到 s0', p.questStage('hk_npcv_090_meimei') === 0,
   'stage=' + p.questStage('hk_npcv_090_meimei'));

console.log('\n② 案A s0-s2（计数→交差→推进，指路动作真触发）');
/* s0：果子摊听药钱（target 与 giver 同房） */
e.exec('看');
ok('s0 目标房计数（jn_fruit_stall）', p.getVar('hk_npcv_090_meimei_goA') === 1);
r = e.exec('交差');
ok('s0 交差推进到 s1', p.questStage('hk_npcv_090_meimei') === 1, 'stage=' + p.questStage('hk_npcv_090_meimei'));

/* s1：燕子坞问诊（指路动作） */
p.room = 'gusu_yanzi';
e.exec('看');
ok('s1 目标房计数（gusu_yanzi）', p.getVar('hk_npcv_090_meimei_goB') === 1);
r = e.exec('问诊');
ok('指路「问诊」真触发且 setFlag', p.hasFlag('meimi_poison_known') && (r.lines || []).length > 0);
p.room = 'jn_fruit_stall';
e.exec('交差');
ok('s1 交差推进到 s2', p.questStage('hk_npcv_090_meimei') === 2);

/* s2：星宿海药庐翻试方册（指路动作） */
p.room = 'xiyu_herb_hut';
e.exec('看');
ok('s2 目标房计数（xiyu_herb_hut）', p.getVar('hk_npcv_090_meimei_goC') === 1);
r = e.exec('翻试方册');
ok('指路「翻试方册」真触发且 setFlag', p.hasFlag('meimi_note_read'));
p.room = 'jn_fruit_stall';
r = e.exec('交差');
ok('s2 交差推进到 s3（收束）', p.questStage('hk_npcv_090_meimei') === 3);
/* lockMsg 出在「进入 s3 那条指令」的输出里（checkQuestAuto 只推一次，lockhint_ 去重） */
const lockA = txt(r);

/* ---------- 案B · 陈语冰「枕下那个字」（先走 s0-s2，锁测排在两案都到 s3 后） ---------- */
console.log('\n③ 案B 前置链 + s0-s2');
p.room = 'jn_brothel_room';
r = e.exec('问那本书');
ok('前置未完（minge 未完）→ 问那本书接不了案',
   p.questStage('hk_npcv_252_zi') === undefined || p.questStage('hk_npcv_252_zi') < 0,
   'stage=' + p.questStage('hk_npcv_252_zi'));
p.setQuestStage('hk_npcv_252_minge', 99);
r = e.exec('问那本书');
ok('前置已完 → 问那本书接案到 s0', p.questStage('hk_npcv_252_zi') === 0);

e.exec('看');
ok('s0 目标房计数（jn_brothel_room）', p.getVar('hk_npcv_252_zi_goA') === 1);
e.exec('交差');
ok('s0 交差推进到 s1', p.questStage('hk_npcv_252_zi') === 1);
e.exec('看');
ok('s1 目标房计数（jn_brothel_room）', p.getVar('hk_npcv_252_zi_goB') === 1);
r = e.exec('掀枕下');
ok('指路「掀枕下」真触发且 setFlag', p.hasFlag('zi_name_known'));
e.exec('交差');
ok('s1 交差推进到 s2', p.questStage('hk_npcv_252_zi') === 2);
p.room = 'xiyu_bazaar';
e.exec('看');
ok('s2 目标房计数（xiyu_bazaar）', p.getVar('hk_npcv_252_zi_goC') === 1);
r = e.exec('翻旧货单');
ok('指路「翻旧货单」真触发且 setFlag', p.hasFlag('zi_ledger_seen'));
p.room = 'jn_brothel_room';
r = e.exec('交差');
ok('s2 交差推进到 s3（收束）', p.questStage('hk_npcv_252_zi') === 3);
const lockB = txt(r);

/* ---------- 卷界锁：未置 know_zhenyi → 交不了（lockMsg 出现） ---------- */
console.log('\n④ 卷界锁 know_zhenyi（两案收束 stage）');
/* 案A s3 收束目标是燕子坞 —— 必须重访计数（s1 那次计数记在 goB，不是 go0） */
p.room = 'gusu_yanzi';
e.exec('看');
ok('案A s3 收束目标已计数', p.getVar('hk_npcv_090_meimei_go0') === 1);
p.room = 'jn_fruit_stall';
r = e.exec('交差');
ok('案A 未置卷界 flag → 交差不动', p.questStage('hk_npcv_090_meimei') === 3);
ok('案A lockMsg 出现（进入 s3 那条指令）', lockA.indexOf('伪秘籍的事没到收束那一步') >= 0);

ok('案B s3 收束目标已计数', p.getVar('hk_npcv_252_zi_go0') === 1);
r = e.exec('交差');
ok('案B 未置卷界 flag → 交差不动', p.questStage('hk_npcv_252_zi') === 3);
ok('案B lockMsg 出现（进入 s3 那条指令）', lockB.indexOf('伪秘籍的事没到收束那一步') >= 0);

/* ---------- 置卷界 flag → 收束菜单真选 ---------- */
console.log('\n⑤ 置 flag 后收束（原菜单逐字走真选）');
p.setFlag('know_zhenyi', true);
p.room = 'jn_fruit_stall';
r = e.exec('交差');
const menuA = pickMenu(r);
ok('案A 收束菜单出现（2 项）', !!(menuA && menuA.length === 2), menuA ? menuA.map(o => o.label).join('/') : '(无)');
if (menuA && menuA[0]) e.menuPick({ effects: menuA[0].effects });
ok('案A 选「告知真相」→ flag', p.hasFlag('hk_npcv_090_meimei_tell'));
ok('案A 收束到 99', p.questStage('hk_npcv_090_meimei') === 99, 'stage=' + p.questStage('hk_npcv_090_meimei'));

p.room = 'jn_brothel_room';   // 案B 的复命点在雅阁
r = e.exec('交差');
const menuB = pickMenu(r);
ok('案B 收束菜单出现（2 项）', !!(menuB && menuB.length === 2), menuB ? menuB.map(o => o.label).join('/') : '(无)');
if (menuB && menuB[0]) e.menuPick({ effects: menuB[0].effects });
ok('案B 选「让梅拾知晓」→ flag', p.hasFlag('hk_npcv_252_zi_tell'));
ok('案B 收束到 99', p.questStage('hk_npcv_252_zi') === 99, 'stage=' + p.questStage('hk_npcv_252_zi'));

/* ---------- 指路动作 cond：案结后不再触发（flag 不再变化即算过） ---------- */
console.log('\n⑥ 收尾断言');
p.room = 'gusu_yanzi';
const before = p.hasFlag('meimi_poison_known');
e.exec('问诊');
ok('案结后指路动作无副作用', p.hasFlag('meimi_poison_known') === before);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
