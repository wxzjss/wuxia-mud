/* ============================================================
 * marriage.js —— 婚姻 / 结缘引擎（第二批核心）
 *
 * 概念区分：
 *   明媒正娶（marry）—— 玩家唯一的正妻/正夫，要办酒席
 *   妾（concubine）  —— 有正妻后还能纳，礼数简薄
 *   结缘（bond）     —— 高好感、无伴侣即可，不必办酒席。
 *                      可为同性，但年龄须 < 45。不占「正妻」位。
 *
 * 婚礼流程（state machine）：
 *   propose  → 提亲（要聘礼/要好感门槛）
 *   prepare  → 择日、选场地（酒楼 / 自家）
 *   feast    → 酒席（宾客到场、加好感、收祝福）
 *   consummate → 入洞房（需去双方之一的家中）
 *   done     → 礼成
 *
 * 场地：
 *   酒店办 → 花钱多、加好感多
 *   家里办 → 花钱少、加好感少
 *   前提：双方至少一人有家园
 * ============================================================ */
const social = require('./social');
/* B11：性别名词单一入口（男/女/不明），别再 `female?'女':'男'`（other 会落成「男」） */
const { genderNoun } = require('./pronouns');

const REL_KIND = '夫妻';
const BOND_KIND = '结缘';

/* 婚礼阶段 */
const STAGES = {
  NONE: 'none',
  PROPOSE: 'propose',
  PREPARE: 'prepare',
  FEAST: 'feast',
  CONSUMMATE: 'consummate',
  DONE: 'done',
};

/* 场地花费与好感系数 */
const VENUE = {
  hall:  { id: 'hall',  name: '酒楼办席', money: 2000, favorMul: 1.0, guestCap: 24 },
  home:  { id: 'home',  name: '家中办席', money: 300,  favorMul: 0.5, guestCap: 10 },
};

/* ============================================================
 * 一、基础查询
 * ============================================================ */

/** 取 NPC 实例（优先活实例，退回模板） */
function npcOf(world, idOrName) {
  if (!idOrName) return null;
  const inst = world.instances && world.instances.npcs[world.resolveNpcId ? world.resolveNpcId(idOrName) : idOrName];
  if (inst) return inst;
  /* 从当前房间找 */
  const p = world.player;
  if (p) {
    const here = world.npcsIncludingTemplates(p.room) || [];
    const hit = here.find(n => n.id === idOrName || n.name === idOrName || n.defId === idOrName);
    if (hit) return hit;
  }
  /* 退回模板 */
  const def = world.data.npcs[idOrName];
  if (def) return Object.assign({}, def, { def, id: idOrName });
  return null;
}

/** 玩家的婚姻状况（放在 player.marriage 上） */
function status(world) {
  const p = world.player;
  if (!p) return null;
  if (!p.marriage) p.marriage = { spouse: null, concubines: [], bonds: [], stage: STAGES.NONE, plan: null };
  const m = p.marriage;
  if (!m.concubines) m.concubines = [];
  if (!m.bonds) m.bonds = [];
  return m;
}

/** NPC 是否已婚 / 有主 */
function npcTaken(world, npc) {
  if (!npc) return true;
  if (npc.spouse) return true;                       /* 实例上标了伴侣 */
  const def = npcDef(world, npc) || {};
  return !!(def && def.spouse);
}

/**
 * 取「模板 id」。
 * 实例 id（npc_xxx）是临时编号，despawn 后就查不到了 —— 跨场景引用一律用它。
 * 三种入参都要认：字符串 / 实例对象 / 模板对象。
 */
function defIdOf(world, npc) {
  if (!npc) return null;
  if (typeof npc === 'string') {
    /* 是模板 id 就直接返回；是实例 id 就查一下 */
    if (world.data.npcs[npc]) return npc;
    const inst = social.findInst(world, npc);
    return inst ? inst.defId : npc;
  }
  if (npc.defId) return npc.defId;
  /* 模板对象：world.data.npcs 里有它就说明是模板 */
  if (npc.id && world.data.npcs[npc.id] === npc) return npc.id;
  if (npc.def && npc.def.id) return npc.def.id;
  if (npc.id && world.data.npcs[npc.id]) return npc.id;   /* 模板的浅拷贝 */
  return npc.id || null;
}

/** 按「模板 id」取模板（找不到返回 null） */
function defById(world, defId) {
  if (!defId) return null;
  return (world.data && world.data.npcs && world.data.npcs[defId]) || null;
}

/**
 * 取 NPC 的「定义对象」（模板）。
 *
 * ⚠️ 大坑：模板上的 `def` 字段是**防御力数值**（比如 70），不是定义对象！
 *    只有实例上的 `def` 才是定义对象。所以绝不能用 `npc.def ||` 判断，
 *    必须检查它是不是对象 —— 否则拿到 70，后面全线崩。
 */
function npcDef(world, npc) {
  if (!npc) return null;
  if (npc.def && typeof npc.def === 'object') return npc.def;
  const defId = defIdOf(world, npc);
  return (defId && world.data.npcs && world.data.npcs[defId]) || null;
}

/** 按模板 id 取「当前活的实例」（可能不在场，返回 null） */
function instById(world, defId) {
  /* 统一走 social 的查找口径（实例 id / 模板 id 都认） */
  return social.findInst(world, defId);
}

/** 性别文本（走 pronouns 单一入口，other 不再冒充「男」） */
function gCN(g) { return genderNoun({ gender: g }); }

/* ============================================================
 * 二、资格判定
 * ============================================================ */

/** 能不能跟这个人办正婚（明媒正娶）。
 *  返回 { ok, reason } —— reason 是给玩家看的人话。 */
function canMarry(world, npc) {
  const p = world.player;
  const m = status(world);
  if (!p || !npc) return { ok: false, reason: '找不到这人。' };

  const def = npcDef(world, npc) || {};
  const name = npc.name;

  if (npc.id === p.id) return { ok: false, reason: '你不能跟自己成亲。' };
  if (!def.socialDone && !npc.socialDone) return { ok: false, reason: `${name}并不通人情世故。` };
  if (def.hostile || npc.hostile) return { ok: false, reason: `${name}与你势同水火，谈何婚嫁。` };
  if (npc.dead) return { ok: false, reason: `${name}已经不在人世。` };

  /* 性别：传统婚配需异性（同性走结缘） */
  if ((npc.gender || 'male') === (p.gender || 'male')) {
    return { ok: false, reason: `你与${name}同为${gCN(p.gender)}子，正婚于礼不合。若两情相悦，可用「结缘」。` };
  }

  /* 年龄：太小不行 */
  const age = npc.age || def.age || 0;
  if (age && age < 15) return { ok: false, reason: `${name}还只有 ${age} 岁，年纪太小。` };

  /* 已有正妻 */
  if (m.spouse) {
    const sp = world.data.npcs[m.spouse] || {};
    return { ok: false, reason: `你已有正室${sp.name || ''}。若要再娶，只能纳妾（用「纳妾」）。` };
  }
  if (npcTaken(world, npc)) {
    return { ok: false, reason: `${name}已有婚配。` };
  }

  /* 好感门槛：正婚最难刷，要「亲密」档以上 */
  const need = marryFavorNeed(world, npc);
  if ((npc.favor || 0) < need) {
    return { ok: false, reason: `${name}对你的好感（${npc.favor || 0}）还不够（需 ${need}）。` };
  }

  /* 双方至少一人有家 */
  const pHome = p.home || null;
  const nHome = def.home || npc.home || null;
  if (!pHome && !nHome) {
    return { ok: false, reason: `你们二人皆无片瓦遮身，成了亲也无处安身。先去官府买处宅子吧。` };
  }

  return { ok: true, reason: '' };
}

/** 正婚所需好感：与 NPC 身份挂钩（官老爷/侠客更难） */
function marryFavorNeed(world, npc) {
  const def = npcDef(world, npc) || {};
  const base = 90;
  const hard = { official: 1.5, richman: 1.4, swordsman: 1.2, escort: 1.15, judge: 1.6, noble: 1.35 };
  const easy = { farmer: 0.75, hunter: 0.8, boatman: 0.8, fisherman: 0.75, weaver: 0.8, waiter: 0.7, waiter2: 0.7, woodman: 0.8, servant: 0.7, maid: 0.7, herdsman: 0.8 };
  const mul = hard[def.tag] || easy[def.tag] || 1;
  return Math.round(base * mul);
}

/** 能不能纳妾 */
function canConcubine(world, npc) {
  const p = world.player;
  const m = status(world);
  if (!p || !npc) return { ok: false, reason: '找不到这人。' };
  const def = npcDef(world, npc) || {};
  const name = npc.name;

  if (!m.spouse) return { ok: false, reason: '你尚未娶正室，何谈纳妾。' };
  if ((npc.gender || 'male') === (p.gender || 'male')) {
    return { ok: false, reason: `${gCN(p.gender)}子之身，纳不得${gCN(p.gender)}子为妾。` };
  }
  if (npcTaken(world, npc)) return { ok: false, reason: `${name}已有婚配。` };
  if (npc.dead) return { ok: false, reason: `${name}已经不在人世。` };
  const age = npc.age || def.age || 0;
  if (age && age < 15) return { ok: false, reason: `${name}年纪太小。` };
  if (m.concubines.includes(npc.id)) return { ok: false, reason: `${name}已是你的妾室。` };

  const need = Math.round(marryFavorNeed(world, npc) * 0.8);
  if ((npc.favor || 0) < need) {
    return { ok: false, reason: `${name}对你的好感（${npc.favor || 0}）还差些（需 ${need}）。` };
  }
  return { ok: true, reason: '' };
}

/** 能不能结缘（不限婚配，可同性，年龄 < 45） */
function canBond(world, npc) {
  const p = world.player;
  const m = status(world);
  if (!p || !npc) return { ok: false, reason: '找不到这人。' };
  const def = npcDef(world, npc) || {};
  const name = npc.name;

  if (npcTaken(world, npc)) return { ok: false, reason: `${name}已有伴侣。` };
  if (m.bonds.includes(npc.id)) return { ok: false, reason: `你与${name}已结缘。` };
  if (npc.dead) return { ok: false, reason: `${name}已经不在人世。` };

  const age = npc.age || def.age || 0;
  if (age >= 45) return { ok: false, reason: `${name}已 ${age} 岁，过了结缘的年纪（须不满 45）。` };
  if (age && age < 15) return { ok: false, reason: `${name}年纪太小。` };

  const need = bondFavorNeed(world, npc);
  if ((npc.favor || 0) < need) {
    return { ok: false, reason: `${name}对你的好感（${npc.favor || 0}）还不够（需 ${need}）。` };
  }
  return { ok: true, reason: '' };
}

function bondFavorNeed(world, npc) {
  const def = npcDef(world, npc) || {};
  const base = 70;
  const mul = { official: 1.4, judge: 1.5, richman: 1.3, noble: 1.25 }[def.tag] ||
              { farmer: 0.8, waiter: 0.75, waiter2: 0.75, servant: 0.75, maid: 0.75, fisherman: 0.8 }[def.tag] || 1;
  return Math.round(base * mul);
}

/* ============================================================
 * 三、确立关系（改 npc 与 player 的字段 + 建「夫妻」关系边）
 * ============================================================ */

/** 把两人写成夫妻（双向），并在 rel 里挂一条「夫妻」 */
function linkSpouse(world, npcId, name) {
  const p = world.player;
  /* npcId 传进来的可能是实例 id —— 统一转成模板 id */
  const defId = defIdOf(world, npcId) || npcId;
  const def = world.data.npcs[defId];
  if (!def) return;
  const pname = name || (p ? p.name : '你');

  /* NPC 模板：标 spouse */
  def.spouse = 'player';
  def.spouseName = pname;
  if (!def.rel) def.rel = [];
  if (!def.rel.some(r => r.id === 'player')) def.rel.push({ id: 'player', kind: REL_KIND, name: pname });

  /* 活实例也标一份（否则当前会话里查不到） */
  const inst = instById(world, defId);
  if (inst) {
    inst.spouse = 'player';
    inst.spouseName = pname;
    if (!inst.rel) inst.rel = [];
    if (!inst.rel.some(r => r.id === 'player')) inst.rel.push({ id: 'player', kind: REL_KIND, name: pname });
  }

  /* 玩家的配偶 */
  if (p) {
    const m = status(world);
    m.spouse = defId;
    if (!p.rel) p.rel = [];
    const i = p.rel.findIndex(r => r.id === defId);
    if (i >= 0) p.rel[i] = { id: defId, kind: REL_KIND, name: def.name };
    else p.rel.push({ id: defId, kind: REL_KIND, name: def.name });
  }
}

/** 结缘（比夫妻轻，不办酒席） */
function linkBond(world, npcId) {
  const p = world.player;
  const m = status(world);
  const defId = defIdOf(world, npcId) || npcId;
  if (!m.bonds.includes(defId)) m.bonds.push(defId);

  const def = world.data.npcs[defId];
  if (def) {
    if (!def.rel) def.rel = [];
    if (!def.rel.some(r => r.id === 'player')) def.rel.push({ id: 'player', kind: BOND_KIND, name: p ? p.name : '你' });
    def.bonded = true;
  }
  const inst = instById(world, defId);
  if (inst) {
    inst.bonded = true;
    if (!inst.rel) inst.rel = [];
    if (!inst.rel.some(r => r.id === 'player')) inst.rel.push({ id: 'player', kind: BOND_KIND, name: p ? p.name : '你' });
  }
  if (p) {
    if (!p.rel) p.rel = [];
    const i = p.rel.findIndex(r => r.id === defId);
    const nm = def ? def.name : defId;
    if (i >= 0) p.rel[i] = { id: defId, kind: BOND_KIND, name: nm };
    else p.rel.push({ id: defId, kind: BOND_KIND, name: nm });
  }
}

/**
 * 全江湖的人会知道你「是谁的对象」 —— 给所有认识该 NPC 的人打标记。
 * 判定「认识」的口径：
 *   ① 双方 rel 里有彼此
 *   ② 同住一个区域（街坊邻居）
 *   ③ 同一身份圈子（同为 courtesan / yamen 等）—— 只算近邻职业
 * 但排除：玩家自己、该 NPC 本人。
 */
function spreadBond(world, npcId, playerName) {
  const defId = defIdOf(world, npcId) || npcId;
  const def = world.data.npcs[defId];
  if (!def) return 0;
  const partner = def.name;
  const myRegion = def.home ? ((world.getRoom(def.home) || {}).region) : null;
  const touched = [];
  for (const id of Object.keys(world.data.npcs)) {
    const o = world.data.npcs[id];
    if (id === defId) continue;
    if (o.dead) continue;
    const knows =
      (o.rel || []).some(r => r.id === defId) ||
      (def.rel || []).some(r => r.id === id) ||
      (myRegion && o.home && ((world.getRoom(o.home) || {}).region) === myRegion);
    if (!knows) continue;
    o.knows_player_of = partner;
    touched.push(id);
    const inst = instById(world, id);
    if (inst) inst.knows_player_of = partner;
  }
  return touched.length;
}

/* ============================================================
 * 四、聘礼与花费
 * ============================================================ */

/** 提亲聘礼：按 NPC 身价与身份 */
function betrothalGift(world, npc) {
  const def = npcDef(world, npc) || {};
  const hard = { official: 1.8, judge: 2.0, richman: 1.9, noble: 1.7, swordsman: 1.3, escort: 1.25 };
  const mul = hard[def.tag] || 1;
  return Math.round(600 * mul);
}

/** 酒席花费 */
function feastCost(world, venueId) {
  return (VENUE[venueId] || VENUE.home).money;
}

/* ============================================================
 * 五、婚礼状态机
 * ============================================================ */

/** 提亲：扣聘礼，进入 prepare 阶段 */
function propose(world, npc, venueId) {
  const c = canMarry(world, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };

  const p = world.player;
  const m = status(world);
  const gift = betrothalGift(world, npc);
  const venue = VENUE[venueId] || VENUE.home;
  const total = gift + venue.money;

  if (p.money < total) {
    return { ok: false, lines: [
      { kind: 'warn', text: `聘礼需 ${gift} 文，${venue.name}另需 ${venue.money} 文，共 ${total} 文。你身上只有 ${p.money} 文。` }] };
  }

  p.money -= total;
  m.stage = STAGES.PREPARE;
  m.plan = {
    /* ⚠ npc = 模板 id（defId），不是实例 id。
       实例会在玩家离开房间时 despawn，婚礼跨场景，必须用模板 id 查得到人。 */
    npc: defIdOf(world, npc),
    instId: npc.id || null,
    name: npc.name, venue: venue.id, venueName: venue.name,
    gift, cost: venue.money, total, guests: [], invited: [], blessings: 0,
  };

  const r = social.addFavor(world, npc, 15, '提亲');
  return { ok: true, plan: m.plan, lines: [
    { kind: 'story', text: `你备下聘礼，郑重向${npc.name}提亲。` },
    ...r.lines,
    { kind: 'sys', text: `聘礼 ${gift} 文、${venue.name} 花销 ${venue.money} 文，共花去 ${total} 文。` },
    { kind: 'hint', text: `吉日已定。发「请客」邀亲友，发「办酒」正式开席。` },
  ] };
}

/** 自动邀请：双方的好友亲人必到，其次拉街坊邻里凑个人气 */
function autoGuestList(world, npc) {
  const defId = defIdOf(world, npc);
  const def = npcDef(world, npc) || defById(world, defId) || {};
  const out = [];
  const add = (id, why) => {
    if (!id || id === defId || id === 'player') return;
    const o = defById(world, id);
    if (!o || o.dead) return;
    if (out.some(x => x.id === id)) return;
    out.push({ id, name: o.name, why });
  };

  /* ① 他的亲友（rel 表） */
  for (const r of (def.rel || [])) {
    if (r.kind === '仇') continue;
    add(r.id, r.kind === '亲' ? '亲人' : r.kind === '师' ? '师长' : r.kind === '生' ? '门生' : '朋友');
  }
  /* ② 玩家自己的关系（亲友、义亲都算） */
  const p = world.player;
  for (const r of ((p && p.rel) || [])) {
    if (r.kind === '仇' || r.kind === REL_KIND || r.kind === BOND_KIND || r.kind === '妾') continue;
    const why = /义/.test(r.kind) ? r.kind : (r.kind === '亲' ? '你的亲人' : r.kind === '师' ? '你的师长' : '你的朋友');
    add(r.id, why);
  }
  /* ③ 街坊邻里 —— 同区域的人来凑热闹（真实江湖就该这么热闹）
        没亲友的人也不至于冷场；按好感从高到低取，最多 12 个。 */
  const myRegion = def.home ? ((world.getRoom(def.home) || {}).region) : null;
  if (myRegion) {
    const neigh = [];
    for (const id of Object.keys(world.data.npcs)) {
      const o = world.data.npcs[id];
      if (!o || o.dead || id === defId) continue;
      if (out.some(x => x.id === id)) continue;
      if (!o.home) continue;
      const r2 = world.getRoom(o.home);
      if (!r2 || r2.region !== myRegion) continue;
      neigh.push({ id, name: o.name, favor: favorOf(world, id) });
    }
    neigh.sort((a, b) => b.favor - a.favor);
    for (const n of neigh.slice(0, 12)) add(n.id, '街坊');
  }
  return out;
}

/** 请客：自动邀请 + 玩家点名邀请（需一定好感） */
function invite(world, npcId) {
  const m = status(world);
  if (m.stage !== STAGES.PREPARE && m.stage !== STAGES.FEAST) {
    return { ok: false, lines: [{ kind: 'warn', text: '你尚在议亲，还没到请客的时候。' }] };
  }
  const defId = defIdOf(world, npcId) || npcId;
  const npc = world.data.npcs[defId];
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '查无此人。' }] };
  if (m.plan.invited.includes(defId)) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}已在宾客之列。` }] };
  }
  const need = inviteFavorNeed(world, defId);
  const fav = favorOf(world, defId);
  if (fav < need) {
    return { ok: false, lines: [
      { kind: 'warn', text: `${npc.name}与你交情尚浅（好感 ${fav}，需 ${need}），未必肯来。` }] };
  }
  m.plan.invited.push(defId);
  return { ok: true, lines: [
    { kind: 'story', text: `你亲自登门，请${npc.name}来喝喜酒。` },
    { kind: 'sys', text: `${npc.name}应下了。` }] };
}

function inviteFavorNeed(world, npcId) {
  const def = world.data.npcs[npcId] || {};
  const base = 30;
  const mul = { official: 1.6, judge: 1.8, richman: 1.5, noble: 1.4 }[def.tag] ||
              { farmer: 0.7, waiter: 0.7, waiter2: 0.7, servant: 0.7, maid: 0.7, beggar: 0.5 }[def.tag] || 1;
  return Math.round(base * mul);
}

/** 取 NPC 好感（活实例优先）—— 统一走 social，避免两处口径不一致 */
function favorOf(world, npcId) {
  return social.favorOf(world, npcId);
}

/** 办酒席：宾客到场 → 全体加好感 → 收祝福 */
function holdFeast(world) {
  const m = status(world);
  if (m.stage !== STAGES.PREPARE) {
    return { ok: false, lines: [{ kind: 'warn', text: '你还没有定下亲事，办什么酒。' }] };
  }
  const plan = m.plan;
  const npc = defById(world, plan.npc);
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '你的意中人不见了。' }] };

  const venue = VENUE[plan.venue] || VENUE.home;

  /* 宾客 = 自动邀请 + 点名邀请，最多 venue.guestCap */
  const auto = autoGuestList(world, npc);
  const list = [];
  for (const g of auto) { if (list.length >= venue.guestCap) break; list.push(g); }
  for (const id of plan.invited) {
    if (list.length >= venue.guestCap) break;
    const o = defById(world, id);
    if (o && !list.some(x => x.id === id)) list.push({ id, name: o.name, why: '你请的' });
  }

  const lines = [{ kind: 'title', text: `【 ${venue.name} 】` }];
  lines.push({ kind: 'story', text: `锣鼓响起来，红烛点起来。${venue.id === 'hall' ? '酒楼里摆开流水席，热闹得半条街都听得见。' : '你家中收拾出一间堂屋，贴了喜字，虽不阔绰，倒也融融。'}` });

  /* 全体宾客加好感 */
  let gained = 0;
  for (const g of list) {
    const r = social.addFavorTo(world, g.id, venue.favorMul * 12, '赴宴');
    gained += r.delta;
  }
  /* 新人加好感（家里办加得少） */
  const rSp = social.addFavorTo(world, plan.npc, venue.favorMul * 45, '成亲');
  gained += rSp.delta;

  lines.push({ kind: 'sys', text: `到场宾客 ${list.length} 位，人人沾了喜气。` });
  if (list.length) lines.push({ kind: 'plain', text: '　' + list.map(g => g.name + '（' + g.why + '）').join('　') });
  const spFav = favorOf(world, plan.npc);
  if (rSp.delta > 0) lines.push({ kind: 'favor', text: `　${npc.name} 对你的好感 +${rSp.delta}`, delta: rSp.delta });
  else lines.push({ kind: 'favor', text: `　${npc.name} 对你的情意已深（好感 ${spFav}），无需再多言。`, favor: spFav });

  plan.guests = list;
  m.stage = STAGES.CONSUMMATE;
  lines.push({ kind: 'hint', text: '酒席散了，该回房了 —— 去你们任何一人的家中，发「入洞房」。' });
  return { ok: true, guests: list, lines };
}

/** 入洞房（收祝福 + 正式确立） */
function consummate(world) {
  const m = status(world);
  if (m.stage !== STAGES.CONSUMMATE) {
    return { ok: false, lines: [{ kind: 'warn', text: '还没拜堂，入什么洞房。' }] };
  }
  const p = world.player;
  const plan = m.plan;
  const npc = defById(world, plan.npc);
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '你的意中人不见了。' }] };

  /* 必须在双方之一的家中 */
  const room = world.getRoom(p.room);
  const isHome = room && (room.owner === plan.npc || room.id === npc.home || room.owner === 'player' || p.home === room.id);
  if (!isHome) {
    return { ok: false, lines: [
      { kind: 'warn', text: '洞房得在自家屋里。回你或他/她的家，再来。' },
      { kind: 'hint', text: `（${npc.name}的家：${(world.getRoom(npc.home) || {}).name || '某处'}）` }] };
  }

  linkSpouse(world, plan.npc, p.name);
  m.stage = STAGES.DONE;
  m.plan = null;

  /* 收祝福 */
  const bless = [];
  for (const g of (plan.guests || [])) {
    const o = world.data.npcs[g.id];
    if (!o) continue;
    bless.push(o.name);
    social.addFavorTo(world, g.id, 4, '贺喜');
  }

  const lines = [
    { kind: 'title', text: '【 礼 成 】' },
    { kind: 'story', text: `红烛高照，你与${npc.name}对拜成礼，从此结为夫妻。` },
  ];
  if (bless.length) {
    lines.push({ kind: 'subtitle', text: '众人道贺' });
    for (const b of bless.slice(0, 12)) lines.push({ kind: 'plain', text: `　${b}：「白头偕老，早生贵子！」` });
  }
  lines.push({ kind: 'favor', text: `　${npc.name} 从此是你的正室。`, favor: favorOf(world, plan.npc) });
  const nHomeName = (world.getRoom(npc.home) || {}).name;
  if (nHomeName) lines.push({ kind: 'hint', text: `（婚后你可自由出入${npc.name}的家：${nHomeName}）` });
  return { ok: true, lines };
}

/** 纳妾：礼数简薄，直接确立 */
function takeConcubine(world, npc) {
  const c = canConcubine(world, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };
  const p = world.player;
  const m = status(world);
  const cost = Math.round(betrothalGift(world, npc) * 0.5);
  if (p.money < cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `纳妾需 ${cost} 文置办，你身上不够。` }] };
  }
  p.money -= cost;
  const defId = defIdOf(world, npc) || npc.id;
  m.concubines.push(defId);
  const def = world.data.npcs[defId];
  if (def) {
    def.isConcubine = true;
    def.spouse = 'player_sp';
    def.spouseName = p.name;
    if (!def.rel) def.rel = [];
    if (!def.rel.some(r => r.id === 'player')) def.rel.push({ id: 'player', kind: '妾', name: p.name });
  }
  const inst = instById(world, defId);
  if (inst) { inst.isConcubine = true; inst.spouse = 'player_sp'; inst.spouseName = p.name; }
  const r = social.addFavorTo(world, defId, 20, '纳为妾室');
  return { ok: true, lines: [
    { kind: 'story', text: `你以 ${cost} 文置办妆奁，迎${npc.name}入府为妾。` },
    ...r.lines,
    { kind: 'hint', text: '（妾室的居所随你安排，日后可去她/他家走动。）' },
  ] };
}

/** 结缘：不办酒席，两情相悦即可 */
function makeBond(world, npc) {
  const c = canBond(world, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };
  const p = world.player;
  const defId = defIdOf(world, npc) || npc.id;
  linkBond(world, defId);
  const r = social.addFavorTo(world, defId, 25, '结缘');
  const touched = spreadBond(world, defId, p.name);
  const def = npcDef(world, { defId }) || {};
  const nm = def.name || npc.name;
  return { ok: true, lines: [
    { kind: 'story', text: `月下三杯酒，你与${nm}结为连理之好。` },
    ...r.lines,
    { kind: 'sys', text: touched ? `${touched} 位相识之人，从此都知道你是${nm}的人了。` : '此事尚无人知晓。' },
    { kind: 'hint', text: '（结缘不限男女，也不占正室之位。日后仍可明媒正娶。）' },
  ] };
}

/* ============================================================
 * 六、给玩家看的摘要 / 列表
 * ============================================================ */

function summary(world) {
  const m = status(world);
  const p = world.player;
  const out = { stage: m.stage || STAGES.NONE, spouse: null, concubines: [], bonds: [], plan: m.plan || null };
  if (m.spouse) {
    const d = world.data.npcs[m.spouse];
    out.spouse = d ? { id: m.spouse, name: d.name, gender: d.gender, age: d.age, home: d.home, homeName: (world.getRoom(d.home) || {}).name } : null;
  }
  for (const id of m.concubines) {
    const d = world.data.npcs[id];
    if (d) out.concubines.push({ id, name: d.name, gender: d.gender, age: d.age });
  }
  for (const id of m.bonds) {
    const d = world.data.npcs[id];
    if (d) out.bonds.push({ id, name: d.name, gender: d.gender, age: d.age });
  }
  return out;
}

/** 候选名单：当前房间里能娶/能纳/能结缘的人 */
function candidates(world, kind) {
  const p = world.player;
  if (!p) return [];
  const out = [];
  for (const n of (world.npcsIncludingTemplates(p.room) || [])) {
    const d = npcDef(world, n) || {};
    if (!n.isNpc || !d.socialDone) continue;
    const c = kind === 'marry' ? canMarry(world, n) : kind === 'concubine' ? canConcubine(world, n) : canBond(world, n);
    out.push({
      id: n.id, defId: n.defId, name: n.name, ok: c.ok, reason: c.reason,
      gender: n.gender, age: n.age || d.age || 0,
      favor: social.favorOf(world, n.id),
    });
  }
  return out;
}

/** NPC 在不在「在场的活实例」里（用于判定该不该显示实例 id） */
function liveInstId(world, defId) {
  const inst = instById(world, defId);
  return inst ? inst.id : null;
}

module.exports = {
  REL_KIND, BOND_KIND, STAGES, VENUE,
  npcOf, status, canMarry, canConcubine, canBond,
  marryFavorNeed, bondFavorNeed, inviteFavorNeed, betrothalGift, feastCost,
  propose, invite, holdFeast, consummate, takeConcubine, makeBond,
  autoGuestList, summary, candidates, npcTaken, favorOf,
  defIdOf, defById, instById, liveInstId, npcDef, linkSpouse, linkBond, spreadBond,
};
