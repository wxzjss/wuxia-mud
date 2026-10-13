#!/usr/bin/env node
/* ============================================================
 * land-n1-fixes.js —— P0-2b 内容落库（走闸 B）
 *
 * 三批改：
 *   ① N1 真·场景错置：把「洞里谈铺子」「山门念佛号」这类跨场景/跨门派的
 *      句子改写成贴着**房间**和**身份**的话。每条都换了不同的说法，
 *      避免改完又撞进 N2a「同组复用 >2 次」。
 *   ② 中英混排·NPC 名：`taishan弟子` 这类拼音名（29 处）改回中文。
 *      中文名**从房间名推导**（`泰山派·藏经阁` → 泰山派），不靠我编。
 *   ③ 中英混排·任务文本：`taishan_hall：后山那眼泉眼…`（19 处）
 *      把裸房间 id 换回房间中文名。
 *
 * 闸 B：
 *   ① 改前 → `node tools/data-dup-check.js --field npcs.talk / --id <id>`
 *      （实测：npcs.talk 全库仅 duan_yu / npcv_220 两条争议；本批目标 id 均无争议）
 *   ② 改后 → **真引擎 boot 起来把字段实际值打出来**当断言，不认「文件里写了就算」
 *   ③ 改后 → 再跑一次 identity-belonging-check.js（原 identity-guard.js）看红数下降
 *
 * 用法：
 *   node tools/land-n1-fixes.js --dry    只演算不落盘
 *   node tools/land-n1-fixes.js          落盘 + 真引擎断言
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');

const DRY = process.argv.indexOf('--dry') >= 0;

/* ---------- ① 场景错置的句子改写 ----------
   [文件, npcId, 字段路径, 原句, 新句]
   新句的锚：房间（第一现场）+ 身份（门派/职业），两条都要落得住。 */
const PATCH = [
  /* —— 洞窟：活死人墓 / 故城暗道 / 侠客岛石壁 / 思过崖后洞 —— */
  ['42_sect_guards.json', 'sectguard_taohua', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「上岛的？先把船系稳再说话。」'],
  ['42_sect_guards.json', 'sectguard_gumu', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「墓里冷，话说短些。」'],
  ['43_sect_disciples.json', 'disciple_gumu_2', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「墓里有墓里的规矩，不懂就别问。」'],
  ['43_sect_disciples.json', 'disciple_taishan_1', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「阁里的书不外借，看就在这儿看。」'],
  ['43_sect_disciples.json', 'disciple_hengshan_1', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「抄书可以，墨别蹭到纸上。」'],
  ['43_sect_disciples.json', 'disciple_kongtong_1', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「崆峒的谱，不外传。」'],
  ['43_sect_disciples.json', 'disciple_kongtong_2', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「库房重地，先报门派。」'],
  ['43_sect_disciples.json', 'disciple_kunlun_1', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「昆仑的经，只给本门看。」'],
  ['43_sect_disciples.json', 'disciple_kunlun_2', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「宝阁上着锁，钥匙在掌门手里。」'],
  ['43_sect_disciples.json', 'disciple_wuyun_1', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「温家的家什，动手之前先问一声。」'],
  ['43_sect_disciples.json', 'disciple_diancang_3', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「下场可以，先报你使什么招。」'],
  ['43_sect_disciples.json', 'disciple_shenquan_1', ['portrait', 'voice', 'catchphrase'], '「概不赊账。」', '「库房的粮按份领，多一两也没有。」'],
  ['43_sect_disciples.json', 'disciple_shenquan_2', ['portrait', 'voice', 'catchphrase'], '「概不赊账。」', '「神拳门不接来路不明的拜帖。」'],

  ['43_sect_disciples.json', 'disciple_taohua_1', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「桃林不许折枝，折一枝罚扫一旬。」'],
  /* ⚠️ 苗疆·蛊池那条一度写成「……瘴气专往低处走」，但「瘴气」是荒野词、
     蛊池判为 water —— 改一句不能制造新的错置，已改成上面那句。 */

  /* —— 第三轮：门派→宗教口径收严后挖出来的跨门派挂错 ——
     旧规则「山地一律放行佛道词」把下面这批盖住了：昆仑是**道家**档却念佛号，
     衡山/青城/崆峒/点苍/温家/桃花岛/古墓是**无**档却说「施主」。
     收严之后它们才显形 —— 这是量具变准、不是新病。 */
  ['42_sect_guards.json', 'sectguard_hengshan', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「山门不接空手的外客，报上师承。」'],
  ['42_sect_guards.json', 'sectguard_qingcheng', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「青城的山门不看衣冠，看你走不走得稳。」'],
  ['42_sect_guards.json', 'sectguard_kongtong', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「崆峒的规矩写在门边那块木牌上，自己看。」'],
  ['42_sect_guards.json', 'sectguard_kunlun', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「上了这道坡就是昆仑的地界，先把口气匀匀。」'],
  ['42_sect_guards.json', 'sectguard_diancang', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「点苍不接生客。有事说事，别绕。」'],
  ['42_sect_guards.json', 'sectguard_wuyun', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「温家的门不常开。你找谁？」'],
  ['43_sect_disciples.json', 'disciple_taohua_3', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「蛇阵里的路一天一换，跟着我的脚印走。」'],
  ['43_sect_disciples.json', 'disciple_gumu_1', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「终南山上风硬，有话进门再说。」'],
  ['43_sect_disciples.json', 'disciple_hengshan_0', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「本门的山门认人。你师父是谁？」'],
  ['43_sect_disciples.json', 'disciple_hengshan_3', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「要上山先把兵器交出来，走的时候还你。」'],
  ['43_sect_disciples.json', 'disciple_qingcheng_3', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「青城的早晚课在卯时，别在这时候上山。」'],
  ['43_sect_disciples.json', 'disciple_kunlun_0', ['portrait', 'voice', 'catchphrase'], '「阿弥陀佛。」', '「昆仑冷，进门前先把鞋底的雪磕干净。」'],
  ['43_sect_disciples.json', 'disciple_kunlun_3', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「掌门在里头。你先说说为着什么来的。」'],
  ['43_sect_disciples.json', 'disciple_wuyun_2', ['portrait', 'voice', 'catchphrase'], '「施主有事？」', '「温家不管江湖事。你要问路，出门往东。」'],
  /* ⚠️ 罗汉门那两条（disciple_luohan_0/2）**本轮不动**：按表它属「无」档，可它自己的
     名字就叫「罗汉」、掌门 desc 里也写着「罗汉」—— 判红等于不许它提自家门名。
     像是你那张表漏了这一家，等你补一句再改，我不替你猜。 */

  /* —— 第四轮：team-lead 判红的 2 条 + 他表里漏列的第 9 条 —— */
  /* 赎身是青楼词，只在 brothel 放行；醉仙楼·二楼雅间不是青楼 ⇒ 改文案 */
  ['40_npcs.json', 'npcv_154', ['desc'],
    '脸上敷着粉，粉有点厚，眉画得又黑又直，一报价钱就笑，提到赎身的事笑意就收了。',
    '脸上敷着粉，粉有点厚，眉画得又黑又直，一报价钱就笑，提到往后怎么办笑意就收了。'],
  /* 柜台/掌柜只放行 market/street；皇城织造局是官署不是铺面 ⇒ 改文案 */
  ['40_npcs.json', 'npcv_239', ['desc'],
    '手里托着个木盘，盘上摞着碗，记性好，谁点了什么从不出错，掌柜二字出口前，先朝柜台那边瞟一眼。',
    '手里托着个木盘，盘上摞着一叠料样，记性好，谁领走哪一批从不出错，回话之前先朝上首那边瞟一眼。'],
  /* ⚠️ npcv_163「坐在船尾…橹」**不改**，留红待裁。理由：他 tag = boatman，
     本人 desc 写着「脸上被江风吹得红，手不离篙」—— 这是有意塑造的船夫，
     橹是他的本色，改掉就是把对的内容改错。建议把「本色词跟着身份走」从
     「水上门派」扩到「船家职业族（tag = boatman/船家/艄公/渔夫）」，等你一句话。 */

  /* —— 农田/药圃：把「客官」换成田里人的话 —— */
  ['40_npcs.json', 'npcv_004', ['talk', 1], '地里的草还没薅完，客官自便。', '稗子比稻子还高，得赶在晌午前薅完。'],
  ['40_npcs.json', 'npcv_037', ['talk', 1], '地里的草还没薅完，客官自便。', '窝棚里没茶，你自己找个地方坐。'],
  ['40_npcs.json', 'npcv_037', ['portrait', 'voice', 'catchphrase'], '地里的活儿忙，客官自便。', '地里的活儿忙，站一边先歇着。'],
  ['40_npcs.json', 'npcv_103', ['talk', 1], '地里的草还没薅完，客官自便。', '打谷场的石磙还烫着，别光着脚踩。'],
  ['40_npcs.json', 'npcv_136', ['talk', 1], '地里的草还没薅完，客官自便。', '这块地刚上过粪，绕着走。'],
  ['40_npcs.json', 'npcv_169', ['talk', 1], '地里的草还没薅完，客官自便。', '田埂窄，挑担子的先过。'],
  ['40_npcs.json', 'npcv_235', ['talk', 1], '地里的草还没薅完，客官自便。', '秧还浅，水别放得太满。'],
  ['40_npcs.json', 'npcv_268', ['talk', 1], '地里的草还没薅完，客官自便。', '牛刚喂过，别靠太近，它会顶人。'],
  ['40_npcs.json', 'npcv_042', ['talk', 1], '价钱好商量，客官是爽快人。', '这几味药沾手就麻，要动先问我要手套。'],
  ['40_npcs.json', 'npcv_205', ['talk', 1], '小号本小利薄，不赊账。', '这几味药出不得圃，要就在这儿称。'],
  ['40_npcs.json', 'npcv_205', ['desc'],
    '柜台后站着，围裙上全是油点，梳着双鬟，鬓角抿得齐整，眼睛始终盯着大堂，谁进来都知道。',
    '蹲在药畦里，袖口沾着药汁，指甲缝是黑的，梳着双鬟，鬓角抿得齐整，哪株被谁碰过她都记得。'],

  /* —— 山地 —— */
  ['40_npcs.json', 'npcv_013', ['talk', 1], '客官赏口吃的吧。', '上山的路长，赏口干粮吧。'],
  ['40_npcs.json', 'npcv_034', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '金顶风大，站稳了再看景。'],
  ['40_npcs.json', 'npcv_108', ['talk', 1], '价钱好商量，客官是爽快人。', '坪上没东西卖，只有一瓢水，自己舀。'],
  ['40_npcs.json', 'npcv_112', ['talk', 1], '客官赏口吃的吧。', '后山少人来，讨口吃的得碰运气。'],
  ['40_npcs.json', 'npcv_133', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '金顶的云在脚下走，说话小声些。'],
  ['40_npcs.json', 'npcv_178', ['talk', 1], '客官赏口吃的吧。', '进山的人多，讨口干粮不费事。'],
  ['40_npcs.json', 'npcv_264', ['talk', 0], '客官喝茶？新到的龙井。', '峰上没茶，只有化开的雪水。'],
  ['40_npcs.json', 'npcv_139', ['talk', 1], '小号本小利薄，不赊账。', '蛇阵不是路，原路退回去。'],

  /* —— 林 / 水 / 绿洲 / 蛊池 —— */
  ['40_npcs.json', 'npcv_046', ['talk', 1], '客官赏口吃的吧。', '桃林里没人家，讨口吃的得看运气。'],
  ['40_npcs.json', 'npcv_207', ['talk', 1], '价钱好商量，客官是爽快人。', '桃子不许摘，岛上留着酿酒用。'],
  ['40_npcs.json', 'npcv_070', ['talk', 1], '地里的草还没薅完，客官自便。', '塘里的水刚引过来，别下去蹚。'],
  ['40_npcs.json', 'npcv_145', ['talk', 1], '客官赏口吃的吧。', '给水不给粮，我自己也不够。'],
  ['40_npcs.json', 'npcv_277', ['talk', 1], '客官赏口吃的吧。', '池边别蹲，水里的东西认生人。'],

  /* —— 洞窟 —— */
  ['40_npcs.json', 'npcv_075', ['talk', 1], '价钱好商量，客官是爽快人。', '墓里没有买卖，只有规矩。'],
  ['40_npcs.json', 'npcv_079', ['talk', 1], '客官赏口吃的吧。', '暗道里黑，摸着墙走。'],
  ['40_npcs.json', 'npcv_231', ['talk', 0], '客官喝茶？新到的龙井。', '石壁上的字，你看得懂么？'],
  ['40_npcs.json', 'npcv_232', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '暗道尽头塌了，别再往前。'],
  ['40_npcs.json', 'npcv_265', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '后洞是思过的地方，说话等于白说。'],

  /* —— 寺观 —— */
  ['40_npcs.json', 'npcv_198', ['talk', 0], '客官喝茶？新到的龙井。', '塔林是埋人的地方，别高声。'],
  ['40_npcs.json', 'npcv_199', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '武当山门不卖东西，只问来意。'],

  /* —— 皇城 / 衙署 / 蜀道 —— */
  ['40_npcs.json', 'npcv_100', ['talk', 1], '客官赶路么？前头那家铺子，秤准。', '织造局的料子有定数，一尺也不能少。'],
  ['40_npcs.json', 'npcv_238', ['talk', 1], '小号本小利薄，不赊账。', '午门前不许停留，快走。'],
  ['40_npcs.json', 'npcv_271', ['talk', 1], '小号本小利薄，不赊账。', '栈道窄，歇脚可以，别挡着挑夫。'],
  ['40_npcs.json', 'bureau_clerk', ['talk', 0], '客官，衙门重地，有事递牌子。', '签押房不是说话的地方，有事递牌子。'],
];

function getPath(o, p) { let c = o; for (const k of p) { if (c == null) return undefined; c = c[k]; } return c; }
function setPath(o, p, v) { let c = o; for (let i = 0; i < p.length - 1; i++) { if (c[p[i]] == null) c[p[i]] = {}; c = c[p[i]]; } c[p[p.length - 1]] = v; }

/* ---------- 载入 ---------- */
const cache = {};
function load(f) {
  if (!cache[f]) cache[f] = { json: JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')), dirty: false };
  return cache[f];
}

/* ---------- ① 句子改写 ---------- */
let okN = 0; const errs = [];
for (const [file, id, p, oldV, newV] of PATCH) {
  const { json } = load(file);
  const n = json.npcs && json.npcs[id];
  if (!n) { errs.push('找不到 NPC：' + file + ' · ' + id); continue; }
  const cur = getPath(n, p);
  if (cur !== oldV) {
    errs.push('原句对不上（跳过，不写）：' + id + ' · ' + p.join('.') + '  现值=' + JSON.stringify(cur));
    continue;
  }
  setPath(n, p, newV);
  load(file).dirty = true;
  okN++;
}

/* ---------- ② NPC 拼音名 → 中文（从房间名推导，不编） ---------- */
/* ⚠️ 房间在磁盘上是**分片叠加**的：`73_sects_place.json` 给出 name/desc，
   `7x_*.json` 只在后面补一段 exits。用 Object.assign 会把先前的 name 整块冲掉
   （实测 taishan_hall 只剩 {id, exits}，name 没了）—— 必须深合并，
   并且按文件名排序，跟引擎 World.loadBaseData() 的加载顺序对齐。 */
function deepMerge(dst, src) {
  for (const k of Object.keys(src)) {
    const a = dst[k], b = src[k];
    if (Array.isArray(b)) { dst[k] = b; continue; }          // 数组整体替换，与引擎 arrayMode:'replace' 同口径
    if (b && typeof b === 'object' && a && typeof a === 'object') { deepMerge(a, b); continue; }
    dst[k] = b;
  }
  return dst;
}
const roomsAll = {};
for (const f of fs.readdirSync(DATA).filter(x => /^\d+_.*\.json$/.test(x)).sort()) {
  const j = load(f).json;
  if (j.rooms) deepMerge(roomsAll, j.rooms);
}
console.log('房间表载入：' + Object.keys(roomsAll).length + ' 间'
  + '；taishan_hall 在表内：' + !!roomsAll.taishan_hall
  + '；diancang_gate 在表内：' + !!roomsAll.diancang_gate);
let nameN = 0;
{
  const { json, dirty } = load('42_sect_guards.json');
  for (const id of Object.keys(json.npcs || {})) {
    const n = json.npcs[id];
    /* ⚠️ 大小写都要收：`hengshanN弟子`（北岳恒山）里那个大写 N 差点漏网 */
    if (!/^[a-zA-Z]+(弟子|门房|守卫)?$/.test(String(n.name || ''))) continue;
    if (!/^[a-zA-Z]/.test(String(n.name || ''))) continue;
    const r = roomsAll[n.room];
    if (!r || !r.name) { errs.push('名字要改但取不到房间名：' + id); continue; }
    const sect = String(r.name).split('·')[0];
    const tail = String(n.name).replace(/^[a-zA-Z]+/, '');
    n.name = sect + tail;
    load('42_sect_guards.json').dirty = true;
    nameN++;
  }
}

/* ---------- ③ 任务文本里的裸房间 id ---------- */
let qN = 0;
{
  const files = fs.readdirSync(DATA).filter(x => /^\d+_.*\.json$/.test(x));
  for (const f of files) {
    const { json } = load(f);
    if (!json.quests) continue;
    for (const qid of Object.keys(json.quests)) {
      const q = json.quests[qid];
      for (const st of (q.stages || [])) {
        if (typeof st.desc !== 'string') continue;
        const m = st.desc.match(/^([a-zA-Z][a-zA-Z0-9_]*_hall)：/);
        if (!m) continue;
        const r = roomsAll[m[1]];
        if (!r || !r.name) { errs.push('任务文本要改但取不到房间名：' + qid + ' → ' + m[1] + '  typeof=' + typeof r + ' 值=' + JSON.stringify(r).slice(0, 60)); continue; }
        st.desc = st.desc.replace(m[0], r.name + '：');
        load(f).dirty = true;
        qN++;
      }
    }
  }
}

console.log('① 场景错置改写：' + okN + ' / ' + PATCH.length + ' 条');
console.log('② 拼音 NPC 名改中文：' + nameN + ' 处');
console.log('③ 任务文本裸 id 改中文：' + qN + ' 处');
if (errs.length) { console.log('\n⚠ 未通过 ' + errs.length + ' 条：'); errs.forEach(e => console.log('   ' + e)); }

if (DRY) { console.log('\n--dry：不落盘。'); process.exit(errs.length ? 1 : 0); }

/* ---------- 落盘 ---------- */
for (const f of Object.keys(cache)) {
  if (!cache[f].dirty) continue;
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(cache[f].json, null, 1) + '\n', 'utf8');
  console.log('已写入 ' + f);
}

/* ---------- 闸 B②：真引擎 boot，把字段实际值打出来当断言 ---------- */
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const e = new GameEngine({ seed: 20261022, mods: false });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const N = e.world.data.npcs;
const Q = e.world.data.quests;

let pass = 0, fail = 0;
for (const [file, id, p, oldV, newV] of PATCH) {
  const cur = N[id] ? getPath(N[id], p) : undefined;
  if (cur === newV) pass++;
  else { fail++; console.log('  ✘ ' + id + '.' + p.join('.') + ' 实际=' + JSON.stringify(cur)); }
}
console.log('\n闸 B② 真引擎断言（句子）：' + pass + ' / ' + (pass + fail) + ' 条真的变成了目标句');

let npass = 0, nfail = 0;
for (const id of Object.keys(N)) {
  if (N[id] && /[A-Za-z]{2,}/.test(String(N[id].name || '')) && /[一-龥]/.test(String(N[id].name || ''))) {
    nfail++; console.log('  ✘ 仍有拼音名：' + id + ' = ' + N[id].name);
  }
}
if (nfail === 0) npass = 1;
console.log('闸 B② 真引擎断言（NPC 名）：' + (nfail === 0 ? '全库已无「中文里夹拉丁」的 NPC 名' : nfail + ' 处残留'));

let qpass = 0, qfail = 0;
for (const qid of Object.keys(Q)) {
  for (const st of (Q[qid].stages || [])) {
    if (typeof st.desc === 'string' && /^[a-zA-Z][a-zA-Z0-9_]*_hall：/.test(st.desc)) {
      qfail++; console.log('  ✘ 仍有裸 id：' + qid + ' → ' + st.desc.slice(0, 40));
    }
  }
}
console.log('闸 B② 真引擎断言（任务文本）：' + (qfail === 0 ? '已无 `_hall：` 裸 id 开头' : qfail + ' 处残留'));
process.exit((fail + nfail + qfail + errs.length) ? 1 : 0);
