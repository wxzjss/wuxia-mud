/* ============================================================
 * gen-sidequests.js — 生成 game/data/61_sidequests.json
 *
 * 把 design/23-sidequests-portrait-hooks.md 的 52 条画像支线（hk_*）
 * 落成真任务。**独立数据文件**，绝不动 60_quests / 50_map / 40_npcs
 * （mergeData 对 quests/items/rooms/npcs 按 id 合并，本文件在 60 之后加载）。
 *
 * 结构：每条 hk_* 挂在挂牌 NPC 身上（def.quests + def.actions），
 * 走两段式：① 去目标房间 → ② 回 giver 复命，复命时放出「秘密怎么演」+
 * 抉择 menu（各选项自带分支 flag / karma / money / rep / favor / item）。
 * 任务本体（stages/rewards）走引擎标准 quest 结构，report 即可完成。
 *
 * 用法：node tools/gen-sidequests.js
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '61_sidequests.json');

/* ------------------------------------------------------------------ *
 * 52 条支线数据
 * 字段：
 *   id     = 画像 hooks[].id（quest id 与 hook id 同键）
 *   npc    = 挂牌 NPC（同时也是 giver / 复命对象）
 *   cmd    = 挂牌动作指令（NPC def.actions 上，玩家在房里可触发；**不用「看」开头**，否则被口语归一化吃掉）
 *   goals  = [{room,desc}] 前置腿（去哪些房间）——最后一段自动生成「回 giver 抉择」
 *   back   = 设计稿里的「回话」一句（保留以对照 design/23；落地时折叠为「交任务在 giver 处发生」，
 *            不再单独占一段，故当前 buildQuest 不读它）
 *   reveal = 「秘密怎么演」：复命时按序放出的 say/narrate
 *   menu   = 抉择：{title, opts:[{label, eff:[效果串]}]}（≥2 个非战斗解法）
 *   items  = 复命时发放的线索物品（可被 menu 的 -item 消耗）
 *   require= 可选前置（缺省＝无）
 *   reward = 复命台词（任务完成时的一句 say）
 * ------------------------------------------------------------------ */

const A26 = ['npcv_241', 'npcv_154', 'npcv_010', 'npcv_208', 'npcv_091', 'npcv_065', 'npcv_223',
  'npcv_174', 'npcv_240', 'npcv_009', 'npcv_237', 'npcv_248', 'npcv_215', 'npcv_180',
  'npcv_115', 'npcv_083', 'npcv_126', 'npcv_164', 'npcv_186', 'npcv_090', 'npcv_074',
  'npcv_252', 'npcv_178', 'npcv_095', 'npcv_036', 'npcv_082'];

const QUESTS = [

  /* ===== V01 和放 ===== */
  {
    id: 'hk_npcv_241_yinzi', npc: 'npcv_241', cmd: '接账', title: '绸缎庄的窟窿', level: 5,
    desc: '绸缎庄的东家跑了，柜上短了三百两。和放让你去看看，那笔亏空断在哪一段。',
    goals: [{ room: 'jn_silk_shop', desc: '去东市·绸缎庄，问掌柜的那笔亏空断在哪一段' }],
    back: '回东市·南巷，把这一笔跟和放对清',
    reveal: [
      { t: 'narrate', raw: '他把印子账翻到折角那页，指腹压着一行小字，没念出来。' },
      { t: 'say', raw: '「白纸黑字，你我都在上头。」' },
    ],
    menu: {
      title: '这一笔，怎么处理',
      opts: [
        { label: '替他把账做平', eff: ['flag:hk_npcv_241_yinzi_hide', '+karma:-15', '+money:300', '+exp:150', '+pot:40', 'favor:npcv_241:15'] },
        { label: '留一份底，原样交官府', eff: ['flag:hk_npcv_241_yinzi_report', '+rep:朝廷:20', '+exp:120', '+pot:40', 'favor:npcv_241:-30'] },
      ],
    },
    items: ['ledger_yinzi'],
    reward: '和放合上账本，没再抬眼看你。',
  },
  {
    id: 'hk_npcv_241_guancai', npc: 'npcv_241', cmd: '问账', title: '寄在他这儿的棺材本', level: 8,
    require: { questDone: 'hk_npcv_241_yinzi' },
    desc: '街坊把钱寄在和放这里当棺材本，有三笔他一次没动过。数目不大，他记了很多年。',
    goals: [{ room: 'jn_resident_2', desc: '去江南城·杏花巷，找老艄公康守，问那三笔没动的账' }],
    back: '回东市·南巷，跟和放提一提康守那三笔',
    reveal: [
      { t: 'narrate', raw: '康守说，那三笔钱他替人存了二十年，一分利没要过。' },
      { t: 'say', raw: '「那三笔，我留着。」（停了很久）「你别问为什么。」' },
    ],
    menu: {
      title: '康守那三笔',
      opts: [
        { label: '替康守赎回那三笔', eff: ['+karma:12', 'favor:npcv_064:40', '+exp:200', '+pot:60', 'flag:hk_npcv_241_guancai_done'] },
        { label: '不劝，把话咽回去', eff: ['+exp:80', 'favor:npcv_241:10'] },
      ],
    },
    reward: '和放把那本账往桌角推了推，压上一块镇纸。',
  },

  /* ===== V02 穆逢 ===== */
  {
    id: 'hk_npcv_154_maishen', npc: 'npcv_154', cmd: '问姑娘', title: '妆匣最底下那张纸', level: 6,
    desc: '醉仙楼一楼那间房里，姑娘绝食到第三天。穆逢不吭声，只说她「不懂事」。',
    goals: [{ room: 'jn_wine_house', desc: '去醉仙楼一楼，看看那间房和那只妆匣' }],
    back: '回二楼雅间，把妆匣里那张纸摊在穆逢面前',
    reveal: [
      { t: 'narrate', raw: '妆匣最底下压着一张纸，边角磨得起了毛——是张卖身契，落款是三年前。' },
      { t: 'say', raw: '「楼里的姑娘，个个都有一张。」' },
    ],
    menu: {
      title: '这张纸，怎么办',
      opts: [
        { label: '还那姑娘', eff: ['-item:deed_girl', '+karma:15', '+exp:180', '+pot:50', 'favor:npcv_154:-40', 'flag:hk_npcv_154_maishen_free'] },
        { label: '交回穆逢', eff: ['+money:200', '+karma:-10', '+exp:120', 'favor:npcv_154:20', 'flag:hk_npcv_154_maishen_crush'] },
      ],
    },
    items: ['deed_girl'],
    reward: '穆逢把算盘拨了一串，得数和你说的两样。',
  },
  {
    id: 'hk_npcv_154_suoyin', npc: 'npcv_154', cmd: '问簪子', title: '素银簪', level: 9,
    require: { questDone: 'hk_npcv_154_maishen' },
    desc: '醉仙楼三位姑娘的妆匣里，各压着一支一模一样的素银簪。穆逢送的东西，从没重过样。',
    goals: [{ room: 'jn_wine_room', desc: '在二楼向王若兰、花无、何落梅打听同款的簪子' }],
    back: '回穆逢处，把三支一样的簪子说给她听',
    reveal: [
      { t: 'narrate', raw: '三位姑娘妆匣里的簪子摆在一处，连簪头的划痕都同。' },
      { t: 'say', raw: '「一根簪子，我能记三年。」' },
    ],
    menu: {
      title: '同款的簪子',
      opts: [
        { label: '替她把那张纸找出来', eff: ['+karma:12', '+exp:220', '+pot:50', 'flag:hk_npcv_154_suoyin_grey'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_154:10'] },
      ],
    },
    reward: '她把那三支簪子收进一只木匣，上了锁。',
  },

  /* ===== V03 屈疏 ===== */
  {
    id: 'hk_npcv_010_haosun', npc: 'npcv_010', cmd: '盘账', title: '账上那笔耗损', level: 6,
    desc: '米行的账上挂着一笔「耗损」，数目对不上仓里的米。屈疏让你去书院那边问一句行情。',
    goals: [{ room: 'jn_school', desc: '去白鹿书院，侧访这两月的米价行情' }],
    back: '回东市·西巷，把行情报给屈疏，看这笔耗损怎么入账',
    reveal: [
      { t: 'say', raw: '「米是会自己少的。少多少，看谁在记账。」' },
      { t: 'narrate', raw: '他翻开账底，指着一行没有日期的数目，笔画比别处用力。' },
    ],
    menu: {
      title: '这笔耗损',
      opts: [
        { label: '替他做平', eff: ['+karma:-10', '+money:250', '+exp:200', '+pot:60', 'favor:npcv_010:20', 'flag:hk_npcv_010_haosun_hide'] },
        { label: '留一份底', eff: ['+rep:*:20', '+exp:160', 'favor:npcv_010:-20', 'flag:hk_npcv_010_haosun_hold'] },
      ],
    },
    items: ['ledger_haosun'],
    reward: '屈疏把账底折起来，塞进袖口，没再提这笔。',
  },
  {
    id: 'hk_npcv_010_fuxue', npc: 'npcv_010', cmd: '说句话', title: '府学门口那道门', level: 8,
    require: { questDone: 'hk_npcv_010_haosun' },
    desc: '屈疏的儿子被府学门房拦了三回。这个靠粮价吃人的东家，头一回问人「该怎么办」。',
    goals: [{ room: 'jn_school', desc: '去白鹿书院门口，找门房问个明白' }],
    back: '回东市·西巷，把府学门口的事跟屈疏说',
    reveal: [
      { t: 'narrate', raw: '门房说，那孩子连来三回，回回被一句「名额满了」挡在外头。' },
      { t: 'say', raw: '「我这辈子没求过人。」' },
    ],
    menu: {
      title: '这道门',
      opts: [
        { label: '使钱', eff: ['-money:80', '+karma:8', '+exp:140', 'favor:npcv_010:30', 'flag:hk_npcv_010_fuxue_money'] },
        { label: '凭他的名声去说', eff: ['+karma:8', '+exp:180', 'favor:npcv_010:30', 'flag:hk_npcv_010_fuxue_fame'] },
        { label: '不管', eff: ['+exp:60', 'favor:npcv_010:-20', 'flag:hk_npcv_010_fuxue_none'] },
      ],
    },
    reward: '屈疏点了点头，转身去翻那本米行的账。',
  },

  /* ===== V04 孔拾月 ===== */
  {
    id: 'hk_npcv_208_feng', npc: 'npcv_208', cmd: '问船', title: '江上那三条船', level: 7,
    desc: '江上三条船停在河心，不肯靠岸。孔拾月要你去问问那三户船家，为什么。',
    goals: [{ room: 'jn_harbor_wharf', desc: '去码头·栈桥，说服那三户船家靠岸' }],
    back: '回码头·货栈，把三条船的事回给孔拾月',
    reveal: [
      { t: 'say', raw: '「船靠不靠岸，不看水，看抽头几成。」' },
      { t: 'narrate', raw: '她把手里的头钱串子往桌上一搁，铜钱散开又收拢。' },
    ],
    menu: {
      title: '这三条船',
      opts: [
        { label: '替她压船户', eff: ['+rep:*:20', '+money:200', '+exp:220', '+pot:60', 'favor:npcv_208:25', 'flag:hk_npcv_208_feng_press'] },
        { label: '帮船户抗抽头', eff: ['+rep:丐帮:15', '+karma:10', '+exp:180', 'favor:npcv_208:-25', 'flag:hk_npcv_208_feng_loose'] },
      ],
    },
    reward: '孔拾月收了头钱串子，码头的算盘声又响起来。',
  },
  {
    id: 'hk_npcv_208_shaochuan', npc: 'npcv_208', cmd: '问旧事', title: '十年前那条船', level: 10,
    require: { questDone: 'hk_npcv_208_feng' },
    desc: '孔拾月每年清明在码头烧一叠纸。烧的是什么，码头上没人问过。',
    goals: [{ room: 'jn_harbor_shed', desc: '在货栈打听十年前那条沉船' }],
    back: '回孔拾月跟前，看她认不认这桩旧事',
    reveal: [
      { t: 'narrate', raw: '纸灰落进江里，随浪散开，她盯着水面没挪眼。' },
      { t: 'say', raw: '「十年前那条船，是我押的。名字我没报全。」' },
    ],
    menu: {
      title: '十年前那条船',
      opts: [
        { label: '替她瞒下', eff: ['+karma:5', '+exp:200', '+pot:50', 'flag:hk_npcv_208_shaochuan_hold'] },
        { label: '报到官上', eff: ['+rep:朝廷:25', '+exp:240', 'favor:npcv_208:-60', 'flag:hk_npcv_208_shaochuan_report'] },
      ],
    },
    reward: '她把最后一把纸灰撒进江里，转身上了货栈。',
  },

  /* ===== V05 樊过 ===== */
  {
    id: 'hk_npcv_091_xiangzi', npc: 'npcv_091', cmd: '搭话', title: '府衙那只箱子', level: 6,
    desc: '衙门后院抬进一口箱子，樊过盯了三天。他说只要你去看一眼：那箱子什么时候出。',
    goals: [{ room: 'jn_yamen_back', desc: '去衙门·后衙，看那口箱子什么时候抬出去' }],
    back: '回东市·当铺，把箱子的事说给樊过',
    reveal: [
      { t: 'narrate', raw: '箱子贴着封条，锁口是新的，抬进去的两个人一句话没说。' },
      { t: 'say', raw: '「锁新，说明里头的旧东西急着走。」' },
    ],
    menu: {
      title: '那只箱子',
      opts: [
        { label: '替他探明白', eff: ['+karma:-5', '+pot:60', '+exp:200', 'flag:hk_npcv_091_xiangzi_open'] },
        { label: '劝他收手', eff: ['+karma:10', '+exp:240', 'favor:npcv_091:30', 'flag:hk_npcv_091_xiangzi_stop'] },
      ],
    },
    reward: '樊过把那把新锁的样子画在纸上，折起来收好。',
  },
  {
    id: 'hk_npcv_091_mianao', npc: 'npcv_091', cmd: '问棉袄', title: '两个小子的棉袄', level: 8,
    require: { questDone: 'hk_npcv_091_xiangzi' },
    desc: '当铺后屋堆着两件没人来赎的旧棉袄，樊过每天收摊前都要摸一遍。',
    goals: [{ room: 'jn_pawnshop', desc: '在当铺里，撞见樊过缝那两件棉袄' }],
    back: '回他跟前，看这两件棉袄是给谁留的',
    reveal: [
      { t: 'narrate', raw: '棉袄的领口拆了又缝，针脚是新的。' },
      { t: 'say', raw: '「两个小子，捡来的。一件一个。」' },
    ],
    menu: {
      title: '两件棉袄',
      opts: [
        { label: '送小子去书院', eff: ['-money:60', '+karma:12', '+exp:200', 'favor:npcv_091:20', 'flag:hk_npcv_091_mianao_school'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_091:10'] },
      ],
    },
    reward: '樊过收好针线，把那两件棉袄重新压回箱底。',
  },

  /* ===== V06 杜听涛 ===== */
  {
    id: 'hk_npcv_065_siqiliang', npc: 'npcv_065', cmd: '陪他坐坐', title: '元若那四十七两', level: 5,
    desc: '杜听涛在茶馆赊了元若三年，四十七两。两个老头隔着一张桌子，谁也不先开口。',
    goals: [{ room: 'jn_teahouse', desc: '就在茶馆里，找元若替杜听涛说句话' }],
    back: '回老茶馆，把元若的话带给杜听涛',
    reveal: [
      { t: 'say', raw: '元若：「我这四十七两，不催他。我就等他自己开口。」' },
      { t: 'narrate', raw: '杜听涛听完，端着茶碗没喝，碗沿上磕了个小口。' },
    ],
    menu: {
      title: '这四十七两',
      opts: [
        { label: '替他还', eff: ['-money:47', '+exp:200', '+pot:50', 'favor:npcv_065:30', 'flag:hk_npcv_065_siqiliang_paid'] },
        { label: '逼他开口', eff: ['+money:47', '+exp:120', 'favor:npcv_065:-30', 'flag:hk_npcv_065_siqiliang_press'] },
        { label: '替他把话说透', eff: ['+karma:10', '+exp:260', 'favor:npcv_073:20', 'flag:hk_npcv_065_siqiliang_truth'] },
      ],
    },
    reward: '杜听涛把茶碗搁下，起身往元若那张桌子走了过去。',
  },
  {
    id: 'hk_npcv_065_ziju', npc: 'npcv_065', cmd: '问官银', title: '怀里那张字据', level: 9,
    require: { questDone: 'hk_npcv_065_siqiliang' },
    desc: '杜听涛怀里揣着一张字据，揣了三十年，边都磨圆了。',
    goals: [{ room: 'jn_teahouse', desc: '在茶馆逼出那张字据的来路' }],
    back: '回杜听涛跟前，看这张字据怎么处置',
    reveal: [
      { t: 'narrate', raw: '字据上墨色发褐，落款人死了三十年。' },
      { t: 'say', raw: '「这钱不是他的，是那批官银的。」' },
    ],
    menu: {
      title: '这张字据',
      opts: [
        { label: '交给元若', eff: ['-item:iou_du', 'favor:npcv_073:30', 'favor:npcv_065:-50', '+exp:240'] },
        { label: '替他烧了', eff: ['-item:iou_du', '+karma:5', 'favor:npcv_065:40', '+exp:220', 'flag:hk_jiuzhangfang'] },
      ],
    },
    items: ['iou_du'],
    reward: '杜听涛把茶钱压在碗底下，拱了拱手走了。',
  },

  /* ===== V07 蓝若愚 ===== */
  {
    id: 'hk_npcv_223_meimei', npc: 'npcv_223', cmd: '问他腿', title: '枫桥那个人贩子', level: 8,
    desc: '蓝若愚翻了十二年的乱葬岗，为的是找一个人。那个人贩子的名字，他从旁人嘴里听过。',
    goals: [
      { room: 'gusu_zhai_lane', desc: '去姑苏·世家巷，打听那个人贩子的落脚处' },
      { room: 'gusu_fengqiao', desc: '去姑苏·枫桥，跟那个人对质' },
    ],
    back: '回燕子坞，把枫桥的事回给蓝若愚',
    reveal: [
      { t: 'narrate', raw: '枫桥底下停了条小船，船里堆着旧衣裳，大小不一。' },
      { t: 'say', raw: '「我不是要杀他。我是要问一句话。」' },
    ],
    menu: {
      title: '那个人',
      opts: [
        { label: '问出妹妹的下落', eff: ['+karma:15', '+exp:260', '+pot:70', 'favor:npcv_223:40', 'flag:hk_npcv_223_meimei_found'] },
        { label: '收钱闭嘴', eff: ['+money:300', '+karma:-15', '+exp:120', 'flag:hk_npcv_223_meimei_silent'] },
        { label: '动手', eff: ['combat:mob_bandit', '+exp:200', 'flag:hk_npcv_223_meimei_fight'] },
      ],
    },
    reward: '蓝若愚朝枫桥那头望了一眼，没再说什么。',
  },
  {
    id: 'hk_npcv_223_laoxiapo', npc: 'npcv_223', cmd: '问瞎婆', title: '城外那个瞎婆', level: 10,
    require: { questDone: 'hk_npcv_223_meimei' },
    desc: '蓝若愚偷来的钱，一分没花，全给了城外一个瞎婆。',
    goals: [{ room: 'gusu_town', desc: '去姑苏城外，找到那个瞎婆，对一对蓝若愚给的信物' }],
    back: '回燕子坞，把瞎婆的事跟蓝若愚说',
    reveal: [
      { t: 'narrate', raw: '瞎婆摸索着那枚旧铜钱，摸得很久，才说「他还活着」。' },
      { t: 'say', raw: '「我不敢认她。认了，就是十二年前那桩事的证。」' },
    ],
    menu: {
      title: '那位瞎婆',
      opts: [
        { label: '替蓝若愚认下她', eff: ['+karma:10', '+exp:200', 'favor:npcv_223:30', 'flag:hk_npcv_223_laoxiapo_ack'] },
        { label: '什么都不说', eff: ['+exp:80', 'favor:npcv_223:-10'] },
      ],
    },
    reward: '蓝若愚把那枚旧铜钱又收回了贴身的口袋里。',
  },

  /* ===== V08 蒋倦 ===== */
  {
    id: 'hk_npcv_174_tuntang', npc: 'npcv_174', cmd: '问仓', title: '仓里那三个月', level: 7,
    desc: '城里旱象已起。蒋倦仓里那批米，掺过一遍沙土，他要你再走一趟粮仓。',
    goals: [{ room: 'jn_granary', desc: '去东市·粮仓，看蒋倦那批米掺了多少' }],
    back: '回东市·窑场，问蒋倦这批米怎么出手',
    reveal: [
      { t: 'narrate', raw: '仓角的米堆比别处浅一截，底下垫着细沙。' },
      { t: 'say', raw: '「掺过一遍的米，今晚就得多一碗饭，少一碗饭。」' },
    ],
    menu: {
      title: '这批米',
      opts: [
        { label: '替他掺了', eff: ['+karma:-20', '+money:400', '+exp:200', '+pot:70', 'flag:hk_npcv_174_tuntang_mix'] },
        { label: '报到官上', eff: ['+rep:朝廷:25', '+exp:240', 'favor:npcv_174:-50', 'flag:hk_npcv_174_tuntang_report'] },
      ],
    },
    reward: '蒋倦把那袋米挪到仓角，填回一层整米进了门面。',
  },
  {
    id: 'hk_npcv_174_zhangxin', npc: 'npcv_174', cmd: '问开仓', title: '掌心里那把米', level: 10,
    require: { questDone: 'hk_npcv_174_tuntang' },
    desc: '蒋倦抓米搓手，搓了三十年。他说这动作是娘教的。',
    goals: [{ room: 'jn_pottery', desc: '在窑场看他开仓抓米' }],
    back: '回他跟前，看他掌心里那把米',
    reveal: [
      { t: 'narrate', raw: '他抓一把米，摊开，又攥上，指缝里漏下来的比留下的多。' },
      { t: 'say', raw: '「我娘说，搓得出声的米才是好米。搓了三十年我才知道，她是骗我的。」' },
    ],
    menu: {
      title: '他搓的那把米',
      opts: [
        { label: '劝他改', eff: ['+karma:10', '+exp:200', 'favor:npcv_174:20', 'flag:hk_npcv_174_zhangxin_grey'] },
        { label: '接着合伙', eff: ['+money:200', '+exp:120', 'flag:hk_npcv_174_zhangxin_partner'] },
      ],
    },
    reward: '蒋倦把掌心那把米倒回仓里，拍了拍手。',
  },

  /* ===== V09 邬修远 ===== */
  {
    id: 'hk_npcv_240_laocaifeng', npc: 'npcv_240', cmd: '问货', title: '三年攒的那匹绸', level: 6,
    desc: '邬修远进了一批绸，价钱低得反常。打开那匹料子，得用剪子。',
    goals: [{ room: 'jn_silk_shop', desc: '去东市·绸缎庄，剪开那匹绸验货' }],
    back: '回东市·北巷，把这匹绸的事跟邬修远说',
    reveal: [
      { t: 'narrate', raw: '剪口里掺着麻丝，捋一把，扎手。' },
      { t: 'say', raw: '「买的人一辈子摸不到里头。」' },
    ],
    menu: {
      title: '这匹绸',
      opts: [
        { label: '劝他换真货', eff: ['+karma:10', '+exp:220', '+pot:50', 'favor:npcv_240:30', 'flag:hk_npcv_240_laocaifeng_honest'] },
        { label: '帮他把货卖出', eff: ['+money:200', '+karma:-10', '+exp:140', 'flag:hk_npcv_240_laocaifeng_sold'] },
      ],
    },
    items: ['fake_silk'],
    reward: '邬修远把剪开的那匹绸卷回去，露出一截没掺麻的边。',
  },
  {
    id: 'hk_npcv_240_shouyi', npc: 'npcv_240', cmd: '翻箱底', title: '箱底那件料子', level: 9,
    require: { questDone: 'hk_npcv_240_laocaifeng' },
    desc: '邬修远每年腊月裁一件料子，裁了不穿，压在箱底。',
    goals: [{ room: 'jn_market_north', desc: '在北巷翻出他箱底那件料子' }],
    back: '回他跟前，看这件料子裁给谁',
    reveal: [
      { t: 'narrate', raw: '箱底那件料子叠得整整齐齐，针脚细得不像出自一个卖假料的手。' },
      { t: 'say', raw: '「这是给我自己的。卖出去的都是假货，这件不能假。」' },
    ],
    menu: {
      title: '箱底那件料子',
      opts: [
        { label: '劝他穿上', eff: ['+karma:8', '+exp:200', 'favor:npcv_240:25', 'flag:hk_npcv_240_shouyi_wear'] },
        { label: '不问', eff: ['+exp:90', 'favor:npcv_240:10'] },
      ],
    },
    reward: '邬修远把那件料子抖开又叠好，压回箱底最上头。',
  },

  /* ===== V10 熊时 ===== */
  {
    id: 'hk_npcv_009_baizi', npc: 'npcv_009', cmd: '问绣坊', title: '那幅百子图', level: 7,
    desc: '绣娘喻凝绣了三年的百子图，抵九两债，押在熊时手里。',
    goals: [{ room: 'jiangnan_market', desc: '去江南城市集，找绣娘喻凝看那幅百子图' }],
    back: '回熊时处，看这幅绣品归谁',
    reveal: [
      { t: 'narrate', raw: '百子图上九十九个孩子，独缺一个，线头还留着没收。' },
      { t: 'say', raw: '「我不写字据。名字，我记在脑子里。」' },
    ],
    menu: {
      title: '那幅图',
      opts: [
        { label: '替她卖出去', eff: ['+money:10', '+karma:-5', '+exp:150', 'favor:npcv_009:20', 'flag:hk_npcv_009_baizi_sell'] },
        { label: '替绣娘说情', eff: ['+karma:10', '+exp:200', '+pot:40', 'favor:npcv_009:-10', 'flag:hk_npcv_009_baizi_grey'] },
      ],
    },
    reward: '熊时把算珠一推，说这幅图她先收着。',
  },
  {
    id: 'hk_npcv_009_shuoshu', npc: 'npcv_009', cmd: '听说书', title: '说书人那张嘴', level: 9,
    require: { questDone: 'hk_npcv_009_baizi' },
    desc: '熊时不识字，可全城欠钱的人，名字一个跑不掉——跑不掉，是因为有人的嘴。',
    goals: [{ room: 'jn_teahouse', desc: '去老茶馆，听听说书人念的是哪几个名字' }],
    back: '回熊时处，把说书人的醒木词说给她听',
    reveal: [
      { t: 'narrate', raw: '醒木一响，唱词里三个名字串成一句，堂下有人红了脸。' },
      { t: 'say', raw: '「我记不住字，记得住嘴。」' },
    ],
    menu: {
      title: '说书人那张嘴',
      opts: [
        { label: '买断他', eff: ['-money:120', '+exp:220', '+pot:50', 'favor:npcv_009:30', 'flag:hk_npcv_009_shuoshu_buy'] },
        { label: '让债户知晓', eff: ['+rep:*:15', '+exp:260', 'favor:npcv_009:-40', 'flag:hk_npcv_009_shuoshu_liang'] },
      ],
    },
    reward: '熊时听完那三个名字，笑了一声，又数起她的珠子。',
  },

  /* ===== V11 李无咎 ===== */
  {
    id: 'hk_npcv_237_daoshang', npc: 'npcv_237', cmd: '抓药', title: '那口刀伤', level: 7,
    desc: '有人半夜来当铺求郎中治刀伤。李无咎收了钱，第二天那人的通缉就上了墙。',
    goals: [{ room: 'jm_underground', desc: '去东市·地下黑市，打听那口刀路是谁的' }],
    back: '回当铺，把这口刀伤的来路问李无咎',
    reveal: [
      { t: 'narrate', raw: '他把药箱合上，扣搭一响，像是替那口刀伤收了尾。' },
      { t: 'say', raw: '「治好了不报官——这是我抓药的规矩。」' },
    ],
    menu: {
      title: '那口刀伤',
      opts: [
        { label: '替他递话', eff: ['+exp:200', '+pot:50', 'favor:npcv_237:30', 'favor:npcv_091:20', 'flag:hk_daolu'] },
        { label: '报到官上', eff: ['+rep:朝廷:25', '+exp:180', 'favor:npcv_237:-50'] },
      ],
    },
    reward: '李无咎把药箱挂回墙上，没再接那桩生意。',
  },
  {
    id: 'hk_npcv_237_cheng', npc: 'npcv_237', cmd: '问他擦秤', title: '秤砣上那点尘', level: 10,
    require: { questDone: 'hk_npcv_237_daoshang' },
    desc: '李无咎擦那杆秤，擦得秤砣不见一点尘。他擦的不是秤砣。',
    goals: [{ room: 'jn_yizhuang', desc: '陪李无咎去城西义庄旧址走一趟' }],
    back: '回当铺，看他把那杆秤怎么收好',
    reveal: [
      { t: 'narrate', raw: '义庄门口的青砖上，留着几道旧验伤的划痕。' },
      { t: 'say', raw: '「那年我验过一个孩子。他娘抱着他来的，说只是睡着了。」' },
    ],
    menu: {
      title: '那杆秤',
      opts: [
        { label: '陪他在义庄门口站一会儿', eff: ['+karma:8', '+exp:200', 'favor:npcv_237:25', 'flag:hk_npcv_237_cheng_grey'] },
        { label: '不问', eff: ['+exp:90', 'favor:npcv_237:10'] },
      ],
    },
    reward: '李无咎把那杆秤取下来，用布裹好，收进了柜子最里头。',
  },

  /* ===== V12 俞初 ===== */
  {
    id: 'hk_npcv_248_jiushui', npc: 'npcv_248', cmd: '翻卷宗', title: '三年前那一笔', level: 9,
    desc: '西夏官道那间冰窖，锁着三年前一批卷宗。俞初自己不敢去开。',
    goals: [{ room: 'xixia_ice', desc: '去西夏·冰窖，抽出三年前那张假账' }],
    back: '回西夏官道，把这张假账摆在俞初面前',
    reveal: [
      { t: 'narrate', raw: '卷宗里那一页，户头写着一个死人，墨色比别处新。' },
      { t: 'say', raw: '「她那年才十七。我记得。」' },
    ],
    menu: {
      title: '这张假账',
      opts: [
        { label: '把抄本留在手上', eff: ['+rep:朝廷:30', '+money:200', '+exp:230', '+pot:60', 'flag:hk_npcv_248_jiushui_copy'] },
        { label: '当她的面烧了', eff: ['+karma:-20', '+money:400', '+exp:220', 'flag:hk_npcv_248_jiushui_burn'] },
      ],
    },
    reward: '俞初把那页卷宗折起，塞回袖子里，拢了拢领口。',
  },
  {
    id: 'hk_npcv_248_changfu', npc: 'npcv_248', cmd: '找常拂', title: '关外那个孩子', level: 11,
    require: { questDone: 'hk_npcv_248_jiushui' },
    desc: '捕快常拂跟俞初同住一间驿舍。一个知道全部，一个什么都不知道。',
    goals: [{ room: 'road_xixia_1', desc: '在西夏官道找常拂，听她说当年那桩事' }],
    back: '回俞初处，把常拂的话转给她',
    reveal: [
      { t: 'say', raw: '常拂：「那年我查出一笔账，第二天就被革了。我一直没弄明白是谁。」' },
      { t: 'narrate', raw: '俞初就在隔一道墙的地方，捏着茶碗，没出声。' },
    ],
    menu: {
      title: '关外那个孩子',
      opts: [
        { label: '替她讨回清白', eff: ['+karma:15', '+exp:240', 'favor:npcv_049:40', 'flag:hk_npcv_248_changfu_clear'] },
        { label: '不插手', eff: ['+exp:100', 'favor:npcv_248:10'] },
      ],
    },
    reward: '俞初隔墙听完了，起身给常拂续了一碗茶。',
  },

  /* ===== V13 闵春晓 ===== */
  {
    id: 'hk_npcv_215_yanyin', npc: 'npcv_215', cmd: '批盐引', title: '那半张盐引', level: 8,
    desc: '闵春晓烧了十年那半张盐引，每回都举到灶口，又收回来。',
    goals: [{ room: 'tangmen_hall', desc: '去唐门前厅，找祁疏打听盐引旧事' }],
    back: '回蜀中官道，看闵春晓怎么处置那半张盐引',
    reveal: [
      { t: 'narrate', raw: '她把那半张盐引举到灶前，火起来又灭——纸边焦了，她没烧。' },
      { t: 'say', raw: '「烧了十年，粘不回原样。」' },
    ],
    menu: {
      title: '那半张盐引',
      opts: [
        { label: '替她烧干净', eff: ['+karma:12', '+exp:240', '+pot:60', 'favor:npcv_215:40', 'flag:hk_npcv_215_yanyin_done'] },
        { label: '留底要挟', eff: ['+money:500', '+karma:-25', '+exp:140', 'flag:hk_npcv_215_yanyin_hold'] },
      ],
    },
    reward: '闵春晓把那半张盐引收进贴身的荷包，没再举到灶口。',
  },
  {
    id: 'hk_npcv_215_mengming', npc: 'npcv_215', cmd: '找孟明', title: '孟明亡母那笔钱', level: 10,
    require: { questDone: 'hk_npcv_215_yanyin' },
    desc: '孟明在苗疆守着一间小店。问起他亡母那副药，他只说遇上了好人。',
    goals: [{ room: 'miaojiang_sheng', desc: '去苗疆圣地，找店伙孟明，问他亡母那副药' }],
    back: '回闵春晓处，把孟明的话说给她',
    reveal: [
      { t: 'say', raw: '孟明：「我娘那副药，我一直不知道是谁出的钱。问她，她只说遇上了好人。」' },
      { t: 'narrate', raw: '闵春晓听完，把袖里那本盐册按平了。' },
    ],
    menu: {
      title: '那副药',
      opts: [
        { label: '告诉他', eff: ['+karma:10', '+exp:220', 'favor:npcv_215:-10', 'flag:hk_npcv_215_mengming_tell'] },
        { label: '替他保密', eff: ['+exp:100', 'favor:npcv_215:10'] },
      ],
    },
    reward: '闵春晓把盐册合上，收进了行囊。',
  },

  /* ===== V14 乐知 ===== */
  {
    id: 'hk_npcv_180_beibian', npc: 'npcv_180', cmd: '问镖车', title: '北边那趟镖', level: 8,
    require: { not: { flag: 'know_zhenyi' } },
    desc: '乐知的镖车上有一口箱子，货单上没写。她头一回先把箱子拆开看。',
    goals: [{ room: 'jn_market_main', desc: '在东市大街，验那口不写货单的箱子' }],
    back: '回乐知的车前，看这趟镖接不接',
    reveal: [
      { t: 'narrate', raw: '箱子里糊着两层棉，压角处留着一块没撕净的旧封条。' },
      { t: 'say', raw: '「不写货单的镖，我接过大半辈子。这一趟，我头一回想先看一眼。」' },
    ],
    menu: {
      title: '北边那趟镖',
      opts: [
        { label: '替她验货', eff: ['+exp:200', '+pot:60', 'flag:hk_heibiao'] },
        { label: '劝她退镖', eff: ['+karma:10', '+exp:240', 'favor:npcv_180:30', 'flag:hk_npcv_180_beibian_stop'] },
      ],
    },
    reward: '乐知把那口箱子重新捆好，绳结收得比原先还紧。',
  },
  {
    id: 'hk_npcv_180_qi', npc: 'npcv_180', cmd: '摘旗', title: '车上那面旧旗', level: 11,
    require: { questDone: 'hk_npcv_180_beibian' },
    desc: '乐知的镖车上挂着一面旧旗，挂了二十年，褪得看不出颜色。',
    goals: [{ room: 'jn_market_main', desc: '在东市大街，与她一同把车上那面旧旗摘下来' }],
    back: '回乐知跟前，听她把旗子底下那桩事说全',
    reveal: [
      { t: 'narrate', raw: '旗子落地，她盯着旗角那处补丁，手指在上面停了一下。' },
      { t: 'say', raw: '「二十年前我押丢过一趟镖。我把货主的名头，报给了劫道的。那户人家，我记得姓什么。」' },
    ],
    menu: {
      title: '车上那面旧旗',
      opts: [
        { label: '陪她认下旧账', eff: ['+karma:12', '+exp:260', '+pot:70', 'favor:npcv_180:40', 'flag:hk_npcv_180_qi_grey'] },
        { label: '只摘旗，不深问', eff: ['+exp:120', 'favor:npcv_180:10'] },
      ],
    },
    reward: '乐知把那面旧旗叠成一方，压在了车板最底下。',
  },

  /* ===== V15 费守 ===== */
  {
    id: 'hk_npcv_115_mingan', npc: 'npcv_115', cmd: '问案子', title: '这桩命案', level: 8,
    desc: '费守管着一本结案册子。蜀道上这桩命案，苦主还没找到，真凶更没影。',
    goals: [{ room: 'tangmen_hall', desc: '去唐门前厅，查这桩命案的苦主与真凶' }],
    back: '回入蜀官道，看费守怎么结这桩案子',
    reveal: [
      { t: 'narrate', raw: '他把册子翻到某一页，蘸了墨，笔尖悬着——没落下去。' },
      { t: 'say', raw: '「随便挑一个结案，我干过。有一回之后，我不干了。」' },
    ],
    menu: {
      title: '这桩命案',
      opts: [
        { label: '揪出真凶', eff: ['+karma:15', '+exp:260', '+pot:70', 'favor:npcv_115:40', 'flag:hk_npcv_115_mingan_true'] },
        { label: '由他随便结案', eff: ['+karma:-20', '+money:200', '+exp:140', 'flag:hk_npcv_115_mingan_fake'] },
      ],
    },
    reward: '费守把册子合上，压在了案头那方旧砚底下。',
  },
  {
    id: 'hk_npcv_115_ce', npc: 'npcv_115', cmd: '翻册子', title: '册子上那个名字', level: 10,
    require: { questDone: 'hk_npcv_115_mingan' },
    desc: '费守的册子上有一个名字，二十年没划过。',
    goals: [{ room: 'road_tangmen_1', desc: '在入蜀官道，逼他把册子翻到那一页' }],
    back: '回费守处，看这个名字怎么收场',
    reveal: [
      { t: 'say', raw: '「二十年前有个货郎，是我办的。他死在牢里。这名字，我二十年没划。」' },
      { t: 'narrate', raw: '笔尖落在那一页上，抖了一下，划出一道不直的线。' },
    ],
    menu: {
      title: '册子上那个名字',
      opts: [
        { label: '替货郎翻案', eff: ['+karma:20', '+exp:280', 'favor:npcv_115:20', 'flag:hk_npcv_115_ce_grey'] },
        { label: '把册子烧了', eff: ['+exp:160', 'favor:npcv_115:30', '+karma:-5'] },
      ],
    },
    reward: '费守把划下去的那一页吹了吹，等墨干。',
  },

  /* ===== V16 毕元 ===== */
  {
    id: 'hk_npcv_083_guben', npc: 'npcv_083', cmd: '问卷', title: '那册孤本', level: 8,
    desc: '架阁库一册宋版孤本压在判词底下，成了毕元给自己定的价。',
    goals: [{ room: 'jn_bookshop', desc: '去翰墨斋，寻一册好书换下那本孤本' }],
    back: '回衙门·架阁库，看这册孤本换不换',
    reveal: [
      { t: 'narrate', raw: '他写完判词，把笔在清水里洗了三遍，洗得笔尖不剩一点墨。' },
      { t: 'say', raw: '「这一行字，是要人命的。我改过一行。」' },
    ],
    menu: {
      title: '这册孤本',
      opts: [
        { label: '拿好书换下它', eff: ['-item:book_rare', '+karma:10', '+exp:220', '+pot:60', 'favor:npcv_083:30', 'flag:hk_npcv_083_guben_swap'] },
        { label: '逼他改判', eff: ['+karma:-15', '+money:300', '+exp:140', 'flag:hk_npcv_083_guben_force'] },
      ],
    },
    items: ['book_rare'],
    reward: '毕元把那册孤本搁进了换回来的书堆里，没看成色。',
  },
  {
    id: 'hk_npcv_083_gaizi', npc: 'npcv_083', cmd: '调旧卷', title: '改过的那行字', level: 10,
    require: { questDone: 'hk_npcv_083_guben' },
    desc: '毕元写判词从不改第二遍，只有一桩案的卷宗上留着刮改的痕。',
    goals: [{ room: 'jn_yamen_wt', desc: '去衙门·刑房，调出那卷旧案，找那处刮改' }],
    back: '回架阁库，把刮改的痕说给毕元',
    reveal: [
      { t: 'narrate', raw: '那一行字底下的纸面是毛的——刮过，又写上去。' },
      { t: 'say', raw: '「刮一回，就得记一辈子。」' },
    ],
    menu: {
      title: '改过的那行字',
      opts: [
        { label: '替冤者翻案', eff: ['+karma:15', '+exp:260', 'favor:npcv_083:-30', 'flag:hk_npcv_083_gaizi_clear'] },
        { label: '替他压下', eff: ['+exp:120', 'favor:npcv_083:20'] },
      ],
    },
    reward: '毕元把那卷旧案重新捆好，放回了架阁库最里一档。',
  },

  /* ===== V17 和苍 ===== */
  {
    id: 'hk_npcv_126_xianghuo', npc: 'npcv_126', cmd: '问功德箱', title: '功德箱里那点钱', level: 6,
    desc: '破庙功德箱里的钱，和苍数得比念经还熟。',
    goals: [{ room: 'gaibang_po_miao', desc: '在破庙和他一起清点功德箱' }],
    back: '回和苍处，看这点香火怎么分',
    reveal: [
      { t: 'say', raw: '屈弘：「我这庙里，本有一尊铜像。后来没了。」' },
      { t: 'narrate', raw: '和苍数钱的手停了一下，又数下去。' },
    ],
    menu: {
      title: '这点香火',
      opts: [
        { label: '分给庙里众人', eff: ['+karma:10', '+exp:200', '+pot:50', 'favor:npcv_126:-10', 'flag:hk_npcv_126_xianghuo_share'] },
        { label: '替他独吞', eff: ['+money:200', '+karma:-15', '+exp:130', 'favor:npcv_126:30', 'flag:hk_npcv_126_xianghuo_keep'] },
      ],
    },
    reward: '和苍把功德箱锁上，钥匙照旧挂在自己腰里。',
  },
  {
    id: 'hk_npcv_126_tongxiang', npc: 'npcv_126', cmd: '问铜像', title: '那尊铜像', level: 9,
    require: { questDone: 'hk_npcv_126_xianghuo' },
    desc: '和苍骂屈弘是骗子，骂了六年。骂得越响，越像在掩什么。',
    goals: [{ room: 'gaibang_po_miao', desc: '在破庙向屈弘问师门那尊铜像的旧事' }],
    back: '回和苍处，当面问他铜像的事',
    reveal: [
      { t: 'say', raw: '「那年我要饭，从那道观里拿了尊像去换钱。那道观……是他的师门。」' },
      { t: 'narrate', raw: '他说完这句，把手里的念珠绕了两圈，没再数。' },
    ],
    menu: {
      title: '那尊铜像',
      opts: [
        { label: '逼他还像', eff: ['+karma:15', '+exp:260', '+pot:60', 'favor:npcv_062:40', 'favor:npcv_126:-40', 'flag:hk_npcv_126_tongxiang_back'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_126:10'] },
      ],
    },
    reward: '和苍把念珠收了，背过身去扫院子里的落叶。',
  },

  /* ===== V18 皮朝颜 ===== */
  {
    id: 'hk_npcv_164_yinzi', npc: 'npcv_164', cmd: '问赌坊', title: '那笔周转银子', level: 9,
    desc: '黑木崖的账从皮朝颜手里过。她说崖后有口井，井里的银子一枚没动。',
    goals: [{ room: 'mojiao_hall', desc: '去黑木崖大殿，找教中旧账房打听那笔银子的成色' }],
    back: '回山门，把这笔周转银子的账跟皮朝颜对清',
    reveal: [
      { t: 'narrate', raw: '账房翻出那本旧账，纸角上留着一圈茶渍。' },
      { t: 'say', raw: '「崖后有口井。我这辈子的银子，都在里头。一枚没动。」' },
    ],
    menu: {
      title: '那笔银子',
      opts: [
        { label: '替她查账', eff: ['+exp:240', '+pot:70', 'flag:hk_sirenzhang'] },
        { label: '回报教中', eff: ['+rep:日月神教:20', '+exp:180', 'favor:npcv_164:-30'] },
      ],
    },
    reward: '皮朝颜把账本合上，用一根青布条重新捆紧。',
  },
  {
    id: 'hk_npcv_164_sirenzhang', npc: 'npcv_164', cmd: '问枯井', title: '死人账', level: 12,
    require: { questDone: 'hk_npcv_164_yinzi' },
    desc: '皮朝颜管了半辈子账，攒了一井银子。账本上「采买」两个字，她记了很多年。',
    goals: [{ room: 'mojiao_shanmen', desc: '随皮朝颜下崖，看那口枯井' }],
    back: '回山门，看这笔死人账怎么收',
    reveal: [
      { t: 'narrate', raw: '账本上一笔写着「采买」两个字。日期她也记得——那批孩子，是她经手的。' },
      { t: 'say', raw: '「那笔钱，买过一批孩子的命。」' },
    ],
    menu: {
      title: '井里那些银子',
      opts: [
        { label: '揭发出去', eff: ['+karma:20', '+exp:280', '+pot:80', 'flag:hk_npcv_164_sirenzhang_expose'] },
        { label: '替她掩盖', eff: ['+exp:160', 'favor:npcv_164:40', '+karma:-10'] },
      ],
    },
    reward: '皮朝颜站在井口往下看，井底黑黢黢的，什么都没有。',
  },

  /* ===== V19 鲁半夏 ===== */
  {
    id: 'hk_npcv_186_zuihua', npc: 'npcv_186', cmd: '陪酒', title: '雅间里那句醉话', level: 9,
    desc: '醉春楼花厅里，一个官儿喝多了，把不该说的说了。鲁半夏听见了。',
    goals: [{ room: 'jn_brothel_hall', desc: '在醉春楼花厅，听鲁半夏转述雅间那句醉话' }],
    back: '回她跟前，看这句话递不递上去',
    reveal: [
      { t: 'say', raw: '「我这条命是捡的。捡来的命，多活一天赚一天。」' },
      { t: 'narrate', raw: '她说这话时，手里那只酒盏一直没放下，也没喝。' },
    ],
    menu: {
      title: '那句话',
      opts: [
        { label: '替她压下不递', eff: ['+karma:15', '+exp:240', '+pot:70', 'favor:npcv_186:40', 'flag:hk_npcv_186_zuihua_hold'] },
        { label: '替她递上去', eff: ['+rep:日月神教:25', '+exp:180', 'favor:npcv_186:-20', 'flag:hk_npcv_186_zuihua_send'] },
      ],
    },
    reward: '鲁半夏把那只酒盏搁下，起身去伺候下一桌客人。',
  },
  {
    id: 'hk_npcv_186_yao', npc: 'npcv_186', cmd: '找汪秋', title: '那味哑药', level: 11,
    require: { questDone: 'hk_npcv_186_zuihua' },
    desc: '六年前一杯酒，汪秋被带走，鲁半夏烧了六年纸。',
    goals: [{ room: 'jn_brothel_hall', desc: '在花厅找汪秋，把六年前那杯酒问清楚' }],
    back: '回鲁半夏处，看这杯酒怎么还',
    reveal: [
      { t: 'say', raw: '「六年前那杯酒，是我端的。汪秋被带走那天，我吐了一整夜。」' },
      { t: 'narrate', raw: '她说完，把袖子往上撸了撸，露出腕上一道旧疤。' },
    ],
    menu: {
      title: '那味哑药',
      opts: [
        { label: '助汪秋翻旧账', eff: ['+karma:10', '+exp:240', 'favor:npcv_021:30', 'flag:hk_npcv_186_yao_clear'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_186:10'] },
      ],
    },
    reward: '鲁半夏把灶里最后一张纸拨了拨，火苗暗下去。',
  },

  /* ===== V20 阮听 ===== */
  {
    id: 'hk_npcv_090_jieyao', npc: 'npcv_090', cmd: '问他毒', title: '丁春秋的解药', level: 9,
    desc: '阮听在果子摊后坐着，手一按腕子，话就停。丁春秋种在他身上的蛊，发了七年。',
    goals: [{ room: 'jn_fruit_stall', desc: '在果子摊听他讲蛊发时的样子' }],
    back: '回阮听跟前，看这味解药怎么求',
    reveal: [
      { t: 'narrate', raw: '他讲到一半，手忽然按住腕子，指节发白，话停了。' },
      { t: 'say', raw: '「一年一续。续不上，就烂在这里。」' },
    ],
    menu: {
      title: '那味解药',
      opts: [
        { label: '替他再跑一趟星宿海', eff: ['+exp:260', '+pot:70', 'favor:npcv_090:40', 'flag:hk_gu'] },
        { label: '劝他离开丁春秋', eff: ['+karma:10', '+exp:240', 'favor:npcv_090:20', 'flag:hk_npcv_090_jieyao_leave'] },
      ],
    },
    reward: '阮听松开按着腕子的手，把摊上那筐果子摆正了些。',
  },
  {
    id: 'hk_npcv_090_meimei', npc: 'npcv_090', cmd: '问妹妹', title: '妹妹那碗药', level: 12,
    require: { questDone: 'hk_npcv_090_jieyao' },
    desc: '阮听有个亲妹妹，也中着毒。碗是谁端的，他从没说过。',
    goals: [{ room: 'gusu_yanzi', desc: '去姑苏·燕子坞，找郎中毛清辨那碗药的毒' }],
    back: '回果子摊，把这碗药的底细摊在阮听面前',
    reveal: [
      { t: 'say', raw: '「我给她下过一味不会死的毒。就为了丁春秋信我还有用，肯续我的解药。」' },
      { t: 'narrate', raw: '他摊开手掌，掌心里一道旧疤，是常年攥着药包磨出来的。' },
    ],
    menu: {
      title: '妹妹那碗药',
      opts: [
        { label: '替他妹妹解蛊并告知真相', eff: ['+karma:15', '+pot:70', '+exp:280', 'favor:npcv_090:-30', 'flag:hk_npcv_090_meimei_tell'] },
        { label: '瞒下', eff: ['+karma:-5', '+exp:140', 'favor:npcv_090:20'] },
      ],
    },
    reward: '阮听把摊子收了半扇，说今天不做生意了。',
  },

  /* ===== V21 和归鸿 ===== */
  {
    id: 'hk_npcv_074_yajian', npc: 'npcv_074', cmd: '递话', title: '雅间那句话', level: 7,
    desc: '和归鸿替雅间传了三十回话，一两银子一回。第三十一回，他坐着没动。',
    goals: [{ room: 'jn_teahouse', desc: '在老茶馆，看他这三十回话是怎么传的' }],
    back: '回和归鸿跟前，看这句话传不传',
    reveal: [
      { t: 'say', raw: '「我传了三十回话，一两银子一回。这一回，我不想传了。」' },
      { t: 'narrate', raw: '他把茶钱一文一文数出来，压在碗底，数到一半停了。' },
    ],
    menu: {
      title: '那句话',
      opts: [
        { label: '替他把话断了', eff: ['+karma:12', '+exp:240', '+pot:60', 'favor:npcv_074:40', 'flag:hk_npcv_074_yajian_stop'] },
        { label: '替他继续传', eff: ['+money:200', '+karma:-15', '+exp:150', 'favor:npcv_074:20', 'flag:hk_npcv_074_yajian_go'] },
      ],
    },
    reward: '和归鸿把数到一半的茶钱推回去，起身出了茶馆。',
  },
  {
    id: 'hk_npcv_074_qian', npc: 'npcv_074', cmd: '找强秋', title: '偷换的那坛酒', level: 9,
    require: { questDone: 'hk_npcv_074_yajian' },
    desc: '镖师强秋在老茶馆坐了很久，等一个说法。那趟误期的镖，坏在一坛酒上。',
    goals: [{ room: 'jn_teahouse', desc: '在老茶馆找强秋，问那趟误期的镖' }],
    back: '回和归鸿处，看这坛酒的账怎么还',
    reveal: [
      { t: 'say', raw: '「强秋那晚的酒，是我换的。他在门外站了半宿，我在屋里没敢开门。」' },
      { t: 'narrate', raw: '他说完，往强秋常坐的那张桌子看了一眼。' },
    ],
    menu: {
      title: '那坛酒',
      opts: [
        { label: '替他还强秋一个说法', eff: ['+karma:10', '+exp:260', '+pot:60', 'favor:npcv_081:40', 'flag:hk_npcv_074_qian_clear'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_074:10'] },
      ],
    },
    reward: '和归鸿给强秋斟了一碗茶，坐到了他对面。',
  },

  /* ===== V22 陈语冰 ===== */
  {
    id: 'hk_npcv_252_minge', npc: 'npcv_252', cmd: '问名额', title: '那个名额', level: 8,
    require: { not: { flag: 'know_zhenyi' } },
    desc: '醉春楼一年一个脱籍的名额。教陈语冰认字的那个人，跟她抢同一个。',
    goals: [{ room: 'jn_brothel_hall', desc: '去醉春楼花厅，找梅拾问名额的事' }],
    back: '回房里，看这个名额怎么定',
    reveal: [
      { t: 'say', raw: '「梅拾教我认字那天，我记着呢。楼里就一个名额。」' },
      { t: 'narrate', raw: '她把桌上的字帖翻过去，压在底下。' },
    ],
    menu: {
      title: '那个名额',
      opts: [
        { label: '劝她让贤', eff: ['+karma:15', '+exp:240', '+pot:60', 'favor:npcv_219:40', 'favor:npcv_252:-20', 'flag:hk_npcv_252_minge_yield'] },
        { label: '替她争到', eff: ['+money:200', '+karma:-15', '+exp:150', 'favor:npcv_252:30', 'flag:hk_npcv_252_minge_win'] },
      ],
    },
    reward: '陈语冰把字帖又翻回来，指腹在第一个字上停了停。',
  },
  {
    id: 'hk_npcv_252_zi', npc: 'npcv_252', cmd: '问那本书', title: '枕下那个字', level: 11,
    require: { questDone: 'hk_npcv_252_minge' },
    desc: '陈语冰枕下压着一张纸，压了很久。',
    goals: [{ room: 'jn_brothel_room', desc: '在房里，看她枕下那张纸' }],
    back: '回她跟前，看这张纸留不留',
    reveal: [
      { t: 'narrate', raw: '她从枕下抽出一张纸，上面只有一个字，笔画歪歪扭扭——是梅拾教她写的头一个。' },
      { t: 'say', raw: '「恨得越狠，这张纸越舍不得烧。」' },
    ],
    menu: {
      title: '枕下那个字',
      opts: [
        { label: '让梅拾知晓', eff: ['+karma:5', '+exp:220', 'favor:npcv_219:30', 'favor:npcv_252:-20', 'flag:hk_npcv_252_zi_tell'] },
        { label: '什么都不说', eff: ['+exp:100', 'favor:npcv_252:10'] },
      ],
    },
    reward: '陈语冰把那张纸重新压回枕下，抹平了枕面。',
  },

  /* ===== V23 钱疏 ===== */
  {
    id: 'hk_npcv_178_fangzi', npc: 'npcv_178', cmd: '问她药', title: '方子卖给谁了', level: 7,
    desc: '钱疏手里半张方子，是药婆婆救她命时给的。后来方子到了山下。',
    goals: [{ room: 'huashan_shanxia', desc: '在华山脚下，看钱疏那半张方子' }],
    back: '回钱疏跟前，看这方子收不收得回来',
    reveal: [
      { t: 'say', raw: '「山下的人，心比天冷。她不缺这点药。」' },
      { t: 'narrate', raw: '她说这话时，眼睛看着别处。' },
    ],
    menu: {
      title: '那半张方子',
      opts: [
        { label: '替她把方子收回来', eff: ['+karma:15', '+exp:240', '+pot:60', 'favor:wen_huashan_shop:40', 'flag:hk_npcv_178_fangzi_back'] },
        { label: '替她卖出去', eff: ['+money:150', '+karma:-15', '+exp:150', 'favor:npcv_178:20', 'flag:hk_npcv_178_fangzi_sell'] },
      ],
    },
    reward: '钱疏把那半张方子折起来，塞进袖里。',
  },
  {
    id: 'hk_npcv_178_jiao', npc: 'npcv_178', cmd: '问她那张纸', title: '剩下的那半个角', level: 9,
    require: { questDone: 'hk_npcv_178_fangzi' },
    desc: '钱疏撕方子撕了三年，撕剩半个角。',
    goals: [{ room: 'huashan_shanxia', desc: '在华山脚下，看她掏出那半个角' }],
    back: '回钱疏跟前，看这半个角怎么处置',
    reveal: [
      { t: 'narrate', raw: '她看了三年，撕了三年。剩下的那半个角，她一直没舍得撕。' },
      { t: 'say', raw: '「撕得动纸，撕不动这个角。」' },
    ],
    menu: {
      title: '那半个角',
      opts: [
        { label: '带她向药婆婆认错', eff: ['+karma:12', '+exp:260', '+pot:60', 'favor:wen_huashan_shop:30', 'flag:hk_npcv_178_jiao_grey'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_178:10'] },
      ],
    },
    reward: '钱疏把那半个角收进贴身的小袋，没再撕。',
  },

  /* ===== V24 庞南枝 ===== */
  {
    id: 'hk_npcv_095_qi', npc: 'npcv_095', cmd: '问契', title: '半张契', level: 8,
    desc: '城西破庙，出家人斗了七年庙产。庞南枝手里那半张契，年份是后添的。',
    goals: [{ room: 'jn_yamen_arch', desc: '去衙门·架阁库，调那批庙产的旧档' }],
    back: '回破庙，看这半张契呈不呈上去',
    reveal: [
      { t: 'narrate', raw: '她把那半张契举到日头底下——年份那两个字的墨色，比别处新。' },
      { t: 'say', raw: '「我师父说过莫争。我争了七年，一次没下过狠手。」' },
    ],
    menu: {
      title: '那半张契',
      opts: [
        { label: '替她压下', eff: ['+karma:-15', '+exp:240', '+pot:60', 'flag:hk_npcv_095_qi_hide'] },
        { label: '把旧档原样呈上', eff: ['+rep:朝廷:20', '+exp:260', 'flag:hk_npcv_095_qi_show'] },
      ],
    },
    reward: '庞南枝把契收进佛龛后头，压在一部经书上。',
  },
  {
    id: 'hk_npcv_095_shifu', npc: 'npcv_095', cmd: '劝和', title: '师父那句「莫争」', level: 10,
    require: { questDone: 'hk_npcv_095_qi' },
    desc: '庞南枝的师父临走留了一句「莫把心思用在争上」。她记了七年。',
    goals: [{ room: 'jiangnan_temple', desc: '在破庙找任停、和青荷，问这桩争端的旧底' }],
    back: '回庞南枝处，看这场七年之斗怎么收',
    reveal: [
      { t: 'say', raw: '「我争了七年，一次没下过狠手——我知道为什么。那半张契，是我添的。」' },
      { t: 'narrate', raw: '她说完，把那半张契拿出来，当着你的面撕了。' },
    ],
    menu: {
      title: '七年了',
      opts: [
        { label: '替她与任停了断', eff: ['+karma:12', '+exp:280', '+pot:70', 'flag:hk_npcv_095_shifu_end'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_095:10'] },
      ],
    },
    reward: '庞南枝扫起了佛前的碎纸，扫得很慢。',
  },

  /* ===== V25 鲁拂衣 ===== */
  {
    id: 'hk_npcv_036_juanzi', npc: 'npcv_036', cmd: '问考卷', title: '樊湘那一页', level: 8,
    desc: '翰墨斋后堂收着一页考卷。樊湘落第那年，这一页不见了。',
    goals: [{ room: 'jn_study_1', desc: '在后堂找樊湘、岑元，问落第那年的考卷' }],
    back: '回鲁拂衣处，看这一页还还不回去',
    reveal: [
      { t: 'say', raw: '「读书人的事，算不得手段。」' },
      { t: 'narrate', raw: '她说「手段」两个字时，声音低了些。' },
    ],
    menu: {
      title: '那一页考卷',
      opts: [
        { label: '替她还回去', eff: ['+karma:15', '+exp:240', '+pot:60', 'favor:npcv_234:40', 'flag:hk_npcv_036_juanzi_back'] },
        { label: '替她压下', eff: ['+rep:*:10', '+karma:-15', '+exp:150', 'favor:npcv_036:20', 'flag:hk_npcv_036_juanzi_hold'] },
      ],
    },
    reward: '鲁拂衣把那一页夹回了原处，压得很平。',
  },
  {
    id: 'hk_npcv_036_kai', npc: 'npcv_036', cmd: '问那本书', title: '书里夹着的那页纸', level: 10,
    require: { questDone: 'hk_npcv_036_juanzi' },
    desc: '鲁拂衣的书里夹着一张纸，她从没敢翻到那一页。',
    goals: [{ room: 'jn_study_1', desc: '在后堂看鲁拂衣自己翻出夹着的那页纸' }],
    back: '回鲁拂衣跟前，看这页纸怎么处置',
    reveal: [
      { t: 'narrate', raw: '她抽出一本书，翻到某一页——里面夹着的，是樊湘那一页考卷。' },
      { t: 'say', raw: '「我自认清高。这页纸，我一直不敢翻这本。」' },
    ],
    menu: {
      title: '那页纸',
      opts: [
        { label: '助樊湘翻落第', eff: ['+karma:12', '+exp:260', 'favor:npcv_234:40', 'favor:npcv_036:-30', 'flag:hk_npcv_036_kai_grey'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_036:10'] },
      ],
    },
    reward: '鲁拂衣把那本书合上，插回了书架最里一排。',
  },

  /* ===== V26 夏承志 ===== */
  {
    id: 'hk_npcv_082_mibao', npc: 'npcv_082', cmd: '问旧仆', title: '埋在院里那份副本', level: 9,
    require: { not: { flag: 'know_depot_master' } },
    desc: '天牢里那个老仆，每递一回密报，就在院里埋一份副本。',
    goals: [{ room: 'jn_yamen_court', desc: '去衙门·大堂，见元怀瑾，问那份副本的下落' }],
    back: '回天牢，看这份副本怎么处置',
    reveal: [
      { t: 'narrate', raw: '他领你到院角，蹲下来刨开一层土，露出一角油纸包。' },
      { t: 'say', raw: '「我每递一回，就埋一份。不是留证据——是留后路。」' },
    ],
    menu: {
      title: '院里那份副本',
      opts: [
        { label: '替他收好', eff: ['+exp:260', '+pot:70', 'favor:npcv_082:40', 'flag:hk_npcv_082_mibao_keep'] },
        { label: '交给东厂', eff: ['+rep:朝廷:20', '+exp:200', 'favor:npcv_149:-50', 'flag:hk_npcv_082_mibao_give'] },
      ],
    },
    reward: '夏承志把那个油纸包重新埋回土里，把土踩实了。',
  },
  {
    id: 'hk_npcv_082_hua', npc: 'npcv_082', cmd: '问那幅画', title: '书房里那幅画', level: 11,
    require: { questDone: 'hk_npcv_082_mibao' },
    desc: '元怀瑾书房挂着一幅画，夏承志理了三十年，一次没敢多看。',
    goals: [{ room: 'palace_prison', desc: '在天牢，随夏承志去看那幅画' }],
    back: '回他跟前，看这幅画的旧事怎么收',
    reveal: [
      { t: 'say', raw: '「老爷书房那幅画，我理了三十年，一次没敢多看。可那幅画上记的事，是我写进去的。」' },
      { t: 'narrate', raw: '他说到「写进去」三个字，手在袖子里攥了一下。' },
    ],
    menu: {
      title: '书房里那幅画',
      opts: [
        { label: '助元怀瑾自清', eff: ['+karma:15', '+exp:280', '+pot:70', 'favor:npcv_149:40', 'flag:hk_npcv_082_hua_clear'] },
        { label: '不问', eff: ['+exp:100', 'favor:npcv_082:10'] },
      ],
    },
    reward: '夏承志把牢门掩上，退回到廊下那张旧凳上坐着。',
  },
];

/* ------------------------------------------------------------------ *
 * 新增物品（design/23 §3 清单，5 件）
 * ------------------------------------------------------------------ */
const ITEMS = {
  ledger_yinzi: {
    id: 'ledger_yinzi', name: '印子账本', type: 'misc', value: 60,
    desc: '封皮磨得起了毛，里头一页一行，写着谁欠多少、利几成。字不好看，数却一个不错。',
    tags: ['book'], quality: 'common',
  },
  deed_girl: {
    id: 'deed_girl', name: '一张卖身契', type: 'misc', value: 40,
    desc: '纸边压得发黄，落款是三年前。底下按着一个褪了色的指印，像一朵小梅花。',
    tags: ['book'], quality: 'common',
  },
  ledger_haosun: {
    id: 'ledger_haosun', name: '耗损账底', type: 'misc', value: 55,
    desc: '一页账底，墨色比别处重。数目对不上仓里的米，多出来的那一截没有日期。',
    tags: ['book'], quality: 'common',
  },
  iou_du: {
    id: 'iou_du', name: '一张旧字据', type: 'misc', value: 70,
    desc: '揣了三十年，边角磨得浑圆。落款人的名字已经模糊，底下那个数却认得清。',
    tags: ['book'], quality: 'common',
  },
  fake_silk: {
    id: 'fake_silk', name: '一匹掺麻的绸', type: 'misc', value: 35,
    desc: '面上看着光鲜，剪口里牵着麻丝，照光一捋，扎手。',
    tags: ['cloth'], quality: 'poor',
  },
};

/* ------------------------------------------------------------------ *
 * 新增房间（design/23 §3 清单，3 间）——出口严格双向对称
 * 反向边以「合并进既有房间」的方式补齐（exits 是对象，deepMerge 只加键不删键）
 * ------------------------------------------------------------------ */
const ROOMS = {
  gusu_fengqiao: {
    id: 'gusu_fengqiao', name: '姑苏·枫桥', region: 'gusu',
    desc: '桥是老石桥，桥洞底下常泊着小船。船家说，这桥夜里过的人多，白天反倒清净。桥头一块石碑，字被水汽蚀得看不清了。',
    exits: { w: 'gusu_zhai_lane' },
  },
  jn_granary: {
    id: 'jn_granary', name: '东市·粮仓', region: 'market',
    desc: '粮囤一排排码到房梁，麻袋上落着薄薄一层灰。角上那堆米比别处浅一截，人踩上去，脚感是软的。',
    exits: { n: 'jn_pottery' },
  },
  jn_yizhuang: {
    id: 'jn_yizhuang', name: '城西·义庄旧址', region: 'jiangnan',
    desc: '院墙塌了半面，院里空着，只剩一张验尸的旧木案。青砖地上有几道浅浅的划痕，是长年累月磨出来的。',
    exits: { nw: 'jiangnan_west_road' },
  },
};

/* 既有房间补反向边（只加键，不动原 exits 的其它键） */
const ROOM_EXIT_PATCH = {
  gusu_zhai_lane: { exits: { e: 'gusu_fengqiao' } },
  jn_pottery: { exits: { s: 'jn_granary' } },
  jiangnan_west_road: { exits: { se: 'jn_yizhuang' } },
};

/* ------------------------------------------------------------------ *
 * 新增 NPC（design/23 §3：Q20 需要「说书人」，标记为待补）
 * ------------------------------------------------------------------ */
const NPCS = {
  hk_storyteller: {
    id: 'hk_storyteller', name: '柳三弦', gender: 'male', tag: 'artist',
    desc: '茶馆角落里支着一张矮凳，膝上一把旧三弦。开讲前先抿一口茶，醒木压在手边，讲到要紧处才拍一下。',
    room: 'jn_teahouse', level: 12, hp: 210, atk: 22, def: 16, dodge: 15, speed: 18, money: 88,
    hostile: false, likes: ['music', 'porcelain'], favorBase: 0.7, favorInit: 5,
    carry: { money: 40, items: ['wine_jar'] },
    talk: ['醒木一响，各位静听。', '词里的事，十句有八句是真的。'],
    socialDone: true,
    schedule: { day: 'jn_teahouse', night: 'jn_teahouse' },
    rel: [{ id: 'npcv_065', kind: '友' }, { id: 'npcv_074', kind: '友' }],
    relDone: true,
    teach: ['basic_fist'],
    learned: { basic_fist: { level: 40 }, jh_fist: { level: 40, exp: 0 }, jh_parry: { level: 34, exp: 0 } },
    skills: { 拳: 'jh_fist', 招架: 'jh_parry' },
    favorToLearn: 40, age: 55, tier: 'B', district: 'market',
    unlock: { favor: 20 }, homeless: true, job: 'storyteller', title: '说书人',
    province: '江南东道', neighbors: ['杜听涛', '和归鸿'],
  },
};

/* ------------------------------------------------------------------ *
 * 组装
 * ------------------------------------------------------------------ */

/* ⚠️ 引擎能力缺口：modapi 的 `favor:<npcId>:N` 效果走 `w.getNpc(id)`，
   而 `getNpc` = `instances.npcs[id]`，实例是按 uid 存的（不是 defId）→ 对模板 NPC
   **永远取不到 = 空操作**（既有 262 条 sq_npcv_* 的 favor 奖励同样打空）。
   等价写法：把好感增量镜像进玩家变量 `favor_<npcId>`（可读、可做 cond，也是
   design/23 §14-1 建议的形式）。`favor:` 原样保留：词条本身没错，日后引擎修了 getNpc 就自动生效。 */
function mirrorFavor(eff) {
  const out = [];
  for (const e of eff) {
    out.push(e);
    const m = /^favor:([^:]+):(-?\d+)$/.exec(e);
    if (m) out.push(`incvar:favor_${m[1]}:${m[2]}`);
  }
  return out;
}

/* 每条 quest → 引擎标准 quest 结构
 * ⚠️ 只把「目标房间」挂在各 stage 的 targets 上；**最后一段**再带上
 *   物品发放 + 秘密演出 + 抉择 menu。不写 cond 链——
 *   tryReportQuest 交任务时会把该 stage 的 target var 清零，用同一个 var 做下一段 cond
 *   会直接把下一段锁死（实测 stage 卡在 1 到不了 99）。多腿（Q13）由 stage 顺序天然分段。 */
function buildQuest(spec) {
  const id = spec.id;
  const stages = [];
  spec.goals.forEach((g, i) => {
    const isLast = i === spec.goals.length - 1;
    const st = {
      desc: g.desc,
      targets: [{ id: 'go' + i, kind: 'room', key: g.room, count: 1, var: `${id}_go${i}`, desc: g.desc }],
      next: isLast ? 99 : i + 1,
    };
    if (isLast) {
      const effects = [];
      for (const it of (spec.items || [])) effects.push({ type: '+item', args: [it, 1] });
      for (const r of (spec.reveal || [])) effects.push({ type: r.t, raw: r.raw });
      effects.push({ type: 'menu', raw: `${spec.menu.title}|${spec.menu.opts.map(o => `${o.label}>${mirrorFavor(o.eff).join(';')}`).join(';;')}` });
      st.effects = effects;
    }
    stages.push(st);
  });

  const q = {
    id, name: spec.title, type: '支线', npc: spec.npc, giver: spec.npc, level: spec.level,
    desc: spec.desc,
  };
  if (spec.require) q.require = spec.require;
  q.stages = stages;
  q.rewards = [{ type: 'say', raw: spec.reward }];
  return q;
}

const out = { quests: {}, items: {}, rooms: {}, npcs: {} };
for (const spec of QUESTS) out.quests[spec.id] = buildQuest(spec);
Object.assign(out.items, ITEMS);
Object.assign(out.rooms, ROOMS, ROOM_EXIT_PATCH);
Object.assign(out.npcs, NPCS);

/* 26 位挂牌 NPC：合并进 quests（供 report / 可接任务）+ actions（挂牌指令） */
const byNpc = {};
for (const spec of QUESTS) {
  (byNpc[spec.npc] = byNpc[spec.npc] || []).push(spec);
}
for (const npcId of A26) {
  const specs = byNpc[npcId] || [];
  out.npcs[npcId] = {
    id: npcId,
    quests: specs.map(s => s.id),
    actions: specs.map(s => ({
      cmd: s.cmd, label: s.cmd, keywords: [], desc: s.title,
      cond: { not: { quest: s.id } },
      effects: [
        { type: 'narrate', raw: s.desc },
        { type: 'quest', args: [s.id, 0] },
      ],
    })),
  };
}

/* ------------------------------------------------------------------ *
 * 自检（生成期，早于写盘）
 * ------------------------------------------------------------------ */
const problems = [];
const norm = require(path.join(ROOT, 'game', 'src', 'core', 'utils.js')).normalizeCmd;
for (const spec of QUESTS) {
  if (!spec.id.startsWith('hk_')) problems.push(`${spec.id}: id 前缀不是 hk_`);
  if (spec.menu.opts.length < 2) problems.push(`${spec.id}: 抉择不足 2 个`);
  const nonCombat = spec.menu.opts.filter(o => !o.eff.some(e => /^combat:/.test(e)));
  if (nonCombat.length < 2) problems.push(`${spec.id}: 非战斗解法不足 2 个`);
  if (norm(spec.cmd) !== spec.cmd) problems.push(`${spec.id}: 挂牌指令 ${spec.cmd} 会被口语归一化改成 ${norm(spec.cmd)}`);
}
const seenIds = new Set();
for (const spec of QUESTS) { if (seenIds.has(spec.id)) problems.push('重复 id ' + spec.id); seenIds.add(spec.id); }
if (QUESTS.length !== 52) problems.push('quest 数不是 52：' + QUESTS.length);
/* 出口双向对称（新房间 ↔ 被补边的既有房） */
const roomsAll = Object.assign({}, require(path.join(ROOT, 'game', 'data', '50_map.json')).rooms, ROOMS, ROOM_EXIT_PATCH);
const REV = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };
for (const rid of Object.keys(ROOMS)) {
  const r = roomsAll[rid];
  for (const d of Object.keys(r.exits)) {
    const to = r.exits[d];
    const tr = roomsAll[to];
    if (!tr) { problems.push(`${rid}.${d} → ${to} 目标不存在`); continue; }
    const back = tr.exits[REV[d]];
    if (back !== rid) problems.push(`出口不对称：${rid}.${d}=${to}，但 ${to}.${REV[d]}=${back}`);
  }
}

if (problems.length) {
  console.error('生成自检未通过：\n - ' + problems.join('\n - '));
  process.exit(1);
}

const text = JSON.stringify(out, null, 2) + '\n';
fs.writeFileSync(OUT, text, 'utf8');

/* 写盘后逐字节回读比对（本项目踩过「多写一个尾换行」的坑） */
const back = fs.readFileSync(OUT, 'utf8');
if (back !== text) { console.error('回读 !== 写入：字节不一致'); process.exit(1); }
const reread = JSON.parse(back);
console.log('✔ 已写 ' + path.relative(ROOT, OUT));
console.log('  quests ' + Object.keys(reread.quests).length +
  ' · items ' + Object.keys(reread.items).length +
  ' · rooms ' + Object.keys(reread.rooms).length +
  ' · npcs ' + Object.keys(reread.npcs).length);
console.log('  字节回读一致 ✔　尾换行 ✔');
