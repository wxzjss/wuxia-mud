#!/usr/bin/env node
/**
 * zhuque-sample.js —— 朱雀补扫·分层抽样出料脚本（严过关，2026-10-14）
 *
 * 用途：把玩家可见文本按六类分层随机抽样，导出纯文本，供朱雀跑分。
 *       游有方跑分、我出料；seed 写死可复现——同一 seed 永远抽出同一批。
 *
 * 六类与数据源（磁盘现状实测，2026-10-14）：
 *   1 npc-desc      40_npcs.json + 101_classic_npcs.json 的 npcs[].desc
 *   2 npc-talk      同上 npcs[].talk[]（逐条为一段）
 *   3 action-narrate  全部带 rooms 的数据文件里 actions[] 的 effects[type=say|narrate].raw
 *                   + failMsg + spentMsg（玩家点名词后真正会看到的那几句）
 *   4 room-desc     全部带 rooms 的数据文件合并（13 个文件，unique by id）的 desc
 *   5 story-text    60_quests / 61_sidequests / 65_mainline_act3 / 66_mainline_act45
 *                   / 102_classic_quests：任务 desc + stages[].desc + targets[].desc
 *   6 skill-desc    10_skills.json 的 skills{}.desc + 83_arts.json（若有 desc）
 *
 * 洗稿口径（与游有方对齐，写死在 wash() 里，改口径必须改这里并通知对方）：
 *   a. 去掉 markdown 符号（* _ # > `）与首尾空白；
 *   b. 模板占位符：{player}/{playerName} → 「你」，{npc}/{name} → 「那人」，
 *      其余 {x} → x（去花括号）——花括号是 JSON 痕迹，会污染检测；
 *   c. 段长 ≥ 10 字才收（防 flag/cmd 碎片混进语料）；
 *   d. 【不】改写任何句子本身——洗的是 JSON 痕迹，不是文风。
 *
 * 跑分口径（沿 75/77 的既定口径，别破）：
 *   单段/单条跑，不跑全库（全库合跑必然高分，是统计假象，见 75 §B）。
 *
 * 用法：
 *   node tools/zhuque-sample.js                 # 默认 seed=20261014，每类 20 条
 *   node tools/zhuque-sample.js --n 30 --seed 20261014
 *
 * 输出：.livetest/zhuque/seed-<seed>/<类别>.txt（空行分段）
 *       .livetest/zhuque/seed-<seed>/manifest.json（段序号 → 数据 id，可回溯）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const SEED = (() => {
  const i = process.argv.indexOf('--seed');
  return i > -1 ? Number(process.argv[i + 1]) : 20261014;
})();
const N = (() => {
  const i = process.argv.indexOf('--n');
  return i > -1 ? Number(process.argv[i + 1]) : 20;
})();

/* ---------- 可复现随机（mulberry32，不依赖 Math.random） ---------- */
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
function pick(arr, n) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/* ---------- 洗稿（口径写死，见头注释） ---------- */
function wash(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/\{player(Name)?\}/g, '你')
    .replace(/\{(npc|name)\}/g, '那人')
    .replace(/\{([^{}]+)\}/g, '$1')
    .replace(/[*_#>`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const arr = (x) => (Array.isArray(x) ? x : x ? Object.values(x) : []);
const load = (f) => {
  try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); }
  catch (e) { console.error('  ⚠ 读不到 ' + f + '：' + e.message); return {}; }
};

/* 带 rooms 的数据文件动态扫（新文件落库自动进池，不用改脚本） */
function allRoomsFiles() {
  return fs.readdirSync(DATA).filter((f) => f.endsWith('.json'))
    .map((f) => ({ f, j: load(f) }))
    .filter(({ j }) => j && j.rooms);
}
function mergedRooms() {
  const byId = new Map();
  for (const { f, j } of allRoomsFiles())
    for (const r of arr(j.rooms)) if (!byId.has(r.id)) byId.set(r.id, { ...r, _file: f });
  return [...byId.values()];
}

/* ---------- 六类抽取器：返回 [{ id, text }] ---------- */
const EXTRACTORS = {
  'npc-desc': () => {
    const out = [];
    for (const f of ['40_npcs.json', '101_classic_npcs.json'])
      for (const n of arr(load(f).npcs))
        if (n.desc) out.push({ id: n.id + '@' + f, text: n.desc });
    return out;
  },
  'npc-talk': () => {
    const out = [];
    for (const f of ['40_npcs.json', '101_classic_npcs.json'])
      for (const n of arr(load(f).npcs))
        for (const t of arr(n.talk)) out.push({ id: n.id + '@' + f, text: t });
    return out;
  },
  'action-narrate': () => {
    const out = [];
    for (const { f, j } of allRoomsFiles())
      for (const r of arr(j.rooms))
        for (const a of arr(r.actions)) {
          for (const e of arr(a.effects))
            if ((e.type === 'say' || e.type === 'narrate') && e.raw)
              out.push({ id: r.id + '/' + (a.label || a.cmd) + '@' + f, text: e.raw });
          if (a.failMsg) out.push({ id: r.id + '/' + (a.label || a.cmd) + ':fail@' + f, text: a.failMsg });
          if (a.spentMsg) out.push({ id: r.id + '/' + (a.label || a.cmd) + ':spent@' + f, text: a.spentMsg });
        }
    return out;
  },
  'room-desc': () => mergedRooms().filter((r) => r.desc).map((r) => ({ id: r.id + '@' + r._file, text: r.desc })),
  'story-text': () => {
    const out = [];
    const walk = (o, id, f) => {
      if (!o || typeof o !== 'object') return;
      if (typeof o === 'string') return;
      for (const [k, v] of Object.entries(o)) {
        if (typeof v === 'string' && ['desc', 'intro', 'outro', 'text', 'say', 'narrate', 'story'].includes(k)) {
          if (v.length >= 10) out.push({ id: id + '#' + k + '@' + f, text: v });
        } else if (v && typeof v === 'object') walk(v, id, f);
      }
    };
    for (const f of ['60_quests.json', '61_sidequests.json', '65_mainline_act3.json', '66_mainline_act45.json', '102_classic_quests.json']) {
      const j = load(f);
      for (const q of arr(j.quests || j.quests2 || j.sidequests || j.mainline)) walk(q, q.id || '?', f);
    }
    return out;
  },
  'skill-desc': () => {
    const out = [];
    const sk = load('10_skills.json').skills;
    for (const s of arr(sk)) if (s.desc) out.push({ id: s.id + '@10_skills', text: s.desc });
    const arts = load('83_arts.json');
    for (const a of arr(arts.arts || arts.skills)) if (a && a.desc) out.push({ id: a.id + '@83_arts', text: a.desc });
    return out;
  },
};

/* ---------- 主流程 ---------- */
/* 2026-10-18：样本产物落在 tools/_out_zhuque/（.livetest 会被发布打包扫到，EPERM 源头） */
const outDir = path.join(ROOT, 'tools', '_out_zhuque', 'seed-' + SEED);
fs.mkdirSync(outDir, { recursive: true });
const manifest = { seed: SEED, n: N, generatedAt: new Date().toISOString(), wash: '见 tools/zhuque-sample.js 头注释', categories: {} };

console.log('朱雀抽样 · seed=' + SEED + ' · 每类 ' + N + ' 条');
for (const [cat, ex] of Object.entries(EXTRACTORS)) {
  const pool = ex().map((x) => ({ ...x, text: wash(x.text) })).filter((x) => x.text.length >= 10);
  const got = pick(pool, Math.min(N, pool.length));
  const file = path.join(outDir, cat + '.txt');
  fs.writeFileSync(file, got.map((x) => x.text).join('\n\n') + '\n', 'utf8');
  manifest.categories[cat] = { pool: pool.length, sampled: got.length, file: path.relative(ROOT, file), items: got.map((x, i) => ({ seg: i + 1, id: x.id })) };
  console.log('  ' + cat.padEnd(15) + ' 池 ' + String(pool.length).padStart(4) + ' → 抽 ' + got.length + '  ' + path.relative(ROOT, file));
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1), 'utf8');
console.log('manifest → ' + path.relative(ROOT, path.join(outDir, 'manifest.json')));
console.log('口径提醒：单段/单条跑分，不跑全库；同 seed 可复现。');
