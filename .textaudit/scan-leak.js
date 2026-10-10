/* ============================================================
 *  scan-leak.js —— 玩家可见文本「模板变量泄漏」全库扫描（只读）
 *
 *  覆盖：50_map(房间 desc/name) · 40_npcs(desc/talk/ask.answer/askDefault/listen)
 *        60_quests + 61_sidequests(desc/stages[].desc/targets[].desc/rewards[].raw/effects[].raw)
 *        tutorial.js（中文字符串）
 *  输出：命中清单（文件 / 路径 / 字段 / 片段 / 类型）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const read = (f) => fs.readFileSync(P(f), 'utf8');
const J = (f) => JSON.parse(read(f));

const RULES = [
  ['模板字面量 ${}', /\$\{[^}\n]{1,40}\}/],
  ['双花括号 {{}}', /\{\{[^}\n]{0,40}\}\}/],
  ['花括号占位 {}', /\{[A-Za-z_\u4e00-\u9fa5][^}\n]{0,30}\}/],
  ['$标识符', /\$[A-Za-z_][A-Za-z0-9_]{1,30}/],
  ['点号字段 .xxx', /(?<![0-9A-Za-z_])\.(registry|log|value|name|id|args|raw|text|desc|type|count|key|var)\b/],
  ['undefined/NaN', /\bundefined\b|\bNaN\b/],
  ['[object', /\[object\s/],
  ['printf占位', /%[sdif]\b/],
  ['TODO/待补', /\bTODO\b|\bFIXME\b|\bTBD\b|待补|待填|待定|XXXX/],
  ['正文夹英文词', /[\u4e00-\u9fa5][A-Za-z]{3,}|[A-Za-z]{3,}[\u4e00-\u9fa5]/],
];
const hits = [];
function scan(file, p, field, text) {
  if (typeof text !== 'string' || !text) return;
  for (const [name, re] of RULES) {
    const m = re.exec(text);
    if (m) hits.push([file, p, field, name, m[0], text.slice(0, 60)]);
  }
}

/* 可选：以某目录为数据源（用于「用改写前快照自证扫描器有效」） */
const SRCDIR = process.argv[2] || 'game/data';
const SRC = (f) => path.join(ROOT, SRCDIR, path.basename(f));
const readS = (f) => fs.readFileSync(SRC(f), 'utf8');
const JS = (f) => JSON.parse(readS(f));

/* ---- 50_map ---- */
const mapD = JS('50_map.json');
for (const [id, r] of Object.entries(mapD.rooms)) { scan('50_map', id, 'name', r.name); scan('50_map', id, 'desc', r.desc); }
/* ---- 40_npcs ---- */
const npcD = JS('40_npcs.json');
for (const [id, n] of Object.entries(npcD.npcs)) {
  scan('40_npcs', id, 'desc', n.desc);
  (n.talk || []).forEach((t, i) => scan('40_npcs', id, 'talk[' + i + ']', t));
  (n.ask || []).forEach((a, i) => {
    scan('40_npcs', id, 'ask[' + i + '].answer', a.answer);
    (a.keywords || []).forEach((k, j) => scan('40_npcs', id, 'ask[' + i + '].keywords[' + j + ']', k));
  });
  scan('40_npcs', id, 'askDefault', n.askDefault);
  (n.listen || []).forEach((l, i) => (l.effects || []).forEach((e, j) => scan('40_npcs', id, 'listen[' + i + '].effects[' + j + ']', e.raw || e.text)));
}
/* ---- quests ---- */
function scanQuestFile(fn, label) {
  const d = JSON.parse(readS(fn));
  for (const [qid, q] of Object.entries(d.quests || {})) {
    scan(label, qid, 'desc', q.desc);
    scan(label, qid, 'name', q.name);
    const walkRewards = (arr, at) => (arr || []).forEach((r, i) => { if (r && (r.raw || r.text)) scan(label, qid, at + '[' + i + '].raw', r.raw || r.text); });
    (q.stages || []).forEach((s, si) => {
      scan(label, qid, 'stages[' + si + '].desc', s.desc);
      (s.targets || []).forEach((t, ti) => scan(label, qid, 'stages[' + si + '].targets[' + ti + '].desc', t.desc));
      walkRewards(s.rewards, 'stages[' + si + '].rewards');
      walkRewards(s.effects, 'stages[' + si + '].effects');
      (s.effects || []).forEach((e, ei) => scan(label, qid, 'stages[' + si + '].effects[' + ei + '].raw', e.raw));
    });
    walkRewards(q.rewards, 'rewards');
  }
}
scanQuestFile('60_quests.json', '60_quests');
try { scanQuestFile('61_sidequests.json', '61_sidequests'); } catch (e) { /* 61 可能被并发改动，忽略 */ }
/* ---- tutorial.js 字符串 ---- */
{
  const src = read('game/src/core/tutorial.js');
  const strs = src.match(/'[^']*'/g) || [];
  strs.forEach((s, i) => scan('tutorial.js', 'str#' + i, 'literal', s.replace(/^'|'$/g, '')));
}

console.log('=== 泄漏扫描命中 ' + hits.length + ' 处 ===');
const byType = {};
for (const h of hits) byType[h[3]] = (byType[h[3]] || 0) + 1;
console.log('按类型:', JSON.stringify(byType, null, 0));
for (const h of hits) console.log('  [' + h[3] + '] ' + h[0] + ' / ' + h[1] + ' / ' + h[2] + ' → 「' + h[4] + '」  …「' + h[5] + '」');
fs.writeFileSync(P('.textaudit/leak-hits.json'), JSON.stringify(hits, null, 1), 'utf8');
