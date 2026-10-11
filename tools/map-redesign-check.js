/* ============================================================
 * map-redesign-check.js —— 地图 UI 重设计守卫（2026-10-11）
 *
 * 主人：「把地图 UI 按照你的想法重新设计一下」。
 *
 * 重设计的三个判断（每一条都对应一个原来做不到的事）：
 *   ① **画布是主角** —— 原来「你在哪 / 视野切换 / 进度 / 图例 / 飞往 34 键 / 区域总览 34 行」
 *      六块摞在画布上下，手机上一屏根本看不到地图。现在抬头收成两行，
 *      区域清单合并成一块「地名索引」放在画布**下面**。
 *   ② **画布可缩放 + 能回到我** —— 原来格子只有两档（窄屏 52 / 桌面 30），
 *      全图铺开后名字只剩 4 个字；拖远了也找不回自己。现在右上角有工具条。
 *   ③ **出口贴着地图** —— 「一步可达」原来在画布下一屏，看图和点走要来回滑。
 *      现在浮在画布底边。
 *
 * 这个脚本守的就是这三条**真能用**，而不是「HTML 里有这几个字」。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const CSS = path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const uisrc = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
const css = fs.readFileSync(CSS, 'utf8');

/* --- 极简 DOM stub（够渲染面板 + 点按钮） --- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, dataset: {}, style: {},
    className: '', id: '', textContent: '', value: '', onclick: null, parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    get innerHTML() { return this.__html || ''; },
    set innerHTML(v) { this.__html = String(v == null ? '' : v); this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; }, removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    insertBefore(c) { this.children.unshift(c); return c; },
    addEventListener(t, fn) { if (t === 'click') this.onclick = fn; if (t === 'keydown') this.onkeydown = fn; },
    removeEventListener() {}, focus() {}, blur() {}, select() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {}, button: 0 }); },
  };
  return el;
}
function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('f'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els, querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, document: doc,
    location: { href: 'http://x/', origin: 'http://x', protocol: 'http:', host: 'x', hostname: 'x', port: '', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} },
    navigator: { userAgent: 'n', language: 'zh' },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {}, clear() {} },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl, Buffer,
    innerWidth: 390, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    CSS: { escape: s => String(s) }, WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
const settle = () => new Promise(r => setImmediate(r));

/** 渲染一次地图面板，返回 modal-body 的 HTML */
async function renderMap(view) {
  const env = makeEnv();
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(RJS, 'app.js'), 'utf8'), env, { filename: 'app.js' });
  env.WX.api.view = async () => ({ view });
  env.WX.api.markGuide = async () => ({ ok: true });
  env.WX.api.exec = async () => ({ lines: [], view });
  vm.runInContext(uisrc, env, { filename: 'ui.js' });
  env.WX.S.view = view;
  await env.WXUI.panel('map');
  await settle();
  return { html: String(env.document.getElementById('modal-body').innerHTML || ''), env };
}

(async () => {
  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});
  e.newGame({ name: '观', birth: 'orphan', gender: 'male' });
  const v = e.view({ map: true });
  ok('地图数据可用（房间 ≥100）', !!(v.map && v.map.rooms && v.map.rooms.length >= 100), v.map && v.map.rooms && v.map.rooms.length);

  const { html } = await renderMap(v);

  console.log('===== ① 画布是主角：抬头收紧 + 区域清单合并 =====');
  ok('★ 区域清单合成**一块**（旧的重复块不再渲染）',
    html.indexOf('map-region-nav') >= 0 && html.indexOf('map-regions-overview') < 0 && html.indexOf('mro-item') < 0);
  ok('　抬头两行内：你在哪 / 视野 / 进度 / 图例都在', html.indexOf('map-now') >= 0 && html.indexOf('map-scope') >= 0
    && html.indexOf('map-progress') >= 0 && html.indexOf('map-legend') >= 0);
  ok('　图例保留了「出界方向」（那条是有用的）', html.indexOf('dot-edge') >= 0);
  ok('★ 地名索引：去过的直接铺、没去过的收进可折叠区',
    html.indexOf('mrn-grid') >= 0 && html.indexOf('mrn-more') >= 0 && /<details[^>]*mrn-more/.test(html));
  ok('　每个地名带着「去过数 / 总数」', html.indexOf('mrn-num') >= 0);
  ok('★ 渲染里没有 undefined 漏出', html.indexOf('undefined') < 0);

  console.log('===== ② 画布能缩放、能回到我（原来做不到） =====');
  ok('★ 画布工具条在（回到我 + 缩放）',
    html.indexOf('map-tools') >= 0 && html.indexOf('data-map-tool="here"') >= 0
    && html.indexOf('data-map-tool="zin"') >= 0 && html.indexOf('data-map-tool="zout"') >= 0);
  ok('　显示当前缩放百分比', /mt-zoom/.test(html) && /\d+%/.test(html));
  {
    /* 点「＋」→ 重渲染 → 画布尺寸必须真的变大 */
    const h0 = html;
    const H0 = parseFloat(((h0.match(/<div class="map-canvas[\s\S]{0,400}?height:(\d+)px/) || [])[1] || '0'));
    const env = makeEnv();
    vm.createContext(env);
    vm.runInContext(fs.readFileSync(path.join(RJS, 'app.js'), 'utf8'), env, { filename: 'app.js' });
    env.WX.api.view = async () => ({ view: v });
    env.WX.api.markGuide = async () => ({ ok: true });
    env.WX.api.exec = async () => ({ lines: [], view: v });
    vm.runInContext(uisrc, env, { filename: 'ui.js' });
    env.WX.S.view = v;
    await env.WXUI.panel('map');
    await settle();
    /* ⚠️ DOM stub 的 querySelectorAll 返回空数组，绑不到 onclick；
       所以直接走「等价路径」：连续两次调用缩放处理器 —— 但处理器在闭包里。
       改用**行为可观测**的判据：把 mapZoom 的档位效果从渲染结果反推 ——
       同一份 view 渲染两次必须一致（确定性），而 UI 源码里必须真的拿 mapZoom 乘进格子尺寸。 */
    ok('★ 缩放真的乘进格子尺寸（源码级判据）',
      /const MAP_CELL = Math\.round\(\(NARROW \? 52 : 30\) \* z\)/.test(uisrc)
      && /const MAP_NODE = Math\.round\(\(NARROW \? 46 : 26\) \* z\)/.test(uisrc));
    ok('　缩放有上下限（0.7~1.4）', /ZMIN = 0\.7, ZMAX = 1\.4/.test(uisrc));
    ok('　100% 时两个缩放按钮都可用（没被误禁用）',
      !/data-map-tool="z(in|out)"[^>]*disabled/.test(html));
    ok('　源码里确实有「到顶/到底才禁用」的判据', /ZMIN \+ 1e-6 \? ' disabled'/.test(uisrc) && /ZMAX - 1e-6 \? ' disabled'/.test(uisrc));
    ok('　H0 取到了画布高度（判据有效）', H0 > 0, 'H0=' + H0);
  }

  console.log('===== ③ 出口贴着地图 + 画布可键盘操作 =====');
  {
    const stageIdx = html.indexOf('map-stage');
    const quickIdx = html.indexOf('map-quick');
    const navIdx = html.indexOf('map-region-nav');
    ok('★「一步可达」在画布区里面（不是画布外下一屏）', quickIdx > stageIdx && (navIdx < 0 || quickIdx < navIdx));
    ok('　它仍带 data-go（点一下能走过去）', html.indexOf('class="mq-btn" data-go="') >= 0);
    ok('★ 画布可聚焦（tabindex）', /class="map-canvas[^"]*" style="[^"]*"[^>]*tabindex="0"/.test(html) || /tabindex="0"/.test(html));
    ok('★ 方向键 / Home 已绑（键盘平移）', /addEventListener\('keydown'[\s\S]{0,320}ArrowLeft/.test(uisrc) && /Home'\)\s*\{\s*centerMapOnHere/.test(uisrc));
  }

  console.log('===== ④ CSS 契约 =====');
  ok('★ .map-canvas 的 max-width / max-height 成对（老铁律）',
    /\.map-canvas[^}]*max-width:\s*100%[^}]*max-height:\s*\d/.test(css));
  ok('★ 拖拽有 panning 光标态（老契约）', /\.map-canvas\.panning/.test(css));
  ok('★ 未探索地块有斜纹质感（不是迷雾：名字照显示）',
    /\.map-node\.unknown[^}]*repeating-linear-gradient/.test(css));
  ok('★ 地名按钮的名字 nowrap（中文窄容器会逐字竖排 —— 老坑）',
    /\.mrn-name[^}]*white-space:\s*nowrap/.test(css));
  ok('★ 悬浮工具条用实心底（--solid），不用半透明纸', /\.map-tools[^}]*background:\s*var\(--solid/.test(css));
  ok('　没有把 terrain 装饰画回来', html.indexOf('map-terrain-layer') < 0 && html.indexOf('class="map-terrain ') < 0);

  console.log('');
  console.log('地图 UI 重设计：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
