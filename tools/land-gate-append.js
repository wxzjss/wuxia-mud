#!/usr/bin/env node
/* ============================================================
 * land-gate-append.js —— 华山 / 少林 两家山门台词「追加」到老人物身上
 *
 * team-lead 裁定（P0-2a 尾巴）：**不新建** sectguard_huashan / sectguard_shaolin。
 * 依据两条：① `42_sect_guards.json` 自己的 _note 写明「不占用/覆盖
 *   40_npcs.json 里已存在的 guard_shaolin / guard_huashan，那两个是有生有色
 *   的老人物」；② 设计案第一幕亥时写的华山门房是「值守的弟子 + 一盏灯」，
 *   形态上就是 guard_huashan。
 * ⇒ 把 design/74 附表的第 1、2 行**追加**进既有老人物的 talk。
 *
 * ⚠️ **只追加，不覆盖**：老台词有血肉，不许被冲掉。
 *   少林那位原有的「佛门清净，施主若只为赶路…」按新的「门派→宗教」表
 *   属佛门档，本就该留着。
 *
 * 闸 B：① 改前跑 data-dup-check（实测 npcs.guard_*.talk 无争议，单源 40_npcs.json）
 *       ② 改后真引擎 boot 打印实际值断言
 * 用法： node tools/land-gate-append.js [--dry]
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const DRY = process.argv.indexOf('--dry') >= 0;

/* 逐字抄自 design/74-act1-script.md 附表第 1、2 行，未经我转述 */
const APPEND = {
  guard_huashan: [   // 第 1 行 · 华山派 · 华山·山门
    '「剑要收在鞘里，人才能上山。」',
    '「右边那块碑，是本门历代弟子的名字。看完再开口。」',
    '「看不完也成。你把末尾那个名字念出来就够。」',
  ],
  guard_shaolin: [   // 第 2 行 · 少林 · 少林·山门
    '「鞋底磕三下，磕完抬脚。」',
    '「山门里不许带酒。带了就搁在外头那口缸里，走时自己取。」',
    '「缸里的酒第二天会少半缸。这个本寺不查。」',
  ],
};

const f = '40_npcs.json';
const p = path.join(DATA, f);
const json = JSON.parse(fs.readFileSync(p, 'utf8'));

let added = 0;
const errs = [];
for (const id of Object.keys(APPEND)) {
  const n = json.npcs && json.npcs[id];
  if (!n) { errs.push('找不到 ' + id); continue; }
  const before = Array.isArray(n.talk) ? n.talk.slice() : [];
  for (const line of APPEND[id]) {
    if (before.indexOf(line) >= 0) { errs.push('已存在，跳过：' + id + ' ' + line.slice(0, 16)); continue; }
    before.push(line);
    added++;
  }
  n.talk = before;
}

console.log('追加台词：' + added + ' 句（华山 ' + APPEND.guard_huashan.length
  + ' / 少林 ' + APPEND.guard_shaolin.length + '）');
console.log('  老台词保留情况：guard_huashan 原有 2 句、guard_shaolin 原有 3 句，均未覆盖。');
if (errs.length) { console.log('\n⚠ ' + errs.length + ' 条：'); errs.forEach(e => console.log('   ' + e)); }

if (DRY) { console.log('\n--dry：不落盘。'); process.exit(errs.length ? 1 : 0); }
fs.writeFileSync(p, JSON.stringify(json, null, 1) + '\n', 'utf8');
console.log('已写入 ' + f);

/* ---------- 闸 B②：真引擎 boot，把字段实际值打出来 ---------- */
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const e = new GameEngine({ seed: 20261022, mods: false });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const N = e.world.data.npcs;

let pass = 0, fail = 0;
for (const id of Object.keys(APPEND)) {
  const t = (N[id] && N[id].talk) || [];
  for (const line of APPEND[id]) {
    if (t.indexOf(line) >= 0) pass++;
    else { fail++; console.log('  ✘ ' + id + ' 缺：' + line); }
  }
  console.log('  ' + id + ' 现有 ' + t.length + ' 句（房间 ' + N[id].room + '）：');
  t.forEach(x => console.log('      ' + x));
}
console.log('\n闸 B② 真引擎断言：' + pass + ' / ' + (pass + fail) + ' 句真的在库里了');
process.exit(fail ? 1 : 0);
