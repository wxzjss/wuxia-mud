/**
 * modscript.js — Mod 沙箱脚本（mod 目录下的 `script.js`）
 *
 * ============================ 为什么会有这个文件 ============================
 * `modloader.readModDir` 早就在算 `hasScript`（`fs.existsSync(dir/script.js)`），
 * 文档、加载器头注释、玩家看到的「高级 Mod」标签都在说「script.js 沙箱执行」，
 * **可是没有任何一处真的读它、更没有执行入口** —— 作者把功法/事件全写在 script.js 里，
 * 装上去以后整个世界毫无变化，也不报错。这正是本项目最忌的「不报错就是不生效」。
 *
 * 于是补上这一环：`world.loadMods()` 里把 script.js 读出来、在隔离沙箱里跑，
 * 它注册的东西（事件处理器 / 新指令）从此真的会响。
 *
 * ============================== 隔离边界 ==============================
 * 用 `node:vm` 的 `createContext` + `codeGeneration:{strings:false, wasm:false}`：
 *   · 上下文里**没有** require / process / Buffer / global / setTimeout / fetch，
 *     所以脚本碰不到文件系统、网络、进程、定时器；
 *   · 关掉字符串代码生成 = `eval` 与 `new Function` 都不可用，
 *     把「`this.constructor.constructor('return process')()`」这类经典逃逸堵掉；
 *   · 顶层执行与**每一次**派发都带墙钟超时（`timeout`），死循环会被中断而不是挂住服务。
 * ⚠️ 说清楚定位：这是**防误伤的安全网**，不是对抗恶意代码的硬边界
 *    （vm 不是安全沙箱，Node 官方文档原话也是这个意思）。
 *    mod 是玩家自己选择装的，目标人群是「会写点 JS 的玩家」，不是攻击者。
 *
 * ============================== 作者 API（全局 `wx`） ==============================
 *   wx.version            沙箱 API 版本（字符串）
 *   wx.mod                { id, name }
 *   wx.log(msg)           写进「Mod 日志」，排错用
 *   wx.state              **随存档保存**的键值对象（存在玩家 p.vars 里，读档还在）
 *   wx.on(event, fn)      注册事件处理器。event 见 EVENTS；fn(payload) 可返回字符串/数组
 *   wx.command(name, fn)  注册新指令（**不能覆盖内置指令**，撞名会被明确拒绝并记日志）
 *   wx.msg(text)          立刻往玩家屏幕加一行（也可以直接 return）
 *   wx.me()               { name, room, roomName, money, hp, maxHp, mp, maxMp, potential, realm }
 *   wx.here()             { items:[名字…], npcs:[名字…] }
 *   wx.has(id) / wx.count(id)
 *   wx.flag(name) / wx.setFlag(name, on)
 *   wx.get(name) / wx.set(name, v)       玩家变量（p.vars）
 *   wx.give(itemId, n) / wx.money(n) / wx.pot(n) / wx.hp(n) / wx.recover(n)
 *   wx.go(roomId)         换房间（走世界唯一的移动收敛点）
 *   wx.rng() / wx.chance(p)
 *   wx.emit(text|lines)   同 wx.msg，可一次给多行
 *
 * 返回值约定（事件与指令通用）：字符串 → 一行普通文本；数组 → 多行；
 * 对象 `{ text, kind }` 里的 kind 只认下面 LINES_KINDS 里的值，别的会被降级成 plain。
 *
 * ============================== 一个最小例子 ==============================
 *   // script.js
 *   wx.command('摸鱼', function () {
 *     if (wx.chance(0.3)) return '你摸了一炷香的鱼，被师父逮个正着。';
 *     wx.money(3);
 *     return '你摸了一炷香的鱼，顺手捡到三文钱。';
 *   });
 *   wx.on('onKill', function (p) { return '（Mod）' + p.npcName + '倒下了。'; });
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** 沙箱 API 版本 —— 改 API 时同步 +0.1，作者可以据此判断兼容性 */
const API_VERSION = '1.0';

/** 顶层执行 / 每次派发的墙钟上限（毫秒）。选 200 是因为它远大于正常脚本，
 *  又远小于玩家能忍受的卡顿；超时会被 vm 直接中断。 */
const TIMEOUT_MS = 200;

/** 同一个脚本累计超时到这个次数，就把它的**自动派发**停掉（指令仍可用）。
 *  理由：事件在 onTick 上会被反复触发，一个死循环脚本能每次都卡 200ms，
 *  加起来就是「游戏越来越卡」——必须有个自限开关。 */
const MAX_TIMEOUTS = 3;

/** 单个脚本最多注册多少事件处理器 / 自定义指令（防止脚本里写循环注册把内存吃光） */
const MAX_EVENTS = 64;
const MAX_COMMANDS = 64;

/** 允许派发的事件名。
 *  ⚠️ 这里**只能列引擎真的会 fireEvent 的名字** —— 列一个不会触发的进去，
 *     作者 wx.on 上去就永远等不到（又一个静默失效）。
 *     清单来源：`grep -rn "fireEvent(" game/src/core/`，改这里前先重新 grep。 */
const EVENTS = ['onTick', 'onDayTick', 'onKill', 'onLevelUp', 'onEnter', 'onHeal',
  'onRumorBorn', 'onKinsmanWitness'];

/** 合法的行类型（与前端 paintLog 认的 kind 对齐，见 ui.js） */
const LINES_KINDS = ['plain', 'sys', 'warn', 'say', 'story', 'narrate', 'success', 'sub', 'subtitle', 'menu'];

/** 沙箱里那份「派发器」。**必须是上下文内定义的脚本**，
 *  不能是宿主函数 —— 只有让 vm 去跑它，才能让 `timeout` 对处理器里的死循环生效。
 *
 *  ⚠️ 注册表读的是宿主注入的 `__wxEvents` / `__wxCommands`
 *     （由 `_buildApi` 里的 `wx.on` / `wx.command` 写入），
 *     **不是**在上下文里再建一份。早先这里写过 `var __wxH = {...}`，
 *     结果宿主与沙箱各记一份：`wx.command` 存进宿主那份、`__wxRun` 去沙箱那份里找，
 *     指令注册「成功」了却永远查不到处理器 —— 玩家敲下去只有一句「没有输出」。 */
const BOOTSTRAP = `
/* ---- 先拆掉「逃逸梯子」 ----
   新建的上下文里，脚本能顺着 \`this.constructor.constructor('return process')()\`
   摸到**宿主**的 Function —— 拿到它就等于拿到 require / process / fs，
   沙箱当场变成摆设（实测确实能拿到，不是理论问题）。
   已知的几条梯子全拆掉：
     · Object.prototype.constructor      （this.constructor / ({ }).constructor）
     · Object.prototype.__proto__         （绕道去摸原型链）
     · Function.prototype.constructor     （(function(){}).constructor）
     · async / generator 函数原型的 constructor（它们的构造器是另一族 Function）
   ⚠️ 这几条必须 **delete**，不能「赋值成 undefined」——
      实测赋值不生效（那几处是只读/非可配置的组合），delete 才真的摘得掉。
   再叠上两样：创建上下文时的 \`codeGeneration:{strings:false}\`（直接 eval / new Function 被禁），
   以及宿主侧那句 \`Object.setPrototypeOf(sandbox, null)\`（断掉链到宿主原型的那一环）。
   ⚠️ 只拆这几样，其余内置原样留着 —— 删多了，作者正常的脚本会莫名其妙炸。 */
(function () {
  try { delete Object.prototype.constructor; } catch (e) {}
  try { delete Object.prototype.__proto__; } catch (e) {}
  try { delete Function.prototype.constructor; } catch (e) {}
  try { delete Object.getPrototypeOf(async function () {}).constructor.prototype.constructor; } catch (e) {}
  try { delete Object.getPrototypeOf(function* () {}).constructor.prototype.constructor; } catch (e) {}
  try { delete Object.getPrototypeOf(async function* () {}).constructor.prototype.constructor; } catch (e) {}
})();
function __wxRun(kind, name, payload) {
  if (kind === 'command') {
    var fn = __wxCommands[name];
    if (typeof fn !== 'function') return null;
    return fn(payload);
  }
  var list = __wxEvents[name] || [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var r = list[i](payload);
    if (r !== undefined && r !== null) out.push(r);
  }
  return out;
}
`;

/* ------------------------------------------------------------------ *
 * 返回值归一化
 * ------------------------------------------------------------------ */
function toLine(x) {
  if (x === undefined || x === null) return null;
  const t = typeof x;
  if (t === 'string') return x.trim() ? { kind: 'plain', text: x } : null;
  if (t === 'number' || t === 'boolean') return { kind: 'plain', text: String(x) };
  if (t !== 'object') return null;
  if (Array.isArray(x)) return null;                 /* 交给调用方展开，别当成一个对象 */
  const text = x.text !== undefined ? x.text : (x.msg !== undefined ? x.msg : x.line);
  const kind = LINES_KINDS.indexOf(x.kind) >= 0 ? x.kind : 'plain';
  /* ⚠️ 一律**拷进新对象**：沙箱对象带的是另一个 realm 的 prototype，
     直接塞给前端/日志会出现 `instanceof` 判不动之类的怪事。 */
  if (text === undefined || text === null) {
    /* menu 这种「没有正文只有选项」的行允许没有 text */
    return kind === 'menu' ? Object.assign({}, x, { kind }) : null;
  }
  return Object.assign({}, x, { kind, text: String(text) });
}

function normalizeOut(raw) {
  if (raw === undefined || raw === null) return [];
  const out = [];
  const push = (v) => {
    if (Array.isArray(v)) { v.forEach(push); return; }
    const l = toLine(v);
    if (l) out.push(l);
  };
  push(raw);
  return out;
}

class ModScript {
  /**
   * @param {World} world
   * @param {object} mod   modloader 造出来的 mod 记录（要 .id / .name / .dir）
   * @param {string} code  script.js 源码
   */
  constructor(world, mod, code) {
    this.world = world;
    this.id = (mod && (mod.id || mod.name)) || 'unknown_mod';
    this.name = (mod && mod.name) || this.id;
    this.code = String(code || '');
    this.ready = false;
    this.disabled = false;        /* 超时太多 → 停掉自动派发 */
    this.timeouts = 0;
    this.error = null;
    /** 已注册的事件名 → 处理器个数（宿主侧记账，用于「没人监听就零开销」快路径） */
    this.events = {};
    /** 已注册的自定义指令名 → true */
    this.scriptCommands = {};
    this._lines = null;           /* wx.msg 的缓冲（每次派发一换） */
    this._depth = 0;
  }

  _log(level, msg) {
    const w = this.world;
    if (!w) return;
    w.modLog = w.modLog || [];
    w.modLog.push({ level, mod: this.id, msg: String(msg) });
  }

  /* ---------------------------------------------------------------- *
   * 加载
   * ---------------------------------------------------------------- */
  load() {
    const self = this;
    /* 宿主侧的两个「注册槽」：wx.on / wx.command 往里写，
       沙箱里的 __wxRun 读它们。（直接写沙箱内的 __wxH 也行，
       但宿主对象跨上下文读更稳，也不依赖 var 提升的时机。） */
    const reg = { events: {}, commands: {} };

    const sandbox = {
      wx: this._buildApi(reg),
      /* 给作者一个 console.log 的替身：直接进 Mod 日志，别污染服务端 stdout */
      console: {
        log: (...a) => self._log('info', a.map(x => self._fmt(x)).join(' ')),
        warn: (...a) => self._log('warn', a.map(x => self._fmt(x)).join(' ')),
        error: (...a) => self._log('error', a.map(x => self._fmt(x)).join(' ')),
      },
      __wxEvents: reg.events,
      __wxCommands: reg.commands,
    };

    let ctx;
    try {
      /* ⚠️ 这一行是**堵逃逸梯子**的关键，别删：
         `vm.createContext(sandbox)` 造出来的那个 global，其原型链会接到**宿主**的
         Object.prototype 上 —— 于是脚本里 `this.constructor.constructor`
         直接摸到宿主的 Function，`Function('return process')()` 就把整个进程端走了。
         （实测过：不堵这一下，逃逸探针真的能拿到 process 与 pid。）
         把 sandbox 的原型设成 null，链子在这一环断掉。
         剩下几环（Object/Function/async/generator 原型的 constructor）由 BOOTSTRAP 拆。 */
      Object.setPrototypeOf(sandbox, null);
      ctx = vm.createContext(sandbox, {
        name: 'wxmod:' + this.id,
        codeGeneration: { strings: false, wasm: false },
      });
    } catch (e) {
      this.error = String((e && e.message) || e);
      this._log('error', `脚本沙箱创建失败：${this.error}`);
      return false;
    }
    this.ctx = ctx;
    this._reg = reg;
    this._dispatch = new vm.Script('__wxRun(__wxK, __wxN, __wxIn)', { filename: 'wxmod:dispatch@' + this.id });

    try {
      new vm.Script(BOOTSTRAP, { filename: 'wxmod:bootstrap@' + this.id })
        .runInContext(ctx, { timeout: TIMEOUT_MS });
      new vm.Script(this.code, { filename: 'script.js@' + this.id })
        .runInContext(ctx, { timeout: TIMEOUT_MS });
    } catch (e) {
      const timedOut = /timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(String(e && e.message));
      this.error = timedOut ? `执行超时（超过 ${TIMEOUT_MS}ms，可能是模块级死循环）`
        : String((e && e.message) || e);
      this._log('error', `script.js 加载失败：${this.error}`);
      return false;
    }

    this.ready = true;
    /* 指令注册**放在加载成功之后**：脚本中途抛错就整块不落地，不留半套指令。 */
    const names = Object.keys(reg.commands);
    for (const n of names) this.scriptCommands[n] = true;
    if (names.length) {
      this._log('info', `注册了 ${names.length} 条自定义指令：${names.join(' / ')}`);
    }
    const evs = Object.keys(reg.events).filter(k => (reg.events[k] || []).length);
    if (evs.length) this._log('info', `监听了事件：${evs.join(' / ')}`);
    if (!names.length && !evs.length) {
      /* 跑通了、但什么都没注册 —— 这种要明确说出来，否则作者会以为「装了没反应」。 */
      this._log('warn', 'script.js 跑完了，但既没有 wx.command 也没有 wx.on —— 这个脚本不会产生任何效果。');
    }
    return true;
  }

  _fmt(x) {
    if (typeof x === 'string') return x;
    try { return JSON.stringify(x); } catch (e) { return String(x); }
  }

  /* ---------------------------------------------------------------- *
   * 派发
   * ---------------------------------------------------------------- */
  /** 有没有人在监听这个事件（快路径：没监听就直接跳过，onTick 上零开销） */
  listens(name) {
    return !!(this.events[name] && this.events[name] > 0);
  }

  /**
   * 触发事件处理器。
   * @returns {Array<{kind,text}>} 归一化后的行（空数组 = 无输出）
   */
  emit(name, payload) {
    if (!this.ready || this.disabled || !this.listens(name)) return [];
    return this._call('event', name, payload);
  }

  /**
   * 跑一条自定义指令。
   * @returns {Array<{kind,text}>}
   */
  runCommand(name, payload) {
    if (!this.ready || !this.scriptCommands[name]) return null;
    /* 超时太多次 → 连指令也停掉。不拦的话，一条 `while(true)` 的指令
       每次被敲都白卡玩家 200ms，玩家只会觉得「这游戏越来越卡」。 */
    if (this.disabled) {
      return [{ kind: 'warn', text: `（Mod「${this.id}」的脚本多次超时，已被停用。）` }];
    }
    return this._call('command', name, payload);
  }

  _call(kind, name, payload) {
    if (this._depth >= 4) return [];      /* 指令 → 移动 → onEnter → 指令…… 的递归护栏 */
    const prev = this._lines;
    this._lines = [];
    this._depth++;
    const ctx = this.ctx;
    ctx.__wxK = kind;
    ctx.__wxN = name;
    ctx.__wxIn = payload;
    let raw = null;
    try {
      raw = this._dispatch.runInContext(ctx, { timeout: TIMEOUT_MS });
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/timed out|ERR_SCRIPT_EXECUTION_TIMEOUT/i.test(msg)) {
        this.timeouts++;
        if (this.timeouts >= MAX_TIMEOUTS) {
          this.disabled = true;
          this._log('error', `脚本超时 ${this.timeouts} 次，已**停掉它的自动派发**（自定义指令仍可用）。`
            + `多半是 ${kind}「${name}」里有个死循环。`);
        } else {
          this._log('error', `脚本在 ${kind}「${name}」里超时（>${TIMEOUT_MS}ms），本次已中断。`);
        }
      } else {
        this._log('error', `${kind}「${name}」出错：${msg}`);
      }
    } finally {
      this._depth--;
    }
    const buf = this._lines;
    this._lines = prev;
    return buf.concat(normalizeOut(raw));
  }

  /* ---------------------------------------------------------------- *
   * 给作者的 API
   * ---------------------------------------------------------------- */
  _player() { return this.world && this.world.player; }

  /** 随档保存的键值对象：挂在玩家 `p.vars` 下（serialize 已经带 vars，不用改存档格式） */
  _state() {
    const p = this._player();
    if (!p) return {};
    p.vars = p.vars || {};
    const key = '__mod_' + this.id;
    if (!p.vars[key] || typeof p.vars[key] !== 'object') p.vars[key] = {};
    return p.vars[key];
  }

  _buildApi(reg) {
    const self = this;
    const world = () => self.world;
    const P = () => self._player();
    const out = (v) => { if (self._lines) self._lines.push(...normalizeOut(v)); };

    const api = {
      version: API_VERSION,
      mod: { id: this.id, name: this.name },

      log(msg) { self._log('info', String(msg)); return true; },

      /* wx.state 是**取值器**：开局前 / 读档中也能安全拿到一个空对象 */
      get state() { return self._state(); },

      on(ev, fn) {
        const name = String(ev || '').trim();
        if (!name) { self._log('error', 'wx.on：事件名不能为空'); return false; }
        if (typeof fn !== 'function') { self._log('error', `wx.on(${name})：第二个参数必须是函数`); return false; }
        if (EVENTS.indexOf(name) < 0) {
          /* 不认识的 event 名 = 永远不会触发的静默坑，这里明确说出来 */
          self._log('warn', `wx.on：「${name}」不是引擎会派发的事件，永远不会触发。可用：${EVENTS.join(' / ')}`);
          return false;
        }
        const list = reg.events[name] || (reg.events[name] = []);
        if (list.length >= MAX_EVENTS) { self._log('error', `wx.on(${name})：处理器数量超过上限 ${MAX_EVENTS}`); return false; }
        list.push(fn);
        self.events[name] = list.length;
        return true;
      },

      command(name, fn) {
        const n = String(name || '').trim().split(/\s+/)[0];
        if (!n) { self._log('error', 'wx.command：指令名不能为空'); return false; }
        if (typeof fn !== 'function') { self._log('error', `wx.command(${n})：第二个参数必须是函数`); return false; }
        if (Object.keys(reg.commands).length >= MAX_COMMANDS) {
          self._log('error', `wx.command：自定义指令数量超过上限 ${MAX_COMMANDS}`); return false;
        }
        if (reg.commands[n]) { self._log('warn', `wx.command：「${n}」重复注册，后面的覆盖前面的`); }
        reg.commands[n] = fn;
        return true;
      },

      msg(text) { out(text); return true; },
      emit(text) { out(text); return true; },

      /* ---- 看 ---- */
      me() {
        const p = P();
        if (!p) return null;
        const r = world().getRoom(p.room) || {};
        return {
          name: p.name, room: p.room, roomName: r.name || '',
          money: p.money, hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
          potential: p.potential, food: p.food, water: p.water, karma: p.karma,
        };
      },
      here() {
        const p = P();
        if (!p) return { items: [], npcs: [] };
        const w = world();
        const nm = (id) => { const d = w.getItem(id); return (d && d.name) || id; };
        return {
          items: w.itemsIn(p.room).map(i => nm(i.itemId)),
          npcs: w.npcsIn(p.room).map(n => n.name),
        };
      },
      has(itemId) { const p = P(); return p ? p.countItem(String(itemId)) > 0 : false; },
      count(itemId) { const p = P(); return p ? p.countItem(String(itemId)) : 0; },
      flag(name) { const p = P(); return p ? !!p.hasFlag(String(name)) : false; },
      get(name) { const p = P(); return p ? p.getVar(String(name)) : undefined; },
      realm() {
        const p = P();
        if (!p) return 0;
        let sum = 0;
        for (const k of Object.keys(p.learned || {})) sum += (p.learned[k] && p.learned[k].level) || 0;
        return sum;
      },
      rng() { return world().rng.next(); },
      chance(p) { return world().rng.chance(Number(p) || 0); },

      /* ---- 改 ---- */
      give(itemId, n) {
        const p = P();
        if (!p) return false;
        const r = world().giveItem(p, String(itemId), Number(n) || 1);
        return !!(r && r.ok);
      },
      money(n) { const p = P(); if (!p) return false; p.money += Number(n) || 0; return true; },
      pot(n) { const p = P(); if (!p) return false; p.gainPotential(Number(n) || 0); return true; },
      hp(n) { const p = P(); if (!p) return false; p.hp = Math.max(0, Math.min(p.maxHp, p.hp + (Number(n) || 0))); return true; },
      recover(n) { return api.hp(n); },
      setFlag(name, on) { const p = P(); if (!p) return false; p.setFlag(String(name), on === undefined ? true : on); return true; },
      set(name, v) { const p = P(); if (!p) return false; p.setVar(String(name), v); return true; },
      go(roomId) {
        const p = P();
        if (!p) return false;
        const r = world().movePlayerTo(p, String(roomId));
        return !!(r && r.ok);
      },
    };
    return api;
  }
}

/* ------------------------------------------------------------------ *
 * 对外入口
 * ------------------------------------------------------------------ */

/**
 * 读一个 mod 目录下的 script.js 并跑起来。
 * @returns {ModScript|null}  没有脚本文件就返回 null（不算错误）
 */
function loadModScript(world, mod) {
  if (!mod || !mod.dir) return null;
  const fp = path.join(mod.dir, 'script.js');
  if (!fs.existsSync(fp)) return null;
  let code = '';
  try {
    code = fs.readFileSync(fp, 'utf8');
  } catch (e) {
    world.modLog = world.modLog || [];
    world.modLog.push({ level: 'error', mod: mod.id || 'unknown_mod', msg: `script.js 读取失败：${e.message}` });
    return null;
  }
  const s = new ModScript(world, mod, code);
  s.load();
  return s;
}

module.exports = { ModScript, loadModScript, API_VERSION, EVENTS, TIMEOUT_MS, normalizeOut };
