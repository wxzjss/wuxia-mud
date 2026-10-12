/* ============================================================
 * smoke-map-level.js —— 世界地图「分层」守卫（2026-10-13）
 *
 * 主人原话（两句，第二句是当场补的纠正）：
 *   ①「给地图分层，有一层二层之类的区别，因为有的地块可以往"下"走」
 *   ②「但不要定死只有两层，也要考虑万一以后有什么 mod 能往下多走或往上多走」
 *
 * ②就是这脚本存在的全部理由 —— 分层必须**由数据决定**，不许硬编码。
 * 这个脚本钉死四件事：
 *   A. 层清单由数据的 z 值去重排序实时生成（数据有 -1~8 就有 10 颗按钮）；
 *   B. **响应式**：往数据里塞一间 z=9 / z=-3 的屋子，层清单自动多两颗
 *      （这才是「不定死两层」的可验证形态）；
 *   C. 切层真的换内容：切到某层，图上只剩那一层的地块 + 你所在的那一格；
 *   D. 角标：能上楼/能下楼的格子有 ▲/▼。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const CSS = path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; } else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const section = t => console.log('\n── ' + t + ' ──');

(async () => {
  const e = new GameEngine({ seed: 20261013 });
  await e.boot({});
  e.newGame({ name: '观' });
  const v = e.view({ map: true });
  const m = v.map;
  const XYS = require(path.join(ROOT, 'game/src/core/maplayout.js')).DIR_DELTA;
  void XYS;

  /* ---- 从源码里抠 mapHtml + 依赖，真执行（照 smoke-map-link 的做法） ---- */
  const UISRC = fs.readFileSync(path.join(RJS, 'ui.js'), 'utf8');
  function grab(name) {
    const mm = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
    if (!mm) throw new Error('未找到 ' + name);
    return mm[0];
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
  const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };

  /* `mapLevel` 是模块级状态（切层按钮写它）。测试里没法直接碰模块变量，
     所以用 `Function` 包的**同签名**，把 `mapLevel` 当形参传进去 —— 这样
     「默认 0」与「切到某层」两种情形都能真渲染。 */
  function build(mapLevel) {
    return new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
      'mapScope', 'mapLevel',
      grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
      esc, 30, 26, 34, DIR_CN, DIR_OFF, 'world', mapLevel);
  }

  const rooms = e.world.data.rooms;

  /* ---------- A. 层清单由数据决定 ---------- */
  section('A · 层清单由数据决定（不是硬编码两层）');
  const zCount = {};
  (m.rooms || []).forEach(r => { const z = Number(r.z) || 0; zCount[z] = (zCount[z] || 0) + 1; });
  const zList = Object.keys(zCount).map(Number).sort((a, b) => a - b);
  {
    ok('A-1 数据里确实不止两层（否则这条功能没意义）', zList.length > 2,
      zList.length + ' 层：' + zList.join(','));
    ok('A-2 数据里同时有「往上」和「往下」（正 z 与负 z 都有）',
      zList.some(z => z > 0) && zList.some(z => z < 0),
      '负 ' + zList.filter(z => z < 0).join(',') + ' / 正 ' + zList.filter(z => z > 0).join(','));
  }

  /* ---------- B. 响应式：加 z=9 / z=-3 自动多两颗按钮 ---------- */
  section('B · 响应式：Mod 加新层，按钮自动多出来（主人第②句的落点）');
  const html0 = build(0).mapHtml(v);
  const btns0 = (html0.match(/class="ml-btn/g) || []).length;
  {
    ok('B-1 默认渲染出的层按钮数 == 数据里的层数', btns0 === zList.length,
      btns0 + ' 颗 vs 数据 ' + zList.length + ' 层');
    ok('B-2 层数 > 2（不是写死两层）', btns0 > 2, btns0 + ' 颗');
  }
  {
    /* ⚠️ 关键：层清单来自 **`m.rooms`**（mapView 下发的、带 z 的那份），
       不是 `e.world.data.rooms` —— 后者是**原始数据文件**，里面根本没有 z
       （z 是布局阶段算/标上去的，数据文件里连字段都没有）。
       第一版守卫往 `e.world.data.rooms` 里塞房 → 层清单纹丝不动 → 假红。
       教训同记忆里那条：「必须核对后端真下发的数据」。 */
    const base = (m.rooms || []).find(r => (Number(r.z) || 0) === 0);
    const mk = (id, z) => Object.assign({}, base, { id, z, exits: [] });
    m.rooms.push(mk('_lvtest_up9', 9));
    m.rooms.push(mk('_lvtest_dn3', -3));
    const html1 = build(0).mapHtml(v);
    const btns1 = (html1.match(/class="ml-btn/g) || []).length;
    ok('B-3 ★ 加一间 z=9 与一间 z=-3 → 层清单自动多两颗（没有硬编码上限）',
      btns1 === btns0 + 2, btns1 + ' 颗 vs 预期 ' + (btns0 + 2) + ' 颗');
    ok('B-4 ★ 新出现的层能被渲染出来（九层 / 地下3层）',
      /data-level="9"/.test(html1) && /data-level="-3"/.test(html1), '');
    /* 收拾干净，别污染后面几段 */
    m.rooms = m.rooms.filter(r => String(r.id).indexOf('_lvtest_') !== 0);
  }

  /* ---------- C. 切层真的换内容 ---------- */
  section('C · 切层真的换内容（切到某层只剩那层 + 你所在那格）');
  {
    /* 先找一间 z≠0 的房，把人挪过去，看「切走之后你还在地图上」 */
    const upR = (m.rooms || []).filter(r => (Number(r.z) || 0) === 1);
    ok('C-1 数据里 z=1 那一层有房（不然下面没法测）', upR.length > 0, upR.length + ' 间');
    const html1 = build(1).mapHtml(v);
    const n1 = (html1.match(/class="map-node/g) || []).length;
    const n0 = (html0.match(/class="map-node/g) || []).length;
    ok('C-2 ★ 切到二层后地块数变了（不是把全图都画出来）', n1 !== n0,
      '一层 ' + n0 + ' 间 → 二层 ' + n1 + ' 间');
    ok('C-3 二层地块数 == 数据里 z=1 的房数（± 当前那格）',
      Math.abs(n1 - (zCount[1] || 0)) <= 1, n1 + ' vs ' + zCount[1]);
    ok('C-4 切层按钮渲染出来了（可切换）', /class="ml-btn/.test(html1), '有按钮');
    ok('C-5 当前层按钮带 .on（看得出在哪一层）', /class="ml-btn on"/.test(html1), '有 .on');
  }

  /* ---------- D. 角标 ▲/▼ ---------- */
  section('D · ▲/▼ 角标：说出哪一格有楼梯');
  {
    /* 数据里真有 u/d 出口的房（同样看 `m.rooms`，它带着 exits 数组） */
    const withUD = (m.rooms || []).filter(r =>
      (r.exits || []).indexOf('u') >= 0 || (r.exits || []).indexOf('d') >= 0);
    ok('D-1 数据里有带上下楼出口的房', withUD.length > 0, withUD.length + ' 间');
    const someHas = withUD.some(r => (Number(r.z) || 0) === 0);
    ok('D-2 一层里就有带楼梯的房（切到一层也看得到 ▲/▼）', someHas, '');
    const marks = html0.match(/class="mn-lv"/g) || [];
    ok('D-3 ★ 渲染里真出了 ▲/▼ 角标', marks.length > 0, marks.length + ' 个');
    ok('D-4 角标带 title 说明（可上楼/可下楼/两样都行）',
      /class="mn-lv" title="[^"]*"/.test(html0), '');
  }

  /* ---------- E. CSS 契约 ---------- */
  section('E · CSS 契约');
  {
    const css = fs.readFileSync(CSS, 'utf8');
    const rule = s => (css.match(new RegExp('\\.' + s + '\\s*\\{[^}]*\\}')) || [''])[0];
    ok('E-1 .map-level 存在（分层条）', !!rule('map-level'), '');
    ok('E-2 .ml-btn 存在（层按钮）', !!rule('ml-btn'), '');
    ok('E-3 .ml-btn.on 有实心底色（当前层一眼看出）',
      /\.ml-btn\.on\s*\{[^}]*background/.test(css), '');
    ok('E-4 .mn-lv 存在且小字号（角标不抢戏）',
      /\.map-node \.mn-lv\s*\{[^}]*font-size/.test(css), '');
    ok('E-5 .mn-lv 关掉指针事件（别把点击拦在地块外）',
      /\.map-node \.mn-lv\s*\{[^}]*pointer-events:\s*none/.test(css), '');
    /* F: 分层条与视野条视觉可区分（一个金色一个玉色） */
    ok('E-6 分层按钮(.ml-btn.on)与视野按钮(.ms-btn.on)不同色（两排胶囊不混淆）',
      /\.ml-btn\.on\s*\{[^}]*background:\s*var\(--gold\)/.test(css)
      && /\.ms-btn\.on\s*\{[^}]*background:\s*var\(--jade\)/.test(css), '');
  }

  /* ---------- F. 事件绑定 ---------- */
  section('F · 切层按钮绑了事件（点了真换层）');
  {
    ok('F-1 绑定了 [data-level] 的 onclick', /querySelectorAll\('#modal-body \[data-level\]'\)/.test(UISRC),
      '');
    ok('F-2 onclick 里把值写回 mapLevel', /mapLevel\s*=\s*isFinite\(z\)/.test(UISRC), '');
    ok('F-3 mapLevel 是**数字**型状态（原始 z 值，不是 0/1/2 枚举）',
      /let mapLevel = 0;/.test(UISRC), '');
  }

  console.log('');
  console.log('地图分层守卫：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
