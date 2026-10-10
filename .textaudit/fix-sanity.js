/* ============================================================
 *  fix-sanity.js —— 机制级「出戏」问题修正（只改 60_quests.json 的文本与 target.key）
 *
 *  受权范围（team-lead 派单）：
 *   ① 人名当物品名（target 引用错）        → 改对引用 + 改对文案
 *   ② 人物与差事错配（僧人/掌门不该有的杂务）→ 按真实身份重写
 *   ③ 除害类 target 落在室内（青楼/客栈/私宅）→ 换到野外/街巷/山道；无合适房间者改挂差事类型
 *   ④ 寻人类占位词漏出（"旧识铺子里的掌柜"）→ 换成该 NPC 的 rel 真人
 *  不改：id / var / count / cond / next / 奖励结构 / 数值。
 *  校验：结构不变量 + 区域一致 + 房名自动同步 + 逐字节回读。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const FMT = { indent: 2, nl: true };

const qDoc = JSON.parse(fs.readFileSync(P('game/data/60_quests.json'), 'utf8'));
const qOrig = JSON.parse(JSON.stringify(qDoc));
const N = JSON.parse(fs.readFileSync(P('game/data/40_npcs.json'), 'utf8')).npcs;
const M = JSON.parse(fs.readFileSync(P('game/data/50_map.json'), 'utf8')).rooms;
const R = M; // rooms

/* ---------- ① target.key 迁移（含房名自动同步到 desc/stage0/target.desc） ---------- */
const DEST = {
  /* 除害：室内 → 野外/街巷/山道（同 region，且 ≠ giver 房间） */
  sq_wudang_chongxu: 'wudang_houshan',
  sq_wen_black: 'secret_anxiang',
  sq_npcv_003: 'shaolin_houshan',
  sq_npcv_013: 'shaolin_houshan',
  sq_npcv_043: 'jiangnan_west_road',
  sq_npcv_053: 'palace_court3',
  sq_npcv_073: 'jn_market_east',
  sq_npcv_123: 'shaolin_houshan',
  sq_npcv_143: 'jn_harbor',
  sq_npcv_163: 'jiangnan_east_road',
  sq_npcv_173: 'jn_market_north',
  sq_npcv_193: 'road_dali_1',
  sq_npcv_243: 'jn_market_south',
  sq_npcv_273: 'road_tangmen_2',
  sq_npcv_283: 'palace_court3',
  /* 采药：室内 → 自然/街巷（同 region） */
  sq_shaolin_fangzheng: 'shaolin_houshan',
  sq_wen_jiangnan: 'jiangnan_hill',
  sq_npcv_022: 'jn_market_west',
  sq_npcv_042: 'road_tangmen_1',
  sq_npcv_072: 'gusu_town',
  sq_npcv_122: 'jn_brothel_gate',
  sq_npcv_172: 'jn_market_west',
  sq_npcv_192: 'cunzhen_farm',
  sq_npcv_202: 'cunzhen_farm',
  sq_npcv_232: 'jinguo_ruin',
  sq_npcv_282: 'palace_court3',
  /* 具名：dest == giver 自己的房间（接了就完成）→ 挪开 */
  sq_emei_miejue: 'emei_shanmen',
  sq_linghu: 'huashan_shanxia',
};

/* ---------- ② 文案覆盖 ---------- */
const TEXT = {
  sq_shaolin_fangzheng: { stage0: '去少林·后山寻三味草药', stage1: '把草药带回给方证大师' },
  sq_wen_jiangnan: { desc: '张掌柜的婆娘病着，药方上缺一味药，他守在柜台后头直叹气。', stage0: '去城北土坡采三株草药', stage1: '把草药交回给张掌柜' },
  sq_wen_black: { stage0: '去黑市·暗巷料理那畜生' },
  sq_emei_miejue: {
    desc: '峨眉有件旧物被人顺走，落在一个过路江湖客手里。灭绝师太把这桩事交给你。',
    stage0: '去峨眉·山门把那件旧物讨回来',
    stage1: '把旧物带回金顶复命',
  },
  sq_linghu: {
    desc: '令狐冲把一串铜钱拍在你手里：「劳驾，替我下山打壶酒，剩下的买两样下酒菜。」',
    stage0: '去华山脚下打一壶酒',
    stage1: '把酒带回思过崖',
  },
  /* 除害落进青楼（region 内无野外房间）→ 改挂室内说得通的差事（寻物/打探） */
  sq_npcv_023: {
    desc: '齐灵犀那串响铃丢了，她记着是落在望江阁的。',
    stage0: '去醉春楼·望江阁把响铃找回来', stage1: '把响铃交回给齐灵犀',
  },
  sq_npcv_063: {
    desc: '散了戏，梅若那副头面不见了，她疑心落在后厨。',
    stage0: '去醉春楼·后厨把梅若的头面找回来', stage1: '把梅若的头面交回去',
  },
  sq_npcv_153: {
    desc: '余静想打听昨夜那一桌客人的来路，托你去后厨问一声。',
    stage0: '去醉春楼·后厨问清那桌客人的来路', stage1: '回去把打听到的说给余静',
  },
  sq_npcv_253: {
    desc: '张轻舟的一方香帕丢在雅阁，托你去寻回来。',
    stage0: '去醉春楼·雅阁把香帕寻回来', stage1: '把香帕交回给张轻舟',
  },
  /* 采药落进青楼 → 改成「取香药」（青楼备香药天经地义） */
  sq_npcv_122: { desc: '舒轻要给楼里添些香药，托你到门厅取三味。', stage0: '去醉春楼·门厅取三味香药' },
  sq_npcv_162: { desc: '秦放要给听雨轩添些香药，托你取三味来。', stage0: '去醉春楼·听雨轩取三味香药' },
  /* 采药落进衙门库房 → 「领药」 */
  sq_npcv_182: { stage0: '去衙门·库房领三味药' },
  /* 街巷/长巷里采药 → 用「寻」不用「采」 */
  sq_npcv_022: { stage0: '去东市·西巷寻三味药' },
  sq_npcv_172: { stage0: '去东市·西巷寻三味药' },
  sq_npcv_282: { stage0: '去皇城·长巷寻三味药' },
};

/* ---------- ③ 占位词 → rel 真人（自动发现 + 确定性挑人） ---------- */
const PLACEHOLDERS = ['城里的旧相识', '铺子里的掌柜', '衙门口当差的'];
const SUB = {};
const textOf = (q) => [q.desc, ...(q.stages || []).map((s) => s.desc), ...(q.stages || []).flatMap((s) => (s.targets || []).map((t) => t.desc))].join(' ');
for (const [qid, q] of Object.entries(qDoc.quests)) {
  if (!/^sq_/.test(qid)) continue;
  const gid = qid.replace(/^sq_/, ''); const g = N[gid]; if (!g) continue;
  const found = PLACEHOLDERS.filter((p) => textOf(q).includes(p));
  if (!found.length) continue;
  const dest = q.stages[0].targets[0].key;
  const rel = (g.rel || []).map((r) => r.id).filter((id) => N[id]);
  /* 优先挑「就住在目的地那间房」的 rel 人；否则 rel[0] */
  const pick = rel.find((id) => N[id].room === dest) || rel[0] || null;
  const name = pick ? N[pick].name : '一位旧相识';
  SUB[qid] = found.map((p) => [p, name]);
}
const SUB_SUMMARY = '占位词命中任务 ' + Object.keys(SUB).length + ' 条：' + Object.entries(SUB).map(([k, v]) => k.replace(/^sq_/, '') + '→' + v[0][1]).join(' ');

/* ---------- ④ say 文案随身份调整 ---------- */
const SAY = {
  sq_emei_miejue: ['灭绝师太连头都懒得点：「钱讨回来，账清了。就这样。」', '灭绝师太连头都懒得点：「旧物归位，账清了。就这样。」'],
};

const errors = [];
const log = [];
const roomName = (id) => (R[id] && R[id].name) || id;

function eachText(q, fn) {
  if (typeof q.desc === 'string') fn('desc', q, 'desc');
  (q.stages || []).forEach((s, si) => {
    if (typeof s.desc === 'string') fn('stage' + si, s, 'desc');
    (s.targets || []).forEach((t, ti) => { if (typeof t.desc === 'string') fn('stage' + si + '.target' + ti, t, 'desc'); });
  });
}

for (const [qid, edits] of Object.entries({ ...TEXT, ...SAY })) { /* 预热校验：任务必须存在 */ if (!qDoc.quests[qid]) errors.push('任务不存在: ' + qid); }

/* 1) 占位词替换（desc + 全部 stage/target 文案） */
log.push(SUB_SUMMARY);
for (const [qid, pairs] of Object.entries(SUB)) {
  const q = qDoc.quests[qid]; if (!q) { errors.push('SUB 任务不存在: ' + qid); continue; }
  let n = 0;
  eachText(q, (_, obj) => { for (const [a, b] of pairs) { if (obj.desc.includes(a)) { obj.desc = obj.desc.split(a).join(b); n++; } } });
  if (!n) errors.push('SUB 未命中: ' + qid);
  log.push('SUB ' + qid + ' → ' + pairs.map((p) => p[1]).join(',') + '（' + n + ' 处）');
}

/* 2) target.key 迁移 + 房名同步（把旧房名在文案里换成新房名） */
for (const [qid, newKey] of Object.entries(DEST)) {
  const q = qDoc.quests[qid]; if (!q) { errors.push('DEST 任务不存在: ' + qid); continue; }
  const t = q.stages[0].targets[0];
  const oldKey = t.key;
  if (!R[oldKey]) errors.push(qid + ' 旧目标房不存在 ' + oldKey);
  if (!R[newKey]) { errors.push(qid + ' 新目标房不存在 ' + newKey); continue; }
  const oldName = roomName(oldKey), newName = roomName(newKey);
  /* 结构约束：giver 所在 region 必须与新目标房一致；且新目标房 ≠ giver 房间 */
  const gid = qid.replace(/^sq_/, ''); const g = N[gid] || N[q.giver];
  if (g) {
    const gr = (R[g.room] || {}).region, dr = R[newKey].region;
    if (gr !== dr) errors.push(qid + ' 迁移后跨区: giver=' + g.room + '(' + gr + ') dest=' + newKey + '(' + dr + ')');
    if (g.room === newKey) errors.push(qid + ' 迁移后 dest == giver 房间');
  }
  t.key = newKey;
  eachText(q, (_, obj) => { if (obj.desc.includes(oldName)) obj.desc = obj.desc.split(oldName).join(newName); });
  log.push('DEST ' + qid + ' ' + oldKey + '「' + oldName + '」 → ' + newKey + '「' + newName + '」');
}

/* 3) 文案覆盖 */
for (const [qid, ed] of Object.entries(TEXT)) {
  const q = qDoc.quests[qid]; if (!q) continue;
  if (ed.desc !== undefined) q.desc = ed.desc;
  if (ed.stage0 !== undefined) { q.stages[0].desc = ed.stage0; if (q.stages[0].targets[0]) q.stages[0].targets[0].desc = ed.stage0; }
  if (ed.stage1 !== undefined && q.stages[1]) q.stages[1].desc = ed.stage1;
  log.push('TEXT ' + qid + ' → ' + (q.stages[0].desc));
}
/* 4) say */
for (const [qid, [a, b]] of Object.entries(SAY)) {
  const q = qDoc.quests[qid]; if (!q) continue;
  const r = (q.rewards || []).find((x) => x.type === 'say');
  if (!r) { errors.push('SAY 无 say 奖励: ' + qid); continue; }
  if (r.raw !== a) { errors.push('SAY 原文不匹配: ' + qid + ' = ' + JSON.stringify(r.raw)); continue; }
  r.raw = b; log.push('SAY ' + qid);
}

/* ---------------- 不变量校验 ---------------- */
/* A. 结构零改动（只许改 key / 文本字段） */
{
  const ALLOW = [
    /^\/quests\/[^/]+\/desc$/,
    /^\/quests\/[^/]+\/stages\/\d+\/desc$/,
    /^\/quests\/[^/]+\/stages\/\d+\/targets\/\d+\/desc$/,
    /^\/quests\/[^/]+\/stages\/\d+\/targets\/\d+\/key$/,
    /^\/quests\/[^/]+\/rewards\/\d+\/raw$/,
  ];
  const paths = [];
  (function walk(a, b, p) {
    if (a === b) return;
    const ta = a === null ? 'null' : typeof a, tb = b === null ? 'null' : typeof b;
    if (ta !== tb || ta !== 'object') { paths.push(p); return; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p + '/' + k);
  })(qOrig, qDoc, '');
  const bad = paths.filter((x) => !ALLOW.some((re) => re.test(x)));
  if (bad.length) errors.push('白名单越界: ' + bad.slice(0, 10).join(' '));
  log.push('受影响路径 ' + paths.length + ' 条（越界 ' + bad.length + '）');
}
/* B. 任务总数 & 结构不变 */
if (Object.keys(qDoc.quests).length !== 305) errors.push('任务总数变了');
for (const [qid, q] of Object.entries(qDoc.quests)) {
  if (!q.stages || !q.stages.length) { errors.push(qid + ' 无 stages'); continue; }
  const t0 = q.stages[0].targets && q.stages[0].targets[0];
  if (/^sq_npcv_/.test(qid)) {
    if (q.stages.length !== 2 || q.stages[0].next !== 1 || q.stages[1].next !== 99) errors.push(qid + ' 结构变了');
    if (!t0 || t0.kind !== 'room' || t0.count !== 1 || t0.var !== qid + '_go') errors.push(qid + ' target 结构变了');
  }
}
/* C. 除害/采药 迁移后的区域一致（覆盖所有 sq_npcv_*） */
for (const qid of Object.keys(qDoc.quests)) {
  if (!/^sq_npcv_/.test(qid)) continue;
  const q = qDoc.quests[qid]; const gid = qid.replace(/^sq_/, ''); const g = N[gid];
  const t0 = q.stages[0].targets[0];
  if (!R[t0.key]) { errors.push(qid + ' 目标房不存在'); continue; }
  if ((R[g.room] || {}).region !== R[t0.key].region) errors.push(qid + ' 跨区');
  if (t0.key === g.room) errors.push(qid + ' dest == giver 房间');
}
/* D. 占位词已清零 */
{
  let left = [];
  for (const [qid, q] of Object.entries(qDoc.quests)) { const t = textOf(q); for (const p of PLACEHOLDERS) if (t.includes(p)) left.push(qid + ':' + p); }
  if (left.length) errors.push('占位词残留 ' + left.length + ' 处: ' + left.slice(0, 8).join(','));
  /* 半截模板：旧识 + 职务（而非人名） */
  const half = [];
  for (const [qid, q] of Object.entries(qDoc.quests)) { if (/旧识[^，。]{0,4}(掌柜|当差|相)/.test(textOf(q))) half.push(qid); }
  if (half.length) errors.push('半截模板残留: ' + half.join(','));
}
/* E. 舞台文案里不得出现「不属于 giver 且不在 rel 内」的 NPC 名（覆盖全部 sq_*） */
{
  const nameById = {}; for (const [id, n] of Object.entries(N)) if (n.name) nameById[id] = n.name;
  for (const [qid, q] of Object.entries(qDoc.quests)) {
    if (!/^sq_/.test(qid)) continue;
    const gid = qid.replace(/^sq_/, ''); const g = N[gid]; if (!g) continue;
    const rel = new Set((g.rel || []).map((r) => r.id));
    let txt = (q.desc || '') + ' ' + (q.stages || []).map((s) => s.desc).join(' ');
    for (const mid in nameById) {
      const nm = nameById[mid];
      if (nm.length < 2 || !txt.includes(nm)) continue;
      if (mid === gid) continue;
      if (nm !== g.name && g.name.includes(nm)) continue;
      if (!rel.has(mid)) errors.push('越界人名 ' + qid + ':' + nm);
    }
  }
}

if (errors.length) {
  console.error('✘ 修正失败，未写入：');
  errors.forEach((e) => console.error('   · ' + e));
  process.exit(1);
}
const raw = fs.readFileSync(P('game/data/60_quests.json'), 'utf8');
const out = JSON.stringify(qDoc, null, FMT.indent) + (FMT.nl ? '\n' : '');
if (JSON.stringify(JSON.parse(raw), null, FMT.indent) + (FMT.nl ? '\n' : '') !== raw) { console.error('✘ 原文件格式与预期不符，停手'); process.exit(1); }
fs.writeFileSync(P('game/data/60_quests.json'), out, 'utf8');
if (fs.readFileSync(P('game/data/60_quests.json'), 'utf8') !== out) { console.error('✘ 回读不一致'); process.exit(1); }
console.log('✔ 已落盘并通过校验（' + log.length + ' 项）');
log.forEach((l) => console.log('   · ' + l));
