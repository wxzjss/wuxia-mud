/* ============================================================
 * guards.js —— 闯山门拦截（design/71 §四）
 *
 * 主人原话：「守门处有个闯山门的按钮是个摆设玩家直接就能进去」。
 * 实测：43 个山门房各挂一条 `拜师 <门派>` 的 action（前端画成「拜入门下」按钮），
 * 点下去 / 打指令**都没有一丝阻拦** —— 谁都能大摇大摆走进任一家山门。
 *
 * 这个模块补上守卫这一层，干三件事：
 *   ① 玩家**自己走一格**踏进山门房时，守卫拦下问话（三层判据）；
 *   ② 给出口「三个说法」——报上名号 / 递引荐信 / 硬闯；
 *   ③ 硬闯有代价（打赢丢门派声望、打不过被扔出去 + 恶名）。
 *
 * 三条纪律（照 patrol.js，不新造一套）：
 *   · 判据用**显式 tag** `shouwei`（不猜名字、不猜 title）
 *   · 有冷却（同一守卫一炷香内不重复拦同一个人）
 *   · **只挂在「玩家自己走一格」**（doMove 的钩子层）——
 *     放进 lookRoom 会变成「站在门口不动也被反复盘问」。
 *
 * 判据与文案一律**复用 joinSect / sectRefusal**：
 *   不另起一份门槛判定，否则会出现
 *   「守卫放你进门，进门后 joinSect 说你不够格」的自相矛盾（design/71 §四）。
 * ============================================================ */
'use strict';

/* 守卫的显式标签。`shouwei` 写在 42_sect_guards.json（含给旧守卫补的 tag）。 */
const GUARD_TAG = 'shouwei';

/* 两次拦人之间的冷却（分钟）。一炷香 —— 太密就成了「走一步被拦一次」。 */
const COOLDOWN = 90;

function wantedOf(p) { return Math.round((p && p.kidnap && p.kidnap.wanted) || 0); }

/* ---------- 硬闯戒备（2026-10-18 主人门禁两病裁定）----------
   病①：硬闯 +15 恶名、天下人都看在眼里，可再去山门没人拦——
        根因有二：拦人冷却把「问话」连同「拦截」一起免了；打赢后守卫倒地
        guardIn 查无人 → 直接放行。修法：**硬闯无论成败都记档**
        （gateBreach_<sectId> flag，随档持久化），戒备态下守卫见你就动手。 */
function breachFlag(sectId) { return 'gateBreach_' + sectId; }
function isBreach(world, p, sectId) {
  return !!(p && p.hasFlag && p.hasFlag(breachFlag(sectId)));
}

/** 房间是不是某家山门（返回该门派数据，不是就 null）。
 *  ⚠️ 判据用 `sect.entry`（41_sect_entry.json 里的权威入口），
 *     与「飞往」落点同源 —— 两处用同一个来源，才不会守卫守 A 门、你飞到 B 门。 */
function sectAtRoom(world, roomId) {
  if (!world || !roomId) return null;
  for (const sd of Object.values(world.data.sects || {})) {
    if (sd.entry === roomId) return sd;
  }
  return null;
}

/** 玩家房间里当值的守卫（没有就 null） */
function guardIn(world, roomId) {
  let list = [];
  try { list = world.npcsIncludingTemplates(roomId) || []; } catch (e) { list = []; }
  for (const n of list) {
    if (!n || !n.name || n.isPlayer || n.dead || n.knockedOut) continue;
    const tag = (n.def && n.def.tag) || n.tag;
    if (tag === GUARD_TAG) return n;
  }
  return null;
}

/** 玩家算不算「这家的人」：同门、或身上揣着这家给的引荐信 */
function isInsider(world, p, sectId) {
  if (p.sect && p.sect === sectId) return true;
  /* 新手线那封引荐信 —— 与 joinSect 的 `referral` **同源**（p.vars.tutPass） */
  if (p.vars && p.vars.tutPass === sectId) return true;
  return false;
}

/** 门槛过了没有？（复用 sectRefusal，不另起一份判定）
 *  返回 null 表示没问题；否则返回「卡在哪」那句话。 */
function blockedBy(world, p, sd) {
  if (!sd || !sd.require) return null;
  const { evalCond } = require('./modapi');
  /* 与 joinSect 完全一致的性别归一化（数据里 `'male'` 与玩家身上 `'男'` 两种写法） */
  const normGender = g => ({ '男': 'male', '女': 'female', male: 'male', female: 'female' }[g] || g);
  const myG = normGender(p.gender);
  const probe = myG === p.gender ? p : Object.assign(Object.create(p), { gender: myG });
  const req = sd.require.gender
    ? Object.assign({}, sd.require, { gender: normGender(sd.require.gender) })
    : sd.require;
  let ok = true;
  try { ok = !!evalCond(req, { player: probe, world }); } catch (e) { ok = true; }
  if (ok) return null;
  /* 用 joinSect 自己的拒绝文案（说清卡在哪一条 + 该去哪补） */
  try { return p.sectRefusal(sd); } catch (e) { return `${sd.name}不收你这样的弟子。`; }
}

/* 开场白：按拦下的理由挑口吻。都先说清「为什么拦你」。 */
const OPEN = {
  threshold: (n, sd) => `${n}横过身来，把你拦在门外：「${sd.name}的门，不是谁都能进。」`,
  referral: (n, sd) => `${n}上下打量你：「生面孔。进${sd.name}做什么？」`,
  wanted: (n, sd) => `${n}的手按在家伙上，眼神一沉：「你这张脸，我听说过。还敢往${sd.name}门前站？」`,
};

/**
 * 玩家自己走一格之后：踏进某家山门 → 守卫拦下。
 * 返回 { kind, text, choices } 或 null（不拦）。
 * ⚠️ 只该挂在与 patrol.maybeCheck 同一层（doMove 钩子层）。
 */
function maybeBar(world, player, room, npcs) {
  const p = player;
  if (!p || world.battle) return null;
  const roomId = (room && room.id) || p.room;
  const sd = sectAtRoom(world, roomId);
  if (!sd) return null;

  /* 是自己人 / 拿着引荐信 → 放行，不拦 */
  if (isInsider(world, p, sd.id)) return null;

  const guard = guardIn(world, roomId);
  if (!guard) return null;   /* 没人看着（数据缺失）→ 不硬拦，保住可玩性 */

  /* 冷却：同一守卫一炷香内不重复拦同一个人。
     ⚠️ 戒备态（硬闯被记档）不吃冷却——冷却免的是「重复问话」，
        不是「放行」；戒备态守卫见你就动手（见下）。 */
  const now = world.clockMinutes || 0;
  const breach = isBreach(world, p, sd.id);
  if (!breach && p.vars && p.vars.guardAt && p.vars.guardAt.sect === sd.id && now - p.vars.guardAt.at < COOLDOWN) return null;

  /* 🔴 戒备态：守卫 hostile 起手——不问话、不给报名号，拔刀就上。
     （主人口令：恶名入档后该门派守卫对玩家 hostile 起手。）
     startCombat 与 encounter 遇袭同一条通路（ambush），台词由战斗句库出。 */
  if (breach) {
    p.vars = p.vars || {};
    p.vars.guardAt = { sect: sd.id, at: now };
    p.vars.guardBy = guard.defId || guard.id;
    let more = [];
    try {
      const r = world.startCombat(p, guard, { ambush: true, silent: true });
      if (r && Array.isArray(r.lines)) more = r.lines;
    } catch (e) { /* 开打失败退回问话，不挡路 */ }
    return {
      kind: 'warn',
      text: `${guard.name}一眼认出你来，脸色一沉：「上次硬闯${sd.name}的就是你！」话音未落，刀已出鞘。`,
      more,
    };
  }

  /* 三层判据，优先级：门槛 > 恶名 > 引荐
     —— 门槛不达标的人，就算报上也进不去，先说门槛（那是最硬的墙）。 */
  const thr = blockedBy(world, p, sd);
  const wanted = wantedOf(p);
  let reason, text;
  if (thr) {
    reason = 'threshold';
    text = OPEN.threshold(guard.name, sd) + thr;
  } else if (wanted >= 20) {
    reason = 'wanted';
    text = OPEN.wanted(guard.name, sd);
  } else {
    reason = 'referral';
    text = OPEN.referral(guard.name, sd);
  }

  p.vars = p.vars || {};
  p.vars.guardAt = { sect: sd.id, at: now };
  p.vars.guardBy = guard.defId || guard.id;

  const choices = [];
  /* 门槛不达标：报上名号也没用（joinSect 会拒），只留「硬闯」与「退走」 */
  if (reason !== 'threshold') {
    choices.push({ label: '报上名号', cmd: '报名入山 ' + sd.name });
  }
  /* 恶名在身：可以打点（守门人也收钱） */
  if (reason === 'wanted' && wanted > 0) {
    choices.push({ label: `塞钱打点（约 ${wanted * 20} 文）`, cmd: '打点入山 ' + sd.name });
  }
  choices.push({ label: '硬闯进去', cmd: '硬闯 ' + sd.name });
  choices.push({ label: '转身离开', cmd: '退下' });

  return { kind: 'warn', text, choices };
}

/** 当前被哪位守卫拦着（报上名号/打点时认人） */
function currentGuard(world, p) {
  const by = p && p.vars && p.vars.guardBy;
  if (!by) return null;
  const def = world.data.npcs[by];
  return { id: by, name: def ? def.name : '那守卫' };
}
function clearGuard(p) { if (p && p.vars) { delete p.vars.guardBy; } }

/** ---------- ① 报上名号 ---------- */
function stateName(world, p, sectId) {
  const g = currentGuard(world, p);
  if (!g) return [{ kind: 'plain', text: '没人拦着你。' }];
  const sd = world.getSect(sectId) || sectAtRoom(world, p.room);
  if (!sd) return [{ kind: 'plain', text: '没人拦着你。' }];
  /* 报上名号能不能进，还是得看 joinSect 那一套 —— 这里只「通传」，
     真正的入门仍走「拜师」。若他本就走得进（门槛过、无恶名），守卫放行；
     否则守卫照旧不放 —— 绝不说「进去吧」然后 joinSect 拒你。 */
  const thr = blockedBy(world, p, sd);
  clearGuard(p);
  if (thr) {
    return [
      { kind: 'say', text: `你报上名号。${g.name}想了想，摇头：「名号记下了，可你这样的，${sd.name}不收。」` },
      { kind: 'plain', text: `（${thr}）` },
      { kind: 'hint', text: '（要进门，得先把上面那条补上；或者「硬闯」。）' },
    ];
  }
  if (wantedOf(p) >= 50) {
    return [
      { kind: 'say', text: `你报上名号。${g.name}反而笑了：「省得我找。」山门里呼啦啦涌出几条人影。` },
      { kind: 'hint', text: '（恶名太重，报名字只会招来打手。要退就「退下」，要拼就「硬闯」。）' },
    ];
  }
  /* 报名号放行门槛（2026-10-18 主人裁定）：声望 ≥50 或 门派身份/引荐信——
     「我什么声望都没有、跟谁都不认识，报个名号就让我进了」就是这里漏的。
     声望口径复用既有 reputation 账本（键：门派 id / '*'=全江湖），
     取两者较高者；门槛过的无名小卒照样嗤笑拒之。
     （台词润色终稿 design/104 §二，游有方 2026-10-18。） */
  const rep = p.reputation || {};
  const repute = Math.max(rep[sd.id] || 0, rep['*'] || 0);
  if (!isInsider(world, p, sd.id) && repute < 50) {
    return [
      { kind: 'say', text: `你报上名号。${g.name}把这两个字嚼了嚼，嗤了一声：「没听过。」他往门心一站，「名字没人提过，门就没人让。」` },
      { kind: 'hint', text: '（声望到了 50、或进了门派、或揣着引荐信，再报不迟；要不就「硬闯」。）' },
    ];
  }
  return [
    { kind: 'say', text: `你报上名号。${g.name}眯眼看了你两息，忽然一抱拳：「原来是您。门里提过您的事。」侧身让开。` },
    { kind: 'sys', text: `你进了${sd.name}的山门。要拜师，就在此处「拜师 ${sd.name}」。` },
  ];
}

/** ---------- ② 塞钱打点 ---------- */
function bribe(world, p, sectId) {
  const g = currentGuard(world, p);
  if (!g) return [{ kind: 'plain', text: '没人拦着你。' }];
  const wanted = wantedOf(p);
  const cost = wanted * 20;
  const have = p.money || 0;
  if (have < cost) {
    clearGuard(p);
    return [
      { kind: 'warn', text: `你摸遍全身，凑不出这个数。${g.name}冷笑：「没钱？那就别在这儿站着了。」` },
      { kind: 'plain', text: `（打点他得备 ${cost} 文；你身上只有 ${have} 文。）` },
    ];
  }
  p.money = have - cost;
  clearGuard(p);
  return [
    { kind: 'plain', text: `你把银子往他袖里一塞。${g.name}掂了掂，侧身让开，眼睛看向别处。` },
    { kind: 'good', text: `（银钱 −${cost}。他这一让，山门暂时算你的路。）` },
  ];
}

/** ---------- ③ 硬闯 ---------- */
function forceIn(world, p, sectId) {
  const sd = world.getSect(sectId) || sectAtRoom(world, p.room);
  if (!sd) return [{ kind: 'plain', text: '这里不是谁家的山门。' }];
  const guard = guardIn(world, p.room);
  if (!guard) return [{ kind: 'plain', text: '门前没人拦你，你径直走了进去。' }];
  clearGuard(p);
  /* 硬闯记档（2026-10-18 门禁两病）：无论被擒还是开打，这一门从此记住你——
     戒备态下守卫 hostile 起手（见 maybeBar）。flag 随档持久化。 */
  try { p.setFlag(breachFlag(sd.id), true); } catch (e) { }

  /* 守卫 tier 远高于玩家 → 直接擒下（照《唐律》掳人那条通路的反向：玩家被守门人拿了）。
     「远高于」的判据：守卫气血是玩家上限的 3 倍以上（打不过就别硬闯）。
     ⚠️ 别用绝对差（曾写 `gh - myHp > 3000`）：A 级守门人 1850 血、弱鸡 100 血，
        差值 1750 够不上了就拦不住 —— 相对倍数才是「打不打得过」的语义。 */
  const myHp = Math.max(1, p.maxHp || 1);
  const gh = guard.maxHp || guard.hp || 1;
  if (gh >= myHp * 3) {
    p.hp = 1;
    if (p.kidnap) p.kidnap.wanted = Math.min(100, wantedOf(p) + 15);
    return [
      { kind: 'bad', text: `你刚抬脚，${guard.name}的手就到了。眼前一黑，人已被按在地上。` },
      { kind: 'warn', text: `「哪儿来的野狗，也敢闯${sd.name}的门。」他把你拎起来，随手一丢。` },
      { kind: 'plain', text: `（气血被打到 1，恶名 +15。这一闯，山下的人都看在眼里。）` },
      { kind: 'hint', text: '（他们没杀你，只把你按在地上：hp 留 1、恶名上升，但不会昏迷，爬起来还能再走。）' },
    ];
  }

  /* 打得过 / 打得动 → 起冲突，走普通战斗（不另造战斗分支） */
  return [
    { kind: 'warn', text: `你不再多话，肩头一沉，就要硬闯进去。${guard.name}喝了一声，挡在门前。` },
    { kind: 'plain', text: `（「打 ${guard.name}」动手。打赢了山门任你走，但${sd.name}从此记你一笔。）` },
  ];
}

/** 硬闯打赢之后：门派记仇（名声掉）—— 由战斗结算回调，或玩家手动「闯了」时记。
 *  这里给一个显式入口，供 combat 打赢守卫时调用（找不到调用点也不报错）。 */
function onGuardBeaten(world, p, npc) {
  const tag = (npc && npc.def && npc.def.tag) || (npc && npc.tag);
  if (tag !== GUARD_TAG) return;
  /* 门派归属：def.sect 优先；老守卫（guard_shaolin / guard_huashan，40_npcs 的旧人）
     没这字段 —— 但他们定岗在自家 entry（41_sect_entry 与 def.room 同源），
     用 sectAtRoom 反查兜底，别让他们成了「打赢也不记仇」的漏网之鱼。 */
  const sd = (npc && npc.def && npc.def.sect)
    ? world.getSect(npc.def.sect)
    : sectAtRoom(world, (npc && npc.def && npc.def.room) || (npc && npc.room));
  if (!sd) return;
  /* 硬闯打赢 = 戒备记档（2026-10-18 门禁两病）：再去山门，守卫见你就动手 */
  try { p.setFlag(breachFlag(sd.id), true); } catch (e) { }
  p.reputation = p.reputation || {};
  /* ⚠️ 键用门派 **id**（reputation 账本全库约定：applyRumorReputation / repGain
     都以 id 为键，总览面板按 id 查门派名）；原写 sd.name 是记到一本谁都不读的账上。 */
  p.reputation[sd.id] = Math.max(-100, (p.reputation[sd.id] || 0) - 30);
  /* 打伤守门人算一桩可传的事（#104 配套，游有方落 2026-10-18）：
     原挂 rs_sect_join 是「正式入了门墙」的**拜师喜报**（polarity +1，还会同步
     给声望 +15，把上面的 −30 抵掉一半）——语义反向，已摘。
     现挂专属负面种子 rs_guard_beaten（70_world.json：polarity −1 / loud），
     声望经 applyRumorReputation 走传闻账（约 −14，与上面 −30 叠加）。 */
  try { require('./rumorfeed').note(world, 'rs_guard_beaten', { vars: { who: p.name, where: sd.name } }); } catch (e) { }
}

module.exports = {
  maybeBar, stateName, bribe, forceIn, onGuardBeaten,
  guardIn, sectAtRoom, isInsider, blockedBy, GUARD_TAG, COOLDOWN,
  breachFlag, isBreach,
};
