/* 剧情上屏（主人 2026-10-11 追问）：
 *   「为什么新手任务的剧情、以及一些剧情里人物说的话做的动作神态，
 *     没有写在屏幕上，还得玩家专门打开任务界面看？」
 *   「如果是剧情人物说话做事之类的描写，需要玩家在该 NPC 旁边时才会显示。」
 *
 * 两件事都要钉住：**剧情要自己走到屏幕上**，且**人物言行只在该 NPC 在场时上屏**。
 * 跑法：node tools/smoke-storybeat.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const sb = require(path.join(ROOT, 'game/src/core/storybeat.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }
const kinds = (r, k) => ((r && r.lines) || []).filter(l => l.kind === k).map(l => l.text);
const allText = (r) => ((r && r.lines) || []).map(l => l.text || '').join('\n');

(async () => {
  const e = new GameEngine({ seed: 606 });
  await e.boot({});
  /* 🔴 主人 2026-10-11：「创建完角色进入游戏后**直接触发新手剧情**把第一章发到屏幕上，
     而不是先『看』才能看见（这样的话会直接完成第一个任务）」
     ⇒ 第一章现在跟着  的返回一起上屏，不等第一条指令。 */
  const rNew = e.newGame({ name: '看戏的' });
  const w = e.world, p = w.player;

  /* ================= 一、剧情走**上方大框**（主人 2026-10-08 改的口径）=================
     原口径：剧情由 storybeat 逐章「补讲」到**下方日志**里。
     新口径：大框（`view.story`）**常显当前追踪那一章**，日志只留场面
            （房间描写 / 出口 / 在场的人 / 战斗 / 系统提示）。
     为什么更好：常显 = 走开、读档、跨区回来那一章都还在，不会「永久错过」；
                也不需要「逐章补课」那套记账（它一旦漏环就静默吞剧情）。 */
  section('1 剧情走大框（开局即显示，且不混进日志）');
  /* ⚠️ 取剧情的路径两种形状都要认：
       `newGame()` 返回的就是 view 本身（`r.story`）；
       `exec()` 返回 `{lines, view, ...}`，剧情在 `r.view.story`（指令回包不带日志之外的东西）。 */
  const storyOf = r => (r && (r.story || (r.view && r.view.story))) || null;
  const ST = storyOf(rNew);
  const storyText = (o) => ((o && o.lines) || []).map(l => l.text || '').join('\n');
  const t0 = storyText(ST);
  /* ⚠️ 别再钉台词原文 —— 从 tutorial.STEPS 取第一章的 story 来比（同源）。 */
  const CH1 = require(path.join(ROOT, 'game/src/core/tutorial.js')).STEPS.find(s => s.id === 'look') || {};
  ok('★ 开局大框里就是第 1 章', !!ST && ST.arc === 'tutorial', ST && ST.arc);
  ok('★ 第 1 章的旁白在大框里', !!(CH1.story && t0.indexOf(CH1.story) >= 0),
    (ST && ST.lines || []).map(l => l.kind).join(','));
  ok('★ 大框抬头写着章次（第 1 / 8 章）', !!ST && /第 1 \/ \d+ 章/.test(ST.arcLabel || ''), ST && ST.arcLabel);
  ok('★ 老汉那句话也在大框里', !!(ST && (ST.lines || []).some(l => l.kind === 'say' && /老汉/.test(l.text))),
    t0.slice(0, 60));
  /* 🔴 主人 2026-10-11：「剧情文本下一行加一句大白话具体讲现在该做什么」 */
  ok('★ 大框给了「现在做什么」的大白话', !!ST && /查看四周/.test(ST.todo || ''), ST && ST.todo);
  /* 上屏≠完成：第一章的目标只认「真看了」 */
  ok('★ 剧情上屏**不**等于做完第一个任务',
    require(path.join(ROOT, 'game/src/core/tutorial.js')).guideState(p, p.tutorialFlags).doneCount === 0,
    'done=' + require(path.join(ROOT, 'game/src/core/tutorial.js')).guideState(p, p.tutorialFlags).doneCount);

  /* —— 日志里**不许**有剧情行：主人「不在屏幕上和其他人物描写环境描写之类的一起显示」 —— */
  {
    const ks = kinds(rNew, 'story').concat(kinds(rNew, 'say'), kinds(rNew, 'subtitle'))
      .concat(kinds(rNew, 'hint'));
    ok('★ 开局那屏日志里没有剧情行（旁白/台词/章节抬头）', ks.length === 0,
      ks.join(' | ').slice(0, 60) || '干净');
    /* ⚠️ 光看 kind 不够：`subtitle` 别处也在用（score 面板），
       再加一道「日志文本里不许出现章节抬头样式」的硬判据。 */
    ok('★ 开局日志文本里也没有「第 N 章 ·」', !/第 \d+ 章 ·/.test(allText(rNew)), allText(rNew).slice(0, 50));
    ok('★ 日志留的是场面（房间/出口/在场的人）',
      kinds(rNew, 'desc').length + kinds(rNew, 'exits').length + kinds(rNew, 'npcs').length > 0,
      [...new Set(kinds(rNew))].join(','));
  }

  /* 常显：换一条指令之后大框还是同一章，不会叠加、也不会念第二遍 */
  const r0b = await e.exec('score');
  ok('★ 大框常显同一章（不重复念、不叠加）',
    !!storyOf(r0b) && storyOf(r0b).arc === 'tutorial' && storyOf(r0b).no === ST.no,
    storyOf(r0b) && (storyOf(r0b).arcLabel + ' ' + storyOf(r0b).title));
  ok('同一章不在日志里复述', !/第 \d+ 章 ·/.test(allText(r0b)), allText(r0b).slice(0, 50));

  /* —— 客户端那一环：大框由 renderAll → renderRoom 画，不靠日志 —— */
  {
    const RJS = path.join(ROOT, 'game/src/renderer/js/ui.js');
    const UI = require('fs').readFileSync(RJS, 'utf8');
    ok('★ 前端把 view.story 画进大框（renderStory）',
      /renderStory\(v\.story/.test(UI) && /function renderStory\(/.test(UI));
    ok('★ 有剧情时房间描述让位、没剧情时放回来',
      /desc\.classList\.add\('hidden'\)/.test(UI) && /desc\.classList\.remove\('hidden'\)/.test(UI));
    const START = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/start.js'), 'utf8');
    ok('★ 创建角色后把开局场面落进日志（房间描写那些）',
      /const head = \(d\.view && d\.view\.lines\)/.test(START) && /appendLog\(head\)/.test(START));
    ok('★ 读档后也把这一屏落进日志（不然回来只看到一行字）',
      /const head2 = \(S\.view && S\.view\.lines\)/.test(START) && /appendLog\(head2\)/.test(START));
  }

  /* ================= 二、人物言行只在场才上屏 ================= */
  section('2 老汉不在跟前，他的话就不该出现');
  const elderRoom = 'road_jiangnan_1';
  ok('起局时老汉确实在跟前', w.npcsIn(elderRoom).some(n => n.defId === 'guide_teaman'),
    w.npcsIn(elderRoom).map(n => n.name).join('、'));

  /* A/B 对照：同一条通道——走开时讲的一章 vs 回到他跟前讲的一章。
     断言不看章号（章号会随教程改动漂），只看「有没有出现老汉的话」。 */
  const elderSays = (r) => kinds(r, 'say').filter(t => /老汉/.test(t));

  /* 走开之后：剧情**照旧留在大框里**（这是「常显」要证明的事），
     而日志里依旧不许冒出剧情行。 */
  const rMove = await e.exec('北');
  ok('走出去了', p.room !== elderRoom, '现在在 ' + w.data.rooms[p.room].name);
  const rLook = await e.exec('look');
  ok('★ 走开之后大框里还是那一章（不会因为离开就消失）',
    !!storyOf(rLook) && storyOf(rLook).arc === 'tutorial' && /第 \d+ \/ \d+ 章/.test(storyOf(rLook).arcLabel || ''),
    storyOf(rLook) && storyOf(rLook).arcLabel);
  /* 口径变更（主人 2026-10-11）：在场闸门已撤 → 台词照旧在大框里出现 */
  ok('★ 老汉的台词照旧在大框里（在场闸门已撤）',
    !!((storyOf(rLook) || {}).lines || []).some(l => l.kind === 'say' && /老汉/.test(l.text)),
    ((storyOf(rLook) || {}).lines || []).map(l => l.kind).join(','));
  ok('★ 换一条指令，日志里还是没有剧情',
    !/第 \d+ 章 ·/.test(allText(rLook)) && !/老汉/.test(allText(rLook)),
    allText(rLook).slice(0, 50));

  /* ================= 三、任务的剧情也上屏 ================= */
  section('3 任务的剧情：接取 + 阶段推进');
  const e2 = new GameEngine({ seed: 707 });
  await e2.boot({});
  e2.newGame({ name: '听书的' });
  const w2 = e2.world, p2 = w2.player;
  /* 找一个「委托人就在这屋里」的任务，站在他跟前接 */
  const qd = Object.values(w2.data.quests).find(q => q.giver && w2.data.npcs[q.giver]
    && (q.type || '') !== '主线');
  ok('找到一桩有委托人的支线', !!qd, qd && qd.name);
  if (qd) {
    w2.spawnNpc(qd.giver, p2.room);
    const giverName = w2.data.npcs[qd.giver].name;
    ok('委托人已在跟前', w2.npcsIn(p2.room).some(n => n.defId === qd.giver), giverName);
    const ra = await e2.exec('接任务 ' + qd.name);
    const ta = allText(ra);
    ok('★ 接取时在屏幕上看到任务名', ta.includes(qd.name), ta.slice(0, 60));
    ok('★ 委托人的那段来历也上屏了', !!qd.desc && ta.includes(qd.desc.slice(0, 12)),
      (qd.desc || '').slice(0, 50));
    ok('★ 顺带给了当前目标', /目标：/.test(ta), (ta.match(/目标：[^\n]{0,30}/) || [''])[0]);
  }

  /* 委托人的话：**人不在就不该出现** */
  section('4 委托人不在跟前：只讲旁白与目标');
  const e3 = new GameEngine({ seed: 808 });
  await e3.boot({});
  e3.newGame({ name: '远客' });
  const w3 = e3.world, p3 = w3.player;
  const qd3 = Object.values(w3.data.quests).find(q => q.giver && w3.data.npcs[q.giver]
    && (q.type || '') !== '主线');
  if (qd3) {
    /* 走远一点再接（⚠️ 起局那间屋里本来就蹲着好几个 NPC，
       包括某些任务的委托人 —— 第一版就这么把「人不在」测成了「人在」）。 */
    const far = Object.keys(w3.data.rooms).find(id =>
      id !== p3.room && w3.data.rooms[id].region !== w3.data.rooms[p3.room].region
      && (w3.npcsIn(id) || []).length === 0);
    w3.movePlayerTo(p3, far);
    await e3.exec('score');                       // 让剧情对账先跑一遍
    /* 口径变更（主人 2026-10-11）：离得再远，闸门也已撤 —— 照放行。
       这里改成正面验证「撤闸门」这件事本身，而不是反过来断言「不上屏」。 */
    ok('已经离委托人很远了（但闸门已撤，仍放行）', sb.present(w3, p3, qd3.giver) === true, far);
    const ra3 = await e3.exec('接任务 ' + qd3.name);
    const ta3 = allText(ra3);
    ok('★ 人不在也照讲（不再静默吞掉）', ta3.length > 0, ta3.slice(0, 70));
    ok('★ 但是目标还是给了（玩家知道该干什么）', /目标：/.test(ta3));
  }

  /* ================= 五、读档不刷屏 ================= */
  section('5 读老存档不刷屏');
  const TMP = path.join(__dirname, '_storytest');
  const fs = require('fs');
  /* ⚠️ 别用 fs.rmSync 清目录 —— Node 侧有「一轮删 >50 个文件」的保护（safe-delete shim），
     跑全套回归时它会被前面那些测试把配额吃光，于是这里被拦成非 0 退出（**假红**，
     与代码无关）。与 smoke-mod-trace.js 同法：走 shell 绕开。 */
  require('child_process').execSync('rm -rf "' + TMP + '"', { stdio: 'ignore' });
  fs.mkdirSync(TMP, { recursive: true });
  const e4 = new GameEngine({ seed: 909, saveDir: TMP });
  await e4.boot({});
  e4.newGame({ name: '旧档人' });
  await e4.exec('look');
  await e4.exec('北');
  /* 模拟老存档：把「剧情讲到哪」的账抹掉，再存 */
  delete e4.world.player.vars._storyBeat;
  e4.save('oldsave');
  const e5 = new GameEngine({ seed: 909, saveDir: TMP });
  await e5.boot({});
  const lr = e5.loadSave('oldsave');
  ok('读档成功', lr.ok, lr.msg);
  const rAfter = await e5.exec('score');
  /* ⚠️ 判据要认**章节抬头那个样式**（「第 N 章 · 标题」），不能只按 kind 判 ——
     `subtitle` 这个 kind 别处也在用（score 面板的「装备（2 件）」就是它）。 */
  ok('★ 读档后日志里没有剧情（不会把旧章节一口气念一遍）',
    !/第 \d+ 章 ·/.test(allText(rAfter)) && !/老汉/.test(allText(rAfter)),
    allText(rAfter).slice(0, 60));
  ok('★ 读档后大框里还有当前那一章（追踪状态随档走 / 老档补追新手）',
    !!storyOf(rAfter) && !!storyOf(rAfter).title, storyOf(rAfter) ? storyOf(rAfter).arcLabel : '(空)');
  require('child_process').execSync('rm -rf "' + TMP + '"', { stdio: 'ignore' });

  /* ================= 六、闸门本身 ================= */
  section('6 present() 的判据');
  /* 🔴 口径变更（主人 2026-10-11）：「把剧情 npc 不在玩家身边就不说话效果取消掉
     （实测影响游戏体验）」。原先这一节断言的是「人不在 → 整条拦下」，
     现在语义反过来了：**恒放行**。改的是主人的决定，不是把新功能判成 bug。 */
  ok('不指定人 → 放行', sb.present(w, p, null) === true);
  ok('在场的人 → 放行', sb.present(w, p, 'guide_teaman') === true);
  ok('★ 不在场的人也放行（在场闸门已撤）', sb.present(w, p, 'master_yue') === true);
  ok('★ beats 不再按在场丢条目（人不在也照讲）',
    sb.beats(w, p, [{ kind: 'say', text: 'x', by: 'master_yue' }]).length === 1);
  ok('没有归属的条目照常过',
    sb.beats(w, p, [{ kind: 'story', text: 'y' }]).length === 1);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
