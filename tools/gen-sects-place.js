/* ============================================================
 * gen-sects-place.js — 生成新门派的「地盘 + 人」(game/data/73_sects_place.json)
 *
 * 28 家新门派（8 二流 + 20 三流），每家两间房：
 *   `{id}_gate` 山门（掌门坐镇）  `{id}_hall` 演武场（弟子练功）
 * 山门向外接一间已有的公共房间，**用未占用的方向**，双向成对。
 *
 * ⚠️ 只写 73_sects_place.json 一个文件。
 * ⚠️ room.exits 是**对象、按键合并**，所以向已有房间补反向边只会「加一项」，
 *    不会冲掉它原有的出口 —— 这也是这里敢动老房间的原因。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '73_sects_place.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const SECTS = require(path.join(ROOT, 'game', 'data', '72_sects_tier.json')).sects;
const SK74 = require(path.join(ROOT, 'game', 'data', '74_martial_sects.json')).skills;

/* 兵刃系武学必须配得上对应兵器：不然 weaponPenalty 会给出 ×0.45 的暗削，
   玩家看到的是「这门派的掌门打人跟挠痒痒一样」。
   ⚠️ 槽位名要用**真实武学槽**（拳/剑/刀/棍/鞭/暗器/内功/轻功/招架）——
      曾经写成 `武器`（那是**装备**槽，pickSkill 根本不看），
      结果新门派的掌门一套武学全落空，只会抡拳。 */
const WEAPON_ITEM = { 剑: 'fine_sword', 刀: 'iron_blade', 棍: 'bamboo_stick', 鞭: 'long_whip' };
/** 取一门武学的真实槽位名（拳/剑/刀/棍/鞭/暗器） */
function sk78(table, id) { return (table[id] && table[id].type) || '拳'; }

/* 新门派 → 挂靠区域 + 接哪类公共房间 */
const PLAN = [
  { id: 'taishan', region: 'changan', host: 'changan' },
  { id: 'hengshan', region: 'xiangyang', host: 'xiangyang' },
  { id: 'hengshanN', region: 'changan', host: 'changan' },
  { id: 'qingcheng', region: 'chengdu', host: 'chengdu' },
  { id: 'kongtong', region: 'changan', host: 'changan' },
  { id: 'kunlun', region: 'xixia', host: 'xixia' },
  { id: 'diancang', region: 'dali', host: 'dali' },
  { id: 'tiezhang', region: 'xiangyang', host: 'xiangyang' },
  { id: 'jindao', region: 'luoyang', host: 'luoyang' },
  { id: 'wuhu', region: 'changan', host: 'changan' },
  { id: 'feihu', region: 'changan', host: 'changan' },
  { id: 'zhenyuan', region: 'luoyang', host: 'luoyang' },
  { id: 'shenquan', region: 'cunzhen', host: 'cunzhen' },
  { id: 'tieqiang', region: 'luoyang', host: 'luoyang' },
  { id: 'kuaidao', region: 'chengdu', host: 'chengdu' },
  { id: 'luohan', region: 'xiangyang', host: 'xiangyang' },
  { id: 'wuyun', region: 'chengdu', host: 'chengdu' },
  { id: 'dafeng', region: 'changan', host: 'changan' },
  { id: 'huanghe', region: 'harbor', host: 'harbor' },
  { id: 'taihu', region: 'gusu', host: 'gusu' },
  { id: 'poyang', region: 'gusu', host: 'gusu' },
  { id: 'qingzhu', region: 'jiangnan', host: 'jiangnan' },
  { id: 'jujing', region: 'harbor', host: 'harbor' },
  { id: 'jinlong', region: 'gusu', host: 'gusu' },
  { id: 'wuliang', region: 'dali', host: 'dali' },
  { id: 'funiu', region: 'xiangyang', host: 'xiangyang' },
  { id: 'baisheng', region: 'luoyang', host: 'luoyang' },
  { id: 'baituo', region: 'xixia', host: 'xixia' },
  /* 合欢宗：据点就设在青楼区（青楼背后的势力） */
  { id: 'hehuan', region: 'qinglou', host: 'qinglou' },
];

/* 方向的对边 */
const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
const DIRS = ['e', 'w', 's', 'n', 'ne', 'nw', 'se', 'sw'];

const e0 = new GameEngine({ seed: 20261011 });
/* ⚠️ 先把自己上一版产物删掉再 boot：否则本次读到的 exits 里已经含着
   「上一次分配出去的山门方向」，再分配就会往外继续加，而旧方向在本次产物里丢失 →
   那些老山门反而变成没有反向边的单向门。生成器必须从干净状态起算。 */
try { fs.unlinkSync(OUT); } catch (e) { /* 首次运行没有 */ }
e0.boot();
const w0 = e0.world;
const ROOMS = w0.data.rooms;
/* 每种挂靠区挑一批「能接客」的公共房间：优先名字带「街」「道」「广场」的。
   ⚠️ 必须是**一批**不是一间 —— 长安城里挤着 6 家山门，一间街面只有几个空方向，
      靠不上去就会退化成「同一个方向挂好几家」，后写的把先写的顶掉（map-check §2 成片红）。 */
const hostPool = {};
for (const p of PLAN) {
  if (hostPool[p.region]) continue;
  const pool = Object.values(ROOMS)
    .filter(r => r.region === p.region && !r._privateHost && r.id.indexOf('hm_') !== 0
      && /^基础数据:50_map\.json$/.test(r.__source || ''))
    .sort((a, b) => {
      const score = r => (/街|道|广场|镇|村|市/.test(r.name || '') ? 0 : 1);
      return score(a) - score(b);
    });
  hostPool[p.region] = pool.map(r => r.id);
}

const rooms = {};
const npcs = {};
const hostPatch = {};   // 已有房间需要补的反向出口
/* ⚠️ 已分配出去的方向必须**跨门派累积**：同一座城里挤着六七家山门，
   不累积就会出现「几家的门都挂在同一个方向」，后写的把先写的覆盖掉 →
   map-check §2「非严格反向」成片爆红。 */
const usedDirs = {};

const ATTR_BY_TIER = {
  1: { 力量: 52, 根骨: 55, 身法: 52, 悟性: 45, 福缘: 40, 定力: 55, 资质: 45 },   // 二流掌门
  2: { 力量: 34, 根骨: 36, 身法: 32, 悟性: 28, 福缘: 30, 定力: 34, 资质: 26 },   // 三流掌门
};

let seedIdx = 0;
for (const p of PLAN) {
  const s = SECTS[p.id];
  const gate = `${p.id}_gate`, hall = `${p.id}_hall`;
  const isB = s.tier === '二流';
  const tierCode = isB ? 1 : 2;

  /* 找一处还有空方向可挂的落脚点；一个都找不到就**报错退出**，
     绝不静默退回某个方向（那正是把别人出口顶掉的老路）。 */
  let host = null, dir = null;
  for (const rid of (hostPool[p.region] || [])) {
    const room = ROOMS[rid];
    const taken = Object.keys(room.exits || {}).concat([...(usedDirs[rid] || [])]);
    const d = DIRS.find(x => taken.indexOf(x) < 0);
    if (d) { host = rid; dir = d; break; }
  }
  if (!host) { console.error('✘ ' + p.id + ' 在 ' + p.region + ' 找不到可挂靠的房间（方向全满）'); process.exit(1); }
  (usedDirs[host] = usedDirs[host] || new Set()).add(dir);

  /* 山门内部用 u/d（上/下）通演武场 —— 绝不与「朝城里开的那个方向」抢键。
     🩸 曾经写成 { n: hall, [OPP[dir]]: host }：dir='s' 时 OPP='s'→'n'，
        两个字面量撞成同一个键，hall 被 host 覆盖，演武场当场成孤儿。 */
  rooms[gate] = {
    id: gate, name: `${s.name}·山门`, region: p.region,
    desc: `${s.story || s.desc}`,
    exits: { u: hall, [OPP[dir]]: host },
    actions: [{
      /* cmd 要带门派名 —— 前端点这个按钮就是把 `cmd` 当指令发出去；
         只写「拜师」的话后端会反问你「拜入哪个门派」，点了等于白点。 */
      cmd: `拜师 ${s.name}`, label: '拜入门下', keywords: ['拜师', '入门', '投师'],
      effects: [{ type: 'narrate', raw: `山门里走出一个人，上下打量了你两眼。` }],
      failMsg: null,
    }],
  };
  rooms[hall] = {
    id: hall, name: `${s.name}·演武场`, region: p.region,
    desc: `场子里三五个弟子正拆招，见有人来，停下手看你。地上踩出的脚印一层压着一层。`,
    exits: { d: gate },
    actions: [{
      cmd: '练功', label: '跟着比划', keywords: ['练功', '练武', '比划'],
      effects: [{ type: 'narrate', raw: `你照着他们的架子比划了两下，手臂有些酸。` }],
      failMsg: null,
    }],
  };
  // host 补反向出口
  hostPatch[host] = hostPatch[host] || { id: host, exits: {} };
  hostPatch[host].exits[dir] = gate;

  /* ---- NPC：掌门 + 弟子 ---- */
  const masterId = `${p.id}_master`, discId = `${p.id}_disciple`;
  const atkCore = `${p.id}_atk_3`, forceCore = `${p.id}_force_3`;
  const atkEntry = `${p.id}_atk_1`, forceEntry = `${p.id}_force_1`, guardEntry = `${p.id}_guard_1`, flyEntry = `${p.id}_fly_1`;
  /* 本门主兵器的**真实槽位名**（拳/剑/刀/棍/鞭/暗器）+ 对应兵器 */
  const atkSlot = (SK74[atkCore] && SK74[atkCore].type) || '拳';
  const wpnItem = WEAPON_ITEM[atkSlot] || null;
  // 掌门名：从 ranks 里取一个像样的称呼反推，直接用「{派}掌门」最稳（避免与人名冲突）
  const masterName = `${s.name}掌门`;
  npcs[masterId] = {
    id: masterId, name: masterName, title: isB ? '一派之主' : '当家',
    gender: 'male', room: gate, sect: p.id, rank: 5, tier: isB ? 'B' : 'C',
    desc: `${s.name}当家的。${isB ? '手上有几手真功夫，脾气也硬。' : '守着这一亩三分地，日子过得去。'}`,
    attr: ATTR_BY_TIER[tierCode],
    hp: isB ? 2400 : 900, mp: isB ? 1800 : 600,
    atk: isB ? 240 : 120, def: isB ? 150 : 70, dodge: isB ? 130 : 60, parry: isB ? 120 : 60, speed: isB ? 80 : 55,
    skills: isB
      ? { [atkSlot]: atkCore, 内功: forceCore, 招架: `${p.id}_guard_3`, 轻功: `${p.id}_fly_3` }
      : { [atkSlot]: atkEntry, 内功: forceEntry, 招架: guardEntry, 轻功: flyEntry },
    learned: isB
      ? { [atkCore]: { level: 420 }, [forceCore]: { level: 430 }, [`${p.id}_guard_3`]: { level: 360 }, [`${p.id}_fly_3`]: { level: 340 } }
      : { [atkEntry]: { level: 160 }, [forceEntry]: { level: 180 }, [guardEntry]: { level: 120 }, [flyEntry]: { level: 110 } },
    ...(wpnItem ? { equipment: { 武器: wpnItem } } : {}),
    hostile: false, leavesCorpse: false,
    teach: isB
      ? [atkEntry, atkCore, forceEntry, forceCore, `${p.id}_guard_1`, `${p.id}_guard_3`, `${p.id}_fly_1`, `${p.id}_qimen_3`]
      : [atkEntry, forceEntry, guardEntry, flyEntry],
    quests: [],
    talk: isB
      ? [`${s.trial || ''}`, '拜了师就是自家人，出门别丢门派的脸。', '本门的功夫，练得住才拿得走。']
      : ['想学啊？先交束脩。', '这里的功夫不值钱，管用就行。', '练熟了能看家护院，也就够了。'],
    ask: [{ topic: '门派', keywords: ['门派', '来历'], answer: s.story || s.desc }],
  };
  npcs[discId] = {
    id: discId, name: `${s.name}弟子`, title: '门中弟子',
    gender: seedIdx++ % 2 ? 'female' : 'male', room: hall, sect: p.id, rank: 1, tier: 'C',
    desc: `年纪不大，手上已经有了薄茧。`,
    attr: { 力量: 20, 根骨: 20, 身法: 18, 悟性: 16, 福缘: 15, 定力: 18, 资质: 14 },
    hp: 420, mp: 200, atk: 70, def: 35, dodge: 38, parry: 30, speed: 40,
    skills: { [atkSlot]: atkEntry, 内功: forceEntry },
    learned: { [atkEntry]: { level: 80 }, [forceEntry]: { level: 70 } },
    ...(wpnItem ? { equipment: { 武器: wpnItem } } : {}),
    hostile: false, leavesCorpse: false,
    teach: [], quests: [],
    talk: ['师父说过，招式练熟之前别出去丢人。', '你也是来学本事的？'],
    ask: [{ topic: '门派', keywords: ['门派', '师父'], answer: s.story || s.desc }],
  };
}

/* 少数**老**门派有地盘却没标 sect 的人（唐门 / 古墓）——
   门派之间要有摩擦、要大比、要邦交，前提是「这个门派真有人」。
   只补人，不动房间（房间早就有了）。 */
const EXTRA_MASTERS = [
  { id: 'tangmen', room: 'tangmen_gate', gender: 'male', name: '唐门门主', title: '门主' },
  { id: 'gumu', room: 'gumu_mu', gender: 'female', name: '古墓掌门', title: '掌门' },
];
for (const em of EXTRA_MASTERS) {
  const s = SECTS[em.id];
  const nid = `${em.id}_master`;
  if (npcs[nid]) continue;
  npcs[nid] = {
    id: nid, name: em.name, title: em.title, gender: em.gender,
    room: em.room, sect: em.id, rank: 5, tier: 'B',
    desc: `${s.name}当家的。`,
    attr: ATTR_BY_TIER[1],
    hp: 2400, mp: 1800, atk: 240, def: 150, dodge: 130, parry: 120, speed: 80,
    skills: { [sk78(SK74, `${em.id}_atk_3`)]: `${em.id}_atk_3`, 内功: `${em.id}_force_3`, 招架: `${em.id}_guard_3`, 轻功: `${em.id}_fly_3` },
    learned: {
      [`${em.id}_atk_3`]: { level: 420 }, [`${em.id}_force_3`]: { level: 430 },
      [`${em.id}_guard_3`]: { level: 360 }, [`${em.id}_fly_3`]: { level: 340 },
    },
    ...(WEAPON_ITEM[sk78(SK74, `${em.id}_atk_3`)] ? { equipment: { 武器: WEAPON_ITEM[sk78(SK74, `${em.id}_atk_3`)] } } : {}),
    hostile: false, leavesCorpse: false,
    teach: [`${em.id}_atk_1`, `${em.id}_atk_3`, `${em.id}_force_1`, `${em.id}_force_3`, `${em.id}_guard_1`, `${em.id}_qimen_3`],
    quests: [],
    talk: [s.trial || '进了这个门，就得守这个门的规矩。', '本门的功夫不外传。'],
    ask: [{ topic: '门派', keywords: ['门派', '来历'], answer: s.story || s.desc }],
  };
}

fs.writeFileSync(OUT, JSON.stringify({ rooms: Object.assign({}, rooms, hostPatch), npcs }, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('新房间', Object.keys(rooms).length, '（含给老房间补反向边 ' + Object.keys(hostPatch).length + ' 间）');
console.log('新 NPC', Object.keys(npcs).length);
console.log('挂靠点', JSON.stringify(Object.fromEntries(Object.entries(usedDirs).map(([k, v]) => [k, [...v]]))));
