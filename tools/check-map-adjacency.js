/* check-map-adjacency.js — 地块连线一致性检测（2026-10-13 主人要求）
 *
 * 主人的话：「检测一下相邻地块的连线，看看地图上面连了线的是否真相邻」。
 *
 * 检测三件事：
 *   A. 图上画了线的两格，数据里是否真有互通出口（反向：是否画了不存在的线）
 *   B. 数据里互通的出口，图上是否画了线（漏画）
 *   C. 世界地图上下左右紧贴的两格，是否真有出口（贴在一起却不通 = 视觉误导）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');

process.env.WX_SAVE_DIR = path.join(ROOT, '.livetest', 'adj-' + process.pid);
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const eng = new GameEngine({ seed: 20261013 });
eng.boot();
const w = eng.world;
const ml = require(path.join(ROOT, "game", "src", "core", "maplayout.js"));
const layout = ml.layoutAll(w.data.rooms, Object.keys(w.data.rooms));
if (!layout || !layout.cells) {
  console.log('✘ 拿不到 mapLayout / cells'); process.exit(1);
}
const cells = layout.cells;
const rooms = w.data.rooms;

const DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
const xy = (x, y) => x + ',' + y;
const byXY = {};
for (const id of Object.keys(cells)) {
  const c = cells[id];
  byXY[xy(c.x, c.y)] = id;
}

let noEdge = 0, lostEdge = 0, touchNoExit = 0;
const samplesA = [], samplesB = [], samplesC = [];

/* A. 数据里相邻的房间，坐标是否紧贴（画得出线） */
for (const id of Object.keys(cells)) {
  const r = rooms[id];
  if (!r || !r.exits) continue;
  const c = cells[id];
  for (const dir of Object.keys(r.exits)) {
    const d = DIR[dir];
    if (!d) continue;                 // u/d 等不画线
    const tgt = r.exits[dir];
    const tid = typeof tgt === 'string' ? tgt : (tgt && tgt.to);
    if (!tid || !cells[tid]) continue;  // 跨区域/未布局
    const tc = cells[tid];
    // 期望：紧贴一格
    const dx = tc.x - c.x, dy = tc.y - c.y;
    if (Math.abs(dx) + Math.abs(dy) !== 1) {
      noEdge++;
      if (samplesA.length < 12) samplesA.push(`${id}(${r.name}) -${dir}-> ${tid} 坐标差(${dx},${dy})`);
    }
  }
}

/* B. 数据里互通，但反向那条出口不存在（单向线 = 可能画了断头线） */
for (const id of Object.keys(cells)) {
  const r = rooms[id];
  if (!r || !r.exits) continue;
  for (const dir of Object.keys(r.exits)) {
    const d = DIR[dir];
    if (!d) continue;
    const tgt = r.exits[dir];
    const tid = typeof tgt === 'string' ? tgt : (tgt && tgt.to);
    if (!tid || !rooms[tid]) continue;
    const back = { n: 's', s: 'n', e: 'w', w: 'e' }[dir];
    const tr = rooms[tid];
    if (!tr.exits || !tr.exits[back]) {
      lostEdge++;
      if (samplesB.length < 12) samplesB.push(`${id}(${r.name}) -${dir}-> ${tid}(${tr.name}) 无回边(${back})`);
    }
  }
}

/* C. 坐标紧贴的两格，数据里却没出口（视觉上连一起，实际走不通） */
const seen = new Set();
for (const id of Object.keys(cells)) {
  const c = cells[id];
  for (const [dir, d] of Object.entries(DIR)) {
    const other = byXY[xy(c.x + d[0], c.y + d[1])];
    if (!other) continue;
    const key = [id, other].sort().join('~');
    if (seen.has(key)) continue;
    seen.add(key);
    const r = rooms[id], o = rooms[other];
    if (!r || !o || !r.exits) continue;
    const has = r.exits[dir];
    const hto = typeof has === 'string' ? has : (has && has.to);
    if (hto !== other) {
      touchNoExit++;
      if (samplesC.length < 12) samplesC.push(`${id}(${r.name}) | ${other}(${o.name}) 紧贴但无出口`);
    }
  }
}

const total = Object.keys(cells).length;
console.log(`房间总数(已布局): ${total}`);
console.log(`A. 有出口但坐标不紧贴(画不出线) : ${noEdge}`);
console.log(`B. 有出口但缺回边(断头线)      : ${lostEdge}`);
console.log(`C. 坐标紧贴但无出口(视觉误导)  : ${touchNoExit}`);
if (samplesA.length) { console.log('\n[A 样本]'); samplesA.forEach(s => console.log('  ' + s)); }
if (samplesB.length) { console.log('\n[B 样本]'); samplesB.forEach(s => console.log('  ' + s)); }
if (samplesC.length) { console.log('\n[C 样本]'); samplesC.forEach(s => console.log('  ' + s)); }
