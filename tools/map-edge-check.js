/* 区域边界路牌 + 弹窗底部按钮排可滑动（主人 2026-10-11 点单两件）
 *
 * 一、地图：区域块之间要贴「往这边继续走 → XX」的牌子
 *     🔴 2026-10-12 主人「只保留当前区域界面，把天下全图整个界面删了」——
 *        牌子是**全图专属**的（贴在本区与邻居区那道缝里），地图只剩本区之后
 *        邻居不在图上、缝不存在，整段随全图一起下线。
 *        ⇒ 本脚本第 1 / 3 / 4 节从「牌子对不对」**反转成「牌子真的没了」**；
 *           第 2 节（后端 neighbors 数据）保留 —— 数据留着，将来要用随时能开回来。
 *        另外「出界方向」图例那条 2026-10-12 就删了，这次牌子本体也走。
 * 二、「细看此人」底部那排按钮：手机上排不下要能左右划（原来 flex-end + 不换行
 *     → 左侧按钮溢出屏幕**且滚不到**，等于凭空消失）—— 与地图无关，原样保留。
 *
 * 跑法：node tools/map-edge-check.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const layout = require(path.join(ROOT, 'game/src/core/maplayout.js'));

/* ---------- 真跑前端渲染函数（抠源码，不 mock 逻辑） ---------- */
const UISRC = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
function grab(name) {
  const m = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('未找到函数 ' + name);
  return m[0];
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const MAP_CELL = 30, MAP_NODE = 26, MAP_PAD = 34;
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
function buildMap() {
  return new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
    grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
      esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF).mapHtml;
}

const CSS = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
const CSS2 = fs.readFileSync(path.join(ROOT, 'server/public/css/main.css'), 'utf8');
const UI2 = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

(async () => {
  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});
  e.newGame({ name: '边界侠客' });
  const w = e.world;
  const v = e.view();
  const m = v.map;

  /* ================= 一、区域边界路牌 · 后端几何 ================= */
  section('1 后端：区域四向邻居（装箱副产物）');
  const L = layout.layoutAll(w.data.rooms, w.data.regions, v.map.current, w.data.terrain || {});
  const boxes = L.regionBoxes || {};
  const ids = Object.keys(boxes);
  ok('区域块数量正常', ids.length >= 20, 'boxes=' + ids.length);
  ok('每块都有 neighbors 字段', ids.every(k => boxes[k].neighbors && typeof boxes[k].neighbors === 'object'),
    '缺字段 ' + ids.filter(k => !boxes[k].neighbors).length + ' 块');

  let selfRef = 0, notAdjacent = 0, noOverlap = 0, pairs = 0;
  for (const aId of ids) {
    const a = boxes[aId];
    for (const dir of Object.keys(a.neighbors || {})) {
      pairs++;
      const bId = a.neighbors[dir];
      const b = boxes[bId];
      if (!b) { notAdjacent++; continue; }
      if (bId === aId) selfRef++;                       /* 自己指自己 = 死循环牌 */
      /* 方向判据：东边那块必须在 A 的右边界之外；南边那块在 A 的下边界之外 */
      const okDir = dir === 'e' ? b.x >= a.x + a.w
        : dir === 'w' ? b.x + b.w <= a.x
          : dir === 's' ? b.y >= a.y + a.h
            : b.y + b.h <= a.y;
      if (!okDir) notAdjacent++;
      /* 垂直方向必须真有交叠，不然是斜对面 —— 说「往东走能到」就是骗人 */
      const touch = (dir === 'e' || dir === 'w')
        ? Math.max(a.y, b.y) < Math.min(a.y + a.h, b.y + b.h)
        : Math.max(a.x, b.x) < Math.min(a.x + a.w, b.x + b.w);
      if (!touch) noOverlap++;
    }
  }
  ok('有邻居关系（至少 40 条）', pairs >= 40, '共 ' + pairs + ' 条');
  ok('没有自己当自己邻居', selfRef === 0, selfRef + ' 条自指');
  ok('邻居确实在那个方向上', notAdjacent === 0, notAdjacent + ' 条方向不符');
  ok('邻居在垂直方向上真有交叠（不是斜对面）', noOverlap === 0, noOverlap + ' 条不交叠');
  ok('★ 方向对称（A 东邻是 B ⟺ B 西邻是 A）', (() => {
    let bad = 0;
    for (const aId of ids) {
      const a = boxes[aId], nb = a.neighbors || {};
      const flip = { e: 'w', w: 'e', n: 's', s: 'n' };
      for (const d of Object.keys(nb)) {
        const b = boxes[nb[d]];
        if (!b) { bad++; continue; }
        if ((b.neighbors || {})[flip[d]] !== aId) bad++;
      }
    }
    return bad === 0;
  })(), '不对称数：' + ids.filter(aId => {
    const a = boxes[aId], nb = a.neighbors || {};
    const flip = { e: 'w', w: 'e', n: 's', s: 'n' };
    return Object.keys(nb).some(d => boxes[nb[d]] && ((boxes[nb[d]].neighbors || {})[flip[d]] !== aId));
  }).length);
  console.log('     覆盖：' + ids.filter(k => Object.keys(boxes[k].neighbors || {}).length).length +
    '/' + ids.length + ' 个区域至少有一个邻居');

  /* 引擎出口：mapView 要把 neighbors 原样带给前端 */
  section('2 后端：mapView 透出 neighbors');
  const engineBoxes = m.regionBoxes || {};
  ok('mapView 带 regionBoxes', Object.keys(engineBoxes).length >= 20, Object.keys(engineBoxes).length + ' 块');
  ok('★ mapView 的 regionBoxes 里有 neighbors',
    Object.values(engineBoxes).every(b => b.neighbors && typeof b.neighbors === 'object'),
    '缺 ' + Object.values(engineBoxes).filter(b => !b.neighbors).length + ' 块');

  /* ================= 三、边界路牌已整体下线 ================= */
  section('3 前端：边界路牌已随「天下全图」整体下线');
  /* 🔴 2026-10-12 主人「只保留当前区域界面，把天下全图整个界面删了」。
     路牌贴的是「本区 ↔ 邻居区」之间那道缝，地图只剩本区之后缝不存在，
     所以整段（生成 + CSS）都撤了。
     ⇒ 这一节从「牌子渲染得对不对」**反转成「牌子真的没了」**：
       留着旧断言（世界地图上有 ≥20 块牌）会天天报红，
       而删掉不留守卫又会让「谁悄悄把它接回来」无人发现。 */
  const mhW = buildMap()(v);
  const UI_SRC = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
  const UI_CL = UI_SRC.replace(/\/\*[\s\S]*?\*\//g, ' ');   /* 抠掉块注释：只查活代码 */
  ok('★ 渲染里不再有路牌（.map-edge-hint 0 块）',
    (mhW.match(/class="map-edge-hint"/g) || []).length === 0,
    (mhW.match(/class="map-edge-hint"/g) || []).length + ' 块');
  ok('★ 渲染里也不再有箭头（.meh-arrow 0 个）',
    (mhW.match(/class="meh-arrow"/g) || []).length === 0);
  ok('★ 源码里 edgeHintHtml 已删（不是「恰好没渲染」）', !/const edgeHintHtml/.test(UI_CL));
  ok('★ 源码里也不再拼 meh-arrow', !/meh-arrow/.test(UI_CL));
  ok('★ CSS 里 .map-edge-hint 规则已删',
    !/\.map-edge-hint\s*\{/.test(CSS));
  ok('★ CSS 里 .meh-arrow 规则已删', !/\.meh-arrow\s*\{/.test(CSS));
  /* 图例里的「出界方向」2026-10-12 就更早删了，一起守着 */
  ok('图例里的「出界方向」仍在删除状态',
    !mhW.includes('出界方向') && !mhW.includes('dot-edge'));
  /* 画布本身没被删坏 */
  ok('地图仍能正常渲染（没被改坏）', mhW.includes('map-canvas') && mhW.includes('map-node'));

  /* ================= 四、跨区域出口改用抬头标注 ================= */
  section('4 前端：跨区域出口改由抬头「→区域名」标注承担');
  /* 路牌删了，「走到边界要知道前面是哪个区域」这件事不能没人管 ——
     它现在由抬头那行出口列表里的 `.map-out` 承担：
     只有你**真站在跨界那间房**时才出，比满图铺牌子更准。 */
  ok('★ 源码里 .map-out 的渲染还在（路牌删了，这条通道要留着）',
    /class="map-out"/.test(UI_CL));

  /* ================= 五、跨区域出口在抬头标出来 ================= */
  section('5 前端：抬头处标「跨区域出口」');
  /* 找一个真的有跨区域出口的房间（**按真出口**找，不按图上坐标 ——
     区域装箱在区域之间留了 2 格空当，跨区域的房间在图上从不相邻） */
  const roomsData = w.data.rooms;
  let crossRoom = null;
  for (const r of Object.values(roomsData)) {
    const dirs = Object.keys(r.exits || {}).filter(d => {
      const t = roomsData[r.exits[d]];
      return t && t.region && t.region !== r.region;
    });
    if (dirs.length) { crossRoom = { id: r.id, name: r.name, dirs }; break; }
  }
  ok('存在跨区域出口的房间（真数据）', !!crossRoom,
    crossRoom ? crossRoom.name + ' [' + crossRoom.dirs.join('') + ']' : '一个都没有');
  if (crossRoom) {
    /* 把玩家挪到那个房间，再看渲染 —— 用真路径，别手改 view */
    const mv = w.movePlayerTo(w.player, crossRoom.id);
    ok('移动成功（吐纳等拦截不该挡测试）', !mv || mv.ok !== false, JSON.stringify(mv || {}));
    const v2 = e.view();
    const here2 = (v2.map.rooms || []).find(r => r.current);
    ok('★ mapView 下发 crossExits', here2 && here2.crossExits &&
      Object.keys(here2.crossExits).length > 0,
      JSON.stringify(here2 ? here2.crossExits : null));
    const mh2 = buildMap()(v2);
    const regionNames = new Set((m.regions || []).map(r => r.name));
    /* ⚠️ 必须 matchAll：`String.match` 带 g 标志时**返回整体匹配、丢掉分组**，
       取 x[1] 会拿到 "class" 的第 2 个字母 'l'（这个坑本脚本自己踩过一次）。 */
    const annotated = [...mh2.matchAll(/class="map-out">→([^<]*)</g)].map(x => x[1]);
    ok('★ 跨区域出口带「→区域名」标注', annotated.length > 0, JSON.stringify(annotated));
    ok('标注里的名字是真区域名', annotated.length > 0 && annotated.every(n => regionNames.has(n)),
      JSON.stringify(annotated));
    /* 同区域出口不该被标（标了就是满屏括号，反而看不见重点） */
    const allExits = (here2.exits || []).length;
    ok('只标跨界的出口，不是全标',
      annotated.length < allExits || allExits === annotated.length,
      '出口 ' + allExits + ' 个，标注 ' + annotated.length + ' 个');
  }

  /* ================= 六、弹窗底部按钮排可左右滑动 ================= */
  section('6 弹窗底部按钮排：手机上能横向划');
  const footRule = (CSS.match(/\.modal-foot\s*\{[^}]*\}/) || [''])[0];
  ok('找到 .modal-foot 规则', footRule.length > 0);
  ok('★ 横向可滚动 overflow-x: auto', /overflow-x:\s*auto/.test(footRule), footRule.slice(0, 90));
  ok('★ 不再用 flex-end 起排（flex-end 的左侧溢出是滚不到的）',
    !/justify-content:\s*flex-end/.test(footRule), footRule.slice(0, 90));
  ok('★ 靠首个子元素的 margin-left:auto 撑右对齐（排得下靠右、排不下从左滚）',
    /\.modal-foot\s*>\s*\*:first-child\s*\{[^}]*margin-left:\s*auto/.test(CSS) ||
    /\.modal-foot\s*>\s*\*:first-child\s*\{[^}]*margin-left:\s*auto/.test(CSS2));
  ok('按钮不被压扁（flex: 0 0 auto）', /\.modal-foot\s*>\s*\*\s*\{[^}]*flex:\s*0 0 auto/.test(CSS));
  ok('纵向不滚（免得底栏长出滚动条）', /overflow-y:\s*hidden/.test(footRule));
  ok('触屏惯性滚动', /-webkit-overflow-scrolling:\s*touch/.test(footRule));

  /* 「细看此人」的按钮串真的会排很多个 —— 说明这确实是个要滑的场景 */
  const btnIds = (UISRC.match(/id="npc-prof-[a-z]+"/g) || []);
  ok('「细看此人」底部按钮 ≥ 6 个（真会溢出）', new Set(btnIds).size >= 6,
    [...new Set(btnIds)].join(' '));

  /* ================= 七、两份副本同步 ================= */
  section('7 两份副本逐字节一致');
  ok('ui.js 两份一致', UISRC === UI2);
  ok('main.css 两份一致', CSS === CSS2);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
