/* ============================================================
 * button-audit.js —— 「点了按钮，到底出没出该出的东西」审计
 *
 * 主人 2026-10-11：「做完后看一下所有玩家能点击的按钮点击后实际效果是什么、
 *   和理应出现的功能效果是否对得上；点击后实际出现的内容与理应出现的内容是否对得上」。
 *
 * 三层查，缺一层就查不干净：
 *   A **静态映射**：按钮写的是哪条指令 / 哪个面板 —— 那个东西**存在吗**
 *      （`data-panel` 指向不存在的面板、`data-cmd` 指向没注册的指令 = 死按钮，
 *        点了什么都不会发生，而且**一个字都不报错**）
 *   B **真渲染**：把每个面板用真 ui.js 渲染一遍 —— 面板里**有没有内容**
 *      （空面板 = 按钮有效但结果为空，比死按钮更难发现）
 *   C **真执行**：把按钮要发的指令在后端真跑一遍 —— **是不是死按钮**
 *      （判据：响应里不许出现「是什么指令？」这句兜底文案）
 *
 * ⚠️ 三条纪律：
 *   ① 前端**本地拦截**的指令（面板名 / 退出）不算死按钮 —— 它们本来就不走后端；
 *   ② 样本里的 `data-cmd` 可能带模板参数（`look ${name}`）→ 只取**首词**判定；
 *   ③ 本脚本自带 **⓪ 守卫自证**：喂一条假指令，必须被抓住，否则整个脚本非 0 退出。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const RHTML = path.join(ROOT, 'game', 'src', 'renderer', 'index.html');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };

/* ================================================================
 *  DOM stub（够用就好；⚠️ 三坑照旧：querySelectorAll 按 (选择器, innerHTML) 缓存、
 *  innerHTML setter 清 children、doCmd 是 async）
 * ================================================================ */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], attrs: {}, style: {}, dataset: {},
    className: '', id: '', textContent: '', value: '', checked: false, disabled: false,
    onclick: null, oninput: null, onchange: null, onkeydown: null, parentNode: null,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); }, toggle(c, f) { if (f === undefined) f = !this._s.has(c); f ? this._s.add(c) : this._s.delete(c); } },
    get _html() { return this.__html || ''; },
    get innerHTML() { return this.__html || ''; },
    set innerHTML(v) { this.__html = String(v == null ? '' : v); this.children = []; },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; },
    hasAttribute(k) { return k in this.attrs; },
    removeAttribute(k) { delete this.attrs[k]; },
    appendChild(c) { this.children.push(c); if (c) c.parentNode = this; return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    insertBefore(c) { this.children.unshift(c); if (c) c.parentNode = this; return c; },
    addEventListener(t, fn) { if (t === 'click') this.onclick = fn; },
    removeEventListener() {}, focus() {}, blur() {}, select() {}, scrollIntoView() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20, right: 100, bottom: 20 }; },
    querySelector() { return null; },
    querySelectorAll(sel) {
      const key = String(sel);
      this.__qcache = this.__qcache || {};
      if (this.__qcache[key] && this.__qcache[key].__for === this.__html) return this.__qcache[key].list;
      const list = parseSelectors(this.__html || '', key);
      list.__for = this.__html;
      this.__qcache[key] = { __for: this.__html, list };
      return list;
    },
    click() { if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
  };
  return el;
}

/** 从 HTML 里扫出所有 `data-cmd` 的值。
 *  ⚠️ 一开始写了个「通用选择器解析器」，结果属性组抠出来是空串（静默失效），
 *     于是「面板里的按钮」一条都数不出来 —— 差点把这段审计变成永远绿的空转。
 *     这里改用**最笨也最不会错**的办法：直接扫属性。
 *     本项目所有 `data-cmd` 都是双引号写法，够用；带 `${}` 的模板不在此列（由调用方过滤）。 */
function collectDataCmd(html) {
  const out = [];
  const re = /data-cmd\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc,
    location: { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} },
    navigator: { userAgent: 'node-audit', language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl, Buffer,
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(String(s), 'base64').toString('binary'),
    btoa: s => Buffer.from(String(s), 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
const settle = () => new Promise(r => setImmediate(r));

(async () => {
  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});
  e.newGame({ name: '审计', birth: 'noble', gender: 'male' });
  const w = e.world, p = w.player;
  const CMD = (e.cmds && e.cmds.CMD) || {};
  const cmdNames = Object.keys(CMD);
  const VIEW = e.view({ map: false });

  /* ================================================================
   *  ⓪ 守卫自证：假指令必须被抓住
   * ================================================================ */
  console.log('===== ⓪ 守卫自证（判不出来就别信后面的绿） =====');
  const UNKNOWN = /是什么指令？/;
  {
    const r = await e.exec('zzz_not_a_command');
    const t = (r.lines || []).map(l => l.text).join('\n');
    ok('★ 哨兵：假指令一定会被「是什么指令？」抓住', UNKNOWN.test(t), t.slice(0, 40));
    const r2 = await e.exec('看');
    const t2 = (r2.lines || []).map(l => l.text).join('\n');
    ok('★ 哨兵：真指令不会被误判', !UNKNOWN.test(t2), t2.slice(0, 40));
  }

  /* ================================================================
   *  A. 静态映射
   * ================================================================ */
  console.log('===== A. 静态映射：按钮指向的东西存在吗 =====');
  const html = fs.readFileSync(RHTML, 'utf8');
  const uisrc = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');

  /* panel() 支持的面板名（从真源码抠） */
  const panelNames = new Set();
  {
    const re = /name === '([a-z_]+)'/g; let m;
    while ((m = re.exec(uisrc)) !== null) panelNames.add(m[1]);
  }
  ok('真扫到了面板名集合（≥15 个）', panelNames.size >= 15, panelNames.size + ' 个');
  /* 每个面板名都要有对应的渲染函数挂上去（不是空分支） */
  const emptyBranches = [];
  for (const n of panelNames) {
    const re = new RegExp("name === '" + n + "'[\\s\\S]{0,200}?html = ([A-Za-z_$][\\w$]*)");
    if (!re.test(uisrc)) emptyBranches.push(n);
  }
  ok('★ 每个面板名都接到了渲染函数（没有空分支）', emptyBranches.length === 0, emptyBranches.join(','));

  /* 前端本地拦截的指令（面板名 / 退出）——它们本来就不走后端，不算死按钮 */
  const env0 = makeEnv();
  vm.createContext(env0);
  vm.runInContext(fs.readFileSync(path.join(RJS, 'app.js'), 'utf8'), env0, { filename: 'app.js' });
  env0.WX.api.view = async () => ({ view: VIEW });
  env0.WX.api.markGuide = async () => ({ ok: true });
  env0.WX.api.exec = async () => ({ lines: [], view: VIEW });
  vm.runInContext(uisrc, env0, { filename: 'ui.js' });
  const UI = env0.WXUI;
  ok('ui.js 在桩环境里能加载', !!(UI && typeof UI.panel === 'function'));
  const isLocal = (cmd) => {
    const head = String(cmd || '').trim().split(/\s+/)[0];
    try {
      if (UI.panelForCmd(head)) return true;
      if (UI.isQuitCmd && UI.isQuitCmd(head)) return true;
    } catch (err) { /* ignore */ }
    return false;
  };

  /* A1：index.html 的 data-panel */
  const htmlPanels = [...new Set((html.match(/data-panel="([a-zA-Z_]+)"/g) || []).map(s => s.replace(/.*"([a-zA-Z_]+)"/, '$1')))];
  ok('index.html 里数得出侧栏/快捷条按钮（≥10 个）', htmlPanels.length >= 10, htmlPanels.length + ' 个');
  {
    const bad = htmlPanels.filter(n => !panelNames.has(n));
    ok('★ 侧栏/快捷条的每个 data-panel 都指向真面板', bad.length === 0, bad.join(','));
  }

  /* A2：PANEL_CMDS 的值 */
  {
    const cmds = [];
    /* ⚠️ 不能用 ^ 锚行首：原表一行挤好几条映射（map: 'map', 地图: 'map', …） */
    const re = /([A-Za-z0-9_一-龥]+):\s*'([a-z_]+)'/g;
    /* 直接从 PANEL_CMDS 段落里抠 */
    const seg = uisrc.slice(uisrc.indexOf('const PANEL_CMDS = {'), uisrc.indexOf('};', uisrc.indexOf('const PANEL_CMDS = {')));
    let m;
    while ((m = re.exec(seg)) !== null) cmds.push({ k: m[1], v: m[2] });
    ok('PANEL_CMDS 里数得出映射（≥80 条）', cmds.length >= 80, cmds.length + ' 条');
    const bad = cmds.filter(c => !panelNames.has(c.v));
    ok('★ 每条面板指令都指向真面板（指空气 = 死快捷键）', bad.length === 0, bad.slice(0, 8).map(c => c.k + '→' + c.v).join(','));
  }

  /* A3：data-cmd 字面量 */
  const allButtonCmds = new Set();
  const cmdsFromAll = [];
  for (const src of [html, uisrc]) {
    let m;
    const re = /data-cmd="([^"$]*?)"/g;
    while ((m = re.exec(src)) !== null) {
      const c = m[1].trim();
      /* 跳过模板拼接（${x} / ' + esc(it.cmd) + '）—— 那不是字面量指令 */
      if (c && !c.includes('${') && !c.includes("'") && !c.includes('+')) cmdsFromAll.push(c);
    }
  }
  const uniqCmds = [...new Set(cmdsFromAll)];
  /* 静态扫只能捡到**字面量**（模板拼接的那批捡不到）—— 这里只当「扫到了」的门槛，
     真正的全量在 B 段（从**真渲染出来的面板**里抠）。 */
  ok('静态扫到了按钮上的 data-cmd（≥5 条）', uniqCmds.length >= 5, uniqCmds.length + ' 条');
  {
    const dead = [];
    for (const c of uniqCmds) {
      const head = c.split(/\s+/)[0];
      if (isLocal(head)) continue;
      if (!CMD[head]) dead.push(c);
    }
    ok('★ 按钮发的每条指令后端都有注册（或前端本地拦截）', dead.length === 0, dead.slice(0, 10).join(' / '));
  }

  /* A4：NPC 交互动作 act 双向对齐 */
  console.log('===== A4. NPC 交互动作：后端发的 act，前端都认 =====');
  {
    /* 后端会发出的 act（真引擎产出） */
    const acts = new Set(), actCmds = [];
    const PROBE = [
      ['cy_pre_teaman', 'road_jiangnan_1'],       // 有 quests
      ['wudang_chongxu', null],                    // 掌门（有 teach/quests）
      ['cy_xy_gate_1', 'xiangyang_gate'],          // 官差（报告/领差事）
      ['old_herbalist', null],                     // 医者/悬赏
    ];
    const sample = PROBE.filter(x => w.data.npcs[x[0]]);
    /* 再补几个有 shop / boatman / escort 的 */
    for (const id of Object.keys(w.data.npcs)) {
      const d = w.data.npcs[id];
      if (sample.length >= 14) break;
      if (d.shop || d.tag === 'boatman' || d.tag === 'escort' || d.tag === 'doctor' || d.teach) {
        if (!sample.some(s => s[0] === id)) sample.push([id, null]);
      }
    }
    ok('取到了足够多的交互样本 NPC（≥6 个）', sample.length >= 6, String(sample.length));
    for (const [id] of sample) {
      const def = w.data.npcs[id];
      const room = def.room || p.room;
      const r = await e.exec('go ' + ((w.getRoom(room) || {}).name || room));
      p.room = room;
      w.spawnNpc(id, room, 1, true);
      const out = await e.exec('look');
      for (const l of (out.lines || [])) {
        for (const h of (l.hl || [])) {
          for (const a of (h.actions || [])) {
            /* ⚠️ 只收**带 act 的**——那是 NPC 交互菜单项。
               房间/物品的 hl 项走的是 room action 通词（如「采药 寒玉床」），
               它们由 questKeyword / selfSuffRoomAction 处理，**不是注册指令**。
               把它们当指令审 = 假红。 */
            if (!a.act) continue;
            acts.add(a.act);
            if (a.cmd) actCmds.push(a.cmd);
          }
        }
      }
      void r;
    }
    ok('后端真产出了交互动作（≥6 条）', actCmds.length >= 6, actCmds.length + ' 条，act=' + [...acts].join(','));
    /* 前端认不认这些 act：ui.js 里必须有对应分支 */
    const missing = [...acts].filter(a => uisrc.indexOf("'" + a + "'") < 0);
    ok('★ 后端发的每个 act，前端源码里都能找到认它的地方', missing.length === 0, missing.join(','));
    /* 这些 cmd 必须真能跑 */
    const dead = [];
    for (const c of [...new Set(actCmds)]) {
      const head = c.split(/\s+/)[0];
      if (isLocal(head)) continue;
      if (!CMD[head]) dead.push(c);
    }
    ok('★ 交互动作的指令后端都注册了', dead.length === 0, dead.slice(0, 8).join(' / '));
    global.__ACT_CMDS = [...new Set(actCmds)];
  }

  /* ================================================================
   *  B. 真渲染每个面板
   * ================================================================ */
  console.log('===== B. 真渲染：每个面板点开有没有东西 =====');
  const panelHtml = {};
  const renderedCmds = [];
  {
    const empty = [], badCmd = [], thin = [];
    for (const name of [...panelNames].sort()) {
      const env = makeEnv();
      vm.createContext(env);
      vm.runInContext(fs.readFileSync(path.join(RJS, 'app.js'), 'utf8'), env, { filename: 'app.js' });
      env.WX.api.view = async () => ({ view: VIEW });
      env.WX.api.markGuide = async () => ({ ok: true });
      env.WX.api.exec = async () => ({ lines: [], view: VIEW });
      env.WX.S.view = VIEW;
      vm.runInContext(uisrc, env, { filename: 'ui.js' });
      try {
        await env.WXUI.panel(name);
        await settle();
      } catch (err) {
        empty.push(name + '(渲染抛错:' + err.message.slice(0, 30) + ')');
        continue;
      }
      const body = env.document.getElementById('modal-body');
      const h = String((body && body.innerHTML) || '');
      panelHtml[name] = h;
      if (!h) empty.push(name + '(空 HTML)');
      /* ⚠️ 空面板本来就短（「暂无状态效果」）—— 标志是**一个字都没有**，不是短。
         真正的空是「连占位文案都没有」。 */
      else if (h.replace(/<[^>]*>/g, '').trim().length < 4) thin.push(name + '(' + h.length + ' 字节)');
      /* 面板里出现的按钮指令也要真 */
      const btns = collectDataCmd(h);
      for (const raw of btns) {
        const c = String(raw).trim();
        if (!c || c.includes('${')) continue;
        renderedCmds.push(c);
        const head = c.split(/\s+/)[0];
        if (isLocal(head)) continue;
        if (!CMD[head]) badCmd.push(name + ' → ' + c);
      }
    }
    ok('★ 每个面板都能真渲染出非空内容', empty.length === 0, empty.join(','));
    ok('★ 面板内容都不是「一个字都没有」', thin.length === 0, thin.join(','));
    {
      const rich = Object.keys(panelHtml).filter(n => panelHtml[n].replace(/<[^>]*>/g, '').trim().length >= 40);
      ok('★ 多数面板渲染出了实打实的内容（≥12 个面板有 40+ 字）', rich.length >= 12, rich.length + ' 个');
    }
    ok('★ 面板里的按钮指令后端都注册了', badCmd.length === 0, badCmd.slice(0, 10).join(' / '));
    /* 面板不该把 undefined / NaN 漏进 HTML */
    const dirty = Object.keys(panelHtml).filter(n => /undefined|NaN/.test(panelHtml[n]));
    ok('★ 面板 HTML 里没有 undefined / NaN 漏出', dirty.length === 0, dirty.join(','));
    /* 全量按钮指令 = 静态字面量 ∪ **真渲染出来的** */
    for (const c of renderedCmds) allButtonCmds.add(c);
    ok('★ 全量按钮指令 ≥12 条（静态 ∪ 真渲染）', allButtonCmds.size >= 12, allButtonCmds.size + ' 条');
    console.log('  · 真渲染面板 ' + Object.keys(panelHtml).length + ' 个，抠出按钮指令 ' + new Set(renderedCmds).size + ' 条');
  }

  /* ================================================================
   *  C. 真执行：按钮指令在后端真有反应
   * ================================================================ */
  console.log('===== C. 真执行：点下去真有反应吗 =====');
  {
    /* 单独一局，免得把上面那局的状态搅了 */
    const e2 = new GameEngine({ seed: 777 });
    await e2.boot({});
    e2.newGame({ name: '试', birth: 'noble', gender: 'male' });
    const w2 = e2.world, p2 = w2.player;
    p2.room = 'jiangnan_street';
    /* 把几个关键 NPC 放到玩家面前，让带参指令有活人可点 */
    for (const id of ['cy_pre_teaman', 'wudang_chongxu', 'cy_xy_gate_1']) {
      if (w2.data.npcs[id]) w2.spawnNpc(id, p2.room, 1, true);
    }
    const allCmds = [...new Set([].concat([...allButtonCmds], global.__ACT_CMDS || []))];
    const silent = [], unknownHit = [];
    for (const c of allCmds) {
      const head = c.split(/\s+/)[0];
      if (isLocal(head)) continue;
      if (!CMD[head]) continue;   // A 段已经报过
      let r;
      try { r = await e2.exec(c); }
      catch (err) { silent.push(c + '（抛错:' + err.message.slice(0, 24) + '）'); continue; }
      const lines = (r && r.lines) || [];
      const t = lines.map(l => l.text || '').join('\n');
      if (UNKNOWN.test(t)) { unknownHit.push(c); continue; }
      if (!lines.length) silent.push(c + '（一行都没回）');
    }
    ok('★ 按钮指令没有一条会命中「是什么指令？」', unknownHit.length === 0, unknownHit.slice(0, 8).join(' / '));
    ok('★ 按钮指令没有一条「一声不吭」（无回显 = 点了像没反应）', silent.length === 0, silent.slice(0, 8).join(' / '));
    console.log('  · 实跑指令 ' + allCmds.length + ' 条');
  }

  /* ================================================================
   *  D. 本轮新增的按钮/面板专项
   * ================================================================ */
  console.log('===== D. 本轮新增入口专项 =====');
  {
    /* ⚠️ 交互菜单项是**后端** commands.js 组装的（hl[].actions），不在 ui.js —— 找错文件就是假红。 */
    const cmdsrc = fs.readFileSync(path.join(ROOT, 'game/src/core/commands.js'), 'utf8');
    ok('★ 官差菜单里有「报信」', cmdsrc.indexOf("label: '报信'") >= 0);
    ok('★ 官差菜单里有「领差事」', cmdsrc.indexOf("label: '领差事'") >= 0);
    ok('★ 任务面板会显示「还没到时候」（前置锁）', uisrc.indexOf('q-lock') >= 0);
    ok('★ 行囊面板仍叫「行囊」', html.indexOf('行囊') >= 0);
    const v = e.view({ map: false });
    ok('★ 状态面板能读到主线线别', !!(v.player && v.player.mainline && v.player.mainline.lineName), JSON.stringify(v.player && v.player.mainline));
  }

  console.log('');
  console.log('按钮审计：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
