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
function layoutAll(rooms, regions, currentRoomId, terrain) {
  const byRegion = {};
  Object.values(rooms).forEach(r => {
    const reg = r.region || 'wild';
    (byRegion[reg] = byRegion[reg] || []).push(r);
  });
  return packRegions(rooms, regions, byRegion, currentRoomId, terrain);
}

/**
 * 区域之间的「路牌」：每个区域块四向最近的那个邻居。
 *
 * 主人 2026-10-11 要求：「地图界面每个区域都有边界，能不能在地图上边界处
 * 提示该方向继续往前走通往哪个区域的」。
 *
 * 判据是**纯几何**的，不看出口（出口只会告诉你「隔壁那间叫什么」，
 * 说不了「这一整片往东是谁」）：
 *   ① 目标块在指定方向上**完全错开**（东：b.x ≥ a.x + a.w）；
 *   ② 两者在**垂直方向上有交叠** —— 不然「东边那块」其实是斜对面的，
 *      说「往东走能到它」就是骗人；交叠了才算真贴着同一条边；
 *   ③ 在满足 ①② 的里面取**距离最近**的（中间隔着两排的那块不算数）。
 *
 * @param {Object} regionBoxes  { regionId: {x,y,w,h} }
 * @returns {Object} { regionId: { n?:regionId, e?:regionId, s?:regionId, w?:regionId } }
 */
function computeRegionNeighbors(regionBoxes) {
  const ids = Object.keys(regionBoxes);
  const out = {};
  ids.forEach(id => { out[id] = {}; });
  const overlap = (a0, aLen, b0, bLen) => Math.max(a0, b0) < Math.min(a0 + aLen, b0 + bLen);
  const DIRS = [
    ['e', (a, b) => b.x >= a.x + a.w, 'x', (a, b) => b.x - (a.x + a.w)],
    ['w', (a, b) => b.x + b.w <= a.x, 'x', (a, b) => a.x - (b.x + b.w)],
    ['s', (a, b) => b.y >= a.y + a.h, 'y', (a, b) => b.y - (a.y + a.h)],
    ['n', (a, b) => b.y + b.h <= a.y, 'y', (a, b) => a.y - (b.y + b.h)],
  ];
  /* 交叠长度：同样是「只隔 3 格」，交叠 10 格的那块才真是「挨着这条边」，
     交叠 1 格的是斜着蹭过去。这个当**第二关键字**，否则两块并列时
     靠 Map 的遍历顺序决定选谁 —— 结果就是 A 的东邻是 B、B 的西邻是 C，
     两边对不上（实测 19 条对不上，全是并列举错人）。 */
  const overlapLen = (a0, aLen, b0, bLen) =>
    Math.max(0, Math.min(a0 + aLen, b0 + bLen) - Math.max(a0, b0));

  for (const aId of ids) {
    const a = regionBoxes[aId];
    for (const [dir, ahead, axis, gap] of DIRS) {
      let best = null;
      for (const bId of ids) {
        if (bId === aId) continue;
        const b = regionBoxes[bId];
        if (!ahead(a, b)) continue;
        /* 东/西看 y 有没有交叠，南/北看 x 有没有交叠 */
        const ov = axis === 'x'
          ? overlapLen(a.y, a.h, b.y, b.h)
          : overlapLen(a.x, a.w, b.x, b.w);
        if (!ov) continue;
        const g = gap(a, b);
        if (!best || g < best.gap || (g === best.gap && ov > best.ov) ||
          (g === best.gap && ov === best.ov && bId < best.id)) {
          best = { id: bId, gap: g, ov };
        }
      }
      if (best) out[aId][dir] = best.id;
    }
  }

  /* 只留**互认**的那一份：A 的东邻是 B，还得 B 的西邻也认 A。
     并列选错人时两边会各指一块，留着就是「牌子说着往东是华山，
     可华山那块牌子说往西是别处」—— 玩家顺着牌子走会走岔。
     宁可少一块牌子，也不要一块会骗人的牌子。 */
  const FLIP = { e: 'w', w: 'e', n: 's', s: 'n' };
  for (const aId of ids) {
    const mine = out[aId];
    for (const dir of Object.keys(mine)) {
      const other = out[mine[dir]];
      if (!other || other[FLIP[dir]] !== aId) delete mine[dir];
    }
  }
  return out;
}

/**
 * 区域装箱：把每个区域当成一个矩形块，按行排列（类似文字流），
 * 保证同区域房间聚块、区域间不重叠。
 */
/**
 * 区域装箱：把每个区域当成一个矩形块，按行排列（类似文字流），
 * 保证同区域房间聚块、区域间不重叠。
 *
 * @param {Object} terrain  可选。{ regionId: [{x,y,type,n}] } —— 区域**内相对坐标**的装饰格。
 *        它有两个作用，都很关键（design/09 §6 步骤 3）：
 *          ① 把区域的 box 撑到 regions[regId].minW/minH —— 面积不够时用旷野/山林填，
 *             **不用造假房间**（造假房间就是刚拆掉的那 354 间填充物的病根）；
 *          ② 前端按 terrain 画底纹，让玩家看得见「这一片是山林不是空」。
 *        因为 box 坐标是布局完才知道的，所以 terrain 存的是区域内相对坐标，
 *        由 packTerrain() 在这里翻译成实际全局坐标。
 */
function packRegions(rooms, regions, byRegion, currentRoomId, terrain) {
  const cells = {};
  const regionBoxes = {};
  const tOut = {};      /* 翻译后的全局 terrain，供前端画 */

  const regIds = Object.keys(byRegion).sort((a, b) => {
    const aHas = byRegion[a].some(r => r.id === currentRoomId);
    const bHas = byRegion[b].some(r => r.id === currentRoomId);
    if (aHas !== bHas) return aHas ? -1 : 1;
    return byRegion[b].length - byRegion[a].length;
  });

  /* 排版参数（design/09 §6 步骤 3）：
   * 原来 MAX_ROW_W 写死 34，是给「房间撑出来的小 box」用的。
   * 现在 box 被 terrain 撑到 minW（最大 14），行宽不够就全往下面堆——
   * 实测 bounds 高度从 46 暴涨到 120，地图变成一条长卷。
   *
   * 踩过的坑：先试了「按面积降序 + 贪心放行」，
   * 结果 28×130 —— 方块（8×8）在 28 宽的篮子里只能并排放 3 个，
   * 剩下全掉到下一行，**面积降序对近似方形的块几乎没有帮助**。
   *
   * 改成**货架装箱（shelf packing）**：先把 box 按高度分成若干「层」，
   * 每层高度 = 该层里最高的 box，层内横向能放几个放几个。
   * 这才是矩形装箱的标准做法，对方块最省空间。
   */
  const GAP = 2;   /* 区域之间留的空白格 */

  /* 先算出每个区域的 box 尺寸（后面排序和装箱都要用） */
  const boxOf = {};
  for (const id of regIds) {
    const lst = byRegion[id];
    const sub2 = {};
    lst.forEach(r => { sub2[r.id] = r; });
    const lb = layoutRooms(sub2, lst.some(r => r.id === currentRoomId) ? currentRoomId : lst[0].id).bounds;
    const sp = (regions && regions[id]) || {};
    boxOf[id] = {
      w: Math.max(lb.w, sp.minW || 0, 3),
      h: Math.max(lb.h, sp.minH || 0, 2),
      hasCurrent: lst.some(r => r.id === currentRoomId),
      n: lst.length,
    };
  }

  /* 目标总宽：让地图接近正方形。
   * 装箱宽度 W 满足 W ≈ sqrt(总面积)（加上 gap 的损耗放宽一点），
   * 这样 bounds 宽高比接近 1，不会变成长条。
   * ⚠️ 上限原来写死 72 —— 那是按「box 最多 15 格」的老尺寸定的。
   *    主人 2026-10-11 要求把山与野外放大（sect 17、wild 21）之后，
   *    idealW 早就超过 72，被这个上限一刀截断 → 行宽不够、全往下堆，
   *    地图成了 71×178 的长条（map-check 的「地图未接近方形」当场判红）。
   *    上限跟着尺寸一起放宽，别让常量偷偷决定地图形状。 */
  const totalArea = Object.values(boxOf).reduce((a, b) => a + b.w * b.h, 0);
  const nReg = regIds.length || 1;
  const idealW = Math.round(Math.sqrt(totalArea * (1 + GAP * 0.35)));
  const MAX_ROW_W = Math.max(20, Math.min(200, idealW));

  /* 排序：当前区域第一，其余按**高度**降序（同层里高的先放，层高才不会被撑爆） */
  const ordered = regIds.slice().sort((a, b) => {
    if (boxOf[a].hasCurrent !== boxOf[b].hasCurrent) return boxOf[a].hasCurrent ? -1 : 1;
    if (boxOf[b].h !== boxOf[a].h) return boxOf[b].h - boxOf[a].h;
    if (boxOf[b].n !== boxOf[a].n) return boxOf[b].n - boxOf[a].n;
    return a < b ? -1 : 1;
  });

  let curX = 0, curY = 0, rowH = 0;

  for (const regId of ordered) {
    const list = byRegion[regId];
    const sub = {};
    list.forEach(r => { sub[r.id] = r; });

    const start = list.some(r => r.id === currentRoomId) ? currentRoomId : list[0].id;
    const subLayout = layoutRooms(sub, start);
    const b = subLayout.bounds;

    /* 房间只撑这么宽高 —— 面积不够就用 terrain 撑（见规格 §2） */
    const rawW = Math.max(b.w, 3), rawH = Math.max(b.h, 2);
    const spec = (regions && regions[regId]) || {};
    const minW = spec.minW || 0, minH = spec.minH || 0;
    const blockW = Math.max(rawW, minW);
    const blockH = Math.max(rawH, minH);

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
      roomW: rawW, roomH: rawH,           /* 房间实际占的尺寸（前端可用来区分） */
      name: (regions[regId] && regions[regId].name) || regId,
      color: (regions[regId] && regions[regId].color) || '#8a8a8a',
      tier: spec.tier || '',
      count: list.length,
    };

    /* terrain：区域内相对坐标 → 全局坐标。
     * ⚠️ 必须跳过房间实际占用的格子，否则装饰会盖在房间上。 */
    const tlist = terrain && terrain[regId];
    if (tlist && tlist.length) {
      const taken = new Set();
      for (const id in subLayout.cells) {
        const c = subLayout.cells[id];
        taken.add((c.x + offX) + ',' + (c.y + offY));
      }
      const out = [];
      for (const t of tlist) {
        const gx = curX + t.x;
        const gy = curY + t.y;
        /* 越界或压在房间上 → 丢 */
        if (gx < curX || gy < curY || gx >= curX + blockW || gy >= curY + blockH) continue;
        if (taken.has(gx + ',' + gy)) continue;
        out.push({ x: gx, y: gy, type: t.type, n: t.n || 1 });
        taken.add(gx + ',' + gy);
      }
      if (out.length) tOut[regId] = out;
    }

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

  /* 区域四向邻居：前端在世界地图上把「往东继续走是 XX」贴在区域边界处。
   * 必须**装箱完成之后**再算 —— 邻居关系就是装箱结果的副产物。 */
  const nbMap = computeRegionNeighbors(regionBoxes);
  for (const k in regionBoxes) regionBoxes[k].neighbors = nbMap[k] || {};

  /* 总边界：以 regionBox 为准（box 已被 terrain 撑大，房间只占其中一部分）。
   * ⚠️ 若只按房间算 bounds，terrain 撑出来的边框会被裁掉，
   *   前端画区域底色时右边/下边会缺一条。 */
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const k in regionBoxes) {
    const bx = regionBoxes[k];
    minX = Math.min(minX, bx.x);
    minY = Math.min(minY, bx.y);
    maxX = Math.max(maxX, bx.x + bx.w - 1);
    maxY = Math.max(maxY, bx.y + bx.h - 1);
  }
  if (!isFinite(minX)) {
    Object.values(cells).forEach(c => {
      minX = Math.min(minX, c.x); maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y); maxY = Math.max(maxY, c.y);
    });
  }

  return {
    cells,
    regionBoxes,
    terrain: tOut,
    bounds: { minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 },
  };
}

module.exports = { layoutRooms, layoutAll, packRegions, computeRegionNeighbors, bfsDistance, findPath, DIR_LABEL, DIR_DELTA, dirLabel };
