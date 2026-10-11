/* patch-mainline-act2.js —— SPRINT-C 第二幕总装脚本（一次跑完，顺序无关）
 *
 * 为什么要总装：四个补丁**互相依赖**，拆开跑必然有一半自检误报——
 *   · patch-act2-actions.js 的「撞见密会」依赖 flag `chongxu_split_task`
 *     ——那个 flag 由 patch-act2-quest.js 的阶段 effects 设
 *   · patch-act2-quest.js 的自检要确认 `know_xuemao` 有人设
 *     ——那个 flag 由 patch-act2-actions.js 的「追囚车」设
 *   · patch-mainline-npcs.js 要断言 NPC 挂的 `q_main_sect` 存在
 *     ——那任务由 patch-act2-quest.js 建
 * 拆开单跑就是「A 等 B 的产物、B 又等 A 的产物」的死锁。
 * 所以这里**全部在内存里改完，再做一次全局自检**，最后一次性落盘。
 *
 * 幂等：已存在就跳过，重跑安全。
 * run: node tools/patch-mainline-act2.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'game', 'data');
const BAK = path.join(__dirname, '_bak');
if (!fs.existsSync(BAK)) fs.mkdirSync(BAK, { recursive: true });

const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const itemsFile = rd('20_items.json');
const skillsFile = rd('10_skills.json');
const questsFile = rd('60_quests.json');
const mapFile = rd('50_map.json');
const npcFile = rd('40_npcs.json');

const items = itemsFile.items || itemsFile;
const rooms = mapFile.rooms;
const quests = questsFile.quests;
const npcs = npcFile.npcs;

/* 备份（只备一次） */
for (const [f, obj] of [['20_items.act2.json', itemsFile], ['10_skills.act2.json', skillsFile],
  ['60_quests.act2.json', questsFile], ['50_map.act2.json', mapFile], ['40_npcs.act2.json', npcFile]]) {
  const p = path.join(BAK, f);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(obj, null, 1));
}

const log = [];
const say = s => { log.push(s); console.log(s); };
const put = (obj, k, v, label) => {
  if (obj[k]) { say('· 已存在，跳过：' + (label || k)); return false; }
  obj[k] = v; say('+ ' + (label || k)); return true;
};

/* ═══════════════ 1. 物品 ═══════════════ */
put(items, 'xunchun_blade', {
  id: 'xunchun_blade', name: '绣春刀', type: 'weapon', slot: '武器',
  desc: '东厂制式佩刀，刀身薄得能透光。刀鞘上原有一块铜牌，被人生生削去了半边。',
  stats: { atk: 88, speed: 6 }, damage: 96, value: 9000, weaponType: '刀',
  maxDurability: 500, tags: ['weapon', 'tool'], quality: 'legend',
}, '物品 xunchun_blade（绣春刀）');
put(items, 'brocade_robe', {
  id: 'brocade_robe', name: '织金蟒袍', type: 'armor', slot: '身体',
  desc: '暗红织金，绣着五爪云龙。穿这身的人不用自己动手。',
  stats: { def: 18 }, attr: { '定力': 3 }, value: 8000, maxDurability: 160, quality: 'legend',
}, '物品 brocade_robe（织金蟒袍）');
put(items, 'depot_token_half', {
  id: 'depot_token_half', name: '半块东厂铜牌', type: 'accessory', slot: '饰品',
  desc: '断口是新的，像是被人一掌劈开。牌上有个「查」字，'
    + '字底压着一道极细的暗纹——那是厂里人才认得的记号。',
  stats: {}, value: 0, noSell: true, tags: ['mainline', 'clue'], quality: 'legend',
}, '物品 depot_token_half（半块东厂铜牌）');

/* ═══════════════ 2. 功法 ═══════════════ */
put(skillsFile.skills, 'xunchun_blade_art', {
  id: 'xunchun_blade_art', name: '绣春刀法', type: '刀', maxLevel: 800, difficulty: 4,
  desc: '东厂历代提督亲授的刀法。不求招式花巧，只求一刀比一刀快。',
  damageMult: 2.1, accuracy: 95, mpCost: 26, trainCost: 620, hits: 2,
  effects: [{ type: 'buff', name: '快手', turns: 2, mods: { speed: 30 } }],
  category: '旁门',
}, '功法 xunchun_blade_art（绣春刀法）');
put(skillsFile.skills, 'shadow_echo', {
  id: 'shadow_echo', name: '影分身', type: '拳', maxLevel: 800, difficulty: 5,
  desc: '不是分身，是让人看见分身。真正的拳还在原处。',
  damageMult: 1.7, accuracy: 97, mpCost: 40, trainCost: 700, dodgeBonus: 40,
  effects: [
    { type: 'buff', name: '匿影', turns: 3, mods: { dodge: 60 } },
    { type: 'cond', if: { chance: 0.34 }, then: [{ type: 'extraHit', value: 1 }] },
  ],
  category: '奇门',
}, '功法 shadow_echo（影分身）');
put(skillsFile.skills, 'imperial_order', {
  id: 'imperial_order', name: '圣旨纶音', type: '棍', maxLevel: 800, difficulty: 5,
  desc: '还没出声，先来一句「奉天承运」。听的人通常站不住。',
  damageMult: 1.5, accuracy: 88, mpCost: 60, trainCost: 760,
  effects: [
    { type: 'debuff', name: '跪', turns: 2, mods: { atk: -40, speed: -30 } },
    { type: 'buff', name: '天威', turns: 2, mods: { def: 40 } },
  ],
  category: '旁门',
}, '功法 imperial_order（圣旨纶音）');

/* ═══════════════ 3. 三个 NPC ═══════════════ */
put(npcs, 'depot_master', {
  id: 'depot_master', name: '冯保', title: '东厂提督', gender: 'male',
  tier: 'A', unique: true, tag: 'official', room: 'palace_hall',
  desc: '一个五十上下的瘦高男人，面白无须，指甲修得极干净。他从不提高嗓门，'
    + '但他每说一句话，殿上的人就要少活几个——十年里东西两厂换了七任提督，'
    + '他是唯一一个还坐着的。',
  level: 96, attr: { '力量': 72, '根骨': 66, '身法': 74, '悟性': 88 },
  hp: 7200, mp: 5200, atk: 610, def: 320, dodge: 210, speed: 108,
  hostile: true, leavesCorpse: false, money: 99999,
  expReward: 20000, potReward: 9000, moneyReward: 5000,
  equipment: { '武器': 'xunchun_blade', '身体': 'brocade_robe' },
  skills: { '刀': 'xunchun_blade_art' },
  learned: { xunchun_blade_art: { level: 720 } },
  carry: { money: 50000, items: ['depot_token_half', 'silk_robe'] },
  likes: ['jewelry', 'incense'], favorBase: -2, favorInit: 0, favorToLearn: 999, teach: [],
  talk: [
    '江湖上的事，朝廷管不了，我来管。',
    '你手里那块铜牌，是我给的。忘了？',
    '你不该活到今天。这不是狠话，是账。',
  ],
  socialDone: true, relDone: true, quests: [],
  rel: [
    { id: 'depot_shadow', kind: '友' },
    { id: 'bureau_clerk', kind: '友' },
    { id: 'shaolin_fangzheng', kind: '仇' },
  ],
  /* Boss 三阶段（战斗机制见 game/src/core/combat.js 的 bossPhaseTick） */
  bossPhases: [
    {
      at: 1.0, name: '绣春刀',
      line: '（冯保抽出刀，刀身薄得能透光。）「第一刀，是规矩。」',
      mult: { atk: 1.0, speed: 1.0 }, skill: 'xunchun_blade_art',
    },
    {
      at: 0.6, name: '影卫',
      line: '（他身后的影子一分为三，房梁上的三个不是人。）「你打的不是我。」',
      mult: { atk: 1.15, dodge: 0.9, speed: 1.2 }, skill: 'shadow_echo',
      summon: { npc: 'depot_shadow', count: 1 },
    },
    {
      at: 0.3, name: '圣旨',
      line: '（他退到龙案后，展开一卷黄绫。）「奉天承运——拿下。」',
      mult: { atk: 1.1, def: 1.35, speed: 1.1 }, skill: 'imperial_order',
    },
  ],
  portrait: {
    v: 1, tier: 'A', lock: false,
    role: '东厂提督，十年不倒的朝堂之手',
    origin: '先帝时他只是御前一个抄写文书的小官。字写得好，好到皇帝记住了名字，'
      + '也记住了他那双从不发抖的手。',
    now: '他替皇帝杀人，也替皇帝背锅。厂里换人像换衣裳，他一直穿着那件。',
    want: '他要的不是武功秘籍，是一本能写满名字的册子。秘籍只是饵，'
      + '他真正在收的是「谁在练什么」。',
    fear: '他怕死，更怕「无用」。一个没用的提督，比一个死了的提督死得更快。',
    secret: {
      text: '他早年也是江湖中人，在终南山下跟人学过三年刀。'
        + '他一生最不愿被人提起的，是那三年。',
      tier: 3, leakTo: ['shaolin_fangzheng'],
      ifLeaked: '方证大师听后会沉默很久，然后说：「原来他也是从山下来的。」',
    },
    obsession: '每天亲手抄一遍厂里的名单。字迹从不潦草，哪怕写到自己的名字。',
    feuds: [
      { id: 'shaolin_fangzheng', kind: '仇', why: '方证拒绝交出少林一份名册', since: '八年前' },
      { id: 'depot_shadow', kind: '友', why: '影子是他一手带出来的，比儿子还听话', since: '十二年' },
    ],
    voice: {
      tone: '慢，客气，每个字都像秤过的',
      catchphrase: '这笔账，我记下了。',
      taboo: ['失败', '情义', '当年'],
      style: '从不发怒；越轻描淡写越危险；偶尔用「我们」拉拢，用「你」逼问。',
    },
    routine: [
      { at: 'day', act: '在太和殿侧殿看折子，一份折子要看三遍' },
      { at: 'dusk', act: '走到天牢门口站一会儿，从不出来，只是站着' },
      { at: 'night', act: '灯下抄名单，抄到天亮，把纸一张张烧掉' },
    ],
    arc: {
      init: '漠然',
      warm: '不动声色地记下你的名字 +15；拿回铜牌不追究 +25',
      cold: '当众叫你的名字 −30；把你的名字写进名单 −60；抄家灭门 −100',
      break: '把他的名字捅到朝堂上，或让他那三年被江湖人知道',
    },
    hooks: [
      {
        id: 'hk_depot_master_token', title: '那三年', type: 'task',
        trigger: { 'var': 'trust_depot_master', op: '<=', value: 10 },
        seed: '他自己说漏了嘴：「我那三年学的是刀，不是杀人。」',
        rewardHint: '+主线推进；解锁 ending「半交」',
      },
    ],
    marks: ['东厂', '抄名单', '指甲干净', '终南三年'],
  },
}, 'NPC depot_master（冯保·东厂提督）');

put(npcs, 'depot_shadow', {
  id: 'depot_shadow', name: '影子', title: '影卫首领', gender: 'male',
  tier: 'A', unique: true, tag: 'eunuch', room: 'palace_road',
  desc: '你听见脚步，回头，什么也没有。地上有两道影子，其中一道不是你自己的。',
  level: 88, attr: { '力量': 60, '根骨': 66, '身法': 94, '悟性': 70 },
  hp: 4200, mp: 3800, atk: 520, def: 200, dodge: 320, speed: 140,
  hostile: true, leavesCorpse: false, money: 3000,
  expReward: 9000, potReward: 4000, moneyReward: 1500,
  skills: { '拳': 'shadow_echo' }, learned: { shadow_echo: { level: 660 } },
  likes: ['incense'], favorBase: -3, favorInit: 0, favorToLearn: 999, teach: [],
  talk: ['（他没有说话。他从不说话。）', '（他站的地方，正好在你退路上。）'],
  socialDone: true, relDone: true, quests: [],
  rel: [{ id: 'depot_master', kind: '友' }],
  bossPhases: [
    {
      at: 1.0, name: '随影',
      line: '（他没有动。你发现自己的影子先动了。）',
      mult: { atk: 1.0, dodge: 1.1, speed: 1.1 }, skill: 'shadow_echo',
    },
    {
      at: 0.5, name: '分影',
      line: '（三个影子从同一个影子里站起来。）',
      mult: { atk: 1.2, speed: 1.25 }, skill: 'shadow_echo',
    },
  ],
  portrait: {
    v: 1, tier: 'A', lock: false,
    role: '东厂影卫首领，提督的影子本身',
    origin: '没人知道他姓什么。冯保叫他影子，因为十二年前他在雪地里跟了冯保三天，'
      + '第四天才被看见。',
    now: '他是东厂里唯一不用报名字的人。名字是给活人用的。',
    want: '他要证明「影子比本体先到」。这是他唯一在意的事。',
    fear: '他怕天亮。天亮他就得站回墙根，而墙根没有影子可藏。',
    secret: {
      text: '他有自己的名字，写在冯保名单的第一页。冯保划掉了，但没有涂。',
      tier: 2, leakTo: ['depot_master'],
      ifLeaked: '冯保会沉默着把它重新写一遍——这次没划。',
    },
    obsession: '记录每一个他去过的地方，精确到「他在那里站了多久」。',
    feuds: [{ id: 'depot_master', kind: '友', why: '亦师亦父，也是他必须先到的那条线', since: '十二年' }],
    voice: {
      tone: '没有语气', catchphrase: '（他不出声。）', taboo: ['名字'],
      style: '全篇不说话；威胁用站位表达；他开口的那一次，就是最后的机会。',
    },
    routine: [
      { at: 'day', act: '在提督身后三步，跟着，不看两侧' },
      { at: 'dusk', act: '去一趟天牢，确认名单上的人还在' },
      { at: 'night', act: '在别人的窗外站到天亮，然后换下一个' },
    ],
    arc: {
      init: '无',
      warm: '不动声色地放慢半步 +20；把追你的路指反 +30',
      cold: '记住你的走路姿势 +40；揭穿你的轻功来路 +60',
      break: '叫出他的名字',
    },
    hooks: [
      {
        id: 'hk_shadow_name', title: '他的名字', type: 'encounter',
        trigger: { 'var': 'favor_depot_shadow', op: '>=', value: 40 },
        seed: '你叫出了那个名字。他站在原地，第一次没有动。',
        rewardHint: '+favor 50；可说服其倒戈（第五幕隐藏选项）',
      },
    ],
    marks: ['不说话', '站位', '天亮', '名字'],
  },
}, 'NPC depot_shadow（影子·影卫首领）');

put(npcs, 'bureau_clerk', {
  id: 'bureau_clerk', name: '胡录事', title: '书吏', gender: 'male',
  tier: 'B', tag: 'official', room: 'jn_yamen_office',
  desc: '一个在签押房里坐了十九年的老书吏，手上有常年握笔磨出的茧。'
    + '他抄过成千上万份公文，从没抄错过一个字——包括那份不该抄的名单。',
  level: 24, attr: { '力量': 30, '根骨': 34, '身法': 38, '悟性': 62 },
  hp: 620, atk: 62, def: 40, dodge: 44, speed: 40, money: 3400, hostile: false,
  equipment: { '身体': 'silk_robe' },
  likes: ['tea', 'book'], favorBase: 0.8, favorInit: 8, favorToLearn: 45,
  carry: { money: 2600, items: ['porcelain_teaset', 'steamed_bun'] },
  talk: [
    '客官，衙门重地，有事递牌子。',
    '……你说的是那份名单？那不是我抄的，我只是誊。',
    '（他压低了声音。）你若真想知道，就当今天没来过。',
  ],
  socialDone: true, relDone: true,
  rel: [
    { id: 'depot_master', kind: '仇' },
    { id: 'npcv_281', kind: '友' },
  ],
  quests: ['q_main_sect'],
  teach: ['basic_fist'], learned: { basic_fist: { level: 90 } },
  skills: { '拳': 'basic_fist' },
  age: 47, district: 'jiangnan', province: '江南道',
  home: 'house:bureau_clerk',
  /* ⚠️ schedule 只写**真实房间 id**；`house:xxx` 是「资助建家」体系的虚拟门牌，
     不能进 schedule（NPC 会被调度到一个不存在的房间）。夜里他仍在签押房——
     一个十九年没在自己家睡过几晚的书吏。 */
  schedule: { day: 'jn_yamen_office', night: 'jn_yamen_office' },
  portrait: {
    v: 1, tier: 'B', lock: false,
    role: '衙门签押房书吏，名单的经手人',
    origin: '十九年前他也是秀才，连考三次不中，回来接了父亲的笔。'
      + '他这辈子写得最好的一页，是那份他不该写的名单。',
    now: '他每天照常点卯、照常用茶、照常把公文抄完。只有笔洗得比别人干净。',
    want: '他想知道那份名单上的人，后来有几个还活着。',
    fear: '他怕自己被当成「经手人」——在这件事里，经手人比下令的人先死。',
    secret: {
      text: '他留了一份底档，藏在城西一间他自己都不常去的安全屋里。',
      tier: 2, leakTo: ['depot_master'],
      ifLeaked: '安全屋被封，胡录事失踪；名单底档流入东厂。',
    },
    obsession: '每天把「已办」「未办」两栏分得极清楚，即使没有人来查。',
    feuds: [{ id: 'depot_master', kind: '仇', why: '东厂要销毁底档，而底档是他十九年唯一的私心', since: '半年' }],
    voice: {
      tone: '谨慎、公事公办，一急就结巴',
      catchphrase: '我只是誊的。', taboo: ['名单', '东厂', '底档'],
      style: '答非所问；被逼到墙角时会突然变得非常诚实。',
    },
    routine: [
      { at: 'day', act: '在签押房誊文，笔尖蘸墨的节奏和更鼓一样准' },
      { at: 'dusk', act: '绕到城西看一眼那间安全屋，从不进去' },
      { at: 'night', act: '在家把当日抄过的字默写一遍，默完就睡' },
    ],
    arc: {
      init: '回避',
      warm: '请他喝酒 +15；替他挡一次追问 +25；说出「底档」二字 +40',
      cold: '当众递牌子 +5；威胁他家人 −40；把他名字报上去 −80',
      break: '让东厂知道底档存在',
    },
    hooks: [
      {
        id: 'hk_bureau_clerk_ledger', title: '底档', type: 'task',
        trigger: { 'var': 'favor_bureau_clerk', op: '>=', value: 40 },
        seed: '城西那间屋子他终于肯带你去了。屋里只有一张桌子，一本册子。',
        rewardHint: '+好感 40；获得「名单底档」→ 第二幕关键道具',
      },
    ],
    marks: ['十九年', '底档', '笔洗得干净', '不敢说'],
  },
}, 'NPC bureau_clerk（胡录事·书吏）');

/* 方证大师当第二幕的一个 giver（他要在少林能交差） */
for (const gid of ['wudang_chongxu', 'shaolin_fangzheng']) {
  const g = npcs[gid];
  if (!g) { problemsEarly('第二幕 giver 不存在：' + gid); continue; }
  g.quests = g.quests || [];
  if (g.quests.indexOf('q_main_sect') < 0) {
    g.quests.push('q_main_sect');
    say('+ ' + g.name + ' 挂上 q_main_sect');
  }
}
/* ⚠️ 冲虚**必须**挂：`交任务` 遍历的是 `npc.def.quests`，
   他 def.quests 里没这条 = 第一段「交铜牌」永远没人接（历史上主线卡死同款）。 */

/* ═══════════════ 4. 第二幕任务 ═══════════════ */
put(quests, 'q_main_sect', {
  id: 'q_main_sect',
  name: '【主线】门派之疑',
  level: 30, type: '主线', giver: 'wudang_chongxu',
  desc: '一个将死之人塞给你的半块铜牌，一个认得这标记的老道士。'
    + '东厂要抓人，为什么没人拦？——这一问，比打得过谁都难。',
  stages: [
    {
      desc: '把半块东厂铜牌带回武当，交给冲虚道长过目',
      cond: { flag: 'know_east_depot' }, next: 1,
    },
    {
      desc: '查清铜牌的来路：江南衙门签押房经手过这份名单',
      cond: { flag: 'clerk_met' }, next: 2,
    },
    {
      /* ⚠️ `chongxu_split_task` 在这里落 flag——少林/华山两个入口都以它为前置 */
      desc: '回武当复命，听冲虚分派：少林问方证大师，华山探门派内鬼',
      cond: { flag: 'clerk_met' },
      effects: [
        { type: 'narrate', raw: '「两处。」冲虚伸出两根手指，「少林问方证——他代表朝廷与武林的默契。华山你自己去看。」' },
        { type: 'say', raw: '「记住：看，不要问。」他说，「你若问出口，便再没有回头路。」' },
        { type: 'flag', args: ['chongxu_split_task'] },
      ],
      next: 3,
    },
    {
      desc: '少林大雄宝殿，问方证大师「朝廷与武林的默契」',
      cond: { flag: 'fangzheng_admitted' }, next: 4,
    },
    {
      desc: '华山撞见岳不群密会一个官服的人',
      cond: { flag: 'sect_inner_traitor' }, next: 5,
    },
    {
      desc: '抉择：把这事告诉冲虚，还是烂在肚子里',
      cond: { flag: 'choice_made' }, next: 6,
    },
    {
      desc: '北疆的消息：那批「犯人与行李」最后去了雪谷',
      cond: { flag: 'know_xuemao' }, next: 99,
    },
  ],
  rewards: [
    { type: '+exp', args: [8000] },
    { type: '+pot', args: [4000] },
    { type: '+title', args: ['风闻者'] },
    { type: 'flag', args: ['act2_done'] },
    { type: 'flag', args: ['sect_ashamed'] },
    { type: 'narrate', raw: '江湖很大，大得容得下两把刀。你学会了往哪一边站，也学会了代价是什么。' },
  ],
}, '任务 q_main_sect（门派之疑·7 段）');

/* 第一幕幕末：落 know_east_depot + 铜牌，并开启第二幕。
   ⚠️ 故事书 §2 第一幕 1-6 的幕末落点。不在这里落，第二幕第 0 段的 cond 永远 false
      ——这正是历史上主线卡死的套路。 */
{
  const a1 = quests.q_main_jianghu;
  if (!a1) problemsEarly('q_main_jianghu 不存在，无法接第二幕');
  else {
    a1.rewards = a1.rewards || [];
    const hasFlag = f => a1.rewards.some(r => (r.type === 'flag' || r.type === 'setflag') && r.args && r.args[0] === f);
    if (!hasFlag('know_east_depot')) {
      a1.rewards.push({ type: 'flag', args: ['know_east_depot'] });
      say('+ q_main_jianghu 奖励补 flag know_east_depot（第一幕幕末）');
    }
    if (!a1.rewards.some(r => (r.type === '+item' || r.type === 'item+') && r.args && r.args[0] === 'depot_token_half')) {
      a1.rewards.push({ type: 'narrate', raw: '那名将死之人塞给你的半块铜牌，还带着他掌心的汗。' });
      a1.rewards.push({ type: '+item', args: ['depot_token_half', 1] });
      say('+ q_main_jianghu 奖励补半块东厂铜牌');
    }
    if (!a1.rewards.some(r => r.type === 'quest' && r.args && r.args[0] === 'q_main_sect')) {
      a1.rewards.push({ type: 'quest', args: ['q_main_sect', 0] });
      say('+ q_main_jianghu 奖励接上第二幕 q_main_sect');
    }
  }
}

/* ═══════════════ 5. 房间 action（玩家能点的入口）═══════════════ */
function addAction(roomId, act) {
  const r = rooms[roomId];
  if (!r) { problemsEarly('房间不存在：' + roomId); return; }
  r.actions = r.actions || [];
  if (r.actions.some(a => a.cmd === act.cmd)) { say('· 已有 action，跳过：' + roomId + ' / ' + act.cmd); return; }
  r.actions.push(act);
  say('+ ' + r.name + ' → ' + act.cmd);
}

addAction('jn_yamen_office', {
  cmd: '翻名录', label: '翻那份名录',
  keywords: ['翻名录', '名录', '翻档案', '查名录'],
  cond: { flag: 'know_east_depot', notFlag: 'clerk_met' },
  failMsg: '你连那份名录长什么样都不知道，先弄清铜牌的来路。',
  effects: [
    { type: 'narrate', raw: '架子上那叠未销的公文，最上面一份纸边有新裁的毛口——像是从更长的东西上裁下来的。' },
    { type: 'narrate', raw: '「客官，衙门重地。」一个老书吏挡在你和公文之间。他手上有常年握笔磨出的茧。' },
    { type: 'say', raw: '「……你说的是那份名单？那不是我抄的，我只是誊。」' },
    { type: 'flag', args: ['clerk_met'] },
    { type: 'flag', args: ['met_bureau_clerk'] },
  ],
});
addAction('shaolin_daxiong', {
  cmd: '问方证', label: '问方证大师「朝廷与武林的默契」',
  keywords: ['问方证', '方证', '问默契', '默契'],
  cond: { flag: 'chongxu_split_task', notFlag: 'fangzheng_admitted' },
  failMsg: '你连冲虚让你去问什么都不清楚，就先去问人，未免太急。',
  effects: [
    { type: 'narrate', raw: '方证大师合掌，让你在下首第一位——那是留给「有资格问话的人」的位子。' },
    { type: 'say', raw: '「确有此事。」他说得很慢，「但老衲不能告诉你为何确有此事。」' },
    { type: 'narrate', raw: '你追问。他只是笑。然后他忽然问了一句不相干的：「少侠可曾听说，终南山下有人学过三年刀？」' },
    { type: 'narrate', raw: '你一时没答上来。他也不追问，只说了句「阿弥陀佛」，便低头念起了经。' },
    { type: 'flag', args: ['fangzheng_admitted'] },
    { type: 'flag', args: ['heard_term_nan_ties'] },
  ],
});
addAction('huashan_zhengqi', {
  cmd: '撞见密会', label: '绕到偏殿去看一眼',
  keywords: ['撞见密会', '偏殿', '密会', '偷看', '窥探'],
  cond: { flag: 'chongxu_split_task', notFlag: 'sect_inner_traitor' },
  failMsg: '你现在没有非要去华山看什么不可的理由。',
  effects: [
    { type: 'narrate', raw: '你绕到偏殿。门缝里透出的不是烛光，是一盏官灯。' },
    { type: 'narrate', raw: '岳不群的声音压得很低，听不清字句——但那人的官靴，看得清清楚楚。' },
    { type: 'narrate', raw: '你退开三步，脚下的砖响了。殿里的话声立刻停了。' },
    { type: 'flag', args: ['sect_inner_traitor'] },
    { type: 'flag', args: ['saw_yue_meet_official'] },
  ],
});
addAction('huashan_zhengqi', {
  cmd: '禀报冲虚', label: '回武当，把密会的事告诉冲虚',
  keywords: ['禀报冲虚', '告诉冲虚', '告发', '上报'],
  cond: { flag: 'sect_inner_traitor', notFlag: 'choice_made' },
  failMsg: '你还没见到什么可禀报的事。',
  effects: [
    { type: 'narrate', raw: '你把偏殿的官灯、官靴、一字不落地说了。冲虚听完，很久没有出声。' },
    { type: 'say', raw: '「你告诉我这件事，从今往后，华山派的事你不要再插手。」' },
    { type: 'narrate', raw: '——你换来的，是一句「不要再插手」。' },
    { type: 'flag', args: ['choice_tell_chongxu'] },
    { type: 'flag', args: ['choice_made'] },
  ],
});
addAction('huashan_zhengqi', {
  cmd: '按下不提', label: '回武当，把这事烂在肚子里',
  keywords: ['按下不提', '闭嘴', '不说', '保密'],
  cond: { flag: 'sect_inner_traitor', notFlag: 'choice_made' },
  failMsg: '你还没见到什么需要瞒的事。',
  effects: [
    { type: 'narrate', raw: '你把偏殿的事咽了回去。冲虚看你的眼神和从前一样，看不出多一分，也看不出少一分。' },
    { type: 'narrate', raw: '——你保住了「自己人」这三个字，也丢掉了它。' },
    { type: 'flag', args: ['choice_keep_silent'] },
    { type: 'flag', args: ['choice_made'] },
  ],
});
addAction('road_beijiang_1', {
  cmd: '追囚车', label: '追那辆往北去的囚车',
  keywords: ['追囚车', '囚车', '追车', '北上'],
  cond: { flag: 'choice_made', notFlag: 'know_xuemao' },
  failMsg: '你还不知道该往哪里追。',
  effects: [
    { type: 'narrate', raw: '你追上那辆车的时候，车夫正在路边生火煮东西。他不拦你，只是看着你。' },
    { type: 'narrate', raw: '「你不是官差。」他说，「官差不会追到这种地方。」' },
    { type: 'narrate', raw: '「那批人……没往北都城走。」他往西北指了指，「雪谷。新起了一座石堡。」' },
    { type: 'say', raw: '「前几日有个被押的人半路跑了。他让我带句话给你——他说他欠你一条命。」' },
    { type: 'flag', args: ['know_xuemao'] },
  ],
});

/* ═══════════════ 6. 全局自检 ═══════════════ */
const problems = [];
const problemsEarly = m => problems.push(m);

const skillIds = new Set(Object.keys(skillsFile.skills));
const itemIds = new Set(Object.keys(items));

/* 6a. 三个新 NPC 引用的东西都真实存在 */
for (const id of ['depot_master', 'depot_shadow', 'bureau_clerk']) {
  const n = npcs[id];
  if (!n) { problems.push('NPC 没落地：' + id); continue; }
  if (!rooms[n.room]) problems.push(id + ' 的 room 不存在：' + n.room);
  for (const k in (n.schedule || {})) if (!rooms[n.schedule[k]]) problems.push(id + ' 的 schedule.' + k + ' 不存在：' + n.schedule[k]);
  for (const k in (n.equipment || {})) if (!itemIds.has(n.equipment[k])) problems.push(id + ' 装备不存在：' + n.equipment[k]);
  for (const it of (n.carry || {}).items || []) if (!itemIds.has(it)) problems.push(id + ' 携带不存在：' + it);
  for (const k in (n.skills || {})) if (!skillIds.has(n.skills[k])) problems.push(id + ' 功法不存在：' + n.skills[k]);
  for (const ph of n.bossPhases || []) if (ph.skill && !skillIds.has(ph.skill)) problems.push(id + ' 阶段招不存在：' + ph.skill);
  for (const r of n.rel || []) if (!npcs[r.id]) problems.push(id + ' 的关系指向不存在的 NPC：' + r.id);
  for (const q of n.quests || []) if (!quests[q]) problems.push(id + ' 挂的任务不存在：' + q);
  if (/说到.+就/.test(n.desc || '')) problems.push(id + ' 的 desc 含模板句');
  if (/[�]/.test(n.desc || '')) problems.push(id + ' 的 desc 有乱码');
  /* bossPhases 的 at 必须递减（阶段是往下切的） */
  const ats = (n.bossPhases || []).map(p => p.at);
  for (let i = 1; i < ats.length; i++) if (ats[i] >= ats[i - 1]) problems.push(id + ' 的 bossPhases.at 没递减：' + ats.join(','));
}

/* 6b. 所有 cond.flag 都真有人设（悬空 flag = 任务永远走不通的经典死法）*/
const setFlags = new Set();
const walk = o => {
  if (!o || typeof o !== 'object') return;
  if ((o.type === 'flag' || o.type === 'setflag') && o.args && o.args[0]) setFlags.add(o.args[0]);
  for (const k in o) walk(o[k]);
};
for (const rid of Object.keys(rooms)) for (const a of rooms[rid].actions || []) walk(a.effects || []);
for (const qid of Object.keys(quests)) {
  walk(quests[qid].rewards || []);
  /* ⚠️ 别漏了 stages[].effects——`chongxu_split_task` 就在 q_main_sect 第 2 段落，
     漏收会被当成悬空 flag，两个入口（少林问方证/华山撞见密会）全部误报 */
  for (const st of quests[qid].stages || []) walk(st.effects || []);
}
for (const id of Object.keys(npcs)) walk(npcs[id]);
/* 由引擎/角色系统设的，不在数据里 */
const ENGINE_FLAGS = new Set(['killed_', 'learned_', 'visited_', 'questdone_', 'ending_', 'sq_', 'win_', 'lose_']);
for (const rid of Object.keys(rooms)) {
  for (const a of rooms[rid].actions || []) {
    const need = [];
    if (a.cond && a.cond.flag) need.push(a.cond.flag);
    for (const f of (a.cond && a.cond.flagsAll) || []) need.push(f);
    for (const f of need) {
      if (setFlags.has(f)) continue;
      if ([...ENGINE_FLAGS].some(p => f.indexOf(p) === 0)) continue;
      problems.push('房间 ' + rid + ' / ' + a.cmd + ' 依赖悬空 flag「' + f + '」');
    }
  }
}
for (const qid of Object.keys(quests)) {
  for (const st of quests[qid].stages || []) {
    const need = [];
    if (st.cond && st.cond.flag) need.push(st.cond.flag);
    for (const f of (st.cond && st.cond.flagsAll) || []) need.push(f);
    for (const f of need) {
      if (setFlags.has(f)) continue;
      if ([...ENGINE_FLAGS].some(p => f.indexOf(p) === 0)) continue;
      problems.push('任务 ' + qid + ' 依赖悬空 flag「' + f + '」');
    }
    if (st.cond && st.cond.room) for (const r of [].concat(st.cond.room)) if (!rooms[r]) problems.push('任务 ' + qid + ' cond.room 不存在：' + r);
    for (const t of st.targets || []) if (t.kind === 'room' && !rooms[t.key]) problems.push('任务 ' + qid + ' target.room 不存在：' + t.key);
  }
}

/* 6c. 第二幕阶段链首尾相接，幕末 flag 齐全 */
const a2 = quests.q_main_sect;
if (a2) {
  a2.stages.forEach((st, i) => {
    if (i === a2.stages.length - 1) return;
    const got = st.next === undefined ? i + 1 : st.next;
    if (got !== i + 1) problems.push('第二幕阶段 ' + i + ' 的 next=' + got + '，应为 ' + (i + 1));
  });
  if (a2.stages[a2.stages.length - 1].next !== 99) problems.push('第二幕最后一段 next 不是 99');
  if (!npcs[a2.giver]) problems.push('第二幕 giver 不存在：' + a2.giver);
  for (const f of ['sect_ashamed', 'know_xuemao']) if (!setFlags.has(f)) problems.push('幕末 flag 无人设置：' + f);
}
/* 6d. 第二幕的每一段 cond，都真有一个 action / giver 能推进它 */
for (const st of a2.stages || []) {
  const f = st.cond && st.cond.flag;
  if (!f) continue;
  if (!setFlags.has(f)) problems.push('第二幕阶段「' + st.desc + '」的 cond flag ' + f + ' 悬空');
}

/* ---- 顺手修 rank 语义：数据里 4 条 NPC 的 rank 写成了 1 基编号 ----
   `rank` 是 0 基下标（玩家升级走 sd.ranks[this.rank]），写成 1 基会让
   身份推断整体降一级。断言挂在 identity 推断后的真值上，别只查字段存在。 */
const RANK_FIX = { mob_mo_disciple: 1, beggar_info: 1, linghu: 2, nv_yue: 2 };
for (const [id, bad] of Object.entries(RANK_FIX)) {
  const n = npcs[id];
  if (!n) { problems.push('rank 修正目标不存在：' + id); continue; }
  if (n.rank !== bad) continue;  // 已被别的补丁改过就不动
  const sect = (sectsFile.sects || {})[n.sect];
  n.rank = bad - 1;
  console.log('* rank 归零基 ' + id + '（' + sect + '：' + bad + '→' + n.rank + '）');
}

if (problems.length) {
  console.log('\n❌ 自检没过（**未落盘**）：');
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}

console.log('\n自检通过：NPC 引用全存在 / 无悬空 flag / 阶段链连续 / bossPhases 递减');
itemsFile.items = items;
fs.writeFileSync(path.join(DIR, '20_items.json'), JSON.stringify(itemsFile, null, 1));
fs.writeFileSync(path.join(DIR, '10_skills.json'), JSON.stringify(skillsFile, null, 1));
fs.writeFileSync(path.join(DIR, '60_quests.json'), JSON.stringify(questsFile, null, 1));
fs.writeFileSync(path.join(DIR, '50_map.json'), JSON.stringify(mapFile, null, 1));
fs.writeFileSync(path.join(DIR, '40_npcs.json'), JSON.stringify(npcFile, null, 1));
console.log('已落盘 5 个数据文件（备份在 tools/_bak/*.act2.json）');
console.log('NPC 总数 ' + Object.keys(npcs).length + ' / 任务 ' + Object.keys(quests).length
  + ' / 物品 ' + itemIds.size + ' / 功法 ' + skillIds.size);
