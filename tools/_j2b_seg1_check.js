#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j2b_seg1_check.js —— 批4·卷二第二批 段1 六案真走通验收
 *  （和放/穆逢/屈疏/邬修远/乐知/熊时，design/97 §九.4 #4）
 *  --------------------------------------------------------------------------
 *  · 散人全程（不入门派）：接案→逐 stage 目标房计数→回 giver 房交差→菜单真选
 *  · require 卷界前置：未置 jiuye_done 时接案动作应被挡（引擎 require 实测）
 *  · 收束 stage.lock（jiuye_done）与收束菜单双选 flag 断言
 *  · 指路 room action 6 处可见性
 *  用法：node tools/_j2b_seg1_check.js
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

/* ---------- 前置世界：先不置 jiuye_done（验 require 阻断） ---------- */
const e = new GameEngine({ seed: 20261016 });
e.boot();
e.newGame({ name: '验收侠', gender: 'male' });
const p = e.world.player;
const W = e.world;
p.money = 800;

console.log('\n⓪ require 卷界前置（引擎实测：可接列表过滤，commands.js:4708 口径）');
p.room = 'jn_market_south';
let r = e.exec('看');
const seenBefore = JSON.stringify(r && r.lines || []).includes('绸缎庄的窟窿');
ok('未进卷二（jiuye_done 未置）→ 案不在可接列表', !seenBefore);

p.setFlag('jiuye_done', true);
p.money = 800;
r = e.exec('看');
const seenAfter = JSON.stringify(r && r.lines || []).includes('绸缎庄的窟窿');
ok('进卷二后 → 案进可接列表', seenAfter);

/* ---------- 走案通用器 ---------- */
function walk(qid, stages) {
  for (const [idx, st] of stages.entries()) {
    p.room = st.target;
    e.exec('看');
    ok(qid + ' s' + idx + ' 目标房计数（' + st.target + '）', p.getVar(st.tvar) === 1);
    p.room = st.giver;
    const rr = st.report ? e.exec(st.report) : e.exec('交差');
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

console.log('\n① 和放「绸缎庄的窟窿」');
p.quests['hk_npcv_241_yinzi'] = 0;
walk('hk_npcv_241_yinzi', [
  { target: 'jn_silk_shop', tvar: 'hk_npcv_241_yinzi_go0', giver: 'jn_market_south', expectStage: 1, menuPick: 0, flag: 'hk_npcv_241_yinzi_hide' },
  { target: 'jn_market_west', tvar: 'hk_npcv_241_yinzi_go1', giver: 'jn_market_south', expectStage: 2, menuPick: 0, flag: 'j2b_yinzi_ledger' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_241_yinzi_go2', giver: 'jn_market_south', expectStage: 3, menuPick: 0, flag: 'j2b_yinzi_page' },
  { target: 'jn_market_south', tvar: 'hk_npcv_241_yinzi_go3', giver: 'jn_market_south', expectStage: 99, menuPick: 1, flag: 'j2b_yinzi_done' },
]);
ok('和放案：指路动作（翻米行流水）真触发', (() => { p.room = 'jn_market_west'; const x = e.exec('翻米行流水'); return !!(x && x.lines && x.lines.length); })());

console.log('\n② 穆逢「妆匣最底下那张纸」');
p.quests['hk_npcv_154_maishen'] = 0;
walk('hk_npcv_154_maishen', [
  { target: 'jn_wine_house', tvar: 'hk_npcv_154_maishen_go0', giver: 'jn_wine_room', expectStage: 1, menuPick: 0, flag: 'hk_npcv_154_maishen_free' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_154_maishen_go1', giver: 'jn_wine_room', expectStage: 2, menuPick: 1, flag: 'j2b_maishen_boat' },
  { target: 'jn_yamen_wt', tvar: 'hk_npcv_154_maishen_go2', giver: 'jn_wine_room', expectStage: 3, menuPick: 0, flag: 'j2b_maishen_name' },
  { target: 'jn_wine_room', tvar: 'hk_npcv_154_maishen_go3', giver: 'jn_wine_room', expectStage: 99, menuPick: 0, flag: 'j2b_maishen_done' },
]);

console.log('\n③ 屈疏「府学门口那道门」（require 链：haosun 先完）');
p.quests['hk_npcv_010_haosun'] = 99; // 前置池壳案视为已完（require questDone）
p.quests['hk_npcv_010_fuxue'] = 0;
walk('hk_npcv_010_fuxue', [
  { target: 'jn_school', tvar: 'hk_npcv_010_fuxue_go0', giver: 'jn_market_west', expectStage: 1, menuPick: 1, menuLen: 3, flag: 'hk_npcv_010_fuxue_fame' },
  { target: 'jn_study_1', tvar: 'hk_npcv_010_fuxue_go1', giver: 'jn_market_west', expectStage: 2, menuPick: 0, flag: 'j2b_fuxue_list' },
  { target: 'jn_school', tvar: 'hk_npcv_010_fuxue_go2', giver: 'jn_market_west', expectStage: 3, menuPick: 1, flag: 'j2b_fuxue_gate' },
  { target: 'jn_market_west', tvar: 'hk_npcv_010_fuxue_go3', giver: 'jn_market_west', expectStage: 99, menuPick: 0, flag: 'j2b_fuxue_done' },
]);

console.log('\n④ 邬修远「三年攒的那匹绸」');
p.quests['hk_npcv_240_laocaifeng'] = 0;
walk('hk_npcv_240_laocaifeng', [
  { target: 'jn_silk_shop', tvar: 'hk_npcv_240_laocaifeng_go0', giver: 'jn_market_north', expectStage: 1, menuPick: 0, flag: 'hk_npcv_240_laocaifeng_honest' },
  { target: 'jn_market_north', tvar: 'hk_npcv_240_laocaifeng_go1', giver: 'jn_market_north', expectStage: 2, menuPick: 1, flag: 'j2b_silk_boat' },
  { target: 'jiangnan_market', tvar: 'hk_npcv_240_laocaifeng_go2', giver: 'jn_market_north', expectStage: 3, menuPick: 0, flag: 'j2b_silk_proof' },
  { target: 'jn_market_north', tvar: 'hk_npcv_240_laocaifeng_go3', giver: 'jn_market_north', expectStage: 99, menuPick: 0, flag: 'j2b_silk_done' },
]);

console.log('\n⑤ 乐知「北边那趟镖」');
p.quests['hk_npcv_180_beibian'] = 0;
walk('hk_npcv_180_beibian', [
  { target: 'jn_market_main', tvar: 'hk_npcv_180_beibian_go0', giver: 'jn_market_main', expectStage: 1, menuPick: 0, flag: 'hk_heibiao' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_180_beibian_go1', giver: 'jn_market_main', expectStage: 2, menuPick: 1, flag: 'j2b_biao_mark' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_180_beibian_go2', giver: 'jn_market_main', expectStage: 3, menuPick: 0, flag: 'j2b_biao_paper' },
  { target: 'jn_market_main', tvar: 'hk_npcv_180_beibian_go3', giver: 'jn_market_main', expectStage: 99, menuPick: 1, flag: 'j2b_biao_done' },
]);

console.log('\n⑥ 熊时「那幅百子图」');
p.quests['hk_npcv_009_baizi'] = 0;
walk('hk_npcv_009_baizi', [
  { target: 'jiangnan_market', tvar: 'hk_npcv_009_baizi_go0', giver: 'jiangnan_market', expectStage: 1, menuPick: 1, flag: 'hk_npcv_009_baizi_grey' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_009_baizi_go1', giver: 'jiangnan_market', expectStage: 2, menuPick: 1, flag: 'j2b_baizi_needle' },
  { target: 'jn_market_south', tvar: 'hk_npcv_009_baizi_go2', giver: 'jiangnan_market', expectStage: 3, menuPick: 1, flag: 'j2b_baizi_math' },
  { target: 'jiangnan_market', tvar: 'hk_npcv_009_baizi_go3', giver: 'jiangnan_market', expectStage: 99, menuPick: 0, flag: 'j2b_baizi_done' },
]);

console.log('\n⑦ 指路 6 处可见性');
const HINT_ROOMS = [['jn_market_west', '翻米行流水'], ['jn_teahouse', '问楼里旧事'], ['jn_school', '问门房'],
                    ['jiangnan_market', '看当铺告帖'], ['jn_yamen_arch', '翻过所底簿'], ['jn_market_south', '看行情帖']];
for (const [rid, cmd] of HINT_ROOMS) {
  p.room = rid;
  const x = e.exec(cmd);
  ok('指路 ' + rid + '·' + cmd, !!(x && x.lines && x.lines.length));
}
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
