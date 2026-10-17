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
const commandsModule = require('./commands');
const { buildCommands, cnNum, normalizeAskList, npcKnownPeople } = commandsModule;
const { evalCond, evalEffects, evalTemplate, stripChanceCond, onceHidden } = require('./modapi');
const { fmtTime, shichen, stars, clamp, fuzzyFind, normalizeCmd } = require('./utils');
const mapLayout = require('./maplayout');
/* 「飞往」判定（2026-10-13 起：不要求「去过」，改看轻功 + 内力）
   ⚠️ 2026-10-14 主人改判：飞行空投语义**全删**（design/89 §七·补 裁 1）——
   玩家入口已撤，flight.js 已物理删除（对照价值存于 git 历史）。
   行路网络的判定在 travel.js；「飞往」只回一句世界内的指路话（commands.js）。 */
const travelNet = require('./travel');
const tutorial = require('./tutorial');
const social = require('./social');
const storybeat = require('./storybeat');
const queststage = require('./queststage');

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
 *   现在这三位（灭绝师太 / 李莫愁 / 神秘老僧）都是**不在任何主线节点上**的成名人物。
 *
 * ⚠️ 2026-10-17 批2 修「mod 依赖」老坑（design/31/32/33/39 轮反复记档、round 39 特加
 *   smoke-mainline35 §⑩ 硬断言逼修）：原名单里的 `taixu_hermit`（太虚居士）只活在
 *   官方示例 mod `mods/demo_skill`（M68 enabledByDefault:false）—— 关掉 mod，主线
 *   stage3「击败名宿」文案就指向一个不存在的人。换基础数据里的 `li_mochou`
 *   （李莫愁，40_npcs，lv72，古墓山脚 gumu_shan 直连官道 road_nan_1）：
 *   ① 任何 quest 的 giver/引用都不占（实测全库零引用）；② `killed_<id>` 任何 NPC
 *   被打倒都记（world.onNpcDown，名单一改不伤机制）；③ 等级梯度 75/72/120 合理。
 *   60_quests q_main_jianghu stage3 desc 里点名的「太虚居士」同步改「李莫愁」——
 *   归游有方 data lane（数据冻结期）。 */
const LEGEND_IDS = ['emei_miejue', 'li_mochou', 'shenni'];
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
/* 服务端兜底存档的槽位名（见 saveLive/restoreLive）。
   它**不列进玩家存档列表** —— 那是给自己用的安全带，不是给玩家点的档。 */
const LIVE_SLOT = '_live';

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
    /* 🔴 存档目录可用 `WX_SAVE_DIR` 顶掉（2026-10-11 踩过）。
       `saves/` 是**玩家数据**，而服务端还有一份「活档兜底」`saves/_live.json`
       （闲置被回收也不丢角色）。问题在于：**服务端启动会把 `_live` 读回来** ——
       于是「起一个真服务试功能」这个动作会把探针角色写进仓库的 `saves/`，
       然后**后续所有测试**跑起来都带着那个角色（`smoke-server-guard` 的
       「未起局不许 5xx」当场变红，查了半天才发现是上一轮探针的锅）。
       有了这个开关，起真服务试功能时挂 `WX_SAVE_DIR=<临时目录>` 即可互不干扰。 */
    this.saveDir = og(opts.saveDir, process.env.WX_SAVE_DIR || path.join(projectRoot, 'saves'));
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
    this._afterCmdBuild();
    this.ready = true;
    this.bootLog = []
      .concat(modLog.filter(l => l.level !== 'info'))
      .concat(this.modLoader.resolveLoadOrder().problems);
    // 自定义命令 / UI 扩展
    w.customCommands = w.customCommands || {};
    for (const u of w.uiExtensions) { /* 传给 UI */ }
    if (saveId) {
      const s = this.readSave(saveId);
      if (s) {
        w.deserialize(s, modList);
        this.restoreRelations();
        /* 读档同样补记「剧情已讲过」的账（理由同 loadSave） */
        try { storybeat.markSeen(w, w.player); } catch (e) { /* ignore */ }
      }
    }
    return { bootLog: this.bootLog, mods: this.modLoader.mods.map(m => ({ id: m.id, name: m.name, version: m.version, enabled: m.enabled, category: m.category })) };
  }

  /** 重新加载（mod 变更后） */
  reload() {
    this.modLoader.scan();
    const playerSave = this.world.player ? this.world.serialize() : null;
    const prevWorld = this.world;
    const w = new World({ dataDirs: [this.dataDir], modDirs: [this.modsDir], seed: this.world.seed });
    w.loadBaseData();
    w.loadMods(this.modLoader.getEnabledModList());
    registerBuiltinFns(w);
    if (playerSave) {
      try {
        w.deserialize(playerSave, this.modLoader.getEnabledModList());
        /* 读档「没报错」也可能没拿到角色（serialize 缺字段时静默降级）——补一道断言 */
        if (!w.player) throw new Error('读档后没有取到角色');
      } catch (e) {
        /* 🔴 读档失败**绝不能静默吞掉**（原文是一句 catch 后写「兼容性失败则忽略」）：
           吞掉的后果是 `world.player` 变成 null，而前端**还停在游戏界面** ——
           玩家看到「角色名字没了 / 气血 0/1 / 内力 0/1 / 金钱 undefined 文」
           外加一行红字「请先创建角色」（主人亲报的现象，一字不差）。
           正确做法：**退回旧世界**（玩家一切照旧，只是 mod 没换成），
           并把原因挂在 `reloadError` 上给上层显示 —— 宁可明确失败，不许静默丢人。 */
        this.reloadError = String((e && e.message) || e);
        this.world = prevWorld;
        this.cmds = buildCommands(prevWorld);
        this._afterCmdBuild();
        return { mods: this.modLoader.mods.length, ok: false, error: this.reloadError };
      }
    }
    this.world = w;
    this.cmds = buildCommands(w);
    this._afterCmdBuild();
    this.restoreRelations();
    this.reloadError = null;
    return { mods: this.modLoader.mods.length, ok: true };
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
    /* ⚠️ 主线**不在这里接**（原来这行是 `p.setQuestStage('q_main_jianghu', 0)`）。
       原因（主人 2026-10-11 亲口点出来的重复）：主线第一幕的第 0 步就是
       「拜入一个门派」，而新手第 6 章「递信上山门」也是拜师 ——
       开局就接主线，等于让玩家把拜师做两遍（任务面板里两条并排挂着）。
       现在改由 `storybeat.handoff()` 在**新手走完那一刻**交接，
       并且直接站到第 1 步（拜师那一步新手已经办过，不重复要一次）。 */
    p.setFlag('visited_' + p.room, true);
    /* 🔴 开局**不追任何任务**（主人 2026-10-12 最终口径，改自 10-08 那句
       「初始默认追踪新手剧情任务」）。
       主人原话（最新一次）：「删除新手教程，屏幕上方那个大方框的默认为
       **没有追踪任何任务会显示的界面**」「初始主线任务回滚到第一个任务是
       加入一个门派（**默认不追踪**）」。
       ⇒ `p.track = null`：大框收起、让位给**房间描述**（那就是「没有追踪时
          默认显示的那个界面」）；玩家想看哪一桩，自己从「任务」面板点追踪。
       ⚠️ 主线**照旧开局就接**（`world.createPlayer` 里自动接起手式那条），
          只是「接上」≠「追着显示」——这两件事本来就是分开的
          （见 storybeat 顶部「剧情屏」注释）。
       ⚠️ 「新手走完 → 自动换主线」那条自动机制**保留**（`syncTrack` ①），
          但它只在**玩家自己追过新手**（`p.track === NEWBIE`）时才触发；
          开局 null 走的是 `syncTrack` 的③「玩家亲手取消过 → 不擅自追回来」，
          不会把大框又给他填上 —— 这正是主人要的「默认不追」。 */
    p.track = null;
    /* 开工第一屏：剧情走**上方大框**（`view.story`），日志里不再塞剧情。
       见 storybeat 顶部那段「剧情屏」注释。 */
    /* ⚠️ P0（2026-10-12）：开局**不带地图**（原来是 `this.view()` 带全图 247 KB，
       实测 /api/new 回包 329 KB / gzip 48 KB，占开局的九成以上）。
       地图只在玩家打开「地图」面板时由 `/api/view` 单独取 —— 开局这一屏用不上。
       注意 `view.player` / `view.lines` 这些**必须照发**：start.js 的开局第一屏
       （`(d.view && d.view.lines) || d.log`）、app.js 的 `keepView` 都吃它。 */
    const v = this.view({ map: false });
    try { v.story = storybeat.currentStory(this.world, p); } catch (e) { /* 不算也不挡开局 */ }
    /* 101 §三 楔子播报（施工项 5，寇豆码）：首包 lines 前置四段 story 拍
       （数据在 104 的 intro 结构，flag act1_intro_done 一次性）。老档读入不走
       newGame 天然不重播；storybeat.prologue 里 flag 判定再兜一层。
       没数据 → 空数组，老存档/异常路径零负担。 */
    try {
      const pro = storybeat.prologue(this.world, p);
      if (pro.length) v.lines = pro.concat(v.lines || []);
    } catch (e) { /* 楔子播不出不挡开局 */ }
    return v;
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
      /* ②b 画像钩子（hooks）：他手里那件「你能帮着做的事」。
         这是画像里唯一指向「接下来能干什么」的一栏 —— 原先前端一个入口都没有，
         玩家不知道能问，等于 51 个人的钩子白写。这里把标题摆进「询问」面板，
         并按 trigger 现算「现在能不能问出来」（触发条件见 commands.js 的 ask 分支）。
         ⚠️ 先同步 trust：hooks 的 trigger 读 `var: trust_<id>`，不同步就恒不成立。 */
      if (n.portrait.hooks && n.portrait.hooks.length) {
        const w0 = this.world, p0 = w0.player;
        try { w0.syncTrustVar(n); } catch (e) { /* 老档没有该方法时静默跳过 */ }
        for (const h of n.portrait.hooks.slice(0, 2)) {
          if (!h || !h.title) continue;
          const open = !h.trigger || evalCond(h.trigger, { player: p0, world: w0 });
          const doneYet = n.pstate && n.pstate.hooks && n.pstate.hooks[h.id];
          push(h.title, doneYet ? '已记下' : (open ? null : '交情还不够（先替他办点事）'));
        }
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

  /**
   * @param {{map?: boolean}} [opts]
   *   `opts.map === false` → **不带整张地图**。
   *
   *   🔴 主人 2026-10-11：「点击一个按钮后会输出一段英文指令，然后卡顿一下
   *      （大概 0.5 秒？）才有效，有没有办法把卡顿问题解决掉」。
   *      实测：`exec()` 每次回给前端的 JSON 是 **280 KB**，其中 `map` 一项就占 **247 KB**
   *      （88%：454 个房间 + 区域框 + 格心坐标全在里面）。
   *      服务端自己只花 **3.9 ms** —— 时间全耗在「把 247 KB 地图每次重传一遍」上。
   *      而地图**只在玩家打开「地图」面板时才用得到**（前端读 `S.view.map`
   *      的地方全在 `bindPanelActions('map')` 里），走路/说话/看东西根本不需要它。
   *      所以：**指令回包一律不带地图**（27 KB，小 10 倍），
   *      只有 `/api/view`（面板数据通道）才带上。
   */
  view(opts) {
    const withMap = !opts || opts.map !== false;
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
    /* 每个在场 NPC 的**全量**简报（原 view.npcs 形态，原样保留 —— 现在挂在
       /api/npcfull 懒加载通路上，见 npcFullView）。 */
    const hereAll = w.npcsIncludingTemplates(p.room)
      .concat(downed.filter(d => !standing.some(x => x.id === d.id)));


    /* ---- view.npcs 瘦身 · 聚集分级（B2 裁决②，2026-10-15）----
       同房 NPC ≤3 个：照旧发全量简报（面板/菜单零降级）；
       >3 个（村口/聚集/游走扎堆）：只发**卡片级字段**（名字/称号/敌我/好感档/
       身份标签……），菜单与社交面板需要的婚配·结拜·绑架·送礼·喜好等
       全部走 `/api/npcfull {uid}` 懒加载（前端 openNpcMenu 认 slim 旗自动转拉）。
       依据：卡片渲染只读卡片级字段（ui.js renderScene），聚集时那 30 来个
       详情字段 × 每人一份就是几 KB 的纯重复。 */
    const SLIM_THRESHOLD = 3;
    /* 🔴 瘦身口径（主人 2026-10-16 定）：slim 卡**保留短交互字段**——
       tag/tagName/likes/canQingjiao/canQiecuo/canSteal/homeName/kidnap 判定组。
       这些是几十字节的**判定旗标**：菜单能不能出、按钮亮不亮全看它们，
       少一个就是面板直接缺入口（kidnap-ui-check / smoke-social 两条红的教育）。
       被裁的是**长文本与整包清单**（desc/talk 全文、婚配·结拜·送礼详情等，
       点开 npcFull 再拉）。 */
    const slimBrief = (n) => ({
      id: n.id, defId: n.defId, name: n.name, title: n.title,
      level: n.level, hostile: !!n.hostile, knockedOut: !!n.knockedOut,
      favor: n.favor || 0,
      favorTier: social.favorTier(n.favor || 0).name,
      favorColor: social.favorTier(n.favor || 0).color,
      tag: (n.def && n.def.tag) || null,
      tagName: tagNameCN((n.def && n.def.tag) || null),
      gender: n.gender, following: !!n.followPlayer,
      hasQuest: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) < 0)),
      canReport: !!(n.def && n.def.quests && n.def.quests.some(q => p.questStage(q) >= 0 && p.questStage(q) < 99)),
      shop: !!n.shop,
      /* ---- 短交互字段（菜单入口的开关，几十字节级）---- */
      canQingjiao: !!(n.def && n.def.teach && n.def.teach.length),
      canQiecuo: !n.dead && !/\b狼|虎|熊|蛇|豹|兽/.test(n.name),
      canSteal: !!(n.carry && ((n.carry.items || []).length || n.carry.money)),
      likes: ((n.def && n.def.likes) || []).map(x => {
        const lt = social.LIKE_TYPES.find(y => y.id === x);
        return lt ? { id: lt.id, name: lt.cn } : null;
      }).filter(Boolean),
      homeName: (n.def && n.def.home && w.getRoom(n.def.home)) ? w.getRoom(n.def.home).name : null,
      /* 绑架入口判定组：与真动手同一个函数（kidnap.assess），只留 {pct, why} */
      kidnap: (function () {
        try {
          const a = require('./kidnap').assess(w, p, n);
          return a ? { pct: a.pct, why: a.why } : null;
        } catch (e) { return null; }
      })(),
      slim: true,
    });
    const npcs = hereAll.length > SLIM_THRESHOLD
      ? hereAll.map(slimBrief)
      : hereAll.map(n => this._npcFullBrief(n));

    const groundItems = w.itemsIn(p.room).map(i => {
      const d = w.getItem(i.itemId);
      return { uid: i.id, itemId: i.itemId, name: d ? d.name : i.itemId, count: i.count || 1 };
    });
    const corpses = w.corpsesIn(p.room).map(c => ({ id: c.id, name: c.name, lootCount: c.loot.length }));

    // 房间里的可交互物件（供 UI 高亮 + 点击提示指令）
    const roomActions = this.roomActionsView(p);

    // 任务进度条
    const quests = this.questList();
    /* 🔴 2026-10-12 主人：「新手教程剧情全删」。
       原先把新手教程当成一条置顶任务塞进任务列表（`tutorialQuestOf`）——
       现在整块下线，任务列表里只有**真任务**（主线 / 支线）。 */

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
      /* 🔴 主人 2026-10-11：「输入『物品』能看到行囊界面，屏幕下方快捷键『背包』却看不到」。
         根因：前端三个面板读的是**顶层** `v.inventory` / `v.equipment` / `v.affects`，
         而这些数据原先只挂在 `v.player` 下面（playerBrief）—— 顶层根本没有这几个键，
         于是 `invHtml` 拿到 `undefined`、`|| []` 兜成空数组，
         面板永远显示「行囊空空如也」（**不报错、不崩，就是空的**）。
         同一个坑还连累「装备」与「状态效果」两个面板（它们读的也是顶层）。
         顶层补上一份：数据来源与 playerBrief 里那几项**同一函数**，不各算一套。 */
      inventory: this.inventoryList(),
      equipment: this.equipmentList(),
      affects: this.affectList(),
      combat: w.battle ? this.combatView() : null,
      quests,
      /* 地图是回包里最大的一项（247 KB）。指令回包不带它，见 view(opts) 的注释。
         代价：地图面板点格子时若 S.view.map 已被清掉会取不到房间 ——
         前端 afterAction 里做了「新 view 没有 map 就沿用旧 map」的兜底。 */
      /* B-2：几何四件套只在**明确要**的时候才带；不写 `mapGeometry` 就是全套
         （保住 `mapguide-check` / `map-edge-check` 那两条断言的口径，见 mapView 长注）。 */
      map: withMap ? this.mapView({
        geometry: !opts || opts.mapGeometry !== false,
        /* P0-C C-1：分批与迷雾都是 opt-in，不传就是 P0-B 的行为，一个字节不变。 */
        region: (opts && opts.mapRegion) || null,
        neighbors: !!(opts && opts.mapNeighbors),
        fog: !!(opts && opts.mapFog),
      }) : undefined,
      /* 🔴 2026-10-12 主人：「新手教程剧情全删」。
         原先这里回 `guide: tutorial.guideState(...)`（右侧栏进度块 / 教程面板的数据源）——
         整块已下线。**保留 `guide` 键但恒 null**：老前端、老测试还在读它，
         给一个明确空值比「键没了」好排查（`v.guide` 是 undefined 会到处静默出错）。
         同样地 `tutorialFlags` 仍是存档字段（老档里有），只是不再由教程系统消费。 */
      guide: null,
      newbie: null,
      /* 🔴 2026-10-12 主人：「现在的楔子还不如原来的，还不如回滚回去」。
         三轮角色扮演（`view.opening`）**退回**老版「一张静态楔子卡片」：
         `view.intro` 按 `p.birth` 挑版（`tutorial.introFor`），点一下「踏入江湖」
         直接进第一章 —— **不再重复问出身与性别**（那两个建号时已经选过，
         进游戏再问一遍是主人亲报的毛病）。
         `opening` 键**保留但恒** `{show:false}`（老前端/老守卫还在读它）。 */
      intro: (function () {
        try { return require('./tutorial').introFor(p, p.tutorialFlags); }
        catch (e) { return { show: false, title: '', body: '' }; }
      })(),
      opening: { show: false },
      /* 剧情屏（上方大框）：新手当前章 / 新手走完就换成主线当前幕。
         ⚠️ 每次 view 现算（纯函数、幂等）而不是「攒几行发下去」——
            玩家走开、读档、跨区回来，大框里照样是当前这一章，不会漏。
         顺手做一次「新手 → 主线」的交接（幂等，多数时候什么都不做）：
            读档/旧存档进来时，这里保证大框立刻是对的。 */
      story: (function () {
        try {
          storybeat.syncTrack(this.world, p);
          return storybeat.currentStory(this.world, p);
        } catch (e) { return null; }
      }).call(this),
      /* 追踪状态（任务面板据此把「追踪」画成「取消追踪」；null = 没在追任何任务） */
      track: p.track || null,
      marriage: marriage.summary(w),
      kinship: kinship.summary(w),
      home: homeMod.summary(w),
      martial: this.martialList(),
      auction: this.auctionView(),
      culture: (function () { try { return require('./culture').summary(this.world, this.world.player); } catch (e) { return null; } }).call(this),
      /* 练武学面板（主人 2026-10-08）：已学会的武学清单 + 各自等级/上限。
         未起局时给空数组（前端当「还没得练」，不是错误）。 */
      practice: (function () {
        if (!this.world || !this.world.player) return [];
        try { return require('./practice').listFor(this.world, this.world.player); } catch (e) { return []; }
      }).call(this),
      /* 拜师名册：玩家已拜的师父（NPC 面板据此显示「请教」而不是「拜师」）。 */
      masters: (this.world && this.world.player && this.world.player.masters) || {},
      kidnap: this.kidnapView(),
      /* view 瘦身（2026-10-13）：mods 清单撤出场景快照 —— 前端无任何消费方
         （Mod 面板走专属 /api/mods 拉全量，本地 Mod另有 localmods 通道），
         每步 exec 白背 2.9KB 的 id/name/author/description/counts。 */
    };
  }

  /**
   * 「请教武学」面板的数据（主人 2026-10-08）。
   *
   * 主人原话：「NPC 互动页面的『请教武学』按钮点击后应该是一个新界面，
   *   直接列出该 NPC 的所有武学名字按钮，每个武学名字下面/旁边有个『请教』按钮。
   *   还有有些武学即便你点击请教了对方也不会教（非特殊情况比如被你绑进地牢里的）。」
   *
   * ⇒ 一次把这个人**所有**能教的功夫列全（含已会的 —— 已会走「点拨」，花潜能涨熟练度），
   *   每条都带上「要多少好感 / 多少钱 / 多少潜能 / 能不能教 / 不能教是为什么」。
   *   能不能教的判据只有一个来源：`social.wontTeachReason`（面板与指令同源）。
   */
  teachView(uid) {
    const w = this.world, p = w && w.player;
    if (!p) return null;
    /* ⚠️ 先找**活实例**（`npcsIn`），再退回「含模板」那份名单：
       含模板那份对没落地过的名人会临时 spawn 一个，而临时实例上**没有**
       你刚改过的状态（晕着 / 被绑着）—— 于是「他晕着不该教你」会判不出来。
       活实例优先，才跟玩家眼前看到的那个人是同一个。 */
    const live = (w.npcsIn ? w.npcsIn(p.room) : []) || [];
    const npc = live.find(n => n && ((n.defId || n.id) === uid || n.name === uid))
      || (w.npcsIncludingTemplates ? w.npcsIncludingTemplates(p.room) : [])
        .find(n => n && ((n.defId || n.id) === uid || n.name === uid))
      || null;
    if (!npc) return null;
    const potentialMod = require('./potential');
    const isMaster = !!(p.masters && p.masters[npc.defId || npc.id]);
    const list = social.teachList(w, npc).map(x => {
      const sd = w.getSkill(x.id) || {};
      const cur = p.skillLevel(x.id) || 0;
      if (x.known) {
        const teacherLv = potentialMod.teacherLevelOf(npc, x.id);
        const cap = potentialMod.teachUpCap(p, sd, teacherLv);
        const gain = potentialMod.teachUpGain(cap, cur);
        const cost = gain > 0 ? potentialMod.raiseCostOf(sd, gain, cur) : 0;
        return Object.assign({}, x, {
          mode: 'up', level: cur, cap, gain, cost,
          ok: x.can && gain > 0 && (p.potential || 0) >= cost,
          why: x.why || (gain > 0 ? '' : `已经到他能指点的上限（${cap} 级）了。`),
          short: (p.potential || 0) < cost ? `潜能不够（要 ${cost}）` : '',
        });
      }
      const cost = potentialMod.teachCostFor(p, sd, 0, isMaster);
      const potOk = (p.potential || 0) >= cost;
      /* ⚠️ 不能教的理由要**说全**：潜能够但交情不够，也得讲明白差什么 ——
         只给一个灰按钮等于「点了没反应」（铁律）。 */
      let short = '';
      if (!potOk) short = `潜能不够（要 ${cost}）`;
      else if (!isMaster && (npc.favor || 0) < x.favorNeed && !(x.money > 0)) {
        short = `交情不够（需好感 ${x.favorNeed}），他也不收钱`;
      }
      return Object.assign({}, x, {
        mode: 'learn', cost, potOk,
        ok: x.can && potOk && (isMaster || (npc.favor || 0) >= x.favorNeed || x.money > 0),
        short,
      });
    });
    return {
      npc: { id: npc.defId || npc.id, name: npc.name, favor: npc.favor || 0, isMaster },
      potential: p.potential || 0, money: p.money || 0,
      list,
    };
  }

  /**
   * 「询问」面板数据（view 瘦身的懒加载通道，2026-10-13）。
   * 旧版把每个在场 NPC 的话题清单 + 认识人名单整包塞进场景快照
   * （view.npcs[].askTopics / askPeople），只有点「询问」那一次才用得上。
   * 现在改走 `/api/ask {uid}` 按需取，数据来源不变：
   *   · topics ← askTopicsOf（专属/通用话题 + 门槛 hint）
   *   · people ← askPeopleOf（他认识的人，与 commands.npcKnownPeople 同源）
   * 实例查找与 teachView 同一套口径：活实例优先，含模板名单兜底。
   */
  askView(uid) {
    const w = this.world;
    if (!w || !w.player) return null;
    const live = (w.npcsIn ? w.npcsIn(w.player.room) : []) || [];
    /* ⚠️ 三路匹配：实例 id / defId / 名字 —— 场景快照里的 n.id 是**实例 id**，
       名人模板 spawn 出来的实例 id ≠ defId，只按 defId 找会扑空。 */
    const hit = n => n && (n.id === uid || (n.defId || n.id) === uid || n.name === uid);
    const npc = live.find(hit)
      || (w.npcsIncludingTemplates ? w.npcsIncludingTemplates(w.player.room) : []).find(hit)
      || null;
    if (!npc) return null;
    return {
      npc: { id: npc.defId || npc.id, name: npc.name },
      topics: this.askTopicsOf(npc),
      people: this.askPeopleOf(npc),
    };
  }

  /**
   * 单个在场 NPC 的**全量简报**（view.npcs 瘦身 · 聚集分级的懒加载通路）。
   * 聚集场景（同房 >3 人）时 view.npcs 只发卡片级字段（slim:true），
   * 前端 openNpcMenu 认 slim 旗来这里拉全量 —— 菜单/面板代码零改。
   * 三路匹配与 askView 同款（实例 id / defId / 名字）。
   */
  npcFullView(uid) {
    const w = this.world;
    if (!w || !w.player) return null;
    const downed = w.downedIn ? w.downedIn(w.player.room) : [];
    const standing = w.npcsIn ? w.npcsIn(w.player.room) : [];
    const hereAll = (w.npcsIncludingTemplates ? w.npcsIncludingTemplates(w.player.room) : [])
      .concat(downed.filter(d => !standing.some(x => x.id === d.id)));
    const hit = n => n && (n.id === uid || (n.defId || n.id) === uid || n.name === uid);
    const npc = hereAll.find(hit) || null;
    if (!npc) return null;
    return this._npcFullBrief(npc);
  }

  /** view.npcs 全量简报的**唯一构造点**（view() 聚集分级与 /api/npcfull 共用）。 */
  _npcFullBrief(n) {
    const w = this.world, p = w.player;
    const social = require('./social');
    const kinship = require('./kinship');
    const tagNameCN2 = (t) => {
      try { return tagNameCN(t); } catch (e) { return null; }
    };
    return {

      id: n.id, defId: n.defId, name: n.name, title: n.title,
      level: n.level, hp: n.hp, maxHp: n.maxHp, hostile: n.hostile,
      /* 被打倒（还没被补刀）→ NPC 菜单里才给「装进麻袋」入口 */
      knockedOut: !!n.knockedOut,
      /* 绑架成功率（view 瘦身：只发菜单要用的两个字段）。
         ⚠️ 与真动手时那次掷骰子**同一个函数**（kidnap.assess）——
            两边各算一套，迟早出现「写着 70% 却输十次」。
         旧版整包下发 {chance,pct,why,knocked,reasons[]}：
           · reasons 是 why 的原料（why = reasons.join('；')），纯重复；
           · chance 是 pct/100，前端不读；
           · knocked 与外层 knockedOut 同源。
         每个在场 NPC 一份，房间人一多就是几十 KB 的纯重复 —— 只留 {pct, why}。 */
      kidnap: (function () {
        try {
          const a = require('./kidnap').assess(w, p, n);
          return a ? { pct: a.pct, why: a.why } : null;
        } catch (e) { return null; }
      })(),
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
      /* ---- 「请教」清单已改**懒加载**（view 瘦身）----
         旧版把每个在场 NPC 的全部可教武学（含 can/why 判定）整包塞进场景快照，
         武馆/门派房间一个房间就是几十条 —— 而玩家只有点开「请教武学」面板那一次
         才用得上。面板本来就走 `/api/teach {uid}` 拉新鲜数据（teachView，
         带潜能价与完整理由），场景里那份只是拉取失败时的兜底快照。
         兜底改为「拉取失败也明确告知」，不再为 1% 的场景背 100% 的字节。 */
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
      /* 「询问」话题与「他认识的人」名单已改**懒加载**（view 瘦身）：
         走 `/api/ask {uid}` 按需取（engine.askView），场景快照不再背这两份。
         每个在场 NPC 各一份话题+人名，只有点「询问」那一次才用得上。 */

    };
  }

  /** 拍卖行面板数据（design/40 §6.3）—— 未起局时返回 null，前端不当它是错误。 */
  auctionView() {    const w = this.world;
    if (!w.player) return null;
    try { return require('./auction').viewOf(w); } catch (e) { return null; }
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
      /* 79 续（主人原话口径）：once 族的两种（已完成/前置未过）在此同样不进面板
         （onceHidden 共享谓词，与日志「此地可做」行同口径）；重复族不因 cond 消失，
         cond 现在不过的照旧 ok:false + reason（入口不藏给指引）。 */
      if (onceHidden(a, { player: p, world: w })) continue;
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
          /* 79 件（2026-10-17）：这里评的必须是**剥掉 chance** 的条件（stripChanceCond）——
             chance 是「做了才掷」的成败门不是前置，原样评会每次 view() 偷吃 rng 流、
             还让「钓鱼」这类概率动作在场景栏随机 ok:false 闪现。
             cond false 的仍返回 ok:false + reason（此面板是保底路径，「入口不藏给指引」，
             与日志「此地可做」行的不列口径分工不同）。 */
          if (!evalCond(stripChanceCond(a.cond), { player: p, world: w })) {
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
      /* 主线分化（design/67 §5 P1）——面板要显示「你走的哪条线、走到第几幕」 */
      mainline: (function () { try { return require('./mainline').briefOf(p); } catch (e) { return null; } })(),
      hp: p.hp, maxHp: p.maxHp, mp: p.mp, maxMp: p.maxMp,
      /* 上限构成拆解（2026-10-11）—— 主人报「初始最大血 89，没走两步变 149」。
         涨是该涨的（内功等级 + 通脉），坏在**全仓没有一处告诉玩家这钱从哪儿来**。
         这里下发拆解，状态面板就能写「基础 88 + 内功 18 + 经脉 36 = 142」，
         玩家一眼看懂「是我自己练上去的」。 */
      vitals: (function () { try { return p.vitalsBreakdown(); } catch (e) { return null; } })(),
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
      /* 当前「脱不开身」的状态（吐纳 / 双修 / 采补）。
         主人 2026-10-11：不要「收功」按钮，点屏幕上任何别的按钮就退出这个状态。
         前端靠它判断「这一下点击要不要先走一趟服务端把状态收掉」（本地面板指令
         以前会直接在前端开面板，人还坐在那儿吐纳）。 */
      busy: (function () {
        try {
          const d = p.vars && p.vars.dual;
          if (d) return { kind: d.kind, name: d.name, round: d.round || 0, rounds: d.rounds || 0 };
          const t = require('./neigong').stateOf(p);
          if (t) return { kind: 'tune', round: t.round || 0 };
        } catch (e) { /* ignore */ }
        return null;
      })(),
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
    /* 🔴 「基础武学」到底怎么认（2026-10-11）。
       前端一直读 `s.isBasic`，可**数据里从来没有 isBasic 这个字段**（实测 0 门），
       于是 `isBasic` 恒为 false —— 战斗栏里就混进了「基本内功 / 基本拳脚」，
       武学面板也没法把它们排除在「激活」之外（主人亲报的那两条）。
       真正的判据在角色侧：`SLOT_ROOT` 的**值**就是各系基础武学
       （内功→basic_force、拳→basic_fist、剑→basic_sword…）。
       在这里算一次、下发给前端，别让每个渲染函数各认一套。 */
    const ROOTS = new Set();
    try {
      const SR = require('./character').SLOT_ROOT || {};
      for (const k of Object.keys(SR)) for (const id of SR[k]) ROOTS.add(id);
    } catch (e) { /* 拿不到就退化成只认数据里的 isBasic */ }
    for (const id of Object.keys(p.learned)) {
      const sd = w.getSkill(id);
      if (!sd) continue;
      const cur = p.learned[id];
      /* ⚠️ 上限一律用 effectiveMax（含「基础武学等级」这一项）。
         只给 maxSkillLevelFor 的话，前端会显示「还能练到 500」，实际练到 120 就卡住 ——
         玩家看到的是「数字不对」，而这正是武学重制最要紧的那条规则（design/40 §2.6）。 */
      const emax = Math.max(1, p.effectiveMax(sd));
      const own = p.maxSkillLevelFor(sd);
      const baseSd = sd.base ? w.getSkill(sd.base) : null;
      const baseLv = (sd.base && p.learned[sd.base]) ? (p.learned[sd.base].level || 0) : 0;
      out.push({
        id, name: sd.name, type: sd.type, level: p.skillLevel(id), maxLevel: emax,
        exp: cur.exp, expNeed: p.skillExpNeed(cur.level), equipped: Object.values(p.equippedSkills).includes(id),
        /* 槽位名（武学面板要按「内功 / 剑 / 散手」分组显示，光有 equipped 布尔不够） */
        slot: Object.keys(p.equippedSkills).find(k => p.equippedSkills[k] === id) || null,
        standaloneActive: (p.standaloneActive || []).indexOf(id) >= 0,
        desc: sd.desc, trainCost: p.trainCost(sd, cur.level), canTrain: p.skillLevel(id) < emax,
        effects: (sd.effects || []).map(e => e.type),
        /* 武学重制：功法五大类 + 熟练度分级（前端「武学修为」面板要用） */
        category: sd.category || sd.type || '外功',
        profTier: require('./character').profTierIndex(p.skillLevel(id), emax),
        weaponType: sd.weaponType || null,
        damageMult: sd.damageMult != null ? sd.damageMult : null,
        /* 武学重制新增三件（§2.6）：品级 / 绑在哪门基础武学（及其等级）/ 上限是谁卡的 */
        grade: sd.grade || null,
        isBasic: ROOTS.has(id) || !!sd.isBasic,
        standalone: !!sd.standalone,
        base: sd.base || null,
        baseName: baseSd ? baseSd.name : null,
        baseLevel: baseLv,
        limitBy: (!baseSd || emax >= own) ? '自身' : '基础武学',
        moves: [].concat(sd.moves || []).map(m => ({ id: m.id, name: m.name, mpCost: m.mpCost || 0, cooldown: m.cooldown || 0 })),
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
    const MORDER = CR.MERIDIAN_ORDER || Object.keys(mnames);
    const MMAX = CR.MERIDIAN_MAX || 8;
    /* ⚠️ 顺序 = 玩家实际的冲脉顺序（任→督→…），**不是** Object.keys 的插入顺序。
       面板要按这个顺序列出，否则玩家看到的「下一脉」跟实际在冲的那条对不上。 */
    const meridians = MORDER.map(k => ({
      key: k, name: mnames[k] || (k + '脉'), lv: md[k] || 0, max: MMAX,
      /* 「通了这一条能涨什么」——旧面板只有进度，玩家不知道为什么要通 */
      bonusText: (function () {
        const b = [];
        if (k === '任') b.push('气血上限 +12/关');
        if (k === '阳跷') b.push('气血上限 +6/关');
        if (k === '督') b.push('内力上限 +15/关');
        if (k === '阳维') b.push('内力上限 +5/关');
        if (k === '冲' || k === '阴维') b.push('破防 +2%/关');
        if (k === '阴跷') b.push('暴击率 +1%/关');
        if (k === '带') b.push('招架与卸力');
        return b.join('、') || '周身流转更顺';
      })(),
    }));
    /* 当前正在冲的那一条 = 顺序里第一条没满的（与 character.tryAssaultMeridian 同一口径） */
    let nextKey = null;
    for (const k of MORDER) if ((md[k] || 0) < MMAX) { nextKey = k; break; }
    const mnext = meridians.find(x => x.key === nextKey) || null;
    const need = mnext ? (CR.meridianNeed ? CR.meridianNeed(mnext.lv) : 40) : 0;
    const mexp = p.meridianExp || 0;
    meridians.forEach(x => { x.isNext = (x.key === nextKey); if (x.isNext) { x.exp = mexp; x.need = need; } });
    const meridianSummary = mnext
      ? { key: mnext.key, name: mnext.name, lv: mnext.lv, exp: mexp, need, pct: need ? Math.min(100, Math.round(mexp / need * 100)) : 0 }
      : null;
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
      meridians, meridianSummary, aptitude: ap, ways,
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

  equipmentList() {    const p = this.world.player, w = this.world;
    /* 木瓢案（2026-10-17）：槽位表走 w.equipSlots（固定 + 动态并集）——
       「手持」这类自定义槽位装备后也要看得见，原来固定十位表漏了它。 */
    return w.equipSlots(p).map(s => {
      const id = p.equipment[s];
      const d = id ? w.getItem(id) : null;
      return { slot: s, itemId: id, name: d ? d.name : null, stats: d ? d.stats : null };
    });
  }

  /* 状态效果（面板读**顶层** v.affects）。
     原先只有 player.buffs，顶层没有这个键 —— 于是「状态效果」面板也是永远空的，
     与行囊 / 装备同一个坑（主人这次报的是行囊，顺手把三处一起修掉）。 */
  affectList() {
    const p = this.world.player;
    const CN = { atk: '攻击', def: '防御', dodge: '身法', parry: '招架', speed: '速度', critRate: '暴击', maxHp: '气血上限', maxMp: '内力上限' };
    return (p.buffs || []).map(b => {
      const parts = [];
      for (const k of Object.keys(b.mods || {})) parts.push(`${CN[k] || k} ${b.mods[k] > 0 ? '+' : ''}${b.mods[k]}`);
      for (const k of Object.keys(b.dot || {})) parts.push(`${CN[k] || k} −${b.dot[k]}/回合`);
      return { name: b.name || '状态', kind: b.tag || '状态', turns: b.turns, desc: parts.join('　') || '—' };
    });
  }

  /* ============================================================
   * 阶段解析 / 目标判定 —— 实现抽在 `queststage.js`（唯一一份），
   * 这里只做「带上 world」的转发。三处入口（面板 / 自动检查 / 交任务）
   * 必须调同一份代码，否则就是「面板说能交、点下去说不行」。
   * ============================================================ */
  stageResolve(p, stage) {
    return queststage.stageResolve(p, stage, this.world);
  }

  targetDone(p, qid, t) {
    return queststage.targetDone(p, qid, t);
  }

  questList() {
    const p = this.world.player, w = this.world;
    const out = [];
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd) continue;
      const stage = this.stageResolve(p, qd.stages && qd.stages[st]);
      const targets = (stage && stage.targets || []).map(t => {
        const vk = t.var || `q_${qid}_${t.id}`;
        let cur = 0;
        /* ⚠️ 目标判据必须与 `targetDone()` 同一套，否则面板上的「0/1」跟判定不同步 ——
           `flag` 类目标**不读 var**（flag 住在 p.flags），这里原来也漏了这一支。
           另：`kind:'flag'` **带 `var`** 的是「计数目标穿 flag 壳」，读 var（同 targetDone）。 */
        if (t.kind === 'item') cur = p.countItem(t.key);
        else if (t.kind === 'flag') cur = t.var ? (p.getVar(t.var) || 0) : (p.hasFlag(t.key) ? (t.count || 1) : 0);
        else cur = p.getVar(vk) || 0;
        return { desc: t.desc || t.id, cur: Math.min(cur, t.count || 1), count: t.count || 1 };
      });
      out.push({
        id: qid, name: qd.name, type: qd.type, level: qd.level, stage: st, desc: qd.desc,
        /* ⚠️ M6 日课名分（2026-10-18）：**新增 daily 字段，绝不动 type**——
           成就/统计按 type 计数，改 type 会翻车。老档/老数据没有 daily ⇒ false ⇒
           前端按支线处理（向后兼容）。 */
        daily: !!qd.daily,
        stageDesc: stage ? stage.desc || '' : '',
        targets,
        /* 前置没做完 → 明说，不静默（P2 的验收条款） */
        locked: !!(stage && stage.locked),
        lockName: (stage && stage.lockName) || '',
        lockMsg: (stage && stage.lockMsg) || '',
      });
    }
    // 已完成
    /* ⚠️ 这里原来只给一串 id，前端 `d.name` 取不到 → 「已完成」区列出来全是「✔ 」后面空白。
       现在带上名字与类型（前端要显示，也方便「清掉已完成」按类型筛）。 */
    const done = Object.keys(p.quests).filter(k => p.quests[k] >= 99).map(k => {
      const qd = w.getQuest(k) || {};
      return { id: k, name: qd.name || k, type: qd.type || '' };
    });
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
    const w = this.world, p = w && w.player;
    /* ⚠️ 还没起局时 `world.player` 是 **null**（沙箱刚部署完、玩家还在选出身）。
       不挡这一下 → `p.questStage` 抛 TypeError → 路由 500 →
       前端「接取任务」拿到的是个报错，而不是「退回旧行为」。
       （线上实测踩到：`/api/quest` 在未起局的沙箱里直接 500。） */
    if (!p) return null;
    const qd = qid && w.getQuest(qid);
    if (!qd) return null;
    /* 用 stageResolve 而不是裸取 stages[0]：性别双解（P4）的两套解法要在
       「接取任务」的详情页里就显示**你这一性别**的那一套，别拿另一套糊弄玩家。 */
    const st = this.stageResolve(p, (qd.stages && qd.stages[0]) || {}) || {};
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
      /* M6：日课标记原样下发（详情页标签用）；老数据无此字段 ⇒ false */
      daily: !!qd.daily,
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

  /* ⚠️ P0-B B-2（2026-10-13）：`opts.geometry === false` 时**不下发几何四件套**
     （`cells` / `regionBoxes` / `bounds` / `terrain`，合计 77.6 KB）。
     谁要它们：只有**地图面板**（ui.js 要靠 `m.cells` 建「坐标 → 房间」反查表、
     靠 `m.regionBoxes` 定取景框）；「飞行」面板只用 `regions` 的
     entry / canFly / flyCost，**一个几何字段都不读**。
     ⚠️ 默认**全发**（不传 opts 就是完整版）—— 这不是偷懒：
        `mapguide-check.js` 断言「mapView 仍返回 terrain」、`map-edge-check.js` 断言
        「regionBoxes 里有 neighbors」，两者都走 `view({ map: true })`。
        默认全发 ⇒ 这两处口径不变；只有 `/api/view?panel=fly` 显式要瘦身版。 */
  mapView(opts) {
    const withGeometry = !opts || opts.geometry !== false;
    /* --- P0-C C-1：分批（region）与迷雾（fog），两个都是 **opt-in** --- */
    const wantRegion = opts && opts.region ? String(opts.region) : null;
    const withNeighbors = !!(opts && opts.neighbors);
    const withFog = !!(opts && opts.fog);
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
    /* ⚠️ 缓存键必须用**数据对象本身**（`w.data.rooms` 在 boot 之后是同一个对象）。
       原来比的是每次现搓的 `allRooms` 快照 —— 它每次都是新对象，
       所以这个 if **永远成立**，地图布局每请求一次就重算一遍（含松弛迭代）。
       改造后布局只与数据有关、**与玩家位置无关**（见 maplayout.packRegions 的注释），
       所以缓存是安全的：数据不变，图就不变。 */
    if (!this._mapLayout || this._mapLayoutFor !== w.data.rooms) {
      this._mapLayout = mapLayout.layoutAll(
        allRooms, w.data.regions, room.id, w.data.terrain || {}
      );
      this._mapLayoutFor = w.data.rooms;
    }
    const layout = this._mapLayout;

    /* ================================================================
     *  P0-C C-1 分批：算「这一批要发哪些州」
     * ================================================================
     *  ⚠️ 为什么 `region` 支持 `auto` 而且是**必须**的：
     *     P0 之后指令回包 / 开局 / 读档都不再下发地图，前端的 `S.view.map` 是空的 ——
     *     它**根本不知道自己现在在哪个州**，让前端把当前州传过来就是循环依赖。
     *     所以让服务端从玩家脚下这间房自己推（`room.region` 就在手边）。
     *
     *  ⚠️ 「邻州」取的是**真出口邻接**，不是几何邻接：
     *     `regionBoxes[].neighbors` 回答的是「装箱后哪个框在我的哪个方向」，
     *     那是**画图**问题；分批要回答的是「从这批房间能不能走出去」，
     *     那是**真出口**问题。两者差得很远 —— 实测江南城：真出口邻州 16 个，
     *     几何邻州只有 1 个（mojiao）。所以两个都算，取**并集**，宁可多发也不漏。
     *     （只发本州那档更省，但那是调用方传 `neighbors:false` 的选择，不是这里的默认。） */
    const focusRegion = !wantRegion ? null
      : (wantRegion === 'auto' ? room.region : wantRegion);

    let keepRegions = null;      /* null = 不分批，全发 */
    if (focusRegion) {
      keepRegions = new Set([focusRegion]);
      if (withNeighbors) {
        /* 真出口邻接：扫一遍所有房间的出口，跨州的双向登记 */
        for (const r of Object.values(allRooms)) {
          const a = r.region;
          if (!a) continue;
          for (const d of Object.keys(r.exits || {})) {
            const t = allRooms[r.exits[d]];
            if (!t || !t.region || t.region === a) continue;
            if (a === focusRegion) keepRegions.add(t.region);
            else if (t.region === focusRegion) keepRegions.add(a);
          }
        }
        /* 几何邻接：补上「装箱后紧挨着」的那一圈，免得画布边上出现空洞 */
        const gnb = (layout.regionBoxes || {})[focusRegion];
        for (const k of Object.keys((gnb && gnb.neighbors) || {})) {
          if (gnb.neighbors[k]) keepRegions.add(gnb.neighbors[k]);
        }
      }
    }
    /** 房间 id → 州 id（裁 `cells` 时用：`cells` 是按房间 id 索引的） */
    const roomRegion = {};
    for (const id of Object.keys(allRooms)) roomRegion[id] = allRooms[id].region;

    /* --- 探索度：玩家去过哪些房间 --- */
    const visitedCount = Object.keys(allRooms)
      .filter(id => p.hasFlag('visited_' + id)).length;

    /* --- 从当前位置做距离场：用于「相邻1步 / 附近3步 / 已探明」分级 --- */
    const dist = mapLayout.bfsDistance(allRooms, room.id, 99);

    /* 当前房间里**跨出本区域**的那些出口 —— 前端在地图抬头标「东→华山派」。
       ⚠️ 必须在这里按**真出口**算，不能让前端拿坐标去反查隔壁那间是谁：
       区域装箱（packRegions）会在区域之间留 2 格空当，跨区域的房间**在图上从来不相邻**，
       照坐标反查永远是「查无此人」（实测一条都命中不了）。 */
    const crossExits = {};
    for (const dir of Object.keys(room.exits || {})) {
      const t = allRooms[room.exits[dir]];
      if (t && t.region && t.region !== room.region) crossExits[dir] = t.region;
    }

    const rooms = Object.values(allRooms)
      .filter(r => !keepRegions || keepRegions.has(r.region))
      .map(r => {
        const c = layout.cells[r.id] || { x: 0, y: 0, z: 0 };
        const d = dist[r.id];
        const visited = !!p.hasFlag('visited_' + r.id);
        return {
          id: r.id, name: r.name, region: r.region,
          x: c.x, y: c.y, z: c.z,
          exits: Object.keys(r.exits || {}),
          crossExits: r.id === room.id ? crossExits : null,
          current: r.id === room.id,
          visited,
          /* 分级：当前 / 相邻(1步) / 已知(去过) / 附近(可达<=4步) / 未知 */
          near: d === 1,
          reach: d != null && d <= 4,
          dist: d == null ? -1 : d,
        };
      })
      /* ---- P0-C C-1 迷雾：未探索的房间只留「这里有一格」 ----
         ⚠️ 「已知」的判据是 **去过 / 就在脚下 / 紧邻一步**，三条之一：
            · 去过（`visited`）—— 走过就是走过，地图本来就该记着
            · 脚下（`current`）—— 你正站在这儿
            · 紧邻一步（`near`）—— 站在门口能看见隔壁叫什么，这不算剧透
            ⚠️ 那条「附近 ≤4 步」（`reach`）**不算已知**：它是 BFS 在**整张出口图**上
               跑出来的「图上距离」，中间那几间你可能一间都没进过。把它算成已知，
               等于玩家一进新城就白得一张半径 4 格的地图 —— 那正是要裁掉的东西。

         ⚠️ 迷雾房**必须带 `region`**：前端 `mapHtml` 是
            `allRooms.filter(r => r.region === curRegion)` 之后再画，
            不给 region 的话迷雾格会被这条 filter 直接滤掉 ——
            「未探索」就从「看得到但看不清」变成「整片不存在」，
            地图会随探索进度**长出来**，那不是留白羽化，那是地图在变形。
         ⚠️ `visited:false` 与 `dist:-1` 是**显式**给的，其余字段靠 undefined 的假值语义：
            `current/near/reach/exits/crossExits` 读出来都是 undefined，
            在前端每个读取点上都是 falsy，与「未知」等价。 */
      .map(o => {
        if (!withFog || o.current || o.visited) return o;
        /* 🔴 「相邻可走但没走过」这一档（design/78 §4.5.1 的 M-V-2）：
           ① **不发名字** —— ② 但**必须保留 `near: 1`**，前端靠它画空心圈。
           ⚠️ 这里改过一次口径。P0-C 那版的判断是「站在门口能看见隔壁叫什么，
              不算剧透」，于是 near 房跟 visited 一样发全名。
              design/78（2026-10-13，主理人拍板）推翻了它：这一档要的是
              「**无字 + 有空心圈**」—— 玩家靠它判断的是"旁边有路可以走"，
              不是"隔壁叫什么"。名字一出来，圈就没意义了，而且会连累 M-V-7
              （未探索格子的 title 里漏出房间名 = 悬停即剧透）。
           ⚠️ 别把 `near` 一起裁掉：裁了前端就分不出「相邻可走」和「完全未知」，
              地图只剩"有字"和"整片空"两档 —— 那正是主人最烦的"空白方块"。 */
        if (o.near) {
          return {
            id: o.id, x: o.x, y: o.y, z: o.z, region: o.region,
            near: true, known: false, visited: false, dist: -1,
          };
        }
        return { id: o.id, x: o.x, y: o.y, z: o.z, region: o.region, known: false, visited: false, dist: -1 };
      });

    /* ---- 地图分层（★ 主人 2026-10-13：「能不能加一层二层的这种，因为有的
       地块可以往下走」）----
       数据里 `exits` 有 `u`/`d`（上下楼），前端 `DIR_OFF` 画不出这类边，
       于是 `layoutRooms` 把它们**挤到旁边一格**当作普通房间摆着 ——
       结果 101 个「楼上/建筑内部」的房间（演武场 / 藏经阁 / 二楼雅间 / 黑木崖大殿）
       全都摊在地面图上，既拥挤又误导（看着像平地上多出来一堆屋子）。
       分层展示才对：一层 = 地面（z=0）/ 二层 = 楼上与建筑内部（z≥1）/ 地下（z≤-1）。
       ⚠️ 层号直接沿用数据里的 `z`（`layoutRooms` 的上下楼增减而来）——
          不要在这里重新按「1/2 层」硬编码，因为数据里有 z 到 8 的深楼
          （黑木崖大殿 z=7、绣阁 z=7）。前端拿到 `levels` 后自行归并成三档。
       `levels` 只列**真有房间**的层，并按 z 升序 —— 前端照着画切换按钮。 */
    const levelSet = {};
    rooms.forEach(r => { const z = r.z || 0; levelSet[z] = (levelSet[z] || 0) + 1; });
    const levels = Object.keys(levelSet).map(Number).sort((a, b) => a - b)
      .map(z => ({ z, count: levelSet[z] }));

    const regions = Object.values(w.data.regions).map(r => {
      const inRegion = rooms.filter(x => x.region === r.id);
      /* 行路网络（design/89 §七·补 裁 2/3 · 2026-10-14 主人改判）：
         飞行空投语义已全删，这里不再算 canFly —— 改发**行路三态**：
           here   你就在这儿；
           walk   官道直达，免费走；
           ready  跨区门槛已过（渡资/路引/交情 cond），可走；
           closed 被挡，带驿站渡口的世界内说法（sectRefusal 范式）；
           nolink 没有连通两地的驿路（行路数据没写这条边）。
         判定与数据 schema 全在 travel.js，与后端「行路」指令同源。 */
      /* ⚠️ 区域没写 `entry` 时**回落到本区第一个房间**（Mod 作者不知道要补这个字段）。
         基础数据里 35 个区域都写了 entry，但官方「地图 Mod 示例」没写。 */
      const entryId = r.entry || (inRegion[0] && inRegion[0].id) || null;
      const entryRoom = entryId ? allRooms[entryId] : null;
      const curRegion = (w.getRoom(p.room) || {}).region;
      let travel = null;
      if (r.id !== curRegion) {
        const link = travelNet.linkBetween(w, curRegion, r.id);
        const chk = travelNet.checkLink(w, p, link);
        /* view 瘦身（2026-10-13）：state+cost 常发，gateText/refusal 按需 ——
           walk 的 gateText/refusal 恒空、nolink 连 cost 都没有，
           旧版给每个区域都背四个字段（大地图 30+ 区，全是 null 也占字节）。
           前端 travelHtml 只在 ready 读 gateText、closed 读 refusal，语义不变。 */
        travel = { state: chk.state, cost: (link && link.cost) || null };
        if (chk.state === 'ready') {
          travel.gateText = (link && (link.gateText || (link.kind === 'cross' ? link.cond : null))) || null;
        } else if (chk.state === 'closed') {
          travel.refusal = chk.reason || null;
        }
      }
      return {
        id: r.id, name: r.name, color: r.color, desc: r.desc,
        count: inRegion.length,
        visitedCount: inRegion.filter(x => x.visited).length,
        hasCurrent: inRegion.some(x => x.current),
        /* ⚠️ P0-B B-1（2026-10-13）：regions[].rooms 只发 id（原两份序列化 96.3 KB 白交）。
           count / visitedCount / hasCurrent 必须留着（区域总览只读这三个聚合值）。 */
        roomIds: inRegion.map(x => x.id),
        entry: entryId,
        entryName: entryRoom ? entryRoom.name : null,
        travel,
      };
    });

    /* ---- 跨区域「桥」（2026-10-11 主人）----
       「我要的世界地图是所有地图首尾连接：如果这个 A 区域地图边缘的地块再往前走一步
        就是 B 区域，那么这个 A 区域的地块就用线连接那块 B 区域的地块，
        整个分散的世界地图合并成一个完整的大地图。」
       为什么前端画不出来：`packRegions` 会把各区域**推开**、之间留空当，
       于是「真出口连着的两个房间」在图上的坐标**从来不相邻**，
       前端那条「按坐标找邻居」的走廊逻辑一条都命中不了（老注释里记过这个坑）。
       所以这类边只能由后端从**真出口**算出来下发给前端。
       ⚠️ 只收「真出口连着、但图上不相邻」的：坐标系上本来就挨着的，走廊已经画了，
          再补一条直线是重复画。同一条边只发一次（按 id 排序去重）。

       🔴 2026-10-13 修了一个**双向漏发**的 bug（主人报「连线不全」时挖出来的）：
          老写法是「先判图上相邻就 continue，再判 id > t.id 就 continue」，两条
          continue 串在一起，于是这种情形会**一条都不发** ——
          A→B 那一侧在图上恰好相邻（被第一条 continue 掉），
          而 B→A 那一侧不相邻、却因为 `id > t.id` 被第二条 continue 掉。
          结果：一条真出口**彻底从地图上消失**（实测漏了 79 条，占应发 233 条的 1/3）。
          修法：**去重键换成「房间对」，并且只在『确实要发』时才判重** ——
          即先确认这一侧不相邻，再看这对房间发过没有。
          顺序一变，就不会再出现「两边互相把对方 continue 掉」。 */
    const bridges = [];
    {
      const DD = mapLayout.DIR_DELTA || {};
      const emitted = new Set();
      const ids = Object.keys(allRooms);
      for (const id of ids) {
        const r = allRooms[id];
        const c1 = layout.cells[id];
        if (!c1) continue;
        /* P0-C C-1 分批：起点的州不在这一批里 ⇒ 整条边都不发。
           ⚠️ 这里是**两端都判**，不是只判起点：只判起点的话，会发出一条
              「a 在批内、b 在批外」的悬空边 —— 前端 `m.cells[b]` 取不到，
              坐标算出来是 NaN，画出去是一条拖到画布外的病态线。
              （前端 ui.js:3042 有 `if (!a || !b) return;` 兜底，
                但那是拿渲染集合兜的，不该指望它替后端擦屁股。） */
        if (keepRegions && !keepRegions.has(r.region)) continue;
        for (const dir of Object.keys(r.exits || {})) {
          const t = allRooms[r.exits[dir]];
          if (!t) continue;
          if (keepRegions && !keepRegions.has(t.region)) continue;
          const c2 = layout.cells[t.id];
          if (!c2) continue;
          const d = DD[String(dir).toLowerCase()];
          /* 图上本来就挨着（按这条边的方向算）⇒ 走廊已经画了，不用补 */
          if (d && c1.x + d[0] === c2.x && c1.y + d[1] === c2.y) continue;
          /* 不相邻才发；同一条边只发一次（键是房间对，与方向无关） */
          const pair = (id < t.id) ? (id + '|' + t.id) : (t.id + '|' + id);
          if (emitted.has(pair)) continue;
          emitted.add(pair);
          bridges.push({ a: id, b: t.id, dir, crossRegion: r.region !== t.region });
        }
      }
    }

    /* P0-C C-1：几何四件套跟着分批裁。
       ⚠️ `bounds` **不裁** —— 它是世界外框（0.1 KB），前端只在 `regionBoxes[x]`
          取不到时才拿它兜底（ui.js:2811），裁了反而凭空多出一个「取不到」的分支。
       ⚠️ `terrain` 前端**现在一个字都不读**（grep 过 `game/src/renderer/js/*.js`，
          只有三处命中且全是注释）。这里仍然照批内区域裁着发，而不是整个删掉：
          `mapguide-check.js:73` 钉的是「数据没删，只是不画」这个语义，
          留着字段比悄悄删掉更诚实 —— 哪天真要删，去改那条断言，别在这里偷偷抹。 */
    const pickBy = (obj, keepFn) => {
      const o = {};
      for (const k of Object.keys(obj)) if (keepFn(k)) o[k] = obj[k];
      return o;
    };
    const cellsOut = keepRegions
      ? pickBy(layout.cells, k => keepRegions.has(roomRegion[k]))
      : layout.cells;
    const boxesOut = keepRegions
      ? pickBy(layout.regionBoxes || {}, k => keepRegions.has(k))
      : (layout.regionBoxes || {});
    const terrainOut = keepRegions
      ? pickBy(layout.terrain || {}, k => keepRegions.has(k))
      : (layout.terrain || {});

    return {
      region: region ? { id: region.id, name: region.name, desc: region.desc, color: region.color } : null,
      rooms, current: p.room, regions,
      /* B-2：几何四件套按需（理由见函数头部长注）。要瘦身就整个不出现，
         而不是给 `undefined` —— 后者 `JSON.stringify` 虽然也会丢掉，
         但 `'cells' in m` 仍是 true，容易让后来的人误判「字段还在」。 */
      ...(withGeometry ? {
        cells: cellsOut,
        regionBoxes: boxesOut,
        bounds: layout.bounds,
        terrain: terrainOut,
      } : {}),
      bridges,
      levels,
      /* ⚠️ `total` 恒等于**全世界**的房间数（512），不随分批变小 ——
         主人要的是「让人知道世界多大」，分母缩水成 34 就变成「探索度 1/34」，
         那是把「这世界只有 34 间房」这个假信息喂给玩家。
         （`visited` 同理，是全局数，不是批内数。） */
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
      /* 是不是玩家的师父（主人 2026-10-08 的拜师线）：是 → 面板上出「请教」，否 → 出「拜师」。 */
      isMaster: !!(w.player && w.player.masters && w.player.masters[(n.defId || n.id)]),
      /* ---- 出师 / 退出师门（主人 2026-10-11）----
         `sectMaster` 为真 = 这是**门派里的师父** —— 面板据此不出「出师」按钮
         （门内换人走「向更高职位的人拜师」）。
         `graduate.ok` 为假时按钮仍在、只灰掉并给出差在哪 ——
         按钮凭空消失，玩家只会以为这条路没做。 */
      sectMaster: (function () {
        try { return require('./discipleship').isSectMaster(w.player, n); } catch (e) { return false; }
      })(),
      graduate: (function () {
        if (!w.player || !w.player.masters || !w.player.masters[(n.defId || n.id)]) return null;
        try {
          const c = require('./discipleship').canGraduate(w, w.player, n);
          return c.ok ? { can: true, need: c.need } : { can: false, why: c.why };
        } catch (e) { return null; }
      })(),
      /* 「点名字、开互动面板」那一步的过渡句（主人 2026-10-08）：
         「看了一眼」是**这一步**说的 —— 「看」那一路给的是仔细观察的细节（手上的茧之类），
         两者分工别搞混。前端拿到后先把这句落进日志，再弹面板。 */
      glance: (function () {
        try { return require('./observe').glanceAt(w, n); } catch (e) { return null; }
      })(),
      /* 能不能向这个人发起挑战（门内争位）：同门 + 他位次比你高一位 + 贡献够押。
         不满足时给一句 why，面板上把按钮灰掉但**仍然显示**，让玩家知道这儿有这条路。 */
      challenge: (function () {
        if (!w.player || !w.player.sect) return null;
        try {
          const SL = require('./sectlife');
          const c = SL.canChallenge(w, w.player, n);
          return c.ok ? { can: true, need: c.need, to: c.to } : { can: false, why: c.why };
        } catch (e) { return null; }
      })(),
      /* ---- 人物故事（主人 2026-10-10）：好感 > 60 才给看 ----
         故事就是画像里写的那几段（来历 / 现在 / 想要 / 怕什么）。
         门槛不到时**不隐藏入口**，只回一句「他还信不过你」——
         让玩家知道这里还有东西，而不是以为这个人没有故事。 */
      lifeStory: (() => {
        const need = 60;
        const ok = Math.round(n.favor || 0) > need;
        const pick = k => (ok && pt && pt[k]) ? tpl(pt[k]) : null;
        return {
          unlocked: ok, need, role: pt && pt.role ? tpl(pt.role) : '',
          origin: pick('origin'), now: pick('now'), want: pick('want'), fear: pick('fear'),
        };
      })(),
      /* ---- 双修 / 采补（主人 2026-10-11 从「秘技」搬过来的）----
         判定一律放后端一处算（晚上 / 旁边有没有人 / 双方关系 / 对方家世与配偶 / 好感 /
         冷却），前端只画按钮 —— 两边各写一套门槛，迟早分家。
         `can:false` 时按钮仍然显示、只灰掉，并把差什么说出来（按钮凭空消失，玩家只会以为没做）。 */
      dual: (function () {
        try {
          const c = require('./dualcultivate').evaluate(w, p, n, 'dual');
          return c.ok ? { can: true } : { can: false, why: c.why };
        } catch (e) { return null; }
      })(),
      drain: (function () {
        try {
          const c = require('./dualcultivate').evaluate(w, p, n, 'drain');
          return c.ok ? { can: true } : { can: false, why: c.why };
        } catch (e) { return null; }
      })(),
      /* ---- 徒弟：传功 / 灌顶（主人 2026-10-10）---- */
      isDisciple: ((p.disciples || []).indexOf(n.id) >= 0),
      maxMp: Math.floor(n.maxMp || 0),
      /* 能传给这个徒弟的功法（面板要列出来给玩家点） */
      teachables: ((p.disciples || []).indexOf(n.id) >= 0)
        ? Object.keys(p.learned || {}).map(sid => {
          const sd = w.getSkill(sid);
          if (!sd) return null;
          const lv = (p.learned[sid] && p.learned[sid].level) || 0;
          const has = (n.learned && n.learned[sid] && n.learned[sid].level) || 0;
          return { id: sid, name: sd.name, level: lv, can: has < Math.floor(lv * 0.6) };
        }).filter(Boolean).filter(x => x.can).slice(0, 30)
        : [],
      /* ---- 交互面板上的按钮（战斗外秘技 + 结缘线）----
         秘技只对弱者使得出、按差距掷骰；`can/why` 由 arts.js 统一算，前端只负责画。 */
      arts: (() => { try { return require('./arts').listFor(w, p, n); } catch (e) { return []; } })(),
      marks: (() => { try { return require('./arts').marksOf(n); } catch (e) { return []; } })(),
      bonds: (() => {
        try {
          const M = require('./marriage');
          const taken = M.npcTaken(w, n);
          const linked = (p.spouses || []).concat(p.bonds || []).some(x => (x.npcId || x.id) === (n.defId || n.id));
          return {
            isLover: ((p.lovers || []).some(x => (x.npcId || x.id) === (n.defId || n.id))),
            isSpouse: linked,
            takenByOther: taken ? (taken.name || '有人') : null,
            canBond: !linked,
            favorNeed: M.marryFavorNeed ? M.marryFavorNeed(w, n) : 80,
          };
        } catch (e) { return null; }
      })(),
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
   * 功能 Mod · 宏指令（rules 里 `kind: 'macro'`）
   *
   * 制作器里能选「宏指令（一条指令=多条）」、文档也写了，但**从来没有执行入口** ——
   * 作者照示例写 `{kind:'macro', target:'拾取', effect:'get all'}`，敲「拾取」只会得到
   * 内置指令表的「我不懂这个指令」（选了白选 = 本项目最忌的静默失效）。
   *
   * 字段语义（与制作器「规则」表单一一对应）：
   *   target  要接管的指令名 —— 玩家敲的**第一个词**，英文 id（getAll）或中文（拾取）都认，大小写不敏感
   *   effect  展开成什么 —— 字符串按 `;` 分段（也接受数组）；留空则回落到 value
   *   value   同 effect 的简写（示例 Mod 里的预设用的就是它）
   *   cond    门槛表达式（`room.items>0` / `!combat` …）—— 不满足就**不展开**，
   *           由 exec 明确回一句「现在用不了」，而不是让玩家对着「我不懂这个指令」发懵
   *
   * 展开走**命令引擎原生的 `a;b;c` 分段**（commands.execute 早就支持），
   * 所以时间只推进一次、剧情只结算一次。也支持宏套宏（A→B→B 是真指令），
   * 但用一个 seen 表 + 最大 6 层**硬顶住自指**（A→B→A、A→A 都要能停下）。
   * ⚠️ 宏名**千万别跟前端 `PANEL_CMDS` 里的面板名撞**（撞了被前端拦成开面板，
   *    后端根本收不到这条指令）—— 面板名见 ui.js 的 PANEL_CMDS。
   */
  _macroOf(input, norm, opts) {
    const w = this.world;
    const rules = ((w && w.activeRules) || []).filter(r => r && r.kind === 'macro');
    if (!rules.length) return null;
    const head0 = String(norm || '').trim().split(/\s+/)[0];
    if (!head0) return null;
    const findRule = (h) => {
      const key = String(h).trim().toLowerCase();
      return rules.find(r => String(r.target || '').trim().toLowerCase() === key) || null;
    };
    /* 第一跳就查不到 → 这条指令跟宏没关系，直接放行（绝大多数指令走这里） */
    if (!findRule(head0)) return null;

    const MAX = 6;
    const seen = [];
    let cur = String(norm || '').trim();
    for (let i = 0; i < MAX; i++) {
      const head = cur.split(/\s+/)[0];
      if (!head) break;
      if (seen.indexOf(head.toLowerCase()) >= 0) break;   /* 自指：A→B→A 到此为止 */
      const r = findRule(head);
      if (!r) break;
      if (r.cond && !evalCond(r.cond, { player: w.player, world: w })) {
        /* 头一跳就没过门槛 → 告诉玩家；后续跳没过 → 保留已展开的前缀，别整条丢掉 */
        return i === 0
          ? { norm: null, blocked: { name: r.name || r.target, why: '条件未满足（' + r.cond + '）' }, head: head0 }
          : { norm: cur, blocked: null, head: head0 };
      }
      let exp = r.effect !== undefined && r.effect !== null && String(r.effect).trim() !== ''
        ? r.effect : r.value;
      if (Array.isArray(exp)) exp = exp.join(';');
      exp = String(exp === undefined || exp === null ? '' : exp).trim();
      if (!exp) break;                                    /* 有规则没效果：当它不存在，别吞指令 */
      seen.push(String(head).toLowerCase());
      cur = exp;
      /* 展开出来的东西跟原指令一模一样 → 到此为止，免得原地打转 */
      if (cur === String(norm || '').trim()) break;
    }
    if (cur === String(norm || '').trim()) return null;
    return { norm: cur, blocked: null, head: head0 };
  }

  /* ------------------------------------------------------------------ *
   * 指令执行
   * ------------------------------------------------------------------ */
  exec(input, opts) {
    const w = this.world, p = w.player;
    /* 没角色两种情况要分开说（主人亲报的那句「请先创建角色」就出在这儿）：
       · 真·还没起局（停在标题界面）→ 「请先创建角色」是对的
       · **本来在玩、角色却没了**（沙箱闲置回收进程重启）→ 玩家看着自己的角色
         突然消失，再被告知「请先创建角色」，只会以为进度全丢了。
         这种一律打 noPlayer 标记，由前端去 `restoreLive()` 把人接回来。 */
    if (!p) {
      const canRestore = !!this.readSave(LIVE_SLOT);
      return {
        lines: [{
          kind: 'warn',
          text: canRestore ? '（这一局断了一下，正在替你接回来……）' : '请先创建角色。',
        }],
        noPlayer: true,
        canRestore,
        view: this.view({ map: false }),
      };
    }
    const ctx = { player: p, world: w, engine: this };
    const before = p.room;
    /* B13 连带收尾：读档迁移提示「只顶在下一屏房间描述前」，玩家一动就撤掉，不长期挂描述上。 */
    if (w._migrateNotice) w._migrateNotice = null;
    /* 中文口语归一化：「往北走」→「n」、「查看背包」→「i」 */
    let norm = normalizeCmd(input);
    /* 功能 Mod · 宏指令（rules 里 kind:'macro'）：把整条指令换成展开结果。
       排在这里有两个原因：
       ① 在 markTutorial **之前** —— 宏展开出来的那些指令才点得亮教程标记
          （不然作者写 `{target:'拾取', effect:'get all'}`，玩家敲「拾取」永远不算「拾取过东西」）；
       ② 在 cmds.execute **之前**、只做一次 —— 走命令引擎原生的 `a;b;c` 分段，
          时间只推进一次、剧情只结算一次。**别再写「子指令递归 exec」**：那条路会
          每条子指令推进一次时间、把回包揉成 N 份，是同类坑里最难查的一种。 */
    const macro = this._macroOf(input, norm, opts);
    if (macro && macro.norm) norm = macro.norm;
    this.markTutorial(input, norm);
    /* ★ 通用防线：**一条指令抛异常，不该让整个请求挂掉**。
       第四轮修 `ask`（数据里「话题→答案」映射写法会让 `a.topic.includes` 抛异常）时发现：
       `exec` 原来直接把 `cmds.execute` 的异常冒到上层，服务端 `handleApi` 的 try/catch
       兜成 500 —— 玩家看到的是「网络错误」，排查的人拿到的是「没线索」，
       而这个 bug 在数据里躺了很久没人报（数据里 18 个 NPC 用数组写法没事，
       示例 mod 与新写的 NPC 用映射写法就崩）。
       现在兜住：给玩家一行**明确的回执**（不静默），并把栈打到服务端日志（可排查）。
       ⚠️ 别把回执删成静默 —— 那正是本项目最忌的「不报错就不生效」。 */
    /* 吐纳 / 双修 / 采补当中「脱不开身」——
       主人 2026-10-11：「吐纳的动不了改成点击页面任意其他按钮自动退出吐纳状态」，
       双修采补同理，而且**不要「收功」按钮**。
       ⇒ 所以这里不再是「拒绝执行」，而是「先退出这个状态，再照常执行这道指令」：
         玩家点「背包」就真的开背包，只是人从坐忘里醒过来（屏幕上会写明退出）。
       ⚠️ 继续类（吐纳/双修/采补）与显式退出类（收功/散功/起身）不进自动退出分支 ——
          否则「再敲一次接着熬」会把自己打断，而「收功」会先退一次、再报一次「你并没有在吐纳」。 */
    const exitBusy = [];
    if (p.vars && (p.vars.dual || p.vars.tuning)) {
      const head = String(norm || '').trim().split(/\s+/)[0] || '';
      const KEEP = ['双修', '合修', 'dual', '采补', '采战', 'drain',
        '吐纳', '行功', '调息', 'tuna', '收功', '散功', '起身'];
      if (KEEP.indexOf(head) < 0) {
        try {
          exitBusy.push(...(p.vars.dual
            ? require('./dualcultivate').stop(w, p).lines
            : require('./neigong').stop(w, p).lines));
        } catch (e) { /* 退不成也不能把人锁死：照常往下走 */ }
      }
    }

    let res;
    try {
      res = this.cmds.execute(norm, ctx);
    } catch (err) {
      try { console.error('[wxmud] 指令异常：', norm, (err && err.stack) || err); } catch (e2) { void e2; }
      res = { lines: [{ kind: 'warn', text: `（「${input}」这道指令出了岔子，已经记下来了。）` }] };
    }
    const lines = res.lines || [];
    /* 退出吐纳 / 双修的那几句，排在**这条指令自己的输出之前** ——
       玩家先看到「醒过来了」，再看「背包里有什么」；顺序反了会以为状态还在。 */
    if (exitBusy.length) lines.unshift(...exitBusy);
    /* 宏「有规则、但门槛没过」时**必须说话** —— 否则玩家敲下去只会得到
       内置指令表的「我不懂这个指令」，而作者明明写了这条宏，两边都以为是对方的错
       （这就是本项目最忌的静默失效）。 */
    if (macro && macro.blocked) {
      lines.unshift({
        kind: 'warn',
        text: `「${macro.blocked.name || macro.head}」现在还用不了：${macro.blocked.why}。`,
      });
    }
    // 后处理
    w.advanceTime(1);
    /* 世界动态 W5/W7：把「推进时间时」世界抛出的 storyline 台词排进玩家输出。
       （storyline 产品侧零消费者 —— 以前 onTick / onDayTick 的台词 emit 出去就沉了。） */
    this._drainWorldLines(lines);
    this.postProcess(lines, before, opts);
    /* 任务追踪的自动规则（新手走完 → 换追主线；追的那条交完了 → 换一条）。
       放在这里是因为「每一处推进都要走 exec」——面板点出来的、敲指令敲出来的、
       打架打出来的都经过这儿，切换不会漏。幂等，平时什么都不做。 */
    try { storybeat.syncTrack(w, p); } catch (e) { /* 追不上不该挡着玩 */ }
    /* 支线任务的接取 / 阶段推进通知（**不是剧情**，走日志）。
       剧情章节已经改到上方大框（`view.story`），见 storybeat 顶部注释。 */
    try { lines.push(...storybeat.reconcile(w, p)); } catch (e) { /* 讲不成不该挡着玩 */ }
    const out = { lines, ...res };
    /* 结局回包（2026-10-18，半成品审计第 8 项）：效果里的 ending 行 → `out.ending`。
       前端「故事终章」弹框读的是 `d.ending`，而此前**全仓没有任何地方给它赋值**
       （死代码：结局只播台词、不弹终章）。这条路是唯一定义处，别再另加一份。 */
    if (!out.ending) {
      try {
        const end = require('./endings').endingOf(lines);
        if (end) out.ending = end;
      } catch (e) { /* 认不出结局不该挡着这一条指令 */ }
    }
    /* ⚠️ 指令回包**不带地图**（`map: false`）。这里是所有指令的总出口 ——
       漏掉这一处，上面六处 `map: false` 全白改（实测 274 KB，一点没瘦）。
       地图 247 KB / 回包 280 KB，只在你打开「地图」面板时才需要。 */
    out.view = res.view || this.view({ map: false });
    return out;
  }

  /* 建完指令表之后的**统一收尾**：boot / reload（两条分支）/ loadSave 四处都走这里。
     做两件事：
     ① 教程别名反向表 —— 手抄表会漂（`打坐` 曾经点不亮第三章），必须从真指令表重建；
     ② 脚本自定义指令与内置指令的撞名检查 —— 撞了要记日志 + 让位，
        否则作者以为自己的指令生效了，实际玩家敲的永远是内置那条。
     ⚠️ 别在这两件事之外再往里塞东西 —— 这里跑在「服务刚起来 / 刚读档」的敏感时刻。 */
  _afterCmdBuild() {
    this._wireTutorialAliases();
    try { this.world.validateScriptCommands(this.cmds); } catch (e) { /* 校验不该挡着起服务 */ }
  }

  /* 新手引导：把「指令注册表里的别名」喂给 tutorial，用于「按规范名反查引导标记」。
   *
   * ⚠️ 为什么需要：`tutorial.CMD_FLAGS` 是**手抄的别名表**，而真正的别名表长在
   *   `commands.js` 的 `reg([...])` 里。两处不同步 = **静默失效**：
   *   主人点屏幕上的「打坐」按钮（发的是英文 `meditate`），教程第三章
   *   「身上得有点底子」就**永远点不亮**——因为手抄表里只有 `打坐/lian/train/练功/修炼`。
   *   现在把 `cmds.CMD[k].names[0]`（规范名）连同全部别名注入，加别名不用再改 tutorial。
   *   三个建 cmds 的地方（boot / reload / load）都必须调，否则读档后又漂回去。 */
  _wireTutorialAliases() {
    const CMD = (this.cmds && this.cmds.CMD) || {};
    const map = {};
    for (const k of Object.keys(CMD)) {
      const names = (CMD[k] && CMD[k].names) || [k];
      const canon = String(names[0] || k).trim().toLowerCase();
      map[String(k).trim().toLowerCase()] = canon;
    }
    tutorial.setCmdAliases(map);
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

    /* ---- 新手第二章：走出去**再回到那处位置**才算完成（2026-10-11 主人）----
       原话：「第二章剧情我走一步就能完成，然后弹出第三章就很懵逼
       （能不能改成走出去再回到那处位置才算完成并显示第三章？）」
       `did_step` 由 `markTutorial` 在「抬过脚」时点亮，但那只说明走过一步；
       这里拿**移动前后的房间**把「离开导引处」与「又回到导引处」分开记：
         · 移动后不在导引处 → 记 did_leave（走出去了）
         · 移动后回到导引处、且之前走出去过 → 记 did_move（这一章才算完成）
       只认位置不认指令 —— 方向键、`go`、地图点格子、传送，哪条路都算。 */
    const guideRoom = (w.data && w.data.meta && w.data.meta.startRoom) || null;
    if (guideRoom && beforeRoom && beforeRoom !== p.room) {
      if (!p.tutorialFlags) p.tutorialFlags = [];
      const hasF = (f) => p.tutorialFlags.indexOf(f) >= 0;
      const addF = (f) => { if (!hasF(f)) { p.tutorialFlags.push(f); p.setFlag('tut_' + f, true); } };
      if (p.room !== guideRoom) addF('did_leave');
      else if (hasF('did_leave')) addF('did_move');
    }
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
      /* ⚠️ 走 stageResolve 而不是直接取 qd.stages[st]：
         按性别换一套目标（P4）时，站错房间就永远攒不上 var ——
         这正是「不报错就是不生效」那一族。 */
      const _st = this.stageResolve(p, qd.stages[st]) || qd.stages[st];
      for (const t of (_st.targets || [])) {
        const vk = t.var || `q_${qid}_${t.id}`;
        /* room：人站在目标房间就是达成。
           flag：**标记已经设上**就是达成。
           🔴 主人 2026-10-11 报：「小叫花的城西破庙搜查任务，我来到破庙点『搜查』，
              为什么任务没完成？」—— 根因就是这里只认 `room`。
              破庙那间房的「搜查」动作确实把 `temple_searched` 设上了（50_map 里写得好好的），
              可这个循环里**没有 flag 这一支**，于是：
                目标 var 永远是 0 → checkQuestAuto 判不出达成 → 面板停在「去城西破庙查看」。
              全库带 `kind:'flag'` 的目标不止这一条（它是一整类），一起修掉。 */
        if (t.kind === 'room' && t.key === p.room) { if (!p.getVar(vk)) p.setVar(vk, 1); }
        /* flag 类：带 `var` 的走计数（真值在 var，由 incvar 攒），不带 var 的才是布尔标记。
           与 targetDone / 上方面板判据三处同源，别只改一处。 */
        else if (t.kind === 'flag') {
          if (t.var) { /* 计数目标：值由 incvar 写入，此处不动 */ }
          else if (p.hasFlag(t.key)) { if (!p.getVar(vk)) p.setVar(vk, t.count || 1); }
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
      const stage = this.stageResolve(p, qd.stages[st]);
      if (!stage) continue;
      /* 前置没做完：**明说不解锁**（design/67 §5.3 P2 的验收条款），
         否则玩家会陷在「目标都办完了却推不动，也不告诉我为什么」里 —— 这就是静默。
         只在状态第一次出现时提示一次，别每走一步刷屏。 */
      if (stage.locked) {
        const lk = 'lockhint_' + qid + '_' + st;
        if (!p.hasFlag(lk)) {
          p.setFlag(lk, true);
          lines.push({ kind: 'warn', text: stage.lockMsg });
        }
        continue;
      }
      // 条件齐备 → 提示可复命（不自动完成，需要去找 NPC 交任务）
      if (stage.targets && stage.targets.length) {
        let all = true;
        for (const t of stage.targets) {
          if (!this.targetDone(p, qid, t)) { all = false; break; }
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
    if (!opt || !opt.effects) return { lines: [], view: this.view({ map: false }) };
    const ctx = { player: p, world: w, engine: this };
    const lines = evalEffects(opt.effects, ctx);
    if (opt.goto) {
      // 对话树跳转：把 goto 结果交给前端再请求
      lines.push({ kind: 'goto', text: opt.goto });
    }
    w.advanceTime(1);
    this._drainWorldLines(lines);
    this.postProcess(lines, p.room);
    return { lines, view: this.view({ map: false }) };
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
    if (!w.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }], view: this.view({ map: false }) };
    let r;
    if (action === 'flee') r = w.combatStep('flee');
    else if (action === 'skill') r = w.combatStep({ type: 'skill', skill: payload.skill });
    else if (action === 'item') r = w.combatStep({ type: 'item', uid: payload.uid });
    else r = w.combatStep();
    const lines = r ? r.lines : [];
    this.postProcess(lines, p.room);
    return { lines, view: this.view({ map: false }) };
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
        /* B1：测试/调试档一律不列出。兜底档同理（那是我自己的安全带，不是玩家的档）。 */
        if (id === LIVE_SLOT || this._isTestSave(id, j)) continue;
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

  /**
   * 快照（存档本地化 2026-10-18，主人定调：存档读写全部走浏览器本地）：
   * **纯序列化，不碰磁盘**。存档的唯一权威副本从此住浏览器 localStorage
   * （js/savestore.js），服务端不再替玩家写 saves/ —— `/api/save` 路由改走这里。
   * id 语义与 save() 一致（缺省 save_<时间戳>），但不落盘也不加测试标记
   * （测试标记是磁盘档防混入玩家列表用的；本地档的隔离由前端存档组件管）。
   */
  snapshot(id) {
    const w = this.world;
    if (!w.player) return { ok: false, msg: '没有可保存的存档。' };
    const sid = id || ('save_' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
    return { ok: true, id: sid, msg: '快照已生成。', data: w.serialize() };
  }

  /**
   * 从一份存档正文恢复世界（本地化的读路径：正文由客户端从 localStorage
   * 送回来）。收尾与 loadSave 完全同一套（重建指令表 / 教程别名 / 剧情补账），
   * 只是正文来源不同——别在两处各养一份收尾。
   */
  restoreFrom(data) {
    if (!data || typeof data !== 'object') return { ok: false, msg: '存档数据无效。' };
    try {
      this.world.deserialize(data, this.modLoader.getEnabledModList());
    } catch (e) {
      return { ok: false, msg: '存档无法读取：' + (e && e.message || e) };
    }
    registerBuiltinFns(this.world);
    this.cmds = buildCommands(this.world);
    /* ⚠️ 这里原来**漏了** `_wireTutorialAliases()` —— loadSave 会重建 cmds，
       教程别名表跟着被冲回手抄的老版本，同一次会话里「先读档再点引导」就漂了。
       现在统一收口到 _afterCmdBuild()（顺带做脚本指令的撞名检查）。 */
    this._afterCmdBuild();
    /* 老存档没有 `p.vars._storyBeat` 这笔账 —— 不补记，读档后第一条指令
       会把几十桩进行中的任务和当前教程章节一口气念一遍（剧情上屏的副作用）。
       读档＝「这些早讲过了」，补一笔账最省事也最不打扰。 */
    try { storybeat.markSeen(this.world, this.world.player); } catch (e) { /* ignore */ }
    return { ok: true, msg: '读档成功。', view: this.view({ map: false }) };
  }

  loadSave(id) {
    const s = this.readSave(id);
    if (!s) return { ok: false, msg: '存档不存在。' };
    return this.restoreFrom(s);
  }

  deleteSave(id) {
    const fp = path.join(this.saveDir, id + '.json');
    try { fs.unlinkSync(fp); return { ok: true }; } catch (e) { return { ok: false, msg: e.message }; }
  }

  /* ────────────────────────────────────────────────────────────────
   *  服务端兜底存档（_live）
   *
   *  病症（主人亲报）：「游戏过程中如果一段时间没操作，再点按钮时屏幕上出现
   *  『请先创建角色』，同时各属性变为零、玩家名字也消失了。」
   *
   *  根因两截：
   *    ① 线上沙箱**闲置会回收进程**。世界里的一切（包括 world.player）都在内存，
   *       重启后 `world.player` 就是 null —— 而玩家浏览器那一页还开着，
   *       于是下一条指令变成 `{lines:['请先创建角色'], view: 没有 player 的视图}`。
   *    ② 前端 `afterAction` **无条件** `S.view = d.view` —— 空视图把有角色的视图盖掉了，
   *       名字、属性当场清零（那半截在 ui.js 的 applyView 里修）。
   *
   *  这一对方法是第 ① 截的答案：定期把当前世界落到 `saves/_live.json`，
   *  进程重启后第一次收到请求时先把它接回来 —— 玩家**感觉不到断过**。
   *  ⚠️ 与玩家的 autosave_<device> 不是一回事：那是玩家的档（要出现在读取列表里），
   *     这是服务端的安全带（不该出现在列表里，也不该被玩家手动读到旧数据）。
   * ──────────────────────────────────────────────────────────────── */
  saveLive() {
    if (!this.world.player) return { ok: false, msg: '还没起局，没什么可兜的。' };
    return this.save(LIVE_SLOT);
  }

  /** 进程重启后把玩家接回来。已经有玩家就什么都不做（幂等）。 */
  restoreLive() {
    if (this.world.player) return { ok: false, msg: '局中有人在，不用接。' };
    if (!this.readSave(LIVE_SLOT)) return { ok: false, msg: '没有兜底档。' };
    const r = this.loadSave(LIVE_SLOT);
    if (!r.ok) return r;
    /* 读档后关系字段要重打（与 boot(saveId) 同一条规矩，见 restoreRelations 注释） */
    try { this.restoreRelations(); } catch (e) { /* 关系重建失败不该把人挡在门外 */ }
    return r;
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
      itemTypes: ['weapon', 'armor', 'helmet', 'boots', 'gloves', 'necklace', 'ring', 'cloak', 'shield', 'accessory', 'consumable', 'food', 'herb', 'material', 'book', 'tool', 'container', 'treasure', 'quest', 'misc'],
      /* 「手持」在册（木瓢案 2026-10-17）：tool 类物品可配自定义槽位（如木瓢的
         slot:'手持'），equipItem 认任意 def.slot——参考表漏了它，mod 作者
         照表填写会以为 tool 不能装备。展示侧走 w.equipSlots 动态并集。 */
      slots: ['头部', '颈部', '身体', '披风', '手部', '脚部', '武器', '副手', '戒指', '饰品', '手持'],
      stats: ['atk', 'def', 'dodge', 'parry', 'speed', 'maxHp', 'maxMp', 'critRate', 'lifesteal', 'reflect', 'armorPen'],
      effectTypes: [
        'say', 'me', 'narrate', 'log', 'hint', 'warn',
        '+money', '-money', '+exp', '-exp', '+pot', '-pot', '+hp', '-hp', '+mp', '-mp', 'heal', 'fullheal', '+karma',
        '+item', '-item', 'randomitem', '+rep', '-rep',
        '+skill', 'learnskill', 'learn', 'forgetskill', '+attr', '-attr', '+perk', '+trait', '+title',
        /* `favor` 是「给指定 NPC 加好感」——引擎早就支持（modapi 的 case 'favor'），
           但没列进这张库 ⇒ 作者根本不知道有它（本批的支线全靠它发好感）。 */
        'favor',
        'goto', 'teleport', 'spawn', 'despawn',
        'quest', 'questdone', 'flag', 'unflag', 'var', 'incvar', 'decvar',
        'combat', 'die', 'menu', 'dialog', 'ending', 'sound', 'sleep',
        'joinSect', 'leaveSect', 'promote', 'fn'
      ],
      condKeys: ['flag', 'notFlag', 'var', 'level', 'money', 'exp', 'pot', 'hp', 'mp', 'karma', 'kills', 'age', 'attr', 'skill', 'skills', 'item', 'noItem', 'count', 'gender', 'line', 'lineNot', 'fromMod', 'birth', 'act', 'race', 'sect', 'sectNot', 'noSect', 'hasSect', 'rank', 'title', 'hasPerk', 'hasTrait', 'room', 'region', 'time', 'season', 'weather', 'quest', 'stage', 'questDone', 'chance', 'rep', 'and', 'or', 'not', 'always', 'fn'],
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
      /* 物品类型 / 装备属性的中文名：**引用 commands 那一份**。
      （原来这里抄了一份字面量，而 commands 的 describeItem 却在调一个不存在的 typeCN()
        ⇒ 任何带 type 的物品一「细看」就 ReferenceError。两份表就是漂移的开始。） */
      statCN: commandsModule.EQUIP_STAT_CN,
      itemTypeCN: commandsModule.ITEM_TYPE_CN,
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

    /* ============================================================
     * 剧情 / 对话归一化 —— 「制作器填的字段」到「引擎读的字段」之间那道桥
     *
     * 为什么必须有一段专门的归一化（2026-10-11 实测，三处**静默失效**）：
     *   ① 制作器把「完成时效果」写在 `stage.onDone`，而引擎读的是 `stage.effects`
     *      ⇒ 那句效果**永远不触发**，而且不报错。
     *   ② 制作器的奖励是**对象** `{exp, pot, money, items}`，引擎的 rewards 是
     *      **效果数组** `[{type:'+exp',args:[n]}]` ⇒ `evalEffects({exp:100})`
     *      得到一个 `type` 为 undefined 的壳 → 奖励一点不发。
     *   ③ 对话节点的选项在制作器里是**文本**（`我愿闻其详 -> n2`），引擎却直接
     *      `nd.options.filter(...)` ⇒ **TypeError**（玩家一进那个节点就崩）。
     * 这三条合起来的意思是：**制作器做出来的剧情是「填了等于没填」**。
     * ============================================================ */
    const toArr = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]));

    /* ============================================================
     * 条件文本 → 条件对象
     *
     * 制作器的「学习条件 / 加入条件 / 接取门槛」都是**自由文本**输入框，
     * 而 `evalCond` 只认对象（或它的两种简写）。原来的后果：
     *   · 作者写 `line=orthodox` → evalCond 走字符串兜底 →
     *     **当成 flag 名去查**（`{flag:'line=orthodox'}`）→ 永远不成立；
     *   · 作者写 `悟性>=20`（提示里就是这么写的！）→ 走 `{'悟性>=':20}` 分支 →
     *     最后落到 `fieldValue` 的 default → `p.getVar('悟性')` = 0 → 也永远不成立。
     *   ⇒ 「填了等于没填」。
     * 这里把它翻成引擎真正认的对象：
     *   `line=orthodox`      → {line:'orthodox'}
     *   `act>=3`             → {act:'>=3'}
     *   `flag:know_depot`    → {flag:'know_depot'}
     *   `悟性>=20`            → {attr:'悟性','>=':20}     ← 属性必须走 attr 分支
     *   多个用 `&&` / `,` 连 → {and:[…]}
     * ============================================================ */
    const ATTR_NAMES = ['力量', '根骨', '身法', '悟性', '定力', '福缘', '资质'];
    const parseRequireText = (str) => {
      const txt = String(str).trim();
      if (!txt) return undefined;
      const parts = txt.split(/\s*(?:&&|,|，|;|；)\s*/).filter(Boolean);
      const conds = [];
      for (const part of parts) {
        /* flag:xxx / notFlag:xxx */
        let m = part.match(/^(notFlag|flag)\s*[:：]\s*(\S+)$/i);
        if (m) { conds.push(m[1].toLowerCase() === 'notflag' ? { notFlag: m[2] } : { flag: m[2] }); continue; }
        /* a>=n / a<n / a==v … */
        m = part.match(/^([^\s<>=!]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
        if (m) {
          const k = m[1].trim(), op = m[2], v = m[3].trim();
          if (ATTR_NAMES.indexOf(k) >= 0) conds.push({ attr: k, [op]: /^-?\d+(\.\d+)?$/.test(v) ? parseFloat(v) : v });
          else conds.push({ [k]: op + v });
          continue;
        }
        /* a=v（等值，如 line=orthodox / gender=female） */
        m = part.match(/^([^\s=]+)\s*=\s*(.+)$/);
        if (m) { conds.push({ [m[1].trim()]: m[2].trim() }); continue; }
        /* 裸词 → 当成 flag */
        conds.push({ flag: part });
      }
      if (!conds.length) return undefined;
      return conds.length === 1 ? conds[0] : { and: conds };
    };
    /** 把任意形态的 require 归一成条件对象（对象原样带走，文本解析成对象） */
    const normRequire = (v) => {
      if (v == null || v === '') return undefined;
      if (typeof v === 'object') return Object.keys(v).length ? v : undefined;
      return parseRequireText(v);
    };

    /* 奖励：对象 → 效果数组（已经是数组的原样带走） */
    const normRewards = (q) => {
      if (Array.isArray(q.rewards)) return q.rewards;
      const r = q.rewards || {};
      const outR = [];
      const num = (v) => (v === '' || v == null ? 0 : Number(v) || 0);
      if (num(r.exp)) outR.push({ type: '+exp', args: [num(r.exp)] });
      if (num(r.pot)) outR.push({ type: '+pot', args: [num(r.pot)] });
      if (num(r.money)) outR.push({ type: '+money', args: [num(r.money)] });
      if (num(r.karma)) outR.push({ type: '+karma', args: [num(r.karma)] });
      for (const it of toArr(r.items)) if (it) outR.push({ type: '+item', args: [String(it), 1] });
      return outR;
    };

    /* 单个任务：阶段 kind/key → targets；onDone → effects；奖励对象 → 效果数组 */
    const normQuest = (q) => {
      const o = Object.assign({}, q);
      o.rewards = normRewards(o);
      o.require = normRequire(o.require);
      delete o.rewardsItems;
      o.stages = toArr(o.stages).map((st, si) => {
        const s2 = Object.assign({}, st);
        /* ① 前端 stages 用 {desc, kind, key, count}，引擎 targets 用 [{id,kind,key,count,desc}]。
             补 `id` 是为了让计数变量名可读 —— 不补的话是 `q_<qid>_undefined`。 */
        if (!s2.targets && s2.kind && s2.key) {
          s2.targets = [{
            id: 't' + si, kind: s2.kind, key: s2.key,
            count: s2.count != null && s2.count !== '' ? Number(s2.count) || 1 : 1,
            desc: s2.desc || '',
          }];
        }
        /* 目标数组也要补 id（同上） */
        if (Array.isArray(s2.targets)) {
          s2.targets = s2.targets.map((t, ti) => Object.assign({ id: 't' + ti }, t));
        }
        /* ② 「完成时效果」的历史字段名迁移：onDone → effects（老存档/老 spec 照样能跑） */
        if (!s2.effects && s2.onDone) s2.effects = s2.onDone;
        delete s2.onDone;
        /* effects 允许写成字符串（`say:xxx`）—— evalEffects 认字符串，原样带走即可 */
        return s2;
      });
      return o;
    };
    out.quests = toArr(out.quests).map(normQuest);
    /* ⚠️ `stories` 是历史别名（buildModFiles 原来只认它）。两条路都归一，
       合并放在 buildModFiles 里做，免得这里改了那边漏。 */
    out.stories = toArr(out.stories).map(normQuest);
    /* 武学 / 门派 / 人物 / 物品的 `require` 在制作器里同样都是**文本输入框** ⇒ 一并归一 */
    for (const k of ['skills', 'sects', 'npcs', 'items']) {
      out[k] = toArr(out[k]).map((x) => {
        const o = Object.assign({}, x);
        o.require = normRequire(o.require);
        return o;
      });
    }

    /* 对话：节点选项「文本 → 结构化」
       文本格式：`选项文字 -> 下一节点ID 或 效果`
       判据：右值**在同对话的节点 id 集合里**才算 next，否则当效果（`-> kill` 是开战效果）。
       ⚠️ 必须先把整份对话的节点 id 收全再解析 —— 顺序反过来就会把 `n2` 当效果。 */
    const normDialogues = (arr) => toArr(arr).map((d) => {
      const o = Object.assign({}, d);
      const nodes = toArr(o.nodes);
      const ids = {};
      for (const n of nodes) if (n && n.id) ids[String(n.id)] = 1;
      o.nodes = nodes.map((n) => {
        const n2 = Object.assign({}, n);
        if (typeof n2.options === 'string') {
          n2.options = n2.options.split(/\n+/).map(x => x.trim()).filter(Boolean).map((line) => {
            const m = line.match(/^(.*?)\s*(?:->|→|=>)\s*(\S+)\s*$/);
            if (!m) return { label: line, next: '' };
            const label = m[1].trim() || line;
            const rhs = m[2].trim();
            return ids[rhs] ? { label, next: rhs } : { label, effect: rhs };
          });
        } else if (Array.isArray(n2.options)) {
          n2.options = n2.options.map(o2 => (typeof o2 === 'string' ? { label: o2, next: '' } : o2));
        }
        return n2;
      });
      return o;
    });
    out.dialogues = normDialogues(out.dialogues);

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
    /* 剧情
       ⚠️ 必须**同时**认 `spec.quests` 与 `spec.stories`：
       制作器的剧情页遍历/新建的是 `spec.quests`（modmaker.js 的 tabStories），
       而这里原来只写 `spec.stories` ⇒ **用制作器做的任务与对话一个都没进 mod.json**
       （导出的包里连 `quests` 键都没有）。这是「填了等于没填」里最彻底的一种。 */
    const questSrc = [].concat(spec.quests || [], spec.stories || []);
    const seenQ = {};
    const questBind = [];     // {npcId, qid} —— 等 NPC 块写完再挂（同对话的理由）
    for (const s of questSrc) {
      const id = s.id || slug(s.name);
      if (!id || seenQ[id]) continue;      // 同 id 只写一次（quests 在前，优先）
      seenQ[id] = 1;
      /* ⚠️ 写了 `giver` 就必须同时把这条任务挂进那个 NPC 的 `quests` 数组。
         不挂的话：接任务接得到（accept 走全局 fuzzyFind），
         但**交任务时 NPC 身上没有这条 → 「这里没有人等待你的复命」**，
         任务永远完不成（实测踩到）。这类「一半接得上、一半接不上」最容易被忽略。 */
      const giverId = s.giver || s.npc;
      if (giverId) questBind.push({ npcId: giverId, qid: id });
      bucket('quests')[id] = {
        id, name: s.name, type: s.type || '支线', level: s.level || 1,
        desc: s.desc || '',
        giver: s.giver || s.npc || undefined,
        require: s.require && Object.keys(s.require).length ? s.require : undefined,
        requireMsg: s.requireMsg || undefined,
        stages: [].concat(s.stages || []).map(st => {
          const o = {
            desc: st.desc || '',
            cond: st.cond && Object.keys(st.cond).length ? st.cond : undefined,
            targets: (st.targets || []).length ? st.targets : undefined,
            effects: st.effects || undefined,
            next: st.next,
            /* 主线分化（design/67 §5）的三件套 —— 不透传等于制作器做不出分化剧情 */
            lock: st.lock || undefined,
            descByLine: st.descByLine || undefined,
            descByGender: st.descByGender || undefined,
            targetsByGender: st.targetsByGender || undefined,
            targetsByLine: st.targetsByLine || undefined,
            effectsByGender: st.effectsByGender || undefined,
          };
          /* 只留真正有值的键（其余 delete，免得包里全是 undefined） */
          for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
          return o;
        }),
        rewards: s.rewards && s.rewards.length ? s.rewards : undefined,
      };
      /* 挂在任务上的对话（历史写法） */
      if (s.dialogue && s.dialogue.nodes) bucket('dialogues')[id + '_dlg'] = Object.assign({ id: id + '_dlg' }, s.dialogue);
    }
    /* 独立对话树（制作器有单独的「对话树」页，绑定 `spec.dialogues`）
       ⚠️ 这里原来**根本没有对 spec.dialogues 的循环** ⇒ 整页对话被丢掉。
       另外：对话要能触发，必须**挂到某个 NPC 的 `dialog` 字段**上
       （引擎读 `w.data.dialogues[def.dialog]`，见 commands.js 的 talk）。
       制作器里填了「绑定人物」，这里就得把那根线接上 —— 不接，对话就是一堆死数据。 */
    const dlgList = [].concat(spec.dialogues || []);
    const dlgBind = [];      // {npcId, dlgId} —— 等 NPC 块写完再挂（见下面的注释）
    for (const d of dlgList) {
      const id = d.id || slug(d.name);
      if (!id) continue;
      bucket('dialogues')[id] = {
        id, name: d.name || id, start: d.start || 'n1',
        nodes: [].concat(d.nodes || []).map(n2 => {
          const o = Object.assign({}, n2);
          for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === '') delete o[k];
          return o;
        }),
      };
      const npcId = d.npc || d.giver;
      if (npcId) dlgBind.push({ npcId, dlgId: id });
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
    /* ⚠️ 对话挂 NPC 必须在**这一块之后**做：
       上面是 `bucket('npcs')[id] = {...}`（整条赋值，不是合并），
       先挂会被这里覆盖掉 —— 于是「对话建好了、也绑了人物，进游戏却触发不了」。 */
    for (const b of dlgBind) {
      if (!manifest.npcs) manifest.npcs = {};
      if (!manifest.npcs[b.npcId]) manifest.npcs[b.npcId] = { id: b.npcId };
      manifest.npcs[b.npcId].dialog = b.dlgId;
    }
    /* ⚠️ 同理：把任务挂进委托人的 `quests`（不挂 ⇒ 交任务时「这里没有人等待你的复命」） */
    for (const b of questBind) {
      if (!manifest.npcs) manifest.npcs = {};
      if (!manifest.npcs[b.npcId]) manifest.npcs[b.npcId] = { id: b.npcId };
      const arr = manifest.npcs[b.npcId].quests || (manifest.npcs[b.npcId].quests = []);
      if (arr.indexOf(b.qid) < 0) arr.push(b.qid);
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
