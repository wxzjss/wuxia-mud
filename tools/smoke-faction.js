/* ============================================================
 * smoke-faction.js — 门派邦交 / 见面摩擦 / 门派大比（design/40 §5.4~5.7）
 *
 * 覆盖：
 *  ① 手设关系覆盖生效（同阵营世仇能推出来，默认矩阵推不出）
 *  ② 邦交指令列出各派关系 + 梁子文案
 *  ③ 见面摩擦：敌对门派弟子照面撂狠话；有交情的不发作
 *  ④ 门派大比：三轮、逐轮推进、名次给贡献与武学
 *  ⑤ 数据自洽：override 的键指向真实门派、feud 文案不空
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261015;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

const e0 = boot();
const w0 = e0.world;

/* ---------- ① 关系覆盖 ---------- */
section('① 手设关系覆盖');
const ov = w0.data.relationsOverride || {};
ok('覆盖表已加载', Object.keys(ov).length >= 5, String(Object.keys(ov).length));
ok('华山↔泰山被覆盖成仇（默认同阵营 +40）', w0.factionRel('huashan', 'taishan') === -30, String(w0.factionRel('huashan', 'taishan')));
ok('对照：未覆盖的正道两家仍是 +40', w0.factionRel('wudang', 'shaolin') === 40, String(w0.factionRel('wudang', 'shaolin')));

/* ---------- ⑤ 数据自洽 ---------- */
section('⑤ 数据自洽');
const badKey = [];
for (const k of Object.keys(ov)) {
  const [a, b] = k.split('|');
  if (!w0.data.sects[a]) badKey.push(k + '(' + a + ')');
  if (!w0.data.sects[b]) badKey.push(k + '(' + b + ')');
}
ok('覆盖表的键都指向真实门派', badKey.length === 0, badKey.join(','));
const feud = w0.data.factionFeud || {};
const badFeud = Object.keys(feud).filter(k => !feud[k] || String(feud[k]).length < 6);
ok('梁子文案都不空（≥6 字）', badFeud.length === 0, badFeud.join(','));

/* ---------- ② 邦交指令 ---------- */
section('② 邦交指令');
const e1 = boot(); const w1 = e1.world, p1 = w1.player;
p1.joinSect('huashan');
const r1 = e1.exec('邦交');
const t1 = (r1.lines || []).map(l => l.text).join('\n');
ok('列出了本派邦交', /华山派 · 邦交/.test(t1), t1.split('\n')[0]);
ok('泰山派标成了不睦/死仇', /泰山派（[^）]*）：(不睦|死仇)/.test(t1), (t1.match(/泰山派[^\n]*/) || [''])[0]);
ok('列出了梁子文案', /五岳并派/.test(t1));
const r1b = boot().exec('邦交');
ok('无门派时给提示（不报错）', JSON.stringify(r1b.lines).indexOf('还没有门派') >= 0);

/* ---------- ③ 见面摩擦 ---------- */
section('③ 见面摩擦');
const e2 = boot(); const w2 = e2.world, p2 = w2.player;
p2.sect = 'huashan';
// 把泰山的掌门搬到长安街上，玩家也过去
const foe = w2.spawnNpc('taishan_master', 'changan_street', 1, true);
ok('前提：两家关系确实在阈值以下', w2.factionRel('huashan', 'taishan') <= -25, String(w2.factionRel('huashan', 'taishan')));
w2.movePlayerTo(p2, 'changan_street');
delete foe._feudAt;   // 进屋那次已经发作过一遍，这里清掉时间戳，验的是「再次照面」
let lines = w2.onRoomEnter(p2, w2.data.rooms['changan_street']);
let joined = lines.map(l => l.text).join('\n');
ok('敌对门派弟子照面撂了狠话', /脸色一沉|的弟子？/.test(joined), joined.slice(0, 120));
ok('同时交代了两家的梁子', /五岳并派/.test(joined));
/* 有交情 → 不发作 */
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
p3.sect = 'huashan';
const foe3 = w3.spawnNpc('taishan_master', 'changan_street', 1, true);
foe3.favor = 50;
w3.movePlayerTo(p3, 'changan_street');
const lines3 = w3.onRoomEnter(p3, w3.data.rooms['changan_street']);
ok('有交情（好感 ≥20）就不发作', !/脸色一沉/.test(lines3.map(l => l.text).join('\n')), (lines3.map(l => l.text).join('\n') || '(空)').slice(0, 80));
/* 非敌对 → 不发作 */
const e4 = boot(); const w4 = e4.world, p4 = w4.player;
p4.sect = 'huashan';
w4.spawnNpc('wudang_master', 'changan_street', 1, true);
w4.movePlayerTo(p4, 'changan_street');
const lines4 = w4.onRoomEnter(p4, w4.data.rooms['changan_street']);
ok('关系尚可的门派不发作', !/脸色一沉/.test(lines4.map(l => l.text).join('\n')));

/* ---------- ④ 门派大比 ---------- */
section('④ 门派大比');
const e5 = boot(); const w5 = e5.world, p5 = w5.player;
p5.sect = 'jindao'; p5.rank = 1;
// 站到自家地界
w5.movePlayerTo(p5, 'jindao_hall');
const r5a = e5.exec('门派大比');
const t5a = (r5a.lines || []).map(l => l.text).join('\n');
ok('开赛：第 1 轮', /第 1 轮/.test(t5a), t5a.split('\n')[0]);
ok('真的进了切磋战斗', !!w5.battle, w5.battle ? 'battle ok' : 'no battle');
// 假装打赢第一轮
const opp1 = w5.getNpc(p5.vars.tourney.oppId);
opp1.hp = 0; opp1.knockedOut = true;
w5.battle = null; p5.inCombat = false;
const r5b = e5.exec('门派大比');
ok('推进到第 2 轮', /第 2 轮/.test((r5b.lines || []).map(l => l.text).join('\n')), (r5b.lines || []).map(l => l.text)[0]);
const opp2 = w5.getNpc(p5.vars.tourney.oppId);
opp2.hp = 0; opp2.knockedOut = true;
w5.battle = null; p5.inCombat = false;
const r5c = e5.exec('门派大比');
ok('推进到第 3 轮', /第 3 轮/.test((r5c.lines || []).map(l => l.text).join('\n')), (r5c.lines || []).map(l => l.text)[0]);
const opp3 = w5.getNpc(p5.vars.tourney.oppId);
opp3.hp = 0; opp3.knockedOut = true;
w5.battle = null; p5.inCombat = false;
const contribBefore = p5.sectContribution || 0;
const r5d = e5.exec('门派大比');
const t5d = (r5d.lines || []).map(l => l.text).join('\n');
ok('三轮后结算', /大比落幕/.test(t5d), t5d.slice(0, 100));
ok('给了门派贡献', (p5.sectContribution || 0) > contribBefore, `${contribBefore} → ${p5.sectContribution}`);
ok('顺手传了一门本派武学', Object.keys(p5.learned).some(k => k.indexOf('jindao_') === 0), Object.keys(p5.learned).filter(k => k.indexOf('jindao_') === 0).join(','));
ok('赛程状态已清空', !p5.vars.tourney);
// 不在自家地界的对照
const e6 = boot(); const w6 = e6.world, p6 = w6.player;
p6.sect = 'jindao';
const r6 = e6.exec('门派大比');
ok('不在自家地界比不了（对照组）', JSON.stringify(r6.lines).indexOf('站的地方不对') >= 0, JSON.stringify(r6.lines[0].text));

console.log(`\n===== smoke-faction: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
