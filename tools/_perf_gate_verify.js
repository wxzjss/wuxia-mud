#!/usr/bin/env node
/**
 * _perf_gate_verify.js —— perf 门一键复验（k_io 落地后的版本）
 *
 * 核心思想：**判据必须是"不变量"，不是"读数"**。本机环境会抖，读数断言早晚假红。
 * 验两件事：
 *   ① 一致性不变量：k 与档位自洽 —— k<1.3 必出判定；k≥1.3 必「未判」且零 ✔ B1
 *   ② 能力不退化：安静窗口必须**真判**（B1 ✔≥5 且 0 失败），防"永远未判"的假保护
 *
 * 注意（k_io 落地后）：`PERF_CALIB_FORCE_MS` 只钉住 kCpu，最终 `k=max(kCpu,kIo)`，
 * 所以"注入 k=1.00"不再等于 k=1.00。要硬钉档位，需要对称的 `PERF_IO_FORCE_MS`
 * （已向程序申请）；未落之前，注入用例验的是"一致性 + 档位语义"，不是固定结论。
 *
 * V1 静窗真判（最多 3 次）｜V2 忙窗｜V3 注入一致性｜V4 套件只判体积
 * 用法：node tools/_perf_gate_verify.js
 * `_` 开头、不以 `-check.js` 结尾 ⇒ 不进套件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync, spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

let fail = 0;
const ok = (name, cond, extra) => { console.log((cond ? '  ✔ ' : '  ✘ ') + name + (!cond && extra ? '  ' + extra : '')); if (!cond) fail++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const perfRun = (args, env) => {
  let out = '';
  try {
    out = execFileSync(NODE, [path.join(ROOT, 'tools', 'perf-step-check.js')].concat(args || []), {
      cwd: ROOT, encoding: 'utf8', timeout: 180000, env: Object.assign({}, process.env, env || {}),
    });
  } catch (e) { out = String((e && e.stdout) || '') + String((e && e.stderr) || ''); }
  const k = (/环境标定\s+k=([\d.]+)/.exec(out) || [])[1];
  const summary = /通过 (\d+) · 失败 (\d+)/.exec(out);
  return {
    raw: out,
    k: k ? Number(k) : null,
    kCpu: (/kCpu ([\d.]+)/.exec(out) || [])[1],
    kIo: (/kIo ([\d.]+)/.exec(out) || [])[1],
    b1ok: (out.match(/✔ B1/g) || []).length,
    b1fail: (out.match(/✘ B1/g) || []).length,
    unjudged: /B1 未判/.test(out),
    pass: summary ? Number(summary[1]) : null,
    fail: summary ? Number(summary[2]) : null,
  };
};

/** 一致性不变量：k 与档位自洽 */
const invariantOk = (r) => {
  if (r.k === null) return false;
  return r.k >= 1.3 ? (r.unjudged && r.b1ok === 0) : !r.unjudged;
};

(async () => {
  console.log('V1 静窗：必须真判（最多试 3 次，任一次 B1 ✔≥5 且 0 失败即算过）');
  let judgedOk = false;
  for (let i = 1; i <= 3 && !judgedOk; i++) {
    const r = perfRun([]);
    console.log('    第' + i + '次：k=' + r.k + '（kCpu ' + r.kCpu + ' / kIo ' + r.kIo + '）· ✔B1=' + r.b1ok + ' · 失败=' + r.fail + (r.unjudged ? ' · 未判' : ''));
    ok('  第' + i + '次 一致性', invariantOk(r), 'k=' + r.k + ' 与档位不自洽');
    if (!r.unjudged && r.b1ok >= 5 && r.fail === 0) judgedOk = true;
    else await sleep(1200);
  }
  ok('静窗：B1 真判且 0 失败', judgedOk, '3 次都没拿到"真判 + 全过"');

  console.log('\nV2 忙窗：起 2 个忙循环（8s）→ k≥1.3 应「未判」零 ✔ B1；kIo 应不低于 kCpu');
  const spinners = [];
  for (let i = 0; i < 2; i++) {
    spinners.push(spawn(NODE, ['-e', 'const t=Date.now()+8000;let x=0;while(Date.now()<t){x=(x+2654435761)>>>0;x^=x>>>13;}'], { stdio: 'ignore' }));
  }
  await sleep(1000);
  const busy = perfRun([]);
  spinners.forEach((s) => { try { s.kill('SIGKILL'); } catch (e) { /* ignore */ } });
  await sleep(1200);
  console.log('    k=' + busy.k + '（kCpu ' + busy.kCpu + ' / kIo ' + busy.kIo + '）· ' + (busy.unjudged ? '未判' : '判了') + ' · ✔B1=' + busy.b1ok + ' · 失败=' + busy.fail);
  ok('忙窗 一致性（k≥1.3→未判零 ✔）', invariantOk(busy), 'k=' + busy.k + ' 与档位不自洽');
  if (busy.kCpu !== null && busy.kIo !== null) {
    ok('忙窗 kIo ≥ kCpu（I/O 探针更敏感）', Number(busy.kIo) >= Number(busy.kCpu) - 0.02, 'kCpu ' + busy.kCpu + ' vs kIo ' + busy.kIo);
  }

  console.log('\nV3 注入：验一致性 + kCpu 被钉住（k 由 kIo 决定，不断言固定结论）');
  for (const [ms, label] of [['9.31', 'kCpu=1.00'], ['13', 'kCpu≈1.40'], ['20', 'kCpu≈2.15']]) {
    const r = perfRun([], { PERF_CALIB_FORCE_MS: ms });
    console.log('    ' + label + ' → k=' + r.k + '（kCpu ' + r.kCpu + ' / kIo ' + r.kIo + '）· ' + (r.unjudged ? '未判' : '判了(' + r.b1ok + '✔/' + r.b1fail + '✘)'));
    ok(label + ' 一致性', invariantOk(r), 'k=' + r.k + ' 与档位不自洽');
    ok(label + ' kCpu 被钉住', Number(r.kCpu) === 1 || Math.abs(Number(r.kCpu) - Number(ms) / 9.31) < 0.02, 'kCpu ' + r.kCpu);
    if (r.unjudged) ok(label + ' 未判时零 ✔ B1', r.b1ok === 0, r.b1ok + ' 个');
  }

  console.log('\nV4 套件模式：只判体积、不判延迟');
  {
    const r = perfRun(['--suite']);
    ok('--suite 无 ✔/✘ B1', r.b1ok === 0 && r.b1fail === 0, '✔' + r.b1ok + '/✘' + r.b1fail);
    ok('--suite 有明确跳过说明', /B1 延迟门跳过/.test(r.raw), '未看到跳过说明');
    ok('--suite 体积门全过', r.fail === 0, '失败 ' + r.fail);
    const reg = fs.readFileSync(path.join(ROOT, 'tools', 'run-regression.js'), 'utf8');
    ok('run-regression 给 perf 传 --suite', /suiteArgs\.push\('--suite'\)/.test(reg));
  }

  console.log('\n' + (fail ? '✘ ' + fail + ' 项未过' : '✔ 全部通过'));
  process.exit(fail ? 1 : 0);
})();
