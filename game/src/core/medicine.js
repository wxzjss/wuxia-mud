/**
 * medicine.js — 医术闭环
 *
 * 【为什么有这个文件】
 * 项目待办里挂着一条：「医术类武学无战斗外消费点」——
 * `基本医术`（`basic_medicine`）在 `character.js` 的槽位表里占着一格，
 * 玩家花钱花时间学会了，却发现**任何地方都用不上**。功法树里它是个死枝。
 *
 * 这里给它三条出口，凑成一个最小闭环：
 *   ① 诊脉 —— 看清目标身上有什么（伤/毒/还剩多少底子），不消耗，不入药
 *   ② 疗伤 —— 耗内力与时辰，把气血拉回来（自己 / 同屋的人）
 *   ③ 解毒 —— 揭掉一层负面状态（毒 / 迷 / 暗伤）
 *
 * 顺带把「替人治伤」接进现成的社交账：治好一个人涨好感；碰上出得起钱的还会给诊金。
 *
 * 【为什么效果不跟等级走】
 * 本项目已经**去等级化**（`level` 是残留字段，见伤害公式那条血泪）。
 * 医术的深浅按「基本医术的熟练度 + 内功火候」算 —— 内力是医者的底气，
 * 光背汤头歌治不了内伤。而且一次疗伤**有上限**，不许一次把人拉满。
 */
'use strict';

const MED_ID = 'basic_medicine';
const HEAL_MIN = 20;        // 一次疗伤耗掉的游戏时间（分钟）
const MP_RATIO = 0.08;      // 耗内力：按上限的比例（下限 8 点）
const MP_FLOOR = 8;
const DETOX_MIN = 15;

/** 会不会医术：学过《基本医术》就行（不要求挂在身上） */
function levelOf(ch) {
  const l = ch && ch.learned && ch.learned[MED_ID];
  return (l && l.level) || 0;
}
function hasMedicine(ch) { return levelOf(ch) > 0; }

/** 医术功力：基本医术熟练度 + 内功火候的三分之一 */
function power(ch) {
  const ng = ch.equippedSkills && ch.equippedSkills['内功'];
  const ngLv = (ng && ch.learned[ng] && ch.learned[ng].level) || 0;
  return Math.floor(levelOf(ch) + ngLv / 3);
}

/**
 * 一次能补回多少气血。
 * 🔴 **有硬上限**：一次最多补掉目标气血上限的 35% —— 医者是治伤，不是重造一个人。
 *    （本项目在数值上吃过「一把拉满」的亏：`level` 那个二次爆炸的伤害公式就是。）
 */
function healAmount(ch, target) {
  const t = target || ch;
  const raw = Math.floor(power(ch) * 0.6) + 10;
  const cap = Math.max(8, Math.floor((t.maxHp || 100) * 0.35));
  return Math.min(Math.max(8, raw), cap);
}
function mpCost(ch) {
  return Math.max(MP_FLOOR, Math.ceil((ch.maxMp || 50) * MP_RATIO));
}

/** 身上有没有能解的东西 —— 毒 / 迷 / 暗伤三类 */
const BAD = [/毒/, /迷/, /暗伤/, /内伤/, /伤$/];
function badBuffs(ch) {
  return (ch.buffs || []).filter(b => {
    const s = String(b.name || '') + '|' + String(b.tag || '');
    return BAD.some(re => re.test(s));
  });
}

function who(ch, target) {
  if (!target || target === ch) return '你';
  return target.name || '那人';
}

/* ------------------------------------------------------------------ *
 *  ① 诊脉
 * ------------------------------------------------------------------ */
function diagnose(world, ch, target) {
  target = target || ch;
  const isSelf = target === ch;
  const me = isSelf ? '你' : (target.name || '他');
  const nm = isSelf ? '你' : (target.name || '他');

  const lines = [{ kind: 'title', text: `【诊脉】${nm}` }];
  const hpPct = Math.round(((target.hp || 0) / Math.max(1, target.maxHp || 1)) * 100);
  lines.push({
    kind: 'plain',
    text: `${nm}的气血 ${Math.round(target.hp || 0)}/${Math.round(target.maxHp || 1)}（${hpPct}%）` +
      (isSelf ? '' : `，内力 ${Math.round(target.mp || 0)}/${Math.round(target.maxMp || 1)}`),
  });

  const bad = badBuffs(target);
  if (bad.length) {
    lines.push({ kind: 'warn', text: `脉象里有东西：${bad.map(b => b.name + (b.turns ? `（还剩 ${b.turns} 息）` : '')).join('、')}。` });
  } else {
    lines.push({ kind: 'plain', text: '脉息匀净，没染上什么毒物迷药。' });
  }

  /* 医者的判断：说人话，别报数字 */
  const p = power(ch);
  let verdict;
  if (hpPct >= 95) verdict = '底子是全的，不用用药。';
  else if (hpPct >= 60) verdict = '带着些伤，将养几日也能好，用药快些。';
  else if (hpPct >= 30) verdict = '伤得不轻，气血亏了一大截，得尽快理一理。';
  else verdict = '气息已经很弱了，再拖下去要出人命。';
  if (bad.length) verdict += '至于那毒，须得先拔出来，否则补多少漏多少。';

  lines.push({ kind: 'plain', text: verdict });
  if (!isSelf) {
    lines.push({
      kind: 'hint',
      text: p >= 60
        ? '（以你的手段，这一身伤治得下来。）'
        : '（你的医术还浅，重些的伤未必接得住 —— 多练练《基本医术》。）',
    });
  }
  return { ok: true, lines };
}

/* ------------------------------------------------------------------ *
 *  ② 疗伤
 * ------------------------------------------------------------------ */
function heal(world, ch, target) {
  target = target || ch;
  const isSelf = target === ch;
  const nm = isSelf ? '你' : (target.name || '他');

  if (!isSelf && (target.dead || target.knockedOut)) {
    /* 倒地的人也能救 —— 但得先把他叫醒是不可能的，这里只处理「还没死透」的 */
  }
  const maxHp = Math.max(1, target.maxHp || 1);
  if ((target.hp || 0) >= maxHp) {
    return { ok: false, lines: [{ kind: 'plain', text: `${nm}气血是满的，用不着你动手。` }] };
  }
  const cost = mpCost(ch);
  if ((ch.mp || 0) < cost) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `你内力不济（要 ${cost} 点，你只剩 ${Math.round(ch.mp || 0)} 点）—— 医术也是要内力撑的。` },
        { kind: 'hint', text: '（先打坐回一回内力，或者去「吐纳」。）' },
      ],
    };
  }

  const amount = healAmount(ch, target);
  ch.mp = Math.max(0, (ch.mp || 0) - cost);
  const before = target.hp || 0;
  target.hp = Math.min(maxHp, before + amount);
  const gained = Math.round(target.hp - before);
  if (world.advanceTime) world.advanceTime(HEAL_MIN);

  const p = power(ch);
  const lines = [];
  lines.push({
    kind: 'story',
    text: isSelf
      ? '你寻了个稳妥的坐处，先替自己推宫过血，把散了的气一寸寸收拢回去。'
      : `你让${nm}坐稳，搭住他的脉门，顺着伤处把淤住的气一点点导开。`,
  });
  if (gained <= 0) {
    lines.push({ kind: 'plain', text: `（这一趟没见什么起色 —— 你的医术还压不住这样的伤势。）` });
  } else {
    lines.push({
      kind: 'sys',
      text: `气血 +${gained}（现 ${Math.round(target.hp)}/${Math.round(maxHp)}），你耗去内力 ${cost} 点。`,
    });
  }
  if (p < 40) lines.push({ kind: 'hint', text: '（医术越深，一次拉回来的越多。多练《基本医术》，内力也别落下。）' });

  /* 治的是别人 → 记账：好感 + 诊金 */
  if (!isSelf && target.name) {
    try {
      const social = require('./social');
      const fr = social.addFavor(world, target, 3, '替他疗伤');
      if (fr && fr.lines && fr.lines.length) lines.push(...fr.lines);
    } catch (e) { /* 记不上不该挡着看病 */ }
    /* 出得起钱的会给诊金（钱本来就在他身上，这叫「营生」） */
    const rich = target.carry && (target.carry.money || 0) > 200;
    if (rich) {
      const fee = Math.min(60, Math.max(10, Math.round(amount * 1.5)));
      target.carry.money -= fee;
      ch.money = (ch.money || 0) + fee;
      lines.push({ kind: 'favor', text: `${nm}摸出 ${fee} 文塞给你：「先生辛苦。」` });
    }
  }
  return { ok: true, lines };
}

/* ------------------------------------------------------------------ *
 *  ③ 解毒
 * ------------------------------------------------------------------ */
function detox(world, ch, target) {
  target = target || ch;
  const isSelf = target === ch;
  const nm = isSelf ? '你' : (target.name || '他');
  const bad = badBuffs(target);
  if (!bad.length) {
    return { ok: false, lines: [{ kind: 'plain', text: `${nm}身上没有要解的东西。` }] };
  }
  const cost = mpCost(ch);
  if ((ch.mp || 0) < cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `内力不够（要 ${cost} 点）—— 拔毒比疗伤更费气力。` }] };
  }
  /* 医术浅的人拔不干净：一次只揭一层 */
  const sorted = bad.slice().sort((a, b) => (a.turns || 99) - (b.turns || 99));
  const one = sorted[0];
  const p = power(ch);
  ch.mp = Math.max(0, (ch.mp || 0) - cost);
  target.removeBuff ? target.removeBuff(one.name) : (target.buffs = (target.buffs || []).filter(b => b !== one));
  if (world.advanceTime) world.advanceTime(DETOX_MIN);

  const lines = [
    {
      kind: 'story',
      text: isSelf
        ? '你封住腕上几处要穴，把那股不对劲的东西逼到指尖，破了一小口放出去。'
        : `你按住${nm}的脉门，就着伤口把毒一点点往外引。`,
    },
    { kind: 'sys', text: `解去「${one.name}」，耗内力 ${cost} 点。` },
  ];
  const rest = badBuffs(target);
  if (rest.length) {
    const many = rest.length;
    lines.push({
      kind: 'plain',
      text: p >= 120
        ? `还剩 ${many} 样没清 —— 再来一次就差不多了。`
        : `还剩 ${many} 样。你的医术还浅，一次只能揭一层。`,
    });
  } else {
    lines.push({ kind: 'plain', text: '脉息回匀了，这口气总算顺过来。' });
  }
  if (!isSelf && target.name) {
    try {
      const social = require('./social');
      const fr = social.addFavor(world, target, 4, '替他解毒');
      if (fr && fr.lines && fr.lines.length) lines.push(...fr.lines);
    } catch (e) { /* ignore */ }
  }
  return { ok: true, lines };
}

module.exports = {
  MED_ID, hasMedicine, levelOf, power, healAmount, mpCost,
  diagnose, heal, detox, badBuffs,
};
