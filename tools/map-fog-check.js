#!/usr/bin/env node
/* ==========================================================================
 *  tools/map-fog-check.js —— 地图迷雾守卫（design/78 §4.5.1–4.5.3，78/M-V-*）
 *  --------------------------------------------------------------------------
 *  为什么要这个脚本：
 *    主人最烦的就是地图上的「空白方块」。而**空心圈 `.mn-ring` 缺失**时，
 *    地图上只有「有字」和「整片空」两档 —— 玩家分不出"那边是堵墙"还是
 *    "那边有路、只是你没走过"。迷雾就失去意义了。
 *    外加一条更阴的：`explore.total` 的分母。P0-C 分批之后，前端手里的
 *    `m.rooms` 是**批内**集合（≈32），而全江湖是 512 —— 一旦后端漏发
 *    `explore`，界面就静默显示「全江湖 1/34」：**不报错，只是江湖变小**。
 *
 *  判据全部引自 design/78 §4.5.1 / §4.5.1-bis / §4.5.2 / §4.5.3。
 *  ⚠️ 引用编号时带文档号：`78/M-V-2`，不写裸 `M-V-2`。
 *
 *  覆盖：
 *    M-V-1  已探索档 = 有字（且是全名，不被截断）
 *    M-V-2  相邻可走档 = 无字 + 有且仅有 1 个 .mn-ring
 *    M-V-2b 🔴 形状判据：圈必须 background:transparent / border-width≥1px / radius≥50%
 *    M-V-3  完全未知档 = 无字 + 无圈
 *    M-V-4  .mn-ring 总数 === 「相邻可走」档数量
 *    M-V-7  未探索格子不剧透（无 title 里的房间名）
 *    M-V-8  迷雾开关存在且默认开
 *    M-V-9  关掉后回到「全都已知」：无圈、所有格子有字
 *    M-V-10 开关可来回切、状态持久
 *    M-V-11 开关不影响探索分母
 *    M-V-12 explore.total === 512
 *    M-V-13 前端不走「批内数」回落
 *    M-V-14 visited 是全局数
 *    M-V-16 L1 朱印唯一 / M-V-17 羽化层唯一（回归保护）
 *
 *  用法：node tools/map-fog-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const CSSSRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');

/** 从 ui.js 源码里抠出真实函数 —— 跑的是**生产代码**，不是我另写的替身 */
function grab(name) {
  const m = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('未找到函数 ' + name);
  return m[0];
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
/* ⚠️ MAP_CELL / MAP_PAD / MAP_NODE 在 mapHtml 内部会重新算（按视口与缩放），
   这里传的只是兜底值 —— 别拿它们当"当前格距"用（smoke-map-link 就栽过）。 */
const built = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
  grab('mapHtml') + '\nreturn { mapHtml };')(
    esc, 52, 26, 34, DIR_CN, DIR_OFF);

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ---- 解析 mapHtml 产出的格子 ---- */
function nodesOf(html) {
  const out = [];
  const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1], inner = m[2];
    if (!/class="[^"]*map-node/.test(attrs)) continue;
    const get = (k) => {
      const r = attrs.match(new RegExp(k + '="([^"]*)"'));
      return r ? r[1] : null;
    };
    const nameM = inner.match(/<span class="mn-name"[^>]*>([\s\S]*?)<\/span>/);
    out.push({
      cls: (attrs.match(/class="([^"]*)"/) || [, ''])[1],
      visited: get('data-visited'),
      near: get('data-near'),
      title: get('title'),
      rings: (inner.match(/class="mn-ring"/g) || []).length,
      nameText: nameM ? nameM[1].replace(/<wbr>/g, '').replace(/&amp;/g, '&').trim() : '',
    });
  }
  return out;
}

/* ================================================================ */
const e = new GameEngine({ seed: 20261008 });
e.boot();
/* 期望全集动态取真数据（act1 加房不用再改数字；smoke-npc-skills 334 同款口径） */
/* 期望全集 = 全部房间 − private（engine.js mapView 同一谓词，数据侧独立复算；act1 加房不用再改数字） */
const WORLD_ROOMS = (() => { const R = e.world.data.rooms; return Object.keys(R).filter(id => !(R[id] && R[id].private)).length; })();

section('78/M-V-12 / 13 / 14 探索分母（这条最阴：改坏了不报错，只是江湖变小）');

{
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const mv = e.mapView({ fog: 1, neighbors: 0 });
  ok('78/M-V-12 explore.total === 全世界房间数（世界全集，不是批内数）',
    mv.explore && mv.explore.total === WORLD_ROOMS,
    mv.explore ? JSON.stringify(mv.explore) : '(没有 explore 字段)');
  ok('78/M-V-14 visited 是走过的累计数（新档 = 当前 1 间）',
    mv.explore && mv.explore.visited >= 1, 'visited=' + (mv.explore || {}).visited);
}

/* ================================================================ */
section('78/M-V-1 / 2 / 2b / 3 / 4 迷雾三档（fog 开）');

let fogOn, fogOff;
{
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const v = e.view();
  /* view() 不传 fog；这里直接调 mapView 两种，再塞回 view 给 mapHtml 用 */
  v.map = e.mapView({ fog: 1, neighbors: 0, geometry: 1 });
  fogOn = built.mapHtml(v);
  v.map = Object.assign({}, e.mapView({ fog: 0, neighbors: 0, geometry: 1 }));
  fogOff = built.mapHtml(v);
}

{
  const ns = nodesOf(fogOn);
  const visited = ns.filter((n) => n.visited === '1');

  ok('78/M-V-1 已探索档每个都有字（且不含截断省略号）',
    visited.length > 0 && visited.every((n) => n.nameText.length > 0 && n.nameText.indexOf('…') < 0),
    visited.length + ' 格已探索 · 例：' + (visited[0] ? visited[0].nameText : '-'));

  /* 🔴 2026-10-21 主人点名：战争迷雾彻底关掉 —— 渲染层**不再按 visited 过滤**。
     fog 数据能力仍留在引擎里（本节就是喂 fog=1 的数据跑渲染），
     但画布上本区同层的房间**一间不少**，只是未探索格没有名字（后端裁掉了）。 */
  const fgProbe = e.view({ map: true }).map;
  const fgHere = fgProbe.rooms.find((r) => r.current) || {};
  const fgWant = fgProbe.rooms
    .filter((r) => r.region === fgHere.region && (r.z || 0) === (fgHere.z || 0)).length;
  ok('78/M-V-2 → 迷雾关闭：fog 数据下也画满本区同层（未探索不再零渲染）',
    ns.length === fgWant,
    '画出 ' + ns.length + ' / 本区同层 ' + fgWant);
  const unknownAll = ns.filter((n) => n.visited === '0');
  ok('78/M-V-3 → 未探索格仍占格：名字为空、也不画「？」',
    unknownAll.every((n) => n.nameText.length === 0)
    && (fogOn.match(/？/g) || []).length === 0,
    unknownAll.length + ' 个未探索格 · 「？」 ' + (fogOn.match(/？/g) || []).length + ' 个');
  const totalRings = (fogOn.match(/class="mn-ring"/g) || []).length;
  ok('78/M-V-4 → .mn-ring 渲染已退役（全图 0 圈）', totalRings === 0,
    totalRings + ' 个圈');
  ok('78/M-V-2b → .mn-ring CSS 规则已删（不再养死样式）',
    !/\.map-node\s+\.mn-ring\s*\{/.test(CSSSRC));

  /* M-V-7：全量视图（生产路径）里每格都有名字，不该再出现「尚未探索」兜底。
     这条现在防的是「fog 又被人偷偷打开」——名字一缺，兜底字样就会冒出来。 */
  const leak = nodesOf(fogOff).filter((n) => n.title && n.title === '尚未探索');
  ok('78/M-V-7 → 全量视图里没有「尚未探索」兜底（每格都有名字）',
    leak.length === 0, leak.length ? leak.length + ' 格没名字' : '0 格漏');
}

/* ================================================================ */
section('78/M-V-8 / 9 / 10 / 11 迷雾开关');

{
  /* M-V-8 → 2026-10-21 口径：战争迷雾彻底关掉。
     ① 前端 mapViewOpts **不传 fog**（服务端默认就是全量）；
     ② 渲染层不再按 visited/current 过滤；
     迷雾不挂设置开关（旧 mapnames 已退役，无映射）。 */
  ok('78/M-V-8 → 迷雾已关：mapViewOpts 不再传 fog',
    !/fog\s*:/.test(grab('mapViewOpts')));
  ok('78/M-V-8 → 渲染层不再按 visited 过滤（未探索也画）',
    !/if \(!r\.visited && !r\.current\) return;/.test(UISRC));

  /* M-V-9：全量数据（fog=0）下每格都有名字、无圈 */
  const ns = nodesOf(fogOff);
  const ringsOff = (fogOff.match(/class="mn-ring"/g) || []).length;
  const noName = ns.filter((n) => n.nameText.length === 0);
  ok('78/M-V-9 → 无圈（.mn-ring 已退役）', ringsOff === 0, ringsOff + ' 个圈');
  ok('78/M-V-9 → 全量视图渲染出的格子全部有名字',
    noName.length === 0,
    noName.length ? noName.length + ' 格无字' : ns.length + ' 格全部有字');

  /* M-V-10：幂等——同一份输入渲两次必须一致 */
  const v = e.view();
  v.map = e.mapView({ fog: 1, neighbors: 0, geometry: 1 });
  const a1 = built.mapHtml(v).length;
  v.map = e.mapView({ fog: 0, neighbors: 0, geometry: 1 });
  const b1 = built.mapHtml(v).length;
  v.map = e.mapView({ fog: 1, neighbors: 0, geometry: 1 });
  const a2 = built.mapHtml(v).length;
  ok('78/M-V-10 → 探索制：同输入渲两次一致（幂等）', a1 === a2,
    '第一次 ' + a1 + ' / 复渲 ' + a2 + ' / fog=0 版 ' + b1);

  /* M-V-11：开关两侧分母恒为 512（分母是引擎探索账本的事，渲染层不动它） */
  const t1 = (fogOn.match(/全江湖 (\d+)\/(\d+)/) || []);
  const t0 = (fogOff.match(/全江湖 (\d+)\/(\d+)/) || []);
  ok('78/M-V-11 → 探索制：分母不受渲染口径影响（两侧一致）',
    t1[2] === t0[2],
    '雾开 ' + (t1[2] || '?') + ' / 雾关 ' + (t0[2] || '?'));
}

/* ================================================================ */
section('78/M-V-13 前端不许拿批内数当全江湖分母');

{
  const v = e.view();
  /* 🔴 必须**带上 region 分批**再测：不传 region 的话后端发的是全量 512 间，
     批内数恰好等于 512 —— 那样这条断言就**永远绿**，等于没写
     （我第一版就是这么写的，跑出来"批内 512 间"，好看但毫无意义）。
     真正要防的是：分批之后批内只剩 30 来间，而 explore 一旦缺失，
     界面就会拿这个 30 去冒充世界的大小。 */
  const w = e.world;
  const curRegion = (w.getRoom(w.player.room) || {}).region;
  const full = e.mapView({ fog: 1, region: curRegion, neighbors: 0, geometry: 1 });
  const batch = (full.rooms || []).length;
  ok('78/M-V-13 前提：这批确实是分批的（批内数 ≠ 512，断言才有区分力）',
    batch > 0 && batch !== 512, '批内 ' + batch + ' 间 / 全江湖 512 间');

  /* 人为把 explore 摘掉，模拟"后端漏发" */
  const broken = Object.assign({}, full);
  delete broken.explore;
  v.map = broken;
  const h = built.mapHtml(v);
  /* 只取正文里那一行（title 属性里也有一份「全江湖 …」，别匹配到它） */
  const m = h.match(/class="mp-txt">[^<]*全江湖\s*([^<\s]*)/);
  const shown = m ? m[1].trim() : '(没渲染)';
  /* 期望是「—」（宁可不说，也不许说错），绝不许出现批内那个 32/34 */
  ok('78/M-V-13 explore 缺失时显示「—」，而不是批内数「' + batch + '」',
    shown === '—' && shown.indexOf('/' + batch) < 0,
    '显示为「全江湖 ' + shown + '」· 批内 ' + batch + ' 间 ⇒ '
      + (shown === '—' ? '没撒谎' : '⚠ 拿批内数冒充了世界大小'));
}

/* ================================================================ */
section('78/M-V-16 / 17 回归保护（改迷雾别改坏已落地的）');

{
  const v = e.view();
  v.map = e.mapView({ fog: 1, neighbors: 0, geometry: 1 });
  const h = built.mapHtml(v);
  ok('78/M-V-16 → 已反转：朱砂方印已删（2026-10-18 主人四条 UI 之②：玩家位置只留金字，无底色块）',
    (h.match(/class="mn-seal"/g) || []).length === 0,
    (h.match(/class="mn-seal"/g) || []).length + ' 个');
  ok('78/M-V-17 羽化层唯一', (h.match(/class="map-veil"/g) || []).length === 1,
    (h.match(/class="map-veil"/g) || []).length + ' 个');
}

/* ================================================================ */
section('迷雾默认关闭（2026-10-21 主人点名：彻底关掉）');
/* 口径：fog 渲染分支保留（能力测试照旧跑 fog=1/0 两种），但**前端不启用**
   —— mapViewOpts 不传 fog，渲染层不按 visited 过滤；迷雾开关早已摘除。 */
ok('迷雾关闭：mapViewOpts 不传 fog、渲染层不按 visited 过滤（无 mapnames 映射）',
  !/fog\s*:/.test(grab('mapViewOpts')) && !/S\.settings\.mapnames/.test(UISRC)
  && !/if \(!r\.visited && !r\.current\) return;/.test(UISRC));
ok('迷雾关闭：设置面板不再有迷雾开关（set-mapnames 绑定与行模板已摘；注释里的历史提法不算）',
  !/id="set-mapnames"/.test(UISRC) && !/'set-mapnames'/.test(UISRC) && !/s\.mapnames/.test(UISRC));
{
  /* 主人要的自证口径：地图 HTML 里 `data-room` 数 == 该区域（本区同层）房间总数，
     而不是「已探索数」。开局没走过几步，这条才真正有区分力。 */
  const probe = e.view({ map: true }).map;
  const here = probe.rooms.find((r) => r.current) || {};
  const want = probe.rooms
    .filter((r) => r.region === here.region && (r.z || 0) === (here.z || 0)).length;
  const nOff = nodesOf(fogOff);
  ok('迷雾关闭：data-room 数 == 本区同层房间总数（不是已探索数），且每格都有名字',
    nOff.length === want && want > 0 && nOff.every((n) => n.nameText.length > 0),
    '画出 ' + nOff.length + ' / 本区同层 ' + want + ' · 无名格 '
    + nOff.filter((n) => n.nameText.length === 0).length);
}
ok('玩家块无红底：.mn-seal 规则已从 CSS 摘除（金字 .mn-name 规则仍在）',
  !/\.map-node \.mn-seal\s*\{/.test(CSSSRC)
  && /\.map-node\.here \.mn-name \{[^}]*color:\s*var\(--map-here-name\)/.test(CSSSRC));

/* ================================================================ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('  失败清单：\n    · ' + fails.join('\n    · '));
console.log('── ' + pass + ' 通过 / ' + fail + ' 失败 ──\n');
if (fail) process.exitCode = 1;
