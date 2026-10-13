#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-lines-gen.js —— 从 design/75 §1.8 生成 combat-lines.js
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本：
 *    句库有**两个落点**：文档 `design/75` §1.8（游有方写的，源头）和
 *    `game/src/renderer/js/combat-lines.js`（运行时真正加载的）。
 *    两者必须逐字节一致，否则"文档改了、游戏里还是旧的"，或者反过来
 *    "手改了 js、下次重生成又被冲掉"。
 *
 *    上一版是我用 `sed -n '207,696p'` 手工抠的 —— **行号写死在一条命令里**。
 *    文档前面加一段话，行号全漂，下次重生成就是一场静默灾难。
 *
 *  ⇒ 这个脚本把「怎么从文档里抠出那段代码块」固化下来，并且
 *    **只此一份**：守卫 `combat-lines-check.js` 不再自己写一遍定位逻辑，
 *    改成 `require` 这里的 `extract()`。
 *    定位口径按**章节标题**往后找第一个 ```js 块，行号漂了也不受影响。
 *
 *  用法：node tools/combat-lines-gen.js          （生成并落盘双副本）
 *        node tools/combat-lines-gen.js --check  （只比对，不写盘）
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const DOC = path.join(ROOT, 'design', '75-combat-lines-and-handpieces.md');
const OUT_SRC = path.join(ROOT, 'game', 'src', 'renderer', 'js', 'combat-lines.js');
const OUT_MIRROR = path.join(ROOT, 'server', 'public', 'js', 'combat-lines.js');

/**
 * 从文档里抠出 §1.8 的代码块正文。
 * @returns {{block:string, h18:number, title:string, openAt:number, closeAt:number, docLines:string[]}}
 *          block 为 null 表示没定位到（守卫会把这个当失败，不该静默跳过）。
 */
function extract() {
  const docTxt = fs.readFileSync(DOC, 'utf8');
  const docLines = docTxt.split(/\r?\n/);

  /* 定位不用行号（行号会漂），用章节标题往后找第一个 ``` 块。 */
  const h18 = docLines.findIndex((l) => /^###\s*1\.8\s/.test(l));
  if (h18 < 0) {
    return { block: null, h18, title: '', openAt: -1, closeAt: -1, docLines };
  }

  let openAt = -1, closeAt = -1;
  for (let i = h18; i < docLines.length; i++) {
    if (/^```/.test(docLines[i])) {
      if (openAt < 0) openAt = i; else { closeAt = i; break; }
    }
  }
  if (openAt < 0 || closeAt <= openAt) {
    return { block: null, h18, title: docLines[h18], openAt, closeAt, docLines };
  }

  return {
    block: docLines.slice(openAt + 1, closeAt).join('\n') + '\n',
    h18, title: docLines[h18], openAt, closeAt, docLines,
  };
}

module.exports = { extract, DOC, OUT_SRC, OUT_MIRROR };

function md5(s) {
  return require('crypto').createHash('md5').update(s, 'utf8').digest('hex');
}

/* ================================================================ */
if (require.main === module) {
  const checkOnly = process.argv.includes('--check');
  const ex = extract();
  if (!ex.block) {
    console.error('✘ 没从 design/75 里定位到 §1.8 的代码块，拒绝生成。');
    process.exit(1);
  }

  const want = ex.block;
  const have = fs.existsSync(OUT_SRC) ? fs.readFileSync(OUT_SRC, 'utf8') : null;
  console.log('文档 §1.8 代码块：' + md5(want).slice(0, 8) + ' · ' + want.split('\n').length + ' 行');
  console.log('  定位：' + (ex.openAt + 1) + '–' + ex.closeAt + ' 行（按标题找，不是写死行号）');
  console.log('现有 js      ：' + (have === null ? '(不存在)' : md5(have).slice(0, 8)));

  if (have === want) {
    console.log('\n✔ 已经一致，无需生成。');
    process.exit(0);
  }
  if (checkOnly) {
    console.log('\n✘ 不一致（--check 模式不写盘）。');
    process.exit(1);
  }

  fs.writeFileSync(OUT_SRC, want, 'utf8');
  fs.writeFileSync(OUT_MIRROR, want, 'utf8');
  console.log('\n✔ 已落盘（双副本）：');
  console.log('  · ' + path.relative(ROOT, OUT_SRC));
  console.log('  · ' + path.relative(ROOT, OUT_MIRROR));
  console.log('\n⚠️ 下一步：把 index.html 的 8 处 ?v= 一起推进（否则玩家拿到缓存里的旧句库）。');
}
