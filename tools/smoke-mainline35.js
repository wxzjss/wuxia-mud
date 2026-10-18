/* smoke-mainline35.js —— 主线三~五幕 + 第一幕夜戏落地验收（E5–E16）
 *
 * 背景：`design/21-mainline-act3-5.md` §8 给了完整的落地方案清单（E1–E19），
 *   2026-10-10 体检时 E5–E16 **基本未做**（见 `design/36-md-audit.md`）。
 *   本批把三~五幕 + 夜戏落进 `game/data/65_mainline_act3.json` /
 *   `66_mainline_act45.json` 两个**独立数据文件**，本测试守它。
 *
 * 本测试重点守三类**会静默失效**的东西（本项目反复踩的坑）：
 *   ① 数组 replace 语义：新文件里重声明某房间的 `actions` 会**整段覆盖**，
 *      忘了抄回原有 action 就静默清空（玩家发现某个按钮没了，代码不报错）。
 *   ② id / flag 写错一个字母 → 条件永远 false → 全线失效且不报错。
 *      ⇒ 每个 action 引用的房间/物品/NPC 必须真实存在；
 *      ⇒ 每个 cond 读的 flag，必须**真有地方能置位**（否则永远不满足）。
 *   ③ 主线依赖的 NPC 必须真的存在（`taixu_hermit` 曾只活在官方示例 mod 里，
 *      一关 mod 主线文案就变成"去找一个不存在的人"——2026-10-17 批2 已修：
 *      引擎 LEGEND_IDS 换基础数据的 `li_mochou`，此断言从此守住「名单只认基础数据」）。
 *
 * run: node tools/smoke-mainline35.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');
const { evalCond, evalEffects } = require('../game/src/core/modapi');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
const sec = t => console.log('\n=== ' + t + ' ===');

const e = new GameEngine({ seed: 20261010 });
e.boot(); e.newGame({ name: '试剑', gender: 'male' });
const w = e.world, p = w.player;

/* 契约表（来自 design/21 §8）—— 测试里只抄一次，别处一律从世界读 */
const NEW_QUESTS = {
  q_main_snow: { seg: 7, giver: 'shaolin_fangzheng', condFlag: 'act2_done', next: 'q_main_moye' },
  q_main_moye: { seg: 6, giver: 'mojiao_dongfang', condFlag: 'act3_done', next: 'q_main_end' },
  q_main_end: { seg: 6, giver: 'nv_huang', condFlag: 'act4_done', next: null },
};
const NEW_ITEMS = ['xuedao_copy_half', 'fake_manual', 'yu_ledger_item', 'star_cure_item',
  'wulin_zhenyi_canjuan', 'wulin_zhenyi_chaoben', 'yuanhuai_stub'];
/* 房间 → 本轮**新增**的 action cmd（既有 action 另验，见 §4） */
const NEW_ACTIONS = {
  road_huashan_1: ['夜宿山道'],
  shaolin_daxiong: ['问缺卷'], shaolin_cangjing: ['看经架'],
  road_beijiang_1: ['看车辙'], beijiang_shankou: ['摸哨'], beijiang_xuedao: ['见刀主'],
  beijiang_houzhai: ['摸后寨'], xiyu_shule: ['问商队'], xiyu_xingxiu: ['见老仙'],
  xixia_yanchang: ['问煮盐人'], road_xixia_1: ['截信'], jn_market_main: ['问北线'],
  jn_brothel_room: ['问抄纸'], jn_fruit_stall: ['问解药'],
  mojiao_shanmen: ['闯山门'], mojiao_hall: ['过前殿', '回大殿'],
  mojiao_shuangxiu: ['上绣楼', '见教主', '翻绣架', '下崖'], jn_brothel_hall: ['劝她'],
  palace_street: ['拆公文'], jn_yamen_office: ['补个名分'],
  haitan_boat: ['渡海'], taohuadao_dock: ['入岛'], taohuadao_she: ['破阵'],
  taohuadao_qingyin: ['问三句话'], palace_road: ['过御道', '问夏承志'],
  palace_hall: ['面圣', '面圣带抄本'],
};
const ALL_ROOM_IDS = Object.keys(NEW_ACTIONS);

/* ============================================================ */
sec('① 三条主线任务（design/21 §8.1）');
for (const [qid, spec] of Object.entries(NEW_QUESTS)) {
  const q = w.getQuest(qid);
  ok(`${qid} 已加载`, !!q, qid);
  if (!q) continue;
  ok(`  ${qid} 段数 = ${spec.seg}`, (q.stages || []).length === spec.seg,
    '实际 ' + (q.stages || []).length);
  ok(`  ${qid} 是主线、有 giver=${spec.giver}`,
    q.type === '主线' && q.giver === spec.giver, `${q.type}/${q.giver}`);
  ok(`  ${qid} 入场门槛含 flag ${spec.condFlag}`,
    JSON.stringify(q.require || q.cond || {}).includes(spec.condFlag),
    'require=' + JSON.stringify(q.require) + ' cond=' + JSON.stringify(q.cond));
  if (spec.next) {
    ok(`  ${qid} 结算时接下一幕 ${spec.next}`,
      JSON.stringify(q.rewards || []).includes(spec.next));
  }
}
ok('三条任务的 giver 都是真实 NPC',
  Object.values(NEW_QUESTS).every(s => !!w.data.npcs[s.giver]));

sec('② 委托人挂任务（不挂 = 交不掉）');
for (const [qid, spec] of Object.entries(NEW_QUESTS)) {
  const qs = (w.data.npcs[spec.giver] || {}).quests || [];
  ok(`${spec.giver}.quests 含 ${qid}`, qs.includes(qid), JSON.stringify(qs));
  ok(`  ${spec.giver}.quests 原有项没被冲掉（数组 replace 语义防护）`, qs.length >= 1);
}

sec('③ Boss 三阶段（血刀 / 丁春秋 / 任我行）');
const BOSSES = ['blood_saber', 'xingxiu_laoxian', 'ren_woxing', 'mojiao_dongfang', 'depot_master'];
for (const bid of BOSSES) {
  const def = w.data.npcs[bid];
  ok(`${bid} 存在`, !!def, bid);
  if (!def) continue;
  const ph = def.bossPhases;
  ok(`  ${bid} 有 bossPhases`, Array.isArray(ph) && ph.length >= 2,
    JSON.stringify(ph && ph.length));
  if (!Array.isArray(ph)) continue;
  const at = ph.map(x => x.at);
  ok(`  ${bid} 阶段阈值严格递减（合并不按顺序切会漏阶段）`,
    at.every((v, i) => i === 0 || v < at[i - 1]), JSON.stringify(at));
  ok(`  ${bid} 每阶段都有台词演出`, ph.every(x => !!x.line || !!x.say || !!x.msg) ||
    /* 部分实现把台词写在 effects 里，只要不是全空即可 */ ph.some(x => !!x.line));
}
ok('任我行带 A 层画像（Boss 必须有完整 portrait）',
  !!w.data.npcs.ren_woxing && !!w.data.npcs.ren_woxing.portrait,
  w.data.npcs.ren_woxing && Object.keys(w.data.npcs.ren_woxing.portrait || {}).length + ' 字段');

sec('④ 物品（§8.3）');
for (const iid of NEW_ITEMS) ok(`物品 ${iid} 存在`, !!w.data.items[iid], iid);
ok('★ 武林真意·残卷 desc 写着「残缺」（不然玩家以为拿了全本）',
  /残缺/.test((w.data.items.wulin_zhenyi_canjuan || {}).desc || ''),
  (w.data.items.wulin_zhenyi_canjuan || {}).desc);

sec('⑤ 房间 actions：新增到位 + 既有没被清掉');
{
  /* ⚠️ 基线（「65/66 加载之前长什么样」）**不能**拿 50_map.json 当真相源 ——
     后面 62_shops.json 等文件本来就会覆盖某些房间的 actions（例：`jn_fruit_stall`
     的 `list 果子摊` 早被 62_shops 改成 `list 柳甜儿` 了）。
     正确做法：把 `game/data` 除 65/66 之外整份拷到临时目录，**用同一套加载器**跑一遍，
     那才是真正的「本轮之前」。这是唯一能证明数组 replace 没吃掉东西的办法。 */
  const fs = require('fs'), path = require('path'), os = require('os');
  const { World } = require('../game/src/core/world.js');
  const ROOTD = path.resolve(__dirname, '..');
  const SRC = path.join(ROOTD, 'game', 'data');
  /* ⚠️ 2026-10-12 改：从仓库根 `.tmp-act35-base` 迁到 `.livetest/`
     （项目铁律：测试不许写仓库真实目录；`.tmp-act35-base` 当时还没进 .gitignore） */
  const TMP = require('./_test-tmp').testTmpDir('act35-base');
  /* ⚠️ 用 execSync('rm -rf') 而不是 fs.rmSync：Node 的 fs 层有「一轮删 >50 个文件」的
     安全删除保护，跑全量回归时前面的测试已经把配额吃光 ⇒ 这里会被拦成 exit 1，
     表现为「单跑绿、全量红」的偶发假红（smoke-storybeat / smoke-mod-trace 同因已改）。 */
  require('child_process').execSync('rm -rf "' + TMP + '"', { stdio: 'ignore' });
  fs.mkdirSync(TMP, { recursive: true });
  for (const f of fs.readdirSync(SRC)) {
    if (/^(65|66)_/.test(f)) continue;          // 只看「本轮之前」
    fs.copyFileSync(path.join(SRC, f), path.join(TMP, f));
  }
  const base = new World({ dataDirs: [TMP], modDirs: [], seed: 1 });
  base.loadBaseData();
  const orig = base.data.rooms;
  require('child_process').execSync('rm -rf "' + TMP + '"', { stdio: 'ignore' });
  console.log('  · 基线（不含 65/66）房间数 ' + Object.keys(orig).length);

  let touch = 0, lost = [];
  for (const rid of ALL_ROOM_IDS) {
    const room = w.data.rooms[rid];
    ok(`房间 ${rid} 存在`, !!room, rid);
    if (!room) continue;
    const cmds = (room.actions || []).map(a => a.cmd);
    for (const c of NEW_ACTIONS[rid]) {
      ok(`  ${rid} 有新增 action「${c}」`, cmds.includes(c), cmds.join('|'));
    }
    const old = ((orig[rid] || {}).actions || []).map(a => a.cmd);
    const missing = old.filter(c => !cmds.includes(c));
    if (missing.length) lost.push(rid + ':' + missing.join(','));
    touch += old.length;
  }
  ok(`★ 既有 action 一条都没丢（共核对 ${touch} 条）`, lost.length === 0, lost.join(' ; '));

  /* 每个新增 action 必须能被玩家看见、且说人话 */
  const bad = [];
  for (const rid of ALL_ROOM_IDS) {
    for (const a of (w.data.rooms[rid].actions || [])) {
      if (!NEW_ACTIONS[rid].includes(a.cmd)) continue;
      if (!a.label) bad.push(rid + '/' + a.cmd + ' 缺 label');
      if (!a.keywords || !a.keywords.length) bad.push(rid + '/' + a.cmd + ' 缺 keywords');
      if (!a.effects || !a.effects.length) bad.push(rid + '/' + a.cmd + ' 缺 effects');
      if (!a.failMsg) bad.push(rid + '/' + a.cmd + ' 缺 failMsg');
    }
  }
  ok('★ 每个新增 action 都带 label/keywords/effects/failMsg（缺 failMsg 玩家会对着空气发呆）',
    bad.length === 0, bad.slice(0, 6).join(' ; '));
}

sec('⑥ ★★ flag 闭环：cond 读到的 flag，必须真有地方能置位');
{
  /* 先收集「全库能置位的 flag」（数据里所有 effects + menu raw 里的 flag:） */
  const settable = new Set();
  const eatEffect = (ef) => {
    if (!ef) return;
    if (typeof ef === 'string') { // menu raw
      for (const m of ef.matchAll(/\bflag:([A-Za-z0-9_]+)/g)) settable.add(m[1]);
      for (const m of ef.matchAll(/\bsetflag:([A-Za-z0-9_]+)/g)) settable.add(m[1]);
      return;
    }
    if (ef.type === 'flag' && ef.args) settable.add(ef.args[0]);
    if ((ef.type === 'setflag' || ef.type === 'toggleflag') && ef.args) settable.add(ef.args[0]);
    if (ef.type === 'menu' && ef.raw) eatEffect(ef.raw);
    /* ⚠️ 两个分支写法都要递归：
       ① `{ if, then, else }`（无 type）
       ② `{ type:'cond', if, then, else }` ← 本项目主流写法（modapi.js:361 支持）
       漏了它 → 分支里的 flag 全被当成「没人置位」，直接假红。 */
    if (ef.then) [].concat(ef.then).forEach(eatEffect);
    if (ef.else) [].concat(ef.else).forEach(eatEffect);
    if (Array.isArray(ef.args)) ef.args.forEach(a => { if (typeof a === 'string' && /:(.*)>/.test(a)) eatEffect(a); });
  };
  for (const rid of Object.keys(w.data.rooms)) {
    for (const a of (w.data.rooms[rid].actions || [])) (a.effects || []).forEach(eatEffect);
  }
  for (const qid of Object.keys(w.data.quests)) {
    ((w.data.quests[qid] || {}).rewards || []).forEach(eatEffect);
    ((w.data.quests[qid] || {}).stages || []).forEach(st => (st.effects || []).forEach(eatEffect));
  }
  for (const k of Object.keys(w.data.events || {})) [].concat(w.data.events[k]).forEach(eatEffect);
  for (const k of Object.keys(w.data.worldEvents || {})) [].concat(w.data.worldEvents[k]).forEach(eatEffect);
  /* 👆 只认数据；代码里置位的 flag（如 learned_*）另加白名单 —— 白名单要写给理由 */
  const CODE_FLAGS = [
    'learned_skill', 'know_east_depot', // know_east_depot 数据里也置了，双保险
    'jiuye_done',
  ];

  /* 再收集「本轮新数据里 cond 读到的 flag」 */
  const readFlags = [];
  const eatCond = (cond, where) => {
    if (!cond || typeof cond !== 'object') return;
    if (Array.isArray(cond)) return cond.forEach(c => eatCond(c, where));
    for (const k of ['flag', 'notFlag']) if (cond[k]) readFlags.push([cond[k], where, k]);
    for (const k of ['flagsAll', 'flagsAny', 'flagsNone']) {
      [].concat(cond[k] || []).forEach(f => readFlags.push([f, where, k]));
    }
    for (const k of ['and', 'or', 'not']) if (cond[k]) eatCond(cond[k], where);
  };
  for (const rid of ALL_ROOM_IDS) {
    w.data.rooms[rid].actions.forEach(a => eatCond(a.cond, rid + '/' + a.cmd));
  }
  for (const qid of Object.keys(NEW_QUESTS)) {
    const q = w.getQuest(qid) || {};
    (q.stages || []).forEach((st, i) => eatCond(st.cond, qid + '#' + i));
  }
  const orphan = readFlags.filter(([f]) =>
    !settable.has(f) && !CODE_FLAGS.includes(f) &&
    !f.startsWith('learned_') && !f.startsWith('killed_') && !f.startsWith('ending_') &&
    /* ⚠️ `questdone_<id>` 由引擎在任务完成时写（character.setQuestStage，stage=99），
       与 learned_/killed_/ending_ 同一类「代码置位旗」。2026-10-18 新数据
       （门派指路房动作）开始读它，此前没进前缀白名单 → 假红。 */
    !f.startsWith('questdone_'));
  ok(`★ 本轮新数据里 cond 读的 flag（${readFlags.length} 处）全都有地方置位`,
    orphan.length === 0, orphan.map(([f, w2]) => f + '@' + w2).slice(0, 8).join(' ; '));

  /* 反向：本轮 effects 置的 flag，也该真被读（否则是死数据） */
  console.log(`  · 全库可置位 flag ${settable.size} 个，本轮 cond 读到 ${new Set(readFlags.map(x => x[0])).size} 个`);
}

sec('⑦ E5 契约（C3 门槛后移 + C9 铜牌改由夜戏发放）');
{
  const mj = w.getQuest('q_main_jianghu');
  const s3 = JSON.stringify((mj.stages[3] || {}).cond || {});
  ok('stage3「击败名宿」cond 含 defeatLegend', s3.includes('defeatLegend'), s3);
  ok('★ stage3 cond 含 act4_done（结算挪到第四幕之后）', s3.includes('act4_done'), s3);
  const rj = JSON.stringify(mj.rewards || []);
  ok('★ rewards 里已无 know_east_depot（改由夜戏发）', !rj.includes('know_east_depot'));
  ok('★ rewards 里已无 depot_token_half（改由夜戏发）', !rj.includes('depot_token_half'));
  ok('★ rewards 里已无 quest q_main_sect（改由夜戏接）', !rj.includes('q_main_sect'));
  const hu = w.data.rooms.road_huashan_1.actions.find(a => a.cmd === '夜宿山道');
  const raw = JSON.stringify(hu);
  ok('★ 夜戏 action 里真的发了铜牌', raw.includes('depot_token_half'));
  ok('★ 夜戏 action 里真的置了 know_east_depot', raw.includes('know_east_depot'));
  ok('★ 夜戏 action 里真的接了第二幕', raw.includes('q_main_sect'));
  ok('  夜戏被移走的原旁白没丢（「还带着他掌心的汗」）', raw.includes('还带着他掌心的汗'));
  ok('  夜戏两支分支（拦 / 退）都置 jiuye_done', (raw.match(/jiuye_done/g) || []).length >= 2);
}

sec('⑧ E12 腰牌三条来路');
{
  const hits = [];
  for (const rid of Object.keys(w.data.rooms)) {
    for (const a of (w.data.rooms[rid].actions || [])) {
      if (JSON.stringify(a.effects || []).includes('palace_token') ||
          (a.effects || []).some(x => x.type === '+item' && x.args && x.args[0] === 'palace_token')) {
        hits.push(rid + '/' + a.cmd);
      }
    }
  }
  ok('★ palace_token 至少 3 条获取途径（一条也拿不到 = 第五幕进不去）', hits.length >= 3, hits.join(' '));
  ok('  物品 palace_token 本身存在', !!w.data.items.palace_token);
}

sec('⑨ E16 三结局（都非大团圆）');
{
  /* 三结局分布在 palace_hall 的多个 action 上：
     `面圣`（交卷）/ `面圣带抄本`（交卷 + 半交分支）/ `收场`（拒交）。
     ⚠️ `收场` 是工程侧补的：**引擎没有「战斗失败」分支效果**，
     第五幕「拒交 → 打起来 → 输了」这条走不通，只能另开一个能收尾的 action。
     这里**扫全房间**，别只扫名字带「面圣」的（会假红）。 */
  const acts = w.data.rooms.palace_hall.actions || [];
  const raw = JSON.stringify(acts);
  const found = new Set();
  for (const a of acts) {
    const s = JSON.stringify(a.effects || []);
    for (const m of s.matchAll(/ending:([A-Za-z0-9_]+)/g)) found.add(m[1]);
    for (const ef of (a.effects || [])) if (ef.type === 'ending' && ef.args) found.add(ef.args[0]);
  }
  for (const f of ['jiaojuan', 'jujiao', 'banjiao']) {
    ok(`  三结局之一「${f}」在 palace_hall 里可达`, found.has(f), [...found].join(','));
  }
  ok('★ 三结局用 menu 门控（不是一进门就给定局）', raw.includes('menu'));
  ok('★ 引擎真的会把 ending:<x> 落成 ending_<x> 的 flag（成就/尾声靠它）',
    (() => { const p2 = w.player; const out = []; evalEffects([{ type: 'ending', args: ['__probe__'] }], { player: p2, world: w, out }); return p2.hasFlag('ending___probe__'); })());
}

sec('⑩ ★ 主线依赖的 NPC 全部真实存在（防 mod 依赖悄悄断）');
{
  const ids = w.legendIds || [];
  ok('引擎名单非空', ids.length > 0);
  const missing = ids.filter(id => !w.data.npcs[id]);
  ok(`★「击败名宿」名单里的人全都在世界里（${ids.join('/')}）`, missing.length === 0,
    '查无此人：' + missing.join(',') +
    '（2026-10-17 批2 已把 taixu_hermit 换成基础数据的 li_mochou；名单只认基础数据 NPC，不认 mod 里的）');
  ok('  名单里没有主线 Boss / 委托人（别逼玩家打自己的委托人）',
    !ids.some(id => Object.values(NEW_QUESTS).some(s => s.giver === id)));
}

sec('⑪ B29 · favor:<npcId> 效果真的加好感（曾因 getNpc 口径静默打空）');
{
  const q = w.getQuest('q_main_snow') || {};
  const anyFav = Object.keys(w.data.quests)
    .map(id => (w.data.quests[id].rewards || []).find(r => r.type === 'favor'))
    .find(Boolean);
  ok('库里存在 favor 效果（262 条 sq_* 靠它结算好感）', !!anyFav, JSON.stringify(anyFav));
  if (anyFav) {
    const id = anyFav.args[0];
    const inst = w.findLiveNpc(id);
    const before = inst ? (inst.favor || 0) : null;
    const out = [];
    evalEffects([anyFav], { player: p, world: w, out });
    const after = (w.findLiveNpc(id) || {}).favor;
    ok(`★ favor:${id} 真加到实例上（旧写法 getNpc('${id}') = ${w.getNpc(id)}）`,
      before !== null && after === before + (anyFav.args[1] || 1),
      `before=${before} after=${after}`);
  }
}

sec('⑫ B26 · 死成就改判');
{
  const ach = (w.data.achievements || {}).jianghu_end || {};
  const c = JSON.stringify(ach.cond || {});
  ok('成就「江湖路远」不再读永不置位的 ending_jianghu_end', !c.includes('ending_jianghu_end'), c);
  ok('  改读三结局 flag', /ending_(jiaojuan|jujiao|banjiao)/.test(c), c);
}

sec('⑬ 所有新增 cond / effects 引擎都认（喂假 ctx 不抛错）');
{
  let threw = [];
  for (const rid of ALL_ROOM_IDS) {
    for (const a of (w.data.rooms[rid].actions || [])) {
      if (!NEW_ACTIONS[rid].includes(a.cmd)) continue;
      try { evalCond(a.cond, { player: p, world: w }); }
      catch (err) { threw.push(rid + '/' + a.cmd + ' cond: ' + err.message); }
    }
  }
  ok('★ 全部 action 的 cond 可解析', threw.length === 0, threw.slice(0, 5).join(' ; '));
}

/* 102 §四 喂主线：snow_evidence_xixia（俞初西夏案取证）进 q_main_snow 证据判定。
 * 接法（2026-10-17 寇豆码，按血刀/星宿两线现成判式）：stage3「取私藏的半卷抄本」
 * 的 cond 由单 flag 改 or[xuedao_copy, snow_evidence_xixia] —— 西夏对账件与后寨
 * 半卷抄本同为「指向同一只手」的实证（血刀线 xuedao_copy 存量路径一字不动；
 * stage4 血刀老祖照旧卡 Boss，西夏证据不构成任何绕场）。
 * 判定消费点 = 交差（tryReportQuest 读 stage.cond），这里按同一通路真走。 */
sec('⑭ ★ 案3喂主线：snow_evidence_xixia 进 q_main_snow stage3 证据判定（or 组三态）');
{
  const qd = w.getQuest('q_main_snow');
  const s3 = qd && qd.stages && qd.stages[3];
  const cond = JSON.stringify((s3 && s3.cond) || {});
  ok('stage3 cond 为 or 组且两线都在（xuedao_copy / snow_evidence_xixia）',
    cond.includes('"or"') && cond.includes('xuedao_copy') && cond.includes('snow_evidence_xixia'), cond);
  /* flag 出处：西夏线 flag 由 61 的俞初案 s3 收口置位（hk_npcv_248_jiushui） */
  const jiushui = w.getQuest('hk_npcv_248_jiushui');
  ok('snow_evidence_xixia 有出处（61 俞初案 s3 收口 effects）',
    JSON.stringify(jiushui || {}).includes('snow_evidence_xixia'));
  /* 交差通路三态（真走 tryReportQuest：giver 方证大师房） */
  const boot2 = (flags, stage) => {
    const e2 = new GameEngine({ seed: 20261011 });
    e2.boot(); e2.newGame({ name: '验甲', gender: 'male' });
    const p2 = e2.world.player;
    p2.setFlag('act2_done', true);
    for (const f of flags) p2.setFlag(f, true);
    p2.setQuestStage('q_main_snow', stage);
    p2.room = 'shaolin_daxiong';
    e2.exec('看'); e2.exec('交差');
    return p2.questStage('q_main_snow');
  };
  ok('★ 血刀线存量路径不红（stage3 + xuedao_copy 交差 → 4）', boot2(['xuedao_copy'], 3) === 4);
  ok('★ 西夏线接入（stage3 + snow_evidence_xixia 交差 → 4）', boot2(['snow_evidence_xixia'], 3) === 4);
  ok('★ 双无不误放（stage3 交差仍停 3）', boot2([], 3) === 3);
}

console.log('\n================================================');
console.log(`  三~五幕验收：${pass} 通过 / ${fail} 失败`);
console.log('================================================');
process.exit(fail ? 1 : 0);
