#!/usr/bin/env node
/* ==========================================================================
 *  tools/ui-audit-check.js —— design/78《UI 视觉审计》整改验收（`78/T-V-*`）
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本：
 *    design/78 §7.10 列了 16 条**机械可判定**的断言，用来验收 §7 那批整改。
 *    它们原本只是文档里的一张表 —— 而一张表不会在有人改坏时报错。
 *    这个脚本把那张表变成 exit≠0 的硬规矩。
 *
 *  ⚠️ 引用时必须带文档号：`78/T-V-1`，不写裸 `T-V-1`（design/78 §7.10 原话）。
 *
 *  覆盖：
 *    T-V-1 / 2  墨阶等距（暗 / 亮）：相邻档 ΔL\* 落在区间内
 *    T-V-3      末档 --ink-4 对五种底 ≥ 4.5
 *    T-V-4      相邻档两色间对比 ∈ [1.15, 1.40]（<1.15 糊成一档）
 *    T-V-5      顶栏 --tb-* 九个全有定义，且 #topbar 的 background 含 var(--tb-bg-
 *    T-V-6      html.theme-light 块内 --tb-* 覆写数 === 0（顶栏不换肤）
 *    T-V-7      顶栏六成员对 #3a342c 各自达标
 *    T-V-8      血条槽计算值 === rgb(36,31,24)，且浅色块内无覆写
 *    T-V-9      血条数字对槽底 ≥ 4.5（目标 16.35）
 *    T-V-10  🔴 .tb-money / .tb-title 规则里不再出现 var(--gold)（顺序依赖）
 *    T-V-11     --map-here-name 在浅色地图底上 ≥ 3.0
 *    T-V-12     mp/exp/food/water 四条 fill 亮端白字 ≥ 4.5
 *    T-V-13     四个幽灵变量已在 :root 定义（或已去掉 var() 外壳）
 *    T-V-14     main.css 内 .tr- 选择器数量 === 0
 *    T-V-15     两份 main.css md5 相同
 *    T-V-16     mirror-check.js 的比对目录含 css
 *
 *  用法：node tools/ui-audit-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { contrast, luminance, labL } = require('./css-contrast.js');

const ROOT = path.join(__dirname, '..');
const CSS = path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css');
const CSS_MIRROR = path.join(ROOT, 'server', 'public', 'css', 'main.css');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

const css = fs.readFileSync(CSS, 'utf8');

/* 去掉注释再解析 —— 否则注释里写的旧值会被当成现役值（血泪教训，
   见 combat-round-check.js 的 stripComments 那条注释）。 */
const code = css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');

/** 抠一个块的变量表：从**块头那一行**起，配平花括号。
 *  ⚠️ 块头必须**整行锚定**：`html.theme-light` 前面还有一堆
 *    `html.theme-light #bg-art .mount, html.theme-light #stage-art .mount { … }`
 *    这样的行，用 `indexOf(sel) >= 0` 会先撞上它们，抠出来的是背景插画那一块，
 *    于是 `--ink` / `--gold` 全取不到 → 后面算出 NaN、或者静默回退到 :root 的暗色值
 *    （我就这么拿到过一个「浅色 --gold = #cfa64a」的假数）。 */
function varsInBlock(sel) {
  const lines = code.split('\n');
  const head = new RegExp('^\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (head.test(lines[i])) { start = i; break; }
  }
  if (start < 0) return {};
  const out = {};
  let depth = 0, opened = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') { depth--; }
    }
    const m = lines[i].match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g) || [];
    for (const d of m) {
      const mm = d.match(/(--[a-z0-9-]+)\s*:\s*([^;]+);/);
      if (mm) out[mm[1]] = mm[2].trim();
    }
    if (opened && depth <= 0) break;
  }
  return out;
}

/** 把 var(--x) 展开（只在本文件的作用域内解析） */
function resolve(v, vars) {
  let s = String(v), guard = 0;
  while (s.indexOf('var(') >= 0 && guard++ < 10) {
    s = s.replace(/var\((--[a-z0-9-]+)(?:\s*,\s*([^)]*))?\)/g, (all, n, fb) => {
      if (vars[n]) return vars[n];
      return fb || all;
    });
  }
  return s;
}

const root = varsInBlock(':root');
const light = varsInBlock('html.theme-light');

/* ================================================================
 * T-V-1 / 2 / 3 / 4 —— 墨阶
 * ================================================================ */
section('78/T-V-1…4 墨阶（design/78 §2.1-bis 变体甲）');

const INK_KEYS = ['--ink-1', '--ink', '--ink-2', '--ink-3', '--ink-4'];
const FIVE_BASES = {
  paper: dark('--paper'), 'paper-2': dark('--paper-2'), 'paper-3': dark('--paper-3'),
  card: dark('--card'), 'surface-2': dark('--surface-2'),
};
function dark(k) { return resolve(root[k], root); }

for (const [label, vars, lo, hi] of [['暗', root, 7.5, 9.5], ['亮', light, 6.5, 8.5]]) {
  const vals = INK_KEYS.map((k) => resolve(vars[k], vars));
  const bad = [];
  const ds = [];
  for (let i = 1; i < vals.length; i++) {
    const d = Math.abs(labL(vals[i]) - labL(vals[i - 1]));
    ds.push(d);
    if (!(d >= lo && d <= hi)) bad.push(INK_KEYS[i - 1] + '↔' + INK_KEYS[i] + ' ΔL*=' + d.toFixed(1));
  }
  ok('78/T-V-' + (label === '暗' ? 1 : 2) + ' 墨阶等距（' + label + '）相邻 ΔL\* ∈ [' + lo + ', ' + hi + ']',
    bad.length === 0, bad.length ? bad.join(' / ') : ds.map((d) => d.toFixed(1)).join(' / '));
}

{
  const i4 = resolve(root['--ink-4'], root);
  const bad = [];
  for (const [bn, bv] of Object.entries(FIVE_BASES)) {
    if (!/^#[0-9a-f]{6}$/i.test(bv)) continue;      /* 半透明底：跳过，算不了 */
    const c = contrast(i4, bv);
    if (c < 4.5) bad.push(bn + ' ' + c.toFixed(2));
  }
  ok('78/T-V-3 末档 --ink-4 对五种底均 ≥4.5', bad.length === 0,
    bad.length ? bad.join(' / ') : '五种底全过 · ' + i4);
}

{
  const bad = [];
  for (const vars of [root, light]) {
    const vals = INK_KEYS.map((k) => resolve(vars[k], vars));
    for (let i = 1; i < vals.length; i++) {
      const c = contrast(vals[i], vals[i - 1]);
      if (!(c >= 1.15 && c <= 1.40)) bad.push(INK_KEYS[i - 1] + '↔' + INK_KEYS[i] + ' ' + c.toFixed(3));
    }
  }
  ok('78/T-V-4 相邻档分得开（两色间对比 ∈ [1.15, 1.40]）', bad.length === 0,
    bad.length ? bad.join(' / ') : '两主题八段全在区间内');
}

/* ================================================================
 * T-V-5 / 6 / 7 / 10 —— 顶栏
 * ================================================================ */
section('78/T-V-5…7 / 10 顶栏（不换肤，且与 --gold 脱钩）');

const TB = ['--tb-bg-1', '--tb-bg-2', '--tb-ink', '--tb-name', '--tb-sect',
  '--tb-sold', '--tb-money', '--tb-title', '--tb-time'];

{
  const miss = TB.filter((k) => !root[k]);
  const top = (code.match(/#topbar\s*\{[^}]*\}/) || [''])[0];
  ok('78/T-V-5 顶栏 --tb-* 九个全有定义，且 #topbar 用了 var(--tb-bg-)',
    miss.length === 0 && /var\(--tb-bg-/.test(top),
    miss.length ? '缺 ' + miss.join(',') : '9 个 · ' + (top ? '#topbar 已接线' : '（没抠到 #topbar）'));
}

{
  const n = TB.filter((k) => light[k]).length;
  ok('78/T-V-6 顶栏不换肤（html.theme-light 块内 --tb-* 覆写 === 0）', n === 0, n + ' 处覆写');
}

{
  /* 阈值：.tb-name 是 18px/700 → 大字 3.0；其余 12–13px → 正文 4.5 */
  const MEMBERS = [
    ['--tb-name', 3.0], ['--tb-sect', 4.5], ['--tb-sold', 4.5],
    ['--tb-money', 4.5], ['--tb-title', 4.5], ['--tb-time', 4.5], ['--tb-ink', 4.5],
  ];
  const BG = '#3a342c';
  const bad = [];
  for (const [k, th] of MEMBERS) {
    const c = contrast(resolve(root[k], root), BG);
    if (c < th) bad.push(k + ' ' + c.toFixed(2) + '<' + th);
  }
  ok('78/T-V-7 顶栏簇对 #3a342c 各自达标（.tb-name 3.0 / 其余 4.5）', bad.length === 0,
    bad.length ? bad.join(' / ') : MEMBERS.map(([k]) => k.replace('--tb-', '') + ' ' + contrast(resolve(root[k], root), BG).toFixed(2)).join(' · '));
}

{
  /* 🔴 顺序依赖：先落 §7.2（顶栏摘出 --gold），再动亮色 --gold。
     反了的话浅色顶栏的银两与称号会掉到 2.04 —— 不报错，就是看不见。 */
  const money = (code.match(/\.tb-money\s*\{[^}]*\}/) || [''])[0];
  const title = (code.match(/\.tb-title\s*\{[^}]*\}/) || [''])[0];
  const hit = [];
  if (/var\(\s*--gold\s*\)/.test(money)) hit.push('.tb-money');
  if (/var\(\s*--gold\s*\)/.test(title)) hit.push('.tb-title');
  ok('78/T-V-10 🔴 .tb-money / .tb-title 不再出现 var(--gold)（顺序依赖）',
    hit.length === 0 && money && title,
    hit.length ? hit.join(' / ') + ' 仍在用 --gold' : '两条已摘出，顶栏与主题变量脱钩');
}

/* ================================================================
 * T-V-8 / 9 / 12 —— 血条
 * ================================================================ */
section('78/T-V-8 / 9 / 12 血条（design/78 §2.5）');

{
  /* §7.11：恒深槽不止一条 —— T-V-8 原来只盯 .tb-bar，
     .ce-hp（战斗面板血条）修完却没人盯，差点成为漏网第二处。
     ⇒ 两条槽一起查，判据同一条：计算值 === rgb(36,31,24) 且浅色块内无覆写。 */
  const lightBlock = (code.match(/html\.theme-light\s*\{[\s\S]*?\n\}/) || [''])[0];
  const checkSlot = (sel) => {
    const rule = (code.match(new RegExp(sel.replace(/\./g, '\\.') + '\\s*\\{[^}]*\\}')) || [''])[0];
    const bg = (rule.match(/background\s*:\s*([^;]+);/) || [, ''])[1].trim();
    const isDeep = /#241f18/i.test(bg) || /rgb\(\s*36\s*,\s*31\s*,\s*24\s*\)/.test(bg);
    const overridden = new RegExp(sel.replace(/\./g, '\\.') + '[^{]*\\{[^}]*background').test(lightBlock);
    return { bg, isDeep, overridden };
  };
  const tb = checkSlot('.tb-bar');
  const ce = checkSlot('.ce-hp');
  ok('78/T-V-8 恒深槽（.tb-bar + .ce-hp）计算值 #241f18，且浅色块内无覆写',
    tb.isDeep && ce.isDeep && !tb.overridden && !ce.overridden,
    '.tb-bar: ' + (tb.bg || '(没抠到)') + ' · .ce-hp: ' + (ce.bg || '(没抠到)')
      + ((tb.overridden || ce.overridden) ? ' · ⚠ 浅色块里有覆写' : ''));
}

{
  const c = contrast('#ffffff', '#241f18');
  ok('78/T-V-9 血条数字（#fff）对槽底 ≥4.5', c >= 4.5, c.toFixed(2) + '（目标 16.35）');
}

{
  /* 只对**较亮端**取样：白字压在渐变亮的一端，那是最差情况 */
  const FILLS = [
    ['.tb-bar.mp', '#2f6ba4'], ['.tb-bar.exp', '#7d7020'],
    ['.tb-bar.food', '#96701f'], ['.tb-bar.water', '#2f7b82'],
  ];
  const bad = [];
  for (const [sel, want] of FILLS) {
    const re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\.fill\\s*\\{[^}]*\\}');
    const rule = (code.match(re) || [''])[0];
    const grad = rule.match(/linear-gradient\([^)]*\)/g) || [];
    const hexes = (grad.join(' ').match(/#[0-9a-fA-F]{6}/g) || []);
    if (!hexes.length) { bad.push(sel + ' 没抠到渐变'); continue; }
    /* 亮端 = 相对亮度最大的那个 */
    const brightest = hexes.slice().sort((a, b) => luminance(b) - luminance(a))[0];
    if (brightest.toLowerCase() !== want.toLowerCase()) {
      bad.push(sel + ' 亮端是 ' + brightest + '，应为 ' + want);
      continue;
    }
    const c = contrast('#ffffff', brightest);
    if (c < 4.5) bad.push(sel + ' 亮端 ' + brightest + ' 白字 ' + c.toFixed(2));
  }
  ok('78/T-V-12 mp/exp/food/water 四条 fill 亮端白字 ≥4.5', bad.length === 0,
    bad.length ? bad.join(' / ') : '四条全过（5.59 / 4.99 / 4.53 / 4.91）');
}

/* ================================================================
 * T-V-11 —— --gold 的连带
 * ================================================================ */
section('78/T-V-11 --gold 连带复核（地图 L1 名字色）');

{
  /* --map-here-name 在 :root 里 = var(--gold)，浅色**故意不覆写**（design/73 定的） */
  const mn = resolve(root['--map-here-name'] || '', root);
  const goldLight = resolve(light['--gold'] || root['--gold'], light);
  const bg = resolve(light['--map-paper-lit'] || '#fffdf6', light);
  const c = contrast(goldLight, bg);
  ok('78/T-V-11 --map-here-name（= var(--gold)）在浅色地图底 ≥3.0',
    c >= 3.0, '浅色 --gold ' + goldLight + ' 对 ' + bg + ' = ' + c.toFixed(2));
}

/* ================================================================
 * T-V-13 / 14 —— 幽灵变量与死代码
 * ================================================================ */
section('78/T-V-13 / 14 幽灵变量与死代码（design/78 §1.3 / §1.4）');

{
  /* ⚠️ 四个里 `--mr-c` 是**例外**：它由 JS 内联注入（ui.js:3417），
     不是幽灵。design/78 §1.3 把它列进去是误判 —— 那条只 grep 了 CSS 的
     :root，没查 JS 注入。它的回落值 var(--line-2) 也是有意义的（区域没配色时）。 */
  const GHOSTS = ['--warn', '--ink-dim', '--gold-wash'];
  const miss = GHOSTS.filter((k) => !root[k]);
  ok('78/T-V-13 幽灵变量已在 :root 正式定义（--mr-c 除外：JS 注入，非幽灵）',
    miss.length === 0,
    miss.length ? '缺 ' + miss.join(',') : GHOSTS.join(' / ') + ' 已转正 · --mr-c 由 ui.js 内联注入，保留 var() 外壳');
}

{
  const n = (code.match(/\.tr-[a-z]+\s*(?:,|\{)/g) || []).length;
  ok('78/T-V-14 main.css 内 .tr- 选择器数量 === 0（地形十色死代码已清）', n === 0, n + ' 个');
}

/* ================================================================
 * T-V-15 / 16 —— 双份一致与守卫覆盖
 * ================================================================ */
section('78/T-V-15 / 16 双份一致与守卫覆盖（design/78 §3.3 / §7.9）');

{
  const a = md5(CSS), b = md5(CSS_MIRROR);
  ok('78/T-V-15 两份 main.css md5 相同', a === b, a.slice(0, 8) + ' / ' + b.slice(0, 8));
}

{
  const mc = fs.readFileSync(path.join(ROOT, 'tools', 'mirror-check.js'), 'utf8');
  const has = /'css'/.test(mc) && /renderer',\s*'css'/.test(mc.replace(/\s+/g, ' '))
    || (/css/.test(mc) && /PAIRS/.test(mc));
  ok('78/T-V-16 mirror-check.js 的比对目录含 css', !!has,
    has ? 'js + css 两组' : '仍只比对 js');
}

/* ================================================================
 * T-V-17 —— 恒暗带（design/78 §7.11，夜里复核补全的第三/第四处）
 *   ② .mm-header / .mk-search（第二条不换肤暗色带的带内成员）
 *      background 读 var(--surface* / --paper*) 的声明数 === 0
 *   ③ 全局：近白字 与 换肤浅底（--surface-3 / --surface-hi / --paper-3）
 *      同规则共存数 === 0（"白字压会随主题变浅的底"这个病灶特征全库扫）
 * ================================================================ */
section('78/T-V-17 恒暗带与白字压浅底（design/78 §7.11）');

{
  /* 带内成员 = .mm-header 系 + .mk-search（§7.11 ③ 明细列的四个选择器全在这两族里） */
  const bandRules = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => /^\s*\.(mm-header|mk-search)[\s,{]/.test(m[1]))
    .map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));
  const offenders = bandRules
    .filter(r => /background\s*:[^;]*var\(--(surface|paper)/.test(r.body))
    .map(r => r.sel + ' {' + (r.body.match(/background\s*:[^;]+;/) || [''])[0].trim() + '}');
  ok('78/T-V-17-② 恒暗带成员（.mm-header 系 / .mk-search）background 读换肤变量的声明数 === 0',
    bandRules.length > 0 && offenders.length === 0,
    bandRules.length + ' 条带内规则 · ' + (offenders.length ? '\n      ' + offenders.join('\n      ') : '全部读 --tb-* 簇'));
}

{
  /* 近白：hex 三通道最小值 ≥ 230（#fff / #fffefb / #f6f1e4 / #e6dfcd 都算；
     机械可判，不玩"差不多白"的主观口径） */
  const nearWhite = (c) => {
    const m = c.match(/^#([0-9a-f]{3,8})$/i);
    if (!m) return false;
    let h = m[1]; if (h.length <= 4) h = [...h].map(x => x + x).join('');
    const rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
    return Math.min(...rgb) >= 230;
  };
  const offenders = [...code.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(m => {
      const body = m[2];
      const colors = [...body.matchAll(/(?:^|;)\s*color\s*:\s*([^;]+);/g)].map(x => x[1].trim());
      const hasWhite = colors.some(c => nearWhite(c));
      const hasLightSkinBg = /background\s*:[^;]*var\(--(surface-3|surface-hi|paper-3)\)/.test(body);
      return hasWhite && hasLightSkinBg;
    })
    .map(m => m[1].trim().replace(/\s+/g, ' '));
  ok('78/T-V-17-③ 近白字压换肤浅底（--surface-3 / --surface-hi / --paper-3）同规则共存数 === 0',
    offenders.length === 0,
    offenders.length ? '\n      ' + offenders.join('\n      ') : '全库 0 处');
}

/* ================================================================ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('  失败清单：\n    · ' + fails.join('\n    · '));
console.log('── ' + pass + ' 通过 / ' + fail + ' 失败 ──\n');
if (fail) process.exitCode = 1;
