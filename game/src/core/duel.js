/* ============================================================
 * duel.js —— 切磋（点到为止的比武）
 *
 * 主人 2026-10-11 的口径：
 *   「npc 互动页有『攻击』没有『切磋』。点击切磋按钮会根据人物性格说一句请赐教之类的话；
 *     切磋和正常战斗一样（会掉血但不会死亡、会保留 1 滴血晕倒过去，醒来还是在原地）；
 *     但如果有旁人会凑热闹看并对玩家与 npc 之间的切磋招式进行点评，却不会帮任何一方；
 *     npc 之间有时也会切磋；不同性格的人对切磋态度不同；
 *     切磋过后一般会给少量好感度；通常同一个 npc 一天最多同意切磋三次，
 *     再切磋会说你太菜下次再来之类的话，要么说你很强我不如你之类的话
 *     —— 根据性格来说对应拒绝的话。」
 *
 * 设计取舍（为什么单开一个文件）：
 *   · 「按性格说话」这件事**只能有一处口径**。散在 world.js / commands.js / ui.js 里各写一份，
 *     下次加性格就会有一处漏 —— 这个项目已经栽过好几次（房间动作三个入口、template 两份）。
 *   · 战斗本身仍归 combat.js / world.startDuel；这里只管「态度、台词、次数、点评」。
 *
 * ⚠️ 「不致死」不在这个文件里 —— 那是战斗引擎的职责，落在
 *    `combat.js onDeath()` 最前面（拦在所有致死逻辑之前）。见那儿的注释。
 * ============================================================ */
'use strict';

/** 同一个 NPC 一天最多同意几次 */
const MAX_PER_DAY = 3;
const DAY_MIN = 1440;

const dayOf = (world) => Math.floor((world.clockMinutes || 0) / DAY_MIN);

/** 今日已切磋几次 */
function countToday(world, npcId) {
  const p = world.player;
  const log = (p && p.duelLog) || {};
  const rec = log[npcId];
  if (!rec) return 0;
  return rec.day === dayOf(world) ? (rec.n || 0) : 0;
}

function noteDuel(world, npcId) {
  const p = world.player;
  if (!p) return;
  if (!p.duelLog) p.duelLog = {};
  const d = dayOf(world);
  const rec = p.duelLog[npcId];
  p.duelLog[npcId] = (rec && rec.day === d) ? { day: d, n: (rec.n || 0) + 1 } : { day: d, n: 1 };
}

/* ---------- 按性格说话 ----------
   九种性格见 personality.js：haoshuang 豪爽 / yinzhi 阴鸷 / qienuo 怯懦 / xiayi 侠义 /
   youhua 油滑 / mune 木讷 / wenwan 温婉 / baozhao 暴躁 / lengmo 冷漠。
   ⚠️ 每个性格都要给「应战 / 嫌你弱 / 服你强」三种话 ——
   少一种就会回落到默认句，十个人说同一句就露馅了。 */
const SAY = {
  haoshuang: {
    accept: ['哈哈一笑，甩了甩袖子：「来得正好！我这套路子有些糙，你留神。」',
      '把酒碗往桌上一放：「动手前先说好，谁输了谁请酒。」'],
    weak: ['摆摆手：「你这手还嫩。回去把马步扎稳了再来，我等你。」',
      '笑出声：「就这三脚猫？我陪你喂招都嫌亏。练两年再说。」'],
    strong: ['一拍大腿：「好功夫！我这几下在你面前不够看。」',
      '拱了拱手：「我服了。往后你的名号，我先替你传。」'],
  },
  yinzhi: {
    accept: ['眼皮抬了抬：「你要试，那就试。别怪我手黑。」',
      '慢慢把袖子卷起来：「说清楚，点到为止。」'],
    weak: ['哼了一声：「不值得我出手。」',
      '连看都没看你：「就凭你？下回吧。」'],
    strong: ['盯了你半晌，忽然笑了一下：「……是我看走了眼。」',
      '垂下眼帘：「今日这一场，我记下了。」'],
  },
  qienuo: {
    accept: ['往后缩了半步，还是把袖子挽了起来：「那……那你手下轻些。」',
      '咽了口唾沫：「先说好，我打不过就认输。」'],
    weak: ['连连摆手：「不不不，你太厉害了，我不敢。」',
      '脸都白了：「我不行的，你找别人吧。」'],
    strong: ['一愣，随即松了口气：「原、原来你也没那么厉害……」',
      '挠了挠头：「我还以为要吃亏呢。」'],
  },
  xiayi: {
    accept: ['抱拳当胸：「好！以武会友，重在切磋，不伤和气。」',
      '正色道：「你先出手。」'],
    weak: ['摇头：「你根基未稳，先练三年基本功，我再与你过招。」',
      '叹了口气：「功夫不是赌气的东西。回去练。」'],
    strong: ['朗声大笑：「领教了！你这一路，我记在心里了。」',
      '一拱手到底：「受教。往后有用得着我的地方，说一声。」'],
  },
  youhua: {
    accept: ['嘻嘻一笑：「行啊，输了别哭。」',
      '掂了掂手里的家伙：「咱们说好，可不许往脸上招呼。」'],
    weak: ['一边摆手一边往后退：「别别别，我这身骨头金贵。」',
      '笑得眼睛都眯了：「您这身手，我认栽，不打了。」'],
    strong: ['立刻收手，拱了拱手：「佩服佩服，我这两下子拿不出手。」',
      '凑近了低声说：「回头教我一招半式，我请你喝酒。」'],
  },
  mune: {
    accept: ['闷声「嗯」了一下，摆开了架势。',
      '没说话，只把脚往后挪了半步。'],
    weak: ['摇头。', '看了你一眼，没动。'],
    strong: ['抱了抱拳，没多话，退到一边去了。', '「……好。」'],
  },
  wenwan: {
    accept: ['轻轻一福：「领教了。还请手下留情。」',
      '柔声道：「我不擅争斗，你多担待。」'],
    weak: ['摇了摇头：「你现在的火候，还差些。别急。」',
      '轻声说：「再练练吧，我等你。」'],
    strong: ['微微一怔，随即端端正正行了个礼：「是我不及你。」',
      '轻声叹道：「今日受教了。」'],
  },
  baozhao: {
    accept: ['把外袍一扯甩在地上：「来啊！磨蹭什么！」',
      '瞪眼道：「说好了，谁也不许留手！」'],
    weak: ['鼻子里出气：「就你？也配。」',
      '一脚把门槛上的土踢开：「滚远点，别耽误我工夫。」'],
    strong: ['愣在原地，脸涨得通红，半晌才闷声道：「……算你狠。」',
      '把袍子捡起来，重重拍了拍土：「我输了。不服气也得认。」'],
  },
  lengmo: {
    accept: ['「随你。」', '站直了，两手垂着：「动手吧。」'],
    weak: ['「不必。」', '把视线移开了，没再理你。'],
    strong: ['「嗯。」', '点了一下头，转身走了。'],
  },
};

function lineFor(npc, kind, seed) {
  const personality = require('./personality');
  const per = personality.personalityOf(npc);
  const id = (per && per.id) || 'mune';
  const pool = (SAY[id] && SAY[id][kind]) || SAY[id].accept;
  const rng = npc && npc.world && npc.world.rng;
  const i = rng ? rng.int(0, pool.length - 1) : 0;
  return pool[i] || pool[0];
}

/** 应战台词（主人：「点击切磋按钮会根据人物性格说一句请赐教之类的话」） */
const acceptLine = (npc) => lineFor(npc, 'accept');

/** 拒战台词。`why` = 'weak'（嫌你太弱）| 'strong'（自认不如） */
const refuseLine = (npc, why) => lineFor(npc, why === 'strong' ? 'strong' : 'weak');

/**
 * 能不能切磋。返回 { ok, why, line }。
 * 三道闸：好感太低 / 战斗中 / 今日次数用尽。
 * 「次数用尽」的拒绝话术**按性格**分两派：
 *   · 前面几场**你都输了** → 对方嫌你弱（weak）
 *   · 前面几场**你赢过**   → 对方说"我不如你"（strong）
 * 这样拒绝的话才跟真实战绩对得上，不是随机甩一句。
 */
function canDuel(world, npc) {
  const p = world.player;
  if (!npc) return { ok: false, line: '找不到切磋的对手。' };
  if (world.battle) return { ok: false, line: '你正与人交手，先了结眼前这桩。' };
  if (npc.dead && !npc.knockedOut) return { ok: false, line: `${npc.name}已经不在了。` };
  if (npc.knockedOut) return { ok: false, line: `${npc.name}还躺着，等他缓过来再说。` };
  if (/\b狼|虎|熊|蛇|豹|兽|野猪|蟒|鹰/.test(npc.name || '')) {
    return { ok: false, line: `${npc.name}听不懂什么点到为止。` };
  }
  if ((npc.favor || 0) < -40) {
    return { ok: false, line: `${npc.name}冷冷道：「我不与你这等人动手。」`, skipStyle: true };
  }
  const n = countToday(world, npc.id);
  if (n >= MAX_PER_DAY) {
    /* 战绩决定用哪套拒绝词：`p.duelWin[npc.id]` 记着赢过几场 */
    const wins = ((p && p.duelWin) || {})[npc.id] || 0;
    const why = wins > 0 ? 'strong' : 'weak';
    return { ok: false, why, line: `${npc.name}${refuseLine(npc, why)}` };
  }
  return { ok: true, left: MAX_PER_DAY - n };
}

function noteWin(world, npcId) {
  const p = world.player;
  if (!p) return;
  if (!p.duelWin) p.duelWin = {};
  p.duelWin[npcId] = (p.duelWin[npcId] || 0) + 1;
}

/* ---------- 看客点评 ----------
 * 主人：「如果有旁人会凑热闹看并对玩家与 npc 之间的切磋招式进行点评，
 *       却不会帮任何一方」。
 * 所以这里**只出话，绝不动人**（不加 battle.attackers/defenders、不改 favor）。
 * 点评按看客自己的性格分派，且**分胜负**说不同的话。 */
const WATCH_LINES = {
  haoshuang: { win: ['在边上拍手：「好！这一下干净利落！」', '哈哈大笑：「有看头！再来一合！」'],
    lose: ['啧了一声：「可惜，差着半口气。」', '在边上直跺脚：「稳住啊！别急着抢！」'] },
  yinzhi: { win: ['在墙角站着，慢悠悠道：「手上有东西。」', '眯着眼看：「他那一路，破绽在左肩。」'],
    lose: ['低笑了一声，没说话。', '抱着手看了一会儿，转身走了。'] },
  qienuo: { win: ['缩在人群后头，小声叫了个好。', '看得手心里全是汗：「打、打赢了……」'],
    lose: ['捂着嘴不敢出声。', '在旁边小声嘀咕：「我就说打不过的。」'] },
  xiayi: { win: ['朗声道：「漂亮！这才是正路数。」', '点头：「出手有分寸，难得。」'],
    lose: ['皱眉：「他不该这么急着进招。」', '叹了口气：「胜败常事，回去再练。」'] },
  youhua: { win: ['凑近了鼓掌：「哎哟，漂亮漂亮。」', '笑嘻嘻地：「我押对了，嘿嘿。」'],
    lose: ['撇撇嘴：「我就说嘛。」', '摇头晃脑：「这局输得可不冤。」'] },
  mune: { win: ['默默点了点头。', '看得很认真。'],
    lose: ['「……」', '把脸转到一边去了。'] },
  wenwan: { win: ['轻声说了句：「好身手。」', '在边上笑了一下，没出声。'],
    lose: ['轻轻叹了口气。', '把手里的帕子攥紧了。'] },
  baozhao: { win: ['扯着嗓子喊：「就这么打！压着他打！」', '拍着大腿：「痛快！」'],
    lose: ['在边上直嚷嚷：「起势！起势啊！」', '看得着急，把袖子都撸起来了。'] },
  lengmo: { win: ['看了两眼，走开了。', '没什么表情。'],
    lose: ['把手拢在袖子里，冷眼看着。', '「不过如此。」'] },
};

/** 挑几个看客，各给一句点评（不含参战双方，不含死了/晕了的/敌对的） */
function bystanderLines(world, npc, playerWin, limit) {
  const p = world.player;
  if (!p) return [];
  const personality = require('./personality');
  const involved = [p.id, npc && npc.id].filter(Boolean);
  const watchers = world.npcsIn(p.room)
    .filter(n => involved.indexOf(n.id) < 0 && !n.dead && !n.knockedOut && !n.inCombat
      && !(n.def || {}).hostile);
  if (!watchers.length) return [];
  const rng = world.rng;
  const cap = limit || 2;
  const picked = [];
  const pool = watchers.slice();
  /* 随机挑（用 rng，别用排序 —— 排序会让同一个人次次都是看客） */
  while (picked.length < cap && pool.length) {
    const i = rng ? rng.int(0, pool.length - 1) : 0;
    picked.push(pool.splice(i, 1)[0]);
  }
  const out = [];
  for (const w of picked) {
    const per = personality.personalityOf(w);
    const id = (per && per.id) || 'mune';
    const group = WATCH_LINES[id] || WATCH_LINES.mune;
    const arr = playerWin ? group.win : group.lose;
    const line = arr[(rng ? rng.int(0, arr.length - 1) : 0)];
    out.push({ kind: 'say', text: `（${w.name}${line}` });
  }
  return out;
}

/** NPC 之间偶尔切磋 —— 给世界一点活气。返回 lines（没发生就给空数组） */
function maybeNpcDuel(world) {
  const p = world.player;
  if (!p || world.battle) return [];
  const rng = world.rng;
  if (!rng || rng.next() > 0.06) return [];       /* 一进屋大约 6% 的概率撞见 */
  const able = world.npcsIn(p.room)
    .filter(n => !n.dead && !n.knockedOut && !n.inCombat && !(n.def || {}).hostile
      && !/狼|虎|熊|蛇|豹|兽|野猪|蟒|鹰|鳄|子$|童子|孩童/.test(n.name || ''));
  if (able.length < 2) return [];
  /* ⚠️ 第一版只挑「武人 tag」（swordsman/escort/constable…）——
     实测**全图没有任何一间屋子同时站两个**，这条永远触发不了。
     改成：有武人就优先挑武人，没有就挑两位有手有脚的街坊。
     武侠世界里街坊比划两下本来就不稀奇，不必非是镖师不可。 */
  const martial = able.filter(n => /swordsman|escort|constable|disciple|thief|soldier/.test(n.tag || ''));
  const here = martial.length >= 2 ? martial : able;
  const a = here[rng.int(0, here.length - 1)];
  let b = here[rng.int(0, here.length - 1)];
  if (b.id === a.id) b = here.filter(x => x.id !== a.id)[0];
  if (!b) return [];
  const personality = require('./personality');
  const perOf = n => (personality.personalityOf(n) || {});
  const ac = perOf(a), bc = perOf(b);
  const lines = [{ kind: 'story', text: `（${a.name}与${b.name}在空地上搭起了手。）` }];
  const winner = rng.next() < 0.5 ? a : b;
  const loser = winner === a ? b : a;
  lines.push({ kind: 'story', text: `两人拆了七八合，${winner.name}卖个破绽，把${loser.name}的手一带，那人就站不稳了。` });
  const wper = perOf(winner);
  lines.push({ kind: 'say', text: `（${winner.name}收了手${wper.say || '道'}：「承让。」）` });
  /* 输的那位嘴上不服 */
  const lper = perOf(loser);
  const grumble = {
    haoshuang: '「再来再来！这回不算。」', yinzhi: '「……你这一手，我记下了。」',
    qienuo: '「我、我本来就不行的。」', xiayi: '「好功夫，我回去再练。」',
    youhua: '「哎，手滑了手滑了。」', mune: '「……」',
    wenwan: '「是你厉害。」', baozhao: '「不算！再来！」', lengmo: '「嗯。」',
  }[(lper && lper.id) || 'mune'];
  lines.push({ kind: 'say', text: `（${loser.name}拍了拍身上的土${lper.say || '道'}：${grumble}）` });
  return lines;
}

module.exports = {
  MAX_PER_DAY, countToday, noteDuel, noteWin, canDuel,
  acceptLine, refuseLine, bystanderLines, maybeNpcDuel,
};
