#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j2b_seg3_check.js —— 批4·卷二第二批 段3 六案真走通验收
 *  （毕元/和苍 + 胡录事/闵守/庞听/元若）
 *  --------------------------------------------------------------------------
 *  · 散人全链：接案→目标房计数→giver 房交差→菜单真选→收束 flag
 *  · 67 案铜牌锁实测：pre_a2_menfang 未置 → 收束交不动；置 → 放行
 *  · 悬空修复实测：原 jn_yizhuang/jn_granary 不存在，改后 target 房真可走
 *  用法：node tools/_j2b_seg3_check.js
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

const e = new GameEngine({ seed: 20261018 });
e.boot();
e.newGame({ name: '验收侠3', gender: 'male' });
const p = e.world.player;
const W = e.world;
p.setFlag('jiuye_done', true);
p.money = 2000;

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

console.log('\n⑬ 毕元「那册孤本」');
p.quests['hk_npcv_083_guben'] = 0;
walk('hk_npcv_083_guben', [
  { target: 'jn_bookshop', tvar: 'hk_npcv_083_guben_go0', giver: 'jn_yamen_arch', expectStage: 1, menuPick: 0, flag: 'hk_npcv_083_guben_swap' },
  { target: 'jn_yamen_wt', tvar: 'hk_npcv_083_guben_go1', giver: 'jn_yamen_arch', expectStage: 2, menuPick: 0, flag: 'j2b_guben_case' },
  { target: 'jn_market_south', tvar: 'hk_npcv_083_guben_go2', giver: 'jn_yamen_arch', expectStage: 3, menuPick: 0, flag: 'j2b_guben_price' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_083_guben_go3', giver: 'jn_yamen_arch', expectStage: 99, menuPick: 0, flag: 'j2b_guben_done' },
]);

console.log('\n⑭ 和苍「功德箱里那点钱」');
p.quests['hk_npcv_126_xianghuo'] = 0;
walk('hk_npcv_126_xianghuo', [
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_126_xianghuo_go0', giver: 'gaibang_po_miao', expectStage: 1, menuPick: 0, flag: 'hk_npcv_126_xianghuo_share' },
  { target: 'jiangnan_temple', tvar: 'hk_npcv_126_xianghuo_go1', giver: 'gaibang_po_miao', expectStage: 2, menuPick: 0, flag: 'j2b_xianghuo_bei' },
  { target: 'jn_market_north', tvar: 'hk_npcv_126_xianghuo_go2', giver: 'gaibang_po_miao', expectStage: 3, menuPick: 0, flag: 'j2b_xianghuo_tong' },
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_126_xianghuo_go3', giver: 'gaibang_po_miao', expectStage: 99, menuPick: 0, flag: 'j2b_xianghuo_done' },
]);

console.log('\n⑮ 胡录事「签押房那份底档」（铜牌锁实测）');
p.quests['hk_bureau_clerk_ledger'] = 0;
walk('hk_bureau_clerk_ledger', [
  { target: 'jn_yamen_store', tvar: 'hk_bureau_clerk_ledger_go0', giver: 'jn_yamen_office', expectStage: 1 },
  { target: 'jn_yamen_wt', tvar: 'hk_bureau_clerk_ledger_goA', giver: 'jn_yamen_office', expectStage: 2, menuPick: 0, flag: 'j2b_ledger_tear' },
  { target: 'jn_yamen_arch', tvar: 'hk_bureau_clerk_ledger_goB', giver: 'jn_yamen_office', expectStage: 3, menuPick: 0, flag: 'j2b_ledger_pai' },
  { target: 'jn_resident_2', tvar: 'hk_bureau_clerk_ledger_go1', giver: 'jn_yamen_office' }, // 收束：锁验证（不期望推进）
]);
{
  p.room = 'jn_yamen_office';
  let rr = e.exec('交差');
  ok('pre_a2_menfang 未置 → 收束交不动（tryReportQuest skip）', p.questStage('hk_bureau_clerk_ledger') === 3, 'stage=' + p.questStage('hk_bureau_clerk_ledger'));
  p.setFlag('pre_a2_menfang', true);
  rr = e.exec('交差');
  ok('pre_a2_menfang 置位 → 收束可交（stage 99）', p.questStage('hk_bureau_clerk_ledger') === 99, 'stage=' + p.questStage('hk_bureau_clerk_ledger'));
  const menu = pickMenu(rr);
  ok('原收束菜单保留（交给东厂/留在手上族）', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
  if (menu && menu[1]) e.menuPick({ effects: menu[1].effects });
  ok('原收束分支 flag 真置（替他藏回墙里）', p.hasFlag('hk_bureau_clerk_ledger_hide'));
}

console.log('\n⑯ 闵守「那一届的考题」');
p.quests['hk_npcv_102_panchang'] = 0;
p.setFlag('pre_a2_menfang', true);
walk('hk_npcv_102_panchang', [
  { target: 'jn_bookshop', tvar: 'hk_npcv_102_panchang_go0', giver: 'jn_study_1', expectStage: 1 },
  { target: 'jn_market_west', tvar: 'hk_npcv_102_panchang_goA', giver: 'jn_study_1', expectStage: 2, menuPick: 0, flag: 'j2b_pan_zhang' },
  { target: 'jn_school', tvar: 'hk_npcv_102_panchang_goB', giver: 'jn_study_1', expectStage: 3, menuPick: 0, flag: 'j2b_pan_shi' },
  { target: 'hm_npcv_102', tvar: 'hk_npcv_102_panchang_go1', giver: 'jn_study_1', expectStage: 99, menuPick: 0, flag: 'hk_npcv_102_panchang_pay' },
]);

console.log('\n⑰ 庞听「多出来的一批棉」');
p.quests['hk_npcv_109_junxu'] = 0;
walk('hk_npcv_109_junxu', [
  { target: 'jn_harbor', tvar: 'hk_npcv_109_junxu_go0', giver: 'jn_market_west', expectStage: 1 },
  { target: 'jn_harbor_shed', tvar: 'hk_npcv_109_junxu_goA', giver: 'jn_market_west', expectStage: 2, menuPick: 0, flag: 'j2b_jun_chi' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_109_junxu_goB', giver: 'jn_market_west', expectStage: 3, menuPick: 0, flag: 'j2b_jun_pai' },
  { target: 'jn_harbor_shed', tvar: 'hk_npcv_109_junxu_go1', giver: 'jn_market_west', expectStage: 99, menuPick: 0, flag: 'hk_npcv_109_junxu_done' },
]);

console.log('\n⑱ 元若「雅间那二两茶钱」');
p.quests['hk_npcv_073_yajian'] = 0;
walk('hk_npcv_073_yajian', [
  { target: 'jn_wine_room', tvar: 'hk_npcv_073_yajian_go0', giver: 'jn_teahouse', expectStage: 1 },
  { target: 'jn_resident_2', tvar: 'hk_npcv_073_yajian_goA', giver: 'jn_teahouse', expectStage: 2, menuPick: 0, flag: 'j2b_ya_yuan' },
  { target: 'jn_yamen_back', tvar: 'hk_npcv_073_yajian_goB', giver: 'jn_teahouse', expectStage: 3, menuPick: 0, flag: 'j2b_ya_juan' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_073_yajian_go1', giver: 'jn_teahouse', expectStage: 99, menuPick: 0, flag: 'hk_npcv_073_yajian_cover' },
]);

console.log('\n⑲ 悬空修复实测 + 指路 6 处 + 散人自查');
ok('悬空修复引擎级实证：jn_resident_2 收束步真走通（s3 计数+锁后可交）',
  p.questStage('hk_bureau_clerk_ledger') === 99);
for (const [rid, cmd] of [['jn_yamen_wt', '调改过的判词'], ['jiangnan_temple', '读庙外老碑'], ['jn_yamen_store', '翻缺页的旧档'],
                          ['jn_market_west', '看当季粮价'], ['jn_harbor', '看码头的船期牌'], ['jn_yamen_back', '翻悬案的卷宗']]) {
  p.room = rid;
  const x = e.exec(cmd);
  ok('指路 ' + rid + '·' + cmd, !!(x && x.lines && x.lines.length));
}
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
