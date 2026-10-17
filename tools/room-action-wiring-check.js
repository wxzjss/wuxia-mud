#!/usr/bin/env node
/**
 * room-action-wiring-check.js —— 房动作接线守卫（diff 范围，不扫全库）
 *
 * 背景（lead-programmer 实测，批5 踩过）：`rooms.<id>.actions` 在分片深合并里是
 * `arrayMode='replace'`（双数组整段覆盖，**空数组也是覆盖**）。后载分片整段赢 ⇒
 * 动作挂 50_map 被 65 的 actions 顶掉，引擎里动作不存在、按钮成死键、输入落回内置 look，
 * 全程不报错。游有方的纪律是「挂到排序最后且带 actions 键的分片」，纪律靠人记 ⇒ 加守卫。
 *
 * 三条判据（lead-programmer 定，我落）：
 *   A 引擎真相：boot 后 getRoom(rid).actions 能查到该 cmd/label（mod 覆盖算在内）
 *   B 多分片同房：同一 rid 在 ≥2 个分片**都带 actions 键**时报警（判据是「键存在」，
 *     不是「文件出现该 rid」——road_xixia_1 在 73 出现但无 actions 键，安全）
 *   C 空数组误伤：按载入序，后位分片 actions:[] 而前位同房有非空条目 → 报警
 *     （删动作的杠杆，必须显式意图）
 *
 * QA 补的两点（不改判据，只加可见度）：
 *   ① A 通过时额外标出 `locked/once` 状态：动作查得到 ≠ 玩家点了有反应，
 *      免得「被 cond 锁住」被 A 判绿掩盖（只报告，不判红）。
 *   ② 自测（⓪ 段）：cmp / carriersOf / emptyOverride 三个纯函数各给已知答案样本，
 *      命中与不命中都有；不通过则拒绝用它下结论。
 *
 * 用法：
 *   node tools/room-action-wiring-check.js --manifest <清单.json>
 *   node tools/room-action-wiring-check.js --manifest <清单.json> --data <分片目录>   # 注入用
 *   node tools/room-action-wiring-check.js --selftest
 *   node tools/room-action-wiring-check.js --scan-all        # 存量普查（只打印，永不改退出码）
 *
 * `--scan-all`（lead-programmer 2026-10-17 批准）：B/C 默认只扫 diff 范围；存量里
 *   「同房多分片带 actions 键」的房全库 28 间、其中 14 间有动作被顶掉（见
 *   `tools/_out_room_action_override.tsv`）。这个模式只把清单打出来供人一批批收，
 *   **不判红、不改退出码**——全库判红会被迫加白名单，反而烂掉。
 *
 * 清单元数据：[{ "rid": "road_xixia_1", "cmd": "对账", "note": "批5 件②" }, …]
 * 清单来源：apply 脚本的 HOOKS（游有方出），或批内手工清单。
 *
 * 🔴 纪律（team-lead 2026-10-17 裁定，全员）：**清单刻意保持静态，不改成从 HOOKS 动态推导。**
 *    A 判据的意图是「这批**新挂的** hook 一定在引擎里」，静态清单 = 显式纪律；
 *    动态推导会绕回「数据自己证明自己」。
 *    ⇒ **今后任何新挂 room action 的批，必须把自己那几条加进 manifest**，
 *      否则本守卫对那一批是**零覆盖**——绿了也不代表这批没问题。
 *
 * 门禁说明：文件名字符合 .reg_full.sh 收录正则（`^(smoke-.*|.*-check)\.js$`），
 * 但**进门禁属于发布门禁变更**，按 103/104 先例需 team-lead 记档后再并入（本文件不自作主张）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };

/* ---------- 纯函数（自测直考） ---------- */

/** 与 dataload.compareDataFileName 同口径：数值前缀优先。 */
function cmp(a, b) {
  const ma = /^(\d+)_/.exec(a), mb = /^(\d+)_/.exec(b);
  const na = ma ? parseInt(ma[1], 10) : Number.MAX_SAFE_INTEGER;
  const nb = mb ? parseInt(mb[1], 10) : Number.MAX_SAFE_INTEGER;
  if (na !== nb) return na - nb;
  return a < b ? -1 : 1;
}

/**
 * 从「文件 → 该文件的 rooms」建承载索引。
 * @param {Array<{file:string, rooms:object}>} shards 已按载入序排好
 * @returns {Object} rid → [{file, actions}]
 */
function carriersOf(shards) {
  const index = {};
  for (const { file, rooms } of shards) {
    for (const rid of Object.keys(rooms || {})) {
      const r = rooms[rid];
      if (!r || typeof r !== 'object' || !('actions' in r)) continue; /* 判据：键存在才算承载 */
      (index[rid] = index[rid] || []).push({ file, actions: r.actions });
    }
  }
  return index;
}

/** C：按载入序找「后位空数组覆盖前位非空」 */
function emptyOverride(carriers) {
  let hit = null;
  for (let i = 1; i < carriers.length; i++) {
    const cur = carriers[i], prev = carriers[i - 1];
    if (Array.isArray(cur.actions) && cur.actions.length === 0
      && Array.isArray(prev.actions) && prev.actions.length > 0) hit = prev.file + ' → ' + cur.file;
  }
  return hit;
}

/* ---------- 自测 ---------- */
function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c, got) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + '  « 实际: ' + JSON.stringify(got)); } };

  /* cmp：数值前缀优先（50 < 65 < 88 < 103），无前缀排最后 */
  ok('cmp 数值序 50<65', cmp('50_map.json', '65_mainline_act3.json') < 0);
  ok('cmp 数值序 88<103（不是字典序 103<88）', cmp('88_mountain_paths.json', '103_act1_rework.json') < 0);
  ok('cmp 无前缀排最后', cmp('zz_local.json', '50_map.json') > 0);

  /* carriersOf：带 actions 键才算承载；不带键的房不出现在索引里 */
  const fx = carriersOf([
    { file: '50_map.json', rooms: { roomA: { actions: [{ cmd: 'x' }] }, roomB: { desc: 'no actions key' } } },
    { file: '73_sects_place.json', rooms: { roomB: { desc: 'still no key' }, roomA: { actions: [] } } },
  ]);
  ok('carriersOf 带 actions 键的两个分片都收（命中）', (fx.roomA || []).length === 2, fx.roomA && fx.roomA.length);
  ok('carriersOf 不带 actions 键的房不进索引（不命中）', fx.roomB === undefined);

  /* emptyOverride：后位空数组要报；后位无键不报（后者 carriersOf 已滤掉，这里直接验两条） */
  ok('emptyOverride 后位 actions:[] 覆盖前位非空 → 报（命中）',
    emptyOverride([{ file: 'a.json', actions: [{ cmd: 'x' }] }, { file: 'b.json', actions: [] }]) !== null);
  ok('emptyOverride 后位非空 → 不报（不命中）',
    emptyOverride([{ file: 'a.json', actions: [{ cmd: 'x' }] }, { file: 'b.json', actions: [{ cmd: 'y' }] }]) === null);
  ok('emptyOverride 前位本来就是空 → 不报（不命中）',
    emptyOverride([{ file: 'a.json', actions: [] }, { file: 'b.json', actions: [] }]) === null);

  console.log('\n自测 ' + pass + '/' + (pass + fail) + ' 通过' + (fail ? '  ✘ 判定器不可信，先修' : ''));
  return fail === 0;
}

/* ---------- 主流程 ---------- */
if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

/* ⚠️ 回归收录规则：tools/run-regression.js 收 `*-check.js` —— 本文件一旦存在就会被当一套跑。
   所以**必须能无参跑通**：无 --manifest 时用随包默认清单（批5+#103 实测 8 条）。
   若哪天清单要按批动态生成，改这里指向生成物，别让无参跑变红。 */
const manifestPath = arg('manifest') || 'tools/_room_action_manifest.json';
if (!manifestPath || !fs.existsSync(path.resolve(ROOT, manifestPath))) {
  console.error('用法: node tools/room-action-wiring-check.js --manifest <清单.json> [--data <分片目录>]');
  process.exit(2);
}
const items = JSON.parse(fs.readFileSync(path.resolve(ROOT, manifestPath), 'utf8'));
const dataDir = arg('data') ? path.resolve(ROOT, arg('data')) : DATA;

console.log('⓪ 判定器自测');
if (!selftest()) { console.error('自测未过，终止。'); process.exit(1); }

/* B/C 索引：按载入序读分片（--data 只影响这一层，A 始终问真引擎） */
const shardFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json') && /^\d+_/.test(f)).sort(cmp);
const shards = [];
for (const f of shardFiles) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  if (d && d.rooms && typeof d.rooms === 'object') shards.push({ file: f, rooms: d.rooms });
}
const index = carriersOf(shards);
console.log('\n§1 分片索引：' + shards.length + ' 个分片 · 带 actions 键的房 ' + Object.keys(index).length + ' 个'
  + (dataDir === DATA ? '' : '（注入目录：' + path.relative(ROOT, dataDir) + '）'));
if (dataDir !== DATA && !shards.length) { console.error('✘ 注入目录里没有可用分片，守卫拒绝空跑'); process.exit(2); }

(async () => {
  const e = new GameEngine({ seed: 7 });
  e.boot();
  const w = e.world;
  let pass = 0, fail = 0;
  const fails = [];
  const ok = (n, c, extra) => {
    if (c) { pass++; console.log('  ✔ ' + n + (extra ? '  ' + extra : '')); }
    else { fail++; fails.push(n); console.log('  ✘ ' + n + (extra ? '  « ' + extra : '')); }
  };
  const notes = [];

  for (const it of items) {
    const tag = it.rid + ' · ' + it.cmd + (it.note ? '（' + it.note + '）' : '');

    /* A 引擎真相 */
    const room = w.getRoom(it.rid);
    const acts = (room && room.actions) || [];
    const hit = acts.find((a) => a && (a.cmd === it.cmd || a.label === it.cmd));
    ok('A 引擎真相: ' + tag, !!room && !!hit,
      room ? '实现: ' + JSON.stringify(acts.map((a) => a.cmd || a.label)) : '房不存在');
    /* ① QA 补：命中但被 cond 锁 / once 已消费，单独记一笔（不判红） */
    if (hit && (hit.cond || hit.once)) notes.push(tag + ' → 命中动作带 ' + (hit.cond ? 'cond' : '') + (hit.cond && hit.once ? '+' : '') + (hit.once ? 'once' : '') + '，玩家点了未必有反应');

    /* B 多分片承载 */
    const carriers = index[it.rid] || [];
    ok('B 单分片承载: ' + tag, carriers.length < 2, carriers.map((c) => c.file).join(' / '));

    /* C 空数组误伤 */
    ok('C 无空数组误伤: ' + tag, !emptyOverride(carriers), emptyOverride(carriers) || '');
  }

  console.log('\n§2 结果：通过 ' + pass + ' / 失败 ' + fail);
  if (notes.length) {
    console.log('§3 提示（不判红，供 lead-programmer 看）');
    notes.forEach((n) => console.log('  · ' + n));
  }

  /* §4 存量普查（--scan-all）：只打印，**永不改退出码** */
  if (process.argv.includes('--scan-all')) {
    const multi = Object.entries(index).filter(([, cs]) => cs.length > 1);
    const lostRows = [];
    for (const [rid, cs] of multi) {
      const lastKeys = new Set((cs[cs.length - 1].actions || []).map((a) => a && (a.cmd || a.label)).filter(Boolean));
      const lost = [];
      for (const c of cs.slice(0, -1)) for (const a of c.actions || []) {
        const k = a && (a.cmd || a.label);
        if (k && !lastKeys.has(k)) lost.push(k + '@' + c.file);
      }
      if (lost.length) lostRows.push(rid + ' [' + cs.map((c) => c.file).join('→') + '] 丢 ' + lost.length + '：' + lost.join(' ; '));
    }
    console.log('\n§4 存量普查（不判红）');
    console.log('  同房多分片带 actions 键：' + multi.length + ' 间 · 有动作被顶掉：' + lostRows.length + ' 间');
    lostRows.slice(0, 30).forEach((l) => console.log('    ' + l));
    if (lostRows.length > 30) console.log('    …（共 ' + lostRows.length + ' 间，完整表见 tools/_out_room_action_override.tsv）');
  }

  if (fail) { console.log('✘ 失败项: ' + fails.join(' / ')); process.exit(1); }
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
