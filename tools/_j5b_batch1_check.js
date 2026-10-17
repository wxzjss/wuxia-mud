#!/usr/bin/env node
/* ==========================================================================
 *  tools/_j5b_batch1_check.js —— 批7 真走验收（design/107）
 *  件① 夏承志两案 2-stage（时限压接案点 + 老档在途兜底）
 *  件② 结局回响 2 场（交卷/半交 一场，拒交/远航 一场；同场互斥）
 *  用法：node tools/_j5b_batch1_check.js
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
  const e = new GameEngine({ seed: 20261020 });
  e.boot();
  e.newGame({ name: '验收侠', gender: 'male' });
  return e;
}

/* ---------------- 件① 案A ---------------- */
console.log('\n① 案A 时限入口：know_depot_master 已置 → 接不了');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('know_depot_master', true);
  p.room = 'palace_prison';
  e.exec('问旧仆');
  ok('卷四已通关 → 接不了案',
     p.questStage('hk_npcv_082_mibao') === undefined || p.questStage('hk_npcv_082_mibao') < 0,
     'stage=' + p.questStage('hk_npcv_082_mibao'));
}

console.log('\n② 案A 2-stage 真走');
const e1 = fresh(); const p1 = e1.world.player;
p1.room = 'palace_prison';
e1.exec('问旧仆');
ok('接案到 s0', p1.questStage('hk_npcv_082_mibao') === 0);
e1.exec('看');
ok('s0 目标计数（palace_prison）', p1.getVar('hk_npcv_082_mibao_goA') === 1);
e1.exec('交差');
ok('s0 交差推进到 s1', p1.questStage('hk_npcv_082_mibao') === 1);
p1.room = 'jn_yamen_court';
e1.exec('看');
ok('s1 目标计数（jn_yamen_court）', p1.getVar('hk_npcv_082_mibao_go0') === 1);
p1.room = 'palace_prison';
let r = e1.exec('交差');
const mA = pickMenu(r);
ok('收束菜单出现（2 项）', !!(mA && mA.length === 2), mA ? mA.map(o => o.label).join('/') : '(无)');
if (mA && mA[0]) e1.menuPick({ effects: mA[0].effects });
ok('选「替他收好」→ flag', p1.hasFlag('hk_npcv_082_mibao_keep'));
ok('收束到 99', p1.questStage('hk_npcv_082_mibao') === 99);

console.log('\n③ 时限兜底：已接在途 → 卷四通关 → 回来仍能交');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'palace_prison';
  e.exec('问旧仆');                          // 接了案（s0）
  p.setFlag('know_depot_master', true);      // 模拟在途期间卷四主线通关
  e.exec('看');
  e.exec('交差');
  ok('在途推进到 s1 不受影响', p.questStage('hk_npcv_082_mibao') === 1,
     'stage=' + p.questStage('hk_npcv_082_mibao'));
  p.room = 'jn_yamen_court'; e.exec('看');
  p.room = 'palace_prison';
  const rr = e.exec('交差');
  const m = pickMenu(rr);
  ok('通关后回来仍能交（收束无锁）', !!(m && m.length === 2), m ? m.map(o => o.label).join('/') : '(无)');
  if (m && m[1]) e.menuPick({ effects: m[1].effects });
  ok('选「交给东厂」→ flag', p.hasFlag('hk_npcv_082_mibao_give'));
  ok('到 99', p.questStage('hk_npcv_082_mibao') === 99);
}

/* ---------------- 件① 案B ---------------- */
console.log('\n④ 案B 前置链 + 2-stage + 指路');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'palace_prison';
  e.exec('问那幅画');
  ok('案A 未完 → 案B 接不了',
     p.questStage('hk_npcv_082_hua') === undefined || p.questStage('hk_npcv_082_hua') < 0);
  p.setQuestStage('hk_npcv_082_mibao', 99);
  e.exec('问那幅画');
  ok('案A 完成 → 案B 接案', p.questStage('hk_npcv_082_hua') === 0);
  e.exec('看');
  ok('s0 目标计数（palace_prison）', p.getVar('hk_npcv_082_hua_goB') === 1);
  e.exec('交差');
  ok('s0 交差推进到 s1', p.questStage('hk_npcv_082_hua') === 1);
  p.room = 'palace_study';
  const r = e.exec('端详那幅画');
  ok('指路「端详那幅画」真触发', txt(r).indexOf('画上是一片水') >= 0);
  p.room = 'palace_prison';
  e.exec('看');
  ok('s1 目标计数（palace_prison）', p.getVar('hk_npcv_082_hua_go0') === 1);
  const rr = e.exec('交差');
  const m = pickMenu(rr);
  ok('收束菜单（2 项）', !!(m && m.length === 2), m ? m.map(o => o.label).join('/') : '(无)');
  if (m && m[0]) e.menuPick({ effects: m[0].effects });
  ok('选「助元怀瑾自清」→ flag', p.hasFlag('hk_npcv_082_hua_clear'));
  ok('到 99', p.questStage('hk_npcv_082_hua') === 99);
}

/* ---------------- 件② 结局回响 ---------------- */
console.log('\n⑤ 回响①殿上余响：交卷 / 半交');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'palace_hall';
  let r = e.exec('殿上余响');
  ok('无结局 → 不给假入口', txt(r).indexOf('现在做不了这个') >= 0 && !p.hasFlag('echo_hall_seen'));
  p.setFlag('ending_jiaojuan', true);
  r = e.exec('殿上余响');
  ok('交卷分支出现', txt(r).indexOf('末页那个名字') >= 0);
  ok('交卷分支不串半交句', txt(r).indexOf('笔尖上的墨凝成一颗') < 0);
  ok('去重旗落地', p.hasFlag('echo_hall_seen'));
  r = e.exec('殿上余响');
  ok('第二次不再触发', txt(r).indexOf('末页那个名字') < 0);
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('ending_banjiao', true);
  p.room = 'palace_hall';
  const r = e.exec('殿上余响');
  ok('半交分支出现', txt(r).indexOf('笔尖上的墨凝成一颗') >= 0);
  ok('半交分支不串交卷句', txt(r).indexOf('末页那个名字') < 0);
}

console.log('\n⑥ 回响②出宫余响：拒交 / 远航（预留）');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('ending_jujiao', true);
  p.room = 'palace_road';
  const r = e.exec('出宫余响');
  ok('拒交分支出现', txt(r).indexOf('城门上贴着你的画像') >= 0);
  ok('拒交分支不串远航句', txt(r).indexOf('海上的雾把皇城收进去') < 0);
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('ending_yuanhang', true);
  p.room = 'palace_road';
  const r = e.exec('出宫余响');
  ok('远航分支出现（上船离港已落，可活）', txt(r).indexOf('海上的雾把皇城收进去') >= 0);
  ok('远航分支不串拒交句', txt(r).indexOf('城门上贴着你的画像') < 0);
}

console.log('\n⑦ 排头不吞：既有动作照旧命中');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('ending_jujiao', true);          // 出宫余响 cond 已满足
  p.room = 'palace_road';
  const r = e.exec('过御道');                 // 过御道需 three_words + notFlag shadow_done
  ok('「过御道」命中过御道而不是出宫余响',
     !p.hasFlag('echo_road_seen') && txt(r).indexOf('御道还长') >= 0,
     'echo_road_seen=' + p.hasFlag('echo_road_seen'));
}

console.log('\n⑧ 远航落点：上船离港（三旗可活，无悬空旗）');
{
  const e = fresh(); const p = e.world.player;
  p.room = 'haitan_boat';
  let r = e.exec('上船离港');
  ok('无卷五进度 → 不给入口', txt(r).indexOf('现在做不了这个') >= 0 && !p.hasFlag('act5_sail'));
  p.setFlag('three_words', true);
  r = e.exec('上船离港');
  ok('有 three_words 但没问过船期 → 仍不放行', !p.hasFlag('act5_sail'));
  p.setFlag('haitan_ferry_seen', true);
  r = e.exec('上船离港');
  ok('三旗齐 → 触发远航', p.hasFlag('act5_sail'));
  ok('ending_yuanhang 落旗（回响场②点亮）', p.hasFlag('ending_yuanhang'),
     'ending=' + JSON.stringify(p.vars && p.vars.ending));
  ok('离港叙话出现', txt(r).indexOf('海上的雾从两边合上来') >= 0);
  r = e.exec('上船离港');
  ok('二次不再触发（act5_sail 去重）', txt(r).indexOf('海上的雾从两边合上来') < 0);
}
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('three_words', true); p.setFlag('haitan_ferry_seen', true); p.setFlag('act5_done', true);
  p.room = 'haitan_boat';
  e.exec('上船离港');
  ok('面圣已了结 → 不放人走', !p.hasFlag('act5_sail'));
}

console.log('\n⑨ 海路排序：上船离港在头、问船期仍可用、渡海不被吞');
{
  const e = fresh(); const p = e.world.player;
  p.setFlag('act4_done', true);
  p.room = 'haitan_boat';
  const r1 = e.exec('问船期');
  ok('问船期 仍命中自己', p.hasFlag('haitan_ferry_seen'), txt(r1).slice(0, 40));
  const r2 = e.exec('渡海');
  ok('渡海 仍命中自己（不被上船离港吞）', txt(r2).indexOf('没有能让他开船的东西') >= 0);
}

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
