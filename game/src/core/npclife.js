/**
 * npclife.js — NPC 的日常（主人 2026-10-08）
 *
 * 主人列的那些事，一件件落在「**世界自己会转**」上：
 *   · 缺钱了去打工，挣了钱买吃的喝的
 *   · 自己练功；内力空了就打坐
 *   · 富人的钱袋鼓，穷人的钱袋瘪（家底见 `91_npclife.json`）
 *   · 江湖人身上带着兵器丹药，盗贼身上有赃物
 *   · 认识的碰见了攀谈，陌生的试探两句 —— 合不合得来**按性格相性**判，加/减好感
 *   · 性格相冲的会拌嘴、动手
 *   · 买卖讲价，老板答不答应看他什么性子
 *   · 拍卖行里互相抬价，抬急了会结仇、骂人、威胁
 *   · 宗门大比上，不同性格的人说的话不一样
 *   · 而这一切，**玩家在附近时屏幕上都会看到**
 *
 * ⚠️ 三条分寸：
 *   ① **抽样**，不遍历。463 个 NPC 每个 tick 全跑一遍，服务器会先烧掉。
 *      每次 tick 只挑一小撮「活跃」的人（玩家在同一区域的优先）。
 *   ② **同一个人一天只做一件大事**（`_lifeAt`），不然日志里全是他一个人在忙。
 *   ③ 播报走 `emit('storyline')` → `_tickLines` → 玩家下一条指令时带出来（已有机制）。
 */
'use strict';

const CFG = {
  samplePerTick: 4,        // 每次 tick 抽查几个 NPC
  actChance: 0.5,          // 抽到了也不一定动
  dayCooldown: 360,        // 同一个人多久之内不再「过日子」（分钟）
  chatChance: 0.35,        // 同屋两个人聊起来的概率
  quarrelChance: 0.3,      // 相性差的人拌嘴的概率
  poorLine: 30,            // 多少钱以下算「手头紧」
};

function hashN(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const pickBy = (arr, seed) => (arr && arr.length ? arr[hashN(seed) % arr.length] : '');

/**
 * 拿到「模板」那一层。
 * 🔴 ** 有两副面孔**：在**实例**上它是模板对象的引用（SPRINT1-ENG-02 的约定），
 *    可在**模板自己**身上， 是**防御力数值**（数据里写的就是 ）。
 *    第一版直接写 ，拿模板跑的时候当场炸在
 *    「Cannot create property 'carry' on number '180'」。所以取模板一律走这个入口。
 */
function tplOf(npc) {
  const d = npc && npc.def;
  return (d && typeof d === 'object') ? d : (npc && npc.__isTemplate ? npc : null);
}

/** 这个人的钱袋（实例优先，退回模板的 carry） */
function purseOf(npc) {
  if (!npc) return 0;
  if (typeof npc.money === 'number') return npc.money;
  const c = npc.carry || (tplOf(npc) || {}).carry || {};
  return typeof c.money === 'number' ? c.money : 0;
}
function setPurse(npc, v) {
  npc.carry = npc.carry || (tplOf(npc) || {}).carry || {};
  npc.carry.money = Math.max(0, Math.round(v));
  npc.money = npc.carry.money;
  const t = tplOf(npc);
  if (t) { t.carry = t.carry || {}; t.carry.money = npc.carry.money; }
}

/** 身上带的东西 */
function bagOf(npc) { return [].concat((npc && (npc.carry || (tplOf(npc) || {}).carry || {})).items || []); }

/* ---------------- 台词库 ---------------- */

/** 打招呼（按性格） */
const GREET = {
  haoshuang: ['{a}老远就冲{b}喊了一嗓子。', '{a}大手一挥：「{b}！过来喝一碗？」'],
  lengmo: ['{a}朝{b}点了一下头，算是打过招呼。', '{a}看了{b}一眼，没停步。'],
  baozhao: ['{a}粗声粗气地问了句：「{b}，吃了吗？」', '{a}拍了下{b}的肩，力气不小。'],
  youhua: ['{a}笑呵呵地凑上去：「{b}，今儿个气色好啊。」', '{a}先夸了{b}两句，才说自己要说什么。'],
  yinzhi: ['{a}拱了拱手，笑得客气。', '{a}站着说了几句闲话，眼睛看着别处。'],
  wenwan: ['{a}轻声问了句好。', '{a}把{b}让到阴凉处说话。'],
  mune: ['{a}闷闷地打了个招呼。', '{a}点了下头，没说话。'],
  qienuo: ['{a}缩着肩叫了声{b}，声音不大。', '{a}犹豫了一下才开口。'],
  xiayi: ['{a}抱拳：「{b}。」', '{a}正色问了句{b}的近况。'],
};

/** 闲聊的内容（与性格无关，是人都在聊的事） */
const SMALLTALK = [
  '两个人说了几句今年的雨水，说今年比去年好些。',
  '说起了城东那家铺子的价钱，一个说贵，一个说不算贵。',
  '聊到某家办喜事，说排场不小。',
  '说起前几日街上打起来的事，两个人都说没赶上。',
  '提到衙门新贴的告示，谁也认不全上头的字。',
  '说谁家的孩子进了学，说着说着就夸起来。',
  '皱着眉说了几句物价，末了一起叹气。',
  '聊起哪个戏班子要来，说这回得去听一场。',
];

/** 相性不合时的口角（按两人性格取强者的那方） */
const QUARREL = [
  '{a}说了句什么，{b}把脸拉下来了。',
  '{a}的声音高了些，{b}扭头就走了。',
  '两个人话没说完就呛上了，旁边的都往这边看。',
  '{a}拍了桌子，{b}冷笑一声。',
];

/* ---------------- ① 过日子：打工 / 吃喝 / 练功 / 打坐 ---------------- */

/** 一个 NPC 这一刻最该干什么（看他的状态，不是随机） */
function decide(world, npc) {
  const mp = npc.mp || 0, maxMp = npc.maxMp || 0;
  const money = purseOf(npc);
  const learned = Object.keys(npc.learned || {});
  /* 内力空了 → 打坐（会武的人才打坐） */
  if (learned.length && maxMp > 0 && mp < maxMp * 0.3) return 'meditate';
  /* 手头紧 → 去挣 */
  if (money < CFG.poorLine) return 'work';
  /* 有功夫且内力够 → 练功 */
  if (learned.length && maxMp > 0 && mp > maxMp * 0.5 && world.rng.next() < 0.5) return 'practice';
  /* 钱多肚子饿 → 吃点喝点 */
  if (money > CFG.poorLine * 4 && world.rng.next() < 0.5) return 'eat';
  /* 闲着也是一天（2026-10-13 动词池扩覆盖）：旧版走到这儿一律 null——
     「有钱、不会武」的路人整年无播报，市集里大半人一辈子没动静
     （smoke-npclife ⑦ 实测：抽样 60 tick 只捞到一句打招呼）。
     兜底：有钱的偶尔下馆子，其余找点活干。反正一人一天只动一次（_lifeDay）。 */
  if (world.rng.next() < 0.3) return 'eat';
  return 'work';
}

const WORK_LINE = {
  boatman: '替人摆了两趟渡，挣了', farmer: '在坡上锄了半天草，挣了',
  hunter: '进林子转了一天，得了', beggar: '讨了半天，讨到',
  waiter: '在店里跑了一天堂，得', waiter2: '在店里跑了一天堂，得',
  vendor: '把担子挑到市集上卖，得了', smith: '替人打了两把锄头，挣了',
  commoner: '替人搬了半天货，挣了', groom: '喂了一天马，挣了',
};

function actWork(world, npc) {
  const gain = 8 + Math.floor(world.rng.next() * 40);
  setPurse(npc, purseOf(npc) + gain);
  const t = WORK_LINE[npc.tag] || '打了一天短工，挣了';
  return { text: `${npc.name}${t} ${gain} 文。`, kind: 'plain' };
}

function actEat(world, npc) {
  const cost = 6 + Math.floor(world.rng.next() * 30);
  if (purseOf(npc) < cost) { setPurse(npc, 0); }
  else setPurse(npc, purseOf(npc) - cost);
  const what = pickBy(['一碗热汤面', '两个肉包', '一碟花生米就酒', '半只烧鸡', '一碗馄饨', '一壶粗茶'], npc.defId || npc.id);
  npc.hp = Math.min(npc.maxHp || 100, (npc.hp || 0) + Math.floor((npc.maxHp || 100) * 0.15));
  return { text: `${npc.name}要了${what}，吃完把碗一推。`, kind: 'plain' };
}

function actPractice(world, npc) {
  const ids = Object.keys(npc.learned || {});
  if (!ids.length) return null;
  const sid = ids[hashN((npc.defId || npc.id) + 'p') % ids.length];
  const sd = world.getSkill(sid);
  if (!sd) return null;
  const lv = npc.learned[sid].level || 0;
  npc.learned[sid].level = lv + 1;
  npc.mp = Math.max(0, (npc.mp || 0) - 12);
  return { text: `${npc.name}在院角打了一遍${sd.name}，收势时衣角还在抖。`, kind: 'plain' };
}

function actMeditate(world, npc) {
  const back = Math.floor((npc.maxMp || 10) * 0.4);
  npc.mp = Math.min(npc.maxMp || 0, (npc.mp || 0) + back);
  return { text: `${npc.name}盘腿坐下了，闭着眼细细地调息。`, kind: 'plain' };
}

/* ---------------- ② 社交：聊两句 / 拌嘴 ---------------- */

/**
 * 同屋两个人的互动。
 * 认识的先攀谈，陌生的试探两句 —— 合不合得来**按性格相性**：
 * 相性好就加好感，相性差就可能拌嘴（`affinityOf` 的那套规矩，与初见同源）。
 */
function socialize(world, a, b) {
  const P = require('./personality');
  const out = [];
  const aff = P.affinityOf(P.personaIdOf(a), P.personaIdOf(b));
  const seed = `${a.defId || a.id}|${b.defId || b.id}|${Math.floor((world.clockMinutes || 0) / 240)}`;
  const known = (a.favor || 0) > 0 || (b.favor || 0) > 0;

  out.push({ kind: 'plain', text: pickBy(GREET[P.personaIdOf(a)] || GREET.mune, seed + 'g').replace(/\{a\}/g, a.name).replace(/\{b\}/g, b.name) });

  if (aff.delta > 0) {
    out.push({ kind: 'plain', text: pickBy(SMALLTALK, seed + 's') });
    out.push({ kind: 'plain', text: `两个人越说越近，${b.name}还往${a.name}那边凑了凑。` });
    a.favor = (a.favor || 0) + 1; b.favor = (b.favor || 0) + 1;
  } else if (aff.delta < 0) {
    out.push({ kind: 'plain', text: pickBy(QUARREL, seed + 'q').replace(/\{a\}/g, a.name).replace(/\{b\}/g, b.name) });
    out.push({ kind: 'sys', text: `（${a.name}与${b.name}话不投机。）` });
    /* 相性差到一定程度 + 有武力 → 可能动手 */
    if (aff.delta <= -4 && world.rng.next() < CFG.quarrelChance && hasForce(world, a) && hasForce(world, b)) {
      const win = (a.atk || 0) >= (b.atk || 0) ? a : b;
      const lose = win === a ? b : a;
      lose.hp = Math.max(1, Math.floor((lose.maxHp || 100) * 0.3));
      out.push({ kind: 'story', text: `${win.name}先动了手。三招两式，${lose.name}被架开，退到墙根站住了。` });
      out.push({ kind: 'plain', text: `屋里的人往两边让了让，没人上去拉。` });
    }
  } else {
    out.push({ kind: 'plain', text: pickBy(SMALLTALK, seed + 's2') });
    out.push({ kind: 'plain', text: `说完各自散了，也没什么可说的。` });
  }
  return out;
}

function hasForce(world, npc) {
  if ((npc.atk || 0) >= 30) return true;
  try { return !!(world.npcHasMartialArts && world.npcHasMartialArts(npc)); } catch (e) { return false; }
}

/* ---------------- ③ 买卖讲价 ---------------- */

/**
 * NPC 向 NPC（或向铺子）买东西时的讲价。
 * 老板答不答应**看他的性子**；不同性子给不同后果。
 * @returns {{haggled:boolean, price:number, lines:Array}}
 */
function haggle(world, buyer, seller, price) {
  const P = require('./personality');
  const bp = P.personaIdOf(buyer), sp = P.personaIdOf(seller);
  const out = [];
  const seed = `${buyer.defId || buyer.id}|${seller.defId || seller.id}|${price}`;
  out.push({ kind: 'plain', text: pickBy([
    `${buyer.name}把东西翻来覆去看了半天，说：「便宜些。」`,
    `${buyer.name}问：「这个价，能不能再让让？」`,
    `${buyer.name}摸了摸钱袋，没说话，先叹了口气。`,
  ], seed + 'ask') });

  /* 老板的性子决定让不让 */
  const soft = { haoshuang: 0.7, youhua: 0.6, wenwan: 0.6, xiayi: 0.55, mune: 0.4, qienuo: 0.75, lengmo: 0.15, baozhao: 0.05, yinzhi: 0.1 };
  const rate = soft[sp] === undefined ? 0.4 : soft[sp];
  const buyerPush = { qienuo: 0.5, mune: 0.6, wenwan: 0.7, lengmo: 0.8, youhua: 0.95, haoshuang: 0.9, xiayi: 0.85, yinzhi: 0.9, baozhao: 1.0 };
  const push = buyerPush[bp] === undefined ? 0.8 : buyerPush[bp];

  if (world.rng.next() < rate * push) {
    const off = Math.max(1, Math.round(price * (0.1 + world.rng.next() * 0.2)));
    const final = Math.max(1, price - off);
    out.push({ kind: 'plain', text: pickBy([
      `${seller.name}摆摆手：「罢了罢了，拿去。」`,
      `${seller.name}把东西往${buyer.name}怀里一塞：「这个价，下次别来了。」`,
      `${seller.name}叹了口气：「就这一回。」`,
    ], seed + 'ok') });
    out.push({ kind: 'sys', text: `${buyer.name}花 ${final} 文买下了（省 ${off} 文）。` });
    setPurse(buyer, purseOf(buyer) - final);
    setPurse(seller, purseOf(seller) + final);
    return { haggled: true, price: final, lines: out };
  }
  out.push({ kind: 'plain', text: pickBy([
    `${seller.name}把东西收了回去：「不还价。」`,
    `${seller.name}眼皮都没抬：「嫌贵就别买。」`,
    `${seller.name}冷笑一声：「你当这是你家开的？」`,
  ], seed + 'no') });
  out.push({ kind: 'sys', text: `${buyer.name}没买成。` });
  return { haggled: false, price, lines: out };
}

/* ---------------- ④ 拍卖行竞价 ---------------- */

/** 两个人抬价抬急了 —— 会结仇、会骂人 */
function bidWar(world, a, b, lot) {
  const P = require('./personality');
  const ap = P.personaIdOf(a), bp = P.personaIdOf(b);
  const out = [];
  const seed = `${a.defId || a.id}|${b.defId || b.id}|${lot && lot.name}`;
  out.push({ kind: 'plain', text: `${a.name}叫了个价，${b.name}立刻跟上。` });
  out.push({ kind: 'plain', text: `两个人一路抬上去，旁人都不再出声了。` });

  const tough = { baozhao: 1.0, yinzhi: 0.8, haoshuang: 0.75, lengmo: 0.5, xiayi: 0.4, youhua: 0.45, wenwan: 0.2, mune: 0.2, qienuo: 0.1 };
  const aHard = tough[ap] === undefined ? 0.5 : tough[ap];
  const bHard = tough[bp] === undefined ? 0.5 : tough[bp];

  /* 谁也不让 → 骂起来 */
  if (aHard > 0.6 && bHard > 0.6 && world.rng.next() < 0.6) {
    const loser = aHard >= bHard ? b : a, winner = loser === a ? b : a;
    out.push({ kind: 'say', text: `${loser.name}把茶碗往桌上一顿：「你算什么东西，也配跟我抢？」` });
    out.push({ kind: 'say', text: `${winner.name}站起来：「这话你再说一遍。」` });
    out.push({ kind: 'story', text: `两边的人各自把手按在刀上。掌事的掌柜赶紧出来打圆场，把两人隔开。` });
    loser._grudge = loser._grudge || {};
    loser._grudge[winner.defId || winner.id] = true;
    out.push({ kind: 'sys', text: `（${loser.name}从此记恨上了${winner.name}。）` });
    return { feud: true, lines: out };
  }
  const winner = world.rng.next() < 0.5 ? a : b;
  const loser = winner === a ? b : a;
  out.push({ kind: 'plain', text: `${loser.name}看了看价，把手放下了。` });
  out.push({ kind: 'sys', text: `${winner.name}拍下了。` });
  return { feud: false, lines: out };
}

/* ---------------- ⑤ 宗门大比上说什么 ---------------- */

const TOURNEY_SAY = {
  haoshuang: ['（抱拳）「请了——别留手，留手没意思。」', '「打得痛快就好，输赢我不计较。」'],
  baozhao: ['（蹬了蹬靴子）「废话少说。」', '「三招之内打不倒你，我自己跳下去。」'],
  xiayi: ['「同门较技，点到为止。」', '（正色）「请。」'],
  yinzhi: ['（笑）「师兄手下留情。」', '「我这点微末功夫，不足挂齿。」'],
  youhua: ['「哎呀哎呀，我这三脚猫，上去了是要出丑的。」', '「师兄多担待。」'],
  mune: ['「……」', '（点了下头，没说话）'],
  wenwan: ['「请赐教。」', '（欠身）「师姐手下留情。」'],
  qienuo: ['（声音发紧）「我、我尽力。」', '（往后退了半步）「请……请。」'],
  lengmo: ['（把外袍解了，扔给同门）', '「开始吧。」'],
};

/** 大比开场，几句不同性子的人说的话 */
function tourneySay(world, a, b) {
  const P = require('./personality');
  const s1 = pickBy(TOURNEY_SAY[P.personaIdOf(a)] || TOURNEY_SAY.mune, `${a.defId || a.id}|t`);
  const s2 = pickBy(TOURNEY_SAY[P.personaIdOf(b)] || TOURNEY_SAY.mune, `${b.defId || b.id}|t`);
  return [
    { kind: 'say', text: `${a.name}${s1}` },
    { kind: 'say', text: `${b.name}${s2}` },
  ];
}

/* ---------------- ⑥ 总入口：跑一轮 ---------------- */

/**
 * 时间推进时跑一轮。**抽样**，不遍历。
 * @returns {Array<{kind,text}>} 要播给玩家的行（可能为空）
 */
function onTick(world, minutes) {
  const out = [];
  if (!world || !world.data) return out;
  const p = world.player;
  /* 只跑玩家所在区域的人 —— 看不见的地方不用花算力（也免得满屏陌生人的消息） */
  const here = p ? (world.getRoom(p.room) || {}).region : null;
  const pool = [];
  for (const n of Object.values(world.instances.npcs || {})) {
    if (!n || n.isPlayer || n.dead || n.knockedOut) continue;
    if (here) {
      const r = world.getRoom(n.room);
      if (!r || r.region !== here) continue;
    }
    pool.push(n);
  }
  if (!pool.length) return out;

  const day = Math.floor((world.clockMinutes || 0) / CFG.dayCooldown);
  for (let i = 0; i < Math.min(CFG.samplePerTick, pool.length); i++) {
    const n = pool[Math.floor(world.rng.next() * pool.length)];
    if (!n || n._lifeDay === day) continue;
    n._lifeDay = day;
    if (world.rng.next() > CFG.actChance) continue;
    const what = decide(world, n);
    if (!what) continue;
    let line = null;
    if (what === 'work') line = actWork(world, n);
    else if (what === 'eat') line = actEat(world, n);
    else if (what === 'practice') line = actPractice(world, n);
    else if (what === 'meditate') line = actMeditate(world, n);
    if (line) out.push(line);
  }

  /* 同屋的人聊两句（也抽样：只看玩家这一间 + 隔壁） */
  if (p) {
    const rooms = [p.room];
    const r0 = world.getRoom(p.room);
    for (const d of Object.keys((r0 && r0.exits) || {})) {
      const ex = r0.exits[d];
      const to = typeof ex === 'string' ? ex : ex && ex.to;
      if (to) rooms.push(to);
    }
    for (const rid of rooms) {
      const live = world.npcsIn(rid);
      if (live.length < 2) continue;
      if (world.rng.next() > CFG.chatChance) continue;
      const a = live[Math.floor(world.rng.next() * live.length)];
      const b = live.find(x => x !== a);
      if (!a || !b) continue;
      /* 挑一个「身上有事/有名有姓」的人做主角，别让两个路人甲占屏 */
      const key = `${a.defId}|${b.defId}|${Math.floor((world.clockMinutes || 0) / 240)}`;
      if (world._chatSeen === key) continue;
      world._chatSeen = key;
      out.push(...socialize(world, a, b));
    }
  }
  return out;
}

module.exports = {
  onTick, decide, socialize, haggle, bidWar, tourneySay,
  purseOf, setPurse, bagOf, hasForce, actWork, actEat, actPractice, actMeditate,
  GREET, SMALLTALK, QUARREL, TOURNEY_SAY, CFG,
};
