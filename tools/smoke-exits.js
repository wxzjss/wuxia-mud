/* 出口 ASCII 方位图 + 互动出口（爬山坡/跳崖）回归测试
   run: node tools/smoke-exits.js */
'use strict';
const fs = require('fs');
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};

console.log('① lookRoom 出口结构化（exitMap）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  const look = e.cmds.lookRoom({ player: p, world: w });
  const exitLine = (look.lines || []).find(l => l.kind === 'exits');
  ok('出口行带 exitMap', !!(exitLine && exitLine.exitMap && Object.keys(exitLine.exitMap).length));
  ok('exitMap 每个方向有 name', exitLine && Object.values(exitLine.exitMap).every(m => m.name && m.dir));
  ok('出口行带 roomName（当前房间）', !!(exitLine && exitLine.roomName));
}

console.log('② 互动出口（跳崖 / 爬上去）');
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const w = e.world, p = w.player;

  p.room = 'emei_she_ru';
  let look = e.cmds.lookRoom({ player: p, world: w });
  const via = (look.lines || []).find(l => l.kind === 'via-exit');
  ok('舍身崖显示互动出口', !!via, via && via.text);
  ok('互动词可点击（hl 带 actions）', via && via.hl && via.hl[0] && via.hl[0].actions && via.hl[0].actions.length);

  // 输入 hint 触发移动
  e.exec('跳崖');
  ok('「跳崖」下到崖底', p.room === 'emei_ya_di', (w.getRoom(p.room) || {}).name);

  look = e.cmds.lookRoom({ player: p, world: w });
  const via2 = (look.lines || []).find(l => l.kind === 'via-exit');
  ok('崖底显示互动出口', !!via2, via2 && via2.text);

  e.exec('爬上去');
  ok('「爬上去」回到舍身崖', p.room === 'emei_she_ru', (w.getRoom(p.room) || {}).name);
}

console.log('③ 前端 ASCII 方位图渲染');
{
  const UI = fs.readFileSync('game/src/renderer/js/ui.js', 'utf8');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const m = UI.match(/function exitMapHtml[\s\S]*?\n  \}/);
  const fn = new Function('esc', m[0] + '\nreturn exitMapHtml;')(esc);
  const html = fn({
    n: { dir: 'n', name: '山谷北坡' }, s: { dir: 's', name: '青石桥' },
    e: { dir: 'e', name: '乱石阵' }, w: { dir: 'w', name: '树林' },
  }, '未明谷');
  ok('ASCII 图含可点击房间名', /exit-inline/.test(html));
  ok('ASCII 图含当前房间高亮', /class="cur"/.test(html));
  ok('ASCII 图含四方方向', ['n', 's', 'e', 'w'].every(d => html.includes('data-dir="' + d + '"')));
  ok('ASCII 图含横向连线', /──/.test(html));
  ok('ASCII 图含纵向箭头', /↑/.test(html) && /↓/.test(html));
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
