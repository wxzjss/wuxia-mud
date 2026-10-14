/**
 * commands.js — 指令系统
 *
 * 高自由度：
 *  - 所有指令都在这里注册，mod 可通过 customCommands 添加新指令
 *  - 支持中英文混用、指令缩写、模糊匹配
 */
'use strict';

const { tokenize, fuzzyFind, clamp, fmtTime, shichen, stars } = require('./utils');
const { evalCond, evalEffects, evalTemplate, flagGateCond, onceHidden } = require('./modapi');
/* 武学重制（R2）：激活绑定的槽位→基础武学对照表，与角色侧的 effectiveMax 同一套口径 */
const { SLOT_ROOT, STANDALONE_MAX } = require('./character');
const social = require('./social');
const marriage = require('./marriage');
const kinship = require('./kinship');
const homeMod = require('./home');
const workMod = require('./work');
const gather = require('./gather');
const farm = require('./farm');
const personality = require('./personality');
/* B11：第三人称人称代词 / 性别的**单一入口**（他/她/它、男/女/不明）。
   全仓按性别渲染人称的地方一律走这里，别各自 `female?'女':'男'` 兜底。 */
const { pronounOf, genderNoun } = require('./pronouns');
const sectFounder = require('./sectFounder');
const estateMod = require('./estate');
const kidnapMod = require('./kidnap');
const auctionMod = require('./auction');
const cultureMod = require('./culture');
const treasuryMod = require('./treasury');
const artsMod = require('./arts');
const neigongMod = require('./neigong');
const tutorialMod = require('./tutorial');
/* 阶段解析 / 目标判定的**唯一**实现（面板、自动检查、交任务三处共用一份） */
const queststage = require('./queststage');
const potential = require('./potential');
/* 驿站渡口行路网络（design/89 §七·补）：行路的唯一判定与执行
   （flight 已物理删除：空投语义下线 + 无任何调用点，见 engine.js 头注释） */
const travel = require('./travel');

/* 中文数字 → 阿拉伯 */
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 壹: 1, 贰: 2, 叁: 3, 肆: 4, 伍: 5, 陆: 6, 柒: 7, 捌: 8, 玖: 9, 拾: 10 };
function cnNum(s) {
  if (!s) return NaN;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (CN_NUM[s] !== undefined) return CN_NUM[s];
  // 十二 / 三十 / 二十四
  const m = String(s).match(/^([一二两三四五六七八九])?十([一二三四五六七八九])?$/);
  if (m) return (m[1] ? CN_NUM[m[1]] : 1) * 10 + (m[2] ? CN_NUM[m[2]] : 0);
  return NaN;
}

/* ============================================================
 * 物品类型 / 装备属性的**中文名**（唯一一份）
 *
 * 🔴 为什么单拎出来：`describeItem`（「细看 <物品>」「看 <物品>」）里一直在调
 *    `typeCN(d.type)` / `statCN(k)` —— 而这两个函数**全仓从来没定义过**。
 *    于是「任何带 `type` 的物品，一点细看就 ReferenceError」，
 *    被引擎的 catch 兜住、只在控制台留一行「指令异常」：
 *    玩家那边看到的是「点了没反应」。全库带 type 的物品有 190 件。
 *    （engine.js 里另有一份同样的字面量表，是给 mod 制作器下拉框用的 ——
 *      两份就是漂移的开始，现在 engine 那份改成引用这里。）
 * ============================================================ */
const ITEM_TYPE_CN = {
  weapon: '武器', armor: '防具', helmet: '头饰', boots: '鞋履', gloves: '手套',
  necklace: '颈饰', ring: '戒指', cloak: '披风', shield: '副手', accessory: '饰品',
  consumable: '丹药', food: '食物', herb: '药材', material: '材料', book: '书籍',
  quest: '任务物品', tool: '工具', container: '容器', treasure: '珍宝', misc: '杂物',
};
const EQUIP_STAT_CN = {
  atk: '攻击', def: '防御', dodge: '闪避', parry: '招架', speed: '速度',
  maxHp: '气血', maxMp: '内力', critRate: '暴击率', lifesteal: '吸血',
  reflect: '反伤', armorPen: '破防',
};
/** 英文类型 → 中文；认不出来就原样返回（**绝不返回 undefined**，否则面板上会出现「（undefined）」） */
function typeCN(t) { return ITEM_TYPE_CN[t] || String(t == null ? '' : t); }
function statCN(k) { return EQUIP_STAT_CN[k] || String(k == null ? '' : k); }

const DIRECTIONS = {
  n: 'n', s: 's', e: 'e', w: 'w', u: 'u', d: 'd', ne: 'ne', nw: 'nw', se: 'se', sw: 'sw',
  北: 'n', 南: 's', 东: 'e', 西: 'w', 上: 'u', 下: 'd', 北东: 'ne', 东北: 'ne', 西北: 'nw', 西南: 'sw', 东南: 'se',
  north: 'n', south: 's', east: 'e', west: 'w', up: 'u', down: 'd',
  出门: 'out', 进: 'in', 入: 'in', 外: 'out',
};
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下', ne: '东北', nw: '西北', se: '东南', sw: '西南', in: '内', out: '外' };

/* ------------------------------------------------------------------ *
 * 「看人」的两个共用口径 —— **模块顶层**（不是 buildCommands 的闭包内）
 *
 * 为什么要搬到顶层：`skillTierCN` / `npcInsight` 以前写在 buildCommands 内部，
 * 外面拿不到。而 NPC 详情面板（`engine.npcProfileOf`）与武学面板（`ui.js`）
 * 都要显示「他这门练到第几层」「交情够不够看透」——
 * 拿不到就会各自**再实现一遍**，迟早和「看」这条指令漂移
 * （本项目老毛病：同一件事两份实现，改一处忘一处）。
 * 搬到顶层 + 从 `__api` 导出，全项目只有一个口径。
 * ------------------------------------------------------------------ */
/** 看透别人武功到第几层：要靠交情。陌生人是看不出来的。 */
function npcInsight(npc) {
  const favor = npc.favor || 0;
  const trust = (npc.pstate && npc.pstate.trust) || 0;
  /* 打过交道、交情好、或揪住过他的把柄，才谈得上「看得出深浅」 */
  if (favor >= 40 || trust >= 30) return { deep: true, hint: '' };
  if (favor >= 15 || trust >= 10) return { deep: false, hint: `交情尚浅，看不透${pronounOf(npc)}的火候` };
  return { deep: false, hint: `你们素不相识，看不出${pronounOf(npc)}究竟练到了哪一步` };
}

/* 熟练度分级名（与功法体系一致） */
const SKILL_TIERS = ['初学', '入门', '小成', '熟练', '精通', '化境', '登峰'];
function skillTierCN(lv) {
  if (!lv || lv <= 0) return '未入门';
  if (lv >= 900) return '登峰造极';
  if (lv >= 700) return '化境';
  if (lv >= 500) return '精通';
  if (lv >= 300) return '熟练';
  if (lv >= 150) return '小成';
  if (lv >= 60) return '入门';
  return SKILL_TIERS[0];
}

/* ==================================================================
 * 「询问」的两件配套：他说得上话的**话题**，和他**认识的人**
 *
 * 主人第四轮原话：「点击 NPC 页的『询问』后希望能弹出一个页面上面有
 *   NPC 认识的人名字，点击这些名字按钮 NPC 会说关于它们的事
 *   （根据 NPC 背景画像来）」。
 *
 * 关键决定：**人名清单**与**点了他说什么**共用 `npcKnownPeople()` 一份数据 ——
 * 前端那份按钮、后端那句回答，绝不能各写一份名单（本项目血泪：
 * 「同一个功能有 N 个入口，改一半等于没改」）。
 *
 * 数据来源只有一处：`def.rel`（286 个 NPC 都有；kind = 仇/友/亲）+
 * 画像 `feuds`（就是 rel 里 kind=仇 的那批，按 id 去重并入）。
 * ================================================================== */

/** `ask` 数据在仓库里有**三种**写法 —— 统一成 `[{topic, answer, keywords, effects}]`。
 *  ① 单条 `{topic, answer}`　② 数组 `[{topic, answer}]`　③ 映射对象 `{"话题": "答案"}`
 *  ⚠️ 第三种是**数据主流写法**，漏了它会让 `a.topic` 变 undefined 并抛异常（已踩）。 */
function normalizeAskList(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  if (raw.topic || raw.answer) return [raw];
  return Object.keys(raw).map(k => {
    const v = raw[k];
    return (v && typeof v === 'object') ? Object.assign({ topic: k }, v) : { topic: k, answer: v };
  });
}

/** 他认识的人（rel + 画像 feuds，按 defId 去重）。
 *  ⚠️ `rel[].id` 是 **defId**，要用 `world.data.npcs` 查名 ——
 *     `world.getNpc()` 查的是**实例 id**（同名方法有两处定义，后者覆盖），查不到。 */
function npcKnownPeople(world, npc) {
  const def = (npc && (npc.def || npc)) || {};
  const out = [];
  const seen = {};
  const push = (id, kind, why) => {
    if (!id || seen[id]) return;
    const other = world.data.npcs && world.data.npcs[id];
    if (!other || !other.name) return;
    seen[id] = 1;
    out.push({ id, name: other.name, kind: kind || '友', rel: relKindCN(kind), why: why || '' });
  };
  for (const r of (def.rel || [])) push(r && r.id, r && r.kind, r && r.why);
  const pt = (npc && npc.portrait) || {};
  for (const f of (pt.feuds || [])) push(f && f.id, f && f.kind, f && f.why);
  return out;
}

/** 「交谈」在 NPC 没写台词时的**情境现编**。
 *  主人第四轮：「交谈按钮的可交互性就更多了但实际却没有什么」——
 *  病根是 300 多个 NPC 里写 `talk` 的是少数，其余一点就回「看了你一眼，没有说话」。
 *  这里按 时段 / 交情 / 身份 / 禀性 四样拼一句**像人说的话**（不是「万能寒暄」）：
 *   · 时段决定他眼下在忙什么（清早开张、晌午歇脚、夜里收摊）；
 *   · 交情决定他愿不愿意搭理你（亲密/和善/客气/冷淡四档，措辞完全不同）；
 *   · 身份/禀性决定他嘴里念叨的是什么（买卖人念生计、江湖人念恩怨、出家人念清修）。 */
function smallTalk(world, npc) {
  const m = world.clockMinutes % 1440;
  const period = m < 300 ? '夜里' : (m < 420 ? '天刚亮' : (m < 660 ? '清早' : (m < 900 ? '晌午' : (m < 1140 ? '午后' : '掌灯后'))));
  const favor = npc.favor || 0;
  const def = npc.def || {};
  const idn = npcIdentity(world, npc);
  const per = personality.personalityOf ? personality.personalityOf(npc) : 'mune';
  const verb = personality.sayVerbToned ? personality.sayVerbToned(npc) : '道';

  /* 敌对 / 山中猛兽：不聊家常 */
  if (def.hostile) return `${npc.name}${verb}：「有话快说，别耽误我办事。」`;

  const warm = favor >= 40 ? '亲近' : (favor >= 15 ? '和善' : (favor >= 0 ? '客气' : '冷淡'));
  const open = {
    亲近: '是你啊。',
    和善: '来了？',
    客气: '客官有事？',
    冷淡: '……有事？',
  }[warm];
  /* 禀性影响「说不说废话」：话少的短、绕的多半句、泼辣的带刺 */
  const PER_LINE = {
    jing: `${period}了，铺子还开着，你要什么说话。`,
    lie: `${period}了，我这儿忙得脚不沾地——你有话就挑紧要的说。`,
    re: `${period}了，热得很，坐会儿喝口水吧。`,
    leng: `${period}了。有事说事。`,
    mune: `${period}了，日子就这么过。`,
  };
  const BODY = {
    亲近: [
      `你我这份交情，不用见外。我在这${idn}行当里讨生活，这些年也就这样。`,
      `正好，${period}没事，我同你说说近来听见的闲话。`,
    ],
    和善: [
      PER_LINE[per] || PER_LINE.mune,
      `${period}了，我嘴上闲不住，什么都要说两句。`,
    ],
    客气: [
      PER_LINE[per] || PER_LINE.mune,
      `我不过是个${idn}，${period}了，也没什么好说的。`,
    ],
    冷淡: [
      '你我素无交情，何必多言。',
      `我认不得你。${period}了，该干什么干什么去。`,
      '话不投机。',
    ],
  }[warm];
  const body = world.rng.pick(BODY);
  return `${npc.name}${verb}：「${open}${body}」`;
}


/** 「问起他认识的人」时，他怎么说 —— 按关系分派，并**从那个人的资料里取料**
 *  （主人的要求是「根据 NPC 背景画像来」，不是套一句万能话）。
 *  交情越深说得越多：浅 → 只认得当；中 → 附一句印象；深 → 讲一件具体的事。 */
function npcAboutPerson(world, npc, who) {
  const other = (world.data.npcs && world.data.npcs[who.id]) || {};
  const trust = (npc.pstate && npc.pstate.trust) || 0;
  const favor = npc.favor || 0;
  const verb = (typeof personality !== 'undefined' && personality.sayVerbToned)
    ? personality.sayVerbToned(npc) : '道';
  const surname = other.name || who.id;
  const tag = other.tag ? tagCN(other.tag) : '';
  const sectDef = other.sect && world.data.sects && world.data.sects[other.sect];
  const identity = tag || (sectDef && sectDef.name) || '江湖上的人';
  const snip = other.desc ? String(other.desc).replace(/[。；]\s*$/, '').slice(0, 42) : '';
  const mid = (favor >= 5 || trust >= 5);
  const deep = (favor >= 20 || trust >= 15);
  const lines = [];
  const say = t => lines.push({ kind: 'say', text: `${npc.name}${verb}：「${t}」` });

  if (who.kind === '仇') {
    if (!mid) {
      say(`${surname}？你提他做什么。别的我不同你说。`);
    } else {
      say(`${surname}……哼。他是${identity}。` + (who.why ? `我们这笔账，起于${who.why}。` : '这笔账，早晚要算。'));
    }
    if (deep) {
      if (snip) say(`「${snip}」——你说，这样的人，我能不记恨？`);
      lines.push({ kind: 'hint', text: `　（提起${surname}，${npc.name}的语气硬了几分。）` });
    }
  } else if (who.kind === '亲') {
    if (!mid) {
      say(`${surname}……是啊，我认得。别的就不必多问了。`);
    } else {
      say(`${surname}是我${who.rel}。` + (snip ? `「${snip}」` : ''));
    }
    if (deep) lines.push({ kind: 'sys', text: `（提起${surname}，${npc.name}的神色软了几分。）` });
  } else {
    if (!mid) {
      say(`${surname}么，打过两回照面。`);
    } else {
      say(`${surname}？认得，是个${identity}。` + (snip ? `「${snip}」` : ''));
    }
    if (deep) {
      const homeRoom = other.home && world.getRoom && world.getRoom(other.home);
      if (homeRoom) say(`他常在${homeRoom.name}一带走动——要找他就去那儿。`);
      else lines.push({ kind: 'hint', text: `　（他与${surname}交情不浅，话里带了三分亲近。）` });
    }
  }
  return lines;
}

/* ------------------------------------------------------------------ *
 * 「送出去的往来」记账 —— 送礼面板要显示「已经送过几次 / 给了多少银子」。
 *
 * 主人原话：「点『送他东西』按钮，效果改为弹出玩家身上有什么物品（包括金钱），
 *           点击选择赠送，**已经送多少**」。
 * 之前的面板只列背包、也没有任何往来记录 —— 送过谁、送过什么、
 * 给过多少钱，玩家自己都记不清（NPC 的好感涨了多少也看不到因果）。
 *
 * 记在 `npc.pstate.gifts` 上：
 *   · pstate 本来就随档走（deserialize 补齐式恢复，不会把 gifts 冲掉）；
 *   · 唯一入口 `noteGift()`，give / give_money 两条路都调它，
 *     不各写一份（本项目老毛病）。金额与件数分开记，面板两句都能说清。
 * ------------------------------------------------------------------ */
function noteGift(npc, kind, key, amount) {
  if (!npc) return null;
  const st = npc.pstate || (npc.pstate = {
    trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false,
  });
  st.gifts = st.gifts || { count: 0, money: 0, items: {} };
  if (kind === 'money') {
    st.gifts.money = (st.gifts.money || 0) + (amount || 0);
    st.gifts.count = (st.gifts.count || 0) + 1;
  } else {
    st.gifts.count = (st.gifts.count || 0) + 1;
    if (key) st.gifts.items[key] = (st.gifts.items[key] || 0) + 1;
  }
  st.gifts.lastAt = undefined;   /* 预留：日后要按天算「今日已送」时填这里 */
  return st.gifts;
}

/** 动态句取句（design/77 §2.0.3，R2 2026-10-13）——纯函数，守卫直接测这份实现。
 *  ⚠️ 放**模块顶层**（不是 buildCommands 的闭包内）——skillTierCN 的老坑：
 *     闭包里的函数 module.exports 引用不到，守卫一跑就 ReferenceError。
 *  1. isNight() 且房间有 night 句 → 取 night 句（夜句优先于天气）
 *  2. 否则 → 取 weather 句（w.weather 值域恰好是中文字符键，直接索引）
 *  3. room.ambient 里没有这一条 → 返回 null，调用方不显示（不兜底、不复用别的天气 —— 硬的）。 */
function ambientLine(room, w) {
  const amb = room && room.ambient;
  if (!amb || typeof amb !== 'object') return null;
  if (typeof w.isNight === 'function' && w.isNight()
      && typeof amb.night === 'string' && amb.night.trim()) return amb.night;
  if (typeof amb[w.weather] === 'string' && amb[w.weather].trim()) return amb[w.weather];
  return null;
}

function buildCommands(world) {
  const CMD = {};

  const reg = (names, fn, meta) => {
    const list = [].concat(names);
    for (const n of list) CMD[n] = Object.assign({ names: list, run: fn }, meta || {});
  };

  /* ---------------- 基础 ---------------- */

  reg(['help', '?', '帮助', '指令'], (ctx) => {
    const lines = [];
    lines.push({ kind: 'title', text: '【 指令一览 】' });
    const groups = {
      '移动': ['n/s/e/w/u/d/ne/nw/se/sw（或 北/南/东/西/上/下）', 'look / l 看', 'go <方向|房间名>', 'map 查看地图', 'where 定位', '爬山坡 / 跳崖 / 渡河（看四周时提示的互动出口）'],
      '查看': ['look <目标> 观察', 'score / sc 查看自身', 'skills 武学', 'attr 属性', 'inventory / i 背包', 'equipment / eq 装备', 'quests 任务', 'affects 状态', 'time 时间'],
      '行动': ['say <话> 说话', 'me <动作> 动作', 'shout <话> 喊话', 'tell <人> <话> 密语', 'emote'],
      '物品': ['get <物品> 拾取', 'drop <物品> 丢弃', 'use <物品> 使用', 'wear/wield <物品> 装备', 'remove <部位> 卸下', 'give <物品> to <人>'],
      '武学': ['learn <武学> 学', 'train / lian <武学> 练功', 'enable <槽位> <武学> 装备武学', 'perform / pf <武学> 施展绝招', 'skills 查看'],
      '战斗': ['kill / fight <目标> 攻击', '偷袭 <目标> 先手重击（结仇，多半被告发）', 'flee 逃跑', 'auto 自动战斗'],
      '交互': ['talk <人> 交谈', 'ask <人> about <话题>', '打听 [关键词] 打听这一带的传闻',
        '风声 江湖上现在怎么说你', '拜访 <人> 上门拜访（交情够了才进得去）', 'buy <物品> from <人>', 'sell <物品>', 'trade'],
      '门派': ['sect 门派信息', 'join <门派> 拜师', '请安 [师父] 给师父请安（涨好感）', 'leave 脱离门派', 'promote 升职', 'contribute',
        '参加大典 [门派] 收徒大典（各门日子不同）', '挑战 <人名> 门内争位', '申请 向主事的求缺',
        '门派任务 接门派差事赚贡献', '华山对决 掌门应战（最终章）'],
      '官府': ['官府任务 领公事赚功勋', '出征 上战场（将军之后）'],
      '营生': ['work / 打工 打工赚钱（酒楼/药店）', '卖身 卖身青楼换银（仅女子）', '接客 应酬攒赎身钱（卖身后）', '赎身 凑钱脱籍', '身世 查看营生/卖身状态'],
      '采集/农事': ['打水 水源边打水解渴（需容器）', '切割 切野兽尸体取肉皮（需利器）', '加工 客栈/酒楼把生肉做熟', '买地 田头佃户家置田', '种植 <稻种|菜种>', '收割 收成熟庄稼', '偷庄稼 偷别人田（会被通缉）'],
      '任务': ['quest 任务列表', 'accept <任务>', 'abandon <任务>', 'report 交任务'],
      '系统': ['save 存档', 'load 读档', 'settings 设置', 'mods mod 管理', 'clear 清屏', 'nick <称号>', 'quit / 退出游戏 退出到主菜单（会自动存档）'],
      '掳人/奴仆': [
        '装人 <人名> 把晕倒的人装进麻袋（无目击者才不惊动官府）',
        '麻袋 看袋里关着谁',
        '放人 <第几袋> 放人出来',
        '赎回 <人名> 青楼/黑市赎人',
        '卖人 <人名> 卖进地下场所（知情转卖，重罪）',
        '买奴 <人名> 黑市买奴（受家资名额限制）',
        '关押 <人名> 把麻袋里的人押进自家地牢（须先开垦「地牢」）',
        '提审 <人名> 地牢逼供套线索（地牢越深越问得出）',
        '陪练 <人名> 拿关着的人喂招涨熟练度（他会伤、会恨你）',
        '放出 <人名> 开锁放人（审过的人出来可能反扑）',
        '奴册 看麻袋/奴/护院/地牢/恶名',
        '使唤 <人名> <做工|采买|跑腿|洗衣> 派活',
        '跟随 <人名> 邀人跟随（须好感过 60）',
        '雇护院 <人名> 看家护院（须在宅院，日薪要付）',
        '发工钱 结清护院工钱',
        '监督 <人名> 派护院盯着奴干活',
        '赎身 在青楼/黑市赎身（不在那儿则无事）',
        '突围 打出去（武力够强才成）',
        '还债 打工还债',
      ],
    };
    for (const g of Object.keys(groups)) {
      lines.push({ kind: 'subtitle', text: g });
      for (const c of groups[g]) lines.push({ kind: 'plain', text: '  ' + c });
    }
    lines.push({ kind: 'hint', text: '提示：很多指令支持中文，如「往北走」「看」「查看背包」。也支持点击界面上按钮操作。' });
    return { lines };
  });

  /* ---------------- 移动 ---------------- */

  /* ================================================================
   * B5 · 交战中不许移动（主人亲报：「战斗界面我依然能走，
   * 甚至带着和山贼的战斗界面能一路走回客栈」）
   *
   * 根因：doMove 此前**完全没有战斗态检查**，方向键 / go / 走 / 去 /
   * 「往北走」/ 房间名 / 互动出口（爬山坡·渡河）全都从这里直通
   * movePlayerTo，于是交战中一步一个脚印地走回了客栈。
   *
   * 为什么收敛在 doMove 一处而不是逐个入口打补丁：
   *   所有「玩家自主位移」的路径**最终都调用 doMove** ——
   *   方向键注册表（第 142 行）、go/去/前往/走（第 149 行）、
   *   go <房间名> 的逐跳寻路（第 180 行）、execute 的纯方向分支
   *   （第 2520/2521 行）、房间名匹配（第 2553 行）、
   *   互动出口 via/hint（第 2564 行）。堵doMove 一处即全覆盖。
   *
   * 战斗态读哪个字段（铁律：先打真实结构再写，别猜）：
   *   实测 world 的键里同时有 `combat` 和 `battle`，但
   *   `world.combat` 是 **CombatEngine 实例**（构造函数 combat.js），
   *   `world.battle` 才是**本局战斗的对象**（startCombat/startDuel 里
   *   赋值，finishCombat/flee 里置 null）。战斗态 = !!w.battle，
   *   与 commands.js 里既有的 perform/flee/auto 判据完全一致。
   *
   * 为什么不封 movePlayerTo：那条路还接着**非玩家自主**的位移 ——
   *   拜访上门（919行）、modapi 的 teleport/warp、survival 死亡回客栈。
   *   锁在 movePlayerTo 会把「战斗中被 NPC 拖走/死亡送医」也一起锁死。
   * ================================================================ */
  /* ⚠️ 提示语一律用**中文指令**（主人 2026-10-11：「把游戏里一些英文指令的教程改成中文指令」）。
     英文别名后端照旧认，但教程/提示里不再写 —— 玩家看到什么就该敲什么。 */
  const COMBAT_MOVE_HINT =
    '你正与人交手，走不脱！想脱身得先把这桩了结：'
    + '「杀 <目标>」或「自动战斗」进攻、「绝招 <武学>」使绝招、'
    + '「防御」凝神招架，或「逃跑」走为上。';

  const doMove = (ctx, dir) => {
    const p = ctx.player, w = ctx.world;
    /* ⚠️ 必须在任何位移/时间消耗之前就拦下来，
       否则「advanceTime + movePlayerTo」都已经生效了。 */
    if (w.battle) {
      return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    }
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你似乎迷失在了虚空之中。' }] };
    const exits = room.exits || {};
    let target = null, usedDir = dir;
    if (exits[dir]) target = typeof exits[dir] === 'string' ? exits[dir] : exits[dir].to;
    if (!target) {
      // 尝试用房间名匹配出口
      for (const d of Object.keys(exits)) {
        const ex = exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        if (tr && (tr.name === dir || tr.name.includes(dir))) { target = tid; usedDir = d; break; }
      }
    }
    if (!target) {
      const dirs = Object.keys(exits).map(d => DIR_CN[d] || d).join('、');
      return { lines: [{ kind: 'warn', text: `这个方向过不去。可去的方向有：${dirs || '无'}` }] };
    }
    const ex = exits[usedDir];
    // 出口条件
    if (ex && ex.cond) {
      if (!evalCond(ex.cond, ctx)) {
        /* 卷界拦截（design/89 §七·d 铁律 1/3）：被挡的话由**站在门前的人**说出来
           （ex.say，说话人写进文案，sectRefusal 范式），不出系统提示条；
           数据没给 say 才退回老系统腔 ex.msg。 */
        if (ex.say) return { lines: [{ kind: 'story', text: ex.say }] };
        return { lines: [{ kind: 'warn', text: ex.msg || '那边似乎有什么阻挡着你。' }] };
      }
    }
    if (ex && ex.exits && ex.exits.msg) { /* continue */ }
    // 移动消耗
    const cost = (ex && ex.cost) || 1;
    // 青楼卖身者活动范围限制（离青楼太远会被老鸨盯住）
    if (p.prostitution && p.prostitution.sold && !workMod.withinBrothelRange(w, target)) {
      return { lines: [{ kind: 'warn', text: '你如今是青楼之人，老鸨盯得紧，不能擅离太远。' }] };
    }
    p.advanceTime(cost);
    const r = w.movePlayerTo(p, target);
    /* B13 连带收尾：movePlayerTo 对「目标不存在」返回 {ok:false}（它自己是对的），
       但 doMove 此前**忽略**了返回值、照样报 moved:true —— 万一出口指向幽灵房，
       玩家会「没动却提示已移动」。这里补上防御（正常数据下永不为真：map-check 已禁悬空出口）。 */
    if (!r || !r.ok) return { lines: [{ kind: 'warn', text: (r && r.msg) || '那边似乎走不通。' }] };
    const lines = [];
    if (ex && ex.travel) lines.push({ kind: 'story', text: ex.travel });
    /* 进屋那一刻的见闻（初见相性 / 门派摩擦）——由 movePlayerTo 的 extra 带出来。
       顺序放在 travel 之后、看房间之前：先「到了」，再说人，最后才是屋里陈设。 */
    if (r.extra && r.extra.length) lines.push(...r.extra);
    /* ---- 匪类的自主行为（主人 2026-10-08）----
       互看 → 山贼量你的斤两与油水 → 抢 / 溜 / 打晕搜刮；有武力的旁人可能先出手
       （打赢了打晕装袋交衙门）；匪类遇强会逃，追不追得上**看轻功**；
       追不上时若从你身边过，会弹一句「拦不拦」。
       ⚠️ 挂在这儿而不是 movePlayerTo：这条路**只有玩家自己走一格**才走得到，
         传送 / 剧情推人 / 测试摆位都不会闹（那儿闹起来会毁掉别的东西，
         比如侧线的「走过去跟她说话」当场变成开打）。 */
    try {
      lines.push(...require('./outlaw').onPlayerEnter(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room)));
    } catch (e) { /* 匪类闹事失败不该挡路 */ }
    /* ---- 榜上的人来找你（2026-10-11 自拟）----
       兵器谱上名次挨着的人碰上了，性子够好斗的会当场讨教。
       与匪类同一层（只在**玩家自己走一格**时触发），理由一样：传送别惊动人。 */
    try {
      const ask = require('./rank').maybeChallenge(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
      if (ask) lines.push(ask);
    } catch (e) { /* 挑战失败不该挡路 */ }
    /* ---- 有人来找你算账（2026-10-11 自拟）----
       你打倒过的人，他的同门 / 同族 / 好友会记着。碰上了先开口，不是直接开打。 */
    try {
      const av = require('./revenge').maybeAvenge(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
      if (av) lines.push(av);
    } catch (e) { /* 寻仇失败不该挡路 */ }
    /* ---- 有人在议论你（2026-10-11 自拟 🅔 传闻的消费端）----
       你的事迹传到这一带之后，走进来会听见邻桌在说 —— 说的就是你。
       与匪类/讨教/寻仇同一层（只在「玩家自己走一格」时触发）：传送别惊动人。 */
    try {
      const ch = require('./rumorfeed').chatterIn(w, w.getRoom(p.room));
      if (ch) lines.push(ch);
    } catch (e) { /* 闲话失败不该挡路 */ }
    /* ---- NPC 之间有时也会切磋（主人 2026-10-11）----
       只在「玩家自己走一格」时掷一次，和传闻/匪类/讨教同一层 ——
       放进 lookRoom 会在每次读视图时触发（view 也调它），那就是满屏打架了。
       概率很低（6%），撞见算运气。 */
    try {
      lines.push(...require('./duel').maybeNpcDuel(w));
    } catch (e) { /* 打架表演失败不该挡路 */ }
    /* ---- 官府巡街的盘查（design/67 §3）----
       身上背着恶名的人，在街上撞见官差会被拦下问话。与上面几条同一层
       （只在**玩家自己走一格**时触发）—— 放进 lookRoom 就成了「站着也被查」。
       三个出口：报名 / 打点 / 拒捕（拒捕就是普通的「打」，不另造战斗分支）。 */
    try {
      const pc = require('./patrol').maybeCheck(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
      if (pc) lines.push(pc);
    } catch (e) { /* 盘查失败不该挡路 */ }
    /* ---- 闯山门拦截（design/71 §四）----
       踏进某家山门房，守卫拦下问话。与上面几条同一层
       （只在**玩家自己走一格**时触发）—— 放进 lookRoom 就成了「站在门口也被反复盘问」。
       三个出口：报上名号 / 塞钱打点 / 硬闯（不另造战斗分支，硬闯就是普通的「打」）。 */
    try {
      const gb = require('./guards').maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
      if (gb) lines.push(gb);
    } catch (e) { /* 守卫拦人失败不该挡路 */ }
    /* ---- 押镖路上可能被劫（design/67 §4）----
       同一层（玩家自己走一格才掷），不与 patrol 共用冷却。 */
    try {
      lines.push(...require('./escort').onMove(w, p, p.room));
    } catch (e) { /* 劫镖判定失败不该挡路 */ }
    /* ---- B22：踏进秘境/凶地要出「奇遇」的传闻 ----
       `rs_dungeon_clear` 此前是死种子（全仓没人调）。判据用**房间 id 前缀 `secret_`**
       —— 那是既有的「秘境」命名，不新造一套标记。
       只在**头一回**进去时报一次（`p.vars.seenSecret` 记账，随档走），
       免得进进出出把全城传成一个天天撞奇遇的人。 */
    try {
      const rid = String(p.room || '');
      if (rid.indexOf('secret_') === 0 && typeof w.addRumor === 'function') {
        p.vars = p.vars || {};
        const seen = p.vars.seenSecret || (p.vars.seenSecret = {});
        if (!seen[rid]) {
          seen[rid] = 1;
          p.setVar('seenSecret', seen);
          const room = w.getRoom(rid) || {};
          w.addRumor('rs_dungeon_clear', { room: rid, vars: { who: p.name || '有人', where: room.name || '那处' } });
        }
      }
    } catch (e) { /* 奇遇传闻失败不该挡路 */ }
    const view = lookRoom(ctx);
    lines.push(...view.lines);
    return { lines, moved: true };
  };

  for (const k of Object.keys(DIRECTIONS)) {
    const dir = DIRECTIONS[k];
    if (!dir) continue;
    reg([k], (ctx) => doMove(ctx, dir), { silent: true });
  }
  reg(['go', '去', '前往', '走'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想去哪里？' }] };
    const p = ctx.player, w = ctx.world;
    const kw = args.join(' ');
    const d = DIRECTIONS[kw];
    if (d) return doMove(ctx, d);
    // 按房间名找（同区域 / 相邻）
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你似乎不在一个真实所在，辨不清方向。' }] };
    const cands = [];
    for (const dir of Object.keys(room.exits || {})) {
      const ex = room.exits[dir];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(tid);
      if (tr) cands.push({ room: tr, dir });
    }
    const hit = cands.find(c => c.room.name.includes(kw) || kw.includes(c.room.name));
    if (hit) return doMove(ctx, hit.dir);
    // 全局房间名搜索（只在已探索区域，或直接给出路径提示）
    const allRooms = Object.values(w.data.rooms);
    const gh = fuzzyFind(allRooms, kw, r => r.name);
    if (gh) {
      /* ⚠️ 必须传 ctx：不传就是「无视门禁」的旧 BFS，
         玩家一句 `go 太和殿` 会直接瞬移进皇宫，把 ex.cond 全绕过去。 */
      const path = findPath(w, p.room, gh.id, ctx);
      if (path && path.length) {
        /* B5：逐跳寻路也得先探战斗态。doMove 里虽然也拦，
           但那时已经打出了「你沿路前往X…」的过场语，再撤回反而绕。
           这里提前拦一次，提示才干净（也不会谎报 moved:true）。 */
        if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
        const lines = [{ kind: 'sys', text: `你沿路前往${gh.name}…` }];
        for (const step of path) {
          /* 逐跳走方向（走 doMove 才对），而不是 movePlayerTo 瞬移：
             doMove 才会检查 ex.cond / 卖身范围 / 时间成本。 */
          const cur = w.getRoom(p.room);
          let dir = null;
          for (const d of Object.keys(cur.exits || {})) {
            const e2 = cur.exits[d];
            if ((typeof e2 === 'string' ? e2 : e2.to) === step) { dir = d; break; }
          }
          if (!dir) break;
          const mv = doMove(ctx, dir);
          for (const l of (mv && mv.lines) || []) {
            /* 中间每一跳的房间描述太长，只留第一跳的 travel 文本 */
            if (l.kind === 'story') lines.push(l);
          }
          if (mv && mv.moved === undefined) { lines.push(...((mv.lines) || [])); break; }
        }
        lines.push(...lookRoom(ctx).lines);
        return { lines, moved: true };
      }
      if (gh.id === p.room) {
        return { lines: lookRoom(ctx).lines };
      }
      /* 门禁挡路时要说清楚是哪一道门，别只说「找不到路」 */
      const lockedMsg = lockedEdgeHint(w, p.room, gh.id, ctx);
      if (lockedMsg) return { lines: [{ kind: 'warn', text: lockedMsg }] };
      return { lines: [{ kind: 'warn', text: `似乎找不到通往${gh.name}的路。` }] };
    }
    return { lines: [{ kind: 'warn', text: `你不知道${kw}在哪里。` }] };
  });

  /* ---------------- 观察 ---------------- */

  /** 时刻 → 画像 routine 的 at 键（规格书 §1.2：day / night / dawn / dusk / meal） */
  function timeSlot(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    if (m < 300) return 'night';    // 子～寅 0:00-5:00
    if (m < 480) return 'dawn';     // 卯～辰 5:00-8:00
    if (m < 660) return 'day';      // 巳～午前 8:00-11:00
    if (m < 780) return 'meal';     // 午 饭点 11:00-13:00
    if (m < 1020) return 'day';     // 未～申 13:00-17:00
    if (m < 1140) return 'dusk';    // 酉 17:00-19:00
    return 'night';                 // 戌～亥 19:00-24:00
  }

  /** 取 NPC 当前时段正在做的那件事；没有 routine 就返回 null（呈现层完全不露） */
  function routineNow(npc, minutes) {
    const r = npc && npc.portrait && npc.portrait.routine;
    if (!r || !r.length) return null;
    const slot = timeSlot(minutes);
    const hit = r.find(x => x.at === slot) || r.find(x => x.at === 'day') || r[0];
    if (!hit || !hit.act) return null;
    return String(hit.act).replace(/[。.]+$/, '');   // 句号由调用方统一补
  }

  /** 乞丐 / 流民 / 平民 —— 「施舍行善」的判定对象（B22 rs_alms）。
   *  用**显式 tag** 判据，不扫名字（B8 之 BLK-2 教训）。 */
  function isPoor(npc) {
    const tag = npc && npc.def && npc.def.tag;
    return ['beggar', 'refugee', 'commoner', 'farmer'].indexOf(tag) >= 0;
  }

  /** 这个 NPC 名下**当前可接**的一条任务 id（没有则 null）。
   *  来源两层：`def.quests`（13 人有）与 `def.sidequest`（284 人有，此前是死字段 → B25）。
   *  过滤：任务必须真实存在（挡悬空指针，如 26 人指向的未落地 hk_*）、且尚未接取/完成。
   *  用**显式字段**判据，不猜名字/描述（B8 之 BLK-2 教训）。 */
  function availableQuestOf(ctx, npc) {
    if (!npc) return null;
    const w = ctx.world, p = ctx.player, def = npc.def || {};
    const ids = [];
    if (Array.isArray(def.quests)) for (const q of def.quests) ids.push(q);
    if (def.sidequest) ids.push(def.sidequest);
    for (const q of ids) {
      if (!q || !w.getQuest(q)) continue;
      if (p.questStage(q) >= 0) continue;   // 已在进行 / 已完成
      /* 前置未满足的不算「可接」（sidequest-land 实测：第二 hook 带 require.questDone，
         第一条进行中时会冒出「点下去＝你还不满足接取条件」的假入口 —— 违反「给不出的项不给」）。 */
      const qd0 = w.getQuest(q);
      if (qd0 && qd0.require && !evalCond(qd0.require, ctx)) continue;
      return q;
    }
    return null;
  }

  function lookRoom(ctx) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '这里一片虚无。' }] };
    const lines = [];
    lines.push({ kind: 'roomname', text: `【${room.name}】` });
    const region = w.getRegion(room.region);
    if (region) lines.push({ kind: 'plain', text: `(${region.name || room.region} · ${shichen(p.timeMinutes)} · 天色${w.weather})` });
    const descText = evalTemplate(room.desc || '', ctx);
    /* ---- 🔴 B 案锚物内嵌（重击批第 4 件，主人：「做进剧情里，物件下面标点提示」，
       2026-10-16 team-lead 裁 B + 101 口径 A）----
       room action 可配 `anchor`（字符串或数组）：锚物词（缸/壶/灶/案/槐树…）。
       描写文本里出现的锚物词高亮成可点名词（现成 .hl 虚线下划线），
       点开出该锚物挂的**全部**动作（hint:true/false 都收 ——
       hint:false 的不进「此地可做」行，全靠这里露脸）。
       ⚠️ 不扫词推定（B8 BLK-2 铁律）：锚物必须显式配，不配的房零变化
       （前向兼容，数据侧按 101 分批落，同 room.hl N-V-18 的先例）。 */
    const anchorHl = [];
    {
      const byWord = new Map();
      for (const a of (room.actions || [])) {
        const words = (a && a.anchor) ? (Array.isArray(a.anchor) ? a.anchor : [a.anchor]) : [];
        for (const word of words) {
          if (!word || descText.indexOf(word) < 0) continue;
          if (!byWord.has(word)) byWord.set(word, []);
          byWord.get(word).push({ label: a.label || a.cmd, cmd: a.cmd || '', hint: a.desc || '' });
        }
      }
      for (const [word, acts] of byWord) {
        anchorHl.push({ text: word, type: 'action', actions: acts });
      }
    }
    if (anchorHl.length) {
      lines.push({ kind: 'desc', text: descText, hl: anchorHl });
    } else {
      lines.push({ kind: 'desc', text: descText });
    }

    /* ---- 动态句（design/77 §2.0.3）：取句逻辑在 ambientLine()，句子同 desc 一套 evalTemplate 口径 ---- */
    {
      const line = ambientLine(room, w);
      if (line) lines.push({ kind: 'plain', text: evalTemplate(line, ctx) });
    }

    /* ---- 世界动态 W6/W7 的外显（design/27 §3.3-6 地盘标识 / §4 节庆）----
       · 地盘：此地属某势力 → 一行「此处已是XX的地界」，势力越盛越明显。
       · 节庆：今日有节 → 一行提示，房间之外「街市比平日热闹」。
       两者都是**状态驱动**（读 factionState / day），不是写死进 desc —— 数据不动，观感变。 */
    if (typeof w.factionOfRegion === 'function' && room.region) {
      const fid = w.factionOfRegion(room.region);
      const fac = fid && w.factionState && w.factionState.factions[fid];
      if (fac) lines.push({ kind: 'plain', text: `此处是${fac.name}的地界，弟子往来，规矩森严（${fac.mood}）。` });
    }
    if (typeof w.festivalToday === 'function') {
      const fest = w.festivalToday();
      if (fest) lines.push({ kind: 'plain', text: `今日是${fest.name}，街上比平日热闹许多。` });
    }
    /* ---- 换节气那天说一句（2026-10-11 自拟）----
       平时不念（每天念一遍就成了天气预报）；只在交节那天给一句话。 */
    {
      const term = require('./season').termLine(w);
      if (term) lines.push(term);
    }
    /* ---- 岔路口的路牌 —— ★ 2026-10-12 主人：「把游戏里的路牌删了」，下线。
       原来走到跨区域岔路口会念一句「路口立着块半人高的木牌……东：江南府　南：少林寺」。
       ⚠️ `observe.signpostFor()` 本体**留着**（没删函数）：它是纯计算，
          主人随时可能又要回来；而且 `tools/smoke-observe.js` 直接测它。
          这里只是不再把结果往房间描述里灌 —— 一句话的取舍，改回来就一行。 */

    // NPC
    const npcs = w.npcsIncludingTemplates(p.room);
    if (npcs.length) {
      const cls = {};
      for (const n of npcs) {
        const k = n.name;
        cls[k] = (cls[k] || 0) + 1;
      }
      /* 名字后带身份（复用 npcIdentity：门派职位 / 捕快 / 郎中 / 寻常百姓…），
         跟 lookNpc / guanxi / favor 用的是同一套推断，不会两处口径打架。
         同名多人时只标一次身份（x2 分支不重复），且身份用第一个遇到的。 */
      const idOf = {};
      for (const n of npcs) { if (!idOf[n.name]) idOf[n.name] = npcIdentity(w, n); }
      const labelOf = k => {
        const id0 = idOf[k];
        return id0 ? `${k}（${id0}）` : k;
      };
      const out = Object.keys(cls).map(k => cls[k] > 1 ? `${labelOf(k)} x${cls[k]}` : labelOf(k));
      // hl：把每个 NPC 名标成可点，点击弹出「对它做什么」的中文菜单
      const hl = Object.keys(cls).map(k => {
        const one = npcs.find(n => n.name === k);
        const pron = pronounOf(one);   // B11：兽→它 / 女→她 / 男→他（单一入口）
        const def = (one && one.def) || {};
        const actions = [
          /* ⚠️ 第一项原来是 `{label:'看看', cmd:'look …'}` —— 只是一段文本流水。
             主人在**日志里点 NPC 名**弹出这个菜单，点「看看」却只多打了几行字，
             于是问「我要的看 NPC 会显示信息面板的功能呢？为什么点『看看』却不弹面板？」
             （实情：详情面板只挂在前端「场景栏卡片」那条入口上，日志高亮这条漏了。）
             现在第一项就是**开详情面板**：`act:'profile'` + `uid`（实例 id），
             前端认 act 开面板；cmd 留作兜底（老客户端 / 不认 act 时退回 look）。
             2026-10-15 主人定调菜单双词：「细看」(profile) 与「看」(look 文本流)，
             字眼与全站叫法对齐，不再用「打量」「细看此人」。 */
          { label: '细看', act: 'profile', uid: one && one.id, cmd: '细看 ' + k, hint: '资料 · 来历 · 关系' },
          { label: '交谈', cmd: 'talk ' + k },
          { label: '询问', cmd: 'ask ' + k },
        ];
        /* ---- 任务一：按情境给项 ----
           ⚠️ 铁律：给不出的项**一律不给** —— 点了没反应（或"这里没有…"）比没有按钮更出戏。
           判据一律用**显式字段**（def.quests / def.sidequest / def.teach / shop / tag），
           绝不扫 name/desc 关键词（B8 之 BLK-2 教训）。 */
        /* ① 有支线的才给「接取任务」：
              def.quests（13 人）或 def.sidequest（284 人，此前是死字段 → B25 接线）。
              已接过/已完成/悬空指针 → 不显示。
              ★ 主人第四轮：「点击后希望能先弹出任务详情再选择是否接受任务，
                并把『接他的事』改名为『接取任务』」——
                所以这里带上 `act:'acceptquest'` + `qid`，前端认它就先弹详情页；
                cmd 保留（老客户端 / 不认 act 时退回「直接接」的旧行为）。 */
        const aq = availableQuestOf(ctx, one);
        if (aq) {
          const qd = w.getQuest(aq);
          actions.push({
            label: '接取任务',
            act: 'acceptquest',
            qid: aq,
            cmd: 'accept ' + ((qd && qd.name) || aq),
            hint: qd ? qd.name : '',
          });
        }
        /* ② 能请教的才给「请教武学」 */
        if (def.teach) actions.push({ label: '请教武学', cmd: 'qingjiao ' + k });
        /* ③ 有铺子的才给「看看货物」 */
        if (one && one.shop) actions.push({ label: '看看货物', cmd: 'list ' + k });
        /* ④ 医者才给「求医」（tag=doctor，11 人） */
        if (def.tag === 'doctor') actions.push({ label: '求医', cmd: '求医 ' + k });
        /* ⑤ 识路的人（镖师/车夫/船夫）才给「问路」 */
        if (['escort', 'groom', 'boatman'].indexOf(def.tag) >= 0) actions.push({ label: '问路', cmd: '问路 ' + k });
        /* ⑤b 官差才给「报信 / 领差事」（design/67 §3 正邪分野）。
           ⚠️ 这两个**不做前端线别过滤**：反派点下去会被后端回一句
           「官府的差事不发给来历不明的人」—— 那是**有反应**。
           分野要让玩家看得见（藏起来 = 玩家永远不知道官府这条门路跟他没关系）。 */
        if (def.tag === 'constable' || def.tag === 'official') {
          actions.push({ label: '报信', cmd: '报信', hint: '递一条线报，换赏钱' });
          actions.push({ label: '领差事', cmd: '领差事', hint: '讨一桩官府的缉捕' });
        }
        /* ⑥ 偷袭（主人第四轮点名要的入口）。
           跟「伺机偷窃」一样属「风险」类，放在风险区；
           **绝不能顶到「攻击」后面去**（B10：「攻击」要保持最后一项，防手指滑）。 */
        if (!(one && one.knockedOut)) {
          actions.push({ label: '伺机偷袭', cmd: '偷袭 ' + k, hint: '先手重击，但会结仇，多半被告发' });
        }
        actions.push({ label: `送${pron}东西`, cmd: 'give ' + k });
        actions.push({ label: '查看关系', cmd: 'guanxi ' + k });
        /* B10（主人亲报：点 NPC / 野兽弹出来的菜单里没有「攻击」）：
           · cmd 用**真实的攻击指令** `attack` —— 批次 2 已把 attack 并入 kill
             （reg(['kill','fight','attack','杀','攻击','打'], …)，见本文件 kill 处理器），
             与手动敲「攻击 xxx」完全同一条路径，不另造分支。
           · 目标名照现有 actions 的写法用裸名 k（fuzzyFind 认这个名字），不另起口径。
           · 敌对 / 已交战者把「攻击」顶到最前（此刻玩家多半就是想打）；
             普通百姓 / 寻常人物也**照给**，只是压在最后（「查看关系」之后）——
             武侠世界本就能动手，后端从不拦「攻击谁」，把入口藏起来才是 B10 的病根；
             排最后纯粹为压低触屏误触（挨着「交谈」手指一滑就开打）。
           · ⚠️ 铁律 33：**绝不拿 n.hostile 当「不给攻击」的排除条件** ——
             它是模板常驻标记（山贼/野兽一出生 true、打输也不清）。这里只用它
             **排序**（优先给），不做任何「能不能打」的判定。 */
        /* 文本流的「看」压在最后 —— 但**必须排在「攻击」之前**：
           「攻击」要保持是**最后一项**（B10：避免手指从「交谈」一路滑到「攻击」），
           把无害的「看」垫在攻击前面，两头都安全。 */
        actions.push({ label: '看', cmd: 'look ' + k, hint: '看一段文字描述' });
        /* ★ 「绑架」统一入口（主人第四轮加）：
           晕着 → 直接装袋；站着 → 先打（真进战斗）。
           判据全用**显式状态**：`knockedOut`（晕没晕）+ 背包里有没有粗麻袋。
           日志这条路的按钮只能带一个 cmd，所以状态分流在**后端**做掉，
           前端两侧（场景栏卡片 / 日志高亮）拿到的是同一条路。 */
        {
          const hasSack = p.countItem(kidnapMod.SACK_ID) >= 1;
          const out_ = !!(one && one.knockedOut);
          actions.push({
            label: '绑架',
            cmd: out_ ? ('装人 ' + k) : ('kill ' + k),
            hint: out_ ? (hasSack ? '装进麻袋带走' : '得先有条粗麻袋（杂货铺有卖）') : '打晕他，再装袋',
          });
        }
        /* ★ 「切磋」（主人 2026-10-11：「npc 互动页有『攻击』没有『切磋』」）。
           与「攻击」是两条完全不同的路：
             · 攻击 → 真打，会结仇、会通缉、能打死人；
             · 切磋 → 点到为止，谁都不死，输了留 1 滴血、原地缓过来，还落一点人情。
           所以它是**无害项**，跟「交谈/送礼」排在一起，压在「看/攻击」之前 ——
           主人早就定过规矩：「攻击」必须是最后一项（B10：手指从「交谈」一路滑下来别开打），
           切磋是安全的，不用躲着它，但也不能把攻击从末位挤走。
           战斗中不给（正在打就别插一场），人躺着不给（等他缓过来）。 */
        {
          const duelMod = require('./duel');
          const canDuel = !w.battle && one && !one.knockedOut && !one.dead
            && !/\b狼|虎|熊|蛇|豹|兽|野猪|蟒|鹰/.test(one.name || '');
          if (canDuel) {
            const left = duelMod.MAX_PER_DAY - duelMod.countToday(w, one.id);
            actions.push({
              label: '切磋',
              cmd: '切磋 ' + k,
              hint: left > 0 ? `点到为止，不伤性命（今日还能比 ${left} 场）` : '今日比试的场数已用尽',
            });
          }
        }
        const inBattle = !!(w.battle && w.battle.target === one);
        const hot = !!(one && (one.hostile || one.inCombat || inBattle));
        const attackAct = { label: '攻击', cmd: 'attack ' + k };
        if (hot) actions.unshift(attackAct); else actions.push(attackAct);
        /* 名字带上身份，点哪儿都是同一个目标（fuzzyFind 认「名字（身份）」的括号前缀） */
        return { text: labelOf(k), type: 'npc', actions };
      });
      lines.push({ kind: 'npcs', text: `这里有：${out.join('、')}。`, hl });
      /* ---- 屋里的人动了一下（主人 2026-10-08）----
         说完「这里有谁」，再落一句他们在干什么：「某某某看了某某某一眼」「某某某看了看四周」。
         按「房间 + 人 + 时辰片」哈希选句，同一个时辰里反复看是同一句 ——
         不然每看一次屋里就换一副姿势，像木偶抽风。 */
      lines.push(...require('./observe').roomBeats(w, room, npcs));
      /* ---- 倒地/晕倒的人（任务一）----
         ⚠️ 铁律 32：`npcsIn` 过滤 `!dead`，而打倒的人是 knockedOut+dead，
         所以「这里有：」里**看不到他们** —— 倒地相关一律走 `world.downedIn()`。
         给「补刀 / 搜身 / 装进麻袋」三个入口（各有真指令、点了有反馈）；
         没麻袋就不给「装进麻袋」（给了也是白发警告）。 */
      const downed = w.downedIn(p.room);
      if (downed.length) {
        const hasSack = p.countItem(kidnapMod.SACK_ID) >= 1;
        const dhl = downed.map(n => {
          const acts = [
            /* 倒地的也一样：第一项开详情面板（主人报过「日志里点名字不弹面板」） */
            { label: '细看', act: 'profile', uid: n.id, cmd: '细看 ' + n.name, hint: '资料 · 来历 · 关系' },
            { label: '看', cmd: 'look ' + n.name },
            { label: '补刀', cmd: 'kill ' + n.name, hint: '结果了他' },
            { label: '搜身', cmd: '搜身 ' + n.name, hint: '翻他身上的东西' },
          ];
          /* ★ 倒在地上的「绑架」= 直接装袋（主人第四轮要的统一入口）。
             与站着那条（`kill` 先打）是同一个按钮的两种状态，前后端同一套口径。
             没带麻袋也**照给**（点了有明确指引），别把入口藏起来。 */
          acts.push({
            label: '绑架',
            cmd: '装人 ' + n.name,
            hint: hasSack ? '装进麻袋带走' : '得先有条粗麻袋（杂货铺有卖）',
          });
          return { text: n.name, type: 'npc', actions: acts };
        });
        lines.push({ kind: 'npcs', text: `地上还躺着：${downed.map(n => n.name).join('、')}。`, hl: dhl });
      }
      /* ---- 画像 L0 看见 ----
         有画像的 NPC 额外给一句「此刻正在做什么」（routine 按当前时段取），
         而不是千篇一律的名字 + 身份。没画像的 NPC 完全保持原样。 */
      const acts = [];
      for (const n of npcs) {
        if (!n.portrait) continue;
        const act = routineNow(n, p.timeMinutes);
        if (act) acts.push(`${n.name}${act}`);
      }
      if (acts.length) lines.push({ kind: 'npcsact', text: acts.join('；') + '。' });
    }
    // 地面物品
    const items = w.itemsIn(p.room);
    if (items.length) {
      const names = items.map(i => { const d = w.getItem(i.itemId); return (d ? d.name : i.itemId) + ((i.count || 1) > 1 ? ` x${i.count}` : ''); });
      const hl = items.map(i => {
        const d = w.getItem(i.itemId);
        const nm = d ? d.name : i.itemId;
        return {
          text: nm, type: 'item',
          actions: [
            { label: '细看', cmd: '细看 ' + nm },
            { label: '捡起', cmd: 'get ' + nm },
          ],
        };
      });
      lines.push({ kind: 'items', text: `地上散落着：${names.join('、')}。`, hl });
    }
    // 房间可交互物件（打铁 / 采药 / 钓鱼…）
    const acts = room.actions || [];
    /* 🔴 101 口径 A（重击批第 4 件）：`hint:false` 的 action 不进「此地可做」行
       —— 收进 desc 锚物（anchor 内嵌高亮）与输词体系，照常可触发。
       缺省 true：存量房未标 hint 的照旧全列，不红。
       「整列默认收起」的读法：数据侧 101 落完后，出生点整列只剩主线件
       （开局恰 1 条「问信」），不再一股脑 12 条糊一行。
       ── 2026-10-17 主人真机反馈（第 79 件）：**前置 cond 评估 false 的也不列**
       （「信」要等缸挪开才出现——挪完缸，下次 look 自动冒出来）。
       ── 同日二次收窄（主人原话口径）：**重复动作一律显示，不被 cond 干掉**；
       隐藏只限 **once 族**（once:true 或带 hideWhenFlag）的两种：
       ① once 已完成（hideWhenFlag 置位）②once 前置未满足（信等挪缸）。
       裁决统一收在 modapi.onceHidden（共享谓词，roomActionsView 同口径）；
       once 族内部仍走 flagGateCond（只认旗标键，资源门不参与隐藏）。
       chance 的「列行不偷 rng」随之更彻底：重复族整个 cond 都不评了。
       执行期（runActionAction）照旧评全量 cond，钱/骰在点下去那一刻结算。 */
    const shown = acts.filter(a => a && a.hint !== false && !onceHidden(a, ctx));
    if (shown.length) {
      const names = shown.map(a => a.label || (a.keywords || [])[0] || a.cmd).filter(Boolean);
      if (names.length) {
        const hl = shown.map(a => {
          const nm = a.label || (a.keywords || [])[0] || a.cmd;
          return {
            text: nm, type: 'action',
            actions: [{ label: (a.label || nm), cmd: a.cmd || nm, hint: a.desc || '' }],
          };
        }).filter(h => h.text);
        lines.push({ kind: 'action', text: `此地可做：${names.join('、')}。`, hl });
      }
    }
    // 尸体
    const corpses = w.corpsesIn(p.room);
    if (corpses.length) lines.push({ kind: 'items', text: `地上躺着：${corpses.map(c => c.name).join('、')}。` });
    /* ---- R4 痕迹句（design/85 §〇/77 §2.0.2）：渲染在固定描写、动态句之后，
       单值，不过 .hl 管线（trace 层整句输出，79 §2.1 视觉）---- */
    if (p.roomNotes && p.roomNotes[p.room]) {
      lines.push({ kind: 'trace', text: p.roomNotes[p.room] });
    }
    // 出口：结构化（普通出口 → 方位图；互动出口 → 可点击互动）
    const exitMap = {};
    const viaExits = [];
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      const tr = w.getRoom(tid);
      const toName = tr ? tr.name : '未知';
      const locked = !!(ex && typeof ex === 'object' && ex.locked);
      if (ex && typeof ex === 'object' && (ex.via || ex.hint)) {
        // 互动出口：需互动（爬山坡 / 渡河…）才能通过，点击互动词触发
        viaExits.push({
          dir: d, dirCN: DIR_CN[d] || d,
          via: ex.via || ex.hint || '障碍',
          hint: ex.hint || ex.via || d,
          desc: ex.desc || '隐隐通向外界',
        });
      } else {
        exitMap[d] = { dir: d, to: tid, name: toName, locked };
      }
    }
    lines.push({
      kind: 'exits',
      text: `出口：${Object.keys(exitMap).map(d => (DIR_CN[d] || d) + '·' + exitMap[d].name).join('　') || '无'}。`,
      exits: Object.keys(room.exits || {}),
      exitMap,
      /* 方向按钮排：以前这些按钮放在房间面板里（#exits），压在「此处可做」上面，
         跟日志里已经有的「出口」行功能重复。主人报「屏幕上有两个此地可做」，
         要求把方向按钮收到出口那块去 → 改成跟着「出口」行走（UI：ui.js renderLogText）。
         这里传全量出口数据（含 locked），比只给 dir 数组强。 */
      exitBtns: Object.keys(room.exits || {}).map(d => {
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        const tr = w.getRoom(tid);
        return {
          dir: d,
          name: DIR_CN[d] || d,
          toName: tr ? tr.name : '未知',
          locked: !!(ex && typeof ex === 'object' && ex.locked),
        };
      }),
      roomName: room.name,
    });
    // 互动出口：单独描述，互动词可点击
    for (const v of viaExits) {
      const dirWord = v.dir === 'u' ? '上方' : v.dir === 'd' ? '下方' : v.dir === 'in' ? '里面' : v.dir === 'out' ? '外面' : (v.dirCN + '边');
      lines.push({
        kind: 'via-exit',
        text: `${dirWord}有${v.via}，${v.desc}。`,
        hl: [{ text: v.via, type: 'via-exit', actions: [{ label: v.hint || ('向' + v.dirCN + '走'), cmd: v.hint || v.dir, hint: v.desc || '' }] }],
      });
    }
    // 房间自定义 look 效果
    if (room.onLook) {
      evalEffects(room.onLook, ctx).forEach(l => lines.push(l));
    }
    /* ---- 场所环境音（主人第四轮：「走到青楼会有莺莺燕燕喊官人来玩」）----
       放在最后一条：房间名、区域、描述、出口、物件都说完了，再补一句「这地方在发生什么」。
       句库在 `core/ambient-pools.js`，判定与限量在 `core/ambience.js`。
       ⚠️ 不播的条件有三种，都在 ambientLine 里判：判定不出场所 / 那地方太私密 / 句库空。 */
    try {
      const amb = require('./ambience').ambientLine(w, room);
      if (amb) lines.push(amb);
    } catch (e) { /* 氛围坏了不许影响看房间 */ }
    return { lines, room };
  }

  /* 「细看」并入（主人真机反馈：裸词「细看」报不是指令）——
     带 X 走下面的物件/NPC 描写通路，裸词落 lookRoom。 */
  reg(['look', 'l', '看', '观察', '细看', '周围'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const kw = args.join(' ');
    if (!kw) return lookRoom(ctx);
    /* ⚠️ 先试房间交互物件（告示/井/床/柜…）。
       主人报：客栈「此地可做」列着「看告示」，点下去却说「这里没有「看告示」」。
       真凶是 normalizeCmd 的「看X」口语规则 —— 它把 action 的 cmd「看告示」
       改写成了 `look 告示`，房间 actions 的 cmd 匹配（严格相等）就废了，
       于是落到这里报「这里没有」。按钮发的是 a.cmd，不是玩家手输的口语，
       所以这条路径必须能认 action 的 cmd / keyword。 */
    const roomNow = w.getRoom(p.room);
    /* ⚠️ 这里必须**先把「人名」摘出去**再放房间物件匹配 ——
       否则只要某条 action 的 `keywords` 里含一个人名（很常见：`劝她` keywords
       里有「鲁半夏」、`talk 元怀瑾` 里有「元怀瑾」），玩家 `look 鲁半夏`
       就会被那条 action 整条吃掉：结果是拿到 action 的 effects 或 failMsg
       （「她不在花厅。这条路的事，还轮不到你插嘴。」），**永远看不到这个人**。
       这正是「不报错、只是静默走错路」那一族（smoke-portrait-batch 的 1.L0b 抓到）。
       判据：**参数能命中本房间的 NPC 时，关键词不当场接管**；
       `a.cmd === kw`（按钮发的是 a.cmd）与「action 自己就是 look 系」仍然优先。 */
    const npcsHere = w.npcsIncludingTemplates(p.room);
    const npcPre = fuzzyFind(npcsHere, kw, n => n.name);
    for (const a of (roomNow && roomNow.actions) || []) {
      const ac = (a.cmd || '').trim();
      const byCmd = ac === kw;
      const byBypass = !npcPre && (ac.startsWith('look ') || ac.startsWith('看'));
      const byKw = !npcPre && (a.keywords || []).some(k => k && (kw === k || kw.includes(k)));
      if (!byCmd && !byBypass && !byKw) continue;
      if (a.cond && !evalCond(a.cond, ctx)) {
        return { lines: [{ kind: 'warn', text: a.failMsg || '现在做不了这个。' }] };
      }
      /* B6：和 questKeyword 同一类问题 —— action 没有 effects 时
         evalEffects([]) 返回空数组，玩家「看 牢门」「看 槐树」
         得到的是**零行输出**（界面上一片空白，等同于按钮坏了）。
         这里给一句明确的落空说明。 */
      if (!a.effects || !a.effects.length) {
        return { lines: [{ kind: 'plain', text: `你细看了看，此处暂无更多可看的了。` }] };
      }
      return { lines: (writeRoomNote(ctx, a), evalEffects(a.effects || [], ctx)) };
    }
    // NPC
    const npcs = npcsHere;
    const npc = fuzzyFind(npcs, kw, n => n.name);
    if (npc) return { lines: lookNpc(ctx, npc) };
    // 物品（地面/背包/装备）
    const pool = [];
    for (const i of p.inventory || []) pool.push({ kind: 'inv', it: i });
    for (const i of w.itemsIn(p.room)) pool.push({ kind: 'ground', it: i });
    const defs = w.data.items;
    const hit = pool.find(x => { const d = defs[x.it.id || x.it.itemId]; return d && (d.name === kw || d.name.includes(kw)); });
    if (hit) return { lines: describeItem(ctx, hit.it.id || hit.it.itemId, hit.it) };
    // 出口 / 房间
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '这里一片虚无，四下都看不清。' }] };
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      if (DIR_CN[d] === kw || d === kw) {
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        return { lines: [{ kind: 'plain', text: `${DIR_CN[d] || d}边是${tr ? tr.name : '未知之处'}。${ex.desc || ''}` }] };
      }
    }
    const gh = fuzzyFind(Object.values(w.data.rooms), kw, r => r.name);
    if (gh) return { lines: [{ kind: 'plain', text: `【${gh.name}】${gh.desc || ''}` }] };
    return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
  });

  function lookNpc(ctx, npc) {
    const w = ctx.world;
    /* 括号里写**身份**（门派职位/捕快/郎中/寻常百姓…），不再写「江湖中人」 */
    const id0 = npcIdentity(w, npc);
    const lines = [{ kind: 'subtitle', text: `${npc.name}（${id0}）` }];
    /* 名人的称号另起一行，别跟身份混为一谈 */
    if (npc.title && npc.title !== id0 && npc.title.length > 3) {
      lines.push({ kind: 'plain', text: `江湖上人称${pronounOf(npc)}「${npc.title}」。` });
    }
    lines.push({ kind: 'desc', text: npc.desc || '看不出什么特别之处。' });
    /* ---- 「看」= **仔细观察**（主人 2026-10-08 纠正）----
       点「看」这一路给的是**看得见的证据**：手上的茧、袖口的压痕、鞋底的泥，
       再搭一句对方当下什么反应。
       ⚠️ 「看了一眼」那种过渡句**不在这儿** —— 它在「点名字、开互动面板」那一步
       （`observe.glanceAt`，由 engine.npcProfileOf 随资料一起给）。两处分工别搞混。 */
    lines.push(...require('./observe').lookBeat(w, npc));
    /* ---- 画像 role → 「这是个什么人」的一句身份定位（任务三）----
       role 是画像里的**定位**（如「华山脚下独居的老药婆，采药、看病、也替人藏东西」），
       不是复述 desc —— 看人一眼就该看出对方是个什么人。128 位有画像的 NPC 全带 role。 */
    if (npc.portrait && npc.portrait.role) {
      lines.push({ kind: 'plain', text: `一眼看去，${evalTemplate(npc.portrait.role, ctx)}。` });
    }
    const def = npc.def || {};
    if (def.showLevel !== false) lines.push({ kind: 'plain', text: `看起来约 ${npc.level} 层修为。` });
    if (npc.hp < npc.maxHp) {
      const r = npc.hp / npc.maxHp;
      lines.push({ kind: 'plain', text: `${npc.name}似乎${r < 0.3 ? '已受重伤' : r < 0.6 ? '受了些伤' : '略有疲态'}。` });
    }

    /* ---- 装备：穿戴中的兵刃衣裳（主人要求：能看到 NPC 装备了什么）---- */
    if (def.showEquip !== false && npc.equipment) {
      const worn = [];
      for (const slot of Object.keys(npc.equipment)) {
        const iid = npc.equipment[slot];
        if (!iid) continue;
        const d = w.getItem(iid);
        worn.push(`${slot}·${d ? d.name : iid}`);
      }
      if (worn.length) lines.push({ kind: 'plain', text: `身上穿着：${worn.join('，')}。` });
    }

    /* ---- 随身物品：腰间钱袋 + 带在身上的家伙（主人要求）---- */
    if (def.showCarry !== false) {
      const carry = npc.carry || def.carry || null;
      const bag = [];
      const items = (carry && carry.items) || def.items || [];
      for (const x of [].concat(items || [])) {
        const iid = typeof x === 'string' ? x : (x && (x.id || x.itemId));
        if (!iid) continue;
        const d = w.getItem(iid);
        const cnt = typeof x === 'object' && x.count ? '×' + x.count : '';
        bag.push((d ? d.name : iid) + cnt);
      }
      const money = (carry && carry.money !== undefined) ? carry.money : def.money;
      if (money) bag.push(`${money} 文`);
      if (bag.length) lines.push({ kind: 'plain', text: `随身带着：${bag.join('，')}。` });
    }

    /* ---- 武学：装在身上的哪一门 + **练到第几层**（主人要求）----
       ⚠️ 看人也是有讲究的：交情不够只能看出「他会武」，看不明白练到什么
       程度。层级按好感/信任给（favor≥40 或 trust≥30 才给真话），
       否则只报「深不可测」。否则你摸一下岳不群的门派就全知道了。 */
    const insight = npcInsight(npc);
    if (def.showSkill !== false && npc.equippedSkills) {
      const ss = Object.keys(npc.equippedSkills).filter(k => npc.equippedSkills[k]).map(k => {
        const sid = npc.equippedSkills[k];
        const sd = w.getSkill(sid);
        if (!sd) return null;
        const lv = npc.learned && npc.learned[sid] ? (npc.learned[sid].level || 0) : 0;
        const tail = insight.deep ? `${sd.name}（${skillTierCN(lv)}）` : sd.name;
        return `${k}:${tail}`;
      }).filter(Boolean);
      if (ss.length) {
        lines.push({
          kind: 'plain',
          text: `${pronounOf(npc)}习有：${ss.join('，')}。` +
            (insight.deep ? '' : `　（${insight.hint}）`),
        });
      }
    }

    /* 其余会的武学（没装备但会）——让「深藏不露」的人也能看出底细 */
    if (def.showAllSkills === true && npc.learned) {
      const eq = new Set(Object.keys(npc.equippedSkills || {}).map(k => npc.equippedSkills[k]));
      const more = Object.keys(npc.learned).filter(sid => !eq.has(sid)).map(sid => {
        const sd = w.getSkill(sid);
        const lv = npc.learned[sid] ? (npc.learned[sid].level || 0) : 0;
        return sd ? `${sd.name}${lv ? `（${skillTierCN(lv)}）` : ''}` : null;
      }).filter(Boolean);
      if (more.length) lines.push({ kind: 'plain', text: `此外还习得：${more.join('，')}。` });
    }

    /* ---- 门下弟子（他有传人，说明本事不小）---- */
    if (Array.isArray(npc.disciples) && npc.disciples.length) {
      const names = npc.disciples.map(id => {
        const d = w.getNpc(id);
        return d ? d.name : id;
      }).filter(Boolean);
      if (names.length) lines.push({ kind: 'plain', text: `门下弟子：${names.join('、')}。` });
    }

    /* ---- 画像 L0 看见（单人细看也给一句当下动作）---- */
    const act = routineNow(npc, ctx.player.timeMinutes);
    if (act) lines.push({ kind: 'plain', text: `${npc.name}${act}。` });
    if (def.descAdd) lines.push({ kind: 'plain', text: def.descAdd });
    if (def.lookEffects) evalEffects(def.lookEffects, ctx).forEach(l => lines.push(l));
    return lines;
  }

  /* npcInsight / SKILL_TIERS / skillTierCN 已搬到模块顶层（见上方注释），
     这里不再重复定义 —— 两份定义就是漂移的开始。 */

  function describeItem(ctx, itemId, inst) {
    const w = ctx.world;
    const d = w.getItem(itemId);
    if (!d) return [{ kind: 'warn', text: '看不出这是什么。' }];
    const lines = [{ kind: 'subtitle', text: `${d.name}${d.type ? '（' + typeCN(d.type) + '）' : ''}` }];
    if (d.desc) lines.push({ kind: 'desc', text: d.desc });
    if (d.stats) {
      const parts = [];
      for (const k of Object.keys(d.stats)) parts.push(`${statCN(k)} +${d.stats[k]}`);
      if (parts.length) lines.push({ kind: 'plain', text: '属性：' + parts.join('，') });
    }
    if (d.attr) {
      const parts = Object.keys(d.attr).map(k => `${k} +${d.attr[k]}`);
      if (parts.length) lines.push({ kind: 'plain', text: '加成：' + parts.join('，') });
    }
    if (d.damage) lines.push({ kind: 'plain', text: `伤害：${d.damage}` });
    if (d.armor) lines.push({ kind: 'plain', text: `护甲：${d.armor}` });
    if (d.healHp) lines.push({ kind: 'plain', text: `可恢复气血 ${d.healHp}` });
    if (d.healMp) lines.push({ kind: 'plain', text: `可恢复内力 ${d.healMp}` });
    if (d.teach) { const sd = w.getSkill(d.teach); lines.push({ kind: 'plain', text: `研读可学会：${sd ? sd.name : d.teach}` }); }
    if (d.require) lines.push({ kind: 'plain', text: '（有使用条件）' });
    if (inst && inst.durability !== undefined) lines.push({ kind: 'plain', text: `耐久：${inst.durability}/${inst.maxDurability}` });
    if (d.value) lines.push({ kind: 'plain', text: `价值：约 ${d.value} 文钱` });
    if (inst && inst.count > 1) lines.push({ kind: 'plain', text: `数量：${inst.count}` });
    return lines;
  }

  /* ---------------- 自身信息 ---------------- */

  function scoreLines(ctx) {
    const p = ctx.player, w = ctx.world;
    const lines = [];
    lines.push({ kind: 'title', text: `【 ${p.name} 】` });
    lines.push({ kind: 'plain', text: `性别：${genderNoun(p)}　年龄：${p.age} 岁　${p.title ? '称号：' + p.title : ''}` });
    if (p.sect) {
      const sd = w.getSect(p.sect);
      lines.push({ kind: 'plain', text: `门派：${sd ? sd.name : p.sect}${sd && sd.ranks ? ' · ' + (sd.ranks[p.rank] || '弟子') : ''}` });
    } else lines.push({ kind: 'plain', text: '门派：无门无派' });
    /* 潜能已废除（主人 2026-10-11：「潜能点有什么用？？？没用的话可以把这个删了」）。
       查清了：它唯一的消耗口是「研读秘籍」，而那个分支要求书声明 `teach` ——
       全库 9 本书一本都没写，所以这条路从来没通过；其余只有产出没有消耗。
       现在从玩家可见处与基础玩法里撤掉（字段本身保留，Mod 接口不动）。 */
    /* design/99 定案：天文经验曲线速率自洽、只是显示崩 —— 超长数字缩写显示
       （与前端 util.fmtBig 同一口径：< 万原样，≥ 万 → 12.4万，≥ 亿 → 1.2亿）。 */
    const fmtBig = n => {
      n = Math.floor(Number(n) || 0);
      if (n < 10000) return String(n);
      const trim = x => String(x).replace(/\.0$/, '');
      if (n < 1e8) return trim(Math.round(n / 1000) / 10) + '万';
      return trim(Math.round(n / 1e7) / 10) + '亿';
    };
    lines.push({ kind: 'plain', text: `等级：${p.level}　经验：${fmtBig(p.exp)}/${fmtBig(p.expNeed(p.level))}` });
    lines.push({ kind: 'bar', text: '气血', cur: p.hp, max: p.maxHp, color: 'hp' });
    lines.push({ kind: 'bar', text: '内力', cur: p.mp, max: p.maxMp, color: 'mp' });
    lines.push({ kind: 'bar', text: '饱食', cur: p.food, max: p.maxFood, color: 'food' });
    lines.push({ kind: 'bar', text: '饮水', cur: p.water, max: p.maxWater, color: 'water' });
    lines.push({ kind: 'plain', text: `银钱：${p.goldText()}` });
    lines.push({ kind: 'plain', text: `正邪：${p.karma > 50 ? '正道侠士' : p.karma < -50 ? '邪道中人' : '亦正亦邪'}（${p.karma}）　击杀：${p.kills}` });
    /* 防 = 玩家的 defFinal。def 这个名字已被 NPC 模板对象占用，玩家侧不读它 */
    lines.push({ kind: 'plain', text: `攻 ${p.atk}　防 ${p.defFinal}　闪避 ${p.dodge}　招架 ${p.parry}　身速 ${p.speed}　暴击 ${(p.critRate * 100).toFixed(0)}%` });
    if (p.insect) {
      const ins = w.data.insects ? w.data.insects[p.insect] : null;
      lines.push({ kind: 'plain', text: `蛊：${ins ? ins.name : p.insect}` });
    }
    if (p.titles && p.titles.length) lines.push({ kind: 'plain', text: `称号：${p.titles.join('、')}` });

    /* ---- 装备（主人 2026-10-11：「状态也增加显示装备情况」）----
       以前「状态」只报攻防闪避这一串数字，**不告诉玩家这数字是怎么来的** ——
       换了把刀伤害变了，回「状态」一看还是那串数，看不出是兵器的功劳。
       这里把每个部位穿着什么、加了多少写清楚。 */
    lines.push(...equipmentLines(ctx));
    return lines;
  }

  /**
   * 「装备」那一栏（状态面板 / 装备面板共用一份口径）。
   * @returns {Array<{kind,text}>} 标题 + 每个部位一行
   */
  function equipmentLines(ctx) {
    const p = ctx.player, w = ctx.world;
    const eq = p.equipment || {};
    const out = [];
    const worn = [];
    /* ⚠️ 部位顺序按 `equipment` 的键序（头→颈→身→手→脚→武器→…），不另排一遍 ——
       排序抄第二份迟早跟定义分家。 */
    for (const slot of Object.keys(eq)) {
      const uid = eq[slot];
      if (!uid) continue;
      const it = w.getItem ? w.getItem(uid) : null;
      if (it) worn.push({ slot, it });
    }
    out.push({ kind: 'subtitle', text: `装备（${worn.length} 件）` });
    if (!worn.length) {
      out.push({ kind: 'hint', text: '　你身上一件装备都没有。（「装备」面板或「穿 <物件>」都能上身。）' });
      return out;
    }
    /* 属性只从 `it.stats` / `it.attr` 取 —— recalc 就是拿这两处算的，
       玩家看到的必须跟身上真生效的是同一份，不另编一套口径。 */
    const NAMES = { atk: '攻', def: '防', dodge: '闪避', parry: '招架', speed: '身速', critRate: '暴击', maxHp: '气血上限', maxMp: '内力上限' };
    for (const { slot, it } of worn) {
      const bits = [];
      for (const k of Object.keys(it.stats || {})) {
        const v = it.stats[k];
        if (typeof v !== 'number' || !v) continue;
        bits.push((NAMES[k] || k) + (v > 0 ? ' +' : ' ') + (k === 'critRate' ? Math.round(v * 100) + '%' : v));
      }
      for (const k of Object.keys(it.attr || {})) {
        const v = it.attr[k];
        if (typeof v !== 'number' || !v) continue;
        bits.push(k + (v > 0 ? ' +' : ' ') + v);
      }
      out.push({
        kind: 'plain',
        text: `　${slot}：${it.name}${bits.length ? '　' + bits.join('　') : ''}`,
        uid: it.uid || it.id,
      });
    }
    return out;
  }

  reg(['score', 'sc', '状态', '查看自身', '自身'], (ctx) => ({ lines: scoreLines(ctx) }));

  reg(['attr', '属性', 'shuxing'], (ctx) => {
    const w = ctx.world;
    const lines = [{ kind: 'title', text: '【 属性 】' }];
    const keys = Object.keys(ctx.player.attr);
    for (const k of keys) {
      const pd = w.data.attrs[k];
      lines.push({ kind: 'plain', text: `${k}：${ctx.player.attr[k]}${pd && pd.desc ? '　' + pd.desc : ''}` });
    }
    const traits = ctx.player.traits.concat(ctx.player.perks);
    if (traits.length) {
      lines.push({ kind: 'subtitle', text: '天赋 / 特质' });
      for (const t of traits) {
        const td = w.getTrait(t);
        lines.push({ kind: 'plain', text: `${td ? td.name : t}${td && td.desc ? '：' + td.desc : ''}` });
      }
    }
    return { lines };
  });

  reg(['skills', '武学', '功夫', 'wuxue'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 武学 】' }];
    if (!Object.keys(p.learned).length) {
      lines.push({ kind: 'plain', text: '你尚未学过任何武功。' });
      return { lines };
    }
    const byType = {};
    for (const id of Object.keys(p.learned)) {
      const sd = w.getSkill(id);
      if (!sd) continue;
      const t = sd.type || '其它';
      (byType[t] = byType[t] || []).push(sd);
    }
    for (const t of Object.keys(byType)) {
      lines.push({ kind: 'subtitle', text: t });
      for (const sd of byType[t]) {
        const lv = p.skillLevel(sd.id);
        const eq = Object.values(p.equippedSkills).includes(sd.id) ? ' [已装备]' : '';
        const cur = p.learned[sd.id];
        const need = p.skillExpNeed(cur.level);
        lines.push({ kind: 'skill', text: `${sd.name}　${lv} 级　(${cur.exp}/${need})${eq}`, skill: sd.id });
      }
    }
    lines.push({ kind: 'hint', text: '用「练 <武学名>」练功提升等级；用「装备武学 <槽位> <武学名>」改变装备。' });
    return { lines };
  });

  reg(['inventory', 'i', '背包', '物品', 'beibao'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: `【 行囊 】（${(p.inventory || []).length} 件）` }];
    if (!p.inventory || !p.inventory.length) lines.push({ kind: 'plain', text: '你的行囊空空如也。' });
    else {
      for (const it of p.inventory) {
        const d = w.getItem(it.id);
        lines.push({ kind: 'item', text: `${d ? d.name : it.id}${(it.count || 1) > 1 ? ' x' + it.count : ''}${d && d.value ? `　(${d.value}文)` : ''}`, uid: it.uid, itemId: it.id });
      }
    }
    const money = p.goldText();
    lines.push({ kind: 'plain', text: `银钱：${money}` });
    return { lines };
  });

  reg(['equipment', 'eq', '装备'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 装备 】' }];
    /* 木瓢案（2026-10-17）：槽位表走 w.equipSlots（固定 + 动态并集），
       「手持」这类自定义槽位也要看得见——与 equipmentList 同一份真相。 */
    for (const s of w.equipSlots(p)) {
      const id = p.equipment[s];
      const d = id ? w.getItem(id) : null;
      lines.push({ kind: 'plain', text: `${s}：${d ? d.name : '（空）'}` });
    }
    lines.push({ kind: 'subtitle', text: '已装备武学' });
    for (const k of Object.keys(p.equippedSkills)) {
      const id = p.equippedSkills[k];
      const d = id ? w.getSkill(id) : null;
      lines.push({ kind: 'plain', text: `${k}：${d ? `${d.name}（${p.skillLevel(id)}级）` : '（空）'}` });
    }
    return { lines };
  });

  reg(['affects', '状态效果', 'buff'], (ctx) => {
    const p = ctx.player;
    const lines = [{ kind: 'title', text: '【 当前状态 】' }];
    if (!p.buffs.length) lines.push({ kind: 'plain', text: '你身上没有特殊状态。' });
    for (const b of p.buffs) {
      const mods = b.mods ? Object.keys(b.mods).map(k => `${k}${b.mods[k] > 0 ? '+' : ''}${b.mods[k]}`).join(' ') : '';
      lines.push({ kind: 'plain', text: `${b.name}（剩 ${b.turns} 回合）${mods}` });
    }
    return { lines };
  });

  reg(['time', '时间'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const t = fmtTime(p.timeMinutes);
    return {
      lines: [
        { kind: 'plain', text: `现在：${t.text}（${shichen(p.timeMinutes)}）` },
        { kind: 'plain', text: `季节：${w.seasonCN()}　天色：${w.weather}　${w.isNight() ? '夜色深沉' : '日头尚好'}` },
      ]
    };
  });

  /* ---------------- 社交 ---------------- */

  reg(['say', '说', '说道'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想说什么？' }] };
    const text = args.join(' ');
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'say', text: `你说：「${text}」` }];
    // NPC 反应
    for (const n of w.npcsIn(p.room)) {
      if (n.def && n.def.listen) {
        for (const L of n.def.listen) {
          if (text.includes(L.keyword)) {
            evalEffects(L.effects, { player: p, world: w, npc: n }).forEach(x => lines.push(x));
          }
        }
      }
    }
    return { lines };
  });

  reg(['me', 'emote', '动作'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想做什么动作？' }] };
    return { lines: [{ kind: 'action', text: `${ctx.player.name}${args.join(' ')}` }] };
  });

  reg(['shout', '喊', '喊话'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想喊什么？' }] };
    return { lines: [{ kind: 'say', text: `你气运丹田，长声喊道：「${args.join(' ')}！」` }] };
  });

  reg(['tell', '密语'], (ctx, args) => {
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：tell <人名> <内容>' }] };
    return { lines: [{ kind: 'say', text: `你以传音入密之法对${args[0]}道：「${args.slice(1).join(' ')}」` }] };
  });

  reg(['nick', '称号'], (ctx, args) => {
    const p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: `你的称号是：${p.title || '（无）'}` }] };
    const t = args.join(' ');
    if (p.titles && p.titles.length && !p.titles.includes(t)) {
      return { lines: [{ kind: 'warn', text: `你还没有获得「${t}」这个称号。` }] };
    }
    p.title = t;
    return { lines: [{ kind: 'sys', text: `你的称号已改为「${t}」。` }] };
  });

  /* ---------------- 物品 ---------------- */

  reg(['get', 'take', '捡', '拾取', '拿'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想捡什么？' }] };
    const kw = args[args.length - 1] === 'all' || args[args.length - 1] === '全部' ? null : args.join(' ');
    const w = ctx.world, p = ctx.player;
    if (!kw) {
      const lines = [];
      const items = w.itemsIn(p.room).slice();
      for (const it of items) {
        const r = w.pickupItem(p, w.getItem(it.itemId) ? w.getItem(it.itemId).name : it.itemId);
        lines.push({ kind: r.ok ? 'sys' : 'warn', text: r.msg });
      }
      if (!lines.length) lines.push({ kind: 'warn', text: '这里地上什么也没有。' });
      return { lines };
    }
    const r = w.pickupItem(p, kw);
    if (r.ok) { p.advanceTime(1); }
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['drop', '丢', '丢弃', '放下'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想丢什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };
    const r = w.dropItem(p, hit.uid);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  /* B22：喝酒要出市井传闻（rs_drunkard 此前是死种子）。
     判据用**物品 id / 名字含「酒」**，不新造 tag —— 免得又开一个平行口径。
     只在真的喝下去之后才传，且带点概率：喝一口就传遍全城不合情理。
     ⚠️ 抽成函数的原因：战斗内 / 战斗外两条路径都要传，各写一份就是
        「改一个忘一个」的老毛病 —— 而且那两份的 `ok` 来源还不一样
        （一条来自 useItem、一条是 combatStep 的 item 分支透出来的），
        写两遍更容易只对齐一半。 */
  function drunkRumor(ctx, hit, ok) {
    if (!ok) return;
    const w = ctx.world, p = ctx.player;
    const iid = (typeof hit === 'object' && hit) ? hit.id : hit;
    const idef = w.getItem(iid) || {};
    if (typeof w.addRumor === 'function'
      && (/酒/.test(iid || '') || /酒/.test(idef.name || ''))
      && (w.rng.next ? w.rng.next() : Math.random()) < 0.5) {
      const room = w.getRoom(p.room) || {};
      w.addRumor('rs_drunkard', { room: p.room, vars: { who: p.name || '有人', where: room.name || '此地' } });
    }
  }

  reg(['use', '吃', '喝', '服用', '使用'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想用什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };

    /* ⚠️ 战斗中吃药必须走 combatStep，不能绕过战斗直接 useItem。
       同一个动作此前有**两套时序**：
         · 面板 / API：`engine.exec({ action: 'item' })` → `combatStep({ type: 'item' })`
           （engine.js:2195）⇒ 吃药算一回合，敌人照常出手、回合数照涨；
         · 手打「use 金创药」：走这里 → `w.useItem()` ⇒ **完全不经过战斗**，
           敌人一动不动、turn 也不涨。
       后者等于给玩家一个「战斗中免费回血」的口子：只要背包里还有药，
       就能一直吃，而对面一拳都递不出来 —— 战斗面板上那句「敌人出手」
       是玩家对时序的唯一感知，这么一绕，感知就断了。
       ⇒ 战斗中统一交给 combatStep，只留一条时序；非战斗时照旧走 useItem。 */
    if (w.battle && !w.battle.over) {
      const rr = w.combatStep({ type: 'item', uid: hit.uid });
      const lines = (rr && rr.lines) || [];
      drunkRumor(ctx, hit, !!(rr && rr.ok));
      return { lines, combatStep: true };
    }

    const r = w.useItem(p, hit.uid);
    drunkRumor(ctx, hit, !!(r && r.ok));
    return { lines: (r.lines || []).concat([{ kind: r.ok ? 'sys' : 'warn', text: r.msg }]) };
  });

  reg(['wear', 'wield', 'equip', '穿', '装备上', '持'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想装备什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    const hit = fuzzyFind(p.inventory || [], kw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${kw}」。` }] };
    const r = w.equipItem(p, hit.uid);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['remove', '卸下', '脱'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想卸下哪个部位的装备？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;
    let slot = kw;
    if (!p.equipment[slot]) {
      // 按物品名找槽位
      for (const s of Object.keys(p.equipment)) {
        const d = p.equipment[s] ? w.getItem(p.equipment[s]) : null;
        if (d && d.name.includes(kw)) { slot = s; break; }
      }
    }
    const r = w.unequipItem(p, slot);
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['give', '给', '送', '赠送'], (ctx, args) => {
    // give <物品> to <人>   |   send <人> <物品>
    const a = args.join(' ').split(/\s+to\s+|给|送给?/);
    if (a.length < 2) return { lines: [{ kind: 'warn', text: '用法：give <物品> to <人名>（或「送 <人> <物品>」）' }] };
    const w = ctx.world, p = ctx.player;
    const itemKw = a[0].trim(), npcKw = a[1].trim();
    const hit = fuzzyFind(p.inventory || [], itemKw, i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${itemKw}」。` }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    if (npc.isNpc && (npc.def || {}).hostile && /狼|虎|熊|蛇|豹|兽/.test(npc.name)) {
      return { lines: [{ kind: 'warn', text: `${npc.name}可不是能收礼的主儿。` }] };
    }
    const d = w.getItem(hit.id);
    w.removeItem(p, hit.id, 1);
    /* 记一笔往来（**唯一入口**，三条分支之前就记 —— 东西已经交出去了，
       无论走作者手写的 acceptItems / onGift 还是通用判定，账都该记上）。 */
    noteGift(npc, 'item', (d && d.name) || hit.id, 0);

    /* ---- 作者手写的 acceptItems / onGift 优先 ---- */
    const def = npc.def || {};
    if (def.acceptItems && def.acceptItems[hit.id]) {
      const r = social.addFavor(w, npc, 10 * w.favorGainMult(p), '赠礼');
      const lines = [{ kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` }];
      evalEffects(def.acceptItems[hit.id], { player: p, world: w, npc }).forEach(l => lines.push(l));
      lines.push(...r.lines);
      return { lines };
    }
    if (def.onGift) {
      const lines = [{ kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` }];
      evalEffects(def.onGift, { player: p, world: w, npc, item: hit.id }).forEach(l => lines.push(l));
      return { lines };
    }

    /* ---- 通用送礼判定（喜爱类型 + 品质）---- */
    const gv = social.giftValue(w, npc, hit.id);
    /* 天赋「口才便给」只放大**正向**好感：投其所好给的礼更受用 */
    const r = social.addFavor(w, npc, gv.favor > 0 ? gv.favor * w.favorGainMult(p) : gv.favor, '赠礼');
    personality.addMood(npc, gv.favor >= 0 ? 10 : -8); // 受赏高兴 / 收到不喜之物不快

    const lines = [
      { kind: 'sys', text: `你把${d ? d.name : hit.id}交给了${npc.name}。` },
      { kind: gv.matched ? 'story' : 'say', text: gv.text },
    ];
    if (!gv.matched) {
      const likes = (def.likes || []).map(x => (social.LIKE_TYPES.find(y => y.id === x) || {}).cn).filter(Boolean);
      if (likes.length) lines.push({ kind: 'hint', text: `（${npc.name}似乎格外喜欢：${likes.join('、')}）` });
    }
    /* 品质也亮一下，让玩家理解为什么给得少 */
    if (gv.quality && gv.quality.name) {
      lines.push({ kind: 'hint', text: `（【${gv.quality.name}】的物件，${gv.matched ? `又合${pronounOf(npc)}心意` : `可惜不对${pronounOf(npc)}胃口`}）` });
    }
    lines.push(...r.lines);
    /* B22 埋点 4/14 · rs_alms（把东西给了乞丐/贫民 = 行善）。 */
    if (isPoor(npc) && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_alms', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });

  /* ---------------- 社交 ---------------- */

  /* 打听消息：在当前区域打听江湖传闻（#109 世界记忆·传闻系统）
   * 传闻由玩家行为（杀人/救人/扬名…）经目击生成，会走样、扩散、衰减、消亡；
   * 同一桩事在不同 NPC 口中说辞不同（truth 分档 + 关系态度后缀）。 */
  reg(['打听', '打听消息', '探听', '风闻', '听风声', '问消息'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'error', text: '你不在任何地方。' }] };
    const region = room.region || '_wild';
    const keyword = (args || []).join(' ').trim();
    const list = w.listenRumors(region, keyword, 3);
    if (!list.length) {
      const none = keyword
        ? `你在${room.name}向人探听「${keyword}」的消息，却无人谈及此事。`
        : `你在${room.name}竖起耳朵听了半晌，周遭只聊些家长里短、柴米油盐，没甚要紧风声。`;
      return { lines: [{ kind: 'plain', text: none }] };
    }
    const lines = [{ kind: 'title', text: `【 街谈巷议 · ${room.name} 】` }];
    const roomNpcs = w.npcsIn(p.room).filter(n => !n.dead && !(n.def || {}).hostile && !n.knockedOut);
    const speaker = roomNpcs.length ? roomNpcs[Math.floor(w.rng.next() * roomNpcs.length)] : null;
    const spName = speaker ? speaker.name : '一个路过的茶客';
    let relKind = null;
    if (speaker) {
      for (const r of (p.rel || [])) { if (r.id === speaker.defId) { relKind = r.kind; break; } }
    }
    const ACTIONS = ['捋了捋胡须', '压低了嗓子', '凑过身来', '咂了咂嘴', '端起茶碗抿了一口', '抬眼打量了你一下'];
    const action = ACTIONS[Math.floor(w.rng.next() * ACTIONS.length)];
    for (const r of list) {
      const text = w.fillRumorText(r);
      const who = (r.vars && r.vars.who) || '那人';
      let suffix = '（我也是听人说的，作不得准。）';
      if (relKind === '亲') suffix = '（他压低了声音）这话我只跟你一个人说。';
      else if (relKind === '友') suffix = `依我看，${who}不是那样的人。`;
      else if (relKind === '仇') suffix = `哼，${who}那种人，早晚有报应。`;
      lines.push({ kind: 'say', text: `${spName}${action}，说道：「${text}」${suffix}` });
    }
    lines.push({ kind: 'hint', text: '（传闻会随日子走样、消散；同一桩事，不同的人嘴里说法也不同。）' });
    return { lines };
  });

  /* 风声：**关于你自己**的那几条（2026-10-11 自拟 🅔）
   *
   * 与「打听」的区别（两者容易混，这里说清）：
   *   · 打听 <关键词>  —— 在**本地**竖着耳朵听，听到的是**这一带**所有活着的传闻
   *   · 风声          —— 不管你在哪儿，问的是「江湖上我是怎么被说的」，
   *                      按影响排序、告诉你传到哪些地方了 —— 这是**成长的外部反馈**
   * 主人原话要的就是这个：「这个世界会因为我在里面而有点不一样」。 */
  reg(['风声', '我的名声', '名头', '江湖风声', 'reputation'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const rf = require('./rumorfeed');
    const list = rf.whatTheySay(w, 5);
    const repLines = rf.reputationLines(w);
    if (!list.length) {
      const none = [
        { kind: 'title', text: '【 江湖风声 】' },
        { kind: 'plain', text: '你在江湖上还没留下什么话柄 —— 没人议论你，也没人怕你。' },
        { kind: 'hint', text: '（做点别人看得见的事：拜师、出手、行善、闯祸……总得有人在旁边看着。）' },
      ];
      return { lines: none.concat(repLines) };
    }
    const lines = [{ kind: 'title', text: '【 江湖风声 · 别人怎么说你 】' }];
    list.forEach((r, i) => {
      lines.push({
        kind: 'say',
        text: `${i + 1}. 「${r.text}」`,
      });
      const where = r.regions.length ? r.regions.slice(0, 3).join('、') : '附近';
      const fresh = r.bornDaysAgo <= 0 ? '今日的事' : `${r.bornDaysAgo} 天前的事`;
      const drift = r.truth >= 70 ? '话还是原样' : (r.truth >= 40 ? '传着已有些走样' : '早传走样了');
      lines.push({
        kind: 'hint',
        text: `（${r.kind}·${fresh}；传到 ${where}；${drift}）`,
      });
    });
    lines.push(...repLines);
    lines.push({ kind: 'hint', text: '（风头会随日子淡下去；声望高到一定程度，认识你的人待你会不一样。）' });
    return { lines };
  });

  /* 请安（2026-10-11 自拟 🅕 师门情谊）：
     拜师之后总得有个「去看看师父」的动作 —— 没有它，
     师父念叨你「还知道回来」就成了玩家永远无法应对的指责。
     一次 +好感，并把「多久没来」的账清掉。 */
  reg(['请安', '问安', '拜见师父', '给师父请安'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const mids = Object.keys(p.masters || {});
    if (!mids.length) return { lines: [{ kind: 'warn', text: '你还没有拜过师。' }] };
    const kw = (args || []).join(' ').trim();
    let npc = null;
    if (kw) {
      npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
      if (!npc) return { lines: [{ kind: 'warn', text: `这儿没有「${kw}」。` }] };
    } else if (mids.length === 1) {
      const rec = p.masters[mids[0]];
      npc = fuzzyFind(w.npcsIncludingTemplates(p.room), rec.name, n => n.name);
      if (!npc) return { lines: [{ kind: 'warn', text: `${rec.name}不在这里。` }] };
    } else {
      return {
        lines: [{
          kind: 'warn',
          text: '你拜过 ' + mids.map(id => p.masters[id].name).join('、') + '，请安哪位？（「请安 <师父名>」）',
        }],
      };
    }
    const r = require('./masterbond').callOn(w, p, npc);
    return { lines: r.lines };
  });

  /* 出师 / 退出师门（主人 2026-10-11）
   *
   * 两条路的味道正好相反，别混：
   *   · **出师**：好聚好散。交了满师的心意，名分解除，**好感是涨的**。
   *     门派师父没有这一条（门内换人走「拜师更高职位」）。
   *   · **退出师门**：断得难看。好感一次掉 60；若这个师承挂着门派，
   *     **该门派的传承武学一并废掉**（只废这一家的，别处学的功夫一根汗毛不动）。
   *
   * 都不带参数时，自动认「你唯一的师父」（一人只有一个师门）。 */
  const pickMaster = (w, p, kw) => {
    const DS = require('./discipleship');
    const cur = DS.currentMaster(p);
    if (kw) {
      const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
      return { npc, err: npc ? null : `这儿没有「${kw}」。` };
    }
    if (!cur) return { npc: null, err: '你还没有拜过师。' };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), cur.rec.name, n => n.name);
    return { npc, err: npc ? null : `${cur.rec.name}不在这里 —— 见面才谈得了这件事。` };
  };
  for (const [names, fn] of [
    [['出师', '满师', '出徒'], require('./discipleship').graduate],
    [['退出师门', '断绝师门', '背师'], require('./discipleship').quit],
  ]) {
    reg(names, (ctx, args) => {
      const w = ctx.world, p = ctx.player;
      const { npc, err } = pickMaster(w, p, (args || []).join(' ').trim());
      if (err) return { lines: [{ kind: 'warn', text: err }] };
      const r = fn(w, p, npc);
      return { lines: r.lines };
    });
  }

  /* ---- 私域拜访（#111 Step6 · design/09 §3.3）----
   * B/C 层 NPC 的家是 `house:<npcId>` 虚拟宅院，不在地图上。
   * 好感 ≥30 / 接过他支线 / 债主仇家 才有资格进门；进去能聊天、买卖。 */
  reg(['拜访', '造访', '登门', '上门'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想拜访谁？' }] };
    /* 🔴 B5 补漏（质量验收打回）：拜访是**玩家按键可触发**的位移，
       却直调 w.movePlayerTo 绕过 doMove 门禁 —— 我上一轮「所有自主位移
       都收敛doMove」的断言就是漏在这里（那次只审了 exec 的解析路径，
       没审 handler 内部）。可利用性：门槛只有 favor>=30，
       攒到好感后战斗中一句「拜访 张掌柜」就位移成功，且 battle 还挂着，
       等于「一边打着山贼一边窜进别人家」。
       门禁必须放在 visitHouse **之前**：放晚了房间已经建好，
       白跑一趟还会留下一个凭空多出来的私域。 */
    if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const kw = args.join(' ').trim();
    /* ⚠️ 只能拜访「本区域」的人（远房亲戚不必跑那么远）。
       用 allNpcs 全局找：主人可能不在场，去他家敲门才合理。 */
    const hit = fuzzyFind(w.allNpcs(), kw, n => n.name);
    if (!hit) return { lines: [{ kind: 'warn', text: `打听不到「${kw}」这号人物。` }] };
    const before = p.room;
    const r = w.visitHouse(hit.defId || hit.id, p.room);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [
      { kind: 'story', text: r.msg },
      { kind: 'plain', text: `（你能进门，只因${r.why}。）` },
    ];
    const mv = w.movePlayerTo(p, r.roomId);
    if (!mv.ok) return { lines };
    lines.push(...(lookRoom(ctx).lines || []));
    lines.push({ kind: 'hint', text: '（四下无人拦你。想走，原路出去便是。）' });
    void before;
    return { lines, moved: true };
  });

  /* 查看好感 */
  reg(['favor', '好感', '关系', 'renyuan'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      /* 列出本房间所有 NPC 的好感 */
      const list = w.npcsIncludingTemplates(p.room).filter(n => n.isNpc && !n.dead);
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有旁人。' }] };
      const lines = [{ kind: 'title', text: '【 此间人物 】' }];
      for (const n of list) {
        const t = social.favorTier(n.favor);
        lines.push({
          kind: 'favor',
          text: `${n.name}（${npcIdentity(w, n)}）　${t.name}（${n.favor || 0}）　${t.cn}`,
          color: t.color, favor: n.favor || 0, tier: t.name, npcId: n.id,
        });
      }
      lines.push({ kind: 'hint', text: '用「好感 <人名>」查看详情。' });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    return { lines: favorDetail(w, npc) };
  });

  /* 人物关系 */
  reg(['guanxi', '人物关系', '社交'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：guanxi <人名>　查看他与别人的关系' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const def = npc.def || {};
    const lines = [{ kind: 'title', text: `【 ${npc.name}的人际 】` }];
    const rel = npc.rel || def.rel || [];
    if (!rel.length) lines.push({ kind: 'plain', text: `　${pronounOf(npc)}孤身一人，似乎没有什么来往的人。` });
    for (const r of rel) {
      const o = w.data.npcs[r.id];
      if (!o) continue;
      const color = { 亲: '#c07a4a', 友: '#2f7a4a', 仇: '#a03030', 师: '#1f6f9a', 生: '#8a5ac2', 夫妻: '#c0306a' }[r.kind] || '#666';
      /* 括号里写**身份**，不写住处（主人：什么NPC都住本地，写了等于没写） */
      const who = npcIdentity(w, o);
      /* 好感度：他（当前查看的 NPC）对**这个目标**的好感，-100~100。
         ⚠️ 别用 npc.favor —— 那是「他对玩家」的好感，套到第三方头上会张冠李戴。
         优先级：① 运行时已浮动的 relFavor[r.id] ② 数据里的 r.favor
                 ③ 按 kind 给基准值（仇 -70 / 仇敌带随机 / 友 60 / 亲 90…）。 */
      const fv = relFavorBetween(npc, o, r);
      lines.push({
        kind: 'plain',
        text: `　${relKindCN(r.kind)}　${o.name}（${who}）　好感度：${fmtRelFavor(fv)}`,
        color, relId: r.id, relKind: r.kind, relFavor: fv,
      });
    }
    /* 他自己的好感 */
    const t = social.favorTier(npc.favor);
    lines.push({ kind: 'subtitle', text: '对你的态度' });
    lines.push({ kind: 'favor', text: `　${t.name}（${npc.favor || 0}）—— ${t.cn}`, color: t.color, tier: t.name });
    return { lines };
  });

  /* 请教武学（列出可请教的） */
  reg(['qingjiao', '请教', '求教'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：qingjiao <人名>　看看他愿意教你什么' }] };
    const kw = args.join(' ');
    let npc = null;
    let skillKw = '';
    /* `请教 <人名> <武学名>`：**先按两段解析**，再退回整串找人。
       ⚠️ 顺序不能反：`fuzzyFind` 是按包含关系模糊匹配的，
          "卖茶的老汉 长拳" 这种整串**能**匹配到人（网住了前四个字），
          于是 skillKw 永远是空 —— 玩家发「请教 某某 某功夫」只会得到一张清单，
          永远学不到东西（实测踩到）。所以先试两段。 */
    if (args.length >= 2) {
      const cand = fuzzyFind(w.npcsIncludingTemplates(p.room), args[0], n => n.name);
      if (cand) { npc = cand; skillKw = args.slice(1).join(' '); }
    }
    if (!npc) npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    const list = social.teachList(w, npc);
    if (!list.length) return { lines: [{ kind: 'warn', text: `${npc.name}摇摇头：「我这点本事，教不了人。」` }] };

    /* 拜过师的人：师父认了这份名分，他的功夫**必定教你**，不再看好感与银钱
       —— 主人 2026-10-10：「拜师后请教（可选择请教什么武学）必定成功」。
       ⚠️ 2026-10-08 口径更新：已学会的**不再从清单里剔掉**了 ——
          主人补的那条「潜能可以用来通过『请教』直接提升武学熟练度」让它们有了去处
          （花潜能请人点拨，当场涨一截）。所以分成两份：没学过的教你学会，学过的点拨你。 */
    const isMaster = !!(p.masters && p.masters[npc.defId || npc.id]);
    const shown = list.filter(s => !s.known);
    const known = list.filter(s => s.known);

    /* ---- 直接学：`请教 <人名> <武学名>` ---- */
    if (skillKw) {
      /* ⚠️ 先在**全表**（含已会）里精确找一次：
         已会的**不是**回「不必再请教」了 —— 主人 2026-10-08 补的那条：
         「潜能可以用来通过『请教』**直接提升武学熟练度**」。
         所以现在走「点拨」这条路：花潜能当场涨一截熟练度。
         （旧行为是「要精进请走练武学」，那条路仍然在，只是不再是唯一的路。） */
      const exactAll = list.find(s => s.name === skillKw);
      if (exactAll && exactAll.known) {
        /* 「不肯教」的硬理由（人被你绑着 / 门派传承…）——与面板同源，见 social.wontTeachReason */
        const whyUp = social.wontTeachReason(w, npc, exactAll.id);
        if (whyUp) return { lines: [{ kind: 'warn', text: whyUp }] };
        const sdUp = w.getSkill(exactAll.id) || {};
        const cur = p.skillLevel(exactAll.id) || 0;
        const teacherLv = potential.teacherLevelOf(npc, exactAll.id);
        const cap = potential.teachUpCap(p, sdUp, teacherLv);
        if (cur >= cap) {
          return {
            lines: [
              { kind: 'warn', text: `${npc.name}摇了摇头：「这一门，我已经没什么能教你的了。」` },
              { kind: 'hint', text: `（你的「${exactAll.name}」${cur} 级，能指点的上限是 ${cap} 级 —— 上限取**你自己内力/资质撑出来的天花板**与**${npc.name}那门功夫练到的级数**两者中低的一个。想再往上走：练内功吐纳抬自己的天花板，或另找这门功夫更高的人。）` },
            ],
          };
        }
        const gain = potential.teachUpGain(cap, cur);
        const cost = potential.raiseCostOf(sdUp, gain, cur);
        if ((p.potential || 0) < cost) {
          return {
            lines: [
              { kind: 'warn', text: `${npc.name}看了看你：「指点你一场也费精神。」` },
              { kind: 'hint', text: `（请${pronounOf(npc)}点拨「${exactAll.name}」${gain} 级要 ${cost} 点潜能，你只有 ${p.potential || 0} 点。自己练是**不花潜能**的 —— 用「练武学」一遍遍磨。）` },
            ],
          };
        }
        let need = 0;
        for (let lv = cur; lv < cur + gain; lv++) need += p.skillExpNeed(lv);
        p.potential = Math.max(0, (p.potential || 0) - cost);
        const up = p.gainSkillExp(exactAll.id, need);
        const now = p.skillLevel(exactAll.id) || 0;
        return {
          lines: [
            { kind: 'story', text: `${npc.name}让你把架势摆开，一手一手替你纠正过来，边改边说其中的分寸。` },
            { kind: 'sys', text: `「${exactAll.name}」${cur} → ${now} 级（+${Math.max(0, now - cur)}）。` },
            { kind: 'plain', text: `（耗去潜能 ${cost} 点，还剩 ${p.potential} 点；这门功夫能指点的上限是 ${cap} 级。）` },
            (up && up.msg) ? { kind: 'hint', text: up.msg } : null,
          ].filter(Boolean),
        };
      }
      const sd = shown.find(s => s.name === skillKw) || fuzzyFind(shown, skillKw, s => s.name);
      if (!sd) return { lines: [{ kind: 'warn', text: `${npc.name}不会「${skillKw}」。` }] };
      /* 「不肯教」的硬理由（人被你绑着 / 门派传承…）——与面板同源 */
      const whyLearn = social.wontTeachReason(w, npc, sd.id);
      if (whyLearn) return { lines: [{ kind: 'warn', text: whyLearn }] };
      const canFavor = (npc.favor || 0) >= sd.favorNeed;
      if (!isMaster && !canFavor && !sd.money) {
        return {
          lines: [
            { kind: 'warn', text: `${npc.name}摇头：「这门功夫不能轻传。」` },
            { kind: 'hint', text: `（需要好感 ${sd.favorNeed}。或者——拜${pronounOf(npc)}为师：师父教徒弟是天经地义，往后请教必定学得会。）` },
          ],
        };
      }
      /* ---- 花钱请教（武馆教头就走这条路）----
         🔴 这里原来**只判定不扣钱**：列表上写着「可花钱 100 文」，
         玩家点下去确实学到了，钱却一文没动 —— 铁律里那类「不报错但不生效」的变种，
         直接把武馆变成白送。现在补齐：钱不够就明说，够了就当场扣掉。
         （`learn <人名> <武学名>` 那条路一直是扣钱的，两处口径从此一致。） */
      /* ---- 潜能门槛（主人 2026-10-08）----
         「请教会消耗潜能（按武学品级以及等级从低到高消耗增多），但自己练不会消耗」。
         ⇒ 花潜能 = 走捷径（请人教）；苦练 = 自己磨（一点不花，见练武学/打坐那条路）。
         师门里打对折：师父教徒弟是本分，不该拿潜能把人拦在门外。 */
      const potNeed = potential.teachCostFor(p, sd, 0, isMaster);
      if ((p.potential || 0) < potNeed) {
        return {
          lines: [
            { kind: 'warn', text: `${npc.name}看了看你：「这东西不是白给的。」` },
            { kind: 'hint', text: `（请教「${sd.name}」要 ${potNeed} 点潜能，你只有 ${p.potential || 0} 点。潜能靠办事、见识、跟人过招攒——杀敌、交差、走没走过的地方，都算。）` },
          ],
        };
      }
      const byMoney = !isMaster && !canFavor && sd.money > 0;
      if (byMoney) {
        const have = p.money || 0;
        if (have < sd.money) {
          return {
            lines: [
              { kind: 'warn', text: `${npc.name}把手一摊：「束脩先备齐。」` },
              { kind: 'hint', text: `（「${sd.name}」要 ${sd.money} 文，你身上只有 ${have} 文。）` },
            ],
          };
        }
        p.money -= sd.money;
      }
      const r = p.learnSkill(sd.id, { force: true });
      if (!r.ok) {
        if (byMoney) p.money += sd.money;     /* 没学成，钱得退回去 */
        return { lines: [{ kind: 'warn', text: r.msg }] };
      }
      /* 学成了才扣潜能（学不成不扣 —— 上面那条 r.ok 分支已经 return） */
      p.potential = Math.max(0, (p.potential || 0) - potNeed);
      const out = [
        { kind: 'story', text: `${npc.name}把「${sd.name}」的口诀心法一句句讲与你听，又亲手替你摆正了架子。` },
        { kind: 'sys', text: r.msg },
        { kind: 'plain', text: `（耗去潜能 ${potNeed} 点，还剩 ${p.potential} 点。自己练不花潜能 —— 往后要精进，用「练武学」一遍遍磨。）` },
      ];
      if (byMoney) out.push({ kind: 'plain', text: `（交了束脩 ${sd.money} 文，还剩 ${p.money} 文。）` });
      /* 师父教徒弟是**从基本功教起**的：这门功夫挂在一条 `base` 链上
         （养吾剑法 → 华山剑法 → 基本剑法），而链上任何一环没练上去，
         衍生功夫的 effectiveMax 就被卡死 —— 玩家学了招式却一级都升不了，
         只会当游戏坏了。所以**整条链一并给你**（从根往下，按顺序说给玩家听）。 */
      const chain = [];
      let cur = (w.getSkill(sd.id) || {}).base, guard = 0;
      while (cur && guard++ < 8) { chain.unshift(cur); cur = (w.getSkill(cur) || {}).base; }
      for (const cid of chain) {
        if (p.learned[cid]) continue;
        const cd = w.getSkill(cid);
        const rc = p.learnSkill(cid, { force: true });
        if (rc.ok && cd) out.push({ kind: 'plain', text: `${npc.name}又把「${cd.name}」的路子给你从头捋了一遍——底子不打牢，招式再花也是空的。` });
      }
      if (isMaster) out.push({ kind: 'hint', text: '（学会了只是个架子。往后要精进，用「练武学」一遍遍磨。）' });
      p.advanceTime(30 + ((w.getSkill(sd.id) || {}).difficulty || 1) * 10);
      return { lines: out };
    }

    const t = social.favorTier(npc.favor);
    const lines = [
      { kind: 'title', text: `【 ${npc.name}可教的武学 】` },
      isMaster
        ? { kind: 'hint', text: '这是你师父。他手上的功夫，你要学哪一门？（已会的不会再列出来）' }
        : { kind: 'plain', text: `当前好感：${npc.favor || 0}（${t.name}）` },
    ];
    for (const s of shown) {
      const canFavor = (npc.favor || 0) >= s.favorNeed;
      const canMoney = s.money > 0;
      const marks = [];
      if (isMaster) marks.push('师父必教');
      else if (canFavor) marks.push('好感已够');
      if (canMoney) marks.push(`可花钱 ${s.money} 文`);
      /* 潜能价（主人 2026-10-08）——列在这儿玩家才能算着学，不用点进去才知道不够 */
      marks.push(`潜能 ${potential.teachCostFor(p, s, 0, isMaster)}`);
      lines.push({
        kind: 'skill',
        text: `${s.name}　【${s.quality}】　${s.type}　强度 ${s.power}　需好感 ${s.favorNeed}${marks.length ? '　' + marks.join(' / ') : ''}`,
        skillId: s.id, favorNeed: s.favorNeed, money: s.money, ok: isMaster || canFavor || canMoney,
      });
    }
    /* 已会的功夫：走「点拨」——花潜能当场涨一截熟练度（主人 2026-10-08） */
    if (known.length) {
      lines.push({ kind: 'title', text: '【 请他点拨（花潜能，直接涨熟练度） 】' });
      for (const s of known) {
        const sdUp = w.getSkill(s.id) || {};
        const cur = p.skillLevel(s.id) || 0;
        const cap = potential.teachUpCap(p, sdUp, potential.teacherLevelOf(npc, s.id));
        const gain = potential.teachUpGain(cap, cur);
        const cost = gain > 0 ? potential.raiseCostOf(sdUp, gain, cur) : 0;
        lines.push({
          kind: 'skill',
          text: gain > 0
            ? `${s.name}　${cur} 级 → 可指点到 ${cur + gain} 级（上限 ${cap}）　潜能 ${cost}`
            : `${s.name}　${cur} 级　已到他能指点的上限 ${cap}（想再高：练内功抬自己天花板，或另寻高人）`,
          skillId: s.id, potCost: cost, upTo: cur + gain, ok: gain > 0 && (p.potential || 0) >= cost,
        });
      }
    }
    lines.push({ kind: 'hint', text: isMaster ? `用「请教 ${npc.name} <武学名>」——师父教你，一句话的事。` : `用「请教 <人名> <武学名>」请教；好感够就免费，不够可花钱（若${pronounOf(npc)}肯收）。` });
    return { lines };
  });

  /* 送礼指令：送礼 <人> <物品> */
  reg(['song', '送礼'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：song <人名> <物品名>（或「送礼 <人> <物>」）' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args[0], n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args[0]}」。` }] };
    return CMD['give'].run(ctx, [args.slice(1).join(' '), 'to', npc.name]);
  });

  /* 给钱 */
  reg(['give_money', '给钱', '赠银', '塞钱'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：give_money <人名> <钱数>（或「给 <人名> 100 文」）' }] };
    /* ★ 参数顺序两种都认。
       原签名是 `give_money <人名> <钱数>`，而前端「给 他 银钱」面板发的是
       `give_money <钱数> to <人名>` —— 顺序反了，玩家点下去只会得到
       「这里没有「100」。」（主人报的「送他东西」面板里就有这一项）。
       与其只改前端（存档里的老档、mod、教程文本都还按老格式写），
       不如在后端**认顺序**：哪个 token 能解析成数字，哪个就是钱数。
       ⇒ `give_money 范清 100` / `give_money 100 to 范清` / `给钱 100 给 范清` 全通。 */
    const toks = args.filter(t => !/^(to|给|送给?)$/i.test(t));
    let amtTok = null; const nameToks = [];
    for (const t of toks) {
      const asNum = cnNum(t);
      const isNumTok = (asNum != null && asNum > 0) || /^\d+$/.test(t);
      if (amtTok == null && isNumTok) amtTok = t;
      else nameToks.push(t);
    }
    const nameKw = nameToks.join(' ').trim();
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), nameKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${nameKw || args[0]}」。` }] };
    const amt = amtTok == null ? 0 : (cnNum(amtTok) || parseInt(amtTok, 10));
    if (!amt || amt <= 0) return { lines: [{ kind: 'warn', text: '你要给多少？' }] };
    if (p.money < amt) return { lines: [{ kind: 'warn', text: `你只有 ${p.money} 文钱。` }] };
    p.money -= amt;
    /* 记一笔往来（与 give 同一个 noteGift）—— 面板要显示「给了多少银子」 */
    noteGift(npc, 'money', null, amt);
    /* 给钱好感：按对方身价折算，太少了反而被看轻 */
    const worth = Math.max(50, (npc.def && npc.def.money) || 100);
    const ratio = amt / worth;
    let dv = Math.round(ratio * 12);
    if (amt < 10) dv = -1;
    if (dv > 30) dv = 30;
    /* 天赋「口才便给」：正向好感放大（塞钱少被看轻的那条 dv=-1 不吃倍率） */
    const r = social.addFavor(w, npc, dv > 0 ? dv * w.favorGainMult(p) : dv, '赠银');
    const lines = [{ kind: 'sys', text: `你把 ${amt} 文钱塞到${npc.name}手里。` }];
    lines.push({ kind: 'say', text: amt >= worth * 0.5 ? `${npc.name}推辞了两下，还是收了，脸上有了笑意。` : `${npc.name}接了钱，点了点头。` });
    lines.push(...r.lines);
    /* B22 埋点 4/14 · rs_alms（施舍行善，善名 +）：给乞丐/流民/贫民钱即记一笔。 */
    if (isPoor(npc) && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_alms', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });

  /* 切磋 */
  reg(['qiecuo', '切磋', '比试'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：qiecuo <人名>　与他点到为止地比一场' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    if (npc.dead) return { lines: [{ kind: 'warn', text: `${npc.name}已经死了。` }] };
    const r = w.startDuel(p, npc);
    return { lines: r.lines, action: r.action, battle: r.battle };
  });

  /* 偷窃 */
  reg(['steal', '偷', '偷窃', '摸'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：steal <人名> [物品名|钱]' }] };
    const npcKw = args[0];
    const which = args.length > 1 ? args.slice(1).join(' ') : 'money';
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    /* 有旁人在场 → 风险提示 */
    const others = w.npcsIncludingTemplates(p.room).filter(n => n.id !== npc.id && n.isNpc && !n.dead);
    const r = social.trySteal(w, npc, which === '钱' ? 'money' : which);
    const lines = r.lines.slice();
    if (others.length && r.ok) {
      lines.push({ kind: 'hint', text: `（此地还有旁人看着，幸好没被发现。）` });
    }
    /* B22 埋点 1/14 · rs_theft_caught（偷窃被抓，恶名 −）：人赃并获 → 同房间目击即传。 */
    if (r.caught && typeof w.addRumor === 'function') {
      const rm = w.getRoom(p.room);
      w.addRumor('rs_theft_caught', { room: p.room, about: npc.defId,
        vars: { who: p.name || '有人', where: (rm && rm.name) || '此地', whom: npc.name } });
    }
    return { lines };
  });


  /* ================================================================
   * 婚姻 / 结缘（第二批）
   * ================================================================ */

  /* ============================================================
   * 结缘线（主人 2026-10-10）：表白 → 男女朋友 → 才谈得上结婚 / 纳妾；另有结义
   *   规矩：**必须先表白**，提亲与纳妾都以此为门槛（门禁只加在指令层，
   *         不动 marriage.js 的 API —— 别的地方（剧情/测试）直调要走得通）。
   * ============================================================ */
  const loverId = npc => (npc && (npc.defId || npc.id)) || null;
  const isLover = (p, npc) => {
    const id = loverId(npc);
    return !!id && (p.lovers || []).some(x => (x.npcId || x.id) === id);
  };
  const findHere = (w, p, who) => (w.npcsIncludingTemplates(p.room) || []).find(n =>
    !n.isPlayer && n.name && (n.name === who || n.name.indexOf(who) >= 0));

  reg(['表白', '示爱', '说心里话'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const who = args.join(' ').trim();
    if (!who) return { lines: [{ kind: 'warn', text: '你要跟谁说这句话？' }] };
    const npc = findHere(w, p, who);
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${who}」这号人物。` }] };
    if (isLover(p, npc)) return { lines: [{ kind: 'plain', text: `你与${npc.name}的事，早就说开了。` }] };
    if (npc.gender === p.gender) {
      return { lines: [{ kind: 'plain', text: `你把话说到一半，${npc.name}愣住了，把话岔了开去。` }, { kind: 'sys', text: '（这一层意思，对方接不住。）' }] };
    }
    const need = 40;
    const fav = npc.favor || 0;
    if (fav < need) {
      return { lines: [
        { kind: 'plain', text: `你话到嘴边，${npc.name}只当你说的是别的。` },
        { kind: 'warn', text: `${npc.name}与你的交情还不到说这个的时候（好感 ${Math.round(fav)}/${need}）。` },
      ] };
    }
    const chance = Math.max(0.1, Math.min(0.9, 0.25 + (fav - need) * 0.012));
    if (w.rng.next() < chance) {
      p.lovers = p.lovers || [];
      p.lovers.push({ npcId: loverId(npc), name: npc.name, since: w.clockMinutes });
      npc.favor = fav + 10;
      return { lines: [
        { kind: 'story', text: `你说完了。${npc.name}低着头站了一会儿，才抬起眼来看你，说了句「知道了」。` },
        { kind: 'sys', text: `你与${npc.name}从今往后，是两心相许的关系了（好感 +10）。` },
        { kind: 'hint', text: '（往后再谈婚嫁，都从这里起。）' },
      ] };
    }
    npc.favor = fav - 6;
    return { lines: [
      { kind: 'plain', text: `${npc.name}听完，摇了摇头：「这话你收回去。」` },
      { kind: 'sys', text: `${npc.name}有些为难（好感 −6）。` },
    ] };
  });

  /** 提亲：提亲 <人名> [酒楼|家中] */
  reg(['propose', '提亲', '求亲', '说媒'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      /* 无参数 → 列本房间可提亲的人 */
      const list = marriage.candidates(w, 'marry');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有可论婚嫁的人。' }] };
      const lines = [{ kind: 'title', text: '【 议亲对象 】' }];
      for (const c of list) {
        lines.push({
          kind: c.ok ? 'favor' : 'plain',
          text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔ 可以提亲' : '　✘ ' + c.reason}`,
          npcId: c.id,
        });
      }
      lines.push({ kind: 'hint', text: '用「提亲 <人名> [酒楼|家中]」正式下聘。' });
      return { lines };
    }
    const venueKw = ['酒楼', '酒店', 'hall'].includes(args[args.length - 1]) ? 'hall'
                  : ['家中', '家里', '家', 'home'].includes(args[args.length - 1]) ? 'home' : null;
    const nameArgs = venueKw ? args.slice(0, -1) : args;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), nameArgs.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${nameArgs.join(' ')}」。` }] };
    /* 门禁（主人定的规矩）：没表白过，就谈不上婚嫁 */
    if (!isLover(p, npc)) {
      return { lines: [
        { kind: 'plain', text: `你才要开口说正经事，${npc.name}就把脸转开了。` },
        { kind: 'warn', text: `这门亲事说不出口 —— 你们还没到那一步。先去「表白 <人名>」。` },
      ] };
    }
    const r = marriage.propose(w, npc, venueKw || 'home');
    return { lines: r.lines };
  });

  /** 退亲 / 悔婚：把已经下过聘的亲事退掉。
   *  ⚠️ 只退**还没过门**的（`p.marriage.plan`）。已经成过亲的是另一码事，
   *     这里不碰 —— 免得一句指令把存档里的婚姻关系抹掉。
   *  B22：退亲要出「风评」的传闻（`rs_break_marriage` 此前是死种子）——
   *  当众退亲本来就是最招人议论的那一类事。 */
  reg(['退亲', '悔婚', '退婚'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const m = p.marriage;
    if (!m || !m.plan) {
      return { lines: [{ kind: 'warn', text: '你身上没有还没过门的亲事。' }] };
    }
    const plan = m.plan;
    const npc = marriage.defById(w, plan.npc) || {};
    const name = npc.name || '对方';
    m.plan = null;
    m.stage = marriage.STAGES.NONE;
    if (typeof w.addRumor === 'function') {
      const room = w.getRoom(p.room) || {};
      w.addRumor('rs_break_marriage', { room: p.room, about: plan.npc, vars: { who: p.name || '有人', where: room.name || '此地' } });
    }
    return { lines: [
      { kind: 'sys', text: `你把话带到${name}家，把聘礼一样一样收了回来。这门亲事，退了。` },
      { kind: 'hint', text: '（街面上该有闲话了。若还想提亲，得先「表白」再重新下聘。）' },
    ] };
  });

  /** 请客：请客 <人名> */
  reg(['invite', '请客', '下帖'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：请客 <人名>　请他来喝你的喜酒' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = marriage.invite(w, npc.id);
    return { lines: r.lines };
  });

  /** 办酒：正式开席 */
  reg(['feast', '办酒', '开席', '摆酒'], (ctx, args) => {
    const r = marriage.holdFeast(ctx.world);
    return { lines: r.lines };
  });

  /** 入洞房 */
  reg(['consummate', '入洞房', '洞房', '拜堂'], (ctx, args) => {
    const r = marriage.consummate(ctx.world);
    return { lines: r.lines };
  });

  /** 纳妾 */
  reg(['concubine', '纳妾', '纳小'], (ctx, args) => {
    const w = ctx.world;
    if (!args.length) {
      const list = marriage.candidates(w, 'concubine');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地无人可纳。' }] };
      const lines = [{ kind: 'title', text: '【 可纳之人 】' }];
      for (const c of list) lines.push({ kind: c.ok ? 'favor' : 'plain', text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔' : '　✘ ' + c.reason}`, npcId: c.id });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(w.player.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    /* 同一条门禁：纳妾也要先有那一层情分 */
    if (!isLover(w.player, npc)) {
      return { lines: [{ kind: 'warn', text: `${npc.name}是你什么人？话没说清之前，这事办不成（先去「表白」）。` }] };
    }
    const r = marriage.takeConcubine(w, npc);
    return { lines: r.lines };
  });

  /** 结缘 */
  reg(['bond', '结缘', '定情', '私定终身'], (ctx, args) => {
    const w = ctx.world;
    if (!args.length) {
      const list = marriage.candidates(w, 'bond');
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地无人可结缘。' }] };
      const lines = [{ kind: 'title', text: '【 可以结缘的人 】' }, { kind: 'hint', text: '（结缘不限男女，年龄须不满 45，不占正室之位）' }];
      for (const c of list) lines.push({ kind: c.ok ? 'favor' : 'plain', text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}${c.ok ? '　✔' : '　✘ ' + c.reason}`, npcId: c.id });
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(w.player.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = marriage.makeBond(w, npc);
    return { lines: r.lines };
  });

  /** 姻缘：查看婚姻状况 */
  reg(['marriage', '姻缘', '配偶', '婚配', '家室'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const s = marriage.summary(w);
    const lines = [{ kind: 'title', text: '【 姻 缘 簿 】' }];
    if (s.spouse) {
      const sp = s.spouse;
      lines.push({ kind: 'favor', text: `正室　${sp.name}　${genderNoun(sp)}　${sp.age || '?'} 岁`, color: '#c0306a' });
      if (sp.homeName) lines.push({ kind: 'plain', text: `　居所：${sp.homeName}（你可自由出入）` });
    } else {
      lines.push({ kind: 'plain', text: '　尚未娶亲。' });
    }
    if (s.concubines.length) {
      lines.push({ kind: 'subtitle', text: '妾室' });
      for (const c of s.concubines) lines.push({ kind: 'plain', text: `　${c.name}　${genderNoun(c)}　${c.age || '?'} 岁` });
    }
    if (s.bonds.length) {
      lines.push({ kind: 'subtitle', text: '结缘' });
      for (const c of s.bonds) lines.push({ kind: 'plain', text: `　${c.name}　${genderNoun(c)}　${c.age || '?'} 岁` });
    }
    if (s.plan) {
      lines.push({ kind: 'subtitle', text: '在议' });
      lines.push({ kind: 'story', text: `　与${s.plan.name}的婚事已定，${s.plan.venueName}（聘礼 ${s.plan.gift} 文 + 席面 ${s.plan.cost} 文）` });
      lines.push({ kind: 'hint', text: '　发「办酒」开席。' });
    }
    const ks = kinship.summary(w);
    if (ks && ks.total) {
      lines.push({ kind: 'subtitle', text: '义亲结拜' });
      for (const g of ['father', 'mother', 'brothers', 'sisters', 'sons', 'daughters']) {
        for (const x of ks[g]) lines.push({ kind: 'plain', text: `　${x.label}　${x.name}` });
      }
    }
    if (!s.spouse && !s.concubines.length && !s.bonds.length && !s.plan && (!ks || !ks.total)) {
      lines.push({ kind: 'hint', text: '　你尚是孤身一人。去江湖上走走吧。' });
    }
    return { lines };
  });


  /* ================================================================
   * 结拜 / 义亲（第二批）
   * ================================================================ */

  /** 结拜：自动判断该认干亲还是拜把子 */
  reg(['swear', '结拜', '义结金兰', '拜把子', '认亲'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      const list = kinship.candidates(w);
      if (!list.length) return { lines: [{ kind: 'warn', text: '此地没有可与结拜的人。' }] };
      const lines = [{ kind: 'title', text: '【 可结拜的人 】' }, { kind: 'hint', text: '（年长 15 岁以上为义父/义母，相差不足 15 岁为义兄弟/义姐妹/义兄妹）' }];
      for (const c of list) {
        lines.push({
          kind: c.ok ? 'favor' : 'plain',
          text: `${c.name}　${genderNoun(c)}　${c.age} 岁　好感 ${c.favor}` +
                (c.ok ? `　✔ 可结为${c.label}` : `　✘ ${c.reason}`),
          npcId: c.id,
        });
      }
      return { lines };
    }
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = kinship.swear(w, npc);
    return { lines: r.lines };
  });

  /** 断义 */
  reg(['sever', '断义', '绝交', '割袍'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：断义 <人名>' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = kinship.sever(w, npc.id);
    return { lines: r.lines };
  });

  /** 亲人：义亲名册 */
  reg(['kin', '亲人', '义亲', '族谱', '家谱'], (ctx, args) => {
    const w = ctx.world;
    const k = kinship.summary(w);
    if (!k || !k.total) return { lines: [{ kind: 'plain', text: '你在江湖上尚无结拜之亲。发「结拜」可与人义结金兰。' }] };
    const lines = [{ kind: 'title', text: '【 义 亲 名 册 】' }];
    const groups = [
      ['father', '义父'], ['mother', '义母'],
      ['brothers', '义兄弟'], ['sisters', '义姐妹'],
      ['sons', '义子'], ['daughters', '义女'],
    ];
    for (const [key, cn] of groups) {
      if (!k[key].length) continue;
      lines.push({ kind: 'subtitle', text: cn });
      for (const x of k[key]) {
        const where = x.homeName ? `　（${x.homeName}）` : '';
        lines.push({
          kind: 'plain',
          text: `　${x.name}　${genderNoun(x)}　${x.age || '?'} 岁　好感 ${x.favor}${x.dead ? '　【已故】' : ''}${where}`,
          npcId: x.id, color: x.dead ? '#8a8a8a' : undefined,
        });
      }
    }
    lines.push({ kind: 'hint', text: `共 ${k.total} 人。发「断义 <人名>」可割袍断义。` });
    return { lines };
  });


  /* ================================================================
   * 家园（第二批）
   * ================================================================ */

  /** 买宅 */
  reg(['buyhome', '买宅', '买房', '置宅', '买屋'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) {
      const lines = [{ kind: 'title', text: '【 待售宅院 】' }];
      for (const t of homeMod.tiersOf()) {
        lines.push({ kind: 'favor', text: `　${t.name}　${t.price} 文　（可放 ${t.capacity} 件家当）`, itemId: t.id });
        lines.push({ kind: 'plain', text: `　　${t.desc}` });
      }
      lines.push({ kind: 'hint', text: '用法：买宅 <名称>　（须在衙门签押房立契）' });
      return { lines };
    }
    const kw = args.join(' ');
    const t = homeMod.tiersOf().find(x => x.name.includes(kw) || x.id === kw || kw.includes(x.name.slice(1, 3)));
    const r = homeMod.buy(w, t ? t.id : kw);
    /* B22 埋点 13/14 · rs_bigspender（置宅是大手笔，市井要传）。 */
    if (r && r.ok && typeof w.addRumor === 'function') {
      w.addRumor('rs_bigspender', { room: p.room, vars: { who: p.name || '有人', where: (w.getRoom(p.room) || {}).name || '衙门', whom: '中人' } });
    }
    return { lines: r.lines };
  });

  /** 卖宅 */
  reg(['sellhome', '卖宅', '卖房', '售宅'], (ctx) => {
    return { lines: homeMod.sell(ctx.world).lines };
  });

  /** 回家 */
  reg(['home', '回家', '回府', '归家'], (ctx) => {
    /* 🔴 B5 同类漏网之二（本次全仓审计时自己发现的）：
       goHome 直接 `p.room = p.home`（home.js:363/352），连
       movePlayerTo 都不走，是**第二条**能脱战位移的按键路径。
       同样在进handler 第一时间拦。 */
    if (ctx.world.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const r = homeMod.goHome(ctx.world);
    return { lines: r.lines, moved: !!r.moved };
  });

  /** 布置（改自家描述） */
  reg(['decorate', '布置', '陈设', '收拾屋子'], (ctx, args) => {
    return { lines: homeMod.decorate(ctx.world, args.join(' ')).lines };
  });

  /** 置办家具 */
  reg(['furnish', '置办', '添置', '买家具'], (ctx, args) => {
    return { lines: homeMod.furnish(ctx.world, args.join(' ')).lines };
  });

  /** 家宅：查看自己的产业 */
  reg(['estate', '家宅', '房产', '我的家'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const s = homeMod.summary(w);
    const lines = [{ kind: 'title', text: '【 家 宅 】' }];
    if (!s.hasHome && !s.homes.length) {
      lines.push({ kind: 'plain', text: '　你尚无片瓦遮身。' });
    } else {
      for (const h of s.homes) {
        const cur = p.home === h.id ? '　← 现居' : '';
        lines.push({ kind: 'favor', text: `　${h.name}　（${(homeMod.TIER_MAP[h.tier] || {}).name || h.tier}）${cur}` });
      }
    }
    lines.push({ kind: 'sys', text: `　家当总值：${s.estateValue} 文` });
    if (s.partnerHome) {
      lines.push({ kind: 'subtitle', text: '伴侣居所' });
      lines.push({ kind: 'plain', text: `　${s.partnerHome.of}的家：${s.partnerHome.name}（你可出入布置）` });
    }
    const here = homeMod.roomInfo(w, p.room);
    if (here && here.mine) {
      lines.push({ kind: 'subtitle', text: '所在' });
      lines.push({ kind: 'sys', text: `　${here.name}　家当 ${here.furniture.length} / ${here.capacity}` });
      if (here.furniture.length) {
        lines.push({ kind: 'plain', text: '　' + here.furniture.map(f => (homeMod.FURN_MAP[f] || {}).name).filter(Boolean).join('、') });
      }
    }
    lines.push({ kind: 'hint', text: '「买宅」「卖宅」「回家」「布置 <描述>」「置办 <家具>」' });
    return { lines };
  });


  /* ---------------- 生存：打工 / 青楼 ---------------- */

  /** 打工：在酒楼/药店打零工赚钱 */
  reg(['work', '打工', '干活', '做工'], (ctx) => {
    const r = workMod.work(ctx.world);
    return { lines: r.lines };
  });

  /** 卖身青楼（仅女玩家） */
  reg(['sellbody', '卖身', '入青楼', '挂牌'], (ctx) => {
    const r = workMod.sellBody(ctx.world);
    return { lines: r.lines };
  });

  /** 接客攒钱（卖身后） */
  reg(['serve', '接客', '接客攒钱'], (ctx) => {
    const r = workMod.serveCustomer(ctx.world);
    return { lines: r.lines };
  });

  /** 赎身 —— 一个名字，按当前所在场景分派（主人定的规矩）
   *  · 在黑市（被掳走关着）→ 黑市赎金（kidnap.redeemSelf）
   *  · 在青楼（卖身挂着）  → 青楼赎身（work.redeem）
   *  · 都不在               → 没效果，提示一句，不报错
   * 三个去向都不是的时候就不该有响应 —— 「赎身」是地点动作，不是全局动作。*/
  reg(['redeem', '赎身', '脱籍'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const k = kidnapMod.data(w);
    /* ① 黑市：人被掳走关在这儿，赎金另算 */
    if (kidnapMod.inBlackMarket(w)) return { lines: kidnapMod.redeemSelf(w).lines };
    /* ② 青楼：卖身契还挂着 */
    if (kidnapMod.inBrothel(w) && p.prostitution && p.prostitution.sold) {
      return { lines: workMod.redeem(w).lines };
    }
    /* ③ 都不在 */
    const where = (w.getRoom(p.room) || {}).name || '此处';
    if (k && k.debt) {
      /* 被掳走但不在黑市（如被卖进青楼）：赎回自己得在关你的地方办 */
      return { lines: [{ kind: 'plain', text: `　你被扣在${where}，赎身得找这里的人说。` }] };
    }
    if (kidnapMod.inBrothel(w)) {
      return { lines: [{ kind: 'plain', text: '　你在青楼，却没卖身契——没什么可赎的。' }] };
    }
    return { lines: [{ kind: 'plain', text: `　${where}不是能赎身的地方。` }] };
  });

  /** 查看身世 / 卖身状态 */
  reg(['prostitution', '身世', '卖身契', '青楼', '营生'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 营 生 】' }];
    const ps = p.prostitution;
    if (!ps || !ps.sold) {
      lines.push({ kind: 'plain', text: '　你身家清白，不是风尘中人。' });
      const c = workMod.canWork(w);
      lines.push({ kind: c.ok ? 'sys' : 'plain', text: '　' + (c.ok ? `你可以在${(w.getRoom(p.room) || {}).name}「打工」赚钱。` : c.reason) });
      if (p.gender === 'female') lines.push({ kind: 'hint', text: '　（女子若走投无路，可在青楼「卖身」换一笔银钱。）' });
    } else {
      lines.push({ kind: 'favor', text: `　你现是青楼之人，已接客 ${ps.served || 0} 回。` });
      lines.push({ kind: 'plain', text: `　赎身债还差 ${ps.debt} 文（「接客」所得尽数抵债）。` });
      lines.push({ kind: 'hint', text: '「接客」还债，「赎身」脱籍；有交情深的贵人，也肯替你赎身。' });
    }
    return { lines };
  });


  /* ---------------- 采集 / 农田（第 4 批） ---------------- */

  /** 打水（需容器） */
  reg(['drawwater', '打水', '取水', '盛水'], (ctx) => {
    const r = gather.drawWater(ctx.world);
    return { lines: r.lines };
  });

  /** 切割尸体（需利器，只能切野兽） */
  reg(['butcher', '切割', '切肉', '剥皮', '剖尸'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    // 找当前房间的尸体
    const corpses = w.corpsesIn(p.room);
    if (!corpses.length) return { lines: [{ kind: 'warn', text: '这里没有尸体可切割。' }] };
    const kw = args.join(' ');
    let target = corpses[0];
    if (kw) target = corpses.find(c => c.name.includes(kw)) || corpses[0];
    const r = gather.butcher(w, target.id);
    return { lines: r.lines };
  });

  /** 生肉加工（客栈/酒楼） */
  reg(['cook', '加工', '烹制', '做熟'], (ctx) => {
    const r = gather.cook(ctx.world);
    return { lines: r.lines };
  });

  /** 买地 */
  reg(['buyland', '买地', '买田', '置田'], (ctx) => {
    const r = farm.buyLand(ctx.world);
    return { lines: r.lines };
  });

  /** 种植 */
  reg(['plant', '种植', '播种', '种地'], (ctx, args) => {
    const p = ctx.player;
    let seedId = args.join(' ');
    const map = { 稻种: 'seed_rice', 稻: 'seed_rice', 菜种: 'seed_vegetable', 菜: 'seed_vegetable', 蔬菜: 'seed_vegetable' };
    seedId = map[seedId] || (seedId === 'seed_rice' || seedId === 'seed_vegetable' ? seedId : null);
    if (!seedId) return { lines: [{ kind: 'warn', text: '用法：种植 <稻种|菜种>（身上得有种子）' }] };
    const r = farm.plant(ctx.world, seedId);
    return { lines: r.lines };
  });

  /** 收割 */
  reg(['harvest', '收割', '收成', '收获'], (ctx) => {
    const r = farm.harvest(ctx.world);
    return { lines: r.lines };
  });

  /** 偷庄稼 */
  reg(['stealcrop', '偷庄稼', '偷菜', '摸庄稼'], (ctx) => {
    const r = farm.stealCrop(ctx.world);
    return { lines: r.lines };
  });

  /** 查看田地 */
  reg(['farmland', '田地', '我的田', '庄稼'], (ctx) => {
    const p = ctx.player;
    const lines = [{ kind: 'title', text: '【 田 地 】' }];
    const f = p.farm;
    if (!f || !f.plot) {
      lines.push({ kind: 'plain', text: '　你尚无田地。可去田头佃户家「买地」。' });
    } else {
      const roomName = (ctx.world.getRoom(f.plot) || {}).name || f.plot;
      lines.push({ kind: 'favor', text: `　你在${roomName}有一块田。` });
      if (f.seedId) {
        const grow = farm.GROW_MIN[f.seedId] || 0;
        const elapsed = ctx.world.clockMinutes - (f.plantedAt || 0);
        const remain = Math.max(0, grow - elapsed);
        const remainDays = Math.round(remain / 1440 * 10) / 10;
        const seedName = (ctx.world.getItem(f.seedId) || {}).name || f.seedId;
        lines.push({ kind: 'plain', text: `　田里种着${seedName}，${remainDays > 0 ? `还需约 ${remainDays} 天长成` : '已经成熟，可「收割」了'}。` });
      } else {
        lines.push({ kind: 'plain', text: '　田里空着，可「种植 <稻种|菜种>」。' });
      }
    }
    return { lines };
  });


  /* ---------------- 官府 / 牢狱 / 通缉（第 5 批） ---------------- */

  /** 赎人：在衙门大牢里交赎金保释被抓的 NPC */
  reg(['bail', '赎人', '保释'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room || !/监狱|大牢|牢/.test(room.name || '')) {
      return { lines: [{ kind: 'warn', text: '你得去衙门大牢，才能赎人。' }] };
    }
    const jailed = Object.keys(w.jail || {});
    if (!args.length) {
      if (!jailed.length) return { lines: [{ kind: 'plain', text: '牢里空荡荡的，没有关着什么人。' }] };
      const lines = [{ kind: 'title', text: '【 牢 房 】' }];
      for (const defId of jailed) {
        const j = w.jail[defId];
        lines.push({ kind: 'plain', text: `　${j.name}　（赎金 ${j.ransom} 文）` });
      }
      lines.push({ kind: 'hint', text: '「赎人 <人名>」交赎金保释，赎出后对方必对你感激涕零。' });
      return { lines };
    }
    const kw = args.join(' ');
    const defId = jailed.find(id => (w.jail[id].name || '').includes(kw) || kw.includes(w.jail[id].name));
    if (!defId) return { lines: [{ kind: 'warn', text: '牢里没有关着这个人。' }] };
    const j = w.jail[defId];
    if (p.money < j.ransom) return { lines: [{ kind: 'warn', text: `赎金需 ${j.ransom} 文，你身上只有 ${p.money} 文。` }] };
    p.money -= j.ransom;
    delete w.jail[defId];
    const inst = w.spawnNpc(defId, p.room, 1, true);
    if (inst) social.addFavorTo(w, defId, 50, '赎身搭救');
    return {
      lines: [
        { kind: 'story', text: `你替${j.name}交了 ${j.ransom} 文赎金，差役开了枷锁。` },
        { kind: 'sys', text: `${j.name}重见天日，对你千恩万谢（好感大增）。` },
      ],
    };
  });

  /** 通缉告示：官府/衙门看通缉要犯 + 接悬赏 */
  reg(['bounty', '通缉', '悬赏', '接悬赏'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room || !/衙门|签押|告示|官/.test(room.name || '')) {
      return { lines: [{ kind: 'warn', text: '通缉告示贴在官府 / 衙门，去那儿看。' }] };
    }
    // 通缉犯 = 盗贼/赌徒类 NPC
    const wanted = Object.values(w.data.npcs).filter(d => (d.tag === 'thief' || d.tag === 'gambler'));
    if (args.length) {
      const kw = args.join(' ');
      const t = wanted.find(d => d.name.includes(kw) || kw.includes(d.name));
      if (!t) return { lines: [{ kind: 'warn', text: '告示上没有这个通缉犯。' }] };
      p.bounty = t.id;
      return { lines: [{ kind: 'story', text: `你揭下缉拿${t.name}的告示。擒获此人（打晕或击杀），即可回衙门领赏。` }] };
    }
    if (!wanted.length) return { lines: [{ kind: 'plain', text: '告示栏上空空如也。' }] };
    const lines = [{ kind: 'title', text: '【 通 缉 告 示 】' }];
    for (const d of wanted.slice(0, 4)) {
      lines.push({ kind: 'plain', text: `　通缉要犯：${d.name}　悬赏 150 文` });
    }
    lines.push({ kind: 'hint', text: '「接悬赏 <人名>」领取缉拿任务，擒获该犯可得赏金。' });
    return { lines };
  });


  /* ---------------- 武学 ---------------- */

  reg(['learn', '学', '学习'], (ctx, args) => {
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想学什么？' }] };
    const kw = args.join(' ');
    const w = ctx.world, p = ctx.player;

    /* 形式一：learn <人名> <武学名> —— 指定向谁请教 */
    let sd = null, teacher = null;
    const room_npcs = w.npcsIncludingTemplates(p.room).filter(n => n.isNpc && !n.dead && n.def && !n.def.hostile);
    if (args.length >= 2) {
      const byNpc = fuzzyFind(room_npcs, args[0], n => n.name);
      if (byNpc) {
        teacher = byNpc;
        sd = fuzzyFind(Object.values(w.data.skills), args.slice(1).join(' '), s => s.name);
      }
    }
    if (!sd) sd = fuzzyFind(Object.values(w.data.skills), kw, s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `没听说过「${kw}」这门功夫。` }] };

    /* 找会这门功夫的人 */
    if (!teacher) {
      const npcs = room_npcs.filter(n => {
        const def = n.def || {};
        if (def.teach && [].concat(def.teach).includes(sd.id)) return true;
        if (n.learned && n.learned[sd.id] && (def.canTeach !== false)) return true;
        return false;
      });
      if (!npcs.length) return { lines: [{ kind: 'warn', text: `此地无人会「${sd.name}」，你得找到会这门功夫的人请教。` }] };
      teacher = npcs[0];
    }

    /* ---- 社交校验：好感 or 花钱 ---- */
    const need = social.favorNeedFor(w, teacher, sd.id);
    const myFavor = teacher.favor || 0;
    const price = social.canBuyTeach(teacher) ? social.teachPrice(w, teacher, sd.id) : 0;
    const lines = [];

    if (myFavor < need && !price) {
      return {
        lines: [
          { kind: 'warn', text: `${teacher.name}摇头：「这门功夫不能轻传。」` },
          { kind: 'hint', text: `（需要好感 ${need}，你当前 ${myFavor}。多与${pronounOf(teacher)}来往、送礼，或帮${pronounOf(teacher)}做事。）` },
        ],
      };
    }
    if (myFavor < need && price) {
      /* 花钱学 */
      if (p.money < price) {
        return {
          lines: [
            { kind: 'warn', text: `${teacher.name}道：「也罢，你与我交情还浅。若肯出 ${price} 文，我便教你。」` },
            { kind: 'hint', text: `（你只有 ${p.money} 文。好感达到 ${need} 也可免费学。）` },
          ],
        };
      }
      p.money -= price;
      lines.push({ kind: 'sys', text: `你付了 ${price} 文，${teacher.name}这才点头。` });
    }

    /* ⚠️ 这里是**有人当面教你**（拜师/花钱求教），不是玩家照着图谱自学 ——
       所以走 force：师父既肯教，就不该再被「须先学会基础武学」这一关拦住。
       （玩家自学那两条路：读书 `teach` 与 `train`，照旧卡前置。） */
    const r = p.learnSkill(sd.id, { force: true });
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };

    const q = social.itemQuality ? null : null;
    lines.push({ kind: 'story', text: `${teacher.name}将${sd.name}的口诀心法细细讲与你听。` });
    lines.push({ kind: 'sys', text: r.msg });
    /* 教完加一点好感（他乐意教，说明看重你） */
    if (myFavor >= need) {
      const fr = social.addFavor(w, teacher, 3 * w.favorGainMult(p), '请教武学');
      lines.push(...fr.lines);
      /* 顺带一点信任：肯把真本事传你，是「信得过」的另一半（画像 secret/feuds 门槛用 trust）。 */
      teacher.pstate = teacher.pstate || { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
      teacher.pstate.trust = Math.min(100, (teacher.pstate.trust || 0) + 2);
    }
    p.advanceTime(30 + (sd.difficulty || 1) * 10);
    return { lines };
  });

  reg(['train', 'lian', '练', '练功', '修炼'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let sd = null;
    if (args.length) {
      sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
      if (!sd) return { lines: [{ kind: 'warn', text: `你不会「${args.join(' ')}」。` }] };
    } else {
      const ids = Object.keys(p.learned);
      if (!ids.length) return { lines: [{ kind: 'warn', text: '你还没学过武功，练什么呢？' }] };
      sd = w.getSkill(ids[0]);
    }
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };
    const lines = [];
    let rounds = 1;
    const times = cnNum(args[args.length - 1]);
    if (!isNaN(times) && times > 1 && times <= 50) rounds = times;
    for (let i = 0; i < rounds; i++) {
      const r = p.learnSkillByTrain(sd.id);
      lines.push({ kind: r.ok ? 'sys' : 'warn', text: r.msg });
      if (!r.ok) break;
      p.advanceTime(10);
      p.stamina = clamp(p.stamina - 5, 0, p.maxStamina);
      if (p.stamina <= 0) { lines.push({ kind: 'warn', text: '你已精疲力竭，无法继续练功。' }); break; }
    }
    return { lines };
  });

  reg(['enable', '装备武学', 'zhuangbei'], (ctx, args) => {
    // enable <槽位> <武学名>  或  enable <武学名>（自动判断槽位）
    const p = ctx.player, w = ctx.world;
    if (!args.length) {
      const lines = [{ kind: 'title', text: '【 武学槽位 】' }];
      for (const k of Object.keys(p.equippedSkills)) {
        const id = p.equippedSkills[k];
        const d = id ? w.getSkill(id) : null;
        lines.push({ kind: 'plain', text: `${k}：${d ? d.name : '（空）'}` });
      }
      /* 散学区（武学重制 R2）：没有基础武学的功夫不占槽位，单独激活、合计至多三路 */
      const sc = (p.standaloneActive || []).map(id => { const d = w.getSkill(id); return d ? d.name : id; });
      lines.push({ kind: 'plain', text: `散手（无根基，至多 ${STANDALONE_MAX} 路）：${sc.length ? sc.join('、') + `（${sc.length}/${STANDALONE_MAX}）` : '（空）'}` });
      lines.push({ kind: 'hint', text: '用法：enable <槽位> <武学名>，例如 enable 内功 紫霞神功' });
      return { lines };
    }
    let slot = args[0], skillKw = args.slice(1).join(' ');
    if (!Object.prototype.hasOwnProperty.call(p.equippedSkills, slot)) {
      // 可能只给了武学名
      skillKw = args.join(' ');
      slot = null;
    }
    let sd = fuzzyFind(Object.values(w.data.skills), skillKw, s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `没听说过「${skillKw}」。` }] };
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };

    /* ---- 武学重制：绑定校验（`design/40` §2.3） ----
       判据是「这门武学的根基（base 链的根）归哪一门基础武学」，
       与 category（外功/魔功/奇门/旁门）无关 —— 主人 2026-10-10 亲口纠正过：
       毒术有《基本毒术》、医术有《基本医术》，它们照旧绑定激活；
       只有**真的没有根基**的散手，才走「单独激活至多三本」。 */
    const rootId = p.skillRoot(sd.id);
    let homeSlot = null;
    for (const k of Object.keys(SLOT_ROOT)) {
      if (SLOT_ROOT[k].indexOf(rootId) >= 0) { homeSlot = k; break; }
    }
    /* 找不到根的两条岔路 —— 必须与「散手」区分清楚，别把两者混成一件事：
       ① `standalone: true` = **数据明说**「这门功夫不属任何基础武学系」→ 进散手池；
       ② 没标 standalone 又没根 = mod 武学 / 漏写 base → **宽容兜底按 type 归槽**。
          不兜这一刀，示例 mod 的自定义剑法会被判成散手，玩家发现「装了却不在剑槽」。 */
    if (!homeSlot && sd.standalone === true) {
      const cur = p.standaloneActive || (p.standaloneActive = []);
      const at = cur.indexOf(sd.id);
      if (at >= 0) {
        cur.splice(at, 1); p.recalc();
        return { lines: [{ kind: 'sys', text: `你收起了散手${sd.name}。` }] };
      }
      if (cur.length >= STANDALONE_MAX) {
        const names = cur.map(id => { const d = w.getSkill(id); return d ? d.name : id; });
        return { lines: [{ kind: 'warn', text: `散手至多同时运用 ${STANDALONE_MAX} 路，你已用了${names.join('、')}。须先收起一路。` }] };
      }
      cur.push(sd.id); p.recalc();
      return { lines: [{ kind: 'sys', text: `你运起了散手${sd.name}（${cur.length}/${STANDALONE_MAX}）。` }] };
    }
    if (!homeSlot && Object.prototype.hasOwnProperty.call(p.equippedSkills, sd.type)) homeSlot = sd.type;
    if (!homeSlot) {
      return { lines: [{ kind: 'warn', text: `${sd.name}的根基未明，暂时无从激活。` }] };
    }
    if (slot && slot !== homeSlot) {
      const rd = w.getSkill(rootId);
      return { lines: [{ kind: 'warn', text: `《${rd ? rd.name : rootId}》一脉的功夫，只能挂在「${homeSlot}」槽上。` }] };
    }
    slot = homeSlot;
    const old = p.equippedSkills[slot];
    p.equippedSkills[slot] = sd.id;
    p.recalc();
    const oldd = old && old !== sd.id ? w.getSkill(old) : null;
    return { lines: [{ kind: 'sys', text: `你将${sd.name}装备到了「${slot}」槽位。` + (oldd ? `（换下了${oldd.name}）` : '') }] };
  });

  reg(['perform', 'pf', '绝招', '施展'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你现在没有在战斗。' }] };
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想施展什么绝招？' }] };
    const kw = args.join(' ');
    /* 先按「武技」（skill.moves[]）找，找不到才退回「整门武学」 ——
       武技是武学重制新增的一层：一门功夫可以有好几招，各有冷却与消耗。 */
    let hit = null;
    for (const s of Object.values(w.data.skills)) {
      if (!p.learned[s.id]) continue;
      for (const mv of [].concat(s.moves || [])) {
        if (mv && mv.name === kw) { hit = { skill: s, move: mv }; break; }
      }
      if (hit) break;
    }
    if (hit) {
      const r = ctx.world.combatStep({ type: 'skill', skill: hit.skill.id, moveId: hit.move.id });
      return { lines: r ? r.lines : [] };
    }
    const sd = fuzzyFind(Object.values(w.data.skills), kw, s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: `你不会「${kw}」。` }] };
    if (!p.learned[sd.id]) return { lines: [{ kind: 'warn', text: `你尚未学会${sd.name}。` }] };
    const r = ctx.world.combatStep({ type: 'skill', skill: sd.id });
    return { lines: r ? r.lines : [] };
  });

  /* ============================================================
   * 拍卖行（design/40 §6.3，主人点名要的系统）
   *   面板本身走前端 PANEL_CMDS（auction/拍卖）；这里是**真指令**：
   *   出价、寄拍都在后端结算，因为要动钱与背包。
   * ============================================================ */
  reg(['bid', '出价', '叫价'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (!room.auctionHouse) return { lines: [{ kind: 'warn', text: '这儿没有拍卖行，得去大城的市集。' }] };
    const raw = String(args[0] || '');
    const price = cnNum(raw) || parseInt(raw, 10);
    const r = auctionMod.bid(w, p, price);
    return { lines: r.lines };
  });

  reg(['consign', '寄拍', '寄卖'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (!room.auctionHouse) return { lines: [{ kind: 'warn', text: '这儿没有拍卖行，得去大城的市集。' }] };
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：consign <物品名>，把值钱的物件交给柜上代卖。' }] };
    const kw = args.join(' ');
    const r = auctionMod.consign(w, p, kw);
    return { lines: r.lines };
  });

  /* 拍卖行的**文本版**入口：前端面板（PANEL_CMDS）才是主入口，这条是兜底 ——
     万一玩家在没被前端拦住的场合敲「拍卖」，不至于得到「这是什么指令」。 */
  reg(['auction', '拍卖', '拍卖行'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (!room.auctionHouse) {
      return { lines: [{ kind: 'warn', text: '这儿没有拍卖行。大城的市集上才有（洛阳 / 长安 / 成都 / 襄阳 / 江南 / 姑苏）。' }] };
    }
    const v = auctionMod.viewOf(w);
    const lines = [{ kind: 'title', text: `【 拍卖行 · 第 ${v.session + 1} 期 】（距下一场 ${v.daysToNext} 日）` }];
    if (v.news && v.news.length) for (const n of v.news) lines.push({ kind: 'sys', text: n });
    if (v.current) {
      lines.push({ kind: 'plain', text: `正在拍：${v.current.name}　当前价 ${v.current.price} 文（加价 ${v.current.step}）${v.current.leaderName ? '　领先：' + v.current.leaderName : ''}` });
      lines.push({ kind: 'hint', text: `用「出价 <价钱>」出价，例如 bid ${v.current.price + v.current.step}。` });
    } else {
      lines.push({ kind: 'plain', text: '本期的东西都拍完了。' });
    }
    if ((v.pending || []).length) lines.push({ kind: 'plain', text: `你寄拍中：${v.pending.map(x => x.name).join('、')}` });
    lines.push({ kind: 'hint', text: '「consign <物品名>」可把值 500 文以上的东西交给柜上代卖。' });
    return { lines };
  });

  /* 寻访：在荒僻处碰碰运气（奇遇表见 75_content_extra.json）。
     为什么不做成「每次进屋自动掷骰」：那会污染房间的 onEnter 数组
     （数组是 replace 语义，后写的会把原有的整段抄掉），风险远大于收益。 */
  reg(['寻访', '寻奇遇', '访奇', '探奇'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    const pool = Object.values(w.data.encounters || {})
      .filter(e => e && (!e.rooms || e.rooms.indexOf(room.region) >= 0));
    if (!pool.length) return { lines: [{ kind: 'warn', text: '这种地方人来人往，寻不出什么奇遇。' }] };
    if (p.vars.lastStray && (w.clockMinutes - p.vars.lastStray) < 60) {
      return { lines: [{ kind: 'warn', text: '你刚转过一圈，腿还酸着，歇会儿再说。' }] };
    }
    p.vars.lastStray = w.clockMinutes;
    let hit = null;
    for (const e of pool) { if (w.rng.next() < (e.chance || 0.08)) { hit = e; break; } }
    if (!hit) return { lines: [{ kind: 'plain', text: '你在附近转了一圈，草里除了虫叫什么都没有。' }] };
    const lines = evalEffects(hit.effects, { player: p, world: w });
    return { lines: [{ kind: 'title', text: `【奇遇 · ${hit.name}】` }].concat(lines || []) };
  });

  /* ============================================================
   * 门派邦交 + 门派大比（design/40 §5.4 / §5.6）
   * ============================================================ */
  reg(['邦交', '门派关系', '列国', 'relations'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你还没有门派，谈什么邦交。' }] };
    if (!w.factionState) w.initWorldDynamics();
    const mine = w.getSect(p.sect);
    const lines = [{ kind: 'title', text: `【 ${mine ? mine.name : p.sect} · 邦交 】` }];
    const ids = Object.keys(w.data.sects).filter(id => id !== p.sect && id !== 'xiake');
    ids.sort((a, b) => w.factionRel(p.sect, b) - w.factionRel(p.sect, a));
    for (const id of ids) {
      const s = w.getSect(id);
      const v = w.factionRel(p.sect, id);
      const feud = w.factionFeudOf(p.sect, id);
      lines.push({
        kind: 'plain',
        text: `${s.name}（${s.tier || '—'}）：${w.factionRelWord(v)} ${v > 0 ? '+' : ''}${v}`
          + (feud ? `　· ${feud}` : ''),
      });
    }
    lines.push({ kind: 'hint', text: '两派交恶到 −25 以下，弟子照面便撂狠话；有交情的另算。' });
    return { lines };
  });

  /* ⚠️ 名字别叫「大比」—— 那个词已经被 sectFounder（自建宗门的宗门大比）占了，
     前端 PANEL_CMDS 也把「大比」映射到 found 面板，撞名会让这条永远走不到。 */
  reg(['门派大比', '门中大比', '本派大比', 'tourney'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '无门无派，没资格下场。' }] };
    const mine = w.getSect(p.sect);
    const room = w.data.rooms[p.room] || {};
    if (!mine || room.region !== mine.region) {
      return { lines: [{ kind: 'warn', text: `大比在本派地界上开（${mine ? mine.name : ''}），你站的地方不对。` }] };
    }
    const t = p.vars.tourney;
    if (t && t.oppId) {
      const prev = w.getNpc(t.oppId);
      const won = prev && (prev.dead || prev.knockedOut || prev.hp <= 0);
      if (!won) return { lines: [{ kind: 'warn', text: '上一场还没了结，先把眼前这位打发了。' }] };
      t.wins = (t.wins || 0) + 1; t.round = (t.round || 1) + 1; t.oppId = null;
    } else if (!t) {
      p.vars.tourney = { round: 1, wins: 0, oppId: null, sect: p.sect };
    }
    const tt = p.vars.tourney;
    if (tt.round > 3) {
      /* 三轮走完 → 结算：贡献 + 声望 + 一门本派武学 */
      const rank = tt.wins;
      p.sectContribution = (p.sectContribution || 0) + 60 + rank * 40;
      p.reputation[p.sect] = (p.reputation[p.sect] || 0) + 10 + rank * 10;
      const prize = rank >= 3 ? `${p.sect}_atk_3` : rank >= 2 ? `${p.sect}_atk_2` : `${p.sect}_atk_1`;
      const lr = p.learnSkill(prize, { force: true });
      p.vars.tourney = null;
      const lines = [
        { kind: 'title', text: `【 大比落幕 】` },
        { kind: 'sys', text: `${tt.wins} 胜 —— 你在本派大比中排到了${rank >= 3 ? '头名' : rank >= 2 ? '前列' : '中游'}。` },
        { kind: 'sys', text: `贡献 +${60 + rank * 40}，声望 +${10 + rank * 10}。` },
        { kind: 'sys', text: lr.ok ? `门中把《${(w.getSkill(prize) || {}).name || prize}》传了你。` : `（门派武学：${lr.msg}）` },
      ];
      return { lines };
    }
    /* 造本轮对手：越往后越硬 */
    const pool = tt.round === 1 ? ['mob_bandit'] : tt.round === 2 ? [`${p.sect}_disciple`] : [`${p.sect}_master`];
    const nid = pool.find(x => w.data.npcs[x]);
    if (!nid) return { lines: [{ kind: 'warn', text: '门里一时凑不齐对手，过阵子再来。' }] };
    const foe = w.spawnNpc(nid, p.room, 1, true);
    if (tt.round === 3) { foe.name = `${mine.name}·掌门`; }
    tt.oppId = foe.id;
    const dr = w.startDuel(p, foe);
    return {
      lines: [
        { kind: 'title', text: `【 大比 · 第 ${tt.round} 轮 / 共 3 轮 】` },
        { kind: 'plain', text: `场边围了一圈本门弟子。${tt.round === 3 ? '最后一场，对手是当家的。' : '轮到你了。'}` },
      ].concat(dr.lines || []),
    };
  });

  /* ============================================================
   * 文化项目：科举 / 听曲 / 诗会 / 比武招亲（culture.js）
   *   文采是这一套的核心资源：温书攒、听曲涨、诗会奖、科举考它。
   * ============================================================ */
  reg(['应试', '科举', '报考', '应考', 'exam'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const r = cultureMod.takeExam(w, p, args.join(' ') || null);
    return { lines: r.lines };
  });

  reg(['温书', '读书', '苦读', 'study'], (ctx) => {
    const r = cultureMod.study(ctx.world, ctx.player);
    return { lines: r.lines };
  });

  reg(['听曲', '点曲', '听戏', 'listen'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (room.region !== 'qinglou' && !room.songs) {
      return { lines: [{ kind: 'warn', text: '这儿没有唱的。要听曲得去勾栏。' }] };
    }
    const r = cultureMod.listenSong(w, p, args.join(' ') || null);
    return { lines: r.lines };
  });

  reg(['赋诗', '诗会', '出题'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (room.region !== 'qinglou') return { lines: [{ kind: 'warn', text: '诗会在醉春楼那样的地方开。' }] };
    const r = cultureMod.poemAsk(w, p);
    return { lines: r.lines };
  });

  reg(['对句', '接句', '答对'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    if (room.region !== 'qinglou') return { lines: [{ kind: 'warn', text: '这里没有席。' }] };
    if (!args.length) return { lines: [{ kind: 'warn', text: '报个号，用法：对句 2' }] };
    const r = cultureMod.poemAnswer(w, p, args[0]);
    return { lines: r.lines };
  });

  /* ⚠️ 别名别跟别处撞：宗门那边有 `contest`，这里用 `meet` / `招亲擂台` */
  reg(['比武招亲', '招亲', '擂台招亲', 'meet'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const room = w.data.rooms[p.room] || {};
    const arenaRoom = (cultureMod.cfg(w).marriageMeet || {}).room;
    if (room.id !== arenaRoom) {
      return { lines: [{ kind: 'warn', text: `擂台立在洛阳，你得站到台前去（${arenaRoom}）。` }] };
    }
    const r = cultureMod.startMarriageMeet(w, p);
    return { lines: r.lines };
  });

  /* ============================================================
   * 重地：藏经阁（三层）/ 藏宝阁 / 国库 / 衙门库房（R5）
   * ============================================================ */
  reg(['藏经阁', '经阁', '翻经', 'library'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = treasuryMod.here(w);
    if (!room || room.treasuryKind !== 'library') {
      return { lines: [{ kind: 'warn', text: '这儿没有藏经阁。各派的藏经阁都在自己的地界上。' }] };
    }
    if (args.length) return { lines: treasuryMod.shelfView(w, p, args[0]).lines };
    const v = treasuryMod.libraryView(w, p);
    const lines = [{ kind: 'title', text: `【${v.owner ? v.owner.name : ''}藏经阁】` }];
    lines.push({ kind: 'sys', text: `你的门中身份：${['外门', '内门', '执事', '首座', '长老', '掌门'][v.rank] || '弟子'}　贡献：${v.contrib}` });
    for (const f of v.floors) {
      lines.push({
        kind: 'plain',
        text: `${f.id}. ${f.name}（${f.grades.map(g => ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][g] + '品').join('/')}）`
          + `　${f.can ? `可抄 ${f.count} 本　入门费 ${f.cost} 贡献` : `—— ${f.why}`}`,
      });
    }
    lines.push({ kind: 'hint', text: '「藏经阁 <层号>」翻看这一层；「抄录 <武学名>」抄一本下来。' });
    return { lines };
  });

  reg(['抄录', '抄书', 'copy'], (ctx, args) => {
    const r = treasuryMod.copy(ctx.world, ctx.player, args.join(' '));
    return { lines: r.lines };
  });

  reg(['藏宝阁', '宝库', '库房', '国库', 'vault'], (ctx) => {
    const r = treasuryMod.vaultView(ctx.world, ctx.player);
    return { lines: r.lines };
  });

  reg(['兑换', '换取', 'redeem'], (ctx, args) => {
    const r = treasuryMod.redeem(ctx.world, ctx.player, args.join(' '));
    return { lines: r.lines };
  });

  /* ============================================================
   * 战斗外秘技（迷晕 / 致幻 / 暗劲 / 下毒 / 催眠 / 采补 / 双修）
   *   通常用在 NPC 交互界面的按钮上；这里给一条文字入口，两者共用 arts.js。
   * ============================================================ */
  reg(['秘技', '使秘技', '暗算', 'art'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (args.length < 2) {
      const list = artsMod.listFor(w, p, null);
      const lines = [{ kind: 'title', text: '【可用的秘技】' }];
      for (const a of (artsMod.cfg(w).list || [])) {
        /* 双修 / 采补不在这儿露面（主人 2026-10-11）—— 它们挂在 NPC 互动面板上，
           判定与流程都在 dualcultivate.js。`listFor` 里已经筛过一次，
           这一处是**另一条路**（直接读配置），所以要各自筛，别只改一处。 */
        if (a.effect === 'dual' || a.effect === 'drain') continue;
        const u = artsMod.artUsable(w, p, a);
        lines.push({ kind: 'plain', text: `${a.name}（${a.cat}）　内力 ${a.mpCost}　${u.ok ? '已可运用' : '—— ' + u.why}` });
      }
      lines.push({ kind: 'hint', text: '用法：秘技 <人名> <秘技名>，例如「秘技 张掌柜 迷晕」。' });
      return { lines };
    }
    const artName = args[args.length - 1];
    const who = args.slice(0, args.length - 1).join(' ');
    const npc = (w.npcsIncludingTemplates(p.room) || []).find(n =>
      !n.isPlayer && (n.name === who || n.id === who || n.defId === who || (n.name && n.name.indexOf(who) >= 0)));
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${who}」这号人物。` }] };
    const r = artsMod.use(w, p, npc, artName);
    return { lines: r.lines };
  });

  /* 合欢宗：卖身青楼 + 接待满十位 → 楼里自有人来问一句话 */
  reg(['入合欢宗', '合欢宗', '投合欢', 'hehuan'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const g = artsMod.hehuanGate(w, p);
    if (g.already) return { lines: [{ kind: 'plain', text: g.msg }] };
    if (!g.ok) {
      return {
        lines: [
          { kind: 'plain', text: (artsMod.hh(w).joinLine || '') },
          { kind: 'warn', text: g.msg },
          ...(g.need ? [{ kind: 'hint', text: `（在青楼用「接客」攒够 ${g.need} 位再来。）` }] : []),
        ],
      };
    }
    const r = p.joinSect('hehuan');
    return {
      lines: [
        { kind: 'story', text: artsMod.hh(w).joinAsk || '' },
        { kind: r.ok ? 'sys' : 'warn', text: r.msg },
      ],
    };
  });

  /* ============================================================
   * 内力上限：吐纳 / 收功（neigong.js）
   *   吐纳是「熬」——一次次坐下来，内力与气血一点点耗干，见底那一刻才长上限。
   *   期间不能走动（movePlayerTo 会拦），挨打或走动即散功。
   * ============================================================ */
  reg(['吐纳', '行功', '调息', 'tuna'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    if (!neigongMod.stateOf(p)) return { lines: neigongMod.start(w, p).lines };
    const r = neigongMod.round(w, p);
    return { lines: r.lines };
  });

  reg(['收功', '散功', '起身'], (ctx) => {
    /* 显式退出吐纳 / 双修 / 采补（主人 2026-10-11）。
       ⚠️ 主人明确**不要「收功」按钮** —— 常态路径是「点屏幕上任何别的按钮就退出这个状态」，
       那条路由 `engine.exec` 自动接管（见那边 `KEEP` 白名单与 `exitBusy`）。
       这条指令留着，给手敲的老玩家和内部调用用，不是主路径。
       两件事都要认：坐着吐纳，或者正在双修/采补当中 —— 以前只认吐纳，
       双修起手之后敲「收功」会说「你并没有在吐纳」，等于把玩家锁死在那个状态里。 */
    const dc = require('./dualcultivate');
    if (dc.stateOf(ctx.player)) return { lines: dc.stop(ctx.world, ctx.player).lines };
    const r = neigongMod.stop(ctx.world, ctx.player);
    return { lines: r.lines };
  });

  /* ============================================================
   * 医术：诊脉 / 疗伤 / 解毒（medicine.js）
   *
   * 主人 2026-10-11「继续做剩下的内容」——待办里挂着一条：「医术类武学无战斗外消费点」。
   * 《基本医术》占着 `character.js` 的槽位表一格，玩家学了却发现**哪里都用不上**。
   * 这三条指令把它接上：看病不花钱，治病靠内力，治好了长人情。
   * ============================================================ */
  const medicineMod = require('./medicine');

  /** 医术的目标：屋里活着的人 + 躺在地上的人（倒地那个恰恰最该救） */
  function medicineTarget(w, p, kw) {
    const pool = (w.npcsIn(p.room) || []).concat(w.downedIn ? w.downedIn(p.room) : []);
    return fuzzyFind(pool, kw, n => n.name) || null;
  }
  function medGate(p) {
    return medicineMod.hasMedicine(p)
      ? null
      : [{ kind: 'hint', text: '（先学了《基本医术》再说 —— 那是做医者的门槛。）' }];
  }

  reg(['诊脉', '把脉'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const gate = medGate(p);
    if (gate) return { lines: gate };
    const kw = (args || []).join(' ').trim();
    if (!kw) return { lines: medicineMod.diagnose(w, p, p).lines };
    const t = medicineTarget(w, p, kw);
    if (!t) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    return { lines: medicineMod.diagnose(w, p, t).lines };
  });

  /* ⚠️ 指令名**不能叫「疗伤」** —— `heal / 疗伤 / 运功疗伤 / 养伤 / 行气疗伤`
     早在 commands.js 后面注册过了（耗内力硬撑、掏空了还会积暗伤的那套）。
     `reg([...])` 是**后者覆盖前者**，重名会让这边整块静默失效（第一版就踩了：
     敲「疗伤」跑的是老实现，我这边一句都没执行，测试还以为是数值不对）。
     所以这边专管「**替人**看伤」：医治 / 看伤 / 救治。 */
  reg(['医治', '看伤', '救治', '施救'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const gate = medGate(p);
    if (gate) return { lines: gate };
    const kw = (args || []).join(' ').trim();
    /* 不带人 = 替自己看。提示一句另一条路，免得玩家以为两回事。 */
    if (!kw) {
      const r = medicineMod.heal(w, p, p);
      r.lines.push({ kind: 'hint', text: '（内力足的时候，「疗伤」那一路来得更快，只是掏空了会积暗伤。）' });
      return { lines: r.lines };
    }
    const t = medicineTarget(w, p, kw);
    if (!t) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    const r = medicineMod.heal(w, p, t);
    /* B22：救了人才算「救人」的传闻（此前 rs_save_life 是死种子，全仓没人调）。
       ⚠️ 只在**真的把对方从伤里拉回来**时才报传言 —— 空手扎一下也算的话，
       集市上就天天有人传你救人了。 */
    if (r && r.ok && t && t.name && typeof w.addRumor === 'function') {
      const room = w.getRoom(p.room) || {};
      w.addRumor('rs_save_life', { room: p.room, about: (t.def && t.def.id) || t.defId || null, vars: { who: p.name || '有人', where: room.name || '城里', whom: t.name } });
    }
    return { lines: r.lines };
  });

  reg(['解毒', '拔毒', '驱毒'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const gate = medGate(p);
    if (gate) return { lines: gate };
    const kw = (args || []).join(' ').trim();
    if (!kw) return { lines: medicineMod.detox(w, p, p).lines };
    const t = medicineTarget(w, p, kw);
    if (!t) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    return { lines: medicineMod.detox(w, p, t).lines };
  });

  /* ============================================================
   * 双修 / 采补（dualcultivate.js，主人 2026-10-11 重做）
   *
   * 入口搬到「点 NPC 名字 → 互动面板」的按钮上（从前挂在秘技里，既不判晚上
   * 也不判旁边有没有人）。指令仍然保留：面板上的按钮发的是这两条。
   * 一轮一次指令 —— 「屏幕上缓慢弹出」就是这个意思，跟吐纳一个路子。
   * ============================================================ */
  for (const [names, kind] of [
    [['双修', '合修', 'dual'], 'dual'],
    [['采补', '采战', 'drain'], 'drain'],
  ]) {
    reg(names, (ctx, args) => {
      const p = ctx.player, w = ctx.world;
      const dc = require('./dualcultivate');
      const st = dc.stateOf(p);
      if (st) {
        if (st.kind !== kind) return { lines: [{ kind: 'warn', text: '你正忙着另一桩事。（想走开，点屏幕上随便哪个别的按钮。）' }] };
        return { lines: dc.round(w, p).lines };
      }
      const kw = (args || []).join(' ').trim();
      if (!kw) return { lines: [{ kind: 'warn', text: '对谁？' }] };
      const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
      if (!npc || npc.isPlayer) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
      const r = dc.start(w, p, npc, kind);
      return { lines: r.lines };
    });
  }

  /* ---------------- 徒弟：传功 / 灌顶 ---------------- */
  reg(['传功', '授徒', '传艺'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    p.disciples = p.disciples || [];
    if (!args.length) {
      const list = p.disciples.map(id => { const n = w.getNpc(id); return n ? n.name : null; }).filter(Boolean);
      return { lines: list.length
        ? [{ kind: 'title', text: '【门下的弟子】' }, { kind: 'plain', text: list.join('、') }, { kind: 'hint', text: '用法：传功 <弟子> <功法名>' }]
        : [{ kind: 'warn', text: '你还没有收徒。' }] };
    }
    const kw = args.join(' ');
    let npc = null, skillKw = '';
    for (let i = args.length; i > 0; i--) {
      const nameTry = args.slice(0, i).join(' ');
      const hit = p.disciples.map(id => w.getNpc(id)).find(n => n && n.name && (n.name === nameTry || n.name.indexOf(nameTry) >= 0));
      if (hit) { npc = hit; skillKw = args.slice(i).join(' '); break; }
    }
    if (!npc) return { lines: [{ kind: 'warn', text: `你的弟子里没有「${kw}」这号人。` }] };
    if (!skillKw) return { lines: [{ kind: 'warn', text: '要传哪一门功夫？' }] };
    const sid = Object.keys(p.learned).find(id => {
      const sd = w.getSkill(id);
      return sd && (sd.name === skillKw || sd.name.indexOf(skillKw) >= 0 || id === skillKw);
    });
    if (!sid) return { lines: [{ kind: 'warn', text: `你自己都不会「${skillKw}」，传不了。` }] };
    const sd = w.getSkill(sid);
    const myLv = p.learned[sid].level || 0;
    const pass = Math.max(1, Math.floor(myLv * 0.6));      // 传下去只剩六成火候
    npc.learned = npc.learned || {};
    const before = (npc.learned[sid] && npc.learned[sid].level) || 0;
    if (before >= pass) {
      return { lines: [{ kind: 'plain', text: `${npc.name}在这门功夫上已经不比这一手差了。` }] };
    }
    npc.learned[sid] = { level: pass, exp: 0 };
    if (sd.type && npc.equippedSkills && !npc.equippedSkills[sd.type]) npc.equippedSkills[sd.type] = sid;
    npc.recalc && npc.recalc();
    npc.favor = (npc.favor || 0) + 6;
    return {
      lines: [
        { kind: 'story', text: `你把${npc.name}叫到跟前，一式一式拆给他看。他学得慢，但记得牢。` },
        { kind: 'sys', text: `传了《${sd.name}》（你 ${myLv} 级 → 他 ${pass} 级）。好感 +6。` },
      ],
    };
  });

  reg(['灌顶', '灌顶传功', '以气渡人'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    p.disciples = p.disciples || [];
    if (!args.length) return { lines: [{ kind: 'warn', text: '用法：灌顶 <弟子>　把自己十点内力上限渡给他' }] };
    const who = args.join(' ');
    const npc = p.disciples.map(id => w.getNpc(id)).find(n => n && n.name && (n.name === who || n.name.indexOf(who) >= 0));
    if (!npc) return { lines: [{ kind: 'warn', text: `你的弟子里没有「${who}」这号人。` }] };
    if ((p.maxMp || 0) < 40) return { lines: [{ kind: 'warn', text: '你自己的内力都薄得可怜，拿什么渡人。' }] };
    const give = Math.min(10, Math.max(1, Math.floor((p.maxMp || 0) * 0.1)), 10);
    p.maxMpBase = Math.max(10, (p.maxMpBase || 50) - give);
    npc.maxMpBase = (npc.maxMpBase || 50) + give;
    p.recalc(); npc.recalc && npc.recalc();
    /* 内力上去了，他的功法火候也跟着抬（内力上限 = 实力上限） */
    const lifted = neigongMod.syncNpcByMp(w, npc);
    npc.favor = (npc.favor || 0) + 10;
    const ng = p.equippedSkills['内功'];
    const ngName = ng ? ((w.getSkill(ng) || {}).name || ng) : null;
    return {
      lines: [
        { kind: 'story', text: `你与${npc.name}对坐，掌心相抵。你这边一点点空下去，他那边一点点满起来。` },
        { kind: 'sys', text: `你的内力上限 −${give}（现 ${Math.floor(p.maxMp)}），${npc.name}的内力上限 +${give}（现 ${Math.floor(npc.maxMp)}）。` },
        lifted ? { kind: 'sys', text: `他一身功夫跟着水涨船高（${lifted} 门武学的火候被内力顶上去了）。` } : { kind: 'plain', text: '（他原有的火候比这点内力配得上的还要高些。）' },
        ngName ? { kind: 'hint', text: `（你运的是《${ngName}》——内力上限掉下去，武学上限也会跟着低一点。）` } : { kind: 'hint', text: '（你连内功都没运——底子薄，将来得补。）' },
      ],
    };
  });

  reg(['forget', '忘记'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
    if (!sd || !p.learned[sd.id]) return { lines: [{ kind: 'warn', text: '你没有学过这门功夫。' }] };
    p.forgetSkill(sd.id);
    return { lines: [{ kind: 'sys', text: `你运功散去了${sd.name}的修为。` }] };
  });

  /* ---------------- 战斗 ---------------- */

  reg(['kill', 'fight', 'attack', '杀', '攻击', '打'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    /* B4：战斗界面「全力一击」点的是**光杆** `attack`（不带目标名）。
       旧实现第一句就要 args，不带就回「你想攻击谁？」——
       而战斗面板里的对手是已知的（w.battle.target），玩家不该再输一遍名字。
       所以交战中无参数 = 朝当前对手全力出手（走 combatStep 的普通攻击分支），
       这才是这个按钮在战斗面板里该有的语义。 */
    if (!args.length && w.battle) {
      const r = w.combatStep();
      return { lines: r ? r.lines : [], combatStep: true };
    }
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想攻击谁？' }] };
    const kw = args.join(' ');
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    /* 第五批：晕倒的 NPC 再被补刀才会真死 */
    if (npc.knockedOut && !(npc.def || {}).hostile) {
      w.onNpcKilled(npc, null);
      return { lines: [{ kind: 'combat', text: `你手起刀落，将昏倒在地的${npc.name}结果了性命。` }] };
    }
    const r = w.startCombat(p, npc);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [{ kind: 'combat', text: `你向${npc.name}发起了攻击！` }];
    /* B7：同房间目击者（怯懦的逃走、侠义的拔刀相助、平民惊呼）的反应台词。
       由 world 的 `combatstart` 钩子产出（见 world.js combatStartWitnessReaction）。 */
    for (const l of (r.lines || [])) lines.push(l);
    return { lines, enterCombat: true };
  });

  /* ---------------- 偷袭（主人第四轮：「其他比如偷袭结缘之类的功能呢？」） ----------------
     与「攻击」的区别：**先手重击**，代价是结仇、掉交情、多半被告发。
     · 先手：不算一个完整回合（对方没反应过来，不该有反击）→ 直接掉一截血；
     · 后果：好感 −30、信任 −20（暗算比当面叫阵更招人恨）；
     · 只对「站着的人」有效：已经动上手就不是偷袭，昏过去的用不着偷袭。
     ⚠️ 走 `world.startCombat(p, npc)`（**不传 ambush**）——
        传了 ambush 等于告诉世界「是 NPC 伏击玩家」，目击者就会反过来帮被打的人
        （world.combatStartWitnessReaction 读的就是 battle.ambush）。
        玩家先动手，就该按「玩家是凶手」演：侠义者拦你、官府记你一笔。 */
  reg(['ambush', '偷袭', '暗算', '背后下手'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '偷袭谁？「偷袭 <人名>」。' }] };
    if (w.battle) return { lines: [{ kind: 'warn', text: '已经动上手了，那就不算偷袭——直接「攻击」吧。' }] };
    const kw = args.join(' ');
    /* ⚠️ 倒地的人**不在** npcsIncludingTemplates 里（`npcsIn` 过滤 !dead，
       而打倒的人是 knockedOut + dead）。不补 downedIn 这一路的话，
       玩家对躺在地上的人发「偷袭」会得到「这里没有「山贼」」——
       明明就在脚边躺着，说「没有」最出戏。 */
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name)
      || fuzzyFind(w.downedIn(p.room), kw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${kw}」。` }] };
    if (npc.knockedOut) {
      return { lines: [{ kind: 'warn', text: `${npc.name}已经昏在地上，用不着偷袭——「绑架」或「补刀」更省事。` }] };
    }
    const tdef = npc.def || {};
    if (tdef.quest && tdef.quest.length) {
      return { lines: [{ kind: 'warn', text: `${npc.name}身上牵着事，暗算了他，这条线索也就断了。` }] };
    }
    const r = w.startCombat(p, npc);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const combatMod = require('./combat');
    const atk = Number(p.atk) || 1;
    const dfn = (combatMod.defenseOf ? combatMod.defenseOf(npc) : 0) || 0;
    /* 先手加成的口径：攻击 ×2.2，且**只按三成防御**折算 ——
       背后这一下本就该无视大半护体（不然「偷袭」跟普通一刀没区别，
       玩家会觉得这个按钮是摆设）。下限 1，保证永远打得动。 */
    const dmg = Math.max(1, Math.floor(atk * 2.2) - Math.floor(dfn * 0.3));
    /* ⚠️ 血量留 1 点地板：一击必杀会让战斗状态和击杀结算**同时**收尾，
       两条路都要写对才不出岔子。留一线血让普通回合去结果他，稳。 */
    const before = npc.hp || 1;
    npc.hp = Math.max(1, before - dmg);
    const real = before - npc.hp;
    npc.favor = Math.max(-200, (npc.favor || 0) - 30);
    if (npc.pstate) npc.pstate.trust = Math.max(-100, (npc.pstate.trust || 0) - 20);
    const lines = [
      { kind: 'combat', text: `你悄没声地绕到${npc.name}身后，一掌拍向他要害！` },
      { kind: 'combat', text: `　【偷袭】一击得手，${npc.name}受创 ${real} 点，踉跄回头（还剩 ${npc.hp} 点气血）。` },
    ];
    if (real >= before - 1) lines.push({ kind: 'sys', text: '　（他脚下已经发飘，站不住了。再来一下，人就倒。）' });
    lines.push({ kind: 'sys', text: `　（暗算结仇——${npc.name}此刻恨极了你。）` });
    for (const l of (r.lines || [])) lines.push(l);
    return { lines, enterCombat: true };
  });

  /* B4：战斗界面「防御」快捷键 —— 后端此前**根本没有** defend 指令
     （实测 CMD.defend === undefined），所以点了必然回「「defend」是什么指令？」。
     结论是「按钮没绑错、字段也没读错，是后端缺指令」，属可修而非僵尸按钮，
     故补齐后端：凝神防守一回合，减小本回合所受伤害。
     实现走 combatStep 的 userAction 分支，并在 combat.js 的受击处生效。 */
  reg(['defend', '防御', '招架', '守'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const r = ctx.world.combatStep({ type: 'defend' });
    return { lines: r ? r.lines : [], combatStep: true };
  });

  reg(['flee', '逃跑', '跑'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const r = ctx.world.combatStep('flee');
    return { lines: r ? r.lines : [], combatStep: true };
  });

  /* ⚠️ 这个指令叫「挂机」，**不是**「普通攻击」。
     主人 2026-10-11 让删掉战斗面板的「全力一击」，删的时候把「普通攻击」
     那个按钮指到了这里的 `auto` —— 于是点一下「普通攻击」实际上是**自动打满
     60 回合**。这就是「点一下人就没了」的第一现场。
     ⇒ 改名「挂机」让两件事在字面上分开；按钮那头已改回 `attack`（ui.js 战斗面板）。
     ⚠️ 保留 60 回合上限：它是**防死循环**的兜底，不是玩法。 */
  reg(['auto', '自动战斗', '挂机'], (ctx) => {
    if (!ctx.world.battle) return { lines: [{ kind: 'warn', text: '你并没有在战斗。' }] };
    const lines = [];
    /* ⚠️ 上限与平局判定共用同一个常量：这边是防死循环，`combat.js` 那边是判和。
       各写一个 60 就是两份真理 —— 改一个忘一个，另一边就变成新的死循环入口。 */
    const { DRAW_TURNS } = require('./combat');
    let guard = 0;
    while (ctx.world.battle && !ctx.world.battle.over && guard++ < DRAW_TURNS) {
      const r = ctx.world.combatStep();
      if (!r) break;
      lines.push(...r.lines);
      if (r.over) break;
      if (ctx.player.hp <= 0) break;
    }
    /* ⚠️ 跑满上限还没分出胜负 ⇒ 这一架就到此为止（平局），别把战斗悬在场上。
       为什么不能干等 `advanceTurn` 自己跨过上限收尾：
         循环条件是 `guard++ < DRAW_TURNS`，跑满正好 DRAW_TURNS 手 ⇒ turn 停在 DRAW_TURNS；
         而平局判的是 `turn > DRAW_TURNS`（`advanceTurn` 里那句），**差着一格**。
       于是挂机退出时战斗既没赢也没输也没和 —— 面板不消失、一句话也不说，
       玩家只看见"挂机完了，然后呢？"，而这一格差还会随任何一边改上限重新长出来。
       ⇒ 不去对齐那两个边界（改一个忘一个，错位会复发），改成在退出点显式收尾：
         「挂机打满了 DRAW_TURNS 手还没打完」本身就是判和的理由，不必再走一回合。
       走 `finishCombat` 而不是只置 `over`：它会把双方 `inCombat` 清掉、
       把 Boss 阶段状态复位 —— 只置 over 会留一堆"还在打"的人站在原地。 */
    if (ctx.world.battle && !ctx.world.battle.over) {
      const b = ctx.world.battle;
      b.over = true; b.winner = 'draw';
      const fin = ctx.world.finishCombat([
        { kind: 'warn', text: '这一架打了许久，谁也奈何不了谁，各自退开。' },
      ]);
      lines.push(...(fin.lines || []));
    }
    return { lines, combatStep: true };
  });

  /* ---------------- NPC 交互 ---------------- */

  reg(['talk', 'chat', '交谈', '聊'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想和谁说话？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const lines = [];
    /* ---- 他有没有话要跟你提（2026-10-11 自拟）----
       「NPC 记着你」：答应过没办的事 > 人情账 > 听说你的事 > 久别重逢。
       一次只说一件，且同一件事一天最多念一回 —— 见面就翻旧账那不叫记性，叫唐僧。 */
    try {
      lines.push(...require('./npcMemory').greetLines(w, p, npc));
    } catch (e) { /* 记忆出错不该挡着说话 */ }
    const def = npc.def || {};
    if (def.dialog && w.data.dialogues[def.dialog]) {
      const dlg = w.data.dialogues[def.dialog];
      lines.push(...runDialogue(ctx, npc, dlg));
    } else if (def.dialogTree) {
      lines.push(...runDialogTree(ctx, npc, def.dialogTree));
    } else if (npc.talk) {
      /* ---- 画像 L1 听见 ----
         说话动词：personality 管，voice.tone 只在 敬/泼/酸 时顶掉（心情极低时一切让位）。
         口头禅：按画像层级 A 30% / B 15% / C 不露，前缀在台词之前。
         句式：voice.style → 句式签名（personality.styleSpeak）——**改的是句子结构本身**
         （话少的削成一小句、绕的截断咽回去、要说两遍的真的重说），不是加个前缀词。 */
      const verb = personality.sayVerbToned(npc);
      const cp = personality.catchphraseOf(npc);
      const rate = personality.catchphraseRate(npc);
      const prefix = (cp && rate && w.rng.next() < rate) ? cp : '';
      const base = evalTemplate(w.rng.pick([].concat(npc.talk)), ctx);
      const spoken = personality.styleSpeak(npc, base);
      lines.push({ kind: 'say', text: `${npc.name}${verb}：「${prefix}${spoken}」` });
    } else {
      /* ★ 主人第四轮：「『交谈』按钮的可交互性就更多了但实际却没有什么」。
         根因就在这一支：329 个 NPC 里写了 `talk` 台词的是少数，
         其余绝大部分走到这里都回一句「看了你一眼，没有说话」——
         点了等于没点。现在改成**按情境现编**（时段 / 交情 / 身份 / 禀性），
         并且回话里那个名字**可点**，点开就是他此刻能聊的几个话头。 */
      lines.push({ kind: 'say', text: smallTalk(w, npc) });
    }
    /* ---- 引荐人（茶摊老汉）----
       主人：「玩家进入游戏触发的剧情没有后续吗？这个剧情应该一路引导玩家
       拜入一个宗门才对」。楔子末尾把玩家交给的就是这位老汉 ——
       第一次跟他搭话，他把引荐信给你、并指明该往哪座山门去。
       ⚠️ 只在**这个人**身上挂，且 handOutLetter 自带幂等（发过一次就不再发）。 */
    try {
      if (npc.defId === 'guide_teaman') {
        for (const l of tutorialMod.handOutLetter(w, npc)) lines.push(l);
      }
    } catch (e) { /* 引荐坏了不许影响说话 */ }
    /* ---- 闲聊也要有「结果」----
       主人第四轮：「交谈按钮的可交互性就更多了但实际却没有什么」。
       对话内容再花，点完没有任何变化，玩家仍会觉得空。
       所以：跟同一个人**每天最多聊出 3 次交情**（+1 好感），
       上限是为了防「反复点交谈刷好感」—— 一天三句，再多就成了聒噪。 */
    {
      const day = Math.floor(w.clockMinutes / 1440);
      const st = npc.pstate || (npc.pstate = { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false });
      if (st.chatDay !== day) { st.chatDay = day; st.chatCount = 0; }
      if ((st.chatCount || 0) < 3) {
        st.chatCount = (st.chatCount || 0) + 1;
        /* 走 world.gainFavor：正向增量会过「口才便给」天赋倍率 */
        const fd = Math.round(w.gainFavor(npc, 1));
        if (fd) lines.push({ kind: 'sys', text: `　（闲谈几句，${npc.name}对你多了三分熟络。）` });
      }
      /* 主人 2026-10-13：「再多说就显得聒噪」那段黄字删了 —— 话头断了就断了，
         不必追一句系统提醒。（好感那边也是：涨了才提一句，没涨不吭声。） */
    }
    /* ---- 话头：把回话里的**名字**做成可点菜单 ----
       这是「交谈」从「看一句话」变成「聊得下去」的关键：
       点名字就能接着聊、打听、问他的事、送礼、告辞 —— 全是有真指令的项。 */
    const nameIdx = lines.findIndex(l => l.kind === 'say' && String(l.text || '').includes(npc.name));
    if (nameIdx >= 0) {
      lines[nameIdx] = Object.assign({}, lines[nameIdx], {
        hl: [{
          text: npc.name, type: 'npc', actions: [
            { label: '接着聊', cmd: 'talk ' + npc.name, hint: '多说两句' },
            { label: '打听消息', cmd: 'ask ' + npc.name + ' about 江湖消息' },
            { label: '问他的事', cmd: 'ask ' + npc.name + ' about 你是谁' },
            { label: `送${pronounOf(npc) === '她' ? '她' : (pronounOf(npc) === '它' ? '它' : '他')}东西`, cmd: 'give ' + npc.name },
            { label: '拱手告辞', cmd: '告辞 ' + npc.name, hint: '有始有终，留个好印象' },
          ],
        }],
      });
    }
    return { lines };
  });

  /* ---------------- 告辞（「交谈」的收尾动作）----------------
     主人第四轮要「交谈可交互性更多」——一轮闲聊总得有个收尾。
     礼数周全地道个别：小涨好感（礼多人不怪），也让玩家知道这次谈话结束了。 */
  reg(['farewell', '告辞', '告别', '作别', '抱拳'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    if (!args.length) return { lines: [{ kind: 'warn', text: '跟谁告辞？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const verb = personality.sayVerbToned(npc);
    const lines = [];
    const before = npc.favor || 0;
    /* 走 world.gainFavor：正向增量会过「口才便给」天赋倍率 */
    w.gainFavor(npc, 1);
    lines.push({ kind: 'story', text: `你朝他拱了拱手，道一声「后会有期」。` });
    lines.push({ kind: 'say', text: `${npc.name}${verb}：「慢走，不送。」` });
    if ((npc.favor || 0) > before) lines.push({ kind: 'sys', text: `　（礼数到了，${npc.name}的好感 +${Math.round(npc.favor - before)}。）` });
    return { lines };
  });

  reg(['ask', '问', '询问'], (ctx, args) => {
    // ask <人> about <话题>
    const p = ctx.player, w = ctx.world;
    const s = args.join(' ');
    /* ⚠️ 分隔符只认 `about` 和「关于」，**不要拿「问」字切** ——
       「问 某某 问点什么」的 topic 里本身带「问」，切完只剩碎片
       （历史上「随便问点什么」被切成「随便」，问了个寂寞）。
       拿到全部片段，用分隔符定位，剩下的**拼回完整话题**（别只取 m[1]）。 */
    const SEP = /\s+about\s+|\s*关于\s*|\s+关于\s+/i;
    let npcKw, topic;
    const hit = s.match(SEP);
    if (hit) {
      const idx = s.indexOf(hit[0]);
      npcKw = s.slice(0, idx).trim();
      topic = s.slice(idx + hit[0].length).trim();
    } else {
      npcKw = args[0];
      topic = args.slice(1).join(' ').trim();
    }
    if (!npcKw) return { lines: [{ kind: 'warn', text: '问谁？「ask <人> about <话题>」。' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), npcKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${npcKw}」。` }] };
    if (!topic) return { lines: [{ kind: 'warn', text: `想问${npc.name}什么？` }] };
    const def = npc.def || {};
    const lines = [{ kind: 'sys', text: `你向${npc.name}问起「${topic}」。` }];
    let found = false;
    if (def.ask) {
      /* ⚠️ 归一化：`ask` 在数据里有**三种**写法，全都要认。
         原来只处理了「单对象 {topic,answer}」和「数组」两种，
         而数据里的**主流写法其实是第三种**：`{ "话题": "答案", … }` 映射对象
         （mods/demo_skill 的太虚居士、以及一大批 NPC 都这么写）。
         映射对象走进 `[raw]` 之后，`a.topic` 是 undefined →
         `a.topic.includes(topic)` **抛异常**，整条 ask 指令直接挂掉 ——
         玩家看到的不是「他答不上来」，是「命令崩了」。
         （第四轮补回春堂 NPC 时踩到的：我用的是数据惯例写法，一按就崩。） */
      const rawAsk = def.ask;
      const askList = normalizeAskList(rawAsk);
      for (const a of askList) {
        if (!a || !a.topic) continue;
        if (topic.includes(a.topic) || a.topic.includes(topic) || (a.keywords || []).some(k => topic.includes(k))) {
          found = true;
          if (a.answer) lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(a.answer, ctx)}」` });
          if (a.effects) evalEffects(a.effects, { player: p, world: w, npc }).forEach(l => lines.push(l));
          break;
        }
      }
    }
    /* ---- 画像 L2 问出 ----
       来历（trust≥0）/ 近况（trust≥20）/ 欲望（trust≥50）/ 惧怕（trust≥70）。
       门槛一律用 trust（信得过你），不用 favor（喜欢你）—— 送礼只涨 favor，
       办成事才涨 trust，两条轴不能混。没有画像的 NPC 完全走原逻辑。 */
    if (!found && npc.portrait) {
      const pt = npc.portrait;
      const trust = (npc.pstate && npc.pstate.trust) || 0;
      const KEYS = {
        origin: ['来历', '出身', '哪里人', '你是谁', '家乡', npc.name],
        now: ['近况', '最近', '如今', '怎么了', '忙什么', '在忙'],
        want: ['欲望', '想头', '指望', '想要', '图什么', '求什么', '心愿'],
        fear: ['怕什么', '惧怕', '害怕', '隐忧'],
      };
      const NEED = { origin: 0, now: 20, want: 50, fear: 70 };
      const NAME = { origin: '来历', now: '近况', want: '想头', fear: '惧怕' };
      for (const k of ['origin', 'now', 'want', 'fear']) {
        if (!pt[k]) continue;
        if (!KEYS[k].some(x => x && topic.includes(x))) continue;
        found = true;
        const verb = personality.sayVerbToned(npc);
        if (trust >= NEED[k]) {
          lines.push({ kind: 'say', text: `${npc.name}${verb}：「${evalTemplate(pt[k], ctx)}」` });
        } else {
          /* 交情不够：不撒谎，也不白给——把门槛说出来，玩家才知道要去做事而不是送礼 */
          lines.push({ kind: 'say', text: `${npc.name}${verb}：「${NAME[k]}么……你还问不着。」（信不过你，办成几件事再说）` });
        }
        break;
      }
      /* 禁忌话题：踩到 voice.taboo 掉好感（−5~−15，按层级加权）
         ⚠️ 两处收口（2026-10-11 查画像一致性时抓到，同一类问题）：
         ① **单字禁忌一律不算**。数据里有人把 taboo 写成「手」「塔」「水」这种单字，
            于是「华山的旧手」这种正经话题也会撞上去，白白扣好感 —— 一个字宽到
            能盖住半部词典，那不叫禁忌，那叫碰瓷。
         ② **钩子标题不算踩雷**。画像里 taboo 与 hooks[].title 是同一个心结的两种写法：
            taboo = 「外人提不得」，hooks = 「他信得过你才托给你的事」。
            玩家照着他自己给的钩子标题去问，反倒先被扣 15 点好感 —— 两栏打架，
            45 处撞车。以钩子为准。 */
      const taboo = (pt.voice && pt.voice.taboo) || [];
      const hookTitles = (pt.hooks || []).map(h => h && h.title).filter(Boolean);
      const hitTaboo = taboo.some(x => x && String(x).length >= 2 && topic.includes(x)
        && !hookTitles.some(t => t.includes(x) || x.includes(t)));
      if (hitTaboo) {
        const d = -5 - (pt.tier === 'A' ? 10 : pt.tier === 'B' ? 5 : 0);
        /* 踩忌口是**负向**好感；走 gainFavor 只是收敛口径（负向不吃「口才便给」倍率） */
        w.gainFavor(npc, d);
        lines.push({ kind: 'sys', text: `（${npc.name}的脸沉了一下，好感 ${d}）` });
      }
      /* ---- 画像 L3 吐露：恩怨 feuds + 隐秘 secret（任务三）----
         这两样是**交情到一定程度才肯说**的东西，门槛一律用 trust（不是 favor）：
           · 恩怨 feuds —— trust≥40 说得出「谁跟谁有过节」（江湖人最爱嚼这个）；
           · 隐秘 secret —— 门槛随画像 secret.tier 抬（50 + tier×5；tier2→60、tier3→65），
             事越大越不肯讲。吐露后记进 pstate.revealed（存档留痕，日后可追踪）。
         交情不够时**不撒谎也不白给**：明确把门槛说出来，玩家才知道该去做事。 */
      const verb2 = personality.sayVerbToned(npc);
      const FEUDK = ['仇家', '恩怨', '结仇', '和谁有仇', '仇人', '冤家', '过节', '旧账'];
      if (!found && pt.feuds && pt.feuds.length && FEUDK.some(x => topic.includes(x))) {
        found = true;
        if (trust >= 40) {
          const parts = pt.feuds.slice(0, 3).map(f => {
            /* feuds[].id 是 **defId**（模板 id），要用 data.npcs 查名；
               ⚠️ world.getNpc() 查的是**实例 id**（同名方法有两个定义，后者覆盖）→ 查不到。 */
            const other = (w.data.npcs && w.data.npcs[f.id]) || {};
            const nm = other.name || f.id;
            return `${nm}（${f.kind || '旧识'}${f.why ? '：' + f.why : ''}${f.since ? '，' + f.since + '起' : ''}）`;
          });
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「提这些做什么……${parts.join('；')}。」` });
        } else {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「谁的账，也轮不到同你说。」（信不过你，办成几件事再说）` });
        }
      }
      const SECK = ['秘密', '秘辛', '底细', '心事', '隐情', '把柄', '瞒着', '不可告人', '藏着'];
      if (!found && pt.secret && pt.secret.text && SECK.some(x => topic.includes(x))) {
        found = true;
        const need = 50 + (pt.secret.tier || 1) * 5;
        if (trust >= need) {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「这话我只说一遍……${evalTemplate(pt.secret.text, ctx)}」` });
          if (npc.pstate) {
            npc.pstate.revealed = npc.pstate.revealed || [];
            if (npc.pstate.revealed.indexOf('secret') < 0) npc.pstate.revealed.push('secret');
          }
        } else {
          lines.push({ kind: 'say', text: `${npc.name}${verb2}：「你还问不着这个。」（信得过我，才说得出口——先替我把事办了）` });
        }
      }
      /* ---- 画像 L4 · 钩子（hooks）：他手里那件「你能帮着做的事」----
         这是画像里**唯一指向「接下来能干什么」**的一栏（type: task/reveal），
         每条都写了「他有什么难处 / 你要做什么 / 做成了得什么」。
         ⚠️ 原先这一栏全仓**没有任何消费点**（51 个人写了钩子，一个也问不出来），
            而且它的 `trigger` 一律读 `var: trust_<npcId>`，那个变量也**从没人写过** ——
            「没人读」+「条件恒不成立」，双重死数据。这里两处一起补：
              · 先把这人的 trust 同步进 p.vars（判据见 world.syncTrustVar）；
              · 再按 trigger 给出「说 / 不说」两种回应。
         问法有两种：`ask <人> about <钩子标题>`，或者泛问「有什么难处 / 要我做什么」。 */
      if (!found && pt.hooks && pt.hooks.length) {
        w.syncTrustVar(npc);
        const K = topic || '';
        const GENERAL = ['难处', '心事', '要办的事', '什么事', '帮忙', '帮你', '尽管说', '有没有事', '用得上我'];
        let hk = pt.hooks.find(h => h && h.title && K && (K.includes(h.title) || h.title.includes(K)));
        let generic = false;
        if (!hk && GENERAL.some(x => K.includes(x))) {
          generic = true;
          /* 泛问挑一条：优先「现在就能做」的，都做不了就挑门槛最低的那条（第一条） */
          hk = pt.hooks.find(h => !h.trigger || evalCond(h.trigger, { player: p, world: w })) || pt.hooks[0];
        }
        if (hk) {
          found = true;
          const hstate = (npc.pstate && npc.pstate.hooks) || {};
          const open = !hk.trigger || evalCond(hk.trigger, { player: p, world: w });
          if (hstate[hk.id]) {
            lines.push({ kind: 'say', text: `${npc.name}${verb2}：「那桩事你已经在办了，我记着。」` });
          } else if (open) {
            lines.push({ kind: 'say', text: `${npc.name}${verb2}：「${evalTemplate(hk.seed || hk.title || '', ctx)}」` });
            if (hk.rewardHint) lines.push({ kind: 'hint', text: `（${hk.rewardHint}）` });
            if (npc.pstate) { npc.pstate.hooks = npc.pstate.hooks || {}; npc.pstate.hooks[hk.id] = 1; }
            lines.push({ kind: 'sys', text: `（你记下了「${hk.title}」这件事。）` });
          } else {
            /* 交情不到：不撒谎、也不白给 —— 把话头留在这儿，玩家自己会去经营 */
            lines.push({ kind: 'say', text: `${npc.name}${verb2}：「${generic ? '我这儿的难处，' : hk.title + '么……'}还不到同你说的时候。」` });
            lines.push({ kind: 'hint', text: '（先替他把别的事办成；他信得过你了，自己会说。）' });
          }
        }
      }
    }
    /* ---- 问「他认识的人」（主人第四轮）----
       前端「询问」面板里会列出 `askPeople`（= npcKnownPeople 的同一份数据），
       点名字就发 `ask <他> about <人名>`；这里负责把名字对上并答出来。
       ⚠️ 名字要 ≥2 字才参与匹配：单字名（「三」「七」）会让
          「江湖消息」里的任意一个字都撞上，变成答非所问。 */
    if (!found) {
      const who = npcKnownPeople(w, npc).find(x => x.name.length >= 2 &&
        (topic.includes(x.name) || x.name.includes(topic)));
      if (who) {
        found = true;
        for (const l of npcAboutPerson(w, npc, who)) lines.push(l);
      }
    }
    if (!found) {
      /* ---- 通用兜底：让「询问」永远有回应 ----
         329 个 NPC 里只有 18 个有 ask 数据，前端「询问」面板却对所有人开放。
         这三档是程序化生成的，任何 NPC 都接得住：
           · 「你是谁」→ 报身份（跟场景栏同一个口径 npcIdentity）
           · 「近况」  → 按画像/作息/好感编一句
           · 「江湖消息」→ 用 askDefault，没有就编一句「这我知道得不多」
         顺序：专属 ask → 画像项 → 通用项（最后兜底）。 */
      const K = topic || '';
      if (/你是谁|身份|来历|姓名|叫什么/.test(K)) {
        found = true;
        const who = npcIdentity(w, npc);
        lines.push({ kind: 'say', text: `${npc.name}道：「${who}。在这地方待着，也就这样了。」` });
      } else if (/近况|最近|如今|怎么了/.test(K)) {
        found = true;
        /* 画像近况优先（trust 门槛同上），没有就拿作息/好感拼 */
        const pt = npc.portrait;
        const trust = (npc.pstate && npc.pstate.trust) || 0;
        if (pt && pt.now && trust >= 20) {
          lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(pt.now, ctx)}」` });
        } else if (pt && pt.now) {
          lines.push({ kind: 'say', text: `${npc.name}道：「近况么……你还问不着。」（信不过你，办成几件事再说）` });
        } else {
          const f = npc.favor || 0;
          const tone = f > 40 ? '「老样子，一天一天过着。有你在，倒也不那么闷。」'
            : f < -20 ? `「不关你的事。」${pronounOf(npc)}说完就不再看你。`
              : '「混口饭吃，哪有什么近况。」';
          lines.push({ kind: 'say', text: `${npc.name}${personality.sayVerbToned(npc)}：${tone}` });
        }
      } else if (/江湖消息|江湖|传闻|消息|news|近闻/.test(K)) {
        found = true;
        if (def.askDefault) {
          lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(def.askDefault, ctx)}」` });
        } else {
          /* 没有 askDefault 就给一条「什么都不知道但态度明确」的回应，
             顺便把 askDefault 缺了这件事说清楚：不是玩家问错，是这个 NPC 没料 */
          lines.push({ kind: 'say', text: `${npc.name}摇摇头：「江湖上的事？我一个${npcIdentity(w, npc)}，哪能知道那么多。」` });
          lines.push({ kind: 'sys', text: `（${pronounOf(npc)}没什么可打听的。要问出东西来，得先有交情，或找${pronounOf(npc)}真正在意的事。）` });
        }
      }
    }
    if (!found) {
      if (def.askDefault) lines.push({ kind: 'say', text: `${npc.name}道：「${evalTemplate(def.askDefault, ctx)}」` });
      else lines.push({ kind: 'say', text: `${npc.name}摇摇头：「这个我却不知。」` });
    }
    /* ---- 引荐人：问他也一样给引荐信（玩家可能先问、后聊）----
       与 talk 那条**同一个入口** `handOutLetter`（幂等），
       绝不能在两处各写一遍「发信」的逻辑（改一半等于没改）。 */
    try {
      if (npc.defId === 'guide_teaman') {
        for (const l of tutorialMod.handOutLetter(w, npc)) lines.push(l);
      }
    } catch (e) { /* 引荐坏了不许影响问话 */ }
    return { lines };
  });

  reg(['list', 'shop', '货', '买卖'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let npc = null;
    if (args.length) npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    else npc = w.npcsIncludingTemplates(p.room).find(n => n.shop);
    if (!npc) return { lines: [{ kind: 'warn', text: '这里没有做买卖的人。' }] };
    const lines = [{ kind: 'title', text: `【 ${npc.name}的货摊 】` }];
    const shop = w.data.shops[npc.shop] || { goods: (npc.def && npc.def.goods) || [] };
    /* 天赋「经商奇才」：标价即折后价（否则看到的与买到的对不上） */
    const shopDisc = w.shopDiscount(p);
    for (const g of shop.goods) {
      const d = w.getItem(g.item || g.id);
      if (!d) continue;
      const price = Math.floor((g.price || Math.floor((d.value || 10) * 1.5)) * (1 - shopDisc));
      lines.push({ kind: 'item', text: `${d.name}　${price} 文${g.stock !== undefined ? `（余 ${g.stock}）` : ''}`, itemId: g.item || g.id, price });
    }
    lines.push({ kind: 'hint', text: '用「买 <物品名>」购买，「卖 <物品名>」出售。' });
    return { lines };
  });

  reg(['buy', '买', '购买'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let kw = args.join(' ').split(/\s+from\s+/)[0];
    let count = 1;
    const cm = kw.match(/^(.+?)\s*[x×]\s*(\d+)$/);
    if (cm) { kw = cm[1]; count = parseInt(cm[2], 10); }
    const shopNpc = w.npcsIncludingTemplates(p.room).find(n => n.shop || (n.def && n.def.goods));
    if (!shopNpc) return { lines: [{ kind: 'warn', text: '这里没有商贩。' }] };
    const shop = w.data.shops[shopNpc.shop] || { goods: (shopNpc.def && shopNpc.def.goods) || [] };
    const hit = fuzzyFind(shop.goods, kw, g => { const d = w.getItem(g.item || g.id); return d ? d.name : g.item; });
    if (!hit) return { lines: [{ kind: 'warn', text: `${shopNpc.name}没有「${kw}」卖。` }] };
    const d = w.getItem(hit.item || hit.id);
    const price = (hit.price || Math.floor((d.value || 10) * 1.5)) * count;
    const discount = 1 - clamp((p.reputation[shopNpc.def && shopNpc.def.sect] || 0) / 2000, 0, 0.15);
    /* 世界动态 W6（design/27 §3.3-2）：本派地盘上，势力越盛，货越便宜。
       叠在既有 reputation 折扣之上（各至多 15%）。 */
    let facDisc = 0;
    if (typeof w.factionOfRegion === 'function') {
      const rm = w.getRoom(p.room);
      const fid = rm && w.factionOfRegion(rm.region);
      const fac = fid && w.factionState && w.factionState.factions[fid];
      if (fac) facDisc = clamp(fac.power / 100 * 0.15, 0, 0.15);
    }
    /* 天赋「经商奇才」：买价再打折（叠在声望/势力折扣之上） */
    const final = Math.floor(price * discount * (1 - facDisc) * (1 - w.shopDiscount(p)));
    if (p.money < final) return { lines: [{ kind: 'warn', text: `你钱不够，需要 ${final} 文，你有 ${p.money} 文。` }] };
    p.money -= final;
    w.giveItem(p, hit.item || hit.id, count);
    /* B22 埋点 13/14 · rs_bigspender（挥金，市井闲谈）：单笔消费超 500 文记一笔。 */
    if (final >= 500 && typeof w.addRumor === 'function') {
      w.addRumor('rs_bigspender', { room: p.room, vars: { who: p.name || '有人', where: (w.getRoom(p.room) || {}).name || '市上', whom: '掌柜' } });
    }
    return { lines: [{ kind: 'sys', text: `你买下了${d.name}${count > 1 ? ' x' + count : ''}，花费 ${final} 文。` }] };
  });

  reg(['sell', '卖', '出售'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想卖什么？' }] };
    const shopNpc = w.npcsIncludingTemplates(p.room).find(n => n.shop || (n.def && n.def.goods));
    if (!shopNpc) return { lines: [{ kind: 'warn', text: '这里没有商贩。' }] };
    const hit = fuzzyFind(p.inventory || [], args.join(' '), i => { const id = (typeof i === 'object' && i) ? i.id : i; const d = w.getItem(id); return (d && d.name) || id; });
    if (!hit) return { lines: [{ kind: 'warn', text: `你身上没有「${args.join(' ')}」。` }] };
    const d = w.getItem(hit.id);
    /* 天赋「经商奇才」：卖价抬高（×1.15），与买价折扣同源 */
    const price = Math.floor((d.value || 5) * 0.6 * (1 + w.shopDiscount(p)) * (hit.count || 1));
    w.removeItem(p, hit.id, hit.count || 1);
    p.money += price;
    return { lines: [{ kind: 'sys', text: `你卖掉了${d.name}，得银 ${price} 文。` }] };
  });

  /* ---------------- 门派 / 任务 ---------------- */

  reg(['sect', '门派'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) {
      if (p.mySect) {
        const info = sectFounder.sectInfo(w);
        const lines = [{ kind: 'title', text: `【 ${info.name} 】（你的宗门）` }];
        lines.push({ kind: 'plain', text: `宗主：${info.founder}　威望：${info.prestige}　演武 ${info.drills} 次　战绩 ${info.wins} 胜 ${info.losses} 负` });
        lines.push({ kind: 'subtitle', text: `门下弟子（${info.members.length} 人）` });
        if (!info.members.length) lines.push({ kind: 'plain', text: '　（尚无人投奔，发「招贤 <人名>」广纳贤才）' });
        for (const m of info.members) lines.push({ kind: 'plain', text: `　${m.name}　战力 ${m.power}` });
        if (info.base) lines.push({ kind: 'hint', text: `驻地：${(w.getRoom(info.base) || {}).name || info.base}` });
        lines.push({ kind: 'hint', text: '发「招贤 <人名>」纳贤、「演武」聚徒习武、「大比」约战群雄、「解散宗门」遣散。' });
        return { lines };
      }
      if (p.sect) {
        const sd = w.getSect(p.sect);
        const lines = [{ kind: 'title', text: `【 ${sd ? sd.name : p.sect} 】` }];
        lines.push({ kind: 'plain', text: sd && sd.desc ? sd.desc : '' });
        lines.push({ kind: 'plain', text: `你的身份：${sd && sd.ranks ? sd.ranks[p.rank] : '弟子'}　贡献：${p.sectContribution}` });
        if (sd && sd.ranks) {
          lines.push({ kind: 'subtitle', text: '门中位阶' });
          sd.ranks.forEach((r, i) => lines.push({ kind: 'plain', text: `${i === p.rank ? '→ ' : '  '}${r}${i > 0 ? `（需贡献 ${(sd.rankCost || 500) * i}）` : ''}` }));
        }
        if (sd && sd.skills) lines.push({ kind: 'hint', text: `本门武学：${sd.skills.map(s => (w.getSkill(s) || {}).name || s).join('、')}` });
        return { lines };
      }
      const lines = [{ kind: 'title', text: '【 江湖门派 】' }];
      for (const id of Object.keys(w.data.sects)) {
        const sd = w.data.sects[id];
        lines.push({ kind: 'plain', text: `${sd.name}　${sd.align || ''}　${sd.desc ? sd.desc.slice(0, 30) : ''}` });
      }
      lines.push({ kind: 'hint', text: '用「拜师 <门派名>」拜师入门。' });
      return { lines };
    }
    const sd = fuzzyFind(Object.values(w.data.sects), args.join(' '), s => s.name);
    if (!sd) return { lines: [{ kind: 'warn', text: '江湖中没有这个门派。' }] };
    // 找掌门
    const npc = w.npcsIncludingTemplates(p.room).find(n => n.def && n.def.sect === sd.id && (n.def.isMaster || n.rank >= (sd.ranks ? sd.ranks.length - 1 : 0)));
    if (!npc) return { lines: [{ kind: 'warn', text: `你得先找到${sd.name}的掌门或长老才行。` }] };
    const r = p.joinSect(sd.id);
    const lines = [{ kind: 'sys', text: r.msg }];
    if (r.ok) lines.push({ kind: 'say', text: `${npc.name}上下打量你一番，微微颔首。` });
    return { lines };
  });

  /* 拜师（主人 2026-10-08）：「npc 互动面板增加拜师」+「加入门派方式也是拜师」。
     同一个指令两条路：
       · `拜师 <人名>`   —— 拜**个人**为师，此后「请教」他的功夫必定学得会
       · `拜师 <门派名>` —— 入**山门**（原来的 join 行为，一个字没改）
     先按人名找，找不到再按门派名找 —— 「拜师 令狐冲」与「拜师 华山派」都通。 */
  reg(['join', '拜师', 'baishi', '入门'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想拜谁为师？（「拜师 <人名>」拜个人，或「拜师 <门派名>」入山门）' }] };
    const kw = args.join(' ');

    /* ---- 第一条路：拜一个人 ---- */
    const person = fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name);
    if (person && !person.isPlayer) {
      if (person.dead || person.knockedOut) return { lines: [{ kind: 'warn', text: `${person.name}现在没法答你的话。` }] };
      if (person.def && person.def.hostile) return { lines: [{ kind: 'warn', text: '对方杀机毕露，这一拜怕是要拜进阎王殿。' }] };
      /* 同门的长辈：这不是「拜师」，是**求升** ——
         主人原话：「普通弟子晋升条件也是贡献足够后拜长老成真传」。
         贡献不够时他会明说差多少（promoteByMaster 里写了）。 */
      if (p.sect && person.sect === p.sect && ((person.rank === undefined ? 3 : person.rank) > (p.rank || 0))) {
        const SL = require('./sectlife');
        const DS = require('./discipleship');
        /* 「一人只有一个师门」也管着门内这条路：外面认了个人师父（rec.sect 为空）
           的，得先了断才谈得上在门里另认 —— 不然一转身门里门外两位师父，说不通。 */
        const cur = DS.currentMaster(p);
        if (cur && !(cur.rec && cur.rec.sect)) {
          return {
            lines: [
              { kind: 'warn', text: `${person.name}摇头：「你已在外头认了师父。门里的师承，不便与外人并立。」` },
              { kind: 'hint', text: `（先与${(cur.rec && cur.rec.name) || '那位'}了断：用「出师」或「退出师门」。）` },
            ],
          };
        }
        const r = SL.promoteByMaster(w, p, person);
        const lines = r.lines || [];
        if (r.ok) {
          /* 门内转拜更高职位（主人 2026-10-11）：
             ① 新认的这位成为你的**门派师父**（往后「请教」他一句就教）；
             ② **同一个门派**里原来那位（低职位的同门）从此不再是你的师父。
             江湖上认的个人师父（rec.sect 为空）不动 —— 那跟门内升迁没关系。 */
          const mid = DS.setMaster(p, person, { sect: p.sect });
          lines.push(...DS.dropSectMasters(w, p, mid));
        }
        return { lines };
      }
      p.masters = p.masters || {};
      const mid = person.defId || person.id;
      if (p.masters[mid]) return { lines: [{ kind: 'warn', text: `你已拜过${person.name}为师了。` }] };
      const DS = require('./discipleship');
      /* 他肯不肯收，看他手上有没有功夫、以及你在他眼里是个什么人。
         ⚠️「收徒条件由你（我）判断」——定的规矩是三条：手上有货 / 不是无名杂鱼 / 你与他不是陌路。
         🔴 **先判「他收不收」，再判「你有没有师父」**（主人 2026-10-11 的先后要求）：
            顺序反了的话，一个根本不肯收你的人也会得到「你已有师门」——
            玩家会以为换个人就能拜，白跑一趟。判定失败一律走原来那句失败的话。 */
      const canTeach = social.teachList(w, person).filter(s => !s.known);
      if (!canTeach.length) return { lines: [{ kind: 'warn', text: `${person.name}摆手：「我这点本事，教不了人。」` }] };
      if ((person.tier || 'C') === 'C' && !canTeach.some(s => (s.level || 0) > 60)) {
        return { lines: [{ kind: 'warn', text: `${person.name}笑了笑：「我这几手粗浅把式，哪配当人师父。」` }] };
      }
      const favor = person.favor || 0;
      if (favor < 15) {
        return {
          lines: [
            { kind: 'warn', text: `${person.name}打量你两眼，摇头：「萍水相逢，凭什么收你？」` },
            { kind: 'hint', text: `（好感需 15，你当前 ${favor}。先与他多来往、送礼，或帮个忙。）` },
          ],
        };
      }
      /* ---- 一人只有一个师门（主人 2026-10-11）----
         他肯收、你也够格，这才轮到「可你已经有师父了」。
         门内的转拜走上面那条求升的路，不会走到这儿（那条要清掉同门旧师父）。 */
      const cur = DS.currentMaster(p);
      if (cur && cur.id !== mid) {
        const rec = cur.rec || {};
        return {
          lines: [
            { kind: 'warn', text: `${person.name}看了看你，摇头：「你已有师门。既是${rec.name || '别人'}门下的人，我不便再收。」` },
            {
              kind: 'hint',
              text: rec.sect
                ? `（你眼下的师承在${rec.sect}。门内换人，直接去向职位更高的人「拜师」；要断，用「退出师门」。）`
                : `（要另投他人，先同${rec.name || '你师父'}了断 —— 用「出师」或「退出师门」。）`,
            },
          ],
        };
      }
      /* ⚠️ `sect` 这一笔只在他**与你是同一个门派**时才记（那才叫门派师承）。
         第一版写成 `person.sect || null` —— 于是「在外头拜了个华山派的人」
         也被当成门派师父，面板上连「出师」都不给（主人要的是个人师父能出师）。 */
      DS.setMaster(p, person, { sect: (p.sect && person.sect === p.sect) ? person.sect : null });
      const fr = social.addFavor(w, person, 15 * w.favorGainMult(p), '收徒');
      const lines = [
        { kind: 'story', text: `你整了整衣冠，恭恭敬敬朝${person.name}磕了三个头。${person.name}受了，把袖口一拂：「起来罢。」` },
        { kind: 'sys', text: `你拜${person.name}为师。往后「请教 ${person.name}」他手上的功夫，他都会教你。` },
      ];
      lines.push(...(fr.lines || []));
      /* 拜师也算一桩可传的事（自拟 🅔）：往门外一站就是「某某磕了头认了师」。
         一天只传一回（rumorfeed 里管着），免得反复拜师刷屏。 */
      try {
        require('./rumorfeed').note(w, 'rs_master_take', { vars: { whom: person.name } });
      } catch (e) { /* 传不出去不该挡着拜师 */ }
      return { lines };
    }

    // 优先找本房间 NPC 所属门派
    const npcs = w.npcsIncludingTemplates(p.room).filter(n => n.def && n.def.sect);
    let targetSect = null;
    for (const n of npcs) {
      const sd = w.getSect(n.def.sect);
      if (sd && (sd.name.includes(kw) || kw.includes(sd.name) || n.name.includes(kw))) { targetSect = sd; break; }
    }
    if (!targetSect) {
      targetSect = fuzzyFind(Object.values(w.data.sects), kw, s => s.name);
    }
    if (!targetSect) return { lines: [{ kind: 'warn', text: '江湖中没有这个门派，也没有这么个人。' }] };
    const r = p.joinSect(targetSect.id);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const lines = [{ kind: 'sys', text: r.msg }];
    if (targetSect.entryEffects) evalEffects(targetSect.entryEffects, ctx).forEach(l => lines.push(l));
    /* 门派剧情第一段（主人：「玩家初入宗门时触发门派剧情任务」）——
       按这一家的气质分野（正道怕坏名声 / 邪派怕被合起来打 / 中立两头不讨好）。 */
    lines.push(...require('./sectlife').storyEntry(w, p, targetSect));
    /* B22 埋点 6/14 · rs_sect_join（拜入门派，扬名 +）：门派弟子/山门目击 → 邻房也传。 */
    if (typeof w.addRumor === 'function') {
      w.addRumor('rs_sect_join', { room: p.room, about: targetSect.id, vars: { who: p.name, where: targetSect.name } });
    }
    return { lines };
  });

  /* ---------------- 山门守卫（design/71 §四）----------------
     主人：「守门处有个闯山门的按钮是个摆设玩家直接就能进去」。
     守卫在 doMove 钩子层拦人（给出 choices），这三个指令是那三个出口的**执行端**：
       · `报名入山 <门派名>` —— 报上名号，守卫按 joinSect 那套放行/回绝
       · `打点入山 <门派名>` —— 塞钱（只对恶名在身的人有意义）
       · `硬闯 <门派名>`     —— 硬来（走普通战斗；守门人太行就直接擒下）
     参数缺省时用当前被拦的门派（choices 里带全名，但手敲可以只敲两个字）。 */
  const _guardSectArg = (w, p, args) => {
    const kw = (args || []).join('').trim();
    if (kw) {
      const hit = Object.values(w.data.sects || {}).find(s => s.name === kw || s.id === kw)
        || Object.values(w.data.sects || {}).find(s => s.name && (s.name.includes(kw) || kw.includes(s.name)));
      if (hit) return hit.id;
    }
    const at = require('./guards').sectAtRoom(w, p.room);
    return at ? at.id : null;
  };
  reg(['报名入山', '报名'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const G = require('./guards');
    if (!p.vars || !p.vars.guardBy) return { lines: [{ kind: 'plain', text: '没人拦着你。' }] };
    const sid = _guardSectArg(w, p, args) || (p.vars.guardAt && p.vars.guardAt.sect);
    return { lines: G.stateName(w, p, sid) };
  });
  reg(['打点入山', '打点'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const G = require('./guards');
    if (!p.vars || !p.vars.guardBy) return { lines: [{ kind: 'plain', text: '没人拦着你。' }] };
    const sid = _guardSectArg(w, p, args) || (p.vars.guardAt && p.vars.guardAt.sect);
    return { lines: G.bribe(w, p, sid) };
  });
  reg(['硬闯', '闯山门', '硬闯山门'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const G = require('./guards');
    const sid = _guardSectArg(w, p, args);
    if (!sid) return { lines: [{ kind: 'warn', text: '这里不是谁家的山门。' }] };
    return { lines: G.forceIn(w, p, sid) };
  });
  reg(['退下', '退走', '不闯了'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const G = require('./guards');
    const g = G.guardIn(w, p.room);
    if (p.vars && p.vars.guardBy) {
      p.vars.guardBy = null;
      return { lines: [{ kind: 'plain', text: `${g ? g.name : '那守卫'}看你退了半步，也就没再逼上来。` }] };
    }
    return { lines: [{ kind: 'plain', text: '你退后一步。' }] };
  });

  /* ---------------- 门派生涯（主人 2026-10-08）---------------- */

  /** 收徒大典：每个宗门各有一天，过不了常例门槛的人走这条路 */
  reg(['参加大典', '收徒大典', '大典', 'festival'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    if (!args.length) {
      const today = SL.festivalsToday(w);
      if (!today.length) {
        const all = Object.values(w.data.sects).map(s => SL.festivalInfo(w, s.id)).sort((a, b) => a.inDays - b.inDays);
        return {
          lines: [
            { kind: 'plain', text: `今日各山门都没办大典。最近的三家：${all.slice(0, 3).map(f => `${f.name}（还有 ${f.inDays} 天）`).join('、')}` },
            { kind: 'hint', text: '（要进哪一家，就赶在人家开山那天去：「参加大典 <门派名>」。）' },
          ],
        };
      }
      return {
        lines: [
          { kind: 'title', text: '【 今日开山收徒 】' },
          ...today.map(f => ({ kind: 'plain', text: `${f.name}（${f.tier}）——门槛不高，过了就留下` })),
          { kind: 'hint', text: '用「参加大典 <门派名>」去应试。' },
        ],
      };
    }
    const kw = args.join(' ');
    let sd = null;
    for (const n of w.npcsIn(p.room)) { const s = n.sect && w.getSect(n.sect); if (s && (s.name.includes(kw) || kw.includes(s.name))) { sd = s; break; } }
    if (!sd) sd = Object.values(w.data.sects).find(s => s.name.includes(kw) || kw.includes(s.name));
    if (!sd) return { lines: [{ kind: 'warn', text: `江湖中没有「${kw}」这一家。` }] };
    return { lines: SL.attendFestival(w, p, sd.id).lines };
  });

  /** 挑战：门中位次比你高一位的人，押上贡献去打一场 */
  reg(['挑战', 'tiaozhan', 'challenge'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想挑战谁？（门中位次比你高一位的那位）' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    const r = SL.startChallenge(w, p, npc);
    if (!r.ok) return { lines: r.lines };
    w.startCombat(p, npc);
    return { lines: r.lines };
  });

  /** 不挑战、走门路：长老位有缺 + 贡献够，向主事的开口 */
  reg(['申请', '请位', 'petition'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你尚无门派。' }] };
    const kw = args.join(' ');
    const npc = kw ? fuzzyFind(w.npcsIncludingTemplates(p.room), kw, n => n.name)
      : (w.npcsIn(p.room).find(n => n.sect === p.sect) || null);
    if (!npc) return { lines: [{ kind: 'warn', text: '这种话得当着门中主事的人说。' }] };
    return { lines: SL.applyByPetition(w, p, npc).lines };
  });

  /** 门派任务处 */
  reg(['门派任务', 'sectquest', '接差事'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你无门无派，执事房不派差事给你。' }] };
    const sd = w.getSect(p.sect);
    const t = SL.drawSectTask(w, p);
    const gain = Math.round(t.contrib * (1 + (p.rank || 0) * 0.15));
    p.sectContribution = (p.sectContribution || 0) + gain;
    p.advanceTime(180);
    return {
      lines: [
        { kind: 'story', text: `执事房的老先生翻着册子，指了一条给你：「${t.name}」——${t.desc}你接了牌子出门，回来时天已经擦黑。` },
        { kind: 'sys', text: `差事办妥，贡献 +${gain}（现 ${p.sectContribution}）。` },
      ],
    };
  });

  /** 官府任务处（功勋线，与门派线各走各的） */
  reg(['官府任务', '公差', 'officialquest', '领公事'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    const t = SL.drawOfficialTask(w, p);
    const gain = Math.round(t.merit * (1 + ((p.vars.officialRank || 0)) * 0.25));
    p.vars.officialMerit = (p.vars.officialMerit || 0) + gain;
    p.advanceTime(180);
    const up = SL.officialPromote(w, p);
    const lines = [
      { kind: 'story', text: `你在衙门口的公事牌上揭了一张：「${t.name}」——${t.desc}` },
      { kind: 'sys', text: `交差回来，功勋 +${gain}（现 ${p.vars.officialMerit}）。` },
    ];
    if (up) lines.push(...up.lines);
    return { lines };
  });

  /** 门派最终章：敌对门派下战书，华山对决（剧情视角） */
  reg(['华山对决', '门派决战', '下战书', 'duel'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const SL = require('./sectlife');
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你尚无门派，谈什么门户之争。' }] };
    const sd = w.getSect(p.sect);
    if (!SL.isSectMaster(p, sd)) {
      return { lines: [{ kind: 'warn', text: '这种事要一门之主才能应。你还没到那个位子。' }] };
    }
    const r = SL.duelOf(w, p, sd);
    if (r.ok) {
      p.vars = p.vars || {};
      p.vars.sectDuel = { at: w.clockMinutes || 0, foe: r.foe, stage: r.stage };
    }
    return { lines: r.lines };
  });

  /** 官府最终章：上战场（主人：「官府线最多成为将军，最终任务是上战场与敌国军队进行最终对决」） */
  reg(['出征', '上战场', '沙场', 'front'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    return { lines: require('./sectlife').battleFront(w, p).lines };
  });

  /* ---------------- 江湖榜（2026-10-11 自拟）----------------
     成长得有外部反馈。练到八百级没人知道，那练它做什么。 */

  reg(['江湖榜', '兵器谱', '高手榜', 'rank'], (ctx, args) => {
    const w = ctx.world;
    const R = require('./rank');
    const which = /恶人/.test(args.join('')) ? 'evil' : 'weapon';
    return { lines: R.boardText(w, which) };
  });

  reg(['恶人榜', 'evilrank'], (ctx) => {
    return { lines: require('./rank').boardText(ctx.world, 'evil') };
  });

  /** 榜上的人当面挑战 —— 接下就是一场 */
  reg(['比武', '应战', 'duel_rank'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: '你要跟谁比武？' }] };
    if (!p.sect && !Object.keys(p.learned || {}).length) {
      return { lines: [{ kind: 'warn', text: '你手上还没功夫，拿什么跟人比。' }] };
    }
    w.startCombat(p, npc);
    return {
      lines: [
        { kind: 'story', text: `你解下外袍交给旁边的人。${npc.name}也把袖子束好了。围观的往两边退开，让出一块空地。` },
        { kind: 'hint', text: '（赢了，谱上的位子就得挪一挪。）' },
      ],
    };
  });

  reg(['推辞', '婉拒', 'decline'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    const name = npc ? npc.name : '对方';
    return {
      lines: [
        { kind: 'plain', text: `你抱拳推辞了。` },
        { kind: 'say', text: `${name}看了你一眼，也没多说什么，把袖子放下来走了。` },
      ],
    };
  });

  /* ---------------- 镖局 · 送镖（design/67 §4）----------------
     主人 2026-10-11：「游戏好像也没有镖局以及送镖（送往其他城市有概率会被劫镖）任务」。
     两家镖局本来就在地图上（飞虎在长安、镇远在洛阳），这里只把柜台「点着」。 */
  reg(['镖单', '镖局', '看镖', '押镖'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const E = require('./escort');
    const st = E.statusOf(p);
    if (st) {
      return { lines: [
        { kind: 'title', text: `【在押】${st.grade} · ${st.from} → ${st.to}` },
        { kind: 'plain', text: `　镖物 ${st.pot - (st.lost || 0)}/${st.pot}　已走 ${st.steps || 0} 步` },
        { kind: 'hint', text: `　押到${st.to}的山门柜台，「交镖」结账。押镖路上不许「行路」。` },
      ] };
    }
    const list = E.listFor(w, p);
    if (!list.length) {
      return { lines: [{ kind: 'warn', text: '镖局的柜台在山门里 —— 飞虎镖局在长安，镇远镖局在洛阳。' }] };
    }
    const out = [{ kind: 'title', text: `【${list[0].from} · 镖单】` }];
    list.forEach((b, i) => {
      out.push({ kind: 'plain', text: `　${i + 1}. ${b.grade}（${b.fromCity} → ${b.toCity}）　镖银 ${b.pay} 文　路引 ${b.req}` });
      out.push({ kind: 'hint', text: `　　　${b.desc}` });
    });
    out.push({ kind: 'hint', text: '（「接镖 1 / 2 / 3」接一趟。押镖路上**不许行路** —— 走一趟才算数，路上有被劫的风险。）' });
    return { lines: out };
  });

  reg(['接镖', '领镖'], (ctx, args) => {
    const w = ctx.world, p = ctx.player;
    const E = require('./escort');
    const n = parseInt(String((args && args[0]) || '1'), 10) || 1;
    const r = E.accept(w, p, n);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const b = r.board;
    return { lines: [
      { kind: 'good', text: `你接下了「${b.grade}」：${b.fromCity} → ${b.toCity}，镖银 ${b.pay} 文。` },
      { kind: 'plain', text: `镖车出了${b.from}的山门。路上自己保重 —— 少一包货，就少一份钱。` },
    ] };
  });

  reg(['交镖', '交镖单', '结镖'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const E = require('./escort');
    const r = E.deliver(w, p);
    if (!r.ok) return { lines: [{ kind: 'warn', text: r.msg }] };
    const d = r.done;
    p.money = (p.money || 0) + d.pay;
    return { lines: [
      { kind: 'good', text: `镖交了。柜上点了数，把 ${d.pay} 文推过来。` },
      { kind: 'plain', text: `（${d.grade} · 镖物 ${d.intact}/${d.pot} · 走了 ${d.steps} 步 · 镖银 ${d.pay} 文。）` },
    ] };
  });

  /* ---------------- 清掉已完成的任务（主人 2026-10-11）----------------
     「已完成的支线任务能否在『任务』界面清掉？」—— 任务面板底部「已完成（N）」那一栏
     越积越长，翻起来碍事。这里给一个出口。
     ⚠️ **只清支线 / 委托，绝不动主线与新手**：主线记录是幕次推进的依据，
        后续幕次靠 `require.questDone` 认它 —— 删掉之后那段剧情永远接不上，
        而且**不报错**（就是「点了没反应」）。新手同理（教程进度读它）。 */
  reg(['清理已完成', '清掉已完成', '清空已完成', '清任务'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const gone = [];
    for (const qid of Object.keys(p.quests || {})) {
      if (p.quests[qid] < 99) continue;
      const qd = w.getQuest(qid) || {};
      if (qd.type === '主线' || qd.type === '新手') continue;
      gone.push(qd.name || qid);
      delete p.quests[qid];
    }
    return {
      lines: gone.length
        ? [{ kind: 'plain', text: `你把这几桩了结过的事从心里放下了（${gone.length} 桩）：${gone.join('、')}。` }]
        : [{ kind: 'plain', text: '没有可清的旧事。' }],
    };
  });

  /* ---------------- 官府盘查（design/67 §3）----------------
     被官差拦住时的两个出口。第三个「拒捕」不在这里 —— 那就是普通的「打」，
     复用既有战斗指令，不另造一条分支（同 B10 的思路：入口可以多，路径只能一条）。 */
  reg(['报名', '报上名号', '通名'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    return { lines: require('./patrol').report(w, p) };
  });

  reg(['打点', '使钱', '打点官差'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    return { lines: require('./patrol').bribe(w, p) };
  });

  /* ---------------- 正邪分野（design/67 §3）----------------
     官府路线的两头：**报信**（把听来的线报递给官差，得赏与朝廷声望）与
     **领差事**（官差派一桩缉捕的公事）。
     分野写在判据里：`outlaw` 那条线**官府不接他的话** —— 这不是惩罚，是这条线的定义。
     与巡逻同纪律：判据用显式 tag，恶名读 `p.kidnap.wanted`。 */
  reg(['报信', '递话', '线报'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    return { lines: require('./patrol').reportTip(w, p) };
  });

  reg(['领差事', '接差事', '领公事', '讨差事'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    return { lines: require('./patrol').assignTask(w, p) };
  });

  /* ---------------- 武学自创（2026-10-11 自拟）----------------
     把两门同槽、都下过苦功的功夫揉成一门新的。规矩写在 customskill.js 顶上。 */

  reg(['化用', '自创', '融会贯通', 'fuse'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const M = require('./customskill');
    const learned = Object.keys(p.learned || {});
    if (learned.length < 2) {
      return { lines: [{ kind: 'warn', text: '你手上的功夫还不够，谈什么化用。' }] };
    }
    if (!args.length) {
      const can = learned
        .map(id => w.getSkill(id))
        .filter(sd => sd && (p.learned[sd.id].level || 0) >= M.MIN_LEVEL)
        .map(sd => sd.name);
      return {
        lines: [
          { kind: 'sys', text: '把两门同槽的功夫化成一门新的：`化用 <功夫一> <功夫二> <新名字>`' },
          { kind: 'plain', text: can.length >= 2 ? `你手上够火候的有：${can.join('、')}` : `（眼下还没有两门都到 ${M.MIN_LEVEL} 级的功夫。）` },
          { kind: 'hint', text: `（两边各要 ${M.MIN_LEVEL} 级；一辈子最多创 ${M.MAX_CUSTOM} 门；失败会走火。）` },
        ],
      };
    }
    if (args.length < 3) return { lines: [{ kind: 'warn', text: '用法：化用 <功夫一> <功夫二> <新名字>' }] };
    const newName = args[args.length - 1];
    const a = fuzzyFind(learned.map(id => w.getSkill(id)).filter(Boolean), args[0], s => s.name);
    const b = fuzzyFind(learned.map(id => w.getSkill(id)).filter(Boolean), args[1], s => s.name);
    if (!a || !b) return { lines: [{ kind: 'warn', text: '没这两门功夫。' }] };
    const r = M.fuse(w, p, a.id, b.id, newName);
    return { lines: r.lines };
  });

  reg(['自创武学', '我的武学', 'customskills'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const list = require('./customskill').listOf(p);
    if (!list.length) return { lines: [{ kind: 'plain', text: '你还没自创过什么功夫。' }] };
    const lines = [{ kind: 'title', text: '【 你自己化出来的 】' }];
    for (const c of list) {
      const from = c.from.map(id => (w.getSkill(id) || {}).name || id).join(' + ');
      const lv = (p.learned[c.id] && p.learned[c.id].level) || 0;
      lines.push({ kind: 'plain', text: `${c.name}（${c.slot}·${lv} 级）　—— ${from} 化出` });
    }
    return { lines };
  });

  /* ---------------- 江湖的回应（2026-10-11 自拟） ---------------- */

  reg(['了断', '接这一场', 'settle'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: '你要跟谁了断？' }] };
    w.startCombat(p, npc);
    return {
      lines: [
        { kind: 'story', text: `你不再解释了。${npc.name}也把外袍脱了——两个人都明白这一场躲不过。` },
      ],
    };
  });

  reg(['赔罪', '赔个不是', 'apologize'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: '你要向谁赔罪？' }] };
    return { lines: require('./revenge').apologize(w, p, npc).lines };
  });

  reg(['不理', '走开', 'ignore_him'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    const name = npc ? npc.name : '他';
    return {
      lines: [
        { kind: 'plain', text: `你没接话，绕开走了。` },
        { kind: 'say', text: `${name}在你背后说了一句什么，你没听清，也没回头。` },
      ],
    };
  });

  reg(['leave', '脱离门派', '叛门'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你本就没有门派。' }] };
    const sd = w.getSect(p.sect);
    const r = p.leaveSect();
    p.karma -= 20;
    /* B22 埋点 7/14 · rs_sect_betray（叛门，恶名 −）：山门目击 → 邻房传开。 */
    if (typeof w.addRumor === 'function') {
      w.addRumor('rs_sect_betray', { room: p.room, about: sd ? sd.id : null, vars: { who: p.name, where: sd ? sd.name : '师门' } });
    }
    return { lines: [{ kind: 'sys', text: r.msg }, { kind: 'warn', text: `叛出${sd ? sd.name : '门派'}，你的名声受损了。` }] };
  });

  reg(['promote', '升职', '晋级'], (ctx) => {
    const r = ctx.player.promote();
    return { lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] };
  });

  reg(['contribute', '贡献', '捐献'], (ctx, args) => {
    const p = ctx.player;
    if (!p.sect) return { lines: [{ kind: 'warn', text: '你没有门派。' }] };
    const n = cnNum(args[0]) || 10;
    if (p.money < n) return { lines: [{ kind: 'warn', text: `你没有 ${n} 文钱。` }] };
    p.money -= n;
    p.sectContribution += Math.floor(n / 10);
    return { lines: [{ kind: 'sys', text: `你捐了 ${n} 文钱，门派贡献 +${Math.floor(n / 10)}（现 ${p.sectContribution}）。` }] };
  });

  /* ---------------- 自建宗门（武学重制 S2） ---------------- */
  reg(['创宗', '建宗', '开宗立派', 'createSect'], (ctx, args) => {
    return { lines: sectFounder.createSect(ctx.world, args.join(' ')).lines };
  });
  reg(['招贤', '纳贤', 'recruit'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.mySect) return { lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
    const kw = args.join(' ');
    if (!kw) return { lines: [{ kind: 'warn', text: '用法：招贤 <人名>　例如「招贤 李捕快」' }] };
    const npc = w.npcsIncludingTemplates(p.room).find(n => !n.isPlayer && (n.name === kw || n.name.includes(kw) || kw.includes(n.name)));
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${kw}」这号人物。` }] };
    return { lines: sectFounder.recruit(w, npc).lines };
  });
  reg(['逐出', '逐出宗门', 'expel'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!p.mySect) return { lines: [{ kind: 'warn', text: '你尚未创立宗门。' }] };
    const kw = args.join(' ');
    if (!kw) return { lines: [{ kind: 'warn', text: '用法：逐出 <人名>' }] };
    const npc = w.npcsIncludingTemplates(p.room).find(n => !n.isPlayer && (n.name === kw || n.name.includes(kw) || kw.includes(n.name)));
    if (!npc) return { lines: [{ kind: 'warn', text: `此处没有「${kw}」这号人物。` }] };
    return { lines: sectFounder.expel(w, npc).lines };
  });
  reg(['演武', 'drill'], (ctx) => ({ lines: sectFounder.drill(ctx.world).lines }));
  /* ⚠️ 「门派大比」这个别名留给**门派**（上面那条），宗门大比别抢：
     reg 后面的会覆盖前面的，抢了的话玩家打「门派大比」永远只能得到「你尚未创立宗门」。 */
  reg(['大比', '宗门大比', 'contest'], (ctx) => ({ lines: sectFounder.contest(ctx.world).lines }));
  reg(['解散宗门', '遣散', 'disband'], (ctx) => ({ lines: sectFounder.disband(ctx.world).lines }));

  /* ---------------- 家园地块 / 资助NPC建家（SPRINT2）---------------- */
  reg(['地块', '家园地块', 'plots'], (ctx) => ({ lines: estateMod.listPlots(ctx.world).lines }));
  reg(['开垦', '拓地', '开辟', 'plot'], (ctx, args) => {
    const r = estateMod.buildPlot(ctx.world, args.join(' '));
    return { lines: r.lines, moved: r.moved || null };
  });
  reg(['资助', '建家', 'sponsor'], (ctx, args) => {
    const a = args.slice();
    /* 支持「资助 范清 一间茅屋」：末段若是档位名则拆出来 */
    let tierKw = null;
    if (a.length > 1 && estateMod.NPC_TIERS.some(t => t.name === a[a.length - 1] || t.id === a[a.length - 1])) {
      tierKw = a.pop();
    }
    const r = estateMod.sponsorNpcHome(ctx.world, a.join(' '), tierKw);
    return { lines: r.lines, moved: r.moved || null };
  });

  reg(['quests', 'quest', '任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const lines = [{ kind: 'title', text: '【 任务 】' }];
    const active = Object.keys(p.quests).filter(q => p.quests[q] >= 0 && p.quests[q] < 99);
    if (!active.length) lines.push({ kind: 'plain', text: '你目前没有进行中的任务。' });
    for (const q of active) {
      const qd = w.getQuest(q);
      if (!qd) continue;
      const st = p.quests[q];
      const stage = qd.stages && qd.stages[st];
      lines.push({ kind: 'quest', text: `${qd.name}（${qd.level ? '推荐等级 ' + qd.level : '任务'}）`, quest: q });
      if (stage) lines.push({ kind: 'plain', text: `　${stage.desc || ''}` });
      if (stage && stage.targets) {
        for (const t of stage.targets) {
          const cur = Math.min(t.count || 1, p.getVar(t.var || `q_${q}_${t.id}`) || 0);
          lines.push({ kind: 'plain', text: `　· ${t.desc || t.id}　${cur}/${t.count || 1}` });
        }
      }
    }
    // 可接任务（本房间 NPC 身上的）—— def.quests + def.sidequest（B25 接线）
    const available = [];
    for (const n of w.npcsIncludingTemplates(p.room)) {
      if (!n.def) continue;
      const ids = [];
      if (Array.isArray(n.def.quests)) for (const q of n.def.quests) ids.push(q);
      if (n.def.sidequest) ids.push(n.def.sidequest);
      for (const q of ids) {
        const qd = w.getQuest(q);
        if (!qd) continue;                   // 挡悬空指针
        if (p.questStage(q) >= 0) continue;  // 已在进行 / 已完成
        if (qd.require && !evalCond(qd.require, ctx)) continue;  // 前置未满足 → 不算「可接」
        available.push({ q, npc: n });
      }
    }
    if (available.length) {
      lines.push({ kind: 'subtitle', text: '可接任务' });
      for (const a of available) {
        const qd = w.getQuest(a.q);
        lines.push({ kind: 'quest', text: `${qd ? qd.name : a.q}（找 ${a.npc.name}）`, quest: a.q });
      }
      lines.push({ kind: 'hint', text: '用「接取 <任务名>」接取。' });
    }
    return { lines };
  });

  /* ---- 任务追踪（主人 2026-10-08）----
     规则（原话）：
       ·「在『任务』里给任务添加追踪按钮，点击追踪按钮后上方大框内容切换成该追踪任务」
       ·「点击追踪后『追踪』按钮变成『取消追踪』」
       ·「点击取消追踪后，大框里的任务以及大框都消失，直到接取一个新任务或者主动追踪任务」
       ·「初始默认追踪新手剧情任务」
     ⇒ 状态只有 `p.track` 一个：null（不追）/ '__newbie__'（新手剧情）/ 'q_xxx'。
        指令这一层只负责改这个字段，**大框显示什么由 storybeat.currentStory 算**
        （面板按钮、敲指令、读档三条路进的是同一份数据）。
     ⚠️ 这两个词**不能**进前端的 PANEL_CMDS —— 进去就变成「开面板」而不是真追踪。 */
  /* 追踪 / 取消追踪 —— ★ 2026-10-12 主人：「把追踪与取消追踪合到一起吧」。
     合成**一条**：同一个动作点两次就是「追踪 → 取消」，不必记两个词。
       · `追踪 <任务>`  正追着这一条 → 取消；没追 → 追起来（**开关**）
       · `追踪`         手上正追着东西 → 取消它；两手空空 → 提示挑一个
       · `取消追踪`     强制取消（这个别名**保留**：老按钮、老习惯、别人写的 mod 还在发它）
     实现只有一份（下面的 `trackCmd`），两个入口的区别只是「要不要强制关」。
     这点很要紧：以前这是两段各写一遍的代码 —— 改坏一处不会报错，只会静默不生效。
     ⚠️ `追踪` / `取消追踪` **绝不能进前端 `PANEL_CMDS`**（进去就被拦成「开面板」）。 */
  const trackCmd = (ctx, args, force) => {
    const p = ctx.player, w = ctx.world;
    const sb = require('./storybeat');
    const nameOf = id => (id === sb.NEWBIE ? '新手剧情' : ((w.getQuest(id) || {}).name || id));
    /* 大框里那几行「接取时该讲的话」要到**玩家真去追它**时才讲（见 storybeat.hold）。
       🔴 2026-10-12 主人复现：「任务追踪是点击的，第一点出现提示，取消后再点就没有了，
          跟取消追踪绑定的吧」—— 根因：`takeHeld()` 是**一次性消费**（讲完就 `delete`
          那笔账），于是「追 → 取消 → 再追」时第二次什么也没有。
        ⇒ 改成「讲过一次就记成已讲」，**取消再追回来时重新讲一遍**：
          这本来就是玩家要的语义（他主动去看这条任务，就该看到它讲什么），
          而且与首次追踪的表现一致 —— 不该因为「取消过一次」就永久静音。
       ⚠️ 只对**接取旁白**（held）这么做；阶段推进那类「有了下文」由 reconcile 管，
          那边有自己的账（`_storyBeat.quests`），不受这里影响。 */
    const takeHeld = qid => {
      try { return sb.takeHeld(w, p, qid) || []; } catch (e) { return []; }
    };
    /* 这一条是「手动追上去」的通路（不是首次接取）—— 若那笔账已经讲掉了，补回来。
       判据只看 held 账，不碰 reconcile 的账。 */
    const reHeld = qid => {
      if (!qid) return [];
      try {
        if (sb.isHeld(p, qid)) return [];           /* 还扣着，交给 takeHeld 讲 */
        /* 已经讲过了 → 让它重新扣上，再走正常通路讲一遍 */
        sb.hold(p, qid);
        return sb.takeHeld(w, p, qid) || [];
      } catch (e) { return []; }
    };
    /* ① 强制关：`取消追踪` 走这条 */
    if (force) {
      if (!p.track) return { lines: [{ kind: 'warn', text: '本来就没在追。' }] };
      const was = nameOf(p.track);
      p.track = null;
      return { lines: [{ kind: 'sys', text: `不追「${was}」了。再点一次那条任务上的按钮就追回来。` }] };
    }
    /* ② 光敲两个字：当成开关用 */
    if (!args.length) {
      if (!p.track) return { lines: [{ kind: 'warn', text: '你想追踪哪一桩事？（「任务」里每条旁边都有按钮）' }] };
      const was = nameOf(p.track);
      p.track = null;
      return { lines: [{ kind: 'sys', text: `不追「${was}」了。再敲一次它的名字就追回来。` }] };
    }
    const key = args.join(' ');
    /* 🔴 2026-10-12 主人亲报：「为什么在『任务』里点追踪新手任务却说『没有这一桩事』」。
       根因：**面板按钮发的是任务 id，不是名字**。新手那条卡片没有真任务 id，
       前端写死成哨兵值 `__newbie__`（见 ui.js 的 trackBtn），
       而这里只列了「新手 / 新手教程 / 新手剧情」三个**手敲**的说法 ——
       于是从按钮点进来的那个 `__newbie__` 一路落到 `w.getQuest('__newbie__')`，
       查不到 → 一句「没有这一桩事」。
       ⚠️ 这个坑以前就存在（老代码同样只认那三个词），只是当时没人从按钮点过新手那条。
          守卫也没抓住它 —— 因为测试只断言「按钮发出去了什么」，
          没断言「后端真的照做了」。这次**两边都补上**（见 smoke-quest-track / smoke-uiux）。

       🔴 2026-10-12 再一次（主人复现「取消后再点就没提示了」）暴露第二个洞：
          **面板上印的是「入江湖」，玩家照着敲「追踪 入江湖」却查不到** ——
          因为新手那条的展示名（`storybeat.newbieChapter().arcName` = 「入江湖」）
          根本没进这张认词表。玩家看得到什么、就该能敲什么。
       ⇒ 认三路：手敲的中文（含面板上真印出来的「入江湖」）+ 前端下发的两个 id 形式。 */
    /* 🔴 2026-10-12 主人「新手教程剧情全删」。
       原先这里有一路 `__newbie__`（新手剧情任务的哨兵）：面板上那条置顶卡发它，
       玩家手敲「新手 / 新手教程 / 新手剧情 / 入江湖」也认。
       现在那条任务、那张卡、那个章次都没了 —— **整路摘掉**。
       ⚠️ 保留一句「翻篇」的提示：老存档里 `p.track === '__newbie__'` 的
          读档进来（`syncTrack` 会把它换成主线），万一有老前端还在发这个值，
          玩家该看到一句人话，而不是「没有这一桩事」那种错愕。 */
    if (key === '新手' || key === '新手教程' || key === '新手剧情'
      || key === '入江湖' || key === sb.NEWBIE) {
      if (p.track === sb.NEWBIE) p.track = null;
      return { lines: [{ kind: 'sys', text: '新手教程已经撤下了。要看主线，去「任务」里点「江湖路远」。' }] };
    }
    /* 面板按钮发的是**任务 id**（名字里有【主线】前缀、还可能重名），
       手敲的才是名字 —— 两条都认。 */
    const qd = w.getQuest(key) || fuzzyFind(Object.values(w.data.quests), key, q => q.name);
    if (!qd) return { lines: [{ kind: 'warn', text: '没有这一桩事。' }] };
    if (p.questStage(qd.id) < 0) return { lines: [{ kind: 'warn', text: '你手上没有这桩事。' }] };
    /* ③ 开关本体：正追着它，这一下就是「取消」 */
    if (p.track === qd.id) {
      p.track = null;
      return { lines: [{ kind: 'sys', text: `不追「${qd.name}」了。再点一次就追回来。` }] };
    }
    p.track = qd.id;
    /* ⚠️ `takeHeld` 是**消费型**（讲完就 delete 那笔账），所以只能调一次 ——
       写成 `takeHeld().length ? takeHeld() : reHeld()` 会把第一次的结果丢掉，
       剩下一句空话。先接住再判。 */
    let held = takeHeld(qd.id);
    if (!held.length) held = reHeld(qd.id);
    return {
      lines: [
        { kind: 'sys', text: `上方改追「${qd.name}」了。` },
        /* 开局由脚本直接塞进任务簿的那条（主线起手式），接取旁白一直扣着 ——
           玩家第一次追它，就在这时候讲出来。
           取消之后再追回来，**照样讲一遍**（`reHeld` 负责把已讲过的账补回来）——
           见函数开头那段注释。 */
        ...held,
      ],
    };
  };
  reg(['track', '追踪', '跟踪'], (ctx, args) => trackCmd(ctx, args, false));
  reg(['untrack', '取消追踪', '不追踪', '别追了'], (ctx, args) => trackCmd(ctx, args, true));

  reg(['accept', '接取', '接任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想接什么任务？' }] };
    const qd = fuzzyFind(Object.values(w.data.quests), args.join(' '), q => q.name);
    if (!qd) return { lines: [{ kind: 'warn', text: '没有这个任务。' }] };
    if (p.questStage(qd.id) >= 0) return { lines: [{ kind: 'warn', text: '你已经在进行这个任务了。' }] };
    if (qd.require) {
      /* ⚠️ 支持 `requireMsg`：像「先把凭据拿来」这种话比「你还不满足接取条件」有用得多 ——
         后者只告诉玩家「不行」，不告诉他「差什么」，是让人卡关的那种提示。 */
      if (!evalCond(qd.require, ctx)) {
        return { lines: [{ kind: 'warn', text: qd.requireMsg || '你还不满足接取条件。' }] };
      }
    }
    p.setQuestStage(qd.id, 0);
    /* 主人 2026-10-08：「点击取消追踪后，大框里的任务以及大框都消失，
       **直到接取一个新任务**或者主动追踪任务」。
       ⇒ 手上什么都没追的时候，新接的这桩自动追起来（大框立刻有内容）。
         正追着别的东西就不抢 —— 那是玩家自己挑的，别给他换掉。
       ⚠️ 规则挂在这里而不是 storybeat.reconcile：那边判「第一次见到」用的是
         `_storyBeat` 那本记忆账，开局/读档后它是空的，会把**手上的老任务**
         当成刚接的（实测：取消追踪后下一条指令又把主线追回来了）。 */
    if (!p.track) p.track = qd.id;
    /* ⚠️ 这里**不再**自己念 desc / 目标 —— 交给 `storybeat.reconcile`。
       为什么：任务的来历写的就是委托人的做派（「他缠着你去看看」），
       属于「人物的言行」，必须过**在场闸门**（人不在场就不该上屏，主人 2026-10-11 的要求）。
       两处都念还会一字不差地重一遍 —— 本模块接上之后实测就是两遍。
       一处ownership：剧情归 storybeat，指令只负责改状态。 */
    return { lines: [] };
  });

  reg(['abandon', '放弃', '放弃任务'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const qd = fuzzyFind(Object.values(w.data.quests), args.join(' '), q => q.name);
    if (!qd || p.questStage(qd.id) < 0) return { lines: [{ kind: 'warn', text: '你没有这个任务。' }] };
    if (qd.abandonable === false) return { lines: [{ kind: 'warn', text: '这个任务无法放弃。' }] };
    delete p.quests[qd.id];
    p.setQuestStage(qd.id, -1);
    /* B22：应下的事撂下，就是「失信」的传闻（rs_deadbeat 此前是死种子）。
       ⚠️ 主线与新手教程不在此列 —— 它们放弃不掉（上面 abandonable 已挡），
       而且「主线撂下」该走的是结局，不是街头闲话。 */
    if (qd.type !== '主线' && qd.type !== '新手' && typeof w.addRumor === 'function') {
      const room = w.getRoom(p.room) || {};
      w.addRumor('rs_deadbeat', { room: p.room, vars: { who: p.name || '有人', where: room.name || '此地' } });
    }
    return { lines: [{ kind: 'sys', text: `你放弃了任务「${qd.name}」。` }] };
  });

  reg(['report', '交任务', '交差'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const npcs = w.npcsIncludingTemplates(p.room);
    if (!npcs.length) return { lines: [{ kind: 'warn', text: '这里没有人可以交任务。' }] };
    const lines = [];
    for (const n of npcs) {
      const handled = tryReportQuest(ctx, n, lines);
      if (handled) break;
    }
    if (!lines.length) lines.push({ kind: 'warn', text: '这里没有人等待你的复命。' });
    return { lines };
  });

  /* ---------------- 地图 ---------------- */

  reg(['map', '地图', 'ditu'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    const region = room ? w.getRegion(room.region) : null;
    const lines = [{ kind: 'title', text: `【 ${region ? region.name : '所在区域'} 地图 】` }];
    const rooms = Object.values(w.data.rooms).filter(r => r.region === (room ? room.region : null));
    lines.push({ kind: 'map', room: p.room, rooms, region: room ? room.region : null });
    if (region && region.desc) lines.push({ kind: 'plain', text: region.desc });
    return { lines };
  });

  reg(['where', '定位', '我在哪'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    const region = room ? w.getRegion(room.region) : null;
    return { lines: [{ kind: 'sys', text: `你正在 ${region ? region.name + ' · ' : ''}${room ? room.name : '未知'}。` }] };
  });

  /* ---------------- 系统 ---------------- */

  reg(['clear', '清屏'], () => ({ lines: [], clear: true }));
  reg(['version', '版本'], (ctx) => ({ lines: [{ kind: 'plain', text: `武侠行 v${ctx.world.version}　已加载 ${ctx.world.mods.length} 个 Mod` }] }));
  reg(['mods', 'mod', 'mods列表'], () => ({ lines: [], openPanel: 'mods' }));
  reg(['save', '存档'], () => ({ lines: [], action: 'save' }));
  reg(['load', '读档'], () => ({ lines: [], action: 'load' }));
  reg(['settings', '设置'], () => ({ lines: [], openPanel: 'settings' }));
  /* 退出游戏：网页端由前端 doCmd() 优先本地拦截（弹确认框 → 自动存档 → 回主菜单），
     见 ui.js 的 isQuitCmd() / quitGame()。这里保留后端实现，是为了
     ① 让 help 的「系统」组列得出来；② 纯文本客户端 / mod 调到时给个体面的答复。 */
  reg(['quit', 'exit', '退出游戏', '退出', '离开游戏', '回主菜单'], () => ({
    lines: [{ kind: 'hint', text: '你收拢行囊，退出了江湖。' }],
    action: 'quit',
  }));

  /* 内部：由服务端 /api/panel 转发，直接开面板（不输出任何文字） */
  reg(['__panel__score', '__panel__状态'], (ctx) => ({ lines: [], openPanel: 'score', panelData: null }));
  reg(['__panel__attr'], (ctx) => ({ lines: [], openPanel: 'attr' }));
  reg(['__panel__skills'], (ctx) => ({ lines: [], openPanel: 'skills' }));
  reg(['__panel__inventory'], (ctx) => ({ lines: [], openPanel: 'inventory' }));
  reg(['__panel__equipment'], (ctx) => ({ lines: [], openPanel: 'equipment' }));
  reg(['__panel__affects'], (ctx) => ({ lines: [], openPanel: 'affects' }));
  reg(['__panel__map'], (ctx) => ({ lines: [], openPanel: 'map' }));
  reg(['__panel__quests'], (ctx) => ({ lines: [], openPanel: 'quests' }));
  reg(['__panel__sect'], (ctx) => ({ lines: [], openPanel: 'sect' }));
  reg(['__panel__help'], (ctx) => ({ lines: [], openPanel: 'help' }));
  /* 飞行面板（主人 2026-10-12）。有了这一条，走 `/api/panel`（而不是 `/api/view`）
     那条路进来也不会得到一句「我不懂这个指令」。 */
  reg(['__panel__fly'], (ctx) => ({ lines: [], openPanel: 'fly' }));
  /* 🔴 2026-10-12 主人「现在的楔子还不如原来的，还不如回滚回去」：
     楔子退回**一张静态卡片**（`view.intro`，按出身挑版，点一下进第一章），
     三轮角色扮演整套下线 —— 所以这条「开场 <key>」也不再驱动任何东西。
     ⚠️ **保留这条指令**（不删）只是为了让老前端/老存档手敲 `开场 xxx` 时
        得到一句人话，而不是「我不懂这个指令」。它已是个空壳，回一句就好。 */
  reg(['__opening__', '开场', '睁眼'], () => ({
    lines: [{ kind: 'sys', text: '开场已过。你的出身与性别在建号时便定了，往后走就是。' }],
  }));
  reg(['__panel__save', '__panel__load'], (ctx, args) => ({ lines: [], openPanel: 'save', action: 'save' }));
  reg(['rebirth', '重开', '重新开始'], () => ({ lines: [], action: 'rebirth' }));
  reg(['sleep', '睡', '休息'], (ctx) => {
    const p = ctx.player;
    p.advanceTime(480);
    p.hp = p.maxHp; p.mp = p.maxMp;
    p.food = clamp(p.food - 30, 0, p.maxFood);
    return { lines: [{ kind: 'story', text: '你就地歇息了一夜。' }, { kind: 'sys', text: '你精神恢复了不少。' }] };
  });
  /* ⚠️ 首个别名是**规范名**（`CMD[x].names[0]`，新手引导靠它反查「这条指令属于哪一步」）。
     这里原先是 `' meditate'`（**带一个前导空格**）——那是笔误：
     玩家输入永远会被 trim，所以带空格的别名不可达；而规范名跟着带空格，
     会让任何「按规范名做映射」的代码都对不上（实测：引导的 did_train 就漏了英文 meditate 按钮）。 */
  reg(['meditate', '打坐', '练气'], (ctx) => {
    const p = ctx.player;
    const neigong = p.equippedSkills && p.equippedSkills['内功'];
    const gain = 5 + Math.floor(p.attrTotal('悟性') / 2);
    const lines = [{ kind: 'story', text: '你盘膝而坐，闭目凝神，调匀呼吸。' }];

    if (p.mp >= p.maxMp) {
      p.advanceTime(10);
      lines.push({ kind: 'sys', text: '你内力已然充盈，再坐也是徒然，起身罢。' });
      return { lines };
    }

    /* 内力是有限的，打坐只是慢慢养回来 —— 主人报「打坐瞬间恢复全部内力」
       太离谱。回复 = maxMp 的 8%~25%，随内功/资质/悟性；饿着更慢。
       想回满得静坐七八回，不是一键满蓝（有那个便利的是丹药和客栈）。 */
    const deep = p.attrTotal('内力') + p.attrTotal('悟性') + (neigong ? p.attrTotal('资质') * 2 : 0);
    let pct = clamp(0.08 + deep * 0.004, 0.06, 0.25);
    if (typeof p.food === 'number' && p.food < 20) pct *= 0.5;
    const rest = Math.max(1, Math.floor(p.maxMp * pct));
    p.mp = clamp(p.mp + rest, 0, p.maxMp);
    p.advanceTime(20);
    lines.push({
      kind: 'sys',
      text: `你吐纳周天，气息渐充，内力恢复${rest}点（${p.mp}/${p.maxMp}）。` +
        (p.mp >= p.maxMp ? '内息已复。' : '尚需静坐养气。'),
    });

    if (neigong && p.learned[neigong]) {
      p.gainSkillExp(neigong, gain);
      const sd = ctx.world.getSkill(neigong);
      lines.push({ kind: 'sys', text: `你运转${sd ? sd.name : '内功'}心法，气行经脉，修为略有精进。` });
      // 内功修炼：打坐冲击奇经八脉
      const m = p.tryAssaultMeridian(sd);
      if (m) lines.push({ kind: 'sys', text: m });
    } else {
      lines.push({ kind: 'sys', text: '你尚未修习内功，只能做些粗浅的养气功夫，长进有限。' });
    }
    return { lines };
  });

  /* ---------------- 飞往（已下线 · 2026-10-14 主人改判） ----------------
     design/89 §七·补 裁 1：飞行**全删空投语义，不降级保留**——只要还有一条
     绕开路网的快速通道，卷界锁就多一个要堵的口子。flight.js 已物理删除（零调用，见头注释），
     （canFlyTo 不再接任何玩家入口），这里把玩家的「飞往」改写成一句**世界内的
     回话** + 指路（89 §七·d 铁律 3：被挡的玩家永远知道该走哪条路），
     不做静默失效，也不留「飞不了」的系统报错腔。 */
  reg(['飞往', '传送', '去往', '赶往', 'feiwang'], () => {
    return { lines: [
      { kind: 'story', text: '你纵身一跃，落地时自己都觉得没意思——江湖上哪有一跃千里的轻功？' },
      { kind: 'story', text: '出远门得走驿站渡口：脚下顺着官道一步步走，跨州过府就到驿丞船家那里问「行路」。' },
      { kind: 'hint', text: '（行路走驿站渡口网络：快捷栏「行路」或直接敲「行路」。）' },
    ] };
  });

  /* ---------------- 行路（驿站渡口网络 · design/89 §七·补 裁 2/3） ----------------
     区域间的每一次移动都必须经过一个有人、有台词、有生意的节点。
     数据在 `world.data.travel.links`（schema 见 travel.js 头注释，数据侧游有方供数）：
       · walk  步行直达，免费走；
       · cross 跨区门槛三形态（渡资 / 路引 / 船家交情）统一归一成 cond，
         被挡时念**站在门前的人的说法**（sectRefusal 范式，不出系统提示条）。 */
  reg(['行路', '赶路', 'travel'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    /* 押镖期间锁行路（原「押镖不许飞往」语义平移过来）：镖在肩上，一步一步走才算押镖 */
    if (require('./escort').flyingBlocked(p)) {
      return { lines: [{ kind: 'story', text: '镖在肩上，飞不得——押镖就得一步一步走，绕路也是押镖的一部分。' }] };
    }
    const here = (w.getRoom(p.room) || {}).region;
    const links = travel.linksFrom(w, here);
    if (!links.length) {
      return { lines: [{ kind: 'hint', text: '此处没有通航的驿站渡口。出远门先走到官道沿线的驿站，再问「行路」。' }] };
    }
    const kw = (args || []).join('').trim();
    const describe = (l) => {
      const tgt = w.data.regions[l.to] || { name: l.to };
      const chk = travel.checkLink(w, p, l);
      const gate = l.kind === 'cross' ? (l.gateText || l.cond || '需过门槛') : '步行直达';
      return `${tgt.name}（${gate}${l.cost ? '，渡资 ' + l.cost + ' 文' : ''}）—— ${chk.state === 'closed' ? '暂不通' : '可走'}`;
    };
    if (!kw) {
      const lines = [{ kind: 'sys', text: '从这里出远门，能走的路有：' }];
      links.forEach(l => lines.push({ kind: 'story', text: '　' + describe(l) }));
      lines.push({ kind: 'hint', text: '（敲「行路 <地名>」动身。不通的路，驿站的人会告诉你差什么。）' });
      return { lines };
    }
    const link = links.find(l => {
      const r = w.data.regions[l.to] || {};
      return r.name === kw || l.to === kw || (r.name || '').includes(kw) || kw.includes(r.name || '');
    });
    if (!link) return { lines: [{ kind: 'warn', text: `从这儿没有直通「${kw}」的驿路。能走的是：` + links.map(l => (w.data.regions[l.to] || {}).name || l.to).join('、') + '。' }] };
    const chk = travel.checkLink(w, p, link);
    const tgtRegion = w.data.regions[link.to] || {};
    const entryId = tgtRegion.entry
      || (Object.values(w.data.rooms).find(x => x.region === link.to) || {}).id;
    if (!chk.ok) {
      /* 铁律 1/3：说法由站在门前的人说出来，且带指路（文案数据侧写，含说话人）。 */
      return { lines: [{ kind: 'story', text: chk.reason }] };
    }
    if (!entryId) return { lines: [{ kind: 'warn', text: '那段驿路还没修到头（目标区域没有入口）。' }] };
    const paid = travel.payIfAny(p, link);
    p.advanceTime(link.kind === 'cross' ? 60 : 30);
    const r = w.movePlayerTo(p, entryId);
    if (!r || !r.ok) return { lines: [{ kind: 'warn', text: '那段路眼下走不通。' }] };
    const lines = [];
    if (chk.state === 'ready' && link.say) lines.push({ kind: 'story', text: link.say });
    lines.push({
      kind: 'story',
      text: (link.kind === 'cross' ? `你上了路，车马劳顿，一路换了两次船，终于望见了${tgtRegion.name}的地界。`
        : `你顺着官道步行，脚下不停，${tgtRegion.name}就近在眼前了。`)
        + (paid ? `（渡资 ${paid} 文）` : ''),
    });
    lines.push({ kind: 'sys', text: '你来到了' + (w.getRoom(entryId) || {}).name + '。' });
    return { lines };
  });


  /* ---------------- 运功疗伤 ----------------
     主人报「快捷键『运功疗伤』用不了」——根因：快捷栏里写了 cmd:'heal'，
     但后端从来没注册过 heal 指令（只有 meditate/打坐），点下去就是「未知指令」。
     主人追加要求：**疗伤消耗内力** —— 内力是燃料，拿内力换气血。
     没内力就寸步难行；反复掏空丹田硬撑会积「暗伤」，三次减气血上限。
     最优解仍是客栈睡一晚 / 丹药 / 静养，这里只给赶路的人应急用。 */
  reg(['heal', '疗伤', '运功疗伤', '养伤', '行气疗伤'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    if (p.hp >= p.maxHp) {
      return { lines: [{ kind: 'sys', text: '你身上没有伤，气血完足，不必运功。' }] };
    }
    const hurt = p.maxHp - p.hp;

    /* 内力是燃料 —— 主人要求：疗伤消耗内力。耗 maxMp 的 18%（无内功的凡人
       拿不出手，30%），把内力逼出来推动气血修复。无内力则寸步难行。 */
    const hasNei = !!(p.equippedSkills && p.equippedSkills['内功']);
    const fullCost = Math.max(1, Math.floor(p.maxMp * (hasNei ? 0.18 : 0.30)));
    if (p.mp <= 0) {
      p.advanceTime(10);
      return {
        lines: [{
          kind: 'warn',
          text: '你丹田空空，一丝内力也提不起来，疗什么伤。先打坐养气，或服一枚丹药。',
        }],
      };
    }
    const cost = Math.min(fullCost, p.mp);
    p.mp = Math.max(0, p.mp - cost);

    /* 回血 = 投入的内力换来的。系数 1.4 上下：满内力（maxMp≈46）一次约
       治六成伤；内功深厚/资质高更划算。饿着打折。 */
    const deep = p.attrTotal('内力') + p.attrTotal('悟性') * 2;
    let rate = clamp(1.4 + deep * 0.012, 1.0, 2.6);
    if (typeof p.food === 'number' && p.food < 20) rate *= 0.6;
    /* 内力不够满额的那一回，疗效按投入比例缩水（不能白嫖） */
    const ratio = cost / fullCost;
    let heal = Math.max(1, Math.floor(cost * rate * ratio));
    heal = Math.min(heal, hurt);
    p.hp = clamp(p.hp + heal, 0, p.maxHp);
    p.advanceTime(15);

    const lines = [{ kind: 'story', text: '你解下兵刃，就地闭目，气息缓缓推动气血行于伤处。' }];
    lines.push({
      kind: 'sys',
      text: `你耗去内力${cost}点，换回气血${heal}点（气血 ${p.hp}/${p.maxHp}，内力 ${p.mp}/${p.maxMp}）。` +
        (p.hp >= p.maxHp ? '伤已痊愈。' : '余伤未消，丹田也已见底。'),
    });

    /* 内力见底还硬撑 → 暗伤累积，三次减气血上限 */
    if (p.mp <= 0) {
      p.scar = (p.scar || 0) + 1;
      if (p.scar >= 3) {
        p.scar = 0;
        p.maxHp = Math.max(10, p.maxHp - 3);
        if (p.hp > p.maxHp) p.hp = p.maxHp;
        lines.push({ kind: 'warn', text: '三次内力见空仍强行运功，旧伤暗积，气血上限略减。好好歇几日罢。' });
      }
    }
    try { w.fireEvent('onHeal', { player: p, heal, cost }); } catch (e) { }
    return { lines };
  });

  /* ---------------- 求医（任务一：医者的互动项，要点得动、有反馈） ----------------
     医者（tag=doctor，11 人）点击菜单给「求医」。诊金按伤势算，无伤时明确回绝；
     银钱不够也明说 —— 绝不出现「点了没反应」。 */
  reg(['求医', '看病', '问诊', '诊病'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const here = w.npcsIncludingTemplates(p.room).filter(n => (n.def || {}).tag === 'doctor');
    if (!here.length) return { lines: [{ kind: 'warn', text: '这里没有会看病的人。' }] };
    let med = here[0];
    if (args.length) { const t = fuzzyFind(here, args.join(' '), n => n.name); if (t) med = t; }
    const hpMiss = Math.max(0, p.maxHp - p.hp);
    const mpMiss = Math.max(0, p.maxMp - p.mp);
    if (hpMiss <= 0 && mpMiss <= 0) {
      return { lines: [{ kind: 'say', text: `${med.name}抬眼看了看你：「气色不差，不必吃我的药。」` }] };
    }
    const fee = Math.max(5, Math.round(hpMiss * 0.4 + mpMiss * 0.2));
    if ((p.money || 0) < fee) {
      return { lines: [
        { kind: 'say', text: `${med.name}道：「诊金 ${fee} 文，你拿得出么？」` },
        { kind: 'hint', text: `（你只有 ${p.money || 0} 文。先去筹钱，或另寻郎中。）` },
      ] };
    }
    p.money -= fee;
    p.hp = p.maxHp;
    p.mp = clamp(p.mp + Math.round(p.maxMp * 0.6), 0, p.maxMp);
    return { lines: [
      { kind: 'say', text: `${med.name}让你坐下，搭上脉，又取了些药末调开。` },
      { kind: 'sys', text: `你付了 ${fee} 文诊金，伤痛大减（气血 ${p.hp}/${p.maxHp}）。` },
    ] };
  });

  /* ---------------- 问路（任务一：镖师 / 车夫 / 船夫的互动项） ----------------
     按当前房间出口做 BFS，找同 region 最近的一处「有字号的地方」（客栈/市集/衙门/渡口…），
     报出方向与步数。是真计算出来的路，不是套话。 */
  reg(['问路', '打听路', '找路', '带路'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const here = w.npcsIncludingTemplates(p.room).filter(n => ['escort', 'groom', 'boatman'].indexOf((n.def || {}).tag) >= 0);
    if (!here.length) return { lines: [{ kind: 'warn', text: '这里没有识路的人。' }] };
    let g = here[0];
    if (args.length) { const t = fuzzyFind(here, args.join(' '), n => n.name); if (t) g = t; }
    const room = w.getRoom(p.room);
    if (!room) return { lines: [{ kind: 'warn', text: '你连自己在哪儿都不知道。' }] };
    const NOTABLE = /客栈|酒|茶|市|集|铺|衙|渡|码头|城门|镖局|寺|观|宫/;
    // BFS：找同 region 里最近的一处「有字号的地方」
    const seen = { [p.room]: null };   // roomId -> 从起点走的第一步方向
    const q = [p.room];
    let target = null;
    while (q.length && !target) {
      const cur = q.shift();
      const cr = w.getRoom(cur);
      if (!cr) continue;
      for (const d of Object.keys(cr.exits || {})) {
        const ex = cr.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        if (!tid || seen[tid] !== undefined || !w.data.rooms[tid]) continue;
        seen[tid] = seen[cur] || d;     // 第一步方向
        const tr = w.data.rooms[tid];
        if (tr.region === room.region && tr.id !== p.room && NOTABLE.test(tr.name || '')) { target = tr; break; }
        q.push(tid);
      }
    }
    if (!target) {
      return { lines: [{ kind: 'say', text: `${g.name}想了想，摇头道：「这附近，倒也没什么好去处。」` }] };
    }
    /* 步数 = BFS 深度（重新算一遍最短步） */
    const dist = {}; dist[p.room] = 0;
    const q2 = [p.room];
    while (q2.length) {
      const cur = q2.shift();
      if (cur === target.id) break;
      const cr = w.getRoom(cur);
      for (const d of Object.keys((cr && cr.exits) || {})) {
        const ex = cr.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        if (!tid || dist[tid] !== undefined || !w.data.rooms[tid]) continue;
        dist[tid] = dist[cur] + 1;
        q2.push(tid);
      }
    }
    const steps = dist[target.id];
    const dirCN = DIR_CN[seen[target.id]] || seen[target.id];
    return { lines: [
      { kind: 'say', text: `${g.name}抬手往${dirCN}边一指：「往${dirCN}去，过了${steps}道门就是${target.name}。」` },
      { kind: 'hint', text: `（${target.name}：往${dirCN}，约 ${steps} 步。）` },
    ] };
  });

  /* ---------------- 搜身（任务一：倒地者的互动项） ----------------
     对象是 **打倒/晕倒** 的人（knockedOut）——用 downedIn，不用 npcsIn（铁律 32）。
     拿走他身上的钱与物，每人只可搜一次。 */
  reg(['搜身', '搜刮', 'loot', 'searchbody'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const downed = w.downedIn(p.room);
    if (!downed.length) return { lines: [{ kind: 'warn', text: '这里没有倒下的人可搜。' }] };
    const kw = args.join(' ').trim();
    let tgt = downed[0];
    if (kw) {
      const t = downed.find(n => (n.name || '').includes(kw)) || fuzzyFind(downed, kw, n => n.name);
      if (!t) return { lines: [{ kind: 'warn', text: `这没有叫「${kw}」的倒地者。` }, { kind: 'hint', text: '可搜的：' + downed.map(n => n.name).join('、') }] };
      tgt = t;
    }
    if (tgt._searched) return { lines: [{ kind: 'plain', text: `${tgt.name}身上已经被你翻过了。` }] };
    const taken = [];
    const carry = tgt.carry || (tgt.def && tgt.def.carry) || null;
    if (carry) {
      if (carry.money) { p.money = (p.money || 0) + carry.money; taken.push(carry.money + ' 文'); carry.money = 0; }
      const items = [].concat(carry.items || []);
      for (const it of items) {
        const iid = typeof it === 'string' ? it : (it && (it.id || it.itemId));
        if (!iid || !w.getItem(iid)) continue;
        const cnt = (typeof it === 'object' && it.count) || 1;
        w.giveItem(p, iid, cnt);
        taken.push(((w.getItem(iid) || {}).name || iid) + (cnt > 1 ? ' x' + cnt : ''));
      }
      if (carry.items) carry.items = [];
    }
    tgt._searched = true;
    if (!taken.length) return { lines: [{ kind: 'plain', text: `你在${tgt.name}身上翻了翻，什么也没有。` }] };
    return { lines: [{ kind: 'sys', text: `你从${tgt.name}身上搜出了：${taken.join('、')}。` }] };
  });

  /* ---------------- 外功淬体（淬炼肉身，需血量与药物，有生命危险） ---------------- */
  reg(['淬体', 'cuti', '淬炼', '炼体'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    let sd = null;
    if (args.length) {
      sd = fuzzyFind(Object.values(w.data.skills), args.join(' '), s => s.name);
    } else {
      const ids = Object.keys(p.learned).filter(id => { const d = w.getSkill(id); return d && d.type !== '内功'; });
      if (ids.length) sd = w.getSkill(ids[0]);
    }
    if (!sd) return { lines: [{ kind: 'warn', text: '你还没有可淬炼的外功武学（先去学一门拳脚刀剑）。' }] };
    if (sd.type === '内功') return { lines: [{ kind: 'warn', text: '内功靠打坐冲击奇经八脉，无需淬体。' }] };
    const cur = p.learned[sd.id];
    const lv = cur ? cur.level : 0;
    const apt = p.attrTotal('资质');
    // 越往后越难练；家园练武场会降低难度、提高成功率
    const _eff = (w && typeof w.estateEffects === 'function') ? w.estateEffects() : null;
    const successRate = clamp(0.75 + apt * 0.004 - lv * 0.004 + (_eff ? _eff.cutiRate : 0), 0.1, 0.98);
    const riskRate = clamp(0.05 + lv * 0.012, 0.05, 0.7);
    // 药物支撑：背包有疗伤丹药则大幅降低风险并消耗一枚
    const healItem = (p.inventory || []).map(it => w.getItem(typeof it === 'object' ? it.id : it)).find(it => it && it.healHp);
    let usedMed = null;
    if (healItem) { p.removeItem(healItem.id, 1); usedMed = healItem.name; }
    const effRisk = usedMed ? riskRate * 0.3 : riskRate;
    // 消耗体力与部分气血
    const hpCost = Math.floor(p.maxHp * (0.08 + lv * 0.004));
    p.hp = clamp(p.hp - hpCost, 1, p.maxHp);
    p.stamina = clamp(p.stamina - 25, 0, p.maxStamina);
    p.advanceTime(30);
    const lines = [{ kind: 'story', text: `你运起${sd.name}心法，捶打筋骨，淬炼肉身……` }];
    if (usedMed) lines.push({ kind: 'sys', text: `你服下${usedMed}以防不测。` });
    if (p.world.rng.next() < successRate) {
      const gain = Math.floor(p.skillExpNeed(lv) * 0.4);
      const g = p.gainSkillExp(sd.id, gain);
      lines.push({ kind: 'sys', text: g.msg + '（淬体有成）' });
    } else {
      lines.push({ kind: 'warn', text: '淬体未能精进，仅觉筋骨酸胀。' });
    }
    // 生命危险判定（无药物则更凶险）
    if (p.world.rng.next() < effRisk) {
      const dmg = Math.floor(p.maxHp * (usedMed ? 0.15 : 0.35));
      p.hp = clamp(p.hp - dmg, 0, p.maxHp);
      if (p.hp <= 0) {
        p.hp = 1;
        lines.push({ kind: 'warn', text: '淬体失当，气血逆行，险些丧命！（被人救起，仅余一息）' });
      } else {
        lines.push({ kind: 'warn', text: '淬体失当，气血乱窜，撑不住了！' });
      }
    }
    return { lines };
  });

  /* ---------------- 炼丹 / 炼器 / 符文阵法（SPRINT2-B） ---------------- */

  const CRAFT_CAT = {
    alchemy: { label: '丹药', verb: '炼丹' },
    forge: { label: '兵刃防具', verb: '炼器' },
    rune: { label: '符箓', verb: '画符' },
  };

  function doCraft(ctx, category, recipeKw) {
    const p = ctx.player, w = ctx.world;
    const cat = CRAFT_CAT[category] || { label: '物品', verb: '炼制' };
    const recipes = Object.values(w.data.recipes || {}).filter(r => r.category === category);
    if (!recipeKw) {
      const names = recipes.map(r => r.name).join('、');
      return { lines: [{ kind: 'sys', text: `可${cat.verb}的${cat.label}：${names || '（暂无）'}` }] };
    }
    const rec = fuzzyFind(recipes, recipeKw, r => r.name);
    if (!rec) return { lines: [{ kind: 'warn', text: `没有名为「${recipeKw}」的${cat.label}配方。` }] };
    // 器具
    if (rec.needTool && !p.hasItem(rec.needTool)) {
      const td = w.getItem(rec.needTool);
      return { lines: [{ kind: 'warn', text: `${cat.verb}需要「${td ? td.name : rec.needTool}」。` }] };
    }
    // 材料
    const miss = [];
    for (const mid in rec.mat) {
      const need = rec.mat[mid];
      if (p.countItem(mid) < need) miss.push(`${(w.getItem(mid) || { name: mid }).name}(${p.countItem(mid)}/${need})`);
    }
    if (miss.length) return { lines: [{ kind: 'warn', text: `材料不足：${miss.join('、')}` }] };
    // 消耗材料
    for (const mid in rec.mat) p.removeItem(mid, rec.mat[mid]);
    // 成功率（悟性/资质越高越稳）
    const wis = p.attrTotal('悟性'), apt = p.attrTotal('资质');
    const _eff = (w && typeof w.estateEffects === 'function') ? w.estateEffects() : null;
    const rate = clamp((rec.base || 0.8) + wis * 0.004 + apt * 0.003 + (_eff ? _eff.craftRate : 0), 0.1, 0.98);
    p.stamina = clamp(p.stamina - 15, 0, p.maxStamina);
    p.advanceTime(rec.time || 20);
    const lines = [{ kind: 'story', text: `你着手${cat.verb}「${rec.name}」……` }];
    if (p.world.rng.next() < rate) {
      w.giveItem(p, rec.out, rec.outCount || 1);
      lines.push({ kind: 'sys', text: `炼制成功！获得 ${rec.outCount || 1} 个${w.getItem(rec.out).name}。` });
    } else {
      lines.push({ kind: 'warn', text: '炼制失败，材料尽毁，只余一缕焦烟。' });
    }
    return { lines };
  }

  reg(['炼丹', 'alchemy', 'liandan'], (ctx, args) => doCraft(ctx, 'alchemy', args.join(' ')));
  reg(['炼器', 'forge', 'lianqi'], (ctx, args) => doCraft(ctx, 'forge', args.join(' ')));
  reg(['画符', '制符', '布阵', '符箓', 'rune', 'lianfu'], (ctx, args) => doCraft(ctx, 'rune', args.join(' ')));

  /* ---------------- 匪类拦截（主人 2026-10-08）----------------
     匪类逃窜时正好从你身边擦过去，屏幕上会弹出「拦不拦」。
     拦了：你 + 追来的那位 + 附近同样够胆的人一起上（结算式，见 outlaw.doIntercept）。 */

  reg(['拦截', '拦住', 'intercept'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const outlaw = require('./outlaw');
    const kw = args.join(' ');
    const pool = w.npcsIncludingTemplates(p.room).filter(n => n.isNpc && !n.dead);
    let foe = kw ? fuzzyFind(pool, kw, n => n.name) : null;
    if (!foe) foe = pool.find(outlaw.isOutlaw);
    if (!foe) return { lines: [{ kind: 'warn', text: '眼前没有要拦的人。' }] };
    if (!outlaw.isOutlaw(foe)) return { lines: [{ kind: 'warn', text: `${foe.name}不是匪类，拦他做什么。` }] };
    const r = outlaw.doIntercept(w, p, foe);
    return { lines: r.lines };
  });

  reg(['让开', '放他走', 'letgo'], (ctx) => {
    const p = ctx.player, w = ctx.world;
    const foe = w.npcsIncludingTemplates(p.room).find(n => require('./outlaw').isOutlaw(n));
    const name = foe ? foe.name : '那人';
    return {
      lines: [
        { kind: 'plain', text: `你侧了侧身。${name}从你手边擦过去，脚步没慢。` },
        { kind: 'story', text: `巷子口的风把他衣角掀起来一下，又落回去。你听着脚步声一直远到听不见。` },
      ],
    };
  });

  /* ---------------- 练武学（主人 2026-10-10：快捷键面板，点了自动耗内力练） ---------------- */

  reg(['练武学', 'lianwuxue', 'practice'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    const practiceMod = require('./practice');
    const list = practiceMod.listFor(w, p);
    if (!list.length) return { lines: [{ kind: 'warn', text: '你手上一门功夫都没有，拿什么练？先去拜个师父。' }] };
    if (!args.length) {
      /* 不带名字 = 打开面板（前端把 `练武学` 接进 PANEL_CMDS 指向 practice）。
         这里也备一份文字清单，供不支持面板的场合（命令行 / 测试）用。 */
      const lines = [{ kind: 'sys', text: '你想练哪一门？（点下方的武学按钮，或「练武学 <武学名>」）' }];
      lines.push({
        kind: 'plain',
        text: list.map(x => `${x.name}${x.full ? '〔已至上限〕' : `〔${x.level}/${x.cap}〕`}`).join('　'),
      });
      return { lines, panel: 'practice' };
    }
    const kw = args.join(' ');
    const hit = list.find(x => x.name === kw) || fuzzyFind(list, kw, x => x.name);
    if (!hit) return { lines: [{ kind: 'warn', text: `你没学过「${kw}」。` }] };
    const r = practiceMod.practice(w, p, hit.id);
    return { lines: r.lines };
  });

  /* ---------------- 收徒系统（SPRINT2 任务70） ---------------- */

  reg(['收徒', 'shoutu', '收弟子'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想收谁为徒？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    if (!npc.isNpc) return { lines: [{ kind: 'warn', text: '那可不是能收的徒儿。' }] };
    if (npc.def && npc.def.hostile) return { lines: [{ kind: 'warn', text: '对方杀机毕露，岂能收为弟子。' }] };
    p.disciples = p.disciples || [];
    if (p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}已是你的弟子。` }] };
    if (p.disciples.length >= 10) return { lines: [{ kind: 'warn', text: '你门下弟子已满（上限十人）。' }] };
    if (!Object.keys(p.learned || {}).length) return { lines: [{ kind: 'warn', text: '你自身尚无一技之长，如何为人师？' }] };
    p.disciples.push(npc.id);
    if (!npc.pstate) npc.pstate = {};
    npc.pstate.master = p.id;
    npc.master = p.id;
    const { addFavor } = require('./social');
    addFavor(w, npc, 30 * w.favorGainMult(p), '拜师');
    /* B22：收徒要出传闻（rs_take_disciple 此前是死种子）。
       收徒是「能传出去的事」—— 摆几桌、有人看见，才有人在茶桌上说。 */
    if (typeof w.addRumor === 'function') {
      const room = w.getRoom(p.room) || {};
      w.addRumor('rs_take_disciple', { room: p.room, about: (npc.def && npc.def.id) || npc.defId || null, vars: { who: p.name || '有人', where: room.name || '此地', whom: npc.name } });
    }
    return { lines: [{ kind: 'sys', text: `${npc.name}向你磕头行礼，正式拜入你门下！` }] };
  });

  reg(['逐出师门', '弃徒', 'expel'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (!args.length) return { lines: [{ kind: 'warn', text: '你想逐出哪个弟子？' }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), args.join(' '), n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${args.join(' ')}」。` }] };
    p.disciples = p.disciples || [];
    if (!p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}并非你的弟子。` }] };
    p.disciples = p.disciples.filter(id => id !== npc.id);
    if (npc.pstate) npc.pstate.master = null;
    npc.master = null;
    return { lines: [{ kind: 'sys', text: `你已将${npc.name}逐出师门。` }] };
  });

  reg(['弟子', '徒弟', 'disciples'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    p.disciples = p.disciples || [];
    if (!p.disciples.length) return { lines: [{ kind: 'sys', text: '你门下尚无弟子。' }] };
    const names = p.disciples.map(id => { const n = w.getNpc(id); return n ? n.name : id; });
    return { lines: [{ kind: 'sys', text: '门下弟子：' + names.join('、') }] };
  });

  reg(['授艺', '传艺', 'teach', 'shouyi'], (ctx, args) => {
    const p = ctx.player, w = ctx.world;
    if (args.length < 2) return { lines: [{ kind: 'warn', text: '用法：授艺 <武学> <弟子>' }] };
    const skillKw = args.slice(0, -1).join(' ');
    const disKw = args[args.length - 1];
    const sid = Object.keys(p.learned || {}).find(id => { const d = w.getSkill(id); return d && (d.name === skillKw || d.name.indexOf(skillKw) >= 0); });
    if (!sid) return { lines: [{ kind: 'warn', text: `你并未习得「${skillKw}」，无从传授。` }] };
    const npc = fuzzyFind(w.npcsIncludingTemplates(p.room), disKw, n => n.name);
    if (!npc) return { lines: [{ kind: 'warn', text: `这里没有「${disKw}」。` }] };
    p.disciples = p.disciples || [];
    if (!p.disciples.includes(npc.id)) return { lines: [{ kind: 'warn', text: `${npc.name}并非你的弟子。` }] };
    const pLevel = (p.learned[sid] || {}).level || 1;
    const give = Math.max(1, Math.floor(pLevel * 0.6));
    npc.learned = npc.learned || {};
    const cur = npc.learned[sid] || { exp: 0, level: 0 };
    cur.level = Math.max(cur.level, give);
    npc.learned[sid] = cur;
    if (npc.recalc) npc.recalc();
    return { lines: [{ kind: 'sys', text: `你将${w.getSkill(sid).name}传授给${npc.name}（至 ${give} 级）。` }] };
  });

  /* ---------------- 扩展：房间自定义指令 ---------------- */

  const roomCmd = (ctx, cmd, args) => {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const rc = (room.commands || {})[cmd];
    if (rc) {
      if (rc.cond && !evalCond(rc.cond, ctx)) return rc.failMsg ? [{ kind: 'warn', text: rc.failMsg }] : null;
      return evalEffects(rc.effects || rc, ctx);
    }
    // NPC 身上也可挂指令
    return null;
  };

  /* ---------------- 主解析入口 ---------------- */

  /* ================================================================
   * B6 · 「此地可做」按钮点了没反应/说没有 —— 归一化入口
   *
   * 主人原话：「"回春堂后院"的"此地可做"有草药，点了却说此地没有草药，
   * **这肯定不是个例**」。实测确认确实是一类问题，不是孤例。
   *
   * 【根因 1· 渲染读的字段和判定读的字段对不上（主人猜的那条，成立）】
   *   前端「此地可做」按钮渲染自engine.roomActionsView()，
   *   它遍历 room.actions，逐条给出 { name, cmd, ok }，点下去执行的就是 a.cmd。
   *   而 commands.execute() 的解析顺序是：
   *       1) 内置指令 CMD 表 → 2) 方向 → 3) roomCmd → 4) questKeyword
   *   **内置指令表排在房间 action 前面**。于是只要 action 的动词撞上内置指令，
   *   action 就被内置指令整条吞掉，effects 永远不执行。
   *   全量实测（128 条room action）：**48 条的动词是内置指令**，
   *   其中 27 条是多词cmd（如 `get 药材` / `talk 郎中` / `list 当铺`）。
   *
   * 【根因 2 · questKeyword 只拿首词比对，多词 cmd 永远匹配不上】
   *   questKeyword(ctx, cmd0, args) 里做的是 `a.cmd === cmd`（严格相等）
   *   和 `keywords.some(k => cmd.includes(k))`，可 cmd 是**首词**。
   *   所以 `listen 说书` / `read 告示` / `knock 登闻鼓` / `search 书架`
   *   这类 action 无论玩家点按钮还是手输，都匹配不上，
   *   实测 7 条全部返回「「listen」是什么指令？」——纯静默失败。
   *
   * 【修法】统一收口在 execute() 这一处，不逐条打补丁：
   *   ① selfSuffRoomAction()：房间 action **自带 effects** 时优先于内置指令
   *      （自带 effects ＝作者明确写了要做什么，被吞掉就是 bug）；
   *      不带 effects 的仍旧交给内置指令（`harvest`/`sell`/`d`/`打坐`
   *      这些是**故意**委托给内置指令的，不能抢）。
   *   ② questKeyword 改用**整条输入串**参与匹配，多词 cmd 终于能命中。
   *   ③ gather 归一化：没有 effects 的 `get/采 <东西>` 类 action
   *      （如 `get 药材`、`get 稻种`）按「此处可采」语义兑现 ——
   *      去物品表里解析出真实物品给玩家。原先这类 action 点了必然
   *      「这里没有「药材」」，因为房间根本没放ground item。
   * ================================================================ */

  /* 采集类 action 的泛称→真实物品别名（只认「说得通」的映射，不乱给）
     房间地图数据里这些 action 只写了「药材」这种泛称，
     而物品表里没有叫「药材」的东西，必须有一张明确的对照表，
     否则玩家点一下什么也拿不到。 */
  const GATHER_ALIAS = {
    '药材': 'herb_lingshen', '草药': 'herb_lingshen', '药': 'herb_lingshen',
    '稻种': 'seed_rice', '种子': 'seed_rice', '菜种': 'seed_vegetable',
  };

  /** 从物品表解析一个「可采之物」；解析不出返回 null（不硬塞） */
  function resolveGatherable(w, name) {
    const items = w.data.items || {};
    const kw = String(name || '').trim();
    if (!kw) return null;
    if (GATHER_ALIAS[kw]) return GATHER_ALIAS[kw];
    /* 精确名→ id 精确匹配 */
    for (const id of Object.keys(items)) if (items[id] && items[id].name === kw) return id;
    /* 模糊：与别名表同key 的物品名也算命中 */
    const hit = fuzzyFind(Object.keys(items).map(id => ({ id, name: items[id] && items[id].name })), kw, x => x.name);
    return hit ? hit.id : null;
  }

  /** 房间 action 是否「自带 effects」（= 不该被内置指令吞） */
  function selfSuffRoomAction(ctx, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    for (const a of room.actions || []) {
      if (!a.cmd || !(a.effects && a.effects.length)) continue;
      if (a.cmd === rawFull) return a;
    }
    return null;
  }

  /** 房间动作的限次（`once` 一辈子一次 / `oncePerDay` 每天一次）。
   *  返回「拦下来说的话」（数组）或 null（放行，并记账）。
   *
   *  来由（主人 2026-10-11：「重阳宫那里有个论道会无限获得潜能点的改一下」）：
   *  查下来不止重阳宫 —— 全地图 16 个「参悟 / 观景」型动作都能原地连点无限刷。
   *
   *  🔴 **必须做成共享函数**：房间动作有**三个**执行入口 ——
   *     `selfSuffRoomAction`（自带 effects，排在所有处理之前）
   *     `gatherRoomAction`（采集类）
   *     `questKeyword`（兜底关键词）
   *     我第一版只写在 `questKeyword` 里，结果「论道」走的是 `selfSuffRoomAction`，
   *     限次形同虚设 —— `smoke-actlimit` 当场抓住（连点两次都给收益）。
   *     凡是「同一个概念有多个入口」的地方，判定就必须抽出来共用。
   *
   *  ⚠️ 记账用 `!== undefined` 而不是真值判断：`day` 可能是 0（开局当天），
   *     `if (rec)` 会把「第 0 天做过」当成没做过。这条教训是世界事件那边
   *     `_evFired` 踩出来的，这里照搬。 */
  function actionLimit(ctx, a) {
    if (!a || (!a.once && !a.oncePerDay)) return null;
    const p = ctx.player, w = ctx.world;
    const used = p.actionUsed || (p.actionUsed = {});
    const last = p.actionLast || (p.actionLast = {});
    /* 键里带上房间：同一个 cmd（比如「打坐」）在不同房间是不同的事 */
    const key = (p.room || '') + '|' + (a.cmd || '');
    const today = Math.floor((w.clockMinutes || 0) / 1440);
    if (a.once && used[key] !== undefined) {
      return [{ kind: 'warn', text: a.spentMsg || '此处你已经悟透了，再看也无新得。' }];
    }
    if (a.oncePerDay && last[key] !== undefined && last[key] >= today) {
      return [{ kind: 'warn', text: a.dayMsg || '今日已经做过一回了，明日再来。' }];
    }
    if (a.once) used[key] = today;
    if (a.oncePerDay) last[key] = today;
    return null;
  }

  /** 没有 effects 的采集类 action → 兑现成真物品
   *
   *⚠️ 必须先确认「本房间真的声明了这么一条 action」才兑现，
   *   否则 `get 稻谷` 这种普通的捡地上东西，会被这里抢走
   *   （走giveItem 而不是 pickupItem，尸体/地面实例都不会被消耗）。
   *   所以这里查的是 room.actions，不是「看起来像采集指令」。 */
  function gatherRoomAction(ctx, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const raw = String(rawFull || '').trim();
    const m = /^(get|拿|取|采|摘|捡|拾取|take|pick)\s*(.+)$/i.exec(raw);
    if (!m) return null;
    /* 本房间是否声明了这条采集 action（cmd 或 keywords 命中） */
    const declaredAct = (room.actions || []).find(a =>
      (a.cmd || '').trim() === raw || (a.keywords || []).some(k => k && raw.includes(k)));
    if (!declaredAct) return null;
    /* 第三个入口也要过限次（同 actionLimit 注释）。 */
    const blocked = actionLimit(ctx, declaredAct);
    if (blocked) return { lines: blocked };
    const itemId = resolveGatherable(w, m[2]);
    if (!itemId) return null;   /* 解析不出就老实不处理，交给后续报「没有」 */
    if (w.battle) return { lines: [{ kind: 'warn', text: COMBAT_MOVE_HINT }] };
    const r = w.giveItem(p, itemId, 1);
    if (!r.ok) return { lines: [{ kind: 'warn', text: '你拿不动更多东西了。' }] };
    p.advanceTime(5);
    return {
      lines: [
        { kind: 'story', text: `你俯身拾起${r.name}。` },
        { kind: 'sys', text: `你得到了：${r.name} x1。` },
      ],
    };
  }

  function execute(input, ctx) {
    const raw = String(input || '').trim();
    if (!raw) return { lines: [] };
    // 支持 a;b;c 连续指令
    if (raw.includes(';')) {
      const lines = [];
      for (const part of raw.split(';')) {
        const r = execute(part, ctx);
        lines.push(...(r.lines || []));
        if (r.clear) return r;
      }
      return { lines };
    }
    const toks = tokenize(raw);
    const cmd0 = toks[0];
    let args = toks.slice(1);

    /* B6-① 房间 action 自带 effects 时，优先于内置指令表。
       没有这一层，`talk 禁军`（皇城·午门，明明白白写了 effects）
       会被内置 talk 吞掉，玩家永远看不到那两句写好的台词。 */
    const selfSuff = selfSuffRoomAction(ctx, raw);
    if (selfSuff) {
      if (selfSuff.cond && !evalCond(selfSuff.cond, ctx)) {
        return { lines: [{ kind: 'warn', text: selfSuff.failMsg || '现在做不了这个。' }] };
      }
      const blocked = actionLimit(ctx, selfSuff);
      if (blocked) return { lines: blocked };
      writeRoomNote(ctx, selfSuff);
      return { lines: evalEffects(selfSuff.effects, ctx) };
    }

    /* B6-③ 采集类 action 的归一化兑现。
       ⚠️ 必须排在「1) 内置指令」**之前**：回春堂·后院那条action 的 cmd
       就是 `get 药材`，而 `get` 是内置指令 —— 放在它后面永远轮不到，
       玩家只会听到 pickupItem 报「这里没有「药材」」。
       （gatherRoomAction 内部已确认「本房间确实声明了这条 action」，
         所以不会抢走普通的「捡地上东西」。） */
    const g0 = gatherRoomAction(ctx, raw);
    if (g0) return g0;

    // 1) 内置指令
    let entry = CMD[cmd0] || CMD[cmd0.toLowerCase()];
    if (entry) return entry.run(ctx, args) || { lines: [] };

    // 2) 纯方向「北」「走北」等
    if (DIRECTIONS[cmd0]) return doMove(ctx, DIRECTIONS[cmd0]);
    if ((cmd0 === '走' || cmd0 === '往' || cmd0 === '向') && args.length && DIRECTIONS[args[0]]) return doMove(ctx, DIRECTIONS[args[0]]);

    // 3) 房间/世界自定义指令
    const r1 = roomCmd(ctx, cmd0, args);
    if (r1) return { lines: r1 };

    // 4) 任务关键词（常见的任务动作）
    const r2 = questKeyword(ctx, cmd0, args, raw);
    if (r2) return { lines: r2 };

    // 5) mod 注册的自定义指令
    const cc = ctx.world.customCommands[cmd0];
    if (cc) {
      const res = cc({ args, raw, ctx, world: ctx.world, player: ctx.player });
      if (Array.isArray(res)) return { lines: res };
      if (res && res.lines) return res;
      if (typeof res === 'string') return { lines: [{ kind: 'plain', text: res }] };
    }

    // 6) 全局 mod 指令冲突检测
    for (const key of Object.keys(ctx.world.customCommands)) {
      if (key.startsWith('_')) continue;
    }

    // 7) 当作方向/房间名尝试移动
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (room) {
      for (const d of Object.keys(room.exits || {})) {
        const ex = room.exits[d];
        const tid = typeof ex === 'string' ? ex : ex.to;
        const tr = w.getRoom(tid);
        if (tr && (tr.name === cmd0 || tr.name.includes(cmd0))) return doMove(ctx, d);
      }
      // 7.5) 互动出口（爬山坡 / 跳崖 / 渡河…）：输入 via/hint 触发移动
      const full = (cmd0 + args.join('')).trim();
      if (full) {
        for (const d of Object.keys(room.exits || {})) {
          const ex = room.exits[d];
          if (!ex || typeof ex !== 'object') continue;
          const via = ex.via || '', hint = ex.hint || '';
          if (!via && !hint) continue;
          if (full === via || full === hint || via.includes(full) || full.includes(via) || hint.includes(full) || full.includes(hint)) {
            return doMove(ctx, d);
          }
        }
      }
    }

    // 8) 未知指令
    const guesses = [];
    const closeCmds = Object.keys(CMD).filter(c => c.length > 1 && (c.includes(cmd0) || cmd0.includes(c) || Math.abs(c.length - cmd0.length) === 0));
    const suggestion = closeCmds.slice(0, 3);
    return {
      lines: [
        { kind: 'warn', text: `「${cmd0}」是什么指令？你可以在心中默念「help」看看都会些什么。` },
        ...(suggestion.length ? [{ kind: 'hint', text: `你是不是想说：${suggestion.join(' / ')}？` }] : []),
      ]
    };
  }

  /* 任务关键词处理（如「摘桃子」「砍树」）
   *
   * B6-②：rawFull 是**整条输入串**。此前这里只拿首词 cmd 去比，
   * 导致 `listen 说书` / `read 告示` / `knock 登闻鼓` / `search 书架`
   * 这类多词 action 永远匹配不上（a.cmd 是整串，cmd 只有首词），
   * 玩家点按钮必然吃到「「listen」是什么指令？」。 */
function questKeyword(ctx, cmd, args, rawFull) {
    const p = ctx.player, w = ctx.world;
    const room = w.getRoom(p.room);
    if (!room) return null;
    const full = String(rawFull || (cmd + ' ' + (args || []).join(' ')).trim()).trim();
    /* action 的 cmd 既可能是整串（`listen 说书`），也可能只是首词（`采药`），
       两种写法都要认—— 这正是「渲染发的 cmd」与「判定匹配的 cmd」对齐的地方。 */
    const matchAction = a => {
      if (!a) return false;
      const ac = (a.cmd || '').trim();
      if (!ac) return false;
      if (ac === full || ac === cmd) return true;
      if (full && ac.startsWith(full)) return true;
      if ((a.keywords || []).some(k => k && (full.includes(k) || k.includes(full)))) return true;
      return false;
    };
    // 房间里的可交互物件
    const acts = room.actions || [];
    for (const a of acts) {
      if (matchAction(a)) {
        if (a.cond && !evalCond(a.cond, ctx)) return a.failMsg ? [{ kind: 'warn', text: a.failMsg }] : [{ kind: 'warn', text: '现在做不了这个。' }];
        /* 限次（见 actionLimit 的注释：房间动作有三个入口，判定必须共用） */
        const blocked = actionLimit(ctx, a);
        if (blocked) return blocked;
        if (!a.effects || !a.effects.length) {
          /* B6：action 存在但没写 effects（纯描述性/委托给内置指令的）。
             这里不能静默返回空数组 —— 玩家点了按钮却什么都没发生，
             正是主人报的「点了没反应」。
             注意措辞：不要把 desc 生硬拼进来（会出现
             「你溪里试试手气」这种半句话），只给一句明确的「无发现」。 */
          return [{ kind: 'plain', text: `你留心察看了一番，此处暂时没有更多可做的了。` }];
        }
        /* R4：动作成功才留痕（85 §0.2）——cond/限次/E缺 effects 的失败路径都到不了这 */
        writeRoomNote(ctx, a);
        return evalEffects(a.effects, ctx);
      }
    }
    // NPC 身上的任务动作
    for (const n of w.npcsIncludingTemplates(p.room)) {
      const def = n.def || {};
      if (def.actions) {
        for (const a of def.actions) {
          if (a.cmd === cmd || (a.keywords || []).some(k => cmd.includes(k))) {
            if (a.cond && !evalCond(a.cond, { ...ctx, npc: n })) return [{ kind: 'warn', text: a.failMsg || '对方似乎不打算理会你。' }];
            return evalEffects(a.effects, { ...ctx, npc: n });
          }
        }
      }
    }
    // 全局任务关键词
    const gk = w.data.meta.globalActions || [];
    for (const a of gk) {
      if (a.cmd === cmd || (a.keywords || []).some(k => cmd.includes(k))) {
        if (a.room && a.room !== p.room) continue;
        if (a.cond && !evalCond(a.cond, ctx)) return a.failMsg ? [{ kind: 'warn', text: a.failMsg }] : null;
        return evalEffects(a.effects, ctx);
      }
    }
    return null;
  }

  /* 对话树运行 */
  function runDialogTree(ctx, npc, tree) {
    const lines = [];
    let node = tree.start || Object.keys(tree.nodes || {})[0];
    const w = ctx.world, p = ctx.player;
    let guard = 0;
    while (node && guard++ < 30) {
      const nd = tree.nodes[node];
      if (!nd) break;
      if (nd.text) {
        const n = nd.speaker === 'player' ? '你' : npc.name;
        lines.push({ kind: 'say', text: `${n}：${evalTemplate(nd.text, ctx)}` });
      }
      if (nd.effects) evalEffects(nd.effects, { ...ctx, npc }).forEach(l => lines.push(l));
      if (nd.options && nd.options.length) {
        const opts = nd.options.filter(o => !o.cond || evalCond(o.cond, { ...ctx, npc }));
        if (!opts.length) break;
        lines.push({ kind: 'menu', title: nd.prompt || '你要说什么？', options: opts.map(o => ({ label: o.label, effects: o.effects || [], goto: o.goto })), npc: npc.name });
        break;
      }
      if (nd.ask) {
        lines.push({ kind: 'ask', title: nd.ask.prompt || '你想问什么？', options: (nd.ask.topics || []).map(t => ({ label: t.label, effects: t.effects || [] })) });
        break;
      }
      node = nd.next;
      if (nd.end) break;
    }
    return lines;
  }

  function runDialogue(ctx, npc, dlg) {
    const lines = [];
    let node = dlg.start || 'start';
    const w = ctx.world;
    let guard = 0;
    while (node && guard++ < 40) {
      const nd = dlg.nodes[node];
      if (!nd) break;
      if (nd.text) lines.push({ kind: 'say', text: `${nd.speaker === 'player' ? '你' : npc.name}：${evalTemplate(nd.text, ctx)}` });
      if (nd.effects) evalEffects(nd.effects, { ...ctx, npc }).forEach(l => lines.push(l));
      if (nd.options && nd.options.length) {
        const opts = nd.options.filter(o => !o.cond || evalCond(o.cond, { ...ctx, npc }));
        lines.push({ kind: 'menu', title: nd.prompt || '你要说什么？', options: opts.map(o => ({ label: o.label, effects: o.effects || [], goto: o.goto })), npc: npc.name });
        break;
      }
      if (nd.end) break;
      node = nd.next;
    }
    return lines;
  }

  /* 交任务 */
  function tryReportQuest(ctx, npc, lines) {
    const p = ctx.player, w = ctx.world;
    const def = npc.def || {};
    const qs = def.quests || [];
    const reportable = [];
    for (const q of qs) {
      const st = p.questStage(q);
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(q);
      if (!qd) continue;
      /* ⚠️ 两处与面板**必须同源**，不然就是「面板说能交、点下去说不行」：
         ① 阶段走 stageResolve（按线/性别分叉 + 前置锁）
         ② 目标判定走 engine.targetDone（item 数物件 / flag 看标记 / 其余读 var）
         原先这里直接 `p.getVar(...)`，于是 **flag 与 item 类目标永远交不了**
         —— 与主人报的「破庙搜查完成不了」是同一族，只是长在另一个入口上。 */
      const stage = queststage.stageResolve(p, qd.stages && qd.stages[st], w);
      if (stage && stage.locked) continue;   // 前置没做完 → 交不了（也不静默：checkQuestAuto 已提示）
      if (stage && stage.targets) {
        let ok = true;
        for (const t of stage.targets) {
          if (!queststage.targetDone(p, q, t)) { ok = false; break; }
        }
        if (!ok) continue;
      }
      if (stage && stage.cond && !evalCond(stage.cond, ctx)) continue;
      reportable.push({ q, qd, stage, st });
    }
    if (!reportable.length) return false;
    const { q, qd, stage, st } = reportable[0];
    lines.push({ kind: 'say', text: `${npc.name}点了点头：「你办得不错。」` });
    /* 画像信任轴 trust 的增长通道（任务三）：**办成事才涨 trust**。
       送礼涨 favor（喜欢你），办事涨 trust（信得过你）——两条轴不混（design/01 §1.2）。
       trust 是画像 origin/now/want/fear（0/20/50/70）与 secret/feuds（40~65）的门槛；
       此前**全仓没有任何地方涨 trust** ⇒ 那些内容玩家永远看不到。这里补上。 */
    npc.pstate = npc.pstate || { trust: 0, revealed: [], hooks: {}, met: false, moodBias: 0, leaked: false };
    npc.pstate.trust = Math.min(100, (npc.pstate.trust || 0) + 8);
    /* 任务每推进一步，也涨一截**好感**（主人 2026-10-10 定的）：
       好感是「他喜不喜欢你」，trust 是「他信不信得过你」——两条轴不混，
       但一起办事的人本来就该越处越近。下限 10，永不为负。 */
    npc.favor = (npc.favor || 0) + 10;
    // 清理阶段变量
    if (stage && stage.targets) for (const t of stage.targets) p.setVar(t.var || `q_${q}_${t.id}`, 0);
    if (stage && stage.effects) evalEffects(stage.effects, { ...ctx, npc }).forEach(l => lines.push(l));
    const next = (stage && stage.next !== undefined) ? stage.next : st + 1;
    const stages = qd.stages || [];
    if (next >= 99 || next >= stages.length) {
      p.setQuestStage(q, 99);
      lines.push({ kind: 'quest', text: `【任务完成】${qd.name}` });
      if (qd.rewards) evalEffects(qd.rewards, ctx).forEach(l => lines.push(l));
      /* 办事得来的长进（主人 2026-10-08：「给主支线任务…增加潜能获取途径」）。
         主线给得最多 —— 它是长线，玩家靠它撑过前中期。 */
      potential.grant(p, potential.questRewardOf(qd, true), lines, '这一趟没白跑');
      /* ---- 声望挂点（2026-10-15 主人批准的双口径）----
         ① quest def 级 `repGainOnQuest`（推荐新写法）：挂在任务上，交这一案加这一案的
            —— 每案只收口一次，天然按案精确（design/95 §三键位表口径回流处）。
         ② NPC def 级 `repGainOnQuest`（旧写法，兼容保留）：原样挂在 NPC 上时，
            同一 NPC 名下多案会**各自全量加成**（游有方第一批实测踩过）。
            ⇒ 加 questId 去重旗：flag `repgain_<questId>` —— 同一案无论从哪条路
               重复结算，都只加一次；不同案各结各的，互不吞。
         ③ 两级同时声明 = **叠加**（quest 级按案 + NPC 级按去重旗），不搞静默覆盖。 */
      const repFlag = 'repgain_' + q;
      if (qd.repGainOnQuest) {
        for (const k of Object.keys(qd.repGainOnQuest)) {
          p.reputation[k] = (p.reputation[k] || 0) + qd.repGainOnQuest[k];
          lines.push({ kind: 'sys', text: `你在${k}的声望提高了 ${qd.repGainOnQuest[k]}。` });
        }
      }
      if (def.repGainOnQuest && !p.hasFlag(repFlag)) {
        for (const k of Object.keys(def.repGainOnQuest)) p.reputation[k] = (p.reputation[k] || 0) + def.repGainOnQuest[k];
        p.setFlag(repFlag, true);
      }
    } else {
      p.setQuestStage(q, next);
      lines.push({ kind: 'quest', text: `【任务进展】${qd.name}` });
      const ns = stages[next];
      if (ns && ns.desc) lines.push({ kind: 'plain', text: `下一步：${ns.desc}` });
      /* 每推进一步也给一小笔，长任务不至于中途断粮 */
      potential.grant(p, potential.questRewardOf(qd, false), lines, '事情有了眉目');
    }
    return true;
  }

  /* 派发任务目标进度（击杀/采集等由 world 调用） */
  function advanceQuestCounters(ctx, kind, key, n) {
    const p = ctx.player, w = ctx.world;
    n = n || 1;
    const lines = [];
    for (const qid of Object.keys(p.quests)) {
      const st = p.quests[qid];
      if (st < 0 || st >= 99) continue;
      const qd = w.getQuest(qid);
      if (!qd || !qd.stages || !qd.stages[st]) continue;
      const stage = qd.stages[st];
      for (const t of (stage.targets || [])) {
        if (t.kind !== kind) continue;
        /* 目标名单：单数 `key` 与复数 `keys` 是**两种等价写法**，必须一起认。
           ⚠️ 原写法 `if (t.key && t.key !== key && !(t.keys||[]).includes(key)) continue;`
           短路在 `t.key` 为假时整条不成立 → **只写 `keys` 的目标等于没写限制**：
           "击杀恶徒十个"变成"击杀任意人十个"（全库 3 条：q_emei_entry /
           q_huashan_sword_test / q_bounty_bandit）。现在按并集判定；
           两者都不写才是真的"击杀任意目标"（全库当前 0 条）。 */
        const wantK = t.key ? [t.key] : (Array.isArray(t.keys) ? t.keys : []);
        if (wantK.length && wantK.indexOf(key) < 0) continue;
        const vk = t.var || `q_${qid}_${t.id}`;
        const cur = (p.getVar(vk) || 0) + n;
        p.setVar(vk, Math.min(cur, t.count || 1));
        if (cur >= (t.count || 1)) {
          lines.push({ kind: 'quest', text: `【任务】${qd.name}：${t.desc || t.id} 已完成！` });
        }
      }
    }
    return lines;
  }

  /* ================================================================
   * 掳人 / 奴役 / 护院（kidnap.js）
   * 规矩：所有返回值都包成 { lines } —— commands.execute 只认 res.lines。
   * 装人这类「看一眼就知道违法」的玩法，全部按律法定代价（恶名阶梯），
   * 不做道德说教，只让官府和pty 传闻来找麻烦。
   * ================================================================ */
  const kdLines = (r) => ({ lines: (r && r.lines) || [] });
  /* ⚠️ 参数要从**第二参**取，不是 ctx.args。
     内置指令的分派是 ，ctx 上根本没有 args 这个键 ——
     读 ctx.args 永远是 undefined，于是  一直在**忽略名字**，
     永远抓房间里第一个晕倒的人（一批掳人指令都带着这个毛病）。 */
  const kdArg = (ctx, args) => {
    if (Array.isArray(args) && args.length) return args.join(' ').trim();
    return String((ctx && ctx.args) || '').trim();
  };

  /* ---- ① 掳人：把晕倒的 NPC 装进麻袋 ---- */
  reg(['pack', '装人', '掳走', '扛人'], (ctx, args) => kdLines(kidnapMod.packNpc(ctx.world, kdArg(ctx, args))));
  /* ---- 绑架（主人 2026-10-11）----
     NPC 菜单那个「绑架」按钮发的就是这条。与「装人」的区别：
       装人 —— 只装**已经晕倒**的人；
       绑架 —— 站着的人也能下手，先按成功率掷一次：
                成了当场套袋（**不开打**），没成才动手（打赢他自然晕，回来再装）。
     「晕着的人」走这条也照旧直接装（必定成功），所以面板上那个按钮可以放心点。 */
  reg(['绑架', 'kidnap', '掳人', '掳走他'], (ctx, args) => kdLines(kidnapMod.kidnapAttempt(ctx.world, kdArg(ctx, args))));

  /* ---- ② 麻袋一览 / 放人 ---- */
  reg(['bags', '麻袋', '袋'], (ctx) => {
    const list = kidnapMod.listBags(ctx.world);
    const lines = [{ kind: 'title', text: '【 麻 袋 】' }];
    if (!list.length) lines.push({ kind: 'plain', text: '　你没扛着麻袋。' });
    for (const b of list) {
      const st = { out: '袋里', struggling: '正在挣扎', burst: '要冲出来了' }[b.state] || b.state;
      lines.push({
        kind: b.state === 'out' ? 'plain' : 'warn',
        text: `　第${b.idx}袋　${b.name}　${st}　（装进去 ${b.minutesIn} 分钟）`,
        bagIdx: b.idx, npcName: b.name,
      });
    }
    if (list.length) lines.push({ kind: 'hint', text: '　用「放人 <第几袋>」把人放出来。' });
    return { lines };
  });

  reg(['release', '放人'], (ctx, args) => kdLines(kidnapMod.releaseBag(ctx.world, kdArg(ctx, args) || 1)));

  /* ---- ③ 卖人 / 赎人 ---- */
  reg(['sellnpc', '卖人'], (ctx, args) => kdLines(kidnapMod.sellNpc(ctx.world, kdArg(ctx, args))));
  /* ⚠️ 「赎人」不能占 redeem/赎身 —— 那是青楼卖身线的既有指令（blood rule #27 同理）。
     赎回别人的名字一律带「买」字口：赎人 → 「赎回」。 */
  reg(['redeemnpc', '赎回', '赎出'], (ctx, args) => kdLines(kidnapMod.redeemPerson(ctx.world, kdArg(ctx, args))));

  /* ---- ④ 黑市买奴 ---- */
  reg(['buyslave', '买奴'], (ctx, args) => kdLines(kidnapMod.buySlave(ctx.world, kdArg(ctx, args))));

  /* ---- ④b 家园地牢（关押 / 提审 / 陪练 / 放出）----
     estate 的「地牢」地块此前只定义没接线（captiveCap/tortureRate/sparExp 无人消费），
     这四个指令就是把那块地牢接上。 */
  reg(['jail', '关押', '收监', '下狱'], (ctx, args) => kdLines(kidnapMod.imprison(ctx.world, kdArg(ctx, args))));
  reg(['interrogate', '提审', '逼供', '审问'], (ctx, args) => kdLines(kidnapMod.interrogate(ctx.world, kdArg(ctx, args))));
  reg(['spar', '陪练', '喂招'], (ctx, args) => kdLines(kidnapMod.sparWith(ctx.world, kdArg(ctx, args))));
  reg(['freecaptive', '放出', '开锁'], (ctx, args) => kdLines(kidnapMod.freeCaptive(ctx.world, kdArg(ctx, args))));

  /* ---- ⑤ 名册：麻袋 + 奴 + 护院 + 恶名 ---- */
  reg(['slaves', '奴册', '奴仆', '护院', '地牢', '牢房'], (ctx) => {
    const w = ctx.world, p = ctx.player;
    const k = kidnapMod.data(w);
    if (!k) return { lines: [{ kind: 'plain', text: '你还没上路。' }] };
    const q = kidnapMod.quotas(w);
    const wt = kidnapMod.wantedTier(k.wanted);
    const lines = [{ kind: 'title', text: '【 奴 册 】' }];
    /* 恶名 */
    lines.push({ kind: k.wanted > 0 ? 'warn' : 'plain', text: `　恶名：${k.wanted}（${wt.name}）` });
    if (wt.desc) lines.push({ kind: 'hint', text: '　' + wt.desc });
    /* 名额 */
    lines.push({ kind: q.slaves >= q.slaveMax ? 'plain' : 'hint', text: `　家资档：${q.name}　奴 ${k.slaves.length}/${q.slaveMax}　护院 ${k.guards.length}/${q.guardMax}` });
    /* 麻袋 */
    lines.push({ kind: 'subtitle', text: '麻袋里' });
    if (!k.bags.length) lines.push({ kind: 'plain', text: '　（空）' });
    for (const b of kidnapMod.listBags(w)) {
      lines.push({ kind: 'plain', text: `　第${b.idx}袋 ${b.name}（${b.minutesIn} 分钟）` });
    }
    /* 奴 */
    lines.push({ kind: 'subtitle', text: '名下的人' });
    if (!k.slaves.length) lines.push({ kind: 'plain', text: '　（无）' });
    for (const s of k.slaves) {
      const busy = s.task && s.taskEnds && w.clockMinutes < s.taskEnds;
      lines.push({
        kind: 'plain',
        text: `　${s.name}　服从 ${s.obedience}　好感 ${s.favor}　${busy ? `干活中（还剩 ${s.taskEnds - w.clockMinutes} 分钟）` : (s.waitingAt ? '在' + ((w.getRoom(s.waitingAt) || {}).name || s.waitingAt) + '等你' : '闲着')}`,
        npcName: s.name, slaveName: s.name,
      });
    }
    /* 护院 */
    lines.push({ kind: 'subtitle', text: '护院' });
    if (!k.guards.length) lines.push({ kind: 'plain', text: '　（无）' });
    for (const g of k.guards) {
      const busy = g.supervising && w.clockMinutes < (g.superviseEnds || 0);
      lines.push({ kind: 'plain', text: `　${g.name}　武力 ${g.power}　日薪 ${g.wage} 文　${busy ? '正盯着' + g.supervising + '干活' : '看家'}${g.loyalty < 30 ? '　（离心）' : ''}` });
    }
    if (k.wageDue) lines.push({ kind: 'warn', text: `　欠工钱 ${k.wageDue} 文（拖久了护院会走）` });
    /* 地牢（只有开出来了才显示） */
    const dg = kidnapMod.dungeonOf(w);
    if (dg.has) {
      const cl = kidnapMod.captives(w);
      lines.push({ kind: 'subtitle', text: `地牢（${cl.length}/${dg.cap}）` });
      if (!cl.length) lines.push({ kind: 'plain', text: '　（空）' });
      for (const c of cl) {
        lines.push({
          kind: 'plain',
          text: `　${c.name}　服从 ${c.obedience || 0}　好感 ${c.favor || 0}　${c.interrogated ? '已审 ' + c.interrogated + ' 次' : '没审过'}`,
          npcName: c.name,
        });
      }
      if (cl.length) lines.push({ kind: 'hint', text: '　用「提审 <人名>」套话、「陪练 <人名>」喂招、「放出 <人名>」放人。' });
    }
    /* 债务（玩家自己被掳走） */
    if (k.debt) {
      const bm = kidnapMod.BLACK_MARKETS.find(b => b.id === k.debt.market) || {};
      lines.push({ kind: 'warn', text: `【你在${bm.name || '黑市'}】赎金 ${k.debt.ransom} 文　可用「赎身」或「突围」` });
    }
    return { lines };
  });

  /* ---- ⑥ 派活 ---- */
  reg(['task', '使唤', '派活'], (ctx, args) => {
    const arg = kdArg(ctx, args);
    /* 「使唤」不带活名 → 列可选活；带活名 → 派 */
    const TASK_KEYS = { '做工': 'craft', '土工': 'craft', '采买': 'purchase', '跑腿': 'errand', '洗衣': 'laundry' };
    let taskKey = TASK_KEYS[arg];
    let who = '';
    if (!taskKey) {
      const parts = arg.split(/\s+/).filter(Boolean);
      if (parts.length >= 2) { who = parts[0]; taskKey = TASK_KEYS[parts[1]]; }
      else if (parts.length === 1) { who = parts[0]; }
    }
    if (!taskKey) {
      const k = kidnapMod.data(ctx.world);
      if (!k || !k.slaves.length) return { lines: [{ kind: 'plain', text: '你名下没人。' }] };
      const lines = [{ kind: 'title', text: '【 派 活 】' }];
      for (const s of k.slaves) lines.push({ kind: 'plain', text: `　${s.name}　服从 ${s.obedience}　好感 ${s.favor}`, slaveName: s.name });
      lines.push({ kind: 'subtitle', text: '可派的活' });
      for (const key of Object.keys(kidnapMod.TASKS)) {
        const t = kidnapMod.TASKS[key];
        lines.push({ kind: 'plain', text: `　${t.name}：${t.desc}　约赚 ${t.earn[0]}~${t.earn[1]} 文`, taskKey: key });
      }
      lines.push({ kind: 'hint', text: '　用法：使唤 <人名> <活名>，如「使唤 阿福 采买」' });
      return { lines };
    }
    return kdLines(kidnapMod.assignTask(ctx.world, who, taskKey));
  });

  /* ---- ⑦ 跟随 ---- */
  reg(['follow', '跟随', '邀跟随'], (ctx, args) => kdLines(kidnapMod.inviteFollow(ctx.world, kdArg(ctx, args))));

  /* ---- ⑧ 护院：雇 / 结薪 / 监督 ---- */
  reg(['hireguard', '雇护院', '请护院'], (ctx, args) => kdLines(kidnapMod.hireGuard(ctx.world, kdArg(ctx, args))));
  reg(['wages', '发工钱', '结薪'], (ctx) => kdLines(kidnapMod.payWages(ctx.world)));
  reg(['supervise', '监督', '盯着'], (ctx, args) => kdLines(kidnapMod.supervise(ctx.world, kdArg(ctx, args))));

  /* ---- ⑨ 玩家自己被掳走后的三条路 ----
   * 赎身/赎回/脱籍 由上面那个「赎身」按场景统一分派，这里不再重复注册。
     只补黑市专用的突围（武力打出去），以及还债。 */
  reg(['escape', '突围', '打出去'], (ctx) => {
    const r = kidnapMod.escapeMarket(ctx.world);
    /* B22 埋点 14/14 · rs_jailbreak（越狱/突围成功，重案 −）：大动静 → 邻房也传。 */
    if (r && r.ok && typeof ctx.world.addRumor === 'function') {
      ctx.world.addRumor('rs_jailbreak', { room: ctx.player.room, about: 'court', vars: { who: ctx.player.name || '有人', where: '黑市' } });
    }
    return kdLines(r);
  });
  reg(['workdebt', '还债', '打工还债'], (ctx) => {
    const r = kidnapMod.workOffDebt(ctx.world, 60);
    if (!r || !r.ok) {
      /* 一次性还不上，就走普通打工 + 记一笔 */
      const r2 = workMod.work(ctx.world);
      return { lines: ((r && r.lines) || []).concat(r2.lines || []) };
    }
    return kdLines(r);
  });

  return { CMD, execute, doMove, lookRoom, scoreLines, describeItem, lookNpc, advanceQuestCounters, DIRECTIONS, DIR_CN, cnNum, runDialogue };
}

/* ============================================================
 * 好感详情（favor <人名> 用）
 * ============================================================ */
function favorDetail(w, npc) {
  const def = npc.def || {};
  const t = social.favorTier(npc.favor);
  const lines = [
    { kind: 'title', text: `【 ${npc.name} 】` },
    { kind: 'plain', text: `　身份：${npcIdentity(w, npc)}　${genderNoun(npc)}　${npc.level || 1} 级` },
    { kind: 'favor', text: `　好感：${npc.favor || 0}（${t.name}）—— ${t.cn}`, color: t.color, favor: npc.favor || 0, tier: t.name },
  ];

  /* 喜爱的东西 */
  const likes = (def.likes || []).map(x => social.LIKE_TYPES.find(y => y.id === x)).filter(Boolean);
  if (likes.length) {
    lines.push({ kind: 'subtitle', text: '喜爱之物' });
    for (const l of likes) lines.push({ kind: 'plain', text: `　${l.cn}`, likeType: l.id, color: '#c07a4a' });
  }

  /* 可请教的武学 */
  const tl = social.teachList(w, npc);
  if (tl.length) {
    lines.push({ kind: 'subtitle', text: '可请教武学' });
    for (const s of tl.slice(0, 6)) {
      const ok = (npc.favor || 0) >= s.favorNeed;
      lines.push({
        kind: 'skill',
        text: `　${s.name}【${s.quality}】需好感 ${s.favorNeed}${ok ? ' ✔' : ''}${s.money ? `　或 ${s.money} 文` : ''}`,
        skillId: s.id, favorNeed: s.favorNeed, money: s.money, ok,
      });
    }
    if (tl.length > 6) lines.push({ kind: 'hint', text: `　…还有 ${tl.length - 6} 门，用「请教 ${npc.name}」看全部。` });
  }

  /* 住处 */
  if (def.home) {
    const r = w.getRoom(def.home);
    lines.push({ kind: 'plain', text: `　住处：${r ? r.name : def.home}` });
  } else {
    lines.push({ kind: 'plain', text: '　住处：无（居无定所）' });
  }

  /* 身上财物（模糊提示，不直接列清单） */
  const carry = npc.carry || def.carry || {};
  const cnums = (carry.items || []).length;
  if (cnums || carry.money) {
    lines.push({ kind: 'hint', text: `　（${pronounOf(npc)}怀里似乎${carry.money ? '揣着钱' : ''}${carry.money && cnums ? '，还' : ''}${cnums ? `带着 ${cnums} 样东西` : ''}）` });
  }

  /* 关系 */
  const rel = npc.rel || def.rel || [];
  if (rel.length) {
    lines.push({ kind: 'subtitle', text: '人际' });
    for (const r of rel.slice(0, 5)) {
      const o = w.data.npcs[r.id];
      if (!o) continue;
      lines.push({ kind: 'plain', text: `　${relKindCN(r.kind)}　${o.name}（${npcIdentity(w, o)}）`, relId: r.id, relKind: r.kind });
    }
    lines.push({ kind: 'hint', text: `　用「关系 ${npc.name}」看全部关系。` });
  }
  return lines;
}

const TAG_CN = {
  commoner: '寻常百姓', vendor: '市井摊贩', scholar: '书生', farmer: '农户', smith: '铁匠',
  doctor: '郎中', innkeeper: '客栈掌柜', waiter: '店小二', merchant: '商贾', richman: '富户',
  groom: '车夫', child: '孩童', beggar: '乞丐', refugee: '流民', escort: '镖师',
  constable: '捕快', official: '官员', eunuch: '太监', palace: '宫人', consort: '妃嫔',
  courtesan: '风尘女子', madam: '老鸨', singer: '乐伎', swordsman: '侠客', thief: '盗贼',
  hunter: '猎户', monk: '僧人', nun: '尼姑', taoist: '道人', actor: '戏子',
  boatman: '船夫', gambler: '赌徒', waiter2: '茶博士',
};
function tagCN(t) { return TAG_CN[t] || t; }

/* ============================================================
 *  NPC 身份（主人 20261010h 要求）
 *  以前看人写「江湖中人」、看关系写「（住江南城·长街）」——都是废话，
 *  住处人人一个样（大多就在本城），身份才是一个人在这江湖里的位置。
 *  优先级：门派职位 > title（捕快/郎中/富户…）> job > tag > 按名字猜 > 江湖散人。
 *  ⚠️ 名人（君子剑、九指神丐…）的 title 是**称号**不是身份，
 *     但他们都有 sect，所以门派那条先走 —— 岳不群显示「华山派掌门」而不是「君子剑」。
 * ============================================================ */
const JOB_CN = {
  swordsman: '刀客', doctor: '郎中', innkeeper: '客栈掌柜', monk: '僧人',
  constable: '捕快', taoist: '道人', nun: '尼姑', vendor: '货郎', scholar: '书生',
  farmer: '农人', smith: '铁匠', merchant: '行商', richman: '富户', groom: '马夫',
  escort: '镖师', official: '官吏', madam: '鸨母', waiter: '店伙', thief: '盗贼',
  hunter: '猎户', actor: '戏子', boatman: '艄公', gambler: '赌徒',
};

/** 关系单字 → 双字词（主人：别写「友」「仇」，写「友人」「仇人」） */
const REL_KIND_CN = {
  亲: '亲人', 友: '友人', 仇: '仇人', 师: '师长', 生: '门生',
  夫妻: '夫妻', 妾: '姬妾', 义: '义兄弟', 结缘: '结缘人',
};

/** 「友」→「友人」；不认识的关系词原样返回（宁可原样也不瞎编） */
function relKindCN(k) {
  if (!k) return '熟人';
  if (REL_KIND_CN[k]) return REL_KIND_CN[k];
  /* ⚠️ 已经是词（如「义兄」「结拜兄弟」）就原样返回，别再补「人」变成「义兄人」 */
  if (k.length >= 2) return k;
  return k + '人';
}

/* ================================================================
 * NPC 之间对第三方的好感度（主人：关系界面要显示「好感度：-70」）
 *
 * ⚠️ 别搞错对象：`npc.favor` 是「他对**玩家**的好感」，
 *    套到关系列表里的第三方头上就是张冠李戴（历史上 favor 面板就翻过车）。
 *
 * 三级取值：
 *   ① npc.relFavor[对方 defId] —— 运行时浮动值（送礼/结仇事件改的），优先
 *   ② r.favor                  —— 数据里直接写死的
 *   ③ 按 kind 给基准值（确定性，不用 rng：同一个 NPC 每次看必须是同一个数，
 *      不然玩家刷新一次数字就跳一次，会以为是 bug）
 * ============================================================ */
const REL_FAVOR_BASE = { 友: 60, 亲: 90, 师: 70, 生: 65, 夫妻: 100, 仇: -70, 敌: -60 };
function relFavorBetween(npc, other, rel) {
  const oid = (other && (other.defId || other.id)) || null;
  const dyn = npc && npc.relFavor && oid ? npc.relFavor[oid] : undefined;
  if (Number.isFinite(dyn)) return Math.max(-100, Math.min(100, Math.round(dyn)));
  if (rel && Number.isFinite(Number(rel.favor))) {
    return Math.max(-100, Math.min(100, Math.round(Number(rel.favor))));
  }
  const base = REL_FAVOR_BASE[rel && rel.kind];
  /* 没定基准的 kind 走 0（陌生人 / 未定性），别硬凑一个数字骗玩家 */
  return base === undefined ? 0 : base;
}
/** 好感度显示：正数带 + 号，负数带 −（中文负号），0 显示「中立」 */
function fmtRelFavor(v) {
  const n = Math.round(v || 0);
  if (n === 0) return '0（不相干）';
  return (n > 0 ? '+' : '−') + Math.abs(n);
}

/**
 * 这个 NPC 是什么身份。
 * @param {object} w world
 * @param {object} npc 实例或模板都可
 */
function npcIdentity(w, npc) {
  const d = npc.def || npc || {};
  const sectId = npc.sect || d.sect;
  const rank = npc.rank || d.rank;

  /* ① 门派职位：华山派 + ranks[5] → 「华山派掌门」
     ⚠️ `rank` 是 **0 基下标**（玩家升级走 `ranks[p.rank]`，见 character.js:585），
        所以直接下标取，**不要 -1**。数据里掌门写 rank:5 对应 ranks 数组第 6 项。 */
  if (sectId) {
    const s = (w.data.sects || {})[sectId];
    if (s) {
      const rk = Number.isFinite(rank) ? rank : 0;
      const rn = (s.ranks || [])[rk];
      if (rn) return s.name + rn;
      /* 下标越界（数据写错）→ 至少把门派名报出来，别吞成「江湖中人」 */
      return s.name + '中人';
    }
    return '江湖门派中人';
  }

  /* ② title：捕快 / 郎中 / 寻常百姓 / 青楼女子……（已是身份词） */
  const title = npc.title || d.title;
  if (title && title.length <= 6) return title;

  /* ③ job */
  const job = npc.job || d.job;
  if (job && JOB_CN[job]) return JOB_CN[job];

  /* ④ tag：B 层 NPC（npcv_*）没 title，靠 tag */
  const tag = npc.tag || d.tag;
  if (tag && TAG_CN[tag]) return TAG_CN[tag];

  /* ⑤ 按名字猜（野兽/贼众这类没任何标记的） */
  const nm = npc.name || '';
  if (/狼|虎|熊|蛇|豹|兽|野猪|豺|鹰|蟒|鳄/.test(nm)) return '山中猛兽';
  if (/山贼|贼众|强盗/.test(nm)) return '山贼';
  if (/兵丁|官兵|士兵/.test(nm)) return '官兵';
  if (/刺客|黑衣人/.test(nm)) return '来路不明的刺客';
  if (/流民|叫花|乞丐/.test(nm)) return '流民';

  return '江湖散人';
}

/**
 * 自动寻路被门禁挡住时，给一句人话提示（而不是干巴巴的「找不到路」）。
 * 做法：全图忽略门禁 BFS 找一条路，再沿路找第一道 con不满足的边，报它的 msg。
 * @returns {string|null}
 */
function lockedEdgeHint(world, from, to, ctx) {
  const anyPath = findPath(world, from, to, null);
  if (!anyPath || !anyPath.length) return null;
  let cur = from;
  for (const step of anyPath) {
    const room = world.getRoom(cur);
    if (!room) return null;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (tid !== step) continue;
      if (ex && ex.cond) {
        let ok = true;
        try { ok = !!evalCond(ex.cond, ctx); } catch (e) { ok = true; }
        if (!ok) return ex.msg || '那边过不去。';
      }
    }
    cur = step;
  }
  return null;
}

/* 简易寻路（BFS）
   ⚠️ 必须能跳过「上锁的出口」，否则玩家一句 `go 太和殿` 就瞬移进皇宫，
      `doMove` 里那道 ex.cond 门禁形同虚设（这就是门禁数据填了也不生效的根因）。
   cond 里可能带 item/sect/rank/title 等拿不到 player 的判定，
   这时保守当作「通得过」——真正拦得住门的 cond（item/flag/sect）都不依赖随机。
   @param {object} ctx 可选。给了就按玩家真实条件过滤；不给则忽略门禁（旧行为）。 */
function findPath(world, from, to, ctx) {
  if (from === to) return [];
  const q = [[from]];
  const seen = new Set([from]);
  const canPass = (ex) => {
    if (!ex || !ex.cond) return true;
    if (!ctx || !ctx.player) return true;
    try { return !!evalCond(ex.cond, ctx); } catch (e) { return true; }
  };
  while (q.length) {
    const path = q.shift();
    const cur = path[path.length - 1];
    const room = world.getRoom(cur);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (!tid || seen.has(tid)) continue;
      /* 被锁住的出口不走（路径里若已锁，直接中断——返回的路径玩家走不通） */
      if (!canPass(ex)) continue;
      const np = path.concat(tid);
      if (tid === to) return np.slice(1);
      seen.add(tid);
      q.push(np);
      if (seen.size > 3000) return null;
    }
  }
  return null;
}

/* ---- R4 roomNotes 痕迹句（design/85 §〇/§三，2026-10-15 落地）----
 * 行为点 = 「能下手的地方」的回声：只有房间 action 才产生行为点，
 * 动作**成功**才写（cond 不过 / 限次被拦 / effects 缺失都不写 —— 85 §0.2）。
 * 写 p.roomNotes[roomId]，**单值**静默覆盖（77 §6.1 V3），序列化随 Character.toJSON 自带走。
 * 本批只落 85 §三.2 的「!combat 常驻位」6 条（#3 掬泉/#4 坐歇/#11 上香/#14 藏物/#15 施舍/#18 净面）；
 * 其余 12 条带 ⚠️ 字段（weather/isNight/flag）等字段对齐后再补，不硬造。
 * 痕迹句是回述（过去时），**不过 .hl 渲染管线**（85 §二.1 / 81 N-V-25）。 */
const ROOMNOTE_RULES = [
  { id: 'drink',   keys: ['泉水', '饮水', '掬'], note: '潭边的石上留着一圈水渍。' },
  { id: 'rest',    keys: ['坐歇', '歇息', '小坐'], note: '石面上蹭出一小片光，是常坐的人才坐得出的。' },
  { id: 'incense', keys: ['上香'], note: '香炉里多了一截烧尽的香灰。' },
  { id: 'hide',    keys: ['藏物', '藏东西', '埋'], note: '那块松动的砖，按过之后更松了。' },
  { id: 'alms',    keys: ['施舍', '施'], note: '破碗里的铜钱叠着两枚。' },
  { id: 'wash',    keys: ['净面', '洗手', '洗脸'], note: '井台的石沿湿了一块。' },
];
function roomNoteRuleFor(action) {
  const hay = [action && action.cmd, ...((action && action.keywords) || [])].filter(Boolean).join('|');
  if (!hay) return null;
  return ROOMNOTE_RULES.find(r => r.keys.some(k => hay.indexOf(k) >= 0)) || null;
}
/* 写入点：只在房间 action 执行成功后调（三条成功路径共用这一份） */
function writeRoomNote(ctx, action) {
  const p = ctx.player, w = ctx.world;
  const rule = roomNoteRuleFor(action);
  if (!rule) return;
  if (!evalCond('!combat', ctx)) return;
  if (!p.roomNotes) p.roomNotes = {};
  p.roomNotes[p.room] = rule.note;
}

module.exports = {
  buildCommands, findPath, cnNum, DIRECTIONS, DIR_CN,
  /* 物品类型/装备属性的中文名（唯一一份）—— engine 的 modmaker 数据面也读它 */
  ITEM_TYPE_CN, EQUIP_STAT_CN, typeCN, statCN,
  /* 「询问」配套：话题写法归一化 + 他认识的人 + 问起那人他怎么说。
     前端人名清单与后端回答**共用这一份**，别在 UI 里再写一份名单。 */
  normalizeAskList, npcKnownPeople, npcAboutPerson,
  /* ambient 动态句取句（design/77 §2.0.3）——守卫 tools/ambient-check.js 直接测这份 */
  ambientLine,
  /* R4 roomNotes（design/85）——守卫直接测这份（规则表 + 匹配 + 写入） */
  ROOMNOTE_RULES, roomNoteRuleFor, writeRoomNote,
  /* 身份标签 / 关系称谓：导出给测试与其它模块用（见 tools/identity-check.js） */
  __api: {
    npcIdentity, relKindCN, tagCN, JOB_CN, TAG_CN, REL_KIND_CN, relFavorBetween, fmtRelFavor, REL_FAVOR_BASE,
    /* 熟练度档位 + 洞察门槛：NPC 详情面板要跟「看人」显示同一口径，
       各写一份迟早漂移（`ui.js` 的武学面板也读它）。 */
    skillTierCN, npcInsight,
  },
};
