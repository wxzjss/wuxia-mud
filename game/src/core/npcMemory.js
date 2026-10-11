/**
 * npcMemory.js — NPC 记着你（2026-10-11 自拟）
 *
 * 现在的好感是个数字，NPC 没有**记忆**：你答应他的事没做，下次见面他像没事人一样。
 * 这一块补的是「关系」—— 他记着你来过、记着你答应过什么、记着你多久没来。
 *
 * 四件事：
 *   ① **久别重逢**：隔得久了再见，他会提一句（隔得越久，那句话越重）
 *   ② **答应过的事**：你应下没办的，他记得，会问
 *   ③ **人情账**：你救过他 / 打过他 / 欠他钱，他都记
 *   ④ **你做过的大事**：杀过谁、救过谁 —— 相关的人听说了，对你的态度会变
 *
 * ⚠️ 记忆是**按 NPC 存**的（`npc.pstate.mem`，随存档走），不是全局表。
 * ⚠️ 每次只说**一件事**，且同一个人的「重逢话」一天最多一次 ——
 *    见面就翻旧账，那不叫记性，那叫唐僧。
 */
'use strict';

const DAY = 1440;

function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY) + 1; }

/** 取这个人的记忆袋（挂在 pstate 上，随档走） */
function memOf(npc) {
  if (!npc) return null;
  npc.pstate = npc.pstate || {};
  npc.pstate.mem = npc.pstate.mem || {};
  return npc.pstate.mem;
}

/** 记一笔（key 是事由，val 随便什么） */
function remember(npc, key, val) {
  const m = memOf(npc);
  if (!m) return;
  m[key] = Object.assign({ at: (val && val.at) || 0 }, val || {});
}

/** 忘掉（事情办完了） */
function forget(npc, key) {
  const m = memOf(npc);
  if (m) delete m[key];
}

function recall(npc, key) {
  const m = memOf(npc);
  return m ? m[key] || null : null;
}

/* ---------------- ① 久别重逢 ---------------- */

/** 隔了多久算「有些日子」—— 三天一小别，二十天一大别 */
const AWAY_TIERS = [
  { days: 40, say: ['{a}把你上下看了一遍，半晌才开口：「你可算回来了。」', '{a}手里的活停住了：「这些日子，你上哪儿去了？」'] },
  { days: 15, say: ['{a}点了点头：「有些日子没见你了。」', '{a}道：「我还当你把这地方忘了。」'] },
  { days: 4, say: ['{a}见是你，把手里的东西放下了：「前阵子没见着你。」'] },
];

/**
 * 重逢时该说什么。返回一行或 null。
 * @returns {{kind:'say'|'plain', text:string}|null}
 */
function reunionLine(world, npc) {
  const m = memOf(npc);
  if (!m) return null;
  const last = m._lastSeen ? m._lastSeen.at : null;
  const now = world.clockMinutes || 0;
  /* 一天最多念一次 */
  if (m._reunionAt && (now - m._reunionAt) < DAY) return null;
  m._lastSeen = { at: now };
  if (last === null) return null;                    // 头一回见，没什么好说的
  const away = Math.floor((now - last) / DAY);
  const tier = AWAY_TIERS.find(t => away >= t.days);
  if (!tier) return null;
  m._reunionAt = now;
  const seed = `${npc.defId || npc.id}|${away}`;
  return { kind: 'say', text: pickBy(tier.say, seed).replace(/\{a\}/g, npc.name) };
}

/* ---------------- ② 答应过的事 ---------------- */

/**
 * 记下你答应人家的事（玩家侧的账，挂 `p.promises`）。
 * 例：`promise(world, p, npc, 'pay_back', '还他三百文')`
 */
function promise(world, p, npc, key, what) {
  if (!p || !npc) return;
  p.promises = p.promises || {};
  const id = npc.defId || npc.id;
  (p.promises[id] = p.promises[id] || {})[key] = { what, at: world.clockMinutes || 0 };
}

function settled(p, npc, key) {
  if (!p || !p.promises || !npc) return false;
  const rec = p.promises[npc.defId || npc.id];
  if (!rec || !rec[key]) return false;
  delete rec[key];
  return true;
}

/** 他还记着你哪笔没还 */
function pendingPromise(world, p, npc) {
  if (!p || !p.promises || !npc) return null;
  const rec = p.promises[npc.defId || npc.id];
  if (!rec) return null;
  const keys = Object.keys(rec);
  if (!keys.length) return null;
  const k = keys[0];
  return { key: k, what: rec[k].what, days: Math.floor(((world.clockMinutes || 0) - rec[k].at) / DAY) };
}

/** 见面时他提起这件事（比重逢话优先 —— 欠着的事更该说） */
function promiseLine(world, p, npc) {
  const pend = pendingPromise(world, p, npc);
  if (!pend) return null;
  const m = memOf(npc);
  if (m && m._promiseAt && ((world.clockMinutes || 0) - m._promiseAt) < DAY) return null;
  if (m) m._promiseAt = world.clockMinutes || 0;
  const late = pend.days >= 7;
  const text = late
    ? `${npc.name}看见你，先问了一句：「${pend.what}——那事，你后来打听了没有？」`
    : `${npc.name}点点头：「${pend.what}。你记着就好。」`;
  return { kind: 'say', text };
}

/* ---------------- ③ 人情账 ---------------- */

/** 记一笔人情（正数是恩，负数是仇） */
function debt(world, p, npc, amount, why) {
  if (!npc) return;
  npc.pstate = npc.pstate || {};
  npc.pstate.debt = (npc.pstate.debt || 0) + amount;
  const m = memOf(npc);
  if (m) {
    m._debtLog = m._debtLog || [];
    m._debtLog.push({ amount, why, at: world.clockMinutes || 0 });
    if (m._debtLog.length > 12) m._debtLog.shift();
  }
}

/** 见面时他提不提这笔账（欠得多了会提） */
function debtLine(world, npc) {
  const d = (npc.pstate && npc.pstate.debt) || 0;
  if (Math.abs(d) < 20) return null;
  const m = memOf(npc);
  if (m && m._debtAt && ((world.clockMinutes || 0) - m._debtAt) < DAY * 2) return null;
  if (m) m._debtAt = world.clockMinutes || 0;
  return d > 0
    ? { kind: 'plain', text: `${npc.name}对你的脸色比旁人缓和些——你还记着欠他的那份情。` }
    : { kind: 'plain', text: `${npc.name}看你的眼神里有点东西，像是还没过去。` };
}

/* ---------------- ④ 你做过的大事 ---------------- */

const HEARD_GOOD = [
  '{a}说：「听说你在外头做了件好事。」',
  '{a}道：「你的事，前几日有人在这儿提过。」',
];
const HEARD_BAD = [
  '{a}往后退了半步，声音也低了些：「你……近来做的那些事，我听人说了。」',
  '{a}没接话，只把手拢进袖子里——你的事，看样子他听说了。',
];

/** 你做过的事，被这个人听说了（`p.fame` / `p.infamy` 是他听说的口径） */
/* ---------------- ③′ 他听说了**具体哪件事** ----------------
 *
 * `heardLine` 说的是「听说你很侠义」这种**泛泛**的印象；
 * 可真正让人心里一动的是有人当面把你那件事念出来
 * ——「外头有人传，说你在江南城把谁给结果了。」
 *
 * 与 rumorfeed 分工：那边负责**把事传出去**，这边负责**把话递到你脸上**。
 * ⚠️ 三条闸，全是防吵的：
 *   · 这条传闻在**他所在的地方**得有点热度（传都没传到，他凭什么知道）
 *   · 同一条传闻对他只说一次（`_saidRumor` 记 uid）
 *   · 两天最多说一回（`_rumorAt`）
 */
function rumorLine(world, npc) {
  const m = memOf(npc);
  if (!m) return null;
  const rf = require('./rumorfeed');
  const room = world.getRoom(npc.room);
  const region = room ? (room.region || '_wild') : null;
  const list = rf.aboutPlayer(world).filter(r => !region || (r.spread[region] || 0) >= 6);
  if (!list.length) return null;
  const r = list[0];
  if (m._saidRumor === r.uid) return null;
  const now = world.clockMinutes || 0;
  if (m._rumorAt && now - m._rumorAt < DAY * 2) return null;
  const text = world.fillRumorText(r);
  if (!text) return null;
  m._saidRumor = r.uid;
  m._rumorAt = now;
  /* 传闻原话自带「听说 / 听人说 / 风闻」的引子，可它是**写给旁观者看**的；
     嵌进「听见一句闲话，『……』」这种框里就成了「听见一句闲话，听人说……」——
     重复拗口。把它按**被引用**的形态收拾一下：去掉引子、去掉句末标点。 */
  const quoted = text.replace(/^(听人说|听说|听讲|风闻|据说|闻说|有传闻说)\s*/, '')
    .replace(/[。！？\s]+$/, '');
  const favor = npc.favor || 0;
  /* 三种口气按交情分：交情浅的人是「打探」，交情深的人是「替你着急」。 */
  const open = favor >= 40
    ? [`${npc.name}把你拽到一边，声音压得极低：「外头有人传——『${quoted}』。你跟我说实话，到底有没有这回事。」`,
      `${npc.name}左右看了看，才开口：「街上都在说一件事。『${quoted}』——我听着像你。」`]
    : (favor >= 10
      ? [`${npc.name}端茶的手顿了下：「近来外头有句话，说的是你——『${quoted}』。」`,
        `${npc.name}笑了笑，笑意没到眼里：「『${quoted}』——这话我听着耳熟，像在说你。」`]
      : [`${npc.name}打量你一眼，像在认人：「你就是那个『${quoted}』的？我当是个什么样的人物。」`,
        `${npc.name}随口似的问：「听见一句闲话，『${quoted}』——有这回事？」`]);
  return { kind: 'say', text: pickBy(open, (npc.defId || npc.id) + r.uid) };
}

function heardLine(world, npc, good) {
  const m = memOf(npc);
  if (!m || m._heardAt && ((world.clockMinutes || 0) - m._heardAt) < DAY * 3) return null;
  m._heardAt = world.clockMinutes || 0;
  const arr = good ? HEARD_GOOD : HEARD_BAD;
  return { kind: 'say', text: pickBy(arr, (npc.defId || npc.id) + good).replace(/\{a\}/g, npc.name) };
}

/* ---------------- 楼里那位客人（青楼接客的余波，主人 2026-10-11） ---------------- */

/**
 * 「上回在楼里那位客人」再见到你，是什么反应。
 *
 * 主人原话：「下次遇到该 npc 时屏幕上会显示该 npc 看到你后的调侃语气语言表情动作等表现」。
 * 判据只有一个：`npc.pstate.brothelMet`（接客那晚记在他身上的）。
 * 按性格分档说话；**同一人三天之内只说一回** —— 与 `heardLine` 同一套克制，
 * 不然他每转个身都要拿这事打趣你一次，很快就烦了。
 */
const BROTHEL_LINE = {
  haoshuang: [
    '{a}远远瞧见你，先笑出了声：「哟，这不是那晚那位？」话没说完自己先摆手，「罢了罢了，我不提。」',
    '{a}一把拍在你肩上，凑近了压着嗓子：「上回那壶酒，可还留着？」说完自己先乐了。',
  ],
  youhua: [
    '{a}凑过来挤了挤眼：「那晚的灯，可还亮着？」',
    '{a}绕着你转了半圈，笑嘻嘻道：「我就说看着眼熟。」',
  ],
  lengmo: [
    '{a}看了你一眼，点了个头便走过去了。走出去几步，才从鼻子里轻轻「嗯」了一声。',
    '{a}脚步没停，只把视线在你脸上停了半息，像什么都没想起。',
  ],
  yinzhi: [
    '{a}盯着你看了一会儿，嘴角动了动，一个字也没说。',
    '{a}在暗处站了站，等你走远，才把目光挪开。',
  ],
  wenwan: [
    '{a}一见是你，脸先红了，把头低下去，手里的帕子攥紧了些。',
    '{a}轻轻「呀」了一声，退开半步，又忍不住抬眼看了看你。',
  ],
  qienuo: [
    '{a}一撞见你，脚步就乱了，绕着道走，险些撞在廊柱上。',
    '{a}「啊」了一声，把手里的东西抱紧些，头埋得低低的。',
  ],
  mune: [
    '{a}张了张嘴，到底没说出什么，只把头埋得更低了些。',
    '{a}愣愣地看了你一会儿，忽然「哦」了一声，转身走了。',
  ],
  xiayi: [
    '{a}干咳一声，正色道：「那日之事，只当没有过。」说完自己先别开了眼。',
    '{a}抬手拦了你半句：「不必多说。」可让开时那半步，比平时慢。',
  ],
  baozhao: [
    '{a}啐了一口：「晦气。」话虽如此，眼睛却在你脸上没挪开。',
    '{a}瞪了你一眼，把袖子一甩。走出两步，又回头看了你一眼。',
  ],
};

function brothelLine(world, npc) {
  const met = npc && npc.pstate && npc.pstate.brothelMet;
  if (!met) return null;
  const m = memOf(npc);
  if (m && m._brothelAt && ((world.clockMinutes || 0) - m._brothelAt) < DAY * 3) return null;
  const pid = (() => {
    try { return require('./personality').personaIdOf(npc); } catch (e) { return 'mune'; }
  })();
  const arr = BROTHEL_LINE[pid] || BROTHEL_LINE.mune;
  if (m) m._brothelAt = world.clockMinutes || 0;
  return { kind: 'say', text: pickBy(arr, (npc.defId || npc.id) + (met.times || 0)).replace(/\{a\}/g, npc.name) };
}

/* ---------------- 总入口：见面时该说什么 ---------------- */

/**
 * 玩家与某人碰面时，他有没有话要提。**一次只说一件**（按要紧程度排序）。
 * @returns {Array<{kind,text}>} 0~1 行
 */
function greetLines(world, p, npc) {
  if (!p || !npc || npc.isPlayer) return [];
  /* 排序：欠着的事 > 人情账 > **具体的传闻** > 泛泛的印象 > 久别重逢
     （具体永远比笼统动人：先说「外头在传你那件事」，说不出、才退到「听说你很侠义」） */
  const cands = [
    /* 师父排在最前：师徒之间那点事，比外人嚼的舌根要紧（masterbond.js） */
    () => { try { return require('./masterbond').masterLine(world, p, npc); } catch (e) { return null; } },
    () => promiseLine(world, p, npc),
    () => debtLine(world, npc),
    /* 「楼里那位」排在传闻前面：那是一件**具体发生过的**事，比外头嚼的舌根近。
       ⚠️ 它就在**本文件**里（不是 work.js）—— 第一版写成 `require('./work').brothelLine`，
           `work` 上根本没有这个名字，于是这道候选**永远是 null**，
           表现为「接完客下次见面一点反应都没有」（测试当场抓到了）。 */
    () => brothelLine(world, npc),
    () => { try { return rumorLine(world, npc); } catch (e) { return null; } },
    () => ((p.karma || 0) > 30 ? heardLine(world, npc, true) : ((p.kidnap && p.kidnap.wanted > 20) ? heardLine(world, npc, false) : null)),
    () => reunionLine(world, npc),
  ];
  for (const f of cands) {
    let r = null;
    try { r = f(); } catch (e) { r = null; }
    if (r) return [r];
  }
  /* 没话可说也要记「见过」 */
  const m = memOf(npc);
  if (m && !m._lastSeen) m._lastSeen = { at: world.clockMinutes || 0 };
  return [];
}

function pickBy(arr, seed) {
  if (!arr || !arr.length) return '';
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return arr[(h >>> 0) % arr.length];
}

module.exports = {
  remember, forget, recall, memOf, promise, settled, pendingPromise, debt,
  greetLines, reunionLine, promiseLine, debtLine, heardLine, rumorLine, dayOf,
  brothelLine, BROTHEL_LINE,
};
