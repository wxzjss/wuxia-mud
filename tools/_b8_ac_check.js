#!/usr/bin/env node
/* ==========================================================================
 *  tools/_b8_ac_check.js —— B8 A/C 刀 引擎侧真走验收
 *  · 从**引擎读到的**（boot 后 world.data）验证，不读源分片 —— 专治
 *    「写进分片但引擎没认」的深合并坑
 *  · A1 星宿 crossSect / A1b 古墓本门剑 / A2 十四经典人物槽位 /
 *    A3 mob 降档 / C 绝学招式必有内功
 *  用法：node tools/_b8_ac_check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

const e = new GameEngine({ seed: 20261018 });
e.boot();
const D = e.world.data;
const NPCS = D.npcs || {};
const SK = D.skills || {};
const SECTS = new Set(Object.keys((D.sects) || {}));
const grade = sid => (SK[sid] || {}).grade;
const stype = sid => (SK[sid] || {}).type || '';
const MOVE = new Set(['拳', '剑', '刀', '棍', '暗器', '鞭']);

console.log('\n① A1 星宿派 5 人：唐门毒术以 crossSect 声明');
for (const nid of ['xingxiu_laoxian', 'disciple_xingxiu_0', 'disciple_xingxiu_1', 'disciple_xingxiu_2', 'disciple_xingxiu_3']) {
  const n = NPCS[nid] || {};
  const usesDu = Object.values(n.skills || {}).includes('tangmen_du');
  ok(nid + ' 仍用唐门毒术且已声明', usesDu && (n.crossSect || []).includes('tangmen_du'),
     'crossSect=' + JSON.stringify(n.crossSect));
}
for (const nid of ['disciple_xingxiu_0', 'disciple_xingxiu_1', 'disciple_xingxiu_2', 'disciple_xingxiu_3']) {
  const sk = NPCS[nid].skills || {};
  ok(nid + ' 拳法不再塞在棍槽', !sk['棍'] || stype(sk['棍']) === '棍');
}

console.log('\n② A1b 古墓派 5 人：用本门剑法（无峨眉剑）');
for (const nid of ['disciple_gumu_0', 'disciple_gumu_1', 'disciple_gumu_2', 'disciple_gumu_3', 'gumu_keeper']) {
  const n = NPCS[nid] || {};
  const vals = Object.values(n.skills || {});
  ok(nid + ' 本门剑', vals.includes('gumu_atk_1') && !vals.includes('emei_sword'),
     JSON.stringify(n.skills));
}

console.log('\n③ A2 十四位经典人物：有槽位、装的是 learned 里的绝学');
const CLASSICS = ['yang_guo', 'xiao_longnv', 'li_mochou', 'guo_xiang', 'guo_jing', 'huang_rong',
  'ouyang_feng', 'zhou_botong', 'xiao_feng', 'xu_zhu', 'ren_yingying', 'feng_qingyang',
  'tian_boguang', 'lin_pingzhi'];
for (const nid of CLASSICS) {
  const n = NPCS[nid] || {};
  const sk = n.skills || {};
  const learned = Object.keys(n.learned || {});
  const got = Object.values(sk);
  const hit = got.filter(s => learned.includes(s));
  ok(nid + ' ' + (n.name || ''), Object.keys(sk).length > 0 && hit.length > 0,
     '槽位=' + JSON.stringify(sk));
  const bestGrade = Math.min(...got.map(grade).filter(g => typeof g === 'number'));
  ok(nid + ' 装上了绝学档（≤3）', bestGrade <= 3, 'bestGrade=' + bestGrade);
}
// 内功兜底：每人都要有内功槽
for (const nid of CLASSICS) {
  const sk = NPCS[nid].skills || {};
  const hasInner = Object.values(sk).some(s => stype(s) === '内功');
  ok(nid + ' 有内功槽', hasInner, JSON.stringify(sk));
}

console.log('\n④ A3 mob 降档（品阶 ≥7）');
for (const nid of ['mob_bandit_chief', 'mob_mo_disciple']) {
  const sk = NPCS[nid].skills || {};
  const gs = Object.values(sk).map(grade).filter(g => typeof g === 'number');
  ok(nid + ' 已降档', gs.length > 0 && Math.min(...gs) >= 7, JSON.stringify(sk) + ' grades=' + gs);
}

console.log('\n⑤ C 刀：绝学招式必有内功（本门无中阶以内 → 至少通用）');
let left = 0, total = 0;
for (const [nid, n] of Object.entries(NPCS)) {
  const sk = n.skills;
  if (!sk || typeof sk !== 'object') continue;
  const vals = Object.values(sk);
  const gm = Math.min(...vals.map(grade).filter(g => typeof g === 'number' && MOVE.has(stype(Object.keys(sk)[vals.indexOf(g)] || ''))));
  const moveGrades = vals.filter(s => MOVE.has(stype(s))).map(grade).filter(g => typeof g === 'number');
  if (!moveGrades.length || Math.min(...moveGrades) > 3) continue;
  total++;
  const inner = vals.filter(s => stype(s) === '内功');
  if (!inner.length) { left++; console.log('   缺内功:', nid, n.name); }
}
ok('绝学招式无内功的 NPC 归零', left === 0, `总 ${total} 人，缺 ${left}`);

console.log('\n⑥ 门派错配归零（crossSect 例外）');
let mis = [];
for (const [nid, n] of Object.entries(NPCS)) {
  const sect = n.sect;
  if (!SECTS.has(sect)) continue;
  const cs = new Set(n.crossSect || []);
  for (const sid of Object.values(n.skills || {})) {
    const p = String(sid).split('_')[0];
    if (SECTS.has(p) && p !== sect && !cs.has(sid)) mis.push(nid + ':' + sid + '(' + p + '/本门' + sect + ')');
  }
}
ok('无未声明的跨派', mis.length === 0, mis.slice(0, 6).join(', '));

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
