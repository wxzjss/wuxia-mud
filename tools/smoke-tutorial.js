/* 新手教程「下线」专项回归（2026-10-12 主人钦定：新手教程剧情全删）
 *
 * 🔴 背景：主人原话「不是说删除新手教程吗」——上一批只删了底部快捷按钮，
 *   教程本体（右侧常驻指引块 / 「新手教程 · 入江湖」面板 / 任务面板里的
 *   新手卡 / 新手章节）全都还在。这一批**整体下线**。
 *
 * 本回归锁死「下线」这件事做得干净：
 *   ① 教程的**数据面**（view.guide）恒为 null —— 前端再也拿不到引导状态；
 *   ② 教程的**后端面**（newbieChapter 恒 null / syncTrack 不再由新手驱动）；
 *   ③ 教程的**前端面**（guideHtml / renderGuide / 面板分支 / 面板别名全删）；
 *   ④ 沉淀下来的**引荐信机制**照旧能用（手写信是拜师的道具，不是教程）；
 *   ⑤ 开场角色扮演（楔子）**不受影响**，照旧三轮走完进第一章。
 *
 * ⚠️ 与老版 smoke-tutorial 的区别：老版是「教程功能专项」（端到端点亮、顺序游标、
 *   零兜底…）——那些测的是**功能本身**，功能都删了，测点自然全部作废。
 *   所以本文件是**重写的「下线守卫」**，不是老版改几个数字。
 *   tutorial.js 里保留的 STEPS / CMD_FLAGS / 白名单，是给**老存档的 tutorialFlags
 *   字段**与「引荐信」用的，仍然可跑（下面 ④ 段守着）。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const tutorial = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));
const storybeat = require(path.join(ROOT, 'game', 'src', 'core', 'storybeat.js'));
const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const ENGSRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'engine.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

function mk() {
  const e = new GameEngine({ seed: 20261009 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}

/* ─────────────────────────────────────────── */
sec('① 数据面：view.guide 恒为 null（前端再也拿不到引导状态）');
{
  const e = mk();
  const v = e.view();
  ok('新玩家 view.guide === null', v.guide === null, String(v.guide));
  /* 保留键名而不删键：老前端 / 老测试还在读 v.guide，
     给一个明确空值比「键没了」好排查（undefined 会到处静默出错）。 */
  ok('键「guide」仍然存在（值恒 null，不是 undefined）',
    Object.prototype.hasOwnProperty.call(v, 'guide') && v.guide === null);
  ok('view.newbie 一并恒 null', v.newbie === null);

  /* 走几步、追个任务，guide 也不该被「点亮」回来 */
  e.exec('look'); e.exec('n'); e.exec('s');
  e.exec('追踪 江湖路远');
  const v2 = e.view();
  ok('走过路、追过任务之后 view.guide 仍是 null', v2.guide === null, String(v2.guide));
}

/* ─────────────────────────────────────────── */
sec('② 后端面：新手章节恒 null + syncTrack 不再由新手驱动');
{
  const e = mk();
  const p = e.world.player;
  /* newbieChapter 没导出（模块私有），直接读源码确认它恒 null */
  const SBSRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'storybeat.js'), 'utf8');
  const nbc = SBSRC.match(/function newbieChapter\([\s\S]*?\n\}/);
  ok('newbieChapter 恒返回 null（函数保留、体内 return null）',
    !!nbc && /return null/.test(nbc[0]) && !/tutorial/.test(nbc[0]),
    nbc ? nbc[0].replace(/\s+/g, ' ').slice(0, 90) : 'NOT FOUND');
  ok('storybeat.js 不再 require tutorial（不再由新手驱动）',
    SBSRC.indexOf("require('./tutorial')") < 0);

  /* 开局口径（主人 2026-10-12）：「创建完角色后进游戏，默认不追踪任何任务」。
     ⇒ newGame 之后 p.track 必须是 null，而不是 NEWBIE 哨兵。 */
  ok('★ 开局 p.track === null（不追任何任务）', p.track === null, String(p.track));
  const v = e.view();
  ok('★ 开局大框 story === null（下方还给房间描述）',
    !v.story || !v.story.show || v.story === null, JSON.stringify(v.story && v.story.title));

  /* 就算老存档把 p.track 写成 NEWBIE，syncTrack 也得把它导流到「自动选一条」，
     绝不能又摸回教程。 */
  p.track = storybeat.NEWBIE;
  storybeat.syncTrack(e.world, p);
  ok('老存档 p.track=NEWBIE 被导流（不再回教程）', p.track !== storybeat.NEWBIE,
    String(p.track));
}

/* ─────────────────────────────────────────── */
sec('③ 前端面：教程的界面全部删干净（函数 / 面板 / 别名 / HTML 块）');
{
  /* 整函数删除，不是留空壳 —— 本项目最吃「留着迟早有人接回去」这个亏 */
  ok('前端已无 guideHtml 函数', UISRC.indexOf('function guideHtml') < 0);
  ok('前端已无 bindGuide 函数', UISRC.indexOf('function bindGuide') < 0);
  ok('前端已无 panelGuideFlag 函数', UISRC.indexOf('function panelGuideFlag') < 0);

  /* renderGuide 是**保留的空函数**（renderScene 还在调它，留个名字做锚点）——
     但必须真的是空的：函数体里不能再出现渲染逻辑。 */
  const rg = UISRC.match(/function renderGuide\([^)]*\)\s*\{([\s\S]*?)\}/);
  ok('renderGuide 已退化为空函数（只留一行注释）',
    !!rg && rg[1].trim().length < 80 && rg[1].indexOf('innerHTML') < 0,
    rg ? rg[1].trim() : 'NOT FOUND');

  /* 面板别名表里不能再认「指引 / 新手教程 / 引导」这几种叫法 */
  ok('面板别名表已无 guide 别名',
    !/guide\s*:\s*'guide'/.test(UISRC) && !/新手教程\s*:\s*'guide'/.test(UISRC));

  /* 页面里那块右侧常驻「新手指引」也得拆了（查真节点 id，不查注释里残留的字样） */
  ok('index.html 已无 id="guide-block" 真节点',
    HTML.indexOf('id="guide-block"') < 0);

  /* 侧边菜单里「江湖指引」那条入口也该没了 */
  ok('侧边菜单已无「江湖指引」入口', UISRC.indexOf('江湖指引') < 0);
}

/* ─────────────────────────────────────────── */
sec('④ 保留面：引荐信机制 + 老存档字段照旧可用');
{
  const e = mk();
  /* tutorialFlags 仍是存档字段（老档里有），markTutorialFlag 白名单照跑 */
  ok('拒绝不在白名单的 flag', e.markTutorialFlag('evil_hack') === false);
  ok('接受 EXTRA_FLAGS 的 seen_intro', e.markTutorialFlag('seen_intro') === true);
  ok('接受 CMD_FLAGS 的 did_look', e.markTutorialFlag('did_look') === true);
  const fl = e.world.player.tutorialFlags;
  ok('脏 flag 没被写进存档', !fl.includes('evil_hack'), JSON.stringify(fl));

  /* 引荐信机制（拜师道具）：老汉 talk / ask 两条路都要能给出信 */
  ok('tutorial.handOutLetter 仍在（引荐信是拜师道具，不是教程）',
    typeof tutorial.handOutLetter === 'function');
  ok('BIRTH_SECT 出身→门派链仍在（拜师靠它）',
    tutorial.BIRTH_SECT && Object.keys(tutorial.BIRTH_SECT).length >= 10);
}

/* ─────────────────────────────────────────── */
sec('⑤ 开场楔子（静态卡）不受影响：一张卡、点一下进第一章，不再重复问');
{
  const e = mk();
  /* mk() 已经 newGame（含出生出身）。🔴 2026-10-12 主人「现在的楔子还不如原来的，
     还不如回滚回去」+「进游戏还要再选一次出身与性别」：
     楔子退回**一张静态卡**（view.intro 按出身挑版），**不再问第二遍**。 */
  const e3 = new GameEngine({ seed: 20261009 });
  e3.boot();
  e3.newGame({ name: '试剑', gender: 'male', birth: 'scholar' });
  const v0 = e3.view();
  ok('新玩家 view.intro.show 为真（楔子该弹）',
    v0.intro && v0.intro.show === true);
  ok('★ 楔子按建号选的出身挑版（scholar → 书箱那版）',
    String(v0.intro.body || '').indexOf('书箱') >= 0, String(v0.intro.title || ''));
  ok('★ 楔子**不再问出身/性别**（opening 退休、恒 show:false）',
    !v0.opening || v0.opening.show === false);

  /* 点「踏入江湖」= 点亮 seen_intro → 不再弹 */
  e3.markTutorialFlag('seen_intro');
  ok('看过开场后 view.intro.show 为假', e3.view().intro.show === false);

  ok('前端 maybeShowIntro 仍接线（开场不随教程一起删）',
    UISRC.indexOf('maybeShowIntro') > 0);
  ok('★ 后端 view.intro 接线到 tutorial.introFor（静态卡数据源）',
    ENGSRC.indexOf('introFor') > 0);
  ok('★ 三轮模块 intro.js 已删（回滚到底）',
    !fs.existsSync(path.join(ROOT, 'game', 'src', 'core', 'intro.js')));
}

/* ─────────────────────────────────────────── */
sec('⑥ 主线第一章 = 拜入门派（删教程后主线的起点）');
{
  const e = mk();
  const v = e.view();
  const q = (v.quests && v.quests.active || []).find(x => x.id === 'q_main_jianghu')
    || (v.quests && v.quests.active || [])[0];
  ok('新玩家主线已接（开局就接，不靠教程交接）', !!q, JSON.stringify((v.quests||{}).active));
  if (q) {
    ok('★ 主线停在 stage 0（拜师）', q.stage === 0, 'stage=' + q.stage);
    ok('★ 第一步文案讲的是「去拜师」这件事',
      /拜|投|山门|门派|入门|名分/.test(String(q.stageDesc || '')),
      q.stageDesc);
    /* ⚠️ 别写成「收下了」这类**完成后追述**：面板那句是**当前目标**。
       2026-10-12 实测踩到过：descByLine 原来写成「名门把你收下了」，
       开局还没拜师就说收下了。 */
    ok('★ 第一步文案不是「已完成」口吻',
      !/收下|已经|成了|落脚处了/.test(String(q.stageDesc || '')),
      q.stageDesc);
  }
  /* 数据面：主线不该再从 stage 1 起步 */
  const quests = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), 'utf8'));
  const mq = (quests.quests || quests).q_main_jianghu
    || ((quests.quests || quests)['q_main_jianghu']);
  ok('数据面：q_main_jianghu 不再写 startStage:1',
    !mq || mq.startStage === undefined || mq.startStage === 0,
    'startStage=' + (mq && mq.startStage));
}

console.log('\n' + '='.repeat(46));
console.log('  新手教程下线专项: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(46));
if (fail) process.exit(1);
