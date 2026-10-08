/* ============================================================
 * gen-map.js — 地图扩张
 *
 * 目标：从 95 → 约 240 个房间，补齐主人要的场所：
 *   市集 / 衙门 / 监狱 / 农田 / 书院 / 青楼 / 铁匠铺 / 药店
 *   富户宅院 / 客栈 / 酒楼 / 寺庙 / 码头 / 皇宫 / 官道 / 村镇
 *   以及大量「某某某的家」（民居）
 *
 * 设计：
 *   - 新房间挂到已有房间的 exits 上，保证连通（不出现孤岛）
 *   - 每个新房间带 region / desc / 可选 actions / respawn
 *   - 幂等：房间 id 已存在就跳过
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MAP_FILE = path.join(ROOT, 'game', 'data', '50_map.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(88888888);
const pick = a => a[Math.floor(rng() * a.length)];

const doc = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
const rooms = doc.rooms;

/* ---------- 新区域 ---------- */
const NEW_REGIONS = {
  yamen: { name: '衙门府", '.replace('", ', ''), color: '#8a6a2a' },
};
/* 上面那行写错了，重新定义 */
doc.regions = doc.regions || {};
function defRegion(id, name, color) {
  if (!doc.regions[id]) doc.regions[id] = { id, name, color };
}
defRegion('yamen', '衙门府', '#8a6a2a');
defRegion('cunzhen', '青溪村', '#4a8a5a');
defRegion('shuyuan', '白鹿书院', '#5a6a9a');
defRegion('qinglou', '醉春楼', '#9a4a7a');
defRegion('palace', '皇城', '#9a2a2a');
defRegion('market', '东市', '#a07a3a');
defRegion('farmland', '田野', '#5a9a4a');
defRegion('harbor', '江口码头', '#3a7a9a');

/* ---------- 房间添加工具 ---------- */
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };

const added = [];
function addRoom(id, data) {
  if (rooms[id]) return false;
  rooms[id] = Object.assign({ id }, data);
  added.push(id);
  return true;
}
/** 双向连边 {room, dir, back}
 *  若目标方向已被占用，自动选一个空闲方向（保证连通性优先）。 */
function link(a, dir, b, back) {
  if (!rooms[a] || !rooms[b]) return;
  rooms[a].exits = rooms[a].exits || {};
  rooms[b].exits = rooms[b].exits || {};
  let useDir = dir;
  if (rooms[a].exits[useDir]) {
    const used = new Set(Object.keys(rooms[a].exits));
    useDir = DIRS.find(d => !used.has(d)) || dir;
  }
  let useBack = back || (BACK[useDir] || null);
  if (useBack && rooms[b].exits[useBack]) {
    const usedB = new Set(Object.keys(rooms[b].exits));
    useBack = DIRS.find(d => !usedB.has(d)) || useBack;
  }
  if (!rooms[a].exits[useDir]) rooms[a].exits[useDir] = b;
  if (useBack && !rooms[b].exits[useBack]) rooms[b].exits[useBack] = a;
}

/* ============================================================
 * 一、江南城扩张（核心城区）
 * 现有：jiangnan_gate / jiangnan_street / jiangnan_market /
 *       jiangnan_inn / jiangnan_smithy / jiangnan_qiao /
 *       jiangnan_east_road / jiangnan_west_road / jiangnan_hill
 * ============================================================ */

/* --- 东市：一条繁华商街 + 两侧铺子 --- */
addRoom('jn_market_main', {
  name: '东市·大街', region: 'market',
  desc: '东市的大街宽敞得能并行四辆马车，两旁幌子密得像林。卖绸缎的、卖果子的、算命的、耍猴的，一路排开。人声鼎沸，你得提高嗓门才说得上话。',
  exits: {},
});
addRoom('jn_silk_shop', {
  name: '东市·绸缎庄', region: 'market',
  desc: '架上堆着各色绸缎，红的是嫁衣料子，青的是读书人的体面。掌柜的见你进来，立刻抖开一卷给你看。',
  actions: [{ label: '绸缎', cmd: 'list 绸缎庄', keywords: ['绸缎', '布'], desc: '看看有什么上等料子' }],
});
addRoom('jn_fruit_stall', {
  name: '东市·果子摊', region: 'market',
  desc: '一车水灵灵的时令果子，桃子、李子、枇杷码得整齐。摊主是个爽利妇人，隔老远就招呼你。',
  actions: [{ label: '果子摊', cmd: 'list 果子摊', keywords: ['果子', '摊'], desc: '买两斤时鲜果子' }],
});
addRoom('jn_fortune', {
  name: '东市·算命摊', region: 'market',
  desc: '一面旧布幡上写着「铁口直断」，摊后坐着个眯眼的老者，桌上摆着龟甲与铜钱。',
  actions: [{ label: '算命摊', cmd: 'ask 算命先生 about 算命', keywords: ['算命', '先生'], desc: '让老者替你卜一卦' }],
});
addRoom('jn_pawnshop', {
  name: '东市·当铺', region: 'market',
  desc: '高高的柜台后头是个戴眼镜的二掌柜，墙上写着一个大大的「當」字。这里什么都收，也什么都卖。',
  actions: [
    { label: '当铺', cmd: 'list 当铺', keywords: ['当铺'], desc: '看看有什么好东西' },
    { label: '典当', cmd: 'sell', keywords: ['典当', '当'], desc: '把手里的东西当了换钱' },
  ],
});
addRoom('jn_teahouse', {
  name: '东市·老茶馆', region: 'market',
  desc: '茶馆里坐满了人，说书的正在讲《三国》，醒木一响，满堂叫好。喝茶的、嗑瓜子的、打听消息的，都在这儿。',
  actions: [
    { label: '茶馆', cmd: 'list 茶博士', keywords: ['茶', '博士'], desc: '来一碗茶歇脚' },
    { label: '说书', cmd: 'listen 说书', keywords: ['说书'], desc: '听听江湖上的新鲜事' },
  ],
});
addRoom('jn_toy_stall', {
  name: '东市·玩物摊', region: 'market',
  desc: '拨浪鼓、泥人、竹蜻蜓、糖人，摆了一案子。几个总角小孩挤在摊前看得挪不动脚。',
  actions: [{ label: '玩物摊', cmd: 'list 玩物摊', keywords: ['玩物', '泥人'], desc: '挑个玩物送人' }],
});

link('jiangnan_market', 'e', 'jn_market_main', 'w');
link('jn_market_main', 'n', 'jn_silk_shop', 's');
link('jn_market_main', 's', 'jn_fruit_stall', 'n');
link('jn_market_main', 'e', 'jn_fortune', 'w');
link('jn_market_main', 'w', 'jn_pawnshop', 'e');
link('jn_market_main', 'ne', 'jn_teahouse', 'sw');
link('jn_teahouse', 'se', 'jn_toy_stall', 'nw');

/* --- 酒楼市集：吃喝去处 --- */
addRoom('jn_wine_house', {
  name: '东市·醉仙楼', region: 'market',
  desc: '三层酒楼，飞檐上挂着红灯笼。楼下是散座，二楼是雅间，酒香混着菜香，从门缝里直往外冒。',
  actions: [
    { label: '醉仙楼', cmd: 'list 店小二', keywords: ['小二', '酒'], desc: '点几个菜，喝一壶酒' },
    { label: '雅间', cmd: 'go 雅间', keywords: ['雅间', '楼上'], desc: '上楼，清静些' },
  ],
});
addRoom('jn_wine_room', {
  name: '醉仙楼·二楼雅间', region: 'market',
  desc: '临街的雅间，推开窗就能看见东市的人流。桌上摆着一副没下完的棋。',
});
link('jn_market_main', 'se', 'jn_wine_house', 'nw');
link('jn_wine_house', 'u', 'jn_wine_room', 'd');

/* --- 江南城：住宅区 --- */
addRoom('jn_resident_1', {
  name: '江南城·柳巷', region: 'jiangnan',
  desc: '一条幽静的长巷，两侧是青砖院墙，墙头探出几枝石榴。巷子里晾着衣裳，风一吹哗啦啦响。',
  exits: {},
});
addRoom('jn_resident_2', {
  name: '江南城·杏花巷', region: 'jiangnan',
  desc: '巷口一株老杏树，花落了一地。几户人家的门半掩着，能听见里头织布的声音。',
  exits: {},
});
addRoom('jn_resident_3', {
  name: '江南城·井台', region: 'jiangnan',
  desc: '一口老井，井台被辘轳磨得溜光。打水的妇人排着队，一边摇辘轳一边说东家长西家短。',
  actions: [{ label: '水井', cmd: 'drink', keywords: ['井', '水'], desc: '打一桶水解渴（需带容器）' }],
  exits: {},
});
link('jn_resident_1', 'e', 'jn_resident_2', 'w');
link('jn_resident_2', 's', 'jn_resident_3', 'n');
link('jn_resident_3', 'n', 'jiangnan_street', 's');
link('jn_resident_1', 'w', 'jiangnan_west_road', 'e');

/* --- 江南城：普通民居（可推进到几十间，供 NPC 安家） --- */
const RESIDENT_NAMES = ['张宅', '李宅', '王宅', '赵宅', '孙宅', '周宅', '吴宅', '郑宅', '冯宅', '陈宅',
  '褚宅', '卫宅', '蒋宅', '沈宅', '韩宅', '杨宅', '朱宅', '秦宅', '尤宅', '许宅'];
const residentAnchors = ['jn_resident_1', 'jn_resident_2', 'jn_resident_3'];



let anchorIdx = 0;
let residentIdx = 0;
for (const nm of RESIDENT_NAMES) {
  const rid = 'jn_home_' + String(++residentIdx).padStart(2, '0');
  if (rooms[rid]) continue;
  const anchor = residentAnchors[anchorIdx % residentAnchors.length];
  /* 找一个空方向挂上去 */
  const used = new Set(Object.keys(rooms[anchor].exits || {}));
  const dir = DIRS.find(d => !used.has(d)) || 'n';
  addRoom(rid, {
    name: nm, region: 'jiangnan',
    desc: `${nm}是一座两进的院子，门上的红漆已经褪了色。院里种着石榴与夹竹桃，晾衣绳上搭着刚浆洗的衣裳。`,
  });
  link(anchor, dir, rid, BACK[dir]);
  anchorIdx++;
}

/* --- 江南城：富户大院 --- */
addRoom('jn_rich_house', {
  name: '江南城·钱府', region: 'jiangnan',
  desc: '好一座气派的宅子！门前一对石狮子，门楣上悬着「钱府」二字匾额，是本地有名的富户钱家。',
  actions: [{ label: '钱府', cmd: 'knock 钱府', keywords: ['钱府', '敲门', '门环'], desc: '叩门求见' }],
});
addRoom('jn_rich_hall', {
  name: '钱府·前厅', region: 'jiangnan',
  desc: '前厅陈设极考究，紫檀条案上供着一尊瓷器，墙上挂着两幅山水。地上铺着厚厚的蒲团，踩上去悄无声息。',
});
addRoom('jn_rich_garden', {
  name: '钱府·后花园', region: 'jiangnan',
  desc: '假山、池塘、曲桥、凉亭，一应俱全。池塘里养着锦鲤，见人来便拥作一团讨食吃。',
  actions: [{ label: '池塘', cmd: 'drink', keywords: ['池', '水'], desc: '取一瓢池水解渴' }],
});
link('jn_resident_2', 'n', 'jn_rich_house', 's');
link('jn_rich_house', 'n', 'jn_rich_hall', 's');
link('jn_rich_hall', 'e', 'jn_rich_garden', 'w');

/* ============================================================
 * 二、衙门 & 监狱
 * ============================================================ */
addRoom('jn_yamen_gate', {
  name: '衙门·门房', region: 'yamen',
  desc: '两扇朱漆大门洞开，门里立着两个持棍的衙役。左边墙上贴着告示，右边立着一面登闻鼓——鼓皮都磨白了。',
  actions: [
    { label: '告示', cmd: 'read 告示', keywords: ['告示', '通缉'], desc: '看看衙门贴了什么' },
    { label: '登闻鼓', cmd: 'knock 登闻鼓', keywords: ['鼓', '击鼓'], desc: '有冤要申就击鼓' },
  ],
});
addRoom('jn_yamen_court', {
  name: '衙门·大堂', region: 'yamen',
  desc: '堂上高悬「明镜高悬」四字，公案后是一把太师椅。公案前摆着两排水火棍，红黑相间，看着就压人。',
  actions: [{ label: '县太爷', cmd: 'talk 县太爷', keywords: ['县太爷', '老爷'], desc: '向父母官老人家问话' }],
});
addRoom('jn_yamen_office', {
  name: '衙门·签押房', region: 'yamen',
  desc: '师爷们的办事场所，案上堆着半人高的卷宗。角落里有人在磨墨，沙沙的响。',
});
addRoom('jn_yamen_store', {
  name: '衙门·库房', region: 'yamen',
  desc: '税银与赃物都收在这里，门口挂着三把锁。守库的老吏正打着瞌睡。',
});
addRoom('jn_yamen_prison', {
  name: '衙门·监狱', region: 'yamen',
  desc: '一股霉味扑面而来。铁栅后是挤作一团的犯人，有的在哭，有的在骂，有的早已没了声音。',
  actions: [{ label: '牢门', cmd: 'look 牢门', keywords: ['牢门', '栅栏'], desc: '看看牢里关的是些什么人' }],
});
addRoom('jn_yamen_back', {
  name: '衙门·后衙', region: 'yamen',
  desc: '父母官的家眷住处，比前衙清静得多，院里有棵几百年的老槐树。',
});
link('jiangnan_street', 'ne', 'jn_yamen_gate', 'sw');
link('jn_yamen_gate', 'n', 'jn_yamen_court', 's');
link('jn_yamen_court', 'e', 'jn_yamen_office', 'w');
link('jn_yamen_office', 'e', 'jn_yamen_store', 'w');
link('jn_yamen_court', 'w', 'jn_yamen_prison', 'e');
link('jn_yamen_court', 'n', 'jn_yamen_back', 's');

/* ============================================================
 * 三、书店 / 书院
 * ============================================================ */
addRoom('jn_bookshop', {
  name: '江南城·翰墨斋', region: 'shuyuan',
  desc: '满架的书，从经史子集到话本戏文，连书架顶上塞的都是。老板是个瘦高个，说话慢悠悠的。',
  actions: [{ label: '翰墨斋', cmd: 'list 书斋', keywords: ['书', '斋'], desc: '挑几本书' }],
});
addRoom('jn_school', {
  name: '白鹿书院·讲堂', region: 'shuyuan',
  desc: '四壁挂着先贤画像，底下是一排排矮几与蒲团。夫子站在上首，手里握着戒尺，正讲到《春秋》。',
  actions: [{ label: '夫子', cmd: 'ask 夫子 about 学问', keywords: ['夫子', '先生', '学问'], desc: '向夫子请教' }],
});
addRoom('jn_school_lib', {
  name: '白鹿书院·藏书楼', region: 'shuyuan',
  desc: '整整三层的书楼，樟木书架散发着一股清苦的香。爬梯靠在书架上，梯脚被磨得发亮。',
  actions: [{ label: '书架', cmd: 'search 书架', keywords: ['书架', '翻书'], desc: '翻翻有没有孤本' }],
});
addRoom('jn_school_yard', {
  name: '白鹿书院·庭院', region: 'shuyuan',
  desc: '庭院里一株老梅，冬天开花时全城的人都来瞧。石桌上还摊着学生没写完的策论。',
});
link('jn_resident_1', 'n', 'jn_school', 's');
link('jn_school', 'n', 'jn_school_lib', 's');
link('jn_school', 'e', 'jn_school_yard', 'w');
link('jn_school_yard', 'e', 'jn_bookshop', 'w');

/* ============================================================
 * 四、农田 / 农户
 * ============================================================ */
addRoom('jn_farm_road', {
  name: '城东·田埂', region: 'farmland',
  desc: '窄窄的田埂两边都是水田，稻子已经抽穗，风一过就荡起一层绿浪。蛙声一片。',
  exits: {},
});
addRoom('jn_farm_1', {
  name: '城东·稻田', region: 'farmland',
  desc: '一方齐整的稻田。秧苗插得笔直，田水映着天光。田头插着一块木牌，写着耕者的名字。',
  actions: [{ label: '稻田', cmd: 'harvest', keywords: ['稻', '庄稼', '收割'], desc: '收割庄稼（偷或自己种的）' }],
});
addRoom('jn_farm_2', {
  name: '城东·菜地', region: 'farmland',
  desc: '菜地里的青菜水灵灵的，篱笆上爬着豆角藤。有只黄狗拴在田头的棚子里，见了人就叫。',
  actions: [{ label: '菜地', cmd: 'harvest', keywords: ['菜', '庄稼', '摘'], desc: '摘些青菜' }],
});
addRoom('jn_farm_house', {
  name: '城东·佃户家', region: 'farmland',
  desc: '两间土坯房，屋檐下挂着斗笠与蓑衣，墙根堆着柴火。灶间还冒着烟，飘出一股煮菜粥的味。',
});
addRoom('jn_farm_shed', {
  name: '城东·田头窝棚', region: 'farmland',
  desc: '看田人歇脚的棚子，一条草席，一柄锄头，角落里堆着半袋种子。',
  actions: [{ label: '种子袋', cmd: 'get 稻种', keywords: ['种子', '稻种'], desc: '拿点种子自己种' }],
});
link('jiangnan_east_road', 'n', 'jn_farm_road', 's');
link('jn_farm_road', 'w', 'jn_farm_1', 'e');
link('jn_farm_road', 'e', 'jn_farm_2', 'w');
link('jn_farm_1', 'n', 'jn_farm_house', 's');
link('jn_farm_2', 'n', 'jn_farm_shed', 's');

/* ============================================================
 * 五、青楼
 * ============================================================ */
addRoom('jn_brothel_gate', {
  name: '醉春楼·门厅', region: 'qinglou',
  desc: '一进堂就暖得发昏，檀香、脂粉香、酒香混作一团。楼上传来琵琶声，楼下老鸨满脸堆笑地迎上来。',
  actions: [
    { label: '老鸨', cmd: 'talk 老鸨', keywords: ['老鸨', '妈妈'], desc: '问问楼里的姑娘' },
    { label: '花牌', cmd: 'list 花牌', keywords: ['花牌', '姑娘'], desc: '看看今晚点谁的牌子' },
  ],
});
addRoom('jn_brothel_hall', {
  name: '醉春楼·花厅', region: 'qinglou',
  desc: '花厅上悬着八盏琉璃灯，照得一屋子人脸红扑扑的。姑娘们坐在绣墩上，弹唱的弹唱，说笑的说笑。',
});
addRoom('jn_brothel_stage', {
  name: '醉春楼·戏台', region: 'qinglou',
  desc: '戏台上正唱着一折《游园惊梦》，水袖甩开如一朵白莲。台下叫好声、掷瓜子壳的哗啦声混在一处。',
  actions: [{ label: '戏台', cmd: 'listen 戏', keywords: ['戏', '唱'], desc: '听一折戏' }],
});
addRoom('jn_brothel_room', {
  name: '醉春楼·雅阁', region: 'qinglou',
  desc: '一间精巧的小阁，纱帐低垂，桌上摆着时令鲜果与一壶温酒。窗外能看见江上的灯火。',
});
addRoom('jn_brothel_kitchen', {
  name: '醉春楼·后厨', region: 'qinglou',
  desc: '油烟腾腾，几个粗使的妇人在灶前忙得脚不沾地。这里也收留无处可去的人打零工。',
  actions: [{ label: '灶台', cmd: 'work 后厨', keywords: ['打工', '做活'], desc: '在这里打零工挣几个铜板' }],
});
link('jiangnan_qiao', 'n', 'jn_brothel_gate', 's');
link('jn_brothel_gate', 'n', 'jn_brothel_hall', 's');
link('jn_brothel_hall', 'e', 'jn_brothel_stage', 'w');
link('jn_brothel_hall', 'n', 'jn_brothel_room', 's');
link('jn_brothel_hall', 'w', 'jn_brothel_kitchen', 'e');

/* ============================================================
 * 六、码头 / 渡口
 * ============================================================ */
addRoom('jn_harbor', {
  name: '江口码头', region: 'harbor',
  desc: '几十条船挤在码头边，桅杆立得像一片枯林。脚夫扛着麻袋在跳板上飞奔，号子声一浪高过一浪。',
  actions: [
    { label: '江水', cmd: 'drink', keywords: ['江', '水'], desc: '打一壶江水（需带容器）' },
    { label: '脚夫', cmd: 'ask 脚夫 about 搬运', keywords: ['脚夫', '搬运', '打工'], desc: '问问有没有活儿' },
  ],
});
addRoom('jn_harbor_shed', {
  name: '码头·货栈', region: 'harbor',
  desc: '堆满了南来北往的货：景德镇的瓷器、苏杭的绸缎、岭南的果干。看货的老头儿一口黄牙。',
});
addRoom('jn_harbor_inn', {
  name: '码头·船家客栈', region: 'harbor',
  desc: '比城里的客栈破得多，住的都是走水路的人。墙上贴满了各处的船期。',
});
addRoom('jn_boat', {
  name: '江上·乌篷船', region: 'harbor',
  desc: '一叶乌篷船，篷下铺着草席。船家在后梢摇橹，江水在船底咕嘟咕嘟地响。',
  actions: [{ label: '江水', cmd: 'drink', keywords: ['江', '水'], desc: '掬一捧江水' }],
});
link('jn_brothel_gate', 'e', 'jn_harbor', 'w');
link('jn_harbor', 'n', 'jn_harbor_shed', 's');
link('jn_harbor_shed', 'e', 'jn_harbor_inn', 'w');
link('jn_harbor', 'e', 'jn_boat', 'w');

/* ============================================================
 * 七、铁匠铺 / 药铺 / 杂货（扩充江南城）
 * ============================================================ */
addRoom('jn_smith_inner', {
  name: '铁匠铺·炉房', region: 'jiangnan',
  desc: '炉火把整间屋子烤得发烫，风箱呼哧呼哧地响。铁砧上火花四溅，打铁声震得人耳朵嗡嗡。',
  actions: [
    { label: '铁砧', cmd: 'list 铁匠', keywords: ['铁匠', '打铁'], desc: '看看能打什么兵器' },
    { label: '炉火', cmd: 'work 打铁', keywords: ['打工', '打铁', '拉风箱'], desc: '在这儿打零工' },
  ],
});
addRoom('jn_pharmacy', {
  name: '江南城·回春堂', region: 'jiangnan',
  desc: '药柜从地上一直顶到房梁，数百个抽屉上贴着药名。柜台后坐着位白发老郎中，正给人号脉。',
  actions: [
    { label: '药柜', cmd: 'list 药铺', keywords: ['药', '抓药'], desc: '抓几味药' },
    { label: '老郎中', cmd: 'talk 郎中', keywords: ['郎中', '看病'], desc: '请郎中看看伤' },
  ],
});
addRoom('jn_pharmacy_back', {
  name: '回春堂·后院', region: 'jiangnan',
  desc: '院子里晒着草药，一簸箕一簸箕的，太阳底下散出浓烈的药香。',
  actions: [{ label: '药草', cmd: 'get 药材', keywords: ['药材', '药'], desc: '拿些晒好的药材' }],
});
addRoom('jn_misc_shop', {
  name: '江南城·杂货铺', region: 'jiangnan',
  desc: '油盐酱醋、绳索陶罐、草鞋斗笠，什么都有一点。老板是个爱说话的胖妇人。',
  actions: [{ label: '杂货铺', cmd: 'list 杂货铺', keywords: ['杂货', '铺'], desc: '买些日用的物件' }],
});
link('jiangnan_smithy', 'n', 'jn_smith_inner', 's');
link('jiangnan_street', 'nw', 'jn_pharmacy', 'se');
link('jn_pharmacy', 'n', 'jn_pharmacy_back', 's');
link('jiangnan_street', 'sw', 'jn_misc_shop', 'ne');

/* ============================================================
 * 八、皇城（远端区域，与江南城相连）
 * ============================================================ */
addRoom('palace_gate', {
  name: '皇城·午门', region: 'palace',
  desc: '朱红宫墙高逾数丈，午门上的铜钉一颗颗像拳头。禁军持戟而立，眼睛都不眨一下。',
  actions: [{ label: '禁军', cmd: 'talk 禁军', keywords: ['禁军', '守卫'], desc: '问问能不能进去' }],
});
addRoom('palace_plaza', {
  name: '皇城·金水桥', region: 'palace',
  desc: '五座汉白玉石桥横跨金水河，桥栏上雕着螭首。河里的水引自玉泉山，清得能看见底。',
  actions: [{ label: '金水河', cmd: 'drink', keywords: ['水', '河'], desc: '取一瓢金水河的水' }],
});
addRoom('palace_hall', {
  name: '皇城·太和殿', region: 'palace',
  desc: '殿高十丈，七十二根金丝楠木柱撑起一片穹顶。地上铺着金砖，光可鉴人。站在这里，人显得极小。',
});
addRoom('palace_garden', {
  name: '皇城·御花园', region: 'palace',
  desc: '太湖石堆成的假山，一池碧水，岸边垂柳拂水，亭台掩映。寻常人一辈子也见不到这样的景致。',
  actions: [{ label: '池水', cmd: 'drink', keywords: ['池', '水'], desc: '取水' }],
});
addRoom('palace_harem', {
  name: '皇城·后宫', region: 'palace',
  desc: '重重宫阙，一进套着一进，走进去很容易迷路。时有宫人捧着食盒低头快步走过。',
});
addRoom('palace_study', {
  name: '皇城·御书房', region: 'palace',
  desc: '御案上堆着奏折，朱笔搁在笔山上。一架子的御制诗文集，纸墨都是新的。',
});
addRoom('palace_prison', {
  name: '皇城·天牢', region: 'palace',
  desc: '比县衙的牢房阴森十倍，墙上渗着水。铁链拖地的声音在过道里回荡。',
});
addRoom('palace_road', {
  name: '皇城·御道', region: 'palace',
  desc: '笔直的一条青石御道，两侧列着石翁仲与石马，一直延伸到看不见的尽头。',
});
link('road_beijiang_2', 'e', 'palace_road', 'w');
link('palace_road', 'e', 'palace_gate', 'w');
link('palace_gate', 'e', 'palace_plaza', 'w');
link('palace_plaza', 'e', 'palace_hall', 'w');
link('palace_hall', 'w', 'palace_garden', 'e');
link('palace_hall', 'n', 'palace_harem', 's');
link('palace_harem', 'e', 'palace_study', 'w');
link('palace_hall', 'nw', 'palace_prison', 'se');

/* ============================================================
 * 九、村镇（青溪村）
 * ============================================================ */
addRoom('cunzhen_gate', {
  name: '青溪村·村口', region: 'cunzhen',
  desc: '一株大槐树，树下几个老人在下棋。村口的石牌坊写着「青溪」二字，看得出有些年头了。',
  actions: [{ label: '槐树', cmd: 'look 槐树', keywords: ['槐树', '树'], desc: '看看这棵老树' }],
});
addRoom('cunzhen_street', {
  name: '青溪村·村道', region: 'cunzhen',
  desc: '一条黄土村道穿村而过，两侧是土墙草顶的农舍。鸡在路中间刨食，见了人也不让。',
  exits: {},
});
addRoom('cunzhen_inn', {
  name: '青溪村·村口小铺', region: 'cunzhen',
  desc: '半间屋子的小铺，卖些粗茶与烧饼。掌柜的是个裹着头巾的老妇。',
  actions: [{ label: '小铺', cmd: 'list 小铺', keywords: ['小铺', '烧饼'], desc: '买个烧饼充饥' }],
});
addRoom('cunzhen_mill', {
  name: '青溪村·碾房', region: 'cunzhen',
  desc: '一盘石磨由驴拉着转个不停，麦粉落了满地。几个妇人端着簸箕在筛面。',
  actions: [{ label: '石磨', cmd: 'work 碾房', keywords: ['打工', '碾米', '磨面'], desc: '在这儿帮工' }],
});
addRoom('cunzhen_pond', {
  name: '青溪村·水塘', region: 'cunzhen',
  desc: '村中一口大水塘，鸭子在里头游来游去。塘边系着一条破木船。',
  actions: [
    { label: '塘水', cmd: 'drink', keywords: ['水', '塘'], desc: '打水喝' },
    { label: '水面', cmd: 'fish', keywords: ['钓鱼', '鱼'], desc: '试试有没有鱼' },
  ],
});
addRoom('cunzhen_temple', {
  name: '青溪村·土地庙', region: 'cunzhen',
  desc: '小小的土地庙，供着泥塑的土地公婆，面前的香炉里插着几根残香。庙檐下常有乞丐过夜。',
});
addRoom('cunzhen_farm', {
  name: '青溪村·田地', region: 'cunzhen',
  desc: '一片整整齐齐的田，麦子快熟了。田边立着个稻草人，衣裳都烂了。',
  actions: [{ label: '田地', cmd: 'harvest', keywords: ['麦', '庄稼', '收割'], desc: '收割庄稼' }],
});
link('road_jiangnan_1', 'n', 'cunzhen_gate', 's');
link('cunzhen_gate', 'n', 'cunzhen_street', 's');
link('cunzhen_street', 'w', 'cunzhen_inn', 'e');
link('cunzhen_street', 'e', 'cunzhen_mill', 'w');
link('cunzhen_street', 'n', 'cunzhen_pond', 's');
link('cunzhen_pond', 'w', 'cunzhen_temple', 'e');
link('cunzhen_street', 'ne', 'cunzhen_farm', 'sw');

/* --- 村里的农舍 --- */
const CUN_HOMES = ['cun_home_01', 'cun_home_02', 'cun_home_03', 'cun_home_04', 'cun_home_05', 'cun_home_06'];
const CUN_NAMES = ['青溪村·王家', '青溪村·李家', '青溪村·陈家', '青溪村·杨家', '青溪村·刘家', '青溪村·黄家'];
CUN_HOMES.forEach((rid, i) => {
  addRoom(rid, {
    name: CUN_NAMES[i], region: 'cunzhen',
    desc: `${CUN_NAMES[i]}的院子。土墙围着，院里拴着牛，墙角搭着鸡窝，一派农家气象。`,
  });
  const dir = DIRS[i % DIRS.length];
  const anchor = i % 2 === 0 ? 'cunzhen_street' : 'cunzhen_farm';
  const used = new Set(Object.keys(rooms[anchor].exits || {}));
  const d = used.has(dir) ? (DIRS.find(x => !used.has(x)) || dir) : dir;
  link(anchor, d, rid, BACK[d]);
});

/* ============================================================
 * 十、野外补充（树林 / 山洞 / 溪流）—— 供采集与打水
 * ============================================================ */
addRoom('jn_woods_1', {
  name: '城西·松林', region: 'wild',
  desc: '一片茂密的松林，松针铺了厚厚一层，踩上去软绵绵的。林间有松鼠跳窜，偶尔能听见啄木鸟敲树。',
  actions: [{ label: '松林', cmd: 'gather', keywords: ['采摘', '采药', '松'], desc: '在林子里采些药材' }],
});
addRoom('jn_woods_2', {
  name: '城西·密林深处', region: 'wild',
  desc: '树木遮天蔽日，光线暗得像黄昏。地上有野兽的足迹，深处似乎还有什么东西在喘气。',
  respawn: [{ npc: 'mob_wolf', count: 1, chance: 0.5 }, { npc: 'mob_boar', count: 1, chance: 0.4 }],
});
addRoom('jn_stream', {
  name: '城西·清溪', region: 'wild',
  desc: '一道清溪从山间流下，水底的卵石一颗颗看得分明。溪边有浣衣的村妇，也有挑水的僧人。',
  actions: [
    { label: '溪水', cmd: 'drink', keywords: ['溪', '水'], desc: '打一容器溪水' },
    { label: '溪面', cmd: 'fish', keywords: ['钓鱼', '鱼'], desc: '溪里试试手气' },
  ],
});
addRoom('jn_cave', {
  name: '城西·无名山洞', region: 'wild',
  desc: '洞口只容一人通过，里头越走越深，越走越冷。墙上似有人刻过字，被苔藓盖住了一半。',
  actions: [{ label: '刻字', cmd: 'read 石壁', keywords: ['石壁', '刻字'], desc: '辨认壁上的字' }],
});
addRoom('jn_hill_top', {
  name: '城西·孤山顶', region: 'wild',
  desc: '登上山顶，四野尽收眼底。江如素练，城似棋盘。风大得站不稳，衣袍猎猎作响。',
});
link('jiangnan_hill', 'n', 'jn_woods_1', 's');
link('jn_woods_1', 'n', 'jn_woods_2', 's');
link('jn_woods_1', 'w', 'jn_stream', 'e');
link('jn_woods_2', 'w', 'jn_cave', 'e');
link('jn_hill_top', 's', 'jn_woods_1', 'n');

link('jiangnan_hill', 's', 'jn_hill_top', 'n');

/* ============================================================
 * 十一、把新房间的「家」登记进 meta，方便后续系统用
 * ============================================================ */
doc.meta = doc.meta || {};
doc.meta.homeRooms = Object.keys(rooms).filter(rid => /宅|家|院$|屋$|府$/.test(rooms[rid].name));

/* ============================================================
 * 十一b、补齐「场所密度」——让各身份的 NPC 都有地方去
 *   （衙门/书院/宫廷/寺观/市集 房间太少会让 NPC 溢到不相干的地方）
 * ============================================================ */

/* --- 衙门扩充 --- */
addRoom('jn_yamen_side',  { name: '衙门·偏厅', region: 'yamen', desc: '衙役们轮值歇脚的地方，墙上挂着水火棍，桌上堆着没吃完的干粮。' });
addRoom('jn_yamen_wt',    { name: '衙门·刑房', region: 'yamen', desc: '夹棍、拶指、板子，一应俱全。地上有洗不掉的暗色痕迹，进来就觉着后背发凉。' });
addRoom('jn_yamen_arch',  { name: '衙门·架阁库', region: 'yamen', desc: '一摞摞的卷宗从地上堆到房梁，年份久远的纸上爬满了虫蛀的孔。' });
addRoom('jn_yamen_guest', { name: '衙门·客房', region: 'yamen', desc: '招待过路官员的厢房，陈设简朴但干净，窗下摆着一张书案。' });
link('jn_yamen_office', 'n', 'jn_yamen_side', 's');
link('jn_yamen_prison', 'n', 'jn_yamen_wt', 's');
link('jn_yamen_office', 's', 'jn_yamen_arch', 'n');
link('jn_yamen_back', 'e', 'jn_yamen_guest', 'w');

/* --- 书院扩充 --- */
addRoom('jn_school_room1', { name: '白鹿书院·东斋', region: 'shuyuan', desc: '学舍一间，两张板床一张书案。墙上贴着学生自己写的字，墨迹还新。' });
addRoom('jn_school_room2', { name: '白鹿书院·西斋', region: 'shuyuan', desc: '比东斋更窄，窗纸破了两个洞。案上一盏油灯，灯芯烧得只剩一点。' });
addRoom('jn_school_hall',  { name: '白鹿书院·明伦堂', region: 'shuyuan', desc: '书院正堂，「明伦」二字匾额高悬。堂上摆着孔夫子的牌位，初一十五要行香。' });
addRoom('jn_school_herb',  { name: '白鹿书院·药圃', region: 'shuyuan', desc: '书院后的一小块药圃，种着薄荷、紫苏、车前子。是学生们按《本草》栽的。' });
addRoom('jn_study_1',      { name: '翰墨斋·后堂', region: 'shuyuan', desc: '书斋的后堂，堆着待装订的书页，空气中全是墨与纸的味道。' });
addRoom('jn_study_2',      { name: '清雅书轩', region: 'shuyuan', desc: '一间临街的小书轩，窗前挂着竹帘。常有读书人在此抄书糊口。' });
link('jn_school', 'e', 'jn_school_room1', 'w');
link('jn_school', 'w', 'jn_school_room2', 'e');
link('jn_school_yard', 'n', 'jn_school_hall', 's');
link('jn_school_lib', 'e', 'jn_school_herb', 'w');
link('jn_bookshop', 'n', 'jn_study_1', 's');
link('jn_bookshop', 'e', 'jn_study_2', 'w');

/* --- 皇宫扩充 --- */
addRoom('palace_court1', { name: '皇城·东六宫', region: 'palace', desc: '一处宫院，朱漆门窗，廊下悬着一排鸟笼。宫人端着铜盆低头走过。' });
addRoom('palace_court2', { name: '皇城·西六宫', region: 'palace', desc: '与东六宫对称的院落，院中一株老海棠，花开时满院胭脂色。' });
addRoom('palace_court3', { name: '皇城·长巷', region: 'palace', desc: '夹在两堵高墙之间的一条长巷，走进去听不见半点别的声音，只有自己的脚步。' });
addRoom('palace_court4', { name: '皇城·织造局', region: 'palace', desc: '几十架织机同时作响，织女们低着头飞梭，织的是御用的云锦。' });
addRoom('palace_court5', { name: '皇城·尚膳房', region: 'palace', desc: '御膳房，灶火日夜不熄。掌勺的、切配的、传菜的，脚步不停。' });
addRoom('palace_court6', { name: '皇城·内库', region: 'palace', desc: '内库重地，一箱箱的古玩字画、金银器皿码得整整齐齐。守库太监寸步不离。' });
link('palace_harem', 'e', 'palace_court1', 'w');
link('palace_harem', 'w', 'palace_court2', 'e');
link('palace_harem', 'n', 'palace_court3', 's');
link('palace_garden', 'n', 'palace_court4', 's');
link('palace_garden', 'e', 'palace_court5', 'w');
link('palace_study', 'e', 'palace_court6', 'w');

/* --- 寺观扩充 --- */
addRoom('jn_temple_1', { name: '城外·慈云寺', region: 'wild', desc: '一座香火不算旺的小寺，山门上的漆剥落了大半。院里晒着僧衣，一个老僧在扫地。' });
addRoom('jn_temple_2', { name: '城外·白云观', region: 'wild', desc: '道观不大，三清殿里的塑像却塑得极好。观里的道士正在檐下练剑。' });
addRoom('jn_temple_3', { name: '城外·水月庵', region: 'wild', desc: '一座尼庵，门前一条小溪，溪上有座小石桥。庵里很静，只听得见木鱼声。' });
link('jn_woods_1', 's', 'jn_temple_1', 'n');
link('jn_stream', 'n', 'jn_temple_2', 's');
link('jn_stream', 's', 'jn_temple_3', 'n');

/* --- 市集扩充 --- */
addRoom('jn_market_north', { name: '东市·北巷', region: 'market', desc: '东市北边的一条巷子，卖的都是些粗使家什。打铁的、箍桶的、修鞋的，各占一角。' });
addRoom('jn_market_south', { name: '东市·南巷', region: 'market', desc: '南巷多是小吃摊，煎饼、馄饨、糖炒栗子，香气一路能飘出半条街。' });
addRoom('jn_market_west',  { name: '东市·西巷', region: 'market', desc: '西巷卖的是花鸟虫鱼。笼里的画眉叫得正欢，缸里的金鱼摆着尾巴。' });
addRoom('jn_market_east',  { name: '东市·东巷', region: 'market', desc: '东巷尽头是个小广场，常有卖艺的在此耍刀弄枪，围一圈看客。' });
addRoom('jn_weaver',       { name: '东市·织坊', region: 'market', desc: '几十张织机排开，女工们低头穿梭，机杼声连成一片。' });
addRoom('jn_pottery',      { name: '东市·窑场', region: 'market', desc: '窑火烧得正旺，刚出窑的碗碟还烫手。老师傅拿小锤敲一敲，听声辨好坏。' });
link('jn_market_main', 'n', 'jn_market_north', 's');
link('jn_market_main', 's', 'jn_market_south', 'n');
link('jn_market_north', 'w', 'jn_market_west', 'e');
link('jn_market_south', 'e', 'jn_market_east', 'w');
link('jn_market_west', 'n', 'jn_weaver', 's');
link('jn_market_east', 's', 'jn_pottery', 'n');

/* --- 酒馆 / 车马行（市井人多的地方） --- */
addRoom('jn_tavern',   { name: '东市·老酒馆', region: 'market', desc: '门脸不大，里头却坐得满满当当。酒是浊酒，菜是粗菜，胜在便宜热闹。' });
addRoom('jn_carriage', { name: '江南城·车马行', region: 'jiangnan', desc: '院里停着七八辆大车，骡马在槽边嚼草。车夫们蹲在墙根下赌钱。' });
link('jn_market_south', 'w', 'jn_tavern', 'e');
link('jn_market_north', 'e', 'jn_carriage', 'w');

/* --- 民居补充（给 NPC 安家） --- */
const MORE_HOMES = ['陈家巷·老宅', '王家小院', '刘家院', '黄泥巷·旧宅', '赵家小院', '孙家院',
  '城西·李家', '城西·周家', '城西·吴家', '城西·郑家'];
MORE_HOMES.forEach((nm, i) => {
  const rid = 'jn_home_' + String(21 + i).padStart(2, '0');
  addRoom(rid, { name: nm, region: 'jiangnan', desc: `${nm}。院门虚掩，里头传出锅碗瓢盆的动静，是寻常人家过日子的声响。` });
  link('jn_resident_1', DIRS[i % DIRS.length], rid, BACK[DIRS[i % DIRS.length]]);
});

/* --- 青楼扩充 --- */
addRoom('jn_brothel_2', { name: '醉春楼·听雨轩', region: 'qinglou', desc: '一间清雅的厢房，窗下种着芭蕉，下雨时最宜听雨。案上摆着未写完的词笺。' });
addRoom('jn_brothel_3', { name: '醉春楼·望江阁', region: 'qinglou', desc: '三楼临江的阁子，推窗就是滚滚江水。夜里有渔火点点，像是落进水里的星子。' });
link('jn_brothel_room', 'n', 'jn_brothel_2', 's');
link('jn_brothel_2', 'e', 'jn_brothel_3', 'w');

/* --- 码头扩充 --- */
addRoom('jn_harbor_wharf', { name: '码头·栈桥', region: 'harbor', desc: '木栈桥一直伸到江心，桥板踩上去吱呀作响。两旁泊满了船，缆绳缠得密密麻麻。' });
addRoom('jn_harbor_stall', { name: '码头·鱼市', region: 'harbor', desc: '天没亮就开市的鱼摊，木盆里活鱼乱跳，腥气冲天。讨价还价的声音像吵架。' });
link('jn_harbor', 's', 'jn_harbor_wharf', 'n');
link('jn_harbor', 'n', 'jn_harbor_stall', 'w');

/* --- 田野扩充 --- */
addRoom('jn_farm_3',   { name: '城东·果园', region: 'farmland', desc: '一片果园，桃李杏梨都有。果子快熟了，枝头压得低低的。' });
addRoom('jn_farm_4',   { name: '城东·茶山', region: 'farmland', desc: '缓坡上一垄垄的茶树，采茶女背着竹篓在垄间穿行，手指翻飞。' });
addRoom('jn_farm_5',   { name: '城东·打谷场', region: 'farmland', desc: '一片夯得极平的空场，堆着稻草垛。农闲时孩子们在这里翻滚打闹。' });
addRoom('jn_farm_6',   { name: '城东·牛棚', region: 'farmland', desc: '两头黄牛拴在棚下，慢条斯理地反刍。棚角堆着铡好的草料。' });
addRoom('jn_farm_7',   { name: '城东·猪圈', region: 'farmland', desc: '几头肥猪在泥里打滚，哼哼唧唧。气味不太好闻，但年节时都指着它们。' });
addRoom('jn_farm_8',   { name: '城东·鸡舍', region: 'farmland', desc: '鸡舍里几十只鸡，一只大公鸡昂着头踱步，俨然一副主人模样。' });
link('jn_farm_road', 'n', 'jn_farm_3', 's');
link('jn_farm_road', 's', 'jn_farm_4', 'n');
link('jn_farm_1', 'e', 'jn_farm_5', 'w');
link('jn_farm_2', 'e', 'jn_farm_6', 'w');
link('jn_farm_6', 'e', 'jn_farm_7', 'w');
link('jn_farm_7', 'e', 'jn_farm_8', 'w');

/* ============================================================
 * 十二b、连通性修复：把孤立房间挂到已连通的邻居上
 * ============================================================ */
function bfsReach() {
  const start = doc.meta.startRoom || 'road_jiangnan_1';
  const seen = new Set([start]);
  const q = [start];
  while (q.length) {
    const cur = q.shift();
    const r = rooms[cur];
    if (!r || !r.exits) continue;
    for (const d of Object.keys(r.exits)) {
      const ex = r.exits[d];
      const tid = typeof ex === 'string' ? ex : ex.to;
      if (tid && rooms[tid] && !seen.has(tid)) { seen.add(tid); q.push(tid); }
    }
  }
  return seen;
}

/** 找和一个孤立房间「语义最近」的已连通房间：优先同区域，其次新加的 */
function bestAnchor(rid, reached) {
  const r = rooms[rid];
  const sameRegion = [...reached].filter(x => rooms[x].region === r.region);
  if (sameRegion.length) {
    /* 挑出口还没满的 */
    const free = sameRegion.filter(x => Object.keys(rooms[x].exits || {}).length < 8);
    if (free.length) return free[Math.floor(rng() * free.length)];
    return sameRegion[0];
  }
  const free = [...reached].filter(x => Object.keys(rooms[x].exits || {}).length < 8);
  if (free.length) return free[Math.floor(rng() * free.length)];
  return [...reached][0];
}

/** 反复补连，直到全连通或没有可补的 */
let loops = 0, fixed = 0;
while (loops++ < 12) {
  const reached = bfsReach();
  const iso = all_room_ids().filter(r => !reached.has(r));
  if (!iso.length) break;
  for (const rid of iso) {
    const anchor = bestAnchor(rid, reached);
    if (!anchor || anchor === rid) continue;
    /* 找锚点的空方向 */
    const used = new Set(Object.keys(rooms[anchor].exits || {}));
    const dir = DIRS.find(d => !used.has(d));
    if (!dir) continue;
    rooms[anchor].exits[dir] = rid;
    rooms[rid].exits = rooms[rid].exits || {};
    const bdir = BACK[dir];
    if (!rooms[rid].exits[bdir]) rooms[rid].exits[bdir] = anchor;
    fixed++;
  }
}
function all_room_ids() { return Object.keys(rooms); }

fs.writeFileSync(MAP_FILE, JSON.stringify(doc, null, 2), 'utf8');

/* ---------- 报告 ---------- */
const all = Object.keys(rooms);
const byRegion = {};
for (const r of all) byRegion[rooms[r].region] = (byRegion[rooms[r].region] || 0) + 1;
console.log('房间总数：', all.length, '（新增 ' + added.length + '）');
console.log('区域数：', Object.keys(byRegion).length);
console.log('区域分布：', JSON.stringify(byRegion));
const homes = doc.meta.homeRooms;
console.log('可作家园的房间：', homes.length);

/* 连通性检查：从起始房间 BFS 能否到达所有房间 */
const start = doc.meta.startRoom || 'road_jiangnan_1';
const seen = new Set([start]);
const q = [start];
while (q.length) {
  const cur = q.shift();
  const r = rooms[cur];
  if (!r || !r.exits) continue;
  for (const d of Object.keys(r.exits)) {
    const ex = r.exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    if (tid && rooms[tid] && !seen.has(tid)) { seen.add(tid); q.push(tid); }
  }
}
const unreachable = all.filter(r => !seen.has(r));
console.log('连通性：可达', seen.size, '/', all.length, unreachable.length ? ('  孤立房间：' + unreachable.slice(0, 10).join(',')) : '  ✔ 全连通');
