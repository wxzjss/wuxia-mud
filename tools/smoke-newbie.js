/**
 * smoke-newbie.js —— 入江湖（新手教程剧情线）+ 世界氛围 专项回归
 *
 * 守两件事（主人第五轮的全部要求）：
 *   §A 身份 → 势力：13 个身份各指一家不同的势力；山门房都真的存在；
 *      性别不合走备选；引荐信能破例（抹平 karma/悟性/等级，但**抹不平性别**）。
 *   §B 楔子：每个身份一版；结尾把玩家交给茶摊老汉（旧版讲完就断）；
 *      不出现「死」字；不剧透主线信物。
 *   §C 引荐信：talk 与 ask **同一个入口**、幂等；拜入后 tutPass 清空。
 *   §D「任务」面板置顶：没做完才置顶、首条、type=新手、**只给当前进度**。
 *   §E「新手教程」面板：看得到**完整流程**（每章都列），剧情只给已走/在走的。
 *   §F 场所环境音：16 类场所判定正确；私密房间不播；句库无重复且变体够多。
 *   §G NPC 游走：默认游走真的生效（数据里原先只有 1 个 NPC 会动）；
 *      三类消息（离开/走进/路过）都出得来、限量、只走平面八向、
 *      有铺子的与数据钉住的 NPC 不动。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const T = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));
const amb = require(path.join(ROOT, 'game', 'src', 'core', 'ambience.js'));
const pools = require(path.join(ROOT, 'game', 'src', 'core', 'ambient-pools.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}
function sec(t) { console.log('\n§ ' + t); }
const txt = a => (a || []).map(x => String(x.text || '')).join(' | ');

function boot(seed, birth, gender) {
  const e = new GameEngine({ seed: seed || 20261101, saveDir: SAVE_DIR });
  e.boot();
  /* ⚠️ 同上：与性别强绑定的身份（庵堂孤儿→峨眉 等）现在由后端硬校验，
     不传 gender 就默认 male 会在女身身份上抛错。**按身份数据里的 gender 走**。 */
  const bd = (((e.world.data || {}).meta || {}).births || {})[birth || 'orphan'] || {};
  e.newGame({ name: '试侠', gender: gender || bd.gender || 'male', birth: birth || 'orphan' });
  return e;
}
const SECT_NAME = (w, id) => ((w.data.sects[id] || {}).name || id);

/* ================================================================
 * §A 身份 → 势力
 * ================================================================ */
sec('§A 13 个身份，各指一家不同的势力');
{
  const e = boot(101);
  const w = e.world;
  const births = Object.keys(w.data.meta.births);
  ok('A-1 身份数 ≥ 12（原 6 个，本批扩到 13）', births.length >= 12, births.length + ' 个');

  const firsts = {};
  const bad = [];
  for (const b of births) {
    const chain = T.BIRTH_SECT[b];
    if (!chain || !chain.length) { bad.push(b + '(无映射)'); continue; }
    if (firsts[chain[0]]) bad.push(b + ' 与 ' + firsts[chain[0]] + ' 撞车(' + chain[0] + ')');
    firsts[chain[0]] = b;
    if (!w.getSect(chain[0])) bad.push(b + ' → 不存在的势力 ' + chain[0]);
  }
  ok('A-2 ★ 每个身份都有映射，且首选势力**互不相同**', bad.length === 0, bad.join('；') || '全部唯一');
  ok('A-3 ★ 覆盖了 13 家势力（14 家里只剩侠客岛，level≥30 属后期发现）',
    Object.keys(firsts).length === births.length,
    Object.keys(firsts).length + ' 家：' + Object.keys(firsts).join(','));

  /* 山门房必须真存在（写错一个字母 → 引路指到虚空，且不报错） */
  const noGate = [];
  for (const b of births) {
    const id = T.BIRTH_SECT[b][0];
    const g = T.SECT_GATE[id];
    if (!g || !w.getRoom(g)) noGate.push(id + '→' + g);
  }
  ok('A-4 ★ 每家势力的山门房都真实存在', noGate.length === 0, noGate.join('；') || '全通');

  /* 性别不合 → 两条不同的通路，别混为一谈：
     ① **身份本身带性别门槛**（庵堂孤儿/守墓人之后只收女、山门弃婴只收男）
        ⇒ 后端 `World.createPlayer` **直接拒绝**（前端还会把这些身份藏起来）;
     ② **身份没门槛、但它对应的势力有性别要求**（如武学世家→华山只收男）
        ⇒ 照常开局，只是 `targetSectFor` **顺备选链**改去别派（引荐信不抹平性别门槛）。 */
  {
    const em = boot(102, 'nun_ward', 'female');
    ok('A-5 庵堂孤儿（女）→ 峨眉派', T.targetSectFor(em.world.player).id === 'emei',
      T.targetSectFor(em.world.player).name);
    /* ⚠️ 契约更新（2026-10-10）：原先这里是「男身庵堂孤儿能开局、引导顺备选去别派」。
       主人要求把这条路**堵死**（男性进不了峨眉，且剧情只有女性这一条线），
       所以现在是**硬拒绝** —— 老断言守的是被废弃的旧契约。 */
    let threw = '';
    try { boot(103, 'nun_ward', 'male'); } catch (err) { threw = String(err && err.message || err); }
    ok('A-6 ★ 庵堂孤儿（男）被后端直接拒绝开局（不再「偷偷改口去别派」）',
      /只收女儿身/.test(threw), threw || '(竟然开局成功了)');
    /* 反向对照：女身不该被拒（否则是「一刀切全拒」） */
    let okF = true;
    try { boot(1031, 'nun_ward', 'female'); } catch (e) { okF = false; }
    ok('A-6b 反向对照：女身庵堂孤儿正常开局', okF);
  }
  {
    const m = boot(104, 'wuxue', 'male');
    const f = boot(105, 'wuxue', 'female');
    ok('A-7 武学世家（男）→ 华山派', T.targetSectFor(m.world.player).id === 'huashan');
    /* ⚠️ 2026-10-08 门派性别门槛核对后改了这里：华山派原来设了「只收男」，
       女身的武学世家只能顺延到备选（武当）。可**岳灵珊就是华山女弟子**——
       那道门槛是错的，已去掉。于是女身现在直接进华山，不再需要备选。
       （这条断言的旧版本守的是「备选链真的会跳」，那个机制本身还在，
         由 A-6 庵堂孤儿那条继续守着。） */
    ok('A-8 武学世家（女）→ 华山（性别门槛已按原著去掉）', T.targetSectFor(f.world.player).id === 'huashan',
      T.targetSectFor(f.world.player).name);
  }
}

/* ================================================================
 * §B 楔子（每个身份一版 + 交接给老汉）
 * ================================================================ */
sec('§B 楔子：13 个身份各一版，结尾交给茶摊老汉');
{
  const e = boot(106);
  const w = e.world;
  const births = Object.keys(w.data.meta.births);
  const missing = [], noHand = [], badWord = [];
  for (const b of births) {
    if (!T.INTRO_VARIANTS[b]) missing.push(b);
    const it = T.introFor({ birth: b, tutorialFlags: [] }, []);
    /* 「楼里新来的」（主人 2026-10-11 加的女身）不走茶摊那段收束 ——
       她人就在醉春楼开局，楔子讲的是楼里的事（`introFor` 里 handoff:false）。 */
    if (b === 'brothel_sold') { /* 只验有楔子，不验收束 */ }
    else if (!it.show || !/卖茶的小摊/.test(it.body)) noHand.push(b);
    /* 铁律：说玩家**自己**死掉是不许的（昏倒语义）。
       ⚠️ 别写成「出现『死』字就判红」—— 数据里 71 处有「死」
       （活死人墓 / 生死 / 死死盯着 / 雪把羊压死了），那是正常中文。
       smoke-round3 守的也是「饿昏那条输出里没有『你死了』」，同一条口径。 */
    if (/你[^。！？]{0,12}死|死[^。！？]{0,8}你/.test(it.body)) badWord.push(b + '(说玩家自己死了)');
    /* 不剧透主线第一幕信物 */
    if (/东厂铜牌|失忆/.test(it.body)) badWord.push(b + '(剧透)');
  }
  ok('B-1 ★ 每个身份都有自己那一版楔子', missing.length === 0, missing.join(',') || births.length + ' 版');
  ok('B-2 ★ 每版结尾都落到「茶摊老汉叫住你」（旧版讲完就断了）',
    noHand.length === 0, noHand.join(',') || '全通');
  ok('B-3 ★ 楔子不说玩家自己死掉，也不剧透主线信物', badWord.length === 0, badWord.join(',') || '干净');

  const it = T.introFor({ birth: 'orphan', tutorialFlags: [] }, []);
  ok('B-4 楔子标题仍带「楔子」，正文含老槐树（旧断言不能破）',
    /楔子/.test(it.title) && /老槐树/.test(it.body), it.title);
  ok('B-5 看过之后不再弹（seen_intro）',
    T.introFor({ birth: 'orphan', tutorialFlags: ['seen_intro'] }, ['seen_intro']).show === false);
}

/* ================================================================
 * §C 引荐信
 * ================================================================ */
sec('§C 引荐信：同一个入口、幂等、能破例');
{
  /* 挑一个**靠硬门槛进不去**的：官宦子弟 → 大理段氏（require karma≥20，开局 0） */
  const e = boot(107, 'noble');
  const w = e.world, p = w.player;
  ok('C-0 前提：大理段氏确实有门槛（karma≥20），开局不满足',
    !!(w.data.sects.dali.require && w.data.sects.dali.require.karma) && (p.karma || 0) < 20,
    'karma=' + p.karma);

  const j0 = e.exec('拜师 大理段氏');
  ok('C-1 没有引荐信时，拜不进去（门槛是真的）', p.sect !== 'dali',
    txt(j0.lines).slice(0, 60));

  const talk = e.exec('talk 卖茶的老汉');
  ok('C-2 ★ 跟老汉搭话 → 拿到引荐信', !!p.hasItem('letter_intro'), txt(talk.lines).slice(0, 90));
  ok('C-3 ★ 同时记下 tutPass（凭信破例的凭据）', p.vars.tutPass === 'dali', String(p.vars.tutPass));
  ok('C-4 老汉在台词里**点名**了该去哪座山门',
    /大理·天龙寺/.test(txt(talk.lines)) && /大理段氏/.test(txt(talk.lines)),
    txt(talk.lines).slice(0, 140));
  ok('C-5 再搭话不会重复给（幂等）',
    e.exec('talk 卖茶的老汉').lines.filter(l => /获得：引荐信/.test(l.text || '')).length === 0);

  const j1 = e.exec('拜师 大理段氏');
  ok('C-6 ★ 凭引荐信破例拜入', p.sect === 'dali', txt(j1.lines).slice(0, 80));
  ok('C-7 入门后 tutPass 清空（不能拿它去破第二家的例）', !p.vars.tutPass, String(p.vars.tutPass));
  /* ⚠️ 用 /破.{0,2}例/ 而不是 /破例/ —— 正文是「山门为你**破了例**」，
     「破例」两个字中间夹了个「了」，写死成 /破例/ 会假红（实测）。 */
  ok('C-8 破了例这件事**明说**给玩家（不静默）', /破.{0,2}例/.test(txt(j1.lines)), txt(j1.lines).slice(0, 70));

  /* ask 那条路也要给信（两处入口同一实现） */
  const e2 = boot(108, 'noble');
  e2.exec('ask 卖茶的老汉 about 门派');
  ok('C-9 ★ 用「询问」也行（talk 与 ask 同一入口，不是各写一遍）',
    !!e2.world.player.hasItem('letter_intro'), 'tutPass=' + e2.world.player.vars.tutPass);
}

/* ================================================================
 * §D「任务」面板置顶
 * ================================================================ */
sec('§D 「任务」面板：新手教程没做完就置顶，且只给当前进度');
{
  const e = boot(109, 'orphan');
  const w = e.world, p = w.player;
  const v = e.view();
  const first = (v.quests.active || [])[0];
  ok('D-1 ★ 首条就是新手教程', !!(first && first.isTutorial), first ? first.name : '(空)');
  ok('D-2 ★ 类型是「新手」（面板里排在最前）', first && first.type === '新手', first && first.type);
  ok('D-3 ★ 只给**当前**这一章（不是把八章全铺开）',
    /* ⚠️ 这里原来钉的是第一章台词里的「茶摊的老汉」四个字。
       主人 2026-10-11 让重写新手剧情，那句话被改写 ⇒ 代理判据跟着假红。
       钉**台词原文**（从 tutorial.STEPS 取，与实现同源），别再钉某个句子里的词。 */
    !!(first && first.chapter === 1 && first.stageDesc
      && first.stageDesc.indexOf(((T.STEPS.find(s => s.id === 'look') || {}).say || '')) >= 0),
    first ? ('第' + first.chapter + '章 ' + first.chapterTitle) : '-');
  ok('D-4 带进度（cur/count）', !!(first && typeof first.cur === 'number' && first.count >= 8),
    first ? first.cur + '/' + first.count : '-');
  ok('D-5 带去处（由身份定的那家势力）', !!(first && first.targetSect), first && first.targetSect);
  ok('D-6 章次随进度走（走完第一步 → 第 2 章）',
    (() => {
      e.exec('look');
      const f2 = (e.view().quests.active || [])[0];
      return f2 && f2.chapter === 2;
    })(), 'look 之后应为第2章');

  /* 做完就不再置顶 */
  const e3 = boot(110, 'orphan');
  const p3 = e3.world.player;
  ['did_look', 'did_move', 'did_train', 'did_talk', 'did_accept', 'did_save'].forEach(f => e3.markTutorialFlag(f));
  p3.kills = 1;
  e3.exec('talk 卖茶的老汉');
  e3.exec('拜师 ' + T.targetSectFor(p3).name);
  const f3 = (e3.view().quests.active || []).filter(q => q.isTutorial);
  ok('D-7 ★ 走完（拜师+存档）后不再置顶', p3.sect && f3.length === 0,
    'sect=' + p3.sect + ' 新手条数=' + f3.length);
}

/* ================================================================
 * §E「新手教程」面板看完整流程
 * ================================================================ */
sec('§E 「新手教程」面板：完整流程 + 当前章的剧情');
{
  const e = boot(111, 'deserter_child');
  const g = e.view().guide;
  ok('E-1 ★ 面板拿得到「去哪个势力」', !!(g.story && g.story.target && g.story.target.name),
    g.story && g.story.target && g.story.target.name);
  ok('E-2 ★ 八章**全都列出来**（这是「完整流程」和「任务」面板的区别）',
    (g.steps || []).filter(s => s.id !== 'free').length === 8,
    (g.steps || []).length + ' 项');
  ok('E-3 每章都带标题与目标（后面的章节也知道要干嘛）',
    (g.steps || []).filter(s => s.id !== 'free').every(s => s.title && s.goal));
  const withStory = (g.steps || []).filter(s => s.story);
  ok('E-4 ★ 剧情旁白只给「已走 / 在走」的章节（后面几章不剧透）',
    withStory.length >= 1 && withStory.every(s => s.done || (g.current && g.current.id === s.id)),
    withStory.map(s => s.id).join(',') || '(无)');
  ok('E-5 当前章带 hint（告诉玩家敲什么）', !!(g.current && g.current.hint), g.current && g.current.hint);
  ok('E-6 章次编号连续 1..8', (() => {
    const nos = (g.steps || []).filter(s => s.id !== 'free').map(s => s.no);
    return nos.join(',') === '1,2,3,4,5,6,7,8';
  })(), (g.steps || []).filter(s => s.id !== 'free').map(s => s.no).join(','));
  ok('E-7 面板数据与「任务」面板同源（同一份 guide 算出来）',
    (() => {
      const f = (e.view().quests.active || [])[0];
      return f && f.chapter === g.current.no && f.chapterTitle === g.current.title;
    })());
  /* ★ 模板位必须**全被填掉**：章节里的 {sect}/{gate}/{art} 是运行时替换的，
     漏一个玩家就会看到「往{gate}去」。smoke-quest-sanity 查的是源码（会放行这几个
     已知模板位），这里查**成品** —— 两道一起才守得住。 */
  ok('E-8 ★ 送到前端的文案里一个花括号都不剩（模板位全填上了）',
    !/\{[^}\n]{1,20}\}/.test(JSON.stringify({ steps: g.steps, cur: g.current, target: g.story.target })),
    (JSON.stringify({ steps: g.steps, cur: g.current }).match(/\{[^}\n]{1,20}\}/) || ['(无)'])[0]);
}

/* ================================================================
 * §F 场所环境音
 * ================================================================ */
sec('§F 场所环境音：16 类场所 + 私密房不播 + 变体够多');
{
  const e = boot(112);
  const w = e.world;
  const cases = [
    ['jiangnan_brothel', 'brothel'],
    ['shaolin_daxiong', 'temple'],
    ['wudang_shanmen', 'taoist'],
    ['jn_gambling_house', 'gambling'],
    ['jiangnan_inn', 'inn'],
    ['jiangnan_market', 'market'],
    ['road_jiangnan_1', 'street'],
  ];
  const wrong = [];
  for (const [rid, want] of cases) {
    const r = w.getRoom(rid);
    if (!r) { wrong.push(rid + '(房不存在)'); continue; }
    const got = amb.placeOf(w, r);
    if (got !== want) wrong.push(rid + '→' + got + '(期望 ' + want + ')');
  }
  ok('F-1 ★ 七处抽样场所判定全对', wrong.length === 0, wrong.join('；') || '全对');

  ok('F-2 ★ 赌坊房真的存在（原来一间都没有 —— 环境音永远播不出来）',
    !!w.getRoom('jn_gambling_house'), (w.getRoom('jn_gambling_house') || {}).name);
  ok('F-3 寺与道观分得开（少林→temple，武当→taoist）',
    amb.placeOf(w, w.getRoom('shaolin_daxiong')) === 'temple'
    && amb.placeOf(w, w.getRoom('wudang_shanmen')) === 'taoist');

  /* 私密房间不播。
     ⚠️ 测例必须挑**同时命中场所规则、又命中私密规则**的房间：
        「某家·卧房」判定不出场所，`ambientLine` 本来就会返回 null ——
         那样测的是「场所判定」，私密规则删掉了照样绿（变异实测漏抓过）。 */
  const quiet = amb.ambientLine(w, { id: 'x', name: '怡红院·暗室', desc: '' });
  ok('F-4 ★ 私密房间不播环境音（暗室/卧房里念经就出戏了）', quiet === null, JSON.stringify(quiet));
  /* 反向对照：同一个场所的**正常**房间必须播 —— 否则上面那条可能是别的原因绿的 */
  const loud = amb.ambientLine(w, { id: 'x', name: '怡红院·花厅', desc: '' });
  ok('F-4b ★ 对照：同场所的正常房间照播（证明上面那条是私密规则拦下的）',
    !!(loud && loud.text), loud ? loud.text : '(也没播 → 上面那条不算数)');

  /* 句库体检 */
  const PL = pools.PLACE_LINES, MV = pools.MOVE_LINES;
  const need = ['brothel', 'temple', 'taoist', 'gambling', 'inn', 'tavern', 'market', 'yamen',
    'dock', 'mountain', 'sect', 'pharmacy', 'smithy', 'school', 'farm', 'street'];
  ok('F-5 ★ 16 类场所句库齐全，每类 ≥10 条', need.every(k => Array.isArray(PL[k]) && PL[k].length >= 10),
    need.map(k => k + ':' + ((PL[k] || []).length)).join(' '));
  ok('F-6 ★ 每类内部无重复句（重复就是「视觉疲劳」的源头）',
    need.every(k => new Set(PL[k]).size === PL[k].length));
  ok('F-7 ★ 走动三类各 ≥12 条变体',
    ['leave', 'arrive', 'passby'].every(k => Array.isArray(MV[k]) && MV[k].length >= 12),
    Object.keys(MV).map(k => k + ':' + MV[k].length).join(' '));
  ok('F-8 走动消息只允许 {who}/{dir}/{place} 三个占位符',
    /^\{who\}/.test(MV.leave[0]) && (() => {
      const all = JSON.stringify(MV);
      return !/\{[a-z]+\}/.test(all.replace(/\{who\}|\{dir\}|\{place\}/g, ''));
    })());
  ok('F-9 客栈专用那几条确实在原池子里（不然过滤就过滤了个空）',
    (pools.ARRIVE_INN_ONLY || []).length > 0 && pools.ARRIVE_INN_ONLY.every(s => MV.arrive.indexOf(s) >= 0),
    (pools.ARRIVE_INN_ONLY || []).length + ' 条');

  /* 抽 40 次看变体 */
  const got = new Set();
  for (let i = 0; i < 40; i++) { const l = amb.ambientLine(w, w.getRoom('jiangnan_brothel')); if (l) got.add(l.text); }
  ok('F-10 ★ 连抽 40 次，青楼环境音不重样（≥5 种）', got.size >= 5, got.size + ' 种');
}

/* ================================================================
 * §G NPC 游走
 * ================================================================ */
sec('§G NPC 游走：默认生效、三类消息、限量、只走八向');
{
  const e = boot(113);
  const w = e.world;
  w.player.room = 'jiangnan_market';
  amb.ensureNearbyNpcs(w, 1);
  const inst = Object.values(w.instances.npcs);
  ok('G-1 ★ 默认游走真的生效（数据里原本只有山贼 1 个会动）',
    inst.filter(n => n.wander).length >= 5,
    inst.filter(n => n.wander).length + ' / ' + inst.length + ' 个实例会走');
  ok('G-2 ★ 有铺子的 NPC 不走（摊主一走，「看看货物」就点不着了）',
    inst.filter(n => n.wander && (n.def || {}).shop).length === 0);
  ok('G-3 ★ 发引荐信的老汉被数据钉住（noWander），不会走开',
    !inst.filter(n => n.defId === 'guide_teaman' && n.wander).length);

  /* 三类消息都能出 */
  const inRoom = inst.filter(n => n.room === 'jiangnan_market');
  const outRoom = inst.filter(n => n.room !== 'jiangnan_market');
  const mk = (n, from, to) => ({ npc: n, from, to });
  const dirs = Object.keys(w.getRoom('jiangnan_market').exits || {});
  const aDir = dirs[0], aTid = w.getRoom('jiangnan_market').exits[aDir];
  const leaveL = inRoom.length ? amb.wanderLines(w, [mk(inRoom[0], 'jiangnan_market', aTid)]) : [];
  /* ⚠️ 别拿「去了/走了」这种自拟关键词去套句库 —— 句库里是「已经隐进了南的天色里」
     这种写法，套不上就假红。正确判据：**出来了、且提到那个人**（内容对不对交给句库自检）。 */
  ok('G-4 ★ 「离开」那条出得来', leaveL.length > 0 && leaveL[0].who === inRoom[0].name,
    (leaveL[0] || {}).text || '-');
  const arriveL = outRoom.length ? amb.wanderLines(w, [mk(outRoom[0], outRoom[0].room, 'jiangnan_market')]) : [];
  ok('G-5 ★ 「走进来」那条出得来', arriveL.length > 0, (arriveL[0] || {}).text || '-');
  /* 路过：隔壁两间之间移动 */
  const nb = dirs.map(d => (typeof w.getRoom('jiangnan_market').exits[d] === 'string'
    ? w.getRoom('jiangnan_market').exits[d] : (w.getRoom('jiangnan_market').exits[d] || {}).to))
    .filter(x => x && w.getRoom(x));
  let passL = [];
  if (nb.length >= 2 && outRoom.length) {
    passL = amb.wanderLines(w, [mk(outRoom[0], nb[0], nb[1])]);
  }
  ok('G-6 ★ 「打身边经过」那条出得来（两边都在隔壁、不进玩家的屋）',
    passL.length > 0, (passL[0] || {}).text || '（没造出场景）');

  /* 限量。
     ⚠️ 断言要拿**字面量 3** 比，不能拿 `amb.MAX_PER_TICK` 自己比自己 ——
       把常量改成 999，`length <= MAX_PER_TICK` 照样成立（变异实测漏抓过）。
       另立一条钉住常量本身，两条一起才守得住「一次最多 3 条」。 */
  const many = inst.slice(0, 20).map(n => mk(n, 'jiangnan_market', aTid));
  const manyNames = new Set(many.map(e => e.npc.name)).size;
  const capped = amb.wanderLines(w, many);
  ok('G-7 ★ 一次**最多 3 条**（不然整城几百号人会把日志刷烂）',
    capped.length <= 3, capped.length + ' 条（输入有 ' + manyNames + ' 个不同的人）');
  ok('G-7b 常量 MAX_PER_TICK 就是 3（与上面那条字面量对齐）',
    amb.MAX_PER_TICK === 3, String(amb.MAX_PER_TICK));
  ok('G-7c 测例非平凡：输入确实有 4 个以上不同的人可播（否则限量断言空转）',
    manyNames >= 4, manyNames + ' 人');
  ok('G-8 同一个人在一条里只播一次',
    new Set(capped.map(l => l.who)).size === capped.length);

  /* 真跑一段，看世界里自然冒出来 */
  const seen = [];
  const origEmit = w.emit.bind(w);
  w.emit = function (ev, payload) {
    if (ev === 'storyline' && payload && payload.line && payload.line.kind === 'ambient') seen.push(payload.line.text);
    return origEmit(ev, payload);
  };
  for (let i = 0; i < 600; i++) e.exec('look');
  w.emit = origEmit;
  ok('G-9 ★ 连续推进时间，世界里真的会自然冒出走动消息', seen.length >= 5, seen.length + ' 条');
  ok('G-10 ★ 而且不重样（句子池够大）', new Set(seen).size >= Math.min(5, seen.length),
    new Set(seen).size + ' 种 / ' + seen.length + ' 条');
  ok('G-11 ★ 不会播「往上去 / 往里去了」这种（只走平面八向）',
    !/往[上下内外]去了|往[上下内外]走/.test(seen.join(' ')),
    (seen.find(s => /往[上下内外]/.test(s)) || '(没有)'));
}

console.log('\n' + '='.repeat(48));
console.log(`  入江湖 + 世界氛围 专项：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
