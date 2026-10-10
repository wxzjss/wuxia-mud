'use strict';
/* ==========================================================================
 *  新手引导 · 连续剧情任务（2026-10-10 第二次重做）
 *
 *  这次重做的来由（主人原话）：
 *    「还有玩家进入游戏触发的剧情没有后续吗？如果有的话『任务』快捷键里面
 *      没看到。这个剧情应该一路引导玩家拜入一个宗门才对，把这个做成新手教程吧」
 *
 *  旧版是什么：一张 8 步的**清单**（先看看脚下 → 挪一步 → 练一趟功 …）。
 *  每一步都对着，但它是「教程」，不是「故事」——
 *    · 楔子讲完「你一双草鞋磨穿了底」，下一页就是「敲 look」，
 *      中间没有人物、没有缘由，玩家不知道自己为什么该去拜师；
 *    · 「拜进门派」那一步写着「走到门派山门前」，可满世界十四家山门，
 *      没有任何东西告诉你该去哪一座；
 *    · 拜师成功后这条线就断了，跟主线接不上。
 *
 *  新版是什么：一条**连续的剧情任务**——
 *    楔子（出身各不同）→ 茶摊老汉叫住你 → 他给你一封引荐信 →
 *    他指一座山门（**由出身决定**，每个出身指的方向都不一样）→
 *    你递信入门 → 尾声把线交给主线。
 *    这条线在「任务」面板里**置顶**显示当前进度（做完就不再置顶），
 *    在「新手教程」面板里能翻到全流程。
 *
 *  ⚠️ 三条不能破的旧铁律（上一版踩过，重做时原样保留）：
 *    1. **只测玩家状态，不测 UI 动作**。面板化会改路由，状态不会。
 *    2. **顺序游标**：前一步没完成，后面的步一律锁住（locked），杜绝跳步假完成。
 *    3. **零兜底**：不许出现「或某个与教学目标无关的状态」这种捷径。
 * ========================================================================== */

/* ==========================================================================
 *  一、章节（storyline）
 *
 *  id / requires / test 三项**与旧版逐字一致**——测试盯着这八步，
 *  重做的是「怎么讲」，不是「怎么判」。新增的是：
 *    no    章次（给面板显示「第 N 章」）
 *    story 旁白（把这一步放进剧情里，而不是干下一道指令）
 *  可用的占位符：{sect}=目标势力名　{gate}=山门所在　{art}=该门招牌武学
 * ========================================================================== */
const STEPS = [
  {
    id: 'look',
    no: 1,
    title: '看清楚自己',
    goal: '认清这是什么地方、身上有什么',
    hint: '敲 look（「看」「看看四周」也行）',
    story: '茶摊的老汉没抬头，只把灶里的柴拨了拨。你得先知道自己站在哪儿、手里有什么——'
      + '这一路没人替你数家当。',
    requires: [],
    test: (p) => p.tutorialFlags.has('did_look'),
  },
  {
    id: 'move',
    no: 2,
    title: '把这地方走一遍',
    goal: '换个落脚的地方',
    hint: '敲 n 往北，或 s / e / w 换方向；点左侧「世界 · 地图」，挑隔壁那间走过去也行',
    story: '老汉终于开口：「这条道往北二里是江南城。你连道口都没走完，问我门路也是白问。」',
    requires: ['look'],
    test: (p) => p.tutorialFlags.has('did_move'),
  },
  {
    id: 'skill',
    no: 3,
    title: '身上得有点底子',
    goal: '动一动气血，身上添几分底气',
    hint: '敲 lian 练功（「练功」「打坐」都行）；武学面板里挑一门功法打坐也可',
    story: '你回到茶摊时，老汉正看你走路的样子。「就这两条腿，进哪座山门都得被人一脚踹出来。」'
      + '他把扇子往灶边一搁，「先练一趟给我看看。」',
    requires: ['move'],
    test: (p) => p.tutorialFlags.has('did_train')
      || (typeof p.practiceCount === 'number' && p.practiceCount > 0),
  },
  {
    id: 'talk',
    no: 4,
    title: '老汉有话同你说',
    goal: '听茶摊老汉把话说完',
    hint: '敲 talk 卖茶的老汉（「交谈」「询问」也行）',
    story: '一趟拳下来，你喘得像拉风箱。老汉看了半晌，从怀里摸出个东西——'
      + '不是钱，是一封旧信，封皮上只按了个指印。',
    requires: ['skill'],
    test: (p) => p.tutorialFlags.has('did_talk'),
  },
  {
    id: 'quest',
    no: 5,
    title: '替人办件事',
    goal: '领一桩旁人托付的活儿',
    hint: '找个人用「接任务 <任务名>」（或 accept）接下；敲「任务」看手里有哪些委托',
    story: '「山门不白收人。」老汉把信又收了回去，「你先去替人办一件小事。'
      + '办得成，人家才信你不是来混饭吃的。」',
    requires: ['talk'],
    test: (p) => p.tutorialFlags.has('did_accept')
      || Object.keys(p.quests || {}).some(k => k !== 'q_main_jianghu'),
  },
  {
    id: 'fight',
    no: 6,
    title: '手上得有分寸',
    goal: '赢下一场架',
    hint: '找个下得去手的「动手 <人名>」（kill）；打不过就「逃跑」（flee）。'
      + '山贼、恶狼这类先动手的最合适——别拿路人试刀',
    story: '「江湖上不讲道理的人多。」老汉用火钳指了指北边，'
      + '「哪天有人拦你的路，你得打得回去，还得知道什么时候不该打。」',
    requires: ['quest'],
    test: (p) => (p.kills || 0) >= 1,
  },
  {
    id: 'sect',
    no: 7,
    title: '递信上山门',
    goal: '拜进门派，学一身真本事',
    hint: '往 {gate} 去，在门口发「拜师 {sect}」（join）。有老汉那封信，山门会破例收你',
    story: '老汉把引荐信拍在你手心里：「{sect}。到了{gate}，把信递上去，'
      + '说是城南茶摊的老汉给的。他们认这个指印。」',
    requires: ['fight'],
    test: (p) => !!p.sect,
  },
  {
    id: 'save',
    no: 8,
    title: '把这一程存下',
    goal: '存下这一程，下回接着走',
    hint: '敲「存档」（save）；下回点「继续游戏」，接着这条路走',
    story: '你走出很远才回头。老汉还在扇他的火，头也没抬。这一程到此为止，'
      + '往后的路没人再指点你了。',
    requires: ['sect'],
    test: (p) => p.tutorialFlags.has('did_save'),
  },
  {
    id: 'free',
    no: 9,
    title: '往后的路自己走',
    goal: '往后的路，自己拿主意',
    hint: '点左侧「世界 · 地图」看舆图，四处走走，寻访五派的信物',
    story: '',
    requires: [],
    test: () => false,   // 永不完成，作为「毕业」提示
  },
];

/** 指令 -> 引导标记 的映射（玩家做了这些动作就点亮对应步骤） */
const CMD_FLAGS = {
  look: 'did_look', l: 'did_look', 看: 'did_look', 观察: 'did_look', 查看四周: 'did_look',
  lian: 'did_train', train: 'did_train', 练功: 'did_train', 打坐: 'did_train', 修炼: 'did_train',
  talk: 'did_talk', ask: 'did_talk', 交谈: 'did_talk', 询问: 'did_talk', 打招呼: 'did_talk',
  accept: 'did_accept', 接取: 'did_accept', 接任务: 'did_accept', 领任务: 'did_accept',
  get: 'did_get', take: 'did_get', 捡: 'did_get', 拾取: 'did_get', 拿: 'did_get', 捡起: 'did_get',
  save: 'did_save', 存档: 'did_save', 保存: 'did_save',
  n: 'did_move', s: 'did_move', e: 'did_move', w: 'did_move', u: 'did_move', d: 'did_move',
  north: 'did_move', south: 'did_move', east: 'did_move', west: 'did_move',
  北: 'did_move', 南: 'did_move', 东: 'did_move', 西: 'did_move',
  往北走: 'did_move', 往南走: 'did_move', 往东走: 'did_move', 往西走: 'did_move',
};

/**
 * 非指令类的引导标记：由特定流程显式上报，不走 CMD_FLAGS 的「指令→标记」映射。
 * 目前只有 `seen_intro`（看过开场剧情）。markTutorialFlag 的白名单需包含它们。
 */
const EXTRA_FLAGS = ['seen_intro'];

/* ==========================================================================
 *  二、出身 → 该往哪座山门（这是「每个身份一条不同方向」的落点）
 *
 *  ⚠️ 用**数组**：首位是这个身份的「本命门派」，后面是万一前一家不收时的退路。
 *     实战里退路很少用得上 —— 老汉那封引荐信能让山门**破例**收人
 *     （见 character.joinSect 里对 vars.tutPass 的处理），
 *     所以每个身份都能稳稳走到自己那一条线上。
 *  ⚠️ 首位**不许重复**：13 个身份 → 13 家势力，一家一个方向。
 *     唯一没被点名的是侠客岛（要 level≥30，本来就该是后期的发现，不塞给新人）。
 * ========================================================================== */
const BIRTH_SECT = {
  orphan: ['gaibang', 'tangmen', 'miaojiang'],          // 街头孤儿 → 丐帮
  hunter: ['miaojiang', 'tangmen', 'gaibang'],          // 山里长大 → 苗疆五毒教
  wuxue: ['huashan', 'wudang', 'tangmen'],              // 武学世家 → 华山派
  noble: ['dali', 'wudang', 'tangmen'],                 // 官宦子弟 → 大理段氏
  scholar: ['wudang', 'taohua', 'tangmen'],             // 书香门第 → 武当派
  merchant: ['tangmen', 'taohua', 'gaibang'],           // 商贾之后 → 唐门
  monastic: ['shaolin', 'wudang', 'gaibang'],           // 山门弃婴 → 少林派
  taoist_ward: ['taohua', 'wudang', 'tangmen'],         // 道观道童 → 桃花岛
  tomb_keep: ['gumu', 'miaojiang', 'wudang'],           // 守墓人之后 → 古墓派
  deserter_child: ['xuedao', 'miaojiang', 'tangmen'],   // 逃卒之后 → 血刀门
  grudge_orphan: ['xingxiu', 'miaojiang', 'xuedao'],    // 血仇遗孤 → 星宿派
  border_drift: ['mojiao', 'miaojiang', 'xuedao'],      // 边地流人 → 日月神教
  nun_ward: ['emei', 'gumu', 'wudang'],                 // 庵堂孤儿 → 峨眉派
};

/** 势力 → 山门（引路要用；房间不存在时由调用方回落成「门派所在」） */
const SECT_GATE = {
  gaibang: 'gaibang_po_miao',
  miaojiang: 'miaojiang_zhai',
  huashan: 'huashan_shanxia',
  dali: 'dali_tianlong',
  wudang: 'wudang_shanmen',
  tangmen: 'tangmen_gate',
  shaolin: 'shaolin_shanmen',
  taohua: 'taohuadao_dock',
  gumu: 'gumu_shan',
  xuedao: 'beijiang_xuedao',
  xingxiu: 'xiyu_xingxiu',
  mojiao: 'mojiao_shanmen',
  emei: 'emei_shanmen',
  xiake: 'xiake_dukou',
};

/** 老汉替各家山门说的一句话（引荐时用，一家一句，别写成通稿） */
const SECT_PITCH = {
  gaibang: '丐帮收人不看家世，只看你熬不熬得住。破庙里那口锅，多少年没断过火。',
  miaojiang: '苗疆五毒教在西南，人人怕他们。可那地方不问你爹是谁，只问你敢不敢碰毒。',
  huashan: '华山派是五岳剑派里的一支，剑法轻灵，门户也严。你这双手，我看握得住剑。',
  dali: '大理段氏是皇亲，规矩大，可一阳指是实打实的内家功夫。你家里那点体面，到了那儿还算数。',
  wudang: '武当派讲的是个「慢」字。你读过书，静得下心，这条路走得通。',
  tangmen: '唐门在蜀中，暗器机关天下第一。他们不问出身，只问你手稳不稳。',
  shaolin: '少林是天下武学正统。你从小在庙里长大，那里的规矩你受得住。',
  taohua: '桃花岛那位脾气怪，收徒看眼缘。岛上奇门遁甲，学得进去一辈子受用。',
  gumu: '古墓派在终南山里，人不多，规矩也怪。可进门的人，没一个弱的。',
  xuedao: '血刀门在关外，名声不好听。刀法却是真狠——你手上那条路，他们不会拦你。',
  xingxiu: '星宿派在星宿海，丁老怪的地盘。想报你那份仇，那地方教的东西最快。',
  mojiao: '日月神教在黑木崖。正派骂他们魔教，可教里收人最爽快——有本事就上得来。',
  emei: '峨眉派是师太当家，剑法里带着佛门气。庵堂里长大的孩子，去那儿最合适。',
  xiake: '侠客岛……那地方不是现在该去的。先把本事攒够十年再说。',
};

/* ==========================================================================
 *  三、楔子（出身分版）
 *
 *  ⚠️ 取版**不引入随机数** —— 同一存档每次必须读到同一版，否则回档会换脸。
 *  ⚠️ 主线第一幕幕末信物「半块东厂铜牌」/「失忆」设定**一律不出现在楔子里**。
 *  ⚠️ 结尾一律落在同一个动作上：**灶前那个卖茶的老汉抬了抬下巴**，
 *     把玩家**递给新手教程第一章**。旧版楔子讲完就断了，这里补上接口。
 * ========================================================================== */

/** 共同收束：把玩家交给茶摊老汉（各版楔子结尾都用这一句，不再各写一遍） */
const INTRO_HANDOFF =
  '<p class="intro-p intro-em">老槐树底下支着个卖茶的小摊。灶前那老汉拨了拨柴，抬下巴朝你示意了一下——'
  + '不是赶你走，像是叫你过去坐。你还没想好说什么，他先开口了：「坐下。听我说两句。」</p>';

const INTRO_VARIANTS = {
  orphan: {
    title: '【楔子】一双破草鞋',
    body:
      '<p class="intro-p">江南大路的日头刚爬上老槐树，你一双草鞋已经磨穿了底。方才在南边岔路口，'
      + '两个汉子拦住你要买路钱，你攥紧扁担退了两步，退到这儿才甩开他们。</p>'
      + '<p class="intro-p">你蹲在树底下喘气。身上就一件粗布短褂、一柄削尖的木棍，'
      + '怀里半块硬得硌牙的干饼。这就是你从家里带出来的全部家当。</p>'
      + '<p class="intro-p">北边二里就是江南城，城门口挂着招贤的幡子。你摸了摸发软的两条腿，'
      + '心里清楚：这一路打不过人，护不住自己，进了城也是白搭。</p>'
      + '<p class="intro-p">你爹娘的样子你没见过。你只记得城南那口破井、冬天井沿结的冰，'
      + '和一群跟你一样没人管的孩子。后来井填了，孩子们也散了，就剩你一个还往北走。</p>',
  },
  hunter: {
    title: '【楔子】半张兽皮',
    body:
      '<p class="intro-p">江南大路的日头爬到老槐树顶的时候，你正把半张没硝好的兽皮往肩上挪。'
      + '皮子还带着腥气，一路招苍蝇。</p>'
      + '<p class="intro-p">你在山里长到十七岁，认得出三里外的脚印是狼是狗，'
      + '弓弦断过四回，都是自己拿筋条接的。爹说山里养不活人了，让你往南走一趟。</p>'
      + '<p class="intro-p">江南城在北边二里。你听人讲过，城里的门派比山里的岩洞还多，'
      + '可没有一家收猎户——猎户只会杀生，不懂什么「心法」「剑意」。</p>'
      + '<p class="intro-p">你摸了摸腰间那把猎刀。刀是自己打的，口子开得糙，'
      + '可剥过三百张兽皮，从没卷过刃。</p>',
  },
  wuxue: {
    title: '【楔子】一柄空剑鞘',
    body:
      '<p class="intro-p">日头刚爬上江南大路的老槐树，你身上的绸衫已经蒙了一层灰。'
      + '南边岔路口那两个拦路的汉子没敢近身——他们瞧见了你腰间那柄剑。</p>'
      + '<p class="intro-p">可你心里有数：剑是爹留下的，剑鞘是新的，剑法是空的。'
      + '真动上手，三招之内你就得伏低。</p>'
      + '<p class="intro-p">爹走的那年你还小，只记得院里那排木桩、每天早上五更的响动，'
      + '和后来忽然就没有了的响动。他把剑留给你，别的什么也没交代。</p>'
      + '<p class="intro-p">北边二里就是江南城。城里门派不少，可收不收你这样的空架子，'
      + '得看有没有人肯教真功夫。</p>',
  },
  noble: {
    title: '【楔子】一枚旧官印',
    body:
      '<p class="intro-p">江南大路的日头照在你袖子里那枚小印上。印是铜的，边角磨圆了，'
      + '是你父亲留下的最后一件东西。</p>'
      + '<p class="intro-p">一个月前，家里那扇朱漆大门被贴了封条。你从后墙翻出来的时候，'
      + '只来得及抓两件换洗衣裳和这枚印。至于罪名，到今日也没人跟你说明白。</p>'
      + '<p class="intro-p">南边岔路口那两个汉子认出了你腰间的玉带扣，笑得很难看。'
      + '你退到老槐树底下，才把气喘匀。</p>'
      + '<p class="intro-p">父亲说过，大理段氏跟家里有旧。可大理在千里之外，'
      + '你连江南城都没走出去。往北二里，是你眼下唯一的方向。</p>',
  },
  scholar: {
    title: '【楔子】一口旧书箱',
    body:
      '<p class="intro-p">江南大路的日头照在你那口书箱上，箱子比人还沉。'
      + '你是从北边书斋里出来的，家里盼你秋闱中举，你却揣了一封信，要去江南城寻一位旧识。</p>'
      + '<p class="intro-p">方才在南边岔路口，两个泼皮见你像个读书人，伸手就要翻箱子。'
      + '你护着书退到这儿，手心还在抖。这条江湖道，你才走了第一日。</p>'
      + '<p class="intro-p">信是父亲的一位故交写的，字很潦草，只写着「若逢大难，可往武当」。'
      + '你那时不懂什么叫大难，现在有点懂了。</p>'
      + '<p class="intro-p">你掏出那封信，纸角已被汗浸软。三日盘缠，一张名帖也没有。</p>',
  },
  merchant: {
    title: '【楔子】一袋碎银',
    body:
      '<p class="intro-p">江南大路的日头升起来时，你正数着钱袋里的碎银。'
      + '昨夜在南边岔路口破财免灾，给了那伙人两锭，才换得一条活路。</p>'
      + '<p class="intro-p">骡子驮着两箱货，垂着耳朵站在道边。你摸了摸它脖子上的鬃，手却在抖。'
      + '钱是够的，命是轻的。真遇上不讲理的，你连还手都不会——银子只会招祸。</p>'
      + '<p class="intro-p">货是唐门订的。单子上写得清楚：蜀中唐家堡，交货。'
      + '你父亲跑了半辈子这条线，去年病倒在床，把单子交给你时只说了一句：'
      + '「唐家的人不好惹，可他们守信用。」</p>'
      + '<p class="intro-p">北边二里就是江南城。要往蜀中去，先得活着走出这两百里。</p>',
  },
  monastic: {
    title: '【楔子】一身旧僧衣',
    body:
      '<p class="intro-p">江南大路的日头刚爬上老槐树，你身上那件僧衣已经洗得发白。'
      + '衣是寺里给的，你穿了十六年，从扫地穿到挑水，从挑水穿到撞钟。</p>'
      + '<p class="intro-p">知客僧说你是捡来的，生在寺门口，脐带都没剪干净。'
      + '你问过自己爹娘是谁，他摇摇头：「寺里不问这个。」</p>'
      + '<p class="intro-p">《金刚经》你背得下来，拳脚也练过几趟，'
      + '可上个月方丈叫你到跟前，说：「你这孩子，尘缘未了，寺里留不住。」'
      + '给了一钵饭、一句偈，就让你下山了。</p>'
      + '<p class="intro-p">北边二里就是江南城。你还没想明白那半句偈是什么意思。</p>',
  },
  taoist_ward: {
    title: '【楔子】半张符纸',
    body:
      '<p class="intro-p">江南大路的日头晒得人发晕，你手里那半张符纸却被汗攥湿了。'
      + '符是师父画的，只画了一半，朱砂断在中间，像是什么事没说完。</p>'
      + '<p class="intro-p">道观在半山腰，一共三间屋、一个丹炉。师父教你认药性、画符、看星象，'
      + '临了却什么也没交代。他走的那天，炉里的火还烧着，你自己把它灭了。</p>'
      + '<p class="intro-p">观里剩下的东西都让你背下来了——几本手抄的方子、'
      + '一沓黄符纸、还有师父写在墙上的八个字：东海有岛，问奇门。</p>'
      + '<p class="intro-p">北边二里是江南城。城里有船，往东出海口，你打听过。</p>',
  },
  tomb_keep: {
    title: '【楔子】一把生锈的钥匙',
    body:
      '<p class="intro-p">江南大路的日头正毒，你在道边蹲下歇脚。家门楣上「守墓」两个字掉了漆。'
      + '你打小就住在那儿，离村子半里地，除了清明没人来。</p>'
      + '<p class="intro-p">坟在屋后，一块无字碑，不知道埋的是谁。爹每年添土三回，'
      + '从不多话。他走之前，把一把钥匙塞给你，说：「碑下有个门。别开。」</p>'
      + '<p class="intro-p">守了三年，你还是开了。门后是石阶，往下十七级，'
      + '尽头一堵石壁，壁上刻着一行小字，只看清四个：终南山下。</p>'
      + '<p class="intro-p">你把钥匙贴身收好，锁了门，往北走。北边二里就是江南城。</p>',
  },
  deserter_child: {
    title: '【楔子】一把缺口刀',
    body:
      '<p class="intro-p">江南大路的日头照在你背上那把刀上。刀有缺口，是砍过铁的。'
      + '你还记得那个缺口的来历——那年过隘口，爹拿它挡了一下官差的钩镰。</p>'
      + '<p class="intro-p">爹从军伍里逃出来那年你才六岁，一路带着你往南跑，'
      + '走了整整八个月。半道上他把刀塞给你，说了句「往南，别回头」，就再没起来。</p>'
      + '<p class="intro-p">你一个人走了十年，什么活都干过。刀一直背着，宁可饿肚子也不当。'
      + '有人出过三贯钱买它，你把人打了一顿。</p>'
      + '<p class="intro-p">北边二里就是江南城。听说城外的关外道上，有人靠一把刀就能活。</p>',
  },
  grudge_orphan: {
    title: '【楔子】灶膛里的灰尘',
    body:
      '<p class="intro-p">江南大路的日头刚上来，你从老槐树底下起身，拍了拍衣襟上的灰。'
      + '灰是旧的，沾了十二年，拍不干净。</p>'
      + '<p class="intro-p">你七岁那年躲在灶膛里，从砖缝往外看。'
      + '看见的是一双靴子，靴面上有一道划痕，划痕是斜的，从里往外。</p>'
      + '<p class="intro-p">后来那一家人没了。你被人从灶膛里拖出来的时候，'
      + '手上全是烫伤的泡，一声没哭——那天你就学会了不出声。</p>'
      + '<p class="intro-p">这十二年你到处打听那道靴痕，什么都没打听着。'
      + '北边二里就是江南城。你听说，有钱能使鬼推磨的地方，才问得出陈年旧账。</p>',
  },
  border_drift: {
    title: '【楔子】一句半生不熟的官话',
    body:
      '<p class="intro-p">江南大路的日头照在你脸上，你眯了眯眼——关外的太阳更毒，你还是没习惯这边的潮。'
      + '肩上那件斗篷是路上一个货郎给的，早就不挡风了。</p>'
      + '<p class="intro-p">你打北边来，一路走的都是小路。官话是路上现学的，'
      + '说到第三句就开始打结，人家常常听不明白，你也就懒得说了。</p>'
      + '<p class="intro-p">边地三年两旱，去年那场雪把最后一群羊压死了。'
      + '你埋了羊，往南走。走了两个月，走到这儿。</p>'
      + '<p class="intro-p">北边二里就是江南城。城里人讲究，可也得有人肯出力气。'
      + '你不挑活得轻，你挑活得活。</p>',
  },
  nun_ward: {
    title: '【楔子】一只素银镯',
    body:
      '<p class="intro-p">江南大路的日头升起来的时候，你正把袖子往下拽了拽，'
      + '遮住手腕上那只素银镯。镯子是师太给的，说留个念想。</p>'
      + '<p class="intro-p">你被丢在庵堂门槛上的时候还裹在襁褓里，只塞了这只镯。'
      + '师太收养你到十五岁。她教你认字、抄经，也教过你几手防身的招式。</p>'
      + '<p class="intro-p">上个月她说：「庵里留不住你了。你的路不在这四方墙里头。」'
      + '给了你一个包袱，一件旧衫，还有一句话：「往峨眉去。那边的师太认得我。」</p>'
      + '<p class="intro-p">北边二里就是江南城。你腕上的镯子又开始硌人了。</p>',
  },
};

/* ==========================================================================
 *  四、给别处用的接口
 * ========================================================================== */

/** 这个身份该往哪座山门去（含门名 / 招牌武学 / 引荐语）。
 *
 *  ⚠️ 两条口径，缺一个就会出怪事：
 *    ① 玩家已经拜了别家，就以「已经拜的那家」为准 —— 教程第 7 步判的是 `p.sect`，
 *       两处口径必须一致，不然面板会指着一座你已经不去的山门；
 *    ② **性别门槛不破例**。引荐信能抹平 karma / 悟性 / 等级这类「资历」门槛
 *       （老汉的面子管用），但抹不平「峨眉只收女弟子」这种硬规矩 ——
 *       让一个大男人凭一封信进峨眉，玩家第一反应是这游戏坏了。
 *       性别对不上就顺着备选链往下走（庵堂孤儿若择了男子身，
 *       引荐语里的「峨眉」自然换成链上的下一家）。
 */
function targetSectFor(p) {
  const w = p && p.world;
  const sects = (w && w.data && w.data.sects) || {};
  /* 已经入门：就以现成的门派为准 */
  if (p && p.sect && sects[p.sect]) {
    return {
      id: p.sect, name: sects[p.sect].name || p.sect,
      gate: SECT_GATE[p.sect] || null, art: sectArt(sects[p.sect]),
      pitch: SECT_PITCH[p.sect] || '', joined: true, own: false,
    };
  }
  const chain = BIRTH_SECT[(p && p.birth)] || BIRTH_SECT.orphan;
  const gender = (p && p.gender) || 'male';
  /* 挑第一个「性别对得上」的；都对不上（理论上不会）就用首位 */
  let id = chain[0];
  for (const c of chain) {
    const req = (sects[c] || {}).require;
    if (!req || !req.gender || req.gender === gender) { id = c; break; }
  }
  const sd = sects[id] || {};
  return {
    id, name: sd.name || id,
    gate: SECT_GATE[id] || null, art: sectArt(sd),
    pitch: SECT_PITCH[id] || '', joined: false, own: true,
  };
}

/** 该门招牌武学（引路时点名，比干说门派名有戏） */
function sectArt(sd) {
  if (!sd) return '';
  const list = [].concat(sd.entrySkills || [], sd.skills || []);
  /* entrySkills[0] 通常是基本拳脚这类通识功，招牌往后取一个 */
  return (list[1] || list[0] || '');
}

/** 填占位符：{sect} 门派名　{gate} 山门（房间名）　{art} 招牌武学 */
function fillStory(tpl, tgt, world) {
  if (!tpl) return '';
  let gate = tgt && tgt.name ? tgt.name : '山门';
  if (tgt && tgt.gate && world && world.getRoom) {
    const r = world.getRoom(tgt.gate);
    if (r && r.name) gate = r.name;
  }
  return String(tpl)
    .replace(/\{sect\}/g, (tgt && tgt.name) || '门派')
    .replace(/\{gate\}/g, gate)
    .replace(/\{art\}/g, (tgt && tgt.art) || '本事');
}

/**
 * 沉浸式开场剧情（楔子）：玩家首次进入江湖时弹出。
 * show 由 seen_intro 标记控制 —— 看过就不再弹（跨存档留存）。
 * tutorialFlags 可能是数组（存读档）或 Set（运行时），两种都兼容。
 * 版本由 player.birth 决定（13 个身份各一版，未知/缺失回落 'orphan'）。
 */
function introFor(player, tutorialFlags) {
  const flags = tutorialFlags || (player && player.tutorialFlags) || [];
  const shown = Array.isArray(flags)
    ? flags.indexOf('seen_intro') >= 0
    : (typeof flags.has === 'function' && flags.has('seen_intro'));
  if (shown) return { show: false, title: '', body: '' };

  const picked = INTRO_VARIANTS[(player && player.birth)] || INTRO_VARIANTS.orphan;
  return { show: true, title: picked.title, body: picked.body + INTRO_HANDOFF };
}

/**
 * 计算当前引导状态（顺序游标版）
 *
 * 关键：顺序推进——遇到第一个未完成的步就停，后面的步即便状态满足
 * 也强制 done=false 并标 locked。这是消灭「跳步假完成」的关键。
 *
 * 返回里除旧的六项（steps/current/doneCount/total/finished/nextGoal）外，
 * 新增 story（章节化的剧情线）与 target（该往哪座山门），供「任务」面板
 * 与「新手教程」面板共用 —— 两个面板必须是**同一份数据算出来的**。
 */
function guideState(player, tutorialFlags) {
  const flags = new Set(tutorialFlags || []);
  const p = Object.assign({}, player, { tutorialFlags: flags });

  const real = STEPS.filter(s => s.id !== 'free');

  /* 第一轮：逐个求值，前置未满足的一律锁住 */
  const rawDone = {};
  real.forEach((s) => {
    let ok = false;
    try { ok = !!s.test(p); } catch (e) { ok = false; }
    rawDone[s.id] = ok;
  });

  /* 第二轮：按顺序推进游标 */
  const doneMap = {};
  let cursor = real.length;
  let broke = false;
  real.forEach((s, i) => {
    if (broke) { doneMap[s.id] = false; return; }
    const prereqOk = (s.requires || []).every(r => doneMap[r]);
    if (rawDone[s.id] && prereqOk) doneMap[s.id] = true;
    else { doneMap[s.id] = false; broke = true; cursor = i; }
  });

  const world = (player && player.world) || null;
  const target = targetSectFor(player);

  const steps = STEPS.map((s, idx) => {
    const isReal = s.id !== 'free';
    const done = isReal ? !!doneMap[s.id] : false;
    const locked = isReal && !done && (s.requires || []).some(r => !doneMap[r]);
    const isCur = isReal && !done && !locked;
    return {
      id: s.id, no: s.no || idx + 1, title: s.title, goal: s.goal,
      /* ⚠️ hint 也要填模板位 —— 章节列表里每一章的 hint 都会渲染出来，
         漏填的话玩家会看到「往{gate}去」（首次实现就漏了，被 §E-8 抓住）。 */
      hint: fillStory(s.hint, target, world),
      /* 剧情旁白：**只在轮到你这一步时**才给，避免剧透后面的章节 */
      story: (isCur || done) ? fillStory(s.story, target, world) : '',
      done, locked: !!locked, index: idx,
    };
  });

  const doneCount = real.filter(s => doneMap[s.id]).length;
  const curStep = cursor < real.length ? real[cursor] : null;
  const current = curStep ? {
    id: curStep.id, no: curStep.no || cursor + 1, title: curStep.title, goal: curStep.goal,
    hint: fillStory(curStep.hint, target, world),
    story: fillStory(curStep.story, target, world),
  } : null;

  return {
    steps,
    current,
    doneCount,
    total: real.length,
    finished: cursor >= real.length,
    nextGoal: current ? current.goal : '自己拿主意',
    /* 剧情线：给「任务」面板置顶用 */
    story: {
      title: '入江湖',
      target,
      chapters: steps.filter(s => s.id !== 'free').length,
      doneChapters: doneCount,
    },
  };
}

/**
 * 「任务」面板置顶的那一条（新手教程没做完才返回，做完返回 null）。
 *
 * ⚠️ 与 `guideState` **同一份数据**算出来 —— 面板里的「第几章 / 目标 / 剧情」
 *    必须和「新手教程」面板逐字一致，两处各写一份迟早对不上。
 * ⚠️ 玩家可见处**不许出现「死」字**（既有铁律），这里的文案自查过。
 */
function tutorialQuestOf(player, tutorialFlags) {
  const g = guideState(player, tutorialFlags);
  if (g.finished || !g.current) return null;
  const tgt = g.story.target || {};
  return {
    id: '__newbie__',
    name: '入江湖（新手教程）',
    type: '新手',
    level: 0,
    desc: '道口那碗茶还没喝完，你先得活成个能在江湖上站住的人。'
      + '茶摊的老汉指了条路——往 ' + (tgt.name || '山门') + ' 去。',
    stageDesc: g.current.story || g.current.goal,
    chapter: g.current.no,
    chapterTitle: g.current.title,
    goal: g.current.goal,
    hint: g.current.hint,
    targetSect: tgt.name || '',
    targetSectId: tgt.id || '',
    cur: g.doneCount,
    count: g.total,
    isTutorial: true,
    /* 目标列表（复用任务卡片的渲染：每章一行，做完打勾） */
    targets: g.steps.filter(s => s.id !== 'free').map(s => ({
      desc: '第' + s.no + '章 · ' + s.title,
      cur: s.done ? 1 : 0,
      count: 1,
      done: s.done,
    })),
  };
}

/**
 * 引荐人发引荐信（茶摊老汉第一次跟你搭话时）。
 * 回来的是要并进日志的台词；已经发过就返回空数组（幂等）。
 *
 * 做两件事：
 *   ① 给物品「引荐信」——玩家看得见、拿得到的实体；
 *   ② 记 `p.vars.tutPass = <门派 id>` —— 凭这封信，山门**破例**收你
 *      （见 character.joinSect）。这不只是便利：出身决定的那家山门
 *      有的带 karma/性别门槛，没这封信，某些身份的新手线会走死。
 */
function handOutLetter(world, npc) {
  const p = world && world.player;
  if (!p || !npc) return [];
  const k = p.vars || (p.vars = {});
  if (k.tutLetter) return [];
  const tgt = targetSectFor(p);
  if (!tgt || !tgt.id || tgt.joined) return [];
  k.tutLetter = true;
  k.tutPass = tgt.id;
  if (!p.hasItem || !p.hasItem('letter_intro')) world.giveItem(p, 'letter_intro', 1);
  const lines = [
    { kind: 'story', text: `${npc.name}把灶上的水壶挪开，从怀里摸出一封旧信，封皮上只按了个指印。` },
    { kind: 'say', text: `${npc.name}道：「拿着。往${gateNameOf(world, tgt)}去，找${tgt.name}，把这信递上去——就说是我给的。」` },
  ];
  if (tgt.pitch) lines.push({ kind: 'say', text: `${npc.name}道：「${tgt.pitch}」` });
  lines.push({ kind: 'sys', text: '　（获得：引荐信。凭这封信，山门会破例收你。）' });
  lines.push({ kind: 'hint', text: `　（点左侧「新手教程」能看整条路的走法；走完后这封信就不必留着了。）` });
  return lines;
}

function gateNameOf(world, tgt) {
  if (tgt && tgt.gate && world && world.getRoom) {
    const r = world.getRoom(tgt.gate);
    if (r && r.name) return r.name;
  }
  return tgt && tgt.name ? tgt.name + '的山门' : '山门';
}

/** 根据玩家执行的指令返回应该点亮的标记 */
function flagForCommand(cmd, args) {
  const c = String(cmd || '').trim().toLowerCase();
  if (CMD_FLAGS[c]) return CMD_FLAGS[c];
  /* go <房间名>：地图点击移动走这条路 */
  if (c === 'go' && args && args.length) return 'did_move';
  if (c === 'go') return 'did_move';
  return null;
}

module.exports = {
  STEPS, CMD_FLAGS, EXTRA_FLAGS, introFor, guideState, flagForCommand,
  /* 新增：身份 → 势力 的落点，以及三个面板共用的那份数据 */
  BIRTH_SECT, SECT_GATE, SECT_PITCH, INTRO_VARIANTS,
  targetSectFor, tutorialQuestOf, handOutLetter, fillStory, gateNameOf,
};
