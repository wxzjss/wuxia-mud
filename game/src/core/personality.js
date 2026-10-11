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
/** 玩家没选性格时的默认值（创建角色界面会给选项，这是兜底） */
const PLAYER_DEFAULT = 'haoshuang';

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

/* ============================================================
 * 性格分类（四组）—— 主人 2026-10-10：「把性格分一下类」
 *
 * 分组不是给人看的标签：**陌生人见面的第一印象按「组」算**，组内再按个体特例微调。
 * 这么分是因为九种性格两两配对有 81 种，逐个写既写不细也背不下来；
 * 归成四组之后只需 10 条组间规矩 + 若干条点名特例，且每条都能写出具体的神态。
 *
 *  刚直（侠义/豪爽/暴躁）—— 直肠子，讲义气，也容易上头
 *  柔善（温婉/怯懦/木讷）—— 不争不抢，慢热，但记人好
 *  机巧（油滑/阴鸷）    —— 心里有本账，脸上不显
 *  冷僻（冷漠）         —— 谁也别来烦我
 * ============================================================ */
const PERSONA_GROUPS = {
  gangzhi: { id: 'gangzhi', name: '刚直', personas: ['xiayi', 'haoshuang', 'baozhao'] },
  roushan: { id: 'roushan', name: '柔善', personas: ['wenwan', 'qienuo', 'mune'] },
  jijiao: { id: 'jijiao', name: '机巧', personas: ['youhua', 'yinzhi'] },
  lengpi: { id: 'lengpi', name: '冷僻', personas: ['lengmo'] },
};

/* ============================================================
 * 画像语气（`portrait.voice.tone`）→ 性格
 *
 * 主人 2026-10-08 追问「npc 性格与其画像背景性格核对了吗」——核对了，**大面积对不上**：
 *   画像写「讷」的 55 人被哈希分成了温婉/怯懦，写「冷」的瞎眼老丐成了「豪爽」，
 *   写「泼」的成了「油滑」。
 * 画像的 tone 是**照人写的**（写手给这个人定的说话调子），比门派 / 身份 / 哈希那几层推断准得多，
 * 所以它是**最优先**的一层。表放在 core 而不是生成器里：播种与核对必须共用同一份映射，
 * 各写一份迟早会对不上（铁律：别名漂移靠注册表，不靠手抄）。
 * ============================================================ */
const TONE_PERSONA = {
  讷: 'mune',     // 说话笨、慢半拍
  冷: 'lengmo',   // 话里没温度
  油: 'youhua',   // 见人说人话
  泼: 'baozhao',  // 泼辣、刀子嘴
  傲: 'lengmo',   // 孤高自许，不屑与人多话
  痴: 'mune',     // 痴憨、一根筋
  酸: 'youhua',   // 嘴上不饶人的酸腐
  敬: 'wenwan',   // 恭敬、和气
  谦: 'wenwan',   // 谦退
};

/** 自由文本的 tone（画像是写手写的，不全是单字）——按关键词归类，顺序即优先级 */
const TONE_KW = [
  [/结巴|怯|怕|紧张|腿软/, 'qienuo'],
  [/秤|斟酌|谨慎|城府|数着|掂量|算计/, 'yinzhi'],
  [/没有语气|不带语气|平平|淡淡/, 'lengmo'],
  [/轻|柔|和气|软/, 'wenwan'],
  [/慢|低|顿/, 'mune'],
  /* ---- 2026-10-11 补：B/C 层批量补员（#112）后，画像 tone 的语汇一下子宽了，
     而上面五条只覆盖了「讷/冷/油/敬/谦」那一小撮写手的用词 —— 结果一大批人
     的 tone **归不了类**（返回 null），核对脚本只能跳过他们，等于没核对。
     这几条只加在**末尾**：前面五条priority 不变，老画像的判定一个字不动；
     新增的都落在「原本归不了类」的那批人身上，正是要补的那些。
     ⚠️ 词表与 tools/gen-portraits-bc.js 的 PERSONA_TONE 必须对得上：
     生成器按性格挑 tone 词，这里负责把它认回来 —— 两边一处改一处不改，
     就等于「写的时候是温婉、读的时候判不出来」。 */
  [/豪|爽|狂|笑骂/, 'haoshuang'],
  [/耿|正色|侠/, 'xiayi'],
  [/油|滑|世故/, 'youhua'],
  [/火爆|急躁|暴|躁|泼|硬|横|瞪/, 'baozhao'],
  [/阴/, 'yinzhi'],
  [/讷|钝/, 'mune'],
  [/冷淡|冷/, 'lengmo'],
  [/温|婉/, 'wenwan'],
];

/** 画像语气 → 性格 id（没画像 / 归不了类就返回 null，交给下一层） */
function personaFromVoice(who) {
  const t = who && who.portrait && who.portrait.voice && who.portrait.voice.tone;
  if (!t) return null;
  const s = String(t);
  if (TONE_PERSONA[s]) return TONE_PERSONA[s];
  for (const [re, pid] of TONE_KW) if (re.test(s)) return pid;
  return null;
}

/** 性格 id → 组 id（反查表） */const PERSONA_GROUP_OF = (() => {
  const m = {};
  for (const g of Object.values(PERSONA_GROUPS)) for (const p of g.personas) m[p] = g.id;
  return m;
})();

/**
 * ⚠️ 把相性表的键统一成「a|b 按字典序排好」。
 *   查表时用的是排序后的键（这样表天然对称），但写表的人不会记得
 *   `roushan|jijiao` 其实要写成 `jijiao|roushan` —— 一写反，那条规矩**永远查不到**，
 *   而查不到的表现是「沉默地没有反应」（不报错！），最难发现。
 *   所以不靠人守规矩，在这里统一收口。
 */
function normPairKeys(tbl) {
  const out = {};
  for (const k of Object.keys(tbl)) {
    const parts = k.split('|');
    if (parts.length !== 2) { out[k] = tbl[k]; continue; }
    out[parts.slice().sort().join('|')] = tbl[k];
  }
  return out;
}

/**
 * 组 × 组的初见相性。`delta` = 好感增减，`react` = 见了面各自什么神态。
 * 表是对称的（怎么看你，你就怎么看他），所以只写一半，取用时双向查。
 * ⚠️ 数值刻意压得小（±1~5）：这是**第一印象**，真正的好感靠相处赚。
 */
const GROUP_AFFINITY = normPairKeys({
  'gangzhi|gangzhi': { delta: 5, react: '你拱了拱手，他也一抱拳，两人都不绕弯子，三言两语就说到了痛快处。' },
  'gangzhi|roushan': { delta: 3, react: '你嗓门大了些，对方往后缩了缩，却也没恼，仍旧好声好气地应着。' },
  'gangzhi|jijiao': { delta: -3, react: '他脸上笑着，眼睛却在瞟你别处；你心里那点别扭说不上来。' },
  'gangzhi|lengpi': { delta: -2, react: '你热络地说了半句，对方只淡淡应了一声，那半句就哽在喉咙里。' },
  'roushan|roushan': { delta: 4, react: '两个都不高声，说的也都是闲话，倒越说越近。' },
  'roushan|jijiao': { delta: 1, react: '你老老实实答了话，他笑吟吟地接着，也不知哪句是真。' },
  'roushan|lengpi': { delta: -2, react: '你温声问了句好，对方没抬头，你只好把手收回袖子里。' },
  'jijiao|jijiao': { delta: -2, react: '两人都在笑，谁也没先交底，客气话在中间转了两圈。' },
  'jijiao|lengpi': { delta: -1, react: '你递过去一句热话，热话凉在了半空。' },
  'lengpi|lengpi': { delta: -3, react: '你看他一眼，他也看你一眼，然后各自把脸转开了。' },
});

/**
 * 点名特例（优先于组间规矩）。写的是**性格本身相冲相合**的地方，
 * 组规则覆盖不到的那些「名场面」都放这儿。
 */
const PAIR_AFFINITY = normPairKeys({
  'xiayi|yinzhi': { delta: -8, react: '你一眼就嫌他藏头露尾，他也嫌你多管闲事，话说不到三句就冷了场。' },
  'baozhao|baozhao': { delta: -6, react: '两句话没说完，两副嗓门就一起提了上来，谁也不肯先低。' },
  'haoshuang|haoshuang': { delta: 7, react: '他递过酒碗，你接过来一口闷了——不用问姓名，已经是朋友了。' },
  'haoshuang|lengmo': { delta: -4, react: '你笑着拍他肩膀，他把肩膀让开半寸，你的手落了空。' },
  'wenwan|baozhao': { delta: -4, react: '你还没把话说完，他已经吼了起来，你只好把话咽回去。' },
  'mune|mune': { delta: 3, react: '两个半天不说话的人，谁也没觉得尴尬，安静着反倒自在。' },
  'qienuo|baozhao': { delta: -3, react: '他嗓子一高，你肩膀就缩了，话在舌尖上打了个转又咽了。' },
  'youhua|mune': { delta: 2, react: '你一个人说着，他闷头听着，倒也没有不耐烦的意思。' },
  'xiayi|qienuo': { delta: 2, react: '你把声气放软了些，他抬头看你一眼，慢慢把背直了起来。' },
  'yinzhi|mune': { delta: -1, react: '你说着话，他讷讷地应；你猜不透他是没听懂，还是不想懂。' },
});

/** 实例或模板 → 性格 id。**永远给得出**：没设过就按身份 tag 兜底。 */
function personaIdOf(who) {
  if (!who) return 'mune';
  const raw = who.personality || (who.def && who.def.personality);
  if (raw && PERSONALITIES[raw]) return raw;
  return personalityForTag(who.tag || (who.def && who.def.tag));
}

/** 性格 id → 组 id（给不出就当归柔善：最不冒犯的一组） */
function groupOf(personaId) {
  return PERSONA_GROUP_OF[personaId] || 'roushan';
}

/** 组的中文名 */
function groupName(groupId) {
  return (PERSONA_GROUPS[groupId] && PERSONA_GROUPS[groupId].name) || '寻常';
}

/**
 * 两个人的初见相性。返回 `{ delta, react, key }`——delta 是双方好感各加减多少。
 * 查找顺序：点名特例 → 组间规矩 → 兜底 0（没规矩就是没感觉）。
 */
function affinityOf(aId, bId) {
  const x = aId || 'mune', y = bId || 'mune';
  const pair = [x, y].sort().join('|');
  let hit = PAIR_AFFINITY[pair];
  if (hit) return { delta: hit.delta, react: hit.react, key: pair, kind: 'pair' };
  const ga = groupOf(x), gb = groupOf(y);
  const gkey = [ga, gb].sort().join('|');
  hit = GROUP_AFFINITY[gkey];
  if (hit) return { delta: hit.delta, react: hit.react, key: gkey, kind: 'group' };
  return { delta: 0, react: '', key: gkey, kind: 'none' };
}

/** 心情档位 */
const MOOD_TIERS = [  { min: 85, name: '喜上眉梢' },
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

/**
 * 初见相性结算（玩家 ↔ NPC）：按两人性格给第一印象，好感 ±，并出神态。
 *
 * ⚠️ 同一个人**只结算一次**（记在 `player.vars.metPersona`）：
 *    不然玩家在客栈里进进出出，同一个掌柜要把那句神态说上十遍，比不说话还难受。
 * ⚠️ `social` 是懒 require —— personality 是底层模块，不能在加载期就拽上 social。
 *
 * @returns {null|{delta:number, key:string, lines:Array}} null = 不触发
 */
function meetAffinity(world, player, npc) {
  if (!world || !player || !npc || npc.isPlayer || !player.isPlayer) return null;
  player.vars = player.vars || {};
  const seen = player.vars.metPersona || (player.vars.metPersona = {});
  const key = npc.defId || npc.id;
  if (!key || seen[key]) return null;
  const aff = affinityOf(personaIdOf(player), personaIdOf(npc));
  seen[key] = 1;                       // 无论好恶，见过就记上
  if (!aff.delta || !aff.react) return null;
  const lines = [{ kind: 'story', text: aff.react }];
  try {
    const social = require('./social');
    const r = social.addFavor(world, npc, aff.delta, '初见');
    const fl = (r && r.lines || []).find(l => l.kind === 'favor');
    if (fl) lines.push(fl);
  } catch (e) { /* 好感结算失败不该拖垮这次见面 */ }
  return { delta: aff.delta, key: aff.key, lines };
}

module.exports = {
  PERSONALITIES, PLAYER_DEFAULT, TAG_PERSONALITY, MOOD_TIERS, TONE_SAY,
  PERSONA_GROUPS, PERSONA_GROUP_OF, GROUP_AFFINITY, PAIR_AFFINITY,
  TONE_PERSONA, TONE_KW, personaFromVoice,
  personaIdOf, groupOf, groupName, affinityOf, meetAffinity,
  moodTier, personalityOf, personalityForTag, sayVerb, sayVerbToned,
  catchphraseRate, catchphraseOf, addMood, isDepressed,
  voiceStyleSig, styleSpeak,
};
