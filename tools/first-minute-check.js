#!/usr/bin/env node
/* ==========================================================================
 *  tools/first-minute-check.js —— 新手第一分钟验收（design/101 §五#7）
 *  --------------------------------------------------------------------------
 *  60 秒自动化走 T0-T5，断言每节点。核心断言（74 式验收点）：
 *    · T0 楔子在合并数据（四段、flag act1_intro_done）
 *    · T1 老汉开场白在 talk[0]
 *    · T2 第一分钟「此地可做」恰 1 条主线（伸手）——hint 链式单提示
 *    · T3 挪缸五步真走通（74 辰时验收：链内推进）
 *    · T4 接信后 introHidden flag 置位（出口按钮此刻该亮——前端消费寇豆码）
 *    · T5 出南门 G1 门戏在（查得紧/认名）
 *    · ★ 「接信前不需要知道东南西北」：四出口 introHidden 全挂
 *      act1_letter_taken，flag 未置时（前端判据）按钮全藏。
 *  引擎播报机制（newGame 首包播楔子，storybeat.prologue）已落地（2026-10-17
 *  寇豆码）——①-b 节为引擎层播报通路断言（真走 GameEngine → newGame → v.lines）。
 *  用法：node tools/first-minute-check.js
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

const e = new GameEngine({ seed: 20261008 });
e.boot();
const W = e.world.data;
const { evalCond } = require(path.join(path.join(__dirname, '..'), 'game', 'src', 'core', 'modapi.js'));
let p = null;

console.log('\n① T0 楔子（data 层；播报挂点=寇豆码在办件）');
{
  const intro = W.intro;
  ok('101/T0 楔子结构在合并数据（intro.prologue 四段 + flag）',
    intro && intro.flag === 'act1_intro_done' && Array.isArray(intro.prologue) && intro.prologue.length === 4,
    intro ? intro.prologue.length + ' 段 · flag=' + intro.flag : '(无 intro)');
  ok('101/T0 楔子含 74 钦定句「等天下太平了再来找」',
    !!(intro && intro.prologue.some(p => p.includes('等天下太平了再来找'))));
  ok('101/T0 楔子尾段=老汉开场白（坐。凳是三条腿的）',
    !!(intro && intro.prologue[3].includes('凳是三条腿的')));
}

console.log('\n①-b T0 播报通路（引擎层真走：newGame 首包前置 story 拍，寇豆码 2026-10-17）');
{
  /* 独立实例：①节的 e 后面还要接着走 T2-T5 的手动件，别让播报断言动它的状态 */
  const storybeat = require(path.join(__dirname, '..', 'game', 'src', 'core', 'storybeat.js'));
  const e0 = new GameEngine({ seed: 20261017 });
  e0.boot();
  const v0 = e0.newGame({ name: '通路侠', gender: 'male', birth: 'wuxue' });
  const L = (v0 && v0.lines) || [];
  const story = L.filter(l => l && l.kind === 'story');
  ok('101/T0b ★ newGame 首包前置 4 段 story 拍（楔子三段+茶摊落地段）',
    story.length === 4, '实得 ' + story.length + ' 段');
  ok('101/T0b ★ 楔子在 look 之前（前 4 行全是 story，第 5 行起才是房间）',
    L.slice(0, 4).every(l => l && l.kind === 'story') && L.length >= 5,
    '前 5 kind=' + L.slice(0, 5).map(l => (l && l.kind) || '?').join(','));
  ok('101/T0b 首段=74 棉袄段（你被人放在这棵树底下…）',
    !!(L[0] && String(L[0].text).includes('你被人放在这棵树底下')));
  ok('101/T0b 尾段=茶摊落地（老汉「坐」）',
    story.some(l => String(l.text).includes('凳是三条腿的')));
  ok('101/T0b 播后即置 flag act1_intro_done（一次性）',
    !!e0.world.player.hasFlag('act1_intro_done'));
  const v1 = e0.view();
  ok('101/T0b 二次 view 不重播',
    !((v1 && v1.lines) || []).some(l => l && l.kind === 'story' && String(l.text).includes('你被人放在这棵树底下')));
  /* 读档不重播：serialize→deserialize 不走 newGame，flag 随档 */
  const e1 = new GameEngine({ seed: 20261017 });
  e1.boot();
  e1.world.deserialize(JSON.parse(JSON.stringify(e0.world.serialize())), []);
  const v2 = e1.view();
  ok('101/T0b 老档读入不补播（deserialize 路径零接线）',
    !((v2 && v2.lines) || []).some(l => l && l.kind === 'story' && String(l.text).includes('你被人放在这棵树底下')));
  ok('101/T0b prologue 对已置 flag 的玩家返回空（幂等兜底）',
    storybeat.prologue(e0.world, e0.world.player).length === 0);
}

console.log('\n② T1 第一眼（老汉开场白锚）');
{
  const t = (W.npcs.guide_teaman || {}).talk;
  ok('101/T1 老汉 talk 首句=粗布引导（74：你身上那块布，我看见了）',
    Array.isArray(t) && t[0] === '外乡人。你身上那块布，我看见了。');
}

console.log('\n③ T2 第一件事恰一条（链式单提示）');
{
  const acts = (W.rooms.road_jiangnan_1 || {}).actions || [];
  const hinted = acts.filter(a => a.hint);
  ok('101/T2 hint:true 恰 10 条主线 action（六步链+问信+接信+回茶摊+动身）',
    hinted.length === 10, hinted.map(a => a.cmd).join('/'));
  const has = cmd => hinted.some(a => a.cmd === cmd);
  ok('101/T2 主线链齐：伸手/翻案底/倒水/撬/垫/挪缸/问信/接信/回茶摊/动身',
    ['伸手', '翻案底', '倒水', '撬', '垫', '挪缸', '问信', '接信', '回茶摊', '动身'].every(has));
  const hidden = acts.filter(a => a.hint === false);
  ok('101/T2 细交互 hint:false 收锚物（信/掏灰/绕回茶摊；103 B8 增补 端详* 同类）',
    hidden.length >= 2 && hidden.every(a =>
      ['信', '掏灰', '绕回茶摊'].includes(a.cmd) || /^端详/.test(a.cmd || '')),
    hidden.map(a => a.cmd).join('/'));
  /* 第一分钟链头：hint:true 且 cond 满足（未挪缸）的恰 1 条=伸手 */
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  p = e.world.player;
  const openNow = hinted.filter(a => {
    if (!a.cond) return true;
    try { return evalCond(a.cond, { player: p, world: e.world }); } catch (err) { return false; }
  });
  ok('101/T2 ★ 开局可做的 hint 主线恰 1 条=伸手（先帮工后问信，74 动线）',
    openNow.length === 1 && openNow[0].cmd === '伸手',
    '开局可做: ' + openNow.map(a => a.cmd).join('/'));
}

console.log('\n④ T3-T4 挪缸五步→问信→接信（真走）');
{
  const step = (cmd) => e.exec(cmd);
  for (const cmd of ['伸手', '翻案底', '倒水', '撬', '垫', '挪缸']) {
    const r = step(cmd);
    const moved = r && r.lines && !r.lines.some(l => (l.kind === 'warn'));
    ok('101/T3 手动件【' + cmd + '】真走得动', !!moved);
  }
  const rq = e.exec('问信');
  ok('101/T4a 问信（挪缸后解锁，老汉问「你识字么」级）', !!(rq && rq.lines));
  const rt = e.exec('接信');
  const got = !!(rt && rt.lines && !rt.lines.some(l => l.kind === 'warn'));
  ok('101/T4b 接信成功（act1_letter_taken 置位）', got && p.hasFlag('act1_letter_taken'));
  const rv = e.view();
  ok('101/T4c 接信后大框可追（storybeat 引擎机制，此处验 flag 就绪）',
    p.hasFlag('act1_letter_taken'));
}

console.log('\n⑤ T5 出口动线与「接信前不知东南西北」');
{
  const exits = W.rooms.road_jiangnan_1.exits;
  const dirs = Object.keys(exits);
  ok('101/T5 出生点出口恰四向（ne 已随 demo_map 默认关消失）',
    dirs.length === 4 && ['n', 's', 'w', 'e'].every(d => dirs.includes(d)),
    dirs.join('/'));
  ok('101/T5 ★ 四出口 introHidden 全挂 act1_letter_taken（接信前按钮全藏）',
    dirs.every(d => exits[d] && exits[d].introHidden === 'act1_letter_taken'));
  ok('101/T5 藏按钮不锁路：出口对象化后 to 全在',
    dirs.every(d => exits[d].to && W.rooms[exits[d].to]));
  /* G1 门戏在（北出南门被拦的戏）——flag 已置，验门对象结构 */
  const g1 = exits.n;
  ok('101/T5 G1 门戏三件套在（cond/say/msg/travel）',
    !!(g1.cond && g1.say && g1.msg && g1.travel));
}

console.log('\n' + '─'.repeat(50));
console.log('第一分钟验收：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  · ' + f)); }
process.exit(fail ? 1 : 0);
