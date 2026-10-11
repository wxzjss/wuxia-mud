/* ============================================================
 * smoke-medicine.js — 医术闭环（诊脉 / 疗伤 / 解毒）
 *
 * 主人 2026-10-11「继续做剩下的内容」。待办里挂着一条：
 *   「医术类武学无战斗外消费点」——《基本医术》占着槽位却哪里都用不上。
 * 这个模块把三条出口接上，所以测试要盯的都在这三件事上：
 *   · 会不会医术有门槛；学会了才允许诊脉/疗伤/解毒
 *   · 疗伤真的回气血、真的耗内力、真的走时间，且**一次有上限**
 *   · 解毒只揭一层（医术浅的人拔不干净）
 *   · 治好了别人，人情账要动（好感 + 诊金）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const MED = require(path.join(ROOT, 'game', 'src', 'core', 'medicine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);
const txt = r => (r && r.lines || []).map(l => l.text || '').join('\n');

const SEED = 20261018;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  e.world.player.hp = e.world.player.maxHp;
  return e;
}
function learnMed(e) {
  const p = e.world.player;
  p.learnSkill(MED.MED_ID, { force: true });
  p.learned[MED.MED_ID].level = 120;
  p.recalc();
  p.hp = p.maxHp;
  return p;
}

/* ================= ① 门槛 ================= */
section('① 没学医术就没有这三条路');
{
  const e = boot();
  for (const c of ['诊脉', '医治', '解毒']) {
    const r = e.exec(c);
    ok(`「${c}」提示先学《基本医术》`, /基本医术/.test(txt(r)), txt(r).slice(0, 30));
  }
}

/* ================= ② 诊脉 ================= */
section('② 诊脉：说人话，不报数字');
{
  const e = boot(); const p = learnMed(e);
  const r1 = e.exec('诊脉');
  ok('诊自己：给得出气血与判断', /气血/.test(txt(r1)) && /脉/.test(txt(r1)), txt(r1).replace(/\n/g, ' | ').slice(0, 70));

  p.hp = Math.floor(p.maxHp * 0.2);
  const r2 = e.exec('诊脉');
  ok('重伤时判断会变重', /伤得不轻|气息已经很弱/.test(txt(r2)), (txt(r2).split('\n').pop() || '').slice(0, 40));

  p.addBuff({ name: '蛇毒', turns: 3, tag: 'poison' });
  const r3 = e.exec('诊脉');
  ok('身上有毒 → 诊得出', /蛇毒/.test(txt(r3)), (txt(r3).match(/脉象里有东西[^\n]*/) || [''])[0]);
}

/* ================= ③ 医治 ================= */
section('③ 医治：回气血 / 耗内力 / 走时间 / 有上限');
{
  const e = boot(); const p = learnMed(e);
  p.hp = 60;
  const mpBefore = p.mp, tBefore = p.timeMinutes;
  const r = e.exec('医治');
  ok('★ 医治回了气血', p.hp > 60, `60 → ${Math.round(p.hp)}`);
  ok('★ 消耗了内力', p.mp < mpBefore, `${Math.round(mpBefore)} → ${Math.round(p.mp)}`);
  ok('★ 花掉了时间', p.timeMinutes > tBefore, `${tBefore} → ${p.timeMinutes}`);
  ok('画面上写清了补回多少', /气血 \+\d+/.test(txt(r)), (txt(r).match(/气血 \+\d+[^\n]*/) || [''])[0]);
  ok('补的量不超过 healAmount', Math.round(p.hp) - 60 <= MED.healAmount(p, p) + 0.5, '补了 ' + Math.round(p.hp - 60));

  /* 上限得**从重伤出发**才验得准：60 血 + 上限 32 正好到顶，
     那种起点下「没拉满」本来就不该成立（第一版就是这么写错的）。 */
  const e2 = boot(); const p2 = learnMed(e2);
  p2.hp = 10;
  e2.exec('医治');
  ok('★ 一次补的量有上限：从重伤出发也拉不满', p2.hp < p2.maxHp, `${Math.round(p2.hp)}/${Math.round(p2.maxHp)}`);
}

section('③b 满血不用治 / 内力不够治不了');
{
  const e = boot(); const p = learnMed(e);
  const full = e.exec('医治');
  ok('气血满时不白费功夫', /用不着/.test(txt(full)), txt(full).slice(0, 24));

  p.hp = 20; p.mp = 0;
  const noMp = e.exec('医治');
  ok('★ 内力不够明确拒绝，并说清差多少', /内力不济/.test(txt(noMp)), txt(noMp).slice(0, 44));
  ok('拒绝时没有偷偷扣血/回血', p.hp === 20, 'hp=' + Math.round(p.hp));
}

/* ================= ④ 治别人：好感 + 诊金 ================= */
section('④ 替人治伤：人情账要动');
{
  const e = boot(); const p = learnMed(e);
  const w = e.world;
  const npc = w.npcsIn(p.room)[0];
  if (!npc) { ok('（初始房间没有 NPC，跳过治人断言）', true); }
  else {
    npc.hp = Math.max(1, Math.round((npc.maxHp || 100) * 0.3));
    const favBefore = npc.favor || 0;
    const r = e.exec('医治 ' + npc.name);
    ok('★ 治的是别人也回血', npc.hp > (npc.maxHp || 100) * 0.3, Math.round(npc.hp) + '/' + Math.round(npc.maxHp));
    ok('★ 治好了涨好感', (npc.favor || 0) > favBefore, `${Math.round(favBefore)} → ${Math.round(npc.favor || 0)}`);

    /* 富户会给诊金 */
    const e2 = boot(); const p2 = learnMed(e2);
    const npc2 = e2.world.npcsIn(p2.room)[0];
    if (npc2) {
      npc2.hp = Math.max(1, Math.round((npc2.maxHp || 100) * 0.3));
      npc2.carry = npc2.carry || {};
      npc2.carry.money = 800;
      const myBefore = p2.money || 0;
      const r2 = e2.exec('医治 ' + npc2.name);
      ok('★ 出得起钱的会给诊金', (p2.money || 0) > myBefore, `${myBefore} → ${p2.money}`);
      ok('诊金是从他口袋里出的（不是凭空印的）', npc2.carry.money < 800, '他身上剩 ' + npc2.carry.money);
    }
  }
}

/* ================= ⑤ 解毒 ================= */
section('⑤ 解毒：一次揭一层');
{
  const e = boot(); const p = learnMed(e);
  p.addBuff({ name: '蛇毒', turns: 4, tag: 'poison' });
  const before = (p.buffs || []).length;
  const r = e.exec('解毒');
  ok('★ 解掉了一层毒', (p.buffs || []).length === before - 1, `${before} → ${(p.buffs || []).length}`);
  ok('画面写明解了什么、耗了多少内力', /解去「蛇毒」/.test(txt(r)), (txt(r).match(/解去[^\n]*/) || [''])[0]);

  /* 多层：医术浅只揭一层 */
  const e2 = boot(); const p2 = learnMed(e2);
  p2.addBuff({ name: '蛇毒', turns: 4, tag: 'poison' });
  p2.addBuff({ name: '蒙汗药', turns: 4, tag: 'drug' });
  p2.addBuff({ name: '暗伤', turns: 4, tag: 'wound' });
  e2.exec('解毒');
  ok('★ 身上三样，一次只解一样（医术浅拔不干净）', (p2.buffs || []).length === 2, '还剩 ' + (p2.buffs || []).length);

  /* 没毒可解 */
  const e3 = boot(); const p3 = learnMed(e3);
  const none = e3.exec('解毒');
  ok('身上干净时老实说没有要解的', /没有要解的/.test(txt(none)), txt(none).slice(0, 26));
}

/* ================= ⑥ 医术越深，一次越多 ================= */
section('⑥ 医术是练出来的，不是等级给的');
{
  const e = boot();
  const p = e.world.player;
  p.learnSkill(MED.MED_ID, { force: true });
  p.learned[MED.MED_ID].level = 30;
  const low = MED.healAmount(p, p);
  p.learned[MED.MED_ID].level = 300;
  const high = MED.healAmount(p, p);
  ok('★ 医术熟练度越高，一次补得越多', high > low, `${low} → ${high}`);

  /* 内功也是底气。⚠️ 这里看 **power()** 而不是 healAmount ——
     后者有「一次最多补 35% 气血」的硬顶，高位时两个等级会被顶成同一个数，
     那样断言看起来在测「内功无用」，其实只是撞到了顶。 */
  const before = MED.power(p);
  p.equippedSkills['内功'] = 'basic_force';
  p.learnSkill('basic_force', { force: true });
  p.learned['basic_force'].level = 300;
  ok('★ 内功火候算进医术功力（光背汤头歌治不了内伤）', MED.power(p) > before, `${before} → ${MED.power(p)}`);
}

/* ================= ⑦ 目标查找含「躺在地上的人」 ================= */
section('⑦ 倒地的人也要治得到');
{
  const e = boot(); const p = learnMed(e);
  const w = e.world;
  const npc = w.npcsIn(p.room)[0];
  if (npc) {
    npc.hp = 1;
    npc.knockedOut = true;
    npc.dead = true;                 /* 倒地 = knockedOut + dead（见项目铁律） */
    const r = e.exec('医治 ' + npc.name);
    ok('★ 倒地的人也在可治疗名单里（不会「这里没有某某」）',
      !/这里没有/.test(txt(r)), txt(r).slice(0, 40));
  } else {
    ok('（没有 NPC，跳过）', true);
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
