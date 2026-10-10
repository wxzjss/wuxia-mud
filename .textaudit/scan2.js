const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const Q = J('game/data/60_quests.json').quests;
const QB = JSON.parse(fs.readFileSync(path.join(ROOT, '.textaudit/backup/60_quests.json'), 'utf8')).quests;
const N = J('game/data/40_npcs.json').npcs;
const M = J('game/data/50_map.json').rooms;
const regR = J('game/data/50_map.json').regions;

console.log('=== 两个「人名当药名」任务的结构 ===');
for (const qid of ['sq_wen_jiangnan', 'sq_shaolin_fangzheng']) {
  const q = Q[qid];
  console.log('--- ' + qid + ' giver=' + q.giver + ' rel=' + JSON.stringify((N[q.giver].rel || []).map((r) => r.id + ':' + r.kind)));
  console.log(JSON.stringify(q.stages.map((s) => ({ desc: s.desc, t: s.targets, cond: s.cond })), null, 1));
}
console.log('\n同型对照（正常采药任务）：');
for (const qid of ['sq_npcv_002', 'sq_npcv_012']) {
  const q = Q[qid];
  console.log('  ' + qid + ' target=' + JSON.stringify(q.stages[0].targets[0]) + ' | stage0=' + q.stages[0].desc);
}

/* 用「改写前 desc」判定任务原型（改写后句型已分散，不能再靠 /野兽/ 认） */
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
  return '?';
}
const INDOOR = /客栈|酒楼|雅间|茶馆|茶楼|酒馆|铺|坊|宅|府|院|堂|厅|阁|楼|庙|寺|观|庵|殿|库|房|牢|狱|馆|斋|轩|居|棚|屋|室|巢|窑|局|栈/;
const HARD_INDOOR = /后厨|雅间|雅阁|房|楼|堂|厅|阁|库|室|棚|院|院|厨|栈|局|寺|观|庵|殿|庙|铺|坊|局/;

console.log('\n=== 除害型：目标房间室内判定（按改写前原型分类） ===');
let bad = [];
for (const [qid, q] of Object.entries(Q)) {
  if (proto(qid) !== '除害') continue;
  const t = q.stages[0].targets[0];
  const r = M[t.key]; if (!r) { console.log('  ' + qid + ' 目标房不存在 ' + t.key); continue; }
  const nm = r.name || '';
  const indoor = HARD_INDOOR.test(nm);
  if (indoor) bad.push([qid, t.key, nm, q.giver || q.id]);
}
bad.forEach(([qid, k, nm]) => console.log(`  ${qid} → ${k}「${nm}」`));
console.log('  室内除害合计: ' + bad.length);

console.log('\n=== 除害型：目标房间 region 与 giver region 是否一致（结构约束） ===');
let cross = 0;
for (const [qid, q] of Object.entries(Q)) {
  if (proto(qid) !== '除害') continue;
  const gid = qid.replace(/^sq_/, ''); const g = N[gid];
  const t = q.stages[0].targets[0];
  const rg = M[g.room] && M[g.room].region, rd = M[t.key] && M[t.key].region;
  if (rg !== rd) { cross++; console.log('  跨区 ' + qid + ' giverRoom=' + g.room + '(' + rg + ') dest=' + t.key + '(' + rd + ')'); }
}
console.log('  跨区合计: ' + cross);

console.log('\n=== 各 region 的候选「野外/街巷」房间（供替换） ===');
const OUT_GOOD = /山|坡|林|道|路|野|谷|潭|洞|崖|湖|江|河|海|滩|原|岭|口|场|桥|渡口|溪|泉|沙漠|绿洲|草原|栈道|岔路|市集|大街|街|巷|码头|田|埂|山门|山口/;
for (const [rid, rooms0] of Object.entries({})) {}
const byReg = {};
for (const [id, r] of Object.entries(M)) {
  const nm = r.name || '';
  if (HARD_INDOOR.test(nm) && !OUT_GOOD.test(nm)) continue;
  if (!OUT_GOOD.test(nm)) continue;
  (byReg[r.region] = byReg[r.region] || []).push(id + '「' + nm + '」');
}
for (const [reg, arr] of Object.entries(byReg)) console.log('  ' + reg + ': ' + arr.slice(0, 10).join(' , '));
