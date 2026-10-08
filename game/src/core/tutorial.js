'use strict';
/* ==========================================================================
 *  新手引导 · 状态机
 *
 *  为什么需要它：MUD 是纯文字界面，新手进来只见一段场景描述，
 *  完全不知道该干嘛。这里给出一条「按顺序、可完成、有反馈」的引导线，
 *  每完成一步自动推进，并在界面上常驻显示「当前该做什么」。
 *
 *  设计原则：
 *    1. 步骤条件直接读玩家状态（房间/背包/武学/门派…），不依赖额外事件
 *    2. 已完成的步骤永久保留（有成就感），当前步骤高亮
 *    3. 引导不强制：玩家可以无视它自由玩，随时回看
 * ========================================================================== */

/**
 * 引导步骤定义。
 * 每步：id / title（短标题）/ goal（要做什么）/ hint（怎么做）/ done(p, w) 判定
 */
const STEPS = [
  {
    id: 'look',
    title: '看清四周',
    goal: '看看自己身在何处',
    hint: '输入 look（或中文「看」「看看四周」）',
    test: (p, w) => p.tutorialFlags.has('did_look'),
  },
  {
    id: 'move',
    title: '迈开脚步',
    goal: '走进江南城逛逛',
    hint: '输入 n 往北走；或点左下侧栏「世界」里的「地图 (map)」，选一个相邻房间',
    test: (p) => p.tutorialFlags.has('did_move'),
  },
  {
    id: 'bag',
    title: '查看行囊',
    goal: '清点身上带的物品',
    hint: '输入 i（或「查看背包」）',
    test: (p) => p.tutorialFlags.has('did_bag'),
  },
  {
    id: 'status',
    title: '认清自己',
    goal: '查看自身状态与属性',
    hint: '输入 score 看状态，attr 看属性',
    test: (p) => p.tutorialFlags.has('did_score'),
  },
  {
    id: 'skill',
    title: '习武强身',
    goal: '练一次功，提升武学',
    hint: '输入 lian 打坐练功（或「练功」）。武学等级越高越强',
    test: (p) => p.tutorialFlags.has('did_train'),
  },
  {
    id: 'talk',
    title: '结交江湖',
    goal: '和身边的人说说话',
    hint: '输入 talk <人名> 交谈，或 ask <人名> 询问',
    test: (p) => p.tutorialFlags.has('did_talk'),
  },
  {
    id: 'quest',
    title: '接下第一桩差事',
    goal: '领取一个任务',
    hint: '在城里找 NPC 用「接任务 <任务名>」（或 accept <任务名>）接任务；输入「任务」（quests）看任务日志',
    test: (p) => p.tutorialFlags.has('did_accept') || Object.keys(p.quests || {}).some(k => k !== 'q_main_jianghu'),
  },
  {
    id: 'fight',
    title: '初试身手',
    goal: '打赢第一场架',
    hint: '找弱小的对手「动手 <人名>」（kill <人名>）出手；打不过就「逃跑」（flee）',
    test: (p) => (p.kills || 0) >= 1,
  },
  {
    id: 'sect',
    title: '拜入门派',
    goal: '加入一个门派，学真本事',
    hint: '走到门派所在处，「拜师 <门派>」（join <门派>）入门。少林/武当/华山/峨眉…各有绝学',
    test: (p) => !!p.sect,
  },
  {
    id: 'getitem',
    title: '添置家当',
    goal: '拾取或购买一件物品',
    hint: '地上有东西就「捡起 <物品>」（get <物品>）；也可在店铺「购买」（buy）',
    test: (p) => p.tutorialFlags.has('did_get') || (p.inventory || []).length > 5,
  },
  {
    id: 'save',
    title: '留个记号',
    goal: '保存你的江湖进度',
    hint: '输入「存档」（save）保存；下次点「继续游戏」接着玩（load 读档）',
    test: (p) => p.tutorialFlags.has('did_save'),
  },
  {
    id: 'free',
    title: '江湖任你行',
    goal: '引导已完成，去闯荡吧！',
    hint: '点左侧「世界 · 地图」看全图，去闯荡各处、寻访五个门派信物',
    test: () => false,   // 永不完成，作为「毕业」提示
  },
];

/** 指令 -> 引导标记 的映射（玩家做了这些动作就点亮对应步骤） */
const CMD_FLAGS = {
  look: 'did_look', l: 'did_look', 看: 'did_look', 观察: 'did_look', 查看: 'did_look',
  i: 'did_bag', inventory: 'did_bag', 背包: 'did_bag', 查看背包: 'did_bag',
  score: 'did_score', sc: 'did_score', 状态: 'did_score', 属性: 'did_score',
  attr: 'did_score', 查一下状态: 'did_score',
  lian: 'did_train', train: 'did_train', 练功: 'did_train', 打坐: 'did_train',
  talk: 'did_talk', ask: 'did_talk', 交谈: 'did_talk', 询问: 'did_talk',
  accept: 'did_accept', 接取: 'did_accept', 接任务: 'did_accept',
  get: 'did_get', 拾取: 'did_get', 捡: 'did_get',
  save: 'did_save', 存档: 'did_save',
  n: 'did_move', s: 'did_move', e: 'did_move', w: 'did_move', u: 'did_move', d: 'did_move',
  north: 'did_move', south: 'did_move', east: 'did_move', west: 'did_move',
  北: 'did_move', 南: 'did_move', 东: 'did_move', 西: 'did_move',
  往北走: 'did_move', 往南走: 'did_move', 往东走: 'did_move', 往西走: 'did_move',
};

/**
 * 计算当前引导状态。
 * @param {object} player
 * @param {array} tutorialFlags 已点亮的标记（数组）
 * @returns {{ steps, current, doneCount, total, finished, nextGoal }}
 */
function guideState(player, tutorialFlags) {
  const flags = new Set(tutorialFlags || []);
  const p = Object.assign({}, player, { tutorialFlags: flags });

  const evaluated = STEPS.map((s, idx) => {
    let done = false;
    try { done = !!s.test(p, null); } catch (e) { done = false; }
    return { id: s.id, title: s.title, goal: s.goal, hint: s.hint, done, index: idx };
  });

  /* 从前往后找第一个未完成的（排除最后的自由发挥步） */
  const real = evaluated.filter(s => s.id !== 'free');
  const currentIdx = real.findIndex(s => !s.done);
  const doneCount = real.filter(s => s.done).length;

  return {
    steps: evaluated,
    current: currentIdx >= 0 ? real[currentIdx] : null,
    doneCount,
    total: real.length,
    finished: currentIdx < 0,
    nextGoal: currentIdx >= 0 ? real[currentIdx].goal : '自由闯荡江湖',
  };
}

/** 根据玩家执行的指令返回应该点亮的标记 */
function flagForCommand(cmd, args) {
  const c = String(cmd || '').trim().toLowerCase();
  if (CMD_FLAGS[c]) return CMD_FLAGS[c];
  /* go / 方向类 */
  if (c === 'go' && args && args.length) return 'did_move';
  return null;
}

module.exports = { STEPS, CMD_FLAGS, guideState, flagForCommand };
