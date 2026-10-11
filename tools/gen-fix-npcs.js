/* ============================================================
 * gen-fix-npcs.js — NPC 数据修正 + 首批人物画像落盘
 *
 * 修《NPC 人物画像规格书》§0 点名的 4 个数据 Bug：
 *   B1  45 个 NPC（实为 5 个 tag 组共 45 人）共用同一条 desc，
 *      且 27 个女性持有者被写成「寻常人家的汉子」。
 *      → 按 tag × gender 重建 desc 模板表，288 条 npcv_* 全部重刷。
 *   B2  身份与落点错配：青楼女子不在青楼、富商全挤在醉春楼听雨轩、
 *      农夫落在绸缎庄、镖师落在少林练武场。
 *      → 建「身份 → 允许区域」白名单，跑一次重摆。
 *   B3  tag 误挂：黄药师 tag=doctor（应为江湖高手）。
 *   B4  age 与身份冲突：神秘老僧 19 岁、方证大师 26 岁、灭绝师太 20 岁…
 *      → 具名手写覆盖 + 按 tag 给合理区间。
 *
 * 外加：把 design/03-portrait-samples.md 的 13 份样张画像
 *      写进 def.portrait（首批）。
 *
 * 幂等三原则（与 gen-social.js 一致）：
 *   1. 存在即跳过：def.portrait && def.portrait.v === 1 → 跳过
 *   2. 手写锁：def.portrait.lock === true → 永不覆盖
 *   3. 同种子可复现：mulberry32(20261008)
 *
 * 用法：node tools/gen-fix-npcs.js [--dry] [--report]
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NPC_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const MAP_FILE = path.join(ROOT, 'game', 'data', '50_map.json');
const BAK_FILE = path.join(__dirname, '_bak', '40_npcs.pre-portrait.json');
const PORTRAIT_FILE = path.join(__dirname, 'portraits-batch1.json');

const DRY = process.argv.includes('--dry');

/* ---------------- 可复现随机（与 gen-social.js 同种子同算法） ---------------- */
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
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));

/* ================================================================
 * B1 —— desc 模板表：tag → { a 衣着/随身, b 体态细节, c 神态动作 }
 *   b 有两个版本：b（男）/ bf（女）。未给 bf 的用通用 FEMALE_MARK。
 *   全部句式：短句，一句一个动作，不带人称代词（女 NPC 绝不出现「汉子/他」）。
 * ================================================================ */
const FEMALE_MARK = [
  '发间只簪一根素银簪',
  '梳着双鬟，鬓角抿得齐整',
  '袖口绣着一圈细小的缠枝纹',
  '腰身束得细，走路时裙摆几乎不动',
  '耳上坠着一对小小的珠子',
  '一条辫子垂在胸前，辫梢系着旧红绳',
  '眉眼生得清淡，看人时先垂一下眼',
  '手背上有几颗浅浅的烫疤',
  '肩上披着件半旧的帔子',
  '指节细长，指甲修得干干净净',
];

const DESC = {
  swordsman: {
    a: ['一柄剑斜挎在背上，剑鞘磨得发亮', '腰间悬着剑，剑穗旧得起了毛', '一身青布短打，袖口束得紧紧的', '斗笠压得低，遮住半张脸', '背上是个布裹的长物，看不出是刀是剑'],
    b: ['虎口与指节都结着厚茧', '眉骨上一道旧疤，斜进鬓里', '肩背笔直，站多久也不松', '手掌宽大，指节粗得像竹节', '脖颈上有道勒痕，像是旧伤'],
    bf: ['腰细肩薄，握剑的手却很稳', '眉骨上一道细疤，被胭脂盖过一半', '发束得高，额角留着汗', '手上有茧，虎口那一块最厚', '站姿像随时要退一步再进'],
    c: ['见人只点一下头，不多话', '目光始终扫着四周，不肯把背交给谁', '开口前先看一眼对方的腰', '笑也只笑到眼睛为止', '站着不动，也像随时要走'],
  },
  taoist: {
    a: ['一袭青布道袍，袍角沾着泥', '道髻上插着根木簪，簪头裂了', '背着一个旧葫芦，腰间系着拂尘', '青袍洗得发白，领口补丁叠补丁', '脚上一双布鞋，鞋帮磨穿了底'],
    b: ['指节细长，指甲修剪得整齐', '面色清癯，颧骨略高', '说话时手总在袖里拢着', '走路脚不沾地似的，悄然无声', '眉心一颗朱砂痣'],
    c: ['说话慢，一句说完要停一停', '看人时先看你身后的路', '笑起来眼睛眯成一条缝', '答话总是半句，剩半句留给对方猜', '常有口不言语，只点头'],
  },
  doctor: {
    a: ['背着个旧药箱，箱角磨圆了', '腰上挂着几只小瓷瓶，走起来叮当响', '袖口沾着些褐色的药渍', '手里捻着一根银针，针尾缠着线', '挎着的布袋鼓鼓的，露出几截草根'],
    b: ['指节修长，一闻就是常年捣药的手', '指甲缝里嵌着洗不掉的药色', '眼白微黄，看人先看气色', '手背上有几处烫伤的旧痕', '说话时拇指总在摩挲食指'],
    c: ['开口先问哪里不舒服', '看人先看脸色再看衣裳', '说到病情就压低声音', '答话简短，不肯把话说满', '常伸手要替人摸脉，又缩回去'],
  },
  innkeeper: {
    a: ['柜台后站着，围裙上全是油点', '手里攥着块抹布，走到哪儿擦到哪儿', '袖子挽到肘上，小臂上一层黑汗', '腰间一串钥匙，走起来哗啦响', '肩上搭着条毛巾，巾角已经发硬'],
    b: ['脸盘圆，笑起来眼睛就剩两条缝', '手指粗短，指缝里都是洗不净的垢', '身板厚实，堵在门口就过不去', '脖子后面一道横褶', '嗓门大，一开口满堂都听得见'],
    c: ['见人就招呼，熟客叫得出名字', '一边说话一边算账，两不耽误', '说到价钱就笑，说到欠账就沉脸', '眼睛始终盯着大堂，谁进来都知道', '递茶时顺手把茶碗顿在桌上'],
  },
  beggar: {
    a: ['一件看不出本来颜色的短褂，膝盖处补了三层', '破袄用草绳拦腰系着，下摆成了布条', '赤着一只脚，另一只鞋是用草编的', '肩上挂着个豁口的葫芦，里头晃着水', '头上戴顶没了边的破毡帽'],
    b: ['手背皴裂，指甲缝里全是黑', '肋骨在衣服下头一根根数得出来', '一条腿跛着，站久了要换脚', '脸上一层风吹日晒的糙皮', '常年不洗的头发结成了毡'],
    c: ['坐在道边，面前没有碗，也不伸手', '见人过来就低头，等走远了才抬眼', '说话含混，像是嘴里含着东西', '讨东西时眼睛看地，不看人', '有人给就接，不给也不追'],
  },
  monk: {
    a: ['一身灰布僧衣，肩上打着补丁', '光头上有一块戒疤，颜色比周围深', '颈上挂一串磨得发亮的念珠', '脚上是草鞋，鞋底磨得只剩一层', '僧袍下摆湿了一截，也不在意'],
    b: ['眉目疏淡，看不出年纪', '手掌合十时，指节微微发抖', '身形枯瘦，肩上却挑得动水', '面色沉静，看人不出喜怒', '一只耳朵后头有块烫伤的疤'],
    c: ['说话前先念半句佛号', '答话极短，多一句也不肯说', '看人时眼帘半垂', '被问急了就笑一笑，还是不答', '手里的念珠始终不停'],
  },
  commoner: {
    a: ['一身粗布衣裳，袖口磨得起了毛边', '肩上挎着个蓝布包袱，包得四四方方', '头上一顶旧毡帽，帽檐塌了一半', '脚上是布鞋，鞋面上落着灰', '腰间别着个旱烟袋，烟杆裂了'],
    b: ['脸上皱纹深，笑起来堆在一处', '手掌粗糙，掌心一层硬皮', '身板矮壮，走路有点外八', '眼角有块胎记', '背微微驼着，像是常年低头干活'],
    c: ['见人先笑，笑得有点讨好', '说话前先看看四周', '答话爱说「是是」，然后才说正题', '把手在衣襟上擦了擦才伸出来', '站着时两只手不知往哪儿放'],
  },
  vendor: {
    a: ['守着个小摊，摊布上摆着零碎东西', '肩上挑着副担子，一头是筐一头是箱', '手里举着个拨浪鼓，时不时摇两下', '摊前插着个幌子，字已经看不清了', '腰上围着个钱袋，鼓鼓的'],
    b: ['嗓门亮堂，隔着两条街都听得见', '手指灵活，找钱从来不用看', '眼角有笑纹，一说话就出来', '肩上被扁担压出一道深印', '一只耳朵上夹着根记账的炭笔'],
    c: ['一边招呼客人一边瞟着街面', '价钱报得快，砍价也挡得快', '说到货好就拍胸脯', '见人走近立刻换上笑', '没人时就蹲着打盹，有人立刻醒'],
  },
  scholar: {
    a: ['一袭青衫，洗得看不出原来的颜色', '手里总攥着半卷书，书角卷了边', '背上是个书箱，箱上刻着歪字', '头上戴方巾，巾带松了一边', '袖子里鼓鼓囊囊，不知塞着什么'],
    b: ['身上墨香比酒香重', '手指上有墨渍，怎么洗都留着', '身形单薄，风大了要缩一缩', '眼睛近视，看人要凑近', '说话时下巴上那撮胡子一翘一翘'],
    c: ['开口先引一句书，再往下说', '走路都在默诵，嘴唇动个不停', '说到功名就低头，说到文章就抬头', '被人打断会愣一下，才想起来说什么', '答话慢，字斟句酌'],
  },
  farmer: {
    a: ['裤脚卷到膝上，腿上全是泥点', '肩上扛着把锄头，锄刃磨得雪亮', '头上扣着顶草帽，帽檐破了个口', '腰里别着把镰刀，刀把油光发亮', '手里拎着个竹篮，篮里是半篮菜'],
    b: ['皮肤晒成酱色，脖子上脱了一层皮', '手掌粗糙开裂，裂纹里嵌着泥', '肩上的扁担压出了深深的印子', '指甲缝里黑，洗不掉', '身板结实，臂上一条条硬肉'],
    c: ['说话憨，一句一个「俺」', '见人先停下手的活，直起腰', '说到收成就叹气，说到天就抬头', '手总在裤腿上蹭', '答话慢半拍，像要先想清楚'],
  },
  smith: {
    a: ['赤着上身，腰上系条围裙，全是火星烫的洞', '胳膊上烫着几处旧疤', '手里拎着把铁锤，锤把磨得发亮', '脖子上搭着条毛巾，黑得看不出底色', '围裙口袋里插着两三根铁钉'],
    b: ['肌肉虬结，抡起锤来虎口生风', '臂上青筋暴起，像爬着蚯蚓', '满脸炭黑，只有眼白是白的', '手掌厚得像块铁板', '说话时胸膛起伏，喘得粗'],
    c: ['开口像敲铁，一句一个实字', '说话时手不停，边说边敲', '说到好钢就来劲，说到价钱就沉默', '笑起来声音从胸腔里出来', '见人进来只抬一下眼'],
  },
  waiter: {
    a: ['肩上搭着条白巾，巾角已经发灰', '手里托着个木盘，盘上摞着碗', '围裙系得紧，腰上别着块抹布', '袖子挽得高，小臂上烫着疤', '脚上一双软底鞋，走起来没声'],
    b: ['脚下生风，一碗汤端过来洒不出半滴', '记性好，谁点了什么从不出错', '肩膀一高一低，是常年端盘子压的', '手指上有烫疤，一层压一层', '眼尖，谁举手都先看见'],
    c: ['答话先应一声「来了」', '一边说话一边擦桌子', '说到掌柜就压低声音', '笑得快，收得也快', '脚不停，说话时也在挪'],
  },
  merchant: {
    a: ['绫罗绸缎裹着个圆滚滚的身板', '手指上套着枚大金戒', '肩上披着件锦袄，袄边镶着毛', '腰上挂着玉佩，玉是好玉', '手里摇着把折扇，扇面题着字'],
    b: ['脸上油光，笑起来看不见眼珠', '手指短粗，指甲修得整齐', '身板富态，走路有点晃', '下巴两层，说话时一颤一颤', '算账时眼珠转得飞快'],
    c: ['开口先问你要什么，再报价钱', '说到货就滔滔不绝', '价钱上寸步不让，脸上还是笑', '见人穿得差就爱搭不理', '说话时扇子不停'],
  },
  richman: {
    a: ['衣料考究，腰上别块好玉', '一身杭绸，袖口滚着暗边', '手上戴着扳指，指头却细', '外头罩着件貂氅，天不冷也穿着', '靴子是新的，走一步响一声'],
    b: ['浑身上下都写着「不缺钱」三个字', '面色白净，手上没做过活', '身形清瘦，衣服却做得宽', '说话时下巴微抬', '指甲修得整齐，从来不沾土'],
    c: ['说话慢，说一句歇一句', '答话前先看一眼随从', '说到银钱就皱眉，说到门路就来神', '笑起来只扯一下嘴角', '从不先开口，等人先说'],
  },
  groom: {
    a: ['蹲在车辕上，手里拿着根鞭子', '腰上系着粗布腰带，别着个酒葫芦', '肩上搭着块擦车的旧布', '脚上是草鞋，鞋底钉着铁掌', '头上裹着块汗巾，汗湿了一圈'],
    b: ['手掌全是缰绳勒出的沟', '腿有点罗圈，是常年骑出来的', '皮肤黑红，脖子更黑', '身上有股牲口味', '一笑露出一口黄牙'],
    c: ['听见有人走近立刻睁眼', '说话爱带牲口的行话', '答话简短，多半是「嗯」「不走」', '一边说话一边摸牲口的鼻子', '打盹时也竖着一只耳朵'],
  },
  child: {
    a: ['一个总角小孩，扎着两个冲天辫', '穿着件大人的旧衣裳改的小褂', '光着脚，脚趾头全是泥', '手里攥着个木雕的小玩意', '鼻涕快过河了也不知道擦'],
    b: ['看见生人也不怕，睁着圆眼睛打量你', '个子矮，说话要仰着头', '脸上还有婴儿肥', '膝盖上结着痂', '手指头短，攥东西攥得紧'],
    c: ['问什么都答，答完就跑', '说话奶声奶气，说快了打结', '一边说一边跳', '被人一吓就躲到大人身后', '答完还要反问一句'],
  },
  refugee: {
    a: ['一身不知从哪儿捡来的衣裳，大得不合身', '怀里抱着个包袱，抱得死紧', '脚上没有鞋，脚底结着厚茧', '头上裹着块破布', '手里拄着根树枝当拐'],
    b: ['瘦得只剩一把骨头', '眼窝深陷，看人时先看你手里的东西', '嘴唇干裂，裂口结着痂', '头发里藏着虱子，也不挠', '肩膀一缩一缩，像是怕冷'],
    c: ['说话声音很小，要凑近才听得见', '问一句答一句，多一个字也不说', '眼睛始终盯着地面', '有人靠近就往后退半步', '说话时手护着包袱'],
  },
  escort: {
    a: ['腰背挺直，一双手始终没离开过刀柄', '身上是镖行的号衣，号衣上补过', '肩上背着个包袱，包得方方正正', '脚上是快靴，靴筒磨得发毛', '腰间别着面小旗，旗上写着镖号'],
    b: ['虎口有厚茧，是常年握刀握出来的', '脸上一道风霜色，看不出年纪', '走路步子大，落地无声', '肩膀宽，背上能扛两百斤', '眼角有一道旧刀伤'],
    c: ['坐着也警醒，谁从背后过来都知道', '答话先「嗯」一声，再说话', '说到镖就正色，说到货就转开脸', '笑起来很慢，像是好久没笑过', '从不背对着门口坐'],
  },
  constable: {
    a: ['身着皂衣，腰悬铁尺', '头上戴顶官帽，帽翅歪了一边', '腰间挂着牌子，牌上写着「捕」', '手里拎着根水火棍', '袖口束着，靴子踩得噔噔响'],
    b: ['走路带着三分官气', '眼神利，看人先看手', '脸上没什么表情', '手掌有练过的茧', '站姿是公门里站出来的'],
    c: ['开口先问你姓什么', '答话短，不肯多说一个字', '说到案子就压低声音', '被人套话就不答了', '说话时手不离腰'],
  },
  official: {
    a: ['一身官服，补子洗得有点旧', '头上乌纱帽，帽翅端正', '腰间玉带，玉带扣松了一格', '手里拿着个鼻烟壶', '袖口宽大，说话时甩一甩'],
    b: ['面色保养得好，手上没做过粗活', '身形端方，坐有坐相', '说话时下巴微收', '指节细白', '眉间一道竖纹，是常年皱眉皱出来的'],
    c: ['说话慢条斯理，一句三顿', '答话前先端起茶碗', '说到上司就恭敬，说到下属就淡', '笑不露齿', '从不把话说死'],
  },
  eunuch: {
    a: ['一身内侍的服色，腰上系着黄带', '手里拿着把拂尘，拂尘穗子白了', '说话时手笼在袖里', '脚上是软底靴，走起来没声', '帽子上缀着颗珠子'],
    b: ['面上无须，声音细而尖', '身形瘦削，背有点弓', '手指细长，指甲留得长', '眼珠转得快', '说话时头略低'],
    c: ['开口先拖一声长音', '答话绕弯子，不直说', '说到宫里的事就停', '笑了也没声音', '说话时眼睛不看人'],
  },
  palace: {
    a: ['宫装束得齐整，裙摆扫着地', '发上戴着宫花，花是绢做的', '袖口滚着三道边', '腰间系着条丝绦，绦上坠着玉', '肩上披着件薄纱'],
    bf: ['发髻梳得一丝不乱', '耳上坠着东珠', '指上戴着护甲', '眉画得细长', '腰身束得极紧'],
    b: ['身形单薄，站久了要换脚', '面色苍白，不见日光', '手指细白，没做过活', '眼神躲闪，不敢正眼看人', '走路步子小'],
    c: ['说话声音压得极低', '答话只用「是」和「不知」', '话问到跟前，先朝两边扫一眼', '说到主子就住口', '笑也是无声的'],
  },
  consort: {
    a: ['一身绯色宫装，领口绣着凤', '发上簪着步摇，走一步晃一晃', '肩上披着狐裘', '袖口缀着珍珠', '裙上熏着香'],
    bf: ['眉心一点花钿', '发髻高挽，插着金钗', '指甲涂着蔻丹', '耳坠长及肩', '腰间系着香囊'],
    b: ['面色娇弱，唇色也淡', '身形纤细，风吹得动', '手指凉', '眼波流转，看人时先垂眸', '走路要人扶'],
    c: ['说话柔，尾音拖得长', '答话前先看身边人', '说到宫里的规矩就停', '笑不露齿', '从不说「不」'],
  },
  courtesan: {
    a: ['一身藕荷色的衫子，发上只簪一根素银簪', '穿着件水红的袄，领口斜开', '裙上熏着香，走近了才闻得见', '发上戴着朵绢花，花色旧了', '肩上搭着条纱，纱上绣着蝶'],
    bf: ['眉画得细，眼角点着一颗痣', '指甲涂着蔻丹', '耳上坠着珠子', '发髻松松挽着', '腰身束得细'],
    b: ['坐在席间，笑是有的，眼睛却是静的', '手指细长，指节有点红', '笑起来先低头', '身形单薄', '眼皮微垂，看人从下往上看'],
    c: ['说话软，尾音上挑', '答话先笑一声', '说到客人就转开话头', '被问到家世就停', '笑得快，收得也快'],
  },
  madam: {
    a: ['一身绛紫的袄，头上插着根金钗', '手里捏着块帕子，帕上有香', '腰上系着串钥匙', '脸上敷着粉，粉有点厚', '袖口宽，手藏在里头'],
    bf: ['发髻梳得紧，一根乱发也没有', '耳坠是金的', '指上戴着两枚戒指', '眉画得又黑又直', '唇上点着红'],
    b: ['身形富态，笑起来满脸动', '眼角的粉盖不住皱纹', '手上有肉，指节有窝', '嗓门不小', '身板壮实'],
    c: ['见客先叫一声「爷」，叫得极顺口', '一边说话一边打量你的衣裳', '说到价钱就笑，说到赎身就沉脸', '答话快，不留缝', '笑时眼睛不笑'],
  },
  singer: {
    a: ['抱着把琵琶，弦是新换的', '手里捏着方绢帕', '袖口宽，甩起来像水', '发上插着一支银步摇', '腰间系着条响铃的带'],
    bf: ['眉心一点朱砂', '发上簪着珠花', '耳坠细长', '指甲修得圆', '唇色红'],
    b: ['身形纤瘦，站久了要换重心', '手指细长，指腹有拨弦的茧', '嗓子好，说话也带着调', '眼波活', '脖子细长'],
    c: ['说话带着点唱腔', '答话先笑', '说到曲子就来神', '被人夸就低头', '说两句就要哼一句'],
  },
  thief: {
    a: ['一身夜行短打，腰间没挂东西', '袖子做得特别宽', '脚上是软底靴', '手上戴着副薄手套', '衣袋缝得比别人的多'],
    b: ['手指细长灵活，动个不停', '眼珠转得快，看人先看腰', '身形瘦，缩得起来', '脚下没声', '耳朵后头有块小疤'],
    c: ['说话时眼睛不看你', '答话短，含糊', '说到钱就来神', '笑起来没声音', '站得离人很近，又不觉得近'],
  },
  hunter: {
    a: ['肩上背着张弓，弓弦上着蜡', '腰间挂着箭囊，箭羽是雕翎', '身上一件皮袄，皮子是自己鞣的', '脚上是鹿皮靴', '腰上别着把猎刀'],
    b: ['皮肤粗黑，脸上有冻疮的旧痕', '手掌有拉弓的茧', '身形精悍，动作快', '眼睛毒，看一眼就知道远近', '身上带着股兽皮味'],
    c: ['话少，说也是短句', '说到山里的路就来神', '答话时手在磨刀', '笑起来露出白牙', '看人时先看身后'],
  },
  nun: {
    a: ['一身灰布尼袍，头上戴着僧帽', '颈上挂一串念珠，珠子磨圆了', '手里拿着本经，经卷卷了边', '脚上是布鞋', '肩上搭着个居士送的包'],
    bf: ['发根剃得干净，帽沿压得低', '眉目清淡', '手指细白', '身形单薄', '袖口洗得发白'],
    b: ['面色平静，不出喜怒', '说话前先合掌', '手指常年捻珠，指尖有茧', '眉心一颗小痣', '身形端正'],
    c: ['说话慢，声音低', '答话多半是「阿弥陀佛」', '说到俗事就停', '被追问就笑一笑', '看人时眼帘半垂'],
  },
  actor: {
    a: ['脸上还带着没卸干净的油彩', '手里拎着个戏箱的提梁', '身上穿着戏服的外袍', '头上戴着假发，发髻歪着', '腰上系着条彩带'],
    b: ['身段好，站着也有架势', '嗓子亮，说话带韵', '手指细长，会做手势', '眼里有神', '走路带风'],
    c: ['说话带韵，尾音往上挑', '答话爱比手势', '说到戏班就来神', '笑起来拱手', '说话时眉眼都在动'],
  },
  boatman: {
    a: ['赤着脚站在船头，裤脚卷到腿根', '手里握着根竹篙，篙头包着铁', '头上戴着斗笠，斗笠上有个洞', '腰上系着条草绳', '肩上搭着件蓑衣'],
    b: ['臂上肌肉是一条条的', '皮肤被水泡得发白', '手掌全是篙磨出的茧', '身形矮壮，站得稳', '脸上被江风吹得红'],
    c: ['说话像喊，隔着水也在喊', '答话离不开水路的词', '说到天气就抬头', '笑起来骂一句才算亲热', '手不离篙'],
  },
  gambler: {
    a: ['袖子里不知藏着什么，手总在动', '腰上挂着个骰子的袋子', '手指上套着个铜扳指', '衣裳料子不错，却皱得厉害', '脚上的鞋沾着赌坊的瓜子壳'],
    b: ['眼睛熬得通红', '手指焦黄，是常年捏牌捏的', '身形干瘦，坐不住', '笑起来露出一口烟牙', '手抖，不赌的时候也抖'],
    c: ['见面先递一句「来不来一把」', '答话时眼睛盯着你的钱袋', '说到输赢就来神', '笑得快，恼得也快', '说话时手在袖里搓'],
  },
  waiter2: {
    a: ['肩上的白巾还算干净，是新来的', '端着个空托盘，站在角落', '围裙系得歪', '袖子挽了一半', '手里攥着块抹布'],
    b: ['动作慢，还没练出来', '眼神怯，怕叫错名字', '手指上有新烫的水泡', '身形单薄', '记性差，要回头问'],
    c: ['答话先应「哎」', '说话小声', '有人喊，一路小跑过去', '笑起来有点傻', '说到掌柜就缩脖子'],
  },
};

/* ================================================================
 * B2 —— 身份 → 允许区域白名单。不在白名单里的落点才重摆。
 * ================================================================ */
const SECT_REGIONS = ['shaolin', 'wudang', 'emei', 'huashan', 'gaibang', 'tangmen', 'dali', 'gumu', 'taohuadao', 'mojiao', 'miaojiang', 'jinguo', 'xiake', 'secret', 'xiyu', 'xixia', 'beijiang', 'many', 'wild'];

/* 只重摆规格书 §0-B2 点名的四种身份，其余身份一律不动
   （宫人落在少林大雄宝殿这类问题另案报给策划，不在此次改动范围内） */
const ALLOW = {
  courtesan: ['qinglou'],
  richman: ['market', 'jiangnan', 'harbor', 'cunzhen', 'chengdu', 'luoyang', 'changan', 'xiangyang', 'yamen', 'palace'],
  farmer: ['farmland', 'cunzhen'],
  escort: ['market', 'jiangnan', 'harbor', 'cunzhen', 'wild', 'chengdu', 'luoyang', 'changan', 'xiangyang'],
};
/** 官道 / 里弄 / 自家宅子对谁都合法 */
function regionAllowed(tag, region, roomId) {
  if (/^road_/.test(roomId || '') || region === 'wild') return true;
  if (/^fang_/.test(roomId || '') || /^hm_/.test(roomId || '')) return true;
  const list = ALLOW[tag];
  if (!list) return true;                     // 未建白名单的身份不重摆
  return list.indexOf(region) >= 0;
}

/** 各身份重摆的目标房间（按序轮转，同种子可复现） */
const REHOME = {
  courtesan: ['jn_brothel_hall', 'jn_brothel_room', 'jn_brothel_stage', 'jn_brothel_3', 'jn_brothel_gate'],
  richman: ['jn_market_west', 'jn_rich_house', 'jn_rich_hall', 'jn_market_north', 'jn_market_east', 'jn_harbor_shed', 'jn_market_south', 'jn_rich_garden', 'jn_market_main'],
  farmer: ['jn_farm_1', 'cunzhen_farm', 'jn_farm_2', 'jn_farm_3', 'cunzhen_street'],
  escort: ['jn_market_south', 'jiangnan_street', 'jiangnan_east_road', 'jn_harbor_wharf', 'jn_market_main', 'jn_harbor'],
};
/** 策划在样张里点名的落点，优先满足 */
const PINNED = {
  npcv_219: 'jn_brothel_hall',   // 样张 09：梅拾迁至醉春楼·花厅
  npcv_109: 'jn_market_west',    // 样张 12：庞听迁至东市·西巷
};

/* ================================================================
 * B3 / B4 —— tag 纠正 + 年龄纠正
 * ================================================================ */
/** B3：tag 误挂纠正（只改点名的） */
const TAG_FIX = {
  nv_huang: 'swordsman',   // 黄药师：桃花岛主 / 东邪，不是坐堂大夫
};

/** B4-1：具名 NPC 手写年龄覆盖（按身份与人设） */
const AGE_FIX = {
  shenni: 78,               // 神秘老僧（藏经阁）
  shaolin_fangzheng: 62,    // 方证大师（少林方丈）
  emei_miejue: 55,          // 灭绝师太（峨眉掌门）
  beggar_boy: 12,           // 小叫花
  blood_saber: 68,          // 血刀老祖
  wen_black: 55,            // 独眼老刘
  old_herbalist: 62,        // 采药翁
  master_yue: 52,           // 岳不群（华山掌门）
  gaibang_hong: 63,         // 洪七公
};

/** B4-2：按 tag 的合理年龄区间（超出才重刷，尽量少动） */
const AGE_RANGE = {
  child: [5, 14],
  monk: [20, 78], nun: [20, 78], taoist: [20, 78],
  courtesan: [16, 34], singer: [16, 34], consort: [16, 42],
  madam: [32, 62],
  scholar: [14, 62],
  eunuch: [24, 66],
  refugee: [8, 70], beggar: [10, 76],
};

/* ================================================================
 * 主流程
 * ================================================================ */
const raw = fs.readFileSync(NPC_FILE, 'utf8');
const data = JSON.parse(raw);
const npcs = data.npcs;
const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const rooms = map.rooms;

const portraits = JSON.parse(fs.readFileSync(PORTRAIT_FILE, 'utf8'));

const report = { desc: 0, moved: 0, tag: 0, age: 0, portraitNew: 0, portraitSkip: 0, portraitLock: 0, warnings: [] };

/* ---------- B3 tag ---------- */
for (const id of Object.keys(TAG_FIX)) {
  const d = npcs[id];
  if (!d) { report.warnings.push('tag 修正目标不存在：' + id); continue; }
  if (d.tag !== TAG_FIX[id]) { d.tag = TAG_FIX[id]; report.tag++; }
}

/* ---------- B4 age ---------- */
for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (AGE_FIX[id] !== undefined) {
    if (d.age !== AGE_FIX[id]) { d.age = AGE_FIX[id]; report.age++; }
    continue;
  }
  const r = AGE_RANGE[d.tag];
  if (!r || d.age === undefined || d.age === null) continue;
  if (d.age < r[0] || d.age > r[1]) { d.age = int(r[0], r[1]); report.age++; }
}

/* ---------- B2 落点 ---------- */
const cursor = {};
for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (!d.tag || !d.room) continue;
  const room = rooms[d.room];
  if (!room) { report.warnings.push(`房间不存在：${id} → ${d.room}`); continue; }
  if (PINNED[id]) {
    if (d.room !== PINNED[id]) { moveTo(d, PINNED[id]); report.moved++; }
    continue;
  }
  if (regionAllowed(d.tag, room.region, d.room)) continue;
  const pool = REHOME[d.tag];
  if (!pool) { report.warnings.push(`身份 ${d.tag} 落点越界但无重摆目标：${id} @ ${d.room}`); continue; }
  const c = cursor[d.tag] = (cursor[d.tag] === undefined ? 0 : cursor[d.tag] + 1);
  const target = pool[c % pool.length];
  if (!rooms[target]) { report.warnings.push(`重摆目标房间不存在：${target}`); continue; }
  moveTo(d, target);
  report.moved++;
}
function moveTo(d, target) {
  const old = d.room;
  d.room = target;
  if (d.schedule && d.schedule.day === old) d.schedule.day = target;
  if (d.schedule && d.schedule.night === old) d.schedule.night = d.home || target;
}

/* ---------- B1 desc ---------- */
const usedDesc = new Set();
const tagCount = {};
// 先按 tag 分组，保证同 tag 内先分配互不重复的组合
const byTag = {};
// 只重写「desc 与他人重复」的 NPC —— 具名 NPC 的手写 desc 一律不动。
// 这条判据天然幂等：重写之后不再有重复组，第二次跑就是 0 条。
const dupDescSet = new Set();
{
  const m = {};
  for (const id of Object.keys(npcs)) { const s = npcs[id].desc || ''; (m[s] = m[s] || []).push(id); }
  for (const [s, list] of Object.entries(m)) if (list.length > 1) dupDescSet.add(s);
}
for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (!d.tag || !DESC[d.tag]) continue;
  if (!dupDescSet.has(d.desc || '')) continue;
  (byTag[d.tag] = byTag[d.tag] || []).push(id);
}
for (const tag of Object.keys(byTag)) {
  const P = DESC[tag];
  const ids = byTag[tag].slice().sort();
  const usedCombo = new Set();
  for (const id of ids) {
    const d = npcs[id];
    const female = d.gender === 'female';
    let desc = null;
    for (let t = 0; t < 60 && !desc; t++) {
      const a = pick(P.a);
      const mid = female ? pick(P.bf || FEMALE_MARK) : pick(P.b);
      const c = pick(P.c);
      const key = a + '|' + mid + '|' + c;
      if (usedCombo.has(key)) continue;
      const s = `${a}，${mid}，${c}。`;
      if (usedDesc.has(s)) continue;
      usedCombo.add(key); usedDesc.add(s); desc = s;
    }
    if (!desc) {
      // 组合耗尽：加一条随身的额外描写，保证全局唯一
      const extra = pick(female ? FEMALE_MARK : P.b);
      desc = `${pick(P.a)}，${extra}，${pick(P.c)}，${pick(P.b)}。`;
      usedDesc.add(desc);
    }
    if (d.desc !== desc) { d.desc = desc; report.desc++; }
    tagCount[tag] = (tagCount[tag] || 0) + 1;
  }
}

/* ---------- 首批画像 ---------- */
for (const id of Object.keys(portraits)) {
  const d = npcs[id];
  if (!d) { report.warnings.push('画像目标 NPC 不存在：' + id); continue; }
  if (d.portrait && d.portrait.lock === true) { report.portraitLock++; continue; }
  if (d.portrait && d.portrait.v === 1) { report.portraitSkip++; continue; }
  d.portrait = JSON.parse(JSON.stringify(portraits[id]));
  report.portraitNew++;
}

/* ---------- 自检 ---------- */
const problems = [];
// 1. 房间引用存在
for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (d.room && !rooms[d.room]) problems.push(`NPC ${id} 的房间不存在：${d.room}`);
  if (d.home && !rooms[d.home]) problems.push(`NPC ${id} 的家不存在：${d.home}`);
  for (const k of ['day', 'night']) {
    const r = d.schedule && d.schedule[k];
    if (r && !rooms[r]) problems.push(`NPC ${id} 的 schedule.${k} 不存在：${r}`);
  }
  // 2. 女性不得出现男性化用词
  if (d.gender === 'female' && /汉子|他叔|爷们/.test(d.desc || '')) problems.push(`女 NPC ${id} 的 desc 含男性化用词`);
}
// 3. 出口连通性
let exitBad = 0, exitTotal = 0;
for (const rid of Object.keys(rooms)) {
  const r = rooms[rid];
  for (const dir of Object.keys(r.exits || {})) {
    const ex = r.exits[dir];
    const to = typeof ex === 'string' ? ex : ex.to;
    exitTotal++;
    if (to && !rooms[to]) { exitBad++; if (exitBad < 6) problems.push(`房间 ${rid} 的出口 ${dir} 指向不存在的房间 ${to}`); }
  }
}
// 4. desc 唯一性
const descMap = {};
for (const id of Object.keys(npcs)) { const s = npcs[id].desc || ''; (descMap[s] = descMap[s] || []).push(id); }
const dupGroups = Object.entries(descMap).filter(x => x[1].length > 1);
// 5. courtesan 是否都在青楼
const courtesanOut = Object.keys(npcs).filter(i => npcs[i].tag === 'courtesan' && (rooms[npcs[i].room] || {}).region !== 'qinglou');

/* ---------- 输出 ---------- */
console.log('=== gen-fix-npcs.js 报告 ===');
console.log(`  B1 desc 重写        ${report.desc} 条（覆盖 ${Object.keys(tagCount).length} 个身份）`);
console.log(`  B2 落点重摆          ${report.moved} 人`);
console.log(`  B3 tag 纠正          ${report.tag} 处`);
console.log(`  B4 年龄纠正          ${report.age} 处`);
console.log(`  画像写入             新增 ${report.portraitNew} / 跳过 ${report.portraitSkip} / 受保护 ${report.portraitLock}`);
console.log(`  出口自检              ${exitTotal} 条边，断边 ${exitBad}`);
console.log(`  desc 重复组           ${dupGroups.length} 组（${dupGroups.reduce((s, x) => s + x[1].length, 0)} 人）`);
console.log(`  不在青楼的 courtesan  ${courtesanOut.length} 人 ${courtesanOut.join(',')}`);
if (report.warnings.length) { console.log('  警告：'); for (const w of report.warnings) console.log('    · ' + w); }
if (problems.length) { console.log('  ✘ 自检未过：'); for (const p of problems.slice(0, 20)) console.log('    · ' + p); }
else console.log('  ✔ 自检全过（房间引用 / 出口连通 / 性别用词 / desc 唯一 / 青楼落点）');

if (DRY) { console.log('\n--dry：未落盘'); process.exit(problems.length ? 1 : 0); }

if (!fs.existsSync(BAK_FILE)) fs.writeFileSync(BAK_FILE, raw, 'utf8');
fs.writeFileSync(NPC_FILE, JSON.stringify(data, null, 2), 'utf8');
console.log('\n已落盘：game/data/40_npcs.json（备份 tools/_bak/40_npcs.pre-portrait.json）');
process.exit(problems.length ? 1 : 0);
