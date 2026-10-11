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
  if (!who) return true;
  if (!p || !p.room) return false;
  const list = (world.npcsIn ? world.npcsIn(p.room) : []) || [];
  if (list.some(n => n && !n.dead && (n.defId === who || n.id === who || n.name === who))) return true;
  /* 还没实例化的（NPC 是懒实例化的）：看房间定义里挂没挂这个人 */
  const room = world.getRoom(p.room);
  const ids = (room && room.npcs) || [];
  if (ids.some(x => (typeof x === 'string' ? x : (x && x.id)) === who)) return true;
  /* 钉死在屋里的 NPC：房间对得上就算在（会走动的不能这么判，不然他早走远了也照上） */
  const def = (world.data.npcs || {})[who];
  if (def && def.noWander && def.room === p.room) return true;
  return false;
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
  const m = p.vars[MEMO] = p.vars[MEMO] || { tut: 0, quests: {} };
  if (!m.quests) m.quests = {};
  return m;
}

/** 开局时把当前进度记成「已讲」——楔子已经交代过了，别再复述一遍 */
function markSeen(world, p) {
  if (!p) return;
  const m = memOf(p);
  try {
    const g = require('./tutorial').guideState(p, p.tutorialFlags);
    if (g && g.current) m.tut = g.current.no;
  } catch (e) { /* 教程算不出来就不记，不影响别的 */ }
  for (const qid of Object.keys(p.quests || {})) m.quests[qid] = p.quests[qid];
}

/**
 * 每条指令之后对一次账，把「本该讲、还没讲」的剧情推出来。
 * @returns {Array<{kind,text}>} 0~N 行（调用方接到 lines 尾部即可）
 */
function reconcile(world, p) {
  if (!p) return [];
  const m = memOf(p);
  const out = [];

  /* ① 新手教程：章节往前走一格，就把这一章讲出来
   *
   * ⚠️ 逐章**补课**，不是只盯 `current`：玩家可能在别处把某一章的条件做完了
   *    （比如走到外头的镇上接了个任务），等系统回头看时 `current` 已经跳到下一章 ——
   *    只盯 current 的话中间那一章**永远讲不出来**。（本模块第一版就这么漏过。）
   *
   * ⚠️ 人物言行**只筛那一句**，章节本身照讲：
   *    老汉不在跟前，就只上旁白（「往北二里是江南城…」哪儿读都通），
   *    他那句「你连道口都没走完」留空 —— 屏幕上演的是**你眼前的江湖**，
   *    不该出现别处某个人正在说什么。 */
  try {
    const g = require('./tutorial').guideState(p, p.tutorialFlags);
    const steps = (g && g.steps) || [];
    const curNo = (g && g.current) ? g.current.no : 0;
    for (const s of steps) {
      if (s.no <= (m.tut || 0)) continue;
      /* 还没轮到的（锁着的）不讲；做完的和当前这一章讲 */
      if (!s.done && s.no !== curNo) continue;
      if (!s.narr && !s.say) continue;
      const got = beats(world, p, [
        { kind: 'story', text: s.narr },
        { kind: 'say', text: s.say, by: s.at },
      ]);
      if (!got.length) continue;
      out.push({ kind: 'subtitle', text: `第 ${s.no} 章 · ${s.title}` });
      out.push(...got);
      m.tut = s.no;
      /* 一次只讲一章。第一版是「能补多少补多少」，结果开头一条 look
         就把第 1、2 章连着倒出来 —— 剧情是给人读的，不是给人刷的。
         落下的下一章，下一条指令自然就补上了。 */
      break;
    }
  } catch (e) { /* 教程出错不该挡着玩 */ }

  /* ② 任务：接取 / 阶段推进时讲剧情（委托人的话要看他在不在） */
  for (const qid of Object.keys(p.quests || {})) {
    const st = p.quests[qid];
    if (st < 0) { delete m.quests[qid]; continue; }
    if (m.quests[qid] === st) continue;
    const first = m.quests[qid] === undefined;
    m.quests[qid] = st;
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

module.exports = { reconcile, present, beats, markSeen, MEMO };
