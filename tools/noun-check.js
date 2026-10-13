/* 81 交互名词视觉守卫（design/81 §3/§4/§七 N-V-*，2026-10-14 落地 · 寇豆码）
 * 覆盖静态可判的 N-V 条目；纯运行时/视口类（N-V-10/15 等）在 §尾登记为"浏览器人工单"。
 * 红线纪律（84 号）：红 = 整改没落地，不许为变绿改判据或顺手改值。
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + (note ? '  ' + note : '')); }
};

const cssRaw = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
const ui = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const uiNoCmt = ui.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

/* ---- 对比度 / ΔL* 工具（WCAG 相对亮度 + CIE L*）---- */
function lum(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
function starL(hex) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(n.slice(i, i + 2), 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 116 * Math.pow(Y, 1 / 3) - 16;
}
const dL = (a, b) => Math.abs(starL(a) - starL(b));

/* 主题级联取值：先查主题块，查不到回退 :root（CSS 自定义属性的继承语义——
   --noun-dot 只在 :root 定义为 var(--red)，亮色块覆写的是 --red 本身，
   守卫不做级联就会把亮色侧解析成 null（第一次就栽在这）。 */
const ROOT_RE = /:root\s*\{[^}]*\}/;                      /* 暗主题缺省值块 */
const LIGHT_RE = /html\.theme-light\s*\{[^}]*\}/;         /* 亮主题覆写块 */
function cssVarIn(blockRe, name) {
  const m = css.match(blockRe);
  if (!m) return null;
  const v = m[0].match(new RegExp('--' + name + '\\s*:\\s*([^;}]+)'));
  return v ? v[1].trim() : null;
}
/* 主题级联：亮色块查不到的变量回退 :root（--noun-dot 定义在 :root 为 var(--red)） */
const cssVar = (theme, name) =>
  (theme === 'light' && cssVarIn(LIGHT_RE, name)) || cssVarIn(ROOT_RE, name);
/* var() 链解析（按主题级联），返回 hex */
function resolveVar(theme, v) {
  let cur = String(v == null ? '' : v).trim();
  for (let i = 0; i < 4; i++) {
    const m = cur.match(/^var\(--([\w-]+)\)$/);
    if (!m) break;
    const nxt = cssVar(theme, m[1]);
    if (nxt == null) return null;
    cur = nxt;
  }
  const hex = cur.match(/#[0-9a-fA-F]{3,8}/);
  return hex ? hex[0] : null;
}

console.log('[形状] 81/N-V-1 · N-V-5 · N-V-6 · N-V-19');
t('N-V-1 主判据：.hl 带着重点（text-emphasis … dot，含 -webkit- 前缀对）',
  /-webkit-text-emphasis:\s*filled dot var\(--noun-dot\)/.test(css) && /(?<!-webkit-)text-emphasis:\s*filled dot var\(--noun-dot\)/.test(css));
t('N-V-1 兜底：@supports not (text-emphasis) 给实线（≠出口虚线族）',
  /@supports not \(text-emphasis[^)]*\)\s*\{[^}]*\.log-line \.hl\s*\{[^}]*border-bottom:\s*1px solid var\(--noun-fb-line\)/.test(cssRaw.replace(/\n/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ')));
t('N-V-5 不改排版：.hl 复位 font:inherit / line-height:inherit', /\.log-line \.hl\s*\{[^}]*font:\s*inherit;\s*line-height:\s*inherit/.test(css));
t('N-V-6 不用字重/斜体：.hl 规则块内无 font-weight / font-style 声明',
  (css.match(/\.log-line \.hl\s*\{[^}]*\}/g) || []).every(b => !/font-weight|font-style/.test(b)));
t('N-V-19 不自动超时：ui.js 里没有以收提示行为目的的定时器',
  !/setTimeout[^;]*closeHlTips/.test(uiNoCmt) && !/setInterval[^;]*hl-tip/.test(uiNoCmt));
t('N-V-26（L1 不说话）渲染产物无 title=（v6b-check 同源复核）', !/\bclass="hl"[^>]*title=/.test(uiNoCmt));

console.log('[颜色] N-V-3 · N-V-4 · N-V-16 · N-V-17（预计算值按 81 §3.1/§4 复算）');
const PAPERS = { dark: ['#17140f', '#201c15', '#241f18'], light: ['#f4f1e8', '#fffdf9', '#ebe6d9'] };
const nounDot = { dark: resolveVar('dark', cssVar('dark', 'noun-dot')), light: resolveVar('light', cssVar('light', 'noun-dot')) };
t('N-V-3 着重点对三种纸底 ≥3.0（两主题）',
  PAPERS.dark.every(p => contrast(nounDot.dark, p) >= 3) && PAPERS.light.every(p => contrast(nounDot.light, p) >= 3),
  '暗 ' + nounDot.dark + ' / 亮 ' + nounDot.light);
const nounInk = { dark: cssVar('dark', 'noun-ink'), light: cssVar('light', 'noun-ink') };
const ink = { dark: resolveVar('dark', cssVar('dark', 'ink')), light: resolveVar('light', cssVar('light', 'ink')) };
const cDark = contrast(nounInk.dark, ink.dark), cLight = contrast(nounInk.light, ink.light);
const dDark = dL(nounInk.dark, ink.dark), dLight = dL(nounInk.light, ink.light);
t('N-V-4 词色只浓半档：对 --ink 对比 ∈[1.10,1.25] 且 ΔL*∈[4,7]（两主题；甲后换值见 81 §4.1）',
  cDark >= 1.10 && cDark <= 1.25 && dDark >= 4 && dDark <= 7 && cLight >= 1.10 && cLight <= 1.25 && dLight >= 4 && dLight <= 7,
  '暗 ' + cDark.toFixed(3) + '/' + dDark.toFixed(1) + ' · 亮 ' + cLight.toFixed(3) + '/' + dLight.toFixed(1));
const tipCmd = { dark: cssVar('dark', 'tip-cmd'), light: cssVar('light', 'tip-cmd') };
t('N-V-16 指令色对三种纸底 ≥4.5（两主题；--tip-cmd 是 81 §4 写明理由的硬编码）',
  PAPERS.dark.every(p => contrast(tipCmd.dark, p) >= 4.5) && PAPERS.light.every(p => contrast(tipCmd.light, p) >= 4.5),
  '暗 ' + tipCmd.dark + ' / 亮 ' + tipCmd.light);
const tipInk = { dark: resolveVar('dark', cssVar('dark', 'tip-ink')), light: resolveVar('light', cssVar('light', 'tip-ink')) };
t('N-V-17 提示正文色对三种纸底 ≥4.5（两主题）',
  PAPERS.dark.every(p => contrast(tipInk.dark, p) >= 4.5) && PAPERS.light.every(p => contrast(tipInk.light, p) >= 4.5),
  '暗 ' + tipInk.dark + ' / 亮 ' + tipInk.light);

console.log('[交互接线] N-V-11 · N-V-12 · N-V-14 · N-V-20 · N-V-21');
t('N-V-11 互斥：toggleHlTip 里先 closeHlTips 再开新', /function toggleHlTip[\s\S]{0,900}closeHlTips\(\)/.test(uiNoCmt));
t('N-V-12 ARIA 与可见一致：开/收都同步 aria-expanded',
  /tip\.hidden = false;\s*\n\s*btn\.setAttribute\('aria-expanded',\s*'true'\)/.test(uiNoCmt)
  && /tip\.hidden = true; btn\.setAttribute\('aria-expanded', 'false'\)/.test(uiNoCmt));
t('N-V-20 执行即收：doCmd 入口调 closeHlTips', /async function doCmd\(cmd, opts\) \{[\s\S]{0,400}closeHlTips\(\)/.test(uiNoCmt));
t('N-V-21 不可逆清单在册（偷袭/attack/kill/绑架/偷/drop/叛门…）',
  /HL_RISKY_CMDS\s*=\s*\[[^\]]*'偷袭'[^∏]*'kill'[^∏]*'叛门'[^\]]*\]/.test(uiNoCmt));
t('N-V-21 分流：可逆单动作直执、否则先展开提示行（不发 exec）',
  /acts\.length === 1 && !risky[\s\S]{0,200}runInteractAct\(acts\[0\], name\);\s*\n\s*return;[\s\S]{0,200}toggleHlTip\(btnEl, name, acts\)/.test(uiNoCmt));

console.log('[数据] N-V-14 PANEL_CMDS 避让（全库 action cmd 不得整串命中面板表）');
const pm = uiNoCmt.match(/const PANEL_CMDS = \{[\s\S]*?\n  \};/);
const panelKeys = new Set();
if (pm) for (const mm of pm[0].matchAll(/(?:^|[{,\n])\s*([^:'"\n]+?)\s*:/gm)) {
  mm[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).forEach(k => panelKeys.add(k.toLowerCase()));
}
const dataDir = path.join(__dirname, '..', 'game', 'data');
let cmdsChecked = 0, cmdHits = [];
for (const f of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  const rooms = Array.isArray(j.rooms) ? j.rooms : (j.rooms && typeof j.rooms === 'object' ? Object.values(j.rooms) : []);
  for (const r of rooms) {
    if (!r || !Array.isArray(r.actions)) continue;
    for (const a of r.actions) {
      const c = String(a && a.cmd || '').trim().toLowerCase();
      if (!c) continue;
      cmdsChecked++;
      if (panelKeys.has(c)) cmdHits.push(f + '/' + r.id + ': ' + c);
    }
  }
}
t('全库 ' + cmdsChecked + ' 条房间 action cmd 零命中 PANEL_CMDS', cmdHits.length === 0,
  cmdHits.length ? cmdHits.slice(0, 5).join(' ｜ ') : '');
t('PANEL_CMDS 表解析非空（守卫不许在零样本上空过）', panelKeys.size > 50, panelKeys.size + ' 键');

console.log('\n—— 登记为"浏览器人工单"（本守卫判不了，81 §7 原文归运行时）——');
console.log('   N-V-10 窄屏 375px 提示行可见 · N-V-15 触屏热区实测 · N-V-9/18 DOM 祖先链/同源点开');
console.log(`\n81 noun-check：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
