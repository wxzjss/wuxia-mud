/**
 * martial-ui-check.js —— 「武学修为 / 宗门 / 我的家宅（地块）」三个面板的
 * 真渲染检测。
 *
 * 做法（踩过坑才定下来的）：
 *   · 真跑 ui.js（vm + 最小 DOM stub），不静态抠函数；
 *   · 喂参必须是**真实调用路径的入参** —— 面板() 传进去的是整个 view，
 *     不是 view.martial 之类；曾因此喂了 view.quests 却测 questsHtml 而假绿。
 *   · 断言从 WXUI.panel 里抓到的 modal HTML 反查关键内容。
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

/* ---------- 最小 DOM（抄 game-ui-check.js 那套） ---------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.contains ? this._s.contains(c) : this._s.has(c); },
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
    focus() {}, blur() {}, click() { this.fire('click'); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1:8800', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
function loadUi() {
  const env = makeEnv();
  vm.createContext(env);
  /* ui.js 依赖 global.WX（app.js 提供），必须先加载 app.js */
  for (const f of ['app.js', 'ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}

/* panel(name) 是 async，且数据来自 api.view(name)（真实调用路径是**拉数据**，
   不是拿我手塞的参数）。所以：mock api.view 返回真view + 必须 await，
   然后从真 DOM（modal-body.innerHTML）里读结果。
   两个坑都踩过：不 await → 读到空串；喂参数当入参 → 测的根本不是真实路径。 */
function mockView(env, view) {
  env.WX.api.view = async () => ({ ok: true, view });
  env.WX.S.view = view;
}
async function grabPanel(env, view, name) {
  mockView(env, view);
  const doc = env.document;
  const body = doc.getElementById('modal-body');
  const titleEl = doc.getElementById('modal-title');
  body.innerHTML = '';
  await env.WXUI.panel(name);
  return { title: titleEl.textContent || '', html: body.innerHTML || '' };
}

/* ============================================================ */
console.log('==============================================');
console.log('  武学修为 / 宗门 / 家园地块 面板真渲染检测');
console.log('==============================================');

/* 造一个「有武学、有弟子、有宗门、有地块」的真实世界 */
function buildWorld() {
  const e = new GameEngine({ seed: 20261009 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  /* 造点武学进项 */
  const sk = Object.keys(w.data.skills || {});
  for (const id of ['basic_fist', 'basic_sword', 'basic_neigong']) {
    if (w.getSkill(id)) p.learnSkill(id);
  }
  /* 奇经打通两条（验证面板渲染非零值） */
  p.meridians = Object.assign(p.meridians || {}, { 任: 3, 督: 2 });
  p.baseAttr['资质'] = 42; p.recalc();
  /* 造弟子 */
  const npc = Object.values(w.instances.npcs)[0];
  if (npc) {
    npc.favor = 80; npc.pstate = npc.pstate || { trust: 0, revealed: [], hooks: {}, met: true, moodBias: 0, leaked: false };
    npc.pstate.trust = 55;
    p.disciples = [npc.id];
  }
  /* 造自建宗门 */
  p.mySect = { name: '凌霄阁', style: '正派', prestige: 120, members: [npc ? npc.id : 'x'], hall: 'jn_yamen_office', treasury: 0 };
  /* 造主院 + 地块 */
  p.money = 200000;
  const home = require(path.join(ROOT, 'game', 'src', 'core', 'home.js'));
  p.room = home.YAMEN_ROOM;
  e.exec('买宅 courtyard');
  p.room = p.home;
  for (const k of ['crop_rice', 'iron_ore', 'crop_wheat', 'silk_thread']) w.giveItem(p, k, 40);
  e.exec('开垦 练武场');
  e.exec('开垦 书房');
  /* 赞助一个**无家**的 NPC（已有住处的会被拒） */
  let sponsored = false;
  for (const n of Object.values(w.instances.npcs || {})) {
    const d0 = w.data.npcs[n.defId] || {};
    if (n.home || d0.home) continue;
    p.room = n.room; n.favor = 70;
    e.exec('资助 ' + n.name);
    sponsored = !!w.player.estate.sponsored[n.defId];
    break;
  }
  p.room = p.home;
  p.recalc();
  if (!sponsored) console.log('    （提示：本局没找到无家NPC，赞助相关断言会失败）');
  return e;
}

(async function main() {

const env = loadUi();
const e = buildWorld();
const view = e.view();

section('① view 数据齐备（面板的数据源）');
{
  ok('view.martial 存在', !!view.martial);
  ok('奇经八脉 8 条', (view.martial.meridians || []).length === 8, 'n=' + ((view.martial.meridians || []).length));
  ok('奇经带非零进度', (view.martial.meridians || []).some(x => x.lv > 0));
  ok('资质已透出', view.martial.aptitude >= 0);
  ok('修炼诸途 6 条', (view.martial.ways || []).length === 6);
  ok('配方分类已透出', !!view.martial.recipes && Object.keys(view.martial.recipes).length > 0, JSON.stringify(view.martial.recipes));
  ok('弟子已透出', (view.martial.disciples || []).length === 1, 'n=' + ((view.martial.disciples || []).length));
  ok('弟子带信任/好感', !!(view.martial.disciples || [])[0] && view.martial.disciples[0].trust > 0);
  ok('自建宗门已透出', !!view.martial.mySect && view.martial.mySect.name === '凌霄阁');
  ok('skills 带功法门类', view.player.skills.every(s => !!s.category));
  ok('skills 带熟练度分级', view.player.skills.every(s => typeof s.profTier === 'number'));
  /* ⚠️ 别写死数量 —— 地块会随需求增删（10-09 加了「地牢」）。
     该断言的是「地块表非空且每项字段齐全」，数量交给 smoke-estate。 */
  const _plots = view.home.plots || [];
  ok('home.plots 地块表非空且字段齐全', _plots.length >= 7 &&
    _plots.every(pl => pl && pl.key && pl.name && typeof pl.level === 'number'),
    'n=' + _plots.length);
  ok('home.plots 含地牢', _plots.some(pl => pl.key === 'dungeon'), 'keys=' + _plots.map(p => p.key).join(','));
  ok('home 有地块效果汇总', !!view.home.estateEffects);
  ok('home 有赞助 NPC 记录', Array.isArray(view.home.sponsored) && view.home.sponsored.length >= 1, JSON.stringify(view.home.sponsored));
}

section('② 「武学修为」面板真渲染');
{
  const r = await grabPanel(env, view, 'martial');
  ok('面板有返回 HTML', !!r && typeof r.html === 'string' && r.html.length > 0);
  const H = r ? r.html : '';
  ok('标题是「武学修为」', !!r && /武学修为/.test(r.title), r && r.title);
  ok('渲染出资质数值', />\s*42\s*</.test(H) || /42/.test(H));
  ok('渲染出任脉进度', /任脉/.test(H));
  ok('渲染出修炼诸途', /打坐/.test(H) && /淬体/.test(H) && /炼丹/.test(H) && /画符阵/.test(H));
  ok('渲染出功法门类', /外功|内功|魔功|奇门|旁门/.test(H));
  ok('渲染出熟练度分级链', /入门/.test(H) && /登峰造极/.test(H));
  ok('渲染出弟子名', /弟子/.test(H) && !/尚未收徒/.test(H));
  ok('渲染出宗门名', /凌霄阁/.test(H));
  ok('没有 undefined/NaN 渗进 HTML', !/undefined|NaN|\[object Object\]/.test(H), (H.match(/undefined|NaN|\[object Object\]/g) || []).slice(0, 3).join(','));
}

section('③ 「宗门·师承」面板（自建宗门入口，不覆盖门派面板）');
{
  const r = await grabPanel(env, view, 'found');
  ok('面板有返回 HTML', !!r && r.html.length > 0);
  ok('宗门面板带出凌霄阁', !!r && /凌霄阁/.test(r.html));
}

section('④ 「我的家宅」面板真渲染（含地块）');
{
  const r = await grabPanel(env, view, 'home');
  const H = r ? r.html : '';
  ok('面板有返回 HTML', !!r && H.length > 0);
  ok('渲染出主院', /名下产业|现居/.test(H));
  ok('渲染出已建地块（练武场/书房）', /练武场/.test(H) && /书房/.test(H));
  ok('渲染出未解锁地块（客卿院）', /客卿院/.test(H));
  ok('渲染出家园增益汇总', /家园增益|修炼快|悟性/.test(H), H.slice(0, 0));
  ok('渲染出受资助的人', /受你资助的人/.test(H));
  ok('地块指令写进提示', /开垦/.test(H) && /资助/.test(H));
  ok('没有 undefined/NaN 渗进 HTML', !/undefined|NaN|\[object Object\]/.test(H), (H.match(/undefined|NaN|\[object Object\]/g) || []).slice(0, 3).join(','));
}

section('⑤ 空数据也不能崩（新号无弟子/无宗门/无宅）');
{
  const e2 = new GameEngine({ seed: 7 });
  e2.boot();
  e2.newGame({ name: '新号', gender: 'female', birth: 'wuxue' });
  const v2 = e2.view();
  const a = await grabPanel(env, v2, 'martial');
  ok('新号武学面板不崩', !!a && a.html.length > 0);
  ok('新号提示「尚未收徒」', !!a && /尚未收徒/.test(a.html));
  ok('新号提示自立门户', !!a && /自立门户|尚未自立/.test(a.html));
  const b = await grabPanel(env, v2, 'home');
  ok('新号家宅面板不崩', !!b && b.html.length > 0);
  ok('新号提示尚无片瓦', !!b && /尚无片瓦/.test(b.html));
  const c = await grabPanel(env, v2, 'skills');
  ok('新号武学列表不崩', !!c && c.html.length > 0);
}

section('⑥ 面板指令映射接上了');
{
  ok('「修炼」→ martial 面板', env.WXUI.panelForCmd('修炼') === 'martial');
  ok('「淬体」→ martial 面板', env.WXUI.panelForCmd('淬体') === 'martial');
  ok('「炼丹」→ martial 面板', env.WXUI.panelForCmd('炼丹') === 'martial');
  ok('「地块」→ home 面板', env.WXUI.panelForCmd('地块') === 'home');
  ok('「开垦」→ home 面板', env.WXUI.panelForCmd('开垦') === 'home');
  ok('「大比」→ sect 面板', env.WXUI.panelForCmd('大比') === 'found');
}

console.log('\n  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('==============================================');
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);

})().catch(err => { console.error(err); process.exit(1); });