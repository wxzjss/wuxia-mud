const fs = require('fs');
const path = require('path');
const P = (f) => path.join(path.resolve(__dirname, '..'), f);
const lines = fs.readFileSync(P('.textaudit/npcs.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));

// duplicate desc
const byDesc = {};
for (const [kind, id, who, text] of lines) if (kind === 'DESC') (byDesc[text] = byDesc[text] || []).push(id + '(' + who + ')');
console.log('--- NPC desc 完全相同 ---');
Object.entries(byDesc).filter(([k, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => console.log(v.length, '|', k, '=>', v.slice(0, 12).join(',')));

// duplicate talk
const byTalk = {};
for (const [kind, id, who, text] of lines) if (kind === 'TALK') (byTalk[text] = byTalk[text] || []).push(id);
console.log('--- TALK 完全相同(>=3) ---');
Object.entries(byTalk).filter(([k, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => console.log(v.length, '|', k.slice(0, 50), '=>', v.slice(0, 8).join(',')));

// talk register stats
let t = { len: 0, n: 0, noPunct: 0, short: 0, long: 0 };
for (const [kind, id, who, text] of lines) if (kind === 'TALK') { t.n++; t.len += text.length; if (text.length <= 8) t.short++; if (text.length > 40) t.long++; }
console.log('TALK avg len', (t.len / t.n).toFixed(1), 'n', t.n, 'short<=8', t.short, 'long>40', t.long);

// desc length distribution
const dl = lines.filter((l) => l[0] === 'DESC').map((l) => l[3].length).sort((a, b) => a - b);
console.log('NPC desc len min/med/max', dl[0], dl[Math.floor(dl.length / 2)], dl[dl.length - 1]);

// count descs matching common boilerplate
let bp = {};
const bumps = (k) => bp[k] = (bp[k] || 0) + 1;
for (const [kind, id, who, text] of lines) if (kind === 'DESC') {
  if (/^.{2,6}，一身/.test(text)) bumps('短句，一身X');
  if (/面容|相貌|眉|目|神情/.test(text)) bumps('五官描写');
  if (/身着|穿|一身/.test(text)) bumps('衣着描写');
  if (/气度|神色|气势|神态/.test(text)) bumps('气质概括');
}
console.log('NPC desc patterns', JSON.stringify(bp));
