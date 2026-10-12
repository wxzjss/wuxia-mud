/**
 * smoke-mapui.js —— 主人亲报 bug B14 专项回归（手机端地图 UI）
 *
 *  B14-a  地块名看不全：手机窄屏上，方块里的中文房间名被截断 / 挤成一团 / 看不清。
 *  B14-b  手滑动地图划不动：触屏上无法平移地图。
 *
 * 本脚本**真渲染 + 真触摸事件**，不看代码长相、不做静态 grep：
 *   · 用 vm 载入**真 ui.js / app.js**，喂**真 GameEngine.view()**，
 *     走**真入口** `WXUI.panel('map')`，再读 `#modal-body` 的真实 innerHTML。
 *   · 触摸平移：把 `#modal-body .map-canvas` 换成可记录监听的假画布，
 *     造**真触摸事件**（坐标只在 `e.touches[0]` 里，**没有** top-level clientX），
 *     打到 `bindMapPan` 真正绑上去的监听器上，看 scrollLeft/scrollTop 是否真的变。
 *   · 点击 vs 拖动：模拟「捕获阶段吞掉 click」，验证拖动不会误触「走过去」，
 *     而纯轻点仍能真的发出 `go <房间名>`。
 *
 * ⚠️ DOM stub 三坑（本项目踩过，照抄 smoke-owner-bugs.js）：
 *   ① querySelectorAll 必须按 (选择器, innerHTML) 缓存，否则 onclick 绑定全丢；
 *   ② innerHTML setter 必须清 children；
 *   ③ doCmd 是 async，点完要 await settle()。
 * ⚠️ 断言喂参 == 真实调用路径入参（view 来自真引擎，点击走真绑定的 onclick）。
 * ⚠️ 随机源固定 seed；存档走独立沙盒；不改 game/data/*.json。
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
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ================================================================
 *  DOM stub（最小实现，够跑真 ui.js）
 * ================================================================ */
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
    /* ⚠️ innerHTML 重设必须清 children（否则累积旧按钮 / onclick 捕获旧 view） */
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
    /* ★ 按 (选择器, innerHTML) 缓存，否则 onclick 绑定全丢、假报「点了没反应」 */
    querySelectorAll(sel) {
      const key = sel + ' ' + this._html;
      this.__qsel = this.__qsel || {};
      if (!this.__qsel[key]) this.__qsel[key] = parseSelectors(this._html, sel);
      return this.__qsel[key];
    },
    closest() { return null; },
    focus() { this._focus = (this._focus || 0) + 1; }, blur() { this._blur = (this._blur || 0) + 1; },
    click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
/** 从 HTML 按选择器抠元素（够本测试用；复杂选择器返回 []，宁可测不到也别假绿） */
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
    el._clicked = false;
    el.click = () => { el._clicked = true; if (typeof el.onclick === 'function') el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); };
    return el;
  });
}
/** 可记录监听的假画布：支持「捕获阶段 click 拦截」的模拟 */
function makeCanvas() {
  const el = makeEl('div');
  el.scrollLeft = 0; el.scrollTop = 0;
  el.scrollWidth = 2000; el.clientWidth = 375; el.scrollHeight = 2000; el.clientHeight = 400;
  el.__cap = {}; el.__bub = {};
  el.addEventListener = function (t, f, opts) {
    const cap = opts === true || !!(opts && opts.capture);
    const bag = cap ? el.__cap : el.__bub;
    (bag[t] = bag[t] || []).push(f);
  };
  el.removeEventListener = function (t, f, opts) {
    const cap = opts === true || !!(opts && opts.capture);
    const bag = cap ? el.__cap : el.__bub;
    if (bag[t]) bag[t] = bag[t].filter(x => x !== f);
  };
  el.__bubble = (t, ev) => (el.__bub[t] || []).slice().forEach(f => f(ev));
  /* 模拟「点击从画布冒泡到某后代按钮」：先跑画布捕获，被 stopPropagation 拦下就到不了按钮 */
  el.dispatchClickTo = function (btn) {
    let stopped = false;
    const ev = { target: btn, cancelable: true, defaultPrevented: false, _sp: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this._sp = true; stopped = true; } };
    (el.__cap.click || []).slice().forEach(f => f(ev));
    if (stopped) return { stopped: true, defaultPrevented: ev.defaultPrevented };
    if (btn && typeof btn.onclick === 'function') btn.onclick({ target: btn, preventDefault() {}, stopPropagation() {} });
    return { stopped: false, defaultPrevented: ev.defaultPrevented };
  };
  return el;
}
function makeEnv(opts) {
  const o = opts || {};
  const innerWidth = o.innerWidth || 1280;
  const store = {}, els = {}, winL = {};
  const canvas = makeCanvas();
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    /* bindMapPan 用 document.querySelector('#modal-body .map-canvas') 取画布 */
    querySelector(sel) { return /#modal-body\s+\.map-canvas/.test(String(sel)) ? canvas : null; },
    querySelectorAll(sel) {
      const m = String(sel).match(/#([A-Za-z0-9_-]+)/);
      if (!m || !els[m[1]]) return [];
      return els[m[1]].querySelectorAll(sel);
    },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', maxTouchPoints: 1, language: 'zh-CN' },
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
  env.__canvas = canvas;
  return env;
}
function loadUi(env) {
  vm.createContext(env);
  for (const f of ['app.js', 'ui.js']) {   /* ⚠️ 顺序不能反 */
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}
function settle() { return new Promise(r => setImmediate(r)); }

/** 走真入口打开地图面板，返回 { env, modal, html } */
async function openMap(env, view) {
  env.WX.api.view = async () => ({ ok: true, view });
  env.WX.api.exec = async (cmd, opt) => { env.sent.push({ cmd, opt: opt || null }); return { ok: true, lines: [] }; };
  env.sent = [];
  env.WX.S.view = view;
  env.WX.S.busy = false;
  await env.WXUI.panel('map');
  await settle();
  const modal = env.document.getElementById('modal-body');
  return { env, modal, html: modal.innerHTML };
}

/* ---- 从真渲染的 HTML 里解析方块（真几何 / 真名字） ---- */
function nodesFromHtml(html) {
  const out = [];
  const re = /<button class="([^"]*map-node[^"]*)"([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const cls = m[1], rest = m[2];
    const st = (rest.match(/style="([^"]*)"/) || [])[1] || '';
    const num = k => { const r = st.match(new RegExp('(?:^|;)\\s*' + k + ':\\s*(-?[0-9.]+)px')); return r ? parseFloat(r[1]) : null; };
    const nm = rest.match(/<span class="mn-name"[^>]*>([^<]*)<\/span>/);
    const attr = s => { const r = rest.match(new RegExp(s + '="([^"]*)"')); return r ? r[1] : null; };
    out.push({
      cls, left: num('left'), top: num('top'), width: num('width'), height: num('height'),
      fontSize: (() => { const r = ((nm && nm[0]) || '').match(/font-size:\s*([0-9.]+)px/); return r ? parseFloat(r[1]) : null; })(),
      label: nm ? nm[1] : '', room: attr('data-room'), go: attr('data-go'),
    });
  }
  return out;
}

const SEED = 20261010;
const engine = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
engine.boot();
engine.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });

/* ================================================================
 *  主流程
 * ================================================================ */
(async function main() {
  /* ---------- FE · 两份副本一致 + 版本戳 ---------- */
  section('FE · 两份 ui.js 同步 + 版本戳');
  {
    const A = path.join(RJS, 'ui.js');
    const B = path.join(ROOT, 'server', 'public', 'js', 'ui.js');
    const sa = fs.readFileSync(A, 'utf8'), sb = fs.readFileSync(B, 'utf8');
    ok('FE-1 两份 ui.js 逐字节一致', sa === sb, `len ${sa.length} vs ${sb.length}`);
    const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
    const vers = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(x => x[1]);
    ok('FE-2 版本戳存在且全部一致（≥7 处；改前端必须顺推）',
      vers.length >= 7 && new Set(vers).size === 1, `${vers.length} 处 / ${[...new Set(vers)].join(',')}`);
  }

  /* ---------- 场景：挑一个「房间较多 + 含 >4 字房名」的区域，
       把玩家放进去，另取一个非当前的长名房间作为「窄屏 6 字 vs 宽屏 4 字」的对照 ---------- */
  const m0 = engine.view().map;
  const byReg = {};
  m0.rooms.forEach(r => { (byReg[r.region] = byReg[r.region] || []).push(r); });
  let bestReg = null;
  Object.keys(byReg).forEach(reg => {
    const list = byReg[reg];
    if (list.length < 2) return;
    if (!list.some(r => String(r.name || '').length > 4)) return;
    if (!bestReg || list.length > byReg[bestReg].length) bestReg = reg;
  });
  const regRooms = byReg[bestReg] || m0.rooms;
  const byLen = regRooms.slice().sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  const longSrc = byLen[0];
  const curSrc = regRooms.find(r => r.id !== longSrc.id) || m0.rooms.find(r => r.id !== longSrc.id);
  engine.world.player.room = curSrc.id;

  const view = engine.view();
  const hereRoom = view.map.rooms.find(r => r.current);
  const longRoom = view.map.rooms.find(r => r.id === longSrc.id);
  longRoom.visited = true;
  const LONG_NAME = String(longRoom.name);
  console.log(`\n  场景：当前区域=${hereRoom.region}　当前房间=「${hereRoom.name}」　长名房间=「${LONG_NAME}」(${LONG_NAME.length} 字)`);

  /* ================================================================
   *  B14-a （窄屏）地块名看得全
   * ================================================================ */
  section('B14-a · 手机窄屏（innerWidth=375）地块名看得全');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const { html } = await openMap(env, view);
    const nodes = nodesFromHtml(html);

    ok('A-1 窄屏渲染出地图画布', /class="map-canvas/.test(html));
    ok('A-2 窄屏画布带 map-narrow 类（触发自适应放大）', /class="map-canvas map-narrow"/.test(html));
    ok('A-3 渲染出房间方块', nodes.length > 0, nodes.length + ' 个');

    /* 🔴 2026-10-08 口径改动（主人三条地图要求）：
       ① 地块**不再画方块框**（「把地块里的方块框删掉，用纯地名显示」）
          ⇒ 节点的 width/height 就是**整格**（原来还差 4px 的缝 + 方块）；
       ② 名字**不再截断**（原来桌面 4 字 / 窄屏 6 字）⇒ 直接断「显示的就是全名」；
       ③ 区域模式**按弹窗可用宽高自动放大格距**（原来恒 30/52）。
       所以这一段的断法跟着换：格距从画布宽反推，名字断全名。 */
    const cell = nodes.length ? nodes[0].width : 0;
    const badW = nodes.filter(n => n.width !== cell || n.height !== cell);
    ok('A-4 窄屏节点占满整格（无方块框后尺寸=格距）', badW.length === 0 && cell > 0,
      badW.length ? JSON.stringify(badW[0]) : '全部 ' + cell + 'x' + cell);

    const pad = 30;   /* 窄屏 MAP_PAD */
    const badGeo = nodes.filter(n => n.left == null ||
      ((n.left - pad) % cell + cell) % cell !== 0 || ((n.top - pad) % cell + cell) % cell !== 0);
    ok('A-5 窄屏几何随格距自适应（无错位）', badGeo.length === 0,
      badGeo.length ? JSON.stringify(badGeo[0]) : '格距 ' + cell + 'px');

    /* 名字：★ 2026-10-13 主人报「唐门遮挡了旁边地块的名字」后改口径 ——
       格子里现在摆的是**短名**（`mapLabel()`，≤4 字，优先取「·」后那段），
       不再显示全名（全名一直在 `title` 与房间抬头里）。
       所以断法跟着换：**短名必须是全名的「合法切片」**（前缀或尾段），
       而不是随便糊一个。截断后对不上原名 = 有人把规则改坏了。 */
    const named = nodes.filter(n => n.label);
    const nameOf = {};
    (view.map.rooms || []).forEach(r => { nameOf[r.id] = r.name; });
    /* 短名合法切片：全名（≤4 字） / 「·」后那段 / 前 4 字。
       ⚠️ 三种都要按**码点**切（`[...s]`），不能用 `slice()` 的下标 ——
          「长安城·明德门」按 UTF-16 下标切前 4 位会砍出「长安城·」这种半截串。 */
    const legalShort = (full, label) => {
      const f = String(full || ''), l = String(label || '');
      if (!l) return false;
      if (l === f) return true;
      const dot = f.indexOf('·');
      if (dot > 0 && l === f.slice(dot + 1)) return true;         /* 「·」后那段 */
      if (l === [...f].slice(0, 4).join('')) return true;         /* 前 4 **码点** */
      return false;
    };
    const illegal = [];
    named.forEach(n => {
      if (!n.room) return;
      const full = nameOf[n.room];
      if (full === undefined) return;        /* 视野外的房间：没有可比对的来源，跳过 */
      if (!legalShort(full, n.label)) {
        illegal.push({ room: n.room, full: full, label: n.label });
      }
    });
    ok('A-6 格子里是房间名的合法短名（全名 / 「·」尾段 / 前 4 字，不糊名）',
      named.length > 0 && illegal.length === 0,
      illegal.length ? (illegal[0].room + ' 显示「' + illegal[0].label + '」，而全名是「' + illegal[0].full + '」')
        : '共 ' + named.length + ' 格，例：' + named.slice(0, 3).map(n => n.label).join('、'));

    /* ★ 主人的核心诉求：**格子里的短名不许压到邻格**。
       短名 ≤4 字、字号保持基准（窄屏 13px）⇒ 4×13=52px ≈ 一格（52px），
       不越界。这条断言直接量「最宽的名字有没有超出一格」。 */
    const cw = nodes.length ? nodes[0].width : 0;
    const overflow = named.filter(n => {
      const len = [...String(n.label)].length;
      return len * (n.fontSize || 0) > cw + 0.5;
    });
    ok('A-6b ★ 窄屏没有名字横向溢出格子（主人报的「压住旁边地块名」）',
      cw > 0 && overflow.length === 0,
      overflow.length ? (overflow[0].label + ' 宽 ' + ([...overflow[0].label].length * overflow[0].fontSize) + 'px > 格 ' + cw + 'px')
        : '格宽 ' + cw + 'px，最宽名字 ' + named.reduce((a, n) => Math.max(a, [...String(n.label)].length * (n.fontSize || 0)), 0) + 'px');

    /* ★ 2026-10-13：长名房间的**短名**要出现（原来断「全名出现」，
       现在格子里是短名 —— 按 mapLabel 规则算一遍期望值，对不上就是规则被改坏）。 */
    const expShort = (() => {
      const s = String(LONG_NAME);
      if ([...s].length <= 4) return s;
      const d = s.indexOf('·');
      if (d > 0) { const t = [...s.slice(d + 1)]; if (t.length && t.length <= 4) return t.join(''); }
      return [...s].slice(0, 4).join('');
    })();
    ok('A-7 ★ 长名房间在格子里显示短名「' + expShort + '」（原「' + LONG_NAME + '」）',
      LONG_NAME.length > 4 && nodes.some(n => n.label === expShort),
      '期望「' + expShort + '」，实际有：' + named.slice(0, 8).map(n => n.label).join('、'));

    /* ⚠️ 别假设「style 紧跟在 class 后面」——属性顺序是我这边可以随时调整的自由
       （重设计时在中间插了个 tabindex，这条就假红了一次）。
       只在**整个 map-canvas 开标签**里找 width。 */
    const canvasTag = (html.match(/<div class="map-canvas[\s\S]{0,400}?>/) || [''])[0];
    const W = parseFloat((canvasTag.match(/style="[^"]*width:(\d+)px/) || [])[1] || '0');
    ok('A-8 窄屏画布内容宽 > 360px（比手机屏宽 → 才需要/能够平移）', W > 360, 'W=' + W);

    /* 🔴 主人 2026-10-12 亲报「世界地图地块显示不全」的正式守卫。
       根因：SVG 连线层用**内联 width/height = 内容真实像素**（如 892），
       而画布被 `max-width:100%` 压到手机宽（约 343）⇒ SVG 作为替换元素被
       **按视口等比缩小**，绝对定位的地块 div 却不缩 ⇒ 线与格子错位。
       修法：CSS 里 `.map-edges { width:100%; height:100% }`，让 SVG 铺满画布
       内容盒、不按自身尺寸缩。这条断言两层都守：
         · HTML 层 —— 画布宽度能反查到 SVG 存在（生成侧没变）；
         · CSS 层 —— `.map-edges` 必须声明 width/height:100%（否则又会缩）。
       ⚠️ CSS 必须查真规则，别查注释里的字（本项目踩过「注释里有字样被误判」）。 */
    const cssSrc = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
    const edRule = (cssSrc.match(/\.map-edges\s*\{[^}]*\}/) || [''])[0];
    ok('A-9 ★ .map-edges 声明了 width/height:100%（不然窄屏 SVG 会等比缩小、与地块错位）',
      /width:\s*100%/.test(edRule) && /height:\s*100%/.test(edRule),
      edRule.replace(/\s+/g, ' ').slice(0, 90) || 'NOT FOUND');
    /* 反证：SVG 的内联尺寸仍等于画布内容尺寸（生成侧没被顺手改坏） */
    const svgTag = (html.match(/<svg class="map-edges"[^>]*>/) || [''])[0];
    const svgW = parseFloat((svgTag.match(/width="(\d+)"/) || [])[1] || '0');
    ok('A-10 SVG 内联宽 = 画布内容宽（两套坐标同源，缩了才错位）',
      svgW > 0 && Math.abs(svgW - W) < 1.5, 'svg=' + svgW + ' canvas=' + W);
  }

  /* ================================================================
   *  B14-a （宽屏）桌面观感零改动
   * ================================================================ */
  section('B14-a · 桌面宽屏（innerWidth=1280）');
  {
    const env = loadUi(makeEnv({ innerWidth: 1280 }));
    const { html } = await openMap(env, view);
    const nodes = nodesFromHtml(html);

    ok('A-9 宽屏画布无 map-narrow 类', !/class="map-canvas map-narrow"/.test(html));
    const cell = nodes.length ? nodes[0].width : 0;
    const badW = nodes.filter(n => n.width !== cell || n.height !== cell);
    ok('A-10 宽屏节点同样占满整格', badW.length === 0 && cell > 0,
      badW.length ? JSON.stringify(badW[0]) : '全部 ' + cell + 'x' + cell);

    const named = nodes.filter(n => n.label);
    const nameOf2 = {};
    (view.map.rooms || []).forEach(r => { nameOf2[r.id] = r.name; });
    const legalShort2 = (full, label) => {
      const f = String(full || ''), l = String(label || '');
      if (!l) return false;
      if (l === f) return true;
      const dot = f.indexOf('·');
      if (dot > 0 && l === f.slice(dot + 1)) return true;
      if (l === [...f].slice(0, 4).join('')) return true;
      return false;
    };
    const illegal2 = [];
    named.forEach(n => {
      if (!n.room) return;
      const full = nameOf2[n.room];
      if (full === undefined) return;
      if (!legalShort2(full, n.label)) illegal2.push({ room: n.room, full: full, label: n.label });
    });
    ok('A-11 宽屏短名同样是合法切片（不再显示全名）', named.length > 0 && illegal2.length === 0,
      illegal2.length ? (illegal2[0].label + ' ← ' + illegal2[0].full) : '共 ' + named.length + ' 格');
    /* ★ 2026-10-13 改口径：字号**不再随名字长度缩**（缩字号那版实测 300/311 个名字
       被压到 6px，糊成蚂蚁，被推翻）。现在一律基准字号：**短名 ≤4 字、7px 基准**
       （7px 是「4 字 × 7px = 28px ≤ 30px 格」的最大档，见 ui.js 的 mFont 注释）。
       这条断「只在基准这两档上，不许再出现 6px 缩过头」。 */
    const fonts = [...new Set(named.map(n => n.fontSize))];
    ok('A-12 宽屏字号只有基准档（7px 常规 / 8px「你在这里」）',
      fonts.length > 0 && fonts.every(f => f >= 7 && f <= 13), '字号=' + JSON.stringify(fonts));

    /* 几何：格距从节点宽度反推（区域模式会按弹窗放大，不再恒 30px） */
    const pad = 34;
    const badGeo = nodes.filter(n => ((n.left - pad) % cell + cell) % cell !== 0);
    ok('A-13 宽屏几何随格距自适应（格距 ≥ 30px）', badGeo.length === 0 && cell >= 30,
      badGeo.length ? JSON.stringify(badGeo[0]) : '格距 ' + cell + 'px');

    /* ★ 主人报的「压字」在宽屏同样要守住（桌面 30px 格、4 字 8px = 32px，
       靠 CSS 的 letter-spacing -.2px 与 max-width:100%;overflow:hidden 吃下）。 */
    const over2 = named.filter(n => [...String(n.label)].length * (n.fontSize || 0) > cell + 0.5);
    ok('A-14 ★ 宽屏也没有名字横向溢出格子（4 字 8px 略宽于 30px 格，由 CSS 收住）',
      cell > 0 && over2.length === 0,
      over2.length ? (over2[0].label + ' 宽 ' + ([...over2[0].label].length * over2[0].fontSize) + 'px > 格 ' + cell)
        : '格 ' + cell + 'px，最宽 ' + named.reduce((a, n) => Math.max(a, [...String(n.label)].length * (n.fontSize || 0)), 0) + 'px');
    const cssSrc2 = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
    const mnRule = (cssSrc2.match(/\.map-node \.mn-name\s*\{[^}]*\}/) || [''])[0];
    ok('A-15 ★ .mn-name 声明了 overflow:hidden + max-width:100%（兜住任何漏网的长名）',
      /overflow:\s*hidden/.test(mnRule) && /max-width:\s*100%/.test(mnRule),
      mnRule.replace(/\s+/g, ' ').slice(0, 100) || 'NOT FOUND');
    ok('A-16 ★ .mn-name 用了 nowrap（短名不再折行撑高格子）',
      /white-space:\s*nowrap/.test(mnRule), mnRule.replace(/\s+/g, ' ').slice(0, 100));
  }

  /* ================================================================
   *  B14-b · 触摸平移（真 bindMapPan + 真触摸事件）
   * ================================================================ */
  section('B14-b · 触屏平移地图（坐标只在 e.touches[0]）');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    await openMap(env, view);
    const cv = env.__canvas;

    ok('B-1 画布绑定了 touchstart（不只 mousedown）', (cv.__bub.touchstart || []).length > 0);
    ok('B-2 window 绑定了 touchmove / touchend',
      (env.__winL.touchmove || []).length > 0 && (env.__winL.touchend || []).length > 0);

    const tEv = (x, y) => {
      const ev = { touches: [{ clientX: x, clientY: y }], changedTouches: [{ clientX: x, clientY: y }], cancelable: true, _pd: false };
      ev.preventDefault = function () { this._pd = true; };
      return ev;
    };
    const start = tEv(200, 200);
    ok('B-3 触摸事件本身没有 clientX（真触摸形状，非鼠标伪装）', start.clientX === undefined);

    /* ★ B14-c（第二轮主人报「手机端只能上下滑，不能左右/斜着滑」）：
       开图会自动把「你在这里」挪到视野正中（centerMapOnHere），
       所以画布的 scrollLeft/scrollTop 一进来就**不是 0**。这里改断「相对位移」，
       绝对值断言会随居中策略改动而假红 —— 顺带证明居中真的执行过。 */
    ok('B-3b ★ 开图已自动居中（滚动位置非 0，说明真把自己挪进了视野）',
      cv.scrollLeft > 0 && cv.scrollTop > 0,
      'scrollLeft=' + cv.scrollLeft + ' scrollTop=' + cv.scrollTop);

    const l0 = cv.scrollLeft, t0 = cv.scrollTop;
    const moveEv = tEv(120, 150);
    cv.__bubble('touchstart', start);
    (env.__winL.touchmove || []).forEach(f => f(moveEv));
    ok('B-4 ★ 触摸拖动 → scrollLeft 相对增大 80（**横向真能滑**：以前横向从不溢出，' +
      'scrollLeft 恒被夹成 0）',
      cv.scrollLeft === l0 + 80, `${l0} -> ${cv.scrollLeft}`);
    ok('B-5 ★ 触摸拖动 → scrollTop 相对增大 50（双轴同时走 = 斜向）',
      cv.scrollTop === t0 + 50, `${t0} -> ${cv.scrollTop}`);
    ok('B-6 拖动时 touchmove 被 preventDefault（不把整页拖着走）', moveEv._pd === true);
    ok('B-7 拖动中进入 panning 态（视觉反馈）', cv.classList.contains('panning'));

    (env.__winL.touchend || []).forEach(f => f(tEv(120, 150)));
    ok('B-8 松手后退出 panning 态', !cv.classList.contains('panning'));
    ok('B-9 拖动后装上捕获期 click 拦截（防拖完误走路）', (cv.__cap.click || []).length > 0);
  }

  /* ---- 纯轻点（未超阈值）不装拦截 ---- */
  section('B14-b · 轻点（未超阈值）不装 click 拦截');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    await openMap(env, view);
    const cv = env.__canvas;
    const tEv = (x, y) => ({ touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {} });
    cv.__bubble('touchstart', tEv(100, 100));
    (env.__winL.touchmove || []).forEach(f => f(tEv(102, 101)));
    (env.__winL.touchend || []).forEach(f => f(tEv(102, 101)));
    ok('B-10 轻点不装 click 拦截（否则点不动方块）', (cv.__cap.click || []).length === 0);
  }

  /* ================================================================
   *  地图「只看不点」vs 拖动
   *  🔴 2026-10-12 口径改动：主人「把一步可达删了」「把地图上地块名字的
   *     黄色字体呈现与可点击前往删了」。
   *     原来这一节守的是「轻点一步可达方块 → 真发出移动指令」，
   *     那个功能**已被主人删掉**，所以改守反向契约：
   *       · 地图上不再有 data-go（没有可点前往的格子）
   *       · 轻点地块**一条移动指令都不发**
   *       · 拖动之后那次轻点仍然被吞掉（拖动不误触，这条是独立的，必须留）
   * ================================================================ */
  section('地图不再可点前往（主人 10-12 删掉「可点击前往」）vs 拖动');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const { modal } = await openMap(env, view);
    ok('C-0 ★ 地块不再带 data-go（「一步可达」与可点前往已下线）',
      modal.querySelectorAll('#modal-body [data-go]').length === 0);
    ok('C-0b 地块本身照常渲染（地图没有被误删成空画布）',
      modal.querySelectorAll('#modal-body .map-node[data-room]').length > 0);

    /* ① 轻点任意地块 → 不应发出任何移动指令（现在只弹一下名字） */
    const nodeStub = modal.querySelectorAll('#modal-body .map-node[data-room]')[0];
    if (nodeStub) {
      env.sent.length = 0;
      env.__canvas.dispatchClickTo(nodeStub);
      await settle();
      const sent = env.sent.map(x => x.cmd);
      ok('C-1 ★ 轻点地块不发移动指令（不再是快捷移动面板）',
        sent.length === 0, sent.join(',') || '(空)');
    } else {
      ok('C-1 ★ 轻点地块不发移动指令（不再是快捷移动面板）', false, '没找到地块 stub');
    }

    /* ② 先拖动，再点同一方块 → 被吞掉 */
    const env2 = loadUi(makeEnv({ innerWidth: 375 }));
    const r2 = await openMap(env2, view);
    const nodeStub2 = r2.modal.querySelectorAll('#modal-body .map-node[data-room]')[0];
    const cv2 = env2.__canvas;
    const tEv = (x, y) => ({ touches: [{ clientX: x, clientY: y }], cancelable: true, preventDefault() {} });
    cv2.__bubble('touchstart', tEv(200, 200));
    (env2.__winL.touchmove || []).forEach(f => f(tEv(120, 150)));
    (env2.__winL.touchend || []).forEach(f => f(tEv(120, 150)));
    env2.sent.length = 0;
    const res = cv2.dispatchClickTo(nodeStub2);
    await settle();
    ok('C-2 拖动后点同一方块 → 被捕获层吞掉（不误触）',
      res.stopped === true && env2.sent.length === 0,
      'stopped=' + res.stopped + ' sent=' + (env2.sent.map(x => x.cmd).join(',') || '(空)'));
  }

  /* ================================================================
   *  地块名兜底：点方块弹完整名（触屏没有 hover）
   * ================================================================ */
  section('点方块弹完整房间名（触屏 title 提示看不到）');
  {
    /* ③ 点「当前所在」方块 → toast 完整名 */
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const { modal } = await openMap(env, view);
    const curStub = modal.querySelectorAll('#modal-body .map-node[data-room]')
      .find(b => b.getAttribute('data-room') === hereRoom.id && !b.getAttribute('data-go'));
    ok('C-3 找到「当前所在」方块（无 data-go）', !!curStub);
    if (curStub) {
      env.document.getElementById('toast').innerHTML = '';
      curStub.onclick();
      const toastHtml = env.document.getElementById('toast').innerHTML || '';
      ok('C-4 点当前方块 → 弹出完整房间名「' + hereRoom.name + '」',
        toastHtml.indexOf(hereRoom.name) >= 0, toastHtml || '(空)');
    }

    /* ④ 点「未探索」方块 → 不剧透名字（把一个非当前房间强制设为未探索，场景确定） */
    const env2 = loadUi(makeEnv({ innerWidth: 375 }));
    const v2 = engine.view();
    const cur2 = v2.map.rooms.find(r => r.current);
    const unknownRoom = v2.map.rooms.find(r => r.region === cur2.region && r.id !== cur2.id) || v2.map.rooms.find(r => r.id !== cur2.id);
    ok('C-5 存在非当前房间用于验证（不剧透）', !!unknownRoom, unknownRoom ? unknownRoom.name : '无');
    if (unknownRoom) {
      unknownRoom.visited = false; unknownRoom.near = false; unknownRoom.reach = false;
      const r2 = await openMap(env2, v2);
      const unkStub = r2.modal.querySelectorAll('#modal-body .map-node[data-room]')
        .find(b => b.getAttribute('data-room') === unknownRoom.id && !b.getAttribute('data-go'));
      if (unkStub) {
        env2.document.getElementById('toast').innerHTML = '';
        unkStub.onclick();
        const th = env2.document.getElementById('toast').innerHTML || '';
        ok('C-6 点未探索方块 → 只提示「尚未探索」，不泄露房间名',
          th.indexOf('尚未探索') >= 0 && th.indexOf(unknownRoom.name) < 0, th || '(空)');
      } else {
        ok('C-6 点未探索方块 → 只提示「尚未探索」，不泄露房间名', false, '未找到未探索方块 stub');
      }
    }
  }

  console.log('\n———————————————————————————————');
  console.log(`  B14 地图 UI 回归：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('———————————————————————————————');
  process.exitCode = fail ? 1 : 0;
})();
