/**
 * smoke-quit.js —— 「退出游戏」专项回归（主人 2026-10-10 要求）
 *
 *  加的是两件事，都要能验：
 *    ① 后端指令 quit / 退出游戏 / exit / 离开游戏 / 回主菜单 —— 要有、要能列进 help；
 *    ② 前端本地拦截 —— 弹确认框 → **先存档** → 回主菜单 → 刷出「继续游戏」按钮。
 *
 * 为什么前端也要有一份：后端最多回你一句文本，**关不掉这一局**（切屏是界面的事）。
 * 为什么必须行为测试：本项目栽过「静态 grep 当断言」的坑（B2 第一版就假绿过一轮），
 *   所以这里**真载 ui.js、真调 doCmd、真点确认按钮**，再读真实 DOM 状态。
 *
 * ⚠️ DOM stub 三坑（照 smoke-mapui.js）：querySelectorAll 按 (选择器, innerHTML) 缓存 /
 *   innerHTML setter 清 children / async 要 await。
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
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
function settle() { return new Promise(r => setImmediate(r)); }

/* ================= DOM stub ================= */
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
    fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || { target: this })); },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const key = sel + ' ' + this._html;
      this.__qsel = this.__qsel || {};
      if (!this.__qsel[key]) this.__qsel[key] = parseSelectors(this._html, sel);
      return this.__qsel[key];
    },
    closest() { return null; },
    focus() { this._focus = (this._focus || 0) + 1; }, blur() { this._blur = (this._blur || 0) + 1; },
    click() { this._clicked = true; if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
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
    const g = { tag: m2[1].toLowerCase(), attrs };
    if (t && g.tag !== t) continue;
    if (cls && String(g.attrs.class || '').split(/\s+/).indexOf(cls) < 0) continue;
    if (attr && !(attr in g.attrs)) continue;
    out.push(g);
  }
  return out.map(g => {
    const el = makeEl(g.tag);
    el.className = g.attrs.class || ''; el.id = g.attrs.id || '';
    for (const k in g.attrs) el.setAttribute(k, g.attrs[k]);
    el.click = () => { el._clicked = true; if (typeof el.onclick === 'function') el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); };
    return el;
  });
}
function makeEnv(innerWidth) {
  const store = {}, els = {}, winL = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector(sel) { const m = String(sel).match(/^#([A-Za-z0-9_-]+)/); return m && els[m[1]] ? els[m[1]] : null; },
    querySelectorAll(sel) { const m = String(sel).match(/#([A-Za-z0-9_-]+)/); if (!m || !els[m[1]]) return []; return els[m[1]].querySelectorAll(sel); },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', maxTouchPoints: (innerWidth || 1280) < 640 ? 5 : 0, language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: innerWidth || 1280, innerHeight: 800,
    screen: { width: innerWidth || 1280, height: 800 },
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
  for (const f of ['app.js', 'ui.js']) {  /* 顺序不能反 */
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}

/* 把真 index.html 的侧栏塞进 stub —— 这样「返回主菜单」按钮走真 HTML、真绑定 */
function injectSidebar(env) {
  const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
  const m = html.match(/<aside id="sidebar">([\s\S]*?)<\/aside>/);
  if (m) env.document.getElementById('sidebar').innerHTML = m[1];
  return !!m;
}

/* ================================================================
 * A. 后端指令
 * ================================================================ */
section('A. 后端 quit 指令');
{
  const { buildCommands } = require(path.join(ROOT, 'game', 'src', 'core', 'commands.js'));
  const eng = new GameEngine({ seed: 20261010 });
  eng.boot(); eng.newGame();
  const w = eng.world, p = w.player;
  const cmds = buildCommands(w);
  const exec = (s) => cmds.execute(s, { player: p, world: w });

  const aliases = ['quit', 'exit', '退出游戏', '退出', '离开游戏', '回主菜单'];
  let hit = 0;
  for (const a of aliases) {
    if (cmds.CMD && cmds.CMD[a]) hit++;
  }
  ok('A1 六个别名都注册在指令表里', hit === aliases.length, hit + '/' + aliases.length);

  const r = exec('quit');
  ok('A2 exec("quit") 返回 action=quit', r && r.action === 'quit', JSON.stringify(r && r.action));
  ok('A3 exec("quit") 有给玩家看的文本', !!(r && r.lines && r.lines.length && r.lines[0].text), JSON.stringify((r && r.lines || [])[0]));
  const r2 = exec('退出游戏');
  ok('A4 中文「退出游戏」同效', r2 && r2.action === 'quit', JSON.stringify(r2 && r2.action));

  /* help 必须列得出来，否则玩家根本不知道有这条指令 */
  const h = exec('help');
  const txt = (h.lines || []).map(l => l.text || '').join('\n');
  ok('A5 help 的「系统」组列出了 quit/退出游戏', /quit/.test(txt) && /退出游戏/.test(txt));
}

/* ================================================================
 * B. 前端拦截判定
 * ================================================================ */
section('B. 前端 isQuitCmd 判定');
{
  const env = loadUi(makeEnv(1280));
  const U = env.WXUI;
  ok('B0 WXUI 暴露了 quitGame / isQuitCmd', typeof U.quitGame === 'function' && typeof U.isQuitCmd === 'function');

  const yes = ['quit', 'exit', '退出游戏', '退出', '离开游戏', '回主菜单', ' QUIT ', '退出游戏 '];
  const bad = yes.filter(c => !U.isQuitCmd(c));
  ok('B1 退出类指令全部命中', bad.length === 0, bad.join(','));

  /* ⚠️ 这条是防「拦得太宽」——把正常指令吃掉比没有退出键严重得多 */
  const no = ['look', 'map', 'save', 'kill', '退出登录', 'i', 'help', 'go north', 'backmenu'];
  const wrong = no.filter(c => U.isQuitCmd(c));
  ok('B2 正常指令不被误拦', wrong.length === 0, wrong.join(','));
}

/* ================================================================
 * C. 真行为：doCmd('退出游戏')
 * ================================================================ */
section('C. doCmd 真行为（确认框 / 存档 / 切屏）');
{
  const env = loadUi(makeEnv(1280));
  injectSidebar(env);
  const eng = new GameEngine({ seed: 20261010 });
  eng.boot(); eng.newGame();
  const view = eng.view();

  const calls = { exec: [], save: 0, saves: 0 };
  env.WX.api.exec = async (cmd) => { calls.exec.push(cmd); return { ok: true, lines: [] }; };
  env.WX.api.view = async () => ({ ok: true, view });
  env.WX.api.save = async () => { calls.save++; env.__saveShouldFail || 0; return { ok: true, data: { x: 1 } }; };
  env.WX.api.saves = async () => { calls.saves++; return { ok: true, saves: [{ id: 'slot_a' }] }; };
  env.WX.S.view = view; env.WX.S.busy = false;
  env.WXUI.show('game');

  (async () => {
    /* --- C1: 本地拦截，不打扰后端 ---
       ⚠️ doCmd 会 await 确认框 → 所以**不能先 await 它再点按钮**（会死等）。
       正确姿势：先把 promise 拿住，弹框出来后断言/点击，最后再 await 收尾。 */
    const pr1 = env.WXUI.doCmd('退出游戏');
    await settle(); await settle();
    ok('C1 退出指令不发给后端（本地拦截）', calls.exec.length === 0, JSON.stringify(calls.exec));

    const title = env.document.getElementById('modal-title');
    ok('C2 弹出确认框，标题是「退出游戏」', String(title.textContent).indexOf('退出') >= 0, JSON.stringify(title.textContent));
    const mask = env.document.getElementById('modal-mask');
    ok('C3 确认框真的显示出来（mask 去掉 hidden）', mask.classList.contains('hidden') === false);

    /* --- C4: 点「取消」→ 不存档、不切屏 --- */
    env.document.getElementById('cf-no').click();
    await pr1;
    await settle(); await settle();
    ok('C4a 点取消不存档', calls.save === 0, 'save=' + calls.save);
    ok('C4b 点取消不切屏（还在游戏里）', env.document.getElementById('screen-game').classList.contains('active'),
      'game.active=' + env.document.getElementById('screen-game').classList.contains('active'));

    /* --- C5: 点「退出」→ 先存档、再回主菜单 --- */
    const pr2 = env.WXUI.doCmd('quit');
    await settle(); await settle();
    env.document.getElementById('cf-yes').click();
    await pr2;
    await settle(); await settle(); await settle();
    ok('C5a 点退出时真的存了档', calls.save === 1, 'save=' + calls.save);
    ok('C5b 切回主菜单（#screen-start 激活）', env.document.getElementById('screen-start').classList.contains('active'),
      'start.active=' + env.document.getElementById('screen-start').classList.contains('active'));
    ok('C5c 游戏屏已收起', !env.document.getElementById('screen-game').classList.contains('active'));
    ok('C5d 退出后刷了「继续游戏」按钮（有档→显示）',
      env.document.getElementById('btn-continue').style.display === '', JSON.stringify(env.document.getElementById('btn-continue').style.display));

    /* --- C6: 存档失败也必须能退出（不能把人锁在游戏里）--- */
    const env2 = loadUi(makeEnv(1280));
    injectSidebar(env2);
    const view2 = (() => { const e2 = new GameEngine({ seed: 20261010 }); e2.boot(); e2.newGame(); return e2.view(); })();
    env2.WX.api.exec = async () => ({ ok: true, lines: [] });
    env2.WX.api.view = async () => ({ ok: true, view: view2 });
    env2.WX.api.save = async () => { throw new Error('磁盘满了'); };
    env2.WX.api.saves = async () => ({ ok: true, saves: [] });
    env2.WX.S.view = view2; env2.WX.S.busy = false;
    env2.WXUI.show('game');
    const pr6 = env2.WXUI.quitGame();
    await settle(); await settle();
    env2.document.getElementById('cf-yes').click();
    await pr6;
    await settle(); await settle(); await settle();
    ok('C6 存档失败时仍能退出到主菜单', env2.document.getElementById('screen-start').classList.contains('active'));
    ok('C6b 存档失败时不给「已保存」的假安心（提示走 warn）',
      env2.document.getElementById('toast').className.indexOf('warn') >= 0,
      env2.document.getElementById('toast').className);

    /* --- C7: 侧栏「返回主菜单」按钮与 quit 同一条路 --- */
    const env3 = loadUi(makeEnv(1280));
    injectSidebar(env3);
    const view3 = view;
    const calls3 = { save: 0 };
    env3.WX.api.exec = async () => ({ ok: true, lines: [] });
    env3.WX.api.view = async () => ({ ok: true, view: view3 });
    env3.WX.api.save = async () => { calls3.save++; return { ok: true, data: {} }; };
    env3.WX.api.saves = async () => ({ ok: true, saves: [{ id: 'a' }] });
    env3.WX.S.view = view3; env3.WX.S.busy = false;
    env3.WXUI.show('game');
    env3.WXUI.bindSidebar();
    const btns = env3.document.getElementById('sidebar').querySelectorAll('#sidebar .sb-btn');
    ok('C7a index.html 侧栏被解析出按钮', btns.length > 0, btns.length + ' 个');
    const back = btns.filter(b => b.getAttribute('data-act') === 'backmenu')[0];
    ok('C7b 侧栏里有「返回主菜单」按钮', !!back);
    if (back) {
      back.click();
      await settle(); await settle();
      const t3 = String(env3.document.getElementById('modal-title').textContent);
      ok('C7c 点它也弹确认框（走同一套 quit 逻辑）', t3.indexOf('退出') >= 0, JSON.stringify(t3));
      env3.document.getElementById('cf-yes').click();
      await settle(); await settle(); await settle();
      ok('C7d 点它也先存档再回主菜单', calls3.save === 1 && env3.document.getElementById('screen-start').classList.contains('active'),
        'save=' + calls3.save);
    }

    /* ---------- 报告 ---------- */
    console.log('\n' + (fail === 0 ? '✅ 全部通过' : '❌ 有失败项') + '：' + pass + ' 通过 / ' + fail + ' 失败');
    if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
    process.exit(fail ? 1 : 0);
  })().catch(e => {
    console.log('\n💥 测试自身抛错（不是被测代码的问题，先看这个）：');
    console.log(e && e.stack || e);
    process.exit(1);
  });
}
