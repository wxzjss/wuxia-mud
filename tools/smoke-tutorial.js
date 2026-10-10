/* 新手教程专项回归（2026-10-10 沉浸式重构版）
 *
 * 锁死：
 *   1. 「认清家当 / 认清自己」两个弱智面板步已删除（主人钦定：弱智引导没必要）。
 *   2. 顺序游标：前一步没完成，后面的步一律锁住（locked），杜绝跳步假完成。
 *   3. 零兜底：状态满足但没做对应动作不算完成。
 *   4. 沉浸式开场（楔子）：新玩家首次进入弹叙事剧情，看过（seen_intro）后不再弹。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const tutorial = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));
const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const ENGSRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'engine.js'), 'utf8');

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
function steps(e) {
  const g = e.view().guide;
  const map = {};
  g.steps.forEach(s => { map[s.id] = s; });
  return { g, map };
}
function line(map) {
  return Object.keys(map).filter(k => k !== 'free')
    .map(k => k + ':' + (map[k].done ? '✓' : (map[k].locked ? '🔒' : '·')))
    .join(' ');
}

/* ─────────────────────────────────────────── */
sec('① 弱智面板步已删除 + 新步骤结构正确');
{
  const ids = tutorial.STEPS.map(s => s.id);
  ok('已无 bag（认清家当）步', !ids.includes('bag'));
  ok('已无 status（认清自己）步', !ids.includes('status'));
  ok('步骤顺序为 look→move→skill→talk→quest→fight→sect→save→free',
    JSON.stringify(ids) === JSON.stringify(['look', 'move', 'skill', 'talk', 'quest', 'fight', 'sect', 'save', 'free']),
    ids.join(','));
  /* requires 链：每个真实步的前置是上一步 id */
  const real = tutorial.STEPS.filter(s => s.id !== 'free');
  let chainOk = true;
  for (let i = 0; i < real.length; i++) {
    const req = real[i].requires || [];
    if (i === 0) { if (req.length) chainOk = false; }
    else if (JSON.stringify(req) !== JSON.stringify([real[i - 1].id])) chainOk = false;
  }
  ok('requires 顺序链连续（无跳步漏洞）', chainOk);
  ok('CMD_FLAGS 已无 did_bag / did_score',
    !Object.values(tutorial.CMD_FLAGS).includes('did_bag') &&
    !Object.values(tutorial.CMD_FLAGS).includes('did_score'));
}

/* ─────────────────────────────────────────── */
sec('② 端到端点亮（无 bag/status，纯操作引导）');
{
  const e = mk();
  e.exec('look');
  e.exec('n');
  let { g, map } = steps(e);
  ok('look/move 已完成', map.look.done && map.move.done, line(map));
  ok('第3步（skill）此刻未完成', !map.skill.done, line(map));

  ok('markTutorialFlag(did_train) 返回 true', e.markTutorialFlag('did_train') === true);
  ({ map } = steps(e));
  ok('上报后第3步完成', map.skill.done, line(map));
  ok('第4步（talk）随之解锁', !map.talk.locked, line(map));

  e.markTutorialFlag('did_talk');
  e.markTutorialFlag('did_accept');
  ({ map } = steps(e));
  ok('talk/quest 完成', map.talk.done && map.quest.done, line(map));

  e.world.player.kills = 1;
  ({ map } = steps(e));
  ok('kills=1 点亮 fight 步', map.fight.done, line(map));

  e.world.player.sect = 'huashan';
  ({ map } = steps(e));
  ok('sect 已定点亮 sect 步', map.sect.done, line(map));

  e.markTutorialFlag('did_save');
  ({ g, map } = steps(e));
  ok('save 完成 → finished=true', g.finished === true, 'done=' + g.doneCount + '/' + g.total);
}

/* ─────────────────────────────────────────── */
sec('③ 白名单：拒绝脏 flag，接受 seen_intro 与指令 flag');
{
  const e = mk();
  ok('拒绝不在白名单的 flag', e.markTutorialFlag('evil_hack') === false);
  ok('拒绝 null', e.markTutorialFlag(null) === false);
  ok('拒绝空串', e.markTutorialFlag('') === false);
  ok('拒绝非字符串', e.markTutorialFlag(123) === false);
  ok('接受 EXTRA_FLAGS 的 seen_intro', e.markTutorialFlag('seen_intro') === true);
  ok('接受 CMD_FLAGS 的 did_look', e.markTutorialFlag('did_look') === true);
  const fl = e.world.player.tutorialFlags;
  ok('脏 flag 没被写进存档', !fl.includes('evil_hack'), JSON.stringify(fl));
}

/* ─────────────────────────────────────────── */
sec('④ 顺序游标：不许跳步');
{
  const e = mk();
  e.world.player.kills = 9;
  e.world.player.sect = 'huashan';
  let { g, map } = steps(e);
  ok('前序未做时 kills=9 也不点亮 fight', !map.fight.done, line(map));
  ok('前序未做时 sect 已定也不点亮 sect', !map.sect.done, line(map));
  ok('fight 标记为 locked', map.fight.locked === true, line(map));
  ok('current 仍是第1步 look', g.current.id === 'look');
  ok('doneCount 为 0', g.doneCount === 0, 'done=' + g.doneCount);

  e.exec('look'); e.exec('n'); e.markTutorialFlag('did_train');
  ({ g, map } = steps(e));
  ok('走完3步后 current 指向第4步 talk', g.current.id === 'talk', 'current=' + g.current.id);
  ok('doneCount=3', g.doneCount === 3, 'done=' + g.doneCount);
}

/* ─────────────────────────────────────────── */
sec('⑤ 零兜底：状态满足但没做动作不算完成');
{
  const e = mk();
  const p = e.world.player;
  p.inventory = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  p.kills = 3;
  const { g, map } = steps(e);
  ok('背包塞物也不点亮任何步骤', g.doneCount === 0, line(map));
  ok('kills=3 也不点亮战斗步', !map.fight.done);
  ok('current 仍是第1步 look', g.current.id === 'look');
  const getStep = tutorial.STEPS.find(s => s.id === 'getitem');
  ok('已无 getitem 步（旧恒真兜底已删）', !getStep);
}

/* ─────────────────────────────────────────── */
sec('⑥ 全流程可完成（8 个真实步最终全部点亮）');
{
  const e = mk();
  const p = e.world.player;
  const order = ['did_look', 'did_move', 'did_train', 'did_talk', 'did_accept', null, null, 'did_save'];
  let okAll = true, stuckAt = null, prev = 0;
  order.forEach((flag, i) => {
    if (flag) e.markTutorialFlag(flag);
    else if (i === 5) p.kills = 1;
    else if (i === 6) p.sect = 'huashan';
    const after = e.view().guide;
    /* 只校验单调不减（quest 步因新游戏自动接第二幕可能提前完成，属预期，非倒退） */
    if (after.doneCount < prev) { okAll = false; stuckAt = i + ':' + after.doneCount + '(倒退)'; }
    prev = after.doneCount;
  });
  const fin = e.view().guide;
  ok('八步最终全部点亮（finished）', okAll && fin.finished === true, stuckAt || '');
  ok('doneCount 等于 total(8)', fin.doneCount === fin.total, fin.doneCount + '/' + fin.total);
  ok('毕业提示 free 步存在且永不完成', fin.steps.some(s => s.id === 'free' && !s.done));
}

/* ─────────────────────────────────────────── */
sec('⑦ UI 渲染 locked 态 + 沉浸式开场接线');
{
  const e = mk();
  e.world.player.kills = 3;
  const v = e.view();
  const html = (function () {
    const built = new Function('esc',
      UISRC.match(/function guideHtml[\s\S]*?\n  \}/)[0] + '\nreturn guideHtml;')(
        s => String(s == null ? '' : s).replace(/[&<>"]/g,
          c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    return built(v);
  })();
  ok('locked 步渲染为 locked 类', html.includes('gp-step locked'));
  ok('locked 步显示 🔒', html.includes('🔒'));
  ok('CSS 有 locked 样式',
    fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8').indexOf('.gp-step.locked') > 0);

  /* 开场剧情接线 */
  const v0 = mk().view();
  ok('新玩家 view.intro.show 为真', v0.intro && v0.intro.show === true);
  ok('intro 带标题与正文', !!v0.intro.title && (v0.intro.body || '').includes('老槐树'));
  ok('前端 maybeShowIntro 已接线', UISRC.indexOf('maybeShowIntro') > 0);
  ok('前端按钮 id intro-go 已接线', UISRC.indexOf('intro-go') > 0);
  ok('后端 introFor 已实现并接线', ENGSRC.indexOf('introFor') > 0 && ENGSRC.indexOf('EXTRA_FLAGS') > 0);
  const e2 = mk();
  e2.markTutorialFlag('seen_intro');
  ok('看过开场后 intro.show 为假', e2.view().intro.show === false);
}

console.log('\n' + '='.repeat(46));
console.log('  新手教程专项: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(46));
if (fail) process.exit(1);
