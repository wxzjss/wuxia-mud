#!/usr/bin/env node
/* ==========================================================================
 *  tools/css-contrast.js —— WCAG 2.1 对比度计算器
 *  --------------------------------------------------------------------------
 *  为什么要有它：design/78 通篇是「实测 X.XX ✅/✗」，那些数是这么算出来的。
 *  但它散落在文档里、**没有一处可执行的口径** —— 下次有人调一个色，
 *  要么再去手算一遍，要么拍脑袋说"差不多"。两种都会静默退化。
 *
 *  ⇒ 把 WCAG 2.1 的相对亮度与对比度公式固化在这里：
 *     · 命令行：`node tools/css-contrast.js '#fff' '#241f18'`
 *     · 当库用：`const { contrast } = require('./css-contrast');`
 *
 *  ⚠️ 只算**纯色**。带 alpha 的（rgba）要先叠到不透明底上再算 ——
 *     WCAG 的公式不接受半透明，拿 rgba 直接算出来的数是假的。
 *
 *  ⚠️ 阈值口径（WCAG 2.1 AA）：
 *     · 正文 4.5:1
 *     · 大字（≥18.66px 且 bold，或 ≥24px）3.0:1
 *     · 非文本（图形 / 控件边界）3.0:1
 * ========================================================================== */

'use strict';

/** sRGB 通道 → 线性化（WCAG 2.1 相对亮度公式的分段函数） */
function chan(v) {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** 解析 #rgb / #rrggbb / #rrggbbaa（aa 会被忽略并警告） */
function parse(hex) {
  let h = String(hex).trim().replace(/^#/, '');
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (h.length >= 8) h = h.slice(0, 6);   // 忽略 alpha（见文件头警告）
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** 相对亮度（0=全黑 1=全白） */
function luminance(hex) {
  const c = parse(hex);
  if (!c) return NaN;
  return 0.2126 * chan(c[0]) + 0.7152 * chan(c[1]) + 0.0722 * chan(c[2]);
}

/** 对比度（1 ~ 21） */
function contrast(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  if (isNaN(a) || isNaN(b)) return NaN;
  const hi = Math.max(a, b), lo = Math.min(a, b);
  return (hi + 0.05) / (lo + 0.05);
}

/** `rgba(r,g,b,a)` 叠到不透明底 `bgHex` 上，返回等效的 #rrggbb */
function flatten(rgba, bgHex) {
  const m = String(rgba).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) return null;
  const bg = parse(bgHex);
  if (!bg) return null;
  const a = m[4] === undefined ? 1 : parseFloat(m[4]);
  const f = [1, 2, 3].map((i) => {
    const c = parseFloat(m[i]);
    return Math.round(c * a + bg[i - 1] * (1 - a));
  });
  return '#' + f.map((v) => ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2)).join('');
}

/** CIE L\*（感知明度，0=黑 100=白）。
 *  为什么需要它：WCAG 的对比度是**比值**，只能回答"这两色差多少倍"；
 *  要回答"这五档墨阶排得匀不匀"得用**差值** —— 那就得是 L\* 这种等距标度
 *  （design/78 §2.1-bis 判定墨阶是否等距，量的是相邻档 ΔL\*）。 */
function labL(hex) {
  const Y = luminance(hex);
  if (isNaN(Y)) return NaN;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return 116 * f(Y) - 16;
}

module.exports = { contrast, luminance, labL, parse, flatten };

/* ================================================================ */
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.log('用法：node tools/css-contrast.js <前景> <背景1> [背景2 ...]');
    console.log('  第 1 个参数是**前景**（字色），后面全是**背景**（底色）——');
    console.log('  因为最常见的问法是「这个白字压在各种底上够不够」。');
    console.log('');
    console.log('例  ：node tools/css-contrast.js "#fff" "#241f18"');
    console.log('     node tools/css-contrast.js "#fff" "#2f6ba4" "#7d7020" "#96701f"');
    process.exit(2);
  }
  const fg = args[0];
  const lf = luminance(fg);
  console.log('前景 ' + fg + '  相对亮度 ' + (isNaN(lf) ? '(解析失败)' : lf.toFixed(4)));
  console.log('');
  for (let i = 1; i < args.length; i++) {
    const bg = args[i];
    const c = contrast(fg, bg);
    if (isNaN(c)) { console.log('  ' + bg + '  ✗ 解析失败（只接受 #rgb / #rrggbb）'); continue; }
    const body = c >= 4.5 ? '✅ 正文' : '✗ 正文';
    const large = c >= 3.0 ? '✅ 大字/图形' : '✗ 大字/图形';
    console.log('  底 ' + bg + '  ' + c.toFixed(2).padStart(6) + '   ' + body + ' · ' + large);
  }
}
