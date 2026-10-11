/* ============================================================
 * smoke-city.js —— #67 城市补人守卫
 *
 * 主人 2026-10-11：「有些城市区域（比如襄阳）几乎除了门派中人（也少）没有一个 npc，
 *   这很不合理…… 增加活人感」。当时实测四大名城的**城里一个活人都没有**。
 *
 * 这个脚本守四件事：
 *   ① 六座城 + 白鹿书院的**每一间城市房间都有人**（不是「平均有人」就行）
 *   ② 每座城 **≥3 条**城市支线，且第 3 条带 `require`（触发式）
 *   ③ 支线**真接得上**：giver 存在、挂在该 NPC 的 quests 上、两个目标房间真实存在、
 *      `require` 引用的 flag 在别处真的会被设上（否则那条支线永远不出现，且不报错）
 *   ④ 画像/外貌/对白**没有半成品**：无 `%{}` 残留、性格与画像语气对得上、desc/talk 非空
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const P = require(path.join(ROOT, 'game', 'src', 'core', 'personality.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); } };

const e = new GameEngine({ seed: 20261011 });
e.boot();
const w = e.world;
const rooms = w.data.rooms, npcs = w.data.npcs;

const CITY = {
  xiangyang: '襄阳城', luoyang: '洛阳城', chengdu: '成都府',
  changan: '长安城', gusu: '姑苏', harbor: '江口码头', shuyuan: '白鹿书院',
};
/* ⚠️ 判「城市房」不能只看 region —— 这些 region 里**混着门派房**：
   `xiangyang` 一个 region 底下既有襄阳城的 9 间街面房，也有衡山派 / 铁掌帮 /
   罗汉门 / 伏牛派的山门与库房，还有武馆 `wg_xiangyang`。
   只看 region 会把门派房当成「空房」误报（第一版就是这么错的）。
   所以按**房间 id 前缀**认城市房，门派房一律不算。 */
const CITY_ROOM_PREFIX = {
  xiangyang: ['xiangyang_', 'xy_home_'],
  luoyang: ['luoyang_', 'ly_home_'],
  chengdu: ['chengdu_', 'cd_home_'],
  changan: ['changan_', 'ca_home_'],
  gusu: ['gusu_', 'gs_home_'],
  harbor: ['jn_harbor', 'jn_boat', 'hb_home_'],
  shuyuan: ['jn_school', 'jn_bookshop', 'jn_study_', 'jn_wenmo', 'hm_npcv_102'],
};
const cityRoomsOf = reg => Object.keys(rooms).filter(r => (CITY_ROOM_PREFIX[reg] || []).some(p => r.startsWith(p)));
const CY = Object.keys(npcs).filter(id => id.startsWith('cy_'));

console.log('===== ① 每间城市房都有人 =====');
{
  ok('城市 NPC 已入库', CY.length >= 90, CY.length + ' 人');
  /* ⚠️ 房间人数要数**全部 NPC**（含原有居民），只数 cy_ 会把「本来就有人的房」误判成空房。 */
  const byRoom = {};
  for (const id of Object.keys(npcs)) { const n = npcs[id]; if (n.room) byRoom[n.room] = (byRoom[n.room] || 0) + 1; }
  for (const reg of Object.keys(CITY)) {
    const ids = cityRoomsOf(reg);
    const empty = ids.filter(r => !byRoom[r]);
    ok(`${CITY[reg]} 无空房（${ids.length} 房）`, empty.length === 0,
      empty.length ? '空房：' + empty.join(',') : '');
    const total = ids.reduce((s, r) => s + (byRoom[r] || 0), 0);
    ok(`${CITY[reg]} 城市房密度 >= 0.8/房`, ids.length > 0 && total / ids.length >= 0.8,
      (ids.length ? total / ids.length : 0).toFixed(2) + '（' + total + '/' + ids.length + '）');
  }
}

console.log('===== ② 每城 >=3 条支线，第 3 条是触发式 =====');
{
  const byCity = {};
  for (const q of Object.values(w.data.quests)) {
    if (!/^sq_cy_/.test(q.id)) continue;
    /* 归属城：按 giver 的所在区域判 */
    const g = npcs[q.giver];
    const r = g && rooms[g.room];
    if (r) byCity[r.region] = (byCity[r.region] || []).concat([q]);
  }
  /* 书院不算「城」，不要求它自己有支线（它的支线挂在本城人身上） */
  for (const reg of ['xiangyang', 'luoyang', 'chengdu', 'changan', 'gusu', 'harbor']) {
    const list = byCity[reg] || [];
    ok(`${CITY[reg]} 支线 >=3 条`, list.length >= 3, list.length + ' 条');
    const trig = list.filter(q => q.require);
    ok(`${CITY[reg]} 有触发式支线（带 require）`, trig.length >= 1, trig.length + ' 条');
  }
}

console.log('===== ③ 支线接得上（giver / 挂载 / 房间 / flag 来源） =====');
{
  const allQ = Object.values(w.data.quests);
  const cyQ = allQ.filter(q => /^sq_cy_/.test(q.id));
  ok('支线总数', cyQ.length >= 18, cyQ.length + ' 条');

  /* 收集所有会被设上的 flag */
  const setFlags = new Set();
  for (const q of allQ) for (const st of (q.stages || [])) for (const ef of (st.effects || [])) {
    const raw = ef.raw || (ef.args || []).join(':') || '';
    const m = String(raw).match(/flag:([A-Za-z0-9_]+)/g) || [];
    for (const x of m) setFlags.add(x.slice(5));
  }

  const badNpc = [], badMount = [], badRoom = [], badFlag = [];
  for (const q of cyQ) {
    const g = npcs[q.giver];
    if (!g) { badNpc.push(q.id); continue; }
    if (!Array.isArray(g.quests) || g.quests.indexOf(q.id) < 0) badMount.push(q.id);
    for (const st of (q.stages || [])) for (const t of (st.targets || [])) {
      if (!rooms[t.key]) badRoom.push(q.id + '→' + t.key);
    }
    if (q.require && q.require.flag && !setFlags.has(q.require.flag)) badFlag.push(q.id + '←' + q.require.flag);
  }
  ok('每条支线的 giver 都在', badNpc.length === 0, badNpc.slice(0, 5).join(','));
  ok('★ 每条支线都挂在 giver 的 quests 上（挂不上就是永远点不出来）', badMount.length === 0, badMount.slice(0, 5).join(','));
  ok('每条支线的目标房间都真实存在', badRoom.length === 0, badRoom.slice(0, 5).join(','));
  ok('★ require 引用的 flag 真的有人设（否则那条支线永不出现，且不报错）', badFlag.length === 0, badFlag.slice(0, 5).join(','));

  /* 结构：两段、第一段 next=1、第二段 next=99、第二段必有 menu */
  const badStruct = cyQ.filter(q =>
    !(q.stages && q.stages.length === 2) ||
    q.stages[0].next !== 1 || q.stages[1].next !== 99 ||
    !(q.stages[1].effects || []).some(x => x.type === 'menu'));
  ok('支线结构（两段 + 末段抉择）', badStruct.length === 0, badStruct.map(q => q.id).slice(0, 5).join(','));
}

console.log('===== ④ 画像 / 外貌 / 对白无半成品 =====');
{
  const noP = CY.filter(id => !(npcs[id].portrait && npcs[id].portrait.role));
  ok('每个城市 NPC 都有画像', noP.length === 0, noP.slice(0, 5).join(','));
  const hole = CY.filter(id => /%\{[a-z]+\}/.test(JSON.stringify(npcs[id].portrait)));
  ok('画像没有 %{} 残留', hole.length === 0, hole.slice(0, 5).join(','));
  const noD = CY.filter(id => !npcs[id].desc || npcs[id].desc.length < 8);
  ok('每个人都有外貌描写', noD.length === 0, noD.slice(0, 5).join(','));
  const noT = CY.filter(id => !Array.isArray(npcs[id].talk) || !npcs[id].talk.length);
  ok('每个人都有对白', noT.length === 0, noT.slice(0, 5).join(','));
  const mis = CY.filter(id => {
    const want = P.personaFromVoice(npcs[id]);
    return want && P.personaIdOf(npcs[id]) !== want;
  });
  ok('★ 画像语气与性格一致', mis.length === 0, mis.map(id => npcs[id].name).slice(0, 5).join(','));

  /* 同城同身份不许整段重样（「模板批量生成重复度要量化」） */
  const byRole = {};
  for (const id of CY) {
    const n = npcs[id];
    const k = n.tag || '_';
    (byRole[k] = byRole[k] || []).push(n.portrait.role);
  }
  let dup = 0;
  for (const k of Object.keys(byRole)) {
    const arr = byRole[k];
    if (arr.length > 3 && new Set(arr).size < Math.ceil(arr.length / 2)) dup++;
  }
  ok('同身份画像的重复度不超一半', dup === 0, dup + ' 种身份句式塌缩');
}

console.log(`\n===== smoke-city: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
