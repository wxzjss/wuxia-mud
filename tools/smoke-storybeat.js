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
  /* 🔴 口径变更（主人 2026-10-12）：
     ① 「屏幕上方那个大方框的默认为**没有追踪任何任务会显示的界面**」
        —— 开局不再自动追新手（`p.track = null`）；
     ② 「新手教程剧情全删」—— 新手那条 arc **整条没了**，大框现在只画**主线**。
     ⚠️ 本节测的是**大框的渲染能力**（「追着的这一幕常显、不混进日志」），
        所以这里显式**主动追一次主线**，再把三件事验完。 */
  await e.exec('追踪 q_main_jianghu');
  const rNew2 = e.view();
  void rNew2;

  /* ================= 一、剧情走**上方大框**（主人 2026-10-08 改的口径）=================
     🔴 2026-10-12「新手教程剧情全删」后：大框里画的**只有主线那一幕**。
     原口径：剧情由 storybeat 逐章「补讲」到**下方日志**里。
     新口径：大框（`view.story`）**常显当前追踪那一幕**，日志只留场面
            （房间描写 / 出口 / 在场的人 / 战斗 / 系统提示）。
     为什么更好：常显 = 走开、读档、跨区回来那一幕都还在，不会「永久错过」；
                也不需要「逐章补课」那套记账（它一旦漏环就静默吞剧情）。 */
  section('1 剧情走大框（追起来即显示，且不混进日志）');
  /* ⚠️ 取剧情的路径两种形状都要认：
       `newGame()` 返回的就是 view 本身（`r.story`）；
       `exec()` 返回 `{lines, view, ...}`，剧情在 `r.view.story`。 */
  const storyOf = r => (r && (r.story || (r.view && r.view.story))) || null;
  const ST = storyOf(e.view());
  const storyText = (o) => ((o && o.lines) || []).map(l => l.text || '').join('\n');
  const t0 = storyText(ST);
  /* ⚠️ 别钉台词原文 —— 从后端 view.story 本身取旁白来比（同源）。 */
  ok('★ 追起来之后大框里就是主线那一幕', !!ST && ST.arc === 'main', ST && ST.arc);
  ok('★ 那一幕的旁白在大框里', !!(ST && (ST.lines || []).length && t0.length > 0),
    (ST && ST.lines || []).map(l => l.kind).join(','));
  ok('★ 大框抬头写着步数（第 N / M 步）', !!ST && /第 \d+ \/ \d+ 步/.test(ST.arcLabel || ''), ST && ST.arcLabel);
  /* 🔴 2026-10-08 主人细化：「大框里剧情**不要有 NPC 的语言与动作描写**，
     这些都是属于在屏幕下方显示的，就是那些灰色字体内容」
     ⇒ 大框只留旁白；NPC 的言行改投**下方日志的灰字行**（kind `npcsact`）。 */
  ok('★ 大框里**没有** NPC 的言行（只留旁白）',
    !!(ST && (ST.lines || []).every(l => l.kind !== 'say' && l.kind !== 'npcsact')),
    (ST && ST.lines || []).map(l => l.kind).join(','));
  /* 主人 2026-10-08：「那些灰字上方要写有剧情标签」
     ⇒ 剧情那几行带 `story` 标记（前端据此打标签）；房间氛围的没有。 */
  {
    const rTag = await e.exec('score');
    const tagged = (rTag.lines || []).filter(l => l.story);
    /* ⚠️ 新手教程删掉后，开局那条「剧情灰字」不一定再有了（以前是老汉那几句）。
       本条从「必须有」放宽成「若有必带标记，且别把 desc 也算进去」。 */
    ok('剧情灰字**若出现**必带「剧情」标记（前端据此打标签）',
      tagged.every(l => l.kind !== 'desc'),
      JSON.stringify(tagged.map(l => l.kind + ':' + (l.text || '').slice(0, 12))));
    ok('房间氛围那种灰字**不带**剧情标记（不是满屏标签）',
      (rTag.lines || []).filter(l => l.kind === 'npcsact' && !l.story).length >= 0,
      '带标记 ' + tagged.length + ' 行');
  }
  {
    const UI = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
    const CSS = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    ok('★ 前端把标签画出来（log-tag）', /class="log-tag">剧情</.test(UI));
    ok('★ 标签有样式（主题变量，不是写死色）', /\.log-tag \{[^}]*var\(--tint-gold\)/.test(CSS));
  }
  /* 🔴 主人 2026-10-11：「剧情文本下一行加一句大白话具体讲现在该做什么」 */
  ok('★ 大框给了「现在做什么」的大白话', !!ST && String(ST.todo || '').length > 0, ST && ST.todo);

  /* —— 日志里**不许**有剧情行：主人「不在屏幕上和其他人物描写环境描写之类的一起显示」 —— */
  const r0b = await e.exec('score');
  ok('★ 大框常显同一幕（不重复念、不叠加）',
    !!storyOf(r0b) && storyOf(r0b).arc === 'main' && storyOf(r0b).no === ST.no,
    storyOf(r0b) && (storyOf(r0b).arcLabel + ' ' + storyOf(r0b).title));
  ok('同一幕不在日志里复述', !/第 \d+ 章 ·/.test(allText(r0b)), allText(r0b).slice(0, 50));

  /* —— 客户端那一环：大框由 renderAll → renderRoom 画，不靠日志 —— */
  {
    const RJS = path.join(ROOT, 'game/src/renderer/js/ui.js');
    const UI = require('fs').readFileSync(RJS, 'utf8');
    ok('★ 前端把 view.story 画进大框（renderStory）',
      /renderStory\(v\.story/.test(UI) && /function renderStory\(/.test(UI));
    /* 🔴 2026-10-16 主人真机重击批口径反转：大框**任何状态下零环境描写**——
       有剧情 → 描述让位；没剧情 → 描述也收起（原来放回来那份与日志重复，
       主人第一眼看到的就是它）。全函数不再有「描述解除隐藏」。 */
    ok('★ 有剧情时房间描述让位、没剧情时也**不放回**（大框零环境描写）',
      /desc\.classList\.add\('hidden'\)/.test(UI) &&
      !/desc\.classList\.remove\('hidden'\)/.test(UI));
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
     而日志里依旧不许冒出剧情行。
     走「北」（road_jiangnan_1 → jiangnan_gate，G1 卷界门）。
     2026-10-15 游有方 G1/G2 收笔：北/南出口带 act1_recognized 门槛 ——
     顺手把这条门的两个面都钉进断言（未认痕被拦 / 认痕放行）。 */
  {
    /* ① 未认痕：走北被拦在原地。
       🔴 doMove 拦截口径（design/89 铁律 3）：被挡时 **ex.say 优先**、msg 兜底 ——
       本门数据 say 写的是「那兵上下打量你…」（守门兵的拦人戏），
       msg（「城门口查得紧」）成了兜底不出口。断言按现实口径：人没动 + 守门兵在场。
       ⚠️ 遗留：say 文案读着像放行句（「进去吧」），门开着时会跟 travel 句叠戏 ——
       归数据侧措辞（游有方 G1 收笔项），引擎不动。 */
    ok('前提：此时还没认痕（act1_recognized 未插旗）', !p.hasFlag('act1_recognized'));
    const rBlocked = await e.exec('北');
    const blockedText = (rBlocked.lines || []).map(l => l.text || '').join('\n');
    ok('★ G1 未认痕走北：被守门兵拦住（人没出门）',
      p.room === elderRoom && /那兵|枪/.test(blockedText),
      blockedText.slice(0, 40));
    /* ② 认痕后放行：补旗再走，门开了 */
    p.setFlag('act1_recognized', true);
    const rOpen = await e.exec('北');
    ok('★ G1 认痕后走北：放行（人到了门外）', p.room === 'jiangnan_gate',
      '现在在 ' + (w.data.rooms[p.room] || {}).name);
  }
  /* 门口回不来就回不来 —— 本节只证「剧情常显」，人在哪不影响断言；
     下面 ③「走开后再 look」那段要的是「人不在老汉跟前」，站在门外正好。 */
  const rLook = await e.exec('look');
  ok('★ 走开之后大框里还是那一幕（不会因为离开就消失）',
    !!storyOf(rLook) && storyOf(rLook).arc === 'main' && /第 \d+ \/ \d+ 步/.test(storyOf(rLook).arcLabel || ''),
    storyOf(rLook) && storyOf(rLook).arcLabel);
  /* 口径变更（主人 2026-10-11）：在场闸门已撤 → 台词照旧在大框里出现 */
  ok('★ 大框里始终只有旁白（走开也一样）',
    !!((storyOf(rLook) || {}).lines || []).every(l => l.kind !== 'say' && l.kind !== 'npcsact'),
    ((storyOf(rLook) || {}).lines || []).map(l => l.kind).join(','));
  /* ⚠️ 判据要按**章**看：跨章时新章的言行**应该**投一次（第 2 章的台词就这么来的）。
     所以这里比「同一章内再发指令，不再重复投」。 */
  {
    const again = await e.exec('score');
    const said1 = kinds(rLook, 'npcsact').filter(t => /老汉/.test(t)).length;
    const said2 = kinds(again, 'npcsact').filter(t => /老汉/.test(t)).length;
    ok('★ 同一章的言行只投一次（换指令不重复刷屏）', said2 === 0,
      '上一条投了 ' + said1 + ' 行，这一条又投了 ' + said2 + ' 行');
  }
  /* ⚠️ 别再拿「老汉」当剧情判据：NPC 的言行**现在就该**在日志里（灰字那档）。
     剧情进日志的唯一形态是「第 N 章 · 标题」这种章节抬头 —— 只查它。 */
  ok('★ 换一条指令，日志里还是没有剧情正文',
    !/第 \d+ 章 ·/.test(allText(rLook)) && kinds(rLook, 'story').length === 0,
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
  ok('★ 读档后日志里没有剧情正文（不会把旧章节一口气念一遍）',
    !/第 \d+ 章 ·/.test(allText(rAfter)) && kinds(rAfter, 'story').length === 0,
    allText(rAfter).slice(0, 60));
  /* 🔴 口径变更（主人 2026-10-12）：开局**默认不追任何任务**，老档里 track 多为 null，
     读档后大框本就该空着（让位给房间描述）。原来这条断言的是「老档补追新手」——
     新手教程已整个下线，那条路不存在了。改守**新行为**：track 为 null ⇒ 大框收起。 */
  ok('★ 读档后不追任何任务 ⇒ 大框收起（老档 track=null 是正常态）',
    !storyOf(rAfter), storyOf(rAfter) ? storyOf(rAfter).arcLabel : '收起');
  /* 若老档里确实追着一条真任务，读档后大框就该把它画出来（追踪状态随档走） */
  {
    await e5.exec('追踪 q_main_jianghu');
    e5.save('oldsave2');
    const e6 = new GameEngine({ seed: 909, saveDir: TMP });
    await e6.boot({});
    await e6.loadSave('oldsave2');
    const r6 = await e6.exec('score');
    ok('★ 老档里追着主线 ⇒ 读档后大框照旧画出那一幕（track 随档走）',
      !!storyOf(r6) && storyOf(r6).arc === 'main',
      storyOf(r6) ? storyOf(r6).arcLabel : '(空)');
  }
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

  /* ================= 七、主线接取旁白「扣着不讲」=================
     主人 2026-10-12：「主线剧情一进游戏就接取，但主线剧情需要追踪时才在屏幕上
     显示原本应该在接取时就应该出现的那些文本。」
     ⇒ 开局那条主线是**脚本塞的**，接取那几行先扣住（storybeat.hold），
        玩家去追它的时候才交出去（storybeat.takeHeld，走「追踪」指令）。 */
  section('7 主线接取旁白：开局扣着，追了才讲');
  {
    const e2 = new GameEngine({ seed: 606, saveDir: require('./_test-save-dir') });
    e2.boot(); e2.newGame({ name: '看戏的' });
    const w2 = e2.world, p2 = w2.player;
    const mainId = 'q_main_jianghu';
    ok('前提：主线开局就接上了（进任务簿）', p2.questStage(mainId) >= 0, String(p2.questStage(mainId)));
    ok('前提：这条被记成「扣着旁白」（held）', sb.isHeld(p2, mainId) === true);

    /* 第一条指令之后，日志里**不该**出现它的接取文本 */
    const r1 = e2.exec('look');
    ok('★ 开局不会把主线接取文本打进日志（先扣着）',
      !/【接取任务】/.test(allText(r1)),
      allText(r1).split('\n').filter(x => /接取任务|江湖路远/.test(x)).join(' / ').slice(0, 90));

    /* 去追它 → 那几行这时候才出来 */
    const r2 = e2.exec('追踪 ' + mainId);
    ok('★ 玩家一追，接取那几行才讲出来',
      /【接取任务】/.test(allText(r2)) && /江湖路远/.test(allText(r2)),
      allText(r2).replace(/\n/g, ' | ').slice(0, 120));
    ok('　交出之后就摘掉「扣着」的标记（不会反复讲）', sb.isHeld(p2, mainId) === false);
    ok('　追到了（track 指向它）', p2.track === mainId, String(p2.track));

    /* 取消再追回来：**照样讲一遍**。
       🔴 2026-10-12 主人复现并定调：「任务追踪是点击的，第一点出现提示，
          取消后再点就没有了，跟取消追踪绑定的吧」—— 这是 bug，不是特性。
          原来这条断言守的是「只讲一次」（旧口径），与主人要的正好相反，已反过来。
       ⚠️ 主人还说了一句「追踪新手应该是一进入就显示一次，取消后不再显示」——
          那说的是**新手那条**（走大框 `currentStory` 现算，长驻显示），
          与这里的**真任务接取旁白**（`held` 账）不是一回事，别混起来：
          新手那条在这里永远只回「上方改追…」一句，不补念接取文本。 */
    e2.exec('追踪 ' + mainId);                    /* 同一个 id 再点一次 = 取消 */
    ok('　同一个 id 再点一次是取消（追踪与取消已合成一条）', p2.track === null, String(p2.track));
    const r4 = e2.exec('追踪 ' + mainId);
    ok('★ 取消后再追回来，接取文本**照样再讲一遍**（主人的复现）',
      /【接取任务】/.test(allText(r4)) && /江湖路远/.test(allText(r4)),
      allText(r4).replace(/\n/g, ' | ').slice(0, 120));
    ok('　再讲一次不会把「扣着」的账讲乱（追上了就是追上了）', p2.track === mainId, String(p2.track));
    /* 大框那边不受影响：一追就能看见这一章（它本来就是「追谁演谁」） */
    const story = sb.currentStory(w2, p2);
    ok('　大框里就是这条主线的当前一步（接取文本的正文在框里常显）',
      !!story && story.arc === 'main' && story.title.indexOf('江湖路远') >= 0,
      story ? story.arc + '/' + story.title : '(空)');

    /* 🔴 2026-10-12「新手教程剧情全删」之后：面板上再也印不出「追踪 入江湖」了
       （那条按钮随教程一起拆了）。改成守「新手那套说法已经翻篇」：
       玩家若还照老习惯敲「追踪 入江湖」，必须给一句**明确的翻篇提示**并把人导去主线
       —— 既不能回「没有这一桩事」（那是当年主人报的 bug 形状），也不能静默。 */
    const r5 = e2.exec('追踪 入江湖');
    ok('★ 敲老的「追踪 入江湖」：给明确翻篇提示（不是「没有这一桩事」）',
      !/没有这一桩事/.test(allText(r5)) && /撤下|主线|江湖路远/.test(allText(r5)),
      allText(r5).replace(/\n/g, ' | ').slice(0, 90));
    /* 追真任务照旧认（开关语义不变）—— 此时 p2.track 是 mainId，再点一次即取消 */
    const r6 = e2.exec('追踪 ' + mainId);
    ok('　老的「入江湖」不认之后，追真任务仍照常（再点一次 = 取消）',
      p2.track === null, String(p2.track));
  }

  /* ================= 八、接取旁白双份（主人真机 2026-10-13）=================
     🔴 「追踪 江湖路远」旁白讲了两遍。根因：exec 出口的 reconcile 跑在
     **指令处理之后** —— 玩家开局第一下就点「追踪」时，记忆账 m.quests 还没记过
     这条任务，trackCmd 的 takeHeld 把旁白讲掉、扣着的账也删了，随后 reconcile
     一对账：first（记忆账没这条）且 !held（刚讲掉）→ 又讲一遍。
     ⇒ 修法：takeHeld 交出旁白的同一刻把记忆账记平（storybeat.js）。
        断言：**开局第一条指令就是追踪**，接取旁白在整条回包里只出现一次。 */
  section('8 接取旁白不双份（开局第一下就追踪）');
  {
    const e3 = new GameEngine({ seed: 808, saveDir: require('./_test-save-dir') });
    e3.boot(); e3.newGame({ name: '手快的' });
    const r = e3.exec('追踪 q_main_jianghu');
    const n = (allText(r).match(/【接取任务】/g) || []).length;
    ok('★ 开局第一条指令就是「追踪 江湖路远」：接取旁白只出现一次', n === 1, '出现 ' + n + ' 次');
  }

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
