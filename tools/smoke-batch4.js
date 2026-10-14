/**
 * smoke-batch4.js —— 主人亲报 bug 批次 4 专项回归（B10 / B11 / B12）
 *
 * B10 点 NPC / 野兽弹出菜单里没有「攻击」
 *   · 菜单里必须出现「攻击」，cmd 走**真实攻击指令** attack（批次 2 已并入 kill）
 *   · 敌对 / 已交战者：攻击排最前（优先）；寻常 NPC：照给，排最后（压误触）
 *   · ⚠️ 铁律 33：hostile 只用于**排序**，绝不当「不给攻击」的排除条件
 *   · 真 exec 一次「attack <名>」，必须真开打
 * B11 对毒蛇的第三人称描述用「他」而不是「它」
 *   · 兽（毒蛇）→「它」；女 →「她」；男 →「他」
 *   · edge：黑衣人（gender='other' 但是**人**）→「他」，不能叫「它」
 *   · favorite 详情里的性别：other →「不明」，不再是「男」
 * B12 被毒蛇击败后再回去，毒蛇名旁出现 x2
 *   · 复现：被毒蛇击败 → 回房 → 房里毒蛇实例数
 *   · 断言：反复进出，房里**活着的**毒蛇数恒为 1，房间描述不出现 x2
 *   · 断言：倒地（knockedOut）实例**仍保留、可搜身**（不因去重被删）
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真 e.exec('look' / 'attack …' / 'go …')
 *   · `new World()` 是空壳，必须走 GameEngine.boot()
 *   · 存档走独立沙盒（tools/_test-save-dir.js），不碰玩家 saves/
 *   · 不改 game/data/*.json（遭遇去重是运行期状态比对，不是改数据）
 */
'use strict';
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { pronounOf, genderNoun } = require(path.join(ROOT, 'game', 'src', 'core', 'pronouns.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
function boot() {
  const e = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e.boot();
  e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
}
const texts = r => (r.lines || []).map(l => l.text || '');
const allText = r => texts(r).join('\n');

/** 从房间 look 输出里取某个 NPC 的可点菜单项（hl） */
function hlOf(e, name) {
  const r = e.exec('look');
  const line = (r.lines || []).find(l => l.kind === 'npcs' && l.hl && l.hl.length);
  if (!line) return null;
  return line.hl.find(h => String(h.text || '').indexOf(name) === 0) || null;
}
const actionLabels = h => (h && h.actions ? h.actions.map(a => a.label) : []);
const findAct = (h, label) => (h && h.actions ? h.actions.find(a => a.label === label) : null);

/* ================================================================
 *  B10 · 菜单里必须能给「攻击」，且走真实攻击指令
 * ================================================================ */
section('B10 · NPC / 野兽菜单里的「攻击」');
{
  const e = boot(); const w = e.world, p = w.player;

  /* 敌对野兽（毒蛇）：一出生 hostile=true（模板常驻标记） */
  const snake = w.spawnNpc('mob_snake', p.room, 1, true);
  const sh = hlOf(e, '毒蛇');
  ok('B10-1 毒蛇菜单里出现「攻击」', !!findAct(sh, '攻击'));
  const sAct = findAct(sh, '攻击');
  eq('B10-2 攻击 cmd 走真实攻击指令 attack（批次2 已并入 kill）', sAct && sAct.cmd, 'attack 毒蛇');
  eq('B10-3 敌对者「攻击」排最前（优先给）', actionLabels(sh)[0], '攻击');

  /* 寻常 NPC（非敌对）：照给，但排最后 */
  let common = null;
  for (const id of Object.keys(w.data.npcs)) {
    const d = w.data.npcs[id];
    if (!d.hostile && !d.shop && !d.teach && (!d.quests || !d.quests.length) && d.gender) { common = id; break; }
  }
  const npc = w.spawnNpc(common, p.room, 1, true);
  const nh = hlOf(e, npc.name);
  ok('B10-4 寻常 NPC 菜单里也有「攻击」（不因非敌对而隐藏）', !!findAct(nh, '攻击'));
  eq('B10-5 寻常 NPC 的「攻击」排最后（压误触代价）', actionLabels(nh)[actionLabels(nh).length - 1], '攻击');

  /* ⚠️ 铁律 33：hostile 只是排序依据，绝不当排除条件 ——
     把山贼的 hostile 抹掉，攻击入口仍必须在。 */
  npc.hostile = false;
  const nh2 = hlOf(e, npc.name);
  ok('B10-6 铁律33：hostile=false 时「攻击」仍在（未被当排除条件）', !!findAct(nh2, '攻击'));

  /* 真 exec 一次 —— 攻击入口必须真能开打 */
  const r = e.exec('attack 毒蛇');
  ok('B10-7 真 exec「attack 毒蛇」→ 真开打',
    !!w.battle && w.battle.target && w.battle.target.name === '毒蛇',
    'battle=' + (w.battle ? w.battle.target.name : 'null'));
  ok('B10-8 开打输出含「发起了攻击」', /发起了攻击/.test(allText(r)));
  w.battle = null; w.player.inCombat = false;   // 收尾，别污染后续用例
}

/* ================================================================
 *  B11 · 第三人称代词（他 / 她 / 它）
 * ================================================================ */
section('B11 · 代词单一入口（真看 NPC）');
{
  const e = boot(); const w = e.world, p = w.player;

  w.spawnNpc('mob_snake', p.room, 1, true);       // other + 兽 → 它
  w.spawnNpc('emei_miejue', p.room, 1, true);      // female → 她
  w.spawnNpc('mob_assassin', p.room, 1, true);     // other + 人 → 他（关键 edge）

  const tSnake = allText(e.exec('look 毒蛇'));
  ok('B11-1 毒蛇武学行用「它习有」', tSnake.indexOf('它习有：') >= 0);
  ok('B11-2 毒蛇不再出现「他习有」', tSnake.indexOf('他习有：') < 0);
  ok('B11-3 毒蛇看不透提示用「它」', /看不出它究竟练到了哪一步/.test(tSnake));

  const tFemale = allText(e.exec('look 灭绝师太'));
  ok('B11-4 女 NPC 武学行用「她习有」', tFemale.indexOf('她习有：') >= 0);

  const tAssassin = allText(e.exec('look 黑衣人'));
  ok('B11-5 edge：黑衣人(gender=other 的人) 用「他习有」，不叫「它」',
    tAssassin.indexOf('他习有：') >= 0 && tAssassin.indexOf('它习有：') < 0);

  /* 代词 / 性别的单一入口矩阵（含边界） */
  eq('B11-6 pronounOf(male)=他', pronounOf({ gender: 'male' }), '他');
  eq('B11-7 pronounOf(female)=她', pronounOf({ gender: 'female' }), '她');
  eq('B11-8 pronounOf(毒蛇 other/兽)=它', pronounOf(w.data.npcs.mob_snake), '它');
  eq('B11-9 pronounOf(黑衣人 other/人)=他', pronounOf(w.data.npcs.mob_assassin), '他');
  eq('B11-10 genderNoun(other)=不明', genderNoun({ gender: 'other' }), '不明');

  /* favorite 详情：毒蛇的性别不再被写成「男」 */
  const fSnake = allText(e.exec('favor 毒蛇'));
  const idLine = fSnake.split('\n').find(t => t.indexOf('身份：') >= 0) || '';
  ok('B11-11 毒蛇 favor 详情性别显示「不明」（旧实现会显示「男」）',
    idLine.indexOf('不明') >= 0 && idLine.indexOf('男') < 0, idLine.trim());
}

/* ================================================================
 *  B12 · 被毒蛇击败后再回去，毒蛇 x2
 * ================================================================ */
section('B12 · 遭遇去重（击败后回房不再叠同名）');
{
  const e = boot(); const w = e.world, p = w.player;

  /* 找一个含 mob_snake 的遭遇房 + 一个无遭遇的邻居 */
  let target = null, neighbor = null;
  for (const rid of Object.keys(w.data.rooms)) {
    const r = w.data.rooms[rid];
    if (!r.encounter || !(r.encounter.npcs || []).includes('mob_snake')) continue;
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.data.rooms[tid];
      if (tr && !tr.encounter) { target = rid; neighbor = tid; break; }
    }
    if (target) break;
  }
  ok('B12-0 找到「毒蛇遭遇房 + 无遭遇邻居」用于复现', !!target && !!neighbor,
    `room=${target} neighbor=${neighbor}`);

  const room = w.data.rooms[target];
  room.encounter.chance = 1;            // 让遭遇必定触发（内存态，不改文件）
  room.encounter.npcs = ['mob_snake'];  // 只滚毒蛇，专测同名叠加

  const snakes = () => Object.values(w.instances.npcs).filter(n => n.room === target && n.name === '毒蛇');
  const alive = () => snakes().filter(n => !n.dead).length;

  w.movePlayerTo(p, neighbor);
  const perEntry = [];
  for (let i = 0; i < 3; i++) {
    p.hp = p.maxHp;                     // 每次满血进场
    e.exec('go ' + w.data.rooms[target].name);
    perEntry.push(alive());
    /* 被毒蛇击败：血量归零 → 走真实战斗回合（auto）触发死亡 + 复活回客栈 */
    if (p.room === target) { p.hp = 0; e.exec('auto'); }
  }
  ok('B12-1 反复进出，房里活着的毒蛇恒为 1（不再叠到 2/3…）',
    perEntry.every(n => n === 1), 'perEntry=' + JSON.stringify(perEntry));

  /* 主人看到的症状：名字旁 x2。回房后真 look 一次，确认不再出现 */
  p.hp = p.maxHp;
  e.exec('go ' + w.data.rooms[target].name);
  const lookAfter = e.exec('look');
  const npcLine = (lookAfter.lines || []).map(l => l.text || '').find(t => t.indexOf('这里有：') >= 0) || '';
  /* 不计较具体是 x2/x3/x4 —— 只要毒蛇名后跟出「… xN」就算叠加症状复现。
     （名字后带身份「毒蛇（山中猛兽） x4」，所以中间允许夹身份括号） */
  ok('B12-2 回房后房间描述里没有「毒蛇… xN」叠加', !/毒蛇[^、。]*x\d/.test(npcLine), npcLine.trim());
  eq('B12-3 回房后活体毒蛇数仍为 1', alive(), 1);
}

/* ---- B12 反向：倒地实例是玩法的一部分，不能被去重逻辑删掉 ---- */
section('B12 · 倒地实例保留（补刀/搜身/装袋不受影响）');
{
  const e = boot(); const w = e.world, p = w.player;

  let target = null, neighbor = null;
  for (const rid of Object.keys(w.data.rooms)) {
    const r = w.data.rooms[rid];
    if (!r.encounter || !(r.encounter.npcs || []).includes('mob_snake')) continue;
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (w.data.rooms[tid] && !w.data.rooms[tid].encounter) { target = rid; neighbor = tid; break; }
    }
    if (target) break;
  }
  const room = w.data.rooms[target];
  room.encounter.chance = 1; room.encounter.npcs = ['mob_snake'];

  /* 造一条「倒地」（knockedOut + dead，与 onNpcDown 同构）的毒蛇 */
  const downed = w.spawnNpc('mob_snake', target, 1, true);
  downed.knockedOut = true; downed.dead = true; downed.hp = 0;

  w.movePlayerTo(p, neighbor);
  e.exec('go ' + w.data.rooms[target].name);

  const stillDowned = w.downedIn(target).filter(n => n.name === '毒蛇').length;
  eq('B12-4 倒地毒蛇实例仍在（可被 downedIn 查到，供搜身/补刀）', stillDowned, 1);
  ok('B12-5 同房至多 1 条活体毒蛇（倒地者不参与计数）',
    w.npcsIn(target).filter(n => n.name === '毒蛇').length <= 1);

  /* 且倒地者可搜身：downedIn 拿到的正是那条实例 */
  ok('B12-6 倒地实例仍挂在该房间', downed.room === target && downed.knockedOut === true);
}

/* ================================================================
 * B12-bis · 任何 NPC 都不合并（主人钦定 2026-10-17）
 *   「山贼×2 也拆成两行（山贼、山贼各占一行）」——旧口径「同名 xN 并一行」撤。
 *   断言：同房两个同名实例 → look 的「这里有：」行无 xN 计数、
 *   名字出现两次（两个实例各占一个 hl，逐处可点）。
 * ================================================================ */
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 找一个可重复 spawn 的普通 def（非名人 unique/tierA、非 noWander），连开两个实例放同房 */
  const defId = Object.keys(w.data.npcs).find(id => {
    const d = w.data.npcs[id];
    return d && d.unique !== true && d.tier !== 'A' && !d.noWander && d.name && !d.hostile;
  });
  w.spawnNpc(defId, p.room, 1, true);
  w.spawnNpc(defId, p.room, 1, true);
  const nm = w.data.npcs[defId].name;
  const r = e.exec('look');
  const line = (r.lines || []).find(l => l.kind === 'npcs' && l.text && l.text.indexOf('这里有：') === 0);
  ok('B12-bis 「这里有：」行存在', !!line);
  if (line) {
    ok('B12-bis 不出现 xN 合并计数', !/ x\d+/.test(line.text), line.text);
    const cnt = line.text.split(nm).length - 1;
    ok('B12-bis 同名实例逐个列出（名字出现两次）', cnt >= 2, `「${nm}」出现 ${cnt} 次：` + line.text);
    ok('B12-bis hl 逐实例可点（同名条目每处都注册）',
      line.hl && line.hl.filter(h => (h.text || '').indexOf(nm) === 0).length >= 2);
  }
}

/* ================================================================ */
console.log('\n———————————————————————————————');
console.log(`  批次4 回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('———————————————————————————————');
process.exitCode = fail ? 1 : 0;
