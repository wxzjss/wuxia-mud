'use strict';
const path=require('path');const ROOT=path.resolve(__dirname,'..');
const {GameEngine}=require(path.join(ROOT,'game/src/core/engine.js'));
const e=new GameEngine({seed:1});e.boot();const D=e.world.data;
const P=require(path.join(ROOT,'game/data/67_sidequests2.json'));
console.log('== D.quests total ==', Object.keys(D.quests).length);
console.log('== 67 quests in D.quests ==');
for(const q of Object.keys(P.quests)) console.log('  ', q, D.quests[q]?'OK':'MISSING', '| type=',D.quests[q]&&D.quests[q].type);
console.log('== mounted npc original quests (from D, after load) ==');
for(const id of Object.keys(P.npcs)){
  const n=D.npcs[id];
  console.log('  ',id, n?'exists':'NO-NPC', '| quests=', JSON.stringify((n&&n.quests)||null));
}
console.log('== referenced npcs existence ==');
const refs=['bureau_clerk','npcv_102','npcv_109','npcv_073','npcv_149','npcv_027','npcv_081','npcv_181','wen_huashan_shop','npcv_219','npcv_010','npcv_095'];
for(const id of refs) console.log('  ',id, D.npcs[id]?'OK':'MISSING');
console.log('== items ==');
for(const id of ['mingdan_didang','xueshu_cezi','rouge_box']) console.log('  ',id, D.items[id]?'OK':'MISSING');
console.log('== rooms refs ==');
const rooms=new Set();
for(const q of Object.keys(P.quests)) for(const s of P.quests[q].stages) for(const t of (s.targets||[])) if(t.kind==='room') rooms.add(t.key);
for(const r of rooms) console.log('  ',r, D.rooms[r]?'OK':'MISSING', D.rooms[r]?'region='+D.rooms[r].region:'');
