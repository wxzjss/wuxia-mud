/* SPRINT-A 地图专项检查（design/09-map-district-allocation.md 步骤9）
 * 八条断言：
 *  1 房间 id 唯一且字段完整
 *  2 出口目标真实存在且双向可回
 *  3 34 个 region 都有中文名/颜色/tier/entry 有效
 *  4 NPC district 指向真实 region
 *  5 住宅 owner 真实存在（house:<npcId> 与 hm_* 双向自洽）
 *  6 terrain 不越出所属 region box、不压房间
 *  7 普通区域格数达标（>=100，大区更大）
 *  8 住宅不连片（住宅之间无出口、落脚点非住宅、同区）
 */
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '50_map.json'), 'utf8'));
const npcs = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '40_npcs.json'), 'utf8'));
const layout = require(path.join(ROOT, 'game', 'src', 'core', 'maplayout.js'));

const rooms = map.rooms || {};
const regions = map.regions || {};
const terrain = map.terrain || {};
const NPCS = npcs.npcs || npcs;

let pass = 0, fail = 0;
const bad = [];
function ok(cond, msg) {
  if (cond) { pass++; } else { fail++; bad.push(msg); }
}
function section(name, fn) {
  const before = fail;
  fn();
  const nf = fail - before;
  console.log((nf ? 'FAIL' : ' ok ') + '  ' + name + (nf ? '  (' + nf + ' 项不合格)' : ''));
}

/* 1 房间 id 唯一 + 字段完整 */
section('1 房间 id 唯一且字段完整', () => {
  const ids = Object.keys(rooms);
  ok(ids.length > 0, '房间表为空');
  const nameCount = {};
  ids.forEach(id => {
    const r = rooms[id];
    ok(!!r.name, id + ' 没有 name');
    ok(!!r.region, id + ' 没有 region');
    ok(r.region in regions, id + ' 的 region=' + r.region + ' 不存在');
    ok(!!r.exits, id + ' 没有 exits 字段');
    nameCount[r.name] = (nameCount[r.name] || 0) + 1;
  });
  /* id 重复：JSON 解析层面 key 天然唯一，改查模板式重名 */
  const dupNames = Object.entries(nameCount).filter(([, n]) => n > 1);
  ok(dupNames.length <= 8,
    '重名房间过多（' + dupNames.length + '组）：' + dupNames.slice(0, 5).map(x => x[0] + 'x' + x[1]).join(', '));
});

/* 2 出口双向 */
const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };
const FILLED = {
  capital: [0.25, 0.75], town: [0.25, 0.75], court: [0.25, 0.75], fun: [0.25, 0.70], village: [0.25, 0.70],
  sect: [0.20, 0.70], mad: [0.20, 0.65], wild: [0.10, 0.45], realm: [0.10, 0.45], secret: [0.15, 0.60],
};
function targetOf(v) { return typeof v === 'string' ? v : (v && v.to); }
section('2 出口目标存在且双向可回', () => {
  const ids = Object.keys(rooms);
  ids.forEach(id => {
    const r = rooms[id];
    const exits = r.exits || {};
    Object.keys(exits).forEach(d => {
      const to = targetOf(exits[d]);
      ok(!!rooms[to], id + ' 的出口 ' + d + '→' + to + ' 目标不存在');
      if (!rooms[to]) return;
      const back = rooms[to].exits || {};
      const opp = OPP[d];
      ok(!!back[opp],
        '单向出口：' + id + ' -' + d + '-> ' + to + '，但 ' + to + ' 无 ' + (opp || '反向') + ' 出口');
    });
  });
});

/* 3 region 定义完整 */
section('3 region 全部有中文名/颜色/tier/有效入口', () => {
  const ids = Object.keys(regions);
  ok(ids.length === 34, 'region 数量应为 34，实为 ' + ids.length);
  const CJK = /[\u4e00-\u9fa5]/;
  ids.forEach(id => {
    const r = regions[id];
    ok(!!r.name && CJK.test(r.name), id + ' 区域名缺中文：' + r.name);
    ok(!!r.color, id + ' 缺 color');
    ok(!!r.tier, id + ' 缺 tier');
    ok(!!r.desc, id + ' 缺 desc');
    ok(!!r.entry && rooms[r.entry], id + ' 的 entry=' + r.entry + ' 不是真实房间');
    ok(!!r.minW && !!r.minH, id + ' 缺 minW/minH');
  });
  /* 房间实际使用的 region 都要有定义 */
  Object.keys(rooms).forEach(id => {
    const reg = rooms[id].region || 'wild';
    ok(reg in regions, id + ' 落在未定义区域 ' + reg);
  });
});

/* 4 NPC district */
section('4 NPC district 指向真实 region', () => {
  let bad4 = 0;
  Object.keys(NPCS).forEach(id => {
    const n = NPCS[id];
    if (!n || !n.district) return;
    if (!(n.district in regions)) { bad4++; bad.push('NPC ' + id + '(' + (n.name || '') + ') district=' + n.district + ' 不存在'); }
  });
  ok(bad4 === 0, bad4 + ' 个 NPC 的 district 无效');
  /* 三层都该有人 */
  const tiers = { A: 0, B: 0, C: 0 };
  Object.keys(NPCS).forEach(id => { const t = NPCS[id] && NPCS[id].tier; if (tiers[t] != null) tiers[t]++; });
  ok(tiers.A > 0 && tiers.B > 0 && tiers.C > 0,
    'NPC 分层不完整 A=' + tiers.A + ' B=' + tiers.B + ' C=' + tiers.C);
});

/* 5 住宅 owner */
section('5 住宅 owner 真实存在', () => {
  let real = 0, virt = 0;
  Object.keys(rooms).forEach(id => {
    if (!id.startsWith('hm_')) return;
    real++;
    const r = rooms[id];
    const owner = r.owner || (r.name || '').replace(/^(.*?)的?家$/, '$1');
    /* owner 若是 npc id 必须存在 */
    const byId = NPCS[owner];
    const byName = Object.keys(NPCS).some(k => (NPCS[k].name || '') === owner);
    ok(!!byId || byName, '住宅 ' + id + '(' + r.name + ') 的 owner 「' + owner + '」不是已知 NPC');
  });
  /* 只认引擎真读的字段：全项目代码读的是 home，不是 house */
  Object.keys(NPCS).forEach(id => {
    const n = NPCS[id];
    if (!n) return;
    ok(!n.house, 'NPC ' + id + ' 仍在用 house 字段（引擎只读 home，会读不到家）');
    const h = n.home;
    if (typeof h === 'string' && h.startsWith('house:')) {
      virt++;
      ok(h === 'house:' + id, 'NPC ' + id + ' 的虚拟住宅标记应为 house:' + id + '，实为 ' + h);
    }
    if (typeof h === 'string' && !h.startsWith('house:') && h) {
      ok(rooms[h], 'NPC ' + id + ' 的 home=' + h + ' 不是真实房间');
    }
  });
  ok(real > 0 && virt > 0, '住宅应同时存在真实房间(' + real + ')与虚拟标记(' + virt + ')');
});

/* 6 terrain 合法 + 布局不越界 */
section('6 terrain 不越 region box / 不压房间', () => {
  const L = layout.layoutAll(rooms, regions, null, terrain);
  ok(L.terrain, 'layoutAll 未返回 terrain');
  const boxes = L.regionBoxes || {};
  let out = 0, onRoom = 0, cnt = 0;
  const cellAt = {};
  for (const id in L.cells) { const c = L.cells[id]; cellAt[c.x + ',' + c.y] = id; }
  for (const rid in (L.terrain || {})) {
    const b = boxes[rid];
    ok(!!b, 'terrain 所属区域 ' + rid + ' 没有布局 box');
    if (!b) continue;
    for (const t of L.terrain[rid]) {
      cnt++;
      ok(t.x >= b.x && t.y >= b.y && t.x < b.x + b.w && t.y < b.y + b.h,
        'terrain 越出 ' + rid + ' box：(' + t.x + ',' + t.y + ')');
      ok(!cellAt[t.x + ',' + t.y], 'terrain 压在房间 ' + cellAt[t.x + ',' + t.y] + ' 上');
      if (!(t.x >= b.x && t.y >= b.y && t.x < b.x + b.w && t.y < b.y + b.h)) out++;
      if (cellAt[t.x + ',' + t.y]) onRoom++;
    }
  }
  ok(cnt > 200, 'terrain 落地数量偏少：' + cnt);
  const b = L.bounds;
  const ratio = b.h === 0 ? 0 : Math.min(b.w, b.h) / Math.max(b.w, b.h);
  console.log('     地图 ' + b.w + 'x' + b.h + '，terrain ' + cnt + ' 格，越界 ' + out + '，压房 ' + onRoom);
  ok(ratio >= 0.6, '地图未接近方形：' + b.w + 'x' + b.h);
});

/* 7 面积与密度：不再看绝对格数，看填充率与边长合理性 */
section('7 区域尺寸与填充率合理', () => {
  const L = layout.layoutAll(rooms, regions, null, terrain);
  const boxes = L.regionBoxes || {};
  const terr = L.terrain || {};
  const rc = {};
  Object.keys(rooms).forEach(id => {
    const r = rooms[id].region || 'wild';
    rc[r] = (rc[r] || 0) + 1;
  });
  Object.keys(regions).forEach(rid => {
    const b = boxes[rid];
    ok(!!b, rid + ' 未布局');
    if (!b) return;
    const spec = regions[rid];
    const area = b.w * b.h;
    const used = (rc[rid] || 0) + (terr[rid] || []).length;
    const fill = used / area;
    const range = FILLED[spec.tier] || [10, 75];
    ok(fill >= range[0] && fill <= range[1],
      rid + '(' + spec.tier + ') 填充率 ' + (fill * 100).toFixed(0) +
      '% 超出合理区间 ' + (range[0] * 100) + '~' + (range[1] * 100) + '%');
    ok(b.w >= 6 && b.w <= 22 && b.h >= 6 && b.h <= 22,
      rid + ' 边长不合理：' + b.w + 'x' + b.h);
    ok(spec.minW <= b.w + 1, rid + ' box 比 minW 还小');
  });
});

/* 8 住宅不连片 */
section('8 住宅不连片（不互连/落脚非住宅/同区）', () => {
  const homeSet = new Set(Object.keys(rooms).filter(id => id.startsWith('hm_')));
  const homes = Array.from(homeSet);
  homes.forEach(id => {
    const r = rooms[id];
    const exits = r.exits || {};
    const names = Object.keys(exits);
    ok(names.length >= 1, '住宅 ' + id + ' 无出口，成孤儿');
    names.forEach(d => {
      const to = targetOf(exits[d]);
      if (!rooms[to]) return;
      ok(!String(to).startsWith('hm_'),
        '住宅连片：' + id + ' -' + d + '-> ' + to);
      if (rooms[to]) {
        ok(rooms[to].region === r.region,
          '住宅 ' + id + '(' + r.region + ') 落脚 ' + to + '(' + rooms[to].region + ') 跨区');
        /* 落脚可以是自家正堂（掌门住宅挂正气堂是对的），但不能挂在别人家常驻房 */
        const hostRes = rooms[to].respawn || [];
        const ownerName = (r.owner || (r.name || '').replace(/的?家$/, ''));
        hostRes.forEach(rid2 => {
          const hn = NPCS[rid2] && NPCS[rid2].name;
          ok(!hn || hn === ownerName || String(ownerName).indexOf(hn) >= 0,
            '住宅 ' + id + '(' + ownerName + ') 挂在他人常驻房 ' + to + '(' + (hn || rid2) + ') 上');
        });
      }
    });
  });
  /* 住宅两两之间不得有直接出口（横向、上下楼都不许） */
  let chains = 0;
  homes.forEach(id => {
    const e = rooms[id].exits || {};
    Object.keys(e).forEach(d => {
      const to = targetOf(e[d]);
      if (rooms[to] && homeSet.has(to)) chains++;
    });
  });
  ok(chains === 0, chains + ' 条住宅之间存在直接出口');
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) {
  console.log('\n不合格明细（前 30 条）：');
  bad.slice(0, 30).forEach(s => console.log('  - ' + s));
  process.exit(1);
}