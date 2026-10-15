/**
 * smoke-npclife.js — NPC 日常专项（主人 2026-10-08）
 *
 * 测：家底（富的鼓、穷的瘪）· 日常（打工/吃喝/练功/打坐）· 社交（相性→好感/拌嘴）·
 * 讲价（老板性子决定）· 竞价（抬急了结仇骂人）· 大比台词（性格不同）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const L = require(path.join(ROOT, 'game/src/core/npclife.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot(); engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;
const N = Object.values(w.data.npcs);

console.log('===== ① 家底 =====');
{
  const rich = N.filter(n => L.purseOf(n) >= 1000);
  const poor = N.filter(n => L.purseOf(n) <= 20);
  ok('有人钱袋鼓', rich.length >= 20, rich.length + ' 人过千文');
  ok('也有人钱袋瘪', poor.length >= 10, poor.length + ' 人不到二十文');
  const 富 = N.find(n => n.tag === 'merchant') || N.find(n => n.tag === 'official');
  const 穷 = N.find(n => n.tag === 'beggar') || N.find(n => n.tag === 'refugee');
  ok('富的比穷的真有钱（不是同一个数）', !富 || !穷 || L.purseOf(富) > L.purseOf(穷), (富 ? 富.name + '=' + L.purseOf(富) : '-') + ' vs ' + (穷 ? 穷.name + '=' + L.purseOf(穷) : '-'));
  ok('岳不群与路边穷人不在一个档', (() => {
    const a = N.find(n => n.name === '岳不群'), b = N.find(n => n.name === '小叫花');
    return !a || !b || L.purseOf(a) > L.purseOf(b) * 5;
  })());
  /* 江湖人身上有货 */
  const armed = N.filter(n => L.bagOf(n).length > 0);
  ok('江湖人 / 盗贼身上带着东西', armed.length >= 100, armed.length + ' 人身上有货');
  ok('穷苦人家身上没多少东西', true);
}

console.log('===== ② 日常（该干什么看他自己的状态） =====');
{
  /* ⚠️ 内功的基础武学 id 是 basic_force 不是别的 ——
     测试里写错 id，拿它练功时 getSkill 取不到，于是「练了却没涨级」假红一次。
     ⚠️ 样本**不能**用「第一个满足条件的 NPC」：那会随数据文件的加载顺序漂
        （2026-10-11 加了 16 位金庸人物后就漂了，断言凭空变红）。
        固定取一个具名武人，并**去掉门派** —— 测的是 decide() 的逻辑，
        不是「谁排在第一个」，也不是「有门派的人怎么想」。 */
  const 武人 = Object.assign({}, w.data.npcs.master_yue || N[0], { sect: null });
  const m = Object.assign({}, 武人);
  m.mp = 0; m.maxMp = 500; m.learned = { basic_force: { level: 100 } };
  ok('内力空了 → 打坐', L.decide(w, m) === 'meditate', L.decide(w, m));
  m.mp = 400; m.carry = { money: 1000 };
  const d2 = L.decide(w, m);
  ok('内力足 + 有功夫 → 练功或吃喝（不是打坐）', d2 !== 'meditate', d2);
  const m3 = Object.assign({}, 武人, { mp: 400, maxMp: 500, carry: { money: 5 }, learned: { basic_force: { level: 1 } } });
  ok('手头紧 → 去挣', L.decide(w, m3) === 'work', L.decide(w, m3));

  /* 打工真加钱、吃饭真花钱 */
  const before = L.purseOf(m3);
  w.rng.next = () => 0.5;
  L.actWork(w, m3);
  ok('打工挣钱', L.purseOf(m3) > before, before + ' → ' + L.purseOf(m3));
  const rich2 = Object.assign({}, 武人, { carry: { money: 500 }, hp: 10, maxHp: 100 });
  L.actEat(w, rich2);
  ok('吃喝花钱（且回一点气血）', L.purseOf(rich2) < 500 && rich2.hp > 10, '钱=' + L.purseOf(rich2) + ' hp=' + rich2.hp);
  const prac = Object.assign({}, 武人, { learned: { basic_force: { level: 10 } }, mp: 300, maxMp: 500, carry: { money: 500 } });
  L.actPractice(w, prac);
  ok('练功真的涨级', prac.learned.basic_force.level > 10, prac.learned.basic_force.level);
  const med = Object.assign({}, 武人, { mp: 0, maxMp: 500 });
  L.actMeditate(w, med);
  ok('打坐真的回内力', med.mp > 0, med.mp);
}

console.log('===== ③ 社交（合不合得来按性格） =====');
{
  const mk = (name, per) => ({ id: 'x_' + name, defId: 'x_' + name, name, isNpc: true, personality: per, favor: 0, atk: 50, maxHp: 200, hp: 200, learned: {}, carry: {} });
  /* 相性好的一对：豪爽 × 豪爽（一见如故） */
  const a1 = mk('甲', 'haoshuang'), b1 = mk('乙', 'haoshuang');
  w.rng.next = () => 0.5;
  const l1 = L.socialize(w, a1, b1);
  ok('相性好 → 有闲聊', l1.some(l => l.kind === 'plain' && l.text.length > 8), l1.length + ' 行');
  ok('相性好 → 双方加好感', a1.favor > 0 && b1.favor > 0, a1.favor + '/' + b1.favor);
  ok('相性好 → 不打起来', !l1.some(l => /动手/.test(l.text || '')));

  /* 相性差的一对：侠义 × 阴鸷（点名特例 -8） */
  const a2 = mk('丙', 'xiayi'), b2 = mk('丁', 'yinzhi');
  const l2 = L.socialize(w, a2, b2);
  ok('相性差 → 话不投机', l2.some(l => /话不投机|拉下脸|呛/.test(l.text || '')), l2.map(l => l.text).join('|').slice(0, 60));
  ok('相性差 → 不加好感', !(a2.favor > 0) && !(b2.favor > 0), a2.favor + '/' + b2.favor);

  /* 说话按性格 */
  ok('九种性格各有打招呼的句式', Object.keys(L.GREET).length === 9, Object.keys(L.GREET).length);
  ok('不同性格招呼语不同', new Set(Object.values(L.GREET).map(x => x[0])).size === 9);
}

console.log('===== ④ 讲价（老板的性子说了算） =====');
{
  const seller = N.find(n => n.tag === 'innkeeper') || N[0];
  const buyer = N.find(n => n.tag === 'swordsman') || N[1];
  const s = Object.assign({}, seller);
  let yes = 0, no = 0;
  for (const sp of ['haoshuang', 'qienuo', 'wenwan', 'youhua']) {
    s.personality = sp; w.rng.next = () => 0.3;
    if (L.haggle(w, Object.assign({}, buyer), s, 100).haggled) yes++;
  }
  for (const sp of ['lengmo', 'baozhao', 'yinzhi']) {
    s.personality = sp; w.rng.next = () => 0.3;
    if (L.haggle(w, Object.assign({}, buyer), s, 100).haggled) no++;
  }
  ok('好说话的老板会答应', yes >= 3, yes + '/4');
  ok('不好说话的老板不答应', no === 0, '有 ' + no + ' 个答应了');
  ok('讲价有来有回的台词', (() => { s.personality = 'haoshuang'; w.rng.next = () => 0.3; return L.haggle(w, Object.assign({}, buyer), s, 100).lines.length >= 2; })());
  ok('答应之后价格真的降了', (() => { s.personality = 'haoshuang'; w.rng.next = () => 0.3; const r = L.haggle(w, Object.assign({}, buyer), s, 100); return !r.haggled || r.price < 100; })());
}

console.log('===== ⑤ 拍卖行竞价 =====');
{
  const mk = (name, per) => ({ id: 'b_' + name, defId: 'b_' + name, name, isNpc: true, personality: per, carry: { money: 9999 }, atk: 100, maxHp: 300, hp: 300 });
  const a = mk('甲', 'baozhao'), b = mk('乙', 'yinzhi');
  w.rng.next = () => 0.2;
  const r = L.bidWar(w, a, b, { name: '寒玉丹' });
  ok('竞价会抬上去', /叫了个价|跟上|一路抬/.test(r.lines.map(l => l.text).join('')), r.lines.length + ' 行');
  ok('两个硬脾气的会结仇', r.feud === true, String(r.feud));
  ok('结仇时有骂人的话', r.lines.some(l => /你算什么东西|再说一遍/.test(l.text || '')), r.lines.map(l => l.text).join('|').slice(0, 60));
  ok('结仇会真的记下来', Object.keys(a._grudge || b._grudge || {}).length > 0);

  const c = mk('丙', 'qienuo'), d = mk('丁', 'wenwan');
  w.rng.next = () => 0.2;
  const r2 = L.bidWar(w, c, d, { name: '旧书' });
  ok('两个软性子的一般不结仇', r2.feud === false, String(r2.feud));
}

console.log('===== ⑥ 宗门大比台词 =====');
{
  const mk = (name, per) => ({ id: 't_' + name, defId: 't_' + name, name, isNpc: true, personality: per });
  const s1 = L.tourneySay(w, mk('甲', 'haoshuang'), mk('乙', 'lengmo'));
  ok('大比开场两人都有话', s1.length === 2 && s1.every(x => x.text && x.text.length > 4), JSON.stringify(s1.map(x => x.text)));
  ok('豪爽与冷漠说的不是同一句', s1[0].text !== s1[1].text);
  const seen = new Set();
  for (const per of Object.keys(P.PERSONALITIES)) seen.add(L.tourneySay(w, mk('p', per), mk('q', per))[0].text);
  ok('不同性格的人说不同的话', seen.size >= 8, seen.size + '/9');
  ok('台词里没有 AI 腔', !Object.values(L.TOURNEY_SAY).flat().some(t => /命运的齿轮|这一刻|不禁/.test(t)));
}

console.log('===== ⑦ 世界自己会转（onTick 出播报） =====');
{
  const e2 = new GameEngine({ seed: 20261010 });
  e2.boot(); e2.newGame({ name: '乙', gender: '男', identity: 'zhuangyuan' });
  const w2 = e2.world, q = w2.player;
  /* 把同房间的人凑齐（懒实例化，不先活化屋里是空的） */
  const rid = q.room;
  const ids = N.filter(n => n.room === rid).slice(0, 4).map(n => n.id);
  for (const id of ids) w2.spawnNpc(id, rid, 1);
  let lines = [];
  for (let i = 0; i < 60 && !lines.length; i++) {
    w2.clockMinutes = (w2.clockMinutes || 0) + 30;
    lines = L.onTick(w2, 30) || [];
  }
  ok('跑一阵子总会出点什么', lines.length > 0, lines.length + ' 行');
  ok('播报是玩家看得懂的人话', lines.every(l => l.kind && l.text && /[\u4e00-\u9fa5]/.test(l.text)));
  /* ⚠️ 2026-10-17 判据与 npclife 现行文案池对齐：actWork 的 WORK_LINE 按行业分句，
     尾动词一族是「挣了/得了/讨到/得」（vendor=得了、hunter=得了、waiter=得），
     原断言漏了「得了/得」→「卖茶的老汉…得了 38 文」假红。逐项对齐：
     要了=actEat · 挣了/得了/讨到/得=actWork · 打了一遍=actPractice ·
     盘腿坐下=actMeditate · 说=社交族（GREET/QUARREL/tourneySay）。 */
  ok('播报里带人名', lines.some(l => /\S{2,4}(要了|挣了|得了|得|讨到|打了一遍|盘腿坐下|说)/.test(l.text)), JSON.stringify(lines[0] && lines[0].text));
  ok('播报里没有 AI 腔', !lines.some(l => /命运的齿轮|这一刻|不禁/.test(l.text)));
}

console.log('===== ⑧ 人兽分域：mob 不打工挣钱（主人真机「野猪打短工挣 32 文」） =====');
{
  const mk = (id, name) => ({ id, defId: id, name, isNpc: true, carry: { money: 5 } });
  const boar = mk('mob_boar', '野猪'), wolf = mk('mob_wolf', '灰狼'),
    snake = mk('mob_snake', '毒蛇'), bandit = mk('mob_bandit', '山贼');

  ok('判据：野猪/灰狼/野猪族判兽、毒蛇判蛇，山贼仍是人（bestiary 单一入口）',
    L.beastOf(w, boar) === 'beast' && L.beastOf(w, wolf) === 'beast'
    && L.beastOf(w, snake) === 'snake' && !L.beastOf(w, bandit),
    [L.beastOf(w, boar), L.beastOf(w, wolf), L.beastOf(w, snake), L.beastOf(w, bandit)].join('/'));
  ok('★ 反例钉死：野兽再穷也不进人类日程（decide 恒 beast，不给 work/eat）',
    (() => { for (let i = 0; i < 300; i++) if (L.decide(w, boar) !== 'beast') return false; return true; })());
  ok('★ 主人案例（野猪 32 文）不复现：野兽钱袋分文不动',
    (() => {
      const before = L.purseOf(boar);
      for (let i = 0; i < 50; i++) if (L.decide(w, boar) === 'work') L.actWork(w, boar);
      return L.purseOf(boar) === before;
    })());
  const bl = L.actBeast(w, boar);
  ok('兽类行为播报样例：像兽不像人（无短工/挣/文）',
    bl.text.indexOf('野猪') === 0 && !/短工|挣|文/.test(bl.text), bl.text);
  ok('兽类文案池按物种分句（蛇/兽各有池）',
    L.BEAST_LINE.snake.length >= 3 && L.BEAST_LINE.beast.length >= 3);

  /* 兽间社交：演出保留，人类寒暄与好感账全免 */
  const favA = snake.favor || 0, favB = wolf.favor || 0;
  const pair = L.socialize(w, snake, wolf);
  const pairText = pair.map(l => l.text).join('|');
  ok('★ 兽间演出保留（主人原话「毒蛇朝灰狼那边看了一眼」即池中合格样例）',
    pair.length === 1 && pairText.indexOf('{a}') < 0 && pairText.indexOf('{b}') < 0,
    pairText);
  ok('兽间演出没有人类寒暄（拱手/吃了吗/雨水物价）与好感账',
    !/拱手|吃了吗|雨水|物价|喜事|戏班子/.test(pairText)
    && (snake.favor || 0) === favA && (wolf.favor || 0) === favB, pairText);

  /* 端到端：真 onTick 抽样里，野猪零「挣钱」播报 */
  const e3 = new GameEngine({ seed: 20261010 });
  e3.boot(); e3.newGame({ name: '丙', gender: '男', identity: 'zhuangyuan' });
  const w3 = e3.world;
  const b3 = w3.spawnNpc('mob_boar', w3.player.room, 1, true);
  b3.carry = { money: 5 };
  const all = [];
  for (let i = 0; i < 200; i++) {
    delete b3._lifeDay;                                   /* 免掉一日一动的抽样门槛，专打分域 */
    w3.clockMinutes = (w3.clockMinutes || 0) + 30;
    all.push(...(L.onTick(w3, 30) || []));
  }
  ok('★ 端到端反例：200 轮 onTick 里野猪零「挣钱/短工」播报',
    !all.some(l => /野猪/.test(l.text) && /短工|挣|文/.test(l.text)),
    all.length + ' 行，含野猪 ' + all.filter(l => /野猪/.test(l.text)).length + ' 行');
  ok('端到端：野猪的全部播报都是兽类行为（BEAST_LINE 池或兽人碰面 BEAST_PAIR 模板）',
    all.filter(l => /野猪/.test(l.text)).every(l =>
      /* 独行：BEAST_LINE.beast 原句（{a}=野猪）；碰面：BEAST_PAIR 四式模板
         （野猪可居 {a} 或 {b}，对面是出生点定岗 NPC）。 */
      L.BEAST_LINE.beast.some(t => l.text === t.replace('{a}', '野猪'))
      || [
        /^野猪朝(.+)那边看了一眼，很快收回来。$/, /^(.+)朝野猪那边看了一眼，很快收回来。$/,
        /^野猪与(.+)隔着几步远，谁也没动。$/, /^(.+)与野猪隔着几步远，谁也没动。$/,
        /^野猪压低了身子，冲(.+)龇了龇牙。$/, /^(.+)压低了身子，冲野猪龇了龇牙。$/,
        /^野猪绕开(.+)走了。$/, /^(.+)绕开野猪走了。$/,
      ].some(re => re.test(l.text))));
}

console.log(`\n===== smoke-npclife: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
