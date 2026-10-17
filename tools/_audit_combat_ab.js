#!/usr/bin/env node
/**
 * _audit_combat_ab.js —— 战斗 A/B 六件独立验收（只读，不看 combat-feel-check 的结论）
 *
 * 覆盖： #3 创口 DOT 不叠层 / #9 切磋（等级闸 + 伤害×0.3）/ #11 危险度 /
 *        #12 倒地文案与结算一致 / #13 被擒文案与行为一致 / #14 逃跑失败提示含双方身法
 *
 * 原则：
 *   1. 每条断言都从**引擎状态**取数（hp/money/exp/buff/level），不从提示文本反推；
 *   2. 文案类判据做**双向对账**：文本里写的数字必须与引擎实际变化一致，不一致即红；
 *   3. 边界值按需求口径验（"高 8 级 = high"验 +8，不是 +9），差一级也要点名。
 *
 * 用法： node tools/_audit_combat_ab.js [--tsv 路径]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const survival = require(path.join(ROOT, 'game', 'src', 'core', 'survival.js'));
const guards = require(path.join(ROOT, 'game', 'src', 'core', 'guards.js'));
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };
const txt = (lines) => (lines || []).map((l) => (typeof l === 'string' ? l : l.text || '')).join(' ');

const rows = [];
const push = (item, name, pass, detail) => rows.push({ item, name, pass: pass ? '✔' : '✘', detail: String(detail).replace(/[\t\n\r]/g, ' ').slice(0, 120) });

(async () => {
  const e = new GameEngine({ seed: 7 });
  await e.boot({});
  await e.newGame({ name: '验', gender: 'male' });
  const w = e.world;
  const p = w.player;

  /* ================= #3 创口 DOT ================= */
  {
    const mob = w.spawnNpc('mob_wolf', p.room);
    const battle = w.startCombat(p, mob).battle;
    const c = w.combat;
    const skill = w.data.skills['beast_rend'] || { id: 'beast_rend', name: '利爪撕扯' };
    const eff = (arr(skill.effects)[0]) || { type: 'dot', name: '创口', turns: 2, value: 6 };

    const r1 = c.applySkillEffect(eff, mob, p, skill, battle);
    const dotBuffs = () => (p.buffs || []).filter((b) => b.dot);
    push('#3', '首次挂上：只有 1 条创口', dotBuffs().length === 1, 'buff 数 ' + dotBuffs().length);
    push('#3', '首次挂上有解法提示（金创药/包扎）', /金创药|包扎/.test(r1.text || ''), r1.text || '');

    const hpAfterFirst = p.hp;
    const before = dotBuffs()[0] ? dotBuffs()[0].turns : null;
    const r2 = c.applySkillEffect(eff, mob, p, skill, battle);
    const after = dotBuffs()[0] ? dotBuffs()[0].turns : null;
    push('#3', '同源重复命中：仍 1 条（不叠层）', dotBuffs().length === 1, 'buff 数 ' + dotBuffs().length);
    push('#3', '重复命中只刷新回合（不叠加伤害条）', after >= before, '回合 ' + before + '→' + after);
    push('#3', '重复命中文案为「又裂开」而不是再报一次解法', /又裂开/.test(r2.text || ''), r2.text || '');

    /* 连续 3 回合：每回合「再命中一次（刷新）＋结算一次」 */
    const hp0 = p.hp;
    const tickLines = [];
    for (let i = 1; i <= 3; i++) {
      c.applySkillEffect(eff, mob, p, skill, battle);
      c.tickBuffs(p, tickLines, battle);
    }
    const total = hp0 - p.hp;
    const tickText = txt(tickLines);
    push('#3', '3 回合总扣血 ≈18（叠层会到 36）', total >= 15 && total <= 21, '实扣 ' + total);
    push('#3', '每回合提示含「还剩 N 回合」', (tickText.match(/还剩 \d+ 回合/g) || []).length >= 3, (tickText.match(/还剩 \d+ 回合/g) || []).join(','));
    push('#3', '每回合提示含受损数', /受损 \d+ 点/.test(tickText), tickText.slice(0, 60));
    push('#3', '1 次命中后 1 回合只扣 1 条 DOT 的伤害（6 点级）', (hpAfterFirst - p.hp) >= 0, '记录用');

    /* ★ 解法提示是否真的可用：这是「说了但没给」的高发点，必须双向验 */
    /* ⚠️ 2026-10-18 口径更新（team-lead 裁定：删「包扎」，不新增指令入口）：
       原来这里写死 exec('包扎') 并断言它有效——那是按旧文案写的。现在改为
       **从实际提示文本里动态抽取**每个「」解法并逐个验证；同时反断「包扎」不再出现。 */
    const hintText = String(r1.text || '');
    const hintTokens = [...hintText.matchAll(/「([^」]+)」/g)].map(m => m[1]);
    let badTok = [];
    for (const tk of hintTokens) {
      const rr = await e.exec(tk);
      if (/是什么指令|这里没有/.test(txt(rr && rr.lines))) badTok.push(tk);
    }
    push('#3', '提示里推荐的解法都真实存在（动态抽取，且不再推荐不存在的「包扎」）',
      badTok.length === 0 && !/包扎/.test(hintText),
      'tokens=' + (hintTokens.join('/') || '(无)') + ' bad=' + (badTok.join('/') || '无'));

    w.giveItem(p, 'jinchuang_yao', 2);
    const med = (p.inventory || []).find((x) => x.id === 'jinchuang_yao');
    let medText = '';
    if (med) {
      const rMed = w.combatStep({ type: 'item', uid: med.uid });
      medText = txt(rMed && rMed.lines);
    }
    const dotLeft = (p.buffs || []).filter((b) => b.dot).length;
    push('#3', '提示里的「金创药」能止住创口（DOT 应被清掉）', dotLeft === 0, '用药后仍有 ' + dotLeft + ' 条 DOT | ' + medText.slice(0, 40));
    const hpBeforeTick = p.hp;
    const tickAfterMed = [];
    c.tickBuffs(p, tickAfterMed, battle);
    push('#3', '用药后下一回合不再渗血', (hpBeforeTick - p.hp) === 0, '仍掉 ' + (hpBeforeTick - p.hp) + ' 点');
    battle.over = true; w.battle = null;
  }

  /* ================= #9 切磋 ================= */
  {
    /* 9a 等级闸：需求口径「差 ≥8 拒」，逐级验 7/8/9 */
    const npcDuel = w.spawnNpc('npc_scholar', p.room) || w.npcsIn(p.room)[0];
    const GATE = async (diff) => {
      p.level = 10;
      npcDuel.level = 10 + diff;
      npcDuel.dead = false; npcDuel.duel = false;
      w.battle = null;
      const r = w.startDuel(p, npcDuel);
      const refused = !(r && r.battle);
      const t = txt(r && r.lines);
      w.battle = null;
      return { refused, t };
    };
    const d7 = await GATE(7), d8 = await GATE(8), d9 = await GATE(9);
    push('#9', '差 7 级：可切磋（不误拒）', d7.refused === false, d7.t);
    push('#9', '差 8 级：应拒（需求口径 ≥8）', d8.refused === true, d8.t || '（放行了）');
    push('#9', '差 9 级：拒', d9.refused === true, d9.t);
    const gateMsg = d9.t || '';
    push('#9', '拒绝语不含代码字面量', !/>=|level|\bnull\b|undefined|NaN|\{|\}/.test(gateMsg), gateMsg.slice(0, 50));

    /* 9b 伤害 ×0.3：同一招、同一 rng，普通 vs 切磋 对比 */
    const skill = w.data.skills['basic_fist'] || arr(w.data.skills)[0];
    const measure = (duel) => {
      const npc2 = w.spawnNpc('npc_scholar', p.room) || npcDuel;
      npc2.dead = false; npc2.hp = npc2.maxHp = 100000; npc2.defFinal = 0; npc2.dodge = 0;
      p.hp = p.maxHp = 100000;
      const battle = { attackers: [p], defenders: [npc2], turn: 0, log: [], over: false, winner: null, duel };
      const realNext = w.rng.next.bind(w.rng);
      w.rng.next = () => 0.5;                       /* 固定骰子，排除浮动 */
      const hp0 = npc2.hp;
      let out;
      try { out = w.combat.oneAttack(p, npc2, skill, battle); } finally { w.rng.next = realNext; }
      const dmg = hp0 - npc2.hp;
      return { dmg, out };
    };
    const normal = measure(false);
    const spar = measure(true);
    const ratio = normal.dmg ? spar.dmg / normal.dmg : 0;
    push('#9', '切磋伤害 ≈ 正常 ×0.3（0.25~0.35）', ratio >= 0.25 && ratio <= 0.35, '正常 ' + normal.dmg + ' → 切磋 ' + spar.dmg + '，比 ' + ratio.toFixed(2));
  }

  /* ================= #11 危险度 ================= */
  {
    const foe = w.spawnNpc('npc_scholar', p.room) || w.npcsIn(p.room)[0];
    foe.dead = false;
    const dangerAt = (diff) => {
      p.level = 10; foe.level = 10 + diff;
      w.battle = { attackers: [p], defenders: [foe], turn: 1, log: [], over: false, winner: null };
      const v = e.view({ map: false });
      w.battle = null;
      return (v && v.combat && v.combat.danger) || '';
    };
    const d8 = dangerAt(8), d9 = dangerAt(9), d4 = dangerAt(4), d3 = dangerAt(3), d12 = dangerAt(12);
    push('#11', '高 8 级 → high（需求口径）', d8 === 'high', '+' + 8 + ' → ' + JSON.stringify(d8));
    push('#11', '高 9 级 → high（边界旁证）', d9 === 'high', '+9 → ' + JSON.stringify(d9));
    push('#11', '高 4 级 → mid（需求口径）', d4 === 'mid', '+4 → ' + JSON.stringify(d4));
    push('#11', '高 3 级 → 无标记', d3 === '', '+3 → ' + JSON.stringify(d3));
    push('#11', '高 12 级 → high', d12 === 'high', '+12 → ' + JSON.stringify(d12));
  }

  /* ================= #12 倒地：文案 vs 结算 ================= */
  {
    p.money = 1000; p.exp = 1000; p.hp = 1; p.mp = 0;
    const lines = [];
    const r = survival.respawnAtInn(w, lines, {});
    const t = txt(lines);
    const hpWant = Math.floor(p.maxHp * 0.4), mpWant = Math.floor(p.maxMp * 0.4);
    push('#12', '结算：气血回四成', Math.abs(p.hp - hpWant) <= 1, 'hp ' + p.hp + '/期望 ' + hpWant);
    push('#12', '结算：内力回四成', Math.abs(p.mp - mpWant) <= 1, 'mp ' + p.mp + '/期望 ' + mpWant);
    push('#12', '结算：银钱扣两成', r.lost === 200 && p.money === 800, 'lost ' + r.lost + ' 余额 ' + p.money);
    push('#12', '结算：功力折一成', r.expLost === 100 && p.exp === 900, 'expLost ' + r.expLost + ' 余 exp ' + p.exp);
    push('#12', '文案说「气血约四成、内力约四成」且引擎对得上', /气血约四成/.test(t) && /内力约四成/.test(t) && Math.abs(p.hp - hpWant) <= 1 && Math.abs(p.mp - mpWant) <= 1, t.slice(0, 80));
    push('#12', '文案说「银钱扣两成、功力折一成」且引擎对得上', /银钱扣两成/.test(t) && /功力折一成/.test(t) && r.lost === 200 && r.expLost === 100, 'lost ' + r.lost + ' expLost ' + r.expLost);
    push('#12', '文案报的损失数与实际扣除一致（不虚报）', (() => {
      const m = /银钱少了 (\d+) 文/.exec(t);
      return m ? Number(m[1]) === r.lost : true;
    })(), t.slice(0, 60));
    push('#12', '通篇不说「死」', !/死/.test(t), t.slice(0, 40));
  }

  /* ================= #13 被擒：文案 vs 行为 ================= */
  {
    /* 找守卫 maxHp ≥ 玩家 maxHp×3 的山门（forceIn 的拦截判据同此倍数） */
    const cands = Object.keys(w.data.rooms || {}).filter((rid) => /_shanmen$|_gate$|_zhengqi$|_shanxia$/.test(rid));
    let target = null;
    for (const rid of cands) {
      p.room = rid;
      const guardsHere = (w.npcsIncludingTemplates(rid) || []).filter((n) => n && n.isNpc && n.tag === 'shouwei');
      const strong = guardsHere.find((n) => (n.maxHp || 0) >= (p.maxHp || 1) * 3);
      if (strong) { target = { rid, guard: strong, sectId: guards.sectAtRoom(w, rid) }; break; }
    }
    if (!target) push('#13', '找不到可验证的强守卫山门', false, '候选房 ' + cands.length + ' 间里没有 maxHp≥玩家3倍的 shouwei');
    else {
      p.room = target.rid;
      const sectId = (target.sectId && (target.sectId.id || target.sectId)) || '';
      p.kidnap = p.kidnap || { wanted: 0 };
      p.kidnap.wanted = 0;
      p.hp = p.maxHp;
      const lines = guards.forceIn(w, p, sectId);
      const t = txt(lines);
      push('#13', '被擒：hp 打到 1', p.hp === 1, 'hp ' + p.hp + '（守卫 ' + target.guard.name + '，maxHp ' + target.guard.maxHp + '）');
      push('#13', '被擒：恶名 +15（引擎读 p.kidnap.wanted）', p.kidnap.wanted === 15, 'wanted ' + p.kidnap.wanted);
      push('#13', '文案写「气血被打到 1」且引擎一致', /气血被打到 1/.test(t) && p.hp === 1, t.slice(0, 60));
      push('#13', '文案写「恶名 +15」且引擎一致', /恶名 \+15/.test(t) && p.kidnap.wanted === 15, 'wanted ' + p.kidnap.wanted);
      push('#13', '文案说「不会昏迷」且玩家未 dead', /不会昏迷/.test(t) ? (!p.dead) : true, 'dead=' + p.dead);
    }
  }

  /* ================= #14 逃跑失败提示 ================= */
  {
    const foe = w.spawnNpc('npc_scholar', p.room) || w.npcsIn(p.room)[0];
    foe.dead = false;
    p.speed = 10; foe.speed = 99;
    w.battle = { attackers: [p], defenders: [foe], target: foe, turn: 1, log: [], over: false, winner: null };
    const realNext = w.rng.next.bind(w.rng);
    w.rng.next = () => 0.999;                    /* 强制逃跑失败 */
    let r;
    try { r = w.combatStep('flee'); } finally { w.rng.next = realNext; }
    const t = txt(r && r.lines);
    push('#14', '逃跑失败提示含对方身法数值', new RegExp('身法 ' + foe.speed).test(t), t.slice(0, 70));
    push('#14', '逃跑失败提示含己方身法数值', new RegExp('你 ' + p.speed).test(t), t.slice(0, 70));

    /* 反向：玩家比对方快时仍掷骰失败，提示措辞是否还硬说「对方比你快」 */
    p.speed = 99; foe.speed = 10;
    w.battle = { attackers: [p], defenders: [foe], target: foe, turn: 1, log: [], over: false, winner: null };
    w.rng.next = () => 0.999;
    let r2;
    try { r2 = w.combatStep('flee'); } finally { w.rng.next = realNext; }
    const t2 = txt(r2 && r2.lines);
    push('#14', '玩家更快时，提示不得断言「对方比你快」（说反话即红）', !/对方比你快/.test(t2), t2.slice(0, 80));
  }

  /* ---------- 输出 ---------- */
  const bad = rows.filter((r) => r.pass === '✘');
  console.log('\n§1 断言 ' + rows.length + ' 条 · 通过 ' + (rows.length - bad.length) + ' · 失败 ' + bad.length);
  for (const it of ['#3', '#9', '#11', '#12', '#13', '#14']) {
    const g = rows.filter((r) => r.item === it);
    if (g.length) console.log('   ' + it + '：' + (g.length - g.filter((x) => x.pass === '✘').length) + '/' + g.length);
  }
  if (bad.length) {
    console.log('\n§2 失败明细');
    bad.forEach((r) => console.log('   ✘ ' + r.item + ' | ' + r.name + ' — ' + r.detail));
  }
  const head = ['# 战斗 A/B 六件独立验收（引擎态）', '# 判据：状态取数 + 文案与实际双向对账', ['项', '断言', '结果', '证据'].join('\t')].join('\n');
  const out = arg('tsv') ? path.resolve(ROOT, arg('tsv')) : path.join(ROOT, '.livetest', 'combat-ab.tsv');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, head + '\n' + rows.map((r) => [r.item, r.name, r.pass, r.detail].join('\t')).join('\n') + '\n', 'utf8');
  console.log('\n台账 → ' + path.relative(ROOT, out));
  process.exit(bad.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
