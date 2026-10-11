/* 临时盘点脚本：查「加载后的世界」，不 grep 单文件 */
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;

const npcs = D.npcs;
const quests = D.quests;

const PORTRAIT_FIELDS = ['origin', 'now', 'want', 'fear', 'secret', 'feuds', 'arc', 'hooks'];

let withPortrait = [];
let noPortrait = [];
for (const id of Object.keys(npcs)) {
  const n = npcs[id];
  if (n.portrait && typeof n.portrait === 'object') withPortrait.push(id);
  else noPortrait.push(id);
}

function hasQuest(n) {
  if (Array.isArray(n.quests) && n.quests.length) return true;
  if (n.sidequest) return true;
  return false;
}

const attached = [];
const unattached = [];
for (const id of withPortrait) {
  const n = npcs[id];
  if (hasQuest(n)) attached.push(id); else unattached.push(id);
}

console.log('=== 基础 ===');
console.log('NPC 总数:', Object.keys(npcs).length);
console.log('有 portrait:', withPortrait.length);
console.log('  已挂支线(npc.quests/sidequest):', attached.length);
console.log('  未挂支线:', unattached.length);
console.log('无 portrait:', noPortrait.length);
console.log('任务总数:', Object.keys(quests).length);

// 按类型统计 quest id 前缀
const pref = {};
for (const qid of Object.keys(quests)) {
  const m = qid.match(/^([a-z]+)_/);
  const p = m ? m[1] : qid;
  pref[p] = (pref[p] || 0) + 1;
}
console.log('quest id 前缀分布:', JSON.stringify(pref));

/* hk_ 支线清单 */
const hk = Object.keys(quests).filter(q => q.startsWith('hk_'));
console.log('\n=== hk_* 支线 (' + hk.length + ') ===');
const hkGivers = new Set();
for (const qid of hk) {
  const q = quests[qid];
  hkGivers.add(q.giver || q.npc);
  console.log(`${qid} | giver=${q.giver} npc=${q.npc} | ${q.name} | lv${q.level}`);
}
console.log('hk_ 覆盖 NPC 数:', hkGivers.size, '→', [...hkGivers].join(', '));

/* 未挂支线的 portrait NPC 详情（画像质量判定） */
console.log('\n=== 未挂支线的 portrait NPC ===');
for (const id of unattached) {
  const n = npcs[id];
  const p = n.portrait || {};
  const filled = PORTRAIT_FIELDS.filter(f => {
    const v = p[f];
    if (v == null) return false;
    if (typeof v === 'string') return v.trim().length > 0;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
  console.log(`\n[${id}] ${n.name || ''}  room=${n.room}  tag=${n.tag || ''} job=${n.job || ''} sect=${n.sect || ''} lv=${n.level}`);
  console.log('  画像字段:', filled.join(',') || '(空)');
  for (const f of filled) {
    let v = p[f];
    let s = typeof v === 'string' ? v : JSON.stringify(v);
    console.log(`   ${f}: ${s.slice(0, 160)}`);
  }
}

/* sq_npcv_* 模板支线 */
const sq = Object.keys(quests).filter(q => q.startsWith('sq_npcv_'));
console.log('\n=== sq_npcv_* 模板支线: ' + sq.length + ' 条 ===');
const sqGivers = new Set();
for (const qid of sq) sqGivers.add(quests[qid].giver || quests[qid].npc);
console.log('覆盖 NPC 数:', sqGivers.size);
// 抽样 3 条
for (const qid of sq.slice(0, 3)) {
  console.log('  样例', qid, '→', JSON.stringify(quests[qid]).slice(0, 300));
}
