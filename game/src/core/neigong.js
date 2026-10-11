/**
 * neigong.js — 内力上限系统（主人 2026-10-10 定的核心成长轴）
 *
 * 三条规矩：
 *  ① **内力上限 = 实力上限**。对 NPC 而言，内力涨了，他的功法等级会跟着抬到相应火候
 *     （不用一条条手填数据：内力一百的人，本来就该会得比内力十的人深）。
 *  ② 玩家练内力上限的路子是**吐纳**：不能动，内力与气血一点点往下掉
 *     （气血掉得比内力慢 —— 气血顶不住的人根本熬不到最后），
 *     掉到零的那一刻「一次补全」，上限 +1（**有内功的人涨得更多**，内功等级越高越多）。
 *  ③ 内力上限反过来抬高**武学等级上限**与修炼速度（见 character.maxSkillLevelFor）。
 *
 * ⚠️ 吐纳是**一轮一轮推进**的（每轮消耗 30 分钟游戏时间），不是挂机自动跑：
 *    玩家得一次次坐下来，才谈得上「熬」。中断（走动、挨打）即散功，这一轮白练。
 */
'use strict';

const ROUND_MIN = 30;        // 一轮吐纳消耗的游戏时间
/* ⚠️ 旧的 MP_DRAIN / HP_DRAIN（按**百分比**扣）已经拆掉了 ——
   主人 2026-10-11：「吐纳是按内功品级**固定数值**消耗血量以及消耗内力」。
   百分比那套有个反直觉的毛病：内力越高、一次掉得越多，练内力反而像在填无底洞。
   现在改成「品级越高，一口吞掉的气血内力越多（换来上限涨得也多）」，
   而**熟练度越高越省**。三道刻度都在 costOf / gainOf 里。 */
const NPC_MP_PER_LEVEL = 40; // 多少内力上限折算一级火候
const NPC_LEVEL_CAP = 600;   // NPC 火候硬顶：玩家天花板是 1000（基础武学满级），
                             // 顶到 600 是「扫地僧级」该有的份量，仍给玩家留足成长空间

function stateOf(ch) { return ch.vars.tuning || null; }

/** 身上挂的内功（没有就 null） */
function innerOf(ch) {
  const ng = ch.equippedSkills && ch.equippedSkills['内功'];
  return (ng && ch.learned && ch.learned[ng]) ? ng : null;
}

/**
 * 内功**品级**（1~9）。没练内功的按最低品算 —— 凡人也能吐纳，只是收获微薄。
 * ⚠️ 拿的是 `skills[id].grade`（武学重制给每门功法定的品级），
 *    没写 grade 的老数据一律按 1 兜底，别让 undefined 混进算式。
 */
function gradeOf(ch) {
  const id = innerOf(ch);
  if (!id || !ch.world) return 1;
  const sd = ch.world.getSkill(id);
  const g = sd && sd.grade;
  return (typeof g === 'number' && g >= 1 && g <= 9) ? Math.floor(g) : 1;
}

/** 内功熟练度（没内功 = 0） */
function innerLevelOf(ch) {
  const id = innerOf(ch);
  return (id && ch.learned[id] && ch.learned[id].level) || 0;
}

/**
 * 一轮吐纳的**固定消耗**。
 *  · 品级越高 → 基数越大（品级 1 → 4 点，品级 9 → 20 点）
 *  · 熟练度越高 → 越省（300 级时消耗减半）
 * 气血按内力的六成扣 —— 主人原话「气血掉得比内力慢」，这条没变。
 */
function costOf(ch) {
  const base = 2 + gradeOf(ch) * 2;
  const ease = 1 / (1 + innerLevelOf(ch) / 300);
  return {
    mp: Math.max(1, Math.round(base * ease)),
    hp: Math.max(1, Math.round(base * 0.6 * ease)),
  };
}

/** 一次吐纳能涨多少内力上限：品级越大、熟练度越高，涨得越多 */
function gainPerTune(ch) {
  const base = 1 + gradeOf(ch) * 0.8;
  return Math.max(1, Math.round(base * (1 + innerLevelOf(ch) / 200)));
}

/** 一次吐纳对气血上限的补益：与根骨挂钩（「要练外功」——外功等级也吃），品级也算一份 */
function hpGainPerTune(ch) {
  const st = ch.attrTotal('根骨') || 10;
  const wg = ch.equippedSkills && ch.equippedSkills['拳'];
  const wlv = (wg && ch.learned[wg] && ch.learned[wg].level) || 0;
  return Math.max(0, Math.floor(st / 20 + wlv / 300 + gradeOf(ch) * 0.4));
}

/** 开始吐纳 */
function start(world, ch) {
  if (world.battle) return { ok: false, lines: [{ kind: 'warn', text: '交着手呢，坐不下来。' }] };
  if (stateOf(ch)) return { ok: false, lines: [{ kind: 'warn', text: '你已经在吐纳了。' }] };
  /* 起手要丹田里有气 —— 空的坐下去，第一轮就作废（见 round） */
  const cost = costOf(ch);
  if ((ch.mp || 0) <= 0) {
    return { ok: false, lines: [{ kind: 'warn', text: '丹田里空空如也，坐不住。先打坐养一养，或者服一枚丹药。' }] };
  }
  if ((ch.hp || 0) <= cost.hp) {
    return { ok: false, lines: [{ kind: 'warn', text: '气血太虚，这么熬下去会出事。先养一养。' }] };
  }
  ch.vars.tuning = { round: 0, started: world.clockMinutes || 0 };
  return {
    ok: true,
    lines: [
      { kind: 'story', text: '你寻了处安静地方盘膝坐下，把呼吸放慢。起初还听得见外头的动静，后来只剩下自己心跳的声响。' },
      { kind: 'hint', text: `（这一坐会**自己一轮一轮往下走**，不用一直点。一轮耗内力 ${cost.mp} 点、气血 ${cost.hp} 点，内力见底才收功。想中途起来，点屏幕上任何别的按钮。）` },
    ],
  };
}

/**
 * 推一轮。
 *
 * 主人 2026-10-11 定的三条：
 *   ① 消耗是**按内功品级的固定数值**（见 costOf），不是百分比；
 *   ② **内力不够这一轮 → 失败**（这一趟白坐，但不昏迷）；
 *   ③ **气血不够 → 昏迷**（昏在楼里/道上，被送最近的客栈）。
 *   ④ 内力见底 → 结算涨上限，**但不再「一次补全」**（结束后不回满血与内力）。
 */
function round(world, ch) {
  const st = stateOf(ch);
  if (!st) return { ok: false, lines: [{ kind: 'warn', text: '你还没坐下——先用「吐纳」起手。' }] };

  const cost = costOf(ch);
  const mp = ch.mp || 0, hp = ch.hp || 0;

  /* ② 内力已经空了：坐不下去，这一趟作废。
     ⚠️ 判据是 `mp <= 0` 而**不是** `mp < 成本` —— 后者会把「正好这一轮见底」
        判成失败，可**见底那一轮恰恰是要结算的**（第一版就是这么写的，
        结果玩家永远碰不到结算，内力上限一辈子不涨）。 */
  if (mp <= 0) {
    delete ch.vars.tuning;
    return {
      ok: false, failed: true,
      lines: [
        { kind: 'story', text: '你把这口气往下引，丹田里一丝也提不起来。' },
        { kind: 'warn', text: '这一坐没坐成 —— 内力已经空了。' },
        { kind: 'hint', text: '（内力见底那一轮本该收功结算。多坐了半口气，这一趟就白搭了。）' },
      ],
    };
  }

  /* ③ 气血不够：再坐下去要出事 */
  if (hp <= cost.hp) {
    delete ch.vars.tuning;
    const lines = [
      { kind: 'story', text: '你的手先凉了，跟着是脸。眼前那些光点散成一片，怎么收都收不回来。' },
      { kind: 'faint', text: '你眼前一黑，什么都不知道了……' },
    ];
    try { require('./survival').respawnAtInn(world, lines); }
    catch (e) { ch.hp = 1; }        /* 兜底：复活通路出岔子也不能让人停在 0 血 */
    return { ok: false, fainted: true, lines };
  }

  st.round++;
  /* ⚠️ 顺序要紧：**先推时间，再扣气血内力**。
     时间推进里会跑 worldTick → 功能 Mod 的 onEvent 规则（官方示例就有一条
     `onTick +hp:8` 的「脱战回血」）。先扣后推的话，扣掉的那点当场被补回来，
     玩家看不到任何消耗（第一版实测「吐纳三轮血一点没掉」，就是撞在这个上）。
     那条规则已经加了 `!tuning` 条件；这里再按「先推后扣」排一次，
     是为了别人写的回血规则也不至于把吐纳的账做平。 */
  world.advanceTime && world.advanceTime(ROUND_MIN);
  ch.mp = Math.max(0, mp - cost.mp);
  ch.hp = Math.max(0, hp - cost.hp);

  /* ④ 内力见底 → 结算。**不补全**：见底就是见底，得自己回。 */
  if (ch.mp <= 0) {
    const gainMp = gainPerTune(ch);
    const gainHp = hpGainPerTune(ch);
    ch.maxMpBase = (ch.maxMpBase || 50) + gainMp;
    if (gainHp) ch.maxHpBase = (ch.maxHpBase || 100) + gainHp;
    ch.recalc();
    const rounds = st.round;
    delete ch.vars.tuning;
    return {
      ok: true, done: true, gainMp, gainHp, rounds,
      lines: [
        { kind: 'story', text: '丹田里最后那一缕气也散尽了。你睁开眼，手脚发软，可那口气分明比先前宽了一线。' },
        { kind: 'sys', text: `共坐了 ${rounds} 轮。内力上限 +${gainMp}（现 ${Math.floor(ch.maxMp)}）` + (gainHp ? `，气血上限 +${gainHp}` : '') + '。' },
        { kind: 'warn', text: `内力见底（${Math.round(ch.mp)}/${Math.round(ch.maxMp)}），气血也搭进去不少 —— 这口气**不会自己回来**，打坐、服药，或者再等一阵。` },
        ...(gainMp > 1 ? [{ kind: 'hint', text: '（内功品级越高、练得越熟，这一坐涨得越多。）' }] : [{ kind: 'hint', text: '（学一门内功再来，一次就不止涨这一点了。）' }]),
      ],
    };
  }

  const pct = Math.round((1 - ch.mp / Math.max(1, ch.maxMp)) * 100);
  return {
    ok: true, done: false, round: st.round,
    lines: [
      { kind: 'plain', text: `气息又沉下去一层。丹田空了一分，指尖发凉（第 ${st.round} 轮，内力剩 ${Math.round(ch.mp)}，约 ${pct}% 已耗）。` },
    ],
  };
}

/**
 * 退出吐纳（不结算，这一坐白坐）。
 *
 * 主人 2026-10-11：「吐纳的动不了，改成点击页面任意其他按钮自动退出吐纳状态」，
 * 而且**不要「收功」按钮**。所以这条路现在有两个入口：
 *   ① 吐纳中点屏幕上任何别的按钮 —— `engine.exec` 认出这不是「继续」指令，
 *      先调这里把状态收掉，再照常执行那条指令（见 engine.js 的 `KEEP` 白名单）；
 *   ② 老玩家手敲「收功 / 散功 / 起身」。
 * 两个入口都得在屏幕上**明说「退出吐纳状态」**，不能让玩家以为自己还坐着。
 */
function stop(world, ch) {
  const st = stateOf(ch);
  if (!st) return { ok: false, lines: [{ kind: 'warn', text: '你并没有在吐纳。' }] };
  const rounds = st.round || 0;
  delete ch.vars.tuning;
  return {
    ok: true,
    lines: [
      {
        kind: 'story',
        text: '你缓缓睁开眼，把散在外头的那口气一点点收回来。手脚还发凉，屋里的响动重新灌进耳朵。',
      },
      {
        kind: 'sys',
        text: `已退出吐纳状态${rounds ? `（坐满 ${rounds} 轮）` : ''} —— 这一坐没熬到最后，白坐了。`,
      },
      {
        kind: 'hint',
        text: '（要涨上限，得让内力一直耗到见底。中途起来，这一趟就白坐了。）',
      },
    ],
  };
}

/** 吐纳中不许走动 —— 由 movePlayerTo 调用 */
function blocksMove(ch) { return !!stateOf(ch); }

/* ============================================================
 * NPC：内力上限 = 实力上限
 * 内力越高，功法等级自动抬到相应火候（不必一条条手填）
 * ============================================================ */
function npcLevelFromMp(npc) {
  /* ⚠️ 基准取 **maxMpBase（模板内力）** 而不是 maxMp：
     maxMp 是 recalc 后的值，里面含了武学 bonus 的加成；拿它当基准会形成
     「内力高 → 火候高 → bonus 加成高 → 内力更高」的正反馈（实测能把东方不败顶到 1789 级）。
     模板内力是作者手填的定值，才是「这个人内力有多深」的真相源。 */
  const mp = (npc && (npc.maxMpBase !== undefined ? npc.maxMpBase : npc.maxMp)) || 0;
  /* 40 点内力上限 ≈ 1 级火候。这个刻度是配着「NPC 模板里的 mp 与 learned」定的：
     内力 1000 的一流高手 ≈ 25 级起，内力 10000 的绝顶 ≈ 250 级。 */
  return Math.min(NPC_LEVEL_CAP, Math.floor(mp / NPC_MP_PER_LEVEL));
}

/** 把 NPC 的功法等级抬到与其内力相称的水平（只抬不降：数据里手填的更高就保留） */
function syncNpcByMp(world, npc) {
  if (!npc || npc.isPlayer) return 0;
  const cap = npcLevelFromMp(npc);
  if (cap <= 0) return 0;
  let lifted = 0;
  npc.learned = npc.learned || {};
  for (const sid of Object.keys(npc.learned)) {
    const cur = (npc.learned[sid] && npc.learned[sid].level) || 0;
    if (cur < cap) { npc.learned[sid].level = cap; lifted++; }
  }
  return lifted;
}

module.exports = {
  start, round, stop, blocksMove, stateOf,
  gainPerTune, hpGainPerTune, npcLevelFromMp, syncNpcByMp,
  ROUND_MIN,
  /* 吐纳的三道刻度（界面与测试都要读）：品级 / 内功 / 消耗 */
  costOf, gradeOf, innerOf, innerLevelOf,
};
