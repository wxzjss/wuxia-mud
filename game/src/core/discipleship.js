/**
 * discipleship.js — 师门的规矩（主人 2026-10-11 点单）
 *
 * 原话拆成四条：
 *   ① 门派内拜师：低职位弟子达成条件后能**直接转拜**高职位；
 *      转拜之后，原来那个同门不再是玩家的师父。
 *   ② 玩家**同时只能拜师一人**。再拜别人时：
 *      · 判定本来能拜成 → 回「你已有师门」
 *      · 判定本来就失败 → 照旧走原来那句失败的话（不能拿「已有师门」盖掉）
 *   ③ 师父面板加「出师」：条件达成可出师，出师会**涨好感**；
 *      **门派师父没有这个选项**（门内要换人，是直接向更高职位的人拜师）。
 *   ④ 加「退出师门」：掉大量好感，并且**废掉该门派的传承武学** ——
 *      只废门派专属的那几门，别的武学一根汗毛都不动。
 *
 * ⚠️ 为什么单开一个模块而不是塞进 commands.js：
 *   这四条互相咬合（②的要害是**判定的先后顺序**，④的要害是**废哪些不废哪些**），
 *   散在拜师指令、面板、退出指令三处写，改一处忘一处。
 */
'use strict';

const { SLOT_ROOT } = require('./character');

/* 出师的门槛：徒弟得先跟师父处出交情来（好感 60），才谈得上「翅膀硬了」 */
const GRADUATE_FAVOR = 60;
/* 退出师门的代价：好感一次扣到底 */
const QUIT_FAVOR_PENALTY = 60;

/**
 * 这一家的「门派专属传承武学」是哪些。
 * 口径与 `character.skillSource()` **逐字一致**（入门即授 / 门派武学 / 各级位次传的），
 * 这样「从哪儿学来的」和「叛门要废哪些」永远是同一份名单 —— 不会出现
 * 「面板说这是华山派的功夫，废的时候却不是它」。
 */
function sectSkillIds(world, sectId) {
  const sd = world.getSect ? world.getSect(sectId) : null;
  if (!sd) return [];
  const all = [].concat(
    sd.entrySkills || [],
    sd.skills || [],
    sd.rankSkills ? Object.values(sd.rankSkills).flat() : [],
  ).filter(Boolean);
  /* 🔴 **基本功一律不算「门派专属传承」**。
     门派入门确实会授基本功（entrySkills 里有），可基本功是天底下人人在学的 ——
     城里的武馆 100 文一门随便教，江湖上满地都是。
     把它们算进去的后果是：你在武馆花钱学了基本拳脚，入门派后叛门，
     连那门基本功也给你收了 —— 主人原话是「只有门派专属传承武学会被废，其他武学不会」。
     所以只废**这一家独有**的那些（华山剑法、紫霞神功…），根功夫一概留着。 */
  const roots = new Set();
  for (const slot of Object.keys(SLOT_ROOT)) for (const id of SLOT_ROOT[slot]) roots.add(id);
  return all.filter(id => !roots.has(id));
}

/** 玩家当前唯一的那位师父（个人师父 / 门派师父都算） */
function currentMaster(p) {
  const ms = (p && p.masters) || {};
  const ids = Object.keys(ms);
  if (!ids.length) return null;
  /* 只该有一个；万一历史数据里留了多个，取最近认的那个（挑不出就取第一个） */
  let best = ids[0];
  for (const id of ids) {
    if ((ms[id].at || 0) > (ms[best].at || 0)) best = id;
  }
  return { id: best, rec: ms[best] };
}

/** 这个人是不是玩家的师父 */
function isMasterOf(p, npc) {
  if (!p || !npc || !p.masters) return false;
  const mid = npc.defId || npc.id;
  return !!(mid && p.masters[mid]);
}

/** 这位师父是不是「门派里的师父」（门派师父没有出师这条路） */
function isSectMaster(p, npc) {
  const mid = npc && (npc.defId || npc.id);
  const rec = mid && p && p.masters && p.masters[mid];
  return !!(rec && rec.sect);
}

/** 记下一位师父 */
function setMaster(p, npc, extra) {
  const mid = (npc.defId || npc.id);
  if (!mid) return null;
  p.masters = p.masters || {};
  p.masters[mid] = Object.assign({
    id: mid, name: npc.name, at: (p.world && p.world.clockMinutes) || 0, sect: null,
  }, extra || {});
  return mid;
}

/** 忘掉一位师父 */
function dropMaster(p, mid) {
  if (p.masters) delete p.masters[mid];
}

/**
 * 门派内「转拜更高职位」时，把同一个门派里的旧师父作废。
 * @returns {Array<{kind,text}>} 要念给玩家听的话（0~1 行）
 *
 * ⚠️ 只动 `rec.sect === 本门派` 的那些 —— 江湖上认的个人师父（rec.sect 为空）
 *    不该因为你在门派里升了一级就凭空消失。
 */
function dropSectMasters(world, p, keepMid) {
  const out = [];
  const ms = p.masters || {};
  for (const id of Object.keys(ms)) {
    if (id === keepMid) continue;
    if (!ms[id].sect) continue;
    out.push({ kind: 'plain', text: `（${ms[id].name}那里，往后你不必再执弟子礼了。）` });
    delete ms[id];
  }
  return out;
}

/* ---------------- 出师 ---------------- */

/**
 * 能不能出师。不能就给一句 why（面板上照样显示按钮，灰掉并说明差什么 ——
 * 让玩家知道这条路存在，而不是按钮凭空不见）。
 */
function canGraduate(world, p, npc) {
  if (!isMasterOf(p, npc)) return { ok: false, why: '他不是你的师父。' };
  if (isSectMaster(p, npc)) {
    return { ok: false, why: '门派里的师承没有「出师」这一步 —— 门内想换人，直接去向更高职位的人拜师。' };
  }
  const favor = Math.round(npc.favor || 0);
  if (favor < GRADUATE_FAVOR) {
    return { ok: false, why: `师徒一场，总得处出交情来（好感需 ${GRADUATE_FAVOR}，现在是 ${favor}）。` };
  }
  return { ok: true, need: GRADUATE_FAVOR };
}

/**
 * 出师：解除师徒名分，但**好聚好散** —— 好感是涨的，不是掉的。
 * 这一条与「退出师门」正好相反，别把两者写成同一个东西。
 */
function graduate(world, p, npc) {
  const c = canGraduate(world, p, npc);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.why }] };
  const mid = npc.defId || npc.id;
  dropMaster(p, mid);
  const favor = require('./social').addFavor(world, npc, 20 * world.favorGainMult(p), '出师');
  const lines = [
    {
      kind: 'story',
      text: `你替${npc.name}把院里的事收了尾，把用过的东西归回原处。${npc.name}看了半晌，`
        + `说：「该教的都教了。往后别拿我的名号挡事，也别让人家戳你的脊梁骨。」`,
    },
    { kind: 'sys', text: `你出师了。往后与${npc.name}是故交，不再是师徒。` },
  ];
  lines.push(...(favor.lines || []));
  lines.push({ kind: 'hint', text: '（师承的名分没了，功夫还在你身上。）' });
  return { ok: true, lines };
}

/* ---------------- 退出师门 ---------------- */

/**
 * 退出师门：断得难看。
 * 掉大量好感；如果这个师承挂着门派，**该门派的传承武学一并废掉** ——
 * 而且只废这一家的，别处的功夫（基本功、江湖武学、别的门派学的）一律不动。
 */
function quit(world, p, npc) {
  const mid = npc.defId || npc.id;
  const rec = (p.masters || {})[mid];
  if (!rec) return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}不是你的师父。` }] };

  const favorBefore = Math.round(npc.favor || 0);
  const fr = require('./social').addFavor(world, npc, -QUIT_FAVOR_PENALTY, '退出师门');
  dropMaster(p, mid);

  /* 废功：只认这个师承所挂门派的专属传承武学 */
  const wiped = [], kept = [];
  const sids = rec.sect ? sectSkillIds(world, rec.sect) : [];
  let leftSect = false;
  if (sids.length) {
    const set = new Set(sids);
    for (const sid of Object.keys(p.learned || {})) {
      if (!set.has(sid)) continue;
      const sd = world.getSkill(sid);
      delete p.learned[sid];
      /* 10 个装备槽里挂着的也得摘下来（挂着不存在的武学，战斗中会取不到定义） */
      for (const slot of Object.keys(p.equippedSkills || {})) {
        if (p.equippedSkills[slot] === sid) p.equippedSkills[slot] = null;
      }
      wiped.push((sd && sd.name) || sid);
    }
    /* 还在这个门派里 → 一并脱离（学到门里的东西、又不要这个师门，没道理还留着名分） */
    if (p.sect && p.sect === rec.sect) { p.leaveSect(); leftSect = true; }
  }
  /* 没被废的，说一句「这些还是你的」，免得玩家以为功夫全没了 */
  const all = Object.keys(p.learned || {}).map(sid => (world.getSkill(sid) || {}).name).filter(Boolean);
  if (all.length) kept.push(...all.slice(0, 4));
  if (typeof p.recalc === 'function') p.recalc();

  const lines = [
    {
      kind: 'story',
      text: `你把${npc.name}给的东西一件件搁在桌上，一件没拿。${npc.name}看着你收完，`
        + `一句话也没说，把门关上了。`,
    },
    { kind: 'warn', text: `你退出了师门，${npc.name}对你的好感从 ${favorBefore} 跌到 ${Math.round(npc.favor || 0)}。` },
    ...(fr.lines || []),
  ];
  if (wiped.length) {
    lines.push({ kind: 'warn', text: `师门传的功夫被收了回去：${wiped.join('、')}。` });
  }
  if (leftSect) lines.push({ kind: 'sys', text: '你不再是这个门派的弟子。' });
  lines.push({
    kind: 'hint',
    text: kept.length
      ? `（你自己练下的、别处学的功夫都还在：${kept.join('、')}……）`
      : '（你身上本来也没什么功夫。）',
  });
  return { ok: true, lines };
}

module.exports = {
  sectSkillIds, currentMaster, isMasterOf, isSectMaster, setMaster, dropMaster,
  dropSectMasters, canGraduate, graduate, quit,
  GRADUATE_FAVOR, QUIT_FAVOR_PENALTY,
};
