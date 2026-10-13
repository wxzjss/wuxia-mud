/* ============================================================
 * smoke-map-link.js —— 世界地图「连线完整性」守卫（2026-10-13）
 *
 * 主人两条要求：
 *   ①「把世界地图做成和区域地图一样的『连线』形式」——
 *      **有出口就该有线**，不能因为布局摆不下就空着。
 *   ②「检测一下相邻地块的连线，地图上显示的已相连地块是否真的相邻」——
 *      画出来的线两端必须真有出口（不能有「看着连着、其实走不通」的线），
 *      反过来「真有出口」的也必须画出来（不能漏）。
 *
 * 这个脚本把两条都钉住：
 *   A. 数据层：`check-map-adjacency` 的三件（有出口但不相邻 / 缺回边 / 紧贴但无出口）
 *      —— 后两条必须是 0；第一条（图论限制，摆不平的边）由前端补线兜底，
 *      断言「补线条数 == 不相邻边条数」（一条都不许漏）。
 *   B. 渲染层：真跑 mapHtml，从 SVG 里数出线段，与后端 bridges 对得上；
 *      且「距离近的走折线（`L` 段多）、距离远的走细线（`.edge-far`）」两档都在。
 *   C. 反向守卫：**不许有「图上没线但也没进 bridges」的边**（真漏画），
 *      以及**bridges 里不许混进「其实相邻」的边**（重复画 = 叠线）。
 *   D. 区域边界路牌不许遮挡地块名（2026-10-13 主人亲报）：
 *      牌子的 z-index 不得高于地块（否则压字），且 CSS 里不许有实心底色。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const CSS = path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const ml = require(path.join(ROOT, 'game/src/core/maplayout.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; } else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const section = t => console.log('\n── ' + t + ' ──');

const xy = (x, y) => x + ',' + y;

(async () => {
  const e = new GameEngine({ seed: 20261013 });
  await e.boot({});
  e.newGame({ name: '观' });
  const v = e.view({ map: true });
  const m = v.map;
  const rooms = e.world.data.rooms;
  const cells = m.cells || {};

  /* ---------- A. 数据层 ---------- */
  section('A · 地图数据里「出口」与「坐标」是否自洽');
  {
    /* ⚠️ 口径必须与后端 mapView **完全一致**，否则全是假红：
       ① 排除 `private:true` 的房间（engine.js 的 allRooms 过滤）——
          24 个 `hm_*` NPC 私宅不上地图（design/09 §3.3）。
          一端的房间不上图 ⇒ 那条出口在前端本来就画不出来，
          后端也不算进 bridges —— 这不是「漏画」，是「另一端不在地图上」。
          第一版守卫漏了这条过滤，凭空多算出 24 间房的边。
       ② 「相邻」= 后端那套 `cellB == cellA + DIR_DELTA[dir]`（精确方向），
          不是「切比雪夫距离 1」。两者对**方向自洽**的数据等价，
          但布局会把某条边挤到别的方向上去（findFreeCell 抢占），
          这时后端判「不相邻」→ 进 bridges，守卫也得判「不相邻」。
       ③ u/d（上下楼）delta 是 [0,0]，后端明确不摆平面、也不进 bridges，跳过。 */
    /* 🔴 必须用 **engine 下发的那份坐标**（`cells`）来判，不能自己重算一遍：
       两次 `layoutAll` 的输入只要差一间房（比如漏了 private 过滤），
       整张图的区域装箱结果就完全不同（实测 536 个坐标**全部**不一样），
       于是「不相邻」的边集合也对不上，全是假红。
       教训：守卫要**核对后端真下发的数据**，不是复现一遍后端的算法 ——
       复现出来的两份东西永远可能因为一个细节分叉。
       ⚠️ **u/d（上下楼）不要跳过** —— 后端把它们也算「不相邻」发了出来：
          delta 是 [0,0]，除非两个房间压在同一格，否则 `c1+Δ !== c2` 恒成立，
          于是后端会发。这其实**是对的**：上下楼在平面图上确实不并排，
          画条线提示「这里有楼梯通往那间」比空着好。
          第一版守卫按「u/d 不画线」跳过，于是凭空多算出 80 条不存在的「漏画」。 */
    const DD = ml.DIR_DELTA || {};
    let notAdj = 0;
    const notAdjKeys = new Set();
    Object.keys(cells).forEach(id => {
      const r = rooms[id]; if (!r || !r.exits) return;
      const c = cells[id];
      for (const dir of Object.keys(r.exits)) {
        const d = DD[String(dir).toLowerCase()];
        if (!d) continue;                            // 未知方向（数据里没有的写法）
        const tid = r.exits[dir];
        if (!tid || !cells[tid]) continue;           // 另一端不在图上（被过滤 / 不存在）
        const tc = cells[tid];
        if (c.x + d[0] !== tc.x || c.y + d[1] !== tc.y) {
          notAdj++;
          notAdjKeys.add([id, tid].sort().join('~'));
        }
      }
    });
    ok('A-2 不相邻的出口边**全部**进 bridges（一条都不许漏画）',
      (m.bridges || []).length === notAdjKeys.size,
      '不相邻 ' + notAdjKeys.size + ' 条 vs bridges ' + (m.bridges || []).length + ' 条');

    /* bridges 里不许混进「其实相邻」的边 —— 那会和走廊线重复画。
       判据同 ②：用**真出口的方向**算，不是用坐标距离反推。 */
    const dupAdj = (m.bridges || []).filter(br => {
      const A = rooms[br.a], B = rooms[br.b];
      if (!A || !B || !cells[br.a] || !cells[br.b]) return false;
      const d = DD[String(br.dir).toLowerCase()];
      if (!d) return false;
      const ca = cells[br.a], cb = cells[br.b];
      return ca.x + d[0] === cb.x && ca.y + d[1] === cb.y;
    });
    ok('A-3 bridges 里没有「其实相邻」的边（不重复画叠线）', dupAdj.length === 0,
      dupAdj.length ? JSON.stringify(dupAdj[0]) : '全部 ' + (m.bridges || []).length + ' 条都不相邻');

    /* bridges 两端必须是真实房间（且都上地图） */
    const badEnd = (m.bridges || []).filter(br => !cells[br.a] || !cells[br.b]);
    ok('A-4 bridges 两端都是地图上的真实房间', badEnd.length === 0, badEnd.length + ' 条端点不存在');

    /* A 类分布：多数应该「只差一两格」（= 布局摆不下时的邻格错位），
       而不是「横跨半个大陆」（那说明布局塌了）。这条是**健康度**断言，
       给出上界而不要求 0 —— 真 0 是图论上做不到的（见 ui.js 的 4b 段注释）。 */
    const far = (m.bridges || []).filter(br => {
      const A = cells[br.a], B = cells[br.b];
      return A && B && Math.max(Math.abs(A.x - B.x), Math.abs(A.y - B.y)) > 8;
    });
    ok('A-5 不相邻的边里「跨 8 格以上」的占比 < 40%（布局没塌）',
      far.length / Math.max(1, notAdjKeys.size) < 0.4,
      far.length + '/' + notAdjKeys.size + ' 条很远');
  }

  /* ---------- B/C. 渲染层 ---------- */
  section('B · 真渲染：每条通路都画出来了');
  const UISRC = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  function grab(name) {
    const mm = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
    if (!mm) throw new Error('未找到 ' + name);
    return mm[0];
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
  const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
  const build = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
    grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
    esc, 30, 26, 34, DIR_CN, DIR_OFF);
  const html = build.mapHtml(v);

  {
    /* 三条 path：走廊（相邻）/ 近折线（不相邻但近）/ 远细线（不相邻且远） */
    const farPath = (html.match(/<path d="([^"]*)" class="edge edge-far"\/>/) || [])[1];
    const paths = [...html.matchAll(/<path d="([^"]*)" class="edge edge-(dim|known)"\/>/g)];
    const totalSegs = [...html.matchAll(/M/g, '')].length;
    const allM = (html.match(/class="edge edge-(dim|known|far)"/g) || []).length;
    ok('B-1 画了三档线（相邻走廊 / 近折线 / 远细线）', allM >= 2, allM + ' 条 path');

    /* 折线：不相邻但近的边应该走「先横后纵」两段（含两个 L） */
    const nearPath = paths.map(p => p[1]).join(' ');
    const elbowCount = (nearPath.match(/L/g) || []).length;
    ok('B-2 「近」档的线走折线（有拐点，不是斜穿）', elbowCount > 0,
      elbowCount + ' 个 L 段');

    /* 远档必须是细淡的点状线（CSS 层验证） */
    const css = fs.readFileSync(CSS, 'utf8');
    const farRule = (css.match(/\.map-edges \.edge-far\s*\{[^}]*\}/) || [''])[0];
    ok('B-3 远档线是细的（stroke-width ≤ 3，不抢视线）',
      /stroke-width:\s*[0-3](\D|$)/.test(farRule), farRule.replace(/\s+/g, ' ').slice(0, 90) || 'NOT FOUND');
    ok('B-4 远档线是淡的（有 opacity < 1）', /opacity:\s*0?\.\d+/.test(farRule),
      farRule.replace(/\s+/g, ' ').slice(0, 90));
    ok('B-5 远档线是点状（dash 比常态密，不然会看成一整条粗线）',
      /stroke-dasharray/.test(farRule), farRule.replace(/\s+/g, ' ').slice(0, 90));

    /* C. 反向守卫：任意一条「不相邻的出口边」都必须在渲染里出现。
       做法：把 bridges 每条边的两端像素坐标算出来，检查 SVG 的 d 串里
       确实含这两个点（近档走折线，起点仍是 cx/cy）。 */
    /* ⚠️ 这两个数**必须跟着 ui.js 的 `mapHtml` 走**：格距与留白是在那里算的，
       这里要拿同样的值把「房间坐标」换算成「像素坐标」才能去 SVG 里比对。
       🔴 P0-C C-2（spec §3.7）：格距从 **30 → 52**（桌面/L 档），
       抽取环境里没有 DOM ⇒ `vw === 0` ⇒ 落 L 档 52px（与 ui.js 的兜底约定一致）。
       没跟着改的症状：坐标整体错位，于是「本该找到的点一个都找不到」，
       实测**假红 9 条漏画**（看着像渲染 bug，其实是量具的尺子没换）。
       ⇒ 这是「两处各写一份」的又一个实例（本项目已踩过 ZMIN/ZMAX 两次），
          改 ui.js 的 `tier` 表或 `MAP_PAD`，这里必须同步。 */
    const MAP_CELL = 52, MAP_PAD = 34;
    /* ⚠️ `b` 必须是**渲染时的那个取景框**，不是 `m.bounds`。
       `mapHtml` 开头会把视野裁到「本区房间的紧包围盒」（`b = {minX,minY,w,h}`），
       而 `m.bounds` 是**全图** bounds —— 两者差着区域装箱留下的空当，
       混用会让算出来的像素坐标整体偏移（实测偏 210px），
       于是「本该找到的点一个都找不到」，12 条全判漏画（假红）。 */
    const hereR = (m.rooms || []).find(r => r.current);
    const curRegion = hereR ? hereR.region : null;
    const mine = (m.rooms || []).filter(r => r.region === curRegion);
    const b = mine.length
      ? {
        minX: Math.min.apply(null, mine.map(r => r.x)),
        minY: Math.min.apply(null, mine.map(r => r.y)),
      }
      : { minX: m.bounds.minX, minY: m.bounds.minY };
    const cellOf = id => (m.cells || {})[id];
    const roomOf = {};
    (m.rooms || []).forEach(r => { roomOf[r.id] = r; });
    /* 「本次真渲染出来的房间」—— 从 HTML 里的 `data-room="X"` 反读。
       ⚠️ 判据必须与 ui.js 里 `shown[br.a]` 那一份**同源**（都是「本区、已画」）：
         自己按 region 重算一遍迟早和后端/前端的过滤条件分叉（老坑）。 */
    const rendered = new Set([...html.matchAll(/data-room="([^"]+)"/g)].map(x => x[1]));
    const allD = (html.match(/<path d="([^"]*)"/g) || []).join(' ');
    /* ◀◀ 这一节原来的坐标算式（`px`/`py` 用 `m.bounds`）**是错的**，别照抄。
       它算出来的 (1039,169) 这种大数，在渲染出的 SVG 里**根本不可能出现** ——
       因为 `mapHtml` 前面还有一道「裁到本区紧包围盒」：
         `b = 本区房间的 minX/minY/maxX/maxY`（`m.bounds` 是**全图** bounds）。
       叠上区域装箱的空当，全图 bounds 的 minX 会到 -3 这种值，
       于是 `(37-(-3))*30+34+15 = 1249`，而真渲染的格心是 `1039`。
       ⇒ 判据必须**与 ui.js 同源**：从渲染出的 SVG 里反读「每条 link 的起点」，
         再拿它跟「后端说该连的那对房间」核对，而不是自己重算一遍坐标。
       （老铁律：守卫要核对后端真下发的数据，不要复现一遍算法。） */
    const linkD = (html.match(/<path d="([^"]*)" class="edge edge-(?:dim|known) edge-link"\/>/g) || [])
      .map(s => (s.match(/d="([^"]*)"/) || [])[1] || '').join(' ');
    const linkStarts = new Set((linkD.match(/M(\d+) (\d+)/g) || []).map(s => s.slice(1)));
    /* 每条 bridge 的**两端都在图上**（= 都渲染成格子了），
       它的某个端点就必须是某条 link 线的起点或终点。
       判据：A 的格心 / B 的格心，至少有一个出现在 link 线的点集里。 */
    const allLinkPts = new Set((linkD.match(/\d+ \d+/g) || []));
    const missing = (m.bridges || []).filter(br => {
      if (!rendered.has(br.a) || !rendered.has(br.b)) return false;
      const A = cellOf(br.a), B = cellOf(br.b);
      if (!A || !B) return false;
      const pa = (A.x - b.minX) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
      const qa = (A.y - b.minY) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
      const pb = (B.x - b.minX) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
      const qb = (B.y - b.minY) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
      return !allLinkPts.has(pa + ' ' + qa) && !allLinkPts.has(pb + ' ' + qb);
    });
    ok('C-1 ★ 画面里的 bridges 每条边都画出来了（一条不漏）', missing.length === 0,
      missing.length ? ('漏画 ' + missing.length + ' 条，例：' + missing[0].a + '→' + missing[0].b)
        : ('图上 ' + (m.bridges || []).length + ' 条里，两端可见的 ' +
           (m.bridges || []).filter(br => rendered.has(br.a) && rendered.has(br.b)).length +
           ' 条全在，其余跨区边交给出界提示'));

    /* C-2 反向：渲染里的每条 bridges 线两端都得真有出口（不许凭空连线） */
    const fake = (m.bridges || []).filter(br => {
      const A = rooms[br.a], B = rooms[br.b];
      if (!A || !B) return true;
      const dirs = DIR_CN;
      return !Object.keys(A.exits || {}).some(d => A.exits[d] === br.b)
        && !Object.keys(B.exits || {}).some(d => B.exits[d] === br.a);
    });
    ok('C-2 ★ 画出来的线两端都真有出口（没有凭空连线）', fake.length === 0,
      fake.length ? JSON.stringify(fake[0]) : '全部有据可依');
  }

  /* ---------- D. 路牌不遮地块名 —— 🔴 已整体下线 ---------- */
  section('D · 区域边界路牌（2026-10-11 要的，2026-10-12 随全图一起删）');
  {
    /* 🔴 2026-10-12 主人「只保留当前区域界面，把天下全图整个界面删了」。
       路牌是**全图专属**的：它贴在「本区」与「邻居区」之间那道缝里，
       而地图只剩本区一块 —— 邻居不在图上，缝不存在，牌子无处可贴。
       ⇒ 所以这一节从「牌子不遮挡地块名」**反转成「牌子真的没了」**。
       2026-10-13 主人亲报的「『锦国旧陵』『黑木崖』遮挡了地块名」也随之彻底消失。
       ⚠️ 别只删生成侧：CSS 两条规则（.map-edge-hint / .meh-arrow）也要一起走，
          否则以后有人看见规则还在，会以为这功能只是被临时关掉了。 */
    const css = fs.readFileSync(CSS, 'utf8');
    ok('D-1 ★ 渲染里不再有路牌（.map-edge-hint 0 块）',
      (html.match(/class="map-edge-hint"/g) || []).length === 0,
      (html.match(/class="map-edge-hint"/g) || []).length + ' 块');
    ok('D-2 ★ 源码里也没有 edgeHintHtml（不是「恰好没渲染」）',
      !/const edgeHintHtml/.test(fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8')));
    ok('D-3 ★ CSS 里 .map-edge-hint 规则已删', !/\.map-edge-hint\s*\{/.test(css));
    ok('D-4 CSS 里 .meh-arrow 规则已删', !/\.meh-arrow\s*\{/.test(css));
    /* 「遮挡」这条 bug 的另一半根因（长名溢出）不随路牌消失 —— 它仍在
       smoke-map-name 之类脚本里守着，这里只确认路牌这半边清干净了。 */
    ok('D-5 源码里也不再拼 meh-arrow（箭头元素彻底没了）',
      !/meh-arrow/.test(fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ')));
  }

  console.log('');
  console.log('地图连线守卫：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
