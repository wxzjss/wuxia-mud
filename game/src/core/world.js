/**
 * world.js — 世界引擎
 *
 * 职责：
 *  - 加载基础数据 + 所有已启用的 Mod（合并成一份世界数据）
 *  - 掌管房间、NPC 实例、物品、武学、门派、任务、区域、事件
 *  - 提供所有对外操作 API（给 UI / 脚本 / mod 调用）
 *  - 拥有随机数源、时间、天气、声音、战斗引擎
 *
 * 高自由度：
 *  - data 里的一切都能被 mod 增/改/删
 *  - effectFns / condFns / customEffects / combatHooks 允许 mod 注入逻辑
 *  - 任何操作都发事件 emit()，mod 可监听
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const { RNG, deepMerge, clone, fmtTime, shichen, fuzzyFind, clamp, uid } = require('./utils');
const { Character } = require('./character');
const { CombatEngine, DEFAULT_HOOKS, DRAW_TURNS } = require('./combat');
const { evalCond, evalEffects, evalTemplate } = require('./modapi');

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

/* B23：传闻算出来的声望要不要乘一个刻度（见 applyRumorReputation 的注释）。
   8 是把「一次恶行」抬到人类尺度的那一档：杀成名人物 ≈ −20，杀良 ≈ −30。 */
const REP_SCALE = 8;

/* 单间客栈饭点最多容纳多少人，超出的 NPC 留在原处（饭点只是一部分人去吃饭） */
const EATERY_CAP = 24;
/** 名人（A 层 / 有 unique 标记）全图只应存在一个实例，且不去别处吃饭 */
function isCelebrity(def) {
  return !!(def && (def.unique === true || def.tier === 'A'));
}

/** 「定岗」NPC：某个房间的 respawn 点名要的（城门守卫、黑市老板…）。
 *  语义 = 岗位就在那儿，不该被作息/饭点挪走 —— 挪走岗位就空，
 *  respawn 又补一个，最后守门的和吃饭的是三个人（×3）。
 *  ⚠️ 必须排除名人：名人的 respawn 只是「保证他有戏」，
 *     他们本来就该按 schedule 日出在山门、日落回家，不能钉死在岗位。
 *  600 多个房间每 tick 都扫一遍太贵，扫一次缓存起来（地图不变则不重扫）。 */
function isStationed(world, defId) {
  if (isCelebrity(world.data.npcs[defId])) return false;
  if (!world._stationedSet) {
    const s = new Set();
    for (const rid of Object.keys(world.data.rooms)) {
      const rs = world.data.rooms[rid].respawn;
      if (!rs) continue;
      for (const x of [].concat(rs)) {
        if (x && x.npc && !isCelebrity(world.data.npcs[x.npc])) s.add(x.npc);
      }
    }
    world._stationedSet = s;
  }
  return world._stationedSet.has(defId);
}

const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const WEATHERS = ['晴', '阴', '雨', '雪', '风', '雾'];
/* 随机游走只走平面八向（u/d 是楼梯、in/out 是门，不算「溜达」）——见 worldTick */
const HORIZ_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/* 把运行时实例（Character / 物品）压成纯数据，剥掉 world / 循环引用，
   存档才能 JSON.stringify。恢复时由 deserialize 重新挂回 world。 */
/* 'def' 也必须丢：npc.def 指向 data.npcs[defId] 的模板对象，
   每个实例都存一份 = 320 份模板副本进存档（实测 30 个 NPC 就占 105KB）。
   模板不随档变，deserialize 时按 defId 从 data 反查挂回即可。
   ⚠️ 注意 defFinal（防御力数值）**不能丢** —— 它是运行期算出来的，必须随档走。 */
const INSTANCE_DROP = new Set(['world', '_events', '_eventsCount', 'bus', 'engine', 'cmds', 'def', 'portrait']);
/* 野怪离场宽限（worldTick 轮数）：玩家离开房间后，encounter 刷的野怪再留两轮
   （≈60 游戏分钟）消散——给「回屋取忘掉的战利品」留个短窗，又不至于重新滚雪球。 */
const WILD_DESPAWN_TICKS = 2;
function cleanInstance(v, depth) {
  depth = depth || 0;
  if (v === null || v === undefined) return v;
  const t = typeof v;
  if (t === 'number' || t === 'string' || t === 'boolean') return v;
  if (t === 'function') return undefined;
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.map(x => cleanInstance(x, depth + 1)).filter(x => x !== undefined);
  if (v instanceof Date) return v.toISOString();
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (INSTANCE_DROP.has(k) || k.startsWith('__')) continue;
      let val;
      try { val = v[k]; } catch (e) { continue; }
      const c = cleanInstance(val, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}
/** 画像 → 心情基线偏移（规格书 §4.3）：心结 −5、丧亲 −8、新婚/得子 +10，合计 clamp 到 −20~+20 */
function portraitMoodBias(p) {
  if (!p) return 0;
  let b = 0;
  if (p.obsession) b -= 5;
  const marks = p.marks || [];
  if (marks.indexOf('丧亲') >= 0) b -= 8;
  if (marks.indexOf('新婚') >= 0 || marks.indexOf('得子') >= 0) b += 10;
  return Math.max(-20, Math.min(20, b));
}

function safeInstanceMap(map) {
  const out = {};
  if (!map) return out;
  for (const k of Object.keys(map)) {
    const c = cleanInstance(map[k], 0);
    if (c) out[k] = c;
  }
  return out;
}

class World extends EventEmitter {
  constructor(opts) {
    super();
    opts = opts || {};
    this.rng = new RNG(opts.seed);
    this.dataDirs = opts.dataDirs || [];
    this.modDirs = opts.modDirs || [];
    this.data = {
      meta: {},
      attrs: {},
      traits: {},
      items: {},
      skills: {},
      books: {},
      recipes: {},
      sects: {},
      ranks: {},
      npcs: {},
      rooms: {},
      regions: {},
      quests: {},
      dialogues: {},
      shops: {},
      events: {},
      stories: {},
      endings: {},
      achievements: {},
      monsters: {},
      herbs: {},
      songs: {},
    };
    this.mods = [];
    this.modLog = [];
    this.instances = { npcs: {}, items: {}, corpses: {} };
    this.deadNpcs = {};   // 第五批：真死的 NPC（defId → 死亡时间），10 天后复活
    this.jail = {};       // 第五批：被官府抓进牢的 NPC（defId → 赎金）
    this.soldSlaves = [];    // 掳人系统：被掳走卖进黑市/青楼的名册（快照，卖出即入库）
    /* ---- 世界记忆 · 传闻系统（#109，SPRINT-B W1–W4）----
     * rumors：运行期活跃传闻数组（随档 serialize）；rumorSeq：uid 自增计数器。 */
    this.rumors = [];
    this.rumorSeq = 1;
    /* ---- 世界动态 W5–W7（#109 后续块，2026-10-11 工程落地）----
     * factionState：势力运行值（power/treasury/mood/relations），模板在 data.factions；
     * calendarState：节庆运行值（上次触发日）；两者都随档（serialize/deserialize）。
     * _evCooldown：世界事件的冷却记账（evId → 上次触发的 day）；_evFired：once 记账。 */
    this.factionState = null;
    this.calendarState = { lastFestival: null };
    this._evCooldown = {};
    this._evFired = {};
    /* _tickLines / _collecting：把「时间推进期间」世界抛出的 storyline 台词
       收进缓冲，交给 engine.exec 排进玩家输出。
       背景：`storyline` 全仓**产品侧零消费者**（见 smoke-events 头部注）——
       onTick / onDayTick（W5/W7）/ worldTick 的台词语义上就是给玩家看的，
       以前 emit 出去就沉了。这里只收「推进时间时」发出的（_collecting=true），
       命令处理器执行期间的 emit 不收（那条路径各自已有 lines 返回，避免重复）。 */
    this._tickLines = [];
    this._collecting = false;
    this.regionAdj = {};     // 区域邻接表（跨区出口权重，运行时预计算，不写进数据文件）
    this.kFlow = {};         // 区域人口流动系数（传闻扩散强度，clamp 到 0.15~0.60）
    this.activeRules = []; // 功能 Mod 的「规则」（multiply / additive / onEvent），loadMods 时收集
    this.combatHooks = Object.assign({}, DEFAULT_HOOKS);
    this.effectFns = {};
    this.condFns = {};
    this.customEffects = {};
    this.customCommands = {};
    /* Mod 沙箱脚本（script.js）的实例；loadMods 里重建，见 loadModScripts() */
    this._scripts = [];
    this.uiExtensions = [];
    this.player = null;
    this.combat = new CombatEngine(this);
    this.battle = null;
    this.weather = '晴';
    this.clockMinutes = 540;
    this.version = '1.0.0';

    /* B7：接上「战斗开始」这个钩子。
       此前 `startCombat` 里的 `this.emit('combatstart', ...)` **零监听**，
       所以 NPC 目睹玩家被山贼/毒蛇袭击时毫无反应（主人原话「不会来帮我，
       也不会惊呼逃跑」）。反应树（witnessReaction / fleeNpc / personality）
       早就写好了，缺的只是这一个接线。
       注册在构造器里 → 所有 World 实例都生效，测试里 new World() 也一样。 */
    this.on('combatstart', ev => {
      const lines = this.combatStartWitnessReaction(ev && ev.battle);
      /* 存到 this._combatWitnessLines：startCombat 的返回体是纯数据，
         emit 的载荷已经在发出去之前就消费完了，所以这里中转一道。 */
      this._combatWitnessLines = (this._combatWitnessLines || []).concat(lines || []);
    });

    /* B21（第二处根因）：把「升级」接线到 onLevelUp 事件。
       `character.gainExp()` 升级时一直只 `emit('levelup', …)`，而这个事件
       **全仓零监听**；同时 `60_quests.json` 的 `onLevelUp`（≥5 那句提示）
       **从来没有任何地方调用过 fireEvent('onLevelUp')**。
       ⇒ 就算修好 mergeData 把 handler 数组从「被揉成对象」里救回来，
         onLevelUp 依然**永远不会触发**（升级提示照样没有，主人原话的症状）。
       与 combatstart 同款处理：注册在构造器里，所有 World 实例都生效。 */
    this.on('levelup', ev => { this.fireEvent('onLevelUp', ev || {}); });

    /* 世界动态：把「推进时间时」发出的 storyline 台词收进 _tickLines。
       只有 _collecting 为真（advanceTime 体内）才收 —— 见构造器字段注释。 */
    this.on('storyline', ev => {
      if (this._collecting && ev && ev.line) {
        if (this._tickLines.length < 40) this._tickLines.push(ev.line);
      }
    });
  }

  /** 取出「上一次推进时间」期间世界抛出的台词（并清空缓冲）。engine.exec / menuPick 调用。 */
  drainTickLines() {
    const out = this._tickLines;
    this._tickLines = [];
    return out;
  }

  /* ================================================================
   * 一、数据加载与 Mod 合并
   * ================================================================ */

  /**
   * 加载基础数据。
   *
   * ⚠️ 实现已搬到 `game/src/core/dataload.js`（闸一 · 加载 fail-fast），这里只留转发。
   *    搬走的原因：旧实现把 `JSON.parse` 包在 try/catch 里，坏文件只往
   *    `modLog` 塞一条 error 就继续跑 —— 引擎照常启动、游戏照常能玩，
   *    而那半个文件里的内容**一条都取不到**（实测：`102_classic_quests.json`
   *    5 处引号写错 ⇒ 5 条任务凭空消失，回归 131 套全绿、不报任何错）。
   *    内容大改要一次动几百个文件，加载层再从「吞错」变成「静默丢内容」
   *    就没人敢改了。新实现：**坏文件 ⇒ 抛 DataLoadError，带文件名+行号+片段**。
   *    合并语义（`mergeData`/`mergeEntry`）**仍在 world.js**，那是 Mod 也走的入口。
   */
  loadBaseData() {
    return require('./dataload').loadBaseData(this);
  }

  /** 合并一份数据包（基础数据或 mod 都是这一个入口） */
  mergeData(json, mod) {
    mod = mod || { name: 'unknown' };
    const collections = ['attrs', 'traits', 'items', 'skills', 'books', 'recipes', 'sects', 'npcs',
      'rooms', 'regions', 'quests', 'dialogues', 'shops', 'events', 'stories', 'endings',
      'achievements', 'monsters', 'herbs', 'songs', 'ranks'];
    const arrayMode = (mod.arrayMode || 'replace');
    for (const k of Object.keys(json)) {
      if (k === '_mod' || k === 'meta') continue;
      /* terrain 是「区域 id → 装饰格数组」的双层结构，
         值是数组不是 entry 对象，走通用 merge 会被当成单条记录揉坏，
         所以整块替换（基础数据只此一份，Mod 也按整块覆盖处理）。 */
      if (k === 'terrain') {
        const src = json[k] || {};
        this.data.terrain = {};
        for (const rid of Object.keys(src)) {
          const list = Array.isArray(src[rid]) ? src[rid] : [];
          this.data.terrain[rid] = list
            .filter(t => t && typeof t.x === 'number' && typeof t.y === 'number')
            .map(t => ({ x: t.x, y: t.y, type: t.type || 'grass', n: t.n || 1 }));
        }
        continue;
      }
      if (!this.data[k]) this.data[k] = {};
      if (collections.includes(k) || (typeof json[k] === 'object' && !Array.isArray(json[k]))) {
        if (Array.isArray(json[k])) {
          // 数组形式：转成 byId
          for (const item of json[k]) {
            if (!item || !item.id) continue;
            this.data[k][item.id] = this.mergeEntry(this.data[k][item.id], item, mod, arrayMode);
          }
        } else {
          for (const id of Object.keys(json[k])) {
            const entry = json[k][id];
            if (entry === null || entry === undefined) { delete this.data[k][id]; continue; }
            if (entry && entry._delete) { delete this.data[k][id]; continue; }
            /* ⚠ B21 根因修复（通用，不是给某个键打补丁）：
               值本身是数组时**绝不能** `Object.assign({ id }, entry)` ——
               那会把数组揉成 `{id:'onKill', 0:h0, 1:h1}`（数组只剩数字键，类型变对象）。
               `events`（以及将来同形的 `worldEvents`）的 handler 挂在数组元素上，
               被揉后 handler 的 `cond`/`effects` 全丢；而 `fireEvent` 用
               `[].concat(壳对象)` 只迭代一次 → **整个事件静默失效**（不报错、就是不发生）。
               数组的语义 = 「同一个键下的一串记录」，与 deepMerge 的数组规则**保持一致**：
               按 arrayMode（默认 replace=后者覆盖 / append=追加 / prepend=前置）整段合并，
               **始终保持数组类型**。只有「对象值」才走 byId 的 entry 合并（并打 __source）。 */
            if (Array.isArray(entry)) {
              this.data[k][id] = deepMerge(this.data[k][id], entry, { arrayMode });
              continue;
            }
            /* ⚠️ 与上一条同族：**原语值**（数字/字符串/布尔）也绝不能走 byId 的
               `Object.assign({ id }, entry)` —— Object.assign 会忽略原语，只留下 `{id}`。
               实测（W5/W7 落地时抓到）：`calendar.yearDays:120` 被揉成 `{id:'yearDays'}`，
               于是 `day % yearDays` → NaN → 节庆**一条都不触发**（静默失效，与 B21 同族）。
               原语值直接赋值即可（它没有「字段」可合并）。 */
            if (entry === null || typeof entry !== 'object') {
              this.data[k][id] = entry;
              continue;
            }
            this.data[k][id] = this.mergeEntry(this.data[k][id], Object.assign({ id }, entry), mod, arrayMode);
          }
        }
      }
    }
    // 顶层 meta 合并（如游戏名、起始房间、起始属性）
    if (json.meta) {
      this.data.meta = deepMerge(this.data.meta, json.meta, { arrayMode: 'replace' });
    }
    // 功能 Mod 的「规则」（multiply / additive / onEvent / macro）
    if (json.rules) {
      for (const r of [].concat(json.rules)) {
        /* 施工单 C · mult 字段名防呆：multiply 的倍数字段只认 `value`
           （ruleMult 只读 r.value）。作者照直觉写 mult 等于没写 ——
           按「不报错就是不生效」的纪律，进 modLog 明说这条规则不会生效，
           不做静默转换（改字段名是作者的事，引擎替他猜会把坏习惯养大）。 */
        if (r && r.kind === 'multiply' && r.mult !== undefined && r.value === undefined) {
          this.modLog.push({
            level: 'warn', mod: mod.id || mod.name,
            msg: `规则「${r.name || r.target || '?'}」的倍数字段写的是 mult，引擎只认 value —— 这条规则不会生效，请把 mult 改成 value。`,
          });
          continue;
        }
        if (r && r.kind) this.activeRules.push(Object.assign({}, r, { __mod: mod.id || mod.name }));
      }
    }
    // 局外声明（mod 优先级）
    if (json._mod) {
      this.mods.push(Object.assign({ id: mod.id || 'unknown', name: mod.name, version: mod.version || '1.0.0', priority: mod.priority || 0, source: mod.source }, json._mod));
    }
  }

  mergeEntry(base, over, mod, arrayMode) {
    if (!base) return Object.assign({}, over, { __source: mod.id || mod.name });
    const merged = deepMerge(base, over, { arrayMode });
    merged.__source = over.__source || base.__source;
    return merged;
  }

  /** 扫描并加载 mod 目录 */
  /**
   * 把「装了但根本没被加载」的 Mod 报出来。
   *
   * 🔴 这是第三种「不报错就是不生效」，前两种都在加载层，这一种在**加载器**里：
   *   `modloader.js#readModDir()` 读 `mod.json` 失败时 catch 一下就返回
   *   `{broken:true, enabled:false}`（modloader.js:124），而这个 mod
   *   **既进不到 `loadMods`**（`resolveLoadOrder` 里 `enabled && !broken` 把它滤掉了，
   *   modloader.js:250/273），**也不进 `bootLog`**（`problems` 只收依赖成环和冲突，
   *   modloader.js:255-268）。
   *   ⇒ 装了一个坏 Mod 的人：游戏照常跑、mod 列表里也许看得到，但**日志和守卫
   *     全程沉默**。玩家以为装上了，其实一条内容都没进世界。
   *
   * 修法与 `loadMods` 里那条同规格：**报出来，但不许拖垮 boot**。
   * 为什么在这里重新扫一遍而不是从 engine 拿 modLoader：`World` 手里只有
   * `modDirs`（engine.js:139 传进来的），拿不到 `ModLoader` 实例；去改 engine.js
   * 传引用会碰别人的文件（主程序正在改战斗结算）。扫一遍的代价是 11 个目录，
   * 只在 boot / reload 时发生，可接受。
   */
  reportBrokenMods() {
    /* ⚠️ modloader.js 导出的是 `{ ModLoader, … }`，不是类本身 ——
       直接 `new ModLoader(dir)` 会抛「不是构造函数」，被下面的 try 吞掉，
       结果是**什么都不报**（第一次就是这么踩的：跑了，但一条都没报出来）。 */
    let ModLoader = null;
    try { ModLoader = require('./modloader').ModLoader; } catch (e) { return; }
    if (typeof ModLoader !== 'function') return;
    for (const dir of (this.modDirs || [])) {
      if (!dir || !fs.existsSync(dir)) continue;
      let ml;
      try { ml = new ModLoader(dir); } catch (e) { continue; }
      for (const m of (ml.mods || [])) {
        if (!m || !m.broken) continue;
        const msg = '【Mod 加载失败 · 来自 mods/' + m.id + '/mod.json】元数据解析失败：'
          + (m.error || '未知原因') + '\n  这个 Mod 已跳过（一条内容都没进世界），游戏照常运行。'
          + '\n  修它或者卸掉它，别让它一直挂在这儿假装装上了。';
        this.modLog.push({ level: 'error', mod: m.id, source: 'mods', msg });
        try { console.error('[dataload] ' + msg); } catch (_) { /* 日志打不出去不影响加载 */ }
      }
    }
  }

  loadMods(modList) {
    // modList: [{dir, enabled, priority, id, name, version}]  已由 modloader 决定顺序
    this.mods = [];
    this.modLog = [];
    this.activeRules = [];
    /* ⚠️ 这两样必须一起重置：`reload()` 是「换一个 mod 组合再来一遍」，
       不清空的话，上一次那个已经被删掉的 mod 注册的指令还挂在 customCommands 里，
       玩家敲下去会走到一个**已经不该存在**的脚本上（幽灵指令）。 */
    this._scripts = [];
    this.customCommands = {};
    /* 闸二补充：把「压根没被加载」的坏 Mod 报出来（见 reportBrokenMods 头注释）。
       ⚠️ 必须放在上面那几句 `modLog = []` **之后** —— 放前面会被自己的重置擦掉
       （第一次就是这么踩的：报了，然后被清空，H9 当场红）。 */
    this.reportBrokenMods();
    for (const m of modList) {
      if (!m.enabled) continue;
      for (const fname of (m.files || ['mod.json'])) {
        const fp = path.join(m.dir, fname);
        if (!fs.existsSync(fp)) continue;
        /* 闸一：Mod 的 JSON 与基础数据走同一套**带定位**的解析（文件名+行号+片段）。
           以前这里也是 `try { JSON.parse } catch { 记一笔 }` —— 一个坏 mod
           等于「装上了但什么都没发生」，与基础数据那个病同族。
           ⚠️ 但**分级不同**：`game/data/` 是我们自己的内容，坏了**硬失败**；
           `mods/` 是玩家装的，坏了要**响亮地报出来**，**不许拖垮 boot** ——
           不能因为某个玩家装了个坏 Mod，游戏就起不来。 */
        const dataload = require('./dataload');
        try {
          const parsed = dataload.parseJsonFile(fp, (m.id || '?') + '/' + fname, dataload.SRC_MOD);
          const json = parsed.json;
          if (parsed.bom) {
            this.modLog.push({ level: 'warn', mod: m.id, msg: `${fname} 带 BOM，已剥掉后解析` });
          }
          const shapeErrs = dataload.validateDataFile(json, (m.id || '?') + '/' + fname);
          if (shapeErrs.length) {
            throw new dataload.DataLoadError(
              'Mod「' + (m.id || '?') + '」的 ' + fname + ' 结构不合法：\n  ' + shapeErrs.join('\n  '));
          }
          const meta = json._mod || {};
          this.mergeData(json, {
            id: m.id || meta.id,
            name: m.name || meta.name || m.id,
            version: m.version || meta.version,
            priority: m.priority,
            source: m.dir,
            arrayMode: m.arrayMode || meta.arrayMode || 'replace',
          });
          // mod 声明的脚本型扩展
          if (json.functions) {
            this.registerFunctions(json.functions, m);
          }
          if (json.ui) {
            for (const u of [].concat(json.ui)) this.uiExtensions.push(Object.assign({ mod: m.id }, u));
          }
        } catch (e) {
          if (e && e.isDataLoadError) {
            /* 🔴 Mod 坏了：**报出来，但不许拖垮 boot**。
               ① 记一条 error 进 modLog（会进 bootLog，UI 上看得见）
               ② console.error 打一遍（服务端日志里也留得下）
               ③ **跳过这个 mod 继续** —— 其它 mod 和主数据照常加载
               错误信息里带 `[Mod(mods/)]` 抬头 + 文件名 + 行号 + 片段，
               玩家/作者一眼知道该去找哪个文件。 */
            const msg = '【Mod 加载失败 · 来自 mods/' + (m.id || '?') + '/' + fname + '】'
              + String(e.message || e).split('\n').join('\n    ');
            this.modLog.push({ level: 'error', mod: m.id, source: 'mods', msg });
            try { console.error('[dataload] ' + msg); } catch (_) { /* 日志打不出去不影响加载 */ }
            continue;
          }
          /* 其余运行时异常（脚本、沙箱…）仍按旧行为记一笔，
             免得一个 mod 的脚本问题把整个世界拖死。 */
          this.modLog.push({ level: 'error', mod: m.id, msg: `加载失败 ${fname}: ${e.message}` });
        }
      }
    }
    this.buildIndexes();
    /* Mod 沙箱脚本（mod 目录下的 `script.js`）。
       挂在这里的理由和 applySpeciesMoves 一样：**boot / reload / deserialize
       三条加载路径最后都落到 loadMods**，挂一处等于全挂上，不会漏。
       脚本注册的「自定义指令」写进 `this.customCommands` —— 这个表
       commands.execute 的第 5 步一直在查，但**以前从来没有人往里写过东西**；
       事件处理器由 `runModEvent()` 在 fireEvent 尾巴上派发。 */
    this.loadModScripts(modList);
    /* B3 · 物种专属招式。
       挂在这里（而不是 boot()/deserialize() 里）是因為这是**所有**加载路径的必经点：
       engine.boot() 走 loadMods → buildIndexes，engine.reload() 同样，
       deserialize() 也在末尾调 buildIndexes —— 三条路一次覆盖，不会漏。
       早先只挂在 deserialize() 上时，boot() 走loadBaseData() 那条路完全绕过，
       毒蛇仍是基本拳脚（这个坑本身就是「同一个动作有三条路径」提醒的）。 */
    this.applySpeciesMoves();
    /* W6/W7：从 data.factions / data.calendar 建运行值（所有加载路径的必经点）。 */
    this.initWorldDynamics();
    this.validate();
    return this.modLog;
  }

  /** mod 声明的"声明式函数"（不用写代码的安全函数） */
  registerFunctions(fns, mod) {
    for (const name of Object.keys(fns)) {
      const def = fns[name];
      if (def.type === 'cond') {
        this.condFns[name] = (args, ctx) => evalCond(Object.assign({}, def.body, args), ctx);
      } else if (def.type === 'effect') {
        this.effectFns[name] = (payload, ctx) => evalEffects(def.body, ctx);
      }
    }
  }

  /* ================================================================== *
   * Mod 沙箱脚本（script.js）
   *
   * 一句话：`modloader` 一直在算 `hasScript`，文档和加载器头注释都写着
   * 「script.js ← 可选，高级 mod（沙箱执行）」，**但没有执行入口**。
   * 作者把逻辑写在 script.js 里，装上去世界毫无变化、也不报错。
   * 这一段把它接上（隔离边界与作者 API 见 modscript.js 头注释）。
   * ================================================================== */

  /** 加载所有启用 mod 的 script.js（由 loadMods 调用，三条加载路径的必经点） */
  loadModScripts(modList) {
    const modscript = require('./modscript');
    this.customCommands = this.customCommands || {};
    for (const m of (modList || [])) {
      if (!m.enabled) continue;
      let s = null;
      try {
        s = modscript.loadModScript(this, m);
      } catch (e) {
        /* 加载器本身出问题（磁盘读不到、vm 起不来）也不能让世界起不来 */
        this.modLog.push({ level: 'error', mod: m.id || '?', msg: `script.js 加载异常：${e && e.message}` });
        continue;
      }
      if (!s) continue;
      this._scripts.push(s);
      /* 指令落到 commands.execute 第 5 步认的那张表上 */
      for (const name of Object.keys(s.scriptCommands || {})) {
        this.customCommands[name] = (o) => this.runScriptCommand(s, name, o);
      }
    }
    return this._scripts;
  }

  /** 跑一条脚本自定义指令（commands.js 里 `customCommands[cmd]` 的契约） */
  runScriptCommand(s, name, o) {
    const payload = {
      command: name,
      args: ((o && o.args) || []).slice(),
      raw: (o && o.raw) || '',
      player: true,
    };
    const lines = s.runCommand(name, payload) || [];
    if (!lines.length) {
      /* ⚠️ 什么都不返回 = 玩家点了没反应。脚本写的指令必须**明说自己没结果**，
         否则又是一个「不报错就是不生效」。 */
      return {
        lines: [{
          kind: 'warn',
          text: `（Mod「${s.id}」的指令「${name}」跑完了，但没有输出 —— 脚本里可能漏了 return 或 wx.msg()。）`,
        }],
      };
    }
    return { lines };
  }

  /**
   * 把事件派发给脚本处理器（由 fireEvent 末尾调用）。
   * 快路径：没有脚本、或没人监听这个事件，直接返回（onTick 上零开销）。
   */
  runModEvent(name, payload) {
    if (!this._scripts || !this._scripts.length) return;
    let hit = false;
    for (const s of this._scripts) { if (s.listens(name)) { hit = true; break; } }
    if (!hit) return;
    const pl = this._scriptPayload(payload);
    for (const s of this._scripts) {
      if (!s.listens(name)) continue;
      for (const l of s.emit(name, pl)) this.emit('storyline', { line: l });
    }
  }

  /**
   * 给脚本的事件负载**只挑标量**。
   * 不直接把 `{npc}` / `{ch}` 这些活对象塞进沙箱：它们带着 world 引用，
   * 等于把整个引擎漏给脚本（沙箱立刻变成摆设）。要查详情走 wx.me()/wx.here()。
   */
  _scriptPayload(payload) {
    const o = {};
    if (!payload || typeof payload !== 'object') return o;
    const SCALARS = ['roomId', 'npcId', 'questId', 'day', 'prevDay', 'heal', 'cost',
      'level', 'realm', 'skill', 'relation', 'itemId'];
    for (const k of SCALARS) {
      const v = payload[k];
      if (v !== undefined && v !== null && typeof v !== 'object') o[k] = v;
    }
    if (payload.ch) o.isPlayer = !!payload.ch.isPlayer;
    if (payload.npc) o.npcName = payload.npc.name || '';
    if (payload.witness) o.witnessName = payload.witness.name || '';
    if (payload.victim) o.victimName = payload.victim.name || '';
    if (payload.rumor && typeof payload.rumor === 'object') o.rumorText = String(payload.rumor.text || '');
    return o;
  }

  /**
   * 脚本注册的指令与**游戏内置指令**撞名时：明确记一笔，然后让位。
   *
   * ⚠️ 为什么非要说出来：`commands.execute` 的解析顺序是「内置 → 方向 → 房间动作
   *   → 任务关键词 → mod 自定义指令」。mod 写 `wx.command('look', ...)` 时，
   *   玩家敲 look 走的永远是内置那条，作者的指令**永远不会响**，而且没有任何提示 ——
   *   本项目的头号坑「不报错就是不生效」。
   *   由 engine 在 `buildCommands()` 之后调用（那时候才拿得到内置指令表）。
   */
  validateScriptCommands(cmds) {
    if (!this._scripts || !this._scripts.length) return;
    const builtin = new Set(Object.keys((cmds && cmds.CMD) || {}));
    for (const s of this._scripts) {
      for (const name of Object.keys(s.scriptCommands || {})) {
        if (!builtin.has(name)) continue;
        delete this.customCommands[name];
        s.scriptCommands[name] = 'conflict';
        this.modLog.push({
          level: 'warn', mod: s.id,
          msg: `自定义指令「${name}」与游戏内置指令重名，已让位（mod 不能覆盖内置指令）。请换个名字。`,
        });
      }
    }
  }

  buildIndexes() {
    /* ★ Mod / 外部数据的**字段归一化**（单一入口，幂等）。
       放在这里的理由和 `applySpeciesMoves` 一样：boot / reload / deserialize
       **三条加载路径**最后都落到 buildIndexes，挂一处等于全挂上，不会漏。
       归一化的必要性见 `modfields.js` 头注释 —— 一句话：
       mod 里 `skills.type` 写英文（sword/force/dodge）就**装不进任何槽位**，
       `category` 缺了还会在武学面板里冒出一个叫「sword」的分类。 */
    try {
      const r = require('./modfields').normalizeWorldData(this.data);
      if (r.changed) {
        this._modFieldNotes = r.notes;
        this.modLog = this.modLog || [];
        this.modLog.push({
          level: 'info', mod: '(字段归一化)',
          msg: `补齐/纠正了 ${r.changed} 处 mod 字段（type/category/quality/maxLevel 等）`,
        });
      }
    } catch (e) {
      /* 归一化失败不能让整个世界起不来 */
      this.modLog = this.modLog || [];
      this.modLog.push({ level: 'error', mod: '(字段归一化)', msg: String(e && e.message) });
    }
    // 房间 by region
    this._roomsByRegion = {};
    for (const id of Object.keys(this.data.rooms)) {
      const r = this.data.rooms[id];
      r.id = id;
      if (!r.region) r.region = '_wild';
      (this._roomsByRegion[r.region] = this._roomsByRegion[r.region] || []).push(r);
    }
    // NPC by room
    this._npcsByRoom = {};
    for (const id of Object.keys(this.data.npcs)) {
      const n = this.data.npcs[id];
      n.id = id;
      if (n.room && !n.wander) {
        (this._npcsByRoom[n.room] = this._npcsByRoom[n.room] || []).push(id);
      }
    }
    // 传闻系统：预计算区域邻接表 + 人口流动系数（地图静态，运行时算一次即可）
    this.computeRegionAdj();
  }

  /** 预计算区域邻接表与 kFlow（#109 W1）。
   *  · regionAdj[r][r2] = 双向跨区出口数之和（只用于「是否有通路」与随机选路）。
   *  · kFlow[r] = clamp(区域内流动人口 tag 占比, 0.15, 0.60)；衙门/青楼 +0.20 修正
   *    （官面上的事传得快、枕边话传得快，否则这些区传闻永远传不进/传不出）。
   *  权重不参与强度计算——强度只由 kFlow 决定，避免大区域碾压小区域。 */
  computeRegionAdj() {
    const adj = {};
    const regionOf = rid => (this.data.rooms[rid] && this.data.rooms[rid].region) || '_wild';
    for (const rid of Object.keys(this.data.rooms)) {
      const room = this.data.rooms[rid];
      const r = regionOf(rid);
      for (const dir of Object.keys(room.exits || {})) {
        const ex = room.exits[dir];
        const tid = typeof ex === 'string' ? ex : ex.to;
        if (!tid || !this.data.rooms[tid]) continue;
        const r2 = regionOf(tid);
        if (r === r2) continue; // 只统计跨区
        if (!adj[r]) adj[r] = {};
        adj[r][r2] = (adj[r][r2] || 0) + 1;
      }
    }
    this.regionAdj = adj;

    const FLOWY = new Set(['merchant', 'escort', 'boatman', 'vendor', 'groom', 'beggar']);
    const regionNpc = {};
    for (const rid of Object.keys(this.data.rooms)) {
      const region = regionOf(rid);
      const npcIds = this._npcsByRoom[rid] || [];
      if (!regionNpc[region]) regionNpc[region] = { total: 0, flowy: 0 };
      for (const nid of npcIds) {
        regionNpc[region].total++;
        const def = this.data.npcs[nid];
        if (def && FLOWY.has(def.tag)) regionNpc[region].flowy++;
      }
    }
    const kFlow = {};
    for (const region of Object.keys(regionNpc)) {
      const { total, flowy } = regionNpc[region];
      let k = total ? flowy / total : 0;
      k = clamp(k, 0.15, 0.60);
      if (region === 'yamen' || region === 'qinglou') k = clamp(k + 0.20, 0.15, 0.60);
      kFlow[region] = k;
    }
    this.kFlow = kFlow;
  }

  validate() {
    const d = this.data;
    const warn = (m) => this.modLog.push({ level: 'warn', msg: m });
    for (const id of Object.keys(d.rooms)) {
      const r = d.rooms[id];
      for (const dir of Object.keys(r.exits || {})) {
        const ex = r.exits[dir];
        const tid = typeof ex === 'string' ? ex : ex.to;
        if (tid && !d.rooms[tid]) warn(`房间 ${id} 的出口 ${dir} 指向不存在的房间 ${tid}`);
      }
    }
    for (const id of Object.keys(d.npcs)) {
      const n = d.npcs[id];
      if (n.room && !d.rooms[n.room]) warn(`NPC ${id} 位于不存在的房间 ${n.room}`);
    }
    for (const id of Object.keys(d.items)) {
      const it = d.items[id];
      if (it.type === 'book' && it.teach && !d.skills[it.teach]) warn(`书籍 ${id} 教授不存在的武学 ${it.teach}`);
    }
    const start = d.meta.startRoom;
    if (start && !d.rooms[start]) warn(`起始房间 ${start} 不存在！`);
    return this.modLog;
  }

  /* ================================================================
   * 二、查询 API
   * ================================================================ */
  getRoom(id) { return this.data.rooms[id]; }
  getItem(id) { return this.data.items[id]; }
  getSkill(id) { return this.data.skills[id]; }
  getSect(id) { return this.data.sects[id]; }
  getNpc(id) { return this.data.npcs[id]; }
  getTrait(id) { return this.data.traits[id] || this.data.attrs[id]; }

  /* ================================================================
   * 二·一、天赋效果查询（B3：每条天赋都必须有人真消费）
   *
   * 设计：天赋的 effects 是**数据**（见 data/68_talents.json），但「怎么生效」
   * 是引擎的事。这里把解释权集中在一处——战斗 / 好感 / 商店 / 时间 / 奇遇各处
   * 只调下面的函数，不许在业务代码里散读 `e.type === 'xxx'`。
   * 好处：加一条天赋只改一处；删一条天赋（_delete）不会留下悬空的消费点。
   *
   * `char` 一律传角色实例；不传就默认玩家（大部分玩法只有玩家吃天赋）。
   * traits 与 perks 合并扫描——两者在 character.recalc 里本来就是同一口径。
   * ================================================================ */

  /** 取某角色身上某类（或不限类）的天赋效果列表 */
  traitEffects(char, type) {
    const out = [];
    const c = char || this.player;
    if (!c) return out;
    const ids = [].concat(c.traits || [], c.perks || []);
    for (const id of ids) {
      const td = this.getTrait(id);
      if (!td || !td.effects) continue;
      for (const e of [].concat(td.effects)) {
        if (!e) continue;
        if (!type || e.type === type) out.push(e);
      }
    }
    return out;
  }

  /** 正向好感增量倍率（「口才便给」+50%）。只作用于**正向**增量。 */
  favorGainMult(char) {
    let m = 1;
    for (const e of this.traitEffects(char, 'favorGain')) {
      if (typeof e.value === 'number') m += e.value;
    }
    return m;
  }

  /**
   * 收敛的好感改动入口：正向增量过天赋倍率，再统一钳制上下限。
   * 各条「npc.favor = (npc.favor||0) + d」的直接赋值都改走这里，
   * 好处是天赋一加，所有入口同时生效，不会再出现「有的路走天赋、有的路不过」。
   * @returns 实际应用的增量（可能已被倍率放大）
   */
  gainFavor(npc, delta) {
    if (!npc || !delta) return 0;
    const d = delta > 0 ? delta * this.favorGainMult(this.player) : delta;
    npc.favor = clamp((npc.favor || 0) + d, -200, 200);
    return d;
  }

  /** 是否「逃跑必成」（脚底抹油） */
  hasFleeAlways(char) { return this.traitEffects(char, 'fleeAlways').length > 0; }

  /**
   * 武学类别加成倍率（剑心通明按 slot、蛊道天赋按 category）。
   * @returns 伤害/效果倍率（1 = 无加成）
   */
  skillBonusMult(char, skill) {
    if (!skill) return 1;
    let m = 1;
    for (const e of this.traitEffects(char, 'skillBonus')) {
      if (typeof e.value !== 'number') continue;
      if ((e.slot && skill.type === e.slot) || (e.category && skill.category === e.category)) m += e.value;
    }
    return m;
  }

  /**
   * 给一个「武技效果」打语义标签，供免疫判定用。
   * ⚠️ 引擎里没有专门的毒字段：毒的语义靠效果本身的类型与名字推出来
   *    （dot 且名字含「毒」）。数据里「阴毒/剧毒/蛊毒/掌毒」这类 DOT 都算毒。
   */
  effectTags(eff) {
    if (!eff) return [];
    const tags = [];
    if (eff.type === 'stun') tags.push('stun');
    if (eff.type === 'confuse') tags.push('confuse');
    if (eff.type === 'dot' && /毒/.test(eff.name || '')) tags.push('poison');
    if (Array.isArray(eff.tags)) for (const t of eff.tags) tags.push(t);
    return tags;
  }

  /** 该角色是否免疫某类效果（百毒不侵 / 心如铁石） */
  isImmune(char, tag) {
    for (const e of this.traitEffects(char, 'immune')) {
      if (Array.isArray(e.tags) && e.tags.indexOf(tag) >= 0) return true;
    }
    return false;
  }

  /** 买卖折扣（经商奇才 0.15 → 买价 ×0.85 / 卖价 ×1.15） */
  shopDiscount(char) {
    let d = 0;
    for (const e of this.traitEffects(char, 'shopDiscount')) {
      if (typeof e.value === 'number') d += e.value;
    }
    return clamp(d, 0, 0.5);
  }

  /** 行走消耗倍率（浪子情怀 -0.5 → 0.5） */
  consumptionMult(char) {
    let m = 1;
    for (const e of this.traitEffects(char, 'consumption')) {
      if (typeof e.value === 'number') m += e.value;
    }
    return Math.max(0.1, m);
  }

  /** 奇遇 / 随机遭遇触发概率倍率（福星高照 +50%） */
  encounterMult(char) {
    let m = 1;
    for (const e of this.traitEffects(char, 'encounterBonus')) {
      if (typeof e.value === 'number') m += e.value;
    }
    return Math.max(0.1, m);
  }

  /** 家园地块效果汇总（练武场/书房/丹房… 给修炼、淬体、炼制、采药用） */
  estateEffects() {
    const est = this.player && this.player.estate;
    if (!est || !Array.isArray(est.plots) || !est.plots.length) return null;
    return require('./estate').estateEffects(this);
  }
  /* ================================================================
   * 二·五、私域（B/C 层虚拟宅院 · design/09 §3.3）
   *
   * C 层 285 个 NPC 的家是 `house:<npcId>`，**不占 room id、不上地图**
   * （engine.mapView 已过滤 private 房）。要进去得满足门槛，命令「拜访」才建路。
   *
   * 为什么不写进 data：198 户 × 4 间 = 792 间房会把地图撑爆（620 房的老病灶）。
   * 这里只按需生成「堂屋」1 间，其余留白；整段不写 data，存档只存「访问过谁」。
   */

  /** 拜访门槛：好感 ≥30 / 接过他支线 / 债主仇家（掳人系统联动） */
  canVisitHouse(npc, p) {
    const d = npc.def || {};
    if (npc.favor >= 30) return { ok: true, why: '交情' };
    if ((d.quests || []).some(q => p.questStage(q) >= 0)) return { ok: true, why: '他有求于你' };
    const kd = p.kidnap || {};
    if ((kd.owners || []).includes(npc.defId)) return { ok: true, why: '你是他的债主' };
    if ((kd.slaves || []).some(s => (s.defId || s.id) === npc.defId)) return { ok: true, why: '他在你手下' };
    return {
      ok: false,
      msg: `你与${npc.name}还谈不上交情，这般贸然上门，只怕连门都进不去。`,
    };
  }

  /** 私域房间 id：C 层 B/C 层统一 `house_<defId>`，与存档里的访问记录对齐 */
  houseRoomId(defId) { return 'house_' + defId; }

  /**
   * 按 5 房模板生成院子布局。
   * ⚠️ 只返回「数据」，不写 data.rooms —— 真正落房间由 ensureHouse 干，
   *    这样读档能靠存下来的 layout 原样重建，不必重新掷骰。
   */
  houseLayout(npc) {
    const d = npc.def || {};
    const who = npc.name;
    const trade = d.shop ? '靠墙一张旧柜台，上头摆着几样零碎货物。' : '墙角堆着些农具杂物。';
    return {
      rooms: [
        {
          key: 'hall', name: `${who}家·堂屋`, z: 0,
          desc: `${who}的堂屋。屋里陈设简朴，一方条案、两把旧椅，墙上挂着些寻常农具。${trade}`,
        },
      ],
      /* 预留：卧房/厨房/院子/柴房 —— 随访问进度逐间解锁（design/09 §3.3） */
      locked: [
        { key: 'bed', name: `${who}家·卧房` },
        { key: 'kitchen', name: `${who}家·厨房` },
        { key: 'yard', name: `${who}家·院子` },
        { key: 'wood', name: `${who}家·柴房` },
      ],
      host: npc.defId,
    };
  }

  /**
   * 确保某人的私域房间已建（幂等）。
   * @returns 房间 id
   */
  ensureHouse(npc, fromRoom) {
    const id = this.houseRoomId(npc.defId);
    if (this.data.rooms[id]) return id;
    const lay = this.houseLayout(npc);
    const hall = lay.rooms[0];
    /* region 用主人的辖区；查不到就沿用当前房间的 region（保证地图分组不炸） */
    const region = (npc.def && npc.def.district) ||
      (fromRoom && fromRoom.region) || 'wild';
    this.data.rooms[id] = {
      id, name: hall.name, region,
      desc: hall.desc,
      private: true,          /* engine.mapView 据此把私域排除出地图 */
      owner: npc.defId,
      exits: {},
    };
    return id;
  }

  /**
   * 拜访某人的家。
   * 流程：校验门槛 → 建房 → 把主人挪进堂屋（玩家要能跟他说话）→
   *      记一条双向边（来路 ↔ 堂屋）→ 玩家进屋。
   * @returns {ok, msg, roomId, lines}
   */
  visitHouse(npcId, fromRoomId) {
    const p = this.player;
    const def = this.data.npcs[npcId];
    if (!def || !p) return { ok: false, msg: '没有这个人。' };
    /* 只对虚拟私宅生效；A/B 层的真房间（hm_*）本来就在地图上，直接走过去 */
    if (String(def.home || '') !== 'house:' + npcId) {
      return { ok: false, msg: `${def.name || npcId}的住处你自个儿走去便是，不必「拜访」。` };
    }
    const from = this.getRoom(fromRoomId);
    /* ⚠️ 复用场上已有实例，**不要无脑 spawn** ——
       spawnNpc 对非名人每次都新建一个 Character（名人只返已有那位），
       重复 spawn 会造出「张掌柜×2」，且玩家在别处培养的好感落在**另一个**实例上，
       拜访时读到的 favor 永远是模板初始值 → 门槛永远差一口气（测试实测 favor=11）。
       这正是记忆铁律 1 的同类：拿到的不是玩家以为的那个对象。 */
    let npc = null;
    for (const n of Object.values(this.instances.npcs)) {
      if (n.defId === npcId && !n.dead) { npc = n; break; }
    }
    if (!npc) npc = this.spawnNpc(npcId, fromRoomId, 1);
    if (!npc) return { ok: false, msg: '此人此刻不在镇上。' };
    if (npc.dead) return { ok: false, msg: `${npc.name}已经不在人世了。` };
    const gate = this.canVisitHouse(npc, p);
    if (!gate.ok) return { ok: false, msg: gate.msg };

    const roomId = this.ensureHouse(npc, from);
    const room = this.getRoom(roomId);

    /* 主人进堂屋（玩家要能跟他对话 —— talk 只在同房间找人，记忆第 34 条） */
    const prevRoom = npc.room;
    npc.room = roomId;
    /* 记下主人原来的去处，走出私域时送回去 */
    npc._houseHostReturn = prevRoom;
    npc._inPrivateHouse = true;

    /* 双向补边：来路加一条进屋口，堂屋加一条回去的路 */
    const DIR_IN = { s: 'n', n: 's', e: 'w', w: 'e', ne: 'sw', nw: 'se', se: 'nw', sw: 'ne' };
    let inDir = 'n';
    for (const d of Object.keys(DIR_IN)) {
      if (from && from.exits && !from.exits[d]) { inDir = d; break; }
    }
    const backDir = DIR_IN[inDir];
    if (from && from.exits) from.exits[inDir] = roomId;
    room.exits[backDir] = fromRoomId;
    room._privateHost = npcId;
    room._privateFrom = fromRoomId;

    if (!p.visitedHouses) p.visitedHouses = {};
    p.visitedHouses[npcId] = (p.visitedHouses[npcId] || 0) + 1;

    return {
      ok: true, roomId, npcId,
      msg: `${npc.name}见你上门，眉头一动，末了让开身：「既是熟人，进来坐罢。」`,
      why: gate.why,
    };
  }

  /**
   * 玩家走出私域时调用：把主人送回原来的房间，并把私域房间拆掉。
   * ⚠️ 私域不在地图上（private），留着会让 mapView 的房间总数对不上，
   *    也让「回城走一圈再进来」这种直觉行为失真 —— 所以拆干净。
   */
  leaveHouse(roomId) {
    const room = this.data.rooms[roomId];
    /* ⚠️⚠️ 只能按 `_privateHost` 认「这是拜访建的私域」，**绝不能只看 private**！
       `private:true` 早就被三处占用了：estate（家园地块）/ home（主宅）/
       sectFounder（自建宗门），它们都是**玩家自己的房**，同样不上地图。
       一刀切按 private 删 → 玩家走出家园就把自己的院子删了，
       smoke-estate 实测直接挂：「可走回主院 room=hm_plot_1_yard」。 */
    if (!room || !room._privateHost) return false;
    const hostId = room._privateHost;
    const from = room._privateFrom;
    if (hostId) {
      /* ⚠️ instances.npcs 是按**实例 id**（npc_xxx）建的表，不是 defId！
         直接 `instances.npcs[hostId]` 永远取不到 → 主人送不回原处、
         标记也不清（测试 D2/D3 实测抓到）。必须遍历比对 defId。 */
      for (const n of Object.values(this.instances.npcs)) {
        if (n.defId !== hostId || !n._inPrivateHouse) continue;
        const back = n._houseHostReturn;
        if (back && this.data.rooms[back]) n.room = back;
        n._inPrivateHouse = false;
        n._houseHostReturn = null;
      }
    }
    if (from && this.data.rooms[from] && this.data.rooms[from].exits) {
      for (const d of Object.keys(this.data.rooms[from].exits)) {
        if (this.data.rooms[from].exits[d] === roomId) delete this.data.rooms[from].exits[d];
      }
    }
    delete this.data.rooms[roomId];
    return true;
  }

  getQuest(id) { return this.data.quests[id]; }
  getRegion(id) { return this.data.regions[id]; }
  season() {
    const day = Math.floor(this.clockMinutes / 1440);
    const idx = Math.floor(day / 30) % 4;
    return SEASONS[idx];
  }
  seasonCN() { return SEASON_CN[this.season()]; }
  isNight() { const m = this.clockMinutes % 1440; return m < 300 || m >= 1140; }
  /** 是否饭点（午时 11-13 点 / 酉时 17-19 点） */
  isMealTime() {
    const m = this.clockMinutes % 1440;
    return (m >= 660 && m <= 780) || (m >= 1020 && m <= 1140);
  }
  /** BFS 找离 fromRoom 最近的酒楼/客栈
   *  必须限深：删掉 300 多间填充房后地图连通性大增，
   *  无深度上限时全城 800+ NPC 会涌进同一间客栈（实测 277 人）。
   *  同区域优先，找不到再逐层放宽。 */
  nearestEatery(fromRoom) {
    if (!fromRoom) return null;
    const start = this.getRoom(fromRoom);
    const homeRegion = start ? start.region : null;
    const isEatery = id => {
      const r = this.getRoom(id);
      return !!r && /(tavern|wine|inn|酒楼|客栈|酒家|饭庄)/.test(r.name || '');
    };
    /* 第 1~3 步只认同区域；4~6 步放宽到邻区；7 步以内全局兜底 */
    for (const [maxDepth, sameOnly] of [[3, true], [6, false], [8, false]]) {
      const seen = new Set([fromRoom]);
      let q = [{ id: fromRoom, d: 0 }];
      while (q.length) {
        const next = [];
        for (const cur of q) {
          const room = this.getRoom(cur.id);
          if (!room) continue;
          for (const dir of Object.keys(room.exits || {})) {
            const ex = room.exits[dir];
            const t = typeof ex === 'string' ? ex : ex.to;
            if (!t || seen.has(t)) continue;
            const tr = this.getRoom(t);
            if (!tr) continue;
            seen.add(t);
            if (isEatery(t) && (!sameOnly || tr.region === homeRegion)) return t;
            next.push({ id: t, d: cur.d + 1 });
          }
        }
        if (q[0] && q[0].d + 1 >= maxDepth) break;
        q = next;
      }
    }
    return null;
  }

  /** 房间内可见 NPC 实例 */
  npcsIn(roomId) {
    return Object.values(this.instances.npcs).filter(n => n.room === roomId && !n.dead);
  }
  /** 房间里**晕倒**（被打倒但没被补刀）的人。
   *  ⚠️ 不能用 npcsIn —— 它过滤掉 dead，而 onNpcDown 会把打倒的人同时标
   *     knockedOut=true + dead=true（战斗层面算「倒下」），结果打赢了的人
   *     反而谁都看不见。掳人 / 搜身 / 扶人都得用这个。真死的人实例已被
   *     onNpcKilled 删掉，这里自然查不到，不会混淆。 */
  downedIn(roomId) {
    return Object.values(this.instances.npcs).filter(n => n.room === roomId && n.knockedOut);
  }
  npcsIncludingTemplates(roomId) {
    const out = this.npcsIn(roomId).slice();
    const have = new Set(out.map(n => n.defId));
    /* 🔴 全局活体闸（×N 家族根治，主人真机 2026-10-18）：
       _npcsByRoom 收录的是「常驻本房」的人，每个 defId 全局只该有**一个**活实例
       （dedupeNpcInstances 的成文规则）。但常驻者会被 defaultWanderFor 的默认游走
       挪出本房——旧口径只查**本房**有没有，人一走开，玩家每回本房就再 spawn 一只，
       副本越滚越多（实测 300 步滚出 9 只卖茶老汉，探针里 43 只）。
       修法与 ambience.ensureNearbyNpcs 的全局 alive 集合同一口径：
       全局已有一只活着的（人在哪间房都算活着），就绝不再 spawn——
       他此刻在别处，「这里有：」本就不该列出他，再造一只才是 ×N 的病根。
       ⚠️ 活体判据用 !dead：倒地（knockedOut+dead）的不算活着，
          原口径「倒地躺在地上、活的照刷」的行为保持不变。 */
    const aliveDefs = new Set();
    for (const inst of Object.values(this.instances.npcs)) {
      if (inst && inst.defId && !inst.dead) aliveDefs.add(inst.defId);
    }
    for (const id of (this._npcsByRoom[roomId] || [])) {
      if (aliveDefs.has(id)) continue;
      const npc = this.spawnNpc(id, roomId, 1, true);
      /* ⚠️ spawnNpc 对名人会「已有就返回那位」，而他可能人在别的房间
         （名人会走动）。这里只收真正落在本房间的，否则同一个人会被
         列两遍 —— 主人在客栈见过「岳不群 ×3」，就是这么来的。 */
      if (npc && npc.room === roomId && !have.has(npc.defId)) {
        have.add(npc.defId);
        out.push(npc);
      }
    }
    return out;
  }
  /** 修复「同一常驻 NPC 有多个活实例」的旧档（**幂等**；干净的档是 no-op）。
   *
   * 背景：`ambience.ensureNearbyNpcs` 曾经**每个 worldTick 都无脑 spawn**，
   *   而 `spawnNpc` 对非名人**每次都新建实例** → 副本越滚越多，
   *   而且**副本会写进存档** ⇒ 玩家看到「这里有：张掌柜（商人） x7」，
   *   退出重进也修不掉（主人 2026-10-10 亲报）。
   *   引擎侧已修（加「已活着就不再 spawn」），但**已经坏掉的档得救回来**。
   *
   * 规则：`_npcsByRoom` 收录的是「常驻本房、不游走」的人，每个 defId 全局只保留
   *   **1 个**活实例。保留哪一个：① 优先留在其本房的那个（可能被 wander/拜访挪走过）
   *   ② 再看 `favor + trust` 最高的那个（玩家真正打过交道的是这个）
   *   ③ 再按实例 id 稳定排序取第一个（保证可复现）。
   * ⚠️ **只处理 `_npcsByRoom` 里的人**：会游走的 NPC、以及 `room.respawn` 刷出来的怪
   *   （如「一场 3 只山贼」）本来就允许多实例，一刀切会把正常玩法删掉。
   * @returns {{removed:number, defIds:string[]}}
   */
  dedupeNpcInstances() {
    const res = { removed: 0, defIds: [] };
    const home = {};
    for (const rid of Object.keys(this._npcsByRoom || {})) {
      for (const id of this._npcsByRoom[rid]) home[id] = rid;
    }
    const groups = {};
    for (const uid of Object.keys(this.instances.npcs || {})) {
      const n = this.instances.npcs[uid];
      if (!n || n.dead) continue;
      if (!(n.defId in home)) continue;
      (groups[n.defId] = groups[n.defId] || []).push(uid);
    }
    for (const defId of Object.keys(groups)) {
      const uids = groups[defId];
      if (uids.length <= 1) continue;
      const score = uid => {
        const n = this.instances.npcs[uid];
        const inHome = (n.room === home[defId]) ? 1 : 0;
        const prog = (n.favor || 0) + ((n.pstate && n.pstate.trust) || 0);
        return [inHome, prog];
      };
      uids.sort((a, b) => {
        const sa = score(a), sb = score(b);
        if (sa[0] !== sb[0]) return sb[0] - sa[0];
        if (sa[1] !== sb[1]) return sb[1] - sa[1];
        return a < b ? -1 : 1;
      });
      for (const uid of uids.slice(1)) { delete this.instances.npcs[uid]; res.removed++; }
      res.defIds.push(defId);
    }
    return res;
  }

  /** 老档残留清剿（主人 2026-10-17 真机：出生点仍见山贼×2 / 游侠×2；幂等，干净档 no-op）。
   *
   * 背景：山贼 `noWander` 钉住、demo mod 默认关，这两刀**修的都是「不再漂/不再来」**
   *   —— 但修之前漂进出生点的山贼、demo mod 的游侠**已经实例化存进主人的老档**，
   *   源头堵了存量还在：读档把 instances 原样救回来，人自然还站在那儿。
   *
 * 两刀：
 *   ① **def 孤儿**：实例的 defId 在当前数据 + 已启用 mod 里找不到（demo mod 关闭后
 *      其 NPC 实例、数据改档删掉的 def）→ 删实例。
 *   ② **noWander 漂移**：def 钉了 noWander 的实例不在岗 → 删实例。
 *      定岗房 = room.respawn 点名它的房间（mob_bandit→jm_underground、α狼→wild_forest_1 等）；
 *      无 respawn 点名的 noWander（六教头/铁器摊主）以 def.room 为岗。
 *      删了怎么回来：定岗族由 respawn 按岗补回；def.room 族在 `_npcsByRoom`
 *      懒生成池里，玩家一回本房 npcsIncludingTemplates 就补上——**都无需存档迁移**。
 *   ③ **def.room 静态定岗漂移**（2026-10-18 主人新档「老周还站在出生点」加刀）：
 *      def.room 有值且**无 wander 习性**的常驻 NPC（老周/名人族），实例离岗 → 删，
 *      回 def.room 懒生成补回。带 wander 的是游走族（离家是设计内行为），不归这刀。
   *
 * 安全边界（不删的）：
 *   · 有真 def 的 dead / knockedOut 实例（死亡与击倒态另账，别动——
 *     倒地者是「补刀/搜身/装袋」的正常玩法对象）；
 *   · 跟随玩家的实例（p.followers——跟随者人在玩家身边，room≠岗位是**对的**）；
 *   · squads（分队不进本函数口径）；
 *   · 带运行时个人化状态的剧情实例（pstate.avengers / 运行期翻红 hostile /
 *     非零 favor——主人 2026-10-17 退回裁定：**剧情生成的人不能被存档维护误删**）。
 * ⚠️ 2026-10-18 两处加严（主人真机「幽灵 NPC：列表有名、看无此人」）：
 *   ① **真 def 判据**：77/86/87/91 辅助表（武学/内力/画像/生活）以 npc id 为键、
 *      顶层键同为 npcs，mergeData 会把这些**无名残片**揉进 data.npcs——
 *      demo mod 关掉后其 defId 在这里仍「查得到」，刀① 被骗过，残留实例
 *      永久存活。真 def 必须带 name（40_npcs / mod / 动态生成的都有；
 *      残片只有 skills/equipment/mp 这类补充字段）。
 *   ② **倒地孤儿也收**：demo 时期被打倒没补刀的 mod NPC 实例（dead+knockedOut
 *      且真 def 已随 mod 消失）原先被「dead/ko 一律跳过」永久豁免——
 *      它们正是幽灵本尊：view 靠 downedIn 列得出、look 的活名单查无此人。
 *      有真 def 的倒地者照旧不碰。
   * @returns {{removed:number, orphanDef:number, drifted:number, defIds:string[]}}
   */
  pruneOrphanInstances() {
    const res = { removed: 0, orphanDef: 0, drifted: 0, defIds: [] };
    const inst = this.instances && this.instances.npcs;
    if (!inst) return res;
    /* 定岗房缓存：defId -> Set(点名它的房间)——respawn 表全库扫一遍 */
    const posts = {};
    for (const rid of Object.keys(this.data.rooms || {})) {
      for (const x of [].concat(this.data.rooms[rid].respawn || [])) {
        if (x && x.npc) (posts[x.npc] = posts[x.npc] || new Set()).add(rid);
      }
    }
    const following = new Set((this.player && this.player.followers) || []);
    for (const uid of Object.keys(inst)) {
      const n = inst[uid];
      if (!n) continue;
      if (following.has(uid)) continue;
      const defId = n.defId;
      const rawDef = defId ? this.data.npcs[defId] : null;
      /* 真 def 判据（见函数头注释①）：无名残片不算 def。 */
      const def = (rawDef && rawDef.name) ? rawDef : null;
      /* 剧情豁免（主人 2026-10-17 退回裁定：剧情生成的人不能被存档维护误删）。
         判据读**实例自带**的运行时个人化状态——def 可能已经不在（动态 def 不随档、
         mod 关闭即消失），所以各刀都必须先看实例：
         · pstate.avengers 非空 —— 亲属记仇独占标记（witnessKinsmanReaction 落），
           刀①②③ 全豁免；
         · hostile 运行期翻红（实例 true 而 def 非敌）—— 公共闸豁免（刀②③ 都认）；
           天生敌对的山贼 def.hostile 本就是 true，不会被误豁免；
         · favor 非零 —— **只刀②豁免**（在刀② 判，不在公共闸）：
           spawnNpc 的出身亲和会给初始 favor（老周一落地就 favor=8、pstate.met=false
           根本没见过面）——那不是玩家处出来的交情。刀③ 若认它，「老周站出生点」
           这类漂移定岗实例就被自家亲和永久豁免了（2026-10-18 主人新档实测）。 */
      const avenged = !!(n.pstate && Array.isArray(n.pstate.avengers) && n.pstate.avengers.length);
      /* 倒地/真尸（dead+knockedOut）：只走刀①——真 def 已不在的倒地孤儿
         就是「幽灵 NPC」本尊（view 列得出、look 查无人），照删；
         有真 def 的倒地者是正常玩法（补刀/搜身），刀②③ 不碰（见函数头注释②）。 */
      if (n.dead || n.knockedOut) {
        if (!def && !avenged) {
          delete inst[uid];
          res.removed++; res.orphanDef++;
          if (res.defIds.indexOf(defId) < 0) res.defIds.push(defId);
        }
        continue;
      }
      if (avenged || (def && n.hostile === true && !def.hostile)) continue;
      /* 刀①：def 找不到（mod 关闭后的 demo NPC 实例 / 数据删档孤儿） */
      if (!def) {
        delete inst[uid];
        res.removed++; res.orphanDef++;
        if (res.defIds.indexOf(defId) < 0) res.defIds.push(defId);
        continue;
      }
      /* 刀②：noWander 定岗 NPC 不在岗（老档漂移实例）。
         favor 非零豁免独占在这一刀（#90 口径：玩家处出来的交情不删）。 */
      if (def.noWander) {
        if (typeof n.favor === 'number' && n.favor !== 0) continue;
        const home = posts[defId];
        const offPost = home ? !home.has(n.room)
          : (def.room ? n.room !== def.room : false);
        if (offPost) {
          delete inst[uid];
          res.removed++; res.drifted++;
          if (res.defIds.indexOf(defId) < 0) res.defIds.push(defId);
          continue;   /* 已删，别落到刀③ 再计一遍 */
        }
      }
      /* 刀③（2026-10-18 主人新档「老周还站在出生点」）：def.room 静态定岗族离岗清理。
         老周（cy_pre_teaman）def.room=jiangnan_street 但**没有 noWander**——
         刀② 的「noWander 才管离岗」管不着他，老档里漂在出生点的实例就一直站着。
         静态定岗判据：def.room 有值且 def **无 wander 习性**（带 wander 的是游走族，
         离家是设计内行为，全库 165 个，不归清剿管；无 wander 的 def.room 族 653 个，
         全是老周这样的钉子户/名人）。离岗实例删除，玩家一回 def.room 由懒生成池
         补回——与刀①② 同一套「删了自己回来」，无需存档迁移。
         豁免口径：公共闸（avenged/翻红）照旧；favor 在这里收窄成 **pstate.met**
         （真见过面才算玩家交情——出身亲和 favor≠0 + 没见过面 = 漂移的定岗实例，
         照删，正是主人新档老周的形态）。 */
      if (def.room && !def.wander && n.room !== def.room) {
        const met = !!(n.pstate && n.pstate.met);
        if (!met) {
          delete inst[uid];
          res.removed++; res.drifted++;
          if (res.defIds.indexOf(defId) < 0) res.defIds.push(defId);
        }
      }
    }
    return res;
  }

  /** 全图「活着的」NPC 实例（按 defId 去重，取一个代表）。
   *  「拜访」要找不在场的人，所以不能用 npcsIn(房间)。
   *  ⚠️ 名人/常驻 NPC 同一 defId 可能有多实例（会走动、respawn），
   *     这里按 defId 去重，只留一个，避免「岳不群 ×3」式重名。 */
  allNpcs() {
    const out = [];
    const seen = new Set();
    for (const n of Object.values(this.instances.npcs)) {
      if (n.dead || !n.defId) continue;
      if (seen.has(n.defId)) continue;
      seen.add(n.defId);
      out.push(n);
    }
    return out;
  }
  itemsIn(roomId) {
    return Object.values(this.instances.items).filter(i => i.room === roomId);
  }
  corpsesIn(roomId) {
    return Object.values(this.instances.corpses).filter(c => c.room === roomId);
  }

  /* ================================================================
   * 三、NPC 实例
   * ================================================================ */
  spawnNpc(defId, roomId, count, silent) {
    const def = this.data.npcs[defId];
    if (!def) return null;
    /* 名人全局只允许一个实例。真死（dead 且已移出 instances）后由 deadNpcs
       复活机制重新 spawn，所以这里只要「还活着有一个」就不再造。
       ⚠️ 必须按 defId 跨房间查，不能只查目标房间 —— 名人会走动。
       ⚠️ 不能 return null：调用方（npcsIncludingTemplates / 命令行 spawn /
          任务脚本）要的是「这个人」，返回已有实例才安全；返回 null 会让
          调用方当成「这人没了」，进而读到 undefined.id（历史踩过）。 */
    if (isCelebrity(def)) {
      const living = Object.values(this.instances.npcs)
        .filter(n => n.defId === defId && !n.dead);
      if (living.length) return living[0];
    }
    let first = null;
    for (let i = 0; i < (count || 1); i++) {
      const npc = new Character(this, {
        id: uid('npc'),
        name: def.name + (def.names && def.names.length ? '' : ''),
        gender: def.gender,
        race: def.race,
        desc: def.desc,
        level: def.level || 1,
        attr: def.attr,
        hp: def.hp, mp: def.mp, atk: def.atk, def: def.def,
        dodge: def.dodge, parry: def.parry, speed: def.speed,
        skills: def.skills,
        learned: def.learned || (def.skills ? Object.keys(def.skills).reduce((o, k) => { if (def.skills[k]) o[def.skills[k]] = { level: def.skillLevel || 20, exp: 0 }; return o; }, {}) : null),
        equipment: def.equipment,
        money: def.money, karma: def.karma, reputation: def.reputation,
        perks: def.perks, traits: def.traits, insect: def.insect,
        sect: def.sect, rank: def.rank,
        hostile: def.hostile,
        vars: clone(def.vars || {}),
        flags: clone(def.flags || {}),
      });
      npc.isNpc = true;
      npc.isPlayer = false;
      npc.defId = defId;
      npc.def = def;
      npc.room = roomId;
      npc.favor = 0;
      npc.hostile = !!def.hostile;
      /* B3：物种专属招式（由 applySpeciesMoves 写在模板上）。
         必须 copy 一份到实例：pickSkill 读的是**实例**的 speciesMoves，
         而模板对象是全地图共享的引用 —— 直接赋值等于让同种 NPC 共享同一个数组，
         将来谁改了会带动全图（与 social.js 的 spouse/rel 同一个坑，不踩第二次）。 */
      npc.speciesMoves = Array.isArray(def.speciesMoves) ? def.speciesMoves.slice() : null;
      npc.dialog = def.dialog || null;
      npc.shop = def.shop || null;
      npc.drop = def.drop || null;
      npc.expReward = def.expReward !== undefined ? def.expReward : Math.floor((def.level || 1) * 12 + 8);
      npc.potReward = def.potReward !== undefined ? def.potReward : Math.floor((def.level || 1) * 3 + 2);
      npc.moneyReward = def.moneyReward !== undefined ? def.moneyReward : (def.money || 0);
      npc.loot = def.loot || null;
      npc.leavesCorpse = def.leavesCorpse !== false;
      /* ⚠️ 默认游走：数据里只有山贼写了 `wander` —— 「NPC 会随机移动」这件事
         其实**从来没发生过**。这里给公共场所的普通 NPC 补默认值；
         有作息的人 / 名人 / 住家户不动（理由见 ambience.defaultWanderFor）。
         ⚠️ `wander` 必须 **clone**（记忆第 14 条那条铁律，同样适用这里）：
            直接挂 def.wander 会让同一模板的**所有实例共用一个对象** ——
            npclife / 事件脚本改过谁的 wander.chance，全派弟子跟着一起变。 */
      npc.wander = def.wander ? clone(def.wander) : require('./ambience').defaultWanderFor(this, def);
      npc.ai = def.ai || 'simple';
      npc.talk = def.talk || null;
      /* ---- 社交扩展字段（第一批）----
         模板 → 实例，实例上带可变状态（好感会变、财物会被偷走），
         所以必须 clone，不能直接引用 def 里的对象。 */
      npc.favor = def.favorInit !== undefined ? def.favorInit : (def.favor || 0);
      npc.rel = clone(def.rel || []);
      npc.carry = clone(def.carry || { items: [], money: 0 });
      npc.home = def.home || null;
      npc.tag = def.tag || null;
      /* ---- 婚姻扩展字段（第二批）----
         同样必须 clone：spouse/rel 会被婚后流程改写，
         直接引用 def 上的数组会「改一个带动全江湖」。 */
      npc.spouse = def.spouse || null;
      npc.spouseName = def.spouseName || null;
      npc.isConcubine = !!def.isConcubine;
      npc.bonded = !!def.bonded;
      npc.knows_player_of = def.knows_player_of || null;
      npc.age = def.age || null;
      /* ---- 性格 / 心情（第五批）----
         心情是会变的状态，必须 clone；性格按 def.personality，没有就按身份 tag 默认。 */
      const personalityMod = require('./personality');
      npc.personality = personalityMod.personaIdOf(def);
      /* ---- 人物画像（第六批）----
         portrait 是模板静态数据，pstate 是随档走的运行期状态。
         两者都必须 clone / 新建：
           · portrait 直接赋引用 → 解锁一个秘密会写进模板，全地图同名 NPC 一起变（
             与 social.js 的 spouse/rel 同一个坑，不能第二次踩）；
           · pstate 若共用同一个对象字面量 → 320 个实例共享一份 trust/revealed。
         favor（喜欢你）与 trust（信得过你）是两条独立轴：
         送礼只涨 favor，办成事才涨 trust，secret 门槛一律用 trust 判。 */
      npc.portrait = def.portrait ? clone(def.portrait) : null;
      npc.pstate = { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
      if (npc.portrait) npc.pstate.moodBias = portraitMoodBias(npc.portrait);
      /* 心情基线 = 模板心情 + 画像偏移（有心结/丧亲的人基线更低） */
      npc.mood = clamp((def.mood !== undefined ? def.mood : 50) + npc.pstate.moodBias, 0, 100);
      /* ---- ENG-04：hp / maxHp 失同步 ----
         构造时 hp 用 def.hp 定死，但 Character 构造末尾会 recalc()，
         maxHp 会因内功/装备/奇经八脉加成变大，hp 却不动 →
         NPC 一出生就带着 76%~81% 的残血（看着像刚被打过，实际数据没同步）。
         现在统一「出生即满血」；
         若将来要做「带伤出场」的 NPC，模板写 spawnHpRatio: 0.6 即可按比例落地。 */
      if (typeof npc.maxHp === 'number' && npc.maxHp > 0) {
        const ratio = (typeof def.spawnHpRatio === 'number') ? clamp(def.spawnHpRatio, 0.05, 1) : 1;
        npc.hp = Math.max(1, Math.round(npc.maxHp * ratio));
      }
      if (typeof npc.maxMp === 'number' && npc.maxMp > 0) {
        const mRatio = (typeof def.spawnMpRatio === 'number') ? clamp(def.spawnMpRatio, 0.05, 1) : 1;
        npc.mp = Math.max(0, Math.round(npc.maxMp * mRatio));
      }
      /* ---- 内力上限 = 实力上限（主人 2026-10-10）----
         NPC 的内力上限天生就决定了他该有多深：内力一百的人本来就该会得比内力十的人深。
         这里按 maxMp 把 `learned` 里的火候**垫高**（只抬不降，手填更高的保留）。
         ⚠️ 必须在 hp/mp 同步**之后**做 —— 它读的是算完加成的 maxMp。 */
      try { require('./neigong').syncNpcByMp(this, npc); } catch (e) { /* 不该拖垮生成 */ }
      this.instances.npcs[npc.id] = npc;
      if (!first) first = npc;
      if (!silent) this.emit('npcspawn', { npc });
    }
    return first;
  }

  despawnNpc(defId, roomId) {
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      if (n.defId === defId && (!roomId || n.room === roomId)) delete this.instances.npcs[id];
    }
  }

  getNpc(id) { return this.instances.npcs[id] || null; }

  /** 按 **defId** 取场上活实例（跨房间）。
   *
   *  ⚠️ 为什么需要它：`getNpc()` 有两个同名定义，**后者覆盖前者** → 实际查的是
   *     `instances.npcs`（键是 `npc_xxx` 实例 id）。传 defId 进去**永远取不到**，
   *     而且**不报错、只是静默 no-op**（B29：`favor:<npcId>` 效果全打空，
   *     连累 262 条 `sq_npcv_*` 支线的好感奖励）。
   *
   *  取用顺序（同记忆铁律「别在查找函数里无脑 spawnNpc」）：
   *     ① 场上已有活实例（跨房间找，NPC 会走动）→ 就是玩家认识的那一个；
   *     ② 没有才就地 spawn（且落到他的 `home`/`room`，不硬塞到玩家房里）。
   *  @returns {Character|null}
   */
  findLiveNpc(defId) {
    if (!defId) return null;
    const inst = this.getNpc(defId);          // 兼容「本来就传实例 id」的调用方
    if (inst && inst.defId && !inst.dead) return inst;
    const living = Object.values(this.instances.npcs)
      .filter(n => n && n.defId === defId && !n.dead);
    if (living.length) return living[0];
    const def = this.data.npcs && this.data.npcs[defId];
    if (!def) return null;
    return this.spawnNpc(defId, def.room || (this.player && this.player.room) || null, 1, true);
  }

  /** 第五批生死规则：普通 NPC 被打倒 → 晕厥（不致死，留在原地，玩家补刀才真死） */
  onNpcDown(npc, battle) {
    npc.knockedOut = true;
    npc.dead = true;   // 战斗层面算「倒下」，战斗结束
    npc.hp = 0;
    /* 🩸 记 killed_<defId>：主线阶段3 的 defeatLegend 条件靠它判定「打倒过哪个名宿」。
       以前这里什么都不记 → 那个条件永远 false → 主线100%走不完、总纲说的「卡死」。
       任何 NPC 被打倒都记，不只是名人（省得名单一改就又断）。 */
    const p = this.player;
    if (p && npc.defId) {
      p.setFlag('killed_' + npc.defId, true);
      p.kills = (p.kills || 0) + 1;
    }
    /* 门派挑战结算（主人 2026-10-08：「长老互动面板上会有个挑战…贡献度足够可挑战」）：
       打赢了当场进位。文案排进世界的台词队列 —— 战斗结算走的是 combatAction，
       不经过 exec 的 drain，所以留到玩家下一条指令时带出来（打完总得动一下）。 */
    if (p && npc._challengedBy === p.id) {
      try {
        const r = require('./sectlife').onChallengeResolved(this, p, npc);
        if (r && r.lines) for (const l of r.lines) this._tickLines.push(l);
      } catch (e) { /* 进位失败不该拖垮战斗结算 */ }
    }
    this.emit('npcdown', { npc });
    /* 江湖的回应（2026-10-11 自拟）：这一场如果打的是有名有姓的人，
       记进玩家的账，并且**当场变成传闻往外飘**（有人替他出头是另一条线，见 revenge）。 */
    if (p) { try { require('./revenge').noteDown(this, p, npc); } catch (e) { /* 记录失败不拦结算 */ } }
    this.witnessReaction(npc);
    // 犯人类 NPC 晕倒 → 官府抓进牢（若有官差在场）
    const tag = npc.tag || (npc.def || {}).tag || '';
    const criminal = /thief|gambler|贼|盗|匪/.test(tag + npc.name);
    if (criminal) this.arrestCriminal(npc);
  }

  /** 官府抓犯人：犯人在场且有官差，就抓进牢（玩家见义勇为得赏金） */
  arrestCriminal(npc) {
    const p = this.player;
    const room = npc.room;
    const officials = this.npcsIn(room).filter(n => !n.dead && ['constable', 'official', 'escort'].includes(n.tag || (n.def || {}).tag));
    if (!officials.length) return;
    const ransom = 200 + Math.floor((npc.level || 1) * 10);
    this.jail[npc.defId] = { name: npc.name, ransom, since: this.clockMinutes };
    delete this.instances.npcs[npc.id];
    if (p) { p.money += 100; p.karma += 2; }
    /* 若玩家接了该犯的悬赏，额外领赏 */
    let bountyText = '';
    if (p && p.bounty === npc.defId) {
      p.money += 150;
      p.bounty = null;
      bountyText = '（你领了缉拿此犯的 150 文悬赏！）';
    }
    this.emit('storyline', { line: { kind: 'story', text: `${officials[0].name}带着几个差役上前，把昏倒在地的${npc.name}锁了，押回衙门大牢。${p ? `（你见义勇为，得了 100 文赏钱）${bountyText}` : ''}` } });
  }

  onNpcKilled(npc, battle) {
    const p = this.player;
    const def = npc.def || {};
    // 给玩家奖励（经验/潜能的倍率规则已由 gainExp/gainPotential 内部应用）
    if (this.inPlayerParty(npc, battle)) {
      /* 击杀类任务目标的计数队列。
         ⚠️ 为什么要排队而不是在这里直接加：任务目标计数住在 commands 层
         （`advanceQuestCounters`），而 world **不反向依赖 commands**（分层铁律）。
         所以 world 只登记"这一轮谁死了"，由 engine 在 postProcess 里消费。 */
      (this._killQueue = this._killQueue || []).push(npc.defId);
      p.gainExp(Math.floor(npc.expReward * (def.expMult || 1)));
      p.gainPotential(npc.potReward);
      p.money += Math.floor(npc.moneyReward * this.ruleMult('money'));
      p.kills++;
      p.karma += (def.karmaGain !== undefined ? def.karmaGain : (def.good ? 5 : -2));
      if (def.repGain) for (const k of Object.keys(def.repGain)) p.reputation[k] = (p.reputation[k] || 0) + def.repGain[k];
    }
    // 掉落
    const loot = [];
    if (def.loot) {
      for (const l of def.loot) {
        if (l.chance === undefined || this.rng.next() < l.chance) {
          const n = l.count || 1;
          for (let i = 0; i < n; i++) loot.push(l.item);
        }
      }
    }
    if (def.drop) for (const it of def.drop) loot.push(it);
    if (npc.money > 0) { /* money 掉落走 moneyReward */ }
    if (npc.leavesCorpse) {
      const cid = uid('corpse');
      /* 野兽尸体才能切割取肉，人的尸身不能（kind 区分） */
      const beast = /狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(npc.name || '');
      this.instances.corpses[cid] = { id: cid, name: npc.name + '的尸体', room: npc.room, loot, owner: p.name, kind: beast ? 'beast' : 'human', desc: `${npc.name}的尸身静卧于地，随身之物散落一旁。` };
    } else {
      for (const it of loot) {
        this.instances.items[uid('gi')] = { itemId: it, room: npc.room, count: 1 };
      }
    }
    /* 第五批：非野兽的 NPC 真死后，10 天后（游戏时间）复活（以死前状态重新 spawn） */
    const beast = /狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(npc.name || '');
    if (!beast && npc.defId) this.deadNpcs[npc.defId] = this.clockMinutes;
    delete this.instances.npcs[npc.id];
    this.emit('npckilled', { npc, loot });
    // 击杀触发 mod 事件
    this.fireEvent('onKill', { npc });
    // 目击反应（第五批）：房间里其他人看到杀人，按性格/武力/身份反应
    this.witnessReaction(npc);
    // 世界记忆 · 传闻：杀具名 NPC / 门派弟子 → rs_kill_named；杀平民 → rs_kill_civilian
    const killedDef = npc.def || {};
    const named = !!(killedDef.sect || killedDef.tier || killedDef.unique || killedDef.portrait);
    const pname = (this.player && this.player.name) || '一个江湖客';
    const rname = (this.getRoom(npc.room) || {}).name || '某处';
    this.addRumor(named ? 'rs_kill_named' : 'rs_kill_civilian', {
      room: npc.room,
      who: pname, where: rname, whom: npc.name || '一个人',
      subject: 'player', about: npc.defId || null,
      vars: { who: pname, where: rname, whom: npc.name || '一个人' },
    });
  }

  /** 某 NPC 是否有武力（有武学 / 战斗类身份） */
  npcHasMartialArts(npc) {
    if (!npc) return false;
    const def = npc.def || {};
    if (def.skills && Object.keys(def.skills).length) return true;
    if (npc.learned && Object.keys(npc.learned).length) return true;
    return ['swordsman', 'constable', 'escort', 'hunter', 'monk', 'taoist', 'nun', 'thief'].includes(npc.tag || def.tag);
  }

  /** 两个 NPC 实例之间的关系（rel 是单向存储，故双向都查）。
   *  返回 '亲' | '友' | '仇' | null。
   *  · 亲 = 夫妻 / 父母子女等至亲；· 友 = 至交；· 仇 = 宿敌。
   *  数据里只有这三种 kind（友708 / 亲238 / 仇151）。 */
  relBetween(a, b) {
    if (!a || !b) return null;
    const aid = a.defId, bid = b.defId;
    if (!aid || !bid) return null;
    const kinds = [];
    for (const r of (a.rel || [])) if (r.id === bid) kinds.push(r.kind);
    for (const r of (b.rel || [])) if (r.id === aid) kinds.push(r.kind);
    if (!kinds.length) return null;
    if (kinds.indexOf('亲') >= 0) return '亲';
    if (kinds.indexOf('友') >= 0) return '友';
    if (kinds.indexOf('仇') >= 0) return '仇';
    return null;
  }

  /** 目击反应：房间里的 NPC 看到玩家杀人后的反应。
   *  优先处理「受害者至亲 / 至交」当场目睹——他们绝不会无动于衷（出戏点①）。
   *  其余按性格 / 武力 / 身份给反应（跑 / 呼救 / 报官 / 怒视 / 帮人）。
   *
   *  ⚠️ 分支判断已抽到 `witnessTree()`，因为 B7（玩家挨打时目击者的反应）
   *  要用**同一棵树**、只是把「谁是受害者」反过来。抽之前这里是内联的，
   *  两边各写一份必然走偏（B7 的教训：缺的不是逻辑，是钩子）。 */
  witnessReaction(victim) {
    const p = this.player;
    if (!p) return;
    const room = victim.room;
    const personalityMod = require('./personality');
    const witnesses = this.npcsIn(room).filter(n => n.id !== victim.id && !n.dead && !(n.def || {}).hostile);
    for (const w of witnesses) {
      const rk = this.relBetween(w, victim);
      if (rk === '亲' || rk === '友') {
        this.witnessKinsmanReaction(w, victim, rk, personalityMod);
        continue;
      }
      const per = personalityMod.personalityOf(w);
      const hasMartial = this.npcHasMartialArts(w);
      const tag = w.tag || (w.def || {}).tag || '';
      const official = ['constable', 'official', 'escort'].includes(tag);
      let text = null, kind = 'plain';

      if (official) {
        // 官府目击：缉凶，通缉度 +1
        p.wanted = (p.wanted || 0) + 1;
        kind = 'warn';
        text = `${w.name}厉喝：「光天化日，竟敢行凶！来人，给我拿下！」（你被官府通缉，通缉度 +1）`;
        /* B22 埋点 2/14 · rs_resist_arrest（当街抗官/拒捕，恶名 −）：
           官差目击行凶 = 报案语义点（与 p.wanted+1 同一处）。loud → 邻房也听见动静。 */
        this.addRumor('rs_resist_arrest', {
          room, about: w.defId || null,
          vars: { who: p.name || '有人', where: (this.getRoom(room) || {}).name || '此地', whom: w.name },
        });
      } else if (per && (per.id === 'xiayi' || per.id === 'haoshuang') && hasMartial) {
        // 侠义有武力：挺身制止
        kind = 'warn';
        text = `${w.name}怒目圆睁，挺身上前：「好个恶贼，休得伤人！」`;
      } else if (per && per.id === 'qienuo') {
        // 怯懦：吓得逃跑
        text = `${w.name}吓得魂飞魄散，连滚带爬地逃走了。`;
        this.fleeNpc(w);
      } else if (hasMartial) {
        text = `${w.name}面色一沉，手按兵刃，警惕地盯着你。`;
      } else {
        text = `${w.name}惊呼：「杀人啦！出人命啦！」`;
      }
      // 目睹惨案，心情大跌
      const mood = personalityMod.addMood(w, -25);
      if (mood.tier.name === '万念俱灰') {
        text += `（${w.name}吓得失魂落魄）`;
      }
      this.emit('storyline', { line: { kind, text } });
    }
  }

  /* ================================================================
   * B7 · NPC 目睹「玩家被袭击」的反应
   *
   * 根因（不是「没写反应」，是「钩子没接」）：
   *   `startCombat()` 里 `this.emit('combatstart', ...)` 发出去的事件，
   *   **全仓零监听** —— 反应树 `witnessReaction`（world.js:951）只挂在
   *   `onNpcDown` / `onNpcKilled` 上，也就是**只在 NPC 挨打时**触发。
   *   玩家挨打这条路从头到尾没有任何人接。
   *
   * 这里做的三件事：
   *   ① 把「目击者该做什么」的分支判断抽成 `witnessTree()`，与
   *      `witnessReaction` 共用（不复制第二份逻辑）；
   *   ② 接到 `combatstart` 上（构造函数里 `this.on('combatstart', ...)`）；
   *   ③ 反应台词**通过返回值交给 commands.js**，而不是只 emit('storyline')
   *      —— 因为 `storyline` 这个事件在产品侧没有任何消费者
   *      （全仓只有 tools/ 里的两个 smoke 在监听），只 emit 的话
   *      玩家在界面上一个字都看不到，那还是没修。
   * ================================================================ */

  /**
   * 目击反应树（**B7 与 witnessReaction 共用**）。
   * @param w        目击者 NPC 实例
   * @param personalityMod personality 模块
   * @param foeName  凶手的显示名（供台词指代）
   * @param playerIsVictim true = 玩家挨打（袭击者是个敌对 NPC）；
   *                      false = NPC 挨打（凶手是玩家）—— 原witnessReaction 的情形
   * @returns {{kind:string, text:string}}
   */
  witnessTree(w, personalityMod, foeName, playerIsVictim, victimIsVillain) {
    const per = personalityMod.personalityOf(w);
    const hasMartial = this.npcHasMartialArts(w);
    const tag = w.tag || (w.def || {}).tag || '';
    const official = ['constable', 'official', 'escort'].includes(tag);

    /* —— 官府 ——
       玩家是凶手 → 缉凶，通缉度 +1（原逻辑，一字未改）。
       玩家是受害者 → 官差**制止凶手**，绝不能给受害者记通缉，
       否则玩家挨打反而被通缉，是彻头彻尾的反向效果。
       玩家打的是**该打的人**（山贼/魔教）→ 官差睁一只眼闭一只眼：
       当街打山贼算除害，把他拿下才是真的说不通（也与「杀人放火金腰带」的
       江湖逻辑相悖）；而且这一支要是照常 +1，打山贼反倒被通缉，玩家一定会骂。 */
    if (official) {
      if (playerIsVictim) {
        return { kind: 'warn', text: `${w.name}厉喝一声拔刀：「光天化日持械行凶！${foeName}，你还不放下兵器！」` };
      }
      if (victimIsVillain) {
        return { kind: 'plain', text: `${w.name}扫了一眼地上那人，别过头去：「……我没看见。」` };
      }
      return { kind: 'warn', text: `${w.name}厉喝：「光天化日，竟敢行凶！来人，给我拿下！」（你被官府通缉，通缉度 +1）` };
    }
    /* —— 侠义且有武力 ——
       玩家是受害者 → 真的**加入战斗**帮玩家打（不只是说漂亮话）。
       玩家是凶手   → 挺身制止（原逻辑）。
       ⚠️ 两边的台词必须分开：老代码两边共用一句「好个${foeName}，休得伤人！」，
       而玩家当凶手时 foeName 就是玩家的名字 —— 变成「好个试侠，休得伤人！」，
       听着像街坊在跟玩家打招呼。凶手一侧改成人话：喝止 + 挡人。 */
    if (per && (per.id === 'xiayi' || per.id === 'haoshuang') && hasMartial) {
      return playerIsVictim
        ? { kind: 'warn', text: `${w.name}怒目圆睁，一按刀柄：「好个${foeName}，休得伤人！」` }
        : { kind: 'warn', text: `${w.name}断喝一声，横身拦住：「住手！光天化日，动手伤人算甚么本事！」` };
    }
    /* —— 怯懦：两条路径一致，都是真的逃走（fleeNpc 会真的挪走/消失） —— */
    if (per && per.id === 'qienuo') {
      return { kind: 'plain', text: `${w.name}吓得魂飞魄散，连滚带爬地逃走了。` };
    }
    if (hasMartial) {
      return playerIsVictim
        ? { kind: 'plain', text: `${w.name}面色一沉，手按兵刃，戒备地盯住了${foeName}。` }
        : { kind: 'plain', text: `${w.name}面色一沉，手按兵刃，警惕地盯着你。` };
    }
    /* —— 无武力平民：惊呼 —— */
    return playerIsVictim
      ? { kind: 'plain', text: `${w.name}大惊失色：「${foeName}！光天化日你就敢动手？还不快住手！」` }
      : { kind: 'plain', text: `${w.name}惊呼：「杀人啦！出人命啦！」` };
  }

  /**
   * 战斗开始时的目击反应（B7）。由 `combatstart` 事件驱动，
   * 所以**任何** startCombat 调用方（kill 指令 / kidnap 剧情 / modapi / NPC 主动袭击）
   * 都会走到这里 —— 不需要在每个调用点各补一遍。
   * @returns {Array<{kind,text}>} 交给调用方并入指令输出的台词
   */
  combatStartWitnessReaction(battle) {
    const p = this.player;
    if (!p || !battle) return [];
    /* ★ 先判**谁先动的手**（主人报：「为什么我主动攻击某个 NPC，旁边有个 NPC 来帮我，
         而不是帮被我攻击的小叫花？」）。
       老代码写死 `playerIsVictim = true`，并且把 `battle.target` 当成「凶手」——
       而 `target` 恰恰是**被玩家打的那个 NPC**。于是整棵树反过来演：
         玩家打小叫花 → 树以为「小叫花在行凶、玩家在挨打」→
         侠义 NPC「挺身加入战团，与你并肩迎敌」= 帮着凶手打受害者。
       正确判据（都不看 target）：
         · `battle.ambush` 为真 → NPC 伏击玩家（遭遇战），凶手是防御方；
         · 否则 → 玩家发起（kill / fight / 掳人 / modapi），凶手是玩家。 */
    const atk = [].concat(battle.attackers || []);
    const def = [].concat(battle.defenders || []);
    const playerIsVictim = !!battle.ambush;
    const aggressor = playerIsVictim
      ? (def[0] || atk[0] || null)
      : (atk.indexOf(p) >= 0 ? p : (atk[0] || p));
    if (!aggressor) return [];
    const foeName = aggressor.name || '那人';
    /* 受害者：供「挡在他身前」这类台词指代（玩家是受害者时就是玩家自己） */
    const victim = playerIsVictim
      ? p
      : (def.indexOf(p) >= 0 ? p : (def[0] || null));

    /* 受害者是谁、值不值得替他出头。
       ⚠️ 光判「谁先动手」还不够，还得判**被打的是不是该打的人**：
         玩家打小叫花（弱者）→ 侠义之士该挡在小叫花身前；
         玩家打山贼/魔教（除害） → 侠义之士没道理替山贼出头，退到一边看热闹才对。
       这一层老代码完全没有（它对受害者是谁一概不问），加进第二幕的
       「帮错了人」症状就出在这。 */
    const victimIsVillain = !playerIsVictim && this.isVillainNpc(victim);

    /* 目击者 = 屋里除**本次参战双方**以外的活人。
       ⚠️ 老代码用的是 `n.id !== attackerId` —— 而 `attackerId` 取的是 target（被打的那个），
       于是真正的另一方（玩家）不算问题、可**被打的 NPC 本身**却被排除在外，
       同时其它参战方（同门助战）也没排干净。按 id 全排才对。
       `def.hostile` 仍然排除：山贼/毒蛇这类敌对生物不做「旁观市民」的惊呼/逃跑反应
       （它们本来就该打，让它们喊「杀人啦」反而出戏）。 */
    const involved = atk.concat(def).map(x => x && x.id).filter(Boolean);
    const witnesses = this.npcsIn(p.room)
      .filter(n => involved.indexOf(n.id) < 0 && !n.dead && !n.knockedOut && !n.inCombat && !(n.def || {}).hostile);
    if (!witnesses.length) return [];
    const personalityMod = require('./personality');
    const lines = [];
    for (const w of witnesses) {
      const r = this.witnessTree(w, personalityMod, foeName, playerIsVictim, victimIsVillain);
      /* 怯懦：反应树判定为「逃」时**真的挪走**（这是 B7 验收项 B7-3，
         光打印一句「逃走了」而不挪房间，等于没逃）。 */
      const per = personalityMod.personalityOf(w);
      /* ⚠️ 官府目击者「看人下菜」：玩家是受害者 → 制止凶手（下面 witnessTree 那句
         「你还不放下兵器」）；玩家是凶手 → 那一句台词写着「（你被官府通缉，通缉度 +1）」，
         **这个 +1 得真的加**。老代码走不到这一支（playerIsVictim 恒 true），
         所以 +1 从来没实现过 —— 一旦按真实凶手判定，就会出现
         「字面写着 +1、数字纹丝不动」的谎报，比不写还坏。 */
      const wtag = String(w.tag || (w.def || {}).tag || '');
      if (!playerIsVictim && !victimIsVillain
        && ['constable', 'official', 'escort'].indexOf(wtag) >= 0) {
        p.wanted = (p.wanted || 0) + 1;
      }
      if (per && per.id === 'qienuo') this.fleeNpc(w);
      /* 侠义/豪爽——分三种情形，**站队必须站对**：
         ① 玩家被伏击       → 进 attackers，与玩家并肩（原 B7 行为，保留）；
         ② 玩家打弱者（小叫花/平民）→ 进 defenders，挡在受害者身前跟玩家动手
                                    —— 主人要的「该帮被打的那个」；
         ③ 玩家打该打的人（山贼/魔教）→ **谁也不帮，退到一边**。
            （老代码在这里一律 push 进 attackers = 帮玩家打受害者，
              正是主人报的「旁边有个 NPC 来帮我而不是帮被打的人」。）
         挂进 battle 数组，战斗结束时会随 finishCombat 统一清 inCombat，不会漏清。 */
      else if (per && (per.id === 'xiayi' || per.id === 'haoshuang')) {
        if (victimIsVillain) {
          r.text += `${w.name}抱臂退到一旁：「这等货色，早该有人收拾。」`;
        } else if (this.npcHasMartialArts(w)) {
          const side = playerIsVictim ? battle.attackers : battle.defenders;
          if (side.indexOf(w) < 0) {
            side.push(w);
            w.inCombat = true;
            r.text += playerIsVictim
              ? `${w.name}挺身加入战团，与你并肩迎敌！`
              : `${w.name}一步跨到${(victim && victim.name) || '那人'}身前，${
                w.gender === 'female' ? '她' : '他'}的兵刃已出了鞘。`;
          }
        } else if (!playerIsVictim && victim) {
          /* 讲义气但没武力：帮不上手，至少把人护到身后（打人的是你，矛头也对着你） */
          r.text += `${w.name}把${victim.name}往身后一拉，瞪着你。`;
        }
      }
      /* 目睹险情，心情小幅下滑（幅度小于「目睹惨案」，只是虚惊一场）。
         除害（玩家打山贼）不算险情，心情不跌 —— 否则打山贼还会惹得满屋人不快。 */
      if (!victimIsVillain) {
        const mood = personalityMod.addMood(w, -8);
        if (mood.tier.name === '万念俱灰') r.text += `（${w.name}吓得失魂落魄）`;
      }
      lines.push({ kind: r.kind, text: r.text });
      this.emit('storyline', { line: { kind: r.kind, text: r.text } });
    }
    return lines;
  }

  /**
   * 「江湖上该除的害」吗？—— 目击者**站队**要用这个判据。
   *   玩家打小叫花 → 不是（弱者），侠义之士该管；
   *   玩家打山贼/魔教/猛兽 → 是，侠义之士不替他出头。
   * 判据只用**模板常驻标记**（`def.hostile` 是山贼/魔教/毒蛇出生就带的，见 spawnNpc），
   * 不看本次战斗、不看谁先动手 —— 免得又变成「看错字段导致站队反了」。
   */
  isVillainNpc(n) {
    if (!n) return false;
    const d = n.def || {};
    if (d.hostile || n.hostile) return true;
    const tag = String(n.tag || d.tag || '');
    if (/匪|盗|贼|寇|魔|恶|凶|淫/.test(tag)) return true;
    if (typeof d.karma === 'number' && d.karma <= -30) return true;
    return false;
  }

  /** 至亲 / 至交目睹挚爱被杀 / 被打倒：崩溃或暴怒，并当场记仇（持久化到 pstate / 门派声望）。 */
  witnessKinsmanReaction(w, victim, rk, personalityMod) {
    const p = this.player;
    const hasMartial = this.npcHasMartialArts(w);
    const isKin = rk === '亲';
    /* 致死 vs 击倒：onNpcKilled 不置 knockedOut，onNpcDown 会置；
       同一帧内该标记能区分「被杀」与「被打倒」，措辞分开才不穿帮。 */
    const lethal = !victim.knockedOut;
    // 称呼：按性别推一个更贴肉的叫法（rel 只给了「亲」，不细分夫妻 / 父母）
    let term;
    if (isKin) {
      if (w.gender === 'male' && victim.gender === 'female') term = '爱妻';
      else if (w.gender === 'female' && victim.gender === 'male') term = '夫君';
      else term = '至亲';
    } else {
      term = victim.gender === 'female' ? '过命的姊妹' : '过命的兄弟';
    }
    let text, kind = 'warn';
    if (isKin) {
      text = hasMartial
        ? (lethal
            ? `${w.name}目眦欲裂，嘶吼一声扑将上来：「狗贼！你杀我${term}，此仇不共戴天！」`
            : `${w.name}目眦欲裂，挺兵上前：「狗贼！你竟对我${term}下此毒手，我与你不死不休！」`)
        : (lethal
            ? `${w.name}扑倒在${victim.name}尸身旁，肝肠寸断，指着你颤声道：「……你这禽兽，我${term}……我记下了。」`
            : `${w.name}扑到${victim.name}身侧，见${term}生死不知，肝肠寸断，颤声道：「……狗贼，我${term}……我记下了。」`);
    } else {
      text = hasMartial
        ? (lethal
            ? `${w.name}攥紧兵刃，盯着你沉声道：「${victim.name}是我${term}，此仇，我记下了。」`
            : `${w.name}攥紧兵刃，盯着你沉声道：「${victim.name}是我${term}，这笔账，我记下了。」`)
        : (lethal
            ? `${w.name}脸色惨白，望着${victim.name}的尸首，牙关紧咬：「好……好狠的心。」`
            : `${w.name}脸色惨白，望着${victim.name}，牙关紧咬：「你……你竟下如此狠手。」`);
    }
    // —— 持久惩罚（出戏点③：世界要记得你干的事）——
    w.hostile = true;                                  // 势同水火：日后不可结拜 / 婚嫁 / 收徒
    const drop = isKin ? 90 : 45;
    w.favor = Math.max(-200, (w.favor || 0) - drop);   // 好感暴跌
    personalityMod.addMood(w, isKin ? -60 : -40);      // 心情重创
    if (!w.pstate) w.pstate = { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
    w.pstate.avengers = w.pstate.avengers || [];        // 日后重逢 / 任务可读取（#116 衔接）
    if (w.pstate.avengers.indexOf(victim.defId) < 0) w.pstate.avengers.push(victim.defId);
    // 死者、目击者门派对玩家的恶感（江湖声誉受损）
    const sect = victim.sect || (victim.def || {}).sect;
    if (sect) p.reputation[sect] = (p.reputation[sect] || 0) - (isKin ? 30 : 15);
    p.wanted = (p.wanted || 0) + 1;                    // 目击报案，通缉度 +1
    this.emit('storyline', { line: { kind, text } });
    this.fireEvent('onKinsmanWitness', { witness: w, victim, relation: rk });
  }

  /** NPC 逃跑：离开当前房间（挪到相邻出口，没有就 despawn） */
  fleeNpc(npc) {
    const room = this.getRoom(npc.room);
    if (!room) { delete this.instances.npcs[npc.id]; return; }
    const dirs = Object.keys(room.exits || {});
    if (!dirs.length) { delete this.instances.npcs[npc.id]; return; }
    const d = this.rng.pick(dirs);
    const ex = room.exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    if (tid && this.data.rooms[tid]) npc.room = tid;
    else delete this.instances.npcs[npc.id];
  }

  /* ================================================================
   * 六之二、世界记忆 · 传闻系统（#109，SPRINT-B W1–W4）
   * 玩家的行为 → 目击 → 生成会走样/扩散/衰减的流言；NPC 用流言里的你表态。
   * 与 #108 亲属记仇、p.reputation/p.wanted 共同组成「世界记得你」闭环。
   * ================================================================ */

  /** 生成一个传闻实例。
   *  opts: { room, who, where, whom, subject='player', about=null, vars={}, seedId }
   *  目击者判定：同房间非 hostile 非晕倒 NPC 必为目击；loud 时相邻房间 50%（夜×0.5 雨×0.7）。
   *  目击者数为 0 则不生成（无人看见 = 无人可传，避免「全江湖都知道你在无人区干了什么」）。 */
  addRumor(seedId, opts) {
    opts = opts || {};
    const seed = this.data.rumorSeeds && this.data.rumorSeeds[seedId];
    if (!seed) return null;
    const room = this.getRoom(opts.room);
    if (!room) return null;
    const originRegion = room.region || '_wild';

    const witnesses = [];
    for (const w of this.npcsIn(opts.room)) {
      if (w.dead || (w.def || {}).hostile || w.knockedOut) continue;
      witnesses.push(w.defId);
    }
    if (seed.loud) {
      let prob = 0.5;
      if (this.isNight()) prob *= 0.5;
      if (this.weather === '雨') prob *= 0.7;
      for (const dir of Object.keys(room.exits || {})) {
        const ex = room.exits[dir];
        const tid = typeof ex === 'string' ? ex : ex.to;
        if (!tid || !this.data.rooms[tid]) continue;
        for (const n of this.npcsIn(tid)) {
          if (n.dead || (n.def || {}).hostile || n.knockedOut) continue;
          if (this.rng.chance(prob)) witnesses.push(n.defId);
        }
      }
    }
    if (!witnesses.length && !opts.silent) return null; // 无人目击，传闻不产生（世界事件可 opts.silent 免目击）

    const uidv = 'r_' + String(this.rumorSeq++).padStart(5, '0');
    const bornDay = Math.floor(this.clockMinutes / 1440);
    const spread = {}; spread[originRegion] = seed.heat0;
    const rumor = {
      uid: uidv, seedId, subject: opts.subject || 'player', about: opts.about || null,
      truth: 100, originRoom: opts.room, originRegion,
      bornDay, heat: seed.heat0, heat0: seed.heat0,
      spread, witnesses: Array.from(new Set(witnesses)),
      hopCount: 0, vars: opts.vars || {}, marks: seed.marks || [],
      polarity: seed.polarity, weight: seed.weight,
    };
    this.applyRumorReputation(seed, room, opts.about, opts.subject);
    this.rumors.push(rumor);
    if (this.rumors.length > 200) {
      this.rumors.sort((a, b) => a.bornDay - b.bornDay);
      this.rumors = this.rumors.slice(this.rumors.length - 200);
    }
    this.fireEvent('onRumorBorn', { rumor });
    return rumor;
  }

  /** 传闻实例 → 声誉结算（一次性，不持续结算避免重复计分）。
   *  Δrep = polarity × weight × (heat0/100) × REP_SCALE；key：涉及门派弟子→该门派名；
   *  发生地对应某门派地盘(sect.region/homeRegion)→该门派名；否则 '*'（全江湖声望）。 */
  applyRumorReputation(seed, room, about, subject) {
    const p = this.player;
    if (!p) return;
    /* ⚠️ R4（design/27 §2.6）：世界传闻（天灾/械斗…）subject 不是玩家，
       绝不能把 Δrep 记到玩家头上。这里加 subject 守卫（缺省 subject='player' 不变）。 */
    if ((subject || 'player') !== 'player') return;
    if (!p.reputation) p.reputation = {};
    /* B23（design/12）：原来的 `polarity × weight × (heat0/100)` 落在 **0.4 ~ 4.0** 一格，
       而江湖上认得的声望刻度是十位数起（势力/官府事件按 ±40 那种量级设的门槛）。
       结果是「杀一个成名人物只掉 2.55 点」，得犯十几次恶才有人拿你当回事 —— 数字上对，
       手感上错。这里乘一个**显式刻度**把它抬到人类能感知的量级（一次恶行 −10~−35）。
       刻度单列成常量而不是把公式里的数改掉，是为了让「量级」这件事**有一个地方可调**。 */
    const drep = seed.polarity * seed.weight * (seed.heat0 / 100) * REP_SCALE;
    let key = '*';
    const aboutDef = about && this.data.npcs[about];
    if (aboutDef && aboutDef.sect) key = aboutDef.sect;
    else if (room && room.region) {
      for (const sid of Object.keys(this.data.sects || {})) {
        const sc = this.data.sects[sid];
        if (sc && ((sc.region || sc.homeRegion) === room.region)) { key = sid; break; }
      }
    }
    p.reputation[key] = (p.reputation[key] || 0) + drep;
  }

  /** 每日结算：热度衰减 + 区域扩散/衰减 + 走样 + 消亡 + 地域知名度累加。
   *  挂在 advanceTime 跨日时调用（onDayTick 内部点）。 */
  dailyRumorTick() {
    const day = Math.floor(this.clockMinutes / 1440);
    const dead = [];
    for (const r of this.rumors) {
      const seed = this.data.rumorSeeds && this.data.rumorSeeds[r.seedId];
      const tau = (seed && seed.tauDays) || 6;
      const ttl = (seed && seed.ttlDays) || 20;
      const dt = day - r.bornDay;
      r.heat = Math.round(r.heat0 * Math.exp(-dt / tau));
      /* 本地遗忘基线：每个仍有强度的 region 衰减后的值（>0.5 才保留）。
         ⚠️ 必须先算基线再累加增益——否则 `next[rg]=s` 直接赋值会把邻居汇入的增益覆盖掉，
         邻区永远收不到扩散。 */
      const base = {};
      for (const rg of Object.keys(r.spread)) {
        const s = r.spread[rg] * Math.exp(-1 / tau);
        if (s > 0.5) base[rg] = s;
      }
      const next = Object.assign({}, base);
      for (const rg of Object.keys(base)) {
        const k = (this.kFlow[rg] !== undefined) ? this.kFlow[rg] : 0.15;
        const adj = this.regionAdj[rg] || {};
        for (const nb of Object.keys(adj)) {
          const gain = base[rg] * k * 0.35;
          if (gain <= 0.5) continue;
          next[nb] = Math.min(100, (next[nb] || 0) + gain);
          // 走样：每扩散一跳 truth 偏移（±8），hopCount+1
          r.truth = clamp(r.truth + Math.round((this.rng.next() * 16) - 8), 0, 100);
          r.hopCount++;
        }
      }
      r.spread = next;
      const maxS = Object.keys(r.spread).length ? Math.max.apply(null, Object.values(r.spread)) : 0;
      if (maxS < 5 || dt > ttl) { dead.push(r.uid); continue; }
      // 地域知名度（fame）：在仍有显著强度的 region 累加一次，钳制 0~100
      const p = this.player;
      if (p) {
        p.fame = p.fame || {};
        for (const rg of Object.keys(r.spread)) {
          if (r.spread[rg] > 5) {
            p.fame[rg] = clamp((p.fame[rg] || 0) + 0.1 * (r.spread[rg] / 100) * (r.heat0 / 100) * 10, 0, 100);
          }
        }
      }
    }
    if (dead.length) this.rumors = this.rumors.filter(r => dead.indexOf(r.uid) < 0);
    /* ---- 把「风声有多大」写进玩家变量，供世界事件读（design/27 §5.5.3）----
       ⚠️ 为什么非写不可：W5 事件库里好几条是「江湖上关于你的话传开了」——
       `w5_foe_bribe`（有人托话：heat_bad ≥ 10）、`w5_foe_slander`（造谣：heat ≥ 30）、
       `w5_sect_hunt`（联手追杀：heat_bad ≥ 70）。这些条件读的是 `p.vars.rumor_heat_*`，
       而**全仓没有任何地方写过这两个变量** —— 恒为 0，那三条事件**永远不可能触发**，
       且不会报错。这正是总纲说的「写了不生效」那一族。
       口径：`_max` = 全部活跃传闻里最高的一份热度；`_bad_max` = 其中**对你不利的**
       （`seed.polarity < 0`）那一批的最高热度 —— 行善传得越广不该让你被追杀，
       所以「联手追杀」只认坏话（与 §5.5.4「heat_max / bad_max 分工」一致）。 */
    if (this.player) {
      let hmax = 0, bmax = 0;
      for (const r of this.rumors) {
        const seed = this.data.rumorSeeds && this.data.rumorSeeds[r.seedId];
        const h = r.heat || 0;
        if (h > hmax) hmax = h;
        if (seed && (seed.polarity || 0) < 0 && h > bmax) bmax = h;
      }
      const pl = this.player;
      pl.setVar('rumor_heat_max', Math.round(hmax));
      pl.setVar('rumor_heat_bad_max', Math.round(bmax));
      /* 顺带把三个「事件要读、但没人写过」的玩家状态同步过去 ——
         同一个坑：`w5_wanted_amnesty` 早就写了 `var: wanted >= 1`，
         而恶名的真身是 `p.kidnap.wanted`（kidnap.js），两个名字对不上，
         所以「大赦」这条**从来没触发过**。这里做一次归一（每跨日一次，开销可忽略）：
           · wanted      ← p.kidnap.wanted（略卖、逼良为娼攒下的律罪档 0~100）
           · has_debt    ← p.kidnap.debt（欠着人钱）
           · family_count← 正妻 + 妾 + 结义（「仇家拿你的家眷做筏」要读它） */
      pl.setVar('wanted', Math.round((pl.kidnap && pl.kidnap.wanted) || 0));
      pl.setVar('has_debt', (pl.kidnap && pl.kidnap.debt) ? 1 : 0);
      const mg = pl.marriage || {};
      pl.setVar('family_count', (mg.spouse ? 1 : 0) + ((mg.concubines || []).length) + ((mg.bonds || []).length));
    }
  }

  /** 按 truth 档位渲染传闻文本（实时，不固化——truth 跨档才换说法，这正是「走样」）。 */
  fillRumorText(rumor) {
    const seed = this.data.rumorSeeds && this.data.rumorSeeds[rumor.seedId];
    if (!seed) return '';
    const tier = rumor.truth >= 70 ? 'true' : (rumor.truth >= 40 ? 'half' : 'false');
    let t = (seed.texts[tier] || seed.texts.true || '');
    const v = rumor.vars || {};
    t = t.replace(/\{who\}/g, v.who || '有人').replace(/\{where\}/g, v.where || '某处').replace(/\{whom\}/g, v.whom || '一个人');
    return t;
  }

  /** 玩家在某 region 打听：返回活跃且在该区有强度的传闻（最多 limit 条）。
   *  keyword 非空时按 vars(who/whom) 与 marks 过滤。 */
  listenRumors(region, keyword, limit) {
    limit = limit || 3;
    const list = [];
    for (const r of this.rumors) {
      const s = r.spread[region] || 0;
      if (s < 1) continue;
      if (keyword) {
        const v = r.vars || {};
        const hit = (v.who && v.who.indexOf(keyword) >= 0)
          || (v.whom && v.whom.indexOf(keyword) >= 0)
          || (r.marks || []).indexOf(keyword) >= 0;
        if (!hit) continue;
      }
      list.push(r);
    }
    list.sort((a, b) => (b.heat * (b.spread[region] || 0)) - (a.heat * (a.spread[region] || 0)));
    return list.slice(0, limit);
  }

  /* ================================================================
   * 六之三、世界动态 W6/W7（#109 后续块 · design/27 落地）
   *  W6 势力消长：月度结算（day % 30 === 0），运行值 factionState（模板 data.factions）
   *  W7 节庆日历：day % 120 命中 data.calendar.festivals
   *  ⚠️ W5 事件库走数据（70_world.json → worldEvents），本块只做「算」与「写 p.vars」，
   *     W5 的 cond 只读 p.vars（design/25 §10.1 契约：#116/W6 只写、W5 只读）。
   * ================================================================ */

  /** 从 data.factions 建运行值（模板→运行值分离；deserialize 会覆盖回存档值）。 */
  initWorldDynamics() {
    const src = this.data.factions || {};
    const fs = {};
    for (const id of Object.keys(src)) {
      const f = src[id] || {};
      fs[id] = {
        id, name: f.name || id, kind: f.kind || '门派', align: f.align || '中立',
        homeRegion: f.homeRegion || null,
        power: typeof f.power === 'number' ? f.power : 50,
        treasury: typeof f.treasury === 'number' ? f.treasury : 1000,
        territories: (f.territories || []).slice(),
        mood: f.mood || '守成',
      };
    }
    /* 关系初值（design/27 §3.1）：正道↔正道 +40 / 正道↔魔道 −60 / 魔道↔魔道 −20；
       ↔朝廷：正道 +20、魔道 −50；gang（商会）与所有门派 +10。对称矩阵，存上三角即可。 */
    const rel = {};
    const ids = Object.keys(fs);
    const pair = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
    const base = (a, b) => {
      const A = fs[a], B = fs[b];
      if (A.kind === '商会' || B.kind === '商会') return 10;
      /* 门派数据的阵营字段是 正道 / 中立 / 邪道（30_sects.json 实测）；
         设计稿写「魔道」→ 这里把 邪道 归一到 魔道 再相比。 */
      const nm = (x) => (x === '邪道' ? '魔道' : x);
      const x = nm(A.align), y = nm(B.align);
      if (x === '正道' && y === '正道') return 40;
      if (x === '魔道' && y === '魔道') return -20;
      if ((x === '正道' && y === '魔道') || (x === '魔道' && y === '正道')) return -60;
      if (y === '官府') return x === '正道' ? 20 : (x === '魔道' ? -50 : 0);
      if (x === '官府') return y === '正道' ? 20 : (y === '魔道' ? -50 : 0);
      return 0;
    };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) rel[pair(ids[i], ids[j])] = base(ids[i], ids[j]);
    }
    /* 手设关系覆盖（design/40 §5.5-⑦）：
       默认矩阵只按 align 推 —— 正道↔正道一律 +40，可「五岳并派之争」这种
       **同阵营的世仇**推不出来（泰山不服华山居首）。覆盖表就是干这个的。
       ⚠️ 值必须是数字：`data.relationsOverride` 是 byId 合并，对象值会被揉成 {id:...}。 */
    const ov = this.data.relationsOverride || {};
    for (const k of Object.keys(ov)) {
      if (typeof ov[k] === 'number') rel[k] = ov[k];
    }
    this.factionState = { factions: fs, relations: rel, lastMonth: null };
  }

  /** 两派之间的梁子（纯文本，来自 data.factionFeud）——没有就返回 null */
  factionFeudOf(a, b) {
    if (!a || !b || a === b) return null;
    const k = a < b ? a + '|' + b : b + '|' + a;
    const m = this.data.factionFeud || {};
    return m[k] || null;
  }

  /** 关系值 → 中文分档（邦交面板/摩擦文案共用一份口径） */
  factionRelWord(v) {
    if (v >= 60) return '亲如一家';
    if (v >= 25) return '交好';
    if (v > -25) return '泛泛';
    if (v > -60) return '不睦';
    return '死仇';
  }

  /** 该 region 是否属于某势力地盘；返回势力 id（先看 territories，再看 homeRegion）。 */
  factionOfRegion(regionId) {
    const st = this.factionState;
    if (!st || !regionId) return null;
    for (const id of Object.keys(st.factions)) {
      if ((st.factions[id].territories || []).indexOf(regionId) >= 0) return id;
    }
    for (const id of Object.keys(st.factions)) {
      if (st.factions[id].homeRegion === regionId) return id;
    }
    return null;
  }

  /** 势力关系值（对称矩阵，缺省 0）。 */
  factionRel(a, b) {
    const st = this.factionState;
    if (!st) return 0;
    const k = a < b ? a + '|' + b : b + '|' + a;
    return st.relations[k] === undefined ? 0 : st.relations[k];
  }

  /** 门派弟子数（模板口径：data.npcs 里 def.sect === id）。 */
  countSectDisciples(sectId) {
    let n = 0;
    for (const id of Object.keys(this.data.npcs || {})) {
      const d = this.data.npcs[id];
      if (d && d.sect === sectId) n++;
    }
    return n;
  }

  /** 每日世界动态（跨日时由 _advanceTime 调用）：W7 节庆 + W6 月度 + 写 p.vars。 */
  worldDynamics(day) {
    if (!this.factionState) this.initWorldDynamics();
    const p = this.player;
    if (!p) return;
    this.runCalendar(day);
    if (day > 0 && day % 30 === 0) this.runFactionMonth(day);
    this.syncFactionVars();
  }

  /** 一年多少天（data.calendar.yearDays；缺省 120）。⚠️ 一律按数字校验后用 ——
   *  万一将来某条合并路径又把原语揉成对象，这里不会静默变成 NaN。 */
  yearDays() {
    const y = this.data.calendar && this.data.calendar.yearDays;
    return (typeof y === 'number' && y > 0) ? y : 120;
  }

  /** W7：节庆日历（day % yearDays 命中 data.calendar.festivals → 执行其 effects；
   *  另按 calendar.cycles 的 periodDays/offset/span 判周期大事）。 */
  runCalendar(day) {
    const cal = this.data.calendar || {};
    const yd = this.yearDays();
    const d = ((day % yd) + yd) % yd;
    const ctx = { player: this.player, world: this };
    const push = (effects) => { for (const l of evalEffects(effects || [], ctx)) this.emit('storyline', { line: l }); };
    this.calendarState = this.calendarState || {};
    const fest = (cal.festivals || []).find(f => f.day === d);
    if (fest) {
      this.calendarState.lastFestival = { id: fest.id, name: fest.name, day };
      push(fest.effects);
    }
    for (const cy of cal.cycles || []) {
      const per = cy.periodDays || 0;
      if (!per) continue;
      const off = cy.offset || 0;
      const span = cy.span || 1;
      if ((day % per) >= off && (day % per) < (off + span)) {
        this.calendarState.lastCycle = { id: cy.id, name: cy.name, day };
        push(cy.effects);
      }
    }
  }

  /** 今日是否节庆（供 look / talk 渲染用；不落盘，按 day 现算）。 */
  festivalToday() {
    const cal = this.data.calendar || {};
    const yd = this.yearDays();
    const d = ((Math.floor(this.clockMinutes / 1440) % yd) + yd) % yd;
    return (cal.festivals || []).find(f => f.day === d) || null;
  }

  /** W6：月度结算（design/27 §3.2 重标定公式）。 */
  runFactionMonth(day) {
    const st = this.factionState;
    const byReg = this._roomsByRegion || {};
    for (const id of Object.keys(st.factions)) {
      const f = st.factions[id];
      let income = 0;
      for (const rg of f.territories) {
        const rooms = (byReg[rg] || []).length;
        const tax = 1 + Math.floor(rooms / 12);          // 实测税基（R6 重标定）
        income += tax * (40 + f.power) / 100;
      }
      const disciples = this.countSectDisciples(id);
      const extra = (f.mood === '进取') ? 4 : 0;
      const E = disciples * 3 + extra;
      const dp = clamp((income - E) * 0.6, -4, 4);        // 单月最多 ±4
      f.power = clamp(Math.round((f.power + dp) * 10) / 10, 0, 100);
      f.treasury = Math.round(f.treasury + (income - E) * 20);
      /* mood 按 power / treasury 迁移（design/27 §3.3 第 4 条：弟子台词按 mood 换组） */
      if (f.treasury < 0 || f.power < 25) f.mood = '窘迫';
      else if (f.power >= 75) f.mood = '进取';
      else if (f.mood === '窘迫' && f.power >= 40) f.mood = '守成';
    }
    /* 关系漂移：Δrel[a][b] = clamp(−0.02×(power_a − power_b), −3, +3) */
    const ids = Object.keys(st.factions);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = st.factions[ids[i]], b = st.factions[ids[j]];
        const k = ids[i] + '|' + ids[j];
        const drift = clamp(-0.02 * (a.power - b.power), -3, 3);
        st.relations[k] = clamp((st.relations[k] || 0) + drift, -100, 100);
      }
    }
    st.lastMonth = day;
  }

  /** 把势力状态写进 p.vars（W5 的 cond 只读 p.vars —— design/25 §10.1）。 */
  syncFactionVars() {
    const p = this.player;
    const st = this.factionState;
    if (!p || !st) return;
    if (!p.vars) p.vars = {};
    let relMin = 0;
    for (const id of Object.keys(st.factions)) {
      const f = st.factions[id];
      p.vars['faction_power_' + id] = Math.round(f.power);
      p.vars['faction_treasury_' + id] = Math.round(f.treasury);
      p.vars['faction_mood_' + id] = f.mood;
    }
    const ids = Object.keys(st.factions);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const v = st.relations[ids[i] + '|' + ids[j]];
        if (v !== undefined) {
          p.vars['faction_rel_' + ids[i] + '_' + ids[j]] = v;
          if (v < relMin) relMin = v;
        }
      }
    }
    p.vars.faction_rel_all = relMin;   // 「最低的一段关系」（恶名事件读它）
  }

  /**
   * 把某个 NPC 的信任度同步进 `p.vars.trust_<defId>`。
   *
   * ⚠️ 为什么非有这个方法不可（「写了不生效」的又一例）：
   *   画像的 `hooks[].trigger` 一律写成 `{ var:'trust_<npcId>', op:'>=', value:N }`
   *   （51 个人都是这么写的），而 `trust` 真身是 `npc.pstate.trust` ——
   *   两个名字对不上，`p.vars` 里那个键**全仓没有任何地方写过**，
   *   于是条件恒不成立、钩子一个也触发不了，还一声不吭。
   *   和 W5 事件库那批 `faction_power_*` 是同一个坑，处理方式也一样：
   *   **在读写交界处做一次归一**，而不是让每处引用各写一份。
   */
  syncTrustVar(npc) {
    if (!npc || !this.player) return;
    const id = npc.defId || npc.id;
    if (!id) return;
    this.player.setVar('trust_' + id, Math.round((npc.pstate && npc.pstate.trust) || 0));
  }

  inPlayerParty(npc, battle) {
    if (!battle) return true;
    return [].concat(battle.attackers).some(c => c === this.player || c.isSquad && c.members.includes(this.player));
  }

  /* ================================================================
   * 四、物品操作
   * ================================================================ */

  makeItem(itemId) {
    const def = this.data.items[itemId];
    if (!def) return null;
    const it = Object.assign({}, def, { id: itemId });
    if (!it.uid) it.uid = uid('it');
    if (it.durability === undefined) it.durability = 100;
    if (it.maxDurability === undefined) it.maxDurability = 100;
    if (it.stackable === undefined) it.stackable = !!(it.type === 'material' || it.type === 'consumable' || it.type === 'herb');
    if (it.count === undefined) it.count = 1;
    return it;
  }

  /** 给玩家/角色物品，返回 {ok,name} */
  giveItem(ch, itemId, n, opts) {
    n = n || 1;
    const w = this;
    const def = this.data.items[itemId];
    if (!def) return { ok: false, name: itemId };
    ch.inventory = ch.inventory || [];
    let added = 0;
    for (let i = 0; i < n; i++) {
      const it = Object.assign({}, def, { id: itemId, uid: uid('it'), count: 1 });
      if (it.durability === undefined) it.durability = 100;
      if (it.maxDurability === undefined) it.maxDurability = 100;
      // 可堆叠自动叠加
      if (it.stackable) {
        const found = ch.inventory.find(x => x.id === itemId && (x.count || 1) < (x.stackMax || 999));
        if (found) { found.count = (found.count || 1) + 1; added++; continue; }
      }
      if (!this.checkCarryLimit(ch, it)) {
        if (!opts || !opts.silent) this.emit('notice', { text: '你身上东西太多，拿不下了。' });
        break;
      }
      ch.inventory.push(it);
      added++;
    }
    return { ok: added > 0, name: def.name, count: added };
  }

  removeItem(ch, itemId, n) {
    n = n || 1;
    ch.inventory = ch.inventory || [];
    const def = this.data.items[itemId];
    let removed = 0;
    for (let i = ch.inventory.length - 1; i >= 0 && removed < n; i--) {
      const it = ch.inventory[i];
      const match = it.id === itemId || (it.stackKey && def && it.stackKey === def.stackKey);
      if (!match) continue;
      const c = it.count || 1;
      if (c > n - removed) { it.count = c - (n - removed); removed = n; }
      else { removed += c; ch.inventory.splice(i, 1); }
    }
    return { ok: removed > 0, name: def ? def.name : itemId, count: removed };
  }

  checkCarryLimit(ch, item) {
    const limit = 20 + (ch.attrTotal('力量') || 0) + ch.level;
    const count = (ch.inventory || []).reduce((s, i) => s + (i.stackable ? 1 : (i.count || 1)), 0);
    return count < limit;
  }

  equipItem(ch, uidOrId) {
    ch.inventory = ch.inventory || [];
    const it = ch.inventory.find(i => i.uid === uidOrId) || ch.inventory.find(i => i.id === uidOrId);
    if (!it) return { ok: false, msg: '你身上没有这件东西。' };
    const def = this.data.items[it.id];
    if (!def) return { ok: false, msg: '这东西无法装备。' };
    const slot = def.slot || this.slotForType(def.type);
    if (!slot) return { ok: false, msg: `${def.name}不是可装备之物。` };
    if (def.require) {
      const { evalCond } = require('./modapi');
      if (!evalCond(def.require, { player: ch, world: this })) return { ok: false, msg: `你还不够资格使用${def.name}。` };
    }
    // 卸下原装备
    if (ch.equipment[slot]) {
      const old = ch.equipment[slot];
      const oldUid = ch.equipmentUid ? ch.equipmentUid[slot] : null;
      const restore = (ch.inventory || []).find(i => i.uid === oldUid) || this.makeItem(old);
      if (restore && !(ch.inventory || []).includes(restore)) (ch.inventory = ch.inventory || []).push(restore);
    }
    ch.equipment[slot] = it.id;
    ch.equipmentUid = ch.equipmentUid || {};
    ch.equipmentUid[slot] = it.uid;
    ch.equipped[slot] = it.id;
    // 从背包移除（装备不占背包）
    const idx = ch.inventory.indexOf(it);
    if (idx >= 0) ch.inventory.splice(idx, 1);
    // 武学类装备（武器带武学）
    if (def.grantsSkill && !ch.learned[def.grantsSkill]) ch.learnSkill(def.grantsSkill);
    ch.recalc();
    this.emit('equip', { ch, item: it, slot });
    return { ok: true, msg: `你装备上了${def.name}。`, slot };
  }

  unequipItem(ch, slot) {
    if (!ch.equipment[slot]) return { ok: false, msg: '那个部位没有装备。' };
    const itemId = ch.equipment[slot];
    const itemUid = ch.equipmentUid ? ch.equipmentUid[slot] : null;
    const def = this.data.items[itemId];
    const it = (ch.inventory || []).find(i => i.uid === itemUid) || Object.assign({}, def, { id: itemId, uid: itemUid || uid('it'), count: 1 });
    if (!(ch.inventory || []).includes(it)) { ch.inventory = ch.inventory || []; ch.inventory.push(it); }
    ch.equipment[slot] = null;
    if (ch.equipmentUid) delete ch.equipmentUid[slot];
    delete ch.equipped[slot];
    ch.recalc();
    return { ok: true, msg: `你卸下了${def ? def.name : itemId}。` };
  }

  slotForType(t) {
    return {
      weapon: '武器', armor: '身体', helmet: '头部', boots: '脚部', gloves: '手部',
      necklace: '颈部', ring: '戒指', cloak: '披风', shield: '副手', accessory: '饰品',
    }[t] || null;
  }

  /* 装备位展示清单（木瓢案 · 主人 2026-10-17）：
     equipItem 认任意 `def.slot`（数据写「手持」就装进 equipment['手持']），
     但展示侧（engine.equipmentList / commands 装备面板）原来各写一份**固定十位表**，
     没有「手持」——结果装备成功、界面看不见（铁律 29 同族：不报错，只是没有）。
     ⇒ 固定表 + 动态并集：p.equipment 里实际出现、固定表没有的槽位追加在后。
        两个消费点共用这一份，别再各写各的。 */
  equipSlots(ch) {
    const fixed = ['头部', '颈部', '身体', '披风', '手部', '脚部', '武器', '副手', '戒指', '饰品'];
    const extra = Object.keys((ch && ch.equipment) || {}).filter(s => s && !fixed.includes(s));
    return fixed.concat(extra);
  }

  /** 使用物品 */
  useItem(ch, uidOrId) {
    const it = (ch.inventory || []).find(i => i.uid === uidOrId) || (ch.inventory || []).find(i => i.id === uidOrId);
    if (!it) return { ok: false, msg: '你没有这样东西。', lines: [] };
    const def = this.data.items[it.id];
    if (!def) return { ok: false, msg: '这东西无法使用。', lines: [] };

    // 书籍：学武学
    if (def.type === 'book' && def.teach) {
      const sd = this.data.skills[def.teach];
      if (!sd) return { ok: false, msg: '书中内容晦涩难懂。', lines: [] };
      if (ch.learned[def.teach]) return { ok: false, msg: `你已经学过${sd.name}了。`, lines: [] };
      if (def.require) {
        const { evalCond } = require('./modapi');
        if (!evalCond(def.require, { player: ch, world: this })) return { ok: false, msg: `以你目前的修为还读不懂这本${def.name}。`, lines: [] };
      }
      /* ⚠️ 这里原来收「潜能」（`def.cost || 100`）—— 潜能已废除（2026-10-11）。
         顺带说明它当初为什么从来没生效：这条分支要求书声明 `teach`，
         而全库 9 本 `type: book` 一本都没写 `teach` ⇒ 这条路根本没通过一次。
         现在书该不该收代价改看 `def.cost` 有没有写：写了就按**内力**收，没写就白读。 */
      const cost = Number(def.cost) || 0;
      if (cost > 0) {
        if (ch.mp < cost) return { ok: false, msg: `研读此书要耗 ${cost} 点内力，你先养足了再来。`, lines: [] };
        ch.mp -= cost;
      }
      const r = ch.learnSkill(def.teach);
      ch.advanceTime(def.timeCost || 60);
      const lines = [{ kind: 'story', text: `你翻开《${def.name}》，逐字参研…` }, { kind: 'sys', text: r.msg }];
      if (def.consume !== false) this.removeItem(ch, it.id, 1);
      ch.recalc();
      return { ok: true, msg: r.msg, lines };
    }

    // 消耗品
    if (def.use) {
      const lines = [];
      /* 简化对象形式：{ food, water, hp, mp, nausea } —— 食物/生肉专用
         （evalEffects 只认 {type,args} 数组，这种 key=数值 的对象会静默失效） */
      if (!Array.isArray(def.use) && typeof def.use === 'object' && !def.use.type && def.use.if === undefined) {
        const u = def.use;
        if (u.nausea) {
          // 生食：恶心呕吐，只顶三成饱，还伤身
          lines.push({ kind: 'warn', text: `你生嚼${def.name}，一股腥气直冲脑门，恶心欲呕……` });
          ch.food = clamp(ch.food + Math.floor((u.food || 0) * 0.3), 0, ch.maxFood);
          if (u.water) ch.water = clamp(ch.water + u.water, 0, ch.maxWater);
          ch.hp = Math.max(1, ch.hp - 8);
          lines.push({ kind: 'sys', text: '这生食腥臊难咽，你几乎没吃下多少，还闹得胃里翻江倒海。' });
        } else {
          if (u.food) { ch.food = clamp(ch.food + u.food, 0, ch.maxFood); lines.push({ kind: 'sys', text: '你觉得饱了些。' }); }
          if (u.water) { ch.water = clamp(ch.water + u.water, 0, ch.maxWater); lines.push({ kind: 'sys', text: u.water > 0 ? '你觉得解渴了。' : '这吃食有些燥。' }); }
          if (u.hp) ch.hp = clamp(ch.hp + u.hp, 0, ch.maxHp);
          if (u.mp) ch.mp = clamp(ch.mp + u.mp, 0, ch.maxMp);
          if (!u.food && !u.water && !u.hp && !u.mp) lines.push({ kind: 'sys', text: `你用了${def.name}，却没什么特别的感觉。` });
        }
      } else {
        const { evalEffects } = require('./modapi');
        const effs = evalEffects(def.use, { player: ch, world: this });
        effs.forEach(e => lines.push(e));
      }
      if (def.equipAfter) { /* noop */ }
      if (def.consume !== false) this.removeItem(ch, it.id, 1);
      ch.recalc();
      this.advanceTime(1);
      return { ok: true, msg: `你使用了${def.name}。`, lines };
    }
    if (def.type === 'consumable' || def.type === 'food' || def.type === 'herb') {
      const lines = [];
      if (def.healHp) { ch.hp = clamp(ch.hp + def.healHp, 0, ch.maxHp); lines.push({ kind: 'sys', text: `你的伤势好转了 ${def.healHp} 点。` }); }
      if (def.healMp) { ch.mp = clamp(ch.mp + def.healMp, 0, ch.maxMp); lines.push({ kind: 'sys', text: `你的内力恢复了 ${def.healMp} 点。` }); }
      if (def.healFood) { ch.food = clamp(ch.food + def.healFood, 0, ch.maxFood); lines.push({ kind: 'sys', text: '你觉得饱了些。' }); }
      if (def.healWater) { ch.water = clamp(ch.water + def.healWater, 0, ch.maxWater); lines.push({ kind: 'sys', text: '你不那么渴了。' }); }
      if (def.cure) { ch.removeBuff('poison'); lines.push({ kind: 'sys', text: '你体内的毒素被化解了。' }); }
      if (!lines.length) lines.push({ kind: 'sys', text: `你用了${def.name}，却没什么特别的感觉。` });
      if (def.consume !== false) this.removeItem(ch, it.id, 1);
      ch.recalc();
      this.advanceTime(1);
      return { ok: true, msg: `你使用了${def.name}。`, lines };
    }

    return { ok: false, msg: `${def.name}不能直接使用（试试装备或查看）。`, lines: [] };
  }

  dropItem(ch, uidOrId) {
    const it = (ch.inventory || []).find(i => i.uid === uidOrId) || (ch.inventory || []).find(i => i.id === uidOrId);
    if (!it) return { ok: false, msg: '你没有这样东西。' };
    const def = this.data.items[it.id];
    const idx = ch.inventory.indexOf(it);
    ch.inventory.splice(idx, 1);
    this.instances.items[it.uid] = { id: it.uid, itemId: it.id, room: ch.room, count: it.count || 1, custom: it };
    return { ok: true, msg: `你丢下了${def ? def.name : it.id}。` };
  }

  pickupItem(ch, keyword) {
    const here = this.itemsIn(ch.room);
    // 尸体内的东西
    const corpses = this.corpsesIn(ch.room);
    let pool = here.map(i => ({ ...i, _kind: 'ground' }));
    for (const c of corpses) for (const l of c.loot) pool.push({ itemId: l, room: ch.room, _kind: 'corpse', corpse: c });
    const def = this.data.items;
    const hit = fuzzyFind(pool, keyword, x => (def[x.itemId] ? def[x.itemId].name : x.itemId));
    if (!hit) return { ok: false, msg: `这里没有「${keyword}」。` };
    const r = this.giveItem(ch, hit.itemId, hit.count || 1);
    if (!r.ok) return { ok: false, msg: '你拿不动更多东西了。' };
    if (hit._kind === 'ground') delete this.instances.items[hit.id];
    else if (hit.corpse) { const i = hit.corpse.loot.indexOf(hit.itemId); if (i >= 0) hit.corpse.loot.splice(i, 1); }
    return { ok: true, msg: `你拾起了${r.name}。` };
  }

  /* ================================================================
   * 五、移动
   * ================================================================ */
  movePlayerTo(ch, roomId) {
    /* 吐纳中不能走动（主人定的规矩：吐纳过程人得坐着）。
       放在这个**唯一移动收敛点**上，方向键 / go / 传送都拦得住。
       ⚠️ 玩家走方向键的那种「想走了」由 `engine.exec` 先一步接下 ——
         它认出这不是「继续吐纳」，会把坐忘收掉再执行移动（主人 2026-10-11：
         「点页面任意其他按钮自动退出吐纳状态」）。所以这里拦下的，是**不经过 exec
         的移动**（剧情摆位 / 传送），那些场景本来就不该把人从坐忘里拽走。 */
    if (ch.isPlayer && require('./neigong').blocksMove(ch)) {
      return { ok: false, msg: '你正坐着吐纳，气行到一半，身子还沉。想醒过来，点屏幕上随便哪个别的按钮。' };
    }
    /* 双修 / 采补当中同样不能走（主人 2026-10-11：「不能随意移动」）。
       收敛在同一个点上，方向键 / go / 传送都拦得住；玩家主动走的那条路见上。 */
    if (ch.isPlayer && require('./dualcultivate').blocksMove(ch)) {
      return { ok: false, msg: '这会儿脱不开身。想走开，点屏幕上随便哪个别的按钮。' };
    }
    const room = this.data.rooms[roomId];
    if (!room) return { ok: false, msg: `（不存在房间：${roomId}）` };
    const old = this.data.rooms[ch.room];
    /* 私域（B/C 层虚拟宅院）：走出去就拆掉并把主人送回原处。
       挂在 movePlayerTo 是因为所有移动（方向键 / go / 传送）都收敛到这里，
       是唯一的「离院」出口，不会漏（design/09 §3.3）。
       ⚠️ 判据是 `_privateHost`（拜访建的），不是 `private` ——
          后者被家园/主宅/宗门占用，一刀切会删掉玩家自己的房。 */
    if (old && old._privateHost && old.id !== roomId) this.leaveHouse(old.id);
    ch.room = roomId;
    /* 野怪离场计时（2026-10-18「山贼×4」）：玩家挪窝后，原房间里 encounter
       刷的野怪（_encWild）开始倒数（消散扫描在 worldTick）；宽限期内回屋
       则清戳重新计时——「连续离场两轮才消散」，回屋续命不凭空蒸发。
       所有位移——方向键 / go / 传送 / 剧情推人——都收敛到这一处，不会漏。 */
    if (ch.isPlayer && old) {
      for (const n of Object.values(this.instances.npcs)) {
        if (!n || !n._encWild) continue;
        if (n.room === old.id) { if (n._encWildLeaveTick == null) n._encWildLeaveTick = this._tickNo || 0; }
        else if (n.room === roomId) n._encWildLeaveTick = null;   /* 人回来了，重新计时 */
      }
    }
    this.emit('roomchange', { ch, from: old ? old.id : null, to: roomId });
    this.fireEvent('onEnter', { roomId, ch });
    /* NPC 是懒实例化的：不先把这一带「活化」出来，刚踏进空屋子时
       「初见相性」一个人都抓不到（`npcsIn` 只会返回已存在的实例）。
       ⚠️ 这一步（以及初见相性）必须放在 movePlayerTo、**不能放进 onRoomEnter**：
          onRoomEnter 也被「遭遇战 / 目击者」等路径直接调用，
          那些场景要求房间**保持原样**（BLK-1 的反证组正是靠「房里没人」
          来证明目击者台词确实来自目击者）——在里面补人会当场毁掉那条差分。 */
    const meetLines = [];
    if (ch.isPlayer && !this.battle) {
      const personaMod = require('./personality');
      try { require('./ambience').ensureNearbyNpcs(this, 1); } catch (e) { /* 活化失败不该挡路 */ }
      /* ---- 初见相性（主人 2026-10-08：「什么性格的人见面天然增/减好感」）----
         玩家与这里的人**第一次照面**时，按两人性格给第一印象：好感 ±，并出一句神态。
         ⚠️ 一次最多说 3 个人：市集里挤着二十号人，全念一遍比不念还吵；
            剩下的人下次进屋再遇上（`meetAffinity` 按人记「已见过」）。 */
      let shown = 0;
      for (const n of this.npcsIn(ch.room)) {
        if (shown >= 3) break;
        if (!n.isNpc || n.dead || n.knockedOut) continue;
        const meet = personaMod.meetAffinity(this, ch, n);
        if (meet) { meetLines.push(...meet.lines); shown++; }
      }
      /* ---- 触发式支线（主人 2026-10-08）----
         路过某处，故事自己撞上来：失足坠崖 / 撞见有人被追 / 墙角偷跑的姑娘 /
         衙门外来回踱步的人 / 密谋劫狱 / 逃荒的一家人……
         先说故事，再说人 —— 故事是这一趟的「事」，人是屋子里的「景」，事在前头才立得住。 */
      const enc = require('./encounter');
      const fired = enc.maybeFire(this, ch, room);
      if (fired) meetLines.push(...fired.lines);
      /* 「身上有故事的人」给一句钩子（一次最多一个，同一人只说一次）。 */
      meetLines.push(...enc.hintsIn(this, ch, room, 1));
      /* ⚠️ 匪类的事**不在这儿** —— 它会真的动手（startCombat / 改 NPC 状态 / 换房间），
         而 movePlayerTo 是所有位移的收敛点：传送、剧情推人、测试摆位都走它。
         搁在这儿的话，侧线任务里「走过去找她」那一步会莫名其妙打起来
         （真事：`smoke-sidequest` 的非战斗解法当场变成 battle=true）。
         所以匪类事件挂在 `commands.doMove` 上 —— **只有玩家自己一步步走**才闹。 */
    }
    /* ⚠️ onRoomEnter 的返回值必须**带出去**：它产出的是「进屋那一刻才有的见闻」
       （门派摩擦的那句话）。原来这里直接丢弃返回值，于是那处文案**一句都没露过面**
       ——典型铁律「只定义不消费」。`extra` 是新增字段，旧调用方只读 ok/msg，不受影响。 */
    /* 首次踏进一个区域：开眼界也是长进（主人要的「其他方式」之一）。
       每个区只给一次 —— 记在 `seen_region_<id>`，与地图「已探索」那笔账分开记：
       地图那个是「这一间屋子去过没」，这个是「这一片地界来过没」。 */
    try {
      const rid = room.region;
      if (rid && ch && typeof ch.setVar === 'function' && !ch.getVar('seen_region_' + rid)) {
        ch.setVar('seen_region_' + rid, 1);
        require('./potential').grant(ch, require('./potential').REGION_REWARD, meetLines, '新到一处地界');
      }
    } catch (e) { /* 给不成潜能不该挡住走路 */ }

    const extra = this.onRoomEnter(ch, room);
    return { ok: true, msg: '', extra: meetLines.concat(extra || []) };
  }

  /** 进入房间后果：见闻、事件、遭遇 */
  onRoomEnter(ch, room) {
    const lines = [];
    // 房间效果
    if (room.onEnter) {
      const effs = evalEffects(room.onEnter, { player: ch, world: this });
      effs.forEach(e => lines.push(e));
    }
    // 随机遭遇
    /* ---- 门派摩擦（design/40 §5.7，主人要求「敌对门派弟子见面也要有摩擦」）----
       ⚠️ 只做**口头**摩擦。引擎里没有 NPC-NPC 战斗（battle 永远是「玩家 vs 对手」），
          为了一句台词去改战斗模型，风险远大于收益。
       ⚠️ 主人原话的例外：**两人有一定正面交情就不发作** —— 这里判 NPC 对玩家的好感。 */
    if (ch.isPlayer && !this.battle && ch.sect) {
      if (!this.factionState) this.initWorldDynamics();   // 关系矩阵懒建：没这一步摩擦永远不触发
      const mine = this.getSect(ch.sect);
      for (const n of this.npcsIn(ch.room)) {
        if (!n.sect || n.sect === ch.sect || n.dead || n.knockedOut) continue;
        if ((n.favor || 0) >= 20) continue;                  // 有交情 → 相安无事
        /* 同一时辰内别念第二遍（`clockMinutes` 差 < 60）。
           ⚠️ 别用「一辈子只说一次」的布尔标记：那样玩家走开一步再回来，
              对方就跟没看见你一样 —— 摩擦变成了只在第一次进屋才有的演出。 */
        if (n._feudAt && (this.clockMinutes - n._feudAt) < 60) continue;
        const rel = this.factionRel(ch.sect, n.sect);
        if (rel > -25) continue;                             // 「不睦」以上就当没看见（−25 约等于泛泛之交的下沿）
        n._feudAt = this.clockMinutes;
        const theirs = this.getSect(n.sect);
        const feud = this.factionFeudOf(ch.sect, n.sect);
        lines.push({ kind: 'say', text: `${n.name}（${theirs ? theirs.name : n.sect}）见了你，脸色一沉：「${mine ? mine.name : ''}的弟子？」` });
        if (feud) lines.push({ kind: 'plain', text: `（江湖上都知道：${feud}）` });
        else lines.push({ kind: 'plain', text: `（两家积怨已久，见了面都说不上好话。）` });
      }
    }
    // 随机遭遇
    /* 天赋「福星高照」：奇遇/随机遭遇触发概率 ×1.5 —— 进屋掷骰的阈值放宽。
       ⚠️ 倍率只在**这次掷骰的阈值**上生效，池子与后续逻辑不变。 */
    if (room.encounter && this.rng.next() < (room.encounter.chance || 0.2) * this.encounterMult(ch)) {
      const pool = room.encounter.npcs || [];
      if (pool.length) {
        const nid = this.rng.pick(pool);
        /* B12（主人报：「被毒蛇击败后再回去，毒蛇名旁出现 x2」）：
           遭遇是**每次进屋独立掷骰**、且从不查「房里是不是已经有一只」。玩家打赢了
           毒蛇会被 onNpcKilled 清掉（所以平时见不到 x2），可一旦**打输**，毒蛇没死、
           留在了原地；玩家复活回客栈后再进来，又掷中一次 → 原地再刷一只**活**毒蛇 →
           房里两条活毒蛇 → 名字旁显示 x2。**计数没错，错的是重复 spawn。**
           修法：**房里已有活着的同种怪就不再新造，直接拿它再打一场**（re-engage）。
           —— 既不叠同名，又不丢掉这次遭遇（不像「直接不刷」会让再进屋毫无动静）。
           ⚠️ 判据用 `npcsIn`（过滤 dead）——倒地/晕厥的实例不参与复用。
              倒地是玩法的一部分（补刀 / 搜身 / 装袋都靠 downedIn）：
              地上躺着一条时，再进屋**照常**刷一条活的，倒地实例原样保留、不被删。
           ⚠️ 只限「同种不叠加」，不消灭遭遇本身：换个物种照刷。 */
        const existing = this.npcsIn(ch.room).find(n => n.defId === nid) || null;
        const npc = existing || this.spawnNpc(nid, ch.room, 1);
        if (npc) {
          /* 野怪标记（2026-10-18 主人新档「山贼×4」）：encounter 刷的野怪带
             _encWild——玩家离开后两轮 worldTick 消散（见 worldTick 扫描）。
             复用的在岗实例（respawn 定岗那只）不带标记，照旧常驻。 */
          if (!existing) { npc._encWild = true; }
          npc.hostile = true;
          lines.push({ kind: 'warn', text: `【遭遇】${npc.name}拦住去路！` });
          /* ★ 批次 2 返工（BLK-1）：这里原来只有 `this.startCombat(ch, npc);` ——
             **丢弃了返回体**，而目击者反应台词（`lines`）正装在返回体里。
             后果：主人原话场景「看到我被山贼与毒蛇**袭击**」走的就是这条遭遇战路径
             （玩家根本没出手，是被伏击），怯懦者会**默默消失**（行为对），
             但屏幕上**一行台词都没有** —— 观感上等于「还是没反应」。
             `kill` 路径（commands.js）早就老实接了 `r.lines`，只有这里漏了。
             所以必须接住返回体并把台词并进本次房间输出，玩家才真能看到。 */
          const r = this.startCombat(ch, npc, { ambush: true });
          if (r && Array.isArray(r.lines) && r.lines.length) lines.push(...r.lines);
        }
      }
    }
    if (lines.length) this.emit('roomenterlines', { lines });
    return lines;
  }

  /* ================================================================
   * 六、战斗
   * ================================================================ */
  /**
   * 切磋：与 NPC 点到为止地打一场。
   * 与 startCombat 的区别：
   *   - 打不死人（双方血量归零就停）
   *   - 赢了加武功经验 + 好感，输了也加一点好感（对方觉得你有胆气）
   *   - 不会结仇，不触发通缉
   */
  startDuel(ch, npc) {
    const duel = require('./duel');
    /* 三道闸（好感 / 战斗中 / 今日次数）统一在 duel.canDuel 里判 ——
       原来这段逻辑散在这里，加「一天三次」就得再改一遍世界文件。 */
    const gate = duel.canDuel(this, npc);
    if (!gate.ok) {
      /* 按性格拒人（主人：「要么说你太菜下次再来，要么说你很强我不如你，
         根据性格来说对应拒绝的话」）——只有这两类才走 say，
         其余（战斗中/找不到人/对方躺着）是系统提示，走 warn。 */
      const kind = gate.why ? 'say' : 'warn';
      return { lines: [{ kind, text: gate.line }] };
    }
    npc.duel = true;
    npc.hostile = false;
    ch.inCombat = true;
    npc.inCombat = true;
    duel.noteDuel(this, npc.id);
    this.battle = {
      attackers: [ch],
      defenders: [npc],
      turn: 0, log: [], over: false, winner: null,
      startedAt: this.clockMinutes,
      target: npc,
      duel: true,
      /* 应战台词（按性格） + 看客名单在开打时就定下来，
         免得中途有人走开导致结算时点评的人已经不在场 */
      watchers: this.npcsIn(ch.room).map(n => n.id),
    };
    this.emit('combatstart', { battle: this.battle });
    const left = gate.left;
    return {
      battle: this.battle,
      lines: [
        { kind: 'story', text: `${npc.name}${duel.acceptLine(npc)}` },
        { kind: 'hint', text: `（切磋点到为止，不会伤及性命。用「逃跑」可随时收手。今日还可比 ${left} 场。）` },
      ],
    };
  }

  /** 偷窃被抓：记录通缉度，衙门会追捕 */
  emitStealCaught(npc) {
    const p = this.player;
    if (!p) return;
    p.wanted = (p.wanted || 0) + 1;
    const def = (npc && npc.def) || {};
    /* 对方的好友 / 亲人也会掉好感 */
    for (const r of (npc.rel || [])) {
      if (r.kind === '仇') continue;
      const o = this.instances.npcs && Object.values(this.instances.npcs).find(x => x.defId === r.id);
      if (o) o.favor = Math.max(-200, (o.favor || 0) - 6);
    }
    this.emit('stealcaught', { npc, wanted: p.wanted });
    if (p.wanted === 1) {
      this.emit('storyline', { line: { kind: 'warn', text: '【你被记上了】此事若传出去，衙门的捕快怕是要来找你了。' } });
    } else if (p.wanted >= 3) {
      this.emit('storyline', { line: { kind: 'warn', text: `【恶名昭彰】你已作案 ${p.wanted} 次，通缉的画影图形贴满了城门。` } });
    }
  }

  /**
   * 开一场战斗。
   * @param ch           发起方（通常就是玩家）
   * @param targetIdOrNpc 对手（NPC defId / 实例）
   * @param opts         可选 `{ambush:true}` = **是 NPC 伏击玩家**，不是玩家先动的手。
   *                     遭遇战（进屋被山贼/毒蛇拦住去路）走这条。
   *                     为什么非要一个显式标记：`battle.attackers` 按 `startCombat(ch, npc)`
   *                     的形状永远是 `[ch]`，光看数组分不清「谁先动的手」——
   *                     而目击者要判的是**该帮谁**（B30/B7：主人报「我主动打人，
   *                     旁边 NPC 却来帮我，不帮被我打的那个」就是这儿判错的一方）。
   */
  startCombat(ch, targetIdOrNpc, opts) {
    let npc = typeof targetIdOrNpc === 'string' ? this.getNpc(targetIdOrNpc) : targetIdOrNpc;
    if (!npc && typeof targetIdOrNpc === 'string' && this.data.npcs[targetIdOrNpc]) {
      npc = this.spawnNpc(targetIdOrNpc, ch.room, 1);
    }
    if (!npc) return { ok: false, msg: '找不到对手。' };
    ch.inCombat = true;
    npc.inCombat = true;
    this.battle = {
      attackers: [ch],
      defenders: [npc],
      turn: 0, log: [], over: false, winner: null,
      startedAt: this.clockMinutes,
      target: npc,
      /* 谁先动的手：true = NPC 伏击（遭遇战），false/缺省 = 玩家发起 */
      ambush: !!(opts && opts.ambush),
    };
    this.emit('combatstart', { battle: this.battle });
    /* B7：把目击者反应台词带回给调用方（`kill` 指令会并进本次输出）。
       没有这一步的话，反应只存在于事件里，玩家在界面上看不到。 */
    const witnessLines = this._combatWitnessLines || [];
    this._combatWitnessLines = [];
    return { ok: true, battle: this.battle, npc, lines: witnessLines };
  }

  /* 回合推进 + 平局判定 —— **四条分支共用**（普通攻击 / 绝招 / 防御 / 物品）。
     ⚠️ 修的病（主人报的「战斗很怪」第二条）：
        `battle.turn++` 原来只写在 `combat.step()` 里，而**只有「普通攻击」经过它**；
        用绝招 / 防御 / 物品的战斗，回合数**永远不动**，
        于是 `turn > 60` 的平局判定永不触发 —— 打不赢也输不掉就一直耗着，
        玩家的操作只是「看着血条一点点磨」，没有任何一回合是「最后一回合」。
     ⚠️ 放在 `flee` 之后：逃跑不该记一回合，它直接结束战斗。 */
  advanceTurn() {
    const b = this.battle;
    if (!b || b.over) return;
    b.turn = (b.turn || 0) + 1;
    /* 与 `combat.step()` 里那条共用 DRAW_TURNS —— 各写一个 60 就是两份真理 */
    if (b.turn > DRAW_TURNS) { b.over = true; b.winner = 'draw'; }
  }

  combatStep(userAction) {
    if (!this.battle || this.battle.over) return null;

    /* ★ 四分支共用：进任何一个玩家行动分支之前，先把这一回合记上。
       放在这里而不是各分支里，是因为四个分支各有各的提前 return，
       挂在任何一处都会漏（漏了就是「这条分支永不平局」）。 */
    if (userAction !== 'flee') this.advanceTurn();
    if (this.battle.over) {
      /* 平局：把「打满回合」这句话说给玩家听，不然战斗面板直接消失，
         玩家不知道是赢了、输了、还是卡了。 */
      return this.finishCombat([{ kind: 'warn', text: '这一架打了许久，谁也奈何不了谁，各自退开。' }]);
    }

    // 玩家行动
    if (userAction === 'flee') {
      const p = this.player;
      const t = this.battle.defenders[0];
      const chance = clamp(0.3 + (p.speed - (t ? t.speed : 10)) * 0.02, 0.05, 0.9);
      /* 天赋「脚底抹油」：逃跑必成（不看速度、不掷骰） */
      if (this.hasFleeAlways(p) || this.rng.next() < chance) {
        this.battle.over = true; this.battle.winner = 'flee';
        p.inCombat = false;
        (this.battle.defenders || []).forEach(d => d.inCombat = false);
        const b = this.battle; this.battle = null;
        return { lines: [{ kind: 'combat', text: '你抽身疾退，脱离了战斗。' }], over: true, winner: 'flee', battle: b };
      }
      return { lines: this.stepEnemyOnly([{ kind: 'combat', text: '你想跑，却被对方缠住！' }]) };
    }
    if (userAction && userAction.type === 'skill') {
      const p = this.player;
      const t = this.battle.defenders[0];
      const sd = this.data.skills[userAction.skill];
      if (!sd) return null;
      if (!p.learned[sd.id]) { return { lines: [{ kind: 'combat', text: '你尚未学会这门武学。' }] }; }
      /* ---- 武技（skill.moves[]，武学重制 §4.2） ----
         一门武学下挂若干式，各有内力/体力消耗、冷却与解锁门槛。
         冷却挂在 **battle** 上（仿 guardTurns）：这一局用完就散，不会跟着存档漏到下一场。 */
      let mv = null;
      if (userAction.moveId) {
        mv = [].concat(sd.moves || []).find(m => m && m.id === userAction.moveId) || null;
        if (!mv) return { lines: [{ kind: 'warn', text: '没有这一式。' }] };
        if (mv.require) {
          const { evalCond } = require('./modapi');
          if (!evalCond(mv.require, { player: p, world: this })) {
            return { lines: [{ kind: 'warn', text: `你的${sd.name}火候未到，还用不出「${mv.name}」。` }] };
          }
        }
        const cds = this.battle.cooldowns || (this.battle.cooldowns = {});
        if ((cds[mv.id] || 0) > 0) {
          return { lines: [{ kind: 'warn', text: `「${mv.name}」尚未缓过气来（还需 ${cds[mv.id]} 回合）。` }] };
        }
        /* +1 的由来：本回合结束时统一递减一次，若只写 cooldown 会白少算一回合 */
        cds[mv.id] = (mv.cooldown || 0) + 1;
      }
      /* ---- 辅助武技（`mv.support`）：不打人，帮自己 ----
         内功 / 轻功 / 招架 里那些「保命招」（`95_support_moves.json`）。
         它们没有伤害，走 oneAttack 只会白送对方一下；这里单开一条通路：
         加状态（def/dodge/parry）· 硬守一回合 · 回气 · 回血 · 抽身脱战。
         ⚠️ 必须排在 oneAttack 之前 —— 否则会被当成普通招式再打一遍。 */
      if (mv && mv.support) {
        const sp = mv.support;
        const mpNeed = (sd.mpCost || 0) + (mv.mpCost || 0);
        if (mpNeed > p.mp) {
          return { lines: [{ kind: 'combat', text: `${mv.name}要 ${mpNeed} 点内力，你还差些。` }] };
        }
        if (mpNeed) p.mp -= mpNeed;
        const sLines = [{ kind: 'combat', text: sp.text || `你使出「${mv.name}」。` }];
        /* 抽身：不掷骰、必定脱战 —— 这就是这门功夫练来干什么用的。
           与「逃」走同一条收尾（finishCombat），别自己拼。 */
        if (sp.kind === 'escape') {
          const b = this.battle;
          b.over = true; b.winner = 'flee';
          p.inCombat = false;
          (b.defenders || []).forEach(d => { d.inCombat = false; });
          sLines.push({ kind: 'combat', text: '你借这一招错了开去，人已在几丈之外。' });
          return this.finishCombat(sLines);
        }
        const turns = Math.max(1, sp.turns || 2);
        switch (sp.kind) {
          case 'def': case 'dodge': case 'parry':
            p.addBuff({ name: mv.name, turns, mods: { [sp.kind]: (sp.value || 0) }, tag: 'sup:' + mv.id });
            break;
          case 'guard':
            this.battle.guardTurns = Math.max(this.battle.guardTurns || 0, turns);
            break;
          case 'heal': {
            const before = p.hp;
            p.hp = Math.min(p.maxHp, p.hp + (sp.value || 0));
            sLines.push({ kind: 'sys', text: `你缓回一口气（气血 +${Math.round(p.hp - before)}）。` });
            break;
          }
          case 'mp': {
            const before = p.mp;
            p.mp = Math.min(p.maxMp, p.mp + (sp.value || 0));
            sLines.push({ kind: 'sys', text: `散掉的那口元气拢回来些（内力 +${Math.round(p.mp - before)}）。` });
            break;
          }
          default: break;
        }
        return { lines: this.stepEnemyOnly(sLines) };
      }
      const lv = p.skillLevel(sd.id);
      if (item_mp_check(p, sd)) {
        const r = this.combat.oneAttack(p, t, sd, this.battle, 0, mv);
        const lines = [];
        if (r) lines.push(r);
        if (t.hp <= 0) { this.combat.onDeath(t, this.battle, lines, true); this.battle.over = true; this.battle.winner = 'attackers'; }
        if (this.battle.over) return this.finishCombat(lines);
        return { lines: this.stepEnemyOnly(lines) };
      } else {
        return { lines: [{ kind: 'combat', text: `${sd.name}需要 ${sd.mpCost} 点内力，你内力不足。` }] };
      }
    }
    if (userAction && userAction.type === 'defend') {
      /* B4：战斗界面「防御」快捷键的后端。
         语义 = 凝神防守一回合：本回合受到的伤害减半。
         用 battle.guardTurns 挂在**战斗对象**上（不是 player），
         这样多人群战也只对「这一局」生效，战斗结束自然随 battle 一起丢弃，
         不会像 bossPhaseIdx 那样漏清（见 finishCombat 的复位清单）。 */
      this.battle.guardTurns = 1;
      return { lines: this.stepEnemyOnly([{ kind: 'combat', text: '你沉肩扎马，凝神防守。' }]) };
    }
    if (userAction && userAction.type === 'item') {
      const p = this.player;
      const useRes = this.useItem(p, userAction.uid);
      const lines = (useRes.lines || []).slice();
      /* `ok` 要透出去：调用方（commands.js 的 `use`）得知道到底吃没吃上，
         才能决定要不要接着走「喝酒传市井传闻」那一步。
         只回 lines 的话，那边只能去正则匹配文本里的"没有"——那是拿文案当 API 用。 */
      return { lines: this.stepEnemyOnly(lines), ok: !!useRes.ok };
    }
    /* ============================================================
       普通攻击 / 自动一回合
       ------------------------------------------------------------
       ⚠️ 修的病（主人报的「战斗很怪」**第一条**）：
         原来是 `combat.step(this.battle)` 接 `stepEnemyOnly(lines, true)`。
         `combat.step()` 的语义是「**场上所有单位各打一次**」—— 玩家和敌人都算。
         然后再 `stepEnemyOnly` 让敌人**再打一次**。
         ⇒ 玩家点一次「普通攻击」，实际是**玩家出手 1 次、敌人出手 2 次**。
         同时 `combat.step()` 里对每个单位 `tickBuffs`，`stepEnemyOnly` 里
         又对每个敌人 `tickBuffs` 一次 ⇒ **敌人的 buff 一回合结算两遍**
         （持续伤害翻倍、增益回合数减半）。同一个根因的两副面孔。

       ⇒ 改法：与 `{type:'skill'}` 那条分支**同构** —— 这里只结算**玩家这一手**，
         敌人那一手交给下面的 `stepEnemyOnly`，各一次。
       ============================================================ */
    {
      const p = this.player;
      const t = this.battle.defenders[0];
      const lines = [];

      /* 玩家侧 buff 结算。原来由 `combat.step()` 顺带做了（它对所有单位 tick 一遍）；
         玩家不走它了，就得自己 tick 一次 —— 否则玩家身上的持续伤害 / 增益
         **永远不结算**（中毒不掉血、增益不消失）。 */
      this.combat.tickBuffs(p, lines, this.battle);
      if (p.hp <= 0) { this.playerDeath(); return this.finishCombat(lines); }

      /* 玩家这一手：pickSkill 挑武学（封穴时返回 null ⇒ 只能普攻），
         hits / baseAttackCount 决定连击数，与 combat.step() 里的写法一致。 */
      const sk = this.combat.pickSkill(p, t);
      const n = sk && sk.hits ? sk.hits : this.combat.baseAttackCount(p, t);
      for (let i = 0; i < n; i++) {
        if (!t || t.hp <= 0) break;
        const rr = this.combat.oneAttack(p, t, i === 0 ? sk : null, this.battle, i);
        if (rr) lines.push(rr);
      }
      if (t && t.hp <= 0) {
        this.combat.onDeath(t, this.battle, lines, true);
        this.battle.over = true;
        this.battle.winner = 'attackers';
      }
      if (this.battle.over) return this.finishCombat(lines);

      /* ⚠️ 这里**不再**传 skipPlayer=true。
         那个参数的语义是「玩家的 buff 已经在 combat.step() 里 tick 过了，别再减一次」，
         而现在玩家改由上面那行 tickBuffs 负责，敌人侧的收尾与另外三条分支一致。
         传 true 会让辅助武技打上的 `sup:` 标记**永不递减**（挂一辈子）。 */
      const after = this.stepEnemyOnly(lines);
      if (this.battle && this.battle.over) return this.finishCombat(after);
      // 玩家死亡
      if (p.hp <= 0) { this.playerDeath(); return this.finishCombat(after); }
      return { lines: after };
    }
  }

  /** 玩家行动后，敌人行动 */
  stepEnemyOnly(lines, skipPlayer) {
    const battle = this.battle;
    if (!battle || battle.over) return lines;
    const p = this.player;
    const enemies = [].concat(battle.defenders).filter(e => !e.dead && e.hp > 0);
    for (const e of enemies) {
      if (e.hp <= 0 || e.dead) continue;
      if (p.hp <= 0) break;
      this.combat.tickBuffs(e, lines, battle);
      /* Boss 三阶段：敌人侧走 stepEnemyOnly，不经过 combat.step()，
         所以这里必须单独挂一次，否则 Boss 永远停在第一阶段（SPRINT-C）。 */
      this.combat.tickBossPhase(e, lines, battle);
      /* 迷幻（P1-1）：中了迷魂香的敌人调头打同伴。
         同伴全都倒了就照常打玩家 —— 否则会「愣在原地」，比不中招还怪。 */
      let tgt = p;
      if (this.combat.isConfused && this.combat.isConfused(e)) {
        const mate = enemies.find(x => x !== e && !x.dead && x.hp > 0);
        if (mate) { tgt = mate; lines.push({ kind: 'combat', text: `${e.name}双目赤红，竟朝${mate.name}递招！` }); }
      }
      const sk = this.combat.pickSkill(e, tgt);
      const n = sk && sk.hits ? sk.hits : this.combat.baseAttackCount(e, tgt);
      for (let i = 0; i < n; i++) {
        if (tgt.hp <= 0) break;
        const rr = this.combat.oneAttack(e, tgt, i === 0 ? sk : null, battle, i);
        if (rr) lines.push(rr);
      }
      /* 同伴被自己人打倒 —— 走 onDeath，别留个 0 血的人杵在场上 */
      if (tgt !== p && tgt.hp <= 0 && !tgt.dead) this.combat.onDeath(tgt, battle, lines, false);
      if (p.hp <= 0) {
        lines.push({ kind: 'faint', text: '你眼前一黑，什么都不知道了……' });
        break;
      }
    }
    if (enemies.every(e => e.hp <= 0)) { battle.over = true; battle.winner = 'attackers'; }
    /* B4：防守只保本回合 —— 敌人这一轮打完了，就把 guardTurns 消耗掉。
       放在 stepEnemyOnly 末尾，是因为三条玩家分支
       （绝招/防御/use 物品）全都经由它落地，挂在任何一处都会漏。 */
    if (battle.guardTurns > 0) battle.guardTurns--;
    /* 武技冷却同步递减（与 guardTurns 同一处收尾，三条分支都经过） */
    if (battle.cooldowns) {
      for (const k of Object.keys(battle.cooldowns)) if (battle.cooldowns[k] > 0) battle.cooldowns[k]--;
    }
    /* 玩家侧状态结算：走「武技 / 防御 / use 物品」三条分支时不经过 combat.step()，
       玩家身上的 buff 回合数没人减。这里**只递减辅助武技自己打的标记（`sup_`）**，
       不碰别人挂的状态 —— 一刀切 tickBuffs 会把 dot / 蓄势的语义一起改掉，
       而「玩家 buff 该不该按回合扣」是另一个口径，别在这轮顺手改。 */
    if (!skipPlayer && Array.isArray(p.buffs) && p.buffs.some(b => /^sup:/.test(b.tag || ''))) {
      const kept = [];
      for (const b of p.buffs) {
        if (/^sup:/.test(b.tag || '')) { b.turns--; if (b.turns > 0) kept.push(b); }
        else kept.push(b);
      }
      p.buffs = kept;
      p.recalc();
    }
    return lines;
  }

  finishCombat(lines) {
    const b = this.battle;
    if (!b) return { lines, over: true };
    this.player.inCombat = false;
    for (const d of [].concat(b.defenders, b.attackers)) { for (const u of (d && d.members ? d.members : [d])) { if (u) u.inCombat = false; } }
    /* Boss 阶段状态复位：打输从门口重来时必须回到第一阶段。
       不清的话实例上的 bossPhaseIdx / bossSkill / bossphase buff 会跟着进下一场，
       玩家会发现「刚出门的 boss 一开场就放三阶段」。 */
    for (const d of [].concat(b.defenders, b.attackers)) {
      for (const u of (d && d.members ? d.members : [d])) {
        if (!u) continue;
        if (u.bossPhaseIdx !== undefined || u.bossSkill !== undefined) {
          u.bossPhaseIdx = 0;
          u.bossSkill = null;
          u.buffs = (u.buffs || []).filter(x => x.tag !== 'bossphase');
          u.recalc && u.recalc();
        }
        /* 辅助武技的状态（`sup_`）只在**这一局**里算数：打完就散。
           留着的话玩家出了战斗还挂着「护体真气 +26 防」，等于白拿一份属性，
           下回再开打还先手带着 —— 那就不是「战时辅助」了。 */
        if (Array.isArray(u.buffs) && u.buffs.some(x => /^sup:/.test(x.tag || ''))) {
          u.buffs = u.buffs.filter(x => !/^sup:/.test(x.tag || ''));
          u.recalc && u.recalc();
        }
      }
    }
    if (b.winner === 'attackers') {
      this.player.combatTarget = null;
      if (this.combatHooks.onEnd) {
        const extra = this.combatHooks.onEnd('win', { battle: b, world: this });
        if (Array.isArray(extra)) extra.forEach(x => lines.push(x));
      }
    }

    /* ---- 切磋结算：点到为止，不结仇，反而交个朋友 ---- */
    if (b.duel) {
      const duelMod = require('./duel');
      const foe = (b.defenders || [])[0];
      if (foe) {
        foe.duel = false;
        foe.inCombat = false;
        this.player.inCombat = false;
        const win = b.winner === 'attackers';
        const social = require('./social');
        if (b.winner === 'flee') {
          lines.push({ kind: 'say', text: `${foe.name}收手退开：「承让，改日再讨教。」` });
          lines.push(...social.addFavor(this, foe, 2, '切磋收手').lines);
        } else if (win) {
          lines.push({ kind: 'story', text: `${foe.name}收势立定，拱手道：「好身手。」` });
          lines.push(...social.addFavor(this, foe, 6, '切磋获胜').lines);
          duelMod.noteWin(this, foe.id);        /* 记战绩：拒绝词要按它选 */
          const gain = 20 + (foe.level || 1) * 2;
          this.player.gainExp(gain);
          lines.push({ kind: 'sys', text: `切磋一场，你颇有所得（经验 +${gain}）。` });
          /* 跟人过招也是长进（主人 2026-10-08 的「其他方式」） */
          require('./potential').grant(this.player, require('./potential').DUEL_REWARD, lines, '与人过招');
        } else {
          lines.push({ kind: 'story', text: `${foe.name}扶住踉跄的你：「今日是我占了上风，你的路数却很是有趣。」` });
          lines.push(...social.addFavor(this, foe, 3, '切磋败北').lines);
        }

        /* 「晕倒过去，醒来还是在原地」（主人 2026-10-11）。
           战斗引擎已经把双方血量按在 1、谁也没被抬走（见 combat.onDeath 的 duel 分支），
           这里补上「那一会儿」的叙述与时间，别让人以为打完就没事了。
           ⚠️ 用 advanceTime 而不是新造一个「倒地」状态：
              新状态要处理「倒地期间不许行动/不许被偷袭/存档怎么恢复」，
              为一个转场叙述不值当，而且多一个状态就多一处能卡死玩家的地方。 */
        this.player.advanceTime(20);
        if (win) {
          lines.push({ kind: 'story', text: `${foe.name}在地上坐了一会儿，才撑着膝盖站起来，拍了拍衣摆上的土。` });
        } else {
          lines.push({ kind: 'plain', text: '你眼前发花，靠着墙坐了一刻，才慢慢缓过来 —— 人还在原处。' });
        }

        /* 看客点评（主人：「如果有旁人会凑热闹看并对招式进行点评，却不会帮任何一方」）。
           只出话，绝不动手 —— bystanderLines 里不碰 battle、不改 favor。 */
        const watch = duelMod.bystanderLines(this, foe, win, 2);
        if (watch.length) lines.push(...watch);
      }
    }

    const res = { lines, over: true, winner: b.winner, battle: b };
    this.battle = null;
    this.emit('combatend', res);
    return res;
  }

  /**
   * 玩家力竭昏倒（**不是「死」** —— 主人明确要求：昏过去，然后在最近客栈醒转）。
   *
   * 只做两件事：**置昏倒标记 + 记一次数**。
   * ⚠️ **不在这里扣钱扣经验**：结算统一在 `survival.respawnAtInn()`（复活的唯一入口）里做。
   *    原来这里扣一次钱，而「饿昏/渴昏」走 engine 里另一段内联复活代码 ——
   *    两条路各写一份，且内联那份只算了个数字写进台词、压根没扣
   *    （玩家看到的「你损失了 N 文钱」是假的）。见 survival.js 头注释。
   * 字段名保留 `dead` / `deathCount`（存档兼容），但**玩家可见的文案一律说「昏倒」**。
   */
  playerDeath() {
    const p = this.player;
    p.dead = true;
    p.hp = 0;
    p.deathCount = (p.deathCount || 0) + 1;
    this.emit('playerdeath', { count: p.deathCount });
  }

  /* ================================================================
   * 七、时间 / 世界心跳
   * ================================================================ */
  /* ⚠️ 为什么拆成两层：`storyline` 全仓产品侧零消费者（smoke-events 头部注），
     而 onTick / onDayTick（W5/W7）/ worldTick 抛的台词语义上就是给玩家看的。
     这里在真正的推进逻辑外面套一层 `_collecting` 开关，
     让推进期间发出的 storyline 进 _tickLines 缓冲，engine.exec 排进玩家输出。
     调用签名不变（所有外部调用照旧 `advanceTime(n)`），行为除了「台词终于看得见」外不变。 */
  advanceTime(minutes) {
    const _was = this._collecting;
    this._collecting = true;
    try {
      return this._advanceTime(minutes);
    } finally {
      this._collecting = _was;
    }
  }

  _advanceTime(minutes) {
    /* ⚠️ 原来写 `minutes = minutes || 1` —— 显式传 0 会被吞成 1，
       于是「advanceTime(0) 表示不推进」这个语义根本做不到（测试已抓到）。
       只有 undefined/null 才用默认 1。 */
    minutes = (minutes === undefined || minutes === null) ? 1 : minutes;
    if (!(minutes > 0)) minutes = 0;
    const p = this.player;
    if (!p) return;
    const prevDay = Math.floor(this.clockMinutes / 1440);
    this.clockMinutes += minutes;
    p.timeMinutes = this.clockMinutes;
    p.age = 16 + Math.floor(p.timeMinutes / 1440 / 120);
    /* 饥饿 / 口渴
       ⚠️ 旧代码写的是 `if (minutes >= 10)` —— 意思是「单次推进 ≥10 分钟才扣」。
          而走路只推进 1 分钟（doMove 的 cost 默认 1），于是**走路永远不饿不渴**，
          玩家报告「走路不会掉饱食度与口渴度」，实测确认属实。
          现在改成「按分钟比例连续扣」，走 1 分钟也扣（哪怕只掉 1 点），
          待在原地不动（minutes=0）才不掉。
          速率：饱食约 12 分钟掉 1 点、口渴约 8 分钟掉 1 点 → 满值 100 大约撑一天，
          与 old 的 12/8 保持同一量级，只是把它从「一次性门槛」改成「连续结算」。 */
    if (minutes > 0) {
      /* 天赋「浪子情怀」等：行走消耗倍率（默认 1；-0.5 → 饱食/饮水掉得只有一半） */
      const cons = this.consumptionMult(p);
      p.food = clamp(p.food - (minutes / 12) * cons, 0, p.maxFood);
      p.water = clamp(p.water - (minutes / 8) * cons, 0, p.maxWater);
      /* 扣到小数就记账（不然每走一步都四舍五入回原值，白扣）。
         ⚠️ 保留 4 位而不是 2 位 —— 2 位时每步舍入误差会累积：
         12 次 advanceTime(1) 只扣掉 0.96 而不是 1.00（测试实测）。
         4 位把误差压到 1e-4 量级，肉眼不可见但数值测试能过。 */
      p.food = Math.round(p.food * 10000) / 10000;
      p.water = Math.round(p.water * 10000) / 10000;
    }
    // 饥渴归零 → 每次推进时间都掉血（饿死/渴死由 engine.postProcess 判定并复活）
    if ((p.food <= 0 || p.water <= 0) && !p.inCombat) {
      p.hp = Math.max(0, p.hp - Math.max(1, Math.floor(minutes / 2)));
    }
    // 随机天气
    if (this.rng.chance(0.004) && !this.isNight()) this.weather = this.rng.pick(WEATHERS);
    // NPC 游走 / 重生
    if (this.tickCounter === undefined) this.tickCounter = 0;
    this.tickCounter += minutes;
    if (this.tickCounter >= 30) { this.tickCounter = 0; this.worldTick(); }
    /* 掳人系统：麻袋里的人醒来、护院欠薪、奴隶工钱结算、跟随者有事离开。
       每次推进时间都跑（不只在整点），因为「多久醒」本身就是分钟级概率。 */
    try {
      const kres = require('./kidnap').onTimeTick(this, minutes);
      for (const l of (kres && kres.lines) || []) this.emit('storyline', { line: l });
    } catch (e) { /* 掳人模块挂了不许拖垮时间系统 */ }
    // 跨日检测：每日结算传闻（衰减/扩散/走样/消亡）+ 世界动态（W6 月度 / W7 节庆）+ onDayTick
    const newDay = Math.floor(this.clockMinutes / 1440);
    if (newDay !== prevDay) {
      this.dailyRumorTick();
      /* 顺序：传闻结算 → 世界动态（写 p.vars.faction_* / 节庆 flag）→ fireEvent('onDayTick')
         ⇒ W5 事件读到的势力/节庆状态都是当天的（与 design/27 §1.2 的顺序一致）。 */
      this.worldDynamics(newDay);
      this.fireEvent('onDayTick', { day: newDay, prevDay });
    }
    this.emit('time', { minutes: this.clockMinutes });
  }

  worldTick() {
    /* ---- 野怪离场（2026-10-18 主人新档「四个山贼」）----
       encounter 进屋掷骰刷的野怪（_encWild）只在被打死时清——打输/逃走/绕路，
       原地那只就永远站着，走一路留一只，全图越积越多（滚雪球）。
       北大侠客行的正常野怪生态：**人走茶凉**——玩家离开房间两轮 worldTick
       后野怪消散（尸体一并：搜身/补刀都得趁人在场）。
       定岗/剧情 NPC 不带 _encWild 标记，不受影响；记仇（avengers）的
       个人化实例照旧豁免——剧情生成的人不能被生态维护误删（#90 同源口径）。 */
    this._tickNo = (this._tickNo || 0) + 1;
    for (const wid of Object.keys(this.instances.npcs)) {
      const wn = this.instances.npcs[wid];
      if (!wn || !wn._encWild || wn._encWildLeaveTick == null) continue;
      if (this._tickNo - wn._encWildLeaveTick < WILD_DESPAWN_TICKS) continue;
      /* 双保险：人在场的一律不删（回屋续命，见 movePlayerTo 的清戳） */
      if (this.player && wn.room === this.player.room) continue;
      if (wn.pstate && Array.isArray(wn.pstate.avengers) && wn.pstate.avengers.length) continue;
      delete this.instances.npcs[wid];
    }
    /* NPC 游走。
       ⚠️ 两处非做不可的前置：
         ① NPC 是**懒实例化**的（boot 完只有 3 个实例，其余是模板），
            不先把玩家这一圈的人「活化」，隔壁屋永远没人走动，
            于是「某某急匆匆打你身边经过」这类消息一条也播不出来；
         ② 一轮可能几十个人同时在走，全部播报会把日志刷烂 ——
            所以这里只**收集**，交给 ambience.wanderLines 筛「看得见的那些」并限量。 */
    const amb = require('./ambience');
    try { amb.ensureNearbyNpcs(this, 1); } catch (e) { /* 活化失败不该拖垮时间系统 */ }
    /* ---- 致幻（arts.js「致幻」）：中了的人认不得路，只在附近打转 ----
       与「游走」分开处理：游走是这人的习性，迷路是**被人做了手脚**。
       表现上前者走得干脆，后者走两步又绕回来 —— 玩家一眼能看出不对。 */
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      /* 引路（lure）：被人做了手脚的人会跟着那一位走 */
      const lu = n.vars && n.vars.lure;
      if (lu && lu.left > 0) {
        lu.left--;
        const host = this.player;
        if (host && host.id === lu.host && n.room !== host.room && !n.dead) {
          const cur = this.data.rooms[n.room] || {};
          const dir = Object.keys(cur.exits || {}).find(d => {
            const to = cur.exits[d]; const tid = typeof to === 'string' ? to : (to && to.to);
            return tid === host.room;
          });
          if (dir) {
            n.room = host.room;
            this.emit('storyline', { line: { kind: 'plain', text: `${n.name}不知什么时候跟了过来，站在你身后。` } });
          }
        }
        if (lu.left <= 0) delete n.vars.lure;
      }
      const st = n.vars && n.vars.stray;
      if (!st || st.left <= 0) continue;
      st.left--;
      if (st.left <= 0) { delete n.vars.stray; if (n.room !== st.home) n.room = st.home; continue; }
      if (!this.rng.chance(0.5)) continue;
      const room = this.data.rooms[n.room];
      if (!room || !room.exits) continue;
      const dirs = Object.keys(room.exits).filter(d => HORIZ_DIRS.indexOf(d) >= 0);
      if (!dirs.length) continue;
      const d = dirs[Math.floor(this.rng.next() * dirs.length)];
      const to = room.exits[d];
      const tid = typeof to === 'string' ? to : (to && to.to);
      if (!tid || !this.data.rooms[tid]) continue;
      /* 只在家门口两格内绕：太远了就「走丢」在别的城，反而说不通 */
      const target = this.data.rooms[tid];
      const homeRoom = this.data.rooms[st.home];
      if (homeRoom && target.region !== homeRoom.region) continue;
      n.room = tid;
      if (this.player && (n.room === this.player.room || (room.exits && Object.values(room.exits).indexOf(this.player.room) >= 0))) {
        this.emit('storyline', { line: { kind: 'plain', text: `${n.name}从街这头走到那头，又转回原地，一脸茫然。` } });
      }
    }
    const moved = [];
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      if (!n.wander) continue;
      /* 定岗 NPC（respawn 点名的守卫/掌柜）不漫游 —— 与上面作息块/饭点块的
         isStationed 豁免同一口径。否则人漫游离岗后，respawn（只数「在本岗的
         alive」）会把岗位当空位补出第二个实例，滚到 hardCap 为止；两个漫游
         再撞进同一房，玩家就看到「华山弟子 ×2」（主人真机 2026-10-18 复测发现）。 */
      if (isStationed(this, n.defId)) continue;
      if (this.rng.chance(n.wander.chance || 0.05)) {
        const room = this.data.rooms[n.room];
        if (!room || !room.exits) continue;
        /* ⚠️ 只走**平面八个方向**：u/d（上下）与 in/out（里外）不参与随机游走 ——
           那是楼梯与门，人是走过去的，不是「溜达」过去的；
           真走了 u，播报会变成「某某一头往楼上去了」，读起来像摔了一跤。 */
        const dirs = Object.keys(room.exits).filter(d => HORIZ_DIRS.indexOf(d) >= 0);
        if (!dirs.length) continue;
        const d = this.rng.pick(dirs);
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        if (tid && this.data.rooms[tid]) { const from = n.room; n.room = tid; moved.push({ npc: n, from, to: tid }); }
      }
    }
    /* 玩家看得见的那几条（离开 / 走进来 / 打身边经过），一次最多 3 条 */
    if (moved.length) {
      for (const l of amb.wanderLines(this, moved)) this.emit('storyline', { line: l });
    }
    /* ---- NPC 的日常（主人 2026-10-08）----
       缺钱去打工、挣了钱买吃的、自己练功、内力空了打坐；同屋的人聊两句或拌嘴。
       走 emit('storyline') → _tickLines → 玩家下一条指令时带出来（与 W5/W7 同一条通道）。
       ⚠️ 抽样跑（`CFG.samplePerTick`），不遍历 —— 四百多号人每个 tick 全跑，服务器先烧掉。 */
    try {
      const life = require('./npclife').onTick(this, 30);
      for (const l of life) this.emit('storyline', { line: l });
    } catch (e) { /* NPC 的日常挂了不该拖垮时间系统 */ }
    // 时间作息：昼夜轮换时，把 NPC 从工作地（day）挪回家（night），反之亦然。
    // 玩家眼前的 NPC 不动，避免交互到一半人突然消失。
    const night = this.isNight();
    const playerRoom = this.player && this.player.room;
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      if (n.room === playerRoom) continue;
      const def = this.data.npcs[n.defId];
      if (!def || !def.schedule) continue;
      /* 定岗 NPC 岗位就是常驻处，别用 schedule 把它搬走 */
      if (isStationed(this, n.defId)) continue;
      const target = night
        ? (def.schedule.night || def.schedule.day)
        : (def.schedule.day || def.schedule.night);
      if (target && target !== n.room && this.data.rooms[target]) n.room = target;
    }
    // 饭点（午时/酉时）：有作息的 NPC 去最近的酒楼/客栈用饭（玩家眼前的除外）
    if (this.isMealTime()) {
      for (const id of Object.keys(this.instances.npcs)) {
        const n = this.instances.npcs[id];
        if (n.room === playerRoom) continue;
        const def = this.data.npcs[n.defId];
        if (!def || !def.schedule) continue;
        /* 名人不去别处吃饭 —— 主人报「在江南客栈看到东方不败」。
           nearestEatery 第 7 步会全图兜底，删房后 BFS 深度很浅，
           华山掌门几步就能「走到」江南客栈。掌门要有掌门的样子。
           同理，定岗 NPC（respawn 点名的守卫/掌柜）也不能离开岗位。 */
        if (isCelebrity(def) || isStationed(this, n.defId)) continue;
        const eatery = this.nearestEatery(n.room);
        /* 客栈容量：挤爆一间不如分摊到别处（删房后地图连通性大增，不设限会 150+ 人一屋） */
        if (eatery && eatery !== n.room && this.npcsIn(eatery).length < EATERY_CAP) n.room = eatery;
      }
    }
    // 学堂学生偷懒：白天的书院学子有概率溜到城里玩耍
    if (!night) {
      const PLAY_ROOMS = ['jiangnan_market', 'jn_teahouse', 'jn_resident_1', 'jiangnan_street'].filter(r => this.data.rooms[r]);
      for (const id of Object.keys(this.instances.npcs)) {
        const n = this.instances.npcs[id];
        if (n.room === playerRoom) continue;
        const def = this.data.npcs[n.defId];
        if (!def || def.tag !== 'scholar') continue;
        const room = this.getRoom(n.room);
        if (!room || room.region !== 'shuyuan') continue; // 只有书院里的才「逃学」
        if (this.rng.chance(0.03) && PLAY_ROOMS.length) {
          n.room = PLAY_ROOMS[Math.floor(this.rng.next() * PLAY_ROOMS.length)];
        }
      }
    }
    // 重生（房间 respawn 配置）
    for (const rid of Object.keys(this.data.rooms)) {
      const room = this.data.rooms[rid];
      if (!room.respawn) continue;
      /* 兜底：同一 defId 全图实例上限（含 mob），防止任何路径导致无限累积 */
      const defCounts = {};
      for (const n of Object.values(this.instances.npcs)) {
        defCounts[n.defId] = (defCounts[n.defId] || 0) + 1;
      }
      for (const rs of [].concat(room.respawn)) {
        /* ⚠️ npcsIn 过滤 dead，而 onNpcDown 把「打倒未杀」的人同时标 dead，
           导致这里 alive 永远是 0 → 山贼无限刷到 300 只。
           必须把 knockedOut 一起算作「还在场」，否则 respawn 无上限。 */
        const alive = Object.values(this.instances.npcs)
          .filter(n => n.room === rid && n.defId === rs.npc && !n.dead).length;
        const downed = this.downedIn(rid).filter(n => n.defId === rs.npc).length;

        /* 名人（A 层 / unique）：全图只允许一个实例。主人报「客栈里看到
           岳不群 ×3」——根因是名人的常驻房间被写进了 respawn（count:1,
           chance:1），而他本人被饭点挪去客栈，正气堂就「没人」，每 tick 补一个。
           但名人**本来就只靠 respawn 上场**（newGame 不生成他们），直接跳过
           会让名人彻底消失、任务断链。所以：已存在就（必要时）挪回来，
           绝不再造第二个。 */
        if (isCelebrity(this.data.npcs[rs.npc])) {
          const living = Object.values(this.instances.npcs)
            .filter(n => n.defId === rs.npc && !n.dead);
          if (!living.length && this.rng.chance(rs.chance === undefined ? 0.5 : rs.chance)) {
            this.spawnNpc(rs.npc, rid, 1);
          }
          /* 存在就什么都不做 —— 名人日夜间去哪由 schedule 管，
             respawn 只负责「他还没上场时把他放进来」。 */
          continue;
        }

        if (alive + downed < (rs.count || 1) && this.rng.chance(rs.chance === undefined ? 0.5 : rs.chance)) {
          const total = defCounts[rs.npc] != null ? defCounts[rs.npc] : 0;
          const hardCap = /^mob_/.test(rs.npc) ? 8 : 3;
          if (total >= hardCap) continue;
          this.spawnNpc(rs.npc, rid, (rs.count || 1) - alive - downed);
        }
      }
    }
    // 第五批：真死的 NPC 10 天后复活（以死前状态重新 spawn）
    for (const defId of Object.keys(this.deadNpcs)) {
      const diedAt = this.deadNpcs[defId];
      if (this.clockMinutes - diedAt >= 14400) { // 10 天
        delete this.deadNpcs[defId];
        const def = this.data.npcs[defId];
        if (def) {
          const room = (def.schedule && def.schedule.day) || def.room || (this.data.meta && this.data.meta.startRoom);
          this.spawnNpc(defId, room, 1, true);
        }
      }
    }
    // 第五批：心情极低（万念俱灰）的 NPC 有概率抑郁轻生
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      if (n.room === playerRoom) continue;
      if (n.knockedOut || n.dead) continue;
      if ((n.def || {}).hostile) continue;
      if (n.mood !== undefined && n.mood <= 5 && this.rng.chance(0.04)) {
        const name = n.name;
        delete this.instances.npcs[id];
        this.emit('storyline', { line: { kind: 'warn', text: `噩耗传来：${name}因万念俱灰，竟寻了短见，悬梁自尽了……` } });
      }
    }
    this.fireEvent('onTick', {});
    /* 掳人系统：亡命之徒主动掳人（每 30 分钟一次 worldTick 判定）+ 跟随者离队 */
    try {
      const kd = require('./kidnap');
      for (const l of kd.tickDesperate(this) || []) this.emit('storyline', { line: l });
      for (const l of kd.tickFollowers(this, 30) || []) this.emit('storyline', { line: l });
    } catch (e) { /* 同上，隔离 */ }
  }

  /* 功能 Mod 规则：取某字段的总倍率（multiply 规则） */
  ruleMult(target) {
    let m = 1;
    for (const r of this.activeRules) {
      if (r.kind !== 'multiply' || r.target !== target) continue;
      if (r.cond && !evalCond(r.cond, { player: this.player, world: this })) continue;
      m *= (r.value || 1);
    }
    return m;
  }

  /* 功能 Mod 规则：取某字段的总增减（additive 规则） */
  ruleAdd(target) {
    let s = 0;
    for (const r of this.activeRules) {
      if (r.kind !== 'additive' || r.target !== target) continue;
      if (r.cond && !evalCond(r.cond, { player: this.player, world: this })) continue;
      s += (r.value || 0);
    }
    return s;
  }

  fireEvent(name, payload) {
    /* ⚠️ E2（design/27 §2.1 / B21 同族坑）：
       以前这里**只读 `this.data.events[name]`**，不读 `this.data.worldEvents`。
       W5 事件库挂在 `worldEvents.onDayTick` 上 → 少了这一行，新键永远不触发
       （与 B21「events 被揉成对象→静默失效」完全同族的静默坑）。
       同时加一道「非数组 handler 兜底」：万一将来某条路径又把数组揉成对象，
       Object.values(...).filter(有 cond 或 effects) 还能把它救回来。 */
    let handlers = this.data.events[name]
      || (this.data.worldEvents && this.data.worldEvents[name])
      || [];
    if (!Array.isArray(handlers)) {
      handlers = Object.values(handlers).filter(x => x && typeof x === 'object' && (x.cond || x.effects));
    }
    const day = Math.floor(this.clockMinutes / 1440);
    /* 「一天最多两件事」——W5 事件库落地（68 条）后，跨日要过一遍全部条件。
       68 条里有三四十条带 `chance`，不加限流的话，运气不好一天能连报四五件
       （玩家刚睁开眼：仇家堵路 + 河里决口 + 隔壁出殡 + 说书的开讲），
       世界会变得像跑马灯。所以**打乱顺序后一天最多报两件** ——
       打乱是为了公平：不按数组顺序让前几条永远优先。
       只对 onDayTick 限流，onKill/onLevelUp 那些是动作触发的，不受影响。 */
    let handlersList = [].concat(handlers);
    if (name === 'onDayTick' && handlersList.length > 1) {
      handlersList = handlersList.slice();
      for (let i = handlersList.length - 1; i > 0; i--) {
        const j = this.rng.int(0, i);
        const t = handlersList[i]; handlersList[i] = handlersList[j]; handlersList[j] = t;
      }
    }
    let dayFired = 0;
    for (const h of handlersList) {
      if (!h || typeof h !== 'object') continue;
      /* E7 · 冷却 / 一次性（引擎原本不认这两个字段）：
         事件可按 id 声明 `cooldownDays`（同事件 N 天内不重复）或 `once`（一辈子一次）。
         只对「带 id 的处理器」生效 → 基础事件（onKill 等无 id）零影响。 */
      if (h.id) {
        /* ⚠️ 用 `!== undefined` 而不是真值判断：day 可能是 0（开局当天），
           `if (this._evFired[id])` 会把「第 0 天触发过」当成没触发过。 */
        if (h.once && this._evFired[h.id] !== undefined) continue;
        const cd = Number(h.cooldownDays) || 0;
        if (cd > 0 && this._evCooldown[h.id] !== undefined && (day - this._evCooldown[h.id]) < cd) continue;
      }
      if (h.cond && !evalCond(h.cond, { player: this.player, world: this })) continue;
      const fired = evalEffects(h.effects, { player: this.player, world: this, event: payload });
      if (h.id && fired.length) {
        this._evCooldown[h.id] = day;
        if (h.once) this._evFired[h.id] = day;
      }
      /* fired 为空 = 条件看着满足、效果却什么都没产出（不该算「报了一件事」） */
      /* 限流只管「带 chance 的」市井事件（跑马灯病根在那批概率件）。
         ⚠️ 2026-10-13 修：必然命中（没写 chance）的确定性事件**不占额度、不被截断**——
         「每月初一集市开张」这类日历事件被限流压掉，玩家只觉得「这游戏没事发生」。
         之前 6 条探针全带 always:true，跨日只放出 1-2 条，就是这条把额度吃光的。 */
      if (fired.length && name === 'onDayTick' && h.chance !== undefined) {
        dayFired++;
        if (dayFired >= 2) { fired.forEach(l => this.emit('storyline', { line: l })); break; }
      }
      fired.forEach(l => this.emit('storyline', { line: l }));
    }
    // 功能 Mod 的 onEvent 规则（kind=onEvent, target=事件名）
    for (const r of this.activeRules) {
      if (r.kind !== 'onEvent' || r.target !== name) continue;
      if (r.cond && !evalCond(r.cond, { player: this.player, world: this })) continue;
      const eff = r.effect || r.effects;
      if (!eff) continue;
      evalEffects(eff, { player: this.player, world: this, event: payload }).forEach(l => this.emit('storyline', { line: l }));
    }
    /* Mod 沙箱脚本（script.js）的 wx.on 处理器。放最后：规则先跑，
       脚本后跑 —— 脚本的返回值同样走 storyline，顺序对玩家可见。 */
    this.runModEvent(name, payload);
  }

  /* ================================================================
   * 八、创建玩家
   * ================================================================ */
  createPlayer(cfg) {
    cfg = cfg || {};
    const meta = this.data.meta;
    /* ⚠️ 身份 × 性别硬校验（**后端**，前端把不合法的身份藏起来只是第一道）：
       与性别强绑定的身份（庵堂孤儿→峨眉 · 山门弃婴→少林 · 守墓人之后→古墓）
       在数据里带 `gender`（见 data/68_talents.json 的 meta.births）。
       为什么非挡不可：剧情只写了这一条性别线（没有「男身庵堂孤儿」的后续），
       若放行，tutorial.targetSectFor 会顺着备选链把引路改口到另一家门派，
       玩家选的出身与旁白/引导对不上——这是静默的错位，比直接拒绝更难查。
       前端会按性别过滤身份列表，但**手搓 /api/new 请求绕得过去**，所以这里再挡一次。
       不合法就明确拒绝（给人话错误），不做「偷偷换成别的身份」——那等于骗玩家。 */
    const _bdef = (meta.births || {})[cfg.birth];
    if (_bdef && _bdef.gender && _bdef.gender !== (cfg.gender || 'male')) {
      const want = _bdef.gender === 'female' ? '女' : '男';
      throw new Error(`「${_bdef.name || cfg.birth}」只收${want}儿身，与所选性别不符。`);
    }
    const p = new Character(this, {
      name: cfg.name || '无名侠客',
      gender: cfg.gender || 'male',
      race: cfg.race || 'human',
      level: cfg.level || 1,
      attr: cfg.attr || meta.startAttr,
      hp: meta.startHp, mp: meta.startMp,
      money: cfg.money !== undefined ? cfg.money : (meta.startMoney || 100),
      // 潜能已废除（2026-10-11）：开局不再发这个数。
      perks: cfg.perks || [],
      traits: (cfg.traits || []).concat(meta.startTraits || []),
      timeMinutes: meta.startTime || 540,
    });
    p.isPlayer = true;
    p.isNpc = false;
    p.personality = cfg.personality || require('./personality').PLAYER_DEFAULT;
    /* ---- 主线分化地基（design/67 §5 · P1）----
       开局按**出身**定一条线（正派 / 反派 / 中立），主线每一步都读它。
       「mod 出身」= 这个出身 id 不在官方 births 表里（mod 自己加的）——
       那种出身走**中立线**：玩家不再是天选之人，谁都能合作、谁都能翻脸。 */
    p.mainline = require('./mainline').init(cfg.birth, cfg.gender || 'male', {
      fromMod: !!(cfg.birth && !((meta.births || {})[cfg.birth])),
    });
    p.room = meta.startRoom || 'road_1';
    /* 「楼里新来的」（主人 2026-10-11）：开局人就在醉春楼，牌子还没挂 ——
       身份 = **已卖身、正在学规矩**。所以这里直接落两样东西：
         ① 起始房间改到楼里（不能还站在江南大路上）；
         ② `prostitution.sold = true`（她本来就已经画了押，不是刚去卖的）。
       ⚠️ 卖身银不发：契是别人替她按的，钱从来没到过她手上。 */
    if (cfg && cfg.birth === 'brothel_sold') {
      const house = 'jn_brothel_hall';
      if (this.data.rooms[house]) p.room = house;
      p.prostitution = {
        sold: true, brothelRoom: p.room, debt: 1600, since: 0, served: 0, earnings: 0,
      };
    }
    p.inventory = [];
    p.equipmentUid = {};
    p.log = [];
    p.quests = {};
    p.flags = {};
    p.vars = {};
    p.tutorialFlags = cfg.tutorialFlags || [];
    p.titles = (cfg.titles || []);
    p.deathCount = 0;
    p.disciples = [];   // 弟子（npc 实例 id 列表）
    p.mySect = null;    // 自建宗门（玩家私有，随档走，不进全局 data.sects）
    p.estate = { plots: [], sponsored: {} };   // 家园新地块 + 资助NPC建家
    /* 掳人 / 奴役 / 护院（麻袋里 + 奴 + 护院 + 欠薪 + 通缉 + 债务） */
    p.kidnap = { bags: [], slaves: [], guards: [], captives: [], wageDue: 0, wanted: 0, reports: 0, debt: null };
    p.followers = [];   // 跟随玩家的 NPC 实例 id（好感>60 才能邀）
    // 起始物品
    for (const it of (meta.startItems || [])) this.giveItem(p, it, 1);
    /* 衣裳与木剑**出门就该穿在身上** ——
       主人 2026-10-11：「玩家初始真的很弱谁都打不过」。
       原先进了行囊却没上身（玩家并不知道要手动 wear），白白少了 2 点防御与 3 点攻击。
       只自动穿这两件「出生装」，别的照旧躺在行囊里由玩家自己决定。 */
    for (const want of ['cloth_robe', 'wood_sword']) {
      if ((p.inventory || []).some(x => x && x.id === want)) {
        try { this.equipItem(p, want); } catch (e) { /* 穿不上不影响开局 */ }
      }
    }
    this.player = p;
    this.clockMinutes = p.timeMinutes;
    this.buildIndexes();
    /* 世界动态：开局就把势力状态写进 p.vars（W5 的 cond 读它，第一日就要有值）。 */
    if (this.factionState) this.syncFactionVars();
    // 起始武学
    for (const s of (meta.startSkills || [])) p.learnSkill(s);
    /* 自动接主线任务（type === '主线'）—— **只接「起手式」那一条**。
       ⚠️ 原来是「所有 type==='主线' 一律接上」。加进第二幕之后这就坏了：
         `q_main_sect`（门派之疑，level 30，委托人冲虚道长）也会在开局被塞进任务簿，
        新角色一进游戏就看见「把半块东厂铜牌带回武当，交给冲虚道长过目」——
         ① 剧透二幕、② 玩家压根没有那块铜牌（它是第一幕幕末才发的）、
         ③ 新手引导第 5 步「寻个营生」的「非主线」判定一开局就被点亮
           （tutorial.js 那句 `some(k => k !== 'q_main_jianghu')`）。
       （这条隐患 design/17-intro-rewrite.md §5 早就记了「建议重做主线时一并处理」，
         主人这回以「点任务快捷键弹出来的还是旧主线」把症状报到台面上。）
       判据用 `giver`：**有委托人的主线必须由那个人当面交给你**，
       无委托人（= 开场就背在身上的起手式）才自动接。
       数据侧还可显式关掉：`auto:false`。 */
    for (const qid of Object.keys(this.data.quests || {})) {
      const q = this.data.quests[qid];
      if (!q || q.type !== '主线') continue;
      if (q.giver) continue;
      if (q.auto === false) continue;
      /* `startStage`：开局就接的主线，可以从第 N 步起步（默认 0）。
         🔴 2026-10-12 主人「新手教程剧情全删」+「主线剧情第一章就是拜入一个门派」：
            原先 `q_main_jianghu` 写了 `startStage: 1` —— 跳过第 0 步「拜师」，
            因为**拜师当时归新手第 6 章「递信上山门」**（主人 2026-10-08 点出来的
            重复：「主线剧情第一章是拜入一个宗门？？新手剧情里面也有一个拜入宗门」）。
            现在新手剧情整块撤了，拜师**没有别的地方可做** —— 就该回到主线的第 0 步。
            已被数据侧删掉（`startStage` 不再出现），这里默认 0 即可。 */
      p.setQuestStage(qid, q.startStage || 0);
      /* ★ 2026-10-12 主人：「主线剧情一进游戏就接取，但主线剧情需要追踪时才在屏幕上
         显示原本应该在接取时就应该出现的那些文本。」
         ⇒ 这条是**脚本塞给他的**（不是他在 NPC 那儿点「接取任务」接的），
            所以接取旁白先扣住，等玩家去「任务」里点追踪再讲。
            见 storybeat.hold / takeHeld 的注释。 */
      try { require('./storybeat').hold(p, qid); } catch (e) { /* 扣不住也算不上大事，别挡着开局 */ }
    }
    // 性格/出身加成
    this.applyBirth(cfg, p);
    /* 开局的一段潜能（主人 2026-10-08 把潜能接回来）。
       ⚠️ 不能是 0：新手第 7 章就是「跟师父请教学两门功夫」，
          0 会把教程当场卡在断路里 —— 那不是难度，是 bug。 */
    if (!(p.potential > 0)) p.potential = require('./potential').START_POTENTIAL;
    p.recalc();
    return p;
  }

  applyBirth(cfg, p) {
    const meta = this.data.meta;
    const births = meta.births || {};
    if (cfg.birth && births[cfg.birth]) {
      const b = births[cfg.birth];
      if (b.attr) for (const k of Object.keys(b.attr)) p.baseAttr[k] = (p.baseAttr[k] || 0) + b.attr[k];
      if (b.items) for (const it of b.items) this.giveItem(p, it, 1);
      if (b.skills) for (const s of b.skills) p.learnSkill(s);
      if (b.money) p.money += b.money;
      if (b.traits) p.traits = p.traits.concat(b.traits);
      if (b.perks) p.perks = p.perks.concat(b.perks);
      if (b.desc) p.birthDesc = b.desc;
      p.birth = cfg.birth;
    }
    if (cfg.perks) for (const pk of cfg.perks) if (!p.perks.includes(pk)) p.perks.push(pk);
    p.recalc();
  }

  /* ================================================================
   * 九、存档序列化
   * ================================================================ */
  serialize() {
    const p = this.player;
    return {
      version: this.version,
      savedAt: Date.now(),
      clockMinutes: this.clockMinutes,
      weather: this.weather,
      mods: this.mods.map(m => ({ id: m.id, name: m.name, version: m.version })),
      player: {
        name: p.name, gender: p.gender, race: p.race, level: p.level, exp: p.exp,
        potential: p.potential, hp: p.hp, mp: p.mp, food: p.food, water: p.water,
        /* 🔴 血量翻倍老 bug（主人真机 2026-10-16）：血底/内力底**必须随档**。
           maxHpBase 建号时来自 meta.startHp（40），而内功修为（neigong.js）
           运行期还会往上加 —— 这两样不存的话，读档重建 Character 时
           构造器拿不到 def.hp，落 `|| 100` 兜底：武学出身 40 → 100，
           主人看到的就是「退出再进血量翻倍」。
           recalc() 每次都从 maxHpBase 起算 —— 底子错了，后面全错。 */
        maxHpBase: p.maxHpBase, maxMpBase: p.maxMpBase,
        money: p.money, karma: p.karma, kills: p.kills, reputation: p.reputation,
        attr: p.attr, baseAttr: p.baseAttr, learned: p.learned, equippedSkills: p.equippedSkills,
        inventory: p.inventory, equipment: p.equipment, equipmentUid: p.equipmentUid,
        equipped: p.equipped, perks: p.perks, traits: p.traits, titles: p.titles,
        /* 主线分化（design/67 §5 P1）——不带上它，读档就把「我走哪条线」丢了 */
        mainline: p.mainline,
        insect: p.insect, quests: p.quests, flags: p.flags, vars: p.vars, tutorialFlags: p.tutorialFlags || [],
        /* 追踪的任务（主人 2026-10-08 的任务追踪）——不随档走的话，
           读一次档大框就空了（玩家会以为「我的任务没了」）。 */
        track: p.track || null,
        /* 结局树（design/89，S5 上线；字段 2026-10-15 预留）。
           白名单序列化不加它 = 当场能用、读档即丢。 */
        ending: p.ending || { achieved: {}, final: null },
        /* 奇经八脉 + 冲脉进度（2026-10-11）——**原来这两样都没存**，读档即清空：
           通了脉的人读一次档，maxHp/maxMp 会**掉回去**（recalc 从空经脉重算），
           而玩家只会看到「血上限怎么变少了」。静默的数据丢失。 */
        meridians: p.meridians, meridianExp: p.meridianExp || 0,
        /* 房间动作的限次记账（`once` / `oncePerDay`）。**必须随档走** ——
           不存的话读一次档就能把「一辈子一次」的参悟重新刷一遍。 */
        actionUsed: p.actionUsed || {}, actionLast: p.actionLast || {},
        /* 切磋：今日次数与胜负战绩（拒绝词要按战绩选，所以两样都得存） */
        duelLog: p.duelLog || {}, duelWin: p.duelWin || {},
        sect: p.sect, rank: p.rank, sectContribution: p.sectContribution,
        room: p.room, timeMinutes: p.timeMinutes, age: p.age,
        log: (p.log || []).slice(-200), deathCount: p.deathCount || 0,
        birth: p.birth, birthDesc: p.birthDesc,
        buffs: (p.buffs || []).slice(0, 40),
        hpMax: p.hpMax, mpMax: p.mpMax,
        /* ---- 人际关系 / 婚姻 / 结拜 / 家宅（第二批，务必随档走）---- */
        rel: (p.rel || []).map(r => Object.assign({}, r)),
        marriage: p.marriage ? cleanInstance(p.marriage, 0) : null,
        kinship: p.kinship ? cleanInstance(p.kinship, 0) : null,
        home: p.home || null,
        homes: (p.homes || []).map(h => Object.assign({}, h)),
        /* ---- 生存 / 打工 / 青楼（第三批）---- */
        prostitution: p.prostitution ? Object.assign({}, p.prostitution) : null,
        /* ---- 农田（第四批）---- */
        farm: p.farm ? Object.assign({}, p.farm) : null,
        /* ---- 自建宗门（武学重制 S2）---- */
        mySect: p.mySect ? Object.assign({}, p.mySect) : null,
        /* ---- 家园地块 + 资助NPC建家 ---- */
        estate: p.estate ? {
          plots: (p.estate.plots || []).map(x => Object.assign({}, x)),
          sponsored: Object.assign({}, p.estate.sponsored || {}),
        } : null,
        /* ---- 掳人 / 奴役 / 护院 ----
         * bags/slaves/guards 里存的是**快照**（只有 defId + 少量状态），
         * 不是活实例 —— 因为人被装走之后要从 instances 里删掉，
         * 放出来时用 reviveFromSnapshot 重新造人。 */
        kidnap: p.kidnap ? {
          bags: (p.kidnap.bags || []).map(b => JSON.parse(JSON.stringify(b))),
          slaves: (p.kidnap.slaves || []).map(s => JSON.parse(JSON.stringify(s))),
          guards: (p.kidnap.guards || []).map(g => JSON.parse(JSON.stringify(g))),
          /* 家园地牢里关着的人（同样存快照，放出时 reviveFromSnapshot）。
             ⚠️ 漏了这一行 = 读档后地牢空了，而地块还建着。 */
          captives: (p.kidnap.captives || []).map(c => JSON.parse(JSON.stringify(c))),
          wageDue: p.kidnap.wageDue || 0,
          wanted: p.kidnap.wanted || 0,
          reports: p.kidnap.reports || 0,
          debt: p.kidnap.debt ? JSON.parse(JSON.stringify(p.kidnap.debt)) : null,
        } : null,
        followers: (p.followers || []).slice(),
        /* 私域访问记录（#111 Step6）：拜访过谁家、几次。房间本身不入档
           （进出即建即拆），但「来过」要留着，日后好写「故人」类支线。 */
        visitedHouses: Object.assign({}, p.visitedHouses || {}),
      },
      /* 玩家买/布置的宅子房间是运行期动态建的，不在 data 里，必须单独存 */
      playerHomes: this.serializePlayerHomes(),
      /* 实例里存的是 Character / 物品对象，带 world 反向引用，
         必须先剥掉不可序列化的部分，否则 JSON.stringify 会循环引用报错 */
      instances: {
        npcs: safeInstanceMap(this.instances.npcs),
        items: safeInstanceMap(this.instances.items),
        corpses: safeInstanceMap(this.instances.corpses),
      },
      seed: this.rng.seed,
      deadNpcs: Object.assign({}, this.deadNpcs),
      jail: Object.assign({}, this.jail),
      /* 被掳走卖掉的 NPC 名册（黑市/青楼的货，还原时要重新 spawn） */
      soldSlaves: (this.soldSlaves || []).map(s => JSON.parse(JSON.stringify(s))),
      /* 世界记忆 · 传闻（#109）：活跃传闻数组 + uid 计数器，必须随档 */
      rumors: (this.rumors || []).map(r => JSON.parse(JSON.stringify(r))),
      rumorSeq: this.rumorSeq || 1,
      /* 世界动态 W5–W7：势力走势 / 节庆 / 事件冷却与一次性记账，必须随档
         （否则读档后势力走势被重置，而玩家的 fame/传闻都还在 → 世界记忆错位）。 */
      factionState: this.factionState ? JSON.parse(JSON.stringify(this.factionState)) : null,
      calendarState: this.calendarState ? JSON.parse(JSON.stringify(this.calendarState)) : null,
      evCooldown: Object.assign({}, this._evCooldown || {}),
      evFired: Object.assign({}, this._evFired || {}),
    };
  }

  /** 把玩家名下的宅子房间（运行期动态建、不在 data 里的）单独摘出来存 */
  serializePlayerHomes() {
    const p = this.player;
    const out = [];
    /* ① 主宅（home.js 买的） */
    const ids = [];
    for (const h of (p && p.homes) || []) ids.push(h.id);
    /* ② 家园地块（estate.js 开的）与 NPC 家（玩家资助盖的）——同样不在 data 里 */
    const est = p && p.estate;
    for (const rec of (est && est.plots) || []) if (rec && rec.roomId) ids.push(rec.roomId);
    for (const sid of Object.keys((est && est.sponsored) || {})) {
      const s = est.sponsored[sid];
      if (s && s.roomId) ids.push(s.roomId);
    }
    for (const id of ids) {
      const room = this.getRoom(id);
      if (!room) continue;
      if (out.some(x => x.id === id)) continue;
      out.push({
        id: room.id, name: room.name, region: room.region, desc: room.desc,
        owner: room.owner, private: !!room.private,
        homeTier: room.homeTier || null, homeCapacity: room.homeCapacity || 0,
        furniture: (room.furniture || []).slice(),
        plotKey: room.plotKey || null, plotLevel: room.plotLevel || 0,
        exits: cleanInstance(room.exits || {}, 0),
      });
    }
    return out;
  }

  /** 读档后重建玩家宅子房间 + 坊的反向出口 */
  restorePlayerHomes(list) {
    const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
    for (const hr of (list || [])) {
      if (!hr || !hr.id) continue;
      this.data.rooms[hr.id] = {
        id: hr.id, name: hr.name, region: hr.region, desc: hr.desc,
        owner: hr.owner, private: !!hr.private,
        homeTier: hr.homeTier || null, homeCapacity: hr.homeCapacity || 0,
        furniture: (hr.furniture || []).slice(),
        plotKey: hr.plotKey || null, plotLevel: hr.plotLevel || 0,
        exits: hr.exits || {},
      };
      /* 反向补边：玩家宅的每个出口，给对端房间补一条「回来」的边 */
      for (const dir of Object.keys(hr.exits || {})) {
        const other = hr.exits[dir];
        if (typeof other !== 'string') continue;
        const back = BACK[dir];
        const otherRoom = this.data.rooms[other];
        if (back && otherRoom && otherRoom.exits && !otherRoom.exits[back]) {
          otherRoom.exits[back] = hr.id;
        }
      }
    }
  }

  /**
   * B3 · 给物种挂上专属招式（也是 B8「按画像配功法」的写法模板）。
   *
   * 根因：`mob_snake`（毒蛇）的数据里 `skills: { 拳: "basic_fist" }`，
   * 而 `combat.pickSkill()` 原先只从 `equippedSkills` 的六个槽位里挑，
   * 于是它一辈子只会「基本拳脚」—— 主人原话「毒蛇的攻击方式是基本拳脚」。
   *
   * 修法（**不改 game/data/*.json**，数据文件保持零改动）：
   *   ① 招式定义写在 `core/bestiary.js`（标准 skill 结构，与 10_skills.json 同构）；
   *   ② 本方法在数据加载后把它们注入 `data.skills`；
   *   ③ 给对应 NPC 模板写 `speciesMoves: [招式id…]`（**新增字段，动物专用**）
   *      并补上 `learned` 学会记录；
   *   ④ `combat.pickSkill()` 优先在 speciesMoves 里随机取招。
   *
   * 为什么用新字段 speciesMoves 而不是占用 equippedSkills 的槽位：
   *   · 槽位是「装备位」，蛇的「拳」槽已被 basic_fist 占着，硬顶等于**换掉**它，
   *     改完连基本拳脚都不会了 —— 那是替换，不是修好；
   *   · 槽位顺序是固定的（剑→刀→棍→鞭→暗器→拳），一条蛇只用得上其中一个，
   *     装在槽里等于「三招只放得出一招」，B3 要的观感就没了；
   *   · speciesMoves 与「人物武学」正交，铺到人身上也不会串味
 *     （B8 给人配功法时走 equippedSkills / learned，两条路互不干扰）。
   *
   * ★ 批次 2 返工（BLK-2）：原 `speciesOf()` 第③级「描述里出现关键词就判物种」
   *   把人类 NPC 判成了蛇类。这里补一道**类型闸门**：只有 mob_/animal_ 前缀的
   *   模板才允许被注入 speciesMoves，人物模板一律不注入（详见循环内注释）。
   *
   * @returns {number} 被挂上专属招式的 NPC 模板数
   */
  applySpeciesMoves() {
    const bestiary = require('./bestiary');
    this._speciesHumanRejects = 0;   // 被类型闸门拦下的「人物却声明了 species」计数
    /* ① 注入招式定义。已存在同名id 就跳过（不覆盖 mod 自带的同名招式）。 */
    for (const list of Object.values(bestiary.SPECIES_MOVES)) {
      for (const sk of list) {
        if (!this.data.skills[sk.id]) {
          this.data.skills[sk.id] = Object.assign({ __source: 'bestiary.js(物种专属招式)' }, sk);
        }
      }
    }
    /* ② 按物种给 NPC 模板挂 speciesMoves + 补 learned（学会）。 */
    let patched = 0;
    /* ★ BLK-2 第二道保险：**只有动物 id 前缀的模板才允许被自动挂招式。**
       根因是旧 `speciesOf()` 的第③级关键词兜底（/蛇|snake|viper/ 扫 name+desc），
       把人类 NPC「蓝凤凰 miao_lan」（desc: 手腕上盘着一条碧绿小蛇）判成蛇类，
       挂上毒牙噬咬/缠身绞杀/信子吐信，**顶掉**了她自己的苗家暗器与冰蚕丝掌，
       实测她整局只出蛇类招式 —— 玩家可见的严重回归，且因运行时注入每局必现。
       现在 speciesOf() 已删掉关键词兜底，这里再加一道类型闸门：
       万一将来有人手滑给人物模板写了 species 字段（或把规则表加宽），
       **人物模板也拿不到 speciesMoves** —— 双保险，B3 不会以任何形式复发到人身上。 */
    for (const id of Object.keys(this.data.npcs)) {
      const def = this.data.npcs[id];
      const species = bestiary.speciesOf(def);
      if (!species) continue;                  // 判不出物种 → 原样不动，零影响
      /* 类型闸门：人物模板（id 非 mob_/animal_ 前缀）一律不注入。
         这是**守卫**而不是「主要判据」—— 主要判据在 speciesOf() 里。
         若这里真的拦下了什么，说明有人写了 species= 却忘了过动物闸门，
         属于数据错误，值得在报告里点名，所以这里记一笔计数。 */
      if (!bestiary.isAnimalId(id)) { this._speciesHumanRejects++; continue; }
      const moves = bestiary.SPECIES_MOVES[species] || [];
      if (!moves.length) continue;
      def.species = def.species || species;
      def.learned = def.learned || {};
      /* 只保留真正注入成功的招式 id（skills 里已存在的同名招式也算成功）。 */
      const ids = [];
      for (const sk of moves) {
        if (!this.data.skills[sk.id]) continue;
        /* 已学会就只抬熟练度，不覆盖作者定的等级。 */
        const cur = def.learned[sk.id];
        def.learned[sk.id] = (cur && typeof cur === 'object')
          ? { level: Math.max(cur.level || 1, 60) }
          : { level: 60 };
        ids.push(sk.id);
      }
      if (!ids.length) continue;
      /* 作者显式写过 speciesMoves 就不覆盖（留给 mod 自己配）。 */
      if (!Array.isArray(def.speciesMoves) || !def.speciesMoves.length) def.speciesMoves = ids;
      patched++;
    }
    return patched;
  }

  deserialize(save, modList) {
    this.loadBaseData();
    if (modList) this.loadMods(modList);
    this.buildIndexes();
    this.applySpeciesMoves();
    this.initWorldDynamics();
    if (!save || !save.player) return null;
    const sd = save.player;
    this.clockMinutes = save.clockMinutes || 540;
    this.weather = save.weather || '晴';
    const p = new Character(this, {
      name: sd.name, gender: sd.gender, race: sd.race, level: sd.level,
      attr: sd.baseAttr, money: sd.money,
      /* 🔴 血量翻倍老 bug（主人真机 2026-10-16）：血底/内力底必须在这里喂回去。
         原来不传 → 构造器落 `def.hp || 100` 兜底，出身血底全丢（40 → 100）。
         · 新档：直接用存档里的 maxHpBase/maxMpBase（serialize 白名单已收编）；
         · 老档（没这两个字段）：回落 meta.startHp/startMp —— 建号口径，
           比硬落 100 兜底准；老档内功修为加过的血底无法追回，记迁移注释即可。 */
      hp: sd.maxHpBase !== undefined ? sd.maxHpBase
        : ((this.data.meta && this.data.meta.startHp) || 100),
      mp: sd.maxMpBase !== undefined ? sd.maxMpBase
        : ((this.data.meta && this.data.meta.startMp) || 50),
    });
    Object.assign(p, {
      isPlayer: true, isNpc: false,
      exp: sd.exp, potential: sd.potential, hp: sd.hp, mp: sd.mp,
      food: sd.food, water: sd.water, karma: sd.karma, kills: sd.kills,
      reputation: sd.reputation || {}, baseAttr: sd.baseAttr,
      learned: sd.learned || {}, equippedSkills: Object.assign(p.equippedSkills, sd.equippedSkills || {}),
      inventory: sd.inventory || [], equipment: Object.assign(p.equipment, sd.equipment || {}),
      equipmentUid: sd.equipmentUid || {}, equipped: sd.equipped || {},
      perks: sd.perks || [], traits: sd.traits || [], titles: sd.titles || [],
      /* 老存档没有 mainline → 按出身补一条（别让读档的人变成「没有线」） */
      mainline: sd.mainline || require('./mainline').init(sd.birth || null, sd.gender || 'male', {}),
      insect: sd.insect || null, quests: sd.quests || {}, flags: sd.flags || {}, tutorialFlags: sd.tutorialFlags || [],
      /* 结局树（design/89，S5 上线；字段 2026-10-15 预留）。
         老档没有 ending → 兜底空结构（零迁移），S5 代码不会炸 undefined。 */
      ending: sd.ending || { achieved: {}, final: null },
      /* 老存档没有 track：一律先当「还在追新手」——
         读档后 `syncTrack()`（view / exec 每次都会跑）会自动纠正成该追的那条
         （新手走完 → 挑主线）。这里**不能**直接调 pickAuto：这一行求值时
         `p.quests` 还没赋上，pickAuto 会看到一本空任务簿、返回 null，
         于是读一次档大框就空着（玩家以为任务全丢了）。 */
      track: sd.track !== undefined ? sd.track : require('./storybeat').NEWBIE,
      meridians: Object.assign(require("./character").emptyMeridians(), sd.meridians || {}), meridianExp: sd.meridianExp || 0,
      actionUsed: sd.actionUsed || {}, actionLast: sd.actionLast || {},
      duelLog: sd.duelLog || {}, duelWin: sd.duelWin || {},
      vars: sd.vars || {}, sect: sd.sect || null, rank: sd.rank || 0,
      sectContribution: sd.sectContribution || 0, room: sd.room,
      timeMinutes: sd.timeMinutes, age: sd.age || 16,
      log: sd.log || [], deathCount: sd.deathCount || 0,
      birth: sd.birth, birthDesc: sd.birthDesc,
      /* ---- 关系 / 婚姻 / 结拜 / 家宅（第二批，务必随档恢复）---- */
      rel: (sd.rel || []).map(r => Object.assign({}, r)),
      marriage: sd.marriage ? Object.assign({}, sd.marriage) : null,
      kinship: sd.kinship ? Object.assign({}, sd.kinship) : null,
      home: sd.home || null,
      homes: (sd.homes || []).map(h => Object.assign({}, h)),
      /* ---- 生存 / 打工 / 青楼（第三批）---- */
      prostitution: sd.prostitution ? Object.assign({}, sd.prostitution) : null,
      /* ---- 农田（第四批）---- */
      farm: sd.farm ? Object.assign({}, sd.farm) : null,
      /* ---- 自建宗门（武学重制 S2）---- */
      mySect: sd.mySect ? Object.assign({}, sd.mySect) : null,
      /* ---- 家园地块 + 资助NPC建家 ---- */
      estate: sd.estate ? {
        plots: (sd.estate.plots || []).map(x => Object.assign({}, x)),
        sponsored: Object.assign({}, sd.estate.sponsored || {}),
      } : { plots: [], sponsored: {} },
      /* ---- 掳人 / 奴役 / 护院（旧档没这字段时走默认空壳，kidnap.data() 会再兜一层）---- */
      kidnap: sd.kidnap ? {
        bags: (sd.kidnap.bags || []).map(b => Object.assign({}, b)),
        slaves: (sd.kidnap.slaves || []).map(s => Object.assign({}, s)),
        guards: (sd.kidnap.guards || []).map(g => Object.assign({}, g)),
        captives: (sd.kidnap.captives || []).map(c => Object.assign({}, c)),
        wageDue: sd.kidnap.wageDue || 0,
        wanted: sd.kidnap.wanted || 0,
        reports: sd.kidnap.reports || 0,
        debt: sd.kidnap.debt ? Object.assign({}, sd.kidnap.debt) : null,
      } : { bags: [], slaves: [], guards: [], captives: [], wageDue: 0, wanted: 0, reports: 0, debt: null },
      followers: (sd.followers || []).slice(),
      visitedHouses: Object.assign({}, sd.visitedHouses || {}),
    });
    // 恢复装备物品（装备在 equipmentUid 里，物品定义从 data 取）
    p.inventory = (sd.inventory || []).map(i => Object.assign({}, i));
    p.recalc();
    this.player = p;
    /* B13 连带收尾：旧档可能停在「已被删除的房间」。
       世界区块重设计（design/19）删掉了 jn_home_02..30 等房；若存档里 player.room 正指向
       这类不存在的房，读档后玩家会被**软锁**：方向键原地不动、`go <房间名>` 抛
       「Cannot read properties of undefined (reading 'exits')」、`look` 只显「一片虚无」。
       兜底：把玩家送回 meta.startRoom，并置一条提示（由 engine.view() 顶在房间描述前，
       不静默——静默失败正是本项目反复吃亏的地方）。 */
    if (!this.data.rooms[p.room]) {
      const from = p.room;
      const fb = (this.data.meta && this.data.meta.startRoom) || Object.keys(this.data.rooms)[0];
      p.room = this.data.rooms[fb] ? fb : Object.keys(this.data.rooms)[0];
      this._migrateNotice =
        '（你原先所在的地方已不存于世间，恍惚间你竟又回到了' +
        ((this.data.rooms[p.room] || {}).name || '起点') + '。）';
      p.log = Array.isArray(p.log) ? p.log : [];
      p.log.push({ kind: 'sys', text: this._migrateNotice });
      this._roomMigrated = { from: from, to: p.room };
    }
    /* 重建玩家买的宅子房间（运行期动态建、不在 data 里） */
    this.restorePlayerHomes(save.playerHomes);
    this.reviveInstances(save.instances);
    /* 旧档自愈：把历史 bug 造出的「常驻 NPC 副本」清掉（幂等；干净档是 no-op）。
       ⚠️ 放在 reviveInstances 之后（要先有实例才能去重）、hydrateCharacter 之前都行，
          但**不能因为修复失败就拦住读档** —— 兜住异常，最坏也就是副本留着。 */
    try { this.dedupeNpcInstances(); } catch (e) { /* 自愈失败不拦读档 */ }
    /* 老档残留清剿（主人 2026-10-17 真机：出生点仍见山贼×2/游侠×2）。
       根因：noWander 钉住与 demo mod 默认关**修的是「不再漂/不再来」**，
       但漂进来时已经实例化**存进老档**的实例没人清——修源头不洗存量。
       两刀见 pruneOrphanInstances；幂等，干净档是 no-op。 */
    try { this.pruneOrphanInstances(); } catch (e) { /* 清剿失败不拦读档 */ }
    /* 玩家走的是 `new Character()` 重建（不经过 cleanInstance），本来就是真 Character。
       这里只做一次核实 + 兜底，不假设 —— 万一将来有人把玩家也塞进 instances，
       这一行会救场；正常情况下它是 no-op。 */
    hydrateCharacter(this.player, this);
    /* 自创武学**必须重新注入** `data.skills`（2026-10-11）：
       新功夫只活在运行时那张表里，存档存的是它的「身份」（id/名字/来源）。
       不重注的话，读档回来它就成了「不存在的武学」—— 面板上看不见、练不了、
       战斗里 pickSkill 也取不到，**而且全程不报错**。 */
    try { require('./customskill').rehydrate(this, this.player); } catch (e) { /* 恢复失败不拦读档 */ }
    this.rng = new RNG(save.seed || Date.now());
    this.deadNpcs = Object.assign({}, save.deadNpcs || {});
    this.jail = Object.assign({}, save.jail || {});
    this.soldSlaves = (save.soldSlaves || []).map(s => Object.assign({}, s));
    /* 世界记忆 · 传闻（#109）：恢复活跃传闻 + uid 计数器（fame 在 p.fame 里随玩家恢复） */
    this.rumors = (save.rumors || []).map(r => Object.assign({}, r));
    this.rumorSeq = save.rumorSeq || 1;
    /* 世界动态 W5–W7：势力走势 / 节庆 / 事件记账随档恢复（存档缺失则用 initWorldDynamics 的模板值）。 */
    if (save.factionState && save.factionState.factions) this.factionState = save.factionState;
    if (save.calendarState) this.calendarState = save.calendarState;
    this._evCooldown = Object.assign({}, save.evCooldown || {});
    this._evFired = Object.assign({}, save.evFired || {});
    this.syncFactionVars();
    this.emit('loaded', {});
    return p;
  }

  /* ENG-03 根因修复：读档把 instances（NPC 实例）从 cleanInstance 压扁的 plain object
     补回 Character 原型链。旧档里 def 是数字、没有 defFinal、原型被抹掉——
     这里统一恢复，确保读档后能正常战斗/社交/用物/请教。 */
  reviveInstances(instances) {
    if (!instances) return;
    this.instances = this.instances || { npcs: {}, squads: {} };
    const map = instances.npcs || {};
    for (const k of Object.keys(map)) {
      const obj = map[k];
      if (!obj) continue;
      hydrateCharacter(obj, this);            // setPrototypeOf + 绑定 world
      // 恢复 def 模板对象引用（新档 def 不进存档，靠 defId 重绑；旧档 def 被写成数字也在此纠正）
      if (typeof obj.def !== 'object' && obj.defId) obj.def = this.data.npcs[obj.defId];
      // 画像运行期状态 pstate：旧档缺失时补默认值（与 spawnNpc 保持一致），避免读档后访问崩
      if (!obj.pstate || typeof obj.pstate !== 'object') {
        obj.pstate = { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
      } else {
        obj.pstate.revealed = obj.pstate.revealed || [];
        obj.pstate.hooks = obj.pstate.hooks || {};
      }
      if (typeof obj.recalc === 'function') obj.recalc();
      /* Boss 阶段状态复位：存档是在战斗外生成的，正常已经是 0/null；
         但旧档或中途存档可能带着半截阶段，读档后要保证回到第一阶段。 */
      if (obj.bossPhaseIdx !== undefined || obj.bossSkill !== undefined) {
        obj.bossPhaseIdx = 0;
        obj.bossSkill = null;
        obj.buffs = (obj.buffs || []).filter(x => x.tag !== 'bossphase');
        if (typeof obj.recalc === 'function') obj.recalc();
      }
      this.instances.npcs[k] = obj;
    }
    if (instances.squads) {
      this.instances.squads = Object.assign(this.instances.squads || {}, instances.squads);
    }
  }
}

function item_mp_check(p, sd) {
  return !sd.mpCost || p.mp >= sd.mpCost;
}

/**
 * hydrateCharacter(obj, world) —— 把一个被 cleanInstance 压扁的实例补回 Character。
 *
 * ⚠️ 存在理由（SPRINT1-ENG-03，架构级）：
 *   cleanInstance()/safeInstanceMap() 用 `const out = {}` 逐字段重建对象，
 *   **原型链在序列化时被整个抹掉了**。读档回来后实例是纯 Object，
 *   Character 的 34 个方法（attrTotal / addBuff / skillLevel / recalc / gainExp …）全是 undefined，
 *   任何「对实例调方法」的路径都会 TypeError —— combat.js 的 hitRoll 第一句就是
 *   `defender.attrTotal('身法')`，实测读档后双向攻击全崩，等于读档后打不了仗。
 *
 *   这是**基础设施问题**，不是 combat 的局部 bug：同样的崩法会出现在社交、请教、
 *   用物品、结婚结拜、偷窃、Mod 钩子……任何对实例调方法的地方。
 *   所以补原型只在这里做一次，别散到各模块去打补丁。
 *
 * 幂等：原型已经对的实例会直接跳过（typeof recalc === 'function' 即视为已 hydrated）。
 */
function hydrateCharacter(obj, world) {
  if (!obj || typeof obj !== 'object') return obj;
  if (world) obj.world = world;
  if (typeof obj.recalc !== 'function') Object.setPrototypeOf(obj, Character.prototype);
  return obj;
}

module.exports = { World, SEASONS, SEASON_CN, WEATHERS };
