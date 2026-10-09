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
const SEASON_CN = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' };
const WEATHERS = ['晴', '阴', '雨', '雪', '风', '雾'];

/* 把运行时实例（Character / 物品）压成纯数据，剥掉 world / 循环引用，
   存档才能 JSON.stringify。恢复时由 deserialize 重新挂回 world。 */
const INSTANCE_DROP = new Set(['world', '_events', '_eventsCount', 'bus', 'engine', 'cmds']);
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
  /** BFS 找离 fromRoom 最近的酒楼/客栈 */
  nearestEatery(fromRoom) {
    if (!fromRoom) return null;
    const seen = new Set([fromRoom]);
    const q = [fromRoom];
    while (q.length) {
      const id = q.shift();
      const room = this.getRoom(id);
      if (!room) continue;
      for (const d of Object.keys(room.exits || {})) {
        const ex = room.exits[d];
        const t = typeof ex === 'string' ? ex : ex.to;
        if (t && this.getRoom(t) && !seen.has(t)) {
          if (/(tavern|wine|inn|酒楼|客栈|酒家|饭庄)/.test((this.getRoom(t).name || ''))) return t;
          seen.add(t);
          q.push(t);
        }
      }
    }
    return null;
  }

  /** 房间内可见 NPC 实例 */
  npcsIn(roomId) {
    return Object.values(this.instances.npcs).filter(n => n.room === roomId && !n.dead);
  }
  npcsIncludingTemplates(roomId) {
    const out = this.npcsIn(roomId).slice();
    const have = new Set(out.map(n => n.defId));
    for (const id of (this._npcsByRoom[roomId] || [])) {
      if (!have.has(id)) {
        const npc = this.spawnNpc(id, roomId, 1, true);
        if (npc) out.push(npc);
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
      npc.mood = def.mood !== undefined ? def.mood : 50;
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
        const eatery = this.nearestEatery(n.room);
        if (eatery && eatery !== n.room) n.room = eatery;
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
      for (const rs of [].concat(room.respawn)) {
        const alive = this.npcsIn(rid).filter(n => n.defId === rs.npc).length;
        if (alive < (rs.count || 1) && this.rng.chance(rs.chance === undefined ? 0.5 : rs.chance)) {
          this.spawnNpc(rs.npc, rid, (rs.count || 1) - alive);
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
    };
  }

  /** 把玩家名下的宅子房间（运行期动态建、不在 data 里的）单独摘出来存 */
  serializePlayerHomes() {
    const p = this.player;
    const out = [];
    for (const h of (p && p.homes) || []) {
      const room = this.getRoom(h.id);
      if (!room) continue;
      out.push({
        id: room.id, name: room.name, region: room.region, desc: room.desc,
        owner: room.owner, private: !!room.private,
        homeTier: room.homeTier || null, homeCapacity: room.homeCapacity || 0,
        furniture: (room.furniture || []).slice(),
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
    });
    // 恢复装备物品（装备在 equipmentUid 里，物品定义从 data 取）
    p.inventory = (sd.inventory || []).map(i => Object.assign({}, i));
    p.recalc();
    this.player = p;
    /* 重建玩家买的宅子房间（运行期动态建、不在 data 里） */
    this.restorePlayerHomes(save.playerHomes);
    this.instances = save.instances || { npcs: {}, items: {}, corpses: {} };
    // 复活所有实例的世界引用
    for (const k of Object.keys(this.instances.npcs)) {
      const n = this.instances.npcs[k];
      n.world = this;
      if (!n.attr) n.attr = {};
      n.recalc && n.recalc();
    }
    this.rng = new RNG(save.seed || Date.now());
    this.deadNpcs = Object.assign({}, save.deadNpcs || {});
    this.jail = Object.assign({}, save.jail || {});
    this.emit('loaded', {});
    return p;
  }
}

function item_mp_check(p, sd) {
  return !sd.mpCost || p.mp >= sd.mpCost;
}

module.exports = { World, SEASONS, SEASON_CN, WEATHERS };
