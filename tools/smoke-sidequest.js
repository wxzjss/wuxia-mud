/* ============================================================
 * smoke-sidequest.js —— 批次 7 · 画像支线落地专项回归
 *
 * 对象：game/data/61_sidequests.json（52 条 hk_*）+ 26 位挂牌 NPC 的
 *       def.quests / def.actions（同文件并入）+ 3 新房间 + 5 新物品 + 1 新 NPC。
 *
 * 覆盖：
 *   ① sidequest 指针 ⇒ quest 一一对上（**先红后绿**的对象）
 *      · A 层 26 人 sidequest 悬空数 == 0
 *      · 52 条画像 hook 全部有 quest，且 quest.name 与 hook.title 逐字相同（发出==读取）
 *   ② 52 条真 accept → 走腿 → 交任务 完成（stage 99）
 *   ③ ≥12 条非战斗解法真走通（menu 选项 → flag / karma / money / rep / favor / item），且不发战斗
 *   ④ 3 个新房间：出口双向对称 + 从出生点可达（扫全量已加载房间）
 *   ⑤ 「秘密怎么演」的文本真出现在玩家输出里（≥5 条）
 *   ⑥ require 不是恒真：不满足则 accept 失败，满足则成功
 *   ⑦ 挂牌指令真能起任务（NPC def.actions）
 *   ⑧ 数据面：每条 ≥2 个非战斗解法、每条都有抉择 menu
 *
 * 纪律：new GameEngine({seed}).boot().newGame()（不是 new World() 空壳）；
 *       无恒真断言；无静态 grep 当断言。
 * run: node tools/smoke-sidequest.js
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e !== undefined ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e !== undefined ? '  << ' + e : '')); }
}
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}

/* 画像 52 hook（id ↔ title ↔ 挂牌 NPC） */
const PORTRAITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'design', 'portraits-new.json'), 'utf8')).items;
const HOOKS = [];
for (const npcId of Object.keys(PORTRAITS)) {
  for (const h of (PORTRAITS[npcId].hooks || [])) HOOKS.push({ npc: npcId, id: h.id, title: h.title });
}

/* 把一份 require 抬成「已满足」——用于让测试走到被测路径（反面用例另测） */
function grantRequire(cond, p) {
  if (!cond) return;
  if (cond.and) { cond.and.forEach(c => grantRequire(c, p)); return; }
  if (cond.or) { grantRequire(cond.or[0], p); return; }
  if (cond.not) {
    const inner = cond.not;
    if (inner.flag) p.setFlag(inner.flag, false);
    else if (inner.var) p.setVar(inner.var, 0);
    return;
  }
  if (typeof cond.flag === 'string') { p.setFlag(cond.flag, true); return; }
  if (cond.questDone !== undefined) {
    for (const q of [].concat(cond.questDone)) { p.quests[q] = 99; p.setFlag('questdone_' + q, true); }
    return;
  }
  if (cond.var !== undefined) {
    const v = cond.value !== undefined ? cond.value : (cond['>='] !== undefined ? cond['>='] : 1);
    p.setVar(cond.var, v); return;
  }
  if (cond.rep !== undefined) {
    const v = cond.value !== undefined ? cond.value : (cond['>='] !== undefined ? cond['>='] : 1);
    p.reputation[cond.rep] = v; return;
  }
}

/* 走完整条 quest：每个 stage 先到它的目标房间（真实 postProcess 记 room target），
   再回 giver 交任务；返回全部交任务输出行。多腿（Q13）由 stage 顺序自动分段。 */
function runQuestToFinish(e, q) {
  const w = e.world, p = w.player;
  const giverRoom = w.data.npcs[q.npc].room;
  const all = [];
  for (const st of (q.stages || [])) {
    const hasTargets = !!(st.targets && st.targets.length);
    if (!hasTargets) continue;
    for (const t of st.targets) {
      if (t.kind !== 'room') continue;
      w.movePlayerTo(p, t.key);
      e.exec('look');           // 触发 postProcess → 记 room target
    }
    w.movePlayerTo(p, giverRoom);
    all.push(...(e.exec('交任务').lines || []));
  }
  return all;
}

/* ============================================================ */
sec('① sidequest 指针 ⇒ quest 一一对上（**先红后绿**的对象）');
{
  const e = boot(); const w = e.world;
  const dangling = [], mismatch = [];
  for (const npcId of Object.keys(PORTRAITS)) {
    const def = w.data.npcs[npcId];
    const sq = def && def.sidequest;
    if (!sq) { dangling.push(npcId + '(无 sidequest 字段)'); continue; }
    const q = w.getQuest(sq);
    if (!q) { dangling.push(npcId + '→' + sq); continue; }
    if (q.npc !== npcId) mismatch.push(`${sq} 的 npc=${q.npc} ≠ ${npcId}`);
  }
  ok('A 层 26 位 NPC 的 sidequest 悬空数 == 0', dangling.length === 0,
    '悬空 ' + dangling.length + (dangling.length ? '：' + dangling.slice(0, 8).join(', ') : ''));
  ok('每条 hk_* quest 的 npc 字段都指回挂牌那一位', mismatch.length === 0, mismatch.slice(0, 5).join('; '));

  const missing = HOOKS.filter(h => !w.getQuest(h.id));
  ok('52 条画像 hook 全部有对应 quest', missing.length === 0,
    '缺 ' + missing.length + (missing.length ? '：' + missing.slice(0, 6).map(x => x.id).join(', ') : ''));

  /* 发出==读取：quest.name 必须与画像 hook.title 逐字相同，否则 accept <name> 找不到 */
  const nameBad = [];
  for (const h of HOOKS) {
    const q = w.getQuest(h.id);
    if (q && q.name !== h.title) nameBad.push(`${h.id}: name=${q.name} ≠ title=${h.title}`);
  }
  ok('quest.name 与画像 hook.title 逐字相同（发出==读取）', nameBad.length === 0, nameBad.slice(0, 4).join('; '));

  const hkIds = Object.keys(w.data.quests).filter(k => k.startsWith('hk_'));
  /* ⚠️ 2026-10-10 契约更新：计数改成**数据驱动**。
     原来写死 52（只数 `61_sidequests.json` 那批），`67_sidequests2.json` 又补了一批 →
     写死必红。而且判据也换了：原来断「在 design/15 那 26 人名单里」，
     那是**当时那批**的名单；真正要守的是**「画像支线必须长在有画像的人身上」**。
     ⇒ 新判据：每条 hk_* 的委托人**必须有 `portrait`**（比名单更强、且不会随批次失效）。 */
  const cnt = f => Object.keys((require('../game/data/' + f).quests) || {})
    .filter(k => k.startsWith('hk_')).length;
  /* ⚠️ 2026-10-11：`98_sidequests_culture.json` 又补了 9 条（据画像写的文化人物支线）。
     与其每加一批就往这儿补一个文件名（补一次忘一次，忘了就红），
     不如**把所有 hk_ 的来源一起数**：数据文件里有多少，运行时就得有多少。 */
  const dataDir = path.join(ROOT, 'game', 'data');
  let fromFiles = 0;
  for (const f of fs.readdirSync(dataDir)) {
    if (!/^\d+_.*\.json$/.test(f)) continue;
    let j = null;
    try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
    const qs = (j && j.quests) || {};
    fromFiles += Object.keys(qs).filter(k => k.startsWith('hk_')).length;
  }
  ok(`quests 表里 hk_* 与各数据文件之和一致`,
    hkIds.length === fromFiles, `数据 ${fromFiles} 条 / 运行时 ${hkIds.length} 条`);
  const noPortrait = hkIds.filter(k => {
    const q = w.data.quests[k] || {};
    const def = w.data.npcs[q.giver || q.npc];
    return !def || !def.portrait;
  });
  ok('★ 每条 hk_* 的委托人都真有画像（画像支线必须长在画像上）',
    noPortrait.length === 0, noPortrait.slice(0, 5).join(', '));
  /* 桩：确认别的集合没被 61 改坏（60_quests 的 sq_npcv_* 仍在，未受影响） */
  ok('原 60_quests 的 sq_npcv_* 未被 61 覆盖（仍 ≥ 260 条）',
    Object.keys(w.data.quests).filter(k => /^sq_npcv_/.test(k)).length >= 260,
    Object.keys(w.data.quests).filter(k => /^sq_npcv_/.test(k)).length);
}

/* ============================================================ */
sec('② 52 条：accept → 走腿 → 交任务 完成');
{
  let accOK = 0, doneOK = 0, menuOK = 0;
  const bad = [];
  for (const h of HOOKS) {
    const e = boot(); const w = e.world, p = w.player;
    const q = w.getQuest(h.id);
    if (!q) { bad.push(h.id + '(无 quest)'); continue; }
    grantRequire(q.require, p);
    const r = e.exec('accept ' + q.name);
    if (p.questStage(h.id) !== 0) { bad.push(h.id + '(accept 未开始)'); continue; }
    accOK++;
    const lines = runQuestToFinish(e, q);
    const hasMenu = lines.some(l => l.kind === 'menu');
    if (hasMenu) menuOK++;
    if (p.questStage(h.id) === 99) doneOK++;
    else bad.push(h.id + `(stage=${p.questStage(h.id)})`);
    /* 抉择必须存在且可点 */
    const menu = lines.find(l => l.kind === 'menu');
    if (menu && menu.options && menu.options.length >= 2) {
      e.menuPick(menu.options[0]);
    } else {
      bad.push(h.id + '(无 menu 或选项<2)');
    }
  }
  ok('52 条全部能 accept', accOK === 52, accOK + '/52');
  ok('52 条全部能推进到完成（stage 99）', doneOK === 52, doneOK + '/52' + (bad.length ? ' 问题：' + bad.slice(0, 5).join(', ') : ''));
  ok('52 条交任务时都弹出抉择 menu', menuOK === 52, menuOK + '/52');
}

/* ============================================================ */
sec('③ 非战斗解法真走通（≥12 条，不发战斗）');
{
  /* {id, opt, flag, karma?, money?, rep?:[who,v], favor?:[npc,v], newItem?} —— opt=-1 表示最后一项 */
  const CASES = [
    { id: 'hk_npcv_241_yinzi', opt: 0, flag: 'hk_npcv_241_yinzi_hide', money: 300, karma: -15 },
    { id: 'hk_npcv_241_yinzi', opt: 1, flag: 'hk_npcv_241_yinzi_report', rep: ['朝廷', 20] },
    { id: 'hk_npcv_010_fuxue', opt: 0, flag: 'hk_npcv_010_fuxue_money', money: -80, favor: ['npcv_010', 30] },
    { id: 'hk_npcv_154_maishen', opt: 0, flag: 'hk_npcv_154_maishen_free', karma: 15, consumedItem: 'deed_girl' },
    { id: 'hk_npcv_009_baizi', opt: 1, flag: 'hk_npcv_009_baizi_grey', favor: ['npcv_009', -10] },
    { id: 'hk_npcv_208_feng', opt: 1, flag: 'hk_npcv_208_feng_loose', favor: ['npcv_208', -25], rep: ['丐帮', 15] },
    { id: 'hk_npcv_065_siqiliang', opt: 2, flag: 'hk_npcv_065_siqiliang_truth', favor: ['npcv_073', 20] },
    { id: 'hk_npcv_223_meimei', opt: 0, flag: 'hk_npcv_223_meimei_found', karma: 15 },   // 双目标腿
    { id: 'hk_npcv_174_tuntang', opt: 1, flag: 'hk_npcv_174_tuntang_report', favor: ['npcv_174', -50] },
    { id: 'hk_npcv_240_laocaifeng', opt: 0, flag: 'hk_npcv_240_laocaifeng_honest', favor: ['npcv_240', 30] },
    { id: 'hk_npcv_126_xianghuo', opt: 1, flag: 'hk_npcv_126_xianghuo_keep', money: 200 },
    { id: 'hk_npcv_095_qi', opt: 1, flag: 'hk_npcv_095_qi_show', rep: ['朝廷', 20] },
    { id: 'hk_npcv_082_hua', opt: 0, flag: 'hk_npcv_082_hua_clear', favor: ['npcv_149', 40] },
    { id: 'hk_npcv_115_mingan', opt: 0, flag: 'hk_npcv_115_mingan_true', favor: ['npcv_115', 40] },
  ];
  let nOK = 0;
  for (const c of CASES) {
    const e = boot(); const w = e.world, p = w.player;
    const q = w.getQuest(c.id);
    if (!q) { ok(c.id + ' 非战斗解法', false, '无 quest'); continue; }
    grantRequire(q.require, p);
    p.money = 10000;
    e.exec('accept ' + q.name);
    const lines = runQuestToFinish(e, q);
    const menu = lines.find(l => l.kind === 'menu');
    if (!menu) { ok(c.id + ' 非战斗解法', false, '无 menu'); continue; }

    const preMoney = p.money, preKarma = p.karma;
    const preRep = c.rep ? (p.reputation[c.rep[0]] || 0) : 0;
    const idx = c.opt < 0 ? menu.options.length - 1 : c.opt;
    const favBefore = c.favor ? (p.getVar('favor_' + c.favor[0]) || 0) : 0;
    const invBefore = c.consumedItem ? p.countItem(c.consumedItem) : 0;
    /* 该选项必须真含 favor 效果（原样保留）+ 镜像变量 */
    let favEffectSeen = false;
    if (c.favor) {
      const raw = String(menu.options[idx].effects.join(';'));
      favEffectSeen = raw.includes(`favor:${c.favor[0]}:${c.favor[1]}`)
        || raw.includes(`favor:${c.favor[0]}:`);
    }
    e.menuPick(menu.options[idx]);

    const checks = [];
    checks.push(p.hasFlag(c.flag));
    if (c.money !== undefined) checks.push((p.money - preMoney) === c.money);
    if (c.karma !== undefined) checks.push((p.karma - preKarma) === c.karma);
    if (c.rep) checks.push((p.reputation[c.rep[0]] - preRep) === c.rep[1]);
    /* favor：引擎 `favor:` 对模板 NPC 是空操作（实例按 uid 存），故断言镜像变量 */
    if (c.favor) {
      checks.push(favEffectSeen);
      checks.push((p.getVar('favor_' + c.favor[0]) - favBefore) === c.favor[1]);
    }
    if (c.consumedItem) checks.push(invBefore > 0 && p.countItem(c.consumedItem) === invBefore - 1);
    checks.push(!w.battle);   // 非战斗：没进战斗
    const good = checks.every(Boolean);
    if (good) nOK++;
    ok('非战斗解法：' + c.id + ' 选项[' + idx + ']', good,
      good ? '' : JSON.stringify({ flag: p.hasFlag(c.flag), money: p.money - preMoney, karma: p.karma - preKarma, favorVar: c.favor ? p.getVar('favor_' + c.favor[0]) - favBefore : null, favEffectSeen, battle: !!w.battle }));
  }
  ok('非战斗解法走通 ≥ 12 条', nOK >= 12, nOK + '/' + CASES.length);
}

/* ============================================================ */
sec('④ 新房间：双向对称 + 从出生点可达（扫全量已加载房间）');
{
  const e = boot(); const w = e.world;
  const REV = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };
  const newRooms = ['gusu_fengqiao', 'jn_granary', 'jn_yizhuang'];

  const exists = newRooms.filter(r => !!w.getRoom(r));
  ok('3 个新房间都已并入', exists.length === 3, exists.join(','));

  /* 全量对称性（含 61 合并来的）。
     只扫**基础数据**房间：模组（demo_map/test_mod）自带房间可能故意单向，
     与本任务无关，混进来会把红打在别人身上。base 房 __source = 「基础数据:…」。 */
  const isBaseRoom = rid => {
    const r = w.data.rooms[rid];
    return newRooms.includes(rid) || !r.__source || /基础数据/.test(r.__source);
  };
  const asym = [];
  for (const rid of Object.keys(w.data.rooms)) {
    if (!isBaseRoom(rid)) continue;
    const r = w.data.rooms[rid];
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const to = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(to);
      if (!tr) { asym.push(rid + '.' + d + '→' + to + '(缺失)'); continue; }
      const back = tr.exits && tr.exits[REV[d]];
      const backId = typeof back === 'string' ? back : (back && back.to);
      if (backId !== rid) asym.push(`${rid}.${d}→${to} 但 ${to}.${REV[d]}=${backId}`);
    }
  }
  ok('全量房间出口双向对称（含合并来的）', asym.length === 0, '非对称 ' + asym.length + (asym.length ? '：' + asym.slice(0, 5).join('; ') : ''));

  /* 从出生点 BFS 可达 */
  const start = w.data.meta.startRoom;
  const seen = new Set([start]); const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const r = w.getRoom(cur); if (!r) continue;
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const to = typeof ex === 'string' ? ex : ex.to;
      if (!seen.has(to) && w.getRoom(to)) { seen.add(to); queue.push(to); }
    }
  }
  for (const rid of newRooms) {
    ok('新房间从出生点可达：' + rid, seen.has(rid), seen.has(rid) ? '' : '（不可达）');
  }
  /* 反向：新房间也回得去（可达图对称） */
  ok('新房间回程边指向的房都可达', newRooms.every(rid => {
    const r = w.getRoom(rid);
    if (!r) return false;
    return Object.keys(r.exits).every(d => {
      const ex = r.exits[d];
      return seen.has(typeof ex === 'string' ? ex : ex.to);
    });
  }));
}

/* ============================================================ */
sec('⑤ 「秘密怎么演」的文本真出现在玩家输出里（≥5 条）');
{
  const PICK = ['hk_npcv_241_yinzi', 'hk_npcv_154_maishen', 'hk_npcv_223_meimei', 'hk_npcv_065_ziju', 'hk_npcv_082_mibao', 'hk_npcv_164_sirenzhang'];
  let hit = 0;
  for (const id of PICK) {
    const e = boot(); const w = e.world, p = w.player;
    const q = w.getQuest(id);
    if (!q) { ok('秘密演出：' + id, false, '无 quest'); continue; }
    grantRequire(q.require, p);
    e.exec('accept ' + q.name);
    const lines = runQuestToFinish(e, q);
    const text = lines.map(l => l.text || '').join('｜');
    /* 该 quest 的 reveal 至少有一句 raw 出现在输出里 */
    const reveal = (q.stages[q.stages.length - 1].effects || []).filter(f => f.type === 'say' || f.type === 'narrate').map(f => f.raw);
    const appeared = reveal.filter(t => text.includes(t.replace(/^[「」]+|[「」]+$/g, '')) || text.includes(t));
    const good = reveal.length > 0 && appeared.length > 0;
    if (good) hit++;
    ok('秘密演出：' + id, good, good ? `（${appeared.length}/${reveal.length} 句）` : '未出现在输出：' + reveal[0]);
  }
  ok('秘密演出 ≥ 5 条', hit >= 5, hit + '/' + PICK.length);
}

/* ============================================================ */
sec('⑥ require 不是恒真：不满足→接不到，满足→接得到');
{
  /* 正面：假前置 flag 未被设时，accept 必须失败 */
  const neg = [
    { id: 'hk_npcv_241_guancai', need: { questDone: 'hk_npcv_241_yinzi' } },   // 未完成前一 hook
    { id: 'hk_npcv_180_beibian', need: { not: { flag: 'know_zhenyi' } } },      // 需 know_zhenyi **未**设
  ];
  for (const c of neg) {
    const e = boot(); const w = e.world, p = w.player;
    const q = w.getQuest(c.id);
    if (!q) { ok('require 反面：' + c.id, false, '无 quest'); continue; }
    if (c.id === 'hk_npcv_180_beibian') p.setFlag('know_zhenyi', true);      // 破坏前置
    const before = p.questStage(c.id);
    e.exec('accept ' + q.name);
    const blocked = p.questStage(c.id) < 0 && before < 0;
    ok('require 反面：不满足时 ' + c.id + ' 接不到', blocked, 'stage=' + p.questStage(c.id));
    /* 破坏后（questDone 补上 / know_zhenyi 清掉）必须能接 */
    if (c.need.questDone) { p.quests[c.need.questDone] = 99; p.setFlag('questdone_' + c.need.questDone, true); }
    if (c.need.not) p.setFlag(c.need.not.flag, false);
    e.exec('accept ' + q.name);
    ok('require 正面：满足后 ' + c.id + ' 接得到', p.questStage(c.id) === 0, 'stage=' + p.questStage(c.id));
  }
  /* 无 require 的 quest 必须能直接接（证明 require 不是「一律拦住」） */
  const e2 = boot(); const p2 = e2.world.player;
  e2.exec('accept 绸缎庄的窟窿');
  ok('无前置的支线可直接接（require 非空条件拦）', p2.questStage('hk_npcv_241_yinzi') === 0);
}

/* ============================================================ */
sec('⑦ 挂牌指令真能起任务（NPC def.actions）');
{
  const PICK = ['hk_npcv_241_yinzi', 'hk_npcv_010_haosun', 'hk_npcv_090_jieyao'];
  for (const id of PICK) {
    const e = boot(); const w = e.world, p = w.player;
    const q = w.getQuest(id);
    const room = w.data.npcs[q.npc].room;
    w.movePlayerTo(p, room);
    e.exec('look');      // 让 NPC 实例落进房间
    const action = (w.data.npcs[q.npc].actions || []).find(a => a.cmd);
    const before = p.questStage(id);
    e.exec(action.cmd);
    ok('挂牌指令「' + action.cmd + '」起任务：' + id,
      before < 0 && p.questStage(id) === 0, `before=${before} after=${p.questStage(id)}`);
  }
}

/* ============================================================ */
sec('⑧ 数据面：每条都有 ≥2 个非战斗解法 + 抉择 menu');
{
  const e = boot(); const w = e.world;
  let noMenu = [], fewNonCombat = [];
  for (const h of HOOKS) {
    const q = w.getQuest(h.id);
    if (!q) { noMenu.push(h.id); continue; }
    const last = q.stages[q.stages.length - 1];
    const menuEffect = (last.effects || []).find(f => f.type === 'menu');
    if (!menuEffect) { noMenu.push(h.id); continue; }
    const rawOpts = String(menuEffect.raw).split('|')[1].split(';;');
    const nonCombat = rawOpts.filter(o => !/>combat:/.test(o) && !/;combat:/.test(o));
    if (nonCombat.length < 2) fewNonCombat.push(h.id + '(' + nonCombat.length + ')');
  }
  ok('52 条均有抉择 menu', noMenu.length === 0, noMenu.slice(0, 5).join(', '));
  ok('52 条均有 ≥2 个非战斗解法', fewNonCombat.length === 0, fewNonCombat.slice(0, 5).join(', '));
}

/* ============================================================ */
sec('⑨ 前置闸门端到端：first 进行中 → second 不可接；first 完成 → 才可接');
{
  /* 与 world-interact 的 §6.13/§6.14 交叉验证：它在**菜单渲染**路径上钉，
     这里在**任务面板 + accept**路径上钉，两边互为独立证据。 */
  const e = boot(); const w = e.world, p = w.player;
  const FIRST = 'hk_npcv_241_yinzi', SECOND = 'hk_npcv_241_guancai';
  const q1 = w.getQuest(FIRST), q2 = w.getQuest(SECOND);
  const giverRoom = w.data.npcs['npcv_241'].room;
  const panelHas = id => (e.exec('任务').lines || []).some(l => l.quest === id);

  w.movePlayerTo(p, giverRoom);
  e.exec('look');                                   // 让挂牌 NPC 落进房间
  ok('未开始：first（无前置）出现在「可接任务」', panelHas(FIRST));
  ok('未开始：second（前置未满足）**不**出现在「可接任务」', !panelHas(SECOND));
  e.exec('accept ' + q2.name);
  ok('未开始：second 直接 accept 被拒', p.questStage(SECOND) < 0, 'stage=' + p.questStage(SECOND));

  e.exec('accept ' + q1.name);
  ok('first 已接（stage 0）', p.questStage(FIRST) === 0);
  ok('first 进行中：second 仍未出现在「可接任务」', !panelHas(SECOND));
  e.exec('accept ' + q2.name);
  ok('first 进行中：second 仍接不到', p.questStage(SECOND) < 0, 'stage=' + p.questStage(SECOND));

  runQuestToFinish(e, q1);
  ok('first 真走完（stage 99）', p.questStage(FIRST) === 99, 'stage=' + p.questStage(FIRST));
  w.movePlayerTo(p, giverRoom); e.exec('look');
  ok('first 完成后：second **出现**在「可接任务」', panelHas(SECOND));
  e.exec('accept ' + q2.name);
  ok('first 完成后：second 可接（stage 0）', p.questStage(SECOND) === 0, 'stage=' + p.questStage(SECOND));
}

console.log(`\n${fail === 0 ? '✔ 全绿' : '✘ 有红'}：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('失败项：\n - ' + fails.join('\n - '));
process.exit(fail === 0 ? 0 : 1);
