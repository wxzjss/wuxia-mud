#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act1_polish_check.js —— 卷一第一分钟 + 卷间指路 真走验收
 *  A1 八个锚物「看得到」；A2 接信进包；A3 面板两步；A4 两门指路可读；
 *  B5/B6 卷间指路尾文；C7 门派主线只留冲虚发。
 *  用法：node tools/_act1_polish_check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}
const txt = r => JSON.stringify((r && r.lines) || []);
function boot() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot(); e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

const ANCHORS = [
  ['端详茶摊', '竹竿'],
  ['端详芦席', '席子'],
  ['端详老槐树', '树身'],
  ['端详黄泥灶', '炭'],
  ['端详水缸', '半缸水'],
  ['端详缸', '浅槽'],
  ['端详案', '木楔子'],
  ['端详壶', '缺嘴'],
];

console.log('\n① A1 八个锚物：看得到且各说各的');
{
  const e = boot(); const p = e.world.player;
  p.room = 'road_jiangnan_1';
  const seen = new Set();
  for (const [cmd, frag] of ANCHORS) {
    const r = e.exec(cmd);
    const t = txt(r);
    ok(`${cmd} 有产出`, t.indexOf(frag) >= 0 && t.indexOf('这里没有') < 0, t.slice(0, 44));
    seen.add(t);
  }
  ok('八条描写互不相同', seen.size === ANCHORS.length, 'unique=' + seen.size);
  // 口语写法也要能看
  const r2 = e.exec('看 茶摊');
  ok('「看 茶摊」（带空格）同样有产出', txt(r2).indexOf('竹竿') >= 0);
}

console.log('\n② A2 接信进包');
{
  const e = boot(); const p = e.world.player;
  p.room = 'road_jiangnan_1';
  p.setFlag('act1_letter_known', true);
  const r = e.exec('接信');
  ok('接信后包里有引荐信', p.countItem('letter_intro') >= 1, 'count=' + p.countItem('letter_intro'));
  ok('接信有收进怀里的叙述', txt(r).indexOf('收进怀里') >= 0);
  const before = p.countItem('letter_intro');
  const r2 = e.exec('接信');
  ok('接第二次被挡（不再给信、不出收信叙述）',
     p.countItem('letter_intro') === before && txt(r2).indexOf('收进怀里') < 0,
     txt(r2).slice(0, 40));
}

console.log('\n③ A3/A4 面板两步 + 两门指路');
{
  const e = boot(); const p = e.world.player;
  const q = e.world.data.quests.q_main_jianghu;
  ok('stage0 文案含「青溪村」与「拜入门派」',
     /青溪村/.test(q.stages[0].desc) && /拜入一个门派/.test(q.stages[0].desc), q.stages[0].desc.slice(0, 30));
  p.room = 'road_jiangnan_1';
  const rn = e.exec('走北');
  const rs = e.exec('走南');
  ok('北门被挡时提到青溪村', txt(rn).indexOf('青溪村') >= 0);
  ok('南岔被挡时提到青溪村', txt(rs).indexOf('青溪村') >= 0);
}

console.log('\n④ B5/B6 卷间指路');
{
  const D = boot().world.data;
  const b5 = JSON.stringify(D.quests.q_main_jianghu.rewards);
  const b6 = JSON.stringify(D.quests.q_main_moye.rewards);
  ok('卷一收尾指向华山道·山脚夜宿', b5.indexOf('华山道') >= 0 && b5.indexOf('宿一晚') >= 0);
  ok('卷四收尾指向桃花岛清音洞', b6.indexOf('桃花岛') >= 0 && b6.indexOf('三句话') >= 0);
  ok('卷四收尾说明了为何是黄药师', b6.indexOf('不肯上岸') >= 0);
}

console.log('\n⑤ C7 门派主线只留冲虚发');
{
  const D = boot().world.data;
  const fz = D.npcs.shaolin_fangzheng || {};
  ok('方证的 quests 不再含 q_main_sect', !(fz.quests || []).includes('q_main_sect'), JSON.stringify(fz.quests));
  ok('q_main_sect 的 giver 仍是冲虚', D.quests.q_main_sect.giver === 'wudang_chongxu', D.quests.q_main_sect.giver);
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
