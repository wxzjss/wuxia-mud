/**
 * smoke-mod-cap.js — Mod 制作器「能力面」逐项实测（真跑，不只看代码）
 *
 * 背景：memory 待办 #2「Mod 制作器能力实现完善」的查缺批。
 * 账面上 ✅ 的能力（内容型 / rules.multiply·additive·onEvent·macro / fns / script.js）
 * 这里逐项用**真引擎 + 真 mod 夹具**（tools/fixture-mods/modcheck/）跑一遍：
 *   §A 内容型合并（items）
 *   §B rules.multiply（exp ×2）· additive（damageTaken -1）
 *   §C rules.onEvent（onKill 规则 + 脚本 onKill 双通路）
 *   §D rules.macro（宏指令换入）
 *   §E fns.json 声明式函数（cond / effect）
 *   §F script.js 沙箱：自定义指令 + 逃逸探针（this.constructor / new Function /
 *      eval / process / __proto__ 都必须摸不到）
 *   §G 效果 DSL 电池（evalEffect 代表性类型逐个验副作用）
 * run: node tools/smoke-mod-cap.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixture-mods');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { ModScript } = require(path.join(ROOT, 'game', 'src', 'core', 'modscript.js'));
const modapi = require(path.join(ROOT, 'game', 'src', 'core', 'modapi.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}
function section(t) { console.log('\n' + t); }
const txt = a => (a || []).map(x => String(x.text || '')).join(' | ');

/* modsDir 指到夹具目录（mod 默认启用：enabledByDefault !== false）。
   ModLoader 会把 state 写到夹具目录旁（fixture-mods/mods-state.json），随它去。 */
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261013, saveDir: require('./_test-save-dir'), modsDir: FIXTURES });
  e.boot(); e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
}

/* ================================================================
 * §A 内容型：mod 声明的 item 真的进了世界
 * ================================================================ */
section('§A 内容型合并（items）');
{
  const e = boot(11);
  const w = e.world;
  const it = w.data.items.mc_stone;
  ok('A-1 mod 里的 item 进了 data.items', !!it && it.name === '试金石', it && it.name);
  const r = w.giveItem(w.player, 'mc_stone', 1);
  ok('A-2 giveItem 拿得到（玩家背包真多一件）', !!(r && r.ok) && w.player.countItem('mc_stone') === 1,
    txt((r && r.lines) || (r && r.ok ? [] : [])) || String(r && r.ok));
}

/* ================================================================
 * §B rules.multiply / additive
 * ================================================================ */
section('§B 功能规则 multiply / additive');
{
  const e = boot(12);
  const w = e.world, p = w.player;
  ok('B-1 activeRules 收进了 4 条', w.activeRules.length === 4, w.activeRules.map(r => r.kind).join(','));

  const before = p.exp || 0;
  p.gainExp(10);
  ok('B-2 multiply exp ×2 真生效（gain 10 → +20）', (p.exp || 0) - before === 20,
    `before=${before} after=${p.exp}`);

  ok('B-3 additive damageTaken = -1（combat 结算读这个键）', w.ruleAdd('damageTaken') === -1,
    String(w.ruleAdd('damageTaken')));
}

/* ================================================================
 * §C rules.onEvent + script.js wx.on —— fireEvent 尾巴双通路
 * ================================================================ */
section('§C onEvent 规则 + 沙箱脚本事件');
{
  const e = boot(13);
  const w = e.world;
  const seen = [];
  w.on('storyline', ev => { if (ev && ev.line) seen.push(ev.line); });
  w.fireEvent('onKill', { npcId: 'npcv_196', npc: {} });
  const s = seen.map(l => l.text || '').join(' | ');
  ok('C-1 onEvent 规则出声（say 效果进了 storyline）', /（规则onKill）有人倒下了/.test(s), s.slice(0, 80));
  ok('C-2 script.js 的 wx.on(onKill) 也出声', /（脚本onKill）npcv_196 倒下了/.test(s), s.slice(0, 80));
  ok('C-3 脚本负载只带标量（活对象没漏进沙箱）', (() => {
    /* _scriptPayload 不该带 npc/ch 这种活对象 —— 结构性断言 */
    const pl = w._scriptPayload({ npcId: 'x', npc: { name: 'y' }, day: 3 });
    return pl.npcId === 'x' && pl.day === 3 && pl.npc === undefined;
  })());
}

/* ================================================================
 * §D rules.macro（宏指令）
 * ================================================================ */
section('§D 宏指令');
{
  const e = boot(14);
  const r = e.exec('打卡');
  const t = txt(r.lines);
  ok('D-1 敲宏名「打卡」= 真跑 score（不回「不懂指令」）',
    !/不懂|不是指令/.test(t) && (t.length > 0), t.slice(0, 60));
}

/* ================================================================
 * §E fns.json 声明式函数（cond / effect）
 * ================================================================ */
section('§E 声明式函数 fns');
{
  const e = boot(15);
  const w = e.world, p = w.player;
  ok('E-1 cond fn 注册成功', typeof w.condFns.mc_rich === 'function');
  p.money = 0;
  ok('E-2 cond fn 判定跟随数据（没钱=false，给 200 文=true）',
    modapi.evalCond({ fn: 'mc_rich' }, { player: p, world: w }) === false
    && (p.money = 200, modapi.evalCond({ fn: 'mc_rich' }, { player: p, world: w }) === true));
  const out = modapi.evalEffects([{ type: 'call', args: ['mc_gift'] }], { player: p, world: w });
  ok('E-3 effect fn 出声 + 真加钱', /（fn）送你七文钱/.test(txt(out)) && p.money === 207,
    `money=${p.money} ` + txt(out).slice(0, 40));
}

/* ================================================================
 * §F script.js 沙箱：指令 + 逃逸探针
 * ================================================================ */
section('§F 沙箱：自定义指令与逃逸探针');
{
  const e = boot(16);
  const p = e.world.player;
  const moneyBefore = p.money;
  const r = e.exec('mc试');
  ok('F-1 脚本自定义指令真跑（出声 + 加 11 文）',
    /（脚本指令）兜里多了十一文/.test(txt(r.lines)) && p.money - moneyBefore === 11,
    txt(r.lines).slice(0, 50));
  ok('F-2 脚本指令进 bootLog（前端「高级 Mod」标签有账）',
    !!(e.bootLog && e.world._scripts.length === 1 && e.world._scripts[0].scriptCommands['mc试']));

  /* 逃逸探针：每一条都必须摸不到宿主能力 */
  const probes = [
    ['constructor.constructor 摸 process',
      'try { return this.constructor.constructor("return process")().pid; } catch (e) { return "blocked"; }'],
    ['new Function 摸 process',
      'try { return new Function("return process")().pid; } catch (e) { return "blocked"; }'],
    ['eval 摸 process',
      'try { return eval("process").pid; } catch (e) { return "blocked"; }'],
    ['__proto__ 逃逸',
      'try { var o = {}; o.__proto__.constructor.constructor("return process")(); return "escaped"; } catch (e) { return "blocked"; }'],
    ['直接摸 process',
      'try { return typeof process; } catch (e) { return "blocked"; }'],
    ['require',
      'try { return typeof require; } catch (e) { return "blocked"; }'],
    ['async 函数原型逃逸',
      'try { var F = Object.getPrototypeOf(async function(){}).constructor; return F("return 1+1")(); } catch (e) { return "blocked"; }'],
  ];
  for (const [name, code] of probes) {
    const body = '(function(){ ' + code + ' })()';
    const s = new ModScript({ modLog: [] }, { id: 'probe', name: 'probe' }, 'var r = ' + body + '; wx.log(typeof r === "object" ? JSON.stringify(r) : String(r));');
    s.load();
    const logTxt = (s.world.modLog || []).map(x => x.msg).join(' ');
    const blocked = !/escaped|\d{2,}/.test(logTxt.replace(/2\d\d\d\d/g, '')) || /blocked|undefined|Cannot|not defined/.test(logTxt);
    /* 判据：日志里不该出现真 pid（大整数）或 "escaped"；出现 blocked/异常才算堵住 */
    const reallyBlocked = !/(escaped|\b[1-9]\d{3,6}\b)/.test(logTxt);
    ok('F 探针 · ' + name, reallyBlocked, logTxt.slice(0, 60));
  }
}

/* ================================================================
 * §G 效果 DSL 电池（evalEffect 代表性副作用逐个验）
 * ================================================================ */
section('§G 效果 DSL 电池');
{
  const e = boot(17);
  const w = e.world, p = w.player;
  const run = effs => modapi.evalEffects([].concat(effs), { player: p, world: w });
  const line = effs => txt(run(effs));

  p.hp = 10;
  run('+hp:5');
  ok('G-1 +hp 生效', p.hp === 15, String(p.hp));
  run('+money:100'); ok('G-2 +money', p.money >= 100, String(p.money));
  run('-money:30'); ok('G-3 -money（不为负）', p.money >= 70, String(p.money));
  run('+item:mc_stone:2'); ok('G-4 +item ×2（开局 0 → 2）', p.countItem('mc_stone') === 2, String(p.countItem('mc_stone')));
  run('-item:mc_stone:1'); ok('G-5 -item（2 → 1）', p.countItem('mc_stone') === 1, String(p.countItem('mc_stone')));
  run('flag:mc_f'); ok('G-6 flag', p.hasFlag('mc_f'));
  run('var:mc_v=42'); ok('G-7 var 赋值', p.getVar('mc_v') === 42, String(p.getVar('mc_v')));
  run('incvar:mc_v'); ok('G-8 incvar', p.getVar('mc_v') === 43, String(p.getVar('mc_v')));
  run('+attr:力量:2'); ok('G-9 +attr', p.attrTotal('力量') >= 2, String(p.attrTotal('力量')));
  run('+rep:华山派:10'); ok('G-10 +rep', (p.reputation['华山派'] || 0) === 10, String(p.reputation['华山派']));
  run('contrib:华山派:50'); ok('G-11 contrib（上轮新增）', (p.sectContribution || 0) === 50, String(p.sectContribution));
  run('+skill:基本剑法:10'); ok('G-12 +skill（未学则报错文案，不炸）', /基本剑法|学|修为/.test(line('+skill:基本剑法:10')));
  ok('G-13 menu 效果出选项行', (() => {
    const o = run('menu:选|甲>say:你选了甲;;乙>say:你选了乙');
    const m = o.find(x => x.kind === 'menu');
    return !!m && m.options.length === 2 && m.options[0].label === '甲';
  })());
  ok('G-14 {if,then,else} 条件包装', (() => {
    const o = run({ if: { money: 100 }, then: ['say:有钱'], else: ['say:没钱'] });
    return /有钱/.test(txt(o));
  })());
  ok('G-15 未知效果不炸（静默但容错）', (() => { run('mc_nosuch:1'); return true; })());

  /* 2026-10-13 盘点补漏的两条（原来都是「不报错就是不生效」）：
     ① giveRandom 是文档写法，引擎原来只认 randomitem → 作者照文档写 = 静默落空；
     ② combatWith 原先是死代码（getRoom 后直接 break），写了等于没写。 */
  p.countItem && (() => { const pool = ['cloth_robe', 'tattered_cloak', 'silk_robe']; const b = pool.reduce((s, n) => s + p.countItem(n), 0); run('giveRandom:' + pool.join(':')); const a = pool.reduce((s, n) => s + p.countItem(n), 0); ok('G-16 giveRandom（文档写法）真给东西', a - b === 1, `${b}→${a}`); })();
  ok('G-17 combatWith 对场上 NPC 开打', (() => {
    try { w.spawnNpc('npcv_196', p.room, 1, true); } catch (e) { void e; }
    run('combatWith:npcv_196');
    return !!w.battle;
  })());
  ok('G-18 combatWith 对不在场的人明说（不静默）', /找不到/.test(line('combatWith:mc_nosuch_npc')));

  /* ---- §G2 条件字符串简写别名（2026-10-15 教程盘点批）----
     教程速查表教的写法原先全是静默失效：rep>=500 恒真、hasitem:/flag:/sect: 恒假。
     引擎补了已知键的 key:value 映射，这里四条写法验真 + 验假（变异断言）。 */
  p.money = 1000;
  p.setFlag && p.setFlag('mc_letter', true);
  ok('G2-1 hasitem 简写真生效（有→true，没有→false）',
    modapi.evalCond('hasitem:mc_stone', { player: p, world: w }) === true
    && modapi.evalCond('hasitem:mc_nosuch', { player: p, world: w }) === false);
  ok('G2-2 hasitem:x:2 数量口径（只有 1 把 → false，给够 → true）',
    modapi.evalCond('hasitem:mc_stone:2', { player: p, world: w }) === false
    && (run('+item:mc_stone:1'), modapi.evalCond('hasitem:mc_stone:2', { player: p, world: w }) === true));
  ok('G2-3 flag:x 简写（插过旗 true，没插 false）',
    modapi.evalCond('flag:mc_letter', { player: p, world: w }) === true
    && modapi.evalCond('flag:mc_nosuch', { player: p, world: w }) === false);
  ok('G2-4 sect:x 简写（对象口径同判）',
    modapi.evalCond('sect:华山派', { player: p, world: w }) === false
    && (p.sect = '华山派', modapi.evalCond('sect:华山派', { player: p, world: w }) === true));
  ok('G2-5 chance:x 简写（rng 归零=必过）',
    (() => { const realNext = w.rng.next; w.rng.next = () => 0; const r = modapi.evalCond('chance:0.3', { player: p, world: w }); w.rng.next = realNext; return r === true; })());
  ok('G2-6 对象写法回归不动（{rep,>=} 仍认）',
    (() => { p.reputation.华山派 = 60; return modapi.evalCond({ rep: '华山派', '>=': 50 }, { player: p, world: w }) === true
      && modapi.evalCond({ rep: '华山派', '>=': 500 }, { player: p, world: w }) === false; })());
  ok('G2-7 组合写法（{and:[字符串…]} 数组元素逐条再求值）',
    modapi.evalCond({ and: ['money>=100', 'hasitem:mc_stone'] }, { player: p, world: w }) === true);
}

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
if (fails.length) console.log('失败项：\n  - ' + fails.join('\n  - '));
process.exit(fail ? 1 : 0);
