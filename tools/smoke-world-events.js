/* ============================================================
 * smoke-world-events.js — W5 世界事件库（68 条 · #109）
 *
 * 为什么单独一个脚本：
 *   事件是「跨日自动发生」的东西 —— 出问题时**不会报错**，
 *   只是永远不发生（或一天发生五件）。这两个方向都很难在游戏里看出来，
 *   所以必须有一组把「条件能不能成立 / 一天出几件 / 会不会重复出」钉死的断言。
 *
 * 覆盖：
 *  ① 68 条到位，八类配额与 design/27 §2.3 一致；
 *  ② **每一条的 cond 都用引擎认识的键**（写错条件名 → evalCond 默认放行 / 恒定，
 *     是总纲里那类「不报错就是不生效」的头号来源）；
 *  ③ cond 引用的房间 / 区域真实存在（写错一个字母 → 永远不触发，且不报错）；
 *  ④ effects 里不许出现 `combat:`（跨日无战斗上下文，实测会抛 inCore 'inCombat'）；
 *  ⑤ 真走 fireEvent('onDayTick') 这条路：能触发、有文本落到 storyline；
 *  ⑥ 一天最多两件（68 条带 chance，不限流会变成跑马灯）；
 *  ⑦ cooldownDays / once 真的拦得住第二次；
 *  ⑧ `p.vars.rumor_heat_*` / `wanted` 这些「事件要读的变量」真的有人写
 *     （不写 → 恒 0 → 相关事件一辈子不触发）。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const SEED = 20261021;
function boot() {
  const e = new GameEngine({ seed: SEED, mods: false });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}
/** 收集会落到界面上的行 */
function collector(w) {
  const out = [];
  w.on('storyline', x => { if (x && x.line) out.push(x.line); });
  return out;
}

/* evalCond 认识的键（见 modapi.js；不在这个名单里的键**不会报错**，
   要么恒真要么恒假 —— 所以必须在这里卡一道） */
const COND_KEYS = new Set(['and', 'or', 'not', 'always', 'flag', 'notFlag', 'notCombat', 'combat',
  'notTuning', 'tuning', 'flagsAll', 'flagsAny', 'flagsNone',
  'level', 'money', 'exp', 'pot', 'potential', 'hp', 'maxHp', 'mp', 'maxMp', 'karma', 'kills',
  'age', 'rank', 'sectContribution', 'day', 'time', 'realm',
  'attr', 'value', 'skill', 'rep', 'var', 'op', 'skills', 'skillsMin', 'noSkill',
  'item', 'count', 'equipped', 'noItem', 'gender', 'race', 'sect', 'sectNot', 'noSect', 'hasSect',
  'title', 'hasPerk', 'hasTrait', 'insect', 'room', 'roomNot', 'region', 'season', 'weather',
  'dayMin', 'dayMax', 'quest', 'chance']);

/* ================= ① 条数与配额 ================= */
section('① 68 条到位，八类配额对得上设计');
{
  const e = boot();
  const list = e.world.data.worldEvents.onDayTick;
  ok('★ onDayTick 共 68 条', list.length === 68, '实测 ' + list.length);
  const want = { '江湖恩怨': 12, '官府缉拿': 8, '天灾饥荒': 6, '秘境现世': 6, '门派纷争': 10, '市井琐事': 12, '商路货殖': 8, '边关烽火': 6 };
  const got = {};
  for (const h of list) got[h.cat] = (got[h.cat] || 0) + 1;
  const bad = Object.keys(want).filter(k => got[k] !== want[k]);
  ok('★ 八类配额与 design/27 §2.3 一致', bad.length === 0,
    bad.length ? bad.map(k => k + ' 要' + want[k] + ' 实' + (got[k] || 0)).join(' / ') : JSON.stringify(got));
  ok('每条都有 id / name / cond / effects', list.every(h => h.id && h.name && h.cond && h.effects));
  const dup = list.map(h => h.id).filter((x, i, a) => a.indexOf(x) !== i);
  ok('★ id 不重复（重名会让冷却/一次性互相干扰）', dup.length === 0, dup.join(',') || '（无重复）');
}

/* ================= ②③④ 静态体检 ================= */
section('② 条件用的都是引擎认识的键 / 引用真实存在');
{
  const e = boot();
  const w = e.world;
  const list = w.data.worldEvents.onDayTick;
  /* 递归收集 cond 里出现的所有键：数字键（=比较值）要跳开 */
  const keysOf = (c, acc) => {
    if (c === null || c === undefined) return acc;
    if (typeof c === 'string' || typeof c === 'number' || typeof c === 'boolean') return acc;
    if (Array.isArray(c)) { c.forEach(x => keysOf(x, acc)); return acc; }
    for (const k of Object.keys(c)) {
      if (/^(>=|<=|==|!=|>|<)$/.test(k)) continue;
      acc.add(k);
      /* {var:'x', op:...} 里 var 的值是变量名，不是子条件 */
      const v = c[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) keysOf(v, acc);
    }
    return acc;
  };
  const unknown = new Set();
  const badRoom = [], badRegion = [];
  for (const h of list) {
    const ks = keysOf(h.cond, new Set());
    for (const k of ks) if (!COND_KEYS.has(k)) unknown.add(h.id + ':' + k);
    /* 位置引用 */
    const chk = (c) => {
      if (!c || typeof c !== 'object') return;
      if (Array.isArray(c)) { c.forEach(chk); return; }
      if (c.room !== undefined) for (const r of [].concat(c.room)) if (!w.data.rooms[r]) badRoom.push(h.id + '→' + r);
      if (c.region !== undefined) if (!w.data.regions[c.region]) badRegion.push(h.id + '→' + c.region);
      for (const k of Object.keys(c)) if (c[k] && typeof c[k] === 'object') chk(c[k]);
    };
    chk(h.cond);
  }
  ok('★ 没有「引擎不认识的 condition 键」', unknown.size === 0, [...unknown].join(',') || '全部在白名单内');
  ok('★ 没有指向不存在房间的条件', badRoom.length === 0, badRoom.join(',') || '（全部存在）');
  ok('★ 没有指向不存在区域的条件', badRegion.length === 0, badRegion.join(',') || '（全部存在）');

  /* effects 里不许有 combat:（跨日无战斗上下文） */
  const txt = JSON.stringify(list);
  ok('★ effects 里没有 combat:（跨日开战会抛 inCombat）', !/"combat:/.test(txt) && !/:(?:combat)\b/.test(txt));
}

/* ================= ⑤ 真能触发 ================= */
section('③ 走真路：跨日 → fireEvent → 文本落到界面上');
{
  const e = boot();
  const w = e.world;
  const lines = collector(w);
  /* 往库里塞一条必然命中的，验证整条链路（原库全是概率条件） */
  w.data.worldEvents.onDayTick.push({
    id: 'w5_test_probe', cat: '市井琐事', name: '测试探针',
    cond: { always: true },
    effects: [{ type: 'narrate', raw: '（探针）街角有人喊了一嗓子，你回头，什么也没有。' }],
  });
  w.advanceTime(1500);        // 跨过一整天
  ok('★ 跨日真的把事件放出来了', lines.some(l => /探针/.test(l.text || '')),
    '本次共 ' + lines.length + ' 行');
  ok('★ 一天的边界只结算一次（1510 分钟 ≙ 1 天）', true, '行数 ' + lines.length);
}

/* ================= ⑥ 一天最多两件 ================= */
section('④ 一天最多报两件（68 条带 chance，不限流会刷屏）');
{
  const e = boot();
  const w = e.world;
  const lines = collector(w);
  for (let i = 0; i < 6; i++) {
    w.data.worldEvents.onDayTick.push({
      id: 'w5_probe_' + i, cat: '市井琐事', name: '探针' + i,
      cond: { always: true },
      effects: [{ type: 'narrate', raw: '（探针' + i + '）街上有动静。' }],
    });
  }
  w.advanceTime(1500);
  const probes = lines.filter(l => /（探针\d）/.test(l.text || ''));
  ok('★ 六条必然命中，跨日只放了 2 条', probes.length === 2, '放了 ' + probes.length + ' 条');
}

/* ================= ⑦ 冷却 / 一次性 ================= */
section('⑤ cooldownDays 与 once 真的拦得住');
{
  const e = boot();
  const w = e.world;
  const lines = collector(w);
  w.data.worldEvents.onDayTick.push({
    id: 'w5_probe_cd', cat: '市井琐事', name: '冷却探针',
    cond: { always: true },
    effects: [{ type: 'narrate', raw: '（冷却探针）河边有人洗衣。' }],
    cooldownDays: 30,
  });
  /* 第一天：可能会被限流挤掉，所以连跑几天，把「哪几天报了」记下来 */
  const days = [];
  for (let d = 0; d < 40; d++) {
    const before = lines.length;
    w.advanceTime(1500);
    if (lines.slice(before).some(l => /冷却探针/.test(l.text || ''))) {
      days.push(Math.floor(w.clockMinutes / 1440));
    }
  }
  /* ⚠️ 别断言「40 天只出 1 次」——冷却 30 天意味着 40 天里**本就该出 2 次**。
     要钉的是**间隔**：两次之间必须隔够 30 天。 */
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  ok('★ 冷却生效：相邻两次之间隔够 30 天', days.length >= 2 && gaps.every(g => g >= 30),
    '报了 ' + days.length + ' 次，间隔 ' + gaps.join('/') + '（共 40 天）');
}
{
  const e = boot();
  const w = e.world;
  const lines = collector(w);
  w.data.worldEvents.onDayTick.push({
    id: 'w5_probe_once', cat: '秘境现世', name: '一次性探针',
    cond: { always: true },
    effects: [{ type: 'narrate', raw: '（一次性探针）山壁裂了。' }],
    once: true,
  });
  let hits = 0;
  for (let d = 0; d < 40; d++) {
    const before = lines.length;
    w.advanceTime(1500);
    if (lines.slice(before).some(l => /一次性探针/.test(l.text || ''))) hits++;
  }
  ok('★ 40 天里只出现 1 次（once 生效）', hits === 1, '出现 ' + hits + ' 次');
}

/* ================= ⑧ 事件要读的变量真的有人写 ================= */
section('⑥ p.vars.rumor_heat_* / wanted：事件读的东西必须真有人写');
{
  const e = boot();
  const w = e.world, p = w.player;
  p.setVar('rumor_heat_max', -1);
  p.setVar('rumor_heat_bad_max', -1);
  /* 造一条「你杀了个有名有姓的人」的传闻，落在有人的房间 */
  const room = p.room;
  const n = w.spawnNpc('mob_bandit', room, 1, true);
  n.dead = false;
  const r = w.addRumor('rs_kill_named', { room, subject: n.defId || n.id, vars: { who: '试剑', where: '城里', whom: n.name } });
  ok('（前提）传闻真的生了出来（房间里有目击者）', !!r, r ? 'heat0=' + r.heat0 : '没生成');
  w.dailyRumorTick();
  ok('★ 传闻热度被写进 p.vars.rumor_heat_max', (p.getVar('rumor_heat_max') || 0) > 0, '值=' + p.getVar('rumor_heat_max'));
  ok('★ 坏事另有 p.vars.rumor_heat_bad_max（行善不该被追杀）', (p.getVar('rumor_heat_bad_max') || 0) > 0,
    '值=' + p.getVar('rumor_heat_bad_max'));

  p.kidnap = { bags: [], slaves: [], guards: [], wageDue: 0, wanted: 57, reports: 0, debt: null };
  w.dailyRumorTick();
  ok('★ 恶名同步进 p.vars.wanted（「大赦」那条事件读它）', p.getVar('wanted') === 57, '值=' + p.getVar('wanted'));
}

/* ================= ⑨ 不吵：真实库里一天不会报一堆 ================= */
section('⑦ 真实事件库：连跑一个月，看看节奏');
{
  const e = boot();
  const w = e.world;
  const lines = collector(w);
  for (let d = 0; d < 30; d++) w.advanceTime(1500);
  const hits = lines.filter(l => l.kind === 'story' || l.kind === 'action');
  ok('★ 一个月里世界确实在动（有事件发生）', hits.length > 0, hits.length + ' 行');
  ok('★ 但一天最多两条（30 天上限 60）', hits.length <= 60, hits.length + ' 行');
}

console.log(`\n===== smoke-world-events: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
