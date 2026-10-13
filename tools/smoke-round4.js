/**
 * smoke-round4.js —— 第四轮（主人亲报三条）后端专项回归
 *
 *  §P 日志里点 NPC 名也该能开「详情面板」
 *      —— 根因：详情面板只挂在**前端场景栏卡片**那条入口上，
 *         而玩家实际习惯在**日志里点 NPC 名**（走后端 hl 的动作表），
 *         那份表第一项是 `{label:'看看', cmd:'look …'}`，只打一段文字。
 *  §G 送礼：「送他东西」面板要列物品**含金钱**、点击赠送、显示**已送多少**
 *      —— 顺带修掉前端发 `give_money <钱> to <人>` 而后端只认反序的**半坏按钮**。
 *  §A 房间「此地可做」的目标必须真实存在（主人报的回春堂老郎中/药柜）
 *      —— 全量守卫在 `tools/actions-check.js`（真执行 320 房 127 条），
 *         这里只留主人亲报那两处的**具体**断言。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}
function section(t) { console.log('\n' + t); }
const boot = (seed) => {
  const e = new GameEngine({ seed: seed || 20261013, saveDir: SAVE_DIR });
  e.boot(); e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
};
const txt = a => (a || []).map(x => String(x.text || '')).join(' | ');

/* ================================================================
 * §P 日志里点 NPC → 第一项就是「细看此人（开面板）」
 * ================================================================ */
section('§P 日志高亮菜单：第一项必须是「细看此人」且带真实例 id');
{
  const e = boot(21);
  const w = e.world, p = w.player;
  const v = e.view();
  const someone = (v.npcs || [])[0];
  ok('P-0 前提：出生房有人（否则本组无意义）', !!someone, someone && someone.name);

  const look = e.exec('look');
  const npcLine = (look.lines || []).find(l => l.kind === 'npcs' && Array.isArray(l.hl) && l.hl.length);
  ok('P-1 「这里有：」那一行带可点高亮', !!npcLine, npcLine ? npcLine.text.slice(0, 30) : '(没有)');

  const h = npcLine && npcLine.hl.find(x => x.type === 'npc');
  ok('P-2 高亮项是 npc 类型且带 actions 表', !!(h && h.actions && h.actions.length), h ? h.actions.map(a => a.label).join('、') : '-');

  const first = h && h.actions[0];
  ok('P-3 ★ 动作表**第一项**就是「细看此人」（主人点的那个按钮）',
    !!(first && /细看此人/.test(first.label || '')), first ? first.label : '(空)');
  ok('P-4 ★ 该项带 `act:"profile"`（前端靠它开面板，而不是退回 look 文本流）',
    !!(first && first.act === 'profile'), first ? JSON.stringify({ act: first.act, uid: first.uid }) : '-');
  ok('P-5 ★ 该项带**真实例 id**（不是文本名 —— 文本名会被重名/称谓坑）',
    !!(first && first.uid && /^npc_/.test(first.uid)), first ? String(first.uid) : '-');

  /* 端到端：拿 hl 给的 uid 去查画像，必须查到同一个人 */
  if (first && first.uid) {
    const pr = e.npcProfileOf(first.uid);
    ok('P-6 ★ 用 hl 给的 uid 真能查到这个人（端到端，uid 错了立刻暴露）',
      !!(pr && pr.name === someone.name), pr ? pr.name : '(查不到)');
  }
  ok('P-7 文本流的「打量」还在（两样都留，谁也不会丢）',
    !!(h && h.actions.some(a => /打量/.test(a.label || '') && /^look /.test(a.cmd || ''))),
    h ? h.actions.map(a => a.label).join('、') : '-');

  /* 倒地那张表同样处理 */
  {
    const foe = w.spawnNpc('mob_bandit', p.room, 1, true);
    foe.hp = 1;
    w.onNpcDown(foe, null);
    const l2 = e.exec('look');
    const dl = (l2.lines || []).find(l => l.kind === 'npcs' && /躺着/.test(l.text || ''));
    const dh = dl && dl.hl && dl.hl[0];
    ok('P-8 ★ 倒在地上的人，动作表第一项也是「细看此人」+ 真 uid',
      !!(dh && /细看此人/.test(dh.actions[0].label || '') && dh.actions[0].act === 'profile' && dh.actions[0].uid),
      dh ? JSON.stringify(dh.actions.slice(0, 2).map(a => a.label)) : '(没找到倒地行)');
  }
}

/* ================================================================
 * §G 送礼：给钱两种格式 + 往来记账 + 面板要的数据
 * ================================================================ */
section('§G 送礼：金钱与物品都能送，且记得住「送过多少」');
{
  const e = boot(22);
  const w = e.world, p = w.player;
  const who = e.view().npcs[0];
  const inst = w.npcsIncludingTemplates(p.room).find(n => n.name === who.name);
  const money0 = p.money = 1000;

  /* --- G-1 给钱：两种写法都要通 --- */
  const a1 = e.exec('give_money ' + who.name + ' 100');          /* 后端签名（前端改后用的） */
  ok('G-1 给钱：`give_money <人名> <钱数>` 通', /100 文/.test(txt(a1.lines)), txt(a1.lines).slice(0, 50));
  const a2 = e.exec('give_money 100 to ' + who.name);            /* 前端老格式（主人点坏按钮发的那种） */
  ok('G-1b ★ 给钱：`give_money <钱数> to <人名>` 也通（老格式/老档/模板都还在用）',
    /100 文/.test(txt(a2.lines)), txt(a2.lines).slice(0, 60));
  ok('G-1c 两次都真扣了钱（1000 - 200 = 800）', p.money === 800, 'money=' + p.money);

  /* --- G-2 记账 --- */
  ok('G-2 ★ 银钱往来记在 pstate.gifts 上（面板要显示「给了多少」）',
    !!(inst.pstate.gifts && inst.pstate.gifts.money === 200 && inst.pstate.gifts.count === 2),
    JSON.stringify(inst.pstate.gifts));

  p.inventory.push({ id: 'steamed_bun', uid: 'gift_u1', count: 3 });
  const bun = w.getItem('steamed_bun');
  e.exec('give ' + bun.name + ' to ' + who.name);
  ok('G-2b ★ 物品往来也记（含「这件送过几次」）',
    !!(inst.pstate.gifts.items[bun.name] === 1 && inst.pstate.gifts.count === 3),
    JSON.stringify(inst.pstate.gifts.items) + ' count=' + inst.pstate.gifts.count);

  /* --- G-3 面板数据：view 里带得出去 --- */
  const v2 = e.view();
  const n2 = (v2.npcs || []).find(x => x.name === who.name);
  ok('G-3 ★ `view().npcs[]` 带 gifts（面板不用额外请求就能显示「已送多少」）',
    !!(n2 && n2.gifts && n2.gifts.count === 3 && n2.gifts.money === 200),
    n2 ? JSON.stringify(n2.gifts) : '-');
  ok('G-3b 详情面板的 relation 也带同一份往来（两处说得一样）',
    (() => { const pr = e.npcProfileOf(n2.id); return !!(pr && pr.relation.gifts && pr.relation.gifts.count === 3); })(),
    (() => { const pr = e.npcProfileOf(n2.id); return pr ? JSON.stringify(pr.relation.gifts) : '-'; })());

  /* --- G-4 往来随档 --- */
  const sd = JSON.parse(JSON.stringify(w.serialize({})));
  const e4 = new GameEngine({ seed: 22, saveDir: SAVE_DIR });
  e4.boot(); e4.world.deserialize(sd);
  const back = Object.values(e4.world.instances.npcs).find(x => x.defId === inst.defId);
  ok('G-4 ★ 往来随档保存（读档后「已送多少」还在）',
    !!(back && back.pstate && back.pstate.gifts && back.pstate.gifts.count === 3),
    back && back.pstate && back.pstate.gifts ? JSON.stringify(back.pstate.gifts) : '(丢了)');

  /* --- G-5 背包空也能开面板（原来直接 toast 挡掉，连给钱都做不到） --- */
  const e5 = boot(23);
  e5.world.player.inventory.length = 0;
  const n5 = (e5.view().npcs || [])[0];
  ok('G-5 背包空时 gifts 仍是完整结构（面板靠它渲染「还没送过」而不是报错）',
    !!(n5 && n5.gifts && n5.gifts.count === 0 && typeof n5.gifts.items === 'object'),
    JSON.stringify(n5 && n5.gifts));
}

/* ================================================================
 * §A 回春堂：主人亲报的那两处
 * ================================================================ */
section('§A 回春堂「老郎中」「药柜」—— 点下去必须真有人、真有货');
{
  const e = boot(24);
  const w = e.world, p = w.player;
  w.movePlayerTo(p, 'jn_pharmacy');
  const here = w.npcsIncludingTemplates(p.room);
  ok('A-1 ★ 回春堂里真的有位老郎中（原来房间描述写着「柜台后坐着位白发老郎中」，实际一个人都没有）',
    here.some(n => n.name === '陈济仁' && (n.def || {}).tag === 'doctor'),
    here.map(n => n.name).join('、') || '(无人)');

  const r1 = e.exec('talk 陈济仁');
  ok('A-2 ★ 点「老郎中」不再报「这里没有「郎中」」', !/这里没有|没有这个人/.test(txt(r1.lines)), txt(r1.lines).slice(0, 60));
  const r2 = e.exec('list 陈济仁');
  ok('A-3 ★ 点「药柜」不再报「这里没有做买卖的人」', !/这里没有做买卖|这里没有/.test(txt(r2.lines)), txt(r2.lines).slice(0, 60));
  ok('A-4 药柜真列得出货（有价、有物）', /金创药/.test(txt(r2.lines)) && /\d+ 文/.test(txt(r2.lines)), txt(r2.lines).slice(0, 80));

  /* 药铺里能真买 */
  p.money = 999;
  const r3 = e.exec('buy 金创药');
  ok('A-5 真能从回春堂买到药', /金创药/.test(txt(r3.lines)) && !/没有/.test(txt(r3.lines)), txt(r3.lines).slice(0, 60));

  /* 房间的两条 action 与真实存在的人对得上 */
  const acts = (w.data.rooms.jn_pharmacy.actions || []);
  ok('A-6 房间 action 指向的都是**在场真名**（不再是「郎中」「药铺」这种称谓）',
    acts.length >= 2 && acts.every(a => /陈济仁/.test(a.cmd) || /^look /.test(a.cmd)),
    acts.map(a => a.label + '→' + a.cmd).join(' ｜ '));
}

/* ================================================================
 * §W 打工：主人没直接报，但同族（「此地可做」点了说没活计）
 * ================================================================ */
section('§W 三个「此地可做」的打工按钮（原来一律说没有活计）');
{
  /* ⚠️ 判据必须**钉到那门活计的名字与工钱**，不能只断「有工钱」——
     JOBS 是「按顺序取第一个命中」，`inn` 曾经把 `jn_smith_inner`（铁匠铺·炉房）
     判成跑堂，台词变成「你在铁匠铺·炉房里**跑堂**」、工钱 15。
     只断 `/工钱/` 的话这条会**假绿**（确实有工钱，只是活计错了）。 */
  const cases = [
    ['jn_smith_inner', 'work 打铁', '拉风箱', 18, '铁匠铺·炉房'],
    ['cunzhen_mill', 'work 碾房', '推碾', 13, '青溪村·碾房'],
    ['jn_brothel_kitchen', 'work 后厨', '帮厨', 14, '醉春楼·后厨'],
  ];
  for (const [rid, cmd, jobName, wage, name] of cases) {
    const e = boot(25);
    const w = e.world, p = w.player;
    w.movePlayerTo(p, rid);
    p.food = 90; p.water = 90; p.money = 0;
    const r = e.exec(cmd);
    const t = txt(r.lines);
    ok('W ' + name + '「' + cmd + '」干的是**这门活计**、拿到**这门工钱**',
      t.indexOf(jobName) >= 0 && p.money === wage,
      t.slice(0, 52) + ' → 钱=' + p.money + '（期望 ' + jobName + ' ' + wage + ' 文）');
  }
}

/* ================================================================
 * §Q 「询问」两种 ask 写法都要答得上
 *      —— 数据里 `ask` 有**三种**写法：单条 {topic,answer}、数组 [{topic,answer}]、
 *         以及**映射对象** { "话题": "答案" }（示例 mod 与我新添的 NPC 都这么写）。
 *         引擎原来只处理前两种，映射对象会 `a.topic.includes` **抛异常**，
 *         整条 ask 指令崩掉；修好之后也仍要防「不崩但答不上来」（走兜底 = 功能没了）。
 *         所以这里两种写法各挑一个**真 NPC**，真 exec，断言答的是**那句答案**。
 * ================================================================ */
section('§Q 询问：数组写法 / 映射对象写法，都要真的答出那句话');
{
  const e = boot(26);
  const w = e.world, p = w.player;
  /* ⚠️ 用 try/catch 包住 `exec`：这条断言要能区分「答不上来」和「指令直接抛异常」。
     不包的话，归一化一旦失效，异常会把整个测试脚本打断 ——
     那就只剩「脚本崩了」这一个信号，看不到是哪条断言失守（实测如此）。 */
  const safeExec = (cmd) => {
    try { return txt(e.exec(cmd).lines); }
    catch (err) { return 'EXC:' + (err && err.message); }
  };

  /* ① 数组写法（基础数据 18 人走的都是这个） */
  {
    const def = w.data.npcs['master_yue'];
    const item = (def && Array.isArray(def.ask)) ? def.ask.find(a => a && a.topic && a.answer) : null;
    ok('Q-0 前提：基础数据里找得到一个「数组写法 + 有 topic/answer」的 NPC',
      !!item, item ? 'master_yue / ' + item.topic : '(没找到)');
    if (item) {
      w.spawnNpc('master_yue', p.room, 1, true);
      const t = safeExec('ask 岳不群 about ' + item.topic);
      const frag = String(item.answer).slice(0, 6);
      ok('Q-1 ★ 数组写法：问得到答案（不是「答不上来」也不是抛异常）',
        t.indexOf(frag) >= 0, t.slice(0, 70) + '｜期望含「' + frag + '」');
    }
  }

  /* ② 映射对象写法（示例 mod 的写法；本轮新添的 NPC 也用它） */
  {
    const def = w.data.npcs['jn_diviner'];
    const asks = def && def.ask;
    const topic = (asks && !Array.isArray(asks) && !asks.topic) ? Object.keys(asks)[0] : null;
    ok('Q-2 前提：存在「映射对象写法」的 ask（{ 话题: 答案 }）', !!topic,
      topic ? 'jn_diviner / ' + topic : '(没找到)');
    if (topic) {
      w.spawnNpc('jn_diviner', p.room, 1, true);
      const t = safeExec('ask 徐半仙 about ' + topic);
      const answer = typeof asks[topic] === 'string' ? asks[topic] : (asks[topic] || {}).answer;
      const frag = String(answer || '').slice(0, 6);
      ok('Q-3 ★ 映射对象写法：同样问得到答案（原来这条会**抛异常**把指令整条挂掉）',
        !!frag && t.indexOf(frag) >= 0, t.slice(0, 70) + '｜期望含「' + frag + '」');
      /* 反向：不能是靠兜底编一句糊弄过去 */
      ok('Q-3b 答的是**那位 NPC 自己的**那句话，不是通用兜底',
        t.indexOf('不知道') < 0 && t.indexOf('我不好多言') < 0, t.slice(0, 60));
    }
  }

  /* ③ 通用防线：任何指令抛异常都不该炸到请求层 */
  {
    const before = e.world.data.rooms.jn_pharmacy;
    /* 造一条必然抛异常的指令：临时把某条指令的处理器换成 throw */
    const name = '__boom__';
    e.cmds.CMD[name] = { names: [name], run: () => { throw new Error('测试用爆炸'); } };
    const t = safeExec(name);
    delete e.cmds.CMD[name];
    ok('Q-4 ★ 指令内部抛异常时，玩家拿到的是**一行明确回执**而不是请求炸掉',
      /出了岔子/.test(t), t.slice(0, 60));
    void before;
  }
}

/* ================================================================
 * §K 「绑架」—— 日志高亮那条路（后端 hl 动作表）
 *      —— 主人第四轮加的统一入口：**晕着 → 装袋，站着 → 先打**。
 *         日志里点 NPC 名的那个菜单只能带一条 cmd，所以状态分流必须**在后端**做，
 *         前端两个入口（场景栏卡片 / 日志高亮）拿到的才是同一条路。
 *         断言要点：菜单里有「绑架」这一项，且 cmd 按 `knockedOut` **真的分流**——
 *         只断「有这一项」是不够的（cmd 写死成 kill 也能过），必须断两态各发什么。
 * ================================================================ */
section('§K 「绑架」：站着给「先打」、晕着给「装袋」，后端分流');
{
  const e = boot(31);
  const w = e.world, p = w.player;
  const grabActions = (name) => {
    const look = e.exec('look');
    const line = (look.lines || []).find(l => l.kind === 'npcs' && Array.isArray(l.hl) &&
      l.hl.some(x => x.text === name || String(x.text || '').indexOf(name) === 0));
    const h = line && line.hl.find(x => x.text === name || String(x.text || '').indexOf(name) === 0);
    return (h && h.actions) || [];
  };

  /* ① 站着的人：这一项 cmd 必须是 `kill <名>`（点了先开打） */
  const stand = w.spawnNpc('mob_bandit', p.room, 1, true);
  {
    const acts = grabActions(stand.name);
    const k = acts.find(a => /绑架/.test(a.label || ''));
    ok('K-1 站着的人，日志菜单里有「绑架」一项', !!k, acts.map(a => a.label).join('、'));
    ok('K-2 ★ 该 cmd 是 `kill <名>`（站着 → 先打，真进战斗）',
      !!(k && k.cmd === 'kill ' + stand.name), k ? k.cmd : '(没有)');
    ok('K-3 该项有 hint 说明「打晕他，再装袋」',
      !!(k && k.hint && /打晕/.test(k.hint)), k ? k.hint : '-');
  }

  /* ② 把这个人打倒 → 同一项 cmd 必须翻成 `装人 <名>` */
  {
    stand.hp = 1;
    w.onNpcDown(stand, null);
    const acts = grabActions(stand.name);
    const k = acts.find(a => /绑架/.test(a.label || ''));
    ok('K-4 ★ 打倒之后，该项 cmd 翻成 `装人 <名>`（晕着 → 直接装袋）',
      !!(k && k.cmd === '装人 ' + stand.name), k ? k.cmd : '(没有)');
    /* 没带麻袋 → hint 要点明「得先有条粗麻袋」，而不是让玩家点了吃一发警告 */
    const hasSack = p.countItem('sack_coarse') >= 1;
    ok('K-5 身上没麻袋时 hint 明确指向「粗麻袋」（别让入口把人坑了）',
      hasSack ? true : !!(k && /麻袋/.test(k.hint || '')),
      'hasSack=' + hasSack + ' hint=' + (k ? k.hint : '-'));
  }

  /* ③ 真跑一遍分流后的 cmd：`kill <名>` 要真能开打（不是死按钮） */
  {
    const e2 = boot(32);
    const w2 = e2.world, p2 = w2.player;
    const foe = w2.spawnNpc('mob_bandit', p2.room, 1, true);
    const r = e2.exec('kill ' + foe.name);
    ok('K-6 ★ 站着那条路发的 `kill <名>` 真能开打（端到端，不是死按钮）',
      !!(w2.battle && w2.battle.target), txt(r.lines).slice(0, 60));
  }
}

/* ================================================================
 * §R 「接取任务」—— 先弹详情，再决定接不接（主人第四轮）
 *      —— 原来是「接他的事」一点就把任务塞进任务栏。现在：
 *         ① 名字改成「接取任务」；
 *         ② 那一项带 `act:'acceptquest'` + `qid`，前端认它先弹详情页；
 *         ③ 后端 `questPreviewOf(qid)` 要**给得出**那一页的数据
 *            （委托人 / 第一步 / 目标 / 奖励概要 / 门槛），
 *            且未接时进度必须是 0/N（不能谎报）。
 * ================================================================ */
section('§R 「接取任务」：菜单项改名 + 后端给得出详情数据');
{
  const e = boot(41);
  const w = e.world, p = w.player;
  /* ⚠️ 别自己重算「哪个任务可接」——`availableQuestOf` 的前置判定（evalCond）
     跟肉眼扫 `require` 不是一回事（"noSect+karma" 这类条件开局就是满足的，
     扫「有没有 require 字段」会把能接的判成不能接，实测踩过）。
     这里改成：让**真玩家**站在那儿 `look`，直接读后端给的那一项。 */
  const grabAccept = (defId) => {
    const inst = w.spawnNpc(defId, p.room, 1, true);
    const look = e.exec('look');
    for (const l of (look.lines || [])) {
      if (!Array.isArray(l.hl)) continue;
      const h = l.hl.find(x => String(x.text || '').indexOf(inst.name) === 0);
      if (!h) continue;
      const act = (h.actions || []).find(a => /接取任务/.test(a.label || ''));
      if (act) return act;
    }
    return null;
  };
  /* 扫到一个真给得出「接取任务」的人就停（给不出的那些人直接跳过，不算失败） */
  let act = null;
  for (const id of Object.keys(w.data.npcs || {})) {
    const d0 = w.data.npcs[id] || {};
    if (!(Array.isArray(d0.quests) && d0.quests.length) && !d0.sidequest) continue;
    act = grabAccept(id);
    if (act) break;
  }
  ok('R-0 前提：找得到一个「给得出接取任务」的 NPC', !!act, act ? String(act.qid) : '(没有)');

  ok('R-1 ★ 菜单里那一项叫「接取任务」（不再叫「接他的事」）', !!act, act ? act.label : '(没找到)');
  ok('R-2 ★ 该项带 `act:"acceptquest"`（前端靠它先弹详情，而不是直接接）',
    !!(act && act.act === 'acceptquest'), act ? String(act.act) : '-');
  ok('R-3 ★ 该项带 `qid`（前端拿它去拉详情）',
    !!(act && act.qid && w.getQuest(act.qid)), act ? String(act.qid) : '-');
  ok('R-4 仍带 `cmd` 兜底（老客户端不认 act 时直连「直接接」的旧行为）',
    !!(act && /^accept /.test(act.cmd || '')), act ? act.cmd : '-');

  const qid = act && act.qid;
  const pv = qid ? e.questPreviewOf(qid) : null;
  ok('R-5 ★ 后端给得出任务详情（questPreviewOf 有返回）', !!(pv && pv.name), pv ? pv.name : '(空)');
  ok('R-6 详情含「委托人 / 目标 / 奖励」三样',
    !!(pv && typeof pv.giver === 'string' && Array.isArray(pv.targets) && Array.isArray(pv.rewards)),
    pv ? JSON.stringify({ giver: pv.giver, t: pv.targets.length, r: pv.rewards }) : '-');
  ok('R-7 ★ 未接时目标进度是 0/N（不能谎报进度）',
    !!(pv && pv.targets.every(t => t.cur === 0 && t.count >= 1)),
    pv ? JSON.stringify(pv.targets) : '-');
  ok('R-8 未接 → acceptable:true（前端据此给「接下这桩事」按钮）',
    !!(pv && pv.acceptable === true), pv ? String(pv.acceptable) : '-');
  ok('R-9 奖励概要是人话（不是裸的 `+exp` / `+pot`）',
    !!(pv && pv.rewards.every(r => !/^[+\-]/.test(String(r)))),
    pv ? pv.rewards.join('、') : '-');
  ok('R-9b 门槛翻成中文人话（不是 `noSect:true` 这种裸键）',
    !!(pv && !/noSect|karma|require/i.test(pv.requireText || '')),
    pv ? ('「' + pv.requireText + '」') : '-');

  if (pv) {
    e.exec('accept ' + pv.name);
    const pv2 = e.questPreviewOf(qid);
    ok('R-10 接下之后 acceptable 翻 false（按钮会变「已在你身上」，防重复接）',
      !!(pv2 && pv2.acceptable === false), pv2 ? String(pv2.acceptable) : '-');
  }
}

/* ================================================================
 * §S 「询问」→「他认识的人」（主人第四轮）
 *      —— 主人要的是「点『询问』弹出一个页面上面有 NPC 认识的人名字，
 *         点击这些名字按钮 NPC 会说关于它们的事（根据 NPC 背景画像来）」。
 *      守两条：
 *        ① 名单**只有一份**（view 里的 askPeople 必须等于 commands.npcKnownPeople
 *           的同一批）—— 前端自己拼一份名单，就会出现「点得出来但答不上」；
 *        ② 点名单上的名字，后端真答得出，且答的是**那个人**（不是万能话术）。
 * ================================================================ */
section('§S 「询问」→ 他认识的人：名单与回答同源');
{
  const cmds = require(path.join(ROOT, 'game', 'src', 'core', 'commands.js'));
  const e = boot(51);
  const w = e.world, p = w.player;
  /* 挑一个 rel 非空的 NPC（286 个都有，随便挑） */
  const defId = Object.keys(w.data.npcs || {}).find(x => (w.data.npcs[x].rel || []).length > 0);
  ok('S-0 前提：找得到一个有关系数据的 NPC', !!defId, String(defId));
  if (defId) {
    const inst = w.spawnNpc(defId, p.room, 1, true);
    const v = e.view();
    const n = (v.npcs || []).find(x => x.name === inst.name);
    /* view 瘦身（2026-10-13）：askPeople 改懒加载（/api/ask → engine.askView），
       场景快照不再背名单 —— 契约改为「快照不带 + askView 照常给」。 */
    ok('S-1 ★ 场景快照不带 askPeople（已改懒加载）',
      !!(n && !('askPeople' in n)),
      n ? 'askPeople in npcs[i] = ' + ('askPeople' in n) : '(没这个人)');
    const a = e.askView(inst.defId || inst.id || inst.name);
    ok('S-1b ★ askView 懒加载照常给名单（前端渲染的就是它）',
      !!(a && Array.isArray(a.people) && a.people.length > 0),
      a ? JSON.stringify((a.people || []).slice(0, 3)) : '(askView 返空)');
    ok('S-2 名单项带 name / kind / rel（面板要显示关系）',
      !!(a && a.people.every(x => x.name && x.kind && x.rel)),
      a ? JSON.stringify(a.people[0] || {}) : '-');

    /* ① 与后端同源 */
    const same = cmds.npcKnownPeople(w, inst).slice(0, 10);
    ok('S-3 ★ 前端名单 === 后端 npcKnownPeople（同一份，不各写一套）',
      JSON.stringify(a.people) === JSON.stringify(same),
      'askView=' + (a ? a.people.length : 0) + ' 后端=' + same.length);

    /* ② 点名字真答得上，且答的是那个人 */
    const first = a.people[0];
    const r = e.exec('ask ' + inst.name + ' about ' + first.name);
    const t = txt(r.lines);
    ok('S-4 ★ 问名单上的人，真答得出（走「不知道」兜底就是没接通）',
      r.lines.some(l => l.kind === 'say') && !/我却不知|不知道/.test(t), t.slice(0, 110));
    ok('S-5 ★ 答的是被问的那个人（名字出现在回答里）',
      t.includes(first.name), first.name + ' ／ ' + t.slice(0, 90));
    ok('S-6 ★ 交情不同、说得不一样（生人守着口，熟人肯多说）',
      (() => {
        inst.favor = 30;
        const r3 = e.exec('ask ' + inst.name + ' about ' + first.name);
        /* ⚠️ 只量**他说出来的话**（kind==='say'）。
           整行计数会掺进别的渠道：第一次 exec 会顺带把新手教程那一章讲上屏
           （storybeat），一条就是几十上百字 —— 与「交情深浅」毫无关系。 */
        const sayOnly = L => (L || []).filter(l => l.kind === 'say').map(l => l.text || '').join('');
        const t0 = sayOnly(r.lines);
        const t3 = sayOnly(r3.lines);
        return t3.length > t0.length && t3.includes(first.name);
      })(),
      '生人 ' + (r.lines || []).filter(l => l.kind === 'say').map(l => l.text || '').join('').length
      + ' 字 → 熟人 ' + (e.exec('ask ' + inst.name + ' about ' + first.name).lines || [])
        .filter(l => l.kind === 'say').map(l => l.text || '').join('').length + ' 字');

    /* ③ 单字名不该乱撞（防「江湖消息」被单字名截胡） */
    const r2 = e.exec('ask ' + inst.name + ' about 江湖消息');
    ok('S-7 ★ 通用话题不被名单截胡（「江湖消息」仍走通用兜底）',
      !r2.lines.some(l => l.kind === 'say' && a.people.some(x => x.name.length === 1 && l.text.includes(`${x.name}……`))),
      txt(r2.lines).slice(0, 80));
  }
}

/* ================================================================
 * §T 偷袭 / 交谈 / 告辞（主人第四轮：「NPC 交互页的互动是不是有点少？
 *      其他比如偷袭结缘之类的功能呢？」「『交谈』按钮的可交互性就更多了
 *      但实际却没有什么」）
 *      —— 「结缘」本来就有（bond/纳妾/结拜那一组），缺的是**偷袭**；
 *         「交谈」的毛病是点完没有任何变化，所以既要给**可点的话头**，
 *         也要给**看得见的结果**（好感 +1，每天三次封顶）。
 * ================================================================ */
section('§T 偷袭 / 交谈 / 告辞');
{
  /* ---- 偷袭 ---- */
  {
    const e = boot(61);
    const w = e.world, p = w.player;
    for (const n of w.npcsIn(p.room)) n.room = '__away__';
    const a = w.spawnNpc('npcv_001', p.room, 1, true);
    a.favor = 10;
    const hp0 = a.hp;
    const r = e.exec('偷袭 ' + a.name);
    ok('T-1 ★ 偷袭真扣血（先手重击，不是只喊一嗓子）', a.hp < hp0, hp0 + ' → ' + a.hp);
    ok('T-2 ★ 偷袭开了战斗，且 battle.ambush === false（玩家是凶手，'
      + '目击者才会站被打的那边——传 true 就反过来了）',
      !!(w.battle && w.battle.ambush === false),
      JSON.stringify(w.battle ? { ambush: w.battle.ambush, target: w.battle.target && w.battle.target.name } : null));
    ok('T-3 偷袭掉好感（暗算结仇）', (a.favor || 0) < 10, 'favor=' + a.favor);
    ok('T-4 已经开打后不能再偷袭（给出明确理由）',
      /已经动上手/.test(txt(e.exec('偷袭 ' + a.name).lines)), txt(e.exec('偷袭 ' + a.name).lines).slice(0, 60));
    /* 昏倒的人不给偷袭（那是「绑架 / 补刀」的活） */
    const e2 = boot(62);
    const w2 = e2.world, p2 = w2.player;
    for (const n of w2.npcsIn(p2.room)) n.room = '__away__';
    const down = w2.spawnNpc('mob_bandit', p2.room, 1, true);
    down.knockedOut = true; down.dead = true;
    ok('T-5 昏倒的人不能偷袭（提示改用绑架/补刀）',
      /绑架|补刀/.test(txt(e2.exec('偷袭 ' + down.name).lines)),
      txt(e2.exec('偷袭 ' + down.name).lines).slice(0, 60));
  }

  /* ---- 交谈 + 话头 ---- */
  {
    const e = boot(63);
    const w = e.world, p = w.player;
    for (const n of w.npcsIn(p.room)) n.room = '__away__';
    const a = w.spawnNpc('npcv_001', p.room, 1, true);
    a.favor = 0;
    const r = e.exec('talk ' + a.name);
    ok('T-6 ★ 交谈有回应（say 行，不是「看了你一眼」）',
      r.lines.some(l => l.kind === 'say'), txt(r.lines).slice(0, 80));

    const hl = (r.lines.find(l => Array.isArray(l.hl) && l.hl.length) || {}).hl;
    ok('T-7 ★ 回话里那个名字可点（带 hl，能接着聊）', !!(hl && hl[0] && hl[0].actions && hl[0].actions.length),
      hl ? hl[0].actions.map(x => x.label).join('、') : '(没有)');
    const acts = (hl && hl[0] && hl[0].actions) || [];
    ok('T-8 ★ 话头齐（接着聊 / 打听消息 / 问他的事 / 送礼 / 告辞）',
      ['接着聊', '打听消息', '问他的事', '拱手告辞'].every(x => acts.some(y => y.label === x)),
      acts.map(x => x.label).join('、'));
    /* 每个话头都得是**真指令**（不是点了回「是什么指令」的假按钮） */
    const bad = [];
    for (const act of acts) {
      if (!act.cmd) { bad.push(act.label + '(无 cmd)'); continue; }
      const t = txt(e.exec(act.cmd).lines);
      if (/是什么指令|出了岔子/.test(t)) bad.push(act.label + '→' + t.slice(0, 30));
      /* 打听消息/问他的事 会开打？不会——但「接着聊」会加分，无妨 */
      w.battle = null; p.inCombat = false; a.inCombat = false;
    }
    ok('T-9 ★ 五个话头逐个真跑，全部有真回应（没有假按钮）', bad.length === 0, bad.join(' ／ ') || '全通');

    /* 闲聊有结果：前三次 +1，第四次给「话已说尽」 */
    const e3 = boot(64);
    const w3 = e3.world, p3 = w3.player;
    for (const n of w3.npcsIn(p3.room)) n.room = '__away__';
    const b = w3.spawnNpc('npcv_001', p3.room, 1, true);
    b.favor = 0;
    const f0 = b.favor;
    e3.exec('talk ' + b.name);
    ok('T-10 ★ 闲聊有看得见的结果（好感 +1）', b.favor > f0, f0 + ' → ' + b.favor);
    e3.exec('talk ' + b.name); e3.exec('talk ' + b.name);
    const f3 = b.favor;
    const r4 = e3.exec('talk ' + b.name);
    /* ⚠️ 2026-10-13 主人：「再多说就显得聒噪……那两段黄字删了」。
       所以这里钉的是「**静默封顶**」：第四次搭话好感不再涨，
       且**不许**再冒出任何解释性的系统提示 —— 说删了就得真删。 */
    ok('T-11 ★ 一天三次封顶（第四次不再涨好感，且不再聒噪）',
      b.favor === f3
      && !/话已说尽|聒噪/.test(txt(r4.lines))
      && !txt(r4.lines).includes('熟络'),
      'favor=' + b.favor + ' ／ 第四次输出：' + (txt(r4.lines).slice(0, 40) || '（无提示）'));
    /* 送礼面板/关系面板看到的也必须是同一个数（不漏） */
    ok('T-12 view 里的好感跟实例一致',
      ((e3.view().npcs || []).find(x => x.name === b.name) || {}).favor === b.favor);
  }

  /* ---- 告辞 ---- */
  {
    const e = boot(65);
    const w = e.world, p = w.player;
    for (const n of w.npcsIn(p.room)) n.room = '__away__';
    const a = w.spawnNpc('npcv_001', p.room, 1, true);
    a.favor = 0;
    const r = e.exec('告辞 ' + a.name);
    ok('T-13 ★ 告辞有回应', r.lines.some(l => /后会有期/.test(l.text)), txt(r.lines).slice(0, 70));
    ok('T-14 礼数到了 → 好感 +1', a.favor === 1, 'favor=' + a.favor);
    ok('T-15 告辞不认识的人也给回应（不静默失败）',
      e.exec('告辞 不存在的人').lines.some(l => l.kind === 'warn'));
  }
}

console.log('\n' + '='.repeat(48));
console.log(`  第四轮专项回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
