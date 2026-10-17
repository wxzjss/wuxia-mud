/* ============================================================
 * questecho.js —— 「江湖记得你」回声层（2026-10-18 新组件）
 *
 * 要解决的问题：玩家做完的事（支线/日课/门派案）在世界上**留不下回声**——
 * 任务一交，除了属性涨了，江湖上再没有任何人提起过。这个故事里，
 * 玩家应该偶尔听到「有人说起你在某处做过的那件事」。
 *
 * 设计约束（与 rumorfeed 的分工写死，别混）：
 *   · **不走传闻生命周期**：不 seed、不扩散、不走样、不衰减、不进 `world.rumors`。
 *     学 flagWisps 的口径——它是「尾声」，不是一条新闻。所以：
 *       不污染传闻账（world.rumors / p.reputation 都不碰）、
 *       不占 5 条上限、不和「打听」重排热度。
 *   · **偶尔**：至少隔 `COOLDOWN_TICKS` 个 worldTick（=30 分钟/个）才响一次；
 *     不刷屏是本功能的第一约束。
 *   · **同区优先 / 近期优先**：同一区域完成的事先响；同区内按完成时间近的优先。
 *     完成序记在 `p.vars.questDone`（见 character.setQuestStage），随档持久化。
 *
 * 数据池（游有方 lane，正在写）：`world.data.questEchoes`：
 *   { "<questId>": [ { "text": "……{name}……", "region": "jiangnan" }, … ] }
 *   · text 里的 `{name}` 会被替换成玩家名（没有占位符就原样播）；
 *   · region 可省：省了就从任务的委托人 / 目标房推所在区域；推不出就只参与「无同区」那一档。
 *   · 数据没落池子时本组件**静默不出声**（不发空话、不报错）。
 * ============================================================ */
'use strict';

/* 冷却：20–30 个 worldTick（= 600–900 分钟）随机一次。
   取区间而不是定值，是为了不让回声像闹钟一样准时——「偶尔」的手感来自不均匀。 */
const COOLDOWN_TICKS = [20, 30];
const TICK_MINUTES = 30;
const COOLDOWN_MIN_RANGE = [COOLDOWN_TICKS[0] * TICK_MINUTES, COOLDOWN_TICKS[1] * TICK_MINUTES];
/* 同一句 24 小时内不重复（按世界时钟记，不按真实时间） */
const SAME_LINE_HOURS = 24;
const SAME_LINE_MIN = SAME_LINE_HOURS * 60;
/* 取样权重（design/110 §三.1）：同区 ×3、近 5 条完成 ×2、其余 ×1 */
const W_SAME_REGION = 3;
const W_RECENT5 = 2;

function regionOfQuest(world, qd, item) {
  if (item && item.region) return item.region;
  if (!world || !qd) return '';
  /* 委托人 → NPC def 的定岗房 → 区域 */
  const npcId = qd.giver;
  const def = npcId && world.data.npcs && world.data.npcs[npcId];
  const roomId = def && def.room;
  const rm = roomId && world.getRoom(roomId);
  return (rm && rm.region) || '';
}

/** 玩家已完成的顺序表（近期在前）。老档没有这张表 → 从 p.quests 里补一份近似的。 */
function doneOrder(p) {
  const log = (p.vars && Array.isArray(p.vars.questDone)) ? p.vars.questDone : null;
  if (log && log.length) return log.slice().reverse();
  const out = [];
  for (const id of Object.keys(p.quests || {})) {
    if (p.quests[id] >= 99) out.push({ id, at: 0 });
  }
  return out;
}

/**
 * 纯函数：挑一条回声（不写任何状态）。
 * 取样规则（design/110 §三.1，2026-10-18 对齐池子机读版）：
 *   · 同区 ×3、近 5 条完成 ×2、其余 ×1（权重相乘，加权随机而不是硬筛）；
 *   · 同一句 24 小时内不重复（p.vars.echoTexts 记上次时刻）；
 *   · 没有完成过任何任务 / 没有池子 → null（一声不响）。
 * 返回 { questId, text, region, weight } 或 null。
 */
function pick(world, p) {
  const pool = world && world.data && world.data.questEchoes;
  if (!pool || !p) return null;
  const done = doneOrder(p);
  if (!done.length) return null;

  const now = world.clockMinutes || 0;
  const hereRegion = ((world.getRoom(p.room) || {}).region) || '';
  const recent5 = new Set(done.slice(0, 5).map(d => d.id));
  const seenTexts = (p.vars && p.vars.echoTexts) || {};

  const cands = [];
  for (const d of done) {
    const arr = pool[d.id];
    const items = Array.isArray(arr) ? arr : (arr ? [arr] : []);
    const qd = world.data.quests && world.data.quests[d.id];
    for (const it of items) {
      if (!it || !it.text) continue;
      /* 同句 24h 冷却：说过的那句先搁着 */
      const last = seenTexts[it.text];
      if (last && now - (last.at || 0) < SAME_LINE_MIN) continue;
      const region = regionOfQuest(world, qd, it);
      const w = (region && hereRegion && region === hereRegion ? W_SAME_REGION : 1)
        * (recent5.has(d.id) ? W_RECENT5 : 1);
      cands.push({ questId: d.id, at: d.at || 0, region, text: it.text, weight: w });
    }
  }
  if (!cands.length) return null;

  /* 加权随机：同区 3 倍、近期 5 条 2 倍 —— 是「更常说」，不是「只说」；
     同区没句子时才轮到别处的，由权重自然表达（3:1 而非 ∞:1）。 */
  let total = 0;
  for (const c of cands) total += c.weight;
  let r = (world.rng && world.rng.next ? world.rng.next() : Math.random()) * total;
  for (const c of cands) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return cands[cands.length - 1];
}

/**
 * 接线口（worldTick 尾巴上调用一次）：冷却 + 取样 + 落状态。
 * 返回一行 line 或 null。**不写传闻账**（world.rumors / p.reputation 一个都不碰）。
 */
function tick(world, p) {
  if (!world || !p) return null;
  const now = world.clockMinutes || 0;
  p.vars = p.vars || {};
  if (p.vars.echoNext != null && now < p.vars.echoNext) return null;
  const hit = pick(world, p);
  if (!hit) return null;
  /* 冷却取区间随机（20–30 tick）——回声不该像闹钟一样准时 */
  const span = COOLDOWN_MIN_RANGE[1] - COOLDOWN_MIN_RANGE[0];
  const rnd = (world.rng && world.rng.next ? world.rng.next() : Math.random());
  p.vars.echoNext = now + COOLDOWN_MIN_RANGE[0] + Math.floor(rnd * (span + 1));
  p.vars.echoSeen = p.vars.echoSeen || {};
  p.vars.echoSeen[hit.questId] = (p.vars.echoSeen[hit.questId] || 0) + 1;
  reqSeen(p, hit.text, now);
  const name = p.name || '有人';
  return {
    kind: 'plain',
    text: String(hit.text).replace(/\{name\}/g, name),
  };
}

/* 记录「这句什么时候说过了」——同句 24h 冷却读它；不参与权重。 */
function reqSeen(p, text, now) {
  p.vars.echoTexts = p.vars.echoTexts || {};
  p.vars.echoTexts[text] = { at: now || 0 };
}

module.exports = {
  pick, tick, doneOrder, reqSeen,
  COOLDOWN_TICKS, COOLDOWN_MIN_RANGE, TICK_MINUTES, SAME_LINE_HOURS,
  W_SAME_REGION, W_RECENT5,
};
