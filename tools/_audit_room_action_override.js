'use strict';
/* 同房多分片带 actions 键 + 前位动作在后位消失 —— 全库只读台账
   用途：B 判据只扫 diff，这批是"从没被扫过"的存量。本脚本只出表，不改数据、不判红。 */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..'),DATA=path.join(ROOT,'game','data');
const arr=x=>Array.isArray(x)?x:x&&typeof x==='object'?Object.values(x):[];
const cmp=(a,b)=>{const ma=/^(\d+)_/.exec(a),mb=/^(\d+)_/.exec(b);const na=ma?+ma[1]:9e9,nb=mb?+mb[1]:9e9;return na!==nb?na-nb:(a<b?-1:1);};
const files=fs.readdirSync(DATA).filter(f=>f.endsWith('.json')&&/^\d+_/.test(f)).sort(cmp);
const idx={};
for(const f of files){
  let j;try{j=JSON.parse(fs.readFileSync(path.join(DATA,f),'utf8'))}catch(e){continue}
  for(const [rid,r] of Object.entries(j.rooms||{})){
    if(!r||typeof r!=='object'||!('actions' in r))continue;
    (idx[rid]=idx[rid]||[]).push({f,actions:arr(r.actions)});
  }
}
const rows=[];
for(const [rid,car] of Object.entries(idx)){
  if(car.length<2)continue;
  const last=car[car.length-1];
  const lastKeys=new Set(last.actions.map(a=>a&&(a.cmd||a.label)).filter(Boolean));
  const lost=[];
  for(const c of car.slice(0,-1))for(const a of c.actions){const k=a&&(a.cmd||a.label);if(k&&!lastKeys.has(k))lost.push({k,from:c.f});}
  if(!lost.length)continue;
  rows.push({rid,pair:car.map(c=>c.f).join('→'),lost:lost.map(x=>x.k+'@'+x.from).join(' ; '),n:lost.length});
}
rows.sort((a,b)=>b.n-a.n);
const head=['# 同房多分片带 actions 键 · 前位动作在后位消失（只读台账，不判红）',
 '# 判据：按载入序（数值前缀），同一 rid 在 ≥2 个分片都带 actions 键；前位有、最后一位没有的动作 = 被整段覆盖后消失',
 ['room_id','分片顺序','被顶掉的动作(来源)','条数'].join('\t')].join('\n');
fs.writeFileSync(path.join(ROOT,'tools/_out_room_action_override.tsv'),head+'\n'+rows.map(r=>[r.rid,r.pair,r.lost,r.n].join('\t')).join('\n')+'\n');
console.log('多分片承载的房共',Object.values(idx).filter(c=>c.length>1).length,'间 | 有动作被顶掉:',rows.length,'间 | 被顶掉动作合计',rows.reduce((s,r)=>s+r.n,0),'条');
rows.slice(0,12).forEach(r=>console.log('  '+r.rid+' ['+r.pair+'] 丢 '+r.n+': '+r.lost.slice(0,60)));
process.exit(0);
