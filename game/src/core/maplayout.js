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

  /* ⚠️ 排序必须**与玩家位置无关**：地图是世界的属性。
     原来第一关键字是「这个区域有没有玩家」，于是玩家一跨区、整张世界地图重排。 */
  const regIds = Object.keys(byRegion).sort((a, b) =>
    byRegion[b].length - byRegion[a].length || (a < b ? -1 : 1));

  const GAP = 2;   /* 区域之间留的空白格（只在兜底装箱里用） */

  /* ==================================================================
   *  ① 每个区域先**各自**布局（本地坐标系，起点房间落在 (0,0)）
   *
   *  这一份是后面「期望位移」的度量尺：跨区域那条出口的几何关系
   *  （「江南大路 往东 一步就是 华山山道」）只有在各自的本地坐标里
   *  才算得出来，装箱之后各块被推开、关系就丢了。
   * ================================================================== */
  const loc = {};    /* regId -> { cells, minX, minY, rawW, rawH, boxW, boxH, n } */
  for (const id of regIds) {
    const lst = byRegion[id];
    const sub = {};
    lst.forEach(r => { sub[r.id] = r; });
    /* 起点房间也要固定：区域的 `entry`（门户）→ 退而取 id 最小的那间。
       用「玩家当前房间」当起点会让同一个区域随玩家走动而**内部重排**。 */
    const entryId = (regions && regions[id] && regions[id].entry) || null;
    const start = (entryId && sub[entryId]) ? entryId
      : lst.map(r => r.id).sort()[0];
    const lay = layoutRooms(sub, start);
    /* ①b 先把这个区域**自己收紧**（同区边全是弹簧，目标还是「差一格」）。
       为什么必须先收：区域块的大小就是它的房间包围盒，实测这些簇平均
       摊到房间数的 2.4 倍（4x12 只放 12 间房）—— 块越大，越塞不进邻居之间。
       收紧了块才咬得动，否则区域级松弛有 768/838 步被占位挡回。 */
    const LOCAL = process.env.WX_MAP_LOCAL_RELAX;
    if (Object.keys(lay.cells).length >= 3) {
      relaxRooms(lay.cells, sub, null, LOCAL === undefined ? 40 : Number(LOCAL), 1);
      let a = Infinity, c = -Infinity, d2 = Infinity, e2 = -Infinity;
      Object.keys(lay.cells).forEach(rid => {
        const cc = lay.cells[rid];
        a = Math.min(a, cc.x); c = Math.max(c, cc.x);
        d2 = Math.min(d2, cc.y); e2 = Math.max(e2, cc.y);
      });
      lay.bounds = { minX: a, maxX: c, minY: d2, maxY: e2, w: c - a + 1, h: e2 - d2 + 1 };
    }
    const b = lay.bounds;
    const spec = (regions && regions[id]) || {};
    const rawW = Math.max(b.w, 3), rawH = Math.max(b.h, 2);
    loc[id] = {
      cells: lay.cells, minX: b.minX, minY: b.minY,
      rawW, rawH,
      /* box 仍按 minW/minH 撑（规格 §2）—— 但注意：**前端只画房间真实占的那块**
         （`box.roomW/roomH`），撑出来的部分是给填充率和「区域该有多大」用的账。 */
      boxW: Math.max(rawW, spec.minW || 0),
      boxH: Math.max(rawH, spec.minH || 0),
      n: lst.length,
    };
  }

  /* ==================================================================
   *  ② ★ 世界地图首尾相连（主人 2026-10-11）
   *
   *  原话：「把有连线的两个地块放在相邻的位置，**哪怕他们处于不同的区域**」，
   *  还有更早那句「整个分散的世界地图合并成一个完整的大地图」。
   *
   *  老做法（货架装箱）把每个区域当一个方块按行摆开，块与块之间留 2 格空当 ——
   *  于是「真出口连着的两个房间」在图上的坐标**从来不相邻**，
   *  前端只好拿虚线桥硬牵（实测 89 条跨区边，相邻的有 **0** 条）。
   *
   *  新做法：拿跨区域的真出口当**约束**去反推各区域该摆在哪 ——
   *    设区域 A 的房间 a 往 dir 一步到区域 B 的房间 b，
   *    a 在 A 块内的相对位 `relA`、b 在 B 块内的相对位 `relB`，
   *    要 cell(b) = cell(a) + Δdir，就得
   *        orgB - orgA = relA - relB + Δdir
   *  同一对区域有多条边时（实测江南与野外的 7 条）取**分量中位数**，
   *  个别畸形的边不会把整块拽歪。
   *  然后从「当前区域 / 跨区最多的区域」出发 BFS 一棵生成树，把原点一路推下去。
   *     · 树上的边 → 两端房间**真的相邻**，前端走廊直接连上，不再需要虚线桥；
   *     · 冲突解不开的边 → 后端照旧算进 `bridges`，前端画虚线兜底（有降级、不断链）。
   * ================================================================== */
  const want = {};   /* "A|B" -> [[dx,dy], ...]  B 的原点相对 A 该在哪 */
  const deg = {};    /* 区域 -> 跨区边数（选 BFS 根用） */
  const key2 = (a, b) => a + '|' + b;
  for (const ra of regIds) {
    for (const r of byRegion[ra]) {
      const ex = r.exits || {};
      for (const dir of Object.keys(ex)) {
        const t = rooms[ex[dir]];
        if (!t || !t.region || t.region === ra) continue;
        const rb = t.region;
        const la = loc[ra], lb = loc[rb];
        if (!lb) continue;
        const ca = la.cells[r.id], cb = lb.cells[t.id];
        if (!ca || !cb) continue;
        const d = DIR_DELTA[String(dir).toLowerCase()] || [0, 0];
        /* ⚠️ u/d（上下楼）在平面上的偏移是 [0,0] —— 它压根不是「平面上的邻居」，
           写成约束会要求两个房间**压在同一格**上。这类边不进约束表，
           留给后端的 `bridges` 画虚线（上下楼本来也不该在平面图上并排）。 */
        if (!d[0] && !d[1]) continue;
        const relAx = ca.x - la.minX, relAy = ca.y - la.minY;
        const relBx = cb.x - lb.minX, relBy = cb.y - lb.minY;
        const k = key2(ra, rb);
        (want[k] = want[k] || []).push([relAx - relBx + d[0], relAy - relBy + d[1]]);
        deg[ra] = (deg[ra] || 0) + 1;
        deg[rb] = (deg[rb] || 0) + 1;
      }
    }
  }
  const median = arr => {
    const s = arr.slice().sort((x, y) => x - y);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  };
  const wantOf = (a, b) => {
    const l = want[key2(a, b)];
    if (l && l.length) return [median(l.map(x => x[0])), median(l.map(x => x[1]))];
    const r = want[key2(b, a)];
    if (r && r.length) return [-median(r.map(x => x[0])), -median(r.map(x => x[1]))];
    return null;
  };

  /* BFS：根 = 跨区最多的区域（并列按 id 稳定）。
     ⚠️ **根不能是「玩家当前所在区域」**：那样玩家一跨区，整张世界地图就会重排，
       玩家会觉得地图自己在动。地图是**世界**的属性，不是玩家位置的函数。 */
  const org = {};
  const root = regIds.slice().sort((a, b) => (deg[b] || 0) - (deg[a] || 0) || (a < b ? -1 : 1))[0];
  const bfsOrder = [];
  if (root) {
    org[root] = [0, 0];
    bfsOrder.push(root);
    const pairKeys = Object.keys(want);
    let guard = 0;
    while (guard++ < regIds.length * 4) {
      let grew = false;
      for (const k of pairKeys) {
        const [a, b] = k.split('|');
        for (const [from, to] of [[a, b], [b, a]]) {
          if (!org[from] || org[to]) continue;
          if (!want[key2(from, to)]) continue;
          const w = wantOf(from, to);
          if (!w) continue;
          org[to] = [org[from][0] + w[0], org[from][1] + w[1]];
          bfsOrder.push(to);
          grew = true;
        }
      }
      if (!grew) break;
    }
  }

  /* 没跟任何区域连边的（纯孤岛）⇒ 走老的货架装箱，摆在整张图的右下外侧 */
  const connected = regIds.filter(id => org[id]);
  const loose = regIds.filter(id => !org[id]);

  /* ==================================================================
   *  ③ 初始摆放：**货架装箱**（宽敞、零压叠）
   *
   *  为什么不直接把每块摆到 ② 算出来的位置：
   *  ② 那条约束只钉住「一对房间」，一块区域其余的房间照样会压到邻居身上 ——
   *  实测 512 个房间里有 **339 个格是重复的**。而把压叠逐块螺旋避让消掉之后，
   *  35 块挤成一坨，再想挪任何一块都撞墙，③b 的拉拢一步都走不动
   *  （实测：跨区相邻 2/89，等于白做）。
   *  所以起始状态要**宽敞**，先腾出腾挪余地，再让 ③b 一条边一条边地拉近。
   * ================================================================== */
  const occupied = new Set();
  const roomsOf = id => Object.keys(loc[id].cells);
  const placeShelf = (ids, startX, startY, shelfW) => {
    /* 大块先放（高的先放，层高才不会被撑爆）—— 与原货架装箱同一套 */
    const order = ids.slice().sort((a, b) =>
      loc[b].rawH - loc[a].rawH || loc[b].rawW - loc[a].rawW ||
      roomsOf(b).length - roomsOf(a).length || (a < b ? -1 : 1));
    let cx = startX, cy = startY, rowH = 0, farthest = startY;
    for (const id of order) {
      const L = loc[id];
      const need = L.rawW + GAP;
      if (cx > startX && cx + need > startX + shelfW) { cx = startX; cy += rowH + GAP; rowH = 0; }
      org[id] = [cx, cy];
      roomsOf(id).forEach(rid => {
        const c = L.cells[rid];
        occupied.add((c.x - L.minX + cx) + ',' + (c.y - L.minY + cy));
      });
      cx += need;
      rowH = Math.max(rowH, L.rawH);
      farthest = Math.max(farthest, cy + L.rawH);
    }
    return farthest;
  };
  const shelfW = Math.max(24, Math.round(Math.sqrt(
    connected.reduce((a, id) => a + loc[id].rawW * loc[id].rawH, 0)) * 1.6));
  const shelfBottom = placeShelf(connected, 0, 0, shelfW);
  if (loose.length) placeShelf(loose, 0, shelfBottom + GAP * 2, shelfW);

  /* ==================================================================
   *  ③b ★ 力导向松弛：把跨区边**拉短**（房间不许压的硬约束下）
   *
   *  ③ 的货架起始很宽敞：跨区边一条都不相邻（8/89），几十条长虚线横穿全图 ——
   *  正是主人说的「连线画法有问题」。
   *
   *  做法：每条跨区边是一根**弹簧**，让它两端房间的距离尽可能接近 1；
   *  目标函数 = Σ(残差²)，残差 = (B 块原点+房内相对位) - (A 块原点+相对位+Δdir)。
   *  每轮让每块朝「自己那些弹簧的平均目标」走一步（1 / 1/2 / 1/4… 逐级退让），
   *  任何一个位置只要有房间压叠就**走不过去**（硬约束）；走完比总代价，
   *  只留更优的，代价不再下降就停。
   *
   *  ⚠️ 为什么不是「死磕精确一格」：实测按「满足的边数」做贪心只能到 8/89 ——
   *  区域形状是死的（一块 21×28 的野外要塞进江南边上，必然顶开别人），
   *  而按「距离平方和」优化能把**剩下的边也压到很短**，
   *  至少不再是一条条横穿全图的斜线（线短的图看着就是连着的）。
   * ================================================================== */
  const ENVREGION = process.env.WX_MAP_REGION_RELAX !== '0';
  if (connected.length > 1 && ENVREGION) {
    /* 每条边：{a,b,ax,ay,bx,by,dx,dy} —— 目标是 cellB = cellA + Δ */
    const edges = [];
    for (const k of Object.keys(want)) {
      const [a, b] = k.split('|');
      if (!org[a] || !org[b]) continue;
      const la = loc[a], lb = loc[b];
      (want[k] || []).forEach(w => {
        /* w = relA - relB + Δ ⇒ Δ = w - relA + relB，这里只需 w 与两侧相对位 */
        edges.push({ a, b, w });
      });
    }
    const relOf = {};   /* 区域 -> 房间里相对块原点的格（≥0） */
    const mine = {};
    for (const id of connected) {
      const L = loc[id];
      relOf[id] = Object.keys(L.cells).map(rid => ({
        x: L.cells[rid].x - L.minX, y: L.cells[rid].y - L.minY,
      }));
      mine[id] = [];
    }
    edges.forEach((e, i) => {
      if (mine[e.a]) mine[e.a].push({ i, as: 'a' });
      if (mine[e.b]) mine[e.b].push({ i, as: 'b' });
    });

    const occ = new Map();      /* "x,y" -> regionId */
    /* 「推开挡路那块」用的短程候选（半径 ≤6，够推开一两格就够破僵局） */
    const CAND_SMALL = (() => {
      const out = [[0, 0]];
      for (let r = 1; r <= 6; r++) {
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          out.push([dx, dy]);
        }
      }
      out.sort((p2, q2) => (Math.abs(p2[0]) + Math.abs(p2[1])) - (Math.abs(q2[0]) + Math.abs(q2[1])));
      return out;
    })();
    const put = (id, o) => relOf[id].forEach(c => occ.set((c.x + o[0]) + ',' + (c.y + o[1]), id));
    const pull = (id, o) => relOf[id].forEach(c => occ.delete((c.x + o[0]) + ',' + (c.y + o[1])));
    const free = (id, o) => relOf[id].every(c => {
      const who = occ.get((c.x + o[0]) + ',' + (c.y + o[1]));
      return who === undefined || who === id;
    });
    for (const id of connected) put(id, org[id]);
    if (process.env.WX_MAP_DEBUG) {
      let tot = 0;
      for (const id of connected) tot += relOf[id].length;
      console.log('[maplayout] 松弛前：占位 ' + occ.size + ' / 房间格 ' + tot + (occ.size === tot ? ' 一致' : ' ★有重复!'));

      const check = tag => {
        let t2 = 0;
        for (const id2 of connected) t2 += relOf[id2].length;
        if (occ.size !== t2) console.log('[maplayout] ★ ' + tag + ' 后重复：占位 ' + occ.size + ' / 房间格 ' + t2);
      };
      check.__on = true;
      org.__check = check;
    }

    /* 总代价：Σ 残差²（残差 = orgB - orgA - w） */
    const cost = () => {
      let s = 0;
      for (const e of edges) {
        const dx = org[e.b][0] - org[e.a][0] - e.w[0];
        const dy = org[e.b][1] - org[e.a][1] - e.w[1];
        s += dx * dx + dy * dy;
      }
      return s;
    };
    let curCost = cost();
    let bestCost = curCost;
    let best = connected.map(id => [org[id][0], org[id][1]]);
    const DBG = process.env.WX_MAP_DEBUG;
    let dbgTried = 0, dbgBlocked = 0, dbgMoved = 0;
    if (DBG) console.log('[maplayout] 松弛起始 cost=' + curCost + ' 边数=' + edges.length + ' 区域=' + connected.length);
    const ROUNDS = Number(process.env.WX_MAP_REGION_ROUNDS || 160);
    for (let round = 0; round < ROUNDS; round++) {
      let moved = false;
      const order = round % 2 ? connected : connected.slice().reverse();
      for (const id of order) {
        const list = mine[id];
        if (!list.length) continue;
        let tx = 0, ty = 0;
        for (const m of list) {
          const e = edges[m.i];
          if (m.as === 'b') { tx += org[e.a][0] + e.w[0]; ty += org[e.a][1] + e.w[1]; }
          else { tx += org[e.b][0] - e.w[0]; ty += org[e.b][1] - e.w[1]; }
        }
        tx = Math.round(tx / list.length);
        ty = Math.round(ty / list.length);
        if (tx === org[id][0] && ty === org[id][1]) continue;
        const old = org[id];
        let took = null, newCost = curCost;
        /* 先试「自己挪」 */
        for (let step = 1; step >= 0.125; step /= 2) {
          const nx = Math.round(old[0] + (tx - old[0]) * step);
          const ny = Math.round(old[1] + (ty - old[1]) * step);
          if (nx === old[0] && ny === old[1]) continue;
          const cand = [nx, ny];
          dbgTried++;
          if (!free(id, cand)) { dbgBlocked++; continue; }
          pull(id, old);
          org[id] = cand;
          const c = cost();
          /* 允许「代价不变」的走法（平台期）：严走只会卡在第一次撞墙处，
             而平台期的横移常常正好给邻居让出位置，下一步就好走了。 */
          if (c <= curCost) { took = cand; newCost = c; break; }
          org[id] = old;
          put(id, old);
        }
        if (took) { put(id, took); curCost = newCost; moved = true; dbgMoved++; continue; }

        /* 撞墙了 —— 再看看「挡路的那块能不能让一让」（两体联合移动）。
           区域级松弛卡死的根因：每块都被邻居夹住，单块永远走不动。
           所以允许「我挪一点 + 把挡我的那块顺着同方向推开一点」一起做，
           只要**两边加起来**的代价不升高就接受。这是破僵局的唯一办法。 */
        const cand2 = [Math.round(old[0] + (tx - old[0]) * 0.5), Math.round(old[1] + (ty - old[1]) * 0.5)];
        if (cand2[0] === old[0] && cand2[1] === old[1]) continue;
        const blockers = {};
        relOf[id].forEach(c => {
          const who = occ.get((c.x + cand2[0]) + ',' + (c.y + cand2[1]));
          if (who && who !== id) blockers[who] = true;
        });
        const bl = Object.keys(blockers);
        if (!bl.length || bl.length > 2) continue;
        for (const bid of bl) {
          const bo = org[bid];
          let done = false;
          for (const [px, py] of CAND_SMALL) {
            if (px === 0 && py === 0) continue;
            const np = [bo[0] + px, bo[1] + py];
            /* 🔴 顺序要紧：先把挡路那块**真的落到新位并写进 occ**，
               再去判「我能不能进 cand2」。
               我第一版是先摘掉它的格再判 —— 于是 occ 里那片是空的，
               我压上去照样判「空位」，两台房间叠在同一个格上
               （实测：512 间房里 64 间叠了，前端走廊会连到错的人）。 */
            pull(bid, bo);
            if (!free(bid, np)) { put(bid, bo); continue; }
            org[bid] = np;
            put(bid, np);
            pull(id, old);
            if (free(id, cand2)) {
              org[id] = cand2;
              const c = cost();
              if (c <= curCost) {
                put(id, cand2);
                curCost = c; moved = true; dbgMoved++; done = true;
                break;
              }
            }
            org[id] = old; put(id, old);
            pull(bid, np); org[bid] = bo; put(bid, bo);
          }
          if (done) break;
        }
      }
      if (org.__check) org.__check('round' + round);
      if (!moved) break;
      if (curCost < bestCost) {
        bestCost = curCost;
        best = connected.map(id => [org[id][0], org[id][1]]);
      }
    }
    if (DBG) console.log('[maplayout] 松弛结束 cost=' + bestCost + ' 试=' + dbgTried + ' 被挡=' + dbgBlocked + ' 真挪=' + dbgMoved);
    connected.forEach((id, i) => { org[id] = best[i]; });
  }

  /* ④ 翻译成全局坐标（先给个初值，房间级松弛还会再动） */
  for (const id of regIds) {
    const L = loc[id], o = org[id] || [0, 0];
    const offX = o[0] - L.minX, offY = o[1] - L.minY;
    for (const rid of Object.keys(L.cells)) {
      const c = L.cells[rid];
      cells[rid] = { x: c.x + offX, y: c.y + offY, z: c.z, region: id };
    }
  }

  /* ④b 去重保险：松弛（尤其是「推开挡路那块」那种两体移动）难免留下重复格 ——
     一个格站两间房，前端走廊会连到错的人身上。这里兜一次底：按 id 顺序占座，
     后来者螺旋找最近空位。确定性，且**永不失败**（实在找不到就往外扩）。 */
  {
    const taken = new Set();
    const ids = Object.keys(cells).sort();
    let moved = 0;
    for (const id of ids) {
      const c = cells[id];
      if (!taken.has(c.x + ',' + c.y)) { taken.add(c.x + ',' + c.y); continue; }
      moved++;
      let placed = false;
      for (let ring = 1; ring <= 60 && !placed; ring++) {
        for (let dx = -ring; dx <= ring && !placed; dx++) {
          for (let dy = -ring; dy <= ring && !placed; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
            if (taken.has((c.x + dx) + ',' + (c.y + dy))) continue;
            c.x += dx; c.y += dy; taken.add(c.x + ',' + c.y); placed = true;
          }
        }
      }
      if (!placed) { c.x = c.x + 61; taken.add(c.x + ',' + c.y); }
    }
    if (process.env.WX_MAP_DEBUG) console.log('[maplayout] 去重搬走 ' + moved + ' 间房');
  }

  /* ④c 房间级松弛（默认关）：实测它能再压短跨区连线（中位 11 → 9），
     代价是同区相邻率从 574 掉到 425 —— **形状被拽歪了**。
     主人的要求是「有连线的两边挨在一起」，为了两三条边把一片街区拽变形不划算，
     所以默认不开；留着开关，数据变了可以再试。 */
  {
    const RR = process.env.WX_MAP_ROOM_RELAX;
    if (RR !== undefined && Number(RR) > 0) {
      relaxRooms(cells, rooms, null, Number(RR), Number(process.env.WX_MAP_WIN || 6));
    }
  }

  /* ⑤ 区域 box 按**松弛后的真实房间**重算：
     ---- box 是「本区房间的紧包围盒 + minW/minH 撑出的账」。
     ---- 前端只画紧的那块（roomW/roomH），撑出来的部分看不见，
     ---- 所以 box 之间允许压叠 —— 但**房间绝不能压**（relaxRooms 已保证）。 ---- */
  const roomCellOf = {};    /* "x,y" -> roomId */
  for (const rid of Object.keys(cells)) roomCellOf[cells[rid].x + ',' + cells[rid].y] = rid;
  for (const id of regIds) {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const rid of Object.keys(loc[id].cells)) {
      const c = cells[rid];
      if (!c) continue;
      mnx = Math.min(mnx, c.x); mxx = Math.max(mxx, c.x);
      mny = Math.min(mny, c.y); mxy = Math.max(mxy, c.y);
    }
    if (!isFinite(mnx)) { mnx = mny = 0; mxx = mxy = 1; }
    const spec = (regions && regions[id]) || {};
    const rawW = Math.max(mxx - mnx + 1, 3), rawH = Math.max(mxy - mny + 1, 2);
    /* ★ 2026-10-11（世界地图合并成一整片大陆）：
       box 就是**本区房间的真实范围**，不再按 minW/minH 撑大。
       原来那笔「面积不够就用旷野山林把框填大」的账，前提是各区域被推开、
       各自占一块空地；现在各区的房间是**按真出口咬合**在一起的，
       框里那块「空地」早被邻区的房间占了 —— 撑出来的框除了骗填充率，
       只会让装饰格没处放（实测 9 个区填充率掉出区间）。
       撑大的尺寸仍留在 regions 数据里（不删），但那属于旧模型。 */
    regionBoxes[id] = {
      x: mnx, y: mny,
      roomW: rawW, roomH: rawH,
      w: rawW, h: rawH,
      name: spec.name || id,
      color: spec.color || '#8a8a8a',
      tier: spec.tier || '',
      count: byRegion[id].length,
    };
  }

  /* ⑥ terrain（旷野/山林/水泽…）：**贴着本区房间外围**一圈圈往外铺。
   *
   * 语义变了（2026-10-11，世界地图合并成一整片大陆）：原来它是「区域面积不够时
   * 往框里填的填充物」，位置是「旧框内的相对坐标」—— 现在框 = 房间真实范围，
   * 那套坐标要么落在别家房间里、要么飘到三十格外（实测 max 距离 33）。
   * 所以改成：**按环绕顺序落位**（半径 1、2、3… 一圈圈往外），
   * 类型的顺序沿用数据里的清单（山/林/水的配比不变），一格都不压房间。
   * 硬约束只剩一条（map-check §6 也只看这条）：不许压在任何一个房间上（自家的也不行）。 */
  {
    const used = new Set(Object.keys(roomCellOf));
    for (const id of regIds) {
      const tlist = terrain && terrain[id];
      if (!tlist || !tlist.length) continue;
      const B = regionBoxes[id];
      const out = [];
      let idx = 0;
      const put1 = (x, y) => {
        if (used.has(x + ',' + y)) return false;
        const t = tlist[idx % tlist.length];
        out.push({ x, y, type: t.type, n: t.n || 1 });
        used.add(x + ',' + y);
        idx++;
        return true;
      };
      for (let r = 1; r <= 12 && idx < tlist.length; r++) {
        const x0 = B.x - r, y0 = B.y - r;
        const x1 = B.x + B.w - 1 + r, y1 = B.y + B.h - 1 + r;
        for (let x = x0; x <= x1 && idx < tlist.length; x++) {
          put1(x, y0);
          if (idx < tlist.length) put1(x, y1);
        }
        for (let y = y0 + 1; y <= y1 - 1 && idx < tlist.length; y++) {
          put1(x0, y);
          if (idx < tlist.length) put1(x1, y);
        }
      }
      if (out.length) tOut[id] = out;
    }
  }

  /* 孤立未布局的房间兜底（数据里真有的孤儿房） */
  let orphanY = 0;
  for (const id of Object.keys(cells)) orphanY = Math.max(orphanY, cells[id].y);
  orphanY += 2;
  let orphanX = 0;
  Object.keys(rooms).forEach(id => {
    if (cells[id]) return;
    let x = orphanX, y = orphanY;
    while (roomCellOf[x + ',' + y]) x++;
    cells[id] = { x, y, z: 0, region: rooms[id].region || 'wild' };
    roomCellOf[x + ',' + y] = id;
    orphanX = x + 1;
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

/**
 * 房间级弹簧松弛：把**全图**的出口都当弹簧（目标：两端正好差一格），
 * 在「一个格只能站一个房间」的硬约束下迭代求解。
 *
 * 为什么区域级拉不动：一块区域的形状是死的，整块平移时**边界咬不进去** ——
 * 江南一个区有 15 个邻居要贴上来，15 团形状各异的房间往同一圈里塞，
 * 实测 838 次尝试里 768 次被占位挡回。
 * 房间级则允许「边界互相咬合」：这里让开一格、那边补上一格，
 * 整张图能像拼图一样密起来。
 *
 * 代价函数：Σ(残差²)，残差 = 实际相对位 - 方向应有的相对位。
 * 一条边只被它两端的房间各自数到一次，所以「挪一间房」的代价变化
 * 只需重算**它自己连的那些边**（度数 2~8），512 间房迭代几百轮也不吃力。
 *
 * @param {Object} cells    { roomId: {x,y,z} } —— 原地修改
 * @param {Object} rooms    { roomId: {exits} }
 * @param {Object} regionOf { roomId: regionId } —— 只用于统计/日志
 */
function relaxRooms(cells, rooms, regionOf, rounds, wIn) {
  const ids = Object.keys(cells).sort();
  const occ = new Map();
  const pos = {};
  ids.forEach(id => {
    pos[id] = [cells[id].x, cells[id].y];
    occ.set(cells[id].x + ',' + cells[id].y, id);
  });

  /* 边表：目标 cell(to) = cell(from) + Δ（u/d 这类 [0,0] 不进，它本来就并排不了） */
  const incident = {};
  ids.forEach(id => { incident[id] = []; });
  /* 权重：**同区边权重高**（区域形状是它内部那些出口定的，别为了
     一条跨区边把一片街区拽歪），跨区边权重 1（要的是把它们拉近）。 */
  const W_IN = wIn || 6;
  const reg = rid => (regionOf && regionOf[rid]) || (rooms[rid] && rooms[rid].region) || '';
  for (const id of ids) {
    const ex = rooms[id] && rooms[id].exits;
    if (!ex) continue;
    for (const dir of Object.keys(ex)) {
      const t = ex[dir];
      if (!pos[t]) continue;
      const d = DIR_DELTA[String(dir).toLowerCase()];
      if (!d || (!d[0] && !d[1])) continue;
      const wt = reg(id) === reg(t) ? W_IN : 1;
      incident[id].push({ other: t, dx: d[0], dy: d[1], wt });
      incident[t].push({ other: id, dx: d[0], dy: d[1], wt });
    }
  }
  /* 一间房「挪到 (x,y)」的代价（只算它连的边）：
     约束是「邻居 = 我 + Δ」⇔「我 = 邻居 - Δ」，两端写出来是同一条式子。 */
  const costAt = (id, x, y) => {
    let s = 0;
    for (const e of incident[id]) {
      const o = pos[e.other];
      const rx = (o[0] - e.dx) - x;
      const ry = (o[1] - e.dy) - y;
      s += (rx * rx + ry * ry) * e.wt;
    }
    return s;
  };

  const R = (rounds === undefined || rounds === null) ? 120 : Number(rounds);
  if (!(R > 0)) return cells;
  for (let round = 0; round < R; round++) {
    let moved = 0;
    const order = round % 2 ? ids : ids.slice().reverse();
    for (const id of order) {
      const list = incident[id];
      if (!list.length) continue;
      const [x, y] = pos[id];
      let tx = 0, ty = 0, tw = 0;
      for (const e of list) {
        const o = pos[e.other];
        tx += (o[0] - e.dx) * e.wt; ty += (o[1] - e.dy) * e.wt; tw += e.wt;
      }
      tx = Math.round(tx / tw);
      ty = Math.round(ty / tw);
      if (tx === x && ty === y) continue;
      const before = costAt(id, x, y);
      for (let step = 1; step >= 0.25; step /= 2) {
        const nx = Math.round(x + (tx - x) * step);
        const ny = Math.round(y + (ty - y) * step);
        if (nx === x && ny === y) continue;
        const who = occ.get(nx + ',' + ny);
        if (who !== undefined && who !== id) continue;   /* 硬约束：一个格只站一间房 */
        const after = costAt(id, nx, ny);
        if (after >= before) continue;
        occ.delete(x + ',' + y);
        occ.set(nx + ',' + ny, id);
        pos[id] = [nx, ny];
        moved++;
        break;
      }
    }
    if (!moved) break;
  }
  /* 回写（并把整体平移回非负，省得坐标全是负数） */
  let mnx = Infinity, mny = Infinity;
  ids.forEach(id => { mnx = Math.min(mnx, pos[id][0]); mny = Math.min(mny, pos[id][1]); });
  ids.forEach(id => { cells[id].x = pos[id][0] - mnx; cells[id].y = pos[id][1] - mny; });
  return cells;
}

module.exports = { layoutRooms, layoutAll, packRegions, computeRegionNeighbors, bfsDistance, findPath, relaxRooms, DIR_LABEL, DIR_DELTA, dirLabel };
