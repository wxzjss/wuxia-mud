/**
 * _tmp-map-verify.js —— 主人 2026-10-10 地图界面四项改造的自验
 *
 *   ① 城市/区域名移出外框（不在框内、不被框盖）
 *   ② 视角自动追随玩家格：每次渲染后玩家格落在視口正中附近
 *   ③ 区域名按钮：数量=后端区域数、名字一致；点击后视角平移到该区域中心
 *   ④ 无战争迷雾：无法雾层元素、未探索地块名不再被涂透明
 *
 * 真渲染：用 vm 载入**真 ui.js/app.js**，喂**真 GameEngine.view()**，
 * 走真入口 WXUI.panel('map')，读真 innerHTML；真点按钮走真绑定的 onclick。
 * ⚠️ 与 smoke-mapui 同源的最小 DOM stub（querySelectorAll 按选择器缓存、canvas 可记录监听）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const CSSF = path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css');
const UIF = path.join(RJS, 'ui.js');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- DOM stub（与 smoke-mapui 同源，够跑真 ui.js） ---------------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '',
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
    remove() {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
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
    focus() {}, blur() {}, click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0, scrollLeft: 0, scrollWidth: 0, clientWidth: 0, clientHeight: 0,
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
  /* ⚠️ 只扫**开标签**（不做配对）。老写法用 `<tag ...>[\s\S]*?</tag>` 配对，
     父标签（如 .map-region-nav / .map-scope）会把里面的 button 整个吞掉 →
     嵌套的 [data-*] 按钮查不到。本测试要按属性选到嵌套按钮，故改扫每个开标签。 */
  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?>/g;
  let m2;
  while ((m2 = tagRe.exec(html)) !== null) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = are.exec(m2[2] || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    }
    const g = { tag: m2[1].toLowerCase(), attrs, text: '' };
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
function makeCanvas() {
  const el = makeEl('div');
  el.scrollLeft = 0; el.scrollTop = 0;
  el.scrollWidth = 6000; el.clientWidth = 375; el.scrollHeight = 6000; el.clientHeight = 400;
  el.__cap = {}; el.__bub = {};
  el.addEventListener = function (t, f, opts) {
    const cap = opts === true || !!(opts && opts.capture);
    (cap ? el.__cap : el.__bub)[t] = (cap ? el.__cap : el.__bub)[t] || [];
    (cap ? el.__cap : el.__bub)[t].push(f);
  };
  el.removeEventListener = function () {};
  el.__bubble = (t, ev) => (el.__bub[t] || []).slice().forEach(f => f(ev));
  return el;
}
function makeEnv(opts) {
  const o = opts || {};
  const innerWidth = o.innerWidth || 375;
  const store = {}, els = {}, winL = {};
  const canvas = makeCanvas();
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
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
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth, innerHeight: 800, screen: { width: innerWidth, height: 800 },
    __winL: winL,
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); }, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) }, WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  env.__canvas = canvas;
  return env;
}
function loadUi(env) {
  vm.createContext(env);
  for (const f of ['app.js', 'ui.js']) vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  return env;
}
const settle = () => new Promise(r => setImmediate(r));

async function openMap(env, view) {
  env.WX.api.view = async () => ({ ok: true, view });
  env.WX.api.exec = async () => ({ ok: true, lines: [] });
  env.WX.api.markGuide = async () => ({ ok: true });
  env.WX.S.view = view;
  env.WX.S.busy = false;
  await env.WXUI.panel('map');
  await settle();
  return env.document.getElementById('modal-body');
}

/* ---------------- 从 HTML 解析几何 ---------------- */
function px(st, k) { const r = String(st || '').match(new RegExp('(?:^|;)\\s*' + k + ':\\s*(-?[0-9.]+)px')); return r ? parseFloat(r[1]) : null; }
function parseBoxes(html) {
  const out = [];
  const re = /<div class="map-region-box"([^>]*)>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const a = m[1], inner = m[2];
    const st = (a.match(/style="([^"]*)"/) || [])[1] || '';
    const rid = (a.match(/data-region-box="([^"]*)"/) || [])[1] || '';
    out.push({
      id: rid, inner,
      left: px(st, 'left'), top: px(st, 'top'), width: px(st, 'width'), height: px(st, 'height'),
      cx: parseFloat((a.match(/data-cx="([^"]*)"/) || [])[1]),
      cy: parseFloat((a.match(/data-cy="([^"]*)"/) || [])[1]),
    });
  }
  return out;
}
function parseLabels(html) {
  const out = [];
  const re = /<span class="mrb-label" style="([^"]*)" data-region-box="([^"]*)">([^<]*)<\/span>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ id: m[2], name: m[3], left: px(m[1], 'left'), top: px(m[1], 'top'), fontSize: px(m[1], 'font-size') });
  }
  return out;
}
function parseRegionBtns(html) {
  const out = [];
  const re = /<button class="mrn-btn[^"]*" data-pan-region="([^"]*)">\s*<i[^>]*><\/i>([^<]*)<\/button>/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ id: m[1], name: m[2] });
  return out;
}
function parseNodes(html) {
  const out = [];
  const re = /<button class="([^"]*map-node[^"]*)"([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const st = (m[2].match(/style="([^"]*)"/) || [])[1] || '';
    const nm = m[2].match(/<span class="mn-name"[^>]*>([^<]*)<\/span>/);
    out.push({ cls: m[1], left: px(st, 'left'), top: px(st, 'top'), width: px(st, 'width'), label: nm ? nm[1] : '' });
  }
  return out;
}

/* ---------------- 主流程 ---------------- */
const SEED = 20261010;
const engine = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
engine.boot();
engine.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });

(async function main() {
  const view = engine.view();
  const mregions = view.map.regions || [];

  /* ============ ① 城市名在外框外 ============ */
  section('① 城市/区域名移到外框外侧');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const modal = await openMap(env, view);
    const html = modal.innerHTML;
    const boxes = parseBoxes(html);
    const labels = parseLabels(html);
    ok('①-1 渲染出区域外框', boxes.length > 0, boxes.length + ' 个框');
    ok('①-2 渲染出区域名标签', labels.length > 0, labels.length + ' 个标签');
    ok('①-3 每个框都有对应名字标签', boxes.every(b => labels.some(l => l.id === b.id)),
      labels.map(l => l.name).join('、'));
    ok('①-4 ★ 名字标签**不在框内**（框 div 自身不含 mrb-label）',
      boxes.every(b => b.inner.indexOf('mrb-label') < 0),
      boxes.find(b => b.inner.indexOf('mrb-label') >= 0) ? '有框把标签包在里面' : '全部在框外');
    const bad = [];
    labels.forEach(l => {
      const b = boxes.find(x => x.id === l.id);
      if (!b) return;
      const lh = (l.fontSize || 11) * 1.3;
      if (!(l.top < b.top)) bad.push(l.name + ' top ' + l.top + ' 未在框顶 ' + b.top + ' 之上');
      if (!(l.top + lh <= b.top)) bad.push(l.name + ' 底边压到框线');
      if (!(l.left >= b.left - 1)) bad.push(l.name + ' 左越界');
    });
    ok('①-5 ★ 每个名字都**完整位于框顶边之上**（不压框线、不被框挡）',
      bad.length === 0, bad.length ? bad.join(' | ') : labels.length + ' 个标签全在框外上方');
    const css = fs.readFileSync(CSSF, 'utf8');
    const lblRule = (css.match(/\.mrb-label\s*\{[^}]*\}/) || [''])[0];
    ok('①-6 标签 CSS 有独立高层级（z-index:6，压在地块之上不被盖）',
      /z-index:\s*6/.test(lblRule), lblRule.slice(0, 120));
  }

  /* ============ ② 视角自动追随玩家（玩家居中） ============ */
  section('② 每次渲染后视角自动追随玩家格居中');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const modal = await openMap(env, view);
    const cv = env.__canvas;
    const nodes = parseNodes(modal.innerHTML);
    const here = nodes.find(n => n.cls.split(/\s+/).indexOf('here') >= 0);
    ok('②-1 找到「你在这里」地块', !!here, here ? here.label : '-');
    const CELL = 52;
    function centered(nodes, html) {
      const h = nodes.find(n => n.cls.split(/\s+/).indexOf('here') >= 0);
      if (!h) return null;
      const side = h.width || 46;
      const centerX = h.left + side / 2, centerY = h.top + side / 2;
      const vx = (centerX - cv.scrollLeft) - cv.clientWidth / 2;
      const vy = (centerY - cv.scrollTop) - cv.clientHeight / 2;
      return { dx: Math.abs(vx), dy: Math.abs(vy) };
    }
    const c1 = centered(nodes);
    ok('②-2 ★ 首次开图：玩家格中心与视口中心偏差 ≤ 半格（横/纵）',
      c1 && c1.dx <= CELL / 2 && c1.dy <= CELL / 2,
      c1 ? `dx=${c1.dx.toFixed(1)} dy=${c1.dy.toFixed(1)} (阈 ${CELL / 2}) scroll=(${cv.scrollLeft},${cv.scrollTop})` : '无 here 格');

    /* 点「天下全图」重渲染 → 应再次自动追随玩家 */
    const scopeBtn = modal.querySelectorAll('#modal-body [data-scope]').find(b => b.getAttribute('data-scope') === 'world');
    ok('②-3 找到「天下全图」按钮（用于触发重渲染）', !!scopeBtn);
    if (scopeBtn) {
      scopeBtn.click();
      await settle(); await settle();
      const html2 = modal.innerHTML;
      const nodes2 = parseNodes(html2);
      const c2 = centered(nodes2);
      ok('②-4 ★ 切换视野重渲染后：玩家格仍被自动追到视口正中（≤ 半格）',
        c2 && c2.dx <= CELL / 2 && c2.dy <= CELL / 2,
        c2 ? `dx=${c2.dx.toFixed(1)} dy=${c2.dy.toFixed(1)}` : '无 here 格');
    }
  }

  /* ============ ③ 区域名按钮 ============ */
  section('③ 区域名按钮：数量/名字与后端一致，点击飞过去');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const modal = await openMap(env, view);
    let html = modal.innerHTML;
    const btns = parseRegionBtns(html);
    ok('③-1 渲染出区域名按钮', btns.length > 0, btns.length + ' 个');
    ok('③-2 ★ 按钮数量 == 后端区域数', btns.length === mregions.length,
      `按钮 ${btns.length} / 后端 ${mregions.length}`);
    const nameOk = btns.every((b, i) => mregions.some(r => r.id === b.id && r.name === b.name));
    ok('③-3 ★ 每个按钮的 id/名字都与后端一致（前端未硬编码名单）', nameOk,
      btns.slice(0, 4).map(b => b.name).join('、') + (btns.length > 4 ? ' …' : ''));

    /* 点一个**非当前**区域，验证视角真的平移过去 */
    const cid = (view.map.current && (view.map.rooms.find(r => r.current) || {}).region) || null;
    const target = btns.find(b => b.id !== cid) || btns[0];
    ok('③-4 选中一个非当前区域作为飞行目标', !!target, target ? target.name + '(' + target.id + ')' : '-');
    if (target) {
      const cv = env.__canvas;
      const stub = modal.querySelectorAll('#modal-body [data-pan-region]').find(b => b.getAttribute('data-pan-region') === target.id);
      ok('③-5 找到该按钮的已绑定 stub（onclick 已被 bindPanelActions 挂上）', !!stub);
      if (stub) {
        const before = { l: cv.scrollLeft, t: cv.scrollTop };
        stub.click();
        await settle(); await settle();   /* 切世界地图 → 重渲染 → centerMapOnRegion */
        html = modal.innerHTML;
        const worldBoxes = parseBoxes(html);
        const tb = worldBoxes.find(b => b.id === target.id);
        ok('③-6 重渲染后世界地图里能找到目标区域框', !!tb, tb ? `cx=${tb.cx} cy=${tb.cy}` : '无');
        if (tb && isFinite(tb.cx) && isFinite(tb.cy)) {
          const expL = Math.max(0, tb.cx - cv.clientWidth / 2);
          const expT = Math.max(0, tb.cy - cv.clientHeight / 2);
          ok('③-7 ★ 点击后视口平移到该区域中心',
            Math.abs(cv.scrollLeft - expL) <= 1 && Math.abs(cv.scrollTop - expT) <= 1,
            `实 (${cv.scrollLeft},${cv.scrollTop}) 期望 (${expL.toFixed(1)},${expT.toFixed(1)})`);
          ok('③-8 ★ 确实发生了平移（不再是玩家居中时的位置）',
            cv.scrollLeft !== before.l || cv.scrollTop !== before.t,
            `before=(${before.l},${before.t}) after=(${cv.scrollLeft},${cv.scrollTop})`);
        }
      }
    }
  }

  /* ============ ④ 无战争迷雾 ============ */
  section('④ 无战争迷雾');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const modal = await openMap(env, view);
    const html = modal.innerHTML;
    ok('④-1 无迷雾层 DOM（无 map-fog / fog-layer / mist 之类元素）',
      !/map-fog|fog-layer|fogbox|class="fog|迷雾层/i.test(html));
    const nodes = parseNodes(html);
    const unnamed = nodes.filter(n => !n.label || n.label === '');
    ok('④-2 ★ 所有地块都带名字（未探索地块不再「只留一个淡点」）',
      nodes.length > 0 && unnamed.length === 0, `${nodes.length} 格 / 无名 ${unnamed.length}`);

    const css = fs.readFileSync(CSSF, 'utf8');
    const unkRule = (css.match(/\.map-node\.unknown\s+\.mn-name\s*\{[^}]*\}/) || [''])[0];
    ok('④-3 ★ 未探索地块名的 CSS 不再涂透明（不再有视觉迷雾）',
      unkRule.indexOf('transparent') < 0 && /\bcolor\s*:/.test(unkRule), unkRule.trim());

    /* 源码证据：不存在迷雾绘制函数 / 迷雾层构造 */
    const src = fs.readFileSync(UIF, 'utf8');
    ok('④-4 源码里无迷雾绘制函数（无 fogLayer / drawFog / renderFog 之类）',
      !/function\s+\w*fog/i.test(src) && !/fog(Layer|Mask|Overlay)/.test(src));
  }

  console.log('\n———————————————————————————————');
  console.log(`  地图四项改造自验：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('———————————————————————————————');
  process.exitCode = fail ? 1 : 0;
})();
