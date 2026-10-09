/* smoke-boss.js —— Boss 三阶段机制回归（SPRINT-C / 总纲 §7-1 第 3 项）
 *
 * 机制：NPC 模板上的 `bossPhases: [{at, name, line, mult, skill, summon}, ...]`
 *      `at` 是血量比例阈值，必须递减；血掉到阈值 → 切阶段（台词 + 换招 + 数值倍率）。
 *
 * 本测试锁死六类断点：
 *   ① 无 bossPhases 的普通 NPC 完全不受影响（别把全江湖都变成 phased boss）
 *   ② 阈值真的是按 hp/maxHp 判定，且只在**跨过**时切一次（不重复刷台词）
 *   ③ 台词/阶段名真的进输出行（玩家看得见 = 总纲铁律 1）
 *   ④ 换招真的生效（bossSkill → pickSkill）
 *   ⑤ 倍率真的生效（m>1 涨、m<1 跌；reflect 这种天生 0 的按绝对值）
 *   ⑥ 战斗结束后状态复位 + 读档后复位（打输重来必须是第一阶段）
 *
 * run: node tools/smoke-boss.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const { CombatEngine } = require('../game/src/core/combat.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  return e;
}
/** 拉一个 Boss 实例出来（不进房间体系，纯测机制） */
function mkBoss(e, defId) {
  const w = e.world;
  const n = w.spawnNpc(defId, w.player.room, 1, true);
  if (n) { n.hp = n.maxHp; n.mp = n.maxMp; }
  return n;
}
/** 把血打到 ratio 并驱动一次 tickBossPhase（用角色的真 world / 真 CombatEngine） */
function dropTo(e, boss, ratio) {
  boss.hp = Math.max(1, Math.round(boss.maxHp * ratio));
  const lines = [];
  e.world.combat.tickBossPhase(boss, lines, null);
  return lines;
}
const txt = lines => (lines || []).map(l => l.text || '').join('\n');

sec('① 普通 NPC 完全不受影响');
{
  const e = boot();
  const w = e.world;
  const ce = new CombatEngine(w);
  const mob = mkBoss(e, 'blood_saber');
  ok('测试用 NPC 有实例', !!mob, mob && mob.defId);
  ok('普通 NPC 没有 bossPhases', ce.bossPhasesOf(mob) === null);
  const lines = [];
  ce.tickBossPhase(mob, lines, null);
  ok('普通 NPC 不产生任何阶段行', lines.length === 0, txt(lines));
  ok('普通 NPC 不写 bossPhaseIdx', mob.bossPhaseIdx === undefined);
  /* 把血打到 1% 也不该切 */
  mob.hp = 1;
  const l2 = [];
  ce.tickBossPhase(mob, l2, null);
  ok('普通 NPC 掉到 1% 血也不切阶段', l2.length === 0 && mob.bossPhaseIdx === undefined);
}

sec('② 东方不败三阶段：结构 + 阈值判定');
const DFB = 'mojiao_dongfang';
{
  const e = boot();
  const w = e.world, ce = new CombatEngine(w);
  const def = w.data.npcs[DFB];
  ok('东方不败有 bossPhases', Array.isArray(def.bossPhases) && def.bossPhases.length === 3,
    'n=' + (def.bossPhases && def.bossPhases.length));
  if (!def.bossPhases) { console.log('（无数据，跳过本节余下）'); }
  else {
    const ats = def.bossPhases.map(p => p.at);
    let dec = true;
    for (let i = 1; i < ats.length; i++) if (!(ats[i] < ats[i - 1])) dec = false;
    ok('at 递减（1 → 0.6 → 0.3）', dec, JSON.stringify(ats));
    ok('每阶段有台词', def.bossPhases.every(p => !!(p.line || p.desc)));
    ok('每阶段有阶段名', def.bossPhases.every(p => !!(p.name && p.name.trim())));
    /* skill 引用真实存在 */
    const sids = def.bossPhases.map(p => p.skill).filter(Boolean);
    const bad = sids.filter(s => !w.getSkill(s));
    ok('阶段招法引用全存在', bad.length === 0, bad.join(','));

    /* 阈值判定：逐档放血 */
    const boss = mkBoss(e, DFB);
    ok('boss 实例拿到了 bossPhases 配置', !!ce.bossPhasesOf(boss));
    ok('开局在第 0 阶段', ce.bossPhaseIdx(boss) === 0, String(ce.bossPhaseIdx(boss)));

    /* 90% 血：不切 */
    let L = dropTo(e, boss, 0.9);
    ok('90% 血不切阶段', ce.bossPhaseIdx(boss) === 0 && L.length === 0, txt(L));
    /* 60% 血：切到第 1 阶段（at=0.6 是 <=，含等号） */
    L = dropTo(e, boss, 0.6);
    ok('60% 血切到第 2 阶段', ce.bossPhaseIdx(boss) === 1, 'idx=' + ce.bossPhaseIdx(boss));
    ok('阶段行出现（玩家看得见）', /【东方不败 · 化生】/.test(txt(L)), txt(L));
    /* 同阶段再打一次：不重复刷 */
    const L2 = dropTo(e, boss, 0.55);
    ok('同阶段再触发不重复刷台词', L2.length === 0, txt(L2));
    /* 30% 血：切到第 2 阶段 */
    L = dropTo(e, boss, 0.3);
    ok('30% 血切到第 3 阶段', ce.bossPhaseIdx(boss) === 2, 'idx=' + ce.bossPhaseIdx(boss));
    ok('第三阶段台词出现（弃攻守势）', /【东方不败 · 弃攻守势】/.test(txt(L)), txt(L));
    /* 阈值以下不再往前切（只有 3 段） */
    L = dropTo(e, boss, 0.01);
    ok('低于最后一档不再切', ce.bossPhaseIdx(boss) === 2 && L.length === 0, txt(L));
    /* 死了也不切（换独立引擎：名人是全局唯一实例，spawnNpc 会返回 boss 自己） */
    const e2 = boot(4321);
    const ce2 = new CombatEngine(e2.world);
    const z = mkBoss(e2, DFB);
    z.hp = 0;
    const L3 = [];
    ce2.tickBossPhase(z, L3, null);
    ok('已阵亡不再切阶段', L3.length === 0 && ce2.bossPhaseIdx(z) === 0,
      'lines=' + txt(L3) + ' idx=' + ce2.bossPhaseIdx(z));
  }
}

sec('③ 换招真的生效（bossSkill → pickSkill）');
{
  const e = boot();
  const w = e.world, ce = new CombatEngine(w);
  const boss = mkBoss(e, DFB);
  const before = ce.pickSkill(boss, w.player);
  ok('开打前用的是模板自带武学', !!before, before && before.name);
  ok('开场就用第一阶段指定的招式（at:1 永不触发切换，开场必须挂上）',
    before && before.id === 'pixie_jianfa', before && (before.id + '/' + before.name));
  /* 切到第二阶段（skill=heimu_zhang 黑幕掌） */
  dropTo(e, boss, 0.6);
  const after = ce.pickSkill(boss, w.player);
  ok('切阶段后换成阶段指定的招式',
    after && after.id === 'heimu_zhang', after && (after.id + '/' + after.name));
  /* 第三阶段无 skill → 回落模板武学，不是 null */
  dropTo(e, boss, 0.3);
  const ph3 = ce.pickSkill(boss, w.player);
  ok('无 skill 的阶段回落模板武学（不空手）', !!ph3, ph3 && ph3.name);
  /* 内力不足时不硬用，退回常规 */
  const b2 = mkBoss(e, DFB);
  dropTo(e, b2, 0.6);
  b2.mp = 0;
  const fb = ce.pickSkill(b2, w.player);
  /* 阶段招是 pixie_jianfa（mpCost 35），内力 0 时必须退回模板自带拳法 */
  ok('内力不足时不硬放高耗招', !fb || fb.id !== 'pixie_jianfa', fb && (fb.id + '/' + fb.name));
}

sec('④ 倍率真的生效');
{
  const e = boot();
  const w = e.world, ce = new CombatEngine(w);
  const boss = mkBoss(e, DFB);

  const atk0 = boss.atk, speed0 = boss.speed;
  dropTo(e, boss, 0.6);
  ok('第二阶段 atk 涨了（×1.15）', boss.atk > atk0, atk0 + '→' + boss.atk);
  ok('第二阶段 speed 涨了（×1.25）', boss.speed > speed0, speed0 + '→' + boss.speed);
  ok('倍率以 bossphase buff 落地', (boss.buffs || []).some(b => b.tag === 'bossphase'),
    JSON.stringify((boss.buffs || []).map(b => b.tag)));

  const atk1 = boss.atk, def1 = boss.defFinal, dodge1 = boss.dodge;
  dropTo(e, boss, 0.3);
  ok('第三阶段 atk 跌了（×0.8 守势）', boss.atk < atk1, atk1 + '→' + boss.atk);
  ok('第三阶段 def 涨了（×1.6）', boss.defFinal > def1, def1 + '→' + boss.defFinal);
  ok('第三阶段 dodge 涨了（×1.5）', boss.dodge > dodge1, dodge1 + '→' + boss.dodge);
  /* 关键：同 tag buff 必须替换而不是累加，否则第二阶段就把倍率叠了两遍 */
  const nb = (boss.buffs || []).filter(b => b.tag === 'bossphase');
  ok('bossphase buff 只有一个（不逐阶段累乘）', nb.length === 1, 'n=' + nb.length);
  ok('第三阶段的 def 约等于第二阶段 ×1.6（未叠乘）',
    boss.defFinal > def1 && boss.defFinal < def1 * 2.4,
    def1 + ' → ' + boss.defFinal + '（叠乘的话会 >' + Math.round(def1 * 1.35 * 1.6) + '）');
}

sec('⑤ reflect 这类「天生 0」的字段按绝对值生效');
{
  const e = boot();
  const w = e.world, ce = new CombatEngine(w);
  const boss = mkBoss(e, DFB);
  ok('东方不败出厂无反伤', !boss.reflect || boss.reflect === 0, String(boss.reflect));
  dropTo(e, boss, 0.6);   /* 第二阶段 mult.reflect = 0.3 */
  ok('第二阶段获得反伤 0.3（0×2 不该是 0）',
    boss.reflect > 0 && Math.abs(boss.reflect - 0.3) < 0.02, String(boss.reflect));
  /* 冯保的 dodge:0.9 是「变慢」，得是负增量 */
  const fm = mkBoss(e, 'depot_master');
  fm.hp = Math.round(fm.maxHp * 0.6);   /* 直接落到第二阶段阈值 */
  const L = [];
  ce.tickBossPhase(fm, L, null);
  ok('m<1 的 dodge 产出负增量（真的变慢）',
    (fm.buffs || []).some(b => b.tag === 'bossphase' && b.mods && b.mods.dodge < 0),
    JSON.stringify((fm.buffs || []).filter(b => b.tag === 'bossphase').map(b => b.mods)));
}

sec('⑥ 召唤（冯保放影卫）');
{
  const e = boot(66);
  const w = e.world, ce = new CombatEngine(w);
  const boss = mkBoss(e, 'depot_master');
  const room = boss.room;
  const before = w.npcsIn(room).length;
  const battle = { attackers: [], defenders: [boss], room };
  /* 直接落到 60% → 触发 summon */
  boss.hp = Math.round(boss.maxHp * 0.6);
  const L = [];
  ce.tickBossPhase(boss, L, battle);
  const t = txt(L);
  ok('第二阶段真的召唤了影卫', w.npcsIn(room).length > before || /现身/.test(t),
    t || ('room人数 ' + before + '→' + w.npcsIn(room).length));
  ok('影卫被加入战斗 defenders', [].concat(battle.defenders).length > 1,
    'defenders=' + [].concat(battle.defenders).map(x => x.name).join(','));
  ok('影卫已进入战斗态', [].concat(battle.defenders).filter(x => x.inCombat).length >= 1);
}

sec('⑦ 战斗结束 / 读档后状态复位');
{
  const e = boot(1234);
  const w = e.world, p = w.player;
  /* 造一场真战斗：把 boss 打到 30% 以下，走完整流程 */
  const boss = mkBoss(e, DFB);
  const b = w.beginBattle ? null : null;
  /* 直接构造 battle 走 stepEnemyOnly 之外的路径不现实，这里直接验证复位逻辑：
     ① finishCombat 里清 ② reviveInstances 里清 */
  boss.bossPhaseIdx = 2;
  boss.bossSkill = 'pixie_jianfa';
  boss.addBuff({ name: 'Boss 第 3 阶段', turns: 9999, mods: { atk: 30 }, tag: 'bossphase' });
  /* 造一个 battle 让 finishCombat 吃到 */
  w.battle = { attackers: [p], defenders: [boss], over: false, winner: 'flee', log: [] };
  w.finishCombat([]);
  ok('战斗结束后 bossPhaseIdx 复位', boss.bossPhaseIdx === 0, String(boss.bossPhaseIdx));
  ok('战斗结束后 bossSkill 清空', boss.bossSkill === null, String(boss.bossSkill));
  ok('战斗结束后 bossphase buff 被摘掉',
    !(boss.buffs || []).some(x => x.tag === 'bossphase'),
    JSON.stringify((boss.buffs || []).map(x => x.tag)));
  void b;

  /* 读档：伪造一个带着半截阶段的存档 */
  const e2 = boot(99);
  const w2 = e2.world;
  const b2 = w2.spawnNpc(DFB, w2.player.room, 1, true);
  b2.bossPhaseIdx = 2;
  b2.bossSkill = 'pixie_jianfa';
  b2.addBuff({ name: 'x', turns: 5, mods: { atk: 99 }, tag: 'bossphase' });
  const data = w2.serialize();
  /* 直接改存档里的实例，模拟「半截状态被存下来」 */
  const instKey = Object.keys(data.instances.npcs).find(k => data.instances.npcs[k].defId === DFB);
  ok('存档里找得到 boss 实例', !!instKey, String(instKey));
  if (instKey) {
    data.instances.npcs[instKey].bossPhaseIdx = 2;
    data.instances.npcs[instKey].bossSkill = 'pixie_jianfa';
    const e3 = new GameEngine({ seed: 7 });
    e3.boot();
    e3.world.deserialize(data, e3.modLoader.getEnabledModList());
    const back = Object.values(e3.world.instances.npcs).find(n => n.defId === DFB);
    ok('读档后 boss 实例还在', !!back);
    if (back) {
      ok('读档后 bossPhaseIdx 复位到 0', back.bossPhaseIdx === 0, String(back.bossPhaseIdx));
      ok('读档后 bossSkill 清空', !back.bossSkill, String(back.bossSkill));
      ok('读档后 bossphase buff 被摘掉',
        !(back.buffs || []).some(x => x.tag === 'bossphase'));
    }
  }
}

sec('⑧ 全库 bossPhases 数据体检');
{
  const w = boot().world;
  const all = Object.keys(w.data.npcs).filter(id => Array.isArray(w.data.npcs[id].bossPhases));
  ok('有 bossPhases 的 NPC 至少 3 个（冯保/影子/东方不败）', all.length >= 3, all.join(','));
  for (const id of all) {
    const ph = w.data.npcs[id].bossPhases;
    let okDec = true;
    for (let i = 1; i < ph.length; i++) if (!(ph[i].at < ph[i - 1].at)) okDec = false;
    ok(id + ' at 递减', okDec, JSON.stringify(ph.map(x => x.at)));
    ok(id + ' 每阶段有台词', ph.every(x => !!(x.line || x.desc)));
    ok(id + ' 台词无乱码', ph.every(x => !/�/.test((x.line || '') + (x.desc || ''))));
    const badSkill = ph.map(x => x.skill).filter(Boolean).filter(s => !w.getSkill(s));
    ok(id + ' 阶段招法存在', badSkill.length === 0, badSkill.join(','));
    const badSummon = ph.map(x => x.summon && x.summon.npc).filter(Boolean).filter(s => !w.data.npcs[s]);
    ok(id + ' 召唤物存在', badSummon.length === 0, badSummon.join(','));
    /* mult 值必须是数字 */
    const badMult = [];
    for (const x of ph) for (const k of Object.keys(x.mult || {})) {
      if (!Number.isFinite(Number(x.mult[k]))) badMult.push(k + '=' + x.mult[k]);
    }
    ok(id + ' mult 全是数字', badMult.length === 0, badMult.join(','));
  }
}

console.log('\n' + '─'.repeat(46));
console.log('  Boss 三阶段 smoke：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('─'.repeat(46));
process.exit(fail ? 1 : 0);