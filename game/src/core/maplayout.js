'use strict';
/* ==========================================================================
 *  江湖舆图 · 地图布局引擎
 *
 *  MUD 房间数据只描述「出口指向哪个房间」，没有坐标。
 *  这里用「方向约束 + BFS 扩散 + 冲突消解」自动推出网格坐标，
 *  再把同一区域的房间聚在一起，供前端渲染成可视地图。
 *
 *  思路：
 *    1. 以起点房间为 (0,0)，按出口方向给邻居分配相对坐标
 *       （n = y-1，s = y+1，e = x+1，w = x-1，u/d 走独立的 z 层）
 *    2. BFS 扩散整张图；若目标格已被别的房间占用，做螺旋搜索找最近空格
 *    3. 按区域分块，把不同区域错开摆放，避免互相重叠
 *
 *  不依赖任何外部库。
 * ========================================================================== */

/* 方向 -> 二维偏移。(u/d) 是上下层，单独记 z，不占平面格 */
const DIR_DELTA = {
  n: [0, -1], north: [0, -1], 北: [0, -1],
  s: [0, 1], south: [0, 1], 南: [0, 1],
  e: [1, 0], east: [1, 0], 东: [1, 0],
  w: [-1, 0], west: [-1, 0], 西: [-1, 0],
  ne: [1, -1], northeast: [1, -1], 东北: [1, -1],
  nw: [-1, -1], northwest: [-1, -1], 西北: [-1, -1],
  se: [1, 1], southeast: [1, 1], 东南: [1, 1],
  sw: [-1, 1], southwest: [-1, 1], 西南: [-1, 1],
  u: [0, 0], up: [0, 0], 上: [0, 0],
  d: [0, 0], down: [0, 0], 下: [0, 0],
};

/* 方向显示名（给前端画连线/标签用） */
const DIR_LABEL = {
  n: '北', s: '南', e: '东', w: '西', u: '上', d: '下',
  ne: '东北', nw: '西北', se: '东南', sw: '西南',
};

function deltaOf(dir) {
  return DIR_DELTA[String(dir).toLowerCase()] || null;
}

/* 从 (x,y) 开始螺旋搜索一个未被占用的格子 */
function findFreeCell(occupied, x, y) {
  if (!occupied.has(x + ',' + y)) return [x, y];
  for (let ring = 1; ring <= 24; ring++) {
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
        // 只看当前环上的格子
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const nx = x + dx, ny = y + dy;
        if (!occupied.has(nx + ',' + ny)) return [nx, ny];
      }
    }
  }
  return [x, y];
}

/**
 * 给一组房间算格子坐标。
 * @param {Object} rooms   { roomId: {id, name, region, exits:{n:id,...}} }
 * @param {string} startId 布局起点房间（通常是玩家当前位置）
 * @returns {{ cells: Object, bounds: Object }}
 *   cells[roomId] = { x, y, z, region }
 */
function layoutRooms(rooms, startId) {
  const ids = Object.keys(rooms);
  if (!ids.length) return { cells: {}, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, w: 0, h: 0 } };

  const start = rooms[startId] ? startId
    : (ids.find(i => rooms[i].region === 'jiangnan') || ids[0]);

  const cells = {};
  const occupied = new Set();   // "x,y" -> 已占用
  const zByRoom = {};           // 房间 -> 层（上下楼梯）
  const queue = [];

  cells[start] = { x: 0, y: 0, z: 0, region: rooms[start].region };
  occupied.add('0,0');
  zByRoom[start] = 0;
  queue.push(start);

  while (queue.length) {
    const cur = queue.shift();
    const c = cells[cur];
    const room = rooms[cur];
    if (!room || !room.exits) continue;

    for (const dir of Object.keys(room.exits)) {
      const target = room.exits[dir];
      if (!rooms[target] || cells[target]) continue;

      const d = deltaOf(dir);
      const isUD = /^(u|d|up|down|上|下)$/i.test(dir);

      let x, y, z = c.z;
      if (isUD) {
        // 上下层：平面坐标相同，层数变化（用位置微偏移，避免视觉重叠）
        x = c.x; y = c.y;
        z = c.z + (/^(u|up|上)$/i.test(dir) ? 1 : -1);
      } else if (d) {
        x = c.x + d[0];
        y = c.y + d[1];
      } else {
        // 未知方向：就近放右边
        x = c.x + 1; y = c.y;
      }

      const [fx, fy] = findFreeCell(occupied, x, y);
      cells[target] = { x: fx, y: fy, z, region: rooms[target].region };
      occupied.add(fx + ',' + fy);
      zByRoom[target] = z;
      queue.push(target);
    }
  }

  /* 孤立房间（没有任何连接）：按区域补到末尾空白处 */
  const orphans = ids.filter(i => !cells[i]);
  if (orphans.length) {
    let maxX = 0, maxY = 0;
    Object.values(cells).forEach(c => { maxX = Math.max(maxX, c.x); maxY = Math.max(maxY, c.y); });
    let ox = 0, oy = maxY + 2;
    orphans.forEach(id => {
      while (occupied.has(ox + ',' + oy)) ox++;
      cells[id] = { x: ox, y: oy, z: 0, region: rooms[id].region };
      occupied.add(ox + ',' + oy);
      ox++;
      if (ox > maxX + 6) { ox = 0; oy++; }
    });
  }

  /* 边界 */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  Object.values(cells).forEach(c => {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  });

  return {
    cells,
    bounds: { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

/** 从起点做 BFS，算出到各房间的最短步数（用于「近/远」判定和寻路） */
function bfsDistance(rooms, startId, maxDepth) {
  const dist = {};
  if (!rooms[startId]) return dist;
  dist[startId] = 0;
  const q = [startId];
  const limit = maxDepth || 99;
  while (q.length) {
    const cur = q.shift();
    if (dist[cur] >= limit) continue;
    const room = rooms[cur];
    if (!room || !room.exits) continue;
    for (const dir of Object.keys(room.exits)) {
      const t = room.exits[dir];
      if (!rooms[t] || dist[t] != null) continue;
      dist[t] = dist[cur] + 1;
      q.push(t);
    }
  }
  return dist;
}

/** BFS 寻路：返回 [{dir, roomId, name}]，找不到返回 null */
function findPath(rooms, fromId, toId) {
  if (!rooms[fromId] || !rooms[toId]) return null;
  if (fromId === toId) return [];
  const prev = { [fromId]: null };
  const q = [fromId];
  while (q.length) {
    const cur = q.shift();
    const room = rooms[cur];
    if (!room || !room.exits) continue;
    for (const dir of Object.keys(room.exits)) {
      const t = room.exits[dir];
      if (!rooms[t] || prev[t] !== undefined) continue;
      prev[t] = { from: cur, dir };
      if (t === toId) {
        // 回溯
        const path = [];
        let node = t;
        while (prev[node]) {
          path.unshift({ dir: prev[node].dir, roomId: node, name: rooms[node] ? rooms[node].name : node });
          node = prev[node].from;
        }
        return path;
      }
      q.push(t);
    }
  }
  return null;
}

/** 方向中文名 */
function dirLabel(dir) {
  return DIR_LABEL[String(dir).toLowerCase()] || dir;
}

/**
 * 按区域分别布局，再拼成一张总图（区域装箱）。
 *
 * 为什么不用一次性全局布局：全局 BFS 会让先访问的区域把格子占满，
 * 后面区域的房间被挤到远处，同一区域反而散开、看不出形状。
 * 分区布局能保证「同一区域的房间聚成规整的一块」。
 *
 * @param {Object} rooms
 * @param {Object} regions  { regionId: {name, color} }
 * @param {string} currentRoomId
 * @returns {{ cells, regionBoxes, bounds }}
 */
function layoutAll(rooms, regions, currentRoomId) {
  const byRegion = {};
  Object.values(rooms).forEach(r => {
    const reg = r.region || 'wild';
    (byRegion[reg] = byRegion[reg] || []).push(r);
  });
  return packRegions(rooms, regions, byRegion, currentRoomId);
}

/**
 * 区域装箱：把每个区域当成一个矩形块，按行排列（类似文字流），
 * 保证同区域房间聚块、区域间不重叠。
 */
function packRegions(rooms, regions, byRegion, currentRoomId) {
  const cells = {};
  const regionBoxes = {};

  const regIds = Object.keys(byRegion).sort((a, b) => {
    const aHas = byRegion[a].some(r => r.id === currentRoomId);
    const bHas = byRegion[b].some(r => r.id === currentRoomId);
    if (aHas !== bHas) return aHas ? -1 : 1;
    return byRegion[b].length - byRegion[a].length;
  });

  const MAX_ROW_W = 34;
  let curX = 0, curY = 0, rowH = 0;

  for (const regId of regIds) {
    const list = byRegion[regId];
    const sub = {};
    list.forEach(r => { sub[r.id] = r; });

    const start = list.some(r => r.id === currentRoomId) ? currentRoomId : list[0].id;
    const subLayout = layoutRooms(sub, start);
    const b = subLayout.bounds;
    const blockW = Math.max(b.w, 3), blockH = Math.max(b.h, 2);

    /* 换行判定 */
    if (curX > 0 && curX + blockW > MAX_ROW_W) {
      curX = 0;
      curY += rowH + 2;
      rowH = 0;
    }

    const offX = curX - b.minX;
    const offY = curY - b.minY;
    list.forEach(r => {
      const c = subLayout.cells[r.id];
      if (!c) return;
      cells[r.id] = { x: c.x + offX, y: c.y + offY, z: c.z, region: regId };
    });

    regionBoxes[regId] = {
      x: curX, y: curY, w: blockW, h: blockH,
      name: (regions[regId] && regions[regId].name) || regId,
      color: (regions[regId] && regions[regId].color) || '#8a8a8a',
      count: list.length,
    };

    curX += blockW + 2;
    rowH = Math.max(rowH, blockH);
  }

  /* 孤立未布局的房间兜底 */
  const occupied = new Set(Object.values(cells).map(c => c.x + ',' + c.y));
  Object.keys(rooms).forEach(id => {
    if (cells[id]) return;
    let x = 0, y = curY + rowH + 2;
    while (occupied.has(x + ',' + y)) x++;
    cells[id] = { x, y, z: 0, region: rooms[id].region || 'wild' };
    occupied.add(x + ',' + y);
  });

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  Object.values(cells).forEach(c => {
    minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
    minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
  });

  return {
    cells,
    regionBoxes,
    bounds: { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

module.exports = { layoutRooms, layoutAll, packRegions, bfsDistance, findPath, DIR_LABEL, DIR_DELTA, dirLabel };
