#!/usr/bin/env node
/* ==========================================================================
 * tools/room-batch-plan.js —— 房间重写的**批次切分清单**
 * --------------------------------------------------------------------------
 * 为什么要有它：
 *   下一步是「房间重写 200 间 + 补 300 间密度」。一次性改 200 间的问题是：
 *     ① `exits` 双向且跨文件 —— 出了悬空引用，分不清是**你删了它**还是
 *        **它本来就没建**；分批的话，**批次边界就是归因边界**。
 *     ② id 级 diff 只对「一批」有意义 —— 40 间的 diff 你一眼能看出对不对，
 *        200 间的 diff 没人看得懂，也就失去了「让人判断」的价值。
 *     ③ 回滚成本 —— 分片 replace 语义下，一批改坏回退这一批；200 间混一批
 *        等于全退。
 *   ⇒ **按区域分批，每批 ≤ 40 间**。判据：这批改动会不会动到 id 或 exits？
 *
 * 它干什么：
 *   ① 从 `design/77-room-rewrite-sample.md` 抠三份名单（**文档是源头，不手抄**）：
 *        · §1.2 + §1.3 改名表   → 82 间（id / 现名 / 改名 / 依据 / 是否需配新 desc）
 *        · §3 正文里的改名裁定  → 目前 1 间（§3.5.1 `shaolin_cangjing` → 少林·碑廊）
 *        · §2.2 样张全文        → 20 间（游有方在写全文的）
 *   ② 从 `game/data/`（真引擎加载链）读出全库房间与 region
 *   ③ 按 region 分组，>40 的再切成子批
 *   ④ 写出 `tools/_room_batch_plan.json`，寇豆码照单执行
 *
 * ⚠️ 它是**生成器**：补完 300 间密度后重跑一次就重新切好，别去手改 JSON。
 *
 * ⚠️ 关于「62 间」这个数 —— 文档里有两处 20/62，指的**不是同一件事**，
 *    本工具两个都算、都摆出来，**不替人挑**。见 `_meta.discrepancies`。
 *
 * 用法：
 *   node tools/room-batch-plan.js              # 生成 + 打印摘要
 *   node tools/room-batch-plan.js --max 30     # 改每批上限
 *   node tools/room-batch-plan.js --selftest   # 自检（不写文件）
 * ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const DOC77 = path.join(ROOT, 'design', '77-room-rewrite-sample.md');
const OUT = path.join(__dirname, '_room_batch_plan.json');

const argOf = n => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
};
const MAX = Math.max(1, parseInt(argOf('max'), 10) || 40);

/* ==========================================================================
 * ① 从 design/77 抠名单（文档是源头，不手抄）
 * --------------------------------------------------------------------------
 * ⚠️ 踩过的坑（留着，别再踩）：一开始用「第一列是反引号 id 的表格行」一把捞，
 *    结果把 §3.5.1（少林两间藏经阁）和 §3.5.3（国库/库房）两张**非改名表**也
 *    捞进来了 —— 86 间，多 4 间，报出来「少林改名 12 间」这种看着就不对的数。
 *    现在改成**表头驱动**：只有紧跟 `| id | 现名 | **改名** | 依据 |` 的行才算
 *    改名表，遇到下一个 `#` 标题就收表。
 * ========================================================================== */
function readDoc77(file) {
  const f = file || DOC77;
  if (!fs.existsSync(f)) return { rename: [], rulings: [], sample: [], err: '找不到 ' + f };
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  const rename = [], rulings = [], sample = [];
  let inRenameTable = false;
  let inSample = false;
  let section = '';

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) {
      inRenameTable = false;               /* 标题一来就收表 */
      if (h[1].length === 2) section = h[2].trim();
      /* §2.2 样张全文：这一段里的 `#### A1 · \`id\`` 标题就是样张名单 */
      inSample = /^2\.2/.test(section);
    }

    /* 样张：`#### A1 · \`huashan_path1\`｜华山·五里关` */
    if (inSample) {
      const ms = /^####\s*[A-Za-z]\d+\s*[·・]\s*`([a-z0-9_]+)`/.exec(l);
      if (ms && sample.indexOf(ms[1]) < 0) sample.push(ms[1]);
    }

    /* §3 正文里的改名裁定：`\`shaolin_cangjing\` 改名为「少林·碑廊」`
       —— 这类裁定**不在 §1 表里**，漏掉就等于这间房永远没人改 */
    const mr = /`([a-z0-9_]+)`\s*改名(?:为|成)\s*[「"']([^」"']+)[」"']/.exec(l);
    if (mr) rulings.push({ id: mr[1], to: mr[2], source: '§' + section + ' 正文裁定（不在 §1 改名表里）', line: i + 1 });

    /* 改名表头 —— 只有它才开门 */
    if (/^\|/.test(l) && /\|\s*id\s*\|/.test(l) && /\*\*改名\*\*/.test(l)) { inRenameTable = true; continue; }
    if (!inRenameTable) continue;

    const m = /^\|\s*`([a-z0-9_]+)`\s*\|(.*)$/.exec(l);
    if (!m) continue;
    const cells = m[2].split('|').map(s => s.trim());
    const why = (cells[2] || '').trim();
    rename.push({
      id: m[1],
      from: (cells[0] || '').replace(/\*\*/g, '').trim(),
      to: (cells[1] || '').replace(/\*\*/g, '').trim(),
      needDesc: /需配新\s*desc/.test(why),
      why,
      source: '§1 改名表',
      line: i + 1,
    });
  }
  return { rename, rulings, sample, err: null };
}

/* ---------- ② 真引擎加载链读全库房间 ---------- */
const { World } = require(path.join(ROOT, 'game', 'src', 'core', 'world.js'));

function loadRooms() {
  const w = new World({ dataDirs: [DATA], seed: 1 });
  w.loadBaseData();
  return w.data.rooms || {};
}

/* ---------- ③ 重地（藏经阁 / 藏宝阁 / 库房）—— §3 收编的对象 ----------
 * 后缀自动认 64 间。另有 2 间**不带后缀但 §3.5.3 点名了**（`| id | 名 | 给的一句 |`
 * 那张表），不补进来 §3 就少两间 —— 这 2 间是手点的，改文档时要跟着改。
 */
const HEAVY_SUFFIX = ['_library', '_vault'];
const HEAVY_EXTRA = {
  palace_treasury: '§3.5.3 皇宫·国库',
  jn_yamen_store: '§3.5.3 衙门库房',
};
function isHeavy(id) { return HEAVY_SUFFIX.some(s => id.endsWith(s)) || !!HEAVY_EXTRA[id]; }

/* ---------- ④ 分组 / 切批（纯函数，好测） ---------- */
function groupByRegion(rooms) {
  const by = {};
  for (const id of Object.keys(rooms)) {
    const r = rooms[id].region || '(无 region)';
    (by[r] = by[r] || []).push(id);
  }
  for (const k of Object.keys(by)) by[k].sort();
  return by;
}

function chunk(list, max) {
  const out = [];
  for (let i = 0; i < list.length; i += max) out.push(list.slice(i, i + max));
  return out.length ? out : [[]];
}

/* ---------- ⑤ 生成计划 ---------- */
function buildPlan(rooms, doc, max) {
  const allIds = Object.keys(rooms);

  /* 改名名单 = §1 表 82 间 + §3 正文裁定（合并成一张单，但标出来历） */
  const renameAll = doc.rename.slice();
  for (const r of doc.rulings) {
    if (renameAll.some(x => x.id === r.id)) continue;
    renameAll.push({ id: r.id, from: (rooms[r.id] && rooms[r.id].name) || '', to: r.to, needDesc: true, why: 'desc 也要换（' + r.source + '）', source: r.source, line: r.line });
  }
  const renameIds = renameAll.map(r => r.id);

  const sampleSet = {}; doc.sample.forEach(s => sampleSet[s] = 1);
  const needDescSet = {}; renameAll.filter(r => r.needDesc).forEach(r => needDescSet[r.id] = 1);

  /* ── 「62 间」到底是哪 62 间？文档里有两处 20/62，指的不是同一件事 ──
     读法 A（§2.2 样张口径）：82 间里 §2 没给全文的            → 实算 68
     读法 B（「需配新 desc」标记口径）：82 里没标那个标记的      → 实算 69（标记只有 13 个）
     两个都算，都写进 _meta，**不替人挑**。 */
  const descTodoA = renameIds.filter(id => !sampleSet[id]);
  const needDescIds = renameIds.filter(id => needDescSet[id]);
  const descTodoB = renameIds.filter(id => !needDescSet[id]);
  const setA = {}; descTodoA.forEach(id => setA[id] = 1);

  /* 样张里不在改名名单内的（D/E/F 三组重地，6 间） */
  const sampleOutside = doc.sample.filter(id => renameIds.indexOf(id) < 0);

  const docMissing = renameIds.filter(id => !rooms[id]);
  const sampleMissing = doc.sample.filter(id => !rooms[id]);

  const byRegion = groupByRegion(rooms);
  const regions = Object.keys(byRegion).sort((a, b) => {
    const ha = byRegion[a].some(id => renameIds.indexOf(id) >= 0);
    const hb = byRegion[b].some(id => renameIds.indexOf(id) >= 0);
    if (ha !== hb) return ha ? -1 : 1;
    return byRegion[b].length - byRegion[a].length;
  });

  const batches = [];
  let n = 0;
  for (const region of regions) {
    const parts = chunk(byRegion[region], max);
    parts.forEach((part, i) => {
      n++;
      const rn = renameAll.filter(r => part.indexOf(r.id) >= 0);
      const rl = rn.filter(r => r.source !== '§1 改名表');
      const pd = part.filter(id => setA[id]);
      const sp = part.filter(id => sampleSet[id]);
      const nd = part.filter(id => needDescSet[id]);
      const hv = part.filter(isHeavy);
      const touches = [];
      if (rn.length) touches.push('name（§1/§3 改名 ' + rn.length + ' 间）');
      if (pd.length) touches.push('desc（' + pd.length + ' 间 §2 没给全文，待补）');
      if (sp.length) touches.push('desc（' + sp.length + ' 间 §2 已有样张，替换）');
      if (hv.length) touches.push('desc（' + hv.length + ' 间重地，§3 收编）');
      batches.push({
        id: 'B' + String(n).padStart(2, '0'),
        region,
        split: parts.length > 1 ? (i + 1) + '/' + parts.length : null,
        roomCount: part.length,
        roomIds: part,
        /* —— 寇豆码要照着改的东西，全在这儿，不用回去翻文档 —— */
        rename: rn,                                   // [{id, from, to, needDesc, why, source, line}]
        renameCount: rn.length,
        fromRuling: rl,                               // 其中来自 §3 正文裁定、不在 §1 表里的
        sample77: sp, sample77Count: sp.length,        // §2 已有全文
        descTodo: pd, descTodoCount: pd.length,        // 读法 A 的待补名单
        needDesc77: nd, needDesc77Count: nd.length,
        heavy: hv, heavyCount: hv.length,
        touches: touches.length ? touches : ['（待派活）'],
        /* 性质**预期**：给人的预判。真正判定由 data-edit-cycle 的 classifyBatch
           在改完之后用字段级 diff 给 —— 这里不替人做决定 */
        expectedKind: touches.length
          ? '文案批次（预期：只动 name/desc，不动 id/exits）'
          : '（待派活）',
        note: rn.length
          ? 'design/77 改名 ' + rn.length + ' 间'
            + (rl.length ? '（含 ' + rl.length + ' 间来自 §3 正文裁定，不在 §1 表里）' : '')
            + (nd.length ? '；其中 ' + nd.length + ' 间标了「需配新 desc」' : '')
            + (pd.length ? '；' + pd.length + ' 间 §2 没给全文' : '')
            + (sp.length ? '；' + sp.length + ' 间 §2 已有样张' : '')
            + (hv.length ? '；含重地 ' + hv.length + ' 间（§3 收编）' : '')
          : '本批不在 design/77 已点名的名单里 —— 后续 200 间 / 300 间密度的候选批',
      });
    });
  }

  const discrepancies = [];
  if (descTodoA.length !== 62) {
    discrepancies.push('「62 间」对不上：文档 V1 / §1.4.2-A6 说 82 间里 20 间已有（或需配）'
      + '、其余 62 间。实算两种口径都不是 62 —— '
      + '读法A（§2.2 样张全文）= ' + descTodoA.length + ' 间待补，'
      + '读法B（需配新 desc 标记）= ' + descTodoB.length + ' 间没标标记'
      + '（而表里真正带「需配新 desc」的只有 ' + needDescIds.length + ' 间，不是 20）。'
      + '原因：§2.2 的 20 间样张里有 ' + sampleOutside.length + ' 间**不在 82 间改名名单内**'
      + '（' + sampleOutside.join('、') + '，全是 D/E/F 组的重地）。'
      + '**要人定：62 到底指哪一张名单。**');
  }
  if (doc.rulings.length) {
    discrepancies.push('§3 正文里还有 ' + doc.rulings.length + ' 间改名裁定不在 §1 表里：'
      + doc.rulings.map(r => '`' + r.id + '`→「' + r.to + '」（第 ' + r.line + ' 行）').join('；')
      + '。已并入本清单的 rename，但**跟 §1 的那 82 间来历不同，改之前人要看一眼**。');
  }

  return {
    plan: {
      _meta: {
        generatedAt: new Date().toISOString(),
        generator: 'tools/room-batch-plan.js（重跑即可重新切分，别手改这个 JSON）',
        source: ['game/data/**（真引擎加载链）', 'design/77-room-rewrite-sample.md'],
        totalRooms: allIds.length,
        totalRegions: regions.length,
        totalBatches: batches.length,
        maxBatchSize: max,
        renameTotal: renameAll.length,
        renameFromTable: doc.rename.length,
        renameFromRuling: doc.rulings.length,
        sample77Total: doc.sample.length,
        sampleOutsideRename: sampleOutside,
        descTodoA_total: descTodoA.length,
        descTodoB_total: descTodoB.length,
        needDesc77Total: needDescIds.length,
        docMissingFromDisk: docMissing,
        sampleMissingFromDisk: sampleMissing,
        discrepancies,
        rule: '按 region 分批，每批 ≤ ' + max + ' 间。判据：这批改动会不会动到 id 或 exits？'
          + '动到 ⇒ 必须分批（引用关系变了，批次边界就是归因边界）；'
          + '只改 name/desc ⇒ 可以大批量。',
      },
      _howToUse: [
        '1) 一批一批做，不要跨批混着改。',
        '2) 每批： node tools/data-edit-cycle.js cycle --only map   （守卫 + 悬空引用 + 定向回归，一步红就停）',
        '3) 绿了再进下一批。',
        '4) 全部批跑完，最后跑一次 node tools/run-regression.js（全量）。',
        '5) 改完想知道这批到底是「结构性」还是「文案」： node tools/data-edit-cycle.js diff   （它会打印，不替你决定）',
        '6) 开工前先看 _meta.discrepancies —— 那里有文档自相对不上的地方，得人拍板。',
      ],
      batches,
    },
    facts: { allIds, docMissing, sampleMissing, descTodoA, descTodoB, needDescIds, sampleOutside, batches, renameAll },
  };
}

/* ---------- ⑥ 打印摘要 ---------- */
function printSummary(plan) {
  const m = plan._meta;
  console.log('批次切分清单已写入 ' + path.relative(ROOT, OUT));
  console.log('全库 ' + m.totalRooms + ' 间 / ' + m.totalRegions + ' 个 region → ' + m.totalBatches + ' 批（每批 ≤ ' + m.maxBatchSize + '）');
  console.log('design/77 改名 ' + m.renameTotal + ' 间（§1 表 ' + m.renameFromTable + ' + §3 正文裁定 ' + m.renameFromRuling + '）；'
    + '§2 样张 ' + m.sample77Total + ' 间；§2 没给全文的 ' + m.descTodoA_total + ' 间');
  if (m.docMissingFromDisk.length) console.log('⚠️ design/77 点名但磁盘上没有的 id：' + m.docMissingFromDisk.join(', '));
  if (m.sampleMissingFromDisk.length) console.log('⚠️ §2 样张但磁盘上没有的 id：' + m.sampleMissingFromDisk.join(', '));
  if (m.discrepancies.length) {
    console.log('');
    console.log('⚠️⚠️ 有 ' + m.discrepancies.length + ' 处文档自相对不上，开工前要人拍板：');
    m.discrepancies.forEach((d, i) => console.log('   (' + (i + 1) + ') ' + d));
  }
  console.log('');
  const hasWork = b => (b.renameCount || b.descTodoCount || b.sample77Count || b.heavyCount);
  for (const b of plan.batches.filter(hasWork)) {
    console.log('  ' + b.id + '  ' + b.region.padEnd(12) + String(b.roomCount).padStart(3) + ' 间'
      + '   改名 ' + String(b.renameCount).padStart(2)
      + '  待补desc ' + String(b.descTodoCount).padStart(2)
      + '  样张 ' + String(b.sample77Count).padStart(2)
      + '  重地 ' + String(b.heavyCount).padStart(2)
      + '   ' + b.touches.join(' / '));
  }
  console.log('');
  console.log('  （其余 ' + plan.batches.filter(b => !hasWork(b)).length + ' 批不在 design/77 名单里，等后续派活）');
}

/* ==========================================================================
 * ⑦ 自检 —— 绿不算数，得证明它会红
 * ========================================================================== */
function selftest() {
  let pass = 0, fail = 0;
  const ok = (g, name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + g + ' ' + name); }
    else { fail++; console.log('  ✗ ' + g + ' ' + name + (extra ? '  → ' + extra : '')); }
  };

  const doc = readDoc77();
  const rooms = loadRooms();
  const { plan, facts } = buildPlan(rooms, doc, MAX);
  const m = plan._meta;

  console.log('【① 文档解析：抠出来的是不是真名单】');
  ok('①1', 'design/77 存在且解析成功', !doc.err, doc.err);
  ok('①2', '§1 改名表 = 82 间', doc.rename.length === 82, '实到 ' + doc.rename.length);
  ok('①3', '没有把 §3.5 的非改名表混进来（每行都有现名和新名）',
    doc.rename.every(r => r.from && r.to), doc.rename.filter(r => !r.from || !r.to).map(r => r.id).join(','));
  ok('①4', '§3.5.1 / §3.5.3 那 4 间没被当成 §1 改名房',
    ['shaolin_cangjing', 'shaolin_library', 'palace_treasury', 'jn_yamen_store']
      .filter(id => doc.rename.some(r => r.id === id)).length === 0,
    ['shaolin_cangjing', 'shaolin_library', 'palace_treasury', 'jn_yamen_store']
      .filter(id => doc.rename.some(r => r.id === id)).join(','));
  ok('①5', '§2 样张 = 20 间', doc.sample.length === 20, '实到 ' + doc.sample.length);
  ok('①6', '§3 正文裁定被抓到了（shaolin_cangjing → 少林·碑廊）',
    doc.rulings.some(r => r.id === 'shaolin_cangjing' && /碑廊/.test(r.to)),
    JSON.stringify(doc.rulings));

  console.log('【② 文档与磁盘对账】');
  ok('②1', '改名房磁盘上全都在', m.docMissingFromDisk.length === 0, m.docMissingFromDisk.join(','));
  ok('②2', '20 间样张磁盘上全都在', m.sampleMissingFromDisk.length === 0, m.sampleMissingFromDisk.join(','));
  /* §1 表给少林 10 间（6 山路 + 4 柏谷村），§3.5.1 正文又裁定了 shaolin_cangjing
     ⇒ 11。曾经串表报成 12（多抓了 shaolin_library）。 */
  const shaolinBatches = plan.batches.filter(b => b.region === 'shaolin');
  const shaolinCount = shaolinBatches.reduce((s, b) => s + b.renameCount, 0);
  ok('②3', '少林改名 = 11 间（§1 表 10 + §3.5.1 裁定 1；曾经串表报成 12）',
    shaolinCount === 11, '实到 ' + shaolinCount);
  ok('②3b', '少林那 11 间里有 1 间来自 §3 正文裁定',
    shaolinBatches.reduce((s, b) => s + b.fromRuling.length, 0) === 1,
    JSON.stringify(shaolinBatches.map(b => b.fromRuling.map(r => r.id))));
  ok('②3c', 'shaolin_library 没被当成改名房（它只在 §3.5.1 的对照表里出现过）',
    !facts.renameAll.some(r => r.id === 'shaolin_library'));
  ok('②4', '改名总数 = 82 + §3 裁定 1 = 83', m.renameTotal === 83, '实到 ' + m.renameTotal);
  ok('②5', '样张里有 6 间不在改名名单内，且全是重地',
    m.sampleOutsideRename.length === 6 && m.sampleOutsideRename.every(isHeavy),
    m.sampleOutsideRename.join(','));

  console.log('【③ 「62 间」这个数：两个口径都算出来，且差异被报出来】');
  /* 82 + §3 裁定 1 = 83；§2 样张落在改名名单内的 14 间 ⇒ 读法A = 69，
     不是文档说的 62。文档那个 62 是拿「20 间样张」直接 82−20 算的，
     但 20 间里有 6 间根本不在 82 间里（重地）。 */
  ok('③1', '读法A（§2 没给全文）= 69，不是文档说的 62', m.descTodoA_total === 69, '实到 ' + m.descTodoA_total);
  ok('③2', '读法A 与读法B 是两张不同的名单（证明「20」指的不是同一批房）',
    (() => {
      const a = {}; facts.descTodoA.forEach(id => a[id] = 1);
      const b = {}; facts.descTodoB.forEach(id => b[id] = 1);
      const sym = Object.keys(a).filter(x => !b[x]).length + Object.keys(b).filter(x => !a[x]).length;
      return sym > 0;
    })());
  /* 13 个是 §1 表里真正带标记的，+1 是 §3 裁定那间（desc 也要换） */
  ok('③3', '「需配新 desc」= 14（§1 表 13 + §3 裁定 1），不是文档说的 20',
    m.needDesc77Total === 14, '实到 ' + m.needDesc77Total);
  ok('③4', '这个对不上被摆进 discrepancies 了（没有被默默吞掉）',
    m.discrepancies.some(d => /62/.test(d)));
  ok('③5', '§3 裁定不在 §1 表里这件事也被摆出来了',
    m.discrepancies.some(d => /碑廊/.test(d)));

  console.log('【④ 切分本身】');
  ok('④1', '每批 ≤ ' + MAX, plan.batches.every(b => b.roomCount <= MAX),
    plan.batches.filter(b => b.roomCount > MAX).map(b => b.id + ':' + b.roomCount).join(','));
  const covered = [];
  plan.batches.forEach(b => b.roomIds.forEach(id => covered.push(id)));
  ok('④2', '全库房间都进了某一批（0 遗漏）', covered.length === facts.allIds.length,
    covered.length + ' vs ' + facts.allIds.length);
  ok('④3', '没有房间被算进两批（0 重复）', new Set(covered).size === covered.length);
  ok('④4', '有 design/77 活儿的 region 排在前面',
    (() => {
      const idx = plan.batches.findIndex(b => !b.renameCount);
      return idx < 0 || plan.batches.slice(idx).every(b => !b.renameCount);
    })());
  ok('④5', '批里的房间 region 与批的 region 一致（没串区）',
    plan.batches.every(b => b.roomIds.every(id => (rooms[id].region || '(无 region)') === b.region)));
  /* 22 藏经阁 + 42 藏宝阁/库房 + §3.5.3 点名的 2 间不带后缀的 = 66 */
  ok('④6', '重地总数 = 66（22 _library + 42 _vault + 2 间 §3.5.3 手点的）',
    plan.batches.reduce((s, b) => s + b.heavyCount, 0) === 66,
    '实到 ' + plan.batches.reduce((s, b) => s + b.heavyCount, 0));
  ok('④7', '§3.5.3 那 2 间不带后缀的也被算成重地了',
    ['palace_treasury', 'jn_yamen_store'].every(id => isHeavy(id)));

  console.log('【⑤ 变异对照：证明切分真的在生效，不是写死的 34】');
  const small = buildPlan(rooms, doc, 5);
  ok('⑤1', '上限改成 5 ⇒ 批数变多', small.plan._meta.totalBatches > m.totalBatches,
    small.plan._meta.totalBatches + ' vs ' + m.totalBatches);
  ok('⑤2', '上限改成 5 ⇒ 每批仍 ≤5', small.plan.batches.every(b => b.roomCount <= 5));
  ok('⑤3', '切批后房间总数不变', small.facts.allIds.length === facts.allIds.length);
  const one = buildPlan(rooms, doc, 100000);
  ok('⑤4', '上限放到 10 万 ⇒ 批数 = region 数（不该再切）',
    one.plan._meta.totalBatches === m.totalRegions, one.plan._meta.totalBatches + ' vs ' + m.totalRegions);
  ok('⑤5', 'chunk() 对空数组也给一个空批（不返回空数组导致批消失）', chunk([], 40).length === 1);

  console.log('【⑥ 输出】');
  ok('⑥1', '写出的 JSON 能 parse 回来且带 _howToUse', (() => {
    try { const p = JSON.parse(fs.readFileSync(OUT, 'utf8')); return Array.isArray(p._howToUse) && p._howToUse.length > 0; }
    catch (e) { return false; }
  })());
  ok('⑥2', '每批都带 roomIds（可执行，不是空壳）',
    plan.batches.every(b => Array.isArray(b.roomIds) && b.roomIds.length > 0));
  ok('⑥3', '每批的 rename 都带 from/to（寇豆码不用来回翻文档）',
    plan.batches.every(b => b.rename.every(r => r.id && r.to)));

  console.log('');
  console.log('自检：' + pass + ' 通过 / ' + fail + ' 失败');
  return fail ? 1 : 0;
}

/* ---------- 主流程 ---------- */
if (process.argv.indexOf('--selftest') >= 0) process.exit(selftest());

const doc = readDoc77();
if (doc.err) { console.error(doc.err); process.exit(2); }
const rooms = loadRooms();
const { plan } = buildPlan(rooms, doc, MAX);

/* 文档自述 82 间 —— 抠出来的不是 82 就要喊，别默默接受 */
if (doc.rename.length !== 82) {
  console.log('⚠️ design/77 改名表抠出 ' + doc.rename.length + ' 间，与文档自述的 82 间不符。');
  console.log('   要么文档又加了/删了行（那这个数就是对的，把自检 ①2 的 82 一起改），');
  console.log('   要么解析又串表了。**先查清楚再往下走。**');
}

fs.writeFileSync(OUT, JSON.stringify(plan, null, 2) + '\n', 'utf8');
printSummary(plan);

module.exports = { readDoc77, groupByRegion, chunk, buildPlan, isHeavy };
