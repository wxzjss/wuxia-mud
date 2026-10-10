'use strict';
/* ==========================================================================
 *  新手引导 · 状态机（2026-10-09 重做）
 *
 *  重做原因（旧版三个致命 bug）：
 *    1. 第3/4 步永远完不成 —— `i`/`score` 被前端 PANEL_CMDS 拦成面板，
 *       根本不调 api.exec，而后端 flag 只挂在 exec 上 → did_bag/did_score 永不置位。
 *    2. 第 10 步自动完成 —— 兜底条件 `inventory.length > 5` 与「有没有拾取」无关，
 *       随便买点东西就亮了。
 *    3. 没有顺序 —— 各步独立求值，玩家一步跳过前面所有步。
 *
 *  新原则：
 *    1. **只测玩家状态，不测 UI 动作**。面板化会改路由，状态不会。
 *    2. **顺序游标**：前一步没完成，后面的步一律锁住（locked），杜绝跳步假完成。
 *    3. **零兜底**：不允许 `|| 某个状态` 这种与教学目标无关的捷径。
 *    4. 面板类步骤由前端显式上报 `markGuide(flag)`（见 ui.js PANEL_GUIDE_FLAG）。
 * ========================================================================== */

/**
 * 引导步骤定义。
 * 每步：id / title / goal / hint / requires（前置 step id 数组）/ test(p)
 */
const STEPS = [
  {
    id: 'look',
    title: '先看看脚下',
    goal: '认清这是什么地方、身上有什么',
    hint: '敲 look（「看」「看看四周」也行）',
    requires: [],
    test: (p) => p.tutorialFlags.has('did_look'),
  },
  {
    id: 'move',
    title: '挪一步',
    goal: '换个落脚的地方',
    hint: '敲 n 往北，或 s / e / w 换方向；点左侧「世界 · 地图」，挑隔壁那间走过去也行',
    requires: ['look'],
    /* 纯状态：真的换了个房间（而不是「按过方向键」） */
    test: (p) => p.tutorialFlags.has('did_move'),
  },
  {
    id: 'skill',
    title: '练一趟功',
    goal: '动一动气血，身上添几分底气',
    hint: '敲 lian 练功（「练功」「打坐」都行）；武学面板里挑一门功法打坐也可',
    requires: ['move'],
    /* 纯状态：真的动过武学（练功次数/熟练度增长），不是「按过按钮」 */
    test: (p) => p.tutorialFlags.has('did_train')
      || (typeof p.practiceCount === 'number' && p.practiceCount > 0),
  },
  {
    id: 'talk',
    title: '搭句话',
    goal: '找身边的人搭句话',
    hint: '敲 talk <人名> 攀谈，或 ask <人名> 打听几句',
    requires: ['skill'],
    test: (p) => p.tutorialFlags.has('did_talk'),
  },
  {
    id: 'quest',
    title: '接一桩活计',
    goal: '领一桩旁人托付的活儿',
    hint: '找个人用「接任务 <任务名>」（或 accept）接下；敲「任务」看手里有哪些委托',
    requires: ['talk'],
    /* 排除主线：主线是背景推进，不是新手该领的第一桩活 */
    test: (p) => p.tutorialFlags.has('did_accept')
      || Object.keys(p.quests || {}).some(k => k !== 'q_main_jianghu'),
  },
  {
    id: 'fight',
    title: '动一次手',
    goal: '赢下一场架',
    hint: '找个下得去手的「动手 <人名>」（kill）；打不过就「逃跑」（flee）',
    requires: ['quest'],
    test: (p) => (p.kills || 0) >= 1,
  },
  {
    id: 'sect',
    title: '拜进门派',
    goal: '拜进门派，学一身真本事',
    hint: '走到门派山门前，「拜师 <门派>」（join）。少林、武当、华山、峨眉，各有各的绝学',
    requires: ['fight'],
    test: (p) => !!p.sect,
  },
  {
    id: 'save',
    title: '把这一程存下',
    goal: '存下这一程，下回接着走',
    hint: '敲「存档」（save）；下回点「继续游戏」，接着这条路走',
    requires: ['sect'],
    test: (p) => p.tutorialFlags.has('did_save'),
  },
  {
    id: 'free',
    title: '往后的路自己走',
    goal: '往后的路，自己拿主意',
    hint: '点左侧「世界 · 地图」看舆图，四处走走，寻访五派的信物',
    requires: [],
    test: () => false,   // 永不完成，作为「毕业」提示
  },
];

/** 指令 -> 引导标记 的映射（玩家做了这些动作就点亮对应步骤） */
const CMD_FLAGS = {
  look: 'did_look', l: 'did_look', 看: 'did_look', 观察: 'did_look', 查看四周: 'did_look',
  lian: 'did_train', train: 'did_train', 练功: 'did_train', 打坐: 'did_train', 修炼: 'did_train',
  talk: 'did_talk', ask: 'did_talk', 交谈: 'did_talk', 询问: 'did_talk', 打招呼: 'did_talk',
  accept: 'did_accept', 接取: 'did_accept', 接任务: 'did_accept', 领任务: 'did_accept',
  get: 'did_get', take: 'did_get', 捡: 'did_get', 拾取: 'did_get', 拿: 'did_get', 捡起: 'did_get',
  save: 'did_save', 存档: 'did_save', 保存: 'did_save',
  n: 'did_move', s: 'did_move', e: 'did_move', w: 'did_move', u: 'did_move', d: 'did_move',
  north: 'did_move', south: 'did_move', east: 'did_move', west: 'did_move',
  北: 'did_move', 南: 'did_move', 东: 'did_move', 西: 'did_move',
  往北走: 'did_move', 往南走: 'did_move', 往东走: 'did_move', 往西走: 'did_move',
};

/**
 * 非指令类的引导标记：由特定流程显式上报，不走 CMD_FLAGS 的「指令→标记」映射。
 * 目前只有 `seen_intro`（看过开场剧情）。markTutorialFlag 的白名单需包含它们。
 */
const EXTRA_FLAGS = ['seen_intro'];

/* ==========================================================================
 *  楔子分版（B9 重写 · design/17-intro-rewrite.md）
 *
 *  舞台 = 玩家真实出生房间 `road_jiangnan_1`（江南大路·老槐树·茶摊，与 meta.startRoom 同源），
 *  不再用虚构的「风雪破庙」（旧版舞台与出生点空间断裂，已修）。
 *
 *  分版依据：出身 `player.birth`（6 个 id，由 world.js applyBirth() 写入并随存档持久化）。
 *  ⚠️ 取版**不引入随机数** —— 同一存档每次必须读到同一版，否则回档会换脸。
 *  ⚠️ 主线第一幕幕末信物「半块东厂铜牌」/「失忆」设定**一律不出现在楔子里**
 *     （前者会被开场剧透，后者正与总纲「根治剧情外失忆」的方向相反），由回归断言钉死。
 * ========================================================================== */

/** 出身（birth id）→ 楔子版本。6 个归 4 版；未知/缺失由取版处回落 'commoner'（V1）。 */
const BIRTH_TO_INTRO = {
  orphan: 'commoner', hunter: 'commoner',   // 寒门草莽
  wuxue: 'wulin', noble: 'wulin',           // 武家官家
  scholar: 'scholar', merchant: 'merchant', // 书香门第 / 商贾之后
};

/** 楔子 4 版文本。末段（第 5 段）用 `intro-p intro-em` 作叙事化行动引导（独立强调段）。 */
const INTRO_VARIANTS = {
  /* V1 寒门草莽（orphan / hunter）· 末段收束＝身体的一个具体动作 */
  commoner: {
    title: '【楔子】一双破草鞋',
    body:
      '<p class="intro-p">江南大路的日头刚爬上老槐树，你一双草鞋已经磨穿了底。方才在南边岔路口，' +
      '两个汉子拦住你要买路钱，你攥紧扁担退了两步，退到这儿才甩开他们。</p>' +
      '<p class="intro-p">你蹲在树底下喘气。身上就一件粗布短褂、一柄削尖的木棍，怀里半块硬得硌牙的干饼——' +
      '这是你从家里带出来的全部家当。</p>' +
      '<p class="intro-p">树荫边支着个卖茶的小摊，一个老汉蹲在灶前扇火，斜眼瞥了你一下，没作声。' +
      '北边二里就是江南城，城门口挂着招贤的幡子；进了城、入了门派，才算在江湖上有个名号。</p>' +
      '<p class="intro-p">你摸了摸发软的两条腿，心里清楚：这一路打不过人，护不住自己，进了城也是白搭。</p>' +
      '<p class="intro-p intro-em">你把扁担往肩上一横，撑着地站起身来。草鞋底早磨穿了，碎石硌着脚心——疼，人却醒着。</p>',
  },
  /* V2 武家官家（wuxue / noble）· 末段收束＝一句未说完的话 */
  wulin: {
    title: '【楔子】一柄空剑鞘',
    body:
      '<p class="intro-p">日头刚爬上江南大路的老槐树，你身上的绸衫已经蒙了一层灰。' +
      '南边岔路口那两个拦路的汉子没敢近身——他们瞧见了你腰间那柄剑。</p>' +
      '<p class="intro-p">可你心里有数：剑是爹留下的，剑鞘是新的，剑法是空的。真动上手，三招之内你就得伏低。</p>' +
      '<p class="intro-p">老槐树底下支着个茶摊，卖茶的老汉搁下碗，问了句「客官是往北去，还是往回走」。你答不上来。' +
      '往北是江南城，城里门派不少，可收不收你这样的空架子，得看有没有人肯教真功夫。</p>' +
      '<p class="intro-p">你捏了捏剑柄，手心的汗把缠绳都浸湿了。</p>' +
      '<p class="intro-p intro-em">老汉的话没有说完。他盯着你腰后那柄剑看了半晌，后半句咽了回去，只低头去拨灶里的柴。</p>',
  },
  /* V3 书香门第（scholar）· 末段收束＝一个算不通的账 */
  scholar: {
    title: '【楔子】一口旧书箱',
    body:
      '<p class="intro-p">江南大路的日头照在你那口书箱上，箱子比人还沉。你是从北边书斋里出来的，' +
      '家里盼你秋闱中举，你却揣了一封信，要去江南城寻一位旧识。</p>' +
      '<p class="intro-p">方才在南边岔路口，两个泼皮见你像个读书人，伸手就要翻箱子。你护着书退到这儿，手心还在抖。这条江湖道，你才走了第一日。</p>' +
      '<p class="intro-p">老槐树底下支着个茶摊。老汉斜眼打量你，丢来一句「读书人，这年头，书不顶饭吃」。你脸上一热，没接话。北边二里就是江南城，城里的门派多过书院，可没有一家肯收手无缚鸡之力的读书人。</p>' +
      '<p class="intro-p">你掏出那封信，纸角已被汗浸软。</p>' +
      '<p class="intro-p intro-em">信上只写着进城寻人，没写那人住在哪条巷、何等模样。你掐指算了算：盘缠够走三日，名帖却一张没有；三日之内寻不着人，你只能饿着往回走。</p>',
  },
  /* V4 商贾之后（merchant）· 末段收束＝一个别人给的麻烦 */
  merchant: {
    title: '【楔子】一袋碎银',
    body:
      '<p class="intro-p">江南大路的日头升起来时，你正数着钱袋里的碎银。昨夜在南边岔路口破财免灾，' +
      '给了那伙人两锭，才换得一条活路。</p>' +
      '<p class="intro-p">骡子驮着两箱货，垂着耳朵站在道边；你摸了摸它脖子上的鬃，手却在抖。' +
      '钱是够的，命是轻的。真遇上不讲理的，你连还手都不会——银子只会招祸。</p>' +
      '<p class="intro-p">老槐树底下支着个茶摊，卖茶的老汉盯着你的骡子瞧，瞧得你后颈发凉。' +
      '北边二里就是江南城，城里有镖局，也有门派。</p>' +
      '<p class="intro-p">跑商的老客早说过：想在江湖上走货，自己得先站得住。</p>' +
      '<p class="intro-p intro-em">昨夜那伙人临走撂下一句话。往北去可以，别再往南来。</p>',
  },
};

/**
 * 沉浸式开场剧情（楔子）：玩家首次进入江湖时弹出，讲清「你是谁、在哪、手里有什么」。
 *
 * show 由 seen_intro 标记控制 —— 看过就不再弹（跨存档留存）。
 * tutorialFlags 可能是数组（存读档）或 Set（运行时），两种都兼容。
 * 版本由 player.birth 决定（见上方 BIRTH_TO_INTRO / INTRO_VARIANTS）。
 */
function introFor(player, tutorialFlags) {
  const flags = tutorialFlags || (player && player.tutorialFlags) || [];
  const shown = Array.isArray(flags)
    ? flags.indexOf('seen_intro') >= 0
    : (typeof flags.has === 'function' && flags.has('seen_intro'));
  if (shown) return { show: false, title: '', body: '' };

  /* 按出身取版；未知 / 缺失一律回落 V1（commoner，最中性）。不用随机数。 */
  const key = BIRTH_TO_INTRO[player && player.birth] || 'commoner';
  const picked = INTRO_VARIANTS[key] || INTRO_VARIANTS.commoner;
  return { show: true, title: picked.title, body: picked.body };
}

/**
 * 计算当前引导状态（顺序游标版）
 *
 * 关键：顺序推进——遇到第一个未完成的步就停，后面的步即便状态满足
 * 也强制 done=false并标 locked。这是消灭「跳步假完成」的关键。
 */
function guideState(player, tutorialFlags) {
  const flags = new Set(tutorialFlags || []);
  const p = Object.assign({}, player, { tutorialFlags: flags });

  const real = STEPS.filter(s => s.id !== 'free');

  /* 第一轮：逐个求值，前置未满足的一律锁住 */
  const doneMap = {};
  const rawDone = {};
  real.forEach((s) => {
    let ok = false;
    try { ok = !!s.test(p); } catch (e) { ok = false; }
    rawDone[s.id] = ok;
  });

  /* 第二轮：按顺序推进游标 */
  let cursor = real.length;
  let broke = false;
  real.forEach((s, i) => {
    if (broke) { doneMap[s.id] = false; return; }
    const prereqOk = (s.requires || []).every(r => doneMap[r]);
    if (rawDone[s.id] && prereqOk) doneMap[s.id] = true;
    else { doneMap[s.id] = false; broke = true; cursor = i; }
  });

  const steps = STEPS.map((s, idx) => {
    const isReal = s.id !== 'free';
    const done = isReal ? !!doneMap[s.id] : false;
    const locked = isReal && !done && (s.requires || []).some(r => !doneMap[r]);
    return {
      id: s.id, title: s.title, goal: s.goal, hint: s.hint,
      done, locked: !!locked, index: idx,
    };
  });

  const doneCount = real.filter(s => doneMap[s.id]).length;
  const current = cursor < real.length ? real[cursor] : null;

  return {
    steps,
    current: current
      ? { id: current.id, title: current.title, goal: current.goal, hint: current.hint }
      : null,
    doneCount,
    total: real.length,
    finished: cursor >= real.length,
    nextGoal: current ? current.goal : '自己拿主意',
  };
}

/** 根据玩家执行的指令返回应该点亮的标记 */
function flagForCommand(cmd, args) {
  const c = String(cmd || '').trim().toLowerCase();
  if (CMD_FLAGS[c]) return CMD_FLAGS[c];
  /* go <房间名>：地图点击移动走这条路 */
  if (c === 'go' && args && args.length) return 'did_move';
  if (c === 'go') return 'did_move';
  return null;
}

module.exports = { STEPS, CMD_FLAGS, EXTRA_FLAGS, introFor, guideState, flagForCommand };