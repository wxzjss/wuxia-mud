'use strict';
/* 逐派实测两条入门路径：专属入口（山门动作/命令）与通用入口（收徒大典） */
const fs=require('fs'),path=require('path');
const ROOT=path.join(__dirname,'..');
const {GameEngine}=require(path.join(ROOT,'game','src','core','engine.js'));
const arr=x=>Array.isArray(x)?x:x&&typeof x==='object'?Object.values(x):[];
(async()=>{
 const entry=JSON.parse(fs.readFileSync(path.join(ROOT,'game/data/41_sect_entry.json'),'utf8')).sects;
 const ids=Object.keys(entry);
 const rows=[];
 for(const id of ids){
  const e=new GameEngine({seed:7}); await e.boot({}); await e.newGame({name:'探',gender:'male'});
  const w=e.world,p=w.player; const sd=w.getSect(id);
  if(!sd){rows.push({id,verdict:'无门派定义'});continue;}
  const entryRoom=entry[id].entry; p.room=entryRoom;
  try{ w.npcsIncludingTemplates(entryRoom); }catch(_){}
  const tryOne=async(cmd)=>{ p.sect=null;p.rank=0;p.sectContribution=0;
   let r; try{ r=await e.exec(cmd); }catch(err){ return '抛错:'+err.message; }
   const txt=((r&&r.lines)||[]).map(l=>l.text||'').join(' ');
   if(p.sect===id) return '入门成功';
   if(/不收|只收|需 |不足|不够|没有资格/.test(txt)) return '门槛拒绝';
   if(/这里没有|是什么指令|暂时没有更多/.test(txt)) return '无此动作:'+txt.slice(0,12);
   return '空转:'+txt.slice(0,14);
  };
  const own=await tryOne('拜师 '+sd.name);
  const fest=await tryOne('参加大典 '+sd.name);
  const ok=(x)=>x==='入门成功'||x==='门槛拒绝';
  rows.push({id,name:sd.name,tier:sd.tier||'',entryRoom,own,fest,verdict:(ok(own)||ok(fest))?'可达':'✗不可达'});
 }
 const head=['# 门派入门路径实测（专属入口 vs 收徒大典）· 逐派','# 判据：入门成功/门槛拒绝=可达；空转/无此动作=不可达','sect\tname\ttier\tentryRoom\t专属入口\t收徒大典\t结论'].join('\n');
 fs.writeFileSync(path.join(ROOT,'tools/_out_sect_join_paths.tsv'),head+'\n'+rows.map(r=>[r.id,r.name,r.tier,r.entryRoom,r.own,r.fest,r.verdict].join('\t')).join('\n')+'\n');
 const bad=rows.filter(r=>r.verdict!=='可达');
 console.log('门派',rows.length,'| 可达',rows.length-bad.length,'| 不可达',bad.length);
 bad.forEach(r=>console.log('  ✗',r.id,'| 专属:',r.own,'| 大典:',r.fest));
 const noop=rows.filter(r=>r.own.startsWith('空转'));
 console.log('专属入口空转（按钮无效果）:',noop.length, noop.map(r=>r.id).join(','));
 process.exit(0);
})().catch(e=>{console.error(e);process.exit(2)});
