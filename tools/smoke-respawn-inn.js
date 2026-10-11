/* ============================================================
 * smoke-respawn-inn.js —— 昏倒复活点：只能在「最近**且已探索过**」区域的客栈
 *
 * 主人 2026-10-11 原话：
 *   「死亡会在最近客栈复活，指的是能在最近**且已探索过**区域的客栈复活，
 *     而不能在未探索的区域客栈复活。」
 *
 * 旧实现是在**整张世界图**上 BFS，只认距离不认认不认得 ——
 * 玩家在江南被打趴，可能一睁眼躺在从没去过的西域客栈里，
 * 而界面还会说「是那儿的伙计把你从路边背了回来」。逻辑上就圆不上。
 *
 * 守三件事：
 *   ① 未探索区域的客栈**不被选中**（哪怕它是图上最近的）；
 *   ② 踩过那片地方之后，同一家客栈就**可以**了；
 *   ③ respawnAtInn 端到端跑一遍，落点区域必须在已探索集合里。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const SV = require(path.join(ROOT, 'game', 'src', 'core', 'survival.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261011;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}
const roomOf = (w, id) => w.getRoom(id) || {};

/* ================================================================
 *  ① 前提：世界里有客栈，且分布在多个区域
 * ================================================================ */
section('① 前提：客栈分布');
const e0 = boot(), w0 = e0.world, p0 = w0.player;
const INNS = SV.innRoomIds(w0);
ok('世界里有客栈', INNS.length >= 2, INNS.length + ' 家：' + INNS.slice(0, 6).join('、'));
const regionsOfInns = INNS.map(id => roomOf(w0, id).region);
ok('客栈跨多个区域（否则这条规则无从体现）',
  new Set(regionsOfInns).size >= 2, Array.from(new Set(regionsOfInns)).join('、'));
ok('开局只探索过出生地那一片',
  SV.exploredRegions(w0, p0).size === 1 && SV.exploredRegions(w0, p0).has(roomOf(w0, p0.room).region),
  Array.from(SV.exploredRegions(w0, p0)).join('、'));

/* ================================================================
 *  ② 核心：未探索区域的客栈不许选中
 * ================================================================ */
section('② 未探索区域的客栈 → 不许当复活点');
{
  const e = boot(), w = e.world, p = w.player;
  const explored = SV.exploredRegions(w, p);

  /* 找一家「在图上是最近、但区域没探索过」的客栈 —— 这就是旧实现会踩的坑 */
  let farInn = null;
  for (const id of INNS) {
    const reg = roomOf(w, id).region;
    if (!reg || explored.has(reg)) continue;
    farInn = id;
    break;
  }
  ok('存在「未探索区域的客栈」（构造前提成立）', !!farInn, farInn || '（没有，测试失效）');

  if (farInn) {
    const innRoom = roomOf(w, farInn);
    /* 把玩家挪到那家客栈的**隔壁**（不设 visited 标记 = 没探索过）。
       旧实现会直接把他塞进这家没去过的客栈。 */
    let from = null;
    for (const d of Object.keys(innRoom.exits || {})) {
      const ex = innRoom.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && roomOf(w, t).id) { from = t; break; }
    }
    if (!from) {
      /* 客栈没有出口（不太可能）→ 直接把玩家放客栈里测「已在客栈」那条 */
      from = farInn;
    }
    p.room = from;
    ok('玩家被放到未探索区域', !explored.has(roomOf(w, from).region), roomOf(w, from).region);

    const oldPick = SV.nearestInn(w, from);            /* 旧口径：整图最近 */
    const newPick = SV.nearestInn(w, from, p);         /* 新口径：只认探索过的区域 */
    ok('旧口径确实会挑到未探索区域的客栈（证明这条规则不是空转）',
      oldPick === farInn || !explored.has(roomOf(w, oldPick).region),
      '旧=' + oldPick + '(' + roomOf(w, oldPick).region + ')');
    ok('★ 新口径不选它', newPick !== farInn, '新=' + newPick + '(' + roomOf(w, newPick).region + ')');
    ok('★ 新口径的落点区域**一定**是已探索过的',
      !!newPick && explored.has(roomOf(w, newPick).region),
      newPick + '(' + roomOf(w, newPick).region + ')');

    /* ③ 踩过那片地方之后，同一家客栈就放行了 */
    for (const d of Object.keys(innRoom.exits || {})) {
      const ex = innRoom.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t) p.setFlag('visited_' + t, true);
    }
    p.setFlag('visited_' + farInn, true);
    const after = SV.nearestInn(w, from, p);
    ok('★ 探索过之后同一家客栈放行', after === farInn, '之后=' + after);
  }
}

/* ================================================================
 *  ④ respawnAtInn 端到端：落点区域必须是探索过的
 * ================================================================ */
section('③ respawnAtInn 端到端');
{
  const e = boot(), w = e.world, p = w.player;
  const explored = SV.exploredRegions(w, p);

  /* 把玩家扔到一家未探索区域客栈的隔壁，然后「昏倒」 */
  let farInn = INNS.find(id => {
    const reg = roomOf(w, id).region;
    return reg && !explored.has(reg);
  });
  if (farInn) {
    const innRoom = roomOf(w, farInn);
    let from = farInn;
    for (const d of Object.keys(innRoom.exits || {})) {
      const ex = innRoom.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && roomOf(w, t).id) { from = t; break; }
    }
    p.room = from;
    p.money = 1000;                       /* 有银子才看得出「折了钱」那行 */
    const lines = [];
    const r = SV.respawnAtInn(w, lines, {});
    ok('★ 醒来的地方在已探索区域', explored.has(roomOf(w, r.room).region),
      r.name + '(' + roomOf(w, r.room).region + ')');
    ok('★ 醒来不在那家没去过的客栈', r.room !== farInn, farInn);
    ok('玩家真的被挪到了落点', p.room === r.room, p.room);
    ok('醒来有台词（昏倒 → 醒转）', lines.length >= 1, (lines[0] || {}).text);
    ok('台词里不出现「死」', !lines.some(l => /死/.test(l.text || '')), lines.map(l => l.text).join('|'));
    ok('醒后气血约四成（力竭，不是满血）', p.hp === Math.floor(p.maxHp * 0.4), p.hp + '/' + p.maxHp);
  } else {
    ok('存在未探索区域的客栈（构造前提）', false, '（没有，测试失效）');
  }
}

/* ================================================================
 *  ④ 兜底：连一个客栈都没探索过也不许没落点
 * ================================================================ */
section('④ 兜底：极端情况下仍有落点');
{
  const e = boot(), w = e.world, p = w.player;
  /* 把所有 visited 标记清掉 —— 模拟「一个地方都没探索过」 */
  for (const k of Object.keys(p.flags)) if (/^visited_/.test(k)) delete p.flags[k];
  const r = SV.respawnAtInn(w, [], {});
  ok('一个都没探索过时仍给出落点（不许把玩家扔在 noplace）', !!r.room, String(r.room));
  ok('落点是个真实房间', !!roomOf(w, r.room).id, r.room);
}

console.log('\n==============================================');
console.log('  复活点区域门禁：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('==============================================');
process.exit(fail ? 1 : 0);
