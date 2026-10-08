/* ============================================================
 * gen-cities.js —— 多城市生成器
 *
 * 用户反馈：236 个 NPC 宅院全挤在江南，一个城独大。
 * 这里干两件事：
 *   ① 新建 4 座各有特色的大城（洛阳 / 长安 / 成都 / 襄阳），
 *      每城带 城门·主街·市集·酒楼·客栈·小巷·里弄，名字描述不重样。
 *   ② 把江南一批 NPC 的宅院迁到这些新城市（按 hash 均分），
 *      让江湖不再一城独大。
 *
 * 幂等：房间 id 用 {city}_ 前缀，已存在就跳过；迁移按「当前 region 在江南
 *       且 home 是 hm_*」判定，迁过的（region 已改）不会再迁。
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
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; }
  return h;
}

/* ---------- 方向工具 ---------- */
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
const FANG_DIRS = ['n', 's', 'ne', 'nw', 'se', 'sw'];

function link(a, dir, b, back) {
  if (!rooms[a] || !rooms[b]) return false;
  rooms[a].exits = rooms[a].exits || {};
  rooms[b].exits = rooms[b].exits || {};
  let useDir = dir;
  if (rooms[a].exits[useDir]) {
    const used = new Set(Object.keys(rooms[a].exits));
    useDir = DIRS.find(d => !used.has(d)) || null;
    if (!useDir) return false;
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

function addRoom(id, data) {
  if (rooms[id]) return false;
  rooms[id] = Object.assign({ id, exits: {} }, data);
  return true;
}

function defRegion(id, name, color) {
  mapDoc.regions = mapDoc.regions || {};
  if (!mapDoc.regions[id]) mapDoc.regions[id] = { id, name, color };
}

/* ============================================================
 * 一、四座新城的定义（每城差异化）
 * ============================================================ */
const CITIES = [
  {
    id: 'luoyang', name: '洛阳城', color: '#a05a2a',
    gate: '洛阳城·东门', street: '洛阳城·牡丹大街', market: '洛阳城·南市',
    tavern: '洛阳城·天香楼', tavernUp: '天香楼·牡丹雅间', inn: '洛阳城·龙门客栈',
    lane: '洛阳城·花巷', fangName: '洛阳里弄',
    gateDesc: '洛阳东门巍峨矗立，门楼飞檐斗拱，城下商旅络绎不绝。出了城往东，便是白马寺的方向。',
    streetDesc: '牡丹大街宽阔平坦，路旁植满牡丹，正值花期，满街繁花似锦。文人墨客三三两两，指点着哪一株开得最艳。',
    marketDesc: '南市热闹非凡，丝绸、瓷器、纸砚样样俱全。洛水畔的商户最会做生意，讨价还价声此起彼伏。',
    tavernDesc: '天香楼是洛阳头一号的酒楼，招牌的牡丹宴远近闻名。跑堂的肩上搭着白巾，唱菜名拖得老长。',
    tavernUpDesc: '牡丹雅间临窗而设，窗下正是满城牡丹。酒香与花香混在一起，未饮先醉了三分。',
    innDesc: '龙门客栈门脸不大，掌柜的是个络腮胡汉子，见人就笑。客房里收拾得干净，南来北往的客商都爱住这儿。',
    laneDesc: '花巷曲曲折折，两侧人家种满牡丹，院墙探出一枝枝春色。卖花姑娘提着竹篮，叫卖声脆生生的。',
    anchor: 'road_shaolin_1', anchorName: '嵩山道',
  },
  {
    id: 'changan', name: '长安城', color: '#8a4a4a',
    gate: '长安城·明德门', street: '长安城·朱雀大街', market: '长安城·西市',
    tavern: '长安城·醉仙楼', tavernUp: '醉仙楼·凌云阁', inn: '长安城·悦来客栈',
    lane: '长安城·平康坊', fangName: '长安里坊',
    gateDesc: '明德门是长安的正南门，五道门洞开，气象森严。城墙上旌旗猎猎，守军甲胄鲜明。',
    streetDesc: '朱雀大街笔直宽阔，可容数十骑并行。这是天下第一等的通衢大道，两侧坊墙高耸，车马如龙。',
    marketDesc: '西市是胡商云集之地，高鼻深目的胡人在卖葡萄美酒与琉璃珠串，驼铃叮当，异香扑鼻。',
    tavernDesc: '醉仙楼高达三层，李白斗酒诗百篇的传说就挂在中堂。酒客们击节而歌，好不热闹。',
    tavernUpDesc: '凌云阁在醉仙楼最高处，凭栏远眺，长安城尽收眼底。风从阁上过，吹得酒旗哗哗响。',
    innDesc: '悦来客栈是长安老字号，店小二迎来送往，一口地道的长安官话。客房宽敞，被褥松软。',
    laneDesc: '平康坊是长安最有名的里坊，青楼楚馆与寻常人家比邻而居。入夜灯火通明，笙歌不绝。',
    anchor: 'road_xiyu_1', anchorName: '西域古道',
  },
  {
    id: 'chengdu', name: '成都府', color: '#4a7a4a',
    gate: '成都府·锦里门', street: '成都府·锦官大街', market: '成都府·蜀锦市',
    tavern: '成都府·望江楼', tavernUp: '望江楼·竹风轩', inn: '成都府·武侯客栈',
    lane: '成都府·竹巷', fangName: '锦官里弄',
    gateDesc: '锦里门古色古香，城门口卖糖画的小贩把糖浆浇成龙凤。天府之国的慵懒，从进门就开始了。',
    streetDesc: '锦官大街上茶馆林立，竹椅沿街摆开，茶客们摇着蒲扇摆龙门阵。蜀绣铺子的门帘上绣着鸳鸯戏水。',
    marketDesc: '蜀锦市以蜀锦闻名，一匹匹锦缎流光溢彩。旁边是卖辣椒与川贝的摊子，辛香直冲鼻尖。',
    tavernDesc: '望江楼临江而建，招牌的豆瓣鱼辣得过瘾。跑堂端着红油翻滚的锅，一路小跑还稳如泰山。',
    tavernUpDesc: '竹风轩掩在竹影里，江风穿堂而过。一壶蒙顶茶，一碟麻饼，成都人的半日闲情都在里头。',
    innDesc: '武侯客栈的掌柜爱讲三国，墙上挂着出师表拓片。客房清静，听得见府南河的水声。',
    laneDesc: '竹巷两旁遍植修竹，风过沙沙作响。巷尾一家竹器铺，新编的竹篮还带着青香。',
    anchor: 'road_emei_1', anchorName: '蜀道',
  },
  {
    id: 'xiangyang', name: '襄阳城', color: '#5a5a8a',
    gate: '襄阳城·临汉门', street: '襄阳城·北街', market: '襄阳城·马市',
    tavern: '襄阳城·汉江楼', tavernUp: '汉江楼·铁瓮厅', inn: '襄阳城·将军客栈',
    lane: '襄阳城·铁巷', fangName: '汉江里弄',
    gateDesc: '临汉门扼守汉水，是兵家必争之地。城头箭楼森然，墙砖上留着斑驳的刀剑痕。',
    streetDesc: '北街石板铺地，铁匠铺、兵器铺一家挨一家。守城的兵丁巡街而过，甲片哗啦作响。',
    marketDesc: '马市上拴着一匹匹骏马，贩马的汉子拍着马背夸口。旁边卖草料与马鞍，一股干草气。',
    tavernDesc: '汉江楼临水而立，招牌的汉江鱼鲜。楼里多是南来北往的行伍之人，谈的尽是军国大事。',
    tavernUpDesc: '铁瓮厅窗朝汉江，烟波浩渺。一盏灯，一壶酒，多少守城旧事都付笑谈中。',
    innDesc: '将军客栈的掌柜从前是个老卒，谈吐间带着军旅的利落。客房简朴，但胜在安全。',
    laneDesc: '铁巷是打铁匠聚居的地方，日夜炉火不熄，锤声叮当。巷口竖着「军民同乐」的旧牌坊。',
    anchor: 'road_nan_1', anchorName: '南北通衢',
  },
];

/* ============================================================
 * 二、建城：骨架房间 + 里弄
 * ============================================================ */
let cityRooms = 0;
for (const c of CITIES) {
  defRegion(c.id, c.name, c.color);

  addRoom(c.id + '_gate', { name: c.gate, region: c.id, desc: c.gateDesc });
  addRoom(c.id + '_street', { name: c.street, region: c.id, desc: c.streetDesc });
  addRoom(c.id + '_market', { name: c.market, region: c.id, desc: c.marketDesc });
  addRoom(c.id + '_tavern', { name: c.tavern, region: c.id, desc: c.tavernDesc });
  addRoom(c.id + '_tavern_up', { name: c.tavernUp, region: c.id, desc: c.tavernUpDesc });
  addRoom(c.id + '_inn', { name: c.inn, region: c.id, desc: c.innDesc });
  addRoom(c.id + '_lane', { name: c.lane, region: c.id, desc: c.laneDesc });

  /* 城门 ←→ 官道（锚点） */
  link(c.id + '_gate', 's', c.anchor);
  /* 城门 ←→ 主街 */
  link(c.id + '_gate', 'n', c.id + '_street');
  /* 主街分叉：市集 / 酒楼 / 客栈 / 小巷 */
  link(c.id + '_street', 'e', c.id + '_market');
  link(c.id + '_street', 'w', c.id + '_tavern');
  link(c.id + '_street', 'ne', c.id + '_inn');
  link(c.id + '_street', 'nw', c.id + '_lane');
  /* 酒楼二楼 */
  link(c.id + '_tavern', 'u', c.id + '_tavern_up', 'd');

  cityRooms += 7;
}

/* ============================================================
 * 三、里弄：给每个城市预建足够的坊（挂宅院用）
 * 复用 gen-homes 的「先建坊再挂宅」思路。
 * ============================================================ */
function fangName(city, i) {
  const c = CITIES.find(x => x.id === city);
  return (c ? c.fangName : '里弄') + (i > 1 ? '·第' + CN_NUM(i) + '弄' : '');
}
function CN_NUM(n) {
  const d = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n <= 9) return d[n];
  if (n < 20) return '十' + (n % 10 ? d[n % 10] : '');
  return d[Math.floor(n / 10)] + '十' + (n % 10 ? d[n % 10] : '');
}

function ensureFangs(city, n) {
  let count = 0;
  for (let i = 1; i <= n; i++) {
    const fid = 'fang_' + city + '_' + i;
    if (rooms[fid]) { count++; continue; }
    /* 入口：小巷 > 主街 > 市场，谁的 8 方向有空谁先 */
    const cands = [city + '_lane', city + '_street', city + '_market'];
    let anchor = null;
    for (const a of cands) {
      if (rooms[a] && Object.keys(rooms[a].exits || {}).length < 8) { anchor = a; break; }
    }
    if (!anchor) return count;
    rooms[fid] = {
      id: fid, name: fangName(city, i), region: city,
      desc: '一条窄窄的里弄，两侧挨着一扇扇院门。日头斜照进来，谁家飘出饭菜香，日子不紧不慢地过。',
      exits: {},
    };
    if (!link(anchor, null, fid, null)) { delete rooms[fid]; return count; }
    count++;
  }
  return count;
}

/* 先按人头预建坊（每个城市） */
const CITY_HOME_TAGS = new Set(['beggar', 'refugee', 'child', 'eunuch', 'palace', 'consort', 'courtesan', 'singer']);
let fangTotal = 0;
for (const c of CITIES) {
  fangTotal += ensureFangs(c.id, 20);
}

/* ============================================================
 * 四、迁移 NPC：把江南一批宅院迁到新城市
 * 判定「在江南」：home 是 hm_* 且宅院房间 region 在江南相关区域。
 * ============================================================ */
const JIANGNAN_REGIONS = new Set(['jiangnan', 'market', 'yamen', 'shuyuan', 'harbor', 'farmland', 'gusu', 'wild', 'cunzhen']);

function detachHome(hmId) {
  const r = rooms[hmId];
  if (!r) return;
  for (const d of Object.keys(r.exits || {})) {
    const other = rooms[r.exits[d]];
    if (other && other.exits) {
      for (const d2 of Object.keys(other.exits)) {
        if (other.exits[d2] === hmId) delete other.exits[d2];
      }
    }
  }
  r.exits = {};
}

function attachToCity(hmId, city) {
  /* 找这个城市有空位的坊，用 FANG_DIRS 挂 */
  for (let i = 1; i <= 100; i++) {
    const fid = 'fang_' + city + '_' + i;
    const f = rooms[fid];
    if (!f) return null;
    for (const dir of FANG_DIRS) {
      if (f.exits && f.exits[dir]) continue;
      const bk = BACK[dir];
      if (bk && f.exits[bk]) continue;
      if (rooms[hmId].exits[bk]) continue;
      f.exits[dir] = hmId;
      rooms[hmId].exits[bk] = fid;
      return fid;
    }
  }
  return null;
}

let migrated = 0;
const migratedTo = {};
for (const id of Object.keys(npcs)) {
  const n = npcs[id];
  if (!n.socialDone) continue;
  if (CITY_HOME_TAGS.has(n.tag)) continue;
  if (!n.home || !n.home.startsWith('hm_')) continue;
  const hr = rooms[n.home];
  if (!hr) continue;
  if (!JIANGNAN_REGIONS.has(hr.region)) continue;   /* 已经不在江南，跳过 */

  /* 按 hash 决定是否迁 + 迁到哪 */
  const h = hashStr(id);
  if (h % 10 >= 4) continue;   /* 约 40% 迁走 */
  const city = CITIES[h % CITIES.length];

  detachHome(n.home);
  const fid = attachToCity(n.home, city.id);
  if (!fid) { /* 挂不上就留在原地（不影响连通） */ continue; }
  hr.region = city.id;
  migrated++;
  migratedTo[city.id] = (migratedTo[city.id] || 0) + 1;
}

/* ============================================================
 * 保存
 * ============================================================ */
fs.writeFileSync(MAP_FILE, JSON.stringify(mapDoc, null, 2), 'utf8');
fs.writeFileSync(NPC_FILE, JSON.stringify(npcDoc, null, 2), 'utf8');

console.log('── 新城 ──');
console.log('新建骨架房间：', cityRooms, '（每城 7 间）');
console.log('预建里弄坊：', fangTotal);
console.log('── 迁移 ──');
console.log('迁出江南的 NPC 宅院：', migrated);
for (const c of CITIES) console.log('  ' + c.name + '：', migratedTo[c.id] || 0);
console.log('房间总数：', Object.keys(rooms).length);
