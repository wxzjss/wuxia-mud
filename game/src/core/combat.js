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

/* ── 兵刃 / 武学类型 → 演出句库的四类（design/75 §1.6）─────────────────────
   句库只有四类：sword 剑 / blade 刀 / fist 拳 / hidden 暗器。
   七种兵刃类型要落进这四类，映射写在这里，别散到渲染层去。

   ⚠️ 取值顺序按 design/75 §1.6：
      ① 武学数据自己的 `style` 字段（**目前数据里还没有**，design/75 说好是
         §B.4 武学合并时顺手补的 —— 等它补上，这里自动优先用它，代码不用改）
      ② 退化到 `type`（拳/剑/刀/棍/鞭/暗器）
      ③ 再退化到角色当前手上拿的兵刃
      ④ 最后是 fist

   ⚠️ 棍 / 鞭 没有对应的第四类，硬塞进哪一类都不干净。这里的判断是：
      棍走 blade（有分量、硬碰硬，跟"刀走分量"一路），鞭也走 blade（抽、削，
      是"有刃口动作"的那一路）—— 都比塞进 fist（贴身短打）合理。

   ⚠️ 音波：全库 761 门武学里只有 **1 门**（`basic_sing` 基本乐理）。
      四类里没有它能落进去的：sword/blade 要有刃口，hidden 通篇说「那东西」
      （甩出去的暗器），音波既没刃也没有实体。fist 是唯一**不凭空引入一个
      不存在的物件**的兜底，所以落在 fist，不新编第五类。
      等真要做音波演出，走两条正路：① 数据补 `style` 字段指定；
      ② 句库加第五类（那是 design/75 的活，不是接线的人顺手加的）。 */
const COMBAT_STYLE_VALUES = { sword: 1, blade: 1, fist: 1, hidden: 1 };
const COMBAT_STYLE_OF_TYPE = {
  剑: 'sword', 刀: 'blade', 拳: 'fist', 暗器: 'hidden',
  棍: 'blade', 鞭: 'blade', 音波: 'fist',
};

function styleOf(u, skill, move) {
  const direct = (skill && skill.style) || (move && move.style);
  if (direct && COMBAT_STYLE_VALUES[direct]) return direct;

  const ty = (skill && skill.type) || (move && move.type);
  if (ty && COMBAT_STYLE_OF_TYPE[ty]) return COMBAT_STYLE_OF_TYPE[ty];

  /* 没指定武学（普通攻击）⇒ 看手上拿的是什么：
     从已装备的武器道具反查 weaponType，再走同一张映射表。 */
  const wpnId = u && u.equipment && u.equipment['武器'];
  const item = wpnId && u.world ? u.world.getItem(wpnId) : null;
  const wt = item && item.weaponType;
  if (wt && COMBAT_STYLE_OF_TYPE[wt]) return COMBAT_STYLE_OF_TYPE[wt];

  return 'fist';
}

/* 平局上限：打满这么多回合还没分胜负就判和。
   ⚠️ 这个数有**两个**用处，别拆成两份：
     ① `CombatEngine.step()` 里收尾判一次（直接调 step 的调用方，如几个冒烟脚本）
     ② `World.advanceTurn()` 里判一次（玩家走「普攻 / 绝招 / 防御 / 物品」四条分支时）
   两处**共用这一个常量** —— 各写一个 60 就是「两处各写一份」，改一个忘一个。
   ⚠️ 它同时也是**防死循环**的兜底：`auto`（挂机）与几个脚本都靠它收住。 */
const DRAW_TURNS = 60;

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
    const pen = Math.min(0.7, ctx.armorPen || 0);
    let d = base * (ctx.mult || 1);
    /* 走 defenseOf()，别直接读 defender 上的 def —— 那是 NPC 模板对象，乘出来是 NaN。
       ⚠️ 减伤封顶 75%（2026-10-10 数值体检）：原来的 100/(100+def) 没有上限，
         神秘老僧 def=732 时减伤 88%，玩家每一刀只剩一成伤害 → 打它要 276 刀，
         高防人物直接变成「打不动的肉墙」。封顶后 def ≥ 300 一律按 75% 减，
         穿甲（armorPen）仍能把有效防御压下来，破防流依旧有戏。 */
    const dEff = defenseOf(defender) * (1 - pen);
    const red = Math.min(0.75, dEff / (dEff + 100));
    d = d * (1 - red);
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

      /* 被震慑（awe）：这一回合不敢动手。回合数用完自然恢复。 */
      if (u.vars && u.vars.awe && u.vars.awe.left > 0) {
        u.vars.awe.left--;
        if (u.isPlayer) lines.push({ kind: 'combat', text: '你被对方的气势压着，一时提不起手。' });
        else lines.push({ kind: 'combat', text: `${u.name}看了看你，终究没敢动手。` });
        continue;
      }
      const enemies = this.enemiesOf(all, ent);
      if (!enemies.length) continue;
      /* 迷幻（confuse，`design/40` §4.3 P1-1）：中了迷魂香的会朝自己人动手。
         没有同伴（单挑）时照常打敌人 —— 否则会「愣住不打」，比不中招还怪。 */
      let pool = enemies;
      if (this.isConfused(u)) {
        const mates = this.alliesOf(all, ent);
        if (mates.length) {
          pool = mates;
          lines.push({ kind: 'combat', text: `${u.name}双目赤红，竟朝自己人递招！` });
        }
      }
      const targetEnt = this.pickTarget(u, pool, battle);
      if (!targetEnt) continue;
      const t = targetEnt.u;

      const isPlayerSide = ent.side === 'attackers';
      // 是否用武学（封穴时 pickSkill 会返回 null → 只能普攻）
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
    /* 平局判定。⚠️ `step()` 现在**只被直接调用的调用方**用（几个冒烟脚本、
       `smoke-events` 的「真打死一只野兽」），玩家那四条分支已改走
       `World.advanceTurn()`。两边共用 `DRAW_TURNS` 这一个常量。 */
    if (!battle.over && battle.turn > DRAW_TURNS) { battle.over = true; battle.winner = 'draw'; }
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
  /** 同侧的人（用于「迷幻」：敌人神智昏乱时会朝自己人递招） */
  alliesOf(all, ent) {
    return all.filter(x => x.side === ent.side && x.u !== ent.u && x.u.hp > 0 && !x.u.dead);
  }
  /** 迷幻：godless 的「心神被迷」——只认 buff 标签，不认效果来源 */
  isConfused(u) { return !!(u.buffs && u.buffs.some(b => b.tag === 'confuse')); }
  /** 封穴：被点了穴道，这一回合只能干挨（pickSkill 直接放弃用招） */
  isSilenced(u) { return !!(u.buffs && u.buffs.some(b => b.tag === 'silence')); }
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
    /* 封穴（silence，P1-2）：被点了穴的人这一回合用不出招，只能干瞪眼。
       判据放在最前面 —— 连 boss 的阶段招也一并封住，这才是「点穴」该有的分量。 */
    if (this.isSilenced(u)) return null;
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
    /* ---- 出招选择（2026-10-18「猎刀陷阱」重写）----
       旧实现按**槽位顺序**硬选（剑→刀→…→拳）：新档剑槽有 basic_sword，
       于是永远出剑招；装上猎刀（刀）后变成「剑招 + 刀武器」→ 吃 0.45 惩罚，
       照新手引导做反而战斗力砍半。学会刀法也不管用，因为选招根本不看武器。
       新口径（team-lead 裁定，三条同源）：
         ① 候选 = 所有已学武学（不按槽位硬挑）；
         ② **武器匹配优先**：手上有刀就先用刀法，有剑先用剑法；
            赤手/武器无对应武学时，拳脚是**不罚**的保底（weaponPenalty 对拳返回 1）；
         ③ 同档内按 `damageMult × 熟练档` 择优——学得越好、招越狠的先用。
       ⚠️ 绝不选「类型与手上武器不符」的招去白挨 0.45：那正是本 bug 的形态。 */
    const wpnId = u.equipment && u.equipment['武器'];
    const wpnItem = wpnId ? this.world.getItem(wpnId) : null;
    const wpnType = wpnItem ? (wpnItem.weaponType || (wpnItem.category === '乐器' ? '音波' : null)) : null;
    const pool = [];
    for (const id of Object.keys(u.learned || {})) {
      const sd = this.world.getSkill(id);
      if (sd) pool.push(sd);
    }
    const needsWeapon = s => !!WEAPON_REQUIRED[s.type];
    const matches = s => !needsWeapon(s) || (wpnType && s.type === wpnType);
    /* 内力付得起的才进候选（2026-10-18）：否则「按倍率挑最强」会挑中高耗招，
       一出手就是「内力不济」空转——boss 的幂等回退分支正是为此而设。
       全军覆没（都付不起）时才退回全池，该报「内力不济」就照报。 */
    const afford = s => !s.mpCost || (u.mp || 0) >= s.mpCost;
    const pool2 = pool.filter(afford);
    const use = pool2.length ? pool2 : pool;
    let cands;
    if (wpnType) {
      /* 手上有家伙：**先可着武器类型选**（有刀法用刀法，这是玩家的意图）；
         该类型一门都不会 → 退回拳脚（不罚），而不是拿别的兵器招白挨 0.45。 */
      cands = use.filter(s => s.type === wpnType);
      if (!cands.length) cands = use.filter(s => s.type === '拳');
    } else {
      /* 赤手/武器无类型：拳脚优先（不罚），没有拳脚再轮到别的 */
      cands = use.filter(s => s.type === '拳');
      if (!cands.length) cands = use.filter(s => !needsWeapon(s));
    }
    if (!cands.length) cands = use;                                  // 什么都没有：爱咋咋地
    if (cands.length) {
      const scoreOf = s => (s.damageMult || 1) * profTierMult(profTierOf(u, s.id));
      cands.sort((a, b) => scoreOf(b) - scoreOf(a));
      /* 同分时优先已装备槽的那门（玩家的编辑意图），再不行按 id 稳定排序 */
      const top = cands[0];
      const eq = u.equippedSkills && u.equippedSkills[top.type];
      if (eq && u.learned[eq]) {
        const eqSd = this.world.getSkill(eq);
        if (eqSd && matches(eqSd) && scoreOf(eqSd) >= scoreOf(top)) return eqSd;
      }
      return top;
    }
    return null;
  }

  oneAttack(u, t, skill, battle, idx, move) {
    const w = this.world;
    const sName = move ? move.name : (skill ? skill.name : '普通攻击');
    const lv = skill ? u.skillLevel(skill.id) : 0;
    const tier = skill ? profTierOf(u, skill.id) : 0;

    /* ★ 战斗演出要用的结构化字段（design/75 §1.6）
       以前这里只回一句拼好的文本，渲染层要表现"这一刀多重/是不是暴击/谁打谁"
       只能去**反解那句话**——加一个字段就得改一次正则，改一次崩一次。
       现在把结算结果原样交出去，文本降格成兜底。
       ⚠️ `text` **必须留着且措辞不许动**：`tools/smoke-arts.js:144` 还在
       `/造成 (\d+) 点伤害/` 上取伤害比大小。谁读不到新字段（老存档回放、
       第三方 mod、测试脚本）就还是走老路，不许静默变空。 */
    const aName = u.isPlayer ? '你' : u.name;
    const tName = t.isPlayer ? '你' : t.name;
    const style = styleOf(u, skill, move);

    // 内力消耗（武技的 mpCost 是**额外**叠加在武学之上的）
    const mpNeed = (skill && skill.mpCost ? skill.mpCost : 0) + (move && move.mpCost ? move.mpCost : 0);
    if (mpNeed) {
      if (u.mp < mpNeed) {
        if (idx === 0) return { kind: 'combat', text: `${u.name}内力不济，只能以拳脚相搏。` };
        return null;
      }
      u.mp -= mpNeed;
    }
    // 体力消耗（武技专属，玩家才有体力池；NPC 无 stamina 就跳过）
    if (move && move.staminaCost && typeof u.stamina === 'number') {
      u.stamina = Math.max(0, u.stamina - move.staminaCost);
    }

    const ctx = {
      world: w,
      skill,
      // 去等级化（SPRINT2）：命中/伤害由「熟练度档位」而非角色等级驱动
      acc: (skill ? (skill.accuracy || 80) + profTierAcc(tier) : 85) + (move && move.accuracy ? move.accuracy : 0),
      mult: (skill ? (skill.damageMult || 1) * profTierMult(tier) : 1) * (move && move.damageMult ? move.damageMult : 1),
      armorPen: u.armorPen + (move && move.armorPen ? move.armorPen : 0),
      critRate: u.critRate + (skill ? (skill.critBonus || 0) : 0),
      critDmg: u.critDmg + (skill ? (skill.critDmgBonus || 0) : 0),
    };
    // 武器绑定：无对应兵刃则威力打折
    const pen = weaponPenalty(u, skill);
    if (pen.mult !== 1 || pen.acc) {
      ctx.mult *= pen.mult;
      ctx.acc += pen.acc;
    }
    /* 天赋：武学类别加成（剑心通明按 slot「剑」、蛊道天赋按 category「旁门」）。
       挂在最终 mult 上——武器折扣之后，保证「有天赋 +15%/20%」是实打实的总倍率。 */
    const sbMult = w.skillBonusMult ? w.skillBonusMult(u, skill) : 1;
    if (sbMult !== 1) ctx.mult *= sbMult;
    if (w.combatHooks.hitRoll) {
      const hitFn = w.combatHooks.hitRoll;
      if (!hitFn(u, t, skill, ctx)) {
        return {
          kind: 'combat',
          missed: true, blocked: false, crit: false,
          style, dmg: 0, hpRatio: 0, aName, tName,
          /* 落空也走句库的 miss 分支（4 类 × 8 条），不再只有这一句。
             ⚠️ 原来是 `u.name`/`t.name`，玩家自己落空时会写成
             "张三一招…”被李四闪身避过。" —— 第二人称的 MUD 里不这么说，
             这里统一成 aName/tName。全库 grep 过，没有测试依赖这句原文。 */
          text: `${aName}${skill ? '一招“' + skill.name + '”' : '的攻击'}被${tName}闪身避过。`,
        };
      }
    }

    // 去等级化：基础 = 攻击力（已含属性派生）；不再叠加任何等级放大项
    const base = u.atk;
    let dmgRaw = w.combatHooks.damage ? w.combatHooks.damage(u, t, base, ctx) : base * (ctx.mult || 1);
    /* 暗劲（arts.js「注入暗劲」）：经脉里埋着别人一缕内劲，一动真力就吃大亏。
       挂在中招者身上（`vars.hiddenForce`），所以是**任何打他的人**都能占这个便宜。 */
    const hf = t.vars && t.vars.hiddenForce;
    if (hf && hf.left > 0) dmgRaw *= (hf.mult || 1.6);
    let dmg = Math.max(1, Math.floor(dmgRaw));

    // 暴击
    let crit = false;
    if (w.rng.next() < ctx.critRate) {
      crit = true;
      dmg = Math.floor(dmg * ctx.critDmg);
    }

    /* 特殊效果：`skill.effects` 是「打中就有」的底子（老数据全靠它，不能动），
       `move.effects` 是指定武技时的额外加成 —— 两层叠加，向后兼容。 */
    let extraText = '';
    const effList = [];
    if (skill && skill.effects) effList.push(...[].concat(skill.effects));
    if (move && move.effects) effList.push(...[].concat(move.effects));
    for (const eff of effList) {
      const r = this.applySkillEffect(eff, u, t, skill, battle);
      if (r && r.text) extraText += r.text;
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

    let text = `${aName}${move ? '使出一式「' + move.name + '」' : skill ? '使出一招「' + skill.name + '」' : '挥拳'}，击中${tName}`;
    if (crit) text += `，正中要害（暴击）`;
    text += `，造成 ${dmg} 点伤害。`;
    if (pen.note && idx === 0) text += `（${pen.note}）`;
    if (extraText) text += extraText;

    // 对练/生死战提升最大（SPRINT2）：玩家用武技命中即获熟练度
    if (u.isPlayer && skill) {
      u.gainSkillExp(skill.id, 2 + tier);
      if (t.hp <= 0) u.gainSkillExp(skill.id, 20 + tier * 4);
    }

    if (t.hp <= 0) text += ` ${tName}${t.isPlayer ? '' : '闷哼一声，'}倒地不起！`;

    /* hpRatio = 本次伤害 / 挨打那位的气血上限。design/75 §1.6 写死了
       "`dmg` 和 `t.maxHp` 都已经在手边，不需要新增任何计算" —— 确实如此。
       ⚠️ 这是**视觉分层的唯一输入**：④ 的五档靠它算 tier。渲染层不许自己再算一遍，
       否则同一条口径两处各写一份，改一个忘一个。
       ⚠️ maxHp 为 0 / NaN 的老人物质（旧存档里见过）不能让这里出 NaN，兜到 1。 */
    const hpRatio = (typeof t.maxHp === 'number' && t.maxHp > 0)
      ? clamp(dmg / t.maxHp, 0, 1)
      : 1;

    return {
      kind: 'combat',
      style,
      hpRatio,
      crit: !!crit,
      blocked: false,   /* ⚠️ 见下：引擎里现在没有"被架住"这个状态 */
      missed: false,
      dmg,
      aName,
      tName,
      text,
    };
    /* ⚠️ `blocked` 恒为 false —— 句库里那 32 条「被架住」目前**没有任何触发路径**。
       不是漏接，是引擎里根本没有"招式被架住"这个结算结果：命中判定只有
       hitRoll 的 true/false 两态（中 / 落空），没有第三态。
       要让它们生效得先有格挡机制（招架值 / 兵器相格 / 防御姿态），那是玩法设计，
       不该由接线的人顺手编。字段先留着，等机制落地就有地方接。 */
  }

  applySkillEffect(eff, u, t, skill, battle) {
    const w = this.world;
    let text = '';
    /* 天赋免疫判定（百毒不侵 / 心如铁石）：武技效果先过一遍「受击者是不是免疫这类」。
       引擎里没有专门的毒/眩晕字段，标签由 world.effectTags 从效果的类型与名字推出来
       （stun→眩晕；名字含「毒」的 dot→毒）。命中免疫就直接吞掉，不落 buff / 不生效。 */
    if (w.isImmune && w.effectTags) {
      const tags = w.effectTags(eff);
      for (const tg of tags) {
        if (w.isImmune(t, tg)) {
          const cn = tg === 'poison' ? '百毒不侵' : tg === 'stun' ? '心如铁石'
            : tg === 'confuse' ? '心境澄明' : '浑然不觉';
          return { text: ` ${t.name}${cn}，这一手伤不了分毫。` };
        }
      }
    }
    switch (eff.type) {
      case 'dot': {
        t.addBuff({ name: eff.name || '持伤', turns: eff.turns || 3, mods: {}, tag: 'dot_' + (eff.name || 'x'), dot: { value: eff.value || 5, source: u.id } });
        text += ` ${t.name}中了${eff.name || '暗伤'}。`;
        break;
      }
      case 'stun':
        if (w.rng.next() < (eff.chance || 0.2)) { t.addBuff({ name: '暈眩', turns: eff.turns || 1, tag: 'stun' }); text += ` ${t.name}被打得闷哼一声，动作一滞。`; }
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
      /* 回内力（P1-5）：老引擎只有 heal（回血），没有回内的武技效果。
         走这条而不是 custom，是因为「回气」是内功类武技的通用需求，数据侧不该各写一个函数。 */
      case 'mp':
        u.mp = clamp(u.mp + (eff.value || 20), 0, u.maxMp); text += ` ${u.name}真气稍复。`; break;
      /* 迷幻（P1-1）：中了就敌我不分 —— 真正的表现层在 step/pickTarget（会调头打自己人） */
      case 'confuse':
        if (w.rng.next() < (eff.chance || 0.35)) {
          t.addBuff({ name: '迷乱', turns: eff.turns || 2, tag: 'confuse' });
          text += ` ${t.name}眼神一散，竟辨不清敌我。`;
        }
        break;
      /* 封穴（P1-2）：不能出招 —— 表现层在 pickSkill（返回 null → 只能普攻） */
      case 'silence':
        if (w.rng.next() < (eff.chance || 0.4)) {
          t.addBuff({ name: '封穴', turns: eff.turns || 2, tag: 'silence' });
          text += ` ${t.name}穴道受制，一时提不起内力。`;
        }
        break;
      /* 群攻/溅射（P1-3）：余劲扫及同侧其他人。
         ⚠️ 副目标走 `oneAttack(u, o, null, ...)` —— **故意不传 skill**，
            否则每个副目标都会再把 effects 跑一遍，aoe 里套 aoe，无限递归。 */
      case 'aoe': {
        if (!battle) break;
        const dside = [].concat(battle.defenders).some(x => x === t || (x && x.members && x.members.indexOf(t) >= 0)) ? 'defenders' : 'attackers';
        const others = [].concat(battle[dside]).filter(x => x && x !== t && x.hp > 0 && !x.dead);
        for (const o of others) {
          const r = this.oneAttack(u, o, null, battle, 1);
          if (r) text += ' ' + r.text;
        }
        break;
      }
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
    const w = this.world;
    /* ---- 切磋：点到为止，**谁都不会死**（主人 2026-10-11）----
       「切磋和正常战斗一样（会掉血但不会死亡、会保留 1 滴血晕倒过去，醒来还是在原地）」。
       🔴 这里必须拦在**所有致死逻辑之前**（玩家那条 playerDeath → 客栈醒转、
          NPC 那条 onNpcDown/onNpcKilled 都在下面）。放晚了就会出现
          「切磋输一场，人被抬到客栈去了」或者「切磋把人打死了」。
       做法：血量按到 1、双方都留在原地、当场判出胜负。
       「晕倒 → 醒来还在原地」这两句写在 duel 结算里（world.js），
       这里只负责别让人真的倒下/走掉。 */
    if (battle && battle.duel) {
      t.hp = 1;
      t.buffs = [];
      t.duelLose = true;
      if (t.isPlayer) {
        lines.push({ kind: 'combat', text: '你招式一散，踉跄半步，撑着膝盖喘气，摆手认了输。' });
      } else {
        lines.push({ kind: 'combat', text: `${t.name}晃了晃，跌坐在地，随即又撑着站了起来。` });
      }
      battle.over = true;
      battle.winner = t.isPlayer ? 'defenders' : 'attackers';
      return;
    }
    t.dead = true; t.hp = 0; t.buffs = [];
    if (t.isPlayer) {
      /* 玩家**不会死，只是力竭昏过去**（主人明确要求：昏倒 → 最近客栈醒转）。
         文案与计数都走这条唯一口径：
         ⚠️ 原来这里直接 `t.dead = true` 就 return 了，**绕过了 `world.playerDeath()`** ——
            于是「战斗里被打倒」从不计「昏倒数」（只有饿昏/渴昏计），
            同一个动作两条路两个结果。这里补一次调用（幂等：它只标记 + 计数）。 */
      lines.push({ kind: 'faint', text: '你眼前一黑，什么都不知道了……' });
      if (typeof w.playerDeath === 'function') w.playerDeath();
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

module.exports = { CombatEngine, DEFAULT_HOOKS, defenseOf, weaponPenalty, DRAW_TURNS };
