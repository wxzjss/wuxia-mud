/* _act1_walkthrough.js —— act1 全流程走通验收（发布前最后一道，游有方）
 * 口径（team-lead 2026-10-15 验收单）：开局 / 茶摊六锚 / α曲线 / 独木桥 / 双分支+散人 / 卷界。
 * run: node tools/_act1_walkthrough.js
 */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const travel = require('../game/src/core/travel.js');

let pass = 0, fail = 0; const fails = [];
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; fails.push(n); console.log('  ✘ ' + n + (e !== undefined ? '  << ' + e : '')); } };
const sec = t => console.log('\n=== ' + t + ' ===');
const SEED = 20261008;

function boot(birth) {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: birth || 'wuxue' });
  return e;
}
function run(e, c) { const r = e.exec(c); return r; }
function txt(r) { return (r.lines || []).map(l => l.text || '').join('\n'); }
function kinds(r) { return (r.lines || []).map(l => l.kind); }

/* ============ ① 开局 ============ */
sec('① 开局：楔子→踏入江湖→追踪屏第一章主线');
{
  const e = boot();
  const w = e.world, p = w.player;
  ok('出生在江南大路（茶摊）', p.room === 'road_jiangnan_1', p.room);
  const q = w.getQuest('q_main_jianghu') || Object.values(w.data.quests).find(q => q.name === '江湖路远');
  ok('第一章主线任务已加载（江湖路远）', !!q, Object.keys(w.data.quests).filter(k => /main/.test(k)).slice(0, 5).join(','));
  ok('开局默认不追（held 链：追了才讲，主人口径）', p.track === null || p.track === undefined, 'track=' + p.track);
  e.exec('追踪 江湖路远');
  ok('玩家追后 track 落主线', p.track === 'q_main_jianghu', 'track=' + p.track);
  const r = e.exec('任务');
  ok('任务面板列主线', /江湖路远/.test(txt(r)));
}

/* ============ ② 茶摊六锚 ============ */
sec('② 茶摊：六锚物全摸一遍 + 掏灰得 jh_fist + 看人提示');
{
  const e = boot();
  const w = e.world, p = w.player;
  const r1 = run(e, '信');
  ok('「信」锚出戏（接信前导）', /信|老汉/.test(txt(r1)), txt(r1).slice(0, 60));
  /* 真序：信要等缸挪开（问信 cond act1_vat_moved）——六锚链走完再接信（见下） */
  /* 六锚 next 链（真序）：伸手→翻案底(得浮票)→倒水(用票)→撬→垫→挪缸 */
  run(e, '伸手'); ok('伸手（缸）act1_vat_look', p.hasFlag('act1_vat_look'));
  run(e, '翻案底'); ok('翻案底（浮票）act1_piao_taken', p.hasFlag('act1_piao_taken'));
  run(e, '倒水'); ok('倒水 act1_vat_pour', p.hasFlag('act1_vat_pour'));
  run(e, '撬'); ok('撬 act1_vat_pry', p.hasFlag('act1_vat_pry'));
  run(e, '垫'); ok('垫 act1_vat_wedge', p.hasFlag('act1_vat_wedge'));
  run(e, '挪缸'); ok('挪缸 act1_vat_moved', p.hasFlag('act1_vat_moved'));
  const rf = run(e, '掏灰');
  ok('掏灰出戏', txt(rf).length > 10, txt(rf).slice(0, 60));
  const hasFist = Object.keys(p.learned || {}).some(k => /jh_fist|基本拳/.test(k))
    || (p.inventory || []).some(it => (typeof it === 'string' ? it : it.id) === 'jh_fist');
  ok('掏灰得 jh_fist（所学或入包）', hasFist, JSON.stringify(Object.keys(p.learned || {})));
  const rg = run(e, '看 卖茶的老汉');
  ok('「看 卖茶的老汉」中文提示正常（不是「是什么指令」）', !/是什么指令|不懂/.test(txt(rg)) && txt(rg).length > 10, txt(rg).slice(0, 60));
  run(e, '问信'); ok('问信→信露出 act1_letter_known', p.hasFlag('act1_letter_known'));
  run(e, '接信'); ok('接信→act1_letter_taken', p.hasFlag('act1_letter_taken'));
  /* 当铺一环（act1_pawn_done 生产者） */
  w.movePlayerTo(p, 'jn_pawnshop');
  const rp = run(e, '给掌柜看信');
  ok('当铺给掌柜看信→act1_pawn_done', p.hasFlag('act1_pawn_done'), txt(rp).slice(0, 60));
  w.movePlayerTo(p, 'road_jiangnan_1');
}

/* ============ ③ α 曲线 ============ */
sec('③ α 曲线：狼 ≤15 回合不被秒；山贼险胜');
function fight(e, w, defId, name) {
  w.spawnNpc(defId, w.player.room, 1, true);
  const r0 = run(e, '杀 ' + name);
  let rounds = 0, worstHit = 0;
  for (let i = 0; i < 60 && w.battle && !w.battle.over; i++) {
    const before = w.player.hp;
    e.combatAction('attack');
    if (before - w.player.hp > worstHit) worstHit = before - w.player.hp;
    rounds++;
  }
  return { rounds, won: !w.battle || w.battle.over === true && w.battle.winner !== 'npc', worstHit, hp: w.player.hp, maxHp: w.player.maxHp, firstLine: txt(r0).slice(0, 50) };
}
{
  const e = boot();
  const w = e.world, p = w.player;
  w.movePlayerTo(p, 'jn_woods_2');
  const wolf = fight(e, w, 'mob_wolf', '野狼');
  ok('狼战胜（不被秒）', wolf.won && wolf.hp > 0, JSON.stringify(wolf).slice(0, 120));
  ok('狼 ≤15 回合（同量级口径）', wolf.rounds <= 15, 'rounds=' + wolf.rounds);
  ok('狼一口咬不死人', wolf.hp > 0 && wolf.worstHit < wolf.maxHp, 'worstHit=' + wolf.worstHit);
  const e2 = boot();
  const w2 = e2.world, p2 = w2.player;
  w2.movePlayerTo(p2, 'road_jiangnan_2');
  const bandit = fight(e2, w2, 'mob_bandit', '山贼');
  ok('山贼险胜', bandit.won && bandit.hp > 0 && bandit.hp < bandit.maxHp * 0.6, JSON.stringify(bandit).slice(0, 120));
}

/* ============ ④ 独木桥 ============ */
sec('④ 独木桥：门禁出戏→失败链（膝盖旧伤）→过桥');
{
  const e = boot();
  const w = e.world, p = w.player;
  w.movePlayerTo(p, 'dumuqiao');
  const rb = run(e, '北');
  ok('未过桥前 n 被拦', w.player.room === 'dumuqiao');
  ok('被拦出守桥老汉的话（msg）', /守桥的老汉/.test(txt(rb)), txt(rb).slice(0, 80));
  run(e, '抢过');
  ok('抢过置探桥 flag', p.hasFlag('act1_bridge_probe'));
  run(e, '背东西过');
  run(e, '硬闯');
  run(e, '跳下去');
  ok('失败链走到膝盖旧伤 act1_knee_hurt', p.hasFlag('act1_knee_hurt'),
    'probe=' + p.hasFlag('act1_bridge_probe') + ' steady=' + p.hasFlag('act1_bridge_steady') + ' knee=' + p.hasFlag('act1_knee_hurt'));
  w.movePlayerTo(p, 'shanjiao_inn');
  const rz = run(e, '看伤');
  ok('看伤 act1_knee_seen', p.hasFlag('act1_knee_seen'), txt(rz).slice(0, 60));
  w.movePlayerTo(p, 'dumuqiao');
  run(e, '探桥'); run(e, '稳脚'); const rc = run(e, '过桥');
  ok('act1_bridge_crossed 落', p.hasFlag('act1_bridge_crossed'), txt(rc).slice(0, 60));
  const rn = run(e, '北');
  ok('过桥后 n 通（到山脚客栈）', w.player.room === 'shanjiao_inn', w.player.room);
}

/* ============ ⑤ 双分支 + 散人 ============ */
sec('⑤ 双分支 + 散人线');
/* 分支甲 */
{
  const e = boot();
  const w = e.world, p = w.player;
  ['伸手', '翻案底', '倒水', '撬', '垫', '挪缸', '掏灰', '问信', '接信'].forEach(c => run(e, c));
  w.movePlayerTo(e.world.player, 'jn_pawnshop'); run(e, '给掌柜看信');
  w.movePlayerTo(e.world.player, 'road_jiangnan_1');
  const rc = run(e, '回茶摊');
  const menu = (rc.lines || []).find(l => l.kind === 'menu');
  ok('申时回茶摊弹双分支菜单', !!menu, kinds(rc).join(','));
  if (menu) {
    const opt = menu.options.find(o => /告诉/.test(o.label));
    ok('甲分支选项（告诉他）在菜单里', !!opt, menu.options.map(o => o.label).join('|'));
    e.menuPick(opt);
    ok('甲 flag act1_told_truth', p.hasFlag('act1_told_truth'));
  }
  const rd = run(e, '动身');
  ok('动身→act1_oldroad_seen', p.hasFlag('act1_oldroad_seen'), txt(rd).slice(0, 60));
  w.movePlayerTo(p, 'cunzhen_gate');
  const rw = run(e, '西南');
  ok('旧道口可走（sw→oldroad）', w.player.room === 'oldroad', w.player.room);
  const rs = run(e, '看垫石');
  ok('看垫石出 74 原文（右腿拖十九年）', /十九年/.test(txt(rs)), txt(rs).slice(0, 60));
  /* 96 案 G3：旧道 nw 改常闭塌方折返，桥 = 上山唯一通路 */
  const rn2 = run(e, '西北');
  ok('旧道 nw 塌方折返（常闭门出戏 msg）', w.player.room === 'oldroad' && /塌方/.test(txt(rn2)), w.player.room + ' | ' + txt(rn2).slice(0, 60));
  run(e, '东北');
  ok('折返回村口', w.player.room === 'cunzhen_gate', w.player.room);
  run(e, '西北');
  ok('上山唯一通路是独木桥（cunzhen_gate nw→dumuqiao）', w.player.room === 'dumuqiao', w.player.room);
}
/* 分支乙 */
{
  const e = boot();
  const w = e.world, p = w.player;
  ['伸手', '翻案底', '倒水', '撬', '垫', '挪缸', '掏灰', '问信', '接信'].forEach(c => run(e, c));
  w.movePlayerTo(e.world.player, 'jn_pawnshop'); run(e, '给掌柜看信');
  w.movePlayerTo(e.world.player, 'road_jiangnan_1');
  const rc = run(e, '回茶摊');
  const menu = (rc.lines || []).find(l => l.kind === 'menu');
  if (menu) {
    const opt = menu.options.find(o => /不说|咽回/.test(o.label));
    e.menuPick(opt);
    ok('乙 flag act1_kept_silent', p.hasFlag('act1_kept_silent'));
  }
  const rr = run(e, '绕回茶摊');
  ok('乙旁视线 act1_silent_seen', p.hasFlag('act1_silent_seen'), txt(rr).slice(0, 60));
  ok('乙分支没给旧道（act1_oldroad_seen 为假）', !p.hasFlag('act1_oldroad_seen'));
  ok('留句话收尾：save 可用（亥时存档即留句话）', (() => { const r = run(e, 'save'); return !/是什么指令|不懂/.test(txt(r)); })());
}
/* 散人线：夜里走 65 夜宿山道不断线 */
{
  const e = boot();
  const w = e.world, p = w.player;
  p.setFlag('act1_recognized', true);   // 前置：认痕已过
  p.vars = p.vars || {}; p.vars.time = p.vars.time || {};
  /* 把时辰推到夜里（>= 亥时 1140） */
  if (typeof w.setClock === 'function') w.setClock(1200);
  else { for (let i = 0; i < 90 && (w.clockMin === undefined || w.clockMin < 1140); i++) w.advanceTime(15); }
  const cm = w.clockMin !== undefined ? w.clockMin : (w.now && w.now.min);
  w.movePlayerTo(p, 'road_huashan_1');
  const r = run(e, '夜宿山道');
  const t = txt(r);
  ok('散人夜里夜宿山道不断线（不报错不出戏）', !/是什么指令|出了岔子/.test(t) && t.length > 10, t.slice(0, 80) + ' | clock=' + cm);
}

/* ============ ⑥ 卷界 ============ */
sec('⑥ 卷界：act1_recognized 落后，jiangnan→luoyang closed→ready');
{
  const e = boot();
  const w = e.world, p = w.player;
  const link = w.data.travel.links.find(l => l.from === 'jiangnan' && l.to === 'luoyang');
  ok('卷一边已落库', !!link);
  const c0 = travel.checkLink(w, p, link);
  ok('未过线 closed', c0.state === 'closed', c0.state);
  const r0 = run(e, '行路 洛阳');
  ok('不通时驿丞文案出得来', /驿丞|开春|征走/.test(txt(r0)), txt(r0).slice(0, 80));
  p.setFlag('act1_recognized', true);
  const c1 = travel.checkLink(w, p, link);
  ok('过线 ready', c1.state === 'ready', c1.state);
  const r1 = run(e, '行路 洛阳');
  ok('通航场景句（驿丞画圈）出得来且人到了洛阳', /画了个圈|洛阳/.test(txt(r1)) && w.player.room && w.data.rooms[w.player.room].region === 'luoyang',
    txt(r1).slice(0, 80) + ' room=' + w.player.room);
}

/* ============ ⑦ 锁区穷举（96 案验收段） ========= */
sec('⑦ 锁区穷举：fresh 档可达集只在 act1 走廊');
{
  const e = boot(); const w = e.world, p = w.player;
  const { evalCond } = require('../game/src/core/modapi.js');
  const rooms = w.data.rooms;
  const chk = (cond) => { try { return evalCond(cond, { player: p, world: w }); } catch (err) { return false; } };
  const seen = new Set(['road_jiangnan_1']);
  const queue = ['road_jiangnan_1'];
  while (queue.length) {
    const rid = queue.shift();
    const r = rooms[rid]; if (!r) continue;
    for (const ex of Object.values(r.exits || {})) {
      const to = typeof ex === 'string' ? ex : ex.to;
      if (!to) continue;
      if (typeof ex === 'object' && ex.cond && !chk(ex.cond)) continue;
      if (!seen.has(to)) { seen.add(to); queue.push(to); }
    }
  }
  const ALLOWED = new Set(['cunzhen', 'huashan', 'wild']);
  const leaks = [...seen].filter(rid => !(ALLOWED.has((rooms[rid] || {}).region) || rid === 'road_jiangnan_1'));
  ok('锁区穷举：可达房全在走廊（cunzhen/huashan/wild+茶摊）', leaks.length === 0, leaks.join(','));
  for (const must of ['jiangnan_gate', 'road_jiangnan_2', 'jiangnan_east_road', 'road_shaolin_1', 'huashan_library', 'jn_pawnshop'])
    ok('不可达（锁区）：' + must, !seen.has(must));
  for (const open of ['cunzhen_gate', 'dumuqiao', 'shanjiao_inn', 'road_huashan_1', 'huashan_shanxia', 'road_wild_1', 'wild_forest_1', 'cunzhen_inn', 'cunzhen_farm'])
    ok('可达（走廊腹地）：' + open, seen.has(open));
  ok('可达（认痕路径，思过崖 or 形认痕前自由）：huashan_siguoya', seen.has('huashan_siguoya'));
  p.setFlag('act1_recognized', true);
  ok('认痕后 G1/G2 放行', chk(rooms.road_jiangnan_1.exits.n.cond) && chk(rooms.road_jiangnan_1.exits.s.cond));
  ok('认痕后 G4/G5/G6 放行', chk(rooms.road_huashan_1.exits.e.cond) && chk(rooms.road_huashan_1.exits.w.cond) && chk(rooms.road_huashan_1.exits.s.cond));
  ok('旧道 nw 仍常闭（塌方折返不随认痕开）', !chk(rooms.oldroad.exits.nw.cond));
}

/* ============ ⑧ 看信迁移 + 追鸡轻功 + M1 散人主线 ========= */
sec('⑧ 看信迁小铺 / 追鸡补轻功 / M1 散人主线');
{
  const e = boot(); const w = e.world, p = w.player;
  ['伸手', '翻案底', '倒水', '撬', '垫', '挪缸'].forEach(c => run(e, c));
  run(e, '问信');
  const rj = run(e, '接信');
  ok('接信出指路（青溪村小铺掌柜）', /小铺的掌柜/.test(txt(rj)), txt(rj).slice(0, 80));
  w.movePlayerTo(p, 'cunzhen_inn');
  const rp = run(e, '给掌柜看信');
  ok('小铺看信→act1_pawn_done', p.hasFlag('act1_pawn_done'), txt(rp).slice(0, 60));
  w.movePlayerTo(p, 'jn_pawnshop');
  const r2 = run(e, '给掌柜看信');
  ok('江南当铺已无此 action（不报错就是没迁干净）', !/act1_pawn_done|封皮/.test(txt(r2)) && /是什么指令|不懂|没有/.test(txt(r2)), txt(r2).slice(0, 50));
  w.movePlayerTo(p, 'cunzhen_farm');
  const r3 = run(e, '追鸡');
  ok('追鸡学会基本轻功（卷一轻功断供补口）', !!(p.learned && p.learned.basic_dodge), JSON.stringify(Object.keys(p.learned || {})));
  const r4 = run(e, '追鸡');
  ok('追鸡 once 不重复出戏', !/轻了半分/.test(txt(r4)), txt(r4).slice(0, 40));
  /* M1：散人（不入门派）认痕后总主线照走 */
  const e2 = boot(); const p2 = e2.world.player;
  p2.setFlag('act1_recognized', true);
  run(e2, '看');
  ok('M1：散人认痕后 q_main_jianghu 过 stage0', p2.questStage('q_main_jianghu') >= 1, 'stage=' + p2.questStage('q_main_jianghu'));
}

console.log('\n============================================');
console.log('act1 走通验收：通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败明细：'); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
