/**
 * normalize-data-bytes.js —— 把我写坏的数据文件字节格式改回 HEAD 的约定
 *
 * 【我闯的祸】
 * 我的所有落地脚本统一写 `JSON.stringify(json, null, 1) + '\n'`。但仓库里的数据文件
 * **格式并不统一**：
 *   40_npcs.json / 96_portraits_a.json  → indent=1，末尾**无**换行
 *   66 / 77 / 86 / 87 / 91             → indent=2，末尾**有**换行
 * 后果有两层：
 *   ① 末尾多一个 \n → smoke-portrait-batch.js 的 0.5 / 3.4 / 3.7 三条「逐字节可还原」断言全红
 *      （判据就是 `JSON.stringify(N,null,1) === RAW`，多一个字节都不行）
 *   ② indent 写成 1 → 那 5 个 indent=2 的文件被我**整文件重排**，git diff 从几十行
 *      膨胀成几千行，评审时全是噪声，看不出真实内容改动
 *
 * 【本脚本做什么】
 * 从 `git show HEAD:<file>` 探测每个文件的 indent 与末尾换行约定，再用**工作区当前内容**
 * （含我的真实改动）按该约定重新序列化。只改格式，不动一个字的内容 —— 落地后用
 * `JSON.parse(旧) === JSON.parse(新)` 深比较逐条证明。
 *
 * 【不做】不碰别人改的文件（94_brothel.json 不是我改的，不在此列）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
/* HEAD 快照目录：由调用方先跑
     mkdir -p tools/_head_snapshot
     for f in <FILES>; do git show HEAD:game/data/$f > tools/_head_snapshot/$f; done
   再执行本脚本。不用 execSync 是因为沙箱里 spawn cmd.exe 会 EBUSY。 */
const SNAP = path.join(__dirname, '_head_snapshot');

const FILES = [
  '40_npcs.json',
  '66_mainline_act45.json',
  '77_npc_martial.json',
  '86_npc_neili.json',
  '87_persona.json',
  '91_npclife.json',
  '96_portraits_a.json',
];

/* ================================================================
 *  0 · 判定器自验（indent / 末尾换行 两个探测器）
 * ================================================================ */
/** 探测缩进：取第一个以空格开头的非空行，数前导空格 */
function detectIndent(text) {
  const m = String(text).match(/\n( +)"[^"]*"\s*:/);
  if (!m) return 0;
  return m[1].length;
}
/** 探测末尾换行：最后一个字节是不是 \n */
function detectTrailing(text) {
  return /\n$/.test(String(text));
}

function selfTest() {
  const cases = [
    ['{\n "a": 1\n}', 1, false, 'indent=1 · 无末尾换行'],
    ['{\n  "a": 1\n}', 2, false, 'indent=2 · 无末尾换行'],
    ['{\n   "a": 1\n}\n', 3, true, 'indent=3 · 有末尾换行'],
    ['{\n "a": {\n  "b": 2\n }\n}', 1, false, '嵌套时取**最外层**（第一个匹配）indent=1'],
    ['{}', 0, false, '空对象：indent=0 · 无末尾换行'],
  ];
  let pass = 0, fail = 0;
  for (const [text, wantIndent, wantTrail, note] of cases) {
    const gi = detectIndent(text), gt = detectTrailing(text);
    const okk = gi === wantIndent && gt === wantTrail;
    okk ? pass++ : fail++;
    console.log(`  ${okk ? '✔' : '✘'} ${note}  got indent=${gi} trailing=${gt}`);
  }
  console.log(`  判定器自验：${pass}/${pass + fail} 通过`);
  return fail === 0;
}

/* ================================================================ */
function headText(rel) {
  const p = path.join(SNAP, path.basename(rel));
  if (!fs.existsSync(p)) throw new Error('缺 HEAD 快照：' + p + '\n请先在仓库根跑：git show HEAD:' + rel + ' > tools/_head_snapshot/' + path.basename(rel));
  return fs.readFileSync(p, 'utf8');
}
/** 与 HEAD 快照逐字节对比，返回「不同的行数」——用来衡量格式噪声，替代 git diff --numstat */
function diffLines(rel) {
  const a = headText(rel).split('\n');
  const b = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
  let d = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d + '\t行不同';
}

function main() {
  console.log('===== 0 · 判定器自验 =====');
  if (!selfTest()) { console.log('自验未过，拒绝落地'); process.exit(1); }

  console.log('\n===== 1 · 探测 HEAD 约定 =====');
  const plan = [];
  for (const f of FILES) {
    const rel = 'game/data/' + f;
    const ht = headText(rel);
    plan.push({
      f, rel,
      indent: detectIndent(ht) || 1,
      trailing: detectTrailing(ht),
      headIndent: detectIndent(ht),
    });
    console.log(`  ${f.padEnd(24)} indent=${detectIndent(ht)}  末尾换行=${detectTrailing(ht)}`);
  }

  console.log('\n===== 2 · 改前 git diff 行数（+/−）=====');
  const before = {};
  for (const p of plan) { before[p.f] = diffLines(p.rel); console.log(`  ${p.f.padEnd(24)} ${before[p.f]}`); }

  console.log('\n===== 3 · 按 HEAD 约定重新序列化（只改格式）=====');
  for (const p of plan) {
    const abs = path.join(ROOT, p.rel);
    const beforeTxt = fs.readFileSync(abs, 'utf8');
    const json = JSON.parse(beforeTxt);
    let out = JSON.stringify(json, null, p.indent);
    if (p.trailing) out += '\n';
    if (out === beforeTxt) { console.log(`  = ${p.f.padEnd(24)} 已符合约定，不动`); continue; }
    fs.writeFileSync(abs, out, 'utf8');
    const after = fs.readFileSync(abs, 'utf8');
    const same = JSON.stringify(JSON.parse(beforeTxt)) === JSON.stringify(JSON.parse(after));
    console.log(`  ${same ? '✔' : '✘'} ${p.f.padEnd(24)} 已重写（内容深比较 ${same ? '一致' : '【变了，出事了】'}）`);
  }

  console.log('\n===== 4 · 改后 git diff 行数（+/−）=====');
  let shrunk = 0;
  for (const p of plan) {
    const after = diffLines(p.rel);
    const b = Number(before[p.f].split('\t')[0]), a = Number(after.split('\t')[0]);
    if (a < b) shrunk++;
    console.log(`  ${p.f.padEnd(24)} ${before[p.f]}  →  ${after}`);
  }
  console.log(`\n行数变少的文件：${shrunk} 个`);

  console.log('\n===== 5 · 复核：每个文件末尾字节 & indent =====');
  for (const p of plan) {
    const t = fs.readFileSync(path.join(ROOT, p.rel), 'utf8');
    const okk = detectIndent(t) === p.headIndent && detectTrailing(t) === p.trailing;
    console.log(`  ${okk ? '✔' : '✘'} ${p.f.padEnd(24)} indent=${detectIndent(t)} 末尾换行=${detectTrailing(t)}`);
  }
}

main();
