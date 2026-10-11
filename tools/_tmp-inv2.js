'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;
const npcs = D.npcs, quests = D.quests;

// 所有 sq_ 前缀
const sqAll = Object.keys(quests).filter(q => q.startsWith('sq_'));
const sqNpcv = sqAll.filter(q => q.startsWith('sq_npcv_'));
const sqOther = sqAll.filter(q => !q.startsWith('sq_npcv_'));
console.log('sq_ 总数:', sqAll.length, ' sq_npcv_:', sqNpcv.length, ' 其它 sq_:', sqOther.length);
console.log('其它 sq_ 前缀:', [...new Set(sqOther.map(x=>x.split('_').slice(0,2).join('_')))].join(', '));
console.log('其它 sq_ 样例:', sqOther.slice(0,10).join(', '));

// 检查几个 portrait NPC 的 quests 字段
const sample = ['npcv_001','npcv_002','npcv_003','npcv_050','npcv_241','npcv_154'];
for (const id of sample) {
  const n = npcs[id];
  console.log(`\n[${id}] ${n.name||''} portrait=${!!n.portrait} quests=${JSON.stringify(n.quests||null)} sidequest=${n.sidequest||null}`);
}

// 统计：有 portrait 的 NPC，npc.quests 中 hk 占比 / sq 占比
let hasHk=0, hasSq=0, hasBoth=0, hasOther=0, none=0;
for (const id of Object.keys(npcs)) {
  const n=npcs[id]; if(!n.portrait) continue;
  const qs = Array.isArray(n.quests)?n.quests:[];
  const h = qs.filter(x=>x.startsWith('hk_')).length;
  const s = qs.filter(x=>x.startsWith('sq_')).length;
  if(h&&s)hasBoth++; else if(h)hasHk++; else if(s)hasSq++; else if(qs.length)hasOther++; else none++;
  if(n.sidequest && !qs.length) hasOther++;
}
console.log('\n有画像NPC挂载分布: 仅hk=%d 仅sq=%d 两者=%d 其它=%d 无=%d', hasHk,hasSq,hasBoth,hasOther,none);

// 有 portrait 但 npc.quests 为空的
const emptyQ=[];
for (const id of Object.keys(npcs)) { const n=npcs[id]; if(n.portrait && !(Array.isArray(n.quests)&&n.quests.length) && !n.sidequest) emptyQ.push(id); }
console.log('\n有画像但无任何挂载:', emptyQ.length, emptyQ.join(', '));

// 反向：sq_npcv 的 giver 里有多少有 portrait
let sqGiverWithP=0, sqGiverNoP=0, sqGiverMissing=0;
const sqGivers=new Set();
for(const q of sqNpcv){const g=quests[q].giver||quests[q].npc; sqGivers.add(g); if(!npcs[g])sqGiverMissing++; else if(npcs[g].portrait)sqGiverWithP++; else sqGiverNoP++;}
console.log('sq_npcv giver 数:', sqGivers.size, ' 有画像:', sqGiverWithP, ' 无画像:', sqGiverNoP, ' 不存在:', sqGiverMissing);
