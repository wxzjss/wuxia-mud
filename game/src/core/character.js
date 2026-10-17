/**
 * character.js — 角色（玩家 / NPC 共用基类）
 *
 * 高自由度设计要点：
 *  - 属性不写死，任何 mod 都能新增属性（baseAttr 是字典）
 *  - 武学不写死，一切武学都来自数据
 *  - 天赋(perk) / 特质(trait) / 称号(title) 完全数据驱动
 */
'use strict';

const { clamp, uid, fmtTime, shichen } = require('./utils');

const BASE_ATTRS = ['力量', '根骨', '身法', '悟性', '福缘', '定力', '资质'];

/* ============================================================
 * 武技熟练度分级（SPRINT2 武学重制）
 *  level 归一化到 maxLevel 后映射到档位，每档效果不同
 * ============================================================ */
const PROF_TIERS = [
  { name: '未入门', mult: 0.6, acc: 0 },
  { name: '入门',   mult: 0.8, acc: 0 },
  { name: '小成',   mult: 1.0, acc: 0 },
  { name: '大成',   mult: 1.25, acc: 3 },
  { name: '融会',   mult: 1.5, acc: 6 },
  { name: '登峰造极', mult: 2.0, acc: 10 },
];
function profTierIndex(level, maxLevel) {
  const max = maxLevel || 300;
  const r = level / max;
  if (r < 0.2) return 1;
  if (r < 0.4) return 2;
  if (r < 0.6) return 3;
  if (r < 0.85) return 4;
  return 5;
}
function profTierOf(u, skillId) {
  const s = u.learned[skillId]; if (!s) return 0;
  const sd = u.world.getSkill(skillId);
  /* ⚠️ 分母必须是 effectiveMax（含「基础武学等级」这一项），不是 sd.maxLevel。
     否则衍生武学的上限被基础武学压到 120 之后，等级永远到不了 r=0.85 那档，
     玩家会看到「练到顶了却还挂着『未入门』」——这是武学重制里最容易被忽略的静默错位。 */
  const max = sd ? (typeof u.effectiveMax === 'function' ? u.effectiveMax(sd) : (sd.maxLevel || 300)) : 300;
  return profTierIndex(s.level, Math.max(1, max));
}

/**
 * 基础武学总表（武学重制 R2）：一门「系」的根 = 该槽位允许挂载的基础武学。
 * 判据是「这门武学有没有基础武学」，与 category（外功/魔功/奇门/旁门）无关。
 * 值是**数组**：一个槽位可以有两条根 —— 暗器系分「手法（basic_throw）」与
 * 「毒术（basic_poison）」两支，唐门的满天花雨与唐门毒术各有各的根，互不挤占。
 * ⚠️ 一族只允许一条根（内功 → 基本内功，主人点名），别随手加第二条。
 */
const SLOT_ROOT = {
  内功: ['basic_force'],
  招架: ['basic_parry'],
  轻功: ['basic_dodge'],
  拳: ['basic_fist'],
  剑: ['basic_sword'],
  刀: ['basic_blade'],
  棍: ['basic_staff'],
  鞭: ['basic_whip'],
  暗器: ['basic_throw', 'basic_poison'],
  音波: ['basic_sing'],
  医术: ['basic_medicine'],
};
/** 无基础武学的武学（散学）单独激活的合计上限 */
const STANDALONE_MAX = 3;
function profTierMult(tier) { return PROF_TIERS[clamp(tier, 0, 5)].mult; }
function profTierAcc(tier) { return PROF_TIERS[clamp(tier, 0, 5)].acc; }
function profTierName(tier) { return PROF_TIERS[clamp(tier, 0, 5)].name; }

/**
 * 修习一门功夫所需的**内力上限**（主人 2026-10-11：
 * 「有些功法必须有一定内力上限才能学」）。
 *
 * 数据里写了 `needMp` 就用它；没写就**按品级推**：
 *   品级 1（绝顶绝学）8000 · 2 → 5000 · 3 → 3000 · 4 → 1500 · 5 → 600，六品及以下不设门槛。
 * 为什么在代码里推、不往数据里灌几百个数：**品级本来就是这份刻度的依据**，
 * 写死进数据反而会跟品级脱节（改了品级忘了改门槛 = 又一个静默不一致）。
 */
const NEED_MP_BY_GRADE = { 1: 8000, 2: 5000, 3: 3000, 4: 1500, 5: 600 };

function needMpOf(sd) {
  if (!sd) return 0;
  if (sd.needMp != null) return Math.max(0, Math.floor(sd.needMp));
  return NEED_MP_BY_GRADE[sd.grade] || 0;
}

/**
 * 内力上限 → 熟练度上限的**品级刻度**（系数越大，这门功夫越"省内力"）。
 * 粗浅功夫（九品，如各门基础武学）几百点内力就够把天花板顶到登峰造极；
 * 绝顶绝学（一品）得练到上万内力才摸得着。
 *
 * ⚠️ 它管的是**上限（天花板）**，不是当前熟练度 ——
 *    主人特意澄清过：「不是低品级功法只需要少量内力就能到登峰造极，
 *    而是少量内力上限**熟练度上限**能提高到登峰造极，**当前熟练度你该练还是得练**」。
 */
const GRADE_MP_RATE = { 9: 1.00, 8: 0.80, 7: 0.62, 6: 0.48, 5: 0.37, 4: 0.28, 3: 0.21, 2: 0.15, 1: 0.10 };

/** 取一门功法的内力→上限系数（数据没写 grade 的按八品档兜底，与旧系数 .08 同量级） */
function mpRateFor(sd) {
  const g = sd && sd.grade;
  return GRADE_MP_RATE[g] != null ? GRADE_MP_RATE[g] : 0.10;
}

/* ============================================================
 * 奇经八脉（内功冲击解锁）
 * ============================================================ */
const MERIDIAN_NAMES = { 任: '任脉', 督: '督脉', 冲: '冲脉', 带: '带脉', 阴跷: '阴跷脉', 阳跷: '阳跷脉', 阴维: '阴维脉', 阳维: '阳维脉' };
const MERIDIAN_MAX = 8;
/* 开脉的**固定顺序**（2026-10-11 重做）：
   旧的实现是「从未满的脉里随机抽」—— 30 次打坐实测开出 带/阴跷/阴维/阳维，任督二脉不动，
   而玩家心里「奇经八脉」就是先从任督二脉说起。顺序固定下来，进度才讲得通。
   顺序按传统：任 → 督 → 冲 → 带 → 阴跷 → 阳跷 → 阴维 → 阳维。 */
const MERIDIAN_ORDER = ['任', '督', '冲', '带', '阴跷', '阳跷', '阴维', '阳维'];

/** 通下一级需要多少「冲脉进度」（随级数递增：40 / 70 / 100 …） */
function meridianNeed(level) { return 40 + (level || 0) * 30; }
function emptyMeridians() { return { 任: 0, 督: 0, 冲: 0, 带: 0, 阴跷: 0, 阳跷: 0, 阴维: 0, 阳维: 0 }; }

/** 性别归一化：数据里两种写法混用（门派 require 写 'male'，创建界面存 '男'） */
function normGender(v) {
  if (v === 'male') return '男';
  if (v === 'female') return '女';
  return v;
}

class Character {
  constructor(world, def) {
    def = def || {};
    const w = world;
    this.world = w;
    this.isPlayer = false;
    this.id = def.id || uid('ch');
    this.defId = def.id || null;
    this.name = def.name || '无名氏';
    this.gender = def.gender || 'male';
    this.race = def.race || 'human';
    this.desc = def.desc || '';
    this.title = def.title || '';
    this.personality = def.personality || null;   // 性格（第五批）
    this.mood = def.mood !== undefined ? def.mood : 50;  // 心情 0~100（第五批）

    // ---- 属性 ----
    this.baseAttr = Object.assign({ 力量: 10, 根骨: 10, 身法: 10, 悟性: 10, 福缘: 10, 定力: 10, 资质: 10 }, def.attr || {});
    this.attrBonus = {};       // 装备/状态加成
    this.attr = {};            // 最终属性（recalc 计算）

    // ---- 等级/经验 ----
    this.level = def.level || 1;
    this.exp = def.exp || 0;
    this.expNext = 100;
    if (this.level > 1) { for (let i = 1; i < this.level; i++) this.exp += this.expNeed(i); }
    this.potential = def.potential || 0;

    // ---- 生命/内力/精力 ----
    this.maxHpBase = def.hp || 100;
    this.maxMpBase = def.mp || 50;
    /* ⚠️ recalc 之前就要给 this.maxHp / this.maxMp 一个值 ——
       recalc 里的「满血自动抬满」正是拿它跟 hp 比（见那里的注释）。
       原先只设了 *Base，this.maxHp 直到 recalc 里才第一次被赋值，
       于是那条判断永远读不到「满」的状态。 */
    this.maxHp = this.maxHpBase;
    this.maxMp = this.maxMpBase;
    this.hp = this.maxHpBase;
    this.mp = this.maxMpBase;
    this.maxFood = 100; this.food = 100;
    this.maxWater = 100; this.water = 100;
    this.maxStamina = 100; this.stamina = 100;

    // ---- 攻防 ----
    this.atkBase = def.atk || 5;
    this.defBase = def.def || 2;
    this.dodgeBase = def.dodge || 5;
    this.parryBase = def.parry || 5;
    this.speedBase = def.speed || 10;

    /* ⚠️ 字段语义裁决：`.def` 是 **NPC 模板对象引用**（由 world.spawnNpc 写入），
       Character 绝不写它 —— 防御力数值一律写 `defFinal`。
       历史上 recalc() 会把 this.def 写成数字，把模板引用冲掉，
       导致 combat.js 的伤害公式拿对象做乘法 → NaN（SPRINT1-ENG-02）。 */
    this.atk = 0; this.defFinal = 0; this.dodge = 0; this.parry = 0; this.speed = 0;
    this.critRate = 0.05; this.critDmg = 1.6;
    this.armorPen = 0; this.lifesteal = 0; this.reflect = 0;

    // ---- 武学 ----
    this.learned = {};       // skillId -> {exp, level}
    this.equippedSkills = Object.assign({ 拳: null, 剑: null, 刀: null, 棍: null, 鞭: null, 暗器: null, 内功: null, 轻功: null, 招架: null, 身法: null, 音波: null, 医术: null }, def.skills || {});
    /* 无基础武学的「散学」单独激活池（武学重制 R2）：
       合计 ≤3 本、跨门类共用一个池子 —— 不是按 category 分池。
       ⚠️ 别写成 activeByCategory = {旁门: []}：那样每类各 3 本，与「合计 3 本」不符。 */
    this.standaloneActive = Array.isArray(def.standaloneActive) ? def.standaloneActive.slice() : [];
    if (def.learned) {
      for (const k of Object.keys(def.learned)) {
        this.learned[k] = { exp: def.learned[k].exp || 0, level: def.learned[k].level || 1 };
      }
    }

    // ---- 装备 ----
    this.equipment = Object.assign({ 头部: null, 颈部: null, 身体: null, 手部: null, 脚部: null, 武器: null, 副手: null, 饰品: null, 戒指: null, 披风: null }, def.equipment || {});
    this.equipped = {};      // slot -> itemId 快捷

    // ---- 状态 ----
    this.buffs = [];         // {name, turns, mods:{}, dot:{}, tag}
    this.money = def.money !== undefined ? def.money : 0;
    this.karma = def.karma || 0;
    this.kills = def.kills || 0;
    this.reputation = def.reputation || {};
    this.perks = (def.perks || []).slice();
    this.traits = (def.traits || []).slice();
    this.titles = (def.titles || []).slice();
    this.insect = def.insect || null;
    this.qi = 0;             // 真气/内力修炼值
    this.age = def.age || 16;

    // ---- 奇经八脉（内功冲击） ----
    this.meridians = def.meridians ? Object.assign(emptyMeridians(), def.meridians) : emptyMeridians();
    /* 当前这一脉的冲脉进度（旧版是每次掷骰直接开脉，没有进度这个概念）。
       ⚠️ 随档走 —— 见 world.js 的 serialize/deserialize。 */
    this.meridianExp = def.meridianExp || 0;

    // ---- 门派 ----
    this.sect = def.sect || null;
    this.rank = def.rank || 0;
    this.sectContribution = 0;

    // ---- 任务 / 标记 / 变量 ----
    this.quests = def.quests || {};   // id -> stage
    this.flags = def.flags || {};     // 任意标记
    this.vars = def.vars || {};       // 任意变量（mod 自由使用）
    this.log = def.log || [];

    // ---- 结局（design/89 §4 结局树，S5 上线；字段 2026-10-15 先预留）----
    /* achieved：已触达的结局 id 集合（树分支可能路过多个）；final：最终收束指针。
       ⚠️ 不用 enum：结局 id 由数据侧 S5 才定，现在锁枚举 = 埋存档迁移活。
       serialize/deserialize 白名单已收编（world.js），老档缺字段自动兜底。 */
    this.ending = def.ending || { achieved: {}, final: null };

    // ---- 战斗 ----
    this.inCombat = false;
    this.combatTarget = null;
    this.dead = false;

    // ---- 时间（仅玩家） ----
    this.timeMinutes = def.timeMinutes || 540;

    // 运行时
    this.hostile = !!def.hostile;
    this.isNpc = false;

    this.recalc();
    if (def.hpSet !== undefined) this.hp = def.hpSet;
  }

  expNeed(level) { return Math.floor(100 * Math.pow(1.28, level - 1)); }

  /** 重算派生属性 */
  recalc() {
    const a = Object.assign({}, this.baseAttr);
    for (const k of Object.keys(this.attrBonus)) a[k] = (a[k] || 0) + this.attrBonus[k];

    /* 装备加成。
       🔴 2026-10-11 主人报「玩家初始真的很弱谁都打不过」，查下来这里是主因之一 ——
       原来这段是**两重死代码**：
         ① 判据写的是 `this.world && this.world.items`，可 world 上**根本没有 `items` 这个属性**
            （物品表在 `world.data.items`，取用走 `world.getItem()`）——
            条件恒为假，整个循环一次都不执行；
         ② 就算执行了，加出来的 `this.attrBonusEquip` 也**没有任何地方读它**
            （`attrTotal()` 只看 `this.attr`）。
       结果：**全库所有兵器护具的 `stats:{atk/def/...}` 一律不生效** ——
       玩家穿上木剑还是 11 点攻击、披上衣裳还是 6 点防御，而且不报错。
       现在：`attr` 那一路照旧并进属性总表；`stats`（atk/def/dodge/… 这些**派生量**）
       单收在 `eqStat` 里，下面派生公式逐项加上去。
       ⚠️ 不能像 `it.attr` 那样把 `stats` 并进 `a` —— 键不一样：
          `a` 的键是「力量/根骨/身法」这类**属性**，而 stats 的键是 `atk/def/dodge`
          （由属性算出来的**结果**）。并错了就是「加了但没人用」的第二遍。 */
    this.attrBonusEquip = {};
    const eqStat = {};
    for (const slot of Object.keys(this.equipment || {})) {
      const id = this.equipment[slot];
      const it = (id && this.world && this.world.getItem) ? this.world.getItem(id) : null;
      if (it && it.stats) {
        for (const k of Object.keys(it.stats)) {
          this.attrBonusEquip[k] = (this.attrBonusEquip[k] || 0) + it.stats[k];
          eqStat[k] = (eqStat[k] || 0) + it.stats[k];
        }
      }
      if (it && it.attr) {
        for (const k of Object.keys(it.attr)) {
          a[k] = (a[k] || 0) + it.attr[k];
        }
      }
    }
    this.attr = a;

    // 基础值派生
    const st = this.attrTotal('根骨'), str = this.attrTotal('力量'), agi = this.attrTotal('身法'), wis = this.attrTotal('悟性');

    /* 上限拆解台账（2026-10-11）—— 主人报「初始最大血 89，没走两步变 149」。
       涨是该涨的（内功等级 / 通脉），坏在**全仓没有一处告诉玩家这钱从哪儿来**。
       ⚠️ 台账必须**在下面每一次 maxHp/maxMp 赋值处就地累加**，
          绝不能另写一份「重算一遍」的公式 —— 那样 recalc 改了、台账没改，
          玩家看到的拆解加起来就**不等于**顶上写的总数（比不解释更糟）。
       键：base 底子 / skill 内功与武学 / meridian 奇经八脉 / equip 装备 / other 特质与状态。 */
    const _vit = {
      maxHp: { base: 0, skill: 0, meridian: 0, equip: 0, other: 0 },
      maxMp: { base: 0, skill: 0, meridian: 0, equip: 0, other: 0 },
    };

    let maxHp = this.maxHpBase + st * 12 + (eqStat.maxHp || 0);
    let maxMp = this.maxMpBase + wis * 6 + (eqStat.maxMp || 0);
    _vit.maxHp.base = this.maxHpBase + st * 12;
    _vit.maxMp.base = this.maxMpBase + wis * 6;
    _vit.maxHp.equip = (eqStat.maxHp || 0);
    _vit.maxMp.equip = (eqStat.maxMp || 0);
    let atk = this.atkBase + Math.floor(str * 1.5) + (eqStat.atk || 0);
    let def = this.defBase + Math.floor(st * 1.2) + (eqStat.def || 0);
    let dodge = this.dodgeBase + Math.floor(agi * 1.2) + (eqStat.dodge || 0);
    let parry = this.parryBase + Math.floor((agi + st) * 0.6) + (eqStat.parry || 0);
    let speed = this.speedBase + Math.floor(agi * 0.8) + (eqStat.speed || 0);
    let critRate = this.critRate + (eqStat.critRate || 0), critDmg = this.critDmg, armorPen = 0, lifesteal = 0, reflect = 0;

    // 内功 / 轻功 / 招架 加成
    const neigong = this.equippedSkills['内功'];
    if (neigong && this.learned[neigong]) {
      const s = this.world.getSkill(neigong);
      if (s) {
        const lv = this.skillLevel(neigong);
        maxHp += Math.floor(lv * 1.2);
        maxMp += Math.floor(lv * 1.8) + (s.mpBonus || 0);
        _vit.maxHp.skill += Math.floor(lv * 1.2);
        _vit.maxMp.skill += Math.floor(lv * 1.8) + (s.mpBonus || 0);
        def += Math.floor(lv * 0.3);
      }
    }
    const qinggong = this.equippedSkills['轻功'];
    if (qinggong && this.learned[qinggong]) {
      const lv = this.skillLevel(qinggong);
      dodge += Math.floor(lv * 0.7); speed += Math.floor(lv * 0.3);
    }
    const zhaojia = this.equippedSkills['招架'];
    if (zhaojia && this.learned[zhaojia]) {
      parry += Math.floor(this.skillLevel(zhaojia) * 0.8);
    }

    /* 武学加成
       ⚠️ 等级缩放必须是**收敛曲线**，不能线性乘 lv（与 NUM-01「伤害二次爆炸」同源）：
         旧写法 v*lv/10 是按「几十级」的老量程定的；武学重制后等级抬到 1000，
         于是 `xixing_dafa` 的 bonus.maxMp=700 在 lv=900 时被放大成 63000，
         东方不败一个人的内力上限就冲到 71590（比玩家天花板高一整个数量级）。
       unit = sqrt(lv / 300)：**300 级拿满 1 份 bonus**，往上收敛、往下也不至于归零
         （lv=1 → 0.058 份，v=25 的 atk bonus 仍能 +1，不会让「刚练一级毫无收益」；
          lv=900 → 1.73 份；上限定死 2.5 防异常数据。）
       ⚠️ 同时补齐 dodge/parry/speed/lifesteal：这四类在全库有 400+ 处定义，
         原先**只定义不消费**（铁律「不报错就是不生效」族），等于白写。 */
    for (const k of Object.keys(this.learned)) {
      const s = this.world.getSkill(k);
      if (!s || !s.bonus) continue;
      const lv = this.skillLevel(k);
      const unit = Math.min(2.5, Math.sqrt(Math.max(0, lv) / 300));
      if (unit <= 0) continue;
      for (const bk of Object.keys(s.bonus)) {
        const v = s.bonus[bk];
        if (typeof v !== 'number') continue;
        if (bk === 'maxHp') { maxHp += Math.floor(v * unit); _vit.maxHp.skill += Math.floor(v * unit); }
        else if (bk === 'maxMp') { maxMp += Math.floor(v * unit); _vit.maxMp.skill += Math.floor(v * unit); }
        else if (bk === 'atk') atk += Math.floor(v * unit);
        else if (bk === 'def') def += Math.floor(v * unit);
        else if (bk === 'dodge') dodge += Math.floor(v * unit);
        else if (bk === 'parry') parry += Math.floor(v * unit);
        else if (bk === 'speed') speed += Math.floor(v * unit);
        else if (bk === 'critRate') critRate += v;
        else if (bk === 'lifesteal') lifesteal += v;
      }
    }

    // 奇经八脉（内功冲击解锁，SPRINT2）
    const md = this.meridians || emptyMeridians();
    maxMp += (md.督 || 0) * 15 + (md.阳维 || 0) * 5;
    maxHp += (md.任 || 0) * 12 + (md.阳跷 || 0) * 6;
    _vit.maxMp.meridian += (md.督 || 0) * 15 + (md.阳维 || 0) * 5;
    _vit.maxHp.meridian += (md.任 || 0) * 12 + (md.阳跷 || 0) * 6;
    armorPen += (md.冲 || 0) * 0.02 + (md.阴维 || 0) * 0.01;
    critRate += (md.阴跷 || 0) * 0.01;

    // 家园书房：书房等级越高，悟性越高（SPRINT2 家园地块）
    const _eff = (this.world && typeof this.world.estateEffects === 'function') ? this.world.estateEffects() : null;
    if (_eff && _eff.wisdom) a['悟性'] = (a['悟性'] || 0) + Math.round(_eff.wisdom);

    // 特质 / 天赋加成
    for (const t of this.traits.concat(this.perks)) {
      const td = this.world.getTrait(t);
      if (!td) continue;
      if (td.attr) for (const k of Object.keys(td.attr)) { a[k] = (a[k] || 0) + td.attr[k]; }
      if (td.effects) {
        for (const e of [].concat(td.effects)) {
          if (e.type === 'stat') {
            switch (e.key) {
              case 'maxHp': maxHp += e.value; _vit.maxHp.other += e.value; break;
              case 'maxMp': maxMp += e.value; _vit.maxMp.other += e.value; break;
              case 'atk': atk += e.value; break;
              case 'def': def += e.value; break;
              case 'dodge': dodge += e.value; break;
              case 'parry': parry += e.value; break;
              case 'speed': speed += e.value; break;
              case 'critRate': critRate += e.value; break;
              default: break;
            }
          } else if (e.type === 'attr') {
            a[e.key] = (a[e.key] || 0) + e.value;
          } else if (e.type === 'equipSlot') { /* 由 UI 处理 */ }
        }
      }
    }

    // 状态加成
    for (const b of this.buffs) {
      if (b.mods) {
        for (const k of Object.keys(b.mods)) {
          const v = b.mods[k];
          switch (k) {
            case 'maxHp': maxHp += v; _vit.maxHp.other += v; break;
            case 'maxMp': maxMp += v; _vit.maxMp.other += v; break;
            case 'atk': atk += v; break;
            case 'def': def += v; break;
            case 'dodge': dodge += v; break;
            case 'parry': parry += v; break;
            case 'speed': speed += v; break;
            case 'critRate': critRate += v; break;
            case 'critDmg': critDmg += v; break;
            case 'armorPen': armorPen += v; break;
            case 'lifesteal': lifesteal += v; break;
            case 'reflect': reflect += v; break;
            default: if (a[k] !== undefined) a[k] += v;
          }
        }
      }
    }

    this.attrBonusFinal = {};
    /* 🔴 主人 2026-10-11 亲报两条，其实是同一个病根：
         「刚创建角色进游戏，初始气血是 20/68、内力是 10/70」
         「不知道为什么我的血量变成了 68/148、内力变成了 70/110」
       —— recalc 把 maxHp 抬上去了，hp 只在旧值上被 clamp（`clamp(20,0,68)` 还是 20）。
       于是**任何一次 recalc**（换装备 / 学武 / 过脉 / 加点 / 升级）都会让人从
       「满血」悄悄变成「差一截」，而且不报错、数字看着也正常。
       这是 ENG-04（NPC 出生带残血）的**玩家版**，只是更隐蔽。
       修法：先记「原本是不是满的」，满的照旧抬满；**带伤的不许白回血**
       （否则换一件装备就顺带回满血，等于白送一个回血包）。 */
    const wasFullHp = this.maxHp > 0 && this.hp >= this.maxHp;
    const wasFullMp = this.maxMp > 0 && this.mp >= this.maxMp;
    this.maxHp = Math.floor(maxHp);
    this.maxMp = Math.floor(maxMp);
    this.atk = Math.floor(atk);
    /* 防御力数值 → defFinal（def 留给模板对象引用，见本文件 constructor 注释） */
    this.defFinal = Math.floor(def);
    this.dodge = Math.floor(dodge);
    this.parry = Math.floor(parry);
    this.speed = Math.floor(speed);
    this.critRate = clamp(critRate, 0, 0.95);
    this.critDmg = critDmg;
    this.armorPen = armorPen;
    this.lifesteal = lifesteal;
    this.reflect = reflect;

    this.hp = wasFullHp ? this.maxHp : clamp(this.hp, 0, this.maxHp);
    this.mp = wasFullMp ? this.maxMp : clamp(this.mp, 0, this.maxMp);

    /* 台账落账：把浮点四舍五入期间产生的零头塞进 other，
       保证「各项之和 == 顶上那个总数」——拆解加起来对不上，比不拆更让人不信。 */
    _vit.maxHp.other += this.maxHp - (_vit.maxHp.base + _vit.maxHp.skill + _vit.maxHp.meridian + _vit.maxHp.equip + _vit.maxHp.other);
    _vit.maxMp.other += this.maxMp - (_vit.maxMp.base + _vit.maxMp.skill + _vit.maxMp.meridian + _vit.maxMp.equip + _vit.maxMp.other);
    this._vitals = _vit;

    // 进阶属性（高自由度：任何 mod 都能提供 combat 计算）
    this.combatStats = this.world.computeCombatStats ? this.world.computeCombatStats(this) : {};
    return this;
  }

  attrTotal(key) {
    return (this.attr && this.attr[key]) || 0;
  }

  /* ---------------- 武学 ---------------- */

  skillLevel(skillId) {
    const s = this.learned[skillId];
    if (!s) return 0;
    const sd = this.world.getSkill(skillId);
    const max = sd ? (sd.maxLevel || 500) : 500;
    return clamp(s.level, 0, max);
  }

  skillExpNeed(level) {
    return Math.floor(50 * Math.pow(1.18, level - 1));
  }

  /**
   * 学会一门武学。
   * @param skillId 武学 id
   * @param opts    `{ force: true }` = **绕过「须先学会基础武学」这一关**。
   *   ⚠️ force 只给三类调用方用：门派入门即授（entrySkills/rankSkills）、
   *      剧情/秘籍/奇遇的直接「授艺」（modapi 的 learnskill 效果）。
   *      它们是「有人把功夫交到你手上」，不是玩家自己照着图谱练 ——
   *      **玩家自学（读书 `teach`、`train`）一律走校验**。
   */
  learnSkill(skillId, opts) {
    const o = (opts && typeof opts === 'object') ? opts : {};
    const sd = this.world.getSkill(skillId);
    if (!sd) return { ok: false, msg: `（不存在武学：${skillId}）` };
    if (this.learned[skillId]) return { ok: false, msg: `你已经学过${sd.name}了。` };
    /* 武学重制（主人原话「所有武学都需要先学会对应基础武学才能学」）：
       沿 base 链逐级前置。缺哪一门就说清哪一门，别让它变成「点了没反应」。 */
    if (!o.force && sd.base && !this.learned[sd.base]) {
      const bd = this.world.getSkill(sd.base);
      return { ok: false, msg: `须先练成《${bd ? bd.name : sd.base}》，方能修习${sd.name}。` };
    }
    if (sd.require) {
      const ctx = { player: this, world: this.world };
      const { evalCond } = require('./modapi');
      if (!evalCond(sd.require, ctx)) return { ok: false, msg: `${sd.name}的传授条件你尚未满足。` };
    }
    /* 修习门槛：有些功夫**内力不到根本驾驭不了**（主人 2026-10-11）。
       刻度按品级走（见 needMpOf）—— 一品绝学要上万内力上限，粗浅功夫不设门槛。
       ⚠️ 与 `sd.require` 一样，`force` 路径（传功 / 门派入门 / 剧情塞给你）不拦：
          那是「有人把功夫交到你手上」，跟「自己找上门去学」不是一回事。 */
    if (!o.force) {
      const need = needMpOf(sd);
      if (need > 0 && (this.maxMp || 0) < need) {
        return {
          ok: false,
          msg: `${sd.name}不是这个境界能碰的 —— 须先有 ${need} 点内力上限，你现在只有 ${Math.floor(this.maxMp || 0)}。`,
        };
      }
    }
    this.learned[skillId] = { exp: 0, level: 1 };
    /* 🩸 记 learned_<skillId> flag：主线末段「集齐绝顶武学」靠这个判定。
       以前只有 learned 这个字典、没有 flag → flagsAny 永远 false → 主线走不完。
       ⚠️ flag 用**真 skillId**（learned_jiuyang_shengong），数据里写条件时
       必须对上，别再写 learned_jiuyang 这种简称（对不上就是又一个卡死点）。 */
    this.setFlag('learned_' + skillId, true);
    this.setFlag('learned_skill', skillId);   // 最近学会的那门，剧情用
    // 自动装备到空槽
    if (sd.type && !this.equippedSkills[sd.type]) this.equippedSkills[sd.type] = skillId;
    this.recalc();
    return { ok: true, msg: `你学会了「${sd.name}」！` };
  }

  /** 修炼功法（SPRINT2）：消耗内力为第一资源，不靠打怪升级 */
  learnSkillByTrain(skillId) {
    const sd = this.world.getSkill(skillId);
    if (!sd) return { ok: false, msg: '（无此武学）' };
    if (!this.learned[skillId]) {
      const r = this.learnSkill(skillId);
      if (!r.ok) return r;
    }
    const cur = this.learned[skillId];
    const maxLv = this.effectiveMax(sd);
    if (cur.level >= maxLv) return { ok: false, msg: `你的${sd.name}已臻化境，须更高修为方能再进（上限 ${maxLv} 级）。` };
    const isNeigong = sd.type === '内功';
    const mpCost = Math.max(4, Math.floor((sd.trainMpCost || (isNeigong ? 14 : 7)) * Math.pow(1.05, cur.level - 1)));
    if (this.mp < mpCost) return { ok: false, msg: `内力不足（需 ${mpCost}，你余 ${Math.floor(this.mp)}），先「打坐」恢复内力再练。` };
    /* design/05 §3.2 / 99 §三.4（P1 经济坏账，2026-10-15 落）：
       修炼改扣 `trainCost` —— 原来 `trainCost()` 只算不扣（潜能只有读书一个出口，
       形同虚设）。潜能从此是「练功燃料」，与内力（打坐恢复）形成双资源节奏。
       ⚠️ 放在成功率掷骰**之前**扣：与内力同规 —— 练一次收一次的钱，练砸也算交学费。 */
    const potCost = this.trainCost(sd, cur.level);
    if ((this.potential || 0) < potCost) {
      return { ok: false, msg: `潜能不足（需 ${potCost}，你余 ${Math.floor(this.potential || 0)}）——去做点长见识的事再来练。` };
    }
    const apt = this.attrTotal('资质');
    const okRate = this.trainSuccessRate(sd, cur.level);
    // 习武奇才等特性：修炼经验倍率（NPC/玩家特性可叠加）
    let trainMult = 1;
    for (const tk of this.traits) { const td = this.world.getTrait(tk); if (td && td.trainMult) trainMult *= td.trainMult; }
    // 家园练武场：练武场等级越高，修炼越快（修武学重制）
    const eff = (this.world && typeof this.world.estateEffects === 'function') ? this.world.estateEffects() : null;
    if (eff && eff.trainMult) trainMult *= 1 + eff.trainMult;
    this.mp -= mpCost;
    this.potential = Math.max(0, (this.potential || 0) - potCost);
    const lines = [`你潜心修习（潜能 -${potCost}）：`];
    if (this.world.rng.next() < okRate) {
      /* 内力上限加速（主人 2026-10-10：「内力上限越高，低等级武学练的提升速度越快」）：
         内力是修为的根 —— 根扎得深，学什么都快。1200 内力上限 = 速度翻倍，此后线性。 */
      const mpBoost = 1 + (this.maxMp || 0) / 1200;
      const gain = Math.floor(this.skillExpNeed(cur.level) * (0.5 + apt * 0.03) * trainMult * mpBoost);
      const g = this.gainSkillExp(skillId, gain);
      lines.push(g.msg);
    } else {
      this.gainSkillExp(skillId, Math.floor(this.skillExpNeed(cur.level) * 0.15));
      lines.push('你运功稍有滞涩，仅得些许体会。');
    }
    // 内功修炼：冲击奇经八脉（type=内功 即内功心法，含魔功类内功）
    if (isNeigong) {
      const m = this.tryAssaultMeridian(sd);
      if (m) lines.push(m);
    }
    return { ok: true, msg: lines.join('') };
  }

  /** 内功冲击奇经八脉（2026-10-11 重做）
   *
   * 🔴 主人亲报：「为什么我打坐一下就直接显示我冲开了任脉？（有点太小儿科的感觉）」
   *    旧实现：每次内功修炼掷一次骰（悟性 8 时 ≈ 20%），中了就从**未满的脉里随机抽一条** +1 级。
   *    两个毛病：
   *      ① 一次打坐就可能开脉 —— 奇经八脉成了抽奖，玩家自然觉得儿戏；
   *      ② **随机跳脉**：实测 30 次打坐开的是 带/阴跷/阴维/阳维，任督二脉压根没动 ——
   *         而玩家的心理顺序是「任督二脉」先通。抽出来的顺序看着就是乱的。
   *    连带后果：每次开脉都悄悄抬 maxHp/maxMp，玩家看到数字莫名其妙地涨
   *    （主人报的「89→149」里就有这一份），却没有任何一处告诉他「是经脉涨的」。
   *
   * 新实现：**按传统顺序**（任→督→冲→带→阴跷→阳跷→阴维→阳维）一条一条来，
   *    每次修炼**只积累进度**（必给，不掷骰），攒够阈值才通一级，
   *    并且**明说涨了多少**（上限构成见 vitalsBreakdown）。
   */
  tryAssaultMeridian(sd) {
    const md = this.meridians || (this.meridians = emptyMeridians());
    /* 当前该冲的那一条 = 顺序里第一条还没满的 */
    let idx = -1;
    for (let i = 0; i < MERIDIAN_ORDER.length; i++) {
      if ((md[MERIDIAN_ORDER[i]] || 0) < MERIDIAN_MAX) { idx = i; break; }
    }
    if (idx < 0) return null;                       // 八脉全通
    const k = MERIDIAN_ORDER[idx];
    const lv = md[k] || 0;
    const need = meridianNeed(lv);

    /* 每次修炼必给进度：悟性 + 内功修为 + 内力上限都算「根扎得深」 */
    const wis = this.attrTotal('悟性');
    const ngLv = this.learned[sd.id] ? this.skillLevel(sd.id) : 0;
    const gain = Math.max(3, Math.round(4 + wis * 0.8 + ngLv * 0.05 + (this.maxMp || 0) / 400));
    this.meridianExp = (this.meridianExp || 0) + gain;

    if (this.meridianExp < need) {
      /* 没通就不吭声（修炼结果里已经有一行字了），免得每次打坐刷一屏 */
      return null;
    }
    this.meridianExp -= need;
    md[k] = lv + 1;
    const before = { hp: this.maxHp, mp: this.maxMp };
    this.recalc();
    const dHp = this.maxHp - before.hp, dMp = this.maxMp - before.mp;
    const up = [];
    if (dHp) up.push('气血上限 +' + dHp);
    if (dMp) up.push('内力上限 +' + dMp);
    const tail = up.length ? '（' + up.join('、') + '）' : '';
    if (md[k] >= MERIDIAN_MAX) {
      return `内息一路冲过「${MERIDIAN_NAMES[k]}」最后一关 —— 这一脉**通了**！${tail}`;
    }
    return `内息沿「${MERIDIAN_NAMES[k]}」上行，通了一关（${md[k]}/${MERIDIAN_MAX}）。${tail}`;
  }

  /** 上限构成：把「底子 / 内功武学 / 奇经八脉 / 装备 / 其余（特质·状态）」拆开。
   *  为什么要有这个：主人报「初始 89，没走两步变 149」。涨是**该涨**的（内功升级 + 通脉），
   *  坏在**没有一处告诉玩家钱是从哪儿来的** —— 一个总数从 89 跳到 149，谁看都像 bug。
   *
   *  ⚠️ 数据来自 `recalc()` 里就地累加的 `_vitals` 台账，**不是**在这里重算一遍。
   *     以前这里是一份照抄 recalc 的公式，结果漏了 `mpBonus` / 特质 / buff 三处，
   *     拆解加起来 55、顶上写着 75 —— 玩家一算更觉得是 bug。公式只能有一份。 */
  vitalsBreakdown() {
    const t = this._vitals;
    if (!t) return null;
    const mk = (o, total) => ({
      base: o.base, skill: o.skill, meridian: o.meridian, equip: o.equip, other: o.other, total,
    });
    return { maxHp: mk(t.maxHp, this.maxHp), maxMp: mk(t.maxMp, this.maxMp) };
  }

  maxSkillLevelFor(sd) {
    const w = this.world;
    // 上限 = 基础 + 悟性/资质/等级 影响（SPRINT2：资质权重最高，弱化等级）
    if (sd.learnLimit) {
      try {
        const { evalTemplate } = require('./modapi');
        const v = parseInt(evalTemplate(String(sd.learnLimit), { player: this, world: w }), 10);
        if (!isNaN(v)) return v;
      } catch (e) { /* ignore */ }
    }
    const doorLimit = sd.maxLevel || 500;
    const wis = this.attrTotal('悟性');
    const apt = this.attrTotal('资质');
    const neigong = this.equippedSkills['内功'];
    const ngLv = neigong ? this.skillLevel(neigong) : 0;
    /* ⚠️ 2026-10-10 武学重制重标定：旧系数（wis*6+apt*9+ngLv*0.8）封顶只有几百，
       而基础武学 maxLevel 已抬到 1000 → 永远够不着「登峰造极」那档。
       新系数让凡人 240 起步、绝顶高手（悟性/资质 40+、内功千级）才摸到 1000。
       ⚠️ 2026-10-10 内力上限轴：再加一项「内力上限 × 0.08」——
         主人定的规矩是**内力关乎武学等级上限**，练内力就是把自己的天花板抬上去。
         吐纳一次只涨 1 点，但它是**唯一能一直涨**的那一项。 */
    const limit = Math.floor(wis * 10 + apt * 14 + ngLv * 1.2 + (this.maxMp || this.maxMpBase || 0) * mpRateFor(sd));
    return Math.min(doorLimit, Math.max(10, limit));
  }

  /* ---------------- 基础武学树（武学重制） ---------------- */

  /** 沿 base 链上溯到根（基础武学）；无 base 或数据缺失就返回自己 */
  skillRoot(skillId) {
    let cur = skillId, guard = 0;
    while (cur && guard++ < 16) {
      const sd = this.world.getSkill(cur);
      if (!sd || !sd.base) return cur;
      cur = sd.base;
    }
    return cur;
  }

  /** 这门武学是「散学」（不属任何基础武学系）吗 —— 判据是数据上的 standalone 标记 */
  isStandalone(sd) {
    if (!sd) return false;
    if (sd.standalone === true) return true;
    return false;
  }

  /**
   * 有效上限（武学重制核心公式，`design/40` §1.2）：
   *   effectiveMax = min( 门内硬顶 ∩ 资质/悟性/内功上限 , 基础武学练到几级 )
   * 主人的原话就是第三项：「基础武学练到什么级别，其他武学最多只能学到那个级别」。
   * ⚠️ 基础武学自己没有 base ⇒ 只受前两项管（这就是「把基础武学当梯子」的玩法核心）。
   */
  effectiveMax(sd) {
    if (!sd) return 0;
    const own = this.maxSkillLevelFor(sd);
    const baseId = sd.base;
    if (!baseId) return own;
    const b = this.learned[baseId];
    const blv = b ? (b.level || 0) : 0;
    return Math.min(own, Math.max(0, blv));
  }

  trainCost(sd, level) {
    const base = sd.trainCost || 100;
    return Math.floor(base * Math.pow(1.09, level - 1) * (sd.type === '内功' ? 1.4 : 1));
  }

  trainSuccessRate(sd, level) {
    const wis = this.attrTotal('悟性');
    const apt = this.attrTotal('资质');
    const dif = sd.difficulty || 1;
    // 资质越高练武越快（SPRINT2）
    let r = 0.8 + wis * 0.01 + apt * 0.008 - level * 0.004 * dif;
    return clamp(r, 0.05, 0.99);
  }

  gainSkillExp(skillId, exp) {
    const sd = this.world.getSkill(skillId);
    if (!sd || !this.learned[skillId]) return { ok: false, msg: '（未学过该武学）' };
    const s = this.learned[skillId];
    const maxLv = this.effectiveMax(sd);
    let leveled = 0;
    s.exp += exp;
    while (s.level < maxLv && s.exp >= this.skillExpNeed(s.level)) {
      s.exp -= this.skillExpNeed(s.level);
      s.level++;
      leveled++;
    }
    this.recalc();
    if (leveled > 0) return { ok: true, msg: `${sd.name} 提升到了 ${s.level} 级！`, level: s.level, leveled };
    return { ok: true, msg: `你的${sd.name}熟练度增加了${exp}点。` };
  }

  forgetSkill(skillId) {
    delete this.learned[skillId];
    for (const k of Object.keys(this.equippedSkills)) if (this.equippedSkills[k] === skillId) this.equippedSkills[k] = null;
    this.recalc();
  }

  /* ---------------- 等级 ---------------- */

  gainExp(exp) {
    // 功能 Mod 规则：经验倍率
    if (this.world && this.world.ruleMult) exp = Math.floor(exp * this.world.ruleMult('exp'));
    this.exp += exp;
    let up = 0;
    while (this.exp >= this.expNeed(this.level)) {
      this.exp -= this.expNeed(this.level);
      this.level++; up++;
      // 潜能已废除（2026-10-11）：升级不再发（那个数从来没处花）。
    }
    if (up) {
      this.hp = this.maxHp; this.mp = this.maxMp;
      if (this.isPlayer) this.world.emit('levelup', { level: this.level });
    }
    this.recalc();
    return up;
  }
  /* 潜能已废除（主人 2026-10-11：「潜能点有什么用？？？没用的话可以把这个删了」）。
     基础玩法里**所有产出与消耗都撤掉了**，状态面板与 score 也不再显示。
     但这个字段与方法**故意留着**：
       · 老存档里还带着 `potential`，删字段会让读档解析出 undefined；
       · Mod 接口（`+pot` / `get('pot')` / 制作器里的奖励字段）还挂着它，
         外部 Mod 可能拿它做自己的经济 —— 删掉会让那些 Mod 静默失效。
     所以这里是「对外删除、对内保留」：玩家再也见不到它，Mod 想用仍然能用。 */
  gainPotential(p) {
    // 功能 Mod 规则：潜能倍率
    if (this.world && this.world.ruleMult) p = Math.floor(p * this.world.ruleMult('pot'));
    this.potential = (this.potential || 0) + p;
  }

  /* ---------------- 物品 ---------------- */

  // 库存既可能是对象（{id,uid,count}）也可能是裸 id 字符串，统一归一化取 id
  _itemId(it) { return (it && typeof it === 'object') ? it.id : it; }
  countItem(itemId) {
    const inv = this.inventory || [];
    let n = 0;
    for (const i of inv) {
      const id = this._itemId(i);
      const cnt = (i && typeof i === 'object' && i.count) ? i.count : 1;
      const d = this.world.getItem(id);
      if (id === itemId || (d && d.stackKey === itemId)) n += cnt;
    }
    return n;
  }
  hasItem(itemId, n) { return this.countItem(itemId) >= (n || 1); }
  removeItem(itemId, n) {
    n = n || 1;
    let removed = 0;
    const inv = this.inventory || (this.inventory = []);
    for (let i = inv.length - 1; i >= 0 && removed < n; i--) {
      const id = this._itemId(inv[i]);
      if (id === itemId || (this.world.getItem(id) && this.world.getItem(id).stackKey === itemId)) {
        inv.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  /* ---------------- 标记 ---------------- */

  hasFlag(f) { return !!this.flags[f]; }
  setFlag(f, v) { if (v === false || v === undefined) delete this.flags[f]; else this.flags[f] = v; }
  getVar(k) { return this.vars[k]; }
  setVar(k, v) { this.vars[k] = v; }

  /* ---------------- 任务 ---------------- */

  questStage(qid) {
    const v = this.quests[qid];
    if (v === undefined) return this.hasFlag('questdone_' + qid) ? 99 : -1;
    return v;
  }
  setQuestStage(qid, st) {
    const prev = this.quests[qid];
    this.quests[qid] = st;
    if (st === 99) {
      this.setFlag('questdone_' + qid, true);
      /* 「江湖记得你」回声层（2026-10-18）：记下完成序 + 时刻，供 questecho
         做「近期优先」取样。只记首次完成（重入 99 不重复记）。
         ⚠️ 用的是玩家自身的 timeMinutes（advanceTime 每次推进都会写），
            不引入新的世界引用 —— setQuestStage 是角色方法，拿不到 world。 */
      if (prev !== 99) {
        this.vars = this.vars || {};
        const log = Array.isArray(this.vars.questDone) ? this.vars.questDone : (this.vars.questDone = []);
        log.push({ id: qid, at: this.timeMinutes || 0 });
        /* 只留最近 40 条 —— 老档玩上几百条时别让存档无限长 */
        if (log.length > 40) log.splice(0, log.length - 40);
      }
    }
  }

  /* ---------------- 门派 ---------------- */

  joinSect(sectId, opts) {
    const sd = this.world.getSect(sectId);
    if (!sd) return { ok: false, msg: '（无此门派）' };
    if (this.sect) return { ok: false, msg: `你已在${this.world.getSect(this.sect) ? this.world.getSect(this.sect).name : this.sect}门下，须先脱离。` };
    /* ⚠️ 引荐信的破例：出身决定的那家山门，有的带 karma / 性别 / 悟性门槛
       （大理想段氏要 karma≥20、少林不收女、桃花岛要悟性≥18）。
       新手线要把玩家导到自己那条线上，而他开局不满足这些条件 ——
       茶摊老汉那封引荐信就是拿来破例的（`tutorial.handOutLetter` 写 tutPass）。
       只对**他本人那一家**有效，拜别家照旧卡门槛。
       ⚠️ `opts.force` 是**收徒大典**那条路：大典存在的意义就是收「常例不收的人」，
          人家当面考过你了，还拿 require 卡一道就是自相矛盾。 */
    const referral = this.vars && this.vars.tutPass === sectId;
    const force = !!(opts && opts.force);
    if (sd.require && !referral && !force) {
      const { evalCond } = require('./modapi');
      /* ⚠️ 性别的两种写法在数据里混用：门派的 `require` 写 `'male'`，而 createPlayer
         存的是玩家在创建界面选的 `'男'`。直接比的结果是 **男的入不了只要男弟子的门派**
         ——本来是静的错（不报错，只是永远进不去），一直没被发现是因为新手线那封引荐信
         永远破例；自己上门、或者走收徒大典，就露馅了。
         这里造一个「性别已归一化」的影子玩家去判，**不动玩家身上的值**。 */
      const myG = normGender(this.gender);
      const probe = myG === this.gender ? this : Object.assign(Object.create(this), { gender: myG });
      const req = sd.require.gender
        ? Object.assign({}, sd.require, { gender: normGender(sd.require.gender) })
        : sd.require;
      if (!evalCond(req, { player: probe, world: this.world })) return { ok: false, msg: this.sectRefusal(sd) };
    }
    this.sect = sectId; this.rank = 0;
    if (sd.entryItems) for (const it of sd.entryItems) this.world.giveItem(this, it, 1);
    if (sd.entrySkills) for (const s of sd.entrySkills) this.learnSkill(s, { force: true });
    if (referral && this.vars) { this.vars.tutPass = null; this.vars.tutJoined = sectId; }
    this.world.emit('joinsect', { sect: sectId });
    return {
      ok: true,
      msg: `你拜入${sd.name}门下，成为一名${sd.ranks ? sd.ranks[0] : '弟子'}。`
        + (referral ? '（凭那封引荐信，山门为你破了例。）' : ''),
    };
  }
  /**
   * 被山门拒了，得说清楚**卡在哪一条** ——
   * 主人原话：「如果不成功会告诉你哪里不成功…比如是否需要学某个功法，以及告诉你该功法在哪获取」。
   * 一句「不收你这样的弟子」等于什么都没说，玩家只能挨个试。
   */
  sectRefusal(sd) {
    const req = (sd && sd.require) || {};
    const miss = [];
    for (const k of Object.keys(req)) {
      const v = req[k];
      if (k === 'gender') {
        if (normGender(this.gender || 'male') !== normGender(v)) miss.push(`本门只收${v === 'female' ? '女' : '男'}儿身`);
      } else if (k === 'karma') {
        const mine = Math.round(this.karma || 0);
        if (mine < v) miss.push(`要侠名 ${v}（你 ${mine}）——多行善事、少结仇，名声是攒出来的`);
      } else if (k === 'wis' || k === '悟性') {
        const mine = this.attrTotal('悟性');
        if (mine < v) miss.push(`要悟性 ${v}（你 ${mine}）——读书、访名师、住得好些都能养`);
      } else if (k === 'skill' || k === 'skills' || k === 'learned') {
        const lack = [].concat(v).filter(s => !this.learned[s]);
        if (lack.length) {
          const names = lack.map(s => (this.world.getSkill(s) || {}).name || s);
          miss.push(`须先学会${names.join('、')}（${names.map(n => this.skillSource(n)).join('；')}）`);
        }
      } else if (typeof v === 'number' && (this[k] || 0) < v) {
        miss.push(`${k} 需 ${v}（你 ${this[k] || 0}）`);
      }
    }
    if (!miss.length) return `${sd.name}不收你这样的弟子。`;
    return `${sd.name}不收你：${miss.join('；')}。`;
  }

  /** 这门功夫去哪儿学（哪个山门入门就授 / 哪家有） */
  skillSource(nameOrId) {
    const hits = [];
    for (const sd of Object.values(this.world.data.sects || {})) {
      const all = [].concat(sd.entrySkills || [], sd.skills || [], sd.rankSkills ? Object.values(sd.rankSkills).flat() : []);
      if (all.includes(nameOrId)) hits.push(sd.name);
    }
    if (hits.length) return `入${hits.slice(0, 3).join(' / ')}可得`;
    return '藏经阁里兴许有抄本';
  }

  leaveSect() {
    const old = this.sect;
    this.sect = null; this.rank = 0; this.sectContribution = 0;
    this.world.emit('leavesect', { sect: old });
    return { ok: true, msg: '你脱下门派服饰，从此江湖飘零。' };
  }
  promote() {
    const sd = this.world.getSect(this.sect);
    if (!sd || !sd.ranks) return { ok: false, msg: '你没有门派。' };
    if (this.rank >= sd.ranks.length - 1) return { ok: false, msg: '你已身居高位，无法再升。' };
    const need = (sd.rankCost || 500) * (this.rank + 1);
    if (this.sectContribution < need) return { ok: false, msg: `你的门派贡献不足（需 ${need}，你有 ${this.sectContribution}）。` };
    this.sectContribution -= need;
    this.rank++;
    if (sd.rankSkills && sd.rankSkills[this.rank]) for (const s of sd.rankSkills[this.rank]) this.learnSkill(s, { force: true });
    return { ok: true, msg: `你被擢升为${sd.ranks[this.rank]}！` };
  }

  /* ---------------- 状态 ---------------- */

  addBuff(buff) {
    const b = Object.assign({ name: '状态', turns: 5, mods: {}, tag: null }, buff);
    // 同 tag 覆盖
    if (b.tag) this.buffs = this.buffs.filter(x => x.tag !== b.tag);
    this.buffs.push(b);
    this.recalc();
    return b;
  }
  removeBuff(name) { this.buffs = this.buffs.filter(b => b.name !== name && b.tag !== name); this.recalc(); }
  hasBuff(name) { return this.buffs.some(b => b.name === name || b.tag === name); }

  /* ---------------- 时间 ---------------- */

  /** 推进时间（转发给 world） */
  advanceTime(min) {
    if (this.world && this.world.advanceTime) this.world.advanceTime(min);
  }

  /* ---------------- 基本信息 ---------------- */

  revive() {
    this.dead = false;
    this.hp = Math.floor(this.maxHp * 0.3);
    this.mp = Math.floor(this.maxMp * 0.3);
    this.buffs = [];
    this.recalc();
  }

  timeText() {
    const t = fmtTime(this.timeMinutes);
    return `${t.text} · ${shichen(this.timeMinutes)}`;
  }
  goldText() {
    const g = Math.floor(this.money / 10000), s = Math.floor((this.money % 10000) / 100), c = this.money % 100;
    let out = [];
    if (g) out.push(`${g}两黄金`);
    if (s) out.push(`${s}两白银`);
    if (c || !out.length) out.push(`${c}文铜钱`);
    return out.join('');
  }
  weaponSkill() {
    const wk = this.equippedSkills['武器'] || this.equippedSkills['剑'];
    return wk || null;
  }
  toJSON() {
    const o = {};
    for (const k of Object.keys(this)) {
      if (k === 'world' || k === 'combatTarget') continue;
      if (typeof this[k] === 'function') continue;
      o[k] = this[k];
    }
    return o;
  }
}

module.exports = {
  Character, BASE_ATTRS, SLOT_ROOT, STANDALONE_MAX,
  PROF_TIERS, profTierIndex, profTierOf, profTierMult, profTierAcc, profTierName,
  MERIDIAN_NAMES, MERIDIAN_MAX, MERIDIAN_ORDER, meridianNeed, emptyMeridians,
  /* 功法刻度（界面与测试都要读）*/
  needMpOf, mpRateFor, GRADE_MP_RATE, NEED_MP_BY_GRADE,
};
