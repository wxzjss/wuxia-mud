const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (f) => path.join(ROOT, f);

// ---------- ROOMS ----------
const map = JSON.parse(fs.readFileSync(P('game/data/50_map.json'), 'utf8'));
const roomLines = [];
for (const [k, r] of Object.entries(map.rooms)) {
  roomLines.push([k, r.name || '', r.desc || ''].join('\t'));
}
fs.writeFileSync(P('.textaudit/rooms.tsv'), roomLines.join('\n'), 'utf8');

// ---------- NPCS ----------
const nd = JSON.parse(fs.readFileSync(P('game/data/40_npcs.json'), 'utf8'));
const npcLines = [];
let c = { desc: 0, talk: 0, ask: 0, askDef: 0, listen: 0 };
for (const [k, p] of Object.entries(nd.npcs)) {
  if (p.desc) { c.desc++; npcLines.push(['DESC', k, p.name || '', p.desc].join('\t')); }
  if (Array.isArray(p.talk)) for (const t of p.talk) { c.talk++; npcLines.push(['TALK', k, p.name || '', t].join('\t')); }
  if (Array.isArray(p.ask)) for (const a of p.ask) {
    const ans = a.answer || (a.effects || []).map(e => e.raw || e.text || '').join('');
    if (ans) { c.ask++; npcLines.push(['ASK', k, (a.topic || '') + '|' + (a.keywords || []).join(','), ans].join('\t')); }
  }
  if (p.askDefault) { c.askDef++; npcLines.push(['ASKDEF', k, p.name || '', p.askDefault].join('\t')); }
  if (Array.isArray(p.listen)) for (const l of p.listen) {
    const s = (l.effects || []).map(e => e.raw || e.text || '').join('');
    if (s) { c.listen++; npcLines.push(['LISTEN', k, l.keyword || '', s].join('\t')); }
  }
}
fs.writeFileSync(P('.textaudit/npcs.tsv'), npcLines.join('\n'), 'utf8');

// ---------- QUESTS ----------
const qd = JSON.parse(fs.readFileSync(P('game/data/60_quests.json'), 'utf8'));
const qLines = [];
let qc = { desc: 0, stage: 0, say: 0, narrate: 0, event: 0, ending: 0, ach: 0, target: 0, other: 0 };
function walkRewards(arr, id) {
  if (!Array.isArray(arr)) return;
  for (const r of arr) {
    if (!r || typeof r !== 'object') continue;
    if (r.type === 'say' && r.raw) { qc.say++; qLines.push(['SAY', id, r.raw].join('\t')); }
    if (r.type === 'narrate' && (r.raw || r.text)) { qc.narrate++; qLines.push(['NARRATE', id, r.raw || r.text].join('\t')); }
  }
}
for (const [k, q] of Object.entries(qd.quests)) {
  if (q.desc) { qc.desc++; qLines.push(['QDESC', k, q.name || '', q.desc].join('\t')); }
  if (Array.isArray(q.stages)) for (const st of q.stages) {
    if (st.desc) { qc.stage++; qLines.push(['STAGE', k, st.desc].join('\t')); }
    if (Array.isArray(st.targets)) for (const t of st.targets) {
      if (t.desc) { qc.target++; qLines.push(['TARGET', k, t.desc].join('\t')); }
    }
    walkRewards(st.rewards, k + '/stage');
    if (st.onEnter) { /* ignore */ }
  }
  walkRewards(q.rewards, k);
  if (Array.isArray(q.objectives)) { /* none seen */ }
}
for (const [k, e] of Object.entries(qd.events || {})) {
  const s = e.desc || e.raw || e.text || '';
  if (s) { qc.event++; qLines.push(['EVENT', k, s].join('\t')); }
}
for (const [k, e] of Object.entries(qd.endings || {})) {
  const s = e.desc || e.text || '';
  if (s) { qc.ending++; qLines.push(['ENDING', k, (e.name || '') + '|' + s].join('\t')); }
}
for (const [k, a] of Object.entries(qd.achievements || {})) {
  const s = a.desc || a.text || '';
  if (s) { qc.ach++; qLines.push(['ACH', k, (a.name || '') + '|' + s].join('\t')); }
}
fs.writeFileSync(P('.textaudit/quests.tsv'), qLines.join('\n'), 'utf8');

console.log('ROOMS', Object.keys(map.rooms).length);
console.log('NPCs', Object.keys(nd.npcs).length, JSON.stringify(c));
console.log('QUEST counts', JSON.stringify(qc), 'lines', qLines.length);
