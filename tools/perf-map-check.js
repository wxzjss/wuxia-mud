#!/usr/bin/env node
/* ==========================================================================
 *  tools/perf-map-check.js —— 「地图不许整张下发」性能门禁
 *  --------------------------------------------------------------------------
 *  为什么单独抽出来（团队长派单 2026-10-13）：
 *    地图相关的性能断言原本混在 perf-step-check 里（B5 组 + exec/save 的
 *    下发内容断言）。perf-step-check 的 B1 是延迟门、必须独占时段跑；
 *    而地图下发是**体积**断言，不受机器负载影响，没必要陪着独占。
 *    抽出来之后：perf-step-check 专心量延迟与通用体积，本脚本专心守
 *    「任何端口都不许把整张地图塞给前端」，并发跑也不失真。
 *
 *  守什么（为什么这些断言值得单独一个文件）：
 *    design/72 §M.2 记着病根：地图回包里 rooms[] 与 regions[].rooms[] 是
 *    同一批房间的两份副本（90.8 KB 纯重复），整包 285 KB。P0 止血把开局
 *    回包从 308.6 KB 压到 28.6 KB。这个形状只要有人在 view 里顺手加回一个
 *    `map:`，一夜回到解放前而没有任何测试会红 —— 所以四个端口逐个钉死。
 *
 *  断言清单（全部来自实测过的故障形状，见 tools/_perf_baseline.json pre 项）：
 *    M1 /api/new   ≤ 40 KB，view.map === undefined，view.player 必须在
 *    M2 /api/load  ≤ 40 KB，view.map === undefined，view.player 必须在
 *       （view.player 是反向半条：recoverLostPlayer 靠它接人，砍了断线重连就坏）
 *    M3 /api/exec  连续 300 步，0 步带 map
 *    M4 /api/save  回包 ≤ 2 KB，0 步带 view（修前 900/900 步带 view、517.9 KB）
 *    M5 比值门（主人裁「A + 比值」）：按端点分级，比值从修前/修后实测反推：
 *       · /api/new、/api/save ≤ 修前 × 0.5 —— 这两个是 P0 真修过的（0.09× / 0.0002×），
 *         0.5× 留足余量，但「重搬半张地图进来」必红；
 *       · /api/load ≤ 修前 × 1.0 —— load 修前本来就不带地图（32.7 KB，修后 27.1 KB），
 *         对它套 0.5× 是标定错误（首跑实测 27.1 vs 32.7 假红），门的意义改为
 *         「不许涨过修前水平」。绝对门 40 KB 仍然是最紧的那道。
 *       修前读数与测量环境见 tools/_perf_baseline.json。
 *
 *  怎么量：真起一个服务（随机端口 + .livetest 隔离目录），真 HTTP 打真回包，
 *  与 perf-step-check 同一套口径（KB 按 1024，gzip 用服务端同 level 5 估算）。
 *  体积断言不受 CPU 负载影响，单轮即可，不需要 best-of-3。
 *
 *  用法：node tools/perf-map-check.js [步数]      （默认 300 步）
 * ========================================================================== */

'use strict';

const http = require('http');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');

/* --- 测试隔离：纪律是「测试脚本不许写仓库真实目录」，目录走项目内 .livetest/ --- */
const TMPROOT = path.join(ROOT, '.livetest', 'perfmap-' + process.pid);
fs.mkdirSync(TMPROOT, { recursive: true });
process.env.WX_SAVE_DIR = path.join(TMPROOT, 'saves');
process.env.WX_SITE_DATA = path.join(TMPROOT, 'site-data');
fs.mkdirSync(process.env.WX_SAVE_DIR, { recursive: true });

const STEPS = parseInt(process.argv[2], 10) > 0 ? parseInt(process.argv[2], 10) : 300;
const KB = 1024;

/* --- 现行绝对门（与 perf-step-check 同数，一处放宽两头都松，别单独动这里） --- */
const LIMIT = {
  newLoadRaw: 40 * KB,
  /* 本地化（2026-10-18）：/api/save 回包 = 快照交付物本体（客户端落 localStorage），
     2 KB 门作废；口径同 perf-step-check B4（400 KB，防失控膨胀）。 */
  saveRaw: 400 * KB,
};
/* --- 比值门：从基线读修前快照；读不到基线就明说跳过，不装没这回事 --- */
let BASE = null;
try {
  BASE = JSON.parse(fs.readFileSync(path.join(__dirname, '_perf_baseline.json'), 'utf8'));
} catch (e) { /* 下面判空处理 */ }
const RATIO = 0.5;

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function kb(n) { return (n / 1024).toFixed(1) + ' KB'; }

function request(port, method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: Object.assign(
        { 'Accept-Encoding': 'gzip' },
        payload ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length } : {}
      ),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const gzipped = (res.headers['content-encoding'] || '') === 'gzip';
        let rawLen, text;
        if (gzipped) { text = zlib.gunzipSync(buf).toString('utf8'); rawLen = Buffer.byteLength(text, 'utf8'); }
        else { text = buf.toString('utf8'); rawLen = buf.length; }
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 留给断言报错 */ }
        resolve({ status: res.statusCode, rawLen, json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { createServer } = require(path.join(ROOT, 'server', 'game-server.js'));
  const { server } = createServer({});
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;

  console.log('');
  console.log('  \u250c\u2500 地图下发门禁 \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
  console.log('  \u2502 端口 ' + port + ' \u00b7 步数 ' + STEPS + ' \u00b7 隔离 ' + TMPROOT);
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  try {
    /* ---- 前提自证：基线必须读到，比值门不许静默失效 ---- */
    ok('前提 修前基线可读（_perf_baseline.json）', !!BASE && !!(BASE.pre && BASE.pre.newRawKB),
      BASE ? 'pre.new=' + BASE.pre.newRawKB + 'KB（a369125 实测）' : '读不到基线 \u2192 比值门 M5 未生效');

    /* ---------------- M1 /api/new ---------------- */
    console.log('\n  \u00a71 开局 /api/new');
    const rNew = await request(port, 'POST', '/api/new', { name: '地图侠', gender: 'male', birth: 'wuxue' });
    ok('M1 /api/new 回包 \u2264 ' + kb(LIMIT.newLoadRaw), rNew.rawLen <= LIMIT.newLoadRaw, kb(rNew.rawLen));
    ok('M1 /api/new 不下发地图（view.map undefined）',
      !!(rNew.json && rNew.json.view && rNew.json.view.map === undefined),
      rNew.json && rNew.json.view ? String(typeof rNew.json.view.map) : 'no view');
    ok('M1 /api/new 必须带 view.player（否则开局白屏）',
      !!(rNew.json && rNew.json.view && rNew.json.view.player), '');
    ok('M5 /api/new \u2264 修前 \u00d7 ' + RATIO,
      !!BASE && rNew.rawLen <= BASE.pre.newRawKB * 1024 * RATIO,
      kb(rNew.rawLen) + ' vs 修前 ' + (BASE ? BASE.pre.newRawKB.toFixed(1) : '?') + ' KB');

    /* ---------------- M3 300 步 exec ---------------- */
    console.log('\n  \u00a72 连续 ' + STEPS + ' 步（exec）');
    const DIRS = ['n', 's', 'e', 'w', 'n', 'e', 's', 'w'];
    let execHasMap = 0, execMaxRaw = 0;
    for (let i = 0; i < STEPS; i++) {
      const r = await request(port, 'POST', '/api/exec', { cmd: DIRS[i % DIRS.length] });
      if (r.json && r.json.view && r.json.view.map !== undefined) execHasMap++;
      if (r.rawLen > execMaxRaw) execMaxRaw = r.rawLen;
    }
    ok('M3 /api/exec 回包不带地图', execHasMap === 0, execHasMap + '/' + STEPS + ' 步带 map');
    ok('M3 /api/exec 回包 \u2264 ' + kb(LIMIT.newLoadRaw) + '（顺手看一眼体积）', execMaxRaw <= LIMIT.newLoadRaw, 'max ' + kb(execMaxRaw));

    /* ---------------- M4 /api/save ---------------- */
    console.log('\n  \u00a73 存档 /api/save');
    let saveHasView = 0, saveMaxRaw = 0;
    for (let i = 0; i < 20; i++) {
      const r = await request(port, 'POST', '/api/save', { id: 'perfmap_slot' });
      if (r.json && r.json.view !== undefined) saveHasView++;
      if (r.rawLen > saveMaxRaw) saveMaxRaw = r.rawLen;
    }
    ok('M4 /api/save 回包 \u2264 ' + kb(LIMIT.saveRaw), saveMaxRaw <= LIMIT.saveRaw, 'max ' + kb(saveMaxRaw));
    ok('M4 /api/save 回包不带 view（修前 900/900 步带、517.9 KB）', saveHasView === 0, saveHasView + '/20 步带了 view');
    ok('M5 /api/save \u2264 修前 \u00d7 ' + RATIO,
      !!BASE && saveMaxRaw <= BASE.pre.saveMaxKB * 1024 * RATIO,
      kb(saveMaxRaw) + ' vs 修前 ' + (BASE ? BASE.pre.saveMaxKB.toFixed(1) : '?') + ' KB');

    /* ---------------- M2 读档（本地化后 = /api/restore：正文由客户端送回） ---------------- */
    console.log('\n  \u00a74 读档 /api/restore');
    const rSnap = await request(port, 'POST', '/api/save', { id: 'perfmap_slot' });
    if (!(rSnap.json && rSnap.json.ok && rSnap.json.data)) {
      ok('M2 前提：能拿到快照正文', false, JSON.stringify(rSnap.json && rSnap.json.msg));
    } else {
      const rLoad = await request(port, 'POST', '/api/restore', { data: rSnap.json.data });
      ok('M2 /api/restore 回包 \u2264 ' + kb(LIMIT.newLoadRaw), rLoad.rawLen <= LIMIT.newLoadRaw, kb(rLoad.rawLen));
      ok('M2 /api/restore 不下发地图（view.map undefined）',
        !!(rLoad.json && rLoad.json.view && rLoad.json.view.map === undefined),
        rLoad.json && rLoad.json.view ? String(typeof rLoad.json.view.map) : 'no view');
      ok('M2 /api/restore 必须带 view.player（recoverLostPlayer 靠它接人）',
        !!(rLoad.json && rLoad.json.view && rLoad.json.view.player),
        rLoad.json && rLoad.json.view && rLoad.json.view.player ? 'player ok' : '\u2605 无 player \u2192 断线重连会坏');
      ok('M5 /api/restore \u2264 修前 load \u00d7 1.0（load 修前就不带地图、32.7 KB，门是不许涨过修前水平）',
        !!BASE && rLoad.rawLen <= BASE.pre.loadRawKB * 1024,
        kb(rLoad.rawLen) + ' vs 修前 ' + (BASE ? BASE.pre.loadRawKB.toFixed(1) : '?') + ' KB');
    }
  } finally {
    try { if (server.closeAllConnections) server.closeAllConnections(); } catch (e) { /* ignore */ }
    await new Promise(r => { try { server.close(r); } catch (e) { r(); } });
    try { fs.rmSync(TMPROOT, { recursive: true, force: true }); } catch (e) { /* ignore */ }
  }

  console.log('\n  \u2500\u2500 汇总 \u2500\u2500  通过 ' + pass + ' \u00b7 失败 ' + fail);
  if (fails.length) console.log('  失败项：\n    - ' + fails.join('\n    - '));
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('\n  \u2605 perf-map-check 崩了：' + (e && e.stack || e) + '\n');
  try { fs.rmSync(TMPROOT, { recursive: true, force: true }); } catch (e2) { /* ignore */ }
  process.exitCode = 1;
});
