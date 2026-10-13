#!/usr/bin/env node
/* ============================================================
 * land-rewardhint.js —— 把 portrait.hooks[].rewardHint 的设计批注改成人话
 *
 * 为什么必须改：`game/src/core/commands.js:3722`
 *     if (hk.rewardHint) lines.push({ kind:'hint', text: `（${hk.rewardHint}）` });
 * ⇒ 这 94 条**原样打到玩家屏幕上**。真引擎实测截获过：
 *     （+rep 华山派 25；开启 sq_master_yue 第二阶段）
 *   「+rep * 15；trust +25」「解锁 secret；可选买断说书人（+money）」这类
 *   作者速记外泄，是「半成品感」最刺眼的来源之一。
 *
 * 文风规则（team-lead 按 design/74 样张拍的）：
 *   · 不许出现任何 + 、* 、数字、拉丁字母、字段名（rep/trust/sq_xxx 全不许）
 *   · 一句话，10–25 字
 *   · 用具体的人或物说话，不写成系统提示
 *   · 94 条互不重复 → 改完跑 reuse-ledger 验证
 *
 * 闸 B：① 改前 data-dup-check --field npcs.portrait（注意：只有 *_master 那 20+ 条有争议，
 *         本批目标若撞上争议 id 就跳过并报出来，不硬写）
 *       ② 改后真引擎 boot 打印实际值 + 打一条 `ask <人> about <钩子标题>` 看屏幕上没有拉丁
 *
 * 用法：
 *   node tools/land-rewardhint.js --dump > a.txt   导出 94 条原文（排期用）
 *   node tools/land-rewardhint.js --dry            演算不落盘
 *   node tools/land-rewardhint.js                  落盘 + 真引擎断言
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');

const BAD = /[+*]|[A-Za-z]{2,}|[0-9]/;   // 改完之后不许再出现的字符

/** 改写表：[文件, npcId, hook下标, 原句, 新句] —— 新句逐条手写，保证互不重复 */
const FIX = require('./rewardhint-fixes.js');

function dataFiles() {
  return fs.readdirSync(DATA).filter(f => /^\d+_.*\.json$/.test(f)).sort();
}

/* ---------- 导出原文 ---------- */
function dump() {
  const rows = [];
  for (const f of dataFiles()) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    const npcs = j.npcs || {};
    for (const id of Object.keys(npcs)) {
      const hks = (npcs[id].portrait && npcs[id].portrait.hooks) || [];
      hks.forEach((h, i) => {
        if (typeof h.rewardHint !== 'string' || !h.rewardHint) return;
        rows.push([f, id, i, h.title || '', h.rewardHint]);
      });
    }
  }
  console.log('文件\tnpcId\t钩子下标\t钩子标题\t原 rewardHint');
  rows.forEach(r => console.log(r.join('\t')));
  console.error('\n合计 ' + rows.length + ' 条');
}

/* ---------- 落库 ---------- */
const cache = {};
function load(f) {
  if (!cache[f]) cache[f] = { json: JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')), dirty: false };
  return cache[f];
}

/* ---- 闸 B①：目标 id 的 npcs.*.portrait 有没有被 ≥2 个文件争？
   有争议就跳过并报出来（硬写会被后加载的文件盖掉，等于白改） ---- */
const portraitSrc = {};   // id -> Set(file)
for (const f of dataFiles()) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
  const npcs = j.npcs || {};
  for (const id of Object.keys(npcs)) {
    if (npcs[id] && npcs[id].portrait) (portraitSrc[id] = portraitSrc[id] || new Set()).add(f);
  }
}
const disputed = {};
for (const [, id] of FIX) {
  const s = portraitSrc[id];
  if (s && s.size > 1) disputed[id] = [...s].join(' , ');
}
if (Object.keys(disputed).length) {
  console.log('⚠ 闸 B①：以下 id 的 portrait 跨文件争议，本批**不写**（先解争议）：');
  Object.entries(disputed).forEach(([k, v]) => console.log('   ' + k + '  ← ' + v));
}

let okN = 0; const errs = [];
for (const [f, id, i, oldV, newV] of FIX) {
  if (disputed[id]) { errs.push('跳过（portrait 有争议，先解）：' + id); continue; }
  const { json } = load(f);
  const n = json.npcs && json.npcs[id];
  if (!n) { errs.push('找不到 NPC：' + f + ' · ' + id); continue; }
  const h = (n.portrait && n.portrait.hooks && n.portrait.hooks[i]);
  if (!h) { errs.push('找不到钩子：' + id + ' [' + i + ']'); continue; }
  if (h.rewardHint !== oldV) { errs.push('原句对不上（跳过）：' + id + '[' + i + '] 现值=' + JSON.stringify(h.rewardHint)); continue; }
  if (BAD.test(newV)) { errs.push('新句仍含 +/* 数字/拉丁，不许写：' + id + '[' + i + '] ' + newV); continue; }
  h.rewardHint = newV;
  load(f).dirty = true;
  okN++;
}

console.log('rewardHint 改写：' + okN + ' / ' + FIX.length + ' 条');
if (errs.length) { console.log('\n⚠ 未通过 ' + errs.length + ' 条：'); errs.forEach(e => console.log('   ' + e)); }

const DRY = process.argv.indexOf('--dry') >= 0;
if (process.argv.indexOf('--dump') >= 0) { dump(); process.exit(0); }
if (DRY) { console.log('\n--dry：不落盘。'); process.exit(errs.length ? 1 : 0); }

for (const f of Object.keys(cache)) {
  if (!cache[f].dirty) continue;
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(cache[f].json, null, 1) + '\n', 'utf8');
  console.log('已写入 ' + f);
}

/* ---------- 闸 B②：真引擎断言 ---------- */
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const e = new GameEngine({ seed: 20261022, mods: false });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const N = e.world.data.npcs;

let pass = 0, fail = 0;
for (const [f, id, i, oldV, newV] of FIX) {
  const h = (N[id] && N[id].portrait && N[id].portrait.hooks && N[id].portrait.hooks[i]);
  if (h && h.rewardHint === newV) pass++;
  else { fail++; console.log('  ✘ ' + id + '[' + i + '] 实际=' + JSON.stringify(h && h.rewardHint)); }
}
console.log('\n闸 B② 真引擎断言（字段值）：' + pass + ' / ' + (pass + fail) + ' 条变成了目标句');

/* 全库复查：还有没有带 +/* 数字/拉丁 的 rewardHint */
let left = 0;
for (const id of Object.keys(N)) {
  const hks = (N[id].portrait && N[id].portrait.hooks) || [];
  hks.forEach(h => {
    if (typeof h.rewardHint === 'string' && BAD.test(h.rewardHint)) {
      left++; if (left <= 8) console.log('  ✘ 仍带批注味：' + id + ' → ' + h.rewardHint);
    }
  });
}
console.log('闸 B② 全库复查：仍带「+/* 数字/拉丁」的 rewardHint ' + left + ' 条');

/* 打一条 ask 看屏幕上还有没有拉丁 */
const w = e.world, p = w.player;
const yue = w.spawnNpc('master_yue', p.room, 1, true);
yue.pstate = yue.pstate || { trust: 0, revealed: [], hooks: {} };
yue.pstate.trust = 90;
const hk = (yue.portrait.hooks || [])[0];
const r = e.exec('ask 岳不群 about ' + hk.title);
const shown = (r.lines || []).map(l => l.text || '');
console.log('\n实机回看 ask 岳不群 about 「' + hk.title + '」：');
shown.forEach(t => console.log('   ' + (BAD.test(t) ? '[含拉丁] ' : '         ') + t));
process.exit((fail + left + errs.length) ? 1 : 0);
