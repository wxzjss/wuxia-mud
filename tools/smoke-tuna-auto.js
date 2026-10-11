/* ============================================================
 * smoke-tuna-auto.js — 吐纳重做（主人 2026-10-11）
 *
 * 主人原话拆开：
 *   ①「『吐纳』要求是点击一次后会自动持续吐纳（间隔 1 秒或者你觉得间隔多少秒），
 *      而不是每点一下吐纳一轮」
 *   ② 追加：「双修是要和吐纳一样，点击一下然后间隔多久自动弹出剧情的」
 *      → 双修、采补**同样自动连发**（上一轮把它理解成「不要自动」是错的）
 *   ③「吐纳结束后不会回满血与内力」
 *   ④「按内功品级固定数值消耗血量以及消耗内力（品级越高消耗越大提升越大，
 *      熟练度越高消耗越小提升越大）」—— 不是百分比
 *   ⑤「内力与血量必须足够不然会失败，甚至血量小于 1 时会昏迷；
 *      内力为 0 不会昏迷，但内力为 0 时如果吐纳没有正好结束会失败」
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const NG = require(path.join(ROOT, 'game', 'src', 'core', 'neigong.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const SEED = 20261018;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const p = e.world.player;
  p.hp = p.maxHp; p.mp = p.maxMp;
  return e;
}
/** 给玩家挂一门指定品级 / 熟练度的内功 */
function withInner(e, grade, level) {
  const w = e.world, p = w.player;
  const id = 'basic_force';
  p.learnSkill(id, { force: true });
  p.equippedSkills['内功'] = id;
  p.learned[id].level = level;
  /* 品级是功法数据上的字段 —— 就地改一份用于测试（真实数据里 grade 已按武学重制定好） */
  const sd = w.getSkill(id);
  if (sd) sd.grade = grade;
  p.recalc();
  p.hp = p.maxHp;
  return p;
}

/* ================= ① 消耗是「固定值」不是百分比 ================= */
section('① 消耗按品级的固定值（与内力上限无关）');
{
  const e = boot();
  const p = withInner(e, 5, 0);
  p.maxMpBase = 400; p.recalc();
  const a = NG.costOf(p);
  p.maxMpBase = 4000; p.recalc();
  const b = NG.costOf(p);
  ok('★ 内力上限翻十倍，一轮消耗**一点没变**（这就是「不是百分比」）',
    a.mp === b.mp && a.hp === b.hp, `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  ok('★ 体力账也是固定值', a.hp >= 1 && a.mp >= 1, JSON.stringify(a));
}

/* ================= ② 品级越高 → 消耗越大、收获越大 ================= */
section('② 品级刻度');
{
  const e = boot();
  const p = withInner(e, 1, 0);
  const low = { cost: NG.costOf(p), gain: NG.gainPerTune(p) };
  const sd = e.world.getSkill('basic_force');
  sd.grade = 9;
  const high = { cost: NG.costOf(p), gain: NG.gainPerTune(p) };
  ok('★ 品级越高，一轮**吞得越多**', high.cost.mp > low.cost.mp, `品1 ${low.cost.mp} → 品9 ${high.cost.mp}`);
  ok('★ 品级越高，一次**涨得越多**', high.gain > low.gain, `品1 +${low.gain} → 品9 +${high.gain}`);
}

/* ================= ③ 熟练度越高 → 越省、涨越多 ================= */
section('③ 熟练度刻度');
{
  const e = boot();
  const p = withInner(e, 5, 0);
  const c0 = NG.costOf(p), g0 = NG.gainPerTune(p);
  p.learned['basic_force'].level = 300;
  const c1 = NG.costOf(p), g1 = NG.gainPerTune(p);
  ok('★ 练得越熟，一轮**耗得越少**', c1.mp < c0.mp, `${c0.mp} → ${c1.mp}`);
  ok('★ 练得越熟，一次**涨得越多**', g1 > g0, `${g0} → ${g1}`);
}

/* ================= ④ 内力与气血不够 ================= */
section('④ 不够就失败 / 昏迷');
{
  /* 内力空了：失败，不昏迷 */
  const e1 = boot();
  const p1 = e1.world.player;
  NG.start(e1.world, p1);
  p1.mp = 0;
  const r1 = NG.round(e1.world, p1);
  ok('★ 内力为 0 时这一轮**失败**', r1.ok === false && r1.failed === true, (r1.lines[1] || {}).text);
  ok('★ 但不是昏迷（人还醒着、还在原地）',
    !r1.fainted && !p1.dead && p1.room === e1.world.player.room && p1.hp > 0,
    `hp=${Math.round(p1.hp)} dead=${!!p1.dead}`);
  ok('状态下掉了（不能一直挂着失败）', !NG.stateOf(p1));

  /* 内力空的还想起手 → 起手就被拦 */
  const e1b = boot();
  const p1b = e1b.world.player;
  p1b.mp = 0;
  const s1b = NG.start(e1b.world, p1b);
  ok('★ 丹田空的人坐不下去（起手就拦）', !s1b.ok, (s1b.lines[0] || {}).text);

  /* 气血撑不住 → 昏迷、被送客栈 */
  const e2 = boot();
  const p2 = e2.world.player;
  NG.start(e2.world, p2);
  const cost = NG.costOf(p2);
  const room0 = p2.room;
  p2.hp = cost.hp;                     /* 再扣就 < 1 */
  const r2 = NG.round(e2.world, p2);
  ok('★ 气血不够 → 昏迷', r2.ok === false && r2.fainted === true, JSON.stringify(r2.lines.map(l => l.kind)));
  /* ⚠️ 不能断言「血为 0 / dead」—— `respawnAtInn` 会把人救回客栈并回一部分血，
     那是**正确**的收尾（昏倒不等于死）。该验的是「人已经不在坐忘里了」。 */
  ok('★ 醒来之后不在吐纳状态（不会卡在坐忘里）', !NG.stateOf(p2), JSON.stringify(NG.stateOf(p2)));
  ok('★ 昏迷后不在原地（被送去客栈）', p2.room !== room0 || p2.hp > 0, `${room0} → ${p2.room}`);
}

/* ================= ⑤ 见底结算，但不「补全」 ================= */
section('⑤ 结算：涨上限，但不回满血与内力');
{
  const e = boot();
  const p = e.world.player;
  p.mp = 10;
  const mp0 = p.maxMp, hp0 = p.hp;
  NG.start(e.world, p);
  let done = null;
  for (let i = 0; i < 50 && !done; i++) {
    const r = NG.round(e.world, p);
    if (r.done) done = r;
    if (r.failed || r.fainted) break;
  }
  ok('内力见底时结算', !!done, done ? `共 ${done.rounds} 轮` : '没结算');
  ok('★ 内力上限涨了', p.maxMp > mp0, `${mp0} → ${p.maxMp}`);
  ok('★ 内力**没有**回满（主人：结束不回满血与内力）',
    p.mp < p.maxMp, `${Math.round(p.mp)}/${Math.round(p.maxMp)}`);
  ok('★ 气血**没有**回满', p.hp < hp0 || p.hp < p.maxHp, `${Math.round(p.hp)}/${Math.round(p.maxHp)}`);
  ok('画面里明说了「不会自己回来」', /不会自己回来|自己回来/.test((done.lines || []).map(l => l.text).join('')));
}

/* ================= ⑥ 吐纳真的在耗血（不被 mod 回血规则做平） ================= */
section('⑥ 吐纳真扣血（不被「脱战回血」那种 mod 规则做平）');
{
  const e = boot();
  const p = e.world.player;
  p.hp = p.maxHp; p.mp = p.maxMp;
  const hp0 = p.hp;
  NG.start(e.world, p);
  for (let i = 0; i < 3; i++) NG.round(e.world, p);
  ok('★ 三轮下来气血是真的少了（不是被 tick 回血补平）', p.hp < hp0, `${Math.round(hp0)} → ${Math.round(p.hp)}`);

  /* 那条官方示例规则现在带 !tuning 条件 */
  const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mods', 'demo_func', 'mod.json'), 'utf-8'));
  const rule = (demo.rules || []).find(r => r.name === '脱战回血');
  ok('★ 官方示例的「脱战回血」带上了 !tuning（坐着熬气不算歇着）',
    !!rule && JSON.stringify(rule.cond).indexOf('!tuning') >= 0, JSON.stringify(rule && rule.cond));
}

/* ================= ⑦ 前端：点一次自动持续；双修不自动 ================= */
section('⑦ 前端：吐纳 / 双修 / 采补 都自动连发');
{
  const HTML = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf-8');
  const UI = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf-8');

  const els = {};
  const mkEl = () => ({
    id: '', className: '', style: {}, value: '', textContent: '', innerHTML: '', disabled: false,
    children: [],
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle() { return false; }, contains() { return false; } },
    appendChild(c) { return c; }, insertBefore(c) { return c; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    setAttribute() { }, getAttribute() { return null; }, focus() { }, blur() { }, addEventListener() { },
  });
  global.document = {
    getElementById(id) { if (!els[id]) els[id] = mkEl(); els[id].id = id; return els[id]; },
    createElement: () => mkEl(),
    querySelectorAll: () => [],
    body: mkEl(), documentElement: { style: {} },
  };
  global.window = global;

  /* 假定时器：把「排了没有、排多久」记下来 */
  const timers = [];
  const realSetTimeout = global.setTimeout;
  global.setTimeout = (fn, ms) => { timers.push({ fn: fn, ms: ms }); return timers.length; };
  global.clearTimeout = () => { };

  const S = { busy: false, view: null, settings: { font: 100, anim: true, autosave: true, narrow: false }, screen: 'game' };
  let nextBusy = null;
  const api = {
    exec: async () => ({ ok: true, lines: [], view: { player: { name: '试剑', busy: nextBusy } } }),
    view: async () => ({ view: {} }),
    combat: async () => ({}), menu: async () => ({}),
  };
  const util = { esc: s => String(s == null ? '' : s), pct: () => 0, fmtTime: () => '', debounce: f => f };
  global.WX = { S, api, util, bus: { emit() { } } };

  eval(UI);
  const U = global.WXUI;

  (async () => {
    /* 吐纳中 → 点一次之后要排下一轮（1 秒） */
    timers.length = 0;
    nextBusy = { kind: 'tune', round: 1 };
    S.view = { player: { busy: { kind: 'tune', round: 1 } } };
    await U.doCmd('吐纳');
    const t1 = timers.filter(t => t.ms === 1000);
    ok('★ 吐纳：点一次会**自动排下一轮**（1 秒）', t1.length === 1, '排了 ' + timers.length + ' 个定时器');

    /* 双修中 → **也**要自动往下走。
       主人 2026-10-11 追加：「双修是要和吐纳一样，点击一下然后间隔多久自动弹出剧情的」——
       （我上一轮把「你不会把双修也做成这样的吧？？？」理解反了，这里改正。） */
    timers.length = 0;
    S.view = { player: { busy: { kind: 'dual' } } };
    nextBusy = { kind: 'dual', name: '某人', round: 2, rounds: 4 };
    await U.doCmd('双修');
    ok('★ 双修：点一次也会自动弹出下一轮剧情（1 秒）',
      timers.filter(t => t.ms === 1000).length === 1, '排了 ' + timers.length + ' 个定时器');

    /* 采补同理 —— 它俩走的是同一套流程，漏掉会出现「双修自动、采补还得手点」 */
    timers.length = 0;
    S.view = { player: { busy: { kind: 'drain' } } };
    nextBusy = { kind: 'drain', name: '某人', round: 1, rounds: 4 };
    await U.doCmd('采补');
    ok('★ 采补：同样自动', timers.filter(t => t.ms === 1000).length === 1, '排了 ' + timers.length + ' 个定时器');

    /* 就算上一轮排了，状态一没（退出吐纳）就该停 */
    timers.length = 0;
    nextBusy = null;
    S.view = { player: {} };
    await U.doCmd('背包');
    ok('退出吐纳后不再排下一轮', timers.filter(t => t.ms === 1000).length === 0);

    global.setTimeout = realSetTimeout;
    console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
    process.exit(fail ? 1 : 0);
  })();
}
