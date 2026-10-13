/**
 * land-redline-fix.js —— 修掉我自己的 rewardHint 改写撞上的两条画像红线
 *
 * 【背景·必须写清楚，否则后来者会以为红线在乱报】
 * 我（严过关）把 99 条 rewardHint 从「+money 400；+karma 10」改成了白话。
 * 但 rewardHint 位于 `portrait.hooks[].rewardHint` —— **它在 portrait 里面**。
 * 而 tools/smoke-portrait-batch.js 的两条红线扫的是整串 `JSON.stringify(portrait)`：
 *   4.1 女性 NPC 画像不含「汉子/他/爷们/兄弟」
 *   4.6 无禁用现代词（gen-portraits.js 的 BANNED 表）
 * 于是我的新文案里「他」指**第三人**（压下来，他就一直背着 —— 他 = 背锅的人，
 * 不是这位女性 NPC 自称）、「有问题」里的「问题」在 BANNED 表内，双双撞线。
 *
 * 【定性】
 * 红线 4.1 的判据本身偏粗（全串匹配「他」，不区分自称与第三人称）—— 那是**别人的量具**，
 * 我不改。但门禁在我动手之前是绿的，是我把它撞红的，所以我**改文案**，不去申诉量具。
 * 4.6 的「问题」确在 BANNED 表内，属实撞线，改文案。
 *
 * 【不改的】
 * npcv_081（问题）/ depot_shadow（机会·确认）在 HEAD 里就带这些词，且不在 BATCH 26 内，
 * 不是我引入的 —— 本脚本不动它们。
 *
 * 【闸 B】
 *   ① 改前：精确字符串存在性校验
 *   ② 改后：真引擎 boot，打印实际字段值当断言
 *   ③ 改前/改后红线计数对比（由调用方跑 smoke-portrait-batch.js）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data', '40_npcs.json');
const gen = require(path.join(ROOT, 'tools', 'gen-portraits.js'));

/* ================================================================
 *  0 · 判定器自验（铁律：判定工具先自验，才许对他人下结论）
 * ================================================================ */
const BAD = /[+*]|[A-Za-z]{2,}|[0-9]/;              // 不许有算式/拉丁/数字
const hasBanned = t => gen.BANNED.filter(w => String(t).includes(w));
const hasMalePronoun = t => /他/.test(String(t));

function selfTest() {
  const samples = [
    // [文本, 期望是否命中, 说明]
    ['妹妹那碗药有问题，瞒着是一说，说破是另一说。', true, '命中 BANNED「问题」'],
    ['妹妹那碗药不对劲，瞒着是一说，说破是另一说。', false, '改后文案，应干净'],
    ['压下来，他就一直背着。', true, '命中「他」'],
    ['压下去，这笔账就得一直背着。', false, '改后文案，应干净'],
    ['+money 400；+karma 10', true, '命中 BAD（算式+数字）'],
    ['那一页还回去，樊湘的案就能翻。', false, '正常白话，应干净'],
  ];
  let pass = 0, fail = 0;
  const hit = t => hasBanned(t).length > 0 || hasMalePronoun(t) || BAD.test(t);
  for (const [text, want, note] of samples) {
    const got = hit(text);
    if (got === want) { pass++; console.log('  ✔ [' + (want ? '应命中' : '应干净') + '] ' + note); }
    else { fail++; console.log('  ✘ [' + (want ? '应命中' : '应干净') + '] ' + note + ' —— 实际 got=' + got +
      (hasBanned(text).length ? ' BANNED=' + hasBanned(text).join('/') : '') +
      (hasMalePronoun(text) ? ' 含他' : '') + (BAD.test(text) ? ' BAD' : '')); }
  }
  console.log(`  判定器自验：${pass}/${pass + fail} 通过（命中样本 3 · 干净样本 3）`);
  return fail === 0;
}

/* ================================================================
 *  1 · 四条改写
 * ================================================================ */
const FIXES = [
  {
    id: 'npcv_036',
    old: '那一页还回去，樊湘的案就能翻；压下来，他就一直背着。',
    neo: '那一页还回去，樊湘的案就能翻；压下去，这笔账就得一直背着。',
    why: '「他」指背锅的第三人，但 4.1 全串匹配，撞线 → 换成「这笔账」',
  },
  {
    id: 'npcv_208',
    old: '替她说服船户靠岸，或煽着他们抗抽头，两头都是路。',
    neo: '替她说服船户靠岸，或煽着一伙人抗抽头，两头都是路。',
    why: '「他们」含「他」 → 换成「一伙人」',
  },
  {
    id: 'npcv_215',
    old: '孟明亡母那笔钱，说不说给他听，由你定。',
    neo: '孟明亡母那笔钱，说与不说，由你定。',
    why: '「给他听」含「他」 → 去掉对象',
  },
  {
    id: 'npcv_090',
    old: '妹妹那碗药有问题，瞒着是一说，说破是另一说。',
    neo: '妹妹那碗药不对劲，瞒着是一说，说破是另一说。',
    why: '「问题」在 BANNED 表内 → 换「不对劲」',
  },
];

function main() {
  console.log('===== 0 · 判定器自验 =====');
  if (!selfTest()) { console.log('自验未过，拒绝落地'); process.exit(1); }

  const raw = fs.readFileSync(DATA, 'utf8');
  const json = JSON.parse(raw);
  const N = json.npcs;

  console.log('\n===== 1 · 改前校验（精确字符串必须存在）=====');
  let preOk = true;
  for (const f of FIXES) {
    const hs = ((N[f.id] && N[f.id].portrait && N[f.id].portrait.hooks) || []).map(x => x.rewardHint).filter(Boolean);
    const found = hs.includes(f.old);
    if (!found) preOk = false;
    console.log(`  ${found ? '✔' : '✘'} ${f.id} 原文存在`);
  }
  if (!preOk) { console.log('改前校验未过，拒绝落地'); process.exit(1); }

  console.log('\n===== 2 · 新文案硬校验 =====');
  let neoOk = true;
  for (const f of FIXES) {
    const b = hasBanned(f.neo), p = hasMalePronoun(f.neo), d = BAD.test(f.neo);
    const clean = !b.length && !p && !d;
    if (!clean) neoOk = false;
    console.log(`  ${clean ? '✔' : '✘'} ${f.id} 「${f.neo}」` +
      (clean ? '  ' + f.why : `  BANNED=${b.join('/')} 含他=${p} BAD=${d}`));
  }
  if (!neoOk) { console.log('新文案未过硬校验，拒绝落地'); process.exit(1); }

  console.log('\n===== 3 · 落地（JSON.parse → 替换 → stringify，绝不文本替换）=====');
  let n = 0;
  for (const f of FIXES) {
    let done = false;
    for (const h of ((N[f.id].portrait && N[f.id].portrait.hooks) || [])) {
      if (h.rewardHint === f.old) { h.rewardHint = f.neo; done = true; n++; }
    }
    console.log(`  ${done ? '✔' : '✘'} ${f.id} 已替换`);
  }
  // 40_npcs.json 的 HEAD 字节约定：indent=1，末尾**无**换行（见 normalize-data-bytes.js）
  fs.writeFileSync(DATA, JSON.stringify(json, null, 1), 'utf8');
  console.log(`  写入 ${path.relative(ROOT, DATA)}，共改 ${n} 条`);

  console.log('\n===== 4 · 闸 B②：真引擎 boot，打印实际字段值 =====');
  const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  const W = e.world.data.npcs;
  let bootOk = true;
  for (const f of FIXES) {
    const hs = ((W[f.id] && W[f.id].portrait && W[f.id].portrait.hooks) || []).map(x => x.rewardHint).filter(Boolean);
    const got = hs.includes(f.neo);
    const stillOld = hs.includes(f.old);
    if (!got || stillOld) bootOk = false;
    console.log(`  ${got && !stillOld ? '✔' : '✘'} ${f.id} 引擎实读 = 「${hs.find(h => h === f.neo || h === f.old) || '(未找到)'}」`);
  }
  console.log(bootOk ? '\n闸 B② 通过：4 条在真引擎里读到的就是新文案' : '\n闸 B② 未过');
  process.exit(bootOk ? 0 : 1);
}

main();
