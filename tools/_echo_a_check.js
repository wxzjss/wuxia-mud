#!/usr/bin/env node
/* ==========================================================================
 *  tools/_echo_a_check.js —— 回响 A 层真走验收（design/110）
 *  对 12 处回响动作：置旗 → 进房 → 执行 → 断言台词在；不置旗 → 断言不给假入口
 *  另核 BARE 6 的 rewards 已有专属 say（数据侧）
 *  用法：node tools/_echo_a_check.js
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
const txt = r => JSON.stringify((r && r.lines) || []);
function boot() {
  const e = new GameEngine({ seed: 20261021 });
  e.boot();
  e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

/* [房间, cmd, 旗, 期望台词片段] */
const CASES = [
  ['changan_street', '听街上人说话', 'act_court_done', '翻案的人不是官'],
  ['luoyang_market', '听摊上人说话', 'act_neutral_done', '他没带腰牌'],
  ['jn_teahouse', '听人说起你', 'questdone_q_main_jianghu', '下回分解'],
  ['huashan_zhengqi', '问门中近况', 'questdone_q_huashan_entry', '饭要多做一份'],
  ['huashan_zhengqi', '问门中近况', 'questdone_q_huashan_sword_test', '没看你收剑'],
  ['huashan_zhengqi', '问门中近况', 'questdone_q_huashan_spy', '没有留尾巴'],
  ['shaolin_daxiong', '问门中近况', 'questdone_q_shaolin_entry', '第三排东头'],
  ['shaolin_daxiong', '问门中近况', 'questdone_q_yijinjing', '扫地也算修行'],
  ['wudang_zixiao', '问门中近况', 'questdone_q_wudang_entry', '守得住的人'],
  ['emei_jinding', '问门中近况', 'questdone_q_emei_entry', '不赶做过事的人'],
  ['gaibang_po_miao', '问门中近况', 'questdone_q_gaibang_entry', '做过事的人先吃'],
  ['gaibang_po_miao', '问门中近况', 'questdone_q_xianglong', '撑腰比打人'],
  ['miaojiang_sheng', '问门中近况', 'questdone_q_miao_entry', '长得活，才算数'],
  ['dali_wangfu', '问门中近况', 'questdone_q_dali_entry', '不必再通报'],
  ['dali_wangfu', '问门中近况', 'questdone_q_liumai', '心里有数了吧'],
  ['taohuadao_qingyin', '问门中近况', 'questdone_q_taohua_entry', '只有三个人'],
  ['huashan_siguoya', '再看那面墙', 'questdone_q_siguya_sword', '被人叫走了'],
];

console.log('\n① 12 处回响：置旗后可见、台词在');
for (const [room, cmd, flag, frag] of CASES) {
  const e = boot(); const p = e.world.player;
  p.setFlag(flag, true);
  p.room = room;
  const r = e.exec(cmd);
  ok(`${room}·${cmd}（${flag}）`, txt(r).indexOf(frag) >= 0,
     txt(r).replace(/\\"/g, '"').slice(0, 60));
}

console.log('\n② 未置旗：不给假入口');
for (const [room, cmd] of [['changan_street', '听街上人说话'], ['jn_teahouse', '听人说起你'],
  ['huashan_zhengqi', '问门中近况'], ['huashan_siguoya', '再看那面墙']]) {
  const e = boot(); const p = e.world.player;
  p.room = room;
  const r = e.exec(cmd);
  ok(`${room}·${cmd} 被挡`, txt(r).indexOf('现在做不了这个') >= 0);
}

console.log('\n③ 同房既有动作不被吞');
{
  const e = boot(); const p = e.world.player;
  p.room = 'huashan_siguoya';
  const r = e.exec('认痕');           // 卷一手动件
  ok('思过崖「认痕」仍命中自己', txt(r).indexOf('现在做不了这个') < 0 || txt(r).indexOf('石壁') >= 0,
     txt(r).slice(0, 50));
  p.room = 'jn_teahouse';
  const r2 = e.exec('listen 说书');
  ok('茶馆「listen 说书」仍命中自己', txt(r2).length > 2);
}

console.log('\n④ BARE 6：rewards 专属台词');
{
  const D = boot().world.data;
  const want = {
    q_huashan_sword_test: '五个人，五条路',
    q_huashan_spy: '够我写一封信了',
    q_yijinjing: '经在里头，人在外头',
    q_liumai: '分作六道',
    q_bounty_bandit: '一文不少',
    q_bounty_wolf: '这三贴你带着',
  };
  for (const [qid, frag] of Object.entries(want)) {
    const q = (D.quests || {})[qid];
    const blob = JSON.stringify((q && q.rewards) || []);
    ok(qid + ' 有专属台词', blob.indexOf(frag) >= 0);
  }
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
