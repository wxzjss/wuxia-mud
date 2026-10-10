const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const Q = J('game/data/60_quests.json').quests;
const QB = JSON.parse(fs.readFileSync(path.join(ROOT, '.textaudit/backup/60_quests.json'), 'utf8')).quests;
const N = J('game/data/40_npcs.json').npcs;
const M = J('game/data/50_map.json').rooms;

function proto(id) {
  const d = (QB[id] || {}).desc || '';
  if (/要你替他跑趟腿/.test(d)) return '采买';
  if (/家里有人病了/.test(d)) return '采药';
  if (/野兽/.test(d)) return '除害';
  if (/丢了件要紧物事/.test(d)) return '寻物';
  if (/有趟货要送/.test(d)) return '护送';
  if (/有笔旧账/.test(d)) return '讨债';
  if (/把一封信/.test(d)) return '送信';
  if (/久未走动的旧识/.test(d)) return '寻人';
  if (/打听一桩旧事/.test(d)) return '打探';
  if (/恩怨压在心里多年/.test(d)) return '了结';
  return null;
}
/* 自然/野外房间判定（可采药、可闹兽） */
const NATURAL = /山|坡|林|道|路|野|谷|潭|洞|崖|湖|江|河|海|滩|原|岭|口|场|桥|渡口|溪|泉|沙漠|绿洲|草原|栈道|岔路|田|埂|药圃|花园|山门|港口|码头|郊区|村口|村道|草地|松林|竹林|清溪|土坡|小道|官道|大街|市集|巷|街/;
const HARD_INDOOR = /后厨|雅间|雅阁|房|楼|堂|厅|阁|库|室|棚|厨|栈|局|寺|观|庵|殿|庙|铺|坊|铺|局|塔|楼/;

function candidates(region, giverRoomId) {
  return Object.entries(M)
    .filter(([id, r]) => r.region === region && id !== giverRoomId && NATURAL.test(r.name || '') && !HARD_INDOOR.test(r.name || ''))
    .map(([id, r]) => id + '「' + r.name + '」');
}

const rows = [];
for (const [qid, q] of Object.entries(Q)) {
  const p = proto(qid);
  if (!p) continue;
  const gid = qid.replace(/^sq_/, '');
  const g = N[gid]; if (!g) continue;
  const t = q.stages[0].targets[0];
  const dest = M[t.key]; if (!dest) { rows.push([qid, p, g.name, '目标房不存在:' + t.key]); continue; }
  const gReg = (M[g.room] || {}).region;
  const dReg = dest.region;
  const indoor = HARD_INDOOR.test(dest.name || '') && !NATURAL.test(dest.name || '');
  const needs = (p === '除害' || p === '采药');
  if (!needs) continue;
  const bad = indoor || gReg !== dReg;
  if (!bad) continue;
  const cand = candidates(gReg, g.room);
  rows.push([qid, p, g.name, 'giverRoom=' + g.room + '(' + gReg + ')', 'dest=' + t.key + '「' + dest.name + '」(' + dReg + ')', 'cand=' + cand.slice(0, 6).join(' , ')]);
}
console.log('=== 需调整目标房的 除害/采药 任务 ===');
for (const r of rows) console.log('  ' + r.join(' | '));
console.log('  合计 ' + rows.length);

console.log('\n=== 占位人名：giver 的 rel，可用于替换 ===');
for (const qid of ['sq_npcv_049', 'sq_npcv_089', 'sq_npcv_110', 'sq_npcv_139', 'sq_npcv_179', 'sq_npcv_229', 'sq_npcv_269']) {
  const gid = qid.replace(/^sq_/, ''); const g = N[gid];
  const ids = (g.rel || []).map((x) => x.id);
  console.log('  ' + qid + ' giver=' + g.name + '(' + gid + ') rel=[' + ids.map((i) => (N[i] ? N[i].name : i)).join(',') + ']');
  console.log('     dest=' + Q[qid].stages[0].targets[0].key + ' | stage0=' + Q[qid].stages[0].desc + ' | stage1=' + (Q[qid].stages[1] || {}).desc);
}

console.log('\n=== 22 条具名 sq_* 的结构（stage 与 target）===');
for (const [qid, q] of Object.entries(Q)) {
  if (!/^sq_/.test(qid) || /^sq_npcv_/.test(qid)) continue;
  console.log('  ' + qid + ' | giver=' + q.giver + ' | ' + q.stages.map((s) => '[' + s.desc + ']→' + s.next + (s.targets ? '(' + s.targets.map((t) => t.kind + ':' + t.key).join(',') + ')' : '')).join(' '));
}
