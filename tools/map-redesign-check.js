/* ============================================================
 * map-redesign-check.js —— 地图 UI 重设计守卫（2026-10-11）
 *
 * 主人：「把地图 UI 按照你的想法重新设计一下」。
 *
 * 重设计的三个判断（每一条都对应一个原来做不到的事）：
 *   ① **画布是主角** —— 原来「你在哪 / 视野切换 / 进度 / 图例 / 飞往 34 键 / 区域总览 34 行」
 *      六块摞在画布上下，手机上一屏根本看不到地图。现在抬头收成两行，
 *      区域清单合并成一块「地名索引」放在画布**下面**。
 *   ② **画布可缩放** —— 原来格子只有两档（窄屏 52 / 桌面 30），
 *      全图铺开后名字只剩 4 个字；拖远了也找不回自己。现在右上角有工具条。
 *      🔴 2026-10-12 主人：「把世界地图的『回到我』删了」——
 *         「回到我」那颗按钮**已下线**（开图自动居中仍在，那是默认行为不是按钮），
 *         工具条只剩 ± 缩放；同时「一步可达」整块也下线了（见 ③）。
 *
 * 这个脚本守的就是这几条**真能用**，而不是「HTML 里有这几个字」。
 * ⚠️ 2026-10-12 主人一批地图改动（删一步可达 / 去过 / 出界方向 / 回到我 /
 *    区域名 / 彩色底色框 / 黄字可点，连线改虚线，区域图＝世界图删其他区域），
 *    凡是与「已经删掉的东西」有关的断言都改成了**反向判据**（断言它真的不在了）——
 *    这样才不会「主人删了、守卫还替他守着」。
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
  ok('　抬头两行内：你在哪 / 视野 / 进度都在', html.indexOf('map-now') >= 0 && html.indexOf('map-scope') >= 0
    && html.indexOf('map-progress') >= 0);
  /* 🔴 2026-10-12 口径改动（主人两轮删减）：
     先是「把一步可达删了（连同灰字描述）」「把出界方向删了」「把去过删了」，
     再是「把地图界面的『你在这里』与『未探索』删了」—— 图例**整个没了**。
     于是这一条从「图例精简成两条」改成「图例已整体下线」。
     没有图例之后靠什么读懂地图：名字一律亮色（不分明暗），只有你那一格是金底加粗。 */
  ok('　图例已整体下线（主人 10-12 把最后两条也删了）',
    html.indexOf('map-legend') < 0 && html.indexOf('dot-here') < 0
    && html.indexOf('dot-unknown') < 0 && html.indexOf('ml-tip') < 0);
  ok('★ 地名索引：去过的直接铺、没去过的收进可折叠区',
    html.indexOf('mrn-grid') >= 0 && html.indexOf('mrn-more') >= 0 && /<details[^>]*mrn-more/.test(html));
  ok('　每个地名带着「去过数 / 总数」', html.indexOf('mrn-num') >= 0);
  ok('★ 渲染里没有 undefined 漏出', html.indexOf('undefined') < 0);

  /* ★ 2026-10-13 主人：「给『唐门』『白鹿书院』这种区域名字加高亮显示」。
     区域名（大地名）现在只出现在这排索引按钮上 —— 地块上的区域名 2026-10-12 已下线。
     高亮的落地方式：按钮内联注入 `--mr-c`（该区域自己的 color），
     CSS 用它给名字画一条**同色虚线下划线** + 加粗 + 抬字号。
     两层都要守：渲染层（变量注进去了）+ CSS 层（真规则用它，不是只写在注释里）。 */
  const mrnBtns = html.match(/<button class="mrn-btn[^>]*>/g) || [];
  ok('★ 区域名按钮注入了高亮变量 --mr-c（每个区域自己的颜色）',
    mrnBtns.length > 0 && mrnBtns.every(b => /--mr-c:\s*#[0-9a-fA-F]{3,6}/.test(b)),
    mrnBtns.length + ' 个按钮，例：' + (mrnBtns[0] || '(无)').slice(0, 110));
  {
    const css = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    /* 只取真规则（`{...}`），别匹配到注释里的说明文字 —— 本项目踩过「注释里有字样被误判」 */
    const rule = (css.match(/\.mrn-btn \.mrn-name\s*\{[^}]*\}/) || [''])[0];
    ok('★ CSS 真规则里区域名用了 --mr-c 做下划线（不是只写在注释里）',
      /var\(--mr-c/.test(rule), rule.replace(/\s+/g, ' ').slice(0, 110) || 'NOT FOUND');
    ok('　区域名加粗 + 抬字号（从一片小胶囊里一眼挑得出来）',
      /font-weight:\s*(600|700|bold)/.test(rule) && /font-size:\s*13/.test(rule),
      rule.replace(/\s+/g, ' ').slice(0, 110));
    ok('　高亮用下划线而非给整颗按钮上色（底色已用于区分去过/没去过）',
      /text-decoration/.test(rule) && !/background:/.test(rule));
  }

  console.log('===== ② 画布能缩放（回到我已在 2026-10-12 按主人要求删掉） =====');
  ok('★ 画布工具条在（只剩缩放，「回到我」已删）',
    html.indexOf('map-tools') >= 0
    && html.indexOf('data-map-tool="here"') < 0
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
    /* 🔴 2026-10-08 口径改动：区域模式曾经按弹窗可用宽高**自动放大**格距（fitCell）。
       🔴 2026-10-12 又改回来：主人「把当前区域地图改为在世界地图的基础上删去其他区域的，
          其他的原模原样复制粘贴即可」⇒ fitCell 整段删掉，两种视野**共用同一个 MAP_CELL**。
       所以现在只有一条赋值，且它必须真的带 * z。 */
    ok('★ 缩放真的乘进格子尺寸（源码级判据）',
      /MAP_CELL = Math\.round\(\(NARROW \? 52 : 30\) \* z\)/.test(uisrc));
    ok('★ 区域模式不再自己算格距（两页共用同一 MAP_CELL，主人 10-12）',
      !/const fitCell/.test(uisrc));
    ok('　缩放有上下限（0.7~2.4 —— 上限随 fitCell 下线而放宽）', /ZMIN = 0\.7, ZMAX = 2\.4/.test(uisrc));
    ok('　100% 时两个缩放按钮都可用（没被误禁用）',
      !/data-map-tool="z(in|out)"[^>]*disabled/.test(html));
    ok('　源码里确实有「到顶/到底才禁用」的判据', /ZMIN \+ 1e-6 \? ' disabled'/.test(uisrc) && /ZMAX - 1e-6 \? ' disabled'/.test(uisrc));
    ok('　H0 取到了画布高度（判据有效）', H0 > 0, 'H0=' + H0);
  }

  console.log('===== ③ 地图「只看不点」+ 画布可键盘操作 =====');
  {
    /* 🔴 2026-10-12 口径改动：主人「把一步可达删了」「把地块……可点击前往删了」。
       这一节原来守的是「一步可达贴着画布底边、点了能走过去」——
       那个功能整个没了，所以改守**它真的没了**：
       不渲染 `map-quick`、地块不带 `data-go`、也不再给「一步可达」单独上色。 */
    ok('★「一步可达」快捷条已下线（不再渲染 map-quick）', html.indexOf('map-quick') < 0);
    ok('★ 地块不再可点前往（没有 data-go）', html.indexOf('data-go') < 0);
    ok('★ 地块也不再给「一步可达」单独上色（没有 .near）', !/class="map-node[^"]*\bnear\b/.test(html));
    ok('★ 画布可聚焦（tabindex）', /class="map-canvas[^"]*" style="[^"]*"[^>]*tabindex="0"/.test(html) || /tabindex="0"/.test(html));
    /* 方向键平移保留；Home（回到我）随那颗按钮一起撤了 */
    ok('★ 方向键已绑（键盘平移）', /addEventListener\('keydown'[\s\S]{0,320}ArrowLeft/.test(uisrc));
    ok('　Home 键已撤（它与被删的「回到我」是同一件事）', !/k === 'Home'/.test(uisrc));
  }

  console.log('===== ④ CSS 契约 =====');
  ok('★ .map-canvas 的 max-width / max-height 成对（老铁律）',
    /\.map-canvas[^}]*max-width:\s*100%[^}]*max-height:\s*\d/.test(css));
  ok('★ 拖拽有 panning 光标态（老契约）', /\.map-canvas\.panning/.test(css));
  /* 🔴 2026-10-08 口径改动：主人要求「把地块里的方块框删掉，用纯地名显示」。
     🔴 2026-10-12 又添一条：「把地图界面所有灰色字体的地名变成已探索后的亮白色」
        ⇒ 连「未探索压暗一档」也没了，**所有地块名同色**（--ink-1）。
     原来这条守的是「未探索仍显示名字、只压暗一档，不做迷雾」——
     精神（不做迷雾）没变，但现在连那一档压暗都取消了，
     所以改断「名字用最亮那档墨色 + 没有任何按状态分色的规则」。 */
  ok('★ 地块名一律亮色（主人要求所有地名都一样亮，不做明暗分级）',
    /\.map-node \.mn-name[^}]*color:\s*var\(--ink-1\)/.test(css));
  ok('★ 没有按「去过/没去过」分字色的规则了（分色就说明这条没改到位）',
    !/\.map-node\.(known|unknown|reach)\s+\.mn-name/.test(css)
    && !/\.map-node\.dim\s+\.mn-name/.test(css));
  ok('　地块没有方块框了（无边框、无底色）',
    /\.map-node \{[\s\S]{0,200}border:\s*none/.test(css)
    && /\.map-node \{[\s\S]{0,200}background:\s*transparent/.test(css));
  ok('★ 地名按钮的名字 nowrap（中文窄容器会逐字竖排 —— 老坑）',
    /\.mrn-name[^}]*white-space:\s*nowrap/.test(css));
  ok('★ 悬浮工具条用实心底（--solid），不用半透明纸', /\.map-tools[^}]*background:\s*var\(--solid/.test(css));
  ok('　没有把 terrain 装饰画回来', html.indexOf('map-terrain-layer') < 0 && html.indexOf('class="map-terrain ') < 0);

  console.log('===== ⑤ 2026-10-12 主人一批删减：区域名 / 彩色框 / 虚线 =====');
  /* 这一节是**反向判据**：主人让删的东西，守卫要盯着它真的不在，
     否则下次谁把它加回来都没人拦。 */
  ok('★ 区域/城市名不再画（地图上只留地块自己的名字）', html.indexOf('mrb-label') < 0);
  ok('★ 区域底色框不再上色（元素在，但只是一块看不见的定位锚）',
    html.indexOf('map-region-box') >= 0 && !/class="map-region-box"[^>]*background:/.test(html));
  ok('★ 定位锚的 data-cx/cy 还在（「点区域名平移视角」靠它，删了就静默失灵）',
    /data-region-box="[^"]*"[^>]*data-cx="\d/.test(html));
  ok('★ CSS 里 .map-region-box 已无边框无底色',
    /\.map-region-box\s*\{[^}]*border:\s*0[^}]*background:\s*none/.test(css));
  ok('★ 所有走廊连线都是虚线（主人 10-12：连线换成虚线形式）',
    /\.map-edges\s+\.edge\s*\{[^}]*stroke-dasharray/.test(css));
  ok('★ 跨区那条兜底虚线整段下线（没有 edge-bridge 了）',
    html.indexOf('edge-bridge') < 0 && !/\.map-edges\s+\.edge-bridge\s*\{/.test(css));
  /* 区域模式＝世界地图裁掉别的区域：两页格距必须一致（主人 10-12 的原话）。
     判据落在**源码**上：全文件只允许出现一处 `MAP_CELL = Math.round(...)`。
     两处就是两套尺寸，两页又会「长得不一样」。 */
  {
    const cells = (uisrc.match(/MAP_CELL = Math\.round\(/g) || []).length;
    ok('★ 两种视野共用同一处格距赋值（区域图＝世界图裁掉别处）', cells === 1, cells + ' 处');
  }

  console.log('');
  console.log('地图 UI 重设计：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
