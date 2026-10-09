/* ============================================================
 * smoke-combat.js — 战斗伤害落地冒烟测试（SPRINT1-ENG-02，P0）
 *
 * 为什么要这个脚本：
 *   全套 910 项断言全绿，却没人抓到「玩家打出去的伤害恒为 NaN」。
 *   原因是没有任何一条断言覆盖**伤害落地**（hp 真的掉了多少）。
 *   本脚本只盯一件事：**打出去的必须是有限正数，且血条真的掉。**
 *
 * 覆盖：
 *  ① 字段语义裁决：def = 模板对象引用；defFinal = 防御力数值
 *  ② 玩家 → NPC：遍历**全部**可战斗对象（不抽样），伤害是有限正数
 *  ③ NPC → 玩家：遍历**全部**可战斗对象，伤害是有限正数
 *  ④ 单调性：防御力越高伤害越低（防公式接反）；破防越高伤害越高
 *  ⑤ 一次攻击后 npc.hp 严格递减且不是 NaN
 *  ⑥ 旧存档（无 defFinal）读进来后伤害依然正常（三层兜底）
 *  ⑦ 源码静态防线：不许再出现「把 .def 当数字用」的写法
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { defenseOf } = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261008;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}
const e = boot();
const w = e.world, p = w.player;

/* 让「普通攻击」可复现：卸掉玩家的武学，免得 pickSkill 选到要耗内力的招式后打不出伤害 */
p.learned = {};
p.equippedSkills = {};
const realHitRoll = w.combatHooks.hitRoll;
w.combatHooks.hitRoll = () => true;      // 本脚本只验伤害，不验命中

/* oneAttack 只把 battle 往下游传，普通攻击不会用到它的方法，用桩即可 */
const BATTLE = { attackers: [p], defenders: [], turn: 0, log: [], over: false, winner: null };
function ctxOf(world, extra) {
  return Object.assign({ world, mult: 1, armorPen: 0 }, extra || {});
}

/* ============================================================ */
section('① 字段语义裁决：def = 模板对象，defFinal = 防御力数值');
{
  const yue = w.spawnNpc('master_yue', w.data.npcs.master_yue.room, 1, true);
  ok('npc.def 是模板对象（不是数字）', yue.def && typeof yue.def === 'object',
    'typeof=' + typeof yue.def + (yue.def && yue.def.name ? ' name=' + yue.def.name : ''));
  ok('npc.def 就是 data.npcs[defId] 本身', yue.def === w.data.npcs.master_yue);
  ok('npc.defFinal 是有限正数', Number.isFinite(yue.defFinal) && yue.defFinal > 0,
    '岳不群 defFinal=' + yue.defFinal + '（模板 def=' + w.data.npcs.master_yue.def + '）');
  ok('玩家不再有写脏的 def 数字字段', p.def === undefined, 'p.def=' + p.def);
  ok('玩家防御力在 defFinal 上', Number.isFinite(p.defFinal) && p.defFinal > 0, 'p.defFinal=' + p.defFinal);
  ok('defenseOf() 对 NPC 取到 defFinal', defenseOf(yue) === yue.defFinal, String(defenseOf(yue)));
  ok('defenseOf() 对玩家取到 defFinal', defenseOf(p) === p.defFinal, String(defenseOf(p)));
  ok('defenseOf(undefined) 不炸、返回 0', defenseOf(undefined) === 0);
  ok('defenseOf({defFinal:NaN}) 返回 0 而不是 NaN', defenseOf({ defFinal: NaN }) === 0);
  w.despawnNpc('master_yue', w.data.npcs.master_yue.room);
}

/* ============================================================ */
section('② 玩家 → NPC：遍历全部可战斗对象，伤害必须是有限正数');
{
  const ids = Object.keys(w.data.npcs);
  const bad = [];
  const nonFiniteDef = [];
  let tested = 0;
  for (const id of ids) {
    const def = w.data.npcs[id];
    const room = def.room || Object.keys(w.data.rooms)[0];
    const n = w.spawnNpc(id, room, 1, true);
    if (!n) { bad.push(id + '(上线失败)'); continue; }
    tested++;
    if (!Number.isFinite(defenseOf(n))) nonFiniteDef.push(def.name + '(defFinal=' + n.defFinal + ')');
    n.hp = n.maxHp;
    p.hp = p.maxHp;
    const before = n.hp;
    w.combat.oneAttack(p, n, null, BATTLE, 0);
    const drop = before - n.hp;
    /* 三重判定：掉血是有限数、严格为正、且 hp 本身没被写成 NaN */
    if (!Number.isFinite(drop) || drop <= 0 || Number.isNaN(n.hp)) {
      bad.push(`${def.name}(drop=${drop} hp=${n.hp})`);
    }
    w.despawnNpc(id, room);
  }
  ok('遍历的是全部 NPC（不是抽样）', tested === ids.length && ids.length >= 320,
    `${tested}/${ids.length} 个`);
  ok('全部 NPC：defenseOf() 都是有限数', nonFiniteDef.length === 0,
    nonFiniteDef.slice(0, 5).join(' / ') || `${tested} 个`);
  ok('全部 NPC：玩家一击都掉血且不是 NaN', bad.length === 0,
    bad.length ? bad.slice(0, 6).join(' / ') + (bad.length > 6 ? ` …共 ${bad.length} 个` : '') : `${tested} 个全部通过`);
  /* 直接打伤害公式本身，绕开命中/暴击，确保公式层也干净 */
  const badFormula = [];
  for (const id of ids) {
    const def = w.data.npcs[id];
    const room = def.room || Object.keys(w.data.rooms)[0];
    const n = w.spawnNpc(id, room, 1, true);
    if (!n) continue;
    const d = w.combatHooks.damage(p, n, 100, ctxOf(w));
    if (!Number.isFinite(d) || d <= 0) badFormula.push(`${def.name}(${d})`);
    w.despawnNpc(id, room);
  }
  ok('全部 NPC：伤害公式本身输出有限正数', badFormula.length === 0,
    badFormula.length ? badFormula.slice(0, 6).join(' / ') : `${ids.length} 个全部通过`);
}

/* ============================================================ */
section('③ NPC → 玩家：伤害必须是有限正数');
{
  const ids = Object.keys(w.data.npcs);
  const bad = [];
  for (const id of ids) {
    const def = w.data.npcs[id];
    const room = def.room || Object.keys(w.data.rooms)[0];
    const n = w.spawnNpc(id, room, 1, true);
    if (!n) continue;
    const d = w.combatHooks.damage(n, p, n.atk || 10, ctxOf(w));
    if (!Number.isFinite(d) || d <= 0) bad.push(`${def.name}(${d})`);
    w.despawnNpc(id, room);
  }
  ok('全部 NPC 打玩家：伤害都是有限正数', bad.length === 0,
    bad.length ? bad.slice(0, 6).join(' / ') : `${ids.length} 个全部通过`);

  /* 端到端再验一次：真跑 oneAttack，玩家 hp 必须真的往下掉 */
  const badE2E = [];
  for (const id of ['master_yue', 'nv_huang', 'shaolin_fangzheng', 'emei_miejue', 'beggar_boy']) {
    if (!w.data.npcs[id]) continue;
    const n = w.spawnNpc(id, w.data.npcs[id].room, 1, true);
    if (!n) continue;
    p.hp = p.maxHp = 100000;      // 撑住，别一击被打死影响掉血量判定
    const before = p.hp;
    w.combat.oneAttack(n, p, null, BATTLE, 0);
    const drop = before - p.hp;
    if (!Number.isFinite(drop) || drop <= 0 || Number.isNaN(p.hp)) badE2E.push(`${n.name}(drop=${drop} hp=${p.hp})`);
    w.despawnNpc(id, w.data.npcs[id].room);
  }
  ok('名角色打玩家：端到端真的掉血且不是 NaN', badE2E.length === 0,
    badE2E.join(' / ') || '岳不群/黄药师/方证/灭绝/小叫花');
  p.maxHp = p.maxHpBase + 120; p.hp = p.maxHp;
}

/* ============================================================ */
section('④ 单调性：防御力↑ → 伤害↓（防公式接反）');
{
  /* rng 钉死在 0.5，去掉 0.85~1.15 的浮动，让比较是纯函数意义上的 */
  const FIX = ctxOf({ rng: { next: () => 0.5 } });
  const at = d => w.combatHooks.damage(p, { defFinal: d }, 100, FIX);
  const ds = [0, 50, 200, 800, 3000].map(at);
  ok('五个防御档位都是有限正数', ds.every(d => Number.isFinite(d) && d > 0), ds.join(' > '));
  ok('严格单调递减', ds.every((d, i) => i === 0 || d < ds[i - 1]), ds.join(' > '));
  ok('防御拉到 3000 仍有伤害（Math.max(1,…) 保底）', ds[4] >= 1, String(ds[4]));
  /* 破防方向：armorPen 越高，伤害越高（同样防公式别接反） */
  const pen0 = w.combatHooks.damage(p, { defFinal: 800 }, 100, ctxOf({ rng: { next: () => 0.5 } }, { armorPen: 0 }));
  const pen7 = w.combatHooks.damage(p, { defFinal: 800 }, 100, ctxOf({ rng: { next: () => 0.5 } }, { armorPen: 0.7 }));
  ok('破防越高伤害越高', pen7 > pen0, `pen0=${pen0} → pen0.7=${pen7}`);
  /* 攻击力方向 */
  const a1 = w.combatHooks.damage({ atk: 10 }, { defFinal: 100 }, 100, FIX);
  const a2 = w.combatHooks.damage({ atk: 10 }, { defFinal: 100 }, 400, FIX);
  ok('基础伤害越高最终伤害越高', a2 > a1, `${a1} → ${a2}`);
}

/* ============================================================ */
section('⑤ 一次攻击后 npc.hp 严格递减且不是 NaN');
{
  const yue = w.spawnNpc('master_yue', w.data.npcs.master_yue.room, 1, true);
  yue.hp = yue.maxHp;
  p.hp = p.maxHp;
  const seq = [yue.hp];
  for (let i = 0; i < 5; i++) {
    w.combat.oneAttack(p, yue, null, BATTLE, 0);
    seq.push(yue.hp);
  }
  ok('五连击后 hp 序列全是有限数', seq.every(Number.isFinite), seq.join(' → '));
  ok('五连击后 hp 严格递减', seq.every((h, i) => i === 0 || h < seq[i - 1]), seq.join(' → '));
  ok('五连击后 hp 不是 NaN', !Number.isNaN(yue.hp) && yue.hp > 0, 'hp=' + yue.hp);
  ok('伤害文本里不是 NaN / undefined', (() => {
    const r = w.combat.oneAttack(p, yue, null, BATTLE, 0);
    return !/NaN|undefined|\[object Object\]/.test(r && r.text || '');
  })(), '岳不群挨打文本');
  ok('改前复现对照：拿模板对象当防御力时必然 NaN（守卫回归）',
    Number.isNaN((100 * (100 / (100 + yue.def * 1)))),
    '正是这个式子当年把 hp 写成 NaN');
  w.despawnNpc('master_yue', w.data.npcs.master_yue.room);
}

/* ============================================================ */
section('⑥ 旧存档（无 defFinal）读进来后伤害依然正常');
{
  /* 造一份「旧档」：NPC 实例上 def 是**数字**（旧 recalc 写脏的），且没有 defFinal */
  const ids = Object.keys(w.data.npcs).filter(id => w.data.npcs[id].room).slice(0, 40);
  for (const id of ids) w.spawnNpc(id, w.data.npcs[id].room, 1, true);
  const saveJson = JSON.stringify(w.serialize());
  const old = JSON.parse(saveJson);
  let stripped = 0;
  for (const k of Object.keys(old.instances.npcs)) {
    const n = old.instances.npcs[k];
    n.def = 180;            // 旧档形态：def 是个数字
    delete n.defFinal;      // 旧档形态：没有 defFinal
    stripped++;
  }
  ok('构造出旧档样本（无 defFinal，def 为数字）', stripped > 0 && Object.keys(old.instances.npcs).length === stripped,
    `${stripped} 个实例`);

  const e2 = new GameEngine({ seed: SEED });
  e2.boot();
  e2.world.deserialize(JSON.parse(JSON.stringify(old)), []);
  const w2 = e2.world, p2 = w2.player;
  const inst = Object.keys(w2.instances.npcs);
  ok('旧档读进来不崩，实例数量一致', inst.length === stripped, `${inst.length}/${stripped}`);
  ok('旧档里被写成数字的 def 已被换回模板对象',
    inst.every(k => typeof w2.instances.npcs[k].def !== 'number'),
    inst.filter(k => typeof w2.instances.npcs[k].def === 'number').slice(0, 3).join(',') || '无残留');
  const badDef = inst.filter(k => !Number.isFinite(defenseOf(w2.instances.npcs[k])) || defenseOf(w2.instances.npcs[k]) < 0);
  ok('旧档全部实例 defenseOf() 有限且非负（没被抹成 0 防御）', badDef.length === 0,
    badDef.length ? badDef.slice(0, 3).map(k => w2.instances.npcs[k].name + '=' + defenseOf(w2.instances.npcs[k])).join(' / ')
      : `${inst.length} 个，示例 defBase=${w2.instances.npcs[inst[0]].defBase}`);
  const badDmg = [];
  for (const k of inst) {
    const n = w2.instances.npcs[k];
    const d = w2.combatHooks.damage(p2, n, 100, ctxOf(w2));
    if (!Number.isFinite(d) || d <= 0) badDmg.push(`${n.name}(${d})`);
  }
  ok('旧档全部实例：玩家伤害是有限正数', badDmg.length === 0,
    badDmg.length ? badDmg.slice(0, 5).join(' / ') : `${inst.length} 个全部通过`);

  /* 三层兜底逐层单测（不依赖真实存档） */
  ok('兜底① defFinal 优先', defenseOf({ defFinal: 42, def: { name: 'x' }, defBase: 7 }) === 42);
  ok('兜底② defFinal 缺失时退回数字 def', defenseOf({ def: 99, defBase: 7 }) === 99);
  ok('兜底③ 都没有时退回 defBase', defenseOf({ def: { name: 'x' }, defBase: 7 }) === 7);
  ok('兜底④ 什么都没有返回 0 而不是 NaN', defenseOf({}) === 0);
  /* 新档 round-trip：defFinal 必须随档走 */
  const s2 = JSON.parse(JSON.stringify(w.serialize()));
  const withFinal = Object.keys(s2.instances.npcs).filter(k => typeof s2.instances.npcs[k].defFinal === 'number');
  ok('新档把 defFinal 存进去了（随档走）', withFinal.length === Object.keys(s2.instances.npcs).length,
    `${withFinal.length}/${Object.keys(s2.instances.npcs).length}`);
}

/* ============================================================ */
section('⑦ 源码静态防线：不许再出现「把 .def 当数字用」');
{
  const files = [];
  (function walk(dir) {
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (st.isDirectory()) { if (f !== '_bak') walk(fp); }
      else if (f.endsWith('.js')) files.push(fp);
    }
  })(path.join(ROOT, 'game', 'src'));
  for (const f of fs.readdirSync(path.join(ROOT, 'tools'))) {
    /* 本脚本自己持有这些反例（⑤ 的回归对照要用模板对象做乘法、⑦ 要写正则），跳过自身 */
    if (f.endsWith('.js') && f !== 'smoke-combat.js') files.push(path.join(ROOT, 'tools', f));
  }
  const hits = (re) => files.filter(f => re.test(fs.readFileSync(f, 'utf8')));
  const rel = f => path.relative(ROOT, f).replace(/\\/g, '/');

  ok('扫到了源码文件', files.length >= 25, files.length + ' 个 .js');
  const A = hits(/\.def\s*[*\/+\-]/);
  ok('没有把 .def 直接拿去做算术', A.length === 0, A.map(rel).join(','));
  const B = hits(/\$\{[^}]*\.def\b/);
  ok('没有把 .def 直接插进显示文本（防 ${x.def}）', B.length === 0, B.map(rel).join(','));
  const C = hits(/defender\.def\b/);
  ok('伤害公式不再直接读 defender.def', C.length === 0, C.map(rel).join(','));
  const D = hits(/this\.def\s*=[^=]/);
  ok('Character 不再写 this.def（防御力改写 defFinal）', D.length === 0, D.map(rel).join(','));
  const E = hits(/\bp\.def\b|\bplayer\.def\b/);
  ok('不再有 p.def / player.def 这种数字读点', E.length === 0, E.map(rel).join(','));
  const COMBAT = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'combat.js'), 'utf8');
  ok('combat.js 的伤害公式走 defenseOf(defender)', /defenseOf\(defender\)/.test(COMBAT));
  ok('combat.js 导出 defenseOf（供其他模块复用）', /module\.exports\s*=\s*\{[^}]*defenseOf/.test(COMBAT));
  const CHAR = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'character.js'), 'utf8');
  ok('character.js 的 recalc 写的是 defFinal', /this\.defFinal\s*=\s*Math\.floor\(def\)/.test(CHAR));
}

w.combatHooks.hitRoll = realHitRoll;

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(44));
process.exit(fail ? 1 : 0);
