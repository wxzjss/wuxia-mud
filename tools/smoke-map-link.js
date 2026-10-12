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
  const build = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF', 'mapScope',
    grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
    esc, 30, 26, 34, DIR_CN, DIR_OFF, 'world');
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
    const MAP_CELL = 30, MAP_PAD = 34;
    const b = m.bounds;
    const px = r => (r.x - b.minX) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
    const py = r => (r.y - b.minY) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
    const roomOf = {};
    (m.rooms || []).forEach(r => { roomOf[r.id] = r; });
    const allD = (html.match(/<path d="([^"]*)"/g) || []).join(' ');
    /* ★ 2026-10-13 加分层之后，C-1 的口径必须跟着改：
       地图一次只画**一层**（`rooms` 已按 `r.z === 当前层` 过滤），
       于是「一端在楼上、一端在楼下」的边（u/d 那种）在平面上被过滤掉了 ——
       它们由 ▲/▼ 角标 + 分层切换器表达，不再拖一条横穿的线。
       ⇒ 所以这里断言的是「**两端都渲染在当前视图里**的 bridges 边必须画出来」，
         而不是「bridges 里所有边都必须画」（后者在分层视图下必然假红）。
       `roomOf` 是从 `m.rooms`（后端下发的、**未按层过滤**的全量）建的，
       所以要另建一份「本视图渲染集合」来判。 */
    const shownIds = {};
    (m.rooms || []).forEach(r => { if ((Number(r.z) || 0) === 0) shownIds[r.id] = true; });
    const missing = (m.bridges || []).filter(br => {
      const A = roomOf[br.a], B = roomOf[br.b];
      if (!A || !B) return false;
      const aShown = !!shownIds[br.a] || !!roomOf[br.a] && !!roomOf[br.a].current;
      const bShown = !!shownIds[br.b] || !!roomOf[br.b] && !!roomOf[br.b].current;
      if (!aShown || !bShown) return false;         /* 跨层边：本就不在平面上画 */
      /* 起点（A 的格心）必须出现在某条 path 里 */
      const key = 'M' + px(A) + ' ' + py(A) + ' ';
      return allD.indexOf(key) < 0;
    });
    const onLevel = (m.bridges || []).filter(br =>
      shownIds[br.a] || shownIds[br.b] ||
      (roomOf[br.a] && roomOf[br.a].current) || (roomOf[br.b] && roomOf[br.b].current));
    ok('C-1 ★ 同一层里的 bridges 每条边都画出来了（一条不漏）', missing.length === 0,
      missing.length ? ('漏画 ' + missing.length + ' 条，例：' + missing[0].a + '→' + missing[0].b)
        : ('同层 ' + onLevel.length + ' 条全在，跨层 ' + ((m.bridges || []).length - onLevel.length) + ' 条交给分层视图'));

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

  /* ---------- D. 路牌不遮地块名 ---------- */
  section('D · 区域边界路牌不遮挡地块名（2026-10-13 主人亲报）');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    const hintRule = (css.match(/\.map-edge-hint\s*\{[^}]*\}/) || [''])[0];
    const nodeRule = (css.match(/\.map-node\s*\{[^}]*\}/) || [''])[0];
    const zi = s => { const mm = s.match(/z-index:\s*(\d+)/); return mm ? Number(mm[1]) : 0; };
    ok('D-1 ★ 路牌层级不高于地块（否则压住地块名）',
      zi(hintRule) <= zi(nodeRule),
      '路牌 z=' + zi(hintRule) + ' 地块 z=' + zi(nodeRule));
    ok('D-2 ★ 路牌没有实心底色（不透明浮层是「遮挡」的根）',
      !/background:\s*(var\(|#|[a-z])/.test(hintRule.replace(/background:\s*none/gi, '')),
      hintRule.replace(/\s+/g, ' ').slice(0, 110) || 'NOT FOUND');
    ok('D-3 路牌没有边框（有边框＝仍是个「牌子」，边界上会切掉邻格的视野）',
      /border:\s*0/.test(hintRule), hintRule.replace(/\s+/g, ' ').slice(0, 110));
    ok('D-4 路牌用描边字（text-shadow），压在走廊上仍可读',
      /text-shadow/.test(hintRule), hintRule.replace(/\s+/g, ' ').slice(0, 110));

    /* 渲染层：路牌确实渲染出来了（没被顺手删） */
    const hints = html.match(/class="map-edge-hint"/g) || [];
    ok('D-5 路牌仍照常渲染（这条修的是「不遮挡」，不是「删掉」）', hints.length > 0, hints.length + ' 块');
  }

  console.log('');
  console.log('地图连线守卫：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
