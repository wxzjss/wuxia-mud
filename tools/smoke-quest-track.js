/* smoke-quest-track.js —— 任务追踪（主人 2026-10-08）
 *
 * 主人定的规则（原话）：
 *   ·「在『任务』里给任务添加追踪按钮，点击追踪按钮后上方大框内容切换成该追踪任务」
 *   ·「如果不追踪任务，大框默认是新手剧情任务，直到该任务结束后自动切换追踪其他任务
 *      （优先追踪主线剧情任务）」
 *   ·「点击追踪后『追踪』按钮变成『取消追踪』」
 *   ·「点击取消追踪后，大框里的任务以及大框都消失，直到接取一个新任务或者主动追踪任务」
 *   ·「初始默认追踪新手剧情任务」
 *   ·「主线剧情依旧是开局就接这个不变，但不会在屏幕下方显示」
 *
 * 跑法：node tools/smoke-quest-track.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const sb = require(path.join(ROOT, 'game', 'src', 'core', 'storybeat.js'));
const tutorial = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function sec(t) { console.log('\n── ' + t + ' ──'); }

const storyOf = r => (r && (r.story || (r.view && r.view.story))) || null;

function boot(seed) {
  const e = new GameEngine({ seed: seed || 4242, saveDir: SAVE_DIR });
  e.boot();
  e.newGame({ name: '追事的', gender: 'male', birth: 'wuxue' });
  return e;
}
/** 把新手教程整条标记做完（模拟走完新手那一程） */
function finishTutorial(p) {
  /* ⚠️ 运行期 `p.tutorialFlags` 是**数组**（引擎 markTutorial 用 indexOf 判重）；
     `guideState` 内部自己会 `new Set(...)`，两种形态都吃。测试别给 Set ——
     给 Set 会让引擎那条 indexOf 当场抛错（真踩过）。 */
  p.tutorialFlags = ['did_look', 'did_step', 'did_leave', 'did_move', 'did_train',
    'did_talk', 'did_accept', 'sect', 'did_fight', 'did_save'];
  p.sect = 'huashan';
  p.kills = 2;
}

(async () => {
  console.log('==============================================');
  console.log('  任务追踪（大框显示哪一桩事）');
  console.log('==============================================');

  /* ---------- ① 开局 ---------- */
  sec('① 初始默认追踪新手剧情任务');
  {
    const e = boot();
    const v = e.view();
    const p = e.world.player;
    ok('初始 p.track = 新手剧情任务', p.track === sb.NEWBIE, JSON.stringify(p.track));
    ok('大框里就是新手第一章', !!storyOf(v) && storyOf(v).arc === 'tutorial',
      storyOf(v) && storyOf(v).arcLabel);
    ok('★ 主线**照旧开局就接**（主人明确要求不变）', p.questStage('q_main_jianghu') !== undefined,
      'stage=' + p.questStage('q_main_jianghu'));
    ok('★ 但第一幕不重复要拜师（拜师归新手第 6 章）',
      p.questStage('q_main_jianghu') === 1, 'stage=' + p.questStage('q_main_jianghu'));
    /* 主人：「主线剧情依旧是开局就接这个不变，但**不会在屏幕下方显示**」 */
    const v0 = e.newGame({ name: '重开' });
    const storyLines = (v0.lines || []).filter(l => ['story', 'say', 'subtitle'].indexOf(l.kind) >= 0);
    ok('★ 主线不占屏幕下方（开局日志里没有剧情行）', storyLines.length === 0,
      storyLines.map(l => l.kind).join(',') || '干净');
    ok('★ 大框也不显示主线（此刻追的是新手）', storyOf(v0).arc === 'tutorial', storyOf(v0).arcLabel);
  }

  /* ---------- ② 追踪 / 取消追踪 ---------- */
  sec('② 追踪按钮：切内容、切成「取消追踪」、取消后大框收起');
  {
    const e = boot(7);
    const p = e.world.player;
    const r1 = await e.exec('追踪 q_main_jianghu');
    ok('敲「追踪 <id>」后 p.track 换成它', p.track === 'q_main_jianghu', p.track);
    const s1 = storyOf(r1);
    ok('★ 大框换成主线那一幕', !!s1 && s1.arc === 'main', s1 && s1.arcLabel);
    ok('★ 抬头写着主线 + 步数', /主线 · 第 \d+ \/ \d+ 步/.test((s1 || {}).arcLabel || ''), s1 && s1.arcLabel);
    ok('★ 大框里有它的旁白与当前目标',
      !!s1 && (s1.lines || []).length >= 1 && !!s1.todo, (s1 || {}).todo);
    ok('★ 大框里的任务名与后端一致（去掉了『【主线】』前缀）',
      !!s1 && s1.title === '江湖路远', s1 && s1.title);
    ok('面板据此把按钮画成「取消追踪」', e.view().track === 'q_main_jianghu', e.view().track);

    /* 取消追踪 —— 主人：「大框里的任务以及大框都消失」 */
    const r2 = await e.exec('取消追踪');
    ok('取消后 p.track 为空', p.track === null, JSON.stringify(p.track));
    ok('★ 大框收起（view.story 为 null）', storyOf(r2) === null, JSON.stringify(storyOf(r2)));
    /* 取消之后**不许**自动给他追回来（除非接新任务 / 主动追） */
    const r3 = await e.exec('look');
    ok('★ 取消之后不会自己追回来', p.track === null && storyOf(r3) === null, JSON.stringify(p.track));
    /* 主动再追 */
    const r4 = await e.exec('追踪 q_main_jianghu');
    ok('★ 再追能追回来', p.track === 'q_main_jianghu' && !!storyOf(r4), storyOf(r4) && storyOf(r4).arcLabel);
  }

  /* ---------- ③ 新手走完 → 自动换（优先主线） ---------- */
  sec('③ 新手剧情任务结束后自动切（优先主线）');
  {
    const e = boot(8);
    const p = e.world.player;
    ok('此刻追的是新手', p.track === sb.NEWBIE, p.track);
    finishTutorial(p);
    const r = await e.exec('look');
    const s = storyOf(r);
    ok('★ 新手走完 → 自动换追主线', p.track === 'q_main_jianghu', JSON.stringify(p.track));
    ok('★ 大框无缝变成主线那一幕（同一个渲染位置，没有重新开始的动作）',
      !!s && s.arc === 'main', s && s.arcLabel);
  }

  /* ---------- ④ 追的那条交完了 → 自动换一条 ---------- */
  sec('④ 追踪的任务交掉之后自动换一条');
  {
    const e = boot(9);
    const p = e.world.player;
    p.track = 'q_main_jianghu';
    p.quests.q_main_jianghu = 99;               /* 假装交接完了 */
    await e.exec('look');
    ok('追的那条交完 → 不再追它', p.track !== 'q_main_jianghu', JSON.stringify(p.track));
  }

  /* ---------- ⑤ 取消之后接新任务 → 自动追它 ---------- */
  sec('⑤ 取消追踪后「接取一个新任务」大框就回来');
  {
    const e = boot(10);
    const w = e.world, p = w.player;
    await e.exec('取消追踪');
    ok('先取消掉，大框空着', p.track === null, JSON.stringify(p.track));
    /* 找一桩有委托人的支线，站到他跟前接 */
    const qd = Object.values(w.data.quests).find(q => q.giver && w.data.npcs[q.giver]
      && (q.type || '') !== '主线');
    ok('找到一桩可接的支线', !!qd, qd && qd.name);
    if (qd) {
      w.spawnNpc(qd.giver, p.room);
      await e.exec('接任务 ' + qd.name);
      ok('★ 新接的任务自动被追起来', p.track === qd.id, p.track + ' / 期望 ' + qd.id);
      const s = storyOf(e.view());
      ok('★ 大框换成这一桩（支线）', !!s && s.arc === 'side', s && s.arcLabel);
    }
  }

  /* ---------- ⑥ 随档 ---------- */
  sec('⑥ 追踪状态随档走');
  {
    const e = boot(11);
    const p = e.world.player;
    p.track = 'q_main_jianghu';
    const rSave = e.save('track1');
    ok('存档成功', !rSave || rSave.ok !== false, rSave && rSave.msg);
    const e2 = new GameEngine({ seed: 11, saveDir: SAVE_DIR });
    e2.boot();
    const lr = e2.loadSave('track1');
    ok('读档成功', lr.ok, lr.msg);
    ok('★ 读档后还追着同一条', e2.world.player.track === 'q_main_jianghu',
      JSON.stringify(e2.world.player.track));
    ok('★ 读档后大框里还是那一幕', !!storyOf(e2.view()), storyOf(e2.view()) && storyOf(e2.view()).arcLabel);
  }

  /* ---------- ⑦ 前端接线（源码级） ---------- */
  sec('⑦ 前端接线');
  {
    const UI = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
    ok('任务面板里有追踪按钮（data-track）', /data-track="/.test(UI) && /q-track/.test(UI));
    ok('★ 正追着的那条画成「取消追踪」',
      /on \? '取消追踪' : '追踪'/.test(UI));
    ok('★ 点按钮真发指令（追踪 / 取消追踪）',
      /doCmd\(on \? '取消追踪' : \('追踪 ' \+ id\)/.test(UI));
    ok('★ 点完重开任务面板（不然按钮还写着「追踪」）', /closeModal\(\);\s*\n\s*panel\('quests'\)/.test(UI));
    ok('大框画在房间面板里（renderRoom → renderStory）',
      /renderStory\(v\.story/.test(UI));
    ok('有剧情时房间描述让位', /desc\.classList\.add\('hidden'\)/.test(UI));
    /* 指令必须**真在后端**（不能只靠前端，纯文本客户端也要能用） */
    const CMD = require('fs').readFileSync(path.join(ROOT, 'game/src/core/commands.js'), 'utf8');
    ok('后端注册了 追踪 / 取消追踪', /'track', '追踪'/.test(CMD) && /'untrack', '取消追踪'/.test(CMD));
    /* ⚠️ 这两个词绝不能进 PANEL_CMDS —— 进去就变成「开面板」而不是真追踪 */
    ok('★ 「追踪」不在前端 PANEL_CMDS 里（否则会被吃成开面板）',
      !/追踪: '/.test(UI.split('PANEL_CMDS')[1] || ''));
  }

  /* ---------- ⑧ 大框渲染（真函数） ---------- */
  sec('⑧ 大框 HTML');
  {
    /* 从源码里抠出 storyHtml 真跑（跟 mapguide-check 抠 mapHtml 同一个套路：
       闭包里的函数外面拿不到，抽取时只喂它真正用到的依赖 `esc`）。 */
    const UISRC = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
    const src = (UISRC.match(/function storyHtml\(s\)[\s\S]*?\n  \}/) || [''])[0];
    ok('能从 ui.js 里抠出 storyHtml', !!src);
    const esc = s2 => String(s2 == null ? '' : s2)
      .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const storyHtml = new Function('esc', src + '\nreturn storyHtml;')(esc);
    const h = storyHtml({
      arc: 'main', arcName: '主线', arcLabel: '主线 · 第 1 / 6 步',
      title: '江湖路远', lines: [{ kind: 'story', text: '旁白一句。' }, { kind: 'plain', text: '　眼下这一步：练功' }],
      todo: '把功夫练起来',
    });
    ok('抬头写的是后端给的 arcLabel', /主线 · 第 1 \/ 6 步/.test(h), h.slice(0, 60));
    ok('任务名进 HTML', /江湖路远/.test(h));
    ok('正文进 HTML（旁白 + 目标）', /旁白一句/.test(h) && /眼下这一步/.test(h));
    ok('「现在做什么」进 HTML', /现在做什么/.test(h) && /把功夫练起来/.test(h));
    ok('没有 undefined / NaN 漏进 HTML', !/undefined|NaN/.test(h), (h.match(/undefined|NaN/g) || []).join(','));
  }

  console.log('\n==============================================');
  console.log('  任务追踪：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
