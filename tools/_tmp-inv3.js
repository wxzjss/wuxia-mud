'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;
const npcs = D.npcs, quests = D.quests;
const FIELDS = ['origin','now','want','fear','secret','feuds','arc','hooks'];

function qlen(n){let s=0;const p=n.portrait||{};for(const f of FIELDS){const v=p[f];if(v==null)continue;if(typeof v==='string')s+=v.length;else if(Array.isArray(v))s+= v.map(x=>JSON.stringify(x)).join('').length;else s+=JSON.stringify(v).length;}return s;}

const rows=[];
for(const id of Object.keys(npcs)){
  const n=npcs[id]; if(!n.portrait) continue;
  const qs=Array.isArray(n.quests)?n.quests:[];
  const hk=qs.filter(x=>x.startsWith('hk_'));
  const attach = hk.length?('hk:'+hk.length) : (n.sidequest?('tpl:'+n.sidequest): 'NONE');
  rows.push({id,name:n.name,room:n.room,tag:n.tag,job:n.job,sect:n.sect,lv:n.level,attach,plen:qlen(n),nfields:FIELDS.filter(f=>{const v=n.portrait[f];return v!=null&&(!(Array.isArray(v))?String(v).length>0:v.length>0);}).length});
}
// 分组
const grp = {};
for(const r of rows){const k=r.attach.split(':')[0];(grp[k]=grp[k]||[]).push(r);}
console.log('分组统计:', Object.keys(grp).map(k=>k+'='+grp[k].length).join(' '));

console.log('\n=== 有画像、只有 sq_npcv 薄模板、无专属支线（按画像长度降序）===');
const tpl = rows.filter(r=>r.attach.startsWith('tpl')).sort((a,b)=>b.plen-a.plen);
console.log('共', tpl.length);
for(const r of tpl.slice(0,60)){
  console.log(`${r.id} | ${r.name} | ${r.room} | ${r.tag||r.job||''} ${r.sect||''} lv${r.lv} | 字段${r.nfields} 画像${r.plen}字 | ${r.attach}`);
}
console.log('\n... 剩余', Math.max(0,tpl.length-60));

console.log('\n=== NONE（无任何挂载）===');
for(const r of rows.filter(r=>r.attach==='NONE')) console.log(`${r.id} ${r.name} ${r.room} lv${r.lv} 画像${r.plen}`);

// 全部 tpl 列表（供选人）
console.log('\n=== tpl 全部 id ===');
console.log(tpl.map(r=>r.id).join(' '));
