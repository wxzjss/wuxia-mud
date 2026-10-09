/* ============================================================
 * gen-social.js — 为 40_npcs.json 补全「社交 / 生态」字段
 *
 * 目标：让每个 NPC 都有
 *   - 独立姓名（已存在则保留）
 *   - home        家园（自有房产的房间 id；特殊 NPC 无家）
 *   - social      人际关系（亲 / 友 / 仇 / 师 / 生 / 夫妻）
 *   - likes       喜爱的物品类型（书画 / 瓷器 / 书籍 / 酒 / 首饰 …）
 *   - favorBase   好感难度（不同 NPC 初始好感与难易不同）
 *   - schedule    作息（不同时段在不同房间）
 *   - teach       可请教武学（按自身 learned 推导）
 *   - favorToLearn 请教门槛好感
 *   - moneyToLearn 可花钱请教（部分 NPC）
 *   - sidequest   一条支线任务 id
 *   - pickpocket  可偷（身上带若干物品）
 *   - tag         身份标签（百姓 / 摊贩 / 书生 / 朝廷 / 青楼 / 农户 …）
 *
 * 只在「字段不存在」时补，不覆盖作者手写的内容。
 * 重新生成必须幂等：同样的种子 → 同样的结果。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NPC_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const MAP_FILE = path.join(ROOT, 'game', 'data', '50_map.json');
const ITEM_FILE = path.join(ROOT, 'game', 'data', '20_items.json');

/* ---------------- 可复现随机 ---------------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20261008);
const pick = arr => arr[Math.floor(rng() * arr.length)];
const pickN = (arr, n) => {
  const c = arr.slice(); const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]);
  return out;
};
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));

/* ---------------- 姓氏 / 名字素材 ---------------- */
const SURNAME = ('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫').split('');
const M_NAME = ('云飞扬 承志 天行 弘文 立诚 见山 明远 知节 守正 亦行 望舒 子谦 君实 仲卿 伯庸 元亮 景行 慕白 从简 若愚 怀瑾 修远 长风 苍梧 疏影 停舟 掬水 归鸿 过客 听涛 半山 秋声 倦客 枕流 采薇 踏雪 无咎 苇航 醒时 放舟').split(' ');
const F_NAME = ('清欢 若兰 疏桐 语冰 知秋 时雨 望舒 静姝 无双 拂衣 轻舟 明月 素问 半夏 青荷 灵犀 婉如 朝颜 逢春 南枝 拾月 落梅 秋水 凝霜 湘君 绿萼 红药 春晓 初霁 白露').split(' ');
const CHILD_NAME = ('阿宝 小满 狗蛋 丫头 阿吉 团团 石头 妞妞 阿福 喜儿 拴住 盼弟 铁头 丫丫').split(' ');

/* ---------------- 身份标签 ---------------- */
/* home: true  有家
   home: false 无家（真·居无定所：乞丐/流民/孩童依附家人/宫中人/风尘/游方者）
   其余身份默认有家 */
const TAGS = {
  commoner: { cn: '寻常百姓', home: true, money: [20, 300] },
  vendor: { cn: '市井摊贩', home: true, money: [60, 600] },
  scholar: { cn: '书生', home: true, money: [80, 500] },
  farmer: { cn: '农户', home: true, money: [30, 260] },
  smith: { cn: '铁匠', home: true, money: [200, 900] },
  doctor: { cn: '郎中', home: true, money: [150, 800] },
  innkeeper: { cn: '客栈掌柜', home: true, money: [400, 1600] },
  waiter: { cn: '店小二', home: true, money: [20, 120] },
  merchant: { cn: '商贾', home: true, money: [800, 4000] },
  richman: { cn: '富户', home: true, money: [1500, 6000] },
  groom: { cn: '车夫', home: true, money: [30, 180] },
  child: { cn: '孩童', home: true, money: [0, 10] },
  beggar: { cn: '乞丐', home: false, money: [0, 5] },
  refugee: { cn: '流民', home: false, money: [0, 15] },
  escort: { cn: '镖师', home: true, money: [300, 1200] },
  constable: { cn: '捕快', home: true, money: [200, 700] },
  official: { cn: '官员', home: true, money: [800, 3000] },
  eunuch: { cn: '太监', home: false, money: [500, 2500] },
  palace: { cn: '宫人', home: false, money: [50, 300] },
  consort: { cn: '妃嫔', home: false, money: [1000, 5000] },
  courtesan: { cn: '风尘女子', home: false, money: [200, 1500] },
  madam: { cn: '老鸨', home: true, money: [2000, 8000] },
  singer: { cn: '乐伎', home: false, money: [100, 800] },
  swordsman: { cn: '侠客', home: true, money: [200, 1000] },
  thief: { cn: '盗贼', home: true, money: [50, 400] },
  hunter: { cn: '猎户', home: true, money: [40, 300] },
  monk: { cn: '僧人', home: true, money: [10, 100] },
  nun: { cn: '尼姑', home: true, money: [10, 100] },
  taoist: { cn: '道人', home: true, money: [10, 150] },
  actor: { cn: '戏子', home: true, money: [60, 400] },
  boatman: { cn: '船夫', home: true, money: [40, 260] },
  gambler: { cn: '赌徒', home: true, money: [10, 500] },
  waiter2: { cn: '茶博士', home: true, money: [40, 240] },
};
const TAG_KEYS = Object.keys(TAGS);

/* ---------------- 喜爱物类型 ---------------- */
/* type: 对应的物品 tag / 名称关键词，送礼时用来判定「投其所好」 */
const LIKE_TYPES = [
  { id: 'painting', cn: '名画', items: ['painting_landscape', 'painting_bird', 'scroll_famous'], bonus: 1.0 },
  { id: 'porcelain', cn: '瓷器', items: ['porcelain_vase', 'porcelain_bowl', 'celadon_jar'], bonus: 1.0 },
  { id: 'book', cn: '书籍', items: ['book_poem', 'book_classic', 'book_strategy'], bonus: 0.9 },
  { id: 'jade', cn: '玉器', items: ['jade_pendant', 'jade_talisman'], bonus: 1.0 },
  { id: 'wine', cn: '美酒', items: ['wine_jar', 'wine_bamboo', 'wine_song'], bonus: 0.8 },
  { id: 'tea', cn: '好茶', items: ['tea_longjing', 'tea_puer'], bonus: 0.8 },
  { id: 'jewelry', cn: '首饰', items: ['silver_hairpin', 'gold_bangle', 'pearl_earring'], bonus: 1.0 },
  { id: 'incense', cn: '香料', items: ['incense_agarwood', 'sachet_silk'], bonus: 0.7 },
  { id: 'weapon', cn: '兵刃', items: ['fine_sword', 'steel_blade', 'iron_spear'], bonus: 0.9 },
  { id: 'herb', cn: '药材', items: ['herb_lingzhi', 'herb_ginseng', 'herb_snowlotus'], bonus: 0.8 },
  { id: 'food', cn: '吃食', items: ['steamed_bun', 'mooncake', 'candied_fruit'], bonus: 0.6 },
  { id: 'music', cn: '乐器', items: ['guqin', 'jade_flute', 'pipa'], bonus: 0.9 },
  { id: 'toy', cn: '玩物', items: ['clay_figure', 'wood_whistle', 'kite_swallow'], bonus: 0.6 },
  { id: 'makeup', cn: '胭脂', items: ['rouge_box', 'face_powder'], bonus: 0.8 },
];
const LIKE_IDS = LIKE_TYPES.map(l => l.id);

/* 身份 → 偏好的物品类型（带权重；重复出现 = 权重高） */
const TAG_LIKES = {
  commoner: ['food', 'food', 'wine', 'tea', 'toy'],
  vendor: ['wine', 'food', 'tea', 'jade', 'porcelain'],
  scholar: ['book', 'book', 'painting', 'tea', 'incense', 'music'],
  farmer: ['food', 'food', 'wine', 'toy'],
  smith: ['wine', 'wine', 'weapon', 'food'],
  doctor: ['herb', 'herb', 'book', 'tea'],
  innkeeper: ['wine', 'wine', 'food', 'porcelain', 'jade'],
  waiter: ['food', 'wine', 'toy'],
  merchant: ['jade', 'porcelain', 'painting', 'wine', 'jewelry'],
  richman: ['painting', 'painting', 'porcelain', 'jade', 'jewelry', 'music'],
  groom: ['wine', 'food', 'toy'],
  child: ['toy', 'toy', 'food', 'food'],
  beggar: ['food', 'food', 'food', 'wine'],
  refugee: ['food', 'food', 'food'],
  escort: ['weapon', 'wine', 'wine', 'food'],
  constable: ['wine', 'weapon', 'food'],
  official: ['painting', 'porcelain', 'jade', 'incense', 'tea'],
  eunuch: ['jewelry', 'jade', 'porcelain', 'incense'],
  palace: ['makeup', 'jewelry', 'food'],
  consort: ['jewelry', 'jewelry', 'makeup', 'music', 'porcelain', 'painting'],
  courtesan: ['jewelry', 'makeup', 'music', 'jade', 'incense'],
  madam: ['jade', 'jewelry', 'wine', 'porcelain'],
  singer: ['music', 'music', 'makeup', 'jewelry'],
  swordsman: ['weapon', 'weapon', 'wine', 'book'],
  thief: ['jade', 'jewelry', 'wine'],
  hunter: ['weapon', 'food', 'wine'],
  monk: ['incense', 'tea', 'book'],
  nun: ['incense', 'tea', 'book'],
  taoist: ['incense', 'herb', 'tea', 'music'],
  actor: ['music', 'wine', 'makeup'],
  boatman: ['wine', 'food', 'tea'],
  gambler: ['wine', 'jade', 'jewelry'],
  waiter2: ['tea', 'tea', 'porcelain', 'food'],
};

/* ---------------- 关系类型 ---------------- */
const REL_KINDS = ['亲', '友', '仇', '师', '生', '夫妻'];

/* ---------------- 支线任务池（生成用） ---------------- */
/* 每个 NPC 一条支线：结构 = { id, name, level, type:'支线', giver, desc, stages, rewards } */
const SIDE_TPL = [
  { key: 'errand', cn: '送信', desc: '托你把一封信送到%s手上。', stages: ['把信送到%s手上', '回去复命'] },
  { key: 'find', cn: '寻人', desc: '让你帮忙找一位久未联系的旧识%s。', stages: ['在%s一带打听消息', '找到%s，把话带到'] },
  { key: 'fetch', cn: '采买', desc: '要你替他跑腿买些日用杂货。', stages: ['去集市买些日用杂货', '把东西交回给%s'] },
  { key: 'herb', cn: '采药', desc: '家里有人病了，缺一味药。', stages: ['去山里采三株%s', '把药材交回'] },
  { key: 'beast', cn: '除害', desc: '近来有野兽作乱，请你出手。', stages: ['杀掉%s', '回去报信'] },
  { key: 'debt', cn: '讨债', desc: '有笔旧账要不回来，想请你出面。', stages: ['找到欠债的%s', '把债讨回来'] },
  { key: 'lost', cn: '寻物', desc: '丢了件要紧物事，急得团团转。', stages: ['在%s附近找找', '把东西交还'] },
  { key: 'escort', cn: '护送', desc: '要出趟远门，路上不太平。', stages: ['护送到%s', '平安抵达'] },
  { key: 'rumor', cn: '打探', desc: '想让你去打听一桩旧事。', stages: ['去%s打听', '回来告诉他打听到的'] },
  { key: 'avenge', cn: '了结', desc: '有桩恩怨压在心里多年。', stages: ['教训%s', '回来复命'] },
];

/* ---------------- 读取数据 ---------------- */
const npcDoc = JSON.parse(fs.readFileSync(NPC_FILE, 'utf8'));
const mapDoc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const npcs = npcDoc.npcs;
const rooms = mapDoc.rooms;

/* 已有 NPC（作者手写，32 个）：只补缺字段，不动原有内容 */
const authored = Object.keys(npcs);

/* ---------------- 为已有 NPC 补社交字段 ---------------- */
function isHostileOrBeast(def) {
  if (def.hostile && /狼|虎|熊|蛇|猪|豹|兽/.test(def.name)) return true;
  if (/^mob_/.test(def.id)) return true;
  return false;
}

for (const id of authored) {
  const d = npcs[id];
  if (isHostileOrBeast(d)) continue;              // 野兽 / 山贼不参与社交
  if (d.socialDone) continue;                      // 幂等

  /* 身份标签 */
  if (!d.tag) {
    if (/皇帝/.test(d.name)) d.tag = 'official';
    else if (/妃|贵妃/.test(d.name)) d.tag = 'consort';
    else if (/太监/.test(d.name)) d.tag = 'eunuch';
    else if (/公主/.test(d.name)) d.tag = 'palace';
    else if (/丐|叫花/.test(d.name)) d.tag = 'beggar';
    else if (/掌门|大侠|剑客|侠/.test(d.name)) d.tag = 'swordsman';
    else if (/掌柜|老板/.test(d.name)) d.tag = 'innkeeper';
    else if (/小二/.test(d.name)) d.tag = 'waiter';
    else if (/铁匠/.test(d.name)) d.tag = 'smith';
    else if (/药|郎中|大夫/.test(d.name)) d.tag = 'doctor';
    else if (/商/.test(d.name)) d.tag = 'merchant';
    else if (/捕|差役/.test(d.name)) d.tag = 'constable';
    else if (/僧|和尚/.test(d.name)) d.tag = 'monk';
    else if (/尼/.test(d.name)) d.tag = 'nun';
    else if (/道/.test(d.name)) d.tag = 'taoist';
    else if (/神尼/.test(d.name)) d.tag = 'nun';
    else if (/书生|秀才|先生/.test(d.name)) d.tag = 'scholar';
    else d.tag = 'swordsman';
  }

  /* 喜爱物类型 */
  if (!d.likes) {
    const pool = TAG_LIKES[d.tag] || ['food', 'wine', 'tea'];
    d.likes = [...new Set(pickN(pool, 2))];
  }

  /* 好感难度 / 初始好感 */
  const hardTags = { official: 0.35, consort: 0.3, eunuch: 0.4, monk: 0.5, nun: 0.5, taoist: 0.5, madam: 0.45, richman: 0.5, swordsman: 0.6, beggar: 1.4, child: 1.6, farmer: 1.2, commoner: 1.2, waiter: 1.3, refugee: 1.5 };
  if (d.favorBase === undefined) d.favorBase = hardTags[d.tag] !== undefined ? hardTags[d.tag] : 0.8;
  if (d.favorInit === undefined) d.favorInit = Math.round(int(-5, 15) * d.favorBase);

  /* 可请教武学（按自身 learned） */
  if (!d.teach && d.learned) {
    const t = Object.keys(d.learned).filter(sid => sid !== 'basic_fist');
    if (t.length) d.teach = t;
  }
  if (d.teach && d.favorToLearn === undefined) {
    d.favorToLearn = Math.round(int(40, 75) * (0.6 + d.favorBase * 0.6));
  }
  /* 部分 NPC 可花钱请教 */
  if (d.teach && d.moneyToLearn === undefined && ['swordsman', 'smith', 'escort', 'constable', 'hunter'].includes(d.tag)) {
    d.moneyToLearn = Math.round(int(200, 900) * (d.level || 20) / 20);
  }

  /* 身上财物（可偷） */
  if (!d.carry) d.carry = { money: Math.round((d.money || 0)), items: [] };

  /* 作息：白天在原房间，夜里回家（若有家） */
  if (!d.schedule && d.home) {
    d.schedule = { day: d.room, night: d.home };
  }

  d.socialDone = true;
}

/* ---------------- 生成新 NPC（补到 320 个） ---------------- */
const TARGET = 320;
const nowCount = Object.keys(npcs).length;
const toAdd = Math.max(0, TARGET - nowCount);

/* 需要一个「家」房间池：找带名字的民居 / 客栈 / 宅院 */
const homePool = Object.keys(rooms).filter(rid => {
  const r = rooms[rid];
  return /宅|院|府|居|屋|房|家|客栈|铺|庄/.test(r.name) && r.region !== 'wild';
});
/* 兜底：所有非野外房间都能当住处 */
const fallbackHomes = Object.keys(rooms).filter(rid => rooms[rid].region !== 'wild' && rooms[rid].region !== 'secret');
const homeChoices = homePool.length ? homePool : fallbackHomes;

/* 公共场所池（NPC 白天出现在这里） */
const publicPool = Object.keys(rooms).filter(rid => {
  const r = rooms[rid];
  if (r.region === 'wild' || r.region === 'secret') return false;
  return !/宅|院|府|居|屋|房|家/.test(r.name);
});

/* 按房间名 + 区域名一起判断场所类型 */
function placeKind(name, region, regionCN) {
  const s = name + ' ' + (regionCN || '') + ' ' + (region || '');
  if (/市集|集市|街市/.test(s)) return 'market';
  if (/客栈|酒楼|茶馆|茶楼|饭|店/.test(s)) return 'inn';
  if (/书院|书斋|藏经|藏书|文|学/.test(s)) return 'school';
  if (/衙门|府衙|牢|狱|官/.test(s)) return 'gov';
  if (/寺|庙|观|庵|祠/.test(s)) return 'temple';
  if (/宫|殿|苑|御/.test(s)) return 'palace';
  if (/镖|武馆|教场|校场|演武|练武/.test(s)) return 'martial';
  if (/田|农|庄|村|舍|坡/.test(s)) return 'farm';
  if (/渡|码头|船|江|河|湖|海|溪|桥/.test(s)) return 'water';
  if (/楼|阁|院|轩|榭/.test(s)) return 'tower';
  return 'other';
}
const placePool = {};
const regionCNMap = {};
for (const rid of Object.keys(rooms)) {
  const r = rooms[rid];
  const rc = (mapDoc.regions && mapDoc.regions[r.region] && mapDoc.regions[r.region].name) || '';
  regionCNMap[rid] = rc;
}
for (const rid of publicPool) {
  const k = placeKind(rooms[rid].name, rooms[rid].region, regionCNMap[rid]);
  (placePool[k] = placePool[k] || []).push(rid);
}
/* 身份 → 优先场所类型（依次回退） */
const TAG_PLACE = {
  commoner: ['market', 'other', 'inn'],
  vendor: ['market', 'market', 'other'],
  scholar: ['school', 'tower', 'other'],
  farmer: ['farm', 'other', 'market'],
  smith: ['martial', 'other', 'market'],
  doctor: ['market', 'other', 'tower'],
  innkeeper: ['inn', 'inn', 'other'],
  waiter: ['inn', 'inn', 'market'],
  merchant: ['market', 'other', 'tower'],
  richman: ['tower', 'other', 'market'],
  groom: ['market', 'water', 'other'],
  child: ['market', 'other', 'inn'],
  beggar: ['market', 'other', 'temple'],
  refugee: ['other', 'market', 'water'],
  escort: ['martial', 'inn', 'other'],
  constable: ['gov', 'market', 'other'],
  official: ['gov', 'gov', 'palace'],
  eunuch: ['palace', 'palace', 'gov'],
  palace: ['palace', 'palace', 'other'],
  consort: ['palace', 'palace', 'tower'],
  courtesan: ['tower', 'tower', 'other'],
  madam: ['tower', 'tower', 'other'],
  singer: ['tower', 'tower', 'inn'],
  swordsman: ['martial', 'other', 'inn'],
  thief: ['market', 'other', 'inn'],
  hunter: ['farm', 'water', 'other'],
  monk: ['temple', 'temple', 'other'],
  nun: ['temple', 'temple', 'other'],
  taoist: ['temple', 'temple', 'other'],
  actor: ['tower', 'inn', 'market'],
  boatman: ['water', 'water', 'other'],
  gambler: ['inn', 'market', 'other'],
  waiter2: ['inn', 'inn', 'market'],
};
/* 每个房间最多放几个「白天NPC」——超了就顺延到下一个候选房间 */
const ROOM_CAP = 6;
const roomLoad = {};
const placeCursor = {};
function placeFor(tag, seed) {
  const prefs = (TAG_PLACE[tag] || ['other', 'market', 'inn']).concat(['other', 'market', 'inn']);
  /* 依次尝试：同类场所里找没满的，且每次从不同位置起步以打散 */
  for (const p of prefs) {
    const arr = placePool[p];
    if (!arr || !arr.length) continue;
    const cur = placeCursor[p] = (placeCursor[p] === undefined ? seed : placeCursor[p] + 1);
    for (let i = 0; i < arr.length; i++) {
      const rid = arr[(cur + i) % arr.length];
      if ((roomLoad[rid] || 0) < ROOM_CAP) {
        roomLoad[rid] = (roomLoad[rid] || 0) + 1;
        placeCursor[p] = (cur + i + 1);
        return rid;
      }
    }
  }
  /* 全满：兜底放公共池里人最少的 */
  const rid = publicPool.slice().sort((a, b) => (roomLoad[a] || 0) - (roomLoad[b] || 0))[0];
  if (rid) { roomLoad[rid] = (roomLoad[rid] || 0) + 1; return rid; }
  return publicPool.length ? publicPool[0] : Object.keys(rooms)[0];
}

const newNpcs = {};
const usedNames = new Set(Object.values(npcs).map(n => n.name));

function mkName(gender, isChild) {
  for (let t = 0; t < 200; t++) {
    let nm;
    if (isChild) nm = pick(CHILD_NAME);
    else if (rng() < 0.35) nm = pick(SURNAME) + pick(gender === 'female' ? F_NAME : M_NAME);
    else nm = pick(SURNAME) + pick(gender === 'female' ? F_NAME : M_NAME).slice(0, 1);
    if (!usedNames.has(nm)) { usedNames.add(nm); return nm; }
  }
  let nm = pick(SURNAME) + pick(M_NAME);
  while (usedNames.has(nm)) nm += '氏';
  usedNames.add(nm);
  return nm;
}

let n = 0;
while (n < toAdd) {
  const tag = TAG_KEYS[n % TAG_KEYS.length];
  const info = TAGS[tag];
  const isChild = tag === 'child';
  const gender = isChild
    ? (rng() < 0.5 ? 'male' : 'female')
    : (['courtesan', 'singer', 'consort', 'palace', 'nun', 'madam'].includes(tag) ? 'female'
      : (rng() < 0.5 ? 'male' : 'female'));

  const id = 'npcv_' + String(n + 1).padStart(3, '0');
  const name = mkName(gender, isChild);
  const home = info.home && homeChoices.length ? pick(homeChoices) : null;
  /* 白天出现的地点：按身份去对应的场所，同类内轮转（避免挤在一处） */
  const room = placeFor(tag, n + (n % 3) * 7);
  const level = isChild ? int(1, 4) : int(3, 45);
  const money = int(info.money[0], info.money[1]);

  const likes = [...new Set(pickN(TAG_LIKES[tag] || ['food', 'wine'], isChild ? 2 : int(1, 2)))];

  const def = {
    id,
    name,
    gender,
    tag,
    desc: descFor(tag, gender, isChild),
    room,
    home: home || undefined,
    level,
    hp: 60 + level * 14,
    atk: 4 + level * 2,
    def: 2 + level * 1.6,
    dodge: 5 + level,
    speed: 10 + Math.floor(level / 2),
    money,
    hostile: false,
    likes,
    favorBase: hardTags2(tag, rng),
    favorInit: 0,
    carry: { money: Math.round(money * 0.5), items: [] },
    talk: talkFor(tag, gender),
    socialDone: true,
  };
  if (def.favorBase !== undefined) def.favorInit = Math.round(int(-5, 15) * def.favorBase);
  if (home) def.schedule = { day: room, night: home };
  if (info.home && !home) delete def.home;

  /* 孩童 / 乞丐 / 流民没有家园 */
  if (!info.home) { delete def.home; delete def.schedule; }

  newNpcs[id] = def;
  n++;
}

function hardTags2(tag) {
  const m = { official: 0.35, consort: 0.3, eunuch: 0.4, monk: 0.5, nun: 0.5, taoist: 0.5, madam: 0.45, richman: 0.5, swordsman: 0.6, beggar: 1.4, child: 1.6, farmer: 1.2, commoner: 1.2, waiter: 1.3, refugee: 1.5 };
  return m[tag] !== undefined ? m[tag] : 0.8;
}

function descFor(tag, gender, isChild) {
  const g = gender === 'female' ? '她' : '他';
  if (isChild) return '一个总角小孩，扎着两个冲天辫，看见生人也不怕，睁着圆眼睛打量你。';
  const M = {
    commoner: '寻常人家的汉子，袖口磨得发白，见人先笑，是那种过日子的老实人。',
    vendor: '守着个小摊，嗓门亮堂，一边招呼客人一边拿眼睛瞟着街面上的人来人往。',
    scholar: '一袭青衫，手里总攥着半卷书，走路都在默诵，身上的墨香比酒香重。',
    farmer: '皮肤晒成酱色，手掌粗糙开裂，肩上的扁担压出了深深的印子。',
    smith: '赤着上身，肌肉虬结，胳膊上烫着几处旧疤，抡起锤来虎口生风。',
    doctor: '须发花白，背着个旧药箱，指节修长，闻着就是一身的药香。',
    innkeeper: '站在柜台后头，算盘打得飞响，眼睛却把整间大堂看得清清楚楚。',
    waiter: '肩上搭着条白巾，脚下生风，一碗汤端过来洒不出半滴。',
    merchant: '绫罗绸缎裹着个圆滚滚的身板，手指上套着枚大金戒。',
    richman: '衣料考究，腰上别块好玉，浑身上下都写着「不缺钱」三个字。',
    groom: '蹲在车辕上打盹，听见有人走近立刻睁眼，咧嘴一笑。',
    escort: '腰背挺直，虎口有厚茧，一双手始终没离开过刀柄。',
    constable: '身着皂衣，腰悬铁尺，走路带着三分官气。',
    official: '一身绛色官袍，脚下步子不快，却每一步都踏得极稳。',
    eunuch: '面白无须，声音又尖又细，眼珠子转得飞快。',
    palace: '宫装素净，低眉顺眼，走路时裙裾几乎不扬。',
    consort: '云鬓珠翠，一身的绫罗，眼波流转间自有几分矜贵。',
    madam: '徐娘半老，风韵犹存，手里的团扇摇一下就知道又打起了什么算盘。',
    swordsman: '身形挺拔，佩剑在腰，眼神利得像刚开过刃。',
    thief: '缩着肩膀，穿一身不起眼的旧衣，眼睛却不住地往人腰间瞟。',
    hunter: '背着弓，兽皮靴上还沾着山里的泥。',
    monk: '一身灰僧袍，眉心一颗红痣，走到哪都在念经。',
    nun: '缁衣芒鞋，面容清寂，言谈间不沾半点烟火。',
    taoist: '鹤氅云履，背负长剑，飘飘然有出尘之态。',
    actor: '描了眉画了眼，衣上的水袖长得出奇，说话带着股唱腔。',
    boatman: '一身腥气，赤脚踩在船板上，撑篙的手极其稳当。',
    gambler: '眼窝发青，手指泛黄，一看就是熬了通宵的。',
    waiter2: '守着茶炉，一手提着长嘴壶，隔老远就能把水续进碗里。',
  };
  return M[tag] || M.commoner;
}

function talkFor(tag, gender) {
  const g = gender === 'female' ? '妾身' : '小的';
  const M = {
    commoner: ['这年头日子难过，客官您可别见怪。', '您也是赶路的？前头有家铺子，东西实惠。'],
    vendor: ['看看货吧！都是顶好的，便宜卖您！', '客官慢走，回头再来啊！'],
    scholar: ['书中自有黄金屋，可惜如今这世道，读书人也难。', '兄台可有见教？在下愿闻其详。'],
    farmer: ['今年雨水好，收成该是不错的。', '地里的活儿忙，客官自便。'],
    smith: ['要打什么？刀枪剑戟，我这儿都成。', '此锤落下去，就是三分火候。'],
    doctor: ['身子可有不适？我这儿有药。', '病来如山倒，去如抽丝啊。'],
    innkeeper: ['住店还是打尖？楼上雅间还空着。', '咱们这儿的黄酒，方圆十里都认。'],
    waiter: ['客官里边请！来点什么？', '汤来了——小心烫！'],
    merchant: ['这货是打南边来的，一路上担惊受怕。', '生意难做啊，客官若有意，价钱好商量。'],
    richman: ['哼，这年月，钱倒是越来越不值钱了。', '你若是来借钱的，那便请回吧。'],
    groom: ['客官要车么？衙门、码头，哪儿都去。', '坐稳咯——走嘞！'],
    escort: ['这趟镖，是不能出岔子的。', '刀口舔血的营生，图个痛快。'],
    constable: ['站住，干什么的？', '衙门口正缺人手，你要不也来试试？'],
    official: ['公务繁忙，闲人免进。', '此事本官自会处置。'],
    eunuch: ['咱家忙着呢，有事快说。', '噤声！这话也是你能问的？'],
    palace: ['（她低着头快步走过，没有应声）'],
    consort: ['你是什么人？也敢在此处走动。', '宫里的事，不是你能打听的。'],
    madam: ['哎哟，这位爷，可是稀客！', '咱们楼里的姑娘，个个都是出挑的。'],
    swordsman: ['拔剑吧——若是打得过我，便与你交个朋友。', '江湖路远，各自珍重。'],
    thief: ['看什么看？我什么都没干！', '（他侧了侧身，把你和你的钱袋隔开）'],
    hunter: ['山里的东西，我熟。要什么皮子？', '前日见着头鹿，可惜没打着。'],
    monk: ['阿弥陀佛，施主与佛有缘。', '一切有为法，如梦幻泡影。'],
    nun: ['施主留步。', '尘缘未了，何必强求。'],
    taoist: ['道法自然。', '贫道观你气色，近来恐有口舌。'],
    actor: ['（他甩了个水袖，唱了半句就停了）', '这出戏，还没到最好看的时候呢。'],
    boatman: ['过江么？船钱两文。', '风大，站稳咯。'],
    gambler: ['来来来，押大押小？', '今天手气背，输光了。'],
    waiter2: ['客官喝茶？上好的龙井。', '您慢慢坐，壶里水没了喊一声。'],
  };
  return M[tag] || ['（他打量了你一眼，没有多说。）'];
}

/* 合并 */
for (const id of Object.keys(newNpcs)) npcs[id] = newNpcs[id];

/* ---------------- 人际关系：为所有社交 NPC 建网 ---------------- */
/* 规则：
 *   - 同房间 / 同区域的 NPC 更可能认识
 *   - 家人（同 home）→ 亲
 *   - 随机抽 1~2 个 → 友
 *   - 少数 → 仇
 *   - 有 teach 的高等级 NPC → 可能有 师/生
 *   - 已婚的挂 夫妻（第一批先留空，结婚系统批次再填）
 */
const socialIds = Object.keys(npcs).filter(id => npcs[id].socialDone && !isHostileOrBeast(npcs[id]));
const byRoom = {};
for (const id of socialIds) {
  const r = npcs[id].room;
  (byRoom[r] = byRoom[r] || []).push(id);
}
const byHome = {};
for (const id of socialIds) {
  const h = npcs[id].home;
  if (h) (byHome[h] = byHome[h] || []).push(id);
}

/* ---------------- 补齐家园：除了真·居无定所的身份，人人有家 ----------------
 * ⚠ 必须放在 byHome 建好之后、人际关系循环之前。
 * 居无定所的：乞丐 / 流民 / 孩童 / 太监 / 宫人 / 秀女 / 风尘 / 歌伎
 */
const NO_HOME_TAGS = new Set(['beggar', 'refugee', 'child', 'eunuch', 'palace', 'consort', 'courtesan', 'singer']);
let homed = 0;
for (const id of socialIds) {
  const d = npcs[id];
  if (d.home) continue;
  if (NO_HOME_TAGS.has(d.tag)) continue;
  if (!homeChoices.length) break;
  d.home = pick(homeChoices);
  if (!d.schedule) d.schedule = { day: d.room, night: d.home };
  byHome[d.home] = (byHome[d.home] || []).concat([id]);
  homed++;
}

for (const id of socialIds) {
  const d = npcs[id];
  if (d.relDone) continue;
  const rel = [];
  const seen = new Set([id]);

  /* 家人：同 home */
  const fam = (byHome[d.home] || []).filter(x => x !== id);
  for (const f of pickN(fam, Math.min(fam.length, int(0, 2)))) {
    if (seen.has(f)) continue; seen.add(f);
    rel.push({ id: f, kind: '亲' });
  }

  /* 同房间的熟人 */
  const same = (byRoom[d.room] || []).filter(x => x !== id && !seen.has(x));
  for (const s of pickN(same, Math.min(same.length, int(1, 3)))) {
    if (seen.has(s)) continue; seen.add(s);
    rel.push({ id: s, kind: rng() < 0.75 ? '友' : '仇' });
  }

  /* 跨房间补一个「友」保证不孤单 */
  if (rel.length < 2) {
    const others = socialIds.filter(x => x !== id && !seen.has(x) && npcs[x].tag === d.tag);
    if (others.length) {
      const o = pick(others); seen.add(o);
      rel.push({ id: o, kind: '友' });
    }
  }

  d.rel = rel;
  d.relDone = true;
}

/* 反向补齐（A 认识 B，B 也认识 A） */
for (const id of socialIds) {
  const d = npcs[id];
  for (const r of (d.rel || [])) {
    const o = npcs[r.id];
    if (!o || !o.rel) continue;
    if (!o.rel.some(x => x.id === id)) o.rel.push({ id, kind: r.kind });
  }
}

/* ---------------- 支线任务：每个社交 NPC 一条 ---------------- */
const questDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), 'utf8'));
if (!questDoc.quests) questDoc.quests = {};
let qi = 0;
for (const id of socialIds) {
  const d = npcs[id];
  if (d.sidequest) continue;
  const tpl = SIDE_TPL[qi % SIDE_TPL.length];
  const qid = 'sq_' + id;
  const other = (d.rel && d.rel.length) ? npcs[d.rel[0].id] : null;
  const otherName = other ? other.name : '镇上的人';
  const targetRoom = other ? other.room : d.room;
  const stage0 = tpl.stages[0].replace('%s', otherName);
  const stage1 = tpl.stages[1].replace('%s', otherName);

  questDoc.quests[qid] = {
    id: qid,
    name: d.name + '的' + tpl.cn,
    level: Math.max(1, Math.floor((d.level || 5) * 0.8)),
    type: '支线',
    giver: id,
    desc: d.name + tpl.desc.replace('%s', otherName),
    stages: [
      {
        desc: stage0,
        targets: [{ id: 'go', kind: 'room', key: targetRoom, desc: stage0, count: 1, var: 'sq_' + id + '_go' }],
        cond: { var: 'sq_' + id + '_go' },
        next: 1,
      },
      { desc: stage1, next: 99 },
    ],
    rewards: [
      { type: '+exp', args: [60 + (d.level || 5) * 6] },
      { type: '+pot', args: [20 + (d.level || 5) * 2] },
      { type: 'favor', args: [id, 8] },
      { type: 'say', raw: d.name + '点点头：「多谢你了。」' },
    ],
  };
  d.sidequest = qid;
  qi++;
}

/* ---------------- 写回 ---------------- */
fs.writeFileSync(NPC_FILE, JSON.stringify(npcDoc, null, 2), 'utf8');
fs.writeFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), JSON.stringify(questDoc, null, 2), 'utf8');

const total = Object.keys(npcs).length;
const socialCount = socialIds.length;
console.log('NPC 总数：', total);
console.log('参与社交：', socialCount);
console.log('新增支线：', qi);
console.log('有家园：', socialIds.filter(i => npcs[i].home).length);
console.log('可请教：', socialIds.filter(i => npcs[i].teach).length);
console.log('花钱请教：', socialIds.filter(i => npcs[i].moneyToLearn).length);
console.log('有仇敌关系：', socialIds.filter(i => (npcs[i].rel || []).some(r => r.kind === '仇')).length);
