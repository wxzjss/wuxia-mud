/* ============================================================
 * smoke-round2-map.js — 第二轮主人报「地图显示问题 / 附近位置对不上」的几何专项
 *
 *   主人原话：「地图显示问题，地图上显示的附近位置与人物实际所在位置不符」。
 *   两个具体根因：
 *     ① 方向表只写了 n/s/e/w/u/d —— 全图 650 条出口里有 **124 条是斜向**
 *        （ne/nw/se/sw，占 19%）。走廊连线那一步是
 *        `const d = DIR_OFF[dir]; if (!d) return;` → 斜着相连的两个房间**画不出连线**，
 *        看着像隔了老远；出口行还会印出英文 `ne`。
 *     ② 开图不居中：画布是整块区域大小（窄屏 892×892），手机可视区只有 ~343×400，
 *        停在左上角 → 自己的格子在视野外，眼前全是「别处」。
 *
 *   ★ 这里断的是**几何**，不是 grep 源码：
 *     按真实地图数据算出「该画多少条走廊」（含斜向），再数真渲染出来的
 *     <path d> 里有几段 M…L…，两边必须相等 —— 少一条都没得含糊。
 *   （居中那一条在 smoke-mapui.js 里断，那边的假画布带 clientWidth/scrollLeft。）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}

/* ---- 最小 DOM stub（够跑 panel('map')；与 smoke-uiux 同源，只留用得到的） ---- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; }, toggle(c, on) { const h = this.contains(c); const w = on === undefined ? !h : !!on; if (w) this.add(c); else this.remove(c); return w; } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { return c; }, remove() {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; }, removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); }, removeEventListener() {},
    dispatchEvent() { return true; }, fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || {})); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, click() { if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0, scrollLeft: 0, scrollWidth: 0, clientWidth: 0, clientHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {}, cloneNode() { return makeEl(this.tagName); },
    firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function loadUi(innerWidth) {
  const store = {}, els = {}, winL = {}, docL = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'), createTextNode: t => ({ textContent: t }),
  };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, document: doc,
    location: { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} },
    navigator: { userAgent: 'node-check', maxTouchPoints: 1, language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; }, requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth, innerHeight: 800, screen: { width: innerWidth, height: 800 },
    addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); }, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) }, WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  vm.createContext(env);
  for (const f of ['app.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}
const settle = () => new Promise(r => setImmediate(r));

/* ---- 与 ui.js 的 DIR_OFF 对表（含斜向） ---- */
const DIR_OFF = {
  n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
  ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
};

(async function main() {
  const engine = new GameEngine({ seed: 20261010, saveDir: SAVE_DIR });
  engine.boot();
  engine.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  const w = engine.world, p = w.player;
  const mv = engine.mapView();

  console.log('\n§R2-1 地图走廊几何：斜向相连也必须画出连线');
  {
    const curRegion = mv.region && mv.region.id;
    const rooms = mv.rooms.filter(r => r.region === curRegion);
    ok('R2-1-0 当前区域确有房间（前提）', rooms.length > 0, `region=${curRegion} rooms=${rooms.length}`);

    /* 按真实数据算出「该画几条走廊」：每个有向邻接对一条（正交 + 斜向） */
    let ortho = 0, diag = 0; const diagSamples = [];
    rooms.forEach(r => {
      (r.exits || []).forEach(d => {
        const off = DIR_OFF[d];
        if (!off) return;
        const nb = rooms.find(x => x.x === r.x + off[0] && x.y === r.y + off[1]);
        if (!nb) return;
        if (String(d).length === 2) { diag++; if (diagSamples.length < 3) diagSamples.push(r.name + '—' + d + '→' + nb.name); }
        else ortho++;
      });
    });
    ok('R2-1-1 前提：本区域存在**斜向相邻**的房间对（否则本条测不出东西）',
      diag > 0, `正交 ${ortho} 条 / 斜向 ${diag} 条　例：${diagSamples.join(' | ')}`);

    const env = loadUi(375);
    env.WX.api.exec = async () => ({ ok: true, lines: [] });
    env.WX.api.view = async () => ({ ok: true, view: engine.view() });
    env.WX.api.markGuide = async () => ({ ok: true });
    env.WX.S.busy = false;
    await env.WXUI.panel('map');
    await settle();
    const html = String(env.document.getElementById('modal-body').innerHTML || '');

    /* 真渲染出来的**走廊**段数：只数 `edge-dim` / `edge-known`（这两条是走廊），
       排除 `edge-link`（有出口但坐标不相邻的**补线**，2026-10-13 恢复画之后
       它们也进了 SVG）和 `edge-far`（远档细淡线）。
       ⚠️ 口径必须只数走廊 —— 这条测的是「斜向相邻有没有画出连线」，
          补线是另一回事（它们**本来就不相邻**，算进来必然对不上）。
          第一版把 `ds` 收成「全部 path 的 M 段」→ 补线混进来 → 虚高 12 段假红。 */
    const corridorD = [...html.matchAll(/<path d="([^"]*)" class="edge edge-(dim|known)"\/>/g)]
      .map(m => m[1]).join(' ');
    const segs = (corridorD.match(/M/g) || []).length;
    ok('R2-1-2 ★ 画出的走廊段数 = 正交 + 斜向（斜向少一条都不算过）',
      segs === ortho + diag, `渲染 ${segs} 段 / 应有 ${ortho + diag} 段（正交 ${ortho} + 斜向 ${diag}）`);
    ok('R2-1-3 ★ 画出的段数**大于**只算正交时的段数（这就是「斜向没连线」的直接判据）',
      segs > ortho, `渲染 ${segs} 段 > 正交-only ${ortho} 段`);

    /* 出口行不许出现英文方向（ne/nw/se/sw 必须译成中文） */
    const now = (html.match(/<div class="map-now">([\s\S]*?)<\/div>/) || [])[1] || '';
    const bare = (now.match(/(?:^|[^a-zA-Z])(ne|nw|se|sw)(?![a-zA-Z])/g) || []);
    ok('R2-1-4 ★ 出口行不出现英文方向（ne/nw/se/sw 已译中文）',
      bare.length === 0, '出口行=' + now.replace(/<[^>]*>/g, '').slice(0, 80));
  }

  console.log('\n§R2-2 附近位置：一步可达的房间与「你在这里」的相对位置必须与出口方向一致');
  {
    const cur = mv.rooms.find(r => r.current);
    ok('R2-2-1 找到当前房间（前提）', !!cur, cur ? cur.id : '-');
    if (cur) {
      const room = w.getRoom(p.room);
      let checked = 0; const wrongInfo = [];
      for (const d of Object.keys(room.exits || {})) {
        const off = DIR_OFF[d];
        if (!off) continue;                       /* u/d 是上下层，不占平面格，跳过 */
        const to = room.exits[d];
        const nb = mv.rooms.find(r => r.id === to);
        if (!nb) continue;
        checked++;
        /* 同区域：位置必须正好差一个方向偏移（区域装箱只平移，不改相对关系） */
        if (nb.region === cur.region) {
          const dx = nb.x - cur.x, dy = nb.y - cur.y;
          if (dx !== off[0] || dy !== off[1]) wrongInfo.push(`${d}:${nb.name} Δ=(${dx},${dy}) 期望(${off[0]},${off[1]})`);
        }
        /* 跨区域：不能假装在地图格子上相邻（那是区域装箱的必然结果），
           但它必须仍然是 dist===1 的「一步可达」，且不能出现在同一格 */
        if (nb.region !== cur.region && nb.x === cur.x && nb.y === cur.y) {
          wrongInfo.push(`${d}:${nb.name} 与当前房间**同一格**（视觉上重合）`);
        }
      }
      ok('R2-2-2 ★ 同区域内的一步可达房间，地图位置与出口方向严格一致（无错位/重叠）',
        wrongInfo.length === 0, wrongInfo.length ? wrongInfo.join(' | ') : `已核对 ${checked} 个方向`);
    }
  }

  console.log('\n———————————————————————————————');
  console.log(`  第二轮地图几何回归：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('———————————————————————————————');
  process.exitCode = fail ? 1 : 0;
})();
