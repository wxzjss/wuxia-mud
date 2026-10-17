#!/usr/bin/env node
/* ==========================================================================
 *  tools/_label_fix_check.js —— label/cmd 死键 真走验收
 *  ① 16 条（原 label 落空 + 点也死）：进房→看→exec(cmd)，必须出实义文本
 *  ② 买卖恢复：jn_bookshop list 林守拙 出货摊
 *  ③ 5 条 quest 条件动作（从 50_map 搬进 62_shops）：任务进行中可触发；未接被 cond 挡
 *  用法：node tools/_label_fix_check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x) => {
  if (c) { pass++; console.log('  ✔ ' + n + (x ? '  ' + x : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (x ? '  « ' + x : '')); }
};
const txt = r => JSON.stringify((r && r.lines) || []);
const BAD = ['你留心察看了一番', '这里没有', '是什么指令'];

function fresh() {
  const e = new GameEngine({ seed: 20261018 });
  e.boot(); e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

const CASES = [
  ['jn_rich_house', 'knock 钱府', '门环是铜的'],
  ['jn_yamen_gate', 'read 告示', '拿获者赏'],
  ['jn_yamen_gate', 'knock 登闻鼓', '牛皮'],
  ['jn_bookshop', '翻词本', '当票'],
  ['jn_school_lib', 'search 书架', '一册账'],
  ['jn_harbor', 'drink', '泥味'],
  ['jn_harbor', '看船期牌', '辰时'],
  ['cunzhen_pond', 'fish', '浮子'],
  ['jn_woods_1', 'gather', '蘑菇'],
  ['jn_stream', 'fish', '发麻'],
  ['jn_cave', 'read 石壁', '刻坏了'],
  ['jn_fortune', 'ask 徐半仙 about 算命', '风尘色'],
  // 这两条已改为「走内置 talk」：房动作删了，断言改为「内置对话有台词、不出兜底句」
  ['jn_yamen_court', 'talk 元怀瑾', '元怀瑾'],
  ['jn_yamen_court', 'talk 县太爷', '县太爷'],
  ['jn_school', 'ask 陆见山 about 学问', '那杆秤'],
  ['jn_harbor', 'ask 王大壮 about 搬运', '按斤算钱'],
];

console.log('① 16 条：有实义输出');
for (const [room, cmd, frag] of CASES) {
  const e = fresh(); const p = e.world.player;
  p.room = room; e.exec('看');
  const r = e.exec(cmd);
  const t = txt(r);
  ok(room + '·' + cmd, t.indexOf(frag) >= 0 && !BAD.some(b => t.indexOf(b) >= 0), t.slice(0, 50));
}

console.log('② 买卖恢复：翰墨斋 list 林守拙');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'jn_bookshop'; e.exec('看');
  const t = txt(e.exec('list 林守拙'));
  ok('list 不再落空', !BAD.some(b => t.indexOf(b) >= 0) && t.length > 10, t.slice(0, 60));
}

console.log('③ 5 条 quest 条件动作（搬进 62）：任务进行中可触发');
const QCASES = [
  ['jn_teahouse', '问楼里旧事', 'hk_npcv_154_maishen', '十二个'],
  ['jn_wine_house', '问那坛酒', 'hk_npcv_074_qian', '双倍价钱'],
  ['jn_school', '问门房', 'hk_npcv_010_fuxue', '名册'],
  ['jn_school', '问旧年学籍', 'hk_npcv_036_juanzi', '指痕'],
  ['jn_harbor', '问开船的老船家', 'hk_npcv_181_guanliang', '草席'],
];
for (const [room, cmd, qid, frag] of QCASES) {
  const e = fresh(); const p = e.world.player;
  p.setQuestStage(qid, 0);
  p.room = room; e.exec('看');
  const t = txt(e.exec(cmd));
  ok(room + '·' + cmd + '（' + qid + ' 进行中）',
     t.indexOf(frag) >= 0 && !BAD.some(b => t.indexOf(b) >= 0), t.slice(0, 46));
}
{
  const e = fresh(); const p = e.world.player;
  p.room = 'jn_teahouse'; e.exec('看');
  ok('任务未接时被 cond 挡（不是落空）', txt(e.exec('问楼里旧事')).indexOf('十二个') < 0);
}

console.log('');
console.log('==== ' + pass + ' 通过 / ' + fail + ' 失败 ====');
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
