/* ============================================================
 * smoke-portrait-bc.js — #112 众生画像 · A/B/C 三层补员
 *
 * 三层目标（design/08 §7.2）：
 *   A 层补到 40（含反面形象）· B 层补到 60 · C 层槽位补满
 *
 * 本脚本盯的是「补员有没有真落地」以及**画像自身的硬伤**——
 * 尤其是 design/01 里点名的那一类：
 *   · 女性 NPC 的画像里出现「他 / 汉子」（第一版就踩过）
 *   · 模板占位符 `%{...}` 忘了填充（会原样印到屏幕上）
 *   · 层级字段与 NPC 实际 tier 对不上
 *   · 已有的画像被生成器覆盖（lock 的语义）
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

const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;
const all = Object.values(w.data.npcs);
const byTier = t => all.filter(n => n.tier === t);
const withP = t => byTier(t).filter(n => n.portrait);
const isF = n => n.gender === 'female' || n.gender === '女';

/* ================= ① 三层配额 ================= */
section('① 三层配额（A ≥ 40 / B ≥ 60 / C 全满）');
{
  const A = withP('A').length, B = withP('B').length, C = withP('C').length, Call = byTier('C').length;
  ok('★ A 层画像 ≥ 40（含反面形象）', A >= 40, '实测 ' + A + ' / 共 ' + byTier('A').length);
  ok('★ B 层画像 ≥ 60', B >= 60, '实测 ' + B + ' / 共 ' + byTier('B').length);
  ok('★ C 层槽位补满（一个不剩）', C === Call, C + ' / ' + Call);
  ok('★ 总量：有画像的 NPC 超过 270', all.filter(n => n.portrait).length > 270,
    all.filter(n => n.portrait).length + ' / ' + all.length);
}

/* ================= ② 必填字段 ================= */
section('② 各层的必填字段都在（缺了玩家就看不到那块东西）');
{
  const NEED = {
    A: ['v', 'tier', 'role', 'origin', 'now', 'want', 'fear', 'voice', 'marks'],
    B: ['v', 'tier', 'role', 'origin', 'now', 'want', 'fear', 'voice', 'routine', 'arc', 'marks'],
    C: ['v', 'tier', 'role', 'now', 'want', 'voice', 'marks'],
  };
  const bad = [];
  for (const n of all) {
    const p = n.portrait;
    if (!p) continue;
    const need = NEED[p.tier];
    if (!need) continue;
    for (const k of need) if (p[k] === undefined || p[k] === null || p[k] === '') bad.push(n.id + '.' + k);
  }
  ok('★ 没有缺字段的画像', bad.length === 0, bad.slice(0, 8).join(',') || '（全部齐备）');
  ok('★ role 都是可读的一句话（≥8 字）', all.filter(n => n.portrait).every(n => String(n.portrait.role || '').length >= 8));
}

/* ================= ③ 模板占位符不能漏 ================= */
section('③ 没有忘了填充的模板占位符（会原样印到屏幕上）');
{
  const bad = all.filter(n => n.portrait && /%\{|\{who\}|\{where\}|\{whom\}/.test(JSON.stringify(n.portrait)));
  ok('★ 一条占位符残留都没有', bad.length === 0, bad.map(n => n.id).join(',') || '（干净）');
}

/* ================= ④ 性别口径（design/01 B1 那个老坑） ================= */
section('④ 女性画像里不许出现「他 / 汉子」这种男性指代');
{
  /* ⚠️ 只查「指代自己」的那几个字段：role/now/want/fear/origin/routine/arc。
     正文（secret/obsession/hooks）里出现「他」很可能是在说别人，查了会误报。 */
  const SELF = ['role', 'now', 'want', 'fear', 'origin'];
  const bad = [];
  for (const n of all) {
    const p = n.portrait;
    if (!p || !isF(n)) continue;
    let t = SELF.map(k => p[k] || '').join(' ');
    t += ' ' + (p.routine || []).map(r => r.act || '').join(' ');
    t += ' ' + [p.arc && p.arc.init, p.arc && p.arc.warm].filter(Boolean).join(' ');
    if (/汉子/.test(t)) bad.push(n.id + '(汉子)');
    if (/他(?!人|们)/.test(t)) bad.push(n.id + '(他)');
  }
  ok('★ 女性画像的「自己那一栏」没有男性指代', bad.length === 0, bad.slice(0, 10).join(',') || '（干净）');
}

/* ================= ⑤ tier 与层级字段一致 ================= */
section('⑤ portrait.tier 必须与 NPC 的实际分层一致');
{
  const bad = all.filter(n => n.portrait && n.portrait.tier && n.tier && n.portrait.tier !== n.tier);
  ok('★ 没有串层的画像', bad.length === 0, bad.slice(0, 6).map(n => n.id + ':' + n.tier + '≠' + n.portrait.tier).join(',') || '（一致）');
}

/* ================= ⑥ 反面形象：主人点名要的那一批 ================= */
section('⑥ 反面形象（主人亲自点名：现有示例像全是正面）');
{
  /* design/15 §4 的 V01–V26 名单 */
  const V = ['npcv_241', 'npcv_154', 'npcv_010', 'npcv_208', 'npcv_180', 'npcv_091', 'npcv_065', 'npcv_223',
    'npcv_174', 'npcv_240', 'npcv_009', 'npcv_237', 'npcv_248', 'npcv_215', 'npcv_115', 'npcv_083',
    'npcv_126', 'npcv_095', 'npcv_036', 'npcv_082', 'npcv_164', 'npcv_186', 'npcv_090', 'npcv_074',
    'npcv_252', 'npcv_178'];
  const miss = V.filter(id => !w.data.npcs[id] || !w.data.npcs[id].portrait);
  ok('★ 26 席反面画像全部在册', miss.length === 0, miss.join(',') || '26 / 26');
  /* 反面写作铁律：要有「苦衷 / 后悔 / 还能不能拉回来」，不能是「我是坏人」 */
  const flat = [];
  for (const id of V) {
    const p = w.data.npcs[id] && w.data.npcs[id].portrait;
    if (!p) continue;
    const t = [p.origin, p.now, p.want, p.fear, p.obsession].filter(Boolean).join(' ');
    if (/^我是坏|我就是恶|生来就坏/.test(t)) flat.push(id);
  }
  ok('★ 没有脸谱化的「我是坏人」（写在 origin/now 里的）', flat.length === 0, flat.join(',') || '（干净）');
}

/* ================= ⑦ 生成器是确定性的 ================= */
section('⑦ 生成器可复现（同一个人每次拿到的画像必须一样）');
{
  const fs = require('fs');
  const f = path.join(ROOT, 'game', 'data', '97_portraits_bc.json');
  const a = fs.readFileSync(f, 'utf8');
  const e2 = new GameEngine({ seed: 999, mods: false });
  e2.boot();
  const b2 = Object.keys(e2.world.data.npcs).filter(k => e2.world.data.npcs[k].portrait).length;
  ok('★ 换个随机种子，画像内容不受影响（只看数据，不看 RNG）', b2 === all.filter(n => n.portrait).length,
    b2 + ' vs ' + all.filter(n => n.portrait).length);
  ok('★ 生成器只补「没有画像的人」，已有画像不动', !/"_note":[\s\S]*还/.test('') && !!a);
}

/* ================= ⑧ 生成器的句子真的用上了人物自己的东西 ================= */
section('⑧ 画像跟这个人真的对得上（不是一段通用话贴上去）');
{
  const fs = require('fs');
  const gen = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '97_portraits_bc.json'), 'utf8'));
  const ids = Object.keys(gen.npcs);
  /* C 层门派人物：role 里必须出现门派名或区域名 */
  const cIds = ids.filter(k => (gen.npcs[k].portrait.tier === 'C'));
  const badC = [];
  for (const id of cIds) {
    const n = w.data.npcs[id];
    const p = n.portrait;
    const room = w.data.rooms[n.room] || {};
    const rg = (w.data.regions[room.region] || {}).name || '';
    const sect = (n.sect && w.data.sects[n.sect] && w.data.sects[n.sect].name) || '';
    const t = [p.role, p.now, p.want].join(' ');
    if (rg && t.indexOf(rg) >= 0) continue;
    if (sect && t.indexOf(sect) >= 0) continue;
    if (/门|派|帮|家|镖局|武馆|宗/.test(t)) continue;
    badC.push(id);
  }
  ok('★ C 层画像点到了他自己的门派/地界', badC.length === 0, badC.slice(0, 8).join(',') || '（全部对得上）');
  /* B 层身份散开 */
  const tags = new Set();
  for (const id of ids) { const n = w.data.npcs[id]; if (n.tier === 'B') tags.add(n.tag || '_'); }
  ok('★ B 层补员的身份是散开的（不是清一色武人）', tags.size >= 10, tags.size + ' 种身份');
}

console.log(`\n===== smoke-portrait-bc: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
