/**
 * outlaw.js — 匪类的自主行为（主人 2026-10-08）
 *
 * 一条链，每一环都是「先看，再决定」：
 *
 *   ① **互看**：经过时，匪类与旁人互相打量（一句话，按性格）。
 *   ② **匪类对玩家的决策**：量你的斤两、量你身上的钱和货，然后三选一 ——
 *        · 打不过 → 溜
 *        · 打得过且你身上有油水 → 直接动手抢
 *        · 打得过、你身上没油水、但你又很弱 → **打晕搜刮**（主人原话：「觉得玩家太穷
 *          没抢劫价值但很弱于是触发战斗打晕玩家卖掉」）
 *   ③ **旁人出手**：屋里有武力的人按**性格**决定 —— 有的二话不说上去，有的只冷冷看一眼。
 *      打赢了就把匪类打晕、装进麻袋、**交给衙门**（`world.arrestCriminal` 已有这条路）。
 *   ④ **追逐**：匪类碰上比自己强的练家子会**第一时间就跑**；追不追按那人的性格，
 *      追不追得上**看轻功**。追不上会在追出一段之后放弃。
 *   ⑤ **拦截**：匪类逃窜时正好从玩家身边掠过 —— 这时才弹出「拦不拦」。
 *      拦了，就是玩家 + 追来的那位 + 附近同样够胆的人一起上。
 *
 * ⚠️ 引擎里**没有 NPC 对 NPC 的真战斗**（battle 永远是「玩家 vs 对手」），
 *    所以 ③④ 是**结算式**的：比实力、掷骰、用文字把这一场演出来。
 *    为了一句台词去改战斗模型，风险远大于收益。
 * ⚠️ 一切都**压低频率**：同一伙匪类一天只闹一次（`_outlawAt`），
 *    否则玩家走三步就被抢一次，那不叫江湖，那叫收费站。
 */
'use strict';

const CFG = {
  gazeChance: 0.30,          // 进屋时「互相看了一眼」的概率
  actChance: 0.40,           // 匪类真的动手的概率（先看，再决定要不要动）
  cooldown: 240,             // 同一伙人多久之内不再闹（分钟）
  forceAtk: 30,              // 「有武力」的门槛（攻击力）
  strong: 1.45,              // 实力比高过它 → 匪类直接溜
  weak: 0.72,                // 实力比低过它 → 可以考虑「打晕搜刮」
  rich: 300,                 // 身上这些钱（含货值）才算「有油水」
  chaseRounds: 3,            // 最多追几段
};

/* ---------------- 谁是谁 ---------------- */

/** 匪类：山贼 / 强盗 / 盗贼 / 寇 —— 按 tag 与名字认，**不拿 hostile 当判据**（野兽也是 hostile） */
function isOutlaw(npc) {
  if (!npc) return false;
  const t = ((npc.tag || (npc.def && npc.def.tag) || '') + ' ' + (npc.name || '') + ' ' + ((npc.def && npc.def.name) || ''));
  return /bandit|brigand|thief|robber|匪|贼|盗|寇|山大王/.test(t);
}

/** 有武力的人（不是匪类的那些） */
function hasForce(world, npc) {
  if (!npc || isOutlaw(npc)) return false;
  if ((npc.atk || 0) >= CFG.forceAtk) return true;
  try { return !!(world.npcHasMartialArts && world.npcHasMartialArts(npc)); } catch (e) { return false; }
}

/** 一个人身上的油水：现钱 + 行囊里东西的估价 */
function wealthOf(world, ch) {
  let v = ch.money || 0;
  for (const it of (ch.inventory || [])) {
    const id = typeof it === 'string' ? it : (it && it.id);
    const d = id && world.getItem(id);
    if (!d) continue;
    const n = (typeof it === 'object' && it && it.count) ? it.count : 1;
    v += (d.price || 0) * n;
  }
  return Math.round(v);
}

function powerOf(world, ch) {
  try { return require('./sectlife').powerOf(world, ch); } catch (e) { return (ch.atk || 0) * 2 + (ch.maxHp || 0) * 0.12; }
}

/** 轻功等级（追不追得上就看它） */
function qinggongOf(ch) {
  const sid = ch.equippedSkills && ch.equippedSkills['轻功'];
  return (sid && ch.learned && ch.learned[sid] && ch.learned[sid].level) || 0;
}

/* ---------------- ① 互相打量 ---------------- */

const GAZE_OUTLAW = [
  '{a}蹲在路边，眼睛跟着你走了半条街——他在看你腰间，也在看你的手。',
  '{a}把刀横在膝上，抬头瞥你一眼，又低下头去，像是没提起来兴趣。',
  '{a}拿眼把你从头到脚扫了一遍，看得很慢，不避人。',
];
const GAZE_PEER = [
  '{a}往{b}那边看了一眼，手按在了刀柄上，没动。',
  '{a}和{b}对上一眼，两个人都没说话。',
  '{a}看了看{b}，又看了看别处。',
];

/** 屋里有人时，给一句「他们在互相看」 */
function gazeBeats(world, room, npcs) {
  const out = [];
  const live = (npcs || []).filter(n => n && n.name && !n.dead && !n.knockedOut);
  if (live.length < 2) return out;
  const seed = `${room.id}|${Math.floor((world.clockMinutes || 0) / 120)}|oz`;
  const foe = live.find(isOutlaw);
  if (foe) {
    const other = live.find(n => n !== foe);
    const t = pick(GAZE_PEER, seed).replace(/\{a\}/g, foe.name).replace(/\{b\}/g, other ? other.name : '你');
    out.push({ kind: 'plain', text: t });
  } else if (world.rng.next() < CFG.gazeChance) {
    const who = live[world.rng.int ? world.rng.int(0, live.length - 1) : 0];
    const per = require('./personality').personaIdOf(who);
    const t = pick(GAZE_BY_PERSONA[per] || GAZE_PEER, seed + '|p')
      .replace(/\{a\}/g, who.name).replace(/\{b\}/g, '你');
    out.push({ kind: 'plain', text: t });
  }
  return out;
}

/** 「被看了一眼」的通用句式（按性格）—— 主人要的「被 NPC 看了」 */
const GAZE_BY_PERSONA = {
  lengmo: ['{a}冷冷看了{b}一眼，没有别的表示。', '{a}的目光在{b}身上停了停，又移开了。'],
  haoshuang: ['{a}上下打量了{b}两眼，咧嘴一笑。', '{a}冲{b}点了点头，像是认得。'],
  baozhao: ['{a}瞪了{b}一眼，鼻孔里哼了一声。', '{a}斜着眼看{b}，手在袖子里攥了攥。'],
  qienuo: ['{a}飞快地瞟了{b}一眼，赶紧低下头。', '{a}缩在一边，偷偷看{b}。'],
  youhua: ['{a}眯着眼把{b}从头到脚看了一遍，脸上堆着笑。', '{a}看了{b}一眼，眼睛在{b}的钱袋上多停了一下。'],
  yinzhi: ['{a}眼皮抬了半寸，看了{b}一眼，随即合上。', '{a}像是不经意地扫了{b}一眼。'],
  mune: ['{a}抬头看了{b}一眼，又看回自己脚面。', '{a}闷闷地打量了{b}一下。'],
  wenwan: ['{a}抬眼看{b}一下，微微欠了欠身。', '{a}轻声问了句好，目光在{b}身上一掠。'],
  xiayi: ['{a}正眼看了{b}一看，点了点头——是习武人之间的见礼。', '{a}看了{b}一眼，手从兵刃上挪开了。'],
};

function pick(arr, seed) {
  if (!arr || !arr.length) return '';
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return arr[(h >>> 0) % arr.length];
}

/* ---------------- ② 匪类对玩家的决策 ---------------- */

/**
 * 匪类打量玩家之后干什么。
 * @returns {{act:'flee'|'rob'|'mug'|'ignore', lines:Array, power:number, wealth:number}}
 */
function assessPlayer(world, p, foe) {
  const mine = powerOf(world, foe);
  const his = powerOf(world, p);
  const wealth = wealthOf(world, p);
  const ratio = his / Math.max(1, mine);
  const li = [];

  li.push({ kind: 'plain', text: `你身上有几道目光重了些。${foe.name}把身子从墙根挪直，拿眼把你从头量到脚——先看你手上的茧，再看你腰间的钱袋。` });

  if (ratio > CFG.strong) {
    li.push({ kind: 'story', text: `他量完了，脸上那点意思就散了。他把脸转回自己那边，装作看天。有些账不用算第二遍。` });
    return { act: 'flee', lines: li, power: mine, wealth };
  }
  /* ⚠️ 判定顺序要紧：**先看有没有油水，再看弱不弱**。
     第一版把「有油水」写成 `wealth > rich && ratio > weak`，于是「又弱又有钱」的玩家
     两个条件都不满足，直接落到「不值得动手」——可那明明是最该抢的一个。
     （weak 那道线是给「打晕搜刮」用的：身上没油水的人才只好搜身。） */
  if (wealth > CFG.rich) {
    li.push({ kind: 'warn', text: `${foe.name}把刀从鞘里抽出半寸，又推回去，刀口对着光看了一眼。他在试刀有没有锈。` });
    li.push({ kind: 'story', text: `「路远。」他说，「留下买路的钱，你走你的道。」` });
    return { act: 'rob', lines: li, power: mine, wealth };
  }
  if (ratio < CFG.weak) {
    li.push({ kind: 'story', text: `${foe.name}看你走路的样子，看你袖口的磨痕，末了摇了下头——像在看一件不值钱的旧东西。` });
    li.push({ kind: 'story', text: `「穷。」他同旁边的人说了一句，语气很平。` });
    return { act: 'mug', lines: li, power: mine, wealth };
  }
  li.push({ kind: 'plain', text: `${foe.name}看了你一会儿，没看出什么值得动手的地方，把眼挪开了。` });
  return { act: 'ignore', lines: li, power: mine, wealth };
}

/* ---------------- ③ 旁人出手 ---------------- */

/** 有武力的人，按性格决定出不出手 */
function willStepIn(world, npc) {
  const per = require('./personality').personaIdOf(npc);
  const brave = { xiayi: 1, haoshuang: 0.85, baozhao: 0.9, yinzhi: 0.35, youhua: 0.3, mune: 0.25, wenwan: 0.15, qienuo: 0.05, lengmo: 0.45 };
  const base = brave[per] === undefined ? 0.3 : brave[per];
  return world.rng.next() <= base;   // 敢不敢上按性格；打不打得过交给 stepIn 去演（侠义的人也会算账，只是算得比别人晚）
}

const STEP_LINES = [
  '{a}把手里的东西往地上一搁，站了起来。',
  '{a}没说话，先解开了领口的扣子。',
  '{a}把外袍下摆往腰带里一掖。',
];

/** 有武力的人对匪类动手：结算式的一场，赢了大功告成 */
function stepIn(world, npc, foe) {
  const lines = [];
  const seed = `${npc.defId || npc.id}|${foe.defId || foe.id}|${Math.floor((world.clockMinutes || 0) / 60)}`;
  if (world.rng.next() < CFG.gazeChance) {
    lines.push({ kind: 'plain', text: pick(GAZE_BY_PERSONA[require('./personality').personaIdOf(npc)] || GAZE_PEER, seed).replace(/\{a\}/g, npc.name).replace(/\{b\}/g, foe.name) });
  }
  lines.push({ kind: 'plain', text: pick(STEP_LINES, seed).replace(/\{a\}/g, npc.name) });

  const a = powerOf(world, npc), b = powerOf(world, foe);
  if (a >= b * 0.9) {
    /* 打赢：打晕 → 装袋 → 交衙门 */
    foe.hp = 0; foe.dead = true; foe.knockedOut = true;
    lines.push({ kind: 'story', text: `两个人没说满三句就动了手。${foe.name}的刀快，${npc.name}的更快——刀磕在石阶上弹起来，人跟着就倒了。` });
    const officials = world.npcsIn(world.player ? world.player.room : foe.room)
      .filter(n => !n.dead && ['constable', 'official', 'escort'].includes(n.tag || (n.def || {}).tag));
    if (officials.length) {
      try { world.arrestCriminal(foe); } catch (e) { /* 交衙门失败不该打断演出 */ }
      lines.push({ kind: 'sys', text: `${npc.name}把人拖到街心，衙门的差役过来锁了，押回去了。` });
    } else {
      lines.push({ kind: 'plain', text: `${npc.name}把人捆了搁在墙根，说是等巡街的差役路过再交出去。` });
    }
    return { won: true, lines };
  }
  lines.push({ kind: 'story', text: `${npc.name}让刀锋擦着袖子过去了，退后半步，没再上。` });
  return { won: false, lines };
}

/* ---------------- ④ 追逐 ---------------- */

/**
 * 匪类要溜，练家子追不追。
 * 追得上追不上**看轻功**：比的是双方的轻功等级，差得越多越容易被甩掉。
 * @returns {{caught:boolean, lines:Array, fledTo:string}}
 */
function chase(world, chaser, foe, fromRoom) {
  const lines = [];
  const a = qinggongOf(chaser), b = qinggongOf(foe);
  const mine = powerOf(world, chaser), his = powerOf(world, foe);
  lines.push({ kind: 'story', text: `${foe.name}撒腿就往巷子口窜。${chaser.name}追了出去。` });
  /* 轻功差 + 实力差 —— 两项一起算 */
  const edge = (a - b) / 200 + (mine - his) / Math.max(1, his) * 0.3;
  const rounds = Math.max(1, Math.min(CFG.chaseRounds, Math.round(2 + edge)));
  const escaped = world.rng.next() > Math.min(0.92, 0.35 + edge * 0.5);
  if (!escaped) {
    foe.hp = 0; foe.dead = true; foe.knockedOut = true;
    lines.push({ kind: 'story', text: `追出${rounds}条街，${chaser.name}一脚踩住他的后襟。${foe.name}回身要砍，手腕先被扣住了。` });
    try { world.arrestCriminal(foe); } catch (e) { /* 忽略 */ }
    lines.push({ kind: 'sys', text: `人给按住了，差役随后就到。` });
    return { caught: true, lines, rounds };
  }
  /* 追不上：追出几段路，放弃 */
  const fleeTo = neighborOf(world, fromRoom, 2);
  lines.push({ kind: 'story', text: `追出${rounds}条街，那身影拐进一条窄巷就不见了。${chaser.name}停在巷口喘了两口气，啐了一口，转身往回走。` });
  return { caught: false, lines, fledTo: fleeTo, rounds };
}

/** 从某房间往外走 n 步（用来让逃掉的人真的换个地方） */
function neighborOf(world, roomId, n) {
  let cur = roomId;
  const seen = new Set([roomId]);
  for (let i = 0; i < n; i++) {
    const r = world.getRoom(cur);
    if (!r || !r.exits) break;
    /* ⚠️ 别绕回走过的地方 —— 上一站就是起点的话，「逃掉」等于没动，
       玩家下次进屋他还在原地杵着（第一次就这么绕回去了）。 */
    const dirs = Object.keys(r.exits).filter(d => {
      const ex = r.exits[d];
      const to = typeof ex === 'string' ? ex : ex && ex.to;
      return to && world.getRoom(to) && !seen.has(to);
    });
    if (!dirs.length) break;
    const d = dirs[Math.floor(world.rng.next() * dirs.length)];
    const ex = r.exits[d];
    const to = typeof ex === 'string' ? ex : ex && ex.to;
    seen.add(to); cur = to;
  }
  return cur;
}

/* ---------------- ⑤ 拦截 ---------------- */

/**
 * 匪类逃窜时正好从玩家身边过 → 弹出「拦不拦」。
 * 拦了：玩家 + 追来的那位 + 附近同样够胆的人一起上。
 */
function interceptPrompt(world, p, foe, chaser) {
  return {
    kind: 'warn',
    text: `${foe.name}正从你身边擦过去，肩膀撞了你一下——他连头都没回。`,
    choices: [
      { label: '拦住他', cmd: `拦截 ${foe.name}` },
      { label: '让开', cmd: '让开' },
    ],
  };
}

/** 玩家选择拦截：一群人围上去 */
function doIntercept(world, p, foe) {
  const lines = [];
  const room = p.room;
  const allies = world.npcsIn(room).filter(n => n !== foe && !n.dead && hasForce(world, n) && world.rng.next() < 0.6);
  lines.push({ kind: 'story', text: `你横身挡住巷口。${foe.name}收脚收得急，靴底在青石上蹭出一声长音。` });
  for (const a of allies) lines.push({ kind: 'plain', text: `${a.name}也围了上来。` });
  const my = powerOf(world, p) + allies.reduce((s, a) => s + powerOf(world, a), 0);
  const his = powerOf(world, foe);
  if (my >= his * 0.85) {
    foe.hp = 0; foe.dead = true; foe.knockedOut = true;
    lines.push({ kind: 'story', text: `他没退路了。几下交手，刀被打落，人跟着跪下。` });
    try { world.arrestCriminal(foe); } catch (e) { /* 忽略 */ }
    lines.push({ kind: 'sys', text: '这一场算你一份。' });
    return { ok: true, lines, allies: allies.length };
  }
  /* 拦不住：玩家自己挨一顿 */
  const dmg = Math.max(1, Math.floor((p.maxHp || 100) * 0.35));
  p.hp = Math.max(1, (p.hp || 1) - dmg);
  lines.push({ kind: 'warn', text: `他随手一刀逼开你，从缺口挤了出去。你袖子上开了一道口子。` });
  return { ok: false, lines, allies: allies.length, dmg };
}

/* ---------------- 总入口 ---------------- */

/**
 * 玩家进屋时跑一遍。返回要显示的 lines（可能为空）。
 * 顺序：先看 → 匪类决策 → 旁人出手 → 追逐 → 拦截提示。
 */
function onPlayerEnter(world, p, room, npcs) {
  const out = [];
  if (!p || world.battle) return out;
  const live = (npcs || []).filter(n => n && n.isNpc && !n.dead && !n.knockedOut);
  if (!live.length) return out;

  out.push(...gazeBeats(world, room, live));

  const foe = live.find(isOutlaw);
  if (!foe) return out;
  /* 冷却：同一伙人一天只闹一次 */
  const key = foe.defId || foe.id;
  if (foe._outlawAt && ((world.clockMinutes || 0) - foe._outlawAt) < CFG.cooldown) return out;

  /* 有武力的旁人先看见匪类 —— 他们可能先动手 */
  const brave = live.filter(n => n !== foe && hasForce(world, n)).find(n => willStepIn(world, n));
  if (brave && world.rng.next() < CFG.actChance) {
    foe._outlawAt = world.clockMinutes || 0;
    out.push(...stepIn(world, brave, foe).lines);
    return out;
  }

  if (world.rng.next() > CFG.actChance) return out;
  foe._outlawAt = world.clockMinutes || 0;
  const verdict = assessPlayer(world, p, foe);
  out.push(...verdict.lines);

  if (verdict.act === 'rob') {
    try { world.startCombat(p, foe); } catch (e) { /* 打不起来就只当威吓 */ }
    return out;
  }
  if (verdict.act === 'mug') {
    /* 打晕搜刮：玩家不会死，只会昏过去 —— 醒来时钱没了 */
    const lost = Math.floor((p.money || 0) * 0.6);
    p.money = Math.max(0, (p.money || 0) - lost);
    out.push({ kind: 'warn', text: `你还没转身，后脑就挨了一下。` });
    out.push({ kind: 'sys', text: `迷迷糊糊里有人在你身上摸索，翻走了 ${lost} 文钱。` });
    out.push({ kind: 'story', text: `再睁眼时天已经黑了。你躺在道边，鞋还在，钱袋空了。` });
    return out;
  }
  if (verdict.act === 'flee') {
    /* 匪类溜 —— 但先看有没有练家子要追 */
    const chaser = live.find(n => n !== foe && hasForce(world, n));
    if (chaser && world.rng.next() < 0.6) {
      const r = chase(world, chaser, foe, room.id);
      out.push(...r.lines);
      if (!r.caught) {
        if (r.fledTo) foe.room = r.fledTo;
        out.push(interceptPrompt(world, p, foe, chaser));
      }
      return out;
    }
    out.push({ kind: 'plain', text: `${foe.name}转身就走，走得很快，进巷子前回头看了一眼。` });
    const dest = neighborOf(world, room.id, 1);
    if (dest) foe.room = dest;
  }
  return out;
}

module.exports = {
  onPlayerEnter, assessPlayer, stepIn, chase, doIntercept, interceptPrompt,
  gazeBeats, GAZE_BY_PERSONA, isOutlaw, hasForce, wealthOf, powerOf, qinggongOf, CFG,
};
