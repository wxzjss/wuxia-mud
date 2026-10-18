#!/usr/bin/env node
/* ==========================================================================
 *  tools/perf-step-check.js —— 单步性能门禁（P0 止血批次）
 *  --------------------------------------------------------------------------
 *  为什么要这个脚本：
 *    「点按钮卡半秒」这类性能问题，**代码看着改对了不等于真的瘦了**。
 *    单步回包里塞了整张地图（300 KB），只要哪天有人在 `engine.view()` 上
 *    少写一个 `{ map: false }`，或者给 `/api/save` 的回包顺手加个 `view:`，
 *    体积一夜回到解放前，而**没有任何测试会红** —— 因为没人量过。
 *    这个脚本就是把「神话」变成「读数」：每一步都量，超阈值直接退出非 0。
 *
 *  怎么量（关键：**走真 HTTP，不走内存调用**）：
 *    内存里直接调 `engine.exec()` 量不到三样东西 —— JSON.stringify 的真实耗时、
 *    `server/game-server.js` 里 json() 的 gzip（level 5）实际压缩率、
 *    以及回包在链路上的真实字节数。所以这里**真起一个服务**（随机端口 +
 *    `WX_SAVE_DIR` 隔离），用真 HTTP 请求打，读真回包：
 *      · 服务端开了 gzip → 回包原始字节 = gunzip(buffer).length（**逐字节精确**）
 *      · 服务端没开 gzip（包 < 1 KB）→ 用**同一个 level 5** 自己压一遍估算
 *
 *  覆盖门禁（同行ム阈值，超了 exitCode=1）：
 *    B1 单步服务端延迟     p95 ≤ 8 ms、max ≤ 25 ms（⚠️ 走**三轮取最快**，见 §2 那条长注）
 *                         ⚠️ 这两个阈值是**在机器安静时**定的。它们分不清
 *                            「代码变慢」和「机器变慢」：本机 CPU 均值 74% 时，
 *                            p50 只慢 7%（3.86→4.12），p95 却慢 83%（4.64→8.51）。
 *                            ⇒ 读 B1 之前**先看输出里那行「三轮 p95 极差」**：
 *                              极差小 = 读数可信；极差大 = 本机负载不稳，这只是趋势。
 *    B2 /api/exec 回包     ≤ 32 KB 原始 / ≤ 12 KB gzip
 *    B3 单步下行总量       ≤ 40 KB 原始 / ≤ 15 KB gzip（本地化后 = exec 单包；存档移出每步路径）
 *    B4 /api/save 回包     ≤ 400 KB（本地化后 = 快照交付物本体，客户端要落 localStorage）
 *    B9 boot+newGame+300 步后 heapUsed ≤ 120 MB、rss ≤ 200 MB
 *    B1-p50 单步 p50       ≤ 6 ms 硬判 + ≤ 修前 × 1.5（2026-10-13 新增，见 LIMIT 注）
 *
 *  ⚠️ 2026-10-13 抽仓：地图下发类断言（B5 组、exec/save 的下发内容断言）
 *     整体搬去了 tools/perf-map-check.js —— 它们是体积断言，不受机器负载影响，
 *     没必要跟着 B1 一起独占时段。本文件只留延迟与通用体积。搬走 ≠ 删掉，
 *     那边一条不少，且多了「≤ 修前 × 0.5」的比值保险栓（_perf_baseline.json）。
 *
 *  用法：node tools/perf-step-check.js [步数]      （默认 300 步）
 * ========================================================================== */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* --- 测试隔离：存档 / 站点数据一律落到临时目录，绝不碰玩家真档 --- */
const TMPROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'wx-perf-'));
process.env.WX_SAVE_DIR = path.join(TMPROOT, 'saves');
process.env.WX_SITE_DATA = path.join(TMPROOT, 'site-data');
fs.mkdirSync(process.env.WX_SAVE_DIR, { recursive: true });

const STEPS = parseInt(process.argv[2], 10) > 0 ? parseInt(process.argv[2], 10) : 300;
/* --suite（2026-10-18 team-lead 裁定，方案 2）：套件里只判体积门。
   延迟是环境属性、体积是产品属性，混在一个批里会把「机器忙」记成「产品红」。
   发版前单独跑 node tools/perf-step-check.js 判延迟。 */
const SUITE_ONLY = process.argv.indexOf('--suite') >= 0;

/* ==========================================================================
 *  环境负载标定（2026-10-18 门禁口径变更，team-lead 批）
 *  --------------------------------------------------------------------------
 *  病因：B1 的阈值是在**空载机器**上定的，它分不清「代码变慢」和「机器被抢」。
 *        实测同一份代码：空载 p50 3.2 / p95 6.5；6 个并发 node 时 p50 7.6 / p95 15。
 *        这道门因此测的是「机器余量」，不是产品性能。
 *  改法：开跑前做**固定工作量纯计算标定**（热身 1 次 + 3 次取中位），
 *        k = 本次标定 / 基线标定（_perf_baseline.json#calibration.ms）。
 *        B1 四个阈值按 k 缩放（封顶 2.0）：
 *          · 空载 k≈1 → 不放松（不掩盖真回归）
 *          · 并发 k≈1.5–2 → 同比放大，真回归（p50 翻倍级）照样红
 *          · k>2 → 「环境过载·未判」：B1 不进红名单，体积门照常判
 *  标定工作量的口径一旦改动，必须同步重跑 --rebaseline。
 * ========================================================================== */
const CALIB_ITER = 2000000;
const CALIB_MAX_K = 2.0;
function calibOnce() {
  const t0 = process.hrtime.bigint();
  let x = 0;
  for (let i = 1; i <= CALIB_ITER; i++) { x = (x + i * 2654435761) >>> 0; x ^= x >>> 13; }
  const t = Number(process.hrtime.bigint() - t0) / 1e6;
  if (x === 123456789) console.log('');   /* 防 DCE：拿结果做一个永不成立的分支 */
  return t;
}
function calibrate() {
  if (Number(process.env.PERF_CALIB_FORCE_MS) > 0) return Number(process.env.PERF_CALIB_FORCE_MS);
  calibOnce(); calibOnce();                      /* 热身 2 次：第 1 次含 JIT 冷启动 */
  /* 取 5 次中位（2026-10-18 qa 对照实验）：
       2M×3 中位 → 10 次极差 7.3%；2M×5 中位 → 3.3%；8M×3 → 20%（长跑更易被调度打断）。
     所以**加采样次数**而不是加迭代数。多花 ≈40ms，换 k 的稳定性，值。 */
  const a = Array.from({ length: 5 }, () => calibOnce()).sort((x, y) => x - y);
  return a[2];
}
/* ==========================================================================
 *  I/O 标定（2026-10-18 qa 实验：k_cpu 与 p95 相关 r=-0.35，k_io r=0.88）
 *  --------------------------------------------------------------------------
 *  纯计算标定吃 ALU；B1 量的是 JSON.stringify + HTTP 往返，忙机上跌得远比 ALU 狠
 *  （k_cpu=1.28 时 p95 +150%）。所以负载系数取 max(k_cpu, k_io)，k_io 用
 *  「固定次数读 data json + JSON.parse」——约等于一次 view/exec 回包的真实工作量。
 *  ⚠️ 基线 ioMs 必须在**安静窗口** --rebaseline 写入；本机忙时测会让基准虚高、
 *     以后忙窗口反而报 k_io≈1（门失效）。没写 ioMs 前 k_io 按 1，并在输出里明说。
 * ========================================================================== */
const IO_FILES = ['20_items.json', '87_persona.json', '101_classic_npcs.json'];
const IO_REPS = 20;   /* 单次采样内重复 20 轮：io 工作量 ~30ms，信噪比够；5 次中位 ≈150ms */
function ioOnce() {
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (let r = 0; r < IO_REPS; r++) {
    for (const f of IO_FILES) {
      const t = fs.readFileSync(path.join(ROOT, 'game', 'data', f), 'utf8');
      JSON.parse(t);
      bytes += t.length;
    }
  }
  if (bytes === 123456789) console.log('');
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
const ioForceEnv = () => Number(process.env.PERF_IO_FORCE_MS) > 0 ? Number(process.env.PERF_IO_FORCE_MS)
  : (Number(process.env.PERF_CALIB_IO_FORCE_MS) > 0 ? Number(process.env.PERF_CALIB_IO_FORCE_MS) : 0);
function calibrateIO() {
  const f = ioForceEnv();
  if (f > 0) return f;
  ioOnce();
  /* 9 次中位（2026-10-18 qa 实测）：io 探针受杀软/缓存影响，5 次基线会偏低 ~10%，门偏严。 */
  const a = Array.from({ length: 9 }, () => ioOnce()).sort((x, y) => x - y);
  return a[4];
}
const IO_MS = SUITE_ONLY ? 0 : (ioForceEnv() > 0 ? ioForceEnv() : calibrateIO());

/* 自测口：PERF_CALIB_FORCE_MS 强制标定值（仅用于演示 k>2 的环境过载分支）。 */
const CALIB_MS = SUITE_ONLY ? 0
  : (Number(process.env.PERF_CALIB_FORCE_MS) > 0
    ? Number(process.env.PERF_CALIB_FORCE_MS)
    : calibrate());

/* ---- 阈值（bytes）。KB 按 1024 记，与服务端 Content-Length 同口径 ---- */
const KB = 1024;
const LIMIT = {
  /* p50 硬判阈值 6 ms 怎么定的（2026-10-13，严过关，口径注明）：
     本机实测 p50 安静时 3.59–3.81 ms（tools/_re_perf.txt 三轮），本机 CPU 74% 时 4.12 ms
     —— p50 对负载最钝（+7%），拿它做硬判最不容易「机器慢了就假红」。
     6 ms = 实测最差非回归读数的 +55%：日常抖动够不着，真回归
     （比如给单步加一次同步写盘）p50 一动就是翻倍级，照样红。 */
  stepP50Ms: 6,
  /* 比值门（主人裁「A + 比值」）：p50 ≤ 修前 × 1.5。修前 = P0 止血前快照
     a369125 实测 p50 3.89 ms（_perf_baseline.json）。1.5×=5.84 ms，与绝对门 6 ms
     互为保险：绝对门守「任何时候不许慢过 6」，比值门守「不许涨过修前五成」。
     P0 修复对延迟几乎没动（3.89→3.79），比值门在这里是防恶化，不是防回吐。 */
  stepP95Ms: 8,
  stepMaxMs: 25,
  execRaw: 32 * KB,
  execGzip: 12 * KB,
  stepDownRaw: 40 * KB,
  stepDownGzip: 15 * KB,
  /* B4（存档本地化 2026-10-18 重口径）：/api/save 回包 = 整份世界快照正文，
     是要交给客户端落 localStorage 的**交付物**（修前 2 KB 门是「磁盘写、回轻包」
     时代的产物，随本地化作废）。门定 400 KB：早期档实测 ~120 KB，
     后期大档（含 mods/任务/关系网，参照老 saves/ 档 254 KB）也须留足余量，
     同时防「快照把地图/日志整段塞进来」那种失控膨胀。 */
  saveRaw: 400 * KB,
  newLoadRaw: 40 * KB,
  heapUsed: 120 * 1024 * 1024,
  rss: 200 * 1024 * 1024,
};

/* --- 比值门基线：读不到就明说跳过，比值门不许静默失效（perf-map-check 同款） --- */
let BASE = null;
try { BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '_perf_baseline.json'), 'utf8')); }
catch (e) { /* main 里判空处理 */ }

/* 负载系数 k：本次标定 / 基线标定。基线没记标定值 ⇒ k 按 1，并在输出里明说。 */
const REF_CALIB = BASE && BASE.calibration && Number(BASE.calibration.ms) > 0
  ? Number(BASE.calibration.ms) : null;
const REF_IO = BASE && BASE.calibration && Number(BASE.calibration.ioMs) > 0
  ? Number(BASE.calibration.ioMs) : null;
const K_CPU = REF_CALIB ? (CALIB_MS / REF_CALIB) : 1;
const K_IO = REF_IO ? (IO_MS / REF_IO) : 1;
/* 负载系数 = 两个探针里更差的那个（qa 实验：只测 ALU 会低估忙机 150% 的 HTTP 变慢） */
let RAW_K = SUITE_ONLY ? 1 : Math.max(K_CPU, K_IO);
/* 三档判定（team-lead 最终口径 2026-10-18）：
     k < 1.3        → 按 k 缩放，正常判
     1.3 ≤ k ≤ 2.0  → B1 不判（「负载偏高·B1 未判」），体积门照常
     k > 2.0        → B1 不判（「环境过载·B1 未判」）
   ⚠️ 取消「放宽 1.3 倍后仍判绿」：1.3× 阈值恰好能吞掉 30% 级真回归，
      而「判不了」只是当次没结论，次日空载再跑即可。代价不对等。 */
const B1_WIDE_K = 1.3;
let B1_UNJUDGED = RAW_K >= B1_WIDE_K;
let K = Math.min(B1_WIDE_K, Math.max(1, RAW_K));   /* 机器更快时不收紧；≥1.3 不判，K 仅展示 */
let OVERLOADED = RAW_K > CALIB_MAX_K;

/* --calib：只做标定并打印（量具漂移验收：同一机器连开 N 个进程，看极差）。
   正常门禁不走这里；它不启动服务、不读世界。 */
if (process.argv.indexOf('--calib-io') >= 0) {
  console.log(JSON.stringify({ ioMs: Math.round(IO_MS * 100) / 100, refIoMs: REF_IO, kIo: Math.round(K_IO * 1000) / 1000 }));
  process.exit(0);
}
if (process.argv.indexOf('--calib') >= 0) {
  const tier = RAW_K > CALIB_MAX_K ? '过载未判' : (RAW_K >= B1_WIDE_K ? '偏宽未判' : '正常');
  console.log(JSON.stringify({
    calibMs: Math.round(CALIB_MS * 100) / 100, refMs: REF_CALIB,
    ioMs: Math.round(IO_MS * 100) / 100, refIoMs: REF_IO,
    kCpu: Math.round(K_CPU * 1000) / 1000, kIo: Math.round(K_IO * 1000) / 1000,
    k: Math.round(RAW_K * 1000) / 1000, tier,
  }));
  process.exit(0);
}

/* --rebaseline-io：只重写 I/O 标定值（quiet 窗口专用；不动 CPU 基线）。
   为什么分开：忙时跑 --rebaseline 会把 CPU 基线一起抬高，等于永久放宽。 */
if (process.argv.indexOf('--rebaseline-io') >= 0) {
  const f = path.join(__dirname, '_perf_baseline.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.calibration = j.calibration || {};
  j.calibration.ioMs = Math.round(IO_MS * 100) / 100;
  j.calibration.ioWorkload = 'IO_FILES=' + IO_FILES.join(',') + ' x5 median';
  j.calibration.ioDate = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + String.fromCharCode(10));
  console.log('已重写 I/O 标定：ioMs=' + j.calibration.ioMs + '（' + j.calibration.ioDate + '）');
  process.exit(0);
}
/* --rebaseline：把「基线标定值」重写进 _perf_baseline.json（环境变动/改工作量时才跑）。
   记录的不只是毫秒数，还有工作量口径与日期 —— 以后 k 不可比时能一眼看出为什么。 */
if (process.argv.indexOf('--rebaseline') >= 0) {
  const f = path.join(__dirname, '_perf_baseline.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.calibration = {
    ms: Math.round(CALIB_MS * 100) / 100,
    ioMs: SUITE_ONLY ? undefined : Math.round(IO_MS * 100) / 100,
    k: 1,
    workload: 'CALIB_ITER=' + CALIB_ITER,
    date: new Date().toISOString().slice(0, 10),
    note: '负载系数基准：B1 阈值按 本次标定/此值 缩放（封顶 2.0；>2 判环境过载未判）',
  };
  fs.writeFileSync(f, JSON.stringify(j, null, 2) + String.fromCharCode(10));
  console.log('已重写基线标定：' + JSON.stringify(j.calibration));
  console.log('⚠️ ioMs 只有在安静窗口测才有效；忙时 rebaseline 会让 k_io 永久偏低。');
  process.exit(0);
}

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }
function ms(n) { return n.toFixed(2) + ' ms'; }

/** 百分位（nearest-rank，与常见监控口径一致） */
function pct(sorted, q) {
  if (!sorted.length) return NaN;
  const idx = Math.max(0, Math.ceil((q / 100) * sorted.length) - 1);
  return sorted[Math.min(sorted.length - 1, idx)];
}

/* ================================================================
 *  真 HTTP 客户端
 * ================================================================ */
function request(port, method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: Object.assign(
        { 'Accept-Encoding': 'gzip' },
        payload
          ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length }
          : {}
      ),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const gzipped = (res.headers['content-encoding'] || '') === 'gzip';
        let rawLen, gzLen, text;
        if (gzipped) {
          /* gunzip 出来就是服务端的原始 JSON 字节 —— 长度逐字节精确 */
          text = zlib.gunzipSync(buf).toString('utf8');
          rawLen = Buffer.byteLength(text, 'utf8');
          gzLen = buf.length;
        } else {
          text = buf.toString('utf8');
          rawLen = buf.length;
          gzLen = zlib.gzipSync(buf, { level: 5 }).length;   /* 与服务端同 level */
        }
        let jsonVal = null;
        try { jsonVal = JSON.parse(text); } catch (e) { /* 非 json 时留给断言报错 */ }
        resolve({ status: res.statusCode, rawLen, gzLen, json: jsonVal });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ================================================================
 *  主流程
 * ================================================================ */
async function main() {
  const t0Boot = Date.now();
  const { createServer } = require(path.join(ROOT, 'server', 'game-server.js'));
  const { server, engine } = createServer({});

  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', res);
  });
  const port = server.address().port;
  const bootMs = Date.now() - t0Boot;

  console.log('');
  console.log('  \u250c\u2500 单步性能门禁 ─────────────────────────────────────────');
  console.log('  \u2502 服务 boots ' + ms(bootMs) + ' \u00b7 端口 ' + port + ' \u00b7 步数 ' + STEPS);
  console.log('  \u2502 隔离存档 ' + process.env.WX_SAVE_DIR);
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  let saveId = 'perf_slot';
  try {
    /* ---------------- §1 开局 /api/new（只起局，不再断言） ----------------
       ⚠️ B5 组（回包体积 / view.map / view.player）2026-10-13 搬去
       tools/perf-map-check.js 了，那边一条不少。这里只留起局动作。 */
    const rNew = await request(port, 'POST', '/api/new',
      { name: '测速侠', gender: 'male', birth: 'wuxue' });

    /* ---------------- §2 走 300 步（B1/B2/B3/B4） ---------------- */
    section('  \u00a72 连续 ' + STEPS + ' 步（exec + save 各一次/步）');
    const DIRS = ['n', 's', 'e', 'w', 'n', 'e', 's', 'w'];

    /* ⚠️ 前 WARMUP 步怎么处置 —— **延迟和体积要分开对待**，混着处理会出假象：
         · 延迟：最慢的一步永远是第 1 步，同一份代码连跑三次能跳出 23 / 24 / 37 ms，
           那是 V8 还没把这条路径编译完的冷开销，与被测逻辑无关。让它参与统计的话
           `max ≤ 25 ms` 实际由 JIT 说了算，通过与否靠掷骰子 ⇒ **统计时剔除**。
         · 体积：刚好相反 —— 开局头几步的日志最长（自带房间描述 / 开场引文），
           实测那是整个会话里**最胖**的回包（改前 41.8 KB）。早先我把 warmup 做成
           「正式跑之前先偷偷走 10 步」，等于把这批最胖的回包踢出了统计，
           B2 因此显示得比真实情况好看 ⇒ **必须照记、计入门槛**。
       所以：不预先偷跑；300 步从头开始跑真实会话，只在算延迟时丢掉前 10 步。
       冷启动那一步的延迟照样打出来（藏起来才是不诚实），只是不计入门槛。 */
    const WARMUP = 10;

    /* ⚠️ 跑三轮，延迟取**最快那轮**、体积取**最胖那轮**（2026-10-12 血的教训）：
       B1 量的是**墙上时钟**，它默认「测的时候没别人抢 CPU / 机器没降频」。
       这个默认会失效：同一份代码、同一台机器，安静时 p95 4.64 ms，
       本机 CPU 均值 74% 时跳到 14.66 ms，**p50 也慢了 1.15 倍** ——
       p50 一起慢、尾巴慢得更多，这个形状是**整机变慢**，不是代码变慢。
       绝对阈值分不清这两件事，于是「今天什么都没改、perf 却红了」。
       追两次之后所有人就学会忽略它了 —— 那比没有门禁更糟。

       ⇒ 处理：**污染只会往慢的方向加，不会往快的方向加**，
         所以「三轮里最快那一轮」就是对真值最好的估计（业界通用的 best-of-N）。
         · 延迟：取三轮里 p95 最小的那轮，用它整条分位数判 B1，阈值**一个都没放宽**。
           真回归会让**三轮都变慢**，包括最快的那轮 ⇒ 照样红。
         · 体积：反过来取三轮里**最胖**的那个（体积不受负载影响，取最保守的）。
       三轮的读数全部打印出来，不藏 —— 只挑代表轮判红。 */
    const REPEATS = 3;
    /* 轮间负载采样（team-lead 2026-10-18）：中途起来的负载 pre/post 都看不见，
       每轮结束补采一次，和 pre/post 一起取 max 当 k。每次 ≈40ms，3 轮共 120ms，可接受。 */
    const MID_CALIBS = [];
    const reps = [];

    for (let rep = 0; rep < REPEATS; rep++) {
      /* 第 2 轮起重新开局：否则走的是上一轮留下的世界，回包体积不可比 */
      if (rep > 0) await request(port, 'POST', '/api/new', { name: '测速侠', gender: 'male', birth: 'wuxue' });

      const execTimes = [], saveTimes = [];
      const execRaw = [], execGz = [], saveRaw = [], saveGz = [];
      const downRaw = [], downGz = [];
      /* ⚠️ execHasMap / saveHasView 计数随「下发内容」断言一起搬去 perf-map-check.js 了 */
      let execNoPlayer = 0;
      let firstExecRaw = null, lastExecRaw = null;

      for (let i = 0; i < STEPS; i++) {
        const cmd = DIRS[i % DIRS.length];

        const t1 = process.hrtime.bigint();
        const rExec = await request(port, 'POST', '/api/exec', { cmd });
        const t2 = process.hrtime.bigint();
        if (firstExecRaw === null) firstExecRaw = rExec.rawLen;
        lastExecRaw = rExec.rawLen;
        execTimes.push(Number(t2 - t1) / 1e6);
        execRaw.push(rExec.rawLen); execGz.push(rExec.gzLen);
        if (rExec.json && rExec.json.noPlayer) execNoPlayer++;

        const t3 = process.hrtime.bigint();
        const rSave = await request(port, 'POST', '/api/save', { id: saveId });
        const t4 = process.hrtime.bigint();
        saveTimes.push(Number(t4 - t3) / 1e6);
        saveRaw.push(rSave.rawLen); saveGz.push(rSave.gzLen);

        /* 本地化后（2026-10-18）存档移出「每步下行」：快照由客户端按 30 s 防抖
           +关键节点节流去取（频率归 autosave-throttle-check 管、体积归 B4 管），
           单步下行只算 exec。快照回包不再是每步的负担，而是按需取的交付物。 */
        downRaw.push(rExec.rawLen);
        downGz.push(rExec.gzLen);
      }

      /* 找稳态里最慢那一步的下标 —— 报「max」不报「是第几步」等于没法查：
         是第 1 步（某个重活泄漏到这条路上）还是偶发抖动，处置完全不同。 */
      let argmax = WARMUP;
      for (let i = WARMUP + 1; i < execTimes.length; i++) if (execTimes[i] > execTimes[argmax]) argmax = i;
      const coldMaxMs = Math.max.apply(null, execTimes.slice(0, WARMUP));

      /* ⚠️ 只有**延迟**剔除冷启动，体积全套照算（理由见 WARMUP 处的长注） */
      const sortedT = execTimes.slice(WARMUP).sort((a, b) => a - b);
      reps.push({
        rep,
        execTimes, execRaw, execGz, saveRaw, saveGz, downRaw, downGz,
        execNoPlayer, firstExecRaw, lastExecRaw,
        argmax, coldMaxMs,
        P: {
          p50: pct(sortedT, 50), p90: pct(sortedT, 90), p95: pct(sortedT, 95),
          p99: pct(sortedT, 99), max: sortedT[sortedT.length - 1],
        },
      });
      if (!SUITE_ONLY) MID_CALIBS.push(calibrate());
    }

    reps.forEach((r) => {
      console.log('    第 ' + (r.rep + 1) + ' 轮    p50 ' + ms(r.P.p50) + ' \u00b7 p90 ' + ms(r.P.p90)
        + ' \u00b7 p95 ' + ms(r.P.p95) + ' \u00b7 p99 ' + ms(r.P.p99) + ' \u00b7 max ' + ms(r.P.max));
    });
    /* 代表轮 = p95 最小的那一轮 */
    let best = reps[0];
    reps.forEach((r) => { if (r.P.p95 < best.P.p95) best = r; });
    const jitter = reps.map((r) => r.P.p95);
    const spread = (Math.max.apply(null, jitter) - Math.min.apply(null, jitter));
    console.log('    ── 代表轮：第 ' + (best.rep + 1) + ' 轮（p95 最小）'
      + ' · 三轮 p95 极差 ' + ms(spread)
      + (spread > best.P.p95 * 0.5 ? '  ← 极差过大，本机此刻负载不稳，读数仅供趋势' : ''));

    const b = best;
    console.log('    exec 体积  第1步 ' + kb(b.firstExecRaw) + ' \u00b7 第' + STEPS + '步 ' + kb(b.lastExecRaw)
      + (b.lastExecRaw > b.firstExecRaw ? '  \u2197 \u968f\u6e38\u620f\u8fdb\u5ea6\u589e\u957f' : ''));
    console.log('    稳态最慢  第 ' + (b.argmax + 1) + ' 步 ' + ms(b.execTimes[b.argmax]));
    console.log('    冷启动   前 ' + WARMUP + ' 步最慢 ' + ms(b.coldMaxMs)
      + ' \u00b7 首步 ' + ms(b.execTimes[0]) + '  ← JIT 未热，仅供参考，**不计入门槛**');
    console.log('    （体积统计含全部 ' + STEPS + ' 步 \u00d7 ' + REPEATS + ' 轮，取最胖那轮；'
      + '延迟取 p95 最小那轮，均剔除前 ' + WARMUP + ' 步冷启动）');

    const P_EXEC_MS = b.P;
    /* 体积：三轮里取最胖的那一轮（保守方向） */
    const worst = reps.reduce((acc, r) => {
      const m = Math.max.apply(null, r.execRaw);
      return (!acc || m > acc.m) ? { m, r } : acc;
    }, null).r;
    const sExecRaw = worst.execRaw.slice().sort((a, b2) => a - b2);
    const sDownRaw = worst.downRaw.slice().sort((a, b2) => a - b2);
    const sDownGz = worst.downGz.slice().sort((a, b2) => a - b2);

    console.log('    延迟      p50 ' + ms(P_EXEC_MS.p50) + ' \u00b7 p90 ' + ms(P_EXEC_MS.p90)
      + ' \u00b7 p95 ' + ms(P_EXEC_MS.p95) + ' \u00b7 p99 ' + ms(P_EXEC_MS.p99)
      + ' \u00b7 max ' + ms(P_EXEC_MS.max));
    console.log('    exec 回包 p95 ' + kb(pct(sExecRaw, 95)) + ' \u00b7 max ' + kb(sExecRaw[sExecRaw.length - 1]));
    console.log('    save 回包 p95 ' + kb(pct(worst.saveRaw.slice().sort((a, b2) => a - b2), 95)));
    console.log('    单步下行 p95 ' + kb(pct(sDownRaw, 95)) + ' / ' + kb(pct(sDownGz, 95))
      + ' \u00b7 max ' + kb(sDownRaw[sDownRaw.length - 1]) + ' / ' + kb(sDownGz[sDownGz.length - 1]));

    /* 跑完回看标定（2026-10-18）：夹在中间的突发负载（别的 lane 开跑）
       开跑前那一刻的标定是看不见的。跑完再标一次，取两次里更差的那个当 k——
       这样「跑到一半机器被抢」也会被判成环境过载，而不是记成产品回归。 */
    const POST_CALIB = SUITE_ONLY ? 0 : Math.max.apply(null, [calibrate()].concat(MID_CALIBS.length ? MID_CALIBS : [0]));
    if (POST_CALIB > 0 && REF_IO) {
      /* 跑后也补一次 I/O 采样：忙负载中途起来时 pre 的 io 值看不见 */
      const ioPost = calibrateIO();
      const kIoPost = ioPost / REF_IO;
      if (kIoPost > K_IO) { RAW_K = Math.max(K_CPU, kIoPost); B1_UNJUDGED = RAW_K >= B1_WIDE_K; OVERLOADED = RAW_K > CALIB_MAX_K; }
    }
    const RAW_K_POST = REF_CALIB ? (POST_CALIB / REF_CALIB) : 1;
    if (RAW_K_POST > RAW_K) {
      RAW_K = RAW_K_POST;
      K = Math.min(B1_WIDE_K, Math.max(1, RAW_K));
      B1_UNJUDGED = RAW_K >= B1_WIDE_K;
      OVERLOADED = RAW_K > CALIB_MAX_K;
    }

    /* B1 四个门全部按负载系数 k 缩放（封顶 2.0；k>2 判环境过载、不进红名单）。
       标定明细见文件头 §「环境负载标定」。 */
    if (SUITE_ONLY) {
      console.log('    B1 延迟门跳过（--suite：套件只判体积门；发版前单独跑 node tools/perf-step-check.js）');
    } else {
    console.log('    环境标定  k=' + RAW_K.toFixed(2)
      + (K !== RAW_K ? '（按 ' + K.toFixed(2) + ' 计）' : '')
      + ' · 本次 ' + ms(CALIB_MS) + ' / 轮间 ' + MID_CALIBS.length + ' 次(峰值 ' + ms(POST_CALIB) + ')'
      + (REF_CALIB ? ' / 基线 ' + ms(REF_CALIB) : '（基线缺标定值，k 按 1）')
      + ' · kCpu ' + K_CPU.toFixed(2) + ' / kIo ' + K_IO.toFixed(2)
      + (REF_IO ? '' : '（基线缺 I/O 标定，k_io 按 1）')
      + (!B1_UNJUDGED && K >= 1.2 ? ' · 本机负载偏高，阈值已放宽 ' + Math.round((K - 1) * 100) + '%' : '')
      + (OVERLOADED ? ' · **环境过载：B1 未判**' : ''));
    if (B1_UNJUDGED) {
      /* 1.3≤k≤2.0「偏宽未判」或 k>2.0「过载未判」：只打实测，不判红也不判绿。
         team-lead 裁定：宁可判不了，不许放宽阈值去判绿。 */
      console.log('    B1 单步延迟 \u2014 ' + (OVERLOADED ? '环境过载' : '负载偏高')
        + '·B1 未判（k=' + RAW_K.toFixed(2) + '）：实测 p50 ' + ms(P_EXEC_MS.p50)
        + ' · p95 ' + ms(P_EXEC_MS.p95) + ' · max ' + ms(P_EXEC_MS.max)
        + '；体积门照常判。');
    } else {
      const p95Lim = LIMIT.stepP95Ms * K, maxLim = LIMIT.stepMaxMs * K, p50Lim = LIMIT.stepP50Ms * K;
      ok('B1 单步服务端 p95 ≤ ' + p95Lim.toFixed(1) + ' ms（k=' + K.toFixed(2) + '）',
        P_EXEC_MS.p95 <= p95Lim, ms(P_EXEC_MS.p95));
      ok('B1 单步服务端 max ≤ ' + maxLim.toFixed(1) + ' ms（k=' + K.toFixed(2) + '）',
        P_EXEC_MS.max <= maxLim, ms(P_EXEC_MS.max));
      /* p50 硬判（2026-10-13 新增）：之前 p50 只打日志不判红 —— 只打不判 = 这条数
         没人负责，p50 慢一倍门禁也绿着。阈值推导见 LIMIT.stepP50Ms 的注。 */
      ok('B1 单步服务端 p50 ≤ ' + p50Lim.toFixed(1) + ' ms（硬判·k=' + K.toFixed(2) + '）',
        P_EXEC_MS.p50 <= p50Lim, ms(P_EXEC_MS.p50));
      ok('B1 比值 p50 ≤ 修前 × 1.5 × k（_perf_baseline.json）',
        !!BASE && !!(BASE.pre && BASE.pre.p50Ms) && P_EXEC_MS.p50 <= BASE.pre.p50Ms * 1.5 * K,
        ms(P_EXEC_MS.p50) + ' vs 修前 ' + (BASE && BASE.pre ? BASE.pre.p50Ms : '?') + ' ms × 1.5 × '
          + K.toFixed(2) + (BASE ? '' : '  ← 基线读不到，比值门未生效'));
      /* p95 比值门（2026-10-18 qa 实测补）：原先只有 p50 有比值门，p95 只靠绝对阈值 8ms。
         而绝对阈值对「忙机」最敏感：k=1.28 时纯计算只慢 28%，HTTP p95 却能慢 150%，
         于是「按 28% 放宽去卡 150% 的慢」必假红。比值门用同一轮读数除以修前 p95，
         天然抵消整体变慢——这正是当初给 p50 上比值门的理由。 */
      ok('B1 比值 p95 ≤ 修前 p95 × 1.5 × k（_perf_baseline.json）',
        !!BASE && !!(BASE.pre && BASE.pre.p95Ms) && P_EXEC_MS.p95 <= BASE.pre.p95Ms * 1.5 * K,
        ms(P_EXEC_MS.p95) + ' vs 修前 p95 ' + (BASE && BASE.pre ? BASE.pre.p95Ms : '?') + ' ms × 1.5 × '
          + K.toFixed(2) + (BASE ? '' : '  ← 基线读不到，比值门未生效'));
    }
    }

    const maxExecRaw = sExecRaw[sExecRaw.length - 1];
    const maxExecGz = worst.execGz.slice().sort((a, b2) => a - b2).pop();
    ok('B2 /api/exec 回包 \u2264 ' + kb(LIMIT.execRaw), maxExecRaw <= LIMIT.execRaw,
      'max ' + kb(maxExecRaw));
    ok('B2 /api/exec 回包 gzip \u2264 ' + kb(LIMIT.execGzip), maxExecGz <= LIMIT.execGzip,
      'max ' + kb(maxExecGz));

    const maxDownRaw = sDownRaw[sDownRaw.length - 1];
    const maxDownGz = sDownGz[sDownGz.length - 1];
    ok('B3 单步下行总量 \u2264 ' + kb(LIMIT.stepDownRaw), maxDownRaw <= LIMIT.stepDownRaw,
      'max ' + kb(maxDownRaw));
    ok('B3 单步下行 gzip \u2264 ' + kb(LIMIT.stepDownGzip), maxDownGz <= LIMIT.stepDownGzip,
      'max ' + kb(maxDownGz));

    /* ⚠️ 「B2 complement exec 回包不带地图」「B4 回包不带 view」随下发内容断言
       搬去 perf-map-check.js（M3/M4）。体积统计的取轮口径（最胖轮）不变。 */
    const totNoPlayer = reps.reduce((n, r) => n + r.execNoPlayer, 0);
    const totSteps = STEPS * REPEATS;
    const maxSaveRaw = Math.max.apply(null, reps.map((r) => Math.max.apply(null, r.saveRaw)));
    ok('B4 /api/save 回包 \u2264 ' + kb(LIMIT.saveRaw), maxSaveRaw <= LIMIT.saveRaw, 'max ' + kb(maxSaveRaw));
    ok('前提 ' + totSteps + ' 步全程角色在线', totNoPlayer === 0, totNoPlayer + ' 步 noPlayer');

    /* ---------------- §3 内存（B9） ---------------- */
    section('  \u00a74 内存');
    const mem = process.memoryUsage();
    console.log('    heapUsed ' + (mem.heapUsed / 1048576).toFixed(1) + ' MB \u00b7 rss '
      + (mem.rss / 1048576).toFixed(1) + ' MB \u00b7 heapTotal ' + (mem.heapTotal / 1048576).toFixed(1) + ' MB');
    ok('B9 heapUsed \u2264 120 MB', mem.heapUsed <= LIMIT.heapUsed, (mem.heapUsed / 1048576).toFixed(1) + ' MB');
    ok('B9 rss \u2264 200 MB', mem.rss <= LIMIT.rss, (mem.rss / 1048576).toFixed(1) + ' MB');

    if (typeof engine.exec === 'function') { /* engine 句柄留着，避免误判未使用 */ }
  } finally {
    /* ⚠️ Node 22 的 http 默认开 keep-alive —— 不掐掉这些长连接，
       `server.close()` 会一直等到 socket 自己超时，脚本表现为「卡住不退出」。 */
    try { if (server.closeAllConnections) server.closeAllConnections(); } catch (e) { /* ignore */ }
    await new Promise(r => { try { server.close(r); } catch (e) { r(); } });
    try { fs.rmSync(TMPROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  console.log('');
  console.log('  \u2500\u2500 汇总 \u2500\u2500  通过 ' + pass + ' \u00b7 失败 ' + fail);
  if (fails.length) console.log('  失败项：\n    - ' + fails.join('\n    - '));
  console.log('');
  /* ⚠️ 必须显式退出：服务端侧有「活档兜底」之类的定时器，事件循环不会自然排空，
     进程会赖着不走 —— 回归入口就会把它判成「120s 超时」。测试脚本直接退即可。 */
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('\n  \u2605 perf-step-check 崩了：' + (e && e.stack || e) + '\n');
  process.exitCode = 1;
});
