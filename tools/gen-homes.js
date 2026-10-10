/* ============================================================
 * gen-homes.js —— 家园 + 年龄 生成器（第二批：结婚系统前置）
 *
 * 干三件事：
 *   ① 给每个社交 NPC 补 age（按身份给合理区间）
 *   ② 给每个有家的 NPC 生成「专属宅院」房间（一人一家）
 *        命名：未婚 → 「某某某的家」
 *              已婚 → 「某某某与某某某的家」（结婚系统批次会改）
 *        挂到该 NPC 常驻区域的一条街巷上
 *   ③ 修掉错配的「家」：衙门库房 / 书院讲堂 / 当铺 / 客栈…
 *        这些不是住宅，改挂到真正的民居街巷
 *
 * 幂等：房间 id 用 hm_<npcId>，已存在就跳过；NPC 已有 home 且是
 *       hm_* 格式则跳过。重复跑安全。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'game', 'data', '50_map.json');
const NPC_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');

const mapDoc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const npcDoc = JSON.parse(fs.readFileSync(NPC_FILE, 'utf8'));
const rooms = mapDoc.rooms;
const npcs = npcDoc.npcs;

/* ⚠️ B13 守卫（design/19-map-rebalance.md R4）：本脚本会写 50_map.json（加 `hm_*` 私宅与巷道）。
 * B13 已重排世界区块并手工校正过严格反向边，重跑本脚本会扰动成品数据。
 * 确需重建：FORCE_GEN_HOMES=1 node tools/gen-homes.js。 */
if (process.env.FORCE_GEN_HOMES !== '1' && ['ly_home_01', 'many_ruin', 'secret_cage'].some(id => rooms[id])) {
  console.error('[gen-homes] 检测到地图已是 B13 世界区块重设计后的版本，拒绝在成品数据上运行。');
  console.error('          如确需重建：FORCE_GEN_HOMES=1 node tools/gen-homes.js（会扰动 B13 手改）。');
  process.exit(2);
}

/* ---------- 可复现随机 ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261009);
const pick = arr => arr[Math.floor(rng() * arr.length)];
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));

/* ---------- 方向工具（与 gen-map.js 保持一致） ---------- */
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };

/** 在 a 上找一个能用的方向连到 b。
 *  prefer 里的方向优先试；不传就按 DIRS 顺序。 */
function linkPrefer(a, b, prefer, back) {
  if (!rooms[a] || !rooms[b]) return false;
  rooms[a].exits = rooms[a].exits || {};
  rooms[b].exits = rooms[b].exits || {};
  const order = (prefer || []).concat(DIRS);
  for (const dir of order) {
    if (rooms[a].exits[dir]) continue;
    const bk = back || BACK[dir];
    if (bk && rooms[b].exits[bk]) continue;
    rooms[a].exits[dir] = b;
    if (bk) rooms[b].exits[bk] = a;
    return true;
  }
  return false;
}

function link(a, dir, b, back) {
  if (!rooms[a] || !rooms[b]) return false;
  rooms[a].exits = rooms[a].exits || {};
  rooms[b].exits = rooms[b].exits || {};
  let useDir = dir;
  if (rooms[a].exits[useDir]) {
    const used = new Set(Object.keys(rooms[a].exits));
    useDir = DIRS.find(d => !used.has(d)) || null;
    if (!useDir) return false;      /* 8 个方向全满，放弃 */
  }
  let useBack = back || BACK[useDir] || null;
  if (useBack && rooms[b].exits[useBack]) {
    const usedB = new Set(Object.keys(rooms[b].exits));
    useBack = DIRS.find(d => !usedB.has(d)) || null;
  }
  rooms[a].exits[useDir] = b;
  if (useBack) rooms[b].exits[useBack] = a;
  return true;
}

/** 宅院挂在坊上时占用的方向（把 e/w 留给「坊串坊」） */
const FANG_DIRS = ['n', 's', 'ne', 'nw', 'se', 'sw'];

/** 某区域里所有「还有空闲方向」的房间，按空闲数从多到少排。
 *  用于给坊找入口 —— 主干道（长街/柳巷/东市大街）的 8 个方向
 *  在 gen-map 阶段就被占满了，硬连根本连不上（踩过：
 *  jiangnan/market/cunzhen 三个区域的坊一个都建不出来）。 */
function freeDoors(region) {
  const out = [];
  for (const rid of Object.keys(rooms)) {
    const r = rooms[rid];
    if (r.region !== region) continue;
    if (rid.startsWith('hm_') || rid.startsWith('fang_')) continue;   /* 别拿宅院/坊当入口 */
    const used = Object.keys(r.exits || {}).length;
    if (used < 8) out.push({ id: rid, free: 8 - used });
  }
  return out.sort((a, b) => b.free - a.free);
}

/** 保证某区域至少有 n 个坊。
 *  入口策略：优先用指定街巷，满了就在区域里扫其他有空位的房间；
 *  坊之间用 e/w 串成链，把其余 6 个方向留给宅院。
 *
 *  ⚠ 必须「先建坊、再挂宅」——否则坊的方向会被宅院先占满，
 *  后面的坊连不上（踩过：只建出 8 个坊，192 个宅院挂不上）。 */
function ensureFangs(region, preferredStreet, n) {
  /* 收集所有可能的入口（优先 preferredStreet，再按空闲度排） */
  const doors = freeDoors(region);
  const ordered = [];
  if (preferredStreet && rooms[preferredStreet]) ordered.push(preferredStreet);
  for (const d of doors) if (!ordered.includes(d.id)) ordered.push(d.id);
  if (!ordered.length) return 0;

  let count = 0;
  let di = 0;
  for (let i = 1; i <= n; i++) {
    const fid = 'fang_' + region + '_' + i;
    if (!rooms[fid]) {
      /* 找一个还能连的入口 */
      let anchor = null;
      while (di < ordered.length) {
        const cand = ordered[di];
        if (rooms[cand] && Object.keys(rooms[cand].exits || {}).length < 8) { anchor = cand; break; }
        di++;
      }
      if (!anchor) return count;
      /* 先建坊体，再连边（连不上就撤掉，别留孤儿房间） */
      rooms[fid] = {
        id: fid,
        name: FANG_NAME(region) + (i > 1 ? '·第' + CN_NUM(i) + '弄' : ''),
        region: region,
        desc: '一条窄窄的里弄，两侧挨着一扇扇院门。晾衣绳横在头顶，谁家飘出饭菜香。寻常百姓的日子，就藏在这一扇扇门后头。',
        exits: {},
      };
      /* 坊与入口之间：随便找个空方向（方向语义在这里不重要，连通优先） */
      if (!linkPrefer(anchor, fid, null, null)) { delete rooms[fid]; return count; }
      /* 新坊本身也是后续坊的可用入口（把 e/w 留给「坊串坊」） */
      if (Object.keys(rooms[fid].exits || {}).length < 8) ordered.push(fid);
    }
    count++;
  }
  return count;
}

/** 往「民居坊」上挂一个宅院（宅院永远是叶子，绝不互连）。 */
function attachHome(hmId, region) {
  for (let i = 1; i <= 300; i++) {
    const fid = 'fang_' + region + '_' + i;
    const f = rooms[fid];
    if (!f) return null;
    if (linkPrefer(fid, hmId, FANG_DIRS, null)) return fid;
  }
  return null;
}

/** 坊名：按区域取个有味道的名字 */
function FANG_NAME(region) {
  const M = {
    jiangnan: '巷陌', market: '东市·里弄', cunzhen: '村中里弄',
    yamen: '衙后小巷', shuyuan: '书院后巷', harbor: '码头·脚夫巷',
    farmland: '佃户里弄', gusu: '姑苏小巷', wild: '野径深处',
  };
  return M[region] || '里弄';
}
function CN_NUM(n) {
  const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 9) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
}

/* ============================================================
 * 一、补年龄
 * 身份 → [最小, 最大]
 * 孩童 6~13；少年 14~17；青壮 18~44；中年 45~60；老年 61~80
 * ============================================================ */
const AGE_RANGE = {
  child:     [6, 13],
  beggar:    [12, 62],
  refugee:   [16, 58],
  scholar:   [17, 46],
  constable: [20, 48],
  official:  [34, 62],
  judge:     [42, 66],
  eunuch:    [22, 58],
  guard:     [18, 40],
  shopkeeper:[26, 60],
  innkeeper: [30, 62],
  waiter:    [15, 40],
  waiter2:   [15, 40],
  cook:      [22, 55],
  farmer:    [17, 60],
  hunter:    [20, 50],
  smith:     [22, 56],
  doctor:    [28, 65],
  taoist:    [22, 70],
  monk:      [18, 68],
  nun:       [18, 66],
  swordsman: [18, 50],
  escort:    [20, 50],
  thief:     [16, 45],
  gambler:   [20, 55],
  actor:     [14, 40],
  singer:    [13, 30],
  courtesan: [15, 32],
  madam:     [34, 58],
  boatman:   [22, 58],
  merchant:  [26, 60],
  richman:   [34, 66],
  official2: [34, 62],
  noble:     [16, 60],
  palace:    [14, 35],
  consort:   [15, 32],
  general:   [30, 58],
  bodyguard: [18, 42],
  bandit:    [18, 48],
  fisherman: [20, 60],
  woodman:   [18, 58],
  herdsman:  [16, 55],
  weaver:    [16, 52],
  potter:    [20, 58],
  storyteller:[28, 68],
  fortune:   [30, 66],
  pawnbroker:[30, 62],
  servant:   [15, 50],
  maid:      [13, 38],
};

let ageSet = 0;
for (const id of Object.keys(npcs)) {
  const n = npcs[id];
  if (!n.socialDone) continue;
  if (n.age && n.age > 0) continue;
  const rg = AGE_RANGE[n.tag] || [18, 55];
  n.age = int(rg[0], rg[1]);
  ageSet++;
}

/* ============================================================
 * 二、可挂住宅的「街巷」白名单
 * 每个区域列出适合建宅的房间 id（街、巷、村道之类）
 * ============================================================ */
const AREA_STREETS = {
  jiangnan: ['jn_resident_1', 'jn_resident_2', 'jn_resident_3', 'jiangnan_street', 'jiangnan_east_road', 'jiangnan_west_road'],
  market:   ['jn_market_main', 'jn_market_north', 'jn_market_south', 'jn_market_west', 'jn_market_east'],
  cunzhen:  ['cunzhen_street', 'cunzhen_gate', 'cunzhen_pond', 'cunzhen_mill'],
  yamen:    ['jn_market_west', 'jiangnan_street'],
  shuyuan:  ['jn_school_yard', 'jn_market_west'],
  harbor:   ['jn_harbor', 'jn_harbor_wharf'],
  farmland: ['jn_farm_road', 'jn_farm_1'],
  gusu:     ['gusu_town'],
  wild:     ['jiangnan_west_road', 'jiangnan_east_road'],
};

/* 给 NPC 找一个「家在哪个区域」的依据：
   - 优先看他白天常待的房间属于哪个区域（schedule.day / room）
   - 该区域没白名单就退回 jiangnan */
function areaOfNpc(n) {
  const rid = (n.schedule && n.schedule.day) || n.room;
  const r = rooms[rid];
  if (r && AREA_STREETS[r.region]) return r.region;
  return 'jiangnan';
}

/* 宅院描述模板：按身份换味道 */
const DESC_BY_TAG = {
  richman:  '朱漆大门，门楣上挂着匾额，两尊石狮蹲在阶前。墙内隐约有假山流水，是户殷实人家。',
  official: '门第森严，门前立着旗杆，阶石磨得发亮。往来的人到了这儿都不自觉放轻了脚步。',
  merchant: '院里堆着货箱，墙角还靠着杆秤，一股子生意人的气味。',
  smith:    '院墙被炉火熏得发黑，墙根码着铁料和半成的农具。',
  farmer:   '土墙小院，门口晒着农具和一小片金黄谷子，鸡在脚边刨食。',
  scholar:  '院里种着一丛竹，窗纸透着灯影，隐约听见翻书的窸窣声。',
  doctor:   '门前挂着一串风干的药草，风一吹，整条巷子都是苦香。',
  monk:     '院落清净，一株老树，石阶上扫得不见落叶。',
  taoist:   '院中摆着一方石台，台上燃着残香，烟气袅袅地散。',
  beggar:   '半塌的土坯墙，柴草堆里塞着几件破家什。',
  default:  '青砖小院，院里有口井、一架葡萄藤。日头偏西时，能听见里头锅铲响。',
};

const NAME_PREFIX = { jiangnan: '', market: '', cunzhen: '', yamen: '', shuyuan: '', harbor: '', farmland: '', gusu: '', wild: '' };

/* ============================================================
 * 三、为「该有家的」NPC 生成专属宅院
 * ============================================================ */
const NO_HOME_TAGS = new Set(['beggar', 'refugee', 'child', 'eunuch', 'palace', 'consort', 'courtesan', 'singer']);

/* 错配集合：这些房间不是住宅，别当「某某的家」 */
const BAD_HOME = /库房|藏书楼|讲堂|明伦堂|当铺|客栈|斋|药圃|柴房|库|仓|棚|圈|舍|寺|庙|堂|殿|阁|楼|局|房$/;

/* 先算出每个 NPC 的最终家园房间 id */
let created = 0, reused = 0, moved = 0;

/* 收集「已经被当成家」的 npc 列表 */
const socialIds = Object.keys(npcs).filter(id => npcs[id].socialDone);

/* ── 阶段 A：先数人头，预建足够的坊 ──
   每坊能挂 6 个宅院（FANG_DIRS 有 6 个）。多建 1 个当余量。
   ⚠ 必须先建坊再挂宅：坊之间要靠 e/w 串联，
     如果先挂宅把方向占满，后面的坊就连不上了。 */
const areaCount = {};
for (const id of socialIds) {
  const n = npcs[id];
  if (NO_HOME_TAGS.has(n.tag)) continue;
  const a = areaOfNpc(n);
  areaCount[a] = (areaCount[a] || 0) + 1;
}
let fangTotal = 0;
for (const area of Object.keys(areaCount)) {
  const streets = AREA_STREETS[area] || AREA_STREETS.jiangnan;
  const anchor = streets.find(s => rooms[s]) || 'jiangnan_street';
  const need = Math.ceil(areaCount[area] / 6) + 1;
  fangTotal += ensureFangs(area, anchor, need);
}

/* 阶段 B：逐个挂宅院 */
for (const id of socialIds) {
  const n = npcs[id];
  if (NO_HOME_TAGS.has(n.tag)) continue;

  const hmId = 'hm_' + id;
  const area = areaOfNpc(n);

  /* 已经指向 hm_* 的，确认房间在，跳过 */
  if (n.home === hmId && rooms[hmId]) { reused++; continue; }

  /* 原 home 是「合理的民居」吗？不合理就换掉 */
  const old = n.home && rooms[n.home] ? rooms[n.home] : null;
  const oldName = old ? old.name : '';
  const oldOk = old && !BAD_HOME.test(oldName) && /宅|家|院|第|屋/.test(oldName);
  if (n.home && n.home !== hmId) moved++;

  /* 创建专属宅院 */
  if (!rooms[hmId]) {
    const prefix = NAME_PREFIX[area] || '';
    const hostName = n.name.length > 4 ? n.name.slice(0, 3) : n.name;
    const homeName = prefix + hostName + '的家';
    const desc = DESC_BY_TAG[n.tag] || DESC_BY_TAG.default;
    rooms[hmId] = {
      id: hmId,
      name: homeName,
      region: area,
      desc: `${homeName}。${desc}`,
      exits: {},
      private: true,
      owner: id,
    };
    created++;
  }

  /* 挂到该区域的「民居坊」上 */
  const fid = attachHome(hmId, area);
  if (fid) {
    rooms[hmId].region = rooms[fid].region;
  } else {
    /* 该区域坊不够（理论不会发生，预建时留了余量）→ 当场补建并挂 */
    const streets = AREA_STREETS[area] || AREA_STREETS.jiangnan;
    const anchor = streets.find(s => rooms[s]) || 'jiangnan_street';
    ensureFangs(area, anchor, rooms[fid] ? 1 : 20);
    const f2 = attachHome(hmId, area);
    if (f2) rooms[hmId].region = rooms[f2].region;
  }

  n.home = hmId;
  if (!n.schedule) n.schedule = { day: n.room, night: hmId };
  else n.schedule.night = hmId;
}

/* ============================================================
 * 四、反向修正：把「夫妻同住」的场景先留空，
 *     结婚系统批次会动态生成「某某与某某的家」。
 *     这里只保证：一人一宅，名字是「某某的家」。
 * ============================================================ */

/* ============================================================
 * 五、反清理：居无定所的身份不该有家
 *     （孩童 / 乞丐 / 流民 / 太监 / 宫人 / 秀女 / 风尘 / 歌伎）
 *     上一轮 gen-social 可能给它们误挂了 home，这里摘掉。
 *     必须放在「检查遗留错配」之前，否则会误报。
 * ============================================================ */
let cleared = 0;
for (const id of socialIds) {
  const n = npcs[id];
  if (!NO_HOME_TAGS.has(n.tag)) continue;
  if (n.home) {
    n.home = null;
    if (n.schedule) n.schedule.night = null;
    cleared++;
  }
}

/* ============================================================
 * 六、检查：还有没有 NPC 指着公共房间当家
 * ============================================================ */
const stillBad = [];
for (const id of socialIds) {
  const n = npcs[id];
  if (!n.home) continue;
  const r = rooms[n.home];
  if (!r) { stillBad.push(id + '→' + n.home + '(不存在)'); continue; }
  if (!n.home.startsWith('hm_') && BAD_HOME.test(r.name) && !/宅|家/.test(r.name)) {
    stillBad.push(id + '→' + r.name);
  }
}

/* ============================================================
 * 保存
 * ============================================================ */
fs.writeFileSync(MAP_FILE, JSON.stringify(mapDoc, null, 2), 'utf8');
fs.writeFileSync(NPC_FILE, JSON.stringify(npcDoc, null, 2), 'utf8');

const totalRooms = Object.keys(rooms).length;
const homes = socialIds.filter(i => npcs[i].home && npcs[i].home.startsWith('hm_'));
const homeRooms = Object.keys(rooms).filter(r => r.startsWith('hm_'));
console.log('── 年龄 ──');
console.log('补了年龄的 NPC：', ageSet);
console.log('── 宅院 ──');
console.log('新建宅院：', created, '　复用：', reused, '　改挂：', moved);
console.log('宅院房间总数：', homeRooms.length);
console.log('有专属宅院的 NPC：', homes.length);
console.log('摘掉误挂家园的（居无定所身份）：', cleared);
console.log('房间总数：', totalRooms);
console.log('── 遗留错配 ──');
console.log('仍指向非住宅的 NPC：', stillBad.length);
if (stillBad.length) console.log('  ', stillBad.slice(0, 12).join('  '));
const ageAll = socialIds.map(i => npcs[i].age).filter(a => a > 0);
console.log('── 年龄分布 ──');
console.log('  最小', Math.min(...ageAll), '最大', Math.max(...ageAll), '均值', Math.round(ageAll.reduce((a, b) => a + b, 0) / ageAll.length));
console.log('  45 岁以下：', ageAll.filter(a => a < 45).length, '/', ageAll.length);
