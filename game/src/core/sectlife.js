/**
 * sectlife.js — 门派生涯（主人 2026-10-08）
 *
 * 主人原话拆成四件事，都在这个模块里：
 *   ① **晋升线**：入派是「拜师」→ 贡献够了「拜长老」成真传 → 长老位空缺可「向宗主申请」
 *      → 长老互动面板出「挑战」（贡献够才让挑）→ 赢了往上走 → 走到头当宗主 → 切门派经营
 *   ② **收徒大典**：每个宗门各有一天，越强的宗门越难；不满足常例条件的人可以走大典进门
 *   ③ **任务处**：门派有自己的任务处（职位越高接到越好、贡献越多）；官府也有一个，赚功勋
 *   ④ **门派剧情**：初入一段，每升一级职位一段，当上宗主触发最终章（敌对门派下战书、华山对决）
 *
 * 剧情写得**按门派分岔**（正 / 邪 / 中立 × 门派层级），不是一份模板套 43 家。
 * 主人在剧情上给了全权，唯一的要求是「不能有 AI 味，要有真实感」——
 * 所以这里的文字一律走具体的人、具体的动作、具体的一句半句话，不写「命运的齿轮」那种。
 */
'use strict';

const DAY = 1440;
const FESTIVAL_PERIOD = 12;          // 大典每 12 天一轮（每个门派落在轮内不同的一天）

function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY) + 1; }

/** 稳定哈希（同 id 永远同结果）——用来给门派分大典日子 */
function hashN(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(s).length; i++) { h ^= String(s).charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** 门派层级 → 大典难度（通过率底数）。一流宗门门前排长队，三流巴不得你来。 */
const TIER_PASS = { '一流': 0.20, '二流': 0.42, '三流': 0.70, '秘境': 0.12 };
/** 门派层级 → 挑战/申请的硬门槛倍数 */
const TIER_GATE = { '一流': 3.0, '二流': 1.8, '三流': 1.0, '秘境': 3.6 };

function tierOf(sd) { return (sd && sd.tier) || '三流'; }

/* ============================================================
 * ① 收徒大典
 * ============================================================ */

/** 这门派的收徒大典什么时候开 */
function festivalInfo(world, sectId) {
  const sd = world.getSect(sectId);
  const tier = tierOf(sd);
  const off = hashN(sectId) % FESTIVAL_PERIOD;
  const d = dayOf(world);
  const phase = (((d - 1 - off) % FESTIVAL_PERIOD) + FESTIVAL_PERIOD) % FESTIVAL_PERIOD;
  const open = phase === 0;
  return {
    sectId, name: sd ? sd.name : sectId, tier,
    offset: off, period: FESTIVAL_PERIOD,
    open, inDays: open ? 0 : FESTIVAL_PERIOD - phase,
    passRate: TIER_PASS[tier] || 0.5,
  };
}

/** 今天全城哪几家在办大典（给玩家一个「今儿个哪儿收人」的提示） */
function festivalsToday(world) {
  const out = [];
  for (const sd of Object.values(world.data.sects || {})) {
    const f = festivalInfo(world, sd.id);
    if (f.open) out.push(f);
  }
  return out;
}

/**
 * 参加收徒大典。过了就直接入派（**破例**：大典本来就是为了收不满足常例的人）。
 * 难度按宗门层级 + 你自己的斤两算：一流宗门要真材实料，三流只要人不像话。
 */
function attendFestival(world, p, sectId) {
  const sd = world.getSect(sectId);
  if (!sd) return { ok: false, lines: [{ kind: 'warn', text: '（无此门派）' }] };
  if (p.sect) {
    const mine = world.getSect(p.sect);
    return { ok: false, lines: [{ kind: 'warn', text: `你已是${mine ? mine.name : p.sect}门下，须先脱门才能另投。` }] };
  }
  const f = festivalInfo(world, sectId);
  if (!f.open) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `${sd.name}的收徒大典不在今日。` },
        { kind: 'hint', text: `（还要等 ${f.inDays} 天。大典每 ${FESTIVAL_PERIOD} 日一轮，各家门派的日子都不一样。）` },
      ],
    };
  }
  const pr = powerOf(world, p);
  const need = 60 * (TIER_GATE[tierOf(sd)] || 1);
  const rate = clamp(f.passRate * (pr / need) + 0.08, 0.05, 0.88);
  const lines = [
    { kind: 'story', text: `山门前摆开长案，两名执事弟子一左一右，案上摊着名册。排在你前头的有赶车的、卖炭的、背着书箱的，一个个上去，一个个退下来。` },
  ];
  if (world.rng.next() < rate) {
    const r = p.joinSect(sectId, { force: true });
    lines.push({ kind: 'story', text: `轮到你时，执事弟子先看你掌心的茧，又叫你蹲下起身走了两步，末了把笔尖在名册上一点：「留下。」` });
    lines.push({ kind: 'sys', text: r.ok ? r.msg : `（${r.msg}）` });
    if (r.ok && p.vars) p.vars.sectFestivalIn = sectId;
    return { ok: true, lines };
  }
  lines.push({ kind: 'warn', text: `执事弟子看了你两眼，把名册往回一收：「今年人多，你且回去再练练。」` });
  lines.push({ kind: 'hint', text: `（大典看的是硬底子——气血、内力、手上的功夫。底子厚了再来。）` });
  return { ok: false, lines };
}

/* ============================================================
 * ② 晋升线
 * ============================================================ */

/** 一门派的职位名（没有就按默认六级） */
const DEFAULT_RANKS = ['外门弟子', '内门弟子', '执事弟子', '首座弟子', '副掌门', '掌门'];
function ranksOf(sd) { return (sd && sd.ranks && sd.ranks.length) ? sd.ranks : DEFAULT_RANKS; }
function rankName(sd, r) { const a = ranksOf(sd); return a[Math.max(0, Math.min(a.length - 1, r))]; }

/** 玩家的「斤两」——挑战/大典都拿它比 */
function powerOf(world, ch) {
  return (ch.atk || 0) * 2 + (ch.maxHp || 0) * 0.12 + (ch.maxMp || 0) * 0.2
    + (ch.attrTotal ? (ch.attrTotal('根骨') + ch.attrTotal('力量')) * 3 : 0);
}

/** 升到下一级要多少贡献 */
function promoteCost(p, sd, toRank) {
  const base = (sd && sd.rankCost) || 300;
  return Math.round(base * (toRank) * (TIER_GATE[tierOf(sd)] || 1));
}

/**
 * 拜长老 → 成真传（主人：「普通弟子晋升条件也是贡献足够后拜长老成真传」）。
 * 只在**同门**、**对方职位确实比你高**、**贡献够**的情况下成立。
 */
function promoteByMaster(world, p, npc) {
  if (!p.sect) return { ok: false, lines: [{ kind: 'warn', text: '你尚无门派，拜什么长老。' }] };
  const sd = world.getSect(p.sect);
  const myRank = p.rank || 0;
  if (myRank >= ranksOf(sd).length - 1) return { ok: false, lines: [{ kind: 'warn', text: '你已身居此位，无人可拜。' }] };
  const hisRank = (npc && npc.rank !== undefined) ? npc.rank : 3;
  if (hisRank <= myRank) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}的位次还在你之下，教不了你什么。` }] };
  }
  const to = myRank + 1;
  const need = promoteCost(p, sd, to);
  const contrib = p.sectContribution || 0;
  if (contrib < need) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `${npc.name}翻了翻功过册，把册子合上：「你的贡献还差着。」` },
        { kind: 'hint', text: `（升${rankName(sd, to)}需贡献 ${need}，你有 ${contrib}。去任务处接几桩门派差事。）` },
      ],
    };
  }
  p.sectContribution = contrib - need;
  p.rank = to;
  if (sd && sd.rankSkills && sd.rankSkills[to]) for (const s of sd.rankSkills[to]) p.learnSkill(s, { force: true });
  const lines = [
    { kind: 'story', text: `${npc.name}叫你到廊下站定，问了三句家常，又问你练的哪一路。你一一答了。末了他从袖中取出一枚牙牌递过来：「往后跟着我。」` },
    { kind: 'sys', text: `你成了${sd ? sd.name : ''}的${rankName(sd, to)}（耗去贡献 ${need}）。` },
  ];
  lines.push(...afterPromote(world, p, sd, to));
  return { ok: true, lines };
}

/** 长老位有缺 + 贡献够 → 向宗主申请（不挑战的那条路） */
function applyByPetition(world, p, npc) {
  if (!p.sect) return { ok: false, lines: [{ kind: 'warn', text: '你尚无门派。' }] };
  const sd = world.getSect(p.sect);
  const myRank = p.rank || 0;
  const to = myRank + 1;
  if (to >= ranksOf(sd).length) return { ok: false, lines: [{ kind: 'warn', text: '你已是掌门，无人可请。' }] };
  const vacancy = elderVacancy(world, sd);
  if (!vacancy) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `掌门摇头：「门中各房都有人管着，没有空位。真想上来，就去向长辈讨教——武人的位子，向来是打出来的。」` },
        { kind: 'hint', text: '（没人退位时只能走「挑战」。）' },
      ],
    };
  }
  const need = Math.round(promoteCost(p, sd, to) * 1.5);
  const contrib = p.sectContribution || 0;
  if (contrib < need) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `掌门把茶盏搁下：「空位是有一个。可你拿什么来说话？」` },
        { kind: 'hint', text: `（走门路要贡献 ${need}，你有 ${contrib}。）` },
      ],
    };
  }
  p.sectContribution = contrib - need;
  p.rank = to;
  if (sd && sd.rankSkills && sd.rankSkills[to]) for (const s of sd.rankSkills[to]) p.learnSkill(s, { force: true });
  const lines = [
    { kind: 'story', text: `你把礼单递上去，掌门看了很久，才慢慢说：「${vacancy ? vacancy.name : '某位师叔'}前月去了，位子空着。你既开口，我便记下。」` },
    { kind: 'sys', text: `你补了${rankName(sd, to)}的缺（耗去贡献 ${need}）。` },
  ];
  lines.push(...afterPromote(world, p, sd, to));
  return { ok: true, lines };
}

/**
 * 门中有没有空着的长老位。
 * 数据里没有「编制」这个概念，用**在位长老数**当近似：名门长老该有五六位，
 * 人手明显不齐就当作有空缺 —— 这既给出了「申请」这条路，又不会家家都有缺口。
 */
function elderVacancy(world, sd) {
  const want = Math.round(4 + (TIER_GATE[tierOf(sd)] || 1));
  const elders = Object.values(world.data.npcs)
    .filter(n => n.sect === sd.id && (n.rank === undefined ? 0 : n.rank) >= 2 && (n.rank === undefined ? 0 : n.rank) < 5);
  if (elders.length >= want) return null;
  /* 缺谁：报一个「已不在位」的名头，剧情里有个具体的说法 */
  return { name: '一位早年退下来的师叔', got: elders.length, want };
}

/** 能不能向这个人发起挑战 */
function canChallenge(world, p, npc) {
  if (!p.sect || !npc || npc.sect !== p.sect) return { ok: false, why: '不是你门中的人。' };
  const sd = world.getSect(p.sect);
  const myRank = p.rank || 0;
  const hisRank = (npc.rank !== undefined) ? npc.rank : 3;
  if (hisRank <= myRank) return { ok: false, why: `${npc.name}的位次不比你高，赢了也没意思。` };
  if (hisRank > myRank + 1) return { ok: false, why: `${npc.name}比你高出不止一级，先过了前一关再说。` };
  const need = Math.round(promoteCost(p, sd, hisRank) * 1.2);
  const contrib = p.sectContribution || 0;
  if (contrib < need) return { ok: false, why: `门里的规矩：挑战要押 ${need} 贡献作保（你有 ${contrib}）。` };
  return { ok: true, need, to: hisRank };
}

/** 发起挑战：押贡献、进战斗，输赢在 onNpcDown 里结算 */
function startChallenge(world, p, npc) {
  const c = canChallenge(world, p, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.why }] };
  p.sectContribution = (p.sectContribution || 0) - c.need;
  npc._challengedBy = p.id;
  npc._challengeTo = c.to;
  npc._challengeBet = c.need;
  const sd = world.getSect(p.sect);
  return {
    ok: true,
    lines: [
      { kind: 'story', text: `你解下佩剑搁在地上，朝${npc.name}抱拳：「弟子请前辈指点。」${npc.name}看了你一会儿，慢慢站起来，把椅子推到墙边——那是给你留出路的意思。` },
      { kind: 'sys', text: `押上贡献 ${c.need}。赢了升${rankName(sd, c.to)}，输了这笔就没了。` },
    ],
  };
}

/** 挑战打赢了（由 world.onNpcDown 调） */
function onChallengeResolved(world, p, npc) {
  if (!npc._challengedBy || npc._challengedBy !== p.id) return null;
  const to = npc._challengeTo;
  delete npc._challengedBy; delete npc._challengeTo; delete npc._challengeBet;
  const sd = world.getSect(p.sect);
  if (!sd) return null;
  p.rank = Math.max(p.rank || 0, to);
  if (sd.rankSkills && sd.rankSkills[to]) for (const s of sd.rankSkills[to]) p.learnSkill(s, { force: true });
  const lines = [
    { kind: 'story', text: `${npc.name}撑着手肘坐起来，咳了两声，眼里却没恼：「好。这一手是哪一年练出来的？」你说不上来。他摆摆手，让人把你的剑拣回来递给你。` },
    { kind: 'sys', text: `你升为${rankName(sd, to)}。` },
  ];
  lines.push(...afterPromote(world, p, sd, to));
  return { lines, promoted: true };
}

/** 当上掌门 → 切门派经营 */
function isSectMaster(p, sd) { return (p.rank || 0) >= ranksOf(sd).length - 1; }

/* ============================================================
 * ③ 任务处（门派 / 官府）
 * ============================================================ */

/** 门派任务池：按职位分层，越往上给的差事越重、贡献越多 */
const SECT_TASKS = [
  { minRank: 0, name: '送信', contrib: 25, desc: '把一封书送到城东的铺子，别拆封。' },
  { minRank: 0, name: '看门', contrib: 20, desc: '在山门守一日夜，来客一律登记。' },
  { minRank: 0, name: '采买', contrib: 30, desc: '去药铺采三十斤当归，钱是门里的。' },
  { minRank: 1, name: '巡山', contrib: 60, desc: '沿后山走一圈，前月有樵夫说见过生面孔。' },
  { minRank: 1, name: '教习', contrib: 70, desc: '给新来的弟子喂招，别真打。' },
  { minRank: 2, name: '押镖', contrib: 130, desc: '随镖车走一趟，路上别生事，生了也别怕。' },
  { minRank: 2, name: '查账', contrib: 150, desc: '账房说短了三成，你去问清楚。' },
  { minRank: 3, name: '赴约', contrib: 240, desc: '代门里去赴一场约，对方不好说话。' },
  { minRank: 3, name: '清门户', contrib: 280, desc: '有人坏了规矩，带回来，别伤他。' },
  { minRank: 4, name: '坐镇', contrib: 380, desc: '分舵出了乱子，你去压一压。' },
];

/** 官府任务池（官府线，走到头是「将军」） */
const OFFICIAL_TASKS = [
  { minRank: 0, name: '巡街', merit: 20, desc: '在城南巡一日，见着偷鸡摸狗的记下来。' },
  { minRank: 0, name: '递文', merit: 25, desc: '把公文递到府衙，路上别耽搁。' },
  { minRank: 1, name: '缉盗', merit: 80, desc: '城西有一伙偷牲口的，抓一个回来。' },
  { minRank: 1, name: '验尸', merit: 70, desc: '河上漂来一具，仵作一个人忙不过来。' },
  { minRank: 2, name: '护粮', merit: 160, desc: '押粮车过境，沿途有山贼。' },
  { minRank: 3, name: '平乱', merit: 300, desc: '乡里械斗，带人过去把人分开。' },
];

function rankOfSect(p) { return p && p.sect ? (p.rank || 0) : 0; }

/** 抽一门门派差事（职位越高，池子越大、给得越多） */
function drawSectTask(world, p) {
  const r = rankOfSect(p);
  const pool = SECT_TASKS.filter(t => t.minRank <= r);
  const t = world.rng.pick(pool.length ? pool : SECT_TASKS);
  return { ...t, kind: 'sect', rank: r };
}

/** 抽一门官府差事（功勋线独立：不看门派职位，看官身） */
function drawOfficialTask(world, p) {
  const r = (p.vars && p.vars.officialRank) || 0;
  const pool = OFFICIAL_TASKS.filter(t => t.minRank <= r);
  const t = world.rng.pick(pool.length ? pool : OFFICIAL_TASKS);
  return { ...t, kind: 'official', rank: r };
}

/* ============================================================
 * ④ 门派剧情
 *
 * 主人在剧情上给了全权，只提一条：**不能有 AI 味，要有真实感**。
 * 所以每一段都落到具体的人、具体的动作、具体的一句话上，
 * 不写「命运的齿轮开始转动」这种话；也不按「正道/邪道」贴标签，
 * 而是写**这一家门派的难处**——正派怕坏名声，邪派怕被人合起来打，中立的两头不讨好。
 * ============================================================ */

/** 按门派气质分野（正 / 邪 / 中立），每种给一套不同的走向 */
function flavorOf(sd) {
  const a = (sd && sd.align) || '';
  if (/正/.test(a)) return 'zheng';
  if (/邪|魔/.test(a)) return 'xie';
  return 'zhong';
}

/** 入门的头一段（初次进山门时出） */
function storyEntry(world, p, sd) {
  const f = flavorOf(sd);
  const master = sectLeaderName(world, sd);
  const who = master || '掌门';
  const T = {
    zheng: `拜过师的那天下午，${who}把你叫到祠堂前，指着两排灵牌说：「这里头一半是病死的老死的，还有七个，是死在别人手里的。你记着，我们这门的名声，是一代一代拿命换的。」你站着没说话，风把香灰吹到你鞋面上。`,
    xie: `入门的规矩是不摆香案。${who}只在堂上坐着，问了你一句：「你怕不怕别人骂你？」你说不怕。他笑了一声：「过两年就不这么说了。」旁边几个人也笑，笑得并不好看。`,
    zhong: `门中照例要考较新人的底子。${who}看完你打完一趟拳，只说了一句「还行」，就让人领你去后院安置。同来的几个人看你的眼神都不太一样——这里来的都是为了混口饭，谁也不比谁高。`,
  };
  return [{ kind: 'story', text: T[f] }];
}

/** 升到某一级职位时出的一段 */
function storyOnPromote(world, p, sd, rank) {
  const f = flavorOf(sd);
  const who = sectLeaderName(world, sd) || '掌门';
  const rn = rankName(sd, rank);
  const T = {
    zheng: `散值后${who}留你吃了顿饭。桌上只有两菜一汤，他给你夹了一筷子，忽然说：「你如今是${rn}了。往后有人拿我们门里的招牌在外头欺人，你得先去问清楚，别急着拔剑。」说完他自己先叹了口气。`,
    xie: `升了${rn}，按规矩该请你喝一场。酒过三巡，有人凑过来说：「上个月西市那桩买卖，本是我们先看上的，让金刀门抢了。」${who}没接话，只把杯子转了半圈——你明白这是要你记在心里。`,
    zhong: `${who}把你叫去，交给你一沓旧文书：「这是本门往来的账，你虽升了${rn}，先学会看这个人情往来，比练一套剑有用。」你翻了翻，里面夹着三张欠条，署的都是熟人的名字。`,
  };
  return [{ kind: 'story', text: T[f] }];
}

/** 升到掌门那一刻 */
function storyTakeOver(world, p, sd) {
  const who = sectLeaderName(world, sd);
  return [
    { kind: 'story', text: `${who}把印信放在桌上，推到你面前，自己起身把位置让开了：「我坐上这把椅子的时候，门里还有七十来号人；如今册子上四十二个，有两个已经三年没回来过了。你接着吧。」他没有回头，走出了门。` },
    { kind: 'sys', text: '你成了一门之主。门派经营（招人 / 派差事 / 调剂用度）已对你开放。' },
  ];
}

/** 进位之后该说的话：到顶就是继位，没到顶就是升职 —— 两条路共用一段收尾。 */
function afterPromote(world, p, sd, to) {
  const lines = isSectMaster(p, sd) ? storyTakeOver(world, p, sd) : storyOnPromote(world, p, sd, to);
  /* 升位是要被传的（自拟 🅔）。挂在这里是因为**三条晋升路**（拜长老 / 走门路 /
   * 挑战进位）最后都汇到 afterPromote —— 一处接线，三处都通，
   * 不会「挑战上去的没人知道、拜上去的满城皆知」。
   * ⚠️ 传出去 ≠ 当面念出来：这里只留一句提示，真话留给「风声」与进屋时的闲话。 */
  try {
    const r = require('./rumorfeed').note(world, 'rs_sect_promote', {
      vars: { whom: rankName(sd, to) },
      about: sd ? sd.id : null,
    });
    if (r) lines.push({ kind: 'hint', text: '（你升位的事，门外已经有人在嚼舌头了。）' });
  } catch (e) { /* 传不出去不该挡着升位 */ }
  return lines;
}

/** 掌门姓氏（剧情里用来称呼）——取该门派职位最高的那位 */
function sectLeaderName(world, sd) {
  if (!sd) return null;
  const list = Object.values(world.data.npcs).filter(n => n.sect === sd.id);
  if (!list.length) return null;
  const boss = list.find(n => n.role === '掌门' || n.title === '掌门') || list[0];
  return boss ? boss.name : null;
}

/**
 * 最终章：敌对门派下战书 → 华山对决。
 * ⚠️ 这一场**不进战斗界面**，是**剧情视角**一段一段演出来的（主人原话：
 *   「进入剧情视角按实力从弱到强顺序看门下弟子与敌对门派门下弟子…战斗」）。
 *   演法：两边弟子按实力从弱到强一对一，直演到一边没人站着；
 *   若我方只剩玩家一个站着 → 对方不讲武德一拥而上（玩家陷入围攻）；
 *   若我方赢到对方只剩宗主 → 玩家与对方宗主一对一。
 */
function duelOf(world, p, sd) {
  const foe = rivalSectOf(world, sd);
  if (!foe) return { ok: false, lines: [{ kind: 'warn', text: '（眼下没有与你门中结怨的对手。）' }] };
  const mine = sectFighters(world, sd.id, p);
  const theirs = sectFighters(world, foe.id, null);
  const rounds = [];
  const a = mine.slice(), b = theirs.slice();
  rounds.push({ kind: 'story', text: `华山之巅，风比山下硬。两边的人隔着三丈站定，谁也没先开口。${foe.name}的${sectLeaderName(world, foe) || '掌门'}把手里的战书抖开，念了三条旧账，每一条都有人应声。` });

  let i = 0;
  while (a.length > 1 && b.length > 0 && i < 6) {
    const x = a.shift(), y = b.shift();
    rounds.push({ kind: 'plain', text: `${x.name} 对上 ${y.name}。` });
    if (x.power >= y.power) {
      rounds.push({ kind: 'plain', text: `三十招上下，${y.name}的兵刃被磕飞出去，人退了半步，被人扶住。` });
      a.push(x);
    } else {
      rounds.push({ kind: 'plain', text: `${x.name}撑到二十来招，肩头挨了一下，被同门架了下去。` });
      b.unshift(y);
    }
    i++;
  }

  /* 我方只剩玩家 + 对方还有人 → 围攻；反之 → 与对方宗主一对一 */
  if (!a.length || (a.length === 1 && a[0].isPlayer && b.length > 1)) {
    rounds.push({ kind: 'story', text: `你这边站着的只剩你一个。对面的人互相看了一眼，没有再报名字——${theirs.length > 1 ? '他们一齐围了上来' : '最后那一个也提刀上前'}。` });
    return { ok: true, lines: rounds, stage: 'surrounded', foe: foe.id };
  }
  if (b.length === 1) {
    const boss = b[0];
    rounds.push({ kind: 'story', text: `对面只剩${boss.name}一个人了。他把外袍解开扔给弟子，慢慢走进场中——这是要单挑。` });
    return { ok: true, lines: rounds, stage: 'duel', foe: foe.id, bossName: boss.name };
  }
  rounds.push({ kind: 'story', text: `两边都还剩着人，天色却暗下来了。有人喊了一声「明日再议」，各自收兵。` });
  return { ok: true, lines: rounds, stage: 'draw', foe: foe.id };
}

/** 这一门派的死对头（关系最差的那家） */
function rivalSectOf(world, sd) {
  if (!sd) return null;
  if (!world.factionState) { try { world.initWorldDynamics(); } catch (e) { /* 忽略 */ } }
  const others = Object.values(world.data.sects || {}).filter(x => x.id !== sd.id);
  let worst = null, worstRel = 0;
  for (const o of others) {
    let rel = 0;
    try { rel = world.factionRel(sd.id, o.id); } catch (e) { rel = 0; }
    if (rel < worstRel) { worstRel = rel; worst = o; }
  }
  if (worst) return worst;
  /* 没有结怨的，就按层级挑一家同名头的（名门对名门） */
  return others.find(o => tierOf(o) === tierOf(sd)) || others[0] || null;
}

/** 一方能上场的弟子（按斤两从弱到强排） */
function sectFighters(world, sectId, p) {
  const list = Object.values(world.data.npcs)
    .filter(n => n.sect === sectId && n.name && !/掌门|宗主/.test(n.role || ''))
    .map(n => ({ name: n.name, power: (n.atk || 0) * 2 + (n.hp || 0) * 0.12, isPlayer: false }))
    .sort((x, y) => x.power - y.power)
    .slice(0, 4);
  if (p && p.sect === sectId) {
    list.push({ name: p.name, power: powerOf(world, p), isPlayer: true });
    list.sort((x, y) => x.power - y.power);
  }
  return list;
}

/* ============================================================
 * ⑤ 官府线（与门派线各走各的）
 *
 * 主人定死了天花板：**门派线能当宗主，官府线最多当到将军**。
 * 所以这条线不设「自立门户」，一路往上爬，最后一场是**上战场**。
 * ============================================================ */
const OFFICIAL_RANKS = ['白身', '差役', '捕头', '巡检', '都尉', '将军'];
const OFFICIAL_NEED = [0, 60, 260, 700, 1600];

/** 功勋够了就补缺；不够就什么都不发生（调用方据此决定要不要多说一句） */
function officialPromote(world, p) {
  p.vars = p.vars || {};
  const cur = p.vars.officialRank || 0;
  if (cur >= OFFICIAL_RANKS.length - 1) return null;
  const need = OFFICIAL_NEED[cur + 1];
  if (!need || (p.vars.officialMerit || 0) < need) return null;
  p.vars.officialRank = cur + 1;
  const next = OFFICIAL_RANKS[cur + 1];
  const lines = [{ kind: 'sys', text: `衙里递下话来：你补了「${next}」的缺，往后领的差事不一样了。` }];
  if (next === '将军') {
    lines.push({
      kind: 'story',
      text: `授印那天落了雪。你站在校场上，底下黑压压站满了人，他们的脸你一张也不认得。有人在队列里喊了一声「将军」，声音从前面一直滚到后面，滚了很久才停。你伸手按了按腰间那块冻硬的印，忽然想起很多年前在街上巡夜的那一晚。`,
    });
  }
  return { lines, rank: p.vars.officialRank };
}

/**
 * 官府最终章：上战场。敌国的队伍在河对岸列阵，不是一两个人能解决的事。
 * 与门派最终章一样，**用剧情视角演**，不进战斗界面 —— 千军万马拿回合制打，
 * 反倒是假的。
 */
function battleFront(world, p) {
  p.vars = p.vars || {};
  const rank = p.vars.officialRank || 0;
  if (rank < OFFICIAL_RANKS.length - 1) {
    return { ok: false, lines: [{ kind: 'warn', text: '统兵的事还轮不到你。你如今是' + (OFFICIAL_RANKS[rank] || '白身') + '。' }] };
  }
  const lines = [
    { kind: 'story', text: `天没亮就拔营。号角吹了三通，河面上的雾一起一落，对岸的旗子看得清了——旗是黑的，看不出是哪一路。` },
    { kind: 'story', text: `你在坡上站着，看自己的兵一排排往前压。第一排倒下去一半，第二排踩着人往上补，没有喊杀声，只有铁器撞在一处的那种闷响。` },
    { kind: 'story', text: `午后对面退了三十里。你走下坡的时候，靴子陷进泥里拔不出来，索性脱了拎在手上走。有人跟在后面问要不要追，你没答——你看见河滩上有一双脚，鞋还在，人也还在。` },
    { kind: 'sys', text: '敌阵溃退，这一仗算是打赢了。' },
    { kind: 'story', text: `夜里清点的时候，文书问你战功怎么写。你说就按册子写。他问你自己的那份，你顿了一下说：「写我骑马摔了一跤。」` },
  ];
  p.vars.frontDone = (p.vars.frontDone || 0) + 1;
  return { ok: true, lines, stage: 'front' };
}

module.exports = {
  dayOf, festivalInfo, festivalsToday, attendFestival,
  ranksOf, rankName, powerOf, promoteCost, promoteByMaster, applyByPetition,
  elderVacancy, canChallenge, startChallenge, onChallengeResolved, isSectMaster,
  drawSectTask, drawOfficialTask, SECT_TASKS, OFFICIAL_TASKS,
  officialPromote, battleFront, OFFICIAL_RANKS, OFFICIAL_NEED,
  storyEntry, storyOnPromote, storyTakeOver, duelOf, rivalSectOf, sectLeaderName, flavorOf,
  FESTIVAL_PERIOD, TIER_PASS, TIER_GATE,
};
