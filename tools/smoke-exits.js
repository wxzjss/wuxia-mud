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

console.log('③ 前端方位图渲染（3×3 Grid，非 ASCII 画）');
{
  const UI = fs.readFileSync('game/src/renderer/js/ui.js', 'utf8');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const m = UI.match(/function exitMapHtml[\s\S]*?\n  \}/);
  const fn = new Function('esc', m[0] + '\nreturn exitMapHtml;')(esc);
  const full = fn({
    n: { dir: 'n', name: '山谷北坡' }, s: { dir: 's', name: '青石桥' },
    e: { dir: 'e', name: '乱石阵' }, w: { dir: 'w', name: '树林' },
    ne: { dir: 'ne', name: '青云巷' }, nw: { dir: 'nw', name: '乱葬岗' },
    se: { dir: 'se', name: '河埠头' }, sw: { dir: 'sw', name: '西市' },
  }, '未明谷');
  ok('方位图含可点击房间名', /exit-inline/.test(full));
  ok('方位图含当前房间高亮', /class="cur"/.test(full));
  ok('方位图含四方方向', ['n', 's', 'e', 'w'].every(d => full.includes('data-dir="' + d + '"')));
  ok('方位图含四角斜向', ['ne', 'nw', 'se', 'sw'].every(d => full.includes('data-dir="' + d + '"')));
  ok('用的是 3×3 grid 容器（不是 ASCII 画）', /class="em-grid"/.test(full));
  ok('九宫格正好 9 个格子', (full.match(/class="ec[ "]/g) || []).length === 9,
    'n=' + (full.match(/class="ec[ "]/g) || []).length);
  ok('中心格只有 1 个且是当前房间',
    (full.match(/em-core/g) || []).length === 1 && /em-core[^>]*><b class="cur">/.test(full));
  ok('中心格在正中间（第 5 格）',
    (full.match(/class="ec[^"]*"/g) || []).indexOf('class="ec em-core"') === 4,
    'idx=' + (full.match(/class="ec[^"]*"/g) || []).indexOf('class="ec em-core"'));

  /* 🩸 顺序守卫：网格的物理位置必须跟方向对应。
     顺序错位是最容易犯的错（写 HTML 时看串行），所以按 DOM 顺序断言。 */
  const order = (full.match(/data-dir="([a-z]+)"/g) || [])
    .map(s => s.slice(10, -1));
  ok('DOM 顺序 = 西北·北·东北 · 西·中心·东 · 西南·南·东南',
    order.join(',') === 'nw,n,ne,w,e,sw,s,se', order.join(','));

  /* 缺方向时也必须占位，不能塌掉位置 */
  const onlyNS = fn({ n: { dir: 'n', name: '甲' }, s: { dir: 's', name: '乙' } }, '某处');
  ok('缺方向时仍占满 9 格（位置不塌）',
    (onlyNS.match(/class="ec[ "]/g) || []).length === 9,
    'n=' + (onlyNS.match(/class="ec[ "]/g) || []).length);
  ok('中心格不受房间名长度影响（仍在第 5 格）',
    (() => {
      const h = fn({ n: { dir: 'n', name: '甲' } }, '很长很长很长很长很长很长的房间名字');
      const list = h.match(/class="ec[^"]*"/g) || [];
      return list.indexOf('class="ec em-core"') === 4;
    })());

  /* 上下 / 内外 不占九宫格，另起一行 */
  const vert = fn({ u: { dir: 'u', name: '二楼' }, d: { dir: 'd', name: '地窖' },
    in: { dir: 'in', name: '内室' }, out: { dir: 'out', name: '后院' }, n: { dir: 'n', name: '甲' } }, '某处');
  ok('上/下/内/外 走单独一行（不进九宫格）', /class="em-vert"/.test(vert));
  ok('上/下/内/外 都渲染出来',
    ['u', 'd', 'in', 'out'].every(d => vert.includes('data-dir="' + d + '"')));

  /* 一个出口都没有也不该崩，且仍显示中心名 */
  const none = fn({}, ' nowhere ');
  ok('无出口时不崩且仍显示中心名', /em-core/.test(none) && /nowhere/.test(none));

  /* 🩸 静态守卫：别把 ASCII 对齐画回来（全角空格 + ↑↓ + ──） */
  const body = m[0];
  ok('已不用全角空格手写对齐（没有连续的全角空格缩进）',
    !/　{2,}/.test(body), (body.match(/　{2,}/g) || [])[0] || '');
  ok('已不用 ↑↓ 箭头对齐', !/[↑↓]/.test(body));
  ok('已不用 ── 连线', !/──/.test(body));
  /* 🩸 前缀守卫：按钮上**不许**再出现「东·」「西北·」这类方向前缀，只留地名。
     方向信息仍在 title 与 data-dir 里，所以不会丢。 */
  const labels = (full.match(/<button[^>]*>([^<]*)<\/button>/g) || [])
    .map(s => s.replace(/<button[^>]*>/, '').replace(/<\/button>/, '').trim());
  ok('方位图按钮只剩地名（无「北·」「西北·」前缀）',
    labels.length > 0 && labels.every(t => !/^[东南西北上下内外]{1,2}[·・]/ .test(t)),
    labels.join(' | '));
  ok('方位图按钮地名都还在',
    ['山谷北坡', '青云巷', '乱葬岗'].every(n => labels.includes(n)), labels.join(' | '));
  ok('方向信息仍在 title 里',
    /title="向北走，前往「山谷北坡」"/.test(full)
    && /title="向西北走，前往「乱葬岗」"/.test(full),
    (full.match(/title="[^"]*"/g) || []).join(' | '));
  ok('data-dir 未被误删',
    ['n', 'e', 'nw'].every(d => full.includes('data-dir="' + d + '"')));

  /* 方向按钮排同样只显示地名 */
  const rowM = UI.match(/function exitBtnRowHtml[\s\S]*?\n  \}/);
  ok('方向按钮排源码存在', !!rowM);
  if (rowM) {
    ok('方向按钮排不再把方向名拼进可见文本（只剩 title 里用 b.name）',
      !/esc\(b\.name\)\s*('|<)/.test(rowM[0]) && !/<i>/.test(rowM[0]),
      (rowM[0].match(/esc\(b\.name\)[\s\S]{0,40}/) || [])[0] || '');
    ok('方向按钮排只渲染 toName', /esc\(b\.toName\)\s*\+\s*'<\/button>'/.test(rowM[0]));
  }

  /* CSS 侧也要真的声明了九宫格 */
  const CSS = fs.readFileSync('game/src/renderer/css/main.css', 'utf8');
  ok('CSS 声明了 3 列 grid', /\.em-grid[\s\S]{0,200}grid-template-columns/.test(CSS));
  ok('CSS 给八个方向各写了 grid-area', ['em-nw', 'em-n', 'em-ne', 'em-w', 'em-e', 'em-sw', 'em-s', 'em-se']
    .every(d => new RegExp('\\.' + d + '\\s*\\{[^}]*grid-area').test(CSS)));
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
