/**
 * engine.js — 游戏引擎整合层
 *
 * 把 World + Commands + ModLoader 组装成一个可直接调用的门面，
 * 供 HTTP / IPC / 测试使用。与 UI 完全解耦。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { World } = require('./world');
const { ModLoader } = require('./modloader');
const { buildCommands, cnNum } = require('./commands');
const { evalCond, evalEffects, evalTemplate } = require('./modapi');
const { fmtTime, shichen, stars, clamp, fuzzyFind, normalizeCmd } = require('./utils');
const mapLayout = require('./maplayout');
const tutorial = require('./tutorial');
const social = require('./social');
const marriage = require('./marriage');
const kinship = require('./kinship');
const homeMod = require('./home');
const survival = require('./survival');
const workMod = require('./work');

/* 身份标签 → 中文（给 UI 用） */
const TAG_NAMES = {
  commoner: '寻常百姓', vendor: '市井摊贩', scholar: '书生', farmer: '农户', smith: '铁匠',
  doctor: '郎中', innkeeper: '客栈掌柜', waiter: '店小二', merchant: '商贾', richman: '富户',
  groom: '车夫', child: '孩童', beggar: '乞丐', refugee: '流民', escort: '镖师',
  constable: '捕快', official: '官员', eunuch: '太监', palace: '宫人', consort: '妃嫔',
  courtesan: '风尘女子', madam: '老鸨', singer: '乐伎', swordsman: '侠客', thief: '盗贼',
  hunter: '猎户', monk: '僧人', nun: '尼姑', taoist: '道人', actor: '戏子',
  boatman: '船夫', gambler: '赌徒', waiter2: '茶博士',
};
function tagNameCN(t) { return t ? (TAG_NAMES[t] || t) : null; }

// 注册到世界的内置自定义条件 / 效果函数
function registerBuiltinFns(world) {
  world.condFns.anySkill100 = ({ }, ctx) => {
    const p = ctx.player;
    return Object.keys(p.learned).some(k => p.skillLevel(k) >= 100);
  };
  world.condFns.anySkill500 = ({ }, ctx) => {
    const p = ctx.player;
    return Object.keys(p.learned).some(k => p.skillLevel(k) >= 500);
  };
  world.condFns.defeatLegend = ({ }, ctx) => {
    const p = ctx.player;
    return ['mojiao_dongfang', 'blood_saber', 'xingxiu_laoxian', 'shaolin_fangzheng', 'emei_miejue', 'nv_huang']
      .some(id => p.hasFlag('killed_' + id));
  };
  world.condFns.visited50 = ({ }, ctx) => Object.keys(ctx.player.flags).filter(k => k.startsWith('visited_')).length >= 50;
  world.condFns.hasItemCount = (args, ctx) => ctx.player.countItem(args.item) >= (args.count || 1);
  // 完成 N 条支线（主线靠支线推进：认识江湖朋友、打探消息）
  world.condFns.sideQuestsDone = (args, ctx) => {
    const p = ctx.player;
    const need = args.count || args.n || 5;
    const done = Object.keys(p.quests || {}).filter(id =>
      /^sq_/.test(id) && p.quests[id] >= 99).length;
    return done >= need;
  };
  // 认识某 NPC（有交情：好感偏离初始值，或完成过其支线）
  world.condFns.knowsNpc = (args, ctx) => {
    const p = ctx.player;
    const id = args.npc || args.id;
    const def = ctx.world.data.npcs[id];
    if (!def) return false;
    return (def.favor !== undefined && def.favor !== def.favorInit) || p.hasFlag('sq_' + id + '_done');
  };

  world.effectFns.sayHi = ({ }, ctx) => [`你好，${ctx.player.name}。`];
  world.effectFns.rollDice = ({ args }, ctx) => {
    const n = ctx.world.rng.int(1, args[0] ? parseInt(args[0], 10) : 6);
    return `你掷出了 ${n} 点。`;
  };
}

class GameEngine {
  constructor(opts) {
    opts = opts || {};
    const projectRoot = opts.projectRoot || path.resolve(__dirname, '..', '..', '..');
    this.projectRoot = projectRoot;
    this.gameDir = path.join(projectRoot, 'game');
    this.dataDir = path.join(this.gameDir, 'data');
    this.modsDir = og(opts.modsDir, path.join(projectRoot, 'mods'));
    this.saveDir = og(opts.saveDir, path.join(projectRoot, 'saves'));
    this.userDataDir = og(opts.userDataDir, path.join(this.gameDir, 'userdata'));
    if (!fs.existsSync(this.saveDir)) fs.mkdirSync(this.saveDir, { recursive: true });
    if (!fs.existsSync(this.userDataDir)) fs.mkdirSync(this.userDataDir, { recursive: true });

    this.modLoader = new ModLoader(this.modsDir);
    /* ⚠ seed 透传给 World：测试里传固定 seed 就能完全复现，
       不用再被随机数搞出假失败。 */
    this.world = new World({ dataDirs: [this.dataDir], modDirs: [this.modsDir], seed: opts.seed });
    this.cmds = null;
    this.ready = false;
    this.bootLog = [];
  }

  /** 启动：加载数据 + mod */
  boot(saveId) {
    const w = this.world;
    w.dataDirs = [this.dataDir];
    const modList = this.modLoader.getEnabledModList();
    w.loadBaseData();
    const modLog = w.loadMods(modList);
    registerBuiltinFns(w);
    this.cmds = buildCommands(w);
    this.ready = true;
    this.bootLog = []
      .concat(modLog.filter(l => l.level !== 'info'))
      .concat(this.modLoader.resolveLoadOrder().problems);
    // 自定义命令 / UI 扩展
    w.customCommands = w.customCommands || {};
    for (const u of w.uiExtensions) { /* 传给 UI */ }
    if (saveId) {
      const s = this.readSave(saveId);
      if (s) { w.deserialize(s, modList); this.restoreRelations(); }
    }
    return { bootLog: this.bootLog, mods: this.modLoader.mods.map(m => ({ id: m.id, name: m.name, version: m.version, enabled: m.enabled, category: m.category })) };
  }

  /** 重新加载（mod 变更后） */
  reload() {
    this.modLoader.scan();
    const playerSave = this.world.player ? this.world.serialize() : null;
    this.world = new World({ dataDirs: [this.dataDir], modDirs: [this.modsDir], seed: this.world.seed });
    this.world.loadBaseData();
    this.world.loadMods(this.modLoader.getEnabledModList());
    registerBuiltinFns(this.world);
    this.cmds = buildCommands(this.world);
    if (playerSave) {
      try { this.world.deserialize(playerSave, this.modLoader.getEnabledModList()); this.restoreRelations(); } catch (e) { /* 兼容性失败则忽略 */ }
    }
    return { mods: this.modLoader.mods.length };
  }

  /**
   * 读档后重建「NPC 模板」上的关系字段。
   *
   * ⚠️ 婚姻/结拜/结缘会同时写「玩家 p.rel/p.marriage/p.kinship」和
   *   「NPC 模板 def.spouse/isConcubine/bonded/kin/knows_player_of」。
   *   但存档只存了玩家侧 + 实例（instances.npcs），NPC 模板在
   *   loadBaseData() 时从磁盘重新加载 → 模板上的关系字段全被清空。
   *   所以要在这里根据玩家侧数据，重新打回模板（幂等，重复打无害）。
   */
  restoreRelations() {
    const w = this.world, p = w.player;
    if (!p) return;
    const m = p.marriage;
    if (m) {
      if (m.spouse && w.data.npcs[m.spouse]) marriage.linkSpouse(w, m.spouse, p.name);
      for (const id of (m.concubines || [])) {
        const d = w.data.npcs[id];
        if (!d) continue;
        d.isConcubine = true; d.spouse = 'player_sp'; d.spouseName = p.name;
        if (!d.rel) d.rel = [];
        if (!d.rel.some(r => r.id === 'player')) d.rel.push({ id: 'player', kind: '妾', name: p.name });
        const inst = marriage.instById(w, id);
        if (inst) { inst.isConcubine = true; inst.spouse = 'player_sp'; inst.spouseName = p.name; }
      }
      for (const id of (m.bonds || [])) {
        if (!w.data.npcs[id]) continue;
        marriage.linkBond(w, id);
        marriage.spreadBond(w, id, p.name);
      }
    }
    const k = p.kinship;
    if (k) {
      for (const slot of Object.keys(k)) {
        if (slot === 'total' || !Array.isArray(k[slot])) continue;
        for (const x of k[slot]) {
          const id = typeof x === 'string' ? x : (x && x.id);
          if (!id || !w.data.npcs[id]) continue;
          kinship.linkKin(w, id, (x && x.kind) || slot, (x && x.label));
        }
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * 开局
   * ------------------------------------------------------------------ */
  newGame(cfg) {
    if (!this.ready) this.boot();
    const p = this.world.createPlayer(cfg);
    this.world.emit('newgame', { player: p });
    // 触发主线任务
    p.setQuestStage('q_main_jianghu', 0);
    p.setFlag('visited_' + p.room, true);
    return this.view();
  }

  /** 当前视图快照（给 UI 渲染） */
  view() {
    const w = this.world, p = w.player;
    if (!p) return { ok: false, needCreate: true, meta: w.data.meta };
    const room = w.getRoom(p.room);
    const region = room ? w.getRegion(room.region) : null;
    const lines = this.cmds.lookRoom({ player: p, world: w }).lines;

    const exits = room ? Object.keys(room.exits || {}).map(d => {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(tid);
      const locked = ex && ex.cond && !evalCond(ex.cond, { player: p, world: w });
      return { dir: d, name: (this.cmds.DIR_CN[d] || d), to: tid, toName: tr ? tr.name : '?', locked: !!locked };
    }) : [];

    const npcs = w.npcsIncludingTemplates(p.room).map(n => ({
      id: n.id, defId: n.defId, name: n.name, title: n.title,
      level: n.level, hp: n.hp, maxHp: n.maxHp, hostile: n.hostile,
      hasQuest: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) < 0)),
      canReport: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) >= 0 && p.questStage(q) < 99)),
      shop: !!n.shop, canTeach: !!(n.def && n.def.teach),
      /* ---- 社交扩展（第一批）---- */
      favor: n.favor || 0,
      favorTier: social.favorTier(n.favor || 0).name,
      favorColor: social.favorTier(n.favor || 0).color,
      tag: (n.def && n.def.tag) || null,
      tagName: tagNameCN((n.def && n.def.tag) || null),
      gender: n.gender,
      canQingjiao: !!(n.def && n.def.teach && n.def.teach.length),
      canQiecuo: !n.dead && !/\b狼|虎|熊|蛇|豹|兽/.test(n.name),
      canSteal: !!(n.carry && ((n.carry.items || []).length || n.carry.money)),
      likes: ((n.def && n.def.likes) || []).map(x => {
        const lt = social.LIKE_TYPES.find(y => y.id === x);
        return lt ? { id: lt.id, name: lt.cn } : null;
      }).filter(Boolean),
      hasHome: !!(n.def && n.def.home),
      homeName: (n.def && n.def.home && w.getRoom(n.def.home)) ? w.getRoom(n.def.home).name : null,
      /* ---- 婚姻扩展（第二批）---- */
      age: n.age || (n.def && n.def.age) || 0,
      spouseName: n.spouse === 'player' ? (p.name || '你') : (n.spouse ? (n.spouseName || '已婚') : null),
      taken: !!(n.spouse || (n.def && n.def.spouse)),
      isConcubine: !!n.isConcubine,
      bonded: !!n.bonded,
      knowsPlayerOf: n.knows_player_of || null,
      marriedToMe: n.spouse === 'player',
      /* ---- 结拜扩展（第二批）----
         kinLabel：他是我什么人（义父/义兄…）；
         addressMe：他管我叫什么（义子/义弟…），对话里用。 */
      kinLabel: (() => {
        const kin = kinship.relationOf(w, n.id);
        return kin ? (kin.label || kin.kind) : null;
      })(),
      addressMe: kinship.addressMe(w, n),
      canSwear: !kinship.alreadyKin(w, n.id) && !kinship.isMarriedTo(w, n.id),
    }));

    const groundItems = w.itemsIn(p.room).map(i => {
      const d = w.getItem(i.itemId);
      return { uid: i.id, itemId: i.itemId, name: d ? d.name : i.itemId, count: i.count || 1 };
    });
    const corpses = w.corpsesIn(p.room).map(c => ({ id: c.id, name: c.name, lootCount: c.loot.length }));

    // 房间里的可交互物件（供 UI 高亮 + 点击提示指令）
    const roomActions = this.roomActionsView(p);

    // 任务进度条
    const quests = this.questList();

    return {
      ok: true,
      lines,
      time: { ...fmtTime(p.timeMinutes), shichen: shichen(p.timeMinutes), season: w.seasonCN(), weather: w.weather, night: w.isNight() },
      room: room ? {
        id: room.id, name: room.name,
        region: region ? region.name : room.region,
        regionId: room.region,
        regionColor: region ? region.color : '#666',
        desc: evalTemplate(room.desc || '', { player: p, world: w }),
        color: region ? region.color : '#666',
        env: [w.seasonCN(), shichen(p.timeMinutes), w.weather].filter(Boolean).join(' · '),
        /* 家宅：这间屋子归谁、我能不能上手布置 */
        owner: room.owner || null,
        isMine: room.owner === 'player',
        canOperate: homeMod.canOperate(w, room.id),
        furniture: (room.furniture || []).slice(),
      } : null,
      exits,
      roomActions,
      npcs,
      groundItems,
      corpses,
      player: this.playerBrief(),
      combat: w.battle ? this.combatView() : null,
      quests,
      map: this.mapView(),
      guide: tutorial.guideState(p, p.tutorialFlags || []),
      marriage: marriage.summary(w),
      kinship: kinship.summary(w),
      home: homeMod.summary(w),
      mods: this.modLoader.mods.map(m => ({ id: m.id, name: m.name, version: m.version, author: m.author, enabled: m.enabled, category: m.category, description: m.description, counts: m.counts })),
    };
  }

  /**
   * 当前房间的可交互物件（供 UI 高亮显示 + 点击提示该用什么指令）。
   * 数据源：房间 data 的 actions（如「打铁 / 采药 / 钓鱼 / 出海」）。
   * 返回 [{ name, cmd, keywords, ok, reason }]
   *   name     —— 展示用的物件名（取 keywords[0]，没有就用房间名）
   *   cmd      —— 建议玩家输入的指令
   *   ok       —— 当前条件是否满足
   *   reason   —— 不满足时的原因（给玩家提示）
   */
  roomActionsView(p) {
    const w = this.world;
    const room = w.getRoom(p.room);
    if (!room || !Array.isArray(room.actions) || !room.actions.length) return [];
    const out = [];
    for (const a of room.actions) {
      const kws = a.keywords || [];
      const name = a.label || kws[0] || a.cmd || room.name;
      const cmd = a.cmd || kws[0] || '';
      if (!cmd) continue;
      let ok = true, reason = '';
      if (a.cond) {
        try {
          if (!evalCond(a.cond, { player: p, world: w })) {
            ok = false;
            reason = a.failMsg || this.condText(a.cond);
          }
        } catch (e) { ok = true; }
      }
      out.push({ name, cmd, keywords: kws.slice(0, 4), ok, reason, desc: a.desc || '' });
    }
    return out;
  }

  /** 把条件对象翻译成人话（「需要 5 个铁矿石」这种） */
  condText(cond) {
    if (!cond) return '';
    const w = this.world;
    const parts = [];
    if (cond.item) {
      const d = w.getItem(cond.item);
      parts.push('需 ' + (cond.count || 1) + ' 个' + (d ? d.name : cond.item));
    }
    if (cond.money != null) parts.push('需 ' + cond.money + ' 文');
    if (cond.mp) parts.push('需内力 ' + cond.mp);
    if (cond.hp) parts.push('需气血 ' + cond.hp);
    if (cond.skill) {
      const s = w.getSkill(cond.skill);
      parts.push('需' + (s ? s.name : cond.skill) + (cond.level ? ' ' + cond.level + ' 级' : ''));
    }
    if (cond.chance != null && !parts.length) parts.push('成功率 ' + Math.round(cond.chance * 100) + '%');
    return parts.join('，');
  }

  /** 武学境界（删等级后，玩家强弱只看武学功法等级之和） */
  realmName(p) {
    let sum = 0;
    for (const k of Object.keys(p.learned || {})) sum += (p.learned[k] && p.learned[k].level) || 0;
    if (sum <= 0) return '不通武艺';
    if (sum < 30) return '初窥门径';
    if (sum < 100) return '小有所成';
    if (sum < 300) return '登堂入室';
    if (sum < 800) return '炉火纯青';
    return '登峰造极';
  }

  playerBrief() {
    const p = this.world.player, w = this.world;
    return {
      name: p.name, gender: p.gender, realm: this.realmName(p),
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
      food: p.food, water: p.water, maxFood: p.maxFood, maxWater: p.maxWater,
      money: p.money, gold: p.goldText(), karma: p.karma, kills: p.kills,
      potential: p.potential, title: p.title, titles: p.titles,
      sect: p.sect, sectName: p.sect ? (w.getSect(p.sect) || {}).name : null,
      rank: p.rank, rankName: p.sect && w.getSect(p.sect) && w.getSect(p.sect).ranks ? w.getSect(p.sect).ranks[p.rank] : null,
      attr: p.attr, atk: p.atk, def: p.def, dodge: p.dodge, parry: p.parry, speed: p.speed,
      critRate: p.critRate, age: p.age,
      buffs: p.buffs.map(b => ({ name: b.name, turns: b.turns })),
      traits: p.traits.map(t => { const td = w.getTrait(t); return { id: t, name: td ? td.name : t, desc: td ? td.desc : '' }; }),
      perks: p.perks.map(t => { const td = w.getTrait(t); return { id: t, name: td ? td.name : t, desc: td ? td.desc : '' }; }),
      skills: this.skillList(),
      inventory: this.inventoryList(),
      equipment: this.equipmentList(),
      dead: p.dead, deathCount: p.deathCount || 0,
      reputation: p.reputation,
      starving: p.food <= 0, parched: p.water <= 0,
      prostitution: p.prostitution ? {
        sold: !!p.prostitution.sold, debt: p.prostitution.debt || 0,
        served: p.prostitution.served || 0, earnings: p.prostitution.earnings || 0,
        redeemed: !!p.prostitution.redeemed,
      } : null,
    };
  }

  skillList() {
    const p = this.world.player, w = this.world;
    const out = [];
    for (const id of Object.keys(p.learned)) {
      const sd = w.getSkill(id);
      if (!sd) continue;
      const cur = p.learned[id];
      out.push({
        id, name: sd.name, type: sd.type, level: p.skillLevel(id), maxLevel: p.maxSkillLevelFor(sd),
        exp: cur.exp, expNeed: p.skillExpNeed(cur.level), equipped: Object.values(p.equippedSkills).includes(id),
        desc: sd.desc, trainCost: p.trainCost(sd, cur.level), canTrain: p.skillLevel(id) < p.maxSkillLevelFor(sd),
        effects: (sd.effects || []).map(e => e.type),
      });
    }
    return out.sort((a, b) => a.type.localeCompare(b.type) || b.level - a.level);
  }

  inventoryList() {
    const p = this.world.player, w = this.world;
    return (p.inventory || []).map(it => {
      const d = w.getItem(it.id) || {};
      return {
        uid: it.uid, id: it.id, name: d.name || it.id, type: d.type, desc: d.desc,
        count: it.count || 1, value: d.value || 0, slot: d.slot,
        stats: d.stats, healHp: d.healHp, healMp: d.healMp, teach: d.teach,
        equippable: !!(d.slot || d.type === 'weapon' || d.type === 'armor'),
        usable: !!(d.use || d.teach || d.healHp || d.healMp || d.type === 'food' || d.type === 'consumable' || d.type === 'herb'),
        teachName: d.teach ? (w.getSkill(d.teach) || {}).name : null,
      };
    });
  }

  equipmentList() {
    const p = this.world.player, w = this.world;
    const slots = ['头部', '颈部', '身体', '披风', '手部', '脚部', '武器', '副手', '戒指', '饰品'];
    return slots.map(s => {
      const id = p.equipment[s];
      const d = id ? w.getItem(id) : null;
      return { slot: s, itemId: id, name: d ? d.name : null, stats: d ? d.stats : null };
    });
  }

  questList() {
    const p = this.world.player, w = this.world;
    const out = [];
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd) continue;
      const stage = qd.stages && qd.stages[st];
      const targets = (stage && stage.targets || []).map(t => {
        const vk = t.var || `q_${qid}_${t.id}`;
        let cur = 0;
        if (t.kind === 'item') cur = p.countItem(t.key);
        else cur = p.getVar(vk) || 0;
        return { desc: t.desc || t.id, cur: Math.min(cur, t.count || 1), count: t.count || 1 };
      });
      out.push({ id: qid, name: qd.name, type: qd.type, level: qd.level, stage: st, desc: qd.desc, stageDesc: stage ? stage.desc : '', targets });
    }
    // 已完成
    const done = Object.keys(p.quests).filter(k => p.quests[k] >= 99);
    return { active: out, done, completedCount: done.length };
  }

  mapView() {
    const w = this.world, p = w.player;
    const room = w.getRoom(p.room);
    if (!room) return { region: null, rooms: [], current: null };
    const region = w.getRegion(room.region);
    const allRooms = w.data.rooms;

    /* --- 布局：区域装箱，每个区域内部按出口方向排布 --- */
    if (!this._mapLayout || this._mapLayoutFor !== allRooms) {
      this._mapLayout = mapLayout.layoutAll(allRooms, w.data.regions, room.id);
      this._mapLayoutFor = allRooms;
    }
    const layout = this._mapLayout;

    /* --- 探索度：玩家去过哪些房间 --- */
    const visitedCount = Object.keys(allRooms)
      .filter(id => p.hasFlag('visited_' + id)).length;

    /* --- 从当前位置做距离场：用于「相邻1步 / 附近3步 / 已探明」分级 --- */
    const dist = mapLayout.bfsDistance(allRooms, room.id, 99);

    const rooms = Object.values(allRooms).map(r => {
      const c = layout.cells[r.id] || { x: 0, y: 0, z: 0 };
      const d = dist[r.id];
      const visited = !!p.hasFlag('visited_' + r.id);
      return {
        id: r.id, name: r.name, region: r.region,
        x: c.x, y: c.y, z: c.z,
        exits: Object.keys(r.exits || {}),
        current: r.id === room.id,
        visited,
        /* 分级：当前 / 相邻(1步) / 已知(去过) / 附近(可达<=4步) / 未知 */
        near: d === 1,
        reach: d != null && d <= 4,
        dist: d == null ? -1 : d,
      };
    });

    const regions = Object.values(w.data.regions).map(r => {
      const inRegion = rooms.filter(x => x.region === r.id);
      return {
        id: r.id, name: r.name, color: r.color, desc: r.desc,
        count: inRegion.length,
        visitedCount: inRegion.filter(x => x.visited).length,
        hasCurrent: inRegion.some(x => x.current),
        rooms: inRegion,
      };
    });

    return {
      region: region ? { id: region.id, name: region.name, desc: region.desc, color: region.color } : null,
      rooms, current: p.room, regions,
      cells: layout.cells,
      regionBoxes: layout.regionBoxes || {},
      bounds: layout.bounds,
      explore: { visited: visitedCount, total: Object.keys(allRooms).length },
    };
  }

  combatView() {
    const b = this.world.battle;
    if (!b) return null;
    const p = this.world.player;
    const enemies = [].concat(b.defenders).map(e => ({
      id: e.id, name: e.name, title: e.title, level: e.level, hp: e.hp, maxHp: e.maxHp,
      mp: e.mp, maxMp: e.maxMp, buffs: e.buffs.map(x => ({ name: x.name, turns: x.turns })),
    })).filter(e => e.hp > 0);
    const usableSkills = Object.keys(p.learned).map(id => {
      const sd = this.world.getSkill(id);
      return sd ? { id, name: sd.name, mpCost: sd.mpCost || 0, type: sd.type } : null;
    }).filter(Boolean);
    return { enemies, turn: b.turn, usableSkills, usableItems: this.inventoryList().filter(i => i.usable) };
  }

  /* ------------------------------------------------------------------ *
   * 指令执行
   * ------------------------------------------------------------------ */
  exec(input, opts) {
    const w = this.world, p = w.player;
    if (!p) return { lines: [{ kind: 'warn', text: '请先创建角色。' }], view: this.view() };
    const ctx = { player: p, world: w, engine: this };
    const before = p.room;
    /* 中文口语归一化：「往北走」→「n」、「查看背包」→「i」 */
    const norm = normalizeCmd(input);
    this.markTutorial(input, norm);
    const res = this.cmds.execute(norm, ctx);
    const lines = res.lines || [];
    // 后处理
    w.advanceTime(1);
    this.postProcess(lines, before, opts);
    const out = { lines, ...res };
    out.view = this.view();
    return out;
  }

  /* 新手引导：把玩家执行过的指令翻译成引导标记 */
  markTutorial(input, norm) {
    const p = this.world.player;
    if (!p) return;
    if (!p.tutorialFlags) p.tutorialFlags = [];
    const raw = String(input || '').trim();
    const first = String(norm || '').trim().split(/\s+/)[0] || '';
    const flag = tutorial.flagForCommand(first) || tutorial.flagForCommand(raw);
    if (flag && p.tutorialFlags.indexOf(flag) < 0) {
      p.tutorialFlags.push(flag);
      p.setFlag('tut_' + flag, true);
    }
  }

  postProcess(lines, beforeRoom, opts) {
    const w = this.world, p = w.player;
    if (!p) return;
    // 房间访问记录
    if (!p.hasFlag('visited_' + p.room)) { p.setFlag('visited_' + p.room, true); }
    // 任务计数：击杀 / 物品 / 房间
    const c = this.cmds;
    const merged = lines || [];
    // 击杀计数
    const killLines = merged.filter(l => l.text && l.text.includes('气绝'));
    // 击杀在 world.onNpcKilled 里已经发事件，这里补一次
    // 房间类
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd || !qd.stages || !qd.stages[st]) continue;
      for (const t of (qd.stages[st].targets || [])) {
        if (t.kind === 'room' && t.key === p.room) {
          const vk = t.var || `q_${qid}_${t.id}`;
          if (!p.getVar(vk)) { p.setVar(vk, 1); }
        }
      }
    }
    // 饥渴致死：advanceTime 掉血到 0，但没走战斗的 playerDeath
    if (p.hp <= 0 && !p.dead && (p.food <= 0 || p.water <= 0)) {
      p.dead = true;
      p.deathCount = (p.deathCount || 0) + 1;
      merged.push({ kind: 'die', text: p.food <= 0 ? '你饿得眼冒金星，一头栽倒在地，人事不省……' : '你渴得喉咙冒烟，眼前一黑，栽倒在地……' });
    }
    // 死亡复活（战斗死 / 饿死 / 渴死 都落到这里）
    // 青楼卖身者复活回青楼，其余复活到最近客栈
    if (p.dead) {
      p.dead = false;
      const isSold = !!(p.prostitution && p.prostitution.sold);
      const spawn = isSold
        ? (workMod.brothelAnchor(w) || survival.nearestInn(w, p.room) || w.data.meta.startRoom)
        : (survival.nearestInn(w, p.room) || w.data.meta.startRoom);
      const lost = Math.floor(p.money * 0.2);
      w.movePlayerTo(p, spawn);
      p.hp = Math.floor(p.maxHp * 0.4);
      p.mp = Math.floor(p.maxMp * 0.4);
      p.food = Math.max(p.food, Math.floor(p.maxFood * 0.6));
      p.water = Math.max(p.water, Math.floor(p.maxWater * 0.6));
      p.buffs = [];
      p.recalc();
      const spawnName = (w.getRoom(spawn) || {}).name || '客栈';
      merged.push({ kind: 'die', text: `你悠悠醒转，发现自己躺在${spawnName}里，身上少了些银钱……` });
      merged.push({ kind: 'sys', text: `你损失了 ${lost} 文钱。` });
    }
    // 支线自动检查
    this.checkQuestAuto(merged);
    // 成就
    this.checkAchievements(merged);
  }

  /** 自动推进「条件型」任务阶段 */
  checkQuestAuto(lines) {
    const w = this.world, p = w.player;
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd || !qd.stages) continue;
      const stage = qd.stages[st];
      if (!stage) continue;
      // 条件齐备 → 提示可复命（不自动完成，需要去找 NPC 交任务）
      if (stage.targets && stage.targets.length) {
        let all = true;
        for (const t of stage.targets) {
          const vk = t.var || `q_${qid}_${t.id}`;
          let cur = t.kind === 'item' ? p.countItem(t.key) : (p.getVar(vk) || 0);
          if (cur < (t.count || 1)) { all = false; break; }
        }
        if (all && !p.hasFlag('questready_' + qid + '_' + st)) {
          p.setFlag('questready_' + qid + '_' + st, true);
          lines.push({ kind: 'quest', text: `【任务】${qd.name}：目标已达成，去找委托人复命吧。` });
        }
      }
    }
  }

  checkAchievements(lines) {
    const w = this.world, p = w.player;
    if (!p.vars._achInit) {
      // 首次游玩时把"不可能达成"的条件标为已检查，避免开局狂刷成就
      p.vars._achInit = true;
    }
    const got = p.vars._achievements || {};
    // 记录击杀过的最强敌人（供 defeatLegend 用）
    for (const aid of Object.keys(w.data.achievements || {})) {
      const a = w.data.achievements[aid];
      if (got[aid]) continue;
      if (a.cond && (a.cond.fn === 'anySkill500' || a.cond.fn === 'visited50') && !(p.kills > 0)) continue;
      if (evalCond(a.cond, { player: p, world: w })) {
        got[aid] = true;
        p.setVar('_achievements', got);
        lines.push({ kind: 'achieve', text: `🏆 成就达成：${a.name} — ${a.desc}` });
      }
    }
  }

  /** 处理 UI 菜单点击 */
  menuPick(opt) {
    const w = this.world, p = w.player;
    if (!opt || !opt.effects) return { lines: [], view: this.view() };
    const ctx = { player: p, world: w, engine: this };
    const lines = evalEffects(opt.effects, ctx);
    if (opt.goto) {
      // 对话树跳转：把 goto 结果交给前端再请求
      lines.push({ kind: 'goto', text: opt.goto });
    }
    w.advanceTime(1);
    this.postProcess(lines, p.room);
    return { lines, view: this.view() };
  }

  /* ------------------------------------------------------------------ *
   * 战斗
   * ------------------------------------------------------------------ */
  combatAction(action, payload) {
    const w = this.world, p = w.player;
    if (!w.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }], view: this.view() };
    let r;
    if (action === 'flee') r = w.combatStep('flee');
    else if (action === 'skill') r = w.combatStep({ type: 'skill', skill: payload.skill });
    else if (action === 'item') r = w.combatStep({ type: 'item', uid: payload.uid });
    else r = w.combatStep();
    const lines = r ? r.lines : [];
    this.postProcess(lines, p.room);
    return { lines, view: this.view() };
  }

  /* ------------------------------------------------------------------ *
   * 存读档
   * ------------------------------------------------------------------ */
  listSaves() {
    const out = [];
    if (!fs.existsSync(this.saveDir)) return out;
    for (const f of fs.readdirSync(this.saveDir).filter(x => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.saveDir, f), 'utf8'));
        out.push({ id: f.replace(/\.json$/, ''), name: j.player ? j.player.name : '?', level: j.player ? j.player.level : 1,
          savedAt: j.savedAt, time: j.clockMinutes, room: j.player ? j.player.room : '', mods: (j.mods || []).length });
      } catch (e) { /* ignore */ }
    }
    return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  save(id) {
    const w = this.world;
    if (!w.player) return { ok: false, msg: '没有可保存的存档。' };
    const sid = id || ('save_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    const data = w.serialize();
    // 额外记录任务 / 成就状态
    fs.writeFileSync(path.join(this.saveDir, sid + '.json'), JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, id: sid, msg: `已保存到存档「${sid}」。`, data };
  }

  readSave(id) {
    const fp = path.join(this.saveDir, id + '.json');
    if (!fs.existsSync(fp)) return null;
    try { return JSON.parse(fs.readFileSync(fp, 'utf8')); } catch (e) { return null; }
  }

  /** 直接落一份存档正文到本地（云存档 → 本地，不改变当前内存状态） */
  writeSave(id, data) {
    try {
      if (!id) return { ok: false, msg: '存档 id 不能为空。' };
      if (!fs.existsSync(this.saveDir)) fs.mkdirSync(this.saveDir, { recursive: true });
      fs.writeFileSync(path.join(this.saveDir, String(id) + '.json'), JSON.stringify(data, null, 2), 'utf8');
      return { ok: true, id: id, msg: `已写入本地存档「${id}」。` };
    } catch (e) {
      return { ok: false, msg: '写入存档失败：' + e.message };
    }
  }

  loadSave(id) {
    const s = this.readSave(id);
    if (!s) return { ok: false, msg: '存档不存在。' };
    this.world.deserialize(s, this.modLoader.getEnabledModList());
    registerBuiltinFns(this.world);
    this.cmds = buildCommands(this.world);
    return { ok: true, msg: '读档成功。', view: this.view() };
  }

  deleteSave(id) {
    const fp = path.join(this.saveDir, id + '.json');
    try { fs.unlinkSync(fp); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; }
  }

  /* ------------------------------------------------------------------ *
   * Mod 管理
   * ------------------------------------------------------------------ */
  modList() { return this.modLoader.mods; }
  modSetEnabled(id, on) { const r = this.modLoader.setEnabled(id, on); this.reload(); return r; }
  modSetOrder(ids) { const r = this.modLoader.setOrder(ids); this.reload(); return r; }
  modMove(id, dir) { const r = this.modLoader.move(id, dir); this.reload(); return r; }
  modRemove(id, hard) { const r = this.modLoader.remove(id, hard); this.reload(); return r; }
  modInstallZip(zipPath, opts) {
    const r = this.modLoader.installFromZip(zipPath, opts);
    if (r.ok) this.reload();
    return r;
  }
  modInstallFolder(dir, opts) {
    const r = this.modLoader.installFromFolder(dir, opts);
    if (r.ok) this.reload();
    return r;
  }
  modExportZip(id, outPath) {
    const r = this.modLoader.exportToZip(id, outPath);
    return r;
  }
  modValidate(dir) { return this.modLoader.validateModDir(dir); }
  modProblems() { return this.modLoader.resolveLoadOrder().problems; }

  /**
   * 统一安装入口（供 UI / 网站代理调用）
   * opts: { kind: 'json'|'zip'|'folder', id, json, base64, files }
   */
  modInstall(opts) {
    opts = opts || {};
    const kind = opts.kind || (opts.base64 ? 'zip' : (opts.files ? 'folder' : 'json'));

    if (kind === 'json') {
      if (!opts.json) return { ok: false, msg: '缺少 mod.json 内容' };
      let obj;
      try { obj = typeof opts.json === 'string' ? JSON.parse(opts.json) : opts.json; }
      catch (e) { return { ok: false, msg: 'mod.json 解析失败：' + e.message }; }
      const id = (obj.id || opts.id || '').trim();
      if (!id) return { ok: false, msg: 'mod.json 缺少 id 字段' };
      const dir = path.join(this.modsDir, id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify(obj, null, 2), 'utf8');
      this.modLoader.scan();
      this.modLoader.setEnabled(id, true);
      this.reload();
      return { ok: true, id, mod: { id, name: obj.name || id } };
    }

    if (kind === 'zip') {
      const b64 = opts.base64;
      if (!b64) return { ok: false, msg: '缺少 ZIP 内容' };
      const tmp = path.join(this.saveDir, '_inst_' + Date.now().toString(36) + '.zip');
      try {
        fs.writeFileSync(tmp, Buffer.from(b64, 'base64'));
      } catch (e) { return { ok: false, msg: '写入临时文件失败：' + e.message }; }
      const r = this.modLoader.installFromZip(tmp, { enable: true, overwrite: true });
      try { fs.unlinkSync(tmp); } catch (e) { }
      if (r && r.ok) {
        this.reload();
        return { ok: true, id: r.id, mod: r.mod };
      }
      return { ok: false, msg: (r && r.msg) || 'ZIP 安装失败' };
    }

    if (kind === 'folder') {
      if (!Array.isArray(opts.files) || !opts.files.length) return { ok: false, msg: '缺少文件列表' };
      /* 写到临时目录再走 installFromFolder */
      const tmpDir = path.join(this.saveDir, '_inst_' + Date.now().toString(36));
      fs.mkdirSync(tmpDir, { recursive: true });
      for (const f of opts.files) {
        const rel = String(f.path || f.name || '').replace(/^\/+/, '');
        if (!rel || rel.indexOf('..') >= 0) continue;
        const fp = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, Buffer.from(f.base64 || '', 'base64'));
      }
      const r = this.modLoader.installFromFolder(tmpDir, { enable: true, overwrite: true });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
      if (r && r.ok) {
        this.reload();
        return { ok: true, id: r.id, mod: r.mod };
      }
      return { ok: false, msg: (r && r.msg) || '文件夹安装失败' };
    }

    return { ok: false, msg: '未知安装类型：' + kind };
  }

  /**
   * 安装「本地私有 Mod」——来自浏览器授权的本地文件夹。
   *
   * 与 modInstall 的区别：
   *   · 落在 mods/_local/<id>/ 下的独立命名空间，不和市场下载的 Mod 混在一起
   *   · mod.json 里打上 __local: true，前端可以据此显示「本地」标签
   *   · 永远不会被「导出 / 上传到 Mod 站」带走（modExportZip 会跳过 __local）
   *
   * opts: { json | base64 | files, id }
   */
  modInstallLocal(opts) {
    opts = opts || {};
    const kind = opts.kind || (opts.base64 ? 'zip' : (opts.files ? 'folder' : 'json'));
    const LOCAL_NS = '_local';

    if (kind === 'json') {
      if (!opts.json) return { ok: false, msg: '缺少 mod.json 内容' };
      let obj;
      try { obj = typeof opts.json === 'string' ? JSON.parse(opts.json) : opts.json; }
      catch (e) { return { ok: false, msg: 'mod.json 解析失败：' + e.message }; }
      const id = String(obj.id || opts.id || '').trim();
      if (!id) return { ok: false, msg: 'mod.json 缺少 id 字段' };
      obj.__local = true;
      obj.__localSource = 'browser-folder';
      const dir = path.join(this.modsDir, LOCAL_NS, id);
      try {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'mod.json'), JSON.stringify(obj, null, 2), 'utf8');
      } catch (e) { return { ok: false, msg: '写入失败：' + e.message }; }
      this.modLoader.scan();
      this.modLoader.setEnabled(id, true);
      this.reload();
      return { ok: true, id, local: true, mod: { id, name: obj.name || id } };
    }

    if (kind === 'zip') {
      if (!opts.base64) return { ok: false, msg: '缺少 ZIP 内容' };
      const tmp = path.join(this.saveDir, '_local_' + Date.now().toString(36) + '.zip');
      try { fs.writeFileSync(tmp, Buffer.from(opts.base64, 'base64')); }
      catch (e) { return { ok: false, msg: '写入临时文件失败：' + e.message }; }
      /* 先解到临时目录，给 mod.json 打标记，再落到 _local 命名空间 */
      const r = this.modLoader.installFromZip(tmp, {
        enable: true, overwrite: true, namespace: LOCAL_NS, markLocal: true
      });
      try { fs.unlinkSync(tmp); } catch (e) { }
      if (r && r.ok) { this.reload(); return { ok: true, id: r.id, local: true, mod: r.mod }; }
      return { ok: false, msg: (r && r.msg) || 'ZIP 安装失败' };
    }

    if (kind === 'folder') {
      if (!Array.isArray(opts.files) || !opts.files.length) return { ok: false, msg: '缺少文件列表' };
      const tmpDir = path.join(this.saveDir, '_local_' + Date.now().toString(36));
      fs.mkdirSync(tmpDir, { recursive: true });
      for (const f of opts.files) {
        const rel = String(f.path || f.name || '').replace(/^\/+/, '');
        if (!rel || rel.indexOf('..') >= 0) continue;
        const fp = path.join(tmpDir, rel);
        fs.mkdirSync(path.dirname(fp), { recursive: true });
        fs.writeFileSync(fp, Buffer.from(f.base64 || '', 'base64'));
      }
      const r = this.modLoader.installFromFolder(tmpDir, {
        enable: true, overwrite: true, namespace: LOCAL_NS, markLocal: true
      });
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) { }
      if (r && r.ok) { this.reload(); return { ok: true, id: r.id, local: true, mod: r.mod }; }
      return { ok: false, msg: (r && r.msg) || '文件夹安装失败' };
    }

    return { ok: false, msg: '未知安装类型：' + kind };
  }

  /** 列出某个 mod 目录下的文件 */
  modFiles(id) {
    const dir = path.join(this.modsDir, id);
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const walk = (d, prefix) => {
      for (const name of fs.readdirSync(d)) {
        const fp = path.join(d, name);
        const rel = prefix ? (prefix + '/' + name) : name;
        try {
          const st = fs.statSync(fp);
          if (st.isDirectory()) walk(fp, rel);
          else out.push({ path: rel, size: st.size });
        } catch (e) { }
      }
    };
    walk(dir, '');
    return out;
  }

  /** 读一个 mod 文件（fname 为空时返回文件列表） */
  modRead(id, fname) {
    if (!id) return { ok: false, msg: '缺少 mod id' };
    if (!fname) return { ok: true, id, files: this.modFiles(id).map(f => f.path) };
    const fp = path.join(this.modsDir, id, fname);
    const dir = path.join(this.modsDir, id);
    /* 安全：禁止穿越 */
    if (!path.normalize(fp).startsWith(path.normalize(dir))) return { ok: false, msg: '非法路径' };
    if (!fs.existsSync(fp)) return { ok: false, msg: '文件不存在：' + fname };
    try { return { ok: true, id, file: fname, content: fs.readFileSync(fp, 'utf8') }; }
    catch (e) { return { ok: false, msg: e.message }; }
  }

  /** 写一个 mod 文件 */
  modWrite(id, fname, content) {
    if (!id || !fname) return { ok: false, msg: '缺少参数' };
    const dir = path.join(this.modsDir, id);
    const fp = path.join(dir, fname);
    if (!path.normalize(fp).startsWith(path.normalize(dir))) return { ok: false, msg: '非法路径' };
    try {
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, content, 'utf8');
      if (fname === 'mod.json') { this.modLoader.scan(); this.reload(); }
      return { ok: true, id, file: fname };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  /** mod 制作器保存（spec -> mod.json） */
  editorSave(spec, id) {
    const nspec = this.normalizeSpec(spec);
    const files = this.buildModFiles(nspec);
    const mid = nspec.meta.id || id;
    if (!mid) return { ok: false, msg: 'Mod 缺少 id' };
    const r = this.writeMod(mid, files);
    return Object.assign({ ok: true, id: mid }, r);
  }

  /** mod 制作器导出 ZIP */
  editorExport(spec, id) {
    const nspec = this.normalizeSpec(spec);
    const files = this.buildModFiles(nspec);
    const mid = nspec.meta.id || id;
    if (!mid) return { ok: false, msg: 'Mod 缺少 id' };
    this.writeMod(mid, files);
    const outPath = path.join(this.saveDir, mid + '.zip');
    const r = this.modLoader.exportToZip(mid, outPath);
    if (!r || !r.ok) return { ok: false, msg: (r && r.msg) || '打包失败' };
    try {
      const buf = fs.readFileSync(outPath);
      return { ok: true, id: mid, base64: buf.toString('base64'), path: outPath };
    } catch (e) { return { ok: false, msg: e.message }; }
  }

  /** mod 制作器：直接写入一个 mod 目录 */
  writeMod(modId, files) {
    const dir = path.join(this.modsDir, modId);
    fs.mkdirSync(dir, { recursive: true });
    for (const fname of Object.keys(files)) {
      const fp = path.join(dir, fname);
      fs.writeFileSync(fp, typeof files[fname] === 'string' ? files[fname] : JSON.stringify(files[fname], null, 2), 'utf8');
    }
    this.modLoader.scan();
    this.reload();
    return { ok: true, dir, id: modId };
  }

  readModFile(modId, fname) {
    const dir = path.join(this.modsDir, modId);
    const fp = path.join(dir, fname);
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf8');
  }

  deleteModFile(modId, fname) {
    const fp = path.join(this.modsDir, modId, fname);
    try { fs.unlinkSync(fp); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; }
  }

  /* ------------------------------------------------------------------ *
   * 编辑器元数据（给 Mod 制作器用）
   * ------------------------------------------------------------------ */
  editorMeta() {
    const w = this.world;
    const idName = (obj) => Object.keys(obj).map(k => ({ id: k, name: obj[k].name || k }));
    return {
      attrs: Object.keys(w.data.attrs),
      skillTypes: ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'],
      itemTypes: ['weapon', 'armor', 'helmet', 'boots', 'gloves', 'necklace', 'ring', 'cloak', 'shield', 'accessory', 'consumable', 'food', 'herb', 'material', 'book', 'quest', 'misc'],
      slots: ['头部', '颈部', '身体', '披风', '手部', '脚部', '武器', '副手', '戒指', '饰品'],
      stats: ['atk', 'def', 'dodge', 'parry', 'speed', 'maxHp', 'maxMp', 'critRate', 'lifesteal', 'reflect', 'armorPen'],
      effectTypes: [
        'say', 'me', 'narrate', 'log', 'hint', 'warn',
        '+money', '-money', '+exp', '-exp', '+pot', '-pot', '+hp', '-hp', '+mp', '-mp', 'heal', 'fullheal', '+karma',
        '+item', '-item', 'randomitem', '+rep', '-rep',
        '+skill', 'learnskill', 'learn', 'forgetskill', '+attr', '-attr', '+perk', '+trait', '+title',
        'goto', 'teleport', 'spawn', 'despawn',
        'quest', 'questdone', 'flag', 'unflag', 'var', 'incvar', 'decvar',
        'combat', 'die', 'menu', 'dialog', 'ending', 'sound', 'sleep',
        'joinSect', 'leaveSect', 'promote', 'fn'
      ],
      condKeys: ['flag', 'notFlag', 'var', 'level', 'money', 'exp', 'pot', 'hp', 'mp', 'karma', 'kills', 'age', 'attr', 'skill', 'skills', 'item', 'noItem', 'count', 'gender', 'race', 'sect', 'sectNot', 'noSect', 'hasSect', 'rank', 'title', 'hasPerk', 'hasTrait', 'room', 'region', 'time', 'season', 'weather', 'quest', 'stage', 'questDone', 'chance', 'rep', 'and', 'or', 'not', 'always', 'fn'],
      categories: ['剧情', '地图', '功能', '功法', '物品', '门派', '任务', '综合', '美化'],
      regions: idName(w.data.regions),
      rooms: Object.keys(w.data.rooms).map(k => ({ id: k, name: w.data.rooms[k].name, region: w.data.rooms[k].region })),
      skills: idName(w.data.skills),
      items: idName(w.data.items),
      sects: idName(w.data.sects),
      npcs: idName(w.data.npcs),
      /* 天赋要带完整描述 + 属性加成 + 效果，否则创建角色界面里「各天赋有什么作用」是空的 */
      traits: Object.keys(w.data.traits).map(k => {
        const t = w.data.traits[k] || {};
        return { id: k, name: t.name || k, desc: t.desc || '', attr: t.attr || null, effects: t.effects || [] };
      }),
      effects: Object.keys(w.data.events || {}),
      statCN: { atk: '攻击', def: '防御', dodge: '闪避', parry: '招架', speed: '速度', maxHp: '气血', maxMp: '内力', critRate: '暴击率', lifesteal: '吸血', reflect: '反伤', armorPen: '破防' },
      itemTypeCN: { weapon: '武器', armor: '防具', helmet: '头饰', boots: '鞋履', gloves: '手套', necklace: '颈饰', ring: '戒指', cloak: '披风', shield: '副手', accessory: '饰品', consumable: '丹药', food: '食物', herb: '药材', material: '材料', book: '书籍', quest: '任务物品', misc: '杂物' },
    };
  }

  /** 供 mod 制作器：把表单数据编译成 mod 文件集 */
  /* ------------------------------------------------------------------ *
   *  Mod 制作器：spec 归一化
   * ------------------------------------------------------------------ */
  /**
   * 把「扁平 spec」（前端表单用的结构：id/name 在顶层，items 是数组）
   * 归一化成 buildModFiles 期望的 {meta:{...}, stories:[...], rooms:[...]} 结构。
   * 两种结构都能吃。
   */
  normalizeSpec(spec) {
    if (!spec || typeof spec !== 'object') return { meta: {} };
    /* 已经是 meta 结构就直接返回（但补齐 meta 字段） */
    const metaSrc = spec.meta || spec;
    const meta = {
      id: metaSrc.id || '',
      name: metaSrc.name || '',
      version: metaSrc.version || '1.0.0',
      author: metaSrc.author || '匿名侠客',
      description: metaSrc.description || metaSrc.desc || '',
      category: metaSrc.category || '综合',
      tags: metaSrc.tags || [],
      dependencies: metaSrc.dependencies || metaSrc.requires || [],
      conflicts: metaSrc.conflicts || [],
      priority: metaSrc.priority || 0,
      gameVersion: metaSrc.gameVersion || '1.0.0',
    };

    const arr = (k) => (Array.isArray(spec[k]) ? spec[k] : []);

    const out = {
      meta,
      rooms: arr('rooms'),
      regions: arr('regions'),
      npcs: arr('npcs'),
      items: arr('items'),
      skills: arr('skills'),
      sects: arr('sects'),
      quests: arr('quests'),
      dialogues: arr('dialogues'),
      stories: arr('stories'),
      rules: arr('rules'),
      events: arr('events'),
    };

    /* 兼容「书教武学」的两种写法：teach / use:learn:xxx */
    out.items = out.items.map(it => {
      const o = Object.assign({}, it);
      if (!o.teach && o.use && typeof o.use === 'string' && o.use.indexOf('learn:') === 0) {
        o.teach = o.use.slice('learn:'.length).split(/\s+/)[0];
      }
      return o;
    });

    /* NPC：字符串字段 -> 数组 */
    out.npcs = out.npcs.map(n => {
      const o = Object.assign({}, n);
      const toArr = (v) => (typeof v === 'string' ? v.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean) : (Array.isArray(v) ? v : undefined));
      if (typeof o.teach === 'string') o.teach = toArr(o.teach);
      if (typeof o.loot === 'string') o.loot = toArr(o.loot);
      if (typeof o.talk === 'string') o.talk = o.talk.split('\n').map(x => x.trim()).filter(Boolean);
      if (typeof o.quests === 'string') o.quests = toArr(o.quests);
      return o;
    });

    /* 门派：字符串 -> 数组 */
    out.sects = out.sects.map(s => {
      const o = Object.assign({}, s);
      if (typeof o.skills === 'string') o.skills = o.skills.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
      if (typeof o.ranks === 'string') o.ranks = o.ranks.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
      if (typeof o.entrySkills === 'string') o.entrySkills = o.entrySkills.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
      if (typeof o.entryItems === 'string') o.entryItems = o.entryItems.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean);
      return o;
    });

    /* 任务：rewardsItems / 阶段 kind+key -> targets */
    out.quests = out.quests.map(q => {
      const o = Object.assign({}, q);
      if (o.rewardsItems && !(o.rewards && o.rewards.items)) {
        o.rewards = o.rewards || {};
        o.rewards.items = typeof o.rewardsItems === 'string'
          ? o.rewardsItems.split(/[,，\s]+/).map(x => x.trim()).filter(Boolean)
          : o.rewardsItems;
      }
      delete o.rewardsItems;
      /* 前端 stages 用 {desc, kind, key, count}，引擎 targets 用 [{kind,key,count}] */
      o.stages = (o.stages || []).map(st => {
        const s2 = Object.assign({}, st);
        if (!s2.targets && s2.kind && s2.key) {
          s2.targets = [{ kind: s2.kind, key: s2.key, count: s2.count != null ? s2.count : 1, desc: s2.desc }];
        }
        return s2;
      });
      return o;
    });

    return out;
  }

  buildModFiles(spec) {
    const meta = (spec.meta) || {};
    const files = {};
    const manifest = {
      _mod: {
        id: meta.id, name: meta.name, version: meta.version || '1.0.0',
        author: meta.author || '匿名侠客', description: meta.description || '',
        category: meta.category || '综合', tags: meta.tags || [],
        dependencies: meta.dependencies || [], conflicts: meta.conflicts || [],
        arrays: 'replace', priority: meta.priority || 0,
      }
    };
    const bucket = (key) => {
      if (!manifest[key]) manifest[key] = {};
      return manifest[key];
    };
    // 剧情
    for (const s of (spec.stories || [])) {
      const id = s.id || slug(s.name);
      bucket('quests')[id] = {
        id, name: s.name, type: s.type || '剧情', level: s.level || 1,
        desc: s.desc || '', require: s.require || undefined,
        stages: (s.stages || []).map(st => ({
          desc: st.desc || '',
          cond: st.cond && Object.keys(st.cond).length ? st.cond : undefined,
          targets: (st.targets || []).length ? st.targets : undefined,
          effects: (st.effects || []).length ? st.effects : undefined,
          next: st.next,
        })),
        rewards: (s.rewards || []).length ? s.rewards : undefined,
      };
      // 对话
      if (s.dialogue && s.dialogue.nodes) bucket('dialogues')[id + '_dlg'] = Object.assign({ id: id + '_dlg' }, s.dialogue);
    }
    // 地图
    for (const r of (spec.rooms || [])) {
      const id = r.id || slug(r.name);
      const exits = {};
      for (const d of Object.keys(r.exits || {})) if (r.exits[d]) exits[d] = r.exits[d];
      bucket('rooms')[id] = {
        id, name: r.name, region: r.region || 'wild', desc: r.desc || '',
        exits: Object.keys(exits).length ? exits : undefined,
        onEnter: r.onEnter && r.onEnter.length ? r.onEnter : undefined,
        actions: r.actions && r.actions.length ? r.actions : undefined,
        encounter: r.encounter || undefined,
        respawn: r.respawn && r.respawn.length ? r.respawn : undefined,
      };
    }
    for (const g of (spec.regions || [])) {
      const id = g.id || slug(g.name);
      bucket('regions')[id] = { id, name: g.name, desc: g.desc || '', color: g.color || '#7a7a6a' };
    }
    // 功法
    for (const s of (spec.skills || [])) {
      const id = s.id || slug(s.name);
      bucket('skills')[id] = {
        id, name: s.name, type: s.type || '剑', maxLevel: s.maxLevel || 500,
        difficulty: s.difficulty || 1.2, desc: s.desc || '',
        damageMult: s.damageMult || 1.2, accuracy: s.accuracy || 90, mpCost: s.mpCost || 0,
        trainCost: s.trainCost || 150, bonus: s.bonus && Object.keys(s.bonus).length ? s.bonus : undefined,
        require: s.require && Object.keys(s.require).length ? s.require : undefined,
        effects: (s.effects || []).length ? s.effects : undefined,
      };
    }
    // 物品
    for (const it of (spec.items || [])) {
      const id = it.id || slug(it.name);
      bucket('items')[id] = {
        id, name: it.name, type: it.type || 'weapon', slot: it.slot || undefined,
        desc: it.desc || '', value: it.value || 10,
        stats: it.stats && Object.keys(it.stats).length ? it.stats : undefined,
        attr: it.attr && Object.keys(it.attr).length ? it.attr : undefined,
        healHp: it.healHp || undefined, healMp: it.healMp || undefined,
        teach: it.teach || undefined, use: (it.use || []).length ? it.use : undefined,
        require: it.require && Object.keys(it.require).length ? it.require : undefined,
        stackable: it.stackable || undefined, maxDurability: it.maxDurability || undefined,
      };
    }
    // NPC
    for (const n of (spec.npcs || [])) {
      const id = n.id || slug(n.name);
      bucket('npcs')[id] = {
        id, name: n.name, title: n.title || undefined, gender: n.gender || 'male',
        room: n.room || undefined, desc: n.desc || '',
        level: n.level || 5, attr: n.attr && Object.keys(n.attr).length ? n.attr : undefined,
        hp: n.hp || undefined, atk: n.atk || undefined, def: n.def || undefined,
        skills: n.skills && Object.keys(n.skills).length ? n.skills : undefined,
        learned: n.learned && Object.keys(n.learned).length ? n.learned : undefined,
        hostile: !!n.hostile, teach: (n.teach || []).length ? n.teach : undefined,
        quests: (n.quests || []).length ? n.quests : undefined,
        talk: (n.talk || []).length ? n.talk : undefined,
        ask: (n.ask || []).length ? n.ask : undefined,
        shop: n.shop || undefined,
        loot: (n.loot || []).length ? n.loot : undefined,
        expReward: n.expReward || undefined, potReward: n.potReward || undefined,
        moneyReward: n.moneyReward || undefined,
        acceptItems: n.acceptItems || undefined,
        onGift: (n.onGift || []).length ? n.onGift : undefined,
        actions: (n.actions || []).length ? n.actions : undefined,
        dialogTree: n.dialogTree || undefined,
      };
    }
    // 门派
    for (const s of (spec.sects || [])) {
      const id = s.id || slug(s.name);
      bucket('sects')[id] = {
        id, name: s.name, align: s.align || '中立', region: s.region,
        desc: s.desc || '', ranks: s.ranks || ['弟子', '长老', '掌门'],
        rankCost: s.rankCost || 300, skills: s.skills || [],
        entryItems: s.entryItems || [], entrySkills: s.entrySkills || [],
        require: s.require && Object.keys(s.require).length ? s.require : undefined,
      };
    }
    // 商店
    for (const sp of (spec.shops || [])) {
      const id = sp.id || slug(sp.name);
      bucket('shops')[id] = { id, name: sp.name, goods: sp.goods || [] };
    }
    // 功能 mod：全局事件 / 自定义条件效果
    if (spec.functions && Object.keys(spec.functions).length) {
      manifest.functions = spec.functions;
    }
    if (spec.events && Object.keys(spec.events).length) {
      manifest.events = spec.events;
    }
    // 自定义 UI 扩展
    if (spec.ui) manifest.ui = spec.ui;

    files['mod.json'] = manifest;
    if (spec.readme) files['README.md'] = spec.readme;
    return { files, manifest };
  }

  /** mod 制作器的校验：把 spec 编译后做静态检查 */
  validateSpec(specRaw) {
    const spec = this.normalizeSpec(specRaw);
    const { files } = this.buildModFiles(spec);
    const errors = [], warnings = [], info = {};
    const meta = spec.meta || {};
    if (!meta.id || !/^[\w\u4e00-\u9fa5.-]+$/.test(meta.id)) errors.push('Mod ID 必须填写，且只能包含字母、数字、下划线、点、连字符或中文');
    if (!meta.name) errors.push('请填写 Mod 名称');
    if (!meta.description) warnings.push('建议填写 Mod 简介，网站上会展示');
    const manifest = files['mod.json'];
    // 房间出口校验
    const roomIds = new Set(Object.keys(manifest.rooms || {}));
    const baseRoomIds = new Set(Object.keys(this.world.data.rooms));
    for (const id of roomIds) {
      const r = manifest.rooms[id];
      if (!r.name) errors.push(`房间 ${id} 缺少名称`);
      if (!r.desc) warnings.push(`房间「${r.name}」没有描述，玩家会看到空白`);
      for (const d of Object.keys(r.exits || {})) {
        const to = r.exits[d];
        if (!roomIds.has(to) && !baseRoomIds.has(to)) errors.push(`房间「${r.name}」的出口「${d}」指向不存在的房间 ${to}`);
      }
    }
    // 旧版房间被覆盖时提示
    const overwritten = Object.keys(manifest.rooms || {}).filter(id => baseRoomIds.has(id));
    if (overwritten.length) warnings.push(`以下房间将覆盖游戏原版内容：${overwritten.join('、')}`);
    // 武功
    for (const id of Object.keys(manifest.skills || {})) {
      const s = manifest.skills[id];
      if (!s.name) errors.push(`武学 ${id} 缺少名称`);
      if (!s.type) errors.push(`武学「${s.name}」缺少类型`);
    }
    // 物品
    for (const id of Object.keys(manifest.items || {})) {
      const it = manifest.items[id];
      if (!it.name) errors.push(`物品 ${id} 缺少名称`);
      if (it.type === 'book' && it.teach) {
        const has = manifest.skills && manifest.skills[it.teach];
        const base = this.world.data.skills[it.teach];
        if (!has && !base) warnings.push(`书籍「${it.name}」教授的武学 ${it.teach} 不存在`);
      }
    }
    // NPC
    for (const id of Object.keys(manifest.npcs || {})) {
      const n = manifest.npcs[id];
      if (!n.name) errors.push(`NPC ${id} 缺少名称`);
      if (n.room && !roomIds.has(n.room) && !baseRoomIds.has(n.room)) errors.push(`NPC「${n.name}」所在的房间 ${n.room} 不存在`);
      for (const k of Object.keys(n.skills || {})) {
        const sid = n.skills[k];
        if (sid && !(manifest.skills && manifest.skills[sid]) && !this.world.data.skills[sid]) {
          warnings.push(`NPC「${n.name}」的武学 ${sid} 不存在`);
        }
      }
    }
    // 门派
    for (const id of Object.keys(manifest.sects || {})) {
      const s = manifest.sects[id];
      if (!s.name) errors.push(`门派 ${id} 缺少名称`);
    }
    // 任务
    for (const id of Object.keys(manifest.quests || {})) {
      const q = manifest.quests[id];
      if (!q.name) errors.push(`任务 ${id} 缺少名称`);
      if (!q.stages || !q.stages.length) warnings.push(`任务「${q.name}」没有阶段，玩家无法推进`);
    }
    info.rooms = Object.keys(manifest.rooms || {}).length;
    info.skills = Object.keys(manifest.skills || {}).length;
    info.items = Object.keys(manifest.items || {}).length;
    info.npcs = Object.keys(manifest.npcs || {}).length;
    info.quests = Object.keys(manifest.quests || {}).length;
    info.regions = Object.keys(manifest.regions || {}).length;
    info.sects = Object.keys(manifest.sects || {}).length;
    return { ok: errors.length === 0, errors, warnings, info };
  }
}

function og(v, d) { return v === undefined || v === null || v === '' ? d : v; }
function slug(s) {
  return String(s || 'mod').toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, '_').replace(/^_+|_+$/g, '') || 'item';
}

module.exports = { GameEngine, registerBuiltinFns };
