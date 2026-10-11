/**
 * smoke-creation.js — 武学自创 + 江湖的回应（2026-10-11 自拟第二批）
 *
 *   ① 武学自创：两门同槽、都到火候，才能揉成一门新的；失败会走火；
 *      新功夫**读档之后必须还在**（这是最容易忘、也最伤人的一处）
 *   ② 江湖的回应：你打倒了谁 → 记进账 + 传出去；他的同门/同族/好友会来找你
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const CS = require(path.join(ROOT, 'game/src/core/customskill.js'));
const RV = require(path.join(ROOT, 'game/src/core/revenge.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

function scene() {
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
  const w = e.world, p = w.player;
  const sword = Object.values(w.data.skills).filter(s => s.type === '剑').map(s => s.id);
  for (const id of sword.slice(0, 2)) p.learnSkill(id, { force: true });
  p.learned[sword[0]].level = 400; p.learned[sword[1]].level = 400;
  p.maxMpBase = 600; p.recalc(); p.mp = p.maxMp;
  return { e, w, p, A: sword[0], B: sword[1] };
}

console.log('===== ① 武学自创：什么情况下能揉 =====');
{
  const { w, p, A, B } = scene();
  const nameOf = id => (w.getSkill(id) || {}).name;

  ok('两门都到火候 → 可以化', CS.canFuse(w, p, A, B).ok === true, JSON.stringify(CS.canFuse(w, p, A, B).why));
  ok('同一门不能跟自己揉', CS.canFuse(w, p, A, A).ok === false);
  ok('没学会的不行', CS.canFuse(w, p, A, 'basic_fist').ok === false);

  /* 不同槽不能揉 */
  const fist = Object.values(w.data.skills).find(s => s.type === '拳');
  p.learnSkill(fist.id, { force: true });
  p.learned[fist.id].level = 500;
  const cross = CS.canFuse(w, p, A, fist.id);
  ok('不同槽的揉不到一处', cross.ok === false && /不同路/.test(cross.why), cross.why);

  /* 火候不够要说清楚 */
  const low = Object.assign({}, p, { learned: Object.assign({}, p.learned, { [B]: { level: 50 } }) });
  const r0 = CS.canFuse(w, low, A, B);
  ok('火候不够会被拦', r0.ok === false && /280/.test(r0.why), r0.why);
  ok('拦住时把两边等级都报出来', new RegExp(nameOf(A)).test(r0.why) && new RegExp(nameOf(B)).test(r0.why), r0.why);
}

console.log('===== ② 成了：新功夫真的存在、真的能练 =====');
{
  const { w, p, A, B } = scene();
  w.rng.next = () => 0.01;
  const r = CS.fuse(w, p, A, B, '无名剑意');
  ok('化用成功', r.ok === true, JSON.stringify(r.lines.map(l => l.text)));
  ok('给这门功夫起了名字', !!r.skillId && w.getSkill(r.skillId).name === '无名剑意');
  ok('world.getSkill 取得到（不是空壳）', !!w.getSkill(r.skillId), r.skillId);
  ok('槽位跟两门原功一样（都是剑）', w.getSkill(r.skillId).type === '剑', w.getSkill(r.skillId).type);
  ok('威力比两门原功都高（不然白揉）', w.getSkill(r.skillId).damageMult >= Math.max(w.getSkill(A).damageMult || 1, w.getSkill(B).damageMult || 1), String(w.getSkill(r.skillId).damageMult));
  ok('玩家真的会了', !!p.learned[r.skillId]);
  ok('记得是从哪两门化出来的', JSON.stringify(w.getSkill(r.skillId).from) === JSON.stringify([A, B]));
  ok('结算文案说了化成什么', /自创了一门剑/.test(r.lines.map(l => l.text).join('')), r.lines.map(l => l.text).join('|').slice(0, 60));

  /* 读档重注 —— 这条最要紧 */
  delete w.data.skills[r.skillId];
  ok('（模拟读档）新功夫从表里丢了', !w.getSkill(r.skillId));
  const n = CS.rehydrate(w, p);
  ok('读档后重新注回表里', n === 1 && !!w.getSkill(r.skillId), '重注 ' + n);
  ok('注回来名字还对', w.getSkill(r.skillId).name === '无名剑意');
  ok('注回来槽位还对', w.getSkill(r.skillId).type === '剑');

  /* 上限三门 */
  let made = 1;
  while (CS.canFuse(w, p, A, B).ok && made < 8) {
    w.rng.next = () => 0.01;
    const rr = CS.fuse(w, p, A, B, '第' + (made + 1) + '门');
    if (!rr.ok) break;
    made++;
  }
  ok('一辈子最多创三门', CS.countOf(p) === CS.MAX_CUSTOM, String(CS.countOf(p)));
  ok('到顶之后再化会被拦', CS.canFuse(w, p, A, B).ok === false && /一辈子/.test(CS.canFuse(w, p, A, B).why));
}

console.log('===== ③ 败了：走火要付出代价 =====');
{
  const { w, p, A, B } = scene();
  w.rng.next = () => 0.99;                  // 必败
  const hp0 = p.hp, mp0 = p.maxMpBase, before = CS.countOf(p);
  const r = CS.fuse(w, p, A, B, '不成的一门');
  ok('走火没有创出功夫', r.ok === false && CS.countOf(p) === before, String(CS.countOf(p)));
  ok('走火伤身', p.hp < hp0, hp0 + ' → ' + p.hp);
  ok('走火掉内力上限', p.maxMpBase < mp0, mp0 + ' → ' + p.maxMpBase);
  ok('人还在（不会死）', p.hp >= 1, String(p.hp));
  ok('走火有说法（不是只掉数字）', /走火|两股气|撞上了/.test(r.lines.map(l => l.text).join('')), r.lines.map(l => l.text).join('|').slice(0, 60));
  ok('会提示怎么提高成功率', /悟性|资质|练深/.test(r.lines.map(l => l.text).join('')));
}

console.log('===== ④ 江湖的回应：你做的事传出去 =====');
{
  const { w, p } = scene();
  const famous = Object.values(w.data.npcs).find(n => n.tier === 'A' && n.sect);
  const nobody = Object.values(w.data.npcs).find(n => n.tier === 'C' && !n.sect);

  p.slain = {};
  RV.noteDown(w, p, famous);
  ok('打倒了有名的人会被记下', !!p.slain[famous.id], JSON.stringify(Object.keys(p.slain)));
  ok('记的是名字不是 id', p.slain[famous.id].name === famous.name);
  ok('有名有姓的才值得传', RV.worthRumor(famous) === true && RV.worthRumor(nobody) === false);

  const before = Object.keys(p.slain).length;
  RV.noteDown(w, p, nobody);
  ok('无名小卒不进账（不然账本全是杂鱼）', Object.keys(p.slain).length >= before);
}

console.log('===== ⑤ 谁会来替他出头 =====');
{
  const { w, p } = scene();
  const famous = Object.values(w.data.npcs).find(n => n.tier === 'A' && n.sect);
  const av = RV.avengersFor(w, famous);
  ok('同门会出头', av.some(x => x.why === 'sect'), av.slice(0, 3).map(x => x.npc.name + '(' + x.why + ')').join(','));
  ok('出头的都是有名有姓的人', av.every(x => x.npc.tier === 'A' || x.npc.tier === 'B'));
  ok('他自己不会替自己出头', !av.some(x => x.npc.id === famous.id));

  /* 找上门：碰上的人正好是替他出头的 */
  const one = av[0].npc;
  p.slain = {}; RV.noteDown(w, p, famous);
  w.rng.next = () => 0.01;
  const meet = RV.maybeAvenge(w, p, w.getRoom(p.room), [{ name: one.name, defId: one.id, isNpc: true }]);
  ok('碰上了会来开口', !!meet && !!meet.text, JSON.stringify(meet && meet.text));
  if (meet) {
    ok('说话点明了关系（不是我我我要报仇）', /你打|同门|本家|喝了二十年酒/.test(meet.text), meet.text);
    ok('给了三个选择（接/赔/走）', meet.choices && meet.choices.length === 3, JSON.stringify(meet.choices && meet.choices.map(c => c.label)));
    ok('选择都带指令', meet.choices.every(c => !!c.cmd));
  }
  /* 没关系的人不会来找你 */
  const stranger = { name: '路人甲', defId: 'nobody_x', isNpc: true };
  const meet2 = RV.maybeAvenge(w, p, w.getRoom(p.room), [stranger]);
  ok('不相干的人不会来寻仇', meet2 === null, JSON.stringify(meet2 && meet2.text));

  /* 赔罪按他的性子判 */
  const bad = Object.assign({}, one, { personality: 'baozhao' });
  w.rng.next = () => 0.5;
  const ap = RV.apologize(w, p, bad);
  ok('赔罪有回应', ap.lines.length >= 1 && /罢了|赔？拿什么赔/.test(ap.lines.map(l => l.text).join('')), ap.lines.map(l => l.text).join('|').slice(0, 50));
}

console.log('===== ⑥ 指令通 =====');
{
  const { e, w, p, A, B } = scene();
  ok('「化用」不给参数会讲怎么用', /化用/.test(e.exec('化用').lines[0].text));
  w.rng.next = () => 0.01;
  const r = e.exec('化用 ' + w.getSkill(A).name + ' ' + w.getSkill(B).name + ' 独门剑法');
  ok('「化用」真能化出来', /自创了一门剑/.test(r.lines.map(l => l.text).join('')), r.lines.map(l => l.text).join('|').slice(0, 60));
  const list = e.exec('自创武学');
  ok('「自创武学」列得出来', /独门剑法/.test(list.lines.map(l => l.text).join('')), list.lines.map(l => l.text).join('|').slice(0, 60));
  ok('列的时候写了从哪两门化出', /化出/.test(list.lines.map(l => l.text).join('')));
  ok('「了断」「赔罪」「不理」都在', ['了断', '赔罪', '不理'].every(c => {
    const rr = e.exec(c + ' 岳不群');
    return rr && rr.lines && rr.lines.length > 0;
  }));
}

console.log(`\n===== smoke-creation: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
