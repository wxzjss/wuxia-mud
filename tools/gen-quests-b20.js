/**
 * gen-quests-b20.js — B20 修正：288 条模板支线 `sq_npcv_*` 的「串号」批量重写
 * ============================================================================
 * 交付物（对应 design/13-owner-bug-fix-report.md「批次 6 · 任务数据」）：
 *   ① A 层 26 人（V01–V26）的 `sq_npcv_*` 模板 —— **从 quests 中移除**（停用）。
 *   ② 其余 262 条 —— **保留为「杂务」**，但修三处串号：
 *        · 目标人名必须 ∈ 该 NPC 的 rel（同 region 优先）；无关系可挑 → 泛称
 *        · 目的地必须落在该 NPC 自己的 region（同区房间）
 *        · say 文案按 giver.tag 分出 33 种口吻（不再是清一色「多谢你了」）
 *   ③ 奖励数值（+exp / +pot / favor）**原样不动**；id / name / var **原样不动**。
 *
 * 铁律：
 *   · 只读 40_npcs.json / 50_map.json（不写）。
 *   · 只写 60_quests.json；缩进 2 空格 + 结尾换行（与现状逐字节一致）。
 *   · 确定性：以 id 的哈希作种子（mulberry32），同输入同输出，可复跑。
 *   · 不含随机数（Math.random），避免回档换脸。
 *
 * 用法：node tools/gen-quests-b20.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* ---------------- A 层 26 人（V01–V26）· design/23 §8 / §11 ---------------- */
const A26 = [
  'npcv_241', 'npcv_154', 'npcv_010', 'npcv_208', 'npcv_091', 'npcv_065', 'npcv_223',
  'npcv_174', 'npcv_240', 'npcv_009', 'npcv_237', 'npcv_248', 'npcv_215', 'npcv_180',
  'npcv_115', 'npcv_083', 'npcv_126', 'npcv_164', 'npcv_186', 'npcv_090', 'npcv_074',
  'npcv_252', 'npcv_178', 'npcv_095', 'npcv_036', 'npcv_082',
];
const A26_SET = new Set(A26.map(id => 'sq_' + id));

/* ---------------- 10 种模板类型（识别口径同 gen-quests-fix.js：name 后缀） ---------------- */
const TYPES = [
  { cn: '送信', key: 'errand' }, { cn: '寻人', key: 'find' },
  { cn: '采买', key: 'fetch' }, { cn: '采药', key: 'herb' },
  { cn: '除害', key: 'beast' }, { cn: '讨债', key: 'debt' },
  { cn: '寻物', key: 'lost' }, { cn: '护送', key: 'escort' },
  { cn: '打探', key: 'rumor' }, { cn: '了结', key: 'avenge' },
];

/* ---------------- say 文案：33 种 tag 口吻（一两句，不写小作文） ---------------- */
const TAG_SAY = {
  commoner:  '点点头：「劳烦你了。」',
  vendor:    '把担子往肩上挪了挪：「下回买我的货，算你便宜些。」',
  scholar:   '拱手：「有劳。这份情我记着。」',
  farmer:    '搓着泥手：「乡下没什么好谢的，这筐菜你拿着。」',
  smith:     '「叮当」一声又抡起锤：「记你的情。」',
  doctor:    '收拾着药箱：「日后有个头疼脑热，尽管来找我。」',
  innkeeper: '撩起柜台布帘：「回头给你留间上房。」',
  waiter:    '擦着桌沿：「多谢客官。」',
  merchant:  '拨了拨算盘：「买卖人不亏待跑腿的。」',
  richman:   '摆了摆手：「这点碎银，拿去喝茶。」',
  groom:     '拍了拍马脖子：「马在槽里，你要用尽管牵。」',
  child:     '仰起脸：「谢谢你！这个……给你。」',
  beggar:    '咧开嘴：「嗐，多谢你。下回讨了饭，先分你一口。」',
  refugee:   '深深一揖：「恩公，我记着你的脸。」',
  escort:    '拍了拍你的肩：「路上小心。」',
  constable: '按了按刀柄：「差事办得利落。」',
  official:  '提笔在册上一按：「本官记下了。」',
  eunuch:    '捏着嗓子：「办得好，咱家心里有数。」',
  palace:    '压低了声：「宫里的事，少问。」',
  consort:   '掩唇一笑：「你倒是个伶俐的。」',
  courtesan: '替你斟了半盏：「难得见你这样实心的人。」',
  madam:     '斜着眼：「楼里的事，嘴上把着点门。」',
  singer:    '调了调弦：「下一段曲儿，唱给你听。」',
  swordsman: '抱拳：「大恩不言谢。」',
  thief:     '左右看了一眼，低声道：「这事，你烂在肚子里。」',
  hunter:    '收了套索：「山里的规矩，帮了忙就得还。」',
  monk:      '合十：「善哉。施主自有福报。」',
  nun:       '捻着念珠：「阿弥陀佛。」',
  taoist:    '打了个稽首：「无量寿福。」',
  actor:     '掸了掸戏服：「台下人多，就不多说了。」',
  boatman:   '扯了扯缆绳：「江上风大，多留神。」',
  gambler:   '推过两枚骰子：「手气正旺，这两把算你的。」',
  waiter2:   '把抹布一甩：「跑堂的记着你的好。」',
};
const SAY_DEFAULT = '点点头：「多谢你了。」';

/* ---------------- 确定性随机 ---------------- */
function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------------- 读数据 ---------------- */
const qDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/60_quests.json'), 'utf8'));
const quests = qDoc.quests;
const npcs = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/40_npcs.json'), 'utf8')).npcs;
const rooms = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/50_map.json'), 'utf8')).rooms;

const regionOf = rid => (rid && rooms[rid]) ? rooms[rid].region : null;
const nameOfRoom = rid => (rooms[rid] && rooms[rid].name) || rid;

/* 地名软偏好：让「采药/除害」落在野地、「采买/寻物」落在铺面，读起来才不像模板
   （按 50_map.json 实测房间名拟定，不含「桥/堂/庙/门」等易误配的字） */
const WILD_RE = /山|林|坡|谷|洞|溪|潭|塘|村|郊|崖|野|荒|岭|岩|泉|园|圃|田|岛/;
const SHOP_RE = /市|铺|店|摊|坊|馆|楼|街|巷|栈|行|集|杂货|车马/;

function sameRegionPool(gid, reg) {
  const g = npcs[gid];
  const gr = g.room;
  let pool = Object.keys(rooms).filter(r => rooms[r].region === reg && r !== gr && !rooms[r].private && !/^hm_/.test(r) && !/^house/.test(r));
  if (!pool.length) pool = Object.keys(rooms).filter(r => rooms[r].region === reg && r !== gr && !rooms[r].private);
  return pool.sort();
}

function pickFrom(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

/* 同 region 的 rel 关系人（可选按 kind 过滤）；目标人名只能从这里出 */
function pickRel(gid, reg, kinds, rnd) {
  const g = npcs[gid];
  let list = (g.rel || []).filter(r => npcs[r.id] && r.id !== gid && (!kinds || kinds.includes(r.kind)));
  const same = list.filter(r => regionOf(npcs[r.id].room) === reg);
  const pool = same.length ? same : [];
  if (!pool.length) return null;
  return pool[Math.floor(rnd() * pool.length)];
}

/* 泛称（无关系可挑时用「城里的某类人」，绝不张冠李戴） */
function genericPerson(placeName) {
  if (/衙|门|堂|署|局/.test(placeName)) return '衙门口当差的';
  if (/寺|庙|观|庵/.test(placeName)) return '庙里进香的香客';
  if (/铺|店|市|摊|坊|馆|楼/.test(placeName)) return '铺子里的掌柜';
  if (/街|巷|集/.test(placeName)) return '街面上的熟人';
  return '城里的旧相识';
}

/* ---------------- 重写单条 ---------------- */
function rewrite(qid) {
  const q = quests[qid];
  const gid = qid.replace(/^sq_/, '');
  const g = npcs[gid];
  if (!g) return { skip: 'no-giver' };
  const reg = regionOf(g.room);
  if (!reg) return { skip: 'no-region' };

  const t = TYPES.find(x => q.name.endsWith(x.cn)) || TYPES[0];
  const rnd = mulberry32(hash(qid));
  const pool = sameRegionPool(gid, reg);
  if (!pool.length) return { skip: 'no-pool' };

  let destRoom = null, person = null;

  if (t.key === 'errand') {                       // 送信：送到关系人手上
    const r = pickRel(gid, reg, null, rnd);
    if (r) { person = npcs[r.id].name; destRoom = npcs[r.id].room; }
    if (!person || !destRoom || destRoom === g.room) { destRoom = pickFrom(pool, rnd); person = genericPerson(nameOfRoom(destRoom)); }
  } else if (t.key === 'find') {                  // 寻人：去同区某处打听关系人
    const r = pickRel(gid, reg, null, rnd);
    destRoom = pickFrom(pool, rnd);
    if (r) person = npcs[r.id].name; else person = genericPerson(nameOfRoom(destRoom));
  } else if (t.key === 'herb' || t.key === 'beast') {
    const pref = pool.filter(r => WILD_RE.test(nameOfRoom(r)));
    destRoom = pickFrom(pref.length ? pref : pool, rnd);
  } else if (t.key === 'fetch' || t.key === 'lost') {
    const pref = pool.filter(r => SHOP_RE.test(nameOfRoom(r)));
    destRoom = pickFrom(pref.length ? pref : pool, rnd);
  } else if (t.key === 'debt') {                  // 讨债：优先 rel 里的「仇」
    const r = pickRel(gid, reg, ['仇', '友', '亲', '师', '生', '夫妻'], rnd);
    destRoom = pickFrom(pool, rnd);
    if (r && r.kind === '仇') person = npcs[r.id].name;
  } else if (t.key === 'avenge') {                // 了结：优先 rel 里的「仇」
    const r = pickRel(gid, reg, ['仇', '友', '亲'], rnd);
    const r2 = r; destRoom = pickFrom(pool, rnd); person = r2 ? npcs[r2.id].name : null;
    if (r2 && r2.kind !== '仇' && person) person = null; // 非仇不点名，避免「教训朋友」
  } else {                                        // escort / rumor
    destRoom = pickFrom(pool, rnd);
  }
  if (!destRoom || !rooms[destRoom]) return { skip: 'no-dest' };

  const place = nameOfRoom(destRoom);
  const G = g.name;
  let desc, s0, s1;
  switch (t.key) {
    case 'errand': desc = `${G}托你把一封信捎给${person}。`; s0 = `把信送到${place}`; s1 = '回去复命'; break;
    case 'find': desc = `${G}托你寻一位久未走动的旧识${person}。`; s0 = `去${place}打听${person}的消息`; s1 = `把${person}的下落带回去`; break;
    case 'fetch': desc = `${G}要你替他跑趟腿，买些日用杂货。`; s0 = `去${place}买齐日用杂货`; s1 = `把东西交回给${G}`; break;
    case 'herb': desc = `${G}家里有人病了，缺一味药。`; s0 = `去${place}采三株草药`; s1 = `把药材交回给${G}`; break;
    case 'beast': desc = `近来${place}一带有野兽作乱。`; s0 = `去${place}除掉作乱的野兽`; s1 = `回去向${G}报个信`; break;
    case 'debt': desc = `${G}有笔旧账要不回来，想请你出面。`; s0 = person ? `去${place}找着欠债的${person}` : `去${place}找着欠债的人`; s1 = `把债讨回来交给${G}`; break;
    case 'lost': desc = `${G}丢了件要紧物事，急得团团转。`; s0 = `去${place}附近找找`; s1 = `把东西交还给${G}`; break;
    case 'escort': desc = `${G}有趟货要送，路上不太平。`; s0 = `把这趟货护送到${place}`; s1 = '平安抵达'; break;
    case 'rumor': desc = `${G}想让你去打听一桩旧事。`; s0 = `去${place}打听`; s1 = `回来把打听到的告诉${G}`; break;
    case 'avenge': desc = `${G}有桩恩怨压在心里多年。`; s0 = person ? `去${place}找${person}理论` : `去${place}找那人理论`; s1 = '回来复命'; break;
    default: return { skip: 'unknown-type' };
  }

  /* 落盘：只动文本 + 目的地；id/name/level/type/giver/stages[].cond/var/rewards 数值 全不动 */
  q.desc = desc;
  const st0 = q.stages[0];
  st0.desc = s0;
  if (!st0.targets) st0.targets = [];
  if (!st0.targets[0]) st0.targets[0] = { id: 'go', kind: 'room', key: destRoom, desc: s0, count: 1, var: qid + '_go' };
  st0.targets[0].key = destRoom;
  st0.targets[0].desc = s0;
  if (q.stages[1]) q.stages[1].desc = s1;
  for (const rw of (q.rewards || [])) {
    if (rw.type === 'say') rw.raw = G + (TAG_SAY[g.tag] || SAY_DEFAULT);
  }
  return { ok: true, qid, type: t.key, dest: destRoom, reg, person: person || '(泛称)' };
}

/* ---------------- 执行 ---------------- */
const removed = [];
const rewritten = [];
const skipped = [];
for (const qid of Object.keys(quests)) {
  if (!/^sq_npcv_/.test(qid)) continue;
  if (A26_SET.has(qid)) { delete quests[qid]; removed.push(qid); continue; }
  const r = rewrite(qid);
  if (r.ok) rewritten.push(r); else skipped.push(qid + ':' + r.skip);
}

/* ---------------- 写回（2 空格缩进 + 结尾换行，与现状一致） ---------------- */
fs.writeFileSync(path.join(ROOT, 'game/data/60_quests.json'), JSON.stringify(qDoc, null, 2) + '\n');

console.log('移除（A 层 26 人模板）:', removed.length);
console.log('重写（保留为杂务）    :', rewritten.length);
console.log('跳过                 :', skipped.length, skipped.slice(0, 10));
console.log('剩余任务总数         :', Object.keys(quests).length);
