#!/usr/bin/env node
/**
 * _accept-ui4.js —— 界面四条（209b970）独立验收 · QA 自建判据
 *
 * 不看主程序给的断言，从「会长什么样、点下去会怎样」验：
 *   1 老存档迁移（刁钻 localStorage：含 fly/help/guide、无 look、顺序被打乱）
 *   2 默认新号：DOM 第一颗按钮文字 = 「看」；无「行路」「帮助」
 *   3 点「看」→ 真的发 look 且日志出现房间描述（走真 engine.exec）
 *   4 迷雾：真后端 mapView（无 fog）→ 本区每间房都有名字、data-room 数 == 后端本区房间数
 *   5 地名索引：默认不渲染；设置开 → 渲染；按钮点得动（有 onclick 且能触发平移/有效动作）
 *   6 fly/help 面板仍能打开
 *   7 版本戳 9 处全 20261018n；server/public 与 game/src 副本逐字节一致
 *
 * 用法：node tools/_accept-ui4.js
 * 只读：不改实现、不改数据。`_` 开头不进套件。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); } else { fail++; console.log('  \u2718 ' + name + (extra ? '  ' + extra : '')); } };

/* ---------- 最小 DOM（只支持本单要用的那点东西）---------- */
function parseButtons(html) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = {};
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    const text = m[2].replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    const btn = { attrs, text, className: attrs.class || '', onclick: null };
    btn.click = () => { if (typeof btn.onclick === 'function') return btn.onclick(); return undefined; };
    btn.getAttribute = (k) => (Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null);
    btn.setAttribute = (k, v) => { attrs[k] = String(v); };
    out.push(btn);
  }
  return out;
}
function makeEl(id) {
  const el = {
    id: id || '', className: '', textContent: '', children: [], style: {}, dataset: {}, _attrs: {},
    _html: '', scrollTop: 0, scrollLeft: 0, scrollWidth: 800, clientWidth: 320, disabled: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); },
      toggle(c, on) { if (on === undefined ? this._s.has(c) : !on) this._s.delete(c); else this._s.add(c); },
    },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    remove() { }, focus() { }, blur() { }, click() { if (typeof this.onclick === 'function') this.onclick(); },
    addEventListener() { }, removeEventListener() { }, scrollIntoView() { }, contains() { return false; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : (k === 'class' ? this.className : null); },
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'class') this.className = String(v); },
    querySelectorAll(sel) {
      if (this._parsedFor !== this._html) { this._parsedFor = this._html; this._parsed = parseButtons(this._html); }
      const btns = this._parsed;
      if (sel.indexOf('.qb-btn[data-cmd]') >= 0) return btns.filter((b) => b.attrs['data-cmd'] && b.className.indexOf('qb-btn') >= 0);
      if (sel.indexOf('.map-node[data-room]') >= 0) return btns.filter((b) => b.attrs['data-room']);
      if (sel.indexOf('mrn-btn') >= 0) return btns.filter((b) => b.className.indexOf('mrn-btn') >= 0);
      if (sel.indexOf('[data-fly-region]') >= 0) return btns.filter((b) => b.attrs['data-fly-region']);
      if (sel.indexOf('[data-travel-region]') >= 0) return btns.filter((b) => b.attrs['data-travel-region']);
      if (sel.indexOf('[data-map-tool]') >= 0) return btns.filter((b) => b.attrs['data-map-tool']);
      return btns;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return this._html; },
    set(v) { this._html = String(v); },
  });
  return el;
}

/* ---------- 真实后端数据 ---------- */
const engine = new GameEngine({ seed: 20261021 });
let serverFogSeen = [];

(async () => {
  await engine.boot({});
  await engine.newGame({ name: '验收客', gender: 'male', sect: 'huashan' });
  const w = engine.world;

  /* 模拟服务端 /api/view：把前端传来的 opts 映射成 engine.view 入参（照抄 game-server.js:480-510）
     ⚠️ 服务端 fog 默认 '0'（不传=全量名字），这正是「前端不传 fog」能成立的前提。 */
  const srvView = (panelName, opts) => {
    const o = opts || {};
    const wantMap = panelName === 'map' || panelName === 'fly';
    const rawFog = o.fog === undefined ? '0' : String(o.fog);
    if (wantMap) serverFogSeen.push({ panel: panelName, fogKey: Object.prototype.hasOwnProperty.call(o, 'fog'), rawFog });
    return {
      ok: true,
      view: engine.view({
        map: wantMap,
        mapGeometry: panelName === 'map',
        mapRegion: o.region || null,
        mapNeighbors: o.neighbors === undefined ? true : String(o.neighbors) !== '0',
        mapFog: rawFog === '1',
      }),
    };
  };
  const srvExec = async (cmd) => {
    const r = await engine.exec(cmd);
    return Object.assign({ ok: true }, r, { view: engine.view({ map: false }) });
  };

  /* ---------- 渲染层环境 ---------- */
  const els = new Map();
  const document = {
    getElementById(id) { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement(tag) { return makeEl(''); },
    querySelector(sel) { return this.getElementById(sel); },
    querySelectorAll() { return []; },
    addEventListener() { }, removeEventListener() { },
    body: makeEl('body'), documentElement: makeEl('html'), title: '',
  };
  const store = new Map();
  const localStorage = {
    getItem(k) { return store.has(k) ? store.get(k) : null; },
    setItem(k, v) { store.set(k, String(v)); }, removeItem(k) { store.delete(k); },
  };
  const S = {
    view: null, busy: false, settings: { font: 100, anim: true, autosave: false, narrow: false, mapNav: false },
    user: null, auto: null,
  };
  const calls = { exec: [], view: [] };
  const api = {
    exec: async (cmd) => { calls.exec.push(cmd); return srvExec(cmd); },
    view: async (name, opts) => { calls.view.push({ name, opts }); return srvView(name, opts); },
  };
  const util = new Proxy({
    esc: (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
    clamp: (v, a, b) => Math.max(a, Math.min(b, v)),
    rnd: (n) => Math.floor(Math.random() * n),
  }, { get: (t, k) => (k in t ? t[k] : (() => '')) });
  const bus = { on() { }, off() { }, emit() { } };
  const win = {
    document, localStorage, WX: { S, api, util, bus },
    setTimeout: (f, t) => setTimeout(f, t), clearTimeout, setInterval: () => 0, clearInterval() { },
    requestAnimationFrame: (f) => setTimeout(f, 16), cancelAnimationFrame() { },
    addEventListener() { }, removeEventListener() { },
    innerWidth: 1280, innerHeight: 800, location: { href: 'http://x/', search: '' },
    navigator: { userAgent: 'node' }, console,
    XMLHttpRequest: function () { this.open = () => { }; this.send = () => { }; this.setRequestHeader = () => { }; return { status: 0, responseText: '{}' }; },
  };
  win.window = win; win.globalThis = win;
  const ctx = vm.createContext(win);
  win.WXUITest = {};
  const src = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
  try { vm.runInContext(src, ctx, { filename: 'ui.js' }); ok('渲染层 ui.js 能在最小 DOM 里加载', !!win.WXUI); }
  catch (e) { console.log('    ' + e.message); ok('渲染层 ui.js 能在最小 DOM 里加载', false); process.exit(1); }
  const UI = win.WXUI;
  const el = (id) => document.getElementById(id);
  /* app.js 在真机上会调 bindInput()；这里照做，才有真实输入框回车路径 */
  if (typeof UI.bindInput === 'function') UI.bindInput();
  const typeCmd = async (cmd) => {
    const inp = el('cmd-input');
    /* els.clear() 之后是全新元素，onkeydown 会丢 —— 重绑一次（与真机 app.js 每次进游戏一致） */
    if (typeof inp.onkeydown !== 'function' && typeof UI.bindInput === 'function') UI.bindInput();
    inp.value = cmd;
    inp.onkeydown({ key: 'Enter', preventDefault() { } });
    await new Promise((r) => setTimeout(r, 80));
  };
  const view = () => engine.view({ map: false });

  /* ================= 1 老存档迁移 ================= */
  console.log('\n§1 老存档迁移（刁钻 localStorage）');
  {
    const tricky = [
      { label: '地图', cmd: 'map' },
      { label: '武学', cmd: 'skills' },
      { label: '行路', cmd: 'fly' },
      { label: '帮助', cmd: 'help' },
      { label: '背包', cmd: 'i' },
      { label: '教程', cmd: 'guide' },
    ];
    store.set('wx_quickbar', JSON.stringify(tricky));
    UI.renderAll(view());
    const btns = els.get('quickbar').querySelectorAll('.qb-btn[data-cmd]').filter((b) => b.attrs['data-cmd'] !== 'sect' && b.attrs['data-cmd'] !== '吐纳' && b.attrs['data-cmd'] !== '练武学');
    const cmds = btns.map((b) => b.attrs['data-cmd']);
    console.log('    迁移后按钮:', JSON.stringify(btns.map((b) => b.text + '(' + b.attrs['data-cmd'] + ')')));
    ok('迁移后无 fly/help/guide', !cmds.some((c) => ['fly', 'help', 'guide'].includes(c)), cmds.join(','));
    ok('「看」在索引 0', cmds[0] === 'look', '实际索引 0 = ' + cmds[0]);
    ok('玩家原有顺序保持相对次序（map→skills→i）', JSON.stringify(cmds.filter((c) => ['map', 'skills', 'i'].includes(c))) === JSON.stringify(['map', 'skills', 'i']), cmds.join(','));
    /* 回写与否不是需求项：loadQuickbar 只在内存里迁移，每次渲染重新算（幂等）。
       记为观察项，不判失败；但要说出来，避免以后有人以为磁盘已被清理。 */
    const stored = JSON.parse(store.get('wx_quickbar') || '[]').map((x) => x.cmd);
    console.log('    ⓘ 观察：localStorage 原文仍是 ' + JSON.stringify(stored) + '（迁移只在内存生效、不回写；幂等无害）');
  }

  /* ================= 2 默认新号 ================= */
  console.log('\n§2 默认新号：DOM 第一颗 = 看');
  {
    store.clear(); els.clear(); calls.exec.length = 0;
    UI.renderAll(view());
    const all = els.get('quickbar').querySelectorAll('.qb-btn[data-cmd]');
    const labels = all.map((b) => b.text);
    ok('DOM 第一颗按钮文字 = 看', labels[0] === '看', '实际 = ' + labels[0] + '；前六=' + labels.slice(0, 6).join('/'));
    ok('DOM 无「行路」「帮助」按钮', !labels.includes('行路') && !labels.includes('帮助'), labels.join('/'));
  }

  /* ================= 3 点「看」 ================= */
  console.log('\n§3 点「看」真的发 look 且日志出现房间描述');
  {
    store.clear(); els.clear(); calls.exec.length = 0;
    const v = view();
    UI.renderAll(v);
    const lookBtn = els.get('quickbar').querySelectorAll('.qb-btn[data-cmd]').find((b) => b.attrs['data-cmd'] === 'look');
    ok('找得到「看」按钮', !!lookBtn);
    if (lookBtn) {
      const before = el('log').innerHTML.length;
      lookBtn.click();
      await new Promise((r) => setTimeout(r, 60));
      ok('发出的是 look 指令', calls.exec[0] === 'look', '实际 = ' + calls.exec[0]);
      const desc = (engine.world.getRoom(engine.world.player.room) || {}).desc || '';
      const logHtml = el('log').innerHTML;
      const tail = logHtml.slice(before);
      const hit = desc && (tail.indexOf(desc.slice(0, 12)) >= 0 || logHtml.indexOf(desc.slice(0, 12)) >= 0);
      ok('日志里出现房间描述（取前 12 字比对）', !!hit, hit ? '' : '日志新增片段: ' + tail.slice(0, 80));
    }
  }

  /* ================= 4 迷雾 ================= */
  console.log('\n§4 迷雾：真后端数据下每间房都有名字');
  {
    serverFogSeen = [];
    store.clear(); els.clear(); calls.view.length = 0;
    S.settings.mapNav = false;
    await typeCmd('地图');
    const opts = calls.view[0] && calls.view[0].opts;
    ok('地图请求不带 fog 参数', !!opts && !Object.prototype.hasOwnProperty.call(opts, 'fog'), JSON.stringify(opts));
    const body = els.get('modal-body').innerHTML;
    const nodes = parseButtons(body).filter((b) => b.attrs['data-room']);
    const map = (engine.view({ map: true, mapRegion: 'auto', mapNeighbors: false, mapFog: false }) || {}).map || {};
    const curRegion = (map.region && map.region.id) || map.region;
    const curZ = (map.rooms || []).filter((r) => r.current)[0];
    const z = curZ ? (curZ.z || 0) : 0;
    const regionRooms = (map.rooms || []).filter((r) => r.region === curRegion);
    const sameLayer = regionRooms.filter((r) => (r.z || 0) === z);
    /* 地图按「本区本层」画（多层区域上/下层是切档看的），所以对比的是同层集合；
       两个数都打出来，别让读者以为少画了。 */
    ok('data-room 数 == 后端本区本层房间数', nodes.length === sameLayer.length,
      nodes.length + ' 画 / ' + sameLayer.length + ' 本层（本区共 ' + regionRooms.length + ' 间，其余在别的层）');
    const named = nodes.filter((b) => b.text && b.text.replace(/[（(].*$/, '').trim().length > 0);
    ok('每个格子都有名字（不含「尚未探索」）', named.length === nodes.length && !body.includes('尚未探索'), named.length + '/' + nodes.length);
    /* 再加一条硬的：把后端 visited=false 的房挑出来，它们在 DOM 里也必须有名字 */
    const unvisited = regionRooms.filter((r) => !r.visited && (r.z || 0) === z).map((r) => r.id);  /* 只看本层：别的层本来就不画 */
    const nodeById = {};
    nodes.forEach((b) => { nodeById[b.attrs['data-room']] = b; });
    const unvisitedNamed = unvisited.filter((id) => nodeById[id] && nodeById[id].text.trim().length > 0);
    ok('未探索房（visited=false）也都有名字', unvisited.length > 0 && unvisitedNamed.length === unvisited.length,
      unvisitedNamed.length + '/' + unvisited.length + ' 未探索房有名');
    ok('地图 HTML 不含 .map-region-nav（默认隐藏）', body.indexOf('map-region-nav') < 0);

    /* F2 提示（6086a54）：只画当前层是现状，但抬头必须明示「本区共 N 处，另有 M 处在别层」。
       ⚠️ 这条只在 levelsScope==='region' 时才允许出现 —— 不分批 view 的 levels 是全世界 522，
          拿它算提示会报出假数字，所以反向断言必须做。 */
    const scoped = map.levelsScope;
    ok('本区请求的 levelsScope = region', scoped === 'region', '实际 ' + scoped);
    const hintRe = /本区共\s*(\d+)\s*处，另有\s*(\d+)\s*处在别层/;
    const hint = hintRe.exec(body);
    ok('地图抬头有「本区共 N 处，另有 M 处在别层」', !!hint, hint ? hint[0] : '未找到提示');
    if (hint) {
      const total = Number(hint[1]), rest = Number(hint[2]);
      ok('提示里的数字与后端一致（总数=本区、另有=非本层）', total === regionRooms.length && rest === (regionRooms.length - sameLayer.length),
        '提示 ' + total + '/' + rest + ' vs 数据 ' + regionRooms.length + '/' + (regionRooms.length - sameLayer.length));
    }
    /* 反向：把 api.view 换成「不分批」payload（levels 全世界 522），提示绝不许出现 */
    const allScope = engine.view({ map: true }).map;
    const origView = api.view;
    api.view = async () => ({ ok: true, view: { player: engine.world.player, map: allScope } });
    els.clear();
    await typeCmd('地图');
    const bodyAll = el('modal-body').innerHTML;
    ok('不分批 payload（levelsScope=all，522）时提示不出现', !hintRe.test(bodyAll),
      'levelsScope=' + allScope.levelsScope + ' · 提示=' + (hintRe.exec(bodyAll) || ['无'])[0]);
    api.view = origView;
  }

  /* ================= 5 地名索引开关 ================= */
  console.log('\n§5 地名索引：默认隐藏 / 设置开 → 静态信息行 / 关 → 立刻消失');
  {
    store.clear(); els.clear();
    S.settings.mapNav = true;
    await typeCmd('地图');
    const on1 = els.get('modal-body').innerHTML;
    ok('设置开 → 渲染 .map-region-nav', on1.indexOf('map-region-nav') >= 0);
    const navItems = (on1.match(/class="mrn-item/g) || []).length;
    /* 2026-10-18 反转口径：地名索引是静态信息，不是按钮。
       守「真的不可点」（没有按钮/没有绑定）+「信息没丢」（区域名与已探数仍在）。 */
    const navButtons = parseButtons(on1).filter((b) => b.className.indexOf('mrn-item') >= 0
      || b.className.indexOf('mrn-btn') >= 0);
    ok('地名索引是信息行（.mrn-item）', navItems > 0, navItems + ' 行');
    ok('地名索引里没有按钮（不可点，不是哑按钮）', navButtons.length === 0, navButtons.length + ' 个');
    ok('信息没丢：区域名与已探数仍在', /mrn-num/.test(on1) && /mrn-name/.test(on1));
    const uiSrc = src;
    ok('渲染层不再给地名绑 onclick', !/mrn-(item|btn)[^\n]{0,80}onclick/.test(uiSrc));
    S.settings.mapNav = false;
    await typeCmd('地图');
    const off = els.get('modal-body').innerHTML;
    ok('关掉后重渲染立刻不含 .map-region-nav', off.indexOf('map-region-nav') < 0);
  }

  /* ================= 6 fly / help 仍能打开 ================= */
  console.log('\n§6 行路 / 帮助 面板仍能打开');
  {
    store.clear(); els.clear();
    els.clear(); calls.view.length = 0;
    await typeCmd('行路');
    const flyBody = el('modal-body').innerHTML;
    ok('敲「行路」能打开行路面板（PANEL_CMDS 行路→fly）', /行路|驿|渡/.test(flyBody) && flyBody.length > 120, '面板长度 ' + flyBody.length + ' · 请求 ' + JSON.stringify(calls.view.map((x) => x.name)));
    els.clear(); calls.view.length = 0;
    await typeCmd('帮助');
    const helpBody = el('modal-body').innerHTML;
    /* 帮助面板的真实标记是 .help-grid / .hc-title（不是“指令”“帮助”这两个词） */
    const helpHit = helpBody.indexOf('help-grid') >= 0 || helpBody.indexOf('hc-title') >= 0;
    ok('敲「帮助」能打开指令帮助', helpHit && helpBody.length > 120,
      '面板长度 ' + helpBody.length + ' · 匹配=' + helpHit + ' · 开头=' + helpBody.slice(0, 90).replace(/\s+/g, ' '));
  }

  /* ================= 7 版本戳与副本一致 ================= */
  console.log('\n§7 版本戳 20261018n + 双副本逐字节一致');
  {
    const idx = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
    const vs = [...idx.matchAll(/\?v=([A-Za-z0-9]+)/g)].map((m) => m[1]);
    ok('index.html ?v= 共 9 处', vs.length === 9, '实际 ' + vs.length + ' 处: ' + vs.join(','));
    ok('9 处全部 20261018n', vs.length === 9 && vs.every((x) => x === '20261018n'), [...new Set(vs)].join(','));
    const pairs = [['ui.js'], ['app.js']];
    for (const [f] of pairs) {
      const a = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', f));
      const b = fs.readFileSync(path.join(ROOT, 'server', 'public', 'js', f));
      ok(f + ' 双副本逐字节一致', a.equals(b), a.length + ' vs ' + b.length);
    }
  }

  console.log('\n—— 合计 通过 ' + pass + ' / 失败 ' + fail + ' ——');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
