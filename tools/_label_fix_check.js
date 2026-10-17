#!/usr/bin/env node
/* ==========================================================================
 *  tools/_label_fix_check.js —— label/cmd 落空 16 条 真走验收
 *  每条：进房 → 看（触发懒生成）→ exec(cmd) → 断言有实义输出、不是 B6/「这里没有」
 *  另核：jn_bookshop「list 林守拙」空动作已删（买卖恢复）
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, x) => (c ? (pass++, console.log('  ✔ ' + n + (x ? '  ' + x : ''))) : (fail++, fails.push(n), console.log('  ✘ ' + n + (x ? '  « ' + x : ''))));
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
  ['jn_yamen_court', 'talk 元怀瑾', '本官事忙'],
  ['jn_yamen_court', 'talk 县太爷', '民状'],
  ['jn_school', 'ask 陆见山 about 学问', '那杆秤'],
  ['jn_harbor', 'ask 王大壮 about 搬运', '按斤算钱'],
];

console.log('\n① 16 条：有实义输出');
for (const [room, cmd, frag] of CASES) {
  const e = fresh(); const p = e.world.player;
  p.room = room;
  e.exec('看');
  const r = e.exec(cmd);
  const t = txt(r);
  ok(`${room}·${cmd}`, t.indexOf(frag) >= 0 && !BAD.some(b => t.indexOf(b) >= 0), t.slice(0, 50));
}

console.log('\n② 买卖恢复：翰墨斋 list 林守拙');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'jn_bookshop'; e.exec('看');
  const r = e.exec('list 林守拙');
  const t = txt(r);
  ok('list 不再落空', !BAD.some(b => t.indexOf(b) >= 0) && t.length > 10, t.slice(0, 60));
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
