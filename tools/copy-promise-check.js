#!/usr/bin/env node
/* ==========================================================================
 *  tools/copy-promise-check.js —— 「文案承诺必须成立」类级守卫（2026-10-18）
 *
 * 病根（QA 独立验收 7 红里的 2 条）：战斗/状态文案里推荐了解法，
 *   但解法根本不存在或不起作用——玩家照着做只会撞墙/白花钱：
 *     · 「金创药或「包扎」能止住」→ 全库没有「包扎」这条指令；
 *     · 「金创药能止住」→ 金创药只有 +hp，不清流血，创口照样每回合扣血。
 *   我原来的守卫是按实现写的（29/0），所以测不出「承诺是否兑现」。
 *
 * 本守卫守两层：
 *   P1 静态：凡含「能止住/能止血/能解/能治/能清」等承诺词的源码行，
 *      其中「」里的解法必须是**真指令**或**真物品**；
 *      声称「止住/止血」的物品，必须带 cure(dot) 效果。
 *   P2 行为：挂真 dot → 用金创药 → dot 必须消失（不是只加血）。
 *   P3 反例自检：把旧文案「金创药或「包扎」能止住」喂给同一判定器，
 *      必须判红（证明守卫不是永远绿）。
 *
 * 用法：node tools/copy-promise-check.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

const PROMISE = /(能止住|可止住|能止血|能解毒|可解毒|能化解|能治|可治|能清|可清)/;

/** 判定一行文案里的「解法」是否真实存在/有效；返回违规描述数组 */
function auditLine(line, ctx) {
  const bad = [];
  const tokens = [...line.matchAll(/「([^」]+)」/g)].map(m => m[1]);
  for (const t of tokens) {
    if (ctx.cmdSet.has(t)) continue;                       // 真指令
    const item = [...ctx.itemNameToId.keys()].find(n => t.includes(n) || n.includes(t));
    if (item) {
      if (/止住|止血/.test(line) && !ctx.canCure(item)) bad.push(`物品「${item}」声称能止血，但没有 cure(dot) 效果`);
      continue;
    }
    /* 既不是指令也不是物品：只有在「承诺句」里才算违规（避免把描述性引文误判） */
    if (PROMISE.test(line)) bad.push(`提示里的解法「${t}」既不在指令表、也不是物品`);
  }
  /* 不带「」但直接写物品名 + 承诺词：也要验效果 */
  for (const [name, id] of ctx.itemNameToId) {
    if (!line.includes(name)) continue;
    if (/止住|止血/.test(line) && !ctx.canCure(name) && !ctx.canCure(id)) {
      if (!bad.some(x => x.includes(name))) bad.push(`物品「${name}」声称能止血，但没有 cure(dot) 效果`);
    }
  }
  return bad;
}

(async () => {
  console.log('\n  ── 文案承诺守卫（提示里推荐的解法必须真能用） ──');
  const e = new GameEngine({ seed: 20261018 });
  await e.boot({});
  const w = e.world;
  const cmdSet = new Set(Object.keys(e.cmds.CMD || {}));
  const itemNameToId = new Map();
  for (const [id, it] of Object.entries(w.data.items || {})) if (it && it.name) itemNameToId.set(it.name, id);
  const canCure = key => {
    const id = itemNameToId.get(key) || key;
    const it = w.data.items[id];
    if (!it) return false;
    const effs = Array.isArray(it.use) ? it.use : [];
    return effs.some(x => x && x.type === 'cure' && (!x.args || x.args[0] === 'dot' || /创口|流血/.test(String(x.args[0]))));
  };
  const ctx = { cmdSet, itemNameToId, canCure };

  /* P3 先跑反例自检：判定器必须能抓住旧文案 */
  const oldCopy = '（金创药或「包扎」能止住。）';
  const oldBad = auditLine(oldCopy, ctx);
  ok('P3 反例自检：旧文案里的「包扎」会被判红（守卫不是永远绿）',
    oldBad.some(x => x.includes('包扎')), oldBad.join('；') || '(未判红)');

  /* P1 静态扫描 core 全部源码 */
  const dir = path.join(ROOT, 'game', 'src', 'core');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
  const violations = [];
  let scannedLines = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!PROMISE.test(line)) return;
      if (!/[「"]/.test(line) && ![...itemNameToId.keys()].some(n => line.includes(n))) return;
      scannedLines++;
      for (const v of auditLine(line, ctx)) violations.push(`${f}:${i + 1} ${v}`);
    });
  }
  ok('P1 ★ 承诺句里的解法全部真实（指令存在 / 物品存在且有效）',
    violations.length === 0, violations.slice(0, 4).join(' ｜ '));
  ok('P1b 扫描不是空跑（确实扫到了承诺句）', scannedLines > 0, scannedLines + ' 行');

  /* P2 行为验证：挂真 dot → 用金创药 → dot 消失 */
  {
    e.newGame({ name: '验', gender: 'male', birth: 'wuxue' });
    const p = w.player;
    w.giveItem(p, 'jinchuang_yao', 1);
    const n = w.spawnNpc('mob_bandit', p.room, 1, true);
    w.startCombat(p, n);
    p.addBuff({ name: '创口', turns: 2, mods: {}, tag: 'dot_创口', dot: { value: 6, source: n.id } });
    const before = (p.buffs || []).some(b => b.tag === 'dot_创口');
    e.exec('use 金创药');
    const after = (p.buffs || []).some(b => b.tag === 'dot_创口');
    ok('P2 ★ 「金创药能止住」成立：用后创口真的消失', before && !after,
      'before=' + before + ' after=' + after);
  }

  console.log('\n' + (fail ? '✘ ' + fail + ' 项失败：' + fails.join(' / ') : '✔ 全部通过'));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
