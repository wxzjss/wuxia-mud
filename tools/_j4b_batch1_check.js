#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j4b_batch1_check.js —— 批6·卷四第一批 真走验收（design/106）
 *  件① 皮朝颜山门账：案A 4-stage + 案B 收束（接案前置链）
 *  件② L4 腰牌过哨三场：亮腰牌（正）/ 报号（邪）/ 对暗号（散·karma 轴）
 *  件③ 卷四末海路接引场：问船期（排在渡海之前，不吃「船」）
 *  用法：node tools/_j4b_batch1_check.js
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
function pickMenu(r) {
  const l = (r && r.lines || []).find(x => x && x.kind === 'menu');
  return l ? l.options : null;
}
function txt(r) { return JSON.stringify(r && r.lines || []); }
function fresh() {
  const e = new GameEngine({ seed: 20261019 });
  e.boot();
  e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

/* ---------------- 件① 案A 4-stage ---------------- */
console.log('\n① 案A 前置：act3_done 入口锁');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'mojiao_shanmen';
  const r = e.exec('问赌坊');
  ok('未过卷三（act3_done 未置）→ 接不了案',
     p.questStage('hk_npcv_164_yinzi') === undefined || p.questStage('hk_npcv_164_yinzi') < 0,
     'stage=' + p.questStage('hk_npcv_164_yinzi'));
  p.setFlag('act3_done', true);
  e.exec('问赌坊');
  ok('过卷三 → 接案到 s0', p.questStage('hk_npcv_164_yinzi') === 0);
}

console.log('\n② 案A 全 stage 真走');
const e1 = fresh(); const p1 = e1.world.player;
p1.setFlag('act3_done', true);
p1.room = 'mojiao_shanmen';
e1.exec('问赌坊');
e1.exec('看');
ok('s0 目标房计数（mojiao_shanmen）', p1.getVar('hk_npcv_164_yinzi_goA') === 1);
e1.exec('交差');
ok('s0 交差推进到 s1', p1.questStage('hk_npcv_164_yinzi') === 1);

p1.room = 'mojiao_hall';
e1.exec('看');
ok('s1 目标房计数（mojiao_hall）', p1.getVar('hk_npcv_164_yinzi_goB') === 1);
let r = e1.exec('翻旧账');
ok('指路「翻旧账」真触发 + flag', p1.hasFlag('yinzi_ledger') && (r.lines || []).length > 0);
p1.room = 'mojiao_shanmen';
e1.exec('交差');
ok('s1 交差推进到 s2', p1.questStage('hk_npcv_164_yinzi') === 2);

e1.exec('看');
ok('s2 目标房计数（mojiao_shanmen·崖后）', p1.getVar('hk_npcv_164_yinzi_goC') === 1);
r = e1.exec('摸井沿');
ok('指路「摸井沿」真触发 + flag', p1.hasFlag('yinzi_well'));
e1.exec('交差');
ok('s2 交差推进到 s3（收束）', p1.questStage('hk_npcv_164_yinzi') === 3);

p1.room = 'mojiao_hall';
e1.exec('看');
ok('s3 收束目标计数（mojiao_hall）', p1.getVar('hk_npcv_164_yinzi_go0') === 1);
p1.room = 'mojiao_shanmen';
r = e1.exec('交差');
const menuA = pickMenu(r);
ok('收束菜单出现（2 项）', !!(menuA && menuA.length === 2), menuA ? menuA.map(o => o.label).join('/') : '(无)');
if (menuA && menuA[0]) e1.menuPick({ effects: menuA[0].effects });
ok('选「替她查账」→ flag hk_sirenzhang', p1.hasFlag('hk_sirenzhang'));
ok('收束到 99', p1.questStage('hk_npcv_164_yinzi') === 99);

console.log('\n③ 卷四界锁（异常态：未过卷三却有 s3 在身）');
{
  const e = fresh(); const p = e.world.player;
  p.setQuestStage('hk_npcv_164_yinzi', 3);
  p.room = 'mojiao_shanmen';
  const rr = e.exec('交差');
  ok('act3_done 未置 → 交不了', p.questStage('hk_npcv_164_yinzi') === 3);
  ok('lockMsg 出现', txt(rr).indexOf('过了雪谷之后的事') >= 0);
}

console.log('\n④ 案B 前置链 + 收束（保 1-stage）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true);
  p.room = 'mojiao_shanmen';
  e.exec('问枯井');
  ok('案A 未完 → 案B 接不了', p.questStage('hk_npcv_164_sirenzhang') === undefined || p.questStage('hk_npcv_164_sirenzhang') < 0);
  p.setQuestStage('hk_npcv_164_yinzi', 99);
  e.exec('问枯井');
  ok('案A 完成 → 案B 接案', p.questStage('hk_npcv_164_sirenzhang') === 0);
  e.exec('看');
  ok('案B 目标计数（同房）', p.getVar('hk_npcv_164_sirenzhang_go0') === 1);
  const rr = e.exec('交差');
  const m = pickMenu(rr);
  ok('案B 收束菜单（2 项）', !!(m && m.length === 2), m ? m.map(o => o.label).join('/') : '(无)');
  if (m && m[0]) e.menuPick({ effects: m[0].effects });
  ok('选「揭发出去」→ flag', p.hasFlag('hk_npcv_164_sirenzhang_expose'));
  ok('案B 到 99', p.questStage('hk_npcv_164_sirenzhang') === 99);
}

/* ---------------- 件② L4 三场 ---------------- */
console.log('\n⑤ L4 三场：不满足条件不给假入口');
for (const cmd of ['亮腰牌', '报号', '对暗号']) {
  const e = fresh(); const p = e.world.player;
  p.room = 'mojiao_shanmen';
  const r = e.exec(cmd);
  ok('裸条件（无 act3_done）→ ' + cmd + ' 被挡',
     txt(r).indexOf('现在做不了这个') >= 0 && !p.hasFlag('sentinel1'));
}

console.log('\n⑥ L4 ①正派·亮腰牌（hasSect + karma）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.sect = 'huashan'; p.karma = 25;
  p.room = 'mojiao_shanmen';
  e.exec('亮腰牌');
  ok('hasSect + karma25 → 放行', p.hasFlag('sentinel1'));
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.sect = 'huashan'; p.karma = 0;
  p.room = 'mojiao_shanmen';
  e.exec('亮腰牌');
  ok('hasSect 但 karma<20 → 不放行', !p.hasFlag('sentinel1'));
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.karma = 25;   // 无门派
  p.room = 'mojiao_shanmen';
  e.exec('亮腰牌');
  ok('无门派 → 亮腰牌不放行（散人走暗号）', !p.hasFlag('sentinel1'));
}

console.log('\n⑦ L4 ②邪派·报号（karma 负 / 魔教 rep）');
for (const [karma, rep, label] of [[-30, 0, 'karma<=-20'], [0, 45, 'rep 日月神教>=40']]) {
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.karma = karma; p.reputation['日月神教'] = rep;
  p.room = 'mojiao_shanmen';
  const r = e.exec('报号');
  ok(label + ' → 报号放行', p.hasFlag('sentinel1'),
     (r.lines || []).map(l => l.text || '').join(' | ').slice(0, 30));
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.karma = 10;
  p.room = 'mojiao_shanmen';
  e.exec('报号');
  ok('karma 10 且无魔教声望 → 不放行', !p.hasFlag('sentinel1'));
}

console.log('\n⑧ L4 ③散人·对暗号（karma 轴两分支）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.karma = 25;
  p.room = 'mojiao_shanmen';
  const r = e.exec('对暗号');
  ok('散人 karma>=20 → 善缘放行', p.hasFlag('sentinel1'));
  ok('放行句出现', txt(r).indexOf('有人替你留过话') >= 0);
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.karma = 0;
  p.room = 'mojiao_shanmen';
  const r = e.exec('对暗号');
  ok('散人 karma<20 → 不放行（明说，不静默）',
     !p.hasFlag('sentinel1') && txt(r).indexOf('这条道不认生人') >= 0);
}

console.log('\n⑨ L4 去重（sentinel1 已落 → 三场不再触发）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act3_done', true); p.setFlag('sentinel1', true);
  p.sect = 'huashan'; p.karma = 25;
  p.room = 'mojiao_shanmen';
  for (const cmd of ['亮腰牌', '报号', '对暗号']) {
    const r = e.exec(cmd);
    ok('已过哨 → ' + cmd + ' 不触发', txt(r).indexOf('现在做不了这个') >= 0);
  }
}

/* ---------------- 件③ 海路接引 ---------------- */
console.log('\n⑩ 海路接引：问船期');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'haitan_boat';
  let r = e.exec('问船期');
  ok('act4_done 未置 → 被挡', txt(r).indexOf('现在做不了这个') >= 0 && !p.hasFlag('haitan_ferry_seen'));
  p.setFlag('act4_done', true);
  r = e.exec('问船期');
  ok('act4_done → 接引触发 + flag', p.hasFlag('haitan_ferry_seen'));
  ok('接引句出现（两条去处）',
     txt(r).indexOf('一趟往东') >= 0 && txt(r).indexOf('一趟往南') >= 0);
  r = e.exec('问船期');
  ok('第二次不再触发（flag 去重）', txt(r).indexOf('一趟往东') < 0);
}

console.log('\n⑪ 排序：问船期排头，不吃「渡海」');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act4_done', true);      // 问船期 cond 已满足
  p.room = 'haitan_boat';
  const r = e.exec('渡海');           // 渡海需 has_canjuan（未置）→ 回它自己的 failMsg
  ok('「渡海」命中渡海而不是问船期',
     !p.hasFlag('haitan_ferry_seen') && txt(r).indexOf('没有能让他开船的东西') >= 0,
     'ferry_seen=' + p.hasFlag('haitan_ferry_seen'));
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
