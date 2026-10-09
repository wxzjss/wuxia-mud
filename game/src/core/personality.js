/**
 * personality.js — 性格系统 + 心情系统（第 5 批）
 *
 *  - 玩家 / NPC 都有性格（personality），不同性格说话方式不同
 *  - NPC 有心情（mood 0~100），事件加减，心情影响说话态度，极低则抑郁
 */
'use strict';

/** 性格定义：id → { name, say(说话动词), desc } */
const PERSONALITIES = {
  haoshuang: { name: '豪爽', say: '哈哈笑道', desc: '快人快语，义气为先' },
  yinzhi:   { name: '阴鸷', say: '冷哼道',   desc: '城府深沉，喜怒不形于色' },
  qienuo:   { name: '怯懦', say: '嗫嚅道',   desc: '胆小怕事，见风就躲' },
  xiayi:    { name: '侠义', say: '正色道',   desc: '路见不平，拔刀相助' },
  youhua:   { name: '油滑', say: '嘻嘻笑道', desc: '见人说人话，见鬼说鬼话' },
  mune:     { name: '木讷', say: '讷讷道',   desc: '老实巴交，不善言辞' },
  wenwan:   { name: '温婉', say: '柔声道',   desc: '温言软语，和气温婉' },
  baozhao:  { name: '暴躁', say: '瞪眼道',   desc: '一点就着，火爆脾气' },
  lengmo:   { name: '冷漠', say: '淡淡道',   desc: '事不关己，高高挂起' },
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
  PERSONALITIES, TAG_PERSONALITY, MOOD_TIERS,
  moodTier, personalityOf, personalityForTag, sayVerb, addMood, isDepressed,
};
