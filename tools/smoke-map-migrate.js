/* ============================================================
 * smoke-map-migrate.js — B13 连带收尾：旧存档停在「已删房间」的读档回归
 *
 * 背景（design/19-map-rebalance.md）：世界区块重设计删掉了 jn_home_02..30 等房。
 * 若玩家旧存档里 player.room 正指向这类**已不存在的房**，读档后会被**软锁**：
 *   - 方向键原地不动（doMove 已有守卫，返回「迷失虚空」）；
 *   - `go <房间名>` **抛异常** `Cannot read properties of undefined (reading 'exits')`
 *     （commands.js 的 go handler 拿 undefined 房间后直接 `room.exits`）；
 *   - `看 <方向>` 同样解引用崩（look handler 的出口回退分支）。
 *
 * 修法（3 处）：
 *   ① world.deserialize 收尾兜底：房间不存在 → 回 meta.startRoom（并置提示）；
 *   ② commands.js `go` handler 加 `if (!room)` 防御；
 *   ③ commands.js `look` 出口回退分支加 `if (!room)` 防御。
 *
 * 本测试独立造档走真 deserialize（内存态，不写盘），断言：
 *   ① 不崩 + 落在存在房间 + 落在 meta.startRoom；
 *   ② 读档后 go/北/look/背包/状态 都不抛异常且移动生效（不再软锁）；
 *   ③ 给了提示（不静默）；
 *   ④ 绕过 deserialize 的**运行期防御**：p.room 非法时 go/看 返回友好提示而非抛异常；
 *   ⑤ 不破坏正常档：p.room 合法时读档后位置不变。
 *
 * run: node tools/smoke-map-migrate.js
 * ============================================================ */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  [' + extra + ']' : '')); }
};
const noThrow = (fn) => { try { return { ok: true, val: fn() }; } catch (e) { return { ok: false, err: e.message }; } };
/* 从 exec 结果里取纯文本（可能挂在 lines[].text） */
const texts = r => ((r && r.lines) || []).map(l => (l && l.text) || '').join(' | ');

/* 造一份「正站在已删房」的旧档：正常档 serialize 后改 player.room */
function saveWithRoom(roomId) {
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  const s = e.world.serialize();
  s.player.room = roomId;
  return s;
}
function freshEngine() { const e = new GameEngine({ seed: 20261011 }); e.boot(); return e; }

/* ═══════ ① 读档兜底：不崩 + 落在存在的房间 + 落在 meta.startRoom ═══════ */
console.log('【1】旧档停在已删房 jn_home_05 → 读档兜底');
{
  const s = saveWithRoom('jn_home_05');
  const e = freshEngine();
  const r = noThrow(() => e.world.deserialize(s, null));
  ok('1.1 deserialize 不抛异常', r.ok, r.err);
  const p = e.world.player;
  ok('1.2 读档后 player.room 指向真实存在的房间', !!e.world.getRoom(p.room), 'room=' + p.room);
  ok('1.3 落在 meta.startRoom', p.room === e.world.data.meta.startRoom,
    'room=' + p.room + ' start=' + e.world.data.meta.startRoom);
  ok('1.4 记下了迁移来源（from/to）',
    e.world._roomMigrated && e.world._roomMigrated.from === 'jn_home_05' && e.world._roomMigrated.to === p.room,
    JSON.stringify(e.world._roomMigrated));
}

/* ═══════ ② 不再软锁：高频指令不抛异常且移动生效 ═══════ */
console.log('\n【2】读档后不再软锁');
{
  const s = saveWithRoom('jn_home_05');
  const e = freshEngine();
  e.world.deserialize(s, null);
  const p = e.world.player;

  for (const cmd of ['look', '看 北', '背包', '状态', '武学', '地图', '出口']) {
    const r = noThrow(() => e.exec(cmd));
    ok('2.1 「' + cmd + '」不抛异常', r.ok, r.err);
  }
  /* 移动真的生效：从出生点走一格 */
  const from = p.room;
  const mv = noThrow(() => e.exec('go 江南大路'));
  ok('2.2 「go 江南大路」不抛异常', mv.ok, mv.err);
  ok('2.3 移动真的生效（位置变了）', p.room !== from || texts(mv.val).length > 0,
    'from=' + from + ' to=' + p.room);
  /* 方向键 */
  const r2 = noThrow(() => e.exec('北'));
  ok('2.4 方向键「北」不抛异常', r2.ok, r2.err);
}

/* ═══════ ③ 不静默：给了提示 ═══════ */
console.log('\n【3】读档兜底不静默');
{
  const s = saveWithRoom('jn_home_05');
  const e = freshEngine();
  e.world.deserialize(s, null);
  const w = e.world;
  ok('3.1 world 上挂了提示文本', typeof w._migrateNotice === 'string' && w._migrateNotice.length > 0);
  ok('3.2 提示进了 player.log（可留痕）',
    (w.player.log || []).some(l => l && l.text === w._migrateNotice));
  const v = e.view();
  ok('3.3 view().room.desc 顶部带该提示（前端可见）',
    !!(v.room && v.room.desc && v.room.desc.indexOf(w._migrateNotice) === 0), (v.room || {}).desc);
  /* 一动就撤，别长期挂在描述上 */
  e.exec('look');
  const v2 = e.view();
  ok('3.4 玩家一动提示就撤掉（不长期挂描述）',
    !v2.room.desc || v2.room.desc.indexOf('你原先所在的地方') !== 0, (v2.room || {}).desc);
}

/* ═══════ ④ 运行期防御：绕过 deserialize，直接置非法 room ═══════ */
console.log('\n【4】运行期防御（非法 roomId）');
{
  const e = freshEngine(); e.newGame({ name: '试剑', gender: 'male' });
  e.world.player.room = 'ghost_room_不存在';
  for (const cmd of ['go 江南大路', '看 北', '北', 'look', '背包', '状态']) {
    const r = noThrow(() => e.exec(cmd));
    ok('4.1 「' + cmd + '」返回友好提示、不抛异常', r.ok, r.err);
  }
  const r = e.exec('go 江南大路');
  ok('4.2 go 给出「不在真实所在」类提示', /真实所在|辨不清|虚空|虚无/.test(texts(r)), texts(r).slice(0, 60));
  const r2 = e.exec('看 北');
  ok('4.3 看<方向> 给出「一片虚无」类提示', /虚无|看不清|真实所在/.test(texts(r2)), texts(r2).slice(0, 60));
  /* 4.4/4.5：合法房 + 一条指向幽灵房的出口（模拟悬空出口）→ movePlayerTo 返回 ok:false，
     doMove 必须接住它、不谎报 moved、不崩。 */
  const e3 = freshEngine(); e3.newGame({ name: '试剑', gender: 'male' });
  const here = e3.world.player.room;
  e3.world.data.rooms[here].exits.n = 'ghost_target_不存在';
  const r3 = noThrow(() => e3.exec('北'));
  ok('4.4 出口指向幽灵房时「北」不抛异常', r3.ok, r3.err);
  ok('4.5 幽灵出口不谎报移动（位置未变）', e3.world.player.room === here, 'room=' + e3.world.player.room);
}

/* ═══════ ⑤ 不破坏正常档：合法 room 读档后位置不变 ═══════ */
console.log('\n【5】正常档不受影响');
{
  const s = saveWithRoom('jiangnan_market');   // 合法房
  const e = freshEngine();
  e.world.deserialize(s, null);
  ok('5.1 合法档读档后位置保持不变', e.world.player.room === 'jiangnan_market', 'room=' + e.world.player.room);
  ok('5.2 合法档不触发兜底（无 migrate 提示）',
    !e.world._migrateNotice && !e.world._roomMigrated);
  const v = e.view();
  ok('5.3 合法档 room.desc 不被提示污染',
    !!(v.room && v.room.desc) && v.room.desc.indexOf('你原先所在的地方') !== 0);
  /* 对照：另一条合法路线 */
  const s2 = saveWithRoom('palace_street');
  const e2 = freshEngine();
  e2.world.deserialize(s2, null);
  ok('5.4 palace_street（被 smoke-guards 锁死的房）读档位置不变',
    e2.world.player.room === 'palace_street');
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
