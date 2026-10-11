/* ============================================================
 * gen-sects-tier.js — 生成「门派三层」(game/data/72_sects_tier.json)
 *
 * 依据 design/44 R1：一流 1/4/7 · 二流 2/5/8 · 三流 3/6/9
 * 现有 14 门派归层 + 新增 8 二流 + 20 三流 = 42 家（含 1 秘境）
 *
 * 同时**修正既有门派 entrySkills**：武学重制后，门派必须连本系基础武学一起授，
 * 否则弟子学了本门功夫却没有「梯子」，练不动（上限 = 基础武学等级 = 0）。
 * ⚠️ 本脚本**只写 72_sects_tier.json 一个文件**。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '72_sects_tier.json');

const WP_BASIC = { 剑: 'basic_sword', 刀: 'basic_blade', 拳: 'basic_fist', 棍: 'basic_staff', 鞭: 'basic_whip', 暗器: 'basic_throw' };

/* ---------- 现有 14 门派：归层 + 授基础武学 + 门派故事 ---------- */
const EXISTING = {
  huashan: { tier: '一流', basics: ['basic_sword', 'basic_force', 'basic_dodge', 'basic_parry'], story: '剑气两宗在这山头上吵了上百年。思过崖石壁上的剑痕，一半是前辈留下的，一半是后来人自己划的。' },
  shaolin: { tier: '一流', basics: ['basic_fist', 'basic_force', 'basic_dodge', 'basic_parry'], story: '晨钟暮鼓，千年的规矩压着一代代人。藏经阁那位扫地的老僧从不说话，也没人问过他会什么。' },
  wudang: { tier: '一流', basics: ['basic_fist', 'basic_sword', 'basic_force', 'basic_dodge'], story: '紫霄宫的鹤落在丹炉边，等一炉丹煮好。道长们推手推得慢，慢得像是故意的。' },
  emei: { tier: '一流', basics: ['basic_sword', 'basic_force', 'basic_throw', 'basic_parry'], story: '金顶佛光下，师太手里的戒尺比剑还快。门规严，可山门里的姑娘们笑起来也真。' },
  gaibang: { tier: '一流', basics: ['basic_staff', 'basic_fist', 'basic_dodge'], story: '破庙里议事，来的都是穿得最破的人。帮主的打狗棒从来不真打狗。' },
  mojiao: { tier: '一流', basics: ['basic_fist', 'basic_force', 'basic_dodge'], story: '黑木崖上喊一声教主，半座山都静了。教里什么人都有，有很坏的，也有被外头逼成这样的。' },
  dali: { tier: '一流', basics: ['basic_fist', 'basic_force', 'basic_sword'], story: '段氏的世子不爱武功爱佛经，偏偏一身内功厚得吓人。皇宫里那几位，练武更像在修行。' },

  tangmen: { tier: '二流', basics: ['basic_throw', 'basic_poison', 'basic_dodge'], story: '蜀中唐门的门规只有一条要紧：不许对外人露脸。看过的人，通常也不必再看第二次。' },
  miaojiang: { tier: '二流', basics: ['basic_poison', 'basic_fist', 'basic_throw'], story: '苗疆的瘴气里养不出娇气的人。蛊是她们养大的，也算家人。' },
  taohua: { tier: '二流', basics: ['basic_blade', 'basic_dodge', 'basic_force'], story: '岛上的桃树按着阵法种，走错一步就绕回原地。岛主弹琴的时候，仆役们都不敢喘气。' },
  gumu: { tier: '二流', basics: ['basic_sword', 'basic_dodge', 'basic_force'], story: '活死人墓里寒玉床冷得刺骨。派中人少，少到晚辈的名字都要按辈分一个个数。' },
  xingxiu: { tier: '二流', basics: ['basic_fist', 'basic_poison'], story: '星宿海的弟子每天争「大师兄」这个称呼，争赢的第二天就防着别人背后下手。' },
  xuedao: { tier: '二流', basics: ['basic_blade', 'basic_force'], story: '西域的刀口舔血久了，人就长那样。山下的仇结了一层又一层，谁也记不清第一桩。' },

  xiake: { tier: '秘境', basics: ['basic_force', 'basic_dodge'], story: '十年才从海上浮出来一次。岛上的石壁刻着些看不懂的东西，看懂了的人都没下来过。' },
};

/* ---------- 新增门派 ---------- */
/* t = tier(1/2/3)，wp = 主兵器，region 挂靠，req 入门条件，trial 考核说明，story 门派故事 */
const NEW_SECTS = [
  // 二流 8 家（核心 2 品 / 中阶 5 品 / 入门 8 品）
  { id: 'taishan', name: '泰山派', t: 1, wp: '剑', region: 'changan', align: '正道',
    req: { attr: '根骨', '>=': 14 }, trial: '在十八盘上走一趟不歇脚，再与守山弟子过三十招。',
    ranks: ['外门弟子', '内门弟子', '执剑弟子', '首座', '长老', '掌门'], rankCost: 320,
    story: '五岳里资历最老的一家，偏偏这些年在并派的议论里最不服气。山门前的松树比掌门还老。' },
  { id: 'hengshan', name: '衡山派', t: 1, wp: '剑', region: 'xiangyang', align: '正道',
    req: { attr: '悟性', '>=': 13 }, trial: '听一曲琴，说出曲中杀气在哪个字上。',
    ranks: ['外门弟子', '内门弟子', '执剑弟子', '首座', '长老', '掌门'], rankCost: 320,
    story: '剑法人人都学，可衡山的看家本事在琴上。掌门说，听不出调子里那点杀意，剑就白练了。' },
  { id: 'hengshanN', name: '恒山派', t: 1, wp: '剑', region: 'changan', align: '正道',
    /* ⚠️ 原来这里是 `req: { gender: 'female' }`。核了一遍原著：**恒山派不收男是错的** ——
       令狐冲这个男的就接了恒山掌门。庵堂里以女尼为主是实情，但门户本身不设性别门槛。
       武侠里真正「按规矩只收一种性别」的只有三类：和尚庙（少林）、尼庵女派（峨眉）、
       以及本就只有女子的隐世门派（古墓）。其余的设了都是拦玩家的假门槛。 */
    req: { attr: '悟性', '>=': 12 }, trial: '抄一遍药方，替三位伤者换过药。',
    ranks: ['记名弟子', '入门弟子', '入室弟子', '首座', '长老', '掌门'], rankCost: 320,
    story: '庵堂里的尼姑们带剑，也带药箱。山上香火不旺，来求医的倒不少。' },
  { id: 'qingcheng', name: '青城派', t: 1, wp: '剑', region: 'chengdu', align: '中立',
    req: { attr: '身法', '>=': 14 }, trial: '从后山崖壁摘一枝松，掉下来就再来一年。',
    ranks: ['外门弟子', '内门弟子', '入室弟子', '首座', '长老', '掌门'], rankCost: 330,
    story: '青城山雾大，弟子们练剑时对手常是自己的影子。掌门那手摧心掌，伤在内里，外头看不出来。' },
  { id: 'kongtong', name: '崆峒派', t: 1, wp: '拳', region: 'changan', align: '中立',
    req: { attr: '力量', '>=': 15 }, trial: '在石桩上打满一百拳，桩不倒就算过。',
    ranks: ['外门弟子', '内门弟子', '入室弟子', '首座', '长老', '掌门'], rankCost: 340,
    story: '七伤拳的名声比崆峒山还大。练这门功夫的人，先伤的是自己，门里老人都知道。' },
  { id: 'kunlun', name: '昆仑派', t: 1, wp: '剑', region: 'xixia', align: '中立',
    req: { karma: '>=0' }, trial: '在雪地里站一夜，天亮时手还能握稳剑。',
    ranks: ['外门弟子', '内门弟子', '执剑弟子', '首座', '长老', '掌门'], rankCost: 340,
    story: '两条剑同时使，是昆仑的老规矩。学不会左右分心的，一辈子只能用一柄。' },
  { id: 'diancang', name: '点苍派', t: 1, wp: '剑', region: 'dali', align: '中立',
    req: { attr: '悟性', '>=': 14 }, trial: '看渔翁撒网，午后比划出来。',
    ranks: ['外门弟子', '内门弟子', '执剑弟子', '首座', '长老', '掌门'], rankCost: 330,
    story: '苍山十九峰，派里十九个剑诀。掌门说剑意不在山中，在过日子的人手里。' },
  { id: 'tiezhang', name: '铁掌帮', t: 1, wp: '拳', region: 'xiangyang', align: '中立',
    req: { attr: '力量', '>=': 16 }, trial: '一掌劈开三块青砖。',
    ranks: ['帮众', '头目', '舵主', '香主', '长老', '帮主'], rankCost: 330,
    story: '铁掌水上漂，说的是帮主的轻功。掌是真硬，人也真不讲道理。' },

  /* ---- 合欢宗：青楼背后的势力（二流）----
     主人设定：合欢宗是青楼背后的势力。据点就设在青楼区（region=qinglou），
     入宗不走寻常拜师，而是「卖身青楼 + 接待满十人」触发。 */
  { id: 'hehuan', name: '合欢宗', t: 1, wp: '拳', region: 'qinglou', align: '邪道',
    req: {}, trial: '不考较武功，只看你肯不肯把脸面放下。',
    ranks: ['外门', '内门', '媚使', '堂主', '长老', '宗主'], rankCost: 300,
    story: '楼子背后的宗家。白日里是弹唱的、陪酒的、写曲子的；夜里换一身衣裳，做的是另一桩买卖。门里不教你打人，教你怎么让人不打你，以及怎么把人留住。' },

  // 三流 20 家（核心 3 品 / 中阶 6 品 / 入门 9 品 · 几乎无考核）
  { id: 'jindao', name: '金刀门', t: 2, wp: '刀', region: 'luoyang', align: '中立',
    req: {}, trial: '在门口交了束脩，领一把木刀就算入门。',
    ranks: ['门徒', '弟子', '亲传弟子', '管事', '长老', '门主'], rankCost: 180,
    story: '城东一处小院，挂了块金漆招牌，专收想学刀护家的后生。招牌褪色了也没人重漆。' },
  { id: 'wuhu', name: '五虎断门刀', t: 2, wp: '刀', region: 'changan', align: '中立',
    req: {}, trial: '报上名号即可。',
    ranks: ['门人', '弟子', '真传', '教头', '长老', '门主'], rankCost: 180,
    story: '刀法是家传的，传到这一代只剩下五招。老爷子不肯承认，还在门外挂了「五虎」的幌子。' },
  { id: 'feihu', name: '飞虎镖局', t: 2, wp: '刀', region: 'changan', align: '中立',
    req: {}, trial: '帮着走过一趟镖，护得住货就是同门。',
    ranks: ['趟子手', '镖师', '镖头', '总镖头', '副局主', '局主'], rankCost: 190,
    story: '走镖的兄弟一条命换一趟银子。旗子在，镖就在。' },
  { id: 'zhenyuan', name: '镇远镖局', t: 2, wp: '刀', region: 'luoyang', align: '中立',
    req: {}, trial: '扛得起院子里那对石锁。',
    ranks: ['趟子手', '镖师', '镖头', '总镖头', '副局主', '局主'], rankCost: 190,
    story: '老镖局了，旗子上补过三回。老局主说，镖行的规矩比刀法要紧。' },
  { id: 'shenquan', name: '神拳门', t: 2, wp: '拳', region: 'cunzhen', align: '中立',
    req: {}, trial: '与门主过两招，撑住十息。',
    ranks: ['门徒', '弟子', '入室', '教习', '长老', '门主'], rankCost: 170,
    story: '门主是个退伍的老兵，拳架子打得极正，就是没创出什么名堂。镇上孩子都跟他学过两天。' },
  { id: 'tieqiang', name: '铁枪门', t: 2, wp: '棍', region: 'luoyang', align: '中立',
    req: {}, trial: '举得起那杆铁枪。',
    ranks: ['门徒', '弟子', '亲传', '教头', '长老', '门主'], rankCost: 180,
    story: '武场里立着三十六杆枪，最重的那杆没人使得动，就摆在门口当招牌。' },
  { id: 'kuaidao', name: '快刀门', t: 2, wp: '刀', region: 'chengdu', align: '中立',
    req: {}, trial: '接住教习三刀不掉兵器。',
    ranks: ['门徒', '弟子', '快手', '教习', '长老', '门主'], rankCost: 180,
    story: '门里只讲一个字：快。慢的都被打发去后院劈柴了。' },
  { id: 'luohan', name: '罗汉门', t: 2, wp: '拳', region: 'xiangyang', align: '中立',
    req: {}, trial: '扎半个时辰的马步。',
    ranks: ['门徒', '弟子', '入室', '教习', '长老', '门主'], rankCost: 170,
    story: '挂着少林的边，其实跟少林没半点关系。门主也不否认，只说拳是真的。' },
  { id: 'wuyun', name: '五云手温家', t: 2, wp: '拳', region: 'chengdu', align: '中立',
    req: {}, trial: '送上一份像样的礼。',
    ranks: ['外姓弟子', '弟子', '亲传', '管事', '长老', '家主'], rankCost: 190,
    story: '做皮货兼使毒的小家族，祖传一手五云手，传男不传女——偏偏这一代只有个女儿。' },
  { id: 'dafeng', name: '大风云飞门', t: 2, wp: '刀', region: 'changan', align: '中立',
    req: {}, trial: '从三丈高的墙头跳下来。',
    ranks: ['门徒', '弟子', '亲传', '教头', '长老', '门主'], rankCost: 180,
    story: '门里人人自称轻功好，其实大半是跑得快。门主说跑得快也算本事。' },
  { id: 'huanghe', name: '黄河帮', t: 2, wp: '棍', region: 'harbor', align: '中立',
    req: {}, trial: '在帮里帮工三天。',
    ranks: ['帮众', '水手', '头目', '舵主', '长老', '帮主'], rankCost: 170,
    story: '撑船拉纤的抱团讨生活。会水性，也会几下棍棒，为的是守住自己的码头。' },
  { id: 'taihu', name: '太湖帮', t: 2, wp: '刀', region: 'gusu', align: '中立',
    req: {}, trial: '能划船绕湖一圈。',
    ranks: ['帮众', '水手', '头目', '舵主', '长老', '帮主'], rankCost: 180,
    story: '湖上的买卖不好做，帮里的船比人多。逢年过节，帮主还得亲自出湖收例钱。' },
  { id: 'poyang', name: '鄱阳帮', t: 2, wp: '棍', region: 'gusu', align: '中立',
    req: {}, trial: '帮着卸一船货。',
    ranks: ['帮众', '水手', '头目', '舵主', '长老', '帮主'], rankCost: 180,
    story: '跟太湖帮是几十年的对头。一年里总有几回，两家的小船在水面上撞得火星四溅。' },
  { id: 'qingzhu', name: '青竹帮', t: 2, wp: '刀', region: 'jiangnan', align: '中立',
    req: {}, trial: '扛一捆青竹进门。',
    ranks: ['帮众', '弟子', '头目', '执事', '长老', '帮主'], rankCost: 170,
    story: '靠竹子吃饭的帮口，从山里砍到城里卖。帮里最值钱的家当是那几片竹山。' },
  { id: 'jujing', name: '巨鲸帮', t: 2, wp: '刀', region: 'harbor', align: '中立',
    req: {}, trial: '跟着出海走一趟。',
    ranks: ['帮众', '水手', '头目', '舵主', '长老', '帮主'], rankCost: 190,
    story: '海上讨生活的人，名字起得凶，日子过得苦。帮主那条船补过七八回。' },
  { id: 'jinlong', name: '金龙帮', t: 2, wp: '拳', region: 'jiangnan', align: '中立',
    req: {}, trial: '在帮口茶楼里坐一天，认全几位头目。',
    ranks: ['帮众', '弟子', '头目', '执事', '长老', '帮主'], rankCost: 190,
    story: '帮口堂口修得最气派，里面的账却不太经得起查。' },
  { id: 'wuliang', name: '无量剑派', t: 2, wp: '剑', region: 'dali', align: '中立',
    req: {}, trial: '走个过场即可。',
    ranks: ['弟子', '入门弟子', '执剑弟子', '首座', '长老', '掌门'], rankCost: 180,
    story: '滇西一座小山头，东宗西宗年年比剑，比来比去都是那几式。掌门说，今年一定分出胜负。' },
  { id: 'funiu', name: '伏牛派', t: 2, wp: '拳', region: 'xiangyang', align: '中立',
    req: {}, trial: '在牛棚住满七日。',
    ranks: ['门徒', '弟子', '亲传', '教头', '长老', '掌门'], rankCost: 170,
    story: '山里人练的拳，讲的是怎么把一头牛按倒。听着土，用起来顶事。' },
  { id: 'baisheng', name: '百胜刀门', t: 2, wp: '刀', region: 'luoyang', align: '中立',
    req: {}, trial: '打赢门里最弱的那个。',
    ranks: ['门徒', '弟子', '快手', '教习', '长老', '门主'], rankCost: 180,
    story: '名字取得大，战绩也就那样。门主每次被人问起，都说是「百胜」不是「百战百胜」。' },
  { id: 'baituo', name: '白驼山', t: 2, wp: '拳', region: 'xixia', align: '邪道',
    req: {}, trial: '赶着蛇群走一里地。',
    ranks: ['蛇奴', '弟子', '驱蛇人', '堂主', '长老', '山主'], rankCost: 200,
    story: '山上养蛇的人比住的人多。山主脾气古怪，说话时蛇就盘在他手边。' },
];

const skillsOf = (code, tier) => {
  const G = { 1: { core: 1, mid: 4, entry: 7 }, 2: { core: 2, mid: 5, entry: 8 }, 3: { core: 3, mid: 6, entry: 9 } }[tier];
  const out = [];
  for (const dom of ['force', 'guard', 'fly', 'atk', 'qimen']) {
    out.push(`${code}_${dom}_1`, `${code}_${dom}_2`, `${code}_${dom}_3`);
  }
  return out;
};
const rankSkillsOf = (code, tier) => ({
  1: [`${code}_force_1`, `${code}_guard_1`, `${code}_fly_1`],
  2: [`${code}_atk_1`, `${code}_qimen_1`],
  3: [`${code}_atk_2`, `${code}_qimen_2`],
  4: [`${code}_force_2`, `${code}_guard_2`, `${code}_fly_2`],
  5: [`${code}_atk_3`, `${code}_qimen_3`, `${code}_force_3`, `${code}_guard_3`, `${code}_fly_3`],
});

const sects = {};
const SKILLS74 = require(path.join(ROOT, 'game', 'data', '74_martial_sects.json')).skills;
const SKILLS10 = require(path.join(ROOT, 'game', 'data', '10_skills.json')).skills;
/* ⚠️ 71 里新增的四门基础武学（基本暗器 / 基本毒术 / 基本医术 / 基本乐理）不在
   10_skills.json 里 —— 漏了这份，entrySkills 的过滤会把它们统统滤掉，
   于是唐门弟子拿不到《基本暗器》、五毒弟子拿不到《基本毒术》，本门功夫一辈子 0 级。 */
const SKILLS71 = require(path.join(ROOT, 'game', 'data', '71_martial_balance.json')).skills;
const ALLSK = Object.assign({}, SKILLS10, SKILLS71, SKILLS74);
const SECT30 = require(path.join(ROOT, 'game', 'data', '30_sects.json')).sects;

/**
 * 门派入门即授的清单 = 「本门入门功夫」+「它们各自那一系的根」。
 * 为什么必须把根一并授了：武学重制后衍生武学的上限 = 基础武学等级，
 * 弟子练不到基础武学 ⇒ 本门功夫永远是 0 级（上线后玩家只会骂「练不动」）。
 * 基础武学本来就是这个世界的「大众货」（九品），门派发几本不违和。
 */
function entrySkillsOf(id, extra) {
  const out = [];
  for (const sid of (SECT30[id] && SECT30[id].entrySkills) || []) out.push(sid);
  for (const dom of ['force', 'guard', 'fly', 'atk', 'qimen']) {
    const sk = ALLSK[`${id}_${dom}_1`];
    if (!sk) continue;
    if (dom === 'force' || dom === 'atk' || dom === 'qimen') out.push(`${id}_${dom}_1`);
    if (sk.base) out.push(sk.base);
  }
  out.push('basic_force', 'basic_parry', 'basic_dodge');
  for (const s of (extra || [])) out.push(s);
  return Array.from(new Set(out)).filter(sid => !!ALLSK[sid]);
}

/* 现有门派：只补 tier / story / entrySkills / 宗门武学清单（skills 写全量） */
for (const [id, cfg] of Object.entries(EXISTING)) {
  const G = { 一流: 1, 二流: 2, 三流: 3, 秘境: 1 }[cfg.tier];
  const old = SECT30[id] || {};
  /* xiake 属「秘境」，没有 15 门矩阵武学（74 里没有 xiake_*）——
     硬塞会造出悬空 id，所以只对真正做过矩阵的门派补。 */
  const hasMatrix = !!SKILLS74[`${id}_atk_1`];
  sects[id] = {
    tier: cfg.tier,
    story: cfg.story,
    /* ⚠️ entrySkills 要走**数组 replace**，必须把原有的原样抄回来 ——
       少了这一步，华山弟子入门就拿不到《华山剑法》（旧的被整段覆盖掉）。 */
    entrySkills: entrySkillsOf(id, cfg.basics),
    skills: Array.from(new Set([...(old.skills || []), ...(hasMatrix ? skillsOf(id, G) : [])])),
  };
}
/* 新增门派：全套定义 */
for (const s of NEW_SECTS) {
  const basic = WP_BASIC[s.wp] || 'basic_fist';
  sects[s.id] = {
    id: s.id, name: s.name, align: s.align, tier: s.t === 1 ? '二流' : '三流',
    region: s.region, story: s.story, trial: s.trial,
    desc: s.story,
    require: s.req,
    ranks: s.ranks, rankCost: s.rankCost,
    skills: skillsOf(s.id, s.t === 1 ? 2 : 3),
    entryItems: [],
    entrySkills: entrySkillsOf(s.id, [basic]),
    rankSkills: rankSkillsOf(s.id, s.t === 1 ? 2 : 3),
  };
}
/* 允许 entrySkills 里出现同一门基础（去重） */
for (const k of Object.keys(sects)) {
  if (Array.isArray(sects[k].entrySkills)) sects[k].entrySkills = Array.from(new Set(sects[k].entrySkills));
}

fs.writeFileSync(OUT, JSON.stringify({ sects }, null, 2) + '\n', 'utf8');
const tiers = {};
for (const s of Object.values(sects)) tiers[s.tier] = (tiers[s.tier] || 0) + 1;
console.log('写入', OUT);
console.log('门派', Object.keys(sects).length, JSON.stringify(tiers));
console.log('新增二流', NEW_SECTS.filter(s => s.t === 1).length, '三流', NEW_SECTS.filter(s => s.t === 2).length);
