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
    title: '看清四周',
    goal: '看看自己身在何处',
    hint: '输入 look（或中文「看」「看看四周」）',
    requires: [],
    test: (p) => p.tutorialFlags.has('did_look'),
  },
  {
    id: 'move',
    title: '迈开脚步',
    goal: '挪一步换个地方',
    hint: '输入 n 往北走，或 s/e/w 换方向；也可以点左侧「世界 · 地图」，选相邻房间走过去',
    requires: ['look'],
    /* 纯状态：真的换了个房间（而不是「按过方向键」） */
    test: (p) => p.tutorialFlags.has('did_move'),
  },
  {
    id: 'bag',
    title: '认清家当',
    goal: '清点身上带的物品',
    hint: '输入 i（或「行囊」「查看背包」）打开行囊面板',
    requires: ['move'],
    /* 必须真的看过背包面板（由 panel() 上报 did_bag）。
       不能用 inventory 存在与否兜底 —— 那是恒真的，等于白送这一步。 */
    test: (p) => p.tutorialFlags.has('did_bag'),
  },
  {
    id: 'status',
    title: '认清自己',
    goal: '查看自身状态与属性',
    hint: '输入 score（状态）或 attr（属性）',
    requires: ['bag'],
    /* 同理，maxHp/atk 恒为数字，不能拿来判定「看过状态」 */
    test: (p) => p.tutorialFlags.has('did_score'),
  },
  {
    id: 'skill',
    title: '习武强身',
    goal: '练一次功，让武学有所长进',
    hint: '输入 lian 练功（或「练功」「打坐」）。在武学面板选一门功法打坐亦可',
    requires: ['status'],
    /* 纯状态：真的动过武学（练功次数/熟练度增长），不是「按过按钮」 */
    test: (p) => p.tutorialFlags.has('did_train')
      || (typeof p.practiceCount === 'number' && p.practiceCount > 0),
  },
  {
    id: 'talk',
    title: '结交江湖',
    goal: '和身边的人说说话',
    hint: '输入 talk <人名> 交谈，或 ask <人名> 询问',
    requires: ['skill'],
    test: (p) => p.tutorialFlags.has('did_talk'),
  },
  {
    id: 'quest',
    title: '接下第一桩差事',
    goal: '领取一件委托',
    hint: '在城里找 NPC 用「接任务 <任务名>」（或 accept）接；输入「任务」看任务日志',
    requires: ['talk'],
    /* 排除主线：主线是背景推进，不是新手该领的第一桩活 */
    test: (p) => p.tutorialFlags.has('did_accept')
      || Object.keys(p.quests || {}).some(k => k !== 'q_main_jianghu'),
  },
  {
    id: 'fight',
    title: '初试身手',
    goal: '打赢第一场架',
    hint: '找弱小对手「动手 <人名>」（kill）出手；打不过就「逃跑」（flee）',
    requires: ['quest'],
    test: (p) => (p.kills || 0) >= 1,
  },
  {
    id: 'sect',
    title: '拜入门派',
    goal: '加入一个门派，学真本事',
    hint: '走到门派所在处，「拜师 <门派>」（join）入门。少林/武当/华山/峨眉…各有绝学',
    requires: ['fight'],
    test: (p) => !!p.sect,
  },
  {
    id: 'save',
    title: '留个记号',
    goal: '保存你的江湖进度',
    hint: '输入「存档」（save）保存；下次点「继续游戏」接着玩',
    requires: ['sect'],
    test: (p) => p.tutorialFlags.has('did_save'),
  },
  {
    id: 'free',
    title: '江湖任你行',
    goal: '引导已完成，去闯荡吧！',
    hint: '点左侧「世界 · 地图」看舆图，去闯荡各处、寻访五个门派信物',
    requires: [],
    test: () => false,   // 永不完成，作为「毕业」提示
  },
];

/** 指令 -> 引导标记 的映射（玩家做了这些动作就点亮对应步骤） */
const CMD_FLAGS = {
  look: 'did_look', l: 'did_look', 看: 'did_look', 观察: 'did_look', 查看四周: 'did_look',
  i: 'did_bag', inventory: 'did_bag', 背包: 'did_bag', 查看背包: 'did_bag', 行囊: 'did_bag',
  score: 'did_score', sc: 'did_score', 状态: 'did_score', 属性: 'did_score', attr: 'did_score',
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
    nextGoal: current ? current.goal : '自由闯荡江湖',
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

module.exports = { STEPS, CMD_FLAGS, guideState, flagForCommand };