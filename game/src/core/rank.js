/**
 * rank.js — 江湖榜（2026-10-11 自拟）
 *
 * 为什么做这个：这游戏内容已经不少，但**玩家的成长没有外部反馈** ——
 * 练到八百级也没人知道，打赢了谁也没人提。武侠里最上头的东西之一就是**榜**：
 * 百晓生的兵器谱、江湖上的恶人榜。有了榜，实力才有「位置」。
 *
 * 三件事：
 *   ① **兵器谱**：按真实实力排天下前若干（NPC 与玩家一起排）
 *   ② **恶人榜**：按恶名排（掳人、杀人、劫掠都会涨）
 *   ③ **换榜**：你把谁打下去，榜就动；而且**这事会被传开**
 *
 * ⚠️ 榜单**动态算**，不是写死的表：每次看都按当下实力重排。
 *    写死的榜三天就不对了（玩家会练级、NPC 会被打倒）。
 * ⚠️ 榜上的位置要「够不着才有意思」：前几名留给那几个绝顶的人，
 *    玩家得真练上去才挤得进去。
 */
'use strict';

const TOP_N = 20;
const EVIL_N = 10;

function hashN(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const pickBy = (arr, seed) => (arr && arr.length ? arr[hashN(seed) % arr.length] : '');

function powerOf(world, ch) {
  try { return require('./sectlife').powerOf(world, ch); }
  catch (e) { return (ch.atk || 0) * 2 + (ch.maxHp || 0) * 0.12 + (ch.maxMp || 0) * 0.2; }
}

/** 谁能上榜：有武力的活人（含玩家），杂鱼不配上谱 */
function candidates(world, withPlayer) {
  const out = [];
  for (const n of Object.values(world.data.npcs)) {
    if (!n || !n.name) continue;
    if (n.tier === 'mob') continue;                      // 山贼野兽不上兵器谱
    if (isOutlawish(n)) continue;                        // 匪类另算（恶人榜上见）
    const pw = powerOf(world, n);
    if (pw < 200) continue;                              // 太弱的没资格
    out.push({ id: n.id, name: n.name, title: n.title || '', sect: n.sect || null, power: pw, isPlayer: false, tier: n.tier || '' });
  }
  if (withPlayer && world.player) {
    const p = world.player;
    out.push({ id: '__player', name: p.name, title: '', sect: p.sect || null, power: powerOf(world, p), isPlayer: true, tier: '' });
  }
  out.sort((a, b) => b.power - a.power);
  return out;
}

function isOutlawish(n) {
  const t = ((n.tag || '') + ' ' + (n.name || ''));
  return /bandit|thief|robber|匪|贼|盗|寇/.test(t);
}

/** 百晓生式的评语（按名次档位与门派气质挑，不是随口一句） */
const REVIEW_TOP = [
  '此人出手极少，见过的人多半不在了。',
  '江湖上说他那一手，二十年来没人接得下第二招。',
  '他已许久不与人动手，可名字还压着半座江湖。',
];
const REVIEW_HIGH = [
  '他那一门功夫练到这个份上，门里已经没人能教他。',
  '他不大合群，可谁也不敢在他面前说重话。',
  '与他交过手的人，回去都要复盘许多年。',
];
const REVIEW_MID = [
  '这是个人物。放在寻常地方，已经是坐头把交椅的。',
  '他的名声不小，只是前头那几位实在太硬。',
  '他身上这门功夫是真下了苦功的。',
];
const REVIEW_LOW = [
  '他名头不算响，手底下却有真东西。',
  '他上谱是这两年的事，还在往上走。',
  '有人见过他动手，说比传说里厉害。',
];

function review(power, idx) {
  if (idx < 3) return pickBy(REVIEW_TOP, 'r' + idx);
  if (idx < 8) return pickBy(REVIEW_HIGH, 'r' + idx);
  if (idx < 15) return pickBy(REVIEW_MID, 'r' + idx);
  return pickBy(REVIEW_LOW, 'r' + idx);
}

/** 兵器谱 */
function weaponBoard(world) {
  const list = candidates(world, true).slice(0, TOP_N);
  return list.map((e, i) => {
    const sect = e.sect ? world.getSect(e.sect) : null;
    return {
      rank: i + 1, name: e.name, title: e.title, sect: sect ? sect.name : '',
      power: Math.round(e.power), isPlayer: e.isPlayer, id: e.id,
      review: review(e.power, i),
    };
  });
}

/** 恶人榜：按恶名 */
function evilBoard(world) {
  const out = [];
  const p = world.player;
  if (p) {
    const wanted = (p.kidnap && p.kidnap.wanted) || 0;
    if (wanted > 0) out.push({ name: p.name, wanted, isPlayer: true, id: '__player' });
  }
  for (const n of Object.values(world.instances.npcs || {})) {
    if (!n || !n.isNpc) continue;
    const w0 = n.wanted || (n.vars && n.vars.wanted) || 0;
    if (w0 > 0) out.push({ name: n.name, wanted: w0, isPlayer: false, id: n.defId || n.id });
  }
  /* NPC 的恶名不多，就用 tier + 是否匪类近似排在下面 */
  for (const n of Object.values(world.data.npcs)) {
    if (!n || !n.name || !isOutlawish(n)) continue;
    if (out.some(x => x.name === n.name)) continue;
    out.push({ name: n.name, wanted: 5 + (hashN(n.id) % 30), isPlayer: false, id: n.id, wild: true });
  }
  out.sort((a, b) => b.wanted - a.wanted);
  return out.slice(0, EVIL_N).map((e, i) => Object.assign(e, { rank: i + 1 }));
}

/** 玩家在兵器谱上的位置（没上榜返回 null） */
function myWeaponRank(world) {
  const b = weaponBoard(world);
  const hit = b.find(x => x.isPlayer);
  return hit ? hit.rank : null;
}

/** 最近一次换榜（谁把谁挤下去了） */
function noteSwap(world, loser, winner) {
  world._rankSwap = { loser: loser && loser.name, winner: winner && winner.name, at: world.clockMinutes || 0 };
  try {
    if (typeof world.addRumor === 'function') {
      world.addRumor('rs_rank_swap', { about: winner && winner.id, vars: { who: winner && winner.name, loser: loser && loser.name } });
    }
  } catch (e) { /* 传闻失败不影响换榜 */ }
}

/* ---------------- 榜上的人来找你 ---------------- */

const CHALLENGE_ASKS = [
  '（抱拳）「久闻大名。今日既然撞上了，讨教几招？」',
  '「听说你近来风头很盛。」他把袖子挽起来，「我手痒。」',
  '「不必多想。」他站定，「我们这一行，见面就是这一件事。」',
];

/**
 * 榜上相邻的人在路上碰见了 —— 可能当场提出挑战。
 * 只有名次挨得近、且他性子够好斗才会开口。
 */
function maybeChallenge(world, player, room, npcs) {
  const p = player;
  if (!p || world.battle) return null;
  const my = myWeaponRank(world);
  if (!my) return null;                       // 没上榜的人，人家犯不着来找
  const brave = { baozhao: 0.9, haoshuang: 0.7, yinzhi: 0.5, yinzhi: 0.5, xiayi: 0.45, lengmo: 0.4, youhua: 0.25, mune: 0.2, wenwan: 0.1, qienuo: 0.05 };
  for (const n of (npcs || [])) {
    /* ⚠️ 别用 `n.isNpc` 当判据 —— 那是**实例**上的字段，模板身上没有。
       传入的可能是模板（`data.npcs` 里那些），用名字与 `isPlayer` 判更稳。 */
    if (!n || !n.name || n.isPlayer || n.dead || n.knockedOut) continue;
    if (n._rankAskAt && ((world.clockMinutes || 0) - n._rankAskAt) < 1440) continue;   // 一天最多问一次
    const his = powerOf(world, n);
    if (his < 200) continue;
    const per = require('./personality').personaIdOf(n);
    const rate = brave[per] === undefined ? 0.3 : brave[per];
    if (world.rng.next() > rate) continue;
    const board = weaponBoard(world);
    const hisRank = board.find(x => x.name === n.name);
    if (!hisRank) continue;
    if (Math.abs(hisRank.rank - my) > 4) continue;    // 差太远没意思
    n._rankAskAt = world.clockMinutes || 0;
    return {
      kind: 'say',
      text: `${n.name}${pickBy(CHALLENGE_ASKS, (n.defId || n.id) + (world.clockMinutes || 0))}`,
      choices: [
        { label: '接下（打一场）', cmd: '比武 ' + n.name },
        { label: '推辞', cmd: '推辞 ' + n.name },
      ],
    };
  }
  return null;
}

/* ---------------- 榜文的渲染 ---------------- */

function boardText(world, which) {
  const lines = [];
  if (which === 'evil') {
    const b = evilBoard(world);
    lines.push({ kind: 'title', text: '【 江湖恶人榜 】' });
    if (!b.length) lines.push({ kind: 'plain', text: '这些年头，榜上还是空的。' });
    for (const e of b) lines.push({ kind: 'plain', text: `第 ${e.rank}　${e.isPlayer ? e.name + '（你）' : e.name}　恶名 ${e.wanted}` });
    return lines;
  }
  const b = weaponBoard(world);
  lines.push({ kind: 'title', text: '【 兵器谱 · 江湖前二十 】' });
  lines.push({ kind: 'plain', text: '谱是城里说书的老先生排的，每月添一笔。未必准，可江湖上认。' });
  for (const e of b) {
    const tag = e.isPlayer ? '（你）' : '';
    lines.push({ kind: 'plain', text: `第 ${e.rank}　${e.name}${tag}${e.sect ? '　' + e.sect : ''}　—— ${e.review}` });
  }
  const my = myWeaponRank(world);
  lines.push({ kind: 'hint', text: my ? `你如今在谱上第 ${my} 位。` : '你还没上谱。（谱上取的是两百斤以上的人物。）' });
  return lines;
}

module.exports = { weaponBoard, evilBoard, myWeaponRank, boardText, maybeChallenge, noteSwap, candidates, powerOf, TOP_N };
