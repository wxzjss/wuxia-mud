/**
 * bestiary.js — 物种专属招式（B3 毒蛇 · 也是 B8「按画像配功法」的写法模板）
 *
 * ── 为什么单独一个模块，而不改 game/data/*.json ──────────────────────
 * 规矩是「绝不改 game/data/*.json」（数据缺口是另一批的活，混进来会污染回归判据）。
 * 而 B3 要做的恰恰是「给某个物种配专属招式」——这正是**规则**而不是**数据**：
 * 蛇有蛇的招式、狼有狼的招式，这条「按物种挂招式」的链路本身才是资产。
 * 所以做法是：招式定义写在本文件，数据加载后由 `world.applySpeciesMoves()` 注入。
 * B8 铺开 300 个 NPC 时，只需要往 SPECIES_MOVES 里加条目，机制不用重写。
 *
 * ── 注入的是「学会 + 装上」，不是替换 ────────────────────────────────
 * 原来 `mob_snake` 的数据是 `skills: { 拳: "basic_fist" }`，所以它只会基本拳脚。
 * 若这里直接改写 skills 槽位，就得动 JSON；改在**运行时**追加，
 * 则 `data.npcs.mob_snake.skills` 原样保留（数据文件零改动），
 * 而战斗时 `pickSkill` 会因为槽位里已装上毒牙类招式而优先取它。
 *
 * ── 物种怎么认 ——批次 2 返工BLK-2：全面转「显式声明」，关键词兜底已删除 ──
 *
 * ⚠️ 为什么删掉「名称/描述里出现关键词」这一级（这是 BLK-2 的根因）：
 *   武侠 NPC 里「名字或描述里带蛇」的是**人**，不是蛇：
 *     · miao_lan蓝凤凰（tag=swordsman，人类剑客）—— desc 写「手腕上盘着一条碧绿小蛇」
 *       → 被兜底判成 snake → 挂上毒牙噬咬/缠身绞杀/信子吐信，
 *         **顶掉**了她自己的苗家暗器 miao_gu 与冰蚕丝掌 ice_silk_zhang，
 *         实测她一局只出{毒牙噬咬31, 信子吐信24, 缠身绞杀18}，自己的武学永不被取用。
 *     · 「金蛇郎君」「蛇婆婆」「化蛇手」这类**人名/外号含蛇**的角色同理会被误挂。
 *   关键词在中文武侠语料里**没有判别力**：人物可以随手写到任何动物。
 *   既然判不准，就不该猜 —— 宁可漏判（判不出=走原来的拳脚，零影响），
 *   也不能误判（玩家可见的严重回归）。**漏是回归前的常态，误是新引入的回归。**
 *
 * 现在只剩两级，都不猜：
 *   ① 模板显式写 species（最准，将来 B8 画像系统上线就靠这条，300 个 NPC 逐个写）；
 *   ② **显式列举的 id 规则表**（下表逐条列id，不含任何正则通配的关键词面）。
 *      每一条都是人可读的清单 —— 「谁被挂了物种招式」在代码里一目了然、可审计。
 *
 *⚠️ 第②级还有一道类型闸门（`ANIMAL_ID_PREFIX`）：**只有 id 以 mob_/animal_ 开头的
 *   模板才允许自动挂 speciesMoves**。因为 mob_ 前缀里也混着人（mob_bandit 山贼、
 *   mob_soldier 官兵、mob_assassin 刺客），靠规则表逐条列才分得清；
 *   而 `miao_lan` 这种**人物模板即使将来有人手滑写了 species 字段**，
 *   applySpeciesMoves 也会因为 id 前缀不是 mob_/animal_ 而拒绝注入 ——双保险。
 */
'use strict';

/**
 * 物种 → 专属招式。
 * 每条招式都是标准 skill 结构（与 10_skills.json 同构），
 * 所以 oneAttack / pickSkill / profTierOf 全部原样生效，无需为动物招式另写一套。
 *
 * ⚠️ `type` 一律用「拳」（空手类），**不要用剑/刀/棍/鞭/暗器**：
 *   combat.js 的 `WEAPON_REQUIRED` 把这五类标成「必须持对应兵刃」，
 *   没兵器就会吃 `mult 0.45 / acc -25` 的惩罚，界面上还会打出
 *   「手中无暗器类兵刃，威力大减」—— 一条**根本没手**的蛇被要求拿暗器，
 *   属于把武侠的兵器规则硬套到动物身上。
 *   蛇靠獠牙与身体作战，本质是「空手」，所以type 就是拳。
 */
const SPECIES_MOVES = {
  /* ───────────── 蛇类 ───────────── */
  snake: [
    {
      id: 'snake_fang', name: '毒牙噬咬', type: '拳', category: '外功', quality: 'uncommon',
      maxLevel: 300, difficulty: 0.8, trainCost: 60,
      damageMult: 1.15, accuracy: 92, mpCost: 0,
      desc: '蛇类天生的撕咬。獠牙一收一送，见血封喉。',
      effects: [
        { type: 'dot', name: '蛇毒', turns: 3, value: 18 },
      ],
    },
    {
      id: 'snake_coil', name: '缠身绞杀', type: '拳', category: '外功', quality: 'uncommon',
      maxLevel: 300, difficulty: 1.0, trainCost: 90,
      damageMult: 1.05, accuracy: 88, mpCost: 8,
      desc: '蛇身一缠便如铁索，越挣越紧。',
      effects: [
        { type: 'slow', turns: 2, value: 30 },
      ],
    },
    {
      id: 'snake_spit', name: '信子吐信', type: '拳', category: '旁门', quality: 'uncommon',
      maxLevel: 300, difficulty: 1.2, trainCost: 120,
      damageMult: 0.9, accuracy: 96, mpCost: 10,
      desc: '远远一口毒信，淬得见血封喉。',
      effects: [
        { type: 'dot', name: '蛇毒', turns: 4, value: 22 },
      ],
    },
  ],

  /* ───────────── 猛兽类 ─────────────
     批次 2 返工：原先只有 1 招（猛扑）。验收指出「蛇有 3 招，猛兽只有 1 招，
     若猛兽占比高招式多样性不足」—— 补到 3 招，与蛇类持平。
     「只有一招」在观感上与原bug（只有基本拳脚）没区别，这是同型问题。 */
  beast: [
    {
      id: 'beast_pounce', name: '猛扑', type: '拳', category: '外功', quality: 'common',
      maxLevel: 300, difficulty: 0.7, trainCost: 50,
      damageMult: 1.25, accuracy: 85, mpCost: 0,
      desc: '后腿一沉，纵身扑咬。',
      effects: [],
    },
    {
      id: 'beast_rend', name: '利爪撕扯', type: '拳', category: '外功', quality: 'common',
      maxLevel: 300, difficulty: 0.8, trainCost: 60,
      damageMult: 1.1, accuracy: 90, mpCost: 0,
      desc: '三瓣利爪一扯，血肉翻开。',
      effects: [
        { type: 'dot', name: '创口', turns: 2, value: 12 },
      ],
    },
    {
      id: 'beast_roar', name: '咆哮威吓', type: '拳', category: '旁门', quality: 'common',
      maxLevel: 300, difficulty: 0.9, trainCost: 70,
      damageMult: 0.75, accuracy: 95, mpCost: 8,
      desc: '一声长嚎，山风四起，对手腿脚都为之一软。',
      effects: [
        { type: 'slow', turns: 2, value: 25 },
      ],
    },
  ],
};

/**
 * 物种识别表 —— **只认显式声明，不猜**（详见文件头 BLK-2 说明）。
 *
 * 每条规则只有一个显式 id 清单（不是关键词面）。B8 铺开 300 个 NPC 时，
 *往这里加 id 或给模板写 `species` 字段即可，判别逻辑本身不用改。
 *
 * ⚠️ `isAnimalIdGate` 是类型闸门：只有 id 前缀是 mob_/animal_ 的模板才允许
 *   自动挂招式。这条是BLK-2 的第二道保险 —— 人物模板就算被误写 species 也不注入。
 */
const ANIMAL_ID_PREFIX = /^(mob_|animal_)/;

/** 允许被自动挂物种招式的 id 前缀（人物模板一律排除）。 */
function isAnimalId(id) {
  return ANIMAL_ID_PREFIX.test(String(id || ''));
}

/**
 * 物种 → id 规则。
 * ⚠️ 这些正则是**锚定的 id 全名/前缀**，不是「描述里出现什么词」。
 *   批改时容易犯的错：把 `/snake/i` 这种无锚定写法重新放回来 ——
 *   它会命中 `npc_snake_blade`（蛇婆婆，人）这类人物 id，
 *   也正是原SPECIES_RULES 第③级误判的同一个错。**必须写 `^mob_snake$` 这样的锚定式。**
 */
const SPECIES_RULES = [
  // 蛇类：全仓只有 mob_snake 一条蛇。锚定到全名，`npc_snake_blade` 不会命中。
  { species: 'snake', ids: [/^mob_snake$/, /^animal_snake$/] },

  /* 猛兽类。
     批次 2 补齐：原先漏了 mob_black_bear（黑熊）—— 它是货真价实的动物，
     却因为规则表只列了 wolf/tiger/boar 而判不出物种、原地复发 B3（只会基本拳脚）。 */
  { species: 'beast', ids: [/^mob_(wolf|tiger|black_bear|boar|leopard)$/, /^animal_(wolf|tiger|bear|boar|leopard)$/] },
];

/** 判定一个 NPC 模板属于哪个物种；判不出返回 null（走原来的拳脚，不影响既有行为）。 */
function speciesOf(def) {
  if (!def) return null;
  /* ① 模板显式声明（B8 画像系统的正式入口，最准）。
     注意：**这里不查isAnimalId** —— 显式声明就是作者负责，
     类型闸门在 applySpeciesMoves 那一层执行（因为要给人物留「显式声明也不行」的余地时好报错）。*/
  if (def.species && SPECIES_MOVES[def.species]) return def.species;
  /* ② 显式 id 规则表。**必须先过类型闸门**：非 mob_/animal_ 的模板一律不判，
     这样即使规则表将来有人手滑加宽，人物也不会被误判（BLK-2 不会再复发）。 */
  const id = String(def.id || '');
  if (!isAnimalId(id)) return null;
  for (const r of SPECIES_RULES) {
    if (r.ids.some(re => re.test(id))) return r.species;
  }
  return null;   // ③ 关键词兜底：**已删除**（BLK-2 根因，见文件头）
}

module.exports = { SPECIES_MOVES, SPECIES_RULES, speciesOf, isAnimalId, ANIMAL_ID_PREFIX };
