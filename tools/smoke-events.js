/**
 * smoke-events.js —— B21 基础事件系统专项回归
 *
 * 背景（主人实机复现）：`60_quests.json` 里 onKill / onLevelUp / onEnter / onTick
 * 四条基础事件**全部静默失效**——击杀后 6% 掉「武学残页」、3% +50 潜能都不发生，
 * 升级 ≥5 的提示也没有。
 *
 * 根因（两处，都在引擎侧）：
 *   ① `mergeData` 的 byId 分支用 `Object.assign({ id }, entry)` 处理**数组值**，
 *      把 `{ onKill:[h0,h1] }` 揉成 `{ onKill:{id:'onKill',0:h0,1:h1} }`——
 *      数组类型被毁，handler 的 `cond`/`effects` 全丢；`fireEvent` 又用
 *      `[].concat(壳对象)` 只迭代一次 → 0 效果执行。【本次修复】
 *   ② `character.gainExp()` 升级时只 `emit('levelup')`，而该事件**全仓零监听**，
 *      且没有任何地方调用 `fireEvent('onLevelUp')` → onLevelUp 永远不触发。
 *      【本次修复：world 构造器里把 levelup 转成 fireEvent('onLevelUp')】
 *
 * 铁律遵守：
 *   · 断言打在**真实调用路径**上：
 *       - onKill   ：真 startCombat + 真 combat.step 打死一只野兽（走 combat.onDeath
 *                    → onNpcKilled → fireEvent('onKill')），真读背包。
 *       - onLevelUp：真 p.gainExp() 升级 → 真 say。
 *       - onTick   ：真 w.advanceTime(30) 跨过 worldTick → 真 say。
 *       - onEnter  ：真 w.movePlayerTo() → 真 handler。
 *   · 固定 seed；chance 条件调成 1 保证「必然命中」（另一组再跑原始概率 300 次）。
 *   · 不用恒真断言、不用静态 grep 当断言。
 *   · `new World()` 是空壳（只有 data + 合并/事件骨架）；真跑要用 GameEngine.boot()。
 *
 * ⚠ 已知遗留（不在 B21 范围内，报告里另有记录）：
 *   `storyline` 这个事件**产品侧没有任何消费者**（全仓只有 tools/ 的 smoke 在监听）。
 *   所以本文件**自己监听 storyline** 来验证 handler 的 say 确实执行了——
 *   这是合法的「工具即消费者」，与 smoke-ecology / smoke-kinsman-witness 同款。
 *   但「产品 UI 看不到这些 say」是另一个独立缺口，需另行接线。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { World } = require(path.join(ROOT, 'game', 'src', 'core', 'world.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
}
/** 采集世界抛出的 storyline 台词（工具即消费者，见文件头 ⚠ 注）。 */
function collect(w) {
  const lines = [];
  w.on('storyline', ev => { if (ev && ev.line) lines.push(ev.line.text || ''); });
  return lines;
}
/**
 * 真打一场并杀掉一只野兽。
 * `mob_wolf`（灰狼）名字含「狼」→ combat.onDeath 走「野兽直接死」分支 →
 * `w.onNpcKilled` → `fireEvent('onKill')`。玩家调成打不烂，避免被狼反杀。
 */
function realKill(w) {
  const p = w.player;
  p.maxHp = 1e9; p.hp = 1e9; p.maxMp = 1e9; p.mp = 1e9;
  const n = w.spawnNpc('mob_wolf', p.room, 1, true);
  n.hp = 1; n.maxHp = 1;
  w.startCombat(p, n);
  let guard = 0;
  while (w.battle && !w.battle.over && guard++ < 60) w.combat.step(w.battle);
  p.hp = p.maxHp; p.mp = p.maxMp;
  return n;
}

/* ================================================================
 * 0 · 事件容器形态（回归守卫：防止将来又被人揉成对象）
 * ================================================================ */
section('0 · 事件容器形态（回归守卫：四个键必须存在且都是数组）');
{
  const w = boot().world;
  const ev = w.data.events;
  ok('0.1 data.events 是对象（不是数组）', ev && typeof ev === 'object' && !Array.isArray(ev));
  for (const k of ['onKill', 'onLevelUp', 'onEnter', 'onTick']) {
    ok(`0.2 ${k} 存在且是数组`, Array.isArray(ev[k]),
      `Array.isArray=${Array.isArray(ev[k])} typeof=${typeof ev[k]}`);
  }
  eq('0.3 onKill 条数=2（残页 6% + 感悟 3%）', ev.onKill.length, 2);
  eq('0.4 onLevelUp 条数=1', ev.onLevelUp.length, 1);
  eq('0.5 onTick 条数=1', ev.onTick.length, 1);
  eq('0.6 onEnter 条数=0（原始就是空数组，也要保持数组）', ev.onEnter.length, 0);
  const k0 = (Array.isArray(ev.onKill) && ev.onKill[0]) || {};
  ok('0.7 onKill[0] 有 effects 数组，且首条是 say',
    Array.isArray(k0.effects) && !!(k0.effects[0] && k0.effects[0].type === 'say'));
  ok('0.8 onKill[0].cond.chance 保真 = 0.06（内容没被揉丢）',
    !!(k0.cond && k0.cond.chance === 0.06),
    `chance=${k0.cond && k0.cond.chance}`);
  ok('0.9 数组值没有被 byId 的 id/__source 污染',
    !('__source' in ev.onKill) && !('id' in ev.onKill)
    && !('__source' in ev.onEnter) && !('id' in ev.onEnter),
    `onKill keys=${Object.keys(ev.onKill)}`);
}

/* ================================================================
 * 1 · mergeData 通用修复：数组值保持数组（不是给 events 打特例）
 * ================================================================ */
section('1 · mergeData 通用：数组值一律保持数组，对象值才走 byId');
{
  const w = new World({ dataDirs: [], modDirs: [] });
  w.mergeData({
    events: { onKill: [{ cond: { chance: 0.5 }, effects: [{ type: 'say', raw: 'A' }] }], onEnter: [] },
    items: { sword: { id: 'sword', name: '剑' } },
    myCustomMap: { list: [1, 2, 3], obj: { id: 'x', v: 1 } },   // 任意新顶层键
  }, { name: 'unit-test', base: true });

  const h = (v, i) => (Array.isArray(v) && v[i]) || {};   // 安全取下标（揉坏时返回 {}，让断言判红而不是抛错）
  ok('1.1 events.onKill 是数组', Array.isArray(w.data.events.onKill));
  eq('1.2 events.onKill 长度=1', w.data.events.onKill.length, 1);
  ok('1.3 handler 内容保真（effects[0].raw=A）',
    !!((h(w.data.events.onKill, 0).effects || [])[0] && (h(w.data.events.onKill, 0).effects || [])[0].raw === 'A'));
  ok('1.4 空数组 events.onEnter 也保持数组',
    Array.isArray(w.data.events.onEnter) && w.data.events.onEnter.length === 0);
  ok('1.5 任意新顶层键里的数组字段也保持数组（myCustomMap.list）',
    Array.isArray(w.data.myCustomMap.list));
  eq('1.6 任意新顶层键里的数组内容保真', JSON.stringify(w.data.myCustomMap.list), JSON.stringify([1, 2, 3]));
  ok('1.7 对象值仍走 byId entry 合并', !!(w.data.items.sword && w.data.items.sword.name === '剑'));
  eq('1.8 对象值仍打 __source（溯源不受影响）', w.data.items.sword.__source, 'unit-test');
  ok('1.9 数组值不打 __source / id',
    !('__source' in w.data.events.onKill) && !('__source' in w.data.myCustomMap.list));
}

/* ================================================================
 * 1b · 数组合并遵守 arrayMode（与 deepMerge 全局规则一致）
 * ================================================================ */
section('1b · 数组合并遵守 arrayMode（默认 replace / 可 append）');
{
  const mk = () => {
    const w = new World({ dataDirs: [], modDirs: [] });
    w.mergeData({ events: { onKill: [{ cond: { chance: 1 }, effects: [{ type: 'say', raw: 'base' }] }] } },
      { name: 'base', base: true });
    return w;
  };
  let w = mk();
  w.mergeData({ events: { onKill: [{ cond: { chance: 1 }, effects: [{ type: 'say', raw: 'mod' }] }] } }, { name: 'mod' });
  const h = (v, i) => (Array.isArray(v) && v[i]) || {};
  eq('1b.1 默认 replace：长度不变', w.data.events.onKill.length, 1);
  ok('1b.2 默认 replace：内容是后者的',
    !!((h(w.data.events.onKill, 0).effects || [])[0] && (h(w.data.events.onKill, 0).effects || [])[0].raw === 'mod'));

  w = mk();
  w.mergeData({ events: { onKill: [{ cond: { chance: 1 }, effects: [{ type: 'say', raw: 'mod' }] }] } },
    { name: 'mod', arrayMode: 'append' });
  eq('1b.3 append：长度累加', w.data.events.onKill.length, 2);
  ok('1b.4 append：顺序 base → mod（末条=mod）',
    !!((h(w.data.events.onKill, 1).effects || [])[0] && (h(w.data.events.onKill, 1).effects || [])[0].raw === 'mod'));
  ok('1b.5 append 后仍是数组', Array.isArray(w.data.events.onKill));
}

/* ================================================================
 * 2 · onKill 真触发（真战斗 → 真掉物品）
 * ================================================================ */
section('2 · onKill 真触发（真打死一只狼 → 背包真多出「武学残页」）');
{
  const e = boot(); const w = e.world, p = w.player;
  const lines = collect(w);
  // 固定 seed + 把两条 handler 的 chance 调成 1 → 「必然命中」
  const h = i => (Array.isArray(w.data.events.onKill) && w.data.events.onKill[i]) || {};
  for (const i of [0, 1]) if (h(i).cond) h(i).cond.chance = 1;
  p.inventory = [];
  const potBefore = p.potential;
  const wolf = realKill(w);

  ok('2.1 那只狼确实死了（死因是 combat.onDeath→onNpcKilled）', wolf.dead === true && wolf.hp <= 0,
    `dead=${wolf.dead} hp=${wolf.hp}`);
  ok('2.2 背包**真的**出现 manuscript_page（武学残页）',
    p.inventory.some(it => it.id === 'manuscript_page'),
    `inventory=[${p.inventory.map(i => i.id).join(',')}]`);
  ok('2.3 say 台词真的执行（h0：翻找残页）', lines.some(t => t.includes('武学残页')), JSON.stringify(lines));
  ok('2.4 say 台词真的执行（h1：莫名感悟）', lines.some(t => t.includes('一阵莫名的感悟')), JSON.stringify(lines));
  ok('2.5 +pot 真的结算（潜能净增 ≥ 50）', p.potential - potBefore >= 50, `Δpot=${p.potential - potBefore}`);
  ok('2.6 +pot 的系统行真的输出', lines.some(t => t.includes('你增长了 50 点潜能')), JSON.stringify(lines));

  /* 2b · 不调 chance，走**原始 6% 概率**：真 fireEvent 路径循环足够多次必然命中 */
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  for (let i = 0; i < 300; i++) w2.fireEvent('onKill', {});
  ok('2b 原始概率(0.06) 下 300 次 fireEvent 至少掉 1 页',
    p2.countItem('manuscript_page') >= 1, `count=${p2.countItem('manuscript_page')}`);
}

/* ================================================================
 * 3 · onLevelUp 真触发（真升级 → 真有那句 say）
 * ================================================================ */
section('3 · onLevelUp 真触发（真 gainExp 升级 → 真有那句 say）');
{
  const e = boot(); const w = e.world, p = w.player;
  const lines = collect(w);
  // 负例：等级不够时（cond level>=5 不成立）不该有
  w.fireEvent('onLevelUp', {});
  ok('3.1 等级 1 时 onLevelUp 不触发（cond level>=5 不成立）',
    !lines.some(t => t.includes('功力又深了一层')), JSON.stringify(lines));
  // 正例：真升级
  const before = p.level;
  p.gainExp(1000000);
  ok('3.2 真 gainExp 后等级 ≥5', p.level >= 5, `level ${before}→${p.level}`);
  ok('3.3 升级**真的**触发了 onLevelUp 的那句 say',
    lines.some(t => t.includes('功力又深了一层')), JSON.stringify(lines));
}

/* ================================================================
 * 4 · onTick 真触发（真 advanceTime → 真 say）
 * ================================================================ */
section('4 · onTick 真触发（真 advanceTime 跨过 worldTick → 真 say）');
{
  const e = boot(); const w = e.world, p = w.player;
  const lines = collect(w);
  // 原始 handler 的 cond = {chance:0.02, flag:'not_random_event'}
  ok('4.1 前置事实：flag「not_random_event」默认没人设（原始数据里只被条件引用）',
    !p.hasFlag('not_random_event'));
  const tk = (Array.isArray(w.data.events.onTick) && w.data.events.onTick[0]) || {};
  if (tk.cond) tk.cond.chance = 1;              // 去掉随机，保证必然命中
  p.setFlag('not_random_event', true);          // 补上数据里要求的 flag 条件
  w.advanceTime(30);                            // tickCounter>=30 → worldTick() → fireEvent('onTick')
  ok('4.2 advanceTime 后 onTick 的 say 真的输出', lines.some(t => t.includes('马蹄声')), JSON.stringify(lines));
}

/* ================================================================
 * 5 · onEnter 真触发（真 movePlayerTo → 真 handler）
 * ================================================================ */
section('5 · onEnter 真触发（真 movePlayerTo → 真 handler 执行）');
{
  const e = boot(); const w = e.world, p = w.player;
  const lines = collect(w);
  ok('5.1 前置：data.events.onEnter 是空数组（且类型没被毁）',
    Array.isArray(w.data.events.onEnter) && w.data.events.onEnter.length === 0);
  // 注入一条哨兵 handler，证明「移动 → onEnter」链路真的通
  if (Array.isArray(w.data.events.onEnter)) {
    w.data.events.onEnter.push({ cond: { always: true }, effects: [{ type: 'say', raw: '【哨兵】你踏入了新的所在。' }] });
  }
  const other = Object.keys(w.data.rooms).find(r => r !== p.room);
  const r = w.movePlayerTo(p, other);
  ok('5.2 movePlayerTo 成功', !!(r && r.ok), JSON.stringify(r));
  ok('5.3 onEnter 的 handler 真的执行了（哨兵 say 输出）', lines.some(t => t.includes('【哨兵】')), JSON.stringify(lines));
}

/* ================================================================
 * 6 · 新增 worldEvents 顶层键：能否安全合并（W5 事件库前置）
 * ================================================================ */
section('6 · 新增 worldEvents 顶层键安全合并（W5 事件库前置验证）');
{
  const w = new World({ dataDirs: [], modDirs: [] });
  w.mergeData({ worldEvents: { onDayTick: [{ cond: { always: true }, effects: [{ type: 'say', raw: 'w5' }] }] } },
    { name: 'w5-world', base: true });
  ok('6.1 worldEvents.onDayTick 是数组（没被揉成对象）',
    Array.isArray(w.data.worldEvents.onDayTick),
    `Array.isArray=${Array.isArray(w.data.worldEvents.onDayTick)}`);
  eq('6.2 handler 内容保真', w.data.worldEvents.onDayTick[0].effects[0].raw, 'w5');
  // 基础数据 + mod 二次合并（append）
  w.mergeData({ worldEvents: { onDayTick: [{ cond: { always: true }, effects: [{ type: 'say', raw: 'w5b' }] }] } },
    { name: 'w5-mod', arrayMode: 'append' });
  eq('6.3 append 后长度=2', w.data.worldEvents.onDayTick.length, 2);
  ok('6.4 append 后仍是数组', Array.isArray(w.data.worldEvents.onDayTick));
  console.log('  ℹ 现状记录：`fireEvent(name)` 目前只读 `this.data.events[name]`，');
  console.log('     不读 `this.data.worldEvents`。⇒ W5 落地时需补一行：');
  console.log('     `handlers = data.events[name] || (data.worldEvents && data.worldEvents[name]) || []`。');
}

/* ================================================================
 * 汇总
 * ================================================================ */
console.log('\n==============================================');
console.log(`  B21 事件系统 smoke：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('  失败项：'); for (const f of fails) console.log('   - ' + f); }
console.log('==============================================');
process.exit(fail ? 1 : 0);
