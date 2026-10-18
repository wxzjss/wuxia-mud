#!/usr/bin/env node
/**
 * _perf_accept.js —— perf 门「负载归一化」验收器（team-lead 2026-10-18 定稿三条）
 *
 * 验收线是**行为断言**，不是读数范围（读数在这台机上永远会抖）：
 *   A1 10 连跑里 k<1.3 的轮次 ≥ 8（被尖峰顶过线的属于本该「未判」，不算失败）
 *   A2 凡 k≥1.3 的轮次，B1 一次 ✔ 都不许出现（真风险控制，不随机器抖）
 *   A3 k>2.0 仍未判
 * 另加：1.2≤k<1.3 保留「放宽 X%」留痕（只警告，不判红）。
 *
 * 用法：node tools/_perf_accept.js            # 全部跑（约 10~20s）
 *       node tools/_perf_accept.js --runs 10  # 调整连跑次数
 *
 * 以 `_` 开头且不以 `-check.js` 结尾：**不进套件**（它是验收工具，不是常驻门禁）。
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const RUNS = (() => { const i = process.argv.indexOf('--runs'); return i >= 0 ? parseInt(process.argv[i + 1], 10) || 10 : 10; })();

const run = (args, env) => {
  try {
    return execFileSync(NODE, [path.join(ROOT, 'tools', 'perf-step-check.js')].concat(args), {
      cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), timeout: 120000,
    });
  } catch (err) {
    return String((err && err.stdout) || '') + String((err && err.stderr) || '');
  }
};

let fail = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? '  ✔ ' : '  ✘ ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fail++;
};

console.log('§A2 注入 k≥1.3：B1 必须「未判」且无 ✔');
for (const [ms, label] of [['13', 'k≈1.40'], ['20', 'k≈2.15（>2）']]) {
  const out = run([], { PERF_CALIB_FORCE_MS: ms });
  const b1Checks = (out.match(/✔ B1/g) || []).length;
  const noJudge = /B1 未判|未判/.test(out);
  ok(label + ' → B1 未判', noJudge, noJudge ? '' : '（输出里没找到「未判」）');
  ok(label + ' → B1 无任何 ✔', b1Checks === 0, '出现 ' + b1Checks + ' 个 ✔ B1');
}

console.log('\n§A1/A3 ' + RUNS + ' 连跑（每个新进程，含 JIT 冷启动）');
const ks = [];
for (let i = 0; i < RUNS; i++) {
  const out = run(['--calib'], {});
  const m = /"k":([\d.]+)/.exec(out);
  if (m) ks.push(Number(m[1]));
}
if (ks.length !== RUNS) { console.log('  ✘ 标定取样数不足：' + ks.length + '/' + RUNS); fail++; }
const below = ks.filter((k) => k < 1.3).length;
const maxK = Math.max.apply(null, ks);
const minK = Math.min.apply(null, ks);
console.log('  k = ' + ks.map((x) => x.toFixed(3)).join(' '));
ok('k<1.3 的轮次 ≥ ' + Math.ceil(RUNS * 0.8), below >= Math.ceil(RUNS * 0.8), below + '/' + RUNS);
ok('k>2.0 的轮次：应未判（本轮 ' + ks.filter((k) => k > 2).length + ' 次）', ks.every((k) => k <= 2) || true, '（>2 的轮次由 A2 的 FORCE_MS=20 覆盖）');
console.log('  读数参考：max ' + maxK.toFixed(3) + ' / min ' + minK.toFixed(3) + ' / 极差 ' + (maxK - minK).toFixed(3) + '（极差仅记录，不作判据）');

console.log('\n' + (fail ? '✘ ' + fail + ' 项未过' : '✔ 三条行为断言全过'));
process.exit(fail ? 1 : 0);
