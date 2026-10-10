#!/usr/bin/env node
/**
 * gen-portraits.js —— 把写好的 NPC 画像灌进游戏数据（人物画像 · 批次 5）
 *
 * 输入：design/portraits-new.json
 *         结构 { _readme, v, tier, batch, note, items: { <npcId>: <portrait> } }
 *         每个 portrait = 13 字段 + v/tier/lock + `_note`（设计说明，写入前剥离）
 * 输出：game/data/40_npcs.json —— **只给对应 NPC 补 def.portrait，绝不碰其它字段**
 *
 * ── 挂载策略：直接注入 40_npcs.json（方案 a）────────────────────────────
 *   为何不另起 41_portraits.json 靠 mergeData 合并（方案 b）：
 *   ① 规格 §4.1 定的就是 def.portrait 挂进 40_npcs.json；且**已有 16 张画像本就在
 *      40_npcs.json 里**——换独立文件会造成「画像数据两处存放」，不是统一来源。
 *   ② 40_npcs.json 用 1 空格缩进，`JSON.stringify(data, null, 1)` 可**逐字节还原**
 *      （实测 553824 字节 exact === raw），故注入后的 diff 只含新增的 26 段，干净可审。
 *   ③ 方案 b 实测**可行**（world.js#mergeData 对 npcs 是按 id 的 deepMerge，
 *      不会整体覆盖：name/desc/hp/tag/rel 全保留、总数不变），但它把正确性押在
 *      「文件名排序 40 < 41」+「mergeEntry 走 deepMerge」两个隐式前提上，且与既有
 *      16 张画像不同源 —— 收益为负，弃用。
 *
 * ── 幂等三原则（照 gen-social.js 约定）──────────────────────────────────
 *   ① 存在即跳过：def.portrait && def.portrait.v === 1 → skip
 *   ② 手写锁：def.portrait.lock === true → 永不覆盖（报告里列「受保护」）
 *   ③ 可复现：纯数据搬运，无随机
 *
 * 用法：
 *   node tools/gen-portraits.js                 # 全量灌入（幂等，可重复跑）
 *   node tools/gen-portraits.js --tier=A        # 只处理 A 层
 *   node tools/gen-portraits.js --check         # 只校验不写入（回归用）
 *   node tools/gen-portraits.js --file=xxx.json # 指定画像源文件
 *   node tools/gen-portraits.js --json          # 报告以 JSON 输出（给测试解析）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const DEFAULT_SRC = path.join(ROOT, 'design', 'portraits-new.json');

/* =============================================================
 *  规格常量（design/01-npc-portrait-spec.md §1.2 / §3.2；15 §5.2 / §5.5）
 * ============================================================= */
const TONE_ENUM = ['敬', '谦', '傲', '泼', '讷', '油', '冷', '酸', '痴'];
const AT_ENUM = ['day', 'night', 'dawn', 'dusk', 'meal'];
/** social.js FAVOR_TIERS 六档（闭开区间，末档含右端） */
const FAVOR_TIERS = [
  ['死敌', -200, -60], ['冷淡', -60, -15], ['平常', -15, 20],
  ['友善', 20, 60], ['亲密', 60, 120], ['知己', 120, 300],
];
function favorTierName(f) {
  if (typeof f !== 'number') return null;
  for (const [n, lo, hi] of FAVOR_TIERS) if (f >= lo && (f < hi || (n === '知己' && f === hi))) return n;
  return null;
}

/** marks 词典（**逐字**取自 15-portrait-roster §5.2，不擅自增删） */
const MARK_DICT = ['债', '官', '刑', '商', '粮', '盐', '医', '药', '毒', '逃', '丐', '农', '田',
  '军', '兵', '僧', '道', '庙', '剑', '掌门', '教', '宫', '影', '风尘', '赌', '镖', '船', '货',
  '诈', '叛', '伪', '旧案', '丧亲', '丧偶', '丧子', '丧女', '科举', '儒', '侠', '游', '消息',
  '字', '灾', '赃'];

/** 禁用现代词（规格 §3.2，去掉了语境相关的裸「车/票/米」避免误伤「马车/镖车」） */
const BANNED = ['警察', '公司', '老板', '单位', '部门', '系统', '项目', '团队', '客户', '员工',
  '经理', '政府', '组织', '机构', '集团', '问题', '压力', '情绪', '沟通', '关系网', '资源',
  '信息', '状态', '情况', '方式', '模式', '目标', '计划', '机会', '风险', '概念', '意识',
  '手机', '电话', '电脑', '网络', '银行', '超市', '酒店', '医院', '学校', '快递', '密码',
  '处理', '解决', '安排', '配合', '联系', '汇报', '确认', '参与', '优化', '反馈', '运营',
  '分钟', '小时', '星期', '周末', '季度', '公里', '公斤'];

/** 反面标记：命中之一则必须有 hooks（15 §5.5 #3） */
const VILLAIN_MARKS = ['伪', '叛', '诈', '赃', '盐', '粮', '刑'];

const REQUIRED = {
  A: ['role', 'origin', 'now', 'want', 'fear', 'secret', 'obsession', 'feuds', 'voice', 'routine', 'arc', 'hooks', 'marks'],
  B: ['role', 'origin', 'now', 'want', 'fear', 'voice', 'routine', 'arc', 'marks'],
  C: ['role', 'want', 'voice', 'marks'],
};

/* =============================================================
 *  工具
 * ============================================================= */
/** 递归剥离所有以 `_` 开头的键（设计说明 `_note` / `_readme` 等，不得写进游戏数据） */
function stripDeep(v) {
  if (Array.isArray(v)) return v.map(stripDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) {
      if (k.startsWith('_')) continue;
      out[k] = stripDeep(v[k]);
    }
    return out;
  }
  return v;
}
const isStr = v => typeof v === 'string' && v.trim().length > 0;
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

/** 画像全文（用于禁用词 / 性别红线扫描） */
function flatText(v, acc) {
  acc = acc || [];
  if (v == null) return acc;
  if (typeof v === 'string') { acc.push(v); return acc; }
  if (Array.isArray(v)) { v.forEach(x => flatText(x, acc)); return acc; }
  if (typeof v === 'object') { Object.values(v).forEach(x => flatText(x, acc)); return acc; }
  return acc;
}

/** hooks[].trigger 的嵌套深度（规格 §4.7：≤ 3） */
function condDepth(c) {
  if (c == null || typeof c !== 'object') return 0;
  let d = 1;
  for (const k of Object.keys(c)) {
    if (k === 'and' || k === 'or') {
      const arr = Array.isArray(c[k]) ? c[k] : [c[k]];
      for (const sub of arr) d = Math.max(d, 1 + condDepth(sub));
    } else if (k === 'not') {
      d = Math.max(d, 1 + condDepth(c[k]));
    }
  }
  return d;
}

/* =============================================================
 *  单条画像校验 —— 返回错误串数组，格式 "npcId.字段: 原因"
 *  · errs  = 硬错误（必填缺失 / 关系不闭合 / 性别红线 / 禁用词 / 事件钩子…）→ 阻断写入
 *  · warns = 软提示（marks 超出 §5.2 词典等设计口径缺口）→ 只报告不阻断
 * ============================================================= */
function validateItem(id, p, def, allNpcs, warns) {
  const errs = [];
  const E = (field, msg) => errs.push(`${id}.${field}: ${msg}`);
  const W = (field, msg) => { if (warns) warns.push(`${id}.${field}: ${msg}`); else errs.push(`${id}.${field}: ${msg}`); };
  if (!isObj(p)) { E('(整个 portrait)', '不是对象'); return errs; }

  const tier = p.tier;
  if (p.v !== 1) E('v', `必须是 1，实为 ${JSON.stringify(p.v)}`);
  if (!['A', 'B', 'C'].includes(tier)) E('tier', `必须是 A/B/C，实为 ${JSON.stringify(tier)}`);

  /* ① 必填字段存在性（按 tier） */
  const req = REQUIRED[tier] || REQUIRED.A;
  for (const f of req) {
    if (p[f] === undefined) { E(f, '缺少必填字段'); continue; }
    if (p[f] === null) { E(f, '为 null'); continue; }
    if (typeof p[f] === 'string' && !isStr(p[f])) E(f, '为空串');
    if (Array.isArray(p[f]) && p[f].length === 0) E(f, '空数组');
  }

  /* ② voice 子结构 */
  if (isObj(p.voice)) {
    if (!TONE_ENUM.includes(p.voice.tone)) E('voice.tone', `不在枚举 ${TONE_ENUM.join('/')}，实为 ${JSON.stringify(p.voice.tone)}`);
    if (!isStr(p.voice.catchphrase)) E('voice.catchphrase', '缺失或为空');
    if (tier === 'A') {
      if (!Array.isArray(p.voice.taboo) || p.voice.taboo.length < 1 || p.voice.taboo.length > 3) E('voice.taboo', 'A 层须 1~3 个');
      if (!isStr(p.voice.style)) E('voice.style', 'A 层必填');
    }
  } else if (req.includes('voice')) E('voice', '不是对象');

  /* ③ routine */
  if (Array.isArray(p.routine)) {
    const need = tier === 'A' ? [2, 3] : tier === 'B' ? [1, 1] : [0, 0];
    if (tier !== 'C' && (p.routine.length < need[0] || p.routine.length > need[1])) E('routine', `${tier} 层须 ${need[0]}~${need[1]} 条，实为 ${p.routine.length}`);
    p.routine.forEach((r, i) => {
      if (!isObj(r)) { E(`routine[${i}]`, '不是对象'); return; }
      if (!AT_ENUM.includes(r.at)) E(`routine[${i}].at`, `不在 ${AT_ENUM.join('/')}`);
      if (!isStr(r.act)) E(`routine[${i}].act`, '缺失或为空');
    });
  }

  /* ④ feuds（关系闭合：id ⊆ rel，kind 一致） */
  if (Array.isArray(p.feuds)) {
    if (tier === 'A' && (p.feuds.length < 2 || p.feuds.length > 4)) E('feuds', `A 层须 2~4 条，实为 ${p.feuds.length}`);
    const relIds = ((def && def.rel) || []).map(r => r.id);
    const relKind = {}; ((def && def.rel) || []).forEach(r => { relKind[r.id] = r.kind; });
    p.feuds.forEach((f, i) => {
      if (!isObj(f)) { E(`feuds[${i}]`, '不是对象'); return; }
      if (!f.id) E(`feuds[${i}].id`, '缺失');
      else if (!relIds.includes(f.id)) E(`feuds[${i}].id`, `${f.id} 不在该 NPC 的 rel 里（画像禁止新建关系边）`);
      else if (f.kind !== relKind[f.id]) E(`feuds[${i}].kind`, `${f.kind} 与 rel 边的 ${relKind[f.id]} 不一致`);
      if (!isStr(f.why)) E(`feuds[${i}].why`, '缺失');
      if (!isStr(f.since)) E(`feuds[${i}].since`, '缺失');
    });
  }

  /* ⑤ arc（init 必须与 favorInit 同档） */
  if (isObj(p.arc)) {
    if (!FAVOR_TIERS.some(t => t[0] === p.arc.init)) E('arc.init', `不在六档 ${FAVOR_TIERS.map(t => t[0]).join('/')}，实为 ${JSON.stringify(p.arc.init)}`);
    else if (def && def.favorInit !== undefined) {
      const want = favorTierName(def.favorInit);
      if (want && want !== p.arc.init) E('arc.init', `${p.arc.init} ≠ favorInit(${def.favorInit}) 所在档 ${want}`);
    }
    if (!isStr(p.arc.warm)) E('arc.warm', '缺失');
    if (tier === 'A' && !isStr(p.arc.cold)) E('arc.cold', 'A 层必填');
    if (tier === 'A' && !isStr(p.arc.break)) E('arc.break', 'A 层必填');
  }

  /* ⑥ secret */
  if (isObj(p.secret)) {
    if (!isStr(p.secret.text)) E('secret.text', '缺失');
    if (typeof p.secret.tier !== 'number' || p.secret.tier < 0 || p.secret.tier > 3) E('secret.tier', '须 0~3 整数');
    if (!Array.isArray(p.secret.leakTo) || p.secret.leakTo.length === 0) E('secret.leakTo', '必须非空（否则无人可传，传闻系统无种子）');
    else p.secret.leakTo.forEach((x, i) => { if (!allNpcs[x]) E(`secret.leakTo[${i}]`, `${x} 不存在于 40_npcs.json`); });
    if (!isStr(p.secret.ifLeaked)) E('secret.ifLeaked', '缺失');
  }

  /* ⑦ hooks */
  if (Array.isArray(p.hooks)) {
    if (tier === 'A' && (p.hooks.length < 1 || p.hooks.length > 3)) E('hooks', `A 层须 1~3 条，实为 ${p.hooks.length}`);
    p.hooks.forEach((h, i) => {
      if (!isObj(h)) { E(`hooks[${i}]`, '不是对象'); return; }
      for (const f of ['id', 'title', 'type', 'trigger', 'seed', 'rewardHint']) {
        if (h[f] === undefined || h[f] === null || (typeof h[f] === 'string' && !isStr(h[f]))) E(`hooks[${i}].${f}`, '缺失');
      }
      const dep = condDepth(h.trigger);
      if (dep > 3) E(`hooks[${i}].trigger`, `嵌套深度 ${dep} > 3（会被 cleanInstance 静默丢弃）`);
    });
  }

  /* ⑧ marks */
  if (Array.isArray(p.marks)) {
    if (p.marks.length < 1 || p.marks.length > 3) E('marks', `须 1~3 个，实为 ${p.marks.length}`);
    p.marks.forEach(m => { if (!MARK_DICT.includes(m)) W('marks', `${JSON.stringify(m)} 不在 15-portrait-roster §5.2 词典（建议设计侧回填词典或改用近义 mark）`); });
    /* 反面必须有 hooks（15 §5.5 #3） */
    if (p.marks.some(m => VILLAIN_MARKS.includes(m)) && !(Array.isArray(p.hooks) && p.hooks.length >= 1)) {
      E('hooks', `marks 含反面标记（${p.marks.filter(m => VILLAIN_MARKS.includes(m)).join('/')}）却没有 hooks`);
    }
  } else if (req.includes('marks')) E('marks', '不是数组');

  /* ⑨ 禁用现代词 */
  const text = flatText(p).join('\n');
  const hit = BANNED.filter(w => text.includes(w));
  if (hit.length) E('(全文)', `命中禁用现代词：${hit.join('、')}`);

  /* ⑩ 性别红线：女性 NPC 文本不得出现「汉子 / 他 / 爷们 / 兄弟」 */
  if (def && def.gender === 'female') {
    const bad = [];
    if (/汉子|爷们|兄弟/.test(text)) bad.push('汉子/爷们/兄弟');
    const cn = (text.match(/他/g) || []).length;
    if (cn) bad.push(`「他」×${cn}`);
    if (bad.length) E('(性别)', `女性 NPC 出现男性化用词：${bad.join('、')}`);
  }

  /* ⑪ 未剥离的 `_` 键（防御：进入这一层说明调用方忘了 stripDeep） */
  const underscore = Object.keys(p).filter(k => k.startsWith('_'));
  if (underscore.length) E('(内部)', `未剥离的 _ 键：${underscore.join(',')}`);

  return errs;
}

/* =============================================================
 *  核心：把画像灌进数据对象（就地改 data）
 * ============================================================= */
function applyPortraits(data, items, opts) {
  opts = opts || {};
  const npcs = data.npcs || {};
  const report = { selected: 0, added: [], skipped: [], protected: [], missing: [], errors: [], warnings: [], wouldAdd: [] };
  const ids = Object.keys(items).filter(id => !opts.tier || items[id].tier === opts.tier);

  /* 全仓 catchphrase 查重：本批 + 既有（40_npcs.json 里已有的 portrait）
     ⚠️ 必须按 id 记录、比对时**排除自身** —— 否则二次运行时，某 NPC 已有的
     catchphrase 会被当成「与既有重复」，幂等直接报错（本文件第一版就踩了这个坑）。 */
  const cpMap = {};
  const addCp = (cp, id, src) => { if (cp) (cpMap[cp] = cpMap[cp] || []).push({ id, src }); };
  for (const id of Object.keys(npcs)) {
    const cp = npcs[id].portrait && npcs[id].portrait.voice && npcs[id].portrait.voice.catchphrase;
    addCp(cp, id, '既有');
  }

  for (const id of ids) {
    report.selected++;
    const def = npcs[id];
    if (!def) { report.missing.push(id); report.errors.push(`${id}: 40_npcs.json 里不存在这个 npcId`); continue; }
    const cleaned = stripDeep(items[id]);
    /* 校验对象：若该 NPC 已有 v===1 的 portrait（即已注入），就校验**磁盘上那一份**
       —— 这样 --check 才能当作「已落库数据的回归闸门」（能抓出被改坏的 portrait）；
       否则校验即将写入的源数据。 */
    const existing0 = def.portrait;
    const target = (existing0 && existing0.v === 1) ? existing0 : cleaned;
    const errs = validateItem(id, target, def, npcs, report.warnings);
    /* catchphrase 查重（仅对本批，排除自身） */
    const cp = cleaned.voice && cleaned.voice.catchphrase;
    if (cp) {
      const others = (cpMap[cp] || []).filter(e => e.id !== id);
      if (others.length) errs.push(`${id}.voice.catchphrase: 与 ${others.map(e => e.src + ':' + e.id).join('、')} 重复`);
      addCp(cp, id, '本批');
    }
    if (errs.length) { report.errors.push(...errs); continue; }

    const existing = def.portrait;
    if (existing && existing.v === 1) { report.skipped.push(id); continue; }
    if (existing && existing.lock === true) { report.protected.push(id); continue; }
    if (opts.check) { report.wouldAdd.push(id); continue; }
    def.portrait = cleaned;
    report.added.push(id);
  }
  return report;
}

/* =============================================================
 *  CLI
 * ============================================================= */
function readJSON(fp) { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
function writeData(fp, data) { fs.writeFileSync(fp, JSON.stringify(data, null, 1), 'utf8'); }

function main(argv) {
  const args = argv || [];
  const flag = (name, def) => { const a = args.find(x => x.startsWith('--' + name + '=')); return a ? a.split('=').slice(1).join('=') : def; };
  const has = name => args.includes('--' + name);
  const srcFile = path.resolve(flag('file', DEFAULT_SRC));
  const tier = flag('tier', null);
  const check = has('check');

  console.log('【gen-portraits】源=' + path.relative(ROOT, srcFile) + ' 目标=' + path.relative(ROOT, DATA_FILE) + (tier ? ' --tier=' + tier : '') + (check ? ' --check(只校验)' : ''));

  const src = readJSON(srcFile);
  if (!src.items || typeof src.items !== 'object') { console.error('✘ 源文件缺 items'); process.exit(2); }
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  const data = JSON.parse(raw);

  const report = applyPortraits(data, src.items, { tier, check });

  /* 覆盖率报告 */
  const allIds = Object.keys(data.npcs);
  const withP = allIds.filter(id => data.npcs[id].portrait && data.npcs[id].portrait.v === 1);
  const byTier = {}; for (const id of withP) { const t = data.npcs[id].portrait.tier || '?'; byTier[t] = (byTier[t] || 0) + 1; }

  console.log('\n—— 本批 ——');
  console.log(`  选中 ${report.selected} 条｜新增 ${report.added.length}｜已存在跳过 ${report.skipped.length}｜受保护 ${report.protected.length}｜缺 NPC ${report.missing.length}` + (check ? `｜待写(未写) ${report.wouldAdd.length}` : ''));
  if (report.added.length) console.log('  新增：' + report.added.join(','));
  if (report.skipped.length) console.log('  跳过(已 v===1)：' + report.skipped.join(','));
  if (report.protected.length) console.log('  受保护(lock)：' + report.protected.join(','));
  if (report.missing.length) console.log('  ✘ 缺 NPC：' + report.missing.join(','));
  console.log('\n—— 全库覆盖率 ——');
  console.log(`  有画像 ${withP.length} / ${allIds.length} ` + JSON.stringify(byTier));
  console.log(`  仍缺画像 ${allIds.length - withP.length} 个`);

  if (report.warnings.length) {
    console.warn(`\n⚠ 软提示 ${report.warnings.length} 条（不阻断写入）：`);
    report.warnings.forEach(w => console.warn('   · ' + w));
  }

  if (report.errors.length) {
    console.error(`\n✘ 校验失败 ${report.errors.length} 条：`);
    report.errors.forEach(e => console.error('   · ' + e));
    console.error('\n✘ 未写入任何数据（不许把半成品落盘）。');
    process.exit(1);
  }

  if (check) {
    console.log('\n✔ --check 通过：全部必填字段 / 关系闭合 / 性别红线 / 禁用词 / catchphrase 查重 均通过，未写入。');
    return report;
  }

  if (report.added.length) {
    /* 备份（tools/_bak/ 惯例），再落盘 */
    const bakDir = path.join(__dirname, '_bak');
    if (!fs.existsSync(bakDir)) fs.mkdirSync(bakDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(DATA_FILE, path.join(bakDir, `40_npcs.${stamp}.bak.json`));
    writeData(DATA_FILE, data);
    console.log(`\n✔ 已写入 ${report.added.length} 条画像到 ${path.relative(ROOT, DATA_FILE)}（备份在 tools/_bak/）。`);
  } else {
    console.log('\n✔ 无新增（幂等：目标已是所需状态，未改文件）。');
  }
  return report;
}

module.exports = {
  validateItem, applyPortraits, stripDeep, condDepth, favorTierName,
  TONE_ENUM, AT_ENUM, FAVOR_TIERS, MARK_DICT, BANNED, VILLAIN_MARKS, REQUIRED,
  DEFAULT_SRC, DATA_FILE, main,
};

if (require.main === module) main(process.argv.slice(2));
