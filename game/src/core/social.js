/* ============================================================
 * social.js — 江湖社交引擎（好感 / 送礼 / 请教 / 偷窃 / 关系）
 *
 * 设计原则：
 *   1. 所有 NPC 的状态（好感 / 关系 / 财物）存在 NPC 实例上，
 *      随存档一起走（world.serialize 已含 instances.npcs）。
 *   2. 好感区间统一为 -200 ~ 300，分档：死敌/冷淡/平常/友善/亲密/知己
 *   3. 送礼判定顺序：喜爱类型 > 品质加成 > 基础好感
 *   4. 请教：好感达标 OR 花钱；好感越高，教得越快
 *   5. 偷窃：成功率 = 身法/等级差/对方警觉，失败 → 通缉
 * ============================================================ */

/* B11：第三人称代词单一入口（兽→它 / 女→她 / 男→他），别再各处写死「他」 */
const { pronounOf } = require('./pronouns');

/* ---------------- 喜爱物类型 ---------------- */
/* tag 用于匹配物品自带的 tags 数组；cn 用于按名称兜底匹配 */
const LIKE_TYPES = [
  { id: 'painting', cn: '名画', tag: 'painting', bonus: 1.0 },
  { id: 'porcelain', cn: '瓷器', tag: 'porcelain', bonus: 1.0 },
  { id: 'book', cn: '书籍', tag: 'book', bonus: 0.9 },
  { id: 'jade', cn: '玉器', tag: 'jade', bonus: 1.0 },
  { id: 'wine', cn: '美酒', tag: 'wine', bonus: 0.8 },
  { id: 'tea', cn: '好茶', tag: 'tea', bonus: 0.8 },
  { id: 'jewelry', cn: '首饰', tag: 'jewelry', bonus: 1.0 },
  { id: 'incense', cn: '香料', tag: 'incense', bonus: 0.7 },
  { id: 'weapon', cn: '兵刃', tag: 'weapon', bonus: 0.9 },
  { id: 'herb', cn: '药材', tag: 'herb', bonus: 0.8 },
  { id: 'food', cn: '吃食', tag: 'food', bonus: 0.6 },
  { id: 'music', cn: '乐器', tag: 'music', bonus: 0.9 },
  { id: 'toy', cn: '玩物', tag: 'toy', bonus: 0.6 },
  { id: 'makeup', cn: '胭脂', tag: 'makeup', bonus: 0.8 },
];

/* ---------------- 好感分档 ---------------- */
const FAVOR_TIERS = [
  { min: -200, max: -60, name: '死敌', color: '#7a1f1f', cn: '见你就来气' },
  { min: -60, max: -15, name: '冷淡', color: '#8a6a4a', cn: '对你不冷不热' },
  { min: -15, max: 20, name: '平常', color: '#6a6a6a', cn: '对你不熟' },
  { min: 20, max: 60, name: '友善', color: '#2f7a4a', cn: '待你颇为和气' },
  { min: 60, max: 120, name: '亲密', color: '#1f6f9a', cn: '把你当自己人' },
  { min: 120, max: 300, name: '知己', color: '#8a5ac2', cn: '愿为你两肋插刀' },
];

function favorTier(v) {
  v = v || 0;
  for (const t of FAVOR_TIERS) if (v >= t.min && v < t.max) return t;
  return v < FAVOR_TIERS[0].min ? FAVOR_TIERS[0] : FAVOR_TIERS[FAVOR_TIERS.length - 1];
}

function clampFavor(v) {
  return Math.max(-200, Math.min(300, Math.round(v || 0)));
}

/* ---------------- 物品品质 ---------------- */
/* 优先读物品自带的 quality；没有就按价格推断 */
const QUALITY_TIERS = [
  { id: 'worn', name: '粗劣', color: '#7a7a7a', mult: 0.6 },
  { id: 'common', name: '寻常', color: '#9a9a9a', mult: 1.0 },
  { id: 'fine', name: '精良', color: '#2f7a4a', mult: 1.5 },
  { id: 'rare', name: '珍稀', color: '#1f6f9a', mult: 2.2 },
  { id: 'epic', name: '绝世', color: '#8a5ac2', mult: 3.2 },
  { id: 'legend', name: '传说', color: '#b8860b', mult: 4.5 },
];
const QUALITY_MAP = {};
for (const q of QUALITY_TIERS) QUALITY_MAP[q.id] = q;
/* 中文名也能查 */
for (const q of QUALITY_TIERS) QUALITY_MAP[q.name] = q;

/**
 * 取物品品质。优先级：item.quality(英文 id) > item.qualityName > 按价值推断
 * 用价值推断的档位：<50 粗劣 / <200 寻常 / <800 精良 / <2500 珍稀 / <8000 绝世 / 否则传说
 */
function itemQuality(world, itemId) {
  const it = world.getItem(itemId);
  if (!it) return QUALITY_MAP.common;
  if (it.quality && QUALITY_MAP[it.quality]) return QUALITY_MAP[it.quality];
  if (it.qualityName && QUALITY_MAP[it.qualityName]) return QUALITY_MAP[it.qualityName];
  const v = it.value || 10;
  if (v < 50) return QUALITY_MAP.worn;
  if (v < 200) return QUALITY_MAP.common;
  if (v < 800) return QUALITY_MAP.fine;
  if (v < 2500) return QUALITY_MAP.rare;
  if (v < 8000) return QUALITY_MAP.epic;
  return QUALITY_MAP.legend;
}

/** 品质等级序号，用于「谁比谁强」的比较 */
function qualityRank(world, itemId) {
  const q = itemQuality(world, itemId);
  return QUALITY_TIERS.findIndex(t => t.id === q.id);
}

/* ---------------- 武学「强度」评估 ---------------- */
/**
 * 一门武学的综合强度。用于 NPC 判断「你的功法比我强吗」。
 * 强度 = 基础属性 * (1 + 等级/500) * 品质系数
 */
function skillPower(world, skillId, level) {
  const sd = world.getSkill(skillId);
  if (!sd) return 0;
  const base =
    (sd.damageMult || 1) * 40 +
    (sd.accuracy || 80) * 0.4 +
    (sd.maxLevel || 200) * 0.15 +
    ((sd.effects || []).length) * 12;
  const lv = level || (sd.maxLevel ? sd.maxLevel * 0.3 : 60);
  const q = QUALITY_MAP[sd.quality] || inferSkillQuality(world, sd);
  return Math.round(base * (1 + lv / 500) * q.mult);
}

function inferSkillQuality(world, sd) {
  const mx = sd.maxLevel || 300;
  if (mx >= 600) return QUALITY_MAP.legend;
  if (mx >= 450) return QUALITY_MAP.epic;
  if (mx >= 300) return QUALITY_MAP.rare;
  if (mx >= 200) return QUALITY_MAP.fine;
  if (mx >= 120) return QUALITY_MAP.common;
  return QUALITY_MAP.worn;
}

/** NPC 在某门功夫上的最高强度（同类型里最强的） */
function npcBestSkillPower(world, npc, type) {
  let best = 0, bestId = null;
  for (const sid of Object.keys(npc.learned || {})) {
    const sd = world.getSkill(sid);
    if (!sd) continue;
    if (type && sd.type !== type) continue;
    const p = skillPower(world, sid, (npc.learned[sid] || {}).level);
    if (p > best) { best = p; bestId = sid; }
  }
  return { power: best, skillId: bestId };
}

/* ---------------- 好感变动 ---------------- */
/**
 * 改好感（统一入口，带难度系数、上下限、飘字）
 * @returns {{delta:number, favor:number, tier:object, lines:Array}}
 */
function addFavor(world, npc, delta, reason) {
  const p = world.player;
  const base = npc.favorBase === undefined ? 1 : npc.favorBase;
  /* favorBase > 1 表示好刷（乞丐/小孩），< 1 表示难刷（官老爷） */
  const real = delta * (delta > 0 ? base : (2 - base));
  const oldFavor = npc.favor || 0;
  const oldTier = favorTier(oldFavor);
  npc.favor = clampFavor(oldFavor + real);
  const newTier = favorTier(npc.favor);

  const lines = [];
  const shown = Math.round(npc.favor - oldFavor);
  if (shown !== 0) {
    lines.push({
      kind: 'favor',
      text: `${npc.name} 对你的好感 ${shown > 0 ? '+' : ''}${shown}（${npc.favor}）`,
      delta: shown, favor: npc.favor, tier: newTier.name,
    });
  }
  if (oldTier.name !== newTier.name) {
    lines.push({
      kind: 'story',
      text: `${npc.name}对你的态度变成了「${newTier.name}」——${newTier.cn}。`,
      tier: newTier.name, color: newTier.color,
    });
  }
  return { delta: Math.round(npc.favor - oldFavor), favor: npc.favor, tier: newTier, lines };
}

/** 当前好感是否达到门槛 */
function favorOk(npc, need) {
  return (npc.favor || 0) >= (need === undefined ? 0 : need);
}

/**
 * 按 npcId 改好感（活实例优先，退回模板）。
 *
 * ⚠️ npcId 既可能是「实例 id」(npc_xxx)，也可能是「模板 id」(npcv_xxx)。
 *    两步都试：先按实例 id 直查，再扫一遍实例表比对 defId。
 *
 * marriage.js 的「酒席全体宾客加好感」「收祝福」都走这里 —— 因为酒席上的人
 * 不一定在当前房间，拿不到活实例；而且那批人可能根本没被 spawn 过。
 * 退回模板时必须同时写 def.favor，下次 spawnNpc 才会带出来。
 *
 * @returns {{delta:number, favor:number, tier:object, lines:Array, name:string, instanced:boolean}}
 */
function addFavorTo(world, npcId, delta, reason) {
  const empty = { delta: 0, favor: 0, tier: favorTier(0), lines: [], name: '', instanced: false };
  if (!npcId || npcId === 'player' || String(npcId).indexOf('player') === 0) return empty;

  /* ① 活实例优先 —— 玩家眼前这个 NPC 的状态必须立刻变 */
  const inst = findInst(world, npcId);
  if (inst) {
    const r = addFavor(world, inst, delta, reason);
    /* 顺手把好感回写模板：这个 NPC 一走一回来，别把好感丢了 */
    const def0 = world.data && world.data.npcs && world.data.npcs[inst.defId];
    if (def0) def0.favor = inst.favor;
    r.name = inst.name;
    r.instanced = true;
    return r;
  }

  /* ② 退回模板 */
  const def = world.data && world.data.npcs && world.data.npcs[npcId];
  if (!def) return empty;

  const base = def.favorBase === undefined ? 1 : def.favorBase;
  const real = delta * (delta > 0 ? base : (2 - base));
  const oldFavor = def.favor === undefined ? (def.favorInit || 0) : def.favor;
  const oldTier = favorTier(oldFavor);
  def.favor = clampFavor(oldFavor + real);
  const newTier = favorTier(def.favor);

  const lines = [];
  const shown = Math.round(def.favor - oldFavor);
  if (shown !== 0) {
    lines.push({
      kind: 'favor',
      text: `${def.name} 对你的好感 ${shown > 0 ? '+' : ''}${shown}（${def.favor}）`,
      delta: shown, favor: def.favor, tier: newTier.name,
    });
  }
  if (oldTier.name !== newTier.name) {
    lines.push({
      kind: 'story',
      text: `${def.name}对你的态度变成了「${newTier.name}」——${newTier.cn}。`,
      tier: newTier.name, color: newTier.color,
    });
  }
  return { delta: shown, favor: def.favor, tier: newTier, lines, name: def.name, instanced: false };
}

/** 找活实例：先按实例 id，再按模板 id 扫 */
function findInst(world, npcId) {
  if (!world.instances || !world.instances.npcs) return null;
  const direct = world.instances.npcs[npcId];
  if (direct) return direct;
  for (const k of Object.keys(world.instances.npcs)) {
    if (world.instances.npcs[k].defId === npcId) return world.instances.npcs[k];
  }
  return null;
}

/** 读某人当前好感（实例优先，退回模板）——UI 和判定都用它 */
function favorOf(world, npcId) {
  if (!npcId) return 0;
  const inst = findInst(world, npcId);
  if (inst) return inst.favor || 0;
  const def = world.data && world.data.npcs && world.data.npcs[npcId];
  if (!def) return 0;
  return def.favor === undefined ? (def.favorInit || 0) : def.favor;
}

/* ============================================================
 * 送礼
 * ============================================================ */
/**
 * 判定一件物品送给某 NPC 的好感加成
 * 规则：
 *   - 命中 likes（喜爱类型）→ 大加（基础值 * 1.0 倍 + 品质加成）
 *   - 未命中但价值高     → 小加
 *   - 价格极低（<10）    → 可能不加甚至略减（「这是打发叫花子？」）
 */
function giftValue(world, npc, itemId) {
  const it = world.getItem(itemId);
  if (!it) return { favor: 0, matched: false, text: `这东西${pronounOf(npc)}怕是看不上眼。` };

  const q = itemQuality(world, itemId);
  const likes = npc.def ? (npc.def.likes || []) : (npc.likes || []);

  /* 判断这件物品属于哪些喜爱类型 */
  let matchedType = null;
  for (const lid of likes) {
    const lt = LIKE_TYPES.find(x => x.id === lid);
    if (!lt) continue;
    if (lt.tag && (it.tags || []).includes(lt.tag)) { matchedType = lt; break; }
    if (it.name && lt.cn && it.name.includes(lt.cn.replace('好', '').replace('美', ''))) { matchedType = lt; break; }
    if (it.likeType === lid) { matchedType = lt; break; }
  }

  const price = it.value || 10;
  let favor;

  /* ⚠ 先判「寒酸」再判「喜爱」：
     一块 3 文钱的馒头就算是他的心头好，送出手也是打发叫花子，
     但若真合口味，至少不至于扣分。 */
  if (price < 15 && !matchedType) {
    return {
      favor: -2, matched: false, quality: q,
      text: `${npc.name}接过${it.name}，脸上掠过一丝古怪：「……这就不必了。」`,
    };
  }

  if (matchedType) {
    /* 投其所好：基础 12 + 品质加成 + 价格微调 */
    favor = (12 + q.mult * 6 + Math.min(price / 200, 6)) * (matchedType.bonus || 1);
    /* 合口味但极廉价 → 减半 */
    if (price < 15) favor = Math.max(1, favor * 0.4);
  } else if (price < 30) {
    favor = 1;
  } else {
    favor = 2 + q.mult * 2.2 + Math.min(price / 400, 4);
  }

  return {
    favor: Math.round(favor),
    matched: !!matchedType,
    likeName: matchedType ? matchedType.cn : null,
    quality: q,
    text: matchedType
      ? `${npc.name}眼睛一亮——原来${pronounOf(npc)}素来喜爱${matchedType.cn}！`
      : `${npc.name}道了声谢，收下了${it.name}。`,
  };
}

/* ============================================================
 * 请教武学
 * ============================================================ */
/** 该 NPC 能教的武学列表（已换算强度与好感门槛） */
function teachList(world, npc) {
  const def = npc.def || {};
  const out = [];
  const ids = new Set([].concat(def.teach || []));
  /* 也会教自己会的（若允许） */
  if (def.canTeach !== false && !def.teach) {
    for (const sid of Object.keys(npc.learned || {})) ids.add(sid);
  }
  for (const sid of ids) {
    const sd = world.getSkill(sid);
    if (!sd) continue;
    if (npc.learned && !npc.learned[sid] && !(def.teach || []).includes(sid)) continue;
    const lv = npc.learned && npc.learned[sid] ? npc.learned[sid].level : (npc.level || 20) * 6;
    out.push({
      id: sid,
      name: sd.name,
      type: sd.type,
      level: lv,
      power: skillPower(world, sid, lv),
      quality: (QUALITY_MAP[sd.quality] || inferSkillQuality(world, sd)).name,
      favorNeed: favorNeedFor(world, npc, sid),
      money: canBuyTeach(npc) ? teachPrice(world, npc, sid) : 0,
      known: !!(world.player && world.player.learned[sid]),
    });
  }
  out.sort((a, b) => a.power - b.power);
  return out;
}

/** 学某门功夫需要的好感 */
function favorNeedFor(world, npc, skillId) {
  const def = npc.def || {};
  const base = def.favorToLearn !== undefined ? def.favorToLearn : 50;
  const sd = world.getSkill(skillId);
  if (!sd) return base;
  /* 越强的功夫门槛越高 */
  const q = QUALITY_MAP[sd.quality] || inferSkillQuality(world, sd);
  return Math.round(base * (0.6 + q.mult * 0.4));
}

/** 这门功夫能不能花钱学 */
function canBuyTeach(npc) {
  const def = npc.def || {};
  return def.moneyToLearn !== undefined && def.moneyToLearn > 0;
}

/** 学某门功夫的花费 */
function teachPrice(world, npc, skillId) {
  const def = npc.def || {};
  const base = def.moneyToLearn || 0;
  if (!base) return 0;
  const sd = world.getSkill(skillId);
  if (!sd) return base;
  const q = QUALITY_MAP[sd.quality] || inferSkillQuality(world, sd);
  return Math.round(base * q.mult / 10) * 10;
}

/* ============================================================
 * 偷窃
 * ============================================================ */
/**
 * 偷窃判定
 * @returns {{ok:boolean, caught:boolean, chance:number, lines:Array, loot:Array}}
 */
function trySteal(world, npc, which) {
  const p = world.player;
  const def = npc.def || {};
  const carry = npc.carry || def.carry || { money: 0, items: [] };
  const lines = [];

  /* 目标物 */
  let targetItem = null, targetMoney = 0;
  if (which === 'money' || !which) {
    targetMoney = carry.money || 0;
  }
  if (which && which !== 'money') {
    targetItem = (carry.items || []).find(x => x === which) || null;
    if (!targetItem) return { ok: false, caught: false, chance: 0, loot: [], lines: [{ kind: 'warn', text: `${npc.name}身上似乎没有那样东西。` }] };
  }
  if (!targetItem && !targetMoney) {
    return { ok: false, caught: false, chance: 0, loot: [], lines: [{ kind: 'warn', text: `${npc.name}身上空空如也。` }] };
  }

  /* 成功率：自身等级高 → 高；对方等级高、好感高（警觉）→ 低 */
  const myLv = p.level || 1;
  const hisLv = npc.level || 1;
  const dodge = (p.attr && p.attr.身法) || 10;
  let chance = 0.45 + (myLv - hisLv) * 0.012 + (dodge - 10) * 0.006;
  /* 对方好感越低越提防你 */
  chance -= Math.max(0, (npc.favor || 0)) * 0.0009;
  /* 官差 / 镖师 / 侠客 警觉高 */
  if (['constable', 'escort', 'swordsman', 'thief'].includes(def.tag)) chance -= 0.12;
  chance = Math.max(0.03, Math.min(0.92, chance));

  const roll = world.rng.next();
  const ok = roll < chance;

  if (ok) {
    const loot = [];
    if (targetItem) {
      /* 从对方 carry 拿掉，进自己背包 */
      carry.items = (carry.items || []).filter(x => x !== targetItem);
      npc.carry = carry;
      world.giveItem(p, targetItem, 1);
      const it = world.getItem(targetItem);
      loot.push(it ? it.name : targetItem);
      lines.push({ kind: 'sys', text: `你不动声色地从${npc.name}身上摸走了${it ? it.name : targetItem}。` });
    } else {
      const got = Math.min(targetMoney, carry.money || 0);
      carry.money = (carry.money || 0) - got;
      npc.carry = carry;
      p.money += got;
      loot.push(got + ' 文钱');
      lines.push({ kind: 'sys', text: `你趁${npc.name}不备，摸走了${pronounOf(npc)}怀里的 ${got} 文钱。` });
    }
    /* 偷成功也掉一点好感（若被发现痕迹） */
    lines.push({ kind: 'hint', text: `（偷窃成功，未被察觉。成功率 ${(chance * 100).toFixed(0)}%）` });
    return { ok: true, caught: false, chance, loot, lines };
  }

  /* 失败 → 被发现 */
  lines.push({ kind: 'warn', text: `你刚碰到${npc.name}的衣角，就被${pronounOf(npc)}一把攥住了手腕！` });
  const r = addFavor(world, npc, -25, '偷窃被抓');
  lines.push(...r.lines);
  require('./personality').addMood(npc, -20); // 被偷窃 → 恼怒
  world.emitStealCaught(npc);
  return { ok: false, caught: true, chance, loot: [], lines };
}

module.exports = {
  LIKE_TYPES,
  FAVOR_TIERS, favorTier, clampFavor, addFavor, favorOk,
  addFavorTo, favorOf, findInst,
  QUALITY_TIERS, QUALITY_MAP, itemQuality, qualityRank,
  skillPower, inferSkillQuality, npcBestSkillPower,
  giftValue, teachList, favorNeedFor, canBuyTeach, teachPrice,
  trySteal,
};
