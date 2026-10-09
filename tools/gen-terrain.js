'use strict';
/* ==========================================================================
 *  gen-terrain.js —— 装饰地形层（步骤 3）
 *
 *  design/09-map-district-allocation.md §2 末段 + §6 步骤 3
 *
 *  为什么需要：主人要求「普通区域至少 100 格、区域面积均衡」，
 *   但删完填充物后房间数差得很远：
 *     少林 9间 → 布局 20格    华山 15 间 → 布局 30 格
 *     洛阳  8 间 → 布局 12 格  西域 4 间 → 布局 6 格
 *   两种补法：
 *     ❌ 造假房间塞满 —— 那就是刚拆掉的病根（354 间填充物）
 *     ✅ 加 terrain 装饰格 —— 一条数据 {x,y,type,n}，不占room id、不进存档
 *      玩家看得见旷野/山林/河滩，系统里没有空房间。
 *
 *  terrain type：
 *   tree 林 / rock 石 / grass 草 / water 水 / sand 沙 / snow 雪 / road 道/ wall 墙
 *
 *  ⚠️ 关键约束：terrain 坐标是**区域内相对坐标**（0..w-1 / 0..h-1），
 *     不是全局坐标 —— 因为 box 由 packRegions 运行时算，
 *     全局坐标要等布局完才知道，那时已经晚了。
 *     所以 terrain 只声明「区域内哪些格子是空的、上面长什么」，
 *     packTerrain() 在布局时把它翻译成实际坐标。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');

/* 各类区域该铺什么：地形气质 + 密度（0~1） */
const TERRAIN_MIX = {
  sect:    [['tree', 0.30], ['rock', 0.18], ['grass', 0.16], ['water', 0.04]],  /* 门派：山林为主 */
  town:    [['road', 0.14], ['grass', 0.08], ['tree', 0.06]],                    /* 城镇：留白多，别太挤 */
  capital: [['road', 0.12], ['grass', 0.08], ['tree', 0.05], ['water', 0.03]],
  village: [['grass', 0.18], ['tree', 0.12], ['water', 0.06]],
  wild:    [['grass', 0.34], ['tree', 0.26], ['rock', 0.10], ['water', 0.06]],
  court:   [['grass', 0.06], ['tree', 0.04]],
  fun:     [['grass', 0.04]],
  mad:     [['rock', 0.28], ['tree', 0.22], ['grass', 0.08]],                    /* 魔教：荒僻 */
  realm:   [['rock', 0.26], ['tree', 0.20], ['water', 0.10], ['grass', 0.10]],
  secret:  [['rock', 0.24]],
};

/* 确定性随机（同一份输入永远出同一张地图，别每次跑都不一样） */
function mulberry32(seed) {
  let a = seed >>> 0;
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

/* 用固定 seed 生成：跑一百次结果都一样（测试要能断言） */
function genTerrain(regId, need) {
  const rnd = mulberry32(hashSeed('terrain:' + regId));
  const out = [];
  for (const [type, density] of need.mix) {
    const n = Math.round(need.total * density);
    for (let i = 0; i < n; i++) {
      out.push({
        x: 1 + Math.floor(rnd() * Math.max(1, need.w - 2)),
        y: 1 + Math.floor(rnd() * Math.max(1, need.h - 2)),
        type, n: 1 + Math.floor(rnd() * 3),
      });
    }
  }
  return out;
}

const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const rooms = map.rooms;
const regions = map.regions;

const countByRegion = {};
for (const id in rooms) {
  const g = rooms[id].region || 'wild';
  countByRegion[g] = (countByRegion[g] || 0) + 1;
}

/* 房间布局出的实际 box 尺寸 —— 先算一遍才知道要补多少格 */
const { layoutAll } = require(path.join(__dirname, '..', 'game', 'src', 'core', 'maplayout.js'));
const lay = layoutAll(rooms, regions);

const report = [];
const terrain = {};
let totalTerrain = 0;

for (const regId in regions) {
  const spec = regions[regId];
  const box = lay.regionBoxes[regId];
  if (!box) continue;
  const mix = TERRAIN_MIX[spec.tier] || TERRAIN_MIX.wild;
  const minW = spec.minW || 8, minH = spec.minH || 8;

  /* 目标面积 = minW*minH；已用面积 = box.w*box.h */
  const curArea = box.w * box.h;
  const target = minW * minH;

  /* 已经达标就把已有的少量 terrain 留着，不重复生成 */
  const prev = (map.terrain && map.terrain[regId]) || null;
  if (curArea >= target) {
    if (prev) { terrain[regId] = prev; totalTerrain += prev.length; }
    report.push('✅ ' + spec.name.padEnd(10) + ' 现有 ' + String(curArea).padStart(4) + ' 格 ≥ 目标 ' + target + '，不补');
    continue;
  }

  /* 要补的格数：目标面积 - 现有面积。再留点余量让边界看着自然 */
  const needTotal = Math.max(0, target - curArea);
  /* 但也不能小于「房间数的 40%」——房间少的区域（西域4 间）光靠框显得太空 */
  const roomN = countByRegion[regId] || 1;
  const needTotal2 = Math.max(needTotal, Math.round(roomN * 0.6));

  const need = { w: minW, h: minH, total: needTotal2, mix };
  const list = genTerrain(regId, need);
  /* 去重：同一格只留一种地形（后写的覆盖先写的） */
  const seen = new Map();
  for (const t of list) seen.set(t.x + ',' + t.y, t);
  terrain[regId] = [...seen.values()];
  totalTerrain += terrain[regId].length;

  report.push('➕ ' + spec.name.padEnd(10) + ' ' + String(curArea).padStart(4) + ' → ' + String(minW * minH).padStart(4) +
    ' 格（补 ' + terrain[regId].length + ' 个装饰，密度 ' + (terrain[regId].length / (minW * minH) * 100).toFixed(0) + '%）');
}

map.terrain = terrain;
fs.writeFileSync(MAP, JSON.stringify(map, null, 1), 'utf8');

report.forEach(r => console.log('  ' + r));
console.log('');
console.log('terrain 装饰格合计 %d 个（分%d 个区域）', totalTerrain, Object.keys(terrain).length);
console.log('数据体积影响：+%.1f KB（不占 room id、不进存档）',
  (JSON.stringify(terrain).length / 1024).toFixed(1));
