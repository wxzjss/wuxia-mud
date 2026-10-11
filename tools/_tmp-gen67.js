/* 临时生成器：产出 game/data/67_sidequests2.json（新支线 + 挂载）
   —— 只写这一个产品文件，不动任何既有数据文件。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '67_sidequests2.json');

/* 统一的两段式模板：先到场子（go0），再决定（go1 + menu）。
   giver 一律写 defId；menu 走 "标题|A>效;效;;B>效"。 */
function mk(q) {
  const stages = q.stages.map((s, i) => {
    const stage = {
      desc: s.desc,
      targets: [{
        id: 'go' + i,
        kind: 'room',
        key: s.room,
        count: 1,
        var: q.id + '_go' + i,
        desc: s.desc,
      }],
      next: i === q.stages.length - 1 ? 99 : i + 1,
      effects: [],
    };
    for (const e of (s.effects || [])) stage.effects.push(e);
    return stage;
  });
  return {
    id: q.id,
    name: q.name,
    type: '支线',
    npc: q.npc,
    giver: q.giver,
    level: q.level,
    desc: q.desc,
    stages,
    rewards: q.rewards,
  };
}

const quests = {};

/* ── 1. 胡录事（bureau_clerk）：名单底档 ───────────────────────── */
quests['hk_bureau_clerk_ledger'] = mk({
  id: 'hk_bureau_clerk_ledger', name: '签押房那份底档', npc: 'bureau_clerk', giver: 'bureau_clerk', level: 24,
  desc: '签押房的老书吏抄了十九年公文，只有一份不该抄，他抄了，还留了一份底。近来东厂的人在衙门里进进出出。',
  stages: [
    {
      desc: '去衙门·库房，翻那本被抽走几页的旧卷宗',
      room: 'jn_yamen_store',
      effects: [
        { type: 'narrate', raw: '库房里三把锁开着，守库的老吏趴在案上打盹。那卷旧档缺了三页，断口齐整，是照着一把尺裁下来的。' },
        { type: 'say', raw: '「抽页的人，手比你稳。」老吏没睁眼，只说了这一句。' },
      ],
    },
    {
      desc: '去城西·义庄旧址，那间他连自己都少去的屋子',
      room: 'jn_yizhuang',
      effects: [
        { type: 'narrate', raw: '义庄的旧木案底下压着一只油布包，包里是本册子。纸页上是十九年前那批人的名字，一笔一画都填得满。' },
        { type: 'say', raw: '「上头那些人，如今还剩几个，我不敢打听。」' },
        { type: 'menu', raw: '这份底档|交给东厂，换一个前程>flag:hk_bureau_clerk_ledger_sell;+rep:朝廷:25;+money:500;+karma:-30;+exp:200;+pot:60;favor:bureau_clerk:-35;incvar:favor_bureau_clerk:-35;;替他藏回墙里，一个字也不提>flag:hk_bureau_clerk_ledger_hide;+karma:20;+rep:丐帮:10;+exp:280;+pot:90;+item:mingdan_didang:1;favor:bureau_clerk:35;incvar:favor_bureau_clerk:35' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '墙里那块松动的砖又填了回去。册子的边角磨过几回，他没再抹。' }],
});

/* ── 2. 闵守（npcv_102）：赴考的盘缠 / 买过的考题 ───────────────── */
quests['hk_npcv_102_panchang'] = mk({
  id: 'hk_npcv_102_panchang', name: '那一届的考题', npc: 'npcv_102', giver: 'npcv_102', level: 19,
  desc: '翰墨斋的闵守考了四届乡试，四届都落了。第五届在即，他连去洛阳的盘缠都凑不齐，内兄也不肯再借。',
  stages: [
    {
      desc: '去江南城·翰墨斋，问他替人抄书一年能挣几个钱',
      room: 'jn_bookshop',
      effects: [
        { type: 'narrate', raw: '书斋里一摞待装订的书页摞到齐眉。闵守抄的字极工整，一笔不潦草，只是抄一页的工钱，够不上一顿饭。' },
        { type: 'say', raw: '「再抄三千页，兴许就够了。」' },
      ],
    },
    {
      desc: '去他家，把话当面说开',
      room: 'hm_npcv_102',
      effects: [
        { type: 'narrate', raw: '院里那丛竹生得密，屋里没点灯。他把上届的事说了：那次买题的钱，是姜朝替他借的，至今没还。' },
        { type: 'say', raw: '「你没考过，不知道落第比没钱难受。都难受。」' },
        { type: 'menu', raw: '八十两盘缠|替他垫上，一个字不多问>flag:hk_npcv_102_panchang_pay;+money:-80;+karma:15;+exp:240;+pot:80;favor:npcv_102:40;incvar:favor_npcv_102:40;;把买题的事说给学政，换他一个清白>flag:hk_npcv_102_kaiti_report;+rep:朝廷:20;+money:150;+karma:-20;+exp:300;+pot:90;favor:npcv_102:-45;incvar:favor_npcv_102:-45' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '书箱扣上了。箱盖上那行歪字，是他自己刻的。' }],
});

/* ── 3. 庞听（npcv_109）：军需漕运 / 旧冬衣 ─────────────────────── */
quests['hk_npcv_109_junxu'] = mk({
  id: 'hk_npcv_109_junxu', name: '多出来的一批棉', npc: 'npcv_109', giver: 'npcv_109', level: 4,
  desc: '庞听盯着朝廷新征的一批军需。二十年前他也押过这样一批冬衣，那趟货发了出去，钱没回来，人也少了一个。',
  stages: [
    {
      desc: '去江口码头，替他看那批要走漕运的船',
      room: 'jn_harbor',
      effects: [
        { type: 'narrate', raw: '码头上桅杆林立。庞听订的那三条船吃水都浅，舱里垫着油布，只等装货。' },
        { type: 'say', raw: '「货走水路，利钱厚，担的风险也厚。你替我盯着。」' },
      ],
    },
    {
      desc: '去东市·粮仓，看那批军需的仓房',
      room: 'jn_granary',
      effects: [
        { type: 'narrate', raw: '仓角堆着一摞旧冬衣，棉絮一捏就塌，里头掺着沙。墙角记事的木牌上，写着二十年前的年份。' },
        { type: 'say', raw: '「那年边关冷，货发出去晚了半月。」他没往下说。' },
        { type: 'menu', raw: '仓里那批旧冬衣|替他跑完这趟漕运>flag:hk_npcv_109_junxu_done;+money:800;+rep:朝廷:20;+karma:-10;+exp:240;+pot:70;favor:npcv_109:40;incvar:favor_npcv_109:40;;把旧冬衣的样子记下，送去屈疏手里>flag:hk_npcv_109_jiuyi_done;+rep:丐帮:10;+karma:25;+exp:320;+pot:90;favor:npcv_109:-30;incvar:favor_npcv_109:-30;favor:npcv_010:25;incvar:favor_npcv_010:25' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '庞听抚着靴面，什么也没说。那靴子是新做的，走一步响一声。' }],
});

/* ── 4. 元若（npcv_073）：雅间那二两茶钱 ───────────────────────── */
quests['hk_npcv_073_yajian'] = mk({
  id: 'hk_npcv_073_yajian', name: '雅间那二两茶钱', npc: 'npcv_073', giver: 'npcv_073', level: 37,
  desc: '老茶馆的雅间里换了三拨客人，话越说越轻。掌柜的元若收了他们每月二两茶钱，收了两年，如今夜里睡不安稳。',
  stages: [
    {
      desc: '去醉仙楼·二楼雅间，听那伙人谈的是什么',
      room: 'jn_wine_room',
      effects: [
        { type: 'narrate', raw: '雅间桌上摆着半局棋，棋没动，茶凉了两回。几个人压着嗓子，说的都是官粮的凭据、印子、水路。' },
        { type: 'say', raw: '「借你这间屋子说话，是因为你这张嘴严。」他们对元若说。' },
      ],
    },
    {
      desc: '回东市·老茶馆，给他一个说法',
      room: 'jn_teahouse',
      effects: [
        { type: 'narrate', raw: '元若站在柜台后，围裙上的油点又多了几块。他把那二两碎银推过来，手抖了一下。' },
        { type: 'say', raw: '「这银子烫手。我接了两年，越接越烫。」' },
        { type: 'menu', raw: '那二两茶钱|往后我替你担着，雅间的事按下>flag:hk_npcv_073_yajian_cover;+money:200;+karma:-10;+exp:220;+pot:70;favor:npcv_073:35;incvar:favor_npcv_073:35;;把这伙人告到衙门，黄清那边我替你说话>flag:hk_npcv_073_yajian_report;+rep:朝廷:25;+karma:20;+exp:280;+pot:80;favor:npcv_073:-25;incvar:favor_npcv_073:-25;favor:npcv_181:-15;incvar:favor_npcv_181:-15' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '抽屉合上，压了本旧账簿在最底下。那二两碎银，在里头响了一下。' }],
});

/* ── 5. 元怀瑾（npcv_149）：库房多出的三千两 ───────────────────── */
quests['hk_npcv_149_hegong'] = mk({
  id: 'hk_npcv_149_hegong', name: '库房多出的三千两', npc: 'npcv_149', giver: 'npcv_149', level: 42,
  desc: '朝廷新拨的河工银子到了衙门库里，比文书上多出三千两。元怀瑾做了三十年官，头一回把茶碗端在手里，凉了半天没喝。',
  stages: [
    {
      desc: '去衙门·库房，核一核那笔银子的数目',
      room: 'jn_yamen_store',
      effects: [
        { type: 'narrate', raw: '库房里的银子码得整整齐齐，账册上的数目却比文书多出一截。管库的老吏说，送银子来的人没留名。' },
        { type: 'say', raw: '「多出来的，多半不是给我的。」元怀瑾站在门口，没进去。' },
      ],
    },
    {
      desc: '去洛阳城·牡丹大街，查那三千两的来路',
      room: 'luoyang_street',
      effects: [
        { type: 'narrate', raw: '洛阳的牡丹开得正盛。兑银子的那家钱庄，账上记的是一笔京里来的汇款，汇款人那一栏空着。' },
        { type: 'say', raw: '「京里递话的日子，正好是钦差出京那天。」' },
        { type: 'menu', raw: '那三千两|替他压下来，只说查无实据>flag:hk_npcv_149_hegong_silent;+money:500;+exp:260;+pot:80;favor:npcv_149:35;incvar:favor_npcv_149:35;;如数报上去，连他自己的干系一并说清>flag:hk_npcv_149_hegong_report;+rep:朝廷:35;+karma:20;+exp:340;+pot:95;favor:npcv_149:-20;incvar:favor_npcv_149:-20' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '元怀瑾把茶碗里的凉茶泼进花盆，重新沏了一碗。' }],
});

/* ── 6. 任停（npcv_027）：破庙是谁的 ───────────────────────────── */
quests['hk_npcv_027_miaozheng'] = mk({
  id: 'hk_npcv_027_miaozheng', name: '破庙是谁的', npc: 'npcv_027', giver: 'npcv_027', level: 34,
  desc: '城西那座破庙，任停住了七年，如今墙要塌了。庙契压在县衙旧档底下，庞南枝说这庙本是他师祖的道观，两人七年没说过一句整话。',
  stages: [
    {
      desc: '去衙门·库房，从旧档里翻那张庙契',
      room: 'jn_yamen_store',
      effects: [
        { type: 'narrate', raw: '库房最底下那口木箱里，压着一叠旧契。庙契上盖的印还在，年份比任停进庙那天早了两百多年。' },
        { type: 'say', raw: '「旧档归旧档。谁去要，谁就得先递牌子。」看库的老吏打了个哈欠。' },
      ],
    },
    {
      desc: '回城西破庙，把契交到他手里',
      room: 'jiangnan_temple',
      effects: [
        { type: 'narrate', raw: '供桌上那一处被人擦得干净。任停下了扫帚，看着那张契，看了很久。' },
        { type: 'say', raw: '「这契要真在我手里，庙就不是她的了。可它守了这庙七年。」' },
        { type: 'menu', raw: '那张庙契|交给任停，让这庙有个下落>flag:hk_npcv_027_ren;+karma:20;+rep:丐帮:10;+exp:260;+pot:80;favor:npcv_027:40;incvar:favor_npcv_027:40;;偷偷送给庞南枝，换一笔现钱>flag:hk_npcv_027_pang;+money:400;+karma:-25;+exp:200;+pot:60;favor:npcv_027:-40;incvar:favor_npcv_027:-40;favor:npcv_095:25;incvar:favor_npcv_095:25' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '供桌底下那处空地，重新落了尘。扫帚声一下，一下。' }],
});

/* ── 7. 强秋（npcv_081）：箱子里的货 ───────────────────────────── */
quests['hk_npcv_081_xiangzi'] = mk({
  id: 'hk_npcv_081_xiangzi', name: '箱子里的货', npc: 'npcv_081', giver: 'npcv_081', level: 41,
  desc: '强秋押的那趟货，在唐门地界压了七天。他验过箱，里头不是镖行文书上写的药材。刁立也知道，每月来要一回钱。',
  stages: [
    {
      desc: '去东市·粮仓，看一眼那口没人认领的箱子',
      room: 'jn_granary',
      effects: [
        { type: 'narrate', raw: '箱子钉在仓角，木缝里透着土腥味。文书上写的是药材，可箱底压着的麻纸，一摸是硬的。' },
        { type: 'say', raw: '「钉子是新加的，加了三道。」' },
      ],
    },
    {
      desc: '回东市·老茶馆，把话递给他',
      room: 'jn_teahouse',
      effects: [
        { type: 'narrate', raw: '强秋坐在角落，虎口的茧蹭着刀鞘。他听完，端起茶没喝，又放下了。' },
        { type: 'say', raw: '「这趟货要是出岔子，我这条命就搭上了。可箱子一开，我这行就做不成了。」' },
        { type: 'menu', raw: '那口箱子|夜里开箱看个明白，瞒不住>flag:hk_npcv_081_xiangzi_kai;+exp:300;+pot:90;+karma:-10;favor:npcv_081:20;incvar:favor_npcv_081:20;;一个字不碰，把箱子原样送出去>flag:hk_npcv_081_xiangzi_shou;+rep:镖行:25;+exp:220;+pot:70;favor:npcv_081:35;incvar:favor_npcv_081:35' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '「多谢」两个字他没说出口。茶钱压在碗底，人先走了。' }],
});

/* ── 8. 黄清（npcv_181）：三年前那一船人 ───────────────────────── */
quests['hk_npcv_181_guanliang'] = mk({
  id: 'hk_npcv_181_guanliang', name: '三年前那一船人', npc: 'npcv_181', giver: 'npcv_181', level: 7,
  desc: '捕快黄清手里压着三桩悬案，最不想破的那桩，是三年前黄河决口时她私放的一船人。那船人如今散在丐帮。',
  stages: [
    {
      desc: '去丐帮·破庙，认一认当年那船人',
      room: 'gaibang_po_miao',
      effects: [
        { type: 'narrate', raw: '破庙里横七竖八躺着十几个叫花子。有个老的听见黄清的名字，把手里的叫花鸡放下了。' },
        { type: 'say', raw: '「三年前，江上有个女公差开过一船人。是她么？」' },
      ],
    },
    {
      desc: '回衙门后院，给她回话',
      room: 'jn_yamen_back',
      effects: [
        { type: 'narrate', raw: '黄清立在墙根，水火棍杵在手边。她没问查到什么，先问了一句：那些人还好么。' },
        { type: 'say', raw: '「那船人要是有一个死了，就是我害的。」' },
        { type: 'menu', raw: '三年前那一船|替她把这件事封死，谁问都说不知道>flag:hk_npcv_181_guanliang_seal;+money:300;+karma:-10;+exp:240;+pot:75;favor:npcv_181:40;incvar:favor_npcv_181:40;;劝她自己到府台面前认了>flag:hk_npcv_181_guanliang_admit;+rep:朝廷:20;+karma:25;+exp:340;+pot:95;favor:npcv_181:-15;incvar:favor_npcv_181:-15' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '水火棍靠回墙角。她望的方向是城东，没再说话。' }],
});

/* ── 9. 药婆婆（wen_huashan_shop）：山上的那个后生 ─────────────── */
quests['hk_yaopopo_shanzi'] = mk({
  id: 'hk_yaopopo_shanzi', name: '山上的那个后生', npc: 'wen_huashan_shop', giver: 'wen_huashan_shop', level: 8,
  desc: '华山脚下那间药铺，药婆婆认得山里头毒，却不敢明着治。山上那个采药的后生，中的是唐门的毒。',
  stages: [
    {
      desc: '去华山·后山，找那个中毒的后生',
      room: 'huashan_houshan',
      effects: [
        { type: 'narrate', raw: '后生靠在一棵老松下，嘴唇发紫，手却还攥着半篮草药。篮底垫着几片嫩叶，是解一半毒的药。' },
        { type: 'say', raw: '「再拖两天，舌头就麻得说不出话了。」' },
      ],
    },
    {
      desc: '回华山脚下，问药婆婆怎么治',
      room: 'huashan_shanxia',
      effects: [
        { type: 'narrate', raw: '药婆婆煎药的炉子烧到一半，又灭了。她把那本册子往怀里按了按，纸页是拿血写的。' },
        { type: 'say', raw: '「这毒我认得。明着治，唐门三日内就上门；暗着治，救得了他，救不了我。」' },
        { type: 'menu', raw: '那味唐门的毒|明着煎药救人，让唐门看见>flag:hk_yaopopo_shanzi_ming;+karma:25;+exp:300;+pot:90;+rep:唐门:-15;+item:xueshu_cezi:1;favor:wen_huashan_shop:35;incvar:favor_wen_huashan_shop:35;;把药掺进他的干粮里，只当没这回事>flag:hk_yaopopo_shanzi_an;+exp:240;+pot:80;favor:wen_huashan_shop:20;incvar:favor_wen_huashan_shop:20' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '怀里那本册子按得更实了。炉子上，药气重新升起一线。' }],
});

/* ── 10. 梅拾（npcv_219）：胭脂盒夹层里的账 ────────────────────── */
quests['hk_npcv_219_zhangmu'] = mk({
  id: 'hk_npcv_219_zhangmu', name: '胭脂盒夹层里的账', npc: 'npcv_219', giver: 'npcv_219', level: 15,
  desc: '醉春楼的梅拾识得字，这在楼里是件麻烦事。她爹当年抄错一笔账，死在大牢里。她自己抄了一份府里历年的账目，压在胭脂盒的夹层里。',
  stages: [
    {
      desc: '去醉春楼·花厅，取那只胭脂盒',
      room: 'jn_brothel_hall',
      effects: [
        { type: 'narrate', raw: '花厅里八盏灯照得人脸发红。梅拾把胭脂盒推过来，盒盖一掀，夹层里那叠纸比胭脂还薄。' },
        { type: 'say', raw: '「我爹那笔账，就在头一页上。」' },
      ],
    },
    {
      desc: '去衙门·大堂，决定递不递',
      room: 'jn_yamen_court',
      effects: [
        { type: 'narrate', raw: '公堂上衙役不多。梅拾的状子压在袖里，纸边被攥得起了毛。' },
        { type: 'say', raw: '「递上去，我就回不了楼；压下来，他就白死了。」' },
        { type: 'menu', raw: '那本账|替她把状子递到府台案头>flag:hk_npcv_219_zhangmu_send;+rep:朝廷:40;+karma:20;+exp:320;+pot:95;+item:rouge_box:1;favor:npcv_219:40;incvar:favor_npcv_219:40;;把账本压下，只当没看过>flag:hk_npcv_219_zhangmu_hide;+money:300;+karma:-20;+exp:200;+pot:60;favor:npcv_219:-35;incvar:favor_npcv_219:-35' },
      ],
    },
  ],
  rewards: [{ type: 'say', raw: '空胭脂盒揣回袖里。指尖蹭上一点红，她没擦。' }],
});

/* ── 新物品 ────────────────────────────────────────────────────── */
const items = {
  mingdan_didang: {
    id: 'mingdan_didang', name: '名单底档', type: 'misc', value: 80,
    desc: '一本旧册子，纸页边上卷了毛。一页一行名字，字迹工整，末几个名字的墨色比前头新。',
    tags: ['book'], quality: 'common',
  },
  xueshu_cezi: {
    id: 'xueshu_cezi', name: '血书解毒册', type: 'misc', value: 90,
    desc: '册子不厚，纸页发黄。字是用暗红色的墨写的，写到后来一处比一处潦草，像写字的人手在抖。',
    tags: ['book'], quality: 'fine',
  },
};

/* ── 挂载（quests 为 replace 语义 → 各人原有 quests 一并为空，写全量） ── */
const npcs = {};
const mount = {
  bureau_clerk: ['q_main_sect', 'hk_bureau_clerk_ledger'],
  npcv_102: ['hk_npcv_102_panchang'],
  npcv_109: ['hk_npcv_109_junxu'],
  npcv_073: ['hk_npcv_073_yajian'],
  npcv_149: ['hk_npcv_149_hegong'],
  npcv_027: ['hk_npcv_027_miaozheng'],
  npcv_081: ['hk_npcv_081_xiangzi'],
  npcv_181: ['hk_npcv_181_guanliang'],
  wen_huashan_shop: ['hk_yaopopo_shanzi'],
  npcv_219: ['hk_npcv_219_zhangmu'],
};
for (const id of Object.keys(mount)) npcs[id] = { id, quests: mount[id].slice() };

const out = { quests, items, npcs };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('wrote', OUT, 'quests=', Object.keys(quests).length, 'items=', Object.keys(items).length, 'npcs=', Object.keys(npcs).length);
