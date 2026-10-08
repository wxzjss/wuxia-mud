/* ============================================================
 * home.js —— 玩家家园系统（第二批）
 *
 * 需求原文：
 *   「有家园系统（需要花钱找官府买）」
 *   「婚后你可以操作伴侣家园」
 *
 * 设计：
 *   - 玩家在「衙门·签押房」发「买宅」花钱买一处宅子
 *   - 宅子挂到一个「房牙」NPC 名下的里弄里（复用 NPC 宅院的坊结构）
 *   - 家里可以「布置」（改描述）「置办家具」（花钱买摆设）
 *   - 婚后：伴侣的家也变成你的可操作房产（`isHomeOf` 判定）
 *
 * 数据结构：
 *   player.home = 'hm_player_<n>'              —— 唯一主宅
 *   player.homes = [{ id, name, price, boughtAt }]  —— 历史房产
 *   room.owner = 'player'                      —— 房间归属
 * ============================================================ */

/* 房价档位（越贵的屋子能放的家具越多、描述越气派） */
const TIERS = [
  {
    id: 'cottage', name: '一间小屋', price: 800,
    desc: '一间不大的屋子，进门一张木床，窗下一张旧桌。虽简陋，总算是个遮风挡雨的地方。',
    capacity: 3,
  },
  {
    id: 'courtyard', name: '一座小院', price: 3000,
    desc: '一进小院，天井里种着两株石榴。正屋三间，两侧各有厢房。院角一口水井，日子过得下去。',
    capacity: 8,
  },
  {
    id: 'mansion', name: '一座宅院', price: 12000,
    desc: '青砖门楼，两进院落。前厅会客，后院住家，廊下挂着灯笼。这已是有头有脸的人家了。',
    capacity: 16,
  },
  {
    id: 'estate', name: '一处大宅', price: 50000,
    desc: '朱漆大门，石狮子分列两旁。三进院落层层递进，亭台楼阁、假山池塘一应俱全。此间主人，必非寻常。',
    capacity: 30,
  },
];

const TIER_MAP = {};
for (const t of TIERS) TIER_MAP[t.id] = t;

/* 家具（花银子布置家里，加个「家当」值） */
const FURNITURE = [
  { id: 'bed',    name: '雕花大床', price: 300,  desc: '睡得舒坦，回体力更快。' },
  { id: 'table',  name: '八仙桌',   price: 200,  desc: '待客吃饭都用得上。' },
  { id: 'shelf',  name: '书架',     price: 400,  desc: '读书习武，心静些。' },
  { id: 'screen', name: '山水屏风', price: 600,  desc: '挡风又好看，显主人品味。' },
  { id: 'incense', name: '香炉',    price: 350,  desc: '一炉好香，满室清雅。' },
  { id: 'sword',  name: '兵刃架',   price: 500,  desc: '刀剑有处安放，不至于蒙尘。' },
  { id: 'garden', name: '小花园',   price: 1500, desc: '闲时莳花弄草，怡情养性。' },
  { id: 'pond',   name: '养鱼池',   price: 2200, desc: '一池锦鲤，观之忘忧。' },
  { id: 'piano',  name: '古琴台',   price: 1800, desc: '月下抚琴，别有怀抱。' },
];
const FURN_MAP = {};
for (const f of FURNITURE) FURN_MAP[f.id] = f;

/** 衙门签押房（买房的地方） */
const YAMEN_ROOM = 'jn_yamen_office';

/* ============================================================
 * 一、查询
 * ============================================================ */

/** 取家园数据（懒初始化） */
function data(world) {
  const p = world.player;
  if (!p) return null;
  if (!p.homes) p.homes = [];
  return p;
}

/** 我的主宅房间对象（没有返回 null） */
function myHome(world) {
  const p = world.player;
  if (!p || !p.home) return null;
  return world.getRoom(p.home) || null;
}

/**
 * 我能不能操作这个房间？
 * 「操作」= 布置 / 置办家具 / 休息。
 * 规则：我自己的宅子 ✔；伴侣（正室/妾）的宅子 ✔。
 */
function canOperate(world, roomId) {
  const p = world.player;
  const room = world.getRoom(roomId);
  if (!p || !room) return false;
  if (room.owner === 'player') return true;
  if (p.home && room.id === p.home) return true;

  /* 伴侣的家 */
  const m = p.marriage;
  if (m) {
    const ids = [m.spouse].concat(m.concubines || []).filter(Boolean);
    for (const id of ids) {
      const d = world.data.npcs[id];
      if (d && d.home === roomId) return true;
      if (room.owner === id) return true;
    }
  }
  return false;
}

/** 当前房间的信息（给 UI / 指令用） */
function roomInfo(world, roomId) {
  const room = world.getRoom(roomId);
  if (!room) return null;
  return {
    id: room.id, name: room.name,
    owner: room.owner || null,
    isMine: room.owner === 'player',
    mine: canOperate(world, roomId),
    tier: room.homeTier || null,
    furniture: (room.furniture || []).slice(),
    capacity: room.homeCapacity || 0,
  };
}

/* ============================================================
 * 二、买房
 * ============================================================ */

/** 列出可买的宅子 */
function tiersOf() {
  return TIERS.map(t => ({ id: t.id, name: t.name, price: t.price, capacity: t.capacity, desc: t.desc }));
}

/**
 * 买房。
 * @param tierId 'cottage' | 'courtyard' | 'mansion' | 'estate'
 */
function buy(world, tierId) {
  const p = world.player;
  if (!p) return { ok: false, lines: [{ kind: 'warn', text: '请先创建角色。' }] };
  const room = world.getRoom(p.room);
  if (!room || room.id !== YAMEN_ROOM) {
    return { ok: false, lines: [
      { kind: 'warn', text: '买宅子得去衙门签押房立契。' },
      { kind: 'hint', text: '（衙门在城中，从江南大路往北可到。）' },
    ] };
  }
  const tier = TIER_MAP[tierId] || TIER_MAP.cottage;
  if (p.home) {
    return { ok: false, lines: [
      { kind: 'warn', text: `你已有宅子（${(world.getRoom(p.home) || {}).name || p.home}）。` },
      { kind: 'hint', text: '若要换更大的，先把旧宅发「卖宅」处理掉。' },
    ] };
  }
  if (p.money < tier.price) {
    return { ok: false, lines: [
      { kind: 'warn', text: `${tier.name}需 ${tier.price} 文，你身上只有 ${p.money} 文。` }] };
  }

  p.money -= tier.price;
  const n = (p.homes || []).length + 1;
  const hmId = 'hm_player_' + n;

  /* 挂到「江南区」的里弄里 —— 用与 NPC 宅院相同的坊结构 */
  const host = findHostFang(world, hmId);
  if (!host) {
    return { ok: false, lines: [{ kind: 'warn', text: '城中一时没有空地可挂宅，改日再来。' }] };
  }

  world.data.rooms[hmId] = {
    id: hmId,
    name: p.name + '的家',
    region: host.region,
    desc: tier.desc,
    exits: {},
    owner: 'player',
    private: true,
    homeTier: tier.id,
    homeCapacity: tier.capacity,
    furniture: [],
  };
  world.data.rooms[host.fang].exits[host.dir] = hmId;
  /* ⚠ 反向边要用自己的方向表，world 上没有 REVERSE_DIR（曾经踩过：回家出不来） */
  const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
  const bk = BACK[host.dir];
  if (bk) world.data.rooms[hmId].exits[bk] = host.fang;

  if (!p.homes) p.homes = [];
  p.homes.push({ id: hmId, name: p.name + '的家', tier: tier.id, price: tier.price, boughtAt: world.clockMinutes || 0 });
  p.home = hmId;

  return { ok: true, home: hmId, lines: [
    { kind: 'title', text: '【 立 契 】' },
    { kind: 'story', text: `你花 ${tier.price} 文，在衙门立了契，置下${tier.name}。` },
    { kind: 'sys', text: `你的家：${p.name}的家（${host.region}·${(world.getRoom(host.fang) || {}).name || host.fang}）` },
    { kind: 'hint', text: '发「回家」可直接回去，发「布置」可改家中陈设，发「置办 <家具>」添置家当。' },
  ] };
}

/** 找一个能挂玩家宅子的里弄（同区域，方向有空） */
function findHostFang(world, hmId) {
  const DIRS = ['n', 's', 'ne', 'nw', 'se', 'sw', 'e', 'w'];
  const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
  /* 优先挂江南（玩家出生地附近） */
  const prefer = ['jiangnan', 'market', 'cunzhen', 'gusu', 'yamen'];
  const order = prefer.concat(Object.keys(world.data.regions || {}));
  for (const region of order) {
    for (const id of Object.keys(world.data.rooms)) {
      const r = world.data.rooms[id];
      if (!id.startsWith('fang_') || r.region !== region) continue;
      for (const dir of DIRS) {
        if (r.exits && r.exits[dir]) continue;
        if (BACK[dir] && r.exits[BACK[dir]]) continue;
        return { fang: id, dir, region };
      }
    }
  }
  return null;
}

/** 卖宅（退还半价） */
function sell(world) {
  const p = world.player;
  if (!p || !p.home) return { ok: false, lines: [{ kind: 'warn', text: '你并无宅子在名下。' }] };
  const room = world.getRoom(p.room);
  if (!room || room.id !== YAMEN_ROOM) {
    return { ok: false, lines: [{ kind: 'warn', text: '卖宅也得去衙门签押房办。' }] };
  }
  const hr = world.getRoom(p.home);
  const rec = (p.homes || []).find(h => h.id === p.home) || {};
  const back = Math.round((rec.price || 800) * 0.5);
  p.money += back;

  /* 摘掉房间与出口 */
  if (hr) {
    for (const d of Object.keys(hr.exits || {})) {
      const other = world.getRoom(hr.exits[d]);
      if (other && other.exits) {
        for (const d2 of Object.keys(other.exits)) if (other.exits[d2] === hr.id) delete other.exits[d2];
      }
    }
    delete world.data.rooms[hr.id];
  }
  p.homes = (p.homes || []).filter(h => h.id !== p.home);
  const nm = hr ? hr.name : '旧宅';
  p.home = null;
  return { ok: true, lines: [
    { kind: 'story', text: `你把${nm}转手卖出，得银 ${back} 文。` },
    { kind: 'hint', text: '（若已成亲，婚后仍可住在伴侣家中。）' },
  ] };
}

/* ============================================================
 * 三、布置与置办
 * ============================================================ */

/** 改自家描述 */
function decorate(world, text) {
  const p = world.player;
  const room = world.getRoom(p.room);
  if (!room || !canOperate(world, room.id)) {
    return { ok: false, lines: [{ kind: 'warn', text: '这里不是你的宅子，改不得。' }] };
  }
  if (!text || !text.trim()) {
    return { ok: false, lines: [
      { kind: 'warn', text: '用法：布置 <描述>　比如「布置 青石小径，一丛修竹」' },
      { kind: 'plain', text: `　当前：${room.desc}` },
    ] };
  }
  if (text.length > 60) text = text.slice(0, 60);
  room.desc = text.trim();
  return { ok: true, lines: [
    { kind: 'story', text: '你重新收拾了屋子。' },
    { kind: 'plain', text: `　${room.desc}` },
  ] };
}

/** 置办家具 */
function furnish(world, kw) {
  const p = world.player;
  const room = world.getRoom(p.room);
  if (!room || !canOperate(world, room.id)) {
    return { ok: false, lines: [{ kind: 'warn', text: '这里不是你的宅子。' }] };
  }
  const cap = room.homeCapacity || 3;
  if (!room.furniture) room.furniture = [];
  if (!kw || !kw.trim()) {
    const lines = [{ kind: 'title', text: '【 可置办的家当 】' },
      { kind: 'sys', text: `　已有 ${room.furniture.length} / ${cap} 件` }];
    for (const f of FURNITURE) {
      const has = room.furniture.includes(f.id);
      lines.push({ kind: has ? 'plain' : 'favor', text: `　${f.name}　${f.price} 文　${f.desc}${has ? '　✔已有' : ''}`, color: has ? '#8a8a8a' : undefined, itemId: f.id });
    }
    lines.push({ kind: 'hint', text: '用法：置办 <家具名>' });
    return { ok: true, lines };
  }
  if (room.furniture.length >= cap) {
    return { ok: false, lines: [{ kind: 'warn', text: `屋子就这么大，最多放 ${cap} 件家当。` }] };
  }
  const key = kw.trim();
  const f = FURNITURE.find(x => x.name === key || x.id === key || x.name.includes(key) || key.includes(x.name.slice(0, 2)));
  if (!f) return { ok: false, lines: [{ kind: 'warn', text: `没有「${kw}」这样的家当。` }] };
  if (room.furniture.includes(f.id)) return { ok: false, lines: [{ kind: 'warn', text: `${f.name}你已经有了。` }] };
  if (p.money < f.price) return { ok: false, lines: [{ kind: 'warn', text: `${f.name}要 ${f.price} 文，你钱不够。` }] };

  p.money -= f.price;
  room.furniture.push(f.id);
  return { ok: true, lines: [
    { kind: 'story', text: `你花 ${f.price} 文添了${f.name}。` },
    { kind: 'sys', text: `　${f.desc}` },
    { kind: 'plain', text: `　家中已有 ${room.furniture.length} / ${cap} 件家当。` },
  ] };
}

/** 家当总值（影响「家境」评价） */
function estateValue(world) {
  const p = world.player;
  let v = 0;
  for (const h of (p.homes || [])) {
    const r = world.getRoom(h.id);
    if (!r) continue;
    v += h.price || 0;
    for (const fid of (r.furniture || [])) v += (FURN_MAP[fid] || {}).price || 0;
  }
  return v;
}

/** 回家（传送回主宅） */
function goHome(world) {
  const p = world.player;
  if (!p.home) {
    /* 没宅子 → 去伴侣家 */
    const m = p.marriage;
    if (m && m.spouse) {
      const d = world.data.npcs[m.spouse];
      if (d && d.home && world.getRoom(d.home)) {
        p.room = d.home;
        return { ok: true, lines: [{ kind: 'story', text: `你回到${d.name}家。` }], moved: d.home };
      }
    }
    return { ok: false, lines: [
      { kind: 'warn', text: '你还没有自己的宅子。' },
      { kind: 'hint', text: '去衙门签押房发「买宅」置办一处。' },
    ] };
  }
  const hr = world.getRoom(p.home);
  if (!hr) { p.home = null; return { ok: false, lines: [{ kind: 'warn', text: '你的宅子不在了。' }] }; }
  p.room = p.home;
  const lines = [{ kind: 'story', text: `你回到${hr.name}。` }];
  if ((hr.furniture || []).length) {
    const names = hr.furniture.map(f => (FURN_MAP[f] || {}).name).filter(Boolean);
    lines.push({ kind: 'plain', text: '　屋里：' + names.join('、') });
  }
  return { ok: true, lines, moved: hr.id };
}

/* ============================================================
 * 四、摘要（给 UI）
 * ============================================================ */

function summary(world) {
  const p = world.player;
  if (!p) return null;
  const home = myHome(world);
  const out = {
    hasHome: !!home,
    home: home ? { id: home.id, name: home.name, tier: home.homeTier || null, capacity: home.homeCapacity || 0, furniture: (home.furniture || []).length } : null,
    homes: (p.homes || []).map(h => ({ id: h.id, name: h.name, tier: h.tier, price: h.price })),
    estateValue: estateValue(world),
    canBuyHere: (world.getRoom(p.room) || {}).id === YAMEN_ROOM,
    tiers: tiersOf(),
    partnerHome: null,
  };
  /* 伴侣的家 */
  const m = p.marriage;
  if (m && m.spouse) {
    const d = world.data.npcs[m.spouse];
    if (d && d.home) {
      const r = world.getRoom(d.home);
      out.partnerHome = { id: d.home, name: r ? r.name : d.home, of: d.name };
    }
  }
  return out;
}

module.exports = {
  TIERS, TIER_MAP, FURNITURE, FURN_MAP, YAMEN_ROOM,
  data, myHome, canOperate, roomInfo, tiersOf,
  buy, sell, findHostFang, decorate, furnish, estateValue, goHome, summary,
};
