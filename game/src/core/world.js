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
const { CombatEngine, DEFAULT_HOOKS } = require('./combat');
const { evalCond, evalEffects, evalTemplate } = require('./modapi');

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

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

/* 把运行时实例（Character / 物品）压成纯数据，剥掉 world / 循环引用，
   存档才能 JSON.stringify。恢复时由 deserialize 重新挂回 world。 */
/* 'def' 也必须丢：npc.def 指向 data.npcs[defId] 的模板对象，
   每个实例都存一份 = 320 份模板副本进存档（实测 30 个 NPC 就占 105KB）。
   模板不随档变，deserialize 时按 defId 从 data 反查挂回即可。
   ⚠️ 注意 defFinal（防御力数值）**不能丢** —— 它是运行期算出来的，必须随档走。 */
const INSTANCE_DROP = new Set(['world', '_events', '_eventsCount', 'bus', 'engine', 'cmds', 'def', 'portrait']);
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
    this.activeRules = []; // 功能 Mod 的「规则」（multiply / additive / onEvent），loadMods 时收集
    this.combatHooks = Object.assign({}, DEFAULT_HOOKS);
    this.effectFns = {};
    this.condFns = {};
    this.customEffects = {};
    this.customCommands = {};
    this.uiExtensions = [];
    this.player = null;
    this.combat = new CombatEngine(this);
    this.battle = null;
    this.weather = '晴';
    this.clockMinutes = 540;
    this.version = '1.0.0';
  }

  /* ================================================================
   * 一、数据加载与 Mod 合并
   * ================================================================ */

  loadBaseData() {
    for (const dir of this.dataDirs) {
      if (!fs.existsSync(dir)) continue;
      /* ⚠ 只认 NN_xxx.json 这种命名：
         以前把备份文件（.20_items.bak.json）放在同目录，会被一起加载，
         旧版物品覆盖新版 → 静默丢字段（quality/tags 全没了）。
         现在隐藏文件/非数字前缀一律跳过，并且按文件名排序保证加载顺序稳定。 */
      const files = fs.readdirSync(dir)
        .filter(f => f.endsWith('.json') && !f.startsWith('.') && /^\d+_/.test(f))
        .sort();
      for (const f of files) {
        try {
          const raw = fs.readFileSync(path.join(dir, f), 'utf8');
          const json = JSON.parse(raw);
          this.mergeData(json, { name: '基础数据:' + f, base: true });
        } catch (e) {
          this.modLog.push({ level: 'error', msg: `基础数据解析失败 ${f}: ${e.message}` });
        }
      }
    }
    /* 同目录下若有不符合命名的 json，记一条警告（大概率是误放的备份） */
    for (const dir of this.dataDirs) {
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.json') && (f.startsWith('.') || !/^\d+_/.test(f))) {
          this.modLog.push({ level: 'warn', msg: `数据目录里的 ${f} 命名不合规范（应为 NN_名字.json），已跳过。` });
        }
      }
    }
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
  loadMods(modList) {
    // modList: [{dir, enabled, priority, id, name, version}]  已由 modloader 决定顺序
    this.mods = [];
    this.modLog = [];
    this.activeRules = [];
    for (const m of modList) {
      if (!m.enabled) continue;
      for (const fname of (m.files || ['mod.json'])) {
        const fp = path.join(m.dir, fname);
        if (!fs.existsSync(fp)) continue;
        try {
          const raw = fs.readFileSync(fp, 'utf8');
          const json = JSON.parse(raw);
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
          this.modLog.push({ level: 'error', mod: m.id, msg: `加载失败 ${fname}: ${e.message}` });
        }
      }
    }
    this.buildIndexes();
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

  buildIndexes() {
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
  /** 家园地块效果汇总（练武场/书房/丹房… 给修炼、淬体、炼制、采药用） */
  estateEffects() {
    const est = this.player && this.player.estate;
    if (!est || !Array.isArray(est.plots) || !est.plots.length) return null;
    return require('./estate').estateEffects(this);
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
    for (const id of (this._npcsByRoom[roomId] || [])) {
      if (!have.has(id)) {
        const npc = this.spawnNpc(id, roomId, 1, true);
        /* ⚠️ spawnNpc 对名人会「已有就返回那位」，而他可能人在别的房间
           （名人会走动）。这里只收真正落在本房间的，否则同一个人会被
           列两遍 —— 主人在客栈见过「岳不群 ×3」，就是这么来的。 */
        if (npc && npc.room === roomId && !have.has(npc.defId)) {
          have.add(npc.defId);
          out.push(npc);
        }
      }
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
      npc.dialog = def.dialog || null;
      npc.shop = def.shop || null;
      npc.drop = def.drop || null;
      npc.expReward = def.expReward !== undefined ? def.expReward : Math.floor((def.level || 1) * 12 + 8);
      npc.potReward = def.potReward !== undefined ? def.potReward : Math.floor((def.level || 1) * 3 + 2);
      npc.moneyReward = def.moneyReward !== undefined ? def.moneyReward : (def.money || 0);
      npc.loot = def.loot || null;
      npc.leavesCorpse = def.leavesCorpse !== false;
      npc.wander = def.wander || null;
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
      npc.personality = def.personality || personalityMod.personalityForTag(def.tag);
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
    this.emit('npcdown', { npc });
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
  }

  /** 某 NPC 是否有武力（有武学 / 战斗类身份） */
  npcHasMartialArts(npc) {
    if (!npc) return false;
    const def = npc.def || {};
    if (def.skills && Object.keys(def.skills).length) return true;
    if (npc.learned && Object.keys(npc.learned).length) return true;
    return ['swordsman', 'constable', 'escort', 'hunter', 'monk', 'taoist', 'nun', 'thief'].includes(npc.tag || def.tag);
  }

  /** 目击反应：房间里的 NPC 看到玩家杀人后的反应（跑/呼救/报官/怒视/帮人） */
  witnessReaction(victim) {
    const p = this.player;
    if (!p) return;
    const room = victim.room;
    const personalityMod = require('./personality');
    const witnesses = this.npcsIn(room).filter(n => n.id !== victim.id && !n.dead && !(n.def || {}).hostile);
    for (const w of witnesses) {
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
      // 消耗潜能/时间
      const cost = def.cost || 100;
      if (ch.potential < cost) return { ok: false, msg: `研读此书需耗费 ${cost} 点潜能，你尚不足。`, lines: [] };
      ch.potential -= cost;
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
    const room = this.data.rooms[roomId];
    if (!room) return { ok: false, msg: `（不存在房间：${roomId}）` };
    const old = this.data.rooms[ch.room];
    ch.room = roomId;
    this.emit('roomchange', { ch, from: old ? old.id : null, to: roomId });
    this.fireEvent('onEnter', { roomId, ch });
    this.onRoomEnter(ch, room);
    return { ok: true, msg: '' };
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
    if (room.encounter && this.rng.next() < (room.encounter.chance || 0.2)) {
      const pool = room.encounter.npcs || [];
      if (pool.length) {
        const nid = this.rng.pick(pool);
        const npc = this.spawnNpc(nid, ch.room, 1);
        if (npc) {
          npc.hostile = true;
          lines.push({ kind: 'warn', text: `【遭遇】${npc.name}拦住去路！` });
          this.startCombat(ch, npc);
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
    if (!npc) return { lines: [{ kind: 'warn', text: '找不到切磋的对手。' }] };
    if (this.battle) return { lines: [{ kind: 'warn', text: '你正与人交手，先了结眼前这桩。' }] };
    const def = npc.def || {};
    /* 对方愿不愿意？好感太低 / 讨厌你 → 拒绝 */
    if ((npc.favor || 0) < -40) {
      return { lines: [{ kind: 'say', text: `${npc.name}冷冷道：「我不与你这等人动手。」` }] };
    }
    if (/\b狼|虎|熊|蛇|豹|兽/.test(npc.name)) {
      return { lines: [{ kind: 'warn', text: `${npc.name}可不是能讲道理的。` }] };
    }
    npc.duel = true;
    npc.hostile = false;
    ch.inCombat = true;
    npc.inCombat = true;
    this.battle = {
      attackers: [ch],
      defenders: [npc],
      turn: 0, log: [], over: false, winner: null,
      startedAt: this.clockMinutes,
      target: npc,
      duel: true,
    };
    this.emit('combatstart', { battle: this.battle });
    return {
      battle: this.battle,
      lines: [
        { kind: 'story', text: `${npc.name}退开半步，抱拳道：「请。」` },
        { kind: 'hint', text: '（切磋点到为止，不会伤及性命。用「flee」可随时收手。）' },
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

  startCombat(ch, targetIdOrNpc) {
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
    };
    this.emit('combatstart', { battle: this.battle });
    return { ok: true, battle: this.battle, npc };
  }

  combatStep(userAction) {
    if (!this.battle || this.battle.over) return null;
    // 玩家行动
    if (userAction === 'flee') {
      const p = this.player;
      const t = this.battle.defenders[0];
      const chance = clamp(0.3 + (p.speed - (t ? t.speed : 10)) * 0.02, 0.05, 0.9);
      if (this.rng.next() < chance) {
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
      const lv = p.skillLevel(sd.id);
      if (item_mp_check(p, sd)) {
        const r = this.combat.oneAttack(p, t, sd, this.battle, 0);
        const lines = [];
        if (r) lines.push(r);
        if (t.hp <= 0) { this.combat.onDeath(t, this.battle, lines, true); this.battle.over = true; this.battle.winner = 'attackers'; }
        if (this.battle.over) return this.finishCombat(lines);
        return { lines: this.stepEnemyOnly(lines) };
      } else {
        return { lines: [{ kind: 'combat', text: `${sd.name}需要 ${sd.mpCost} 点内力，你内力不足。` }] };
      }
    }
    if (userAction && userAction.type === 'item') {
      const p = this.player;
      const useRes = this.useItem(p, userAction.uid);
      const lines = (useRes.lines || []).slice();
      return { lines: this.stepEnemyOnly(lines) };
    }
    // 普通攻击 / 自动一回合
    const r = this.combat.step(this.battle);
    let lines = r.lines;
    lines = this.stepEnemyOnly(lines, true);
    if (this.battle && this.battle.over) return this.finishCombat(lines);
    // 玩家死亡
    if (this.player.hp <= 0) { this.playerDeath(); return this.finishCombat(lines); }
    return { lines };
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
      const sk = this.combat.pickSkill(e, p);
      const n = this.combat.pickSkill(e, p) && sk && sk.hits ? sk.hits : this.combat.baseAttackCount(e, p);
      for (let i = 0; i < n; i++) {
        if (p.hp <= 0) break;
        const rr = this.combat.oneAttack(e, p, i === 0 ? sk : null, battle, i);
        if (rr) lines.push(rr);
      }
      if (p.hp <= 0) {
        lines.push({ kind: 'combat', text: '你眼前一黑，倒了下去……' });
        break;
      }
    }
    if (enemies.every(e => e.hp <= 0)) { battle.over = true; battle.winner = 'attackers'; }
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
      const foe = (b.defenders || [])[0];
      if (foe) {
        foe.duel = false;
        const win = b.winner === 'attackers';
        const social = require('./social');
        if (win) {
          lines.push({ kind: 'story', text: `${foe.name}收势立定，拱手道：「好身手。」` });
          const r1 = social.addFavor(this, foe, 6, '切磋获胜');
          lines.push(...r1.lines);
          const gain = 20 + (foe.level || 1) * 2;
          this.player.gainExp(gain);
          this.player.potential += 8 + (foe.level || 1);
          lines.push({ kind: 'sys', text: `切磋一场，你颇有所得（经验 +${gain}，潜能 +${8 + (foe.level || 1)}）。` });
        } else if (b.winner === 'flee') {
          lines.push({ kind: 'say', text: `${foe.name}笑道：「承让，改日再讨教。」` });
          const r2 = social.addFavor(this, foe, 2, '切磋收手');
          lines.push(...r2.lines);
        } else {
          lines.push({ kind: 'story', text: `${foe.name}扶住踉跄的你：「今日是我占了上风，你的路数却很是有趣。」` });
          const r3 = social.addFavor(this, foe, 3, '切磋败北');
          lines.push(...r3.lines);
        }
      }
    }

    const res = { lines, over: true, winner: b.winner, battle: b };
    this.battle = null;
    this.emit('combatend', res);
    return res;
  }

  playerDeath() {
    const p = this.player;
    p.dead = true;
    p.hp = 0;
    const lost = Math.floor(p.money * 0.2);
    p.money -= lost;
    p.exp = Math.max(0, Math.floor(p.exp * 0.9));
    p.deathCount = (p.deathCount || 0) + 1;
    this.emit('playerdeath', { lost });
  }

  /* ================================================================
   * 七、时间 / 世界心跳
   * ================================================================ */
  advanceTime(minutes) {
    minutes = minutes || 1;
    const p = this.player;
    if (!p) return;
    this.clockMinutes += minutes;
    p.timeMinutes = this.clockMinutes;
    p.age = 16 + Math.floor(p.timeMinutes / 1440 / 120);
    // 饥饿
    if (minutes >= 10) {
      p.food = clamp(p.food - Math.floor(minutes / 12), 0, p.maxFood);
      p.water = clamp(p.water - Math.floor(minutes / 8), 0, p.maxWater);
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
    this.emit('time', { minutes: this.clockMinutes });
  }

  worldTick() {
    // NPC 游走
    for (const id of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[id];
      if (!n.wander) continue;
      if (this.rng.chance(n.wander.chance || 0.05)) {
        const room = this.data.rooms[n.room];
        if (!room || !room.exits) continue;
        const dirs = Object.keys(room.exits);
        if (!dirs.length) continue;
        const d = this.rng.pick(dirs);
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        if (tid && this.data.rooms[tid]) n.room = tid;
      }
    }
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
    const handlers = this.data.events[name] || [];
    for (const h of [].concat(handlers)) {
      if (h.cond && !evalCond(h.cond, { player: this.player, world: this })) continue;
      evalEffects(h.effects, { player: this.player, world: this, event: payload }).forEach(l => this.emit('storyline', { line: l }));
    }
    // 功能 Mod 的 onEvent 规则（kind=onEvent, target=事件名）
    for (const r of this.activeRules) {
      if (r.kind !== 'onEvent' || r.target !== name) continue;
      if (r.cond && !evalCond(r.cond, { player: this.player, world: this })) continue;
      const eff = r.effect || r.effects;
      if (!eff) continue;
      evalEffects(eff, { player: this.player, world: this, event: payload }).forEach(l => this.emit('storyline', { line: l }));
    }
  }

  /* ================================================================
   * 八、创建玩家
   * ================================================================ */
  createPlayer(cfg) {
    cfg = cfg || {};
    const meta = this.data.meta;
    const p = new Character(this, {
      name: cfg.name || '无名侠客',
      gender: cfg.gender || 'male',
      race: cfg.race || 'human',
      level: cfg.level || 1,
      attr: cfg.attr || meta.startAttr,
      hp: meta.startHp, mp: meta.startMp,
      money: cfg.money !== undefined ? cfg.money : (meta.startMoney || 100),
      potential: cfg.potential !== undefined ? cfg.potential : (meta.startPotential || 200),
      perks: cfg.perks || [],
      traits: (cfg.traits || []).concat(meta.startTraits || []),
      timeMinutes: meta.startTime || 540,
    });
    p.isPlayer = true;
    p.isNpc = false;
    p.personality = cfg.personality || 'haoshuang';
    p.room = meta.startRoom || 'road_1';
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
    p.kidnap = { bags: [], slaves: [], guards: [], wageDue: 0, wanted: 0, reports: 0, debt: null };
    p.followers = [];   // 跟随玩家的 NPC 实例 id（好感>60 才能邀）
    // 起始物品
    for (const it of (meta.startItems || [])) this.giveItem(p, it, 1);
    this.player = p;
    this.clockMinutes = p.timeMinutes;
    this.buildIndexes();
    // 起始武学
    for (const s of (meta.startSkills || [])) p.learnSkill(s);
    // 自动接主线任务（type === '主线'），让「任务」面板开局就有主线可看
    for (const qid of Object.keys(this.data.quests || {})) {
      if (this.data.quests[qid].type === '主线') p.setQuestStage(qid, 0);
    }
    // 性格/出身加成
    this.applyBirth(cfg, p);
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
        money: p.money, karma: p.karma, kills: p.kills, reputation: p.reputation,
        attr: p.attr, baseAttr: p.baseAttr, learned: p.learned, equippedSkills: p.equippedSkills,
        inventory: p.inventory, equipment: p.equipment, equipmentUid: p.equipmentUid,
        equipped: p.equipped, perks: p.perks, traits: p.traits, titles: p.titles,
        insect: p.insect, quests: p.quests, flags: p.flags, vars: p.vars, tutorialFlags: p.tutorialFlags || [],
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
          wageDue: p.kidnap.wageDue || 0,
          wanted: p.kidnap.wanted || 0,
          reports: p.kidnap.reports || 0,
          debt: p.kidnap.debt ? JSON.parse(JSON.stringify(p.kidnap.debt)) : null,
        } : null,
        followers: (p.followers || []).slice(),
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

  deserialize(save, modList) {
    this.loadBaseData();
    if (modList) this.loadMods(modList);
    this.buildIndexes();
    if (!save || !save.player) return null;
    const sd = save.player;
    this.clockMinutes = save.clockMinutes || 540;
    this.weather = save.weather || '晴';
    const p = new Character(this, {
      name: sd.name, gender: sd.gender, race: sd.race, level: sd.level,
      attr: sd.baseAttr, money: sd.money,
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
      insect: sd.insect || null, quests: sd.quests || {}, flags: sd.flags || {}, tutorialFlags: sd.tutorialFlags || [],
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
        wageDue: sd.kidnap.wageDue || 0,
        wanted: sd.kidnap.wanted || 0,
        reports: sd.kidnap.reports || 0,
        debt: sd.kidnap.debt ? Object.assign({}, sd.kidnap.debt) : null,
      } : { bags: [], slaves: [], guards: [], wageDue: 0, wanted: 0, reports: 0, debt: null },
      followers: (sd.followers || []).slice(),
    });
    // 恢复装备物品（装备在 equipmentUid 里，物品定义从 data 取）
    p.inventory = (sd.inventory || []).map(i => Object.assign({}, i));
    p.recalc();
    this.player = p;
    /* 重建玩家买的宅子房间（运行期动态建、不在 data 里） */
    this.restorePlayerHomes(save.playerHomes);
    this.reviveInstances(save.instances);
    /* 玩家走的是 `new Character()` 重建（不经过 cleanInstance），本来就是真 Character。
       这里只做一次核实 + 兜底，不假设 —— 万一将来有人把玩家也塞进 instances，
       这一行会救场；正常情况下它是 no-op。 */
    hydrateCharacter(this.player, this);
    this.rng = new RNG(save.seed || Date.now());
    this.deadNpcs = Object.assign({}, save.deadNpcs || {});
    this.jail = Object.assign({}, save.jail || {});
    this.soldSlaves = (save.soldSlaves || []).map(s => Object.assign({}, s));
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
