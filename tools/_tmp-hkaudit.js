'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;

const nameOfRoom = id => { const r = D.rooms[id]; return r ? (r.name + ' @' + r.region) : 'MISSING'; };
const rooms = ['jn_wine_house','jn_wine_room','jn_brothel_hall','jn_brothel_room','jn_school','jn_yamen_arch','jn_yamen_court','jn_yamen_wt','jn_market_north','jn_market_main','gusu_town','gusu_yanzi','road_xixia_1','xixia_ice','palace_prison','jn_fruit_stall','mojiao_hall','mojiao_shanmen','tangmen_hall','jn_bookshop','jn_teahouse','jm_underground','jn_yizhuang','gaibang_po_miao','jiangnan_temple','jn_pawnshop','jn_silk_shop','jn_granary','jn_pottery','jn_harbor_shed','jn_harbor_wharf','jn_resident_2','jn_market_south','jn_market_west','jiangnan_market'];
console.log('=== 关键房间名 ===');
for (const id of rooms) console.log('  ' + id.padEnd(20), nameOfRoom(id));

console.log('\n=== mob 是否存在 ===');
for (const m of ['mob_bandit']) console.log('  ' + m, !!D.monsters[m], D.monsters[m] ? D.monsters[m].name : '');
console.log('  monsters 数:', Object.keys(D.monsters).length);

console.log('\n=== hk 任务悬空引用审计 ===');
const hk = Object.keys(D.quests).filter(q => q.startsWith('hk_'));
for (const qid of hk) {
  const q = D.quests[qid];
  const problems = [];
  if (!D.npcs[q.giver]) problems.push('giver 不存在 ' + q.giver);
  if (!D.npcs[q.npc]) problems.push('npc 不存在 ' + q.npc);
  const walk = (efs, where) => {
    for (const ef of (efs || [])) {
      if (ef.type === 'menu') {
        const opts = (ef.raw.split('|')[1] || '').split(';;').filter(Boolean);
        for (const o of opts) {
          const m = o.match(/^([^>]+)>\s*(.*)$/);
          if (!m) { problems.push(where + ' menu 选项无 > : ' + o); continue; }
          for (const eff of m[2].split(';').map(s=>s.trim()).filter(Boolean)) {
            const mm = eff.match(/^([^:]+):(.*)$/);
            if (!mm) { problems.push(where + ' 选项效果无冒号: ' + eff); continue; }
            const t=mm[1], a=mm[2].split(':');
            if (t==='+item'||t==='-item'){ if(!D.items[a[0]]) problems.push(where+' item 不存在 '+a[0]); }
            if (t==='combat'||t==='fight'){ if(!D.monsters[a[0]]) problems.push(where+' mob 不存在 '+a[0]); }
            if (t==='+rep'&&a[0]==='*') problems.push(where+' rep 通配 *');
          }
        }
      } else if (ef.type === '+item') { if(!D.items[ef.args[0]]) problems.push(where+' item 不存在 '+ef.args[0]); }
      else if (ef.type === 'combat') { if(!D.monsters[ef.args[0]]) problems.push(where+' mob 不存在 '+ef.args[0]); }
    }
  };
  (q.stages||[]).forEach((s,i)=>{ 
    for(const t of (s.targets||[])) if(t.kind==='room'&&!D.rooms[t.key]) problems.push('stage'+i+' 房间不存在 '+t.key);
    walk(s.effects,'stage'+i);
    if (s.cond) { /* 收集 cond 里的 flag */ }
  });
  walk(q.rewards,'reward');
  if (problems.length) console.log('  ' + qid + ': ' + problems.join(' | '));
}
console.log('(以上为问题，空即为无)');
