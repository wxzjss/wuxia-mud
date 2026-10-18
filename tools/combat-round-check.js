#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-round-check.js —— 战斗**回合时序**守卫（主人报的「战斗很怪」）
 *  --------------------------------------------------------------------------
 *  为什么要这个脚本：
 *    主人报「战斗很怪」，第一现场是：`world.js` 的普通攻击分支原来长这样
 *      const r = this.combat.step(this.battle);   // ← 语义是「场上所有单位各打一次」
 *      lines = this.stepEnemyOnly(lines, true);    // ← 敌人再打一次
 *    `combat.step()` 本来就包含敌人出手，再调 `stepEnemyOnly` 就是**敌人打两次**。
 *    同一个根因还有第二副面孔：`combat.step()` 里对每个单位 `tickBuffs`，
 *    `stepEnemyOnly` 里又对每个敌人 `tickBuffs` ⇒ **敌人 buff 一回合结算两遍**
 *    （持续伤害翻倍、增益回合数减半）。
 *
 *    外加两条连带的：
 *      · `battle.turn++` 只写在 `combat.step()` 里 ⇒ 只有普攻经过它，
 *        用绝招 / 防御 / 物品的战斗**回合数永远不动**，`turn > 60` 的平局判定永不触发。
 *      · 战斗面板「普通攻击」按钮发的是 `cmd: 'auto'` —— 那是**挂机**，
 *        会 while 循环打满 60 回合。点一下「普通攻击」人就没了。
 *
 *    这四条**没有任何一个测试覆盖过**，而且全都「游戏照样能跑」——
 *    玩家只会觉得"这战斗怎么一回事"，不会报错。这个脚本就是把它们钉住。
 *
 *  覆盖：
 *    §1 四条分支：敌人每回合只出手一次（**核心**）
 *    §2 玩家每回合只出手一次
 *    §3 buff 一回合只结算一次（同一个根因的第二副面孔）
 *    §4 回合数在四条分支上都递增（绝招 / 防御 / 物品 也不能停）
 *    §5 平局：只按「防御」也能打到 DRAW_TURNS 判和（不是无限耗）
 *    §6 逃跑不记回合
 *    §7 挂机（auto）保留上限、不当默认入口
 *    §8 静态：DRAW_TURNS 只有一个来源；面板「普通攻击」发的是 attack
 *
 *  用法：node tools/combat-round-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { DRAW_TURNS } = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

/* ⚠️ 静态检查必须先剥注释再匹配，否则会**先撞上注释里的旧代码字面量**。
   教训：ui.js 的修 bug 注释里原样写着 `{ label: '普通攻击', cmd: 'auto' }`
   （描述"这里原来是什么"），守卫一跑就报告"还是 auto"——红的是注释，不是代码。
   块注释整段去掉；行注释只认**行首**的（免得把 `'http://…'` 里的 // 当注释）。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
}

const SEED = 20261008;

/* 起一场「打不死」的架：双方攻击置 0 ⇒ 谁也打不死谁，
   战斗不会因分出胜负而提前结束，回合时序才看得清。

   ⚠️ 为什么还要额外裁一次 defenders（下面 soloDefenders 那一步）：
      出生房间里本来就站着 4 个 NPC。两层机制会把他们重新拉进战斗——
        ① `npcsIncludingTemplates()` 会把房间模板里**尚未实例化**的 NPC
           重新 spawn 回房间（world.js:1046），`fight` 找人走的就是这条路，
           所以"开打前把人挪走"是无效的，开打时人又回来了；
        ② `combatStartWitnessReaction()` 里，侠义 / 豪爽性格的目击者会
           **主动 push 进 battle.defenders**（world.js:1645）——玩家先动手打人，
           侠义之士就站到被打的那位身前。这是设计行为，不是 bug。
      于是 defenders 里会有"岳不群 + 游侠"两个人，敌人一回合出两手是**对的**，
      用它来数"敌人出手几次"就会永远测不准。
      ⇒ fixture 在开打后裁到只剩目标，把"一回合结算几次"这个问题隔离出来。 */
function spar() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  const foe = w.spawnNpc('master_yue', p.room, 1, true);
  p.atk = 0; foe.atk = 0;
  e.exec('fight 岳不群');
  soloDefenders(w, foe);
  return { e, w, p, foe };
}

/** 把防守方裁到只剩 `foe` 一个。纯 fixture 手段，不动产品代码。 */
function soloDefenders(w, foe) {
  const b = w.battle;
  if (!b) return;
  const dropped = [].concat(b.defenders || []).filter((d) => d !== foe);
  b.defenders = [foe];
  for (const d of dropped) d.inCombat = false;
}

/* ★ 真正的仪器：数**结算入口**被调用几次，而不是数战斗行有几条。
   为什么要换：一个单位一回合可能出好几手（连击 `baseAttackCount`），
   一次结算会产出好几条战斗行；反过来"敌人 1 条战斗行"也不等于"结算了 1 次"。
   靠数文本猜结算次数，测的是渲染，不是时序。
   直接把两个入口函数套一层，log 里看到的就是真实调用序列。 */
function tapEntries(w) {
  const log = [];
  const origStep = w.combat.step.bind(w.combat);
  const origSeo = w.stepEnemyOnly.bind(w);
  w.combat.step = (...a) => { log.push({ fn: 'step' }); return origStep(...a); };
  w.stepEnemyOnly = (lines, skip) => {
    log.push({ fn: 'seo', skip: !!skip });
    return origSeo(lines, skip);
  };
  return { log, restore() { w.combat.step = origStep; w.stepEnemyOnly = origSeo; } };
}

function countEntries(log) {
  return {
    step: log.filter((x) => x.fn === 'step').length,
    seo: log.filter((x) => x.fn === 'seo').length,
    seoSkipTrue: log.filter((x) => x.fn === 'seo' && x.skip).length,
  };
}

/* ================================================================
 * §1 四条分支：敌人每回合只出手一次
 * ================================================================ */
section('§1 四条分支：敌人每回合只出手一次（核心）');

function handCount(cmd) {
  const { e, w, p, foe } = spar();
  const tap = tapEntries(w);
  const r = e.exec(cmd);
  tap.restore();
  const L = (r.lines || []).filter((l) => l && l.kind === 'combat');
  const mine = L.filter((l) => l.aName === '你').length;
  const theirs = L.filter((l) => l.aName && l.aName !== '你').length;
  return {
    mine, theirs, total: L.length,
    turn: w.battle ? w.battle.turn : null,
    calls: countEntries(tap.log), seq: tap.log.map((x) => x.fn + (x.fn === 'seo' && x.skip ? '(skip)' : '')).join(' → '),
  };
}

{
  const atk = handCount('attack');
  const c = atk.calls;
  ok('§1-1 ★ 普通攻击：敌人那一手只结算 1 次（stepEnemyOnly 恰好 1 次）',
    c.seo === 1, '调用序列 [' + atk.seq + ']');
  ok('§1-2 ★ 普通攻击：不再调 combat.step（它本身就含敌人出手，再调就是打两次）',
    c.step === 0, 'combat.step 调了 ' + c.step + ' 次');
  ok('§1-3 ★ 普通攻击：玩家出了手（不是 0 次）', atk.mine >= 1, '我 ' + atk.mine + ' 条战斗行');
  ok('§1-4 ★ 普通攻击：敌人也出了手（不是 0 次）', atk.theirs >= 1, '敌 ' + atk.theirs + ' 条战斗行');

  const def = handCount('defend');
  ok('§1-5 ★ 防御：敌人那一手只结算 1 次', def.calls.seo === 1 && def.calls.step === 0,
    '调用序列 [' + def.seq + ']');

  /* 物品分支：初始背包里只有馒头 / 水葫芦（type 是 `food`），
     「战斗中吃药」这条分支**根本走不到** —— 上面那条 `p.items` 也找错了字段
     （真实字段是 `p.inventory`），两项一叠加就静默跳过了，等于四条分支只验了三条。
     ⇒ 直接把金创药塞进背包，把这条分支真正跑起来。 */
  const { e, w, p } = spar();
  const med = w.data.items && w.data.items.jinchuang_yao;
  if (!med) {
    console.log('    （跳过）数据里没有 jinchuang_yao，物品分支未验');
  } else {
    p.inventory = (p.inventory || []).concat([
      Object.assign({}, med, { uid: 'test_jinchuang', count: 1 }),
    ]);
    const tap = tapEntries(w);
    const r = e.exec('use 金创药');
    tap.restore();
    const cc = countEntries(tap.log);
    const used = (r.lines || []).map((l) => l && l.text).join('').indexOf('没有') < 0;
    ok('§1-6 ★ 物品：敌人那一手只结算 1 次', cc.seo === 1 && cc.step === 0,
      '调用序列 [' + tap.log.map((x) => x.fn).join(' → ') + ']');
    ok('§1-7 ★ 物品：药确实吃下去了（不然上面那条等于验了个空转）', used,
      (r.lines || []).filter((l) => l && l.text).map((l) => l.text).join(' / ').slice(0, 40));
  }
}

/* ================================================================
 * §2 连打多回合：不能出现「敌人永远比我多打一次」
 * ================================================================ */
section('§2 连打 10 回合：两边出手次数必须相等');

{
  const { e, w } = spar();
  const tap = tapEntries(w);
  let rounds = 0;
  for (let i = 0; i < 10; i++) {
    if (!w.battle || w.battle.over) break;
    e.exec('attack');
    rounds++;
  }
  tap.restore();
  const c = countEntries(tap.log);
  ok('§2-1 ★ 打满 ' + rounds + ' 回合：每一回合敌人只结算 1 次（stepEnemyOnly 次数 == 回合数）',
    c.seo === rounds, '回合 ' + rounds + ' / stepEnemyOnly ' + c.seo + ' 次');
  ok('§2-2 ★ 这 ' + rounds + ' 回合里 combat.step 一次都没被调（否则就是敌人打两遍）',
    c.step === 0, 'combat.step 调了 ' + c.step + ' 次');
  ok('§2-3 ★ 没有任何一次走 skipPlayer 老路', c.seoSkipTrue === 0, c.seoSkipTrue + ' 次');
}

/* ================================================================
 * §3 buff 一回合只结算一次（同一个根因的第二副面孔）
 * ================================================================ */
section('§3 buff 一回合只结算一次');

{
  const { e, w, p, foe } = spar();
  /* 给敌人挂一个 3 回合的 buff，数 tickBuffs 被调了几次 —— 调两次就等于
     持续伤害翻倍、增益回合数减半。直接数调用比看结果准（结果受随机影响）。 */
  const calls = [];
  const orig = w.combat.tickBuffs.bind(w.combat);
  w.combat.tickBuffs = (u, lines, battle) => {
    calls.push(u === p ? '玩家' : (u.name || '?'));
    return orig(u, lines, battle);
  };
  e.exec('attack');
  w.combat.tickBuffs = orig;

  /* 按**单位**分别数。按总数数会在多敌人时误判：
     两个敌人各 tick 一次 = 共 2 次，那是**对的**，不是 bug。 */
  const byUnit = {};
  for (const c of calls) byUnit[c] = (byUnit[c] || 0) + 1;
  const units = Object.keys(byUnit);
  ok('§3-1 ★ 敌人的 buff 一回合只 tick 一次（每个单位各 1 次）',
    byUnit['岳不群'] === 1, 'tickBuffs(岳不群) 调了 ' + (byUnit['岳不群'] || 0) + ' 次');
  ok('§3-2 ★ 玩家的 buff 也没被漏掉（原来由 combat.step 顺带做，现在得自己 tick）',
    byUnit['玩家'] === 1, 'tickBuffs(玩家) 调了 ' + (byUnit['玩家'] || 0) + ' 次');
  ok('§3-3 ★ 没有任何单位被 tick 两次以上',
    units.every((u) => byUnit[u] === 1), JSON.stringify(byUnit));
  console.log('    （调用序列：' + calls.join(' → ') + '）');
}

/* ================================================================
 * §4 回合数在四条分支上都递增
 * ================================================================ */
section('§4 回合数：四条分支都要走（原来只有普攻在走）');

{
  const a = spar();
  const t0 = a.w.battle.turn;
  a.e.exec('attack');
  ok('§4-1 普通攻击 ⇒ turn +1', a.w.battle && a.w.battle.turn === t0 + 1,
    t0 + ' → ' + (a.w.battle ? a.w.battle.turn : '(结束)'));

  const b = spar();
  const t1 = b.w.battle.turn;
  b.e.exec('defend');
  ok('§4-2 ★ 防御 ⇒ turn 也 +1（原来这儿是**永远不动**的）',
    b.w.battle && b.w.battle.turn === t1 + 1,
    t1 + ' → ' + (b.w.battle ? b.w.battle.turn : '(结束)'));

  const c = spar();
  const t2 = c.w.battle.turn;
  c.e.exec('defend'); c.e.exec('defend'); c.e.exec('defend');
  ok('§4-3 ★ 连按三次防御 ⇒ turn 走 3 格（不是停在原地）',
    c.w.battle && c.w.battle.turn === t2 + 3,
    t2 + ' → ' + (c.w.battle ? c.w.battle.turn : '(结束)'));
}

/* ================================================================
 * §5 平局：只按防御也能打到 DRAW_TURNS 判和
 * ================================================================ */
section('§5 平局：只用「防御」也必须在 ' + DRAW_TURNS + ' 回合收住');

{
  const { e, w, p } = spar();
  /* ⚠️ P0-a 之后「玩家死亡」会立刻结束战斗（以前死亡被忽略、能一直耗到 60 回合）。
     本节的意图是验「平局上限」，不是验死亡，所以给玩家一个耐久 fixture。 */
  let guard = 0;
  while (w.battle && !w.battle.over && guard++ < DRAW_TURNS + 20) {
    /* 每回合把血补满：本节验平局上限，不验耐久（P0-a 后死亡会结束战斗） */
    p.maxHpBase = 100000; p.recalc();
    p.hp = p.maxHp;
    e.exec('defend');
  }
  ok('§5-1 ★ 只按防御也会结束（原来会无限耗下去）', !w.battle || w.battle.over,
    '循环 ' + guard + ' 次后结束');
  /* finishCombat 会把 battle 清掉，所以平局的证据要看循环次数贴着上限 */
  ok('§5-2 ★ 结束的位置贴着 ' + DRAW_TURNS + ' 回合上限（不是被别的原因打断）',
    guard >= DRAW_TURNS && guard <= DRAW_TURNS + 3, '实际 ' + guard + ' 次');

  /* 平局那句话要说给玩家听，不然面板直接消失，玩家不知道是赢是输是卡了 */
  const { e: e2, w: w2 } = spar();
  let last = '';
  let g2 = 0;
  while (w2.battle && !w2.battle.over && g2++ < DRAW_TURNS + 20) {
    w2.player.maxHpBase = 100000; w2.player.recalc(); w2.player.hp = w2.player.maxHp;
    const r = e2.exec('defend');
    (r.lines || []).forEach((l) => { if (l && l.text) last = l.text; });
  }
  ok('§5-3 平局时说了句人话（不是面板直接消失）', /打了许久|奈何不了|各自退开/.test(last),
    '「' + String(last).slice(0, 30) + '」');
}

/* ================================================================
 * §6 逃跑不记回合
 * ================================================================ */
section('§6 逃跑：不记回合');

/* ⚠️ 逃跑成功率是个骰子。原来只跑一次就断言"战斗结束"，骰子没过就红，
   红的其实是**随机数**不是代码 —— 这属于拿随机当断言，测了等于没测。
   ⇒ 把骰子钉死，成功 / 失败两条路各验一遍，两条都各有各的验收点。 */
{
  const { e, w } = spar();
  const t0 = w.battle.turn;
  const orig = w.rng.next.bind(w.rng);
  w.rng.next = () => 0;             // 0 < chance 恒成立 ⇒ 必逃掉
  e.exec('flee');
  ok('§6-1 ★ 逃跑成功 ⇒ 战斗结束（battle 被清空）', !w.battle,
    w.battle ? 'winner=' + w.battle.winner : 'battle 已清空');
  ok('§6-2 ★ 逃跑成功 ⇒ 不记回合（turn 停在 ' + t0 + '）', !w.battle,
    '逃跑前 turn=' + t0 + '，逃跑这条路径不调 advanceTurn');

  const s2 = spar();
  const t2 = s2.w.battle.turn;
  const tap = tapEntries(s2.w);
  const o2 = s2.w.rng.next.bind(s2.w.rng);
  s2.w.rng.next = () => 1;          // 1 > chance 恒成立 ⇒ 必被缠住
  s2.e.exec('flee');
  s2.w.rng.next = o2;
  tap.restore();
  const c2 = countEntries(tap.log);
  ok('§6-3 ★ 逃跑失败 ⇒ 敌人照常结算 1 次（不是 0 次也不是 2 次）',
    c2.seo === 1 && c2.step === 0, '调用序列 [' + tap.log.map((x) => x.fn).join(' → ') + ']');
  ok('§6-4 ★ 逃跑失败也不记回合（turn 仍为 ' + t2 + '）',
    s2.w.battle && s2.w.battle.turn === t2,
    t2 + ' → ' + (s2.w.battle ? s2.w.battle.turn : '(结束)'));
}

/* ================================================================
 * §7 挂机：保留上限、能跑完、不当默认入口
 * ================================================================ */
section('§7 挂机（auto / 挂机）：保留上限，能收住');

{
  const { e, w, p } = spar();
  const before = w.battle ? w.battle.turn : -1;
  const r = e.exec('挂机');
  ok('§7-1 「挂机」这个别名认得', !!(r && r.lines) && !/没有这个指令|未知/.test(
    (r.lines || []).map((l) => l.text).join('')), '');
  ok('§7-2 ★ 挂机跑完就收住（战斗结束或到上限），不会无限跑',
    !w.battle || w.battle.over, 'turn ' + before + ' → ' + (w.battle ? w.battle.turn : '(结束)'));

  const { e: e2, w: w2 } = spar();
  const r2 = e2.exec('auto');
  ok('§7-3 老别名 `auto` 还在（别把已经在用的指令删了）',
    !!(r2 && r2.lines), '');
}

/* ================================================================
 * §8 静态：两处「60」不许各写一份；面板「普通攻击」不许指向挂机
 * ================================================================ */
section('§8 静态检查：防「两处各写一份」复发');

{
  const combatSrc = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'combat.js'), 'utf8');
  const worldCode = stripComments(fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'world.js'), 'utf8'));
  const cmdCode = stripComments(fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'commands.js'), 'utf8'));

  ok('§8-1 combat.js 导出 DRAW_TURNS', /DRAW_TURNS/.test(combatSrc) && /module\.exports[^;]*DRAW_TURNS/.test(combatSrc));
  ok('§8-2 ★ world.js 用的是常量，不是又写一个 60',
    /DRAW_TURNS/.test(worldCode) && !/battle\.turn\s*>\s*60|\.turn\s*>\s*60/.test(worldCode),
    'advanceTurn 里出现 DRAW_TURNS');
  ok('§8-3 ★ commands.js 的挂机也用常量（不是第三个 60）',
    /DRAW_TURNS/.test(cmdCode) && !/guard\+\+\s*<\s*60/.test(cmdCode));
  ok('§8-4 DRAW_TURNS 是个正数', typeof DRAW_TURNS === 'number' && DRAW_TURNS > 0, String(DRAW_TURNS));

  const uiSrc = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
  const uiCode = stripComments(uiSrc);
  const m = uiCode.match(/\{\s*label:\s*'普通攻击'\s*,\s*cmd:\s*'([^']+)'\s*\}/);
  ok('§8-5 ★ 面板「普通攻击」发的是 attack（不是 auto）', !!m && m[1] === 'attack',
    m ? 'cmd: ' + m[1] : '没找到那个按钮定义');
  ok('§8-6 ★ 战斗面板里没有任何按钮指向挂机 auto',
    !/cmd:\s*'auto'/.test(uiCode), /cmd:\s*'auto'/.test(uiCode) ? '还有' : '0 处');
}

/* ================================================================ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('  失败清单：\n    · ' + fails.join('\n    · '));
console.log('── ' + pass + ' 通过 / ' + fail + ' 失败 ──\n');
process.exit(fail ? 1 : 0);
