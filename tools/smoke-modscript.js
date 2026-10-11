/* Mod 沙箱脚本（script.js）回归测试
 *
 * 守的是「选了白选」这件事：modloader 一直在算 hasScript、
 * 文档与制作器都在说「script.js 沙箱执行」，但**以前没有任何执行入口**。
 * 这里把那条路整条走一遍，并钉住隔离边界。
 *
 *   run: node tools/smoke-modscript.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { GameEngine } = require('../game/src/core/engine.js');

const ROOT = path.join(__dirname, '..');
const TMP = path.join(ROOT, '.modtest');
const MODS = path.join(TMP, 'mods');
const SAVES = path.join(TMP, 'saves');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};

/* ------------------------------------------------------------------ *
 * 造一批测试 mod（每次都重写，保证内容确定）
 * ------------------------------------------------------------------ */
function rmrf(p) { try { fs.rmSync(p, { recursive: true, force: true }); } catch (e) { /* ignore */ } }
function mkmod(dir, json, script) {
  const d = path.join(MODS, dir);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'mod.json'), JSON.stringify(json, null, 2), 'utf8');
  if (script !== undefined && script !== null) fs.writeFileSync(path.join(d, 'script.js'), script, 'utf8');
  return d;
}

const J = (id, name) => ({
  id, name, version: '1.0.0', author: '测试', category: '功能',
  desc: name, items: [{ id: id + '_chip', name: name + '·令牌', type: 'misc', price: 1, weight: 0, desc: '测试用。' }],
});

rmrf(TMP);
fs.mkdirSync(MODS, { recursive: true });
fs.mkdirSync(SAVES, { recursive: true });

/* ① 正常脚本：探测沙箱边界 + 注册指令 + 监听事件 */
mkmod('ok_mod', J('ok_mod', '正常脚本'), `
wx.log('probe require=' + (typeof require));
wx.log('probe process=' + (typeof process));
wx.log('probe global=' + (typeof global));
wx.log('probe setTimeout=' + (typeof setTimeout));
wx.log('probe fetch=' + (typeof fetch));
var evBlocked = false;
try { eval('1+1'); } catch (e) { evBlocked = true; }
wx.log('probe eval=' + (evBlocked ? 'blocked' : 'allowed'));
var fnBlocked = false;
try { new Function('return 1'); } catch (e) { fnBlocked = true; }
wx.log('probe Function=' + (fnBlocked ? 'blocked' : 'allowed'));

wx.command('试功', function (a) {
  wx.state.calls = (wx.state.calls || 0) + 1;
  return '脚本应答 ' + wx.state.calls + ' 次，参数=' + a.args.join(',');
});

wx.on('onTick', function () {
  wx.state.ticks = (wx.state.ticks || 0) + 1;
  if (wx.state.ticks === 2) return '第二次心跳';
  return null;
});
`);

/* ② 撞名 + 乱写事件名 */
mkmod('clash_mod', J('clash_mod', '撞名脚本'), `
wx.command('look', function () { return '我不该出现'; });
wx.on('onNothing', function () { return '永远等不到'; });
`);

/* ③ 什么都不注册 */
mkmod('idle_mod', J('idle_mod', '空脚本'), `var a = 1 + 1;\n`);

/* ④ 语法错误 */
mkmod('bad_mod', J('bad_mod', '坏脚本'), `wx.command('坏', function ( { return 'x'; });\n`);

/* ⑤ 模块级死循环 —— 加载阶段就该被超时打断 */
mkmod('hang_mod', J('hang_mod', '死循环脚本'), `while (true) {}\n`);

/* ⑥ 指令里死循环 —— 派发阶段超时，超 3 次整个脚本停用 */
mkmod('hangcmd_mod', J('hangcmd_mod', '卡死指令'), `
wx.command('卡住', function () { while (true) {} });
`);

/* ⑦ 在脚本里往外面伸手（拿 process 干坏事）—— 必须失败但不影响别的 mod */
mkmod('escape_mod', J('escape_mod', '越狱脚本'), `
try {
  var p = this.constructor.constructor('return process')();
  wx.log('escape=SURVIVED ' + typeof p);
} catch (e) {
  wx.log('escape=blocked');
}
`);

/* ------------------------------------------------------------------ *
 * 启动（只带这些测试 mod，不带官方示例 —— 判定要干净）
 * ------------------------------------------------------------------ */
const e = new GameEngine({ seed: 20261012, modsDir: MODS, saveDir: SAVES });
let bootErr = '';
try { e.boot(); } catch (err) { bootErr = String((err && err.message) || err); }
ok('带 script.js 的 mod 启动不报错', !bootErr, bootErr);
e.newGame({ name: '试剑', gender: 'male' });
const w = e.world;
const logs = () => (w.modLog || []);
const logText = (mod) => logs().filter(l => l.mod === mod).map(l => l.msg).join('\n');
const scriptOf = (id) => (w._scripts || []).find(s => s.id === id);

console.log('\n① 脚本真的被读进来、跑起来了');
{
  ok('_scripts 里认出了 7 个脚本', (w._scripts || []).length === 7, (w._scripts || []).map(s => s.id).join(','));
  ok('ok_mod 加载成功', !!(scriptOf('ok_mod') && scriptOf('ok_mod').ready));
  ok('ok_mod 注册的指令进了 customCommands', !!w.customCommands['试功']);
  ok('mod 日志留了脚印（注册了 1 条自定义指令）', /注册了 1 条自定义指令：试功/.test(logText('ok_mod')), logText('ok_mod'));
}

console.log('\n② 沙箱隔离边界（require / process / 定时器 / eval / Function）');
{
  const t = logText('ok_mod');
  ok('上下文里没有 require', /probe require=undefined/.test(t), t.slice(0, 200));
  ok('上下文里没有 process', /probe process=undefined/.test(t));
  ok('上下文里没有 global', /probe global=undefined/.test(t));
  ok('上下文里没有 setTimeout（不能挂定时器）', /probe setTimeout=undefined/.test(t));
  ok('上下文里没有 fetch（不能上网）', /probe fetch=undefined/.test(t));
  ok('eval 被关掉（codeGeneration.strings=false）', /probe eval=blocked/.test(t));
  ok('new Function 被关掉', /probe Function=blocked/.test(t));
  ok('经典构造器逃逸拿不到 process', /escape=blocked/.test(logText('escape_mod')), logText('escape_mod'));
}

console.log('\n③ 自定义指令真的能敲（走 commands.execute 的 customCommands 那一档）');
{
  const r1 = e.exec('试功 甲乙');
  ok('指令有回执', (r1.lines || []).some(l => /脚本应答 1 次/.test(l.text || '')),
    (r1.lines || []).map(l => l.text).join(' | ').slice(0, 120));
  ok('参数原样传给了脚本', (r1.lines || []).some(l => /参数=甲乙/.test(l.text || '')));
  const r2 = e.exec('试功');
  ok('第二次调用账本继续累加（wx.state 有效）', (r2.lines || []).some(l => /脚本应答 2 次/.test(l.text || '')),
    (r2.lines || []).map(l => l.text).join(' | ').slice(0, 120));
  ok('wx.state 落在玩家 vars 上（能随档保存）',
    !!(w.player.vars['__mod_ok_mod'] && w.player.vars['__mod_ok_mod'].calls === 2),
    JSON.stringify(w.player.vars['__mod_ok_mod']));
  const sv = w.serialize();
  ok('存档里确实带上了脚本账本',
    !!(sv.player.vars && sv.player.vars['__mod_ok_mod'] && sv.player.vars['__mod_ok_mod'].calls === 2));
}

console.log('\n④ 事件处理器真的被 fireEvent 派发');
{
  const got = [];
  w.on('storyline', ev => { if (ev && ev.line) got.push(ev.line.text); });
  w.fireEvent('onTick', {});
  ok('第一次心跳按脚本说的不出声（返回 null 合法）', !got.some(x => /第二次心跳/.test(x)));
  w.fireEvent('onTick', {});
  ok('第二次心跳说话了', got.some(x => /第二次心跳/.test(x)), got.join(' | '));
  ok('没人监听的其它事件不打扰（=零开销快路径）',
    !scriptOf('ok_mod').listens('onKill'));
}

console.log('\n⑤ 白名单：乱写的 event 名与撞名的指令都要**明确拒绝**，不能静默');
{
  ok('onNothing 被拒并写明原因', /不是引擎会派发的事件/.test(logText('clash_mod')), logText('clash_mod'));
  ok('撞内置指令 look 被拒', /与游戏内置指令重名/.test(logText('clash_mod')), logText('clash_mod'));
  ok('撞名的那条真的没落到 customCommands 上', !w.customCommands['look']);
  const r = e.exec('look');
  ok('敲 look 走的是内置指令（脚本没被劫持）',
    !(r.lines || []).some(l => /我不该出现/.test(l.text || '')));
}

console.log('\n⑥ 什么也没注册的脚本要主动提醒作者');
{
  ok('idle_mod 被提醒「不会产生任何效果」', /不会产生任何效果/.test(logText('idle_mod')), logText('idle_mod'));
}

console.log('\n⑦ 坏脚本不能把游戏带崩');
{
  ok('语法错误的脚本被兜住（世界照常起来）', !!(scriptOf('bad_mod')) && !scriptOf('bad_mod').ready);
  ok('日志里写明了失败原因', /script.js 加载失败/.test(logText('bad_mod')), logText('bad_mod'));
  ok('模块级死循环被超时中断', /执行超时/.test(logText('hang_mod')), logText('hang_mod'));
  ok('ok_mod 没被坏邻居带坏（隔离是真的）', !!scriptOf('ok_mod').ready);
}

console.log('\n⑧ 派发超时会被中断，多次之后自动停用（防「越玩越卡」）');
{
  const hs = scriptOf('hangcmd_mod');
  const t0 = Date.now();
  const a = e.exec('卡住');
  const one = Date.now() - t0;
  ok('死循环被中断而不是挂住（单次 <1.5s）', one < 1500, one + 'ms');
  ok('第一次超时后脚本还活着', !hs.disabled);
  ok('超时体现在 Log 里', /超时/.test(logText('hangcmd_mod')), logText('hangcmd_mod').slice(0, 160));
  a; /* 第一次的回执 */
  e.exec('卡住');
  e.exec('卡住');
  ok('累计 3 次超时后脚本被停用', hs.disabled === true);
  ok('日志写明「停掉自动派发」', /停掉它的自动派发/.test(logText('hangcmd_mod')));
  const t1 = Date.now();
  const r = e.exec('卡住');
  const after = Date.now() - t1;
  ok('停用后不再耗时（直接回一句停用）', after < 200, after + 'ms');
  ok('停用后给玩家一句明确的话', (r.lines || []).some(l => /已被停用/.test(l.text || '')),
    (r.lines || []).map(l => l.text).join(' | ').slice(0, 120));
}

console.log('\n⑨ 官方示例 demo_script（作者照着抄的那份）');
{
  const e2 = new GameEngine({ seed: 20261012, saveDir: SAVES });
  e2.boot(); e2.newGame({ name: '试剑', gender: 'male' });
  const w2 = e2.world;
  const s = (w2._scripts || []).find(x => x.id === 'demo_script');
  ok('demo_script 被官方 mod 目录加载', !!s && s.ready, (w2._scripts || []).map(x => x.id).join(','));
  ok('demo_script 注册了指令「摸鱼」', !!(s && s.scriptCommands['摸鱼']));
  const r = e2.exec('摸鱼');
  const t1 = (r.lines || []).map(l => l.text || '').join(' ');
  /* 「摸鱼」有三条分支（被逮住 / 摸出摸鱼符 / 长一点潜能），断言按分支取并集 ——
     写死某一句会在概率变一下的时候假红（脚本里 wx.chance(0.35) 是真随机）。 */
  ok('敲「摸鱼」有脚本给的回执（三选一的分支都算）', /摸了|逮住|摸鱼符/.test(t1), t1.slice(0, 110));
  ok('★ 脚本自己的账本（wx.state）真的记下了次数',
    !!((e2.world.player.vars || {})['__mod_demo_script'] || {}).moyu,
    JSON.stringify((e2.world.player.vars || {})['__mod_demo_script']));
  /* 官方示例的 onDayTick 只在开了开关后才说话 —— 默认不出声，不能打扰玩家 */
  const got = [];
  w2.on('storyline', ev => { if (ev && ev.line) got.push(ev.line.text); });
  w2.fireEvent('onDayTick', { day: 3 });
  ok('官方示例默认不插嘴（开关没开）', !got.some(x => /脚本示例/.test(x)), got.join(' | '));
}

/* ------------------------------------------------------------------ *
 * 收尾
 * ------------------------------------------------------------------ */
rmrf(TMP);

console.log('\n' + '='.repeat(46));
console.log('  Mod 沙箱脚本回归：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
