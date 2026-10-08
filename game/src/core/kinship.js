/* ============================================================
 * kinship.js —— 结拜 / 义亲系统（第二批）
 *
 * 三类关系：
 *   ① 义亲（干亲）—— 义父 / 义母 / 义子 / 义女
 *        看年龄差 ≥ 15 岁。谁大谁是父/母，谁小谁是子/女。
 *        同性也能结（义父-义子是常见的），异性也能结（义父-义女）。
 *   ② 义兄弟 / 义姐妹 —— 年龄差 < 15 岁，同性之间
 *        按年龄排长幼：义兄/义弟（男男）、义姐/义妹（女女）
 *   ③ 异性结拜（义兄妹）—— 年龄差 < 15 岁，异性之间
 *        男大女小 → 义兄 / 义妹；女大男小 → 义姐 / 义弟
 *
 * 与婚姻的关系：
 *   - 结拜不占配偶位，可同时有配偶。
 *   - 但**正在议亲/已成亲的人不能结拜**（防伦理混乱）。
 *   - 血缘实际关系（rel.kind === '亲'）的人不能再结拜。
 *
 * 数据落点：
 *   player.kinship = { father:[], mother:[], sons:[], daughters:[],
 *                      brothers:[], sisters:[], sworn:[] }
 *   npc.kin = [{ id, kind }]       —— NPC 侧（kind: 义父/义子/义兄…）
 * ============================================================ */
const social = require('./social');

/* 结拜类型元数据 */
const KINDS = {
  father:    { id: 'father',    cn: '义父',   rev: 'son',       who: 'self-younger', minGap: 15, gender: 'male' },
  mother:    { id: 'mother',    cn: '义母',   rev: 'daughter',  who: 'self-younger', minGap: 15, gender: 'female' },
  son:       { id: 'son',       cn: '义子',   rev: 'father',    who: 'self-older',   minGap: 15, gender: 'male' },
  daughter:  { id: 'daughter',  cn: '义女',   rev: 'mother',    who: 'self-older',   minGap: 15, gender: 'female' },
  brother:   { id: 'brother',   cn: '义兄',   rev: 'brother',   who: 'peer',         minGap: 0,  gender: 'male' },
  sister:    { id: 'sister',    cn: '义姐',   rev: 'sister',    who: 'peer',         minGap: 0,  gender: 'female' },
};

/* 反向称呼表：我眼中的他 / 他眼中的我 */
const REVERSE = {
  father:   { male: 'son',    female: 'daughter' },   /* 我认他作义父 → 他看我是义子/义女 */
  mother:   { male: 'son',    female: 'daughter' },
  son:      { male: 'father', female: 'mother' },     /* 我认他作义子 → 他看我是义父/义母 */
  daughter: { male: 'father', female: 'mother' },
  brother:  { male: 'brother', female: 'sister' },
  sister:   { male: 'brother', female: 'sister' },
};

/* 玩家侧槽位 */
const SLOTS = {
  father: 'father', mother: 'mother',
  son: 'sons', daughter: 'daughters',
  brother: 'brothers', sister: 'sisters',
};

/* 结拜与婚姻互斥的阶段 */
const BLOCKED_STAGES = ['propose', 'prepare', 'feast', 'consummate'];

/* ============================================================
 * 一、基础
 * ============================================================ */

/** 取玩家结拜数据（懒初始化） */
function data(world) {
  const p = world.player;
  if (!p) return null;
  if (!p.kinship) {
    p.kinship = { father: [], mother: [], sons: [], daughters: [], brothers: [], sisters: [] };
  }
  const k = p.kinship;
  for (const s of Object.values(SLOTS)) if (!Array.isArray(k[s])) k[s] = [];
  return k;
}

/** 我的年龄（玩家） */
function ageOf(world, who) {
  if (!who) return 0;
  if (who.isPlayer || who === (world.player || {}).id || who === 'player') {
    const p = world.player;
    return p.age || 0;
  }
  return who.age || (who.def && who.def.age) || 0;
}

/**
 * 取「模板 id」——结拜关系一律按模板 id 存。
 * 因为实例 id（npc_xxx）是临时的，玩家一离开房间就没了。
 */
function defIdOf(world, npc) {
  if (!npc) return null;
  if (typeof npc === 'string') {
    if (world.data.npcs[npc]) return npc;
    const inst = social.findInst(world, npc);
    return inst ? inst.defId : npc;
  }
  if (npc.defId) return npc.defId;
  if (npc.id && world.data.npcs[npc.id] === npc) return npc.id;
  if (npc.def && npc.def.id) return npc.def.id;
  if (npc.id && world.data.npcs[npc.id]) return npc.id;
  return npc.id || null;
}

/** 按模板 id 找本尊（模板对象） */
function defById(world, defId) {
  return (defId && world.data.npcs && world.data.npcs[defId]) || null;
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

/** 按模板 id 找活实例（可能不在场） */
function instById(world, defId) {
  /* 统一走 social 的查找口径（实例 id / 模板 id 都认） */
  return social.findInst(world, defId);
}

/** 某人是否我已结拜（任意身份）。npcId 可以是实例 id 或模板 id。 */
function alreadyKin(world, npcId) {
  const k = data(world);
  if (!k) return false;
  const defId = defIdOf(world, npcId);
  for (const s of Object.values(SLOTS)) {
    if (k[s].some(x => {
      const xid = typeof x === 'string' ? x : x.id;
      return xid === npcId || xid === defId;
    })) return true;
  }
  return false;
}

/** 我和这人已有的血缘/姻亲关系（用于禁止重复结拜） */
function bloodRel(world, npcId) {
  const p = world.player;
  const defId = defIdOf(world, npcId);
  const def = world.data.npcs[defId] || {};
  const a = (p.rel || []).some(r => (r.id === defId || r.id === npcId) && /亲|夫妻|结缘|妾/.test(r.kind || ''));
  const b = (def.rel || []).some(r => r.id === 'player' && /亲|夫妻|结缘|妾/.test(r.kind || ''));
  return a || b;
}

/** 我是不是已和这人成了亲（配偶/妾/结缘） */
function isMarriedTo(world, npcId) {
  const p = world.player;
  if (!p) return false;
  const m = p.marriage;
  if (!m) return false;
  const defId = defIdOf(world, npcId);
  return m.spouse === defId || m.spouse === npcId ||
         (m.concubines || []).includes(defId) || (m.concubines || []).includes(npcId) ||
         (m.bonds || []).includes(defId) || (m.bonds || []).includes(npcId);
}

/* ============================================================
 * 二、判定：该结哪种拜
 * ============================================================ */

/**
 * 根据双方年龄与性别，推荐一个结拜种类。
 * @returns { kind, label }  —— kind 为 null 表示年龄差落在尴尬区间（4~14 岁且不同辈分不明）
 */
function suggestKind(world, npc) {
  const p = world.player;
  const aMe = ageOf(world, p);
  const aYou = ageOf(world, npc);
  const gMe = p.gender || 'male';
  const gYou = npc.gender || 'male';
  const diff = aMe - aYou;   /* >0 我年长 */

  /* 年龄差 ≥ 15：认干亲。谁大谁是父/母 */
  if (Math.abs(diff) >= 15) {
    if (diff > 0) {
      /* 我年长 → 他/她是我义子/义女 */
      return gYou === 'female'
        ? { kind: 'daughter', label: '义女', senior: 'me' }
        : { kind: 'son', label: '义子', senior: 'me' };
    }
    /* 我年幼 → 他/她是我义父/义母 */
    return gYou === 'female'
      ? { kind: 'mother', label: '义母', senior: 'you' }
      : { kind: 'father', label: '义父', senior: 'you' };
  }

  /* 年龄差 < 15：平辈结拜 */
  if (gMe === gYou) {
    /* 同性：兄弟 / 姐妹，按年龄排长幼 */
    if (gMe === 'female') {
      return diff > 0
        ? { kind: 'sister', label: '义妹', meAs: '义姐', senior: 'me' }   /* 我大 → 他是我义妹 */
        : { kind: 'sister', label: '义姐', meAs: '义妹', senior: 'you' };
    }
    return diff > 0
      ? { kind: 'brother', label: '义弟', meAs: '义兄', senior: 'me' }
      : { kind: 'brother', label: '义兄', meAs: '义弟', senior: 'you' };
  }

  /* 异性平辈：义兄/义妹 或 义姐/义弟 */
  if (gMe === 'male') {
    /* 我男她女 */
    return diff > 0
      ? { kind: 'sister', label: '义妹', meAs: '义兄', senior: 'me' }
      : { kind: 'brother', label: '义姐', meAs: '义弟', senior: 'you' };   /* 她大：她是我义姐 */
  }
  /* 我女他男 */
  return diff > 0
    ? { kind: 'brother', label: '义弟', meAs: '义姐', senior: 'me' }
    : { kind: 'sister', label: '义兄', meAs: '义妹', senior: 'you' };      /* 他大：他是我义兄 */
}

/**
 * 这个 NPC 眼中的我是什么（结拜后回写 NPC 的 rel.kind）
 * 用结了的那种拜 + 我的性别推。
 */
function reverseLabel(kind, myGender) {
  const r = REVERSE[kind] || {};
  const rk = r[myGender] || r.male || 'brother';
  return (KINDS[rk] && KINDS[rk].cn) || '义亲';
}

/* ============================================================
 * 三、资格判定
 * ============================================================ */

/** 能不能结拜。返回 { ok, reason, kind, label } */
function canSwear(world, npc) {
  const p = world.player;
  if (!p || !npc) return { ok: false, reason: '找不到这人。' };
  const def = npcDef(world, npc) || {};
  const name = npc.name || def.name || '？';

  if (npc.id === p.id) return { ok: false, reason: '跟自己结拜？不必了。' };
  if (!def.socialDone && !npc.socialDone) return { ok: false, reason: `${name}并不通人情世故。` };
  if (def.hostile || npc.hostile) return { ok: false, reason: `${name}与你势同水火，谈何结拜。` };
  if (npc.dead || def.dead) return { ok: false, reason: `${name}已经不在人世。` };
  if (def.immortal || npc.immortal) return { ok: false, reason: `${name}乃方外之人，不涉尘缘。` };

  /* 已在议亲/成亲中 —— 不结拜，免得辈分乱套 */
  const m = p.marriage;
  if (m && BLOCKED_STAGES.includes(m.stage)) {
    return { ok: false, reason: '你正在议亲，先成了家再论结拜。' };
  }
  if (isMarriedTo(world, npc.id)) {
    return { ok: false, reason: `${name}已是你的枕边人，不必再结拜。` };
  }
  if (alreadyKin(world, npc.id)) {
    return { ok: false, reason: `${name}已与你沾了亲。` };
  }
  if (bloodRel(world, npc.id)) {
    return { ok: false, reason: `你与${name}本就有亲，何须再结。` };
  }

  /* 年龄不明的不许结（野兽、无名之辈） */
  const aMe = ageOf(world, p);
  const aYou = ageOf(world, npc);
  if (!aYou) return { ok: false, reason: `${name}的来历你不清楚，不能贸然结拜。` };
  if (!aMe) return { ok: false, reason: '你还不知道自己多大，先安顿下来再说。' };

  /* 太小不能拜把子 */
  if (aMe < 10) return { ok: false, reason: '你年纪太小，谈什么结拜。' };
  if (aYou < 8) return { ok: false, reason: `${name}年纪太小，认个亲还差不多。` };

  /* 好感门槛 */
  const need = swearFavorNeed(world, npc);
  const fav = social.favorOf(world, npc.id);
  if (fav < need) {
    return { ok: false, reason: `${name}对你的好感（${fav}）还不到结拜的地步（需 ${need}），得先有几分交情。` };
  }

  const g = suggestKind(world, npc);
  if (!g || !g.kind) return { ok: false, reason: `你与${name}的缘分还不到结拜的时候。` };
  return { ok: true, reason: '', kind: g.kind, label: g.label, meAs: g.meAs || g.label, senior: g.senior };
}

/** 结拜好感门槛（比正婚低，比结缘也低一些） */
function swearFavorNeed(world, npc) {
  const def = npcDef(world, npc) || {};
  const base = 55;
  const hard = { official: 1.5, judge: 1.6, richman: 1.4, noble: 1.35, eunuch: 1.5 };
  const easy = { beggar: 0.55, child: 0.5, waiter: 0.7, waiter2: 0.7, servant: 0.7, maid: 0.7, farmer: 0.8 };
  const mul = hard[def.tag] || easy[def.tag] || 1;
  return Math.round(base * mul);
}

/* ============================================================
 * 四、执行结拜
 * ============================================================ */

/** 往 NPC 的 rel 里挂一条结拜边（模板 + 活实例都要）。npcId 传模板 id。 */
function linkKin(world, npcId, kind, myAs) {
  const p = world.player;
  const pname = p ? p.name : '你';
  const defId = defIdOf(world, npcId) || npcId;
  const myLabel = myAs || (KINDS[kind] && KINDS[kind].cn) || '义亲';
  const theirLabel = reverseLabel(kind, p ? p.gender : 'male');

  const touch = (o) => {
    if (!o) return;
    if (!o.rel) o.rel = [];
    const i = o.rel.findIndex(r => r.id === 'player');
    if (i >= 0) o.rel[i] = { id: 'player', kind: theirLabel, name: pname };
    else o.rel.push({ id: 'player', kind: theirLabel, name: pname });
    /* NPC 侧独立记一份，方便「义父」这种要反查的 */
    if (!o.kin) o.kin = [];
    const j = o.kin.findIndex(x => x.id === 'player');
    if (j >= 0) o.kin[j] = { id: 'player', kind: theirLabel, name: pname };
    else o.kin.push({ id: 'player', kind: theirLabel, name: pname });
  };
  touch(world.data.npcs[defId]);
  touch(instById(world, defId));

  /* 玩家侧 */
  if (p) {
    if (!p.rel) p.rel = [];
    const nm = (defById(world, defId) || {}).name || defId;
    const j = p.rel.findIndex(r => r.id === defId);
    if (j >= 0) p.rel[j] = { id: defId, kind: myLabel, name: nm };
    else p.rel.push({ id: defId, kind: myLabel, name: nm });
  }
}

/** 结拜主流程 */
function swear(world, npc) {
  const c = canSwear(world, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };
  const p = world.player;
  const k = data(world);
  const defId = defIdOf(world, npc);
  const def = defById(world, defId) || {};
  const name = npc.name || def.name;
  const slot = SLOTS[c.kind];
  const myLabel = c.meAs || c.label;

  let entry = { id: defId, name, kind: c.kind, label: myLabel, since: world.clockMinutes || 0 };
  if (!k[slot].some(x => (typeof x === 'string' ? x : x.id) === defId)) k[slot].push(entry);

  linkKin(world, defId, c.kind, myLabel);

  /* 结拜加好感（认干亲加得多，拜把子加得少） */
  const gain = (c.kind === 'father' || c.kind === 'mother' || c.kind === 'son' || c.kind === 'daughter') ? 30 : 22;
  const r = social.addFavorTo(world, defId, gain, '结拜');

  const lines = [
    { kind: 'title', text: '【 义 结 金 兰 】' },
  ];
  if (c.kind === 'father' || c.kind === 'mother') {
    lines.push({ kind: 'story', text: `你整衣肃容，向${name}行了大礼，认作${c.label}。${name}扶你起来，眼中颇有暖意。` });
  } else if (c.kind === 'son' || c.kind === 'daughter') {
    lines.push({ kind: 'story', text: `你收${name}作了${c.label}，从此江湖路上多了一份牵挂。` });
  } else {
    lines.push({ kind: 'story', text: `你与${name}撮土为香，对天八拜，从此${myLabel}相称，祸福与共。` });
  }
  lines.push(...r.lines);
  lines.push({ kind: 'sys', text: `（${name}如今以「${reverseLabel(c.kind, p.gender)}」称你。）` });
  lines.push({ kind: 'hint', text: '发「亲人」可查看你的义亲与结拜名册。' });
  return { ok: true, kind: c.kind, label: c.label, lines };
}

/** 断绝结拜（翻脸 / 玩家主动） */
function sever(world, npcId) {
  const k = data(world);
  if (!k) return { ok: false, lines: [{ kind: 'warn', text: '你尚无结拜之亲。' }] };
  const defId = defIdOf(world, npcId);
  let hit = null;
  for (const s of Object.values(SLOTS)) {
    const i = k[s].findIndex(x => {
      const xid = typeof x === 'string' ? x : x.id;
      return xid === defId || xid === npcId;
    });
    if (i >= 0) { hit = { slot: s, entry: k[s][i] }; k[s].splice(i, 1); break; }
  }
  if (!hit) return { ok: false, lines: [{ kind: 'warn', text: '你与这人并未结拜。' }] };

  const nm = ((defById(world, defId) || {}).name) || (typeof hit.entry === 'object' && hit.entry.name) || defId;
  const strip = (o) => {
    if (!o) return;
    if (o.rel) o.rel = o.rel.filter(r => r.id !== 'player');
    if (o.kin) o.kin = o.kin.filter(x => x.id !== 'player');
  };
  strip(world.data.npcs[defId]);
  strip(instById(world, defId));
  const p = world.player;
  if (p && p.rel) p.rel = p.rel.filter(r => r.id !== defId && r.id !== npcId);

  return { ok: true, lines: [
    { kind: 'story', text: `你与${nm}割袍断义，从此恩断义绝。` },
    ...social.addFavorTo(world, defId, -40, '断义').lines,
  ] };
}

/* ============================================================
 * 五、查询 / 摘要
 * ============================================================ */

/** 这位 NPC 与我的关系称呼（义父/义兄/路人…）。npcId 可传实例或模板 id。 */
function relationOf(world, npcId) {
  const k = data(world);
  if (!k) return null;
  const defId = defIdOf(world, npcId);
  for (const s of Object.values(SLOTS)) {
    const x = k[s].find(y => {
      const yid = typeof y === 'string' ? y : y.id;
      return yid === defId || yid === npcId;
    });
    if (x) return typeof x === 'string' ? { id: defId, kind: s, label: (KINDS[s] && KINDS[s].cn) || s } : x;
  }
  return null;
}

/** 名册摘要（给面板用） */
function summary(world) {
  const k = data(world);
  if (!k) return null;
  const out = { father: [], mother: [], sons: [], daughters: [], brothers: [], sisters: [], total: 0 };
  for (const s of Object.keys(out)) {
    if (s === 'total') continue;
    for (const x of k[s]) {
      const id = typeof x === 'string' ? x : x.id;
      const d = defById(world, id) || {};
      out[s].push({
        id, name: (typeof x === 'object' && x.name) || d.name || id,
        label: (typeof x === 'object' && x.label) || (KINDS[s] && KINDS[s].cn) || s,
        gender: d.gender, age: d.age,
        home: d.home, homeName: d.home ? ((world.getRoom(d.home) || {}).name || null) : null,
        favor: social.favorOf(world, id),
        dead: !!d.dead,
      });
      out.total++;
    }
  }
  return out;
}

/** 当前房间里可结拜的人 */
function candidates(world) {
  const p = world.player;
  if (!p) return [];
  const out = [];
  for (const n of (world.npcsIncludingTemplates(p.room) || [])) {
    const d = n.def || defById(world, n.defId) || {};
    if (!n.isNpc || !d.socialDone) continue;
    const c = canSwear(world, n);
    out.push({
      id: n.id, defId: n.defId, name: n.name, ok: c.ok, reason: c.reason,
      kind: c.kind || null, label: c.label || null, meAs: c.meAs || null,
      gender: n.gender, age: ageOf(world, n), favor: social.favorOf(world, n.id),
    });
  }
  return out;
}

/** 这位 NPC 眼中的我（用于对话时的称呼） */
function addressMe(world, npc) {
  const defId = defIdOf(world, npc);
  const def = defById(world, defId) || {};
  /* NPC 侧存的那条最准 */
  const mine = (def.kin || []).find(x => x.id === 'player');
  if (mine) return mine.kind;
  /* 退而求其次：反推 */
  const r = relationOf(world, defId);
  if (r) return reverseLabel(r.kind, (world.player || {}).gender);
  return null;
}

module.exports = {
  KINDS, REVERSE, SLOTS, BLOCKED_STAGES,
  data, ageOf, alreadyKin, bloodRel, isMarriedTo,
  defIdOf, defById, instById, npcDef,
  suggestKind, reverseLabel, swearFavorNeed,
  canSwear, swear, sever, linkKin,
  relationOf, summary, candidates, addressMe,
};
