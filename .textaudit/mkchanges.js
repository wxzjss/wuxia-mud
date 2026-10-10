const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const R = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const rb = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, '.textaudit/backup', path.basename(f)), 'utf8'));
const out = [];
const sec = (t) => out.push('\n## ' + t + '\n');

const m = R('game/data/50_map.json'), mb = rb('game/data/50_map.json');
sec('房间 desc（' + Object.keys(m.rooms).length + ' 间中改动）');
let roomN = 0;
for (const [id, r] of Object.entries(m.rooms)) {
  const o = mb.rooms[id];
  if (o && o.desc !== r.desc) { roomN++; out.push('| ' + id + ' | ' + o.desc + ' | ' + r.desc + ' |'); }
}
out.splice(out.length - roomN, 0, '| id | 旧 | 新 |\n|---|---|---|');

const n = R('game/data/40_npcs.json').npcs, nb = rb('game/data/40_npcs.json').npcs;
sec('NPC desc 改动');
out.push('| id | 名 | 旧 | 新 |\n|---|---|---|---|');
for (const [id, p] of Object.entries(n)) { const o = nb[id]; if (o && o.desc !== p.desc) out.push('| ' + id + ' | ' + p.name + ' | ' + o.desc + ' | ' + p.desc + ' |'); }
sec('NPC 其他（askDefault / talk）');
for (const [id, p] of Object.entries(n)) {
  const o = nb[id];
  if (o && o.askDefault !== p.askDefault) out.push('* ' + id + '.askDefault: ' + o.askDefault + ' → ' + p.askDefault);
  if (o && JSON.stringify(o.talk) !== JSON.stringify(p.talk)) out.push('* ' + (p.name || id) + '.talk: ' + JSON.stringify(o.talk) + ' → ' + JSON.stringify(p.talk));
}
sec('npcv 原型台词（33 组，每组 8~9 人共用；列出每组第 1 人）');
for (let i = 1; i <= 33; i++) {
  const id = 'npcv_' + String(i).padStart(3, '0');
  out.push('* ' + id + ' ' + n[id].name + ': ' + JSON.stringify(nb[id].talk) + ' → ' + JSON.stringify(n[id].talk));
}

const q = R('game/data/60_quests.json').quests, qb = rb('game/data/60_quests.json').quests;
sec('具名任务 desc');
out.push('| id | 旧 | 新 |\n|---|---|---|');
for (const [id, v] of Object.entries(q)) { const o = qb[id]; if (o && o.desc !== v.desc) out.push('| ' + id + ' | ' + o.desc + ' | ' + v.desc + ' |'); }
sec('具名任务 stage desc');
for (const [id, v] of Object.entries(q)) { const o = qb[id]; if (o) (v.stages || []).forEach((s, i) => { if (o.stages[i] && o.stages[i].desc !== s.desc) out.push('* ' + id + '[' + i + ']: ' + o.stages[i].desc + ' → ' + s.desc); }); }
sec('具名任务 say');
for (const [id, v] of Object.entries(q)) {
  const o = qb[id]; if (!o) continue;
  const os = (o.rewards || []).find((x) => x.type === 'say'), ns = (v.rewards || []).find((x) => x.type === 'say');
  if (os && ns && os.raw !== ns.raw) out.push('* ' + id + ': ' + os.raw + ' → ' + ns.raw);
}
sec('sq_npcv 模板 desc：每个句型一条样例');
const seenT = {};
for (const [id, v] of Object.entries(q)) {
  if (!/^sq_npcv_/.test(id)) continue;
  const o = qb[id]; if (!o || o.desc === v.desc) continue;
  const key = v.desc.replace(/\{[^}]*\}/g, '');
  const sig = o.desc.replace(/^[^，。]*/, '');
  if (seenT[sig]) { seenT[sig].push(id); continue; }
  seenT[sig] = [id];
  out.push('* [' + id + '] ' + o.desc + ' → ' + v.desc);
}
let sqN = 0; for (const [id, v] of Object.entries(q)) if (/^sq_npcv_/.test(id) && qb[id].desc !== v.desc) sqN++;
out.push('\n（sq_npcv_* 共改写 ' + sqN + ' 条）');

fs.writeFileSync(path.join(ROOT, '.textaudit/changes.md'), out.join('\n'), 'utf8');
console.log('wrote .textaudit/changes.md');
console.log('room changes', roomN, '| sq changes', sqN);
