/* ============================================================
 * gen-treasury-place.js — 重地（藏经阁 / 藏宝阁 / 国库 / 衙门库房）
 *   → game/data/82_treasury_place.json
 *
 * 依据 design/44 R5：藏经阁分三层存**非本门派**武学（要身份+贡献）；
 * 藏宝阁管武器/丹药/符箓/阵法/宝物/天材地果；皇宫有国库、衙门有库房；
 * 这些地方由「扫地僧」级高手把守 —— 一流势力一流高手守，二流二流守。
 *
 * 房间布局：山门（或门派地盘）→ 藏经阁 ⇅ 藏宝阁（内部用 u/d，绝不与朝外的门抢方向）
 * ⚠️ 只写 82 一个文件。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '82_treasury_place.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

try { fs.unlinkSync(OUT); } catch (e) { /* 首次 */ }
const e0 = new GameEngine({ seed: 20261011 });
e0.boot();
const w0 = e0.world;
const ROOMS = w0.data.rooms;
const SECTS = w0.data.sects;
const TRE = (w0.data.treasury || {});

const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
const DIRS = ['e', 'w', 's', 'n', 'ne', 'nw', 'se', 'sw'];
const usedDirs = {};

function attach(region, gateId, preferId) {
  const pool = Object.values(ROOMS).filter(r => r.region === region && !r._privateHost && /^基础数据:50_map\.json$/.test(r.__source || ''));
  if (preferId && ROOMS[preferId]) pool.unshift(ROOMS[preferId]);
  for (const r of pool) {
    const taken = Object.keys(r.exits || {}).concat([...(usedDirs[r.id] || [])]);
    const d = DIRS.find(x => taken.indexOf(x) < 0);
    if (d) {
      (usedDirs[r.id] = usedDirs[r.id] || new Set()).add(d);
      return { host: r.id, dir: d };
    }
  }
  return null;
}

const rooms = {};
const npcs = {};
const patch = {};

const GUARD_BY_TIER = (TRE.guard && TRE.guard.byTier) || { 一流: 'A', 二流: 'B', 三流: 'C' };

/* ⚠️ act1 锁区（design/96 G6，2026-10-16 游有方）：
 * 82 按文件名排在 50_map 之后加载，exits 按键合并「后载胜」——host 出口若写裸字符串，
 * 会把 50_map 里的门对象整个抹掉（2026-10-16 穷举验收实锤：fresh 档 huashan_library 可达）。
 * 华山藏经阁的 host 边必须抄回全量门对象（新分片抄回旧条目铁律），挂点也钉死不动，
 * 否则 attach 按「空闲方向」挑点会在 50_map 已占 s 之后漂移改拓扑。 */
const PINNED_ATTACH = { huashan: { host: 'road_huashan_1', dir: 's' } };
const HOST_GATED_EXIT = {
  huashan: {
    to: 'huashan_library',
    cond: { flag: 'act1_recognized' },
    /* 93 口径：say=被拦时守阁弟子说的话（先出口），msg=兜底（有 say 永不出口），
       travel=放行过场。2026-10-16 对调过一轮，别再装反。 */
    say: '守阁的弟子伸手拦住：「藏经阁是本门重地。你不是本门的人，这名头也还没挣到阁前。」',
    msg: '守阁的弟子拦在阁前。',
    travel: '你放轻脚步进了藏经阁。守阁弟子坐回门槛，接着晒他的太阳。',
  },
};

/* ⚠️ 两条硬不变量（smoke-npc-skills 会钉）：
   ① 每个槽上的功法都必须在 `learned` 里有等级——否则战斗里 skillLevel 取 0，等于没学；
   ② 兵刃系招式必须配得上对应兵器，不然 weaponPenalty 给 ×0.45。

   ⚠️ 2026-10-08 设定一致性审计发现的第三件事：守卫原来一律用**江湖通用**的棍法
      （`jh_staff`/`jh_neigong`），于是「华山派的扫地僧」一门华山功夫都不会 ——
      写在名字里的门派和他手上的功夫对不上。重地的守卫是本门的人（扫地僧本来就是
      藏在自家藏经阁里的高人），改成本派武学：招牌招式 + 本派内功，兵刃跟着招式走。 */
const SLOT_WPN = { 剑: 'fine_sword', 刀: 'iron_blade', 棍: 'bamboo_stick', 鞭: 'long_whip', 拳: null };

function guardKit(s, tier) {
  const lv = tier === 'A' ? 500 : tier === 'B' ? 300 : 120;
  const pool = [].concat(s.skills || [], s.entrySkills || [])
    .map(id => w0.data.skills[id]).filter(Boolean);
  const ng = pool.find(k => k.type === '内功');
  const wp = pool.find(k => ['剑', '刀', '棍', '鞭', '拳'].includes(k.type));
  const skills = {}, learned = {};
  if (wp) { skills[wp.type] = wp.id; learned[wp.id] = { level: lv }; }
  else { skills['棍'] = 'jh_staff'; learned['jh_staff'] = { level: lv }; }
  const ngId = ng ? ng.id : 'jh_neigong';
  skills['内功'] = ngId; learned[ngId] = { level: Math.round(lv * 0.9) };
  return { skills, learned, wpn: wp ? SLOT_WPN[wp.type] : 'bamboo_stick' };
}

let made = 0;
for (const [sid, s] of Object.entries(SECTS)) {
  if (sid === 'xiake') continue;                    // 秘境不设重地
  const tier = s.tier || '三流';
  const isSmall = tier === '三流';
  const hub = `${sid}_hall`;                        // 新门派的演武场

  /* ---- 藏经阁（三流门派没有，它们只配一间库房） ---- */
  if (!isSmall) {
    const libId = `${sid}_library`;
    if (PINNED_ATTACH[sid]) {
      (usedDirs[PINNED_ATTACH[sid].host] = usedDirs[PINNED_ATTACH[sid].host] || new Set()).add(PINNED_ATTACH[sid].dir);
      var at = PINNED_ATTACH[sid];
    } else {
      var at = attach(s.region, libId, ROOMS[hub] ? hub : null);
    }
    if (!at) continue;
    rooms[libId] = {
      id: libId, name: `${s.name}·藏经阁`, region: s.region,
      desc: '一架一架的书，从地面堆到梁上。窗纸糊得厚，屋里终年不见太阳，纸味与霉味混在一处。',
      exits: { [OPP[at.dir]]: at.host, u: `${sid}_vault` },
      treasuryKind: 'library', treasurySect: sid,
      actions: [{ label: '翻看经卷', cmd: '藏经阁', keywords: ['藏经阁', '经卷', '看书'], desc: '按牌子进层' }],
    };
    patch[at.host] = patch[at.host] || { id: at.host, exits: {} };
    patch[at.host].exits[at.dir] = HOST_GATED_EXIT[sid] || libId;

    const vId = `${sid}_vault`;
    rooms[vId] = {
      id: vId, name: `${s.name}·藏宝阁`, region: s.region,
      desc: '木架上分着格子，兵器、瓶罐、符纸、几支乌黑的根茎。每格里都插着一片木牌，写着名目。',
      exits: { d: libId },
      treasuryKind: 'vault', treasurySect: sid,
      actions: [{ label: '看货架', cmd: '藏宝阁', keywords: ['藏宝阁', '货架', '换东西'], desc: '用贡献兑换' }],
    };
    made += 2;
  } else {
    /* 三流：一间库房，货少、门槛低 */
    const vId = `${sid}_vault`;
    const at = attach(s.region, vId, ROOMS[hub] ? hub : null);
    if (!at) continue;
    rooms[vId] = {
      id: vId, name: `${s.name}·库房`, region: s.region,
      desc: '一间不大的屋子，堆着几口箱子，箱盖半开着。看屋的老头坐在门口打盹。',
      exits: { [OPP[at.dir]]: at.host },
      treasuryKind: 'vault', treasurySect: sid,
      actions: [{ label: '看箱子', cmd: '藏宝阁', keywords: ['库房', '箱子', '换东西'], desc: '用贡献兑换' }],
    };
    patch[at.host] = patch[at.host] || { id: at.host, exits: {} };
    patch[at.host].exits[at.dir] = vId;
    made += 1;
  }

  /* ---- 守卫：扫地僧级（按门派层级配） ---- */
  const guardTier = GUARD_BY_TIER[tier] || 'C';
  const firstRoom = isSmall ? `${sid}_vault` : `${sid}_library`;
  const nm = ((TRE.guard && TRE.guard.names && TRE.guard.names[tier]) || ['看门的老头'])[0];
  npcs[`${sid}_keeper`] = {
    id: `${sid}_keeper`, name: `${s.name}的${nm}`, title: '守库人', gender: 'male',
    room: firstRoom, sect: sid, rank: 4, tier: guardTier,
    desc: `${TRE.guard ? TRE.guard.line : ''}扫帚放在脚边，手却一直没动过。`,
    attr: { 力量: 45, 根骨: 50, 身法: 48, 悟性: 40, 福缘: 30, 定力: 60, 资质: 40 },
    hp: guardTier === 'A' ? 3600 : guardTier === 'B' ? 2000 : 900,
    mp: guardTier === 'A' ? 2800 : guardTier === 'B' ? 1500 : 600,
    atk: guardTier === 'A' ? 320 : guardTier === 'B' ? 200 : 100,
    def: guardTier === 'A' ? 200 : guardTier === 'B' ? 130 : 60,
    dodge: guardTier === 'A' ? 170 : guardTier === 'B' ? 110 : 50,
    parry: guardTier === 'A' ? 160 : guardTier === 'B' ? 100 : 50,
    speed: guardTier === 'A' ? 90 : guardTier === 'B' ? 70 : 45,
    skills: guardKit(s, guardTier).skills,
    learned: guardKit(s, guardTier).learned,
    ...(guardKit(s, guardTier).wpn ? { equipment: { 武器: guardKit(s, guardTier).wpn } } : {}),
    hostile: false, leavesCorpse: false, teach: [], quests: [],
    talk: [TRE.guard ? TRE.guard.line : '', '要看什么，先亮牌子。'],
    ask: [{ topic: '重地', keywords: ['藏经阁', '藏宝阁', '库房'], answer: '「门里的规矩：有功劳、有身份，才准进去。进去看什么也要花贡献。」' }],
  };
}

/* ---- 皇宫国库 ---- */
{
  const at = attach('palace', 'palace_treasury');
  if (at) {
    rooms['palace_treasury'] = {
      id: 'palace_treasury', name: '皇宫·国库', region: 'palace',
      desc: '库门是两层的，外头一层木、里头一层铁。架子上摆的东西不多，每一件前头都立着黄绸条。',
      exits: { [OPP[at.dir]]: at.host },
      treasuryKind: 'royal',
      actions: [{ label: '看册子', cmd: '藏宝阁', keywords: ['国库', '册子', '换东西'], desc: '用功劳兑换' }],
    };
    patch[at.host] = patch[at.host] || { id: at.host, exits: {} };
    patch[at.host].exits[at.dir] = 'palace_treasury';
    npcs['royal_keeper'] = {
      id: 'royal_keeper', name: '守库太监', title: '内库管事', gender: 'male',
      room: 'palace_treasury', rank: 4, tier: 'A',
      desc: '脸上没有胡子，说话很轻。手里的册子翻了二十年，翻得边角都软了。',
      attr: { 力量: 35, 根骨: 45, 身法: 55, 悟性: 55, 福缘: 30, 定力: 65, 资质: 40 },
      hp: 3000, mp: 2600, atk: 300, def: 180, dodge: 180, parry: 150, speed: 95,
      skills: { 拳: 'con_xuanjia_fist', 内功: 'con_jinyi_neigong' },
      learned: { con_xuanjia_fist: { level: 520 }, con_jinyi_neigong: { level: 500 } },
      hostile: false, leavesCorpse: false, teach: [], quests: [],
      talk: ['国库不是谁都能进的。', '有功劳的，册子上有名字。'],
      ask: [{ topic: '国库', keywords: ['国库', '赏赐'], answer: '「圣上有旨，有功之臣可按功劳领物。册子在这儿，各取所需。」' }],
    };
  }
}

/* ---- 衙门库房（已有 jn_yamen_store）：加记号 + 守卫 ---- */
rooms['jn_yamen_store'] = { id: 'jn_yamen_store', treasuryKind: 'house' };
if (!ROOMS['jn_yamen_store'] || !Object.values(npcs).some(n => n.id === 'yamen_store_keeper')) {
  npcs['yamen_store_keeper'] = {
    id: 'yamen_store_keeper', name: '守库老吏', title: '库吏', gender: 'male',
    room: 'jn_yamen_store', rank: 2, tier: 'B',
    desc: '背有点驼，腰间挂着一大串钥匙。看谁都先看腰牌。',
    attr: { 力量: 30, 根骨: 40, 身法: 30, 悟性: 45, 福缘: 30, 定力: 55, 资质: 30 },
    hp: 1200, mp: 700, atk: 130, def: 90, dodge: 60, parry: 60, speed: 50,
    skills: { 棍: 'jh_staff' }, learned: { jh_staff: { level: 180 } }, equipment: { 武器: 'bamboo_stick' },
    hostile: false, leavesCorpse: false, teach: [], quests: [],
    talk: ['库里的东西都有册子，少一件我担不起。'],
    ask: [{ topic: '库房', keywords: ['库房', '公文'], answer: '「官家的东西，得有身份才动得了。你若是白身，看看也就罢了。」' }],
  };
}

fs.writeFileSync(OUT, JSON.stringify({ rooms: Object.assign({}, rooms, patch), npcs }, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('重地房间', made + 1, '间（含国库）；守卫 NPC', Object.keys(npcs).length, '个');
