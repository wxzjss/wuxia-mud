/**
 * tools/_test-save-dir.js —— 测试脚本专用存档目录（主人 bug B1 配套）
 *
 * 根因：`saves/` 是**玩家**的存档目录，但工具脚本跑一次就往里裸写一份存档。
 * 于是 `tools/smoke-test.js` 留下的 `test_slot.json`（玩家名「测试侠客」）
 * 出现在主人的读取存档列表里，且因 `savedAt` 最新而排在**首行** ——
 * 触屏机型看不到文件系统，玩家无从自查来源。
 *
 * 修法（本文件是「源头隔离」那一半）：
 *   测试脚本把 `saveDir` 指到这里，不再碰真`saves/`。
 *   另一半在 `engine.js` 的 `listSaves()` 过滤（挡住历史遗留档）。
 *   两层缺一不可：只有源头隔离，历史遗留的 test_slot.json 仍会显示；
 *   只有列表过滤，下次谁再裸写一次又会漏进来。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ⚠️ 2026-10-12 改：从 `os.tmpdir()` 迁到**项目内** `.livetest/`。
   理由（项目铁律「测试不许写仓库真实目录」的配套）：
   系统临时目录在别的机器上权限不可控（可能被清、可能不可写、路径含空格/中文），
   而 `.livetest/` 已被 .gitignore 忽略（第 8 行），既隔离又可查。
   项目里一度有**三套写法**（.packtest/ · os.tmpdir · .livetest/），统一到这里。

   ⚠️ 2026-10-13 再改：目录名带 `process.pid`（团队长批准）。
   为什么：回归是 **4 并发**，而这个文件被 20 个脚本共用；原来是固定路径
   `.livetest/test-saves`，理论上两个并发套件在同一毫秒写同名存档档
   （如 test_slot.json）就会互踩 —— 那种红是「并发时序」红，跟内容无关，
   排查它纯属浪费人。按进程分目录后各写各的，互踩在物理上不可能发生。
   为什么敢分：没有任何脚本**跨进程**读别人写的存档 —— 每个套件都是
   自己写自己读（run-regression 本来就给每套发了独立的 WX_SAVE_DIR，
   这个文件只是兜底层，兜底层也照分不误）。
   ⚠️ 别在这里加「清理别的 test-saves-* 目录」的逻辑：回归并发时那可能是
   别人正用着的活目录，清了就是人为制造互踩。残留交给磁盘，.livetest 不进 git。 */
const DIR = require('./_test-tmp').testTmpDir('test-saves');
try { fs.mkdirSync(DIR, { recursive: true }); } catch (e) { /* 建不了就让后面去报错，别静默 */ }
module.exports = DIR;
