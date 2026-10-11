/**
 * encounter.js — 触发式支线剧情 + 「身上有故事的人」的路遇提示（主人 2026-10-08）
 *
 * 主人要的两件事：
 *   ① **触发式支线**：玩家路过某处，屏幕自己弹出剧情（失足坠崖 / 撞见追杀 /
 *      墙角偷跑的姑娘 / 衙门外来回踱步的人 / 密谋劫狱 / 逃荒的一家人…）
 *   ② **有故事的 NPC 路过要有提醒**：一句神态、一个动作、半句话，
 *      让玩家知道「这个人身上有事」，而不是等他自己去点。
 *
 * 两条分寸：
 *   · **一件事一辈子只撞上一次**（`vars.storySeen`）—— 反复弹同一段，比不弹还假。
 *   · 房间里一次最多出一条提示 —— 二十号人各来一句，玩家只会把字全刷过去。
 */
'use strict';

function book(world) { return (world && world.data && world.data.storybook) || null; }
function allStories(world) { const b = book(world); return (b && b.stories) || []; }

function seenMap(ch) { ch.vars = ch.vars || {}; return ch.vars.storySeen || (ch.vars.storySeen = {}); }
function hintMap(ch) { ch.vars = ch.vars || {}; return ch.vars.storyHinted || (ch.vars.storyHinted = {}); }

/**
 * 路过某地时掷一次骰：有没有故事撞上来。
 * 返回 `{ id, name, lines }` 或 null。命中即记为「见过」，不再重复。
 */
function maybeFire(world, ch, room) {
  if (!ch || !ch.isPlayer || world.battle || !room) return null;
  const list = allStories(world);
  if (!list.length) return null;
  const s = seenMap(ch);
  for (const st of list) {
    if (!st || !st.id || s[st.id]) continue;
    if (!st.where) continue;
    let hit = false;
    try { hit = new RegExp(st.where).test(room.name || ''); } catch (e) { hit = false; }
    if (!hit) continue;
    if (world.rng.next() > (st.chance || 0.1)) continue;
    s[st.id] = world.clockMinutes || 0;
    return { id: st.id, name: st.name || '', lines: (st.lines || []).map(l => ({ ...l })) };
  }
  return null;
}

/**
 * 这个人身上挂没挂支线。
 * ⚠️ 必须**同时看实例和模板**：`spawnNpc` 并没有把 `quests` / `sidequest` clone 进实例
 *    （它只 clone 了 favor/carry/rel/home/tag/portrait/pstate 那一串），
 *    所以在房间里拿到的人身上根本没有这两个字段 —— 只认 `npc.quests` 会恒为 false，
 *    路遇提示一个都不出（不报错的静默失效）。
 */
function hasStory(npc) {
  if (!npc) return false;
  const d = npc.def || {};
  const nonEmpty = q => (Array.isArray(q) ? q.length > 0 : !!(q && Object.keys(q).length));
  return nonEmpty(npc.quests) || nonEmpty(d.quests) || !!(npc.sidequest || d.sidequest);
}

/**
 * 路遇提示：按这个人的**性格**挑一句，把他的「心里有事」露出来。
 * ⚠️ 用性格挑句式，不用画像原文 —— 画像那几句是给「细看此人」看的，
 *    拿来当路遇提示会让两处重复，读第二遍就没味道了。
 */
function hintFor(world, npc) {
  const b = book(world);
  const tpl = b && b.hints && b.hints.byPersona;
  if (!tpl || !npc) return null;
  const per = require('./personality').personaIdOf(npc);
  const raw = tpl[per] || tpl.mune;
  return raw ? String(raw).replace(/\{name\}/g, npc.name) : null;
}

/**
 * 房间里「值得搭话的人」的提示（最多 max 条，同一个人只说一次）。
 * 优先挑好感高、层级高的 —— 那些人身上的事更值得追。
 */
function hintsIn(world, ch, room, max) {
  const cap = max === undefined ? 1 : max;
  if (!ch || !ch.isPlayer || world.battle || !room) return [];
  const done = hintMap(ch);
  const cands = world.npcsIn(ch.room).filter(n => n.isNpc && !n.dead && !n.knockedOut && hasStory(n));
  if (!cands.length) return [];
  const rank = { A: 3, B: 2, C: 1 };
  cands.sort((a, b) => ((rank[b.tier] || 0) - (rank[a.tier] || 0)) || ((b.favor || 0) - (a.favor || 0)));
  const out = [];
  for (const n of cands) {
    if (out.length >= cap) break;
    const key = n.defId || n.id;
    if (!key || done[key]) continue;
    const t = hintFor(world, n);
    if (!t) continue;
    done[key] = world.clockMinutes || 0;
    out.push({ kind: 'hook', text: t, npcName: n.name, npcId: key });
  }
  return out;
}

/** 面板/视图用：这个人是否值得点开 */
function markIn(world, ch, npc) {
  return hasStory(npc) && !hintMap(ch)[npc.defId || npc.id] ? null : null;
}

module.exports = { maybeFire, hasStory, hintFor, hintsIn, allStories, markIn };
