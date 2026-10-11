/* ============================================================
 * patrol.js —— 官府巡街与盘查（design/67 §3）
 *
 * 主人 2026-10-11：「几乎所有城市都没有官府巡逻的人」。
 * 实测当时全库 `constable` + `official` 不到 20 人，且全窝在衙门府 / 皇城，
 * 大城街上一个巡街的都没有。
 *
 * 这个模块干两件事：
 *   ① **巡街的人**（数据层）：`gen-city-npcs.js` 给每座大城配了捕快；
 *      `ambience.js` 让带 schedule 的人在自己岗位上溜达，昼夜换一处。
 *   ② **盘查**（这里）：玩家**自己走一格**时，若有官差在场、且身上背着恶名，
 *      就会被拦下问话。三个出口 —— 报上名号 / 给钱打点 / 拒捕动手。
 *
 * 两条纪律：
 *   · 判据用**显式 tag**（`constable` / `official`），不猜名字、不猜 title。
 *   · 恶名读 `p.kidnap.wanted`（**不是** `p.wanted`）—— 铁律 35：写错字段
 *     面板会显示「恶名 0」，判定则永远 false，静默失效。
 * ============================================================ */
'use strict';

/* 巡街的人：捕快与吏员。武人 / 镖师不在其列（他们管不了这事）。 */
const WATCH_TAGS = { constable: 1, official: 1 };

/* 两次盘查之间的冷却（分钟）。一炷香左右——太密就成了「走一步查一次」。 */
const COOLDOWN = 120;

function wantedOf(p) { return Math.round((p && p.kidnap && p.kidnap.wanted) || 0); }

function tierOf(wanted) {
  try {
    const t = require('./kidnap').wantedTier(wanted);
    return (t && (t.name || t.short)) || '小案';
  } catch (e) { return '小案'; }
}

/* 开场白：按恶名档挑口吻（低档是「例行查验」，高档是「等的就是你」） */
const LINES = {
  low: [
    (n) => `${n}把你拦下，上下打量一眼：「站住。脸生。哪儿来的？」`,
    (n) => `${n}从街那头踱过来，眼皮一抬：「留步，验一验。」`,
  ],
  mid: [
    (n) => `${n}盯着你看了两息，忽然把手一抬：「等等 —— 你，转过来。」`,
    (n) => `${n}与人交换了个眼色，把你堵在街心：「名号。快说。」`,
  ],
  high: [
    (n) => `${n}的手已经按在铁尺上：「总算等着了。你身上的案子，够砍三回。」`,
    (n) => `${n}一声唿哨，街两头的差役都朝这边靠过来：「别动。」`,
  ],
};

/** 玩家自己走一格之后：有官差在场 + 身上有恶名 → 拦下盘查。
 *  ⚠️ 只该挂在与 `outlaw.onPlayerEnter` 同一层（玩家自己走一格），
 *     不要放进 lookRoom —— 读视图也会调它，那就是「站着不动也被查」。 */
function maybeCheck(world, player, room, npcs) {
  const p = player;
  if (!p || world.battle) return null;
  const wanted = wantedOf(p);
  if (wanted <= 0) return null;
  const now = world.clockMinutes || 0;
  if (p.vars && p.vars.patrolAt && now - p.vars.patrolAt < COOLDOWN) return null;

  /* 恶名越响，越容易被认出来；刚出道的小案有几率混过去 */
  const spot = Math.min(0.95, 0.30 + wanted / 100);
  if ((world.rng.next ? world.rng.next() : Math.random()) > spot) return null;

  for (const n of (npcs || [])) {
    if (!n || !n.name || n.isPlayer || n.dead || n.knockedOut) continue;
    const tag = (n.def && n.def.tag) || n.tag;
    if (!WATCH_TAGS[tag]) continue;
    p.vars = p.vars || {};
    p.vars.patrolAt = now;
    p.vars.patrolBy = n.defId || n.id;
    const pool = wanted >= 50 ? LINES.high : (wanted >= 20 ? LINES.mid : LINES.low);
    const pick = pool[Math.floor((world.rng.next ? world.rng.next() : Math.random()) * pool.length)];
    const cost = wanted * 20;
    return {
      kind: 'warn',
      text: pick(n.name),
      choices: [
        { label: '报上名号', cmd: '报名' },
        { label: `给钱打点（约 ${cost} 文）`, cmd: '打点' },
        { label: '拒捕（动手）', cmd: '打 ' + n.name },
      ],
    };
  }
  return null;
}

/** 还在盘查中吗（取了名字就清账，防止站着反复「报名」） */
function currentWatch(world, p) {
  const by = p && p.vars && p.vars.patrolBy;
  if (!by) return null;
  const def = world.data.npcs[by];
  if (!def) return { id: by, name: '那官差' };
  return { id: by, name: def.name };
}

function clear(p) {
  if (p && p.vars) delete p.vars.patrolBy;
}

/* ---------- ① 报上名号 ---------- */
function report(world, p) {
  const who = currentWatch(world, p);
  if (!who) return [{ kind: 'plain', text: '没人拦着你。' }];
  const name = who.name;
  const wanted = wantedOf(p);
  const out = [];
  /* 恶名不显 → 名册上翻不着，训两句放行（并略降恶名：挨一通训也算消了点） */
  if (wanted < 20) {
    const after = Math.max(0, wanted - 5);
    if (p.kidnap) p.kidnap.wanted = after;
    out.push({ kind: 'plain', text: `你报了名号。${name}翻了翻手里的名册，翻了两遍，没翻着，抬抬手让你过去。` });
    if (after !== wanted) out.push({ kind: 'good', text: `（恶名 ${wanted} → ${after}。）` });
  } else if (wanted < 50) {
    const after = Math.min(100, wanted + 3);
    if (p.kidnap) p.kidnap.wanted = after;
    out.push({ kind: 'warn', text: `你报上名号。${name}的眼神一变：「你？……跟我回衙门走一趟。」` });
    out.push({ kind: 'plain', text: `（${tierOf(wanted)}的案子，一个名字就够了。他把你的名号记下了 —— 恶名 ${wanted} → ${after}。）` });
  } else {
    out.push({ kind: 'bad', text: `你报了名号。${name}反而笑了：「省得我找。」街两头的差役朝你围了过来。` });
    out.push({ kind: 'plain', text: '（要脱身，只有「拒捕」一条路；也可以转身就走，只是往后更难。）' });
  }
  clear(p);
  return out;
}

/* ---------- ② 给钱打点 ---------- */
function bribe(world, p) {
  const who = currentWatch(world, p);
  if (!who) return [{ kind: 'plain', text: '没人拦着你。' }];
  const name = who.name;
  const wanted = wantedOf(p);
  const cost = wanted * 20;
  const have = p.money || 0;
  if (have < cost) {
    clear(p);
    return [
      { kind: 'warn', text: `你摸遍全身，凑不出这个数。${name}的手已经按在铁尺上：「没钱？那就走一趟。」` },
      { kind: 'plain', text: `（要打点他，得备 ${cost} 文；你身上只有 ${have} 文。）` },
    ];
  }
  p.money = have - cost;
  const after = Math.max(0, Math.round(wanted / 2));
  if (p.kidnap) p.kidnap.wanted = after;
  clear(p);
  return [
    { kind: 'plain', text: `你把银子往他袖里一塞。${name}掂了掂，侧身让开半步，眼睛看向别处。` },
    { kind: 'good', text: `（银钱 −${cost}，恶名 ${wanted} → ${after}。这一笔，两边都不会提。）` },
  ];
}

module.exports = { maybeCheck, report, bribe, wantedOf, COOLDOWN };
