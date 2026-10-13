#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-fields-check.js —— `combat.oneAttack()` 结构化字段守卫
 *  --------------------------------------------------------------------------
 *  为什么要有这个脚本：
 *    `oneAttack()` 以前只回一句拼好的文本。渲染层要表现「这一刀多重 / 是不是暴击 /
 *    谁打谁」，只能去**反解那句话**——加一个表现维度就得加一条正则，改一次崩一次。
 *    现在它改成同时回 `{ style, hpRatio, crit, blocked, missed, dmg, aName, tName }`，
 *    文本降格成兜底。
 *
 *    危险在于：**这套字段目前一个测试都没覆盖**。改坏了不红，而 ④ 的五档视觉分层
 *    要拿 `hpRatio` 算 tier —— 如果这里悄悄返回 undefined，视觉层就会静默退化成
 *    「所有伤害一个样」，而玩家只会觉得「战斗文本好像变淡了」。这种退化没人报。
 *    这个脚本就是把契约钉住。
 *
 *  ★ 核心契约：**`hpRatio` 是视觉分层的唯一输入**。
 *    渲染层不许自己再算一遍 `dmg / maxHp` —— 同一条口径两处各写一份，
 *    改一个忘一个是这个项目反复踩的坑。
 *
 *  覆盖：
 *    §1 命中时字段齐全且类型对
 *    §2 style 映射：七种兵刃类型 → 句库四类（含没有对应类的棍/鞭怎么落）
 *    §3 `skill.style` 优先于 `type`（数据补了字段后自动生效，代码不用改）
 *    §4 hpRatio = dmg / maxHp，落在 0–1；maxHp 脏数据时兜底不出 NaN
 *    §5 aName / tName 的第二人称
 *    §6 落空分支
 *    §7 `text` 兜底仍在（smoke-arts.js:144 在上面取伤害）
 *    §8 暴击
 *    §10 blocked 现状（**记现状，不是判质量**）
 *
 *  用法：node tools/combat-fields-check.js
 * ========================================================================== */

'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  \u2718 ' + name + (extra ? '  \u00ab ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

const SEED = 20261008;
const e = new GameEngine({ seed: SEED });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;

/* 让结果可复现：卸掉武学，命中恒真（本脚本验字段，不验命中与伤害公式） */
p.learned = {};
p.equippedSkills = {};
p.equipment = p.equipment || {};
delete p.equipment['武器'];
w.combatHooks.hitRoll = () => true;

const BATTLE = { attackers: [p], defenders: [], turn: 0, log: [], over: false, winner: null };

/* 找一个稳定的挨打对象：岳不群（每个档都在） */
const yueId = 'master_yue';
const yue = w.spawnNpc(yueId, w.data.npcs[yueId].room, 1, true);
if (!yue) { console.log('  \u2718 起不来挨打对象，后面全废'); process.exit(1); }

function fresh() {
  yue.hp = yue.maxHp;
  p.hp = p.maxHp;
  return yue.hp;
}

/* 按 type 取一门真武学（数据驱动，不写死 id） */
function skillOfType(ty) {
  const all = w.data.skills || {};
  for (const id of Object.keys(all)) {
    const s = all[id];
    if (s && s.type === ty) return s;
  }
  return null;
}
function countOfType(ty) {
  const all = w.data.skills || {};
  return Object.keys(all).filter((id) => all[id] && all[id].type === ty).length;
}

/* ================================================================
 * §1 命中时字段齐全
 * ================================================================ */
section('§1 命中时字段齐全且类型对');

const before = fresh();
const r = w.combat.oneAttack(p, yue, null, BATTLE, 0);
const drop = before - yue.hp;

ok('§1-1 返回对象带 kind:combat', r && r.kind === 'combat');
const FIELDS = {
  style: 'string', hpRatio: 'number', crit: 'boolean',
  blocked: 'boolean', missed: 'boolean', dmg: 'number',
  aName: 'string', tName: 'string', text: 'string',
};
const missing = Object.keys(FIELDS).filter((k) => !(k in r));
ok('§1-2 ★ 九个结构化字段一个都不能少', missing.length === 0,
  missing.length ? '缺 ' + missing.join(',') : Object.keys(FIELDS).join(' '));
const wrongType = Object.keys(FIELDS).filter((k) => (k in r) && typeof r[k] !== FIELDS[k]);
ok('§1-3 字段类型都对（渲染层靠类型分派，给错就静默走兜底）', wrongType.length === 0,
  wrongType.length ? wrongType.map((k) => k + '=' + typeof r[k]).join(' ') : '9/9');
ok('§1-4 ★ 改变了战斗但它仍是一次攻击（dmg 与掉血一致）', r.dmg === drop && drop > 0,
  'dmg=' + r.dmg + ' 掉血=' + drop);
ok('§1-5 命中标 missed:false', r.missed === false);

/* ================================================================
 * §2 style 映射：七种兵刃类型 → 句库四类
 * ================================================================ */
section('§2 style 映射（七种兵刃类型 → 句库四类）');

const EXPECT = {
  剑: 'sword', 刀: 'blade', 拳: 'fist', 暗器: 'hidden',
  /* 棍 / 鞭：句库只有四类，没有"钝器 / 软鞭"。棍走 blade（有分量、硬碰硬），
     鞭也走 blade（抽、削，是"有刃口动作"那一路）—— 都比塞进 fist 合理。 */
  棍: 'blade', 鞭: 'blade',
  /* 音波：四类里没有它能落进去的（hidden 通篇说「那东西」，音波没有实体），
     fist 是唯一不凭空引入物件的兜底。详见 combat.js 里 COMBAT_STYLE_OF_TYPE 的注释。 */
  音波: 'fist',
};
const got = {};
const badMap = [];
Object.keys(EXPECT).forEach((ty) => {
  const s = skillOfType(ty);
  if (!s) { got[ty] = '(数据里没有)'; return; }
  fresh();
  const rr = w.combat.oneAttack(p, yue, s, BATTLE, 0);
  got[ty] = rr.style;
  if (rr.style !== EXPECT[ty]) badMap.push(ty + '→' + rr.style + '（应为 ' + EXPECT[ty] + '）');
});
ok('§2-1 ★ 七种兵刃类型的映射都对', badMap.length === 0,
  badMap.length ? badMap.join(' / ') : Object.keys(got).map((k) => k + '→' + got[k]).join(' '));
ok('§2-2 映射结果都落在句库四类里（拼错类名等于整类走兜底）',
  Object.keys(got).every((k) => ['sword', 'blade', 'fist', 'hidden'].indexOf(got[k]) >= 0 || got[k] === '(数据里没有)'),
  Object.keys(got).map((k) => k + '→' + got[k]).join(' '));

/* 记录各类型在库里的门数 —— 「这个映射值不值得为它新编一类」要看它覆盖多少门。
   音波只有 1 门（基本乐理），所以落在 fist 兜底是划算的；
   哪天音波涨到几十门，就该回头让 design/75 加第五类，而不是继续凑。 */
const census = {};
Object.keys(EXPECT).forEach((ty) => { census[ty] = countOfType(ty); });
console.log('    （参考）各类型门数：' + Object.keys(census).map((k) => k + ' ' + census[k]).join(' · '));
ok('§2-3 音波是四类之外唯一还在用的兵刃类型，且只有 1 门（不值得为它新编第五类）',
  census['音波'] === 1, '音波 ' + census['音波'] + ' 门（' + (skillOfType('音波') || {}).name + '）');

/* 无武学（普通攻击）+ 手上没兵器 ⇒ 落到 fist */
fresh();
const bare = w.combat.oneAttack(p, yue, null, BATTLE, 0);
ok('§2-4 ★ 什么都没装备 ⇒ 兜底 fist', bare.style === 'fist', 'style=' + bare.style);

/* ================================================================
 * §3 `skill.style` 优先于 `type`
 * ================================================================ */
section('§3 数据补了 style 字段就自动优先用它');

const swordish = skillOfType('剑');
ok('§3-1 前提：取到一门剑法', !!swordish, swordish ? swordish.name : '没取到');
if (swordish) {
  const fake = Object.assign({}, swordish, { style: 'hidden' });  /* 剑法但写着暗器 */
  fresh();
  const rf = w.combat.oneAttack(p, yue, fake, BATTLE, 0);
  ok('§3-2 ★ `style` 压过 `type`（等数据补字段后自动生效，代码不用改）',
    rf.style === 'hidden', 'type=' + fake.type + ' style=' + fake.style + ' ⇒ ' + rf.style);
  const bogus = Object.assign({}, swordish, { style: 'lightsaber' });  /* 拼错的类名 */
  fresh();
  const rb = w.combat.oneAttack(p, yue, bogus, BATTLE, 0);
  ok('§3-3 拼错的 style 名不生效，退回按 type 判（不许把脏数据透到渲染层）',
    rb.style === 'sword', 'style=lightsaber ⇒ ' + rb.style);
}

/* ================================================================
 * §4 hpRatio
 * ================================================================ */
section('§4 hpRatio = dmg / 挨打方 maxHp');

let ratioBad = 0, ratioSeen = 0, maxSeen = 0;
for (let i = 0; i < 40; i++) {
  fresh();
  const rr = w.combat.oneAttack(p, yue, null, BATTLE, 0);
  const want = rr.dmg / yue.maxHp;
  if (Math.abs(rr.hpRatio - want) > 1e-9) ratioBad++;
  if (rr.hpRatio < 0 || rr.hpRatio > 1) ratioBad++;
  ratioSeen++;
  maxSeen = Math.max(maxSeen, rr.hpRatio);
}
ok('§4-1 ★ hpRatio 恒等于 dmg / maxHp', ratioBad === 0, ratioSeen + ' 次全对');
ok('§4-2 hpRatio 落在 0–1（渲染层拿它算档位，越界就是档位算飞）',
  ratioBad === 0, '最大 ' + maxSeen.toFixed(4));
ok('§4-3 hpRatio 是有限数（不是 NaN / Infinity）', Number.isFinite(r.hpRatio),
  String(r.hpRatio));

/* 脏数据：maxHp 为 0 时不能出 NaN —— 旧存档里见过 */
(function dirtyMaxHp() {
  const save = yue.maxHp;
  const cases = [[0, 'maxHp=0'], [NaN, 'maxHp=NaN'], [undefined, 'maxHp=undefined'], [-5, 'maxHp=-5']];
  const bad = [];
  cases.forEach(([v, label]) => {
    yue.maxHp = v;
    fresh();
    yue.hp = 1;
    const rr = w.combat.oneAttack(p, yue, null, BATTLE, 0);
    if (!Number.isFinite(rr.hpRatio) || rr.hpRatio < 0 || rr.hpRatio > 1) bad.push(label + '→' + rr.hpRatio);
  });
  ok('§4-4 ★ maxHp 脏了也只兜到 1，绝不出 NaN', bad.length === 0,
    bad.length ? bad.join(' ') : '4 种脏数据全兜住（兜底值 1）');
  yue.maxHp = save;
  yue.hp = yue.maxHp;
})();

/* ================================================================
 * §5 aName / tName
 * ================================================================ */
section('§5 第二人称');

fresh();
const rp = w.combat.oneAttack(p, yue, null, BATTLE, 0);
ok('§5-1 ★ 玩家出手 ⇒ aName 是「你」', rp.aName === '你', 'aName=' + rp.aName);
ok('§5-2 ★ 挨打的是 NPC ⇒ tName 是它的名字', rp.tName === yue.name, 'tName=' + rp.tName);
fresh();
const rn = w.combat.oneAttack(yue, p, null, BATTLE, 0);
ok('§5-3 ★ NPC 打玩家 ⇒ 反过来（aName=名字，tName=你）',
  rn.aName === yue.name && rn.tName === '你', rn.aName + ' → ' + rn.tName);

/* ================================================================
 * §6 落空分支
 * ================================================================ */
section('§6 落空分支');

w.combatHooks.hitRoll = () => false;
fresh();
const rm = w.combat.oneAttack(p, yue, null, BATTLE, 0);
ok('§6-1 ★ missed:true', rm.missed === true);
ok('§6-2 落空 dmg 为 0', rm.dmg === 0, 'dmg=' + rm.dmg);
ok('§6-3 落空 hpRatio 为 0（不是 NaN）', rm.hpRatio === 0, String(rm.hpRatio));
ok('§6-4 落空也带 style（渲染层要拿它选落空句库）',
  ['sword', 'blade', 'fist', 'hidden'].indexOf(rm.style) >= 0, 'style=' + rm.style);
ok('§6-5 落空的兜底文本非空且不含占位符', !!rm.text && !/\{[A-Za-z]+\}/.test(rm.text), rm.text);
w.combatHooks.hitRoll = () => true;

/* ================================================================
 * §7 text 兜底仍在
 * ================================================================ */
section('§7 text 兜底仍在（有人在上面取伤害）');

fresh();
const rt = w.combat.oneAttack(p, yue, null, BATTLE, 0);
ok('§7-1 ★ text 仍在且含「造成 N 点伤害」（tools/smoke-arts.js:144 靠它比大小）',
  /造成 \d+ 点伤害/.test(rt.text), rt.text.slice(0, 40) + '…');
const m = rt.text.match(/造成 (\d+) 点伤害/);
ok('§7-2 ★ text 里的伤害数与 dmg 字段一致（不许两处各说一个数）',
  m && +m[1] === rt.dmg, 'text=' + (m && m[1]) + ' vs dmg=' + rt.dmg);

/* ================================================================
 * §8 暴击
 * ================================================================ */
section('§8 暴击');

let sawCrit = false, critBad = 0;
for (let i = 0; i < 200 && !sawCrit; i++) {
  fresh();
  const rc = w.combat.oneAttack(p, yue, null, BATTLE, 0);
  if (rc.crit) {
    sawCrit = true;
    if (!/正中要害/.test(rc.text)) critBad++;
  }
}
ok('§8-1 200 次里至少暴击一次（否则这条是假绿）', sawCrit, sawCrit ? '有' : '一次没暴，样本不够');
ok('§8-2 暴击时 crit 字段与兜底文本同向', critBad === 0, '不一致 ' + critBad + ' 次');

/* ================================================================
 * §9 档位对撞：ui.js 的 combatTierOf() vs 句库真正渲染出来的那一句
 * ----------------------------------------------------------------
 * 为什么要有这一节：
 *   ④ 的视觉分层靠 `hpRatio` 算档位。档位表**只能有一个来源**，否则改了句库的
 *   分档，视觉这边还停在老地方 —— 两边都不报错，玩家只觉得"颜色怪怪的"。
 *   现在的实现是：ui.js 的 combatTierOf() 读 `COMBAT_LINES.severity` 自己算，
 *   句库 render() 内部也用同一张表自己算。**这是两份实现**，
 *   光靠"都读同一张表"还不能保证它们逐条一致。
 *
 *   ⇒ 所以对撞：把句库**真的渲出来**的那一句，反查它落在哪一档，
 *     再跟 combatTierOf() 算的档位比。全等才算过。
 *
 *   ⚠️ 为什么不干脆把 tierOf() 写进 combat-lines.js：那文件必须与
 *      design/75 §1.8 代码块**逐字节一致**（守卫 §0），加不得。
 *      于是退而求其次：表共享 + 实现对撞。
 * ================================================================ */
section('§9 档位对撞：视觉层算的档位 == 句库真正用的档位');

global.window = {};
require(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'combat-lines.js'));
const CL = global.window.COMBAT_LINES;

/* 从真 ui.js 里抠出 combatTierOf / combatClsOf（与 smoke-map-region-filter §8
   抠 mapHtml 同一套手法：跑真代码，不对付一句假字符串）。 */
const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
const grab = (name) => {
  const mm = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!mm) throw new Error('未在 ui.js 里找到 ' + name);
  return mm[0];
};
const combatTierOf = new Function(
  grab('combatTierOf') + '\nreturn combatTierOf;'
)();
const combatClsOf = new Function(
  grab('combatTierOf') + '\n' + grab('combatClsOf') + '\nreturn combatClsOf;'
)();
ok('§9-1 能从真 ui.js 里抠出 combatTierOf / combatClsOf',
  typeof combatTierOf === 'function' && typeof combatClsOf === 'function');

/* 建「渲染结果 → 档位」反查表：每条模板穷举 14 动词 × 14 部位填满 */
const PARTS = CL.parts.light.concat(CL.parts.heavy);
const SEVK = ['graze', 'dirty', 'blood', 'bone', 'down'];
const STYLES = ['sword', 'blade', 'fist', 'hidden'];
const uiTierOfKey = {};
CL.severity.forEach((s) => { uiTierOfKey[s.key] = s.uiTier; });
const tpl2key = new Map();
STYLES.forEach((s) => {
  CL.verbs[s].forEach((V) => PARTS.forEach((P) => {
    SEVK.forEach((k) => CL.frames[s][k].forEach((f) => {
      tpl2key.set(CL.fill(f.t, '你', '张三', V, P), k);
    }));
  }));
});
ok('§9-2 反查表建起来了', tpl2key.size > 1000, tpl2key.size + ' 条');

/* 暴击前缀要先剥掉，剩下的才是骨架那句 */
const critPrefix = {};
STYLES.forEach((s) => {
  critPrefix[s] = CL.crit[s].map((tpl) => CL.fill(tpl, '你', '张三', '', ''));
});

function tierLibraryUsed(style, hpRatio, crit) {
  let txt = CL.render(style, hpRatio, { A: '你', T: '张三', crit: !!crit });
  if (crit) {
    const hit = critPrefix[style].find((p) => txt.indexOf(p) === 0);
    if (hit) txt = txt.slice(hit.length);
  }
  const k = tpl2key.get(txt);
  return k ? uiTierOfKey[k] : null;
}

{
  const bad = [];
  let n = 0;
  STYLES.forEach((s) => {
    for (let i = 0; i <= 100; i++) {
      const r = i / 100;
      [false, true].forEach((crit) => {
        const a = combatTierOf({ hpRatio: r, crit });
        const b = tierLibraryUsed(s, r, crit);
        n++;
        if (b === null || a !== b) bad.push(s + ' r=' + r + ' crit=' + crit + ' 视觉=' + a + ' 句库=' + b);
      });
    }
  });
  ok('§9-3 ★ 视觉档位与句库档位逐点一致（4 类 × 101 个比例 × 暴击与否）',
    bad.length === 0, bad.length ? bad.slice(0, 3).join(' / ') : n + ' 个点全等');
}

/* 边界：文档写死的五个分档点，两边必须切在同一处 */
{
  const cuts = [0.08, 0.22, 0.45, 0.75];
  const got = cuts.map((c) => combatTierOf({ hpRatio: c - 0.001, crit: false }) + '→' + combatTierOf({ hpRatio: c, crit: false }));
  ok('§9-4 ★ 四个分档点两侧档位真的跳了一级（边界没糊在一起）',
    got.join(' ') === '1→2 2→3 3→4 4→5', got.join(' '));
}

/* 暴击强制 ≥3 档：与句库 render() 里 `if (crit && sev.id < 3) sev = severity[2]` 同一条 */
{
  const bad = [];
  for (let i = 0; i <= 30; i++) {
    const r = i / 100;                       /* 全都在 1–3 档区间里 */
    const a = combatTierOf({ hpRatio: r, crit: true });
    const b = tierLibraryUsed('blade', r, true);
    if (a < 3 || a !== b) bad.push('r=' + r + ' 视觉=' + a + ' 句库=' + b);
  }
  ok('§9-5 ★ 暴击一律抬到 ≥3 档（"正中要害"配蹭伤是自己打自己）',
    bad.length === 0, bad.length ? bad.slice(0, 2).join(' / ') : '31 个低伤点全被抬到 3 档');
}

/* 脏输入 / 缺字段：不许出 undefined 档位（出了就是整行掉色） */
{
  const cases = [
    [undefined, '整个不给'],
    [{}, '空对象'],
    [{ hpRatio: NaN }, 'hpRatio=NaN'],
    [{ hpRatio: -1 }, 'hpRatio<0'],
    [{ hpRatio: 9 }, 'hpRatio>1'],
    [{ hpRatio: '0.5' }, 'hpRatio 是字符串'],
  ];
  const bad = [];
  cases.forEach(([v, label]) => {
    const t = combatTierOf(v);
    if (typeof t !== 'number' || !isFinite(t) || t < 0 || t > 5) bad.push(label + '→' + t);
  });
  ok('§9-6 脏输入也只出 0–5 的有限数（出了就是整行掉色）', bad.length === 0,
    bad.length ? bad.join(' ') : '6 种脏输入全兜住');
  ok('§9-7 落空 ⇒ 0 档（不画杠，没打着就不该有血色）',
    combatTierOf({ hpRatio: 0.5, missed: true }) === 0);
}

/* class 挂载：主客的判据是「血是谁的」，不是"我打出的/我挨的" */
{
  const mine = combatClsOf({ cb: { tName: '你', hpRatio: 0.5 } });
  const theirs = combatClsOf({ cb: { tName: '岳不群', hpRatio: 0.5 } });
  ok('§9-8 ★ 血是我的 ⇒ cb-in；血是别人的 ⇒ cb-out',
    mine.cls.indexOf('cb-in') >= 0 && theirs.cls.indexOf('cb-out') >= 0,
    mine.cls.trim() + ' / ' + theirs.cls.trim());
  ok('§9-9 NPC 打 NPC 也归 cb-out（"我打/我挨"那种判据在这里无处安放）',
    combatClsOf({ cb: { tName: '岳不群', aName: '令狐冲', hpRatio: 0.5 } }).cls.indexOf('cb-out') >= 0);
  ok('§9-10 落空 ⇒ cb-miss 且不挂档位 class',
    combatClsOf({ cb: { missed: true } }).cls.trim() === 'cb-miss');
  ok('§9-11 暴击 ⇒ 多挂一个 cb-crit（不改档位，只加柔光与字重）',
    combatClsOf({ cb: { tName: '你', hpRatio: 0.5, crit: true } }).cls.indexOf('cb-crit') >= 0);
  ok('§9-12 没有 cb 字段的老数据 ⇒ 不加任何 class（退化成一行普通战斗字）',
    combatClsOf({}).cls === '');
}

/* ================================================================
 * §9 blocked 现状
 * ================================================================ */
section('§10 blocked 现状（记现状，不是判质量）');

const allFalse = [];
for (let i = 0; i < 30; i++) {
  fresh();
  const rb = w.combat.oneAttack(p, yue, null, BATTLE, 0);
  if (rb.blocked !== false) allFalse.push(i + '→' + rb.blocked);
}
ok('§10-1 blocked 恒为 false（引擎里目前没有「被架住」这个结算结果）', allFalse.length === 0,
  allFalse.length ? allFalse.join(' ') : '30/30 为 false');
console.log('    ⚠️ 已知缺口：句库里那 32 条「被架住」目前没有触发路径。');
console.log('       命中判定只有 hitRoll 的 true/false 两态，没有第三态。');
console.log('       要让它们生效得先有格挡机制（招架值 / 兵器相格 / 防御姿态）——');
console.log('       那是玩法设计，不该由接线的人顺手编。字段留着，机制落地就有地方接。');

/* ================================================================
 * §11 端到端：字段真的从 oneAttack 一路带到 exec() 出口
 * ----------------------------------------------------------------
 * 上面 §1–§8 都是**直接调 oneAttack**，但玩家看到的那一行要穿过四层：
 *   oneAttack → combat.step / world.combatStep → engine.postProcess
 *   → exec() 的 lines → JSON → 前端 appendLog
 * 中间任何一层「只要 kind 和 text」就会把新字段全丢掉，而游戏**照样能跑**，
 * 只是视觉层静默退化成所有伤害一个样。这种退化没人报，所以这里钉住。
 * ================================================================ */
section('§11 端到端：字段穿过四层后还在');

{
  const e2 = new GameEngine({ seed: 20261008 });
  e2.boot();
  e2.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const w2 = e2.world, p2 = w2.player;
  const tgt = w2.spawnNpc('master_yue', p2.room, 1, true);
  p2.hp = p2.maxHp; tgt.hp = tgt.maxHp;
  e2.exec('fight 岳不群');

  let withFields = 0, withoutFields = 0, samples = [];
  for (let i = 0; i < 6; i++) {
    const rr = e2.exec('attack');
    (rr.lines || []).filter((l) => l && l.kind === 'combat').forEach((l) => {
      const full = ('hpRatio' in l) && ('style' in l) && ('crit' in l) &&
        ('missed' in l) && ('aName' in l) && ('tName' in l) && ('dmg' in l);
      if (full) { withFields++; if (samples.length < 3) samples.push(l); } else withoutFields++;
    });
    if (!w2.battle || w2.battle.over) break;
  }
  ok('§11-1 ★ 前提：真的打起来了（否则下面这条是假绿）', withFields + withoutFields > 0,
    (withFields + withoutFields) + ' 条战斗行');
  ok('§11-2 ★ 穿过四层后九个字段一个都没丢', withFields > 0 && withoutFields === 0,
    '带全字段 ' + withFields + ' 条 · 缺字段 ' + withoutFields + ' 条');
  if (samples.length) {
    samples.forEach((l) => {
      console.log('       style=' + l.style + ' hpRatio=' + Number(l.hpRatio).toFixed(3) +
        ' crit=' + l.crit + ' missed=' + l.missed + ' dmg=' + l.dmg +
        '  「' + String(l.text).slice(0, 26) + '」');
    });
  }
  /* 顺带记一笔：这一手就是主人说的「战斗很怪」的第一现场。
     玩家点一次「全力一击」，下面这两条**都是敌人打玩家**，玩家自己那一手没出来。
     真 bug 在 world.js:2784（combat.step 后又 stepEnemyOnly），归 ⑤ 修，这里只记录。 */
  console.log('    （记录）上面这些样本里 aName 是谁 —— 若全是「岳不群」，');
  console.log('       说明「玩家点一次 = 敌人打两次」这个 ⑤ 的 bug 还活着，不是这块的问题。');
}

/* ================================================================ */
console.log('\n' + '─'.repeat(56));
if (fail) console.log('  失败清单：\n    · ' + fails.join('\n    · '));
console.log('── ' + pass + ' 通过 / ' + fail + ' 失败 ──\n');
process.exit(fail ? 1 : 0);
