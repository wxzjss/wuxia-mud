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
/* （原 `finishTutorial` 随新手教程下线一并删除：教程整条没了，
   再没有「把新手那一程走完」这回事。老存档字段 tutorialFlags 仍归引擎管。） */

(async () => {
  console.log('==============================================');
  console.log('  任务追踪（大框显示哪一桩事）');
  console.log('==============================================');

  /* ---------- ① 开局：默认不追任何任务 ---------- */
  sec('① 开局默认不追踪（主人 2026-10-12 最终口径）');
  {
    const e = boot();
    const v = e.view();
    const p = e.world.player;
    /* 🔴 口径变更（主人 2026-10-12）：「屏幕上方那个大方框的默认为
       **没有追踪任何任务会显示的界面**」「初始主线任务回滚到第一个任务是
       加入一个门派（**默认不追踪**）」。
       —— 推翻 2026-10-08 那句「初始默认追踪新手剧情任务」。 */
    ok('★ 开局 p.track 为空（不追任何任务）', p.track === null, JSON.stringify(p.track));
    ok('★ 开局大框收起（view.story 为 null → 让位给房间描述）',
      storyOf(v) === null, JSON.stringify(storyOf(v)));
    ok('★ 面板据此画「没在追」的样子（view.track 为 null）', v.track === null, JSON.stringify(v.track));
    ok('★ 但新手剧情**照样在**（只是没显示）：随时能追起来',
      !!p && p.questStage('q_main_jianghu') !== undefined);
    /* 主人：「主线剧情依旧是开局就接这个不变，但**不会在屏幕下方显示**」 */
    const v0 = e.newGame({ name: '重开' });
    const storyLines = (v0.lines || []).filter(l => ['story', 'say', 'subtitle'].indexOf(l.kind) >= 0);
    ok('★ 主线不占屏幕下方（开局日志里没有剧情行）', storyLines.length === 0,
      storyLines.map(l => l.kind).join(',') || '干净');
    ok('★ 主线**照旧开局就接**（主人明确要求不变）', p.questStage('q_main_jianghu') !== undefined,
      'stage=' + p.questStage('q_main_jianghu'));
    /* 🔴 2026-10-12 口径再改（新手教程剧情全删）：主线**从第 0 步「拜入一个门派」起步**。
       不再有新手第 6 章替它办，所以第一幕就是拜师。 */
    ok('★ 第一幕就是拜入一个门派（stage 0）',
      p.questStage('q_main_jianghu') === 0, 'stage=' + p.questStage('q_main_jianghu'));
    /* 玩家主动追 → 大框才显示；这是「默认不追」的必要配套（否则永远看不见）。
       ⚠️ 原来这里追的是「新手」（`追踪 新手`）—— 教程下线后那个 id 不认了。
       改追**主线**，验的是同一件事：玩家主动追才显示。 */
    const r0 = await e.exec('追踪 q_main_jianghu');
    ok('★ 玩家主动追主线 → 大框才显示出来',
      e.world.player.track === 'q_main_jianghu' && !!storyOf(r0) && storyOf(r0).arc === 'main',
      storyOf(r0) && storyOf(r0).arcLabel);
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

  /* ---------- ③ 老存档 p.track=NEWBIE → 导流到主线（教程已下线） ---------- */
  sec('③ 老存档把 p.track 写成新手哨兵 → 自动导流到主线（不再回教程）');
  {
    const e = boot(8);
    const p = e.world.player;
    /* 🔴 2026-10-12 教程下线后：老存档里可能还留着 `p.track = NEWBIE`。
       新口径是 syncTrack ① 见到哨兵就**导流到 pickAuto（优先主线）**，
       绝不能又摸回已经被删掉的教程。 */
    p.track = sb.NEWBIE;
    const r = await e.exec('look');
    const s = storyOf(r);
    ok('★ 老存档的新手哨兵被导流到主线', p.track === 'q_main_jianghu', JSON.stringify(p.track));
    ok('★ 大框顺势变成主线那一幕（不是教程那一幕）',
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
    /* ★ 2026-10-12 主人：「把追踪与取消追踪合到一起吧」——
       两态现在发的是**同一条**指令（后端是开关）。 */
    ok('★ 两态发同一条指令「追踪 <id>」（后端当开关用）',
      /doCmd\('追踪 ' \+ id/.test(UI) && !/doCmd\(on \? '取消追踪'/.test(UI));
    ok('★ 点完重开任务面板（不然按钮还写着「追踪」）', /closeModal\(\);\s*\n\s*panel\('quests'\)/.test(UI));
    ok('大框画在房间面板里（renderRoom → renderStory）',
      /renderStory\(v\.story/.test(UI));
    ok('有剧情时房间描述让位', /desc\.classList\.add\('hidden'\)/.test(UI));
    /* 指令必须**真在后端**（不能只靠前端，纯文本客户端也要能用） */
    const CMD = require('fs').readFileSync(path.join(ROOT, 'game/src/core/commands.js'), 'utf8');
    ok('后端注册了 追踪 / 取消追踪（取消追踪是保留的兼容别名）',
      /'track', '追踪'/.test(CMD) && /'untrack', '取消追踪'/.test(CMD));
    /* ⚠️ 这两个词绝不能进 PANEL_CMDS —— 进去就变成「开面板」而不是真追踪 */
    ok('★ 「追踪」不在前端 PANEL_CMDS 里（否则会被吃成开面板）',
      !/追踪: '/.test(UI.split('PANEL_CMDS')[1] || ''));

    /* 🔴 2026-10-12 教程下线后：`__newbie__` 这个 id 已经**不认**了，
       后端会回一句「新手教程已经撤下了…」把人导去主线。
       这条改守**新行为**：发新手 id 不再当成一桩任务，而是给一句明确的翻篇提示
       （不能静默、不能又说「没有这一桩事」——那才是当年主人报的 bug 形状）。 */
    const e2 = new GameEngine({ seed: 4242, saveDir: SAVE_DIR });
    e2.boot(); e2.newGame({ name: '试剑', gender: 'male', identity: 'zhuangyuan' });
    const p2 = e2.world.player;
    ok('前提：开局不追任何任务', p2.track === null, String(p2.track));
    const r2 = e2.exec('追踪 __newbie__');
    ok('★ 发新手 id：给一句明确的「教程已撤下」提示（不是「没有这一桩事」）',
      (r2.lines || []).some(l => /撤下|主线|江湖路远/.test(l.text || ''))
      && !(r2.lines || []).some(l => /没有这一桩事/.test(l.text || '')),
      (r2.lines || []).map(l => l.text).join('|').slice(0, 80));
    /* 追真任务照旧能用（开关语义不变） */
    const r3 = e2.exec('追踪 q_main_jianghu');
    ok('★ 追真任务仍认（追踪 q_main_jianghu）', p2.track === 'q_main_jianghu', String(p2.track));
    const r4 = e2.exec('追踪 q_main_jianghu');
    ok('★ 同一个 id 再点一次就是取消（开关语义不变）', p2.track === null, String(p2.track));
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
    /* 🔴 2026-10-15 主人真机：大框里的灰字（kind plain）隐藏 ——
       「眼下这一步」与金字 story-todo 是同一句，藏而不删（藏=不进 HTML）。 */
    ok('★ 灰字 plain 行**不**进 HTML（主人：大框隐藏灰色环境描写）',
      /旁白一句/.test(h) && !/眼下这一步/.test(h), h.slice(0, 120));
    ok('「现在做什么」进 HTML（同一句由金字 todo 承担，零信息损失）',
      /现在做什么/.test(h) && /把功夫练起来/.test(h));
    ok('没有 undefined / NaN 漏进 HTML', !/undefined|NaN/.test(h), (h.match(/undefined|NaN/g) || []).join(','));
  }

  /* ---------- ⑨ 声望挂点双口径（2026-10-15 主人批准）----------
     quest def 级 repGainOnQuest（按案精确）+ NPC def 级去重旗 repgain_<questId>
     （同一案重复结算只加一次；不同案各结各的）。测试用运行时注入数据，不碰 game/data/。 */
  sec('⑨ repGainOnQuest 双口径');
  {
    const e = boot(99);
    const w = e.world, p = w.player;
    /* 运行时造两案一 NPC（内存注入，不落库） */
    w.data.quests.q_rep_t1 = { id: 'q_rep_t1', name: '声望试案一', type: '支线',
      stages: [{ desc: '办了它', next: 99 }], repGainOnQuest: { '华山派': 5 } };
    w.data.quests.q_rep_t2 = { id: 'q_rep_t2', name: '声望试案二', type: '支线',
      stages: [{ desc: '也办了它', next: 99 }] };
    w.data.npcs.npcv_rep = Object.assign({}, w.data.npcs[Object.keys(w.data.npcs)[0]], {
      id: 'npcv_rep', name: '声望委托人', quests: ['q_rep_t1', 'q_rep_t2'],
      repGainOnQuest: { '华山派': 30 },
    });
    p.quests.q_rep_t1 = 0; p.quests.q_rep_t2 = 0;

    w.spawnNpc('npcv_rep', p.room, 1, true);
    const before = p.reputation['华山派'] || 0;
    e.exec('交任务');                        /* 结第一案（q_rep_t1：quest 级 +5，NPC 级 +30） */
    const after1 = p.reputation['华山派'] || 0;
    ok('★ 案一收口：quest 级 +5 与 NPC 级 +30 叠加（+35）', after1 - before === 35,
      `${before}→${after1}`);
    ok('★ 去重旗插上（repgain_q_rep_t1）', p.hasFlag('repgain_q_rep_t1'));
    ok('　案二没被案一的旗吞（repgain_q_rep_t2 未插）', !p.hasFlag('repgain_q_rep_t2'));

    e.exec('交任务');                        /* 结第二案（无 quest 级；NPC 级去重旗按案独立 → 再 +30） */
    const after2 = p.reputation['华山派'] || 0;
    ok('★ 案二收口：NPC 级按案各结一次（再 +30，不是 0 也不是 4×30）', after2 - after1 === 30,
      `${after1}→${after2}`);

    /* 真实路径防重：两案都已 st=99，reportable 直接跳过 → 再交零加成、不报错 */
    const before3 = p.reputation['华山派'] || 0;
    e.exec('交任务');
    ok('★ 已交完的案（st=99）再交：零加成、不报错', (p.reputation['华山派'] || 0) - before3 === 0);
  }

  /* ---------- ⑩ design/82 声望禁令：交易路径零声望变动（2026-10-15 钉死）----------
     「声望只随事件涨跌、不随交易变化。」全库 10 处写点已逐归因（8 事件 + 2 授权 DSL），
     交易路径零写点 —— 这里钉成守卫：跑买卖全程，声望台账全键 diff 必须为零；
     再放一条 +rep 变异对照，证明断言真的在量（不是恒真）。 */
  sec('⑩ 声望禁令：交易不动声望');
  {
    const e = boot(98);
    const w = e.world, p = w.player;
    /* 运行时注入一个商贩（内存，不落库）：def.goods 走 buy/sell 的兜底货源 */
    w.data.items.mc_herb = { id: 'mc_herb', name: '测试草药', type: 'misc', value: 10 };
    w.data.npcs.npcv_shop = Object.assign({}, w.data.npcs[Object.keys(w.data.npcs)[0]], {
      id: 'npcv_shop', name: '声望药商', sect: '华山派',
      goods: [{ item: 'mc_herb', price: 15 }],
    });
    w.spawnNpc('npcv_shop', p.room, 1, true);
    p.money = 10000;
    w.giveItem(p, 'mc_herb', 3);

    const snap = () => JSON.stringify(p.reputation || {});
    const b1 = snap();
    e.exec('buy 测试草药');                     /* 买 */
    e.exec('buy 测试草药 x2');                  /* 连买 */
    e.exec('sell 测试草药');                    /* 卖 */
    e.exec('trade');                            /* 交易面板指令 */
    const b2 = snap();
    ok('★ buy×2 + sell + trade 全程：声望台账逐键为零变动', b1 === b2,
      b1 === b2 ? '(diff=0)' : `before=${b1} after=${b2}`);

    /* 变异对照：+rep 效果必须真的动台账 —— 证明上面那条不是恒真 */
    p.reputation.华山派 = p.reputation.华山派 || 0;
    const c1 = snap();
    e.exec('buy 测试草药');
    w.giveItem(p, 'mc_herb', 1);
    require(path.join(ROOT, 'game/src/core/modapi.js'))
      .evalEffects(['+rep:华山派:7'], { player: p, world: w });
    const c2 = snap();
    ok('　变异对照：+rep 效果动台账（断言在量）', c1 !== c2 && (JSON.parse(c2).华山派 - JSON.parse(c1).华山派) === 7);
  }

  console.log('\n==============================================');
  console.log('  任务追踪：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
