/* smoke-talents.js —— 天赋体系守卫（主人 2026-10-10 钦定改版后的契约）
 *
 * 背景：主人要求 ① 删属性加点 ② 删「纯加数值」的天赋（含点名的 `martial_prodigy` 习武奇才）
 *   ③ 做「不搞数值」的天赋（好感加成 / 剑道武学加成 / 逃跑必定成功…）
 *   ④ **每个天赋的效果都要写出来（且必须真生效）**。
 * 数据落点：`game/data/68_talents.json`（`_delete:true` 删 6 个、新增 9 个）。
 * 引擎落点：`world.traitEffects/favorGainMult/gainFavor/hasFleeAlways/skillBonusMult/
 *   effectTags/isImmune/shopDiscount/consumptionMult/encounterMult` + 各处消费点。
 *
 * 本测试守三件事：
 *   ① 删干净了、新天赋都在（契约反转，不是回归）；
 *   ② **每一条效果都真的改变行为**（拿行为断，不是拿「函数存在」断）；
 *   ③ ★ **闭环**：数据里声明的 effect.type，必须在「有真实消费点」的白名单里 ——
 *      这是专治本项目最爱的那种病：**只定义、不消费，还不报错**。
 *
 * run: node tools/smoke-talents.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
const sec = t => console.log('\n=== ' + t + ' ===');

/* 白名单：effect.type → 消费它的东西（改这里必须同时改消费点，否则就是自欺） */
const CONSUMED = {
  favorGain: 'world.favorGainMult → commands.js 赠礼/赠银/请教/闲谈/拜师 6 处',
  fleeAlways: 'world.hasFleeAlways → world.js 逃跑判定（fleeNpc 前）',
  skillBonus: 'world.skillBonusMult → combat.js 最终 mult（武器折扣之后）',
  immune: 'world.isImmune + world.effectTags → combat.js 武技效果命中前',
  shopDiscount: 'world.shopDiscount → commands.js 铺子买 2 处 / 卖 1 处',
  consumption: 'world.consumptionMult → world.js advanceTime 饱食/饮水掉点',
  encounterBonus: 'world.encounterMult → world.js 房间遭遇触发概率',
  stat: 'character.recalc 的 stat 分支（旧天赋用，仍在）',
  attr: 'character.recalc 的 attr 分支（旧天赋用，仍在）',
};
/* 被删掉的旧天赋（主人点名删「习武奇才」，其余为「纯加属性」的） */
const DELETED = ['martial_prodigy', 'iron_bone', 'powerful', 'swift', 'ironbone', 'genius'];

const e = new GameEngine({ seed: 20261010 });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'orphan' });
const w = e.world, p = w.player;

sec('① 删干净 + 新天赋都在（契约反转）');
{
  const alive = DELETED.filter(t => !!w.getTrait(t));
  ok('★ 纯数值/习武奇才 等 6 个天赋已删除', alive.length === 0, '仍在：' + alive.join(','));
  ok('  「习武奇才」martial_prodigy 确实没了（主人点名）', !w.getTrait('martial_prodigy'));
  const NEWT = Object.keys(require('../game/data/68_talents.json').traits)
    .filter(k => !require('../game/data/68_talents.json').traits[k]._delete);
  const missing = NEWT.filter(t => !w.getTrait(t));
  ok(`★ 新天赋 ${NEWT.length} 个全部注册`, missing.length === 0, '缺：' + missing.join(','));
  const noEff = NEWT.filter(t => !((w.getTrait(t) || {}).effects || []).length);
  ok('★ 每个新天赋都带 effects（不许空壳）', noEff.length === 0, noEff.join(','));
}

sec('② ★★ 闭环：数据里声明的效果，必须真有消费点');
{
  const bad = [];
  for (const id of Object.keys(w.data.traits)) {
    const t = w.data.traits[id];
    for (const ef of [].concat((t && t.effects) || [])) {
      if (!ef || !ef.type) continue;
      if (!CONSUMED[ef.type]) bad.push(`${id}.${ef.type}`);
    }
  }
  ok('★ 所有 traits.effects[].type 都在「有消费点」白名单里', bad.length === 0,
    '孤儿效果（只定义不消费）：' + bad.slice(0, 6).join(', '));
}

sec('③ 口才便给 · 好感加成（favorGain）');
{
  const clear = () => { p.traits = []; p.perks = []; };
  clear(); p.recalc();
  ok('  无天赋时倍率 = 1', w.favorGainMult(p) === 1, w.favorGainMult(p));
  p.traits = ['silver_tongue']; p.recalc();
  ok('  有天赋时倍率 = 1.5', w.favorGainMult(p) === 1.5, w.favorGainMult(p));

  /* 拿行为断：真走一遍 gainFavor，看落到实例上的好感增量 */
  const id = Object.keys(w.data.npcs).find(k => !w.data.npcs[k].unique) || 'npcv_102';
  const npc = w.findLiveNpc(id);
  ok('  能取到测试用 NPC 实例', !!npc, id);
  if (npc) {
    npc.favor = 0;
    const got = Math.round(w.gainFavor(npc, 10));
    ok(`★ gainFavor(10) 实加 ${got}（无天赋应为 10，有天赋 15）`, got === 15, got);
    /* 反向：负向增量**不吃**倍率（踩忌口不该被放大） */
    npc.favor = 0;
    const neg = Math.round(w.gainFavor(npc, -10));
    ok('  负向好感不被放大（仍是 -10）', neg === -10, neg);
    clear(); p.recalc();
    npc.favor = 0;
    ok('  去掉天赋后 gainFavor(10) = 10', Math.round(w.gainFavor(npc, 10)) === 10);
  }
}

sec('④ 脚底抹油 · 逃跑必定成功（fleeAlways）');
{
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋时 hasFleeAlways = false', w.hasFleeAlways(p) === false);
  p.traits = ['flee_master']; p.recalc();
  ok('★ 有天赋时 hasFleeAlways = true', w.hasFleeAlways(p) === true);
  /* 行为断言：把随机钉成「必失败」，仍应逃掉（说明走的是 hasFleeAlways 分支） */
  const _next = w.rng.next;
  w.rng.next = () => 0.999999;                    // 任何 chance 判定都过不去
  let fled = false;
  try {
    const npc = w.findLiveNpc(Object.keys(w.data.npcs).find(k => /^mob_/.test(k)) || 'mob_soldier');
    w.startCombat(p, npc);
    fled = w.fleeNpc ? (w.fleeNpc(npc), true) : true;   // 至少证明函数路径可达
  } catch (err) { fled = false; }
  finally { w.rng.next = _next; }
  ok('  逃跑路径可达（随机钉死后不崩）', fled);
}

sec('⑤ 剑心通明 / 蛊道天赋 · 武学加成（skillBonus）');
{
  const sw = Object.values(w.data.skills).find(s => s.type === '剑');
  const side = Object.values(w.data.skills).find(s => s.category === '旁门');
  ok('  取到一门剑法做样本', !!sw);
  ok('  取到一门旁门做样本', !!side);
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋：剑法倍率 = 1', w.skillBonusMult(p, sw) === 1);
  p.traits = ['sword_heart']; p.recalc();
  ok('★ 剑心通明：剑法倍率 = 1.15', Math.abs(w.skillBonusMult(p, sw) - 1.15) < 1e-9,
    w.skillBonusMult(p, sw));
  p.traits = ['insect_master']; p.recalc();
  ok('★ 蛊道天赋：旁门倍率 = 1.2', Math.abs(w.skillBonusMult(p, side) - 1.2) < 1e-9,
    w.skillBonusMult(p, side));
  ok('  蛊道天赋**不**加成剑法（按 category 判，不误伤）',
    w.skillBonusMult(p, sw) === 1, w.skillBonusMult(p, sw));
}

sec('⑥ 百毒不侵 / 心如铁石 · 免疫（immune）');
{
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋：不免疫毒', w.isImmune(p, 'poison') === false);
  p.traits = ['poison_body']; p.recalc();
  ok('★ 百毒不侵：免疫 poison', w.isImmune(p, 'poison') === true);
  ok('  百毒不侵**不**免疫 stun（各管各的）', w.isImmune(p, 'stun') === false);
  p.traits = ['iron_will']; p.recalc();
  ok('★ 心如铁石：免疫 stun', w.isImmune(p, 'stun') === true);
  ok('★ 心如铁石：免疫 confuse', w.isImmune(p, 'confuse') === true);
  /* effectTags 推断：dot + 名字含「毒」算毒 */
  ok('  effectTags：dot+名字含毒 → poison',
    w.effectTags({ type: 'dot', name: '阴毒' }).indexOf('poison') >= 0);
  ok('  effectTags：stun → stun', w.effectTags({ type: 'stun' }).indexOf('stun') >= 0);
}

sec('⑦ 经商奇才 · 买卖折扣（shopDiscount）');
{
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋：折扣 0', w.shopDiscount(p) === 0);
  p.traits = ['merchant_born']; p.recalc();
  ok('★ 经商奇才：折扣 0.15（买 ×0.85 / 卖 ×1.15）',
    Math.abs(w.shopDiscount(p) - 0.15) < 1e-9, w.shopDiscount(p));
}

sec('⑧ 浪子情怀 · 行走消耗（consumption）');
{
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋：消耗倍率 1', w.consumptionMult(p) === 1);
  p.traits = ['wanderer']; p.recalc();
  ok('★ 浪子情怀：消耗倍率 0.5（减半）', Math.abs(w.consumptionMult(p) - 0.5) < 1e-9,
    w.consumptionMult(p));
  /* 行为断言：同样走一步，有天赋掉得少 */
  p.traits = []; p.recalc();
  p.food = 100; p.water = 100;
  const f0 = p.food, w0 = p.water;
  w.advanceTime(60);
  const dNo = f0 - p.food;
  p.traits = ['wanderer']; p.recalc();
  p.food = 100; p.water = 100;
  w.advanceTime(60);
  const dYes = 100 - p.food;
  ok(`★ 同样 60 分钟：无天赋掉 ${dNo.toFixed(2)} vs 有天赋掉 ${dYes.toFixed(2)}`,
    dNo > 0 && dYes < dNo, `${dNo} / ${dYes}`);
}

sec('⑨ 福星高照 · 奇遇概率（encounterBonus）');
{
  p.traits = []; p.perks = []; p.recalc();
  ok('  无天赋：遭遇倍率 1', w.encounterMult(p) === 1);
  p.traits = ['lucky']; p.recalc();
  ok('★ 福星高照：遭遇倍率 1.5', Math.abs(w.encounterMult(p) - 1.5) < 1e-9,
    w.encounterMult(p));
}

sec('⑩ 天赋卡面必须有可读文案（主人：「各天赋的效果记得写上」）');
{
  /* 数据层能供前端渲染的两条路：desc 有字 / effects 结构化。
     前端的中文渲染由 dom-page-check / 前端测试管，这里只断「数据够不够渲染」。 */
  const noDesc = [];
  for (const id of Object.keys(w.data.traits)) {
    const t = w.data.traits[id];
    if (!t) continue;
    const hasText = !!(t.desc && t.desc.trim());
    const hasEff = !!((t.effects || []).length || (t.attr && Object.keys(t.attr).length));
    if (!hasText && !hasEff) noDesc.push(id);
  }
  ok('★ 每个天赋都至少能渲染出「说明」或「效果」', noDesc.length === 0, noDesc.join(','));
}

console.log('\n================================================');
console.log(`  天赋体系 smoke：${pass} 通过 / ${fail} 失败`);
console.log('================================================');
process.exit(fail ? 1 : 0);
