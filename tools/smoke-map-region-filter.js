#!/usr/bin/env node
/* ==========================================================================
 *  tools/smoke-map-region-filter.js —— 地图「分批 + 迷雾」守卫（P0-C C-1）
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本（不是凑数，是补一个真空洞）：
 *    P0-C 之前，`/api/view?panel=map` 一次性下发**全世界 512 间房**（240.8 KB），
 *    而前端 `mapHtml` 在画之前先 `filter(r => r.region === curRegion)` 再
 *    `filter(r => (r.z||0) === curZ)` —— 也就是**下载 512 间、画出 ~32 间**。
 *    C-1 把「分批（region）+ 迷雾（fog）」做进去，包体降到几十 KB。
 *
 *    危险在于：**回归里没有任何一套走得到这条新路径**。
 *    `smoke-mapui` / `smoke-map-layer-filter` / `smoke-round2-map` / `smoke-uiux`
 *    这四套都把 `api.view` **整体 stub 成忽略入参**的假函数，
 *    剩下几套走的是 `engine.view({ map: true })` 这种不带参数的旧路径。
 *    ⇒ 新代码是裸奔的：改坏了没人红。这个脚本就是把它钉住。
 *
 *  ★ 核心契约（§0 守的就是它）：**分批与迷雾一律 opt-in**。
 *    不带 `mapRegion` / `mapFog` ⇒ 行为与 P0-B **一个字节不变**。
 *    这是有意为之：`mapguide-check.js:42` 断言
 *    `explore.total === m.rooms.length`，一分批 total 仍是 512 而 rooms 只剩几十间，
 *    那条断言当场红。它不是「过严的断言」，它守的是
 *    「探索度分母必须等于世界总房间数」这个语义 ——
 *    所以正确做法是**别让分批走默认路径**，而不是去放宽那条断言。
 *
 *  覆盖：
 *    §0 opt-in 契约：不带参数 = P0-B 原样（512 间、字段齐全、total===rooms）
 *    §1 分批：房间集合 ⊆ 本州∪邻州、必含当前房、bridges 不许悬空
 *    §2 迷雾：未知房不带 name/exits 且带 known:false；已知房一个字段都不能少
 *    §3 explore.total 仍是全世界房间数（分母不许跟着分批缩水）
 *    §4 fog=0（设置项打开）⇒ 全量名字回来
 *    §5 几何四件套跟着裁：cells / terrain / regionBoxes 的键 ⊆ 批内
 *    §6 真 HTTP 量字节数，钉住「省了多少」，防止以后偷偷把包体喂回去
 *    §7 前端：`panel('map')` 真发出 `region=auto&fog=1`，设置打开后变 `fog=0`
 *
 *  用法：node tools/smoke-map-region-filter.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const zlib = require('zlib');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
const KB = 1024;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';
const B = (o) => Buffer.byteLength(JSON.stringify(o), 'utf8');

/* ================================================================
 *  真 HTTP 客户端（与 perf-step-check 同源：gunzip 出原始字节，逐字节精确）
 * ================================================================ */
function request(port, method, urlPath, bodyObj) {
  return new Promise((resolve, reject) => {
    const payload = bodyObj === undefined ? null : Buffer.from(JSON.stringify(bodyObj), 'utf8');
    const req = http.request({
      host: '127.0.0.1', port, path: urlPath, method,
      headers: Object.assign({ 'Accept-Encoding': 'gzip' },
        payload ? { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': payload.length } : {}),
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const gz = (res.headers['content-encoding'] || '') === 'gzip';
        const text = gz ? zlib.gunzipSync(buf).toString('utf8') : buf.toString('utf8');
        resolve({
          rawLen: Buffer.byteLength(text, 'utf8'),
          gzLen: gz ? buf.length : zlib.gzipSync(buf, { level: 5 }).length,
          json: JSON.parse(text),
        });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/* ================================================================
 *  最小 DOM 桩（够真 ui.js 加载 + panel('map') 跑到「发出请求」为止）
 *  与 autosave-throttle-check 同源：getElementById 必须返回真桩元素，
 *  返回 null 会在 ui.js 的 `renderTopbar` 之类的地方当场 TypeError。
 * ================================================================ */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '',
    className: '', id: '', type: '', dataset: {}, _attrs: {}, disabled: false, checked: false,
    style: { setProperty() { }, getPropertyValue() { return ''; } },
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const w = on === undefined ? !this.contains(c) : !!on; if (w) this.add(c); else this.remove(c); return w; },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get outerHTML() { return this._html; },
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter(x => x !== c); return c; },
    setAttribute(k, v) { el._attrs[k] = String(v); },
    getAttribute(k) { return el._attrs[k] === undefined ? null : el._attrs[k]; },
    removeAttribute(k) { delete el._attrs[k]; },
    addEventListener() { }, removeEventListener() { }, remove() { }, focus() { }, blur() { }, click() { },
    scrollTo() { }, querySelector() { return null; }, querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    insertAdjacentHTML() { }, closest() { return null; }, contains() { return false; },
  };
  return el;
}

function buildSandbox() {
  const doc = makeEl('document');
  doc.createElement = makeEl;
  doc.createTextNode = (t) => ({ nodeType: 3, textContent: String(t) });
  const _byId = Object.create(null);
  doc.getElementById = (id) => {
    if (!_byId[id]) { const el = makeEl('div'); el.id = id; _byId[id] = el; }
    return _byId[id];
  };
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  doc.body = makeEl('body');
  doc.head = makeEl('head');
  doc.documentElement = makeEl('html');
  doc.addEventListener = () => { };
  doc.removeEventListener = () => { };

  const win = {
    document: doc, location: { href: 'http://127.0.0.1/', search: '', pathname: '/', hash: '' },
    navigator: { userAgent: 'node-map-region-filter', sendBeacon: () => true },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { }, clear() { }, key: () => null, length: 0 },
    addEventListener() { }, removeEventListener() { }, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } }),
    alert() { }, confirm: () => true, prompt: () => null,
    fetch: () => Promise.resolve({ ok: true, text: () => Promise.resolve('{}') }),
    Blob: function (a, b) { return { parts: a, opts: b }; }, FormData: function () { return { append() { } }; },
    Image: function () { return {}; }, Crypto: function () { return {}; }, Event: function () { return {}; },
    CustomEvent: function () { return {}; }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, performance: { now: () => Date.now() },
    Intl, Date, Math, JSON, Set, Map, Promise, RegExp, Error, String, Number, Boolean, Array, Object,
    URLSearchParams, console, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  return win;
}

/* ================================================================
 *  主流程
 * ================================================================ */
async function main() {
  const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
  const e = new GameEngine({ seed: 20261013 });
  await e.boot({});
  e.newGame({ name: '分批侠' });
  /* 期望全集 = 全部房间 − private（engine.js mapView 同一谓词，数据侧独立复算） */
  const WORLD_ROOMS = (() => { const R = e.world.data.rooms; return Object.keys(R).filter(id => !(R[id] && R[id].private)).length; })();

  console.log('');
  console.log('  \u250c\u2500 地图「分批 + 迷雾」守卫（P0-C C-1）──────────────');
  console.log('  \u2502 喂真 engine / 真 HTTP / 真 ui.js');
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  /* ================= §0 opt-in 契约 ================= */
  section('  \u00a70 opt-in 契约：不带参数 = P0-B 原样（这是全部其它断言的前提）');
  const base = e.view({ map: true }).map;
  ok('§0-1 不带参数 ⇒ 仍是全世界房间', base.rooms.length === WORLD_ROOMS, 'rooms=' + base.rooms.length);
  ok('§0-2 不带参数 ⇒ explore.total === rooms.length（mapguide-check.js:42 的口径）',
    base.explore.total === base.rooms.length, JSON.stringify(base.explore));
  ok('§0-3 不带参数 ⇒ 房间字段齐全（name / exits 都在）',
    base.rooms.every(r => typeof r.name === 'string' && Array.isArray(r.exits)), '');
  ok('§0-4 不带参数 ⇒ 几何四件套齐全',
    !!(base.cells && base.terrain && base.regionBoxes && base.bounds), '');

  /* ================= §1 分批 ================= */
  section('  \u00a71 分批 region=auto');
  const curRegion = (base.rooms.find(r => r.current) || {}).region;
  const nb1 = e.view({ map: true, mapRegion: 'auto', mapNeighbors: true }).map;
  const regsInBatch = new Set(nb1.rooms.map(r => r.region));
  ok('§1-1 批内房间数明显少于全世界', nb1.rooms.length < base.rooms.length,
    nb1.rooms.length + ' / ' + base.rooms.length);
  ok('§1-2 必含玩家当前所在的州 ' + curRegion, regsInBatch.has(curRegion),
    [...regsInBatch].length + ' 个州');
  ok('§1-3 必含「你在这里」那一间', !!nb1.rooms.find(r => r.current), '');
  ok('§1-4 ★ bridges 不许悬空（两端都必须在批内）', (() => {
    const ids = new Set(nb1.rooms.map(r => r.id));
    return nb1.bridges.every(br => ids.has(br.a) && ids.has(br.b));
  })(), nb1.bridges.length + ' 条桥');
  ok('§1-5 ★ cells 的键 ⊆ 批内房间（不许发用不上的坐标）', (() => {
    const ids = new Set(nb1.rooms.map(r => r.id));
    return Object.keys(nb1.cells).every(k => ids.has(k));
  })(), Object.keys(nb1.cells).length + ' 个坐标');
  ok('§1-6 ★ terrain / regionBoxes 的键 ⊆ 批内州', (() => {
    const bad = Object.keys(nb1.terrain).filter(k => !regsInBatch.has(k))
      .concat(Object.keys(nb1.regionBoxes).filter(k => !regsInBatch.has(k)));
    return bad.length === 0;
  })(), 'terrain ' + Object.keys(nb1.terrain).length + ' · boxes ' + Object.keys(nb1.regionBoxes).length);
  ok('§1-7 只发本州（neighbors:false）时，批内只剩一个州', (() => {
    const solo = e.view({ map: true, mapRegion: 'auto', mapNeighbors: false }).map;
    const s = new Set(solo.rooms.map(r => r.region));
    return s.size === 1 && s.has(curRegion);
  })(), '');

  /* ================= §2 迷雾 ================= */
  section('  \u00a72 迷雾 fog=1');
  const fg = e.view({ map: true, mapRegion: 'auto', mapNeighbors: true, mapFog: true }).map;
  /* ⚠️ 口径改过一次（design/78 §4.5.1 的 M-V-2，主理人 2026-10-13 拍板）：
     P0-C 那版把「紧邻一步 near」也算进**已知房**，理由是「站在门口能看见隔壁
     叫什么，不算剧透」，于是 near 房跟 visited 一样发全名。
     design/78 推翻了它：near 那一档要的是「**无字 + 有空心圈**」——
     玩家靠它判断的是"旁边有路可以走"，不是"隔壁叫什么"。名字一出来圈就没意义了，
     而且会连累 M-V-7（未探索格子的 title 漏出房间名 = 悬停即剧透）。
     ⇒ 现在分**三档**：真·已知（脚下/去过，发全名）/ 相邻可走（只发 near:1，不发名字）
       / 完全未知（只留 id 坐标）。下面 §2-2…§2-7 的断言跟着分档走。 */
  const knownRooms = fg.rooms.filter(r => r.current || r.visited);
  const nearRooms = fg.rooms.filter(r => !(r.current || r.visited) && r.near);
  const fogRooms = fg.rooms.filter(r => !(r.current || r.visited || r.near));
  ok('§2-1b 前提：三档都有样本（否则下面的断言会恒真）',
    knownRooms.length > 0 && nearRooms.length > 0 && fogRooms.length > 0,
    '已知 ' + knownRooms.length + ' · 相邻可走 ' + nearRooms.length + ' · 未知 ' + fogRooms.length);
  ok('§2-1c ★ 相邻可走档：**不发名字**但保留 near:1（前端靠它画空心圈）',
    nearRooms.every(r => r.name === undefined && r.near === true && r.visited === false),
    nearRooms.length + ' 格');
  ok('§2-1 前提：批里确实有两种房间（否则下面的断言恒真）',
    knownRooms.length > 0 && fogRooms.length > 0,
    '已知 ' + knownRooms.length + ' · 迷雾 ' + fogRooms.length);
  ok('§2-2 ★ 迷雾房不带 name', fogRooms.every(r => r.name === undefined), '');
  ok('§2-3 ★ 迷雾房不带 exits', fogRooms.every(r => r.exits === undefined), '');
  ok('§2-4 ★ 迷雾房带 known:false', fogRooms.every(r => r.known === false), '');
  ok('§2-5 ★ 迷雾房仍带 id / x / y / z（没这些连格子都摆不出来）',
    fogRooms.every(r => r.id && typeof r.x === 'number' && typeof r.y === 'number' && r.z !== undefined), '');
  ok('§2-6 ★ 迷雾房必须带 region —— 前端按 region 过滤，不给就整片消失',
    fogRooms.every(r => typeof r.region === 'string'), '');
  ok('§2-7 已知房一个字段都不能少（name / exits / visited / dist 都在）',
    knownRooms.every(r => typeof r.name === 'string' && Array.isArray(r.exits) && r.dist !== undefined), '');
  ok('§2-8 迷雾房比完整房小（真的瘦了，不是换了个写法）',
    B(fogRooms[0]) < B(base.rooms.find(r => r.id === fogRooms[0].id)),
    B(fogRooms[0]) + ' B / ' + B(base.rooms.find(r => r.id === fogRooms[0].id)) + ' B');

  /* ================= §3 explore.total ================= */
  section('  \u00a73 探索度分母不许跟着分批缩水');
  ok('§3-1 ★ explore.total 仍是全世界房间数（= 不分批时的值）',
    fg.explore.total === base.explore.total && fg.explore.total === WORLD_ROOMS,
    JSON.stringify(fg.explore) + ' vs ' + JSON.stringify(base.explore));
  ok('§3-2 explore.visited 也是全局数（不是批内数）',
    fg.explore.visited === base.explore.visited, fg.explore.visited + ' vs ' + base.explore.visited);

  /* ================= §4 fog=0 ================= */
  section('  \u00a74 fog=0（opt-in 关雾；⚠️ 探索制后前端已无此开关，引擎契约不变）');
  const nf = e.view({ map: true, mapRegion: 'auto', mapNeighbors: true, mapFog: false }).map;
  ok('§4-1 fog=0 ⇒ 全量名字回来', nf.rooms.every(r => typeof r.name === 'string'), '');
  ok('§4-2 fog=0 ⇒ exits 也回来', nf.rooms.every(r => Array.isArray(r.exits)), '');
  ok('§4-3 fog=0 ⇒ 不出现 known 字段', nf.rooms.every(r => r.known === undefined), '');
  ok('§4-4 fog=0 与 fog=1 的房间**集合**一致（迷雾只裁字段，不裁格子）', (() => {
    const a = nf.rooms.map(r => r.id).sort().join(',');
    const b = fg.rooms.map(r => r.id).sort().join(',');
    return a === b;
  })(), nf.rooms.length + ' vs ' + fg.rooms.length);

  /* ================= §5 字节数（引擎层） ================= */
  section('  \u00a75 引擎层字节数');
  console.log('    不分批不迷雾  rooms ' + kb(B(base.rooms)) + ' · 全包 ' +
    kb(B(base.rooms) + B(base.cells) + B(base.terrain) + B(base.bridges) + B(base.regionBoxes) + B(base.regions)));
  console.log('    分批+迷雾     rooms ' + kb(B(fg.rooms)) + ' · 全包 ' +
    kb(B(fg.rooms) + B(fg.cells) + B(fg.terrain) + B(fg.bridges) + B(fg.regionBoxes) + B(fg.regions)));
  ok('§5-1 分批+迷雾后 rooms 至少瘦一半', B(fg.rooms) * 2 <= B(base.rooms),
    kb(B(fg.rooms)) + ' vs ' + kb(B(base.rooms)));

  /* ================= §6 真 HTTP ================= */
  section('  \u00a76 真 HTTP 量回包（gunzip 出原始字节）');
  /* ⚠️ 2026-10-12 改：从 os.tmpdir() 迁到项目内 .livetest/（统一隔离写法、带 pid 防并发互踩） */
  const TMP = require('./_test-tmp').testTmpDir('maprf');
  fs.mkdirSync(TMP, { recursive: true });
  process.env.WX_SAVE_DIR = path.join(TMP, 'saves');
  process.env.WX_SITE_DATA = path.join(TMP, 'site-data');
  fs.mkdirSync(process.env.WX_SAVE_DIR, { recursive: true });
  const { createServer } = require(path.join(ROOT, 'server', 'game-server.js'));
  const { server } = createServer({});
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  await request(port, 'POST', '/api/new', { name: '分批侠', gender: 'male', birth: 'wuxue' });

  const rFull = await request(port, 'GET', '/api/view?panel=map');
  const rBatch = await request(port, 'GET', '/api/view?panel=map&region=auto&neighbors=1&fog=1');
  const rSolo = await request(port, 'GET', '/api/view?panel=map&region=auto&neighbors=0&fog=1');
  console.log('    整包          ' + kb(rFull.rawLen) + ' 原始 / ' + kb(rFull.gzLen) + ' gzip');
  console.log('    本州+邻州+迷雾 ' + kb(rBatch.rawLen) + ' 原始 / ' + kb(rBatch.gzLen) + ' gzip');
  console.log('    仅本州+迷雾    ' + kb(rSolo.rawLen) + ' 原始 / ' + kb(rSolo.gzLen) + ' gzip');

  ok('§6-1 整包仍是 512 间（opt-in 契约在 HTTP 层也成立）',
    rFull.json.view.map.rooms.length === WORLD_ROOMS, 'rooms=' + rFull.json.view.map.rooms.length);
  ok('§6-2 分批后回包明显小于整包', rBatch.rawLen < rFull.rawLen / 2,
    kb(rBatch.rawLen) + ' vs ' + kb(rFull.rawLen));
  /* 阈值留了余量：它守的是「不许偷偷把包体喂回去」，不是卡死在某个数字上。
     真要优化到更小，欢迎把这条阈值一起往下调 —— 但必须**同时**改数字和这里。 */
  ok('§6-3 本州+邻州+迷雾 ≤ 130 KB 原始', rBatch.rawLen <= 130 * KB, kb(rBatch.rawLen));
  ok('§6-4 仅本州+迷雾 ≤ 60 KB 原始', rSolo.rawLen <= 60 * KB, kb(rSolo.rawLen));
  ok('§6-5 gzip 后 ≤ 25 KB', rBatch.gzLen <= 25 * KB, kb(rBatch.gzLen));
  ok('§6-6 服务端的迷雾房确实没带 name',
    rBatch.json.view.map.rooms.some(r => r.known === false && r.name === undefined), '');

  server.closeAllConnections && server.closeAllConnections();
  server.close();

  /* ================= §7 前端真的发出去了 ================= */
  section('  \u00a77 前端 panel(\'map\') 真的带了分批 / 迷雾参数');
  {
    const sandbox = buildSandbox();
    const ctx = vm.createContext(sandbox);
    for (const f of ['app.js', 'ui.js']) {
      vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), ctx, { filename: path.join(RJS, f) });
    }
    const WX = sandbox.WX, WXUI = sandbox.WXUI;
    if (!WX || !WXUI) {
      ok('§7-0 真 app.js + ui.js 加载成功', false, 'sandbox 里没有 WX / WXUI');
    } else {
      /* ⚠️ 替换 sandbox.fetch 而不是替换 WX.api.view：
         要测的正是 `api.view` 里那段 URL 拼装，把它 stub 掉就什么都测不到了。
         app.js 的 `jfetch` 是在**调用时**才解析 `fetch`，所以换这个有效。 */
      const urls = [];
      sandbox.fetch = (url) => {
        urls.push(String(url));
        return Promise.resolve({ ok: true, text: () => Promise.resolve('{"ok":true,"view":{}}') });
      };
      const run = async () => { try { await WXUI.panel('map'); } catch (err) { /* 渲染报错无所谓，请求已经发出去了 */ } };

      urls.length = 0;
      WX.S.settings = WX.S.settings || {};
      WX.S.settings.mapnames = false;
      await run();
      const u1 = urls.find(u => u.indexOf('/api/view') >= 0) || '(没发出 /api/view)';
      ok('§7-1 ★ 默认（未探索地名关）⇒ 发 fog=1', u1.indexOf('fog=1') >= 0, u1);
      ok('§7-2 ★ 发 region=auto（不是前端猜州名，那是循环依赖）', u1.indexOf('region=auto') >= 0, u1);

      urls.length = 0;
      /* ⚠️ 探索制返修（主人 2026-10-18 口径）：迷雾改成**探索制**之后，
         「地图显示未探索地名」这个设置整体退役 —— 探索集合本身就是开关，没有第二个闸。
         这里故意塞一份旧设置残留进去：真机老用户的 localStorage 里就躺着这条，
         前端不许因为它把 fog 关掉（ui.js 的 mapViewOpts 已写死 fog:1）。 */
      WX.S.settings.mapnames = true;
      await run();
      const u2 = urls.find(u => u.indexOf('/api/view') >= 0) || '(没发出 /api/view)';
      ok('§7-3 ★ 探索制无开关：旧 mapnames 残留也照样发 fog=1',
        u2.indexOf('fog=1') >= 0 && u2.indexOf('fog=0') < 0, u2);

      urls.length = 0;
      await run.call(null);
      /* 非地图面板不许带上这批参数 —— 它们只属于地图 */
      try { await WXUI.panel('bag'); } catch (err) { /* 同上 */ }
      const u3 = urls.filter(u => u.indexOf('/api/view') >= 0).pop() || '(没发出 /api/view)';
      ok('§7-4 别的面板不带 region/fog（参数只属于地图面板）',
        u3.indexOf('region=') < 0 && u3.indexOf('fog=') < 0, u3);
    }
  }

  /* ================= §8 迷雾数据喂给真 mapHtml ================= */
  section('  \u00a78 迷雾数据喂给**真 mapHtml**（不崩、不剧透、格子数对得上）');
  /* ⚠️ 从真 ui.js 里抠出 mapHtml 来跑，而不是用假 HTML 比对字符串：
     迷雾改的是**房间对象的形状**，只有真渲染代码才知道它吃不吃得下。
     （`mapLabel` 与 `MAP_NAME_MAX` 都声明在 mapHtml 内部，抠一次就带上了；
      C-2 之后它俩已删，抠出来的是 §3.9 那套新算法。）
     ⚠️ 定义在块外，§9 的长名电池也要用它。 */
  const UISRC = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  const grab = (name) => {
    const mm = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
    if (!mm) throw new Error('未找到 ' + name);
    return mm[0];
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
  const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
  const mapHtml = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
    grab('mapHtml') + '\nreturn mapHtml;')(esc, 30, 26, 34, DIR_CN, DIR_OFF);
  {
    /* ⚠️ 探索制 setup（主人 2026-10-18 口径：探索过的显示、没探索过的不显示）：
       mapHtml 现在只画 visited∪current（ui.js 节点循环头部零渲染 skip），
       而 visited 来自引擎进房打点的 `visited_<roomId>` 玩家旗标（engine.js mapView）。
       开局只踩过脚下 1 格 —— 直接渲染的话「零截断」断言只能找到 1 个名字，
       鉴别力归零。⇒ 先把**画布层**（本州本层）整层踩点，本节/§9 的断言才有样本。
       注意：§0–§6 的视图对象早已算好，不受踩点影响；
       本节的迷雾视图必须**踩点之后**重取（fg2），未探索样本才会落在层外/州外。 */
    const here0 = base.rooms.find(r => r.current) || {};
    const curZ0 = here0.z || 0;
    const pExp = e.world.player;
    const canvasIds = base.rooms
      .filter(r => r.region === here0.region && (r.z || 0) === curZ0)
      .map(r => r.id);
    canvasIds.forEach(id => { try { pExp.setFlag('visited_' + id, true); } catch (err) { } });

    /* 用「整包」渲染作对照：探索制下两边画的都是踩过点的格子 */
    const render = (view) => mapHtml(view);

    let hFull = '', hFog = '', errFull = null, errFog = null;
    let fg2 = null;
    try { hFull = render(e.view({ map: true })); } catch (err) { errFull = err; }
    try {
      /* ⚠️ mapHtml 吃的是**整个 view 对象**（内部自取 v.map），别把 .map 剥了传进去 */
      const vFog = e.view({ map: true, mapRegion: 'auto', mapNeighbors: true, mapFog: true });
      fg2 = vFog.map;
      hFog = render(vFog);
    } catch (err) { errFog = err; }

    ok('§8-1 整包视图渲染不崩', !errFull, errFull ? String(errFull.message) : '');
    ok('§8-2 ★ 迷雾视图渲染不崩（这是最该红的一条：房间对象形状变了）',
      !errFog, errFog ? String(errFog.message) : '');

    if (!errFull && !errFog) {
      const nodes = (h) => (h.match(/data-room="/g) || []).length;
      /* ⚠️ 探索制返修：旧口径「迷雾格子数 = 整包格子数」已死 —— 零渲染之后，
         两边画出来的都是 visited∪current。新口径：画布格数 == 画布层踩点数
         （整层踩点 ⇒ 一间不多一间不少），且迷雾/整包一致。 */
      ok('§8-3 ★ 探索制：画布只画踩过点的那层（踩点 ' + canvasIds.length
        + ' 间，迷雾/整包都一间不多一间不少）',
        nodes(hFog) === canvasIds.length && nodes(hFull) === canvasIds.length,
        '迷雾 ' + nodes(hFog) + ' · 整包 ' + nodes(hFull) + ' · 踩点 ' + canvasIds.length);
      ok('§8-4 渲染结果里没有 "undefined"（字段缺了最容易漏成这个）',
        hFog.indexOf('undefined') < 0, '');
      /* 不剧透：拿整包那份查出某个迷雾房的真名，再断言迷雾渲染结果里没有它。
         ⚠️ 挑 2 字以上的短名来查 —— 单字名（「市」「街」）在别处也可能出现，会假绿。
         ⚠️ 用 fg2（踩点之后的迷雾视图）取未知房：踩点后画布层已全部 visited，
            未探索样本只剩层外/州外 —— 它们本就不该被画出来。 */
      const fogIds = new Set(fg2.rooms.filter(r => r.known === false).map(r => r.id));
      const probe = base.rooms.filter(r => fogIds.has(r.id) && String(r.name || '').length >= 3).slice(0, 20);
      const leaked = probe.filter(r => hFog.indexOf(String(r.name)) >= 0);
      ok('§8-5 ★ 迷雾房的真名不出现在渲染结果里（抽查 ' + probe.length + ' 个）',
        probe.length > 0 && leaked.length === 0,
        leaked.length ? '泄漏：' + leaked.map(r => r.name).join('、') : '');
      /* ⚠️ 这条在 C-2 之后**改了期望**，不是放宽，是旧期望真的不再成立：
         旧期望：迷雾房渲染成「？」占位。
         为什么不再成立：spec §3.2 定的是「未探索 = 纸本身褪回底色，连帘纹都淡掉」，
         验收项 V-5 写死 `[data-visited="0"] .mn-name` 的 `textContent.length === 0`。
         画一个「？」等于在**没去过的地方画了个东西**，语义反了 ——
         「？」表达的是「这里有内容但你不知道」，而未探索表达的是「你没去过，所以这里什么都没有」。
         ⇒ 新期望：空的 `.mn-name`，且全图不再出现「？」。 */
      /* ⚠️ 探索制返修：这条的旧期望「空 .mn-name 占位」也退役了 ——
         未探索表达的是「你没去过，所以这里什么都没有」，
         连空壳格子都不该有（画一个空壳等于在没去过的地方画了个东西，语义反了）。
         ⇒ 新期望：known:false 的房间一间都不出现在画布上；「？」同样不许出现。
         fg2 的未知房在 neighbors=1 下必有样本（邻州整片未探索），断言不会恒真。 */
      const drawnIds8 = new Set((hFog.match(/data-room="([^"]+)"/g) || [])
        .map(s => s.slice('data-room="'.length, -1)));
      const unknownIds8 = new Set(fg2.rooms.filter(r => r.known === false).map(r => r.id));
      const badDrawn = [...drawnIds8].filter(id => unknownIds8.has(id));
      ok('§8-6 探索制零渲染：未探索格（known:false）一间都不出现在画布上，且无「？」',
        unknownIds8.size > 0 && badDrawn.length === 0
        && (hFog.match(/？/g) || []).length === 0,
        '未知房 ' + unknownIds8.size + ' · 误画 ' + badDrawn.length
        + ' · 「？」 ' + (hFog.match(/？/g) || []).length + ' 个');

      /* §8-7 是 C-2 的**核心验收**：spec V-1「任意房间名不被截断，全名逐字出现在 DOM 里」。
         老代码用 `MAP_NAME_MAX = 4` + `mapLabel()` 把「江南城·长街」砍成「长街」，
         主人报的「地块名看不全」就是它。这里拿**整包视图**的全名去渲染结果里逐字查。 */
      /* ⚠️ 只查**真的被画出来**的那几格：mapHtml 在画之前会
         `filter(region === curRegion)` 再 `filter(z === curZ)`。
         「已知」（fog 豁免）与「画得出来」是两回事 ——
         紧邻一步的房间如果在**别的州**，它算已知（不下迷雾），但根本不在画布上。
         把它们算进来，这条断言会去画布外找一个不存在的名字，红得莫名其妙。 */
      /* ⚠️ 口径改过两次，两次都是同一个教训：**别把断言挂在会缩水的样本上**。
         第一次：`near` 档现在不发名字了（design/78 §4.5.1 M-V-2），
                 还去画布上找它的全名，等于找一件规范明令不许出现的东西。
         第二次：把 `near` 摘掉之后样本直接归零 —— 开局只到过脚下这一格，
                 `named.length > 0` 退化成 `0 > 0`，红是红了，鉴别力是零。
         根因是这条**本来就不该挂在迷雾视图上**：
         「零截断」是 mapHtml 的属性，跟「名字发不发得出来」是两码事。
         ⇒ 挪到**整包视图**上查：那里 512 间全带名字，样本管够。
         迷雾该守的「不剧透」由 §8-5 / §8-6 守，各守各的，别互相连坐。 */
      /* ⚠️ 探索制 setup 已把画布层整层踩点 ⇒ shownIds 里的每一间都会被真画出来，
         「零截断」的样本一个不少。 */
      const shownIds = new Set(canvasIds);
      /* ⚠️ 查全名之前必须先把 `<wbr>` 摘掉：名字是 `青溪村·<wbr>村口`，
         直接 `indexOf('青溪村·村口')` 会因为中间那个标签而漏判。
         只摘 `<wbr>`、**不摘其它标签** —— 全摘会把相邻两格的文本粘在一起，
         有可能拼出一个恰好等于某个房间名的串，那就假绿了。 */
      const hNoWbr = hFull.replace(/<wbr>/g, '');
      const named = base.rooms.filter(r => shownIds.has(r.id) && String(r.name || '').length >= 5);
      const cut = named.filter(r => hNoWbr.indexOf(String(r.name)) < 0);
      ok('§8-7 ★ 已知房的**全名**逐字出现在渲染结果里（C-2 零截断，抽查 '
        + named.length + ' 个 ≥5 字长名）',
        named.length > 0 && cut.length === 0,
        cut.length ? '被截断：' + cut.slice(0, 3).map(r => r.name).join('、') : '');
      ok('§8-8 「·」处插了 <wbr>（断在语义边界上，不是断在半截词里）',
        (hFull.match(/<wbr>/g) || []).length > 0, (hFull.match(/<wbr>/g) || []).length + ' 处');
      ok('§8-9 字号地板 ≥ 10px（spec §3.9 第 6 条，不许再降到 7px 那种蚂蚁字号）', (() => {
        const sizes = (hFog.match(/font-size:(\d+(?:\.\d+)?)px/g) || [])
          .map(s => parseFloat(s.replace('font-size:', '')));
        return sizes.length > 0 && sizes.every(s => s >= 10);
      })(), '');
      ok('§8-10 帘纹层不再内联格距（内联 background-size == 格距 就是网格线，spec V-6）',
        hFog.indexOf('background-size') < 0 && hFog.indexOf('map-grid-bg') < 0, '');
    }
  }

  /* ================= §9 长名电池（把「零截断」真压一遍） ================= */
  section('  \u00a79 长名电池：spec §3.9 声称「312/312 零截断」，这里真压一遍');
  {
    /* ⚠️ 为什么要有这一节：§8-7 抽查到的长名只有 2 个 —— 开局那一区恰好都是短名，
       样本太少，等于没测到。spec 的硬指标是**最长 9 码点**的名字也放得下，
       那就得真造一个 9 码点的名字喂进去看，不能靠「反正算过」。
       做法：拿整包视图，把当前区那几格的 `name` 换成一组长名电池再渲染。
       （只换 `name`，坐标 / 区域 / 层级一概不动 —— 换了就不在画布上了。） */
    const vv = e.view({ map: true });
    const mm = vv.map;
    const hereR = mm.rooms.find(r => r.current) || {};
    const curZ = hereR.z || 0;
    const inRegion = mm.rooms.filter(r => r.region === hereR.region && (r.z || 0) === curZ);
    const battery = [
      '街', '长街', '江南城·长街', '江口码头·货栈后街', '白鹿书院·讲堂',
      '黑松林深处', '唐门·堡门', '青溪村·村口', '扬州城·醉仙楼', '听雨山庄·后院',
    ];
    const assigned = [];
    inRegion.forEach((r, i) => { if (battery[i]) { r.name = battery[i]; assigned.push(battery[i]); } });

    let h = '', err = null;
    try { h = mapHtml(vv); } catch (e2) { err = e2; }
    ok('§9-1 长名视图渲染不崩', !err, err ? String(err.message) : '');
    if (!err) {
      const hNoWbr = h.replace(/<wbr>/g, '');
      const cut = assigned.filter(n => hNoWbr.indexOf(n) < 0);
      console.log('    喂进去 ' + assigned.length + ' 个名字，最长 '
        + Math.max(...assigned.map(n => [...n].length)) + ' 码点');
      ok('§9-2 ★ 每一个全名都逐字出现在 HTML 里（一个字都没被砍）',
        assigned.length >= 5 && cut.length === 0,
        cut.length ? '被砍：' + cut.join('、') : assigned.map(n => [...n].length + '字').join('·'));
      ok('§9-3 ★ 9 码点的最长名也完整（spec §〇 第 1 条的硬指标）',
        assigned.indexOf('江口码头·货栈后街') < 0 || hNoWbr.indexOf('江口码头·货栈后街') >= 0, '');
      ok('§9-4 没出现「…」这类省略号（砍字的另一个常见形状）', h.indexOf('…') < 0, '');
      /* 行宽：三行之内放得下 ⇒ 每格名字的 max-width ≤ 格距 */
      const mw = (h.match(/max-width:(\d+)px/g) || []).map(s => parseInt(s.replace('max-width:', ''), 10));
      ok('§9-5 行宽上限都不超过格距（不横向压到邻格，spec V-3）',
        mw.length > 0 && mw.every(x => x <= 52), 'max ' + Math.max(...mw) + 'px / 格距 52px');
    }
  }

  console.log('\n  \u2500\u2500 ' + pass + ' 通过 / ' + fail + ' 失败 \u2500\u2500');
  if (fail) console.log('  失败项：' + fails.join(' / '));
  /* ⚠️ 必须显式 exit：ui.js 里的 5 分钟兜底 `setInterval` 会把事件循环一直吊住，
     不 exit 的话本脚本会挂到 run-regression 的 120s 超时，被误判成失败。 */
  process.exit(fail ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
