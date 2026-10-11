/* ============================================================
 * smoke-quest-data.js — 批次 6 · 任务数据专项回归
 * ============================================================================
 * 覆盖两件事（都在 game/data/60_quests.json 上）：
 *   【B20】288 条模板支线 `sq_npcv_*` 的「串号」修正
 *          · A 层 26 人（V01–V26）模板已「停用」（从 quests 移除）
 *          · 其余 262 条保留为「杂务」，但：目的地必须同 region、
 *            点名人物必须 ∈ giver.rel、say 文案必须按 tag 分化
 *   【E4】 摘掉第一幕的「假结局」`ending: jianghu_end`
 *          · q_main_jianghu.rewards 里不得再有 ending 效果
 *          · **专项回归**：第一幕（stage 0→99）走完，不得产生任何 `ending_*` flag
 *
 * 纪律：
 *   · 全部走真实引擎路径 `new GameEngine({seed}).boot().newGame()`（不是 new World() 空壳）
 *   · 无恒真断言（无 `&& false` / 无字面量 true / 无私自 grep 当断言）
 *   · 判定「点名人物」用「NPC 名出现在文本里 且 不是 giver 全名的子串」
 * ============================================================ */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), 'utf8'));
const quests = doc.quests;
const npcs = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '40_npcs.json'), 'utf8')).npcs;
const rooms = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '50_map.json'), 'utf8')).rooms;

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

/* A 层 26 人（V01–V26）· design/23-sidequests-portrait-hooks.md §8 / §11 */
const A26 = [
  'npcv_241', 'npcv_154', 'npcv_010', 'npcv_208', 'npcv_091', 'npcv_065', 'npcv_223',
  'npcv_174', 'npcv_240', 'npcv_009', 'npcv_237', 'npcv_248', 'npcv_215', 'npcv_180',
  'npcv_115', 'npcv_083', 'npcv_126', 'npcv_164', 'npcv_186', 'npcv_090', 'npcv_074',
  'npcv_252', 'npcv_178', 'npcv_095', 'npcv_036', 'npcv_082',
];
const A26_SET = new Set(A26);

const sqIds = Object.keys(quests).filter(k => /^sq_npcv_/.test(k));
const nameById = {}; for (const id of Object.keys(npcs)) if (npcs[id].name) nameById[id] = npcs[id].name;
const regionOf = rid => (rid && rooms[rid]) ? rooms[rid].region : null;

/* 点名人物：文本里出现的 NPC 名，且不是 giver 全名的子串（排除「麻灵犀」被「麻灵」误判） */
function unauthorizedNames(qid) {
  const q = quests[qid];
  const gid = qid.replace(/^sq_/, '');
  const g = npcs[gid];
  if (!g) return ['(giver 缺失)'];
  const rel = new Set((g.rel || []).map(r => r.id));
  const text = [q.desc, ...(q.stages || []).map(s => s.desc)].join(' ');
  const bad = [];
  for (const mid in nameById) {
    const nm = nameById[mid];
    if (nm.length < 2 || !text.includes(nm)) continue;
    if (mid === gid) continue;
    if (nm !== g.name && g.name.includes(nm)) continue;   // 是 giver 全名的子串 → 误判
    if (!rel.has(mid)) bad.push(mid + ':' + nm);
  }
  return bad;
}

/* ============================================================ */
section('① B20 · A 层 26 人模板「停用」（从 quests 移除）');
ok('26 条 sq_npcv_* 已从 quests 移除（不存在可被「accept」接取的旧模板）',
  A26.every(id => !quests['sq_' + id]),
  '缺失 ' + A26.filter(id => quests['sq_' + id]).length + ' 条');
/* 口径变更（主人 2026-10-11）：「把那些模板化支线水货支线删掉或每个城市留那么几个」
   —— `sq_npcv_*` 已按区域各留 3 条剪枝（262 → 79），任务总数随之下降。
   这里改成守着「剪过枝之后的区间」，别再把旧数字当契约。 */
ok('其余 sq_npcv_* 已剪枝（每区留 3 条）', sqIds.length > 0 && sqIds.length <= 100, '实测 ' + sqIds.length);
ok('任务总数落在剪枝后的区间（≤ 130）', Object.keys(quests).length > 100 && Object.keys(quests).length <= 130, '实测 ' + Object.keys(quests).length);
ok('被移除的 26 条 id 未被 60_quests.json 内其它任务引用（无悬空 require/quest 指向）',
  (() => { const j = JSON.stringify(doc); return A26.every(id => (j.split('sq_' + id).length - 1) === 0); })());

/* ============================================================ */
section('② B20 · 其余 262 条：目的地必须落在该 NPC 自己的 region');
let cross = 0, noRoom = 0, sameRoom = 0;
for (const qid of sqIds) {
  const q = quests[qid];
  const gid = qid.replace(/^sq_/, '');
  const g = npcs[gid];
  const dest = q.stages[0].targets[0].key;
  if (!rooms[dest]) { noRoom++; continue; }
  if (dest === g.room) sameRoom++;
  if (regionOf(dest) !== regionOf(g.room)) cross++;
}
ok('目的地房间全部存在', noRoom === 0, '缺失 ' + noRoom);
ok('目的地 region 与出任务 NPC 所在 region 一致（0 条跨区）', cross === 0, '跨区 ' + cross);
ok('目的地不是出任务 NPC 自己的房间', sameRoom === 0, '重合 ' + sameRoom);

/* ============================================================ */
section('③ B20 · 点名人物必须 ∈ giver.rel');
let badName = [];
for (const qid of sqIds) { const b = unauthorizedNames(qid); if (b.length) badName.push(qid + '{' + b.join(',') + '}'); }
ok('262 条里，点名之人全部与出任务 NPC 有关系（else 泛称）', badName.length === 0, '越界 ' + badName.length + (badName.length ? ' → ' + badName.slice(0, 4).join(' ') : ''));

/* ============================================================ */
section('④ B20 · say 文案按 tag 分化（不再是清一色「多谢你了」）');
const closerMap = {};
let plainThanks = 0;
for (const qid of sqIds) {
  const say = (quests[qid].rewards || []).find(r => r.type === 'say');
  const raw = say ? say.raw : '';
  const closer = raw.replace(/^.*?[:：]/, '');
  closerMap[closer] = (closerMap[closer] || 0) + 1;
  if (/多谢你了/.test(raw)) plainThanks++;
}
ok('say 文案种类 ≥ 10（实测 ' + Object.keys(closerMap).length + ' 种）', Object.keys(closerMap).length >= 10);
ok('不再有「多谢你了」的模板收尾', plainThanks === 0, '实测 ' + plainThanks);

/* ============================================================ */
section('⑤ B20 · id / 结构 / 奖励（数值）原样');
let badShape = 0, badVar = 0, badReward = 0;
for (const qid of sqIds) {
  const q = quests[qid];
  const gid = qid.replace(/^sq_/, '');
  if (q.id !== qid || !q.stages || q.stages.length !== 2 ||
    q.stages[0].next !== 1 || q.stages[1].next !== 99) badShape++;
  const t0 = (q.stages[0].targets || [])[0];
  if (!t0 || t0.kind !== 'room' || t0.count !== 1 || t0.var !== qid + '_go' ||
    !q.stages[0].cond || q.stages[0].cond.var !== qid + '_go') badVar++;
  const rs = q.rewards || [];
  const hasExp = rs.some(r => r.type === '+exp'), hasPot = rs.some(r => r.type === '+pot');
  const fav = rs.find(r => r.type === 'favor');
  const hasSay = rs.some(r => r.type === 'say');
  if (!hasExp || !hasPot || !hasSay || !fav || (fav.args && fav.args[0] !== gid)) badReward++;
}
ok('262 条 id / 两段式结构（next 1→99）未变', badShape === 0, '异常 ' + badShape);
ok('262 条 stage0 目标 kind=room / count=1 / var 未变（存档进度键 sq_XXX_go 不打乱）', badVar === 0, '异常 ' + badVar);
ok('262 条奖励结构完整（+exp/+pot/favor[指向 giver]/say）', badReward === 0, '异常 ' + badReward);

/* ============================================================ */
section('⑥ E4 · 第一幕「假结局」已摘');
const mj = quests['q_main_jianghu'];
ok('q_main_jianghu.rewards 内已无 ending 效果',
  !!mj && !(mj.rewards || []).some(r => r.type === 'ending'));
ok('改由一条 narrate 收尾（含「江湖很大」）',
  !!mj && (mj.rewards || []).some(r => r.type === 'narrate' && /江湖很大/.test(r.raw || '')));
ok('连带项：know_east_depot / depot_token_half / 接二幕 已**搬离** rewards（E5）',
  !!mj && (() => { const j = JSON.stringify(mj.rewards); return !j.includes('know_east_depot') && !j.includes('depot_token_half') && !j.includes('q_main_sect'); })());
ok('★ E5：stage3「击败名宿」的 cond 里带了 act4_done（门槛后移，第四幕之后才结算）',
  !!mj && (() => { const c = JSON.stringify((mj.stages[3] || {}).cond || {}); return c.includes('defeatLegend') && c.includes('act4_done'); })());

/* ---------- 专项行为回归：第一幕走完，不产生任何 ending_* ---------- */
section('⑦ E4 专项 · 第一幕（stage 0→99）走完，无任何 ending_*');
function walkAct1(seed) {
  const e = new GameEngine({ seed }); e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  const giverId = Object.keys(w.data.npcs).find(id =>
    Array.isArray(w.data.npcs[id].quests) && w.data.npcs[id].quests.includes('q_main_jianghu'));
  // 满足 q_main_jianghu 各 stage 的真实 cond（stage0 拜师 / 1 武学100 / 2 支线5桩 / 3 击败名宿 / 4 绝顶内功）
  p.sect = p.sect || Object.keys(w.data.sects)[0];
  p.setVar('hasSect', 1);
  const sk = Object.keys(p.learned)[0]; if (sk) p.learned[sk].level = 100;
  for (const q of Object.keys(w.data.quests).filter(id => /^sq_/.test(id)).slice(0, 5)) p.quests[q] = 99;
  p.setVar('sidequests_done', 5);
  /* ⚠️ 名宿从引擎名单里拿（`w.legendIds`），别写死 —— 名单换人时这条测试不该跟着红 */
  p.setFlag('killed_' + ((w.legendIds || [])[0] || 'mojiao_dongfang'), true);
  /* ⚠️ design/21 §2.9.1（C3）：stage3「击败名宿」的 cond 现在是
     `{and:[{fn:'defeatLegend'},{flag:'act4_done'}]}` —— 挪到第四幕之后结算。
     不置这一位，第一幕就走不完（这正是本测试要防的「门槛」本意，别当成故障去掉）。 */
  p.setFlag('act4_done', true);
  p.setFlag('learned_yijinjing', true);
  w.movePlayerTo(p, w.data.npcs[giverId].room);
  const texts = [];
  for (let i = 0; i < 12 && p.questStage('q_main_jianghu') < 99; i++) {
    const r = e.exec('交任务');
    (r.lines || []).forEach(l => texts.push(l.text || ''));
  }
  return { giverId, stage: p.questStage('q_main_jianghu'), flags: Object.keys(p.flags || {}), text: texts.join(' | ') };
}
const a1 = walkAct1(20260901);
ok('第一幕真的走完（q_main_jianghu 到 99）', a1.stage >= 99, 'stage=' + a1.stage);
ok('走完第一幕，未产生任何 ending_*（本条的「先红后绿」对象）',
  a1.flags.filter(f => /^ending_/.test(f)).length === 0,
  '实产生 ' + JSON.stringify(a1.flags.filter(f => /^ending_/.test(f))));
ok('第一幕幕末收到新收尾 narrate，而非「故事终章」',
  /江湖很大/.test(a1.text) && !/故事终章|江湖路远（结局）/.test(a1.text));

/* 对照：另一颗种子同样不产生 ending_*（防「恰好不触发」的假绿） */
const a1b = walkAct1(777001);
ok('换种子再走一遍，仍无 ending_*', a1b.stage >= 99 && a1b.flags.filter(f => /^ending_/.test(f)).length === 0);

/* ============================================================
 * 击杀目标：名单判定 + **计数是否真的推进**
 *
 * 两件事一起测，因为它们是同一条链：
 *   ① 名单：单数 `key` 与复数 `keys` 必须**等价生效**。
 *      原判定 `if (t.key && t.key !== key && !(t.keys||[]).includes(key)) continue;`
 *      在 `t.key` 为假时整条短路 → **只写 `keys` 的目标放开了限制**，
 *      "击杀恶徒十个"变成"击杀任意人十个"。
 *   ② 推进：`advanceQuestCounters` 以前**全仓没有任何调用点**
 *      （engine.postProcess 里算了个 `killLines` 就没了下文）
 *      → 「击杀 N 个某某」这类目标**永远不涨**，玩家杀够数也交不了任务。
 *
 * 走真实链路：`world.onNpcKilled()`（真实钩子，会把 defId 记进 `_killQueue`）
 *        → `engine.exec('look')` 触发 postProcess（真实收口）
 *        → 断言任务目标变量真的涨了。
 * ⚠️ 战斗过程本身不在这里跑（那要几十回合），但**计数链的两端都是真实现**。
 * ============================================================ */
{
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame();
  const w = e.world, p = w.player;

  /* ① 全库自洽：每个 kill 目标都必须**写出了**名单（单数或复数至少一个）。 */
  const noList = [];
  let withList = 0;
  for (const [qid, q] of Object.entries(w.data.quests)) {
    for (const [si, st] of (q.stages || []).entries()) {
      for (const t of (st.targets || [])) {
        if (t.kind !== 'kill') continue;
        const has = !!t.key || (Array.isArray(t.keys) && t.keys.length);
        if (has) withList++; else noList.push(qid + '#' + si);
      }
    }
  }
  ok('kill 目标都写出了名单（单数 key 或复数 keys）', noList.length === 0,
    noList.length ? noList.join(',') : `${withList} 条全有名单`);

  /* ② 复数 keys：q_emei_entry 的名单是 [mob_bandit, mob_bandit_chief, mob_mo_disciple] */
  const QID = 'q_emei_entry';
  const qd = w.getQuest(QID);
  const t1 = (qd.stages[0].targets || []).find(t => t.kind === 'kill');
  ok('② 前提：q_emei_entry 用复数 keys（无单数 key）',
    !t1.key && Array.isArray(t1.keys) && t1.keys.length > 0, JSON.stringify(t1.keys || null));
  const vk = t1.var || `q_${QID}_${t1.id}`;

  /* 名单外：mob_soldier 不在 keys 里 */
  ok('② 前提：mob_soldier 不在名单里（对照用）', t1.keys.indexOf('mob_soldier') < 0);
  p.quests[QID] = 0; p.setVar(vk, 0);
  const outsider = w.spawnNpc('mob_soldier', p.room, 1, true);
  if (outsider) { outsider.hp = 1; w.onNpcKilled(outsider); }
  e.exec('look');   /* 触发 postProcess，把击杀队列喂给任务计数器 */
  ok('② 击杀名单外的人**不计数**（修前：任意击杀都算）', (p.getVar(vk) || 0) === 0,
    'count=' + (p.getVar(vk) || 0));

  /* 名单内：mob_bandit */
  p.quests[QID] = 0; p.setVar(vk, 0);
  const insider = w.spawnNpc('mob_bandit', p.room, 1, true);
  if (insider) { insider.hp = 1; w.onNpcKilled(insider); }
  e.exec('look');
  ok('③ 击杀名单内的人**真的计数**（修前：永远是 0，任务交不了）', (p.getVar(vk) || 0) >= 1,
    'count=' + (p.getVar(vk) || 0));

  /* ④ 单数 key 的写法同样生效（别为修复数把单数弄坏） */
  const QID2 = 'q_huashan_entry';
  const qd2 = w.getQuest(QID2);
  const t2 = (qd2.stages[0].targets || []).find(t => t.kind === 'kill');
  const vk2 = t2.var || `q_${QID2}_${t2.id}`;
  p.quests[QID2] = 0; p.setVar(vk2, 0);
  const wrongOne = w.spawnNpc('mob_soldier', p.room, 1, true);   /* 单数 key=mob_bandit，士兵不在名单 */
  if (wrongOne) { wrongOne.hp = 1; w.onNpcKilled(wrongOne); }
  e.exec('look');
  ok('④ 单数 key：击杀名单外不计数', (p.getVar(vk2) || 0) === 0, 'count=' + (p.getVar(vk2) || 0));
  const rightOne = w.spawnNpc('mob_bandit', p.room, 1, true);
  if (rightOne) { rightOne.hp = 1; w.onNpcKilled(rightOne); }
  e.exec('look');
  ok('④ 单数 key：击杀名单内计数', (p.getVar(vk2) || 0) >= 1, 'count=' + (p.getVar(vk2) || 0));
}

/* ============================================================
 * 【第二轮主人报】开局不该把「还没到的那一幕」塞进任务簿
 *
 *   主人原话：「点任务快捷键弹出来的还是旧主线」——打开任务面板，
 *   除了第一幕，还挂着第二幕 `q_main_sect`（level 30、委托人冲虚道长、
 *   要你交一块**第一幕幕末才发**的铜牌）。新角色一进游戏就看得到，
 *   剧透二幕、还把新手引导第 5 步「寻个营生」的「非主线」判定一开局点亮。
 *   根因：world.createPlayer 里「所有 type==='主线' 一律接上」。
 *   修法：**有委托人（giver）的主线必须由那个人当面交给玩家**，只有无委托人的
 *        「起手式」才自动接。
 * ============================================================ */
section('【第二轮】开局任务簿：有委托人的主线不该自动接');
{
  const giverMain = Object.keys(quests).filter(id => {
    const q = quests[id];
    return q && q.type === '主线' && q.giver;
  });
  ok('数据前提：确实存在「有委托人的主线」（否则本条测试无意义）',
    giverMain.length > 0, giverMain.join(','));

  const e = new GameEngine({ seed: 20261011 });
  e.boot();
  const v = e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  const p = e.world.player;
  const keys = Object.keys(p.quests || {});

  ok('★ 开局自动接上了第一幕（起手式 still 在）',
    keys.indexOf('q_main_jianghu') >= 0, keys.join(','));
  ok('★ 开局**没有**自动接第二幕 q_main_sect（有委托人的主线）',
    keys.indexOf('q_main_sect') < 0, keys.join(','));
  ok('★ 一条不漏：所有带 giver 的主线都不在开局任务簿里（将来加三~五幕也不会复发）',
    giverMain.every(id => keys.indexOf(id) < 0),
    '带 giver 的主线 = [' + giverMain.join(',') + ']，实际在簿 = [' + keys.join(',') + ']');
  ok('★ 任务面板（view.quests.active）里不再出现「门派之疑」',
    !(v.quests.active || []).some(q => q.id === 'q_main_sect'),
    (v.quests.active || []).map(q => q.name).join(' / '));

  /* 连锁：新手引导第 5 步「寻个营生」原来一开局就被点亮（tutorial.js 的
     `some(k => k !== 'q_main_jianghu')`）—— 现在应当仍未完成。 */
  const guide = v.guide || {};
  const step5 = (guide.steps || []).filter(s => /营生|差事|支线/.test(String(s.goal || '') + String(s.hint || '')));
  ok('★ 引导「寻个营生」那步开局未被提前点亮（第二幕不再冒充「非主线」）',
    step5.length === 0 || step5.every(s => !s.done),
    step5.map(s => (s.goal || '') + '=' + s.done).join(' | ') || '（未找到该步，按未点亮处理）');
}

console.log(`\n${fail === 0 ? '✔ 全绿' : '✘ 有红'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
