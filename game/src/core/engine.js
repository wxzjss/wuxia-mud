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
const { buildCommands, cnNum, normalizeAskList, npcKnownPeople } = require('./commands');
const { evalCond, evalEffects, evalTemplate } = require('./modapi');
const { fmtTime, shichen, stars, clamp, fuzzyFind, normalizeCmd } = require('./utils');
const mapLayout = require('./maplayout');
const tutorial = require('./tutorial');
const social = require('./social');

/* 「可与名宿一战」的名单 —— `defeatLegend` 条件就认它。
 *
 * 放在模块级、只此一份，是为了让测试能**读同一个来源**（而不是在测试里再抄一份名单，
 * 那样改一处忘一处，测试就守不住东西了）。
 *
 * ⚠️ 选人铁律：**绝不能放主线 Boss 或主线委托人**。
 *   曾经放过 `mojiao_dongfang`（第四幕 Boss）/ `blood_saber`·`xingxiu_laoxian`（第三幕 Boss）/
 *   `shaolin_fangzheng`（第三幕委托人）/ `nv_huang`（第五幕委托人）—— 后果是
 *   ① 玩家可能**在第一幕就把第四幕的 Boss 打倒**，后面再打一次；
 *   ② 或者反过来**打自己的委托人**（蓝图 §0 专门规避过的缺陷）。
 *   现在这三位（灭绝师太 / 太虚居士 / 神秘老僧）都是**不在任何主线节点上**的成名人物。 */
const LEGEND_IDS = ['emei_miejue', 'taixu_hermit', 'shenni'];
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
/* -------------------------------------------------------------------- *
 * 测试 / 调试存档的命名约定（主人 bug B1）
 *
 * 根因：`saves/` 是玩家存档目录，但工具脚本（`tools/smoke-test.js`、
 * `tools/smoke-act2.js`）跑一次就往里裸写一份存档，于是「测试侠客」
 * 出现在主人的读取存档列表里，且因savedAt 最新而排在**首行**。
 *
 * 修法分两层（缺一层都不够）：
 *   ① 工具脚本改走 `save(id, {_test:true})`，不再写裸文件（B1 的一半）；
 *   ② `listSaves()` 按下面的名单 + `_testMark` 双重过滤（B1 的另一半，
 *      也顺带挡住历史遗留档）。
 * 真实玩家存档既不命中名单、也不带 _testMark，故不会被误伤。
 * -------------------------------------------------------------------- */
const TEST_SAVE_PREFIXES = ['test_', 'smoke_', '_inst_', '_local_', 'tmp_'];
const TEST_SAVE_IDS = new Set(['test_slot']);

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
    return LEGEND_IDS.some(id => p.hasFlag('killed_' + id));
  };
  /* 把名单挂到 world 上，供测试与 mod 读同一个来源（见文件头 LEGEND_IDS 注释） */
  world.legendIds = LEGEND_IDS.slice();
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
  /* ────────────────────────────────────────────────────────────────
   * askTopicsOf —— 「询问」对话框该给玩家看哪些话题
   *
   * 主人报：「点询问我怎么知道应该询问什么？」
   * 根因：ui.js 里 askNpc() 写了 `n.askTopics` 按钮区，
   *      **但后端从来没发过这个字段** → 永远是 undefined →
   *      「询问」只剩一个光秃秃的输入框 + 一句「可写：武学/门派/江湖/任务…」。
   *      而 329 个 NPC 里只有 18 个有 ask 数据，其余 311 个问啥都是
   *      「这个我却不知」——玩家无从下手。
   *
   * 这里按**他实际能答什么**分类给出话题，三档优先级：
   *   ① 他自己写的 ask[].topic            —— 专属话题，一定真能问出东西
   *   ② 画像解锁项（origin/now/want/fear）—— 有 portrait 才有；
   *      trust 不够时会给「你还问不着」的门槛提示，不是死路，值得列出来
   *   ③ 通用话题（身份/来历/近况/传闻/江湖）—— 走 askDefault 或通用应答，
   *      至少不会让人对着空框发呆
   *
   * ⚠️ 宁可少给也不能给错：给一个他一定答不出来的按钮是骗玩家。
   * ⚠️ 顺序即优先级，玩家先看到最可能有戏的。
   * ──────────────────────────────────────────────────────────────── */
  askTopicsOf(n) {
    const def = (n && n.def) || {};
    const out = [];
    const push = (topic, hint) => {
      if (!topic) return;
      if (out.some(o => o.topic === topic)) return;
      out.push(hint ? { topic, hint } : { topic });
    };
    /* ① 专属话题
     * ⚠️ 归一化换成 commands 里的共用函数：`ask` 有**三种**写法
     *   （单条 / 数组 / **映射对象**{"话题":"答案"}），映射对象是数据主流写法。
     *   原来这里只认数组与单条 → 用映射对象写的 NPC 一个专属话题都列不出来
     *   （「询问」面板只剩通用三项，等于功能缩水）。
     *   共用一份还有个好处：`ask` 指令认什么，这里就列什么，不会漂移。 */
    for (const a of normalizeAskList(def.ask)) {
      if (!a) continue;
      push(a.topic || a.label || a.title, a.hint || null);
    }
    /* ② 画像解锁项 */
    if (n && n.portrait) {
      const trust = (n.pstate && n.pstate.trust) || 0;
      const PT = [
        ['origin', '来历', 0], ['now', '近况', 20], ['want', '想头', 50], ['fear', '惧怕', 70],
      ];
      for (const [k, label, need] of PT) {
        if (!n.portrait[k]) continue;
        push(label, trust >= need ? null : `需交情（trust≥${need}）`);
      }
    }
    /* ③ 通用兜底：任何 NPC 都接得住这一轮 */
    for (const g of ['你是谁', '近况', '江湖消息']) push(g, null);
    return out.slice(0, 8);
  }

  /* ────────────────────────────────────────────────────────────────
   * askPeopleOf —— 「询问」面板里那份「他认识的人」名单
   *
   * 主人第四轮：「点『询问』弹出一个页面上面有 NPC 认识的人名字，
   *   点击这些名字按钮 NPC 会说关于它们的事（根据 NPC 背景画像来）」。
   * 名单与后端回答**共用 commands.npcKnownPeople()**（同一份 rel 数据），
   * 不在这里另写一份 —— 两份名单迟早漂移，届时「点得出来但答不上」。
   * ──────────────────────────────────────────────────────────────── */
  askPeopleOf(n) {
    if (!n) return [];
    try {
      return npcKnownPeople(this.world, n).slice(0, 10);
    } catch (e) {
      return [];
    }
  }

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

    /* ⚠️ 必须带上**打倒的人**（knockedOut）——
       npcsIncludingTemplates 走 npcsIn，而 npcsIn 过滤 dead；
       onNpcDown 会把打倒的人同时标 knockedOut + dead，
       结果「你刚打赢、对方还躺在地上」时房间里一个人都没有，
       连「补刀」和「装进麻袋」两个入口都点不到。
       真死的人实例已被 onNpcKilled 删掉，不会混进来。 */
    const downed = w.downedIn(p.room);
    const standing = w.npcsIn(p.room);
    const npcs = w.npcsIncludingTemplates(p.room)
      .concat(downed.filter(d => !standing.some(x => x.id === d.id)))
      .map(n => ({
      id: n.id, defId: n.defId, name: n.name, title: n.title,
      level: n.level, hp: n.hp, maxHp: n.maxHp, hostile: n.hostile,
      /* 被打倒（还没被补刀）→ NPC 菜单里才给「装进麻袋」入口 */
      knockedOut: !!n.knockedOut,
      hasQuest: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) < 0)),
      canReport: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) >= 0 && p.questStage(q) < 99)),
      shop: !!n.shop, canTeach: !!(n.def && n.def.teach),
      /* ---- 社交扩展（第一批）---- */
      favor: n.favor || 0,
      /* 跟随玩家的 NPC（好感过 60 才能邀，奴册面板要显示） */
      following: !!n.followPlayer,
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
      /* ---- 送礼往来（主人要求：送礼面板要显示「已经送多少」）----
         `pstate.gifts` 由 `noteGift()` 记（give / give_money 两处唯一入口），随档保存。
         面板头部显示「已送 N 次 · 已给 X 文」，物品行还能看到「这件送过几次」。 */
      gifts: (n.pstate && n.pstate.gifts) ? {
        count: n.pstate.gifts.count || 0,
        money: n.pstate.gifts.money || 0,
        items: n.pstate.gifts.items || {},
      } : { count: 0, money: 0, items: {} },
      /* 虚拟住宅 house:<npcId> 也算有家（B/C 层私宅不在地图上，靠拜访进去） */
      homeOf: (n.def && n.def.home) || null,
      virtualHome: !!(n.def && String(n.def.home || '').startsWith('house:')),
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
      /* 「询问」按钮给的话题清单 —— 前端 askNpc() 直接渲染成可点按钮。
         少了这个，玩家点「询问」只得到一个空输入框（主人报的问题）。 */
      askTopics: this.askTopicsOf(n),
      /* 「询问」面板里那份「他认识的人」名单（点一下就问那个人） */
      askPeople: this.askPeopleOf(n),
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
        desc: (w._migrateNotice ? w._migrateNotice + '\n' : '') + evalTemplate(room.desc || '', { player: p, world: w }),
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
      intro: tutorial.introFor(p, p.tutorialFlags || []),
      marriage: marriage.summary(w),
      kinship: kinship.summary(w),
      home: homeMod.summary(w),
      martial: this.martialList(),
      kidnap: this.kidnapView(),
      mods: this.modLoader.mods.map(m => ({ id: m.id, name: m.name, version: m.version, author: m.author, enabled: m.enabled, category: m.category, description: m.description, counts: m.counts })),
    };
  }

  /** 掳人 / 奴役 / 护院 的前端数据（奴册面板）
   *  · 面板是 async 且数据来自 api.view(this)（血泪 #26），所以这里要给足渲染需要的字段，
   *    少给一个字段前端就会渲染出「undefined」或干脆空白。
   *  · 名额表要带上「已用 / 上限 / 档名」，不然玩家不知道自己还能买几个。 */
  kidnapView() {
    const w = this.world, p = w.player;
    if (!p) return null;
    const kmod = require('./kidnap');
    const k = kmod.data(w);
    const q = kmod.quotas(w);
    const wt = kmod.wantedTier(k.wanted);
    const bagList = kmod.listBags(w);
    return {
      wanted: k.wanted,
      wantedName: wt.name,
      wantedShort: wt.short,
      wantedDesc: wt.desc,
      reports: k.reports || 0,
      wageDue: k.wageDue || 0,
      /* 名额（唐制按身份给限额） */
      quota: {
        tierName: q.tier.name,
        slaves: q.slaves, usedSlaves: q.usedSlaves,
        guards: q.guards, usedGuards: q.usedGuards,
      },
      /* 麻袋：state = out(没醒) / struggling(醒了在挣) / burst(冲出来了) */
      bags: bagList.map(b => ({
        idx: b.idx, name: b.name, state: b.state,
        minutesIn: b.minutesIn, power: b.power, personality: b.personality,
      })),
      /* 名下的人 */
      slaves: k.slaves.map(s => ({
        name: s.name, obedience: s.obedience, favor: s.favor,
        task: s.task ? (kmod.TASKS[s.task.key] || {}).name || s.task.key : null,
        taskEnds: s.taskEnds || 0,
        minutesLeft: s.taskEnds ? Math.max(0, s.taskEnds - w.clockMinutes) : 0,
        waitingAt: s.waitingAt ? ((w.getRoom(s.waitingAt) || {}).name || s.waitingAt) : null,
        escaped: !!s.escaped,
      })),
      /* 护院 */
      guards: k.guards.map(g => ({
        name: g.name, power: g.power, wage: g.wage, loyalty: g.loyalty,
        supervising: g.supervising || null,
        minutesLeft: g.superviseEnds ? Math.max(0, g.superviseEnds - w.clockMinutes) : 0,
      })),
      /* 黑市在售（买奴用） */
      marketStock: (Array.isArray(w.soldSlaves) ? w.soldSlaves : [])
        .filter(s => s && s.name && s.defId)
        .map(s => ({ name: s.name, to: s.to, keeper: s.keeper, price: s.price })),
      inBrothel: kmod.inBrothel(w),
      inBlackMarket: kmod.inBlackMarket(w),
      /* 家园地牢（关押 / 提审 / 陪练 / 放出）。
         `has` 为假时前端整栏不渲染 —— 没地牢的人不该看见一栏空牢房。 */
      dungeon: (() => {
        const dg = kmod.dungeonOf(w);
        if (!dg.has) return { has: false, level: 0, cap: 0, roomName: null, captives: [] };
        const droom = dg.roomId ? w.getRoom(dg.roomId) : null;
        return {
          has: true, level: dg.level, cap: dg.cap, roomName: droom ? droom.name : null,
          tortureRate: dg.tortureRate, sparExp: dg.sparExp,
          here: !!(droom && p.room === droom.id),
          captives: kmod.captives(w).map(c => ({
            name: c.name,
            obedience: c.obedience || 0,
            favor: c.favor || 0,
            interrogated: c.interrogated || 0,
            hp: Math.max(0, Math.round(c.hp || 0)),
            maxHp: Math.max(1, Math.round(c.maxHp || c.hp || 1)),
            days: Math.floor(Math.max(0, (w.clockMinutes - (c.jailedAt || w.clockMinutes))) / 1440),
            power: c.power || 0,
            hpRatio: clamp(Math.round((c.hp || 0) / Math.max(1, c.maxHp || c.hp || 1) * 100), 0, 100),
          })),
        };
      })(),
      /* 玩家自己被掳：显示赎金与三条出路 */
      debt: k.debt ? {
        ransom: k.debt.ransom, paidOff: k.debt.paidOff || 0,
        days: k.debt.days || 0, by: k.debt.by,
        market: k.debt.market,
      } : null,
      /* 手里有没有袋子（没有袋子时前端该把「掳走」按钮灰掉并给提示） */
      hasSack: p.countItem(kmod.SACK_ID) > 0,
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
      /* 显示名**优先 label**，其次 cmd，再退 keywords / 房间名。
         ⚠️ 别把它改成「优先 cmd」：`cmd` 是内部指令（`list 陈济仁`、`work 打铁`），
            直接显示给玩家毫无意义；`label` 才是人话（「药柜」「炉火」）。
            野外那批只写了 cmd 的 action（`采药`/`打坐`/`参悟`）本来 cmd 就是人话，
            兜底自然显示得对 —— 两种写法都照顾到了。
            （ONCE 这里曾有一条注释说「显示名优先用 cmd」，与代码相反，
              留着会让人照注释改坏，已改正。） */
      const name = a.label || a.cmd || kws[0] || room.name;
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
      /* def 的键名是 UI 契约，保持不变；值取玩家的 defFinal（防御力数值）。
         def 这个名字已被 NPC 模板对象占用，不能当数字读。 */
      attr: p.attr, atk: p.atk, def: p.defFinal, dodge: p.dodge, parry: p.parry, speed: p.speed,
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
        /* 武学重制：功法五大类 + 熟练度分级（前端「武学修为」面板要用） */
        category: sd.category || sd.type || '外功',
        profTier: require('./character').profTierIndex(p.skillLevel(id), (sd.maxLevel || 300)),
        weaponType: sd.weaponType || null,
        damageMult: sd.damageMult != null ? sd.damageMult : null,
      });
    }
    return out.sort((a, b) => String(a.category).localeCompare(String(b.category)) || b.level - a.level);
  }

  /** 武学修为面板数据（武学重制）：奇经八脉 / 修炼诸途 / 师承 / 宗门 */
  martialList() {
    const p = this.world.player, w = this.world;
    if (!p) return null;
    const CR = require('./character');
    const md = p.meridians || {};
    const mnames = CR.MERIDIAN_NAMES || { 任: '任脉', 督: '督脉' };
    const meridians = Object.keys(mnames).map(k => ({
      key: k, name: mnames[k] || (k + '脉'), lv: md[k] || 0, max: CR.MERIDIAN_MAX || 8,
    }));
    const ap = p.attrTotal ? p.attrTotal('资质') : (p.attr['资质'] || 0);
    /* 修炼诸途：每种途径当前可用度 */
    const ways = [
      { key: 'meditate', name: '打坐', desc: '恢复内力；已修内功者还能冲击奇经八脉' },
      { key: 'train', name: '修炼', desc: '消耗内力精进功法（非内功）' },
      { key: 'cuti', name: '淬体', desc: '外功根基：伤气血、耗体力，有生命危险，宜备丹药' },
      { key: 'alchemy', name: '炼丹', desc: '丹房与丹炉齐备，炼回梦丹、理气丹等' },
      { key: 'forge', name: '炼器', desc: '铁锤与精铁在手，锻兵修甲' },
      { key: 'rune', name: '画符阵', desc: '朱砂符纸，画符布增益' },
    ];
    const recipes = (w.data.recipes && Object.values(w.data.recipes)) || [];
    const byCat = {};
    for (const r of recipes) {
      if (!r || !r.category) continue;
      byCat[r.category] = (byCat[r.category] || 0) + 1;
    }
    /* 弟子 */
    const disciples = [];
    for (const id of (p.disciples || [])) {
      const n = w.instances.npcs && w.instances.npcs[id];
      const d = w.data.npcs[id] || {};
      const defId = n ? n.defId : id;
      const dd = w.data.npcs[defId] || d;
      const st = (n && n.pstate) || null;
      disciples.push({
        id, defId, name: (n && n.name) || dd.name || id,
        level: (n && n.level) || dd.level || 1,
        realm: this.realmName(n),
        skillLv: (n && n.learned) ? Math.max.apply(null, Object.keys(n.learned).map(k => n.learned[k].level).concat([0])) : 0,
        trust: st ? (st.trust || 0) : 0,
        favor: n ? Math.round(n.favor || 0) : 0,
      });
    }
    /* 自建宗门 */
    const mySect = p.mySect ? {
      name: p.mySect.name, style: p.mySect.style || '正派',
      prestige: p.mySect.prestige || 0, members: (p.mySect.members || []).length,
      hall: (w.getRoom(p.mySect.hall) || {}).name || p.mySect.hall || null,
    } : null;
    return {
      meridians, aptitude: ap, ways,
      recipes: byCat,
      disciples, mySect,
      maxLevelHint: '上限由资质与根骨决定（资质权重最高）',
    };
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

  /* ============================================================
   * 任务详情预览 —— 「接取任务」要先弹一页详情，玩家看过再决定接不接
   *
   * 主人第四轮：「点击 NPC 页『接他的事』按钮后希望能先弹出任务详情
   * 再选择是否接受任务，把『接他的事』文本改为『接取任务』」。
   *
   * ⚠️ 不能复用 questList：那边只列**进行中**的任务（读 p.quests）。
   *    这里要的是**还没接**的那一桩，得从 w.data.quests 直接读定义。
   * ============================================================ */
  questPreviewOf(qid) {
    const w = this.world, p = w.player;
    const qd = qid && w.getQuest(qid);
    if (!qd) return null;
    const st = (qd.stages && qd.stages[0]) || {};
    const targets = (st.targets || []).map(t => ({
      desc: t.desc || t.id, kind: t.kind || '', count: t.count || 1, cur: 0,
    }));
    /* 委托人：giver 指向 npc 的 defId，取模板名最稳（实例可能不在世上） */
    let giver = '', giverId = qd.giver || '';
    if (giverId) {
      const def = w.data.npcs && w.data.npcs[giverId];
      giver = (def && def.name) || giverId;
    }
    const stageNo = p.questStage(qid);
    return {
      id: qd.id || qid,
      name: qd.name || qid,
      type: qd.type || '',
      level: qd.level || 0,
      giver, giverId,
      desc: qd.desc || '',
      stageDesc: st.desc || '',
      targets,
      rewards: questRewardBrief(qd, w),
      requireText: questRequireText(qd.require, w),
      /* 给前端一锤定音：这一刻到底接不接得下（避免「点了才告诉你不行」） */
      acceptable: !(stageNo >= 0),
      started: stageNo >= 0,
    };
  }

  mapView() {
    const w = this.world, p = w.player;
    const room = w.getRoom(p.room);
    if (!room) return { region: null, rooms: [], current: null };
    const region = w.getRegion(room.region);
    /* ⚠️ 私域（private:true）**不上地图** ——
       design/09 §3.3：B/C 层虚拟宅院是「拜访」才进的副本，不是地图上的格子。
       不过滤的话，玩家一拜访地图上就冒出一格「张家宅」，区域房间数也跟着跳。
       注：`private` 这个标记是 estate/home/sectFounder 早就在用的「玩家房产不上地图」
       语义，拜访私域沿用它，mapView 一并过滤 —— 两边同向，不冲突。
       但**删除**私域只能按 `_privateHost` 判（见 world.leaveHouse 的注释）。 */
    const allRooms = {};
    for (const id of Object.keys(w.data.rooms)) {
      const r = w.data.rooms[id];
      if (r && r.private) continue;
      allRooms[id] = r;
    }

    /* --- 布局：区域装箱，每个区域内部按出口方向排布 --- */
    if (!this._mapLayout || this._mapLayoutFor !== allRooms) {
      this._mapLayout = mapLayout.layoutAll(
        allRooms, w.data.regions, room.id, w.data.terrain || {}
      );
      this._mapLayoutFor = allRooms;
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
      terrain: layout.terrain || {},
      explore: { visited: visitedCount, total: Object.keys(allRooms).length },
    };
  }

  /* ------------------------------------------------------------------ *
   *  NPC 详情画像 —— 前端「细看此人」新界面的数据源
   *
   *  主人要求：点 NPC 弹出互动菜单 → 点「看该 NPC」的按钮 → 弹出**新界面**，
   *  显示这个人各方面的详细信息，**包括人物背景故事**。
   *
   *  ★ 设计取舍（重要，别把它改成「全公开」）：
   *    背景故事不是白给的。项目里早有「信任度（trust）到多少才肯说」的规矩
   *    （commands.js 的询问分支：来历 0 / 近况 20 / 想头 50 / 惧怕 70 /
   *      恩怨 40 / 隐秘 50+tier×5）。本面板**沿用同一套门槛**：
   *    未解锁的条目照样列出来（让玩家知道「这里有东西」），但只给
   *    「信不过你 —— 办成几件事再说」；已解锁的把正文集中呈现，
   *    省得玩家一个个话题去问（这才是面板的价值）。
   *    若把 128 个人的底细摊在桌面，「人情往来」整条线就废了。
   *
   *  ⚠️ 文案一律说**人**不说**数据**：不打印 trust=53 这种数字，
   *     只说「他跟你还算说得上话」。数字留给策划，玩家只该读到人味。
   * ------------------------------------------------------------------ */
  npcProfileOf(idOrNpc) {
    const w = this.world, p = w.player;
    if (!p) return null;
    const find = (list) => (list || []).find(x =>
      x && (x.id === idOrNpc || x.defId === idOrNpc || x.name === idOrNpc));
    let n = (idOrNpc && typeof idOrNpc === 'object') ? idOrNpc
      : (find(w.npcsIn(p.room)) || find(w.downedIn(p.room)) || w.getNpc(idOrNpc));
    if (!n) return null;

    const def = n.def || (w.data.npcs && w.data.npcs[n.defId]) || {};
    const pt = n.portrait || def.portrait || null;
    const ctx = { player: p, world: w };
    const tpl = t => (t == null ? '' : String(evalTemplate(String(t), ctx)));
    const C = require('./commands').__api;
    const trust = (n.pstate && n.pstate.trust) || 0;
    const favor = Math.round(n.favor || 0);
    const pstate = n.pstate || {};
    const here = p.room === n.room;

    /* ---- 性格（有人味的一段，不是枚举值）---- */
    const personalityMod = require('./personality');
    const per = personalityMod.personalityOf(n);

    /* ---- 武学：跟「看人」同一口径（交情浅只报「深不可测」）---- */
    const insight = C.npcInsight(n);
    const slots = [];
    for (const k of Object.keys(n.equippedSkills || {})) {
      const sid = n.equippedSkills[k];
      if (!sid) continue;
      const sd = w.getSkill(sid);
      if (!sd) continue;
      const lv = (n.learned && n.learned[sid] && n.learned[sid].level) || 0;
      slots.push({
        slot: k, id: sid, name: sd.name, category: sd.category || '', level: lv,
        tier: insight.deep ? C.skillTierCN(lv) : '深不可测',
        deep: insight.deep,
      });
    }
    const known = new Set(Object.keys(n.equippedSkills || {}).map(k => n.equippedSkills[k]));
    const more = Object.keys(n.learned || {})
      .filter(sid => sid && !known.has(sid))
      .map(sid => { const sd = w.getSkill(sid); return sd ? sd.name : null; })
      .filter(Boolean);

    /* ---- 装备 / 随身 ---- */
    const equip = [];
    for (const slot of Object.keys(n.equipment || {})) {
      const iid = n.equipment[slot];
      if (!iid) continue;
      const d = w.getItem(iid);
      equip.push({ slot, name: d ? d.name : iid });
    }
    const carry = [];
    const carryDef = n.carry || def.carry || null;
    for (const x of [].concat(((carryDef && carryDef.items) || def.items || []) || [])) {
      const iid = typeof x === 'string' ? x : (x && (x.id || x.itemId));
      if (!iid) continue;
      const d = w.getItem(iid);
      carry.push({ name: d ? d.name : iid, count: (typeof x === 'object' && x.count) || 1 });
    }
    const money = (carryDef && carryDef.money !== undefined) ? carryDef.money : def.money;

    /* ---- 能教你什么 ---- */
    const teach = (n.teach || def.teach || []).map(sid => {
      const sd = w.getSkill(sid);
      const need = def.favorToLearn != null ? def.favorToLearn : (n.favorToLearn != null ? n.favorToLearn : 40);
      return sd ? { id: sid, name: sd.name, need, can: favor >= need } : null;
    }).filter(Boolean);

    /* ---- 作息 ---- */
    const sched = def.schedule || n.schedule || null;
    const schedule = sched ? Object.keys(sched).map(k => ({
      at: k, place: ((w.getRoom(sched[k]) || {}).name || sched[k]),
      cn: ({ day: '白天', night: '夜里', dusk: '黄昏', dawn: '清早' })[k] || k,
    })) : [];

    /* ---- 背景故事：逐条解锁（门槛与「询问」完全一致）---- */
    const NEED = { origin: 0, now: 20, want: 50, fear: 70, obsession: 30 };
    const LABEL = { origin: '来历', now: '近况', want: '想头', fear: '惧怕', obsession: '执念' };
    const story = [];
    for (const key of ['origin', 'now', 'want', 'fear', 'obsession']) {
      if (!pt || !pt[key]) continue;
      const need = NEED[key];
      const unlocked = trust >= need;
      story.push({
        key, label: LABEL[key], need, unlocked,
        text: unlocked ? tpl(pt[key]) : '',
        lockHint: unlocked ? '' : '他还信不过你 —— 替他办成几件事再说。',
      });
    }
    /* 隐秘：门槛随机密大小上抬（50 + tier×5），与询问分支同一公式 */
    if (pt && pt.secret && pt.secret.text) {
      const need = 50 + (pt.secret.tier || 1) * 5;
      const unlocked = trust >= need;
      const knownSecret = !!(pstate.revealed && pstate.revealed.indexOf('secret') >= 0);
      story.push({
        key: 'secret', label: '隐秘',
        /* 已经从他嘴里听过一次的人，面板里就留得住 —— 否则玩家读过就没了 */
        need: knownSecret ? 0 : need, unlocked: unlocked || knownSecret,
        text: (unlocked || knownSecret) ? tpl(pt.secret.text) : '',
        lockHint: '这种事，不是交情够了谁也不肯讲。',
        secret: true,
      });
    }

    /* ---- 恩怨：trust≥40 才说得出「谁跟谁有过节」---- */
    const feudUnlocked = trust >= 40;
    const feuds = ((pt && pt.feuds) || []).map(f => {
      const other = (w.data.npcs && w.data.npcs[f.id]) || {};
      return {
        name: other.name || f.id, kind: f.kind || '旧识',
        why: feudUnlocked ? tpl(f.why) : '', since: f.since || '',
        locked: !feudUnlocked,
      };
    });

    return {
      ok: true,
      id: n.id, defId: n.defId || null, name: n.name,
      title: n.title || def.title || '',
      identity: C.npcIdentity(w, n),
      gender: n.gender || def.gender || 'other',
      age: n.age || def.age || null,
      tag: n.tag || def.tag || '',
      here,
      roomName: here ? '就在此处' : (((w.getRoom(n.room) || {}).name) || '不知去向'),
      home: def.home ? (((w.getRoom(def.home) || {}).name) || null) : null,
      desc: n.desc || def.desc || '',
      role: pt && pt.role ? tpl(pt.role) : '',
      realm: this.realmName(n),
      level: n.level || def.level || 0,
      showLevel: def.showLevel !== false,
      hpLine: (n.hp < n.maxHp)
        ? (n.hp / n.maxHp < 0.3 ? '伤势不轻' : n.hp / n.maxHp < 0.6 ? '身上带伤' : '略有疲态')
        : '看上去气色如常',
      personality: per ? { id: per.id, name: per.name || per.id, desc: per.desc || '' } : null,
      /* 关系：说人话，不甩数字（好感/信任折算成一句话）。
         ⚠️ 第三人称必须过 `pronounOf`（B11 的单一入口）——
         写死「他」会让药婆婆、灭绝师太这些女角色一律被叫「他」。 */
      relation: (() => {
        const TA = require('./pronouns').pronounOf(n);
        return {
          favor, trust,
          favorCN: favor >= 60 ? `${TA}拿你当自己人` : favor >= 25 ? `${TA}待你比旁人亲厚`
            : favor <= -30 ? `${TA}见你就烦` : favor <= -8 ? `${TA}对你有些芥蒂` : `你与${TA}只是点头之交`,
          trustCN: trust >= 70 ? `${TA}心里的事肯跟你讲` : trust >= 40 ? `${TA}信得过你办事`
            : trust >= 20 ? `${TA}大致认得你这个人` : `${TA}还摸不清你的底细`,
          /* 送礼往来（与送礼面板同一个来源 pstate.gifts） */
          gifts: (pstate.gifts ? {
            count: pstate.gifts.count || 0,
            money: pstate.gifts.money || 0,
            items: pstate.gifts.items || {},
          } : { count: 0, money: 0, items: {} }),
        };
      })(),
      equip, carry, money,
      martial: { slots, more, deep: insight.deep, hint: insight.deep ? '' : insight.hint },
      /* ⚠️ 故意**不列** `likes`（他喜欢什么）：那是送礼要试出来的东西，
         列在面板上等于官方攻略，`social.js` 的「合口味」判定就没意义了。 */
      teach, schedule,
      disciples: (n.disciples || []).length,
      feuds, feudUnlocked,
      story,
      voice: (pt && pt.voice) ? { tone: pt.voice.tone || '', catchphrase: tpl(pt.voice.catchphrase || ''), style: tpl(pt.voice.style || '') } : null,
      routine: (pt && pt.routine) ? pt.routine.map(r => ({
        at: ({ day: '白天', night: '夜里', dusk: '黄昏', dawn: '清早' })[r.at] || r.at,
        act: tpl(r.act),
      })) : [],
      arcInit: (pt && pt.arc && pt.arc.init) || '',
      hasPortrait: !!pt,
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
    /* B13 连带收尾：读档迁移提示「只顶在下一屏房间描述前」，玩家一动就撤掉，不长期挂描述上。 */
    if (w._migrateNotice) w._migrateNotice = null;
    /* 中文口语归一化：「往北走」→「n」、「查看背包」→「i」 */
    const norm = normalizeCmd(input);
    this.markTutorial(input, norm);
    /* ★ 通用防线：**一条指令抛异常，不该让整个请求挂掉**。
       第四轮修 `ask`（数据里「话题→答案」映射写法会让 `a.topic.includes` 抛异常）时发现：
       `exec` 原来直接把 `cmds.execute` 的异常冒到上层，服务端 `handleApi` 的 try/catch
       兜成 500 —— 玩家看到的是「网络错误」，排查的人拿到的是「没线索」，
       而这个 bug 在数据里躺了很久没人报（数据里 18 个 NPC 用数组写法没事，
       示例 mod 与新写的 NPC 用映射写法就崩）。
       现在兜住：给玩家一行**明确的回执**（不静默），并把栈打到服务端日志（可排查）。
       ⚠️ 别把回执删成静默 —— 那正是本项目最忌的「不报错就不生效」。 */
    let res;
    try {
      res = this.cmds.execute(norm, ctx);
    } catch (err) {
      try { console.error('[wxmud] 指令异常：', norm, (err && err.stack) || err); } catch (e2) { void e2; }
      res = { lines: [{ kind: 'warn', text: `（「${input}」这道指令出了岔子，已经记下来了。）` }] };
    }
    const lines = res.lines || [];
    // 后处理
    w.advanceTime(1);
    /* 世界动态 W5/W7：把「推进时间时」世界抛出的 storyline 台词排进玩家输出。
       （storyline 产品侧零消费者 —— 以前 onTick / onDayTick 的台词 emit 出去就沉了。） */
    this._drainWorldLines(lines);
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

  /* 新手引导：前端显式上报一个标记（面板类指令不进 exec，只能走这里）
   * 白名单校验：flag 必须是 CMD_FLAGS 的**值**之一，防止前端传脏数据。 */
  markTutorialFlag(flag) {
    const p = this.world.player;
    if (!p || !flag) return false;
    const valid = Object.keys(tutorial.CMD_FLAGS).some(k => tutorial.CMD_FLAGS[k] === flag)
      || tutorial.EXTRA_FLAGS.indexOf(flag) >= 0;
    if (!valid) return false;
    if (!p.tutorialFlags) p.tutorialFlags = [];
    if (p.tutorialFlags.indexOf(flag) >= 0) return true;
    p.tutorialFlags.push(flag);
    p.setFlag('tut_' + flag, true);
    return true;
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
    /* ⚠️ 必须typeof 一下：lines 里不全是 {text: string}——
       modapi 的 'sound'/'wait' 效果会塞非字符串载荷进来，
       直接 l.text.includes(...) 会在玩家点某些房间按钮时整个崩掉
       （TypeError: l.text.includes is not a function）。 */
    const killLines = merged.filter(l => l && typeof l.text === 'string' && l.text.includes('气绝'));
    /* 🩸 这一行以前只算出一个 `killLines` 就没了下文（死变量）——
       后果是 **「击杀 N 个某某」这类任务目标永远不涨**：
       `q_emei_entry`（杀恶徒 10）/ `q_bounty_bandit`（杀山贼 10）/ `q_huashan_entry`（杀山贼 3）/
       `q_huashan_spy`（杀魔教教众 3）/ `q_xianglong`（击败丁春秋）/ `q_huashan_sword_test`（击退来犯之敌 5）
       —— 玩家杀够数也交不了任务（`report` 会因目标未满而拒绝）。
       现在按 world 登记的击杀队列真推进；`killLines` 保留给下面的提示文案用。 */
    const killQueue = (w._killQueue || []).splice(0);
    for (const defId of killQueue) {
      if (!defId) continue;
      const add = c.advanceQuestCounters({ player: p, world: w }, 'kill', defId, 1);
      if (add && add.length) for (const l of add) merged.push(l);
    }
    void killLines;
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
    // 饥渴昏倒：advanceTime 掉血到 0，但没走战斗的 playerDeath
    /* ⚠️ 语义是**昏倒**不是死（主人要求）。这里只置标记；结算与苏醒统一在下面那一处 */
    if (p.hp <= 0 && !p.dead && (p.food <= 0 || p.water <= 0)) {
      p.dead = true;
      p.deathCount = (p.deathCount || 0) + 1;
      merged.push({
        kind: 'faint',
        text: p.food <= 0 ? '你饿得眼冒金星，一头栽倒在地，人事不省……' : '你渴得喉咙冒烟，眼前一黑，栽倒在地……',
      });
    }
    /* 昏倒 → 最近客栈醒转。**唯一入口** `survival.respawnAtInn()`：
       扣钱折功力、搬人、回血、写「醒过来」的台词，全在里面。
       原来这里是一段内联实现，与 survival.respawnAtInn 各写一份（那一份还是死代码），
       且内联这份只算 lost 写台词、根本没扣钱。合并之后只有一份。
       青楼卖身者由 engine 传 anchor（brothelAnchor 在 work 模块，survival 不依赖它）。 */
    if (p.dead) {
      p.dead = false;
      const isSold = !!(p.prostitution && p.prostitution.sold);
      const anchor = isSold ? (workMod.brothelAnchor(w) || null) : null;
      survival.respawnAtInn(w, merged, { anchor });
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
    this._drainWorldLines(lines);
    this.postProcess(lines, p.room);
    return { lines, view: this.view() };
  }

  /** 把推进时间期间世界抛出的 storyline 台词（W5/W7/onTick/worldTick）排进输出。
   *  与 commands.js 返回的 lines 并列，玩家才看得见「世界自己发生的事」。 */
  _drainWorldLines(lines) {
    const w = this.world;
    if (!w || typeof w.drainTickLines !== 'function') return;
    const tick = w.drainTickLines();
    for (const l of tick) {
      if (l && l.text !== undefined && l.text !== '') lines.push(l);
    }
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

  /**
   * 判断一份存档是不是「测试/调试档」，是则**不出现在玩家存档列表里**。
   *
   * 背景（主人 bug B1）：`listSaves()` 原本把 `saves/` 下所有 `.json` 全列出，
   * 无任何过滤，于是 `tools/smoke-test.js` 跑一次留下的 `test_slot.json`
   * （玩家名「测试侠客」）就混进了主人的读取存档列表 —— 而它的 savedAt
   * 还比两个真存档都新，排序在**第一行**，触屏玩家根本无从自查来源。
   *
   * 两条判据（不同严格度，因为可信度不同）：
   *   ① `TEST_SAVE_IDS` 精确名单 —— **按 id 直接挡，不看正文**。
     这些是保留名，玩家存档的 id 一律是 `save_<时间戳>` 格式，绝不会撞上；
     历史遗留档（没有标记的旧 test_slot.json）靠这条挡住。
   *   ② `TEST_SAVE_PREFIXES` 前缀 —— **必须同时**正文带 `_testMark` 才算。
     只看前缀就杀太危险：将来玩家手打一个 `test_xxx` 存档名就会被误删。
     `_testMark` 由 `save(id, {_test:true})` 写入，伪造不了。
   *
   * 真实玩家存档两条都不满足，一定不会被误伤。
   */
  _isTestSave(id, j) {
    if (TEST_SAVE_IDS.has(id)) return true;
    if (!TEST_SAVE_PREFIXES.some(p => id.startsWith(p))) return false;
    return !!(j && j._testMark);
  }

  listSaves() {
    const out = [];
    if (!fs.existsSync(this.saveDir)) return out;
    for (const f of fs.readdirSync(this.saveDir).filter(x => x.endsWith('.json'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(this.saveDir, f), 'utf8'));
        const id = f.replace(/\.json$/, '');
        /* B1：测试/调试档一律不列出。 */
        if (this._isTestSave(id, j)) continue;
        out.push({ id, name: j.player ? j.player.name : '?', level: j.player ? j.player.level : 1,
          savedAt: j.savedAt, time: j.clockMinutes, room: j.player ? j.player.room : '', mods: (j.mods || []).length });
      } catch (e) { /* ignore */ }
    }
    return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
  }

  /**
   * 存一档。传 `_test: true` 会把这一档标记成测试档：
   * ① 正文里写 `_testMark`，② id 强制加 `test_` 前缀，
   * 两条一起保证它**既不会被 listSaves 列出，也不会被玩家误读**。
   * 测试脚本请一律走这条路，不要往真 saves/ 里裸写文件。
   */
  save(id, opts) {
    const w = this.world;
    if (!w.player) return { ok: false, msg: '没有可保存的存档。' };
    opts = opts || {};
    let sid = id || ('save_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    const data = w.serialize();
    if (opts._test) {
      if (!TEST_SAVE_PREFIXES.some(p => sid.startsWith(p))) sid = 'test_' + sid;
      data._testMark = true;
      data.savedBy = 'test';
    }
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
      /* ⚠️ 这两个表 **必须与游戏本体口径一致**：
         `skillTypes` = 武学槽位名（中文），它同时决定「内功打坐冲脉 / 外功淬体」的玩法分叉；
         `skillCategories` = 武学五大类（面板分类）。
         Mod 制作器优先读这里；读不到时的兜底也必须写中文 —— 老兜底写的是英文
         （sword/force/dodge），照着做出来的 mod 武学**装不进任何槽位**。 */
      skillTypes: ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'],
      skillCategories: ['外功', '内功', '奇门', '旁门', '魔功'],
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

    /* ★ 武学字段归一化（**制作器侧**，与运行时 modloader 的归一化同一口径）。
       `skills.type` 就是 `equippedSkills` 的槽位键，写英文（sword/force/dodge）
       会在游戏里装不上任何槽位；`category` 决定武学面板里的五大类。
       在这里就地纠正，玩家导出的 mod.json 从源头就是中文 ——
       而不是等进游戏才由 modloader 兜。
       归一化表只有一份，见 core/modfields.js。 */
    {
      const mf = require('./modfields');
      out.skills = out.skills.map(s => {
        const o = Object.assign({}, s);
        if (o.id) o.id = String(o.id);
        o.type = mf.normSkillType(o.type);
        o.category = mf.normCategory(o.category, o.type);
        if (!o.quality) o.quality = 'common';
        if (o.maxLevel == null || Number(o.maxLevel) <= 0) o.maxLevel = 300;
        return o;
      });
      /* NPC 挂的武学槽位同理（demo_npc 常直接写英文键） */
      out.npcs = out.npcs.map(n => {
        const o = Object.assign({}, n);
        if (o.skills && typeof o.skills === 'object' && !Array.isArray(o.skills)) {
          const sk = {};
          for (const k of Object.keys(o.skills)) sk[mf.normSkillType(k)] = o.skills[k];
          o.skills = sk;
        }
        return o;
      });
    }

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
        id, name: s.name, type: s.type || '剑',
        /* ★ category / quality 必须写出！
           原来这里是**白名单式**只挑字段，没有 category ——
           于是「制作器里填了功法的五大类」导出时被**悄悄丢掉**，
           进游戏后武学面板又把 type 当分类显示（冒出「剑」这种分类）。
           这与 `skills.type` 写英文是同一族的病：填了不生效。 */
        category: s.category || undefined,
        quality: s.quality || undefined,
        maxLevel: s.maxLevel || 300,
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
    /* ⚠️ 武学的 `type` 不只是「分类」，它就是 `equippedSkills` 的**槽位键**：
       写英文（sword/force/dodge）会导致这门武学**装不上任何槽位**，
       玩家 `enable` 时只会得到「没有「sword」这个槽位」。
       这里给提示（不是 error）：因为加载时 `modfields` 会自动纠正，
       但让玩家在**导出前**就看到、直接写对更好。 */
    const SLOTS = ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'];
    const CATS = ['外功', '内功', '奇门', '旁门', '魔功'];
    /* 归一化在 normalizeSpec 里已经跑过，所以 manifest 里看到的永远是对的 ——
       想让「别写英文」这条提示真出现，必须拿**用户原始输入**比一遍。
       （否则提示恒不触发，等于没写。） */
    const mf = require('./modfields');
    const rawSkills = Array.isArray(specRaw && specRaw.skills) ? specRaw.skills : [];
    const rawById = {};
    rawSkills.forEach((s, i) => { if (s) rawById[s.id || ('#' + i)] = s; });
    for (const id of Object.keys(manifest.skills || {})) {
      const s = manifest.skills[id];
      const raw = rawById[id] || null;
      if (!s.name) errors.push(`武学 ${id} 缺少名称`);
      if (!s.type) errors.push(`武学「${s.name}」缺少类型`);
      else if (SLOTS.indexOf(String(s.type)) < 0) {
        warnings.push(`武学「${s.name}」的类型「${s.type}」不是合法槽位（可用：${SLOTS.join('、')}）——`
          + `写英文（sword/force/dodge）这门武学会装不上任何槽位。建议直接改成中文槽位名。`);
      }
      if (raw && raw.type != null && String(raw.type) !== String(s.type)) {
        warnings.push(`武学「${s.name}」的类型原本写的「${raw.type}」，已自动按别名纠正为「${s.type}」；`
          + `建议直接把源文件改成中文槽位名，免得别处（文档、截图、别人抄你的 mod）沿用旧写法。`);
      }
      if (!s.category) {
        warnings.push(`武学「${s.name}」没填分类，武学面板里只能按类型归类（五大类：${CATS.join(' / ')}）。`);
      } else if (CATS.indexOf(String(s.category)) < 0) {
        warnings.push(`武学「${s.name}」的分类「${s.category}」不在五大类里（${CATS.join('、')}），面板会把它单列一类。`);
      }
      if (s.maxLevel != null && Number(s.maxLevel) > 0 && Number(s.maxLevel) < 60) {
        warnings.push(`武学「${s.name}」最高等级只有 ${s.maxLevel} 级，玩家很快就会练满，建议 ≥120。`);
      }
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

/* ------------------------------------------------------------
 * 任务详情预览用的两个小工具（只给 questPreviewOf 用）
 * ------------------------------------------------------------ */

/** 把 rewards 数组压成一句「给什么」——玩家接之前最想知道的东西 */
function questRewardBrief(qd, w) {
  const bits = [];
  const items = [];
  for (const r of (qd.rewards || [])) {
    if (!r || !r.type) continue;
    const a = r.args || [];
    switch (r.type) {
      case '+exp': bits.push('阅历 ' + (a[0] || 0)); break;
      case '+pot': bits.push('潜力 ' + (a[0] || 0)); break;
      case '+money': bits.push((a[0] || 0) + ' 文'); break;
      case '+rep': {
        /* args = [门派id 或 '*', 点数] —— 门派 id 要翻成中文，别把 `huashan` 甩给玩家 */
        const sk = a[0];
        if (sk === '*' || !sk) bits.push('名望 ' + (a[1] || 0));
        else {
          const s = (w.data.sects && w.data.sects[sk]);
          bits.push(((s && s.name) || sk) + '声望 ' + (a[1] || 0));
        }
        break;
      }
      case 'favor': bits.push('好感 ' + (a[1] != null ? a[1] : (a[0] || 0))); break;
      case '+item': {
        /* ⚠️ 武学书在 `data.books` 里，**不在** `data.items` ——
           只查 getItem 的话，奖励会显示成裸 id（`book_basic_force`），
           玩家看不懂。两级兜底：物品 → 书 → 原样 id。 */
        const it = w.getItem(a[0]) || (w.data.books && w.data.books[a[0]]);
        items.push((it && it.name ? it.name : a[0]) + (a[1] > 1 ? ' x' + a[1] : ''));
        break;
      }
      case '+skill': {
        const s = w.getSkill(a[0]);
        bits.push('武学 ' + (s ? s.name : a[0]));
        break;
      }
      case '+title': bits.push('称号'); break;
      case 'joinSect': bits.push('可入门派'); break;
      default: break;   /* say / narrate / flag / -item 之类不是「奖励」，跳过 */
    }
  }
  if (items.length) bits.push(items.join('、'));
  return bits;
}

/** 把任务的接取条件翻成人话（require 的键跟 condText 的键不是一套，单写） */
function questRequireText(req, w) {
  if (!req || typeof req !== 'object') return '';
  const parts = [];
  if (req.noSect) parts.push('须无门派在身');
  if (req.sect) {
    const s = (w.data.sects && w.data.sects[req.sect]);
    parts.push('须是' + ((s && s.name) || req.sect) + '弟子');
  }
  if (req.gender) parts.push(req.gender === 'female' ? '限女子' : '限男子');
  if (req.karma) parts.push('侠义' + req.karma);
  if (req.level) parts.push('武学修为' + req.level);
  if (req.attr) {
    const k = Object.keys(req).find(x => ['>=', '>', '<=', '<'].indexOf(x) >= 0);
    parts.push((req.attr || '资质') + (k ? k + req[k] : ''));
  }
  return parts.join('，');
}

module.exports = { GameEngine, registerBuiltinFns };
