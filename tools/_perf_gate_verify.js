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
  console.log('V1 环境档位自洽（本窗口若安静→必须真判；连续忙→跳过，由 V3 双基线确定性覆盖）');
  let judgedOk = false, anyJudgeable = false;
  for (let i = 1; i <= 3 && !judgedOk; i++) {
    const r = perfRun([]);
    console.log('    第' + i + '次：k=' + r.k + '（kCpu ' + r.kCpu + ' / kIo ' + r.kIo + '）· ✔B1=' + r.b1ok + ' · 失败=' + r.fail + (r.unjudged ? ' · 未判' : ''));
    ok('  第' + i + '次 一致性', invariantOk(r), 'k=' + r.k + ' 与档位不自洽');
    if (r.k !== null && r.k < 1.3) {
      anyJudgeable = true;
      if (!r.unjudged && r.b1ok >= 5 && r.fail === 0) judgedOk = true;
    }
    if (!judgedOk) await sleep(1200);
  }
  if (anyJudgeable) {
    ok('出现可判定轮次时：B1 真判且 0 失败', judgedOk, '有 k<1.3 的轮次却没拿到全过');
  } else {
    console.log('  ⚠ 本窗口 3 次全部 k≥1.3（机器忙）：按规则应为「未判」，此处跳过；'
      + '「正常档能判」由 V3「双基线」确定性证明，不靠环境碰运气');
  }

  console.log('\nV2 忙窗：起 2 个忙循环（8s）→ 档位自洽（k≥1.3 必「未判」零 ✔ B1；k<1.3 必出判定）');
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
  /* ⚠️ 这里不再断言「kIo ≥ kCpu」——io 探针自身噪声 ±10%，忙窗首跑会读到 kIo 0.96 < kCpu 1.13 而假红
     （2026-10-18 程序实测指出）。kCpu/kIo 只作读数打印；"io 高了就该未判"由下面 V3 的双注入确定性证明。 */

  console.log('\nV3 双注入钉档位（CPU + IO 同时钉住 → 档位确定性可复现）');
  {
    const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', '_perf_baseline.json'), 'utf8'));
    const refCpu = Number(b.calibration.ms), refIo = Number(b.calibration.ioMs);
    const cases = [
      { cpu: refCpu, io: refIo, wantK: 1.00, tier: '正常', label: '双基线' },
      { cpu: refCpu, io: Math.round(refIo * 1.55), wantK: 1.55, tier: '未判', label: 'io×1.55' },
      { cpu: Math.round(refCpu * 1.40), io: refIo, wantK: 1.40, tier: '未判', label: 'cpu×1.40' },
      { cpu: Math.round(refCpu * 2.15), io: refIo, wantK: 2.15, tier: '未判', label: 'cpu×2.15' },
    ];
    for (const c of cases) {
      const r = perfRun([], { PERF_CALIB_FORCE_MS: String(c.cpu), PERF_IO_FORCE_MS: String(c.io) });
      console.log('    ' + c.label + ' → k=' + r.k + '（kCpu ' + r.kCpu + ' / kIo ' + r.kIo + '）· '
        + (r.unjudged ? '未判' : '判了(' + r.b1ok + '✔/' + r.b1fail + '✘)'));
      ok(c.label + '：k 命中 ' + c.wantK.toFixed(2), r.k !== null && Math.abs(r.k - c.wantK) < 0.04, '实测 k=' + r.k);
      if (c.tier === '正常') {
        ok(c.label + '：正常档必须真判且 13/0', !r.unjudged && r.b1ok >= 5 && r.fail === 0,
          '未判=' + r.unjudged + ' ✔=' + r.b1ok + ' 失败=' + r.fail);
      } else {
        ok(c.label + '：必须未判且零 ✔ B1', r.unjudged && r.b1ok === 0, '未判=' + r.unjudged + ' ✔=' + r.b1ok);
      }
    }
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
