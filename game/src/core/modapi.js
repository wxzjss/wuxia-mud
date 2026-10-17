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
 *     "giveRandom:itemA:itemB:itemC"   → 随机给一件（池子用 : 分隔）
 *   结构化对象：{ type:"...", ... }
 */

'use strict';

const { clamp, fuzzyFind } = require('./utils');

/* 可直接比较的数值字段 */
const NUM_FIELDS = ['level', 'money', 'exp', 'pot', 'potential', 'hp', 'maxHp', 'mp', 'maxMp',
  'karma', 'kills', 'age', 'rank', 'sectContribution', 'day', 'time', 'realm',
  /* 「这屋里地上有几件东西」—— 制作器「一键捡光」预设的提示就是 `room.items>0`。
     不加进白名单的话，`{room: '>0'}` 会因为 key 不在名单里被**整条跳过（恒为真）**，
     作者以为写了门槛，实际没有门槛（本项目最忌的静默失效）。 */
  'roomItems'];

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
    case 'roomItems': return (w && w.itemsIn && w.itemsIn(p.room) || []).length;
    case 'roomNpcs': return ((w && w.npcsIn && w.npcsIn(p.room)) || []).length;
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
    /* `room.items>0` / `room.npcs>0` 归一成白名单里的真字段。
       ⚠️ 不做这一步的后果是**恒为真**（key 不在 NUM_FIELDS ⇒ 整条被跳过），
       而制作器的示例提示写的正是 `room.items>0` —— 作者照着填等于没填。 */
    const cs = String(cond)
      .replace(/^room\.items\b/, 'roomItems')
      .replace(/^room\.npcs\b/, 'roomNpcs');
    // 简写 "flag:xxx" / "money>=100"
    const m = String(cs).match(/^([a-zA-Z_]+)\s*(>=|<=|==|!=|>|<)\s*(.+)$/);
    if (m) return evalCond({ [m[1]]: `${m[2]}${m[3]}` }, ctx);
    // "!combat" / "!某flag" 简写
    const n = String(cs).match(/^!([a-zA-Z_]+)$/);
    if (n) {
      if (n[1] === 'combat') return evalCond({ notCombat: true }, ctx);
      if (n[1] === 'tuning') return evalCond({ notTuning: true }, ctx);
      return evalCond({ notFlag: n[1] }, ctx);
    }
    /* 🔴 2026-10-15 主人批准（Mod 站教程盘点批）：
       速查表里教的 `flag:x` / `hasitem:x` / `item:x` / `sect:x` 这类字符串简写，
       原先全部落进兜底的 `{flag:'key:value'}` 分支 —— hasitem/sect 等一律**恒假**，
       谁照文档写谁静默失效（实测：`rep>=500` 声望 60 也过、`hasitem:长剑` 身上有也 false）。
       ⇒ 认一份已知键的 `key:value` 映射（数值键走上面的简写，不在这里）；
         `hasitem:x:n` / `item:x:n` 第 三 段当 count。没列进表的键仍按老兜底走，不改变旧行为。 */
    const kv = String(cs).match(/^([a-zA-Z_]+):(.+)$/);
    if (kv) {
      const [, kk, vv] = kv;
      const segs = vv.split(':');
      if (kk === 'flag') return evalCond({ flag: segs[0] }, ctx);
      if (kk === 'hasitem' || kk === 'item') return evalCond({ item: segs[0], count: segs[1] !== undefined ? (parseFloat(segs[1]) || 1) : 1 }, ctx);
      /* equip:x —— 装备位上有某物品（木瓢案，字符串简写与对象键同口径） */
      if (kk === 'equip') return evalCond({ equip: segs[0] }, ctx);
      if (kk === 'sect') return evalCond({ sect: vv }, ctx);
      if (kk === 'sectNot') return evalCond({ sectNot: vv }, ctx);
      if (kk === 'gender') return evalCond({ gender: vv }, ctx);
      if (kk === 'race') return evalCond({ race: vv }, ctx);
      if (kk === 'region') return evalCond({ region: vv }, ctx);
      if (kk === 'title') return evalCond({ title: vv }, ctx);
      if (kk === 'perk') return evalCond({ hasPerk: vv }, ctx);
      if (kk === 'quest') return evalCond({ quest: segs[0], stage: segs[1] !== undefined ? parseInt(segs[1], 10) : undefined }, ctx);
      if (kk === 'questdone') return evalCond({ questDone: segs[0] }, ctx);
      if (kk === 'chance') return evalCond({ chance: parseFloat(vv) || 0 }, ctx);
    }
    return evalCond({ flag: cs }, ctx);
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
  /* 是否「正坐着吐纳」（主人 2026-10-11 追加）。
     为什么需要这一条：官方示例「轻松江湖」的「脱战回血」是 `onTick +hp:8`，
     而吐纳恰好一轮 = 30 分钟 = 一个 tick —— 于是每轮回 8 点，
     把吐纳本身扣的那点气血**整整齐齐补回去**，玩家一点消耗都感觉不到
     （实测「吐纳三轮血一点没掉」，就是这么来的）。
     现在那条规则的条件是 `!combat && !tuning`：坐着熬气不算「歇着」，不该回血。
     写成通用条件而不是只改那一个 mod，是因为别人写的回血/回气规则同样会踩这个坑。 */
  if (cond.notTuning && p.vars && p.vars.tuning) return false;
  if (cond.tuning && !(p.vars && p.vars.tuning)) return false;
  // 多标记
  if (cond.flagsAll) { for (const f of [].concat(cond.flagsAll)) if (!p.hasFlag(f)) return false; }
  if (cond.flagsAny) { if (![].concat(cond.flagsAny).some(f => p.hasFlag(f))) return false; }
  if (cond.flagsNone) { for (const f of [].concat(cond.flagsNone)) if (p.hasFlag(f)) return false; }

  // 简化写法：{ level: ">=10" } / { kills: ">=5" } / { money: 100 }
  for (const rawKey of Object.keys(cond)) {
    /* 对象写法也认 `{'room.items': '>0'}`（与字符串写法同一套别名）。 */
    const key = rawKey === 'room.items' ? 'roomItems' : rawKey === 'room.npcs' ? 'roomNpcs' : rawKey;
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
  /* 装备位上有某物品（木瓢案 · 主人 2026-10-17）：{equip:"mu_piao"} ——
     ch.equipment / p.equipped 任一槽挂着这件物品即算。
     与 cond.item（查背包）分工：装备中的东西**已离开背包**，item 查不到它——
     「装备了木瓢去倒水」之前恒吃 failMsg 就是这个缝。
     ⚠️ cond.equipped 按槽位名查（{equipped:'手持'}），本键按物品 id 查，别混。 */
  if (cond.equip !== undefined) {
    const eq = p.equipment || {}, eqd = p.equipped || {};
    const on = Object.values(eq).some(v => v === cond.equip) ||
               Object.values(eqd).some(v => v === cond.equip);
    if (!on) return false;
  }

  // 身份
  if (cond.gender !== undefined && p.gender !== cond.gender) return false;
  /* 主线线别（design/67 §5 P1 的配套）：
     `{line:'orthodox'}` / `{lineNot:'outlaw'}` / `{fromMod:true}` / `{birth:'noble'}` / `{act:">=3"}`。
     为什么要有这一段：主线分化是「同一件事三种走法」，数据侧只能靠条件分流；
     没有这几个键，`require.line` 会被 evalCond **当普通 var 读** → 永远 0 → 永远不成立
     （又一个「不报错就是不生效」）。老档没有 `p.mainline` 时按出身现补一次，绝不抛。 */
  if (cond.line !== undefined || cond.lineNot !== undefined || cond.fromMod !== undefined
      || cond.birth !== undefined || cond.act !== undefined) {
    /* ⚠️ **必须无条件走一次 `stateOf`**：`act` 不是存下来的字段，是 `derivedAct()` 从
       「幕主任务进度」**推**出来的，而推力就写在 `stateOf` 里。
       原来这里写的是「只有 `p.mainline` 不存在时才 stateOf」——
       于是读 `{act:">=2"}` 时拿到的是**开局的旧值 1**（实测：第一幕都做完了，判定还是 false）。
       这类「读派生字段却读了缓存」的坑跟 `act` 本身一样隐蔽。 */
    let ml = null;
    try { ml = require('./mainline').stateOf(p); } catch (e) { ml = p.mainline || null; }
    if (!ml) ml = { line: 'neutral', act: 1, fromMod: false };
    if (cond.line !== undefined) {
      const want = [].concat(cond.line);
      if (!want.includes(ml.line)) return false;
    }
    if (cond.lineNot !== undefined && [].concat(cond.lineNot).includes(ml.line)) return false;
    if (cond.fromMod !== undefined && !!ml.fromMod !== !!cond.fromMod) return false;
    if (cond.birth !== undefined && [].concat(cond.birth).includes(p.birth) === false) return false;
    if (cond.act !== undefined) {
      const c = parseCmp(cond.act);
      if (!cmp(ml.act || 1, c.op, c.num)) return false;
    }
  }
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

/**
 * 把条件里的 chance 键**递归剥掉**（拷贝上做，不改原数据）。
 * 字符串简写 `chance:0.4` 也认——剥完没条件了，等价 {always:true}。
 *
 * 为什么需要它（79 件 · 主人真机 2026-10-17「此地可做前置隐藏」）：
 *   cond 评估 false 的 action 不进「此地可做」行，但 **chance 不是前置** ——
 *   概率门是「做了才掷」的成败门。列行/视图时评它有两个害处：
 *     ① evalCond 的 chance 分支走 w.rng.next() —— 每次 look/view 都偷吃 rng 流，
 *        seed 回放、测试确定性全乱；
 *     ② 随掷骰结果闪现闪没（这眼「钓鱼」在列、下一眼没了）。
 *   混合条件（flag + chance）里 flag 部分仍是真前置（没挪缸就该藏），
 *   所以剥键而不是整条跳过。执行期照旧评全量 cond，chance 在点下去那一刻掷。
 * 消费点：engine.roomActionsView（场景栏保底）。
 */
function stripChanceCond(c) {
  if (typeof c === 'string') {
    return /^chance\s*:/.test(c.trim()) ? { always: true } : c;
  }
  if (Array.isArray(c)) return c.map(stripChanceCond);
  if (c && typeof c === 'object') {
    const o = {};
    for (const k of Object.keys(c)) {
      if (k === 'chance') continue;
      o[k] = stripChanceCond(c[k]);
    }
    return o;
  }
  return c;
}

/**
 * 只留**进度旗标**部分的门（79 件收窄口径，游有方 2026-10-17 裁）：
 *   主人原话盖的是「只能做一次且做过的事情不再显示」——旗标族（序列噪声）；
 *   「够不着的不显示」是我方推测，不加戏。于是「此地可做」行的 cond 隐藏
 *   **只认旗标键**，资源/资格/概率门（钱/物/技能/时辰/性别/chance）一律剥掉
 *   —— 露脸本身在教玩家「目标存在」（愿望梯不是噪声源），那句 failMsg
 *   就是设计好的「还差多少」显示；钱会流动、技能会涨、时辰会转，门自然解除。
 *
 * 保留（旗标族 + 逻辑容器，容器**递归**处理子件）：
 *   flag / notFlag / flagsAll / flagsAny / flagsNone /
 *   quest / questDone / questNotDone（进度族与 flag 同源：questdone_x 旗标）
 * 剥掉（其余一切键：money / item / count / chance / skill / attr / rep / var /
 *   time / dayMin / dayMax / gender / race / sect / …——白名单外全剥，前向兼容）。
 * 字符串简写同口径：`flag:x` / `!x` / 裸名（evalCond 兜底当 flag）→ 保留；
 *   `chance:x` / `money>=100` / `hasitem:x` / `sect:x` / `gender:x` 等 → 剥成
 *   {always:true}。剥完为空 → 恒真（列）。
 *
 * 消费点：commands.lookRoom（日志「此地可做」行的 cond 隐藏）。
 * ⚠️ 与 stripChanceCond 分工：那函数只防偷 rng（roomActionsView 仍要评资源门
 *   出 ok:false+reason），本函数是「该不该藏」的裁剪——不要互相替代。
 */
const FLAG_KEYS = { flag: 1, notFlag: 1, flagsAll: 1, flagsAny: 1, flagsNone: 1,
  quest: 1, questDone: 1, questNotDone: 1 };
const CONTAINER_KEYS = { and: 1, or: 1, not: 1 };
function flagGateCond(c) {
  if (typeof c === 'string') {
    const s = c.trim();
    /* 保留：!flag 简写 / flag:x 简写 / quest(:done) 简写 / 裸名（evalCond 兜底当 flag） */
    if (/^!/.test(s) || /^(flag|questdone|quest)\s*:/i.test(s)) return c;
    /* 数值比较简写（money>=10）与已知资源/资格键简写 → 剥 */
    if (/^([a-zA-Z_]+)\s*(>=|<=|==|!=|>|<)/.test(s)) return { always: true };
    if (/^(hasitem|item|chance|sect|sectNot|gender|race|region|title|perk|equip)\s*:/i.test(s)) return { always: true };
    return c;   /* 裸字符串名：evalCond 会当 flag 用 → 旗标，保留 */
  }
  if (Array.isArray(c)) return c.map(flagGateCond);
  if (c && typeof c === 'object') {
    const o = {};
    for (const k of Object.keys(c)) {
      if (CONTAINER_KEYS[k]) { o[k] = flagGateCond(c[k]); continue; }
      if (FLAG_KEYS[k]) { o[k] = c[k]; continue; }
      /* 白名单外（money/item/chance/skill/…）一律剥 */
    }
    return o;
  }
  return c;
}

/**
 * 「此地可做」行的**隐藏裁决**（79 续 · 主人原话口径，2026-10-17 二次收窄）：
 *   · **重复动作一律显示**，cond 不参与列行（不被 cond 干掉）；
 *   · 隐藏只限 **once 族**（`once:true` 或带 `hideWhenFlag` 的动作）：
 *       ① once 已完成（hideWhenFlag 旗标已置）→ 藏；
 *       ② once 前置未满足（cond 的旗标部分没过，如「信」等挪缸）→ 藏。
 *   once 族内部 cond 仍走 flagGateCond（只认旗标键，资源门不参与隐藏）。
 *
 * 重复族豁免的含义：钓鱼/采药/打坐/看日出这类 repeatable 动作，
 * 就算 cond 现在不过（钱不够/时辰不对/chance），也**照列**——
 * 愿望梯不是噪声源；chance 本来就不许在列行评（偷 rng），这里整个 cond
 * 都不评，性质自然保住。执行期照旧评全量 cond 吃 failMsg。
 *
 * 判「once 族」看两个标记：`once:true`（数据侧显式声明）或
 * `hideWhenFlag`（完成即退场，游有方六步链批落的字段）——二者有其一即算。
 * ctx = { player, world }。
 * 消费点：commands.lookRoom（日志行）+ engine.roomActionsView（场景栏保底）。
 */
function onceHidden(a, ctx) {
  if (!a) return false;
  const onceFam = a.once === true || !!a.hideWhenFlag;
  if (!onceFam) return false;                       /* 重复族：永不因 cond 藏 */
  const p = ctx && ctx.player;
  if (a.hideWhenFlag && p && p.hasFlag && p.hasFlag(a.hideWhenFlag)) return true;
  if (a.cond) return !evalCond(flagGateCond(a.cond), ctx || {});
  return false;
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
    /* ⚠️ 对象式 effect 有两种写法：`{type, args:[...]}` 与 `{type, raw:'...'}`。
       后者只写 raw、**没有 args**，于是下面用 `args[0]` 的效果（incvar / decvar /
       flag / unflag / item / skill…）全都取到 `undefined` —— 不报错、只是**静默不生效**。
       实测踩过：「青楼招揽」写的是 `{type:'incvar', raw:'q_brothel_host'}`，
       点一次计数不动一格 ⇒ 支线「楼里的门道」永远完不成 ⇒ 男性玩家永远卖不了身。
       修法：raw 有值而 args 为空时，把 raw 按 `:` 拆成 args（与字符串式 parseEffectString
       同源），两种写法等价。放在这里，所有 `args[i]` 效果一并受益。 */
    if ((!args || !args.length) && typeof rawVal === 'string' && rawVal) {
      args = splitArgs(rawVal);
    }
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
    /* 疗伤/止血类：清持续伤害 buff（2026-10-18 QA 独立验收 #3-b）。
       文案说「金创药能止住」就必须真能止住，否则玩家白花钱——这是文案承诺，
       不是描述性文字。args[0] 支持三种写法：
         'dot'        → 清所有 dot_ 前缀（流血/创口/中毒这类持续伤害）
         'dot_创口'   → 只清同名 tag
         '创口'       → 按 buff 名或 tag 清
       守卫 tools/copy-promise-check.js 会拿真实 buff 验一遍，别再只写文案。 */
    case 'cure': {
      const what = String((eff.args && eff.args[0]) || 'poison');
      const before = (p.buffs || []).length;
      if (what === 'dot') p.buffs = (p.buffs || []).filter(b => !/^dot_/.test(b.tag || ''));
      else p.buffs = (p.buffs || []).filter(b => b.name !== what && b.tag !== what && b.tag !== ('dot_' + what));
      if ((p.buffs || []).length !== before) {
        if (p.recalc) p.recalc();
        out.push({ kind: 'sys', text: '伤口的血止住了。' });
      }
      break;
    }

    case '-hp': p.hp = clamp(p.hp - num(0, 0), 0, p.maxHp); break;
    case '+mp': p.mp = clamp(p.mp + num(0, 0), 0, p.maxMp); break;
    /* 内力**上限**（走 maxMpBase，与吐纳/采补同一根轴）。
       加它是为了让那 16 处「参悟石壁 / 观景顿悟」有个真正落地的收益 ——
       主人亲定的规矩是「内力关乎武学等级上限」，而吐纳一次只涨 1 点，
       所以参悟一次给几点上限是既有体系内的东西，不是新开一套。
       单次设上限 50，防着数据写错一冲就破表。 */
    case '+maxmp': case 'maxmp+': {
      const add = Math.max(0, Math.min(50, num(0, 0)));
      p.maxMpBase = (p.maxMpBase || 50) + add;
      p.recalc();
      p.mp = Math.min(p.maxMp, p.mp + add);
      out.push({ kind: 'sys', text: `你只觉内息绵长了一些（内力上限 +${add}）。` });
      break;
    }
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

    /* 门派贡献（design/95 §二 L2：卷二门派武学兑换线索用）。
       写法：contrib:门派名:数值 —— 数值**正负都行**（负数=扣）。
       记账走玩家唯一的 p.sectContribution 台账（与差事/拜师同一根轴），
       args[0] 的门派名只用于回执文案与「是否本门」校验，不另开分支账本。
       贡献不为负（扣到 0 为止），与 -money 同规。 */
    case 'contrib': case '+contrib': case '-contrib': {
      const sectName = args[0] || p.sect || '本门';
      let delta = num(1, 0);
      if (type === '-contrib' && delta > 0) delta = -delta;   // -contrib:门派:50 = 扣 50
      if (delta < 0) {
        const before = p.sectContribution || 0;
        p.sectContribution = Math.max(0, before + delta);
        out.push({ kind: 'sys', text: `你在${sectName}的贡献少了 ${before - p.sectContribution}（现 ${p.sectContribution}）。` });
      } else {
        p.sectContribution = (p.sectContribution || 0) + delta;
        out.push({ kind: 'sys', text: `你在${sectName}的贡献 +${delta}（现 ${p.sectContribution}）。` });
      }
      break;
    }

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
    /* 随机给一件：`randomitem` 是引擎真名，`giveRandom` 是头注释/教程写法 ——
       🔴 实测缺口（2026-10-13 mod 能力盘点）：作者照文档写 giveRandom 会静默落空
       （unknown → customEffects 查不到 → 一行不出）。补成别名，两种写法等价。 */
    case 'randomitem': case 'giveRandom': {
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
      /* ⚠️ 这里必须 force：`learnskill` 效果 = **有人把功夫交到你手上**
         （奇遇高人授艺 / 剧情传承 / 秘籍直接传功），不是玩家自己照着图谱练。
         若在这里卡「须先学会基础武学」，大量奇遇会**静默变成一句提示**，
         玩家根本不知道绝世武学为什么没到手。
         玩家自学那两条路（读书 `teach`、`train`）照旧走校验，一点没松。 */
      const r = p.learnSkill(args[0], { force: true });
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
        /* 结局兜底（2026-10-18，半成品审计第 8 项）：quest 定义带 endingOnComplete
           且当前还没有 final 结局 → 落兜底。三选一结局若已先落 final，这里不覆盖。 */
        const fb = require('./endings').onQuestDone(w, p, qd);
        if (fb) out.push(fb);
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
      /* 🔴 实测缺口（2026-10-13 mod 能力盘点）：原先这里是死代码
         （`const r = w.getRoom(args[0]); break;`）—— 写了等于没写，一声不吭。
         按字面语义补上：`combatWith:<npcId>` → 找场上活实例开打；
         找不到人（没刷出来 / id 写错）要**说一声**，不许静默。 */
      const npc = w.findLiveNpc(args[0]);
      if (npc) { w.startCombat(p, npc.id); }
      else out.push({ kind: 'warn', text: `（此地找不到「${args[0]}」，这一架没打成。）` });
      break;
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
      /* 结局树三写（design/89，S5 上线；2026-10-15 预留批）：
         flag / var 是老口径（老前端/老 mod 可能还在读），保留不断；
         p.ending = 新结构台账（achieved 集合 + final 指针），S5 前端切读它。
         ⚠️ 2026-10-18 收口：落定逻辑抽到 endings.grant（唯一入口）——
            与任务完成兜底（endingOnComplete）共用一份三写，别再各写一遍。 */
      out.push(require('./endings').grant(p, args[0], args[1] || args[0]));
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
      /* ⚠️ B29：这里原先只写 `w.getNpc(args[0])` —— 而 `World.getNpc` 同名两处定义、
         后者覆盖前者，真正查的是 `instances.npcs`（键 = `npc_xxx` 实例 id）。
         效果数据里写的是 **defId**（如 `favor:npcv_180:5`）→ 取到 undefined →
         `if (npc)` 静默 false → **给指定 NPC 加好感全部打空**
         （连累 262 条 `sq_npcv_*` 支线的好感奖励，且不报错）。
         改用 `findLiveNpc(defId)`：按 defId 跨房间取场上活实例，找不到才就地 spawn。 */
      const npc = w.findLiveNpc(args[0]);
      if (npc) {
        /* 走 world.gainFavor：正向好感会过「口才便给」天赋倍率（B3） */
        if (typeof w.gainFavor === 'function') w.gainFavor(npc, num(1, 1));
        else npc.favor = (npc.favor || 0) + num(1, 1);
        /* 有画像的人给个情绪反馈（与「送礼」同一口径），没有画像就静默加数值 */
        if (npc.pstate) npc.pstate.met = true;
      }
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

module.exports = { evalCond, evalEffect, evalEffects, evalTemplate, isValidEffectString, cmp, parseCmp, stripChanceCond, flagGateCond, onceHidden };
