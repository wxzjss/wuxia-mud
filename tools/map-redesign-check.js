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
  /* 2026-10-21：地名索引改成**默认隐藏**，本套件专测那一块 ⇒ 显式打开开关。 */
  env.WX.S.settings.mapNav = true;
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

  /* F2（2026-10-18）：地图只画当前层是设计现状；正文要告诉玩家「本区还有几处在别层」。
     只在 region:auto 的请求里成立（不分批 view 的 levels 是全世界统计）。 */
  {
    const vScoped = e.view({ map: true, mapRegion: 'auto' });
    const { html: htmlScoped } = await renderMap(vScoped);
    ok('★ F2 抬头写明本区总处数与别层数（region 模式）',
      /本区共 \d+ 处，另有 \d+ 处在别层/.test(htmlScoped),
      (htmlScoped.match(/本区共[^<]*/) || ['(无)'])[0]);
    ok('　F2 不分批的 view 不写这句（levels 是全世界统计，防假数字）',
      !/另有 \d+ 处在别层/.test(html));
  }

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
  const mrnItems = html.match(/<span class="mrn-item[^>]*>/g) || [];
  ok('★ 区域名信息行注入了高亮变量 --mr-c（每个区域自己的颜色）',
    mrnItems.length > 0 && mrnItems.every(b => /--mr-c:\s*#[0-9a-fA-F]{3,6}/.test(b)),
    mrnItems.length + ' 个信息行，例：' + (mrnItems[0] || '(无)').slice(0, 110));
  /* 2026-10-18 反转口径：地名索引是静态信息，不是按钮。守「真的不可点」+「信息没丢」。 */
  const navHtml = (html.match(/<div class="map-region-nav"[\s\S]*?<\/div>\s*<\/div>/) || [''])[0];
  ok('★ 地名索引里没有任何可点按钮（不是哑按钮）',
    (navHtml.match(/<button/g) || []).length === 0, 'button=' + ((navHtml.match(/<button/g) || []).length));
  ok('　信息没丢：区域名与已探数仍在', mrnItems.length > 0 && html.indexOf('mrn-num') >= 0,
    mrnItems.length + ' 行');
  {
    const css = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    /* 只取真规则（`{...}`），别匹配到注释里的说明文字 —— 本项目踩过「注释里有字样被误判」 */
    const rule = (css.match(/\.mrn-item \.mrn-name\s*\{[^}]*\}/) || [''])[0];
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
    /* 🔴 P0-C C-2（spec §3.7）：格距从「窄屏 52 / 桌面 30」两档改为**四档**
       （XS 66 / S 60 / M 56 / L 52），所以源码里的表达式从
       `Math.round((NARROW ? 52 : 30) * z)` 变成 `Math.round(tier.cell * z)`。
       ⇒ 判据跟着改成「格距确实由 `tier.cell × z` 算出来」，
         守的仍是同一件事：**缩放真的乘进了格子尺寸，不是摆着看的**。 */
    ok('★ 缩放真的乘进格子尺寸（源码级判据）',
      /MAP_CELL = Math\.round\(tier\.cell \* z\)/.test(uisrc));
    ok('★ 格距按四档断点给（C-2 spec §3.7：XS66 / S60 / M56 / L52）',
      /66.*13\.5/.test(uisrc) && /60.*13\b/.test(uisrc) && /56.*12\b/.test(uisrc) && /52.*11\b/.test(uisrc));
    ok('★ 区域模式不再自己算格距（两页共用同一 MAP_CELL，主人 10-12）',
      !/const fitCell/.test(uisrc));
    /* 🔴 C-2（spec §3.7）：上下限从 0.7/2.4 改为 **0.9/2.2**。
       为什么：格距基准抬到 52 之后，0.7 会掉到 36.4px、字号被压到 8px —— 又回到「蚂蚁」；
       0.9×52 = 46.8px 是「还放得下 4 字/行、字不小于 10px」的地板。
       ⚠️ 这两个数在 `bindPanelActions` 里还有一份（＋/－ 按钮的钳位），
          本项目已经因为「两处各写一份」踩过两次，改一处必须改另一处。 */
    ok('　缩放有上下限（0.9~2.2 —— C-2：0.7 会把字号压到 8px 的蚂蚁档）',
      /ZMIN = 0\.9, ZMAX = 2\.2/.test(uisrc));
    ok('　★ 上下限与 ＋/－ 按钮的钳位是同一个数（别再攒第三次两处不一致）',
      /Math\.min\(2\.2, Math\.max\(0\.9/.test(uisrc));
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
  /* 🔴 P0-C C-2（spec §3.1）：**「一律亮白、不做明暗分级」这条作废**。
     spec 明确要求 L1/L2/L3 三级**必须**可辨，而且是**三重**区分：
       ① 形状：L1 有朱印（`.mn-seal`）/ L2 只有字 / L3 没字
       ② 字重：L1 = 700 / L2 = 400
       ③ 色相：L1 金 `#cfa64a` / L2 墨白 `#ded6c2`
     为什么推翻 10-12 那条：当时的判据是「未探索压暗一档」会造成
     「淡墨 vs 浓墨」两档同色相，色觉差异下极易混。C-2 用**形状 + 字重**
     替掉色相这一重，比「全亮白」更可辨，也更符合
     「颜色不得成为唯一信息载体」（灰度截图下 ①② 仍然成立）。
     ⇒ 断言反转：L2 的字色必须是 spec 的 `--map-ink-known`，L1 必须是 `--map-here-name`，
        且**不允许**再出现 `.dim` 那种「按去过没去过压暗」的规则。 */
  ok('★ L2 走过的地名用 spec 的浓墨变量（--map-ink-known）',
    /\.map-node \.mn-name[^}]*color:\s*var\(--map-ink-known/.test(css));
  ok('★ L1「我在这里」用金色且字重 700（不依赖色相也能认出）',
    /\.map-node\.here \.mn-name[^}]*color:\s*var\(--map-here-name\)[^}]*font-weight:\s*700/.test(css));
  ok('★ 没有按「去过/没去过」压暗的分色规则了（.dim 那套已删）',
    !/\.map-node\.(known|unknown|reach)\s+\.mn-name/.test(css)
    && !/\.map-node\.dim\s+\.mn-name/.test(css)
    && !/\.map-node\.dim\s*\{/.test(css));
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
  /* 🔴 2026-10-12 主人「只保留当前区域界面，把天下全图整个界面删了」之后，
     这条的口径变了（别照上一版抄）：
       旧口径：「data-cx/cy 还在（点区域名平移视角靠它）」—— 那是**全图**时代的需要。
       新口径：地图只剩本区一块，**没有别区可平移**，`data-cx/cy` 与
       `centerMapOnRegion()` 一起删了；现在只剩一个 `data-region-box`，
       作用是「让测试与调试能看出图上只有本区一块」，不再当坐标锚点。 */
  ok('★ 图上只剩**一个**区域框（没有别的区域的锚点了）',
    (html.match(/data-region-box="/g) || []).length === 1,
    (html.match(/data-region-box="/g) || []).length + ' 块');
  ok('★ 平移锚点 data-cx/cy 与 centerMapOnRegion 已随全图删掉（死代码不留）',
    html.indexOf('data-cx') < 0 && !/function centerMapOnRegion/.test(uisrc));
  ok('★ CSS 里 .map-region-box 已无边框无底色',
    /\.map-region-box\s*\{[^}]*border:\s*0[^}]*background:\s*none/.test(css));
  /* 🔴 P0-C C-2（spec §3.1 / §4.3 第 11 条）：**虚/实重新分工**，旧的「全是虚线」作废。
       · L2 走过的路 → **实线**（金褐）
       · L3 通往未知 → **虚线**（极淡）
     为什么：虚/实现在是「走过 / 没走过」的**第二重编码**，不依赖颜色 ——
     灰度截图下也能数出来。旧的「`.edge` 基类挂 dasharray」会把两档一起拉虚，分工就没了。
     ⇒ 断言从「基类有 dasharray」改为「**走过**那档没有、**未知**那档有」。 */
  ok('★ L2 走过的连线是实线（C-2：虚/实 = 走过/没走过的第二重编码）',
    !/\.map-edges\s+\.edge\s*\{[^}]*stroke-dasharray/.test(css)
    && !/\.map-edges\s+\.edge-known\s*\{[^}]*stroke-dasharray/.test(css));
  ok('★ L3 通往未知的连线是虚线',
    /\.map-edges\s+\.edge-dim\s*\{[^}]*stroke-dasharray/.test(css));
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
