#!/usr/bin/env node
/* ============================================================
 * land-guard-talk.js —— P0-2a：把 design/74-act1-script.md 的
 * 「43 名守卫台词重写清单」落进 npcs.talk
 *
 * 纪律（闸 B）：
 *   ① 改之前跑 tools/data-dup-check.js --field npcs.talk 确认目标字段无争议
 *   ② 改之后 **boot 真引擎** 打印实际值断言（replace 语义下"文件写了"不等于生效）
 *   ③ 台词**从设计案表格里程序化抽取**，不手抄 —— 手抄会抄错，也会让人分不清
 *     哪句是设计的、哪句是我编的
 *
 * ⚠️ 本脚本只写 game/data/42_sect_guards.json（sectguard_* 的唯一归属文件，
 *    经 data-dup-check 确认无争议）。
 *
 * 用法：
 *   node tools/land-guard-talk.js --dry    只看会改什么，不写盘
 *   node tools/land-guard-talk.js          落库 + boot 真引擎断言
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const DESIGN = path.join(ROOT, 'design', '74-act1-script.md');
const TARGET = path.join(DATA, '42_sect_guards.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

/* ---------- ① 从设计案抽台词（不手抄） ---------- */
function parseDesign() {
  const md = fs.readFileSync(DESIGN, 'utf8');
  const sec = md.split('## 附 · 43 名守卫台词重写清单')[1].split('\n## 附 · 自检')[0];
  const rows = sec.split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l));
  const out = [];
  for (const r of rows) {
    const c = r.split('|').map(s => s.trim());
    const sectCn = c[2], roomCn = c[3];
    const lines = c[4].split('<br>').map(s => s.trim()).filter(Boolean);
    const anchor = c[5] || '';
    out.push({ sectCn, roomCn, lines, anchor, isNew: /需新建/.test(sectCn) });
  }
  return out;
}

/* ---------- ② 匹配：设计行 ↔ 现有 sectguard ---------- */
function match(rows, npcs, rooms) {
  const guards = Object.keys(npcs).filter(k => /^sectguard_/.test(k));
  const byRoomName = {};
  for (const id of guards) {
    const rm = rooms[npcs[id].room];
    if (rm) byRoomName[String(rm.name)] = id;
  }
  const matched = [], unmatchedRows = [], unmatchedGuards = [];
  const usedRow = new Set();
  for (const id of guards) {
    const rm = rooms[npcs[id].room];
    const nm = rm ? String(rm.name) : '';
    let hit = rows.findIndex(r => r.roomCn === nm && !usedRow.has(r));
    if (hit < 0) hit = rows.findIndex(r => !usedRow.has(r) && r.roomCn && nm && (r.roomCn.indexOf(nm) >= 0 || nm.indexOf(r.roomCn) >= 0));
    if (hit < 0) { unmatchedGuards.push([id, nm]); continue; }
    usedRow.add(rows[hit]);
    matched.push({ id, sect: npcs[id].sect, row: rows[hit] });
  }
  for (let i = 0; i < rows.length; i++) if (!usedRow.has(rows[i])) unmatchedRows.push(rows[i]);
  return { matched, unmatchedRows, unmatchedGuards };
}

function main() {
  const dry = process.argv.indexOf('--dry') >= 0;
  const rows = parseDesign();
  console.log('设计案表格：' + rows.length + ' 行，台词 ' + rows.reduce((a, b) => a + b.lines.length, 0) + ' 句');

  const e = new GameEngine({ seed: 20261012, dataDir: DATA });
  e.boot(); e.newGame();
  const w = e.world, npcs = w.data.npcs, rooms = w.data.rooms;

  const { matched, unmatchedRows, unmatchedGuards } = match(rows, npcs, rooms);
  console.log('匹配成功 ' + matched.length + ' 条；未匹配的设计行 ' + unmatchedRows.length
    + '；未匹配的守卫 ' + unmatchedGuards.length);
  for (const r of unmatchedRows) console.log('  ⚠ 设计行未落地：' + r.sectCn + ' / ' + r.roomCn + (r.isNew ? '（标记需新建）' : ''));
  for (const g of unmatchedGuards) console.log('  ⚠ 守卫无台词来源：' + g[0] + ' @' + g[1]);

  /* 零重复自检：设计案声称 129 句零重复，我自己验一遍 */
  const all = [];
  for (const m of matched) for (const l of m.row.lines) all.push(l);
  const dup = all.filter((x, i) => all.indexOf(x) !== i);
  console.log('将写入 ' + all.length + ' 句，去重后 ' + new Set(all).size + ' 句，重复 ' + dup.length + ' 句');
  if (dup.length) { console.log('  ✘ 设计案内部就有重复，先让创意总监改，我不落库'); process.exit(1); }
  for (const m of matched) {
    if (m.row.lines.length !== 3) { console.log('  ✘ ' + m.id + ' 只有 ' + m.row.lines.length + ' 句，应为 3'); process.exit(1); }
  }

  if (dry) {
    for (const m of matched.slice(0, 4)) console.log('\n' + m.id + ' (' + m.sect + ') 将改为：\n  ' + m.row.lines.join('\n  '));
    console.log('\n（--dry，未写盘）');
    return;
  }

  /* ---------- ③ 写盘 ---------- */
  const json = JSON.parse(fs.readFileSync(TARGET, 'utf8'));
  let changed = 0;
  for (const m of matched) {
    const ent = json.npcs[m.id];
    if (!ent) { console.log('  ✘ 目标文件里没有 ' + m.id + '（它不在 42_sect_guards.json？请查 __source）'); process.exit(1); }
    ent.talk = m.row.lines.slice();
    changed++;
  }
  fs.writeFileSync(TARGET, JSON.stringify(json, null, 1) + '\n', 'utf8');
  console.log('\n已写入 ' + TARGET + '：改了 ' + changed + " 条 npc 的 talk");

  /* ---------- ④ boot 真引擎断言（闸 B ②） ---------- */
  console.log('\n===== boot 真引擎 · 逐条打印实际生效值 =====');
  const e2 = new GameEngine({ seed: 20261012, dataDir: DATA });
  e2.boot(); e2.newGame();
  const n2 = e2.world.data.npcs;
  let ok = 0, fail = [];
  for (const m of matched) {
    const got = n2[m.id].talk;
    const want = m.row.lines;
    const same = Array.isArray(got) && got.length === want.length && want.every((s, i) => got[i] === s);
    if (same) ok++; else fail.push([m.id, got]);
  }
  console.log('断言通过 ' + ok + ' / ' + matched.length);
  for (const f of fail) console.log('  ✘ ' + f[0] + ' 实际值：' + JSON.stringify(f[1]).slice(0, 160));

  /* 抽查前 3 条，把话打印出来给人看 */
  console.log('\n抽查：');
  for (const m of matched.slice(0, 3)) {
    console.log('  ' + m.id + ' (' + m.sect + ') @' + n2[m.id].room);
    for (const l of n2[m.id].talk) console.log('      ' + l);
  }
  /* 旧样板句是否还在 */
  let old = 0;
  for (const id of Object.keys(n2)) {
    for (const t of (Array.isArray(n2[id].talk) ? n2[id].talk : [])) {
      if (t.indexOf('本门不是客栈') >= 0 || t.indexOf('哪家的？来做什么') >= 0) old++;
    }
  }
  console.log('\n全库仍含旧样板句「本门不是客栈/哪家的？来做什么」的处数：' + old);
  process.exit(fail.length ? 1 : 0);
}

main();
