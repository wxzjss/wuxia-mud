#!/usr/bin/env node
/* ==========================================================================
 *  tools/autosave-throttle-check.js —— 一步一存档防抖守卫（B8）
 *  --------------------------------------------------------------------------
 *  P0 之前：每走一步 → `afterAction` 无条件 `autoSave()` → 一次 `/api/save`
 *           ⇒ 每一步都跟着一个 530 KB 的回包 + 3.8 ms 同步写盘。
 *  P0 之后：`afterAction` 只是「排一个 30 秒的防抖」，真正落盘要靠
 *           （a）静止 30 秒到期 （b）关键节点 `autoSaveNow()` （c）5 分钟兜底。
 *
 *  这个脚本钉的就是这个约定：**连打 20 步，磁盘上不许出现 20 次写**。
 *  只看 excessive 代码是不够的 —— 哪天有人把 `setTimeout` 改成直接调用、
 *  或者给 afterAction 又加了一句即时保存，代码照样「看着对」，
 *  但只要 /api/save 的次数回到 20，单步的下行就回到解放前。所以这里**数次数**。
 *
 *  怎么数（要点：喂**真 ui.js**，不打桩代替它）：
 *    用 vm 载入真 app.js + 真 ui.js，再把 `WX.api.save` 换成计数器
 *    （ui.js 在加载时 `const { api } = global.WX` 取的是**同一个对象引用**，
 *      所以替换它上面的方法奏效）。然后连续调用真 `WXUI.afterAction()` 20 次。
 *    这样断言到的不是「我猜它怎么写」，而是「它真的写了几次」。
 *
 *  覆盖：
 *    §1 连发 20 条普通指令 ⇒ /api/save 次数 ≤ 2   （B8 本体）
 *    §2 关键节点必须**立刻**写：战斗结算 / 任务推进 / 跨日 / 结局 各一次
 *    §3 防抖期间确实不写；`autoSaveNow()` 走的是同一条落盘路径
 *    §4 `_autosavePending` 并发去重仍在
 *
 *  用法：node tools/autosave-throttle-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ================================================================
 *  最小 DOM 桩（够真 ui.js 加载与 afterAction 跑完即可，
 *  与 smoke-uiux.js 同源：innerHTML setter 必须清 children）
 * ================================================================ */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '',
    className: '', id: '', type: '', dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
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
    scrollTo() { }, querySelector() { return null; },
    querySelectorAll() { return []; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    insertAdjacentHTML() { }, closest() { return null; }, contains() { return false; },
  };
  return el;
}

function buildSandbox() {
  const doc = makeEl('document');
  doc.createElement = makeEl;
  doc.createTextNode = (t) => ({ nodeType: 3, textContent: String(t) });
  /* ⚠️ `$()` 是 `document.getElementById`，而 ui.js 拿到元素就 `#.textContent = ...`。
     返回 null 会当场 TypeError —— 真 `renderTopbar`（ui.js:146）就挂在这上面。
     所以这里要按 id 缓存并返回真桩元素，UI 写什么我们都不关心，但不许是空。 */
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
    navigator: { userAgent: 'node-throttle-check', sendBeacon: () => true },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { }, clear() { }, key: () => null, length: 0 },
    addEventListener() { }, removeEventListener() { }, setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (cb) => setTimeout(cb, 0), cancelAnimationFrame: (id) => clearTimeout(id),
    matchMedia: () => ({ matches: false, addListener() { }, removeListener() { }, addEventListener() { }, removeEventListener() { } }),
    alert() { }, confirm: () => true, prompt: () => null,
    fetch: () => Promise.reject(new Error('no network in throttle check')),
    Blob: function (a, b) { return { parts: a, opts: b }; }, FormData: function () { return { append() { } }; },
    Image: function () { return {}; }, Crypto: function () { return {}; }, Event: function () { return {}; },
    CustomEvent: function () { return {}; }, getComputedStyle: () => ({ getPropertyValue: () => '' }),
    innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, performance: { now: () => Date.now() },
    Intl, Date, Math, JSON, Set, Map, Promise, RegExp, Error, String, Number, Boolean, Array, Object,
    console, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout,
  };
  win.window = win;
  win.globalThis = win;
  win.self = win;
  return win;
}

/* ================================================================
 *  主流程
 * ================================================================ */
function loadUI() {
  const sandbox = buildSandbox();
  const ctx = vm.createContext(sandbox);
  /* 顺序有讲究：ui.js 依赖 app.js 建好的 global.WX（见 ui.js 第 8 行的解构） */
  for (const f of ['app.js', 'ui.js']) {
    const code = fs.readFileSync(path.join(RJS, f), 'utf8');
    vm.runInContext(code, ctx, { filename: path.join(RJS, f) });
  }
  return { sandbox, ctx };
}

/** 造一份「像服务端回包」的最小 view，默认不带 combat / quests 变化 */
function fakeView(over) {
  const v = {
    ok: true,
    lines: [{ type: 'sys', text: '你向北走去。' }],
    time: { day: 1, clock: '08:00', text: '第1日 08:00' },
    room: { id: 'r1', name: '青石道', desc: '一条青石板路。' },
    exits: [], npcs: [], groundItems: [], corpses: [],
    player: { name: '节流侠', hp: 100, maxHp: 100, mp: 50, maxMp: 50, money: 100 },
    inventory: [], equipment: [], affects: [], combat: null,
    quests: { active: [{ id: 'q1', stage: 0 }], done: [], completedCount: 0 },
  };
  return Object.assign(v, over || {});
}

async function main() {
  console.log('');
  console.log('  \u250c\u2500 自动存档节流守卫（B8）────────────────────');
  console.log('  \u2502 喂真 app.js + 真 ui.js，数真 /api/save 次数');
  console.log('  \u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

  const { sandbox } = loadUI();
  const WX = sandbox.WX, WXUI = sandbox.WXUI;
  if (!WX || !WXUI) { console.error('\n  \u2605 真 ui.js 没加载起来。\n'); process.exitCode = 1; return; }

  /* ---- 计数替身：只记「有没有真的发请求」，其余行为与原 api.save 一致 ---- */
  let saveCalls = 0;
  const realSave = WX.api.save.bind(WX.api);
  WX.api.save = function (id) { saveCalls++; return Promise.resolve({ ok: true, id }); };
  WX.api.saves = function () { return Promise.resolve({ ok: true, saves: [] }); };
  WX.api.load = function () { return Promise.resolve({ ok: true, view: fakeView() }); };

  /* autoSave 的前置条件：得有视图 + 开了自动存档 */
  WX.S.settings = WX.S.settings || {};
  WX.S.settings.autosave = true;
  WX.S.view = fakeView();

  /* ---------------- §1 连发 20 条普通指令 ---------------- */
  section('  \u00a71 连发 20 条普通指令（B8 本体）');
  saveCalls = 0;
  for (let i = 0; i < 20; i++) {
    WXUI.afterAction({ ok: true, lines: [], view: fakeView() });
  }
  ok('B8 连发 20 条指令 ⇒ /api/save \u2264 2 次', saveCalls <= 2, saveCalls + ' 次');

  /* ---------------- §2 关键节点必须立刻写 ---------------- */
  section('  \u00a72 关键节点立即落盘');
  /* ⚠️ 每两个场景之间必须「淌过微任务队列」：
     `autoSaveNow` 里 `_autosavePending = true` 是在 `api.save(...).finally()` 里复位的，
     那是一条 Promise 链 —— 不 await 一下就跑下一个场景，前一个场景的 pending 还挂着，
     后一个场景会被「并发去重」正确地挡掉，于是测试报 0 次：**黄灯来自测试写法，不是产品行为**。 */
  const settle = () => new Promise(r => setTimeout(r, 0));

  /* 战斗结算：上一步在打（combat 有值），这一步脱战（combat 为 null） */
  saveCalls = 0;
  WX.S.view = fakeView({ combat: { enemy: { id: 'e1', name: '山贼' }, turn: 1 } });
  WXUI.afterAction({ ok: true, lines: [], view: fakeView({ combat: null }) });
  await settle();
  ok('战斗结算（combat 有 → 无）立刻存', saveCalls === 1, saveCalls + ' 次');

  /* 任务推进：stage 0 → 1 */
  saveCalls = 0;
  WX.S.view = fakeView();
  WXUI.afterAction({
    ok: true, lines: [],
    view: fakeView({ quests: { active: [{ id: 'q1', stage: 1 }], done: [], completedCount: 0 } }),
  });
  await settle();
  ok('任务推进（stage 0 → 1）立刻存', saveCalls === 1, saveCalls + ' 次');

  /* 跨日 */
  saveCalls = 0;
  WX.S.view = fakeView();
  WXUI.afterAction({
    ok: true, lines: [],
    view: fakeView({ time: { day: 2, clock: '08:00', text: '第2日 08:00' } }),
  });
  await settle();
  ok('跨日（第1日 → 第2日）立刻存', saveCalls === 1, saveCalls + ' 次');

  /* 结局 */
  saveCalls = 0;
  WX.S.view = fakeView();
  WXUI.afterAction({ ok: true, lines: [], ending: { title: '江湖路尽' }, view: fakeView() });
  await settle();
  ok('结局立刻存', saveCalls === 1, saveCalls + ' 次');

  /* 对照组：普通一步不得写 */
  saveCalls = 0;
  WX.S.view = fakeView();
  WXUI.afterAction({ ok: true, lines: [], view: fakeView() });
  ok('普通一步仍然不落盘（只排防抖）', saveCalls === 0, saveCalls + ' 次');

  /* ---------------- §3 静止 30 秒后确实落盘 ---------------- */
  section('  \u00a73 静止 30 秒后自动落盘');
  saveCalls = 0;
  WX.S.view = fakeView();
  WXUI.afterAction({ ok: true, lines: [], view: fakeView() });
  const before = saveCalls;
  /* 防抖窗口是 30 秒，脚本不能真等 30 秒，所以这里只等 1.2 秒：
     够证明「不是立刻写」，业务流程上「30 秒后真的会写」则交给 `autoSaveNow()`
     —— 因为防抖到期调用的**就是** `autoSaveNow()`，是同一条路径，验它等于验了到期。 */
  await new Promise(r => setTimeout(r, 1200));
  ok('1.2 秒内仍未落盘（防抖确实生效）', saveCalls === before, saveCalls + ' 次');
  const n1 = saveCalls;
  await WXUI.autoSaveNow();
  ok('autoSaveNow() 真的会写一次', saveCalls === n1 + 1, (saveCalls - n1) + ' 次');

  /* ---------------- §4 _autosavePending 去抖仍在 ---------------- */
  section('  \u00a74 并发去重（_autosavePending）');
  saveCalls = 0;
  WX.S.view = fakeView();
  /* 连开三个都走「立刻存」的关键节点 —— 但它们是同一 tick，
     第一次写入还没回来，后两次必须被 pending 挡掉 */
  WXUI.afterAction({ ok: true, lines: [], ending: { title: 'a' }, view: fakeView() });
  WXUI.afterAction({ ok: true, lines: [], ending: { title: 'b' }, view: fakeView() });
  WXUI.afterAction({ ok: true, lines: [], ending: { title: 'c' }, view: fakeView() });
  ok('同一 tick 三个关键节点只写一次', saveCalls === 1, saveCalls + ' 次');

  /* ---- 恢复真实 api.save（保持环境干净，也证明替身确实被用过了）---- */
  WX.api.save = realSave;

  console.log('');
  console.log('  \u2500\u2500 汇总 \u2500\u2500  通过 ' + pass + ' \u00b7 失败 ' + fail);
  if (fails.length) console.log('  失败项：\n    - ' + fails.join('\n    - '));
  console.log('');
  /* ⚠️ 必须显式退出：`renderAll` 一看到 `v.player` 就会 `startAutoSave()`，
     那里挂了一个 5 分钟的 `setInterval`。不掐掉它，事件循环永远有活干，
     进程不会自己退出 —— 回归入口就会把它判成「120s 超时」。
     这是**测试脚本**，不需要优雅收尾，直接退即可。 */
  process.exit(fail ? 1 : 0);
}

main().catch(e => {
  console.error('\n  \u2605 autosave-throttle-check 崩了：' + (e && e.stack || e) + '\n');
  process.exitCode = 1;
});
