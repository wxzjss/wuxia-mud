/* ============================================================
 * smoke-flyto.js — 行路网络（驿站渡口）· flight 空投下线断言
 *
 * 口径反转（主人 2026-10-14 · design/89 §七·补 裁 1/2/3）：
 *   飞行空投语义全删；区域间移动走驿站渡口行路网络。
 * 本套断言四件事：
 *   ① 空投没了 —— 敲「飞往」不再位移，回的是世界内的说法 + 指路「行路」；
 *   ② 行路三态消费对 —— walk 免费直达 / cross 门槛（渡资）过与不过 /
 *      被挡时念的是**站在门前的人的说法**（sectRefusal 范式，不出系统提示条）；
 *   ③ 渡资真扣钱、走成真位移；
 *   ④ 首道卷界出口拦截 —— 出口带 say 时被挡念人话（驿丞说法），
 *      数据没写 say 才退回系统腔 msg。
 * 行路数据（w.data.travel）由本套注入（数据侧游有方供数，schema 见 travel.js）。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const txt = (r) => ((r && r.lines) || []).map(l => l.text || '').join(' ');
const kinds = (r) => ((r && r.lines) || []).map(l => l.kind || '');

const eng = new GameEngine({ seed: 4242 });
eng.boot();
eng.newGame({ name: '测试侠客', gender: 'male' });
const w = eng.world, p = w.player;
const START = p.room;

/* 行路数据（S1 首段骨架：江南 → 华山 walk；江南 → 西域 cross 渡资；江南 → 黑木崖 cross 卷界被挡） */
w.data.travel = { links: [
  { from: 'jiangnan', to: 'huashan', kind: 'walk' },
  { from: 'huashan', to: 'jiangnan', kind: 'walk' },
  { from: 'jiangnan', to: 'xiyu', kind: 'cross', cond: 'money>=200', cost: 200, gateText: '渡资 200 文',
    refusal: '船家摇摇头：「盘缠带够了再来，渡资二百文，一个子儿都不能少。」' },
  { from: 'jiangnan', to: 'mojiao', kind: 'cross', cond: 'act1_done',
    refusal: '驿丞拦在你马前：「北边在过兵，驿马都征走了。思过崖的事没了结，北边的道就不会开。要走，等开春。」' },
] };

console.log('\n① 空投没了（design/89 §七·补 裁 1）');
{
  p.room = START;
  p.mp = 500;
  const r = eng.exec('飞往 华山');
  ok('★ 敲「飞往」人不挪窝', p.room === START, '仍在 ' + p.room);
  ok('★ 回的是世界内的说法，不是系统报错腔', kinds(r).indexOf('story') >= 0 && kinds(r).indexOf('warn') === -1, kinds(r).join(','));
  ok('★ 指路落在「行路」上（铁律 3：被挡的玩家永远知道走哪条路）', /行路/.test(txt(r)), txt(r).slice(-60));
  ok('★ 传送别名同口径', p.room === START && /行路/.test(txt(eng.exec('传送 华山'))));
}

console.log('\n② 行路 · walk 官道直达（免费走）');
{
  p.room = START;
  const m0 = p.money;
  const r = eng.exec('行路 华山');
  ok('★ 人真到了华山入口', p.room === 'huashan_gate' || (w.getRoom(p.room) || {}).region === 'huashan', '→ ' + p.room);
  ok('★ 步行直达不收钱', p.money === m0, 'money ' + m0 + ' → ' + p.money);
  ok('★ 回程走「行路」也通', /江南/.test(txt(eng.exec('行路 江南'))), '');
  p.room = START;
}

console.log('\n③ 行路 · cross 渡资三态（门槛消费对）');
{
  p.room = START;
  p.money = 50;
  const r = eng.exec('行路 西域');
  ok('★ 盘缠不够被挡：人不挪窝', p.room === START);
  ok('★ 被挡念的是船家的话（story，不是系统 warn）', kinds(r).indexOf('story') >= 0 && kinds(r).indexOf('warn') === -1, kinds(r).join(','));
  ok('★ 说法里带「差什么」（渡资二百文）', /渡资|二百/.test(txt(r)), txt(r).slice(0, 60));

  p.money = 1000;
  const r2 = eng.exec('行路 西域');
  ok('★ 渡资够了真走成', (w.getRoom(p.room) || {}).region === 'xiyu', '→ ' + p.room);
  ok('★ 渡资真扣（1000-200）', p.money === 800, 'money ' + p.money);
  p.room = START;
}

console.log('\n④ 行路 · 首道卷界（江南北门驿 · 不通航 cond + 说法）');
{
  p.room = START;
  delete p.flags['act1_done'];
  const r = eng.exec('行路 黑木崖');
  ok('★ act1 未成：卷界锁死，人不挪窝', p.room === START);
  ok('★ 驿丞的说法由人说出来（story 行，非系统提示条）', kinds(r).indexOf('story') >= 0, kinds(r).join(','));
  ok('★ 说法带指路（铁律 3）', /等开春|思过崖/.test(txt(r)), txt(r).slice(0, 70));
  /* 锁开也是戏（铁律 2）：flag 一翻，路就通，且有「通航场景句」 */
  p.setFlag('act1_done', true);
  const r2 = eng.exec('行路 黑木崖');
  ok('★ act1 成：卷界开，人到了', (w.getRoom(p.room) || {}).region === 'mojiao', '→ ' + p.room);
  ok('★ 通航有场景句（锁开那一刻是戏）', kinds(r2).indexOf('story') >= 0, txt(r2).slice(0, 50));
  p.room = START;
}

console.log('\n⑤ 出口拦截 · ex.say 驿丞说法（sectRefusal 范式挂点）');
{
  /* 数据侧游有方会把卷界出口写成 cond + say；这里注入一条实测拦截 */
  /* ⚠ 测试隔离（2026-10-15 发布窗扫尾）：④ 的行路落点 mojiao_shanmen 挂着
     40% 埋伏池（mob_mo_disciple / mob_assassin，50_map encounter 字段）——
     上游 RNG 消耗一漂移（NPC 生成/游走/boot 侧数据调整），seed 4242 也会
     真掷中埋伏，w.battle 一路带进 ⑤，把「驿丞 say」判据打成战斗 warn
     （发布窗实发一次：1 红后 23 连绿，非稳定红）。
     本段测的是**出口 say 拦截范式**，不是遭遇战——先把战斗态清干净。 */
  if (w.battle) w.battle = null;
  const room = w.getRoom(START);
  const savedExits = room.exits;
  room.exits = { n: { to: 'huashan_gate', cond: 'act1_done', msg: '路被挡住了。', say: '驿丞拦在你马前：「北边在过兵，驿马都征走了。要走，等开春。」' } };
  p.room = START;
  delete p.flags['act1_done'];
  const r = eng.exec('北');
  ok('★ 被出口 cond 拦下', p.room === START);
  ok('★ 念的是驿丞的话（story 行），不是系统 warn', kinds(r).indexOf('story') >= 0 && kinds(r).indexOf('warn') === -1, kinds(r).join(',') + ' ' + txt(r).slice(0, 40));
  delete room.exits.n.say;
  const r2 = eng.exec('北');
  ok('★ 没写 say 才退回系统腔 msg（数据兜底）', kinds(r2).indexOf('warn') >= 0 && txt(r2).indexOf('路被挡住了') >= 0, txt(r2).slice(0, 40));
  room.exits = savedExits;
}

console.log('\n⑥ mapView 三态下发（前端「行路」面板的数据源）');
{
  p.room = START;
  delete p.flags['act1_done'];
  const v = eng.mapView();
  const regs = v.regions || [];
  const st = (id) => { const r = regs.find(x => x.id === id); return r && r.travel && r.travel.state; };
  ok('★ regions 不再带 canFly（空投字段全撤）', regs.every(r => !('canFly' in r)));
  ok('★ 本区无 travel 字段（不需要「行路」到自己）', !((regs.find(x => x.id === 'jiangnan') || {}).travel));
  ok('★ 华山 = walk', st('huashan') === 'walk', st('huashan'));
  ok('★ 西域 = ready（money>=200 已过）', st('xiyu') === 'ready', st('xiyu'));
  ok('★ 黑木崖 = closed，带说法', st('mojiao') === 'closed' && /驿丞|开春/.test((regs.find(x => x.id === 'mojiao').travel || {}).refusal || ''));
}

console.log('\n行路网络回归：通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
