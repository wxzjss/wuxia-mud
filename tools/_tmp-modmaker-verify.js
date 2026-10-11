/**
 * _tmp-modmaker-verify.js —— Mod 制作器（modmaker.js）自验
 *
 * 两段：
 *   A. 前端（vm 里真加载 app.js + modmaker.js，喂真 engine.editorMeta()）：
 *      · 武学类型下拉 = 中文十槽位；分类下拉 = 五大类；品级下拉 = 六档中文
 *      · 物品类型下拉显示**中文**（武器/丹药…），不再是英文码
 *      · 异常槽位（sword）会在表单里给出大白话提示
 *      · 填 sword → runValidate 走真 engine.validateSpec → 报告里有中文「纠正为」提示
 *      · specToJson（源码视图/导出预览）含 category 与 quality
 *   B. 真加载：把 specToJson 的结果落成 mod.json，喂 new GameEngine({modsDir}).boot()，
 *      断言内容真进了 world.data（含英文别名被归一化）
 *
 * 纪律：不跑 tools/ 下任何写数据脚本；modsDir 用系统临时目录，不碰项目 mods/。
 *       沙箱里不 spawnSync（本脚本本来就不起子进程）。
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---------------- 最小 DOM stub（够跑 modmaker） ---------------- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '',
    className: '', id: '', type: '', style: {}, dataset: {}, _attrs: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const h = this.contains(c); const w = on === undefined ? !h : !!on; if (w) this.add(c); else this.remove(c); return w; },
    },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {},
    setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; }, removeAttribute(k) { delete this._attrs[k]; },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    focus() {}, blur() {}, click() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0, insertAdjacentHTML(p, h) { this._html += h; },
  };
  return el;
}
function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
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
    innerWidth: 1280, innerHeight: 800, screen: { width: 1280, height: 800 },
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null,
    /* modmaker 只会用到这几个 WXUI 方法 */
    WXUI: { toast() {}, confirmBox: async () => true, modal() {}, closeModal() {} },
    WXDOC: { makerTutorial: () => '<div>tutorial</div>' },
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}

/* ---------------- 真引擎（拿 meta / 做真校验） ---------------- */
const engine = new GameEngine({ seed: 20261010 });
engine.boot();
const META = engine.editorMeta();

(async function main() {

  /* ================================================================
   * A. 前端：真加载 app.js + modmaker.js
   * ================================================================ */
  section('A. 前端制作器（vm 真加载 app.js + modmaker.js）');
  const env = makeEnv();
  vm.createContext(env);
  for (const f of ['app.js', 'modmaker.js']) {
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  const WXMM = env.WXMM;
  ok('A-0 modmaker.js 加载成功并导出 WXMM', !!WXMM && typeof WXMM.open === 'function');

  /* 喂真元数据 + 真校验 */
  env.WX.api.editorMeta = async () => META;
  let validateCalls = 0;
  env.WX.api.editorValidate = async (spec) => { validateCalls++; return { report: engine.validateSpec(spec) }; };

  const spec = Object.assign(WXMM.blankSpec(), {
    id: 'mm_verify', name: '自验 Mod', desc: 'x', category: '功法',
    skills: [
      { id: 'k1', name: '测试剑', type: '剑', category: '外功', quality: 'rare', maxLevel: 120, damageMult: 1.5, accuracy: 10, mpCost: 5, desc: 'x', effects: [] },
      { id: 'k2', name: '英文槽位', type: 'sword', category: '外功', quality: 'common', maxLevel: 100, desc: 'x', effects: [] },
    ],
    items: [
      { id: 'i1', name: '测试剑', type: 'weapon', slot: '武器', quality: 'fine', price: 100, weight: 1, desc: 'x' },
      { id: 'i2', name: '英文部位', type: 'weapon', slot: 'weapon', price: 100, weight: 1, desc: 'x' },
    ],
  });
  WXMM.spec = spec;

  await WXMM.open();
  ok('A-1 open() 成功（读到元数据）', true);

  /* --- 武学下拉 --- */
  WXMM.tab('skills');
  const skHtml = env.document.getElementById('mm-content').innerHTML;
  const SLOTS = ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'];
  ok('A-2 ★ 武学类型下拉 = 中文十槽位',
    SLOTS.every(s => skHtml.indexOf('value="' + s + '"') >= 0),
    SLOTS.filter(s => skHtml.indexOf('value="' + s + '"') < 0).join(',') || '全部命中');
  const CATS = ['外功', '内功', '奇门', '旁门', '魔功'];
  ok('A-3 ★ 武学分类下拉 = 五大类',
    CATS.every(c => skHtml.indexOf('value="' + c + '"') >= 0),
    CATS.filter(c => skHtml.indexOf('value="' + c + '"') < 0).join(',') || '全部命中');
  const QS = [['worn', '粗劣'], ['common', '寻常'], ['fine', '精良'], ['rare', '珍稀'], ['epic', '绝世'], ['legend', '传说']];
  ok('A-4 ★ 新增「品级」下拉（六档，中文可见）',
    skHtml.indexOf('品级') >= 0 && QS.every(([v, l]) => skHtml.indexOf('value="' + v + '"') >= 0 && skHtml.indexOf('>' + l + '<') >= 0),
    '含品级字段=' + (skHtml.indexOf('品级') >= 0));
  ok('A-5 ★ 填了英文槽位 sword 时，表单给出大白话提示',
    skHtml.indexOf('不是合法槽位名') >= 0 && skHtml.indexOf('装不上任何槽位') >= 0,
    (skHtml.match(/.{0,6}不是合法槽位名.{0,10}/) || [''])[0]);

  /* --- 物品下拉 --- */
  WXMM.tab('items');
  const itHtml = env.document.getElementById('mm-content').innerHTML;
  ok('A-6 ★ 物品类型下拉显示中文（武器/丹药…），不再是英文码',
    itHtml.indexOf('>武器<') >= 0 && itHtml.indexOf('>丹药<') >= 0 && itHtml.indexOf('>weapon<') < 0 && itHtml.indexOf('>consumable<') < 0,
    (itHtml.match(/<option value="weapon"[^>]*>[^<]*<\/option>/) || [''])[0]);
  ok('A-7 物品也有「品级」下拉（不填按价格推断）',
    itHtml.indexOf('品级') >= 0 && itHtml.indexOf('不填按价格推断') >= 0);
  ok('A-8 物品「装备部位」下拉是中文槽位',
    itHtml.indexOf('value="武器"') >= 0 && itHtml.indexOf('value="身体"') >= 0);
  ok('A-15 ★ 抄来的英文部位（slot:weapon）也会在表单里被点名提醒',
    itHtml.indexOf('不是合法部位') >= 0 && itHtml.indexOf('游戏不认的槽位') >= 0,
    (itHtml.match(/.{0,6}不是合法部位.{0,12}/) || [''])[0]);

  /* --- specToJson：导出预览含 category / quality --- */
  const out = JSON.parse(WXMM.specToJson());
  const k1 = (out.skills || []).find(s => s.id === 'k1');
  const i1 = (out.items || []).find(x => x.id === 'i1');
  ok('A-9 ★ 导出预览（specToJson）里武学含 category 与 quality',
    !!k1 && k1.category === '外功' && k1.quality === 'rare',
    k1 ? JSON.stringify({ category: k1.category, quality: k1.quality }) : '缺 k1');
  ok('A-10 导出预览里物品也保留了 quality 与中文部位',
    !!i1 && i1.quality === 'fine' && i1.slot === '武器',
    i1 ? JSON.stringify({ quality: i1.quality, slot: i1.slot }) : '缺 i1');

  /* --- runValidate：真引擎校验，报告给中文提示 --- */
  const rep = await WXMM.runValidate(false);
  ok('A-11 runValidate 真调了 editorValidate', validateCalls >= 1 && !!rep, 'calls=' + validateCalls);
  ok('A-14 ★ 填好的表单不再被「幽灵错误」拦下（blankSpec 的 meta:{} 已去除）',
    !((rep && rep.errors) || []).some(e => /Mod ID 必须填写|请填写 Mod 名称/.test(e)),
    JSON.stringify((rep && rep.errors) || []));
  const warns = (rep && rep.warnings) || [];
  ok('A-12 ★ 校验报告里对「sword」给出中文「已纠正为剑」提示',
    warns.some(w => /sword/.test(w) && /纠正为/.test(w)),
    warns.find(w => /sword/.test(w)) || '(无)');
  WXMM.tab('report');
  const repHtml = env.document.getElementById('mm-content').innerHTML;
  ok('A-13 ★ 检查报告页把该提示显示给玩家（不是只在内存里）',
    repHtml.indexOf('纠正为') >= 0, repHtml.replace(/<[^>]+>/g, ' ').slice(0, 90));

  /* ================================================================
   * B. 真加载：specToJson 落盘 → new GameEngine({modsDir}) → world.data
   * ================================================================ */
  section('B. 真加载导出的 mod（独立临时 modsDir，不碰项目 mods/）');
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mmverify-'));
  const modsDir = path.join(tmpRoot, 'mods');
  const saveDir = path.join(tmpRoot, 'saves');
  const modDir = path.join(modsDir, 'mm_verify');
  fs.mkdirSync(modDir, { recursive: true });
  fs.writeFileSync(path.join(modDir, 'mod.json'), WXMM.specToJson(), 'utf8');

  const e2 = new GameEngine({ modsDir, saveDir, seed: 20261010 });
  e2.boot();
  e2.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  const w = e2.world;
  const got = w.data.skills['k1'];
  ok('B-1 ★ 导出的 mod 被真加载：武学 k1 进了 world.data',
    !!got, got ? JSON.stringify({ type: got.type, category: got.category, quality: got.quality }) : '未加载');
  ok('B-2 ★ 加载后 type 是中文槽位「剑」、category「外功」、quality「珍稀」',
    !!got && got.type === '剑' && got.category === '外功' && got.quality === 'rare',
    got ? [got.type, got.category, got.quality].join('/') : '—');
  const got2 = w.data.skills['k2'];
  ok('B-3 ★ 写成英文 sword 的武学，经加载归一化也变成「剑」（装得上槽位）',
    !!got2 && got2.type === '剑', got2 ? got2.type : '未加载');
  const gi = w.data.items['i1'];
  ok('B-4 ★ 物品 i1 进了 world.data 且部位/品级正确',
    !!gi && gi.slot === '武器' && gi.quality === 'fine',
    gi ? [gi.type, gi.slot, gi.quality].join('/') : '未加载');

  /* 真 enable：证明归一化后的武学真能装进槽位 */
  const p = w.player;
  p.learned['k1'] = { level: 1, exp: 0 };
  const r = e2.exec('enable 测试剑');
  ok('B-5 ★ `enable` 真把它装进「剑」槽（英文槽位时这步会失败）',
    p.equippedSkills['剑'] === 'k1',
    '剑=' + p.equippedSkills['剑'] + ' / ' + (r && r.lines || []).map(l => l.text).join(' ').slice(0, 60));

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) { /* ignore */ }

  console.log('\n' + '='.repeat(48));
  console.log(`  Mod 制作器自验：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('='.repeat(48));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('脚本异常：', e); process.exit(2); });
