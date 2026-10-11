/* 师门情谊（自拟 🅕）：师父得是个活人 —— 会看你身上的伤、会训你、会念叨你、会替你高兴
 *
 * 断言的是「玩家真看得见的那句话 + 真变了的那点数值」。
 * 跑法：node tools/smoke-masterbond.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const mb = require(path.join(ROOT, 'game/src/core/masterbond.js'));
const mem = require(path.join(ROOT, 'game/src/core/npcMemory.js'));
const rf = require(path.join(ROOT, 'game/src/core/rumorfeed.js'));

const DAY = 1440;
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

(async () => {
  const e = new GameEngine({ seed: 4242 });
  await e.boot({});
  e.newGame({ name: '顾某' });
  const w = e.world, p = w.player;

  /* ================= 一、拜师（走真命令） ================= */
  section('1 拜师之后，「师父」才存在');
  const mid = Object.keys(w.data.npcs).find(id => (w.data.npcs[id].tier || 'C') === 'A' && w.data.npcs[id].name && !w.data.npcs[id].hostile);
  ok('找到一位 A 层名人', !!mid, mid);
  const master = w.spawnNpc(mid, p.room);
  master.favor = 60;
  const res = await e.exec('拜师 ' + master.name);
  ok('拜师成功', /磕了三个头|为师/.test((res.lines || []).map(l => l.text).join(' ')));
  ok('★ 他成了「我的师父」', mb.isMasterOf(p, master), master.name);
  const stranger = (w.npcsIn(p.room) || []).find(n => n !== master && !n.dead);
  ok('别人不是师父', !mb.isMasterOf(p, stranger), stranger ? stranger.name : '（房里没别人）');

  const rec = p.masters[master.defId || master.id];
  const clear = () => { rec._saidAt = undefined; rec._callDay = undefined; };
  const talk = () => { clear(); return mb.masterLine(w, p, master); };

  /* ================= 二、带伤 ================= */
  section('2 你带着伤来 —— 他先看伤，而且真的给你上药');
  p.hp = Math.floor(p.maxHp * 0.3);
  const hpBefore = p.hp, favBefore = master.favor;
  const l1 = talk();
  ok('★ 师父开口了', !!l1 && !!l1.text, l1 ? l1.text : '无');
  ok('★ 说的是「看伤」这件事', !!l1 && /伤/.test(l1.text), l1 && l1.text);
  ok('★ 气血真的回来了（不是嘴上说说）', p.hp > hpBefore, hpBefore + ' → ' + p.hp);
  ok('好感跟着涨', master.favor > favBefore, favBefore + ' → ' + master.favor);

  /* ================= 三、坏名声 ================= */
  section('3 你在外头坏了名声 —— 他脸上挂不住');
  p.hp = p.maxHp;                       /* 先把伤治好，否则永远走「看伤」那条 */
  p.kidnap = { wanted: 45 };
  const l2 = talk();
  ok('★ 他训你了', !!l2 && /别报我的名字|是让你用来干这个的/.test(l2.text), l2 && l2.text);
  ok('训人的时候不给钱', !/得钱/.test(l2 ? l2.text : ''));

  /* ================= 四、久不登门 ================= */
  section('4 你太久不登门 —— 他念叨');
  p.kidnap.wanted = 0;
  rec.lastSeen = (w.clockMinutes || 0) - 50 * DAY;
  const l3 = talk();
  ok('★ 隔 50 天：那句话是冷的', !!l3 && /你还记得这地方怎么走/.test(l3.text), l3 && l3.text);
  rec.lastSeen = (w.clockMinutes || 0) - 20 * DAY;
  const l4 = talk();
  ok('★ 隔 20 天：口气轻一些', !!l4 && /还知道回来/.test(l4.text), l4 && l4.text);

  /* ================= 五、你刚做成了事 ================= */
  section('5 你刚做成了事 —— 他嘴上不夸，手上有表示');
  rec.lastSeen = w.clockMinutes || 0;      /* 先清掉「久不来」 */
  rf.note(w, 'rs_sect_promote', { vars: { whom: '内门弟子' } });
  const moneyBefore = p.money || 0;
  const l5 = talk();
  ok('★ 他提到你做的事', !!l5 && /省着使/.test(l5.text), l5 && l5.text);
  ok('★ 真的给了钱', (p.money || 0) > moneyBefore, moneyBefore + ' → ' + (p.money || 0));
  const l5b = talk();
  ok('★ 同一桩事只夸一回', !l5b || !/省着使/.test(l5b.text), l5b ? l5b.text : '（没再说）');

  /* ================= 六、一天只说一件 ================= */
  section('6 一天只说一件（别当唐僧）');
  clear();
  const a1 = mb.masterLine(w, p, master);
  const a2 = mb.masterLine(w, p, master);
  ok('首次说一句', !!a1);
  ok('★ 同一天第二次不再说', a2 === null);

  const nonMaster = (w.npcsIn(p.room) || []).find(n => n !== master && !n.dead);
  if (nonMaster) ok('非师父不触发', mb.masterLine(w, p, nonMaster) === null, nonMaster.name);

  /* ================= 七、请安（真命令） ================= */
  section('7 「请安」—— 一个能让师父不生气的动作');
  rec.lastSeen = (w.clockMinutes || 0) - 60 * DAY;
  rec._saidAt = undefined;
  const callOnTxt0 = mb.daysAway(p, master, w);
  ok('请安前：已经很久没去了', callOnTxt0 >= 60, callOnTxt0 + ' 天');
  const fav0 = master.favor;
  const r = await e.exec('请安');
  const t = (r.lines || []).map(x => x.text).join(' ');
  ok('★ 请安有回应（不是「没这个命令」）', /行了个礼|应了一声/.test(t), t.slice(0, 90));
  ok('★ 好感涨了', master.favor > fav0, fav0 + ' → ' + master.favor);
  ok('★ 「多久没来」的账清掉了', mb.daysAway(p, master, w) === 0, mb.daysAway(p, master, w) + ' 天');
  const r2 = await e.exec('请安');
  ok('★ 同一天只请一回安', /已经给.*请过安/.test((r2.lines || []).map(x => x.text).join(' ')));

  /* ================= 八、交谈时师父排在传闻前面 ================= */
  section('8 交谈：师父的事比外人的舌根要紧');
  rf.note(w, 'rs_skill_fuse', { vars: { whom: '顾氏刀法' } });
  rec._saidAt = undefined;
  rec.lastSeen = (w.clockMinutes || 0) - 50 * DAY;
  p.hp = p.maxHp; p.kidnap.wanted = 0;
  const g = mem.greetLines(w, p, master);
  ok('★ 先说的是师父那句（不是传闻）',
    g.length >= 1 && !g[0].text.includes('顾氏刀法') && g[0].text.includes(master.name),
    g.length ? g[0].text : '没说');

  /* ================= 九、没拜师的人不会有人来关心 ================= */
  section('9 没拜过师的人：这些都不该发生');
  const e2 = new GameEngine({ seed: 8 });
  await e2.boot({});
  e2.newGame({ name: '路人甲' });
  const w2 = e2.world, p2 = w2.player;
  const other = (w2.npcsIn(p2.room) || [])[0];
  ok('从未拜师 → 没有师父', !mb.isMasterOf(p2, other));
  if (other) ok('★ 不会凭空关心你', mb.masterLine(w2, p2, other) === null, other.name);
  const r3 = await e2.exec('请安');
  ok('★ 「请安」说清「你还没拜过师」', /还没有拜过师/.test((r3.lines || []).map(x => x.text).join(' ')));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
