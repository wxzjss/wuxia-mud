#!/usr/bin/env node
/* ==========================================================================
 *  tools/run-regression.js —— 统一回归入口
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本：
 *    以前回归是「各自跑各自」，全量跑一次靠人记一串命令，漏跑没人知道。
 *    这项目为漏跑出过事：某个守卫其实天天在红，因为没人跑它。
 *    所以这个脚本只做一件事 —— 把 tools 下所有 smoke-* 与 *-check 收进来，
 *    并发跑、逐套计时、只认退出码，末尾给一份能直接贴进报告的清单。
 *
 *  用法：
 *    node tools/run-regression.js                 # 全量
 *    node tools/run-regression.js --only map      # 只跑名字里带 map 的
 *    node tools/run-regression.js --concurrency 2 # 降并发（想让别的测量更干净时用）
 *    node tools/run-regression.js --timeout 180   # 放宽单套超时（秒）
 *
 *  判定口径（重要）：
 *    **只认退出码**。脚本打了多少行日志、最后有没有写「通过」两个字都不算数，
 *    退出码 0 才是通过。这是全项目回归的统一口径。
 *
 *  收纳规则：只收 `smoke-*\.js` 与 `*-check\.js`。所以「造出来但还没稳定」的守卫
 *    请用别的后缀（如 `-guard.js`），稳定后再改名进回归，别让半成品污染门禁。
 *    ⚠️ 改名进门禁前**先确认两件事**，否则等于挂个摆设：
 *      1. 名字有没有撞车（tools/identity-check.js 早已存在且在跑，
 *         归属守卫只能另取 identity-belonging-check.js）；
 *      2. 默认运行会不会永远退出 0 —— 永远退 0 的守卫比没有守卫更坏，
 *         因为它不拦任何东西却让人以为拦住了（归属守卫的门禁判定见
 *         文件头「门禁口径」与自测第 10 组）。
 *    ⚠️ 第 2 条是**门禁版铁律**（团队长 2026-10-12 并列记下）：
 *      铁律原文是「断言恒真的自测比没有自测更坏」；
 *      它的门禁版是「**永远退 0 的守卫比没有守卫更坏**」。
 *      红比绿安全 —— 红至少有人来看，永远绿是让人以为有人在看。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const TOOLS = __dirname;
const ROOT = path.dirname(TOOLS);
const TAIL_KEEP = 64 * 1024; // 只留最后 64KB 输出，失败时够看，全量跑也不吃内存

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
}

const CONCURRENCY = Math.max(1, parseInt(argOf('concurrency'), 10) || 4);
const TIMEOUT_MS = Math.max(5, parseInt(argOf('timeout'), 10) || 120) * 1000;
const ONLY = argOf('only');

/* ⚠️ 单套超时分级（2026-10-13，团队长派单）：默认 120s 对绝大多数套件绰绰有余，
   但 perf 系要真起服务 + 连走 3 轮 × 300 步，机器稍忙就往 120s 上撞 ——
   被超时杀掉的红是「测了半截」的红，比慢更糟。给它们单独放宽到 240s。
   全量整体约 11 分钟不受影响（放宽的是上限，不是实际耗时）。
   ⚠️ 只放宽「确实量得久」的套件；别把整个默认值抬上去 ——
   默认 120s 本身是个哨兵：谁写了死循环，两分钟就该有人知道。 */
const SUITE_TIMEOUT_S = {
  'perf-step-check.js': 240,
  'perf-map-check.js': 240,
};
const timeoutMsOf = (file) =>
  (SUITE_TIMEOUT_S[file] ? Math.max(SUITE_TIMEOUT_S[file], 5) * 1000 : TIMEOUT_MS);

const SUITES = fs
  .readdirSync(TOOLS)
  .filter((f) => /^(smoke-.*|.*-check)\.js$/.test(f))
  .filter((f) => (ONLY ? f.includes(ONLY) : true))
  .sort();

/* ⚠️ 准备步骤：**必须在正片之前串行跑完**。
   `mirror-sync`（renderer → public 单向同步）排在 `mirror-check` 之前，是刻意的：
     · 同步后再检查 ⇒ 「改到一半」这种瞬时状态**根本不会红**（本来就先被同步掉了）；
     · 而「改了源忘了 cp」会被 sync **自动纠正**，check 只负责确认纠正成功了。
   于是这一对从「发现问题的守卫」变成「先修后验」，回归不再因为「谁手抖少 cp 一次」
   整轮飘红 —— 那种红是噪声，会把真正的回归信号埋掉。
   ⚠️ 它不匹配 `smoke-*` / `*-check` 命名，不会被当成正片套件重复跑一次。 */
const PREPARE = ['mirror-sync.js'].filter((f) => fs.existsSync(path.join(TOOLS, f)));

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-reg-'));

function tailOf(buf) {
  const s = buf.toString('utf8');
  return s.length > TAIL_KEEP ? s.slice(s.length - TAIL_KEEP) : s;
}

function runOne(file, idx) {
  return new Promise((resolve) => {
    // 每套独立存档目录 —— 存档互相污染是这项目踩过的坑
    const saveDir = path.join(TMP_ROOT, 'saves-' + idx);
    const siteDir = path.join(TMP_ROOT, 'site-' + idx);
    fs.mkdirSync(saveDir, { recursive: true });
    fs.mkdirSync(siteDir, { recursive: true });

    const t0 = Date.now();
    let out = Buffer.alloc(0);
    const keep = (chunk) => {
      out = Buffer.concat([out, chunk]);
      if (out.length > TAIL_KEEP) out = out.slice(out.length - TAIL_KEEP);
    };

    let child;
    try {
      child = spawn(process.execPath, [path.join(TOOLS, file)], {
        cwd: ROOT,
        env: Object.assign({}, process.env, { WX_SAVE_DIR: saveDir, WX_SITE_DATA: siteDir }),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (e) {
      resolve({ file, ok: false, ms: 0, note: '启动失败: ' + e.message, tail: '' });
      return;
    }

    let settled = false;
    const limitMs = timeoutMsOf(file);
    const finish = (ok, note) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ file, ok, ms: Date.now() - t0, note: note || '', tail: ok ? '' : tailOf(out) });
    };

    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch (_) { /* 已经退了就算了 */ }
      finish(false, '超时 ' + limitMs / 1000 + 's 被中断');
    }, limitMs);

    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', (e) => finish(false, '启动失败: ' + e.message));
    child.on('close', (code) => finish(code === 0, code === 0 ? '' : '退出码 ' + code));
  });
}

(async () => {
  if (!SUITES.length) {
    console.error('没有匹配到任何回归脚本' + (ONLY ? '（--only ' + ONLY + '）' : '') + '。');
    process.exit(1);
  }

  const t0 = Date.now();
  console.log('回归入口：' + SUITES.length + ' 套 · 并发 ' + CONCURRENCY + ' · 单套超时 '
    + TIMEOUT_MS / 1000 + 's（perf 系 ' + Object.keys(SUITE_TIMEOUT_S).join('/') + ' 放宽到 240s）');
  console.log('隔离目录：' + TMP_ROOT);

  /* ---- 工作区改动计数：跑之前记一次，跑完再记一次 ----
     团队长提的：**数字掉了说明有人在回归期间撤了别人的改动**（被 git checkout 还原过两次）。
     取舍：只在「只减不增」时打 ⚠，**不判红** —— 回归期间有人正常提交也会让它掉，
     判红会造一个跟内容无关的假红，那比不报更糟。拿不到 git 就明说跳过。 */
  /* ⚠️ 必须用**异步 spawn**：本环境实测 spawnSync 被整体拦住
     （spawnSync('cmd',['/c','echo','hi']) 都 EBUSY），同步接口一个都跑不起来；
     异步 spawn('git',…) 正常。写同步就永远只打印「跳过」，等于挂个摆设。 */
  const dirtyCount = () => new Promise((resolve) => {
    let child;
    try { child = spawn('git', ['status', '--porcelain'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ n: null, why: '调用 git 抛异常：' + e.message }); }
    let so = '', se = '', settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.stdout.on('data', (d) => { so += d; });
    child.stderr.on('data', (d) => { se += d; });
    child.on('error', (e) => done({ n: null, why: '调用 git 失败：' + (e.code || e.message) }));
    child.on('close', (code) => {
      if (code !== 0) return done({ n: null, why: 'git status 退出码 ' + code });
      done({ n: String(so).split('\n').filter((x) => x.trim()).length, why: null });
    });
  });
  const dirty0 = await dirtyCount();
  if (dirty0.n === null) console.log('工作区改动计数：跳过（' + dirty0.why + '）');
  else console.log('工作区改动计数（跑之前）：' + dirty0.n + ' 项');
  console.log('');

  /* ---- 准备步骤：串行，先于所有套件 ---- */
  if (PREPARE.length) {
    console.log('准备步骤（串行）：' + PREPARE.join(', '));
    for (const f of PREPARE) {
      const r = await runOne(f, 'prep-' + f);
      console.log('  [' + (r.ok ? ' OK ' : 'FAIL') + '] ' + f + '  ' + (r.ms / 1000).toFixed(1) + 's'
        + (r.note ? '  ← ' + r.note : ''));
      if (!r.ok) {
        /* 准备步骤挂了 ⇒ 后面的判定已经不可信（比如副本没同步上，
           check 会在「不知道自己在验什么」的情况下跑完）。直接红，别含糊。 */
        console.error('\n准备步骤失败，回归中止：' + f + '\n' + r.tail);
        process.exit(1);
      }
    }
    console.log('');
  }

  const results = new Array(SUITES.length);
  let cursor = 0;
  let running = 0;

  /* ⚠️ 独占套件：轮到它时**必须四下无人**。
     原因（2026-10-12 实测）：`perf-step-check.js` 量的是**服务端延迟百分位**，
     并发 4 的时候它旁边还有 3 个套件在吃 CPU —— 别人的负载被算进它的 p95/max，
     于是出现「今天什么都没改、perf 却红了」的假警报
     （并发下 B1 p95 > 8 ms / max > 25 ms；同一台机器单独跑是 4.64 ms / 9.95 ms）。
     体积类门禁（B2–B5、B9）不受并发影响，但 B1 那条守的是延迟，必须独占。
     ⇒ 处理：轮到独占套件时先把正在跑的放完，它自己跑完再开下一批。 */
  const EXCLUSIVE = new Set(['perf-step-check.js']);

  await new Promise((resolveAll) => {
    const launch = () => {
      while (running < CONCURRENCY && cursor < SUITES.length) {
        /* 下一个是独占套件 ⇒ 等场上清空；清空后只启动它一个，让 while 自然退出 */
        if (EXCLUSIVE.has(SUITES[cursor]) && running > 0) return;
        const i = cursor++;
        running++;
        runOne(SUITES[i], i).then((r) => {
          results[i] = r;
          running--;
          console.log(
            '[' + (r.ok ? ' OK ' : 'FAIL') + '] ' + String(i + 1).padStart(3) + '/' + SUITES.length + '  ' +
            r.file + '  ' + (r.ms / 1000).toFixed(1) + 's' + (r.note ? '  ← ' + r.note : '')
          );
          if (cursor < SUITES.length) launch();
          else if (running === 0) resolveAll();
        });
      }
    };
    launch();
  });

  const failed = results.filter((r) => !r.ok);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log('='.repeat(66));
  console.log(
    '通过 ' + (results.length - failed.length) + ' / 失败 ' + failed.length +
    ' / 共 ' + results.length + ' 套 · 耗时 ' + secs + 's'
  );
  if (failed.length) {
    console.log('');
    console.log('失败清单：');
    failed.forEach((r) => console.log('  - ' + r.file + (r.note ? '  ' + r.note : '')));
    console.log('');
    console.log('失败套次的末尾输出（每套最多 20 行）：');
    failed.forEach((r) => {
      console.log('---- ' + r.file + ' ----');
      const lines = r.tail.trim().split(/\r?\n/);
      console.log(lines.slice(-20).map((l) => '  ' + l).join('\n'));
    });
  }
  if (dirty0.n !== null) {
    const dirty1 = await dirtyCount();
    if (dirty1.n === null) console.log('工作区改动计数（跑之后）：拿不到（' + dirty1.why + '）');
    else if (dirty1.n < dirty0.n) {
      console.log('⚠ 工作区改动从 ' + dirty0.n + ' 项降到 ' + dirty1.n + ' 项 —— 有人在回归期间撤了改动。'
        + '\n  先确认不是自己刚提交的；若是没有人动过，按「被还原」处理：'
        + '\n  node tools/prune-test-npc.js && node tools/git-revert-guard-check.js');
    } else {
      console.log('工作区改动计数（跑之后）：' + dirty1.n + ' 项（不比跑之前少）');
    }
  }
  console.log('='.repeat(66));

  try { fs.rmSync(TMP_ROOT, { recursive: true, force: true }); } catch (_) { /* 临时目录清不掉不碍事 */ }
  process.exit(failed.length ? 1 : 0);
})();
