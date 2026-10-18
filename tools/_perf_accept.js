#!/usr/bin/env node
/**
 * _perf_accept.js —— **已并入口的薄壳**（保留命令行兼容）
 *
 * 为什么改成壳：k_io 落地后，`PERF_CALIB_FORCE_MS` 只钉住 kCpu，最终 `k=max(kCpu,kIo)`，
 * 旧版 A1「注入 k=1.00 → 必走正常档」这个前提**不再成立**：kIo 会把 k 抬到 ≥1.3，
 * 门正确地判「未判」，而旧断言把它当失败（我刚实测 4 条假红）。
 * 两份验收器各自演化 = 迟早给出两个结论 ⇒ 单一真相源改为 `_perf_gate_verify.js`：
 *   V1 静窗真判 ｜ V2 忙窗（k≥1.3→未判零 ✔，kIo≥kCpu）｜ V3 注入一致性 ｜ V4 套件只判体积
 *
 * 用法：node tools/_perf_accept.js        # 等价于 node tools/_perf_gate_verify.js
 * 退出码与参数原样透传。
 */
'use strict';
const path = require('path');
const { spawnSync } = require('child_process');

console.log('（_perf_accept 已并入 _perf_gate_verify.js，单一真相源；以下是对应输出）\n');
const r = spawnSync(process.execPath, [path.join(__dirname, '_perf_gate_verify.js')].concat(process.argv.slice(2)), { stdio: 'inherit' });
process.exit(r.status === null ? 2 : r.status);
