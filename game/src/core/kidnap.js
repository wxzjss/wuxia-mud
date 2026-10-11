/* ============================================================
 * kidnap.js —— 掳人 · 奴役 · 护院
 *
 * 需求原文（主人三轮追加）：
 *   ① 「青楼可以为别人赎身」「把晕倒的 npc 装进麻袋带走」「（当众这么做）npc 必定报官」
 *      「npc 晕倒后一段时间有概率醒来（醒来为重伤），时间越久概率越大」
 *      「npc 发现自己被装进麻袋，根据不同性格会做出不同反应，比如哭泣或惊恐大喊大叫或愤怒大骂」
 *      「此时如果玩家路过其他 npc，根据不同性格那些会议论纷纷甚至报官」
 *      「若是 npc 有武在身则会试图拦下你」
 *      「若是麻袋里醒来的 npc 武艺高于玩家，则有概率从麻袋里冲出来誓要杀你」
 *      「被装进麻袋的 npc 可以被玩家买进青楼或其他地下场所」
 *   ② 「性格恶劣或贪财或非善性格的亡命之徒的 npc 也有概率这样做」
 *   ③ 「npc 会掳走晕倒的玩家与其他 npc，山贼这种 npc 甚至会主动把玩家或其他路过的 npc
 *       打晕装进麻袋卖」「玩家甚至也可以主动去买奴隶」
 *      「增加为家园购买护院功能（每天要给护院工资）」
 *      「奴隶有服从度，服从度低的奴隶有概率试图反抗或逃跑」
 *      「（如果玩家有派人监督 npc 则 npc 会与其触发战斗，玩家在旁边会触发战斗）」
 *      「增加邀请跟随系统，正常情况下只能邀请好感度 >60 的 npc，且 npc 有概率有事离开」
 *      「甚至让护院（如果没有则得额外付钱托人监督，武力越强费用越贵）让去盯着奴隶去工作
 *        （除非该奴隶服从度 >80 或好感度 >80，否则必须有护院，否则该奴隶有极大概率逃跑）」
 *      「给玩家赚钱（除了一些喜欢夜晚出行的 npc，夜间让 npc 打工会大幅降低服从度，
 *        npc 打完工后（参考现实打工人一天什么时候打完工）会回到玩家家园中等待
 *        （如果玩家没有家园则会在最近客栈等待）玩家回来后把赚到的钱给玩家）」
 *
 * ============================================================
 * 代价与规模：照《大明律》定，不拍脑袋（详见 design/07-kidnap-servitude-spec.md）
 *
 *  · 略卖良人为奴婢 → 杖一百、流三千里；三人以上或再犯 → 枷号一月、发边充军；
 *    三犯 → 极边永远充军。知情买方与犯人同罪。
 *    → 游戏化成一档 wanted（0~100），五档对应五种律罪。
 *  · 蓄奴限额照《唐会要·奴婢》「王公之家不得过二十人」的精神：
 *    奴数上限按玩家**家资等级**给（寒素 0 / 小康 3 / 富户 8 / 豪家 15 / 巨室 30），
 *    身份给上限，钱只决定买不买得起。
 *  · 奴价照汉代奴市「一二万钱 ≈ 一二亩膏腴田」按本作经济缩放 200 倍：
 *    九品 25 文 … 四品以上 500+ 文。
 *
 * ============================================================
 * 血泪约定（务必遵守，踩过就回不来了）
 *
 *  1. 随机一律走 w.rng（xorshift32，seed 固定），**禁止 Math.random()**，
 *     否则测试全假失败。
 *  2. 被掳的人不许凭空造：只能摘 w.instances.npcs 里 spawnNpc 出来的真实实例，
 *     并在 p.kidnap.bags 里留**完整快照**，醒来时原样装回，存档也要能往返。
 *  3. NPC 实例的 `.def` 是**模板对象引用**（不是防御力数值，数值在 .defFinal）——
 *     存快照时不能 JSON.stringify 模板进去（320 份模板会把存档撑爆），
 *     只存 defId，读档时按 defId 反查挂回。
 *  4. 快照字段 clone 进新对象，**不能直接引用实例**：
 *     直接引用 = 改一个带动全江湖（同 spawnNpc 的 favor/carry/rel 坑）。
 *  5. spawnNpc 新增字段必须 clone 进实例 —— 这里 spawn 出来的奴/护院
 *     要额外挂 obedience 之类，一律在 spawn 之后显式赋值。
 * ============================================================ */

'use strict';

const { clamp } = require('./utils');
const personality = require('./personality');

/* ============================================================
 * 一、常量表
 * ============================================================ */

/** 麻袋容量：一个人一只袋，最多扛 3 个 */
const MAX_BAGS = 3;
/** 醒来时的重伤比例（hp = maxHp * HURT_RATIO） */
const HURT_RATIO = 0.35;
/** 冲出麻袋时肾上腺素爆发的血量比例 */
const BURST_RATIO = 0.5;
/** 麻袋物品 id（20_items.json 里的 sack_coarse） */
const SACK_ID = 'sack_coarse';

/** 作息：辰时（480）开工，酉时（1080）收工 —— 主人说的「参考现实打工人作息」 */
const WORK_START = 480;
const WORK_END = 1080;
/** 夜间打工的时间窗（19:00~05:00） */
const NIGHT_FROM = 1140;   // 19:00
const NIGHT_TO = 300;      // 05:00

/** 家资等级 → 奴/护院上限（照唐律「身份给上限」的逻辑） */
const WEALTH_TIERS = [
  { id: 'poor',   name: '寒素', slaves: 0,  guards: 0, need: 0 },
  { id: 'fair',   name: '小康', slaves: 3,  guards: 2, need: 1 },
  { id: 'rich',   name: '富户', slaves: 8,  guards: 3, need: 2 },
  { id: 'grand',  name: '豪家', slaves: 15, guards: 4, need: 4 },
  { id: 'giant',  name: '巨室', slaves: 30, guards: 6, need: 7 },
];

/** 律罪档：wanted 阈值 → 档位（照大明律） */
const WANTED_TIERS = [
  { min: 20, id: 'exile',  name: '极边永远充军', short: '永远充军',
    desc: '三犯略卖，律当极边永远充军。天上地下，再无你容身之处。' },
  { min: 12, id: 'cangue', name: '枷号一月发边充军', short: '枷号充军',
    desc: '略卖三人以上或再犯，律当枷号一百斤一月，发边充军做苦役。' },
  { min: 6,  id: 'exile3k', name: '流三千里', short: '流三千里',
    desc: '略卖良人为奴婢，律当杖一百、流三千里。官府已在追查你。' },
  { min: 3,  id: 'cane100', name: '杖一百', short: '杖一百',
    desc: '首次被告发，律当杖一百。差役已在四处访你。' },
  { min: 0,  id: 'free',   name: '未及罪', short: '未及罪',
    desc: '还没人报官，但你欠下的账，迟早要算。' },
];

/** 奴价：照汉代奴市按本作经济缩放 200 倍 */
const SLAVE_PRICES = [
  { tier: 9, price: 25,  label: '九品' },
  { tier: 8, price: 50,  label: '八品' },
  { tier: 7, price: 100, label: '七品' },
  { tier: 6, price: 150, label: '六品' },
  { tier: 5, price: 250, label: '五品' },
  { tier: 4, price: 500, label: '四品以上' },
];

/** 劳作种类 */
const TASKS = {
  craft:    { key: 'craft',    name: '做工',   dur: 400, earn: [80, 200], desc: '土工搬运、砌墙刷灰，一天下来肩膀要散架。' },
  purchase: { key: 'purchase', name: '采买',   dur: 300, earn: [60, 140], desc: '进城采买各家物件，腿要跑断。' },
  errand:   { key: 'errand',   name: '跑腿',   dur: 180, earn: [30, 60],  desc: '送信看家打杂，杂役中最轻省的一样。' },
  laundry:  { key: 'laundry',  name: '洗衣',   dur: 240, earn: [35, 45],  desc: '浆洗一家老小的衣物，泡在皂角水里泡到指头发皱。' },
};

/** 性格 → 醒来反应（主人：哭泣 / 惊恐大喊大叫 / 愤怒大便，四个档） */
const WAKE_REACTIONS = {
  qienuo:  { cry: true,  text: '呜呜咽咽地哭起来，只敢小声抽泣，缩成一团不敢动。',           shout: 0.35 },
  wenwan:  { cry: true,  text: '柔声求饶：「好汉饶命，我什么都不知道……」声音抖得厉害。',     shout: 0.40 },
  mune:    { cry: false, text: '闷声不响，蜷在袋底一动不动，像是认命了。',                 shout: 0.15 },
  lengmo:  { cry: false, text: '一言不发，只从破洞里冷冷地盯着你，一声不吭。',             shout: 0.10 },
  youhua:  { cry: true,  text: '油嘴滑舌地套近乎：「这位爷，我给你干活成不？」——嘴上服软，眼睛还在盘算。', shout: 0.45 },
  baozhao: { cry: false, text: '破口大骂：「王八蛋！有种把老子放出去，咱们单挑！」',           shout: 0.80 },
  yinzhi:  { cry: false, text: '阴恻恻地笑：「你敢动我？我记住你的脸了。」',                 shout: 0.60 },
  haoshuang:{cry: false, text: '破口大骂，拳头砸得麻袋咚咚响：「狗日的！老子记住你了！」',   shout: 0.85 },
  xiayi:   { cry: false, text: '厉声呵斥：「光天化日之下掳人！你是哪路的贼寇？」',             shout: 0.75 },
};

/** 性格 → 扛袋路过时的路人反应（主人：议论纷纷甚至报官） */
const WITNESS_REACTIONS = {
  xiayi:    { text: '「光天化日之下掳人！我这就报官！」——他真的转身就往衙门跑。', report: true,  chance: 0.9 },
  baozhao:  { text: '「你在搞什么鬼！把袋子放下！」——他堵在路上骂骂咧咧。',                     report: false, chance: 0.3 },
  haoshuang:{ text: '几个人围过来指指点点，议论声越来越响。',                                   report: false, chance: 0.25 },
  lengmo:   { text: '瞥了一眼，默默绕开走——但他记住了你的脸。',                                 report: false, chance: 0.15 },
  qienuo:   { text: '吓得脸色煞白，远远躲开，生怕惹上麻烦。',                                     report: false, chance: 0.05 },
  youhua:   { text: '凑上来套近乎：「哟，这位爷，里头这位是要运往哪儿呐？」——这消息传得飞快。', report: true,  chance: 0.5 },
  wenwan:   { text: '轻声劝阻：「这位爷，放了她吧……」说着就去叫人。',                           report: true,  chance: 0.6 },
  mune:     { text: '木讷地站在那儿，讷讷地说：「这……不太好吧。」',                             report: false, chance: 0.2 },
  yinzhi:   { text: '阴鸷地看着你，嘴角一勾，不知道在打什么主意。',                               report: false, chance: 0.4 },
};

/** 亡命之徒：恶性 / 贪财 推断（主人第二轮：性格恶劣、贪财、非善的亡命之徒） */
const TAG_WICKED = {
  thief: 40, gambler: 35, escort: 10, eunuch: 20,
  constable: -30, official: -35, monk: -25, nun: -25,
  doctor: -10, teacher: -10, scholar: -15,
};
const PERSON_WICKED = {
  yinzhi: 20, baozhao: 20, youhua: 15,
  lengmo: -10, xiayi: -25, wenwan: -15, qienuo: -5,
};
const PERSON_GREED = {
  youhua: 25, yinzhi: 20, baozhao: 5,
  xiayi: -30, wenwan: -25, mune: -15, qienuo: -10,
};

/** 山贼/魔教这类「亡命之徒」tag（无 tag 的 hostile 靠名字判） */
const BANDIT_PATTERN = /山贼|贼寇|盗|匪|魔教|教众|刺客|黑衣人|刺客|逃犯|死囚/;

/** 黑市配置：镇场武者 + 赎回价（主人第三条：武力够强能打过黑市高薪聘请的武者）
 *  ⚠️ room 必须是 50_map.json 里**真实存在**的房间 id。
 *     写错一个字母 → inBlackMarket 永远 false → 买奴/赎身/买人全线瘫掉，
 *     而且不报错（只是「这不是黑市」一句），极难查。改这里之前先 grep 房间表。
 *  ⚠️ 醉春楼（jn_brothel_*）是青楼不是黑市 —— 赎人走那儿，但镇场武者配置不同，
 *     所以两条线是分开的。 */
const BLACK_MARKETS = [
  {
    id: 'secret_blackmarket', name: '秘境·黑市', room: 'secret_black_market',
    guardName: '独眼男人', guardPower: 260, guardItem: 'mob_bandit_chief',
    ransom: 1200, desc: '独眼男人坐在尽头，据说高价聘来的。这条路不太好走。',
  },
  {
    id: 'city_blackmarket', name: '东市·地下黑市', room: 'jm_underground',
    guardName: '寻常护卫', guardPower: 120, guardItem: 'mob_bandit',
    ransom: 800, desc: '两个寻常护卫看着门，价钱比秘境黑市低得多。',
  },
];

/* ============================================================
 * 二、数据与工具
 * ============================================================ */

/** 取（并懒初始化）玩家的掳人数据 */
function data(world) {
  const p = world.player;
  if (!p) return null;
  if (!p.kidnap || typeof p.kidnap !== 'object') {
    p.kidnap = { bags: [], slaves: [], guards: [], wageDue: 0, wanted: 0, reports: 0, debt: null };
  }
  const k = p.kidnap;
  k.bags = Array.isArray(k.bags) ? k.bags : [];
  k.slaves = Array.isArray(k.slaves) ? k.slaves : [];
  k.guards = Array.isArray(k.guards) ? k.guards : [];
  k.wageDue = k.wageDue || 0;
  k.wanted = k.wanted || 0;
  k.reports = k.reports || 0;
  if (!k.debt) k.debt = null;
  return k;
}

/** 武艺值：属性 + 武学等级 + 装备，用来比「谁更能打」 */
function martialPower(ch) {
  if (!ch) return 0;
  let pw = (ch.attrTotal ? ch.attrTotal('力量') : (ch.attr && ch.attr['力量']) || 0)
         + (ch.attrTotal ? ch.attrTotal('根骨') : (ch.attr && ch.attr['根骨']) || 0) * 1.5
         + (ch.attrTotal ? ch.attrTotal('身法') : (ch.attr && ch.attr['身法']) || 0) * 1.2;
  /* 武学等级总和（每级 3 点） */
  const learned = ch.learned || {};
  for (const sid of Object.keys(learned)) {
    const lv = learned[sid] && learned[sid].level;
    if (lv) pw += lv * 3;
  }
  /* 装备加成 */
  const eqs = (ch.equipment && Object.keys(ch.equipment)) || [];
  for (const slot of eqs) {
    const it = ch.equipment && ch.equipment[slot];
    if (it && it.stats) for (const k of Object.keys(it.stats)) pw += Number(it.stats[k]) || 0;
  }
  pw += Number(ch.atk) || 0;
  pw += Number(ch.defFinal !== undefined ? ch.defFinal : 0) * 2;
  return Math.max(0, Math.round(pw));
}

/** 恶性：模板显式 > tag 推断 > 性格推断 */
function wickednessOf(npc) {
  if (!npc) return 0;
  const def = npc.def || {};
  if (typeof def.wickedness === 'number') return clamp(def.wickedness, 0, 100);
  let w = 0;
  const tag = npc.tag || def.tag || '';
  w += TAG_WICKED[tag] || 0;
  const per = personality.personaIdOf(npc);
  w += PERSON_WICKED[per] || 0;
  /* hostile 的（山贼/魔教）默认就是亡命之徒 */
  if (def.hostile || BANDIT_PATTERN.test(npc.name || '')) w += 30;
  return clamp(w, 0, 100);
}

/** 贪财 */
function greedOf(npc) {
  if (!npc) return 0;
  const def = npc.def || {};
  if (typeof def.greed === 'number') return clamp(def.greed, 0, 100);
  const tag = npc.tag || def.tag || '';
  let g = (TAG_WICKED[tag] || 0) * 0.5;
  const per = personality.personaIdOf(npc);
  g += PERSON_GREED[per] || 0;
  if (def.hostile || BANDIT_PATTERN.test(npc.name || '')) g += 20;
  return clamp(g, 0, 100);
}

/** 是不是亡命之徒（够格自己动手掳人） */
function isDesperate(npc) {
  if (!npc) return false;
  const def = npc.def || {};
  const tag = npc.tag || def.tag || '';
  if (/thief|gambler/.test(tag)) return true;
  if (def.hostile || BANDIT_PATTERN.test(npc.name || '')) return true;
  return wickednessOf(npc) >= 55;
}

/** 是不是「喜欢夜晚出行的人」（作息与常人不同 → 夜班不扣服从度） */
function isNightOwl(npc) {
  const def = (npc && npc.def) || {};
  const sch = def.schedule || {};
  /* 作息与常人不同：白天的家和夜里的家不是一个地方 */
  if (sch.day && sch.night && sch.day !== sch.night) return true;
  /* 画像里的 routine 提到夜 */
  const rt = def.portrait && def.portrait.routine;
  if (rt && /夜/.test(String(rt))) return true;
  /* 职业本来就是夜间营业的 */
  if (/更夫|巡夜|夜行人|镖师|盗贼|刺客/.test(def.tag || '')) return true;
  return false;
}

/** 屋里现在能不能听见「麻袋里有人在喊」 */
function roomIsQuiet(world, roomId) {
  const room = world.getRoom(roomId);
  if (!room) return true;
  const m = world.clockMinutes % 1440;
  if (m >= NIGHT_FROM || m < NIGHT_TO) return true;      // 夜深
  if (/闹市|市集|街头|酒楼|客栈/.test(room.name || '')) return false;
  return false;
}

/** 目击者：同房间、清醒、非敌对的 NPC */
function witnesses(world, roomId, excludeId) {
  return world.npcsIn(roomId).filter(n =>
    n.id !== excludeId && !n.dead && !n.knockedOut && !(n.def && n.def.hostile));
}

/** 找屋里有武艺、可能拦下玩家的 NPC */
/* ⚠️ ：被绑的那个人**不算拦路的**。
   老路子只处理「已经晕倒」的目标（witnesses 会把倒下的人滤掉，撞不上），
   但「绑架」新增了**站着硬掳**这一路 —— 不排除的话，目标本人会跳出来
   「一声暴喝：住手！你扛的是什么！」，自己拦自己。 */
function interceptor(world, roomId, player, excludeId) {
  const mine = martialPower(player);
  let best = null;
  for (const n of witnesses(world, roomId)) {
    if (excludeId && n.id === excludeId) continue;
    if (excludeId && n.defId === excludeId) continue;
    if (martialPower(n) <= mine * 0.8) continue;
    if (!best || martialPower(n) > martialPower(best)) best = n;
  }
  return best;
}

/** 卖价：主人口径（品级基价 × 贪财加成 − 恶性折价） */
function sellPrice(npc) {
  const lv = (npc && (npc.level || (npc.def && npc.def.level))) || 1;
  const apt = npc && npc.attrTotal ? npc.attrTotal('资质') : 0;
  const greed = greedOf(npc);
  const wicked = wickednessOf(npc);
  const base = 200 + lv * 80 + apt * 12;
  return Math.max(10, Math.round(base * (1 + greed / 200) - wicked * 4));
}

/** 奴价（照 SLAVE_PRICES 档位） */
function slavePrice(npc) {
  const lv = (npc && npc.level) || 1;
  let tier = 9;
  if (lv >= 30) tier = 4;
  else if (lv >= 20) tier = 5;
  else if (lv >= 14) tier = 6;
  else if (lv >= 9) tier = 7;
  else if (lv >= 5) tier = 8;
  const row = SLAVE_PRICES.find(r => r.tier === tier) || SLAVE_PRICES[0];
  return row.price;
}

/** 玩家家资等级（照唐律「身份给上限」的逻辑） */
function wealthTier(world) {
  const p = world.player;
  if (!p) return WEALTH_TIERS[0];
  const homes = (p.homes || []).length;
  let plots = 0;
  try {
    const est = require('./estate');
    plots = (p.estate && p.estate.plots ? p.estate.plots.length : 0)
          + Object.keys((p.estate && p.estate.sponsored) || {}).length;
  } catch (e) { /* estate 不可用就当没地块 */ }
  const score = homes + plots + (p.money >= 10000 ? 1 : 0) + (p.money >= 50000 ? 2 : 0);
  let tier = WEALTH_TIERS[0];
  for (const t of WEALTH_TIERS) if (score >= t.need) tier = t;
  return tier;
}

/** 家资能给的名额 */
function quotas(world) {
  const k = data(world);
  const t = wealthTier(world);
  if (!k) return { tier: t, slaves: t.slaves, guards: t.guards, usedSlaves: 0, usedGuards: 0 };
  return {
    tier: t, slaves: t.slaves, guards: t.guards,
    usedSlaves: k.slaves.filter(s => !s.escaped).length,
    usedGuards: k.guards.length,
  };
}

/** 律罪档（把 wanted 换成人话） */
function wantedTier(wanted) {
  const w = wanted || 0;
  return WANTED_TIERS.find(t => w >= t.min) || WANTED_TIERS[WANTED_TIERS.length - 1];
}

/** 是否在青楼/楚馆
 *  ⚠️ 正则里**必须带「醉春楼」** —— 那是本游戏青楼的真名（50_map.json 里
 *     jn_brothel_* 六个房间全叫「醉春楼·门厅/花厅/戏台/雅阁/后厨/听雨轩」），
 *     漏了它等于整条青楼线（赎人/买奴/知情转卖加重）全瘫。
 *     改这里之前先 grep 地图里的房间名，别凭想象写。 */
function inBrothel(world) {
  const room = world.getRoom(world.player.room);
  if (!room) return false;
  if (room.region === 'qinglou') return true;      // 地图自己标了region，最稳
  /* ⚠️ 名字判定必须覆盖**所有**妓院，别只认「醉春楼」一个：
   *   实测五座城的妓院叫 怡红院 / 牡丹阁 / 翠云楼 / 凤来仪 / 平康坊，
   *   原正则漏了前四个 → 在江南以外的城市「赎身」会静默走进兜底分支
   *   （表现为「不是能赎身的地方」）。
   *   补漏时注意：房间名里带「楼」「阁」的普通建筑很多，
   *   所以只加明确带妓业意味的词，不加裸「楼/阁」。 */
  return /青楼|醉春楼|楚馆|平康坊|宜春院|妓|窑子|清倌|丽人院|怡红院|牡丹阁|翠云楼|凤来仪|绮罗院|春香阁|听雨楼|望江阁/.test(room.name || '');
}

/** 是否在地下场所（黑市/牙行） */
function inBlackMarket(world) {
  const room = world.getRoom(world.player.room);
  if (!room) return false;
  if (/黑市|地下|牙行|鬼市/.test(room.name || '')) return true;
  return BLACK_MARKETS.some(b => b.room && b.room === room.id);
}

/** 随机取一个黑市配置（优先匹配当前房间） */
function blackMarketAt(world) {
  const room = world.getRoom(world.player.room);
  if (room) {
    for (const b of BLACK_MARKETS) if (b.room === room.id) return b;
  }
  return BLACK_MARKETS.find(b => b.room && world.getRoom(b.room)) || BLACK_MARKETS[1];
}

/** 找最近的地下场所房间（被掳后醒来用） */
function nearestBlackRoom(world) {
  for (const b of BLACK_MARKETS) if (b.room && world.getRoom(b.room)) return b.room;
  /* 退而求其次：找名字带黑市/鬼市的房间 */
  for (const rid of Object.keys(world.data.rooms)) {
    const r = world.data.rooms[rid];
    if (r && /黑市|鬼市|地下/.test(r.name || '')) return rid;
  }
  return null;
}

/** 找能待着的房间：家园优先，否则最近客栈 */
function waitingRoom(world) {
  const p = world.player;
  if (p && p.homes && p.homes.length) {
    const h = world.getRoom(p.homes[0].id);
    if (h) return h.id;
  }
  try {
    const est = require('./estate');
    const est2 = p && p.estate;
    if (est2 && est2.plots && est2.plots.length) {
      const room = world.getRoom(est2.plots[0].roomId);
      if (room) return room.id;
    }
  } catch (e) { /* noop */ }
  return world.nearestEatery(p ? p.room : null);
}

/* ============================================================
 * 三、拍 NPC 快照（血泪：不能引用模板、不能引用实例）
 * ============================================================ */

/** 把一个 NPC 实例拍成可存进存档的纯数据快照 */
function snapshot(npc, extra) {
  return Object.assign({
    npcId: npc.id,
    defId: npc.defId,
    name: npc.name,
    gender: npc.gender,
    level: npc.level || 1,
    attr: Object.assign({}, npc.attr || {}),
    learned: JSON.parse(JSON.stringify(npc.learned || {})),
    hp: npc.hp, maxHp: npc.maxHp,
    favor: npc.favor || 0,
    personality: npc.personality || null,
    room: npc.room,
    tag: npc.tag || null,
    /* 性格相关：醒来反应与路人反应靠它 */
    wicked: wickednessOf(npc),
    greed: greedOf(npc),
    power: martialPower(npc),
  }, extra || {});
}

/** 按快照把 NPC 重新塞回世界 */
function reviveFromSnapshot(world, snap, roomId) {
  const def = world.data.npcs[snap.defId];
  if (!def) return null;
  const npc = world.spawnNpc(snap.defId, roomId || snap.room || world.player.room, 1, true);
  if (!npc) return null;
  if (snap.attr) { npc.attr = Object.assign({}, snap.attr); npc.recalc(); }
  if (snap.learned) npc.learned = JSON.parse(JSON.stringify(snap.learned));
  if (snap.favor) npc.favor = snap.favor;
  if (snap.personality) npc.personality = snap.personality;
  npc.hp = clamp(snap.hp || snap.maxHp || 1, 1, npc.maxHp || 1);
  return npc;
}

/* ============================================================
 * 四、玩家侧：装麻袋
 * ============================================================ */

/**
 * 把一个已晕倒的 NPC 装进麻袋。
 * 流程（照主人规则）：拦路检查 → 装袋 → 目击判定（有目击必报官）→ 记恶名
 *
 * @returns {ok, lines, bag?}
 */
/* ================================================================== *
 *  一之三、「绑架」成功率（主人 2026-10-11）
 *
 *  主人原话：「npc 互动页面的『绑架』按钮右侧会显示成功率（根据该 npc 是否处于昏迷
 *  状态（如果是的话必定成功）、双方实力以及当前血量状态以及身上是否有负面 buff
 *  之类的判断）；判定成功会在屏幕上显示将该 npc 掳进麻袋的剧情，判定失败才会进入战斗
 *  （战斗胜利会把该 npc 打昏迷过去）。」
 *
 *  ⚠️ 这份判定**只写在这里一份**：面板上显示的那行百分比，与真动手时掷的那次骰子
 *     必须走同一个函数。两处各写一套，迟早出现「写着 70% 却打十次输十次」。
 * ================================================================== */

/** 他身上的负面状态有几个（中毒／受伤／眩晕／封穴之类）
 *  判据：显式 debuff 标记 > 名字/tag 里带坏词 > 任何一项 mod 为负。
 *  ⚠️ 三条任一命中就算 —— 各模块造 buff 的写法不统一，只认一条会漏一大半。 */
function debuffCount(npc) {
  const BAD = /毒|伤|晕|封|迷|乱|麻|虚|弱|惧|残|debuff|blind|stun|poison|weak|slow/i;
  return ((npc && npc.buffs) || []).filter(b => {
    if (!b) return false;
    if (b.debuff === true) return true;
    if (typeof b.tag === 'string' && BAD.test(b.tag)) return true;
    if (typeof b.name === 'string' && BAD.test(b.name)) return true;
    const mods = b.mods || {};
    return Object.keys(mods).some(k => typeof mods[k] === 'number' && mods[k] < 0);
  }).length;
}

/** 一个角色的「斤两」（与门派争位那套口径同源：攻×2 + 气血×0.12 + 内力×0.2 + 属性×3） */
function heftOf(ch) {
  if (!ch) return 0;
  return (ch.atk || 0) * 2 + (ch.maxHp || 0) * 0.12 + (ch.maxMp || 0) * 0.2
    + (ch.attrTotal ? (ch.attrTotal('根骨') + ch.attrTotal('力量')) * 3 : 0);
}

/**
 * 能不能绑得成、几成把握。
 * @returns {{chance:number, pct:number, why:string, knocked:boolean, reasons:string[]}}
 */
function assess(world, p, npc) {
  if (!p || !npc) return { chance: 0, pct: 0, why: '无人可绑。', knocked: false, reasons: [] };
  if (npc.knockedOut) {
    return { chance: 1, pct: 100, why: '他已不省人事，套上袋就走。', knocked: true, reasons: ['昏迷（必成）'] };
  }
  const mine = heftOf(p), his = heftOf(npc);
  const reasons = [];
  let c = 0.18;
  const ratio = his > 0 ? mine / his : 2;
  const byPower = Math.max(-0.25, Math.min(0.42, (ratio - 1) * 0.3));
  c += byPower;
  reasons.push(byPower >= 0 ? `你比他壮（${(ratio * 100).toFixed(0)}%）` : `他比你壮（${(ratio * 100).toFixed(0)}%）`);
  const hpRatio = (npc.maxHp || 1) > 0 ? Math.max(0, Math.min(1, (npc.hp || 0) / npc.maxHp)) : 1;
  const byHp = (1 - hpRatio) * 0.45;
  c += byHp;
  if (byHp > 0.04) reasons.push(`他只剩 ${Math.round(hpRatio * 100)}% 气血`);
  const db = debuffCount(npc);
  const byBuff = Math.min(0.24, db * 0.08);
  c += byBuff;
  if (db) reasons.push(`身上带着 ${db} 处负面状态`);
  c = Math.max(0.05, Math.min(0.95, c));
  const pct = Math.round(c * 100);
  return {
    chance: c, pct, knocked: false, reasons,
    why: reasons.join('；') || '全看手上功夫',
  };
}

/**
 * 「绑架」：一条路走完 —— 晕着的直接装；站着的先掷一次骰子，
 * **成了就当场掳进麻袋（不开打）**，没成才动手。
 */
function kidnapAttempt(world, kw) {
  const p = world.player, k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  /* 袋子的两道前置，与 packNpc 同一套话（先说了再动手） */
  if (p.countItem(SACK_ID) < 1) {
    return { ok: false, lines: [{ kind: 'warn', text: '你没有麻袋。得先弄一只（集市、杂货铺都有卖）。' }] };
  }
  if (k.bags.length >= MAX_BAGS) {
    return { ok: false, lines: [{ kind: 'warn', text: `你已经扛着 ${k.bags.length} 只麻袋了，扛不动更多。` }] };
  }
  if (world.battle) return { ok: false, lines: [{ kind: 'warn', text: '交着手呢，手上腾不开。' }] };

  const here = (world.npcsIn(p.room) || []).filter(n => !n.isPlayer);
  const standing = kw
    ? here.find(n => (n.name || '').includes(kw) || kw.includes(n.name || ''))
    : null;
  /* 找不到站着的人（或没给名字）→ 交给老路：晕着的直接装，别的给指引 */
  if (!standing) return packNpc(world, kw);

  const a = assess(world, p, standing);
  /* 骰子用 world.rng（测试里钉得住） */
  const roll = world.rng ? world.rng.next() : Math.random();
  if (roll < a.chance) {
    const r = packNpc(world, kw, { target: standing, grab: true });
    if (r && r.lines && !r.battle) {
      /* 得手那一句要写在最前头 —— 让「你怎么得的手」先落进玩家眼里 */
      r.lines.unshift({
        kind: 'story',
        text: pickGrab(world, standing, a).replace(/\{a\}/g, standing.name),
      });
    }
    return r;
  }

  /* 没扣住 → 撕破脸开打。战斗赢了对方自然会晕（onNpcDown 会标 knockedOut），
     回来再点一次「绑架」就是必成的了。 */
  standing.hostile = true;
  world.startCombat(p, standing);
  return {
    ok: false, battle: true,
    lines: [
      { kind: 'story', text: `你从背后欺上去，手刚要搭上${standing.name}的肩 —— 他像是背后长了眼，侧身让开了。` },
      { kind: 'warn', text: `${standing.name}回头看你，脸沉了下来。（动手吧；打倒了再装袋。）` },
    ],
  };
}

/** 得手那一句（几种写法，别每次都一个样） */
function pickGrab(world, npc, a) {
  const pool = npc.knockedOut
    ? ['你把他拦腰一抄，塞进麻袋，扎紧了袋口。']
    : [
      '你从他侧后方出手，一手捂嘴一手扣腕，他没来得及喊出声，人就软了。麻袋往头上一套，绳头咬在牙里一抽，扎紧。',
      '你假装侧身让路，错身那一下手腕一翻，正扣住他的脉门。他挣了两下，麻袋已经套到了肩上。',
      '你没给他机会转身。膝弯一顶，人往下一软，麻袋顺势而下，从头罩到脚。',
      '他刚开口喊了半个字，你的肘已经到了。剩下半声咽回去，人跟着倒进袋里。',
    ];
  return pool[Math.abs(npc.name.length + Math.round(a.chance * 100)) % pool.length];
}

function packNpc(world, kw, opts) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const lines = [];
  opts = opts || {};

  /* ---- 前置 1：得先有袋子 ---- */
  if (p.countItem(SACK_ID) < 1) {
    return { ok: false, lines: [{ kind: 'warn', text: '你没有麻袋。得先弄一只（集市、杂货铺都有卖）。' }] };
  }
  /* ---- 前置 2：袋子没满 ---- */
  if (k.bags.length >= MAX_BAGS) {
    return { ok: false, lines: [{ kind: 'warn', text: `你已经扛着 ${k.bags.length} 只麻袋了，扛不动更多。` }] };
  }

  /* ---- 找目标 ----
   * 默认找同房间里**已晕倒**的：用 downedIn 而不是 npcsIn —— npcsIn 过滤 dead，
   * 而被打倒的人恰好是 knockedOut=true + dead=true（战斗层面算「倒下」），
   * 用 npcsIn 会一个都找不到。
   * `opts.target` 是「绑架」判定成功那条路传进来的（那人还站着，是硬掳的）。 */
  let target = opts.target || null;
  if (!target) {
    const downed = world.downedIn(p.room);
    if (!downed.length) {
      return { ok: false, lines: [{ kind: 'warn', text: '这屋里没有昏倒的人。麻袋只装得下失去知觉的。' }] };
    }
    target = kw ? downed.find(n => (n.name || '').includes(kw) || kw.includes(n.name || '')) : downed[0];
    if (!target) {
      return {
        ok: false,
        lines: [
          { kind: 'warn', text: `这里没有叫「${kw}」的昏倒之人。` },
          { kind: 'hint', text: '可装的人：' + downed.map(n => n.name).join('、') },
        ],
      };
    }
  }
  /* ---- 前置 3：关键 NPC 不许装（BOSS / 有任务的） ---- */
  const tdef = target.def || {};
  if (tdef.quest && tdef.quest.length) {
    return { ok: false, lines: [{ kind: 'warn', text: `${target.name}身上牵着事，你掳了他，怕是要把整条线索都断了。` }] };
  }

  /* ---- 拦路：有武艺且强过玩家的 NPC 会拦（主人规则） ---- */
  const guard = interceptor(world, p.room, p, opts.target ? (opts.target.id || opts.target.defId) : null);
  if (guard) {
    guard.hostile = true;
    world.startCombat(p, guard);
    lines.push({ kind: 'warn', text: `${guard.name}一声暴喝：「住手！你扛的是什么！」` });
    lines.push({ kind: 'story', text: `${guard.name}一横身拦在你面前，麻袋的事只好先放一放。` });
    return { ok: false, battle: true, lines };
  }

  /* ---- 装袋：从世界里摘出来，存快照 ---- */
  p.removeItem(SACK_ID, 1);
  const snap = snapshot(target, {
    uid: 'bag_' + (world.clockMinutes) + '_' + Math.floor(world.rng.next() * 100000),
    putAt: world.clockMinutes,
    wakeAt: 0,
    state: 'out',
    hp: Math.max(1, Math.round((target.maxHp || 10) * HURT_RATIO)),
  });
  k.bags.push(snap);
  delete world.instances.npcs[target.id];

  lines.push({ kind: 'story', text: `你麻利地把${target.name}塞进麻袋，麻绳扎紧了袋口，往肩上一甩。` });
  lines.push({ kind: 'sys', text: `（麻袋里还剩 ${k.bags.length} 个位置可用）` });

  /* ---- 目击判定（主人规则：当众这么做，必报官） ---- */
  const wit = witnesses(world, p.room, target.id);
  if (wit.length) {
    /* 按性格分流 */
    let reported = 0;
    for (const n of wit) {
      const per = personality.personaIdOf(n);
      const r = WITNESS_REACTIONS[per] || WITNESS_REACTIONS.mune;
      lines.push({ kind: 'sys', text: `　${n.name}${r.text}` });
      /* 「必定报官」：侠义/油滑/温婉这几类当场告发；其余是概率 */
      if (r.report && (r.chance >= 0.9 || world.rng.chance(r.chance))) reported++;
    }
    k.reports += wit.length;
    if (reported > 0) {
      /* 报官 = 「略卖」论罪起步，wanted 直接起跳 */
      const add = reported >= 3 ? 4 : (reported === 2 ? 2 : 1);
      k.wanted += add;
      p.wanted = (p.wanted || 0) + add;
      p.karma = (p.karma || 0) - 2 * add;
      if (p.reputation) {
        p.reputation['侠义'] = (p.reputation['侠义'] || 0) - add;
        p.reputation['恶名'] = (p.reputation['恶名'] || 0) + add;
      }
      lines.push({ kind: 'warn', text: `【被告发】${reported} 人报官！你被记上了——律法：略卖良人为奴婢，杖一百，流三千里。` });
      lines.push({ kind: 'hint', text: `　（当前恶名：${k.wanted}　档位：${wantedTier(k.wanted).name}）` });
    } else {
      lines.push({ kind: 'hint', text: '　（暂时没人去报官，但你欠下的账记在案上了。）' });
    }
  } else {
    lines.push({ kind: 'hint', text: '四下无人——没人看见这一手。' });
  }
  world.emit('kidnap', { kind: 'pack', name: target.name, room: p.room });
  return { ok: true, lines, bag: snap };
}

/** 扛袋状态一览 */
function listBags(world) {
  const k = data(world);
  if (!k) return [];
  return k.bags.map((b, i) => Object.assign({}, b, {
    idx: i + 1,
    minutesIn: world.clockMinutes - (b.putAt || world.clockMinutes),
  }));
}

/**
 * 把袋里的人放出来。
 * 醒着的（struggling）放人 = 放虎归山：他会跑，严重时直接跟玩家开战。
 */
function releaseBag(world, idx) {
  const p = world.player;
  const k = data(world);
  if (!k || !k.bags.length) return { ok: false, lines: [{ kind: 'warn', text: '你没有扛着麻袋。' }] };
  const i = Number(idx) - 1;
  const b = k.bags[i];
  if (!b) return { ok: false, lines: [{ kind: 'warn', text: '数一数，第几袋？' }] };

  const lines = [];
  const npc = reviveFromSnapshot(world, b, p.room);
  k.bags.splice(i, 1);
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '这人已经找不回来了（模板丢失）。' }] };

  if (b.state === 'struggling' && b.hurt < npc.maxHp * 0.5) {
    /* 重伤醒来的人被放出来 = 拼命 */
    lines.push({ kind: 'story', text: `你解开麻绳，${npc.name}一骨碌爬出来，眼睛通红，一头撞过来！` });
    npc.hostile = true;
    npc.favor = -100;
    world.startCombat(p, npc);
    lines.push({ kind: 'warn', text: `${npc.name}是拼了命的！你最好想清楚。` });
    return { ok: true, battle: true, lines, npc };
  }
  /* 老实放人：好感大涨 */
  npc.favor = clamp((npc.favor || 0) + 40, -200, 200);
  lines.push({ kind: 'story', text: `你把${npc.name}从袋里放了出来，他踉跄几步，回头看了你一眼，一句话也没说地走了。` });
  lines.push({ kind: 'sys', text: '　（放人一次，此人好感大增。若他报官，你的恶名还要再涨。）' });
  /* 放人也有概率被追着报官 */
  if (world.rng.chance(0.3)) {
    k.wanted += 1;
    p.wanted = (p.wanted || 0) + 1;
    lines.push({ kind: 'warn', text: '　他走不多时就回头喊了起来——有人要去报官！' });
  }
  return { ok: true, lines, npc };
}

/* ============================================================
 * 四b、家园地牢（关押 / 提审 / 陪练 / 放出）
 *
 *  ⚠️ 为什么单开一节：`estate.js` 里的 `dungeon` 地块此前**只有定义、没有接线** ——
 *     玩家花 3200 文 + 铁矿石 16 + 丝线 2 开出来的地牢，什么也做不了；
 *     `captiveCap` / `tortureRate` / `sparExp` 三个字段全仓**没有任何地方读**
 *     （典型「不报错就是不生效」）。这里把它们接上：
 *       · captiveCap  同时能关几个人（每级 +1）
 *       · tortureRate 提审时套出话的概率加成
 *       · sparExp     陪练涨熟练度的倍率加成
 *
 *  数据：p.kidnap.captives = [ 麻袋快照 + { jailedAt, obedience, favor,
 *        interrogated, intel[], lastSpar, hp } ]，随手存档走。
 * ============================================================ */

/** 地牢状态：有没有建成、几级、能关几个、在哪儿 */
function dungeonOf(world) {
  const p = world.player;
  const est = p && p.estate;
  if (!est) return { level: 0, cap: 0, tortureRate: 0, sparExp: 0, roomId: null, has: false };
  /* 懒 require：estate → home，与 kidnap 无循环依赖，但要避免顶层互相 require */
  const estateMod = require('./estate');
  const level = estateMod.plotLevel(est, 'dungeon');
  const rec = (est.plots || []).find(x => x.key === 'dungeon');
  const eff = estateMod.estateEffects(world) || {};
  return {
    level,
    cap: Math.max(0, Math.round(eff.captiveCap || 0)),
    tortureRate: eff.tortureRate || 0,
    sparExp: eff.sparExp || 0,
    roomId: rec ? rec.roomId : null,
    has: level > 0,
  };
}

/** 地牢里关着的人（懒初始化成数组） */
function captives(world) {
  const k = data(world);
  if (!k) return [];
  if (!Array.isArray(k.captives)) k.captives = [];
  return k.captives;
}

/** 按名字模糊找人（不传就取第一个） */
function findCaptive(world, kw) {
  const list = captives(world);
  if (!kw) return list[0] || null;
  return list.find(c => (c.name || '').includes(kw) || kw.includes(c.name || '')) || null;
}

/** 从麻袋押进地牢（关押） */
function imprison(world, kw) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const dg = dungeonOf(world);
  if (!dg.has) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: '你还没有地牢。' },
        { kind: 'hint', text: '回自家主院发「开垦 地牢」——需主院到「宅院」以上，3200 文 + 铁矿石 16、丝线 2。' },
      ],
    };
  }
  const cap = Math.max(1, dg.cap);
  const list = captives(world);
  if (list.length >= cap) {
    return { ok: false, lines: [{ kind: 'warn', text: `地牢里已经关了 ${list.length} 个（上限 ${cap}）。再扩一级能多关一个。` }] };
  }
  if (!k.bags.length) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: '你袋里没人。得先把人打晕装进麻袋，再扛回来关。' },
        { kind: 'hint', text: '　（在打倒的人身上用「装人 <名字>」。）' },
      ],
    };
  }
  const i = kw ? k.bags.findIndex(b => (b.name || '').includes(kw) || kw.includes(b.name || '')) : 0;
  if (i < 0) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `袋里没有叫「${kw}」的人。` },
        { kind: 'hint', text: '袋里是：' + k.bags.map(b => b.name).join('、') },
      ],
    };
  }
  const b = k.bags.splice(i, 1)[0];
  list.push(Object.assign({}, b, {
    jailedAt: world.clockMinutes,
    obedience: 15,
    favor: Math.min(0, b.favor || 0),
    interrogated: 0,
    intel: [],
    lastSpar: 0,
  }));
  /* 人进了牢房，扎袋的麻绳解开——袋子还给你（`giveItem` 在 world 上，不是 p 上） */
  world.giveItem(p, SACK_ID, 1);
  const lines = [
    { kind: 'story', text: `你把${b.name}从袋里拖出来，推进地牢的栅门，落了锁。` },
    { kind: 'sys', text: `　（地牢 ${list.length}/${cap}　麻袋收回来了）` },
    { kind: 'hint', text: '　可对他「提审 <人名>」套话、「陪练 <人名>」拿他喂招、「放出 <人名>」放人。' },
  ];
  world.emit('kidnap', { kind: 'jail', name: b.name });
  return { ok: true, lines };
}

/** 提审：逼问线索（tortureRate 越高越容易问出来；用刑有恶名风险） */
function interrogate(world, kw) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const dg = dungeonOf(world);
  if (!dg.has) return { ok: false, lines: [{ kind: 'warn', text: '你还没有地牢。' }] };
  const list = captives(world);
  const c = findCaptive(world, kw);
  if (!c) {
    return { ok: false, lines: [{ kind: 'warn', text: list.length ? `地牢里没有叫「${kw}」的人。` : '牢里空着，提审谁？' }] };
  }

  const lines = [];
  const m = world.clockMinutes % 1440;
  const isNight = m >= NIGHT_FROM || m < NIGHT_TO;
  /* 夜里审更熬得住人（囚犯困），所以成功率略高 */
  const rate = clamp(0.4 + (dg.tortureRate || 0) + (isNight ? 0.15 : 0), 0.05, 0.95);
  p.advanceTime(20);
  p.stamina = clamp((p.stamina || 100) - 10, 0, p.maxStamina || 100);
  c.interrogated = (c.interrogated || 0) + 1;
  /* 每多审一次，嘴越紧 */
  const stubborn = Math.max(0.4, 1 - c.interrogated * 0.12);

  lines.push({ kind: 'story', text: `你把${c.name}从牢里提出来，逼问起来。` });

  if (world.rng.next() >= rate * stubborn) {
    c.obedience = clamp((c.obedience || 0) - 5, 0, 100);
    c.favor = clamp((c.favor || 0) - 10, -200, 200);
    lines.push({ kind: 'warn', text: `　${c.name}咬紧牙关，一个字也不肯说。` });
    if (!dg.tortureRate) lines.push({ kind: 'hint', text: '　（地牢修得越深，套话越容易——升级「地牢」试试。）' });
    return { ok: true, lines };
  }

  /* 套出东西：一律按**显式字段**分派（他真有什么说什么，不猜） */
  const def = world.data.npcs[c.defId] || {};
  c.obedience = clamp((c.obedience || 0) - 15, 0, 100);
  c.favor = clamp((c.favor || 0) - 25, -200, 200);
  const done = c.intel || (c.intel = []);
  const cands = [];

  /* ① 他手里牵着的事（quests / sidequest） */
  const qids = [];
  if (Array.isArray(def.quests)) for (const q of def.quests) qids.push(q);
  if (def.sidequest) qids.push(def.sidequest);
  for (const q of qids) {
    if (done.indexOf('quest:' + q) >= 0) continue;
    const qd = world.getQuest(q);
    if (!qd) continue;
    const tip = String((qd.stages && qd.stages[0] && qd.stages[0].desc) || qd.desc || '').slice(0, 40);
    cands.push({ key: 'quest:' + q, text: `【线索】他熬不住，抖出一桩事：「${qd.name}」——${tip}` });
  }
  /* ② 他认识的人（rel：仇 / 友 / 亲）——286 个 NPC 都有 */
  for (const r of (def.rel || [])) {
    if (!r || !r.id) continue;
    const key = 'rel:' + r.kind + ':' + r.id;
    if (done.indexOf(key) >= 0) continue;
    const other = world.data.npcs[r.id];
    if (!other || !other.name) continue;
    const kindCN = { 仇: '仇家', 友: '故交', 亲: '亲眷' }[r.kind] || '旧识';
    const word = r.kind === '仇' ? '咬牙切齿' : (r.kind === '亲' ? '声音发颤' : '神色一黯');
    cands.push({ key, text: `【线索】他${word}，说出一个名字：${other.name}——「这是我的${kindCN}。」` });
  }
  /* ③ 师承 / 门派 */
  if (def.sect && done.indexOf('sect') < 0) {
    const s = world.data.sects && world.data.sects[def.sect];
    cands.push({ key: 'sect', text: `【线索】他招了出身：${(s && s.name) || def.sect}门下。` });
  }
  /* ④ 最后总能榨出点私房钱 */
  if (done.indexOf('money') < 0) cands.push({ key: 'money', text: '__MONEY__' });

  const pick = cands.find(x => done.indexOf(x.key) < 0);
  if (!pick) {
    lines.push({ kind: 'plain', text: `　${c.name}把知道的都倒干净了，再问也只有这几句。` });
    return { ok: true, lines };
  }
  done.push(pick.key);
  if (pick.text === '__MONEY__') {
    const loot = world.rng.int(50, 400) + 20 * Math.floor(martialPower(p) / 120);
    p.money += loot;
    lines.push({ kind: 'sys', text: `　他扛不住，说出了私藏银钱的地方——你摸出 ${loot} 文。` });
  } else {
    lines.push({ kind: 'sys', text: '　' + pick.text });
  }
  /* 私刑的代价：牢里的动静可能惊动街坊 */
  const k = data(world);
  if (k && world.rng.chance(0.25)) {
    k.wanted += 1;
    p.wanted = (p.wanted || 0) + 1;
    if (p.reputation) p.reputation['恶名'] = (p.reputation['恶名'] || 0) + 1;
    lines.push({ kind: 'warn', text: '　（牢里的动静传了出去，你的恶名 +1。）' });
  }
  return { ok: true, lines };
}

/** 陪练：拿他当活靶子喂招（sparExp 越高长得越快；但他会伤、会恨你） */
function sparWith(world, kw) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const dg = dungeonOf(world);
  if (!dg.has) return { ok: false, lines: [{ kind: 'warn', text: '你还没有地牢。' }] };
  const list = captives(world);
  const c = findCaptive(world, kw);
  if (!c) {
    return { ok: false, lines: [{ kind: 'warn', text: list.length ? `地牢里没有叫「${kw}」的人。` : '牢里空着，跟谁练？' }] };
  }
  const ids = Object.keys(p.learned || {});
  if (!ids.length) return { ok: false, lines: [{ kind: 'warn', text: '你还没学过任何武学，练不出什么。' }] };
  /* 优先挑装备槽上的武学（那才是你真正在用的） */
  const slotIds = ids.filter(id => (p.equippedSkills || {})[id]);
  const pool = slotIds.length ? slotIds : ids;
  const sid = pool[Math.floor(world.rng.next() * pool.length)];
  const sd = world.getSkill(sid) || { name: sid };
  const lv = (p.learned[sid] && p.learned[sid].level) || 0;

  /* 他越不服 / 越恨你，越不肯好好喂招（配合度 0.3~1） */
  const bond = clamp(((c.obedience || 0) + (c.favor || 0) + 120) / 220, 0.3, 1);
  const mul = (0.25 + (dg.sparExp || 0)) * bond;

  p.advanceTime(45);
  p.stamina = clamp((p.stamina || 100) - 30, 0, p.maxStamina || 100);
  p.hp = clamp(p.hp - Math.floor(p.maxHp * 0.05), 1, p.maxHp);

  const gain = Math.max(1, Math.floor(p.skillExpNeed(lv) * mul));
  const g = p.gainSkillExp(sid, gain);
  const lines = [
    { kind: 'story', text: `你把${c.name}押出来，解开一只手，让他给你喂招。` },
    { kind: 'sys', text: `　${sd.name}：${g.msg}（陪练共得 ${gain} 点）` },
  ];
  c.hp = Math.max(1, Math.round((c.hp || 1) * 0.88));
  c.obedience = clamp((c.obedience || 0) - 6, 0, 100);
  c.favor = clamp((c.favor || 0) - 12, -200, 200);
  c.lastSpar = world.clockMinutes;
  if ((c.hp || 1) < (c.maxHp || 10) * 0.25) {
    lines.push({ kind: 'warn', text: `　${c.name}已经不成人形了——再练下去要出人命。` });
  }
  if ((c.favor || 0) <= -80) {
    lines.push({ kind: 'hint', text: `　（${c.name}恨极了你。这种人关着，早晚要出事。）` });
  }
  return { ok: true, lines };
}

/** 放出：开锁放人（手段用得多的人，出来会记恨你） */
function freeCaptive(world, kw) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const dg = dungeonOf(world);
  if (!dg.has) return { ok: false, lines: [{ kind: 'warn', text: '你还没有地牢。' }] };
  const list = captives(world);
  const c = findCaptive(world, kw);
  if (!c) {
    return { ok: false, lines: [{ kind: 'warn', text: list.length ? `地牢里没有叫「${kw}」的人。` : '牢里空着，放谁？' }] };
  }
  const npc = reviveFromSnapshot(world, c, dg.roomId || p.room);
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '这人已经找不回来了（模板丢失）。' }] };
  list.splice(list.indexOf(c), 1);
  npc.hp = clamp(Math.round(c.hp || 1), 1, npc.maxHp || 1);
  if (npc.recalc) npc.recalc();

  const lines = [{ kind: 'story', text: `你把${c.name}从地牢里放了出来。他扶着墙站了半晌，才慢慢走远。` }];
  const wronged = (c.interrogated || 0) > 0 || (c.favor || 0) < -30;
  npc.favor = clamp((npc.favor || 0) + (wronged ? -70 : 30), -200, 200);
  if (wronged) {
    lines.push({ kind: 'sys', text: '　（他记恨你。放他走，多半是放虎归山。）' });
    if (world.rng.chance(0.5)) {
      npc.hostile = true;
      world.startCombat(p, npc);
      lines.push({ kind: 'warn', text: `　${c.name}一出门就红了眼，扭头扑上来！` });
      return { ok: true, battle: true, lines, npc };
    }
  } else {
    lines.push({ kind: 'sys', text: '　（你终究没难为他，他记你一恩。）' });
  }
  return { ok: true, lines, npc };
}

/** 地牢巡视：人不在家时，关久了又恨你的犯人会试着撬锁 */
function checkCaptiveEscape(world, minutes) {
  const p = world.player;
  const list = captives(world);
  if (!p || !list.length) return [];
  const dg = dungeonOf(world);
  if (!dg.has) return [];
  /* 你人在主院或牢门口，谁也跑不了 */
  const onGuard = (p.home && p.room === p.home) || (dg.roomId && p.room === dg.roomId);
  if (onGuard) return [];
  const lines = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    const hate = Math.max(0, -(c.favor || 0)) / 100;      /* 越恨越想跑 */
    const rate = (0.01 + hate * 0.04) / Math.max(1, dg.level);
    if (!world.rng.chance(rate / 30 * Math.max(1, minutes / 30))) continue;
    list.splice(i, 1);
    const npc = reviveFromSnapshot(world, c, world.nearestEatery(p.room) || p.room);
    if (npc) { npc.favor = -60; npc.vars = npc.vars || {}; npc.vars.escapedFrom = p.name; }
    lines.push({ kind: 'warn', text: `【越狱】${c.name}不知用什么撬开了铁栅，趁你不在家跑了。` });
    if (world.rng.chance(0.4)) {
      const k = data(world);
      if (k) { k.wanted += 1; p.wanted = (p.wanted || 0) + 1; }
      lines.push({ kind: 'warn', text: '　（他径直去了衙门——你的恶名 +1。）' });
    }
  }
  return lines;
}

/* ============================================================
 * 五、时间推进：醒来 / 冲出麻袋 / 讨论 / 工资 / 工钱
 * ============================================================ */

/** 醒来判定：概率随时间递增（主人：时间越久概率越大） */
function wakeRate(minutesIn) {
  return Math.min(0.85, 0.04 + minutesIn / 90);
}

/** 某个麻袋里的人醒来 */
function wakeUp(world, bag) {
  const p = world.player;
  const lines = [];
  bag.state = 'struggling';
  const per = personality.personaIdOf(bag);
  const r = WAKE_REACTIONS[per] || WAKE_REACTIONS.mune;
  const minutesIn = world.clockMinutes - (bag.putAt || world.clockMinutes);

  lines.push({ kind: 'warn', text: `【麻袋里有动静】你肩上的麻袋猛地一挣——${bag.name}醒了！` });
  lines.push({ kind: 'story', text: `　${r.text}` });
  lines.push({ kind: 'hint', text: `　（他在袋里已经 ${Math.floor(minutesIn / 60)} 个时辰，重伤未愈，武艺 ${bag.power}，你 ${martialPower(p)}。）` });

  /* 冲出麻袋：武艺高于玩家才有概率 */
  const myPower = martialPower(p);
  if (bag.power > myPower) {
    const gap = (bag.power - myPower) / Math.max(1, myPower);
    const rate = 0.25 + gap * 0.15;
    if (world.rng.chance(Math.min(0.9, rate))) {
      lines.push({ kind: 'story', text: `麻袋「哗」地撕开了！${bag.name}浑身是血地跳出来，抄起地上的石头就砸！` });
      bag.state = 'burst';
      const npc = reviveFromSnapshot(world, bag, p.room);
      if (npc) {
        npc.hostile = true;
        npc.favor = -100;
        npc.vars = npc.vars || {};
        npc.vars.swearRevenge = p.name;
        npc.hp = Math.max(1, Math.round((npc.maxHp || 10) * BURST_RATIO));
        /* 誓要杀你 */
        world.startCombat(p, npc);
        lines.push({ kind: 'warn', text: `${npc.name}嘶声道：「今日之仇，我记下了！」——他是要你的命！` });
        return { ok: true, burst: true, lines, npc };
      }
    }
  }
  /* 没冲出来：老实待着 */
  if (world.rng.chance(0.2)) {
    lines.push({ kind: 'hint', text: '　（他没力气冲破麻袋，只是在里头不停地挣。你得快点处理。）' });
  }
  return { ok: true, burst: false, lines };
}

/**
 * 推进时间时的一次性结算（挂在 world.advanceTime 上）。
 * 做的事：麻袋醒来、盖房溜号、护院欠薪、奴隶工钱结算。
 */
function onTimeTick(world, minutes) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { lines: [] };
  const lines = [];

  /* ---- ① 麻袋里的人醒来 ---- */
  for (const b of k.bags) {
    if (b.state !== 'out') continue;
    const mins = world.clockMinutes - (b.putAt || world.clockMinutes);
    if (world.rng.chance(wakeRate(mins))) {
      const r = wakeUp(world, b);
      for (const l of r.lines) lines.push(l);
    }
  }

  /* ---- ② 扛着麻袋进新房间：议论纷纷甚至报官 ---- */
  if (k.bags.length) {
    const room = world.getRoom(p.room);
    const wit = witnesses(world, p.room);
    if (wit.length) {
      /* 麻袋里有人在喊（醒来过 → shout 强度高） */
      const shouting = k.bags.find(b => b.state === 'struggling' || b.state === 'burst');
      const per = shouting ? (WAKE_REACTIONS[shouting.personality] || WAKE_REACTIONS.mune) : null;
      const quiet = roomIsQuiet(world, p.room);
      if (per && !quiet && world.rng.chance(per.shout * 0.5)) {
        lines.push({ kind: 'warn', text: '【麻袋里喊起来了】' + per.text.replace(/^你/, '他') });
      }
      let reported = 0;
      for (const n of wit) {
        const r = WITNESS_REACTIONS[personality.personaIdOf(n)] || WITNESS_REACTIONS.mune;
        lines.push({ kind: 'sys', text: `　${n.name}${r.text}` });
        if (r.report && world.rng.chance(r.chance)) reported++;
      }
      if (reported) {
        const add = reported >= 3 ? 3 : (reported === 2 ? 2 : 1);
        k.wanted += add;
        p.wanted = (p.wanted || 0) + add;
        p.karma = (p.karma || 0) - add;
        lines.push({ kind: 'warn', text: `【又是 ${reported} 人报官】恶名 +${add}（${wantedTier(k.wanted).name}）` });
      } else {
        k.reports += 1;
      }
    }
  }

  /* ---- ③ 护院欠薪结算（跨天才算） ---- */
  lines.push(...settleWages(world, minutes));

  /* ---- ④ 奴隶工钱结算 ---- */
  lines.push(...settleTasks(world, minutes));

  /* ---- ⑤ 护院盯着的时候，奴隶不敢跑 ---- */
  lines.push(...checkEscape(world, minutes));

  /* ---- ⑥ 地牢：人不在家时，恨你的犯人会撬锁 ---- */
  lines.push(...checkCaptiveEscape(world, minutes));

  return { lines };
}

/* ============================================================
 * 六、护院：雇、发工钱、监督
 * ============================================================ */

/** 雇护院（只能在自家宅院雇） */
function hireGuard(world, kw) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const lines = [];

  const inHome = !!(p.homes && p.homes.length && p.homes.some(h => h.id === p.room));
  if (!inHome) {
    return { ok: false, lines: [{ kind: 'warn', text: '护院是看家的，得回自家宅院才能雇。' }] };
  }
  const q = quotas(world);
  if (q.usedGuards >= q.guards) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `你这点家底养不起更多护院了（${q.tier.name}最多 ${q.guards} 名，已有 ${q.usedGuards} 名）。` },
        { kind: 'hint', text: '　（唐制按身份给限额：王公之家不得过二十人。你要更多，得先置产业。）' },
      ],
    };
  }

  /* 候选：在自家宅院里的 NPC，或房里的能打之人 */
  const candidates = world.npcsIn(p.room).filter(n => !n.dead && !n.hostile);
  if (!candidates.length) {
    return { ok: false, lines: [{ kind: 'warn', text: '宅院里没人。得有人肯应这差事。' }] };
  }
  const pick = kw ? candidates.find(n => (n.name || '').includes(kw)) : candidates[0];
  if (!pick) return { ok: false, lines: [{ kind: 'warn', text: `这里没有叫「${kw}」的人肯做护院。` }] };

  const power = martialPower(pick);
  const price = 200 + power * 60;
  if (p.money < price) {
    return { ok: false, lines: [{ kind: 'warn', text: `请他做护院要 ${price} 文（他一身本事，价钱贵些），你身上只有 ${p.money} 文。` }] };
  }
  p.money -= price;
  const wage = 30 + power * 12;
  k.guards.push({
    uid: 'gd_' + Math.floor(world.rng.next() * 1000000),
    npcId: pick.id, defId: pick.defId, name: pick.name,
    hiredAt: world.clockMinutes, wage, power,
    loyalty: 60, watching: null,
  });
  pick.vars = pick.vars || {};
  pick.vars.isGuard = true;
  pick.favor = clamp((pick.favor || 0) + 25, -200, 200);
  lines.push({ kind: 'story', text: `${pick.name}卷起袖子：「既如此，我替你看家。」` });
  lines.push({ kind: 'sys', text: `　（${pick.name}　武力 ${power}，日薪 ${wage} 文。工钱按日结，钱不够先欠着；欠多了，人自己会走。）` });
  return { ok: true, lines, guard: pick };
}

/** 每日工资结算（跨天时触发） */
function settleWages(world, minutes) {
  const p = world.player;
  const k = data(world);
  if (!p || !k || !k.guards.length) return [];
  const lines = [];
  const day = Math.floor(world.clockMinutes / 1440);
  if (k._wageDay === undefined) { k._wageDay = day; return []; }
  if (day <= k._wageDay) return [];
  k._wageDay = day;

  const total = k.guards.reduce((s, g) => s + (g.wage || 0), 0) + (k.wageDue || 0);
  if (p.money >= total) {
    p.money -= total;
    k.wageDue = 0;
    for (const g of k.guards) g.loyalty = clamp((g.loyalty || 60) + 2, 0, 100);
    lines.push({ kind: 'sys', text: `【工钱】付了护院工钱 ${total} 文，众人安分。` });
  } else {
    k.wageDue = (k.wageDue || 0) + total;
    for (const g of k.guards) g.loyalty = clamp((g.loyalty || 60) - 8, 0, 100);
    lines.push({ kind: 'warn', text: `【欠薪】你的钱不够 ${total} 文工钱，护院们脸色不好看（欠薪 ${k.wageDue} 文）。` });
    /* 欠薪 3 天或忠诚见底 → 走人 */
    const gone = [];
    for (let i = k.guards.length - 1; i >= 0; i--) {
      const g = k.guards[i];
      if ((g.loyalty || 60) <= 20 || k.wageDue >= total * 3) {
        gone.push(g.name);
        k.guards.splice(i, 1);
      }
    }
    if (gone.length) {
      lines.push({ kind: 'warn', text: `${gone.join('、')}撂挑子走了：「这买卖，爷们不做了！」` });
    }
  }
  return lines;
}

/** 玩家主动发工钱（一次结清，含欠薪） */
function payWages(world) {
  const p = world.player;
  const k = data(world);
  if (!k || !k.guards.length) return { ok: false, lines: [{ kind: 'plain', text: '你没有雇护院。' }] };
  const total = k.guards.reduce((s, g) => s + (g.wage || 0), 0) * 3 + (k.wageDue || 0);
  if (p.money < total) {
    return { ok: false, lines: [{ kind: 'warn', text: `结清要 ${total} 文（三个工钱加欠薪），你只有 ${p.money} 文。` }] };
  }
  p.money -= total;
  k.wageDue = 0;
  for (const g of k.guards) g.loyalty = clamp((g.loyalty || 60) + 12, 0, 100);
  return { ok: true, lines: [{ kind: 'sys', text: `你爽快地结了 ${total} 文工钱。护院们脸色都好看多了。` }] };
}

/** 派护院去盯着某个奴隶 */
function supervise(world, kw) {
  const p = world.player;
  const k = data(world);
  if (!k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  if (!k.slaves.length) return { ok: false, lines: [{ kind: 'plain', text: '你名下没人。' }] };

  const slave = kw ? k.slaves.find(s => (s.name || '').includes(kw)) : k.slaves[0];
  if (!slave) return { ok: false, lines: [{ kind: 'warn', text: `名下没有叫「${kw}」的人。` }] };

  /* 服从/好感 >80 时本来就不用盯（主人规则） */
  if (slave.obedience > 80 || slave.favor > 80) {
    return {
      ok: false,
      lines: [{ kind: 'plain', text: `${slave.name}如今驯得服服帖帖（服从 ${slave.obedience}），不必盯。` }],
    };
  }

  const free = k.guards.find(g => !g.watching);
  if (!free) {
    /* 主人规则：没护院就额外付钱托人监督，武力越强越贵 */
    const need = 60 + (slave.power || 0) * 8;
    if (p.money < need) {
      return {
        ok: false,
        lines: [{ kind: 'warn', text: `你没有空闲护院，托人盯梢要 ${need} 文，你只有 ${p.money} 文。` }],
      };
    }
    p.money -= need;
    free.watching = slave.uid;
    slave.watched = 'hired';
    slave.hiredWatchPrice = need;
    return {
      ok: true,
      lines: [{ kind: 'sys', text: `你花 ${need} 文托了个江湖人盯着${slave.name}。托来的未必靠得住——他可不会拼命。` }],
    };
  }

  free.watching = slave.uid;
  slave.watched = free.uid;
  /* 武力不够就盯不住 */
  if (free.power < (slave.power || 0)) {
    free.hp = Math.max(1, Math.round((free.hp || 1) * 0.6));
    slave.watched = null;
    free.watching = null;
    return {
      ok: true,
      lines: [
        { kind: 'warn', text: `${free.name}盯上了${slave.name}——但他打不过，挨了一顿，摔了个跟头。` },
        { kind: 'hint', text: '　（武力不够的监督不算数，奴隶该跑还是跑。）' },
      ],
    };
  }
  return { ok: true, lines: [{ kind: 'sys', text: `${free.name}应了一声，去盯着${slave.name}了。` }] };
}

/* ============================================================
 * 七、奴役：买卖 / 派活 / 跟随 / 逃跑
 * ============================================================ */

/** 地下场所买奴 */
function buySlave(world, kw) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  if (!inBlackMarket(world)) {
    return { ok: false, lines: [{ kind: 'warn', text: '这种买卖只有黑市、牙行里才有。' }] };
  }
  const q = quotas(world);

  /* ---- 货从哪儿来？----
   * ❌ 不能拿房间里站着的人当货 —— 那等于在黑市里花 25 文买走守门的山贼。
   * ✅ 货是**已经被卖进黑市的活人**（world.soldSlaves 名册），也就是
   *    别的玩家/NPC 掳来卖掉的那些人。你买走一个，名册少一个。
   * 名册空了 → 「今日无人待售」，黑市不做凭空造人生意（血泪：不许凭空造人）。 */
  world.soldSlaves = world.soldSlaves || [];
  const stock = world.soldSlaves.filter(s => s && s.name && s.defId);
  if (!stock.length) {
    return { ok: false, lines: [{ kind: 'plain', text: '今日无人待售。牙行的婆子说，过两日再来。' }] };
  }
  const target = kw ? stock.find(s => (s.name || '').includes(kw)) : stock[0];
  if (!target) {
    return {
      ok: false,
      lines: [
        { kind: 'hint', text: '今日待售：' + stock.map(s => `${s.name}（${slavePrice(snapshotAsNpc(world, s))} 文）`).join('、') },
        { kind: 'warn', text: `这里没有叫「${kw}」的人。` },
      ],
    };
  }
  const fake = snapshotAsNpc(world, target);
  const price = slavePrice(fake);
  /* 名额（唐制按身份给限额）：先看货、看价，最后才卡名额 —— 顺序照牙行的规矩 */
  if (q.usedSlaves >= q.slaves) {
    return {
      ok: false,
      lines: [
        { kind: 'sys', text: `牙行的人把${target.name}领出来让你看——开价 ${price} 文。` },
        { kind: 'warn', text: `　可你家产养不起这么多人（${q.tier.name}上限 ${q.slaves} 名，已有 ${q.usedSlaves} 名）。` },
        { kind: 'hint', text: '　（律制按身份限额。王公之家不得过二十人。你得先置办宅院、开辟地块、存下钱。）' },
      ],
    };
  }
  if (p.money < price) {
    return { ok: false, lines: [{ kind: 'warn', text: `买${target.name}要 ${price} 文，你身上只有 ${p.money} 文。` }] };
  }
  p.money -= price;
  const snap = snapshot(fake, {
    uid: 'sl_' + Math.floor(world.rng.next() * 1000000),
    boughtAt: world.clockMinutes, buyPrice: price,
    obedience: 50, favor: 20, task: null, fatigue: 0, escaped: false,
  });
  /* 保留原来那条的卖价与来源，买来的人知道自己是被卖过的 */
  if (target.soldFor) snap.soldFor = target.soldFor;
  if (target.soldBy) snap.soldBy = target.soldBy;
  k.slaves.push(snap);
  world.soldSlaves.splice(world.soldSlaves.indexOf(target), 1);
  /* 买奴知情，与略卖同罪（清律）——但有牙行掩护，只在「转卖」时才加重 */
  p.karma = (p.karma || 0) - 1;
  return {
    ok: true,
    lines: [
      { kind: 'story', text: `牙行的牙婆把${target.name}推到跟前：「${price} 文，概不赊账。」你数了钱，成交。` },
      { kind: 'sys', text: `　（${target.name}　服从 50　好感 20——买来的不认人，得慢慢调教。有护院盯着才不敢跑。）` },
    ],
  };
}

/** 卖人：麻袋里或名下奴隶，卖进青楼/地下场所 */
function sellNpc(world, kw) {
  const p = world.player;
  const k = data(world);
  if (!p || !k) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const lines = [];

  /* 优先找麻袋里的 */
  let fromBag = false;
  let fromJail = false;
  let rec = null;
  if (k.bags.length) {
    const i = kw ? k.bags.findIndex(b => (b.name || '').includes(kw)) : 0;
    if (i >= 0) { rec = k.bags[i]; fromBag = true; }
  }
  if (!rec && k.slaves.length) {
    rec = kw ? k.slaves.find(s => (s.name || '').includes(kw)) : k.slaves[0];
  }
  /* 地牢里的也能卖（关着也是资产：卖到黑市/青楼一样出手） */
  if (!rec && captives(world).length) {
    const j = kw ? captives(world).find(s => (s.name || '').includes(kw)) : captives(world)[0];
    if (j) { rec = j; fromJail = true; }
  }
  if (!rec) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: '你没有可卖的人。' },
        { kind: 'hint', text: '　（能卖的是：麻袋里装着的、名下买来的奴、或地牢里关着的。）' },
      ],
    };
  }

  /* 去处：青楼还是黑市 */
  const to = inBrothel(world) ? 'brothel' : 'blackmarket';
  const price = sellPrice(rec);
  const keeper = to === 'brothel'
    ? (rec.gender === 'male' ? '清倌馆的老鸨' : '青楼的鸨母')
    : '黑市里那个独眼男人';

  /* 名册留档（青楼/黑市的名册，之后可赎）
   * ⚠️ 必须是**数组**，不能按 defId 建对象 —— 天下长得一样的人多了去了，
   *   按模板 id 存会把三个同名的人压成一条，买奴时就只剩一个。
   *   每条自带 uid，赎回/买入时按 uid 取。 */
  world.soldSlaves = Array.isArray(world.soldSlaves) ? world.soldSlaves : [];
  world.soldSlaves.push({
    uid: rec.uid || ('sold_' + Math.floor(world.rng.next() * 1000000)),
    defId: rec.defId,
    name: rec.name, soldAt: world.clockMinutes, price, to, keeper,
    by: p.name, level: rec.level || 1,
    tag: rec.tag || (rec.def && rec.def.tag) || null,
    personality: rec.personality || null,
  });

  /* 摘掉 */
  if (fromBag) k.bags.splice(k.bags.indexOf(rec), 1);
  else if (fromJail) { const jl = captives(world); jl.splice(jl.indexOf(rec), 1); }
  else k.slaves.splice(k.slaves.indexOf(rec), 1);

  p.money += price;
  /* 知情转卖 = 从重（大明律「知情者与犯人同罪」） */
  const isResale = !fromBag;
  const add = isResale ? 3 : 1;
  k.wanted += add;
  p.wanted = (p.wanted || 0) + add;
  p.karma = (p.karma || 0) - 3;
  if (p.reputation) {
    p.reputation['恶名'] = (p.reputation['恶名'] || 0) + add;
    p.reputation['侠义'] = (p.reputation['侠义'] || 0) - add;
  }

  lines.push({ kind: 'story', text: `${keeper}把你的${rec.name}上下打量了一番，出了 ${price} 文。钱货两清。` });
  lines.push({ kind: 'sys', text: `　（${rec.name}自此不属于你了。名册记在${to === 'brothel' ? '青楼' : '黑市'}，日后有钱可赎。）` });
  if (isResale) {
    lines.push({ kind: 'warn', text: '　【知情转卖】大清律：知情买者与犯人同罪。你这是自买卖人口，恶名 +3。' });
  }
  lines.push({ kind: 'warn', text: `　恶名 +${add}（${wantedTier(k.wanted).name}）` });
  return { ok: true, lines };
}

/** 青楼赎人：可以是 NPC，也可以是自己 */
/** 青楼赎人：把名册上的人赎出来放回房间 */
function redeemPerson(world, kw) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const lines = [];

  if (!inBrothel(world) && !inBlackMarket(world)) {
    return { ok: false, lines: [{ kind: 'warn', text: '赎身要去青楼或黑市。' }] };
  }

  /* 名册是数组（见 sellNpc 里的注释），这里统一兜成数组再操作 */
  const roster = Array.isArray(world.soldSlaves) ? world.soldSlaves : [];
  if (!roster.length) {
    return { ok: false, lines: [{ kind: 'plain', text: '这里没什么人可赎。（名册是空的。）' }] };
  }
  if (!kw) {
    lines.push({ kind: 'title', text: '【 名 册 】' });
    for (const s of roster) {
      lines.push({ kind: 'plain', text: `　${s.name}　（${s.to === 'brothel' ? '青楼' : '黑市'}　赎金 ${s.price * 2} 文）`, npcName: s.name });
    }
    lines.push({ kind: 'hint', text: '「赎回 <人名>」把人赎出来。' });
    return { ok: true, lines };
  }
  const i = roster.findIndex(s => (s.name || '').includes(kw) || kw.includes(s.name || ''));
  if (i < 0) return { ok: false, lines: [{ kind: 'warn', text: '名册上没有这个人。' }] };
  const s = roster[i];
  /* 赎回来价格翻倍（人海茫茫，符合世界观） */
  const price = Math.round(s.price * 2);
  if (p.money < price) {
    return { ok: false, lines: [{ kind: 'warn', text: `赎${s.name}要 ${price} 文（比当初的买价翻倍——人海茫茫，找回来不易），你只有 ${p.money} 文。` }] };
  }
  p.money -= price;
  roster.splice(i, 1);
  const npc = reviveFromSnapshot(world, {
    defId: s.defId, name: s.name, tag: s.tag, personality: s.personality, level: s.level,
  }, p.room);
  if (npc) {
    npc.favor = clamp((npc.favor || 0) + 60, -200, 200);
    lines.push({ kind: 'story', text: `你交了 ${price} 文，从${s.keeper}手里把${s.name}赎了出来。` });
    lines.push({ kind: 'sys', text: '　（重获自由，你对他有救命之恩，好感大增。）' });
  } else {
    lines.push({ kind: 'warn', text: `你交了 ${price} 文，人却没能带出来——赎了个空。名册上${s.name}的底档已经不可考了。` });
  }
  return { ok: true, lines };
}

/** 派活 */
function assignTask(world, kw, taskKey) {
  const p = world.player;
  const k = data(world);
  if (!k || !k.slaves.length) return { ok: false, lines: [{ kind: 'plain', text: '你名下没人。' }] };
  const lines = [];
  const slave = kw ? k.slaves.find(s => (s.name || '').includes(kw)) : k.slaves[0];
  if (!slave) return { ok: false, lines: [{ kind: 'warn', text: `名下没有叫「${kw}」的人。` }] };
  if (slave.escaped) return { ok: false, lines: [{ kind: 'warn', text: `${slave.name}已经跑了。` }] };
  if (slave.task) return { ok: false, lines: [{ kind: 'plain', text: `${slave.name}手上${TASKS[slave.task.key] ? TASKS[slave.task.key].name : slave.task.key}的活还没干完。` }] };

  const t = TASKS[taskKey];
  if (!t) {
    return {
      ok: false,
      lines: [
        { kind: 'hint', text: '可派的活：' + Object.keys(TASKS).map(x => TASKS[x].name + '（' + x + '）').join('、') },
        { kind: 'warn', text: '　用法：使唤 <人名> <做工|采买|跑腿|洗衣>' },
      ],
    };
  }

  /* 夜间大扣：作息异禀的人免疫（主人规则） */
  const m = world.clockMinutes % 1440;
  const isNight = m >= NIGHT_FROM || m < NIGHT_TO;
  const nightPenalty = isNight && !isNightOwl(snapshotAsNpc(world, slave));

  const earn = world.rng.int(t.earn[0], t.earn[1]);
  slave.task = {
    key: t.key, name: t.name, at: world.clockMinutes,
    until: world.clockMinutes + t.dur, earning: earn,
  };
  lines.push({ kind: 'sys', text: `你吩咐${slave.name}去${t.name}：「${t.desc}」` });
  lines.push({ kind: 'hint', text: `　（大约 ${Math.round(t.dur / 60)} 个时辰的活，挣 ${earn} 文。）` });
  if (nightPenalty) {
    slave.obedience = clamp((slave.obedience || 60) - 12, 0, 100);
    lines.push({ kind: 'warn', text: '　（这大半夜的，奴才心里不情不愿——服从度 −12。有夜猫子禀性的人倒无妨。）' });
  }
  if (slave.obedience < 50 && !slave.watched) {
    lines.push({ kind: 'hint', text: '　（这人不算服气。没人盯着的话，怕是要出事。）' });
  }
  return { ok: true, lines };
}

/** 把快照临时包装成能读 isNightOwl 的形状 */
function snapshotAsNpc(world, snap) {
  const def = world.data.npcs[snap.defId] || {};
  return { def, tag: snap.tag || def.tag, name: snap.name, personality: snap.personality };
}

/** 工钱结算：干完工 → 钱给玩家 → 奴隶回家园/客栈等 */
function settleTasks(world, minutes) {
  const p = world.player;
  const k = data(world);
  if (!k || !k.slaves.length) return [];
  const lines = [];
  for (const s of k.slaves) {
    if (!s.task || s.escaped) continue;
    if (world.clockMinutes < s.task.until) continue;

    /* 收工：钱直接进玩家口袋（主人指定「给玩家赚钱」） */
    const earn = s.task.earning || 0;
    const taskName = s.task.name || '活';
    p.money += earn;
    s.obedience = clamp((s.obedience || 60) + 2, 0, 100);
    s.fatigue = clamp((s.fatigue || 0) + 30, 0, 100);
    s.task = null;

    /* 干完工回到玩家家园等待；没家园就去最近客栈 */
    const roomId = waitingRoom(world);
    const rn = world.getRoom(roomId);
    s.waitingAt = world.clockMinutes;
    s.waitingRoom = roomId;

    lines.push({ kind: 'sys', text: `【${s.name}收工】${taskName}做完了，工钱 ${earn} 文送到你手上。` });
    lines.push({
      kind: 'hint',
      text: rn
        ? `　他此刻在「${rn.name}」等你回来（服从 ${s.obedience}）。`
        : '　他还在外头忙活，你得回客栈才能见着人。',
    });
  }
  return lines;
}

/** 逃跑 / 反抗判定 */
function checkEscape(world, minutes) {
  const p = world.player;
  const k = data(world);
  if (!k || !k.slaves.length) return [];
  const lines = [];
  for (const s of k.slaves) {
    if (s.escaped) continue;
    /* 主人在场时不敢动 */
    const playerHere = p.room === (s.waitingRoom || p.room);
    const free = (s.obedience || 0) > 80 || (s.favor || 0) > 80;
    const supervised = !!s.watched;

    /* 没人盯 + 不服 → 极大概率跑 */
    let escapeRate = free ? 0.02 : 0.30;
    let fightRate = free ? 0.01 : 0.10;
    if (supervised) { escapeRate = free ? 0.005 : 0.02; fightRate = free ? 0.005 : 0.02; }
    if (playerHere) { escapeRate *= 0.25; fightRate *= 0.3; }

    if (!world.rng.chance(escapeRate / 30)) continue;

    if (world.rng.chance(fightRate / Math.max(0.001, escapeRate))) {
      /* 反抗：触发战斗 */
      const npc = reviveFromSnapshot(world, s, p.room);
      if (npc) {
        npc.hostile = true;
        s.escaped = true;
        delete world.instances.npcs[npc.id];
        world.startCombat(p, npc);
        lines.push({ kind: 'warn', text: `【反抗】${s.name}忽然暴起，抓起扫帚就打！` });
        return lines;
      }
    }
    /* 逃跑 */
    s.escaped = true;
    const npc = reviveFromSnapshot(world, s, world.nearestEatery(p.room) || p.room);
    if (npc) {
      npc.hostile = false;
      npc.favor = -60;
      npc.vars = npc.vars || {};
      npc.vars.escapedFrom = p.name;
    }
    if (supervised) {
      const g = k.guards.find(x => x.uid === s.watched);
      lines.push({ kind: 'warn', text: `【逃跑未遂】${s.name}要跑，被${g ? g.name : '盯着的人'}堵了回来，挨了一顿好打。` });
      s.escaped = false;
      s.obedience = clamp((s.obedience || 60) - 5, 0, 100);
      if (g) { g.watching = null; g.hp = Math.max(1, Math.round((g.hp || 1) * 0.8)); }
      s.watched = null;
      continue;
    }
    lines.push({ kind: 'warn', text: `【逃跑】${s.name}趁你不备溜了！${s.watched === 'hired' ? '（托人盯着的那位压根没拦）' : ''}` });
  }
  return lines;
}

/* ============================================================
 * 八、跟随邀请（好感 >60，且 NPC 有概率有事离开）
 * ============================================================ */

/** 邀请跟随 */
function inviteFollow(world, kw) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '你还没上路。' }] };
  const cands = world.npcsIn(p.room).filter(n => !n.dead && !n.knockedOut && !n.isPlayer);
  if (!cands.length) return { ok: false, lines: [{ kind: 'plain', text: '这里没人。' }] };
  const npc = kw ? cands.find(n => (n.name || '').includes(kw)) : cands[0];
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: `这里没有叫「${kw}」的人。` }] };
  if (npc.followPlayer) {
    return { ok: false, lines: [{ kind: 'plain', text: `${npc.name}已经跟着你了。` }] };
  }
  if ((npc.favor || 0) <= 60) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `${npc.name}与你还不够熟（好感 ${npc.favor || 0}，需超过 60）。` },
        { kind: 'hint', text: '　（多往来、多送礼、替人办事，情分才养得出来。）' },
      ],
    };
  }
  npc.followPlayer = true;
  npc.vars = npc.vars || {};
  npc.vars.awayUntil = 0;
  npc.vars.awayReason = null;
  npc.favor = clamp((npc.favor || 0) + 3, -200, 200);
  return {
    ok: true,
    lines: [
      { kind: 'story', text: `${npc.name}迟疑了一下，终于点头：「既是恩公相邀，我走一程。」` },
      { kind: 'hint', text: '　（他会跟着你，但他也有自己的事要办——说不定什么时候就自个儿走开了。）' },
    ],
  };
}

/** 跟随 NPC 的「有事离开」判定（每次 time tick 调用） */
function tickFollowers(world, minutes) {
  const p = world.player;
  if (!p) return [];
  const lines = [];
  const followers = Object.values(world.instances.npcs).filter(n => n.followPlayer && !n.dead);
  for (const n of followers) {
    n.vars = n.vars || {};
    /* 正在外面办事 */
    if (n.vars.awayUntil && world.clockMinutes < n.vars.awayUntil) continue;
    if (n.vars.awayUntil) {
      /* 回来了 */
      n.vars.awayUntil = 0;
      n.vars.awayReason = null;
      if (n.room !== p.room) n.room = p.room;
      lines.push({ kind: 'sys', text: `${n.name}办完事回来了。` });
      continue;
    }
    /* 1% 概率「有事」 */
    if (!world.rng.chance(0.01 / 30 * minutes)) continue;

    const def = n.def || {};
    const m = world.clockMinutes % 1440;
    let awayUntil = 0, reason = '';
    if (m >= 1080 || m < 300) {
      reason = '回家睡觉';
      if (def.home) { n.room = def.home; awayUntil = world.clockMinutes + 360; }
      else { const eat = world.nearestEatery(n.room); if (eat) { n.room = eat; awayUntil = world.clockMinutes + 180; } else continue; }
    } else if (m >= 780 && m < 840) {
      reason = '去吃饭';
      const eat = world.nearestEatery(n.room);
      if (eat) { n.room = eat; awayUntil = world.clockMinutes + 60; } else continue;
    } else {
      reason = '去办事';
      const dirs = Object.keys((world.getRoom(n.room) || {}).exits || {});
      if (!dirs.length) continue;
      const d = world.rng.pick(dirs);
      const ex = (world.getRoom(n.room) || {}).exits[d];
      const tid = typeof ex === 'string' ? ex : ex && ex.to;
      if (!tid || !world.getRoom(tid)) continue;
      n.room = tid;
      awayUntil = world.clockMinutes + world.rng.int(120, 200);
    }
    n.vars.awayUntil = awayUntil;
    n.vars.awayReason = reason;
    lines.push({ kind: 'hint', text: `${n.name}说声「${reason}」，就先走一步。` });
  }
  return lines;
}

/* ============================================================
 * 九、NPC 反向掳人（主人第二、三轮）
 *
 *  · 亡命之徒（恶性高/贪财/非善）有概率自己动手掳人
 *  · 山贼这类 hostile 会主动打晕路人装袋去卖
 *  · 也会掳走晕倒的玩家
 * ============================================================ */

/** 把某人装进「山贼的麻袋」（世界层面，与玩家数据无关） */
function npcPack(world, npc, byNpc, target) {
  const bagRoom = byNpc.room;
  world.soldSlaves = world.soldSlaves || {};
  const price = sellPrice(target);
  const to = world.rng.chance(0.5) ? 'brothel' : 'blackmarket';
  world.soldSlaves[target.defId] = {
    name: target.name, soldAt: world.clockMinutes, price,
    to, keeper: to === 'brothel' ? '青楼鸨母' : '黑市独眼人',
    by: byNpc.name, level: target.level || 1, stolen: true,
  };
  delete world.instances.npcs[target.id];
  return { price, to, room: bagRoom };
}

/** 亡命之徒掳人判定（worldTick 每次调一次） */
function tickDesperate(world) {
  const p = world.player;
  if (!p) return [];
  const lines = [];
  const room = world.npcsIn(p.room);
  if (!room.length) return lines;

  for (const n of room) {
    if (n.dead || n.knockedOut) continue;
    if (!isDesperate(n)) continue;
    const wicked = wickednessOf(n);
    /* 夜里更敢干 */
    const night = world.isNight();
    const rate = ((wicked - 50) / 300) * (night ? 0.15 : 0.05);
    if (rate <= 0) continue;
    if (!world.rng.chance(rate)) continue;

    /* 目标优先级：晕倒的 NPC > 其他 NPC > 玩家 */
    const downed = room.filter(x => x.id !== n.id && x.knockedOut);
    const others = room.filter(x => x.id !== n.id && !x.dead && !x.knockedOut && !x.isPlayer);

    let target = downed[0];
    if (!target && world.rng.chance(0.35)) target = others[0];
    /* 玩家单挑在屋里时才掳玩家（主人：「npc 会掳走晕倒的玩家」） */
    if (!target && !p.knockedOut && world.rng.chance(0.5)) target = p;
    if (!target) continue;

    /* 玩家被掳（主人：「npc 会掳走晕倒的玩家」） */
    if (target === p) {
      if (!p.knockedOut && !world.rng.chance(0.5)) continue;
      lines.push({ kind: 'warn', text: `【遭劫】${n.name}朝你扑了过来！` });
      if (world.rng.chance(0.6)) {
        /* 被卖进黑市（见 playerCaptured） */
        const r = playerCaptured(world, n);
        for (const l of r.lines) lines.push(l);
      } else {
        /* 搜刮放走 */
        const loot = Math.floor((p.money || 0) * 0.3);
        p.money -= loot;
        lines.push({ kind: 'story', text: `${n.name}把你搜了个遍，捞走 ${loot} 文，扬长而去。你醒来时身在原地。` });
      }
      break;
    }

    /* NPC 被掳 */
    const r = npcPack(world, target, n, target);
    lines.push({ kind: 'warn', text: `【掳人】${n.name}把${target.name}套进麻袋，扛起来就走，转眼没了人影。` });
    lines.push({ kind: 'hint', text: '　（这种人在江湖上专干这个，没人来管。你要是本事够，可以去地下场所赎人。）' });
    break;
  }
  return lines;
}

/**
 * 玩家被掳进黑市（主人钦定通路）：
 *   ① 掏钱赎回  ② 打工还债  ③ 武力突围（打过黑市高薪聘请的武者）  ④ 死
 */
function playerCaptured(world, byNpc) {
  const p = world.player;
  /* ⚠️ 先定去哪个黑市，再挪房间 —— 顺序反了会把玩家扔进另一个黑市，
   *    debt.market 和实际所在房间对不上，突围时拿错 guardPower。
   *  规矩：**你被抓进哪个黑市，就关在哪个黑市**，不挑贵的。 */
  const bm = blackMarketAt(world);
  const room = (bm.room && world.getRoom(bm.room)) ? bm.room
    : (nearestBlackRoom(world) || p.room);
  const ransom = bm.ransom + (p.level || 1) * 200;
  p.room = room;
  p.knockedOut = false;
  p.dead = false;
  p.kidnap = p.kidnap || { bags: [], slaves: [], guards: [], wageDue: 0, wanted: 0, reports: 0, debt: null };
  p.kidnap.debt = {
    market: bm.id, by: byNpc ? byNpc.name : '不明之人',
    at: world.clockMinutes, ransom, days: 0, paidOff: 0,
  };
  p.hp = Math.max(1, Math.round((p.maxHp || 20) * 0.5));
  const lines = [
    { kind: 'warn', text: `你在黑市的地窖里睁开眼——手脚被缚，嘴里塞着破布。` },
    { kind: 'story', text: `（${bm.name}。${bm.desc}）` },
    { kind: 'sys', text: `　赎身价：${ransom} 文。你身上有 ${p.money} 文。` },
    { kind: 'hint', text: '　出路：「赎身」掏钱走人／「打工」还债（5 天）／「突围」硬打出去（要打得过镇场武者）。' },
  ];
  return { ok: true, lines, ransom, market: bm, room };
}

/** 赎回自己（黑市） */
function redeemSelf(world) {
  const p = world.player;
  const k = data(world);
  const debt = k && k.debt;
  if (!debt) return { ok: false, lines: [{ kind: 'plain', text: '你不是被掳来的。' }] };
  if (p.money < debt.ransom) {
    return { ok: false, lines: [{ kind: 'warn', text: `赎你要 ${debt.ransom} 文，你只有 ${p.money} 文。去「打工」还债吧。` }] };
  }
  p.money -= debt.ransom;
  const lines = [{ kind: 'story', text: `你把 ${debt.ransom} 文拍在柜上，那人冷笑着解开绳索：「滚吧。」` }];
  k.debt = null;
  /* 黑市是法外之地，官府睁只眼闭只眼 */
  k.wanted = Math.max(0, k.wanted - 1);
  return { ok: true, lines };
}

/** 为黑市打工还债（每天工钱抵债，5 天还清——照现实打工人作息，只能按天算）
 *  @returns {{ok, lines}} —— ok=false 表示今天抵不了（没跨天 / 没债），
 *          调用方据此决定要不要退回普通打工 */
function workOffDebt(world, minutes) {
  const p = world.player;
  const k = data(world);
  const debt = k && k.debt;
  if (!debt) return { ok: false, lines: [{ kind: 'plain', text: '你不欠债。' }] };
  const lines = [];
  const day = Math.floor(world.clockMinutes / 1440);
  /* 刚被掳的那天不算工钱（人还在地窖里，第一天是「关着」） */
  if (debt.lastDay === undefined) { debt.lastDay = day; return { ok: false, lines }; }
  if (day <= debt.lastDay) return { ok: false, lines };
  debt.lastDay = day;
  debt.days += 1;
  /* 一天的工钱抵债 */
  const pay = Math.min(debt.ransom - debt.paidOff, 300);
  debt.paidOff += pay;
  lines.push({ kind: 'sys', text: `【黑市杂役】你搬了一天货，抵债 ${pay} 文（还差 ${debt.ransom - debt.paidOff} 文，第 ${debt.days}/5 天）。` });
  if (debt.paidOff >= debt.ransom) {
    k.debt = null;
    lines.push({ kind: 'story', text: '债还清了。那人把门一开：「走罢。」' });
  }
  return { ok: true, lines, paid: pay, cleared: !k.debt };
}

/** 武力突围（主人第三条：能打过黑市高薪聘请的武者就能打出去） */
function escapeMarket(world) {
  const p = world.player;
  const k = data(world);
  const debt = k && k.debt;
  if (!debt) return { ok: false, lines: [{ kind: 'plain', text: '你没被关在这儿。' }] };
  const bm = BLACK_MARKETS.find(b => b.id === debt.market) || BLACK_MARKETS[1];
  const myPower = martialPower(p);
  const lines = [];
  lines.push({ kind: 'story', text: `你抖开绳索，一脚踹开看守——${bm.guardName}迎了上来。` });
  lines.push({ kind: 'hint', text: `　（你 ${myPower}　对方 ${bm.guardPower}）` });

  if (myPower >= bm.guardPower * 1.2) {
    /* 秒杀 */
    lines.push({ kind: 'warn', text: `你一记重手，${bm.guardName}连哼都没哼出来就倒了。你踹开大门，扬长而去。` });
    k.debt = null;
    k.wanted = Math.max(0, k.wanted - 1);
    p.money += 200 + Math.floor(world.rng.next() * 200);
    return { ok: true, won: true, lines };
  }
  if (myPower >= bm.guardPower) {
    /* 险胜 */
    lines.push({ kind: 'story', text: `恶战数十合，你终是把这镇场武者放倒了。他捂着脸躺在地上，不敢再看。你捞了些碎银走了。` });
    k.debt = null;
    k.wanted = Math.max(0, k.wanted - 1);
    p.money += 200 + Math.floor(world.rng.next() * 200);
    p.hp = Math.max(1, Math.round(p.maxHp * 0.6));
    return { ok: true, won: true, lines };
  }
  /* 打不过 → 死（通路④） */
  lines.push({ kind: 'faint', text: `${bm.guardName}一拳砸在你胸口，你眼前一黑……` });
  p.deathCount = (p.deathCount || 0) + 1;
  debt.ransom = Math.round(debt.ransom * 2);
  debt.paidOff = 0;
  debt.days = 0;
  p.hp = Math.max(1, Math.round(p.maxHp * 0.3));
  lines.push({ kind: 'warn', text: `　（你被拖回来，赎身钱翻倍：${debt.ransom} 文。命还在，路难走了。）` });
  return { ok: false, won: false, lines };
}

module.exports = {
  /* 常量 */
  MAX_BAGS, HURT_RATIO, BURST_RATIO, SACK_ID,
  WORK_START, WORK_END, NIGHT_FROM, NIGHT_TO,
  WEALTH_TIERS, WANTED_TIERS, SLAVE_PRICES, TASKS,
  WAKE_REACTIONS, WITNESS_REACTIONS, BLACK_MARKETS,
  /* 工具 */
  data, martialPower, wickednessOf, greedOf, isDesperate, isNightOwl,
  roomIsQuiet, witnesses, interceptor, sellPrice, slavePrice,
  wealthTier, quotas, wantedTier, inBrothel, inBlackMarket,
  blackMarketAt, nearestBlackRoom, waitingRoom,
  snapshot, reviveFromSnapshot,
  /* 流程 */
  packNpc, kidnapAttempt, assess, debuffCount, heftOf,
  listBags, releaseBag, onTimeTick, wakeRate, wakeUp,
  hireGuard, settleWages, payWages, supervise,
  buySlave, sellNpc, redeemPerson, assignTask, settleTasks, checkEscape,
  /* 家园地牢（关押 / 提审 / 陪练 / 放出） */
  dungeonOf, captives, findCaptive, imprison, interrogate, sparWith, freeCaptive, checkCaptiveEscape,
  inviteFollow, tickFollowers,
  /* NPC 反向 */
  npcPack, tickDesperate, playerCaptured, redeemSelf, workOffDebt, escapeMarket,
};