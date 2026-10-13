/**
 * storybeat.js — 剧情上屏（主人 2026-10-11 追问的那件事）
 *
 * 原话：「为什么新手任务的剧情以及一些剧情里人物说的话做的动作神态等描写
 *        没有写在屏幕上，还得玩家专门打开任务界面看剧情？
 *        （如果是剧情人物说话做事之类的描写，需要玩家在该 NPC 旁边时才会显示，
 *         不能玩家不在某个 NPC 旁边屏幕上却写着该 NPC 说了什么之类的）」
 *
 * 病根：新手教程与任务的剧情**只走面板**（`guideState().current.story`、
 * 任务的 `desc / stageDesc` 都只喂给「任务」「新手教程」两个面板），
 * 玩家不主动翻开就永远读不到 —— 而那恰恰是整个游戏最该在屏幕上发生的东西。
 *
 * 这个模块做两件事：
 *   ① **对账上屏**：`reconcile()` 在每条指令之后跑一遍，比较「已经讲过哪一章/
 *      哪个任务的哪一阶段」（记在 `p.vars._storyBeat`，随档走），把落后的补讲出来。
 *      挂一处就全覆盖：面板点出来的、敲指令敲出来的、打架打出来的，都走 exec。
 *   ② **在场闸门**：`present()` / `beats()`。带 `by: <npcId>` 的条目，
 *      人不在玩家屋里就**整条不发**。这是主人的硬要求 ——
 *      屏幕上是「你眼前的江湖」，不该出现别处某个人正在说什么做什么。
 *
 * ⚠️ 与 `observe.js` / `encounter.js` 的分工：
 *   · observe 管「看一个人时他有什么小动作」（玩家主动看）
 *   · encounter 管「路过某地触发的支线」（按房间名随机撞上）
 *   · 这里管「剧情本身要主动讲给玩家听」，以及「讲之前先看人在不在」
 */
'use strict';

const MEMO = '_storyBeat';

/* ---------------- 在场判定 ---------------- */

/**
 * 这个人此刻是不是跟玩家在同一间屋子。
 * @param {string} who  npc defId / 实例 id / 名字；空值一律算「无归属，随便上」
 */
function present(world, p, who) {
  /* 🔴 主人 2026-10-11：「把剧情 npc 不在玩家身边就不说话效果取消掉（实测影响游戏体验）」
     —— 原来这里是「带 `by` 的条目，人不在同一间屋里就**整条不发**」。
     代价比想象的大：剧情正讲到要紧处，玩家走开一步（或者那位本来就在别处），
     旁白与台词**整段消失**，而任务 / 教程面板照旧把这一段记成「已经讲过了」——
     于是玩家**永久错过一段剧情**，屏幕上还没有任何提示（铁律：不报错就是不生效）。
     真正影响体验的不是「人在不在」，而是这个「静默吞掉」。
     现在一律放行：剧情里的旁白本就以第三人称转述为主（「某人在某处如何如何」），
     人不在场也读得通；真要写「你眼前」的事，数据里自然会写清是哪间屋。
     ⚠️ 函数与签名保留 —— 调用方（beats / reconcile）与测试都还认这个入口，
        语义改成「恒在场」，不再按房间筛。 */
  void world; void p; void who;
  return true;
}

/**
 * 过闸：把一组剧情条目按「谁说的」筛一遍。
 * 条目形如 `{ kind, text, by }`；`by` 给了但人不在场 → 丢掉这一条。
 */
function beats(world, p, list) {
  const out = [];
  for (const b of (list || [])) {
    if (!b || !b.text) continue;
    if (!present(world, p, b.by)) continue;
    out.push({ kind: b.kind || 'story', text: b.text });
  }
  return out;
}

/* ---------------- 对账上屏 ---------------- */

function memOf(p) {
  p.vars = p.vars || {};
  /* `sayNo` = 台词/动作**投到日志的最后一章**（大框是常显的，日志只投一次）
     `held`  = 「接取时该讲、但先扣着不讲」的那些任务（见 hold / takeHeld） */
  const m = p.vars[MEMO] = p.vars[MEMO] || { tut: 0, sayNo: 0, quests: {}, held: {} };
  if (!m.quests) m.quests = {};
  if (!m.held) m.held = {};
  return m;
}

/* ---------------- 接取旁白：先扣着，等玩家来追 ---------------- */

/**
 * 「这桩事是**脚本直接塞给你的**，接取时该说的那几句话先扣着」。
 *
 * 主人 2026-10-12 的原话：
 *   「主线剧情一进游戏就接取，但主线剧情需要追踪时才在屏幕上显示
 *     原本应该在接取时就应该出现的那些文本。」
 *
 * 为什么需要这个开关：主线是 `world.createPlayer` 开局就写进任务簿的
 * （不是玩家在 NPC 那儿点「接取任务」接的），而 `reconcile` 判断「这是新接的」
 * 靠的是 `_storyBeat.quests` 那本账 —— 开局它是空的，于是**第一条指令之后**
 * 就把「【接取任务】江湖路远 + 委托人的话 + 目标」一股脑打进日志。
 * 玩家还没弄明白自己在哪，就先被塞了三行主线说明。
 *
 * ⇒ 现在这类任务记进 `held`：reconcile 见到它**只记账、不讲话**，
 *   等玩家在「任务」里点了追踪（或敲了 `追踪 <任务>`）再讲（见 takeHeld）。
 *   大框那边不受影响 —— 它本来就是「追谁演谁」，一追就看得见。
 */
function hold(p, qid) {
  if (!p || !qid) return;
  memOf(p).held[qid] = true;
}

/**
 * 玩家来追这桩事了 → 把扣着的那几句交出去（**只交一次**）。
 * @returns {Array<{kind,text}>} 0~N 行；没扣着东西就返回空数组。
 */
function takeHeld(world, p, qid) {
  if (!p || !qid) return [];
  const m = memOf(p);
  if (!m.held[qid]) return [];
  delete m.held[qid];
  /* 🔴 2026-10-13 主人真机：「追踪 江湖路远」接取旁白讲了两遍。
     根因：指令出口（engine.js exec 末尾）的 reconcile 跑在**指令处理之后** ——
     玩家开局第一下就点「追踪」时，记忆账 `m.quests` 还没记过这条任务，
     trackCmd 里 takeHeld 把接取旁白讲掉、扣着的账也删了，
     随后 reconcile 一对账：`first`（记忆账没这条）且 `!m.held[qid]`（刚被讲掉）
     → 走了「第一次见到就讲接取旁白」的分支，又讲了一遍。
     ⇒ takeHeld 讲掉旁白的同一刻，把记忆账记上 —— reconcile 见账平了就不出声。 */
  if (p.quests && p.quests[qid] !== undefined) m.quests[qid] = p.quests[qid];
  const qd = (world && world.getQuest) ? world.getQuest(qid) : null;
  if (!qd || !qd.name) return [];
  const raw = p.questStage ? p.questStage(qid) : (p.quests || {})[qid];
  let idx = (raw === undefined || raw === null || raw < 0) ? 0 : raw;
  const stages = qd.stages || [];
  if (idx >= stages.length) idx = Math.max(0, stages.length - 1);
  const stage = stages[idx] || {};
  const out = beats(world, p, [
    { kind: 'quest', text: `【接取任务】${qd.name}` },
    /* 任务的 desc 写的就是委托人的做派，所以也算「人物描写」，一并过在场闸门。 */
    { kind: 'story', text: qd.desc, by: qd.giver },
  ]);
  if (stage.desc) out.push({ kind: 'plain', text: '　目标：' + stage.desc });
  return out;
}

/** 有没有扣着这桩事的接取旁白（测试与前端提示用） */
function isHeld(p, qid) {
  return !!(p && p.vars && p.vars[MEMO] && p.vars[MEMO].held && p.vars[MEMO].held[qid]);
}

/** 开局时把当前进度记成「已讲」——楔子已经交代过了，别再复述一遍 */
function markSeen(world, p) {
  if (!p) return;
  const m = memOf(p);
  /* 🔴 新手教程已下线（2026-10-12）——原先这里还记一笔 `m.tut`（教程章次），
     现在没有章次可记。`m.tut` 字段本身留着（老存档里有）。 */
  for (const qid of Object.keys(p.quests || {})) m.quests[qid] = p.quests[qid];
}

/**
 * 每条指令之后对一次账，把「本该讲、还没讲」的剧情推出来。
 * @returns {Array<{kind,text}>} 0~N 行（调用方接到 lines 尾部即可）
 */
function reconcile(world, p, opts) {
  void opts;   /* `{tutOnly:true}` 那个开关随「教程章节改上大框」一起退休了（见下） */
  if (!p) return [];
  const m = memOf(p);
  const out = [];

  /* ① （已下线）新手教程章节的 NPC 言行 —— 2026-10-12 主人「新手教程剧情全删」。
     原先这里每章投一次 `guideState().current.say` 到日志灰字（kind `npcsact`），
     现在「入江湖」八章没了，这一路自然没有东西可投。
     ⚠️ `_storyBeat.sayNo` 这个记账字段**留着不动**：老存档里有它，
        删字段会让老档读进来时多一笔无主数据（无害，但没必要的动静）。 */
  /* ② 任务：接取 / 阶段推进时讲剧情（委托人的话要看他在不在） */
  for (const qid of Object.keys(p.quests || {})) {
    const st = p.quests[qid];
    if (st < 0) { delete m.quests[qid]; continue; }
    if (m.quests[qid] === st) continue;
    const first = m.quests[qid] === undefined;
    m.quests[qid] = st;
    /* ★ 脚本直接塞给你的那条（主线起手式）：接取旁白**先扣着**。
       主人 2026-10-12：「主线剧情一进游戏就接取，但主线剧情需要追踪时才在屏幕上
       显示原本应该在接取时就应该出现的那些文本。」
       ⇒ 这里只记账、不出声；玩家去追它的时候由 `takeHeld()` 讲（见 commands.js 的「追踪」）。
       ⚠️ 必须放在 `m.quests[qid] = st` **之后**：不然下一条指令又判成「第一次见到」，
          会反复走这一段（账没记上）。 */
    if (first && m.held[qid]) continue;
    /* ⚠️ 「接取新任务就自动追踪」**不在这里**做。
       这里判「第一次见到」用的是 `_storyBeat.quests` 那本记忆账，它在
       **开局 / 读档之后是空的** —— 于是手上那些老任务全被当成「刚接的」
       （实测：开局取消一次追踪，下一条指令就把主线追回来了，玩家一脸懵）。
       真正的「接取」只有一个入口：`accept` 指令（NPC 菜单的「接取任务」按钮也发它）。
       规则挂在那里，见 commands.js。 */
    void first;
    if (st >= 99) continue;                     /* 交完就算了，收尾话由交任务那边说 */
    const qd = world.getQuest ? world.getQuest(qid) : null;
    if (!qd || !qd.name) continue;
    const stage = (qd.stages && qd.stages[st]) || {};
    const block = [];
    if (first) {
      block.push({ kind: 'quest', text: `【接取任务】${qd.name}` });
      /* ⚠️ 任务的 desc 写的就是委托人的做派（「他缠着你去看看」这类），
         所以它也算「人物描写」，一并按在场闸门过。 */
      block.push({ kind: 'story', text: qd.desc, by: qd.giver });
    } else {
      block.push({ kind: 'quest', text: `【${qd.name} · 有了下文】` });
    }
    const got = beats(world, p, block);
    out.push(...got);
    if (stage.desc) out.push({ kind: 'plain', text: '　目标：' + stage.desc });
  }

  return out;
}

/* ==================================================================
 *  剧情屏（上方大框）= **任务追踪**
 *  主人 2026-10-08 定的规则（原话）：
 *   ·「主线剧情依旧是开局就接这个不变，但不会在屏幕下方显示」
 *   ·「在『任务』里给任务添加追踪按钮，点击追踪按钮后上方大框内容切换成该追踪任务」
 *   ·「如果不追踪任务，大框默认是新手剧情任务，直到该任务结束后自动切换追踪其他任务
 *      （优先追踪主线剧情任务）」
 *   ·「点击追踪后『追踪』按钮变成『取消追踪』」
 *   ·「点击取消追踪后，大框里的任务以及大框都消失，直到接取一个新任务或者主动追踪任务」
 *   ·「初始默认追踪新手剧情任务」
 *
 *  ⇒ 状态只有一个：`p.track`
 *       null          不追踪（大框只留房间信息）
 *       '__newbie__'  追踪新手剧情任务（开局默认）
 *       'q_xxx'       追踪某条真任务
 *
 *  为什么是「当前状态算出来的」而不是「把新发生的那几行推上去」：
 *    ① 玩家一进来就该看见**当前这一章/这一步**，而不是上一条指令冒出来的几行；
 *    ② 走开、读档、跨区回来，大框里照样是它，**不会永久错过**；
 *    ③ 新手走完的那一刻，同一个函数自然返回主线那一幕，这就是「无缝衔接」。
 * ================================================================== */

const NEWBIE = '__newbie__';

/** 新手剧情任务那一「章」—— 🔴 2026-10-12 主人「新手教程剧情全删」后**恒 null**。
 *
 *  原先它把「入江湖」八章的当前一章算给大框（arc `tutorial`）。
 *  现在整块下线：大框里从今往后只有**真任务**（主线 / 支线），
 *  开局不追任何东西 → 大框收起、让位给房间描述。
 *
 *  ⚠️ 函数与 `NEWBIE` 哨兵**保留**（不是死代码）：
 *     ① 老存档里 `p.track === '__newbie__'` 的还有，读档时得能识别出来并翻篇；
 *     ② 前端 / 老测试还在按这个哨兵发指令（见 commands.js 的认词表）。
 *     返回 null 就是「这一章不存在了」，调用方自然落到主线 / 收起。 */
function newbieChapter(p) {
  void p;
  return null;
}

/** 一条真任务的「当前一步」（主线 / 支线都走这里） */
function questChapter(world, p, qid) {
  const qd = (world && world.getQuest) ? world.getQuest(qid) : null;
  if (!qd) return null;
  const isMain = String(qd.type || '') === '主线';
  let idx = p.questStage ? p.questStage(qid) : (p.quests || {})[qid];
  if (idx === undefined || idx === null) idx = 0;
  if (idx < 0) idx = 0;
  if (idx >= 99) idx = Math.max(0, (qd.stages || []).length - 1);
  const stage = ((qd.stages || [])[idx]) || {};
  const total = (qd.stages || []).length || 1;
  const lines = [];
  if (qd.desc) lines.push({ kind: 'story', text: qd.desc });
  if (stage.desc) lines.push({ kind: 'plain', text: '　眼下这一步：' + stage.desc });
  return {
    arc: isMain ? 'main' : 'side',
    arcName: isMain ? '主线' : (qd.type || '任务'),
    arcLabel: (isMain ? '主线 · 第 ' : '支线 · 第 ') + (idx + 1) + ' / ' + total + ' 步',
    no: idx + 1, total,
    /* 抬头去掉数据里的『【主线】』前缀 —— 类型已经由 arcLabel 说了 */
    title: String(qd.name || qid).replace(/^【[^】]*】/, ''),
    lines, todo: stage.desc || '', goal: stage.desc || '',
    questId: qid,
  };
}

/**
 * 自动挑一个该追踪的任务。
 * 主人：「新手剧情任务结束后自动切换追踪其他任务（**优先追踪主线剧情任务**）」。
 */
function pickAuto(world, p) {
  const ml = require('./mainline');
  const active = qid => {
    const st = p.questStage ? p.questStage(qid) : (p.quests || {})[qid];
    return st !== undefined && st >= 0 && st < 99;
  };
  for (const qid of ml.ACT_QUESTS.slice(1)) if (active(qid)) return qid;   // 优先主线
  const rest = Object.keys(p.quests || {}).filter(active).sort();
  return rest.length ? rest[0] : null;
}

/**
 * 把追踪状态收拾到「该追的那条」上（幂等，随便调）。
 *
 * 三条自动规则：
 *   ① 追着新手、新手又走完了 → 自动换一个（优先主线）；
 *   ② 追着某条、那条交完/掉了 → 自动换一个；
 *   ③ `p.track` 是 null = **玩家亲手取消的** → 什么也不做。
 *      主人：「点击取消追踪后，大框里的任务以及大框都消失，直到接取一个新任务
 *              或者主动追踪任务」——「接取新任务」那条走 reconcile（见下）。
 */
function syncTrack(world, p) {
  if (!p) return;
  const t = p.track;
  if (t === NEWBIE) {
    /* 🔴 2026-10-12「新手教程剧情全删」：`__newbie__` 已经没有对应的章了。
       老存档里还追着它的（读档进来的），一律翻篇换成主线那一幕 ——
       否则大框会一直挂着一个讲不出来的空哨兵（`currentStory` 会返回 null，
       看着像「任务丢了」）。 */
    p.track = pickAuto(world, p);
    return;
  }
  if (!t) return;                       /* 玩家没在追（含开局默认不追）—— 不擅自给他追回来 */
  const st = p.questStage ? p.questStage(t) : (p.quests || {})[t];
  if (st === undefined || st < 0 || st >= 99 || !(world && world.getQuest && world.getQuest(t))) {
    p.track = pickAuto(world, p);
  }
  void world;
}

/** 大框此刻该演哪一个（按 `p.track` 算；`null` = 大框只留房间信息） */
function currentStory(world, p) {
  if (!p) return null;
  if (p.track === NEWBIE) {
    try {
      const c = newbieChapter(p);
      if (c) return c;
    } catch (e) { /* 教程算不出来 → 落到下面按任务算 */ }
    return null;
  }
  if (!p.track) return null;
  try { return questChapter(world, p, p.track); } catch (e) { return null; }
}

module.exports = {
  reconcile, present, beats, markSeen, currentStory, NEWBIE, syncTrack, pickAuto, MEMO,
  hold, takeHeld, isHeld,
};
