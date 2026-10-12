/* ============================================================
 * intro.js —— 开场角色扮演（楔子 · 第一人称）
 *
 * 主人 2026-10-12 定的规矩（原话）：
 *   ·「开场先让玩家以第一视角的角色扮演形式进入游戏，要有 2~3 轮角色扮演」
 *   ·「第一轮角色扮演是我现在的身份，第二轮是我性别」
 *   ·「因为这 2~3 轮角色扮演的内容是前世回忆，需要暗示玩家不是这个时代的人」
 *   ·「完成 2~3 轮角色扮演后再进入现在的第一章」
 *   ·「反正我的第一人称 MUD 就是这样子，你可以参考，不用完全照搬」
 *
 * 于是开场从「弹一张楔子卡片 → 直接进第一章」改成：
 *
 *      ┌ 第 1 轮 · 我是谁（出身）   ← 在这里选身份，选完就是「我」
 *      ├ 第 2 轮 · 我是男是女       ← 在这里选性别
 *      └ 第 3 轮 · 那扇门           ← 出身分版旁白 + 前世回忆，收束到茶摊老汉
 *                ↓
 *              第一章（新手教程 · 照旧）
 *
 * ⚠️ 三条不能破的规矩：
 *   1. **只加不改**：第一章那八步（`tutorial.STEPS`）一个字不许动，
 *      本模块只负责「第一章之前那一段」。`seen_intro` 仍由本模块收尾时点亮 ——
 *      老存档、老测试看这个标记，语义没变（「楔子演完了」）。
 *   2. **不引入随机数**：同一存档每次必须读到同一版（回档不许换脸），
 *      与 `tutorial.introFor` 的老口径一致。
 *   3. **前世回忆只暗示、不点破**：只写「不对的东西」——记岔的物件、
 *      不该会的动作、夜里听见的怪响。**一律不出现**「穿越」「现代」「将来」
 *      这类词，也不许让玩家／NPC 说出来。玩家自己品出来才算数。
 *
 * 文本风格沿用 `design/17-intro-rewrite.md` 那套：
 *   短句、具体物件（不写「你很穷」写「草鞋前头磨穿了个洞」）、
 *   末段一句叙事化的行动引导（不出现任何指令名）。
 * ============================================================ */
'use strict';

/* ==========================================================================
 *  一、出身 → 「我是谁」那一轮的选项文案
 *
 *  ⚠️ 主人 2026-10-12：「第一轮是**我现在的身份**」。
 *     所以这里的 label 是「**你**是个什么样的人」（第一人称口吻），
 *     不是后台字段名，也不是 `63_births` 里那种「守墓人之后」的第三人称标签
 *     —— 那些标签念出来像履历，不像「我」。
 *
 *  ⚠️ 选项顺序 = 展示顺序。把「有来路的」放前面、「没来路的」放后面，
 *     玩家从前往后读，会自然感受到一条从「有根」到「无根」的坡。
 * ========================================================================== */

/** 出身 → 第一轮选项文案（title=短标签　desc=一句话　echo=选了之后那句「是的，我……」） */
const BIRTH_VOICE = {
  scholar: {
    title: '我读过书',
    desc: '背过经，抄过帖，家里指望我考个功名。',
    echo: '我是读过书的人。背过经，也抄过帖。',
  },
  wuxue: {
    title: '我家里是练家子',
    desc: '院里的木桩比人高，我自小看惯了。',
    echo: '我家里是练家子。院子里的木桩，比我还高。',
  },
  noble: {
    title: '我家里做过官',
    desc: '门楣上挂过匾。后来那门被贴了封条。',
    echo: '我家里做过官。那块匾摘下来的时候，我没敢看。',
  },
  hunter: {
    title: '我是山里猎户',
    desc: '三里外的脚印，我一眼分得出是狼还是狗。',
    echo: '我是山里长大的猎户。看脚印比看人准。',
  },
  merchant: {
    title: '我是商贾人家',
    desc: '家里走货，钱粮不缺，就是没人习武。',
    echo: '我家是走货的。钱认得出，人不一定。',
  },
  monastic: {
    title: '我在寺里长大',
    desc: '生在寺门口，扫了十六年院子。',
    echo: '我在寺门口被捡回去，扫了十六年院子。',
  },
  taoist_ward: {
    title: '我是道观的道童',
    desc: '看丹炉、画符、认药性，都是师父教的。',
    echo: '我在道观长大。丹炉的火，是我自己灭的。',
  },
  nun_ward: {
    title: '我是庵堂里养大的',
    desc: '师太养我到十五岁，说我该走了。',
    echo: '我在庵堂门槛上被人捡到，师太养我到十五岁。',
  },
  tomb_keep: {
    title: '我家替人守墓',
    desc: '三替代人守一座无名坟。坟里是谁，没人说。',
    echo: '我家三代替人守一座无名坟。碑上一个字也没有。',
  },
  deserter_child: {
    title: '我爹是从军伍里逃出来的',
    desc: '他一路带着我往南跑，刀留给了我。',
    echo: '我爹从军伍里逃出来。那把刀，现在在我背上。',
  },
  grudge_orphan: {
    title: '我一家都死在仇家手里',
    desc: '那一年我七岁，躲在灶膛里，没敢出声。',
    echo: '我七岁那年，一家人死在仇家手里。我记得那双靴子。',
  },
  brothel_sold: {
    title: '我是被卖进来的',
    desc: '契画了押，指印是我的。牌子还没挂。',
    echo: '我被人牙子卖进来的。契上那个指印，是我的。',
  },
  border_drift: {
    title: '我打关外来',
    desc: '边地活不下去，一路往南走到了这儿。',
    echo: '我打关外来。官话说到第三句就卡住。',
  },
  orphan: {
    title: '我谁也不记得',
    desc: '爹娘长什么样，我没见过。',
    echo: '我说不上自己是谁家的。爹娘长什么样，我没见过。',
  },
};

/** 出身 → 性别（带 gender 的只出一种，别让玩家选一个会被后端拒的） */
const BIRTH_GENDER = { brothel_sold: 'female' };

/** 出身 → 第二轮（性别）之后那句「所以我是……」的分版收尾 */
const GENDER_TAIL = {
  male: '男人在这世上，路是宽的，也是硬的。',
  female: '女人的路，比男人窄，也更容易被人替你走。',
};

/* ==========================================================================
 *  二、第三轮 · 那扇门（出身分版旁白 + 前世回忆）
 *
 *  ⚠️ 前世回忆的写法（主人 2026-10-12：「需要暗示玩家不是这个时代的人」）：
 *     一律用「**什么不对劲**」来写，不用「我来自另一个时代」来写：
 *       · 记岔了的物件（明明是头回见，却认得用法）
 *       · 不该会的动作（手比脑子先动）
 *       · 夜里听见的怪响（有频率、有节奏，不像任何东西）
 *       · 开口想说的词（到嘴边就成了另一个词）
 *     这四条每版至少占一条，且**不解释**。收尾不许总结成「所以你懂了什么」。
 * ========================================================================== */

/** 共同收束：把玩家交给茶摊老汉（沿用 tutorial.INTRO_HANDOFF 的那句骨架，
 *  但不复用它的变量 —— 那边是「老汉开口」，这边要玩家**先看见**他）。 */
const CLOSING = {
  title: '【楔子】那扇门',
  /** 前世回忆：四版共用的一段「不对的东西」（不点破） */
  recall:
    '<p class="intro-p">有一件事你一直没跟人说过。</p>'
    + '<p class="intro-p">昨夜你听见一个声音。不高，也不吵，一下一下，匀得很，比更鼓匀，比水滴匀。'
    + '你在暗处睁着眼听了很久，天亮了它也停了。说不上那是什么。</p>'
    + '<p class="intro-p">还有另一样：有几样东西你分明是头一回见，手却比脑子先动。'
    + '怎么拿、怎么放、该用多大劲——手知道，你说不上来自己是怎么知道的。</p>',
};

/* --------------------------------------------------------------------------
 *  楔子收尾 · 门派掠影（主人 2026-10-12：「楔子之后可附宗门背景介绍」）
 *
 *  ⚠️ 这一段的定位是「**茶还没喝上，先听见点风声**」，不是任务派发：
 *     只讲**这一世会走去的那个门派**长什么样、当家人是个什么脾气，
 *     **不出现任务名、不出现指令名、不点破主线要往哪走**。
 *     玩家听完这段，再走到茶摊坐下 —— 第一章照旧从老汉那儿开始。
 *
 *  ⚠️ 判据跟 `tutorial.targetSectFor` 同源（出身 → 门派链 → 性别过滤），
 *     但**不 require tutorial**（intro 在它上游，反向依赖会把模块图绕成环）。
 *     这里自己取一份出身链，只读数据、不做任何写操作。
 * ------------------------------------------------------------------------ */
const SECT_CHAIN = {
  orphan: ['gaibang', 'tangmen', 'miaojiang'],
  hunter: ['miaojiang', 'tangmen', 'gaibang'],
  wuxue: ['huashan', 'wudang', 'tangmen'],
  noble: ['dali', 'wudang', 'tangmen'],
  scholar: ['wudang', 'taohua', 'tangmen'],
  merchant: ['tangmen', 'taohua', 'gaibang'],
  monastic: ['shaolin', 'wudang', 'gaibang'],
  taoist_ward: ['taohua', 'wudang', 'tangmen'],
  tomb_keep: ['gumu', 'miaojiang', 'wudang'],
  deserter_child: ['xuedao', 'miaojiang', 'tangmen'],
  grudge_orphan: ['xingxiu', 'miaojiang', 'xuedao'],
  border_drift: ['mojiao', 'miaojiang', 'xuedao'],
  nun_ward: ['emei', 'gumu', 'wudang'],
  brothel_sold: ['hehuan', 'miaojiang', 'gaibang'],
};

/**
 * 这一世最可能走去的那个门派（只读；取不到就返回 null，不抛错）。
 * @returns {{id:string, name:string, desc:string, master:string}|null}
 */
function sectGlimpse(world, p) {
  try {
    const sects = (world && world.data && world.data.sects) || {};
    if (!Object.keys(sects).length) return null;
    /* 已入门：就以现成的门派为准 */
    const gender = (p && p.gender) || 'male';
    let id = null;
    if (p && p.sect && sects[p.sect]) {
      id = p.sect;
    } else {
      const chain = SECT_CHAIN[(p && p.birth)] || SECT_CHAIN.orphan;
      id = chain[0];
      for (const c of chain) {
        const req = (sects[c] || {}).require;
        if (!req || !req.gender || req.gender === gender) { id = c; break; }
      }
    }
    const sd = sects[id];
    if (!sd) return null;
    /* 掌门名：NPC 侧按 `sect === id && rank 最高` 找。
       ⚠️ 找不到就不写掌门那一句 —— 宁可少一句，也不许印出「掌门」两个字当人名。 */
    let master = '';
    const npcs = (world.data && world.data.npcs) || {};
    let best = null;
    for (const nid of Object.keys(npcs)) {
      const n = npcs[nid];
      if (!n || n.sect !== id || !n.name) continue;
      const rk = Number(n.rank) || 0;
      if (!best || rk > (Number(best.rank) || 0)) best = n;
    }
    if (best && best.name) master = best.name;
    return { id, name: sd.name || id, desc: sd.desc || '', master };
  } catch (e) { return null; }
}

/** 把门派掠影拼成一段（取不到就返回空串 —— 宁可这段没有，也不许印半句） */
function sectGlimpseHtml(world, p) {
  const g = sectGlimpse(world, p);
  if (!g || !g.name) return '';
  /* ⚠️ 措辞是**路人闲话**，不是门派资料卡：
     上一句刚提过老槐树，这里不能再提一遍（读着像复读机）；
     「当家的」也比「掌门是」更像茶摊上会说的话。 */
  let h = '<p class="intro-p">这一路上歇脚的人多，闲话也多，说来说去总绕不开各家的门墙。</p>';
  if (g.desc) h += '<p class="intro-p">近来提得最多的，是' + g.name + '。' + g.desc + '</p>';
  if (g.master) h += '<p class="intro-p">当家的叫' + g.master + '，这一带没人不知道这个名字。</p>';
  h += '<p class="intro-p">这些话你听着，心里说不清是熟还是不熟。</p>';
  return h;
}

/* ==========================================================================
 *  三、状态机
 *
 *  `p.vars._intro` 里记进度（随档走）：
 *    step  'birth' | 'gender' | 'close' | 'done'
 *    birth 选了哪个出身（玩家在这一轮**重新选**，可以跟建号时不一样）
 *    gender 'male' | 'female'
 *
 *  ⚠️ 为什么要「重新选」：主人要的是「以角色扮演的形式进入游戏」——
 *     建号那一步的出身是**配置**，这一步的出身是**自白**。
 *     玩家在这儿改了口，就按他改的算（`p.birth` 跟着改），
 *     否则「我说我是猎户，面板却写书香门第」会立刻出戏。
 * ========================================================================== */

const VAR = '_intro';

/** 取（必要时补建）角色扮演状态 */
function stateOf(p) {
  if (!p) return null;
  if (!p.vars) p.vars = {};
  let s = p.vars[VAR];
  if (!s || typeof s !== 'object') {
    s = p.vars[VAR] = { step: 'birth', birth: null, gender: null };
  }
  if (!s.step) s.step = 'birth';
  return s;
}

/** 楔子演完了没（`seen_intro` 是给老代码/老测试看的同一个标记） */
function isDone(p) {
  if (!p) return true;
  const flags = p.tutorialFlags;
  const seen = Array.isArray(flags)
    ? flags.indexOf('seen_intro') >= 0
    : (flags && typeof flags.has === 'function' && flags.has('seen_intro'));
  if (seen) return true;
  const s = stateOf(p);
  return !!(s && s.step === 'done');
}

/** 可选的出身列表（按 `BIRTH_VOICE` 的顺序，只列该性别能选的） */
function birthOptions(world, gender) {
  const meta = (world && world.data && world.data.meta) || {};
  const table = meta.births || {};
  const out = [];
  for (const id of Object.keys(BIRTH_VOICE)) {
    if (!table[id]) continue;                    /* 数据里没有就不列（防手写漏了） */
    const need = BIRTH_GENDER[id] || (table[id].gender || null);
    if (need && need !== gender) continue;
    out.push({
      id,
      title: BIRTH_VOICE[id].title,
      desc: BIRTH_VOICE[id].desc,
      name: table[id].name || id,
      /* 面板上给个两三字的短标签，别把整句塞进按钮 */
      short: BIRTH_VOICE[id].title.replace(/^我/, ''),
    });
  }
  return out;
}

/**
 * 当前这一屏该演什么（给前端渲染）。
 * @returns {{show:boolean, step?:string, title?:string, body?:string,
 *            options?:Array, picked?:object, canSkip?:boolean}}
 */
function screenFor(world, p) {
  if (!p) return { show: false };
  if (isDone(p)) return { show: false };
  const s = stateOf(p);
  const gender = s.gender || p.gender || 'male';

  /* ---- 第 1 轮：我是谁 ---- */
  if (s.step === 'birth') {
    return {
      show: true, step: 'birth',
      title: '我是谁',
      hint: '第 1 轮 · 你睁开眼，先要知道自己是谁',
      body:
        '<p class="intro-p">先别急着睁眼。</p>'
        + '<p class="intro-p">此刻你还不记事。名字、来路、身上这件衣裳是谁给的 —— 都还是一团雾。'
        + '只有一样东西是清楚的：<b>你是个什么样的人</b>。</p>'
        + '<p class="intro-p intro-em">这一条得你自己说出来。说出来，它才作数。</p>',
      options: birthOptions(world, gender).map(o => ({
        key: o.id, label: o.title, desc: o.desc,
      })),
    };
  }

  /* ---- 第 2 轮：我是男是女 ---- */
  if (s.step === 'gender') {
    const pickedName = (BIRTH_VOICE[s.birth] || {}).title || '我';
    const one = BIRTH_GENDER[s.birth];
    if (one) {
      /* 这个出身只有一个性别可走 —— 不摆两个按钮让玩家撞墙 */
      return {
        show: true, step: 'gender', auto: one, picked: { birth: s.birth },
        title: '我是男是女',
        hint: '第 2 轮 · 这件事，由不得你挑',
        body:
          '<p class="intro-p">「' + pickedName + '」—— 这句话在心里过了一遍，你睁开了眼。</p>'
          + '<p class="intro-p">低头看了看这双手。是谁的手，你也是这时候才知道的。</p>',
        options: [
          { key: one, label: one === 'female' ? '是女子' : '是男子', desc: '这条路从生下来就定下了。' },
        ],
      };
    }
    return {
      show: true, step: 'gender', picked: { birth: s.birth },
      title: '我是男是女',
      hint: '第 2 轮 · 低头看一眼自己的手',
      body:
        '<p class="intro-p">「' + pickedName + '」—— 这句话在心里过了一遍，你睁开了眼。</p>'
        + '<p class="intro-p">低头看了看这双手，这才知道自己是男是女。</p>',
      options: [
        { key: 'male', label: '是男子', desc: '男人在这世上，路是宽的，也是硬的。' },
        { key: 'female', label: '是女子', desc: '女人的路，比男人窄，也更容易被人替你走。' },
      ],
    };
  }

  /* ---- 第 3 轮：那扇门（收尾） ---- */
  if (s.step === 'close') {
    const g = s.gender || p.gender || 'male';
    const voice = BIRTH_VOICE[s.birth] || BIRTH_VOICE.orphan;
    return {
      show: true, step: 'close',
      title: CLOSING.title,
      hint: '第 3 轮 · 门就在那儿',
      body:
        '<p class="intro-p intro-em">' + voice.echo + '</p>'
        + '<p class="intro-p">' + GENDER_TAIL[g] + '</p>'
        + CLOSING.recall
        + '<p class="intro-p">这些都不必现在想明白。</p>'
        + '<p class="intro-p">你起身，走到门外。日头刚爬上来，道口那棵老槐树老远就看见了。</p>'
        + sectGlimpseHtml(world, p)
        + '<p class="intro-p">树底下支着个卖茶的小摊，灶前蹲着个老汉，正在拨火。</p>'
        + '<p class="intro-p">你还没走到跟前，他先抬了抬下巴，朝你示意 —— 叫你过去坐。</p>',
      options: [{ key: 'go', label: '走过去坐下', desc: '听他要说什么。' }],
    };
  }

  return { show: false };
}

/**
 * 走一轮。
 * @param {object} world
 * @param {object} p
 * @param {string} key  这一轮玩家点了什么（birth 的 id / 'male' / 'female' / 'go'）
 * @returns {{ok:boolean, error?:string, screen?:object}}
 */
function step(world, p, key) {
  if (!p) return { ok: false, error: '还没有角色。' };
  const s = stateOf(p);

  if (s.step === 'birth') {
    const ok = birthOptions(world, s.gender || p.gender || 'male').some(o => o.id === key)
      || !!BIRTH_VOICE[key];
    if (!ok) return { ok: false, error: '没有这一样出身。' };
    s.birth = key;
    /* ⚠️ 出身**当场改到玩家身上**（含 `p.birth` 与主线那条线）——
       「我说我是猎户，面板却写书香门第」会立刻出戏。 */
    p.birth = key;
    try {
      const ml = require('./mainline');
      const st = ml.stateOf(p);
      st.birth = key;
      st.line = ml.lineOfBirth(key);
    } catch (e) { /* 主线没装也不该挡着开场 */ }
    s.step = 'gender';
    return { ok: true, screen: screenFor(world, p) };
  }

  if (s.step === 'gender') {
    const one = BIRTH_GENDER[s.birth];
    const pick = one || key;
    if (pick !== 'male' && pick !== 'female') return { ok: false, error: '这件事只有两种。' };
    s.gender = pick;
    p.gender = pick;
    s.step = 'close';
    return { ok: true, screen: screenFor(world, p) };
  }

  if (s.step === 'close') {
    s.step = 'done';
    /* `seen_intro` 仍点亮 —— 老存档、老守卫看的就是这个标记 */
    try {
      if (Array.isArray(p.tutorialFlags)) {
        if (p.tutorialFlags.indexOf('seen_intro') < 0) p.tutorialFlags.push('seen_intro');
      } else if (p.tutorialFlags && typeof p.tutorialFlags.add === 'function') {
        p.tutorialFlags.add('seen_intro');
      }
    } catch (e) { /* 标记加不上也不该卡住开场 */ }
    /* 开局那笔「新手进度已讲」的账要在**这时候**记 —— 楔子演完了，
       下面第 1 章不该再从头复述一遍。 */
    try { require('./storybeat').markSeen(world, p); } catch (e) { /* 记不上就记不上 */ }
    return { ok: true, screen: { show: false }, done: true };
  }

  return { ok: true, screen: { show: false } };
}

module.exports = {
  VAR, BIRTH_VOICE, BIRTH_GENDER, stateOf, isDone, screenFor, step, birthOptions,
  /* 楔子收尾的门派掠影（主人 2026-10-12）——单独导出便于守卫直接断言 */
  sectGlimpse, sectGlimpseHtml, SECT_CHAIN,
};
