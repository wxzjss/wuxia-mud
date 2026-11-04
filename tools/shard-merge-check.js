#!/usr/bin/env node
/**
 * shard-merge-check.js —— 「分片里有、合并后归零」守卫（进套件）
 *
 * 病根（2026-10-21，QA 实测）：`75_content_extra.json` 的 `encounters` 是**数组**，
 * 而合并白名单（world.js `collections` / dataload.js `COLLECTIONS`）里没有这个键，
 * 合并条件「在白名单 或 是非数组对象」两条都不成立 ⇒ **整块跳过**；
 * 但代码先前已 `if (!this.data[k]) this.data[k] = {}` 建了空对象，
 * 于是表现为「键在、0 条」——极难从外部看出来，玩家侧症状是「寻访」永远说不出奇遇。
 *
 * 本守卫的判据极简：**任何分片顶层集合，raw > 0 而 merged === 0，就是红的。**
 * 它不只防 encounters，也防「新加一个集合忘了登记白名单」这一类。
 *
 * 自测：⓪ 段三条已知答案（raw>0/merged=0 → 红；raw>0/merged>0 → 绿；raw=0 → 跳过）。
 * 用法：node tools/shard-merge-check.js [--verbose]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const count = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

/* 有意不进合并态的键（每个都要写原因，否则就是"放水"） */
const EXEMPT = {
  meta: '文件元信息，不进世界数据',
  _mod: 'mod 声明块，加载器单独消费',
  _note: '作者注释',
};

/** 纯判定：返回 'fail' | 'ok' | 'skip' */
function verdict(rawCount, mergedCount) {
  if (!(rawCount > 0)) return 'skip';
  return mergedCount > 0 ? 'ok' : 'fail';
}

function selftest() {
  let pass = 0, fail = 0;
  const t = (n, c) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n); } };
  t('raw 12 / merged 0 → fail（正是 encounters 那条）', verdict(12, 0) === 'fail');
  t('raw 12 / merged 12 → ok', verdict(12, 12) === 'ok');
  t('raw 0 → skip（没这条数据不算红）', verdict(0, 0) === 'skip');
  console.log('  自测 ' + pass + '/' + (pass + fail));
  return fail === 0;
}

(async () => {
  console.log('⓪ 判定器自测');
  if (!selftest()) { console.error('自测未过，拒绝下结论'); process.exit(1); }

  const e = new GameEngine({ seed: 20261021 });
  await e.boot({});
  const merged = e.world.data;

  /* 汇总各分片的顶层集合条数（与引擎同一份磁盘数据） */
  const dataDir = path.join(ROOT, 'game', 'data');
  const raw = new Map();   // key -> {count, files:Set}
  for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (err) { continue; }
    for (const k of Object.keys(j || {})) {
      const n = count(j[k]);
      if (!raw.has(k)) raw.set(k, { count: 0, files: new Set() });
      const rec = raw.get(k);
      rec.count += n;
      if (n > 0) rec.files.add(f);
    }
  }

  const failList = [], skipList = [], okList = [];
  for (const [k, rec] of raw) {
    if (EXEMPT[k]) { skipList.push(k + '（' + EXEMPT[k] + '）'); continue; }
    const m = count(merged[k]);
    const v = verdict(rec.count, m);
    if (v === 'fail') failList.push({ key: k, raw: rec.count, merged: m, files: [...rec.files].slice(0, 3).join(',') });
    else if (v === 'ok') okList.push(k + '(raw' + rec.count + '/merged' + m + ')');
    else skipList.push(k + '(raw0)');
  }

  console.log('\n§1 分片顶层集合 ' + raw.size + ' 个：有数据 ' + okList.length + ' · 归零 ' + failList.length + ' · 跳过 ' + skipList.length);
  if (process.argv.indexOf('--verbose') >= 0) console.log('  有数据：' + okList.join(' '));
  for (const f of failList) console.log('  ✘ ' + f.key + '：分片有 ' + f.raw + ' 条，合并后 0 条（来源 ' + f.files + '）');

  if (!failList.length) console.log('  ✔ 没有「分片有、合并归零」的集合');
  console.log('\n' + (failList.length ? '✘ ' + failList.length + ' 个集合在合并后归零（多半是没登记进 world.js collections / dataload.js COLLECTIONS）' : '✔ 全部集合均已合并'));
  process.exit(failList.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
