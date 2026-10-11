/**
 * smoke-vision.js — 自拟三块：江湖榜 / NPC 记忆 / 二十四节气（2026-10-11）
 *
 * 这三件是「我觉得这游戏最缺的东西」：
 *   · 成长没有外部反馈 → **江湖榜**
 *   · 好感只是数字，NPC 没有记忆 → **NPC 记着你**
 *   · 时间只是个计数器 → **二十四节气**
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const R = require(path.join(ROOT, 'game/src/core/rank.js'));
const MEM = require(path.join(ROOT, 'game/src/core/npcMemory.js'));
const S = require(path.join(ROOT, 'game/src/core/season.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot(); engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;
const txt = ls => (ls || []).map(l => String(l.text || '')).join('\n');

console.log('===== ① 江湖榜 =====');
{
  const b = R.weaponBoard(w);
  ok('兵器谱排得出来', b.length >= 10, b.length + ' 人');
  ok('名次是从 1 开始连着的', b.every((e, i) => e.rank === i + 1));
  ok('是按实力降序', b.every((e, i) => i === 0 || e.power <= b[i - 1].power), b.slice(0, 3).map(e => e.name + '=' + e.power).join('/'));
  ok('上榜的是活人名字（不是 id）', b.every(e => e.name && !/^[a-z_]+$/.test(e.name)), b[0].name);
  ok('每个人都有评语', b.every(e => e.review && e.review.length > 8), b[0].review);
  ok('评语不是千篇一律', new Set(b.map(e => e.review)).size >= 3, new Set(b.map(e => e.review)).size + ' 种');
  ok('杂兵不上谱', !b.some(e => /山贼|野猪|灰狼/.test(e.name)), b.filter(e => /山贼|野猪|灰狼/.test(e.name)).map(e => e.name).join('/'));

  /* 玩家实力够了要能上榜 */
  const before = R.myWeaponRank(w);
  ok('开局没上榜（凑不够斤两）', before === null, String(before));
  p.atkBase = 3000; p.maxHpBase = 20000; p.recalc(); p.hp = p.maxHp;
  const after = R.myWeaponRank(w);
  ok('练上去了就进谱', after !== null && after <= 5, String(after));
  const board2 = R.boardText(w);
  ok('榜文里真的写出了玩家（带「你」）', /（你）/.test(txt(board2)), txt(board2).slice(0, 80));
  ok('榜文里有人的名次与评语', /第\s*\d+　\S+/.test(txt(board2)));

  /* 换榜会被传开 */
  R.noteSwap(w, { name: '旧人' }, { name: p.name, id: '__player' });
  ok('换榜记了一笔', !!w._rankSwap && w._rankSwap.winner === p.name, JSON.stringify(w._rankSwap));

  /* 恶人榜 */
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 999;
  const evil = R.evilBoard(w);
  ok('恶人榜排得出来', evil.length >= 1, evil.length);
  ok('恶名高的排前面', evil[0].wanted >= evil[evil.length - 1].wanted);
  ok('玩家作恶会进恶人榜', evil.some(e => e.isPlayer), evil.map(e => e.name).join('/'));
  ok('恶人榜榜文有内容', /恶人榜/.test(txt(R.boardText(w, 'evil'))));

  /* 榜上的人会来讨教 */
  p.atkBase = 2000; p.maxHpBase = 15000; p.recalc(); p.hp = p.maxHp;
  /* ⚠️ 讨教要求「名次挨得近」（差超过 4 位人家犯不着来找）——
     所以直接取谱上紧挨着玩家的那位，别随机抽人。 */
  const board3 = R.weaponBoard(w);
  const myIdx = board3.findIndex(e => e.isPlayer);
  /* ⚠️ 玩家可能就排第一：那就取**下一名**，别把自己取出来（第一版取到玩家自己，
     于是「榜上的人来讨教」永远 null）。 */
  const near = board3.find((e, i) => !e.isPlayer && Math.abs(i - myIdx) <= 4);
  const who = Object.values(w.data.npcs).find(n => n.name === near.name);
  let asked = null;
  if (who) { who.personality = 'baozhao'; w.rng.next = () => 0.01; asked = R.maybeChallenge(w, p, w.getRoom(p.room), [who]); }
  ok('榜上的人会来讨教', !!asked && !!asked.text, asked ? asked.text.slice(0, 40) : 'null');
  if (asked) {
    ok('讨教带着「接不接」两个选择', asked.choices && asked.choices.length === 2, JSON.stringify(asked.choices && asked.choices.map(c => c.label)));
    ok('选择带着指令', asked.choices.every(c => !!c.cmd));
    ok('说话有武侠味（不是系统提示）', /讨教|手痒|见面就是/.test(asked.text), asked.text);
  }
  /* 指令真的通 */
  ok('「江湖榜」指令能开', engine.exec('江湖榜').lines.length >= 5);
  ok('「恶人榜」指令能开', engine.exec('恶人榜').lines.length >= 2);
}

console.log('===== ② NPC 记着你 =====');
{
  /* ⚠️ 先把恶名与侠名清干净：上面①里把玩家设成通缉犯了，「听说你的事」会抢在
     重逢话前面（优先级本来就是听说的更靠前）—— 那是设计，不是 bug。 */
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0; p.karma = 0;
  const def = Object.values(w.data.npcs).find(n => n.id === 'master_yue');
  w.movePlayerTo(p, def.room, { silent: true });
  const m = w.spawnNpc('master_yue', def.room, 1);

  /* 头一回见没什么可说的 */
  const first = MEM.greetLines(w, p, m);
  ok('初次见面不翻旧账', first.length === 0, JSON.stringify(first));

  /* 久别重逢 */
  w.clockMinutes += 20 * 1440;
  const re = MEM.greetLines(w, p, m);
  ok('隔久了再见，他会提一句', re.length === 1 && /有些日子|前阵子|回来了|上哪儿/.test(re[0].text), JSON.stringify(re));
  ok('重逢话里带他的名字或口气像人话', re[0].text.length > 8);
  /* ⚠️ 只调一次： 本身有「一天只念一回」的副作用，
     调两次的话第二次必然为空 —— 第一版就这么把自己绕进去的。 */
  /* 上面已经推进了二十天，所以这里「新的一天」是允许再念的 —— 该断的是
     **同一天内不重复**，用再调一次来验。 */
  const re2 = MEM.greetLines(w, p, m);
  ok('同一天内不重复念', re2.length === 0, JSON.stringify(re2));

  /* 答应的事 */
  w.clockMinutes += 20 * 1440;
  MEM.promise(w, p, m, 'repay', '还他三百文');
  const pr = MEM.greetLines(w, p, m);
  ok('你答应过没办的事，他记得', pr.length === 1 && /三百文/.test(pr[0].text), JSON.stringify(pr));
  ok('欠着的事优先于久别重逢（更该说的先说）', /三百文/.test(pr[0].text));
  MEM.settled(p, m, 'repay');
  ok('办完了就不再提', MEM.pendingPromise(w, p, m) === null);

  /* 人情账 */
  MEM.debt(w, p, m, 50, '救过他');
  w.clockMinutes += 5 * 1440;
  ok('人情账会被记住', (m.pstate.debt || 0) === 50, String(m.pstate.debt));
  const dl = MEM.debtLine(w, m);
  ok('欠着人情时见面有表示', !!dl && dl.text.length > 8, JSON.stringify(dl));

  /* 记忆随档走（挂在 pstate 上） */
  ok('记忆挂在 pstate（会随存档走）', !!m.pstate && !!m.pstate.mem);
  ok('记下来的事情拿得回来', !!MEM.recall(m, '_lastSeen') || !!MEM.recall(m, '_debtLog'));
}

console.log('===== ③ 二十四节气 =====');
{
  ok('二十四节气齐了', S.TERMS.length === 24, S.TERMS.length);
  ok('每个节气都有名字', S.TERMS.every(t => t.name && t.name.length === 2));
  ok('每个节气都写了「这一天该有的样子」', S.TERMS.every(t => t.line && t.line.length > 10));
  ok('节气名不重复', new Set(S.TERMS.map(t => t.name)).size === 24);

  /* 循环 */
  /* ⚠️ dayOf = floor(clockMinutes/1440)+1 —— 所以「第 1 天」是 clockMinutes = 0，
     不是 1*1440（那是第 2 天）。第一版就栽在这儿，交节日に当てられなかった。 */
  w.clockMinutes = 0;
  const t1 = S.termOf(w);
  ok('第 1 天是立春', t1.name === '立春', t1.name);
  w.clockMinutes = 24 * S.PERIOD * 1440;
  ok('满一年回到立春', S.termOf(w).name === '立春', S.termOf(w).name);
  w.clockMinutes = S.PERIOD * 1440;
  ok('过十五天换一个节气', S.termOf(w).name !== '立春', S.termOf(w).name);
  ok('节气里算得出今天是第几天', S.termOf(w).dayInTerm >= 1 && S.termOf(w).dayInTerm <= S.PERIOD);

  /* 只在交节那天说话 */
  w.clockMinutes = 0;
  ok('交节当天给一句', !!S.termLine(w), JSON.stringify(S.termLine(w)));
  w.clockMinutes = 4 * 1440;
  ok('平时不说（免得天天像天气预报）', S.termLine(w) === null);

  /* 看得见 */
  w.clockMinutes = 0;
  const look = engine.exec('look');
  ok('「看」的时候真的看得到节气', /立春/.test(txt(look.lines)), txt(look.lines).slice(0, 60));

  ok('节气句子没有 AI 腔', !S.TERMS.some(t => /命运的齿轮|这一刻|不禁|岁月如歌/.test(t.line)));
}

console.log(`\n===== smoke-vision: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
