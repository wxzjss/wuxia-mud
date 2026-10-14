/* smoke-npc-dup.js —— NPC 实例副本（×N）守卫
 *
 * 主人 2026-10-10 亲报：「重进点继续游戏后世界上的所有人名字后面都多了个 ×7 与 ×6」。
 * 根因（已定位并修）：
 *   `game/src/core/ambience.js` 的 `ensureNearbyNpcs()` **每个 worldTick（30 分钟）
 *   都对玩家所在房 + 隔壁房的每个常驻 NPC 无脑 `spawnNpc` 一次**；
 *   而 `spawnNpc` 只对**名人**「已有就返回那位」，**非名人每次都新建实例**
 *   ⇒ 副本越滚越多，而且**随存档写下去**（重进也修不掉）。
 *   房间行于是变成「这里有：张掌柜（商人） x7、……」。
 *
 * 本测试守两件事：
 *   ① 反复 worldTick **不再**产生副本（引擎侧已加「已活着就不再 spawn」）；
 *   ② **已经坏掉的旧档**读进来会被 `world.dedupeNpcInstances()` 自愈，
 *      且**保留玩家真正打过交道的那个**（favor/trust 最高的）。
 *
 * run: node tools/smoke-npc-dup.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const { World } = require('../game/src/core/world.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
const sec = t => console.log('\n=== ' + t + ' ===');

const liveOf = (w, defId) =>
  Object.values(w.instances.npcs).filter(n => n && n.defId === defId && !n.dead).length;

const boot = (seed) => {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'orphan' });
  return e;
};

sec('① 反复 worldTick 不再产生副本（原 bug 的正面复现）');
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 玩家本房 + 隔壁房里的「常驻 NPC」（`_npcsByRoom` 收录的就是这批） */
  const nearby = new Set([p.room]);
  for (const d of Object.keys((w.getRoom(p.room).exits || {}))) {
    const ex = w.getRoom(p.room).exits[d];
    const tid = typeof ex === 'string' ? ex : (ex && ex.to);
    if (tid) nearby.add(tid);
  }
  const targets = [];
  for (const rid of nearby) for (const id of (w._npcsByRoom[rid] || [])) targets.push([rid, id]);
  ok('本房/隔壁房确实有常驻 NPC（否则本测试无意义）', targets.length > 0, '共 ' + targets.length + ' 个');
  console.log('  · 样本：' + targets.slice(0, 5).map(([r, i]) => i + '@' + r).join(' , '));

  w.worldTick();                       // 先跑一次，让人都上线
  const base = {};
  for (const [, id] of targets) base[id] = liveOf(w, id);

  for (let i = 0; i < 12; i++) w.worldTick();     // 相当于游戏内 6 小时

  const grew = [];
  for (const [, id] of targets) {
    const now = liveOf(w, id);
    if (now > Math.max(1, base[id])) grew.push(`${id}: ${base[id]}→${now}`);
  }
  ok('★ 连跑 13 次 worldTick，常驻 NPC 实例数一个都没涨（原 bug 会涨到十几）',
    grew.length === 0, grew.slice(0, 5).join(' ; '));
  ok('  每个常驻 NPC 的活实例 ≤ 1', targets.every(([, id]) => liveOf(w, id) <= 1),
    targets.filter(([, id]) => liveOf(w, id) > 1).map(([, id]) => id + '=' + liveOf(w, id)).join(','));
}

sec('② 坏档自愈：读档时把历史副本清掉，并保留「有交情」的那个');
{
  const e = boot(777);
  const w = e.world, p = w.player;
  const rid = p.room;
  const defId = (w._npcsByRoom[rid] || [])[0];
  ok('本房有常驻 NPC 可做样本', !!defId, String(defId));

  /* 人为造出「×7」：再塞 6 个同 defId 的实例（模拟被旧 bug 污染过的存档） */
  const first = w.findLiveNpc(defId);
  first.favor = 88;                              // 这个是玩家真正打过交道的
  first.pstate = first.pstate || { trust: 0 };
  first.pstate.trust = 40;
  for (let i = 0; i < 6; i++) w.spawnNpc(defId, rid, 1, true);
  const polluted = liveOf(w, defId);
  ok(`  已造出副本：${polluted} 个实例`, polluted >= 7, polluted);

  const save = w.serialize();
  const e2 = new GameEngine({ seed: 777 });
  e2.boot();
  e2.world.deserialize(save, e2.modLoader.getEnabledModList());
  const w2 = e2.world;
  const after = liveOf(w2, defId);
  ok('★ 读档后副本被清掉（只剩 1 个）', after === 1, after);
  const kept = w2.findLiveNpc(defId);
  ok('★ 保留的是「有交情」的那个（favor 88 / trust 40 没丢）',
    !!kept && kept.favor === 88 && kept.pstate && kept.pstate.trust === 40,
    kept ? `favor=${kept.favor} trust=${kept.pstate && kept.pstate.trust}` : '(没找到)');
}

sec('③ 反向对照：不该碰的人一个都不许动');
{
  const e = boot(555);
  const w = e.world;

  /* ⚠️ 实测结论（写在这里免得以后又猜错）：
     `room.respawn[].count` **不参与 spawn** —— 它只是「定岗声明」
     （`world.isStationed()` 用它把人钉在岗位上，防止作息把人挪走、再被补一个）。
     实测 `huashan_shanxia` 配 `guard_huashan count:2`，进房后**只出 1 个**。
     所以「同一 defId 的应有实例数」= 1（只要是 `_npcsByRoom` 里的人），
     去重上限就该是 1 —— 早先按 count=2 写预期是错的。 */

  /* 反向对照用「会游走的人」：他们不在 `_npcsByRoom` 里，去重一律不许碰 */
  const wanderer = Object.keys(w.data.npcs).find(id => {
    const d = w.data.npcs[id];
    if (!d || !d.wander) return false;
    for (const rid of Object.keys(w._npcsByRoom || {})) {
      if (w._npcsByRoom[rid].indexOf(id) >= 0) return false;
    }
    return true;
  });
  ok('库里存在「会游走且不在 _npcsByRoom」的 NPC（可做反向样本）', !!wanderer, String(wanderer));
  if (wanderer) {
    const rid = w.data.npcs[wanderer].room || Object.keys(w.data.rooms)[0];
    for (let i = 0; i < 2; i++) w.spawnNpc(wanderer, rid, 1, true);
    const before = liveOf(w, wanderer);
    w.dedupeNpcInstances();
    ok(`★ 游走 NPC（${wanderer}）的多实例不被去重误伤（${before} 个）`,
      liveOf(w, wanderer) === before, `${before} → ${liveOf(w, wanderer)}`);
  }

  /* 再确认一次：被去重的人**只能是** `_npcsByRoom` 里的 */
  const w2 = boot(556).world;
  const target = (w2._npcsByRoom[Object.keys(w2._npcsByRoom)[0]] || [])[0];
  if (target) {
    const rid = Object.keys(w2._npcsByRoom).find(r => w2._npcsByRoom[r].indexOf(target) >= 0);
    for (let i = 0; i < 3; i++) w2.spawnNpc(target, rid, 1, true);
    const r = w2.dedupeNpcInstances();
    ok(`★ 定岗 NPC（${target}）副本被清到 1 个`, liveOf(w2, target) === 1,
      liveOf(w2, target) + ' 个；dedupe 报告 removed=' + r.removed);
  }
}

sec('④ 房间行不再出现「x7 / x6」这种副本计数');
{
  const e = boot(4242);
  const w = e.world, p = w.player;
  for (let i = 0; i < 10; i++) w.worldTick();
  const r = e.exec('look');
  const txt = (r.lines || []).map(l => l.text || '').join('\n');
  const m = txt.match(/这里有：[^\n]*/);
  ok('★ look 的「这里有」行里没有 x N 副本计数',
    !/\sx[2-9]\b/.test(m ? m[0] : ''), m ? m[0] : '(没这行)');
}

sec('⑤ 定岗者不漫游（isStationed 豁免）：本岗永不被 respawn 补出第二个实例');
{
  /* 2026-10-18 复测发现的同族病：respawn 点名的常驻者（guard_huashan）被
     defaultWanderFor 发了 20% 漫游率，漫游块漏了 isStationed 豁免（作息块/
     饭点块都有）→ 人漫游离岗 → respawn 只数「在本岗的 alive」=0 → 当空位
     补刷第二个 → 两个漫游撞进同一房，玩家看到「华山弟子 ×2」。
     修法：漫游块补 isStationed continue（与作息/饭点块同口径）。
     本段守卫：就算实例被强行塞了 {chance:1} 的漫游率、岗位 respawn 也被
     内存态提到 chance=1（只改 world.data 运行期对象，不碰 game/data/ 落盘），
     12 个 tick 后定岗者也必须钉在岗位、全图仍只有 1 个实例。
     （旧代码第一 tick 就离岗，同一 tick 内 respawn 以 100% 概率补岗，
       12 tick 后滚到 hardCap 3 —— 本段在旧代码下必红。） */
  const e = boot(4242);
  const w = e.world;
  const POST = 'huashan_shanxia', DEF = 'guard_huashan';
  ok('前置：guard_huashan 被 huashan_shanxia 的 respawn 点名（确是定岗者）',
    !!(w.data.rooms[POST] || {}).respawn && w.data.rooms[POST].respawn.some(x => x && x.npc === DEF));
  w.spawnNpc(DEF, POST, 1, true);
  const npc = w.findLiveNpc(DEF);
  ok('前置：已在岗位 spawn 出实例', !!npc && npc.room === POST, npc ? npc.room : '(没实例)');
  if (npc) {
    npc.wander = { chance: 1 };                       /* 强塞漫游率：定岗也必须被豁免 */
    for (const x of w.data.rooms[POST].respawn) {     /* 内存态把补岗概率提到 1 */
      if (x && x.npc === DEF) x.chance = 1;
    }
    for (let i = 0; i < 12; i++) w.worldTick();
    ok('★ 12 tick 后全图仍只有 1 个实例（旧代码会离岗→补刷滚到 2+）',
      liveOf(w, DEF) === 1, liveOf(w, DEF));
    ok('★ 实例钉在岗位上没被漫游挪走', npc.room === POST, npc.room);

    /* 存档往返也不多不少：读档 dedupeNpcInstances 收口后仍是 1 */
    const save = w.serialize();
    const e2 = new GameEngine({ seed: 4242 });
    e2.boot();
    e2.world.deserialize(save, e2.modLoader.getEnabledModList());
    ok('★ 存档往返后仍是 1 个', liveOf(e2.world, DEF) === 1, liveOf(e2.world, DEF));
  }
}

console.log('\n================================================');
console.log(`  NPC 副本守卫：${pass} 通过 / ${fail} 失败`);
console.log('================================================');
process.exit(fail ? 1 : 0);
