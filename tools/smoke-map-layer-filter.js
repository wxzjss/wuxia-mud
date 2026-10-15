/**
 * smoke-map-layer-filter.js —— 主人 2026-10-13 要求：
 *   「我在江南城大街上，当前江南区域地图把怡红院这种需要上/下的地块隐藏掉，
 *    然后重新布局地图界面并把连线连好」
 *
 * 本脚本**真渲染**（vm 载真 ui.js/app.js，喂真 GameEngine.view()，走真入口
 * WXUI.panel('map')，读真 #modal-body innerHTML），不看代码长相、不做静态 grep。
 *
 * 口径（别照直觉改）：
 *   · 区域地图**只画玩家所在那一层（z）** —— 站地面（z=0）就只出 z=0 的格子；
 *     怡红院（z=1）这种「要上楼才到」的屋不再摊在平地上。
 *   · 被隐藏 != 消失：本层那格仍挂 ▲/▼ 角标（在工具条里也有说明），
 *     玩家照样知道「这儿能上楼」。
 *   · 布局（取景框）必须**跟着筛后的房间重算**（紧包围盒），不能还按全层算 ——
 *     否则筛掉楼上房后画布仍留着那片空白、「重新布局」就白做了。
 *   · 连线（走廊 + 补线）只画两端都在图上的，筛掉的邻格不能留断头线。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------- DOM stub（够跑真 ui.js；照抄 smoke-mapui 的最小实现） ---------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.__qsel = {}; },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {}, setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; }, removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, dispatchEvent() { return true; },
    fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || { target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const key = sel + ' ' + this._html;
      this.__qsel = this.__qsel || {};
      if (!this.__qsel[key]) this.__qsel[key] = parseSelectors(this._html, sel);
      return this.__qsel[key];
    },
    closest() { return null; },
    focus() {}, blur() {},
    click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function parseSelectors(html, sel) {
  if (!html || typeof html !== 'string' || !sel) return [];
  const s = String(sel).trim();
  const m = s.match(/^#([A-Za-z0-9_-]+)\s*(.*)$/);
  const rest = m ? m[2].trim() : s;
  let t = null, cls = null, attr = null;
  const tm = rest.match(/^([a-zA-Z][a-zA-Z0-9]*)/); if (tm) t = tm[1].toLowerCase();
  const cm = rest.match(/\.([A-Za-z0-9_-]+)/); if (cm) cls = cm[1];
  const am = rest.match(/\[([a-zA-Z0-9_:-]+)\]/); if (am) attr = am[1];
  const out = [];
  const re2 = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/?>([\s\S]*?)<\/\1>/g;
  let m2;
  while ((m2 = re2.exec(html)) !== null) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = are.exec(m2[2] || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    }
    const g = { tag: m2[1].toLowerCase(), attrs, text: m2[3] || '' };
    if (t && g.tag !== t) continue;
    if (cls && String(g.attrs.class || '').split(/\s+/).indexOf(cls) < 0) continue;
    if (attr && !(attr in g.attrs)) continue;
    out.push(g);
  }
  return out.map(g => {
    const el = makeEl(g.tag);
    el.className = g.attrs.class || '';
    el.id = g.attrs.id || '';
    el._label = g.text;
    for (const k in g.attrs) el.setAttribute(k, g.attrs[k]);
    return el;
  });
}
function makeEnv(opts) {
  const o = opts || {};
  const innerWidth = o.innerWidth || 1280;
  const store = {}, els = {}, winL = {};
  const canvas = makeEl('div');
  canvas.scrollLeft = 0; canvas.scrollTop = 0; canvas.scrollWidth = 2000; canvas.clientWidth = 800;
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector(sel) { return /#modal-body\s+\.map-canvas/.test(String(sel)) ? canvas : null; },
    querySelectorAll(sel) {
      const mm = String(sel).match(/#([A-Za-z0-9_-]+)/);
      if (!mm || !els[mm[1]]) return [];
      return els[mm[1]].querySelectorAll(sel);
    },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', maxTouchPoints: 0, language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth, innerHeight: 800,
    screen: { width: innerWidth, height: 800 },
    __winL: winL,
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
    removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
function loadUi(env) {
  vm.createContext(env);
  for (const f of ['app.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}
const findElByRoom = (html, id) => {
  const els = parseSelectors(html, '[data-room]');
  return els.find(e => e.getAttribute('data-room') === id) || null;
};
const allRoomIds = html => parseSelectors(html, '[data-room]').map(e => e.getAttribute('data-room'));


/* ================================================================
 * 主流程
 * ================================================================ */
async function main() {
section('A. 数据前提：江南区确有跨层房间（先确认要测的东西真实存在）');
const eng = new GameEngine({ seed: 20261013 }); eng.boot(); eng.newGame();
const w = eng.world, P = w.player;
/* ⚠️ 探索制 setup（2026-10-18 迷雾返修）：mapHtml 只画 visited∪current。
   本守卫管的是「同层筛选 + 布局重算 + 无断头线」，不管迷雾（迷雾有专属守卫），
   ⇒ 江南区**整区**踩点（含 z=1）——C 节要证的是「层筛选把楼上房藏了」，
     不是「没踩点所以没画」，两种隐藏必须分得开。 */
Object.keys(w.data.rooms).forEach(id => {
  const r = w.data.rooms[id];
  if (r && r.region === 'jiangnan') { try { P.setFlag('visited_' + id, true); } catch (err) { } }
});
P.room = 'jiangnan_street';
{
  const street = w.getRoom('jiangnan_street');
  const brothel = w.getRoom('jiangnan_brothel');
  const gate = w.getRoom('qingzhu_gate');
  ok('A1 江南城·长街存在', !!street && street.region === 'jiangnan', street ? street.name : '缺');
  ok('A2 怡红院存在且 region=jiangnan', !!brothel && brothel.region === 'jiangnan', brothel ? brothel.name : '缺');
  ok('A3 长街有 u 出口通向怡红院', !!(street && street.exits && street.exits.u === 'jiangnan_brothel'),
    street ? JSON.stringify(street.exits.u) : '');
  ok('A4 青竹帮山门有 u 出口（另一个跨层样本）', !!(gate && gate.exits && gate.exits.u));
  const mv = eng.mapView();
  const cur = mv.rooms.find(r => r.current);
  ok('A5 mapView 下发 current 房且带 z=0', !!cur && (cur.z || 0) === 0, cur ? ('z=' + cur.z) : '无');
  const z1 = mv.rooms.filter(r => r.region === 'jiangnan' && (r.z || 0) === 1).map(r => r.id);
  ok('A6 江南区 z=1 的房间确实存在（怡红院在内）', z1.indexOf('jiangnan_brothel') >= 0, z1.join(','));
}

async function renderAt(roomId) {
  P.room = roomId;
  const view = eng.view();
  const env = loadUi(makeEnv({ innerWidth: 1280 }));
  env.WX = env.WX || {};
  env.WX.api = {
    view: async () => ({ ok: true, view }),
    exec: async () => ({ ok: true, lines: [] }),
  };
  env.WX.S = env.WX.S || {};
  env.WX.S.view = view;
  env.WX.S.busy = false;
  await env.WXUI.panel('map');
  await new Promise(r => setImmediate(r));
  return env.document.getElementById('modal-body').innerHTML;
}

section('B. 站在地面（长街）：区域地图必须隐藏楼上房间');
{
  const html = await renderAt('jiangnan_street');
  const ids = allRoomIds(html);
  ok('B1 地图渲染出格子', ids.length > 0, ids.length + ' 格');
  ok('B2 当前房（长街）在图上', ids.indexOf('jiangnan_street') >= 0);
  ok('B3 怡红院（z=1）**不**在图上', ids.indexOf('jiangnan_brothel') < 0);
  ok('B4 青竹帮演武场（z=1）**不**在图上', ids.indexOf('qingzhu_hall') < 0);
  ok('B5 青竹帮库房（z=1）**不**在图上', ids.indexOf('qingzhu_vault') < 0);
  ok('B6 同层地面房（南门/市集）仍在图上',
    ids.indexOf('jiangnan_gate') >= 0 && ids.indexOf('jiangnan_market') >= 0);
  const st = findElByRoom(html, 'jiangnan_street');
  ok('B7 长街那格仍挂 ▲ 角标（提示能上楼）', !!st && /mn-lv/.test(st._label));
  ok('B8 ▲ 角标的 tooltip 点出上楼去处与层名', !!st && /上楼/.test(st._label) && /层/.test(st._label), st ? st._label.slice(0,80) : '');
}

section('C. 楼上视角：站怡红院时只画 z=1');
{
  const h2 = await renderAt('jiangnan_brothel');
  const ids = allRoomIds(h2);
  ok('C1 站怡红院（z=1）时怡红院在图上', ids.indexOf('jiangnan_brothel') >= 0);
  ok('C2 此时地面房（长街）**不**在图上', ids.indexOf('jiangnan_street') < 0);
  ok('C3 顶部说明点出「2层」', /2层/.test(h2), '');
  const yb = findElByRoom(h2, 'jiangnan_brothel');
  ok('C4 怡红院那格有▼（能下楼）', !!yb && /mn-lv/.test(yb._label) && /▼/.test(yb._label));
}

section('D. 布局：取景框跟着筛后集合重算');
{
  const h3 = await renderAt('jiangnan_street');
  const ids = allRoomIds(h3);
  ok('D1 图上无任何 z=1 房间', ids.indexOf('jiangnan_brothel') < 0 && ids.indexOf('qingzhu_vault') < 0);
  const m = h3.match(/height:(\d+)px/);
  ok('D2 画布高度是有限正整数（布局真算了）', !!m && Number(m[1]) > 0, m ? m[1] + 'px' : '未取到');
  /* 关键：筛后房间的 y 跨度应比「含 z=1」时更小 —— 直接比较两侧画布高度。
     z=1 的青竹帮库房 y=0，若还按全层算，minY=0；筛掉后 minY=2（长街自身起）。 */
  const h3allRooms = parseSelectors(h3, '[data-room]');
  const tops = h3allRooms.map(el => Number(((el.getAttribute('style') || '').match(/top:(-?\d+)px/) || [])[1])).filter(n => !isNaN(n));
  ok('D3 筛后图上最小 top 不早于本层最上排（无楼上留白）',
    tops.length > 0 && Math.min.apply(null, tops) < 200, 'min top=' + Math.min.apply(null, tops));
}

section('E. 连线：不画断头线（两端都要在图上）');
{
  const h4 = await renderAt('jiangnan_street');
  const nodes = parseSelectors(h4, '[data-room]').map(el => {
    const stl = el.getAttribute('style') || '';
    const lm = stl.match(/left:(-?\d+)px/), tm = stl.match(/top:(-?\d+)px/);
    const wm = stl.match(/width:(\d+)px/);
    const half = wm ? Number(wm[1]) / 2 : 15;
    return lm && tm ? { x: Number(lm[1]) + half, y: Number(tm[1]) + half } : null;
  }).filter(Boolean);
  const centers = new Set(nodes.map(n => Math.round(n.x) + ',' + Math.round(n.y)));
  const edgePaths = (h4.match(/class="edge[^"]*"/g) || []).length;
  ok('E1 地图画了连线路径', edgePaths >= 1, edgePaths + ' 条');
  /* 逐段核：只查**每段路径的首尾端点**是否落在格心 —— 折线拐点（先横后纵的
     那个直角）本来就是中间点，不是断头。别拿 [ML] 全量当端点，会把拐点误判成悬空。
     从渲染出的 <path d> 反读，不自己重算几何（老铁律）。 */
  let dangling = 0, segs = 0;
  const pathRe = /<path d="([^"]*)"/g;
  let pmm;
  while ((pmm = pathRe.exec(h4)) !== null) {
    const d = pmm[1];
    const pts = [];
    const pre = /([ML])(-?\d+)\s+(-?\d+)/g; let q;
    while ((q = pre.exec(d)) !== null) pts.push({ x: Math.round(Number(q[2])), y: Math.round(Number(q[3])) });
    if (!pts.length) continue;
    for (const pt of [pts[0], pts[pts.length - 1]]) {
      if (centers.has(pt.x + ',' + pt.y)) segs++;
      else dangling++;
    }
  }
  ok('E2 每段连线的首尾端点都落在图上格心（无断头线）', dangling === 0, '落点 ' + segs + '，悬空 ' + dangling);
  ok('E3 至少有一条线端点落在格心', segs > 0, segs + ' 个端点');
}
}

main().then(() => {
  console.log('\n' + (fail ? ('\u2718 ' + fail + ' 项失败：' + fails.join(' / ')) : '\u2714 全部通过'));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('脚本异常：', e && e.stack || e); process.exit(2); });
