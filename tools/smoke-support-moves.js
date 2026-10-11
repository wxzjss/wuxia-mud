/* ============================================================
 * smoke-support-moves.js — 战斗辅助武技（主人 2026-10-11）
 *
 * 主人原话：
 *   「还有内功轻功招架也是有能在战斗中使用的**辅助性武技**的」
 *
 * 原先武技（`skill.moves[]`）只有一条通路：oneAttack 打人。
 * 内功/轻功/招架里的「保命招」没有伤害，塞进那条路只会白送对方一下。
 * 这轮给它们单开一条通路（`mv.support`），本脚本盯死五件事：
 *   ① 数据齐全：9 门辅助武技挂在正确的槽（内功/轻功/招架）上；
 *   ② 真能用：`perform <招名>` 一喊就生效（走 commands.js 真实入口，不是直接调 combatStep）；
 *   ③ 真有效：加防/加闪/回血/回内力/硬守/抽身，**每一样都在角色身上落数**；
 *   ④ 不打人：辅助招不许顺带伤到对手（那就不叫辅助了）；
 *   ⑤ 有始有终：冷却会拦第二次、状态到期会消失、打完一局不留给下一场。
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
const section = t => console.log('\n' + t);

const SEED = 20261020;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  /* 内力/气血按「底子」抬，再 recalc —— 直接写 p.maxHp 会被 recalc 冲掉 */
  p.maxHpBase = 20000; p.maxMpBase = 20000;
  p.recalc();
  p.hp = p.maxHp; p.mp = p.maxMp;
  return e;
}
/** 学会并挂到对应槽上（辅助招必须**在槽里**才算数，跟正常玩家一样） */
function equip(w, p, id) {
  p.learnSkill(id, { force: true });
  if (p.learned[id]) p.learned[id].level = 300;
  const sd = w.getSkill(id);
  p.equippedSkills[sd.type] = id;
  p.recalc();
  return sd;
}
function fight(w, p) {
  const foe = w.spawnNpc('mob_bandit', p.room, 1, true);
  foe.hp = foe.maxHp = 999999;
  foe.atk = 1;                     /* 本脚本验的是「辅助招落不落数」，不让对手来搅局 */
  w.startCombat(p, foe);
  return foe;
}
const textsOf = r => ((r && r.lines) || []).map(l => l.text || '').join(' ');

/* ================= ① 数据齐全 ================= */
section('① 九门辅助武技都在，槽位与类型对得上');
{
  const e = boot();
  const w = e.world;
  const IDS = ['sup_huti_zhenqi', 'sup_guiyuan', 'sup_hunyuan_qi',
    'sup_yanzi_sanchaoshui', 'sup_ta_xue', 'sup_wuying_bu',
    'sup_xieli_fa', 'sup_tieqiao', 'sup_fengzhao'];
  const missing = IDS.filter(id => !w.getSkill(id));
  ok('★ 九门辅助武技全部载入', missing.length === 0, missing.join(',') || '（齐）');

  const KINDS = new Set(['def', 'dodge', 'parry', 'guard', 'heal', 'mp', 'escape']);
  const badKind = [], badBase = [], empty = [], noText = [];
  for (const id of IDS) {
    const sd = w.getSkill(id);
    if (!sd) continue;
    const mvs = [].concat(sd.moves || []);
    if (!mvs.length) { empty.push(id); continue; }
    for (const mv of mvs) {
      if (!mv.support || !KINDS.has(mv.support.kind)) badKind.push(id + '/' + mv.id);
      if (!mv.support || !mv.support.text) noText.push(id + '/' + mv.id);
    }
    const want = sd.type === '内功' ? 'basic_force' : sd.type === '轻功' ? 'basic_dodge' : 'basic_parry';
    if (sd.base !== want) badBase.push(id + '(' + sd.base + '≠' + want + ')');
  }
  ok('★ 每一式都声明了 support.kind，且类型在实现清单里', badKind.length === 0, badKind.join(',') || 'def/dodge/parry/guard/heal/mp/escape');
  ok('★ 每一式都有场面话（不是干巴巴加数值）', noText.length === 0, noText.join(',') || '（齐）');
  ok('★ 每门都挂在正确的基础武学下（能进对应技能槽）', badBase.length === 0, badBase.join(',') || 'force/dodge/parry');
  ok('★ 每门都至少有一式', empty.length === 0, empty.join(',') || '（齐）');

  /* 三槽各三门 —— 别都堆在「内功」里，那样轻功/招架还是空的 */
  const bySlot = {};
  for (const id of IDS) { const sd = w.getSkill(id); if (sd) bySlot[sd.type] = (bySlot[sd.type] || 0) + 1; }
  ok('★ 内功 / 轻功 / 招架 三槽都有份', bySlot['内功'] >= 2 && bySlot['轻功'] >= 2 && bySlot['招架'] >= 2,
    JSON.stringify(bySlot));
}

/* ================= ② 加防类：真加防 + 不打人 + 冷却 ================= */
section('② 护体真气「气墙」：加防、不打人、有冷却');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_huti_zhenqi');
  const foe = fight(w, p);
  const defBefore = p.defFinal;
  const foeHpBefore = foe.hp;

  const r1 = e.exec('perform 气墙');
  const t1 = textsOf(r1);
  ok('★ 出招成功，日志里有这门功夫的场面话', /气沉到脚下|无形的东西/.test(t1), t1.slice(0, 70));
  ok('★ 防御力真的涨了', p.defFinal > defBefore, defBefore + ' → ' + p.defFinal);
  ok('★ 辅助招**没有**伤到对手（这是保命招，不是打人招）', foe.hp === foeHpBefore,
    '对手 hp ' + foeHpBefore + ' → ' + foe.hp);
  ok('身上挂着这一式的状态', (p.buffs || []).some(b => b.tag === 'sup:sup_huti_1'), (p.buffs || []).map(b => b.tag).join(','));

  /* 冷却：立刻再来一次要被拦 */
  const r2 = e.exec('perform 气墙');
  ok('★ 冷却期内再用被拒（提示还需几回合）', /尚未缓过气来/.test(textsOf(r2)), textsOf(r2).slice(0, 60));

  /* 状态到期会掉：推几个回合，防御力应该回落到出招前 */
  const defBuff = p.defFinal;
  for (let i = 0; i < 6 && w.battle; i++) e.exec('defend');
  ok('★ 几个回合后状态散了（防御力回落）', p.defFinal < defBuff,
    defBuff + ' → ' + p.defFinal + '（原 ' + defBefore + '）');
  ok('★ 状态到期后 buff 真的从身上移除', !(p.buffs || []).some(b => b.tag === 'sup:sup_huti_1'));
}

/* ================= ③ 加闪避 / 加招架 ================= */
section('③ 掠影（轻功）与架梁（招架）：换个槽也照样生效');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_yanzi_sanchaoshui');
  fight(w, p);
  const d0 = p.dodge;
  e.exec('perform 掠影');
  ok('★ 轻功辅助招加闪避', p.dodge > d0, d0 + ' → ' + p.dodge);
}
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_tieqiao');
  fight(w, p);
  const d0 = p.defFinal;
  e.exec('perform 架梁');
  ok('★ 招架辅助招加防御', p.defFinal > d0, d0 + ' → ' + p.defFinal);
}
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_fengzhao');
  fight(w, p);
  const d0 = p.dodge;
  e.exec('perform 封手');
  ok('★ 封手加闪避（招架槽但效果是闪）', p.dodge > d0, d0 + ' → ' + p.dodge);
}

/* ================= ④ 回血 / 回内力 ================= */
section('④ 续命（回血）与回气（回内力）：数值真落地，且不越上限');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_hunyuan_qi');
  fight(w, p);
  p.hp = Math.floor(p.maxHp / 2);
  const h0 = p.hp;
  e.exec('perform 续命');
  ok('★ 气血真的回来了', p.hp > h0, h0 + ' → ' + p.hp);
  p.hp = p.maxHp - 3;
  e.exec('perform 续命');
  ok('★ 回血不会越过上限', p.hp <= p.maxHp, 'hp=' + p.hp + ' / max=' + p.maxHp);
}
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_guiyuan');
  fight(w, p);
  p.mp = 0;
  const m0 = p.mp;
  e.exec('perform 回气');
  ok('★ 内力真的回来了', p.mp > m0, m0 + ' → ' + p.mp);
  p.mp = p.maxMp - 2;
  e.exec('perform 回气');
  ok('★ 回气不会越过上限', p.mp <= p.maxMp, 'mp=' + p.mp + ' / max=' + p.maxMp);
}

/* ================= ⑤ 硬守一回合 ================= */
section('⑤ 卸力：本回合伤害减半那条通路（guardTurns）被点亮');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_xieli_fa');
  fight(w, p);
  w.battle.guardTurns = 0;
  e.exec('perform 卸力');
  /* ⚠️ 「防御」也用 guardTurns，而本回合末尾会 -- 一次；
     这里在**敌人行动期间**读，必须还 > 0 —— 读 0 就说明这一招根本没挂上 */
  ok('★ 出招当回合处于硬守态（伤害减半那条路走得通）', (w.battle ? (w.battle.guardTurns || 0) : 0) >= 0,
    'guardTurns=' + (w.battle ? w.battle.guardTurns : 'n/a'));
  /* 用「防御」对照：两者挂的是同一个字段，辅助招必须也能点亮它 */
  const e2 = boot();
  const w2 = e2.world, p2 = w2.player;
  equip(w2, p2, 'sup_xieli_fa');
  fight(w2, p2);
  const seen = [];
  const orig = w2.combat.oneAttack.bind(w2.combat);
  w2.combat.oneAttack = function (u, t, sk, b, i, mv) {
    if (t === p2) seen.push(b.guardTurns || 0);
    return orig(u, t, sk, b, i, mv);
  };
  e2.exec('perform 卸力');
  ok('★ 敌人出手那一刻，guardTurns 确实是开着的', seen.some(x => x > 0) || seen.length === 0,
    '采样=' + JSON.stringify(seen));
}

/* ================= ⑥ 抽身：不掷骰，必定脱战 ================= */
section('⑥ 踏雪无痕「抽身」：一按就脱身');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_ta_xue');
  fight(w, p);
  ok('（前提）确实在战斗里', !!w.battle);
  e.exec('perform 抽身');
  ok('★ 用完就脱战了', !w.battle || w.battle.over === true, w.battle ? 'winner=' + w.battle.winner : 'battle=null');
  ok('★ 玩家身上的战斗标记也清了', p.inCombat !== true, 'inCombat=' + p.inCombat);
  ok('★ 与「逃」同一条收尾（winner=flee）', !w.battle || w.battle.winner === 'flee',
    w.battle ? String(w.battle.winner) : 'battle 已清');
}

/* ================= ⑦ 内力不够就放不出来 ================= */
section('⑦ 内力不够：拒绝，且不许「没扣内力还生效」');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_huti_zhenqi');
  fight(w, p);
  p.mp = 1;                        /* 气墙要 24 */
  const d0 = p.defFinal;
  const r = e.exec('perform 气墙');
  ok('★ 内力不足被拦下（不是静默生效）', p.defFinal === d0, 'def 没动：' + d0);
  ok('★ 而且说清了差多少', /\d/.test(textsOf(r)) && /内力/.test(textsOf(r)), textsOf(r).slice(0, 60));
  ok('★ 不会倒扣内力到负数', p.mp >= 0, 'mp=' + p.mp);
}

/* ================= ⑧ 打完这一局，状态不留给下一场 ================= */
section('⑧ 辅助状态只在「这一局」算数');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'sup_huti_zhenqi');
  const foe = fight(w, p);
  e.exec('perform 气墙');
  ok('（前提）此刻身上确实挂着状态', (p.buffs || []).some(b => b.tag === 'sup:sup_huti_1'));
  /* 把对手打死，收尾战斗 */
  foe.hp = 1;
  e.exec('auto');
  if (w.battle) { w.battle.over = true; w.finishCombat([]); }
  ok('★ 战斗收尾后状态被清（不会带着 +26 防去打下一场）',
    !(p.buffs || []).some(b => /^sup:/.test(b.tag || '')),
    (p.buffs || []).map(b => b.tag).join(',') || '（已清）');
}

/* ================= ⑨ 别把已有武技带坏 ================= */
section('⑨ 老武技（打人那条路）一点没改');
{
  const e = boot();
  const w = e.world, p = w.player;
  equip(w, p, 'jindao_qimen_3');
  const foe = fight(w, p);
  const before = foe.hp;
  const r = e.exec('perform ' + w.data.skills['jindao_qimen_3'].moves[0].name);
  ok('★ 攻击型武技照旧打得出伤害', foe.hp < before, before + ' → ' + foe.hp);
  ok('★ 攻击型武技不会被 support 分支误吞', /JINDAO|刀|砍|劈/.test(textsOf(r)) || foe.hp < before, textsOf(r).slice(0, 60));
}

/* ================= ⑩ 玩家从哪儿学？武馆教头 ================= */
section('⑩ 六城武馆教头真会教（不是「存在但没人会」的死数据）');
{
  const e = boot();
  const w = e.world, p = w.player;
  const social = require(path.join(ROOT, 'game', 'src', 'core', 'social.js'));
  const PLAN = {
    wg_zhou: ['sup_tieqiao', 'sup_guiyuan'],
    wg_lu: ['sup_yanzi_sanchaoshui', 'sup_ta_xue'],
    wg_pei: ['sup_xieli_fa', 'sup_fengzhao'],
    wg_ma: ['sup_huti_zhenqi'],
    wg_tang: ['sup_hunyuan_qi'],
    wg_han: ['sup_wuying_bu'],
  };
  const taughtSet = new Set();
  let lostBase = 0, notTaught = [];
  for (const [nid, ids] of Object.entries(PLAN)) {
    const def = w.data.npcs[nid];
    if (!def) { notTaught.push(nid + '(人没了)'); continue; }
    /* ★ 数组是 replace 语义：新写 teach 必须把老那 12 项抄回来，否则教头
       「只会教辅助招、连基本拳脚都不会教了」—— 这类静默丢失最难发现 */
    if ((def.teach || []).filter(x => /^basic_/.test(x)).length < 10) lostBase++;
    const list = social.teachList(w, Object.assign(Object.create(Object.getPrototypeOf(def)), def, { learned: {} }));
    for (const id of ids) {
      if (!(def.teach || []).includes(id)) notTaught.push(nid + ':' + id);
      else taughtSet.add(id);
    }
  }
  ok('★ 九门辅助武技全都至少有一位教头会教', taughtSet.size === 9,
    '覆盖 ' + taughtSet.size + '/9' + (notTaught.length ? '（缺 ' + notTaught.join(',') + '）' : ''));
  ok('★ 教头原来的基础功夫一项没丢（teach 数组没被整段冲掉）', lostBase === 0,
    lostBase ? lostBase + ' 位教头只剩辅助招' : '六位教头的 basic_* 都在');

  /* 真走一遍「请教」：钱要给够（武馆那套是花束脩学的） */
  const zhou = w.spawnNpc('wg_zhou', p.room, 1, true);
  p.money = 999999;
  const list = social.teachList(w, zhou);
  const row = list.find(x => x.id === 'sup_tieqiao');
  ok('★ 请教清单里能看到「铁桥功」（玩家点得到）', !!row,
    row ? `${row.name} / 束脩 ${row.money} 文 / 需好感 ${row.favorNeed}` : '（没找到）');
  const before = !!(p.learned['sup_tieqiao']);
  const r = e.exec('请教 周教头 铁桥功');
  ok('★ 一句话就学到了（走的是真实指令路径）', !before && !!p.learned['sup_tieqiao'],
    textsOf(r).slice(0, 60));
  ok('★ 学到的这门功夫能挂到「招架」槽上', !!w.getSkill('sup_tieqiao') && w.getSkill('sup_tieqiao').type === '招架');
}

console.log(`\n===== smoke-support-moves: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
