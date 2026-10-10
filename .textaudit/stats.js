const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const j = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const jb = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.textaudit/backup', path.basename(f)), 'utf8'));

function dup(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return Object.values(m).filter((v) => v > 1); }
function stat(docLike, label) {
  const m = docLike.rooms ? docLike : null;
  return null;
}
const M = j('game/data/50_map.json').rooms, Mb = jb('game/data/50_map.json').rooms;
const N = j('game/data/40_npcs.json').npcs, Nb = jb('game/data/40_npcs.json').npcs;
const Q = j('game/data/60_quests.json').quests, Qb = jb('game/data/60_quests.json').quests;

const cnt = {};
cnt['房间 desc'] = Object.keys(M).length;
cnt['NPC desc'] = Object.keys(N).length;
let talk = 0, ask = 0, askDef = 0, listen = 0;
for (const p of Object.values(N)) { talk += (p.talk || []).length; ask += (p.ask || []).length; if (p.askDefault) askDef++; listen += (p.listen || []).length; }
cnt['NPC talk 台词'] = talk; cnt['NPC ask 回答'] = ask; cnt['NPC askDefault'] = askDef; cnt['NPC listen'] = listen;
let qd = 0, qs = 0, qt = 0, qsay = 0, qnar = 0;
for (const q of Object.values(Q)) {
  if (q.desc) qd++;
  for (const s of (q.stages || [])) { qs++; for (const t of (s.targets || [])) if (t.desc) qt++; }
  for (const r of (q.rewards || [])) { if (r.type === 'say') qsay++; if (r.type === 'narrate') qnar++; }
  for (const s of (q.stages || [])) for (const r of (s.rewards || [])) { if (r.type === 'say') qsay++; if (r.type === 'narrate') qnar++; }
}
cnt['任务 desc'] = qd; cnt['任务 stage desc'] = qs; cnt['任务 target desc'] = qt; cnt['任务 say 台词'] = qsay; cnt['任务 narrate'] = qnar;

console.log('=== 玩家可见文本条数（改写后 / 全库） ===');
let total = 0; for (const [k, v] of Object.entries(cnt)) { console.log('  ' + k + ': ' + v); total += v; }
console.log('  合计: ' + total + '（另：tutorial.js 中文串 28 处、房间名 312、任务名 305 未改）');

function lit(doc, kind) {
  if (kind === 'room') return Object.values(doc).map((r) => r.desc);
  if (kind === 'talk') return Object.values(doc).flatMap((p) => p.talk || []);
  if (kind === 'qdesc') return Object.values(doc).filter((q) => /^sq_npcv_/.test(q.id) || true).map((q) => q.desc).filter(Boolean);
  if (kind === 'sqdesc') return Object.values(doc).filter((q) => /^sq_npcv_/.test(q.id)).map((q) => q.desc);
}
const row = (label, before, after) => console.log('  ' + label.padEnd(28) + ' 改写前重复 ' + String(before).padStart(3) + ' 组 / 改写后 ' + String(after).padStart(3) + ' 组');
console.log('\n=== 逐字重复（同文多份）统计 ===');
row('房间 desc 完全相同', dup(lit(Mb, 'room')).length, dup(lit(M, 'room')).length);
row('npcv talk 完全相同', dup(lit(Nb, 'talk')).length, dup(lit(N, 'talk')).length);
row('sq_npcv desc 完全相同', dup(lit(Qb, 'sqdesc')).length, dup(lit(Q, 'sqdesc')).length);
row('全部任务 desc 相同', dup(lit(Qb, 'qdesc')).length, dup(lit(Q, 'qdesc')).length);

/* 套话词命中（房间 + NPC desc） */
const CLICHE = /神秘莫测|危机四伏|命运的齿轮|一段传奇|江湖会记得|深不可测|高深莫测|不可|令人(神往|向往|心悸|作呕)|一派[^，。]{0,6}气象|气象|一派|隐约|一应俱全|似有似无|宛如|恍若|仿佛|不凡|十足|扑面而来|油然而生|显得极小|令人眩晕|望之令人|非凡/;
console.log('\n=== 套话/概括词命中（房间 + NPC desc 文本行） ===');
const before = [...Object.values(Mb).map((r) => r.desc), ...Object.values(Nb).map((p) => p.desc)].filter((d) => CLICHE.test(d));
const after = [...Object.values(M).map((r) => r.desc), ...Object.values(N).map((p) => p.desc)].filter((d) => CLICHE.test(d));
console.log('  改写前 ' + before.length + ' 条命中；改写后 ' + after.length + ' 条');
console.log('  残留样例：'); after.slice(0, 12).forEach((d) => console.log('    · ' + d));
