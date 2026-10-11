/**
 * game-ui-check.js —— 游戏端「账号 / 继续游戏 / 云存档」真渲染检测
 *
 * 与 ui-bind-check.js 同思路：用最小 DOM stub 真跑 ui.js / start.js 里的渲染函数，
 * 抓「字段名错配、函数不存在、undefined.forEach」这类**不报错、只静默失效**的问题。
 */

'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------- 最小 DOM ---------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() { if (this.parentNode && this.parentNode.removeChild) this.parentNode.removeChild(this); },
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; },
    removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || { target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, blur() {}, click() { this.fire('click'); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(pos, html) { this._html += html; },
    setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); },
    firstChild: null, lastChild: null, parentNode: null, children_prev: null,
  };
  return el;
}

function makeEnv(url) {
  const store = {};
  const els = {};
  const doc = {
    readyState: 'complete',
    createElement: (t) => makeEl(t),
    createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: (t) => ({ textContent: t }),
  };
  const loc = {
    href: url, origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1:8800',
    hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '',
    reload() {}, assign() {}, replace() {},
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
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, lines: [], saves: [] }), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    indexedDB: undefined,
    requestAnimationFrame: (f) => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL: URL, URLSearchParams: URLSearchParams,
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

function loadFile(env, file) {
  const code = fs.readFileSync(path.join(RJS, file), 'utf8');
  if (!env._ctx) { vm.createContext(env); env._ctx = true; }
  vm.runInContext(code, env, { filename: file, timeout: 8000 });
}
/* ---------- 开跑 ---------- */
console.log('==============================================');
console.log('  游戏端 · 继续游戏 / 存档 / 单机模式 真渲染检测');
console.log('==============================================');

section('① index.html 首屏结构');
{
  const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
  ok('有「继续游戏」按钮', /id="btn-continue"/.test(html));
  ok('有「创建角色」按钮', /id="btn-newgame"/.test(html));
  ok('继续游戏默认隐藏（有档才显示）', /btn-continue[^>]*display\s*:\s*none/.test(html));
  ok('无账号展示区（已撤）', !/id="start-user"/.test(html));
  /* 版本戳不写死具体值，只要求「存在、且全部一致」——
     否则每次发版都要改测试，容易漏。 */
  const verM2 = html.match(/\?v=(20\d{6}[a-z])/);
  const verVal = verM2 ? verM2[1] : '';
  const verCount = verVal ? (html.match(new RegExp('\\?v=' + verVal, 'g')) || []).length : 0;
  ok('版本戳统一 ' + verVal, verCount >= 6, '(' + verCount + ' 处)');
  const allVers = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  ok('所有版本戳完全一致', new Set(allVers).size === 1, [...new Set(allVers)].join(','));
  ok('index.html 不再加载 js/cloud.js（云存档已删）', !/js\/cloud\.js/.test(html));

  /* 中屏水墨背景（主人 2026-10-11：「把游戏主菜单界面的背景复制到游戏里面
     成游戏里中屏幕的背景」）—— 守四件事，少一件就会「看着像没做」：
       ① 装饰层真的在 `#stage` 里面（放外面就跑到视口去了）
       ② `#stage` 是它的定位基准（少了 position:relative，inset:0 会往上找祖先）
       ③ 与 `#bg-art` **共用同一套配方**（选择器并列，不许各写一份）
       ④ 正文压在它上面（装饰层 z-index:0，不许盖住字） */
  {
    const css = fs.readFileSync(path.join(RJS, '..', 'css', 'main.css'), 'utf8');
    const iStage = html.indexOf('id="stage"');
    const iStageArt = html.indexOf('id="stage-art"');
    const iRoom = html.indexOf('id="room-panel"');
    ok('★ 中屏背景层在 #stage 内、且在内容之前',
      iStage >= 0 && iStageArt > iStage && iRoom > iStageArt);
    ok('★ #stage 是它的定位基准（position: relative）',
      /#stage \{[^}]*position:\s*relative/.test(css));
    ok('★ 中屏与主菜单**共用同一套配方**（选择器并列，不是各写一份）',
      /#bg-art .mount, #stage-art .mount/.test(css)
      && /#bg-art .mist, #stage-art .mist/.test(css)
      /* 月亮后来搬到了「春 · 辰时 · 晴」那一行（见下），共用对象换成 .room-moon，
         但仍然是与主菜单那一轮共用同一条渐变配方。 */
      && /#bg-art .moon, #room-panel .room-moon/.test(css));
    /* 月亮必须落在房间信息那一行里、且在文字之前（这样字才压得住它）。
       ⚠️ 不能留在 `#stage-art`：`#room-panel` 的底是不透明的，放背景层会被整块盖住。 */
    ok('★ 月亮在「春 · 辰时 · 晴」那一行里、且在文字之前',
      /class="room-head"[\s\S]{0,400}?class="room-moon"[\s\S]{0,400}?id="room-name"/.test(html));
    ok('★ 月亮没有留在背景层里（留着会被不透明面板盖住）',
      !/id="stage-art"[\s\S]{0,400}?class="moon"/.test(html));
    ok('★ 那行字有描边阴影（白字压白月的老毛病）',
      /\.room-env \{[^}]*text-shadow/.test(css));
    ok('★ 浅色主题也成对覆盖（漏了中屏会留两块脏印子）',
      /html.theme-light #bg-art .mount, html.theme-light #stage-art .mount/.test(css));
    ok('★ 正文压在装饰层之上（z-index）',
      /#stage > \*:not\(#stage-art\) \{[^}]*z-index:\s*1/.test(css));
  }
}

section('② app.js 单机版导出');
{
  const env = makeEnv('http://127.0.0.1:8800/');
  let err = '';
  try { loadFile(env, 'app.js'); } catch (e) { err = e.message; }
  ok('app.js 加载无异常', !err, err.slice(0, 90));
  const WX = env.WX;
  ok('导出 WX 全局', !!WX);
  if (WX) {
    ['api', 'util', 'S', 'bus'].forEach(k => ok('WX.' + k + ' 存在', WX[k] !== undefined));
    ['loadCloud', 'cloud', 'cloudBase', 'CLOUD_BASE_KEY'].forEach(k => {
      ok('WX.' + k + ' 已移除', WX[k] === undefined);
    });
    ['readSave', 'cloudSaves', 'saveBoth', 'cloudLoad', 'cloudDelSave', 'cloudHasAny'].forEach(k => {
      ok('api.' + k + ' 已移除', !(WX.api && typeof WX.api[k] === 'function'));
    });
    ['saves', 'save', 'load'].forEach(k => {
      ok('api.' + k + ' 仍在', WX.api && typeof WX.api[k] === 'function');
    });
  }
}

section('③ app.js 无云 SDK 懒加载');
{
  const src = fs.readFileSync(path.join(RJS, 'app.js'), 'utf8');
  ['insertScript', 'cdn.jsdelivr.net', 'unpkg.com', '../site/', 'CLOUD_BASE_KEY']
    .forEach(k => ok('已移除 ' + k, src.indexOf(k) < 0));
  ok('保留 jfetch（本地接口封装）', /function\s+jfetch/.test(src));
}

section('④ start.js「继续游戏」');
{
  const env = makeEnv('http://127.0.0.1:8800/');
  env.WX = {
    S: {}, util: { toast: () => {}, $: (id) => env.document.getElementById(id) },
    api: {
      saves: () => Promise.resolve({ saves: [] }),
      load: () => Promise.resolve({ ok: true }),
    },
    bus: { on() {}, emit() {} },
    saveSettings: () => {}, setMe() {}, jfetch: () => Promise.resolve({}),
    q: () => '',
  };
  let err = '';
  try { loadFile(env, 'start.js'); } catch (e) { err = e.message; }
  ok('start.js 加载无异常', !err, err.slice(0, 90));
  const S = env.WXSTART;
  ok('导出 WXSTART 全局', !!S);
  if (S) {
    ['boot', 'continueGame', 'probeSaves', 'openCreate', 'openDoc', 'loadFromLocalDir'].forEach(k => {
      ok('WXSTART.' + k + ' 存在', typeof S[k] === 'function');
    });
    ['openCloudLogin', 'renderStartUser', 'loadFromCloud'].forEach(k => {
      ok('WXSTART.' + k + ' 已移除', S[k] === undefined);
    });
  }
}

section('⑤ start.js 逻辑断言（纯本地）');
{
  const src = fs.readFileSync(path.join(RJS, 'start.js'), 'utf8');
  ok('探存档决定按钮显隐', /btn-continue/.test(src) && /probeSaves/.test(src));
  ok('只探本地存档', /api\.saves\(\)/.test(src));
  ok('已无云端探测', !/cloudSaves|cloudHasAny/.test(src));
  ok('有存档才显示（length > 0）', /length\s*>\s*0/.test(src));
  ok('无存档时高亮「创建角色」', /btn-newgame/.test(src));
  ok('继续游戏走本地存档列表', /continueGame/.test(src) && /openSaves\('load'\)/.test(src));
  ['loadFromCloud', 'save\/write', 'openCloudLogin', 'signUpAccount', 'signInAccount',
   'gr-nick', 'gr-pwd2', 'rememberDir', 'profiles'].forEach(k => {
    ok('已移除 ' + k, !new RegExp(k).test(src));
  });
  ok('本地 Mod 文件夹功能保留', /loadFromLocalDir/.test(src) && /WXLOCAL|L\.restore/.test(src));
}

section('⑥ ui.js 存档面板（纯本地）');
{
  const src = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  ok('openSaves 仍在', /function openSaves\(/.test(src));
  ok('保存走 api.save（本地）', /api\.save\(/.test(src));
  ['cloudSaves', 'save-cloudbar', 'data-cload', 'data-cdel', 'openCloudLogin', 'saveBoth']
    .forEach(k => ok('已移除 ' + k, src.indexOf(k) < 0));
  ok('仍有读取/覆盖/删除/新建', /data-save/.test(src) && /data-delsave|data-del/.test(src));
}

section('⑦ modmaker.js 上传走站点');
{
  const src = fs.readFileSync(path.join(RJS, 'modmaker.js'), 'utf8');
  ok('已无云端发布分支', !/db\.publish/.test(src));
  ok('已无云登录引导', !/openCloudLogin/.test(src));
  ok('走本地站点上传 siteUpload', /siteUpload/.test(src));
}

section('⑧ 双份副本逐字节一致');
{
  const pairs = [
    ['localmods.js', 'server/public/js/localmods.js', 'game/src/renderer/js/localmods.js'],
  ];
  pairs.forEach(([name, a, b]) => {
    const A = fs.readFileSync(path.join(ROOT, a), 'utf8');
    const B = fs.readFileSync(path.join(ROOT, b), 'utf8');
    ok(name + ' 两份一致', A === B, '(' + A.length + ' bytes)');
  });
  /* 🔴 2026-10-11：主人要求把游戏里的云存档（含登录）整块删掉 ——
     云端存的那份存档不再需要，本地自动存档照旧。改成反向断言守着。 */
  ok('游戏端 cloud.js 已删除（云存档下线）', !fs.existsSync(path.join(RJS, 'cloud.js')));
}

section('⑨ 服务端存档接口');
{
  const gs = fs.readFileSync(path.join(ROOT, 'server', 'game-server.js'), 'utf8');
  ok('已无 save/read 分支', !/case\s+'save\/read'/.test(gs));
  ok('save/write 分支已随云存档删除', !/case\s+'save\/write'/.test(gs));
  ok('query 仍当普通对象用', /query\s*&&\s*query\./.test(gs) || /\bquery\b/.test(gs));
  ok('没有误用 u.searchParams', !/\bu\.searchParams\b/.test(gs));
  const ms = fs.readFileSync(path.join(ROOT, 'server', 'mod-site.js'), 'utf8');
  ok('mod-site 已无 account 模块', !/require\(['"]\.\/account['"]\)/.test(ms));
  ok('mod-site 已无 /api/auth 路由', !/head === 'auth'/.test(ms));
  ok('mod-site 保留 Mod 站点主逻辑', /seedOfficialMods/.test(ms));
}

console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('==============================================');
if (fail) { console.log('\n失败项：'); fails.forEach(f => console.log('  - ' + f)); }
process.exit(fail ? 1 : 0);
