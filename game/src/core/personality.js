/**
 * personality.js — 性格系统 + 心情系统（第 5 批）
 *
 *  - 玩家 / NPC 都有性格（personality），不同性格说话方式不同
 *  - NPC 有心情（mood 0~100），事件加减，心情影响说话态度，极低则抑郁
 */
'use strict';

/** 性格定义：id → { id, name, say(说话动词), desc }
 *
 *  ⚠️ `id` 字段是 B7 补上的，**不可再删**。
 *     原来每条只有 { name, say, desc }，而所有调用方一律写 `per.id === 'qienuo'`
 *     —— `per.id` 恒为 undefined，于是**按性格分流的分支从来没进过**：
 *     怯懦的不会逃、侠义的不会出手，一律掉进「有武力 → 警惕」兜底。
 *     主人报的「不会来帮我，也不会惊呼逃跑」有一半正是这里造成的。 */
const PERSONALITIES = {
  haoshuang: { id: 'haoshuang', name: '豪爽', say: '哈哈笑道', desc: '快人快语，义气为先' },
  yinzhi: { id: 'yinzhi', name: '阴鸷', say: '冷哼道',   desc: '城府深沉，喜怒不形于色' },
  qienuo: { id: 'qienuo', name: '怯懦', say: '嗫嚅道',   desc: '胆小怕事，见风就躲' },
  xiayi: { id: 'xiayi', name: '侠义', say: '正色道',   desc: '路见不平，拔刀相助' },
  youhua: { id: 'youhua', name: '油滑', say: '嘻嘻笑道', desc: '见人说人话，见鬼说鬼话' },
  mune: { id: 'mune', name: '木讷', say: '讷讷道',   desc: '老实巴交，不善言辞' },
  wenwan: { id: 'wenwan', name: '温婉', say: '柔声道',   desc: '温言软语，和气温婉' },
  baozhao: { id: 'baozhao', name: '暴躁', say: '瞪眼道',   desc: '一点就着，火爆脾气' },
  lengmo: { id: 'lengmo', name: '冷漠', say: '淡淡道',   desc: '事不关己，高高挂起' },
};

/** 按身份 tag 默认分配性格（数据播种用） */
const TAG_PERSONALITY = {
  swordsman: 'xiayi', doctor: 'wenwan', beggar: 'youhua', innkeeper: 'haoshuang',
  taoist: 'mune', monk: 'mune', commoner: 'mune', vendor: 'youhua', scholar: 'wenwan',
  farmer: 'mune', smith: 'haoshuang', waiter: 'youhua', merchant: 'youhua', richman: 'lengmo',
  constable: 'xiayi', official: 'lengmo', eunuch: 'yinzhi', thief: 'youhua',
  courtesan: 'wenwan', madam: 'youhua', hunter: 'haoshuang', escort: 'xiayi',
  gambler: 'youhua', actor: 'youhua', boatman: 'mune', nun: 'wenwan', child: 'haoshuang',
  refugee: 'qienuo', groom: 'mune', palace: 'lengmo', consort: 'wenwan', singer: 'wenwan',
  waiter2: 'youhua',
};

/** 心情档位 */
const MOOD_TIERS = [
  { min: 85, name: '喜上眉梢' },
  { min: 65, name: '心情愉悦' },
  { min: 40, name: '心平气和' },
  { min: 20, name: '心情低落' },
  { min: 5, name: '郁郁寡欢' },
  { min: -Infinity, name: '万念俱灰' },
];

function moodTier(mood) {
  const m = mood === undefined ? 50 : mood;
  return MOOD_TIERS.find(t => m >= t.min);
}

/** 取性格定义（实例优先，退回模板） */
function personalityOf(npc) {
  const p = npc && (npc.personality || (npc.def && npc.def.personality));
  return PERSONALITIES[p] || null;
}

/** 按身份 tag 取默认性格 id */
function personalityForTag(tag) {
  return TAG_PERSONALITY[tag] || 'mune';
}

/** 说话动词：性格决定语气，心情极低则抑郁消沉 */
function sayVerb(npc) {
  const per = personalityOf(npc);
  const mood = npc && npc.mood !== undefined ? npc.mood : 50;
  if (mood <= 5) return '万念俱灰，喃喃道';
  if (mood <= 20) return '有气无力道';
  return per ? per.say : '道';
}

/** 画像腔调 → 说话动词覆盖表（规格书 §4.2）
 *  职责切分：personality 管「怎么开口」，voice.tone 管「说什么话」，二者正交。
 *  只有 敬 / 泼 / 酸 三种 tone 会顶掉 personality 的动词。 */
const TONE_SAY = { 敬: '躬身道', 泼: '叉腰道', 酸: '阴阳怪气道' };

/** 带画像腔调的说话动词。
 *  心情 ≤ 20 时心情覆盖一切 —— 直接走原 sayVerb（有气无力道 / 万念俱灰，喃喃道），
 *  现有 sayVerb 的行为一个字都没改。 */
function sayVerbToned(npc) {
  const mood = npc && npc.mood !== undefined ? npc.mood : 50;
  if (mood <= 20) return sayVerb(npc);
  const tone = npc && npc.portrait && npc.portrait.voice && npc.portrait.voice.tone;
  if (tone && TONE_SAY[tone]) return TONE_SAY[tone];
  return sayVerb(npc);
}

/** 画像口头禅露出概率（规格书 §3.4 L1）：A 层 30%，B 层 15%，C 层不露 */
function catchphraseRate(npc) {
  const tier = npc && npc.portrait && npc.portrait.tier;
  if (tier === 'A') return 0.3;
  if (tier === 'B') return 0.15;
  return 0;
}

/** 取画像口头禅（没有画像或没写口头禅则返回 null） */
function catchphraseOf(npc) {
  const v = npc && npc.portrait && npc.portrait.voice;
  return v && v.catchphrase ? v.catchphrase : null;
}

/* ------------------------------------------------------------------ *
 * 画像 voice.style → 句式（任务三：让「说话风格影响台词句式」，不是加前缀词）
 *
 *   voice.style 是自由文本（写手写给写手看的），这里用**显式关键词**归类到 4 种句式签名
 *   ——判据只用 style 文本里的固定说法，不扫 desc/name（B8 之 BLK-2 教训）。顺序即优先级。
 *   归类不到的返回 null（原样说话）——宁可不动，也不硬套。
 * ------------------------------------------------------------------ */
function voiceStyleSig(npc) {
  const s = String((npc && npc.portrait && npc.portrait.voice && npc.portrait.voice.style) || '');
  if (!s) return null;
  if (/说两遍|说三遍|两遍|三遍|复述|重复|重说/.test(s)) return 'repeat';
  if (/留一半|留半分|留三分|绕|岔开|转开|躲开|含糊|敷衍|打哈哈|欲言又止|咽了回去|笑而不答|不正面|不正面回答/.test(s)) return 'evasive';
  if (/话少|话极少|话不多|三字一句|短句|一句顶三句|答半句|答三个字|一句一顿|一字一句|只说|只把/.test(s)) return 'terse';
  if (/慢|沉吟|斟酌|分三段|顿了顿|顿一下/.test(s)) return 'slow';
  return null;
}

/** 按句式签名改造一句台词（**改句子结构本身**，不是加前缀词）。
 *   · terse  话少：多小句→只留第一小句（单小句本就够短，原样返回）
 *   · evasive 绕：截到第一个停顿，把后半句咽回去（……）
 *   · repeat 复述：整句重说一遍（画像写明「一句话说两遍/三遍」的才是它）
 *   · slow   慢：在第一个停顿处插一个「顿了顿」的小顿（无逗号就落在句末）
 *  改造后与原文相同 → 原样返回（保证不产生无意义的改写）。 */
function styleSpeak(npc, text) {
  const sig = voiceStyleSig(npc);
  const t = String(text == null ? '' : text);
  if (!sig || !t) return t;
  const firstClause = t.match(/^.*?[，。！？；]/);
  switch (sig) {
    case 'repeat':
      return t + '……' + t;
    case 'evasive':
      return (firstClause ? firstClause[0] : t) + '……';
    case 'slow': {
      const i = t.search(/[，；]/);
      if (i >= 0) return t.slice(0, i) + '，他顿了顿，' + t.slice(i + 1);
      return t.replace(/[。！？]$/, '') + '，他顿了顿。';
    }
    case 'terse': {
      const parts = t.split(/(?<=[，。！？；])/).filter(Boolean);
      return parts.length > 1 ? parts[0] : t;
    }
    default:
      return t;
  }
}

/** 改心情（0~100），返回变化后的档位 */
function addMood(npc, delta) {
  npc.mood = Math.max(0, Math.min(100, (npc.mood === undefined ? 50 : npc.mood) + delta));
  return { mood: npc.mood, tier: moodTier(npc.mood) };
}

/** 心情是否极低（抑郁） */
function isDepressed(npc) {
  return npc && npc.mood !== undefined && npc.mood <= 5;
}

module.exports = {
  PERSONALITIES, TAG_PERSONALITY, MOOD_TIERS, TONE_SAY,
  moodTier, personalityOf, personalityForTag, sayVerb, sayVerbToned,
  catchphraseRate, catchphraseOf, addMood, isDepressed,
  voiceStyleSig, styleSpeak,
};
