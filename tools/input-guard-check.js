/**
 * input-guard-check.js —— 手机端「输入法乱弹」回归检测。
 *
 * 病根：doCmd() 收尾无条件 `cmd-input.focus()`，
 *      而点屏幕上的任何按钮（出口「北」、NPC 菜单「查看/交谈」…）都会走 doCmd，
 *      于是移动端每次都把焦点抢回输入框、拉起软键盘，正好遮住刚刷新的内容。
 *
 * 修法：doCmd(cmd, {fromButton:true}) 标记「这指令是点按钮来的」，
 *      按钮来的先 blur 且收尾**不** focus；输入框敲回车来的照旧 focus。
 *
 * 这个脚本做两件事：
 *   1. 真的点按钮（渲染出来的出口按钮 / NPC 菜单里的「查看」）→ 断言 focus 一次都没被调；
 *   2. 真的敲回车（走输入框 submit）→ 断言 focus 仍然被调（别把老行为改坏）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 最小 DOM ---------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
    },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {}, setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; }, removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, dispatchEvent() { return true; },
    fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || { target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() { this._focus = (this._focus || 0) + 1; },
    blur() { this._blur = (this._blur || 0) + 1; },
    click() { if (typeof this.onclick === 'function') return this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); this.fire('click'); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function makeEnv(opts) {
  const o = opts || {};
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    /* 模拟手机：maxTouchPoints>0 → isTouchDevice() 为真 */
    navigator: { userAgent: o.touch ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile' : 'node-check', language: 'zh-CN', maxTouchPoints: o.touch ? 5 : 0 },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: 390, innerHeight: 844,
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
function loadUi(opts) {
  const env = makeEnv(opts);
  vm.createContext(env);
  /* ui.js 依赖 global.WX（app.js 提供），必须先加载 app.js */
  for (const f of ['app.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  env.__els = env.document; // 便于取真 DOM
  return env;
}

/* ============================================================ */
console.log('==============================================');
console.log('  手机端输入法防弹 · 行为检测');
console.log('==============================================');

function buildView() {
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  e.newGame({ name: '试键', gender: 'male', birth: 'wuxue' });
  return e.view();
}

/* 记录 focus 被调了几次 */
function watchFocus(env) {
  const inp = env.document.getElementById('cmd-input');
  inp._focus = 0; inp._blur = 0;
  return inp;
}

/* ---------- ① 出口按钮：点了不许抢焦点 ---------- */
section('① 出口按钮（点「北」）');
(async () => {
  const env = loadUi({ touch: true });
  const view = buildView();
  const inp = watchFocus(env);
  let execed = [];
  env.WX.api.exec = async cmd => { execed.push(cmd); return { ok: true, log: [{ type: 'plain', text: '你向北走去。' }] }; };

  env.WXUI.renderRoom(view);
  const exits = env.document.getElementById('exits');
  ok('渲染出了出口按钮', exits.children.length > 0, 'children=' + exits.children.length);

  const b = exits.children[0];
  const dir = b.getAttribute('data-dir');
  await b.onclick();
  await sleep(20);
  ok('点出口真的发出了移动指令', execed.length === 1 && execed[0] === dir, JSON.stringify(execed));
  ok('★ 点出口后输入框 focus 一次都没被调（键盘不会再弹）', inp._focus === 0, 'focus=' + inp._focus);
  ok('点出口时主动 blur 了输入框', inp._blur >= 1, 'blur=' + inp._blur);

  /* 触屏机型额外那刀：readonly */
  const b2 = exits.children[0];
  await b2.onclick();
  await sleep(200);
  ok('readonly 用完已放开（不会把输入框卡死）', !inp.hasAttribute('readonly'));

  /* ---------- ② 输入框敲回车：老行为不能坏 ---------- */
  section('② 输入框敲回车（老行为必须保留）');
  execed = [];
  env.WXUI.doCmd('look');
  await sleep(20);
  ok('输入框来源的指令执行了', execed.length === 1 && execed[0] === 'look', JSON.stringify(execed));
  ok('★ 输入框来源执行完仍把焦点还回去', inp._focus === 1, 'focus=' + inp._focus);

  /* 走真输入框 submit 路径（Enter） */
  watchFocus(env);
  execed = [];
  const inp2 = env.document.getElementById('cmd-input');
  inp2.value = 'look';
  env.WXUI.bindInput();
  inp2.onkeydown({ key: 'Enter', preventDefault() {} });
  await sleep(20);
  ok('敲回车发出了指令', execed.length === 1 && execed[0] === 'look', JSON.stringify(execed));
  ok('★ 敲回车后焦点还回输入框', inp2._focus === 1, 'focus=' + inp2._focus);

  /* ---------- ③ NPC 菜单：点「查看」「交谈」不许弹键盘 ---------- */
  section('③ NPC 名字弹出的菜单（查看 / 交谈）');
  const view3 = buildView();
  /* 保证房里有人 */
  const env3 = loadUi({ touch: true });
  const inp3 = watchFocus(env3);
  let execed3 = [];
  env3.WX.api.exec = async cmd => { execed3.push(cmd); return { ok: true, log: [{ type: 'plain', text: '你打量一番。' }] }; };
  env3.WXUI.renderScene(view3);
  const npcBox = env3.document.getElementById('scene-npcs');
  ok('场景栏渲染出了 NPC', npcBox.children.length > 0, 'children=' + npcBox.children.length);
  if (npcBox.children.length) {
    npcBox.children[0].onclick();           // 弹出中文菜单
    const listBox = env3.document.getElementById('choices-list');
    const btns = listBox.children.filter(c => /查看 \(look\)|交谈 \(talk\)/.test(c.innerHTML || ''));
    ok('菜单里有「查看/交谈」项', btns.length >= 1, 'n=' + btns.length);
    for (const btn of btns) {
      await btn.onclick();
      await sleep(20);
    }
    ok('★ 点 NPC 菜单后输入框 focus 一次都没被调', inp3._focus === 0, 'focus=' + inp3._focus);
    ok('★ 确实发出了 look/talk 指令', execed3.length >= 1 && execed3.every(c => /^(look|talk) /.test(c)), JSON.stringify(execed3));
  }

  /* ---------- ④ 快捷按钮 / 地面物品 ---------- */
  section('④ 快捷按钮与地面物品');
  const env4 = loadUi({ touch: true });
  const inp4 = watchFocus(env4);
  let execed4 = [];
  env4.WX.api.exec = async cmd => { execed4.push(cmd); return { ok: true, log: [{ type: 'plain', text: '好。' }] }; };
  /* 物品按钮：renderScene 的 items 分支 */
  const view4 = buildView();
  view4.groundItems = [{ uid: 'gi1', itemId: 'herb', name: '青灵草', count: 2 }];
  view4.inventory = [{ id: 'herb', name: '青灵草', count: 2, qualityName: '寻常' }];
  env4.WXUI.renderScene(view4);
  const itemBox = env4.document.getElementById('scene-items');
  ok('地面物品渲染成按钮', itemBox.children.length === 1, 'children=' + itemBox.children.length);
  if (itemBox.children.length) {
    await itemBox.children[0].onclick();
    await sleep(20);
    ok('点物品发出了 get 指令', execed4.length === 1 && /^get /.test(execed4[0]), JSON.stringify(execed4));
    ok('★ 点物品不抢焦点', inp4._focus === 0, 'focus=' + inp4._focus);
  }

  /* 快捷按钮栏 */
  const env5 = loadUi({ touch: true });
  const inp5 = watchFocus(env5);
  let execed5 = [];
  env5.WX.api.exec = async cmd => { execed5.push(cmd); return { ok: true, log: [{ type: 'plain', text: '好。' }] }; };
  env5.localStorage.setItem('wx_quickbar', JSON.stringify([{ label: '背包', cmd: 'bag' }]));
  env5.WX.S.view = view4;
  env5.WXUI.renderQuickbar(view4);
  const qb = env5.document.getElementById('quickbar');
  /* 注意：快捷按钮是用 innerHTML 字符串拼的，最小 DOM stub 不解析 HTML，
     所以这里只能断言「按钮确实渲染进 HTML 了」；
     onclick 是否带 fromButton 由下面第 ⑥ 项静态扫描兜住。 */
  ok('快捷按钮渲染出来了', /data-cmd="bag"/.test(qb.innerHTML || ''), qb.innerHTML);

  /* ---------- ⑥ 静态兜底：不允许再有裸 doCmd 在 onclick 里 ---------- */
  section('⑥ 静态扫描：onclick 里的 doCmd 必须带 fromButton');
  const src = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8').split('\n');
  const bad = [];
  src.forEach((line, i) => {
    if (!/onclick\s*=/.test(line)) return;
    if (!/doCmd\(/.test(line)) return;
    if (/fromButton/.test(line)) return;
    bad.push((i + 1) + ': ' + line.trim());
  });
  ok('onclick 里的 doCmd 全部标了 fromButton', bad.length === 0, bad.join(' | '));

  const old = src.filter(l => /^\s*(const|let|var)?\s*.*inp\.focus\(\)/.test(l) && !/cmd-input/.test(l)).map(l => l.trim());
  ok('没有残留的「无条件 focus 输入框」', !src.some(l => /^\s*if \(inp\) inp\.focus\(\);?\s*$/.test(l)), '');

  console.log('\n==============================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fails.length) console.log('  失败：' + fails.join(' / '));
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('崩溃：', e); process.exit(1); });