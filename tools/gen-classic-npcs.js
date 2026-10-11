/* ============================================================
 * gen-classic-npcs.js —— 补金庸四部书的核心人物（写入型）
 *
 * 主人 2026-10-11：「参考《射雕英雄传》《天龙八部》《笑傲江湖》《神雕侠侣》
 *   这些著名的武侠小说里的人物角色门派，区域，武学，剧情做进游戏里」。
 *
 * 实测盘点：**门派齐、区域齐，缺的是人** ——
 *   射雕 13 位主要人物只有 2 位、天龙 15 位只有 3 位、笑傲 14 位只有 5 位，
 *   **神雕 11 位一个都没有**。
 *
 * 这一批只做一件事：把核心人物请进**原著里他们本来的地方** ——
 *   郭靖黄蓉守襄阳、风清扬在思过崖、小龙女在活死人墓、王语嫣在燕子坞。
 *
 * ⚠️ 画像一律手写（每人 role/origin/now/want/fear/voice/routine 各写各的），
 *    不套模板 —— 主人点名过的「模板化水货」就是这条线上最容易犯的错。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '101_classic_npcs.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;
const R = w.data.rooms;
const regionFirst = (reg) => Object.keys(R).find(x => R[x].region === reg) || 'road_1';
const roomOf = (want, reg) => (R[want] ? want : regionFirst(reg));

const P = [
  /* ================= 神雕侠侣（此前一位都没有） ================= */
  {
    id: 'yang_guo', name: '杨过', gender: 'male', room: 'gumu_mu', region: 'gumu', sect: 'gumu',
    title: '神雕大侠', roleP: '独臂人', personality: 'lengmo', age: 36, likes: ['wine'],
    desc: '空着的那边袖子，风一过就鼓起来，又瘪下去。脸上扣着半张面具。他也不摘，跟你说话也不摘。',
    talk: ['我的事，与你无关。', '这世上好人不多，你算一个也好。'],
    level: 78, skills: ['anran_xiaohunzhang', 'yugu_nvxinjian'],
    pt: {
      role: '独臂的游侠，江湖上叫他神雕大侠，他自己从不认这个名号',
      origin: '父亲死在自己出生之前，母亲死在客栈里。十四岁被人带上终南山，十八岁断了一条手臂。',
      now: '每年这个时候，他都要回终南山一趟，在墓前站一会儿。',
      want: '把当年那几件事，一件一件弄明白', fear: '怕自己到头来变成另一个欧阳锋',
      voice: { tone: '冷淡，不多说一个字', catchphrase: '不必。' },
      routine: [{ at: 'night', act: '坐在墓前的石阶上，一只袖管垂着，动也不动' }],
    },
  },
  {
    id: 'xiao_longnv', name: '小龙女', gender: 'female', room: 'gumu_mu', region: 'gumu', sect: 'gumu',
    title: '古墓派传人', roleP: '白衣女子', personality: 'lengmo', age: 28, likes: ['flower'],
    desc: '白衣服。洗得很旧了，还是很白。人站在墙根暗处，你不留神，就看不出那儿还站着个人。',
    talk: ['墓里清净。', '你要走，就顺着那条道走。'],
    level: 80, skills: ['yugu_nvxinjian', 'jiuyin_zhenjing'],
    pt: {
      role: '在活死人墓里长大的人，外头的规矩她一条也不知道',
      origin: '自幼由师父带大，师父的师父收了一辈子活死人，她也是其中之一。',
      now: '墓里少了一味药，她出去找，找了很久。',
      want: '把师父留下的话弄懂', fear: '怕自己在下山这几年里，变成另一个人',
      voice: { tone: '淡淡的，事不关己', catchphrase: '嗯。' },
      routine: [{ at: 'dawn', act: '在寒玉床边上坐着，一动不动' }],
    },
  },
  {
    id: 'li_mochou', name: '李莫愁', gender: 'female', room: 'gumu_shan', region: 'gumu', sect: 'gumu',
    title: '赤练仙子', roleP: '道姑', personality: 'baozhao', age: 42, likes: ['flower'],
    desc: '拂尘擦得干净，人倒是邋遢。道袍洗得发灰，袖口全是毛边。她看你，先从头看到脚。',
    talk: ['你也听说过我？', '这世上的情，都是假的。'],
    level: 72, skills: ['yugu_nvxinjian', 'jiuyin_baiguzhao'],
    pt: {
      role: '在江湖上有个响亮名号的道姑，只是这号听着叫人心里发毛',
      origin: '当年也是古墓里的人，为了一个男人走出墓门，再没回去过。',
      now: '她要找一本旧谱，找了很多年。',
      want: '把那本谱翻出来，把当年那口气出了', fear: '怕自己其实早就忘了那个人长什么样',
      voice: { tone: '火爆，一句话就顶回来', catchphrase: '你敢？' },
      routine: [{ at: 'dusk', act: '坐在山石上，把拂尘一根一根理过去' }],
    },
  },
  {
    id: 'guo_xiang', name: '郭襄', gender: 'female', room: 'emei_jinding', region: 'emei', sect: 'emei',
    title: '峨眉派祖师', roleP: '女侠', personality: 'haoshuang', age: 30, likes: ['flower'],
    desc: '青驴拴在门外，绳头随手往驴脖子上一搭。她坐门槛上啃烧饼，掉了渣也不管，拿袖子一抹。',
    talk: ['大哥哥，你也是来飘泊的？', '天下这么大，走一走就老了。'],
    level: 55, skills: ['jiuyang_shengong', 'emei_atk_1'],
    pt: {
      role: '一个人走了大半个天下的人，走到哪儿都能坐下啃两口干粮',
      origin: '生在襄阳城头的乱军里，名字是取襄阳谐音来的。她记事起，父亲就在守城。',
      now: '走遍天涯找一个不知道还在不在的人。',
      want: '把走这一路记下来，别让它们随人散了', fear: '怕回到襄阳那天，城上没人了',
      voice: { tone: '豪爽，笑声先到', catchphrase: '大哥哥，你去哪儿？' },
      routine: [{ at: 'day', act: '牵着头青驴上山，驴走累了就自己背行李' }],
    },
  },
  /* ================= 射雕英雄传 ================= */
  {
    id: 'guo_jing', name: '郭靖', gender: 'male', room: 'xiangyang_gate', region: 'xiangyang', sect: null,
    title: '襄阳守将', roleP: '守城人', personality: 'mune', age: 50, likes: ['wine'],
    desc: '甲胄的搭扣有两个是坏的，拿麻绳系着。开口之前，他先看你一会儿，像是要把你这个人看清楚。',
    talk: ['城在，人在。', '我笨，学得慢，可学过的忘不掉。'],
    level: 88, skills: ['xianglong_zhang', 'jiuyin_zhenjing'],
    pt: {
      role: '守着襄阳城的人。守了大半辈子，城头哪块砖松了他都知道',
      origin: '生在草原上，长在草原上，十八岁才知道自己该是什么人。',
      now: '对岸的船比去年多，他夜里睡不踏实。',
      want: '把这座城守住，再守一年', fear: '怕自己一松手，身后就是几万条命',
      voice: { tone: '木讷，半天挤一句', catchphrase: '这个……我再想想。' },
      routine: [{ at: 'dawn', act: '沿着城头走一圈，走到哪面墙都要停下来拍一拍' }],
    },
  },
  {
    id: 'huang_rong', name: '黄蓉', gender: 'female', room: 'xiangyang_street', region: 'xiangyang', sect: null,
    title: '丐帮帮主', roleP: '妇人', personality: 'youhua', age: 46, likes: ['food'],
    desc: '算盘珠子哗啦哗啦响。她一边打，一边招呼你坐，一边把桌上摊着的单子推到一边去。',
    talk: ['你这事，我看有三条路。', '先说难听的：钱我不白给。'],
    level: 75, skills: ['dagou_bangfa', 'luoying_shenjianzhang'],
    pt: {
      role: '襄阳城里管着柴米油盐的人。城里多少张嘴，她心里有本账',
      origin: '父亲是桃花岛主。她十六岁离家，再回去已是多年以后。',
      now: '粮道上有人做手脚，她查了半个月。',
      want: '把这场仗打到不必再打的那天', fear: '怕自己算无遗策，唯独算漏了最要紧的那一步',
      voice: { tone: '油滑，见人说人话', catchphrase: '你先别急。' },
      routine: [{ at: 'day', act: '在米铺后头翻账本，翻两页抬眼看一下门外' }],
    },
  },
  {
    id: 'ouyang_feng', name: '欧阳锋', gender: 'male', room: 'baituo_gate', region: 'baituo', sect: 'baituo',
    title: '西毒', roleP: '老毒物', personality: 'yinzhi', age: 62, likes: ['incense'],
    desc: '他走路是倒着走的，边走边往身后看。跟他搭话，他看你身后比看你多。',
    talk: ['你身上有股味道。', '往前走是为了往后退，你懂么？'],
    level: 90, skills: ['hamagong', 'lingshe_quan'],
    pt: {
      role: '白驼山的主人。山上的蛇比人多，他说这样清净',
      origin: '一生只败过一次，那次之后他开始倒着走路。',
      now: '他在等一个人。等谁来，他不说。',
      want: '把当年那部经书弄到手', fear: '怕自己其实早就练岔了，只是不肯承认',
      voice: { tone: '阴沉，话里总留着半句', catchphrase: '你想清楚了再答。' },
      routine: [{ at: 'night', act: '背着手在院里倒着走圈，一圈一圈' }],
    },
  },
  {
    id: 'zhou_botong', name: '周伯通', gender: 'male', room: 'taohuadao_forest', region: 'taohuadao', sect: 'taohua',
    title: '老顽童', roleP: '老顽童', personality: 'haoshuang', age: 70, likes: ['food'],
    desc: '头发白了一半，衣襟敞着，腰带早不知道丢哪儿去了。手闲不住，这会儿正搓一片树叶，搓碎了，抖抖手，接着搓。',
    talk: ['陪我玩一盘！', '不玩？不玩我可要生气了。'],
    level: 85, skills: ['kongming_quan', 'jiuyin_zhenjing'],
    pt: {
      role: '住在桃花岛上的老头，正经事一件不做，怪招数一肚子',
      origin: '他师兄是天下第一，他偏不肯好好学，自己琢磨出一套左手打右手的功夫。',
      now: '岛上没人陪他玩，他把岛上的猴子都教出了规矩。',
      want: '找个人陪他玩，玩到天黑', fear: '怕安静。一安静就想起师兄',
      voice: { tone: '爽快，话里带笑', catchphrase: '来来来！' },
      routine: [{ at: 'day', act: '在林子空地上左手打右手，打得尘土飞扬' }],
    },
  },
  /* ================= 天龙八部 ================= */
  {
    id: 'xiao_feng', name: '萧峰', gender: 'male', room: 'gaibang_po_miao', region: 'gaibang', sect: 'gaibang',
    title: '丐帮帮主', roleP: '好汉', personality: 'haoshuang', age: 34, likes: ['wine'],
    desc: '往门口一站，门框就显得窄了。他坐下之前先看了圈屋子，谁也没漏下。声音不高，可他一开口，打岔的人都闭了嘴。',
    talk: ['你来，坐下喝一碗。', '我的事，我自己担。'],
    level: 92, skills: ['xianglong_zhang', 'shaolin_atk_1'],
    pt: {
      role: '丐帮的帮主，一身粗布，脊梁比谁都直',
      origin: '在中原长大，做了三十年的汉人，某一天才知道自己不是。',
      now: '他回中原走了一圈，把该见的人都见了。',
      want: '弄明白自己到底是谁', fear: '怕再有一次，两边的人都死在他手上',
      voice: { tone: '豪爽，笑声先到', catchphrase: '喝。' },
      routine: [{ at: 'dusk', act: '坐在破庙门槛上喝酒，一大碗一口气见底' }],
    },
  },
  {
    id: 'duan_yu', name: '段誉', gender: 'male', room: 'dali_wangfu', region: 'dali', sect: 'dali',
    title: '大理世子', roleP: '公子', personality: 'wenwan', age: 22, likes: ['flower'],
    desc: '长衫是新裁的，下摆还带着褶。见人就拱手，手拱得很圆，话却说得磕绊，他自己也笑。',
    talk: ['在下姓段，单名一个誉字。', '这花真好看——啊，姑娘也好看。'],
    level: 62, skills: ['liumai_shenjian', 'lingbo_weibu'],
    pt: {
      role: '大理段氏的世子，家里要他做皇帝，他只想读佛经',
      origin: '生下来就锦衣玉食，偏偏天生不肯习武，被逼着才学了。',
      now: '他一心想下山走一趟，家里拦着。',
      want: '看看外头到底是什么样子', fear: '怕自己这份运气，是替别人受的',
      voice: { tone: '温和，先把人让过', catchphrase: '这个……小节，不值当的。' },
      routine: [{ at: 'day', act: '坐在廊下读经，一页要读半天' }],
    },
  },
  {
    id: 'xu_zhu', name: '虚竹', gender: 'male', room: 'shaolin_daxiong', region: 'shaolin', sect: 'shaolin',
    title: '少林僧人', roleP: '小和尚', personality: 'mune', age: 26, likes: ['food'],
    desc: '个头不高，相貌也平常，一笑起来就顺眼多了。手很大。指甲缝里总是黑的，剪得再勤也还是黑的。',
    talk: ['罪过罪过。', '阿弥陀佛——啊，小僧又说错话了。'],
    level: 80, skills: ['tianshan_liuyangzhang', 'shaolin_atk_1'],
    pt: {
      role: '少林寺里管杂事的小和尚，扫了十几年地',
      origin: '生下来就被放在寺门口，连爹娘是谁都不知道。',
      now: '寺里派他下山办一件事，他一路走一路撞见不该见的事。',
      want: '把师父交代的事办完，早点回寺里扫地', fear: '怕自己破了戒，回不去',
      voice: { tone: '钝，问三句答一句', catchphrase: '罪过，罪过。' },
      routine: [{ at: 'dawn', act: '从山门一路扫到大殿，扫完再扫一遍' }],
    },
  },
  {
    id: 'wang_yuyan', name: '王语嫣', gender: 'female', room: 'gusu_yanzi', region: 'gusu', sect: null,
    title: '慕容家表妹', roleP: '闺秀', personality: 'wenwan', age: 18, likes: ['book'],
    desc: '书卷在手里攥着，攥得紧，页都没翻开。人站得笔直。你一动，她的眼就跟着动。',
    talk: ['这一招该往左半步——啊，我没练过。', '你别笑我，我只会说。'],
    level: 20, skills: [],
    pt: {
      role: '天下的武功她认得出来，自己一步也走不稳',
      origin: '自小在藏书的地方长大，书翻遍了几架子，人却只见过那几个。',
      now: '表哥走了很久没回来，她每天在门口站一会儿。',
      want: '有朝一日，把嘴上的功夫练到手上去', fear: '怕自己这辈子只是个“会说的”',
      voice: { tone: '轻声细语', catchphrase: '你会这一招么？' },
      routine: [{ at: 'day', act: '坐在廊下翻书，翻到一半抬头看院子' }],
    },
  },
  /* ================= 笑傲江湖 ================= */
  {
    id: 'ren_yingying', name: '任盈盈', gender: 'female', room: 'mojiao_hall', region: 'mojiao', sect: 'mojiao',
    title: '日月神教圣姑', roleP: '圣姑', personality: 'lengmo', age: 24, likes: ['music'],
    desc: '短笛插在腰上，笛穗垂着。进门先站定，把屋子看了一圈才坐，挑的还是个背靠墙的位子。',
    talk: ['坐下说话。', '我要的不是这个，你知道的。'],
    level: 70, skills: ['xixing_dafa'],
    pt: {
      role: '日月神教的圣姑。教里的人都怕她，怕的其实是别人',
      origin: '生在这个教里。父亲是教主，后来父亲不见了。',
      now: '她替教里管着一桩大事，管了几年，越管越不想管。',
      want: '把父亲的下落弄明白', fear: '怕自己有一天变成教里那些人的样子',
      voice: { tone: '冷，一句是一句', catchphrase: '说。' },
      routine: [{ at: 'night', act: '在殿后吹笛，吹两句就停下听一听' }],
    },
  },
  {
    id: 'feng_qingyang', name: '风清扬', gender: 'male', room: 'huashan_siguoya', region: 'huashan', sect: 'huashan',
    title: '剑宗前辈', roleP: '老者', personality: 'lengmo', age: 76, likes: ['sword'],
    desc: '崖上住了几十年，下山的道怕是都荒了。指甲任由它长，弯得打钩。衣裳旧，可领口平整，没一块油渍。',
    talk: ['剑法不是招式，是念头。', '你学会这一招，就别再来。'],
    level: 95, skills: ['dugu_jiujian'],
    pt: {
      role: '思过崖上那个谁也管不着的人，几十年没下过山',
      origin: '当年剑宗气宗之争，他是活下来的那个。死在崖下的师弟，他至今记得名字。',
      now: '有个后生常来。他嘴上赶，手上还是教了两招。',
      want: '把这套剑法等一个配得上的人', fear: '怕自己教出去的东西，又惹出一场当年的祸',
      voice: { tone: '冷淡，话不多', catchphrase: '你走。' },
      routine: [{ at: 'day', act: '坐在崖边，用一根树枝在石头上划，划的不是字' }],
    },
  },
  {
    id: 'tian_boguang', name: '田伯光', gender: 'male', room: 'changan_lane', region: 'changan', sect: null,
    title: '万里独行', roleP: '刀客', personality: 'youhua', age: 38, likes: ['wine'],
    desc: '刀鞘上刻着四个字，自己刻的，刻得歪歪扭扭，写的是「万里独行」。个头中不溜，两条腿倒腾得飞快，一眨眼人就到街那头去了。',
    talk: ['我这人有个好处，说话算数。', '你要打，我陪你打；你要喝，我陪你喝。'],
    level: 60, skills: ['kuangfeng_daofa'],
    pt: {
      role: '一个跑得快的刀客。名声不好，说话倒算数',
      origin: '年轻时就这一手快刀，靠它吃饭，也靠它惹祸。',
      now: '他答应过一个人不再做那件事，忍了很久。',
      want: '把这把刀用在正经事上，用一次', fear: '怕自己哪天忍不住，又做回从前那个',
      voice: { tone: '滑不留手', catchphrase: '这么着，咱们打个商量。' },
      routine: [{ at: 'night', act: '在城墙根下磨刀，磨一下用大拇指试一下' }],
    },
  },
  {
    id: 'lin_pingzhi', name: '林平之', gender: 'male', room: 'huashan_qingke', region: 'huashan', sect: 'huashan',
    title: '华山弟子', roleP: '少侠', personality: 'yinzhi', age: 20, likes: ['sword'],
    desc: '衣裳穿得一丝不苟，连领子都抻得很平。手垂在身侧，一直在抖，他拿衣摆压住。一开口，嗓子提得很高。',
    talk: ['我家的东西，一件也不能落在别人手里。', '你说什么？再说一遍。'],
    level: 58, skills: ['pixie_jianfa'],
    pt: {
      role: '华山门下一个新入门的弟子，衣裳干净得过分',
      origin: '家里出过事，一夜之间什么都没了。他记得那天每一个人的脸。',
      now: '他在山上练剑，练得比谁都狠。',
      want: '把当年那几个人一个一个找出来', fear: '怕自己变成和他们一样的人，却停不下来',
      voice: { tone: '阴沉，话都想过才说', catchphrase: '我记着。' },
      routine: [{ at: 'night', act: '在无人处练剑，练到手腕发青也不停' }],
    },
  },
];

/* 这批人身上那些**库里还没有**的绝学 —— 一起补进来（主人要的「武学也做进去」）。
   字段照 10_skills.json 的写法（type/category/base 决定它挂在哪一槽）。 */
const SKILLS = {
  yugu_nvxinjian: {
    id: 'yugu_nvxinjian', name: '玉女心经', type: '内功', category: '内功', base: 'basic_force',
    maxLevel: 800, difficulty: 2, grade: 1, quality: 'rare',
    desc: '古墓派的内功根基。两人同修时威力倍增，一个人练，则清冷如冰。',
    bonus: { maxMp: 320, maxHp: 180, dodge: 40 }, mpCost: 0, trainCost: 420,
  },
  anran_xiaohunzhang: {
    id: 'anran_xiaohunzhang', name: '黯然销魂掌', type: '拳', category: '外功', base: 'basic_fist',
    maxLevel: 900, difficulty: 2.4, grade: 1, quality: 'rare',
    desc: '心中凄苦时使出来，威力最大。掌法无招，全看使掌的人那一刻心里想着什么。',
    damageMult: 2.4, accuracy: 90, mpCost: 50, trainCost: 560,
    effects: [{ type: 'cond', if: { chance: 0.35 }, then: [{ type: 'extraHit', value: 1 }] }],
    bonus: { atk: 90 },
  },
  hamagong: {
    id: 'hamagong', name: '蛤蟆功', type: '拳', category: '魔功', base: 'basic_fist',
    maxLevel: 900, difficulty: 2.5, grade: 1, quality: 'rare',
    desc: '蓄势如蟾，一发不可当。练岔了会反噬自身，白驼山历代都有人栽在这上面。',
    damageMult: 2.3, accuracy: 88, mpCost: 55, trainCost: 580,
    effects: [{ type: 'ignoreDef' }],
    bonus: { atk: 100, maxHp: 120 },
  },
  lingshe_quan: {
    id: 'lingshe_quan', name: '灵蛇拳', type: '拳', category: '魔功', base: 'basic_fist',
    maxLevel: 700, difficulty: 2, grade: 1, quality: 'fine',
    desc: '手臂像没有骨头。你以为它往左，它偏从右边绕过来。',
    damageMult: 1.9, accuracy: 95, mpCost: 30, trainCost: 300,
    effects: [{ type: 'cond', if: { chance: 0.3 }, then: [{ type: 'stun', chance: 1, turns: 1 }] }],
  },
  kongming_quan: {
    id: 'kongming_quan', name: '空明拳', type: '拳', category: '外功', base: 'basic_fist',
    maxLevel: 700, difficulty: 1.8, grade: 1, quality: 'fine',
    desc: '全用柔劲。看着空空荡荡，打上去却像打在一团棉花里。',
    damageMult: 1.8, accuracy: 93, mpCost: 25, trainCost: 280,
    effects: [{ type: 'cond', if: { chance: 0.25 }, then: [{ type: 'debuff', name: '失力', turns: 2, mods: { atk: -30 } }] }],
  },
  tianshan_liuyangzhang: {
    id: 'tianshan_liuyangzhang', name: '天山六阳掌', type: '拳', category: '外功', base: 'basic_fist',
    maxLevel: 800, difficulty: 2.1, grade: 1, quality: 'rare',
    desc: '一掌六变，阳劲贯到底。灵鹫宫的不传之秘。',
    damageMult: 2.0, accuracy: 92, mpCost: 40, trainCost: 460,
    effects: [{ type: 'cond', if: { chance: 0.3 }, then: [{ type: 'extraHit', value: 1 }] }],
    bonus: { atk: 70 },
  },
  luoying_shenjianzhang: {
    id: 'luoying_shenjianzhang', name: '落英神剑掌', type: '拳', category: '外功', base: 'basic_fist',
    maxLevel: 750, difficulty: 1.9, grade: 1, quality: 'fine',
    desc: '桃花岛的掌法。掌影如落花，看着好看，落下来才知每一片都是刀。',
    damageMult: 1.9, accuracy: 94, mpCost: 32, trainCost: 320,
    effects: [{ type: 'cond', if: { chance: 0.28 }, then: [{ type: 'extraHit', value: 1 }] }],
  },
};

/* 画像的 marks（小标签，一两字）+ 门派内的位次（rank 是 0 基下标，取末档 = 弟子） */
const MARKS = {
  yang_guo: ['武', '独臂'], xiao_longnv: ['武', '白衣'], li_mochou: ['武', '道'],
  guo_xiang: ['武', '游'], guo_jing: ['武', '守'], huang_rong: ['智', '帮'],
  ouyang_feng: ['毒', '武'], zhou_botong: ['武', '顽'], xiao_feng: ['武', '豪'],
  duan_yu: ['儒', '王'], xu_zhu: ['僧', '憨'], wang_yuyan: ['书', '闺'],
  ren_yingying: ['教', '笛'], feng_qingyang: ['武', '隐'], tian_boguang: ['刀', '浪'],
  lin_pingzhi: ['武', '仇'],
};

/* 武学 id 兜底：库里没有的剔掉（免得写出「教一门不存在的功夫」） */
const known = (id) => !!w.getSkill(id) || !!SKILLS[id];
const out = {
  _note: '金庸四部书的核心人物（tools/gen-classic-npcs.js 生成）。落点取原著里他们本来的地方；画像手写，不套模板。'
    + 'skills 段是这批人身上的绝学里、库里原先没有的那几门。',
  skills: SKILLS,
  npcs: {},
};
let made = 0, dropped = [];
for (const p of P) {
  const skills = (p.skills || []).filter(known);
  if ((p.skills || []).length !== skills.length) dropped.push(p.name + ':' + p.skills.filter(s => !known(s)).join('/'));
  out.npcs[p.id] = {
    id: p.id, name: p.name, gender: p.gender,
    tag: p.sect ? undefined : 'swordsman',
    title: p.title, room: roomOf(p.room, p.region), home: 'house:' + p.id,
    sect: p.sect || undefined,
    /* 门派内的位次：`ranks` 表是 0 基下标，取**末档**（弟子）——
       这几位都不是各派的掌门（掌门另有其人），
       不给 rank 的话 identity-check 会算出「门派名 + undefined」。 */
    rank: p.sect ? Math.max(0, ((w.data.sects[p.sect] || {}).ranks || []).length - 1) : undefined,
    desc: p.desc, talk: p.talk, personality: p.personality, likes: p.likes,
    age: p.age, level: p.level,
    hp: 400 + p.level * 26, maxHp: 400 + p.level * 26,
    atk: 30 + Math.round(p.level * 1.6), def: 20 + Math.round(p.level * 1.2),
    dodge: 20 + p.level, speed: 15 + Math.round(p.level * 0.5),
    money: 200 + p.level * 12, hostile: false,
    tier: 'A', district: p.region, homeless: true,
    favorBase: 0.6, favorInit: 0, favorToLearn: 55,
    teach: skills, schedule: { day: roomOf(p.room, p.region), night: roomOf(p.room, p.region) },
    portrait: Object.assign({ v: 1, tier: 'A', lock: false, marks: MARKS[p.id] || ['武'] }, p.pt),
  };
  made++;
}
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('写入', made, '位 →', OUT);
if (dropped.length) console.log('⚠️ 库里没有这些武学，已剔除：', dropped.join(' | '));
