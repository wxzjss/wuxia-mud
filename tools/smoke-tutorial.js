/* 新手教程专项回归（2026-10-09 重做教程时新增）
 *
 *锁死三个历史 bug：
 *   1. 第3/4 步永远完不成 —— 面板类指令（i/score/attr）被前端 PANEL_CMDS 拦下，
 *      不进 api.exec，后端 flag 永远收不到。现在走 panel() 统一上报。
 *   2. 某步自动完成 —— 兜底条件（inventory.length > 5）与教学目标无关。
 *      现在全部只认 flag 或真状态，零兜底。
 *   3. 跳步 —— 各步独立求值，一步能跳过前面全部。现在是顺序游标 + locked。
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const tutorial = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));
const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }

function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261009 });
  e.boot();                       // 同步 boot（Engine.boot 无 await 时可用）
  return e;
}
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
sec('① 面板类指令必须能被教程识别（历史 bug 1）');
{
  const PANEL_CMDS = (UISRC.match(/const PANEL_CMDS = \{[\s\S]*?\n  \}/) || [''])[0];
  const panelHit = {};
  const m = PANEL_CMDS.match(/([\s\S]*)/);
  /* 粗解析：抓出所有 key:'value' 对 */
  const re = /([A-Za-z_一-龥?'" ]+)\s*:\s*'([a-z]+)'/g;
  let mm;
  while ((mm = re.exec(PANEL_CMDS)) !== null) {
    const cmd = mm[1].trim().replace(/^['"]|['"],?$/g, '').trim();
    if (!cmd) continue;
    panelHit[cmd] = mm[2];
  }
  ok('能解析出 PANEL_CMDS', Object.keys(panelHit).length > 10, '解析到 ' + Object.keys(panelHit).length + ' 条');

  /* 凡是 CMD_FLAGS 里有 flag 的面板指令，面板名必须能被 panelGuideFlag 覆盖 */
  const panelGuide = (UISRC.match(/function panelGuideFlag[\s\S]*?\n  \}/) || [''])[0];
  const covered = ['inventory', 'score', 'attr'];
  const needFlags = {};
  Object.keys(tutorial.CMD_FLAGS).forEach(k => {
    const pn = panelHit[k];
    if (pn) needFlags[pn] = tutorial.CMD_FLAGS[k];
  });
  covered.forEach(pn => {
    ok('面板 ' + pn + ' 有教程上报映射',
      new RegExp('(^|[{\\s,])[\'"]?' + pn + '[\'"]?\\s*:\\s*[\'"]did_').test(panelGuide),
      '缺 panelGuideFlag → 这类指令永远点不亮教程');
  });
  /* 反查：i/score/attr 这三条确实被面板拦且 flag 一致 */
  ok('指令 i 映射 did_bag 且被拦成 inventory',
    panelHit.i === 'inventory' && tutorial.CMD_FLAGS.i === 'did_bag');
  ok('指令 score 映射 did_score 且被拦成 score',
    panelHit.score === 'score' && tutorial.CMD_FLAGS.score === 'did_score');
  ok('app.js 提供 api.markGuide',
    fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'app.js'), 'utf8').indexOf('markGuide') > 0);
  ok('后端有 markTutorialFlag',
    fs.readFileSync(path.join(ROOT, 'game', 'src', 'core', 'engine.js'), 'utf8').indexOf('markTutorialFlag') > 0);
  ok('server 有 guide/mark 接口',
    fs.readFileSync(path.join(ROOT, 'server', 'game-server.js'), 'utf8').indexOf("'guide/mark'") > 0);
  ok('panel() 内部统一调用上报',
    (UISRC.match(/panelGuideFlag\(name\)/g) || []).length > 0);
}

/* ─────────────────────────────────────────── */
sec('② 面板上报能真的点亮教程步骤（端到端）');
{
  const e = mk();
  e.exec('look');
  e.exec('n');
  let { g, map } = steps(e);
  ok('look/move 已完成', map.look.done && map.move.done, line(map));
  ok('第3步此刻未完成', !map.bag.done, line(map));

  /* 模拟打开行囊面板 → panel() 会上报 did_bag */
  ok('markTutorialFlag(did_bag) 返回 true', e.markTutorialFlag('did_bag') === true);
  ({ map } = steps(e));
  ok('上报后第3步完成', map.bag.done, line(map));
  ok('第4步随之解锁', !map.status.locked, line(map));

  e.markTutorialFlag('did_score');
  ({ map } = steps(e));
  ok('上报后第4步完成', map.status.done, line(map));
  ok('第5步随之解锁', !map.skill.locked, line(map));
}

/* ─────────────────────────────────────────── */
sec('③ 非法 flag 必须被拒（防注入）');
{
  const e = mk();
  ok('拒绝不在白名单的 flag', e.markTutorialFlag('evil_hack') === false);
  ok('拒绝 null', e.markTutorialFlag(null) === false);
  ok('拒绝空串', e.markTutorialFlag('') === false);
  ok('拒绝非字符串', e.markTutorialFlag(123) === false);
  ok('接受白名单内的', e.markTutorialFlag('did_bag') === true);
  const fl = e.world.player.tutorialFlags;
  ok('脏 flag 没被写进存档', !fl.includes('evil_hack'), JSON.stringify(fl));
}

/* ─────────────────────────────────────────── */
sec('④ 顺序游标：不许跳步（历史 bug 3）');
{
  const e = mk();
  e.world.player.kills = 9;              // 直接满足「打赢第一场」
  e.world.player.sect = 'huashan';       // 直接满足「拜入门派」
  let { g, map } = steps(e);
  ok('前序未做时 kills=9 也不点亮第8步', !map.fight.done, line(map));
  ok('前序未做时 sect 已定也不点亮第9步', !map.sect.done, line(map));
  ok('第8步标记为 locked', map.fight.locked === true, line(map));
  ok('当前步仍是第1步', g.current.id === 'look');
  ok('doneCount 为 0', g.doneCount === 0, 'done=' + g.doneCount);

  /* 走完前 3 步，第4步解锁 */
  e.exec('look'); e.exec('n'); e.markTutorialFlag('did_bag');
  ({ g, map } = steps(e));
  ok('走完3步后 current 指向第4步', g.current.id === 'status', 'current=' + g.current.id);
  ok('doneCount=3', g.doneCount === 3, 'done=' + g.doneCount);
}

/* ─────────────────────────────────────────── */
sec('⑤ 零兜底：状态满足但没做动作不算完成');
{
  const e = mk();
  const p = e.world.player;
  /* 塞一堆物品、给 kills 和 sect —— 全都不该点亮任何步骤 */
  p.inventory = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' },
    { id: 'e' }, { id: 'f' }, { id: 'g' }, { id: 'h' }];
  p.kills = 3;
  const { g, map } = steps(e);
  ok('背包塞 8 件也不点亮任何步骤', g.doneCount === 0, line(map));
  ok('kills=3 也不点亮战斗步', !map.fight.done);
  ok('current 仍是第1步', g.current.id === 'look');
  /* 明确断言「拾取」只认 flag */
  const getStep = tutorial.STEPS.find(s => s.id === 'getitem');
  ok('已删除 getitem 步（长度兜底无解）', !getStep, '旧步 test 含 inventory.length>5 恒真');
}

/* ─────────────────────────────────────────── */
sec('⑥ 全流程可完成（每一步都能真的点亮）');
{
  const e = mk();
  const p = e.world.player;
  const order = ['did_look', 'did_move', 'did_bag', 'did_score', 'did_train',
    'did_talk', 'did_accept', null, null, 'did_save'];
  let okAll = true, stuckAt = null;
  order.forEach((flag, i) => {
    const before = e.view().guide.current;
    if (flag) e.markTutorialFlag(flag);
    else if (i === 7) p.kills = 1;        // 战斗步是纯状态 kills
    else if (i === 8) p.sect = 'huashan'; // 拜师步是纯状态 sect
    const after = e.view().guide;
    const expected = order[i + 1] === undefined;
    if (!expected) {
      const progressed = after.doneCount > (e.view().guide.doneCount - 0);
      if (after.doneCount !== i + 1) { okAll = false; stuckAt = i + ':' + (before && before.id); }
    }
  });
  const fin = e.view().guide;
  ok('十步全部依次点亮', okAll, stuckAt || '');
  ok('最终 finished=true', fin.finished === true, 'done=' + fin.doneCount + '/' + fin.total);
  ok('doneCount 等于 total', fin.doneCount === fin.total,
    fin.doneCount + '/' + fin.total);
  ok('毕业提示 free 步存在且永不完成',
    fin.steps.some(s => s.id === 'free' && !s.done));
}

/* ─────────────────────────────────────────── */
sec('⑦ UI 渲染 locked 态');
{
  const e = mk();
  e.world.player.kills = 3;
  const v = e.view();
  const html = (function () {
    const built = new Function('esc',
      fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8')
        .match(/function guideHtml[\s\S]*?\n  \}/)[0] + '\nreturn guideHtml;')(
        s => String(s == null ? '' : s).replace(/[&<>"]/g,
          c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])));
    return built(v);
  })();
  ok('locked 步渲染为 locked 类', html.includes('gp-step locked'), '');
  ok('locked 步显示 🔒', html.includes('🔒'));
  ok('CSS 有 locked 样式',
    fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8').indexOf('.gp-step.locked') > 0);
}

console.log('\n' + '='.repeat(46));
console.log('  新手教程专项: ' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(46));
if (fail) process.exit(1);