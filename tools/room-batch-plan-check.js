#!/usr/bin/env node
/* ==========================================================================
 * tools/room-batch-plan-check.js —— 批次清单的**守卫**（不是生成器）
 * --------------------------------------------------------------------------
 * 为什么它要存在：`room-batch-plan.js` 是**生成器**（跑一次写出
 * `_room_batch_plan.json`），名字不匹配 `*-check`，回归不会自动收它。
 * 于是有个空档：design/77 改了（加行 / 删行 / 又栽一条正文裁定），
 * 而批次清单没重跑 ⇒ 寇豆码照着一张**过期的单**执行，没人知道。
 *
 * 它守的是几条会**悄悄漂移**的不变量：
 *   · design/77 抠出来的改名表还是不是 82 间（曾经串表成 86，多 4 间）
 *   · 名单上的 id 磁盘上还在不在
 *   · §3 正文里新栽的改名裁定有没有被抓进来
 *   · 每批 ≤40、房间不漏不重、没串区
 *   · 文档自相对不上的地方有没有被报出来（而不是被默默吞掉）
 *
 * 它**不**做的事：不重新生成清单（那是生成器的事，重跑可能有副作用）。
 * 它只跑 `--selftest`，把退出码原样传出去。
 *
 * 用法（也被 run-regression 自动收）：
 *   node tools/room-batch-plan-check.js
 * ========================================================================== */
'use strict';

const path = require('path');
const { spawn } = require('child_process');

/* ⚠️ 用异步 spawn，不用 spawnSync —— 这个沙箱里 spawnSync 会 EBUSY，
   连 `cmd /c echo` 都跑不起来（踩过）。 */
const child = spawn(
  process.execPath,
  [path.join(__dirname, 'room-batch-plan.js'), '--selftest'],
  { cwd: path.join(__dirname, '..'), stdio: 'inherit', windowsHide: true }
);

child.on('close', code => {
  if (code !== 0) {
    console.error('');
    console.error('批次清单自检没过。design/77 或 game/data 动过之后，');
    console.error('跑一次 `node tools/room-batch-plan.js` 重新切分，');
    console.error('再看看新报出来的 discrepancies —— 那里面可能要人拍板。');
  }
  process.exit(code === 0 ? 0 : 1);
});
