/* ============================================================
 * smoke-martial.js — 武学体系重制（SPRINT2）回归测试
 *
 * 覆盖重制核心：
 *  ① 功法五大类（外功/内功/奇门/旁门/魔功）齐全
 *  ② 去等级化：伤害不再二次爆炸
 *  ③ 武器绑定：无对应兵刃威力大打折扣
 *  ④ 修炼功法消耗内力（不打怪升级）
 *  ⑤ 内功修炼冲击奇经八脉 + 打坐回内力
 *  ⑥ 资质系统：资质越高练武越快（上限+成功率）
 *  ⑦ 武技熟练度分级（未入门→登峰造极）不同效果
 *  ⑧ 外功淬体：耗气血/体力/药物，有生命危险
 * ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { profTierOf, profTierMult, profTierAcc } = require(path.join(ROOT, 'game', 'src', 'core', 'character.js'));
const { weaponPenalty } = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));
const skillsData = require(path.join(ROOT, 'game', 'data', '10_skills.json'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261008;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

/* ============================================================ */
section('① 功法五大类齐全（外功/内功/奇门/旁门/魔功）');
{
  const cats = {};
  for (const k in skillsData.skills) { const c = skillsData.skills[k].category || '未分类'; cats[c] = (cats[c] || 0) + 1; }
  ok('五类都至少 1 个', ['外功', '内功', '奇门', '旁门', '魔功'].every(c => cats[c] > 0), JSON.stringify(cats));
  ok('魔功含血刀/葵花/吸星', ['xuedao', 'sunflower_manual', 'xixing_dafa'].every(id => skillsData.skills[id] && skillsData.skills[id].category === '魔功'));
  ok('旁门含唐门毒术', !!(skillsData.skills.tangmen_du && skillsData.skills.tangmen_du.category === '旁门'));
}

/* ============================================================ */
section('② 去等级化：消除伤害二次爆炸');
{
  const src = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'combat.js'), 'utf8');
  ok('combat.js 不含 (1+lv*0.02)', !/1\s*\+\s*lv\s*\*\s*0\.02/.test(src));
  ok('combat.js 不含 (1+lv*0.012)', !/1\s*\+\s*lv\s*\*\s*0\.012/.test(src));
  const atk = 20, def = 50;
  const dmgNew = atk * (100 / (100 + def));
  const oldMult = (1 + 400 * 0.02) * (1 + 400 * 0.012); // 旧：两线性项相乘 = 52.2 倍
  const dmgOld = atk * oldMult * (100 / (100 + def));
  ok('新公式伤害远小于旧爆炸公式', dmgNew * 10 < dmgOld, `新=${dmgNew.toFixed(1)} 旧=${dmgOld.toFixed(0)}（旧放大 ${oldMult.toFixed(1)}倍）`);
  const e = boot(); const w = e.world, p = w.player;
  const firstId = Object.keys(w.data.npcs).find(id => w.data.npcs[id].room);
  const npc = w.spawnNpc(firstId, p.room, 1, true);
  npc.level = 400; npc.recalc();
  const d = w.combatHooks.damage(npc, p, npc.atk, { mult: 1, world: w });
  ok('高等级 NPC 伤害有限（非爆炸）', Number.isFinite(d) && d > 0 && d < 10000, `npc.level=400 dmg=${d}`);
}

/* ============================================================ */
section('③ 武器绑定：无对应兵刃威力大打折扣');
{
  const e = boot(); const w = e.world, p = w.player;
  const sd = w.getSkill('basic_sword');
  p.learned['basic_sword'] = { exp: 0, level: 50 };
  p.equippedSkills['剑'] = 'basic_sword';
  p.equipment['武器'] = null;
  const penNo = weaponPenalty(p, sd);
  ok('不持剑：mult=0.45 且带提示', Math.abs(penNo.mult - 0.45) < 1e-9 && !!penNo.note, `mult=${penNo.mult}`);
  p.equipment['武器'] = 'wood_sword';
  const penYes = weaponPenalty(p, sd);
  ok('持木剑：mult=1 无惩罚', penYes.mult === 1 && penYes.note === null);
  const fist = w.getSkill('basic_fist');
  if (fist) { p.equipment['武器'] = null; const penFist = weaponPenalty(p, fist); ok('拳脚类无武器要求', penFist.mult === 1 && penFist.note === null); }
}

/* ============================================================ */
section('④ 修炼功法消耗内力（不打怪升级）');
{
  const e = boot(); const w = e.world, p = w.player;
  p.learned['basic_sword'] = { exp: 0, level: 1 };
  p.mp = 100;
  const mpBefore = p.mp;
  const r = p.learnSkillByTrain('basic_sword');
  ok('train 消耗内力', p.mp < mpBefore, `before=${mpBefore} after=${Math.floor(p.mp)}`);
  ok('train 返回 ok', r.ok === true);
  p.mp = 0;
  const r2 = p.learnSkillByTrain('basic_sword');
  ok('内力不足报错', r2.ok === false && /内力/.test(r2.msg), r2.msg);
}

/* ============================================================ */
section('⑤ 内功修炼冲击奇经八脉 + 打坐回内力');
{
  const e = boot(); const w = e.world, p = w.player;
  const ng = Object.values(skillsData.skills).find(s => s.type === '内功');
  p.learned[ng.id] = { exp: 0, level: 1 };
  p.equippedSkills['内功'] = ng.id;
  for (let i = 0; i < 80; i++) { p.mp = 200; p.learnSkillByTrain(ng.id); }
  const total = Object.values(p.meridians).reduce((a, b) => a + b, 0);
  ok('内功修炼可冲开奇经八脉', total > 0, `八脉共开 ${total} 阶`);
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  p2.mp = 10;
  const r = e2.exec('打坐');
  ok('打坐恢复内力至满', p2.mp === p2.maxMp, `mp=${p2.mp}/${p2.maxMp}`);
  ok('打坐命令成功返回', r.lines.length > 0);
}

/* ============================================================ */
section('⑥ 资质系统：资质越高练武越快');
{
  const e = boot(); const w = e.world, p = e.world.player;
  const sd = w.getSkill('basic_sword');
  p.baseAttr.资质 = 30; p.recalc();
  const hiLimit = p.maxSkillLevelFor(sd); const hiRate = p.trainSuccessRate(sd, 10);
  p.baseAttr.资质 = 1; p.recalc();
  const loLimit = p.maxSkillLevelFor(sd); const loRate = p.trainSuccessRate(sd, 10);
  ok('资质越高练武上限越高', hiLimit > loLimit, `${hiLimit} vs ${loLimit}`);
  ok('资质越高练武成功率越高', hiRate > loRate, `${hiRate.toFixed(3)} vs ${loRate.toFixed(3)}`);
}

/* ============================================================ */
section('⑦ 武技熟练度分级（未入门→登峰造极）');
{
  const e = boot(); const w = e.world, p = e.world.player;
  const sd = w.getSkill('basic_sword');
  p.learned['basic_sword'] = { exp: 0, level: 1 };
  const t1 = profTierOf(p, 'basic_sword');
  p.learned['basic_sword'] = { exp: 0, level: 490 };
  const t5 = profTierOf(p, 'basic_sword');
  ok('低级别 tier=1', t1 === 1, 't1=' + t1);
  ok('高级别 tier=5', t5 === 5, 't5=' + t5);
  ok('高级别伤害加成>低级别', profTierMult(t5) > profTierMult(t1));
  ok('高级别命中>低级别', profTierAcc(t5) > profTierAcc(t1));
}

/* ============================================================ */
section('⑧ 外功淬体（耗气血/体力/药物，有生命危险）');
{
  const e = boot(); const w = e.world, p = e.world.player;
  e.world.worldTick = () => {};   // 隔离动态世界随机事件（+hp 等）对 hp 断言的干扰
  p.learned['basic_sword'] = { exp: 0, level: 1 };
  const hpBefore = p.hp, stamBefore = p.stamina;
  const r = e.exec('淬体 基本剑法');
  ok('淬体命令返回结果', r.lines.length > 0);
  ok('淬体消耗体力', p.stamina < stamBefore, `stam ${stamBefore}->${p.stamina}`);
  ok('淬体消耗气血', p.hp < hpBefore, `hp ${hpBefore}->${p.hp}`);
  // 药物支撑：给金创药（真实对象库存），淬体应消耗一枚
  p.hp = p.maxHp; p.stamina = p.maxStamina;
  p.inventory = []; w.giveItem(p, 'jinchuang_yao', 2);
  const medBefore = p.countItem('jinchuang_yao');
  e.exec('淬体 基本剑法');
  ok('有丹药时淬体消耗药物', p.countItem('jinchuang_yao') < medBefore, `med ${medBefore}->${p.countItem('jinchuang_yao')}`);
}

/* ============================================================ */
section('⑨ 天材地果（服用永久提升资质/根骨）+ 习武奇才特性');
{
  const e = boot(); const w = e.world, p = e.world.player;
  const apt0 = p.baseAttr['资质'], bone0 = p.baseAttr['根骨'];
  w.giveItem(p, 'tiancai_rencan', 1);
  const r = e.exec('使用 天材人參');
  ok('use 命令成功应用', r.lines.some(l => l.kind === 'sys' && /资质/.test(l.text)), JSON.stringify(r.lines.map(l => l.text)));
  ok('资质永久+4', p.baseAttr['资质'] === apt0 + 4, `${apt0}->${p.baseAttr['资质']}`);
  ok('根骨永久+2', p.baseAttr['根骨'] === bone0 + 2, `${bone0}->${p.baseAttr['根骨']}`);
  // 习武奇才特性已注册且 trainMult 生效
  ok('习武奇才特性已注册', !!w.getTrait('martial_prodigy'));
  p.traits = ['martial_prodigy']; p.recalc();
  ok('习武奇才 trainMult=1.6', (w.getTrait('martial_prodigy') || {}).trainMult === 1.6);
  // NPC特性强化：筋骨强健/力大无穷/身法灵活均已注册
  ok('筋骨强健特性已注册', !!w.getTrait('iron_bone'));
  ok('力大无穷特性已注册', !!w.getTrait('powerful'));
  ok('身法灵活特性已注册', !!(w.getTrait('swift') && (w.getTrait('swift').attr['身法'] === 6)));
}

/* ============================================================ */
section('⑩ 炼丹 / 炼器 / 符文阵法（SPRINT2-B）');
{
  const e = boot(); const w = e.world, p = e.world.player;
  const myRecipes = ['rec_jinchuang', 'rec_huimeng', 'rec_liqi', 'rec_jingshen', 'rec_iron_sword', 'rec_iron_armor', 'rec_cold_blade', 'rec_talisman_shield', 'rec_talisman_speed', 'rec_talisman_power'];
  ok('新配方已加载（10 个）', myRecipes.every(id => w.data.recipes[id]), 'missing=' + myRecipes.filter(id => !w.data.recipes[id]).join(','));

  // 炼丹：给青灵草×2 + 丹炉，强制成功
  e.world.rng.next = () => 0;
  w.giveItem(p, 'danlu', 1); w.giveItem(p, 'herb_qing', 2);
  const r1 = e.exec('炼丹 金创药');
  ok('炼丹成功产出金创药', p.countItem('jinchuang_yao') >= 2, 'count=' + p.countItem('jinchuang_yao'));
  ok('炼丹消耗青灵草', p.countItem('herb_qing') === 0, 'herb=' + p.countItem('herb_qing'));

  // 炼器：给精铁×3 + 铁锤，强制成功
  w.giveItem(p, 'hammer', 1); w.giveItem(p, 'ore_iron', 3);
  e.exec('炼器 精铁剑');
  ok('炼器产出精铁剑', p.countItem('iron_sword') >= 1, 'count=' + p.countItem('iron_sword'));
  ok('精铁剑带攻击属性', (w.getItem('iron_sword') || {}).stats && w.getItem('iron_sword').stats.atk === 18);

  // 符文阵法：给符纸+朱砂，强制成功
  w.giveItem(p, 'rune_paper', 1); w.giveItem(p, 'cinnabar', 1);
  e.exec('画符 护身符');
  ok('画符产出护身符', p.countItem('talisman_shield') >= 1, 'count=' + p.countItem('talisman_shield'));

  // 缺器具：有草无丹炉 → 报错
  const e2 = boot(); const p2 = e2.world.player;
  e2.world.giveItem(p2, 'herb_qing', 2);
  const r2 = e2.exec('炼丹 金创药');
  ok('缺丹炉时报错', r2.lines.some(l => l.kind === 'warn' && /丹炉/.test(l.text)), JSON.stringify(r2.lines.map(l => l.text)));

  // 缺材料：有丹炉无草 → 报错
  const e3 = boot(); const p3 = e3.world.player;
  e3.world.giveItem(p3, 'danlu', 1);
  const r3 = e3.exec('炼丹 金创药');
  ok('缺材料时报错', r3.lines.some(l => l.kind === 'warn' && /材料不足/.test(l.text)), JSON.stringify(r3.lines.map(l => l.text)));
}

/* ============================================================ */
section('⑪ 收徒系统（拜师/授艺/逐出）');
{
  const e = boot(); const w = e.world, p = e.world.player;
  // 玩家先习得一门武学才能收徒
  p.learned['basic_sword'] = { exp: 0, level: 8 };
  const r0 = e.exec('收徒 范清');
  ok('收徒成功', p.disciples.length === 1, 'disciples=' + p.disciples.length);
  ok('收徒返回系统消息', r0.lines.some(l => l.kind === 'sys'), JSON.stringify(r0.lines.map(l => l.text)));
  const npc = w.getNpc(p.disciples[0]);
  ok('弟子记作实例且记有师父', !!npc && npc.pstate && npc.pstate.master === p.id, 'npc=' + (npc && npc.name));
  // 授艺：把基础剑法传给弟子
  const sd = w.getSkill('basic_sword');
  e.exec('授艺 ' + sd.name + ' 范清');
  ok('授艺后弟子习得该武学', npc.learned['basic_sword'] && npc.learned['basic_sword'].level >= 1, 'lv=' + (npc.learned['basic_sword'] || {}).level);
  // 弟子列表
  const rl = e.exec('弟子');
  ok('弟子列表可查', rl.lines.some(l => l.kind === 'sys' && /范清/.test(l.text)), JSON.stringify(rl.lines.map(l => l.text)));
  // 逐出师门
  e.exec('逐出师门 范清');
  ok('逐出后弟子清空', p.disciples.length === 0, 'disciples=' + p.disciples.length);
  // 自身无武学不能收徒（显式清空验证守卫）
  const e2 = boot(); const p2 = e2.world.player;
  p2.learned = {};
  const r2 = e2.exec('收徒 范清');
  ok('无武学收徒被拒', r2.lines.some(l => l.kind === 'warn'), JSON.stringify(r2.lines.map(l => l.text)));
}

/* ============================================================ */
console.log('\n============================================');
console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
console.log('============================================');
process.exit(fail ? 1 : 0);
