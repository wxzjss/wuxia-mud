'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;
const npcs = D.npcs;
const ids = process.argv.slice(2);
for (const id of ids) {
  const n = npcs[id];
  if (!n) { console.log('MISSING', id); continue; }
  console.log('\n########## ' + id + ' · ' + n.name + ' ##########');
  console.log('room=%s tag=%s job=%s sect=%s lv=%s gender=%s age=%s tier=%s district=%s', n.room,n.tag,n.job,n.sect,n.level,n.gender,n.age,n.tier,n.district);
  console.log('desc:', n.desc||'');
  if (n.talk) console.log('talk:', JSON.stringify(n.talk));
  if (n.ask) console.log('ask:', JSON.stringify(n.ask));
  const p = n.portrait||{};
  for (const f of ['origin','now','want','fear','secret','feuds','arc','hooks']) {
    const v=p[f]; if(v==null)continue;
    console.log('  --'+f+': ' + (typeof v==='string'?v:JSON.stringify(v,null,0)));
  }
  if (n.rel) console.log('rel:', JSON.stringify(n.rel));
  if (n.actions) console.log('actions:', JSON.stringify(n.actions).slice(0,400));
}
