/**
 * modapi.js — Mod 公开 API（条件 & 效果 解释器）
 *
 * 这是 Mod 系统的地基：所有 mod 里的"条件"和"效果"都用声明式 JSON 描述，
 * 引擎在这里统一解释执行，Mod 作者不需要写一行代码，小白也能做 mod。
 *
 * 条件 Cond：
 *   { always:true }
 *   { flag:"xxx" } / { notFlag:"xxx" }
 *   { var:"money", op:">=", value:100 }
 *   { level:">=10" } { attr:"力量", ">=":20 } { skill:"基本剑法", ">=":50 }
 *   { item:"长剑" } { item:"长剑", count:2 }
 *   { gender:"male" } { race:"human" }
 *   { sect:"华山派" } { sectNot:"少林派" }
 *   { room:"huashan_jianzhen" } { region:"huashan" }
 *   { time:{min:360,max:1080} } { season:"spring" }
 *   { quest:"quest_id", stage:2 } { questDone:"quest_id" }
 *   { kills:">=10" } { karma:">=100" } { rep:"华山派", ">=":50 }
 *   { chance:0.3 }
 *   { hasTitle:"剑客" } { hasPerk:"ironbody" }
 *   { and:[...] } { or:[...] } { not:{...} }
 *
 * 效果 Effect（字符串指令 或 结构化对象）：
 *   字符串 DSL（推荐给小白）：
 *     "say:你好啊"                → 输出文本
 *     "me:抱拳一礼"               → 动作行
 *     "+money:100"                → 加钱
 *     "-money:100"                → 扣钱
 *     "+exp:50" "+pot:30" "+hp:20" "+mp:10" "+karma:5" "+rep:华山派:10"
 *     "+item:长剑:1"              → 给物品
 *     "-item:长剑:1"              → 收物品
 *     "+skill:基本剑法:10"        → 武学经验
 *     "+attr:力量:2"              → 属性
 *     "goto:room_id"              → 移动
 *     "teleport:room_id"          → 瞬移
 *     "combat:npc_id"             → 进入战斗
 *     "flag:xxx"                  → 设标记
 *     "unflag:xxx"
 *     "var:xxx=1"
 *     "quest:quest_id:stage"      → 设置任务阶段
 *     "questdone:quest_id"
 *     "spawn:npc_id:room_id:count"
 *     "sound:xxx"
 *     "title:剑客"
 *     "menu:选单文本:optA>effA|optB>effB"   → 弹出选项
 *     "heal" "fullheal" "die" "ending:xxx"
 *     "log:记录内容"
 *     "giveRandom:itemA|itemB|itemC"
 *   结构化对象：{ type:"...", ... }
 */

'use strict';

const { clamp, fuzzyFind } = require('./utils');

/* 可直接比较的数值字段 */
const NUM_FIELDS = ['level', 'money', 'exp', 'pot', 'potential', 'hp', 'maxHp', 'mp', 'maxMp',
  'karma', 'kills', 'age', 'rank', 'sectContribution', 'day', 'time', 'realm'];

/* 武学境界档位（删等级后，衡量玩家进度的统一标准）。
   与 engine.realmName 同一套分档，这里返回数值档位供条件比较：
   0 不通武艺 / 1 初窥门径 / 2 小有所成 / 3 登堂入室 / 4 炉火纯青 / 5 登峰造极 */
function realmLevel(p) {
  let sum = 0;
  for (const k of Object.keys(p.learned || {})) sum += (p.learned[k] && p.learned[k].level) || 0;
  if (sum <= 0) return 0;
  if (sum < 30) return 1;
  if (sum < 100) return 2;
  if (sum < 300) return 3;
  if (sum < 800) return 4;
  return 5;
}

function fieldValue(p, w, key, cond) {
  switch (key) {
    case 'level': return p.level;
    case 'money': return p.money;
    case 'exp': return p.exp;
    case 'pot': case 'potential': return p.potential;
    case 'hp': return p.hp;
    case 'maxHp': return p.maxHp;
    case 'mp': return p.mp;
    case 'maxMp': return p.maxMp;
    case 'karma': return p.karma;
    case 'kills': return p.kills;
    case 'age': return p.age || 0;
    case 'rank': return p.rank || 0;
    case 'sectContribution': return p.sectContribution || 0;
    case 'day': return Math.floor(p.timeMinutes / 1440) + 1;
    case 'time': return p.timeMinutes % 1440;
    case 'realm': return realmLevel(p);
    case 'attr': return p.attrTotal(cond.attr || cond.key || '力量');
    case 'skill': return p.skillLevel(cond.skill || cond.key || '');
    case 'rep': return p.reputation[cond.rep || cond.key || '*'] || 0;
    case 'var': return p.getVar(cond.var || cond.key) || 0;
    default: return p.getVar(key) || 0;
  }
}

/* ------------------------------------------------------------------ *
 * 条件解释
 * ------------------------------------------------------------------ */
function parseCmp(v) {
  // ">=10" → {op:">=", num:10}
  if (typeof v === 'number') return { op: '>=', num: v };
  const s = String(v).trim();
  const m = s.match(/^(>=|<=|==|!=|>|<)?\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return { op: '>=', num: 0 };
  return { op: m[1] || '>=', num: parseFloat(m[2]) };
}
function cmp(a, op, b) {
  switch (op) {
    case '>': return a > b;
    case '>=': return a >= b;
    case '<': return a < b;
    case '<=': return a <= b;
    case '==': case '=': return a === b;
    case '!=': return a !== b;
    default: return a >= b;
  }
}

/**
 * 求值条件。ctx = { player, world }
 */
function evalCond(cond, ctx) {
  if (cond === undefined || cond === null) return true;
  if (typeof cond === 'boolean') return cond;
  if (typeof cond === 'string') {
    // 简写 "flag:xxx" / "money>=100"
    const m = String(cond).match(/^([a-zA-Z_]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
    if (m) return evalCond({ [m[1]]: `${m[2]}${m[3]}` }, ctx);
    // "!combat" / "!某flag" 简写
    const n = String(cond).match(/^!([a-zA-Z_]+)$/);
    if (n) {
      if (n[1] === 'combat') return evalCond({ notCombat: true }, ctx);
      return evalCond({ notFlag: n[1] }, ctx);
    }
    return evalCond({ flag: cond }, ctx);
  }
  if (Array.isArray(cond)) return cond.every(c => evalCond(c, ctx));
  const p = ctx.player, w = ctx.world;
  const V = k => p.getVar(k);

  // 逻辑组合
  if (cond.and) return cond.and.every(c => evalCond(c, ctx));
  if (cond.or) return cond.or.some(c => evalCond(c, ctx));
  if (cond.not) return !evalCond(cond.not, ctx);
  if (cond.always !== undefined) return !!cond.always;

  // 标记
  if (cond.flag && !p.hasFlag(cond.flag)) return false;
  if (cond.notFlag && p.hasFlag(cond.notFlag)) return false;
  // 战斗状态（功能 Mod「脱战回血」等用）
  if (cond.notCombat && (w.battle || p.inCombat)) return false;
  if (cond.combat && !(w.battle || p.inCombat)) return false;
  // 多标记
  if (cond.flagsAll) { for (const f of [].concat(cond.flagsAll)) if (!p.hasFlag(f)) return false; }
  if (cond.flagsAny) { if (![].concat(cond.flagsAny).some(f => p.hasFlag(f))) return false; }
  if (cond.flagsNone) { for (const f of [].concat(cond.flagsNone)) if (p.hasFlag(f)) return false; }

  // 简化写法：{ level: ">=10" } / { kills: ">=5" } / { money: 100 }
  for (const key of Object.keys(cond)) {
    if (!NUM_FIELDS.includes(key)) continue;
    if (key === 'rank') continue;
    const c = parseCmp(cond[key]);
    if (!cmp(fieldValue(p, w, key, cond), c.op, c.num)) return false;
  }
  // 简化写法：{ attr: "力量", ">=": 20 } 或 { "力量>=":20 }
  if (cond.attr !== undefined) {
    const sub = Object.keys(cond).find(k => ['>=', '>', '<=', '<', '==', '!='].includes(k));
    if (sub !== undefined) {
      const c = parseCmp(cond[sub]);
      if (!cmp(p.attrTotal(cond.attr), c.op, c.num)) return false;
    } else if (typeof cond.attr === 'object') {
      for (const k of Object.keys(cond.attr)) {
        if (!cmp(p.attrTotal(k), '>=', cond.attr[k])) return false;
      }
    } else if (cond.value !== undefined) {
      const c = parseCmp(cond.value);
      if (!cmp(p.attrTotal(cond.attr), c.op, c.num)) return false;
    }
  }
  // 简化写法：{ skill: "基本剑法", ">=": 50 }
  if (cond.skill !== undefined) {
    const sub = Object.keys(cond).find(k => ['>=', '>', '<=', '<', '==', '!='].includes(k));
    if (sub !== undefined) {
      const c = parseCmp(cond[sub]);
      if (!cmp(p.skillLevel(cond.skill), c.op, c.num)) return false;
    } else if (cond.value !== undefined) {
      const c = parseCmp(cond.value);
      if (!cmp(p.skillLevel(cond.skill), c.op, c.num)) return false;
    }
  }
  // 声望 { rep:"华山派", ">=":50 }
  if (cond.rep !== undefined) {
    const sub = Object.keys(cond).find(k => ['>=', '>', '<=', '<', '==', '!='].includes(k));
    if (sub !== undefined) {
      const c = parseCmp(cond[sub]);
      if (!cmp(p.reputation[cond.rep] || 0, c.op, c.num)) return false;
    } else if (cond.value !== undefined) {
      const c = parseCmp(cond.value);
      if (!cmp(p.reputation[cond.rep] || 0, c.op, c.num)) return false;
    }
  }
  // 变量 { var:"xxx", op:">=", value:10 }
  if (cond.var !== undefined) {
    let c;
    const sub = Object.keys(cond).find(k => ['>=', '>', '<=', '<', '==', '!='].includes(k));
    if (sub !== undefined) c = parseCmp(cond[sub]);
    /* ⚠️ 补 `op:` 支持（2026-10-11，W5 事件库落地时发现）：
       设计文档与画像 hooks 一律写 `{var, op, value}`，但原代码**无视 `op`**，
       直接 `parseCmp(value)`（数值 → 默认 `>=`）→ 写 `op:'<'` 会**静默变成 `>=`**
       （又一个「不报错就是不生效」的坑）。这里**纯增量**地认 `op`
       （有运算符键时仍以运算符键为准，行为不变；无 op 时行为不变，仍默认 `>=`）。 */
    else if (typeof cond.op === 'string' && ['>=', '>', '<=', '<', '==', '!='].includes(cond.op.trim())) {
      c = parseCmp(cond.value); c.op = cond.op.trim();
    } else if (cond.value !== undefined) c = parseCmp(cond.value);
    else c = { op: '>=', num: 0 };
    if (!cmp(p.getVar(cond.var) || 0, c.op, c.num)) return false;
  }
  // 直接比较语法 { "money>=": 100 }
  for (const k of Object.keys(cond)) {
    const m = k.match(/^([a-zA-Z_\u4e00-\u9fa5]+)\s*(>=|<=|==|!=|>|<)$/);
    if (!m) continue;
    const key = m[1], op = m[2];
    const c = parseCmp(cond[k]);
    if (key === 'rank') { if (!cmp(p.rank || 0, op, c.num)) return false; continue; }
    if (key === 'var') { if (!cmp(p.getVar(cond.var) || 0, op, c.num)) return false; continue; }
    if (key === 'attr') { if (!cmp(p.attrTotal(cond.attr), op, c.num)) return false; continue; }
    if (key === 'skill') { if (!cmp(p.skillLevel(cond.skill), op, c.num)) return false; continue; }
    if (key === 'rep') { if (!cmp(p.reputation[cond.rep] || 0, op, c.num)) return false; continue; }
    if (!cmp(fieldValue(p, w, key, cond), op, c.num)) return false;
  }
  if (cond.skills !== undefined) {
    for (const s of [].concat(cond.skills)) {
      if (!p.learned[s] || p.skillLevel(s) < (cond.skillsMin || 1)) return false;
    }
  }
  if (cond.noSkill) { if (p.learned[cond.noSkill]) return false; }

  // 物品
  if (cond.item !== undefined) {
    if (p.countItem(cond.item) < (cond.count || 1)) return false;
  }
  if (cond.equipped !== undefined) { if (!p.equipped[cond.equipped]) return false; }
  if (cond.noItem !== undefined) { if (p.countItem(cond.noItem) > 0) return false; }

  // 身份
  if (cond.gender !== undefined && p.gender !== cond.gender) return false;
  if (cond.race !== undefined && p.race !== cond.race) return false;
  if (cond.sect !== undefined && p.sect !== cond.sect) return false;
  if (cond.sectNot !== undefined && p.sect === cond.sectNot) return false;
  if (cond.noSect && p.sect) return false;
  if (cond.hasSect && !p.sect) return false;
  if (cond.rank !== undefined) {
    if (typeof cond.rank === 'number') { if ((p.rank || 0) !== cond.rank) return false; }
    else { const c = parseCmp(cond.rank); if (!cmp(p.rank || 0, c.op, c.num)) return false; }
  }
  if (cond.title !== undefined && !(p.titles || []).includes(cond.title)) return false;
  if (cond.hasPerk !== undefined && !p.perks.includes(cond.hasPerk)) return false;
  if (cond.hasTrait !== undefined && !(p.traits || []).includes(cond.hasTrait)) return false;
  if (cond.insect && !p.insect) return false;

  // 位置
  if (cond.room !== undefined) {
    const ids = [].concat(cond.room);
    if (!ids.includes(p.room)) return false;
  }
  if (cond.roomNot !== undefined) { if ([].concat(cond.roomNot).includes(p.room)) return false; }
  if (cond.region !== undefined) {
    const r = w.getRoom(p.room);
    if (!r || r.region !== cond.region) return false;
  }

  // 时间
  if (cond.time) {
    const m = p.timeMinutes % 1440;
    const mn = cond.time.min !== undefined ? cond.time.min : 0;
    const mx = cond.time.max !== undefined ? cond.time.max : 1440;
    if (mn <= mx ? (m < mn || m > mx) : (m < mn && m > mx)) return false;
  }
  if (cond.season !== undefined && w.season() !== cond.season) return false;
  if (cond.weather !== undefined && w.weather !== cond.weather) return false;
  if (cond.dayMin !== undefined && Math.floor(p.timeMinutes / 1440) + 1 < cond.dayMin) return false;
  if (cond.dayMax !== undefined && Math.floor(p.timeMinutes / 1440) + 1 > cond.dayMax) return false;

  // 任务
  if (cond.quest !== undefined) {
    const st = p.questStage(cond.quest);
    if (cond.stage !== undefined) { if (st !== cond.stage) return false; }
    else if (st < 0) return false;
  }
  if (cond.questDone !== undefined) {
    const list = [].concat(cond.questDone);
    for (const q of list) {
      if (!p.hasFlag('questdone_' + q)) return false;
    }
  }
  if (cond.questNotDone !== undefined && p.hasFlag('questdone_' + cond.questNotDone)) return false;

  // 概率
  if (cond.chance !== undefined) {
    const roll = w.rng.next();
    let c = cond.chance;
    if (c > 1) c = c / 100;
    if (roll >= c) return false;
  }

  // 自定义函数式条件（功能 mod 注入）
  if (cond.fn && typeof w.condFns[cond.fn] === 'function') {
    return !!w.condFns[cond.fn]({ ...cond.args }, ctx);
  }

  return true;
}

/* ------------------------------------------------------------------ *
 * 效果解释
 * ------------------------------------------------------------------ */

/** 展开效果列表 */
function evalEffects(effects, ctx) {
  if (!effects) return [];
  return [].concat(effects).map(e => evalEffect(e, ctx)).flat().filter(Boolean);
}

function parseEffectString(str) {
  // 处理 "menu:.." 特殊
  const idx = str.indexOf(':');
  if (idx < 0) return { type: str.trim(), args: [] };
  const type = str.slice(0, idx).trim();
  const rest = str.slice(idx + 1);
  return { type, raw: rest, args: splitArgs(rest) };
}
function splitArgs(s) {
  // 用 : 分隔，但 menu 用不同语法，单独处理
  return s.split(':').map(x => x.trim());
}

/**
 * 执行单个效果。可能有副作用：返回 { logs:[], menu:{} }
 * ctx 额外包含 out(logs 收集器)
 */
function evalEffect(eff, ctx) {
  if (!eff) return [];
  const w = ctx.world, p = ctx.player;
  const out = [];

  // 条件包装 { if: cond, then: [...], else: [...] }
  if (eff && typeof eff === 'object' && eff.if !== undefined && !eff.type) {
    const ok = evalCond(eff.if, ctx);
    return evalEffects(ok ? eff.then : eff.else, ctx);
  }
  /* ⚠️ 条件包装的**另一种写法**：`{ type:'cond', if, then, else }`
     （地图数据里 temple「搜查」就是这种）。
     上一条if 要求 `!eff.type`，而这条偏偏带了 type:'cond'，
     于是掉进下面的「纯条件 → 忽略」分支，**返回空数组**——
     玩家点「搜查」按钮，界面一行字都不出，看起来就是按钮坏了。
     所以这里补上带 type 的分支，两种写法都认。 */
  if (eff && typeof eff === 'object' && eff.type === 'cond' && eff.if !== undefined) {
    const ok = evalCond(eff.if, ctx);
    return evalEffects(ok ? eff.then : eff.else, ctx);
  }
  // 纯条件（用于剧情节点判断）——忽略
  if (eff && typeof eff === 'object' && eff.type === 'cond') return [];

  let type, args, rawVal = '';
  if (typeof eff === 'string') {
    const pe = parseEffectString(eff);
    type = pe.type; args = pe.args; rawVal = pe.raw;
  } else {
    type = eff.type; args = eff.args || [];
    rawVal = eff.raw;
  }
  const raw = rawVal || (typeof eff === 'object' ? args.join(':') : '');

  const num = (i, d) => { const n = parseFloat(args[i]); return isNaN(n) ? (d || 0) : n; };

  switch (type) {
    case 'say':
      out.push({ kind: 'story', text: raw });
      break;
    case 'me':
      out.push({ kind: 'action', text: raw });
      break;
    case 'log':
      out.push({ kind: 'log', text: raw });
      break;
    case 'narrate':
      out.push({ kind: 'story', text: raw });
      break;

    // 资源
    case '+money': case 'money+': case 'addmoney':
      p.money += num(0, 0); out.push({ kind: 'sys', text: `你获得了 ${num(0, 0)} 文钱。` }); break;
    case '-money': case 'money-': case 'submoney':
      p.money = Math.max(0, p.money - num(0, 0)); out.push({ kind: 'sys', text: `你花掉了 ${num(0, 0)} 文钱。` }); break;
    case 'money': case 'setmoney': p.money = num(0, 0); break;
    case '+exp': case 'exp+': p.gainExp(num(0, 0)); out.push({ kind: 'sys', text: `你增长了 ${num(0, 0)} 点经验。` }); break;
    case '-exp': p.exp = Math.max(0, p.exp - num(0, 0)); break;
    case '+pot': case 'pot+': p.gainPotential(num(0, 0)); out.push({ kind: 'sys', text: `你增长了 ${num(0, 0)} 点潜能。` }); break;
    case '-pot': p.potential = Math.max(0, p.potential - num(0, 0)); break;
    case '+hp': p.hp = clamp(p.hp + num(0, 0), 0, p.maxHp); break;
    case '-hp': p.hp = clamp(p.hp - num(0, 0), 0, p.maxHp); break;
    case '+mp': p.mp = clamp(p.mp + num(0, 0), 0, p.maxMp); break;
    case '-mp': p.mp = clamp(p.mp - num(0, 0), 0, p.maxMp); break;
    case 'sethp': p.hp = clamp(num(0, 1), 0, p.maxHp); break;
    case 'heal': p.hp = p.maxHp; p.mp = p.maxMp; out.push({ kind: 'sys', text: '你感觉全身经脉畅通，伤痛尽去。' }); break;
    case 'fullheal': p.hp = p.maxHp; p.mp = p.maxMp; p.food = p.maxFood; p.water = p.maxWater;
      out.push({ kind: 'sys', text: '你精神饱满，神完气足。' }); break;
    /* 饮食：+food / +water 用于「吃东西 / 喝水」等场景，可带数值，默认 +50 */
    case '+food': p.food = clamp(p.food + num(0, 50), 0, p.maxFood);
      out.push({ kind: 'sys', text: '你吃了点东西，肚子舒服多了。' }); break;
    case '+water': case 'quench': p.water = clamp(p.water + num(0, 50), 0, p.maxWater);
      out.push({ kind: 'sys', text: '你饮下清水，喉咙不再干渴。' }); break;
    case '+karma': p.karma += num(0, 0); out.push({ kind: 'sys', text: `你的正邪之气变化了 ${num(0, 0)}。` }); break;
    case '+rep': {
      const who = args[0] || '*'; const v = num(1, 0);
      p.reputation[who] = (p.reputation[who] || 0) + v;
      out.push({ kind: 'sys', text: `你在${who}的声望提高了 ${v}。` }); break;
    }
    case '-rep': {
      const who = args[0] || '*'; const v = num(1, 0);
      p.reputation[who] = (p.reputation[who] || 0) - v; break;
    }
    case '+kill': p.kills += num(0, 1); break;

    // 物品
    case '+item': case 'item+': {
      const id = args[0]; const n = num(1, 1);
      const r = w.giveItem(p, id, n);
      out.push({ kind: 'sys', text: r.ok ? `你获得了 ${r.name}${n > 1 ? ' x' + n : ''}。` : `（无法获得物品：${id}）` });
      break;
    }
    case '-item': case 'item-': {
      const id = args[0]; const n = num(1, 1);
      const r = w.removeItem(p, id, n);
      out.push({ kind: 'sys', text: r.ok ? `你失去了 ${r.name}${n > 1 ? ' x' + n : ''}。` : `（你没有 ${id}）` });
      break;
    }
    case 'randomitem': {
      const id = w.rng.pick(args.filter(Boolean));
      if (id) { const r = w.giveItem(p, id, 1); out.push({ kind: 'sys', text: `你得到了 ${r.name}。` }); }
      break;
    }
    case '+equip':
      w.giveItem(p, args[0], 1, { silent: true }); break;

    // 能力
    case '+skill': case 'skill+': {
      const r = p.gainSkillExp(args[0], num(1, 0));
      out.push({ kind: 'sys', text: r.msg }); break;
    }
    case 'learnskill': {
      const r = p.learnSkill(args[0]);
      out.push({ kind: 'sys', text: r.msg }); break;
    }
    case 'forgetskill': p.forgetSkill(args[0]); break;
    case 'learn': {
      // learn:技能id (需要潜能与等级，引擎自动处理)
      const r = p.learnSkillByTrain(args[0]);
      out.push({ kind: 'sys', text: r.msg }); break;
    }
    case '+attr': {
      const a = args[0]; const v = num(1, 1);
      p.baseAttr[a] = (p.baseAttr[a] || 0) + v;
      p.recalc();
      out.push({ kind: 'sys', text: `你的${a}提高了 ${v} 点。` }); break;
    }
    case '-attr': {
      const a = args[0]; const v = num(1, 1);
      p.baseAttr[a] = Math.max(1, (p.baseAttr[a] || 0) - v); p.recalc(); break;
    }
    case '+perk': p.perks.push(args[0]); out.push({ kind: 'sys', text: `你领悟了新的天赋：${args[0]}。` }); break;
    case '-perk': p.perks = p.perks.filter(x => x !== args[0]); break;
    case '+trait': if (!p.traits.includes(args[0])) p.traits.push(args[0]); break;
    case '+title': case 'title': {
      p.titles = p.titles || [];
      if (!p.titles.includes(args[0])) { p.titles.push(args[0]); out.push({ kind: 'sys', text: `你获得了称号「${args[0]}」。` }); }
      break;
    }
    case '+buff': case 'buff': case 'addbuff': {
      if (args[0]) { p.addBuff(args[0]); out.push({ kind: 'sys', text: `你施下符箓，周身泛起灵光（${args[0].name || '增益'}）。` }); }
      break;
    }

    // 位置
    case 'goto': case 'move': {
      const r = w.movePlayerTo(p, args[0]);
      if (!r.ok) out.push({ kind: 'sys', text: `（无法前往：${args[0]}）` });
      break;
    }
    case 'teleport': w.movePlayerTo(p, args[0]); break;
    case 'spawn': w.spawnNpc(args[0], args[1] || p.room, num(2, 1)); break;
    case 'despawn': w.despawnNpc(args[0], args[1] || p.room); break;

    // 任务
    case 'quest': {
      const q = args[0], st = num(1, 0);
      p.setQuestStage(q, st);
      const qd = w.data.quests[q];
      if (qd) out.push({ kind: 'quest', text: `【任务】${qd.name} — ${(qd.stages && qd.stages[st] && qd.stages[st].desc) || '进行中'}` });
      break;
    }
    case 'questdone': case 'finishquest': {
      const q = args[0];
      const qd = w.data.quests[q];
      p.setQuestStage(q, 99); p.setFlag('questdone_' + q);
      if (qd) {
        out.push({ kind: 'quest', text: `【任务完成】${qd.name}` });
        if (qd.rewards) evalEffects(qd.rewards, ctx).forEach(x => out.push(x));
      }
      break;
    }
    case 'questfail': p.setQuestStage(args[0], -2); p.setFlag('questfailed_' + args[0]); break;

    // 标记 / 变量
    case 'flag': case 'setflag': p.setFlag(args[0], true); break;
    case 'unflag': case 'clearflag': p.setFlag(args[0], false); break;
    case 'toggleflag': p.setFlag(args[0], !p.hasFlag(args[0])); break;
    case 'var': {
      const expr = raw;
      const m = expr.match(/^([^=]+)=\s*(.+)$/);
      if (m) {
        const k = m[1].trim(); let v = m[2].trim();
        const nm = v.match(/^-?\d+(\.\d+)?$/);
        if (nm) v = parseFloat(v);
        else if (v === 'true') v = true; else if (v === 'false') v = false;
        p.setVar(k, v);
      }
      break;
    }
    case 'incvar': p.setVar(args[0], (p.getVar(args[0]) || 0) + num(1, 1)); break;
    case 'decvar': p.setVar(args[0], (p.getVar(args[0]) || 0) - num(1, 1)); break;

    // 战斗
    case 'combat': case 'fight': w.startCombat(p, args[0]); break;
    case 'combatWith': {
      // combatWith:room:npcId
      const r = w.getRoom(args[0]); break;
    }
    /* 玩家**不会死，只会力竭昏倒**（主人要求：昏倒 → 最近客栈醒转）。
       mod 里的 `die` 效果沿用同一口径：置昏倒标记 + 计数（走 world.playerDeath 唯一入口），
       真正的「搬回客栈 + 扣钱」由 engine 的苏醒流程统一做。 */
    case 'die':
      p.hp = 0;
      if (typeof w.playerDeath === 'function') w.playerDeath(); else p.dead = true;
      out.push({ kind: 'faint', text: '你眼前一黑……' });
      break;
    case 'damage': {
      p.hp = clamp(p.hp - num(0, 1), 0, p.maxHp); break;
    }

    // 交互
    case 'menu': {
      // menu:标题|选项A>效果;;选项B>效果
      const parts = raw.split('|');
      const title = parts[0] || '请选择';
      const rawOpts = (parts[1] || '').split(';;').filter(Boolean);
      const opts = rawOpts.map(o => {
        const m = o.match(/^([^>]+)>\s*(.*)$/);
        if (!m) return { label: o.trim(), effects: [] };
        return { label: m[1].trim(), effects: m[2].split(';').map(s => s.trim()).filter(Boolean) };
      }).filter(o => o.label);
      out.push({ kind: 'menu', title, options: opts });
      break;
    }
    case 'dialog': {
      const parts = raw.split('|');
      out.push({ kind: 'dialog', title: parts[0] || '对话', text: parts[1] || '' });
      break;
    }
    case 'ask': {
      const parts = raw.split('|');
      out.push({ kind: 'ask', title: parts[0], text: parts[1] || '' });
      break;
    }
    case 'ending': {
      p.setFlag('ending_' + args[0], true);
      p.setVar('ending', args[0]);
      out.push({ kind: 'ending', text: args[0], title: args[1] || args[0] });
      break;
    }
    case 'sound': out.push({ kind: 'sound', text: args[0] }); break;
    case 'hint': out.push({ kind: 'sys', text: raw }); break;
    case 'warn': out.push({ kind: 'warn', text: raw }); break;
    /* rumor:<seedId>[:roomId] —— 世界事件把「风声」落进传闻系统（design/27 §2.6）。
       subject 默认 'world'（非玩家 → 不结算玩家声望，R4 守卫）；
       silent:true 免目击（天灾/械斗本来就是「大家都知道的事」，不要求有人在场）。
       生成成功时把该传闻的当前说法直接排一行 —— 玩家当场就「听得到」。 */
    case 'rumor': {
      if (w && typeof w.addRumor === 'function' && args[0]) {
        const r = w.addRumor(args[0], { room: args[1] || p.room, subject: 'world', silent: true });
        if (r && typeof w.fillRumorText === 'function') out.push({ kind: 'story', text: w.fillRumorText(r) });
      }
      break;
    }

    // 时间
    case 'sleep': p.advanceTime(num(0, 60)); break;
    case 'wait': out.push({ kind: 'wait', ms: num(0, 500), text: '' }); break;

    // 门派
    case 'joinSect': {
      const r = p.joinSect(args[0]);
      out.push({ kind: 'sys', text: r.msg }); break;
    }
    case 'leaveSect': p.leaveSect(); break;
    case 'promote': {
      const r = p.promote(); out.push({ kind: 'sys', text: r.msg }); break;
    }

    // NPC 好感
    case 'favor': {
      const npc = w.getNpc(args[0]);
      if (npc) { npc.favor = (npc.favor || 0) + num(1, 1); }
      break;
    }

    // 自定义效果（功能 mod 注册）
    case 'fn': case 'call': {
      const fname = args[0];
      if (typeof w.effectFns[fname] === 'function') {
        const r = w.effectFns[fname]({ args: args.slice(1), raw }, ctx);
        if (Array.isArray(r)) r.forEach(x => out.push(x));
        else if (typeof r === 'string') out.push({ kind: 'story', text: r });
      }
      break;
    }

    default:
      // 未知效果：尝试 room/quest 自定义键
      if (type && w.customEffects[type]) {
        const r = w.customEffects[type](args, ctx);
        if (Array.isArray(r)) r.forEach(x => out.push(x));
      }
      break;
  }
  return out;
}

/** 纯查询：不产生副作用地评估文本模板 */
function evalTemplate(tpl, ctx) {
  if (typeof tpl !== 'string') return tpl;
  return tpl.replace(/\{([^}]+)\}/g, (m, expr) => {
    const p = ctx.player, w = ctx.world;
    const e = expr.trim();
    if (e === 'name') return p.name;
    if (e === 'level') return String(p.level);
    if (e === 'money') return String(p.money);
    if (e === 'hp') return String(p.hp);
    if (e === 'maxHp') return String(p.maxHp);
    if (e === 'mp') return String(p.mp);
    if (e === 'sect') return p.sect || '无门无派';
    if (e === 'room') { const r = w.getRoom(p.room); return r ? r.name : '未知'; }
    if (e === 'region') { const r = w.getRoom(p.room); return r ? (w.data.regions[r.region] && w.data.regions[r.region].name) || r.region : ''; }
    if (e === 'time') return String(p.timeMinutes % 1440);
    if (e === 'day') return String(Math.floor(p.timeMinutes / 1440) + 1);
    if (e.startsWith('var:')) return String(p.getVar(e.slice(4)) || 0);
    if (e.startsWith('attr:')) return String(p.attrTotal(e.slice(5)));
    if (e.startsWith('skill:')) return String(p.skillLevel(e.slice(6)));
    return m;
  });
}

/** 文本可解析为条件的判定（供 mod 制作器用） */
function isValidEffectString(s) {
  const t = String(s).split(':')[0].trim();
  return !!t && /^[+\-a-zA-Z_][a-zA-Z0-9_+\-]*$/.test(t);
}

module.exports = { evalCond, evalEffect, evalEffects, evalTemplate, isValidEffectString, cmp, parseCmp };
