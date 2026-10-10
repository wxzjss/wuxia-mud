/* ============================================================
 *  apply.js —— 应用改写 + 逐字节格式复现 + 变更路径白名单 + 不变量校验
 *
 *  纪律：
 *   · 只改文本字段；改完按**探测到的格式**重新序列化，并断言与「原格式 + 我的改动」一致
 *   · 深比较原/新，任何落在白名单之外的路径 → 直接失败退出（不落盘）
 *   · 顺带跑一遍与 smoke-quest-data 同源的「点名人物 ∈ rel」检查
 *   · 不恒真：无 && false / 无字面 true（除变异自证在本脚本外的说明）
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const D = require('./patch-data.js');

const FMT = {
  'game/data/50_map.json': { indent: 2, nl: false },
  'game/data/40_npcs.json': { indent: 1, nl: false },
  'game/data/60_quests.json': { indent: 2, nl: true },
};

function loadRaw(f) { return fs.readFileSync(P(f), 'utf8'); }
function parse(f) { return JSON.parse(loadRaw(f)); }
function serial(f, obj) {
  const { indent, nl } = FMT[f];
  return JSON.stringify(obj, null, indent) + (nl ? '\n' : '');
}
/* 先探测磁盘格式确实等于 serial()（否则停手，免得写坏） */
function assertFormat(f, obj) {
  const raw = loadRaw(f);
  const s = serial(f, obj);
  const alt = JSON.stringify(obj, null, FMT[f].indent) + (FMT[f].nl ? '' : '\n');
  if (s !== raw && alt !== raw) {
    throw new Error('[FORMAT] ' + f + ' 不等于 indent=' + FMT[f].indent + ' nl=' + FMT[f].nl + ' 的序列化结果，拒绝写入');
  }
  return s;
}
function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const errors = [];
const info = [];

/* ==================== 50_map.json ==================== */
const mapDoc = parse('game/data/50_map.json');
const mapOrig = JSON.parse(JSON.stringify(mapDoc));
let roomHits = 0;
for (const [id, desc] of Object.entries(D.ROOMS)) {
  const r = mapDoc.rooms[id];
  if (!r) { errors.push('房间不存在: ' + id); continue; }
  if (!desc || desc.length < 10 || desc.length > 90) errors.push('房间描述长度异常: ' + id + ' len=' + (desc || '').length);
  r.desc = desc; roomHits++;
}
info.push('房间 desc 改写: ' + roomHits);

/* ==================== 40_npcs.json ==================== */
const npcDoc = parse('game/data/40_npcs.json');
const npcOrig = JSON.parse(JSON.stringify(npcDoc));
let npcDescHits = 0;
for (const [id, desc] of Object.entries(D.NPC_DESC)) {
  if (id === 'guard_jinywei_talk_2') continue;
  const n = npcDoc.npcs[id];
  if (!n) { errors.push('NPC 不存在: ' + id); continue; }
  n.desc = desc; npcDescHits++;
}
if (npcDoc.npcs.shenni) { npcDoc.npcs.shenni.askDefault = D.NPC_ASKDEF.shenni; }
/* guard_jinywei：正文里漏出模板变量 .registry，按原文精确定位替换 */
{
  const g = npcDoc.npcs.guard_jinywei;
  if (!g || !Array.isArray(g.talk)) errors.push('guard_jinywei 缺 talk');
  else {
    const idx = g.talk.findIndex((t) => t.includes('.registry'));
    if (idx < 0) errors.push('guard_jinywei 未找到含 .registry 的台词');
    else g.talk[idx] = D.NPC_DESC.guard_jinywei_talk_2;
  }
}
info.push('NPC desc 改写: ' + npcDescHits + '；askDefault 1；台词泄漏修正 1');

/* ==================== npcv 克隆台词按原型分化 ==================== */
/* 288 个 npcv_* 的 talk 由 33 条原型模板复制而来（每原型 8~9 份逐字相同）。
 * 下面按「原型序号 = ((n-1) % 33) + 1」重写为 33 组**腔调各异**的台词。 */
const ARCH = {
  1: ['扁担压得肩头疼，歇口气。', '客官赶路么？前头那家铺子，秤准。'],
  2: ['拨浪鼓一响，好吃的好玩的都在这儿。', '看看不要钱，砍价也行。'],
  3: ['圣贤书读了一箩筐，换不来半斗米。', '兄台若有高见，在下洗耳恭听。'],
  4: ['今年雨水勤，谷子长得齐腰。', '地里的草还没薅完，客官自便。'],
  5: ['要打什么？报个尺寸。', '锤子落下去，差一分火候就是块废铁。'],
  6: ['哪儿不舒坦？伸出手来。', '病来如山倒，去如抽丝，急不得。'],
  7: ['住店还是打尖？楼上还空着。', '小号本小利薄，不赊账。'],
  8: ['来啦——里边请！', '汤烫，您吹吹再喝。'],
  9: ['这批货从南边来，路上折了两成。', '价钱好商量，客官是爽快人。'],
  10: ['哼，钱越存越薄。', '借钱的？另寻别家。'],
  11: ['去哪儿？衙门还是码头？', '坐稳了——走喽！'],
  12: ['你口袋里有没有糖？', '（他绕着你的腿跑了一圈，又躲回大人身后。）'],
  13: ['（他伸出手，又缩了回去。）', '客官赏口吃的吧。'],
  14: ['（他把包袱抱得更紧了。）', '我什么也没有。'],
  15: ['这趟镖要是出岔子，我这条命就搭上了。', '刀口上舔血的营生，图个痛快。'],
  16: ['站住，哪来的？', '衙门缺人手，你要不来试试——管饭。'],
  17: ['本官事忙，有话快说。', '此事我自有处置。'],
  18: ['（他捏着嗓子，眼皮都不抬。）', '这话你也敢问？'],
  19: ['（她低着头快步过去，没应声。）', '这宫里的话，你问我做什么。'],
  20: ['谁准你在这儿走动的？', '宫里的规矩，不该问的别问。'],
  21: ['（她笑了笑，没答话。）', '客官听曲么？'],
  22: ['哎哟，这位爷！', '楼里的姑娘，个顶个的标致。'],
  23: ['公子要些什么？', '（被人一夸，她低下头去。）'],
  24: ['拔剑吧。赢了我，请你喝酒。', '江湖路远，各走各的。'],
  25: ['看什么看？我兜里比脸还干净。', '（他往旁边挪了半步，正好挡在你和钱袋中间。）'],
  26: ['山里的路，我闭着眼都走得。', '今早见着头鹿，没赶上。'],
  27: ['阿弥陀佛，施主有缘。', '（他念了声佛，没再说话。）'],
  28: ['施主留步。', '尘缘未了，强求不来。'],
  29: ['道法自然，争什么？', '贫道看你近来当心口舌。'],
  30: ['（他甩了个水袖，唱半句就停了。）', '这出戏，最热闹的还在后头。'],
  31: ['过江？两文钱。', '风大，站稳，别掉下去。'],
  32: ['押大押小？快押！', '手气背，输光了。'],
  33: ['客官喝茶？新到的龙井。', '壶空了喊一声。'],
};
let npcvHits = 0;
for (const id of Object.keys(npcDoc.npcs)) {
  const m = /^npcv_(\d+)$/.exec(id);
  if (!m) continue;
  const n = parseInt(m[1], 10);
  const arch = ((n - 1) % 33) + 1;
  const lines = ARCH[arch];
  if (!lines) { errors.push('无原型台词: ' + id); continue; }
  const npc = npcDoc.npcs[id];
  const before = (npc.talk || []).join('|');
  npc.talk = lines.slice();
  npcvHits++;
  if (before === npc.talk.join('|')) errors.push('npcv 台词未变: ' + id);
}
info.push('npcv 台词按原型重写: ' + npcvHits + '（33 组原型）');

/* ==================== 60_quests.json ==================== */
const qDoc = parse('game/data/60_quests.json');
const qOrig = JSON.parse(JSON.stringify(qDoc));
const qHits = { sqDesc: 0, namedDesc: 0, say: 0, stage: 0 };
const roomName = (rid) => (mapDoc.rooms[rid] && mapDoc.rooms[rid].name) || rid;

/* 4a. 具名任务 desc */
for (const [id, desc] of Object.entries(D.QUEST_DESC)) {
  if (/_stage\d$/.test(id)) continue;
  const q = qDoc.quests[id];
  if (!q) { errors.push('任务不存在: ' + id); continue; }
  q.desc = desc; qHits.namedDesc++;
}
/* 4b. 两处 stage desc 的说明腔 */
{
  const fix = [
    ['q_shaolin_entry', 0, D.QUEST_DESC.q_shaolin_entry_stage0],
    ['q_yijinjing', 0, D.QUEST_DESC.yijinjing_stage0],
  ];
  for (const [qid, i, text] of fix) {
    const q = qDoc.quests[qid];
    if (!q || !q.stages || !q.stages[i]) { errors.push('stage 不存在: ' + qid + '[' + i + ']'); continue; }
    q.stages[i].desc = text; qHits.stage++;
  }
}
/* 4c. 具名任务 say */
for (const [qid, [oldS, newS]] of Object.entries(D.QUEST_SAY)) {
  const q = qDoc.quests[qid];
  if (!q) { errors.push('say 任务不存在: ' + qid); continue; }
  const r = (q.rewards || []).find((x) => x.type === 'say');
  if (!r) { errors.push('无 say 奖励: ' + qid); continue; }
  if (r.raw !== oldS) { errors.push('say 原文不匹配: ' + qid + ' 实际=' + JSON.stringify(r.raw)); continue; }
  r.raw = newS; qHits.say++;
}
/* 4d. 262 条 sq_npcv_* 模板 desc → 句型变体 */
function classify(d) {
  if (/要你替他跑趟腿/.test(d)) return '采买';
  if (/家里有人病了/.test(d)) return '采药';
  if (/野兽/.test(d)) return '除害';
  if (/丢了件要紧物事/.test(d)) return '寻物';
  if (/有趟货要送/.test(d)) return '护送';
  if (/有笔旧账/.test(d)) return '讨债';
  if (/把一封信/.test(d)) return '送信';
  if (/久未走动的旧识/.test(d)) return '寻人';
  if (/打听一桩旧事/.test(d)) return '打探';
  if (/恩怨压在心里多年/.test(d)) return '了结';
  return null;
}
function extractT(type, d) {
  if (type === '送信') { let m = /捎给(.+?)。/.exec(d) || /送到(.+?)手上。/.exec(d); return m ? m[1] : null; }
  if (type === '寻人') { const m = /旧识(.+?)。/.exec(d); return m ? m[1] : null; }
  return null;
}
for (const qid of Object.keys(qDoc.quests)) {
  if (!/^sq_npcv_/.test(qid)) continue;
  const q = qDoc.quests[qid];
  const gid = qid.replace(/^sq_/, '');
  const g = npcDoc.npcs[gid];
  if (!g) { errors.push('giver 缺失: ' + qid); continue; }
  const type = classify(q.desc);
  if (!type) { errors.push('未分类 sq desc: ' + qid + ' → ' + q.desc); continue; }
  const variants = D.SQ_VARIANTS[type];
  const t0 = q.stages[0].targets[0];
  const dName = roomName(t0.key);
  const tName = extractT(type, q.desc);
  let text = variants[hash(qid) % variants.length]
    .replace(/\{g\}/g, g.name)
    .replace(/\{d\}/g, dName)
    .replace(/\{t\}/g, tName || '旧相识');
  q.desc = text; qHits.sqDesc++;
}
info.push('任务 desc: sq 模板 ' + qHits.sqDesc + ' / 具名 ' + qHits.namedDesc + '；say ' + qHits.say + '；stage ' + qHits.stage);

/* ==================== 变更路径白名单 ==================== */
function diffPaths(a, b, prefix, out) {
  if (a === b) return;
  const ta = a === null ? 'null' : typeof a, tb = b === null ? 'null' : typeof b;
  if (ta !== tb || ta !== 'object') { out.push(prefix); return; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push(prefix); return; }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diffPaths(a[k], b[k], prefix + '/' + k, out);
}
const ALLOW = [
  /^\/rooms\/[^/]+\/desc$/,
  /^\/npcs\/[^/]+\/desc$/,
  /^\/npcs\/[^/]+\/talk\/\d+$/,
  /^\/npcs\/[^/]+\/askDefault$/,
  /^\/quests\/[^/]+\/desc$/,
  /^\/quests\/[^/]+\/stages\/\d+\/desc$/,
  /^\/quests\/[^/]+\/rewards\/\d+\/raw$/,
];
for (const [name, doc, orig] of [['50_map.json', mapDoc, mapOrig], ['40_npcs.json', npcDoc, npcOrig], ['60_quests.json', qDoc, qOrig]]) {
  const paths = [];
  diffPaths(orig, doc, '', paths);
  const bad = paths.filter((p) => !ALLOW.some((re) => re.test(p)));
  info.push(name + ' 受影响路径 ' + paths.length + ' 条；越界 ' + bad.length);
  if (bad.length) errors.push('[白名单越界] ' + name + ': ' + bad.slice(0, 10).join(' '));
}

/* ==================== 不变量 ==================== */
/* NPC desc 全库唯一（smoke-portrait-batch 4.B1） */
{
  const seen = {};
  for (const [id, n] of Object.entries(npcDoc.npcs)) (seen[n.desc] = seen[n.desc] || []).push(id);
  const dup = Object.entries(seen).filter(([, v]) => v.length > 1);
  if (dup.length) errors.push('NPC desc 出现重复: ' + dup.slice(0, 3).map((x) => x[1].join(',')).join(' | '));
}
/* 女性 NPC desc 不得含「汉子/爷们」 */
{
  const bad = Object.keys(npcDoc.npcs).filter((id) => npcDoc.npcs[id].gender === 'female' && /汉子|爷们/.test(npcDoc.npcs[id].desc || ''));
  if (bad.length) errors.push('女性 NPC desc 含「汉子」: ' + bad.join(','));
}
/* 任务点位人物 ∈ rel（与 smoke-quest-data 同源规则） */
{
  const nameById = {}; for (const [id, n] of Object.entries(npcDoc.npcs)) if (n.name) nameById[id] = n.name;
  const bad = [];
  for (const qid of Object.keys(qDoc.quests)) {
    if (!/^sq_npcv_/.test(qid)) continue;
    const q = qDoc.quests[qid]; const gid = qid.replace(/^sq_/, ''); const g = npcDoc.npcs[gid];
    const rel = new Set((g.rel || []).map((r) => r.id));
    const text = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
    for (const mid in nameById) {
      const nm = nameById[mid];
      if (nm.length < 2 || !text.includes(nm)) continue;
      if (mid === gid) continue;
      if (nm !== g.name && g.name.includes(nm)) continue;
      if (!rel.has(mid)) bad.push(qid + '/' + g.name + '×' + nm);
    }
  }
  if (bad.length) errors.push('点位人物越界(' + bad.length + '): ' + bad.join(' '));
}
/* 反向自检：本次新写的房间/NPC 描述里若「撞上」某个 NPC 姓名，打印出来供人工判断 */
{
  const names = Object.values(npcDoc.npcs).map((n) => n.name).filter((x) => x && x.length >= 2);
  const hits = [];
  for (const [id, desc] of Object.entries(D.ROOMS)) for (const nm of names) if (desc.includes(nm)) hits.push('room:' + id + '×' + nm);
  for (const [id, desc] of Object.entries(D.NPC_DESC)) if (id !== 'guard_jinywei_talk_2') for (const nm of names) if (desc.includes(nm)) hits.push('npcDesc:' + id + '×' + nm);
  if (hits.length) info.push('⚠ 新文本与 NPC 名同形（人工确认是否真撞名）: ' + hits.join(' '));
}
/* 任务总条数 */
if (Object.keys(qDoc.quests).length !== 305) errors.push('任务总数变了: ' + Object.keys(qDoc.quests).length);
/* 禁模板占位 / 乱码 */
for (const qid of Object.keys(qDoc.quests)) {
  const q = qDoc.quests[qid];
  const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
  if (/\{\{|\{g\}|\{t\}|\{d\}\}|undefined|�/.test(txt)) errors.push('占位/乱码残留: ' + qid);
}

/* ==================== tutorial.js（只替换中文字符串，不动结构） ==================== */
const TJ = 'game/src/core/tutorial.js';
const tjOrig = loadRaw(TJ);
let tj = tjOrig;
let tjHits = 0;
for (const [oldS, newS] of D.TUTORIAL) {
  const cnt = tj.split(oldS).length - 1;
  if (cnt === 0) { errors.push('tutorial 未命中: ' + oldS.slice(0, 40)); continue; }
  if (cnt !== 1) { errors.push('tutorial 命中 ' + cnt + ' 次(应唯一): ' + oldS.slice(0, 40)); continue; }
  if (oldS === newS) { errors.push('tutorial 未变(等于原文): ' + oldS.slice(0, 30)); continue; }
  tj = tj.split(oldS).join(newS); tjHits++;
}
/* 结构未动：把所有单引号字符串内容折成 '' 后，骨架应完全一致 */
{
  const stripQ = (s) => s.replace(/'[^']*'/g, "''");
  if (stripQ(tjOrig) !== stripQ(tj)) errors.push('tutorial.js 除字符串内容外的结构被改动');
  if (tjOrig.split('\n').length !== tj.split('\n').length) errors.push('tutorial.js 行数变化');
}
info.push('tutorial.js 中文串替换: ' + tjHits + ' 处；文件 ' + tjOrig.length + ' → ' + tj.length + ' 字节');

/* ==================== 落盘 ==================== */
if (errors.length) {
  console.error('✘ 应用失败，未写入：');
  errors.slice(0, 40).forEach((e) => console.error('   · ' + e));
  if (errors.length > 40) console.error('   … 共 ' + errors.length + ' 条');
  process.exit(1);
}
const outMap = serial('game/data/50_map.json', mapDoc);
const outNpc = serial('game/data/40_npcs.json', npcDoc);
const outQ = serial('game/data/60_quests.json', qDoc);
/* 写前再核一次格式（重读磁盘的原始对象应能复现，证明格式探测没错） */
assertFormat('game/data/50_map.json', mapOrig);
assertFormat('game/data/40_npcs.json', npcOrig);
assertFormat('game/data/60_quests.json', qOrig);
fs.writeFileSync(P('game/data/50_map.json'), outMap, 'utf8');
fs.writeFileSync(P('game/data/40_npcs.json'), outNpc, 'utf8');
fs.writeFileSync(P('game/data/60_quests.json'), outQ, 'utf8');
fs.writeFileSync(P(TJ), tj, 'utf8');

/* ---------- 复读回验（逐字节） ---------- */
for (const [f, expected] of [['game/data/50_map.json', outMap], ['game/data/40_npcs.json', outNpc], ['game/data/60_quests.json', outQ], [TJ, tj]]) {
  const back = loadRaw(f);
  if (back !== expected) { console.error('✘ 回读不一致: ' + f); process.exit(1); }
}
console.log('✔ 已落盘并通过校验');
info.forEach((s) => console.log('   · ' + s));
console.log('   50_map.json ' + outMap.length + ' bytes / 40_npcs.json ' + outNpc.length + ' / 60_quests.json ' + outQ.length);
