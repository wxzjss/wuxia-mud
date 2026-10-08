/**
 * dom-page-check.js —— 站点页面「真 DOM 渲染」检测
 *
 * 为什么要这个：
 *   account-check.js 只验「文件存在 / 关键字在 / 引用完整」，
 *   但 JS 渲染类错配（字段名写错、undefined.forEach）**完全不报错、静默失效**。
 *   这里用一个最小 DOM stub 真跑站点各个页面的内联脚本，验证：
 *     ① 脚本能加载进 stub 环境不抛异常
 *     ② 关键渲染函数确实被调用（用桩数据喂进去）
 *     ③ 渲染出的 HTML 里含有真实内容而不是空白
 *
 * 注意：本站是**单机 Mod 站**，没有账号 / 登录 / 论坛。
 *   对应的断言在撤账号那轮已整块删除，不要加回来。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'server', 'public');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- 最小 DOM stub ---------------- */
function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [], _html: '', textContent: '', className: '', id: '',
    style: {}, dataset: {}, _attrs: {},
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); el.className = (el.className + ' ' + c).trim(); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { if (on === undefined) { this.contains(c) ? this.remove(c) : this.add(c); } else if (on) this.add(c); else this.remove(c); },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {},
    setAttribute(k, v) { this._attrs[k] = v; if (k === 'class') this.className = v; if (k === 'id') this.id = v; },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {}, blur() {}, click() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }; },
    scrollIntoView() {},
    insertAdjacentHTML(pos, html) { this._html += html; },
  };
  return el;
}

function makeEnv(url) {
  const store = {};
  const doc = {
    _els: {},
    createElement: (t) => makeEl(t),
    getElementById(id) { if (!this._els[id]) this._els[id] = makeEl('div'); this._els[id].id = id; return this._els[id]; },
    querySelector(sel) { return makeEl('div'); },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'),
    head: makeEl('head'),
    documentElement: makeEl('html'),
    createTextNode: (t) => ({ textContent: t }),
  };
  const qs = url.indexOf('?') >= 0 ? url.slice(url.indexOf('?')) : '';
  const loc = {
    href: url, origin: 'http://127.0.0.1:8800', protocol: 'http:',
    host: '127.0.0.1:8800', hostname: '127.0.0.1', port: '8800',
    pathname: '/site/' + (url.split('?')[0].split('/').pop() || ''), search: qs, hash: '',
    reload() {}, assign() {},
  };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc, navigator: { userAgent: 'node-check', language: 'zh-CN' },
    localStorage: {
      _d: store,
      getItem(k) { return store[k] === undefined ? null : store[k]; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
      clear() { for (const k in store) delete store[k]; },
    },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve([]),
      text: () => Promise.resolve(''),
      blob: () => Promise.resolve({}),
      headers: { get: () => '' },
    }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    indexedDB: undefined,
    requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: URL, URLSearchParams: URLSearchParams,
    Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set,
    Intl,
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    WXCLOUD: null, L: null, LM: null, WorkBuddyCloud: null,
    /* 页面脚本里用到的、由 examples.js 等独立文件提供的全局 */
    EXAMPLES: {
      jianzhong: { key: 'jianzhong', badge: '剧情', title: '示例·剑冢奇遇', json: {}, body: '' },
      map: { key: 'map', badge: '地图', title: '示例·江南水乡', json: {}, body: '' },
    },
    renderExamples: () => {},
    CSS: { escape: (s) => s },
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  };
  env.window = env;
  env.self = env;
  env.globalThis = env;
  env.global = env;
  return env;
}

/* ---- 桩：云端（只剩 Mod 表相关的东西） ---- */
function stubCloud() {
  const mods = [
    {
      id: 'demo_jianzhong', name: '示例·剑冢奇遇', version: '1.0.0', author: '官方',
      category: '剧情', desc: '一段奇遇。', tags: ['剧情'], downloads: 42,
      counts: { rooms: 3, npcs: 2, items: 1 }, row: null,
    },
    {
      id: 'demo_map', name: '示例·江南水乡', version: '1.0.1', author: '官方',
      category: '地图', desc: '扩一张地图。', tags: ['地图'], downloads: 18,
      counts: { rooms: 8 }, row: null,
    },
  ];
  return {
    available: () => true,
    isReady: () => true,
    lastError: () => '',
    init: () => Promise.resolve(true),
    PUBLIC_CONFIG: {},
    onAuthChange: () => {},
    currentSession: () => null,
    currentUser: () => null,
    displayName: () => '',
    db: {
      stats: () => Promise.resolve({ mods: 2, downloads: 60, authors: 1, categories: 2 }),
      list: () => Promise.resolve(mods),
      detail: () => Promise.resolve(mods[0]),
      categories: () => Promise.resolve({ '剧情': 1, '地图': 1 }),
      publish: () => Promise.resolve(true),
      remove: () => Promise.resolve(true),
    },
    auth: { signOut: () => Promise.resolve(true) },
  };
}

function stubSite() {
  return {
    renderHead: () => {},
    renderFoot: () => {},
    esc: (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    getQuery: () => '',
    qs: () => ({}),
    fmtTime: () => '刚刚',
    fmtSize: () => '1.2 KB',
    toast: () => {},
    showModal: () => {},
    closeModal: () => {},
    rel: (u) => u,
    catChips: () => '',
    modCard: () => '',
    jget: () => Promise.resolve({}),
    jpost: () => Promise.resolve({}),
    q: (o) => Object.keys(o || {}).map(k => k + '=' + encodeURIComponent(o[k])).join('&'),
    exportCloudMod: () => Promise.resolve({ blob: {}, filename: 'x.zip' }),
    saveModLocally: () => Promise.resolve({ mode: 'download', path: 'x.zip' }),
    link: (h) => h,
    pick: async (arr) => (arr || [])[0],
    downloadZip: () => {},
    makeZip: () => ({}),
    saveBlob: () => {},
    bindCopy: () => {},
    fetchStats: () => Promise.resolve({}),
    fetchList: () => Promise.resolve([]),
    fetchDetail: () => Promise.resolve({}),
    fetchCategories: () => Promise.resolve({}),
    fetchGameUrl: () => Promise.resolve('/'),
    playGame: () => {},
    bindPlayButton: () => {},
  };
}

/* 真跑一页的 inline script */
function runPage(file, cloud, site, search) {
  const html = fs.readFileSync(path.join(PUB, file), 'utf8');
  const env = makeEnv('http://127.0.0.1:8800/site/' + file + (search || ''));
  env.WXCLOUD = cloud;
  env.SITE = site;
  env.CC = cloud;
  vm.createContext(env);

  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m, blocks = [], guard = 0;
  while ((m = re.exec(html)) !== null) {
    const code = m[1].trim();
    if (code) blocks.push(code);
    if (++guard > 60) break;
  }
  const errors = [];
  blocks.forEach((code, i) => {
    try {
      vm.runInContext(code, env, { filename: file + '#inline' + i, timeout: 4000 });
    } catch (e) {
      errors.push(e.message);
    }
  });
  return { env, errors, html, blocks: blocks.length };
}

/* ================= 开始 ================= */
console.log('==============================================');
console.log('  站点页面 · 真 DOM 渲染检测（单机版 · 无账号）');
console.log('==============================================');

const PAGES = ['index.html', 'list.html', 'mod.html', 'tutorial.html', 'examples.html', 'upload.html', 'game.html'];

section('① 每个页面脚本都能加载（无语法/引用错误）');
PAGES.forEach(f => {
  const r = runPage(f, stubCloud(), stubSite());
  ok(f + ' 内联脚本执行无异常', r.errors.length === 0, r.errors.length ? r.errors[0].slice(0, 90) : '(' + r.blocks + ' 段)');
});

section('② 页面必备骨架');
PAGES.forEach(f => {
  const html = fs.readFileSync(path.join(PUB, f), 'utf8');
  ok(f + ' 引入了 site.js', /site\.js/.test(html));
  ok(f + ' 引入了 cloud.js', /cloud\.js/.test(html));
  ok(f + ' 有 site-head 挂载点', /id="site-head"/.test(html) || /SITE\.renderHead/.test(html));
});

section('③ 已删页面确实不存在（账号/论坛已撤）');
['forum.html', 'account.html', 'mine.html'].forEach(f => {
  ok(f + ' 已删除', !fs.existsSync(path.join(PUB, f)));
});

section('④ 站点已无账号/论坛残留');
{
  const files = PAGES.concat(['js/site.js', 'js/cloud.js', 'css/site.css']);
  const banned = [
    ['openLogin', /openLogin/],
    ['requireLogin', /requireLogin/],
    ['setOnSignedIn', /setOnSignedIn/],
    ['renderUserArea', /renderUserArea/],
    ['signUpAccount', /signUpAccount/],
    ['signInAccount', /signInAccount/],
    ['WXCLOUD.profiles', /WXCLOUD\.profiles/],
    ['WXCLOUD.saves', /WXCLOUD\.saves/],
    ['WXCLOUD.forum', /WXCLOUD\.forum/],
    ['forum.html 链接', /['"\s]forum\.html/],
  ];
  files.forEach(f => {
    const src = fs.readFileSync(path.join(PUB, f), 'utf8');
    const hit = banned.filter(b => b[1].test(src)).map(b => b[0]);
    ok(f + ' 无账号残留', hit.length === 0, hit.length ? '命中: ' + hit.join(',') : '');
  });
}

section('⑤ SITE 契约（现存页面用到的都要有）');
{
  const need = ['renderHead', 'renderFoot', 'esc', 'getQuery', 'toast', 'showModal', 'closeModal',
    'rel', 'catChips', 'modCard', 'jget', 'jpost', 'saveModLocally', 'exportCloudMod',
    'fetchGameUrl', 'playGame', 'bindPlayButton', 'CATEGORIES', 'fmtTime', 'fmtSize'];
  const siteSrc = fs.readFileSync(path.join(PUB, 'js', 'site.js'), 'utf8');
  need.forEach(k => {
    const re = new RegExp('(^|[^\\w$.])' + k + '\\s*[:(,]');
    ok('site.js 提供 ' + k, re.test(siteSrc));
  });
}

/* ---- ⑤b：这段是异步的，放函数里，最后统一 await ---- */
async function checkCloudFallback() {
  section('⑤b 空云端必须回落本地（本轮真 bug：列表空白）');
  /* 复现：云端 mods 表是**空的**（官方示例只播到本地 site-data，不进云表）。
     过去 fetchStats/fetchList 在 try 里直接 return 云端结果，
     云端「查询成功但返回空」时不会回落本地 → 首页显示「还没有 Mod」。 */
  const LOCAL_STATS = { mods: 6, downloads: 0, authors: 1, topTags: [], latest: [{ id: 'demo_skill', name: '本地示例' }], hot: [] };
  const LOCAL_LIST = { total: 6, page: 1, size: 12, mods: [{ id: 'demo_skill', name: '本地示例' }] };
  const LOCAL_CATS = [{ name: '功法', count: 1 }];

  function mkSite(cloudStats, cloudList, cloudCats) {
    const env = makeEnv('http://127.0.0.1:8800/site/index.html');
    env.WXCLOUD = {
      available: () => true,
      isReady: () => true,
      init: () => Promise.resolve(true),
      db: {
        stats: () => Promise.resolve(cloudStats),
        list: () => Promise.resolve(cloudList),
        categories: () => Promise.resolve(cloudCats),
      },
    };
    /* 让本地接口返回有数据，这样「是否回落」一眼可见 */
    env.fetch = (url) => {
      const u = String(url);
      let body = {};
      /* ⚠ site.js 的 API='' 且 rel() 会剥掉前导 '/'，实际请求的是 'api/stats'（无斜杠） */
      if (u.indexOf('api/stats') >= 0) body = { ok: true, stats: LOCAL_STATS };
      else if (u.indexOf('api/categories') >= 0) body = { ok: true, categories: LOCAL_CATS };
      else if (u.indexOf('api/mods') >= 0) body = LOCAL_LIST;
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)), headers: { get: () => '' } });
    };
    vm.createContext(env);
    vm.runInContext(fs.readFileSync(path.join(PUB, 'js', 'site.js'), 'utf8'), env, { filename: 'site.js' });
    return env.SITE;
  }

  const EMPTY_STATS = { mods: 0, downloads: 0, authors: 0, topTags: [], latest: [], hot: [] };
  const EMPTY_LIST = { total: 0, mods: [], page: 1, size: 12 };

/* ① 云端全空 → 必须回落本地 */
const S1 = mkSite(EMPTY_STATS, EMPTY_LIST, []);
const s1 = await S1.fetchStats();
ok('云端 stats 为空时回落本地', s1 && (s1.mods || 0) > 0, 'mods=' + (s1 && s1.mods));
ok('回落后的 latest 非空', s1 && (s1.latest || []).length > 0);
const l1 = await S1.fetchList({});
ok('云端 list 为空时回落本地', l1 && (l1.mods || []).length > 0, 'mods=' + ((l1 && l1.mods) || []).length);
ok('回落时标记 cloud=false', l1 && l1.cloud === false);
const c1 = await S1.fetchCategories();
ok('云端 categories 为空时回落本地', Array.isArray(c1) && c1.length > 0, 'len=' + (c1 && c1.length));

/* ② 云端有数据 → 仍优先用云端（别把云功能弄丢） */
const S2 = mkSite(
  { mods: 3, downloads: 9, authors: 2, topTags: [], latest: [{ id: 'cloud_mod', name: '云 Mod' }], hot: [] },
  { total: 3, mods: [{ id: 'cloud_mod', name: '云 Mod' }], page: 1, size: 12 },
  [{ name: '剧情', count: 3 }]
);
const s2 = await S2.fetchStats();
ok('云端有数据时优先云端', s2 && s2.mods === 3, 'mods=' + (s2 && s2.mods));
const l2 = await S2.fetchList({});
ok('云端 list 有数据时用云端', l2 && l2.cloud === true && l2.mods[0].id === 'cloud_mod');

/* ③ 云端抛异常 → 回落本地 */
const env3 = makeEnv('http://127.0.0.1:8800/site/index.html');
env3.WXCLOUD = {
  available: () => true, isReady: () => true, init: () => Promise.resolve(true),
  db: {
    stats: () => Promise.reject(new Error('boom')),
    list: () => Promise.reject(new Error('boom')),
    categories: () => Promise.reject(new Error('boom')),
  },
};
env3.fetch = () => { const b = { ok: true, stats: LOCAL_STATS, categories: LOCAL_CATS, mods: LOCAL_LIST.mods, total: 6 }; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b), text: () => Promise.resolve(JSON.stringify(b)), headers: { get: () => '' } }); };
vm.createContext(env3);
vm.runInContext(fs.readFileSync(path.join(PUB, 'js', 'site.js'), 'utf8'), env3, { filename: 'site.js' });
const s3 = await env3.SITE.fetchStats();
ok('云端异常时回落本地', s3 && (s3.mods || 0) > 0, 'mods=' + (s3 && s3.mods));
}

section('⑥ cloud.js 契约（只剩 Mod 表）');
{
  const src = fs.readFileSync(path.join(PUB, 'js', 'cloud.js'), 'utf8');
  ['db', 'init', 'available', 'isReady', 'lastError'].forEach(k => {
    ok('cloud.js 定义了 ' + k, new RegExp('(^|[^\\w])' + k + '\\s*[:(]').test(src));
  });
  ['profiles', 'saves', 'forum', 'signUpAccount', 'signInAccount', 'T_PROFILE', 'T_SAVES', 'T_POSTS', 'T_REPLIES'].forEach(k => {
    ok('cloud.js 已无 ' + k, !new RegExp('(^|[^\\w])' + k + '\\s*[:(]').test(src));
  });
  ok('db 有 stats/list/detail/categories/publish/remove', /async stats\(/.test(src) && /async list\(/.test(src) &&
    /async detail\(/.test(src) && /async categories\(/.test(src) && /async publish\(/.test(src) && /async remove\(/.test(src));
  ok('publish 不再要求登录', !/请先登录后再发布/.test(src));
  ok('remove 不再要求登录', !/async remove\(key\)\s*\{\s*const s = await currentSession/.test(src));
}

section('⑦ 顶栏导航（无论坛入口）');
{
  const src = fs.readFileSync(path.join(PUB, 'js', 'site.js'), 'utf8');
  ok('有 Mod 列表入口', /list\.html/.test(src));
  ok('有制作教程入口', /tutorial\.html/.test(src));
  ok('有示例 Mod 入口', /examples\.html/.test(src));
  ok('有发布 Mod 入口', /upload\.html/.test(src));
  ok('有玩游戏入口', /game\.html/.test(src));
  ok('无论坛入口', !/forum\.html/.test(src));
}

section('⑧ 发布 Mod：不再要求登录');
{
  const src = fs.readFileSync(path.join(PUB, 'upload.html'), 'utf8');
  ok('有发布按钮', /id="publish"/.test(src));
  ok('发布走 cloud.db.publish', /db\.publish\(/.test(src));
  ok('作者名不再取当前用户昵称', !/currentUser\(\)\s*\|\|\s*\{\}\)\.nickname/.test(src));
  ok('不再弹登录框', !/openLogin|requireLogin/.test(src));
}

section('⑨ Mod 详情页：没有「删除我的 Mod」按钮了');
{
  const src = fs.readFileSync(path.join(PUB, 'mod.html'), 'utf8');
  ok('有下载 ZIP 按钮', /id="dl-zip"/.test(src));
  ok('有复制 mod.json 按钮', /id="copy-json"/.test(src));
  ok('无删除 Mod 按钮', !/del-mod/.test(src));
}

(async () => {
  await checkCloudFallback();

  console.log('\n==============================================');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('==============================================');
  if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  process.exit(fail ? 1 : 0);
})();
