/**
 * revenge.js — 江湖的回应（2026-10-11 自拟）
 *
 * 上一轮做的 NPC 记忆是「**他**记着你」。这一块是「**江湖**记着你」：
 * 你打倒了谁，那件事会传出去，也会有人来找你。
 *
 * 三件事：
 *   ① **传出去**：你打倒了有名有姓的人 → 当场变成传闻（`addRumor`）往外飘
 *   ② **有人来寻仇**：被打倒的人的同门 / 同族 / 好友会记恨，过些日子找上门
 *   ③ **寻仇的话按关系与性格说** ——「你打伤的是我师弟」，不是「我要报仇」这种空话
 *
 * ⚠️ 分寸：
 *   · 只有**有名有姓的**（A/B 层）才会有人替他出头 —— 打倒一个无名小卒没人管
 *   · 同一个仇家**隔一阵子来一次**，不是天天堵门（`_avengeAt`）
 *   · 来寻仇是**开口**（可以选择接、可以推），不是直接开打 —— 直接开打就成了随机遭遇
 */
'use strict';

const DAY = 1440;

function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY) + 1; }

function hashN(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const pickBy = (arr, seed) => (arr && arr.length ? arr[hashN(seed) % arr.length] : '');

/* ---------------- ① 你做的事传出去 ---------------- */

/** 哪些人身边发生的事值得传（有名有姓的才传） */
function worthRumor(npc) {
  if (!npc) return false;
  const tier = npc.tier || ((npc.def || {}).tier);
  return tier === 'A' || tier === 'B';
}

/**
 * 记一笔「你打倒了谁」，并且把这事传出去。
 * 在 `world.onNpcDown` 里调。
 */
function noteDown(world, p, npc) {
  if (!p || !npc) return;
  const id = npc.defId || npc.id;
  p.slain = p.slain || {};
  p.slain[id] = { name: npc.name, at: world.clockMinutes || 0, count: (p.slain[id] ? p.slain[id].count : 0) + 1 };
  if (!worthRumor(npc)) return;
  try {
    if (typeof world.addRumor === 'function') {
      world.addRumor('rs_beat_someone', {
        room: npc.room, about: id,
        vars: { who: p.name, victim: npc.name },
      });
    }
  } catch (e) { /* 传闻失败不影响战斗结算 */ }
}

/* ---------------- ② 谁会来替他出头 ---------------- */

/** 替他出头的人：同门 / 同族 / 好友（按数据里的关系找） */
function avengersFor(world, npc) {
  const id = npc.defId || npc.id;
  const out = [];
  const mine = npc.sect || (npc.def || {}).sect;
  const myTag = npc.tag || (npc.def || {}).tag;
  for (const n of Object.values(world.data.npcs)) {
    if (!n || !n.name) continue;
    if (n.id === id) continue;
    /* 同门 */
    if (mine && n.sect === mine && (n.tier === 'A' || n.tier === 'B')) { out.push({ npc: n, why: 'sect' }); continue; }
    /* 同族：姓一样 */
    if (n.name && npc.name && n.name[0] === npc.name[0] && n.tier === 'A') { out.push({ npc: n, why: 'kin' }); continue; }
    /* 好友（好感高、职业相近） */
    if (myTag && n.tag === myTag && (n.favor || 0) > 30) { out.push({ npc: n, why: 'friend' }); }
  }
  return out;
}

const SAY = {
  sect: [
    '{a}拦在你前头，先报了家门：「你打伤的是我{sect}的人。」',
    '{a}站定了：「前些日子你动过我们一位同门。这事不能就这么过去。」',
  ],
  kin: [
    '{a}看着你，半晌才开口：「你打的，是我本家。」',
    '{a}道：「我姓{c}。你该知道我为什么来。」',
  ],
  friend: [
    '{a}：「你打的那个人，跟我喝了二十年酒。」',
    '{a}没多话，只把手按在刀上：「他托我办的事，我得办。」',
  ],
};

/**
 * 仇家找上门（在 `doMove` 里调）。
 * 条件：玩家打倒过有名有姓的人，且那人的同门/同族/好友**正好在你眼前**。
 * @returns {{kind,text,choices}|null}
 */
function maybeAvenge(world, p, room, npcs) {
  if (!p || !p.slain || world.battle) return null;
  const now = world.clockMinutes || 0;
  const ids = Object.keys(p.slain);
  if (!ids.length) return null;

  for (const n of (npcs || [])) {
    if (!n || !n.name || n.isPlayer || n.dead || n.knockedOut) continue;
    if (n._avengeAt && (now - n._avengeAt) < DAY * 2) continue;
    /* 他是不是来替他出头的 */
    for (const sid of ids) {
      const victim = world.data.npcs[sid];
      if (!victim) continue;
      /* 动手的人隔得太久就不提了（记性没那么好） */
      const days = Math.floor((now - (p.slain[sid].at || 0)) / DAY);
      if (days > 20) continue;
      const rel = avengersFor(world, victim).find(x => x.npc.id === (n.defId || n.id));
      if (!rel) continue;
      if (world.rng.next() > 0.5) continue;              // 未必当场就开口
      n._avengeAt = now;
      const sid2 = world.getSect(n.sect || (n.def || {}).sect);
      const text = pickBy(SAY[rel.why] || SAY.sect, (n.defId || n.id) + sid + now)
        .replace(/\{a\}/g, n.name)
        .replace(/\{sect\}/g, sid2 ? sid2.name : '同门')
        .replace(/\{c\}/g, String(n.name || '')[0] || '');
      return {
        kind: 'say', text,
        choices: [
          { label: '接这一场', cmd: '了断 ' + n.name },
          { label: '说清楚（赔个不是）', cmd: '赔罪 ' + n.name },
          { label: '走开', cmd: '不理 ' + n.name },
        ],
      };
    }
  }
  return null;
}

/** 玩家选了「赔罪」之后的结果（按他的性格判收不收） */
function apologize(world, p, npc) {
  const P = require('./personality');
  const per = P.personaIdOf(npc);
  const soft = { xiayi: 0.7, wenwan: 0.75, mune: 0.6, haoshuang: 0.65, qienuo: 0.8, youhua: 0.5, yinzhi: 0.25, lengmo: 0.2, baozhao: 0.05 };
  const rate = soft[per] === undefined ? 0.5 : soft[per];
  const cost = Math.min(p.money || 0, 100 + Math.floor(world.rng.next() * 200));
  if (world.rng.next() < rate) {
    p.money = Math.max(0, (p.money || 0) - cost);
    npc._avengeAt = null;                                  // 这一笔揭过了
    if (p.slain) for (const k of Object.keys(p.slain)) { /* 留着账，但不再提 */ }
    return {
      lines: [
        { kind: 'story', text: `你把话说了。${npc.name}听完，看了你很久。` },
        { kind: 'say', text: `${npc.name}：「……罢了。人没事就好。」` },
        ...(cost ? [{ kind: 'sys', text: `（你赔了 ${cost} 文汤药钱。）` }] : []),
      ],
    };
  }
  return {
    lines: [
      { kind: 'say', text: `${npc.name}冷笑：「赔？拿什么赔。」` },
      { kind: 'plain', text: `他把袖子一甩，走了。看那样子，这事没完。` },
    ],
  };
}

module.exports = { noteDown, maybeAvenge, apologize, avengersFor, worthRumor, SAY };
