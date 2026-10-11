/**
 * season.js — 二十四节气（2026-10-11 自拟）
 *
 * 时间现在只是个计数器：有昼夜、有少数几个节庆，但**没有「一年」的感觉**。
 * 二十四节气是中国人过日子最实在的那根尺子 —— 什么时候下种、什么时候腌菜、
 * 什么时候该回家。有了它，玩家待得久了会有「时节在走」的感觉。
 *
 * 每个节气配一句**这一天该有的样子**（不是解释节气是什么，是写那天的人）。
 * 每 15 天一个节气，一年 24 个，循环。
 */
'use strict';

const DAY = 1440;
function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY) + 1; }

/* 一天一句「这天该有的样子」。写法上贴着日子，不写节气释义。 */
const TERMS = [
  { name: '立春', line: '城里人今日咬春，家家买了萝卜，嚼得满街都是脆响。' },
  { name: '雨水', line: '一早就落雨，檐下挂起水线。挑担子的都不出门了，坐着看天。' },
  { name: '惊蛰', line: '今日不打雷。老人说醒来早的虫子没听着，今年虫会少些。' },
  { name: '春分', line: '日头与夜一样长。有人在门口立了鸡蛋，真立住了。' },
  { name: '清明', line: '上坟的人成群往城外去，路边纸钱灰一阵一阵。' },
  { name: '谷雨', line: '雨下了一整天，田里下了种。有人一身泥回来，进门先笑。' },
  { name: '立夏', line: '有人在秤上称了称自己，说是要看看这一夏要瘦几斤。' },
  { name: '小满', line: '麦子灌了浆，风一过就哗哗地响。看麦的老汉在田埂上睡着了。' },
  { name: '芒种', line: '忙得脚不沾地，连酒铺都关了半天门，伙计全下地了。' },
  { name: '夏至', line: '一年里日头最长的一天。日头毒，井边排着队打水。' },
  { name: '小暑', line: '热得睡不着，半夜还有人坐在门口摇扇子。' },
  { name: '大暑', line: '今日最热。有人把西瓜吊进井里，说凉了再提上来。' },
  { name: '立秋', line: '今日贴秋膘。肉铺的案板从早到晚没空过。' },
  { name: '处暑', line: '暑气退了。晚上有人搬着竹榻出来，躺着看星星。' },
  { name: '白露', line: '清早草叶上一层白。走一趟，鞋面就湿了。' },
  { name: '秋分', line: '秋色正好分了两半。有人在院里摆了酒，说要趁着月色喝。' },
  { name: '寒露', line: '露水凉了，赶早的人把手拢在袖子里，说话也短了。' },
  { name: '霜降', line: '一早下霜，瓦上一层白。卖炭的挑着担子在街口等着。' },
  { name: '立冬', line: '今日吃饺子。铺子前排队的人一直排到巷口。' },
  { name: '小雪', line: '落了些雪，落地上就化了。有孩子伸着手去接。' },
  { name: '大雪', line: '雪下得厚了，屋檐底下挂起了冰凌。' },
  { name: '冬至', line: '一年里夜最长。谁家都在煮东西，热气顺着门缝往外冒。' },
  { name: '小寒', line: '冷得厉害。街上的人走得都快，谁也不站着说话。' },
  { name: '大寒', line: '今日最冷。有人蹲在墙根晒太阳，一动不动，像块石头。' },
];

const PERIOD = 15;   // 一个节气十五天

/** 今天是什么节气 */
function termOf(world) {
  const d = dayOf(world);
  const idx = Math.floor((d - 1) / PERIOD) % TERMS.length;
  const t = TERMS[idx];
  return { id: idx, name: t.name, line: t.line, dayInTerm: ((d - 1) % PERIOD) + 1 };
}

/** 换节气那天才说的那句（平时不重复念） */
function termLine(world) {
  const t = termOf(world);
  if (t.dayInTerm !== 1) return null;
  return { kind: 'plain', text: `【${t.name}】${t.line}` };
}

/** 节气的当令之物（给 NPC 日常用：这一天该吃什么做什么） */
const SEASON_ACT = {
  立春: '咬春', 清明: '上坟', 端午: '挂艾', 夏至: '打水', 立秋: '贴秋膘',
  立冬: '吃饺子', 冬至: '煮汤', 大寒: '晒太阳',
};

function seasonVerb(world) {
  const t = termOf(world);
  return SEASON_ACT[t.name] || null;
}

module.exports = { termOf, termLine, seasonVerb, TERMS, PERIOD, dayOf };
