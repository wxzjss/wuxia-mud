/**
 * gen-fix-edges.js — 修历史遗留的单向边（第 5 批收尾）
 *
 * 规则：
 *  1. 同 region 的单向边 → 补反向边（宅院↔巷子、市场内部）
 *  2. 跨 region 的非官道单向边 → 删掉错误出口（武当山门连江南书院、当铺连太和殿这类迁移 bug）
 *  3. 跨 region 的官道（road_*）→ 补反向边（长途官道理应双向）
 *
 * 幂等：跑一次后单向边数量应显著下降。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');
const data = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const rooms = data.rooms;
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', u: 'd', d: 'u', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', in: 'out', out: 'in' };

let fixedBack = 0, removed = 0;

for (const id of Object.keys(rooms)) {
  const r = rooms[id];
  for (const d of Object.keys(r.exits || {})) {
    const ex = r.exits[d];
    const t = typeof ex === 'string' ? ex : (ex.to || ex.room);
    if (!t || !rooms[t]) continue;
    const back = BACK[d];
    if (!back) continue;
    const tExits = rooms[t].exits || {};
    const hasBack = Object.keys(tExits).some(bd => {
      const be = tExits[bd];
      const bt = typeof be === 'string' ? be : (be.to || be.room);
      return bt === id;
    });
    if (hasBack) continue;

    const sameRegion = r.region === rooms[t].region;
    const isRoad = /^road_/.test(id) || /^road_/.test(t);

    if (!sameRegion && !isRoad) {
      // 跨区域错误连接 → 删出口
      delete r.exits[d];
      removed++;
    } else {
      // 同区域 或 官道 → 补反向
      if (!rooms[t].exits) rooms[t].exits = {};
      if (!rooms[t].exits[back]) {
        rooms[t].exits[back] = id;
        fixedBack++;
      }
    }
  }
}

fs.writeFileSync(MAP, JSON.stringify(data, null, 2));
console.log(`补反向边 ${fixedBack} 条，删错误跨区域连接 ${removed} 条。`);
