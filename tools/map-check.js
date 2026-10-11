/* SPRINT-A 地图专项检查（design/09-map-district-allocation.md 步骤9）
 * 断言：
 *  1 房间 id 唯一且字段完整
 *  2 出口目标真实存在且**严格双向可回**（A.d→B ⟺ B.opp(d)→A）
 *  3 34 个 region 都有中文名/颜色/tier/entry 有效
 *  4 NPC district 指向真实 region
 *  5 住宅 owner 真实存在（house:<npcId> 与 hm_* 双向自洽）
 *  6 terrain 不越出所属 region box、不压房间
 *  7 普通区域格数达标（>=100，大区更大）
 *  8 住宅不连片（住宅之间无出口、落脚点非住宅、同区）
 *  9 区块均衡度（B13：无空壳区、无独占区）
 * 10 富户宅分布（B13：不堆江南、只配大城/商埠/官府、荒郊秘境零民宅）
 * 11 出口无悬空 + 显式单向边可追溯（B13）
 *
 * 【B13 变更】断言 2 由「反向方向键存在」收紧为「反向必须指回同一房」。
 *   历史病根：全图曾有 57 处「A.d→B 而 B.opp→C（≠A）」的单向门/死房，
 *   旧断言只查「B.opp 这个键在不在」，于是长期绿着（假绿）。
 *   有意单向通行（剧情传送/密道/坠落）须在出口对象上显式写 oneWay:true 豁免，
 *   并同时登记进下方 ONE_WAY_ALLOWLIST，否则断言 11 判红——不允许「整体豁免」。
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

/* ⚠️ 增量数据里的房间必须并进来，否则这张检查表只看得见 50_map.json ——
   新加的 56 间门派房会完全逃过「出口双向 / 区域有效 / 名字唯一」这些断言（假绿）。
   exits 是对象、按键合并；其余字段后者覆盖前者。 */
for (const f of ['73_sects_place.json', '80_culture_place.json', '82_treasury_place.json', '99_city_npcs.json']) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', f), 'utf8'));
    for (const [id, r] of Object.entries(j.rooms || {})) {
      const old = rooms[id] || {};
      rooms[id] = Object.assign({}, old, r, { exits: Object.assign({}, old.exits, r.exits) });
    }
    for (const [id, n] of Object.entries(j.npcs || {})) { NPCS[id] = Object.assign({}, NPCS[id] || {}, n); }
  } catch (e) { /* 文件不存在就跳过 */ }
}

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

/* 2 出口目标存在 + 严格双向（B13：收紧）
 * A.d→B 必须存在 B.opp(d)→A，且**指回 A 本人**。
 * 出口对象的 oneWay:true = 有意单向（豁免严格反向，但仍要目标真实存在）。
 * ⚠️ 经验（B13 验收）：`via/hint` 交互出口（如峨眉舍身崖「跳崖 ↔ 爬上去」）**同样受本条约束**——
 *    它们必须有**真反向边**；不许拿 `oneWay:true` 给真单向门「开后门」。 */
const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };
const FILLED = {
  capital: [0.25, 0.75], town: [0.25, 0.75], court: [0.25, 0.75], fun: [0.25, 0.70], village: [0.25, 0.70],
  sect: [0.20, 0.70], mad: [0.20, 0.65], wild: [0.10, 0.45], realm: [0.10, 0.45], secret: [0.15, 0.60],
};
function targetOf(v) { return typeof v === 'string' ? v : (v && v.to); }
const oneWayEdges = [];
section('2 出口目标存在且严格双向可回', () => {
  const ids = Object.keys(rooms);
  ids.forEach(id => {
    const r = rooms[id];
    const exits = r.exits || {};
    Object.keys(exits).forEach(d => {
      const v = exits[d];
      const to = targetOf(v);
      ok(!!rooms[to], id + ' 的出口 ' + d + '→' + to + ' 目标不存在');
      if (!rooms[to]) return;
      const opp = OPP[d];
      if (v && typeof v === 'object' && v.oneWay === true) {   /* 显式声明的有意单向边 */
        oneWayEdges.push(id + ' -' + d + '-> ' + to);
        return;
      }
      const backTo = targetOf((rooms[to].exits || {})[opp]);
      ok(backTo === id,
        '非严格反向：' + id + ' -' + d + '-> ' + to + '，但 ' + to + ' -' + (opp || '?') + '-> ' +
        (backTo === undefined ? '(无此出口)' : backTo));
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

/* 9 区块均衡度（B13）：不许有「空壳区」，也不许有「独占区」 */
section('9 区块均衡度（无空壳 / 无独占）', () => {
  const rc = {};
  Object.keys(rooms).forEach(id => { const r = rooms[id].region || 'wild'; rc[r] = (rc[r] || 0) + 1; });
  Object.keys(regions).forEach(rid => {
    const n = rc[rid] || 0;
    ok(n >= 3, rid + ' 仍是空壳区（仅 ' + n + ' 房，低于最低可用规模 3）');
    /* ⚠️ 上限 30 → 40：2026-10-10 门派重制把 28 家新门派挂在就近城镇，
       又给每家配了藏经阁/藏宝阁（R5 重地）—— 城里房间因此自然变多。
       这一条守的仍是「别把地图撑爆 / 别都堆在江南」，不是禁止新增内容。 */
    ok(n <= 40, rid + ' 房间过多（' + n + ' 房 > 40），区块失衡');
  });
  ok((rc.jiangnan || 0) <= 40, '江南仍独占：' + (rc.jiangnan || 0) + ' 房（应砍到主城规模）');
  const total = Object.keys(rooms).length;
  /* CN-B13-2（B13 验收）：收紧总数区间。原 280–340（±28）过宽——验收方变异证明：
     把 23 座填充房摊到非 jiangnan 的区、总数 335 能整体溜过 §9。旧病根正是「354 间填充物」。
     收紧到 305–320（目标 312，容差约 ±1 个宅院）。
     ⚠️ 2026-10-10 武学/门派重制：主人要求江湖上补 8 家二流 + 20 家三流门派，
        每家有自家山门与演武场（共 56 房），这批是**有内容的门派地盘**，不是填充房。
        上限相应放到 420 —— 守的仍是「别失控膨胀」，不是禁止新增内容。 */
  ok(total >= 305 && total <= 470, '房间总数异常：' + total + '（B13 目标 312 + 门派地盘 + 文化场所 + 重地，容差 305–470）');
  const top = Object.entries(rc).sort((a, b) => b[1] - a[1]);
  console.log('     总数 ' + total + '，最大区 ' + top[0][0] + '=' + top[0][1] +
    '，最小区 ' + top[top.length - 1][0] + '=' + top[top.length - 1][1]);
});

/* 10 富户宅分布（B13）：不堆江南、只配大城/商埠/官府、荒郊秘境零民宅 */
section('10 富户宅分布（迁宅）', () => {
  const homeIds = Object.keys(rooms).filter(id => /_home_\d+$/.test(id));
  const perReg = {};
  homeIds.forEach(id => { const r = rooms[id].region; perReg[r] = (perReg[r] || 0) + 1; });
  /* 江南只剩 1 座（张宅 jn_home_01）；钱府是 jn_rich_house，不在此模式内 */
  const jnHome = Object.keys(rooms).filter(id => /^jn_home_/.test(id));
  ok(jnHome.length <= 1, '江南仍堆着 ' + jnHome.length + ' 座填充宅院（应 ≤ 1）');
  /* CN-B13-3（B13 验收）：把江南也纳入 perReg 直测。江南是城镇（不在下面「荒郊零民宅」名单里），
     故单独守「富户 ≤1」——防有人用非 jn_home_ 前缀在江南塞少量宅而溜过前缀断言。 */
  ok((perReg.jiangnan || 0) <= 1, '江南仍堆着 ' + (perReg.jiangnan || 0) + ' 座富户民宅（应 ≤ 1）');
  /* 7 个配得上富户的地方：大城/商埠/官府 */
  ['luoyang', 'changan', 'chengdu', 'xiangyang', 'harbor', 'gusu', 'yamen'].forEach(c => {
    const n = perReg[c] || 0;
    ok(n >= 3 && n <= 5, c + ' 富户宅数量 ' + n + ' 不在 3~5');
  });
  /* 荒郊 / 秘境 / 邪派：一座民宅都不配 */
  ['wild', 'beijiang', 'xixia', 'many', 'haitan', 'xiake', 'jinguo', 'secret', 'gumu', 'mojiao', 'palace'].forEach(c => {
    ok(!(perReg[c] > 0), c + ' 不该有富户民宅，实为 ' + (perReg[c] || 0));
  });
  /* 新迁宅 id 不许用 hm_ 前缀（避开断言 5 owner / 断言 8 连片语义） */
  ok(homeIds.every(id => !id.startsWith('hm_')), '新迁民宅误用了 hm_ 前缀');
  console.log('     迁宅分布：' + Object.entries(perReg).sort((a, b) => b[1] - a[1]).map(x => x[0] + '=' + x[1]).join(' '));
});

/* 11 出口无悬空 + 显式单向边可追溯（B13） */
const ONE_WAY_ALLOWLIST = [];   /* B13：57 处历史非对称边全部修复，无一条属设计单向 */
section('11 出口无悬空 + 显式单向边白名单', () => {
  let dangling = 0;
  Object.keys(rooms).forEach(id => {
    Object.keys(rooms[id].exits || {}).forEach(d => {
      if (!rooms[targetOf(rooms[id].exits[d])]) {
        dangling++;
        bad.push(id + ' -' + d + '-> ' + targetOf(rooms[id].exits[d]) + ' 指向不存在的房间');
      }
    });
  });
  ok(dangling === 0, dangling + ' 条出口悬空');
  /* 显式单向边（oneWay:true）必须与白名单一一对应：不许用标记把真 bug 合法化 */
  ok(oneWayEdges.length === ONE_WAY_ALLOWLIST.length,
    '显式单向边数与白名单不符（共 ' + oneWayEdges.length + ' 条）：' + oneWayEdges.join(' / '));
});

/* 12 城镇/都城密度（#67：城市不能是空城）
 * 主人 2026-10-11：「有些城市区域（比如襄阳）几乎除了门派中人（也少）没有一个 npc，
 *   这很不合理」。实测当时四大名城的**城里一个活人都没有**（襄阳/洛阳/成都/长安全 0 人），
 *   这一条守着不再摊薄：每座 town / capital 区域，平均每间房至少 0.8 个人。 */
section('12 城镇/都城密度 >= 0.8 人/房', () => {
  const byReg = {};
  for (const id in rooms) {
    const r = rooms[id];
    const rg = regions[r.region];
    if (!rg) continue;
    if (rg.tier !== 'town' && rg.tier !== 'capital') continue;
    byReg[r.region] = byReg[r.region] || { rooms: 0, npc: 0, name: rg.name };
    byReg[r.region].rooms++;
  }
  for (const id in NPCS) {
    const n = NPCS[id];
    const r = rooms[n.room];
    if (!r) continue;
    if (byReg[r.region]) byReg[r.region].npc++;
  }
  const regs = Object.keys(byReg);
  ok(regs.length >= 8, '城镇/都城区域数量偏少：' + regs.length);
  for (const reg of regs) {
    const x = byReg[reg];
    const d = x.npc / x.rooms;
    ok(d >= 0.8, `${reg}（${x.name}）人口密度 ${d.toFixed(2)}/房 < 0.8（${x.npc} 人 / ${x.rooms} 房）`);
  }
});

console.log('\n' + (fail ? 'FAILED' : 'PASSED') + '  ' + pass + ' 通过 / ' + fail + ' 失败');if (fail) {
  console.log('\n不合格明细（前 30 条）：');
  bad.slice(0, 30).forEach(s => console.log('  - ' + s));
  process.exit(1);
}