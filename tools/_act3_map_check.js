#!/usr/bin/env node
/* ==========================================================================
 *  tools/_act3_map_check.js —— 批 2 地图步引擎合并层终验（design/100 施工单）
 *  --------------------------------------------------------------------------
 *  _apply_act3_map.py 落盘后的引擎层验收（文件层断言在 py 脚本内）：
 *    · 六闸门对象合并层可见（say/msg/travel 三件套 + cond act2_done）
 *    · road_many_1 双向两套都在
 *    · F7 废边删净（jiangnan_east_road 无 s）
 *    · 12 地标房全在合并数据（region 对号）
 *    · kunlun_gate 回边（104 深合并）：e → xixia_pass
 *    · regions.beijiang.entry = road_beijiang_1（行路落点不再空降血刀门）
 *    · 行路边：luoyang→mojiao 没了；luoyang↔beijiang cond act2_done 在
 *    · 行路端到端：置 act2_done 后行路北疆 → 落 road_beijiang_1
 *    · BFS 可达：act2_done 下卷三地标房从官道可达（门对象出口认得）
 *  用法：node tools/_act3_map_check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const { GameEngine } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'engine.js'));
const { evalCond } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'modapi.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

const e = new GameEngine({ seed: 20261008 });
e.boot();
const W = e.world;
const D = W.data;

console.log('\n① 六闸门对象（合并层，cond act2_done）');
const GATES = [
  ['road_nan_1', 'w', 'road_beijiang_1'],
  ['road_gaibang_1', 'e', 'road_xixia_1'],
  ['road_many_1', 'e', 'road_beijiang_1'],
  ['road_many_1', 'w', 'road_xiyu_1'],
  ['jinguo_ruin', 'n', 'road_beijiang_1'],
  ['changan_gate', 's', 'road_xiyu_1'],
  ['road_beijiang_1', 'w', 'road_many_1'],   // 2026-10-15 扫尾④：出北疆保头（严格反向）
];
for (const [rid, d, to] of GATES) {
  const room = W.getRoom(rid);
  const g = room && room.exits && room.exits[d];
  ok(`${rid}.${d} → ${to}`, g && g.to === to && g.cond && g.cond.flag === 'act2_done' && g.say && g.msg && g.travel,
    g ? '三件套齐' : '(无出口)');
}
ok('many_1 双向两套（e 进北疆 / w 出西域）',
  GATES.slice(2, 4).every(([rid, d]) => W.getRoom(rid).exits[d].say));
ok('保头闸配对：road_many_1.e ↔ road_beijiang_1.w 互指',
  W.getRoom('road_many_1').exits.e.to === 'road_beijiang_1' &&
  W.getRoom('road_beijiang_1').exits.w.to === 'road_many_1');

console.log('\n② F7 废边 + 12 地标房 + 回边');
const jer = W.getRoom('jiangnan_east_road');
ok('jiangnan_east_road 无 s（mojiao_shanmen 废边删净）', !(jer.exits && jer.exits.s));
const LANDMARKS = {
  beijiang: ['beijiang_hunting_hut', 'beijiang_market', 'beijiang_yizhan', 'beijiang_lookout'],
  xiyu: ['xiyu_bazaar', 'xiyu_caravanserai', 'xiyu_herb_hut', 'xiyu_well'],
  xixia: ['xixia_salt_shed', 'xixia_market', 'xixia_post', 'xixia_pass'],
};
let lmOk = 0;
for (const [rg, ids] of Object.entries(LANDMARKS))
  for (const id of ids) { const r = W.getRoom(id); if (r && r.region === rg && r.desc && Array.isArray(r.talk)) lmOk++; }
ok('12 地标房全在合并层（region 对号 + desc + talk）', lmOk === 12, lmOk + '/12');
const kun = W.getRoom('kunlun_gate');
ok('kunlun_gate 回边（104 深合并）e → xixia_pass', kun && kun.exits && kun.exits.e === 'xixia_pass');

console.log('\n③ regions.entry + 行路边');
ok('regions.beijiang.entry = road_beijiang_1', D.regions.beijiang && D.regions.beijiang.entry === 'road_beijiang_1');
const links = (D.travel && D.travel.links) || [];
ok('行路边 luoyang→mojiao 已无', !links.some(l => l.from === 'luoyang' && l.to === 'mojiao'));
ok('行路边 luoyang↔beijiang（cond act2_done 双向）',
  links.some(l => l.from === 'luoyang' && l.to === 'beijiang' && l.cond === 'act2_done') &&
  links.some(l => l.from === 'beijiang' && l.to === 'luoyang' && l.cond === 'act2_done'));

console.log('\n④ 行路端到端（act2_done 后行路北疆）');
e.newGame({ name: '验收员', gender: 'male', birth: 'wuxue' });
const p = e.world.player;
p.setFlag('act2_done', true);
p.room = 'luoyang_gate';
const rt = e.exec('行路 北疆');
const movedTo = p.room;
ok('行路北疆落点 = road_beijiang_1（不再空降血刀门）',
  movedTo === 'road_beijiang_1' && !!(rt && rt.lines && !rt.lines.some(l => l.kind === 'warn')),
  '落 ' + movedTo);

console.log('\n⑤ BFS 可达（act2_done，门对象出口认得）');
const VISITED = new Set(['road_beijiang_1']);
const queue = ['road_beijiang_1'];
while (queue.length) {
  const cur = queue.shift();
  const room = W.getRoom(cur);
  const ex = (room && room.exits) || {};
  for (const k of Object.keys(ex)) {
    let to = null, cond = null;
    if (typeof ex[k] === 'string') to = ex[k];
    else if (ex[k] && typeof ex[k] === 'object') { to = ex[k].to; cond = ex[k].cond; }
    if (!to || VISITED.has(to)) continue;
    if (cond && !evalCond(cond, { player: p, world: W })) continue;
    VISITED.add(to); queue.push(to);
  }
}
for (const [rg, ids] of Object.entries(LANDMARKS))
  for (const id of ids)
    ok(`${id} 可达`, VISITED.has(id));

console.log(`\n==== ${pass} 通过 / ${fail} 失败 ====`);
if (fails.length) { console.log('失败项：' + fails.join('；')); process.exit(1); }
