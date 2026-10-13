#!/usr/bin/env node
/* ==========================================================================
 *  tools/mirror-sync.js —— 前端双副本同步（renderer → public，单向、幂等）
 *  --------------------------------------------------------------------------
 *  为什么要有它：
 *    `mirror-check.js` 只能**发现**漂移，不能**纠正**漂移。而漂移的成因很朴素：
 *    这个仓库没有任何自动同步机制（全仓 grep 不到与 public 相关的拷贝逻辑），
 *    两份一致全靠人手 `cp`，人手就一定会漏。
 *    于是组合应该是：**sync 负责纠偏，check 负责确认 sync 确实管用了**。
 *
 *  范围（严格限定，别顺手扩大）：
 *    game/src/renderer/css/**  → server/public/css/**
 *    game/src/renderer/js/**   → server/public/js/**
 *  ⚠️ **不同步 index.html** —— 两侧那份是**两个不同的页面**：
 *     renderer 那份是游戏主页（带 7 处 ?v= 缓存戳），
 *     public 那份是 Mod 站首页（引 site.js / cloud.js / 站点 css）。
 *     照抄过去会把 Mod 站首页变成游戏页，而且**不报错**。
 *
 *  三条铁律：
 *    ① **只增不改删**：public 侧多出来的文件（site.js / cloud.js / examples.js
 *       这些站点脚本）**一律保留**。它们是站点资产，本来就不该出现在 renderer 里；
 *       同步器敢删它们，等于把 Mod 站删了。
 *    ② **幂等**：内容一致就不写盘（不白白动 mtime 去骗缓存、骗 CI）。
 *    ③ **单向**：永远 renderer → public。发现 public 比 renderer 新也不回灌 ——
 *       双向同步迟早出现「两边都被对方覆盖」的静默丢代码。
 *
 *  用法：node tools/mirror-sync.js [--dry]
 *  ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'game', 'src', 'renderer');
const DST = path.join(ROOT, 'server', 'public');
const DIRS = ['css', 'js'];
const DRY = process.argv.indexOf('--dry') >= 0;

function md5(p) { return crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex'); }

let copied = 0, created = 0, same = 0;
const touched = [];

function main() {
  console.log('');
  console.log('  \u250c\u2500 前端双副本同步 ' + (DRY ? '\uff08预演，不写盘\uff09' : '') + ' ────────────────');
  console.log('  \u2502 ' + path.relative(ROOT, SRC).replace(/\\/g, '/') + '  \u2192  ' + path.relative(ROOT, DST).replace(/\\/g, '/'));
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  if (!fs.existsSync(SRC) || !fs.existsSync(DST)) {
    console.error('\n  \u2605 源或目标目录不存在，跑不了。\n');
    process.exitCode = 1;
    return;
  }

  for (const dir of DIRS) {
    const sd = path.join(SRC, dir), dd = path.join(DST, dir);
    if (!fs.existsSync(sd)) { console.log('\n  (跳过) 源目录不存在：' + dir); continue; }
    if (!fs.existsSync(dd)) fs.mkdirSync(dd, { recursive: true });

    console.log('\n  \u00b7 ' + dir + '/');
    const names = fs.readdirSync(sd).filter(n => fs.statSync(path.join(sd, n)).isFile()).sort();
    for (const n of names) {
      const sp = path.join(sd, n), dp = path.join(dd, n);
      if (!fs.existsSync(dp)) {
        if (!DRY) fs.copyFileSync(sp, dp);
        created++; touched.push(dir + '/' + n);
        console.log('    + 新建  ' + n);
        continue;
      }
      if (md5(sp) === md5(dp)) { same++; console.log('    = 一致  ' + n); continue; }
      if (!DRY) fs.copyFileSync(sp, dp);
      copied++; touched.push(dir + '/' + n);
      console.log('    \u2192 已同步 ' + n);
    }

    /* 只报告、不删除：站点侧独有的资产 */
    const only = fs.readdirSync(dd)
      .filter(n => fs.statSync(path.join(dd, n)).isFile())
      .filter(n => !fs.existsSync(path.join(sd, n)))
      .sort();
    if (only.length) console.log('    \u00b7 仅站点侧有（保留，不删）：' + only.join(', '));
  }

  console.log('');
  console.log('  \u2500\u2500 同步完成：新建 ' + created + ' \u00b7 覆盖 ' + copied + ' \u00b7 原本一致 ' + same
    + (DRY ? '  \uff08预演，未写盘\uff09' : ''));
  if (touched.length) console.log('  本次变动：' + touched.join(', '));
  console.log('');
  process.exitCode = 0;
}

main();
