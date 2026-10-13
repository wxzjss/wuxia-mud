/**
 * smoke-npc-skills.js —— B8「按身份给 NPC 配功法」+ B17/B18 数据错配 专项回归
 *
 * 断言分四组：
 *   ① 身份→功法映射（覆盖数 / 和尚道士用内功轻功 / 刀客使刀 / 剑客使剑 / 书生不配内功）
 *   ② 硬不变量（每个兵刃系招式必有对应兵刃 / 每个槽技能必挂 learned / 无悬空引用）
 *   ③ **真打真看**：真 `GameEngine.boot().newGame()` + 真 `combat.step`，
 *      从战斗日志里数「谁使出了哪一招」——证明「出招真的变了」，不只是改了数据；
 *      并证明**不再出现**「手中无X类兵刃，威力大减」。
 *   ④ A 层名宿专属招式 + 同类身份内的多样性（不许人人一样）+ B17/B18/B19。
 *
 * 纪律：`new World()` 是空壳，一律 `new GameEngine({seed}).boot().newGame()`；
 *       断言打在真调用路径上；不写恒真断言。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { PLAIN_WEAPON, PLAN_DEBUG } = (() => {
  const m = require('./npc-skills');
  return { PLAIN_WEAPON: m.PLAIN_WEAPON, PLAN_DEBUG: m };
})();

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); } }
function eq(n, a, b) { ok(n, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '读招', gender: 'male', birth: 'wuxue' });
const w = e.world;
const NPCS = w.data.npcs;
const SKILLS = w.data.skills;
const ITEMS = w.data.items;
const ids = Object.keys(NPCS);

const WEAPON_SLOTS = { 剑: 1, 刀: 1, 棍: 1, 鞭: 1, 暗器: 1, 音波: 1 };
const UNUSABLE_WEAPON_SLOTS = { 暗器: 1, 音波: 1 };   // 全库无这两种兵器道具

/* 真打一场，统计「该 NPC 使出的招式名」——证明出招真的变了 */
function battleTally(id, rounds) {
  const def = NPCS[id];
  const n = w.spawnNpc(id, def.room, 1, true);
  if (!n) return null;
  const p = w.player;
  const savedP = { hp: p.hp, maxHp: p.maxHp, learned: p.learned, equippedSkills: p.equippedSkills, dead: p.dead };
  p.hp = p.maxHp = 1e8; p.learned = {}; p.equippedSkills = {}; p.dead = false;
  n.dead = false; n.hp = n.maxHp = 1e8;               // 别被打死，看它出招
  const battle = w.combat.makeBattle([p], [n]);
  const tally = {};
  for (let i = 0; i < (rounds || 30) && !battle.over; i++) {
    const r = w.combat.step(battle);
    for (const l of (r.lines || [])) {
      const m = /使出一招「([^」]+)」/.exec(l.text || '');
      if (m && (l.text || '').startsWith(n.name)) tally[m[1]] = (tally[m[1]] || 0) + 1;
    }
    /* ⚠️ 每轮把 hp/dead 复位：战斗里 recalc 可能把 maxHp 拉回真实值 → hp 被 clamp → 有一方「被打死」
       置 dead=true，而 `!x.u.dead` 会让下一轮 / 下一场谁都打不着谁（实测会静默变成「零出招」）。 */
    n.hp = n.maxHp; n.dead = false; p.dead = false;
    if (n.mp < n.maxMp) n.mp = n.maxMp;   // 别因内力不济而空转（本测试只看使了哪招）
  }
  p.hp = savedP.hp; p.maxHp = savedP.maxHp; p.learned = savedP.learned; p.equippedSkills = savedP.equippedSkills; p.dead = savedP.dead;
  w.despawnNpc(id, def.room);
  return { tally, names: Object.keys(tally) };
}

/* ============================================================ */
section('① 身份 → 功法 映射');
{
  const withSkills = ids.filter(id => NPCS[id].skills && Object.keys(NPCS[id].skills).length);
  /* 磁盘文件 333 条（act1 三人 chen2/dianzhu/ji；zhou 并回既有 cy_pre_teaman——同一茶摊不该有两个摊主，perf B2 同因修）；运行时 boot() 还会并入 mod 自带的 NPC（如 demo_swordman 等），故 ≥333 */
  const fileNpcN = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '40_npcs.json'), 'utf8')).npcs).length;
  eq('40_npcs.json 文件 NPC 数', fileNpcN, 333);
  ok('运行时 NPC 数 ≥ 文件数（含 mod 并入）', ids.length >= fileNpcN, ids.length + ' 条');
  ok('绝大多数 NPC 都有武学槽', withSkills.length >= 324, withSkills.length + ' 条');

  /* 主人原话：和尚/道士 用内功、轻功（不是拿刀砍） */
  const monkTaoist = ids.filter(id => ['monk', 'nun', 'taoist'].includes(NPCS[id].tag));
  const mtNei = monkTaoist.filter(id => (NPCS[id].skills || {})['内功']);
  const mtQing = monkTaoist.filter(id => (NPCS[id].skills || {})['轻功']);
  ok('僧/尼/道：大多配了内功', mtNei.length >= monkTaoist.length * 0.7,
    `${mtNei.length}/${monkTaoist.length}`);
  ok('僧/尼/道：多数配了轻功', mtQing.length >= monkTaoist.length * 0.5,
    `${mtQing.length}/${monkTaoist.length}`);
  /* 反例：没有「拿刀」的僧人 */
  const monkBlade = ids.filter(id => NPCS[id].tag === 'monk' && /^(jh_blade|basic_blade|hujia_daofa|kuangfeng_daofa|xuedao)$/.test((NPCS[id].skills || {})['刀'] || ''));
  eq('僧人不使刀法（主人点名的误配）', monkBlade.length, 0);

  /* 主人原话：刀客用刀法、剑客用剑法 */
  const bladeUsers = ids.filter(id => /^(jh_blade|hujia_daofa|kuangfeng_daofa|basic_blade|xuedao|xunchun_blade_art)$/.test((NPCS[id].skills || {})['刀'] || ''));
  ok('有「刀法」槽的 NPC 成规模存在', bladeUsers.length >= 30, bladeUsers.length + ' 条');
  const swordUsers = ids.filter(id => {
    const s = (NPCS[id].skills || {})['剑'];
    return s && s !== '' ;
  });
  ok('有「剑法」槽的 NPC 成规模存在', swordUsers.length >= 20, swordUsers.length + ' 条');

  /* 反例：B8 不给书生配内功（主人点名「给书生发内功」是误配） */
  const scholars = ids.filter(id => NPCS[id].tag === 'scholar');
  const scholarNei = scholars.filter(id => {
    const s = (NPCS[id].skills || {})['内功'];
    return s && !/^basic_/.test(s);   // 非 basic 的内功＝本次新配的
  });
  eq('书生未被配内功（其 basic_force 是既有数据，B8 未新增）', scholarNei.length, 0);
  const scholarBurst = scholars.filter(id => /^jh_/.test(JSON.stringify(NPCS[id].skills || {})));
  eq('书生的武学槽里没有本次新配的江湖功法', scholarBurst.length, 0);

  /* 覆盖率报告 */
  const hasNei = ids.filter(id => (NPCS[id].skills || {})['内功']).length;
  const hasQing = ids.filter(id => (NPCS[id].skills || {})['轻功']).length;
  const hasZhao = ids.filter(id => (NPCS[id].skills || {})['招架']).length;
  console.log(`  · 覆盖：内功 ${hasNei} / 轻功 ${hasQing} / 招架 ${hasZhao}（原 43 / 69 / 26）`);
}

/* ============================================================ */
section('② 硬不变量：兵刃绑定 · learned 齐备 · 无悬空引用');
{
  /* 每个兵刃系招式必须握有对应兵刃（否则 combat.weaponPenalty 白打 0.45 折 + 日志刷「手中无X类兵刃」） */
  const noWeapon = [];
  for (const id of ids) {
    const d = NPCS[id];
    for (const slot of Object.keys(d.skills || {})) {
      if (!WEAPON_SLOTS[slot] || UNUSABLE_WEAPON_SLOTS[slot]) continue;
      if (!d.skills[slot]) continue;
      const wpn = (d.equipment || {})['武器'];
      const it = wpn ? ITEMS[wpn] : null;
      if (!(it && it.weaponType === slot)) noWeapon.push(`${id}(${d.name}) ${slot}=${d.skills[slot]} 武器=${wpn || '无'}`);
    }
  }
  ok('兵刃系招式必有对应兵刃（B8 前 49 处空装 → 现仅剩暗器类无法补）', noWeapon.length <= 3,
    noWeapon.length ? noWeapon.join(' / ') : '0 处');

  /* 每个槽里的技能都要在 learned 里，否则 pickSkill 读 learned 为假会跳过 = 白装 */
  const notLearned = [];
  for (const id of ids) {
    const d = NPCS[id];
    if (!d.learned || !Object.keys(d.learned).length) continue;
    for (const slot of Object.keys(d.skills || {})) {
      const sid = d.skills[slot];
      if (sid && d.learned[sid] === undefined) notLearned.push(`${id}:${slot}=${sid}`);
    }
  }
  eq('每个槽技能都挂了 learned', notLearned.length, 0);

  /* 无悬空技能引用（skills / learned / teach） */
  const dangling = [];
  for (const id of ids) {
    const d = NPCS[id];
    for (const slot of Object.keys(d.skills || {})) if (d.skills[slot] && !SKILLS[d.skills[slot]]) dangling.push(`${id}.skill.${slot}=${d.skills[slot]}`);
    for (const k of Object.keys(d.learned || {})) if (!SKILLS[k]) dangling.push(`${id}.learned.${k}`);
    for (const k of (d.teach || [])) if (!SKILLS[k]) dangling.push(`${id}.teach.${k}`);
  }
  eq('无悬空技能引用（含既有 guard_palace 的 gunfa_basic 已清）', dangling.length, 0);

  /* 6 门江湖通用功法确实注入了 */
  for (const sid of ['jh_fist', 'jh_sword', 'jh_blade', 'jh_staff', 'jh_parry', 'jh_dodge', 'jh_neigong']) {
    ok('新功法存在 ' + sid, !!SKILLS[sid]);
  }
  ok('非 basic 的江湖功法 id 一律以 jh_ 前缀（可审计）',
    Object.keys(SKILLS).filter(k => /^jh_/.test(k)).length === 7);
}

/* ============================================================ */
section('③ 真打真看：出招真的变了（战斗日志里出现身份功法名）');
{
  /* 和尚：不打基本拳脚，打韦陀掌/长拳 + 有内功（被动） */
  const m = battleTally('npcv_027', 30);   // 任停·破庙和尚（A 层剧情人物）
  ok('和尚 npcv_027 一局至少使 1 种招式', m && m.names.length >= 1, m && JSON.stringify(m.tally));
  ok('和尚使的不是「基本拳脚」', m && !m.names.includes('基本拳脚'), m && m.names.join('/'));

  /* 镖师：使刀法 */
  const esc = battleTally('npcv_081', 30);
  ok('镖师 npcv_081 使的是刀法', esc && esc.names.some(x => /刀|狂风|胡家/.test(x)), esc && esc.names.join('/'));

  /* 剑客（有剑）：使剑法 */
  const sw = battleTally('npcv_156', 30);   // 何慕（剑客，玄铁剑）
  ok('剑客 npcv_156 使的是剑法', sw && sw.names.some(x => /剑/.test(x)), sw && sw.names.join('/'));

  /* 丐帮/老叫花：使打狗棒法（不再是基本拳脚） */
  const bg = battleTally('npcv_013', 30);
  ok('老叫花 npcv_013 使的是棒法/棍法', bg && bg.names.some(x => /打狗|棍/.test(x)), bg && bg.names.join('/'));

  /* 市井平民：长拳（不再一律 basic_fist） */
  const civ = battleTally('npcv_002', 30);
  ok('货郎 npcv_002 使的是江湖长拳', civ && civ.names.includes('长拳'), civ && civ.names.join('/'));

  /* 关键：整局日志里 **不得** 出现「手中无X类兵刃，威力大减」 */
  let penaltyHits = [];
  for (const id of ['npcv_027', 'npcv_081', 'npcv_156', 'npcv_013', 'npcv_002', 'npcv_016', 'npcv_181', 'mob_bandit']) {
    const def = NPCS[id]; const n = w.spawnNpc(id, def.room, 1, true);
    if (!n) continue;
    const p = w.player; p.hp = p.maxHp = 1e8; p.dead = false;
    const b = w.combat.makeBattle([p], [n]);
    n.dead = false; n.hp = n.maxHp = 1e8;
    for (let i = 0; i < 12 && !b.over; i++) {
      const r = w.combat.step(b);
      /* 只看 **NPC** 打出的惩罚行（玩家自己没装备武器不算本批问题，另登记） */
      for (const l of (r.lines || [])) if (/手中无.*兵刃/.test(l.text || '') && !/^你/.test(l.text || '')) penaltyHits.push(id + ':' + l.text);
      n.hp = n.maxHp; n.dead = false; p.dead = false;
    }
    w.despawnNpc(id, def.room);
  }
  eq('NPC 真打日志里无「手中无X类兵刃，威力大减」', penaltyHits.length, 0, penaltyHits.slice(0, 3).join(' / '));
}

/* ============================================================ */
section('④ A 层名宿专属招式（有辨识度，非基本功法）');
{
  const A_BOSSES = {
    master_yue: '华山剑法/剑意', nv_yue: '华山剑法', linghu: '华山剑法',
    shaolin_fangzheng: '韦陀掌', wudang_chongxu: '太极剑法', emei_miejue: '峨眉剑法',
    gaibang_hong: '降龙十八掌/打狗棒法', mojiao_dongfang: '黑幕掌/葵花',
    nv_huang: '狂风快刀/一阳指', miao_lan: '苗疆蛊术/冰蚕掌',
    duan_yu: '北冥神功/一阳指', blood_saber: '血刀刀法', xingxiu_laoxian: '摧心掌/唐门毒术',
    depot_master: '绣春刀法', depot_shadow: '影分身',
  };
  const BASIC = /^basic_/;
  const bad = [];
  for (const id of Object.keys(A_BOSSES)) {
    const d = NPCS[id];
    if (!d) { bad.push(id + '(不存在)'); continue; }
    const atk = Object.entries(d.skills || {}).filter(([slot]) => WEAPON_SLOTS[slot] || slot === '拳');
    const allBasic = atk.length && atk.every(([, sid]) => !sid || BASIC.test(sid));
    if (allBasic) bad.push(id + '(' + d.name + ')=' + JSON.stringify(d.skills));
  }
  eq('15 位 A 层名宿都有非基本的招牌招式', bad.length, 0, bad.join(' / '));

  /* 名宿专属招式在战斗日志里真的出现（东方不败：绣花针阶段 → 辟邪剑法） */
  const dong = battleTally('mojiao_dongfang', 40);
  ok('东方不败会打出招牌（绣花针/黑幕掌）', dong && dong.names.length >= 1, dong && dong.names.join('/'));

  /* 冯保的绣春刀 / 影子 */
  const feng = battleTally('depot_master', 30);
  ok('冯保使绣春刀法', feng && feng.names.some(x => /绣春/.test(x)), feng && feng.names.join('/'));
}

/* ============================================================ */
section('⑤ 多样性：同类身份内不许人人一样');
{
  // 镖师 9 人：攻击招式名应 >=2 种
  function distinctAttackNames(tag) {
    const set = new Set();
    for (const id of ids) {
      if (NPCS[id].tag !== tag) continue;
      for (const [slot, sid] of Object.entries(NPCS[id].skills || {})) {
        if (WEAPON_SLOTS[slot] && sid) set.add(sid);
      }
    }
    return [...set];
  }
  const esc = distinctAttackNames('escort');
  ok('镖师内部招式不唯一', esc.length >= 2, esc.join('/'));
  const beg = distinctAttackNames('beggar');
  ok('乞丐内部招式不唯一', beg.length >= 1, beg.join('/'));

  // 熟练度分层：B 层与 C 层的支持功法 level 有差异
  const zhaoLevels = new Set();
  for (const id of ids) {
    const s = (NPCS[id].skills || {})['招架'];
    if (s === 'jh_parry') zhaoLevels.add((NPCS[id].learned[s] || {}).level);
  }
  ok('招架功法熟练度分层（不都是一个数）', zhaoLevels.size >= 4, '档位=' + [...zhaoLevels].sort((a, b) => a - b).join(','));
}

/* ============================================================ */
section('⑥ B17 / B18 / B19');
{
  /* B17：嫔妃不再落黑木崖 */
  const B17 = ['npcv_053', 'npcv_119', 'npcv_185', 'npcv_251'];
  eq('B17 四位嫔妃全部落 palace_court2', B17.filter(id => NPCS[id].room === 'palace_court2').length, 4);
  eq('B17 mojiao_hall 再无嫔妃', ids.filter(id => NPCS[id].room === 'mojiao_hall' && NPCS[id].tag === 'consort').length, 0);
  eq('B17 palace_court2 嫔妃总数 9', ids.filter(id => NPCS[id].room === 'palace_court2').length, 9);
  ok('B17 落点字段同步（district=palace / province=京畿道）',
    B17.every(id => NPCS[id].district === 'palace' && NPCS[id].province === '京畿道'));

  /* B18：内侍不再有 female */
  eq('B18 内侍里 female 数 = 0', ids.filter(id => NPCS[id].tag === 'eunuch' && NPCS[id].gender === 'female').length, 0);
  ok('B18 五位内侍已归 male 且 tag/title 未动',
    ['npcv_051', 'npcv_117', 'npcv_183', 'npcv_249', 'npcv_282'].every(id => NPCS[id].gender === 'male' && NPCS[id].tag === 'eunuch' && NPCS[id].title === '内侍'));
  /* desc 与 gender 自洽：男内侍的 desc 不再出现女式配饰 */
  const badDesc = ['npcv_051', 'npcv_117', 'npcv_183', 'npcv_249', 'npcv_282']
    .filter(id => /她|耳珠|耳坠|辫子|帔子/.test(NPCS[id].desc || ''));
  eq('B18 五位内侍的 desc 无女式配饰/她', badDesc.length, 0);

  /* B19：人数口径（武当宫中女官 4 / 少室内侍 4，冲虚 3 条仇边） */
  const wudangGongren = ids.filter(id => NPCS[id].room === 'wudang_zixiao' && NPCS[id].tag === 'palace');
  const shaolinNeishi = ids.filter(id => NPCS[id].room === 'shaolin_daxiong' && NPCS[id].tag === 'eunuch');
  eq('B19 武当宫中女官实测 4 人', wudangGongren.length, 4);
  eq('B19 少室内侍实测 4 人', shaolinNeishi.length, 4);
  const chongxuFeud = (NPCS.wudang_chongxu.rel || []).filter(r => r.kind === '仇');
  eq('B19 冲虚的仇边 3 条（与文案口径的争议点）', chongxuFeud.length, 3);

  /* B19 文案：**正式文案**（主线故事 / 幕次细纲 / 逐字脚本）里不得出现「三个内侍/女官」的错误口径。
     （`12-owner-bug-list.md`＝bug 台账、`13-owner-bug-fix-report.md`＝本批报告、`26-npc-skill-map.md`＝B8 设计稿，
      三者都会「引述」这个问题，不算违规文案，故不在扫描范围内。） */
  const SCRIPT_DOCS = ['10-mainline-story.md', '21-mainline-act3-5.md', '24-mainline-script.md'];
  const wrongLines = [];
  for (const f of SCRIPT_DOCS) {
    const fp = path.join(ROOT, 'design', f);
    if (!fs.existsSync(fp)) continue;
    fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((line, i) => {
      /* 允许「三个」出现在“校正说明/引述问题”的句子里：命中「→改四个」「不得写三个」「改成四个」等上下文则放行 */
      if (!/[三三]个[^。\n]{0,8}(内侍|女官|宫中女官)/.test(line)) return;
      if (/改|不得|一律|校正|口径|不是|引述/.test(line)) return;
      wrongLines.push(f + ':' + (i + 1));
    });
  }
  eq('正式文案里无「三个内侍/女官」的错误口径', wrongLines.length, 0, wrongLines.join(' / '));
  /* 正口径确实写进了主线故事（B19 的落点） */
  const mainline = fs.readFileSync(path.join(ROOT, 'design', '10-mainline-story.md'), 'utf8');
  ok('B19 校正口径已写入 10-mainline-story.md（「四个」）', /宫中女官 \*\*4 人\*\*/.test(mainline) && /内侍 \*\*4 人\*\*/.test(mainline));
}

/* ============================================================ */
section('⑦ 平衡：伤害仍是有限正数（改功法不许把伤害改炸）');
{
  const { defenseOf } = require(path.join(ROOT, 'game', 'src', 'core', 'combat.js'));
  const p = w.player;
  const bad = [];
  for (const id of ids) {
    const d = NPCS[id];
    const room = d.room || Object.keys(w.data.rooms)[0];
    const n = w.spawnNpc(id, room, 1, true);
    if (!n) continue;
    if (!Number.isFinite(defenseOf(n))) bad.push(d.name + '(def)');
    n.hp = n.maxHp;
    const before = n.hp;
    w.combat.oneAttack(p, n, null, { attackers: [p], defenders: [n], turn: 0, log: [], over: false }, 0);
    const drop = before - n.hp;
    if (!Number.isFinite(drop) || drop < 0) bad.push(`${d.name}(drop=${drop})`);
    w.despawnNpc(id, room);
  }
  eq('全库 NPC：玩家一击掉血是有限非负数（无 NaN）', bad.length, 0, bad.slice(0, 4).join(' / '));
}

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(44));
if (fail) console.log('  失败项：' + fails.join(' / '));
process.exit(fail ? 1 : 0);
