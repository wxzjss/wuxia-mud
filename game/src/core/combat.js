/**
 * combat.js — 战斗系统（回合制 / 自动战斗）
 *
 * 高自由度设计：
 *  - 伤害公式可被 mod 全局覆盖（world.combatHooks.damage / hitRoll / onTurn）
 *  - 武学招式完全数据驱动，支持 mod 添加任意特殊效果
 *  - 支持群战、buff、持续伤害、反伤、吸血、破防
 */
'use strict';

const { clamp } = require('./utils');

const DEFAULT_HOOKS = {
  // 命中判定：返回 bool
  hitRoll(attacker, defender, skill, ctx) {
    const acc = (ctx.acc || 80) + (attacker.attrTotal('身法') || 0);
    const eva = defender.dodge + (defender.attrTotal('身法') || 0) * 1.5;
    const chance = clamp(acc / (acc + eva * 0.6), 0.25, 0.97);
    return ctx.world.rng.next() < chance;
  },
  // 伤害计算
  damage(attacker, defender, base, ctx) {
    const pen = ctx.armorPen || 0;
    let d = base * (ctx.mult || 1);
    d = d * (100 / (100 + defender.def * (1 - Math.min(0.7, pen))));
    // 随机浮动
    d *= 0.85 + ctx.world.rng.next() * 0.3;
    return Math.max(1, Math.floor(d));
  },
  // 每回合开始
  onTurn(actor, target, ctx) { return []; },
  // 战斗结束
  onEnd(result, ctx) { return []; },
};

class CombatEngine {
  constructor(world) {
    this.world = world;
  }

  get hooks() { return this.world.combatHooks; }

  /** 玩家 vs NPC 或 多对多 */
  makeBattle(attackers, defenders) {
    const battle = {
      turn: 0,
      attackers,
      defenders,
      log: [],
      over: false,
      winner: null,
      startedAt: this.world.clockMinutes,
    };
    for (const a of [].concat(attackers).concat(defenders)) {
      for (const c of [].concat(a)) {
        c.inCombat = true;
      }
    }
    return battle;
  }

  /** 执行一回合：player 阵营先手，按 speed 排序 */
  step(battle) {
    if (battle.over) return battle;
    battle.turn++;
    const w = this.world;
    const lines = [];

    const all = [];
    for (const side of ['attackers', 'defenders']) {
      const force = [].concat(battle[side]);
      for (const c of force) {
        for (const u of (c.isSquad ? c.members : [c])) {
          if (!u.dead && u.hp > 0) all.push({ u, side, leader: c });
        }
      }
    }
    all.sort((a, b) => (b.u.speed + w.rng.int(0, 5)) - (a.u.speed + w.rng.int(0, 5)));

    for (const ent of all) {
      if (battle.over) break;
      const u = ent.u;
      if (u.dead || u.hp <= 0) continue;

      // buff 结算
      this.tickBuffs(u, lines, battle);

      const enemies = this.enemiesOf(all, ent);
      if (!enemies.length) continue;
      const targetEnt = this.pickTarget(u, enemies, battle);
      if (!targetEnt) continue;
      const t = targetEnt.u;

      const isPlayerSide = ent.side === 'attackers';
      // 是否用武学
      const useSkill = this.pickSkill(u, t);
      const attacks = useSkill && useSkill.hits ? useSkill.hits : this.baseAttackCount(u, t);

      for (let i = 0; i < attacks; i++) {
        if (t.hp <= 0) break;
        const r = this.oneAttack(u, t, useSkill, battle, i);
        if (r) lines.push(r);
      }
      // 反伤 / 吸血已在 oneAttack 内处理

      if (t.hp <= 0) {
        this.onDeath(t, battle, lines, isPlayerSide);
      }
      if (isPlayerSide && [].concat(battle.defenders).every(c => this.forceDead(c))) {
        battle.over = true; battle.winner = 'attackers';
      }
      if (!isPlayerSide && [].concat(battle.attackers).every(c => this.forceDead(c))) {
        battle.over = true; battle.winner = 'defenders';
      }
      // 逃跑判定
      if (battle.fleeing) { battle.over = true; battle.winner = 'flee'; break; }
    }

    battle.log = battle.log.concat(lines);
    if (!battle.over && battle.turn > 60) { battle.over = true; battle.winner = 'draw'; }
    return { battle, lines };
  }

  forceDead(c) {
    if (c.isSquad) return c.members.every(m => m.hp <= 0 || m.dead);
    return c.hp <= 0 || c.dead;
  }
  enemiesOf(all, ent) {
    return all.filter(x => x.side !== ent.side && x.u.hp > 0 && !x.u.dead);
  }
  pickTarget(u, enemies, battle) {
    // 优先玩家的当前目标
    if (u.isPlayer && u.combatTarget) {
      const hit = enemies.find(e => e.u.id === u.combatTarget);
      if (hit) return hit;
    }
    if (u.targetId) {
      const hit = enemies.find(e => e.u.id === u.targetId);
      if (hit) return hit;
    }
    // 最低血量优先
    return enemies.slice().sort((a, b) => a.u.hp - b.u.hp)[0] || null;
  }
  baseAttackCount(u, t) {
    const diff = u.speed - t.speed;
    let n = 1;
    if (diff > 15) n = 2;
    if (diff > 40) n = 3;
    return n;
  }
  pickSkill(u, t) {
    // 选择已装备的武器武学；若无，用拳法
    const slots = ['剑', '刀', '棍', '鞭', '暗器', '拳'];
    for (const s of slots) {
      const id = u.equippedSkills[s];
      if (id && u.learned[id]) {
        const sd = this.world.getSkill(id);
        if (sd) return sd;
      }
    }
    const fist = u.equippedSkills['拳'];
    if (fist && u.learned[fist]) return this.world.getSkill(fist);
    return null;
  }

  oneAttack(u, t, skill, battle, idx) {
    const w = this.world;
    const sName = skill ? skill.name : '普通攻击';
    const lv = skill ? u.skillLevel(skill.id) : 0;

    // 内力消耗
    if (skill && skill.mpCost) {
      if (u.mp < skill.mpCost) {
        if (idx === 0) return { kind: 'combat', text: `${u.name}内力不济，只能以拳脚相搏。` };
        return null;
      }
      u.mp -= skill.mpCost;
    }

    const ctx = {
      world: w,
      skill,
      acc: skill ? (skill.accuracy || 80) + Math.floor(lv * 0.5) : 85,
      mult: skill ? (skill.damageMult || 1) * (1 + lv * 0.012) : 1,
      armorPen: u.armorPen,
      critRate: u.critRate + (skill ? (skill.critBonus || 0) : 0),
      critDmg: u.critDmg + (skill ? (skill.critDmgBonus || 0) : 0),
    };
    if (w.combatHooks.hitRoll) {
      const hitFn = w.combatHooks.hitRoll;
      if (!hitFn(u, t, skill, ctx)) {
        return { kind: 'combat', text: `${u.name}${skill ? '一招“' + skill.name + '”' : '的攻击'}被${t.name}闪身避过。` };
      }
    }

    let base = u.atk * (skill ? (1 + lv * 0.02) : 1);
    let dmg = w.combatHooks.damage ? w.combatHooks.damage(u, t, base, ctx) : ctx.mult * base;
    dmg = Math.max(1, Math.floor(dmg * (ctx.mult || 1)));

    // 暴击
    let crit = false;
    if (w.rng.next() < ctx.critRate) {
      crit = true;
      dmg = Math.floor(dmg * ctx.critDmg);
    }

    // 特殊效果
    let extraText = '';
    if (skill && skill.effects) {
      for (const eff of [].concat(skill.effects)) {
        const r = this.applySkillEffect(eff, u, t, skill, battle);
        if (r && r.text) extraText += r.text;
      }
    }

    t.hp = clamp(t.hp - dmg, 0, t.maxHp);

    // 吸血
    if (w.combatHooks.damage && u.lifesteal) {
      const heal = Math.floor(dmg * u.lifesteal);
      if (heal > 0) { u.hp = clamp(u.hp + heal, 0, u.maxHp); }
    }
    // 反伤
    if (t.reflect) {
      const rf = Math.floor(dmg * t.reflect);
      if (rf > 0) u.hp = clamp(u.hp - rf, 0, u.maxHp);
    }

    const name = u.isPlayer ? '你' : u.name;
    const tname = t.isPlayer ? '你' : t.name;
    let text = `${name}${skill ? '使出一招「' + skill.name + '」' : '挥拳'}，击中${tname}`;
    if (crit) text += `，正中要害（暴击）`;
    text += `，造成 ${dmg} 点伤害。`;
    if (extraText) text += extraText;
    if (t.hp <= 0) text += ` ${tname}${t.isPlayer ? '' : '闷哼一声，'}倒地不起！`;
    return { kind: 'combat', text };
  }

  applySkillEffect(eff, u, t, skill, battle) {
    const w = this.world;
    let text = '';
    switch (eff.type) {
      case 'dot': {
        t.addBuff({ name: eff.name || '持伤', turns: eff.turns || 3, mods: {}, tag: 'dot_' + (eff.name || 'x'), dot: { value: eff.value || 5, source: u.id } });
        text += ` ${t.name}中了${eff.name || '暗伤'}。`;
        break;
      }
      case 'stun':
        if (w.rng.next() < (eff.chance || 0.2)) { t.addBuff({ name: '暈眩', turns: eff.turns || 1, tag: 'stun' }); text += ` ${t.name}被打得气血翻涌，动作一滞。`; }
        break;
      case 'slow':
        t.addBuff({ name: '迟缓', turns: eff.turns || 2, mods: { speed: -(eff.value || 5) }, tag: 'slow' });
        text += ` ${t.name}身法为之一滞。`; break;
      case 'buff':
        u.addBuff({ name: eff.name || '蓄势', turns: eff.turns || 3, mods: eff.mods || { atk: 5 }, tag: 'buff_' + (eff.name || 'x') });
        text += ` ${u.name}气势一盛。`; break;
      case 'debuff':
        t.addBuff({ name: eff.name || '受挫', turns: eff.turns || 3, mods: eff.mods || { def: -5 }, tag: 'debuff_' + (eff.name || 'x') });
        break;
      case 'drain': {
        const v = Math.floor(t.mp * (eff.ratio || 0.3));
        t.mp = Math.max(0, t.mp - v); u.mp = Math.min(u.maxMp, u.mp + v);
        text += ` ${t.name}内力被引走！`; break;
      }
      case 'ignoreDef':
        text += ''; break;
      case 'heal':
        u.hp = clamp(u.hp + (eff.value || 20), 0, u.maxHp); text += ` ${u.name}真气流转，伤势略复。`; break;
      case 'extraHit': {
        const n = eff.value || 1;
        for (let i = 0; i < n; i++) {
          if (t.hp <= 0) break;
          const r = this.oneAttack(u, t, null, battle, 1);
          if (r) text += ' ' + r.text;
        }
        break;
      }
      case 'custom': {
        const fn = w.effectFns[eff.fn];
        if (typeof fn === 'function') {
          const out = fn({ args: eff.args || [], skill }, { world: w, player: u, target: t, battle });
          if (typeof out === 'string') text += ' ' + out;
        }
        break;
      }
      case 'cond': {
        const { evalCond } = require('./modapi');
        if (evalCond(eff.if, { player: u, world: w, target: t })) {
          for (const e of [].concat(eff.then || [])) {
            const r = this.applySkillEffect(e, u, t, skill, battle);
            if (r && r.text) text += r.text;
          }
        } else if (eff.else) {
          for (const e of [].concat(eff.else)) {
            const r = this.applySkillEffect(e, u, t, skill, battle);
            if (r && r.text) text += r.text;
          }
        }
        break;
      }
      default: break;
    }
    return { text };
  }

  tickBuffs(u, lines, battle) {
    const remain = [];
    for (const b of u.buffs) {
      if (b.dot) {
        const src = this.findChar(battle, b.dot.source);
        const dmg = Math.floor((b.dot.value || 3) * (1 + (u.level || 1) * 0.05));
        u.hp = clamp(u.hp - dmg, 0, u.maxHp);
        lines.push({ kind: 'combat', text: `${u.name}因${b.name}受损 ${dmg} 点。` });
        if (u.hp <= 0) { lines.push({ kind: 'combat', text: `${u.name}不支倒地！` }); continue; }
      }
      b.turns--;
      if (b.turns > 0) remain.push(b);
    }
    if (remain.length !== u.buffs.length) { u.buffs = remain; u.recalc(); }
    // 恢复
    const regen = Math.floor(u.maxMp * 0.02) + 1;
    u.mp = clamp(u.mp + regen, 0, u.maxMp);
  }
  findChar(battle, id) {
    const all = [].concat(battle.attackers, battle.defenders);
    for (const c of all) {
      if (c.id === id) return c;
      if (c.isSquad && c.members.some(m => m.id === id)) return c.members.find(m => m.id === id);
    }
    return null;
  }

  onDeath(t, battle, lines, tIsDefender) {
    t.dead = true; t.hp = 0; t.buffs = [];
    const w = this.world;
    if (t.isPlayer) {
      lines.push({ kind: 'combat', text: '你眼前一黑，倒了下去……' });
      return;
    }
    lines.push({ kind: 'combat', text: `${t.name}喷出一口鲜血，就此气绝。` });
    w.onNpcKilled(t, battle);
    if (w.combatHooks.onDeath) w.combatHooks.onDeath(t, battle);
  }
}

module.exports = { CombatEngine, DEFAULT_HOOKS };
