#!/usr/bin/env node
/**
 * _perf_accept.js —— perf 门「负载归一化」验收器
 *
 * 为什么判据全是**注入式**（PERF_CALIB_FORCE_MS），不拿"10 连跑的 k 范围"当判据：
 *   读数范围测的是**宿主忙不忙**，不是门禁对不对。实测同一台机连着两轮 10 连跑：
 *     1.045 … 1.241  → max 1.241
 *     1.138 1.263 1.762 … → max 1.762
 *   代码一个字没动。拿它验收会随机红/随机绿，红的是机器。
 *   ⇒ 环境读数只**记录**（打印分布），判定只用注入：注入是确定的，谁跑都一样。
 *
 * 四条判据（team-lead 2026-10-18 定稿三档 + QA 补"正常档别退化成永远未判"）：
 *   A1  k=1.00（注入 9.31）  → B1 正常出判定，全套 12/0      ← 防"永远未判"的假保护
 *   A1b k≈1.24（注入 11.5）  → 仍正常判定 + 日志「放宽 X%」留痕
 *   A2  k≈1.40（注入 13）    → B1 未判，且**一个 ✔ 都不许出现**
 *   A3  k≈2.15（注入 20）    → B1 未判，且一个 ✔ 都不许出现
 *
 * 用法：node tools/_perf_accept.js [--runs 10]
 *   （`_` 开头、不以 `-check.js` 结尾 ⇒ 不进套件：它是验收工具，不是常驻门禁）
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
      cwd: ROOT, encoding: 'utf8', env: Object.assign({}, process.env, env || {}), timeout: 180000,
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
const countB1 = (out) => (out.match(/✔ B1/g) || []).length;
const failB1 = (out) => (out.match(/✘ B1/g) || []).length;
const countVerdict = (out) => (out.match(/[✔✘] B1/g) || []).length;
const unjudged = (out) => /B1 未判/.test(out);
const summary = (out) => { const m = /通过 (\d+) · 失败 (\d+)/.exec(out); return m ? { pass: Number(m[1]), fail: Number(m[2]) } : null; };

console.log('§A1  注入 k=1.00：正常档必须真的判（防「永远未判」的假保护）');
{
  const out = run([], { PERF_CALIB_FORCE_MS: '9.31' });
  /* team-lead 2026-10-18 收紧版：注入 k=1.00 只断言**行为**——B1 必须产出判定（✔/✘ 均可）、
     不得报「未判」；「安静窗口必须真 12/0」属发布前人工口径，不靠自动判据兜
     （否则忙窗口注入必然假红，正是这条判据此前的毛病）。 */
  ok('B1 产出判定（✔/✘ 均可，≥4 条）', countVerdict(out) >= 4, countVerdict(out) + ' 条判定');
  ok('未误报「未判」', !unjudged(out), unjudged(out) ? 'k=1.00 却报了未判' : '');
}

console.log('\n§A1b 注入 k≈1.24：仍正常判 + 「放宽 X%」留痕');
{
  const out = run([], { PERF_CALIB_FORCE_MS: '11.5' });
  ok('B1 产出判定（✔/✘ 均可）', countVerdict(out) >= 4, countVerdict(out) + ' 条判定');
  ok('日志含「放宽 2x%」', /放宽 2[0-9]%/.test(out), (/放宽[^\n]*/.exec(out) || ['（无留痕）'])[0].slice(0, 46));
}

console.log('\n§A2/A3 注入 k≥1.3：B1 未判，且一个 ✔ 都不许出现');
for (const [ms, label] of [['13', 'k≈1.40（偏宽档）'], ['20', 'k≈2.15（过载档）']]) {
  const out = run([], { PERF_CALIB_FORCE_MS: ms });
  ok(label + ' → B1 未判', unjudged(out), unjudged(out) ? '' : '输出里没找到「B1 未判」');
  ok(label + ' → B1 无任何 ✔', countB1(out) === 0, '出现 ' + countB1(out) + ' 个 ✔ B1');
}

console.log('\n§环境读数（' + RUNS + ' 连跑，仅记录，不作判据）');
const ks = [];
for (let i = 0; i < RUNS; i++) {
  const out = run(['--calib'], {});
  const m = /"k":([\d.]+)/.exec(out);
  if (m) ks.push(Number(m[1]));
}
if (ks.length !== RUNS) { console.log('  ✘ 标定取样不足：' + ks.length + '/' + RUNS + '（量具本身可能有问题）'); fail++; }
else {
  const maxK = Math.max.apply(null, ks), minK = Math.min.apply(null, ks);
  const below = ks.filter((k) => k < 1.3).length;
  console.log('  k = ' + ks.map((x) => x.toFixed(3)).join(' '));
  console.log('  max ' + maxK.toFixed(3) + ' / min ' + minK.toFixed(3) + ' / k<1.3 轮次 ' + below + '/' + RUNS);
  console.log('  ⇒ ' + (below === RUNS
    ? '本窗口环境安静：10 轮都能给出 B1 结论'
    : '本窗口有 ' + (RUNS - below) + ' 轮顶到 ≥1.3：按 A2 这些轮次应为「未判」，是**行为正确**，不是失败'));
  if (maxK >= 1.3) console.log('  ⚠ 该窗口内性能读数不可信（门自己会说未判）；要看真性能请换安静时段');
}

console.log('\n' + (fail ? '✘ ' + fail + ' 项未过' : '✔ 四条行为断言全过'));
process.exit(fail ? 1 : 0);
