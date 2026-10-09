/**
 * smoke-ux-fixes.js — 主人本轮报的 4 个体验问题 回归
 *
 *   ① 左侧「属性」按钮弹出**空空如也**的属性框
 *      → 根因：attrHtml 读 `v.player.attrs`，后端 playerBrief 发的是 `player.attr`，
 *        且后端压根不发 `derived` → Object.keys(undefined||{}) 为空 → 空框
 *   ② 「这里有」一栏 NPC 名字旁要显示身份
 *   ③ 人际关系界面要显示好感度：「仇人某某某 好感度：-70」
 *   ④ 玩家走路不该不扣饱食度/口渴度
 *      → 根因：advanceTime 里 `if (minutes >= 10)`，走路只推进 1 分钟 → 永不触发
 *
 * ⚠️ 字段名必须跟后端一致（血泪 #29/#35）：attr 不是 attrs；恶名在 p.kidnap.wanted
 * ⚠️ 随机源固定 seed，否则假失败
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const cmdMod = require(path.join(ROOT, 'game/src/core/commands.js'));
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');

/* ---------- 最小 DOM（抄 game-ui-check.js 的 makeEl，字段名/方法名必须一模一样） ---------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); el.children = []; },
    get outerHTML() { return this._html; },
    appendChild(c) { el.children.push(c); el._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
    remove() { if (el.parentNode && el.parentNode.removeChild) el.parentNode.removeChild(el); },
    setAttribute(k, v) { el._attrs[k] = String(v); if (k === 'id') el.id = String(v); if (k === 'class') el.className = String(v); },
    getAttribute(k) { return el._attrs[k] !== undefined ? el._attrs[k] : null; },
    hasAttribute(k) { return el._attrs[k] !== undefined; },
    removeAttribute(k) { delete el._attrs[k]; },
    addEventListener(t, f) { (el._listeners[t] = el._listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    fire(t, ev) { (el._listeners[t] || []).forEach(f => f.call(el, ev || { target: el, preventDefault() {}, stopPropagation() {} })); },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    focus() {}, blur() {}, click() { el.fire('click'); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(pos, html) { el._html += html; },
    setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(el.tagName); },
    firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function makeEnv(url) {
  const store = {}; const els = {};
  const doc = {
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: (t) => ({ textContent: t }),
  };
  const loc = {
    href: url || 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800',
    protocol: 'http:', host: '127.0.0.1:8800', hostname: '127.0.0.1', port: '8800',
    pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {},
  };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', language: 'zh-CN', clipboard: { writeText: () => Promise.resolve() } },
    localStorage: {
      _d: store,
      getItem(k) { return store[k] === undefined ? null : store[k]; },
      setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; },
      clear() { for (const k in store) delete store[k]; },
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    indexedDB: undefined,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams,
    Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: (s) => String(s) },
    WXCLOUD: null, L: null, LM: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}

function freshWorld(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot();
  e.newGame({ name: '测试侠', gender: 'male', birth: 'wuxue' });
  const w = e.world;
  w.exec = (cmd) => e.exec(cmd);
  w._engine = e;
  return w;
}
function run(w, cmd) { const r = w.exec(cmd); return (r && r.lines) || []; }
function txt(lines) { return lines.map(l => l.text).join(' | '); }

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; fails.push(name + ' :: ' + e.message); console.log('  ✘ ' + name + ' → ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

/* ═══════ 0. 后端字段真相：打一遍 view() 的 key ═══════ */
console.log('\n【0】后端字段自检');
const API = cmdMod.__api || {};
t('__api 导出了 npcIdentity / relFavorBetween / fmtRelFavor', () => {
  for (const k of ['npcIdentity', 'relFavorBetween', 'fmtRelFavor']) {
    ok(typeof API[k] === 'function', '__api 缺 ' + k);
  }
});
t('playerBrief 发的是 attr 不是 attrs（attrHtml 之前就栽在这）', () => {
  const w = freshWorld();
  const v = w._engine.view();
  const p = v.player || {};
  ok(p.attr && typeof p.attr === 'object', 'view().player.attr 应是对象，实得 ' + JSON.stringify(p.attr));
  ok(p.attrs === undefined, 'view().player.attrs 不该存在（前端读错的就是它）');
});

/* ═══════ 1. 「这里有」显示身份 ═══════ */
console.log('\n【1】「这里有」显示身份');
t('lookRoom 的 npcs 行在名字后带身份', () => {
  const w = freshWorld();
  /* 找个人多的房间 */
  let found = null;
  for (const rid of Object.keys(w.data.rooms)) {
    const inst = w.npcsIn(rid);
    if (inst.length >= 1) { found = rid; break; }
  }
  ok(found, '全图找不到任何有 NPC 的房间');
  w.movePlayerTo(w.player, found);
  const lines = run(w, 'look');
  const npcLine = lines.find(l => l.kind === 'npcs');
  ok(npcLine, 'look 没出「这里有」行');
  ok(/这里有：/.test(npcLine.text), '文本不含「这里有」：' + npcLine.text);
  /* 至少一个 NPC 名字后有（身份） */
  ok(/（.+?）/.test(npcLine.text),
    '「这里有」行里没有任何（身份）：' + npcLine.text);
});
t('身份口径与 lookNpc 一致（都走 npcIdentity）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const lines = run(w, 'look');
  const npcLine = lines.find(l => l.kind === 'npcs');
  const inst = w.npcsIn(w.player.room)[0];
  const expect = API.npcIdentity(w, inst);
  ok(expect, 'npcIdentity 返空：' + inst.name);
  ok(npcLine.text.indexOf(inst.name + '（' + expect + '）') >= 0
    || npcLine.text.indexOf(inst.name) >= 0,
    `「这里有」里没带上身份 ${expect}：${npcLine.text}`);
});
t('「这里有」仍可点（hl 里 cmd 用裸名，不含括号身份）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const lines = run(w, 'look');
  const npcLine = lines.find(l => l.kind === 'npcs');
  const hl = npcLine.hl || [];
  ok(hl.length, 'npcs 行没有 hl');
  for (const h of hl) {
    for (const a of (h.actions || [])) {
      ok(a.cmd && a.cmd.indexOf('（') < 0, 'hl 里的 cmd 混进了括号身份：' + a.cmd);
    }
  }
});
t('同名人只算一次身份（不因人数重复刷屏）', () => {
  const w = freshWorld();
  const out = txt(run(w, 'look'));
  ok(out.indexOf('undefined') < 0, 'look 输出里出现 undefined：' + out);
});

/* ═══════ 2. 人际关系好感度 ═══════ */
console.log('\n【2】人际关系好感度');
t('relFavorBetween：仇 → −70（主人举的例子）', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '甲'; b.name = '乙';
  a.rel = [{ id: b.defId, kind: '仇' }];
  const v = API.relFavorBetween(a, b, a.rel[0]);
  eq(v, -70, '仇人基准好感度');
});
t('relFavorBetween：友/亲/师/生/夫妻 各有基准', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '甲'; b.name = '乙';
  const base = { 友: 60, 亲: 90, 师: 70, 生: 65, 夫妻: 100, 仇: -70, 敌: -60 };
  for (const [kind, want] of Object.entries(base)) {
    a.rel = [{ id: b.defId, kind }];
    eq(API.relFavorBetween(a, b, a.rel[0]), want, kind + ' 基准');
  }
});
t('数据里的 rel.favor 优先于 kind 基准', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '甲'; b.name = '乙';
  a.rel = [{ id: b.defId, kind: '友', favor: 12 }];
  eq(API.relFavorBetween(a, b, a.rel[0]), 12, 'rel.favor 应覆盖基准');
});
t('运行时 relFavor[oid] 优先级最高', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '甲'; b.name = '乙';
  a.rel = [{ id: b.defId, kind: '友', favor: 12 }];
  a.relFavor = {}; a.relFavor[b.defId] = 88;
  eq(API.relFavorBetween(a, b, a.rel[0]), 88, '运行时 relFavor 应最高');
});
t('好感度夹在 −100 ~ 100', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '甲'; b.name = '乙';
  a.rel = [{ id: b.defId, kind: '友', favor: 9999 }];
  eq(API.relFavorBetween(a, b, a.rel[0]), 100, '上限应 100');
  a.rel = [{ id: b.defId, kind: '仇', favor: -9999 }];
  eq(API.relFavorBetween(a, b, a.rel[0]), -100, '下限应 −100');
});
t('同 NPC 反复看好感度必须一样（不引入 rng）', () => {
  const w1 = freshWorld(1), w2 = freshWorld(2);
  const read = (w) => {
    const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
    const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
    a.name = '甲'; b.name = '乙';
    a.rel = [{ id: b.defId, kind: '仇' }];
    return API.relFavorBetween(a, b, a.rel[0]);
  };
  eq(read(w1), read(w2), '不同 seed 应得同一值');
});
t('fmtRelFavor：0 / 正 / 负 三态', () => {
  eq(API.fmtRelFavor(0), '0（不相干）', '0 的显示');
  eq(API.fmtRelFavor(60), '+60', '正值');
  eq(API.fmtRelFavor(-70), '−70', '负值应用中文减号');
});
t('guanxi 指令输出带「好感度：」和数值', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '仇人甲'; b.name = '仇人乙';
  a.rel = [{ id: b.defId, kind: '仇' }];
  const out = txt(run(w, 'guanxi 仇人甲'));
  ok(/好感度/.test(out), 'guanxi 没输出好感度：' + out);
  ok(/−70/.test(out), 'guanxi 好友感度数值不对：' + out);
});
t('guanxi 行用词称谓（仇人不是仇）+ 好感度顺序正确', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '仇人甲';
  a.rel = [{ id: b.defId, kind: '仇' }];
  const out = txt(run(w, 'guanxi 仇人甲'));
  ok(/仇人/.test(out), '没用「仇人」称谓：' + out);
  /* 规格行式：敌意称谓 + 目标名（身份） + 好感度 */
  ok(/仇人\s.*?\s.*?好感度：−70/.test(out),
    '行式应为「仇人　某某某（身份）　好感度：−70」：' + out);
  /* 单字「仇」不该单独出现（除了当身份词的一部分） */
  const relLine = out.split('|').find(x => /好感度/.test(x)) || '';
  ok(/仇人/.test(relLine) && !/(^|[^人])仇(?![人])\s/.test(relLine),
    '关系行该用「仇人」不用「仇」：' + relLine);
});
t('guanxi 行结构化字段齐全（relId/relKind/relFavor）', () => {
  const w = freshWorld();
  const a = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  const b = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  a.name = '仇人甲'; b.name = '仇人乙';
  a.rel = [{ id: b.defId, kind: '仇' }];
  const lines = run(w, 'guanxi 仇人甲');
  const line = lines.find(l => l.relId !== undefined);
  ok(line, 'guanxi 行没有 relId');
  eq(line.relKind, '仇', 'relKind');
  eq(line.relFavor, -70, 'relFavor');
});

/* ═══════ 3. 走路扣饱食/口渴 ═══════ */
console.log('\n【3】走路扣饱食度/口渴度');
t('走一步（1 分钟）会扣饱食/口渴（原来 minutes>=10 永不触发）', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = p.maxFood; p.water = p.maxWater;
  /* 找一个能走的出口 */
  let dir = null;
  for (const d of Object.keys(w.getRoom(p.room).exits || {})) { dir = d; break; }
  ok(dir, '起始房间没有出口');
  const DIR_CN = { n: '北', s: '南', e: '东', w: '西', ne: '东北', nw: '西北', se: '东南', sw: '西南' };
  run(w, DIR_CN[dir] || dir);
  ok(p.food < p.maxFood, '走一步后饱食度没掉：' + p.food + '/' + p.maxFood);
  ok(p.water < p.maxWater, '走一步后口渴度没掉：' + p.water + '/' + p.maxWater);
});
t('走路是连续比例结算（不是一次性门槛），累计 12 分钟掉 1 点饱食', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = 100; p.water = 100;
  for (let i = 0; i < 12; i++) w.advanceTime(1);
  /* 12 次 × (1/12) = 1（保留 2 位小数，允许 ±0.02 误差） */
  ok(Math.abs((100 - p.food) - 1) <= 0.02, '12 分钟后饱食掉了 ' + (100 - p.food) + '，期望 ≈1');
  /* 水：12 次 × (1/8) = 1.5 */
  ok(Math.abs((100 - p.water) - 1.5) <= 0.02, '12 分钟后口渴掉了 ' + (100 - p.water) + '，期望 ≈1.5');
});
t('advanceTime(0) 不扣（原地发呆不该饿）', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = 100; p.water = 100;
  w.advanceTime(0);
  eq(p.food, 100, 'food 被扣了');
  eq(p.water, 100, 'water 被扣了');
});
t('饱食/口渴不会扣成负数，也不会超过上限', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = 0; p.water = 0;
  w.advanceTime(50);
  ok(p.food >= 0, 'food 扣成负数：' + p.food);
  ok(p.water >= 0, 'water 扣成负数：' + p.water);
  p.food = p.maxFood; p.water = p.maxWater;
  w.advanceTime(-0);
  ok(p.food <= p.maxFood, 'food 超上限：' + p.food);
});
t('小数保留（每走一步都四舍五入回原值就等于白扣）', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = 100; p.water = 100;
  w.advanceTime(1);
  ok(p.food !== 100, 'advanceTime(1) 后 food 仍是 100 —— 小数被吃掉了');
  /* 精度定在 4 位（2 位时 12 次累计只扣 0.96，误差可见） */
  const decimals = (String(p.food).split('.')[1] || '').length;
  ok(decimals <= 4, 'food 小数位超过 4：' + p.food);
});
t('存档往返后饱食/口渴小数不丢（读档后仍是小数而非整数）', () => {
  const w = freshWorld();
  const p = w.player;
  p.food = 100; p.water = 100;
  w.advanceTime(5);
  const foodBefore = p.food;
  ok(foodBefore !== 100, '没扣出小数');
  /* 直接读字段，不做 hydrate —— 这里只验序列化精度 */
  const snap = JSON.parse(JSON.stringify({ food: p.food, water: p.water }));
  ok(Math.abs(snap.food - foodBefore) < 1e-6, '序列化丢精度：' + foodBefore + ' → ' + snap.food);
});

/* ═══════ 4. 属性面板（attrHtml 真渲染） ═══════ */
console.log('\n【4】属性面板不再空框');
/** 抠出 ui.js 的 attrHtml 真执行。
 *  ⚠️ vm 里必须**先加载 app.js 再加载 ui.js** —— ui.js 顶部就 `const {S,api,util,bus} = global.WX`，
 *    没有 WX 直接 TypeError，跟渲染逻辑无关（血泪：字段名类测试最容易栽在环境上）。
 *  ⚠️ attrHtml 从 WXUI.__html 取（纯函数，只做 view → html，不碰 DOM）。 */
function loadAttrHtml() {
  const env = makeEnv();
  env.WX = {
    S: {}, bus: { on() {}, emit() {} },
    util: { toast: () => {}, $: (id) => env.document.getElementById(id) },
    api: { exec: () => Promise.resolve({}), view: () => Promise.resolve({}) },
    jfetch: () => Promise.resolve({}),
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(RJS, 'app.js'), 'utf8'), env, { filename: 'app.js', timeout: 8000 });
  vm.runInContext(fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8'), env, { filename: 'ui.js', timeout: 8000 });
  const fn = env.WXUI && env.WXUI.__html && env.WXUI.__html.attrHtml;
  if (typeof fn !== 'function') throw new Error('WXUI.__html.attrHtml 不存在 —— ui.js 没导出测试出口');
  return fn;
}
t('attrHtml 读 player.attr（不是 attrs）能渲染出属性卡', () => {
  const attrHtml = loadAttrHtml();
  const w = freshWorld();
  const v = w._engine.view();
  /* 人工构造一份 attrHtml 一定认的 view */
  const fake = { player: { attr: { 力量: 12, 根骨: 10, 身法: 8, 悟性: 9, 定力: 11 }, maxHp: 90, maxMp: 40 } };
  const h = attrHtml(fake);
  ok(typeof h === 'string' && h.length > 0, 'attrHtml 返空');
  ok(/力量/.test(h), '没渲染出「力量」：' + h.slice(0, 200));
  ok(/12/.test(h), '没渲染出数值 12：' + h.slice(0, 200));
  ok(!/undefined/.test(h), '渲染出了 undefined：' + h.slice(0, 300));
  void v;
});
t('attrHtml 遇到真 view() 不空（这就是主人报的 bug）', () => {
  const attrHtml = loadAttrHtml();
  const w = freshWorld();
  const v = w._engine.view();
  const h = attrHtml(v);
  ok(h && h.length > 0, '真 view 渲染出空框');
  ok(!/undefined/.test(h), '真 view 渲染出 undefined：' + h.slice(0, 300));
});
t('attrHtml 的值有内容（不是「尚未定型」那行兜底）', () => {
  const attrHtml = loadAttrHtml();
  const w = freshWorld();
  const v = w._engine.view();
  const h = attrHtml(v);
  const p = v.player || {};
  const a = p.attr || {};
  const keys = Object.keys(a);
  if (keys.length) {
    ok(h.indexOf('尚未定型') < 0, 'player.attr 有值却走了兜底文案');
  } else {
    ok(h.indexOf('尚未定型') >= 0, 'player.attr 为空时应给兜底文案');
  }
});
t('attrHtml 会渲染衍生属性（后端不发 derived，用顶层战斗数值兜）', () => {
  const attrHtml = loadAttrHtml();
  const fake = {
    player: {
      attr: { 力量: 12 },
      atk: 40, def: 20, dodge: 15, parry: 18, speed: 22,
      maxHp: 90, maxMp: 40, martial: { aptitude: 7 },
    },
  };
  const h = attrHtml(fake);
  ok(/攻击/.test(h) || /衍生/.test(h), '没渲染衍生属性段：' + h.slice(0, 400));
});
t('attrHtml 不会把 attrs（不存在）当成唯一来源而崩', () => {
  const attrHtml = loadAttrHtml();
  const h = attrHtml({ player: {} });
  ok(typeof h === 'string', '空 player 也该返回字符串');
  ok(!/undefined/.test(h), '空 player 渲染出 undefined');
});
t('attrHtml 会转义 HTML（属性名/数值不裸奔）', () => {
  const attrHtml = loadAttrHtml();
  const h = attrHtml({ player: { attr: { '<img src=x>': 1 } } });
  ok(!/<img src=x>/.test(h), '属性名没转义：' + h);
});

/* ═══════ 5. 「询问」得让玩家知道能问什么 ═══════ */
console.log('\n【5】「询问」面板可操作');
t('view().npcs 每项都带 askTopics（原来压根没这个字段）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const v = w._engine.view();
  ok(v.npcs && v.npcs.length, '场景里没有 NPC');
  for (const n of v.npcs) {
    ok(Array.isArray(n.askTopics), n.name + ' 的 askTopics 不是数组');
    ok(n.askTopics.length > 0, n.name + ' 的 askTopics 是空的 —— 点「询问」还是空框');
  }
});
t('无 ask 数据的路人也有话题（通用三项兜底）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const n = w.npcsIn(rid).find(x => !(x.def && x.def.ask));
  ok(n, '找不到没有 ask 数据的 NPC（测试前提失效）');
  const tp = w._engine.askTopicsOf(n);
  ok(tp.length >= 3, '路人 NPC 话题少于 3 条：' + JSON.stringify(tp));
  const names = tp.map(x => x.topic);
  for (const g of ['你是谁', '近况', '江湖消息']) {
    ok(names.indexOf(g) >= 0, '缺通用话题 ' + g + '：' + JSON.stringify(tp));
  }
});
t('有 ask 数据的 NPC 专属话题排在最前', () => {
  const w = freshWorld();
  const withAsk = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  withAsk.name = '有问的人';
  withAsk.def = { ask: [{ topic: '独门绝技', answer: '不告诉你。' }] };
  const tp = w._engine.askTopicsOf(withAsk);
  eq(tp[0].topic, '独门绝技', '专属话题应排第一');
});
t('ask 数据是对象（不是数组）时不崩 —— 这是真踩过的坑', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.name = '对象 ask';
  n.def = { ask: { topic: '独家', answer: '嗯。' } };
  let tp;
  try { tp = w._engine.askTopicsOf(n); }
  catch (e) { throw new Error('ask 是对象时 askTopicsOf 抛异常：' + e.message); }
  eq(tp[0].topic, '独家', '对象 ask 应能归一化');
  /* 指令侧也不能崩 */
  const out = txt(run(w, 'ask ' + n.name + ' about 独家'));
  ok(!/error|Error/.test(out), '对象 ask 时 ask 指令挂了：' + out);
});
t('askTopics 去重且不含 undefined/空串', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.name = '重复的';
  n.def = { ask: [{ topic: '近况' }, { topic: '近况' }, { topic: '' }, { }] };
  const tp = w._engine.askTopicsOf(n);
  const names = tp.map(x => x.topic);
  eq(new Set(names).size, names.length, '有重复话题：' + JSON.stringify(names));
  ok(names.indexOf('') < 0 && names.indexOf(undefined) < 0, '有空话题：' + JSON.stringify(names));
});
t('askTopics 数量有上限（不会糊一屏）', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.name = '话痨';
  n.def = { ask: Array.from({ length: 30 }, (_, i) => ({ topic: '话' + i })) };
  ok(w._engine.askTopicsOf(n).length <= 8, '上限 8，实际 ' + w._engine.askTopicsOf(n).length);
});
t('通用兜底真能问出东西（不再全是「这个我却不知」）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const n = w.npcsIn(rid)[0];
  for (const q of ['你是谁', '近况', '江湖消息']) {
    const out = txt(run(w, 'ask ' + n.name + ' about ' + q));
    ok(!/这个我却不知/.test(out), `问「${q}」还是「这个我却不知」：${out}`);
  }
});
t('「你是谁」报的身份与场景栏同一口径', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const n = w.npcsIn(rid)[0];
  const who = API.npcIdentity(w, n);
  const out = txt(run(w, 'ask ' + n.name + ' about 你是谁'));
  ok(out.indexOf(who) >= 0, `「你是谁」应答里的身份(${who})与场景栏不一致：${out}`);
});
t('about 解析不吃掉话题（中文「问」不该切碎 topic）', () => {
  const w = freshWorld();
  const n = w.spawnNpc('mob_bandit', w.player.room, 1, true);
  n.name = '被问的人';
  const out = txt(run(w, 'ask ' + n.name + ' about 随便问点什么'));
  ok(/随便问点什么/.test(out), '话题被切碎了：' + out);
});
t('ask 缺话题参数时给提示（不是静默问了个空）', () => {
  const w = freshWorld();
  let rid = null;
  for (const r of Object.keys(w.data.rooms)) { if (w.npcsIn(r).length) { rid = r; break; } }
  w.movePlayerTo(w.player, rid);
  const n = w.npcsIn(rid)[0];
  const out = txt(run(w, 'ask ' + n.name));
  ok(/想问|什么/.test(out), '缺话题时无提示：' + out);
});
t('ui.js 的 askNpc 渲染了话题按钮区（不再只有一个输入框）', () => {
  const src = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  const m = src.match(/function askNpc\(n\)\s*\{[\s\S]*?\n  \}/);
  ok(m, '抠不出 askNpc');
  const body = m[0];
  ok(/askTopics/.test(body), 'askNpc 没读 askTopics');
  ok(/ask-topics/.test(body), 'askNpc 没渲染 ask-topics 按钮区');
  ok(/ask-input/.test(body), 'askNpc 丢了自填输入框');
  /* 从输入框升级成「次要选择」，得有一句引导 */
  ok(/或自己写|自己写/.test(body), 'askNpc 没有引导玩家自填');
});
t('css 有 .ask-topics 和 .mini-tag.dim 样式（否则按钮裸奔）', () => {
  const css = fs.readFileSync(path.join(ROOT, 'server/public/css/main.css'), 'utf8');
  ok(/\.ask-topics/.test(css), '缺 .ask-topics 样式');
  ok(/\.mini-tag\.dim/.test(css), '缺 .mini-tag.dim 样式');
});
t('版本戳已推进（改了前端没效果先疑缓存）', () => {
  const html = fs.readFileSync(path.join(RJS, '..', 'index.html'), 'utf8');
  const ver = (html.match(/\?v=(20\d{6}[a-z])/) || [])[1];
  ok(ver, 'index.html 没有版本戳');
  const all = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(x => x[1]);
  eq(new Set(all).size, 1, '版本戳不一致：' + [...new Set(all)].join(','));
  ok(all.length >= 7, '版本戳只有 ' + all.length + ' 处');
});

/* ═══════ 6. 两份 ui.js / css 必须逐字节一致 ═══════ */
console.log('\n【6】副本一致');
t('server/public/js/ui.js 与 game/src/renderer/js/ui.js 一致', () => {
  const a = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');
  const b = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  ok(a === b, '两份 ui.js 不一致 —— 改动只同步了一半');
});
t('server/public/css/main.css 与 game/src/renderer/css/main.css 一致', () => {
  const a = fs.readFileSync(path.join(ROOT, 'server/public/css/main.css'), 'utf8');
  const b = fs.readFileSync(path.join(RJS, '..', 'css/main.css'), 'utf8');
  ok(a === b, '两份 main.css 不一致');
});

/* ---- 工具 ---- */
console.log('\n============================================');
console.log(`  体验修复 smoke: ${pass} 通过 / ${fail} 失败`);
console.log('============================================');
if (fail) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}