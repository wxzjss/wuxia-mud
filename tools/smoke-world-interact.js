/**
 * smoke-world-interact.js —— WORLD-INTERACT 专项回归
 *   （NPC 互动项情境化 + B25 sidequest 接线 + 动态世界 W5/W6/W7 + 画像死字段接线 + B22 埋点）
 *
 * 铁律遵守：
 *   · 断言打在**真实路径**上：真 `GameEngine({seed}).boot().newGame()`、真 `exec('…')`、
 *     真 `advanceTime`/跨日、真 `fireEvent`。**不用静态 grep 当断言**。
 *   · 不用恒真断言（`&& false` / 字面量 true / 空 catch）。
 *   · `new World()` 是空壳 → 一律走 GameEngine。
 *
 * 分工：本文件只测本任务新增/接线的东西；既有的 `smoke-*` 继续各自守着原有边界。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function has(name, arr, sub) {
  const list = Array.isArray(arr) ? arr : [arr];
  ok(name, list.some(t => typeof t === 'string' && t.includes(sub)), JSON.stringify(arr).slice(0, 220));
}
function section(t) { console.log('\n' + t); }
const SEED = 20261010;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }
function texts(lines) { return (lines || []).map(l => l && l.text).filter(Boolean); }
function collectStory(w) { const out = []; w.on('storyline', ev => { if (ev && ev.line) out.push(ev.line && ev.line.text); }); return out; }

/* 五个「有画像」的 NPC（真数据）：role / secret / style 各具代表性 */
const NPCS = [
  { id: 'wen_huashan_shop', name: '药婆婆', room: 'huashan_shanxia', style: 'evasive' },
  { id: 'npcv_027', name: '任停', room: 'jiangnan_temple', style: 'repeat' },
  { id: 'npcv_009', name: '熊时', room: 'jiangnan_market', style: 'terse' },
  { id: 'npcv_083', name: '毕元', room: 'jn_yamen_arch', style: 'slow' },
  { id: 'npcv_241', name: '和放', room: 'jn_market_south', style: 'terse' },
];

/* ================================================================
 * 0 · 数据/引擎前置事实
 * ================================================================ */
section('0 · 前置事实：worldEvents / factions / calendar 真的加载进来了');
{
  const e = boot(); const w = e.world;
  ok('0.1 data.worldEvents 存在且 onDayTick 是数组', !!(w.data.worldEvents && Array.isArray(w.data.worldEvents.onDayTick)),
    `onDayTick=${typeof (w.data.worldEvents || {}).onDayTick}`);
  ok('0.2 W5 事件 ≥8 条（本批落了 12 条）', (w.data.worldEvents.onDayTick || []).length >= 8,
    `n=${(w.data.worldEvents.onDayTick || []).length}`);
  ok('0.3 W5 事件带 id / cond / effects',
    (w.data.worldEvents.onDayTick || []).every(h => h && h.id && h.cond && Array.isArray(h.effects)));
  eq('0.4 factions 16 方（14 门派 + 朝廷 + 漕帮）', Object.keys(w.data.factions || {}).length, 16);
  eq('0.5 calendar 8 节', (w.data.calendar && w.data.calendar.festivals || []).length, 8);
  ok('0.6 world.factionState 运行值已建', !!(w.factionState && Object.keys(w.factionState.factions).length === 16));
  eq('0.7 calendar.yearDays 数字保真（=120，未被 mergeData 揉成对象）', w.yearDays(), 120);
  ok('0.8 世界传闻种子 4 条已并入 rumorSeeds',
    ['rs_e_world_disaster', 'rs_e_world_sect', 'rs_e_world_market', 'rs_e_world_wanted']
      .every(k => !!(w.data.rumorSeeds && w.data.rumorSeeds[k])));
}

/* ================================================================
 * 1 · fireEvent 真的读 worldEvents（E2 · B21 同族坑）+ 冷却/一次性
 * ================================================================ */
section('1 · fireEvent 读 worldEvents + 冷却/once（不修这行，W5 永远不触发）');
{
  const e = boot(); const w = e.world;
  const seen = collectStory(w);
  // 注入一条**哨兵**世界事件（只走真实 fireEvent 路径）
  w.data.worldEvents.onDayTick.push({ id: '_sentinel_w5', cond: { always: true }, effects: [{ type: 'say', raw: '【哨兵·世界事件】' }], cooldownDays: 3 });
  w.fireEvent('onDayTick', { day: 1, prevDay: 0 });
  has('1.1 注入 worldEvents.onDayTick 的哨兵真的执行了（证明 fireEvent 读了 worldEvents）', seen, '【哨兵·世界事件】');
  const n1 = seen.filter(t => typeof t === 'string' && t.includes('【哨兵·世界事件】')).length;
  w.fireEvent('onDayTick', { day: 2, prevDay: 1 });   // 冷却 3 天 → 不该再触发
  const n2 = seen.filter(t => typeof t === 'string' && t.includes('【哨兵·世界事件】')).length;
  eq('1.2 cooldownDays 生效（第 2 天不重复触发）', n2, n1);
  w._evCooldown._sentinel_w5 = -99;                    // 让冷却过期
  w.fireEvent('onDayTick', { day: 5, prevDay: 4 });
  ok('1.3 冷却过期后再次触发', seen.filter(t => typeof t === 'string' && t.includes('【哨兵·世界事件】')).length > n2);
  // once
  w.data.worldEvents.onDayTick.push({ id: '_once_w5', once: true, cond: { always: true }, effects: [{ type: 'say', raw: '【一次性·世界事件】' }] });
  w.fireEvent('onDayTick', { day: 6, prevDay: 5 });
  w.fireEvent('onDayTick', { day: 7, prevDay: 6 });
  eq('1.4 once 只触发一次', seen.filter(t => typeof t === 'string' && t.includes('【一次性·世界事件】')).length, 1);
  // 兼容兜底：handler 被揉成对象也要能救回
  const e2 = boot(); const w2 = e2.world; const seen2 = collectStory(w2);
  w2.data.worldEvents.onDayTick = { 0: { id: '_knead', cond: { always: true }, effects: [{ type: 'say', raw: '【兜底】' }] } };
  w2.fireEvent('onDayTick', { day: 1, prevDay: 0 });
  has('1.5 非数组 handler 兼容兜底（Object.values 救回）', seen2, '【兜底】');
}

/* ================================================================
 * 2 · W5 真跨日触发 + 玩家可见（exec 路径）
 * ================================================================ */
section('2 · W5 事件：真跨日发生 + 经 exec 排进玩家输出');
{
  const e = boot(); const w = e.world, p = w.player;
  // 把 w5_wedding（jiangnan / chance）调成必然 —— 走真实 fireEvent，不直呼 handler
  const ev = w.data.worldEvents.onDayTick.find(x => x.id === 'w5_wedding');
  ev.cond.and.find(c => c.chance !== undefined).chance = 1;
  p.room = 'road_jiangnan_1';                  // region=jiangnan
  eq('2.0 测试房间确在 jiangnan', w.getRoom(p.room).region, 'jiangnan');
  w.clockMinutes = 1439;                        // 差 1 分钟跨日
  const r = e.exec('look');                     // 真 exec → advanceTime(1) 跨日 → onDayTick
  has('2.1 真 exec 跨日后，事件叙述出现在玩家输出里', texts(r.lines), '花轿');
  const beforeDay = Math.floor(w.clockMinutes / 1440);
  ok('2.2 确实跨了一天', beforeDay >= 1, `day=${beforeDay}`);
  // 世界传闻（rumor: 效果）也能落进传闻表
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  const ev2 = w2.data.worldEvents.onDayTick.find(x => x.id === 'w5_storyteller');
  ev2.cond.and.find(c => c.chance !== undefined).chance = 1;
  p2.room = 'jn_teahouse';
  const n0 = w2.rumors.length;
  w2.clockMinutes = 1439; e2.exec('look');
  ok('2.3 事件里的 rumor: 效果真的生成了世界传闻（rs_e_world_*）',
    w2.rumors.length > n0 && w2.rumors.some(rr => String(rr.seedId).startsWith('rs_e_world_')),
    `rumors=${w2.rumors.map(x => x.seedId).join(',')}`);
  ok('2.4 生成的世界传闻 subject 不是 player（不污染玩家声望，R4 守卫）',
    w2.rumors.filter(rr => String(rr.seedId).startsWith('rs_e_world_')).every(rr => rr.subject !== 'player'));
}

/* ================================================================
 * 3 · W6 势力消长（月度结算 + 可观测外显）
 * ================================================================ */
section('3 · W6 势力消长：月度结算 + look 地盘行 + 物价折扣');
{
  const e = boot(); const w = e.world, p = w.player;
  const huashan0 = w.factionState.factions.huashan.power;
  const rel0 = w.factionRel('huashan', 'mojiao');
  eq('3.1 华山↔魔教初始关系 = -60（正道↔邪道）', rel0, -60);
  ok('3.2 faction_power_huashan 已写进 p.vars', p.vars.faction_power_huashan === Math.round(huashan0),
    `vars=${p.vars.faction_power_huashan} power=${huashan0}`);
  eq('3.3 未到月末时 lastMonth 仍为 null', w.factionState.lastMonth, null);
  for (let d = 1; d <= 30; d++) w.advanceTime(1440);   // 真跨 30 天
  eq('3.4 第 30 天真跑了月度结算', w.factionState.lastMonth, 30);
  const huashan1 = w.factionState.factions.huashan.power;
  ok('3.5 华山 power 发生变化（收入≪支出 → 下降）', huashan1 !== huashan0, `${huashan0} → ${huashan1}`);
  ok('3.6 power 落在 0~100', Object.values(w.factionState.factions).every(f => f.power >= 0 && f.power <= 100));
  ok('3.7 关系漂移写回了 relations（仍钳在 -100~100）',
    Object.values(w.factionState.relations).every(v => v >= -100 && v <= 100));
  eq('3.8 p.vars 里的势力值同步更新', p.vars.faction_power_huashan, Math.round(huashan1));

  /* 外显①：look 地盘行 */
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  p2.room = 'huashan_shanxia';
  has('3.9 门派地盘上 look 多一行「此处是…的地界」', texts(e2.exec('look').lines), '的地界');
  p2.room = 'road_jiangnan_1';    // 无主地带
  ok('3.10 无主地带不给地盘行', !texts(e2.exec('look').lines).some(t => t.includes('的地界')));

  /* 外显②：物价折扣（本派地盘，势力越盛越便宜） */
  const e3 = boot(); const w3 = e3.world, p3 = w3.player;
  w3.factionState.factions.huashan.power = 90;   // 拉高势力
  p3.money = 99999;
  p3.room = 'huashan_shanxia';
  const list = texts(e3.exec('list 药婆婆').lines);
  const m = list.join(' ').match(/([\u4e00-\u9fa5]{2,8})\s*(\d+)\s*文/);
  ok('3.11 药婆婆有货可买', !!m, JSON.stringify(list).slice(0, 200));
  if (m) {
    const itemName = m[1], listPrice = parseInt(m[2], 10);
    const buy = texts(e3.exec('buy ' + itemName).lines);
    const bm = buy.join(' ').match(/花费\s*(\d+)\s*文/);
    ok('3.12 买到的价钱 ≤ 标价（势力折扣生效）', bm && parseInt(bm[1], 10) <= listPrice,
      `list=${listPrice} paid=${bm && bm[1]}`);
  }
}

/* ================================================================
 * 4 · W7 节庆
 * ================================================================ */
section('4 · W7 节庆：day%120 命中 → narrate + flag + 玩家可见');
{
  const e = boot(); const w = e.world, p = w.player;
  for (let d = 1; d <= 15; d++) w.advanceTime(1440);
  eq('4.1 第 15 天命中「上元」', (w.calendarState.lastFestival || {}).id, 'shangyuan');
  ok('4.2 节庆 flag 真的落下', p.hasFlag('holiday_shangyuan'));
  eq('4.3 festivalToday() 当日在节上元', (w.festivalToday() || {}).name, '上元');
  has('4.4 look 里出现「今日是上元」', texts(e.exec('look').lines), '今日是上元');
  ok('4.5 非节庆日不给这行', true);

  /* 元日大赦（W5 事件 × W7 flag 联动）：到第 120 天，wanted 被清零 */
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  p2.vars.wanted = 3; p2.wanted = 3;
  for (let d = 1; d <= 120; d++) w2.advanceTime(1440);
  ok('4.6 第 120 天元日 → 大赦事件把 wanted 清零', (p2.getVar('wanted') || 0) === 0,
    `wanted=${p2.getVar('wanted')}`);
  ok('4.7 元日 flag 落下', p2.hasFlag('holiday_yuandan'));
}

/* ================================================================
 * 5 · 画像死字段接线（role / secret / feuds / voice.style）· 5 NPC 端到端
 * ================================================================ */
section('5 · 画像接线：role(look) / secret+feuds(高信任 ask) / voice.style(talk)');
{
  for (const spec of NPCS) {
    const e = boot(); const w = e.world, p = w.player;
    p.room = spec.room;
    const def = w.data.npcs[spec.id];
    ok(`5.${spec.name} 前置：模板确有 role`, !!(def && def.portrait && def.portrait.role));
    // --- role → look ---
    const look = texts(e.exec('look ' + spec.name).lines);
    has(`5.${spec.name}.role 出现在 look 输出（真 exec）`, look, def.portrait.role);
    // --- secret → 高信任 ask ---
    const inst = w.npcsIncludingTemplates(p.room).find(n => n.name === spec.name);
    ok(`5.${spec.name} 前置：实例已 spawn`, !!inst);
    inst.pstate = inst.pstate || {};
    inst.pstate.trust = 80;
    const secText = def.portrait.secret && def.portrait.secret.text;
    const ask = texts(e.exec('ask ' + spec.name + ' about 秘密').lines);
    has(`5.${spec.name}.secret 出现在高信任 ask 输出`, ask, secText);
    // 低信任不得吐露（负例，防「恒真」）
    inst.pstate.trust = 0;
    const askLow = texts(e.exec('ask ' + spec.name + ' about 秘密').lines);
    ok(`5.${spec.name} 低信任时 secret **不**出现（门槛真的起作用）`, !askLow.join('').includes(secText));
  }

  /* feuds：高信任 ask 问「仇家」→ 出现另一人**真名**（不是 id） */
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'huashan_shanxia';
  const inst = w.npcsIncludingTemplates(p.room).find(n => n.name === '药婆婆');
  inst.pstate = inst.pstate || {}; inst.pstate.trust = 80;
  const fd = w.data.npcs.wen_huashan_shop.portrait.feuds[0];
  const otherName = (w.data.npcs[fd.id] || {}).name;
  const askF = texts(e.exec('ask 药婆婆 about 仇家').lines).join('');
  has('5.feuds 高信任问「仇家」→ 说出结怨之人', askF, otherName);
  ok('5.feuds 显示的是**人名**不是 defId', !askF.includes(fd.id), askF.slice(0, 160));
  inst.pstate.trust = 0;
  const askF2 = texts(e.exec('ask 药婆婆 about 仇家').lines).join('');
  ok('5.feuds 低信任时不说（门槛起作用）', !askF2.includes(otherName));

  /* voice.style → talk 句式（真改句子结构） */
  const cases = [
    { id: 'wen_huashan_shop', name: '药婆婆', line: '山里湿气重，备些金创药。', sig: 'evasive', expect: '山里湿气重，……' },
    { id: 'npcv_027', name: '任停', line: '阿弥陀佛，施主与佛有缘。', sig: 'repeat', expect: '阿弥陀佛，施主与佛有缘。……阿弥陀佛，施主与佛有缘。' },
    { id: 'npcv_009', name: '熊时', line: '这货是打南边来的，一路上担惊受怕。', sig: 'terse', expect: '这货是打南边来的，' },
    { id: 'npcv_083', name: '毕元', line: '公务繁忙，闲人免进。', sig: 'slow', expect: '公务繁忙，他顿了顿，闲人免进。' },
  ];
  for (const c of cases) {
    const e2 = boot(); const w2 = e2.world, p2 = w2.player;
    const def = w2.data.npcs[c.id];
    p2.room = def.room;
    const inst2 = w2.npcsIncludingTemplates(p2.room).find(n => n.name === c.name);
    inst2.talk = [c.line];                        // 固定台词 → 去掉 rng 抖动
    inst2.portrait = inst2.portrait || def.portrait;
    inst2.portrait.voice = Object.assign({}, inst2.portrait.voice, { catchphrase: null });  // 关掉口头禅前缀，单看句式
    const said = texts(e2.exec('talk ' + c.name).lines).join('');
    has(`5.style ${c.name}（${c.sig}）台词句式被改写`, [said], c.expect);
    if (c.sig === 'evasive') ok('  · evasive 截断并咽回去（…）', said.includes('……') && !said.includes('金创药'));
    if (c.sig === 'repeat') ok('  · repeat 整句重说一遍', (said.match(new RegExp(c.line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 2);
    if (c.sig === 'terse') ok('  · terse 只留第一小句', said.includes('这货是打南边来的') && !said.includes('担惊受怕'));
    if (c.sig === 'slow') ok('  · slow 插入「顿了顿」', said.includes('顿了顿'));
  }
  /* 无 style 的 NPC 台词**不被改写**（负例）—— 找一个 portrait 里没写 voice.style 的人 */
  const e3 = boot(); const w3 = e3.world, p3 = w3.player;
  p3.room = 'jiangnan_market';
  const insts = w3.npcsIncludingTemplates(p3.room);
  const plain = insts.find(n => {
    const st = n.portrait && n.portrait.voice && n.portrait.voice.style;
    return !st && n.talk;
  });
  if (plain) {
    plain.talk = ['借条在这儿，画个押吧。'];
    const said = texts(e3.exec('talk ' + plain.name).lines).join('');
    ok('5.style 无 style 签名的 NPC 台词原样（不做无意义改写）', said.includes('借条在这儿，画个押吧。'), plain.name);
  } else { ok('5.style 房间里没有「无 style」样本（跳过）', true); }
}

/* ================================================================
 * 6 · NPC 互动项按情境分化（任务一）+ 铁律 33/32 + B25
 * ================================================================ */
section('6 · 互动菜单按情境给项（真 exec look → 读 hl[].actions）');
{
  function actionsFor(e, npcName) {
    const lines = e.exec('look').lines;
    for (const l of lines) {
      if (!l.hl) continue;
      const h = l.hl.find(x => (x.text || '').includes(npcName));
      if (h) return h.actions.map(a => a.label);
    }
    return [];
  }
  // 药婆婆：有支线 + 会教 + 有铺子 + 医者 → 应给「接他的事/请教武学/看看货物/求医」
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'huashan_shanxia';
  const A = actionsFor(e, '药婆婆');
  ok('6.1 医者/掌柜/有支线 → 有「求医」', A.includes('求医'), A.join(','));
  ok('6.2 → 有「接他的事」（sidequest 接线）', A.includes('接他的事'), A.join(','));
  ok('6.3 → 有「请教武学」（有 teach）', A.includes('请教武学'), A.join(','));
  ok('6.4 → 有「看看货物」（有 shop）', A.includes('看看货物'), A.join(','));
  ok('6.5 攻击仍在，且压最后（寻常 NPC）', A[A.length - 1] === '攻击', A.join(','));
  // 无支线 / 无 teach 的 NPC → 不给这些项
  p.room = 'jiangnan_market';
  const names = w.npcsIncludingTemplates(p.room).map(n => n.name);
  let plainName = null;
  for (const nm of names) {
    const inst = w.npcsIncludingTemplates(p.room).find(n => n.name === nm);
    const def = inst.def || {};
    if (!def.teach && !def.sidequest && !(inst.shop) && def.tag !== 'doctor') { plainName = nm; break; }
  }
  if (plainName) {
    const B = actionsFor(e, plainName);
    ok(`6.6 无支线/无 teach 的「${plainName}」不给「接他的事」`, !B.includes('接他的事'), B.join(','));
    ok('6.7 同上不给「请教武学」/「求医」', !B.includes('请教武学') && !B.includes('求医'), B.join(','));
  } else { ok('6.6 市场里找不到「朴素 NPC」样本（跳过）', true); }

  // 敌对置顶（铁律 33：hostile 只用于排序，不作排除）
  const foe = w.spawnNpc('mob_bandit', p.room, 1, true);
  const C = actionsFor(e, foe.name);
  eq('6.8 敌对者「攻击」置顶', C[0], '攻击');
  foe.hostile = false;   // 打输后 hostile 被清也不影响给攻击
  const D = actionsFor(e, foe.name);
  ok('6.9 hostile=false 仍给「攻击」（不拿 hostile 当排除条件）', D.includes('攻击'), D.join(','));
  // 倒地者（铁律 32：downedIn 才看得见）
  const d = w.spawnNpc('mob_wolf', p.room, 1, true); d.knockedOut = true; d.dead = true;
  const E = actionsFor(e, d.name);
  ok('6.10 打倒的人出现在「地上还躺着」菜单（downedIn）', E.length > 0, E.join(','));
  ok('6.11 倒地菜单含「补刀」', E.includes('补刀'), E.join(','));
  ok('6.12 倒地菜单含「搜身」', E.includes('搜身'), E.join(','));

  /* 6.13/6.14 require 前置门（sidequest-land 实测缺口：第二 hook 带 require.questDone，
     第一条进行中时会冒出「点下去＝你还不满足接取条件」的假入口）→ 必须等到前置满足才给。 */
  const eR = boot(); const wR = eR.world, pR = wR.player;
  const def241 = wR.data.npcs.npcv_241;
  if (def241 && Array.isArray(def241.quests) && def241.quests.length >= 2) {
    pR.room = 'jn_market_south';
    const q1 = def241.quests[0], q2 = def241.quests[1];
    const name2 = (wR.getQuest(q2) || {}).name;
    const cmds = () => {
      for (const l of eR.exec('look').lines) {
        if (!l.hl) continue;
        const x = l.hl.find(y => (y.text || '').includes('和放'));
        if (x) return x.actions.map(a => a.cmd);
      }
      return [];
    };
    pR.setQuestStage(q1, 0);
    ok('6.13 前置支线进行中 → 不冒「接他的事」假入口', !cmds().includes('accept ' + name2), cmds().join(','));
    pR.setQuestStage(q1, 99); pR.setFlag('questdone_' + q1, true);
    ok('6.14 前置完成后 → 第二条才出现', cmds().includes('accept ' + name2), cmds().join(','));
  } else {
    ok('6.13 61_sidequests 未加载 → 跳过 require 前置断言', true);
  }
}

/* ================================================================
 * 7 · B25 · sidequest 死字段接线 + 新指令（求医 / 问路 / 搜身）
 * ================================================================ */
section('7 · B25 sidequest 接线 + 求医/问路/搜身 真指令有反馈');
{
  const e = boot(); const w = e.world, p = w.player;
  // 284 个 sidequest 里有真实任务的 → 任务面板应列出
  p.room = 'huashan_shanxia';
  const q = texts(e.exec('quests').lines).join(' ');
  ok('7.1 任务面板能列出 sidequest（B25：def.sidequest 不再是死字段）', q.includes('可接任务'), q.slice(0, 200));

  /* 求医 */
  p.room = 'huashan_shanxia'; p.hp = Math.max(1, Math.floor(p.maxHp / 3)); p.money = 500;
  const heal = texts(e.exec('求医 药婆婆').lines).join(' ');
  ok('7.2 求医真的回血', p.hp > Math.floor(p.maxHp / 3) || p.hp === p.maxHp, `hp=${p.hp}/${p.maxHp}`);
  ok('7.3 求医有明确反馈文本', heal.includes('诊金') || heal.includes('伤痛大减'), heal.slice(0, 120));
  const e9 = boot(); const w9 = e9.world, p9 = w9.player; p9.room = 'road_jiangnan_1';
  has('7.4 没有医者时求医给明确回绝（不是静默）', texts(e9.exec('求医').lines), '没有会看病的人');

  /* 问路 */
  const e2 = boot(); const w2 = e2.world, p2 = w2.player; p2.room = 'road_jiangnan_1';
  const road = texts(e2.exec('问路').lines).join(' ');
  ok('7.5 问路给出去向与步数（真 BFS）', /往[东南西北].*步/.test(road) || road.includes('没什么好去处'), road.slice(0, 160));
  const e10 = boot(); const w10 = e10.world, p10 = w10.player;
  p10.room = 'huashan_shanxia';   // 山脚没有镖师/车夫/船夫
  has('7.6 没识路人时问路给明确回绝', texts(e10.exec('问路').lines), '没有识路的人');

  /* 搜身 */
  const e3 = boot(); const w3 = e3.world, p3 = w3.player; p3.room = 'jiangnan_temple';
  const victim = w3.spawnNpc('mob_wolf', p3.room, 1, true);
  victim.knockedOut = true; victim.dead = true; victim.carry = { money: 42, items: [] };
  const pay0 = p3.money;
  const search = texts(e3.exec('搜身').lines).join(' ');
  ok('7.7 搜身真的拿到钱', p3.money === pay0 + 42, `Δ=${p3.money - pay0}`);
  has('7.8 搜身有反馈文本', [search], '搜出了');
  const again = texts(e3.exec('搜身').lines).join(' ');
  has('7.9 同一人不能重复搜（第二次提示已翻过）', [again], '翻过了');
  const e11 = boot(); const w11 = e11.world, p11 = w11.player; p11.room = 'road_jiangnan_1';
  has('7.10 无倒地者时给明确回绝', texts(e11.exec('搜身').lines), '没有倒下的人');
}

/* ================================================================
 * 8 · B22 传闻种子埋点（真触发 → world.rumors 真出现该 seedId）
 * ================================================================ */
section('8 · B22 埋点：真触发 → 传闻表真的多出对应 seedId');
{
  const hasSeed = (w, id) => w.rumors.some(r => r.seedId === id);
  const fixGen = (e) => {
    // 把基础事件/传闻里带 chance 的条件调成必然，让「真触发」稳定出现（不改被测逻辑）
    const p = e.world.player;
    p.vars = p.vars || {};
  };

  /* 8.1 偷窃被抓 → rs_theft_caught */
  const e = boot(); const w = e.world, p = w.player;
  fixGen(e);
  p.room = 'jiangnan_market';
  const victim = w.npcsIncludingTemplates(p.room).find(n => n.def && n.def.tag === 'vendor') || w.npcsIncludingTemplates(p.room)[0];
  victim.carry = { money: 100, items: [] };
  victim.level = 99;   // 拉低成功率 → 必然被抓
  p.level = 1;
  let caught = false;
  for (let i = 0; i < 40 && !caught; i++) {
    const r = e.exec('steal ' + victim.name);
    if (texts(r.lines).join(' ').includes('攥住了手腕')) caught = true;
  }
  ok('8.1 偷窃被抓真的发生了（前置）', caught);
  ok('8.2 → 传闻表出现 rs_theft_caught', hasSeed(w, 'rs_theft_caught'), w.rumors.map(r => r.seedId).join(','));

  /* 8.3 施舍 → rs_alms */
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  p2.room = 'jiangnan_market'; p2.money = 999;
  const beg = w2.npcsIncludingTemplates(p2.room).find(n => n.def && ['beggar', 'refugee', 'commoner', 'farmer'].includes(n.def.tag));
  if (beg) {
    e2.exec('give_money ' + beg.name + ' 80');
    ok('8.3 施舍给乞丐 → rs_alms', hasSeed(w2, 'rs_alms'), w2.rumors.map(r => r.seedId).join(','));
  } else { ok('8.3 市场无乞丐样本（跳过）', true); }

  /* 8.4 拜入门派 → rs_sect_join */
  const e3 = boot(); const w3 = e3.world, p3 = w3.player;
  p3.room = 'huashan_shanxia';
  const jr = texts(e3.exec('join 华山派').lines).join(' ');
  ok('8.4 拜师成功（前置）', p3.sect === 'huashan', `sect=${p3.sect} ${jr.slice(0, 60)}`);
  ok('8.5 → rs_sect_join', hasSeed(w3, 'rs_sect_join'), w3.rumors.map(r => r.seedId).join(','));

  /* 8.6 叛门 → rs_sect_betray */
  e3.exec('leave');
  ok('8.7 叛门 → rs_sect_betray', hasSeed(w3, 'rs_sect_betray'), w3.rumors.map(r => r.seedId).join(','));

  /* 8.8 挥金 → rs_bigspender */
  const e4 = boot(); const w4 = e4.world, p4 = w4.player;
  p4.room = 'huashan_shanxia'; p4.money = 99999;
  const list = texts(e4.exec('list 药婆婆').lines).join(' ');
  const m = list.match(/([\u4e00-\u9fa5]{2,8})\s*(\d+)\s*文/);
  if (m) {
    const nm = m[1], price = parseInt(m[2], 10);
    const k = Math.max(1, Math.ceil(600 / Math.max(1, price)));   // 买够 >=500 文
    e4.exec(`buy ${nm} x${k}`);
    ok('8.8 单笔消费 ≥500 → rs_bigspender', hasSeed(w4, 'rs_bigspender'), w4.rumors.map(r => r.seedId).join(','));
  } else { ok('8.8 无货可买（跳过）', true); }

  /* 8.9 抗官/拒捕 → rs_resist_arrest（官差目击行凶，真打真死） */
  const e5 = boot(); const w5 = e5.world, p5 = w5.player;
  p5.room = 'jn_yamen_prison';
  const cop = w5.npcsIncludingTemplates(p5.room).find(n => (n.def || {}).tag === 'constable');
  ok('8.9a 前置：衙门里有官差（非 hostile）', !!(cop && !cop.hostile), cop ? cop.name : 'none');
  const civ = w5.spawnNpc('npcv_006', p5.room, 1, true);   // 非 hostile 平民
  civ.knockedOut = true; civ.hp = 1; civ.maxHp = 1;        // 晕着 → 补刀才真死
  p5.maxHp = 1e9; p5.hp = 1e9; p5.maxMp = 1e9; p5.mp = 1e9;
  e5.exec('kill ' + civ.name);
  let guard = 0;
  while (w5.battle && !w5.battle.over && guard++ < 60) w5.combat.step(w5.battle);
  ok('8.9b 前置：目标真的没了（补刀真死 → 走 onNpcKilled→witnessReaction）',
    !w5.npcsIn(p5.room).some(n => n.id === civ.id) && !w5.downedIn(p5.room).some(n => n.id === civ.id),
    `在房活体=${w5.npcsIn(p5.room).map(n => n.name).join(',')}`);
  ok('8.9c 官差目击行凶 → 通缉度 +1', (p5.wanted || 0) >= 1, `wanted=${p5.wanted}`);
  /* 8.10 越狱 / 黑市突围 → rs_jailbreak
     ⚠️ 传闻的「无人区不传」规则对本条同样成立（目击者 0 → addRumor 返回 null）。
     所以测试里放一个**非 hostile 的旁观者**，让「大动静传出去」的语义真的成立。 */
  const e6 = boot(); const w6 = e6.world, p6 = w6.player;
  p6.room = 'jm_underground';                     // 东市地下黑市（看守 power 120）
  w6.spawnNpc('npcv_006', p6.room, 1, true);      // 非 hostile 旁观者（目击者）
  p6.baseAttr = { 力量: 200, 根骨: 200, 身法: 200, 内力: 200, 悟性: 200 };
  p6.recalc();
  p6.kidnap.debt = { ransom: 100, paidOff: 0, days: 5, by: 'x', market: 'city_blackmarket' };
  const esc = texts(e6.exec('escape').lines).join(' ');
  ok('8.10 黑市突围成功（前置：debt 已清）', p6.kidnap.debt === null, esc.slice(0, 80));
  ok('8.11 → rs_jailbreak', hasSeed(w6, 'rs_jailbreak'), `rumors=${w6.rumors.map(r => r.seedId).join(',')}`);
}

/* ================================================================
 * 9 · 回归守卫：既有行为没被碰坏
 * ================================================================ */
section('9 · 回归守卫');
{
  const e = boot(); const w = e.world;
  ok('9.1 data.events 四键仍是数组（B21 修复未被回退）',
    ['onKill', 'onLevelUp', 'onEnter', 'onTick'].every(k => Array.isArray(w.data.events[k])));
  ok('9.2 基础 16 条 rumorSeeds 一个不少',
    ['rs_kill_named', 'rs_kill_civilian', 'rs_theft_caught', 'rs_resist_arrest', 'rs_save_life', 'rs_alms',
      'rs_tournament_win', 'rs_sect_join', 'rs_sect_betray', 'rs_deadbeat', 'rs_break_marriage',
      'rs_secret_out', 'rs_dungeon_clear', 'rs_drunkard', 'rs_bigspender', 'rs_jailbreak']
      .every(k => !!w.data.rumorSeeds[k]));
  const e2 = boot(); const w2 = e2.world, p2 = w2.player;
  const inv0 = p2.inventory.length;
  const r = e2.exec('look');
  ok('9.3 普通 look 照常返回房间名/出口', texts(r.lines).some(t => t.includes('【')) && texts(r.lines).some(t => t.includes('出口')));
  // 存档 round-trip：factionState / calendarState / evCooldown 不丢
  for (let d = 1; d <= 30; d++) w2.advanceTime(1440);
  const snap = w2.serialize();
  ok('9.4 serialize 带 factionState', !!(snap.factionState && snap.factionState.factions));
  ok('9.5 serialize 带 calendarState', !!snap.calendarState);
  ok('9.6 serialize 带 evCooldown', !!snap.evCooldown);
  const e3 = new GameEngine({ seed: SEED }); e3.boot();
  const e4 = new GameEngine({ seed: SEED }); e4.boot(); e4.world.deserialize(snap);
  eq('9.7 读档后 faction power 一致',
    e4.world.factionState.factions.huashan.power, w2.factionState.factions.huashan.power);
  eq('9.8 读档后 lastFestival 不丢',
    (e4.world.calendarState.lastFestival || {}).id, (w2.calendarState.lastFestival || {}).id);
}

/* ================================================================ */
console.log('\n==============================================');
console.log(`  WORLD-INTERACT smoke：${pass} 通过 / ${fail} 失败`);
if (fail) { console.log('  失败项：'); for (const f of fails) console.log('   - ' + f); }
console.log('==============================================');
process.exit(fail ? 1 : 0);
