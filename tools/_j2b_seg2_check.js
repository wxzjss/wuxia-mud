#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j2b_seg2_check.js —— 批4·卷二第二批 段2 六案真走通验收
 *  （杜听涛/柳三弦/和归鸿/鲁半夏/庞南枝/鲁拂衣）
 *  --------------------------------------------------------------------------
 *  · 散人全链：接案→目标房计数→giver 房交差→菜单真选→收束 flag
 *  · 说书案 giver 归位实测：柳三弦（jn_teahouse）接案动作真触发，
 *    熊时侧不再出现「听说书」
 *  · require 链实测：shuoshu 需要 baizi 完成；qian 需要 yajian 完成
 *  用法：node tools/_j2b_seg2_check.js
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

const e = new GameEngine({ seed: 20261017 });
e.boot();
e.newGame({ name: '验收侠2', gender: 'male' });
const p = e.world.player;
const W = e.world;
p.setFlag('jiuye_done', true);
p.money = 800;

function walk(qid, stages) {
  for (const [idx, st] of stages.entries()) {
    p.room = st.target;
    e.exec('看');
    ok(qid + ' s' + idx + ' 目标房计数（' + st.target + '）', p.getVar(st.tvar) === 1);
    p.room = st.giver;
    const rr = e.exec('交差');
    const stageNow = p.questStage(qid);
    if (st.expectStage !== undefined) ok(qid + ' s' + idx + ' 推进到 s' + st.expectStage, stageNow === st.expectStage, 'stage=' + stageNow);
    if (st.menuPick !== undefined) {
      const menu = pickMenu(rr);
      ok(qid + ' s' + idx + ' 菜单出现', !!(menu && menu.length === (st.menuLen || 2)), menu ? menu.map(o => o.label).join('/') : '(无)');
      if (menu && menu[st.menuPick]) e.menuPick({ effects: menu[st.menuPick].effects });
      if (st.flag) ok(qid + ' s' + idx + ' 分支 flag：' + st.flag, p.hasFlag(st.flag));
    }
  }
}

console.log('\n⑦ 杜听涛「元若那四十七两」');
p.quests['hk_npcv_065_siqiliang'] = 0;
walk('hk_npcv_065_siqiliang', [
  { target: 'jn_teahouse', tvar: 'hk_npcv_065_siqiliang_go0', giver: 'jn_teahouse', expectStage: 1, menuPick: 0, menuLen: 3, flag: 'hk_npcv_065_siqiliang_paid' },
  { target: 'jn_market_south', tvar: 'hk_npcv_065_siqiliang_go1', giver: 'jn_teahouse', expectStage: 2, menuPick: 0, flag: 'j2b_siqi_note' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_065_siqiliang_go2', giver: 'jn_teahouse', expectStage: 3, menuPick: 0, flag: 'j2b_siqi_guan' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_065_siqiliang_go3', giver: 'jn_teahouse', expectStage: 99, menuPick: 0, flag: 'j2b_siqi_done' },
]);

console.log('\n⑧ 柳三弦「说书人那张嘴」（giver 归位实测）');
/* require 链：baizi 先完 */
p.quests['hk_npcv_009_baizi'] = 99; p.setFlag('questdone_hk_npcv_009_baizi', true);
p.room = 'jn_teahouse';
let r8 = e.exec('问柳三弦');
ok('柳三弦「问柳三弦」动作真触发（接案）', p.questStage('hk_npcv_009_shuoshu') === 0, 'stage=' + p.questStage('hk_npcv_009_shuoshu'));
walk('hk_npcv_009_shuoshu', [
  { target: 'jn_teahouse', tvar: 'hk_npcv_009_shuoshu_go0', giver: 'jn_teahouse', expectStage: 1, menuPick: 0, flag: 'hk_npcv_009_shuoshu_buy' },
  { target: 'jiangnan_market', tvar: 'hk_npcv_009_shuoshu_go1', giver: 'jn_teahouse', expectStage: 2, menuPick: 0, flag: 'j2b_shuoshu_name' },
  { target: 'jn_bookshop', tvar: 'hk_npcv_009_shuoshu_go2', giver: 'jn_teahouse', expectStage: 3, menuPick: 0, flag: 'j2b_shuoshu_book' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_009_shuoshu_go3', giver: 'jn_teahouse', expectStage: 99, menuPick: 0, flag: 'j2b_shuoshu_done' },
]);
/* 熊时侧不再挂接案动作 */
p.room = 'jiangnan_market';
const r9b = e.exec('听说书'); // 撞房动作 listen 说书，不触发新案
ok('熊时侧「听说书」已撤（动作不可再触发新案）', p.questStage('hk_npcv_009_shuoshu') === 99);

console.log('\n⑨ 和归鸿「偷换的那坛酒」（require：yajian 先完）');
p.quests['hk_npcv_074_yajian'] = 99; p.setFlag('questdone_hk_npcv_074_yajian', true);
p.quests['hk_npcv_074_qian'] = 0;
walk('hk_npcv_074_qian', [
  { target: 'jn_teahouse', tvar: 'hk_npcv_074_qian_go0', giver: 'jn_teahouse', expectStage: 1, menuPick: 0, flag: 'hk_npcv_074_qian_clear' },
  { target: 'jn_market_main', tvar: 'hk_npcv_074_qian_go1', giver: 'jn_teahouse', expectStage: 2, menuPick: 0, flag: 'j2b_qian_zhang' },
  { target: 'jn_wine_house', tvar: 'hk_npcv_074_qian_go2', giver: 'jn_teahouse', expectStage: 3, menuPick: 0, flag: 'j2b_qian_jiu' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_074_qian_go3', giver: 'jn_teahouse', expectStage: 99, menuPick: 0, flag: 'j2b_qian_done' },
]);

console.log('\n⑩ 鲁半夏「雅间里那句醉话」');
p.quests['hk_npcv_186_zuihua'] = 0;
walk('hk_npcv_186_zuihua', [
  { target: 'jn_brothel_hall', tvar: 'hk_npcv_186_zuihua_go0', giver: 'jn_brothel_hall', expectStage: 1, menuPick: 0, flag: 'hk_npcv_186_zuihua_hold' },
  { target: 'jn_yamen_wt', tvar: 'hk_npcv_186_zuihua_go1', giver: 'jn_brothel_hall', expectStage: 2, menuPick: 0, flag: 'j2b_zuihua_tie' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_186_zuihua_go2', giver: 'jn_brothel_hall', expectStage: 3, menuPick: 1, flag: 'j2b_zuihua_er' },
  { target: 'jn_brothel_hall', tvar: 'hk_npcv_186_zuihua_go3', giver: 'jn_brothel_hall', expectStage: 99, menuPick: 0, flag: 'j2b_zuihua_done' },
]);

console.log('\n⑪ 庞南枝「半张契」');
p.quests['hk_npcv_095_qi'] = 0;
walk('hk_npcv_095_qi', [
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_095_qi_go0', giver: 'jiangnan_temple', expectStage: 1, menuPick: 0, flag: 'hk_npcv_095_qi_hide' },
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_095_qi_go1', giver: 'jiangnan_temple', expectStage: 2, menuPick: 0, flag: 'j2b_qi_ken' },
  { target: 'jn_study_1', tvar: 'hk_npcv_095_qi_go2', giver: 'jiangnan_temple', expectStage: 3, menuPick: 0, flag: 'j2b_qi_mo' },
  { target: 'jiangnan_temple', tvar: 'hk_npcv_095_qi_go3', giver: 'jiangnan_temple', expectStage: 99, menuPick: 0, flag: 'j2b_qi_done' },
]);

console.log('\n⑫ 鲁拂衣「樊湘那一页」');
p.quests['hk_npcv_036_juanzi'] = 0;
walk('hk_npcv_036_juanzi', [
  { target: 'jn_study_1', tvar: 'hk_npcv_036_juanzi_go0', giver: 'jn_study_1', expectStage: 1, menuPick: 0, flag: 'hk_npcv_036_juanzi_back' },
  { target: 'jn_school', tvar: 'hk_npcv_036_juanzi_go1', giver: 'jn_study_1', expectStage: 2, menuPick: 0, flag: 'j2b_juanzi_xue' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_036_juanzi_go2', giver: 'jn_study_1', expectStage: 3, menuPick: 0, flag: 'j2b_juanzi_fu' },
  { target: 'jn_study_1', tvar: 'hk_npcv_036_juanzi_go3', giver: 'jn_study_1', expectStage: 99, menuPick: 0, flag: 'j2b_juanzi_done' },
]);

console.log('\n⑬ 指路 6 处可见性 + 散人自查');
for (const [rid, cmd] of [['jn_market_south', '问和放的借据'], ['jn_bookshop', '翻词本'], ['jn_wine_house', '问那坛酒'],
                          ['jn_yamen_wt', '翻夜里的帖子'], ['gaibang_po_miao', '看佛座底下'], ['jn_school', '问旧年学籍']]) {
  p.room = rid;
  const x = e.exec(cmd);
  ok('指路 ' + rid + '·' + cmd, !!(x && x.lines && x.lines.length));
}
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
