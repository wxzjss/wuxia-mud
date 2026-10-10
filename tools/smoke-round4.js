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

console.log('\n' + '='.repeat(48));
console.log(`  第四轮专项回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
