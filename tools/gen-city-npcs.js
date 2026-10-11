/* ============================================================
 * gen-city-npcs.js —— #67 城市补人（写入型）
 *
 * 主人 2026-10-11：
 *   「我发现有些城市区域（比如襄阳）几乎除了门派中人（也少）没有一个 npc，
 *     这很不合理（给这些区域多新增一些 npc（写画像，酌情考虑根据区域与画像
 *     做支线或触发式支线）增加活人感）」
 *
 * 实测：襄阳 12 房 0 人 / 洛阳 13 房 0 人 / 成都 12 房 0 人 / 长安 13 房 0 人，
 * 姑苏 7 房 4 人、江口码头 11 房 8 人 —— 四大名城的**城里一个活人都没有**。
 *
 * 做法：
 *   ① 六座城（四大名城 + 姑苏 + 江口码头）**每一个城市房间**都配人，
 *      按城的性格分配工种（襄阳兵家 / 洛阳旧都 / 成都富庶 / 长安官气 /
 *      姑苏水乡文人 / 码头漕运），不是一律「摊主 + 伙计」。
 *   ② 每人**画像 + 外貌 + 对白**都写。画像池统一从 lib-portrait-pools.js 取
 *      （与 gen-portraits-bc.js 同源，不会各说各话）。
 *   ③ **自带 portrait**：不依赖 gen-portraits-bc.js 的补员（那边 B 层已满 60，
 *      而且只认自己名下的条目）—— 本文件产出的 NPC 由本文件负责画像。
 *
 * 纪律：
 *   · 确定（不掷骰，只按 index / hash 取句），重跑结果一致。
 *   · 只写 game/data/99_city_npcs.json 这一个文件。
 *   · 幂等：整个文件按下面的表重建，改表即改人。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '99_city_npcs.json');

const { H, pick, pickSeq, fill, PERSONA_TONE, ARC, T, GENERIC, CT } = require('./lib-portrait-pools.js');

/* ---------- 区域名（画像里的 %{region}） ----------
 * ⚠️ 房间表**必须走引擎**：洛阳擂台在 80_culture_place、姑苏枫桥在 61_sidequests ——
 *    增量文件散落各处，只读 50_map.json 会在「房间不存在」断言处炸掉。 */
const MAP = require(path.join(ROOT, 'game', 'data', '50_map.json'));
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const _peek = new GameEngine({ seed: 1, mods: false });
_peek.boot();
const ROOMS = _peek.world.data.rooms;
const REGION_NAME = {
  xiangyang: '襄阳城', luoyang: '洛阳城', chengdu: '成都府',
  changan: '长安城', gusu: '姑苏', harbor: '江口码头', shuyuan: '白鹿书院',
};

/* ---------- 外貌（「细看此人」看到的） ---------- */
const DESC = {
  soldier: ['甲片上的锈擦不净，站得笔直，眼睛却总往城外的路上瞟。', '脸上有道旧疤，不笑，握枪的手背上青筋绷着。', '靴底沾着泥，腰间刀鞘磕掉了一块漆。'],
  officer: ['甲胄底下压着一件洗得发白的旧里衣，腰杆比谁都直。', '鬓角有了白，走起路来还是行伍里的步子。', '手里攥着一卷名册，边角卷得起了毛。'],
  porter: ['一副竹杠横在肩上，肩膀上的茧比布还厚。', '裤脚挽到膝盖，小腿上青筋盘着。', '一只手抠着箩筐的绳子，指节粗得不像话。'],
  storyteller: ['一把折扇，扇面磨得只剩骨头。', '醒木摩挲得发亮，说话前总要先清一清嗓子。', '灰布长衫洗得干净，袖口却起了毛边。'],
  gardener: ['指甲修得齐整，指缝里却嵌着洗不掉的泥。', '一身短打，怀里揣着把修枝的小剪。', '袖口别着几根新剪的枝条，舍不得扔。'],
  artisan: ['一双手比脸糙，虎口上全是老茧。', '腰上挂着一排小工具，走一步碰出一串轻响。', '衣裳上沾着漆点，怎么洗都留着一片印子。'],
  coroner: ['袖口用布条扎着，一双眼睛比谁都冷。', '腰上别着个小木匣，匣口的漆掉得差不多了。', '脸上一丝表情也无，说话前先看你一眼。'],
  postmaster: ['一身半旧的公服，袖里塞着一卷名册。', '手里提着盏风灯，灯罩上糊着几层的纸。', '靴子沾着官道的灰，走路却极快。'],
  taxman: ['腰间挂着一串短尺与秤砣，走一步响一声。', '手里那本税册压得发皱，边角都磨圆了。', '脸上堆着笑，眼睛却盯着人的手。'],
  warehouser: ['一身靛蓝褂子，腰间挂着一大串钥匙。', '鼻梁上架着老花镜，看人总要先眯一眯眼。', '手里一支笔别在耳后，笔尖儿还沾着墨。'],
  diver: ['头发用布条束在脑后，一身腱子肉泡得发白。', '脚上只踩着一双草鞋，脚趾抠着地。', '背上晒得脱了皮，肩头却比旁人宽。'],
  watchman: ['腰上别着梆子，手里一盏灯笼，灯罩上糊着油纸。', '背有点驼，耳朵却总竖着。', '灰布短袄上打着补丁，补丁的针脚倒是齐整。'],
  academic: ['袖口沾着一点墨，书卷气从衣裳里透出来。', '手里攥着半卷书，走两步看一眼。', '眼底青着，昨夜那盏灯又熬到了三更。'],
  innkeeper: ['围裙上的油点又多了几块，袖口卷到手肘。', '站在柜台后头，眼睛却把满屋子的人都数了一遍。', '手上拨着算盘，嘴里还应付着客人。'],
  waiter: ['抹布搭在肩上，脚下不停，端碗的手极稳。', '笑起来一脸褶子，嘴却极甜。', '腰上系着围裙，走得比谁都快。'],
  smith: ['赤着上身，胸口的汗混着炉灰，一道道。', '手上全是烫疤，拿钳子的手却极稳。', '围裙上烧出好几个洞，也没顾上补。'],
  groom: ['身上有点马厩的味道，自己浑然不觉。', '袖口沾着草屑，手上却极干净。', '蹲在那儿，半天不说话，只看着牲口。'],
  doctor: ['药香从他身上先到，人才到。', '袖里揣着一方脉枕，药箱的角磨得发亮。', '手指细细的，指甲剪得极短。'],
  artist: ['袖口上蹭着几痕颜色，自己不以为意。', '手指上有一小块墨，是捏笔捏出来的。', '眼神总往虚处看，像在琢磨什么。'],
  scholar: ['长衫洗得发白，衣领却浆得挺括。', '袖子里露出半卷书，书角卷得不像样。', '眼底一圈青，是熬出来的。'],
  actor: ['眼角画着一道，不知是忘了卸，还是新勾的。', '嗓子好，说话的尾音总往上提一提。', '袖口里头衬着一层软缎，外头却罩着粗布。'],
  merchant: ['一身好料子，鞋底却磨得薄了——跑得多。', '手里捏着一串铜钱，捻得哗哗响。', '眼珠子一转，先看你穿的是什么。'],
  official: ['公服的袖口磨得发亮，手指上有一处笔茧。', '案上那叠文书压得整整齐齐，人不离座。', '说话前先看你一眼，像在心里过了一遍章程。'],
  richman: ['衣裳料子极好，人却坐着不动，由人伺候。', '手上戴着一枚玉扳指，转来转去。', '说话慢，尾音拖得长，像什么都不必急。'],
  madam: ['一头珠翠，脸上的粉却打得匀，看不出年纪。', '手里摇着一柄团扇，扇上的字是新描的。', '坐在栏边，楼下的动静她一样不落。'],
  boatman: ['裤脚挽到膝上，脚趾抠着船板。', '一身水气，晒得比谁都黑。', '手里的橹把磨得发亮，是几十年的手印。'],
  constable: ['腰上挂着铁尺，走路带风，眼睛扫得很勤。', '一身皂衣，腋下夹着一根水火棍。', '脸上没什么表情，看人的时候多停半息。'],
  vendor: ['担子卸在脚边，一样样码得整齐。', '嗓子比谁都亮，叫卖的调子拖着尾。', '蹲在摊子后面，把货来回摆正。'],
  farmer: ['裤腿上还沾着泥，一看就是从地里来的。', '手掌摊开，纹路里嵌着洗不掉的黑。', '斗笠挂在背上，脖子晒得通红。'],
  hunter: ['肩上一张弓，腰间的皮囊里鼓鼓囊囊。', '一身牲皮短袄，走路不带一点声音。', '眼神不落在人身上，总往远处瞟。'],
  thief: ['袖子极宽，手却一直空着。', '一身灰布衣裳，混在人堆里转眼就找不着。', '走路不出声，看人只看包袱。'],
  monk: ['一领灰布僧衣，肩上挎着个旧布褡。', '手里一串念珠，捻得很慢。', '眉眼平和，看人时目光先落下去半分。'],
  nun: ['一身缁衣，袖口卷着，露出手腕上的一串木珠。', '手里拎着一只化缘的钵，钵沿豁了个口。', '说话轻，眼帘总垂着。'],
  taoist: ['一身青布道袍，袖里揣着一卷符纸。', '须发花白，下巴一撮胡子修得齐整。', '背着手站着，倒像在等谁。'],
  gambler: ['指头上有烟熏的黄，眼睛却亮。', '身上那件褂子是新做的，鞋却是旧的。', '手指头在袖子里动着，像在数什么。'],
  swordsman: ['兵器不离手，看人的时候先看对方的手。', '一身旧伤，走路右腿略慢半拍。', '衣裳上没有一处装饰，只有刀柄缠得极紧。'],
  '': ['衣裳半新不旧，脸上带着这个岁数该有的疲色。', '在自家门口站着，见人来了，先点了个头。', '手上做着活，眼睛却瞟着街上。'],
};

/* ---------- 对白 ---------- */
const TALK = {
  soldier: ['城门申时落闸，要进城趁早。', '路引带在身上么？'],
  officer: ['营里的事，少打听。', '走路看着点，这儿是校场边。'],
  porter: ['让一让，借光！', '这担子沉，别撞着。'],
  storyteller: ['这段书，我在这儿说了三年了。', '要听，就找个座儿坐下。'],
  gardener: ['花这东西，急不得。', '这几株费了两年工夫。'],
  artisan: ['活儿要做细，急不来。', '看一眼不打紧，别碰。'],
  coroner: ['衙门的事，问不得。', '这地方不干净，你走吧。'],
  postmaster: ['公文要走的，连夜也要走。', '驿马没歇，人马都换过了。'],
  taxman: ['照章程来，一两不能少。', '我也当差，您担待。'],
  warehouser: ['存货要单子，取货也要单子。', '你的货，还压在里头呢。'],
  diver: ['水底下的事，说了你也不信。', '没下水，别论价。'],
  watchman: ['天干物燥，小心火烛——', '夜里别乱走。'],
  academic: ['书要读进心里，不是摆在案上。', '别出声，这儿是书楼。'],
  innkeeper: ['住店还是打尖？', '后堂还有位子。'],
  waiter: ['来了您呐！', '有什么忌口？'],
  smith: ['等一下，这火还没打完。', '要好刀，得等。'],
  groom: ['这马认人，你别靠近。', '草料又涨价了。'],
  doctor: ['哪儿不舒服？', '方子我写好了，照抓。'],
  artist: ['这幅还没干，别碰。', '你要画像？坐正了。'],
  scholar: ['书里的话，未必作数。', '考完了再说吧。'],
  actor: ['听我唱一段？', '嗓子今儿不太开。'],
  merchant: ['这位，看点什么？', '货是好货，价钱好说。'],
  official: ['照着规矩来。', '文书压着，急不得。'],
  richman: ['坐。', '这事我记下了。'],
  madam: ['进来坐坐？', '我这儿的规矩，先说明了。'],
  boatman: ['坐稳了。', '这条水，我熟。'],
  constable: ['站住，哪儿来的？', '没事别在街上晃。'],
  vendor: ['看一眼，不买也看一眼。', '就剩这些了，便宜给你。'],
  farmer: ['地里的事，急不来。', '今年看天了。'],
  hunter: ['脚步轻些。', '山里的东西少了。'],
  thief: ['借过。', '您的东西，我可没碰。'],
  monk: ['阿弥陀佛。', '施主慢走。'],
  nun: ['施主慢走。', '坐下歇歇吧。'],
  taoist: ['贫道不知。', '命里有，躲不掉。'],
  gambler: ['来两把？', '手气，说来就来。'],
  swordsman: ['报个名号。', '手底下见。'],
  '': ['吃了没？', '有事您说话。'],
};

/* ============================================================
 * 人物表：[短id, 姓名, 性别, tag, title, 房间, 性格]
 * 姓名无一与全库现有 NPC 重名（生成时另有一道断言把关）。
 * ============================================================ */
const TOWNS = [
  /* ---------------- 襄阳 · 兵家要冲、南北通衢 ---------------- */
  { key: 'xiangyang', npcs: [
    ['xy_gate_1', '秦豹', 'male', 'soldier', '守城兵', 'xiangyang_gate', 'mune'],
    ['xy_gate_2', '周砚', 'male', 'soldier', '守城兵', 'xiangyang_gate', 'baozhao'],
    ['xy_gate_3', '吴老栓', 'male', 'watchman', '城门更夫', 'xiangyang_gate', 'qienuo'],
    ['xy_street_1', '花伯当', 'male', 'storyteller', '说书人', 'xiangyang_street', 'haoshuang'],
    ['xy_street_2', '郑大牛', 'male', 'porter', '脚夫', 'xiangyang_street', 'mune'],
    ['xy_street_3', '陶三娘', 'female', 'vendor', '摊主', 'xiangyang_street', 'youhua'],
    ['xy_market_1', '马洪', 'male', 'groom', '马夫', 'xiangyang_market', 'mune'],
    ['xy_market_2', '郎全', 'male', 'merchant', '马市牙人', 'xiangyang_market', 'youhua'],
    ['xy_tavern_1', '褚掌柜', 'male', 'innkeeper', '汉江楼掌柜', 'xiangyang_tavern', 'wenwan'],
    ['xy_tavern_2', '韦小六', 'male', 'waiter', '酒楼伙计', 'xiangyang_tavern', 'haoshuang'],
    ['xy_tavern_up_1', '雷震', 'male', 'escort', '镖行镖头', 'xiangyang_tavern_up', 'yinzhi'],
    ['xy_inn_1', '严掌柜', 'female', 'innkeeper', '将军客栈掌柜', 'xiangyang_inn', 'wenwan'],
    ['xy_lane_1', '韩铁山', 'male', 'smith', '铁匠', 'xiangyang_lane', 'baozhao'],
    ['xy_lane_2', '季老更', 'male', 'watchman', '更夫', 'xiangyang_lane', 'mune'],
    ['xy_brothel_1', '花妈妈', 'female', 'madam', '凤来仪掌事', 'xiangyang_brothel', 'youhua'],
    ['xy_jiangmen_1', '戚振', 'male', 'officer', '牙将', 'xiangyang_jiangmen_lane', 'yinzhi'],
    ['xy_jiangmen_2', '倪老爹', 'male', 'soldier', '老军', 'xiangyang_jiangmen_lane', 'mune'],
    ['xy_home_01', '周敬斋', 'male', 'richman', '襄阳富户', 'xy_home_01', 'yinzhi'],
    ['xy_home_02', '吴婶', 'female', '', '周宅邻舍', 'xy_home_02', 'wenwan'],
    ['xy_home_03', '冯济仁', 'male', 'doctor', '坐堂郎中', 'xy_home_03', 'lengmo'],
    ['xy_patrol_1', '屠捕快', 'male', 'constable', '巡街捕快', 'xiangyang_street', 'xiayi'],
    ['xy_patrol_2', '戚捕头', 'male', 'official', '襄阳府捕头', 'xiangyang_market', 'yinzhi'],
  ] },

  /* ---------------- 洛阳 · 旧都、牡丹花会 ---------------- */
  { key: 'luoyang', npcs: [
    ['ly_gate_1', '柏文远', 'male', 'watchman', '城门吏', 'luoyang_gate', 'mune'],
    ['ly_gate_2', '苏承', 'male', 'soldier', '守城兵', 'luoyang_gate', 'haoshuang'],
    ['ly_street_1', '贾花农', 'male', 'gardener', '花匠', 'luoyang_street', 'wenwan'],
    ['ly_street_2', '米芾', 'male', 'artist', '画师', 'luoyang_street', 'lengmo'],
    ['ly_street_3', '潘锦堂', 'male', 'merchant', '绸缎商人', 'luoyang_street', 'youhua'],
    ['ly_market_1', '章有德', 'male', 'merchant', '南市行商', 'luoyang_market', 'youhua'],
    ['ly_market_2', '葛小娥', 'female', 'vendor', '南市摊主', 'luoyang_market', 'baozhao'],
    ['ly_tavern_1', '彭掌柜', 'male', 'innkeeper', '天香楼掌柜', 'luoyang_tavern', 'wenwan'],
    ['ly_tavern_2', '唐婉娘', 'female', 'actor', '卖唱伶人', 'luoyang_tavern', 'wenwan'],
    ['ly_tavern_up_1', '邹老吏', 'male', 'official', '致仕老吏', 'luoyang_tavern_up', 'yinzhi'],
    ['ly_inn_1', '薛掌柜', 'male', 'innkeeper', '龙门客栈掌柜', 'luoyang_inn', 'mune'],
    ['ly_lane_1', '盛花姑', 'female', 'gardener', '花巷花匠', 'luoyang_lane', 'wenwan'],
    ['ly_brothel_1', '姚掌事', 'female', 'madam', '牡丹阁掌事', 'luoyang_brothel', 'youhua'],
    ['ly_mudan_1', '冯观澜', 'male', 'scholar', '书院学子', 'luoyang_mudan_lane', 'haoshuang'],
    ['ly_mudan_2', '孔继圣', 'male', 'scholar', '应举书生', 'luoyang_mudan_lane', 'yinzhi'],
    ['ly_home_01', '王万钟', 'male', 'richman', '洛阳富户', 'ly_home_01', 'yinzhi'],
    ['ly_home_02', '李守拙', 'male', '', '王家邻舍', 'ly_home_02', 'mune'],
    ['ly_home_03', '沈墨林', 'male', 'scholar', '致仕老儒', 'ly_home_03', 'wenwan'],
    ['ly_home_04', '韩素娘', 'female', '', '韩宅主母', 'ly_home_04', 'youhua'],
    ['ly_arena_1', '裘打擂', 'male', 'swordsman', '守擂武人', 'luoyang_arena', 'baozhao'],
    ['ly_patrol_1', '窦捕快', 'male', 'constable', '巡街捕快', 'luoyang_street', 'xiayi'],
    ['ly_patrol_2', '乔捕头', 'male', 'official', '洛阳府捕头', 'luoyang_market', 'yinzhi'],
  ] },

  /* ---------------- 成都 · 蜀中富庶、远离兵祸 ---------------- */
  { key: 'chengdu', npcs: [
    ['cd_gate_1', '任守义', 'male', 'soldier', '守城兵', 'chengdu_gate', 'mune'],
    ['cd_street_1', '贾茶客', 'male', 'merchant', '茶商', 'chengdu_street', 'wenwan'],
    ['cd_street_2', '谢漆匠', 'male', 'artisan', '漆器匠', 'chengdu_street', 'mune'],
    ['cd_market_1', '杨锦堂', 'male', 'merchant', '锦缎商', 'chengdu_market', 'youhua'],
    ['cd_market_2', '窦盐客', 'male', 'vendor', '盐贩', 'chengdu_market', 'haoshuang'],
    ['cd_tavern_1', '崔掌柜', 'female', 'innkeeper', '望江楼掌柜', 'chengdu_tavern', 'wenwan'],
    ['cd_tavern_2', '白凤鸣', 'male', 'actor', '川剧伶人', 'chengdu_tavern', 'haoshuang'],
    ['cd_tavern_up_1', '瞿药师', 'male', 'doctor', '药商', 'chengdu_tavern_up', 'lengmo'],
    ['cd_inn_1', '奚掌柜', 'male', 'innkeeper', '武侯客栈掌柜', 'chengdu_inn', 'mune'],
    ['cd_lane_1', '屈竹生', 'male', 'artisan', '竹器匠', 'chengdu_lane', 'mune'],
    ['cd_brothel_1', '樊妈妈', 'female', 'madam', '翠云楼掌事', 'chengdu_brothel', 'youhua'],
    ['cd_jinli_1', '葛禄', 'male', 'richman', '锦里富户', 'chengdu_jinli_lane', 'yinzhi'],
    ['cd_home_01', '杨守田', 'male', 'farmer', '杨宅当家人', 'cd_home_01', 'mune'],
    ['cd_home_02', '朱济世', 'male', 'doctor', '朱宅坐堂', 'cd_home_02', 'wenwan'],
    ['cd_home_03', '许巧姑', 'female', 'artisan', '许宅绣娘', 'cd_home_03', 'wenwan'],
    ['cd_patrol_1', '米捕快', 'male', 'constable', '巡街捕快', 'chengdu_street', 'xiayi'],
    ['cd_patrol_2', '霍捕头', 'male', 'official', '成都府捕头', 'chengdu_market', 'mune'],
  ] },

  /* ---------------- 长安 · 都城、官气最重 ---------------- */
  { key: 'changan', npcs: [
    ['ca_gate_1', '卫擎', 'male', 'soldier', '禁军', 'changan_gate', 'yinzhi'],
    ['ca_gate_2', '骆骁', 'male', 'soldier', '禁军', 'changan_gate', 'baozhao'],
    ['ca_street_1', '窦书办', 'male', 'official', '六部书吏', 'changan_street', 'yinzhi'],
    ['ca_street_2', '安胡商', 'male', 'merchant', '胡商', 'changan_street', 'haoshuang'],
    ['ca_market_1', '康宝珠', 'male', 'merchant', '珠宝商人', 'changan_market', 'youhua'],
    ['ca_market_2', '苏禄', 'male', 'merchant', '西市胡商', 'changan_market', 'youhua'],
    ['ca_tavern_1', '陆掌柜', 'male', 'innkeeper', '醉仙楼掌柜', 'changan_tavern', 'wenwan'],
    ['ca_tavern_2', '邢元度', 'male', 'scholar', '贡院考生', 'changan_tavern', 'yinzhi'],
    ['ca_tavern_up_1', '袁仵作', 'male', 'coroner', '大理寺仵作', 'changan_tavern_up', 'lengmo'],
    ['ca_inn_1', '常掌柜', 'female', 'innkeeper', '悦来客栈掌柜', 'changan_inn', 'wenwan'],
    ['ca_lane_1', '于慎行', 'male', 'scholar', '赴考举子', 'changan_lane', 'haoshuang'],
    ['ca_brothel_1', '柳掌事', 'female', 'madam', '平康坊掌事', 'changan_brothel', 'youhua'],
    ['ca_huanguan_1', '郑致仕', 'male', 'official', '致仕员外', 'changan_huanguan_lane', 'yinzhi'],
    ['ca_home_01', '郑云章', 'male', 'richman', '郑宅主人', 'ca_home_01', 'yinzhi'],
    ['ca_home_02', '陈敬之', 'male', 'scholar', '陈宅西席', 'ca_home_02', 'wenwan'],
    ['ca_home_03', '秦九娘', 'female', '', '秦宅主母', 'ca_home_03', 'baozhao'],
    ['ca_home_04', '卫老丈', 'male', '', '卫宅老人', 'ca_home_04', 'mune'],
    ['ca_patrol_1', '秦捕快', 'male', 'constable', '巡街捕快', 'changan_street', 'yinzhi'],
    ['ca_patrol_2', '卫捕头', 'male', 'official', '京兆府捕头', 'changan_market', 'yinzhi'],
  ] },

  /* ---------------- 姑苏 · 水乡、文人 ---------------- */
  { key: 'gusu', npcs: [
    ['gs_town_1', '柳渡娘', 'female', 'boatman', '船娘', 'gusu_town', 'wenwan'],
    ['gs_yanzi_1', '祝园管', 'male', 'artisan', '园林管事', 'gusu_yanzi', 'yinzhi'],
    ['gs_canhe_1', '蒋评弹', 'male', 'actor', '评弹艺人', 'gusu_canhe', 'haoshuang'],
    ['gs_zhai_1', '沈绣娘', 'female', 'artisan', '绣娘', 'gusu_zhai_lane', 'wenwan'],
    ['gs_home_01', '慕容管事', 'male', '', '别院管事', 'gs_home_01', 'yinzhi'],
    ['gs_home_02', '刘塾师', 'male', 'scholar', '刘家塾师', 'gs_home_02', 'wenwan'],
    ['gs_home_03', '赵船姑', 'female', 'boatman', '赵家船娘', 'gs_home_03', 'haoshuang'],
    ['gs_fengqiao_1', '阮桥婆', 'female', 'vendor', '枫桥摊主', 'gusu_fengqiao', 'baozhao'],
    ['gs_patrol_1', '陆巡检', 'male', 'official', '姑苏巡检', 'gusu_zhai_lane', 'yinzhi'],
  ] },

  /* ---------------- 江口码头 · 漕运 ---------------- */
  { key: 'harbor', npcs: [
    ['hb_1', '雷把头', 'male', 'boatman', '船帮把头', 'jn_harbor', 'baozhao'],
    ['hb_2', '石纤夫', 'male', 'porter', '纤夫', 'jn_harbor', 'mune'],
    ['hb_3', '窦栈长', 'male', 'warehouser', '货栈掌柜', 'jn_harbor_shed', 'youhua'],
    ['hb_4', '邱税吏', 'male', 'taxman', '码头税吏', 'jn_harbor_shed', 'yinzhi'],
    ['hb_5', '鲍掌柜', 'male', 'innkeeper', '船家客栈掌柜', 'jn_harbor_inn', 'wenwan'],
    ['hb_6', '屈水鬼', 'male', 'diver', '打捞人', 'jn_harbor_wharf', 'mune'],
    ['hb_7', '洪鱼婆', 'female', 'vendor', '鱼市摊主', 'jn_harbor_stall', 'baozhao'],
    ['hb_8', '裘小贩', 'male', 'vendor', '后街小贩', 'jn_harbor_backstreet', 'youhua'],
    ['hb_9', '毕老更', 'male', 'watchman', '码头更夫', 'jn_harbor_backstreet', 'mune'],
    ['hb_10', '褚船家', 'male', 'boatman', '褚宅船家', 'hb_home_01', 'haoshuang'],
    ['hb_11', '尤百工', 'male', 'artisan', '尤宅木匠', 'hb_home_02', 'mune'],
    ['hb_12', '陈寡妇', 'female', '', '陈宅寡妇', 'hb_home_03', 'wenwan'],
    ['hb_13', '黄季伯', 'male', '', '黄宅老人', 'hb_home_04', 'mune'],
    ['hb_14', '费老艄', 'male', 'boatman', '乌篷船艄公', 'jn_boat', 'mune'],
    ['hb_15', '彭捕快', 'male', 'constable', '码头捕快', 'jn_harbor', 'haoshuang'],
    ['hb_16', '岑税捕', 'male', 'official', '码头巡检', 'jn_harbor_shed', 'yinzhi'],
  ] },

  /* ---------------- 白鹿书院 · 江南城内的 town 型区域（tier=town，也得有人） ---------------- */
  { key: 'shuyuan', npcs: [
    ['sy_1', '孔昭文', 'male', 'academic', '书院夫子', 'jn_school', 'wenwan'],
    ['sy_2', '施静庵', 'male', 'academic', '藏书楼管书', 'jn_school_lib', 'mune'],
    ['sy_3', '崔子敬', 'male', 'academic', '书院山长', 'jn_school_hall', 'yinzhi'],
    ['sy_4', '康慕贤', 'male', 'academic', '东斋学子', 'jn_school_room1', 'haoshuang'],
    ['sy_5', '童苦读', 'male', 'academic', '西斋寒士', 'jn_school_room2', 'qienuo'],
    ['sy_6', '缪书童', 'male', 'academic', '书院书童', 'jn_school_yard', 'mune'],
    ['sy_7', '巩药圃', 'male', 'academic', '药圃管事', 'jn_school_herb', 'lengmo'],
    ['sy_8', '桑抄书', 'male', 'academic', '书轩抄书人', 'jn_study_2', 'mune'],
    ['sy_9', '葛师娘', 'female', '', '书斋帮佣', 'hm_npcv_102', 'wenwan'],
  ] },
];

/* ============================================================
 * 城市支线（#67）：每城 3 条 —— 该城的人的事，不出城。
 * 第三条带 `require`（前置 flag），即「触发式」：同一城第一条了了，才冒出来。
 * 支线一律两段：先到场子（go0），再作决定（go1 + menu）。
 * ⚠️ menu 的 `;;` 是选项分隔、`;` 是效果分隔，别动。
 * ============================================================ */
const QUESTS = [
  /* ---- 襄阳 ---- */
  { id: 'sq_cy_xy_ma', name: '马市那匹病马', npc: 'cy_xy_market_1', level: 8,
    desc: '马市的马洪守了两夜，那匹马还是不吃草料。这马是替一个不相识的人寄养的。',
    s1: { room: 'xiangyang_market', at: '槽边那匹马侧躺着，鼻孔一张一合。前蹄内侧肿了一块，肿得齐整，不像是磕的。', say: '「药也灌了，夜里还是叫。」马洪蹲在槽边，是两夜没合眼的样子。' },
    s2: { room: 'xiangyang_lane', at: '铁匠铺的炉子还热着。韩铁山听完，把手里的钳子搁下，去后头翻了翻，翻出一枚断了的铁蒺藜。', say: '「蹄子底下那处，不是病。是钉的。钉进去再拔出来，伤口就长成这样。」',
      menu: '那匹马|把这事原原本本告诉马洪>flag:sq_cy_xy_ma_done;+exp:260;+money:80;+karma:15;favor:cy_xy_market_1:30;incvar:favor_cy_xy_market_1:30;;算了，马贩子的事，别掺和>flag:sq_cy_xy_ma_done;+exp:120;+money:40;favor:cy_xy_market_1:-10;incvar:favor_cy_xy_market_1:-10' },
    reward: '马洪把那匹马牵到了墙根底下，扯了块旧布，把蹄子裹上。' },

  { id: 'sq_cy_xy_shu', name: '说书人的《岳家将》', npc: 'cy_xy_street_1', level: 12,
    desc: '北街茶棚的花伯当近来不乐意说《岳家将》。点这书的人一天比一天多，他却把醒木按在桌上，不响。',
    s1: { room: 'xiangyang_tavern', at: '汉江楼二楼坐着几个人，点的正是《岳家将》。跑堂的韦小六压着嗓子说，那几位是外乡口音，坐了三天了。', say: '「他们不是来听书的。」' },
    s2: { room: 'xiangyang_street', at: '茶棚里只坐着两三个闲人。花伯当把醒木在手心里摩了两下，到底没拍下去。', say: '「说了，是替人传话；不说，这棚子就开不下去。」',
      menu: '那部《岳家将》|替他说，把话当着众人摊开>flag:sq_cy_xy_shu_done;+exp:300;+karma:20;+rep:武林:10;favor:cy_xy_street_1:35;incvar:favor_cy_xy_street_1:35;;劝他换个段子，别惹是非>flag:sq_cy_xy_shu_done;+exp:140;+money:60;favor:cy_xy_street_1:-15;incvar:favor_cy_xy_street_1:-15' },
    reward: '那棚子第二天照旧开着，段子换了。' },

  { id: 'sq_cy_xy_lu', name: '铁巷那批私活', npc: 'cy_xy_lane_1', level: 18,
    require: { flag: 'sq_cy_xy_ma_done' },
    desc: '铁巷的韩铁山接了一批兵器的活，出的价不低。可那款式不像自用 —— 刀身比寻常的窄，刀柄却长。',
    s1: { room: 'xiangyang_lane', at: '炉子边上堆着十来把半成的刀，刀身比营里的窄半分，刀柄却长出一截。', say: '「这不是给官府做的。」韩铁山敲了敲刀背，声音发闷。' },
    s2: { room: 'xiangyang_jiangmen_lane', at: '将门巷的老军倪老爹看了一眼刀的样子，脸色沉了沉，把刀递了回来。', say: '「这条巷子，从前姓过一回寇。」',
      menu: '那批兵器|把事报给牙将戚振>flag:sq_cy_xy_lu_done;+exp:340;+rep:朝廷:20;+money:150;favor:cy_xy_lane_1:-20;incvar:favor_cy_xy_lane_1:-20;;把刀的样子记下，先不动声色>flag:sq_cy_xy_lu_done;+exp:220;favor:cy_xy_lane_1:30;incvar:favor_cy_xy_lane_1:30' },
    reward: '炉子照旧烧着，只是那批刀再没打过第二遍。' },

  /* ---- 洛阳 ---- */
  { id: 'sq_cy_ly_hua', name: '花巷那几株名品', npc: 'cy_ly_lane_1', level: 10,
    desc: '花巷的盛花姑养了三十年花。今年时气不对，主家几株名品的叶子先黄了，催得紧。',
    s1: { room: 'luoyang_lane', at: '花架上那几株的叶尖先焦了，土还是湿的。盛花姑蹲下去捏了一把土，搓开看了半天。', say: '「浇的水没错。是这土不对。」' },
    s2: { room: 'luoyang_street', at: '街上卖花土的那家，今年换了新货，堆在当街，人却不大招呼。', say: '「同一批土，别人家的花也黄，来问的却都只回来找我。」',
      menu: '那几株名品|回园里取自己的土，替她换上>flag:sq_cy_ly_hua_done;+exp:240;+money:60;+karma:15;favor:cy_ly_lane_1:35;incvar:favor_cy_ly_lane_1:35;;把卖土那家捅到衙门去>flag:sq_cy_ly_hua_done;+exp:260;+rep:朝廷:15;favor:cy_ly_lane_1:20;incvar:favor_cy_ly_lane_1:20' },
    reward: '那年牡丹照开。' },

  { id: 'sq_cy_ly_zhang', name: '牡丹阁那本账', npc: 'cy_ly_brothel_1', level: 16,
    desc: '牡丹阁的姚掌事手里有一本账。账上多出一个名字，写了两年，人却从没露过面。',
    s1: { room: 'luoyang_brothel', at: '那本账摊在案上。最后一页那名字旁边，压着一方没有盖下去的印。', say: '「每月初一有人来送钱，不进门，放下就走。」' },
    s2: { room: 'luoyang_tavern_up', at: '雅间里那位老吏听完，端着茶没喝，只把茶盏在手里转了半圈。', say: '「那印是旧衙门的，废了十年了。」',
      menu: '那本账|交给衙门，把来路查清>flag:sq_cy_ly_zhang_done;+exp:320;+rep:朝廷:25;+money:120;favor:cy_ly_brothel_1:-20;incvar:favor_cy_ly_brothel_1:-20;;替她把这一页撕了，往后每月初一照旧没人来>flag:sq_cy_ly_zhang_done;+exp:200;+money:200;+karma:-10;favor:cy_ly_brothel_1:35;incvar:favor_cy_ly_brothel_1:35' },
    reward: '账本合上，压在原来的地方。' },

  { id: 'sq_cy_ly_an', name: '雅间里的旧案', npc: 'cy_ly_tavern_up_1', level: 24,
    require: { flag: 'sq_cy_ly_zhang_done' },
    desc: '洛阳城天香楼的雅间里，那位致仕的老吏坐了半年。他要说的那桩旧案，牵着他自己。',
    s1: { room: 'luoyang_tavern_up', at: '老吏从袖里取出一张发黄的纸，边角磨得圆了，折痕处快要断开。', say: '「这案子结的时候，我还是个抄公文的。」' },
    s2: { room: 'luoyang_market', at: '南市那间老铺还开着。柜台后头那位掌柜，是当年案里唯一活下来的人。', say: '「他认得我的字。」老吏站在门口，没进去。',
      menu: '那桩旧案|替他递到府台案头，从头再理一遍>flag:sq_cy_ly_an_done;+exp:380;+rep:朝廷:35;+karma:20;favor:cy_ly_tavern_up_1:40;incvar:favor_cy_ly_tavern_up_1:40;;劝他把话咽回去，安度晚年>flag:sq_cy_ly_an_done;+exp:220;+money:180;favor:cy_ly_tavern_up_1:-25;incvar:favor_cy_ly_tavern_up_1:-25' },
    reward: '那张纸他重新折好，收回了袖里。' },

  /* ---- 成都 ---- */
  { id: 'sq_cy_cd_jin', name: '蜀锦市那批货', npc: 'cy_cd_market_1', level: 14,
    desc: '蜀锦市的杨锦堂压了一批货，行情一天比一天低。他说，这批货的来路有点绕。',
    s1: { room: 'chengdu_market', at: '仓里那批锦码得高，花色是好花色，只是每匹的角上都缺了一小块，缺得整齐。', say: '「缺角的地方，原本是有印记的。」' },
    s2: { room: 'chengdu_street', at: '街尾那间铺子的主人听见「缺角」两个字，手里的剪子停了一下。', say: '「这批锦，是官造。少一道角，就少一道账。」',
      menu: '那批蜀锦|让他原样送去衙门，落一笔功>flag:sq_cy_cd_jin_done;+exp:320;+rep:朝廷:25;+money:200;favor:cy_cd_market_1:20;incvar:favor_cy_cd_market_1:20;;劝他趁早出手，别砸在手里>flag:sq_cy_cd_jin_done;+exp:200;+money:80;+karma:-10;favor:cy_cd_market_1:30;incvar:favor_cy_cd_market_1:30' },
    reward: '那批锦出城那天，杨锦堂在门口站了很久。' },

  { id: 'sq_cy_cd_yao', name: '药商收进来的那一味', npc: 'cy_cd_tavern_up_1', level: 20,
    desc: '望江楼竹风轩的药商瞿药师，近来收进来几味药，成色不对，捏在手里看了半天。',
    s1: { room: 'chengdu_tavern_up', at: '药包摊在桌上，一股子陈味。瞿药师用指甲刮了刮，粉末发白，捻开来是碎的。', say: '「这不是川里的药。川里晒不出这个色。」' },
    s2: { room: 'chengdu_gate', at: '城门那批新到的药车还停着，押货的人坐在车辕上，不肯卸。', say: '「货单上写的是当归。」',
      menu: '那批药|当场拆一包，验给他看>flag:sq_cy_cd_yao_done;+exp:300;+rep:朝廷:15;+money:120;favor:cy_cd_tavern_up_1:35;incvar:favor_cy_cd_tavern_up_1:35;;记下押货人的样貌，回头再说>flag:sq_cy_cd_yao_done;+exp:220;+money:60;favor:cy_cd_tavern_up_1:20;incvar:favor_cy_cd_tavern_up_1:20' },
    reward: '那批药退了回去。' },

  { id: 'sq_cy_cd_zhu', name: '竹巷那批竹笼', npc: 'cy_cd_lane_1', level: 26,
    require: { flag: 'sq_cy_cd_jin_done' },
    desc: '竹巷的屈竹生做了半辈子竹器。有人订了一批竹笼，尺寸古怪，不像装鸟的。',
    s1: { room: 'chengdu_lane', at: '院里堆着一批半成的竹笼，编得极密，笼口却留着活扣，是能反手扣上的。', say: '「装鸟的笼子，不必留这个。」' },
    s2: { room: 'chengdu_jinli_lane', at: '巷子尽头那户人家的后门，比正门修得还结实，门上没挂匾。', say: '「订笼子的人，住这儿。」',
      menu: '那批竹笼|把订户的样子说给守城兵听>flag:sq_cy_cd_zhu_done;+exp:320;+rep:朝廷:20;+money:140;favor:cy_cd_lane_1:-15;incvar:favor_cy_cd_lane_1:-15;;让他照做，只当没看见>flag:sq_cy_cd_zhu_done;+exp:200;+money:220;+karma:-10;favor:cy_cd_lane_1:30;incvar:favor_cy_cd_lane_1:30' },
    reward: '那批竹笼后来再没做完。' },

  /* ---- 长安 ---- */
  { id: 'sq_cy_ca_hu', name: '西市口那批胡货', npc: 'cy_ca_market_2', level: 22,
    desc: '西市的胡商苏禄有一批货被扣在西市口，说是货单对不上。他一口汉话说得比谁都溜。',
    s1: { room: 'changan_market', at: '西市口那几辆车停着旁侧。货单递过来，一页上的字是两种笔迹，前一半潦草，后一半端方。', say: '「前一半是我写的。后一半，谁知道是谁添的。」' },
    s2: { room: 'changan_street', at: '六部书吏窦书办接过货单，只扫了一眼，就把纸角压在了镇纸底下。', say: '「这后一半的字，是官里的体。写得比我还正。」',
      menu: '那批货|替他作保，把货领出来>flag:sq_cy_ca_hu_done;+exp:280;+money:150;+karma:10;favor:cy_ca_market_2:35;incvar:favor_cy_ca_market_2:35;;按规矩来，让他等着>flag:sq_cy_ca_hu_done;+exp:220;+rep:朝廷:20;favor:cy_ca_market_2:-20;incvar:favor_cy_ca_market_2:-20' },
    reward: '那几辆车后来还是走了，货单换了一张新的。' },

  { id: 'sq_cy_ca_yan', name: '仵作那张验单', npc: 'cy_ca_tavern_up_1', level: 30,
    desc: '大理寺的仵作袁仵作，近来手上的验单越写越慢。上头要他把一桩命案写成「病故」。',
    s1: { room: 'changan_tavern_up', at: '验单摊在桌上，「伤处」那一栏空着。袁仵作用指节敲了敲那张纸，敲了三下。', say: '「伤在这儿。写不写，是两回事。」' },
    s2: { room: 'changan_lane', at: '平康坊那位赴考的举子，手里也有一份同一桩案子的抄件，边角写满了小字。', say: '「这案子我抄过。尸首抬出去那天，坊门开得比平常早。」',
      menu: '那张验单|照着伤处写，一个字不瞒>flag:sq_cy_ca_yan_done;+exp:400;+rep:朝廷:30;+karma:25;favor:cy_ca_tavern_up_1:40;incvar:favor_cy_ca_tavern_up_1:40;;按上头的意思写，把这案子揭过去>flag:sq_cy_ca_yan_done;+exp:220;+money:260;+karma:-20;favor:cy_ca_tavern_up_1:-25;incvar:favor_cy_ca_tavern_up_1:-25' },
    reward: '验单递上去了。' },

  { id: 'sq_cy_ca_ju', name: '平康坊的举子', npc: 'cy_ca_lane_1', level: 34,
    require: { flag: 'sq_cy_ca_yan_done' },
    desc: '平康坊的举子于慎行，为着那桩案子，把备考的日子都耽搁了。他说，这案子和他爹有关。',
    s1: { room: 'changan_lane', at: '案头摊着的是一叠抄件，密密麻麻写着小字，墨色一层压一层。时文反倒压在底下，一动没动。', say: '「我爹当年也递过一份验单。递到一半，撤回来了。」' },
    s2: { room: 'changan_tavern', at: '醉仙楼二楼，考生邢元度把酒盏推过来，没说话，只看着他。', say: '「这一科，你考不考？」',
      menu: '你的功课|劝他先考完，案子的事我替他盯着>flag:sq_cy_ca_ju_done;+exp:340;+rep:朝廷:15;+money:120;favor:cy_ca_lane_1:40;incvar:favor_cy_ca_lane_1:40;;帮他把抄件递上去，考不考另说>flag:sq_cy_ca_ju_done;+exp:360;+karma:20;favor:cy_ca_lane_1:30;incvar:favor_cy_ca_lane_1:30' },
    reward: '他那年还是进了考场。' },

  /* ---- 姑苏 ---- */
  { id: 'sq_cy_gs_du', name: '夜里的那几趟渡', npc: 'cy_gs_town_1', level: 12,
    desc: '姑苏城外的柳渡娘摆渡十年。近来夜里总有人要过河，却不肯上灯。',
    s1: { room: 'gusu_town', at: '渡口的船夜里没系好，缆绳是重新接过的一道，接得很急。', say: '「我摆我的渡，不问是谁。可这几趟，他们连脸都不露。」' },
    s2: { room: 'gusu_yanzi', at: '燕子坞的管事祝园管听完，把手里那把剪子收进袖里，剪口上还挂着一小截枝。', say: '「夜里过河的，是去做生意。做的什么生意，你猜猜看。」',
      menu: '夜里那几趟渡|替她盯着，看看是什么人>flag:sq_cy_gs_du_done;+exp:300;+rep:朝廷:15;+money:140;favor:cy_gs_town_1:35;incvar:favor_cy_gs_town_1:35;;叫她往后夜里不接这档子活>flag:sq_cy_gs_du_done;+exp:200;+money:60;favor:cy_gs_town_1:25;incvar:favor_cy_gs_town_1:25' },
    reward: '渡口的灯，往后夜里也点着了。' },

  { id: 'sq_cy_gs_xiu', name: '绣娘绷子上那半幅', npc: 'cy_gs_zhai_1', level: 18,
    desc: '世家巷的沈绣娘接了一幅大活，绣的是半张图。主家给的纹样，她越绣越觉得不对。',
    s1: { room: 'gusu_zhai_lane', at: '绷子上那半幅绣品，针脚细密得能数得清，绣出来的却是一段水道与两处标记。', say: '「绣了二十年，头一回绣这个。这不是花，也不是鸟。」' },
    s2: { room: 'gusu_canhe', at: '参合庄里唱评弹的蒋评弹瞥了一眼绷子，曲子停了半拍，才接下去。', say: '「这一带的水道，我唱过。哪一段有暗礁，词里都写着。」',
      menu: '那半幅绣品|把纹样的来处问清楚>flag:sq_cy_gs_xiu_done;+exp:300;+rep:朝廷:20;+money:120;favor:cy_gs_zhai_1:30;incvar:favor_cy_gs_zhai_1:30;;让她绣完，只当不知道>flag:sq_cy_gs_xiu_done;+exp:200;+money:200;+karma:-10;favor:cy_gs_zhai_1:20;incvar:favor_cy_gs_zhai_1:20' },
    reward: '那幅绣品最后还是交了。' },

  { id: 'sq_cy_gs_qu', name: '那支只在姑苏唱的曲子', npc: 'cy_gs_canhe_1', level: 26,
    require: { flag: 'sq_cy_gs_xiu_done' },
    desc: '参合庄的蒋评弹有一支曲子，唱了半辈子，只在姑苏唱。近来有人出高价，要他把词写下来。',
    s1: { room: 'gusu_canhe', at: '蒋评弹拨了两下弦，那支曲子的调子起了个头，又生生收住。', say: '「这支曲子，是替人传的信。信传到了，曲子就该歇着。」' },
    s2: { room: 'gusu_town', at: '渡口那头的茶馆里，那几位客人等得不耐烦了，茶换了三回。', say: '「一个唱曲的，架子倒比官还大。」',
      menu: '那支曲子|让他把词留着，一个字也别写>flag:sq_cy_gs_qu_done;+exp:340;+karma:20;+rep:武林:15;favor:cy_gs_canhe_1:40;incvar:favor_cy_gs_canhe_1:40;;劝他写下来，换一笔安身钱>flag:sq_cy_gs_qu_done;+exp:220;+money:300;+karma:-15;favor:cy_gs_canhe_1:-20;incvar:favor_cy_gs_canhe_1:-20' },
    reward: '那支曲子往后照旧在庄里唱。' },

  /* ---- 江口码头 ---- */
  { id: 'sq_cy_hb_ren', name: '把头手底下那几十号人', npc: 'cy_hb_1', level: 10,
    desc: '江口码头的雷把头手底下几十号纤夫。近来有几趟货的工钱，压着一直没发。',
    s1: { room: 'jn_harbor', at: '纤夫们蹲在岸边，绳子搭在肩上，谁也没起身。绳子上晒出一层白霜似的盐。', say: '「货主说钱在栈里，栈里说没见着钱。两句话，夹着我们这几十口人。」' },
    s2: { room: 'jn_harbor_shed', at: '货栈的窦栈长把账摊开，指着一行空着的地方，指头停在那儿不动。', say: '「银子到过这儿，又走了。走的时候，单子上是有人签了字的。」',
      menu: '那笔工钱|替他们把银子追到底>flag:sq_cy_hb_ren_done;+exp:340;+rep:丐帮:20;+karma:20;+money:60;favor:cy_hb_1:40;incvar:favor_cy_hb_1:40;;劝他把这趟活认了，先开工>flag:sq_cy_hb_ren_done;+exp:200;+money:180;favor:cy_hb_1:-15;incvar:favor_cy_hb_1:-15' },
    reward: '第二天码头照常开工。' },

  { id: 'sq_cy_hb_huo', name: '栈里那批没人取的货', npc: 'cy_hb_3', level: 20,
    desc: '货栈的窦栈长仓里有一批货，存了半年没人来取。货单上的名字，查无此人。',
    s1: { room: 'jn_harbor_shed', at: '仓角那批货码在最里头，麻布裹得严实，上头落了厚厚一层灰，只有一角被人抹过。', say: '「半年了，连问都没人来问一声。」' },
    s2: { room: 'jn_harbor_wharf', at: '栈桥那头，打捞人屈水鬼把手里的水草绳收了收，绳结打了一半停住。', say: '「半年前沉过一条船。船主没找过官府，也没找过我。」',
      menu: '仓里那批货|报官，让衙门来开仓>flag:sq_cy_hb_huo_done;+exp:320;+rep:朝廷:25;+money:150;favor:cy_hb_3:-20;incvar:favor_cy_hb_3:-20;;原样留着，等他来取>flag:sq_cy_hb_huo_done;+exp:220;+money:100;favor:cy_hb_3:30;incvar:favor_cy_hb_3:30' },
    reward: '那批货原样码着。' },

  { id: 'sq_cy_hb_chuan', name: '水底那口箱子', npc: 'cy_hb_6', level: 30,
    require: { flag: 'sq_cy_hb_huo_done' },
    desc: '打捞人屈水鬼近来迟迟不下水。他说，水底那条船里，有件他不敢碰的东西。',
    s1: { room: 'jn_harbor_wharf', at: '屈水鬼把水草绳一圈圈盘好，又解开，盘了三回。岸边那身皮肉晒得发白。', say: '「舱里有一口箱子。锁是新的，链子也是新的。」' },
    s2: { room: 'jn_harbor_backstreet', at: '后街那间小铺的掌柜裘小贩，一听「沉船」两个字，脸就先白了，手里的秤砣压不住。', say: '「那船上的东西，原本是寄在我这儿的。寄的人，也没再回来。」',
      menu: '水底那口箱子|陪他下去，把箱子捞上来>flag:sq_cy_hb_chuan_done;+exp:400;+money:260;+karma:15;favor:cy_hb_6:40;incvar:favor_cy_hb_6:40;;让他别下水，这事到此为止>flag:sq_cy_hb_chuan_done;+exp:240;+rep:朝廷:10;favor:cy_hb_6:20;incvar:favor_cy_hb_6:20' },
    reward: '渡口的江水照旧浑着。' },
];

/* ---------- 巡街官差的夜间点位（design/67 §3「按路线走动」） ----------
 * 现有 schedule 只有 day / night 两档，捕快就按两档排：白天守在本街，
 * 入夜换到城门 / 桥头这些「夜里更该有人」的地方。真·逐时辰换防要动引擎的
 * 调度器，等 §3 做深时再说；两档已经能让同一个人昼夜出现在两处。 */
const NIGHT_POST = {
  xiangyang: 'xiangyang_gate', luoyang: 'luoyang_gate', chengdu: 'chengdu_gate',
  changan: 'changan_gate', gusu: 'gusu_town', harbor: 'jn_harbor_wharf',
};

/* ---------- 取句序号：同一个 tag 组内轮转，保证相邻两人不重样 ---------- */
const groupSeq = {};function nextSeq(tag, key) {
  const g = tag + '|' + key;
  const n = groupSeq[g] || 0;
  groupSeq[g] = n + 1;
  return n;
}

/* ---------- 画像：与 gen-portraits-bc.js 同源（池子共用），只是这里自带 ---------- */
function portrait(n, seq) {
  const tag = n.tag || '';
  const base = (n.tag ? (CT[n.tag] || T[n.tag]) : null) || GENERIC;
  const region = REGION_NAME[n._region] || '城里';
  const ta = n.gender === 'female' ? '她' : '他';
  const ctx = { name: n.name, region, place: region, town: true, title: n.title || '住户', sect: region, ta };
  const id = n.id;
  const arc = ARC[n.personality] || ARC.lengmo;
  const p = {
    v: 1, tier: 'B', lock: false,
    role: fill(pickSeq(base.role, seq + 0), ctx),
    origin: fill(pickSeq(base.origin, seq + 1), ctx),
    now: fill(pickSeq(base.now, seq + 2), ctx),
    want: fill(pickSeq(base.want, seq + 3), ctx),
    fear: fill(pickSeq(base.fear, seq + 4), ctx),
    voice: {
      tone: pick(PERSONA_TONE[n.personality] || PERSONA_TONE.mune, id + 'to'),
      catchphrase: fill(pickSeq(base.voice, seq + 5).catchphrase, ctx),
    },
    routine: [{ at: pickSeq(base.routine, seq + 6).at, act: fill(pickSeq(base.routine, seq + 6).act, ctx) }],
    arc: { init: fill(arc.init, ctx), warm: fill(arc.warm, ctx) },
    marks: (base.marks || []).slice(0, 2),
  };
  if (!n.tag) p.role = fill(pick(base.roleNoTitle, id + 'r'), ctx);
  return p;
}

/* ---------- 组装 ---------- */
const npcs = {};
const seenName = new Set();
const seenId = new Set();
let total = 0;

for (const town of TOWNS) {
  const region = REGION_NAME[town.key] || town.key;
  for (const [shortId, name, gender, tag, title, room, personality] of town.npcs) {
    const id = 'cy_' + shortId;
    if (seenId.has(id)) throw new Error('id 重复：' + id);
    seenId.add(id);
    if (seenName.has(name)) throw new Error('同名：' + name);
    seenName.add(name);
    if (!ROOMS[room]) throw new Error('房间不存在：' + room + '（NPC ' + id + '）');
    const seq = nextSeq(tag || '_', town.key);

    const n = {
      id, name, gender, tag: tag || undefined, title,
      room, home: 'house:' + id,
      personality,
      desc: pick(DESC[tag] || DESC[''], id + 'd'),
      talk: (() => { const pool = TALK[tag] || TALK['']; const a = pickSeq(pool, seq); const b = pickSeq(pool, seq + 1); return a === b ? [a] : [a, b]; })(),
      age: 24 + (H(id + 'age') % 38),
      likes: [pick(['wine', 'tea', 'music', 'book', 'jade', 'flower', 'silver', 'incense', 'sword', 'food'], id + 'lk')],
      level: 6 + (H(id + 'lv') % 12),
      hp: 90 + (H(id + 'hp') % 120),
      atk: 14 + (H(id + 'at') % 22),
      def: 8 + (H(id + 'df') % 16),
      dodge: 6 + (H(id + 'dg') % 14),
      speed: 10 + (H(id + 'sp') % 12),
      money: 30 + (H(id + 'mo') % 260),
      hostile: false,
      favorBase: 1,
      favorInit: 4 + (H(id + 'fi') % 8),
      carry: { money: 10 + (H(id + 'cm') % 60), items: [] },
      /* 巡街官差：白天守本街，入夜换到城门 / 桥头 */
      schedule: (() => {
        const isWatch = (tag === 'constable' || tag === 'official');
        const night = isWatch ? (NIGHT_POST[town.key] || room) : room;
        return { day: room, night: night };
      })(),
      tier: 'B',
      district: town.key,
      homeless: true,
      _region: town.key,
    };
    n.portrait = portrait(n, seq);
    delete n._region;
    npcs[id] = n;
    total++;
  }
}

/* ---------- 支线：把上面那张表转成正式结构，并挂到发布人身上 ---------- */
const quests = {};
for (const q of QUESTS) {
  const npc = npcs[q.npc];
  if (!npc) throw new Error('支线 ' + q.id + ' 的 npc 不存在：' + q.npc);
  const stages = [];
  [q.s1, q.s2].forEach((s, i) => {
    const roomName = (ROOMS[s.room] || {}).name || s.room;
    const eff = [];
    if (s.at) eff.push({ type: 'narrate', raw: s.at });
    if (s.say) eff.push({ type: 'say', raw: s.say });
    if (s.menu) eff.push({ type: 'menu', raw: s.menu });
    stages.push({
      desc: '去' + roomName,
      targets: [{ id: 'go' + i, kind: 'room', key: s.room, count: 1, var: q.id + '_go' + i, desc: '去' + roomName }],
      next: i === 0 ? 1 : 99,
      effects: eff,
    });
  });
  const qd = {
    id: q.id, name: q.name, type: '支线',
    npc: q.npc, giver: q.npc, level: q.level || 1,
    desc: q.desc, stages,
    rewards: [{ type: 'say', raw: q.reward }],
  };
  if (q.require) qd.require = q.require;
  quests[q.id] = qd;
  /* 挂到发布人（def.quests 数组；越靠前的越先被「可接」逻辑看到） */
  if (!Array.isArray(npc.quests)) npc.quests = [];
  npc.quests.push(q.id);
}

const out = {
  _note: '城市补人（#67）。生成器：tools/gen-city-npcs.js（确定性，重跑一致）。'
    + '⚠️ 本文件完全由生成器拥有，整表重建；画像池与 gen-portraits-bc.js 共用 lib-portrait-pools.js。',
  npcs,
  quests,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('写入', total, '人 /', Object.keys(quests).length, '条城市支线 →', OUT);
