/**
 * npc-skills.js — 「按身份给 NPC 配功法」的身份规则表（B8 主人钦定项）
 *
 * ── 这份文件是干什么的 ────────────────────────────────────────────────
 * 主人原报（bug 第 8 条）：
 *   「为什么几乎所有 npc 都只会基本功法？为什么都只会基本拳脚棍法刀法这些，
 *     都不会内功轻功招架之类的其他功法？」
 * 根因：`40_npcs.json` 里 `npcv_*` 这批程序生成的 NPC，武学槽几乎都停在
 * `basic_fist` / `basic_staff` / `basic_blade` / `basic_sword`（=「基本拳脚/棍法/刀法」），
 * 且绝大多数没有 `内功 / 轻功 / 招架` 三个槽。
 *
 * 本文件定义**身份 → 功法** 的规则表，`gen-npc-skills.js` 依此把功法写回
 * `40_npcs.json`（数据侧落地）。
 *
 * ── 为什么走「数据侧」而不是像 B3 那样运行时注入 ─────────────────────
 * B3（毒蛇专属招式）用的是 `bestiary.js + world.applySpeciesMoves() + pickSkill`
 * 的**运行时注入**，因为它的对象是「规则」（什么物种用什么招），且当时要求
 * `game/data/*.json` 零改动。
 *
 * B8 面对的是 329 个人类 NPC 的**身份配置**——这是内容数据，且：
 *   ① 本批本来就要改 `40_npcs.json`（B17/B18/B19 三条数据错配），一次改完，
 *      不把同一个文件改两遍；
 *   ② 运行时注入必须挂 `world.js` 的加载路径（B3 那三处：loadMods / deserialize），
 *      而 `world.js` 此刻正被另一名工程同事修「读档软锁」缺陷——**不碰共线文件**；
 *   ③ 身份判别靠的是 `tag/sect/tier/id` 这些**模板显式字段**，写回数据后
 *      「谁会什么」在 JSON 里一目了然、可断言、可 review（沿用 `gen-portraits.js`
 *      的「生成器 → 落回 40_npcs.json」既定管线）。
 *
 * 规则表的**结构与 B3 同源**：`TAG_PLANS` / `SECT_PLANS` / `ID_OVERRIDES` 三级，
 * 逐条列 id / 逐条列 tag，**不含任何「拿描述关键词猜」的判据**（B3/BLK-2 的教训）。
 *
 * ── 误判防护（B3 的 BLK-2 教训，逐条落实）────────────────────────────
 * B3 曾经因为「desc 里出现『蛇』字就判成蛇类」，把人类剑客「蓝凤凰」
 * （desc: 手腕上盘着一条碧绿小蛇）误判成蛇。修法是**宁可漏不可误 + 显式声明优先**。
 * B8 把它落成三条硬规矩：
 *   ① **判据只用显式字段**：`id`（具名/守卫，逐条列）、`sect`（门派）、`tag`（身份）。
 *      绝不读 `name` / `desc` / `title` 里的任何词；
 *   ② **只加不夺**：槽里已是**非 basic 的真功夫**就**原样保留**（手写作者的意图优先），
 *      只把 `basic_*` 升成身份对应的功法、或补上缺的支持槽。**任何既有技能/learned 都不删**；
 *   ③ **判不出就不动**（返回 null）：`tag` 认不出的模板（如无 tag 的非 mob 角色）原样放行。
 *
 * ── 目录 ──────────────────────────────────────────────────────────
 *   §1 GENERIC_SKILLS  —— 本次新增的 6 门「江湖通用」功法（要写进 10_skills.json）
 *   §2 级联池          —— 支持槽（内功/轻功/招架）的候选池
 *   §3 TAG_PLANS       —— 身份 tag → 功法 plan
 *   §4 SECT_PLANS      —— 门派 → 功法 plan（优先级高于 tag）
 *   §5 ID_OVERRIDES    —— 具名/守卫逐条（优先级最高）
 *   §6 planForNpc()    —— 三级判别
 *   §7 applyPlan()     —— 落回 def（只加不夺、保证 learned 齐备）
 */
'use strict';

/* ==================================================================
 * §1 本次新增的 6 门「江湖通用」功法
 *
 * 为什么必须新增（不是「另发明一套」，是现有 53 门不够用）：
 *   摊开 `10_skills.json` 会发现，**除了 8 门 basic_*，其余 45 门全是
 *   门派／传奇专属**——`huashan_sword` 是华山的、`taiji_sword` 是武当的、
 *   `dugu_jiujian` 是独孤求败的……**没有一门「无门无派的江湖人也会」的功夫**。
 *   于是非门派武人（游侠剑客／镖师／江湖刀客／护院拳师）**只能退回 basic_***，
 *   这正是主人报的症状本身。
 *   ⇒ 补 6 门「江湖通用」档（外功 5 + 内功 1），**数值刻意贴近 basic_***（只高一点点），
 *     避免抬高 NPC 输出；「内功／轻功／招架」三门则专为补主人点名的三个空槽。
 *   命名走「江湖通用」语域（长拳／江湖剑法／齐眉棍法／卸力招架／轻身术／吐纳功），
 *   与门派招牌区分得开，玩家在战斗日志里一眼能看出「这人使的是江湖路子」。
 * ================================================================== */
const GENERIC_SKILLS = [
  {
    id: 'jh_fist', name: '长拳', type: '拳', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.7, trainCost: 30,
    damageMult: 1.05, accuracy: 84, mpCost: 0, effects: [],
    desc: '大路货的拳架子，起手快、收手稳，市井护院多半会两手。',
  },
  {
    id: 'jh_sword', name: '江湖剑法', type: '剑', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.8, trainCost: 35,
    damageMult: 1.08, accuracy: 86, mpCost: 4, effects: [],
    desc: '无门无派的剑路子，一剑走轻灵，不求招法只为实用。',
  },
  {
    id: 'jh_blade', name: '江湖刀法', type: '刀', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.8, trainCost: 35,
    damageMult: 1.1, accuracy: 84, mpCost: 4, effects: [],
    desc: '走镖、看家、砍柴都使得的厚实刀路，讲究一力降十会。',
  },
  {
    id: 'jh_staff', name: '齐眉棍法', type: '棍', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.75, trainCost: 30,
    damageMult: 1.06, accuracy: 85, mpCost: 0, effects: [],
    desc: '扁担、船桨、齐眉棍都使得，拦、扫、挑三式走遍江湖。',
  },
  {
    id: 'jh_parry', name: '卸力招架', type: '招架', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.7, trainCost: 25,
    damageMult: 0, accuracy: 0, mpCost: 0, effects: [],
    desc: '不硬接只卸力的护身法门，走江湖的人多半懂一点。',
  },
  {
    id: 'jh_dodge', name: '轻身术', type: '轻功', category: '外功', quality: 'common',
    maxLevel: 500, difficulty: 0.7, trainCost: 25,
    damageMult: 0, accuracy: 0, mpCost: 0, effects: [],
    desc: '提气纵跃的粗浅轻功，逃命、越墙、闪避都靠它。',
  },
  {
    id: 'jh_neigong', name: '吐纳功', type: '内功', category: '内功', quality: 'common',
    maxLevel: 500, difficulty: 0.8, trainCost: 40,
    damageMult: 0, accuracy: 0, mpCost: 0, effects: [],
    desc: '调息养气的入门内功，不求克敌只求强身、蓄力、疗伤。',
  },
];

/* ==================================================================
 * §2 支持槽候选池（内功 / 轻功 / 招架）
 *
 * ⚠️ 池内**只放非 basic 的**（jh_* 或门派招牌），避免「补了一个还是基本功法」。
 *    池 ≥2 项时会按 id 哈希挑，做到「同类身份内也不重样」。
 * ================================================================== */
const SUP_NEI = ['jh_neigong'];
const SUP_QING = ['jh_dodge'];
const SUP_ZHAO = ['jh_parry'];

/* 通用简化：把「槽: 池」写成短表 */
const QING = { 轻功: SUP_QING };
const ZHAO = { 招架: SUP_ZHAO };
const NEI = { 内功: SUP_NEI };
const merge = (...objs) => Object.assign({}, ...objs);

/* ==================================================================
 * §3 TAG_PLANS —— 身份 tag → plan
 *
 * plan 形状：
 *   { attack: {系: [候选id…]} | { byType: true },  // 攻击槽
 *     support: { 内功/轻功/招架: [候选…] },         // 支持槽（可缺）
 *     forceSupport: bool }                          // A 层是否也补支持槽（默认否）
 *
 * `attack.byType`：不指定系，只把**现有**的 basic_* 攻击槽按同系升成 jh_*
 *   （民壮保留自己的兵器选择：使棍的还是使棍）。
 * ================================================================== */
const BY_TYPE = { byType: true };

const TAG_PLANS = {
  /* —— 职业武人：攻击槽按身份定系 —— */
  swordsman:  { attack: { 剑: ['jh_sword'] }, support: merge(QING, ZHAO, NEI) },
  monk:       { attack: { 拳: ['jh_fist'] },  support: merge(NEI, ZHAO, QING) },
  nun:        { attack: { 拳: ['jh_fist'] },  support: merge(NEI, QING) },
  taoist:     { attack: { 剑: ['jh_sword'] }, support: merge(NEI, QING) },
  beggar:     { attack: { 棍: ['jh_staff'] }, support: merge(QING, NEI) },
  escort:     { attack: { 刀: ['jh_blade', 'kuangfeng_daofa', 'hujia_daofa'] }, support: merge(ZHAO, QING) },
  constable:  { attack: { 刀: ['jh_blade', 'kuangfeng_daofa'] }, support: ZHAO },
  hunter:     { attack: { 刀: ['hujia_daofa', 'jh_blade'] }, support: QING },
  smith:      { attack: BY_TYPE, support: ZHAO },   // 铁匠使的是手里那把（刀/拳），按现有系升级
  thief:      { attack: { 拳: ['jh_fist'] }, support: QING },
  doctor:     { attack: { 拳: ['jh_fist'] }, support: merge(NEI, ZHAO) },
  official:   { attack: { 剑: ['jh_sword'] }, support: merge(NEI, ZHAO) },
  eunuch:     { attack: { 拳: ['jh_fist'] }, support: ZHAO },

  /* —— 非武人：保留原兵刃系（byType 升级），补一门护身招架 —— */
  palace:     { attack: BY_TYPE, support: QING },
  consort:    { attack: BY_TYPE, support: QING },
  courtesan:  { attack: BY_TYPE, support: QING },
  singer:     { attack: BY_TYPE, support: QING },
  actor:      { attack: BY_TYPE, support: QING },
  madam:      { attack: BY_TYPE, support: QING },
  /* 书生：不习内功（主人在报告里点名「给书生发内功」是误配）。
     只保留/升级拳脚，**不加任何支持槽**。 */
  scholar:    { attack: BY_TYPE, support: {} },
  /* 孩童：不配武学（原样，只把可能的 basic 拳脚按系升级，也可不动）。 */
  child:      { attack: BY_TYPE, support: {} },

  /* —— 市井 / 劳作：保留原兵刃系 + 一门护身招架 —— */
  commoner:   { attack: BY_TYPE, support: ZHAO },
  farmer:     { attack: BY_TYPE, support: ZHAO },
  vendor:     { attack: BY_TYPE, support: ZHAO },
  merchant:   { attack: BY_TYPE, support: ZHAO },
  richman:    { attack: BY_TYPE, support: ZHAO },
  innkeeper:  { attack: BY_TYPE, support: ZHAO },
  waiter:     { attack: BY_TYPE, support: ZHAO },
  waiter2:    { attack: BY_TYPE, support: ZHAO },
  groom:      { attack: BY_TYPE, support: ZHAO },
  boatman:    { attack: BY_TYPE, support: merge(ZHAO, QING) },
  refugee:    { attack: BY_TYPE, support: ZHAO },
  gambler:    { attack: { 拳: ['jh_fist'] }, support: ZHAO },
};

/* ==================================================================
 * §4 SECT_PLANS —— 门派 → plan（**优先级高于 tag**）
 *
 * 门派的招牌功法语义硬（华山剑法不可能出现在峨眉弟子身上），
 * 所以 sect 命中就用门派 plan；已是非 basic 的真功夫照旧保留（只加不夺）。
 * ================================================================== */
const SECT_PLANS = {
  huashan:   { attack: { 剑: ['huashan_sword', 'huashan_sword_art', 'huashan_jianyi'] },
               support: merge({ 内功: ['zixia_gong', 'jh_neigong'] }, { 轻功: ['huashan_qinggong'] }, { 招架: ['huashan_sword'] }) },
  shaolin:   { attack: { 拳: ['shaolin_changquan', 'weituo_zhang'] },
               support: merge({ 内功: ['yijinjing'] }, { 轻功: ['shaolin_bu'] }, { 招架: ['shaolin_changquan'] }) },
  wudang:    { attack: { 剑: ['taiji_sword'], 拳: ['wudang_taiji'] },
               support: merge({ 内功: ['chunyang_gong'] }, { 轻功: ['tixu_zhang'] }) },
  emei:      { attack: { 剑: ['emei_sword'] },
               support: merge({ 内功: ['foguang_gong'] }, { 暗器: ['emei_ci'] }) },
  gaibang:   { attack: { 棍: ['dagou_bangfa'], 拳: ['xianglong_zhang'] },
               support: merge({ 轻功: ['beggar_qinggong'] }, { 内功: ['jh_neigong'] }) },
  mojiao:    { attack: { 拳: ['heimu_zhang'] }, support: merge({ 内功: ['xixing_dafa'] }) },
  taohua:    { attack: { 刀: ['kuangfeng_daofa'], 拳: ['yiyang_zhi'] }, support: merge({ 轻功: ['lingbo_weibu'] }) },
  miaojiang: { attack: { 暗器: ['miao_gu'], 拳: ['ice_silk_zhang'] }, support: {} },
  dali:      { attack: { 内功: ['beiming_shengong'], 拳: ['yiyang_zhi'] }, support: merge({ 轻功: ['lingbo_weibu'] }) },
  xuedao:    { attack: { 刀: ['xuedao'] }, support: {} },
  xingxiu:   { attack: { 拳: ['cuixin_zhang'], 暗器: ['tangmen_du'] }, support: {} },
};

/* ==================================================================
 * §5 ID_OVERRIDES —— 具名 / 守卫 / A 层故事人物（**优先级最高**，逐条列 id）
 *
 * 只列「tag 判不出正确身份」或「A 层要有辨识度招式」的少数条目。
 * 每一行都是人可读的清单——谁被特殊处理、为什么，在代码里一目了然。
 * ================================================================== */
const ID_OVERRIDES = {
  /* —— 守卫（tag 都是 swordsman，按 tag 会一律发剑；按名字逐条定兵器）—— */
  guard_city:     { attack: { 剑: ['jh_sword'] }, support: ZHAO },                 // 城门守卫
  guard_palace:   { attack: { 棍: ['jh_staff'] }, support: ZHAO },                 // 禁军（原 skills 里 gunfa_basic 是不存在的技能 id，一并纠正）
  guard_yamen:    { attack: { 刀: ['jh_blade'] }, support: ZHAO },                 // 衙役
  guard_jinywei:  { attack: { 刀: ['xunchun_blade_art'] }, support: ZHAO },        // 锦衣卫（绣春刀）
  guard_shaolin:  { attack: { 拳: ['shaolin_changquan'] }, support: merge(NEI, ZHAO) }, // 知客僧
  guard_huashan:  { attack: { 剑: ['huashan_sword'] }, support: QING },            // 华山弟子
  guard_blulu:    { attack: { 拳: ['jh_fist'] }, support: {} },                    // 书院山长（文职，非武人）

  /* —— A 层故事人物（15 席「已有画像」中，攻击槽停在 basic 的，给辨识度招式）—— */
  npcv_013: { attack: { 棍: ['dagou_bangfa'] }, support: merge(QING, NEI), forceSupport: true },  // 黄望舒·老叫花（丐帮）
  npcv_024: { attack: { 剑: ['xuantie_jianfa'] }, support: merge(QING, ZHAO), forceSupport: true }, // 蒋停舟·青年剑客
  npcv_027: { attack: { 拳: ['weituo_zhang'] }, support: merge(NEI, ZHAO, QING), forceSupport: true }, // 任停·破庙和尚
  npcv_037: { attack: { 刀: ['hujia_daofa'] }, support: QING, forceSupport: true },               // 邵清欢·佃户（胡家刀法＝农家刀）
  npcv_062: { attack: { 剑: ['jh_sword'] }, support: merge(NEI, QING), forceSupport: true },       // 屈弘·破庙老道
  npcv_073: { attack: { 棍: ['jh_staff'] }, support: QING, forceSupport: true },                   // 元若·茶馆掌柜
  npcv_081: { attack: { 刀: ['hujia_daofa', 'kuangfeng_daofa'] }, support: merge(QING, ZHAO), forceSupport: true }, // 强秋·镖师
  npcv_109: { attack: { 拳: ['jh_fist'] }, support: ZHAO, forceSupport: true },                    // 庞听·富商
  npcv_181: { attack: { 刀: ['kuangfeng_daofa'] }, support: ZHAO, forceSupport: true },            // 黄清·女捕快
  wen_huashan_shop: { attack: { 拳: ['jh_fist'] }, support: merge(NEI, ZHAO), forceSupport: true },// 药婆婆·老药婆
  /* 名宿（原著具名）**不列**——他们手上的招牌功夫（剑/内功/轻功/招架）本就齐备，
      `applyPlan` 的「只加不夺」会原样保留，不做任何改动。 */

  /* —— 无 tag 的人形 mob —— */
  mob_bandit:       { attack: { 刀: ['jh_blade'] }, support: {} },
  mob_bandit_chief: { attack: { 刀: ['hujia_daofa'] }, support: {} },
  mob_soldier:      { attack: { 棍: ['jh_staff'] }, support: ZHAO },
  mob_assassin:     { attack: { 暗器: ['tangmen_anqi'] }, support: QING },
  mob_mo_disciple:  { attack: { 拳: ['heimu_zhang'] }, support: {} },
};

/* 明确**不碰**的 id 白名单（无 tag 的动物 / 测试/演示角色）：
   动物走 bestiary.js 的 speciesMoves（B3），这里必须放手——否则会与人形规则打架。 */
const SKIP_IDS = new Set([
  'mob_wolf', 'mob_boar', 'mob_snake', 'mob_black_bear', 'mob_tiger',   // 动物（B3 领地）
  'test_npc', 'demo_swordman',                                          // 测试/演示
]);

/* ==================================================================
 * §6 planForNpc(def) —— 三级判别（id → sect → tag），判不出返回 null
 * ================================================================== */
function planForNpc(def, key) {
  if (!def) return null;
  /* ⚠️ 6 个 guard_*（衙役/禁军/锦衣卫…）模板**没有内层 `id` 字段**，身份只在
     `data.npcs` 的**键名**上——所以 id 一律取 `def.id || key`（生成器传 key）。
     不这么做它们会静默落进「判不出身份」，五个守卫永远没功法。 */
  const id = def.id || key || '';
  if (!id) return null;
  if (SKIP_IDS.has(id)) return null;
  if (ID_OVERRIDES[id]) return ID_OVERRIDES[id];
  if (def.sect && SECT_PLANS[def.sect]) return SECT_PLANS[def.sect];
  if (def.tag && TAG_PLANS[def.tag]) return TAG_PLANS[def.tag];
  return null;   // 判不出身份 → 原样不动（宁可漏不可误）
}

/* ==================================================================
 * §7 applyPlan(def) —— 把 plan 落回 def（**只加不夺**）
 *
 * 铁律：
 *   ① 槽里已是**非 basic 的真功夫** → 一律保留（手写作者的意图优先）；
 *   ② 从不删除 def.skills / def.learned / def 的其它任何字段；
 *   ③ 新装上/新加的支持功法，**必须同时在 learned 里挂上**——
 *      否则 combat.pickSkill 读 `u.learned[id]` 为假会跳过它，
 *      等于「装了却没学会」，白改；
 *   ④ A 层（tier==='A'）默认**不补支持槽**（手写人物不擅自增补），
 *      只有 plan.forceSupport 才例外。
 * ================================================================== */

/**
 * 判定「这个槽能不能被身份功法顶掉」：
 *   ① 空槽；② 基本功法（basic_*）；③ **悬空引用**（技能 id 在 10_skills.json 里不存在）。
 * ③ 是必要的：`guard_palace` 的「棍」槽写的是 `gunfa_basic`——一个**全库不存在**的
 *   技能 id（既有数据错误），按 id 前缀判会当成「真功夫」而原样保留、永远修不掉。
 *   悬空引用本就等于「这个槽没有可用武学」，顶掉它是修，不是夺。
 * @param {string} sid           槽里的技能 id
 * @param {(id:string)=>boolean} [isKnown]  技能是否存在（生成器传入；缺省视为都存在）
 */
function isBasicOrEmpty(sid, isKnown) {
  if (!sid) return true;
  if (/^basic_/.test(sid)) return true;
  if (typeof isKnown === 'function' && !isKnown(sid)) return true;
  return false;
}

/** 稳定哈希：同一 id 每次得到同一结果（回档/多次生成必须一致，禁随机数） */
function hash(s) {
  let h = 2166136261;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function pick(pool, h, salt) {
  if (!Array.isArray(pool) || !pool.length) return null;
  return pool[(h + (salt || 0)) % pool.length];
}

/** basic_* → 同系江湖通用功法的映射（byType 升级用） */
const UPGRADE_BY_TYPE = { 拳: 'jh_fist', 剑: 'jh_sword', 刀: 'jh_blade', 棍: 'jh_staff', 鞭: 'basic_whip' };

/**
 * 无兵刃的武人 → 补一把**最普通、几乎不加成**的兵刃（免得身份招式吃武器惩罚）。
 * 选的是各系里 atk 加成最低的：剑 wood_sword(+3) / 刀 butcher_knife(+0) / 棍 wood_staff(+10)。
 * 暗器、音波**没有对应的普通兵刃道具**（全库 20_items.json 里没有 weaponType='暗器'/'音波' 的兵器），
 * 所以这两系装不上 → 上层会退到拳脚（unarmedFallback）。
 */
const PLAIN_WEAPON = { 剑: 'wood_sword', 刀: 'butcher_knife', 棍: 'wood_staff', 鞭: 'long_whip' };

/** 攻击槽熟练度：保留原有 basic 的熟练度（不动输出），没有就给 tier 档位 |
 *  档位刻意压低（B 层 ~50、C 层 ~20），因为 jh_* 的 damageMult 只比 basic 高一点点。 */
function attackLevel(prev, tier, h, salt) {
  if (typeof prev === 'number' && prev > 0) return prev;
  const rows = { A: [120, 120], B: [50, 60], C: [20, 30], mob: [30, 40] };
  const [base, span] = rows[tier] || [30, 40];
  return base + ((h + (salt || 0)) % span);
}
/** 支持槽（内功/轻功/招架）：只加属性，不抬高输出，档位再压一档 */
function supportLevel(tier, h, salt) {
  const rows = { A: [90, 110], B: [35, 55], C: [12, 25], mob: [20, 30] };
  const [base, span] = rows[tier] || [20, 30];
  return base + ((h + (salt || 0)) % span);
}

/** 确保 learned 里有这门功法（已有就不动）；返回是否新加 */
function ensureLearned(def, sid, level) {
  if (!sid) return false;
  if (def.learned[sid]) return false;
  def.learned[sid] = { level: level, exp: 0 };
  return true;
}

/**
 * 落 plan。返回变更记录（供生成器统计/断言），不改则返回 null。
 * @param {object} def   NPC 模板（会被就地修改）
 * @param {object} plan  来自 planForNpc()
 */
/* 需要兵刃的攻击槽（拳脚/内功等无需兵刃 → 永不吃武器惩罚） */
const WEAPON_SLOTS = { 剑: 1, 刀: 1, 棍: 1, 鞭: 1, 暗器: 1, 音波: 1 };

function applyPlan(def, plan, opts) {
  if (!def || !plan) return null;
  const isKnown = (opts && opts.isKnown) || (() => true);
  /* ensureWeapon(def, slot) → 这个 NPC 现在是否**真握着**该系兵刃（必要时由生成器补一把普通兵刃）。
     ⚠️ 这是 B3 教训的直接落实：没兵刃却装兵刃系招式，combat.weaponPenalty 会打 0.45 折
     并在日志里打「手中无X类兵刃，威力大减」——「修一个 bug、引一个更显眼的 bug」。
     所以**没有对应兵刃的 NPC 一律不装兵刃系招式**，改走拳脚（见 unarmedOrSkip）。 */
  const ensureWeapon = (opts && opts.ensureWeapon) || (() => true);
  const unarmed = (plan && plan.unarmed) || 'jh_fist';
  const id = (opts && opts.id) || def.id || '';   // guard_* 无内层 id，取键名
  const h = hash(id);
  def.skills = def.skills || {};
  def.learned = def.learned || {};
  const rec = { id: id, name: def.name, attack: [], support: [], added: [], skipped: [], fellBack: [] };

  /* 兵刃系装不上时退到拳脚（把 unarmed 写进「拳」槽——拳脚槽永不吃武器惩罚） */
  function unarmedFallback(reason) {
    const cur = def.skills['拳'];
    if (!isBasicOrEmpty(cur, isKnown)) { rec.skipped.push('拳:' + cur + '(已是非基本，保留)'); return; }
    const prevLv = (cur && def.learned[cur]) ? def.learned[cur].level : null;
    def.skills['拳'] = unarmed;
    ensureLearned(def, unarmed, attackLevel(prevLv, def.tier, h, 7));
    rec.fellBack.push(unarmed + '(' + reason + ')');
  }

  /* ---- ① 攻击槽 ---- */
  if (plan.attack && plan.attack.byType) {
    /* 保留原兵刃系：把每个 basic_* 攻击槽按同系升成 jh_*
       —— 兵刃系槽必须先确认握着对应兵刃（否则原地保留，不制造新惩罚）。 */
    for (const slot of Object.keys(def.skills)) {
      const cur = def.skills[slot];
      if (!isBasicOrEmpty(cur, isKnown)) continue;
      const up = UPGRADE_BY_TYPE[slot];
      if (!up || up === cur) continue;
      if (WEAPON_SLOTS[slot] && !ensureWeapon(def, slot)) { rec.skipped.push(slot + '(无可用兵刃，保留原样)'); continue; }
      const prevLv = (cur && def.learned[cur]) ? def.learned[cur].level : null;
      def.skills[slot] = up;
      ensureLearned(def, up, attackLevel(prevLv, def.tier, h, 7));
      rec.attack.push(slot + ':' + up);
      rec.added.push(up);
    }
  } else if (plan.attack) {
    let anyWeaponSlot = false;
    for (const slot of Object.keys(plan.attack)) {
      const cur = def.skills[slot];
      if (!isBasicOrEmpty(cur, isKnown)) { rec.skipped.push(slot + ':' + cur + '(已是非基本，保留)'); continue; }
      if (WEAPON_SLOTS[slot]) {
        anyWeaponSlot = true;
        if (!ensureWeapon(def, slot)) { rec.skipped.push(slot + '(无可用兵刃，改走拳脚)'); continue; }
      }
      const skill = pick(plan.attack[slot], h, 3);
      if (!skill) continue;
      const prevLv = (cur && def.learned[cur]) ? def.learned[cur].level : null;
      def.skills[slot] = skill;
      ensureLearned(def, skill, attackLevel(prevLv, def.tier, h, 7));
      rec.attack.push(slot + ':' + skill);
      rec.added.push(skill);
    }
    /* 身份是兵刃系、却一把兵刃也使不上（无兵刃且无可配普通兵刃 / 手上有不匹配的兵器）
       → 退到拳脚，别硬装兵刃系吃惩罚。 */
    if (anyWeaponSlot && !rec.attack.some(x => WEAPON_SLOTS[x.split(':')[0]])) unarmedFallback('无可用兵刃');
  }

  /* ---- ② 支持槽（A 层默认不补，除非 forceSupport）---- */
  const allowSupport = def.tier !== 'A' || !!plan.forceSupport;
  if (allowSupport && plan.support) {
    let salt = 11;
    for (const slot of Object.keys(plan.support)) {
      const cur = def.skills[slot];
      if (!isBasicOrEmpty(cur, isKnown)) { rec.skipped.push(slot + ':' + cur + '(已是非基本，保留)'); salt += 5; continue; }
      const skill = pick(plan.support[slot], h, salt);
      salt += 5;
      if (!skill) continue;
      def.skills[slot] = skill;
      ensureLearned(def, skill, supportLevel(def.tier, h, salt));
      rec.support.push(slot + ':' + skill);
      rec.added.push(skill);
    }
  }

  if (!rec.attack.length && !rec.support.length) return null;   // 无改动
  return rec;
}

module.exports = {
  GENERIC_SKILLS,
  TAG_PLANS,
  SECT_PLANS,
  ID_OVERRIDES,
  SKIP_IDS,
  UPGRADE_BY_TYPE,
  PLAIN_WEAPON,
  WEAPON_SLOTS,
  planForNpc,
  applyPlan,
  hash,
  pick,
  isBasicOrEmpty,
};
