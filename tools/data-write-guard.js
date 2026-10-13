#!/usr/bin/env node
/* ==========================================================================
 * tools/data-write-guard.js —— 数据落库格式守卫
 * --------------------------------------------------------------------------
 * 为什么要这个（上一轮用血换来的）：
 *   我（严过关）落库时用 `JSON.stringify(obj, null, 1) + '\n'` 重写了 40_npcs.json，
 *   而那个文件**磁盘原样必须是 `JSON.stringify(obj, null, 1)` 且末尾无换行** ——
 *   tools/smoke-portrait-batch.js 有逐字节断言（`JSON.stringify(N,null,1) === RAW`）。
 *   结果：不报错，只让回归红 5 项（0.5 / 3.2 / 3.3 / 3.4 / 3.7），全量 131/132。
 *   **病根是「不报错就是不生效」**：写入格式错了，数据照样能 parse、引擎照样起得来。
 *
 * 它干什么：
 *   ① `--baseline`：扫 game/data/*.json，给每个文件建「格式指纹」基线
 *      （BOM / 缩进字符与宽度 / 换行符 LF·CRLF / 末尾是否换行 / 是否可逐字节还原）
 *   ② `--check`：拿当前磁盘比对基线，偏离就报「文件 + 期望 + 实际」
 *   ③ `--fix`：按基线把格式修回去
 *   ④ `--selftest`：在**沙盒副本**里注入故障自验（全程不碰 game/data）
 *
 * ⚠️ 命名守纪律：叫 `-guard.js` **不进回归**（收录规则 `^(smoke-.*|.*-check)\.js$`）。
 *    等稳定跑满两轮再谈改名 `-check.js` 进门禁的事。
 *
 * ⚠️ 两条从 66_mainline_act45.json 学到的、写死在本工具里的教训：
 *    1. **手写紧凑对象不能靠 stringify 还原**。66 里有
 *         "lock": { "flag": "pre_a4_dukou", "quest": "sq_pre_a4_dukou" },
 *       `JSON.stringify` 一律展开成多行。我先前 parse→改→stringify，把 1 行真改动
 *       埋进 1585 行噪声里。⇒ 本工具对**非 canonical** 文件只修 BOM/换行/尾换行，
 *       缩进不一致就**拒绝修**并说明原因（除非 --force）。
 *    2. **不报错不等于生效**。所以 canonical 文件走**逐字节**比对，缩进对了还不够，
 *       键顺序、转义差异也一并抓住。
 *
 * 用法：
 *   node tools/data-write-guard.js --check
 *   node tools/data-write-guard.js --fix
 *   node tools/data-write-guard.js --baseline          # 重建基线（有人合法改格式时用）
 *   node tools/data-write-guard.js --selftest          # 沙盒注入故障自验
 *   node tools/data-write-guard.js --check --root <dir> # 对任意目录跑（沙盒/自测用）
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const arg = n => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : '';
};
const has = n => process.argv.indexOf('--' + n) >= 0;

const DEFAULT_DATA = path.join(ROOT, 'game', 'data');
const BASELINE = path.join(__dirname, 'data-format-baseline.json');

/* ================================================================
 *  指纹：BOM / 缩进 / 换行符 / 末尾换行 / 是否逐字节可还原
 * ================================================================ */
function readRaw(p) {
  const buf = fs.readFileSync(p);
  const bom = buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF;
  /* ⚠️ text 保留 BOM（字节真相），raw 剥掉 BOM（用来 parse）。
     上一版只留了剥掉 BOM 的 raw，于是「文件被塞了 BOM」在 fix 时被判成「不用写」——
     BOM 就留在文件里了。canonical 比对也必须用 text，不能用 raw。 */
  const text = buf.toString('utf8');
  const raw = bom ? text.slice(1) : text;
  return { buf, text, raw, bom };
}

function indentOf(raw) {
  const m = raw.match(/\n([ \t]+)"[^"]*"\s*:/);
  if (!m) return { char: ' ', width: 0 };          // 单行 / 无缩进
  return { char: m[1][0] === '\t' ? '\t' : ' ', width: m[1].length };
}
function eolOf(raw) { return /\r\n/.test(raw) ? '\r\n' : '\n'; }
function trailingOf(raw) { return /\n$/.test(raw); }

/** 按给定指纹把对象序列化回「应有字节」 */
function serialize(obj, fp) {
  const body = JSON.stringify(obj, null, fp.width === 0 ? 0 : fp.char === '\t' ? '\t' : fp.width);
  const s = body.replace(/\n/g, fp.eol);
  return (fp.bom ? '﻿' : '') + s + (fp.trailing ? fp.eol : '');
}

function fingerprint(p) {
  const { text, raw, bom, buf } = readRaw(p);
  const ind = indentOf(raw);
  const eol = eolOf(raw);
  const trailing = trailingOf(raw);
  const fp = { bom, char: ind.char, width: ind.width, eol, trailing };
  let parsed = null, canonical = false, canonicalErr = '';
  try { parsed = JSON.parse(raw); } catch (e) { canonicalErr = 'JSON 解析失败：' + e.message; }
  if (parsed !== null) canonical = (serialize(parsed, fp) === text);
  return { fp, canonical, canonicalErr, raw, text, parsed, bytes: buf.length };
}

/* ================================================================
 *  check：比对
 * ================================================================ */
const FP_LABEL = { bom: 'BOM', width: '缩进宽度', char: '缩进字符', eol: '换行符', trailing: '末尾换行' };

/** --only <文件名>：只扫指定文件。用途：注入故障演练时把「坏数据存在」的窗口压到最短，
 *  也方便日常只核对自己刚改的那个文件，不用每次 parse 全部 53 个。 */
function pickFiles(base) {
  const only = arg('only');
  if (!only) return Object.keys(base.files).sort();
  const want = only.split(',').map(s => s.trim());
  return Object.keys(base.files).filter(f => want.includes(f)).sort();
}

function checkDir(dataDir, base) {
  const bad = [];
  const files = pickFiles(base);
  let scanned = 0;
  for (const f of files) {
    const p = path.join(dataDir, f);
    if (!fs.existsSync(p)) { bad.push({ f, items: [{ k: '文件', want: '存在', got: '缺失' }] }); continue; }
    scanned++;
    const cur = fingerprint(p);
    const b = base.files[f];
    const items = [];
    for (const k of ['bom', 'char', 'width', 'eol', 'trailing']) {
      if (cur.fp[k] !== b[k]) items.push({ k: FP_LABEL[k], want: fmt(b[k]), got: fmt(cur.fp[k]) });
    }
    if (cur.canonicalErr) items.push({ k: 'JSON', want: '可解析', got: cur.canonicalErr });
    else if (b.canonical) {
      /* ⚠️ 必须用**基线指纹**去序列化再比字节。用当前指纹比的话，文件被改成 null,2 之后
         它自己仍然自洽（serialize(当前指纹) === 当前字节），于是「逐字节还原」永远不报 ——
         上一版就栽在这里：注入 null,2 + 尾换行只报出缩进和尾换行，最强的那一条反而没报。 */
      const bfp = { bom: b.bom, char: b.char, width: b.width, eol: b.eol, trailing: b.trailing };
      if (serialize(cur.parsed, bfp) !== cur.text) {
        items.push({ k: '逐字节还原', want: '磁盘字节 == stringify(解析结果, 基线指纹)', got: '不一致（canonical 文件被改了）' });
      }
    }
    if (items.length) bad.push({ f, items, canonical: b.canonical });
  }
  return { bad, scanned, total: files.length };
}
const fmt = v => typeof v === 'boolean' ? (v ? '有' : '无') : (v === '\r\n' ? 'CRLF' : v === '\n' ? 'LF' : v === '\t' ? 'TAB' : String(v));

/* ================================================================
 *  fix：修回
 * ================================================================ */
function fixDir(dataDir, base, force) {
  const fixed = [], refused = [];
  for (const f of pickFiles(base)) {
    const p = path.join(dataDir, f);
    if (!fs.existsSync(p)) continue;
    const cur = fingerprint(p);
    const b = base.files[f];
    const structBad = ['bom', 'char', 'width', 'eol', 'trailing'].some(k => cur.fp[k] !== b[k]);

    /* canonical 文件：整份重排，字节级还原 */
    if (b.canonical) {
      let out;
      try { out = serialize(JSON.parse(cur.raw), { bom: b.bom, char: b.char, width: b.width, eol: b.eol, trailing: b.trailing }); }
      catch (e) { refused.push({ f, why: 'JSON 解析失败，不敢写：' + e.message }); continue; }
      if (out !== cur.text) { fs.writeFileSync(p, out, 'utf8'); fixed.push(f + '（canonical 整份重排）'); }
      continue;
    }

    /* 非 canonical（手写格式）：只修 BOM / 换行符 / 末尾换行 —— 这三样改了不伤内容 */
    if (!structBad) continue;
    const indentBad = cur.fp.width !== b.width || cur.fp.char !== b.char;
    if (indentBad && !force) {
      refused.push({ f, why: '缩进不一致（' + fmt(cur.fp.width) + ' vs 基线 ' + fmt(b.width) + '）—— 这文件是手写格式，'
        + 'stringify 会把紧凑内联对象展开成多行（66 号文件的教训：1 行真改动被埋进 1585 行噪声）。'
        + '要强修请加 --force，但请先确认你能接受整份重排。' });
      continue;
    }
    let s = cur.raw.replace(/\r\n/g, '\n');
    s = s.replace(/\n+$/, '');                                   // 先统一成无尾换行
    s = s.replace(/\n/g, b.eol);
    if (b.trailing) s += b.eol;
    if (b.bom && !s.startsWith('﻿')) s = '﻿' + s;
    if (!b.bom) s = s.replace(/^﻿/, '');
    if (indentBad && force) {
      try { s = serialize(JSON.parse(cur.raw), { bom: b.bom, char: b.char, width: b.width, eol: b.eol, trailing: b.trailing }); }
      catch (e) { refused.push({ f, why: '解析失败，未写' }); continue; }
    }
    if (s !== cur.text) { fs.writeFileSync(p, s, 'utf8'); fixed.push(f + '（仅修 BOM/换行符/尾换行）'); }
  }
  return { fixed, refused };
}

/* ================================================================
 *  baseline
 * ================================================================ */
function buildBaseline(dataDir) {
  const files = {};
  for (const f of fs.readdirSync(dataDir).filter(x => /\.json$/.test(x)).sort()) {
    const r = fingerprint(path.join(dataDir, f));
    files[f] = {
      bom: r.fp.bom, char: r.fp.char, width: r.fp.width, eol: r.fp.eol, trailing: r.fp.trailing,
      canonical: r.canonical, bytes: r.bytes,
    };
  }
  return {
    _meta: {
      generated: new Date().toISOString(),
      generator: 'tools/data-write-guard.js --baseline',
      note: '格式指纹基线。每个数据文件的既有写法（BOM/缩进/换行符/末尾换行/是否可逐字节还原）。'
        + 'canonical=true 的文件有逐字节断言，改格式会静默打红回归，务必保持。',
    },
    files,
  };
}

/* ================================================================
 *  ⑤ 自测：沙盒注入故障（全程不碰 game/data）
 * ================================================================ */
function selftest() {
  const os = require('os');
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'dwg-'));
  const src = DEFAULT_DATA;
  /* 挑 5 个覆盖全部 4 种组合的样本：1空格无尾换行 / 1空格有尾换行 / 2空格LF / 2空格CRLF / 手写非canonical */
  const SAMPLES = ['40_npcs.json', '42_sect_guards.json', '50_map.json', '94_brothel.json', '66_mainline_act45.json'];
  for (const f of SAMPLES) {
    if (fs.existsSync(path.join(src, f))) fs.copyFileSync(path.join(src, f), path.join(sb, f));
  }
  const base = buildBaseline(sb);
  const orig = {};
  for (const f of SAMPLES) orig[f] = fs.readFileSync(path.join(sb, f), 'utf8');

  let pass = 0, fail = 0;
  const T = (c, name, extra) => { if (c) { pass++; console.log('  ✔ ' + name); } else { fail++; console.log('  ✘ ' + name + (extra ? '\n      ' + extra : '')); } };

  console.log('沙盒：' + sb + '（样本 ' + SAMPLES.length + ' 个，覆盖 4 种格式组合）');

  /* 前提：样本确实覆盖了 4 种组合，否则下面是空跑 */
  const combos = new Set(SAMPLES.map(f => base.files[f] && (base.files[f].width + '|' + base.files[f].trailing + '|' + base.files[f].eol)));
  T(combos.size >= 4, '前提：样本覆盖 ≥4 种格式组合（got=' + combos.size + '）', [...combos].join(' , '));
  T(base.files['40_npcs.json'] && base.files['40_npcs.json'].canonical === true,
    '前提：40_npcs.json 在基线里标为 canonical（有逐字节断言）');
  T(base.files['66_mainline_act45.json'] && base.files['66_mainline_act45.json'].canonical === false,
    '前提：66_mainline_act45.json 在基线里标为**非** canonical（手写紧凑对象，stringify 还原不了）');

  /* 干净状态：check 应 0 偏离 */
  let r = checkDir(sb, base);
  T(r.bad.length === 0, '干净状态：--check 报 0 偏离（got=' + r.bad.length + '）');

  /* 注入故障 1：把 40_npcs.json 写成 null,2 + 尾换行（就是上轮我闯的那个祸） */
  fs.writeFileSync(path.join(sb, '40_npcs.json'), JSON.stringify(JSON.parse(orig['40_npcs.json']), null, 2) + '\n', 'utf8');
  r = checkDir(sb, base);
  const hit = r.bad.find(x => x.f === '40_npcs.json');
  T(!!hit, '故障1a 注入 null,2 + 尾换行 → --check 报红');
  T(!!hit && hit.items.some(i => i.k === '缩进宽度'), '故障1b 报出的项里含「缩进宽度」', hit && JSON.stringify(hit.items));
  T(!!hit && hit.items.some(i => i.k === '末尾换行'), '故障1c 报出的项里含「末尾换行」');
  T(!!hit && hit.items.some(i => i.k === '逐字节还原'), '故障1d 报出的项里含「逐字节还原」（canonical 文件走字节比对）');
  /* 对照：不该把没坏的文件也报出来 */
  T(r.bad.filter(x => x.f !== '40_npcs.json').length === 0, '故障1e 只报坏的那个，没误伤其它样本');

  /* fix 必须修回，且字节与原始完全一致 */
  const fr = fixDir(sb, base, false);
  const after = fs.readFileSync(path.join(sb, '40_npcs.json'), 'utf8');
  T(after === orig['40_npcs.json'], '故障2 --fix 后 40_npcs.json 与原始**逐字节一致**');
  T(fr.fixed.some(x => x.indexOf('canonical') >= 0), '故障2b --fix 走的是 canonical 整份重排路径');
  T(checkDir(sb, base).bad.length === 0, '故障2c --fix 后 --check 归零');

  /* 注入故障 3：BOM */
  fs.writeFileSync(path.join(sb, '50_map.json'), '﻿' + orig['50_map.json'], 'utf8');
  T(checkDir(sb, base).bad.some(x => x.f === '50_map.json'), '故障3a 注入 BOM → 报红');
  fixDir(sb, base, false);
  T(fs.readFileSync(path.join(sb, '50_map.json'), 'utf8') === orig['50_map.json'], '故障3b --fix 去掉 BOM 并还原');

  /* 注入故障 4：CRLF → LF（94_brothel 是 CRLF 文件） */
  fs.writeFileSync(path.join(sb, '94_brothel.json'), orig['94_brothel.json'].replace(/\r\n/g, '\n'), 'utf8');
  const r4 = checkDir(sb, base);
  T(r4.bad.some(x => x.f === '94_brothel.json' && x.items.some(i => i.k === '换行符')), '故障4a CRLF→LF → 报出「换行符」');
  fixDir(sb, base, false);
  T(fs.readFileSync(path.join(sb, '94_brothel.json'), 'utf8') === orig['94_brothel.json'], '故障4b --fix 把 CRLF 修回来');

  /* 注入故障 5：非 canonical 文件被 stringify 破坏 → 必须**拒绝**修缩进，不许悄悄重排 */
  fs.writeFileSync(path.join(sb, '66_mainline_act45.json'), JSON.stringify(JSON.parse(orig['66_mainline_act45.json']), null, 1), 'utf8');
  const r5 = checkDir(sb, base);
  T(r5.bad.some(x => x.f === '66_mainline_act45.json'), '故障5a 手写文件被 stringify 改坏 → 报红');
  const f5 = fixDir(sb, base, false);
  T(f5.refused.some(x => x.f === '66_mainline_act45.json'), '故障5b --fix **拒绝**改它的缩进（会毁掉手写紧凑对象）', JSON.stringify(f5.refused));
  T(fs.readFileSync(path.join(sb, '66_mainline_act45.json'), 'utf8') !== orig['66_mainline_act45.json'],
    '故障5c 拒绝修 = 文件保持原样（没被悄悄重排）');
  fs.writeFileSync(path.join(sb, '66_mainline_act45.json'), orig['66_mainline_act45.json'], 'utf8');

  /* 注入故障 6：坏 JSON 必须报出来，不许静默跳过 */
  fs.writeFileSync(path.join(sb, '42_sect_guards.json'), '{ "npcs": { 坏了', 'utf8');
  T(checkDir(sb, base).bad.some(x => x.f === '42_sect_guards.json'), '故障6 写入坏 JSON → 报错（不静默跳过）');
  fs.writeFileSync(path.join(sb, '42_sect_guards.json'), orig['42_sect_guards.json'], 'utf8');

  fs.rmSync(sb, { recursive: true, force: true });
  console.log('\n  自测结果：' + pass + '/' + (pass + fail) + ' 通过（沙盒已清理，game/data 全程未被写入）');
  return fail === 0;
}

/* ================================================================ */
function main() {
  const dataDir = arg('root') || DEFAULT_DATA;
  const isSb = !!arg('root');

  if (has('selftest')) { process.exit(selftest() ? 0 : 1); }

  if (has('baseline')) {
    const b = buildBaseline(dataDir);
    const out = isSb ? path.join(path.dirname(dataDir), '_baseline_tmp.json') : BASELINE;
    fs.writeFileSync(out, JSON.stringify(b, null, 2) + '\n', 'utf8');
    const canon = Object.values(b.files).filter(x => x.canonical).length;
    console.log('基线已写入 ' + path.relative(ROOT, out));
    console.log('  ' + Object.keys(b.files).length + ' 个文件 · 其中 canonical（有逐字节断言）' + canon + ' 个');
    const g = {};
    for (const [f, v] of Object.entries(b.files)) { const k = v.width + '空格|' + (v.trailing ? '尾换行' : '无尾换行') + '|' + (v.eol === '\r\n' ? 'CRLF' : 'LF'); (g[k] = g[k] || []).push(f); }
    for (const [k, v] of Object.entries(g)) console.log('  ×' + String(v.length).padStart(3) + '  ' + k);
    return;
  }

  if (!fs.existsSync(BASELINE)) { console.log('没有基线，先跑：node tools/data-write-guard.js --baseline'); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  if (has('check')) {
    const r = checkDir(dataDir, base);
    console.log('格式守卫 --check：扫 ' + r.scanned + '/' + r.total + ' 个文件');
    if (!r.bad.length) { console.log('  ✔ 全部与基线一致'); process.exit(0); }
    for (const b of r.bad) {
      console.log('\n  ✘ ' + b.f + (b.canonical ? '  【canonical：有逐字节断言】' : ''));
      for (const it of b.items) console.log('      ' + it.k + '：期望 ' + it.want + ' / 实际 ' + it.got);
    }
    console.log('\n  共 ' + r.bad.length + ' 个文件偏离基线。修：node tools/data-write-guard.js --fix');
    process.exit(1);
  }

  if (has('fix')) {
    const r = fixDir(dataDir, base, has('force'));
    r.fixed.forEach(x => console.log('  ✔ 已修 ' + x));
    r.refused.forEach(x => console.log('  ✘ 拒绝修 ' + x.f + '\n      ' + x.why));
    const after = checkDir(dataDir, base);
    console.log('\n  --fix 后 --check 仍有 ' + after.bad.length + ' 个文件偏离');
    process.exit(after.bad.length ? 1 : 0);
  }

  console.log('用法：--baseline / --check / --fix [--force] / --selftest [--root <dir>]');
}

/* 被 data-edit-cycle.js 复用时就别自己跑一遍 main */
if (require.main === module) main();
module.exports = { buildBaseline, checkDir, fixDir, fingerprint, serialize, readRaw, pickFiles, arg };
