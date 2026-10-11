'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;
const out = [];
const hk = Object.keys(D.quests).filter(q => q.startsWith('hk_'));
for (const qid of hk) {
  const q = D.quests[qid];
  const g = D.npcs[q.giver] || {};
  const p = g.portrait || {};
  out.push('========== ' + qid + ' | ' + q.name + ' | giver=' + q.giver + ' ' + (g.name||'') + ' | lv' + q.level);
  out.push('desc: ' + q.desc);
  out.push('PORTRAIT origin: ' + (p.origin||''));
  out.push('PORTRAIT now: ' + (p.now||''));
  out.push('PORTRAIT want: ' + (p.want||''));
  out.push('PORTRAIT fear: ' + (p.fear||''));
  out.push('PORTRAIT secret: ' + (typeof p.secret==='object'?JSON.stringify(p.secret):p.secret||''));
  out.push('PORTRAIT feuds: ' + JSON.stringify(p.feuds||[]));
  out.push('PORTRAIT hooks: ' + JSON.stringify((p.hooks||[]).map(h=>h.id)));
  (q.stages||[]).forEach((s,i)=>{
    out.push('  stage'+i+' desc: ' + s.desc);
    out.push('  stage'+i+' targets: ' + JSON.stringify((s.targets||[]).map(t=>t.kind+':'+t.key)));
    (s.effects||[]).forEach(ef=>{
      if (ef.type==='menu') out.push('  stage'+i+' MENU: ' + ef.raw);
      else out.push('  stage'+i+' '+(ef.type)+': ' + (ef.raw!==undefined?ef.raw:JSON.stringify(ef.args)));
    });
  });
  (q.rewards||[]).forEach(r=>out.push('  reward '+(r.type)+': '+(r.raw!==undefined?r.raw:JSON.stringify(r.args))));
  out.push('');
}
fs.writeFileSync(path.join(ROOT,'tools','_tmp-hk-dump.txt'), out.join('\n'), 'utf8');
console.log('wrote', out.length, 'lines');
