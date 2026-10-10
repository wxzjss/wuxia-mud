/* 临时复现脚本：B21 mergeData 事件数组被揉成对象 → onKill 静默失效。跑完即删。 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const SEED = 20261010;
const e = new GameEngine({ seed: SEED });
e.boot();
e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;

console.log('=== 事件容器形态 ===');
for (const k of ['onKill', 'onLevelUp', 'onEnter', 'onTick']) {
  const v = w.data.events[k];
  console.log(k, '| Array?', Array.isArray(v), '| type', typeof v, '| keys', v && typeof v === 'object' ? JSON.stringify(Object.keys(v)) : '-');
}
console.log('onKill[0] 有 effects?', !!(w.data.events.onKill && w.data.events.onKill[0] && w.data.events.onKill[0].effects));
console.log('manuscript_page 物品定义存在?', !!w.data.items['manuscript_page']);

console.log('\n=== 真打一场并杀掉一只野兽（走 combat→onNpcKilled→fireEvent(onKill)）===');
function realKill() {
  const n = w.spawnNpc('mob_wolf', p.room, 1, true);
  n.hp = 1; n.maxHp = 1;
  const r = w.startCombat(p, n);
  let guard = 0;
  while (w.battle && !w.battle.over && guard++ < 60) w.combat.step(w.battle);
  p.hp = p.maxHp;
  return { npc: n, over: !!(w.battle && w.battle.over) };
}

// 修复前：把 chance 调成 1 也应该拿不到（因为 handler 根本不在）
try { if (w.data.events.onKill && w.data.events.onKill[0]) w.data.events.onKill[0].cond.chance = 1; } catch (err) { console.log('设 chance 失败:', err.message); }

const potBefore = p.potential;
let gotPage = false, wolves = 0;
for (let i = 0; i < 5; i++) {
  const r = realKill();
  wolves++;
  if (p.inventory.some(it => it.id === 'manuscript_page')) gotPage = true;
}
console.log(`杀了 ${wolves} 只狼；拿到 manuscript_page? ${gotPage}；potential ${potBefore} → ${p.potential}`);
console.log('\n结论（修复前应全为 false）:');
console.log('  数组形态', Array.isArray(w.data.events.onKill), '| 拿到残页', gotPage, '| 潜能增加', p.potential - potBefore);
