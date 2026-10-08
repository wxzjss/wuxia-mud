// 冒烟测试：启动引擎、创建角色、走几步、打一架、存档
const path = require('path');
const { GameEngine } = require('../game/src/core/engine');

const engine = new GameEngine({ projectRoot: path.resolve(__dirname, '..') });
const boot = engine.boot();
console.log('=== BOOT LOG ===');
console.log(JSON.stringify(boot.bootLog, null, 1));
console.log('mods:', boot.mods.length);

const v0 = engine.newGame({ name: '测试侠客', gender: 'male', birth: 'wuxue' });
console.log('\n=== 起始房间 ===');
console.log(v0.room.name, '|', v0.player.name, 'Lv', v0.player.level, 'HP', v0.player.hp);
console.log('出口:', v0.exits.map(e => e.name + '→' + e.toName).join(' / '));
console.log('NPC:', v0.npcs.map(n => n.name).join('、') || '无');

function run(cmd) {
  const r = engine.exec(cmd);
  console.log('\n> ' + cmd);
  for (const l of r.lines) {
    if (l.kind === 'map') continue;
    console.log('   [' + l.kind + '] ' + (l.text || ''));
  }
  return r;
}

run('look');
run('score');
run('attr');
run('skills');
run('i');
run('n');
run('n');
run('look');
run('map');
run('quests');
run('help');
run('北');
run('go 江南城·市集');
run('look');
run('list');
run('buy 馒头 x3');

// 强制打一架
const w = engine.world, p = w.player;
const npc = w.spawnNpc('mob_wolf', p.room, 1);
console.log('\n=== 战斗测试 ===');
const r = engine.exec('kill 灰狼');
r.lines.forEach(l => console.log('   [' + l.kind + '] ' + (l.text || '')));
let guard = 0;
while (engine.world.battle && guard++ < 30) {
  const cr = engine.combatAction('attack');
  cr.lines.forEach(l => console.log('   [' + l.kind + '] ' + (l.text || '')));
  if (cr.view.combat === null) break;
}
console.log('玩家 HP:', p.hp, '/', p.maxHp, 'EXP:', p.exp, '潜能:', p.potential);

// 采药 / 房间动作测试
run('n');
run('采药');

// 存档测试
console.log('\n=== 存档 ===');
console.log(JSON.stringify(engine.save('test_slot'), null, 1));
console.log(JSON.stringify(engine.listSaves(), null, 1));

// 编辑器元数据
const em = engine.editorMeta();
console.log('\n=== 编辑器元数据 ===');
console.log('attrs:', em.attrs.join(','), '| skills:', em.skills.length, '| items:', em.items.length, '| rooms:', em.rooms.length);

// mod 制作器编译测试
const spec = {
  meta: { id: 'test_mod', name: '测试模组', description: '测试用', category: '综合' },
  rooms: [{ id: 'test_room', name: '测试房间', region: 'wild', desc: '一间测试房。', exits: { s: 'jiangnan_street' } }],
  skills: [{ id: 'test_skill', name: '测试剑法', type: '剑', damageMult: 1.5 }],
  items: [{ id: 'test_item', name: '测试剑', type: 'weapon', slot: '武器', stats: { atk: 20 }, value: 100 }],
  npcs: [{ id: 'test_npc', name: '测试NPC', room: 'test_room', level: 10, hostile: true }],
  stories: [{ id: 'test_quest', name: '测试任务', desc: '一个测试任务', stages: [{ desc: '第一步', next: 99 }], rewards: [{ type: '+exp', args: [100] }] }],
};
const val = engine.validateSpec(spec);
console.log('\n=== Mod 校验 ===', JSON.stringify(val, null, 1));
const built = engine.buildModFiles(spec);
console.log('生成文件: mod.json 内 keys =', Object.keys(built.manifest).join(','));
engine.writeMod('test_mod', built.files);
console.log('写入后 mods:', engine.modLoader.mods.map(m => m.id + '(enabled=' + m.enabled + ')').join(', '));
engine.modSetEnabled('test_mod', true);
const w2 = engine.world;
console.log('测试房间存在?', !!w2.getRoom('test_room'), '| 测试剑法存在?', !!w2.getSkill('test_skill'), '| 测试物品存在?', !!w2.getItem('test_item'));
console.log('mod 加载问题:', JSON.stringify(engine.modProblems()));

console.log('\n=== ALL DONE ===');
