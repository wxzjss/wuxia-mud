/* SPRINT-A 步骤7 修订：区域面积按 MUD 惯例分配（不再一律撑到 100+）
 *
 * 参考北大侠客行 / 常见 MUD 的地图观感：
 *   - 城镇（capital/town）：房间密、走得通，格子小，**填充率高**（约 75%）
 *   - 门派（sect）：山门内自成一片，格子中等，填充率约 55%
 *   - 野外（wild/realm/mad）：跑图要多走，格子大，填充率约 18%
 *   - 特殊小场所（secret/fun/village）：一小块，格子最小
 *
 * 指标从「绝对格数」改成「区域边长按层级」+「terrain 密度按层级」。
 * 幂等：确定性 seed + 覆盖写。
 */
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));

/* 每层的边长（房间排布需要的最小心寸，撑大只是留白） */
const SIDE = {
  capital: 12, town: 11, court: 10, fun: 7, village: 10,
  sect: 11, mad: 10, wild: 15, realm: 13, secret: 8,
};

/* 每层的装饰密度：装饰格数 = 面积 * 密度，再按房间数兜底 */
const DENSITY = {
  capital: 0.30, town: 0.30, court: 0.26, fun: 0.26, village: 0.28,
  sect: 0.34, mad: 0.30, wild: 0.20, realm: 0.18, secret: 0.26,
};

const MIX = {
  capital: ['wall', 'road', 'road', 'tree', 'water', 'grass'],
  town: ['road', 'road', 'wall', 'tree', 'water', 'grass'],
  court: ['wall', 'road', 'grass', 'tree'],
  fun: ['road', 'tree', 'grass', 'water'],
  village: ['farm', 'farm', 'grass', 'tree', 'water'],
  wild: ['tree', 'rock', 'grass', 'water', 'grass', 'sand'],
  sect: ['tree', 'rock', 'grass', 'water', 'grass', 'sand'],
  mad: ['rock', 'rock', 'tree', 'sand', 'water'],
  realm: ['rock', 'tree', 'water', 'snow', 'cloud'],
  secret: ['rock', 'sand', 'water'],
};

/* 房间特别多的区域（江南、百官府）额外放大，才不至于挤成一坨 */
const BIG = { jiangnan: 16, market: 13, yamen: 12, palace: 12 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const roomCount = {};
for (const id in map.rooms) {
  const r = map.rooms[id].region || 'wild';
  roomCount[r] = (roomCount[r] || 0) + 1;
}

const plan = [];
for (const rid in map.regions) {
  const r = map.regions[rid];
  const tier = r.tier || 'wild';
  let side = BIG[rid] || SIDE[tier] || 11;

  /* 房间多到超出当前边长就按面积开方放大 */
  const rc = roomCount[rid] || 0;
  const need = Math.ceil(Math.sqrt(rc * 2.2));
  if (need > side) side = Math.min(need, 20);

  r.minW = side;
  r.minH = side;

  const area = side * side;
  const want = Math.round(area * (DENSITY[tier] != null ? DENSITY[tier] : 0.28));
  const mix = MIX[tier] || MIX.town;
  const rnd = mulberry32(hashSeed(rid));
  const seen = new Set();
  const out = [];
  for (let i = 0; i < want * 2 && out.length < want; i++) {
    const x = Math.floor(rnd() * side);
    const y = Math.floor(rnd() * side);
    const k = x + ',' + y;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ x, y, type: mix[Math.floor(rnd() * mix.length)] || 'grass' });
  }
  map.terrain[rid] = out;
  const fill = Math.round(((rc + out.length) / area) * 100);
  plan.push(
    rid.padEnd(12) + tier.padEnd(8) + side + 'x' + side +
    '  房间' + String(rc).padStart(3) +
    '  装饰' + String(out.length).padStart(3) +
    '  填充' + fill + '%'
  );
}

fs.writeFileSync(MAP, JSON.stringify(map, null, 2));
console.log(plan.join('\n'));