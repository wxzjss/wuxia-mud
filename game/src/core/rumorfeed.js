/**
 * rumorfeed.js — 传闻的**消费端**：让这个世界当面把你的事说给你听
 *
 * 背景（自拟清单 🅔）：传闻引擎本身早就齐了 ——
 *   `world.addRumor()` 生根、`dailyRumorTick()` 扩散/走样/衰减、
 *   `world.fillRumorText()` 按 truth 分档换说法、`world.listenRumors()` 按地区打听。
 * 32 项 smoke 全绿。可**玩家自己做的事很少变成传闻**，更没有「回头听到」的那一刻 ——
 * 于是这套东西对玩家而言等于不存在（铁律：不报错就是不生效族）。
 *
 * 这个模块补的是三件「看得见」的事：
 *   ① **接线**：`note()` —— 玩家做出可被传的事，一个统一入口把它传出去，
 *      带「同一桩事一天只传一回」的冷却（不然拜一次师刷十条传闻）。
 *   ② **当面对质**：`chatterIn()` —— 走进一个你的事迹正被议论的地方，
 *      屏幕上会有一句「邻桌有人压低了声音」。听的**就是关于你自己的那条**。
 *   ③ **问你自己**：`whatTheySay()` —— 「风声」指令的底料，
 *      把关于你的传闻按影响排出来（哪条、原话、传到哪儿了）。
 *
 * ⚠️ 与 `heardLine`（npcMemory）分工不同：那个是「他听说你侠名高」这种**泛泛**的话，
 *    这个是**具体那一条**（「听说你在江南城把谁给结果了」）。见 npcMemory 里的 rumorLine。
 */
'use strict';

const DAY = 1440;

function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY); }

/** 关于玩家的、还活着的传闻。按「影响 = 热度 × 最广流传」降序。 */
function aboutPlayer(world, limit) {
  const list = (world.rumors || []).filter(r => (r.subject || 'player') === 'player'
    && world.data.rumorSeeds && world.data.rumorSeeds[r.seedId]);
  list.sort((a, b) => score(b) - score(a));
  return limit ? list.slice(0, limit) : list;
}

function spreadMax(r) {
  const v = Object.values(r.spread || {});
  return v.length ? Math.max.apply(null, v) : 0;
}
function score(r) { return (r.heat || 0) * (0.4 + spreadMax(r) / 100); }

/**
 * 旗标派生的「尾声」（design/105 §四 · 半交浮名的判定侧，2026-10-18）
 *
 * 剧情让你「留一手」时，交出去的只是一部分：数据侧只落 flag
 * （`act3_mole_withheld`），+rep 只挂在「照实说」分支。
 * 没交的那几线会在江湖风评里留一条**没头没尾的话** —— 但它不该走
 * seeded 传闻那套（要有种子、要有人目击、会扩散/走样/衰减）：
 * 「没说完」的语义恰恰是它**不会**长成一条有始有终的传闻。
 * ⇒ 做成旗标派生的常驻尾声：只在「风声」里附在传闻之后，
 *    不参与热度、不扩散、不衰减。旗标在，尾音就在；旗标不在，什么都没有。
 *
 * ⚠️ 加新条目时只用**已经落定的结局旗标**（一次性、幂等）；
 *    别挂过程旗标（会让人一辈子只听到半句话）。
 */
const FLAG_WISPS = {
  act3_mole_withheld: {
    text: '北边道上有人提起过你：话说了一半，剩下半句咽回去了。',
    hint: '（半交的话，风里只留个尾音 —— 没交出去的那几线，明面上没人提。）',
  },
};

/** 玩家身上挂着的「尾声」列表（{flag,text,hint}）。空数组＝没有。 */
function flagWisps(p) {
  const out = [];
  if (!p || typeof p.hasFlag !== 'function') return out;
  for (const k of Object.keys(FLAG_WISPS)) {
    if (p.hasFlag(k)) out.push(Object.assign({ flag: k }, FLAG_WISPS[k]));
  }
  return out;
}

/**
 * 统一接线口：把一桩玩家事迹传出去。
 *
 * @param {World}  world
 * @param {string} seedId  data.rumorSeeds 里的 id
 * @param {Object} data    { vars:{whom,where,...}, about, room, loud }
 * @returns {Object|null}  真传出去了返回 rumor，否则 null
 *
 * 策略：
 *   · **一天只传一回同一桩事**（`p.vars.rumorNote[seedId] = day`）——
 *     否则反复拜师 / 反复升位会刷出一堆同题传闻把别的都顶掉。
 *   · 默认要有目击者（沿用 addRumor 的规矩：没人看见就没传闻）。
 *     但「扬名」性质的事（入门 / 中第）本来就该四处传，走 `loud:true` 强制出声 ——
 *     ⚠️ 这里不能自作主张传 silent:true，那等于取消了「目击」这条设计。
 */
function note(world, seedId, data) {
  data = data || {};
  const p = world.player;
  if (!p || !world.addRumor) return null;
  const seed = (world.data.rumorSeeds || {})[seedId];
  if (!seed) return null;                       /* 种子不存在就别假装传了（静默是最大的坑） */

  const day = dayOf(world);
  p.vars = p.vars || {};
  p.vars.rumorNote = p.vars.rumorNote || {};
  if (p.vars.rumorNote[seedId] === day) return null;
  p.vars.rumorNote[seedId] = day;

  const room = data.room || p.room;
  const rm = world.getRoom(room);
  const vars = Object.assign({
    who: p.name || '有人',
    where: (rm && rm.name) || '此地',
  }, data.vars || {});

  return world.addRumor(seedId, {
    room,
    subject: 'player',
    about: data.about || null,
    vars,
    /* loud 的种子在 addRumor 里自带「邻房也听见」；这里只是把 data.loud 透下去，
       便于调用方对「天大的事」显式放宽（当前无种子用它，留着口子）。 */
    loud: data.loud,
  });
}

/**
 * 走进某地时，这儿有没有人在议论你。
 * @returns {{kind:string,text:string}|null} 一行，或 null
 *
 * ⚠️ 频率三闸（全是照着「别吵」定的）：
 *   · 一屋一天只念一回（`p.vars.rumorChatter`）
 *   · 屋里得**有活人**（空屋子谁在说话？）
 *   · 这条传闻在本地区得有点热度（spread ≥ 8），刚出的事还没传过来就不该有人知道
 */
function chatterIn(world, room) {
  const p = world.player;
  if (!p || !room) return null;
  const day = dayOf(world);
  p.vars = p.vars || {};
  if (p.vars.rumorChatter === day) return null;

  const region = room.region || '_wild';
  const hit = aboutPlayer(world).find(r => (r.spread[region] || 0) >= 8);
  if (!hit) return null;

  const crowd = (world.npcsIn ? world.npcsIn(room.id) : [])
    .filter(n => n && !n.dead && !n.knockedOut && !(n.def || {}).hostile);
  if (!crowd.length) return null;

  p.vars.rumorChatter = day;
  const text = world.fillRumorText(hit);
  if (!text) return null;

  /* 挑一个说闲话的人：固定取第一个活人，句子里不点名（「邻桌有人」）——
     点名反而怪：刚进门的陌生人凭什么当面跟你嚼你自己的舌根。 */
  const who = ['隔壁桌有人压低了声音', '有人凑在一处嘀咕', '檐下两个闲汉在说嘴',
    '柜台后头有人探出头来'][Math.abs(hash(room.id + day)) % 4];
  return {
    kind: 'story',
    text: `${who}：「${text}」`,
  };
}

/**
 * 「风声」的底料：江湖上现在怎么说你。
 * @returns {Array<{seedId, kind, text, heat, spreadMax, regions:Array<string>}>}
 */
function whatTheySay(world, limit) {
  limit = limit || 5;
  const regions = (world.data.regions || {});
  return aboutPlayer(world, limit).map(r => {
    const areas = Object.keys(r.spread || {})
      .filter(rg => (r.spread[rg] || 0) >= 5)
      .sort((a, b) => (r.spread[b] || 0) - (r.spread[a] || 0))
      .map(rg => (regions[rg] && regions[rg].name) || (rg === '_wild' ? '荒野' : rg));
    const seed = (world.data.rumorSeeds || {})[r.seedId] || {};
    return {
      seedId: r.seedId,
      kind: seed.kind || '',
      text: world.fillRumorText(r),
      heat: r.heat,
      truth: r.truth,
      spreadMax: spreadMax(r),
      regions: areas,
      bornDaysAgo: Math.max(0, dayOf(world) - (r.bornDay || 0)),
    };
  });
}

/** 玩家声望的一行摘要（侠名 / 恶名 / 各区声名），给「风声」收尾用 */
function reputationLines(world) {
  const p = world.player;
  if (!p) return [];
  const out = [];
  const fame = p.fame || {};
  const top = Object.keys(fame).sort((a, b) => fame[b] - fame[a]).slice(0, 3)
    .filter(rg => fame[rg] >= 1);
  const regions = world.data.regions || {};
  if (top.length) {
    out.push({
      kind: 'plain',
      text: '你的名字在' + top.map(rg => (regions[rg] && regions[rg].name) || rg).join('、') + '最响。',
    });
  }
  const kidnap = (p.kidnap && p.kidnap.wanted) || 0;
  if (kidnap >= 10) {
    out.push({ kind: 'plain', text: `官面上还挂着你的名字（恶名 ${Math.round(kidnap)}）。` });
  }
  return out;
}

/** 给 `note()` 用的「谁在旁听见」判断（复用 addRumor 的目击规则，这里只做预告） */
function hasWitness(world, roomId) {
  const list = world.npcsIn ? world.npcsIn(roomId) : [];
  return list.some(n => n && !n.dead && !n.knockedOut && !(n.def || {}).hostile);
}

/** 小哈希（取模用；⚠️ 必须 >>> 0 —— 带符号负数取模会得到负下标） */
function hash(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

module.exports = { note, aboutPlayer, chatterIn, whatTheySay, reputationLines, hasWitness, score, spreadMax, dayOf, flagWisps, FLAG_WISPS };
