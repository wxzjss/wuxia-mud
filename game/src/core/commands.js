/**
 * commands.js — 指令系统
 *
 * 高自由度：
 *  - 所有指令都在这里注册，mod 可通过 customCommands 添加新指令
 *  - 支持中英文混用、指令缩写、模糊匹配
 */
'use strict';

const { tokenize, fuzzyFind, clamp, fmtTime, shichen, stars } = require('./utils');
const { evalCond, evalEffects, evalTemplate } = require('./modapi');
const social = require('./social');
const marriage = require('./marriage');
const kinship = require('./kinship');
const homeMod = require('./home');
const workMod = require('./work');
const gather = require('./gather');
const farm = require('./farm');
const personality = require('./personality');
/* B11：第三人称人称代词 / 性别的**单一入口**（他/她/它、男/女/不明）。
   全仓按性别渲染人称的地方一律走这里，别各自 `female?'女':'男'` 兜底。 */
const { pronounOf, genderNoun } = require('./pronouns');
const sectFounder = require('./sectFounder');
const estateMod = require('./estate');
const kidnapMod = require('./kidnap');

/* 中文数字 → 阿拉伯 */
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 拾: 10 };
function cnNum(s) {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUM[s] !== undefined) return CN_NUM[s];
  // 十二 / 三十 / 二十四
  const m = String(s).match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  return NaN;
}

const DIRECTIONS = {
  n: 'n', s: 's', e: 'e', w: 'w', u: 'u', d: 'd', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw',
  北: 'n', 南: 's', 东: 'e', 西: 'w', 上: 'u', 下: 'd', 北东: 'ne', 东北: 'ne', 西北: 'nw', 西南: 'sw', 东南: 'se',
  north: 'n', south: 's', east: 'e', west: 'w', up: 'u', down: 'd',
  出门: 'out', 进: 'in', 入: 'in', 外: 'out',
};
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下', ne: '东北', nw: '西北', se: '东南', sw: '西南', in: '内', out: '外' };

/* ------------------------------------------------------------------ *
 * 「看人」的两个共用口径 —— **模块顶层**（不是 buildCommands 的闭包内）
 *
 * 为什么要搬到顶层：`skillTierCN` / `npcInsight` 以前写在 buildCommands 内部，
 * 外面拿不到。而 NPC 详情面板（`engine.npcProfileOf`）与武学面板（`ui.js`）
 * 都要显示「他这门练到第几层」「交情够不够看透」——
 * 拿不到就会各自**再实现一遍**，迟早和「看」这条指令漂移
 * （本项目老毛病：同一件事两份实现，改一处忘一处）。
 * 搬到顶层 + 从 `__api` 导出，全项目只有一个口径。
 * ------------------------------------------------------------------ */
/** 看透别人武功到第几层：要靠交情。陌生人是看不出来的。 */
function npcInsight(npc) {
  const favor = npc.favor || 0;
  const trust = (npc.pstate && npc.pstate.trust) || 0;
  /* 打过交道、交情好、或揪住过他的把柄，才谈得上「看得出深浅」 */
  if (favor >= 40 || trust >= 30) return { deep: true, hint: '' };
  if (favor >= 15 || trust >= 10) return { deep: false, hint: `交情尚浅，看不透${pronounOf(npc)}的火候` };
  return { deep: false, hint: `你们素不相识，看不出${pronounOf(npc)}究竟练到了哪一步` };
}

/* 熟练度分级名（与功法体系一致） */
const SKILL_TIERS = ['初学', '入门', '小成', '熟练', '精通', '化境', '登峰'];
function skillTierCN(lv) {
  if (!lv || lv <= 0) return '未入门';
  if (lv >= 900) return '登峰造极';
  if (lv >= 700) return '化境';
  if (lv >= 500) return '精通';
  if (lv >= 300) return '熟练';
  if (lv >= 150) return '小成';
  if (lv >= 60) return '入门';
  return SKILL_TIERS[0];
}

function buildCommands(world) {
  const CMD = {};

  const reg = (names, fn, meta) => {
    const list = [].concat(names);
    for (const n of list) CMD[n] = Object.assign({ names: list, run: fn }, meta || {});
  };

  /* ---------------- 基础 ---------------- */

  reg(['help', '?', '帮助', '指令'], (ctx) => {
    const lines = [];
    lines.push({ kind: 'title', text: '【 指令一览 】' });
    const groups = {
      '移动': ['n/s/e/w/u/d/ne/nw/se/sw（或 北/南/东/西/上/下）', 'look / l 看', 'go <方向|房间名>', 'map 查看地图', 'where 定位', '爬山坡 / 跳崖 / 渡河（看四周时提示的互动出口）'],
      '查看': ['look <目标> 观察', 'score / sc 查看自身', 'skills 武学', 'attr 属性', 'inventory / i 背包', 'equipment / eq 装备', 'quests 任务', 'affects 状态', 'time 时间'],
      '行动': ['say <话> 说话', 'me <动作> 动作', 'shout <话> 喊话', 'tell <人> <话> 密语', 'emote'],
      '物品': ['get <物品> 拾取', 'drop <物品> 丢弃', 'use <物品> 使用', 'wear/wield <物品> 装备', 'remove <部位> 卸下', 'give <物品> to <人>'],
      '武学': ['learn <武学> 学', 'train / lian <武学> 练功', 'enable <槽位> <武学> 装备武学', 'perform / pf <武学> 施展绝招', 'skills 查看'],
      '战斗': ['kill / fight <目标> 攻击', 'flee 逃跑', 'auto 自动战斗'],
      '交互': ['talk <人> 交谈', 'ask <人> about <话题>', '打听 [关键词] 打听江湖传闻', '拜访 <人> 上门拜访（交情够了才进得去）', 'buy <物品> from <人>', 'sell <物品>', 'trade'],
      '门派': ['sect 门派信息', 'join <门派> 拜师', 'leave 脱离门派', 'promote 升职', 'contribute'],
      '营生': ['work / 打工 打工赚钱（酒楼/药店）', '卖身 卖身青楼换银（仅女子）', '接客 应酬攒赎身钱（卖身后）', '赎身 凑钱脱籍', '身世 查看营生/卖身状态'],
      '采集/农事': ['打水 水源边打水解渴（需容器）', '切割 切野兽尸体取肉皮（需利器）', '加工 客栈/酒楼把生肉做熟', '买地 田头佃户家置田', '种植 <稻种|菜种>', '收割 收成熟庄稼', '偷庄稼 偷别人田（会被通缉）'],
      '任务': ['quest 任务列表', 'accept <任务>', 'abandon <任务>', 'report 交任务'],
      '系统': ['save 存档', 'load 读档', 'settings 设置', 'mods mod 管理', 'clear 清屏', 'nick <称号>', 'quit / 退出游戏 退出到主菜单（会自动存档）'],
      '掳人/奴仆': [
        '装人 <人名> 把晕倒的人装进麻袋（无目击者才不惊动官府）',
        '麻袋 看袋里关着谁',
        '放人 <第几袋> 放人出来',
        '赎回 <人名> 青楼/黑市赎人',
        '卖人 <人名> 卖进地下场所（知情转卖，重罪）',
        '买奴 <人名> 黑市买奴（受家资名额限制）',
        '奴册 看麻袋/奴/护院/恶名',
        '使唤 <人名> <做工|采买|跑腿|洗衣> 派活',
        '跟随 <人名> 邀人跟随（须好感过 60）',
        '雇护院 <人名> 看家护院（须在宅院，日薪要付）',
        '发工钱 结清护院工钱',
        '监督 <人名> 派护院盯着奴干活',
        '赎身 在青楼/黑市赎身（不在那儿则无事）',
        '突围 打出去（武力够强才成）',
        '还债 打工还债',
      ],
    };
    for (const g of Object.keys(groups)) {
      lines.push({ kind: 'subtitle', text: g });
      for (const c of groups[g]) lines.push({ kind: 'plain', text: '  ' + c });
    }
    lines.push({ kind: 'hint', text: '提示：很多指令支持中文，如「往北走」「看」「查看背包」。也支持点击界面上按钮操作。' });
    return { lines };
  });

  /* ---------------- 移动 ---------------- */

  /* ================================================================
   * B5 · 交战中不许移动（主人亲报：「战斗界面我依然能走，
   * 甚至带着和山贼的战斗界面能一路走回客栈」）
   *
   * 根因：doMove 此前**完全没有战斗态检查**，方向键 / go / 走 / 去 /
   * 「往北走」/ 房间名 / 互动出口（爬山坡·渡河）全都从这里直通
   * movePlayerTo，于是交战中一步一个脚印地走回了客栈。
   *
   * 为什么收敛在 doMove 一处而不是逐个入口打补丁：
   *   所有「玩家自主位移」的路径**最终都调用 doMove** ——
   *   方向键注册表（第 142 行）、go/去/前往/走（第 149 行）、
   *   go <房间名> 的逐跳寻路（第 180 行）、execute 的纯方向分支
   *   （第 2520/2521 行）、房间名匹配（第 2553 行）、
   *   互动出口 via/hint（第 2564 行）。堵doMove 一处即全覆盖。
   *
   * 战斗态读哪个字段（铁律：先打真实结构再写，别猜）：
   *   实测 world 的键里同时有 `combat` 和 `battle`，但
   *   `world.combat` 是 **CombatEngine 实例**（构造函数 combat.js），
   *   `world.battle` 才是**本局战斗的对象**（startCombat/startDuel 里
   *   赋值，finishCombat/flee 里置 null）。战斗态 = !!w.battle，
   *   与 commands.js 里既有的 perform/flee/auto 判据完全一致。
   *
   * 为什么不封 movePlayerTo：那条路还接着**非玩家自主**的位移 ——
   *   拜访上门（919行）、modapi 的 teleport/warp、survival 死亡回客栈。
   *   锁在 movePlayerTo 会把「战斗中被 NPC 拖走/死亡送医」也一起锁死。
   * ================================================================ */
  const COMBAT_MOVE_HINT =
    '你正与人交手，走不脱！想脱身得先把这桩了结：'
    + '「kill <目标>」或「auto」进攻、「perform <武学>」使绝招、'
    + '「defend」凝神防守，或「flee」逃跑。';

  const doMove = (ctx, dir) => {
    const p = ctx.player, w = ctx.world;
    /* ⚠️ 必须在任何位移/时间消耗之前就拦下来，
       否则「advanceTime + movePlayerTo」都已经生效了。 */
    if (w.battle) {
      return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    }
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你似乎迷失在了虚空之中。' }] };
    const exits = room.exits || {};
    let target = null, usedDir = dir;
    if (exits[dir]) target = typeof exits[dir] === 'string' ? exits[dir] : exits[dir].to;
    if (!target) {
      // 尝试用房间名匹配出口
      for (const d of Object.keys(exits)) {
        const ex = exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        if (tr && (tr.name === dir || tr.name.includes(dir))) { target = tid; usedDir = d; break; }
      }
    }
    if (!target) {
      const dirs = Object.keys(exits).map(d => DIR_CN[d] || d).join('、');
      return { lines: [{ kind: 'warn', text: `这个方向过不去。可去的方向有：${dirs || '无'}` }] };
    }
    const ex = exits[usedDir];
    // 出口条件
    if (ex && ex.cond) {
      if (!evalCond(ex.cond, ctx)) return { lines: [{ kind: 'warn', text: ex.msg || '那边似乎有什么阻挡着你。' }] };
    }
    if (ex && ex.exits && ex.exits.msg) { /* continue */ }
    // 移动消耗
    const cost = (ex && ex.cost) || 1;
    // 青楼卖身者活动范围限制（离青楼太远会被老鸨盯住）
    if (p.prostitution && p.prostitution.sold && !workMod.withinBrothelRange(w, target)) {
      return { lines: [{ kind: 'warn', text: '你如今是青楼之人，老鸨盯得紧，不能擅离太远。' }] };
    }
    p.advanceTime(cost);
    const r = w.movePlayerTo(p, target);
    /* B13 连带收尾：movePlayerTo 对「目标不存在」返回 {ok:false}（它自己是对的），
       但 doMove 此前**忽略**了返回值、照样报 moved:true —— 万一出口指向幽灵房，
       玩家会「没动却提示已移动」。这里补上防御（正常数据下永不为真：map-check 已禁悬空出口）。 */
    if (!r || !r.ok) return { lines: [{ kind: 'warn', text: (r && r.msg) || '那边似乎走不通。' }] };
    const lines = [];
    if (ex && ex.travel) lines.push({ kind: 'story', text: ex.travel });
    const view = lookRoom(ctx);
    lines.push(...view.lines);
    return { lines, moved: true };
  };

  for (const k of Object.keys(DIRECTIONS)) {
    const dir = DIRECTIONS[k];
    if (!dir) continue;
    reg([k], (ctx) => doMove(ctx, dir), { silent: true });
  }
  reg(['go', '去', '前往', '走'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想去哪里？' }] };
    const p = ctx.player, w = ctx.world;
    const kw = args.join(' ');
    const d = DIRECTIONS[kw];
    if (d) return doMove(ctx, d);
    // 按房间名找（同区域 / 相邻）
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你似乎不在一个真实所在，辨不清方向。' }] };
    const cands = [];
    for (const dir of Object.keys(room.exits || {})) {
      const ex = room.exits[dir];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(tid);
      if (tr) cands.push({ room: tr, dir });
    }
    const hit = cands.find(c => c.room.name.includes(kw) || kw.includes(c.room.name));
    if (hit) return doMove(ctx, hit.dir);
    // 全局房间名搜索（只在已探索区域，或直接给出路径提示）
    const allRooms = Object.values(w.data.rooms);
    const gh = fuzzyFind(allRooms, kw, r => r.name);
    if (gh) {
      /* ⚠️ 必须传 ctx：不传就是「无视门禁」的旧 BFS，
         玩家一句 `go 太和殿` 会直接瞬移进皇宫，把 ex.cond 全绕过去。 */
      const path = findPath(w, p.room, gh.id, ctx);
      if (path && path.length) {
        /* B5：逐跳寻路也得先探战斗态。doMove 里虽然也拦，
           但那时已经打出了「你沿路前往X…」的过场语，再撤回反而绕。
           这里提前拦一次，提示才干净（也不会谎报 moved:true）。 */
        if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
        const lines = [{ kind: 'sys', text: `你沿路前往${gh.name}…` }];
        for (const step of path) {
          /* 逐跳走方向（走 doMove 才对），而不是 movePlayerTo 瞬移：
             doMove 才会检查 ex.cond / 卖身范围 / 时间成本。 */
          const cur = w.getRoom(p.room);
          let dir = null;
          for (const d of Object.keys(cur.exits || {})) {
            const e2 = cur.exits[d];
            if ((typeof e2 === 'string' ? e2 : e2.to) === step) { dir = d; break; }
          }
          if (!dir) break;
          const mv = doMove(ctx, dir);
          for (const l of (mv && mv.lines) || []) {
            /* 中间每一跳的房间描述太长，只留第一跳的 travel 文本 */
            if (l.kind === 'story') lines.push(l);
          }
          if (mv && mv.moved === undefined) { lines.push(...((mv.lines) || [])); break; }
        }
        lines.push(...lookRoom(ctx).lines);
        return { lines, moved: true };
      }
      if (gh.id === p.room) {
        return { lines: lookRoom(ctx).lines };
      }
      /* 门禁挡路时要说清楚是哪一道门，别只说「找不到路」 */
      const lockedMsg = lockedEdgeHint(w, p.room, gh.id, ctx);
      if (lockedMsg) return { lines: [{ kind: 'warn', text: lockedMsg }] };
      return { lines: [{ kind: 'warn', text: `似乎找不到通往${gh.name}的路。` }] };
    }
    return { lines: [{ kind: 'warn', text: `你不知道${kw}在哪里。` }] };
  });

  /* ---------------- 观察 ---------------- */

  /** 时刻 → 画像 routine 的 at 键（规格书 §1.2：day / night / dawn / dusk / meal） */
  function timeSlot(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    if (m < 300) return 'night';    // 子～寅 0:00-5:00
    if (m < 480) return 'dawn';     // 卯～辰 5:00-8:00
    if (m < 660) return 'day';      // 巳～午前 8:00-11:00
    if (m < 780) return 'meal';     // 午 饭点 11:00-13:00
    if (m < 1020) return 'day';     // 未～申 13:00-17:00
    if (m < 1140) return 'dusk';    // 酉 17:00-19:00
    return 'night';                 // 戌～亥 19:00-24:00
  }

  /** 取 NPC 当前时段正在做的那件事；没有 routine 就返回 null（呈现层完全不露） */
  function routineNow(npc, minutes) {
    const r = npc && npc.portrait && npc.portrait.routine;
    if (!r || !r.length) return null;
    const slot = timeSlot(minutes);
    const hit = r.find(x => x.at === slot) || r.find(x => x.at === 'day') || r[0];
    if (!hit || !hit.act) return null;
    return String(hit.act).replace(/[。.]+$/, '');   // 句号由调用方统一补
  }

  /** 乞丐 / 流民 / 平民 —— 「施舍行善」的判定对象（B22 rs_alms）。
   *  用**显式 tag** 判据，不扫名字（B8 之 BLK-2 教训）。 */
  function isPoor(npc) {
    const tag = npc && npc.def && npc.def.tag;
    return ['beggar', 'refugee', 'commoner', 'farmer'].indexOf(tag) >= 0;
  }

  /** 这个 NPC 名下**当前可接**的一条任务 id（没有则 null）。
   *  来源两层：`def.quests`（13 人有）与 `def.sidequest`（284 人有，此前是死字段 → B25）。
   *  过滤：任务必须真实存在（挡悬空指针，如 26 人指向的未落地 hk_*）、且尚未接取/完成。
   *  用**显式字段**判据，不猜名字/描述（B8 之 BLK-2 教训）。 */
  function availableQuestOf(ctx, npc) {
    if (!npc) return null;
    const w = ctx.world, p = ctx.player, def = npc.def || {};
    const ids = [];
    if (Array.isArray(def.quests)) for (const q of def.quests) ids.push(q);
    if (def.sidequest) ids.push(def.sidequest);
    for (const q of ids) {
      if (!q || !w.getQuest(q)) continue;
      if (p.questStage(q) >= 0) continue;   // 已在进行 / 已完成
      /* 前置未满足的不算「可接」（sidequest-land 实测：第二 hook 带 require.questDone，
         第一条进行中时会冒出「点下去＝你还不满足接取条件」的假入口 —— 违反「给不出的项不给」）。 */
      const qd0 = w.getQuest(q);
      if (qd0 && qd0.require && !evalCond(qd0.require, ctx)) continue;
      return q;
    }
    return null;
  }

  function lookRoom(ctx) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '这里一片虚无。' }] };
    const lines = [];
    lines.push({ kind: 'roomname', text: `【${room.name}】` });
    const region = w.getRegion(room.region);
    if (region) lines.push({ kind: 'plain', text: `(${region.name || room.region} · ${shichen(p.timeMinutes)} · 天色${w.weather})` });
    lines.push({ kind: 'desc', text: evalTemplate(room.desc || '', ctx) });

    /* ---- 世界动态 W6/W7 的外显（design/27 §3.3-6 地盘标识 / §4 节庆）----
       · 地盘：此地属某势力 → 一行「此处已是XX的地界」，势力越盛越明显。
       · 节庆：今日有节 → 一行提示，房间之外「街市比平日热闹」。
       两者都是**状态驱动**（读 factionState / day），不是写死进 desc —— 数据不动，观感变。 */
    if (typeof w.factionOfRegion === 'function' && room.region) {
      const fid = w.factionOfRegion(room.region);
      const fac = fid && w.factionState && w.factionState.factions[fid];
      if (fac) lines.push({ kind: 'plain', text: `此处是${fac.name}的地界，弟子往来，规矩森严（${fac.mood}）。` });
    }
    if (typeof w.festivalToday === 'function') {
      const fest = w.festivalToday();
      if (fest) lines.push({ kind: 'plain', text: `今日是${fest.name}，街上比平日热闹许多。` });
    }

    // NPC
    const npcs = w.npcsIncludingTemplates(p.room);
    if (npcs.length) {
      const cls = {};
      for (const n of npcs) {
        const k = n.name;
        cls[k] = (cls[k] || 0) + 1;
      }
      /* 名字后带身份（复用 npcIdentity：门派职位 / 捕快 / 郎中 / 寻常百姓…），
         跟 lookNpc / guanxi / favor 用的是同一套推断，不会两处口径打架。
         同名多人时只标一次身份（x2 分支不重复），且身份用第一个遇到的。 */
      const idOf = {};
      for (const n of npcs) { if (!idOf[n.name]) idOf[n.name] = npcIdentity(w, n); }
      const labelOf = k => {
        const id0 = idOf[k];
        return id0 ? `${k}（${id0}）` : k;
      };
      const out = Object.keys(cls).map(k => cls[k] > 1 ? `${labelOf(k)} x${cls[k]}` : labelOf(k));
      // hl：把每个 NPC 名标成可点，点击弹出「对它做什么」的中文菜单
      const hl = Object.keys(cls).map(k => {
        const one = npcs.find(n => n.name === k);
        const pron = pronounOf(one);   // B11：兽→它 / 女→她 / 男→他（单一入口）
        const def = (one && one.def) || {};
        const actions = [
          { label: '看看', cmd: 'look ' + k },
          { label: '交谈', cmd: 'talk ' + k },
          { label: '询问', cmd: 'ask ' + k },
        ];
        /* ---- 任务一：按情境给项 ----
           ⚠️ 铁律：给不出的项**一律不给** —— 点了没反应（或"这里没有…"）比没有按钮更出戏。
           判据一律用**显式字段**（def.quests / def.sidequest / def.teach / shop / tag），
           绝不扫 name/desc 关键词（B8 之 BLK-2 教训）。 */
        /* ① 有支线的才给「接他的事」：
              def.quests（13 人）或 def.sidequest（284 人，此前是死字段 → B25 接线）。
              已接过/已完成/悬空指针 → 不显示。 */
        const aq = availableQuestOf(ctx, one);
        if (aq) {
          const qd = w.getQuest(aq);
          actions.push({ label: '接他的事', cmd: 'accept ' + ((qd && qd.name) || aq), hint: qd ? qd.name : '' });
        }
        /* ② 能请教的才给「请教武学」 */
        if (def.teach) actions.push({ label: '请教武学', cmd: 'qingjiao ' + k });
        /* ③ 有铺子的才给「看看货物」 */
        if (one && one.shop) actions.push({ label: '看看货物', cmd: 'list ' + k });
        /* ④ 医者才给「求医」（tag=doctor，11 人） */
        if (def.tag === 'doctor') actions.push({ label: '求医', cmd: '求医 ' + k });
        /* ⑤ 识路的人（镖师/车夫/船夫）才给「问路」 */
        if (['escort', 'groom', 'boatman'].indexOf(def.tag) >= 0) actions.push({ label: '问路', cmd: '问路 ' + k });
        actions.push({ label: `送${pron}东西`, cmd: 'give ' + k });
        actions.push({ label: '查看关系', cmd: 'guanxi ' + k });
        /* B10（主人亲报：点 NPC / 野兽弹出来的菜单里没有「攻击」）：
           · cmd 用**真实的攻击指令** `attack` —— 批次 2 已把 attack 并入 kill
             （reg(['kill','fight','attack','杀','攻击','打'], …)，见本文件 kill 处理器），
             与手动敲「攻击 xxx」完全同一条路径，不另造分支。
           · 目标名照现有 actions 的写法用裸名 k（fuzzyFind 认这个名字），不另起口径。
           · 敌对 / 已交战者把「攻击」顶到最前（此刻玩家多半就是想打）；
             普通百姓 / 寻常人物也**照给**，只是压在最后（「查看关系」之后）——
             武侠世界本就能动手，后端从不拦「攻击谁」，把入口藏起来才是 B10 的病根；
             排最后纯粹为压低触屏误触（挨着「交谈」手指一滑就开打）。
           · ⚠️ 铁律 33：**绝不拿 n.hostile 当「不给攻击」的排除条件** ——
             它是模板常驻标记（山贼/野兽一出生 true、打输也不清）。这里只用它
             **排序**（优先给），不做任何「能不能打」的判定。 */
        const inBattle = !!(w.battle && w.battle.target === one);
        const hot = !!(one && (one.hostile || one.inCombat || inBattle));
        const attackAct = { label: '攻击', cmd: 'attack ' + k };
        if (hot) actions.unshift(attackAct); else actions.push(attackAct);
        /* 名字带上身份，点哪儿都是同一个目标（fuzzyFind 认「名字（身份）」的括号前缀） */
        return { text: labelOf(k), type: 'npc', actions };
      });
      lines.push({ kind: 'npcs', text: `这里有：${out.join('、')}。`, hl });
      /* ---- 倒地/晕倒的人（任务一）----
         ⚠️ 铁律 32：`npcsIn` 过滤 `!dead`，而打倒的人是 knockedOut+dead，
         所以「这里有：」里**看不到他们** —— 倒地相关一律走 `world.downedIn()`。
         给「补刀 / 搜身 / 装进麻袋」三个入口（各有真指令、点了有反馈）；
         没麻袋就不给「装进麻袋」（给了也是白发警告）。 */
      const downed = w.downedIn(p.room);
      if (downed.length) {
        const hasSack = p.countItem(kidnapMod.SACK_ID) >= 1;
        const dhl = downed.map(n => {
          const acts = [
            { label: '看看', cmd: 'look ' + n.name },
            { label: '补刀', cmd: 'kill ' + n.name, hint: '结果了他' },
            { label: '搜身', cmd: '搜身 ' + n.name, hint: '翻他身上的东西' },
          ];
          if (hasSack) acts.push({ label: '装进麻袋', cmd: 'pack ' + n.name, hint: '当众下手必被告发' });
          return { text: n.name, type: 'npc', actions: acts };
        });
        lines.push({ kind: 'npcs', text: `地上还躺着：${downed.map(n => n.name).join('、')}。`, hl: dhl });
      }
      /* ---- 画像 L0 看见 ----
         有画像的 NPC 额外给一句「此刻正在做什么」（routine 按当前时段取），
         而不是千篇一律的名字 + 身份。没画像的 NPC 完全保持原样。 */
      const acts = [];
      for (const n of npcs) {
        if (!n.portrait) continue;
        const act = routineNow(n, p.timeMinutes);
        if (act) acts.push(`${n.name}${act}`);
      }
      if (acts.length) lines.push({ kind: 'npcsact', text: acts.join('；') + '。' });
    }
    // 地面物品
    const items = w.itemsIn(p.room);
    if (items.length) {
      const names = items.map(i => { const d = w.getItem(i.itemId); return (d ? d.name : i.itemId) + ((i.count || 1) > 1 ? ` x${i.count}` : ''); });
      const hl = items.map(i => {
        const d = w.getItem(i.itemId);
        const nm = d ? d.name : i.itemId;
        return {
          text: nm, type: 'item',
          actions: [
            { label: '看看', cmd: 'look ' + nm },
            { label: '捡起', cmd: 'get ' + nm },
          ],
        };
      });
      lines.push({ kind: 'items', text: `地上散落着：${names.join('、')}。`, hl });
    }
    // 房间可交互物件（打铁 / 采药 / 钓鱼…）
    const acts = room.actions || [];
    if (acts.length) {
      const names = acts.map(a => a.label || (a.keywords || [])[0] || a.cmd).filter(Boolean);
      if (names.length) {
        const hl = acts.map(a => {
          const nm = a.label || (a.keywords || [])[0] || a.cmd;
          return {
            text: nm, type: 'action',
            actions: [{ label: (a.label || nm), cmd: a.cmd || nm, hint: a.desc || '' }],
          };
        }).filter(h => h.text);
        lines.push({ kind: 'action', text: `此地可做：${names.join('、')}。`, hl });
      }
    }
    // 尸体
    const corpses = w.corpsesIn(p.room);
    if (corpses.length) lines.push({ kind: 'items', text: `地上躺着：${corpses.map(c => c.name).join('、')}。` });
    // 出口：结构化（普通出口 → 方位图；互动出口 → 可点击互动）
    const exitMap = {};
    const viaExits = [];
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(tid);
      const toName = tr ? tr.name : '未知';
      const locked = !!(ex && typeof ex === 'object' && ex.locked);
      if (ex && typeof ex === 'object' && (ex.via || ex.hint)) {
        // 互动出口：需互动（爬山坡 / 渡河…）才能通过，点击互动词触发
        viaExits.push({
          dir: d, dirCN: DIR_CN[d] || d,
          via: ex.via || ex.hint || '障碍',
          hint: ex.hint || ex.via || d,
          desc: ex.desc || '隐隐通向外界',
        });
      } else {
        exitMap[d] = { dir: d, to: tid, name: toName, locked };
      }
    }
    lines.push({
      kind: 'exits',
      text: `出口：${Object.keys(exitMap).map(d => (DIR_CN[d] || d) + '·' + exitMap[d].name).join('　') || '无'}。`,
      exits: Object.keys(room.exits || {}),
      exitMap,
      /* 方向按钮排：以前这些按钮放在房间面板里（#exits），压在「此处可做」上面，
         跟日志里已经有的「出口」行功能重复。主人报「屏幕上有两个此地可做」，
         要求把方向按钮收到出口那块去 → 改成跟着「出口」行走（UI：ui.js renderLogText）。
         这里传全量出口数据（含 locked），比只给 dir 数组强。 */
      exitBtns: Object.keys(room.exits || {}).map(d => {
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        const tr = w.getRoom(tid);
        return {
          dir: d,
          name: DIR_CN[d] || d,
          toName: tr ? tr.name : '未知',
          locked: !!(ex && typeof ex === 'object' && ex.locked),
        };
      }),
      roomName: room.name,
    });
    // 互动出口：单独描述，互动词可点击
    for (const v of viaExits) {
      const dirWord = v.dir === 'u' ? '上方' : v.dir === 'd' ? '下方' : v.dir === 'in' ? '里面' : v.dir === 'out' ? '外面' : (v.dirCN + '边');
      lines.push({
        kind: 'via-exit',
        text: `${dirWord}有${v.via}，${v.desc}。`,
        hl: [{ text: v.via, type: 'via-exit', actions: [{ label: v.hint || ('向' + v.dirCN + '走'), cmd: v.hint || v.dir, hint: v.desc || '' }] }],
      });
    }
    // 房间自定义 look 效果
    if (room.onLook) {
      evalEffects(room.onLook, ctx).forEach(l => lines.push(l));
    }
    return { lines, room };
  }

  reg(['look', 'l', '看', '观察', '周围'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const kw = args.join(' ');
    if (!kw) return lookRoom(ctx);
    /* ⚠️ 先试房间交互物件（告示/井/床/柜…）。
       主人报：客栈「此地可做」列着「看告示」，点下去却说「这里没有「看告示」」。
       真凶是 normalizeCmd 的「看X」口语规则 —— 它把 action 的 cmd「看告示」
       改写成了 `look 告示`，房间 actions 的 cmd 匹配（严格相等）就废了，
       于是落到这里报「这里没有」。按钮发的是 a.cmd，不是玩家手输的口语，
       所以这条路径必须能认 action 的 cmd / keyword。 */
    const roomNow = w.getRoom(p.room);
    for (const a of (roomNow && roomNow.actions) || []) {
      const hit = a.cmd === kw || (a.keywords || []).some(k => k && (kw === k || kw.includes(k)));
      if (!hit) continue;
      if (a.cond && !evalCond(a.cond, ctx)) {
        return { lines: [{ kind: 'warn', text: a.failMsg || '现在做不了这个。' }] };
      }
      /* B6：和 questKeyword 同一类问题 —— action 没有 effects 时
         evalEffects([]) 返回空数组，玩家「看 牢门」「看 槐树」
         得到的是**零行输出**（界面上一片空白，等同于按钮坏了）。
         这里给一句明确的落空说明。 */
      if (!a.effects || !a.effects.length) {
        return { lines: [{ kind: 'plain', text: `你细看了看，此处暂无更多可看的了。` }] };
      }
      return { lines: evalEffects(a.effects || [], ctx) };
    }
    // NPC
    const npcs = w.npcsIncludingTemplates(p.room);
    const npc = fuzzyFind(npcs, kw, n => n.name);
    if (npc) return { lines: lookNpc(ctx, npc) };
    // 物品（地面/背包/装备）
    const pool = [];
    for (const i of p.inventory || []) pool.push({ kind: 'inv', it: i });
    for (const i of w.itemsIn(p.room)) pool.push({ kind: 'ground', it: i });
    const defs = w.data.items;
    const hit = pool.find(x => { const d = defs[x.it.id || x.it.itemId]; return d && (d.name === kw || d.name.includes(kw)); });
    if (hit) return { lines: describeItem(ctx, hit.it.id || hit.it.itemId, hit.it) };
    // 出口 / 房间
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '这里一片虚无，四下都看不清。' }] };
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      if (DIR_CN[d] === kw || d === kw) {
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        return { lines: [{ kind: 'plain', text: `${DIR_CN[d] || d}边是${tr ? tr.name : '未知之处'}。${ex.desc || ''}` }] };
      }
    }
    const gh = fuzzyFind(Object.values(w.data.rooms), kw, r => r.name);
    if (gh) return { lines: [{ kind: 'plain', text: `【${gh.name}】${gh.desc || ''}` }] };
    return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
  });

  function lookNpc(ctx, npc) {
    const w = ctx.world;
    /* 括号里写**身份**（门派职位/捕快/郎中/寻常百姓…），不再写「江湖中人」 */
    const id0 = npcIdentity(w, npc);
    const lines = [{ kind: 'subtitle', text: `${npc.name}（${id0}）` }];
    /* 名人的称号另起一行，别跟身份混为一谈 */
    if (npc.title && npc.title !== id0 && npc.title.length > 3) {
      lines.push({ kind: 'plain', text: `江湖上人称${pronounOf(npc)}「${npc.title}」。` });
    }
    lines.push({ kind: 'desc', text: npc.desc || '看不出什么特别之处。' });
    /* ---- 画像 role → 「这是个什么人」的一句身份定位（任务三）----
       role 是画像里的**定位**（如「华山脚下独居的老药婆，采药、看病、也替人藏东西」），
       不是复述 desc —— 看人一眼就该看出对方是个什么人。128 位有画像的 NPC 全带 role。 */
    if (npc.portrait && npc.portrait.role) {
      lines.push({ kind: 'plain', text: `一眼看去，${evalTemplate(npc.portrait.role, ctx)}。` });
    }
    const def = npc.def || {};
    if (def.showLevel !== false) lines.push({ kind: 'plain', text: `看起来约 ${npc.level} 层修为。` });
    if (npc.hp < npc.maxHp) {
      const r = npc.hp / npc.maxHp;
      lines.push({ kind: 'plain', text: `${npc.name}似乎${r < 0.3 ? '已受重伤' : r < 0.6 ? '受了些伤' : '略有疲态'}。` });
    }

    /* ---- 装备：穿戴中的兵刃衣裳（主人要求：能看到 NPC 装备了什么）---- */
    if (def.showEquip !== false && npc.equipment) {
      const worn = [];
      for (const slot of Object.keys(npc.equipment)) {
        const iid = npc.equipment[slot];
        if (!iid) continue;
        const d = w.getItem(iid);
        worn.push(`${slot}·${d ? d.name : iid}`);
      }
      if (worn.length) lines.push({ kind: 'plain', text: `身上穿着：${worn.join('，')}。` });
    }

    /* ---- 随身物品：腰间钱袋 + 带在身上的家伙（主人要求）---- */
    if (def.showCarry !== false) {
      const carry = npc.carry || def.carry || null;
      const bag = [];
      const items = (carry && carry.items) || def.items || [];
      for (const x of [].concat(items || [])) {
        const iid = typeof x === 'string' ? x : (x && (x.id || x.itemId));
        if (!iid) continue;
        const d = w.getItem(iid);
        const cnt = typeof x === 'object' && x.count ? '×' + x.count : '';
        bag.push((d ? d.name : iid) + cnt);
      }
      const money = (carry && carry.money !== undefined) ? carry.money : def.money;
      if (money) bag.push(`${money} 文`);
      if (bag.length) lines.push({ kind: 'plain', text: `随身带着：${bag.join('，')}。` });
    }

    /* ---- 武学：装在身上的哪一门 + **练到第几层**（主人要求）----
       ⚠️ 看人也是有讲究的：交情不够只能看出「他会武」，看不明白练到什么
       程度。层级按好感/信任给（favor≥40 或 trust≥30 才给真话），
       否则只报「深不可测」。否则你摸一下岳不群的门派就全知道了。 */
    const insight = npcInsight(npc);
    if (def.showSkill !== false && npc.equippedSkills) {
      const ss = Object.keys(npc.equippedSkills).filter(k => npc.equippedSkills[k]).map(k => {
        const sid = npc.equippedSkills[k];
        const sd = w.getSkill(sid);
        if (!sd) return null;
        const lv = npc.learned && npc.learned[sid] ? (npc.learned[sid].level || 0) : 0;
        const tail = insight.deep ? `${sd.name}（${skillTierCN(lv)}）` : sd.name;
        return `${k}:${tail}`;
      }).filter(Boolean);
      if (ss.length) {
        lines.push({
          kind: 'plain',
          text: `${pronounOf(npc)}习有：${ss.join('，')}。` +
            (insight.deep ? '' : `　（${insight.hint}）`),
        });
      }
    }

    /* 其余会的武学（没装备但会）——让「深藏不露」的人也能看出底细 */
    if (def.showAllSkills === true && npc.learned) {
      const eq = new Set(Object.keys(npc.equippedSkills || {}).map(k => npc.equippedSkills[k]));
      const more = Object.keys(npc.learned).filter(sid => !eq.has(sid)).map(sid => {
        const sd = w.getSkill(sid);
        const lv = npc.learned[sid] ? (npc.learned[sid].level || 0) : 0;
        return sd ? `${sd.name}${lv ? `（${skillTierCN(lv)}）` : ''}` : null;
      }).filter(Boolean);
      if (more.length) lines.push({ kind: 'plain', text: `此外还习得：${more.join('，')}。` });
    }

    /* ---- 门下弟子（他有传人，说明本事不小）---- */
    if (Array.isArray(npc.disciples) && npc.disciples.length) {
      const names = npc.disciples.map(id => {
        const d = w.getNpc(id);
        return d ? d.name : id;
      }).filter(Boolean);
      if (names.length) lines.push({ kind: 'plain', text: `门下弟子：${names.join('、')}。` });
    }

    /* ---- 画像 L0 看见（单人细看也给一句当下动作）---- */
    const act = routineNow(npc, ctx.player.timeMinutes);
    if (act) lines.push({ kind: 'plain', text: `${npc.name}${act}。` });
    if (def.descAdd) lines.push({ kind: 'plain', text: def.descAdd });
    if (def.lookEffects) evalEffects(def.lookEffects, ctx).forEach(l => lines.push(l));
    return lines;
  }

  /* npcInsight / SKILL_TIERS / skillTierCN 已搬到模块顶层（见上方注释），
     这里不再重复定义 —— 两份定义就是漂移的开始。 */

  function describeItem(ctx, itemId, inst) {
    const w = ctx.world;
    const d = w.getItem(itemId);
    if (!d) return [{ kind: 'warn', text: '看不出这是什么。' }];
    const lines = [{ kind: 'subtitle', text: `${d.name}${d.type ? '（' + typeCN(d.type) + '）' : ''}` }];
    if (d.desc) lines.push({ kind: 'desc', text: d.desc });
    if (d.stats) {
      const parts = [];
      for (const k of Object.keys(d.stats)) parts.push(`${statCN(k)} +${d.stats[k]}`);
      if (parts.length) lines.push({ kind: 'plain', text: '属性：' + parts.join('，') });
    }
    if (d.attr) {
      const parts = Object.keys(d.attr).map(k => `${k} +${d.attr[k]}`);
      if (parts.length) lines.push({ kind: 'plain', text: '加成：' + parts.join('，') });
    }
    if (d.damage) lines.push({ kind: 'plain', text: `伤害：${d.damage}` });
    if (d.armor) lines.push({ kind: 'plain', text: `护甲：${d.armor}` });
    if (d.healHp) lines.push({ kind: 'plain', text: `可恢复气血 ${d.healHp}` });
    if (d.healMp) lines.push({ kind: 'plain', text: `可恢复内力 ${d.healMp}` });
    if (d.teach) { const sd = w.getSkill(d.teach); lines.push({ kind: 'plain', text: `研读可学会：${sd ? sd.name : d.teach}` }); }
    if (d.require) lines.push({ kind: 'plain', text: '（有使用条件）' });
    if (inst && inst.durability !== undefined) lines.push({ kind: 'plain', text: `耐久：${inst.durability}/${inst.maxDurability}` });
    if (d.value) lines.push({ kind: 'plain', text: `价值：约 ${d.value} 文钱` });
    if (inst && inst.count > 1) lines.push({ kind: 'plain', text: `数量：${inst.count}` });
    return lines;
  }

  /* ---------------- 自身信息 ---------------- */

  function scoreLines(ctx) {
    const p = ctx.player, w = ctx.world;
    const lines = [];
    lines.push({ kind: 'title', text: `【 ${p.name} 】` });
    lines.push({ kind: 'plain', text: `性别：${genderNoun(p)}　年龄：${p.age} 岁　${p.title ? '称号：' + p.title : ''}` });
    if (p.sect) {
      const sd = w.getSect(p.sect);
      lines.push({ kind: 'plain', text: `门派：${sd ? sd.name : p.sect}${sd && sd.ranks ? ' · ' + (sd.ranks[p.rank] || '弟子') : ''}` });
    } else lines.push({ kind: 'plain', text: '门派：无门无派' });
    lines.push({ kind: 'plain', text: `等级：${p.level}　经验：${p.exp}/${p.expNeed(p.level)}　潜能：${p.potential}` });
    lines.push({ kind: 'bar', text: '气血', cur: p.hp, max: p.maxHp, color: 'hp' });
    lines.push({ kind: 'bar', text: '内力', cur: p.mp, max: p.maxMp, color: 'mp' });
    lines.push({ kind: 'bar', text: '饱食', cur: p.food, max: p.maxFood, color: 'food' });
    lines.push({ kind: 'bar', text: '饮水', cur: p.water, max: p.maxWater, color: 'water' });
    lines.push({ kind: 'plain', text: `银钱：${p.goldText()}` });
    lines.push({ kind: 'plain', text: `正邪：${p.karma > 50 ? '正道侠士' : p.karma < -50 ? '邪道中人' : '亦正亦邪'}（${p.karma}）　击杀：${p.kills}` });
    /* 防 = 玩家的 defFinal。def 这个名字已被 NPC 模板对象占用，玩家侧不读它 */
    lines.push({ kind: 'plain', text: `攻 ${p.atk}　防 ${p.defFinal}　闪避 ${p.dodge}　招架 ${p.parry}　身速 ${p.speed}　暴击 ${(p.critRate * 100).toFixed(0)}%` });
    if (p.insect) {
      const ins = w.data.insects ? w.data.insects[p.insect] : null;
      lines.push({ kind: 'plain', text: `蛊：${ins ? ins.name : p.insect}` });
    }
    if (p.titles && p.titles.length) lines.push({ kind: 'plain', text: `称号：${p.titles.join('、')}` });
    return lines;
  }

  reg(['score', 'sc', '状态', '查看自身', '自身'], (ctx) => ({ lines: scoreLines(ctx) }));

  reg(['attr', '属性', 'shuxing'], (ctx) => {
    const w = ctx.world;
    const lines = [{ kind: 'title', text: '【 属性 】' }];
    const keys = Object.keys(ctx.player.attr);
    for (const k of keys) {
      const pd = w.data.attrs[k];
      lines.push({ kind: 'plain', text: `${k}：${ctx.player.attr[k]}${pd && pd.desc ? '　' + pd.desc : ''}` });
    }
    const traits = ctx.player.traits.concat(ctx.player.perks);
    if (traits.length) {
      lines.push({ kind: 'subtitle', text: '天赋 / 特质' });
      for (const t of traits) {
        const td = w.getTrait(t);
        lines.push({ kind: 'plain', text: `${td ? td.name : t}${td && td.desc ? '：' + td.desc : ''}` });
      }
    }
    return { lines };
  });

  reg(['skills', '武学', '功夫', 'wuxue'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 武学 】' }];
    if (!Object.keys(p.learned).length) {
      lines.push({ kind: 'plain', text: '你尚未学过任何武功。' });
      return { lines };
    }
    const byType = {};
    for (const id of Object.keys(p.learned)) {
      const sd = w.getSkill(id);
      if (!sd) continue;
      const t = sd.type || '其它';
      (byType[t] = byType[t] || []).push(sd);
    }
    for (const t of Object.keys(byType)) {
      lines.push({ kind: 'subtitle', text: t });
      for (const sd of byType[t]) {
        const lv = p.skillLevel(sd.id);
        const eq = Object.values(p.equippedSkills).includes(sd.id) ? ' [已装备]' : '';
        const cur = p.learned[sd.id];
        const need = p.skillExpNeed(cur.level);
        lines.push({ kind: 'skill', text: `${sd.name}　${lv} 级　(${cur.exp}/${need})${eq}`, skill: sd.id });
      }
    }
    lines.push({ kind: 'hint', text: '用「train <武学名>」练功提升等级；用「enable <槽位> <武学名>」改变装备。' });
    return { lines };
  });

  reg(['inventory', 'i', '背包', '物品', 'beibao'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: `【 行囊 】（${(p.inventory || []).length} 件）` }];
    if (!p.inventory || !p.inventory.length) lines.push({ kind: 'plain', text: '你的行囊空空如也。' });
    else {
      for (const it of p.inventory) {
        const d = w.getItem(it.id);
        lines.push({ kind: 'item', text: `${d ? d.name : it.id}${(it.count || 1) > 1 ? ' x' + it.count : ''}${d && d.value ? `　(${d.value}文)` : ''}`, uid: it.uid, itemId: it.id });
      }
    }
    const money = p.goldText();
    lines.push({ kind: 'plain', text: `银钱：${money}` });
    return { lines };
  });

  reg(['equipment', 'eq', '装备'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 装备 】' }];
    const slots = ['头部', '颈部', '身体', '披风', '手部', '脚部', '武器', '副手', '戒指', '饰品'];
    for (const s of slots) {
      const id = p.equipment[s];
      const d = id ? w.getItem(id) : null;
      lines.push({ kind: 'plain', text: `${s}：${d ? d.name : '（空）'}` });
    }
    lines.push({ kind: 'subtitle', text: '已装备武学' });
    for (const k of Object.keys(p.equippedSkills)) {
      const id = p.equippedSkills[k];
      const d = id ? w.getSkill(id) : null;
      lines.push({ kind: 'plain', text: `${k}：${d ? `${d.name}（${p.skillLevel(id)}级）` : '（空）'}` });
    }
    return { lines };
  });

  reg(['affects', '状态效果', 'buff'], (ctx) => {
    const p = ctx.player;
    const lines = [{ kind: 'title', text: '【 当前状态 】' }];
    if (!p.buffs.length) lines.push({ kind: 'plain', text: '你身上没有特殊状态。' });
    for (const b of p.buffs) {
      const mods = b.mods ? Object.keys(b.mods).map(k => `${k}${b.mods[k] > 0 ? '+' : ''}${b.mods[k]}`).join(' ') : '';
      lines.push({ kind: 'plain', text: `${b.name}（剩 ${b.turns} 回合）${mods}` });
    }
    return { lines };
  });

  reg(['time', '时间'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const t = fmtTime(p.timeMinutes);
    return {
      lines: [
        { kind: 'plain', text: `现在：${t.text}（${shichen(p.timeMinutes)}）` },
        { kind: 'plain', text: `季节：${w.seasonCN()}　天色：${w.weather}　${w.isNight() ? '夜色深沉' : '日头尚好'}` },
      ]
    };
  });

  /* ---------------- 社交 ---------------- */

  reg(['say', '说', '说道'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想说什么？' }] };
    const text = args.join(' ');
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'say', text: `你说：「${text}」` }];
    // NPC 反应
    for (const n of w.npcsIn(p.room)) {
      if (n.def && n.def.listen) {
        for (const L of n.def.listen) {
          if (text.includes(L.keyword)) {
            evalEffects(L.effects, { player: p, world: w, npc: n }).forEach(x => lines.push(x));
          }
        }
      }
    }
    return { lines };
  });

  reg(['me', 'emote', '动作'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想做什么动作？' }] };
    return { lines: [{ kind: 'action', text: `${ctx.player.name}${args.join(' ')}` }] };
  });

  reg(['shout', '喊', '喊话'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想喊什么？' }] };
    return { lines: [{ kind: 'say', text: `你气运丹田，长声喊道：「${args.join(' ')}！」` }] };
  });

  reg(['tell', '密语'], (ctx, args) => {
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：tell <人名> <内容>' }] };
    return { lines: [{ kind: 'say', text: `你以传音入密之法对${args[0]}道：「${args.slice(1).join(' ')}」` }] };
  });

  reg(['nick', '称号'], (ctx, args) => {
    const p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: `你的称号是：${p.title || '（无）'}` }] };
    const t = args.join(' ');
    if (p.titles && p.titles.length && !p.titles.includes(t)) {
      return { lines: [{ kind: 'warn', text: `你还没有获得「${t}」这个称号。` }] };
    }
    p.title = t;
    return { lines: [{ kind: 'sys', text: `你的称号已改为「${t}」。` }] };
  });

  /* ---------------- 物品 ---------------- */

  reg(['get', 'take', '捡', '拾取', '拿'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想捡什么？' }] };
    const kw = args[args.length - 1] === 'all' || args[args.length - 1] === '全部' ? null : args.join(' ');
    const w = ctx.world, p = ctx.player;
    if (!kw) {
      const lines = [];
      const items = w.itemsIn(p.room).slice();
      for (const it of items) {
        const r = w.pickupItem(p, w.getItem(it.itemId) ? w.getItem(it.itemId).name : it.itemId);
        lines.push({ kind: r.ok ? 'sys' : 'warn', text: r.msg });
      }
      if (!lines.length) lines.push({ kind: 'warn', text: '这里地上什么也没有。' });
      return { lines };
    }
    const r = w.pickupItem(p, kw);
    if (r.ok) { p.advanceTime(1); }
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['drop', '丢', '丢弃', '放下'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想丢什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };
    const r = w.dropItem(p, hit.uid);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['use', '吃', '喝', '服用', '使用'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想用什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };
    const r = w.useItem(p, hit.uid);
    return { lines: (r.lines || []).concat([{ kind: r.ok ? 'sys' : 'warn', text: r.msg }]) };
  });

  reg(['wear', 'wield', 'equip', '穿', '装备上', '持'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想装备什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };
    const r = w.equipItem(p, hit.uid);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['remove', '卸下', '脱'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想卸下哪个部位的装备？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    let slot = kw;
    if (!p.equipment[slot]) {
      // 按物品名找槽位
      for (const s of Object.keys(p.equipment)) {
        const d = p.equipment[s] ? w.getItem(p.equipment[s]) : null;
        if (d && d.name.includes(kw)) { slot = s; break; }
      }
    }
    const r = w.unequipItem(p, slot);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['give', '给', '送', '赠送'], (ctx, args) => {
    // give <物品> to <人>   |   send <人> <物品>
    const a = args.join(' ').split(/\s+to\s+|给|送给?/);
    if (a.length < 2) return { lines: [{ kind: 'warn', text: '用法：give <物品> to <人名>（或「送 <人> <物品>」）' }] };
    const w = ctx.world, p = ctx.player;
    const itemKw = a[0].trim(), npcKw = a[1].trim();
    const hit = fuzzyFind(p.inventory || [], itemKw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${itemKw}」。` }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    if (npc.isNpc && (npc.def || {}).hostile && /狼|虎|熊|蛇|豹|兽/.test(npc.name)) {
      return { lines: [{ kind: 'warn', text: `${npc.name}可不是能收礼的主儿。` }] };
    }
    const d = w.getItem(hit.id);
    w.removeItem(p, hit.id, 1);

    /* ---- 作者手写的 acceptItems / onGift 优先 ---- */
    const def = npc.def || {};
    if (def.acceptItems && def.acceptItems[hit.id]) {
      const r = social.addFavor(w, npc, 10, '赠礼');
      const lines = [{ kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` }];
      evalEffects(def.acceptItems[hit.id], { player: p, world: w, npc }).forEach(l => lines.push(l));
      lines.push(...r.lines);
      return { lines };
    }
    if (def.onGift) {
      const lines = [{ kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` }];
      evalEffects(def.onGift, { player: p, world: w, npc, item: hit.id }).forEach(l => lines.push(l));
      return { lines };
    }

    /* ---- 通用送礼判定（喜爱类型 + 品质）---- */
    const gv = social.giftValue(w, npc, hit.id);
    const r = social.addFavor(w, npc, gv.favor, '赠礼');
    personality.addMood(npc, gv.favor >= 0 ? 10 : -8); // 受赏高兴 / 收到不喜之物不快

    const lines = [
      { kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` },
      { kind: gv.matched ? 'story' : 'say', text: gv.text },
    ];
    if (!gv.matched) {
      const likes = (def.likes || []).map(x => (social.LIKE_TYPES.find(y => y.id === x) || {}).cn).filter(Boolean);
      if (likes.length) lines.push({ kind: 'hint', text: `（${npc.name}似乎格外喜欢：${likes.join('、')}）` });
    }
    /* 品质也亮一下，让玩家理解为什么给得少 */
    if (gv.quality && gv.quality.name) {
      lines.push({ kind: 'hint', text: `（【${gv.quality.name}】的物件，${gv.matched ? `又合${pronounOf(npc)}心意` : `可惜不对${pronounOf(npc)}胃口`}）` });
    }
    lines.push(...r.lines);
    /* B22 埋点 4/14 · rs_alms（把东西给了乞丐/贫民 = 行善）。 */
    if (isPoor(npc) && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_alms', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });

  /* ---------------- 社交 ---------------- */

  /* 打听消息：在当前区域打听江湖传闻（#109 世界记忆·传闻系统）
   * 传闻由玩家行为（杀人/救人/扬名…）经目击生成，会走样、扩散、衰减、消亡；
   * 同一桩事在不同 NPC 口中说辞不同（truth 分档 + 关系态度后缀）。 */
  reg(['打听', '打听消息', '探听', '风闻', '听风声', '问消息'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'error', text: '你不在任何地方。' }] };
    const region = room.region || '_wild';
    const keyword = (args || []).join(' ').trim();
    const list = w.listenRumors(region, keyword, 3);
    if (!list.length) {
      const none = keyword
        ? `你在${room.name}向人探听「${keyword}」的消息，却无人谈及此事。`
        : `你在${room.name}竖起耳朵听了半晌，周遭只聊些家长里短、柴米油盐，没甚要紧风声。`;
      return { lines: [{ kind: 'plain', text: none }] };
    }
    const lines = [{ kind: 'title', text: `【 街谈巷议 · ${room.name} 】` }];
    const roomNpcs = w.npcsIn(p.room).filter(n => !n.dead && !(n.def || {}).hostile && !n.knockedOut);
    const speaker = roomNpcs.length ? roomNpcs[Math.floor(w.rng.next() * roomNpcs.length)] : null;
    const spName = speaker ? speaker.name : '一个路过的茶客';
    let relKind = null;
    if (speaker) {
      for (const r of (p.rel || [])) { if (r.id === speaker.defId) { relKind = r.kind; break; } }
    }
    const ACTIONS = ['捋了捋胡须', '压低了嗓子', '凑过身来', '咂了咂嘴', '端起茶碗抿了一口', '抬眼打量了你一下'];
    const action = ACTIONS[Math.floor(w.rng.next() * ACTIONS.length)];
    for (const r of list) {
      const text = w.fillRumorText(r);
      const who = (r.vars && r.vars.who) || '那人';
      let suffix = '（我也是听人说的，作不得准。）';
      if (relKind === '亲') suffix = '（他压低了声音）这话我只跟你一个人说。';
      else if (relKind === '友') suffix = `依我看，${who}不是那样的人。`;
      else if (relKind === '仇') suffix = `哼，${who}那种人，早晚有报应。`;
      lines.push({ kind: 'say', text: `${spName}${action}，说道：「${text}」${suffix}` });
    }
    lines.push({ kind: 'hint', text: '（传闻会随日子走样、消散；同一桩事，不同的人嘴里说法也不同。）' });
    return { lines };
  });

  /* ---- 私域拜访（#111 Step6 · design/09 §3.3）----
   * B/C 层 NPC 的家是 `house:<npcId>` 虚拟宅院，不在地图上。
   * 好感 ≥30 / 接过他支线 / 债主仇家 才有资格进门；进去能聊天、买卖。 */
  reg(['拜访', '造访', '登门', '上门'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想拜访谁？' }] };
    /* 🔴 B5 补漏（质量验收打回）：拜访是**玩家按键可触发**的位移，
       却直调 w.movePlayerTo 绕过 doMove 门禁 —— 我上一轮「所有自主位移
       都收敛doMove」的断言就是漏在这里（那次只审了 exec 的解析路径，
       没审 handler 内部）。可利用性：门槛只有 favor>=30，
       攒到好感后战斗中一句「拜访 张掌柜」就位移成功，且 battle 还挂着，
       等于「一边打着山贼一边窜进别人家」。
       门禁必须放在 visitHouse **之前**：放晚了房间已经建好，
       白跑一趟还会留下一个凭空多出来的私域。 */
    if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const kw = args.join(' ').trim();
    /* ⚠️ 只能拜访「本区域」的人（远房亲戚不必跑那么远）。
       用 allNpcs 全局找：主人可能不在场，去他家敲门才合理。 */
    const hit = fuzzyFind(w.allNpcs(), kw, n => n.name);
    if (!hit) return { lines: [{ kind: 'warn', text: `打听不到「${kw}」这号人物。` }] };
    const before = p.room;
    const r = w.visitHouse(hit.defId || hit.id, p.room);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [
      { kind: 'story', text: r.msg },
      { kind: 'plain', text: `（你能进门，只因${r.why}。）` },
    ];
    const mv = w.movePlayerTo(p, r.roomId);
    if (!mv.ok) return { lines };
    lines.push(...(lookRoom(ctx).lines || []));
    lines.push({ kind: 'hint', text: '（四下无人拦你。想走，原路出去便是。）' });
    void before;
    return { lines, moved: true };
  });

  /* 查看好感 */
  reg(['favor', '好感', '关系', 'renyuan'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      /* 列出本房间所有 NPC 的好感 */
      const list = w.npcsIncludingTemplates(p.room).filter(n => n.isNpc && !n.dead);
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有旁人。' }] };
      const lines = [{ kind: 'title', text: '【 此间人物 】' }];
      for (const n of list) {
        const t = social.favorTier(n.favor);
        lines.push({
          kind: 'favor',
          text: `${n.name}（${npcIdentity(w, n)}）　${t.name}（${n.favor || 0}）　${t.cn}`,
          color: t.color, favor: n.favor || 0, tier: t.name, npcId: n.id,
        });
      }
      lines.push({ kind: 'hint', text: '用「favor <人名>」查看详情。' });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    return { lines: favorDetail(w, npc) };
  });

  /* 人物关系 */
  reg(['guanxi', '人物关系', '社交'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：guanxi <人名>　查看他与别人的关系' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const def = npc.def || {};
    const lines = [{ kind: 'title', text: `【 ${npc.name}的人际 】` }];
    const rel = npc.rel || def.rel || [];
    if (!rel.length) lines.push({ kind: 'plain', text: `　${pronounOf(npc)}孤身一人，似乎没有什么来往的人。` });
    for (const r of rel) {
      const o = w.data.npcs[r.id];
      if (!o) continue;
      const color = { 亲: '#c07a4a', 友: '#2f7a4a', 仇: '#a03030', 师: '#1f6f9a', 生: '#8a5ac2', 夫妻: '#c0306a' }[r.kind] || '#666';
      /* 括号里写**身份**，不写住处（主人：什么NPC都住本地，写了等于没写） */
      const who = npcIdentity(w, o);
      /* 好感度：他（当前查看的 NPC）对**这个目标**的好感，-100~100。
         ⚠️ 别用 npc.favor —— 那是「他对玩家」的好感，套到第三方头上会张冠李戴。
         优先级：① 运行时已浮动的 relFavor[r.id] ② 数据里的 r.favor
                 ③ 按 kind 给基准值（仇 -70 / 仇敌带随机 / 友 60 / 亲 90…）。 */
      const fv = relFavorBetween(npc, o, r);
      lines.push({
        kind: 'plain',
        text: `　${relKindCN(r.kind)}　${o.name}（${who}）　好感度：${fmtRelFavor(fv)}`,
        color, relId: r.id, relKind: r.kind, relFavor: fv,
      });
    }
    /* 他自己的好感 */
    const t = social.favorTier(npc.favor);
    lines.push({ kind: 'subtitle', text: '对你的态度' });
    lines.push({ kind: 'favor', text: `　${t.name}（${npc.favor || 0}）—— ${t.cn}`, color: t.color, tier: t.name });
    return { lines };
  });

  /* 请教武学（列出可请教的） */
  reg(['qingjiao', '请教', '求教'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：qingjiao <人名>　看看他愿意教你什么' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const list = social.teachList(w, npc);
    if (!list.length) return { lines: [{ kind: 'warn', text: `${npc.name}摇摇头：「我这点本事，教不了人。」` }] };

    const t = social.favorTier(npc.favor);
    const lines = [
      { kind: 'title', text: `【 ${npc.name}可教的武学 】` },
      { kind: 'plain', text: `当前好感：${npc.favor || 0}（${t.name}）` },
    ];
    for (const s of list) {
      const canFavor = (npc.favor || 0) >= s.favorNeed;
      const canMoney = s.money > 0;
      const marks = [];
      if (s.known) marks.push('已学会');
      if (canFavor) marks.push('好感已够');
      if (canMoney) marks.push(`可花钱 ${s.money} 文`);
      lines.push({
        kind: 'skill',
        text: `${s.name}　【${s.quality}】　${s.type}　强度 ${s.power}　需好感 ${s.favorNeed}${marks.length ? '　' + marks.join(' / ') : ''}`,
        skillId: s.id, favorNeed: s.favorNeed, money: s.money, ok: canFavor || canMoney,
      });
    }
    lines.push({ kind: 'hint', text: `用「qingjiao <人名> <武学名>」请教；好感够就免费，不够可花钱（若${pronounOf(npc)}肯收）。` });
    return { lines };
  });

  /* 送礼指令：送礼 <人> <物品> */
  reg(['song', '送礼'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：song <人名> <物品名>（或「送礼 <人> <物>」）' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args[0], n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args[0]}」。` }] };
    return CMD['give'].run(ctx, [args.slice(1).join(' '), 'to', npc.name]);
  });

  /* 给钱 */
  reg(['give_money', '给钱', '赠银', '塞钱'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：give_money <人名> <钱数>' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args[0], n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args[0]}」。` }] };
    const amt = cnNum(args[1]) || parseInt(args[1], 10);
    if (!amt || amt <= 0) return { lines: [{ kind: 'warn', text: '你要给多少？' }] };
    if (p.money < amt) return { lines: [{ kind: 'warn', text: `你只有 ${p.money} 文钱。` }] };
    p.money -= amt;
    /* 给钱好感：按对方身价折算，太少了反而被看轻 */
    const worth = Math.max(50, (npc.def && npc.def.money) || 100);
    const ratio = amt / worth;
    let dv = Math.round(ratio * 12);
    if (amt < 10) dv = -1;
    if (dv > 30) dv = 30;
    const r = social.addFavor(w, npc, dv, '赠银');
    const lines = [{ kind: 'sys', text: `你把 ${amt} 文钱塞到${npc.name}手里。` }];
    lines.push({ kind: 'say', text: amt >= worth * 0.5 ? `${npc.name}推辞了两下，还是收了，脸上有了笑意。` : `${npc.name}接了钱，点了点头。` });
    lines.push(...r.lines);
    /* B22 埋点 4/14 · rs_alms（施舍行善，善名 +）：给乞丐/流民/贫民钱即记一笔。 */
    if (isPoor(npc) && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_alms', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });

  /* 切磋 */
  reg(['qiecuo', '切磋', '比试'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：qiecuo <人名>　与他点到为止地比一场' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    if (npc.dead) return { lines: [{ kind: 'warn', text: `${npc.name}已经死了。` }] };
    const r = w.startDuel(p, npc);
    return { lines: r.lines, action: r.action, battle: r.battle };
  });

  /* 偷窃 */
  reg(['steal', '偷', '偷窃', '摸'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：steal <人名> [物品名|钱]' }] };
    const npcKw = args[0];
    const which = args.length > 1 ? args.slice(1).join(' ') : 'money';
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    /* 有旁人在场 → 风险提示 */
    const others = w.npcsIncludingTemplates(p.room).filter(n => n.id !== npc.id && n.isNpc && !n.dead);
    const r = social.trySteal(w, npc, which === '钱' ? 'money' : which);
    const lines = r.lines.slice();
    if (others.length && r.ok) {
      lines.push({ kind: 'hint', text: `（此地还有旁人看着，幸好没被发现。）` });
    }
    /* B22 埋点 1/14 · rs_theft_caught（偷窃被抓，恶名 −）：人赃并获 → 同房间目击即传。 */
    if (r.caught && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_theft_caught', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });


  /* ================================================================
   * 婚姻 / 结缘（第二批）
   * ================================================================ */

  /** 提亲：提亲 <人名> [酒楼|家中] */
  reg(['propose', '提亲', '求亲', '说媒'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      /* 无参数 → 列本房间可提亲的人 */
      const list = marriage.candidates(w, 'marry');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有可论婚嫁的人。' }] };
      const lines = [{ kind: 'title', text: '【 议亲对象 】' }];
      for (const c of list) {
        lines.push({
          kind: c.ok ? 'favor' : 'plain',
          text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔ 可以提亲' : '　✘ ' + c.reason}`,
          npcId: c.id,
        });
      }
      lines.push({ kind: 'hint', text: '用「提亲 <人名> [酒楼|家中]」正式下聘。' });
      return { lines };
    }
    const venueKw = ['酒楼', '酒店', 'hall'].includes(args[args.length - 1]) ? 'hall'
                  : ['家中', '家里', '家', 'home'].includes(args[args.length - 1]) ? 'home' : null;
    const nameArgs = venueKw ? args.slice(0, -1) : args;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), nameArgs.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${nameArgs.join(' ')}」。` }] };
    const r = marriage.propose(w, npc, venueKw || 'home');
    return { lines: r.lines };
  });

  /** 请客：请客 <人名> */
  reg(['invite', '请客', '下帖'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：请客 <人名>　请他来喝你的喜酒' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = marriage.invite(w, npc.id);
    return { lines: r.lines };
  });

  /** 办酒：正式开席 */
  reg(['feast', '办酒', '开席', '摆酒'], (ctx, args) => {
    const r = marriage.holdFeast(ctx.world);
    return { lines: r.lines };
  });

  /** 入洞房 */
  reg(['consummate', '入洞房', '洞房', '拜堂'], (ctx, args) => {
    const r = marriage.consummate(ctx.world);
    return { lines: r.lines };
  });

  /** 纳妾 */
  reg(['concubine', '纳妾', '纳小'], (ctx, args) => {
    const w = ctx.world;
    if (!args.length) {
      const list = marriage.candidates(w, 'concubine');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地无人可纳。' }] };
      const lines = [{ kind: 'title', text: '【 可纳之人 】' }];
      for (const c of list) lines.push({ kind: c.ok ? 'favor' : 'plain', text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔' : '　✘ ' + c.reason}`, npcId: c.id });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(w.player.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = marriage.takeConcubine(w, npc);
    return { lines: r.lines };
  });

  /** 结缘 */
  reg(['bond', '结缘', '定情', '私定终身'], (ctx, args) => {
    const w = ctx.world;
    if (!args.length) {
      const list = marriage.candidates(w, 'bond');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地无人可结缘。' }] };
      const lines = [{ kind: 'title', text: '【 可以结缘的人 】' }, { kind: 'hint', text: '（结缘不限男女，年龄须不满 45，不占正室之位）' }];
      for (const c of list) lines.push({ kind: c.ok ? 'favor' : 'plain', text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔' : '　✘ ' + c.reason}`, npcId: c.id });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(w.player.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = marriage.makeBond(w, npc);
    return { lines: r.lines };
  });

  /** 姻缘：查看婚姻状况 */
  reg(['marriage', '姻缘', '配偶', '婚配', '家室'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const s = marriage.summary(w);
    const lines = [{ kind: 'title', text: '【 姻 缘 簿 】' }];
    if (s.spouse) {
      const sp = s.spouse;
      lines.push({ kind: 'favor', text: `正室　${sp.name}　${genderNoun(sp)}　${sp.age || '?'} 岁`, color: '#c0306a' });
      if (sp.homeName) lines.push({ kind: 'plain', text: `　居所：${sp.homeName}（你可自由出入）` });
    } else {
      lines.push({ kind: 'plain', text: '　尚未娶亲。' });
    }
    if (s.concubines.length) {
      lines.push({ kind: 'subtitle', text: '妾室' });
      for (const c of s.concubines) lines.push({ kind: 'plain', text: `　${c.name}　${genderNoun(c)}　${c.age || '?'} 岁` });
    }
    if (s.bonds.length) {
      lines.push({ kind: 'subtitle', text: '结缘' });
      for (const c of s.bonds) lines.push({ kind: 'plain', text: `　${c.name}　${genderNoun(c)}　${c.age || '?'} 岁` });
    }
    if (s.plan) {
      lines.push({ kind: 'subtitle', text: '在议' });
      lines.push({ kind: 'story', text: `　与${s.plan.name}的婚事已定，${s.plan.venueName}（聘礼 ${s.plan.gift} 文 + 席面 ${s.plan.cost} 文）` });
      lines.push({ kind: 'hint', text: '　发「办酒」开席。' });
    }
    const ks = kinship.summary(w);
    if (ks && ks.total) {
      lines.push({ kind: 'subtitle', text: '义亲结拜' });
      for (const g of ['father', 'mother', 'brothers', 'sisters', 'sons', 'daughters']) {
        for (const x of ks[g]) lines.push({ kind: 'plain', text: `　${x.label}　${x.name}` });
      }
    }
    if (!s.spouse && !s.concubines.length && !s.bonds.length && !s.plan && (!ks || !ks.total)) {
      lines.push({ kind: 'hint', text: '　你尚是孤身一人。去江湖上走走吧。' });
    }
    return { lines };
  });


  /* ================================================================
   * 结拜 / 义亲（第二批）
   * ================================================================ */

  /** 结拜：自动判断该认干亲还是拜把子 */
  reg(['swear', '结拜', '义结金兰', '拜把子', '认亲'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      const list = kinship.candidates(w);
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有可与结拜的人。' }] };
      const lines = [{ kind: 'title', text: '【 可结拜的人 】' }, { kind: 'hint', text: '（年长 15 岁以上为义父/义母，相差不足 15 岁为义兄弟/义姐妹/义兄妹）' }];
      for (const c of list) {
        lines.push({
          kind: c.ok ? 'favor' : 'plain',
          text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}` +
                (c.ok ? `　✔ 可结为${c.label}` : `　✘ ${c.reason}`),
          npcId: c.id,
        });
      }
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = kinship.swear(w, npc);
    return { lines: r.lines };
  });

  /** 断义 */
  reg(['sever', '断义', '绝交', '割袍'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：断义 <人名>' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = kinship.sever(w, npc.id);
    return { lines: r.lines };
  });

  /** 亲人：义亲名册 */
  reg(['kin', '亲人', '义亲', '族谱', '家谱'], (ctx, args) => {
    const w = ctx.world;
    const k = kinship.summary(w);
    if (!k || !k.total) return { lines: [{ kind: 'plain', text: '你在江湖上尚无结拜之亲。发「结拜」可与人义结金兰。' }] };
    const lines = [{ kind: 'title', text: '【 义 亲 名 册 】' }];
    const groups = [
      ['father', '义父'], ['mother', '义母'],
      ['brothers', '义兄弟'], ['sisters', '义姐妹'],
      ['sons', '义子'], ['daughters', '义女'],
    ];
    for (const [key, cn] of groups) {
      if (!k[key].length) continue;
      lines.push({ kind: 'subtitle', text: cn });
      for (const x of k[key]) {
        const where = x.homeName ? `　（${x.homeName}）` : '';
        lines.push({
          kind: 'plain',
          text: `　${x.name}　${genderNoun(x)}　${x.age || '?'} 岁　好感 ${x.favor}${x.dead ? '　【已故】' : ''}${where}`,
          npcId: x.id, color: x.dead ? '#8a8a8a' : undefined,
        });
      }
    }
    lines.push({ kind: 'hint', text: `共 ${k.total} 人。发「断义 <人名>」可割袍断义。` });
    return { lines };
  });


  /* ================================================================
   * 家园（第二批）
   * ================================================================ */

  /** 买宅 */
  reg(['buyhome', '买宅', '买房', '置宅', '买屋'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      const lines = [{ kind: 'title', text: '【 待售宅院 】' }];
      for (const t of homeMod.tiersOf()) {
        lines.push({ kind: 'favor', text: `　${t.name}　${t.price} 文　（可放 ${t.capacity} 件家当）`, itemId: t.id });
        lines.push({ kind: 'plain', text: `　　${t.desc}` });
      }
      lines.push({ kind: 'hint', text: '用法：买宅 <名称>　（须在衙门签押房立契）' });
      return { lines };
    }
    const kw = args.join(' ');
    const t = homeMod.tiersOf().find(x => x.name.includes(kw) || x.id === kw || kw.includes(x.name.slice(1, 3)));
    const r = homeMod.buy(w, t ? t.id : kw);
    /* B22 埋点 13/14 · rs_bigspender（置宅是大手笔，市井要传）。 */
    if (r && r.ok && typeof w.addRumor === 'function') {
      w.addRumor('rs_bigspender', { room: p.room, vars: { who: p.name || '有人', where: (w.getRoom(p.room) || {}).name || '衙门', whom: '中人' } });
    }
    return { lines: r.lines };
  });

  /** 卖宅 */
  reg(['sellhome', '卖宅', '卖房', '售宅'], (ctx) => {
    return { lines: homeMod.sell(ctx.world).lines };
  });

  /** 回家 */
  reg(['home', '回家', '回府', '归家'], (ctx) => {
    /* 🔴 B5 同类漏网之二（本次全仓审计时自己发现的）：
       goHome 直接 `p.room = p.home`（home.js:363/352），连
       movePlayerTo 都不走，是**第二条**能脱战位移的按键路径。
       同样在进handler 第一时间拦。 */
    if (ctx.world.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const r = homeMod.goHome(ctx.world);
    return { lines: r.lines, moved: !!r.moved };
  });

  /** 布置（改自家描述） */
  reg(['decorate', '布置', '陈设', '收拾屋子'], (ctx, args) => {
    return { lines: homeMod.decorate(ctx.world, args.join(' ')).lines };
  });

  /** 置办家具 */
  reg(['furnish', '置办', '添置', '买家具'], (ctx, args) => {
    return { lines: homeMod.furnish(ctx.world, args.join(' ')).lines };
  });

  /** 家宅：查看自己的产业 */
  reg(['estate', '家宅', '房产', '我的家'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const s = homeMod.summary(w);
    const lines = [{ kind: 'title', text: '【 家 宅 】' }];
    if (!s.hasHome && !s.homes.length) {
      lines.push({ kind: 'plain', text: '　你尚无片瓦遮身。' });
    } else {
      for (const h of s.homes) {
        const cur = p.home === h.id ? '　← 现居' : '';
        lines.push({ kind: 'favor', text: `　${h.name}　（${(homeMod.TIER_MAP[h.tier] || {}).name || h.tier}）${cur}` });
      }
    }
    lines.push({ kind: 'sys', text: `　家当总值：${s.estateValue} 文` });
    if (s.partnerHome) {
      lines.push({ kind: 'subtitle', text: '伴侣居所' });
      lines.push({ kind: 'plain', text: `　${s.partnerHome.of}的家：${s.partnerHome.name}（你可出入布置）` });
    }
    const here = homeMod.roomInfo(w, p.room);
    if (here && here.mine) {
      lines.push({ kind: 'subtitle', text: '所在' });
      lines.push({ kind: 'sys', text: `　${here.name}　家当 ${here.furniture.length} / ${here.capacity}` });
      if (here.furniture.length) {
        lines.push({ kind: 'plain', text: '　' + here.furniture.map(f => (homeMod.FURN_MAP[f] || {}).name).filter(Boolean).join('、') });
      }
    }
    lines.push({ kind: 'hint', text: '「买宅」「卖宅」「回家」「布置 <描述>」「置办 <家具>」' });
    return { lines };
  });


  /* ---------------- 生存：打工 / 青楼 ---------------- */

  /** 打工：在酒楼/药店打零工赚钱 */
  reg(['work', '打工', '干活', '做工'], (ctx) => {
    const r = workMod.work(ctx.world);
    return { lines: r.lines };
  });

  /** 卖身青楼（仅女玩家） */
  reg(['sellbody', '卖身', '入青楼', '挂牌'], (ctx) => {
    const r = workMod.sellBody(ctx.world);
    return { lines: r.lines };
  });

  /** 接客攒钱（卖身后） */
  reg(['serve', '接客', '接客攒钱'], (ctx) => {
    const r = workMod.serveCustomer(ctx.world);
    return { lines: r.lines };
  });

  /** 赎身 —— 一个名字，按当前所在场景分派（主人定的规矩）
   *  · 在黑市（被掳走关着）→ 黑市赎金（kidnap.redeemSelf）
   *  · 在青楼（卖身挂着）  → 青楼赎身（work.redeem）
   *  · 都不在               → 没效果，提示一句，不报错
   * 三个去向都不是的时候就不该有响应 —— 「赎身」是地点动作，不是全局动作。*/
  reg(['redeem', '赎身', '脱籍'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const k = kidnapMod.data(w);
    /* ① 黑市：人被掳走关在这儿，赎金另算 */
    if (kidnapMod.inBlackMarket(w)) return { lines: kidnapMod.redeemSelf(w).lines };
    /* ② 青楼：卖身契还挂着 */
    if (kidnapMod.inBrothel(w) && p.prostitution && p.prostitution.sold) {
      return { lines: workMod.redeem(w).lines };
    }
    /* ③ 都不在 */
    const where = (w.getRoom(p.room) || {}).name || '此处';
    if (k && k.debt) {
      /* 被掳走但不在黑市（如被卖进青楼）：赎回自己得在关你的地方办 */
      return { lines: [{ kind: 'plain', text: `　你被扣在${where}，赎身得找这里的人说。` }] };
    }
    if (kidnapMod.inBrothel(w)) {
      return { lines: [{ kind: 'plain', text: '　你在青楼，却没卖身契——没什么可赎的。' }] };
    }
    return { lines: [{ kind: 'plain', text: `　${where}不是能赎身的地方。` }] };
  });

  /** 查看身世 / 卖身状态 */
  reg(['prostitution', '身世', '卖身契', '青楼', '营生'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 营 生 】' }];
    const ps = p.prostitution;
    if (!ps || !ps.sold) {
      lines.push({ kind: 'plain', text: '　你身家清白，不是风尘中人。' });
      const c = workMod.canWork(w);
      lines.push({ kind: c.ok ? 'sys' : 'plain', text: '　' + (c.ok ? `你可以在${(w.getRoom(p.room) || {}).name}「打工」赚钱。` : c.reason) });
      if (p.gender === 'female') lines.push({ kind: 'hint', text: '　（女子若走投无路，可在青楼「卖身」换一笔银钱。）' });
    } else {
      lines.push({ kind: 'favor', text: `　你现是青楼之人，已接客 ${ps.served || 0} 回。` });
      lines.push({ kind: 'plain', text: `　赎身债还差 ${ps.debt} 文（「接客」所得尽数抵债）。` });
      lines.push({ kind: 'hint', text: '「接客」还债，「赎身」脱籍；有交情深的贵人，也肯替你赎身。' });
    }
    return { lines };
  });


  /* ---------------- 采集 / 农田（第 4 批） ---------------- */

  /** 打水（需容器） */
  reg(['drawwater', '打水', '取水', '盛水'], (ctx) => {
    const r = gather.drawWater(ctx.world);
    return { lines: r.lines };
  });

  /** 切割尸体（需利器，只能切野兽） */
  reg(['butcher', '切割', '切肉', '剥皮', '剖尸'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    // 找当前房间的尸体
    const corpses = w.corpsesIn(p.room);
    if (!corpses.length) return { lines: [{ kind: 'warn', text: '这里没有尸体可切割。' }] };
    const kw = args.join(' ');
    let target = corpses[0];
    if (kw) target = corpses.find(c => c.name.includes(kw)) || corpses[0];
    const r = gather.butcher(w, target.id);
    return { lines: r.lines };
  });

  /** 生肉加工（客栈/酒楼） */
  reg(['cook', '加工', '烹制', '做熟'], (ctx) => {
    const r = gather.cook(ctx.world);
    return { lines: r.lines };
  });

  /** 买地 */
  reg(['buyland', '买地', '买田', '置田'], (ctx) => {
    const r = farm.buyLand(ctx.world);
    return { lines: r.lines };
  });

  /** 种植 */
  reg(['plant', '种植', '播种', '种地'], (ctx, args) => {
    const p = ctx.player;
    let seedId = args.join(' ');
    const map = { 稻种: 'seed_rice', 稻: 'seed_rice', 菜种: 'seed_vegetable', 菜: 'seed_vegetable', 蔬菜: 'seed_vegetable' };
    seedId = map[seedId] || (seedId === 'seed_rice' || seedId === 'seed_vegetable' ? seedId : null);
    if (!seedId) return { lines: [{ kind: 'warn', text: '用法：种植 <稻种|菜种>（身上得有种子）' }] };
    const r = farm.plant(ctx.world, seedId);
    return { lines: r.lines };
  });

  /** 收割 */
  reg(['harvest', '收割', '收成', '收获'], (ctx) => {
    const r = farm.harvest(ctx.world);
    return { lines: r.lines };
  });

  /** 偷庄稼 */
  reg(['stealcrop', '偷庄稼', '偷菜', '摸庄稼'], (ctx) => {
    const r = farm.stealCrop(ctx.world);
    return { lines: r.lines };
  });

  /** 查看田地 */
  reg(['farmland', '田地', '我的田', '庄稼'], (ctx) => {
    const p = ctx.player;
    const lines = [{ kind: 'title', text: '【 田 地 】' }];
    const f = p.farm;
    if (!f || !f.plot) {
      lines.push({ kind: 'plain', text: '　你尚无田地。可去田头佃户家「买地」。' });
    } else {
      const roomName = (ctx.world.getRoom(f.plot) || {}).name || f.plot;
      lines.push({ kind: 'favor', text: `　你在${roomName}有一块田。` });
      if (f.seedId) {
        const grow = farm.GROW_MIN[f.seedId] || 0;
        const elapsed = ctx.world.clockMinutes - (f.plantedAt || 0);
        const remain = Math.max(0, grow - elapsed);
        const remainDays = Math.round(remain / 1440 * 10) / 10;
        const seedName = (ctx.world.getItem(f.seedId) || {}).name || f.seedId;
        lines.push({ kind: 'plain', text: `　田里种着${seedName}，${remainDays > 0 ? `还需约 ${remainDays} 天长成` : '已经成熟，可「收割」了'}。` });
      } else {
        lines.push({ kind: 'plain', text: '　田里空着，可「种植 <稻种|菜种>」。' });
      }
    }
    return { lines };
  });


  /* ---------------- 官府 / 牢狱 / 通缉（第 5 批） ---------------- */

  /** 赎人：在衙门大牢里交赎金保释被抓的 NPC */
  reg(['bail', '赎人', '保释'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room || !/监狱|大牢|牢/.test(room.name || '')) {
      return { lines: [{ kind: 'warn', text: '你得去衙门大牢，才能赎人。' }] };
    }
    const jailed = Object.keys(w.jail || {});
    if (!args.length) {
      if (!jailed.length) return { lines: [{ kind: 'plain', text: '牢里空荡荡的，没有关着什么人。' }] };
      const lines = [{ kind: 'title', text: '【 牢 房 】' }];
      for (const defId of jailed) {
        const j = w.jail[defId];
        lines.push({ kind: 'plain', text: `　${j.name}　（赎金 ${j.ransom} 文）` });
      }
      lines.push({ kind: 'hint', text: '「赎人 <人名>」交赎金保释，赎出后对方必对你感激涕零。' });
      return { lines };
    }
    const kw = args.join(' ');
    const defId = jailed.find(id => (w.jail[id].name || '').includes(kw) || kw.includes(w.jail[id].name));
    if (!defId) return { lines: [{ kind: 'warn', text: '牢里没有关着这个人。' }] };
    const j = w.jail[defId];
    if (p.money < j.ransom) return { lines: [{ kind: 'warn', text: `赎金需 ${j.ransom} 文，你身上只有 ${p.money} 文。` }] };
    p.money -= j.ransom;
    delete w.jail[defId];
    const inst = w.spawnNpc(defId, p.room, 1, true);
    if (inst) social.addFavorTo(w, defId, 50, '赎身搭救');
    return {
      lines: [
        { kind: 'story', text: `你替${j.name}交了 ${j.ransom} 文赎金，差役开了枷锁。` },
        { kind: 'sys', text: `${j.name}重见天日，对你千恩万谢（好感大增）。` },
      ],
    };
  });

  /** 通缉告示：官府/衙门看通缉要犯 + 接悬赏 */
  reg(['bounty', '通缉', '悬赏', '接悬赏'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room || !/衙门|签押|告示|官/.test(room.name || '')) {
      return { lines: [{ kind: 'warn', text: '通缉告示贴在官府 / 衙门，去那儿看。' }] };
    }
    // 通缉犯 = 盗贼/赌徒类 NPC
    const wanted = Object.values(w.data.npcs).filter(d => (d.tag === 'thief' || d.tag === 'gambler'));
    if (args.length) {
      const kw = args.join(' ');
      const t = wanted.find(d => d.name.includes(kw) || kw.includes(d.name));
      if (!t) return { lines: [{ kind: 'warn', text: '告示上没有这个通缉犯。' }] };
      p.bounty = t.id;
      return { lines: [{ kind: 'story', text: `你揭下缉拿${t.name}的告示。擒获此人（打晕或击杀），即可回衙门领赏。` }] };
    }
    if (!wanted.length) return { lines: [{ kind: 'plain', text: '告示栏上空空如也。' }] };
    const lines = [{ kind: 'title', text: '【 通 缉 告 示 】' }];
    for (const d of wanted.slice(0, 4)) {
      lines.push({ kind: 'plain', text: `　通缉要犯：${d.name}　悬赏 150 文` });
    }
    lines.push({ kind: 'hint', text: '「接悬赏 <人名>」领取缉拿任务，擒获该犯可得赏金。' });
    return { lines };
  });


  /* ---------------- 武学 ---------------- */

  reg(['learn', '学', '学习'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想学什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;

    /* 形式一：learn <人名> <武学名> —— 指定向谁请教 */
    let sd = null, teacher = null;
    const room_npcs = w.npcsIncludingTemplates(p.room).filter(n => n.isNpc && !n.dead && n.def && !n.def.hostile);
    if (args.length >= 2) {
      const byNpc = fuzzyFind(room_npcs, args[0], n => n.name);
      if (byNpc) {
        teacher = byNpc;
        sd = fuzzyFind(Object.values(w.data.skills), args.slice(1).join(' '), s => s.name);
      }
    }
    if (!sd) sd = fuzzyFind(Object.values(w.data.skills), kw, s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `没听说过「${kw}」这门功夫。` }] };

    /* 找会这门功夫的人 */
    if (!teacher) {
      const npcs = room_npcs.filter(n => {
        const def = n.def || {};
        if (def.teach && [].concat(def.teach).includes(sd.id)) return true;
        if (n.learned && n.learned[sd.id] && (def.canTeach !== false)) return true;
        return false;
      });
      if (!npcs.length) return { lines: [{ kind: 'warn', text: `此地无人会「${sd.name}」，你得找到会这门功夫的人请教。` }] };
      teacher = npcs[0];
    }

    /* ---- 社交校验：好感 or 花钱 ---- */
    const need = social.favorNeedFor(w, teacher, sd.id);
    const myFavor = teacher.favor || 0;
    const price = social.canBuyTeach(teacher) ? social.teachPrice(w, teacher, sd.id) : 0;
    const lines = [];

    if (myFavor < need && !price) {
      return {
        lines: [
          { kind: 'warn', text: `${teacher.name}摇头：「这门功夫不能轻传。」` },
          { kind: 'hint', text: `（需要好感 ${need}，你当前 ${myFavor}。多与${pronounOf(teacher)}来往、送礼，或帮${pronounOf(teacher)}做事。）` },
        ],
      };
    }
    if (myFavor < need && price) {
      /* 花钱学 */
      if (p.money < price) {
        return {
          lines: [
            { kind: 'warn', text: `${teacher.name}道：「也罢，你与我交情还浅。若肯出 ${price} 文，我便教你。」` },
            { kind: 'hint', text: `（你只有 ${p.money} 文。好感达到 ${need} 也可免费学。）` },
          ],
        };
      }
      p.money -= price;
      lines.push({ kind: 'sys', text: `你付了 ${price} 文，${teacher.name}这才点头。` });
    }

    const r = p.learnSkill(sd.id);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };

    const q = social.itemQuality ? null : null;
    lines.push({ kind: 'story', text: `${teacher.name}将${sd.name}的口诀心法细细讲与你听。` });
    lines.push({ kind: 'sys', text: r.msg });
    /* 教完加一点好感（他乐意教，说明看重你） */
    if (myFavor >= need) {
      const fr = social.addFavor(w, teacher, 3, '请教武学');
      lines.push(...fr.lines);
      /* 顺带一点信任：肯把真本事传你，是「信得过」的另一半（画像 secret/feuds 门槛用 trust）。 */
      teacher.pstate = teacher.pstate || { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
      teacher.pstate.trust = Math.min(100, (teacher.pstate.trust || 0) + 2);
    }
    p.advanceTime(30 + (sd.difficulty || 1) * 10);
    return { lines };
  });

  reg(['train', 'lian', '练', '练功', '修炼'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let sd = null;
    if (args.length) {
      sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
      if (!sd) return { lines: [{ kind: 'warn', text: `你不会「${args.join(' ')}」。` }] };
    } else {
      const ids = Object.keys(p.learned);
      if (!ids.length) return { lines: [{ kind: 'warn', text: '你还没学过武功，练什么呢？' }] };
      sd = w.getSkill(ids[0]);
    }
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };
    const lines = [];
    let rounds = 1;
    const times = cnNum(args[args.length - 1]);
    if (!isNaN(times) && times > 1 && times <= 50) rounds = times;
    for (let i = 0; i < rounds; i++) {
      const r = p.learnSkillByTrain(sd.id);
      lines.push({ kind: r.ok ? 'sys' : 'warn', text: r.msg });
      if (!r.ok) break;
      p.advanceTime(10);
      p.stamina = clamp(p.stamina - 5, 0, p.maxStamina);
      if (p.stamina <= 0) { lines.push({ kind: 'warn', text: '你已精疲力竭，无法继续练功。' }); break; }
    }
    return { lines };
  });

  reg(['enable', '装备武学', 'zhuangbei'], (ctx, args) => {
    // enable <槽位> <武学名>  或  enable <武学名>（自动判断槽位）
    const p = ctx.player, w = ctx.world;
    if (!args.length) {
      const lines = [{ kind: 'title', text: '【 武学槽位 】' }];
      for (const k of Object.keys(p.equippedSkills)) {
        const id = p.equippedSkills[k];
        const d = id ? w.getSkill(id) : null;
        lines.push({ kind: 'plain', text: `${k}：${d ? d.name : '（空）'}` });
      }
      lines.push({ kind: 'hint', text: '用法：enable <槽位> <武学名>，例如 enable 内功 紫霞神功' });
      return { lines };
    }
    let slot = args[0], skillKw = args.slice(1).join(' ');
    if (!p.equippedSkills[slot] && p.equippedSkills[slot] !== null) {
      // 可能只给了武学名
      skillKw = args.join(' ');
      slot = null;
    }
    let sd = fuzzyFind(Object.values(w.data.skills), skillKw, s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `没听说过「${skillKw}」。` }] };
    if (!slot) slot = sd.type;
    if (!(slot in p.equippedSkills)) return { lines: [{ kind: 'warn', text: `没有「${slot}」这个槽位。可用：${Object.keys(p.equippedSkills).join('、')}` }] };
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };
    p.equippedSkills[slot] = sd.id;
    p.recalc();
    return { lines: [{ kind: 'sys', text: `你将${sd.name}装备到了「${slot}」槽位。` }] };
  });

  reg(['perform', 'pf', '绝招', '施展'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你现在没有在战斗。' }] };
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想施展什么绝招？' }] };
    const sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `你不会「${args.join(' ')}」。` }] };
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };
    const r = ctx.world.combatStep({ type: 'skill', skill: sd.id });
    return { lines: r ? r.lines : [] };
  });

  reg(['forget', '忘记'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
    if (!sd || !p.learned[sd.id]) return { lines: [{ kind: 'warn', text: '你没有学过这门功夫。' }] };
    p.forgetSkill(sd.id);
    return { lines: [{ kind: 'sys', text: `你运功散去了${sd.name}的修为。` }] };
  });

  /* ---------------- 战斗 ---------------- */

  reg(['kill', 'fight', 'attack', '杀', '攻击', '打'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    /* B4：战斗界面「全力一击」点的是**光杆** `attack`（不带目标名）。
       旧实现第一句就要 args，不带就回「你想攻击谁？」——
       而战斗面板里的对手是已知的（w.battle.target），玩家不该再输一遍名字。
       所以交战中无参数 = 朝当前对手全力出手（走 combatStep 的普通攻击分支），
       这才是这个按钮在战斗面板里该有的语义。 */
    if (!args.length && w.battle) {
      const r = w.combatStep();
      return { lines: r ? r.lines : [], combatStep: true };
    }
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想攻击谁？' }] };
    const kw = args.join(' ');
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    /* 第五批：晕倒的 NPC 再被补刀才会真死 */
    if (npc.knockedOut && !(npc.def || {}).hostile) {
      w.onNpcKilled(npc, null);
      return { lines: [{ kind: 'combat', text: `你手起刀落，将昏倒在地的${npc.name}结果了性命。` }] };
    }
    const r = w.startCombat(p, npc);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [{ kind: 'combat', text: `你向${npc.name}发起了攻击！` }];
    /* B7：同房间目击者（怯懦的逃走、侠义的拔刀相助、平民惊呼）的反应台词。
       由 world 的 `combatstart` 钩子产出（见 world.js combatStartWitnessReaction）。 */
    for (const l of (r.lines || [])) lines.push(l);
    return { lines, enterCombat: true };
  });

  /* B4：战斗界面「防御」快捷键 —— 后端此前**根本没有** defend 指令
     （实测 CMD.defend === undefined），所以点了必然回「「defend」是什么指令？」。
     结论是「按钮没绑错、字段也没读错，是后端缺指令」，属可修而非僵尸按钮，
     故补齐后端：凝神防守一回合，减小本回合所受伤害。
     实现走 combatStep 的 userAction 分支，并在 combat.js 的受击处生效。 */
  reg(['defend', '防御', '招架', '守'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const r = ctx.world.combatStep({ type: 'defend' });
    return { lines: r ? r.lines : [], combatStep: true };
  });

  reg(['flee', '逃跑', '跑'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const r = ctx.world.combatStep('flee');
    return { lines: r ? r.lines : [], combatStep: true };
  });

  reg(['auto', '自动战斗'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const lines = [];
    let guard = 0;
    while (ctx.world.battle && !ctx.world.battle.over && guard++ < 60) {
      const r = ctx.world.combatStep();
      if (!r) break;
      lines.push(...r.lines);
      if (r.over) break;
      if (ctx.player.hp <= 0) break;
    }
    return { lines, combatStep: true };
  });

  /* ---------------- NPC 交互 ---------------- */

  reg(['talk', 'chat', '交谈', '聊'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想和谁说话？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const lines = [];
    const def = npc.def || {};
    if (def.dialog && w.data.dialogues[def.dialog]) {
      const dlg = w.data.dialogues[def.dialog];
      lines.push(...runDialogue(ctx, npc, dlg));
    } else if (def.dialogTree) {
      lines.push(...runDialogTree(ctx, npc, def.dialogTree));
    } else if (npc.talk) {
      /* ---- 画像 L1 听见 ----
         说话动词：personality 管，voice.tone 只在 敬/泼/酸 时顶掉（心情极低时一切让位）。
         口头禅：按画像层级 A 30% / B 15% / C 不露，前缀在台词之前。
         句式：voice.style → 句式签名（personality.styleSpeak）——**改的是句子结构本身**
         （话少的削成一小句、绕的截断咽回去、要说两遍的真的重说），不是加个前缀词。 */
      const verb = personality.sayVerbToned(npc);
      const cp = personality.catchphraseOf(npc);
      const rate = personality.catchphraseRate(npc);
      const prefix = (cp && rate && w.rng.next() < rate) ? cp : '';
      const base = evalTemplate(w.rng.pick([].concat(npc.talk)), ctx);
      const spoken = personality.styleSpeak(npc, base);
      lines.push({ kind: 'say', text: `${npc.name}${verb}：「${prefix}${spoken}」` });
    } else {
      lines.push({ kind: 'say', text: `${npc.name}看了你一眼，没有说话。` });
    }
    return { lines };
  });

  reg(['ask', '问', '询问'], (ctx, args) => {
    // ask <人> about <话题>
    const p = ctx.player, w = ctx.world;
    const s = args.join(' ');
    /* ⚠️ 分隔符只认 `about` 和「关于」，**不要拿「问」字切** ——
       「问 某某 问点什么」的 topic 里本身带「问」，切完只剩碎片
       （历史上「随便问点什么」被切成「随便」，问了个寂寞）。
       拿到全部片段，用分隔符定位，剩下的**拼回完整话题**（别只取 m[1]）。 */
    const SEP = /\s+about\s+|\s*关于\s*|\s+关于\s+/i;
    let npcKw, topic;
    const hit = s.match(SEP);
    if (hit) {
      const idx = s.indexOf(hit[0]);
      npcKw = s.slice(0, idx).trim();
      topic = s.slice(idx + hit[0].length).trim();
    } else {
      npcKw = args[0];
      topic = args.slice(1).join(' ').trim();
    }
    if (!npcKw) return { lines: [{ kind: 'warn', text: '问谁？「ask <人> about <话题>」。' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    if (!topic) return { lines: [{ kind: 'warn', text: `想问${npc.name}什么？` }] };
    const def = npc.def || {};
    const lines = [{ kind: 'sys', text: `你向${npc.name}问起「${topic}」。` }];
    let found = false;
    if (def.ask) {
      /* ⚠️ 归一化：ask 可能是对象 {topic,answer}，也可能是数组。
         直接 for...of 对象会抛「object is not iterable」，ask 指令整条挂掉。 */
      const askList = Array.isArray(def.ask) ? def.ask : [def.ask];
      for (const a of askList) {
        if (!a) continue;
        if (topic.includes(a.topic) || a.topic.includes(topic) || (a.keywords || []).some(k => topic.includes(k))) {
          found = true;
          if (a.answer) lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(a.answer, ctx)}」` });
          if (a.effects) evalEffects(a.effects, { player: p, world: w, npc }).forEach(l => lines.push(l));
          break;
        }
      }
    }
    /* ---- 画像 L2 问出 ----
       来历（trust≥0）/ 近况（trust≥20）/ 欲望（trust≥50）/ 惧怕（trust≥70）。
       门槛一律用 trust（信得过你），不用 favor（喜欢你）—— 送礼只涨 favor，
       办成事才涨 trust，两条轴不能混。没有画像的 NPC 完全走原逻辑。 */
    if (!found && npc.portrait) {
      const pt = npc.portrait;
      const trust = (npc.pstate && npc.pstate.trust) || 0;
      const KEYS = {
        origin: ['来历', '出身', '哪里人', '你是谁', '家乡', npc.name],
        now: ['近况', '最近', '如今', '怎么了', '忙什么', '在忙'],
        want: ['欲望', '想头', '指望', '想要', '图什么', '求什么', '心愿'],
        fear: ['怕什么', '惧怕', '害怕', '隐忧'],
      };
      const NEED = { origin: 0, now: 20, want: 50, fear: 70 };
      const NAME = { origin: '来历', now: '近况', want: '想头', fear: '惧怕' };
      for (const k of ['origin', 'now', 'want', 'fear']) {
        if (!pt[k]) continue;
        if (!KEYS[k].some(x => x && topic.includes(x))) continue;
        found = true;
        const verb = personality.sayVerbToned(npc);
        if (trust >= NEED[k]) {
          lines.push({ kind: 'say', text: `${npc.name}${verb}：「${evalTemplate(pt[k], ctx)}」` });
        } else {
          /* 交情不够：不撒谎，也不白给——把门槛说出来，玩家才知道要去做事而不是送礼 */
          lines.push({ kind: 'say', text: `${npc.name}${verb}：「${NAME[k]}么……你还问不着。」（信不过你，办成几件事再说）` });
        }
        break;
      }
      /* 禁忌话题：踩到 voice.taboo 掉好感（−5~−15，按层级加权） */
      const taboo = pt.voice && pt.voice.taboo;
      if (taboo && taboo.some(x => x && topic.includes(x))) {
        const d = -5 - (pt.tier === 'A' ? 10 : pt.tier === 'B' ? 5 : 0);
        npc.favor = (npc.favor || 0) + d;
        lines.push({ kind: 'sys', text: `（${npc.name}的脸沉了一下，好感 ${d}）` });
      }
      /* ---- 画像 L3 吐露：恩怨 feuds + 隐秘 secret（任务三）----
         这两样是**交情到一定程度才肯说**的东西，门槛一律用 trust（不是 favor）：
           · 恩怨 feuds —— trust≥40 说得出「谁跟谁有过节」（江湖人最爱嚼这个）；
           · 隐秘 secret —— 门槛随画像 secret.tier 抬（50 + tier×5；tier2→60、tier3→65），
             事越大越不肯讲。吐露后记进 pstate.revealed（存档留痕，日后可追踪）。
         交情不够时**不撒谎也不白给**：明确把门槛说出来，玩家才知道该去做事。 */
      const verb2 = personality.sayVerbToned(npc);
      const FEUDK = ['仇家', '恩怨', '结仇', '和谁有仇', '仇人', '冤家', '过节', '旧账'];
      if (!found && pt.feuds && pt.feuds.length && FEUDK.some(x => topic.includes(x))) {
        found = true;
        if (trust >= 40) {
          const parts = pt.feuds.slice(0, 3).map(f => {
            /* feuds[].id 是 **defId**（模板 id），要用 data.npcs 查名；
               ⚠️ world.getNpc() 查的是**实例 id**（同名方法有两个定义，后者覆盖）→ 查不到。 */
            const other = (w.data.npcs && w.data.npcs[f.id]) || {};
            const nm = other.name || f.id;
            return `${nm}（${f.kind || '旧识'}${f.why ? '：' + f.why : ''}${f.since ? '，' + f.since + '起' : ''}）`;
          });
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「提这些做什么……${parts.join('；')}。」` });
        } else {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「谁的账，也轮不到同你说。」（信不过你，办成几件事再说）` });
        }
      }
      const SECK = ['秘密', '秘辛', '底细', '心事', '隐情', '把柄', '瞒着', '不可告人', '藏着'];
      if (!found && pt.secret && pt.secret.text && SECK.some(x => topic.includes(x))) {
        found = true;
        const need = 50 + (pt.secret.tier || 1) * 5;
        if (trust >= need) {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「这话我只说一遍……${evalTemplate(pt.secret.text, ctx)}」` });
          if (npc.pstate) {
            npc.pstate.revealed = npc.pstate.revealed || [];
            if (npc.pstate.revealed.indexOf('secret') < 0) npc.pstate.revealed.push('secret');
          }
        } else {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「你还问不着这个。」（信得过我，才说得出口——先替我把事办了）` });
        }
      }
    }
    if (!found) {
      /* ---- 通用兜底：让「询问」永远有回应 ----
         329 个 NPC 里只有 18 个有 ask 数据，前端「询问」面板却对所有人开放。
         这三档是程序化生成的，任何 NPC 都接得住：
           · 「你是谁」→ 报身份（跟场景栏同一个口径 npcIdentity）
           · 「近况」  → 按画像/作息/好感编一句
           · 「江湖消息」→ 用 askDefault，没有就编一句「这我知道得不多」
         顺序：专属 ask → 画像项 → 通用项（最后兜底）。 */
      const K = topic || '';
      if (/你是谁|身份|来历|姓名|叫什么/.test(K)) {
        found = true;
        const who = npcIdentity(w, npc);
        lines.push({ kind: 'say', text: `${npc.name}道：「${who}。在这地方待着，也就这样了。」` });
      } else if (/近况|最近|如今|怎么了/.test(K)) {
        found = true;
        /* 画像近况优先（trust 门槛同上），没有就拿作息/好感拼 */
        const pt = npc.portrait;
        const trust = (npc.pstate && npc.pstate.trust) || 0;
        if (pt && pt.now && trust >= 20) {
          lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(pt.now, ctx)}」` });
        } else if (pt && pt.now) {
          lines.push({ kind: 'say', text: `${npc.name}道：「近况么……你还问不着。」（信不过你，办成几件事再说）` });
        } else {
          const f = npc.favor || 0;
          const tone = f > 40 ? '「老样子，一天一天过着。有你在，倒也不那么闷。」'
            : f < -20 ? `「不关你的事。」${pronounOf(npc)}说完就不再看你。`
              : '「混口饭吃，哪有什么近况。」';
          lines.push({ kind: 'say', text: `${npc.name}${personality.sayVerbToned(npc)}：${tone}` });
        }
      } else if (/江湖消息|江湖|传闻|消息|news|近闻/.test(K)) {
        found = true;
        if (def.askDefault) {
          lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(def.askDefault, ctx)}」` });
        } else {
          /* 没有 askDefault 就给一条「什么都不知道但态度明确」的回应，
             顺便把 askDefault 缺了这件事说清楚：不是玩家问错，是这个 NPC 没料 */
          lines.push({ kind: 'say', text: `${npc.name}摇摇头：「江湖上的事？我一个${npcIdentity(w, npc)}，哪能知道那么多。」` });
          lines.push({ kind: 'sys', text: `（${pronounOf(npc)}没什么可打听的。要问出东西来，得先有交情，或找${pronounOf(npc)}真正在意的事。）` });
        }
      }
    }
    if (!found) {
      if (def.askDefault) lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(def.askDefault, ctx)}」` });
      else lines.push({ kind: 'say', text: `${npc.name}摇摇头：「这个我却不知。」` });
    }
    return { lines };
  });

  reg(['list', 'shop', '货', '买卖'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let npc = null;
    if (args.length) npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    else npc = w.npcsIncludingTemplates(p.room).find(n => n.shop);
    if (!npc) return { lines: [{ kind: 'warn', text: '这里没有做买卖的人。' }] };
    const lines = [{ kind: 'title', text: `【 ${npc.name}的货摊 】` }];
    const shop = w.data.shops[npc.shop] || { goods: (npc.def && npc.def.goods) || [] };
    for (const g of shop.goods) {
      const d = w.getItem(g.item || g.id);
      if (!d) continue;
      const price = g.price || Math.floor((d.value || 10) * 1.5);
      lines.push({ kind: 'item', text: `${d.name}　${price} 文${g.stock !== undefined ? `（余 ${g.stock}）` : ''}`, itemId: g.item || g.id, price });
    }
    lines.push({ kind: 'hint', text: '用「buy <物品名>」购买，「sell <物品名>」出售。' });
    return { lines };
  });

  reg(['buy', '买', '购买'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let kw = args.join(' ').split(/\s+from\s+/)[0];
    let count = 1;
    const cm = kw.match(/^(.+?)\s*[x×]\s*(\d+)$/);
    if (cm) { kw = cm[1]; count = parseInt(cm[2], 10); }
    const shopNpc = w.npcsIncludingTemplates(p.room).find(n => n.shop || (n.def && n.def.goods));
    if (!shopNpc) return { lines: [{ kind: 'warn', text: '这里没有商贩。' }] };
    const shop = w.data.shops[shopNpc.shop] || { goods: (shopNpc.def && shopNpc.def.goods) || [] };
    const hit = fuzzyFind(shop.goods, kw, g => { const d = w.getItem(g.item || g.id); return d ? d.name : g.item; });
    if (!hit) return { lines: [{ kind: 'warn', text: `${shopNpc.name}没有「${kw}」卖。` }] };
    const d = w.getItem(hit.item || hit.id);
    const price = (hit.price || Math.floor((d.value || 10) * 1.5)) * count;
    const discount = 1 - clamp((p.reputation[shopNpc.def && shopNpc.def.sect] || 0) / 2000, 0, 0.15);
    /* 世界动态 W6（design/27 §3.3-2）：本派地盘上，势力越盛，货越便宜。
       叠在既有 reputation 折扣之上（各至多 15%）。 */
    let facDisc = 0;
    if (typeof w.factionOfRegion === 'function') {
      const rm = w.getRoom(p.room);
      const fid = rm && w.factionOfRegion(rm.region);
      const fac = fid && w.factionState && w.factionState.factions[fid];
      if (fac) facDisc = clamp(fac.power / 100 * 0.15, 0, 0.15);
    }
    const final = Math.floor(price * discount * (1 - facDisc));
    if (p.money < final) return { lines: [{ kind: 'warn', text: `你钱不够，需要 ${final} 文，你有 ${p.money} 文。` }] };
    p.money -= final;
    w.giveItem(p, hit.item || hit.id, count);
    /* B22 埋点 13/14 · rs_bigspender（挥金，市井闲谈）：单笔消费超 500 文记一笔。 */
    if (final >= 500 && typeof w.addRumor === 'function') {
      w.addRumor('rs_bigspender', { room: p.room, vars: { who: p.name || '有人', where: (w.getRoom(p.room) || {}).name || '市上', whom: '掌柜' } });
    }
    return { lines: [{ kind: 'sys', text: `你买下了${d.name}${count > 1 ? ' x' + count : ''}，花费 ${final} 文。` }] };
  });

  reg(['sell', '卖', '出售'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想卖什么？' }] };
    const shopNpc = w.npcsIncludingTemplates(p.room).find(n => n.shop || (n.def && n.def.goods));
    if (!shopNpc) return { lines: [{ kind: 'warn', text: '这里没有商贩。' }] };
    const hit = fuzzyFind(p.inventory || [], args.join(' '), i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${args.join(' ')}」。` }] };
    const d = w.getItem(hit.id);
    const price = Math.floor((d.value || 5) * 0.6 * (hit.count || 1));
    w.removeItem(p, hit.id, hit.count || 1);
    p.money += price;
    return { lines: [{ kind: 'sys', text: `你卖掉了${d.name}，得银 ${price} 文。` }] };
  });

  /* ---------------- 门派 / 任务 ---------------- */

  reg(['sect', '门派'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) {
      if (p.mySect) {
        const info = sectFounder.sectInfo(w);
        const lines = [{ kind: 'title', text: `【 ${info.name} 】（你的宗门）` }];
        lines.push({ kind: 'plain', text: `宗主：${info.founder}　威望：${info.prestige}　演武 ${info.drills} 次　战绩 ${info.wins} 胜 ${info.losses} 负` });
        lines.push({ kind: 'subtitle', text: `门下弟子（${info.members.length} 人）` });
        if (!info.members.length) lines.push({ kind: 'plain', text: '　（尚无人投奔，发「招贤 <人名>」广纳贤才）' });
        for (const m of info.members) lines.push({ kind: 'plain', text: `　${m.name}　战力 ${m.power}` });
        if (info.base) lines.push({ kind: 'hint', text: `驻地：${(w.getRoom(info.base) || {}).name || info.base}` });
        lines.push({ kind: 'hint', text: '发「招贤 <人名>」纳贤、「演武」聚徒习武、「大比」约战群雄、「解散宗门」遣散。' });
        return { lines };
      }
      if (p.sect) {
        const sd = w.getSect(p.sect);
        const lines = [{ kind: 'title', text: `【 ${sd ? sd.name : p.sect} 】` }];
        lines.push({ kind: 'plain', text: sd && sd.desc ? sd.desc : '' });
        lines.push({ kind: 'plain', text: `你的身份：${sd && sd.ranks ? sd.ranks[p.rank] : '弟子'}　贡献：${p.sectContribution}` });
        if (sd && sd.ranks) {
          lines.push({ kind: 'subtitle', text: '门中位阶' });
          sd.ranks.forEach((r, i) => lines.push({ kind: 'plain', text: `${i === p.rank ? '→ ' : '  '}${r}${i > 0 ? `（需贡献 ${(sd.rankCost || 500) * i}）` : ''}` }));
        }
        if (sd && sd.skills) lines.push({ kind: 'hint', text: `本门武学：${sd.skills.map(s => (w.getSkill(s) || {}).name || s).join('、')}` });
        return { lines };
      }
      const lines = [{ kind: 'title', text: '【 江湖门派 】' }];
      for (const id of Object.keys(w.data.sects)) {
        const sd = w.data.sects[id];
        lines.push({ kind: 'plain', text: `${sd.name}　${sd.align || ''}　${sd.desc ? sd.desc.slice(0, 30) : ''}` });
      }
      lines.push({ kind: 'hint', text: '用「join <门派名>」拜师入门。' });
      return { lines };
    }
    const sd = fuzzyFind(Object.values(w.data.sects), args.join(' '), s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: '江湖中没有这个门派。' }] };
    // 找掌门
    const npc = w.npcsIncludingTemplates(p.room).find(n => n.def && n.def.sect === sd.id && (n.def.isMaster || n.rank >= (sd.ranks ? sd.ranks.length - 1 : 0)));
    if (!npc) return { lines: [{ kind: 'warn', text: `你得先找到${sd.name}的掌门或长老才行。` }] };
    const r = p.joinSect(sd.id);
    const lines = [{ kind: 'sys', text: r.msg }];
    if (r.ok) lines.push({ kind: 'say', text: `${npc.name}上下打量你一番，微微颔首。` });
    return { lines };
  });

  reg(['join', '拜师', '入门'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想拜入哪个门派？' }] };
    // 优先找本房间 NPC 所属门派
    const npcs = w.npcsIncludingTemplates(p.room).filter(n => n.def && n.def.sect);
    const kw = args.join(' ');
    let targetSect = null;
    for (const n of npcs) {
      const sd = w.getSect(n.def.sect);
      if (sd && (sd.name.includes(kw) || kw.includes(sd.name) || n.name.includes(kw))) { targetSect = sd; break; }
    }
    if (!targetSect) {
      targetSect = fuzzyFind(Object.values(w.data.sects), kw, s => s.name);
    }
    if (!targetSect) return { lines: [{ kind: 'warn', text: '江湖中没有这个门派。' }] };
    const r = p.joinSect(targetSect.id);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [{ kind: 'sys', text: r.msg }];
    if (targetSect.entryEffects) evalEffects(targetSect.entryEffects, ctx).forEach(l => lines.push(l));
    /* B22 埋点 6/14 · rs_sect_join（拜入门派，扬名 +）：门派弟子/山门目击 → 邻房也传。 */
    if (typeof w.addRumor === 'function') {
      w.addRumor('rs_sect_join', { room: p.room, about: targetSect.id, vars: { who: p.name, where: targetSect.name } });
    }
    return { lines };
  });

  reg(['leave', '脱离门派', '叛门'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你本就没有门派。' }] };
    const sd = w.getSect(p.sect);
    const r = p.leaveSect();
    p.karma -= 20;
    /* B22 埋点 7/14 · rs_sect_betray（叛门，恶名 −）：山门目击 → 邻房传开。 */
    if (typeof w.addRumor === 'function') {
      w.addRumor('rs_sect_betray', { room: p.room, about: sd ? sd.id : null, vars: { who: p.name, where: sd ? sd.name : '师门' } });
    }
    return { lines: [{ kind: 'sys', text: r.msg }, { kind: 'warn', text: `叛出${sd ? sd.name : '门派'}，你的名声受损了。` }] };
  });

  reg(['promote', '升职', '晋级'], (ctx) => {
    const r = ctx.player.promote();
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['contribute', '贡献', '捐献'], (ctx, args) => {
    const p = ctx.player;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你没有门派。' }] };
    const n = cnNum(args[0]) || 10;
    if (p.money < n) return { lines: [{ kind: 'warn', text: `你没有 ${n} 文钱。` }] };
    p.money -= n;
    p.sectContribution += Math.floor(n / 10);
    return { lines: [{ kind: 'sys', text: `你捐了 ${n} 文钱，门派贡献 +${Math.floor(n / 10)}（现 ${p.sectContribution}）。` }] };
  });

  /* ---------------- 自建宗门（武学重制 S2） ---------------- */
  reg(['创宗', '建宗', '开宗立派', 'createSect'], (ctx, args) => {
    return { lines: sectFounder.createSect(ctx.world, args.join(' ')).lines };
  });
  reg(['招贤', '纳贤', 'recruit'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.mySect) return { lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
    const kw = args.join(' ');
    if (!kw) return { lines: [{ kind: 'warn', text: '用法：招贤 <人名>　例如「招贤 李捕快」' }] };
    const npc = w.npcsIncludingTemplates(p.room).find(n => !n.isPlayer && (n.name === kw || n.name.includes(kw) || kw.includes(n.name)));
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${kw}」这号人物。` }] };
    return { lines: sectFounder.recruit(w, npc).lines };
  });
  reg(['逐出', '逐出宗门', 'expel'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.mySect) return { lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
    const kw = args.join(' ');
    if (!kw) return { lines: [{ kind: 'warn', text: '用法：逐出 <人名>' }] };
    const npc = w.npcsIncludingTemplates(p.room).find(n => !n.isPlayer && (n.name === kw || n.name.includes(kw) || kw.includes(n.name)));
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${kw}」这号人物。` }] };
    return { lines: sectFounder.expel(w, npc).lines };
  });
  reg(['演武', 'drill'], (ctx) => ({ lines: sectFounder.drill(ctx.world).lines }));
  reg(['大比', '门派大比', 'contest'], (ctx) => ({ lines: sectFounder.contest(ctx.world).lines }));
  reg(['解散宗门', '遣散', 'disband'], (ctx) => ({ lines: sectFounder.disband(ctx.world).lines }));

  /* ---------------- 家园地块 / 资助NPC建家（SPRINT2）---------------- */
  reg(['地块', '家园地块', 'plots'], (ctx) => ({ lines: estateMod.listPlots(ctx.world).lines }));
  reg(['开垦', '拓地', '开辟', 'plot'], (ctx, args) => {
    const r = estateMod.buildPlot(ctx.world, args.join(' '));
    return { lines: r.lines, moved: r.moved || null };
  });
  reg(['资助', '建家', 'sponsor'], (ctx, args) => {
    const a = args.slice();
    /* 支持「资助 范清 一间茅屋」：末段若是档位名则拆出来 */
    let tierKw = null;
    if (a.length > 1 && estateMod.NPC_TIERS.some(t => t.name === a[a.length - 1] || t.id === a[a.length - 1])) {
      tierKw = a.pop();
    }
    const r = estateMod.sponsorNpcHome(ctx.world, a.join(' '), tierKw);
    return { lines: r.lines, moved: r.moved || null };
  });

  reg(['quests', 'quest', '任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 任务 】' }];
    const active = Object.keys(p.quests).filter(q => p.quests[q] >= 0 && p.quests[q] < 99);
    if (!active.length) lines.push({ kind: 'plain', text: '你目前没有进行中的任务。' });
    for (const q of active) {
      const qd = w.getQuest(q);
      if (!qd) continue;
      const st = p.quests[q];
      const stage = qd.stages && qd.stages[st];
      lines.push({ kind: 'quest', text: `${qd.name}（${qd.level ? '推荐等级 ' + qd.level : '任务'}）`, quest: q });
      if (stage) lines.push({ kind: 'plain', text: `　${stage.desc || ''}` });
      if (stage && stage.targets) {
        for (const t of stage.targets) {
          const cur = Math.min(t.count || 1, p.getVar(t.var || `q_${q}_${t.id}`) || 0);
          lines.push({ kind: 'plain', text: `　· ${t.desc || t.id}　${cur}/${t.count || 1}` });
        }
      }
    }
    // 可接任务（本房间 NPC 身上的）—— def.quests + def.sidequest（B25 接线）
    const available = [];
    for (const n of w.npcsIncludingTemplates(p.room)) {
      if (!n.def) continue;
      const ids = [];
      if (Array.isArray(n.def.quests)) for (const q of n.def.quests) ids.push(q);
      if (n.def.sidequest) ids.push(n.def.sidequest);
      for (const q of ids) {
        const qd = w.getQuest(q);
        if (!qd) continue;                   // 挡悬空指针
        if (p.questStage(q) >= 0) continue;  // 已在进行 / 已完成
        if (qd.require && !evalCond(qd.require, ctx)) continue;  // 前置未满足 → 不算「可接」
        available.push({ q, npc: n });
      }
    }
    if (available.length) {
      lines.push({ kind: 'subtitle', text: '可接任务' });
      for (const a of available) {
        const qd = w.getQuest(a.q);
        lines.push({ kind: 'quest', text: `${qd ? qd.name : a.q}（找 ${a.npc.name}）`, quest: a.q });
      }
      lines.push({ kind: 'hint', text: '用「accept <任务名>」接取。' });
    }
    return { lines };
  });

  reg(['accept', '接取', '接任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想接什么任务？' }] };
    const qd = fuzzyFind(Object.values(w.data.quests), args.join(' '), q => q.name);
    if (!qd) return { lines: [{ kind: 'warn', text: '没有这个任务。' }] };
    if (p.questStage(qd.id) >= 0) return { lines: [{ kind: 'warn', text: '你已经在进行这个任务了。' }] };
    if (qd.require) {
      if (!evalCond(qd.require, ctx)) return { lines: [{ kind: 'warn', text: '你还不满足接取条件。' }] };
    }
    p.setQuestStage(qd.id, 0);
    const lines = [{ kind: 'quest', text: `【接取任务】${qd.name}` }];
    if (qd.desc) lines.push({ kind: 'story', text: qd.desc });
    if (qd.stages && qd.stages[0] && qd.stages[0].desc) lines.push({ kind: 'plain', text: `目标：${qd.stages[0].desc}` });
    return { lines };
  });

  reg(['abandon', '放弃', '放弃任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const qd = fuzzyFind(Object.values(w.data.quests), args.join(' '), q => q.name);
    if (!qd || p.questStage(qd.id) < 0) return { lines: [{ kind: 'warn', text: '你没有这个任务。' }] };
    if (qd.abandonable === false) return { lines: [{ kind: 'warn', text: '这个任务无法放弃。' }] };
    delete p.quests[qd.id];
    p.setQuestStage(qd.id, -1);
    return { lines: [{ kind: 'sys', text: `你放弃了任务「${qd.name}」。` }] };
  });

  reg(['report', '交任务', '交差'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npcs = w.npcsIncludingTemplates(p.room);
    if (!npcs.length) return { lines: [{ kind: 'warn', text: '这里没有人可以交任务。' }] };
    const lines = [];
    for (const n of npcs) {
      const handled = tryReportQuest(ctx, n, lines);
      if (handled) break;
    }
    if (!lines.length) lines.push({ kind: 'warn', text: '这里没有人等待你的复命。' });
    return { lines };
  });

  /* ---------------- 地图 ---------------- */

  reg(['map', '地图', 'ditu'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    const region = room ? w.getRegion(room.region) : null;
    const lines = [{ kind: 'title', text: `【 ${region ? region.name : '所在区域'} 地图 】` }];
    const rooms = Object.values(w.data.rooms).filter(r => r.region === (room ? room.region : null));
    lines.push({ kind: 'map', room: p.room, rooms, region: room ? room.region : null });
    if (region && region.desc) lines.push({ kind: 'plain', text: region.desc });
    return { lines };
  });

  reg(['where', '定位', '我在哪'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    const region = room ? w.getRegion(room.region) : null;
    return { lines: [{ kind: 'sys', text: `你正在 ${region ? region.name + ' · ' : ''}${room ? room.name : '未知'}。` }] };
  });

  /* ---------------- 系统 ---------------- */

  reg(['clear', '清屏'], () => ({ lines: [], clear: true }));
  reg(['version', '版本'], (ctx) => ({ lines: [{ kind: 'plain', text: `武侠行 v${ctx.world.version}　已加载 ${ctx.world.mods.length} 个 Mod` }] }));
  reg(['mods', 'mod', 'mods列表'], () => ({ lines: [], openPanel: 'mods' }));
  reg(['save', '存档'], () => ({ lines: [], action: 'save' }));
  reg(['load', '读档'], () => ({ lines: [], action: 'load' }));
  reg(['settings', '设置'], () => ({ lines: [], openPanel: 'settings' }));
  /* 退出游戏：网页端由前端 doCmd() 优先本地拦截（弹确认框 → 自动存档 → 回主菜单），
     见 ui.js 的 isQuitCmd() / quitGame()。这里保留后端实现，是为了
     ① 让 help 的「系统」组列得出来；② 纯文本客户端 / mod 调到时给个体面的答复。 */
  reg(['quit', 'exit', '退出游戏', '退出', '离开游戏', '回主菜单'], () => ({
    lines: [{ kind: 'hint', text: '你收拢行囊，退出了江湖。' }],
    action: 'quit',
  }));

  /* 内部：由服务端 /api/panel 转发，直接开面板（不输出任何文字） */
  reg(['__panel__score', '__panel__状态'], (ctx) => ({ lines: [], openPanel: 'score', panelData: null }));
  reg(['__panel__attr'], (ctx) => ({ lines: [], openPanel: 'attr' }));
  reg(['__panel__skills'], (ctx) => ({ lines: [], openPanel: 'skills' }));
  reg(['__panel__inventory'], (ctx) => ({ lines: [], openPanel: 'inventory' }));
  reg(['__panel__equipment'], (ctx) => ({ lines: [], openPanel: 'equipment' }));
  reg(['__panel__affects'], (ctx) => ({ lines: [], openPanel: 'affects' }));
  reg(['__panel__map'], (ctx) => ({ lines: [], openPanel: 'map' }));
  reg(['__panel__quests'], (ctx) => ({ lines: [], openPanel: 'quests' }));
  reg(['__panel__sect'], (ctx) => ({ lines: [], openPanel: 'sect' }));
  reg(['__panel__help'], (ctx) => ({ lines: [], openPanel: 'help' }));
  reg(['__panel__save', '__panel__load'], (ctx, args) => ({ lines: [], openPanel: 'save', action: 'save' }));
  reg(['rebirth', '重开', '重新开始'], () => ({ lines: [], action: 'rebirth' }));
  reg(['sleep', '睡', '休息'], (ctx) => {
    const p = ctx.player;
    p.advanceTime(480);
    p.hp = p.maxHp; p.mp = p.maxMp;
    p.food = clamp(p.food - 30, 0, p.maxFood);
    return { lines: [{ kind: 'story', text: '你就地歇息了一夜。' }, { kind: 'sys', text: '你精神恢复了不少。' }] };
  });
  reg([' meditate', 'meditate', '打坐', '练气'], (ctx) => {
    const p = ctx.player;
    const neigong = p.equippedSkills && p.equippedSkills['内功'];
    const gain = 5 + Math.floor(p.attrTotal('悟性') / 2);
    const lines = [{ kind: 'story', text: '你盘膝而坐，闭目凝神，调匀呼吸。' }];

    if (p.mp >= p.maxMp) {
      p.advanceTime(10);
      lines.push({ kind: 'sys', text: '你内力已然充盈，再坐也是徒然，起身罢。' });
      return { lines };
    }

    /* 内力是有限的，打坐只是慢慢养回来 —— 主人报「打坐瞬间恢复全部内力」
       太离谱。回复 = maxMp 的 8%~25%，随内功/资质/悟性；饿着更慢。
       想回满得静坐七八回，不是一键满蓝（有那个便利的是丹药和客栈）。 */
    const deep = p.attrTotal('内力') + p.attrTotal('悟性') + (neigong ? p.attrTotal('资质') * 2 : 0);
    let pct = clamp(0.08 + deep * 0.004, 0.06, 0.25);
    if (typeof p.food === 'number' && p.food < 20) pct *= 0.5;
    const rest = Math.max(1, Math.floor(p.maxMp * pct));
    p.mp = clamp(p.mp + rest, 0, p.maxMp);
    p.advanceTime(20);
    lines.push({
      kind: 'sys',
      text: `你吐纳周天，气息渐充，内力恢复${rest}点（${p.mp}/${p.maxMp}）。` +
        (p.mp >= p.maxMp ? '内息已复。' : '尚需静坐养气。'),
    });

    if (neigong && p.learned[neigong]) {
      p.gainSkillExp(neigong, gain);
      const sd = ctx.world.getSkill(neigong);
      lines.push({ kind: 'sys', text: `你运转${sd ? sd.name : '内功'}心法，气行经脉，修为略有精进。` });
      // 内功修炼：打坐冲击奇经八脉
      const m = p.tryAssaultMeridian(sd);
      if (m) lines.push({ kind: 'sys', text: m });
    } else {
      lines.push({ kind: 'sys', text: '你尚未修习内功，只能做些粗浅的养气功夫，长进有限。' });
    }
    return { lines };
  });

  /* ---------------- 运功疗伤 ----------------
     主人报「快捷键『运功疗伤』用不了」——根因：快捷栏里写了 cmd:'heal'，
     但后端从来没注册过 heal 指令（只有 meditate/打坐），点下去就是「未知指令」。
     主人追加要求：**疗伤消耗内力** —— 内力是燃料，拿内力换气血。
     没内力就寸步难行；反复掏空丹田硬撑会积「暗伤」，三次减气血上限。
     最优解仍是客栈睡一晚 / 丹药 / 静养，这里只给赶路的人应急用。 */
  reg(['heal', '疗伤', '运功疗伤', '养伤', '行气疗伤'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    if (p.hp >= p.maxHp) {
      return { lines: [{ kind: 'sys', text: '你身上没有伤，气血完足，不必运功。' }] };
    }
    const hurt = p.maxHp - p.hp;

    /* 内力是燃料 —— 主人要求：疗伤消耗内力。耗 maxMp 的 18%（无内功的凡人
       拿不出手，30%），把内力逼出来推动气血修复。无内力则寸步难行。 */
    const hasNei = !!(p.equippedSkills && p.equippedSkills['内功']);
    const fullCost = Math.max(1, Math.floor(p.maxMp * (hasNei ? 0.18 : 0.30)));
    if (p.mp <= 0) {
      p.advanceTime(10);
      return {
        lines: [{
          kind: 'warn',
          text: '你丹田空空，一丝内力也提不起来，疗什么伤。先打坐养气，或服一枚丹药。',
        }],
      };
    }
    const cost = Math.min(fullCost, p.mp);
    p.mp = Math.max(0, p.mp - cost);

    /* 回血 = 投入的内力换来的。系数 1.4 上下：满内力（maxMp≈46）一次约
       治六成伤；内功深厚/资质高更划算。饿着打折。 */
    const deep = p.attrTotal('内力') + p.attrTotal('悟性') * 2;
    let rate = clamp(1.4 + deep * 0.012, 1.0, 2.6);
    if (typeof p.food === 'number' && p.food < 20) rate *= 0.6;
    /* 内力不够满额的那一回，疗效按投入比例缩水（不能白嫖） */
    const ratio = cost / fullCost;
    let heal = Math.max(1, Math.floor(cost * rate * ratio));
    heal = Math.min(heal, hurt);
    p.hp = clamp(p.hp + heal, 0, p.maxHp);
    p.advanceTime(15);

    const lines = [{ kind: 'story', text: '你解下兵刃，就地闭目，气息缓缓推动气血行于伤处。' }];
    lines.push({
      kind: 'sys',
      text: `你耗去内力${cost}点，换回气血${heal}点（气血 ${p.hp}/${p.maxHp}，内力 ${p.mp}/${p.maxMp}）。` +
        (p.hp >= p.maxHp ? '伤已痊愈。' : '余伤未消，丹田也已见底。'),
    });

    /* 内力见底还硬撑 → 暗伤累积，三次减气血上限 */
    if (p.mp <= 0) {
      p.scar = (p.scar || 0) + 1;
      if (p.scar >= 3) {
        p.scar = 0;
        p.maxHp = Math.max(10, p.maxHp - 3);
        if (p.hp > p.maxHp) p.hp = p.maxHp;
        lines.push({ kind: 'warn', text: '三次内力见空仍强行运功，旧伤暗积，气血上限略减。好好歇几日罢。' });
      }
    }
    try { w.fireEvent('onHeal', { player: p, heal, cost }); } catch (e) { }
    return { lines };
  });

  /* ---------------- 求医（任务一：医者的互动项，要点得动、有反馈） ----------------
     医者（tag=doctor，11 人）点击菜单给「求医」。诊金按伤势算，无伤时明确回绝；
     银钱不够也明说 —— 绝不出现「点了没反应」。 */
  reg(['求医', '看病', '问诊', '诊病'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const here = w.npcsIncludingTemplates(p.room).filter(n => (n.def || {}).tag === 'doctor');
    if (!here.length) return { lines: [{ kind: 'warn', text: '这里没有会看病的人。' }] };
    let med = here[0];
    if (args.length) { const t = fuzzyFind(here, args.join(' '), n => n.name); if (t) med = t; }
    const hpMiss = Math.max(0, p.maxHp - p.hp);
    const mpMiss = Math.max(0, p.maxMp - p.mp);
    if (hpMiss <= 0 && mpMiss <= 0) {
      return { lines: [{ kind: 'say', text: `${med.name}抬眼看了看你：「气色不差，不必吃我的药。」` }] };
    }
    const fee = Math.max(5, Math.round(hpMiss * 0.4 + mpMiss * 0.2));
    if ((p.money || 0) < fee) {
      return { lines: [
        { kind: 'say', text: `${med.name}道：「诊金 ${fee} 文，你拿得出么？」` },
        { kind: 'hint', text: `（你只有 ${p.money || 0} 文。先去筹钱，或另寻郎中。）` },
      ] };
    }
    p.money -= fee;
    p.hp = p.maxHp;
    p.mp = clamp(p.mp + Math.round(p.maxMp * 0.6), 0, p.maxMp);
    return { lines: [
      { kind: 'say', text: `${med.name}让你坐下，搭上脉，又取了些药末调开。` },
      { kind: 'sys', text: `你付了 ${fee} 文诊金，伤痛大减（气血 ${p.hp}/${p.maxHp}）。` },
    ] };
  });

  /* ---------------- 问路（任务一：镖师 / 车夫 / 船夫的互动项） ----------------
     按当前房间出口做 BFS，找同 region 最近的一处「有字号的地方」（客栈/市集/衙门/渡口…），
     报出方向与步数。是真计算出来的路，不是套话。 */
  reg(['问路', '打听路', '找路', '带路'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const here = w.npcsIncludingTemplates(p.room).filter(n => ['escort', 'groom', 'boatman'].indexOf((n.def || {}).tag) >= 0);
    if (!here.length) return { lines: [{ kind: 'warn', text: '这里没有识路的人。' }] };
    let g = here[0];
    if (args.length) { const t = fuzzyFind(here, args.join(' '), n => n.name); if (t) g = t; }
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你连自己在哪儿都不知道。' }] };
    const NOTABLE = /客栈|酒|茶|市|集|铺|衙|渡|码头|城门|镖局|寺|观|宫/;
    // BFS：找同 region 里最近的一处「有字号的地方」
    const seen = { [p.room]: null };   // roomId -> 从起点走的第一步方向
    const q = [p.room];
    let target = null;
    while (q.length && !target) {
      const cur = q.shift();
      const cr = w.getRoom(cur);
      if (!cr) continue;
      for (const d of Object.keys(cr.exits || {})) {
        const ex = cr.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        if (!tid || seen[tid] !== undefined || !w.data.rooms[tid]) continue;
        seen[tid] = seen[cur] || d;     // 第一步方向
        const tr = w.data.rooms[tid];
        if (tr.region === room.region && tr.id !== p.room && NOTABLE.test(tr.name || '')) { target = tr; break; }
        q.push(tid);
      }
    }
    if (!target) {
      return { lines: [{ kind: 'say', text: `${g.name}想了想，摇头道：「这附近，倒也没什么好去处。」` }] };
    }
    /* 步数 = BFS 深度（重新算一遍最短步） */
    const dist = {}; dist[p.room] = 0;
    const q2 = [p.room];
    while (q2.length) {
      const cur = q2.shift();
      if (cur === target.id) break;
      const cr = w.getRoom(cur);
      for (const d of Object.keys((cr && cr.exits) || {})) {
        const ex = cr.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        if (!tid || dist[tid] !== undefined || !w.data.rooms[tid]) continue;
        dist[tid] = dist[cur] + 1;
        q2.push(tid);
      }
    }
    const steps = dist[target.id];
    const dirCN = DIR_CN[seen[target.id]] || seen[target.id];
    return { lines: [
      { kind: 'say', text: `${g.name}抬手往${dirCN}边一指：「往${dirCN}去，过了${steps}道门就是${target.name}。」` },
      { kind: 'hint', text: `（${target.name}：往${dirCN}，约 ${steps} 步。）` },
    ] };
  });

  /* ---------------- 搜身（任务一：倒地者的互动项） ----------------
     对象是 **打倒/晕倒** 的人（knockedOut）——用 downedIn，不用 npcsIn（铁律 32）。
     拿走他身上的钱与物，每人只可搜一次。 */
  reg(['搜身', '搜刮', 'loot', 'searchbody'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const downed = w.downedIn(p.room);
    if (!downed.length) return { lines: [{ kind: 'warn', text: '这里没有倒下的人可搜。' }] };
    const kw = args.join(' ').trim();
    let tgt = downed[0];
    if (kw) {
      const t = downed.find(n => (n.name || '').includes(kw)) || fuzzyFind(downed, kw, n => n.name);
      if (!t) return { lines: [{ kind: 'warn', text: `这没有叫「${kw}」的倒地者。` }, { kind: 'hint', text: '可搜的：' + downed.map(n => n.name).join('、') }] };
      tgt = t;
    }
    if (tgt._searched) return { lines: [{ kind: 'plain', text: `${tgt.name}身上已经被你翻过了。` }] };
    const taken = [];
    const carry = tgt.carry || (tgt.def && tgt.def.carry) || null;
    if (carry) {
      if (carry.money) { p.money = (p.money || 0) + carry.money; taken.push(carry.money + ' 文'); carry.money = 0; }
      const items = [].concat(carry.items || []);
      for (const it of items) {
        const iid = typeof it === 'string' ? it : (it && (it.id || it.itemId));
        if (!iid || !w.getItem(iid)) continue;
        const cnt = (typeof it === 'object' && it.count) || 1;
        w.giveItem(p, iid, cnt);
        taken.push(((w.getItem(iid) || {}).name || iid) + (cnt > 1 ? ' x' + cnt : ''));
      }
      if (carry.items) carry.items = [];
    }
    tgt._searched = true;
    if (!taken.length) return { lines: [{ kind: 'plain', text: `你在${tgt.name}身上翻了翻，什么也没有。` }] };
    return { lines: [{ kind: 'sys', text: `你从${tgt.name}身上搜出了：${taken.join('、')}。` }] };
  });

  /* ---------------- 外功淬体（淬炼肉身，需血量与药物，有生命危险） ---------------- */
  reg(['淬体', 'cuti', '淬炼', '炼体'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let sd = null;
    if (args.length) {
      sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
    } else {
      const ids = Object.keys(p.learned).filter(id => { const d = w.getSkill(id); return d && d.type !== '内功'; });
      if (ids.length) sd = w.getSkill(ids[0]);
    }
    if (!sd) return { lines: [{ kind: 'warn', text: '你还没有可淬炼的外功武学（先去学一门拳脚刀剑）。' }] };
    if (sd.type === '内功') return { lines: [{ kind: 'warn', text: '内功靠打坐冲击奇经八脉，无需淬体。' }] };
    const cur = p.learned[sd.id];
    const lv = cur ? cur.level : 0;
    const apt = p.attrTotal('资质');
    // 越往后越难练；家园练武场会降低难度、提高成功率
    const _eff = (w && typeof w.estateEffects === 'function') ? w.estateEffects() : null;
    const successRate = clamp(0.75 + apt * 0.004 - lv * 0.004 + (_eff ? _eff.cutiRate : 0), 0.1, 0.98);
    const riskRate = clamp(0.05 + lv * 0.012, 0.05, 0.7);
    // 药物支撑：背包有疗伤丹药则大幅降低风险并消耗一枚
    const healItem = (p.inventory || []).map(it => w.getItem(typeof it === 'object' ? it.id : it)).find(it => it && it.healHp);
    let usedMed = null;
    if (healItem) { p.removeItem(healItem.id, 1); usedMed = healItem.name; }
    const effRisk = usedMed ? riskRate * 0.3 : riskRate;
    // 消耗体力与部分气血
    const hpCost = Math.floor(p.maxHp * (0.08 + lv * 0.004));
    p.hp = clamp(p.hp - hpCost, 1, p.maxHp);
    p.stamina = clamp(p.stamina - 25, 0, p.maxStamina);
    p.advanceTime(30);
    const lines = [{ kind: 'story', text: `你运起${sd.name}心法，捶打筋骨，淬炼肉身……` }];
    if (usedMed) lines.push({ kind: 'sys', text: `你服下${usedMed}以防不测。` });
    if (p.world.rng.next() < successRate) {
      const gain = Math.floor(p.skillExpNeed(lv) * 0.4);
      const g = p.gainSkillExp(sd.id, gain);
      lines.push({ kind: 'sys', text: g.msg + '（淬体有成）' });
    } else {
      lines.push({ kind: 'warn', text: '淬体未能精进，仅觉筋骨酸胀。' });
    }
    // 生命危险判定（无药物则更凶险）
    if (p.world.rng.next() < effRisk) {
      const dmg = Math.floor(p.maxHp * (usedMed ? 0.15 : 0.35));
      p.hp = clamp(p.hp - dmg, 0, p.maxHp);
      if (p.hp <= 0) {
        p.hp = 1;
        lines.push({ kind: 'warn', text: '淬体失当，气血逆行，险些丧命！（被人救起，仅余一息）' });
      } else {
        lines.push({ kind: 'warn', text: '淬体失当，气血翻涌，险象环生！' });
      }
    }
    return { lines };
  });

  /* ---------------- 炼丹 / 炼器 / 符文阵法（SPRINT2-B） ---------------- */

  const CRAFT_CAT = {
    alchemy: { label: '丹药', verb: '炼丹' },
    forge: { label: '兵刃防具', verb: '炼器' },
    rune: { label: '符箓', verb: '画符' },
  };

  function doCraft(ctx, category, recipeKw) {
    const p = ctx.player, w = ctx.world;
    const cat = CRAFT_CAT[category] || { label: '物品', verb: '炼制' };
    const recipes = Object.values(w.data.recipes || {}).filter(r => r.category === category);
    if (!recipeKw) {
      const names = recipes.map(r => r.name).join('、');
      return { lines: [{ kind: 'sys', text: `可${cat.verb}的${cat.label}：${names || '（暂无）'}` }] };
    }
    const rec = fuzzyFind(recipes, recipeKw, r => r.name);
    if (!rec) return { lines: [{ kind: 'warn', text: `没有名为「${recipeKw}」的${cat.label}配方。` }] };
    // 器具
    if (rec.needTool && !p.hasItem(rec.needTool)) {
      const td = w.getItem(rec.needTool);
      return { lines: [{ kind: 'warn', text: `${cat.verb}需要「${td ? td.name : rec.needTool}」。` }] };
    }
    // 材料
    const miss = [];
    for (const mid in rec.mat) {
      const need = rec.mat[mid];
      if (p.countItem(mid) < need) miss.push(`${(w.getItem(mid) || { name: mid }).name}(${p.countItem(mid)}/${need})`);
    }
    if (miss.length) return { lines: [{ kind: 'warn', text: `材料不足：${miss.join('、')}` }] };
    // 消耗材料
    for (const mid in rec.mat) p.removeItem(mid, rec.mat[mid]);
    // 成功率（悟性/资质越高越稳）
    const wis = p.attrTotal('悟性'), apt = p.attrTotal('资质');
    const _eff = (w && typeof w.estateEffects === 'function') ? w.estateEffects() : null;
    const rate = clamp((rec.base || 0.8) + wis * 0.004 + apt * 0.003 + (_eff ? _eff.craftRate : 0), 0.1, 0.98);
    p.stamina = clamp(p.stamina - 15, 0, p.maxStamina);
    p.advanceTime(rec.time || 20);
    const lines = [{ kind: 'story', text: `你着手${cat.verb}「${rec.name}」……` }];
    if (p.world.rng.next() < rate) {
      w.giveItem(p, rec.out, rec.outCount || 1);
      lines.push({ kind: 'sys', text: `炼制成功！获得 ${rec.outCount || 1} 个${w.getItem(rec.out).name}。` });
    } else {
      lines.push({ kind: 'warn', text: '炼制失败，材料尽毁，只余一缕焦烟。' });
    }
    return { lines };
  }

  reg(['炼丹', 'alchemy', 'liandan'], (ctx, args) => doCraft(ctx, 'alchemy', args.join(' ')));
  reg(['炼器', 'forge', 'lianqi'], (ctx, args) => doCraft(ctx, 'forge', args.join(' ')));
  reg(['画符', '制符', '布阵', '符箓', 'rune', 'lianfu'], (ctx, args) => doCraft(ctx, 'rune', args.join(' ')));

  /* ---------------- 收徒系统（SPRINT2 任务70） ---------------- */

  reg(['收徒', 'shoutu', '收弟子'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想收谁为徒？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    if (!npc.isNpc) return { lines: [{ kind: 'warn', text: '那可不是能收的徒儿。' }] };
    if (npc.def && npc.def.hostile) return { lines: [{ kind: 'warn', text: '对方杀机毕露，岂能收为弟子。' }] };
    p.disciples = p.disciples || [];
    if (p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}已是你的弟子。` }] };
    if (p.disciples.length >= 10) return { lines: [{ kind: 'warn', text: '你门下弟子已满（上限十人）。' }] };
    if (!Object.keys(p.learned || {}).length) return { lines: [{ kind: 'warn', text: '你自身尚无一技之长，如何为人师？' }] };
    p.disciples.push(npc.id);
    if (!npc.pstate) npc.pstate = {};
    npc.pstate.master = p.id;
    npc.master = p.id;
    const { addFavor } = require('./social');
    addFavor(w, npc, 30, '拜师');
    return { lines: [{ kind: 'sys', text: `${npc.name}向你磕头行礼，正式拜入你门下！` }] };
  });

  reg(['逐出师门', '弃徒', 'expel'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想逐出哪个弟子？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    p.disciples = p.disciples || [];
    if (!p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}并非你的弟子。` }] };
    p.disciples = p.disciples.filter(id => id !== npc.id);
    if (npc.pstate) npc.pstate.master = null;
    npc.master = null;
    return { lines: [{ kind: 'sys', text: `你已将${npc.name}逐出师门。` }] };
  });

  reg(['弟子', '徒弟', 'disciples'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    p.disciples = p.disciples || [];
    if (!p.disciples.length) return { lines: [{ kind: 'sys', text: '你门下尚无弟子。' }] };
    const names = p.disciples.map(id => { const n = w.getNpc(id); return n ? n.name : id; });
    return { lines: [{ kind: 'sys', text: '门下弟子：' + names.join('、') }] };
  });

  reg(['授艺', '传艺', 'teach', 'shouyi'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：授艺 <武学> <弟子>' }] };
    const skillKw = args.slice(0, -1).join(' ');
    const disKw = args[args.length - 1];
    const sid = Object.keys(p.learned || {}).find(id => { const d = w.getSkill(id); return d && (d.name === skillKw || d.name.indexOf(skillKw) >= 0); });
    if (!sid) return { lines: [{ kind: 'warn', text: `你并未习得「${skillKw}」，无从传授。` }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), disKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${disKw}」。` }] };
    p.disciples = p.disciples || [];
    if (!p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}并非你的弟子。` }] };
    const pLevel = (p.learned[sid] || {}).level || 1;
    const give = Math.max(1, Math.floor(pLevel * 0.6));
    npc.learned = npc.learned || {};
    const cur = npc.learned[sid] || { exp: 0, level: 0 };
    cur.level = Math.max(cur.level, give);
    npc.learned[sid] = cur;
    if (npc.recalc) npc.recalc();
    return { lines: [{ kind: 'sys', text: `你将${w.getSkill(sid).name}传授给${npc.name}（至 ${give} 级）。` }] };
  });

  /* ---------------- 扩展：房间自定义指令 ---------------- */

  const roomCmd = (ctx, cmd, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const rc = (room.commands || {})[cmd];
    if (rc) {
      if (rc.cond && !evalCond(rc.cond, ctx)) return rc.failMsg ? [{ kind: 'warn', text: rc.failMsg }] : null;
      return evalEffects(rc.effects || rc, ctx);
    }
    // NPC 身上也可挂指令
    return null;
  };

  /* ---------------- 主解析入口 ---------------- */

  /* ================================================================
   * B6 · 「此地可做」按钮点了没反应/说没有 —— 归一化入口
   *
   * 主人原话：「"回春堂后院"的"此地可做"有草药，点了却说此地没有草药，
   * **这肯定不是个例**」。实测确认确实是一类问题，不是孤例。
   *
   * 【根因 1· 渲染读的字段和判定读的字段对不上（主人猜的那条，成立）】
   *   前端「此地可做」按钮渲染自engine.roomActionsView()，
   *   它遍历 room.actions，逐条给出 { name, cmd, ok }，点下去执行的就是 a.cmd。
   *   而 commands.execute() 的解析顺序是：
   *       1) 内置指令 CMD 表 → 2) 方向 → 3) roomCmd → 4) questKeyword
   *   **内置指令表排在房间 action 前面**。于是只要 action 的动词撞上内置指令，
   *   action 就被内置指令整条吞掉，effects 永远不执行。
   *   全量实测（128 条room action）：**48 条的动词是内置指令**，
   *   其中 27 条是多词cmd（如 `get 药材` / `talk 郎中` / `list 当铺`）。
   *
   * 【根因 2 · questKeyword 只拿首词比对，多词 cmd 永远匹配不上】
   *   questKeyword(ctx, cmd0, args) 里做的是 `a.cmd === cmd`（严格相等）
   *   和 `keywords.some(k => cmd.includes(k))`，可 cmd 是**首词**。
   *   所以 `listen 说书` / `read 告示` / `knock 登闻鼓` / `search 书架`
   *   这类 action 无论玩家点按钮还是手输，都匹配不上，
   *   实测 7 条全部返回「「listen」是什么指令？」——纯静默失败。
   *
   * 【修法】统一收口在 execute() 这一处，不逐条打补丁：
   *   ① selfSuffRoomAction()：房间 action **自带 effects** 时优先于内置指令
   *      （自带 effects ＝作者明确写了要做什么，被吞掉就是 bug）；
   *      不带 effects 的仍旧交给内置指令（`harvest`/`sell`/`d`/`打坐`
   *      这些是**故意**委托给内置指令的，不能抢）。
   *   ② questKeyword 改用**整条输入串**参与匹配，多词 cmd 终于能命中。
   *   ③ gather 归一化：没有 effects 的 `get/采 <东西>` 类 action
   *      （如 `get 药材`、`get 稻种`）按「此处可采」语义兑现 ——
   *      去物品表里解析出真实物品给玩家。原先这类 action 点了必然
   *      「这里没有「药材」」，因为房间根本没放ground item。
   * ================================================================ */

  /* 采集类 action 的泛称→真实物品别名（只认「说得通」的映射，不乱给）
     房间地图数据里这些 action 只写了「药材」这种泛称，
     而物品表里没有叫「药材」的东西，必须有一张明确的对照表，
     否则玩家点一下什么也拿不到。 */
  const GATHER_ALIAS = {
    '药材': 'herb_lingshen', '草药': 'herb_lingshen', '药': 'herb_lingshen',
    '稻种': 'seed_rice', '种子': 'seed_rice', '菜种': 'seed_vegetable',
  };

  /** 从物品表解析一个「可采之物」；解析不出返回 null（不硬塞） */
  function resolveGatherable(w, name) {
    const items = w.data.items || {};
    const kw = String(name || '').trim();
    if (!kw) return null;
    if (GATHER_ALIAS[kw]) return GATHER_ALIAS[kw];
    /* 精确名→ id 精确匹配 */
    for (const id of Object.keys(items)) if (items[id] && items[id].name === kw) return id;
    /* 模糊：与别名表同key 的物品名也算命中 */
    const hit = fuzzyFind(Object.keys(items).map(id => ({ id, name: items[id] && items[id].name })), kw, x => x.name);
    return hit ? hit.id : null;
  }

  /** 房间 action 是否「自带 effects」（= 不该被内置指令吞） */
  function selfSuffRoomAction(ctx, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    for (const a of room.actions || []) {
      if (!a.cmd || !(a.effects && a.effects.length)) continue;
      if (a.cmd === rawFull) return a;
    }
    return null;
  }

  /** 没有 effects 的采集类 action → 兑现成真物品
   *
   *⚠️ 必须先确认「本房间真的声明了这么一条 action」才兑现，
   *   否则 `get 稻谷` 这种普通的捡地上东西，会被这里抢走
   *   （走giveItem 而不是 pickupItem，尸体/地面实例都不会被消耗）。
   *   所以这里查的是 room.actions，不是「看起来像采集指令」。 */
  function gatherRoomAction(ctx, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const raw = String(rawFull || '').trim();
    const m = /^(get|拿|取|采|摘|捡|拾取|take|pick)\s*(.+)$/i.exec(raw);
    if (!m) return null;
    /* 本房间是否声明了这条采集 action（cmd 或 keywords 命中） */
    const declared = (room.actions || []).some(a =>
      (a.cmd || '').trim() === raw || (a.keywords || []).some(k => k && raw.includes(k)));
    if (!declared) return null;
    const itemId = resolveGatherable(w, m[2]);
    if (!itemId) return null;   /* 解析不出就老实不处理，交给后续报「没有」 */
    if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const r = w.giveItem(p, itemId, 1);
    if (!r.ok) return { lines: [{ kind: 'warn', text: '你拿不动更多东西了。' }] };
    p.advanceTime(5);
    return {
      lines: [
        { kind: 'story', text: `你俯身拾起${r.name}。` },
        { kind: 'sys', text: `你得到了：${r.name} x1。` },
      ],
    };
  }

  function execute(input, ctx) {
    const raw = String(input || '').trim();
    if (!raw) return { lines: [] };
    // 支持 a;b;c 连续指令
    if (raw.includes(';')) {
      const lines = [];
      for (const part of raw.split(';')) {
        const r = execute(part, ctx);
        lines.push(...(r.lines || []));
        if (r.clear) return r;
      }
      return { lines };
    }
    const toks = tokenize(raw);
    const cmd0 = toks[0];
    let args = toks.slice(1);

    /* B6-① 房间 action 自带 effects 时，优先于内置指令表。
       没有这一层，`talk 禁军`（皇城·午门，明明白白写了 effects）
       会被内置 talk 吞掉，玩家永远看不到那两句写好的台词。 */
    const selfSuff = selfSuffRoomAction(ctx, raw);
    if (selfSuff) {
      if (selfSuff.cond && !evalCond(selfSuff.cond, ctx)) {
        return { lines: [{ kind: 'warn', text: selfSuff.failMsg || '现在做不了这个。' }] };
      }
      return { lines: evalEffects(selfSuff.effects, ctx) };
    }

    /* B6-③ 采集类 action 的归一化兑现。
       ⚠️ 必须排在「1) 内置指令」**之前**：回春堂·后院那条action 的 cmd
       就是 `get 药材`，而 `get` 是内置指令 —— 放在它后面永远轮不到，
       玩家只会听到 pickupItem 报「这里没有「药材」」。
       （gatherRoomAction 内部已确认「本房间确实声明了这条 action」，
         所以不会抢走普通的「捡地上东西」。） */
    const g0 = gatherRoomAction(ctx, raw);
    if (g0) return g0;

    // 1) 内置指令
    let entry = CMD[cmd0] || CMD[cmd0.toLowerCase()];
    if (entry) return entry.run(ctx, args) || { lines: [] };

    // 2) 纯方向「北」「走北」等
    if (DIRECTIONS[cmd0]) return doMove(ctx, DIRECTIONS[cmd0]);
    if ((cmd0 === '走' || cmd0 === '往' || cmd0 === '向') && args.length && DIRECTIONS[args[0]]) return doMove(ctx, DIRECTIONS[args[0]]);

    // 3) 房间/世界自定义指令
    const r1 = roomCmd(ctx, cmd0, args);
    if (r1) return { lines: r1 };

    // 4) 任务关键词（常见的任务动作）
    const r2 = questKeyword(ctx, cmd0, args, raw);
    if (r2) return { lines: r2 };

    // 5) mod 注册的自定义指令
    const cc = ctx.world.customCommands[cmd0];
    if (cc) {
      const res = cc({ args, raw, ctx, world: ctx.world, player: ctx.player });
      if (Array.isArray(res)) return { lines: res };
      if (res && res.lines) return res;
      if (typeof res === 'string') return { lines: [{ kind: 'plain', text: res }] };
    }

    // 6) 全局 mod 指令冲突检测
    for (const key of Object.keys(ctx.world.customCommands)) {
      if (key.startsWith('_')) continue;
    }

    // 7) 当作方向/房间名尝试移动
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (room) {
      for (const d of Object.keys(room.exits || {})) {
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        if (tr && (tr.name === cmd0 || tr.name.includes(cmd0))) return doMove(ctx, d);
      }
      // 7.5) 互动出口（爬山坡 / 跳崖 / 渡河…）：输入 via/hint 触发移动
      const full = (cmd0 + args.join('')).trim();
      if (full) {
        for (const d of Object.keys(room.exits || {})) {
          const ex = room.exits[d];
          if (!ex || typeof ex !== 'object') continue;
          const via = ex.via || '', hint = ex.hint || '';
          if (!via && !hint) continue;
          if (full === via || full === hint || via.includes(full) || full.includes(via) || hint.includes(full) || full.includes(hint)) {
            return doMove(ctx, d);
          }
        }
      }
    }

    // 8) 未知指令
    const guesses = [];
    const closeCmds = Object.keys(CMD).filter(c => c.length > 1 && (c.includes(cmd0) || cmd0.includes(c) || Math.abs(c.length - cmd0.length) === 0));
    const suggestion = closeCmds.slice(0, 3);
    return {
      lines: [
        { kind: 'warn', text: `「${cmd0}」是什么指令？你可以在心中默念「help」看看都会些什么。` },
        ...(suggestion.length ? [{ kind: 'hint', text: `你是不是想说：${suggestion.join(' / ')}？` }] : []),
      ]
    };
  }

  /* 任务关键词处理（如「摘桃子」「砍树」）
   *
   * B6-②：rawFull 是**整条输入串**。此前这里只拿首词 cmd 去比，
   * 导致 `listen 说书` / `read 告示` / `knock 登闻鼓` / `search 书架`
   * 这类多词 action 永远匹配不上（a.cmd 是整串，cmd 只有首词），
   * 玩家点按钮必然吃到「「listen」是什么指令？」。 */
function questKeyword(ctx, cmd, args, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const full = String(rawFull || (cmd + ' ' + (args || []).join(' ')).trim()).trim();
    /* action 的 cmd 既可能是整串（`listen 说书`），也可能只是首词（`采药`），
       两种写法都要认—— 这正是「渲染发的 cmd」与「判定匹配的 cmd」对齐的地方。 */
    const matchAction = a => {
      if (!a) return false;
      const ac = (a.cmd || '').trim();
      if (!ac) return false;
      if (ac === full || ac === cmd) return true;
      if (full && ac.startsWith(full)) return true;
      if ((a.keywords || []).some(k => k && (full.includes(k) || k.includes(full)))) return true;
      return false;
    };
    // 房间里的可交互物件
    const acts = room.actions || [];
    for (const a of acts) {
      if (matchAction(a)) {
        if (a.cond && !evalCond(a.cond, ctx)) return a.failMsg ? [{ kind: 'warn', text: a.failMsg }] : [{ kind: 'warn', text: '现在做不了这个。' }];
        if (!a.effects || !a.effects.length) {
          /* B6：action 存在但没写 effects（纯描述性/委托给内置指令的）。
             这里不能静默返回空数组 —— 玩家点了按钮却什么都没发生，
             正是主人报的「点了没反应」。
             注意措辞：不要把 desc 生硬拼进来（会出现
             「你溪里试试手气」这种半句话），只给一句明确的「无发现」。 */
          return [{ kind: 'plain', text: `你留心察看了一番，此处暂时没有更多可做的了。` }];
        }
        return evalEffects(a.effects, ctx);
      }
    }
    // NPC 身上的任务动作
    for (const n of w.npcsIncludingTemplates(p.room)) {
      const def = n.def || {};
      if (def.actions) {
        for (const a of def.actions) {
          if (a.cmd === cmd || (a.keywords || []).some(k => cmd.includes(k))) {
            if (a.cond && !evalCond(a.cond, { ...ctx, npc: n })) return [{ kind: 'warn', text: a.failMsg || '对方似乎不打算理会你。' }];
            return evalEffects(a.effects, { ...ctx, npc: n });
          }
        }
      }
    }
    // 全局任务关键词
    const gk = w.data.meta.globalActions || [];
    for (const a of gk) {
      if (a.cmd === cmd || (a.keywords || []).some(k => cmd.includes(k))) {
        if (a.room && a.room !== p.room) continue;
        if (a.cond && !evalCond(a.cond, ctx)) return a.failMsg ? [{ kind: 'warn', text: a.failMsg }] : null;
        return evalEffects(a.effects, ctx);
      }
    }
    return null;
  }

  /* 对话树运行 */
  function runDialogTree(ctx, npc, tree) {
    const lines = [];
    let node = tree.start || Object.keys(tree.nodes || {})[0];
    const w = ctx.world, p = ctx.player;
    let guard = 0;
    while (node && guard++ < 30) {
      const nd = tree.nodes[node];
      if (!nd) break;
      if (nd.text) {
        const n = nd.speaker === 'player' ? '你' : npc.name;
        lines.push({ kind: 'say', text: `${n}：${evalTemplate(nd.text, ctx)}` });
      }
      if (nd.effects) evalEffects(nd.effects, { ...ctx, npc }).forEach(l => lines.push(l));
      if (nd.options && nd.options.length) {
        const opts = nd.options.filter(o => !o.cond || evalCond(o.cond, { ...ctx, npc }));
        if (!opts.length) break;
        lines.push({ kind: 'menu', title: nd.prompt || '你要说什么？', options: opts.map(o => ({ label: o.label, effects: o.effects || [], goto: o.goto })), npc: npc.name });
        break;
      }
      if (nd.ask) {
        lines.push({ kind: 'ask', title: nd.ask.prompt || '你想问什么？', options: (nd.ask.topics || []).map(t => ({ label: t.label, effects: t.effects || [] })) });
        break;
      }
      node = nd.next;
      if (nd.end) break;
    }
    return lines;
  }

  function runDialogue(ctx, npc, dlg) {
    const lines = [];
    let node = dlg.start || 'start';
    const w = ctx.world;
    let guard = 0;
    while (node && guard++ < 40) {
      const nd = dlg.nodes[node];
      if (!nd) break;
      if (nd.text) lines.push({ kind: 'say', text: `${nd.speaker === 'player' ? '你' : npc.name}：${evalTemplate(nd.text, ctx)}` });
      if (nd.effects) evalEffects(nd.effects, { ...ctx, npc }).forEach(l => lines.push(l));
      if (nd.options && nd.options.length) {
        const opts = nd.options.filter(o => !o.cond || evalCond(o.cond, { ...ctx, npc }));
        lines.push({ kind: 'menu', title: nd.prompt || '你要说什么？', options: opts.map(o => ({ label: o.label, effects: o.effects || [], goto: o.goto })), npc: npc.name });
        break;
      }
      if (nd.end) break;
      node = nd.next;
    }
    return lines;
  }

  /* 交任务 */
  function tryReportQuest(ctx, npc, lines) {
    const p = ctx.player, w = ctx.world;
    const def = npc.def || {};
    const qs = def.quests || [];
    const reportable = [];
    for (const q of qs) {
      const st = p.questStage(q);
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(q);
      if (!qd) continue;
      const stage = qd.stages && qd.stages[st];
      // 判定阶段目标
      if (stage && stage.targets) {
        let ok = true;
        for (const t of stage.targets) {
          const cur = p.getVar(t.var || `q_${q}_${t.id}`) || 0;
          if (cur < (t.count || 1)) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (stage && stage.cond && !evalCond(stage.cond, ctx)) continue;
      reportable.push({ q, qd, stage, st });
    }
    if (!reportable.length) return false;
    const { q, qd, stage, st } = reportable[0];
    lines.push({ kind: 'say', text: `${npc.name}点了点头：「你办得不错。」` });
    /* 画像信任轴 trust 的增长通道（任务三）：**办成事才涨 trust**。
       送礼涨 favor（喜欢你），办事涨 trust（信得过你）——两条轴不混（design/01 §1.2）。
       trust 是画像 origin/now/want/fear（0/20/50/70）与 secret/feuds（40~65）的门槛；
       此前**全仓没有任何地方涨 trust** ⇒ 那些内容玩家永远看不到。这里补上。 */
    npc.pstate = npc.pstate || { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
    npc.pstate.trust = Math.min(100, (npc.pstate.trust || 0) + 8);
    // 清理阶段变量
    if (stage && stage.targets) for (const t of stage.targets) p.setVar(t.var || `q_${q}_${t.id}`, 0);
    if (stage && stage.effects) evalEffects(stage.effects, { ...ctx, npc }).forEach(l => lines.push(l));
    const next = (stage && stage.next !== undefined) ? stage.next : st + 1;
    const stages = qd.stages || [];
    if (next >= 99 || next >= stages.length) {
      p.setQuestStage(q, 99);
      lines.push({ kind: 'quest', text: `【任务完成】${qd.name}` });
      if (qd.rewards) evalEffects(qd.rewards, ctx).forEach(l => lines.push(l));
      if (def.repGainOnQuest) for (const k of Object.keys(def.repGainOnQuest)) p.reputation[k] = (p.reputation[k] || 0) + def.repGainOnQuest[k];
    } else {
      p.setQuestStage(q, next);
      lines.push({ kind: 'quest', text: `【任务进展】${qd.name}` });
      const ns = stages[next];
      if (ns && ns.desc) lines.push({ kind: 'plain', text: `下一步：${ns.desc}` });
    }
    return true;
  }

  /* 派发任务目标进度（击杀/采集等由 world 调用） */
  function advanceQuestCounters(ctx, kind, key, n) {
    const p = ctx.player, w = ctx.world;
    n = n || 1;
    const lines = [];
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd || !qd.stages || !qd.stages[st]) continue;
      const stage = qd.stages[st];
      for (const t of (stage.targets || [])) {
        if (t.kind !== kind) continue;
        /* 目标名单：单数 `key` 与复数 `keys` 是**两种等价写法**，必须一起认。
           ⚠️ 原写法 `if (t.key && t.key !== key && !(t.keys||[]).includes(key)) continue;`
           短路在 `t.key` 为假时整条不成立 → **只写 `keys` 的目标等于没写限制**：
           "击杀恶徒十个"变成"击杀任意人十个"（全库 3 条：q_emei_entry /
           q_huashan_sword_test / q_bounty_bandit）。现在按并集判定；
           两者都不写才是真的"击杀任意目标"（全库当前 0 条）。 */
        const wantK = t.key ? [t.key] : (Array.isArray(t.keys) ? t.keys : []);
        if (wantK.length && wantK.indexOf(key) < 0) continue;
        const vk = t.var || `q_${qid}_${t.id}`;
        const cur = (p.getVar(vk) || 0) + n;
        p.setVar(vk, Math.min(cur, t.count || 1));
        if (cur >= (t.count || 1)) {
          lines.push({ kind: 'quest', text: `【任务】${qd.name}：${t.desc || t.id} 已完成！` });
        }
      }
    }
    return lines;
  }

  /* ================================================================
   * 掳人 / 奴役 / 护院（kidnap.js）
   * 规矩：所有返回值都包成 { lines } —— commands.execute 只认 res.lines。
   * 装人这类「看一眼就知道违法」的玩法，全部按律法定代价（恶名阶梯），
   * 不做道德说教，只让官府和pty 传闻来找麻烦。
   * ================================================================ */
  const kdLines = (r) => ({ lines: (r && r.lines) || [] });
  const kdArg = (ctx) => String((ctx && ctx.args) || '').trim();

  /* ---- ① 掳人：把晕倒的 NPC 装进麻袋 ---- */
  reg(['pack', '装人', '掳走', '扛人'], (ctx) => kdLines(kidnapMod.packNpc(ctx.world, kdArg(ctx))));

  /* ---- ② 麻袋一览 / 放人 ---- */
  reg(['bags', '麻袋', '袋'], (ctx) => {
    const list = kidnapMod.listBags(ctx.world);
    const lines = [{ kind: 'title', text: '【 麻 袋 】' }];
    if (!list.length) lines.push({ kind: 'plain', text: '　你没扛着麻袋。' });
    for (const b of list) {
      const st = { out: '袋里', struggling: '正在挣扎', burst: '要冲出来了' }[b.state] || b.state;
      lines.push({
        kind: b.state === 'out' ? 'plain' : 'warn',
        text: `　第${b.idx}袋　${b.name}　${st}　（装进去 ${b.minutesIn} 分钟）`,
        bagIdx: b.idx, npcName: b.name,
      });
    }
    if (list.length) lines.push({ kind: 'hint', text: '　用「放人 <第几袋>」把人放出来。' });
    return { lines };
  });

  reg(['release', '放人'], (ctx) => kdLines(kidnapMod.releaseBag(ctx.world, kdArg(ctx) || 1)));

  /* ---- ③ 卖人 / 赎人 ---- */
  reg(['sellnpc', '卖人'], (ctx) => kdLines(kidnapMod.sellNpc(ctx.world, kdArg(ctx))));
  /* ⚠️ 「赎人」不能占 redeem/赎身 —— 那是青楼卖身线的既有指令（blood rule #27 同理）。
     赎回别人的名字一律带「买」字口：赎人 → 「赎回」。 */
  reg(['redeemnpc', '赎回', '赎出'], (ctx) => kdLines(kidnapMod.redeemPerson(ctx.world, kdArg(ctx))));

  /* ---- ④ 黑市买奴 ---- */
  reg(['buyslave', '买奴'], (ctx) => kdLines(kidnapMod.buySlave(ctx.world, kdArg(ctx))));

  /* ---- ⑤ 名册：麻袋 + 奴 + 护院 + 恶名 ---- */
  reg(['slaves', '奴册', '奴仆', '护院'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const k = kidnapMod.data(w);
    if (!k) return { lines: [{ kind: 'plain', text: '你还没上路。' }] };
    const q = kidnapMod.quotas(w);
    const wt = kidnapMod.wantedTier(k.wanted);
    const lines = [{ kind: 'title', text: '【 奴 册 】' }];
    /* 恶名 */
    lines.push({ kind: k.wanted > 0 ? 'warn' : 'plain', text: `　恶名：${k.wanted}（${wt.name}）` });
    if (wt.desc) lines.push({ kind: 'hint', text: '　' + wt.desc });
    /* 名额 */
    lines.push({ kind: q.slaves >= q.slaveMax ? 'plain' : 'hint', text: `　家资档：${q.name}　奴 ${k.slaves.length}/${q.slaveMax}　护院 ${k.guards.length}/${q.guardMax}` });
    /* 麻袋 */
    lines.push({ kind: 'subtitle', text: '麻袋里' });
    if (!k.bags.length) lines.push({ kind: 'plain', text: '　（空）' });
    for (const b of kidnapMod.listBags(w)) {
      lines.push({ kind: 'plain', text: `　第${b.idx}袋 ${b.name}（${b.minutesIn} 分钟）` });
    }
    /* 奴 */
    lines.push({ kind: 'subtitle', text: '名下的人' });
    if (!k.slaves.length) lines.push({ kind: 'plain', text: '　（无）' });
    for (const s of k.slaves) {
      const busy = s.task && s.taskEnds && w.clockMinutes < s.taskEnds;
      lines.push({
        kind: 'plain',
        text: `　${s.name}　服从 ${s.obedience}　好感 ${s.favor}　${busy ? `干活中（还剩 ${s.taskEnds - w.clockMinutes} 分钟）` : (s.waitingAt ? '在' + ((w.getRoom(s.waitingAt) || {}).name || s.waitingAt) + '等你' : '闲着')}`,
        npcName: s.name, slaveName: s.name,
      });
    }
    /* 护院 */
    lines.push({ kind: 'subtitle', text: '护院' });
    if (!k.guards.length) lines.push({ kind: 'plain', text: '　（无）' });
    for (const g of k.guards) {
      const busy = g.supervising && w.clockMinutes < (g.superviseEnds || 0);
      lines.push({ kind: 'plain', text: `　${g.name}　武力 ${g.power}　日薪 ${g.wage} 文　${busy ? '正盯着' + g.supervising + '干活' : '看家'}${g.loyalty < 30 ? '　（离心）' : ''}` });
    }
    if (k.wageDue) lines.push({ kind: 'warn', text: `　欠工钱 ${k.wageDue} 文（拖久了护院会走）` });
    /* 债务（玩家自己被掳走） */
    if (k.debt) {
      const bm = kidnapMod.BLACK_MARKETS.find(b => b.id === k.debt.market) || {};
      lines.push({ kind: 'warn', text: `【你在${bm.name || '黑市'}】赎金 ${k.debt.ransom} 文　可用「赎身」或「突围」` });
    }
    return { lines };
  });

  /* ---- ⑥ 派活 ---- */
  reg(['task', '使唤', '派活'], (ctx) => {
    const arg = kdArg(ctx);
    /* 「使唤」不带活名 → 列可选活；带活名 → 派 */
    const TASK_KEYS = { '做工': 'craft', '土工': 'craft', '采买': 'purchase', '跑腿': 'errand', '洗衣': 'laundry' };
    let taskKey = TASK_KEYS[arg];
    let who = '';
    if (!taskKey) {
      const parts = arg.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) { who = parts[0]; taskKey = TASK_KEYS[parts[1]]; }
      else if (parts.length === 1) { who = parts[0]; }
    }
    if (!taskKey) {
      const k = kidnapMod.data(ctx.world);
      if (!k || !k.slaves.length) return { lines: [{ kind: 'plain', text: '你名下没人。' }] };
      const lines = [{ kind: 'title', text: '【 派 活 】' }];
      for (const s of k.slaves) lines.push({ kind: 'plain', text: `　${s.name}　服从 ${s.obedience}　好感 ${s.favor}`, slaveName: s.name });
      lines.push({ kind: 'subtitle', text: '可派的活' });
      for (const key of Object.keys(kidnapMod.TASKS)) {
        const t = kidnapMod.TASKS[key];
        lines.push({ kind: 'plain', text: `　${t.name}：${t.desc}　约赚 ${t.earn[0]}~${t.earn[1]} 文`, taskKey: key });
      }
      lines.push({ kind: 'hint', text: '　用法：使唤 <人名> <活名>，如「使唤 阿福 采买」' });
      return { lines };
    }
    return kdLines(kidnapMod.assignTask(ctx.world, who, taskKey));
  });

  /* ---- ⑦ 跟随 ---- */
  reg(['follow', '跟随', '邀跟随'], (ctx) => kdLines(kidnapMod.inviteFollow(ctx.world, kdArg(ctx))));

  /* ---- ⑧ 护院：雇 / 结薪 / 监督 ---- */
  reg(['hireguard', '雇护院', '请护院'], (ctx) => kdLines(kidnapMod.hireGuard(ctx.world, kdArg(ctx))));
  reg(['wages', '发工钱', '结薪'], (ctx) => kdLines(kidnapMod.payWages(ctx.world)));
  reg(['supervise', '监督', '盯着'], (ctx) => kdLines(kidnapMod.supervise(ctx.world, kdArg(ctx))));

  /* ---- ⑨ 玩家自己被掳走后的三条路 ----
   * 赎身/赎回/脱籍 由上面那个「赎身」按场景统一分派，这里不再重复注册。
     只补黑市专用的突围（武力打出去），以及还债。 */
  reg(['escape', '突围', '打出去'], (ctx) => {
    const r = kidnapMod.escapeMarket(ctx.world);
    /* B22 埋点 14/14 · rs_jailbreak（越狱/突围成功，重案 −）：大动静 → 邻房也传。 */
    if (r && r.ok && typeof ctx.world.addRumor === 'function') {
      ctx.world.addRumor('rs_jailbreak', { room: ctx.player.room, about: 'court', vars: { who: ctx.player.name || '有人', where: '黑市' } });
    }
    return kdLines(r);
  });
  reg(['workdebt', '还债', '打工还债'], (ctx) => {
    const r = kidnapMod.workOffDebt(ctx.world, 60);
    if (!r || !r.ok) {
      /* 一次性还不上，就走普通打工 + 记一笔 */
      const r2 = workMod.work(ctx.world);
      return { lines: ((r && r.lines) || []).concat(r2.lines || []) };
    }
    return kdLines(r);
  });

  return { CMD, execute, doMove, lookRoom, scoreLines, describeItem, lookNpc, advanceQuestCounters, DIRECTIONS, DIR_CN, cnNum, runDialogue };
}

/* ============================================================
 * 好感详情（favor <人名> 用）
 * ============================================================ */
function favorDetail(w, npc) {
  const def = npc.def || {};
  const t = social.favorTier(npc.favor);
  const lines = [
    { kind: 'title', text: `【 ${npc.name} 】` },
    { kind: 'plain', text: `　身份：${npcIdentity(w, npc)}　${genderNoun(npc)}　${npc.level || 1} 级` },
    { kind: 'favor', text: `　好感：${npc.favor || 0}（${t.name}）—— ${t.cn}`, color: t.color, favor: npc.favor || 0, tier: t.name },
  ];

  /* 喜爱的东西 */
  const likes = (def.likes || []).map(x => social.LIKE_TYPES.find(y => y.id === x)).filter(Boolean);
  if (likes.length) {
    lines.push({ kind: 'subtitle', text: '喜爱之物' });
    for (const l of likes) lines.push({ kind: 'plain', text: `　${l.cn}`, likeType: l.id, color: '#c07a4a' });
  }

  /* 可请教的武学 */
  const tl = social.teachList(w, npc);
  if (tl.length) {
    lines.push({ kind: 'subtitle', text: '可请教武学' });
    for (const s of tl.slice(0, 6)) {
      const ok = (npc.favor || 0) >= s.favorNeed;
      lines.push({
        kind: 'skill',
        text: `　${s.name}【${s.quality}】需好感 ${s.favorNeed}${ok ? ' ✔' : ''}${s.money ? `　或 ${s.money} 文` : ''}`,
        skillId: s.id, favorNeed: s.favorNeed, money: s.money, ok,
      });
    }
    if (tl.length > 6) lines.push({ kind: 'hint', text: `　…还有 ${tl.length - 6} 门，用「qingjiao ${npc.name}」看全部。` });
  }

  /* 住处 */
  if (def.home) {
    const r = w.getRoom(def.home);
    lines.push({ kind: 'plain', text: `　住处：${r ? r.name : def.home}` });
  } else {
    lines.push({ kind: 'plain', text: '　住处：无（居无定所）' });
  }

  /* 身上财物（模糊提示，不直接列清单） */
  const carry = npc.carry || def.carry || {};
  const cnums = (carry.items || []).length;
  if (cnums || carry.money) {
    lines.push({ kind: 'hint', text: `　（${pronounOf(npc)}怀里似乎${carry.money ? '揣着钱' : ''}${carry.money && cnums ? '，还' : ''}${cnums ? `带着 ${cnums} 样东西` : ''}）` });
  }

  /* 关系 */
  const rel = npc.rel || def.rel || [];
  if (rel.length) {
    lines.push({ kind: 'subtitle', text: '人际' });
    for (const r of rel.slice(0, 5)) {
      const o = w.data.npcs[r.id];
      if (!o) continue;
      lines.push({ kind: 'plain', text: `　${relKindCN(r.kind)}　${o.name}（${npcIdentity(w, o)}）`, relId: r.id, relKind: r.kind });
    }
    lines.push({ kind: 'hint', text: `　用「guanxi ${npc.name}」看全部关系。` });
  }
  return lines;
}

const TAG_CN = {
  commoner: '寻常百姓', vendor: '市井摊贩', scholar: '书生', farmer: '农户', smith: '铁匠',
  doctor: '郎中', innkeeper: '客栈掌柜', waiter: '店小二', merchant: '商贾', richman: '富户',
  groom: '车夫', child: '孩童', beggar: '乞丐', refugee: '流民', escort: '镖师',
  constable: '捕快', official: '官员', eunuch: '太监', palace: '宫人', consort: '妃嫔',
  courtesan: '风尘女子', madam: '老鸨', singer: '乐伎', swordsman: '侠客', thief: '盗贼',
  hunter: '猎户', monk: '僧人', nun: '尼姑', taoist: '道人', actor: '戏子',
  boatman: '船夫', gambler: '赌徒', waiter2: '茶博士',
};
function tagCN(t) { return TAG_CN[t] || t; }

/* ============================================================
 *  NPC 身份（主人 20261010h 要求）
 *  以前看人写「江湖中人」、看关系写「（住江南城·长街）」——都是废话，
 *  住处人人一个样（大多就在本城），身份才是一个人在这江湖里的位置。
 *  优先级：门派职位 > title（捕快/郎中/富户…）> job > tag > 按名字猜 > 江湖散人。
 *  ⚠️ 名人（君子剑、九指神丐…）的 title 是**称号**不是身份，
 *     但他们都有 sect，所以门派那条先走 —— 岳不群显示「华山派掌门」而不是「君子剑」。
 * ============================================================ */
const JOB_CN = {
  swordsman: '刀客', doctor: '郎中', innkeeper: '客栈掌柜', monk: '僧人',
  constable: '捕快', taoist: '道人', nun: '尼姑', vendor: '货郎', scholar: '书生',
  farmer: '农人', smith: '铁匠', merchant: '行商', richman: '富户', groom: '马夫',
  escort: '镖师', official: '官吏', madam: '鸨母', waiter: '店伙', thief: '盗贼',
  hunter: '猎户', actor: '戏子', boatman: '艄公', gambler: '赌徒',
};

/** 关系单字 → 双字词（主人：别写「友」「仇」，写「友人」「仇人」） */
const REL_KIND_CN = {
  亲: '亲人', 友: '友人', 仇: '仇人', 师: '师长', 生: '门生',
  夫妻: '夫妻', 妾: '姬妾', 义: '义兄弟', 结缘: '结缘人',
};

/** 「友」→「友人」；不认识的关系词原样返回（宁可原样也不瞎编） */
function relKindCN(k) {
  if (!k) return '熟人';
  if (REL_KIND_CN[k]) return REL_KIND_CN[k];
  /* ⚠️ 已经是词（如「义兄」「结拜兄弟」）就原样返回，别再补「人」变成「义兄人」 */
  if (k.length >= 2) return k;
  return k + '人';
}

/* ================================================================
 * NPC 之间对第三方的好感度（主人：关系界面要显示「好感度：-70」）
 *
 * ⚠️ 别搞错对象：`npc.favor` 是「他对**玩家**的好感」，
 *    套到关系列表里的第三方头上就是张冠李戴（历史上 favor 面板就翻过车）。
 *
 * 三级取值：
 *   ① npc.relFavor[对方 defId] —— 运行时浮动值（送礼/结仇事件改的），优先
 *   ② r.favor                  —— 数据里直接写死的
 *   ③ 按 kind 给基准值（确定性，不用 rng：同一个 NPC 每次看必须是同一个数，
 *      不然玩家刷新一次数字就跳一次，会以为是 bug）
 * ============================================================ */
const REL_FAVOR_BASE = { 友: 60, 亲: 90, 师: 70, 生: 65, 夫妻: 100, 仇: -70, 敌: -60 };
function relFavorBetween(npc, other, rel) {
  const oid = (other && (other.defId || other.id)) || null;
  const dyn = npc && npc.relFavor && oid ? npc.relFavor[oid] : undefined;
  if (Number.isFinite(dyn)) return Math.max(-100, Math.min(100, Math.round(dyn)));
  if (rel && Number.isFinite(Number(rel.favor))) {
    return Math.max(-100, Math.min(100, Math.round(Number(rel.favor))));
  }
  const base = REL_FAVOR_BASE[rel && rel.kind];
  /* 没定基准的 kind 走 0（陌生人 / 未定性），别硬凑一个数字骗玩家 */
  return base === undefined ? 0 : base;
}
/** 好感度显示：正数带 + 号，负数带 −（中文负号），0 显示「中立」 */
function fmtRelFavor(v) {
  const n = Math.round(v || 0);
  if (n === 0) return '0（不相干）';
  return (n > 0 ? '+' : '−') + Math.abs(n);
}

/**
 * 这个 NPC 是什么身份。
 * @param {object} w world
 * @param {object} npc 实例或模板都可
 */
function npcIdentity(w, npc) {
  const d = npc.def || npc || {};
  const sectId = npc.sect || d.sect;
  const rank = npc.rank || d.rank;

  /* ① 门派职位：华山派 + ranks[5] → 「华山派掌门」
     ⚠️ `rank` 是 **0 基下标**（玩家升级走 `ranks[p.rank]`，见 character.js:585），
        所以直接下标取，**不要 -1**。数据里掌门写 rank:5 对应 ranks 数组第 6 项。 */
  if (sectId) {
    const s = (w.data.sects || {})[sectId];
    if (s) {
      const rk = Number.isFinite(rank) ? rank : 0;
      const rn = (s.ranks || [])[rk];
      if (rn) return s.name + rn;
      /* 下标越界（数据写错）→ 至少把门派名报出来，别吞成「江湖中人」 */
      return s.name + '中人';
    }
    return '江湖门派中人';
  }

  /* ② title：捕快 / 郎中 / 寻常百姓 / 青楼女子……（已是身份词） */
  const title = npc.title || d.title;
  if (title && title.length <= 6) return title;

  /* ③ job */
  const job = npc.job || d.job;
  if (job && JOB_CN[job]) return JOB_CN[job];

  /* ④ tag：B 层 NPC（npcv_*）没 title，靠 tag */
  const tag = npc.tag || d.tag;
  if (tag && TAG_CN[tag]) return TAG_CN[tag];

  /* ⑤ 按名字猜（野兽/贼众这类没任何标记的） */
  const nm = npc.name || '';
  if (/狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(nm)) return '山中猛兽';
  if (/山贼|贼众|强盗/.test(nm)) return '山贼';
  if (/兵丁|官兵|士兵/.test(nm)) return '官兵';
  if (/刺客|黑衣人/.test(nm)) return '来路不明的刺客';
  if (/流民|叫花|乞丐/.test(nm)) return '流民';

  return '江湖散人';
}

/**
 * 自动寻路被门禁挡住时，给一句人话提示（而不是干巴巴的「找不到路」）。
 * 做法：全图忽略门禁 BFS 找一条路，再沿路找第一道 con不满足的边，报它的 msg。
 * @returns {string|null}
 */
function lockedEdgeHint(world, from, to, ctx) {
  const anyPath = findPath(world, from, to, null);
  if (!anyPath || !anyPath.length) return null;
  let cur = from;
  for (const step of anyPath) {
    const room = world.getRoom(cur);
    if (!room) return null;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (tid !== step) continue;
      if (ex && ex.cond) {
        let ok = true;
        try { ok = !!evalCond(ex.cond, ctx); } catch (e) { ok = true; }
        if (!ok) return ex.msg || '那边过不去。';
      }
    }
    cur = step;
  }
  return null;
}

/* 简易寻路（BFS）
   ⚠️ 必须能跳过「上锁的出口」，否则玩家一句 `go 太和殿` 就瞬移进皇宫，
      `doMove` 里那道 ex.cond 门禁形同虚设（这就是门禁数据填了也不生效的根因）。
   cond 里可能带 item/sect/rank/title 等拿不到 player 的判定，
   这时保守当作「通得过」——真正拦得住门的 cond（item/flag/sect）都不依赖随机。
   @param {object} ctx 可选。给了就按玩家真实条件过滤；不给则忽略门禁（旧行为）。 */
function findPath(world, from, to, ctx) {
  if (from === to) return [];
  const q = [[from]];
  const seen = new Set([from]);
  const canPass = (ex) => {
    if (!ex || !ex.cond) return true;
    if (!ctx || !ctx.player) return true;
    try { return !!evalCond(ex.cond, ctx); } catch (e) { return true; }
  };
  while (q.length) {
    const path = q.shift();
    const cur = path[path.length - 1];
    const room = world.getRoom(cur);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (!tid || seen.has(tid)) continue;
      /* 被锁住的出口不走（路径里若已锁，直接中断——返回的路径玩家走不通） */
      if (!canPass(ex)) continue;
      const np = path.concat(tid);
      if (tid === to) return np.slice(1);
      seen.add(tid);
      q.push(np);
      if (seen.size > 3000) return null;
    }
  }
  return null;
}

module.exports = {
  buildCommands, findPath, cnNum, DIRECTIONS, DIR_CN,
  /* 身份标签 / 关系称谓：导出给测试与其它模块用（见 tools/identity-check.js） */
  __api: {
    npcIdentity, relKindCN, tagCN, JOB_CN, TAG_CN, REL_KIND_CN, relFavorBetween, fmtRelFavor, REL_FAVOR_BASE,
    /* 熟练度档位 + 洞察门槛：NPC 详情面板要跟「看人」显示同一口径，
       各写一份迟早漂移（`ui.js` 的武学面板也读它）。 */
    skillTierCN, npcInsight,
  },
};
