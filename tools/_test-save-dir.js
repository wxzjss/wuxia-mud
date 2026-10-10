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
const os = require('os');
const path = require('path');

/** 操作系统临时目录下的隔离沙盒，随系统临时目录一起被清掉 */
module.exports = path.join(os.tmpdir(), 'jinyong-mud_test-saves');
