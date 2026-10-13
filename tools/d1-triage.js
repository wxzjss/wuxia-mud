#!/usr/bin/env node
/* ============================================================
 * d1-triage.js —— D-1「通用台词池」病灶分诊表
 *
 * 缘起：43_sect_disciples.json 里 165 个弟子共用 80 句台词，最重一句 ×40。
 *       团队长要一份「按 复用次数 × 涉及人数 排序」的清单给游有方直接照着改，
 *       并点名：**这份清单要能区分「该改」和「不该改」**。
 *
 * 判据（我定的，报给团队长备案）：
 *   **一句话的信息，归属于「场合」还是归属于「人」。**
 *   - 归属场合/身份（不该改）：礼节宗教套语、门派规训、行当规矩 ——
 *     任何人站在这个位置、顶着这个身份都能说，共用是**设定**不是病灶。
 *     例：「阿弥陀佛。」「寺里不许饮酒。」「秤准，价钱好商量。」
 *   - 归属人（该改）：带上具体他人、具体时间、具体数量、第一人称经历、
 *     对具体对象的私下评价、或「此刻才成立」的现场观察 ——
 *     这句就成了**只有那一个人能说**的话，165 人同时说即穿帮。
 *     例：「师兄抄书去了？茶还温着。」（具体他人 + 此刻茶还温着）
 *   - 判据上没问题、但共用规模过大（≥8 人）→ 判「可改·过量」：
 *     不是穿帮，是**撞见多了会腻**，建议拆 2–3 个变体按人分配。
 *   - 同一个人自己的台词里重复出现同一句 → 一律「该改」（那是纯数据 bug）。
 *
 * ⚠️ 只读 game/data，一个字节都不写。
 * ⚠️ 文件名刻意不叫 *-check.js：这是**排期工具**不是门禁，
 *    它产出的是待办清单，永远退出 0，别让它污染回归（回归只认退出码）。
 *
 * 用法：
 *   node tools/d1-triage.js                 默认：NPC 可见文本，Top 40
 *   node tools/d1-triage.js --top 100
 *   node tools/d1-triage.js --file 43_sect_disciples.json
 *   node tools/d1-triage.js --min 5         只看复用 ≥5 次
 *   node tools/d1-triage.js --all-coll      全部集合（含 rooms/quests/items）
 *   node tools/d1-triage.js --out a.tsv     导出全量 TSV
 *   node tools/d1-triage.js --selftest      自测（判据自己先验一遍）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');

const MIN_LEN = 8;      // 与 reuse-ledger 同口径
const MIN_N = 3;        // 出现 >2 次才入账（T1 门槛）
const OVERUSE_PEOPLE = 8; // 「合理但过量」的人数阈值

/* ---------------- 判据表（顺序判定，首命中胜出） ---------------- */

/** R0 礼节 / 宗教套语 —— 归属于「场合」 */
const RITES = /(阿弥陀佛|善哉|无量天尊|福生无量|南无|施主|檀越|贫僧|贫道|老衲|小道|多谢|谢过|不敢当|得罪|告辞|失陪|有劳|得罪了)/;

/** R0b 见礼套语 —— 「外门弟子见过师兄。」这类，归属场合（人再多也合理） */
const SALUTE = /见过(师兄|师弟|师姐|师妹|师叔|师伯|师父|掌门|长老|前辈|住持|观主)/;

/** R1 门派规训 / 行当规矩 —— 归属于「身份」（泛指权威：师父/祖师/本门） */
const TRAINING = /(不许|不得|不可|门规|戒律|清规|本门|本派|本寺|本观|本帮|祖师|师父说过|师父教|师父训|师父让|掌门有令|寺里|观里|山门|戒|功课|早晚课|值夜|轮值)/;

/** R1b 身份标签句式 ——「看夜门的，夜里最精神」「跑外路的，一趟三个月不着家」：
 *  句首是一个身份标签（…的，），后面是这个身份的**常态**。归属身份不是归属人。
 *  ⚠️ 不加这条会把「看夜门的，夜里最精神」判成该改（因为含「夜里」），
 *     那就是把角色模板句当成穿帮句，误导写手白改。 */
const ROLE = /^[^，。]{2,12}的，/;

/** R2 私人语特征 —— 命中任一即「归属人」 */
const FEAT = [
  ['他指·具体', /(师兄|师弟|师姐|师妹|师叔|师伯|大师兄|二师兄|三师兄|掌柜|东家|当家|老丈|那位|这个人|那个人|同乡)/],
  ['时间·具体', /(今儿|今儿个|昨儿|昨夜|昨天|前日|前天|上月|上个月|去年|那年|那一年|三年前|两年前|五年前|这月|这阵子|方才|刚才|早上|晌午|傍晚|夜里|日前|当日|前些日子|这些日子|那年)/],
  ['数量·具体', /[三四五六七八九十两百千万][次遍年月日天条个碗斤里岁]/],
  ['自称·经历', /我(见过|去过|来过|吃过|欠|答应|许过|记得|入门|来时|走时|那年|当年|头一回|第一次|小时候|原来|从前)/],
  ['私下·评价', /(其实|心里|私下|偷偷|暗地|说句实话|不瞒|老实说|说白了)/],
  ['此刻·观察', /(还温着|还热着|还亮着|还开着|没回来|刚走|刚来|这会儿|这半天|没回来过)/],
];

/** 泛指权威（只在这些词上指人 = 规训，不算「具体他人」） */
const AUTHORITY = /(师父|祖师|掌门|长老|住持|观主|掌柜的规矩)/;

const VERDICT_ORDER = { '该改': 0, '可改·过量': 1, '不该改': 2 };

/** 分诊：一句话该不该改。people = 涉及人数 */
function classify(sent, people) {
  const over = people >= OVERUSE_PEOPLE;
  const hits0 = FEAT.filter(([, re]) => re.test(sent)).map(([n]) => n);
  /* 「自称经历 / 私下评价」是**强**私人信号：连身份标签句也压不住 */
  const strong = hits0.some(h => h === '自称·经历' || h === '私下·评价' || h === '此刻·观察');

  /* R0 礼节 / 见礼 —— 归属场合：**人再多也合理**（「阿弥陀佛」佛门人人可说） */
  if (RITES.test(sent)) return { v: '不该改', why: 'R0 礼节/宗教套语 —— 归属场合，' + people + ' 人共用也合理' };
  if (SALUTE.test(sent)) return { v: '不该改', why: 'R0b 见礼套语 —— 归属场合' };
  /* R1 门派规训 / 行当规矩 —— 归属身份；但夹进私人信息就不再算规训（判据8） */
  if (TRAINING.test(sent) && hits0.length === 0) {
    return { v: '不该改', why: 'R1 门派规训/行当规矩 —— 归属身份' };
  }
  /* R1b 身份标签句式（「看夜门的，夜里最精神」）—— 归属身份，非强私人信号不翻案 */
  if (ROLE.test(sent) && !strong) {
    return { v: over ? '可改·过量' : '不该改',
      why: 'R1b 身份标签句式 —— 归属身份' + (over ? '，但 ' + people + ' 人共用已腻' : '') };
  }
  /* R2 归属人 —— 有私人信息，复用即穿帮 */
  if (hits0.length) return { v: '该改', why: 'R2 归属人 —— ' + hits0.join('+') };
  /* R3/R4 无私人信息：只看规模 */
  if (over) return { v: '可改·过量', why: 'R3 无私人信息但 ' + people + ' 人共用 —— 撞见多了会腻' };
  return { v: '不该改', why: 'R4 通用语，规模 ' + people + ' 人在阈值内' };
}

/* ---------------- 采集（与 reuse-ledger 同口径） ---------------- */

const QUOTE_RE = /[「」『』“”‘’《》〈〉（）()\[\]【】]/g;
function toSentences(s) {
  const cleaned = String(s).replace(QUOTE_RE, '').replace(/\s+/g, '');
  const parts = cleaned.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [];
  return parts.map(x => x.trim()).filter(Boolean);
}
function cjkLen(s) { const m = s.match(/[\u4e00-\u9fa5]/g); return m ? m.length : 0; }

/** 玩家可见的嘴边话与外貌（默认口径）；note/raw/ifLeaked/arc 一律不收 */
const VIS_KEYS = new Set([
  'talk', 'say', 'answer', 'askDefault', 'greeting', 'reply', 'line',
  'catchphrase', 'what', 'why', 'opening', 'brief', 'hint',
  'desc', 'intro', 'now', 'want', 'fear', 'role', 'story', 'habit', 'quirk',
]);
const SKIP_KEYS = new Set([
  'keywords', 'cmd', 'id', 'key', 'var', 'source', '__source', '_note', '_mod',
  'meta', 'cond', 'args', 'kind', 'slot', 'exits', 'stats', 'attr', 'learned',
  'equipment', 'skills', 'teach', 'loot', 'respawn', 'schedule', 'rel',
  'neighbors', 'unlock', 'carry', 'tags', 'note', 'raw', 'ifLeaked', 'arc',
  'rewardHint',
]);

function walk(node, fieldPath, out, file, coll, id) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, fieldPath + '[' + i + ']', out, file, coll, id));
    return;
  }
  if (typeof node === 'string') {
    const segs = fieldPath.replace(/\[\d+\]/g, '').split('.');
    if (!segs.some(s => VIS_KEYS.has(s))) return;
    if (segs.some(s => SKIP_KEYS.has(s))) return;

    /* ⚠️ 口径：**先看整条台词，再看子句**。
       只用子句口径会漏掉最重的病灶 —— 实测「师兄抄书去了？茶还温着。」
       （43_sect_disciples 里 ×40）被问号劈成「师兄抄书去了？」（6 字）与
       「茶还温着。」（4 字），两半都不足 8 字 ⇒ 整条从台账里消失。
       游有方改的是**整条台词**，所以整条必须先单独入账一次。 */
    const whole = String(node).replace(QUOTE_RE, '').replace(/\s+/g, '');
    const seen = new Set();
    if (cjkLen(whole) >= MIN_LEN) { seen.add(whole); out.push({ sent: whole, file, coll, id, field: fieldPath }); }
    for (const s of toSentences(node)) {
      if (cjkLen(s) < MIN_LEN || seen.has(s)) continue;
      seen.add(s);
      out.push({ sent: s, file, coll, id, field: fieldPath });
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const k of Object.keys(node)) {
    if (k.charAt(0) === '_' || SKIP_KEYS.has(k)) continue;
    walk(node[k], fieldPath + '.' + k, out, file, coll, id);
  }
}

function dataFiles(only) {
  return fs.readdirSync(DATA)
    .filter(f => f.endsWith('.json') && !f.startsWith('.') && /^\d+_/.test(f))
    .filter(f => !only || f === only)
    .sort();
}

function collect(file, allColl) {
  const out = [];
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8')); } catch (e) { return out; }
  for (const coll of Object.keys(json)) {
    if (!allColl && coll !== 'npcs') continue;
    const root = json[coll];
    if (!root || typeof root !== 'object') continue;
    const entries = Array.isArray(root)
      ? root.map((v, i) => [String((v && v.id) || i), v])
      : Object.keys(root).map(k => [k, root[k]]);
    for (const [id, ent] of entries) {
      if (!ent || typeof ent !== 'object') continue;
      walk(ent, coll + '.' + id, out, file, coll, id);
    }
  }
  return out;
}

function build(opt) {
  const opt2 = opt || {};
  const files = dataFiles(opt2.file);
  const map = new Map();
  let totalSent = 0;
  for (const f of files) {
    for (const rec of collect(f, opt2.allColl)) {
      totalSent++;
      let e = map.get(rec.sent);
      if (!e) {
        e = { sent: rec.sent, n: 0, files: new Set(), ids: new Set(), idHits: new Map(), sample: [] };
        map.set(rec.sent, e);
      }
      e.n++;
      e.files.add(rec.file);
      e.ids.add(rec.id);
      e.idHits.set(rec.id, (e.idHits.get(rec.id) || 0) + 1);
      if (e.sample.length < 3) e.sample.push(rec.file + ' ' + rec.field);
    }
  }
  const minN = opt2.min || MIN_N;
  const rows = [...map.values()]
    .filter(e => e.n >= minN)
    .map(e => {
      const people = e.ids.size;
      const selfDup = [...e.idHits.values()].some(c => c > 1);
      const c = classify(e.sent, people);
      return {
        sent: e.sent, n: e.n, people, files: [...e.files], ids: [...e.ids],
        sample: e.sample, selfDup,
        verdict: selfDup ? '该改' : c.v,
        why: selfDup ? '同一人自己的文本里重复出现 —— 纯数据 bug' : c.why,
        score: e.n * people,
      };
    })
    .sort((a, b) => b.score - a.score || b.n - a.n);
  return { files, totalSent, map, rows };
}

/* ---------------- 自测 ---------------- */

function selftest() {
  const out = [];
  let pass = 0, total = 0;
  const T = (c, m) => { total++; out.push((c ? '  ✔ ' : '  ✘ ') + m); if (c) pass++; };

  console.log('  D-1 分诊判据 · 自测');

  /* ① 判据本身：造**已知答案**的样本，命中/不命中都要有 */
  T(classify('阿弥陀佛，施主请自便。', 20).v === '不该改',
    '判据1 不该改·礼节：「阿弥陀佛，施主请自便。」20 人共用 → 不该改（佛门人人可说）');
  T(classify('寺里不许饮酒，违者逐出山门。', 20).v === '不该改',
    '判据2 不该改·规训：「寺里不许饮酒…」→ 不该改（本门人人可说）');
  T(classify('师兄抄书去了？茶还温着。', 40).v === '该改',
    '判据3 该改·归属人：「师兄抄书去了？茶还温着。」40 人说 → 该改（具体他人 + 此刻观察）');
  T(classify('我这月第三次替他值夜。', 10).v === '该改',
    '判据4 该改·归属人：「我这月第三次替他值夜。」→ 该改（具体数量 + 自称经历）');
  T(classify('扁担压得肩头疼。', 2).v === '不该改',
    '判据5 不该改·阈值内：「扁担压得肩头疼。」2 人 → 不该改');
  T(classify('扁担压得肩头疼。', 9).v === '可改·过量',
    '判据6 阈值真的会翻面：同一句 9 人共用 → 判「可改·过量」（证明第 5 条不是恒真）');
  T(classify('客官是爽快人。', 3).v === '不该改',
    '判据7 不该改·行当套话：「客官是爽快人。」→ 不该改（买卖人人都这么说）');
  /* 见礼套语：首版会把它判成该改（因为含「师兄」），那是误判 —— 钉住 */
  T(classify('外门弟子见过师兄。', 7).v === '不该改',
    '判据7b 不该改·见礼：「外门弟子见过师兄。」7 人 → 不该改（见礼套语，不是家常）');
  /* 身份标签句式：首版会把它判成该改（因为含「夜里」），那是把模板句当穿帮句 */
  T(classify('看夜门的，夜里最精神', 12).v === '可改·过量',
    '判据7c 不该改·模板句：「看夜门的，夜里最精神」12 人 → 可改·过量（归属身份，非穿帮）');
  T(classify('看夜门的，夜里最精神', 3).v === '不该改',
    '判据7d 同一句 3 人 → 不该改（阈值翻面，证明 7c 不是恒真）');
  T(classify('看夜门的，我小时候替人守过三年门', 12).v === '该改',
    '判据7e 模板句压不住强私人信号：夹了「我小时候…」→ 仍判该改');
  T(classify('看夜门的，这会儿茶还温着', 12).v === '该改',
    '判据7f 模板句压不住此刻观察：夹了「这会儿…还温着」→ 仍判该改');
  /* 反向：规训句里一旦夹进私人信息，就不许再拿「规训」当挡箭牌 */
  T(classify('寺里不许饮酒，可我昨儿夜里替师兄瞒了一次。', 20).v === '该改',
    '判据8 规训挡不住私人信息：同一句里夹了「昨儿/师兄」→ 仍判该改');

  /* ② 量具本身没瞎：真实数据里三类都要出得来（防一边倒、防空转） */
  const b = build({ file: '43_sect_disciples.json' });
  T(b.totalSent > 100, '量具 43_sect_disciples.json 扫到 ' + b.totalSent + ' 句（>100，不是空转）');
  T(b.rows.length > 0, '  其中复用 ≥3 次的句子 ' + b.rows.length + ' 条');
  const nFix = b.rows.filter(r => r.verdict === '该改').length;
  const nKeep = b.rows.filter(r => r.verdict === '不该改').length;
  T(nFix > 0, '  真实数据里判「该改」' + nFix + ' 条（>0）');
  T(nKeep > 0, '  真实数据里判「不该改」' + nKeep + ' 条（>0，判据不是一边倒）');
  /* 团队长点名那条必须在榜首附近，否则说明排序或采集口径不对 */
  const named = b.rows.find(r => r.sent.indexOf('师兄抄书去了') >= 0);
  T(!!named, '团队长点名的「师兄抄书去了？茶还温着。」在清单里');
  T(!!named && named.verdict === '该改', '  且被判为该改（判据对得上团队长的直觉）');
  T(!!named && b.rows.indexOf(named) <= 4, '  且排在前 5（实测第 ' + (b.rows.indexOf(named) + 1) + ' 名，排序口径对）');
  /* 排序口径：score = 次数 × 人数，必须单调不增 */
  let mono = true;
  for (let i = 1; i < b.rows.length; i++) if (b.rows[i - 1].score < b.rows[i].score) mono = false;
  T(mono, '排序单调：score = 次数 × 人数，非递增（共 ' + b.rows.length + ' 行）');

  /* ③ 采集侧空跑防护：库外长句不入账 */
  T(!b.map.has('这句是严过关为了自测量具临时编的一句谁也没有说过的话'),
    '采集侧：库外长句不入账（不是把所有句子都算重复）');

  /* ④ 钉住我刚踩到的真洞：**整句被问号劈开后两半都不足 8 字，仍必须入账**。
     这条要是过不了，全库最重的那句（×40）会从清单里消失，
     而清单表面上看一切正常 —— 这就是「没报错但没生效」。 */
  const probe = [];
  walk({ talk: ['「师兄抄书去了？茶还温着。」'] }, 'npcs.x.talk[0]', probe, 'f', 'npcs', 'x');
  T(probe.length === 1 && probe[0].sent === '师兄抄书去了？茶还温着。',
    '采集侧·问号劈开：整条 11 字、两个子句各不足 8 字 → 整条必须入账（实得 '
    + JSON.stringify(probe.map(p => p.sent)) + '）');
  const probe2 = [];
  walk({ talk: ['「甲句一二三四五六七八。」「乙句一二三四五六七八。」'] }, 'npcs.y.talk[0]', probe2, 'f', 'npcs', 'y');
  T(probe2.length === 3,
    '采集侧·长串不漏：整条 + 2 个够长子句 = 3 条记录（实得 ' + probe2.length + '）');

  console.log(out.join('\n'));
  console.log('\n  自测结果：' + pass + '/' + total + ' 通过');
  return pass === total ? 0 : 1;
}

/* ---------------- 主流程 ---------------- */

function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) process.exit(selftest());

  const getArg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const topN = argv.indexOf('--full') >= 0 ? Infinity : (parseInt(getArg('--top', '40'), 10) || 40);
  const outFile = getArg('--out', null);
  const wantVerdict = getArg('--verdict', null);
  const wantFiles = getArg('--files', null);
  const b = build({
    file: getArg('--file', null),
    allColl: argv.indexOf('--all-coll') >= 0,
    min: parseInt(getArg('--min', String(MIN_N)), 10) || MIN_N,
  });
  if (wantVerdict) {
    const before = b.rows.length;
    b.rows = b.rows.filter(r => r.verdict === wantVerdict);
    console.log('（按判定过滤：' + wantVerdict + ' —— ' + before + ' → ' + b.rows.length + ' 条）');
  }
  if (wantFiles) {
    const set = wantFiles.split(',');
    const before = b.rows.length;
    b.rows = b.rows.filter(r => r.files.some(f => set.indexOf(f) >= 0));
    console.log('（按文件过滤：' + wantFiles + ' —— ' + before + ' → ' + b.rows.length + ' 条）');
  }

  console.log('扫描 ' + b.files.length + ' 个数据文件 · 玩家可见句子 ' + b.totalSent + ' 条');
  console.log('入账（≥' + MIN_LEN + ' 字且 ≥' + (b.rows.length ? '' : '') + (getArg('--min', String(MIN_N))) + ' 次）' + b.rows.length + ' 条\n');

  const by = {};
  for (const r of b.rows) by[r.verdict] = (by[r.verdict] || 0) + 1;
  console.log('分诊结果：' + Object.keys(VERDICT_ORDER).map(k => k + ' ' + (by[k] || 0)).join(' · '));
  console.log('判据：归属「场合/身份」= 不该改；归属「人」= 该改；无私人信息但 ≥'
    + OVERUSE_PEOPLE + ' 人共用 = 可改·过量\n');

  const rows = [];
  const show = (verdict, title, n) => {
    const list = b.rows.filter(r => r.verdict === verdict).slice(0, n);
    if (!list.length) return;
    console.log('【' + title + '】' + (by[verdict] || 0) + ' 条 —— 打印前 ' + list.length + ' 条');
    console.log('| # | 句 | ×次 | 人数 | score | 理由 | 文件 |');
    console.log('|---|---|---|---|---|---|---|');
    list.forEach((r, i) => {
      console.log('| ' + (i + 1) + ' | ' + r.sent.slice(0, 34) + ' | ' + r.n + ' | '
        + r.people + ' | ' + r.score + ' | ' + r.why.slice(0, 30) + ' | ' + r.files.join('/') + ' |');
    });
    console.log('');
    list.forEach(r => rows.push([r.verdict, r.n, r.people, r.score, r.sent, r.files.join('|'), r.ids.join(','), r.why]));
  };

  show('该改', '该改·穿帮（归属「人」，复用即穿帮）', topN);
  show('可改·过量', '可改·过量（判据合理但撞见太多）', Math.min(topN, 15));
  show('不该改', '不该改（归属场合/身份，共用是设定）', Math.min(topN, 15));

  if (outFile) {
    const tsv = [['判定', '次数', '人数', 'score', '句子', '文件', '涉及id', '理由'].join('\t')]
      .concat(b.rows.map(r => [r.verdict, r.n, r.people, r.score, r.sent,
        r.files.join('|'), r.ids.join(','), r.why].map(x => String(x).replace(/\t/g, ' ')).join('\t')))
      .join('\n');
    fs.writeFileSync(path.resolve(ROOT, outFile), tsv, 'utf8');
    console.log('已导出全量分诊表 → ' + outFile);
  }
  /* 排期工具：永远退出 0。它产出的是待办，不是正确性门禁。 */
  process.exit(0);
}

if (require.main === module) main();
module.exports = { classify, build, toSentences, cjkLen, FEAT };
