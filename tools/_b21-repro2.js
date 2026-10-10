/* 调试：为什么修复后直接 fireEvent 也不掉东西 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { evalCond, evalEffects } = require(path.join(ROOT, 'game', 'src', 'core', 'modapi.js'));

const e = new GameEngine({ seed: 20261010 });
e.boot();
e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;

const h = w.data.events.onKill[0];
console.log('handler0 =', JSON.stringify(h));
console.log('evalCond(chance=0.06) 默认 →', evalCond(h.cond, { player: p, world: w }));
h.cond.chance = 1;
console.log('evalCond(chance=1) →', evalCond(h.cond, { player: p, world: w }));
const lines = evalEffects(h.effects, { player: p, world: w, event: {} });
console.log('evalEffects 直接调 → lines=', JSON.stringify(lines));
console.log('背包有残页?', p.inventory.some(it => it.id === 'manuscript_page'));

// 监听 storyline
const got = [];
w.on('storyline', ev => got.push(ev.line && ev.line.text));
p.inventory = [];
console.log('\n--- 直接 fireEvent(onKill) ---');
w.fireEvent('onKill', {});
console.log('storyline 收到:', JSON.stringify(got));
console.log('背包有残页?', p.inventory.some(it => it.id === 'manuscript_page'));

// 真战斗链
console.log('\n--- 真战斗链 ---');
let killed = 0;
const orig = w.onNpcKilled.bind(w);
w.onNpcKilled = function(npc, battle) { killed++; return orig(npc, battle); };
const n = w.spawnNpc('mob_wolf', p.room, 1, true);
console.log('spawn 名称=', n.name, 'beast?', /狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(n.name || ''));
n.hp = 1; n.maxHp = 1;
const r = w.startCombat(p, n);
console.log('battle?', !!r.battle);
let guard = 0;
while (w.battle && !w.battle.over && guard++ < 60) w.combat.step(w.battle);
console.log('battle.over=', w.battle && w.battle.over, 'guard=', guard, 'onNpcKilled 调用=', killed);
console.log('背包有残页?', p.inventory.some(it => it.id === 'manuscript_page'));
