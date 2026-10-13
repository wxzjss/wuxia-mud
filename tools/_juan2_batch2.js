/* _juan2_batch2.js —— S3 卷二第二批验收（游有方）：四案全链 + 浮名 + 乙分支作证 + 思过崖门槛 + contrib 咬合
 * run: node tools/_juan2_batch2.js
 */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; fails.push(n); console.log('  ✘ ' + n + (e !== undefined ? '  << ' + JSON.stringify(e) : '')); } };
const sec = t => console.log('\n=== ' + t + ' ===');
const txt = r => (r.lines || []).map(l => l.text || '').join('\n');
const SEED = 20261016;
const DIRCN = { n: '北', s: '南', e: '东', w: '西', nw: '西北', ne: '东北', sw: '西南', se: '东南', u: '上', d: '下' };

function boot(sect) {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male' });
  const p = e.world.player;
  if (sect) { p.sect = sect; p.sectName = sect; }
  return e;
}
/* 经由真实 exec 进入目标房（postProcess 记 room var 的唯一正路） */
function enterViaExec(e, p, target) {
  const rooms = e.world.data.rooms;
  for (const [rid, r] of Object.entries(rooms)) {
    const ex = r.exits || {};
    for (const [d, t] of Object.entries(ex)) {
      const tt = typeof t === 'string' ? t : t.to;
      if (tt === target) {
        e.world.movePlayerTo(p, rid);
        e.exec(DIRCN[d]);
        if (p.room === target) return true;
      }
    }
  }
  return false;
}

sec('① 迁址落位：四案 NPC 换防');
{
  const e = boot(); const w = e.world;
  ok('闵春晓落在长安·西市', w.data.npcs.npcv_215.room === 'changan_market', w.data.npcs.npcv_215.room);
  ok('孔拾月落在襄阳·马市且改口漕头', w.data.npcs.npcv_208.room === 'xiangyang_market' && w.data.npcs.npcv_208.title === '漕头', w.data.npcs.npcv_208.title);
  ok('李无咎落在成都·蜀锦市', w.data.npcs.npcv_237.room === 'chengdu_market', w.data.npcs.npcv_237.room);
  ok('蓝若愚留在姑苏·燕子坞（零迁址）', w.data.npcs.npcv_223.room === 'gusu_yanzi', w.data.npcs.npcv_223.room);
}

sec('② 长安案·那半张盐引：接案→查访→收束（散人档）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'changan_market');
  const r0 = e.exec('批盐引');
  ok('接案出戏（烧了十年）', /烧了十年/.test(txt(r0)), txt(r0).slice(0, 60));
  ok('查访：进西市记 room var', (p.getVar('hk_npcv_215_yanyin_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_215_yanyin_go0'));
  const r1 = e.exec('交任务');
  ok('收束出弧口朝左联动段', /弧口朝左/.test(txt(r1)), txt(r1).slice(0, 80));
  ok('收束落 clue_changan', p.hasFlag('clue_changan'));
  ok('拼图计数 clue_count=1', (p.getVar('clue_count') || 0) === 1, 'clue_count=' + p.getVar('clue_count'));
  ok('声望挂点：长安 rep=60', (p.reputation['长安'] || 0) === 60, JSON.stringify(p.reputation));
  const r2 = e.exec('找孟明');
  ok('次级案 孟明亡母那笔钱 可接（目标不动）', /苗疆/.test(txt(r2)), txt(r2).slice(0, 60));
}

sec('③ 襄阳案·江上那三条船：接案→查访→收束（散人档）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'xiangyang_market');
  const r0 = e.exec('问船');
  ok('接案出戏（三条船不肯靠岸）', /不肯靠岸/.test(txt(r0)), txt(r0).slice(0, 60));
  ok('查访：进马市记 room var', (p.getVar('hk_npcv_208_feng_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_208_feng_go0'));
  const r1 = e.exec('交任务');
  ok('收束出船号联动段（铲痕/出仓单）', /出仓单/.test(txt(r1)), txt(r1).slice(0, 80));
  ok('收束落 clue_xiangyang', p.hasFlag('clue_xiangyang'));
  ok('声望挂点：襄阳 rep=60', (p.reputation['襄阳'] || 0) === 60, JSON.stringify(p.reputation));
}

sec('④ 成都案·那口刀伤→秤砣上那点尘：两案接力（散人档）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'chengdu_market');
  const r0 = e.exec('抓药');
  ok('接刀伤案出戏（通缉上了墙）', /通缉/.test(txt(r0)), txt(r0).slice(0, 60));
  ok('查访：进蜀锦市记 room var', (p.getVar('hk_npcv_237_daoshang_go0') || 0) === 1);
  e.exec('交任务');
  ok('刀伤案收口（目标已迁蜀锦市）', p.hasFlag('questdone_hk_npcv_237_daoshang') || (p.getVar('hk_npcv_237_daoshang_go0') || 0) === 1);
  const r1 = e.exec('问他擦秤');
  ok('次案可接（擦的不是秤砣）', /擦的不是秤砣/.test(txt(r1)), txt(r1).slice(0, 60));
  ok('秤砣案进入竹巷记 var', enterViaExec(e, p, 'chengdu_lane') && (p.getVar('hk_npcv_237_cheng_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_237_cheng_go0'));
  w.movePlayerTo(p, 'chengdu_market');
  const r2 = e.exec('交任务');
  ok('收束出烙印缺口联动段', /缺.{0,4}同一角|缺了一角/.test(txt(r2)), txt(r2).slice(0, 100));
  ok('收束落 clue_chengdu', p.hasFlag('clue_chengdu'));
  ok('声望挂点：成都 rep=60', (p.reputation['成都'] || 0) === 60, JSON.stringify(p.reputation));
}

sec('⑤ 姑苏案·枫桥那个人贩子：两段查访→收束（散人档，零迁址）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'gusu_yanzi');
  const r0 = e.exec('问他腿');
  ok('接案出戏（翻了十二年乱葬岗）', /十二年/.test(txt(r0)), txt(r0).slice(0, 60));
  ok('一段查访：进世家巷记 var', enterViaExec(e, p, 'gusu_zhai_lane') && (p.getVar('hk_npcv_223_meimei_go0') || 0) === 1, 'var=' + p.getVar('hk_npcv_223_meimei_go0'));
  w.movePlayerTo(p, 'gusu_yanzi');
  e.exec('交任务');  // 推进到第二段
  ok('二段查访：进枫桥记 var', enterViaExec(e, p, 'gusu_fengqiao') && (p.getVar('hk_npcv_223_meimei_go1') || 0) === 1, 'var=' + p.getVar('hk_npcv_223_meimei_go1'));
  w.movePlayerTo(p, 'gusu_yanzi');
  const r1 = e.exec('交任务');
  ok('收束出弯钩暗记联动段（不止走漕米）', /不止漕米/.test(txt(r1)), txt(r1).slice(0, 100));
  ok('收束落 clue_gusu', p.hasFlag('clue_gusu'));
  ok('声望挂点：姑苏 rep=60', (p.reputation['姑苏'] || 0) === 60, JSON.stringify(p.reputation));
}

sec('⑥ 浮名 action：clue_count 门槛 + 收束（方证/冲虚）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'shaolin_daxiong');
  p.setVar('clue_count', 3);
  const r0 = e.exec('问那路人的名头');
  ok('门槛不足（3）不可问', !p.hasFlag('act2_mole_named') && !/写在你掌心/.test(txt(r0)), txt(r0).slice(0, 60));
  p.setVar('clue_count', 4);
  const r1 = e.exec('问那路人的名头');
  ok('门槛足（4）浮名落 flag', p.hasFlag('act2_mole_named'), txt(r1).slice(0, 60));
  ok('浮名出拼图收束句', /同一路人拿走的/.test(txt(r1)), txt(r1).slice(0, 80));
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  w2.movePlayerTo(p2, 'wudang_zixiao');
  p2.setVar('clue_count', 6);
  e2.exec('问那路人的名头');
  ok('冲虚处同样可问（两处委托线）', p2.hasFlag('act2_mole_named'));
}

sec('⑦ 乙分支名头补丁：请他作证（蒋倦处，+40 名头）');
{
  const e = boot(); const w = e.world, p = w.player;
  p.setFlag('act1_kept_silent', true);
  w.movePlayerTo(p, 'ly_granary');
  const r0 = e.exec('请他作证');
  ok('洛阳案未收口不作证', (p.reputation['*'] || 0) === 0, 'rep*=' + p.reputation['*']);
  e.exec('问仓');
  e.exec('西北'); e.exec('东南');
  e.exec('交任务');
  const r1 = e.exec('请他作证');
  ok('作证出戏（我信）', /我信/.test(txt(r1)), txt(r1).slice(0, 60));
  ok('名头落账：rep *=40', (p.reputation['*'] || 0) === 40, JSON.stringify(p.reputation));
  ok('flag act2_witness_done 落', p.hasFlag('act2_witness_done'));
}

sec('⑧ 门派咬合 L2：contrib 逐案落（含第一批补挂回归）');
{
  const e = boot('华山派'); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'ly_granary');
  e.exec('亮腰牌');
  ok('第一批回归：亮腰牌记 contrib 40', (p.sectContribution || 0) === 40, 'contrib=' + p.sectContribution);
  w.movePlayerTo(p, 'changan_market');
  const r = e.exec('验官文');
  ok('长安门派通道 验官文 可走', /门里的人懂行/.test(txt(r)), txt(r).slice(0, 60));
  ok('contrib 累计 80', (p.sectContribution || 0) === 80, 'contrib=' + p.sectContribution);
  ok('flag act2_ca_ledger 落', p.hasFlag('act2_ca_ledger'));

  const e2 = boot('丐帮'); const w2 = e2.world, p2 = w2.player;
  w2.movePlayerTo(p2, 'xiangyang_market');
  e2.exec('亮漕帖');
  w2.movePlayerTo(p2, 'chengdu_market');
  e2.exec('出示腰牌');
  w2.movePlayerTo(p2, 'gusu_yanzi');
  e2.exec('调门里卷宗');
  ok('襄阳/成都/姑苏三门派通道 contrib 各 40（累计 120）', (p2.sectContribution || 0) === 120, 'contrib=' + p2.sectContribution);

  const e3 = boot(); const w3 = e3.world, p3 = w3.player;
  w3.movePlayerTo(p3, 'gusu_yanzi');
  const r3 = e3.exec('陪他守夜');
  ok('散人通道（陪他守夜）可走且无 contrib', p3.hasFlag('act2_gs_ledger') && (p3.sectContribution || 0) === 0, 'contrib=' + p3.sectContribution);
  const r4 = e3.exec('调门里卷宗');
  ok('散人不可走门派通道', !/卷宗还能调/.test(txt(r4)), txt(r4).slice(0, 40));
}

sec('⑨ 思过崖门槛：or 形（认痕前自由，认痕后须名头）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'huashan_qingke');
  e.exec('西');
  ok('未认痕：西行自由上崖', p.room === 'huashan_siguoya', p.room);

  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  p2.setFlag('act1_recognized', true);
  w2.movePlayerTo(p2, 'huashan_qingke');
  const r = e2.exec('西');
  ok('认痕后无名头：被拦（拒文案点名头）', p2.room === 'huashan_qingke' && /名头/.test(txt(r)), p2.room + ' | ' + txt(r).slice(0, 60));
  p2.learned['basic_sword'] = { exp: 0, level: 30 };
  p2.reputation['*'] = 80;
  e2.exec('西');
  ok('认痕后名头足：放行', p2.room === 'huashan_siguoya', p2.room);
}

sec('⑩ 逐案散人自查（四案+第一批两案全链无门派依赖）');
{
  const e = boot(); const w = e.world, p = w.player;
  w.movePlayerTo(p, 'changan_market'); e.exec('批盐引'); e.exec('交任务');
  w.movePlayerTo(p, 'xiangyang_market'); e.exec('问船'); e.exec('交任务');
  w.movePlayerTo(p, 'gusu_yanzi'); e.exec('问他腿');
  enterViaExec(e, p, 'gusu_zhai_lane'); w.movePlayerTo(p, 'gusu_yanzi'); e.exec('交任务');
  enterViaExec(e, p, 'gusu_fengqiao'); w.movePlayerTo(p, 'gusu_yanzi'); e.exec('交任务');
  w.movePlayerTo(p, 'chengdu_market'); e.exec('抓药'); e.exec('交任务'); e.exec('问他擦秤');
  enterViaExec(e, p, 'chengdu_lane'); w.movePlayerTo(p, 'chengdu_market'); e.exec('交任务');
  const n = p.getVar('clue_count') || 0;
  const reps = ['长安', '襄阳', '成都', '姑苏'].every(k => (p.reputation[k] || 0) === 60);
  ok('散人四案全链：clue_count=4 + 四区 rep 各 60', n === 4 && reps, 'clue_count=' + n + ' rep=' + JSON.stringify(p.reputation));
  ok('浮名可达：散人档凑满四案即可收束', n >= 4);
  w.movePlayerTo(p, 'shaolin_daxiong');
  e.exec('问那路人的名头');
  ok('散人档浮名落 flag', p.hasFlag('act2_mole_named'));
}

console.log('\n============================================');
console.log('S3 第二批验收：通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败明细：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
