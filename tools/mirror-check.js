#!/usr/bin/env node
/* ==========================================================================
 *  tools/mirror-check.js —— 前端双副本守卫
 *  --------------------------------------------------------------------------
 *  为什么必须有这个脚本：
 *    这个仓库的前端有**两份**，改动必须在两边都落地：
 *        game/src/renderer/js/     ← 游戏服务（`game-server.js`）从这里发
 *        server/public/js/         ← Mod 站独立跑（`mod-site.js`）从这里发
 *        （css/ 同理）
 *    两份由谁来同步？现在是靠 `tools/mirror-sync.js` 单向同步（renderer → public）。
 *    在那之前是**没有人** —— 全仓搜 `copyFile|cpSync|copySync` 命中不到任何与
 *    public 相关的拷贝逻辑，两份一致靠人手 `cp`（两份 ui.js 的 mtime 差 0.17 秒）。
 *
 *    人手拷贝一定会漂：今天改了 ui.js 忘了 cp ⇒ 电脑端是新的、Mod 站是旧的，
 *    表现为「同一个 bug 在一台机器上修好了、在另一台还在」，而且**不报错**。
 *    这个脚本把「两边必须逐字节相同」变成一条 exit≠0 的硬规矩。
 *
 *  判据（只认同一文件名两边都存在的）：
 *    · md5 不同 → 红，并列出第一个不同的字节位置，方便直接定位
 *    · 只在一边的文件不算失败（cloud.js / site.js / examples.js / site.css 是
 *      站点资产，本来就不该出现在 renderer 里）
 *
 *  ⚠️ 曾经的守卫缺口（design/78 §3.3 点名）：**这个脚本只查 js，不查 css**。
 *     而 `css/main.css` 同样是镜像文件（mirror-sync 的 DIRS 里就有 'css'）。
 *     那轮我在报告里写「main.css 两侧 OK」，是**手工 md5 量出来的，不是工具保证的**
 *     —— CSS 是改得最勤的文件之一（本轮一次动了 8 处），没有守卫迟早漂。
 *     ⇒ 现在 js / css 两组一起查。
 *
 *  用法：node tools/mirror-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
/* 两组目录都要查：js（脚本）+ css（样式）。
   ⚠️ 别再只留 js —— 见文件头「曾经的守卫缺口」。 */
const PAIRS = [
  { label: 'js', a: path.join(ROOT, 'game', 'src', 'renderer', 'js'), b: path.join(ROOT, 'server', 'public', 'js') },
  { label: 'css', a: path.join(ROOT, 'game', 'src', 'renderer', 'css'), b: path.join(ROOT, 'server', 'public', 'css') },
];

function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}

/** 找第一个不同的字节偏移 —— 报错时报个 md5 没人知道改哪儿，报偏移量才有用 */
function firstDiffOffset(p1, p2) {
  const b1 = fs.readFileSync(p1), b2 = fs.readFileSync(p2);
  const n = Math.min(b1.length, b2.length);
  for (let i = 0; i < n; i++) if (b1[i] !== b2[i]) return { off: i, len1: b1.length, len2: b2.length };
  return { off: n, len1: b1.length, len2: b2.length };   /* 长度不同但前缀全同 */
}

/* 我们还顺手盯一眼 index.html 的版本戳 —— 它是「双副本」的另一半：
   改了 js 不推进 ?v=，等于把新脚本发给已经缓存了旧脚本的浏览器。 */
function versionStamps() {
  const html = path.join(ROOT, 'game', 'src', 'renderer', 'index.html');
  if (!fs.existsSync(html)) return null;
  const txt = fs.readFileSync(html, 'utf8');
  const list = txt.match(/\?v=([0-9]+[a-z]*)/g) || [];
  return { file: html, stamps: list };
}

function main() {
  console.log('');
  console.log('  \u250c\u2500 前端双副本守卫（js + css）──────────────────');
  for (const p of PAIRS) {
    console.log('  \u2502 ' + p.label.padEnd(3) + '  ' + path.relative(ROOT, p.a).replace(/\\/g, '/')
      + '  \u2194  ' + path.relative(ROOT, p.b).replace(/\\/g, '/'));
  }
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  const missing = PAIRS.filter(p => !fs.existsSync(p.a) || !fs.existsSync(p.b));
  if (missing.length) {
    console.error('\n  \u2605 找不到目录：' + missing.map(p => p.label).join(' / ') + '，跑不了。\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  \u00a71 同名文件逐字节一致');
  let compared = 0;
  for (const p of PAIRS) {
    console.log('    ── ' + p.label + ' ──');
    const names = fs.readdirSync(p.a).filter(n => fs.statSync(path.join(p.a, n)).isFile());
    for (const n of names) {
      const pa = path.join(p.a, n), pb = path.join(p.b, n);
      if (!fs.existsSync(pb)) continue;             /* 只有 renderer 有：不是副本对 */
      compared++;
      const ha = md5(pa), hb = md5(pb);
      if (ha === hb) {
        ok(n + ' 一致', true, ha.slice(0, 8));
      } else {
        const d = firstDiffOffset(pa, pb);
        const rel = path.relative(ROOT, p.a).replace(/\\/g, '/');
        const relB = path.relative(ROOT, p.b).replace(/\\/g, '/');
        ok(n + ' 一致', false,
          'md5 ' + ha.slice(0, 8) + ' vs ' + hb.slice(0, 8)
          + ' \u00b7 首个差异字节 @' + d.off
          + ' \u00b7 长度 ' + d.len1 + '/' + d.len2
          + ' \u2192 改完请跑 `node tools/mirror-sync.js`（' + rel + '/' + n + ' \u2192 ' + relB + '/' + n + '）');
      }
    }
  }
  ok('至少比对到一组同名文件', compared > 0, compared + ' 组');
  ok('js 和 css 两组都被覆盖到',
    PAIRS.every(p => fs.readdirSync(p.a).some(n => fs.existsSync(path.join(p.b, n)))),
    PAIRS.map(p => p.label).join(' + '));

  console.log('\n  \u00a72 index.html 资源版本戳统一');
  const vs = versionStamps();
  if (!vs) {
    ok('能读到 game/src/renderer/index.html', false, '文件不存在');
  } else {
    const uniq = Array.from(new Set(vs.stamps));
    ok('?v= 全部同一个值（' + vs.stamps.length + ' 处）', uniq.length === 1,
      uniq.join(' , ') || '（一个都没有）');
    if (uniq.length === 1) console.log('      当前版本戳：' + uniq[0]);
  }

  console.log('');
  console.log('  \u2500\u2500 汇总 \u2500\u2500  通过 ' + pass + ' \u00b7 失败 ' + fail);
  if (fails.length) console.log('  失败项：\n    - ' + fails.join('\n    - '));
  console.log('');
  if (fail) process.exitCode = 1;
}

main();
