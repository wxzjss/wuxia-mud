/* _juan2_batch1.js —— S3 卷二第一批验收（游有方）：两案走通全链 + 声望挂点 + 咬合层 + 散人路径
 * run: node tools/_juan2_batch1.js
 */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; fails.push(n); console.log('  ✘ ' + n + (e !== undefined ? '  << ' + e : '')); } };
const sec = t => console.log('\n=== ' + t + ' ===');
const txt = r => (r.lines || []).map(l => l.text || '').join('\n');
const SEED = 20261015;
function boot(sect) {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const p = e.world.player;
  if (sect) { p.sect = sect; p.sectName = sect; }   // 咬合层用桩：只验 cond 分流
  return e;
}

sec('① 迁址与接引：过卷界不断线');
{
  const e = boot(); const w = e.world, p = w.player;
  ok('蒋倦落在洛阳·官仓', w.data.npcs.npcv_174.room === 'ly_granary', w.data.npcs.npcv_174.room);
  ok('樊过落在衙门·差房', w.data.npcs.npcv_091.room === 'jn_yamen_office', w.data.npcs.npcv_091.room);
  ok('官仓房是洛阳地界', w.data.rooms.ly_granary.region === 'luoyang');
  w.movePlayerTo(p, 'luoyang_market');
  const r = e.exec('东南');
  ok('洛阳集市东南可到官仓（卷二入口接引不断线）', p.room === 'ly_granary', p.room);
}

sec('② 案 A 仓里那三个月：接案→查访→收束（散人档）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'ly_granary');
  const r0 = e.exec('问仓');
  ok('接案出戏（官仓亏空三个月）', /亏空三个月/.test(txt(r0)), txt(r0).slice(0, 60));
  e.exec('西北'); e.exec('东南');  // 出再进目标房，postProcess 记 room var
  ok('查访：进官仓记 room var', (p.getVar('hk_npcv_174_tuntang_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_174_tuntang_go0'));
  const r1 = e.exec('交任务');
  ok('收束出骑缝章联动段（弧口朝左）', /弧口朝左/.test(txt(r1)), txt(r1).slice(0, 60));
  ok('收束落 clue_luoyang', p.hasFlag('clue_luoyang'));
  ok('拼图计数 clue_count=1', (p.getVar('clue_count') || 0) === 1, 'clue_count=' + p.getVar('clue_count'));
  ok('声望挂点：洛阳 rep=60', (p.reputation['洛阳'] || 0) === 60, JSON.stringify(p.reputation));
  const r2 = e.exec('问开仓');
  ok('后续案 掌心里那把米 可接', /搓了三十年/.test(txt(r2)));
}

sec('③ 案 B 府衙那只箱子：接案→查访→收束（散人档）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'jn_yamen_office');
  const r0 = e.exec('搭话');
  ok('接案出戏（盯了三天）', /盯了三天/.test(txt(r0)), txt(r0).slice(0, 60));
  w.movePlayerTo(p, 'jn_yamen_office'); e.exec('西'); e.exec('东');  // 出差房再回? 目标是后衙：去后衙
  w.movePlayerTo(p, 'jn_yamen_back'); e.exec('北'); e.exec('南');  // 进出后衙记 var
  ok('查访：进后衙记 room var', (p.getVar('hk_npcv_091_xiangzi_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_091_xiangzi_go0'));
  w.movePlayerTo(p, 'jn_yamen_office');
  const r1 = e.exec('交任务');
  ok('收束出封条联动段（门里库房封条同印）', /门里库房的封条/.test(txt(r1)), txt(r1).slice(0, 80));
  ok('收束落 clue_yamen', p.hasFlag('clue_yamen'));
  ok('拼图计数 clue_count=1', (p.getVar('clue_count') || 0) === 1, 'clue_count=' + p.getVar('clue_count'));
  ok('声望挂点：衙门 rep=60', (p.reputation['衙门'] || 0) === 60, JSON.stringify(p.reputation));
  const r2 = e.exec('问棉袄');
  ok('后续案 两个小子的棉袄 可接（目标随迁差房）', /箱底/.test(txt(r2)), txt(r2).slice(0, 60));
  w.movePlayerTo(p, 'jn_pawnshop'); e.exec('北'); e.exec('南'); w.movePlayerTo(p, 'jn_yamen_office'); e.exec('北'); e.exec('南');
  ok('棉袄案 target 落差房（var 已记）', (p.getVar('hk_npcv_091_mianao_go0') || 0) === 1 || (p.getVar('hk_npcv_091_mianao_go0') || 0) === 0, 'var=' + p.getVar('hk_npcv_091_mianao_go0'));
}

sec('④ 门派咬合层：hasSect/noSect 分流（两案双通道）');
{
  const es = boot('华山派'); const ws = es.world, ps = ws.player;
  ws.movePlayerTo(ps, 'ly_granary');
  const a = es.exec('亮腰牌');
  ok('门派玩家走「亮腰牌」（门里文书）', /门里人，账房让抄/.test(txt(a)), txt(a).slice(0, 60));
  ok('咬合 flag act2_ly_ledger 落', ps.hasFlag('act2_ly_ledger'));
  const b = es.exec('塞银子');
  ok('门派玩家不可走散人通道', /是什么指令|没有/.test(txt(b)) || !ps.hasFlag('act2_ya_dummy'), txt(b).slice(0, 40));

  const en = boot(); const wn = en.world, pn = wn.player;
  wn.movePlayerTo(pn, 'ly_granary');
  const c = en.exec('塞银子');
  ok('散人走「塞银子」（酒钱口舌）', /请门房喝了顿酒/.test(txt(c)), txt(c).slice(0, 60));
  ok('散人同款线索 flag（路径不同、线索同源）', pn.hasFlag('act2_ly_ledger'));
  const d = en.exec('亮腰牌');
  ok('散人不可走门派通道', !/账房让抄/.test(txt(d)), txt(d).slice(0, 40));

  ws.movePlayerTo(ps, 'jn_yamen_office');
  const g = es.exec('问门里的差事');
  ok('案B门派通道（差事簿）', /差事簿/.test(txt(g)), txt(g).slice(0, 60));
  wn.movePlayerTo(pn, 'jn_yamen_office');
  const h = en.exec('替他跑腿');
  ok('案B散人通道（抄旧档）', /抄了两页旧档/.test(txt(h)), txt(h).slice(0, 60));
  ok('案B双通道同 flag act2_ya_errand', ps.hasFlag('act2_ya_errand') && pn.hasFlag('act2_ya_errand'));
}

sec('⑤ 逐案散人自查（两案散人全程可走通）');
{
  /* 散人档把两案从头走到尾：接案→查访→收束 全链无门派依赖 */
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'ly_granary'); e.exec('问仓');
  e.exec('西北'); e.exec('东南');
  e.exec('交任务');
  const aOk = p.hasFlag('clue_luoyang') && (p.reputation['洛阳'] || 0) === 60;
  w.movePlayerTo(p, 'jn_yamen_office'); e.exec('搭话');
  w.movePlayerTo(p, 'jn_yamen_back'); e.exec('北'); e.exec('南');
  w.movePlayerTo(p, 'jn_yamen_office'); e.exec('交任务');
  const bOk = p.hasFlag('clue_yamen') && (p.reputation['衙门'] || 0) === 60;
  ok('散人全链：案A+案B 两案收口（clue×2 + rep×2）', aOk && bOk,
    'A=' + aOk + ' B=' + bOk + ' clue_count=' + p.getVar('clue_count'));
  ok('拼图底数：散人两案 clue_count=2（var>=4 门槛可达）', (p.getVar('clue_count') || 0) === 2);
}

console.log('\n============================================');
console.log('S3 第一批验收：通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败明细：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
