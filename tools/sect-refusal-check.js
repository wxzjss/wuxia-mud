#!/usr/bin/env node
/* ==========================================================================
 *  tools/sect-refusal-check.js —— 山门拒绝语文案守卫（2026-10-18）
 *
 * 病根（游有方报、严过关复现）：数据用 `{"attr":"悟性",">=":18}` 写法，
 * 旧 sectRefusal 的分支只认 gender/karma/wis/…，`>=` 被当独立键 →
 * 8 个门派吐出「>= 需 18（你 0）」——把语法当人话。更深的病是
 * **判定（joinSect → evalCond）与文案（sectRefusal → if-else）两套实现**。
 *
 * 本守卫守三条：
 *   R1 每个有 require 的门派，造**不达标探针**去 joinSect，必须被拒；
 *   R2 拒绝语必须含**门槛的中文名**（性别/人族/侠名/修为/悟性/根骨/力量/身法/功法…）；
 *   R3 拒绝语不得出现运算符/内部字段字面量：`>=` `<=` `>` `<` `attr` `undefined` `NaN`
 *      （`>` `<` 只在「>=」「<=」形态检查，避免中文书名号误伤）。
 *
 * 用法：node tools/sect-refusal-check.js
 * ========================================================================== */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

const OPS = ['>=', '>', '<=', '<', '==', '!='];
const ATTR_CN = ['悟性', '根骨', '力量', '身法', '福缘', '定力'];
function parseOp(v) {
  if (typeof v === 'number') return { op: '>=', n: v };
  const m = String(v).match(/^\s*(>=|<=|==|>|<)?\s*(-?\d+(?:\.\d+)?)\s*$/);
  return m ? { op: m[1] || '>=', n: parseFloat(m[2]) } : null;
}

/** 按 require 造一个**必然不达标**的玩家；返回期望文案里该出现的中文 token */
function makeLoser(p, req) {
  const tokens = [];
  if (req.gender !== undefined) {
    p.gender = String(req.gender).toLowerCase() === 'female' ? '男' : '女';
    tokens.push('身');                       // 「女儿身 / 男儿身」
  }
  if (req.karma !== undefined) {
    const po = parseOp(req.karma) || { op: '>=', n: 0 };
    p.karma = po.op === '<=' || po.op === '<' ? po.n + 10 : po.n - 10;
    tokens.push('侠名');
  }
  if (req.race !== undefined) {
    p.race = '妖兽';                        // 与 'human' 不同即可
    tokens.push('族');
  }
  if (req.level !== undefined) {
    p.setVar('level', 0);
    tokens.push('修为');
  }
  if (req.attr !== undefined) {
    const name = String(req.attr);
    p.attr = p.attr || {};
    p.attr[name] = -100;                    // attrTotal 兜底也压到 0 以下
    tokens.push(name);
  }
  if (req.skill !== undefined || req.skills !== undefined || req.learned !== undefined) {
    p.learned = {};
    tokens.push('练到');                     // 熟练度门槛；纯「须先学会」也含「学会」
    tokens.push('学会');
  }
  return tokens;
}

const BAD = [/>=/, /<=/, /\battr\b/, /undefined/, /NaN/, /需\s*需/];

(async () => {
  console.log('\n  ── 山门拒绝语文案守卫 ──');
  const boot = new GameEngine({ seed: 20261018 });
  await boot.boot({});
  const sects = Object.entries(boot.world.data.sects || {})
    .filter(([, sd]) => sd && sd.require && Object.keys(sd.require).length);

  ok('R0 前提：扫到有门槛的门派（不是空跑）', sects.length >= 8, sects.length + ' 派');

  for (const [id, sd] of sects) {
    const e = new GameEngine({ seed: 20261018 });
    await e.boot({});
    e.newGame({ name: '探门', gender: 'male', birth: 'wuxue' });
    const p = e.world.player;
    let tokens = [];
    try { tokens = makeLoser(p, sd.require); } catch (err) { tokens = []; }
    let r = null;
    try { r = p.joinSect(id); } catch (err) { r = { ok: true, msg: '抛异常：' + err.message }; }
    const msg = String((r && r.msg) || '');
    ok(`R1 ${sd.name}（${id}）不达标探针被拒`, r && r.ok === false, msg.slice(0, 70));
    if (!r || r.ok !== false) { continue; }
    const hasToken = tokens.length === 0 || tokens.some(t => msg.indexOf(t) >= 0);
    ok(`R2 ${sd.name} 拒绝语含门槛中文名（${tokens.join('/') || '任意'}）`, hasToken, msg.slice(0, 90));
    const badHit = BAD.filter(re => re.test(msg)).map(re => String(re));
    ok(`R3 ${sd.name} 拒绝语无运算符/内部字段字面量`, badHit.length === 0, badHit.join(' ') + ' ｜ ' + msg.slice(0, 90));
  }

  /* S 合成条件覆盖（数据现在没用，但引擎按同一套形状支持——防以后数据一写又漏文案） */
  {
    const e = new GameEngine({ seed: 20261018 });
    await e.boot({});
    e.newGame({ name: '探门', gender: 'male', birth: 'wuxue' });
    const p = e.world.player;
    const cases = [
      { name: '测试派·声望', require: { rep: '华山派', '>=': 50 }, token: '声望' },
      { name: '测试派·信物', require: { item: '藏宝图', count: 1 }, token: '藏宝图' },
    ];
    for (const c of cases) {
      let msg = '';
      try { msg = p.sectRefusal({ name: c.name, require: c.require }); } catch (err) { msg = '抛异常：' + err.message; }
      ok(`S ${c.name} 合成条件出人话`, msg.indexOf(c.token) >= 0, msg.slice(0, 80));
      const badHit = BAD.filter(re => re.test(msg)).map(re => String(re));
      ok(`S ${c.name} 无运算符/内部字段字面量`, badHit.length === 0, badHit.join(' ') + ' ｜ ' + msg.slice(0, 80));
    }
  }

  console.log('\n' + (fail ? '✘ ' + fail + ' 项失败：' + fails.join(' / ') : '✔ 全部通过'));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
