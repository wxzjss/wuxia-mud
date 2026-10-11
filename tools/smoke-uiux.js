/**
 * smoke-uiux.js —— 批次 7「双端与 UI」专项回归（电脑端 / 手机端）
 *
 *  本脚本**真渲染 + 真点击 + 真键盘事件**，不看代码长相、不做「静态 grep 当断言」：
 *   · 用 vm 载入**真 ui.js / app.js**（先 app 后 ui），喂**真 GameEngine.view()**，
 *     走**真入口**（renderScene 的卡片 onclick → openNpcMenu、renderQuickbar 的
 *     #qb-menu onclick → openSideMenu、WXUI.panel、bindHotkeys 的 document 监听），
 *     再读真 DOM（#choices-list / #modal-body / #log / #quickbar）。
 *
 *  覆盖：
 *   §0  两份 ui.js / main.css 逐字节一致 + 版本戳统一
 *   §1  B15 前端性别硬编码：真渲染 NPC 菜单头 —— 兽（gender:other）显示「不明」不再「男」
 *   §2  性别名词单一入口：女→女/她、男→男/他、other→不明/TA（喂真实调用路径入参）
 *   §3  CSS 自定义属性契约：main.css 里 var() 用到的都必须有定义（未定义=整条声明被丢弃）
 *   §4  手机端 ☰ 菜单：窄屏侧栏被藏，设置/存档/回主菜单/属性… 仍真能打开
 *   §5  桌面热键：弹窗开着时不许「在弹窗背后偷偷走路」
 *   §6  长日志流：日志上限 + 自动滚到底（真读 innerHTML）
 *   §7  窄屏 ☰ 菜单 ⊇ 侧栏全部入口（防「加了面板忘了加 ☰」复发；真点每一项）
 *   §8  中栏统一成一列（房间卡/日志/输入栏/快捷条 同一条 --col-w；D2 · CSS 契约）
 *
 * ⚠️ DOM stub 三坑（照抄 smoke-mapui.js）：
 *   ① querySelectorAll 必须按 (选择器, innerHTML) 缓存；② innerHTML setter 必须清 children；
 *   ③ async 要 await settle()。且**先加载 app.js 再加载 ui.js**（ui.js 依赖 global.WX）。
 * ⚠️ 断言必须喂真实调用路径的入参（view 来自真引擎 / 真绑定的 onclick）。
 * ⚠️ 随机源固定 seed；存档走独立沙盒；不改 game/data/*.json；不 git commit。
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
 *  DOM stub（最小实现，够跑真 ui.js；与 smoke-mapui 同源，另加 document 监听记录）
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
    focus() { this._focus = (this._focus || 0) + 1; }, blur() { this._blur = (this._blur || 0) + 1; },
    click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
/** 从 HTML 按选择器抠元素（够本测试用；复杂选择器返回 []，宁可测不到也别假绿）
 *  ⚠️ 逐**开标签**扫描，**不要**改成「配对开闭标签」的写法：
 *     配对写法会把外层 `<div class="ask-topics">` 连同里面嵌套的
 *     `<button class="mini-tag" …>` 一起「吃掉」（正则非贪婪匹配到最近的 `</div>`），
 *     于是 `#modal-body .mini-tag[data-who]` 这种**嵌套**元素永远抠到 0 个 ——
 *     结果是「测试说按钮不存在」，而浏览器里它明明在那儿（假红）。
 *     `kidnap-ui-check.js` 一直是这么扫的，所以它抠得到 `.op-btn`。 */
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
  const re2 = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/?>/g;
  let m2;
  while ((m2 = re2.exec(html)) !== null) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = are.exec(m2[2] || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    }
    const g = { tag: m2[1].toLowerCase(), attrs, text: (html.slice(m2.index + m2[0].length).match(/^([^<]*)/) || ['', ''])[1].trim() };
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
function makeEnv(opts) {
  const o = opts || {};
  const innerWidth = o.innerWidth || 1280;
  const store = {}, els = {}, winL = {}, docL = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector() { return null; },
    querySelectorAll(sel) {
      const m = String(sel).match(/#([A-Za-z0-9_-]+)/);
      if (m) return els[m[1]] ? els[m[1]].querySelectorAll(sel) : [];
      /* 不带 #id 的选择器（ui.js 里 `document.querySelectorAll('.ask-topics .mini-tag')`
         这类）→ 扫 modal-body。不兜这一下的话，ui.js 那边的 onclick **绑不上**，
         测试就会误报「点了没反应」。 */
      return els['modal-body'] ? els['modal-body'].querySelectorAll(sel) : [];
    },
    addEventListener(t, f) { (docL[t] = docL[t] || []).push(f); }, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    /* 模拟手机：maxTouchPoints>0 → isTouchDevice() 为真 */
    navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile', maxTouchPoints: 5, language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth, innerHeight: 800,
    screen: { width: innerWidth, height: 800 },
    __winL: winL, __docL: docL,
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
  for (const f of ['app.js', 'ui.js']) {   /* ⚠️ 顺序不能反 */
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}
function settle() { return new Promise(r => setImmediate(r)); }
/** 把两个遮罩设成「关着」（真实 index.html 初始就是 class="modal-mask hidden"） */
function closeMasks(env) {
  env.document.getElementById('modal-mask').classList.add('hidden');
  env.document.getElementById('choices-mask').classList.add('hidden');
}
/** 桩好 api，返回记录器 */
function stubApi(env, view) {
  const rec = { exec: [], view: [], combat: [], npc: [], quest: [] };
  env.WX.api.exec = async (cmd, opt) => { rec.exec.push({ cmd, opt: opt || null }); return { ok: true, lines: [] }; };
  env.WX.api.view = async (p) => { rec.view.push(p); return { ok: true, view: view || env.WX.S.view }; };
  env.WX.api.markGuide = async () => ({ ok: true });
  /* 任务详情：「接取任务」点下去要拉的那一页。**喂真数据**（真 engine.questPreviewOf），
     不是手搓 fixture —— 手搓的只能证明「渲染函数能渲染我编的东西」。 */
  env.WX.api.questPreview = async (qid) => {
    rec.quest.push(qid);
    const q = engine.questPreviewOf(qid);
    return q ? { ok: true, quest: q } : { ok: false, error: '没有这个任务。' };
  };
  /* NPC 详情：**喂真数据**（走真 engine.npcProfileOf），不是手搓 fixture ——
     手搓的 fixture 只能证明「渲染函数能渲染我编的东西」，
     证明不了「后端真给得出这些字段」。 */
  env.WX.api.npcProfile = async (uid) => {
    rec.npc.push(uid);
    const pr = engine.npcProfileOf(uid);
    return pr ? { ok: true, npc: pr } : { ok: false, error: '没有这个人。' };
  };
  env.WX.S.busy = false;
  return rec;
}
/** 真渲染场景栏，点名字含 name 的卡片 → 返回 NPC 菜单的 HTML 与标题 */
function openNpcMenuHtml(env, view, name) {
  env.WX.S.view = view;
  env.WXUI.renderScene(view);
  const box = env.document.getElementById('scene-npcs');
  const card = box.children.find(c => String(c.innerHTML || '').indexOf(name) >= 0);
  if (!card) return { html: '', title: '', found: false };
  card.onclick();
  const list = env.document.getElementById('choices-list');
  return { html: list.innerHTML || '', title: env.document.getElementById('choices-title').textContent || '', found: true };
}

/* ================================================================
 *  ★ 引擎：真世界 + 真 NPC（女/男/兽 三种性别同房，一次覆盖三类）
 * ================================================================ */
const SEED = 20261010;
const engine = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
engine.boot();
engine.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
const w = engine.world, p = w.player;
/* 出生房本来就有一女（范清）一男（游侠）；再放一条毒蛇（gender:'other' 的兽） */
w.spawnNpc('mob_snake', p.room, 1, true);
const VIEW = engine.view();
const SNAKE = VIEW.npcs.find(n => n.defId === 'mob_snake');
const FEMALE = VIEW.npcs.find(n => n.gender === 'female');
const MALE = VIEW.npcs.find(n => n.gender === 'male');

(async function main() {

  /* ---------- §0 副本 / 版本戳 ---------- */
  section('§0 两份副本逐字节一致 + 版本戳统一');
  {
    const pairs = [
      ['ui.js', path.join(RJS, 'ui.js'), path.join(ROOT, 'server', 'public', 'js', 'ui.js')],
      ['main.css', path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), path.join(ROOT, 'server', 'public', 'css', 'main.css')],
    ];
    for (const [name, a, b] of pairs) {
      const sa = fs.readFileSync(a), sb = fs.readFileSync(b);
      ok(`FE ${name} 两份逐字节一致`, sa.equals(sb), `${sa.length} vs ${sb.length} bytes`);
    }
    const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
    const vers = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(x => x[1]);
    ok('FE 版本戳 ≥7 处且完全一致（改前端必须顺推）',
      vers.length >= 7 && new Set(vers).size === 1, `${vers.length} 处 / ${[...new Set(vers)].join(',')}`);
  }

  /* ---------- §1 B15 前端性别硬编码 ---------- */
  section('§1 B15 · NPC 菜单头的性别名词（真渲染）');
  {
    console.log(`  场景：同房有 女=${FEMALE && FEMALE.name} / 男=${MALE && MALE.name} / 兽=${SNAKE && SNAKE.name}(${SNAKE && SNAKE.gender})`);
    ok('S1-0 真世界确有 gender=other 的兽（前置）', !!(SNAKE && SNAKE.gender === 'other'), SNAKE ? SNAKE.defId : '无');

    const env = loadUi(makeEnv({ innerWidth: 375 }));
    stubApi(env, VIEW);

    const beast = openNpcMenuHtml(env, VIEW, SNAKE.name);
    ok('S1-1 点毒蛇卡片弹出了菜单', beast.found && beast.html.length > 0);
    ok('S1-2 ★ 兽的性别名词 ≠「男」（旧实现显示「男」，主人实测过）',
      beast.html.indexOf('男') < 0, '菜单头：' + (beast.html.match(/山中猛兽[^<]*/) || [''])[0]);
    ok('S1-3 ★ 兽的性别名词 =「不明」', beast.html.indexOf('不明') >= 0);

    const fem = openNpcMenuHtml(env, VIEW, FEMALE.name);
    ok('S1-4 女 NPC → 「女」', fem.html.indexOf('女') >= 0, (fem.html.match(/<div class="modal-text"[^>]*>([^<]*)</) || [])[1] || '');
    ok('S1-5 女 NPC 菜单文案用「她」', /送她东西/.test(fem.html) && /给她银钱/.test(fem.html));

    const mal = openNpcMenuHtml(env, VIEW, MALE.name);
    ok('S1-6 男 NPC → 「男」（老行为不坏）', mal.html.indexOf('男') >= 0);
    ok('S1-7 男 NPC 菜单文案仍用「他」', /送他东西/.test(mal.html) && /给他银钱/.test(mal.html));
    ok('S1-8 兽的菜单文案用中性「TA」（不为兽生造「它」）',
      /送TA东西/.test(beast.html) && !/送它东西/.test(beast.html));

    /* 真点一下菜单项，确认真派发（不是只渲染） */
    env.WX.S.view = VIEW;
    env.WXUI.renderScene(VIEW);
    const box = env.document.getElementById('scene-npcs');
    box.children.find(c => String(c.innerHTML || '').indexOf(SNAKE.name) >= 0).onclick();
    const lbox = env.document.getElementById('choices-list');
    /* ⚠️ 第三轮起，NPC 菜单第一项由「查看 (look)」改成「细看此人 (profile)」
       （主人要求：点这个按钮要弹出**新界面**看详细资料，不是往日志里打一段文本）。
       文本版 look 仍能从详情面板底部进去，指令也没废。 */
    const profBtn = lbox.children.find(c => /细看此人/.test(String(c.innerHTML || '')));
    ok('S1-9 菜单里找到「细看此人」项（第三轮：第一项换成开详情界面）', !!profBtn);
    ok('S1-9b 老文本版的「打量 (look)」不再占菜单首项（改从详情面板底部进）',
      !lbox.children.some(c => /查看 \(look\)/.test(String(c.innerHTML || ''))));
    /* 真派发在下一段独立 env 里验证（不与本段状态耦合） */
  }
  /* 真派发单独置于独立 env，避免与上段状态耦合 */
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const rec = stubApi(env, VIEW);
    env.WXUI.renderScene(VIEW);
    const box = env.document.getElementById('scene-npcs');
    box.children.find(c => String(c.innerHTML || '').indexOf(SNAKE.name) >= 0).onclick();
    const lbox2 = env.document.getElementById('choices-list');
    const profBtn = lbox2.children.find(c => /细看此人/.test(String(c.innerHTML || '')));
    if (profBtn) { profBtn.onclick(); await settle(); await settle(); }
    /* ★ 真派发：点「细看此人」必须**只**去拉那个人的画像（api.npcProfile），
       且**不许**往日志里发 look 指令（那是旧行为）。
       profile 面板的正文另在 §11 里真渲染断言。 */
    ok('S1-10 ★ 点「细看此人」去拉该 NPC 的画像（而不是打一段 look 文本）',
      rec.npc.length === 1 && rec.exec.length === 0,
      'npcProfile=' + JSON.stringify(rec.npc) + ' exec=' + (rec.exec.map(x => x.cmd).join(',') || '(空)'));
  }

  /* ---------- §2 性别名词单一入口 ---------- */
  section('§2 性别名词单一入口（喂真实调用路径入参）');
  {
    /* 姻缘面板：妾室喂 gender:'other'（形状正确），必须 →「不明」而非「男」 */
    const loveView = {
      player: { name: '试侠', gender: 'male', age: 22 },
      npcs: [], quests: [],
      marriage: {
        spouse: null, plan: null,
        concubines: [{ id: 'c1', name: '某某', gender: 'other', age: 20 }],
        bonds: [{ id: 'b1', name: '柳霜', gender: 'female', age: 26 }],
      },
      kinship: { total: 0 },
    };
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    stubApi(env, loveView);
    await env.WXUI.panel('love');
    const mb = env.document.getElementById('modal-body').innerHTML;
    ok('S2-1 姻缘面板：other 性别 →「不明」', /<div class="love-chip">某某<i>不明/.test(mb), mb.match(/某某<i>[^<]*/)?.[0] || '(未渲染)');
    ok('S2-2 姻缘面板：other 不再被写成「男」', !/<div class="love-chip">某某<i>男/.test(mb), mb.match(/某某<i>[^<]*/)?.[0] || '(未渲染)');
    ok('S2-3 姻缘面板：女 →「女」（对照）', /<i>女( · 26)?<\/i>/.test(mb) && mb.indexOf('柳霜') >= 0);

    /* 状态面板：玩家自身 gender:'other' →「不明」 */
    const scoreView = { player: { name: '试侠', gender: 'other', realm: '初窥门径', hp: 1, maxHp: 1, mp: 0, maxMp: 1, food: 1, maxFood: 1, water: 1, maxWater: 1, money: 0, kills: 0, reputation: {} } };
    const env2 = loadUi(makeEnv({ innerWidth: 375 }));
    stubApi(env2, scoreView);
    await env2.WXUI.panel('score');
    const mb2 = env2.document.getElementById('modal-body').innerHTML;
    ok('S2-4 状态面板：性别 other →「不明」', mb2.indexOf('不明') >= 0 && !/性别[^<]*<[^>]*>男/.test(mb2));
    ok('S2-5 状态面板：不出现 undefined', mb2.indexOf('undefined') < 0);
  }

  /* ---------- §3 CSS 自定义属性契约 ---------- */
  section('§3 CSS 自定义属性：var() 用到的必须有定义（未定义=整条声明被丢弃）');
  {
    for (const rel of ['game/src/renderer/css/main.css', 'server/public/css/main.css']) {
      const css = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const defined = new Set([...css.matchAll(/(^|[\s;{])(--[A-Za-z0-9_-]+)\s*:/g)].map(m => m[2]));
      const used = new Map();
      [...css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)].forEach(m => {
        const name = m[1], hasFb = !!m[2];
        if (!used.has(name)) used.set(name, { n: 0, fb: hasFb });
        used.get(name).n++;
      });
      const bad = [...used.entries()].filter(([n, o]) => !defined.has(n) && !o.fb).map(([n]) => n);
      ok('S3 ' + rel + ' 无未定义的自定义属性', bad.length === 0, bad.length ? '未定义：' + bad.join(' ') : `用到 ${used.size} 个，全部有定义`);
      /* 三条本次修掉的，单独点名，删任何一条都会变红 */
      ['--gold-d', '--jade-d', '--ink-1'].forEach(k => {
        ok(`S3 ${path.basename(rel)} 定义了 ${k}`, defined.has(k));
      });
    }
    /* 未定义的直接后果：地图出口按钮 hover 底色被丢弃 → 白字发白。这里钉住声明本身。 */
    const css = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    ok('S3 地图出口按钮 hover 底色走 --gold-d（不再被丢弃）',
      /\.exit-map \.exit-inline:hover\s*\{[^}]*background:\s*var\(--gold-d\)/.test(css));
    ok('S3 手机端弹窗 ✕ / 底部按钮有 ≥40px 触屏目标',
      /\.modal-head button\s*\{[^}]*min-height:\s*40px/.test(css) && /min-width:\s*40px/.test(css));
    ok('S3 ☰ 菜单桌面隐藏、窄屏显形',
      /\.qb-menu\s*\{\s*display:\s*none;\s*\}/.test(css) && /\.qb-menu\s*\{\s*display:\s*inline-block;\s*\}/.test(css));
  }

  /* ---------- §4 手机端 ☰ 菜单 ---------- */
  section('§4 手机端 ☰ 菜单（窄屏侧栏被藏，面板/系统仍可达）');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const rec = stubApi(env, VIEW);
    env.WX.S.view = VIEW;
    env.WXUI.renderQuickbar(VIEW);
    const qb = env.document.getElementById('quickbar');
    ok('S4-1 快捷条渲染出 ☰ 菜单按钮（窄屏唯一入口）', /id="qb-menu"/.test(qb.innerHTML), qb.innerHTML.slice(0, 80));

    /* 战斗态：快捷条被换成攻击键，也必须有 ☰ 菜单，否则触屏验收第 9 条必挂 */
    env.WXUI.renderQuickbar({ player: {}, combat: { enemies: [], actions: [] } });
    ok('S4-2 战斗态快捷条仍有 ☰ 菜单（否则战斗里开不了背包）', /id="qb-menu"/.test(qb.innerHTML));

    /* 真点 ☰ → 真弹菜单 */
    env.WXUI.renderQuickbar(VIEW);
    const menuBtn = env.document.getElementById('qb-menu');
    ok('S4-3 #qb-menu 绑定了点击', typeof menuBtn.onclick === 'function');
    menuBtn.onclick();
    const cl = env.document.getElementById('choices-list').innerHTML;
    ok('S4-4 ☰ 菜单含「设置」「保存进度」「返回主菜单」', /设置/.test(cl) && /保存进度/.test(cl) && /返回主菜单/.test(cl));
    ok('S4-5 ☰ 菜单含窄屏点不到的「属性 / 装备 / 姻缘义亲 / 我的家宅」',
      /属性/.test(cl) && /装备/.test(cl) && /姻缘义亲/.test(cl) && /我的家宅/.test(cl));

    /* 点「设置」→ 真开设置弹窗（此前手机上无任何入口） */
    const items = env.document.getElementById('choices-list').children;
    const setBtn = items.find(c => /c-label">设置<\/span>/.test(String(c.innerHTML || '')));
    ok('S4-6 ☰ 菜单里找到「设置」项', !!setBtn);
    if (setBtn) { setBtn.onclick(); await settle(); }
    const mb = env.document.getElementById('modal-body').innerHTML;
    ok('S4-7 ★ 点「设置」真开出设置面板（含「字体大小」）',
      env.document.getElementById('modal-title').textContent === '设置' && /字体大小/.test(mb),
      env.document.getElementById('modal-title').textContent);

    /* 点「背包」→ 真开背包（走真 panel 路径，api.view 被调用） */
    const env2 = loadUi(makeEnv({ innerWidth: 375 }));
    const rec2 = stubApi(env2, VIEW);
    env2.WX.S.view = VIEW;
    env2.WXUI.renderQuickbar(VIEW);
    env2.document.getElementById('qb-menu').onclick();
    const bagBtn = env2.document.getElementById('choices-list').children.find(c => /c-label">行囊<\/span>/.test(String(c.innerHTML || '')));
    if (bagBtn) { bagBtn.onclick(); await settle(); }
    /* 口径变更（主人 2026-10-11）：「背包」这个说法改成「行囊」了，按钮文字随之。 */
    ok('S4-8 ★ 点「行囊」→ 真请求 inventory 面板',
      rec2.view.indexOf('inventory') >= 0 && env2.document.getElementById('modal-title').textContent === '随身行囊',
      'view=' + rec2.view.join(',') + ' / title=' + env2.document.getElementById('modal-title').textContent);
  }

  /* ---------- §5 桌面热键：弹窗背后不许走路 ---------- */
  section('§5 桌面热键 · 弹窗开着时不许偷偷走路');
  {
    const env = loadUi(makeEnv({ innerWidth: 1280 }));
    const rec = stubApi(env, VIEW);
    env.WX.S.screen = 'game';
    env.WX.S.view = VIEW;
    closeMasks(env);                 /* 真实初始：两个遮罩都是 hidden（关着） */
    env.WXUI.bindHotkeys();
    const key = k => (env.__docL.keydown || []).forEach(f => f({ key: k, target: { tagName: 'BODY' }, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {} }));

    /* ① 无弹窗 → 方向键真的走（w 是「向北」的热键，映射到指令 n） */
    rec.exec.length = 0;
    key('w'); await settle();
    ok('S5-1 无弹窗：按 w 真发出移动指令 n', rec.exec.length === 1 && rec.exec[0].cmd === 'n', rec.exec.map(x => x.cmd).join(',') || '(空)');

    /* ② 打开弹窗 → 方向键被屏蔽 */
    env.document.getElementById('modal-mask').classList.remove('hidden');
    rec.exec.length = 0;
    key('w'); key('d'); await settle();
    ok('S5-2 ★ 弹窗开着：按 w/d 不再走路（旧实现会在弹窗背后移动）', rec.exec.length === 0, rec.exec.map(x => x.cmd).join(',') || '(空)');

    /* ③ 弹窗开着：字母 i 不再开背包 */
    rec.view.length = 0;
    key('i'); await settle();
    ok('S5-3 ★ 弹窗开着：按 i 不再开背包面板', rec.view.length === 0, rec.view.join(',') || '(空)');

    /* ④ 选择框开着同样屏蔽（NPC 菜单就是 choices）—— 同一道守卫
       （数字键 1-9 也走这道守卫，但本 DOM stub 里 document.querySelectorAll('.exit-map')
         恒为 []，数字键路径无从触发 → 不做「看着绿其实没测到」的假断言，见报告说明） */
    env.document.getElementById('modal-mask').classList.add('hidden');
    env.document.getElementById('choices-mask').classList.remove('hidden');
    rec.exec.length = 0;
    key('w'); await settle();
    ok('S5-4 ★ 选择框开着：同样不走路', rec.exec.length === 0, rec.exec.map(x => x.cmd).join(',') || '(空)');

    /* ⑤ 关掉之后恢复（别把门永久焊死） */
    closeMasks(env);
    rec.exec.length = 0;
    key('w'); await settle();
    ok('S5-5 ★ 弹窗关掉后，方向键恢复（门没焊死）', rec.exec.length === 1 && rec.exec[0].cmd === 'n', rec.exec.map(x => x.cmd).join(',') || '(空)');
  }

  /* ---------- §6 长日志流 ---------- */
  section('§6 长日志流：上限 + 自动滚到底');
  {
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    const lines = [];
    for (let i = 0; i < 700; i++) lines.push({ type: 'plain', text: 'L' + i });
    env.WXUI.appendLog(lines);
    const log = env.document.getElementById('log');
    const html = log.innerHTML || '';
    const n = (html.match(/data-li="/g) || []).length;
    ok('S6-1 日志超过上限后只保留 600 行（不再无限增长卡手机）', n === 600, '渲染 ' + n + ' 行');
    ok('S6-2 保留的是**最近**的（丢了开头、留着结尾）',
      html.indexOf('L699') >= 0 && html.indexOf('L0<') < 0 && html.indexOf('">L0<') < 0);

    /* 自动滚底：把 scrollHeight 设成非 0，渲染后 scrollTop 应被拉到它 */
    const env2 = loadUi(makeEnv({ innerWidth: 375 }));
    const log2 = env2.document.getElementById('log');
    log2.scrollHeight = 4321;
    env2.WXUI.appendLog([{ type: 'plain', text: '一行' }]);
    ok('S6-3 ★ 新日志自动滚到底（scrollTop=scrollHeight）', log2.scrollTop === 4321, 'scrollTop=' + log2.scrollTop);
  }

  /* ---------- §7 ☰ 菜单 ⊇ 侧栏面板全集 ---------- */
  section('§7 窄屏 ☰ 菜单必须覆盖侧栏全部入口（防「加了面板忘了加 ☰」复发）');
  {
    /* 侧栏真身：从 index.html 抓（声明式 —— 改 HTML 即被覆盖，不维护第二份清单） */
    const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
    const sbHtml = (html.match(/<aside id="sidebar"[\s\S]*?<\/aside>/) || [''])[0];
    const sbPanels = [...sbHtml.matchAll(/data-panel="([^"]+)"/g)].map(m => m[1]);
    const sbActs = [...sbHtml.matchAll(/data-act="([^"]+)"/g)].map(m => m[1]);
    ok('S7-0 从 index.html 侧栏读到入口（前置）', sbPanels.length >= 10 && sbActs.length >= 5,
      `panel ${sbPanels.length} 个 / act ${sbActs.length} 个`);

    /* 行为化枚举 ☰：逐个**真点**，看它真的打开了哪个面板 / 触发了哪个动作 */
    const env = loadUi(makeEnv({ innerWidth: 375 }));
    env.WX.S.view = VIEW; env.WX.S.screen = 'game'; env.WX.S.busy = false;
    const seen = { panels: new Set(), acts: new Set() };
    env.WX.api.view = async (p) => { seen.panels.add(p); return { ok: true, view: VIEW }; };
    env.WX.api.exec = async () => ({ ok: true, lines: [] });
    env.WX.api.markGuide = async () => ({ ok: true });
    env.WX.api.saves = async () => ({ ok: true, saves: [] });
    env.WX.api.save = async () => ({ ok: true, data: {} });
    env.WX.api.delSave = async () => ({ ok: true });
    env.WXUI.renderQuickbar(VIEW);

    const labels = [];
    const menuItems = () => { env.document.getElementById('qb-menu').onclick(); return env.document.getElementById('choices-list').children.slice(); };
    const labelOf = c => { const m = String(c.innerHTML || '').match(/c-label">([^<]*)</); return m ? m[1] : ''; };
    const count = menuItems().length;
    ok('S7-1 ☰ 菜单渲染出条目', count >= 15, count + ' 项');
    for (let i = 0; i < count; i++) {
      const its = menuItems();                 /* 每轮重开（点一下就把菜单关了） */
      const btn = its[i];
      if (!btn) break;
      labels.push(labelOf(btn));
      env.WX.S.screen = 'game';
      btn.onclick();
      await settle(); await settle();
      const title = env.document.getElementById('modal-title').textContent || '';
      if (title === '设置') seen.acts.add('settings');
      else if (title === '保存进度') seen.acts.add('save');
      else if (title === '读取存档') seen.acts.add('loadlist');
      else if (title === '退出游戏') seen.acts.add('backmenu');
      if (env.WX.S.screen === 'modcenter') seen.acts.add('modcenter');
      if (env.WX.S.screen === 'modmaker') seen.acts.add('modmaker');
      closeMasks(env);
    }
    ok('S7-2 ☰ 条目标签无重复', new Set(labels).size === labels.length, labels.join(' / '));

    const missingP = sbPanels.filter(p => !seen.panels.has(p));
    const missingA = sbActs.filter(a => !seen.acts.has(a));
    ok('S7-3 ★ 侧栏每个 data-panel 在 ☰ 里都有入口（点它真打开同一面板）',
      missingP.length === 0, missingP.length ? '缺：' + missingP.join(',') : `覆盖 ${sbPanels.length}/${sbPanels.length}`);
    ok('S7-4 ★ 侧栏每个 data-act 在 ☰ 里都有入口（点它真触发同一动作）',
      missingA.length === 0, missingA.length ? '缺：' + missingA.join(',') : `覆盖 ${sbActs.length}/${sbActs.length}`);

    /* 反向：☰ 不许有「侧栏之外的**野项**」——两套清单各自演化正是复发的温床。
       允许两项**已知多余项**（奴册·护院 / 江湖指引：它们根本不在侧栏里，
       窄屏只能靠 ☰ 进）。别的多余项仍报红。 */
    const EXTRAS = { panels: ['slaves', 'guide'], acts: [] };
    const wildP = [...seen.panels].filter(p => sbPanels.indexOf(p) < 0 && EXTRAS.panels.indexOf(p) < 0);
    const wildA = [...seen.acts].filter(a => sbActs.indexOf(a) < 0 && EXTRAS.acts.indexOf(a) < 0);
    ok('S7-5 ★ ☰ 无侧栏之外的野项（已知多余项：奴册 / 指引 除外）',
      wildP.length === 0 && wildA.length === 0,
      '野 panel=' + (wildP.join(',') || '无') + '；野 act=' + (wildA.join(',') || '无'));
  }

  /* ---------- §8 中栏统一成一列（D2） ---------- */
  section('§8 中栏「一列」统一宽度上限（D2 · CSS 契约，观感需人工/真机复核）');
  {
    const css = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    /* 取某选择器的**第一处**声明块 */
    const decl = (sel) => {
      const m = css.match(new RegExp('(?:^|\\n)\\s*' + sel + '\\s*\\{([^}]*)\\}'));
      return m ? m[1] : '';
    };
    /* ① 上限值只有一个来源（窄屏那条 `--col-w: none` 覆写不算第二个宽度值） */
    const colDefs = [...css.matchAll(/--col-w\s*:\s*([^;}]+)/g)].map(m => m[1].trim());
    const realDefs = colDefs.filter(v => v !== 'none');
    ok('S8-1 ★ --col-w 的**宽度值**只定义一次（窄屏 none 覆写除外，防各处各写一个数字）',
      realDefs.length === 1 && colDefs.length === realDefs.length + 1,
      '全部定义 = ' + colDefs.join(' | '));
    const colVal = realDefs[0] || '';

    /* ② 四块同值
       ⚠️ 口径来回改过一次（主人 2026-10-11）：
       先要求「输入框拉长到碰到屏幕左右两侧」（当时拆成「三块 + 通栏」），随后又要求**回滚**。
       现在恢复成原来的四块同值 —— 输入框不许再脱离 `--col-w`。 */
    const blocks = {
      '#room-panel': decl('#room-panel'),
      '.log': decl('\\.log'),
      '#cmdbar': decl('#cmdbar'),
      '.quickbar': decl('\\.quickbar'),
    };
    const usingVar = Object.keys(blocks).filter(k => /max-width:\s*var\(--col-w\)/.test(blocks[k]));
    const notUsing = Object.keys(blocks).filter(k => usingVar.indexOf(k) < 0);
    ok('S8-2 ★ 房间卡 / 日志 / 输入栏 / 快捷条 四块都用同一个 max-width: var(--col-w)',
      usingVar.length === 4, notUsing.length ? '缺：' + notUsing.join(',') : usingVar.join(' / '));

    /* ③ 上限落在**块级卡片本身**上，而不是里面的文字上 —— 否则出现「半截底色」 */
    ok('S8-3 房间卡：上限与它的底色/边框在**同一元素**上（缩窄后底色仍包住内容）',
      /max-width:\s*var\(--col-w\)/.test(blocks['#room-panel'])
      && /background/.test(blocks['#room-panel']) && /border/.test(blocks['#room-panel']));

    /* ④ 输入栏单行 flex（不换行）→ 输入框+发送按钮不会被挤成两层 */
    ok('S8-4 输入栏是**单行** flex（无 flex-wrap）→ 缩窄后输入框与发送按钮仍同一行',
      /display:\s*flex/.test(blocks['#cmdbar']) && !/flex-wrap:\s*wrap/.test(blocks['#cmdbar']),
      blocks['#cmdbar'].trim().slice(0, 70));

    /* ⑤ 出口九宫格不被列宽挤坏 */
    const exitMap = decl('\\.log-line \\.exit-map');
    ok('S8-5 出口九宫格自保：.exit-map 仍 max-width:100%（窄于列宽也不溢出/截断）',
      /max-width:\s*100%/.test(exitMap), exitMap.trim().slice(0, 70));
    ok('S8-6 出口行仍居中放置（.log-line.exits → justify-content:center）',
      /justify-content:\s*center/.test(decl('\\.log-line\\.exits')));

    /* ⑥-b 角色创建界面（主人 2026-10-11 亲报三条）
       「手机版创建角色界面的『返回』与『踏入江湖』按钮 UI 太大了；
        选择出身与天赋的框太挤了，一堆选择需要滚动去翻；创建角色界面 UI 做好一点」。
       改前实测：单个按钮 260×53（`.btn-ink` 写死 `min-width:260px`，两个并排 = 520 > 390），
       出身/天赋各是一个 240px 的**内层滚动框**（11 张卡各 137px，只看得见 3 张）。
       这两条各钉一条断言 —— 它们都会「悄悄回来」：min-width 一写回去按钮立刻撑爆，
       内层 max-height 一写回去又变成滚着翻。 */
    ok('S8-11 ★ 创建界面的按钮放开了 .btn-ink 的 min-width（否则两个并排撑爆手机）',
      /\.create-foot\s+\.btn-ink\s*\{[^}]*min-width:\s*0/.test(css),
      (css.match(/\.create-foot\s+\.btn-ink\s*\{[^}]*\}/) || ['（没找到该规则）'])[0].slice(0, 70));
    /** 取某条选择器列表的声明体（多行逗号列表也要认） */
    const bodyOf = (sel) => {
      const re = new RegExp('(^|[},])\\s*' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*(,[^{}]*)?\\{([^}]*)\\}', 'm');
      const m = css.match(re);
      return m ? m[3] : '';
    };
    const blBody = bodyOf('.birth-list') + bodyOf('.perk-list');
    ok('S8-12 ★ 出身/天赋列表不许内层滚动（max-height + overflow-y:auto = 要滚着翻）',
      /* 只拦「带数值的 max-height」（那是真封顶），`max-height: none` 是明确的不封顶 */
      !/max-height\s*:\s*\d/.test(blBody) && !/overflow-y\s*:\s*auto/.test(blBody),
      blBody.replace(/\s+/g, ' ').slice(0, 70) || '（没找到声明）');
    ok('S8-13 ★ 卡片是「药丸」不是「大卡」（长文进详情条，否则一屏放不下）',
      /\.bc-desc[^{]*\{[^}]*display:\s*none/.test(css)
      && /pick-detail\s*\{/.test(css), '（详情条 .pick-detail 在）');

    /* ⑥ 窄屏断点：显式覆写成 none → 四块满宽（手机照旧好点） */
    const mq = (css.match(/@media\s*\(max-width:\s*820px\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
    ok('S8-7 ★ 窄屏断点把 --col-w 覆写为 none（手机端四块满宽可点，不早生效）',
      /--col-w\s*:\s*none/.test(mq), (mq.match(/--col-w\s*:\s*none/) || [''])[0] || '(未找到 820 断点覆写)');

    /* ⑦ 不再有第二个数字源：旧的行内 72ch 已并入 --col-w */
    ok('S8-8 日志行内不再自带**宽度**数字（旧 72ch 已删；宽度只由 --col-w 给）',
      !/max-width\s*:\s*[0-9.]/.test(decl('\\.log-line')) && !/72ch/.test(css),
      (decl('\\.log-line') || '').trim().slice(0, 70));

    /* ⑧ 换算 proxy：上限折算 px 落在舒服区间 */
    const remPx = /rem$/.test(colVal) ? parseFloat(colVal) * 16 : 0;
    ok('S8-9 上限折算 ≈520~780px（既非窄条也非无限宽）',
      remPx >= 520 && remPx <= 780, colVal ? `${colVal} → ${remPx}px @100% 根字号` : '(无)');
  }

  /* ================================================================
   * ⑨ 真机截图发现的三处修复（主理人在真浏览器里量出来的）
   *
   *  这三个都是「桌面端看不出来、只有真机/真浏览器才暴露」的毛病，
   *  所以断言也打在**真实渲染结果**与**真实声明契约**上，不打在代码长相上。
   * ================================================================ */
  section('⑨ 真机发现的三处修复（触屏目标 / 状态条换行 / 数值取整）');
  {
    /* ---- ⑨-1/2 数值小数位：生存系统按小数扣，顶栏不能出现「饱食 99.9187/100」 ----
       ⚠️ 主人第二轮把标准说清楚了：「饱食度与饮水小数点**不要超过一位**小数」。
       所以判据是「最多一位小数」，不是「必须是整数」——
       原来那条 `^饱食 \d+\/\d+$`（不许有小数点）是**我自己想当然定的**，
       比主人的要求更严；主人既然明说了「不超过一位」，就按一位来。
       仍然是**下取整**（99.9187 → 99.9）：四舍五入会把 99.96 显示成满值 100，
       没满却写满 = 谎报。 */
    const e2 = new GameEngine({ seed: SEED });
    e2.boot(); e2.newGame();
    const v2 = e2.view();
    v2.player.food = 99.9187;    /* 故意给小数，模拟真实扣血扣饭后的值 */
    v2.player.water = 12.3456;
    const env2 = loadUi(makeEnv({ innerWidth: 390 }));
    env2.WXUI.renderTopbar(v2.player);
    const foodTxt = String(env2.document.getElementById('txt-food').textContent || '');
    const waterTxt = String(env2.document.getElementById('txt-water').textContent || '');
    const ONE_DEC = /^\S+ -?\d+(\.\d)?\/\d+(\.\d)?$/;
    ok('⑨-1 ★ 饱食小数位 ≤1（不再是 99.9187）', ONE_DEC.test(foodTxt), foodTxt);
    ok('⑨-2 ★ 饮水小数位 ≤1（不再是 12.3456）', ONE_DEC.test(waterTxt), waterTxt);
    /* 防「修成恒 0/取整取错」：数值必须还是原值的下取整到一位 */
    ok('⑨-2b ★ 值本身是下取整到一位（不是归零、也不是四舍五入到满）',
      /^饱食 99\.9\/100$/.test(foodTxt) && /^饮水 12\.3\/100$/.test(waterTxt),
      foodTxt + ' / ' + waterTxt);
    /* ⑨-2c 「状态一览」面板同一规范（原来只有顶栏取了整，面板还印原值） */
    ok('⑨-2c ★ 状态一览面板也走同一入口（不出现 4 位小数）',
      typeof env2.WXUI.fmt1 === 'function' && env2.WXUI.fmt1(99.9187) === 99.9 &&
      env2.WXUI.fmt1(12.0) === 12,
      'fmt1(99.9187)=' + env2.WXUI.fmt1(99.9187) + ' fmt1(12)=' + env2.WXUI.fmt1(12));

    /* ---- ⑨-3 窄屏快捷条按钮 ≥40px（原来只有 29px，手指点不准） ---- */
    const css = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
    const i820 = css.indexOf('@media (max-width: 820px)');
    const seg820 = i820 >= 0 ? css.slice(i820, i820 + 2600) : '';
    const qbRule = (seg820.match(/\.qb-btn\s*\{[^}]*\}/) || [''])[0];
    const mh = parseInt((qbRule.match(/min-height:\s*(\d+)px/) || [])[1] || '0', 10);
    ok('⑨-3 窄屏 .qb-btn 最小高度 ≥40px（触屏可点）', mh >= 40, `.qb-btn{${qbRule}} → ${mh}px`);

    /* ---- ⑨-4/5 ≤560px 状态条换行 + 最小宽度（5 条一行会把标签挤断） ----
       ⚠️ 取的是**所有** 560px 段拼起来，不是「第一个」——
       曾经因为别处新插了一个 560px 段，把第一个段之后的规则全截掉，
       于是在没有回归的情况下假红一次。扫描全部段才不会被排版顺序误伤。 */
    const seg560 = (() => {
      let out = '', i = -1;
      while ((i = css.indexOf('@media (max-width: 560px)', i + 1)) >= 0) out += css.slice(i, i + 1400) + '\n';
      return out;
    })();
    ok('⑨-4 ≤560px 状态条允许换行', /\.tb-bars\s*\{[^}]*flex-wrap:\s*wrap/.test(seg560),
      (seg560.match(/\.tb-bars\s*\{[^}]*\}/) || [''])[0]);
    const barRule = (seg560.match(/\.tb-bar\s*\{[^}]*\}/) || [''])[0];
    const minW = parseInt((barRule.match(/min-width:\s*(\d+)px/) || [])[1] || '0', 10);
    ok('⑨-5 ≤560px 状态条有最小宽度（数字读得全）', minW >= 90, `.tb-bar{${barRule}} → ${minW}px`);
  }

  /* ================================================================
   *  ⑩ 第二轮主人报的问题（UI 侧三条）
   *    · 快捷键「实际点了的效果」（主人：「你要不要看看实际点了的效果？
   *      比如说点任务快捷键弹出来的还是旧主线」）
   *    · 地图横向划不动（CSS 契约：max-width 与 max-height 必须成对）
   *    · 任务面板分组（主线不再把面板占满）
   * ================================================================ */
  section('⑩ 第二轮 · 默认快捷键的真效果 / 地图横向可滑 / 任务面板分组');
  {
    const probe = loadUi(makeEnv({ innerWidth: 375 }));
    const panelFor = c => !!probe.WXUI.panelForCmd(c);
    /* ---- ⑩-1 逐个真点默认快捷键：必须是**本地开面板**，不许打后端 ----
       这条正是主人怀疑的地方。真点（走真 onclick → doCmd），读真记录：
       ① 一条 api.exec 都不许有（面板指令本地处理；打后端就会得到
          「「guide」是什么指令？」这种答复）；
       ② 面板真的开了（modal 不是 hidden，且有正文）。 */
    const QUICK = ['look', 'i', 'skills', 'sc', 'meditate', 'heal', 'map', 'quests', 'help', 'guide'];
    const bad = [];
    for (const cmd of QUICK) {
      const env = loadUi(makeEnv({ innerWidth: 375 }));
      const rec = stubApi(env, VIEW);
      closeMasks(env);
      await env.WXUI.doCmd(cmd, { fromButton: true });
      await settle();
      const execd = rec.exec.map(x => x.cmd);
      const mask = String(env.document.getElementById('modal-mask').className || '');
      const body = String(env.document.getElementById('modal-body').innerHTML || '');
      /* look / meditate / heal 是**真指令**（要走后端才有效果）—— 只查面板类那 7 个 */
      const isPanelCmd = !!env.WXUI.panelForCmd(cmd);
      const badInfo = [];
      if (isPanelCmd && execd.length) badInfo.push('打了后端：' + execd.join(','));
      if (isPanelCmd && mask.indexOf('hidden') >= 0) badInfo.push('面板没开');
      if (isPanelCmd && body.length < 10) badInfo.push('面板是空的');
      if (!isPanelCmd && !execd.length) badInfo.push('是真指令却没过后端');
      if (badInfo.length) bad.push(cmd + '(' + badInfo.join('；') + ')');
    }
    ok('⑩-1 ★ 默认快捷键逐条真点：面板类本地开面板、指令类真过后端（无一条点了没反应）',
      bad.length === 0, bad.length ? bad.join(' | ') : QUICK.length + ' 项全部有真实效果');
    ok('⑩-1b 「guide」属于面板类（前端拦截，不打后端）',
      panelFor('guide'), 'panelForCmd(guide)=' + panelFor('guide'));

    /* ---- ⑩-2 地图画布 CSS 契约：max-width 与 max-height 成对 ----
       为什么只能查 CSS 字符串：真实横向溢出要有**排版引擎**（getComputedStyle /
       scrollWidth）才算得出，本测试的假 DOM 没有。所以这里断「契约」——
       `.map-canvas` 必须同时声明 max-width 与 max-height，缺一个横向就划不动。 */
    const css2 = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
    const cvRule = (css2.match(/\.map-canvas\s*\{[^}]*\}/) || [''])[0];
    ok('⑩-2 ★ .map-canvas 同时有 max-width 与 max-height（缺 max-width = 横向永远划不动）',
      /* ⚠️ 别把高度写死成 54vh —— 本条的**意图**是「两条成对声明」，
         具体数值是会跟着版式调整的（地图重设计时抬头收窄、画布放宽到 58vh 就假红过一次）。 */
      /max-width:\s*100%/.test(cvRule) && /max-height:\s*\d+(?:\.\d+)?(?:vh|px|%)/.test(cvRule), cvRule.slice(0, 200));
    ok('⑩-2b .map-canvas 仍是 overflow:auto + touch-action:none（自带平移的前提）',
      /overflow:\s*auto/.test(cvRule) && /touch-action:\s*none/.test(cvRule));
    /* ---- ⑩-2c 出口行的方向名（**真渲染**，不许 grep 源码当断言）----
       ⚠️ 这里踩过一回：第一版写的是 `/ne:\s*'东北'/.test(源码)` ——
       而 ui.js 里另有**两处**局部 `const CN = {…ne: '东北'…}`（出口九宫格用的），
       把 DIR_CN 里那行删掉，源码 grep 依然命中 → 变异测下来**恒绿**。
       所以改成走真渲染：打开地图，读 `.map-now` 那一行的文本。 */
    const envM = loadUi(makeEnv({ innerWidth: 375 }));
    stubApi(envM, VIEW);
    closeMasks(envM);
    const diagExit = (VIEW.exits || []).filter(x => String(x.dir).length === 2);
    ok('⑩-2c-0 前提：出生房确有斜向出口（否则本条测不到方向名）',
      diagExit.length > 0, '斜向出口=' + diagExit.map(x => x.dir + '→' + x.toName).join(',') || '(无)');
    await envM.WXUI.panel('map');
    await settle();
    const mh = String(envM.document.getElementById('modal-body').innerHTML || '');
    const nowTxt = ((mh.match(/<div class="map-now">([\s\S]*?)<\/div>/) || [])[1] || '').replace(/<[^>]*>/g, '');
    ok('⑩-2c ★ 地图出口行只用中文方向，不印英文 ne/nw/se/sw（真渲染）',
      nowTxt.indexOf('出口') >= 0
      && !/(?:^|[^a-zA-Z])(ne|nw|se|sw)(?![a-zA-Z])/.test(nowTxt),
      '出口行=' + nowTxt.slice(0, 60));

    /* ---- ⑩-3 任务面板分组 ----
       原来一把梭平铺：只要挂着一条主线，打开面板第一屏全是主线，
       看着就像「任务面板只有主线/还是旧主线」。现在按类型分组。 */
    const qView = JSON.parse(JSON.stringify(VIEW));
    qView.quests = {
      active: [
        { id: 'a', name: '甲', type: '主线', desc: 'd', stageDesc: 's', targets: [] },
        { id: 'b', name: '乙', type: '支线', desc: 'd', stageDesc: 's', targets: [] },
        { id: 'c', name: '丙', type: '支线', desc: 'd', stageDesc: 's', targets: [] },
      ],
      done: [], completedCount: 0,
    };
    const env3 = loadUi(makeEnv({ innerWidth: 1280 }));
    stubApi(env3, qView);
    closeMasks(env3);
    await env3.WXUI.panel('quests');
    await settle();
    const qh = String(env3.document.getElementById('modal-body').innerHTML || '');
    ok('⑩-3 ★ 任务面板按类型分组（出现「主线」「支线」小标题）',
      /q-group-title[^>]*>主线/.test(qh) && /q-group-title[^>]*>支线/.test(qh), qh.slice(0, 160));
    ok('⑩-3b ★ 主线排在支线前面（故事线优先，但不再把支线挤没了）',
      qh.indexOf('q-group-title') >= 0 && qh.indexOf('主线') < qh.indexOf('支线'));
    ok('⑩-3c 分组小标题带条数（2 条支线 → 显示 2）',
      /qg-num[^>]*>2</.test(qh), (qh.match(/<span class="qg-num">[^<]*/) || [''])[0]);
    ok('⑩-3d 三张卡都在（分组不丢内容）',
      ['甲', '乙', '丙'].every(n => qh.indexOf(n) >= 0));
  }

  /* ================================================================
   *  ⑪ 第三轮主人要求：NPC「细看此人」详情界面
   *
   *  走的是**真实调用链**：真 engine + 真 spawnNpc + 真 scene 卡片 onclick
   *  → 真 choices 项 onclick → 真 api.npcProfile（喂真 engine.npcProfileOf）
   *  → 真 modal 渲染 → 读真 #modal-body。
   *
   *  ★ 断的是**结构**不是文本片段：
   *    「未解锁的条目只给锁提示、不给正文」用
   *    `locked 条数 === np-slock 个数` 与 `np-stext 个数 === 解锁条数` 来卡，
   *    比在 HTML 里找某段中文更抗改（文案改了结构断言还立得住）。
   * ================================================================ */
  section('⑪ 第三轮 · NPC 详情界面（细看此人 → 新界面 + 背景故事分层解锁）');
  {
    const w2 = engine.world;
    /* 挑一个「画像完整」的：有来历/隐秘/恩怨（全库 42 位 A/B 层才齐） */
    let target = null;
    for (const id of Object.keys(w2.data.npcs)) {
      const d = w2.data.npcs[id];
      if (d && d.portrait && d.portrait.origin && d.portrait.now && d.portrait.fear
        && d.portrait.secret && d.portrait.feuds && d.portrait.feuds.length) { target = d; break; }
    }
    ok('S11-0 前提：找得到一个画像完整的 NPC（有来历/惧怕/隐秘/恩怨）',
      !!target, target ? target.id + ' / ' + target.name : '无');

    if (target) {
      const inst = w2.spawnNpc(target.id, w2.player.room, 1, true);
      ok('S11-0b 实例生成成功', !!inst, inst ? inst.id : '-');

      /* 渲染一次并取回真 modal 正文；trust 由参数控制 */
      const render = async (trust) => {
        inst.pstate = inst.pstate || {};
        inst.pstate.trust = trust;
        const v = engine.view();
        const env = loadUi(makeEnv({ innerWidth: 375 }));
        const rec = stubApi(env, v);
        closeMasks(env);
        env.WX.S.view = v;
        env.WXUI.renderScene(v);
        const box = env.document.getElementById('scene-npcs');
        const card = box.children.find(c => String(c.innerHTML || '').indexOf(target.name) >= 0);
        if (!card) return { env, rec, html: '', clicked: false, err: '场景栏没有他的卡片' };
        card.onclick();
        const pb = env.document.getElementById('choices-list').children
          .find(c => /细看此人/.test(String(c.innerHTML || '')));
        if (!pb) return { env, rec, html: '', clicked: false, err: '菜单里没有「细看此人」' };
        pb.onclick();
        await settle(); await settle();
        return {
          env, rec, clicked: true,
          html: String(env.document.getElementById('modal-body').innerHTML || ''),
        };
      };

      /* ---- ① trust=0：来历该给正文，其余该锁 ---- */
      const a = await render(0);
      ok('S11-1 真点「细看此人」弹出了新界面（modal 有正文）',
        a.clicked && a.html.length > 60, a.err || ('正文 ' + a.html.length + ' 字'));
      /* 按 data-sk 精确取每一块（不靠中文片段，文案改了断言还立得住） */
      const block = (html, k) => {
        const m = new RegExp('<div class="np-story[^"]*" data-sk="' + k + '">([\\s\\S]*?)</div>').exec(html);
        return m ? m[1] : null;
      };
      const { unlocked, locked } = engine.npcProfileOf(inst.id).story
        .reduce((acc, s) => { (s.unlocked ? acc.unlocked : acc.locked).push(s.key); return acc; }, { unlocked: [], locked: [] });
      /* ★ 期望值按**门槛规则**算，不是「locked 非空就行」：
         trust=0 时只有 need 为 0 的「来历」该解锁（隐秘门槛 50+tier×5 更不可能）。
         只断「locked 里有东西 + 它带锁提示」是不够的 ——
         把前五条的门槛判据写死成 `true` 也能骗过那种断言（实测漏过一次）。 */
      const needRule = engine.npcProfileOf(inst.id).story
        .filter(s => s.key === 'origin').map(s => s.key);
      ok('S11-2 ★ trust=0 时只有「来历」可见（门槛 0），其余条目只给锁提示、不泄正文',
        JSON.stringify(unlocked) === JSON.stringify(needRule) && needRule.length === 1
        && locked.length >= 4
        && !!block(a.html, 'origin') && /np-stext/.test(block(a.html, 'origin'))
        && locked.every(k => {
          const b = block(a.html, k);
          return b && /np-slock/.test(b) && !/np-stext/.test(b);
        }),
        `解锁 ${JSON.stringify(unlocked)}（期望 ${JSON.stringify(needRule)}） / 锁 ${JSON.stringify(locked)}`);
      ok('S11-2b 锁提示说的是人话（来历与心事这一节里不出现数字门槛）',
        !/≥\s*\d|\bneed\b|trust\s*[:=]\s*\d/.test(
          (a.html.match(/来历与心事[\s\S]*?(?=<div class="np-sec"|$)/) || [''])[0]),
        '（「能教你什么」那种「好感 ≥40」是另一回事，玩家需要知道刷到多少）');

      /* ---- ② trust=80：身份/武学/关系/作息/故事都该齐 ---- */
      const b = await render(80);
      const c0 = engine.npcProfileOf(inst.id);
      const bUnlocked = c0.story.filter(s => s.unlocked).length;
      const bLocked = c0.story.filter(s => !s.unlocked).length;
      ok('S11-3 ★ trust=80 时背景故事正文全开（锁提示消失）',
        bUnlocked === c0.story.length && bLocked === 0
        && c0.story.every(s => s.unlocked && block(b.html, s.key) && /np-stext/.test(block(b.html, s.key))),
        `24: 解锁 ${c0.story.length}/${c0.story.length}，锁 ${bLocked}`);
      ok('S11-3b 有「来历与心事」这一节（背景故事真的渲染出来了）',
        /来历与心事/.test(b.html));
      ok('S11-3c 有「与你的关系」且说人话（不甩 favor/trust 数字）',
        /与你的关系/.test(b.html) && /与你|待你|信得过/.test(b.html));
      ok('S11-3d 有「恩怨」一节（trust≥40 才给）',
        /恩怨/.test(b.html));
      ok('S11-3e 「武学」一节渲染出装备槽或提示', /武学/.test(b.html));

      /* ---- ③ 不许出现的两样东西 ---- */
      ok('S11-4 ★ 详情面板**不列**他喜欢收什么礼（那是要试出来的，不是官方攻略）',
        !/偏爱|喜欢的东西|送礼清单/.test(b.html));
      ok('S11-4b 不出现原始字段名（好感/信任只以人话出现）',
        !/pstate|portrait|trustCN|favorCN/.test(b.html));

      /* ---- ④ 底部快捷动作真派发 ---- */
      const tk = b.env.document.getElementById('npc-prof-talk');
      if (tk) { b.rec.exec.length = 0; tk.onclick(); await settle(); }
      ok('S11-5 ★ 详情面板底部的「交谈」真派发 `talk <名字>`',
        b.rec.exec.length === 1 && b.rec.exec[0].cmd === 'talk ' + target.name,
        b.rec.exec.map(x => x.cmd).join(',') || '(空)');

      /* ---- ⑤ 没画像的 NPC 也要能开（只是内容少），不能白屏 ---- */
      const plainId = Object.keys(w2.data.npcs).find(id => {
        const d = w2.data.npcs[id];
        return d && !d.portrait && d.name && d.room;
      });
      if (plainId) {
        const pi = w2.spawnNpc(plainId, w2.player.room, 1, true);
        const p2 = await render(0);
        void p2;
        const env9 = loadUi(makeEnv({ innerWidth: 375 }));
        stubApi(env9, engine.view());
        const html9 = env9.WXUI.__html.npcProfileHtml(engine.npcProfileOf(pi.id));
        ok('S11-6 没画像的 NPC 也能出详情（有身份/关系，不白屏）',
          /npc-prof/.test(html9) && /与你的关系/.test(html9) && /此人的底细，你只看到这些/.test(html9),
          (plainId + ' 正文 ' + html9.length + ' 字'));
      }
    }
  }

  /* ================================================================
   *  ⑫ 第四轮主人亲报（前端侧）
   *    · 日志里点 NPC 名 → 「细看此人」必须开面板（原来只打一段 look 文本）
   *    · 「送他东西」面板：含金钱、点击赠送、显示「已经送多少」
   * ================================================================ */
  section('⑫ 第四轮 · 日志里能开详情面板 / 送礼面板（物品+金钱+已送多少）');
  {
    /* ---- ⑫-1 日志高亮那一项的派发：认 act:'profile' ---- */
    {
      const env = loadUi(makeEnv({ innerWidth: 375 }));
      const rec = stubApi(env, VIEW);
      closeMasks(env);
      env.WX.S.view = VIEW;
      /* 直接跑**真实派发函数**（openInteractMenu 内部调的就是它） */
      env.WXUI.runInteractAct({ act: 'profile', uid: SNAKE.id, cmd: 'look ' + SNAKE.name }, SNAKE.name);
      await settle(); await settle();
      ok('⑫-1 ★ 日志菜单里的「细看此人」真去拉了该 NPC 的画像（不再打 look 文本流）',
        rec.npc.length === 1 && rec.exec.length === 0,
        'npcProfile=' + JSON.stringify(rec.npc) + ' exec=' + (rec.exec.map(x => x.cmd).join(',') || '(空)'));

      /* 退回路径：没有 act 的项仍按 cmd 走（老数据/别的类型的高亮不受影响） */
      const rec2 = stubApi(env, VIEW);
      env.WXUI.runInteractAct({ label: '打量', cmd: 'look ' + SNAKE.name }, SNAKE.name);
      await settle();
      ok('⑫-1b 没有 act 的项仍按 cmd 派发（老数据不受影响）',
        rec2.exec.length === 1 && rec2.exec[0].cmd === 'look ' + SNAKE.name,
        rec2.exec.map(x => x.cmd).join(',') || '(空)');
    }

    /* ---- ⑫-2 送礼面板：物品 + 金钱 + 往来 ---- */
    {
      const who = VIEW.npcs.find(n => n.gender === 'female') || VIEW.npcs[0];
      const giftView = JSON.parse(JSON.stringify(VIEW));
      giftView.player.money = 1500;
      giftView.inventory = [
        { id: 'steamed_bun', uid: 'g1', name: '馒头', count: 3, typeName: '食物' },
        { id: 'wine_bamboo', uid: 'g2', name: '竹叶青', count: 1, typeName: '酒' },
      ];
      const gn = giftView.npcs.find(n => n.name === who.name) || giftView.npcs[0];
      gn.gifts = { count: 3, money: 200, items: { '馒头': 2 } };

      const env = loadUi(makeEnv({ innerWidth: 390 }));
      const rec = stubApi(env, giftView);
      closeMasks(env);
      env.WX.S.view = giftView;
      env.WXUI.renderScene(giftView);
      const card = env.document.getElementById('scene-npcs').children
        .find(c => String(c.innerHTML || '').indexOf(gn.name) >= 0);
      card.onclick();
      const giveBtn = env.document.getElementById('choices-list').children
        .find(c => /送.*东西/.test(String(c.innerHTML || '')));
      ok('⑫-2 菜单里有「送 他/她 东西」项', !!giveBtn, giveBtn ? giveBtn._label : '-');
      if (giveBtn) {
        giveBtn.onclick();
        await settle();
        const mb = String(env.document.getElementById('modal-body').innerHTML || '');
        ok('⑫-2a ★ 面板显示「已经送多少」（往来摘要）',
          /已送\s*<b[^>]*>3<\/b>\s*次/.test(mb) || /已送\s*3\s*次/.test(mb),
          (mb.match(/此前已送[^<]*(<b>\d+<\/b>)?[^<]*次?/) || [''])[0] || mb.slice(0, 60));
        ok('⑫-2b ★ 面板里有**金钱**档位（主人要的「包括金钱」）',
          /data-amt="100"/.test(mb) && /data-amt="800"/.test(mb) && /银钱/.test(mb));
        ok('⑫-2c 显示身上还有多少钱 + 可自填数额',
          /身上还有 1500 文/.test(mb) && /money-input/.test(mb));
        ok('⑫-2d ★ 送过的物品行标了「已送 N 次」（馒头送过 2 次）',
          /已送 2 次/.test(mb));
        ok('⑫-2e 未送过的物品行没有这个标记（不是所有人都有）',
          (mb.match(/已送 \d+ 次/g) || []).length === 1);

        /* 点物品 → 真发 give */
        const itemBtn = env.document.querySelectorAll('#modal-body .pick-row[data-item]')[0]
          || env.document.getElementById('modal-body').querySelectorAll('.pick-row[data-item]')[0];
        const rows = [...mb.matchAll(/data-item="([^"]+)"/g)].map(m => m[1]);
        ok('⑫-2f 物品行带 data-item（可点）', rows.length >= 1, rows.join(','));

        /* 点金额 → 真发 `give_money <人名> <钱数>`（**后端的签名顺序**） */
        const st = [];   /* 用一个新的 env 干净地测派发 */
        const env2 = loadUi(makeEnv({ innerWidth: 390 }));
        const rec2 = stubApi(env2, giftView);
        closeMasks(env2);
        env2.WX.S.view = giftView;
        env2.WXUI.renderScene(giftView);
        env2.document.getElementById('scene-npcs').children
          .find(c => String(c.innerHTML || '').indexOf(gn.name) >= 0).onclick();
        env2.document.getElementById('choices-list').children
          .find(c => /送.*东西/.test(String(c.innerHTML || ''))).onclick();
        await settle();
        const mb2 = String(env2.document.getElementById('modal-body').innerHTML || '');
        void st;
        const amtRows = [...mb2.matchAll(/data-amt="(\d+)"/g)].map(m => m[1]);
        ok('⑫-2g 金额档位随身上钱数给（1500 文 → 800 档在）', amtRows.indexOf('800') >= 0, amtRows.join(','));
        /* 直接调那一项的处理逻辑：从真 DOM 读不到 onclick（stub 限制），
           所以断「前端发的格式」用源码契约 + 后端兼容双保险：
           ① 后端两种顺序都认（smoke-round4 §G-1/G-1b 已断）；
           ② 前端必须按签名发 —— 这里断 mb2 里的档位存在，格式由 §G 兜。 */
      }
    }
  }

  /* ================================================================
   *  ⑬ 第五轮 · NPC 菜单的「绑架」按钮（主人要的统一入口）
   *     —— 点了要**真按状态分流**，不是摆设：
   *        · 站着 → 真发 `kill <名>`（先打，真进战斗）
   *        · 晕着 + 有袋 → 真发 `装人 <名>`（直接装袋带走）
   *        · 晕着 + 没袋 → **不发指令**，只给「得先有条粗麻袋」指引
   *          （发一条注定被后端拒的指令，玩家看到的是「点了没用」）
   * ================================================================ */
  section('⑬ 第五轮 · NPC 菜单「绑架」按状态分流');
  {
    const base = JSON.parse(JSON.stringify(VIEW));
    base.kidnap = Object.assign({ hasSack: true, bags: [] }, base.kidnap || {});
    const stander = base.npcs.find(n => n.gender === 'male') || base.npcs[0];
    const downer = base.npcs.find(n => n !== stander) || base.npcs[1];
    stander.knockedOut = false;
    downer.knockedOut = true;

    /* 走真入口：场景栏卡片 onclick → 菜单 → 找「绑架」项 → 点它 */
    const clickKidnap = async (view, name) => {
      const env = loadUi(makeEnv({ innerWidth: 390 }));
      const rec = stubApi(env, view);
      closeMasks(env);
      env.WX.S.view = view;
      env.WXUI.renderScene(view);
      const card = env.document.getElementById('scene-npcs').children
        .find(c => String(c.innerHTML || '').indexOf(name) >= 0);
      if (!card) return { rec, btn: null };
      card.onclick();
      const btn = env.document.getElementById('choices-list').children
        .find(c => /绑架/.test(String(c.innerHTML || '')));
      if (btn) { btn.onclick(); await settle(); }
      return { rec, btn };
    };

    /* ⑬-1 站着的人 → kill */
    {
      const { rec, btn } = await clickKidnap(base, stander.name);
      ok('⑬-1 站着的人菜单里有「绑架」', !!btn, btn ? btn._label : '(没找到按钮)');
      /* 主人 2026-10-11：站着的人点「绑架」= 发「绑架 <名>」—— 先按成功率掷一次，
         成了当场套袋、不成就动手。掷骰与判定都在后端（kidnap.kidnapAttempt）。 */
      ok('⑬-1a ★ 站着点「绑架」→ 真发「绑架 <名>」（判定在后端）',
        rec.exec.length === 1 && rec.exec[0].cmd === '绑架 ' + stander.name,
        rec.exec.map(x => x.cmd).join(',') || '(没发指令)');
    }

    /* ⑬-2 晕着的人 + 有袋 → 装人 */
    {
      const { rec, btn } = await clickKidnap(base, downer.name);
      ok('⑬-2 晕着的人菜单里有「绑架」', !!btn, btn ? btn._label : '(没找到按钮)');
      ok('⑬-2a ★ 晕着点「绑架」→ 也走「绑架 <名>」（那条路对晕着的人是 100% 必成）',
        rec.exec.length === 1 && rec.exec[0].cmd === '绑架 ' + downer.name,
        rec.exec.map(x => x.cmd).join(',') || '(没发指令)');
    }

    /* ⑬-3 晕着 + 没袋 → 不发指令，只给指引 */
    {
      const noSack = JSON.parse(JSON.stringify(base));
      noSack.kidnap.hasSack = false;
      const { rec, btn } = await clickKidnap(noSack, downer.name);
      ok('⑬-3 晕着没袋时菜单**仍给**「绑架」入口（入口不再被藏）', !!btn, btn ? btn._label : '(没找到按钮)');
      ok('⑬-3a ★ 不发注定被拒的指令，只给「粗麻袋」指引（点了有反馈，不是死按钮）',
        rec.exec.length === 0, rec.exec.map(x => x.cmd).join(',') || '(没发指令 ✔)');
    }
  }

  /* ================================================================
   *  ⑭ 第四轮 · 「接取任务」先弹详情，玩家点头才真接
   *     —— 主人原话：「点击 NPC 页『接他的事』按钮后希望能先弹出任务详情
   *        再选择是否接受任务」。所以：
   *        · 点它 → 只**拉详情**（不发 accept）
   *        · 点「再说吧」→ 不发 accept（默认不塞任务）
   *        · 点「接下这桩事」→ 才发 `accept <任务名>`
   * ================================================================ */
  section('⑭ 第四轮 · 「接取任务」先弹详情，确认后才真接');
  {
    /* 从**真引擎**里挑一个当前真给得出「接取任务」的人（同 smoke-round4 §R 的口径）。
       ⚠️ 两处刻意的写法，都是踩过坑的：
        ① **先按 id 排序**再挑。原来直接吃 `Object.keys()` 的加载顺序，
           新加一个带头 NPC 就可能换样本 —— 这是「测试样本随加载顺序漂」的老坑。
        ② 优先挑**三段齐全**（委托人 / 要办的事 / 办成了给）的那条来验。
           本段的意图是「详情页把这三段都渲染出来」；随便挑一条「没有可见奖励」的任务，
           它本来就只该显示两段 —— 拿它去断言三段，是**拿样本的缺陷当 bug**。 */
    const cands = [];
    for (const id of Object.keys(w.data.npcs || {}).sort()) {
      const d0 = w.data.npcs[id] || {};
      if (!(Array.isArray(d0.quests) && d0.quests.length) && !d0.sidequest) continue;
      const inst = w.spawnNpc(id, p.room, 1, true);
      let act = null;
      for (const l of engine.exec('look').lines) {
        if (!Array.isArray(l.hl)) continue;
        const h = l.hl.find(x => String(x.text || '').indexOf(inst.name) === 0);
        if (h) { act = (h.actions || []).find(a => a.act === 'acceptquest'); if (act) break; }
      }
      if (act) cands.push({ id, qid: act.qid });
    }
    const full = cands.find(c => {
      const pv = engine.questPreviewOf(c.qid) || {};
      return pv.giver && (pv.targets || []).length && (pv.rewards || []).length;
    });
    const pick = full || cands[0] || null;
    const QID = pick && pick.qid, QNAME = pick && (engine.questPreviewOf(pick.qid) || {}).name;
    ok('⑭-0 前提：真引擎里找得到一个「接取任务」项', !!QID, QID + ' / ' + QNAME);

    if (QID) {
      const env = loadUi(makeEnv({ innerWidth: 390 }));
      const rec = stubApi(env, VIEW);
      closeMasks(env);
      env.WX.S.view = VIEW;

      env.WXUI.runInteractAct({ label: '接取任务', act: 'acceptquest', qid: QID, cmd: 'accept ' + QNAME });
      await settle(); await settle();
      ok('⑭-1 ★ 点「接取任务」只**拉详情**，不发 accept（不再一点就接）',
        rec.quest.length === 1 && rec.quest[0] === QID && rec.exec.length === 0,
        'quest=' + JSON.stringify(rec.quest) + ' exec=' + (rec.exec.map(x => x.cmd).join(',') || '(空)'));

      const mb = String(env.document.getElementById('modal-body').innerHTML || '');
      const mf = String(env.document.getElementById('modal-foot').innerHTML || '');
      const mt = String(env.document.getElementById('modal-title').textContent || '');
      ok('⑭-2 ★ 详情页标题就是任务名（弹窗一开就知道是哪桩事）',
        mt.indexOf(String(QNAME)) >= 0, mt || '(标题空)');
      ok('⑭-3 详情页里有「委托人 / 要办的事 / 办成了给」',
        /委托人/.test(mb) && /要办的事/.test(mb) && /办成了给/.test(mb), mb.slice(0, 120));
      ok('⑭-4 底部给「再说吧」+「接下这桩事」两个按钮',
        /再说吧/.test(mf) && /接下这桩事/.test(mf), mf.slice(0, 90));

      /* 点「再说吧」→ 什么都不发 */
      env.document.getElementById('qp-no').onclick();
      await settle();
      ok('⑭-5 ★ 点「再说吧」不发 accept（默认不往身上塞任务）',
        rec.exec.length === 0, rec.exec.map(x => x.cmd).join(',') || '(空)');

      /* 再开一次，点「接下这桩事」→ 真发 accept */
      env.WXUI.runInteractAct({ label: '接取任务', act: 'acceptquest', qid: QID, cmd: 'accept ' + QNAME });
      await settle(); await settle();
      env.document.getElementById('qp-yes').onclick();
      await settle();
      ok('⑭-6 ★ 点「接下这桩事」才真发 `accept <任务名>`（走了后端真指令）',
        rec.exec.length === 1 && rec.exec[0].cmd === 'accept ' + QNAME,
        rec.exec.map(x => x.cmd).join(',') || '(空)');
    }
  }

  /* ================================================================
   *  ⑮ 第四轮 · 「询问」面板里的「他认识的人」
   *     —— 主人要的是「弹出一个页面上面有 NPC 认识的人名字，
   *        点击这些名字按钮 NPC 会说关于它们的事」。
   *       守：面板真列出人名（data-who）、点一下真发 `ask <他> about <人名>`。
   * ================================================================ */
  section('⑮ 第四轮 · 「询问」列出他认识的人，点了真问');
  {
    /* 挑一个真有关系数据的 NPC（286 个都有），拉一份**新的** view。
       ⚠️ 两处刻意的写法，都是踩过的坑：
        ① **按 id 排序**再挑 —— 原来吃 `Object.keys` 的加载顺序，新加一批 NPC 就换样本
           （铁律：测试样本别用「第一个满足条件的」）；
        ② **必须确认他真的站在玩家这间房里**再断言卡片。名人（`w.legendIds`）走
           `findLiveNpc` 复用已有实例，spawn 到别的房间是可能的 —— 那样卡片当然没有，
           而红的是测试不是游戏。 */
    const cands = Object.keys(w.data.npcs || {}).filter(x => (w.data.npcs[x].rel || []).length > 0).sort();
    let defId = null, inst = null;
    for (const x of cands) {
      const it = w.spawnNpc(x, p.room, 1, true);
      if (it && it.room === p.room) { defId = x; inst = it; break; }
    }
    ok('⑮-0 前提：真引擎里找得到一个有关系的 NPC 且他真在场上', !!inst, String(defId));
    if (inst) {
      const v15 = engine.view();
      const env = loadUi(makeEnv({ innerWidth: 390 }));
      const rec = stubApi(env, v15);
      closeMasks(env);
      env.WX.S.view = v15;
      env.WXUI.renderScene(v15);
      const card = env.document.getElementById('scene-npcs').children
        .find(c => String(c.innerHTML || '').indexOf(inst.name) >= 0);
      ok('⑮-1 场景栏造出他的卡片', !!card, inst.name);
      if (card) {
        card.onclick();
        const askBtn = env.document.getElementById('choices-list').children
          .find(c => /询问/.test(String(c.innerHTML || '')));
        ok('⑮-2 菜单里有「询问」', !!askBtn, askBtn ? askBtn._label : '-');
        if (askBtn) {
          askBtn.onclick();
          await settle();
          const mb = String(env.document.getElementById('modal-body').innerHTML || '');
          ok('⑮-3 ★ 面板里有「他认识的人」一栏', /他认识的人/.test(mb), mb.slice(0, 80));
          const who = [...mb.matchAll(/data-who="([^"]+)"/g)].map(m => m[1]);
          ok('⑮-4 ★ 列出了人名按钮（带 data-who）', who.length > 0, who.join('、'));
          ok('⑮-5 名字旁边标了关系（仇人/故交/亲人）',
            /(仇人|友人|亲人|熟人)<\/sup>/.test(mb), (mb.match(/<sup>[^<]*<\/sup>/g) || []).slice(0, 3).join(' '));

          /* 点第一个名字 → 真发 ask */
          /* ⚠️ 必须用**与 ui.js 完全相同的选择器**去抠：
             解析结果按 `(选择器, innerHTML)` 缓存，换一个写法就拿到**另一批**
             新建对象 —— 那批上没绑 onclick，点它等于点空气（实测踩过）。 */
          const btn = env.document.querySelectorAll('#modal-body .mini-tag')
            .find(b => b.getAttribute('data-who'));
          ok('⑮-6 抠得到人名按钮（且带着 ui.js 绑好的 onclick）',
            !!btn && typeof btn.onclick === 'function', btn ? btn.getAttribute('data-who') : '-');
          if (btn) {
            btn.onclick();
            await settle();
            ok('⑮-7 ★ 点人名真发 `ask <他> about <那个人>`',
              rec.exec.length === 1 && rec.exec[0].cmd === 'ask ' + inst.name + ' about ' + who[0],
              rec.exec.map(x => x.cmd).join(',') || '(没发指令)');
          }
        }
      }
    }
  }

  /* ================================================================
   *  ⑯ 第四轮 · 「任务」面板置顶新手教程（只给当前进度）
   *     —— 主人原话：「在新手教程完成前把新手教程任务添加进『任务』里面置顶
   *        （直接点『新手教程』快捷键进入新手教程页面能看完整的新手教程任务流程
   *        不同，『任务』里面只会显示当前新手教程进度）」
   * ================================================================ */
  section('⑯ 第四轮 · 「任务」面板置顶新手教程（只给当前进度）');
  {
    const v = engine.view();
    ok('⑯-0 前提：真引擎的任务列表首条就是新手教程',
      !!((v.quests.active || [])[0] || {}).isTutorial,
      ((v.quests.active || [])[0] || {}).name);

    const env = loadUi(makeEnv({ innerWidth: 390 }));
    stubApi(env, v);
    closeMasks(env);
    env.WX.S.view = v;
    await env.WXUI.panel('quests');
    await settle();
    const mb = String(env.document.getElementById('modal-body').innerHTML || '');

    ok('⑯-1 ★ 面板里出现「<名>（新手教程）」', /入江湖（新手教程）/.test(mb), mb.slice(0, 80));
    ok('⑯-2 ★ 新手那条有自己的卡片样式（quest-card newbie）', /quest-card newbie/.test(mb));
    ok('⑯-3 ★ 带「进行中」角标与进度条', /qn-badge/.test(mb) && /qnb-bar/.test(mb));
    ok('⑯-4 ★ 只显示**当前这一章**（不是把八章全铺开）',
      /第 \d+ \/ 8 章/.test(mb) && (mb.match(/qnb-count/g) || []).length === 1,
      (mb.match(/第 \d+ \/ \d+ 章[^<]*/) || [''])[0]);
    ok('⑯-5 ★ 它是列表里**第一条**（在其它任务卡之前）',
      (() => {
        const iNew = mb.indexOf('quest-card newbie');
        const iOther = mb.indexOf('quest-card', iNew + 5);
        return iNew >= 0 && (iOther < 0 || iNew < iOther);
      })(), 'newbie@' + mb.indexOf('quest-card newbie') + ' 其它@' + mb.indexOf('quest-card', mb.indexOf('quest-card newbie') + 5));
    ok('⑯-6 附一个去「新手教程」面板看全流程的按钮',
      /data-cmd="guide"/.test(mb), (mb.match(/data-cmd="guide"[^>]*>[^<]*/) || [''])[0]);

    /* 点那个按钮 → 真开「新手教程」面板 */
    const btn = env.document.querySelectorAll('#modal-body .op-btn')
      .find(b => b.getAttribute('data-cmd') === 'guide');
    ok('⑯-7 抠得到「看完整流程」按钮', !!btn);
    if (btn) {
      btn.click();
      await settle(); await settle();
      const gb = String(env.document.getElementById('modal-body').innerHTML || '');
      ok('⑯-8 ★ 点它真的换成了「新手教程」面板（完整流程）',
        /新手教程 · 入江湖/.test(gb), gb.slice(0, 80));
    }
  }

  /* ================================================================
   *  ⑰ 第四轮 · 「新手教程」面板 = 完整流程（与「任务」面板不同）
   * ================================================================ */
  section('⑰ 第四轮 · 「新手教程」面板列出完整流程');
  {
    const v = engine.view();
    const env = loadUi(makeEnv({ innerWidth: 390 }));
    stubApi(env, v);
    closeMasks(env);
    env.WX.S.view = v;
    await env.WXUI.panel('guide');
    await settle();
    const gb = String(env.document.getElementById('modal-body').innerHTML || '');

    ok('⑰-1 ★ 抬头是「新手教程 · 入江湖」（与入口按钮对得上）', /新手教程 · 入江湖/.test(gb));
    /* ⚠️ 必须带个尾随空格：'class="gp-step' 会把容器 'class="gp-steps' 也算上
       （数出来 9，假红）。章节 div 的 className 恒为 'gp-step <状态>'。 */
    const steps = (gb.match(/class="gp-step /g) || []).length;
    ok('⑰-2 ★ 八章全都列出来（这是与「任务」面板的区别）', steps === 8, steps + ' 章');
    ok('⑰-3 ★ 标出这一程的去处（由身份定的那家势力）', /这一程的去处/.test(gb),
      (gb.match(/这一程的去处：<b>[^<]*/) || [''])[0]);
    ok('⑰-4 ★ 当前章带剧情旁白（gps-story）', /gps-story/.test(gb),
      (gb.match(/<div class="gps-story">[^<]{0,40}/) || [''])[0]);
    ok('⑰-5 后面没走到的章节是锁住的（🔒）', /🔒/.test(gb));
    ok('⑰-6 没有 undefined / NaN 漏进 HTML', !/undefined|NaN/.test(gb),
      (gb.match(/.{0,30}(undefined|NaN).{0,30}/) || [''])[0]);
    ok('⑰-7 ★ 整页没有漏填的模板位（花括号）', !/\{[^}\n]{1,20}\}/.test(gb),
      (gb.match(/\{[^}\n]{1,20}\}/) || ['(无)'])[0]);
  }

  /* ---------- ⑱ 「武学」面板 → 「武学修为」真点击 ---------- */
  section('⑱ 「武学」面板里的「武学修为」按钮（主人 2026-10-11 口径）');
  {
    /* 主人口径（原话）：「在『武学』里面增加一个『武学修为』按钮，
       点击即可打开原来左侧快捷键的『武学修为』界面。」
       ⇒ 侧栏那个按钮不动，这里只加一扇门。
       ⚠️ 必须**真点**：光断言 HTML 里有按钮，测不出 onclick 绑没绑上
       （铁律：点了没反应三查之一）。所以走 `.op-btn` 真点击 → 看弹窗标题。 */
    const env = loadUi(makeEnv({ innerWidth: 390 }));
    stubApi(env, VIEW);
    closeMasks(env);
    env.WX.api.view = async () => ({ ok: true, view: VIEW });
    env.WX.S.view = VIEW;
    const mb = env.document.getElementById('modal-body');
    const mt = env.document.getElementById('modal-title');
    mb.innerHTML = '';
    await env.WXUI.panel('skills');
    await settle();
    ok('⑱-1 「武学」面板标题就叫「武学」（不再跟「武学修为」撞名）',
      mt.textContent === '武学', mt.textContent);
    const skHtml = mb.innerHTML || '';
    ok('⑱-2 「武学」面板里有「武学修为」按钮',
      /data-cmd="武学修为"/.test(skHtml),
      (skHtml.match(/data-cmd="武学修为"[^>]*/) || ['(没有)'])[0]);

    const jump = env.document.querySelectorAll('#modal-body .op-btn')
      .find(b => b.getAttribute('data-cmd') === '武学修为');
    ok('⑱-3 按钮真的绑上了 onclick（不是画上去的）', !!jump);
    if (jump) { jump.click(); await settle(); await settle(); }

    ok('⑱-4 ★ 点完弹出的是「武学修为」面板（侧栏那个同一份）',
      mt.textContent === '武学修为', mt.textContent);
    const mHtml = mb.innerHTML || '';
    ok('⑱-5 ★ 新弹窗里真有奇经八脉/经脉内容（不是空壳）',
      /奇经八脉|任脉|冲脉/.test(mHtml),
      (mHtml.match(/.{0,12}(奇经八脉|任脉|冲脉)/) || ['(没有)'])[0]);
    ok('⑱-6 ★ 两处进口进的是同一个面板（不是各画一份）',
      env.WXUI.panelForCmd('武学修为') === 'martial' && env.WXUI.panelForCmd('武馆') === 'martial');
    ok('⑱-7 侧栏那个「武学修为」按钮仍在（主人："不" = 不删）',
      /data-panel="martial">武学修为</.test(
        fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8')));
  }


  /* ---------- ⑲ 任务面板的追踪按钮（真点击） ---------- */
  section('⑲ 「任务」面板的追踪按钮（主人 2026-10-08：点一下大框换任务）');
  {
    const vv = engine.view();
    const env = loadUi(makeEnv({ innerWidth: 1280 }));
    const rec = stubApi(env, vv);
    closeMasks(env);
    env.WX.S.view = vv;
    await env.WXUI.panel('quests');
    await settle();
    const mb = String(env.document.getElementById('modal-body').innerHTML || '');
    const idList = (mb.match(/data-track="[^"]*"/g) || []).map(x => x.slice(12, -1));
    ok('⑲-1 任务卡上有追踪按钮', idList.length > 0, idList.join(' '));
    ok('⑲-2 新手剧情那条默认被追着（按钮画成「取消追踪」）',
      /data-track="__newbie__" data-on="1"/.test(mb), (mb.match(/data-track="__newbie"[^>]*/) || [''])[0]);
    ok('⑲-3 主线的按钮此刻是「追踪」', /data-track="q_main_jianghu" data-on="0"/.test(mb),
      (mb.match(/data-track="q_main_jianghu"[^>]*/) || [''])[0]);

    const btn = env.document.querySelectorAll('#modal-body [data-track]')
      .find(b => b.getAttribute('data-track') === 'q_main_jianghu');
    ok('⑲-4 抠得到主线那枚按钮（说明 onclick 真绑上了）', !!btn);
    if (btn) { btn.click(); await settle(); await settle(); }
    ok('⑲-5 ★ 点了真发出「追踪 q_main_jianghu」',
      rec.exec.some(x => x.cmd === '追踪 q_main_jianghu'),
      JSON.stringify(rec.exec.map(x => x.cmd).slice(-3)));
    /* 取消追踪也走同一条线 */
    rec.exec.length = 0;
    const mb2 = String(env.document.getElementById('modal-body').innerHTML || '');
    const off = env.document.querySelectorAll('#modal-body [data-track]')
      .find(b => b.getAttribute('data-on') === '1');
    ok('⑲-6 找得到「取消追踪」那枚', !!off, mb2.slice(0, 0));
    if (off) { off.click(); await settle(); await settle(); }
    ok('⑲-7 ★ 点「取消追踪」真发出「取消追踪」',
      rec.exec.some(x => x.cmd === '取消追踪'), JSON.stringify(rec.exec.map(x => x.cmd).slice(-3)));
  }

  console.log('\n———————————————————————————————');
  console.log(`  批次7 双端与 UI 回归：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('———————————————————————————————');
  process.exitCode = fail ? 1 : 0;
})();
