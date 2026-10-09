/* ============================================================
 * estate.js —— 家园开辟新地块 + 资助 NPC 建家
 *
 * 需求原文（武学重制轮）：
 *   「能自己建家（还有家园建造系统可以开辟新地块）吗？」
 *   「能给 NPC 建家吗？」
 *
 * 设计（两件事共用「房契」概念）：
 *
 * A. 家园新地块 —— 玩家在自家宅院里开垦新地块
 *   - 主宅（home.js 买的）挂在地块「主院」上
 *   - 每个地块是一个真实的房间（能走过去、能放东西、能升级）
 *   - 地块各有功能：练武场（淬体/修炼加速）、书房（悟性）、丹房（炼丹成功）、
 *     药圃（种药）、花园（定力/心情）、地窖（存钱）、客卿院（收徒/招募）
 *   - 开垦要花银两 + 材料，且主宅等级不够开不了高级地块
 *   - 存p.estate.plots = [{ key, roomId, level, builtAt }]
 *
 * B. 资助 NPC 建家 —— 花钱给某个 NPC 盖宅子
 *   - NPC 得有房（def.home 指向新房间），夜里作息会回自己家
 *   - 花钱越多，NPC 好感涨越多；有家 NPC 会更信任你（trust 加权）
 *   - 家也会给 NPC 一个「家当」加成（心境/心情维护得更好）
 *   - 存 p.estate.sponsored = { npcId: { roomId, tier, spentAt } }
 *
 * 数据一律存 player.estate（随玩家存档走），
 * 新建的房间走 playerHomes 那套「动态房间单独序列化」机制。
 * ============================================================ */

const home = require('./home');

/* ============================================================
 * 一、地块定义
 * ============================================================ */

/**
 * 每个地块：
 *   reqHomeTier —— 主宅必须达到的档位（tier id）
 *   cost        —— 银两
 *   mats        —— 材料 { itemId: n }
 *   maxLevel    —— 可升级到几级
 *   dir         —— 从主院往哪个方向开
 *   grow        —— 升一级加多少效果
 *   bonus       —— 效果字段（供各系统读取）
 *   desc(lv)    —— 描述按等级生成
 */
const PLOTS = [
  {
    key: 'yard', name: '练武场', dir: 'e', reqHomeTier: 'cottage',
    cost: 1200, mats: { 'crop_rice': 8, 'iron_ore': 4 }, maxLevel: 5,
    grow: 0.25,
    bonus: { trainMult: 0.25, cutiRate: 0.06 },
    desc: lv => [
      '院角一片空地，踩上去还带响动。',
      '铺了层夯土，勉强能走两趟拳脚。',
      '立了木人桩，汗渍浸进木头里发黑。',
      '青砖墁地，兵器架齐整，试招时不留余地。',
      '起了一座演武台，四面都能观战，喝彩声能传出巷子。',
    ][Math.min(lv - 1, 4)],
  },
  {
    key: 'study', name: '书房', dir: 'w', reqHomeTier: 'cottage',
    cost: 900, mats: { 'crop_wheat': 6, 'silk_thread': 3 }, maxLevel: 4,
    grow: 0.2,
    bonus: { wisdom: 2 },
    desc: lv => [
      '辟出一角，堆了些杂物。',
      '有张旧案，一盏灯，能看两页书。',
      '四壁上了架子，武学谱牒摆得下了。',
      '窗明几净，抄经的手不再抖。',
    ][Math.min(lv - 1, 3)],
  },
  {
    key: 'alchemy', name: '丹房', dir: 'n', reqHomeTier: 'courtyard',
    cost: 2600, mats: { 'crop_wheat': 10, 'iron_ore': 6, 'herb_lingshen': 5 }, maxLevel: 4,
    grow: 0.12,
    bonus: { craftRate: 0.12 },
    desc: lv => [
      '支了个炉子，烟火气熏得满屋发苦。',
      '炉温稳得住，药材不再烧糊。',
      '添了水火两套装置，一炉能出两丸。',
      '墙上挂满晾干的丹渣，香得化不开。',
    ][Math.min(lv - 1, 3)],
  },
  {
    key: 'garden', name: '药圃', dir: 's', reqHomeTier: 'courtyard',
    cost: 1500, mats: { 'crop_rice': 4, 'herb_danggui': 3, 'water_gourd': 2 }, maxLevel: 5,
    grow: 0.2,
    bonus: { herbYield: 0.2, moodUp: 2 },
    desc: lv => [
      '翻了几畦土，播下草籽。',
      '草籽出了芽，稀稀落落一片。',
      '药材长得齐了，药香飘到院外。',
      '分畦分区，还搭了遮雨的棚。',
      '圃中药材成材，采药人闻着味儿就来了。',
    ][Math.min(lv - 1, 4)],
  },
  {
    key: 'cellar', name: '地窖', dir: 'ne', reqHomeTier: 'courtyard',
    cost: 1800, mats: { 'iron_ore': 12, 'silk_thread': 3 }, maxLevel: 4,
    grow: 0.3,
    bonus: { moneyCap: 3000 },
    desc: lv => [
      '挖了个浅坑，垫了石板。',
      '往下深了两尺，勉强能放两只箱子。',
      '砖砌了壁，冬不冻夏不潮。',
      '窖口加了铁门，存的东西再不怕人摸。',
    ][Math.min(lv - 1, 3)],
  },
  {
    key: 'guest', name: '客卿院', dir: 'nw', reqHomeTier: 'mansion',
    cost: 5000, mats: { 'crop_wheat': 16, 'iron_ore': 8 }, maxLevel: 3,
    grow: 1,
    bonus: { discipleCap: 1 },
    desc: lv => [
      '腾了间偏屋，勉强能睡人。',
      '收拾干净，添了被褥桌椅，可住一人。',
      '连着打了三间，厨厕俱全，够一个小门户栖身。',
    ][Math.min(lv - 1, 2)],
  },
  {
    key: 'garden_rock', name: '假山池', dir: 'sw', reqHomeTier: 'mansion',
    cost: 6000, mats: { 'iron_ore': 20, 'crop_rice': 4 }, maxLevel: 3,
    grow: 1,
    bonus: { moodUp: 5, favorRate: 0.2 },
    desc: lv => [
      '堆了堆太湖石，形不成景。',
      '山下凿了池子，养了几尾鱼。',
      '叠石栽竹，水声潺潺，坐一下午不闷。',
    ][Math.min(lv - 1, 2)],
  },
];

const PLOT_MAP = {};
for (const pl of PLOTS) PLOT_MAP[pl.key] = pl;

/* 主宅档位序（判断 reqHomeTier 是否满足） */
const TIER_ORDER = { cottage: 1, courtyard: 2, mansion: 3, estate: 4 };

/* ============================================================
 * 二、工具
 * ============================================================ */

/** 取玩家家园数据（懒初始化） */
function data(world) {
  const p = world.player;
  if (!p) return null;
  if (!p.estate) p.estate = { plots: [], sponsored: {} };
  if (!Array.isArray(p.estate.plots)) p.estate.plots = [];
  if (!p.estate.sponsored || typeof p.estate.sponsored !== 'object') p.estate.sponsored = {};
  return p.estate;
}

/** 主宅档位序数（无宅 = 0） */
function homeTierOrder(world) {
  const p = world.player;
  if (!p || !p.home) return 0;
  const r = world.getRoom(p.home);
  if (!r) return 0;
  return TIER_ORDER[r.homeTier] || 1;
}

/** 反向出口表（world 上没有 REVERSE_DIR，历史踩过这个坑） */
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };

/** 地块等级（1 起；未建 = 0） */
function plotLevel(est, key) {
  if (!est) return 0;
  const rec = (est.plots || []).find(x => x.key === key);
  return rec ? (rec.level || 1) : 0;
}

/** 地块累计效果（升级会累加） */
function plotEffect(est, key, field) {
  const pl = PLOT_MAP[key];
  const lv = plotLevel(est, key);
  if (!pl || lv <= 0) return 0;
  const base = pl.bonus && pl.bonus[field];
  if (!base) return 0;
  return pl.key === 'garden_rock' || pl.key === 'guest'
    ? base * lv                      // 离散型（每级 +1 容量 / +5 心情）
    : base + pl.grow * (lv - 1);     // 连续型（每级加一点比例）
}

/** 全家园效果汇总（给其他系统读） */
function estateEffects(world) {
  const p = world.player;
  if (!p) return null;
  const est = p.estate;
  if (!est) return { trainMult: 0, cutiRate: 0, wisdom: 0, craftRate: 0, herbYield: 0, moodUp: 0, moneyCap: 0, discipleCap: 0, favorRate: 0 };
  const sum = f => (est.plots || []).reduce((acc, x) => acc + plotEffect(est, x.key, f), 0);
  return {
    trainMult: sum('trainMult'),
    cutiRate: sum('cutiRate'),
    wisdom: sum('wisdom'),
    craftRate: sum('craftRate'),
    herbYield: sum('herbYield'),
    moodUp: sum('moodUp'),
    moneyCap: sum('moneyCap'),
    discipleCap: sum('discipleCap'),
    favorRate: sum('favorRate'),
  };
}

/** 建房：挂到 parent 房间的 dir 方向，并补反向边 */
function attachRoom(world, parentId, dir, room) {
  const parent = world.getRoom(parentId);
  if (!parent) return false;
  if (!parent.exits) parent.exits = {};
  parent.exits[dir] = room.id;
  room.exits = Object.assign({ [BACK[dir]]: parentId }, room.exits || {});
  return true;
}

/* ============================================================
 * 三、家园地块：查看 / 开垦 / 升级
 * ============================================================ */

/** 列出所有地块 + 当前状态 */
function listPlots(world) {
  const est = data(world);
  if (!est) return { ok: false, lines: [{ kind: 'warn', text: '请先创建角色。' }] };
  const p = world.player;
  const cur = homeTierOrder(world);
  const lines = [{ kind: 'title', text: '【 家 园 地 块 】' }];
  if (!p.home) {
    lines.push({ kind: 'warn', text: '你还没有宅子，无从开辟。' });
    lines.push({ kind: 'hint', text: '去衙门签押房发「买宅」，有了主院再开地。' });
    return { ok: false, lines };
  }
  const hr = world.getRoom(p.home) || {};
  lines.push({ kind: 'sys', text: `主院：${hr.name || p.home}（${(home.TIER_MAP[hr.homeTier] || {}).name || '宅子'}）` });
  lines.push({ kind: 'plain', text: `可开垦：${PLOTS.filter(pl => cur >= (TIER_ORDER[pl.reqHomeTier] || 9)).map(pl => pl.name).join('、') || '无'}` });
  lines.push({ kind: 'plain', text: '' });
  for (const pl of PLOTS) {
    const lv = plotLevel(est, pl.key);
    const locked = cur < (TIER_ORDER[pl.reqHomeTier] || 9);
    if (locked) {
      lines.push({ kind: 'plain', text: `　✘ ${pl.name}　需${(home.TIER_MAP[pl.reqHomeTier] || {}).name || pl.reqHomeTier}以上主院`, color: '#8a8a8a' });
      continue;
    }
    if (lv === 0) {
      const mats = Object.keys(pl.mats || {}).map(k => `${(world.getItem(k) || {}).name || k}×${pl.mats[k]}`).join('、');
      lines.push({ kind: 'favor', text: `　○ ${pl.name}　开垦 ${pl.cost} 文　${mats ? '需 ' + mats : '无材料'}`, itemId: pl.key });
    } else if (lv >= pl.maxLevel) {
      lines.push({ kind: 'plain', text: `　✔ ${pl.name}　${lv} 级（已至顶级）　${pl.desc(lv)}` });
    } else {
      const upCost = Math.floor(pl.cost * (0.8 + 0.35 * lv));
      lines.push({ kind: 'favor', text: `　● ${pl.name}　${lv} 级　升 ${lv + 1} 级需 ${upCost} 文　${pl.desc(lv)}`, itemId: pl.key });
    }
  }
  lines.push({ kind: 'hint', text: '用法：开垦 <地块名>　（在自己主院里发）' });
  return { ok: true, lines, effects: estateEffects(world) };
}

/** 开垦新地块 / 升级已有地块 */
function buildPlot(world, kw) {
  const p = world.player;
  const est = data(world);
  if (!est) return { ok: false, lines: [{ kind: 'warn', text: '请先创建角色。' }] };
  if (!p.home) return { ok: false, lines: [{ kind: 'warn', text: '你还没有宅子，先去衙门买宅。' }] };
  const room = world.getRoom(p.room);
  if (!room || room.id !== p.home) {
    return { ok: false, lines: [{ kind: 'warn', text: '开垦须回自家主院动工。' }, { kind: 'hint', text: '发「回家」回主院再来。' }] };
  }
  if (!kw || !kw.trim()) return { ok: true, lines: listPlots(world).lines };

  const pl = PLOTS.find(x => x.name === kw.trim() || x.key === kw.trim() || x.name.includes(kw.trim()));
  if (!pl) return { ok: false, lines: [{ kind: 'warn', text: `没有「${kw}」这样的地块。` }, { kind: 'hint', text: '发「地块」看可开垦列表。' }] };

  const cur = homeTierOrder(world);
  if (cur < (TIER_ORDER[pl.reqHomeTier] || 9)) {
    return { ok: false, lines: [{ kind: 'warn', text: `${pl.name}须主院达到${(home.TIER_MAP[pl.reqHomeTier] || {}).name || pl.reqHomeTier}以上才开得起来。` }] };
  }

  const lv = plotLevel(est, pl.key);
  /* 出口占用检查（主院到该方向已有路就不能再开） */
  const dir = pl.dir;
  if (lv === 0) {
    if ((room.exits || {})[dir]) return { ok: false, lines: [{ kind: 'warn', text: `${pl.name}这个方位已经有出路了，换个方位再说。` }] };
    const cost = pl.cost;
    if (p.money < cost) return { ok: false, lines: [{ kind: 'warn', text: `开垦${pl.name}要 ${cost} 文，你只有 ${p.money} 文。` }] };
    for (const mid of Object.keys(pl.mats || {})) {
      const need = pl.mats[mid];
      if (p.countItem(mid) < need) {
        return { ok: false, lines: [{ kind: 'warn', text: `缺料：${(world.getItem(mid) || {}).name || mid} ×${need}（现有 ${p.countItem(mid)}）` }] };
      }
    }
    p.money -= cost;
    for (const mid of Object.keys(pl.mats || {})) p.removeItem(mid, pl.mats[mid]);

    const n = est.plots.length + 1;
    const plotId = 'hm_plot_' + n + '_' + pl.key;
    world.data.rooms[plotId] = {
      id: plotId, name: p.name + '家·' + pl.name, region: room.region,
      desc: pl.desc(1), exits: {}, owner: 'player', private: true,
      plotKey: pl.key, plotLevel: 1,
    };
    attachRoom(world, p.home, dir, world.data.rooms[plotId]);
    est.plots.push({ key: pl.key, roomId: plotId, level: 1, builtAt: world.clockMinutes || 0 });
    p.recalc();
    return { ok: true, moved: null, lines: [
      { kind: 'title', text: '【 动 工 】' },
      { kind: 'story', text: `你花 ${cost} 文与若干料工，在院中开出了${pl.name}。` },
      { kind: 'plain', text: `　${pl.desc(1)}` },
      { kind: 'sys', text: `　（往${dirName(dir)}走就是。从主院发「开垦 ${pl.name}」可再升级。）` },
    ] };
  }

  /* 升级 */
  if (lv >= pl.maxLevel) return { ok: false, lines: [{ kind: 'warn', text: `${pl.name}已至 ${pl.maxLevel} 级，再无可进。` }] };
  const upCost = Math.floor(pl.cost * (0.8 + 0.35 * lv));
  if (p.money < upCost) return { ok: false, lines: [{ kind: 'warn', text: `${pl.name}升到 ${lv + 1} 级要 ${upCost} 文，你只有 ${p.money} 文。` }] };
  p.money -= upCost;
  const rec = est.plots.find(x => x.key === pl.key);
  rec.level = lv + 1;
  const pr = world.getRoom(rec.roomId);
  if (pr) { pr.plotLevel = rec.level; pr.desc = pl.desc(rec.level); }
  p.recalc();
  return { ok: true, lines: [
    { kind: 'title', text: '【 扩 建 】' },
    { kind: 'story', text: `${pl.name}扩到了 ${rec.level} 级。` },
    { kind: 'plain', text: `　${pl.desc(rec.level)}` },
  ] };
}

function dirName(dir) {
  return { n: '北', s: '南', e: '东', w: '西', ne: '东北', nw: '西北', se: '东南', sw: '西南' }[dir] || dir;
}

/* ============================================================
 * 四、资助 NPC 建家
 * ============================================================ */

/** 宅子档位（给 NPC 盖的，按亲疏选） */
const NPC_TIERS = [
  { id: 'huts',  name: '一间茅屋', cost: 800,   capacity: 2 },
  { id: 'rooms', name: '两间厢房', cost: 2400,  capacity: 5 },
  { id: 'court', name: '一个小院', cost: 8000,  capacity: 10 },
];

/** 列出可资助的 NPC（同房、还没家的优先） */
function listNpcCandidates(world) {
  const p = world.player;
  const lines = [{ kind: 'title', text: '【 可 资 助 建 家 】' }];
  if (!p) return { ok: false, lines };
  const room = world.getRoom(p.room);
  if (!room) return { ok: false, lines: [{ kind: 'warn', text: '你身处何处都看不清。' }] };
  const npcs = (world.instances.npcs && Object.values(world.instances.npcs)) || []
    .filter(n => n.room === room.id);
  if (!npcs.length) {
    lines.push({ kind: 'plain', text: '此处没有旁人。' });
    return { ok: true, lines };
  }
  lines.push({ kind: 'sys', text: `　你身上 ${p.money} 文。` });
  for (const n of npcs) {
    const d = world.data.npcs[n.defId] || {};
    const hasHome = !!n.home || !!d.home;
    const name = n.name || d.name || n.defId;
    lines.push({
      kind: hasHome ? 'plain' : 'favor',
      text: hasHome
        ? `　· ${name}　已有住处`
        : `　○ ${name}　好感 ${Math.round(n.favor || 0)}　无家可归`,
      color: hasHome ? '#8a8a8a' : undefined,
    });
  }
  lines.push({ kind: 'plain', text: '' });
  for (const t of NPC_TIERS) lines.push({ kind: 'plain', text: `　${t.name}　${t.cost} 文` });
  lines.push({ kind: 'hint', text: '用法：资助 <NPC名> [档位名]　如「资助 范清 一间茅屋」' });
  return { ok: true, lines };
}

/**
 * 资助 NPC 建家。
 * @param kw NPC 名（模糊）
 * @param tierKw 档位名（可省，默认最便宜）
 */
function sponsorNpcHome(world, kw, tierKw) {
  const p = world.player;
  const est = data(world);
  if (!est) return { ok: false, lines: [{ kind: 'warn', text: '请先创建角色。' }] };
  if (!kw || !kw.trim()) return { ok: true, lines: listNpcCandidates(world).lines };
  const room = world.getRoom(p.room);
  if (!room) return { ok: false, lines: [{ kind: 'warn', text: '你身处何处都看不清。' }] };

  /* 找同房 NPC（先活实例，再模板） */
  let target = null;
  for (const n of Object.values(world.instances.npcs || {})) {
    if (n.room !== room.id) continue;
    const nm = n.name || (world.data.npcs[n.defId] || {}).name || '';
    if (nm.includes(kw.trim()) || n.defId === kw.trim()) { target = n; break; }
  }
  if (!target) {
    return { ok: false, lines: [{ kind: 'warn', text: `你眼前没有叫「${kw}」的人。` }, { kind: 'hint', text: '发「资助」看此地可资助的人。' }] };
  }
  const def = world.data.npcs[target.defId] || {};
  const npcName = target.name || def.name || target.defId;
  if (target.home || def.home) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npcName}已有住处，不必你操心。` }] };
  }
  if (est.sponsored[target.defId]) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npcName}的家你已经资助过了。` }] };
  }

  const tier = NPC_TIERS.find(t => (tierKw && (t.name === tierKw || t.id === tierKw))) || NPC_TIERS[0];
  if (p.money < tier.cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `给${npcName}盖${tier.name}要 ${tier.cost} 文，你只有 ${p.money} 文。` }] };
  }

  /* 好感太低人家不肯要 */
  const favor = target.favor || def.favor || 0;
  if (favor < 20) {
    return { ok: false, lines: [
      { kind: 'warn', text: `${npcName}与你不过点头之交（好感 ${Math.round(favor)}），未必肯受你这番好意。` },
      { kind: 'hint', text: '先与他处些日子，好感到了 20 再来。' },
    ] };
  }

  /* 找地方挂 */
  const host = home.findHostFang(world, 'hm_npc_' + target.defId);
  if (!host) return { ok: false, lines: [{ kind: 'warn', text: '一时寻不着空地起屋，改日再说。' }] };

  p.money -= tier.cost;
  const hmId = 'hm_npc_' + target.defId;
  world.data.rooms[hmId] = {
    id: hmId, name: npcName + '的家', region: host.region,
    desc: tier.name + '，收拾得干干净净，灶上还有余温。',
    exits: {}, owner: target.defId, private: false,
    homeTier: tier.id, homeCapacity: tier.capacity, furniture: [],
  };
  attachRoom(world, host.fang, host.dir, world.data.rooms[hmId]);

  /* 写回：实例 + 模板（模板决定作息夜归） */
  target.home = hmId;
  if (def) { def.home = hmId; }
  if (!target.def.schedule) target.def.schedule = {};
  if (!target.def.schedule.night) target.def.schedule.night = hmId;

  /* 好感涨：有家的人心里踏实，也记你的好 */
  const social = require('./social');
  let favorLines = [];
  try {
    const r = social.addFavor(world, target, 12 + tier.cost / 400, '资助建家');
    favorLines = r && r.lines ? r.lines : [];
  } catch (e) { /* addFavor 失败不阻断建家 */ }
  target.mood = Math.min(100, (target.mood || 50) + 10);

  est.sponsored[target.defId] = { roomId: hmId, tier: tier.id, spentAt: world.clockMinutes || 0, cost: tier.cost };

  return { ok: true, lines: [
    { kind: 'title', text: '【 起 屋 】' },
    { kind: 'story', text: `你出了 ${tier.cost} 文，替${npcName}在${host.region}寻了块地，盖起一间${tier.name}。` },
    { kind: 'plain', text: `　${world.data.rooms[hmId].desc}` },
  ].concat(favorLines).concat([
    { kind: 'sys', text: `　${npcName}夜里便回自己的家了。` },
    { kind: 'hint', text: '（日后他对你更亲近些。）' },
  ]) };
}

/** 我资助过的人家（存档摘要用） */
function sponsoredList(world) {
  const est = data(world);
  if (!est) return [];
  return Object.keys(est.sponsored || {}).map(id => {
    const d = world.data.npcs[id] || {};
    const s = est.sponsored[id];
    const r = world.getRoom(s.roomId);
    return { npcId: id, name: d.name || id, roomId: s.roomId, roomName: r ? r.name : s.roomId, tier: s.tier, cost: s.cost };
  });
}

module.exports = {
  PLOTS, PLOT_MAP, NPC_TIERS, TIER_ORDER,
  data, homeTierOrder, plotLevel, plotEffect, estateEffects, attachRoom,
  listPlots, buildPlot,
  listNpcCandidates, sponsorNpcHome, sponsoredList,
};