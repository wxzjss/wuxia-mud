/* ==========================================================================
 * modfields.js — Mod / 外部数据的**字段归一化**（单一入口）
 *
 * 为什么需要它：
 *   游戏本体的 `10_skills.json` 里 `type` 用的是**中文槽位名**
 *   （拳/剑/刀/棍/鞭/暗器/内功/轻功/招架/身法），`categories` 用**五大类**
 *   （外功/内功/奇门/旁门/魔功）。
 *   而官方示例 mod（`mods/demo_skill/mod.json`）与 mod 制作器的兜底下拉
 *   写的是**英文**（sword / force / dodge）—— 玩家照着示例写出来的 mod，
 *   武学**装不上任何槽位**：`enable <武学>` 会报
 *   「没有「sword」这个槽位」，武学面板还会冒出一个叫「sword」的分类。
 *   这是本项目最爱的一类病：**口径不一致 → 静默/半静默失效**。
 *
 * 为什么不改示例 mod 了事：
 *   示例只是「其中一份」；线上模组站里已经有玩家上传的 mod，第三方教程也抄了
 *   英文写法。**在入口做归一化**（本项目铁律：字段对齐靠归一化入口）才能一次覆盖
 *   「示例 + 玩家存量 + 以后照抄的人」，而且中文写法原样通过，零副作用。
 *
 * 幂等：跑 N 遍结果一样（中文 type 不动、已有 category 不动）。
 * ========================================================================== */
'use strict';

/** 武学 type：英文/别名 → 中文槽位名（与 `character.js` 的 equippedSkills 键一一对应） */
const TYPE_ALIAS = {
  /* 拳脚 */
  fist: '拳', fist_skill: '拳', unarmed: '拳', hand: '拳', punch: '拳', boxing: '拳', 拳法: '拳', 拳脚: '拳',
  /* 剑 */
  sword: '剑', swordplay: '剑', jianshu: '剑', 剑法: '剑',
  /* 刀 */
  blade: '刀', saber: '刀', knife: '刀', dao: '刀', 刀法: '刀',
  /* 棍 */
  staff: '棍', club: '棍', pole: '棍', gun: '棍', 棍法: '棍',
  /* 鞭 */
  whip: '鞭', chain: '鞭', whip_skill: '鞭', 鞭法: '鞭',
  /* 暗器 */
  hidden: '暗器', hidden_weapon: '暗器', throwing: '暗器', dart: '暗器', projectile: '暗器', 投掷: '暗器',
  /* 内功 */
  force: '内功', internal: '内功', internal_skill: '内功', neigong: '内功', qi: '内功', 心法: '内功', 内家: '内功',
  /* 轻功 */
  dodge: '轻功', lightness: '轻功', qinggong: '轻功', movement: '轻功', 身法轻功: '轻功',
  /* 招架 */
  parry: '招架', block: '招架', defense: '招架', defence: '招架', 格挡: '招架',
  /* 身法 */
  body: '身法', agility: '身法', footwork: '身法', shenfa: '身法',
};

/** 五大类：按槽位推默认分类（只有没写 category 时才填） */
const CATEGORY_BY_TYPE = {
  拳: '外功', 剑: '外功', 刀: '外功', 棍: '外功', 鞭: '外功', 暗器: '外功',
  内功: '内功', 轻功: '内功', 招架: '内功', 身法: '内功',
};
const CATEGORIES = ['外功', '内功', '奇门', '旁门', '魔功'];
/** 五大类的旧写法/英文别名 */
const CATEGORY_ALIAS = {
  external: '外功', waigong: '外功', physical: '外功',
  internal: '内功', neigong: '内功', qi: '内功',
  qimen: '奇门', exotic: '奇门',
  pornmen: '旁门', side: '旁门', pangmen: '旁门',
  demon: '魔功', evil: '魔功', devil: '魔功', mogong: '魔功',
};

/* ==========================================================================
 * 装备槽位（item.slot）—— 和武学 type 一模一样的病，只是没人治过
 *
 * 实测（2026-10-10）：`items[].slot` 的取值分布是
 *   { 身体:7, 武器:16, 披风:1, 头部:2, 脚部:2, 颈部:1, 戒指:1, 饰品:4, 兵刃:2,
 *     weapon:1, body:1, feet:1 }   ← 最后三个英文的来自**官方示例 mod**（demo_item）
 * ⇒ 小白照抄示例写出来的装备会落进 `weapon`/`body`/`feet` 三个**幽灵槽位**：
 *   穿得上（因为槽位是自由字符串），但**和本体装备互不冲突**，
 *   等于凭空多出三个装位 —— 而且**不报错**。
 * 归一化放在这里（而不是去改示例）：示例只是其中一份，第三方 mod 与教程都抄过英文写法。
 * ========================================================================== */
const ITEM_SLOT_ALIAS = {
  weapon: '武器', arms: '武器', sword: '武器', blade: '兵刃', weapon_skill: '武器',
  body: '身体', armor: '身体', armour: '身体', robe: '身体', torso: '身体',
  head: '头部', helmet: '头部', hat: '头部',
  feet: '脚部', boots: '脚部', shoes: '脚部', foot: '脚部',
  neck: '颈部', necklace: '颈部', amulet: '颈部',
  ring: '戒指', finger: '戒指',
  cloak: '披风', cape: '披风', back: '披风',
  accessory: '饰品', trinket: '饰品', charm: '饰品',
  hand: '手部', gloves: '手部',
  waist: '腰部', belt: '腰部',
};
/** 归一化一个装备槽位（认不出就原样返回 —— 自定义槽位是允许的） */
function normItemSlot(s) {
  const raw = String(s == null ? '' : s).trim();
  if (!raw) return raw;
  if (ITEM_SLOT_ALIAS[raw]) return ITEM_SLOT_ALIAS[raw];
  const low = raw.toLowerCase();
  if (ITEM_SLOT_ALIAS[low]) return ITEM_SLOT_ALIAS[low];
  return raw;
}

/* ==========================================================================
 * 武学 `bonus` 的键名别名
 *
 * 实测：官方示例 mod（demo_skill）写 `bonus: {hp:6, mp:10}`，而引擎
 * （`character.js` 的「武学加成」段）只认 `maxHp / maxMp / atk / def / critRate`
 * —— 写 `hp`/`mp` 的结果是**这条加成完全不生效，且不报错**（经典的「只定义不消费」）。
 * 这里把常见别名折成引擎真认的键，省得每个 mod 作者都踩一次。
 * ========================================================================== */
const BONUS_ALIAS = {
  hp: 'maxHp', health: 'maxHp', maxhp: 'maxHp', life: 'maxHp',
  mp: 'maxMp', mana: 'maxMp', maxmp: 'maxMp', qi: 'maxMp',
  damage: 'atk', attack: 'atk', ap: 'atk',
  defense: 'def', defence: 'def', armor: 'def', armour: 'def',
  evade: 'dodge', evasion: 'dodge', dodgeRate: 'dodge',
  block: 'parry', parryRate: 'parry',
  speed: 'speed', agi: 'speed',
  crit: 'critRate', critrate: 'critRate',
  critdmg: 'critDmg',
  armorpen: 'armorPen',
};
/** 归一化一个 bonus 键（认不出就原样返回） */
function normBonusKey(k) {
  const raw = String(k == null ? '' : k).trim();
  if (!raw) return raw;
  if (BONUS_ALIAS[raw]) return BONUS_ALIAS[raw];
  const low = raw.toLowerCase();
  if (BONUS_ALIAS[low]) return BONUS_ALIAS[low];
  return raw;
}

/** 归一化一个 type（认不出就原样返回） */
function normSkillType(t) {
  const raw = String(t == null ? '' : t).trim();
  if (!raw) return raw;
  if (TYPE_ALIAS[raw]) return TYPE_ALIAS[raw];
  const low = raw.toLowerCase();
  if (TYPE_ALIAS[low]) return TYPE_ALIAS[low];
  return raw;             /* 已经是中文槽位名或自定义槽位 → 不动 */
}

function normCategory(c, type) {
  const raw = String(c == null ? '' : c).trim();
  if (CATEGORIES.indexOf(raw) >= 0) return raw;
  if (raw && CATEGORY_ALIAS[raw.toLowerCase()]) return CATEGORY_ALIAS[raw.toLowerCase()];
  if (raw && CATEGORY_ALIAS[raw]) return CATEGORY_ALIAS[raw];
  return CATEGORY_BY_TYPE[type] || '外功';
}

/**
 * 就地归一化整份 World 数据（幂等）。
 * @returns {{changed:number, notes:string[]}} 改了多少条、改了哪些（供启动日志/测试断言）
 */
function normalizeWorldData(data) {
  const notes = [];
  let changed = 0;
  if (!data || typeof data !== 'object') return { changed, notes };

  /* ---- 功法 ---- */
  const skills = data.skills || {};
  for (const id of Object.keys(skills)) {
    const s = skills[id];
    if (!s || typeof s !== 'object') continue;
    if (!s.id) s.id = id;

    const t0 = s.type;
    const t1 = normSkillType(t0);
    if (t1 !== t0) {
      s.type = t1;
      changed++;
      if (notes.length < 40) notes.push(`skills.${id}.type ${JSON.stringify(t0)} → ${t1}`);
    }
    const c0 = s.category;
    const c1 = normCategory(c0, t1);
    if (c1 !== c0) {
      s.category = c1;
      changed++;
      if (notes.length < 40 && !c0) notes.push(`skills.${id}.category 缺省 → ${c1}`);
    }
    if (!s.quality) { s.quality = 'common'; changed++; }
    /* maxLevel 缺省 = 本体的默认值（300）；写死一个小值会让玩家的功法莫名其妙练满 */
    if (s.maxLevel == null || !isFinite(Number(s.maxLevel)) || Number(s.maxLevel) <= 0) {
      s.maxLevel = 300;
      changed++;
    }
    if (s.difficulty == null) s.difficulty = 1;
    if (s.mpCost == null) s.mpCost = 0;
    if (s.accuracy == null) s.accuracy = 0;
    if (s.damageMult == null) s.damageMult = 1;

    /* bonus 的键名（hp → maxHp 之类）——写错就是「加成不生效且不报错」 */
    if (s.bonus && typeof s.bonus === 'object' && !Array.isArray(s.bonus)) {
      const bo = {};
      let hit = false;
      for (const bk of Object.keys(s.bonus)) {
        const bk1 = normBonusKey(bk);
        bo[bk1] = s.bonus[bk];
        if (bk1 !== bk) { hit = true; if (notes.length < 40) notes.push(`skills.${id}.bonus 键 ${bk} → ${bk1}`); }
      }
      if (hit) { s.bonus = bo; changed++; }
    }
  }

  /* ---- 物品：装备槽位（英文 weapon/body/feet → 武器/身体/脚部） ---- */
  const items = data.items || {};
  for (const id of Object.keys(items)) {
    const it = items[id];
    if (!it || typeof it !== 'object') continue;
    if (!it.id) it.id = id;
    const s0 = it.slot;
    const s1 = normItemSlot(s0);
    if (s1 !== s0) {
      it.slot = s1;
      changed++;
      if (notes.length < 40) notes.push(`items.${id}.slot ${JSON.stringify(s0)} → ${s1}`);
    }
  }

  /* ---- 门派：`skills` 槽位表里的 type 也要认（mod 常在这里配门派功法） ---- */
  const sects = data.sects || {};
  for (const id of Object.keys(sects)) {
    const sec = sects[id];
    if (!sec || typeof sec !== 'object') continue;
    if (sec.id == null) sec.id = id;
    if (sec.skills && typeof sec.skills === 'object' && !Array.isArray(sec.skills)) {
      const out = {};
      for (const k of Object.keys(sec.skills)) {
        const k1 = normSkillType(k);
        out[k1] = sec.skills[k];
        if (k1 !== k) { changed++; if (notes.length < 40) notes.push(`sects.${id}.skills 键 ${k} → ${k1}`); }
      }
      sec.skills = out;
    }
  }

  /* ---- NPC：挂的武学槽位（mod 的 demo_npc 常直接写英文槽位） ---- */
  const npcs = data.npcs || {};
  for (const id of Object.keys(npcs)) {
    const n = npcs[id];
    if (!n || typeof n !== 'object') continue;
    if (!n.id) n.id = id;
    if (n.skills && typeof n.skills === 'object' && !Array.isArray(n.skills)) {
      const out = {};
      for (const k of Object.keys(n.skills)) {
        const k1 = normSkillType(k);
        out[k1] = n.skills[k];
        if (k1 !== k) { changed++; if (notes.length < 40) notes.push(`npcs.${id}.skills 键 ${k} → ${k1}`); }
      }
      n.skills = out;
    }
  }

  return { changed, notes };
}

module.exports = {
  normalizeWorldData, normSkillType, normCategory, TYPE_ALIAS, CATEGORIES,
  normItemSlot, normBonusKey, ITEM_SLOT_ALIAS, BONUS_ALIAS,
};
