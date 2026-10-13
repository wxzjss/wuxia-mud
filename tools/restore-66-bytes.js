/**
 * restore-66-bytes.js —— 把 66_mainline_act45.json 从「整文件重排」救回「只改 1 行」
 *
 * 【为什么单开一个脚本】
 * 66_mainline_act45.json 是**手写格式**：里面有紧凑内联对象，例如
 *     "lock": { "flag": "pre_a4_dukou", "quest": "sq_pre_a4_dukou" },
 * 这种写法 `JSON.stringify` 永远还原不出来（它一律展开成多行）。
 * 我先前用 JSON.parse → 改 → stringify 重写了这个文件，结果：
 *     真实内容改动 = 1 条 rewardHint
 *     格式噪声     = 1585 行
 * 评审时 1585 行噪声会把那 1 行真改动彻底埋掉。
 *
 * 【本脚本做什么】
 * 拿 HEAD 的**原始字节**当底稿，只把那 1 条 rewardHint 精确替换掉，其余字节原样保留。
 * 全程不用 stringify。
 *
 * 【闸 B】
 *   ① 改前：底稿里必须存在待替换的精确字符串，且只出现 1 次
 *   ② 改后：真引擎 boot，打印实际字段值当断言
 *   ③ 语义对账：改后的文件 JSON.parse 后 == 我当前工作区版本的 JSON.parse（内容一个不丢）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data', '66_mainline_act45.json');
const SNAP = path.join(__dirname, '_head_snapshot', '66_mainline_act45.json');

const OLD = '+主线推进；呼应 ending「半交」';
const NEO = '那半页默写不出来的，正是他藏了半辈子的东西。';

/** 判定器自验：精确字符串计数（必须 ≥1 命中 / ≥1 不命中） */
function selfTest() {
  const base = fs.readFileSync(SNAP, 'utf8');
  const cases = [
    [base, OLD, 1, 'HEAD 底稿里 OLD 应恰好出现 1 次'],
    [base, NEO, 0, 'HEAD 底稿里 NEO 应出现 0 次（否则说明已经改过了）'],
    [base, '"lock": { "flag": "pre_a4_dukou"', 1, 'HEAD 底稿里应能找到手写紧凑对象（证明它确实不能靠 stringify 还原）'],
    [base, '这段绝对不存在的字符串xyzzy', 0, '不存在的串应计数 0'],
  ];
  let pass = 0, fail = 0;
  const count = (hay, needle) => hay.split(needle).length - 1;
  for (const [hay, needle, want, note] of cases) {
    const got = count(hay, needle);
    got === want ? pass++ : fail++;
    console.log(`  ${got === want ? '✔' : '✘'} ${note}  got=${got} want=${want}`);
  }
  console.log(`  判定器自验：${pass}/${pass + fail} 通过（命中 2 · 不命中 2）`);
  return fail === 0;
}

function main() {
  console.log('===== 0 · 判定器自验 =====');
  if (!selfTest()) { console.log('自验未过，拒绝落地'); process.exit(1); }

  const base = fs.readFileSync(SNAP, 'utf8');
  const current = fs.readFileSync(DATA, 'utf8');

  console.log('\n===== 1 · 语义对账底稿（先证明我当前版本的真实改动确实只有 1 条）=====');
  const semanticDiff = (a, b, p, out) => {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) semanticDiff(a[k], b[k], p + '.' + k, out);
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) { out.push(p + ' 长度 ' + a.length + '->' + b.length); return; }
      for (let i = 0; i < a.length; i++) semanticDiff(a[i], b[i], p + '[' + i + ']', out);
      return;
    }
    out.push(p + ': ' + JSON.stringify(a) + ' -> ' + JSON.stringify(b));
  };
  const d = [];
  semanticDiff(JSON.parse(base), JSON.parse(current), '', d);
  console.log('  HEAD → 当前工作区 的语义差异 = ' + d.length + ' 条');
  d.forEach(x => console.log('    ' + x.slice(0, 140)));
  if (d.length !== 1) { console.log('差异不是 1 条 —— 说明还有别的内容改动，不盲目复原'); process.exit(1); }

  console.log('\n===== 2 · 精确替换（底稿原始字节，只动 1 处）=====');
  const out = base.replace(OLD, NEO);
  if (out === base) { console.log('替换未生效'); process.exit(1); }
  console.log('  字节数 ' + base.length + ' → ' + out.length);

  console.log('\n===== 3 · 落盘前后：与「当前工作区」做内容深比较（证明没丢改动）=====');
  const same = JSON.stringify(JSON.parse(out)) === JSON.stringify(JSON.parse(current));
  console.log('  ' + (same ? '✔' : '✘') + ' 内容深比较 ' + (same ? '一致（1 条改动完整保留）' : '【不一致，出事了】'));
  if (!same) process.exit(1);
  fs.writeFileSync(DATA, out, 'utf8');
  console.log('  已写入 ' + path.relative(ROOT, DATA));

  console.log('\n===== 4 · 闸 B②：真引擎 boot，打印实际字段值 =====');
  const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
  const e = new GameEngine({ seed: 20261010 });
  e.boot();
  const h = (((e.world.data.npcs || {}).ren_woxing || {}).portrait || {}).hooks || [];
  const got = (h[0] || {}).rewardHint;
  const okk = got === NEO;
  console.log(`  ${okk ? '✔' : '✘'} 引擎实读 ren_woxing.portrait.hooks[0].rewardHint = 「${got}」`);
  process.exit(okk ? 0 : 1);
}

main();
