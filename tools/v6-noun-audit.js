#!/usr/bin/env node
/* ============================================================
 * v6-noun-audit.js —— design/77 §3「门派独有句」实物名词核对
 *
 * 团队长派的话：游有方写了 60 句门派独有句，每句提到一样具体实物
 * （琴谱、剑诀、戒尺、铁栅…），**门派独有句与实际拥有的武学/物品可能对不上**
 * （比如写了琴谱但衡山没有琴）。他按「能查证就改，查不到就换成不含实物的通用句」处理。
 *
 * 本脚本做的事：
 *   1. 从 design/77-room-rewrite-sample.md §3.2 / §3.3 / §3.4 的表格里
 *      解析出每一句（id / 门派 / 句子）。
 *   2. 从句里抽出**实物名词**（词典见下）。
 *   3. 拿名词去这个门派自己的证据里查：
 *        story / desc / trial（72_sects_tier）
 *        · 门派武学名（72.skills → 10_skills.name）
 *        · 该门派在 73_sects_place 里的房间与 NPC 文本
 *      命中 = **强据**；
 *      本门派没有、但全库物品表（20_items）/ 武学表里有同名 = **弱据**（存在，但不是他家的）；
 *      全库都查不到 = **无据**（游有方要处理的就是这些）。
 *
 * ⚠️ 只读，不写任何文件。
 * ⚠️ 文件名刻意不叫 *-check.js：这是**一次性核对报告**，不是门禁。
 *
 * 用法：
 *   node tools/v6-noun-audit.js            打全表（按 无据 → 弱据 → 强据 排序）
 *   node tools/v6-noun-audit.js --bad      只打「无据/弱据」
 *   node tools/v6-noun-audit.js --sect hengshan
 *   node tools/v6-noun-audit.js --selftest 自测
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const DOC = path.join(ROOT, 'design', '77-room-rewrite-sample.md');

/* ---------------- 实物名词词典 ----------------
 * 顺序有意义：先匹配更具体的（剑谱/琴谱），再退化到单字（剑/琴）。 */
const NOUNS = [
  /* [名, 抽取正则, 查证正则] —— 查证正则更宽：「牛角」用「牛」查，「琴弦」用「琴」查，
     否则 story 里写了「怎么把一头牛按倒」却判「牛角」无据，那是量具太笨不是句子错。 */
  ['剑谱', /剑谱|剑诀/, /剑/], ['刀谱', /刀谱/, /刀/], ['拳谱', /拳谱/, /拳/],
  ['琴谱', /琴谱/, /琴/], ['曲谱', /曲谱/, /曲|谱/],
  ['剑', /剑/], ['刀', /刀/], ['琴弦', /琴弦/, /琴/], ['琴', /琴/],
  ['戒尺', /戒尺/], ['铁栅', /铁栅|栅门/, /栅/], ['暗器', /暗器/, /暗器|暗青子/],
  ['药箱', /药箱/, /药/], ['药', /药/], ['丹', /丹/], ['毒', /毒/], ['蛊', /蛊/],
  ['镖旗', /镖旗/, /旗|镖/], ['旗', /旗/], ['枪', /枪/], ['棍', /棍/],
  ['账本', /账本/, /账/], ['账', /账/], ['竹片', /竹片/, /竹/], ['船图', /船图|船/, /船|图/],
  ['铜镜', /铜镜|镜子/, /镜/], ['手套', /手套/, /手套|掌/], ['护腕', /护腕/, /护腕|腕/],
  ['牛角', /牛角/, /牛/], ['纤绳', /纤绳/, /绳|纤/], ['皮货', /皮货/, /皮/],
  ['罐', /罐/], ['瓶', /瓶/], ['箱子', /箱子|箱盖/], ['封条', /封条/],
  ['画像', /一幅画|画的是/, /画/], ['石头', /石头|石块/, /石|苍山/], ['靴', /靴|鞋/],
  ['谱子', /谱子/, /谱/], ['木牌', /木牌|牌子/, /牌/], ['锁', /锁/],
];

/** 骨架自带、不需按门派查证的容器/陈设词（库房骨架就是「几口箱子」，藏宝阁骨架就是「格子」） */
const BACKGROUND = new Set(['箱子', '格子', '架子', '书', '纸', '布', '锁', '木牌', '谱子']);

/* ---------------- 解析 design/77 §3 ---------------- */

function parseDoc() {
  const lines = fs.readFileSync(DOC, 'utf8').split(/\r?\n/);
  const rows = [];
  let sec = null;
  for (const ln of lines) {
    const h = ln.match(/^##\s*3\.(\d)\s/);
    if (h) { sec = h[1]; continue; }
    if (!/^\|/.test(ln)) continue;
    if (sec !== '2' && sec !== '3' && sec !== '4') continue;
    const m = ln.match(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/);
    if (!m) continue;
    const q = ln.match(/「(.+)」/);
    const sent = q ? q[1] : null;
    /* id 形如 hengshan_library / wuhu_vault；门派 id = 去掉尾缀 */
    const roomId = m[2];
    const sectId = roomId.replace(/_(library|vault)$/, '');
    rows.push({ n: +m[1], sec: '3.' + sec, roomId, sectId, sectCN: m[3].replace(/[（(].*$/, '').trim(), sent });
  }
  return rows;
}

/* ---------------- 证据 ---------------- */

const load = f => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return null; } };

function buildEvidence() {
  const tier = load('72_sects_tier.json') || {};
  const sects30 = (load('30_sects.json') || {}).sects || {};
  const skills = load('10_skills.json') || {};
  const items = load('20_items.json') || {};
  const place = load('73_sects_place.json') || {};

  /* 武学 id → 中文名 */
  const skillName = {};
  const walkSkills = o => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.name === 'string' && typeof o.id === 'string') skillName[o.id] = o.name;
    for (const k of Object.keys(o)) walkSkills(o[k]);
  };
  walkSkills(skills);

  /* 全库物品名 */
  const itemNames = [];
  const walkItems = o => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.name === 'string') itemNames.push(o.name);
    for (const k of Object.keys(o)) walkItems(o[k]);
  };
  walkItems(items);

  const per = {};
  const sectIds = new Set([...Object.keys(tier.sects || {}), ...Object.keys(sects30)]);

  /* 该门派在 73_sects_place 里的房间 / NPC 文本 */
  const placeText = {};
  const push = (id, t) => { (placeText[id] = placeText[id] || []).push(String(t)); };
  for (const r of Object.values(place.rooms || {})) {
    if (!r || !r.id) continue;
    const sid = r.sect || String(r.id).split('_')[0];
    push(sid, (r.name || '') + ' ' + (r.desc || ''));
  }
  for (const n of Object.values(place.npcs || {})) {
    if (!n || !n.id) continue;
    const sid = n.sect || String(n.id).split('_')[0];
    push(sid, (n.name || '') + ' ' + (n.title || '') + ' ' + (n.desc || ''));
  }
  /* 全库 NPC / 房间：只认**显式 sect 字段**（不靠 id 前缀猜，猜错会造出假强据） */
  for (const f of fs.readdirSync(DATA).filter(x => /^\d+_.*\.json$/.test(x))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    for (const n of Object.values(j.npcs || {})) {
      if (!n || typeof n !== 'object' || !n.sect) continue;
      const t = [n.name, n.title, n.desc].concat(Array.isArray(n.talk) ? n.talk : []).filter(Boolean).join(' ');
      push(n.sect, t);
    }
    for (const r of Object.values(j.rooms || {})) {
      if (!r || typeof r !== 'object' || !r.sect) continue;
      push(r.sect, (r.name || '') + ' ' + (r.desc || ''));
    }
  }

  for (const sid of sectIds) {
    const t = (tier.sects || {})[sid] || {};
    const s = sects30[sid] || {};
    const sk = [...new Set([].concat(t.skills || [], s.skills || []))]
      .map(id => skillName[id] || id).join('、');
    /* 门派**自己的名字**也是证据：「罗汉门」画罗汉，不需要别处再写一遍 */
    const text = [t.name, s.name, t.story, t.desc, t.trial, s.desc, sk, (placeText[sid] || []).join(' ')]
      .filter(Boolean).join(' ');
    per[sid] = { name: t.name || s.name || sid, tier: t.tier || '', text, skills: sk };
  }
  return { per, itemNames, skillName };
}

/** 判定一句里每个实物名词的证据强度 */
function audit(row, ev) {
  const e = ev.per[row.sectId];
  if (!row.sent) return { row, nouns: [], level: '跳过', note: '本行没给句子（见 §2 完整三段式）' };
  if (!e) return { row, nouns: [], level: '无据', note: '门派表里没有这个门派：' + row.sectId };

  const nouns = NOUNS.filter(([, re]) => re.test(row.sent)).map(([n]) => n);
  /* 去更泛的重复：命中「剑谱」就不再报「剑」 */
  const uniq = nouns.filter(n => !nouns.some(m => m !== n && m.includes(n) && m.length > n.length));
  const bg = uniq.filter(n => BACKGROUND.has(n));
  const keep = uniq.filter(n => !BACKGROUND.has(n));
  const strong = [], weak = [], none = [];
  for (const n of keep) {
    const rule = NOUNS.find(x => x[0] === n);
    const probe = rule[2] || rule[1];
    if (probe.test(e.text)) strong.push(n);
    else if (ev.itemNames.some(x => x.indexOf(n) >= 0) || Object.values(ev.skillName).some(x => String(x).indexOf(n) >= 0)) weak.push(n);
    else none.push(n);
  }
  const level = none.length ? '无据' : (weak.length ? '弱据' : (strong.length ? '强据' : (bg.length ? '骨架自带' : '未覆盖')));
  return { row, nouns: keep, bg, strong, weak, none, level };
}

/* ---------------- 自测 ---------------- */

function selftest() {
  const out = []; let pass = 0, total = 0;
  const T = (c, m) => { total++; out.push((c ? '  ✔ ' : '  ✘ ') + m); if (c) pass++; };
  console.log('  V6 实物名词核对 · 自测');

  const rows = parseDoc();
  const ev = buildEvidence();

  /* ① 解析侧：60 句要基本解析全（防表头/嵌套引号把句子吃掉） */
  const withSent = rows.filter(r => r.sent);
  T(rows.length >= 55, '解析：§3 表格解析出 ' + rows.length + ' 行（≥55）');
  T(withSent.length >= 55, '  其中拿到句子的 ' + withSent.length + ' 行（≥55，防嵌套「」把句子截断）');
  const kong = rows.find(r => r.roomId === 'kongtong_library');
  T(!!kong && /七伤/.test(kong.sent || ''),
    '  嵌套引号行不丢内容：崆峒那句含「七伤」（实得 ' + String(kong && kong.sent).slice(0, 24) + '…）');

  /* ② 判据侧：造**已知答案**的样本，命中/不命中都要有 */
  const mk = (sectId, sent) => audit({ sectId, roomId: sectId + '_vault', sent }, ev);
  T(mk('hengshan', '架子上摆着琴，也摆着剑。琴在里头，剑在外头。').level === '强据',
    '判据1 强据·衡山琴：衡山 story 明写「看家本事在琴上」→ 强据');
  T(mk('funiu', '箱子里有一副牛角，还有一根绳。').level === '强据',
    '判据2 强据·伏牛牛角：伏牛 story 明写「怎么把一头牛按倒」→ 强据');
  T(mk('hengshan', '箱子里摆着一台留声机，还有半张唱片。').level !== '强据',
    '判据3 不命中·防恒真：硬塞「留声机」→ 不许判强据（实得 '
    + mk('hengshan', '箱子里摆着一台留声机，还有半张唱片。').level + '）');
  const phono = mk('hengshan', '箱子里摆着一台留声机，还有半张唱片。');
  T(phono.nouns.indexOf('留声机') < 0 && phono.none.indexOf('留声机') < 0,
    '判据4 词典外的名词不硬判：留声机不在词典里 → 不进名词表也不报「无据」（实得名词 '
    + JSON.stringify(phono.nouns) + '），由人工看');
  T(mk('nosuchsect', '箱子里有东西。').level === '无据',
    '判据5 门派不存在 → 判无据并写原因（不许静默放行）');

  /* ③ 量具没瞎：真实数据里「强据」必须占多数（否则说明证据源取错了） */
  const aud = rows.map(r => audit(r, ev));
  const lv = {};
  aud.forEach(a => { lv[a.level] = (lv[a.level] || 0) + 1; });
  T((lv['强据'] || 0) > 20, '真实数据：强据 ' + (lv['强据'] || 0) + ' 句（>20，证据源没取错）');
  T(Object.keys(lv).length >= 2, '  判定不是一边倒：' + JSON.stringify(lv));

  console.log(out.join('\n'));
  console.log('\n  自测结果：' + pass + '/' + total + ' 通过');
  return pass === total ? 0 : 1;
}

/* ---------------- 主流程 ---------------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) process.exit(selftest());

  const rows = parseDoc();
  const ev = buildEvidence();
  const aud = rows.map(r => audit(r, ev));

  const onlyBad = argv.indexOf('--bad') >= 0;
  const i = argv.indexOf('--sect');
  const sectFilter = i >= 0 ? argv[i + 1] : null;

  const order = { '无据': 0, '弱据': 1, '未覆盖': 2, '强据': 3, '骨架自带': 4, '跳过': 5 };
  const list = aud
    .filter(a => !onlyBad || order[a.level] <= 2)
    .filter(a => !sectFilter || a.row.sectId === sectFilter)
    .sort((a, b) => (order[a.level] - order[b.level]) || (a.row.sec < b.row.sec ? -1 : 1));

  const lv = {};
  aud.forEach(a => { lv[a.level] = (lv[a.level] || 0) + 1; });
  console.log('design/77 §3 共 ' + rows.length + ' 行 · 判定分布：'
    + Object.keys(order).map(k => k + ' ' + (lv[k] || 0)).join(' · '));
  console.log('证据源：72_sects_tier 的 story/desc/trial · 门派武学名（10_skills）· 73_sects_place 该门派房间与 NPC 文本\n');

  console.log('| 判定 | § | id | 门派 | 句 | 强据名词 | 弱据名词 | 无据名词 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const a of list) {
    console.log('| ' + a.level + ' | ' + a.row.sec + ' | `' + a.row.roomId + '` | ' + a.row.sectCN
      + ' | ' + String(a.row.sent || '—').slice(0, 30) + ' | '
      + (a.strong || []).join('/') + ' | ' + (a.weak || []).join('/') + ' | ' + (a.none || []).join('/') + ' |');
  }
  console.log('\n合计 ' + list.length + ' 行');

  const bad = aud.filter(a => a.level === '无据' || a.level === '弱据');
  if (bad.length) {
    console.log('\n=== 给游有方：下面这些句里的实物，本门派自己查不到 ===');
    for (const a of bad) {
      console.log('  [' + a.level + '] ' + a.row.roomId + '（' + a.row.sectCN + '）「' + a.row.sent + '」');
      console.log('       弱据：' + ((a.weak || []).join('/') || '—') + '   无据：' + ((a.none || []).join('/') || '—'));
    }
  }
  process.exit(0);
}

if (require.main === module) main();
module.exports = { parseDoc, buildEvidence, audit };
