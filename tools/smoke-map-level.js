/* ============================================================
 * smoke-map-level.js —— 地图「只有本区一层」守卫（2026-10-13 重写）
 *
 * 来历（这一版为什么会变成这样，别改回去）：
 *   ① 2026-10-13 主人先说：「给地图分层，有一层二层之类的区别，因为有的地块可以
 *      往"下"走」，又当场补一句「但不要定死只有两层，也要考虑万一以后有什么 mod
 *      能往下多走或往上多走」—— 于是有了 `.ml-btn` 那排「由数据实时生成」的层按钮，
 *      本脚本原先守的就是它（层清单响应式、切层换内容、▲/▼ 角标、CSS 契约、事件绑定）。
 *   ② 2026-10-12/13 主人又改主意：「把天下全图删了」→ 追问后明确
 *      **「只保留当前区域界面，把天下全图整个界面删了」**。
 *      分层是**全图专属**的（本区里带 z 的房间就那么几间，切层只会切出一屏空白），
 *      于是 `.map-level` 整条撤掉。
 *
 * ⇒ 所以本脚本**反转口径**：从「分层功能好不好用」改成「分层真的没了 + 没白丢信息」。
 *   只删功能、不留守卫，下次谁把 `.map-level` 加回来都没人拦；
 *   而「没白丢信息」这两条是这个删改里最容易被忽略的部分：
 *   层信息必须还在（▲/▼ 角标 + tooltip 的「三层 / 地下2层」），
 *   否则玩家会以为那些上楼下楼的房间凭空消失了。
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

  /* ⚠️ `mapHtml` 的形参表里**已经没有 mapScope / mapLevel** 了（两者都删了）。
     还留着那两个形参的话这里会「传了个寂寞」—— 环境里多了两个没用的名字，
     将来有人误以为它们还活着。所以形参表与本脚本一起瘦身。 */
  function build() {
    return new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
      grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
      esc, 30, 26, 34, DIR_CN, DIR_OFF);
  }
  const html = build().mapHtml(v);

  /* ---------- A. 分层切换器真的没了 ---------- */
  section('A · 分层切换器已整体下线（主人 2026-10-12）');
  {
    ok('A-1 ★ 渲染里不再有层按钮（.ml-btn 0 颗）',
      (html.match(/class="ml-btn/g) || []).length === 0,
      (html.match(/class="ml-btn/g) || []).length + ' 颗');
    ok('A-2 ★ 渲染里不再有分层条（.map-level 不存在）', html.indexOf('map-level') < 0);
    ok('A-3 源码里也没有 mapLevel 状态（不是「渲染时恰好没画」）',
      !/let mapLevel\s*=/.test(UISRC) && !/mapLevel\s*=\s*isFinite/.test(UISRC));
    ok('A-4 也没有绑 [data-level] 的 onclick（生成侧删了，绑定侧也要删干净）',
      !/\[data-level\]/.test(UISRC.replace(/\/\*[\s\S]*?\*\//g, ' ')));
    ok('A-5 CSS 里没有 .map-level / .ml-btn 规则了',
      !/\.map-level\s*\{/.test(fs.readFileSync(CSS, 'utf8'))
      && !/\.ml-btn\s*\{/.test(fs.readFileSync(CSS, 'utf8')));
  }

  /* ---------- B. 视野切换器也真的没了 ---------- */
  section('B · 视野切换器已整体下线（同一批改动）');
  {
    ok('B-1 ★ 渲染里不再有 data-scope（本区/全图两颗按钮）', html.indexOf('data-scope') < 0);
    ok('B-2 源码里也没有 mapScope 状态', !/let mapScope\s*=/.test(UISRC));
    ok('B-3 「天下全图」四个字不再出现在前端（它已不是可选项）',
      !/天下全图/.test(html.replace(/<!--[\s\S]*?-->/g, ' ')));
    ok('B-4 CSS 里 .ms-btn（视野胶囊）已删', !/\.ms-btn\s*\{/.test(fs.readFileSync(CSS, 'utf8')));
    /* 容器留着 —— 它现在装的是那句「只显示你脚下这一片：XX」 */
    ok('B-5 .map-scope 容器**仍保留**（装着「只显示你脚下这一片」那句话）',
      html.indexOf('map-scope') >= 0 && html.indexOf('只显示你脚下这一片') >= 0);
  }

  /* ---------- C. 只有本区：一层、且是本区 ---------- */
  section('C · 地图只画本区（切不出别的区域，也不需要切）');
  {
    const here = (m.rooms || []).find(r => r.current);
    ok('C-1 数据里有「你在这里」', !!here, here ? here.name : '无');
    const curRegion = here ? here.region : null;
    const inReg = (m.rooms || []).filter(r => r.region === curRegion);
    const nodes = (html.match(/class="map-node/g) || []).length;
    ok('C-2 ★ 地块数 == 本区房间数（一个外区的都没混进来）',
      nodes === inReg.length, '渲染 ' + nodes + ' / 本区 ' + inReg.length);
    ok('C-3 本区房间数远小于全图（否则这条断言没意义）',
      inReg.length < (m.rooms || []).length,
      inReg.length + ' vs 全图 ' + (m.rooms || []).length);
    ok('C-4 ★ 只画本区一个区域框（别的区域的锚点也没了）',
      (html.match(/data-region-box="/g) || []).length === 1,
      (html.match(/data-region-box="/g) || []).length + ' 块');
    /* 本区房间可能跨层（有 u/d 出口的）。地图只画平面一层 ——
       断言「画出来的房间都是本区的」，不要求「都是 z=0 的」：
       z≠0 的本区房间照样属于本区，画出来不算错（它们的名字仍是识别该片土地的线索）。 */
    const allMine = (m.rooms || []).filter(r => r.region === curRegion).length;
    ok('C-5 渲染出的每一格都归属于本区（没有幽灵格子）', nodes <= allMine);
  }

  /* ---------- D. ▲/▼ 角标：层信息没白丢 ---------- */
  section('D · 层信息没白丢：▲/▼ 角标与 tooltip 的层名仍在');
  {
    const withUD = (m.rooms || []).filter(r => {
      const ex = r.exits || [];
      return ex.indexOf('u') >= 0 || ex.indexOf('d') >= 0;
    });
    ok('D-1 数据里有带上下楼出口的房（真数据）', withUD.length > 0, withUD.length + ' 间');
    const marks = html.match(/class="mn-lv"/g) || [];
    ok('D-2 ★ 渲染里真出了 ▲/▼ 角标（分层删了，但「这屋有楼梯」必须还在）',
      marks.length > 0, marks.length + ' 个');
    ok('D-3 角标带 title 说明（可上楼 / 可下楼 / 两样都行）',
      /class="mn-lv" title="[^"]*"/.test(html));
    /* tooltip 里写「三层 / 地下2层」—— 这是另一条「层信息没丢」的通道 */
    ok('D-4 ★ tooltip 里仍写着层名（lvName 没跟着分层一起删）',
      /\d层|地下\d+层/.test(html), (html.match(/title="[^"]*(?:三层|地下|一层|\d层)[^"]*"/) || [''])[0].slice(0, 80));
    ok('D-5 lvName 仍在源码里（房间 tooltip 的依赖）',
      /const lvName\s*=/.test(UISRC));
    const css = fs.readFileSync(CSS, 'utf8');
    ok('D-6 CSS 里 .mn-lv 仍在（角标样式没被顺手删）',
      /\.map-node \.mn-lv\s*\{[^}]*font-size/.test(css));
    ok('D-7 .mn-lv 仍关掉指针事件（别把点击拦在地块外）',
      /\.map-node \.mn-lv\s*\{[^}]*pointer-events:\s*none/.test(css));
  }

  console.log('');
  console.log('地图视野守卫：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
