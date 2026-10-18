#!/usr/bin/env node
/* ==========================================================================
 *  tools/_test-tmp.js —— 测试临时目录的唯一出口（2026-10-18）
 *
 *  为什么搬出项目：`.livetest/` 在仓库里会被**发布打包**扫到——几千个测试存档目录
 *  + 一个 Windows「删除挂起」文件（combat-ab.tsv）导致打包 EPERM 连续 4 次失败。
 *  测试卫生污染交付流程，不是偶发。
 *
 *  口径：
 *    · 默认落 os.tmpdir()/wuxia-tests/<pid>-<ts>/<tag>
 *    · 每进程一个根目录，进程退出（含 SIGINT/SIGTERM）自清
 *    · 需要保留现场时显式传 `{ keep: true }`（会在输出里打印路径）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

let ROOT = null;
let cleaned = false;

function root() {
  if (ROOT) return ROOT;
  ROOT = path.join(os.tmpdir(), 'wuxia-tests', process.pid + '-' + Date.now());
  fs.mkdirSync(ROOT, { recursive: true });
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { /* Windows 偶发占用，忽略 */ }
  };
  process.on('exit', cleanup);
  try { process.on('SIGINT', () => { cleanup(); process.exit(130); }); } catch (e) { /* ignore */ }
  try { process.on('SIGTERM', () => { cleanup(); process.exit(143); }); } catch (e) { /* ignore */ }
  return ROOT;
}

/** 取（并创建）本进程专属的临时子目录。同名 tag 多次调用返回同一路径。 */
function testTmpDir(tag) {
  const d = path.join(root(), String(tag || 'tmp'));
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { testTmpDir, root };
