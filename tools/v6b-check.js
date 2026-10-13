/* V6-b 点/线语义守卫（design/81 §十，甄塑之口径 2026-10-14；落地 2026-10-14 寇豆码）
 * 三条断言（§10.2），按磁盘现状分级——红着是守卫在工作的样子，落地当天应全绿：
 *   V6-b-1  81/N-V-26：.hl 渲染产物里 title= 出现次数 === 0（应换 aria-label）
 *           现状：ui.js .hl 仍带 title → 红，直到 ui.js 改 aria-label
 *   V6-b-2  81/N-V-7（=83 §3.3）线型不相等：同一 .log-line 内 .hl 与 .exit-inline
 *           的 border-bottom-style 必须不相等（出口=虚线是「路」，名词不许撞线）
 *           现状：main.css 984 撞线规则已删 → 绿
 *   V6-b-3  83 §3.4 A 层无块：.log 内 .hl 不得同时具备 background + border-radius
 *           现状：旧 chip 样式（978–983）仍在 → 红，直到 81 视觉落地删 chip
 * 红线纪律（84 号）：守卫红 = 整改没落地，不许为变绿改判据或顺手改值。
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + (note ? '  ' + note : '')); }
};

/* 从 css 里抠某选择器规则块（stripComments 后按块匹配，不按行号——行号会漂） */
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ');
function ruleOf(css, selRe) {
  const re = new RegExp('(^|[\\s,}])((' + selRe + ')[\\s,{][^{}]*\\{[^}]*\\})', 'g');
  let m, out = [];
  while ((m = re.exec(css)) !== null) out.push(m[2]);
  return out;
}
const declOf = (block, prop) => {
  const m = block.match(new RegExp(prop + '\\s*:\\s*([^;}]+)'));
  return m ? m[1].trim() : null;
};

const cssPath = path.join(__dirname, '..', 'game', 'src', 'renderer', 'css', 'main.css');
const css = stripComments(fs.readFileSync(cssPath, 'utf8'));

console.log('[V6-b-1] .hl 渲染产物无 title=（81/N-V-26，应换 aria-label）');
const uiPath = path.join(__dirname, '..', 'game', 'src', 'renderer', 'js', 'ui.js');
const ui = stripComments(fs.readFileSync(uiPath, 'utf8'));
/* 只查 .hl 的渲染处（class="hl" / 'hl' 的拼接），不扫全文件（别处的 title 与本断言无关） */
const hlChunks = [];
const chunkRe = /(?:class=|className[^;\n]*?=)[^\n;]{0,200}/g;
let cm;
const uiRaw = fs.readFileSync(uiPath, 'utf8');
const lines = uiRaw.split('\n');
lines.forEach((ln, i) => {
  if (/\bhl\b/.test(ln) && /title\s*=/.test(ln)) hlChunks.push('ui.js:' + (i + 1));
});
t('`.hl` 渲染产物中 title= 出现次数 === 0', hlChunks.length === 0,
  hlChunks.length ? '命中：' + hlChunks.join(' , ') + '（81 落地时改 aria-label）' : '');

console.log('[V6-b-2] .hl 与 .exit-inline 的 border-bottom-style 不相等（81/N-V-7 = 83 §3.3）');
/* 选择器要抓「.log-line … .hl」的一切变体（含 .log-line.action .hl 这类中间带 class 的），
   否则 984 那条撞线规则漏网 → 守卫在删行之前就瞎绿（第一版就栽在这）。
   但 .exit-inline 只取**行内出口**本体（.log-line .exit-inline）：
   .exit-map .exit-inline 是出口方位图里的深底变体，不是「线」的语义载体，
   算进来判据过宽，删行后会永远假红。 */
const hlRules = ruleOf(css, '\\.log-line[\\w.\\s-]*\\.hl(?![\\w-])');
const exitRules = ruleOf(css, '\\.log-line\\s+\\.exit-inline(?![\\w-])');
t('存在 .log-line .hl 规则（≥1，样本不许为 0）', hlRules.length > 0, hlRules.length + ' 条');
t('存在 .log-line .exit-inline 规则（≥1）', exitRules.length > 0, exitRules.length + ' 条');
if (hlRules.length && exitRules.length) {
  const hlStyles = new Set(hlRules.map(b => {
    let s = declOf(b, 'border-bottom-style');
    if (!s) { const bb = declOf(b, 'border-bottom'); if (bb && /dashed|dotted|double|solid/.test(bb)) s = (bb.match(/dashed|dotted|double|solid/) || ['solid'])[0]; }
    /* border: 1px solid … 整写时 bottom 默认 solid */
    if (!s) { const bAll = declOf(b, '(?<![-\\w])border\\s*'); if (bAll && /dashed|dotted|double|solid/.test(bAll)) s = (bAll.match(/dashed|dotted|double|solid/) || ['solid'])[0]; }
    return s || 'none';
  }));
  const exStyles = new Set(exitRules.map(b => {
    let s = declOf(b, 'border-bottom-style');
    if (!s) { const bb = declOf(b, 'border-bottom'); if (bb && /dashed|dotted|double|solid/.test(bb)) s = (bb.match(/dashed|dotted|double|solid/) || ['solid'])[0]; }
    if (!s) { const bAll = declOf(b, '(?<![-\\w])border\\s*'); if (bAll && /dashed|dotted|double|solid/.test(bAll)) s = (bAll.match(/dashed|dotted|double|solid/) || ['solid'])[0]; }
    return s || 'none';
  }));
  /* 不许有任何一对相等（.hl 的线型集合 ∩ .exit-inline 的线型集合 === ∅） */
  const clash = [...hlStyles].filter(s => exStyles.has(s));
  t('线型不相等（点≠线）', clash.length === 0,
    clash.length ? '撞线：' + clash.join(',') + ' —— 83 §4.3.2 登记过的老病，别让它回来' : '.hl=[' + [...hlStyles] + '] / .exit-inline=[' + [...exStyles] + ']');
}

console.log('[V6-b-3] .log 内 .hl 无「background+border-radius」块样式（83 §3.4 A 层无块）');
/* 判据看**值**不是看**声明存在**：81 §3.1 的按钮复位写 background:none + border-radius:0，
   那是"没有"，不是"具备"——真具备 = background 非 none/transparent 且 border-radius 非 0。 */
const realBg = v => v && !/^(none|transparent)$/i.test(v.trim());
const realRadius = v => v && !/^(0|0px|0em)$/i.test(v.trim());
const chipHit = hlRules.filter(b => realBg(declOf(b, 'background')) && realRadius(declOf(b, 'border-radius')));
t('`.hl` 不得同时具备 background + border-radius', chipHit.length === 0,
  chipHit.length ? chipHit.length + ' 条 chip 样式命中（81 落地删 978–983 chip 整段后转绿）' : '');

console.log(`\nV6-b：通过 ${pass} / 失败 ${fail}` + (fail ? '（红=整改没落地，84 号纪律，不许为变绿改判据）' : ''));
/* 与 say-hint-check 同口径：落地验收单型守卫，红就 exit 1（回归里红着是工作状态，落地当天转绿） */
process.exit(fail ? 1 : 0);
