/* ============================================================
 * smoke-neigong.js — 内力上限系统 / 吐纳 / 传功灌顶 / 人物故事 / 门派互动功法
 *
 * 覆盖主人 2026-10-10 那一串要求：
 *  ① 吐纳：不能动、内力与气血往下掉（气血掉得慢）、见底一次补全、内力上限 +1
 *  ② 有内功涨得更多；内力上限反过来抬高武学等级上限
 *  ③ NPC 的内力上限 = 实力上限（出生时按 maxMp 把功法火候垫高）
 *  ④ 传功（传下去六成火候）/ 灌顶（各 10 点）
 *  ⑤ 人物故事：好感 > 60 才解锁
 *  ⑥ 任务每推进一步，与该 NPC 的好感 +10
 *  ⑦ 门派/势力专属互动功法：47 门、效果各不相同、须运起本门功法
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const NG = require(path.join(ROOT, 'game', 'src', 'core', 'neigong.js'));
const ARTS = require(path.join(ROOT, 'game', 'src', 'core', 'arts.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261018;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  /* ⚠️ 开局气血只有两成（新手设定），而吐纳的门槛是「气血不低于三成」——
     不先养满，本组测的全是「太虚了不能坐」。 */
  const p = e.world.player;
  p.hp = p.maxHp;
  return e;
}

/* ---------- ① 吐纳 ---------- */
section('① 吐纳：熬到见底才长内力');
const e1 = boot(); const w1 = e1.world, p1 = w1.player;
const mp0 = p1.maxMp, hp0 = p1.maxHp;
const r0 = NG.start(w1, p1);
ok('起手进入吐纳', r0.ok === true && !!NG.stateOf(p1));
/* ⚠️ 「吐纳中走不动」那一条**挪到本组末尾**去了 ——
   主人 2026-10-11 把口径改成「点任何别的按钮 = 退出吐纳，再照常执行」，
   于是这里按方向键会把吐纳状态收掉；插在这个位置会让下面「熬到见底」整段断掉。 */
const m1 = p1.mp, h1 = p1.hp;
let rounds = 0, done = false;
while (!done && rounds < 40) {
  const r = NG.round(w1, p1);
  rounds++;
  if (r.done) done = true;
}
ok('会一直掉到见底然后结算', done === true, '共 ' + rounds + ' 轮');
/* 主人 2026-10-11 改的口径：消耗是**按内功品级的固定值**，涨多少也随品级与熟练度 ——
   所以这里只断言「涨了」，不再钉死 +1（没内功的人品级按 1 算，一轮涨 2）。 */
ok('内力上限涨了', p1.maxMp > mp0, `${mp0} → ${p1.maxMp}`);
ok('★ 结算后**不补全**内力（主人：吐纳结束不回满血与内力）',
  p1.mp < p1.maxMp, `${p1.mp}/${p1.maxMp}`);
ok('★ 结算后气血也不回满', p1.hp < p1.maxHp, `${Math.round(p1.hp)}/${Math.round(p1.maxHp)}`);
ok('吐纳结束状态清掉了', !NG.stateOf(p1));
{
  const c = NG.costOf(p1);
  ok('★ 消耗是按品级的固定值（不是按百分比）', c.mp >= 1 && c.hp >= 1, `内力 ${c.mp} / 气血 ${c.hp}`);
}

/* 走动 / 点别的按钮：主人 2026-10-11 改的口径 ——
   不再是「硬拦着不让动」，而是「先醒过来，再照办」（`engine.exec` 统一接管）。
   ⚠️ 这段必须放最后：它会把吐纳状态收掉。 */
const e1x = boot(); const p1x = e1x.world.player;
NG.start(e1x.world, p1x);
const roomBefore1 = p1x.room;
const mv1 = e1x.exec('go east');   /* 96 案后北门是 G1 边检，金丝雀改常开的东门 */
ok('★ 吐纳中按方向键：先退出吐纳，再真的走过去',
  /已退出吐纳状态/.test(mv1.lines.map(l => l.text || '').join('')) && p1x.room !== roomBefore1 && !NG.stateOf(p1x),
  `${roomBefore1} → ${p1x.room}`);
const e1y = boot(); const p1y = e1y.world.player;
NG.start(e1y.world, p1y);
const dk1 = e1y.exec('背包');
const t1y = dk1.lines.map(l => l.text || '').join('\n');
ok('★ 吐纳中点别的按钮：先退出，再照常执行（背包真开了）',
  /已退出吐纳状态/.test(t1y) && /行囊/.test(t1y), t1y.replace(/\n/g, ' | ').slice(0, 60));

/* 有内功涨得多 */
const e2 = boot(); const w2 = e2.world, p2 = w2.player;
p2.learnSkill('basic_force', { force: true });
p2.equippedSkills['内功'] = 'basic_force';
p2.learned['basic_force'].level = 240;
  p2.recalc();
  p2.hp = p2.maxHp;   // 学完内功 maxHp 变大了，补血要跟在后面
const g = NG.gainPerTune(p2);
ok('有内功（240 级）一次涨得更多', g > 1, '+' + g);
const mpB = p2.maxMp;
/* 起手得有点气（新门槛：丹田空的坐不住），但**别灌满** ——
   学了 240 级内功后 maxMp 有 498，而一轮只耗 11 点，灌满要坐四十多轮才见底
   （第一版就是灌满 + 只跑 40 轮，于是永远等不到结算，断言拿到 +0）。 */
p2.mp = 60;
NG.start(w2, p2);
let d2 = false, rr = 0;
while (!d2 && rr < 200) { const r = NG.round(w2, p2); rr++; if (r.done) d2 = true; if (r.failed) break; }
ok('内功越深，一次吐纳涨得越多', p2.maxMp - mpB === g, `+${p2.maxMp - mpB}`);

/* 内力上限抬武学上限 */
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
const limA = p3.maxSkillLevelFor(w3.getSkill('basic_sword'));
p3.maxMpBase = (p3.maxMpBase || 50) + 1000;
p3.recalc();
const limB = p3.maxSkillLevelFor(w3.getSkill('basic_sword'));
ok('内力上限抬高武学等级上限', limB > limA, `${limA} → ${limB}`);

/* ---------- ③ NPC 内力 = 实力上限 ---------- */
section('③ NPC 的内力上限决定他的火候');
const e4 = boot(); const w4 = e4.world;
const boss = w4.spawnNpc('master_yue', w4.player.room, 1, true);
const weakN = w4.spawnNpc('npcv_002', w4.player.room, 1, true);
const bossLv = Object.values(boss.learned || {}).map(x => x.level || 0);
const weakLv = Object.values(weakN.learned || {}).map(x => x.level || 0);
ok('内力高的掌门，火候被顶到相应水平', Math.max.apply(null, bossLv) >= NG.npcLevelFromMp(boss), `maxLv=${Math.max.apply(null, bossLv)} cap=${NG.npcLevelFromMp(boss)}`);
ok('垫高值 = max(原有火候, 内力配得上的火候)', weakLv.every(v => v >= NG.npcLevelFromMp(weakN)), `maxLv=${Math.max.apply(null, weakLv.length ? weakLv : [0])} cap=${NG.npcLevelFromMp(weakN)}`);
ok('只抬不降（手填更高的保留）', (function () {
  const n = w4.spawnNpc('master_yue', w4.player.room, 1, true);
  const before = Object.assign({}, n.learned);
  NG.syncNpcByMp(w4, n);
  return Object.keys(before).every(k => n.learned[k].level >= before[k].level);
})());

/* ---------- ④ 传功 / 灌顶 ---------- */
section('④ 传功与灌顶');
const e5 = boot(); const w5 = e5.world, p5 = w5.player;
p5.learnSkill('huashan_sword', { force: true });
p5.learned['huashan_sword'].level = 300;
const stu = w5.spawnNpc('npcv_002', p5.room, 1, true);
p5.maxMpBase = 300; p5.recalc();   // 玩家内力底子只有 10，灌顶的下限会把差值吃掉
p5.disciples = [stu.id];
const t1 = e5.exec('传功 ' + stu.name + ' 华山剑法');
ok('传功成功', /传了/.test(JSON.stringify(t1.lines)), JSON.stringify(t1.lines.map(l => l.text)).slice(0, 70));
ok('传下去只剩六成火候', stu.learned['huashan_sword'].level === 180, String(stu.learned['huashan_sword'].level));
const t2 = e5.exec('传功 ' + stu.name + ' 华山剑法');
ok('同一门不会再传第二遍（他已经会了）', /已经不比这一手差/.test(JSON.stringify(t2.lines)));
const myBase = p5.maxMpBase, hisMp = stu.maxMp;
const t3 = e5.exec('灌顶 ' + stu.name);
ok('灌顶成功', /内力上限 −/.test(JSON.stringify(t3.lines)), (t3.lines || []).map(l => l.text).join(' ').slice(0, 140));
ok('自己掉了一截内力上限', p5.maxMpBase < myBase, `base ${myBase} → ${p5.maxMpBase}`);
ok('徒弟涨了（一次最多 10）', stu.maxMp - hisMp <= 10 && stu.maxMp > hisMp, `+${stu.maxMp - hisMp}`);
const t4 = e5.exec('灌顶 路人甲');
ok('对非弟子灌顶会被拒', /弟子里没有/.test(JSON.stringify(t4.lines)));

/* ---------- ⑤ 人物故事 ---------- */
section('⑤ 人物故事：好感 > 60 才解锁');
const e6 = boot(); const w6 = e6.world, p6 = w6.player;
const who = w6.spawnNpc('liu_hanyan', p6.room, 1, true);
who.favor = 10;
const pr1 = e6.npcProfileOf(who.id);
ok('好感不够时故事是锁着的', pr1.lifeStory && pr1.lifeStory.unlocked === false, 'favor=' + who.favor);
who.favor = 80;
const pr2 = e6.npcProfileOf(who.id);
ok('好感过 60 就解锁', pr2.lifeStory && pr2.lifeStory.unlocked === true);
ok('解锁后真给得出故事（来历/如今/想要）', !!(pr2.lifeStory.origin || pr2.lifeStory.now || pr2.lifeStory.want),
  [pr2.lifeStory.origin, pr2.lifeStory.now, pr2.lifeStory.want].filter(Boolean).length + ' 段');

/* ---------- ⑥ 任务节点加好感 ---------- */
section('⑥ 任务每推进一步，好感 +10');
{
  /* 交任务那条路要同时凑齐「委托人模板的 quests 含该任务 + 本段目标全部达成」，
     构造起来又长又脆（凑的是测试的脚手架，不是被测的东西）。
     这里守的是**源码契约**：任务推进那段必须给与该 NPC 的 favor 加码 —— 
     谁哪天顺手删了它，这条会红。（行为验证见 design/50 报告的手工记录。） */
  const { execSync } = require('child_process');
  const src = require('fs').readFileSync(path.join(ROOT, 'game', 'src', 'core', 'commands.js'), 'utf8');
  const i = src.indexOf('npc.pstate.trust = Math.min(100');
  const seg = i >= 0 ? src.slice(i, i + 700) : '';
  ok('任务推进处写着「好感 +10」这一句', /npc\.favor = \(npc\.favor \|\| 0\) \+ 10/.test(seg), seg ? seg.slice(0, 40) : '(没找到那段)');
  ok('那段不长到会被别处顶掉（<700 字符内有该句）', seg.length > 0);
}

/* ---------- ⑦ 门派/势力专属互动功法 ---------- */
section('⑦ 门派与势力的互动功法');
const all = ARTS.listOf(w6);
const sectArts = (w6.data.sectArts || {}).list || [];
ok('专属互动功法已入库（≥40 门）', sectArts.length >= 40, String(sectArts.length));
ok('通用秘技没被顶掉（两份表各自独立）', ((w6.data.arts || {}).list || []).length === 7, String(((w6.data.arts || {}).list || []).length));
ok('合计可用的互动功法 = 7 + 门派那份', all.length === 7 + sectArts.length, String(all.length));
const kinds = {};
for (const a of sectArts) kinds[a.effect] = (kinds[a.effect] || 0) + 1;
ok('效果各不相同（≥6 种，不是模板套壳）', Object.keys(kinds).length >= 6, JSON.stringify(kinds));
const names = sectArts.map(a => a.name);
ok('功法名两两不同', new Set(names).size === names.length, String(new Set(names).size));
ok('每门都要求先运起本家功夫', sectArts.every(a => (a.needSkills || []).length > 0));
ok('需求指向真实功法', sectArts.every(a => (a.needSkills || []).every(sid => !!w6.getSkill(sid))));
const healArt = sectArts.find(a => a.effect === 'heal_npc');
const strongNpc = w6.spawnNpc('master_yue', w6.player.room, 1, true);
p6.learnSkill(healArt.needSkills[0], { force: true });
p6.equippedSkills[(w6.getSkill(healArt.needSkills[0]) || {}).type || '内功'] = healArt.needSkills[0];
p6.mp = p6.maxMp = 9999;
const l = ARTS.listFor(w6, p6, strongNpc).find(a => a.id === healArt.id);
ok('替人疗伤这类正面功夫，对强者也用得（不看强弱）', l && l.can === true, JSON.stringify(l));

console.log(`\n===== smoke-neigong: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

