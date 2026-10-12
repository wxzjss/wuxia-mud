/* smoke-hook-trigger.js — 画像钩子 trigger 引用完整性守卫
 *
 * 背景（2026-10-13）：33 个「后段画像钩子」的 trigger 引用了全库从未设置的 flag
 *   （名字写错，真实结局 flag 形如 <hook_id>_xxx），导致玩家做完前一件事后
 *   后段钩子永远解不开（恒显示「交情还不够」）。
 *
 * 本守卫断言：
 *   A. 每个 portrait.hooks[].trigger 里**正向引用**（未被 not 包裹）的 flag，
 *      必须能在全库「被设置过的 flag」集合里找到。
 *   B. 反例守卫：喂一个假的死 flag 进去，必须报红（防本脚本自身失效）。
 *   C. 明确列出「阶段递进」结构的白名单：not: {flag} 的负向条件不受限。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('  ✘ ' + m); } };

/* ── 1. 收集全库「被设置过的 flag」 ── */
const SET = new Set();
const RAWRE = /flag:([A-Za-z0-9_\u4e00-\u9fff]+)/g;

function scan(o) {
  if (o === null || o === undefined) return;
  if (Array.isArray(o)) { o.forEach(scan); return; }
  if (typeof o === 'object') {
    const t = o.type;
    if ((t === 'flag' || t === 'setflag') && ('args' in o || 'arg' in o)) {
      const a = o.args !== undefined ? o.args : o.arg;
      (Array.isArray(a) ? a : [a]).forEach(x => { if (typeof x === 'string') SET.add(x); });
    }
    Object.values(o).forEach(scan);
    return;
  }
  if (typeof o === 'string') {
    let m;
    RAWRE.lastIndex = 0;
    while ((m = RAWRE.exec(o))) SET.add(m[1]);
  }
}

const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json'));
const parsed = {};
for (const f of files) {
  try { parsed[f] = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); }
  catch (e) { parsed[f] = null; }
}
Object.values(parsed).forEach(d => scan(d));

ok(SET.size > 200, `真实 flag 集合过小(${SET.size})，扫描逻辑可能坏了`);

/* ── 2. 找所有 portrait hooks ── */
function collectHooks(o, out) {
  if (o === null || o === undefined) return;
  if (Array.isArray(o)) { o.forEach(x => collectHooks(x, out)); return; }
  if (typeof o === 'object') {
    if (o.trigger && typeof o.trigger === 'object' && o.id && o.title) out.push(o);
    Object.values(o).forEach(v => collectHooks(v, out));
  }
}

/** 取 trigger 里「正向引用」的 flag（not 包裹的不算） */
function positiveFlags(node, inNot, out) {
  if (node === null || node === undefined) return;
  if (Array.isArray(node)) { node.forEach(x => positiveFlags(x, inNot, out)); return; }
  if (typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'not') { positiveFlags(v, true, out); continue; }
    if (k === 'flag' && typeof v === 'string' && !inNot) { out.push(v); continue; }
    positiveFlags(v, inNot, out);
  }
}

const hooks = [];
Object.entries(parsed).forEach(([f, d]) => {
  const tmp = [];
  collectHooks(d, tmp);
  tmp.forEach(h => hooks.push({ file: f, h }));
});

ok(hooks.length >= 90, `画像钩子数量异常(${hooks.length})，应该 90+`);

/* ── 3. 断言：正向 flag 必须存在 ── */
const dead = [];
for (const { file, h } of hooks) {
  const pos = [];
  positiveFlags(h.trigger, false, pos);
  for (const f of pos) {
    if (!SET.has(f)) dead.push({ file, id: h.id, title: h.title, flag: f });
  }
}

ok(dead.length === 0,
  `有 ${dead.length} 个钩子的 trigger 引用了不存在的 flag（后段钩子会永远解不开）：\n` +
  dead.slice(0, 12).map(d => `      ${d.id} 【${d.title}】 → ${d.flag}`).join('\n'));

/* ── 4. 反例守卫：本检测器必须能抓出假的死 flag ── */
const fake = { id: 'hk_fake_guard', title: '假钩子', trigger: { and: [{ var: 'trust_x', op: '>=', value: 1 }, { flag: 'this_flag_never_exists_zzz' }] } };
const fakePos = [];
positiveFlags(fake.trigger, false, fakePos);
ok(fakePos.some(f => !SET.has(f)), '反例守卫失效：检测器抓不出假的死 flag');

/* ── 5. 阶段递进结构白名单：not:{flag} 的负向条件允许任意 ── */
const neg = [];
positiveFlags({ and: [{ not: { flag: 'some_unset_flag' } }] }, false, neg);
ok(neg.length === 0, '负向(not)条件被误判成正向引用');

console.log(`\nsmoke-hook-trigger: ${pass} 通过 / ${fail} 失败  (真实flag ${SET.size}，钩子 ${hooks.length})`);
process.exit(fail ? 1 : 0);
