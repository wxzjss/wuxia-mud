#!/usr/bin/env node
/* ============================================================
 * identity-belonging-check.js —— 人物真实感「归属守卫」（门禁版）
 *
 * 文件名说明（重要，别再改回去）：
 *   团队长要求改名 identity-check.js 以便被回归入口收录（规则 ^(smoke-.*|.*-check)\.js$）。
 *   但 tools/identity-check.js **已经存在**且已被 git 跟踪、已在 132 套里跑绿
 *   （它是另一件事：NPC 身份标签 + 关系称谓，48 项断言，见 d9ee513 / f21cba6）。
 *   直接改名会**覆盖并删除一个正在跑绿的套件**。故本文件取
 *   `identity-belonging-check.js` —— 同样匹配收录规则、同样进门禁，且不撞车。
 *   若坚持占用 identity-check.js 这个名字，须先把老的改名为 identity-label-check.js
 *   （那要动一个已绿的套件，不是我能单方面决定的）。
 *
 * 缘起（design/72-rework-design.md §E.3）：
 *   834 个 NPC 共享 513 条描述、453 行台词；山洞里的 NPC 在谈「这条街」。
 *   既有 tools/ai-flavor-check.js 跑出来全绿 —— 它同时列出 274 条样板复用、
 *   同一句最高出现 149 次，却把这条标为「不判红」。
 *   结论是**量具坏了**，不是写得差。本脚本就是那台新的量具。
 *
 * 守三条（每条命中即判红，逐 npcId 出条目）：
 *   N1 场景一致 —— 每句台词/动作/描述必须能在他所在房间的**场所类型**里发生
 *   N2 身份一致 —— 台词要能被他的身份解释（同组复用 / 描述克隆 / 画像无独有名词）
 *   N3 记忆一致 —— 玩家有未了承诺或人情账时，他至少有一条对应台词（可降级）
 *
 * ⚠️ 本脚本**只读** game/ 下的数据，一个字节都不写。
 *
 * 门禁口径（进回归后退出码就是判据，不许永远是 0）：
 *   判红（exit 1）= N1 主红 + N3 判红
 *   不判红        = 低置信单列 / N2a·N2b·N2c 重复度 / 各类「无法判定」
 *   理由：低置信是待人工确认、重复度是待改清单、无法判定是数据不全 ——
 *         都不是「已证实的错」。门禁长期红就没人看，所以它只守正确性。
 *
 * 用法：
 *   node tools/identity-belonging-check.js              全库体检（exit 1 = 门禁不通过）
 *   node tools/identity-belonging-check.js --selftest   注入故障自测（证明量具真能判红）
 *   node tools/identity-belonging-check.js --places     只打场所分类表与禁用词表
 *   node tools/identity-belonging-check.js --inspect    N1 命中按「词 × 场所」聚合（人工复核用）
 * ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

/* ------------------------------------------------------------------ *
 * 一、场所分类
 * ------------------------------------------------------------------ */

const TYPE_CN = {
  cave: '洞窟/地下/墓陵',
  prison: '牢狱/刑房',
  brothel: '青楼',
  martial: '演武场/武馆',
  hall: '厅堂/藏书/库房/殿宇',
  temple: '寺观庙庵',
  water: '水上/水畔（渡口·码头·船·桥·溪潭池）',
  market: '市集/商铺/酒楼/客栈',
  farm: '田庄/农事',
  forest: '林地',
  mountain: '山地（山门·石阶·峰崖·山道）',
  street: '街巷/道路/城门',
  wild: '荒野（戈壁·草原·沙漠·沼泽）',
  home: '内宅/府邸/家园',
  court: '衙署/皇城',
  unknown: '无法判定',
};

/** 名带「·」时取后段（如「桃花岛·渡口」→「渡口」）；无「·」时取整名 */
function suffixOf(name) {
  const s = String(name || '');
  const m = s.match(/·([^·]+)$/);
  return m ? m[1] : s;
}
/** 真·尾部锚定（不能拿首个匹配位置冒充，否则「茶棚」会被「茶」命中） */
function tail(s, src) { return new RegExp('(?:' + src + ')$').test(String(s)); }

/**
 * 有序规则表：首命中胜出，顺序即优先级。
 * [类型, 判定函数(room, 后缀, 全名), 置信度, 依据（写给人看的，不许编）]
 * conf: 'high' = 命中房间名/id 自身的结构特征；'low' = 只靠 region 或描述推断
 */
const PLACE_RULES = [
  ['cave', (r, sf) => /洞|窟|穴|石室|暗道|甬道|墓|陵|冰窖|地底|地下/.test(sf)
    || /(cave|tomb|_shi$|_mu$)/.test(r.id)
    || /(洞内|洞里|洞口|石壁上|岩壁|石壁)/.test(r.desc || ''),
    'high', '后缀/名含 洞·窟·穴·石室·暗道·甬道·墓·陵·冰窖·地下，或 id 含 cave/tomb，或描述含 洞口·石壁·岩壁'],
  ['prison', (r, sf, nm) => /牢|狱|囚|刑房|镣铐/.test(sf) || /牢|狱|囚/.test(nm),
    'high', '后缀/名含 牢·狱·囚·刑房'],
  /* ⚠️ 合欢宗不能整族排除：它的**山门**就是楼子的门面（房间描述明写
     「白日里是弹唱的、陪酒的…夜里换一身衣裳，做的是另一桩买卖」），
     所以「白天不接客」在这间房里是**场景内**的话。
     早先写成 `region==='qinglou' && !/hehuan/` 会把整族排除，
     结果落地新台词后把这句误判成红（P0-2a 当场抓到）。
     现在改成：qinglou 区里**排除演武场/藏经阁/藏宝阁**（那三间是各派通用房），
     其余（含合欢宗·山门）都算青楼。 */
  ['brothel', (r, sf, nm) => /brothel/.test(r.id)
    || (r.region === 'qinglou' && !/(演武场|藏经阁|藏宝阁)/.test(sf))
    || /怡红|翠云楼|牡丹阁|凤来仪|青楼|楚馆/.test(nm),
    'high', 'id 含 brothel，或 region=qinglou 且后缀不是演武场/藏经阁/藏宝阁，或名含 怡红·翠云·牡丹阁·凤来仪'],
  ['martial', (r, sf) => /演武场|演武院|练武场|武馆|校场|擂台|习武/.test(sf),
    'high', '后缀为 演武场/演武院/练武场/武馆/校场/擂台'],
  ['temple', (r, sf, nm) => /寺|庙|观|庵|塔林/.test(sf)
    || /(香火|佛像|金身|罗汉|菩萨|木鱼|诵经|沙弥|僧|尼姑|道人|道士|道长|三清|真武|佛堂|禅|施主)/.test(r.desc || ''),
    'high', '后缀为 寺/庙/观/庵/塔林，或描述含 香火·佛像·金身·沙弥·僧·尼姑·道士 等宗教实物'],
  ['hall', (r, sf) => /藏经阁|藏书楼|藏宝阁|库房|内库|国库|架阁库|签押房|织造局|尚膳房/.test(sf),
    'high', '后缀为 藏经阁/藏书楼/藏宝阁/库房/内库/签押房/织造局/尚膳房'],
  /* ⚠️ 这一条必须在 water **之前**：`jn_harbor_stall`（码头·鱼市）的 id 含 harbor，
     若让 water 先判，鱼市会被当成水边，于是「摊子」被误判红。名字里的 市/铺/摊
     才是这里的主信号，id 只是兜底。 */
  ['market', (r, sf) => /市|铺|摊|坊|栈|楼|馆|仓|行/.test(sf),
    'high', '后缀含 市/铺/摊/坊/栈/楼/馆/仓/行（名字里的行当信号优先于 id 兜底）'],
  ['water', (r, sf) => /渡口|码头|船|栈桥|溪|潭|池|塘|滩|渔|港|洲/.test(sf) || tail(sf, '桥|海|江|湖')
    || /(_boat|_dock|_harbor|_wharf|_ship|_qiao|_bridge|_fengqiao)/.test(r.id),
    'high', '后缀含 渡口/码头/船/栈桥/溪/潭/池/塘/滩/渔/港，或尾部为 桥·海·江·湖，或 id 含 boat/dock/harbor/wharf'],
  ['market', (r, sf) => /茶棚|茶摊/.test(sf) || tail(sf, '间'),
    'high', '后缀为 茶棚/茶摊，或尾部为「间」（酒楼雅间）'],
  ['farm', (r, sf) => /田|菜地|果园|茶山|打谷场|牛棚|猪圈|鸡舍|碾房|苗圃|药圃|桑|圃/.test(sf)
    || tail(sf, '地|棚|圈|茶') || r.region === 'farmland',
    'high', '后缀含 田/菜地/果园/茶山/打谷场/牛棚/碾房/药圃，或尾部为 地·棚·圈·茶，或 region=farmland'],
  ['market', (r, sf) => /市|铺|摊|坊|栈|楼|馆|仓|窑场|赌坊|当铺|粮仓|货栈|行/.test(sf) || tail(sf, '场')
    || r.region === 'market' || /(_tavern|_inn|_wine|_shop)/.test(r.id),
    'high', '后缀含 市/铺/摊/坊/栈/楼/馆/仓/行，或尾部为「场」，或 region=market，或 id 含 tavern/inn/wine/shop'],
  ['forest', (r, sf) => /松林|竹林|桃林|密林|树林|林间道|森/.test(sf) || tail(sf, '林|竹'),
    'high', '后缀为 松林/竹林/桃林/密林/树林/林间道，或尾部为 林·竹'],
  ['mountain', (r, sf) => /山门|石阶|半山亭|崖边路|山道|山脚|后山|山泉|峰|顶|崖|坪|坡|岭|壑|幢|阵|石堆/.test(sf)
    || tail(sf, '山|谷|岩|岗'),
    'high', '后缀含 山门/石阶/半山亭/崖边路/峰/顶/崖/坪/坡/岭/幢/阵，或尾部为 山·谷·岩·岗'],
  ['street', (r, sf) => /街|巷|道|路|衢|径|弄|驿|城外/.test(sf) || tail(sf, '口|关|门|台'),
    'high', '后缀含 街/巷/道/路/衢/径/驿/城外，或尾部为 口·关·门·台（城门/村口/井台）'],
  ['wild', (r, sf) => /戈壁|沙漠|草原|沼泽|荒|雪|原|漠|遗迹|瘴|沼/.test(sf) || /^(beijiang|xiyu|many|jinguo)$/.test(r.region || ''),
    'low', '后缀含 戈壁/沙漠/草原/沼泽/荒/雪/遗迹/瘴，或 region 属 塞外·西域·蛮荒·金国'],
  ['home', (r, sf) => /^hm_/.test(r.id) || /宅|府|家|屋|斋|轩|庐|舍|庄|第|邸|寨|坞|园/.test(sf) || tail(sf, '院'),
    'high', 'id 前缀 hm_（=「某某的家」），或后缀含 宅/府/家/屋/斋/轩/庄/寨/坞/园，或尾部为「院」'],
  ['court', (r) => /^(yamen|palace)$/.test(r.region || ''),
    'low', 'region 为 yamen 或 palace'],
  ['hall', (r, sf) => /殿|厅|堂|阁|房|轩|斋|庐|所|局/.test(sf),
    'low', '兜底：后缀为 殿/厅/堂/阁/房/轩/斋/所/局（室内公共空间）'],
];

function classifyRoom(room) {
  const sf = suffixOf(room.name), nm = String(room.name || '');
  for (const [type, fn, conf, why] of PLACE_RULES) {
    let ok = false;
    try { ok = fn(room, sf, nm); } catch (e) { ok = false; }
    if (ok) return { type, why, conf };
  }
  return { type: 'unknown', why: '无任何规则命中 —— 不猜，标无法判定', conf: 'none' };
}

/* ------------------------------------------------------------------ *
 * 二、禁用词表（场所 × 词域）
 *
 * 形式：[词, 词域, 允许出现的场所类型]
 * 判定：NPC 所在房间的类型 ∉ 允许表 → 命中即红。
 * 选词原则：只收**只可能存在于某一类场所**的实物/行当名词，
 *          宁可少收（漏报可补），不可乱收（误报会让人不信这台量具）。
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * 二·五、场所**细类** × 物象：允许表 + 冲突矩阵
 *   （2026-10-18 team-lead 裁定：判据太粗，会误杀「铁匠打锄头」「山门有石壁」）
 *
 *   为什么要细类：`PLACE_RULES` 只分到 market/mountain 这一级。
 *   铁匠铺与茶馆同属 market —— 用类型判「锄头属农事 ⇒ 不该在 market」必红，
 *   但铁匠铺打锄头是**它的生意本身**。
 *   ⇒ 先判房间细类（smithy/teahouse/…），再问「这东西属不属于这行的主营/主景」：
 *      · 属于 ⇒ 放行（KIND_ALLOW）
 *      · 明确冲突 ⇒ 判红（CONFLICT：这是矩阵，不是一刀切分类）
 *      · 都不是 ⇒ 回落到原类型判据（LEXICON 的允许类型表）
 *   守的方向：**看这间房是干什么的，而不是看词属于哪一类。**
 * ------------------------------------------------------------------ */
const ROOM_KIND_RULES = [
  ['smithy', /铁匠|铁铺|打铁|铁砧|炉火|风箱|铁炉/],
  ['pharmacy', /药铺|药堂|药局|药庐|医馆|药材|郎中|药柜/],
  ['teahouse', /茶馆|茶楼|茶棚|茶摊|茶寮|茶肆/],
  ['wharf', /码头|渡口|船坞|津口|埠头|泊船/],
  ['boudoir', /闺房|闺阁|卧房|内室|绣楼|妆台|妾室/],
  ['mountain', /山门|后山|山道|山径|山腰|石阶|崖|峰|岭/],
];
function roomKind(room) {
  const hay = String((room && room.name) || '') + ' ' + String((room && room.desc) || '');
  for (const [k, re] of ROOM_KIND_RULES) if (re.test(hay)) return k;
  return '';
}
/* 允许表：这一行本来就该出现的东西（按 team-lead 点名的几组，另补同类） */
const KIND_ALLOW = {
  smithy: ['锄头', '铁料', '炉火', '淬水', '铁砧', '风箱', '炭', '农具', '犁', '镰', '锤'],
  mountain: ['石壁', '石阶', '岩', '崖', '峭壁', '青苔', '栈道'],
  pharmacy: ['药材', '秤', '药碾', '方子', '药柜', '药'],
  teahouse: ['壶', '茶', '座', '茶客', '堂倌', '桌'],
  wharf: ['缆', '潮', '船', '纤', '码头', '水'],
  boudoir: ['妆', '镜', '脂粉', '绣'],
};
/* 冲突矩阵：[词, 与哪些细类冲突]。只在「这行压根不碰这东西」时登记。 */
const KIND_CONFLICT = [
  ['锄头', ['teahouse', 'boudoir', 'temple', 'brothel']],
  ['石壁', ['boudoir', 'teahouse', 'market', 'brothel']],
];
const kindAllows = (kind, w) => !!(kind && KIND_ALLOW[kind] && KIND_ALLOW[kind].indexOf(w) >= 0);
const kindConflicts = (kind, w) => KIND_CONFLICT.some(([word, kinds]) => word === w && kinds.indexOf(kind) >= 0);

const LEXICON = [
  /* —— 词域：买卖行当 —— */
  ['铺子', '买卖行当', ['market', 'street']],
  ['摊位', '买卖行当', ['market', 'street', 'water']],
  ['摊子', '买卖行当', ['market', 'street', 'water']],
  /* 街边摊位也有柜台：书贩在长街上趴柜台补版，不是错置。
     再加上「铺面信号」（team-lead 裁定 低置信 #5）：房间名/desc 里写了 柜/铺/店/药/货架
     就说明这间房本身就是铺面 —— 回春堂的 desc 自己写着「柜台后坐着位白发老郎中」。 */
  ['柜台', '买卖行当', ['market', 'street'], '铺面信号才放行'],
  ['货架', '买卖行当', ['market']],
  ['掌柜', '买卖行当', ['market']],
  ['伙计', '买卖行当', ['market']],
  ['跑堂', '买卖行当', ['market']],
  ['店家', '买卖行当', ['market', 'street']],
  ['小二', '买卖行当', ['market']],
  ['客栈', '买卖行当', ['market', 'street', 'mountain', 'forest', 'wild', 'home', 'temple', 'court']],
  ['酒楼', '买卖行当', ['market', 'street', 'home', 'court']],
  ['酒肆', '买卖行当', ['market', 'street']],
  ['茶馆', '买卖行当', ['market', 'street']],
  ['开张', '买卖行当', ['market', 'street']],
  ['吆喝', '买卖行当', ['market', 'street']],
  /* 秤：加了**比喻豁免**（team-lead 裁定 低置信 #6）。
     「读书不为功名，为的是心里那杆秤。秤准了，人就不歪」—— 秤是比喻，不是商铺的秤。
     ⇒ 第 5 位 `needCo`：**必须与买卖词同现才判红**，没有买卖语境就当比喻放过。
        守的是「看上下文不看关键词」这个方向。 */
  ['秤', '买卖行当', ['market', 'street'], null, /价钱|银子|斤两|买卖|生意|称/],
  ['讨价还价', '买卖行当', ['market']],
  ['讲价', '买卖行当', ['market']],
  /* 幌子挂在自家门口是门面不是买卖 → 挂条件（team-lead 裁定）
     低置信 #3 再放宽一档：货郎的幌子是他吃饭的家什，走**商贩职业族**
     （读已有的 tag=vendor / title=货郎，不是补不确定的 sect —— 见 isMerchantFolk 注释） */
  ['幌子', '买卖行当', ['market', 'street'], '本门门面或商贩'],
  ['货郎', '买卖行当', ['market', 'street']],
  ['赊账', '买卖行当', ['market']],
  /* 客官：行商的本色称呼。低置信 #2/#4 裁定 —— 行商站在塞外路上、唐门前厅
     招呼「客官」都合理 ⇒ 加「商贩才放行」（本色词跟身份走，不跟地点走）。
     ⚠️ 只认 tag/title，不认 name。 */
  ['客官', '买卖行当', ['market', 'street', 'brothel'], '商贩才放行'],
  /* —— 词域：街巷 —— */
  /* ⚠️ team-lead 裁定（P0-2b ①）：临街的宅子瞟见街是合理的，不能一律判红；
     但也不能让"深宅里谈街上"混过去。
     ⇒ 做法：`街上/街道/街口/长街` 这类词**按房间放行** —— 只有房间 name 或
       exits 里含「街/巷/道」时才算临街，否则仍红。实现见 `placeAllowsWord()`。 */
  ['街上', '街巷', ['street', 'market'], '临街市才放行'],
  ['街道', '街巷', ['street', 'market'], '临街市才放行'],
  ['街口', '街巷', ['street', 'market'], '临街市才放行'],
  ['长街', '街巷', ['street', 'market'], '临街市才放行'],
  /* ⚠️ 下面这三个重复条目**必须删掉**：同一个词在词表里出现两次，
     第二次那条没有条件标记，会把「临街市才放行」刚放过去的又判回来
     —— 实测江口码头说「街口」因此洗不白。 */
  /* —— 词域：佛道 —— */
  ['菩萨', '佛道', ['temple', 'mountain']],
  ['香火', '佛道', ['temple', 'mountain']],
  ['和尚', '佛道', ['temple', 'mountain']],
  ['僧人', '佛道', ['temple', 'mountain']],
  ['道士', '佛道', ['temple', 'mountain']],
  ['道长', '佛道', ['temple', 'mountain']],
  ['尼姑', '佛道', ['temple', 'mountain']],
  ['诵经', '佛道', ['temple', 'mountain']],
  ['木鱼', '佛道', ['temple', 'mountain']],
  ['剃度', '佛道', ['temple', 'mountain']],
  ['袈裟', '佛道', ['temple', 'mountain']],
  ['念珠', '佛道', ['temple', 'mountain']],
  ['佛珠', '佛道', ['temple', 'mountain']],
  ['沙弥', '佛道', ['temple', 'mountain']],
  ['施主', '佛道', ['temple', 'mountain']],
  ['方丈', '佛道', ['temple', 'mountain']],
  ['香客', '佛道', ['temple', 'mountain']],
  ['三清', '佛道', ['temple', 'mountain']],
  ['真武', '佛道', ['temple', 'mountain']],
  ['罗汉', '佛道', ['temple', 'mountain']],
  ['斋饭', '佛道', ['temple', 'mountain']],
  ['阿弥陀佛', '佛道', ['temple', 'mountain']],
  /* —— 词域：内宅 —— */
  ['内宅', '内宅', ['home']],
  ['卧房', '内宅', ['home']],
  ['上房', '内宅', ['home']],
  ['正房', '内宅', ['home']],
  ['厢房', '内宅', ['home', 'court']],
  /* 庙观和殿堂也有里屋（禅房、后堂）：乞丐在破庙把功德箱抱进里屋数钱，不是错置 */
  /* 临街的铺子也有里屋：书贩在长街上说「新到的书在里屋」不是错置 */
  ['里屋', '内宅', ['home', 'temple', 'hall'], '临街市才放行'],
  ['天井', '内宅', ['home']],
  ['内院', '内宅', ['home']],
  ['家眷', '内宅', ['home', 'court']],
  ['丫鬟', '内宅', ['home', 'court']],
  ['婆娘', '内宅', ['home', 'street', 'market', 'farm']],
  /* —— 词域：牢狱 —— */
  ['牢房', '牢狱', ['prison']],
  ['大牢', '牢狱', ['prison']],
  ['天牢', '牢狱', ['prison']],
  ['坐牢', '牢狱', ['prison']],
  ['铁链', '牢狱', ['prison']],
  ['镣铐', '牢狱', ['prison']],
  ['狱卒', '牢狱', ['prison']],
  ['死囚', '牢狱', ['prison', 'court']],
  ['枷锁', '牢狱', ['prison', 'court']],
  ['夹棍', '牢狱', ['prison', 'court']],
  ['拶指', '牢狱', ['prison', 'court']],
  /* —— 词域：青楼 —— */
  ['老鸨', '青楼', ['brothel']],
  ['鸨母', '青楼', ['brothel']],
  ['妓院', '青楼', ['brothel']],
  ['姐儿', '青楼', ['brothel']],
  ['梳拢', '青楼', ['brothel']],
  ['接客', '青楼', ['brothel']],
  ['恩客', '青楼', ['brothel']],
  ['红倌', '青楼', ['brothel']],
  ['脂粉', '青楼', ['brothel']],
  ['赎身', '青楼', ['brothel']],
  /* —— 词域：船水 —— */
  /* ⚠️ 船水词一律挂「水边才放行」：漕帮/码头住家说橹撑船是本分，
     只有房间名、房间描述、本人描述**三处都没水信号**时才判红。 */
  ['渔船', '船水', ['water'], '水边或水上门派或船家'],
  ['渡船', '船水', ['water'], '水边或水上门派或船家'],
  ['船家', '船水', ['water'], '水边或水上门派或船家'],
  ['艄公', '船水', ['water'], '水边或水上门派或船家'],
  ['撑船', '船水', ['water'], '水边或水上门派或船家'],
  ['摇橹', '船水', ['water'], '水边或水上门派或船家'],
  ['船舱', '船水', ['water'], '水边或水上门派或船家'],
  ['跳板', '船水', ['water', 'market'], '水边才放行'],
  ['缆绳', '船水', ['water'], '水边或水上门派或船家'],
  ['桅杆', '船水', ['water'], '水边或水上门派或船家'],
  ['水手', '船水', ['water'], '水边或水上门派或船家'],
  ['摆渡', '船水', ['water'], '水边或水上门派或船家'],
  ['橹', '船水', ['water'], '水边或水上门派或船家'],
  /* —— 词域：农事 —— */
  /* ⚠️ 农事词一律挂「村野才放行」：村口/乡道/田埂被分到 `street` 类，
     但那里的农夫扛锄头、说谷子是天经地义 —— 不分青红皂白禁掉就是误判。 */
  ['庄稼', '农事', ['farm'], '村野才放行'],
  ['稻子', '农事', ['farm'], '村野才放行'],
  ['秧苗', '农事', ['farm'], '村野才放行'],
  ['锄头', '农事', ['farm'], '村野才放行'],
  /* 山野物象（2026-10-18 补）：只收「石壁」——它是明确的场所特征。
     ⚠️ 石阶**不收**：墓前/庙前/府门前都有石阶，收进来立刻误伤
     `yang_guo@gumu_mu`「坐在墓前的石阶上」（实测，已撤）。 */
  ['石壁', '山野物象', ['mountain', 'cave'], '山野/洞窟才放行'],
  ['耕地', '农事', ['farm'], '村野才放行'],
  ['牛棚', '农事', ['farm'], '村野才放行'],
  ['猪圈', '农事', ['farm'], '村野才放行'],
  ['鸡舍', '农事', ['farm'], '村野才放行'],
  ['碾房', '农事', ['farm'], '村野才放行'],
  ['麦子', '农事', ['farm'], '村野才放行'],
  ['谷子', '农事', ['farm'], '村野才放行'],
  ['菜地', '农事', ['farm'], '村野才放行'],
  ['果园', '农事', ['farm'], '村野才放行'],
  ['佃户', '农事', ['farm'], '村野才放行'],
  ['秋收', '农事', ['farm'], '村野才放行'],
  ['年成', '农事', ['farm'], '村野才放行'],
  ['稻草人', '农事', ['farm'], '村野才放行'],
  /* —— 词域：武场 —— */
  ['木人桩', '武场', ['martial']],
  ['兵器架', '武场', ['martial', 'hall']],
  ['梅花桩', '武场', ['martial']],
  ['沙袋', '武场', ['martial']],
  ['石锁', '武场', ['martial']],
  /* —— 词域：官署 —— */
  ['衙役', '官署', ['court', 'prison', 'street']],
  ['公堂', '官署', ['court']],
  ['师爷', '官署', ['court']],
  ['奏折', '官署', ['court']],
  ['朱批', '官署', ['court']],
  ['圣旨', '官署', ['court']],
  ['太监', '官署', ['court']],
  ['禁军', '官署', ['court']],
  ['宫女', '官署', ['court']],
  ['知县', '官署', ['court']],
  ['水火棍', '官署', ['court', 'prison']],
  ['登闻鼓', '官署', ['court']],
  /* —— 词域：洞窟 —— */
  ['石壁', '洞窟', ['cave']],
  ['岩壁', '洞窟', ['cave', 'mountain']],
  ['洞壁', '洞窟', ['cave']],
  ['钟乳', '洞窟', ['cave']],
  ['石棺', '洞窟', ['cave']],
  ['墓门', '洞窟', ['cave']],
  ['甬道', '洞窟', ['cave']],
  /* —— 词域：荒野 —— */
  ['瘴气', '荒野', ['wild']],
  ['戈壁', '荒野', ['wild']],
  ['沙漠', '荒野', ['wild']],
  ['驼铃', '荒野', ['wild']],
];

/* ------------------------------------------------------------------ *
 * 门派 → 宗教（team-lead 拍的表，依据金庸原著设定）
 *   佛门：少林、恒山、峨眉、大理段氏（天龙寺系）
 *   道家：武当、全真、昆仑、青城
 *   无  ：其余全部（含华山、嵩山、泰山、衡山、日月神教、丐帮、古墓、
 *         桃花岛、唐门、苗疆、星宿、血刀、侠客岛…）
 *
 * ⚠️ 键名是**数据里的真键**（取自 41_sect_entry.json 的 43 个门派键），不是我按
 *   中文名猜的：`衡山`= hengshan（南岳，武林世家 → 无档），
 *   `恒山`= hengshanN（北岳，尼姑庵 → 佛门档），两个在数据里是分开的键。
 *   `全真`(quanzhen) 在这份数据里**查无此键**（grep 全库无果），写进来只为口径
 *   完整，命中不到任何 NPC。
 * ------------------------------------------------------------------ */
const SECT_FAITH = {
  shaolin: 'buddhist', hengshanN: 'buddhist', emei: 'buddhist', dali: 'buddhist',
  /* ⚠️ luohan（罗汉门）是 team-lead 补进来的：这家**名字就叫「罗汉」**，掌门 desc 里
     也写着罗汉 —— 判红等于不许它提自家门名，那是量具逼着内容自相矛盾，是量具的错。
     气质上也对：罗汉门的设定就是沾少林的边、门主不否认只说拳是真的。 */
  luohan: 'buddhist',
  wudang: 'taoist', kunlun: 'taoist', qingcheng: 'taoist', quanzhen: 'taoist',
};

/** 水上门派：船水词是它们的**本色**，跟着身份走、不跟着地点走（与宗教词同一套逻辑） */
const WATER_SECTS = new Set(['huanghe', 'taihu', 'poyang', 'jujing']);
/** 船家职业族（team-lead 裁定 D-6）：本色词不该只认门派，也该认职业。
 *  撑船的人站在城门口提橹，是合理的 —— 与宗教词同一条道理：跟着身份走，不跟着地点走。
 *  ⚠️ 只认 tag / title，**不认 name**：名字里带「船」的未必是船家，认名字会一放全放。 */
const BOAT_TAGS = new Set(['boatman', 'fisherman', 'ferryman', 'sailor', 'boat', 'water']);
const BOAT_TITLE_RE = /船|渔|渡|舟|桨|橹/;
function isBoatFolk(n) {
  if (!n) return false;
  if (BOAT_TAGS.has(String(n.tag || ''))) return true;
  return BOAT_TITLE_RE.test(String(n.title || '')) || BOAT_TITLE_RE.test(String(n.tag || ''));
}

/** 商贩职业族（team-lead 裁定 低置信 #2/#4/#3）：
 *  与 D-6 船家同一套逻辑 —— **本色词跟身份走，不跟地点走**。
 *  行商在塞外路上、在唐门前厅招呼「客官」都合理；货郎的幌子是他吃饭的家什。
 *  ⚠️ 只认 tag / title，**不认 name** —— D-6 那次的教训：认名字会一放全放。
 *  ⚠️ 与 D-7 的区别说死：D-7 被否的是**补** `sect:'xiake'`（**断言**一个我们不确定的
 *    门派身份）；这里是**读**一个已存在的确定字段（tag=vendor / title=货郎）。
 *    **读 ≠ 断言**。且 D-6 已立 tag=boatman 的先例，vendor 是同一族，不是特例。 */
const MERCHANT_TAGS = new Set(['merchant', 'vendor', 'shopkeeper', 'peddler', 'trader', 'innkeeper']);
const MERCHANT_TITLE_RE = /行商|货郎|商贩|摊贩|小贩|掌柜|买卖人/;
function isMerchantFolk(n) {
  if (!n) return false;
  if (MERCHANT_TAGS.has(String(n.tag || ''))) return true;
  return MERCHANT_TITLE_RE.test(String(n.title || '')) || MERCHANT_TITLE_RE.test(String(n.tag || ''));
}

/** 铺面信号（team-lead 裁定 低置信 #5）：柜台在**铺子里**是本分，在厅堂里才是错置。
 *  ⚠️ 词表要收窄：药铺、书店、绸缎庄都该放行，但「书房里有书架」不该放行 ——
 *     所以**不放裸的「架」**，只放「货架」这个词，书架就落不进来。 */
const SHOPFRONT_SIG = /柜|铺|店|药|货架/;
/** 佛道词各自的归属；both = 佛道两家都用（香火、香客） */
const WORD_FAITH = {
  菩萨: 'buddhist', 和尚: 'buddhist', 僧人: 'buddhist', 尼姑: 'buddhist',
  诵经: 'buddhist', 木鱼: 'buddhist', 剃度: 'buddhist', 袈裟: 'buddhist',
  念珠: 'buddhist', 佛珠: 'buddhist', 沙弥: 'buddhist', 施主: 'buddhist',
  方丈: 'buddhist', 罗汉: 'buddhist', 斋饭: 'buddhist', 阿弥陀佛: 'buddhist',
  道士: 'taoist', 道长: 'taoist', 三清: 'taoist', 真武: 'taoist',
  香火: 'both', 香客: 'both',
};

/** 取 NPC 所属门派键：先看 n.sect，没有就从房间 **id** 前缀推（hengshanN_library → hengshanN）
 *  ⚠️ 用房间 id 而不是 NPC 的 `room` 键名：两者在真实数据里恰好相同，但键名是索引、
 *     id 才是身份 —— 一旦有人改了索引写法，用键名就会整个推不出来。 */
function sectOf(n, room) {
  if (n && n.sect) return n.sect;
  const rid = (room && room.id) || (n && n.room) || '';
  return String(rid).split('_')[0];
}
/** 房间所属门派键（房间 id 前缀） */
function roomSectOf(room) {
  return String((room && room.id) || '').split('_')[0];
}
function sectFaithOf(n, room) {
  return SECT_FAITH[sectOf(n, room)] || null;
}

/** 逐类导出「禁用词」（= 允许表不含该类的词），供报告打印 */
function bannedWordsOf(type) {
  return LEXICON.filter(([, , ok]) => ok.indexOf(type) < 0).map(([w, dom]) => w);
}

/**
 * 有些词**按房间**放行，不只按场所类型（team-lead 裁定 ①）。
 * 判据：房间 name 或 exits 指向的房间名里含「街/巷/道」 ⇒ 这间房临街。
 */
const WATER_SIG = /码头|渡|港|埠|船|漕|纤|桥|湾|滩|橹|桨|帆|水/;
/** 行程类动作字段：讲的是「这一趟去哪儿」，按目的地判不按所在地判 */
const isTripField = f => /^portrait\.routine\[\d+\]\.act$/.test(String(f || ''));
/** 行程标记：没有这些字，说明不是「去某地」，而是「在某地做事」 */
const TRIP_RE = /去|到|往|赶|回|进|走一趟|上一趟/;
const VILLAGE_SIG = /村|乡|田|野|庄|寨|屯|堡|埂|坡|圩/;

function placeAllowsWord(room, rule, rooms, npc) {
  const cond = rule[3];
  if (!cond) return false;
  const nm = String(room && room.name || '');
  const rdesc = String(room && room.desc || '');
  const ndesc = String(npc && npc.desc || '');

  /* ① 临街（team-lead 裁定 P0-2b ①）：房间 name 或**出口房间的名字**里含「街/巷/道」 */
  if (cond === '临街才放行') return isStreetFacing(room, rooms);

  /* ② 临街市：码头/港口/渡口/集市本来就有街面，比「临街」再宽一档。
        判据是房间名里带 码头|港|渡|埠|市|集 —— 只认名字，不认出口，避免越放越宽。 */
  if (cond === '临街市才放行') {
    return isStreetFacing(room, rooms) || /码头|港|渡|埠|市|集/.test(nm);
  }

  /* ③ 村野：**村口/乡道不是城里长街**。农夫扛着锄头站在村口说谷子，
        是天经地义的内容；按 `街道` 一律禁农事会把它误判成错置。
        判据：房间名含 村|乡|田|野|庄|寨|屯|堡|坡|埂。 */
  if (cond === '村野才放行') return VILLAGE_SIG.test(nm);

  /* ④ 水边：船水词（橹/撑船/摆渡…）不该只在水上房间才允许 ——
        码头边的宅子、漕帮的山门，屋里放着橹是本分。
        判据：房间名 / 房间描述 / NPC 自身描述里出现水信号。
        ⚠️ NPC 自身描述参与判定是有意的：黄河帮人在自家山门说「撑船拉纤」，
        他的 desc 会写明他是船帮的人，这时候判红就是把对的改错。 */
  if (cond === '水边才放行') {
    /* ⚠️ 信号里**不放裸的「江/河/湖/溪」**：江南城、姑苏城这些地名带「江」，
       一放进信号，城里车马行说橹也会被放行，等于把真错置洗白。 */
    const sig = WATER_SIG;
    return sig.test(nm) || sig.test(rdesc) || sig.test(ndesc);
  }

  /* ⑤ 水边**或**水上门派（team-lead 裁定）：船水词对黄河帮/太湖帮/鄱阳帮/巨鲸帮
     **在任何场所**放行 —— 本色词跟着身份走，不跟着地点走（与宗教词同一套逻辑）。
     ⚠️ 两条是**或**不是替换：只留「水上门派」会把码头住家（橹把磨得发亮）又判回红。 */
  if (cond === '水边或水上门派或船家') {
    if (WATER_SECTS.has(sectOf(npc, room))) return true;
    if (isBoatFolk(npc)) return true;
    const sig = WATER_SIG;
    return sig.test(nm) || sig.test(rdesc) || sig.test(ndesc);
  }

  /* ⑥b 商贩职业族（team-lead 裁定 低置信 #2/#4）：客官是行商的本色称呼，
     行商站在哪儿都能招呼客人 —— 跟 D-6 船家同一条：**本色词跟身份走，不跟地点走**。 */
  if (cond === '商贩才放行') return isMerchantFolk(npc);

  /* ⑥c 铺面信号（team-lead 裁定 低置信 #5）：柜台在**铺子里**是本分。
     判据：房间名或房间描述里出现 柜/铺/店/药/货架。
     ⚠️ 不放裸的「架」，否则「书房里有书架」也会被放行（团队长特意点名的坑）。 */
  if (cond === '铺面信号才放行') return SHOPFRONT_SIG.test(nm) || SHOPFRONT_SIG.test(rdesc);

  /* ⑥ 本门门面**或**商贩（team-lead 裁定 低置信 #3 放宽）：
     幌子要么挂在自家门口（门面），要么就是货郎吃饭的家什（职业）。 */
  if (cond === '本门门面或商贩') {
    if (isMerchantFolk(npc)) return true;
    /* ⚠️ 必须认**显式写出来的** n.sect：sectOf 对没写 sect 的人会退化成房间 id 前缀，
       于是「NPC门派 == 房间门派」永远成立 ⇒ 这一档变成无条件放行，幌子在哪儿都过。
       （D-7 就是因为这条才判的「维持无法判定」—— 不为让量具变绿去补不确定的字段。） */
    const ns = npc && npc.sect;
    if (!ns) return false;
    const rs = roomSectOf(room);
    return !!rs && rs === ns;
  }
  if (cond === '本门门面才放行') {
    /* ⚠️ 必须认**显式写出来的** n.sect：sectOf 对没写 sect 的人会退化成房间 id 前缀，
       于是「NPC门派 == 房间门派」永远成立 ⇒ 这一档变成无条件放行，幌子在哪儿都过。 */
    const ns = npc && npc.sect;
    if (!ns) return false;
    const rs = roomSectOf(room);
    return !!rs && rs === ns;
  }
  return false;
}

/** 房间是否临街：自己名字里带「街/巷/道」，或任一出口通向名字带这些字的房间 */
function isStreetFacing(room, rooms) {
  if (/街|巷|道/.test(String(room && room.name || ''))) return true;
  const ex = room && room.exits;
  if (ex && typeof ex === 'object') {
    for (const k of Object.keys(ex)) {
      const v = ex[k];
      const to = typeof v === 'string' ? v : (v && v.to);
      if (!to) continue;
      /* ⚠️ 出口存的是房间 **id**（luoyang_mudan_lane），中文的「巷」在目标房间的
         **名字**里 —— 拿 id 去匹配「街/巷/道」永远匹配不上，于是 4 间真临街的宅子
         全被当成深宅。必须过一层 rooms 把名字取出来。 */
      const target = rooms && rooms[to];
      if (target && /街|巷|道/.test(String(target.name || ''))) return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 三、取 NPC 的玩家可见文本
 * ------------------------------------------------------------------ */

/**
 * 取 NPC 的玩家可见文本，并标注**语境**：
 *   'say' = 他在**此刻此地**说/做的事 —— desc、talk、ask.answer、askDefault、
 *           voice.catchphrase、routine.act。N1 只扫这一类。
 *   'bio' = 旁白替他交代的来历（portrait.role/now/want/fear）。
 *           ⚠️ 这一类**不进 N1**：身世本来就合法地提及别处
 *           （「支摊子开局」的出身写在山门守卫身上不算场景错），
 *           实测把它们算进来会造出成片误报（10 条「山门 × 摊子」全是克隆画像字段）。
 */
function npcTexts(n) {
  const out = [];
  const push = (field, t, scope) => { if (t && typeof t === 'string' && t.trim()) out.push({ field, text: t, scope }); };
  push('desc', n.desc, 'say');
  /* ⚠️ 库里有 NPC 的 talk/ask 是对象而非数组（历史脏数据），一律当数组兜底，
     否则整台守卫会在第一个脏数据上崩掉 —— 崩掉 = 静默放过全库 */
  const asArr = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : (v ? [v] : []));
  asArr(n.talk).forEach((t, i) => push('talk[' + i + ']', t, 'say'));
  asArr(n.ask).forEach((a, i) => push('ask[' + i + '].answer', a && a.answer, 'say'));
  push('askDefault', n.askDefault, 'say');
  const p = n.portrait;
  if (p && typeof p === 'object') {
    push('portrait.role', p.role, 'bio');
    push('portrait.now', p.now, 'bio');
    push('portrait.want', p.want, 'bio');
    push('portrait.fear', p.fear, 'bio');
    if (p.voice) push('portrait.voice.catchphrase', p.voice.catchphrase, 'say');
    const asArr2 = v => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
    asArr2(p.routine).forEach((r, i) => push('portrait.routine[' + i + '].act', r && r.act, 'say'));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 四、N2 辅助：分组 / 独有名词
 * ------------------------------------------------------------------ */

/** id 族：去掉尾部数字与「_序号」 */
function idFamily(id) {
  return String(id).replace(/[_-]?\d+$/, '');
}
/** 三个分组轴（无 group 字段，按 tag / sect / id 前缀族归组） */
function groupsOf(n) {
  const fam = idFamily(n.id);
  return {
    A职业族: n.tag || n.job || ('id:' + fam),
    B门派: n.sect || '-',
    C族内id: fam,
    D职业族门派: (n.tag || n.job || '-') + '@' + (n.sect || '-'),
  };
}

/* 通用词：不算「该 NPC 独有的名词」（design §E.3 点名：钱 / 家人 / 门派 / 太平） */
const GENERIC_NOUNS = new Set([
  '钱', '银子', '铜钱', '文银', '家人', '家里', '家', '门派', '太平', '日子', '功夫', '本事',
  '师父', '师兄', '师弟', '师姐', '师妹', '徒弟', '江湖', '天下', '人心', '时候', '事情',
  '地方', '名字', '手里', '心里', '头上', '身上', '脸上', '眼里', '嘴上', '手上', '脚下',
  '今年', '明年', '去年', '今日', '明日', '从前', '以后', '现在', '从前', '一辈子', '半生',
  '孩子', '老人', '婆娘', '汉子', '后生', '姑娘', '小子', '兄弟', '朋友', '仇人', '对头',
  '银两', '盘缠', '饭', '酒', '水', '米', '柴', '衣', '屋', '路', '山', '水', '门', '刀', '剑',
]);
/**
 * 独有名词判定（不用分词器，因为库里没有，也不许我现编一个）。
 *
 * 第一版我用的是「二字滑窗」（2-gram），实测会造出「天摊」这种跨词垃圾
 * （来自「这几天摊前的路被挖开了」）—— 证据看着就不可信，所以作废。
 *
 * 换成一条**可精确复算**的口径：
 *   独有句 = 该 NPC 的 now/want/fear 里，有某一句在**其他所有 NPC 的
 *            now/want/fear 中出现 0 次**，且该句剥掉通用词后仍剩 ≥4 个汉字
 *           （否则「想多挣点钱」这种只剩通用词的句子不算"独有"）。
 * 三条一句都不独有 → 判红。
 */
const GENERIC_WORDS_RE = /(钱|银子|铜钱|盘缠|家人|家里|门派|太平|日子|功夫|本事|师父|师兄|师弟|徒弟|江湖|天下|人心|地方|事情|时候|孩子|老人|婆娘|汉子|姑娘|兄弟|朋友|仇人|饭|酒|水|米|柴|衣|屋|路|山|门|刀|剑)/g;

function portraitSentences(text) {
  return String(text || '')
    .split(/[。！？；;\n]+/)
    .map(x => x.trim()).filter(Boolean);
}

/**
 * 该 NPC 有没有「独有句」：返回 {unique, sent, others}
 * ⚠️ 必须按**下标**排除自己，不能按值排除（`b !== mine`）：
 *    两个画像逐字相同时，值相等会把双胞胎从计数里排除掉，
 *    于是「一模一样的两份画像」反而被判成"独有" —— 自测当场抓到了这个反向 bug。
 */
function uniquePortraitSentence(mine, allBags, myIndex) {
  let best = null;
  for (const s of portraitSentences(mine)) {
    const rest = s.replace(GENERIC_WORDS_RE, '');
    if ((rest.match(/[\u4e00-\u9fa5]/g) || []).length < 4) continue;   // 只剩通用词，不算
    let n = 0;
    for (let j = 0; j < allBags.length; j++) {
      if (j === myIndex) continue;
      if (allBags[j].indexOf(s) >= 0) n++;
    }
    if (n === 0) return { unique: true, sent: s, others: 0 };
    if (!best || n < best.others) best = { unique: false, sent: s, others: n };
  }
  return best || { unique: false, sent: '(画像里没有够格的句子)', others: -1 };
}

/* ------------------------------------------------------------------ *
 * 五、检查主体
 * ------------------------------------------------------------------ */

function scan(world) {
  const npcs = world.data.npcs || {};
  const rooms = world.data.rooms || {};
  const ids = Object.keys(npcs);

  /* ---- 场所分类 ---- */
  const placeOf = {}, placeDist = {}, lowConf = [];
  for (const rid of Object.keys(rooms)) {
    const c = classifyRoom(rooms[rid]);
    placeOf[rid] = c;
    placeDist[c.type] = (placeDist[c.type] || 0) + 1;
    if (c.conf === 'low') lowConf.push(rid);
  }

  /* ---- N1 场景一致 ---- */
  const n1 = [], n1Low = [];
  /* 覆盖缺口（2026-10-18）：N1 遇到 placeType=unknown 的房会 `continue` 静默跳过。
     现在全库 unknown=0，所以没漏；但以后新增房型判不出来时，N1 会「安静地不漏」。
     ⇒ 单独统计「有 NPC 但类型判不出的房」，在汇总里显式打出来（不判红，只提示）。 */
  const n1UnknownRooms = new Set();
  for (const id of ids) {
    const n = npcs[id];
    const rid = n.room;
    const c = rid ? placeOf[rid] : null;
    if (!c || c.type === 'unknown') { if (rid) n1UnknownRooms.add(rid); continue; }   // 判不出类型 → 无法判定，不猜（但记账）
    const room = rooms[rid];
    for (const it of npcTexts(n)) {
      if (it.scope !== 'say') continue;      // 传记字段不进 N1
      const { field, text } = it;
      const hits = [];
      for (const rule of LEXICON) {
        const [w, dom, ok, , needCo] = rule;
        if (text.indexOf(w) < 0) continue;
        /* ⑧ 比喻豁免（team-lead 裁定 低置信 #6）：第 5 位 `needCo` 是「必须与它同现才判红」
           的正则。秤配了买卖词 —— 「心里那杆秤」没有买卖语境，就当比喻放过。
           守的是「看上下文不看关键词」这个方向。 */
        if (needCo && !needCo.test(text)) continue;
        /* ⑨ 场所细类（2026-10-18）：先问「这间房是干什么的」
           —— 铁匠铺打锄头放行、茶馆说锄头判红；山门有石壁放行、闺房说石壁判红。 */
        {
          const k = roomKind(room);
          if (kindAllows(k, w)) continue;
          if (kindConflicts(k, w)) { hits.push({ w, dom, kind: k }); continue; }
        }
        if (dom === '佛道') {
          /* 佛道词不看场所类型，看「门派信仰 + 是否在庙里」两级（team-lead 裁定 ③）：
             ① 本门宗教词 → 任何场所都放行（恒山尼姑在山门口说「施主」是对的）
             ② 非佛道门派 → 只在 `temple` 放行（谁进庙都能提佛）
             ③ 跨门派挂错仍红（桃花岛弟子念「阿弥陀佛」：桃花岛是无档，思过崖也不是庙） */
          if (c.type === 'temple') continue;
          const sf = sectFaithOf(n, room);
          const wf = WORD_FAITH[w] || 'both';
          if (sf && (wf === 'both' || wf === sf)) continue;
          hits.push({ w, dom });
          continue;
        }
        /* ⑦ 行程类动作单独一档（team-lead 裁定）：`portrait.routine[].act` 讲的是
           「这一趟去哪儿」，判据应该是**动作的目的地**，不是「人这会儿站在哪儿」。
           在御道说「去一趟天牢」是对的 —— 目的地确实是牢。
           ⚠️ 只认带行程标记的去/到/往/赶/回/进，免得「在天牢里数人头」也混过去。 */
        if (dom === '牢狱' && isTripField(field) && TRIP_RE.test(text)) continue;
        if (ok.indexOf(c.type) >= 0) continue;
        if (placeAllowsWord(room, rule, rooms, n)) continue;   // 按房间放行的词（临街宅子/村口/水边）
        hits.push({ w, dom });
      }
      if (!hits.length) continue;
      const rec = {
        id, name: n.name, room: rid, roomName: (rooms[rid] || {}).name,
        place: c.type, field, text, hits, conf: c.conf,
      };
      (c.conf === 'low' ? n1Low : n1).push(rec);
    }
  }

  /* ---- N2 身份一致 ---- */
  /* N2a 同组台词复用 > 2 次 */
  const axes = ['A职业族', 'B门派', 'C族内id', 'D职业族门派'];
  const groupMembers = {};   // axis -> gid -> [id]
  for (const id of ids) {
    const g = groupsOf(npcs[id]);
    for (const ax of axes) {
      (groupMembers[ax] = groupMembers[ax] || {});
      (groupMembers[ax][g[ax]] = groupMembers[ax][g[ax]] || []).push(id);
    }
  }
  const n2aByAxis = {}, n2a = [];
  for (const ax of axes) {
    const per = {};
    for (const gid of Object.keys(groupMembers[ax])) {
      const cnt = {};
      for (const id of groupMembers[ax][gid]) {
        for (const t of new Set(npcs[id].talk || [])) {
          (cnt[t] = cnt[t] || []).push(id);
        }
      }
      for (const t of Object.keys(cnt)) {
        if (cnt[t].length > 2) {
          (per[gid] = per[gid] || []).push({ text: t, n: cnt[t].length, ids: cnt[t] });
        }
      }
    }
    n2aByAxis[ax] = per;
    for (const gid of Object.keys(per)) {
      for (const item of per[gid]) {
        n2a.push({ axis: ax, gid, text: item.text, n: item.n, ids: item.ids });
      }
    }
  }
  /* N2b desc 全库出现 > 1 次 */
  const descMap = {};
  for (const id of ids) { const d = npcs[id].desc; if (d) (descMap[d] = descMap[d] || []).push(id); }
  const n2b = [];
  for (const d of Object.keys(descMap)) {
    if (descMap[d].length > 1) n2b.push({ text: d, n: descMap[d].length, ids: descMap[d] });
  }
  /* N2c 画像无独有名词 */
  const portraitBag = [];   // 每个 NPC 的 now/want/fear 合并文本
  const portraitIds = [];
  for (const id of ids) {
    const p = npcs[id].portrait;
    if (!p || typeof p !== 'object') continue;
    const t = [p.now, p.want, p.fear].filter(Boolean).join('；');
    if (!t) continue;
    portraitIds.push(id);
    portraitBag.push(t);
  }
  const n2c = [], n2cPass = [];
  for (let i = 0; i < portraitIds.length; i++) {
    const u = uniquePortraitSentence(portraitBag[i], portraitBag, i);
    const rec = {
      id: portraitIds[i], name: npcs[portraitIds[i]].name,
      term: u.sent, others: u.others, text: portraitBag[i],
    };
    (u.unique ? n2cPass : n2c).push(rec);
  }
  /* 无画像的 NPC —— 数据不全，单列 */
  const noPortrait = ids.filter(id => !npcs[id].portrait);

  /* ---- N3 记忆一致（可降级） ---- */
  const p = world.player || {};
  const promises = p.promises && Object.keys(p.promises).length ? p.promises : null;
  const debtIds = [];
  for (const id of ids) {
    const ps = npcs[id].pstate;
    if (ps && ps.debt) debtIds.push({ id, debt: ps.debt });
  }
  const inst = (world.instances && world.instances.npcs) || {};
  for (const k of Object.keys(inst)) {
    const ps = inst[k] && inst[k].pstate;
    if (ps && ps.debt) debtIds.push({ id: inst[k].defId || k, debt: ps.debt });
  }
  const n3 = [], n3Unknown = [];
  if (!promises && !debtIds.length) {
    /* 全新档：p.promises 未建立、没有任何人情账 → 无法判定，绝不假装通过 */
    for (const id of ids) n3Unknown.push({ id, name: npcs[id].name, why: '无 p.promises 且无人情账（新档无记忆数据）' });
  } else {
    const need = new Set();
    if (promises) for (const k of Object.keys(promises)) need.add(k);
    for (const d of debtIds) need.add(d.id);
    /* 对应台词的判据：至少一条台词/画像文本命中「承诺/人情/账/答应/答应过/还/欠」等记忆锚词 */
    const MEMORY_ANCHOR = /(答应|应过|许过|承诺|说过的话|那件事|那笔|欠|还你|还我|人情|账|记着|记得)/;
    for (const id of need) {
      const n = npcs[id];
      if (!n) { n3Unknown.push({ id, name: '(数据里没有这个 NPC)', why: '承诺/人情账指向的 NPC 不在库中' }); continue; }
      const has = npcTexts(n).some(x => MEMORY_ANCHOR.test(x.text));
      if (!has) n3.push({ id, name: n.name, why: '有未了承诺/人情账，但没有任何一条台词提到它' });
    }
  }

  return {
    npcCount: ids.length, roomCount: Object.keys(rooms).length,
    placeOf, placeDist, lowConf,
    n1, n1Low, n1UnknownRooms, n2a, n2aByAxis, n2b, n2c, n2cPass, noPortrait,
    n3, n3Unknown, promises, debtIds,
  };
}

/* ------------------------------------------------------------------ *
 * 六、自测（注入故障，证明量具真能判红；再跑干净数据证明不误报）
 * ------------------------------------------------------------------ */

function selftest() {
  const out = [];
  const ok = (cond, msg) => { out.push((cond ? '  ✔ ' : '  ✘ ') + msg); return !!cond; };
  let pass = 0, total = 0;
  const T = (cond, msg) => { total++; if (ok(cond, msg)) pass++; };

  /* 构造一个最小世界：只放我们需要的房间和 NPC，然后直接跑扫描逻辑 */
  function mkWorld(rooms, npcs) {
    const e = new GameEngine({ seed: 7, dataDir: path.join(ROOT, 'game', 'data') });
    e.boot(); e.newGame();
    const w = e.world;
    w.data.rooms = rooms; w.data.npcs = npcs;
    if (!w.player) w.player = {};
    return w;
  }

  console.log('='.repeat(60));
  console.log('  归属守卫 · 注入故障自测');
  console.log('='.repeat(60));

  /* ---- 故障 1：NPC 在山洞里谈街道 ---- */
  {
    const rooms = {
      r_cave: { id: 'r_cave', name: '思过崖·后洞', region: 'huashan', desc: '洞口垂着藤蔓，往里几步就没了光。' },
      r_dock: { id: 'r_dock', name: '桃花岛·渡口', region: 'taohuadao', desc: '渡口四周桃林成片。' },
      r_street: { id: 'r_street', name: '江南城·长街', region: 'jiangnan', desc: '两侧店铺林立。' },
    };
    const npcs = {
      bad_cave: { id: 'bad_cave', name: '洞里人', room: 'r_cave', tag: 'hunter', sect: 'huashan',
        desc: '一个蹲在洞口的人。', talk: ['客官赶路么？前头那家铺子，秤准。'] },
      bad_dock: { id: 'bad_dock', name: '撑船的', room: 'r_dock', tag: 'boatman', sect: 'taohua',
        desc: '手里握着橹。', talk: ['本门不是客栈。要进，得有个说法。'] },
      good_street: { id: 'good_street', name: '摊主', room: 'r_street', tag: 'vendor',
        desc: '围裙上全是油点子。', talk: ['客官要点什么？前头那家铺子，秤准。'] },
      good_cave: { id: 'good_cave', name: '采药人', room: 'r_cave', tag: 'hunter', sect: 'huashan',
        desc: '背篓里装着半篓草根。', talk: ['扁担压得肩头疼，歇口气。'] },
    };
    const r = scan(mkWorld(rooms, npcs));
    const hitIds = new Set(r.n1.map(x => x.id));
    T(hitIds.has('bad_cave'), '故障1a 山洞里谈「铺子/秤/客官」→ 判红（N1）');
    T(hitIds.has('bad_dock'), '故障1b 渡口说「客栈」门房话 → 判红（N1）');
    T(!hitIds.has('good_street'), '干净1a 长街摊贩说「铺子/秤/客官」→ 不误报');
    T(!hitIds.has('good_cave'), '干净1b 山洞采药人说自己的话 → 不误报');
  }

  /* ---- 故障 1c：场所细类（铁匠铺/茶馆/山门/闺房 × 锄头/石壁） ---- */
  {
    const rooms = {
      r_smithy: { id: 'r_smithy', name: '江南城·铁匠铺', region: 'jiangnan', desc: '炉火通红，铁砧上火星四溅。' },
      r_tea: { id: 'r_tea', name: '东市·茶馆', region: 'jiangnan', desc: '几张方桌，有人嗑着瓜子。' },
      r_gate: { id: 'r_gate', name: '黑木崖·山门', region: 'mojiao', desc: '崖壁上凿着条只容一人走的栈道。' },
      r_boudoir: { id: 'r_boudoir', name: '某宅·内院', region: 'jiangnan', desc: '妆台上摆着半盒没盖的胭脂。' },  /* 内院→home；妆台→boudoir 细类 */
    };
    const npcs = {
      good_smith: { id: 'good_smith', name: '铁匠', room: 'r_smithy', tag: 'smith', desc: '赤膊，胳膊上全是烫疤。',
        talk: ['今日打的都是锄头，铁料是昨儿到的旧船钉。'] },
      bad_tea: { id: 'bad_tea', name: '茶客', room: 'r_tea', tag: 'vendor', desc: '手里捏着把瓜子。',
        talk: ['昨儿新打了把锄头，趁手。'] },
      good_gate: { id: 'good_gate', name: '教众', room: 'r_gate', tag: 'disciple', sect: 'mojiao', desc: '腰里别着刀。',
        talk: ['石壁上那些字，刻得深。'] },
      bad_boudoir: { id: 'bad_boudoir', name: '侍女', room: 'r_boudoir', tag: 'maid', desc: '手里拿着铜镜。',
        talk: ['石壁上落了灰，我去擦擦。'] },
    };
    const r = scan(mkWorld(rooms, npcs));
    const ids = new Set(r.n1.map((x) => x.id));
    T(!ids.has('good_smith'), '场景1a 铁匠铺说「锄头/铁料」→ 绿（这行的生意本身）');
    T(ids.has('bad_tea'), '场景1b 茶馆说「锄头」→ 红（与主营冲突）');
    T(!ids.has('good_gate'), '场景1c 山门说「石壁」→ 绿（山门主景）');
    T(ids.has('bad_boudoir'), '场景1d 闺房说「石壁」→ 红（与主景冲突）');
  }

  /* ---- 故障 2：同组三人共用同一句 ---- */
  {
    const rooms = { r_hall: { id: 'r_hall', name: '泰山派·演武场', region: 'taishan', desc: '场子里三五个弟子正拆招。' } };
    const npcs = {
      g1: { id: 'g1', name: '甲', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '甲的样子。', talk: ['同一句话。'] },
      g2: { id: 'g2', name: '乙', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '乙的样子。', talk: ['同一句话。'] },
      g3: { id: 'g3', name: '丙', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '丙的样子。', talk: ['同一句话。'] },
      h1: { id: 'h1', name: '丁', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '丁的样子。', talk: ['各说各的甲。'] },
      h2: { id: 'h2', name: '戊', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '戊的样子。', talk: ['各说各的乙。'] },
      h3: { id: 'h3', name: '己', room: 'r_hall', tag: 'disciple', sect: 'taishan', desc: '己的样子。', talk: ['各说各的丙。'] },
    };
    const r = scan(mkWorld(rooms, npcs));
    const dupTexts = r.n2a.map(x => x.text);
    T(dupTexts.indexOf('同一句话。') >= 0, '故障2 同组（同门派+同职业族）3 人共用一句 → 判红（N2a）');
    T(dupTexts.indexOf('各说各的甲。') < 0, '干净2 同组 3 人各说各的 → 不误报');
  }

  /* ---- 故障 3：描述克隆 ---- */
  {
    const rooms = { r_hall: { id: 'r_hall', name: '唐门·前厅', region: 'tangmen', desc: '厅内陈设朴素。' } };
    const npcs = {
      d1: { id: 'd1', name: '甲', room: 'r_hall', tag: 'disciple', sect: 'tangmen', desc: '一模一样的描述。', talk: ['甲的话。'] },
      d2: { id: 'd2', name: '乙', room: 'r_hall', tag: 'disciple', sect: 'tangmen', desc: '一模一样的描述。', talk: ['乙的话。'] },
      d3: { id: 'd3', name: '丙', room: 'r_hall', tag: 'disciple', sect: 'tangmen', desc: '丙自己的描述，帽檐塌了一半。', talk: ['丙的话。'] },
    };
    const r = scan(mkWorld(rooms, npcs));
    T(r.n2b.some(x => x.text === '一模一样的描述。' && x.n === 2), '故障3 两条 desc 全库重复（>1 次）→ 判红（N2b）');
    T(!r.n2b.some(x => x.text === '丙自己的描述，帽檐塌了一半。'), '干净3 独有 desc → 不误报');
  }

  /* ---- 故障 3b：画像无独有句 ---- */
  {
    const rooms = { r_hall: { id: 'r_hall', name: '泰山派·演武场', region: 'taishan', desc: '场子里三五个弟子正拆招。' } };
    const mk = (id, now, want) => ({
      id, name: id, room: 'r_hall', tag: 'disciple', sect: 'taishan',
      desc: '各人的样子' + id + '。', talk: ['各人的话' + id + '。'],
      portrait: { now, want, fear: '怕一场雨把棚子和货一起泡了' },
    });
    const npcs = {
      p1: mk('p1', '这几天摊前的路被挖开了，人过不来。', '让家里最小的那个念上书'),
      p2: mk('p2', '这几天摊前的路被挖开了，人过不来。', '让家里最小的那个念上书'),
      p3: mk('p3', '我把后洞边上那丛好药惦记了三年。', '趁霜降前把那丛川芎挖回来'),
    };
    const r = scan(mkWorld(rooms, npcs));
    T(r.n2c.some(x => x.id === 'p1') && r.n2c.some(x => x.id === 'p2'),
      '故障3b 两人画像 now/want 逐字相同、无独有句 → 判红（N2c）');
    T(r.n2cPass.some(x => x.id === 'p3'), '干净3b 第三人画像有独有句（后洞那丛药）→ 不误报');
  }

  /* ---- 故障 4：N3 记忆一致（数据齐全时才判） ---- */
  {
    const rooms = { r_inn: { id: 'r_inn', name: '江南城·悦来客栈', region: 'jiangnan', desc: '堂里摆着十几张桌子。' } };
    const npcs = {
      m1: { id: 'm1', name: '老掌柜', room: 'r_inn', tag: 'innkeeper', desc: '算盘不离手。', talk: ['客官住店？'] },
    };
    const w = mkWorld(rooms, npcs);
    w.player.promises = { m1: { pay_back: { what: '还他三百文', at: 0 } } };
    const r = scan(w);
    T(r.n3.some(x => x.id === 'm1'), '故障4 玩家有未了承诺、该 NPC 无对应台词 → 判红（N3）');
    /* 干净的：给他加一句带记忆锚词的台词 */
    const w2 = mkWorld(rooms, {
      m1: { id: 'm1', name: '老掌柜', room: 'r_inn', tag: 'innkeeper', desc: '算盘不离手。', talk: ['客官住店？', '你答应过的那笔账，我记着呢。'] },
    });
    w2.player.promises = { m1: { pay_back: { what: '还他三百文', at: 0 } } };
    const r2 = scan(w2);
    T(r2.n3.length === 0, '干净4 该 NPC 有一条对应台词 → 不误报');
    /* 数据不全时必须输出「无法判定」而不是通过 */
    const w3 = mkWorld(rooms, npcs);
    const r3 = scan(w3);
    T(r3.n3.length === 0 && r3.n3Unknown.length === 1, '降级 N3 无记忆数据 → 输出「无法判定」而非假装通过');
  }

  /* ---- 故障 5b′：临街宅子说「街上」不红、深宅说「街上」仍红（team-lead 裁定 ①） ---- */
  {
    const rooms = {
      r_front: { id: 'r_front', name: '洛阳·韩宅', region: 'luoyang', desc: '临街的两进院子。', exits: { n: 'r_lane' } },
      r_lane: { id: 'r_lane', name: '洛阳城·牡丹巷', region: 'luoyang', desc: '一条巷子。', exits: {} },
      r_deep: { id: 'r_deep', name: '洛阳·沈宅', region: 'luoyang', desc: '照壁雕得极精。', exits: { n: 'ly_home_03' } },
    };
    const npcs = {
      a: { id: 'a', name: '临街的', room: 'r_front', tag: 'commoner', desc: '做针线。', talk: ['手上做着活，眼睛却瞟着街上。'] },
      b: { id: 'b', name: '深宅的', room: 'r_deep', tag: 'commoner', desc: '做针线。', talk: ['手上做着活，眼睛却瞟着街上。'] },
    };
    const r = scan(mkWorld(rooms, npcs));
    const redIds = new Set(r.n1.map(x => x.id));
    T(!redIds.has('a'), '故障5b′ 临街宅子（出口通向 luoyang_street）说「街上」→ 不判红');
    T(redIds.has('b'), '故障5b′ 深宅（出口不通街）说「街上」→ 仍判红');
  }

  /* ---- 故障 5c′：合欢宗·山门说「白天不接客」不该红（P0-2a 落地时抓到的误报） ---- */
  {
    const rooms = { h: { id: 'hehuan_gate', name: '合欢宗·山门', region: 'qinglou', desc: '楼子背后的宗家。白日里是弹唱的、陪酒的、写曲子的；夜里换一身衣裳，做的是另一桩买卖。' } };
    const npcs = { hg: { id: 'hg', name: '合欢宗门房', room: 'h', tag: 'shouwei', sect: 'hehuan', desc: '站在门口。', talk: ['「白天不接客。」'] } };
    const r = scan(mkWorld(rooms, npcs));
    T(!r.n1.some(x => x.id === 'hg'), '故障5c′ 合欢宗·山门说「白天不接客」→ 不误报（青楼宗门自家门面）');
    const c = classifyRoom(rooms.h);
    T(c.type === 'brothel', '  「合欢宗·山门」判为 brothel');
  }

  /* ---- 故障 6：按房间放行的三条新口径（村野 / 水边 / 街市）逐条自验 ----
     这三档是「怕误判」才加的，所以每一档都要同时证明：该放的放了、不该放的没放。 */
  {
    const R = (name, desc) => ({ id: 'r', name, desc: desc || '', region: 'x' });
    const ruleFarm = LEXICON.find(r => r[0] === '谷子');
    const ruleOar = LEXICON.find(r => r[0] === '橹');
    const ruleJie = LEXICON.find(r => r[0] === '街口');
    T(ruleFarm[3] === '村野才放行' && ruleOar[3] === '水边或水上门派或船家' && ruleJie[3] === '临街市才放行',
      '故障6 前提：三条口径确实挂在了词上（否则下面是空跑）');
    T(placeAllowsWord(R('青溪村·村口'), ruleFarm, {}) === true, '故障6a 村野：村口说「谷子」→ 放行');
    T(placeAllowsWord(R('江南城·长街'), ruleFarm, {}) === false, '故障6b 村野：城里长街说「谷子」→ 仍红');
    T(placeAllowsWord(R('码头·褚宅'), ruleOar, {}) === true, '故障6c 水边：码头宅子说「橹」→ 放行');
    T(placeAllowsWord(R('江南城·车马行'), ruleOar, {}) === false, '故障6d 水边：城里车马行说「橹」→ 仍红（地名带「江」不算水边）');
    T(placeAllowsWord(R('江口码头'), ruleJie, {}) === true, '故障6e 街市：码头说「街口」→ 放行');
    T(placeAllowsWord(R('城外土坡'), ruleJie, {}) === false, '故障6f 街市：城外土坡说「街口」→ 仍红');
    T(placeAllowsWord(R('黄河帮·山门'), ruleOar, {}, { desc: '撑船拉纤的汉子。' }) === true,
      '故障6g 水边（走本人描述）：船帮人在自家山门说「橹」→ 放行');
    T(placeAllowsWord(R('黄河帮·山门'), ruleOar, {}, { desc: '耍刀的汉子。' }) === false,
      '故障6h 水边（本人描述无水信号）→ 仍红');

    /* 故障 6i~6l：船家职业族（team-lead 裁定 D-6）
       每放行一条都必须配一条「不该放的仍然红」，否则量具会慢慢变成「什么都不红」。 */
    T(placeAllowsWord(R('江南城·南门'), ruleOar, {}, { tag: 'boatman', desc: '脸上被江风吹得红。' }) === true,
      '故障6i 船家职业族：tag=boatman 在城门口说「橹」→ 放行（本色词跟身份走）');
    T(placeAllowsWord(R('江南城·南门'), ruleOar, {}, { tag: 'vendor', desc: '脸上被江风吹得红。' }) === false,
      '故障6j 同一个城门口，tag=vendor 说「橹」→ 仍红（这一条放行才是量具坏了）');
    T(placeAllowsWord(R('江南城·南门'), ruleOar, {}, { tag: 'commoner', title: '船家', desc: '' }) === true,
      '故障6k 中文 title「船家」也认（数据里 tag 不总写成英文键）');
    T(placeAllowsWord(R('江南城·南门'), ruleOar, {}, { tag: 'commoner', title: '货郎', desc: '' }) === false,
      '故障6l title「货郎」不认 → 仍红');
  }

  /* ---- 故障 7：门派→宗教两级放行（team-lead 裁定 ③） ----
     这条最容易「一放全放」，所以每一档都要同时证明该放的放了、不该放的没放。 */
  {
    const mk = (rooms, npcs) => scan(mkWorld(rooms, npcs));
    const R = (id, name) => ({ id, name, region: 'x', desc: '' });

    /* ① 本门宗教词随处可说 */
    const a = mk({ r: R('hengshanN_hall', '恒山派·演武场') },
      { n: { id: 'n', name: '恒山弟子', room: 'r', sect: 'hengshanN', desc: '', talk: ['「施主有事？」'] } });
    T(!a.n1.some(x => x.id === 'n'), '故障7a 恒山（佛门）弟子在演武场说「施主」→ 不判红');
    const b = mk({ r: R('shaolin_ta', '少林·塔林') },
      { n: { id: 'n', name: '少林僧', room: 'r', sect: 'shaolin', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(!b.n1.some(x => x.id === 'n'), '故障7b 少林（佛门）僧人在塔林说「阿弥陀佛」→ 不判红');
    const c = mk({ r: R('wudang_shanmen', '武当·山门') },
      { n: { id: 'n', name: '武当道人', room: 'r', sect: 'wudang', desc: '', talk: ['「三清在上。」'] } });
    T(!c.n1.some(x => x.id === 'n'), '故障7c 武当（道家）道人在山门说「三清」→ 不判红');

    /* ② 跨门派/跨教门挂错仍红 —— 这是不能放过去的那一半 */
    const d = mk({ r: R('huashan_houdong', '思过崖·后洞') },
      { n: { id: 'n', name: '桃花岛弟子', room: 'r', sect: 'taohua', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(d.n1.some(x => x.id === 'n'), '故障7d 桃花岛（无档）弟子在思过崖后洞念「阿弥陀佛」→ **仍判红**（team-lead 点名）');
    const e = mk({ r: R('wudang_hall', '武当·演武场') },
      { n: { id: 'n', name: '武当道人', room: 'r', sect: 'wudang', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(e.n1.some(x => x.id === 'n'), '故障7e 武当（道家）人念佛号「阿弥陀佛」→ 仍判红（跨教门）');
    const f = mk({ r: R('road_shaolin_1', '嵩山道') },
      { n: { id: 'n', name: '路人', room: 'r', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(f.n1.some(x => x.id === 'n'), '故障7f 无门派的人在山路（非 temple）念「阿弥陀佛」→ 仍判红');

    /* ③ 谁进庙都能提佛 */
    const g = mk({ r: R('shaolin_ta', '少林·塔林') },
      { n: { id: 'n', name: '路人', room: 'r', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(!g.n1.some(x => x.id === 'n'), '故障7g 无门派的人在塔林（temple）念「阿弥陀佛」→ 不判红');

    /* ④ 房间 id 前缀兜底：没有 sect 字段时也能认出恒山 */
    const h = mk({ r: R('hengshanN_library', '恒山派·藏经阁') },
      { n: { id: 'n', name: '恒山弟子', room: 'r', desc: '', talk: ['「施主有事？」'] } });
    T(!h.n1.some(x => x.id === 'n'), '故障7h 没写 sect 字段时，从房间 id 前缀推出恒山 → 不判红');
  }

  /* ---- 故障 8：本轮新开的 4 处放行，每一处都要「放的那条过 + 该红的仍红」成对钉死 ----
     ⚠️ 纪律（team-lead）：只松不钉，这台量具几轮之后就会慢慢变成什么都不红。 */
  {
    const mk = (rooms, npcs) => scan(mkWorld(rooms, npcs));
    const R = (id, name) => ({ id, name, region: 'x', desc: '' });
    const one = (r, npc) => mk(r, npc);

    /* 8-1 幌子：本门门面放行 */
    const a1 = one({ r: R('wuhu_hall', '五虎断门刀·演武场') },
      { n: { id: 'n', name: '雷五虎', room: 'r', sect: 'wuhu', desc: '', talk: ['门外挂着「五虎」的幌子。'] } });
    T(!a1.n1.some(x => x.id === 'n'), '故障8a 幌子·放行侧：本门人在自家演武场说「幌子」→ 不判红');
    const a2 = one({ r: R('wuhu_hall', '五虎断门刀·演武场') },
      { n: { id: 'n', name: '外来的', room: 'r', sect: 'huashan', desc: '', talk: ['门外挂着「五虎」的幌子。'] } });
    T(a2.n1.some(x => x.id === 'n'), '故障8b 幌子·仍红侧：别家门派的人在这儿说「幌子」→ 仍判红');
    /* 「无门派」这一侧要放在**本来就不允许**的场所里验（street 本来就放行幌子，
       放长街里验等于验了个空气）。放山洞：没有 sect ⇒ 本门门面档不成立 ⇒ 仍红。 */
    const a3 = one({ r: R('huashan_houdong', '思过崖·后洞') },
      { n: { id: 'n', name: '路人', room: 'r', desc: '', talk: ['前头那家挂着幌子。'] } });
    T(a3.n1.some(x => x.id === 'n'), '故障8c 幌子·仍红侧：无门派人在山洞里说「幌子」→ 仍判红（无 sect 则本门门面档不成立）');

    /* 8-2 船水：水上门派放行 */
    const b1 = one({ r: R('huanghe_hall', '黄河帮·演武场') },
      { n: { id: 'n', name: '黄河帮弟子', room: 'r', sect: 'huanghe', desc: '', talk: ['撑船拉纤的抱团讨生活。'] } });
    T(!b1.n1.some(x => x.id === 'n'), '故障8d 船水·放行侧：黄河帮（水上门派）在演武场说「撑船」→ 不判红');
    const b2 = one({ r: R('huashan_houshan', '华山·后山') },
      { n: { id: 'n', name: '华山弟子', room: 'r', sect: 'huashan', desc: '', talk: ['撑船拉纤的抱团讨生活。'] } });
    T(b2.n1.some(x => x.id === 'n'), '故障8e 船水·仍红侧：华山（非水上门派）在后山说「撑船」→ 仍判红');
    /* 两条条件是「或」不是替换 —— 码头住家的橹不能因为加了水上门派档又变回红 */
    const b3 = one({ r: R('hb_home_01', '码头·褚宅') },
      { n: { id: 'n', name: '褚家的人', room: 'r', desc: '手里的橹把磨得发亮。', talk: ['橹搁在门后。'] } });
    T(!b3.n1.some(x => x.id === 'n'), '故障8f 船水·两档并存：码头住家（非水上门派，但水信号命中）→ 不判红');

    /* 8-3 摊子：桥头/码头放行 */
    const c1 = one({ r: R('gusu_fengqiao', '姑苏·枫桥') },
      { n: { id: 'n', name: '摆摊的', room: 'r', desc: '蹲在摊子后面，把货来回摆正。', talk: ['货都摆好了。'] } });
    T(!c1.n1.some(x => x.id === 'n'), '故障8g 摊子·放行侧：桥头（water）摆摊子 → 不判红');
    const c2 = one({ r: R('huashan_houdong', '思过崖·后洞') },
      { n: { id: 'n', name: '摆摊的', room: 'r', desc: '蹲在摊子后面，把货来回摆正。', talk: ['货都摆好了。'] } });
    T(c2.n1.some(x => x.id === 'n'), '故障8h 摊子·仍红侧：山洞里摆摊子 → 仍判红');

    /* 8-4 牢狱：行程类动作按目的地判 */
    const d1 = one({ r: R('palace_road', '皇城·御道') },
      { n: { id: 'n', name: '影子', room: 'r', desc: '', portrait: { routine: [{ at: 'night', act: '去一趟天牢，确认名单上的人还在' }] } } });
    T(!d1.n1.some(x => x.id === 'n'), '故障8i 牢狱·放行侧：御道上「去一趟天牢…」（行程动作，目的地是牢）→ 不判红');
    const d2 = one({ r: R('palace_road', '皇城·御道') },
      { n: { id: 'n', name: '影子', room: 'r', desc: '', talk: ['天牢里关着谁，你别问。'] } });
    T(d2.n1.some(x => x.id === 'n'), '故障8j 牢狱·仍红侧：同样是御道，但用 talk（非行程字段）提天牢 → 仍判红');
    const d3 = one({ r: R('palace_road', '皇城·御道') },
      { n: { id: 'n', name: '影子', room: 'r', desc: '', portrait: { routine: [{ at: 'night', act: '在天牢里数人头' }] } } });
    T(d3.n1.some(x => x.id === 'n'), '故障8k 牢狱·仍红侧：行程字段但**没有行程标记**（「在…里」不是「去…」）→ 仍判红');

    /* 8-5 罗汉门归佛门档 */
    const e1 = one({ r: R('luohan_gate', '罗汉门·山门') },
      { n: { id: 'n', name: '罗汉门弟子', room: 'r', sect: 'luohan', desc: '', talk: ['「阿弥陀佛。」'] } });
    T(!e1.n1.some(x => x.id === 'n'), '故障8l 罗汉门归佛门档：弟子念「阿弥陀佛」→ 不判红');
    const e2 = one({ r: R('luohan_gate', '罗汉门·山门') },
      { n: { id: 'n', name: '罗汉门掌门', room: 'r', sect: 'luohan', desc: '一身罗汉拳的真功夫。', talk: ['拳是真的。'] } });
    T(!e2.n1.some(x => x.id === 'n'), '故障8m 罗汉门归佛门档：掌门 desc 里写自家门名「罗汉」→ 不判红（不再自相矛盾）');
  }

  /* ---- 故障 9：低置信 6 条结案后的 5 条判据修改（team-lead 逐条批） ----
     规矩：**每一条放行都必须钉一条「该红的仍然红」**。只松不钉，几轮之后这台量具
     会慢慢变成什么都不红 —— 而它的价值恰恰是「宁可少收，不可乱收」。
     下面 10 条 = 5 组 ×（放行侧 + 仍红侧）。 */
  {
    /* ⚠️ 房间必须选**能产出 n1 记录**的高置信房间，否则「放行侧」是空跑通过的：
       我第一版用了塞外风沙/侠客岛内堂那些**低置信**房间，记录全进了 `n1Low`，
       于是 `hit()` 恒为 false —— 10 条里 5 条放行侧**什么都没验到就打了勾**。
       教训跟 8c 那次一样：断言恒真的自测比没有自测更坏，因为它给人假的信心。 */
    const CAVE = { id: 'r_cave', name: '思过崖·后洞', region: 'huashan', desc: '洞口垂着藤蔓，往里几步就没了光。' };
    const HALL = desc => ({ id: 'r_martial', name: '恒山派·演武场', region: 'hengshanN', desc: desc || '一片空地，立着些木桩。' });
    const hit = (room, npc) => {
      const r = scan(mkWorld({ r: room }, { n: Object.assign({ id: 'n', room: 'r', desc: '' }, npc) }));
      return r.n1.some(x => x.id === 'n');
    };

    /* ① 客官 · 商贩职业族（低置信 #2 npcv_141 塞外风沙 / #4 npcv_273 唐门前厅） */
    T(!hit(CAVE, { name: '马秋', tag: 'merchant', title: '行商', talk: ['价钱好商量，客官是爽快人。'] }),
      '故障9a 客官·放行侧：行商（tag=merchant）在山洞说「客官」→ 不判红');
    T(hit(CAVE, { name: '路人', tag: 'commoner', talk: ['价钱好商量，客官是爽快人。'] }),
      '故障9b 客官·仍红侧：同一个山洞，寻常百姓（tag=commoner）说「客官」→ 仍红');
    T(!hit(HALL(), { name: '廉苇', tag: 'merchant', title: '行商', talk: ['价钱好商量，客官是爽快人。'] }),
      '故障9c 客官·放行侧：行商在演武场（唐门前厅同类）说「客官」→ 不判红（本色词跟身份走）');
    T(hit(HALL(), { name: '陆见山', tag: 'scholar', title: '主讲', talk: ['客官是爽快人。'] }),
      '故障9d 客官·仍红侧：书院主讲（tag=scholar / title=主讲）说「客官」→ 仍红（不认 name，只认 tag/title）');

    /* ② 幌子 · 本门门面或商贩（低置信 #3 npcv_233 侠客岛内堂） */
    T(!hit(CAVE, { name: '江倦', tag: 'vendor', title: '货郎', talk: ['摊前插着个幌子，字已经看不清了。'] }),
      '故障9e 幌子·放行侧：货郎（tag=vendor + title=货郎）在山洞说「幌子」→ 不判红（读已有字段，不是补 sect）');
    T(hit(CAVE, { name: '岛上的', tag: 'commoner', talk: ['摊前插着个幌子，字已经看不清了。'] }),
      '故障9f 幌子·仍红侧：同一个山洞，**没写 sect 也非商贩**的人说「幌子」→ 仍红'
      + '（这条必须守住：D-7 就是不为让量具变绿去补不确定的 sect）');

    /* ③ 柜台 · 铺面信号（低置信 #5 jn_apothecary 回春堂） */
    T(!hit(HALL('药柜从地上一直顶到房梁，数百个抽屉上贴着药名。柜台后坐着位白发老郎中。'),
      { name: '陈济仁', tag: 'doctor', title: '坐堂', talk: ['坐在柜台后头给人号脉。'] }),
      '故障9g 柜台·放行侧：房间 desc 里有药柜/柜台（回春堂同类）说「柜台」→ 不判红');
    T(hit(HALL('四壁都是书架，架上堆着书。'),
      { name: '某人', tag: 'scholar', talk: ['坐在柜台后头。'] }),
      '故障9h 柜台·仍红侧：同一类房间，desc 只有「书架」→ 仍红（团队长点名的坑：不放裸的「架」）');

    /* ④ 秤 · 比喻豁免（低置信 #6 jn_tutor 白鹿书院） */
    T(!hit(HALL(), { name: '陆见山', tag: 'scholar', talk: ['读书不为功名，为的是心里那杆秤。秤准了，人就不歪。'] }),
      '故障9i 秤·放行侧：「心里那杆秤」是比喻，无买卖语境 → 不判红（看上下文不看关键词）');
    T(hit(HALL(), { name: '陆见山', tag: 'scholar', talk: ['秤准，价钱好商量。'] }),
      '故障9j 秤·仍红侧：同一个房间，但带了买卖词「价钱」→ 仍红（豁免没放太宽）');
  }

  /* ---- 故障 5：场所分类本身 ---- */
  {
    const c1 = classifyRoom({ id: 'x', name: '思过崖·后洞', region: 'huashan', desc: '' });
    const c2 = classifyRoom({ id: 'y', name: '桃花岛·渡口', region: 'taohuadao', desc: '' });
    const c3 = classifyRoom({ id: 'z', name: '甲乙丙丁', region: 'zzz', desc: '什么都没写。' });
    T(c1.type === 'cave', '故障5a 「思过崖·后洞」判为 cave');
    T(c2.type === 'water', '故障5b 「桃花岛·渡口」判为 water（渡口没有「门」，所以门房话在这里是红的）');
    T(c3.type === 'unknown', '故障5c 无信号房间 → unknown（不猜）');
  }

  /* ---- 故障 10：门禁判定器自验 ----
     这台脚本**默认运行原来是永远退出 0 的**（`grep process.exit` 只有 --selftest 一处）。
     直接改名进回归 = 挂一个永远绿的摆设。团队长把「断言恒真的自测比没有自测更坏」
     提成铁律，门禁版的说法就是：**永远退出 0 的守卫，比没有守卫更坏** —— 它不拦
     任何东西，却让人以为拦住了。所以 gateVerdict() 自己必须先过下面 6 条。 */
  {
    const V = r => gateVerdict(r);
    const base = { n1: [], n1Low: [], n2a: [], n2b: [], n2c: [], n3: [], n3Unknown: [], noPortrait: [] };
    const withF = f => Object.assign({}, base, f);

    T(V(base).red === false, '故障10a 门禁·空结果 → 不红（干净数据必须放行，不许一上来就红）');
    T(V(withF({ n1: [{ id: 'a' }] })).red === true, '故障10b 门禁·N1 主红 1 条 → 红（这是它进回归唯一的价值）');
    T(V(withF({ n3: [{ id: 'a' }] })).red === true, '故障10c 门禁·N3 判红 1 条 → 红');
    T(V(withF({ n1Low: [{ id: 'a' }, { id: 'b' }] })).red === false,
      '故障10d 门禁·只有低置信单列 → 不红（低置信是「待人工确认」，不是已证实的错）');
    T(V(withF({ n2a: [[{ id: 'a' }]], n2b: [{ id: 'a' }], n2c: [{ id: 'a' }], n3Unknown: [{ id: 'a' }], noPortrait: [{ id: 'a' }] })).red === false,
      '故障10e 门禁·只有 N2 重复度 + 各类无法判定 → 不红（重复度是待改清单、无法判定是数据不全，都不是正确性错）');

    /* 10f 端到端：**先验输入真的产出了 N1 红，再验门禁判红**。顺序不能反 ——
       只验后者的话，万一 scan 返回空，10f 依然打勾，就又是那个「什么都没验到」的坑。 */
    const rr = scan(mkWorld(
      { r: { id: 'r_cave', name: '思过崖·后洞', region: 'huashan', desc: '洞口垂着藤蔓，往里几步就没了光。' } },
      { n: { id: 'n', room: 'r', desc: '', tag: 'commoner', talk: ['摊前插着个幌子，字已经看不清了。'] } }));
    T(rr.n1.some(x => x.id === 'n'), '故障10f-1 门禁自验前置：这条输入**确实**产出了 N1 红（否则 10f-2 是空跑）');
    T(V(rr).red === true && /N1 场景一致判红 1 条/.test(V(rr).reasons.join('；')),
      '故障10f-2 门禁·端到端：真造 1 条 N1 红 → 判红且理由写明条数（退出码应为 1）');
  }

  console.log(out.join('\n'));
  console.log('\n  自测结果：' + pass + '/' + total + ' 通过');
  console.log('='.repeat(60));
  return pass === total ? 0 : 1;
}

/* ------------------------------------------------------------------ *
 * 七、报告
 * ------------------------------------------------------------------ */

function printPlaces() {
  console.log('场所类型表（判定依据 = 有序规则，首命中胜出）\n');
  console.log('| 类型 | 中文 | 判定依据 |');
  console.log('|---|---|---|');
  const seen = new Set();
  for (const [type, , conf, why] of PLACE_RULES) {
    if (seen.has(type)) continue;
    seen.add(type);
    console.log('| `' + type + '` | ' + (TYPE_CN[type] || type) + ' | ' + why + '（置信度 ' + conf + '） |');
  }
  console.log('\n\n各类禁用词表（在该类场所出现即判红）\n');
  for (const type of Object.keys(TYPE_CN)) {
    if (type === 'unknown') continue;
    const ws = bannedWordsOf(type);
    console.log('**' + type + '（' + TYPE_CN[type] + '）** —— 禁用 ' + ws.length + ' 词');
    console.log('  ' + ws.join('、') + '\n');
  }
}

/**
 * 门禁判定：这份体检结果**该不该让回归变红**。
 *
 * ⚠️ 为什么必须单独写这个函数：本脚本以前**永远退出 0**（只打印不判）。
 *    那要是直接改名进回归，就等于在门禁上挂一个**永远绿的摆设** ——
 *    跟"断言恒真的自测"是同一个病，只是发生在门禁这一层。
 *
 * 判红的范围要**收得很紧**，否则门禁长期红就没人看了：
 *   红   · N1 主红（人在不该说话的地方说了不该说的话）  ← 正确性，接进来就是为了守这个
 *   红   · N3 判红（有未了承诺/人情账，却没有任何一条台词提到它）
 *   不红 · N1 低置信单列（判不准的，本来就该单列等人看；npcv_067 已归 D-1 批）
 *   不红 · N2a/N2b/N2c（重复度 —— 那是**待改内容的清单**不是正确性。
 *          团队长明确说过 reuse-ledger 不进门禁就是这个理由，这里同理）
 *   不红 · 无法判定（场所 / N3 / 无画像）—— 铁律：**无法判定不许当通过，也不许当失败**
 */
function gateVerdict(r) {
  const reasons = [];
  if (r.n1 && r.n1.length) reasons.push('N1 场景一致判红 ' + r.n1.length + ' 条');
  if (r.n3 && r.n3.length) reasons.push('N3 记忆一致判红 ' + r.n3.length + ' 条');
  return { red: reasons.length > 0, reasons };
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.indexOf('--selftest') >= 0) process.exit(selftest());

  if (argv.indexOf('--places') >= 0) { printPlaces(); return; }

  /* ---- 中英混排扫描（design §C.3 ⑤：严禁中英混排） ---- */
  if (argv.indexOf('--latin') >= 0) {
    const LATIN = /[A-Za-z]{2,}/g;
    const hits = [];
    const walk = (node, p, id) => {
      if (node === null || node === undefined) return;
      if (Array.isArray(node)) { node.forEach((v, i) => walk(v, p + '[' + i + ']', id)); return; }
      if (typeof node === 'string') {
        const segs = p.replace(/\[\d+\]/g, '').split('.');
        const isText = segs.some(s => ['desc', 'talk', 'answer', 'text', 'raw', 'say', 'role', 'now', 'want',
          'fear', 'arc', 'catchphrase', 'title', 'name', 'act', 'voice', 'portrait'].indexOf(s) >= 0);
        if (!isText) return;
        const m = node.match(LATIN);
        if (m) hits.push({ id, path: p, words: [...new Set(m)], text: node.slice(0, 70) });
        return;
      }
      if (typeof node !== 'object') return;
      for (const k of Object.keys(node)) if (k.charAt(0) !== '_') walk(node[k], p + '.' + k, id);
    };
    const e2 = new GameEngine({ seed: 20261012, dataDir: path.join(ROOT, 'game', 'data') });
    e2.boot(); e2.newGame();
    for (const coll of ['npcs', 'rooms', 'items', 'quests']) {
      const c = e2.world.data[coll] || {};
      for (const id of Object.keys(c)) walk(c[id], coll + '.' + id, coll + '.' + id);
    }
    console.log('中英混排扫描（玩家可见文本里出现 ≥2 个连续拉丁字母）：' + hits.length + ' 处\n');
    for (const h of hits) console.log('  ' + h.id + ' · ' + h.path + '\n      [' + h.words.join(', ') + ']  ' + h.text);
    return;
  }

  console.log('加载中（GameEngine boot + newGame，以磁盘加载态为准）…');
  const e = new GameEngine({ seed: 20261012, dataDir: path.join(ROOT, 'game', 'data') });
  e.boot(); e.newGame();
  const r = scan(e.world);

  const L = [];
  L.push('='.repeat(64));
  L.push('  归属守卫 · 全库体检   NPC ' + r.npcCount + ' · 房间 ' + r.roomCount);
  L.push('='.repeat(64));

  /* 场所分布 */
  L.push('\n【场所分类分布】高置信 ' + (r.roomCount - r.lowConf.length) + ' 间 · 低置信（只靠 region 或兜底规则）' + r.lowConf.length + ' 间 · 无法判定 ' + (r.placeDist.unknown || 0) + ' 间');
  for (const [t, n] of Object.entries(r.placeDist).sort((a, b) => b[1] - a[1])) {
    L.push('  ' + String(t).padEnd(9) + String(n).padStart(4) + '  ' + (TYPE_CN[t] || ''));
  }

  /* N1 */
  const n1ByNpc = new Set(r.n1.map(x => x.id));
  L.push('\n【N1 场景一致】红条目 ' + r.n1.length + ' 条，涉及 NPC ' + n1ByNpc.size + ' 人'
    + '（另有低置信房间 ' + r.n1Low.length + ' 条单列，不计入）');
  /* 覆盖缺口（2026-10-18）：判不出场所类型的房会被 N1 静默跳过。
     现在全库 0 间，但必须显式打出来——否则以后新增房型判不出来，N1 会"安静地不漏"，
     看起来永远是 0（与「L1 真空 0 是同义反复」同一类风险）。 */
  {
    const unk = (r.n1UnknownRooms || new Set()).size;
    L.push('  覆盖：有 NPC 但场所类型判不出（N1 无法判定）的房间 ' + unk + ' 间'
      + (unk ? '  ⚠ 覆盖不足，请补判型规则（当前不判红）' : '（全库 0，覆盖完整）'));
  }
  const n1Top = {};
  for (const x of r.n1) {
    const k = x.place + ' × ' + x.hits.map(h => h.w).join('/');
    n1Top[k] = (n1Top[k] || 0) + 1;
  }
  L.push('  命中聚合 Top15（场所 × 命中词 → 条数）：');
  for (const [k, n] of Object.entries(n1Top).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    L.push('    ' + String(n).padStart(4) + '  ' + k);
  }
  const n1Show = argv.indexOf('--n1-all') >= 0 ? r.n1.length : 60;
  L.push('  逐条明细（前 ' + n1Show + '）：');
  for (const x of r.n1.slice(0, n1Show)) {
    L.push('    ' + x.id + ' @' + x.room + '（' + x.roomName + ' / ' + x.place + '）· ' + x.field);
    L.push('        「' + x.text.slice(0, 56) + '」  ← ' + x.hits.map(h => h.w + '(' + h.dom + ')').join(' '));
  }
  if (r.n1.length > n1Show) L.push('    … 另有 ' + (r.n1.length - n1Show) + ' 条（--n1-all 全打）');
  /* 直接排期用的修复清单：一行一条，含房间/场所/字段/原句/命中词 */
  const n1Out = (() => { const i = argv.indexOf('--n1-out'); return i >= 0 ? argv[i + 1] : null; })();
  if (n1Out) {
    const rows = [['npcId', '房间id', '房间名', '场所', '字段', '原句', '命中词']];
    for (const x of r.n1) {
      rows.push([x.id, x.room, x.roomName, x.place, x.field, x.text, x.hits.map(h => h.w).join('/')]);
    }
    require('fs').writeFileSync(path.resolve(__dirname, '..', n1Out),
      rows.map(r2 => r2.map(s => String(s).replace(/\t/g, ' ')).join('\t')).join('\n'), 'utf8');
    console.log('\n已导出 N1 修复清单 ' + r.n1.length + ' 条 → ' + n1Out);
  }
  L.push('  低置信房间（分类只靠 region 或描述兜底）里命中的 ' + r.n1Low.length + ' 条，单列待人工确认、不计入主红：');
  for (const x of r.n1Low.slice(0, 8)) L.push('    ' + x.id + ' @' + x.room + '（' + x.roomName + ' / ' + x.place + '）「' + x.text.slice(0, 40) + '」← ' + x.hits.map(h => h.w).join('/'));

  /* N2 */
  L.push('\n【N2 身份一致】');
  L.push('  N2a 同组台词复用 >2 次：' + r.n2a.length + ' 组句');
  for (const ax of ['A职业族', 'B门派', 'C族内id', 'D职业族门派']) {
    let c = 0, npcSet = new Set();
    for (const gid of Object.keys(r.n2aByAxis[ax])) for (const it of r.n2aByAxis[ax][gid]) { c++; it.ids.forEach(i => npcSet.add(i)); }
    L.push('      · ' + ax + '：' + c + ' 组句，涉及 NPC ' + npcSet.size + ' 人');
  }
  const n2aNpcs = new Set(); r.n2a.forEach(x => x.ids.forEach(i => n2aNpcs.add(i)));
  L.push("      （445 是「轴×组×句」的组合数；不同句子 " + new Set(r.n2a.map(x => x.text)).size + " 条）");
  L.push('      合计涉及 NPC ' + n2aNpcs.size + ' 人');
  const n2aTop = {};
  for (const x of r.n2a) n2aTop[x.text] = Math.max(n2aTop[x.text] || 0, x.n);
  L.push('      复用最多 Top10：');
  for (const [t, n] of Object.entries(n2aTop).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    L.push('        ×' + String(n).padStart(3) + '  ' + t.slice(0, 50));
  }
  L.push('  N2b desc 全库重复 >1 次：' + r.n2b.length + ' 条描述，涉及 NPC '
    + r.n2b.reduce((a, b) => a + b.n, 0) + ' 人');
  for (const x of r.n2b.slice(0, 5)) L.push('        ×' + String(x.n).padStart(3) + '  ' + x.text.slice(0, 50));
  L.push('  N2c 画像（now/want/fear）无独有名词：' + r.n2c.length + ' 人 / 有画像 ' + (r.n2c.length + r.n2cPass.length) + ' 人');
  L.push('      （另有 ' + r.noPortrait.length + ' 人无画像字段 → 无法判定）');
  L.push('      判红样本 3（最稀有的一句，在别人画像里也出现）：');
  for (const x of r.n2c.slice(0, 3)) {
    const t = x.text;
    L.push('        ' + x.id + ' 最稀有词「' + x.term + '」另有 ' + x.others + ' 人同用 —— ' + t.slice(0, 46));
  }
  L.push('      判过样本 3（确有独有句）：');
  for (const x of (r.n2cPass).slice(0, 3)) {
    const t = x.text;
    L.push('        ' + x.id + ' 独有词「' + x.term + '」 —— ' + t.slice(0, 46));
  }

  /* N3 */
  L.push('\n【N3 记忆一致】');
  if (r.n3Unknown.length) {
    L.push('  ⚠ 无法判定：' + r.n3Unknown.length + ' 人 —— ' + r.n3Unknown[0].why);
    L.push('     （新档 `p.promises` 未建立、无任何人情账；此条**不许**当成通过）');
  }
  L.push('  判红 ' + r.n3.length + ' 条');

  L.push('\n【汇总】N1 ' + r.n1.length + ' · N2a ' + r.n2a.length + ' · N2b ' + r.n2b.length
    + ' · N2c ' + r.n2c.length + ' · N3 ' + r.n3.length
    + ' · 无法判定(场所) ' + (r.placeDist.unknown || 0) + ' · 无法判定(N3) ' + r.n3Unknown.length
    + ' · 无法判定(无画像) ' + r.noPortrait.length);
  console.log(L.join('\n'));

  if (argv.indexOf('--inspect') >= 0) {
    console.log('\n\n【--inspect】N1 命中按「场所 × 词」聚合（人工复核用）');
    const agg = {};
    for (const x of r.n1) for (const h of x.hits) {
      const k = x.place + ' | ' + h.w + ' | ' + h.dom;
      (agg[k] = agg[k] || []).push(x.id + ' @' + x.room + ' 「' + x.text.slice(0, 30) + '」');
    }
    for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].length - a[1].length)) {
      console.log('\n' + k + '  ×' + v.length);
      for (const s of v.slice(0, 4)) console.log('    ' + s);
    }
  }

  /* ---- 门禁判定（进回归后靠这个退出码说话） ---- */
  const gv = gateVerdict(r);
  if (gv.red) {
    console.log('\n【门禁】✘ 不通过 —— ' + gv.reasons.join('；'));
    for (const x of r.n1.slice(0, 10)) console.log('    N1 ' + x.id + ' @' + x.room + ' 「' + String(x.text).slice(0, 30) + '」');
    for (const x of (r.n3 || []).slice(0, 10)) console.log('    N3 ' + x.id + ' ' + x.why);
  } else {
    console.log('\n【门禁】✔ 通过 —— N1 主红 0 · N3 判红 0'
      + '（低置信单列 ' + (r.n1Low || []).length + ' 条、N2 重复度与各类无法判定均**不计入门禁**）');
  }
  process.exit(gv.red ? 1 : 0);
}

main();
