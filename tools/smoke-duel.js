/* ============================================================
 * smoke-duel.js — 切磋（点到为止的比武）
 *
 * 主人 2026-10-11 的完整口径：
 *   「npc 互动页有『攻击』没有『切磋』。点击切磋按钮会根据人物性格说一句请赐教之类的话；
 *     切磋和正常战斗一样（会掉血但不会死亡、会保留 1 滴血晕倒过去，醒来还是在原地）；
 *     如果有旁人会凑热闹看并对招式进行点评，却不会帮任何一方；npc 之间有时也会切磋；
 *     不同性格的人对切磋态度不同；切磋过后一般会给少量好感度；
 *     同一个 npc 一天最多同意切磋三次，再切磋会说你太菜 / 我如不你 —— 按性格说。」
 *
 * ⚠️ 这里最该钉死的是「**不会死、不被抬走**」——
 *   它一旦破了，玩家切磋输一场人就被送去了客栈，或者把 NPC 打死了结仇，
 *   是整个系统里后果最重的一条。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const duelMod = require(path.join(ROOT, 'game', 'src', 'core', 'duel.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const txt = r => ((r && r.lines) || []).map(l => l.text || '').join('');

function fresh(seed) {
  const e = new GameEngine({ seed: seed || 20261011 });
  e.boot();
  e.newGame({ name: '测试侠客', gender: 'male' });
  return e;
}

console.log('\n① 互动页有「切磋」，且与「攻击」是两条路');
{
  const e = fresh();
  const w = e.world, p = w.player;
  /* 挑一间有活人的屋子 */
  const room = Object.values(w.data.rooms).find(r =>
    w.npcsIncludingTemplates(r.id).some(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name)));
  p.room = room.id;
  const r = e.exec('look');
  const line = (r.lines || []).find(l => (l.kind || l.type) === 'npcs');
  const acts = (line && line.hl ? line.hl[0].actions : []) || [];
  const labels = acts.map(a => a.label);
  ok('★ 互动里有「切磋」', labels.indexOf('切磋') >= 0, labels.join(' / '));
  ok('★ 「攻击」仍在（两条路并存）', labels.indexOf('攻击') >= 0);
  const duelBtn = acts.find(a => a.label === '切磋');
  ok('★ 切磋按钮发的是「切磋 <名字>」', duelBtn && /^切磋 /.test(duelBtn.cmd), duelBtn && duelBtn.cmd);
  ok('★ 切磋按钮自己说明是点到为止', duelBtn && /点到为止/.test(duelBtn.hint || ''), duelBtn && duelBtn.hint);
  const iAtk = labels.indexOf('攻击'), iDuel = labels.indexOf('切磋');
  ok('★ 「攻击」仍是最后一项（B10：触屏别滑到开打）', iAtk === labels.length - 1,
    '攻击在第 ' + (iAtk + 1) + '/' + labels.length);
  ok('★ 切磋排在攻击之前（它是无害项）', iDuel < iAtk);
}

console.log('\n② 应战 / 拒战的话按性格走');
{
  const e = fresh();
  const w = e.world;
  const per = require(path.join(ROOT, 'game', 'src', 'core', 'personality.js'));
  const ids = ['haoshuang', 'yinzhi', 'qienuo', 'xiayi', 'youhua', 'mune', 'wenwan', 'baozhao', 'lengmo'];
  const said = {};
  let miss = [];
  for (const id of ids) {
    const npc = { id: 'x_' + id, name: '甲', personality: id, world: w, def: {} };
    const a = duelMod.acceptLine(npc);
    const wk = duelMod.refuseLine(npc, 'weak');
    const st = duelMod.refuseLine(npc, 'strong');
    if (!a || !wk || !st) miss.push(id);
    said[id] = a;
  }
  ok('★ 九种性格都有「应战 / 嫌你弱 / 服你强」三套话', miss.length === 0,
    miss.length ? '缺：' + miss.join(',') : ids.length + ' 种齐备');
  ok('★ 应战话各不相同（不是同一句复制九遍）',
    new Set(Object.values(said)).size >= 7,
    new Set(Object.values(said)).size + ' 种不同');
  /* 性格 id 必须是真的（拼错就回落到 mune，九个性格会变成一样） */
  const realIds = ids.filter(id => per.PERSONALITIES[id]);
  ok('★ 九种性格 id 都能被 personality.js 认出来', realIds.length === ids.length,
    realIds.length + '/' + ids.length);
}

console.log('\n③ 一天最多三次，拒绝词按战绩选');
{
  const e = fresh();
  const w = e.world, p = w.player;
  const room = Object.values(w.data.rooms).find(r =>
    w.npcsIncludingTemplates(r.id).some(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name)));
  p.room = room.id;
  const foe = w.npcsIncludingTemplates(p.room).find(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name));
  foe.favor = 20;
  foe.level = Math.max(1, Math.min(foe.level || 1, (p.level || 1) + 7)); // 门槛不属本节被测项
  ok('★ 上限是 3 次', duelMod.MAX_PER_DAY === 3);
  let opened = 0, refused = '';
  for (let i = 0; i < 5; i++) {
    w.battle = null;                       /* 每轮先收场，只测「同不同意」这道闸 */
    const r = w.startDuel(p, foe);
    if (r.battle) { opened++; w.battle = null; }
    else refused = txt(r);
  }
  ok('★ 前三次都同意', opened === 3, opened + ' 次');
  ok('★ 第四次起拒绝，且给的是话不是报错', /「/.test(refused) || refused.length > 4, refused.slice(0, 40));
  ok('★ 拒绝理由与战绩挂钩（没赢过 → 嫌你弱）',
    duelMod.countToday(w, foe.id) === 3 && /嫩|三脚猫|不值得|不敢|回去|差些|不必|摇头|配|再说|等等/.test(refused),
    refused.slice(0, 46));
  /* 赢过之后，拒绝词换成「我不如你」那一派 */
  duelMod.noteWin(w, foe.id);
  const g2 = duelMod.canDuel(w, foe);
  ok('★ 赢过之后改成「服你强」那一套', g2.ok === false && g2.why === 'strong',
    g2.why + ' → ' + String(g2.line).slice(0, 34));
  /* 隔天恢复 */
  w.clockMinutes += 1440;
  ok('★ 到第二天次数恢复', duelMod.countToday(w, foe.id) === 0, '今日 0 次');
}

console.log('\n④ 打到「血尽」也不会死、不会被抬走（最重的一条）');
{
  const e = fresh();
  const w = e.world, p = w.player;
  const room = Object.values(w.data.rooms).find(r =>
    w.npcsIncludingTemplates(r.id).some(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name)));
  p.room = room.id;
  const foe = w.npcsIncludingTemplates(p.room).find(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name));
  /* ⚠️ 2026-10-18 切磋加了等级门槛（差 8 级以上拒接，审计 #9）：
     本条测「血尽不死」的机制而非门槛，所以把对手等级拉进可切磋区间。 */
  foe.level = Math.max(1, Math.min(foe.level || 1, (p.level || 1) + 7));
  foe.favor = 20;
  foe.level = Math.max(1, Math.min(foe.level || 1, (p.level || 1) + 7)); // 门槛不属本节被测项
  const startRoom = p.room;
  const r0 = w.startDuel(p, foe);
  ok('★ 应战话跟着出来了', txt(r0).length > 0, txt(r0).slice(0, 40));
  const canFight = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));
  const cb = canFight.combatEngineFactory ? null : null;
  /* 直接把 NPC 打到 0 血：走真正的引擎入口，别自己改字段 */
  const C = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));
  const eng = new C.CombatEngine(w) || null;
  ok('★ 战斗引擎认得出这是切磋', !!w.battle.duel);
  foe.hp = 0;
  (eng || { onDeath: null }).onDeath
    ? eng.onDeath(foe, w.battle, [], false)
    : (function () { /* 兜底：没有实例就调钩子 */ })();
  ok('★ NPC 血尽后仍活着（没被标 dead）', !foe.dead, 'dead=' + !!foe.dead + ' hp=' + foe.hp);
  ok('★ NPC 保留 1 滴血', foe.hp === 1, 'hp=' + foe.hp);
  ok('★ 切磋当场判出胜负', w.battle.over === true && w.battle.winner === 'attackers',
    w.battle.winner);
  ok('★ NPC 没有被移出房间（还能看见他）', foe.room === startRoom);

  /* 玩家侧：血尽也不该被送去客栈 */
  const p2e = fresh(99);
  const w2 = p2e.world, pp = w2.player;
  pp.room = startRoom;
  const foe2 = w2.npcsIncludingTemplates(pp.room).find(n => !(n.def || {}).hostile && !/\b狼|虎|熊|蛇/.test(n.name));
  foe2.favor = 20;
  foe2.level = Math.max(1, Math.min(foe2.level || 1, (pp.level || 1) + 7)); // 同一门槛：本条测机制不测门槛
  w2.startDuel(pp, foe2);
  pp.hp = 0;
  const eng2 = new C.CombatEngine(w2);
  eng2.onDeath(pp, w2.battle, [], true);
  ok('★ 玩家血尽后仍在原地（没被抬去客栈）', pp.room === startRoom, '在 ' + pp.room);
  ok('★ 玩家保留 1 滴血', pp.hp === 1, 'hp=' + pp.hp);
  ok('★ 这一场判玩家负', w2.battle.winner === 'defenders', w2.battle.winner);
}

console.log('\n⑤ 旁观者会点评，但不帮任何一方');
{
  const e = fresh();
  const w = e.world, p = w.player;
  /* 挑一间人多的屋子 */
  let best = null, bestN = 0;
  for (const r of Object.values(w.data.rooms)) {
    const ns = w.npcsIncludingTemplates(r.id).filter(n => !(n.def || {}).hostile);
    if (ns.length > bestN) { bestN = ns.length; best = r.id; }
  }
  p.room = best;
  const ns = w.npcsIncludingTemplates(p.room).filter(n => !(n.def || {}).hostile);
  ok('★ 找到一间有旁人的屋子（不然这条测不到）', ns.length >= 2, bestN + ' 人');
  const foe = ns[0];
  const lines = duelMod.bystanderLines(w, foe, true, 2);
  ok('★ 有旁人时会出点评', lines.length > 0, lines.map(l => l.text).join(' ').slice(0, 50));
  ok('★ 点评里不含参战双方（不吃人血馒头）',
    lines.every(l => l.text.indexOf(foe.name) < 0), lines.map(l => l.text).join(' '));
  ok('★ 点评只是话，没有产生战斗/阵营变化',
    !w.battle || w.battle.attackers.length === 1,
    'attackers=' + (w.battle ? w.battle.attackers.length : 0));
}

console.log('\n⑥ NPC 之间也会切磋');
{
  /* ⚠️ 2026-10-17 改隔离场景：出生点清理后（demo 默认关 + 山贼挪走）世界自然分布
     已经凑不出「武人扎堆」的屋子，赌分布赌不到。照 smoke-ux-fixes 先例：spawn
     两个非兽 NPC 进同一房做隔离场景，maybeNpcDuel 跑隔离房——测 duel 机制本身，
     不赌 RNG。 */
  const e = fresh(5);
  const w = e.world, p = w.player;
  const rid = p.room;
  const a = w.spawnNpc('disciple_huashan_0', rid, 1);
  const b = w.spawnNpc('disciple_huashan_1', rid, 1);
  ok('⑥ 隔离场景就位（两位非兽 NPC 同屋）', !!a && !!b && w.npcsIn(rid).filter(n => !n.isPlayer).length >= 2,
    '屋内 ' + w.npcsIn(rid).length + ' 人');
  let found = '';
  for (let i = 0; i < 200 && !found; i++) {
    const l = duelMod.maybeNpcDuel(w);
    if (l.length) found = l.map(x => x.text).join('');
  }
  ok('★ 武人扎堆的地方能撞见 NPC 互相比试', !!found, found.slice(0, 64) || '（没撞上，检查筛人条件）');
  /* maybeNpcDuel 只产出戏，从不 startCombat —— 钉住「不碰玩家战斗态」 */
  ok('★ 互相比试不碰玩家的战斗态', !w.battle, 'battle=' + (w.battle ? '在' : '无'));
}

console.log(`\n===== smoke-duel: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
