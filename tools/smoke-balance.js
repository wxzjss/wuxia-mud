/* ============================================================
 * smoke-balance.js — 武学底盘：品级 + 基础武学树 + 上限公式（B1）
 *
 * 覆盖：
 *  ① 基础数据里每门武学都有 grade ∈ [1,9]
 *  ② 每门武学（除基础武学 / 显式散手）都能上溯到 SLOT_ROOT 里的一条根
 *  ③ base 链无环、指向真实存在的 skill
 *  ④ 基础武学 maxLevel 已抬到 1000
 *  ⑤ effectiveMax ≤ min(门内硬顶, 基础武学等级)
 *  ⑥ 倍率天花板：damageMult × 2.0 ≤ 4.8
 *  ⑦ 「须先学会基础武学」真的拦得住（learnSkill 路径）
 *
 * ⚠️ 范围只算「基础数据」：mod 武学（太虚三式）与物种招式（bestiary.js 注入的
 *    snake_* / beast_*）不归世界观管，缺 grade 不算缺陷 —— 但会单独报一行数量。
 * ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { SLOT_ROOT, STANDALONE_MAX } = require(path.join(ROOT, 'game', 'src', 'core', 'character.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261011;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

const e0 = boot();
const w = e0.world;
const SK = w.data.skills;
const all = Object.values(SK);
const isBaseSrc = s => /^基础数据/.test(s.__source || '');
const BASE_SK = all.filter(isBaseSrc);
const OTHER_SK = all.filter(s => !isBaseSrc(s));
console.log(`（基础数据武学 ${BASE_SK.length} 门；mod / 物种招式 ${OTHER_SK.length} 门不计入）`);

/* ---------- ① 品级 ---------- */
section('① 品级 grade ∈ [1,9]');
const bad1 = BASE_SK.filter(s => !(Number.isInteger(s.grade) && s.grade >= 1 && s.grade <= 9)).map(s => s.id);
ok(`全部 ${BASE_SK.length} 门基础武学都有合法 grade`, bad1.length === 0, bad1.slice(0, 8).join(','));
const byGrade = {};
for (const s of BASE_SK) byGrade[s.grade] = (byGrade[s.grade] || 0) + 1;
ok('品级分布覆盖 ≥5 档', Object.keys(byGrade).length >= 5, JSON.stringify(byGrade));

/* ---------- ② 根归属 ---------- */
section('② 每门武学都能归到一条基础武学（或显式散手）');
const ROOTS = new Set();
for (const k of Object.keys(SLOT_ROOT)) for (const r of SLOT_ROOT[k]) ROOTS.add(r);
const p0 = w.player;
const orphan = [];
for (const s of BASE_SK) {
  if (ROOTS.has(s.id)) continue;
  if (s.standalone === true) continue;
  const root = p0.skillRoot(s.id);
  if (!ROOTS.has(root)) orphan.push(s.id + '→' + root);
}
ok('没有「无根又没标 standalone」的武学', orphan.length === 0, orphan.slice(0, 8).join(',') + (orphan.length > 8 ? ' …' : ''));

/* ---------- ③ base 链健全 ---------- */
section('③ base 链指向真实武学、无环');
const badBase = [], cyclic = [];
for (const s of all) {
  if (!s.base) continue;
  if (!SK[s.base]) { badBase.push(s.id + '→' + s.base); continue; }
  let cur = s.id, guard = 0, seen = new Set();
  while (cur && guard++ < 32) {
    if (seen.has(cur)) { cyclic.push(s.id); break; }
    seen.add(cur);
    const d = SK[cur];
    if (!d || !d.base) break;
    cur = d.base;
  }
}
ok('base 都指向存在的武学', badBase.length === 0, badBase.join(','));
ok('base 链无环', cyclic.length === 0, cyclic.join(','));

/* ---------- ④ 基础武学硬顶 ---------- */
section('④ 基础武学 maxLevel = 1000');
const BASICS = [...ROOTS];
const notMax = BASICS.filter(id => !SK[id] || SK[id].maxLevel !== 1000);
ok(`${BASICS.length} 门基础武学都存在且 maxLevel=1000`, notMax.length === 0, notMax.join(','));
const marked = BASICS.filter(id => SK[id] && SK[id].isBasic);
ok('基础武学都带 isBasic 标记', marked.length === BASICS.length, `带标记 ${marked.length}/${BASICS.length}`);

/* ---------- ⑤ effectiveMax ---------- */
section('⑤ effectiveMax = min(门内硬顶, 基础武学等级)');
const probe = boot().world.player;
probe.learned['basic_sword'] = { exp: 0, level: 37 };
const em = probe.effectiveMax(SK['huashan_sword']);
ok('衍生武学上限被基础武学压住（37）', em === 37, `effectiveMax(huashan_sword)=${em}`);
const emBasic = probe.effectiveMax(SK['basic_sword']);
ok('基础武学自己不受该项限制', emBasic === probe.maxSkillLevelFor(SK['basic_sword']), `=${emBasic}`);

let viol = 0;
const probe2 = boot().world.player;
for (const id of Object.keys(SK)) probe2.learned[id] = { exp: 0, level: 5 };
for (const s of BASE_SK) {
  if (!s.base) continue;
  if (probe2.effectiveMax(s) > probe2.skillLevel(s.base)) viol++;
}
ok('全库扫描：effectiveMax 无一超过其基础武学等级', viol === 0, 'violations=' + viol);

/* ---------- ⑥ 倍率天花板 ---------- */
section('⑥ 伤害倍率天花板（damageMult × 2.0 ≤ 4.8）');
const over = BASE_SK.filter(s => (s.damageMult || 0) * 2.0 > 4.8001).map(s => s.id + ':' + s.damageMult);
ok('没有超出天花板的武学', over.length === 0, over.join(','));

/* ---------- ⑦ 前置真的拦得住 ---------- */
section('⑦ 「须先学会基础武学」校验生效');
const p1 = boot().world.player;
delete p1.learned['basic_sword'];
delete p1.learned['huashan_sword'];
const r1 = p1.learnSkill('huashan_sword');
ok('未学 basic_sword 时学不了华山剑法', r1.ok === false && /基本剑法/.test(r1.msg || ''), r1.msg);
const r2 = p1.learnSkill('basic_sword');
ok('学了 basic_sword 之后可以学', r2.ok === true, r2.msg);
const r3 = p1.learnSkill('huashan_sword');
ok('前置就位后学会华山剑法', r3.ok === true, r3.msg);
const p2 = boot().world.player;
delete p2.learned['huashan_sword'];
const r4 = p2.learnSkill('huashan_sword', { force: true });
ok('force 通道可绕过基础武学校验（门派入门即授用）', r4.ok === true, r4.msg);
// 学习路径真的会因上限而停：基础剑法只到 5 级 → 华山剑法最多 5 级
const p3 = boot().world.player;
p3.learned['basic_sword'] = { exp: 0, level: 5 };
p3.learnSkill('huashan_sword');
p3.learned['huashan_sword'] = { exp: 0, level: 4 };
const tr = p3.learnSkillByTrain('huashan_sword');
const lvAfter = p3.learned['huashan_sword'].level;
ok('练到基础武学等级就练不动了（≤5）', lvAfter <= 5, `level=${lvAfter} ${tr.msg || ''}`);

/* ---------- ⑧ 散手池 ---------- */
section('⑧ 散手（无基础武学）单独激活池');
ok('STANDALONE_MAX = 3', STANDALONE_MAX === 3);
ok('散手池是数组（不是按 category 分池的对象）', Array.isArray(boot().world.player.standaloneActive));

console.log(`\n===== smoke-balance: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
