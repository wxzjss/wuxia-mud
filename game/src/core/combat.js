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
const { profTierOf, profTierMult, profTierAcc } = require('./character');

/**
 * defenseOf(u) —— 取一个战斗单位的**防御力数值**（唯一入口，别再直接读 u.def）。
 *
 * 背景（SPRINT1-ENG-02，P0）：`def` 这个字段名撞了两次——
 *   · world.spawnNpc() 把 NPC 实例上的 def 写成模板对象（data.npcs[defId]）；
 *   · 旧版 Character.recalc() 又把同一个 def 写成防御力数字。
 * 于是伤害公式里「100 / (100 + 防御力 × (1 − 破防))」这一段，
 * 防御力取到的是模板对象，做乘法直接变 NaN；
 * `Math.max(1, Math.floor(NaN))` 仍是 NaN，最后写回 hp → 玩家打谁都不掉血。
 *
 * 裁决：**`def` 只保留一个含义 = 模板对象引用；防御力数值改由 `defFinal` 承载。**
 * 三层兜底是为了兼容旧存档（旧档里 def 被序列化成了数字，且没有 defFinal）：
 *   ① defFinal（新档 / 新代码）  ② 数字形态的 def（旧档）  ③ defBase（模板原始防御力）
 * 绝不返回 undefined / NaN / 对象。
 */
function defenseOf(u) {  if (!u) return 0;
  if (typeof u.defFinal === 'number') return Number.isFinite(u.defFinal) ? u.defFinal : 0;
  if (typeof u.def === 'number') return Number.isFinite(u.def) ? u.def : 0;
  return typeof u.defBase === 'number' && Number.isFinite(u.defBase) ? u.defBase : 0;
}

/**
 * 武器绑定（SPRINT2）：刀/枪/棍/剑/鞭/暗器/音波 须装备对应兵刃，否则威力大打折扣。
 * 拳脚无需武器。返回 { mult, acc, note }。
 */
const WEAPON_REQUIRED = { 剑: true, 刀: true, 棍: true, 鞭: true, 暗器: true, 音波: true };
function weaponPenalty(u, skill) {
  if (!skill || !WEAPON_REQUIRED[skill.type]) return { mult: 1, acc: 0, note: null };
  const wpn = u.equipment && u.equipment['武器'];
  const item = wpn ? u.world.getItem(wpn) : null;
  const reqType = skill.type === '音波' ? '音波' : skill.type;
  const ok = item && (item.weaponType === reqType || (reqType === '音波' && item.category === '乐器'));
  if (ok) return { mult: 1, acc: 0, note: null };
  return { mult: 0.45, acc: -25, note: `手中无${skill.type}类兵刃，威力大减` };
}

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
    /* 走 defenseOf()，别直接读 defender 上的 def —— 那是 NPC 模板对象，乘出来是 NaN */
    d = d * (100 / (100 + defenseOf(defender) * (1 - Math.min(0.7, pen))));
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
      /* Boss 阶段：血掉到阈值就切（必须在行动前、buff 之后——
         buff 的 turns 会被 tickBuffs 减一，阶段 buff 是 9999 回合的常驻不受影响） */
      this.tickBossPhase(u, lines, battle);

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

  /* ================================================================
   * Boss 三阶段（SPRINT-C）
   *
   * 数据写在 NPC 模板的 `bossPhases` 上：
   *   [{ at: 1,    name: '第一阶段', line: '台词', mult: {atk:1.15}, skill: 'xx' }, ...]
   * `at` 是「血量比例阈值」，必须**递减**（1 → 0.6 → 0.3）。
   *
   * 三条铁律：
   *  ① 阶段状态挂在**实例**上（bossPhaseIdx / bossSkill），模板只当只读配置。
   *     挂模板 = 打输一次再从门口重来，还带着上一场的阶段倍率（历史坑位同款）。
   *  ② 倍率通过 buff 的 mods 落地（recalc 会重算，buff 本身不会被 recalc 冲掉）。
   *     m<1 的键（如 dodge:0.9）产出负增量 = 真的变慢，不是「没生效」。
   *  ③ 阶段切换**不打断战斗**：只插台词 + 换招 + 加倍率，回合继续走。
   *     所以不需要 resume 逻辑，输了下次重来就是从第一阶段开始。
   * ================================================================ */

  /** 取一个单位的阶段配置；没有就返回 null（普通 NPC 一律走这里） */
  bossPhasesOf(u) {
    const def = u && u.def;
    const arr = (def && def.bossPhases) || u.bossPhases;
    return Array.isArray(arr) && arr.length ? arr : null;
  }

  /** 当前所处阶段序号（实例上没有就是 0） */
  bossPhaseIdx(u) {
    return typeof u.bossPhaseIdx === 'number' ? u.bossPhaseIdx : 0;
  }

  /**
   * 取「可乘倍率的当前数值」。
   * ⚠️ `def` 必须走 defenseOf()：实例上的 `.def` 是**模板对象引用**（SPRINT1-ENG-02），
   *    直接 Number(u.def) 会得到 NaN，被 isFinite 挡掉 → 阶段倍率静默不生效。
   * 返回 null 表示这个键不支持倍率。
   */
  statOf(u, k) {
    if (k === 'def') return defenseOf(u);
    const v = u[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return v;
  }

  /**
   * 血量掉到下一阶段阈值就切。
   * 必须在**每次该单位行动前**调（step 里已接），不然玩家连打 3 下才切一次。
   * @returns 本回合新增的演出行
   */
  tickBossPhase(u, lines, battle) {
    const phases = this.bossPhasesOf(u);
    if (!phases) return;
    /* 死了就别再「变招」——尸体发表演台词很出戏。
       ⚠️ 判据是 def.hp 还是 hp？用 hp：实例被打到 0 但 def 里还写着满血值。 */
    if ((u.hp !== undefined ? u.hp : 1) <= 0 || u.dead) return;
    const ratio = u.maxHp > 0 ? u.hp / u.maxHp : 1;
    let idx = this.bossPhaseIdx(u);
    /* 只往前切，且一步只切一级（跨过多级时先演最近的那一级，别一口气刷三段台词） */
    if (idx + 1 < phases.length && ratio <= phases[idx + 1].at) idx++;
    else return;
    const ph = phases[idx];
    if (!ph) return;
    u.bossPhaseIdx = idx;

    /* ① 台词 + 演出（先出字，再上倍率，顺序上玩家先看到「他要变了」） */
    lines.push({ kind: 'combat', text: `【${u.name} · ${ph.name || ('第 ' + (idx + 1) + ' 阶段')}】` });
    if (ph.line) lines.push({ kind: 'combat', text: ph.line });
    if (ph.desc) lines.push({ kind: 'combat', text: ph.desc });

    /* ② 换招（下一回合的 pickSkill 会优先用它）
       at:1 的首阶段永远不触发「切换」，所以开场就把它的 skill 挂上——
       否则第一档指定的招式（如东方不败的辟邪剑法）从头到尾都用不出来。 */
    if (idx === 0 && !u.bossSkill && phases[0] && phases[0].skill
        && this.world.getSkill(phases[0].skill)) {
      u.bossSkill = phases[0].skill;
    }
    if (ph.skill && this.world.getSkill(ph.skill)) u.bossSkill = ph.skill;
    else if (ph.skill) u.bossSkill = null;

    /* ③ 数值倍率：换成 buff 的 mods 落地 */
    if (ph.mult && typeof ph.mult === 'object') {
      /* 同 tag 的旧 buff 先摘掉，否则倍率逐阶段累乘，第二阶段就爆表 */
      u.buffs = (u.buffs || []).filter(b => b.tag !== 'bossphase');
      const mods = {};
      for (const k of Object.keys(ph.mult)) {
        const m = Number(ph.mult[k]);
        if (!Number.isFinite(m) || m === 1) continue;
        const cur = this.statOf(u, k);
        if (cur === null) continue;
        /* 天生为 0 的派生字段（reflect / lifesteal / armorPen / critRate）走倍率没意义
           ——0×2 还是 0。这类字段的 mult 值当**绝对值**用：
           「反伤三成」写成 { reflect: 0.3 } 就成立。 */
        const ZERO_BASE = ['reflect', 'lifesteal', 'armorPen', 'critRate'];
        let d;
        if (ZERO_BASE.indexOf(k) >= 0) d = Math.round(m * 100) / 100;
        else d = Math.round(cur * (m - 1));
        if (d) mods[k] = (mods[k] || 0) + d;
      }
      if (Object.keys(mods).length) {
        u.addBuff({ name: ph.name || ('Boss 第 ' + (idx + 1) + ' 阶段'), turns: 9999, mods, tag: 'bossphase' });
        const desc = Object.keys(mods).map(k => {
          const sign = mods[k] > 0 ? '+' : '';
          return k + ' ' + sign + mods[k];
        }).join('　');
        lines.push({ kind: 'combat', text: `${u.name}的架势一变（${desc}）。` });
      }
    }

    /* ④ 召唤（如冯保放出影卫） */
    if (ph.summon && ph.summon.npc && battle) {
      const n = Math.max(1, Math.min(5, ph.summon.count || 1));
      const room = u.room || (battle.room);
      const made = [];
      for (let i = 0; i < n; i++) {
        const s = this.world.spawnNpc(ph.summon.npc, room, 1, true);
        if (s && s.id !== u.id) made.push(s);
      }
      if (made.length) {
        const side = [].concat(battle.attackers).indexOf(u) >= 0 ? 'attackers' : 'defenders';
        for (const s of made) { s.inCombat = true; battle[side] = [].concat(battle[side], s); }
        lines.push({ kind: 'combat', text: `${made.map(s => s.name).join('、')}从暗处现身，加入战局！` });
      }
    }
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
    /* ---- B3 · 物种专属招式优先 ----
       蛇/狼这类动物没有「装备槽」意义上的武学：它们只会speciesMoves 里那几招。
       所以这里**先**在 speciesMoves 里随机取一招（取不到才落回下面的槽位逻辑）。
       为什么必须随机而不是取第一个：一条蛇只会一招，看起来和「只有基本拳脚」
       没区别；随机取才有「毒牙/缠绕/吐信轮着来」的观感，这正是 B3 要的。
       `learned` 校验保留：招式被剥掉（毒被打散之类）时不会照放。 */
    const sm = u.speciesMoves;
    if (Array.isArray(sm) && sm.length) {
      const usable = sm.filter(id => u.learned[id] && this.world.getSkill(id));
      if (usable.length) {
        return this.world.getSkill(usable[Math.floor(this.world.rng.next() * usable.length)]);
      }
    }
    /* Boss 阶段招优先（bossSkill 由 tickBossPhase 在阶段切换时写上实例）。
       at:1 的首阶段永远不触发「切换」，所以这里再兜一层：
       没有 bossSkill 就按当前阶段号取配置，否则第一档指定的招式永远放不出来。 */
    let wantBoss = u.bossSkill || null;
    if (!wantBoss) {
      const phases = this.bossPhasesOf(u);
      if (phases) {
        const ph = phases[this.bossPhaseIdx(u)];
        if (ph && ph.skill && this.world.getSkill(ph.skill)) wantBoss = ph.skill;
      }
    }
    if (wantBoss) {
      const bsd = this.world.getSkill(wantBoss);
      if (bsd) {
        /* 没内力时别硬用，退回常规武学，避免 boss 一直在「内力不济」里空转 */
        if (!bsd.mpCost || u.mp >= bsd.mpCost) return bsd;
      }
    }
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
    const tier = skill ? profTierOf(u, skill.id) : 0;

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
      // 去等级化（SPRINT2）：命中/伤害由「熟练度档位」而非角色等级驱动
      acc: skill ? (skill.accuracy || 80) + profTierAcc(tier) : 85,
      mult: skill ? (skill.damageMult || 1) * profTierMult(tier) : 1,
      armorPen: u.armorPen,
      critRate: u.critRate + (skill ? (skill.critBonus || 0) : 0),
      critDmg: u.critDmg + (skill ? (skill.critDmgBonus || 0) : 0),
    };
    // 武器绑定：无对应兵刃则威力打折
    const pen = weaponPenalty(u, skill);
    if (pen.mult !== 1 || pen.acc) {
      ctx.mult *= pen.mult;
      ctx.acc += pen.acc;
    }
    if (w.combatHooks.hitRoll) {
      const hitFn = w.combatHooks.hitRoll;
      if (!hitFn(u, t, skill, ctx)) {
        return { kind: 'combat', text: `${u.name}${skill ? '一招“' + skill.name + '”' : '的攻击'}被${t.name}闪身避过。` };
      }
    }

    // 去等级化：基础 = 攻击力（已含属性派生）；不再叠加任何等级放大项
    const base = u.atk;
    const dmgRaw = w.combatHooks.damage ? w.combatHooks.damage(u, t, base, ctx) : base * (ctx.mult || 1);
    let dmg = Math.max(1, Math.floor(dmgRaw));

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

    // 功能 Mod 规则：玩家受击增减（additive damageTaken，负值=减伤）
    if (t.isPlayer) {
      const adj = w.ruleAdd('damageTaken');
      if (adj) dmg = Math.max(0, dmg + adj);
    }

    /* B4「防御」快捷键的效果：guardTurns>0 时本回合伤害减半。
       判据挂在 battle 上（战斗态的唯一权威），先减伤再落血，
       所以「防御」这一回合是真的挨得住打，而不是空转一回合。 */
    if (t.isPlayer && battle && battle.guardTurns > 0) {
      const guarded = Math.max(1, Math.floor(dmg / 2));
      if (guarded < dmg) dmg = guarded;
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
    if (pen.note && idx === 0) text += `（${pen.note}）`;
    if (extraText) text += extraText;

    // 对练/生死战提升最大（SPRINT2）：玩家用武技命中即获熟练度
    if (u.isPlayer && skill) {
      u.gainSkillExp(skill.id, 2 + tier);
      if (t.hp <= 0) u.gainSkillExp(skill.id, 20 + tier * 4);
    }

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
        const dmg = Math.floor((b.dot.value || 3));
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
    /* 第五批生死规则：普通 NPC 被打倒 → 晕厥（不致死）；野兽或「晕倒后再补刀」才真死 */
    const beast = /狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(t.name || '');
    if (!beast && !t.knockedOut) {
      lines.push({ kind: 'combat', text: `${t.name}闷哼一声，昏倒在地，不省人事。` });
      w.onNpcDown(t, battle);
    } else {
      lines.push({ kind: 'combat', text: `${t.name}喷出一口鲜血，就此气绝。` });
      w.onNpcKilled(t, battle);
    }
    if (w.combatHooks.onDeath) w.combatHooks.onDeath(t, battle);
  }
}

module.exports = { CombatEngine, DEFAULT_HOOKS, defenseOf, weaponPenalty };
