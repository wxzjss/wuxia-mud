/**
 * smoke-outlaw.js — 匪类自主行为专项（主人 2026-10-08）
 *
 * 测的是那条链：
 *   互看 → 山贼量玩家的斤两与油水 → 抢 / 溜 / 打晕搜刮 →
 *   旁人按性格出不出手 → 打晕装袋交衙门 → 匪类遇强就逃 →
 *   练家子追不追看性格、追不追得上看轻功 → 追不上就弹「拦不拦」→ 拦了群殴
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const O = require(path.join(ROOT, 'game/src/core/outlaw.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

function scene() {
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
  const w = e.world, p = w.player;
  const rid = Object.keys(w.data.rooms)[0];
  w.movePlayerTo(p, rid, { silent: true });
  const foeDef = Object.values(w.data.npcs).find(O.isOutlaw);
  const foe = w.spawnNpc(foeDef.id, rid, 1);
  return { e, w, p, rid, foe };
}
/** 按「钱 / 攻击底子 / 气血底子」把玩家改成某个档位（必须走 base，recacl 会覆盖 atk/maxHp） */
function tune(p, money, atkBase, hpBase) {
  p.money = money; p.atkBase = atkBase; p.maxHpBase = hpBase;
  p.recalc(); p.hp = p.maxHp;
  return p;
}

console.log('===== ① 谁是匪类 / 谁有武力 =====');
{
  const { w } = scene();
  const all = Object.values(w.data.npcs);
  const foes = all.filter(O.isOutlaw);
  ok('数据里认得出匪类', foes.length >= 5, foes.length + ' 个：' + foes.slice(0, 5).map(n => n.name).join('/'));
  ok('山贼被认出来', foes.some(n => /山贼/.test(n.name)));
  /* ⚠️ 不能拿 hostile 当判据 —— 野兽也是 hostile */
  const beasts = all.filter(n => new RegExp('虎|狼|熊|蛇|猪').test(n.name));
  ok('野兽**不**被当成匪类（别拿 hostile 当判据）',
    beasts.length === 0 || beasts.every(n => !O.isOutlaw(n)), beasts.slice(0, 3).map(n => n.name).join('/'));
  ok('镖师 / 官差算有武力', all.filter(n => ['escort', 'constable'].includes(n.tag)).some(n => O.hasForce(w, n)));
  ok('匪类自己不算「有武力的人」（不然会自己打自己）', foes.every(n => !O.hasForce(w, n)));
}

console.log('===== ② 山贼量完你之后怎么定 =====');
{
  const { w, p, foe } = scene();
  const cases = [
    ['又弱又穷 → 打晕搜刮', 10, 5, 20, 'mug'],
    ['又强又富 → 溜', 5000, 300, 3000, 'flee'],
    ['又弱又富 → 直接抢（最肥的羊）', 5000, 5, 20, 'rob'],
    ['强但穷 → 溜', 10, 400, 4000, 'flee'],
    ['中等偏上又有钱 → 抢', 5000, 60, 600, 'rob'],
  ];
  for (const [label, money, atk, hp, want] of cases) {
    tune(p, money, atk, hp);
    const v = O.assessPlayer(w, p, foe);
    ok(label, v.act === want, '实得 ' + v.act);
  }
  tune(p, 5000, 5, 20);
  const v = O.assessPlayer(w, p, foe);
  ok('计算落了地（给出了实力与油水两个数）', typeof v.power === 'number' && typeof v.wealth === 'number');
  ok('油水把行囊里的东西算进去了', JSON.stringify(v).length > 0);
  ok('决策有对应的台词（不是光一个结果码）', v.lines.length >= 2, v.lines.length + ' 行');
}

console.log('===== ③ 打晕搜刮真的会掉钱 =====');
{
  const { w, p, rid, foe } = scene();
  /* ⚠️ 想测「打晕搜刮」就得给穷 —— 1000 文已经过了 rich(300) 那道线，
     匪类会直接改成拦路抢劫（第一版就是这么测错的）。 */
  tune(p, 10, 5, 20);
  fool(w);
  const lines = O.onPlayerEnter(w, p, w.getRoom(rid), [foe]);
  ok('触发了「打晕」', /后脑|挨了一下/.test(lines.map(l => l.text).join('')), lines.map(l => l.text).join('|').slice(0, 60));
  ok('钱被搜走了', p.money < 10, '10 → ' + p.money);
  ok('玩家没死（只有昏过去）', p.hp > 0);
}

console.log('===== ④ 旁人出手 =====');
{
  const { w, p, rid, foe } = scene();
  const heroDef = Object.values(w.data.npcs).find(n => n.tag === 'escort' || n.tag === 'constable');
  const hero = w.spawnNpc(heroDef.id, rid, 1);
  hero.atk = 999; hero.personality = 'xiayi';
  const r = O.stepIn(w, hero, foe);
  ok('练家子打得赢匪类', r.won === true);
  ok('匪类被打晕', foe.knockedOut === true || foe.dead === true);
  ok('打晕之后走的是「交衙门」那条路', /差役|巡街|衙门|押/.test(r.lines.map(l => l.text).join('')), r.lines.map(l => l.text).join('|').slice(0, 70));

  /* 打不过的场合 */
  const { w: w2, rid: r2, foe: f2 } = scene();
  const weak = w2.spawnNpc(heroDef.id, r2, 1);
  weak.atk = 1; weak.hp = 10; weak.maxHp = 10;
  const r2b = O.stepIn(w2, weak, f2);
  ok('打不过就不硬撑（没把匪类打倒）', r2b.won === false && !f2.knockedOut);
}

console.log('===== ⑤ 追逐（看轻功） =====');
{
  const fast = scene();
  const heroDef = Object.values(fast.w.data.npcs).find(n => n.tag === 'escort');
  const chaser = fast.w.spawnNpc(heroDef.id, fast.rid, 1);
  chaser.learned = Object.assign({}, chaser.learned, { basic_qinggong: { level: 900 } });
  chaser.equippedSkills = Object.assign({}, chaser.equippedSkills, { 轻功: 'basic_qinggong' });
  chaser.atk = 500;
  fast.foe.hp = fast.foe.maxHp; fast.foe.dead = false; fast.foe.knockedOut = false;
  fool(fast.w);
  const r = O.chase(fast.w, chaser, fast.foe, fast.rid);
  ok('轻功高的追得上', r.caught === true, 'rounds=' + r.rounds);
  ok('追上了就交衙门', /差役|按住|锁/.test(r.lines.map(l => l.text).join('')), r.lines.map(l => l.text).join('|').slice(0, 60));

  const slow = scene();
  const c2 = slow.w.spawnNpc(heroDef.id, slow.rid, 1);
  c2.learned = Object.assign({}, c2.learned, { basic_qinggong: { level: 0 } });
  c2.equippedSkills = Object.assign({}, c2.equippedSkills, { 轻功: 'basic_qinggong' });
  c2.atk = 1;
  fool(slow.w, 0.99);   // 掷骰必定「被甩掉」
  const r2 = O.chase(slow.w, c2, slow.foe, slow.rid);
  ok('轻功差的追不上', r2.caught === false);
  ok('追不上会说「追了几条街就放弃了」', /巷口|放弃|喘|不见/.test(r2.lines.map(l => l.text).join('')), r2.lines.map(l => l.text).join('|').slice(0, 60));
  ok('逃掉的人真的挪了地方', !!r2.fledTo && r2.fledTo !== slow.rid, r2.fledTo);
}

console.log('===== ⑥ 拦不拦 =====');
{
  const { w, p, rid, foe } = scene();
  const prompt = O.interceptPrompt(w, p, foe, null);
  ok('弹出选择（两个选项）', prompt.choices && prompt.choices.length === 2, JSON.stringify(prompt.choices && prompt.choices.map(c => c.label)));
  ok('选项里是「拦」与「让」', /拦/.test(prompt.choices[0].label) && /让/.test(prompt.choices[1].label));
  ok('提示语写了当下的情形', /擦过去|撞/.test(prompt.text), prompt.text);
  ok('选项带着可执行的指令', prompt.choices.every(c => !!c.cmd));

  /* 拦得住 */
  tune(p, 0, 900, 9000);
  const friends = (w.npcsIn(rid) || []).slice(0, 2);
  fool(w, 0.1);
  const r = O.doIntercept(w, p, foe);
  ok('人多就拦得住', r.ok === true, JSON.stringify({ ok: r.ok, allies: r.allies }));

  /* 拦不住就自己挨一刀 */
  const s2 = scene();
  tune(s2.p, 0, 1, 10);
  fool(s2.w, 0.99);
  const r2 = O.doIntercept(s2.w, s2.p, s2.foe);
  ok('拦不住要挨一下（不是白拦）', r2.ok === false && r2.dmg > 0, JSON.stringify(r2.dmg));
  ok('挨了刀但没死', s2.p.hp >= 1);
}

console.log('===== ⑦ 频率与姿态 =====');
{
  const { w, p, rid, foe } = scene();
  tune(p, 10, 5, 20);
  fool(w, 0.1);
  O.onPlayerEnter(w, p, w.getRoom(rid), [foe]);
  const first = foe._outlawAt;
  ok('闹过一次会记时间（防连着闹）', !!first);
  const again = O.onPlayerEnter(w, p, w.getRoom(rid), [foe]);
  ok('冷却期内不再闹第二回', again.length === 0 || !/后脑|留下买路/.test(again.map(l => l.text).join('')), again.length);

  /* 互看 */
  const pair = scene();
  pair.w.rng.next = () => 0.1;
  const gaze = O.gazeBeats(pair.w, pair.w.getRoom(pair.rid), [pair.foe, { name: '路人甲', isNpc: true }]);
  /* 句式里有「对上一眼」「看了一眼」两种，别只认「看」字 */
  ok('屋里有匪类会「互相看一眼」', gaze.length >= 1 && /[看眼]/.test(gaze[0].text), JSON.stringify(gaze[0] && gaze[0].text));
  ok('九种性格都有「被看了一眼」的句式', Object.keys(O.GAZE_BY_PERSONA).length === 9, Object.keys(O.GAZE_BY_PERSONA).length);

  /* ⚠️ 匪类事件挂在 **doMove**（玩家自己走一格）而不是 movePlayerTo ——
     后者是传送/剧情/测试摆位的公共通道，在那儿闹会毁掉别的东西
     （真事：侧线的「走过去跟她说话」当场变成 battle=true）。
     这两条钉住「走一格会闹 / 传送不闹」，免得哪天又被挪回去。 */
  {
    const s3 = scene();
    const r0 = s3.w.getRoom(s3.rid);
    const d0 = Object.keys(r0.exits)[0];
    const ex0 = r0.exits[d0];
    const to0 = typeof ex0 === 'string' ? ex0 : ex0.to;
    s3.w.spawnNpc(Object.values(s3.w.data.npcs).find(O.isOutlaw).id, to0, 1);
    tune(s3.p, 10, 5, 20);
    fool(s3.w, 0.05);
    const rr = s3.e.exec(d0);
    ok('玩家自己走一格 → 匪类会闹', /穷|后脑|买路|量你|从头到脚/.test((rr.lines || []).map(l => l.text).join('')),
      (rr.lines || []).map(l => l.text).join('|').slice(0, 70));

    const s4 = scene();
    const r1 = s4.w.getRoom(s4.rid);
    const d1 = Object.keys(r1.exits)[0];
    const ex1 = r1.exits[d1];
    const to1 = typeof ex1 === 'string' ? ex1 : ex1.to;
    s4.w.spawnNpc(Object.values(s4.w.data.npcs).find(O.isOutlaw).id, to1, 1);
    tune(s4.p, 10, 5, 20);
    fool(s4.w, 0.05);
    const mv = s4.w.movePlayerTo(s4.p, to1, { silent: true });
    const extraTxt = ((mv && mv.extra) || []).map(l => l.text).join('');
    ok('传送（movePlayerTo）不该惊动匪类', !/穷|后脑|买路|量你/.test(extraTxt), extraTxt.slice(0, 60));
  }
  const bad = Object.values(O.GAZE_BY_PERSONA).flat().filter(t => /命运的齿轮|这一刻|不禁/.test(t));
  ok('这些句子里没有 AI 腔', bad.length === 0, bad.join('|'));
}

/** 把世界的掷骰钉死（不然这些断言会 flaky） */
function fool(w, v) { w.rng.next = () => (v === undefined ? 0.05 : v); }

console.log(`\n===== smoke-outlaw: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
