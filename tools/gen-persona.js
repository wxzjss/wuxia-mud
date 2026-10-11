/**
 * gen-persona.js — 给全库 NPC 播种性格（写 `game/data/87_persona.json`）
 *
 * 为什么非播不可：`personality.js` 里九种性格与「表情/说辞」早就写好了，
 *   但**数据层是空的** —— 463 个 NPC 里只有 2 个手写过 personality，
 *   其余全靠 `personalityForTag(tag)` 兜底；而兜底表的默认值是「木讷」，
 *   于是落成一片木讷（183/463，四成），「暴躁」干脆一个都没有。
 *   性格相性（初见加减好感）是**按性格算**的，一成片的木讷等于这套系统白做。
 *
 * 分配顺序（越靠前越优先）：
 *   ① 作者手写的 personality 一律保留
 *   ② 门派气质（佛道清修→木讷/温婉；草莽帮会→豪爽；暗器毒蛊→阴鸷；勾栏→油滑）
 *   ③ 身份 tag（沿用 personality.js 的 TAG_PERSONALITY）
 *   ④ 名字 / 头衔 / 描述里的关键词（「性烈」「不苟言笑」「柔声」…）
 *   ⑤ 兜底：按 id 做**确定性哈希**在九种里轮换 —— 世上本就什么人都有，
 *      比让所有人一样木讷强；且同 id 每次结果相同，不会每次读档变性格。
 *
 * ⚠️ id 在容器 **key** 上（79_culture_npcs 那批对象内部不写 id）。
 * ⚠️ 只写 `personality` 一个字段，不动别的。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

const dataDir = path.join(ROOT, 'game/data');
const FILES = fs.readdirSync(dataDir).filter(f => /^\d\d_.*\.json$/.test(f) && f !== '87_persona.json').sort();

const merged = {};
for (const f of FILES) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  if (!j.npcs) continue;
  const pairs = Array.isArray(j.npcs) ? j.npcs.map(n => [(n && n.id) || null, n]) : Object.entries(j.npcs);
  for (const [key, n] of pairs) {
    const id = (n && n.id) || key;
    if (!id || !n) continue;
    merged[id] = Object.assign(merged[id] || {}, n, { id });
  }
}

/* ---- ①.5 人物点名表（优先级仅次于作者手写）----
   ⚠️ 为什么非有不可：门派气质 + 哈希只能保证「像那个门派的」，保证不了「像那个人」。
      第一版跑出来岳不群=豪爽、东方不败=侠义 —— 门派对了、人完全错了。
      主人点名的「不要模板化」正是说这个：有名有姓的人得按他自己的性子来。 */
const NAMED = {
  // —— 正派 / 侠义 ——
  '洪七公': 'haoshuang', '郭靖': 'mune', '乔峰': 'haoshuang', '萧峰': 'haoshuang',
  '陈近南': 'xiayi', '胡斐': 'xiayi', '苗人凤': 'lengmo', '柯镇恶': 'baozhao',
  '段誉': 'wenwan', '虚竹': 'mune', '张无忌': 'wenwan', '令狐冲': 'haoshuang',
  '风清扬': 'lengmo', '张三丰': 'mune', '方证': 'mune', '方证大师': 'mune', '冲虚': 'mune', '冲虚道长': 'mune',
  // —— 伪 / 阴 ——
  '岳不群': 'yinzhi', '左冷禅': 'yinzhi', '东方不败': 'yinzhi', '任我行': 'baozhao',
  '欧阳锋': 'yinzhi', '丁春秋': 'yinzhi', '慕容复': 'yinzhi', '全冠清': 'yinzhi',
  // —— 孤傲 / 冷 ——
  '黄药师': 'lengmo', '杨过': 'lengmo', '小龙女': 'lengmo', '李莫愁': 'baozhao',
  '灭绝师太': 'baozhao', '金轮法王': 'baozhao', '血刀老祖': 'baozhao',
  // —— 活络 / 机巧 ——
  '韦小宝': 'youhua', '周伯通': 'haoshuang', '赵敏': 'youhua', '黄蓉': 'youhua',
  '阿朱': 'youhua', '田伯光': 'youhua', '桃谷六仙': 'haoshuang',
  // —— 温婉 ——
  '王语嫣': 'wenwan', '小昭': 'wenwan', '程灵素': 'wenwan', '任盈盈': 'wenwan',
  '仪琳': 'wenwan', '双儿': 'wenwan', '穆念慈': 'wenwan',
  // —— 怯懦 / 木讷 ——
  '阿紫': 'yinzhi', '游坦之': 'qienuo', '林平之': 'yinzhi', '狄云': 'mune',
  // —— 才子 / 文人 ——
  '唐寅': 'haoshuang', '唐伯虎': 'haoshuang', '祝允明': 'youhua', '文徵明': 'wenwan',
  '周文宾': 'youhua', '徐祯卿': 'mune', '张灵': 'haoshuang', '都穆': 'mune',
  // —— 官面 ——
  '冯保': 'yinzhi', '柳含烟': 'wenwan',
};

/* 画像语气那一层（TONE_PERSONA / personaFromVoice）已经收进 core/personality.js，
   生成器与核对脚本共用同一份映射 —— 各写一份迟早对不上。 */
const personaFromVoice = P.personaFromVoice;

/** 点名：先按全名精确，再按「名字里含这一串」（对付"方证大师"这种带后缀的） */
function matchNamed(name) {
  if (!name) return null;
  if (NAMED[name]) return NAMED[name];
  for (const k of Object.keys(NAMED)) if (name.includes(k)) return NAMED[k];
  return null;
}

/* ---- ② 门派气质 ---- */
const SECT_PERSONA = {
  // 佛道清修：话少、和缓
  shaolin: ['mune', 'wenwan'], wudang: ['mune', 'wenwan'], emei: ['wenwan', 'mune'],
  hengshan: ['wenwan', 'mune'], quanzhen: ['mune', 'wenwan'], taishan: ['mune'],
  // 草莽帮会：豪爽义气，也有阴的
  gaibang: ['haoshuang', 'xiayi'], mingjiao: ['haoshuang', 'baozhao'],
  riyue: ['yinzhi', 'baozhao'], xuedao: ['baozhao', 'yinzhi'], xingxiu: ['yinzhi', 'youhua'],
  // 暗器毒蛊：心里的账不外露
  tangmen: ['yinzhi', 'mune'], wudu: ['yinzhi', 'youhua'],
  // 勾栏：见人说人话
  hehuan: ['youhua', 'wenwan'], qinglou: ['youhua', 'wenwan'],
  // 名门正派里的侠气
  huashan: ['xiayi', 'haoshuang'], jindao: ['haoshuang', 'xiayi'],
  dali: ['wenwan', 'mune'], gumu: ['lengmo', 'wenwan'], taohua: ['youhua', 'wenwan'],
};

/* ---- ④ 关键词 ---- */
const KW_RULES = [
  [/性烈|暴躁|脾气|火爆|性急|怒气|凶悍|恶煞|屠|杀神|霸道/, 'baozhao'],
  [/不苟言笑|冷|寡言|阴沉|面色不|淡漠|孤僻|独来独往/, 'lengmo'],
  [/温|柔|和顺|轻声|和气|温和|慈|善目|恬/, 'wenwan'],
  [/胆小|怯|怕事|畏|战战兢兢|老实|憨|木讷|笨嘴/, 'qienuo'],
  [/佞|滑|精|机灵|巧言|能说|活络|八面|买卖|做生意的/, 'youhua'],
  [/奸|毒|阴|算|城府|笑面|藏|秘|诡/, 'yinzhi'],
  [/侠|义|正直|刚正|光明|磊落|好汉|豪杰/, 'xiayi'],
  [/豪|爽|酒|快人快语|大嗓|洪钟|粗豪|憨直/, 'haoshuang'],
  [/讷|沉默|木|拙于|不擅言|寡淡|呆/, 'mune'],
];

/** 确定性哈希（mulberry32 派生），同 id 永远同结果 */
function hashPick(id, arr) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  /* ⚠️ 末尾必须再来一次 `>>> 0`：`^=` 的结果是**带符号 32 位整数**，
     负数取模得到负下标 → `arr[-3]` 是 undefined（第一版就栽在这儿，71 个 NPC 性格成了 undefined）。 */
  h = h >>> 0;
  return arr[h % arr.length];
}

/** 九种按权重轮换（越常见的排前面，保证哈希落点分布有层次） */
const FALLBACK_POOL = ['mune', 'youhua', 'haoshuang', 'wenwan', 'xiayi', 'lengmo', 'baozhao', 'yinzhi', 'qienuo'];

const out = {};
let fromSect = 0, fromTag = 0, fromKw = 0, fromHash = 0, fromNamed = 0, fromVoice = 0, kept = 0;
const dist = {};

for (const id of Object.keys(merged)) {
  const n = merged[id];
  if (n.personality && P.PERSONALITIES[n.personality]) { kept++; continue; }
  let per = null, src = '';
  /* 顺序：画像语气 → 点名 → 门派 → 身份 tag → 关键词 → 哈希兜底 */
  per = personaFromVoice(n);
  if (per) src = 'voice';
  if (!per) { per = matchNamed(n.name); if (per) src = 'named'; }
  const sect = !per && n.sect && SECT_PERSONA[n.sect];
  if (!per && sect) { per = hashPick(id, sect); src = 'sect'; }
  if (!per) {
    const byTag = n.tag && P.TAG_PERSONALITY[n.tag];
    /* tag 兜底的默认值（mune）不算「命中」，交给后面的关键词与哈希去决定 */
    if (byTag && byTag !== 'mune') { per = byTag; src = 'tag'; }
  }
  if (!per) {
    const blob = [n.name, n.title, n.desc, n.job].filter(Boolean).join(' ');
    for (const [re, pid] of KW_RULES) { if (re.test(blob)) { per = pid; break; } }
    if (per) src = 'kw';
  }
  if (!per) {
    const byTag = n.tag && P.TAG_PERSONALITY[n.tag];
    per = byTag && byTag !== 'mune' ? byTag : hashPick(id, FALLBACK_POOL);
    src = byTag ? 'tag' : 'hash';
  }
  if (src === 'voice') fromVoice++;
  else if (src === 'named') fromNamed++;
  else if (src === 'sect') fromSect++;
  else if (src === 'kw') fromKw++;
  else if (src === 'hash') fromHash++;
  else fromTag++;
  out[id] = { personality: per };
  dist[per] = (dist[per] || 0) + 1;
}

const payload = { npcs: {} };
for (const id of Object.keys(out).sort()) payload.npcs[id] = out[id];
const dest = path.join(dataDir, '87_persona.json');
fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + '\n');

const total = Object.keys(out).length;
console.log(`gen-persona: 扫描 ${Object.keys(merged).length} 个 NPC`);
console.log(`  播种 ${total} 人（作者手写保留 ${kept}）`);
console.log(`  来源：画像语气 ${fromVoice} · 点名 ${fromNamed} · 门派 ${fromSect} · 身份 tag ${fromTag} · 关键词 ${fromKw} · 哈希兜底 ${fromHash}`);
console.log('  分布：' + Object.keys(dist).sort((a, b) => dist[b] - dist[a])
  .map(k => `${P.PERSONALITIES[k].name}${dist[k]}(${Math.round(dist[k] / total * 100)}%)`).join(' '));
console.log(`  写出 ${path.relative(ROOT, dest)}`);
