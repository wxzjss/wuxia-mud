#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j2b_seg4_check.js —— 批4·卷二第二批 段4 六案真走通验收
 *  （任停/元怀瑾/强秋/黄清/药婆婆/梅拾）
 *  --------------------------------------------------------------------------
 *  · 散人全链：接案→目标房计数→giver 房交差→菜单真选→收束 flag
 *  · 铜牌锁（pre_a2_menfang）批量验证：每案收束前须置
 *  · 指路 6 处真触发 + 散人自查
 *  用法：node tools/_j2b_seg4_check.js
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

const e = new GameEngine({ seed: 20261019 });
e.boot();
e.newGame({ name: '验收侠4', gender: 'male' });
const p = e.world.player;
const W = e.world;
p.setFlag('jiuye_done', true);
p.setFlag('pre_a2_menfang', true);
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
      ok(qid + ' s' + idx + ' 菜单出现', !!(menu && menu.length === 2), menu ? menu.map(o => o.label).join('/') : '(无)');
      if (menu && menu[st.menuPick]) e.menuPick({ effects: menu[st.menuPick].effects });
      if (st.flag) ok(qid + ' s' + idx + ' 分支 flag：' + st.flag, p.hasFlag(st.flag));
    }
  }
}

console.log('\n⑲ 任停「破庙是谁的」');
p.quests['hk_npcv_027_miaozheng'] = 0;
walk('hk_npcv_027_miaozheng', [
  { target: 'jn_yamen_store', tvar: 'hk_npcv_027_miaozheng_go0', giver: 'jiangnan_temple', expectStage: 1 },
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_027_miaozheng_goA', giver: 'jiangnan_temple', expectStage: 2, menuPick: 0, flag: 'j2b_miao_xiang' },
  { target: 'jn_yamen_arch', tvar: 'hk_npcv_027_miaozheng_goB', giver: 'jiangnan_temple', expectStage: 3, menuPick: 0, flag: 'j2b_miao_pai' },
  { target: 'jiangnan_temple', tvar: 'hk_npcv_027_miaozheng_go1', giver: 'jiangnan_temple', expectStage: 99, menuPick: 0, flag: 'hk_npcv_027_ren' },
]);

console.log('\n⑳ 元怀瑾「库房多出的三千两」');
p.quests['hk_npcv_149_hegong'] = 0;
walk('hk_npcv_149_hegong', [
  { target: 'jn_yamen_store', tvar: 'hk_npcv_149_hegong_go0', giver: 'jn_yamen_court', expectStage: 1 },
  { target: 'jn_yamen_back', tvar: 'hk_npcv_149_hegong_goA', giver: 'jn_yamen_court', expectStage: 2, menuPick: 0, flag: 'j2b_he_pai' },
  { target: 'jn_yamen_store', tvar: 'hk_npcv_149_hegong_goB', giver: 'jn_yamen_court', expectStage: 3, menuPick: 0, flag: 'j2b_he_lu' },
  { target: 'luoyang_street', tvar: 'hk_npcv_149_hegong_go1', giver: 'jn_yamen_court', expectStage: 99, menuPick: 1, flag: 'hk_npcv_149_hegong_report' },
]);

console.log('\n㉑ 强秋「箱子里的货」');
p.quests['hk_npcv_081_xiangzi'] = 0;
walk('hk_npcv_081_xiangzi', [
  { target: 'jn_harbor_shed', tvar: 'hk_npcv_081_xiangzi_go0', giver: 'jn_teahouse', expectStage: 1 },
  { target: 'jn_harbor_wharf', tvar: 'hk_npcv_081_xiangzi_goA', giver: 'jn_teahouse', expectStage: 2, menuPick: 0, flag: 'j2b_xiao_diao' },
  { target: 'jn_market_east', tvar: 'hk_npcv_081_xiangzi_goB', giver: 'jn_teahouse', expectStage: 3, menuPick: 0, flag: 'j2b_xiao_yin' },
  { target: 'jn_teahouse', tvar: 'hk_npcv_081_xiangzi_go1', giver: 'jn_teahouse', expectStage: 99, menuPick: 0, flag: 'hk_npcv_081_xiangzi_kai' },
]);

console.log('\n㉒ 黄清「三年前那一船人」');
p.quests['hk_npcv_181_guanliang'] = 0;
walk('hk_npcv_181_guanliang', [
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_181_guanliang_go0', giver: 'jn_yamen_back', expectStage: 1 },
  { target: 'jn_harbor', tvar: 'hk_npcv_181_guanliang_goA', giver: 'jn_yamen_back', expectStage: 2, menuPick: 0, flag: 'j2b_chuan_lu' },
  { target: 'gaibang_po_miao', tvar: 'hk_npcv_181_guanliang_goB', giver: 'jn_yamen_back', expectStage: 3, menuPick: 0, flag: 'j2b_chuan_ce' },
  { target: 'jn_yamen_back', tvar: 'hk_npcv_181_guanliang_go1', giver: 'jn_yamen_back', expectStage: 99, menuPick: 0, flag: 'hk_npcv_181_guanliang_seal' },
]);

console.log('\n㉓ 药婆婆「山上的那个后生」');
p.quests['hk_yaopopo_shanzi'] = 0;
walk('hk_yaopopo_shanzi', [
  { target: 'huashan_houshan', tvar: 'hk_yaopopo_shanzi_go0', giver: 'huashan_shanxia', expectStage: 1 },
  { target: 'huashan_qingke', tvar: 'hk_yaopopo_shanzi_goA', giver: 'huashan_shanxia', expectStage: 2, menuPick: 0, flag: 'j2b_yao_ke' },
  { target: 'hm_wen_huashan_shop', tvar: 'hk_yaopopo_shanzi_goB', giver: 'huashan_shanxia', expectStage: 3, menuPick: 0, flag: 'j2b_yao_fang' },
  { target: 'huashan_shanxia', tvar: 'hk_yaopopo_shanzi_go1', giver: 'huashan_shanxia', expectStage: 99, menuPick: 0, flag: 'hk_yaopopo_shanzi_ming' },
]);

console.log('\n㉔ 梅拾「胭脂盒夹层里的账」');
p.quests['hk_npcv_219_zhangmu'] = 0;
walk('hk_npcv_219_zhangmu', [
  { target: 'jn_brothel_hall', tvar: 'hk_npcv_219_zhangmu_go0', giver: 'jn_brothel_hall', expectStage: 1 },
  { target: 'jn_study_1', tvar: 'hk_npcv_219_zhangmu_goA', giver: 'jn_brothel_hall', expectStage: 2, menuPick: 0, flag: 'j2b_zhang_bi' },
  { target: 'jn_yamen_wt', tvar: 'hk_npcv_219_zhangmu_goB', giver: 'jn_brothel_hall', expectStage: 3, menuPick: 0, flag: 'j2b_zhang_qian' },
  { target: 'jn_yamen_court', tvar: 'hk_npcv_219_zhangmu_go1', giver: 'jn_brothel_hall', expectStage: 99, menuPick: 0, flag: 'hk_npcv_219_zhangmu_send' },
]);

console.log('\n㉕ 指路 6 处 + 散人自查');
for (const [rid, cmd] of [['jn_yamen_store', '翻庙契的木箱'], ['jn_yamen_back', '对钦差出京的日子'], ['jn_harbor_wharf', '等刁立来要钱'],
                          ['jn_harbor', '问开船的老船家'], ['huashan_qingke', '问过路的客商'], ['jn_yamen_wt', '翻虫蛀的旧案']]) {
  p.room = rid;
  const x = e.exec(cmd);
  ok('指路 ' + rid + '·' + cmd, !!(x && x.lines && x.lines.length));
}
ok('散人双通道：全程无门派依赖（本跑即散人）', !p.sect);

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
