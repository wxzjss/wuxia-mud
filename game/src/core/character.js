/**
 * character.js — 角色（玩家 / NPC 共用基类）
 *
 * 高自由度设计要点：
 *  - 属性不写死，任何 mod 都能新增属性（baseAttr 是字典）
 *  - 武学不写死，一切武学都来自数据
 *  - 天赋(perk) / 特质(trait) / 称号(title) 完全数据驱动
 */
'use strict';

const { clamp, uid, fmtTime, shichen } = require('./utils');

const BASE_ATTRS = ['力量', '根骨', '身法', '悟性', '福缘', '定力'];

class Character {
  constructor(world, def) {
    def = def || {};
    const w = world;
    this.world = w;
    this.isPlayer = false;
    this.id = def.id || uid('ch');
    this.defId = def.id || null;
    this.name = def.name || '无名氏';
    this.gender = def.gender || 'male';
    this.race = def.race || 'human';
    this.desc = def.desc || '';
    this.title = def.title || '';

    // ---- 属性 ----
    this.baseAttr = Object.assign({ 力量: 10, 根骨: 10, 身法: 10, 悟性: 10, 福缘: 10, 定力: 10 }, def.attr || {});
    this.attrBonus = {};       // 装备/状态加成
    this.attr = {};            // 最终属性（recalc 计算）

    // ---- 等级/经验 ----
    this.level = def.level || 1;
    this.exp = def.exp || 0;
    this.expNext = 100;
    if (this.level > 1) { for (let i = 1; i < this.level; i++) this.exp += this.expNeed(i); }
    this.potential = def.potential || 0;

    // ---- 生命/内力/精力 ----
    this.maxHpBase = def.hp || 100;
    this.maxMpBase = def.mp || 50;
    this.hp = this.maxHpBase;
    this.mp = this.maxMpBase;
    this.maxFood = 100; this.food = 100;
    this.maxWater = 100; this.water = 100;
    this.maxStamina = 100; this.stamina = 100;

    // ---- 攻防 ----
    this.atkBase = def.atk || 5;
    this.defBase = def.def || 2;
    this.dodgeBase = def.dodge || 5;
    this.parryBase = def.parry || 5;
    this.speedBase = def.speed || 10;

    this.atk = 0; this.def = 0; this.dodge = 0; this.parry = 0; this.speed = 0;
    this.critRate = 0.05; this.critDmg = 1.6;
    this.armorPen = 0; this.lifesteal = 0; this.reflect = 0;

    // ---- 武学 ----
    this.learned = {};       // skillId -> {exp, level}
    this.equippedSkills = Object.assign({ 拳: null, 剑: null, 刀: null, 棍: null, 鞭: null, 暗器: null, 内功: null, 轻功: null, 招架: null, 身法: null }, def.skills || {});
    if (def.learned) {
      for (const k of Object.keys(def.learned)) {
        this.learned[k] = { exp: def.learned[k].exp || 0, level: def.learned[k].level || 1 };
      }
    }

    // ---- 装备 ----
    this.equipment = Object.assign({ 头部: null, 颈部: null, 身体: null, 手部: null, 脚部: null, 武器: null, 副手: null, 饰品: null, 戒指: null, 披风: null }, def.equipment || {});
    this.equipped = {};      // slot -> itemId 快捷

    // ---- 状态 ----
    this.buffs = [];         // {name, turns, mods:{}, dot:{}, tag}
    this.money = def.money !== undefined ? def.money : 0;
    this.karma = def.karma || 0;
    this.kills = def.kills || 0;
    this.reputation = def.reputation || {};
    this.perks = (def.perks || []).slice();
    this.traits = (def.traits || []).slice();
    this.titles = (def.titles || []).slice();
    this.insect = def.insect || null;
    this.qi = 0;             // 真气/内力修炼值
    this.age = def.age || 16;

    // ---- 门派 ----
    this.sect = def.sect || null;
    this.rank = def.rank || 0;
    this.sectContribution = 0;

    // ---- 任务 / 标记 / 变量 ----
    this.quests = def.quests || {};   // id -> stage
    this.flags = def.flags || {};     // 任意标记
    this.vars = def.vars || {};       // 任意变量（mod 自由使用）
    this.log = def.log || [];

    // ---- 战斗 ----
    this.inCombat = false;
    this.combatTarget = null;
    this.dead = false;

    // ---- 时间（仅玩家） ----
    this.timeMinutes = def.timeMinutes || 540;

    // 运行时
    this.hostile = !!def.hostile;
    this.isNpc = false;

    this.recalc();
    if (def.hpSet !== undefined) this.hp = def.hpSet;
  }

  expNeed(level) { return Math.floor(100 * Math.pow(1.28, level - 1)); }

  /** 重算派生属性 */
  recalc() {
    const a = Object.assign({}, this.baseAttr);
    for (const k of Object.keys(this.attrBonus)) a[k] = (a[k] || 0) + this.attrBonus[k];

    // 装备加成
    this.attrBonusEquip = {};
    for (const slot of Object.keys(this.equipment)) {
      const it = this.world && this.world.items ? this.world.getItem(this.equipment[slot]) : null;
      if (it && it.stats) {
        for (const k of Object.keys(it.stats)) {
          this.attrBonusEquip[k] = (this.attrBonusEquip[k] || 0) + it.stats[k];
        }
      }
      if (it && it.attr) {
        for (const k of Object.keys(it.attr)) {
          a[k] = (a[k] || 0) + it.attr[k];
        }
      }
    }
    this.attr = a;

    // 基础值派生
    const st = this.attrTotal('根骨'), str = this.attrTotal('力量'), agi = this.attrTotal('身法'), wis = this.attrTotal('悟性');

    let maxHp = this.maxHpBase + st * 12;
    let maxMp = this.maxMpBase + wis * 6;
    let atk = this.atkBase + Math.floor(str * 1.5);
    let def = this.defBase + Math.floor(st * 1.2);
    let dodge = this.dodgeBase + Math.floor(agi * 1.2);
    let parry = this.parryBase + Math.floor((agi + st) * 0.6);
    let speed = this.speedBase + Math.floor(agi * 0.8);
    let critRate = this.critRate, critDmg = this.critDmg, armorPen = 0, lifesteal = 0, reflect = 0;

    // 内功 / 轻功 / 招架 加成
    const neigong = this.equippedSkills['内功'];
    if (neigong && this.learned[neigong]) {
      const s = this.world.getSkill(neigong);
      if (s) {
        const lv = this.skillLevel(neigong);
        maxHp += Math.floor(lv * 1.2);
        maxMp += Math.floor(lv * 1.8) + (s.mpBonus || 0);
        def += Math.floor(lv * 0.3);
      }
    }
    const qinggong = this.equippedSkills['轻功'];
    if (qinggong && this.learned[qinggong]) {
      const lv = this.skillLevel(qinggong);
      dodge += Math.floor(lv * 0.7); speed += Math.floor(lv * 0.3);
    }
    const zhaojia = this.equippedSkills['招架'];
    if (zhaojia && this.learned[zhaojia]) {
      parry += Math.floor(this.skillLevel(zhaojia) * 0.8);
    }

    // 武学加成
    for (const k of Object.keys(this.learned)) {
      const s = this.world.getSkill(k);
      if (!s || !s.bonus) continue;
      const lv = this.skillLevel(k);
      for (const bk of Object.keys(s.bonus)) {
        const v = s.bonus[bk];
        if (typeof v === 'number') {
          if (bk === 'maxHp') maxHp += Math.floor(v * lv / 10);
          else if (bk === 'maxMp') maxMp += Math.floor(v * lv / 10);
          else if (bk === 'atk') atk += Math.floor(v * lv / 20);
          else if (bk === 'def') def += Math.floor(v * lv / 20);
          else if (bk === 'critRate') critRate += v;
        }
      }
    }

    // 特质 / 天赋加成
    for (const t of this.traits.concat(this.perks)) {
      const td = this.world.getTrait(t);
      if (!td) continue;
      if (td.attr) for (const k of Object.keys(td.attr)) { a[k] = (a[k] || 0) + td.attr[k]; }
      if (td.effects) {
        for (const e of [].concat(td.effects)) {
          if (e.type === 'stat') {
            switch (e.key) {
              case 'maxHp': maxHp += e.value; break;
              case 'maxMp': maxMp += e.value; break;
              case 'atk': atk += e.value; break;
              case 'def': def += e.value; break;
              case 'dodge': dodge += e.value; break;
              case 'parry': parry += e.value; break;
              case 'speed': speed += e.value; break;
              case 'critRate': critRate += e.value; break;
              default: break;
            }
          } else if (e.type === 'attr') {
            a[e.key] = (a[e.key] || 0) + e.value;
          } else if (e.type === 'equipSlot') { /* 由 UI 处理 */ }
        }
      }
    }

    // 状态加成
    for (const b of this.buffs) {
      if (b.mods) {
        for (const k of Object.keys(b.mods)) {
          const v = b.mods[k];
          switch (k) {
            case 'maxHp': maxHp += v; break;
            case 'maxMp': maxMp += v; break;
            case 'atk': atk += v; break;
            case 'def': def += v; break;
            case 'dodge': dodge += v; break;
            case 'parry': parry += v; break;
            case 'speed': speed += v; break;
            case 'critRate': critRate += v; break;
            case 'critDmg': critDmg += v; break;
            case 'armorPen': armorPen += v; break;
            case 'lifesteal': lifesteal += v; break;
            case 'reflect': reflect += v; break;
            default: if (a[k] !== undefined) a[k] += v;
          }
        }
      }
    }

    this.attrBonusFinal = {};
    this.maxHp = Math.floor(maxHp);
    this.maxMp = Math.floor(maxMp);
    this.atk = Math.floor(atk);
    this.def = Math.floor(def);
    this.dodge = Math.floor(dodge);
    this.parry = Math.floor(parry);
    this.speed = Math.floor(speed);
    this.critRate = clamp(critRate, 0, 0.95);
    this.critDmg = critDmg;
    this.armorPen = armorPen;
    this.lifesteal = lifesteal;
    this.reflect = reflect;

    this.hp = clamp(this.hp, 0, this.maxHp);
    this.mp = clamp(this.mp, 0, this.maxMp);

    // 进阶属性（高自由度：任何 mod 都能提供 combat 计算）
    this.combatStats = this.world.computeCombatStats ? this.world.computeCombatStats(this) : {};
    return this;
  }

  attrTotal(key) {
    return (this.attr && this.attr[key]) || 0;
  }

  /* ---------------- 武学 ---------------- */

  skillLevel(skillId) {
    const s = this.learned[skillId];
    if (!s) return 0;
    const sd = this.world.getSkill(skillId);
    const max = sd ? (sd.maxLevel || 500) : 500;
    return clamp(s.level, 0, max);
  }

  skillExpNeed(level) {
    return Math.floor(50 * Math.pow(1.18, level - 1));
  }

  learnSkill(skillId, silent) {
    const sd = this.world.getSkill(skillId);
    if (!sd) return { ok: false, msg: `（不存在武学：${skillId}）` };
    if (this.learned[skillId]) return { ok: false, msg: `你已经学过${sd.name}了。` };
    if (sd.require) {
      const ctx = { player: this, world: this.world };
      const { evalCond } = require('./modapi');
      if (!evalCond(sd.require, ctx)) return { ok: false, msg: `${sd.name}的传授条件你尚未满足。` };
    }
    this.learned[skillId] = { exp: 0, level: 1 };
    // 自动装备到空槽
    if (sd.type && !this.equippedSkills[sd.type]) this.equippedSkills[sd.type] = skillId;
    this.recalc();
    return { ok: true, msg: `你学会了「${sd.name}」！` };
  }

  /** 用潜能练级武学（练功） */
  learnSkillByTrain(skillId) {
    const sd = this.world.getSkill(skillId);
    if (!sd) return { ok: false, msg: '（无此武学）' };
    if (!this.learned[skillId]) {
      const r = this.learnSkill(skillId);
      if (!r.ok) return r;
    }
    const cur = this.learned[skillId];
    const maxLv = this.maxSkillLevelFor(sd);
    if (cur.level >= maxLv) return { ok: false, msg: `你的${sd.name}已无法再靠练功提升（上限 ${maxLv} 级，需更高修为）。` };
    const cost = this.trainCost(sd, cur.level);
    if (this.potential < cost) return { ok: false, msg: `潜能不足，本次需要 ${cost} 点潜能，你只有 ${this.potential} 点。` };
    const okRate = this.trainSuccessRate(sd, cur.level);
    this.potential -= cost;
    if (this.world.rng.next() < okRate) {
      this.gainSkillExp(skillId, this.skillExpNeed(cur.level));
      return { ok: true, msg: `你潜心修炼${sd.name}，招式愈发纯熟！` };
    }
    this.gainSkillExp(skillId, Math.floor(this.skillExpNeed(cur.level) * 0.3));
    return { ok: true, msg: `你温习了一遍${sd.name}，虽未突破，但略有心得。` };
  }

  maxSkillLevelFor(sd) {
    const w = this.world;
    // 上限 = 基础 + 悟性/等级 影响。
    // 高自由度：优先用武学自定义公式（mod 的 "learnLimit" 字段或全局函数）
    if (sd.learnLimit) {
      try {
        const { evalTemplate } = require('./modapi');
        const v = parseInt(evalTemplate(String(sd.learnLimit), { player: this, world: w }), 10);
        if (!isNaN(v)) return v;
      } catch (e) { /* ignore */ }
    }
    const doorLimit = sd.maxLevel || 500;
    const wis = this.attrTotal('悟性');
    const neigong = this.equippedSkills['内功'];
    const ngLv = neigong ? this.skillLevel(neigong) : 0;
    const limit = Math.floor(this.level * 6 + wis * 4 + ngLv * 0.8);
    return Math.min(doorLimit, Math.max(10, limit));
  }

  trainCost(sd, level) {
    const base = sd.trainCost || 100;
    return Math.floor(base * Math.pow(1.09, level - 1) * (sd.type === '内功' ? 1.4 : 1));
  }

  trainSuccessRate(sd, level) {
    const wis = this.attrTotal('悟性');
    const dif = sd.difficulty || 1;
    let r = 0.85 + wis * 0.01 - level * 0.004 * dif;
    return clamp(r, 0.05, 0.99);
  }

  gainSkillExp(skillId, exp) {
    const sd = this.world.getSkill(skillId);
    if (!sd || !this.learned[skillId]) return { ok: false, msg: '（未学过该武学）' };
    const s = this.learned[skillId];
    const maxLv = this.maxSkillLevelFor(sd);
    let leveled = 0;
    s.exp += exp;
    while (s.level < maxLv && s.exp >= this.skillExpNeed(s.level)) {
      s.exp -= this.skillExpNeed(s.level);
      s.level++;
      leveled++;
    }
    this.recalc();
    if (leveled > 0) return { ok: true, msg: `${sd.name} 提升到了 ${s.level} 级！`, level: s.level, leveled };
    return { ok: true, msg: `你的${sd.name}熟练度增加了${exp}点。` };
  }

  forgetSkill(skillId) {
    delete this.learned[skillId];
    for (const k of Object.keys(this.equippedSkills)) if (this.equippedSkills[k] === skillId) this.equippedSkills[k] = null;
    this.recalc();
  }

  /* ---------------- 等级 ---------------- */

  gainExp(exp) {
    this.exp += exp;
    let up = 0;
    while (this.exp >= this.expNeed(this.level)) {
      this.exp -= this.expNeed(this.level);
      this.level++; up++;
      this.potential += 50 + this.level * 10;
    }
    if (up) {
      this.hp = this.maxHp; this.mp = this.maxMp;
      if (this.isPlayer) this.world.emit('levelup', { level: this.level });
    }
    this.recalc();
    return up;
  }
  gainPotential(p) { this.potential += p; }

  /* ---------------- 物品 ---------------- */

  countItem(itemId) {
    return (this.inventory || []).filter(i => i === itemId || (this.world.getItem(i) && this.world.getItem(i).stackKey === itemId)).length;
  }
  hasItem(itemId, n) { return this.countItem(itemId) >= (n || 1); }

  /* ---------------- 标记 ---------------- */

  hasFlag(f) { return !!this.flags[f]; }
  setFlag(f, v) { if (v === false || v === undefined) delete this.flags[f]; else this.flags[f] = v; }
  getVar(k) { return this.vars[k]; }
  setVar(k, v) { this.vars[k] = v; }

  /* ---------------- 任务 ---------------- */

  questStage(qid) {
    const v = this.quests[qid];
    if (v === undefined) return this.hasFlag('questdone_' + qid) ? 99 : -1;
    return v;
  }
  setQuestStage(qid, st) {
    this.quests[qid] = st;
    if (st === 99) this.setFlag('questdone_' + qid, true);
  }

  /* ---------------- 门派 ---------------- */

  joinSect(sectId) {
    const sd = this.world.getSect(sectId);
    if (!sd) return { ok: false, msg: '（无此门派）' };
    if (this.sect) return { ok: false, msg: `你已在${this.world.getSect(this.sect) ? this.world.getSect(this.sect).name : this.sect}门下，须先脱离。` };
    if (sd.require) {
      const { evalCond } = require('./modapi');
      if (!evalCond(sd.require, { player: this, world: this.world })) return { ok: false, msg: `${sd.name}不收你这样的弟子。` };
    }
    this.sect = sectId; this.rank = 0;
    if (sd.entryItems) for (const it of sd.entryItems) this.world.giveItem(this, it, 1);
    if (sd.entrySkills) for (const s of sd.entrySkills) this.learnSkill(s);
    this.world.emit('joinsect', { sect: sectId });
    return { ok: true, msg: `你拜入${sd.name}门下，成为一名${sd.ranks ? sd.ranks[0] : '弟子'}。` };
  }
  leaveSect() {
    const old = this.sect;
    this.sect = null; this.rank = 0; this.sectContribution = 0;
    this.world.emit('leavesect', { sect: old });
    return { ok: true, msg: '你脱下门派服饰，从此江湖飘零。' };
  }
  promote() {
    const sd = this.world.getSect(this.sect);
    if (!sd || !sd.ranks) return { ok: false, msg: '你没有门派。' };
    if (this.rank >= sd.ranks.length - 1) return { ok: false, msg: '你已身居高位，无法再升。' };
    const need = (sd.rankCost || 500) * (this.rank + 1);
    if (this.sectContribution < need) return { ok: false, msg: `你的门派贡献不足（需 ${need}，你有 ${this.sectContribution}）。` };
    this.sectContribution -= need;
    this.rank++;
    if (sd.rankSkills && sd.rankSkills[this.rank]) for (const s of sd.rankSkills[this.rank]) this.learnSkill(s);
    return { ok: true, msg: `你被擢升为${sd.ranks[this.rank]}！` };
  }

  /* ---------------- 状态 ---------------- */

  addBuff(buff) {
    const b = Object.assign({ name: '状态', turns: 5, mods: {}, tag: null }, buff);
    // 同 tag 覆盖
    if (b.tag) this.buffs = this.buffs.filter(x => x.tag !== b.tag);
    this.buffs.push(b);
    this.recalc();
    return b;
  }
  removeBuff(name) { this.buffs = this.buffs.filter(b => b.name !== name && b.tag !== name); this.recalc(); }
  hasBuff(name) { return this.buffs.some(b => b.name === name || b.tag === name); }

  /* ---------------- 时间 ---------------- */

  /** 推进时间（转发给 world） */
  advanceTime(min) {
    if (this.world && this.world.advanceTime) this.world.advanceTime(min);
  }

  /* ---------------- 基本信息 ---------------- */

  revive() {
    this.dead = false;
    this.hp = Math.floor(this.maxHp * 0.3);
    this.mp = Math.floor(this.maxMp * 0.3);
    this.buffs = [];
    this.recalc();
  }

  timeText() {
    const t = fmtTime(this.timeMinutes);
    return `${t.text} · ${shichen(this.timeMinutes)}`;
  }
  goldText() {
    const g = Math.floor(this.money / 10000), s = Math.floor((this.money % 10000) / 100), c = this.money % 100;
    let out = [];
    if (g) out.push(`${g}两黄金`);
    if (s) out.push(`${s}两白银`);
    if (c || !out.length) out.push(`${c}文铜钱`);
    return out.join('');
  }
  weaponSkill() {
    const wk = this.equippedSkills['武器'] || this.equippedSkills['剑'];
    return wk || null;
  }
  toJSON() {
    const o = {};
    for (const k of Object.keys(this)) {
      if (k === 'world' || k === 'combatTarget') continue;
      if (typeof this[k] === 'function') continue;
      o[k] = this[k];
    }
    return o;
  }
}

module.exports = { Character, BASE_ATTRS };
