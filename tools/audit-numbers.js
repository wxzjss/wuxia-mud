/**
 * audit-numbers.js — 全盘数值体检（只读，不写任何数据文件）
 *
 * 主人 2026-10-10：「整体评估当前游戏各方面数值是否平衡，如果不平衡允许你随意调整数值」
 * 这个脚本不改东西，只把「玩家成长曲线 / NPC 强度分布 / 战斗回合数 / 门派分层」摊开看。
 *
 * 用法：node tools/audit-numbers.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const { Character } = require(path.join(ROOT, 'game/src/core/character.js'));
const neigong = require(path.join(ROOT, 'game/src/core/neigong.js'));

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
engine.newGame({ name: '体检客', gender: '男', identity: 'zhuangyuan' });
const w = engine.world;
const p = w.player;

const f = (n) => (Math.round(n * 10) / 10);
const pct = (arr, q) => { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const DEF = (u) => (typeof u.defFinal === 'number' ? u.defFinal : (typeof u.def === 'number' ? u.def : 0));
/** 真实伤害公式（combat.js CombatEngine.damage 的中值，去掉 0.85~1.15 浮动） */
const DMG = (atk, mult, def, pen = 0) => Math.max(1, Math.floor(atk * mult * (100 / (100 + def * (1 - Math.min(0.7, pen))))));
/** 几刀打死 */
const HITS = (hp, dmg) => Math.ceil(hp / Math.max(1, dmg));

console.log('\n================ ① 玩家开局 ================');
console.log(`气血 ${f(p.maxHp)} · 内力 ${f(p.maxMp)} · 攻 ${f(p.atk)} · 防 ${f(DEF(p))} · 闪避 ${f(p.dodge)} · 招架 ${f(p.parry)}`);
const A = ['力量', '根骨', '身法', '悟性', '福缘', '定力', '资质'];
console.log('属性 ' + A.map(k => `${k}${p.attrTotal(k)}`).join(' '));

console.log('\n================ ② 武学等级上限曲线 ================');
console.log('（maxSkillLevelFor = wis*10 + apt*14 + 内功lv*1.2 + 内力上限*0.08，再 min(门内硬顶)）');
for (const [wis, apt, ngLv, mp] of [[10, 10, 0, 50], [10, 10, 0, 200], [10, 10, 0, 500], [20, 20, 100, 500], [30, 30, 300, 1000], [40, 40, 600, 2000], [60, 60, 1000, 4000]]) {
  const lim = Math.floor(wis * 10 + apt * 14 + ngLv * 1.2 + mp * 0.08);
  console.log(`  悟性${wis} 资质${apt} 内功${ngLv}级 内力上限${mp} → 武学上限 ${lim}${lim >= 1000 ? '（碰顶 1000）' : ''}`);
}

console.log('\n================ ③ 吐纳 → 内力上限 ================');
{
  const mk = (attr, learned, eq) => { const c = new Character(w, { id: 'probe', name: '探针', hp: 300, mp: 400, atk: 20, def: 5, attr }); c.learned = learned || {}; c.equippedSkills = eq || {}; c.recalc(); return c; };
  const bare = mk({ 悟性: 20, 资质: 20, 根骨: 20 });
  console.log(`  全裸（无内功）：内力上限 +${neigong.gainPerTune(bare)}/次，气血上限 +${neigong.hpGainPerTune(bare)}/次`);
  const ng300 = mk({ 悟性: 20, 资质: 20, 根骨: 20 }, { basic_neigong: { level: 300 } }, { 内功: 'basic_neigong' });
  console.log(`  挂 300 级基本内功：内力上限 +${neigong.gainPerTune(ng300)}/次`);
  const ng800 = mk({ 悟性: 20, 资质: 20, 根骨: 20 }, { basic_neigong: { level: 800 } }, { 内功: 'basic_neigong' });
  console.log(`  挂 800 级基本内功：内力上限 +${neigong.gainPerTune(ng800)}/次`);
  const wg = mk({ 悟性: 20, 资质: 20, 根骨: 40 }, { basic_neigong: { level: 300 }, basic_fist: { level: 600 } }, { 内功: 'basic_neigong', 拳: 'basic_fist' });
  console.log(`  外加 600 级外功、根骨 40：气血上限 +${neigong.hpGainPerTune(wg)}/次`);
  const rounds = (maxMp) => Math.ceil(Math.log(neigong.MP_FLOOR / maxMp) / Math.log(1 - 0.12));
  console.log(`  一轮吐纳要坐几轮才见底：内力 400 → ${rounds(400)} 轮 · 内力 2000 → ${rounds(2000)} 轮 · 内力 8000 → ${rounds(8000)} 轮（每轮 30 分钟游戏时间）`);
}

console.log('\n================ ④ NPC 强度分布（模板层） ================');
{
  const npcs = Object.values(w.data.npcs);
  const buckets = {};
  for (const d of npcs) {
    const c = new Character(w, d);
    c.recalc();
    const tier = d.tier || '（无 tier）';
    (buckets[tier] = buckets[tier] || []).push({ name: d.name, hp: c.maxHp, mp: c.maxMp, mpBase: c.maxMpBase, atk: c.atk, d: DEF(c), lv: neigong.npcLevelFromMp(c) });
  }
  for (const t of Object.keys(buckets).sort()) {
    const b = buckets[t];
    console.log(`  tier ${t}（${b.length} 人）: 气血 p50=${f(pct(b.map(x => x.hp), 0.5))} p90=${f(pct(b.map(x => x.hp), 0.9))} · ` +
      `内力 p50=${pct(b.map(x => x.mp), 0.5)} p90=${pct(b.map(x => x.mp), 0.9)} · 攻 p50=${f(pct(b.map(x => x.atk), 0.5))} p90=${f(pct(b.map(x => x.atk), 0.9))} · ` +
      `防 p50=${f(pct(b.map(x => x.d), 0.5))} · 火候 p50=${pct(b.map(x => x.lv), 0.5)} max=${Math.max(...b.map(x => x.lv))}`);
  }
  const missMp = npcs.filter(d => typeof d.mp !== 'number' && d.tier && d.tier !== 'mob');
  console.log(`  ⚠️ 有 tier 但**没写 mp** 的 NPC：${missMp.length} 人 ↳ 他们的「内力折算火候」只能是 0/1`);
  console.log('     ' + missMp.slice(0, 8).map(x => `${x.name}(${x.tier})`).join(' · '));
}

console.log('\n================ ⑤ 门派分层强度 ================');
{
  const bySect = {};
  for (const d of Object.values(w.data.npcs)) {
    if (!d.sect) continue;
    const c = new Character(w, d); c.recalc();
    (bySect[d.sect] = bySect[d.sect] || []).push({ hp: c.maxHp, atk: c.atk, mp: c.maxMp });
  }
  const out = [];
  for (const s of Object.values(w.data.sects || {})) {
    const b = bySect[s.id]; if (!b || !b.length) continue;
    out.push({ name: s.name, tier: s.tier || '?', n: b.length, hp: pct(b.map(x => x.hp), 0.5), atk: pct(b.map(x => x.atk), 0.5) });
  }
  const order = { '一流': 1, '二流': 2, '三流': 3, '秘境': 4 };
  out.sort((a, b) => (order[a.tier] || 9) - (order[b.tier] || 9) || b.hp - a.hp);
  for (const o of out.slice(0, 16)) console.log(`  ${o.tier} ${o.name}(${o.n}人) 气血p50=${f(o.hp)} 攻p50=${f(o.atk)}`);
  const t1 = out.filter(x => x.tier === '一流').map(x => x.hp);
  const t2 = out.filter(x => x.tier === '二流').map(x => x.hp);
  const t3 = out.filter(x => x.tier === '三流').map(x => x.hp);
  if (t1.length && t2.length) console.log(`  → 分层中位：一流 ${f(pct(t1, 0.5))} / 二流 ${f(pct(t2, 0.5))} / 三流 ${f(pct(t3, 0.5))}`);
}

console.log('\n================ ⑥ 标准玩家轨迹 vs 敌人（真实伤害公式） ================');
{
  const mkPlayer = (label, hp, atk, dv, mp) => ({ label, hp, atk, d: dv, mp });
  const stages = [
    mkPlayer('T0 开局裸奔', p.maxHp, p.atk, DEF(p), p.maxMp),
    mkPlayer('T1 拜师学基本功', 300, 45, 25, 200),
    mkPlayer('T2 中期（300 级）', 1200, 130, 90, 800),
    mkPlayer('T3 终局（1000 级）', 4000, 400, 300, 3000),
  ];
  const enemies = Object.values(w.data.npcs).filter(d => ['mob', 'C', 'B', 'A'].includes(d.tier))
    .map(d => { const c = new Character(w, d); c.recalc(); return { name: d.name, tier: d.tier, hp: c.maxHp, atk: c.atk, d: DEF(c), lv: neigong.npcLevelFromMp(c) }; });
  const pick = (t, n) => { const arr = enemies.filter(e => e.tier === t).sort((a, b) => a.hp - b.hp); const step = Math.max(1, Math.floor(arr.length / n)); return arr.filter((_, i) => i % step === 0).slice(0, n); };
  for (const st of stages) {
    console.log(`\n  ── ${st.label}（气血 ${st.hp} · 攻 ${st.atk} · 防 ${st.d} · 内力 ${st.mp}）──`);
    for (const e of [...pick('mob', 3), ...pick('C', 2), ...pick('B', 2), ...pick('A', 2)]) {
      const mine = DMG(st.atk, 1, e.d);            // 玩家打它一刀（裸手 mult=1）
      const its = DMG(e.atk, 1, st.d);             // 它打玩家一刀
      console.log(`    ${e.tier.padEnd(3)} ${e.name}（气血${e.hp} 攻${e.atk} 防${f(e.d)} 火候${e.lv}）→ 我要 ${HITS(e.hp, mine)} 刀 · 它要 ${HITS(st.hp, its)} 刀`);
    }
  }
}

console.log('\n================ ⑦ 顶级对照 ================');
{
  const all = Object.values(w.data.npcs).map(d => { const c = new Character(w, d); c.recalc(); return { name: d.name, tier: d.tier, hp: c.maxHp, atk: c.atk, d: DEF(c), mp: c.maxMp, lv: neigong.npcLevelFromMp(c) }; });
  const top = all.slice().sort((a, b) => b.atk - a.atk).slice(0, 6);
  for (const t of top) console.log(`  攻最高：${t.name}(${t.tier}) 攻${t.atk} 气血${t.hp} 防${f(t.d)} 内力${t.mp} 火候${t.lv}`);
  console.log(`  全库最高：气血 ${Math.max(...all.map(x => x.hp))} · 攻 ${Math.max(...all.map(x => x.atk))} · 内力 ${Math.max(...all.map(x => x.mp))}`);
}

console.log('\n===== 体检完 =====\n');
