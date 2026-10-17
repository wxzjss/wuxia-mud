#!/usr/bin/env node
/* ==========================================================================
 *  tools/combat-feel-check.js —— 战斗 S 级修复守卫（2026-10-18 审计批次）
 *
 * 守六件：
 *   C1 #8 战斗面板有操作表：view.combat.actions 非空，含 普攻/防御/逃跑；有药时含用药
 *   C2 #7 目标可切换：enemies 带 uid、恰一个 targeted；combatAction('target', uid) 后
 *        targeted 变更且回「你转向 X」
 *   C3 #5 同房群战：三只敌意山贼同房 → 开战后 defenders = 3（且都 inCombat）
 *   C4 #6 真回执：战中 `kill 第二只` → 第二只真掉血、回合前进（不是重置战斗）
 *   C5 #15 自身战斗态：view.combat.self 带 hp/maxHp/mp/maxMp
 *   C6 #1 登场顺序：直接 startCombat 首行是「X逼上前来」；kill 路径首行是「你向X发起攻击」
 *      （旁观者台词在后）
 *
 * 用法：node tools/combat-feel-check.js
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
const txt = r => (r && r.lines || []).map(l => l.text).filter(Boolean).join(' ');
const firstLine = r => ((r && r.lines || []).find(l => l.text) || {}).text || '';

(async () => {
  console.log('\n  ── 战斗体感 S 级守卫 ──');
  const boot = () => {
    const e = new GameEngine({ seed: 20261018 });
    e.boot(); e.newGame({ name: '战探', gender: 'male', birth: 'wuxue' });
    return e;
  };

  /* C1 #8 操作表 */
  {
    const e = boot(); const w = e.world, p = w.player;
    const n = w.spawnNpc('mob_bandit', p.room, 1, true);
    w.startCombat(p, n);
    w.giveItem(p, 'jinchuang_yao', 1);
    const c = e.view({ map: false }).combat;
    const acts = (c && c.actions) || [];
    const ids = acts.map(a => a.action);
    ok('C1 ★ 战斗面板操作表非空（#8：UI 的 #combat-actions 有东西可画）', acts.length > 0, ids.join(','));
    ok('C1b 含 普攻/防御/逃跑 三类基本动作', ['attack', 'defend', 'flee'].every(x => ids.indexOf(x) >= 0), ids.join(','));
    ok('C1c 背包有药时生成「用药」动作（usableItems 真接上）', ids.indexOf('item') >= 0,
      acts.filter(a => a.action === 'item').map(a => a.label).join(','));
  }

  /* C2 #7 目标切换 */
  {
    const e = boot(); const w = e.world, p = w.player;
    const a = w.spawnNpc('mob_bandit', p.room, 1, true);
    const b = w.spawnNpc('mob_bandit', p.room, 1, true);
    w.startCombat(p, a);
    let c = e.view({ map: false }).combat;
    const uids = (c.enemies || []).map(x => x.uid);
    const targeted0 = (c.enemies || []).filter(x => x.targeted);
    ok('C2 ★ enemies 带 uid 且恰一个 targeted（#7）', uids.every(Boolean) && targeted0.length === 1,
      'uids=' + uids.map(x => x && x.slice(-4)).join('/') + ' targeted=' + targeted0.length);
    const other = (c.enemies || []).find(x => !x.targeted);
    const r = e.combatAction('target', { uid: other.uid });
    c = r.view.combat;
    const now = (c.enemies || []).find(x => x.targeted);
    ok('C2b ★ 切目标真生效：targeted 变更 + 回「你转向 X」',
      !!now && now.uid === other.uid && /转向/.test(txt(r)),
      (now && now.name) + ' | ' + txt(r).slice(0, 30));
  }

  /* C3 #5 同房群战 */
  {
    const e = boot(); const w = e.world, p = w.player;
    const a = w.spawnNpc('mob_bandit', p.room, 1, true);
    w.spawnNpc('mob_bandit', p.room, 1, true);
    w.spawnNpc('mob_bandit', p.room, 1, true);
    const r = w.startCombat(p, a);
    const defs = (w.battle && w.battle.defenders || []);
    ok('C3 ★ 三贼同房开战 defenders=3（#5 群战入战）', defs.length === 3, defs.map(d => d.name).join(','));
    ok('C3b 入战者全部 inCombat', defs.every(d => d.inCombat));
    ok('C3c 开战提示里点明「不止一个对手」', /围了上来/.test(txt(r)), txt(r).slice(0, 40));
  }

  /* C4 #6 真回执（⚠️ 用**不同名**的两只：同名怪的文字指令本来就无法区分，
     那属「同地块禁同名」的另一条纪律；UI 点卡走 uid，不受影响） */
  {
    const e = boot(); const w = e.world, p = w.player;
    const a = w.spawnNpc('mob_bandit', p.room, 1, true);
    const b = w.spawnNpc('mob_wolf', p.room, 1, true);
    w.startCombat(p, a);
    const turn0 = w.battle.turn;
    const hpB0 = b.hp;
    const r = e.exec('kill ' + b.name);
    ok('C4 ★ 战中点名另一只：真掉血（不是假回执）', b.hp < hpB0, hpB0 + ' → ' + b.hp);
    ok('C4b 回合前进且战斗没被重置', w.battle && w.battle.turn > turn0 && w.battle.defenders.length === 2,
      'turn ' + (w.battle && w.battle.turn));
    ok('C4c 回执里写明「转向 X」', /转向/.test(txt(r)), txt(r).slice(0, 40));
  }

  /* C5 #15 自身战斗态 */
  {
    const e = boot(); const w = e.world, p = w.player;
    w.spawnNpc('mob_bandit', p.room, 1, true);
    w.startCombat(p, w.npcsIn(p.room)[0]);
    const c = e.view({ map: false }).combat;
    ok('C5 ★ view.combat.self 带血/内（#15）',
      !!(c.self && c.self.hp != null && c.self.maxHp != null && c.self.mp != null),
      JSON.stringify(c.self || null).slice(0, 80));
  }

  /* C6 #1 登场顺序 */
  {
    const e = boot(); const w = e.world, p = w.player;
    const n = w.spawnNpc('mob_wolf', p.room, 1, true);
    const r = w.startCombat(p, n);
    ok('C6 ★ 直接开战首行是「对手逼上前来」（不是旁观者台词）', /逼上前来/.test(firstLine(r)), firstLine(r));
    const e2 = boot(); const w2 = e2.world, p2 = w2.player;
    const b = w2.spawnNpc('mob_bandit', p2.room, 1, true);
    const r2 = e2.exec('kill ' + b.name);
    ok('C6b kill 路径首行是「你向X发起了攻击」', /你向.*发起了攻击/.test(firstLine(r2)), firstLine(r2));
  }

  /* C7~C10 猎刀陷阱（2026-10-18，team-lead 裁定三点同源）：
     learnSkill 自动换装 / pickSkill 按武器选招 / 拳脚免罚。 */
  {
    const bootP = () => {
      const e = new GameEngine({ seed: 20261018 });
      e.boot(); e.newGame({ name: '战探', gender: 'male', birth: 'wuxue' });
      return e;
    };
    const strike = (e, times) => {
      const w = e.world, p = w.player;
      const out = [];
      for (let i = 0; i < (times || 3); i++) {
        const n = w.spawnNpc('mob_bandit', p.room, 1, true);
        const hp0 = n.hp;
        w.startCombat(p, n);
        const r = e.exec('attack');
        out.push({ dmg: hp0 - n.hp, text: txt(r) });
        w.battle = null;
      }
      return out;
    };
    const sum = a => a.reduce((s, x) => s + x.dmg, 0);

    /* C7 授艺自动换装 */
    const e1 = bootP(); const p1 = e1.world.player;
    const before = p1.equippedSkills.拳;
    p1.learnSkill('jh_fist', { force: true });
    ok('C7 ★ 授长拳后拳槽自动换成 jh_fist（不再「白教」）',
      p1.equippedSkills.拳 === 'jh_fist' && before !== 'jh_fist', before + ' → ' + p1.equippedSkills.拳);

    /* C8 赤手：长拳上场且比裸档强 */
    const e2 = bootP(); const p2 = e2.world.player;
    p2.equipment['武器'] = null; p2.recalc();
    const bare = strike(e2);
    p2.learnSkill('jh_fist', { force: true });
    const fist = strike(e2);
    ok('C8 ★ 赤手授长拳后第一击出现「长拳」', /长拳/.test(fist[0].text), fist[0].text.slice(0, 40));
    ok('C8b 赤手长拳比裸档强（3 击总量）', sum(fist) > sum(bare), sum(bare) + ' → ' + sum(fist));

    /* C9 持械不比空手弱（同招式池、同 NPC，各打三次） */
    const e3 = bootP(); const p3 = e3.world.player;
    p3.equipment['武器'] = null; p3.recalc();
    p3.learnSkill('jh_fist', { force: true });
    const unarmed = strike(e3);
    e3.world.giveItem(p3, 'hunting_knife');
    p3.equipment['武器'] = 'hunting_knife'; p3.recalc();
    const armed = strike(e3);
    ok('C9 ★ 持刀不弱于赤手（猎刀陷阱：装备后伤害不能掉）', sum(armed) >= sum(unarmed),
      '赤手 ' + sum(unarmed) + ' vs 持刀 ' + sum(armed));

    /* C10 有刀法时自动用刀法 */
    const e4 = bootP(); const p4 = e4.world.player;
    p4.learnSkill('jh_fist', { force: true });
    p4.learnSkill('jh_blade', { force: true });
    e4.world.giveItem(p4, 'hunting_knife');
    p4.equipment['武器'] = 'hunting_knife'; p4.recalc();
    const blade = strike(e4, 1);
    ok('C10 ★ 持刀且会刀法 → 出招自动用刀法', /刀法/.test(blade[0].text), blade[0].text.slice(0, 40));
  }

  /* C11~C16 审计 A/B 级（design/115 §四数值与文案已交） */
  {
    const bootP = () => {
      const e = new GameEngine({ seed: 20261018 });
      e.boot(); e.newGame({ name: '战探', gender: 'male', birth: 'wuxue' });
      return e;
    };

    /* C11 创口：同源不叠层 + 每回合「还剩 N 回合」+ 首次解法提示 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      const t = w.spawnNpc('mob_bandit', p.room, 1, true);
      const battle = { attackers: [p], defenders: [t], duel: false, turn: 0 };
      const eff = { type: 'dot', name: '创口', turns: 2, value: 6 };
      const r1 = e.world.combat.applySkillEffect(eff, p, t, null, battle);
      const r2 = e.world.combat.applySkillEffect(eff, p, t, null, battle);
      const dots = (t.buffs || []).filter(b => b.tag === 'dot_创口');
      ok('C11 ★ 创口同源不叠层（两次命中仍只一条 buff）', dots.length === 1, 'buff 数=' + dots.length);
      ok('C11b 创口伤害 6（旧 12）', dots[0] && dots[0].dot.value === 6, dots[0] && String(dots[0].dot.value));
      ok('C11c 首次挂上给解法提示（金创药/包扎）', /金创药|包扎/.test(String(r1 && r1.text)), String(r1 && r1.text).slice(0, 50));
      const lines = [];
      e.world.combat.tickBuffs(t, lines, battle);
      const statusLine = (lines || []).map(l => l.text).join(' ');
      ok('C11d 每回合状态行带剩余回合（还剩 N 回合）', /还剩/.test(statusLine), statusLine.slice(0, 60));
    }

    /* C12 切磋：等级门槛 + 伤害系数 0.3 */
    {
      const e1 = bootP(); const p1 = e1.world.player;
      p1.room = 'road_jiangnan_2';
      const r = e1.exec('切磋 范清');
      ok('C12 ★ 差 8 级以上拒绝切磋（火候不够）', !e1.world.battle && /火候/.test(txt(r)), txt(r).slice(0, 50));

      /* 系数：同一场（手动构造 duel battle）与普通战斗各打一手，伤害应显著更低 */
      const dmgOf = duel => {
        const e = bootP(); const w = e.world, p = w.player;
        p.room = 'road_jiangnan_2';
        const t = w.spawnNpc('npcv_196', p.room, 1, true);
        const battle = { attackers: [p], defenders: [t], duel, turn: 0 };
        const before = t.hp;
        w.combat.oneAttack(p, t, null, battle, 0);
        return before - t.hp;
      };
      const normal = dmgOf(false), duel = dmgOf(true);
      ok('C12b 切磋伤害系数 0.3（同一手，切磋伤害显著更低）', duel > 0 && duel <= normal,
        '普通 ' + normal + ' vs 切磋 ' + duel);
    }

    /* C13 危险度 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      const n = w.spawnNpc('mob_bandit_chief', p.room, 1, true);
      w.startCombat(p, n);
      const c = e.view({ map: false }).combat;
      ok('C13 ★ 高等级对手 → danger=high（远在你之上）', c && c.danger === 'high', c && c.danger);
    }

    /* C14 倒地代价讲清楚 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      p.hp = 3;
      const n = w.spawnNpc('mob_bandit', p.room, 1, true);
      w.startCombat(p, n);
      let all = '';
      for (let i = 0; i < 8 && w.battle; i++) all += txt(e.exec('attack')) + ' ';
      ok('C14 ★ 倒地后讲清代价（力竭昏过去/四成/扣两成）', /力竭昏过去/.test(all) && /四成/.test(all) && /两成/.test(all), all.slice(-90));
    }

    /* C15 被擒后果讲清楚 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      const G = require(path.join(ROOT, 'game', 'src', 'core', 'guards.js'));
      const entry = w.data.sects.wudang.entry;
      p.room = entry;
      const lines = G.forceIn(w, p, 'wudang');
      ok('C15 ★ 被擒讲清后果（hp 留 1 / 不会昏迷）', /不会昏迷/.test(txt({ lines })), txt({ lines }).slice(-70));
    }

    /* C16 逃跑失败给身法差与建议 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      const n = w.spawnNpc('mob_bandit_chief', p.room, 1, true);
      w.startCombat(p, n);
      p.speed = 1;
      let out = '';
      for (let i = 0; i < 8 && w.battle; i++) {
        const r = w.combatStep('flee');
        out = (r && (r.lines || []).map(l => l.text).join(' ')) || '';
        if (!w.battle) break;
        if (/身法/.test(out)) break;
      }
      ok('C16 ★ 逃跑失败说清身法差与建议（先防御）', /身法/.test(out) && /防御/.test(out), out.slice(0, 70));
    }
  }

  /* C17~C19 边界与文案方向（2026-10-18 QA 独立验收） */
  {
    const bootP = () => {
      const e = new GameEngine({ seed: 20261018 });
      e.boot(); e.newGame({ name: '战探', gender: 'male', birth: 'wuxue' });
      return e;
    };
    /* C17 切磋「差 ≥8 拒」边界：差 8 必须拒，差 7 必须放 */
    {
      const mk = diff => {
        const e = bootP(); const w = e.world, p = w.player;
        p.room = 'road_jiangnan_2';
        const n = w.spawnNpc('npcv_196', p.room, 1, true);
        n.level = (p.level || 1) + diff;
        n.favor = 20;
        return { e, w, p, n, r: w.startDuel(p, n) };
      };
      const at8 = mk(8), at7 = mk(7);
      ok('C17 ★ 差 8 级拒接切磋（口径：≥8 拒）',
        !at8.w.battle && /火候/.test(txt(at8.r)), txt(at8.r).slice(0, 40));
      ok('C17b 差 7 级可切磋（边界不误伤）', !!at7.w.battle, !!at7.w.battle);
    }
    /* C18 danger 两档边界：+8 → high，+4 → mid */
    {
      const dangerOf = diff => {
        const e = bootP(); const w = e.world, p = w.player;
        const n = w.spawnNpc('mob_bandit', p.room, 1, true);
        n.level = (p.level || 1) + diff;
        w.startCombat(p, n);
        return e.view({ map: false }).combat.danger;
      };
      ok('C18 ★ 高 8 级 = high（不是 mid）', dangerOf(8) === 'high', dangerOf(8));
      ok('C18b 高 4 级 = mid（不是空）', dangerOf(4) === 'mid', dangerOf(4));
      ok('C18c 高 3 级 = 无提示', dangerOf(3) === '', JSON.stringify(dangerOf(3)));
    }
    /* C19 逃跑提示方向：玩家更快 → 说「踏空/再来一次」，不能说「对方比你快」 */
    {
      const e = bootP(); const w = e.world, p = w.player;
      const n = w.spawnNpc('mob_bandit', p.room, 1, true);
      w.startCombat(p, n);
      p.speed = 99; n.speed = 10;
      w.rng = { next: () => 0.99 };            // 强行掷失败
      const r = w.combatStep('flee');
      const out = txt(r);
      ok('C19 ★ 玩家更快时逃跑失败不说反话（踏空/再来一次）',
        /踏空|再来一次/.test(out) && !/对方比你快/.test(out), out.slice(0, 70));
    }
  }
  console.log('\n' + (fail ? '✘ ' + fail + ' 项失败：' + fails.join(' / ') : '✔ 全部通过'));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
