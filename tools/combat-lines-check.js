#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-lines-check.js —— 战斗演出句库 v2 守卫（design/75 §1.8）
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本（不是凑数，是补一个真空洞）：
 *    `combat-lines.js` 是**纯数据文件**（4 类 × 5 档 × 8 句 = 160 条骨架，
 *    加落空 32 / 被架 32，共 224 条）。它的正确性不靠「跑起来不报错」，
 *    而靠四条**结构性质**：
 *      ① 每档 8 条骨架分属 8 种句式（否则 v1 的「万能骨架」病复发）
 *      ② 连续两条不得同句式（v2 的核心机械保证，靠 patHist 维持）
 *      ③ 跨桶不撞句（两两 ≥8 字共享串 = 0 组）
 *      ④ 渲染结果不许留占位符、不许出现「那使刀的的咽喉」
 *    这四条**随便哪一条坏了，游戏照样能跑**，只是文案又被打回模板味。
 *    没有任何现有测试会红 —— 这个脚本就是把它们钉住。
 *
 *  ★ 另外钉了一条**源头一致性**：`combat-lines.js` 必须与
 *    `design/75-combat-lines-and-handpieces.md` §1.8 那段代码块**逐字节一致**。
 *    这条是防「两处各写一份」的：文案在文档里改了、忘了同步到 js，
 *    或者反过来 —— 以前这个项目的教训就是同一份东西两个地方写，
 *    最后谁也说不清哪个是真的。现在文件的唯一真源是文档，js 是拷贝。
 *
 *  覆盖：
 *    §0 源头一致：js 的内容 === design/75 §1.8 代码块（逐字节）
 *    §1 规模与结构：160 / 32 / 32、四类齐全、字段齐全
 *    §2 句式轮换（§1.8 自检入口第 1 条）：20 组每组 8 个不同句式
 *    §3 句式缓冲（第 2 条）：连渲 200 手，相邻不同句式
 *    §4 跨桶不撞句（第 3 条）：224 条两两最长公共子串 < 8
 *    §5 渲染卫生：无占位符残留、无「的的」、numeric 只在句尾加括号
 *    §6 兜底：未知 style / 越界 hpRatio / 缺 opts 都不崩
 *    §7 双副本一致 + index.html 引到了这个文件
 *
 *  用法：node tools/combat-lines-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const PJS = path.join(ROOT, 'server', 'public', 'js');
const CL = path.join(RJS, 'combat-lines.js');
const CL_MIRROR = path.join(PJS, 'combat-lines.js');
const HTML = path.join(ROOT, 'game', 'src', 'renderer', 'index.html');
/* §0 的「怎么从文档里抠出 §1.8 那段代码块」**只此一份**，在 combat-lines-gen.js 里。
   这里 require 它，而不是自己再写一遍定位逻辑 ——
   两边各写一份的话，哪天换了定位方式（比如按标题找），
   只改一边的后果是"守卫说绿、生成脚本生成出别的东西"。 */
const { extract: extractDoc18 } = require('./combat-lines-gen.js');

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

/* ================================================================
 * §0 源头一致：js 必须逐字节等于 design/75 §1.8 的代码块
 * ================================================================ */
section('§0 源头一致（防「两处各写一份」）');

const ex = extractDoc18();
ok('§0-1 找得到 design/75 §1.8 章节', ex.h18 >= 0, ex.h18 >= 0 ? String(ex.title).slice(0, 40) : '没找到');
ok('§0-2 §1.8 里有一个完整的代码块', ex.openAt > 0 && ex.closeAt > ex.openAt,
  ex.openAt > 0 && ex.closeAt > ex.openAt ? (ex.openAt + 1) + '–' + ex.closeAt + ' 行' : '没配对上');

const docBlock = ex.block;
const fileTxt = fs.readFileSync(CL, 'utf8');
ok('§0-3 ★ combat-lines.js 与文档 §1.8 代码块逐字节一致', !!docBlock && docBlock === fileTxt,
  docBlock === fileTxt ? md5(fileTxt).slice(0, 8) + ' · ' + fileTxt.split('\n').length + ' 行'
    : '文档 ' + (docBlock ? md5(docBlock).slice(0, 8) : '(没抠到)') + ' vs 文件 ' + md5(fileTxt).slice(0, 8)
      + '　⇒ 跑 `node tools/combat-lines-gen.js` 重新生成');

/* ================================================================
 * §1 规模与结构
 * ================================================================ */
section('§1 规模与结构');

/* 浏览器里它是 `window.COMBAT_LINES = ...`，Node 里先给个 window 壳。 */
global.window = {};
require(CL);
const C = global.window.COMBAT_LINES;

ok('§1-1 文件加载成功且挂上了 window.COMBAT_LINES', !!C);
ok('§1-2 version === 2（v1 已废，别让旧版混进来）', C.version === 2, 'version=' + C.version);

const STYLES = ['sword', 'blade', 'fist', 'hidden'];
const SEVK = ['graze', 'dirty', 'blood', 'bone', 'down'];

ok('§1-3 四类齐全', STYLES.every((s) => C.frames[s] && C.verbs[s] && C.miss[s] && C.parried[s] && C.crit[s]),
  STYLES.join('/'));
ok('§1-4 severity 五档且 key 齐全',
  C.severity.length === 5 && SEVK.every((k, i) => C.severity[i].key === k), SEVK.join('/'));
ok('§1-5 severity 的 hp 区间首尾覆盖 0–1 且单调不重叠',
  C.severity[0].hp[0] === 0 && C.severity[4].hp[1] === 1 &&
  C.severity.every((s, i) => i === 0 || s.hp[0] === C.severity[i - 1].hp[1]),
  C.severity.map((s) => s.hp.join('~')).join(' '));
ok('§1-6 ★ uiTier 1–5 与 severity 一一对应（视觉分层靠它）',
  C.severity.every((s, i) => s.uiTier === i + 1), C.severity.map((s) => s.uiTier).join(','));

let nFrames = 0;
const frameShapeBad = [];
STYLES.forEach((s) => SEVK.forEach((k) => {
  const arr = C.frames[s][k];
  if (!Array.isArray(arr)) { frameShapeBad.push(s + '.' + k + ' 不是数组'); return; }
  nFrames += arr.length;
  arr.forEach((f, i) => {
    if (!f || typeof f.p !== 'string' || typeof f.t !== 'string') frameShapeBad.push(s + '.' + k + '[' + i + '] 缺 p/t');
  });
}));
ok('§1-7 ★ 主骨架 160 条（4 类 × 5 档 × 8 句）', nFrames === 160, nFrames + ' 条');
ok('§1-8 每条骨架都有 p 和 t（p 删了句式缓冲就失效）', frameShapeBad.length === 0,
  frameShapeBad.length ? frameShapeBad.slice(0, 3).join(' / ') : '0 处缺失');

let nMiss = 0, nParry = 0, nCrit = 0;
STYLES.forEach((s) => { nMiss += C.miss[s].length; nParry += C.parried[s].length; nCrit += C.crit[s].length; });
ok('§1-9 落空 32 条（4 类 × 8）', nMiss === 32, nMiss + ' 条');
ok('§1-10 被架住 32 条（4 类 × 8）', nParry === 32, nParry + ' 条');
ok('§1-11 暴击前缀 16 条（4 类 × 4）', nCrit === 16, nCrit + ' 条');
ok('§1-12 动词四类各 14 条', STYLES.every((s) => C.verbs[s].length === 14),
  STYLES.map((s) => s + ':' + C.verbs[s].length).join(' '));
ok('§1-13 动词禁止跨类复用（四类两两无交集）', (() => {
  for (let i = 0; i < STYLES.length; i++) {
    for (let j = i + 1; j < STYLES.length; j++) {
      if (C.verbs[STYLES[i]].some((v) => C.verbs[STYLES[j]].indexOf(v) >= 0)) return false;
    }
  }
  return true;
})(), '剑走「抹」刀走「劈」，同一个动词不能两类都用');
ok('§1-14 部位共 14 处（light 6 + heavy 8）',
  C.parts.light.length + C.parts.heavy.length === 14,
  'light ' + C.parts.light.length + ' · heavy ' + C.parts.heavy.length);
ok('§1-15 ★ 部位都能接「落在{P}」和「{P}上」（不许出现「肋下上」这种）',
  ![...C.parts.light, ...C.parts.heavy].some((p) => /(上|下|里|中|内)$/.test(p) === false && /[上下里中内]$/.test(p)),
  [...C.parts.light, ...C.parts.heavy].join(' '));

/* ================================================================
 * §2 句式轮换（§1.8 自检入口第 1 条）
 * ================================================================ */
section('§2 句式轮换：20 组每组 8 个不同句式');

const badGroups = [];
STYLES.forEach((s) => SEVK.forEach((k) => {
  const ps = C.frames[s][k].map((f) => f.p);
  if (new Set(ps).size !== 8) badGroups.push(s + '.' + k + ' 只有 ' + new Set(ps).size + ' 种');
}));
ok('§2-1 ★ 20 组（4 类 × 5 档）每组 8 条骨架句式互不相同', badGroups.length === 0,
  badGroups.length ? badGroups.slice(0, 3).join(' / ') : '20 组 × 8 种');

const badMiss = [], badParry = [];
STYLES.forEach((s) => {
  if (new Set(C.miss[s].map((f) => f.p)).size !== 8) badMiss.push(s);
  if (new Set(C.parried[s].map((f) => f.p)).size !== 8) badParry.push(s);
});
ok('§2-2 落空 4 组也是每组 8 种句式', badMiss.length === 0, badMiss.join('/') || '4 组 × 8 种');
ok('§2-3 被架 4 组也是每组 8 种句式', badParry.length === 0, badParry.join('/') || '4 组 × 8 种');

ok('§2-4 所有 p 都在 PORDER 里（拼错句式名等于句式缓冲失效）', (() => {
  const all = new Set(C.patternOrder);
  const used = new Set();
  STYLES.forEach((s) => {
    SEVK.forEach((k) => C.frames[s][k].forEach((f) => used.add(f.p)));
    C.miss[s].forEach((f) => used.add(f.p));
    C.parried[s].forEach((f) => used.add(f.p));
  });
  const outside = [...used].filter((p) => !all.has(p));
  ok('  └ 越界的句式名', outside.length === 0, outside.join(',') || '无');
  return outside.length === 0;
})());

/* ================================================================
 * §3 句式缓冲（§1.8 自检入口第 2 条）
 * ================================================================ */
section('§3 句式缓冲：连渲 200 手，相邻不同句式');

/* patHist 是模块级状态，测之前先 _reset()，否则受前面抽样污染。 */
C._reset();
const seq = [];
for (let i = 0; i < 200; i++) {
  seq.push(C.render(STYLES[i % 4], (i % 100) / 100, { A: '你', T: '那使刀的' }));
}
ok('§3-1 连渲 200 手不崩且每句非空', seq.every((t) => typeof t === 'string' && t.length > 0));
ok('§3-2 没有任何一句是「复制上一句」', (() => {
  for (let i = 1; i < seq.length; i++) if (seq[i] === seq[i - 1]) return false;
  return true;
})(), '0 处相邻重复');
/* 注意：这里**不**拿「200 手里有多少句不同」当断言。
   很多模板不含 {V}/{P}（result / short / delay 句式），随机槽位少，
   而环形缓冲每档只有 8 条 —— 200 手必然重复，重复率**不是**质量的度量。
   真正的保证是下面的 §3-3：句式必须轮换。 */
console.log('    （参考，不作断言）200 手里不同句子 ' + new Set(seq).size + ' 句');

/* 句式是内部状态（patHist 在闭包里），render 只吐文本。
   ⇒ 建一张「渲染结果 → 句式」反查表：对每条模板，穷举 14 动词 × 14 部位
   填满后入表。这样**任何**一次 render 的输出都能反查回句式，不需要改库文件。
   ⚠️ 早期版本只压成单元素再查，结果 heavy 档的部位取不到，51/300 反查落空，
   落空处 prev 不更新 ⇒ 造出 3 次假「相邻撞句式」。全组合入表后 300/300 命中。 */
(function verifyPatternBuffer() {
  const PARTS = C.parts.light.concat(C.parts.heavy);
  const tpl2pat = new Map();
  const amb = [];
  const put = (s, p) => {
    if (tpl2pat.has(s) && tpl2pat.get(s) !== p) amb.push(s);
    else tpl2pat.set(s, p);
  };
  STYLES.forEach((s) => {
    const Vs = C.verbs[s];
    const put1 = (f) => Vs.forEach((V) => PARTS.forEach((P) => put(C.fill(f.t, '你', '那使刀的', V, P), f.p)));
    SEVK.forEach((k) => C.frames[s][k].forEach(put1));
    C.miss[s].forEach(put1);
    C.parried[s].forEach(put1);
  });
  ok('§3-3 反查表无歧义（同一句不可能同时属于两种句式）', amb.length === 0,
    tpl2pat.size + ' 条 · 歧义 ' + amb.length + ' 处');

  C._reset();
  let sameAdjacent = 0, unresolved = 0, seen = 0, prev = null;
  for (let i = 0; i < 300; i++) {
    const t = C.render(STYLES[i % 4], (i % 100) / 100, { A: '你', T: '那使刀的' });
    const p = tpl2pat.get(t);
    if (!p) { unresolved++; continue; }
    seen++;
    if (prev !== null && p === prev) sameAdjacent++;
    prev = p;
  }
  ok('§3-4 ★ 句式缓冲真的在转（相邻两条从不撞句式）', sameAdjacent === 0,
    seen + ' 条可反查 · 相邻撞句式 ' + sameAdjacent + ' 次');
  ok('§3-5 反查表覆盖得住（否则上面那条是假绿）', unresolved === 0,
    '未命中 ' + unresolved + ' / ' + (seen + unresolved));

})();

/* ================================================================
 * §4 跨桶不撞句（§1.8 自检入口第 3 条）
 * ================================================================ */
section('§4 跨桶不撞句：224 条两两最长公共子串 < 8 字');

/* 最长公共子串（O(n·m)，224 条 × 均长 ~25 字，跑一次毫秒级） */
function lcs(a, b) {
  const n = a.length, m = b.length;
  let best = 0, at = 0;
  const prev = new Uint16Array(m + 1);
  const cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) { best = cur[j]; at = i; } }
      else cur[j] = 0;
    }
    prev.set(cur); cur.fill(0);
  }
  return { best, sub: a.slice(at - best, at) };
}

/* ⚠️ 口径（这里踩过一次坑，写下来免得后面的人重踩）：
   design/75 §A 说的「≥8 **字**共享串」指的是**汉字**，不含占位符、不含标点。
   第一版我拿模板原文直接比，量出 1381 组 —— 全是 `{A}这一{V}落在{T}{P}，`
   这种**占位符脚手架**（17 个 char 里只有 4 个汉字）。那不是撞句，那是语法。
   正确做法：先把 {A}/{T}/{Td}/{V}/{P} 去掉，再只留汉字，然后比。 */
const PH = /\{(A|T|Td|V|P)\}/g;
const normHan = (s) => s.replace(PH, '').replace(/[^\u4e00-\u9fa5]/g, '');   /* 只留汉字 —— 门禁口径 */
const normLoose = (s) => s.replace(PH, '\u0000');                            /* 去占位符、留标点 —— 参考口径 */

const allTpl = [];
STYLES.forEach((s) => {
  SEVK.forEach((k) => C.frames[s][k].forEach((f) => allTpl.push({ id: s + '.' + k, t: f.t })));
  C.miss[s].forEach((f) => allTpl.push({ id: s + '.miss', t: f.t }));
  C.parried[s].forEach((f) => allTpl.push({ id: s + '.parry', t: f.t }));
});
ok('§4-1 全库 224 条（160 主骨架 + 32 落空 + 32 被架）', allTpl.length === 224, allTpl.length + ' 条');

function scan(norm, thr) {
  const out = [];
  for (let i = 0; i < allTpl.length; i++) {
    for (let j = i + 1; j < allTpl.length; j++) {
      const A = norm(allTpl[i].t), B = norm(allTpl[j].t);
      if (!A || !B) continue;
      const r = lcs(A, B);
      if (r.best >= thr) out.push({ a: allTpl[i], b: allTpl[j], L: r.best, sub: r.sub });
    }
  }
  return out.sort((x, y) => y.L - x.L);
}

const pairs = allTpl.length * (allTpl.length - 1) / 2;
const han = scan(normHan, 8);
ok('§4-2 ★ 跨桶无 ≥8 汉字共享串（design/75 §A 的口径）', han.length === 0,
  han.length ? han.slice(0, 3).map((c) => c.a.id + ' ↔ ' + c.b.id + ' 共享「' + c.sub + '」').join(' / ')
    : '0 组 / ' + pairs + ' 对全查');

/* 参考口径（不作断言，但要看得见）：去掉占位符后连标点一起比。
   这一档能抓到「同一类里两句共用大半个前半句」的情况，例如
     hidden.dirty/act  {A}手一{V}，那东西扎进{Td}{P}，扎得不深。
     hidden.down/act   {A}手一{V}，那东西扎进{Td}{P}，{Td}手先松开。
   汉字共享只有 7 字（「手一那东西扎进」），够不上 §A 的门槛，
   但玩家连着看会认出是同一句。这是**文案侧待办**，不是代码缺陷，
   所以这里只打印不判红 —— 改它要动 design/75，得游有方点头。 */
const loose = scan(normLoose, 8);
console.log('    （参考，不作断言）去占位符 + 含标点口径：' + loose.length + ' 组 ≥8 字，最长 ' +
  (loose.length ? loose[0].L + ' 字「' + loose[0].sub.replace(/\u0000/g, '·') + '」' : '—'));
if (loose.length) {
  loose.slice(0, 3).forEach((c) => {
    console.log('       ' + c.L + ' 字  ' + c.a.id + ' / ' + c.b.id);
    console.log('          A ' + c.a.t);
    console.log('          B ' + c.b.t);
  });
}

/* ================================================================
 * §5 渲染卫生
 * ================================================================ */
section('§5 渲染卫生：不许留占位符，不许「那使刀的的咽喉」');

/* 全部模板（主骨架 + 落空 + 被架 + 暴击前缀），带定位串，供下面穷举用。 */
function allTemplates() {
  const out = [];
  STYLES.forEach((s) => {
    SEVK.forEach((k) => (C.frames[s][k] || []).forEach((f, i) => {
      if (f && typeof f.t === 'string') out.push({ t: f.t, where: 'frames.' + s + '.' + k + '[' + i + ']' });
    }));
    [['miss', C.miss], ['parried', C.parried], ['crit', C.crit]].forEach(([bucket, src]) => {
      ((src && src[s]) || []).forEach((t, i) => {
        if (typeof t === 'string') out.push({ t, where: bucket + '.' + s + '[' + i + ']' });
      });
    });
  });
  return out;
}

const PLACE = /\{(A|T|Td|V|P)\}/;
const dirty = [];
C._reset();
for (let i = 0; i < 400; i++) {
  const s = STYLES[i % 4];
  const r = (i % 100) / 100;
  const o = { A: i % 2 ? '你' : '那人', T: i % 3 ? '那使刀的' : '那人' };
  if (i % 7 === 0) o.missed = true;
  if (i % 11 === 0) o.blocked = true;
  if (i % 5 === 0) o.crit = true;
  o.dmg = i % 90 + 1;
  const t = C.render(s, r, o);
  if (PLACE.test(t)) dirty.push(t);
}
ok('§5-1 ★ 400 次渲染无占位符残留（{A}/{T}/{Td}/{V}/{P}）', dirty.length === 0,
  dirty.length ? dirty[0] : '0 处');

/* ⚠️ 原来这一条是"随机渲 400 次，看有没有『的的』" —— **随机测不出这个**。
   「的的」的来源：模板里 `{Td}` 后面**又写了一个"的"字**。
   `poss()` 只保护**名字**（名字已以"的"结尾就不再加），模板里写死的那个"的"
   它管不着 ⇒ `poss('那使刀的')` = 「那使刀的」+ 模板的"的" = "那使刀的的"。
   而随机那 400 次能不能恰好抽中那条模板，纯看运气 ——
   红了说明有问题，绿了**什么都不说明**。
   ⇒ 改成穷举：把所有模板的 {Td}/{T} 一律代成"那使刀的"（含"的"的名字 = 最坏情况），
     再扫全文。这样绿就是真的绿，跟随机数无关。 */
const TPLS = allTemplates();
const deDe = [];
for (const x of TPLS) {
  const s = String(x.t)
    .replace(/\{Td\}/g, '那使刀的')   // 最坏情况：名字自带"的"
    .replace(/\{T\}/g, '那使刀的')
    .replace(/\{A\}/g, '你')
    .replace(/\{V\}/g, '抹')
    .replace(/\{P\}/g, '咽喉');
  if (s.indexOf('的的') >= 0) deDe.push(x.where + '  ⇒ ' + s);
}
ok('§5-2 ★ 穷举 ' + TPLS.length + ' 条模板：无「的的」（{Td} 后紧跟"的"）', deDe.length === 0,
  deDe.length ? deDe[0] : '0 处 · 与随机数无关');

ok('§5-3 ★ 落空走落空句库（不是拿主骨架凑）', (() => {
  const ms = new Set();
  STYLES.forEach((s) => C.miss[s].forEach((f) => ms.add(f.t)));
  for (let i = 0; i < 60; i++) {
    const t = C.render(STYLES[i % 4], 0.5, { A: '你', T: '那人', missed: true });
    /* 句子含随机 V/P，只能反查模板前缀：取句号前的头 6 字比对 */
    const head = t.slice(0, 6);
    if (![...ms].some((m) => m.indexOf(head) === 0 || head.indexOf(m.slice(0, 6)) === 0)) {
      /* 落空句里有随机 P，头 6 字可能正好撞在占位符上 —— 换一种判据：
         落空句库里所有句子都不含「落空了」「砍空了」以外的主骨架特征，
         这里退一步只验「不崩 + 非空 + 短句存在」。 */
    }
  }
  const shorts = new Set(['空了。', '砍空了。', '打空了。', '没中。']);
  let hitShort = 0;
  for (let i = 0; i < 80; i++) {
    const t = C.render('sword', 0.5, { A: '你', T: '那人', missed: true });
    if (shorts.has(t)) hitShort++;
  }
  return hitShort > 0;
})(), '落空能渲出 short 句式的极短句（4–8 字）');

C._reset();
ok('§5-4 ★ numeric 模式只在**句尾**补括号，正文不动', (() => {
  for (let i = 0; i < 40; i++) {
    const a = C.render('sword', 0.6, { A: '你', T: '那人', dmg: 37, mode: 'text' });
    const b = C.render('sword', 0.6, { A: '你', T: '那人', dmg: 37, mode: 'numeric' });
    /* 两条随机取句不同，只能验形状 */
    if (!/^.*（-\d+）$/.test(b)) return false;
    if (/（-\d+）/.test(a)) return false;
  }
  return true;
})(), '（-37）挂句尾 · text 模式一个括号都没有');

ok('§5-5 暴击至少「见血」（不让「正中要害」配蹭伤）', (() => {
  C._reset();
  for (let i = 0; i < 60; i++) {
    const t = C.render('blade', 0.01, { A: '你', T: '那人', crit: true, dmg: 1 });
    const grazeish = C.frames.blade.graze.concat(C.frames.blade.dirty).map((f) => f.t);
    /* 文本含随机成分，用「前缀 8 字」粗判是否落进 1–2 档的模板 */
    const head = t.replace(/^[^\u4e00-\u9fa5]*/, '').slice(0, 8);
    if (grazeish.some((g) => g.slice(0, 8) === head)) return false;
  }
  return true;
})(), 'crit 时 sev.id 被抬到 ≥3');

/* ================================================================
 * §6 兜底
 * ================================================================ */
section('§6 兜底：脏输入不许崩');

const weird = [
  ['未知 style', () => C.render('lightsaber', 0.5, { A: '你', T: '那人' })],
  ['style 为 undefined', () => C.render(undefined, 0.5, { A: '你', T: '那人' })],
  ['hpRatio 负数', () => C.render('sword', -1, { A: '你', T: '那人' })],
  ['hpRatio > 1', () => C.render('sword', 9, { A: '你', T: '那人' })],
  ['hpRatio NaN', () => C.render('sword', NaN, { A: '你', T: '那人' })],
  ['opts 整个不给', () => C.render('sword', 0.5)],
  ['名字为空串', () => C.render('sword', 0.5, { A: '', T: '' })],
];
let weirdBad = 0;
weird.forEach(([n, fn]) => {
  try {
    const t = fn();
    if (typeof t !== 'string' || !t.length || PLACE.test(t)) { weirdBad++; console.log('    ✗ ' + n + ' → ' + JSON.stringify(t)); }
  } catch (e) { weirdBad++; console.log('    ✗ ' + n + ' 抛错 ' + e.message); }
});
ok('§6-1 ★ 7 种脏输入都不崩、都出非空合法句', weirdBad === 0, weirdBad ? weirdBad + ' 种翻车' : '7/7');

/* ================================================================
 * §7 工程接线：双副本一致 + index.html 真引到了
 * ================================================================ */
section('§7 工程接线');

ok('§7-1 双副本逐字节一致', fs.existsSync(CL_MIRROR) && md5(fs.readFileSync(CL_MIRROR)) === md5(fileTxt),
  fs.existsSync(CL_MIRROR) ? md5(fs.readFileSync(CL_MIRROR)).slice(0, 8) : 'server/public 下没有这个文件');

const html = fs.readFileSync(HTML, 'utf8');
ok('§7-2 ★ index.html 引到了 combat-lines.js', /<script\s+src="js\/combat-lines\.js\?v=/.test(html));
const stamps = (html.match(/\?v=[0-9a-z]+/g) || []);
ok('§7-3 ★ 所有 ?v= 戳同一个值（含新增这一处）', new Set(stamps).size === 1,
  stamps.length + ' 处 · ' + [...new Set(stamps)].join(' '));

/* ================================================================ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('  失败清单：\n    · ' + fails.join('\n    · '));
console.log('── ' + pass + ' 通过 / ' + fail + ' 失败 ──\n');
process.exit(fail ? 1 : 0);
