/**
 * masterbond.js — 师门情谊：拜了师之后，那个「师父」得是个活人
 *
 * 现状（自拟清单 🅕）：`拜师` 只做了两件事 —— 往 `p.masters[mid]` 记一笔、
 * 让「请教」必定成功。于是「师父」本质上是一台**发放武学的机器**：
 * 你三年不登门、满身是血地站在他面前、或是在外头坏了名声，
 * 他都一个表情（没有表情）。
 *
 * 这个模块给师父**加四张嘴**（按紧要程度排序，一次只说一件）：
 *   ① **你带伤来** → 他先看伤（会真的给你上药：回血 + 好感）
 *   ② **你在外头坏了名声** → 他脸上挂不住，会训你
 *   ③ **你登门太少** → 他念叨（隔得越久那句越冷）
 *   ④ **你刚做成了事**（升位 / 创功 / 扬名）→ 他嘴上不夸，手上有表示
 *
 * 另外补一个指令：`请安 <师父>` —— 去给他请个安（好感 + 记录「来过」）。
 * 没有这个动作，「登门太少」那条就成了玩家永远无法应对的指责。
 */
'use strict';

const DAY = 1440;

/** 这一位是不是你的师父 */
function isMasterOf(p, npc) {
  if (!p || !npc || !p.masters) return false;
  const mid = npc.defId || npc.id;
  return !!(mid && p.masters[mid]);
}

/** 记一笔「今儿来过」 */
function touch(p, npc, world) {
  const mid = npc.defId || npc.id;
  if (!mid || !p.masters || !p.masters[mid]) return;
  p.masters[mid].lastSeen = world.clockMinutes || 0;
  p.masters[mid].calls = (p.masters[mid].calls || 0) + 1;
}

/** 隔了多少天没来请安（没记过就按拜师那天算） */
function daysAway(p, npc, world) {
  const mid = npc.defId || npc.id;
  const rec = p.masters[mid] || {};
  const last = rec.lastSeen != null ? rec.lastSeen : (rec.at || 0);
  return Math.floor(((world.clockMinutes || 0) - last) / DAY);
}

/**
 * 见面时师父会说的一句话。
 * @returns {{kind:string,text:string,effects?:Array}|null}
 */
function masterLine(world, p, npc) {
  if (!isMasterOf(p, npc) || !npc || npc.dead) return null;
  const mid = npc.defId || npc.id;
  const rec = p.masters[mid] || {};
  const now = world.clockMinutes || 0;
  /* 一天只说一件（换着说也行，但别一见面就连珠炮） */
  if (rec._saidAt && now - rec._saidAt < DAY) return null;

  const hurt = (p.hp || 0) < (p.maxHp || 1) * 0.6;
  const wanted = (p.kidnap && p.kidnap.wanted) || 0;
  const away = daysAway(p, npc, world);
  /* 「你最近做成了什么事」直接**问传闻系统**，不另开一本账：
     升位 / 创功 / 比试夺魁这几桩本来就会变成传闻（见 rumorfeed），
     师父听说了自然该有反应 —— 一处数据两处用，不会出现「系统没记、师父就装作不知道」。 */
  let good = null;
  try {
    const rf = require('./rumorfeed');
    const DEED = { rs_sect_promote: 'promote', rs_skill_fuse: 'fuse', rs_tournament_win: 'fame' };
    const hit = rf.aboutPlayer(world, 10).find(r => DEED[r.seedId]
      && (now - (r.bornDay || 0) * DAY) < DAY * 3 && rec._praisedUid !== r.uid);
    if (hit) good = { kind: DEED[hit.seedId], uid: hit.uid };
  } catch (e) { good = null; }

  /* ⚠️ 效果**就地生效**，不走 effects 管道 —— 这个函数的调用方（交谈）
     只负责把 text 插进日志，多一条 effects 契约就多一处会忘记消费的地方
     （铁律：只定义不消费 = 静默失效）。给了什么，text 里就写明白。 */
  const out = (text) => { rec._saidAt = now; return { kind: 'say', text }; };
  const favor = (delta, why) => {
    try { require('./social').addFavor(world, npc, delta * world.favorGainMult(p), why); } catch (e) { /* 好感失败不挡话 */ }
  };

  /* ① 带伤 —— 最要紧，先看伤（**真的**给你上药，不只是嘴上说） */
  if (hurt) {
    const heal = Math.max(1, Math.floor((p.maxHp || 100) * 0.25));
    p.hp = Math.min(p.maxHp || p.hp + heal, (p.hp || 0) + heal);
    favor(3, '照拂');
    return out(
      `${npc.name}一眼就看见你身上的伤，眉头皱起来：「跟我进来。」他拿了伤药替你把伤口裹上，` +
      `手劲重得很，一句话没说。（气血 +${heal}）`
    );
  }

  /* ② 坏了名声 —— 他脸上挂不住 */
  if (wanted >= 30) {
    const line = [
      `${npc.name}没让你进堂屋，只站在阶下看你：「你近来在外头做的事，我都听说了。」他顿了顿，「别报我的名字。」`,
      `${npc.name}把茶碗搁下，声音不高：「我教你的那些，是让你用来干这个的？」`,
    ][Math.abs(hash(mid + 'w')) % 2];
    return out(line);
  }

  /* ③ 久不登门 —— 隔得越久那句越冷 */
  if (away >= 40) {
    return out(`${npc.name}看了你半晌，才说：「你还记得这地方怎么走。」`);
  }
  if (away >= 15) {
    return out(`${npc.name}正在廊下打拳，见你来了没收势：「还知道回来。」`);
  }

  /* ④ 你刚做成了事 —— 嘴上不夸，手上有表示 */
  if (good) {
    /* 说的是**动词短语**（「升了位」），不是光秃秃的名词 ——
       写成「听你说了位子的来由」读着别扭，那是给自己看的数据，不是给人看的话。 */
    const gifts = { promote: '升了位', fuse: '创出一门新功夫', fame: '在比试里夺了头名' };
    const what = gifts[good.kind] || '做成了事';
    const silver = Math.round(30 + (rec.calls || 0) * 2);
    p.money = (p.money || 0) + silver;
    favor(6, '争气');
    rec._praisedUid = good.uid;   /* 同一桩事只夸一回 */
    return out(
      `${npc.name}听说你${what}，没接话，从袖里摸出几串钱塞给你：「省着使。」（得钱 ${silver}）`
    );
  }

  /* ⑤ 师徒之间的一句日常（按交情深浅分） */
  const fav = npc.favor || 0;
  if (fav >= 40) {
    return out(`${npc.name}把练功的木桩让给你：「再打一遍我看看。」`);
  }
  return out(`${npc.name}点了点头：「来了。」便不再说话。`);
}

/** 请安：一个明确可做的事，让「久不登门」有得解 */
function callOn(world, p, npc) {
  if (!isMasterOf(p, npc)) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}不是你的师父，用不着请安。` }] };
  }
  const mid = npc.defId || npc.id;
  const rec = p.masters[mid] || {};
  const today = Math.floor((world.clockMinutes || 0) / DAY);
  if (rec._callDay === today) {
    return { ok: false, lines: [{ kind: 'warn', text: `你今日已经给${npc.name}请过安了。` }] };
  }
  rec._callDay = today;
  touch(p, npc, world);
  const social = require('./social');
  const fr = social.addFavor(world, npc, 6 * world.favorGainMult(p), '请安');
  const first = !rec._greeted;
  rec._greeted = true;
  const lines = [
    {
      kind: 'story',
      text: first
        ? `你到廊下行了个礼。${npc.name}受了，问你这些日子都练了什么，又叮嘱了两句。`
        : `你照例来给${npc.name}请安。他应了一声，把手边的东西放下。`,
    },
  ];
  lines.push(...(fr.lines || []));
  /* 请安那天他也说一句（顺手把「久不来」的账清了） */
  const ml = masterLine(world, p, npc);
  if (ml) lines.push({ kind: 'say', text: ml.text });
  return { ok: true, lines };
}

function hash(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

module.exports = { isMasterOf, masterLine, callOn, touch, daysAway };
