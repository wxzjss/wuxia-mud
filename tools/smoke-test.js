// 冒烟测试：启动引擎、创建角色、走几步、打一架、存档
const path = require('path');
const fs = require('fs');
const { GameEngine } = require('../game/src/core/engine');

const ROOT = path.resolve(__dirname, '..');

/* 隔离自检：开跑前先给仓库真实 mods/ 里的 mod.json 拍一张指纹，
   收尾时再看一次。**变了就 exit 1** —— 免得将来谁删掉上面那个 `modsDir`，
   本文件又变回那个「删一次、下次回归自动写回来」的自我复现 bug。
   （这条断言本身就是铁律的执行者：它守的不是"mod 能装"，是"装 mod 没弄脏仓库"。） */
const REAL_MOD = path.join(ROOT, 'mods', 'test_mod', 'mod.json');
const md5Of = (p) => {
  try { return require('crypto').createHash('md5').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) { return null; }
};
const realModBefore = md5Of(REAL_MOD);

/* 🔴 测试脚本不许写仓库真实目录 —— 项目铁律（2026-10-12，出处就是本文件）。
   原因：测试脚本会被回归收录规则 `^(smoke-.*|.*-check)\.js$` **自动反复执行**，
   写真实目录 = 造一个**自我复现的 bug**：你删一次，它下次跑回归自动写回来，
   而你和它都在自动跑，永远查不到对方身上。
   本文件就因为这个循环转了三轮：删 → 跑回归 → 被写回 → 再删（19:19/19:39/20:14/20:23）。
   三轮里我们先后怀疑过 git、怀疑过同事、怀疑过引擎 boot **全错了** ——
   真凶就是本文件的 `engine.writeMod('test_mod', …)` 写进了真实的 `mods/`。
   ⇒ 隔离目录用**项目内** `.livetest/`（.gitignore 第 8 行），不用系统临时目录。 */
const TMP = require('./_test-tmp').testTmpDir('smoke-mods');
fs.mkdirSync(TMP, { recursive: true });

/* 存档写进隔离沙盒，绝不碰玩家的 saves/（主人 bug B1）—— 见 tools/_test-save-dir.js */
const engine = new GameEngine({
  projectRoot: ROOT,
  saveDir: require('./_test-save-dir'),
  modsDir: TMP,           // ← 这一行就是三轮循环的句号：mod 写进 .livetest/，不写仓库 mods/
});
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
console.log(JSON.stringify(engine.save('smoke_test_slot', { _test: true }), null, 1));
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

/* ⑤ 隔离自检收尾：仓库真实 mod.json 的指纹必须与开跑前一致 */
{
  const after = md5Of(REAL_MOD);
  const okIso = after === realModBefore;
  console.log('\n=== 隔离自检（测试不许写仓库真实目录）===');
  console.log('  modsDir 用的是：' + TMP);
  console.log('  仓库 mods/test_mod/mod.json：跑前 ' + (realModBefore || '(不存在)')
    + ' → 跑后 ' + (after || '(不存在)'));
  console.log(okIso
    ? '  ✔ 未被本脚本写过 —— 隔离生效'
    : '  ✘ 被本脚本写脏了！修法：本文件的 engine 必须带 modsDir 指向隔离目录');
  if (!okIso) process.exit(1);
}

console.log('\n=== ALL DONE ===');
