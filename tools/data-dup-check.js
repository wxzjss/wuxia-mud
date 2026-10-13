#!/usr/bin/env node
/* ==========================================================================
 *  tools/data-dup-check.js —— 字段级重复定义报告（闸 A）
 *  --------------------------------------------------------------------------
 *  为什么要这个：
 *    这个项目的 base data 是**多文件拼装**的（`world.js` 的 `loadBaseData`，
 *    按文件名排序逐个 `mergeData`），而 `mergeData` 的合并是**字段级**的：
 *      标量/字符串 → 后写的覆盖先写的（world.js:317 与 mergeEntry）
 *      数组       → 按 arrayMode 处理，默认 'replace' 整段替换（world.js:269）
 *
 *    所以「这个 id 在几个文件里出现过」**不等于**「我要改的那个字段会被抢」。
 *    早先按 id 粒度统计得到「833 个 NPC 里 473 个重复」，
 *    据此推出「改一句台词会被静默替换」——**那个推论粒度过粗，是错的**。
 *    真正有风险的是 (集合, id, 字段) 这个三元组。
 *
 *  这个脚本干什么：
 *    按 (集合, id, 字段) 粒度扫一遍 game/data，列出**真正被 ≥2 个文件争**的组合。
 *    改数据之前查一眼：我要改的那一格，在不在争议清单上。
 *      在   → 去争议文件里改，或先解争议，改完用「改后验证」确认
 *      不在 → 直接改，风险可忽略
 *
 *  ⚠️ 它是**报告，不是门禁**：永远 exit 0，不阻止任何人改数据。
 *    它的价值是让人知道「自己站没站在雷上」，不是把人拦下来。
 *
 *  用法：
 *    node tools/data-dup-check.js                    # 总览 + 争议率 Top
 *    node tools/data-dup-check.js --field npcs.talk  # 只看某一类字段
 *    node tools/data-dup-check.js --id duan_yu       # 查某一个 id
 *    node tools/data-dup-check.js --list 50          # 列出前 50 条争议组合
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIRS = [path.join(ROOT, 'game', 'data')].filter((d) => fs.existsSync(d));

/* 与 world.js:266 的 collections 保持一致；不在名单里但值是对象的键也按 by-id 处理，
   这里列出来只是为了报告里归类好看，不影响判定。 */
const COLLECTIONS = ['attrs', 'traits', 'items', 'skills', 'books', 'recipes', 'sects', 'npcs',
  'rooms', 'regions', 'quests', 'dialogues', 'shops', 'events', 'stories', 'endings',
  'achievements', 'monsters', 'herbs', 'songs', 'ranks'];

function argOf(name) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
}

const FIELD_FILTER = argOf('field'); // 形如 npcs.talk
const ID_FILTER = argOf('id');
const LIST_N = parseInt(argOf('list'), 10) || 20;

/** (集合|id|字段) → [文件名] */
const owners = new Map();
const idCount = new Map(); // 集合 → Set(id)
let fileCount = 0;

function note(set, id, field, file) {
  const key = set + '|' + id + '|' + field;
  let arr = owners.get(key);
  if (!arr) { arr = []; owners.set(key, arr); }
  if (arr[arr.length - 1] !== file) arr.push(file); // 同一文件内重复出现只记一次
  if (!idCount.has(set)) idCount.set(set, new Set());
  idCount.get(set).add(id);
}

function walkEntry(set, id, entry, file) {
  if (entry === null || entry === undefined) return;
  // 数组值 / 原语值：整条 entry 被合并，没有"字段"可分，记成一个整体
  if (Array.isArray(entry) || typeof entry !== 'object') {
    note(set, id, '(整条)', file);
    return;
  }
  for (const f of Object.keys(entry)) {
    if (f === 'id') continue; // 每个文件都写 id 是常规写法，不是冲突
    note(set, id, f, file);
  }
}

for (const dir of DATA_DIRS) {
  const files = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('.') && /^\d+_/.test(f))
    .sort(); // 与 loadBaseData 的加载顺序一致：后加载的胜出
  for (const f of files) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error('⚠ 解析失败，已跳过：' + f + ' → ' + e.message);
      continue;
    }
    fileCount++;
    for (const k of Object.keys(json)) {
      if (k === '_mod' || k === 'meta' || k === 'terrain') continue; // terrain 整块替换，另有语义
      const v = json[k];
      if (Array.isArray(v)) {
        if (!COLLECTIONS.includes(k)) continue;
        for (const item of v) {
          if (!item || !item.id) continue;
          walkEntry(k, item.id, item, f);
        }
      } else if (v && typeof v === 'object') {
        for (const id of Object.keys(v)) {
          const entry = v[id];
          if (entry && entry._delete) continue;
          walkEntry(k, id, entry, f);
        }
      }
    }
  }
}

// ---- 汇总 ----
const contested = [];
for (const [key, files] of owners) {
  if (files.length >= 2) {
    const [set, id, field] = key.split('|');
    contested.push({ set, id, field, files });
  }
}

const totalCombos = owners.size;
const rate = totalCombos ? ((contested.length / totalCombos) * 100).toFixed(2) : '0.00';

console.log('数据目录：' + DATA_DIRS.map((d) => path.relative(ROOT, d)).join(', '));
console.log('扫描文件：' + fileCount + ' 个');
console.log('(集合,id,字段) 组合总数：' + totalCombos);
console.log('被 ≥2 个文件争的组合：' + contested.length + '（争议率 ' + rate + '%）');
console.log('');

function show(list, title) {
  if (!list.length) { console.log(title + '：无。'); return; }
  console.log(title + '：' + list.length + ' 条');
  for (const c of list) {
    console.log('  ' + c.set + '.' + c.id + '.' + c.field + '   ← ' + c.files.join(' , '));
  }
  console.log('');
}

if (ID_FILTER) {
  show(contested.filter((c) => c.id === ID_FILTER), 'id=' + ID_FILTER + ' 的争议项');
} else if (FIELD_FILTER) {
  const [s, fd] = FIELD_FILTER.split('.');
  let list = contested;
  if (s) list = list.filter((c) => c.set === s);
  if (fd) list = list.filter((c) => c.field === fd);
  show(list.slice(0, LIST_N), '字段筛选 ' + FIELD_FILTER + ' 的争议项（最多 ' + LIST_N + ' 条）');
} else {
  // 按集合汇总争议率
  console.log('各集合争议概览：');
  const bySet = new Map();
  for (const c of contested) {
    if (!bySet.has(c.set)) bySet.set(c.set, { n: 0, ids: new Set() });
    const b = bySet.get(c.set);
    b.n++;
    b.ids.add(c.id);
  }
  for (const set of [...idCount.keys()].sort()) {
    const ids = idCount.get(set).size;
    const b = bySet.get(set) || { n: 0, ids: new Set() };
    console.log('  ' + set.padEnd(12) + ' id ' + String(ids).padStart(5) +
      ' · 争议组合 ' + String(b.n).padStart(5) +
      ' · 涉及 id ' + String(b.ids.size).padStart(4));
  }
  console.log('');

  // 争议最多的字段排名——这几类就是"改之前必须查"的地方
  const byField = new Map();
  for (const c of contested) {
    const k = c.set + '.' + c.field;
    byField.set(k, (byField.get(k) || 0) + 1);
  }
  console.log('争议最多的字段 Top 12（这些字段改之前必须查）：');
  [...byField.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([k, n]) => console.log('  ' + String(n).padStart(5) + '  ' + k));
  console.log('');

  // P0-2 那三类实际要动的字段，单独给结论
  console.log('P0-2 直接相关的字段：');
  for (const f of ['rooms.desc', 'npcs.talk', 'npcs.ask', 'rooms.exits', 'rooms.onEnter']) {
    const [s, fd] = f.split('.');
    const n = contested.filter((c) => c.set === s && c.field === fd).length;
    console.log('  ' + f.padEnd(14) + ' 争议 ' + n + ' 条' + (n === 0 ? '  ← 可直接改' : '  ← 需先解争议'));
  }
  console.log('');
  console.log('提示：查具体 id 用 --id <id>；查具体字段用 --field npcs.talk');
}

process.exit(0);
