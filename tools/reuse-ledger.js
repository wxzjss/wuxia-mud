#!/usr/bin/env node
/* ============================================================
 * reuse-ledger.js —— 全库玩家可见文本「重复度台账」
 *
 * 用途：design/72 §C.2 T1 唯一性门槛（同一句 ≥8 字，全库最多出现 2 次）
 *       的**排期依据**。既有 ai-flavor-check.js 把复用清单标成
 *       「不判红，当待办看」，而且只查 desc/name/text/answer/talk ——
 *       房间描述、物品描述、任务文本、画像字段**完全没进过秤**。
 *
 * 做法：**直接读磁盘上的 NN_*.json**（不读引擎合并态），
 *       这样每一条重复都能报出「在哪几个文件、哪几个 id 上」，
 *       拿去重做排期时才知道该改哪个文件。
 *
 * ⚠️ 只读 game/data，不写 game/ 下任何文件。
 *
 * 用法：
 *   node tools/reuse-ledger.js                 打 Top 40
 *   node tools/reuse-ledger.js --top 100       打 Top 100
 *   node tools/reuse-ledger.js --full          打全部
 *   node tools/reuse-ledger.js --out a.tsv     全量导出 TSV（供排期）
 *   node tools/reuse-ledger.js --selftest      自测
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');

const MIN_LEN = 8;    // 句子最少字数（汉字数）
const MIN_N = 3;      // 出现 > 2 次才入账

/**
 * 认定为「玩家可见文本」的键 —— 按**路径上任一环节**命中即算，
 * 不能只看叶子键名：实测 149 次那条病灶挂在 `npcs.*.portrait.arc.warm`，
 * 叶子键是 warm，按叶子名白名单会整条漏掉。
 */
const TEXT_KEYS = new Set([
  'desc', 'talk', 'answer', 'askDefault', 'text', 'raw', 'say', 'narrate',
  'title', 'role', 'now', 'want', 'fear', 'catchphrase', 'act', 'arc',
  'intro', 'failMsg', 'msg', 'line', 'what', 'why', 'story', 'note',
  'opening', 'ending', 'brief', 'hint', 'greeting', 'reply',
  'portrait', 'voice', 'routine', 'marks', 'name', 'habit', 'quirk',
]);
/** 一律不收的键（搜索词/命令/数值/元数据） */
const SKIP_KEYS = new Set([
  'keywords', 'cmd', 'id', 'key', 'var', 'source', '__source',
  '_note', '_mod', 'meta', 'cond', 'args', 'kind', 'slot', 'exits',
  'stats', 'attr', 'learned', 'equipment', 'skills', 'teach', 'loot',
  'respawn', 'schedule', 'rel', 'neighbors', 'unlock', 'carry', 'tags',
]);

const QUOTE_RE = /[「」『』“”‘’《》〈〉（）()\[\]【】]/g;

/** 切句：只按句末标点切，**不按逗号切**（否则「偶尔会多说两句，说完自己也觉得多余。」会被劈成两半，149 次那条就抓不到） */
function toSentences(s) {
  const cleaned = String(s).replace(QUOTE_RE, '').replace(/\s+/g, '');
  /* 句末标点**保留**（台账要能整句抄去重做排期，丢掉句号不好用） */
  const parts = cleaned.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
  return parts.map(x => x.trim()).filter(Boolean);
}
function cjkLen(s) { const m = s.match(/[\u4e00-\u9fa5]/g); return m ? m.length : 0; }

/** 默认收集器：可见字符串 → 切句 → 够长才入账 */
function emitSentences(str, fieldPath, segs, file, coll, id, out) {
  for (const s of toSentences(str)) {
    if (cjkLen(s) < MIN_LEN) continue;
    out.push({ sent: s, file, coll, id, field: fieldPath });
  }
}

/** 收集一个文件里所有玩家可见句子 → [{sent, file, coll, id, field}] */
function collectFile(file, emit) {
  const out = [];
  const em = emit || emitSentences;
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return out; }
  for (const coll of Object.keys(json)) {
    const root = json[coll];
    if (!root || typeof root !== 'object') continue;
    const entries = Array.isArray(root)
      ? root.map((v, i) => [String((v && v.id) || i), v])
      : Object.keys(root).map(k => [k, root[k]]);
    for (const [id, ent] of entries) {
      if (!ent || typeof ent !== 'object') continue;
      walk(ent, coll + '.' + id, out, file, coll, id, em);
    }
  }
  return out;
}

function walk(node, fieldPath, out, file, coll, id, emit) {
  const em = emit || emitSentences;
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, fieldPath + '[' + i + ']', out, file, coll, id, em));
    return;
  }
  if (typeof node === 'string') {
    const segs = fieldPath.replace(/\[\d+\]/g, '').split('.');
    if (!segs.some(s => TEXT_KEYS.has(s))) return;
    em(node, fieldPath, segs, file, coll, id, out);
    return;
  }
  if (typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    if (k.charAt(0) === '_' || SKIP_KEYS.has(k)) continue;
    walk(node[k], fieldPath + '.' + k, out, file, coll, id, em);
  }
}

/* ---------- 中英混排扫描 ----------
 * 判定口径：**同一串里既有汉字、又有 ≥2 个连续拉丁字母**。
 * 这样 `portrait.routine[0].at = "night"`（排班枚举）、`secret.leakTo = ["nv_yue"]`
 * （内部 id 引用）这类**不含汉字**的字段自动出局，不用靠黑名单猜字段。
 * 纯拉丁（无汉字）的处数单列一行报出，供人工确认确实是引用/枚举而不是漏网文案。
 */
const LATIN_RE = /[A-Za-z]{2,}/g;
const CJK_RE = /[\u4e00-\u9fa5]/;

function emitLatin(str, fieldPath, segs, file, coll, id, out) {
  const words = str.match(LATIN_RE);
  if (!words) return;
  out.push({
    file, coll, id, field: fieldPath, text: str,
    words: [...new Set(words)],
    mixed: CJK_RE.test(str),
  });
}

/* ---------- 混排命中「到底渲不渲染给玩家」的判定表 ----------
 * 光看「串里有拉丁」不能定罪：库里大量拉丁串是**作者给作者看的批注**或
 * **mod DSL 脚本**。逐类到源码里找读取点，找不到的按不渲染处理并写出依据。
 * 依据栏写的是实测时的 file:line，改代码后要回来对一遍。
 */
const LEAF_VERDICT = {
  name:       ['可见', 'NPC/实体名，渲染到处都是（look / 状态栏 / 战斗）'],
  desc:       ['可见', 'queststage.js:46 `stage.desc || \'\'` 直接进任务文本'],
  rewardHint: ['可见', 'commands.js:3722 `（${hk.rewardHint}）` 询问钩子时整条打出'],
  raw:        ['可见部分', 'modapi.js:632 menu 格式「标题|选项A>效果;;选项B>效果」：`>` 左是可见标签，右是执行用 DSL'],
  ifLeaked:   ['不可见', '全仓仅 tools/gen-portraits.js:202 校验「它是字符串」，源码无渲染点'],
  arc:        ['不可见', 'engine.js:1645 只取 `pt.arc.init`（对象式）；数据是字符串 ⇒ 落空，且 arcInit 全仓无读取'],
  note:       ['不可见', '作者批注（treasury.house.note 等）'],
};

/** raw 类：把可见部分（标题 + 各选项标签）挑出来单独判，避免 DSL 里的拉丁误伤 */
function rawVisiblePart(s) {
  const parts = String(s).split('|');
  const vis = [parts[0] || ''];
  (parts[1] || '').split(';;').forEach(o => {
    const m = o.match(/^([^>]+)>/);
    if (m) vis.push(m[1]);
  });
  return vis;
}

/** 判定一条混排命中是否真的会被玩家看见 */
function isVisible(h) {
  const leaf = h.field.split('.').pop().replace(/\[\d+\]$/, '');
  const v = LEAF_VERDICT[leaf];
  if (!v) return { visible: true, why: '未分类叶子键，按可见处理（宁可多报）' };
  if (v[0] === '不可见') return { visible: false, why: v[1] };
  if (v[0] === '可见部分') {
    /* 只判 `>` 左侧：右侧是给机器执行的 */
    const bad = rawVisiblePart(h.text).filter(x => LATIN_RE.test(x));
    return { visible: bad.length > 0, why: v[1] + (bad.length ? '；本条可见部分带拉丁：' + JSON.stringify(bad) : '；本条拉丁全在 DSL 侧') };
  }
  return { visible: true, why: v[1] };
}

function buildLatin() {
  const files = dataFiles();
  const mixed = [], pureLatin = [];
  for (const f of files) {
    for (const rec of collectFile(f, emitLatin)) (rec.mixed ? mixed : pureLatin).push(rec);
  }
  for (const h of mixed) { const d = isVisible(h); h.visible = d.visible; h.why = d.why; }
  return { files, mixed, pureLatin };
}

function dataFiles() {
  return fs.readdirSync(DATA)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && /^\d+_/.test(f))
    .sort();
}

function build() {
  const files = dataFiles();
  const map = new Map();
  let totalSent = 0;
  const collSet = new Set(), perColl = {};
  for (const f of files) {
    for (const rec of collectFile(f)) {
      totalSent++;
      collSet.add(rec.coll);
      perColl[rec.coll] = (perColl[rec.coll] || 0) + 1;
      let e = map.get(rec.sent);
      if (!e) { e = { sent: rec.sent, n: 0, files: new Set(), ids: new Set(), colls: new Set(), sample: [] }; map.set(rec.sent, e); }
      e.n++;
      e.files.add(rec.file);
      e.colls.add(rec.coll);
      if (e.ids.size < 40) e.ids.add(rec.id);
      if (e.sample.length < 3) e.sample.push(rec.file + ' ' + rec.coll + '.' + rec.id + ' · ' + rec.field);
    }
  }
  const dup = [...map.values()].filter(e => e.n > MIN_N - 1).sort((a, b) => b.n - a.n);
  return { files, totalSent, map, dup, collSet, perColl };
}

function selftest() {
  const { dup, map, totalSent, perColl } = build();
  const out = []; let pass = 0, total = 0;
  const T = (c, m) => { total++; out.push((c ? '  ✔ ' : '  ✘ ') + m); if (c) pass++; };

  const target = '偶尔会多说两句，说完自己也觉得多余。';
  const hit = dup.find(e => e.sent === target);
  T(!!hit, '抓到已知病灶「' + target + '」');
  T(!!hit && hit.n >= 149, '  其出现次数 = ' + (hit ? hit.n : 0) + '（磁盘原始 grep 实测 149，要求 ≥149）');
  T(!!hit && hit.files.has('99_city_npcs.json') && hit.files.has('97_portraits_bc.json'),
    '  其归属文件报全（99_city_npcs.json / 97_portraits_bc.json）');
  T(totalSent > 12000, '扫描到的句子总数 ' + totalSent + '（>1.2 万）');
  T((perColl.rooms || 0) > 500, '房间描述进秤：' + (perColl.rooms || 0) + ' 句');
  T((perColl.items || 0) > 100, '物品描述进秤：' + (perColl.items || 0) + ' 句');
  T((perColl.quests || 0) > 500, '任务文本进秤：' + (perColl.quests || 0) + ' 句');
  T((perColl.npcs || 0) > 5000, 'NPC 文本进秤：' + (perColl.npcs || 0) + ' 句');
  /* 干净样本：一句库里没有的长句，不应出现在台账里 */
  T(!map.has('这句是严过关为了自测量具临时编的一句谁也没有说过的话'), '干净样本：库外长句不入账');
  /* 逗号不被切开 —— 若被切开，149 那条会变成两个短句，且第一条字数不足 8 */
  T(!!hit && hit.n === map.get(target).n, '切句未把逗号处劈开（否则这条抓不到完整形态）');

  /* ---- 中英混排扫描器自验：先造已知答案样本，再看它判得对不对 ---- */
  const probe = [];
  emitLatin(' someday 会挑明自己当年为什么上山', 'npcs.x.portrait.arc', [], 'f', 'npcs', 'x', probe);
  emitLatin('夜里换岗，stone 记着', 'npcs.x.talk[0]', [], 'f', 'npcs', 'x', probe);
  emitLatin('night', 'npcs.x.portrait.routine[0].at', [], 'f', 'npcs', 'x', probe);
  emitLatin('nv_yue', 'npcs.x.portrait.secret.leakTo[0]', [], 'f', 'npcs', 'x', probe);
  emitLatin('他把刀横在门前，没说话。', 'npcs.x.talk[1]', [], 'f', 'npcs', 'x', probe);
  T(probe.length === 4, '混排扫描器：5 个样本里 4 个含拉丁串，2 纯中文出局（实得 ' + probe.length + '）');
  T(probe[0] && probe[0].mixed === true, '  命中·中英混排： someday 会挑明 → mixed=true');
  T(probe[1] && probe[1].mixed === true, '  命中·中英混排：夜里换岗，stone 记着 → mixed=true');
  T(probe[2] && probe[2].mixed === false, '  不命中·纯枚举：night（排班枚举）→ mixed=false，不计入');
  T(probe[3] && probe[3].mixed === false, '  不命中·纯引用：nv_yue（内部 id）→ mixed=false，不计入');
  const real = buildLatin();
  T(real.mixed.some(r => r.id === 'sectguard_taohua' && r.words.indexOf('someday') >= 0),
    '  真实命中回抽：sectguard_taohua 的 someday 在库里仍被抓到');
  T(real.mixed.length > 0, '  全库真实混排命中 ' + real.mixed.length + ' 处（>0，量具不是空转）');

  /* ---- 「渲不渲染」判定器自验：造 5 个已知答案样本，命中/不命中都要有 ---- */
  const V = (field, text) => isVisible({ field, text });
  T(V('npcs.x.name', 'taishan弟子').visible === true, '  可见·NPC 名：taishan弟子 → 判可见');
  T(V('quests.q.stages[0].desc', 'taishan_hall：挑满水缸').visible === true, '  可见·任务文本：taishan_hall：… → 判可见');
  T(V('npcs.x.portrait.hooks[0].rewardHint', '+rep * 15；trust +25').visible === true, '  可见·奖励提示：+rep * 15 → 判可见');
  T(V('quests.q.stages[1].effects[2].raw',
      '那批箭|往下查，看是谁经的手>flag:sq_x_cha;+exp:380').visible === false,
    '  不命中·DSL：拉丁全在 `>` 右侧 → 判不可见');
  T(V('quests.q.stages[1].effects[2].raw',
      '那批箭|往下查 the arrows>flag:sq_x_cha;+exp:380').visible === true,
    '  命中·DSL 可见侧：选项标签里混了 the → 判可见（不能漏）');
  T(V('npcs.x.portrait.secret.ifLeaked', '熊时 mood −40').visible === false, '  不命中·作者批注：ifLeaked → 判不可见');
  T(V('npcs.x.portrait.arc', ' someday 会挑明').visible === false, '  不命中·死字段：arc 字符串 → 判不可见');
  /* ⚠️ 这条断言**跟着目标走**：P0-2b 改完之后，可见类应当真的清零。
     原先写的是「两类都非空（防分类一边倒）」，那是改之前的哨兵；
     现在它过期了 —— 要防的是**量具瞎了**，不是两类都非空。
     ⇒ 改成：可见类 = 0（目标达成），且不可见类 > 0（量具还在转，不是空跑）。 */
  const visN = real.mixed.filter(h => h.visible).length;
  const hidN = real.mixed.filter(h => !h.visible).length;
  T(visN === 0, '  真实数据里「玩家可见的混排」= ' + visN + '（P0-2b 目标：清零）');
  T(hidN > 0, '  （防量具瞎掉）不可见类仍有 ' + hidN + ' 处，说明扫描器还在正常出数');
  console.log('  重复度台账 · 自测');
  console.log(out.join('\n'));
  console.log('\n  自测结果：' + pass + '/' + total + ' 通过');
  return pass === total ? 0 : 1;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) process.exit(selftest());

  if (argv.indexOf('--latin') >= 0) {
    let { files, mixed, pureLatin } = buildLatin();
    console.log('中英混排扫描（口径：同一串里既有汉字、又有 ≥2 个连续拉丁字母）');
    console.log('扫描 ' + files.length + ' 个数据文件\n');
    console.log('判定表（叶子键 → 是否玩家可见 → 依据，依据里的 file:line 是实测查到的读取点）：');
    Object.entries(LEAF_VERDICT).forEach(([k, v]) => {
      const n = mixed.filter(h => h.field.split('.').pop().replace(/\[\d+\]$/, '') === k).length;
      console.log('  ' + k.padEnd(11) + String(n).padStart(4) + ' 处  ' + v[0] + '  ' + v[1]);
    });
    console.log('');

    const shown = mixed.filter(h => h.visible);
    const hidden = mixed.filter(h => !h.visible);
    const byLeafMixed = {};
    shown.forEach(h => {
      const leaf = h.field.split('.').pop().replace(/\[\d+\]$/, '');
      (byLeafMixed[leaf] = byLeafMixed[leaf] || []).push(h);
    });
    console.log('【玩家可见的混排】' + shown.length + ' 处 —— 按叶子键归类：');
    Object.entries(byLeafMixed).sort((a, b) => b[1].length - a[1].length)
      .forEach(([k, v]) => console.log('  ' + String(v.length).padStart(4) + '  …' + k + '   例：' + v[0].text.slice(0, 46)));
    console.log('\n【不渲染给玩家的】' + hidden.length + ' 处（作者批注 / DSL，不计缺陷）：');
    const byLeafHidden = {};
    hidden.forEach(h => {
      const leaf = h.field.split('.').pop().replace(/\[\d+\]$/, '');
      byLeafHidden[leaf] = (byLeafHidden[leaf] || 0) + 1;
    });
    Object.entries(byLeafHidden).sort((a, b) => b[1] - a[1])
      .forEach(([k, v]) => console.log('  ' + String(v).padStart(4) + '  …' + k + '   ' + (LEAF_VERDICT[k] || ['', ''])[1]));
    console.log('');
    mixed = shown; // 下面只打可见的
    const show = argv.indexOf('--all') >= 0 ? Infinity : 60;
    mixed.slice(0, show).forEach(h => {
      console.log('  ' + h.file + ' · ' + h.coll + '.' + h.id + ' · ' + h.field);
      console.log('      [' + h.words.join(', ') + ']  ' + h.text);
    });
    if (mixed.length > show) console.log('  … 另有 ' + (mixed.length - show) + ' 处（--all 全打）');
    /* 纯拉丁分叶子键汇总：证明被排除的确实是枚举/引用字段，而不是漏网文案 */
    const byLeaf = {};
    pureLatin.forEach(h => {
      const leaf = h.field.split('.').pop().replace(/\[\d+\]$/, '');
      byLeaf[leaf] = (byLeaf[leaf] || 0) + 1;
    });
    const leafRows = Object.entries(byLeaf).sort((a, b) => b[1] - a[1]);
    console.log('\n【纯拉丁·无汉字】' + pureLatin.length + ' 处 —— 按叶子键归类，逐类确认是否真为非文案字段：');
    leafRows.forEach(([k, v]) => console.log('  ' + String(v).padStart(5) + '  …' + k));
    console.log('\n合计：真·混排 ' + mixed.length + ' 处；纯拉丁（不判）' + pureLatin.length + ' 处');
    return;
  }

  const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const topN = argv.indexOf('--full') >= 0 ? Infinity : (parseInt(getArg('--top', '40'), 10) || 40);
  const outFile = getArg('--out', null);

  const { files, totalSent, map, dup, perColl } = build();
  console.log('扫描 ' + files.length + ' 个数据文件 · 玩家可见句子 ' + totalSent + ' 条 · 不同句子 ' + map.size + ' 条');
  console.log('分集合句数：' + Object.entries(perColl).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' '+v).join(' · '));
  console.log('≥' + MIN_LEN + ' 字且出现 >' + (MIN_N - 1) + ' 次的句子：' + dup.length + ' 条\n');

  const rows = [];
  rows.push(['次数', '句子', '所在文件', '集合', '涉及 id（最多 40）']);
  let i = 0;
  for (const e of dup) {
    i++;
    if (i > topN) break;
    const ids = [...e.ids].join(',');
    console.log(String(i).padStart(3) + '. ×' + String(e.n).padStart(3) + '  ' + e.sent.slice(0, 60));
    console.log('     文件：' + [...e.files].join(' / '));
    console.log('     ids(' + e.ids.size + (e.n > e.ids.size ? '，共 ' + e.n + ' 处' : '') + ')：' + ids.slice(0, 220));
    rows.push([e.n, e.sent, [...e.files].join('|'), [...e.colls].join('|'), ids]);
  }
  console.log('\n合计 ' + dup.length + ' 条重复句（本次打印 ' + Math.min(i, topN) + ' 条）');
  const wasted = dup.reduce((a, b) => a + (b.n - 1), 0);
  console.log('冗余副本 ' + wasted + ' 处（= 把这些句子各保留 1 处后，可省下的重复出现数）');

  if (outFile) {
    const tsv = rows.map(r => r.map(x => String(x).replace(/\t/g, ' ')).join('\t')).join('\n');
    fs.writeFileSync(path.resolve(ROOT, outFile), tsv, 'utf8');
    console.log('\n已导出全量台账 → ' + outFile);
  }
}

main();
