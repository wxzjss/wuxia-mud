'use strict';
/* _mut-apply.js —— 变异自证的「改一处 / 还原」小工具（配合 bash 串联跑）
 *
 * 用法：
 *   node tools/_mut-apply.js apply  <file> <oldLiteral> <newLiteral>
 *   node tools/_mut-apply.js snap   <file>          （把当前内容存进 tools/_snap/）
 *   node tools/_mut-apply.js restore <file>         （从 tools/_snap/ 逐字节还原）
 *
 * ⚠️ 为什么不在一个 node 进程里 spawnSync 跑测试：
 *    沙箱里脚本内起子进程会 EBUSY。所以「改文件」「跑用例」「还原」必须是
 *    **三个独立进程**，由 bash 串起来（本项目血泪：绕不过去就别绕）。
 * ⚠️ apply 找不到锚点时会**非零退出**，绝不允许「变异没生效但测试照样绿」——
 *    那是假自证（本项目踩过：变异打在数据不走的分支上）。
 */
const fs = require('fs');
const path = require('path');

const SNAP = path.join(__dirname, '_snap');
const [mode, file, oldS, newS] = process.argv.slice(2);
if (!mode || !file) { console.error('usage: _mut-apply.js apply|snap|restore <file> [old] [new]'); process.exit(2); }

function ensureSnap() { if (!fs.existsSync(SNAP)) fs.mkdirSync(SNAP, { recursive: true }); }
const snapPath = f => path.join(SNAP, path.basename(f) + '.orig');

if (mode === 'snap') {
  ensureSnap();
  fs.copyFileSync(file, snapPath(file));
  console.log('snapped ' + file);
} else if (mode === 'restore') {
  if (!fs.existsSync(snapPath(file))) { console.error('no snapshot for ' + file); process.exit(2); }
  fs.copyFileSync(snapPath(file), file);
  console.log('restored ' + file);
} else if (mode === 'apply') {
  const t = fs.readFileSync(file, 'utf8');
  if (t.indexOf(oldS) < 0) { console.error('MUT-NOT-FOUND in ' + file + ': ' + oldS.slice(0, 50)); process.exit(3); }
  fs.writeFileSync(file, t.split(oldS).join(newS));
  console.log('applied on ' + file);
} else { console.error('unknown mode ' + mode); process.exit(2); }
