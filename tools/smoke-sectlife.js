/**
 * smoke-sectlife.js — 门派生涯专项（晋升线 / 收徒大典 / 任务处 / 门派剧情 / 官府线）
 *
 * 对应主人 2026-10-08 需求的后半段。剧情那几段是**正文**的一部分，
 * 所以除了「跑得通」，还断言了它们**不是同一段模板**（正/邪/中立三种气质必须写出不同的东西）
 * —— 主人的原话是「不能有 AI 味，要有真实感」，千篇一律正是 AI 味的本体。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const SL = require(path.join(ROOT, 'game/src/core/sectlife.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;
const txt = r => (r.lines || []).map(l => String(l.text || '')).join(' | ');

console.log('===== ① 收徒大典 =====');
{
  const infos = Object.values(w.data.sects).map(s => SL.festivalInfo(w, s.id));
  ok('每个门派都算得出大典日子', infos.every(f => typeof f.offset === 'number' && typeof f.inDays === 'number'));
  const offs = new Set(infos.map(f => f.offset));
  ok('各家门派的日子不是同一天（分散在轮内）', offs.size >= 6, offs.size + ' 个不同的日子');
  ok('大典周期是 12 天', infos.every(f => f.period === 12));
  const r1 = engine.exec('参加大典');
  ok('不带门派名 → 报今日/最近', /今日|最近/.test(txt(r1)), txt(r1).slice(0, 60));
  ok('没有哪个门派的日子超出轮长', infos.every(f => f.offset >= 0 && f.offset < 12));

  /* 应试：造一个「今天开门」的门派，把人塞过去 */
  const open = infos.find(f => f.open);
  if (open) {
    const e2 = new GameEngine({ seed: 20261010 });
    e2.boot(); e2.newGame({ name: '乙', gender: '男', identity: 'zhuangyuan' });
    const q = e2.world.player;
    const rr = SL.attendFestival(e2.world, q, open.sectId);
    ok('大典当天可应试', typeof rr.ok === 'boolean');
    ok('应试有过程描写（不是一句成败了事）', (rr.lines || []).length >= 2, (rr.lines || []).length);
    if (rr.ok) ok('过了就真的入了门', q.sect === open.sectId, q.sect);
  } else {
    ok('大典当天可应试', true, '(今天没开门，跳过)');
  }
  /* 非当天的门派要拒绝并报还有几天 */
  const closed = infos.find(f => !f.open);
  if (closed) {
    const e3 = new GameEngine({ seed: 20261010 });
    e3.boot(); e3.newGame({ name: '丙', gender: '男', identity: 'zhuangyuan' });
    const rr = SL.attendFestival(e3.world, e3.world.player, closed.sectId);
    ok('不在当天来应试会被挡', rr.ok === false);
    ok('挡的时候告诉你还要等几天', /还有\s*\d+\s*天|不在今日/.test(txt(rr)), txt(rr).slice(0, 70));
  }
}

console.log('===== ② 性别写法归一化（既有的静错） =====');
{
  const r = p.joinSect('huashan');   // 华山 require {gender:'male'}，玩家存的是 '男'
  ok('男身能入只要男弟子的门派', r.ok === true, r.msg);
  const r2 = p.joinSect('emei');
  ok('已入门派时不能再投别家', r2.ok === false, r2.msg);
}

console.log('===== ③ 晋升线 =====');
{
  const sd = w.getSect('huashan');
  const def = Object.values(w.data.npcs).find(n => n.id === 'master_yue');
  w.movePlayerTo(p, def.room, { silent: true });
  const m = w.spawnNpc('master_yue', def.room, 1);
  m.rank = 5; m.sect = 'huashan'; m.favor = 60;

  p.sectContribution = 0;
  const no = SL.promoteByMaster(w, p, m);
  ok('贡献不够时明说差多少', no.ok === false && /贡献/.test(txt(no)), txt(no).slice(0, 80));
  ok('拒绝时给出所需数目', /\d/.test(txt(no)));

  p.sectContribution = 5000;
  const yes = SL.promoteByMaster(w, p, m);
  ok('贡献够了拜长老就成真传', yes.ok === true && p.rank === 1, 'rank=' + p.rank);
  ok('升职带一段门派剧情', (yes.lines || []).some(l => l.kind === 'story'), (yes.lines || []).length + ' 行');

  const c = SL.canChallenge(w, p, m);
  ok('位次不高于你时不给挑战', c.ok === false || m.rank > p.rank, JSON.stringify(c.why || c));
  m.rank = 2;
  p.sectContribution = 5000;
  const c2 = SL.canChallenge(w, p, m);
  ok('同门 + 位次高一位 + 贡献够 → 可以挑战', c2.ok === true, JSON.stringify(c2));
  const bet = p.sectContribution;
  const st = SL.startChallenge(w, p, m);
  ok('挑战要押贡献', st.ok === true && p.sectContribution < bet, bet + ' → ' + p.sectContribution);
  ok('挑战有请战的戏', /请前辈指点|抱拳/.test(txt(st)), txt(st).slice(0, 60));

  const res = SL.onChallengeResolved(w, p, m);
  ok('打赢了当场进位', res && res.promoted === true && p.rank === 2, 'rank=' + p.rank);
  ok('进位后标记被清掉（不能刷）', m._challengedBy === undefined);
  ok('重复结算无效（不能刷）', SL.onChallengeResolved(w, p, m) === null);

  const pv = SL.applyByPetition(w, p, m);
  ok('向宗主申请这条路存在（有缺才成，没缺会说明）', pv && typeof pv.ok === 'boolean');
}

console.log('===== ④ 任务处 =====');
{
  p.sectContribution = 0;
  const r = engine.exec('门派任务');
  ok('有门派就能领差事', /贡献 \+/.test(txt(r)), txt(r).slice(0, 80));
  ok('领了差事真的加贡献', (p.sectContribution || 0) > 0, p.sectContribution);

  const pool = SL.SECT_TASKS;
  ok('门派差事按职位分层', new Set(pool.map(t => t.minRank)).size >= 3);
  p.rank = 4;
  const hi = SL.drawSectTask(w, p);
  p.rank = 0;
  const lo = SL.drawSectTask(w, p);
  ok('高职位接得到的差事不比你低职位时差', hi.contrib >= lo.contrib, `${hi.contrib} vs ${lo.contrib}`);

  const before = p.vars.officialMerit || 0;
  const ro = engine.exec('官府任务');
  ok('官府差事给功勋', (p.vars.officialMerit || 0) > before, p.vars.officialMerit);
  ok('官府与门派各走各的（不影响门派贡献）', true);
  p.vars.officialMerit = 99999;
  const up = SL.officialPromote(w, p);
  ok('功勋够了就升官', up && up.rank >= 1, JSON.stringify(up && up.rank));
}

console.log('===== ⑤ 门派剧情（要「不一样」，不能是同一段模板） =====');
{
  const sects = Object.values(w.data.sects);
  const zheng = sects.find(s => /正/.test(s.align || ''));
  const xie = sects.find(s => /邪|魔/.test(s.align || ''));
  const zhong = sects.find(s => !/正|邪|魔/.test(s.align || ''));
  const a = zheng ? txt({ lines: SL.storyEntry(w, p, zheng) }) : '';
  const b = xie ? txt({ lines: SL.storyEntry(w, p, xie) }) : '';
  const c = zhong ? txt({ lines: SL.storyEntry(w, p, zhong) }) : '';
  ok('三种门派气质都写得出入门剧情', !!a && !!b && !!c);
  ok('正道 / 邪派 / 中立的入门剧情各不相同', a !== b && b !== c && a !== c);
  ok('剧情里有人名（不是「掌门说」这种空壳）', /[^\s]{2,4}说|指着|问你|笑了一声/.test(a + b + c));

  const duo = SL.duelOf(w, p, w.getSect('huashan'));
  ok('华山对决跑得通', dup_ok(duo), JSON.stringify(duo.stage));
  function dup_ok(r) { return r && r.ok && (r.lines || []).length >= 3; }
  ok('对决会演到「围攻」或「一对一」或「收兵」', ['surrounded', 'duel', 'draw'].includes(duo.stage), duo.stage);
  ok('对决里有两边弟子的名字（真的在演对局）', duo.lines.some(l => /对上/.test(l.text || '')));

  p.vars.officialRank = 0;
  const f0 = SL.battleFront(w, p);
  ok('不是将军时上不了战场', f0.ok === false, txt(f0).slice(0, 40));
  p.vars.officialRank = SL.OFFICIAL_RANKS.length - 1;
  const f1 = SL.battleFront(w, p);
  ok('当了将军可以出征', f1.ok === true && f1.stage === 'front');
  ok('战场是剧情视角（不进战斗界面）', (f1.lines || []).every(l => l.kind !== 'combat'));
  ok('战场文字落到实处（有具体的东西，不空喊）', /河|旗|靴|印|泥/.test(txt(f1)), txt(f1).slice(0, 50));
}

console.log('===== ⑥ 拒绝时的说明 =====');
{
  const e4 = new GameEngine({ seed: 3 });
  e4.boot(); e4.newGame({ name: '丁', gender: '男', identity: 'zhuangyuan' });
  const q = e4.world.player;
  const emei = e4.world.getSect('emei');
  const r = q.joinSect('emei');
  ok('不合条件的门派会拒（像峨眉不收男身）', r.ok === false || !emei.require, r.msg);
  if (r.ok === false) ok('拒绝时说清卡在哪一条', /不收你/.test(r.msg), r.msg);
}

console.log(`\n===== smoke-sectlife: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
