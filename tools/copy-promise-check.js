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
    /* ★ D2·技能（team-lead 2026-10-18 明确要求：别只测物品）：
       技能自称能治/能疗/能救/能解毒，其 effects（含 moves[].effects）必须有 heal 或 cure。 */
    const skill = [...ctx.skillNameToId.keys()].find(n => t.includes(n) || n.includes(t));
    if (skill) {
      if (/能治|可治|能疗|能救|能解毒|可解毒|能止住|可止住|能止血/.test(line) && !ctx.canHeal(skill)) {
        bad.push(`技能「${skill}」声称能治，但 effects 没有 heal/cure`);
      }
      continue;
    }
    /* 既不是指令也不是物品：只有在「承诺句」里才算违规（避免把描述性引文误判） */
    if (PROMISE.test(line)) bad.push(`提示里的解法「${t}」既不在指令表、也不是物品`);
  }
  /* ★ 防空承诺（QA 复核补的盲点）：提示里一个「」都没有时，上面两层都不会触发，
     断言会变成「没东西可判」的假绿。文案「金创药能止住」正是这种形态。
     规则：凡是「能止住/可止住/能止血」的句子，必须点名至少一个**真实物品**。 */
  if (/(能止住|可止住|能止血)/.test(line)) {
    const namedItem = [...ctx.itemNameToId.keys()].some(n => line.includes(n));
    const namedSkill = [...ctx.skillNameToId.keys()].some(n => line.includes(n));
    if (!namedItem && !namedSkill) bad.push('承诺句没有点名任何真实物品（防空承诺）');
  }

  /* 不带「」但直接写物品名 + 承诺词：也要验效果 */
  for (const [name, id] of ctx.itemNameToId) {
    if (!line.includes(name)) continue;
    if (/止住|止血/.test(line) && !ctx.canCure(name) && !ctx.canCure(id)) {
      if (!bad.some(x => x.includes(name))) bad.push(`物品「${name}」声称能止血，但没有 cure(dot) 效果`);
    }
  }
  /* ★ 技能同理（对称补）：文本里直接写技能名、不加「」，一样要验 effects 里有没有 heal/cure。
     QA 2026-10-18 实测：只写在引号分支里时，「基本拳脚能治」这类会被漏判成绿。 */
  for (const [name, id] of ctx.skillNameToId) {
    if (!line.includes(name)) continue;
    if (/能治|可治|能疗|能救|能解毒|可解毒|能止住|可止住|能止血/.test(line) && !ctx.canHeal(name) && !ctx.canHeal(id)) {
      if (!bad.some(x => x.includes(name))) bad.push(`技能「${name}」声称能治，但 effects 没有 heal/cure`);
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
  /* 技能表（D2 技能分支用）：effects 或 moves[].effects 里有 heal/cure 才算"真能治" */
  const skillNameToId = new Map();
  for (const [id, sk] of Object.entries(w.data.skills || {})) if (sk && sk.name) skillNameToId.set(sk.name, id);
  const asArr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
  const canHeal = key => {
    const id = skillNameToId.get(key) || key;
    const sk = w.data.skills[id];
    if (!sk) return false;
    const effs = [].concat(asArr(sk.effects), asArr(sk.moves).flatMap(m => asArr(m && m.effects)));
    return effs.some(x => x && (x.type === 'heal' || x.type === 'cure'));
  };
  const ctx = { cmdSet, itemNameToId, canCure, skillNameToId, canHeal };

  /* P3 先跑反例自检：判定器必须能抓住旧文案 */
  /* 反例自检做成牙口表：负样本必须红、正样本必须绿，防「没东西可判」的假绿 */
  const teeth = [
    ['（金创药或「包扎」能止住。）', true],   // 引号里的未知词
    ['（能止住。）', true],                  // 没点名任何物品
    ['（包扎能止住。）', true],              // 点名了不存在的物品
    ['（金创药能止住。）', false],           // 真物品 + 真效果
    ['（血在流。）', false],                 // 不是承诺句，不误报
  ];
  /* D2 技能两组（team-lead 要求：别只测物品）——名字从真实技能表取，避免写死 */
  {
    const names = [...skillNameToId.keys()];
    const healName = names.find(n => canHeal(n));
    const plainName = names.find(n => !canHeal(n));
    if (plainName) teeth.push(['（' + plainName + '能治。）', true]);   // 技能存在但无 heal/cure → 必红
    if (healName) teeth.push(['（' + healName + '能治。）', false]);   // 技能真带 heal → 必绿
  }
  const teethBad = teeth.filter(([line, wantRed]) => (auditLine(line, ctx).length > 0) !== wantRed);
  ok('P3 牙口自检：负样本全红、正样本全绿（含物品与技能两组）',
    teethBad.length === 0, teethBad.map(x => x[0]).join(' / ') || (teeth.length + '/' + teeth.length + ' 符合预期'));

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

  /* P1c 数据层扫描（2026-10-18 qa-lead 指出缺口；team-lead 批的口径）：
     扫 game/data/*.json，但 **JSON.parse 后只遍历字符串值**，不按原文行扫——
     避免键名（desc:/say:）与 \uXXXX 转义干扰；代价全量解析 ≈44ms。
     三个数必须打出来（文件数 / 字符串值数 / 承诺条数），防"扫了个寂寞"的假绿。 */
  const dataDir = path.join(ROOT, 'game', 'data');
  const dataFiles = fs.readdirSync(dataDir).filter(f => f.endsWith('.json'));
  const dataViolations = [];
  let dataScanned = 0, stringVals = 0, parsed = 0;
  const walkStrings = (v, out) => {
    if (typeof v === 'string') { out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walkStrings(x, out); return; }
    if (v && typeof v === 'object') { for (const x of Object.values(v)) walkStrings(x, out); }
  };
  for (const f of dataFiles) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (err) { continue; }
    parsed++;
    const strs = [];
    walkStrings(j, strs);
    stringVals += strs.length;
    for (const str of strs) {
      if (!PROMISE.test(str)) continue;
      dataScanned++;
      for (const v of auditLine(str, ctx)) dataViolations.push(f + ' ' + v);
    }
  }
  ok('P1c ★ 数据层（data/*.json）承诺句同样成立', dataViolations.length === 0,
    dataViolations.slice(0, 3).join(' ｜ '));
  ok('P1d 数据层扫描面非空（防漏扫/空跑）',
    parsed >= 50 && stringVals >= 50000, parsed + ' 文件 / ' + stringVals + ' 字符串值 / 承诺 ' + dataScanned + ' 条（阈值按 2026-10-18 实测 61,553 取 5 万）');

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
