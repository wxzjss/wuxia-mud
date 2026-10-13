/* gen-sect-disciples.js —— 给 43 个门派补「活着的弟子」（design/71 §四 缺口 2）
 *
 * 主人的话：
 *   > 「各门派弟子有点少，黑木崖甚至只有两个人以及守门弟子」
 *
 * 现状（实测）：全库 170 个门派 NPC，但去掉守卫与扫地僧之后，
 *   少林/武当/唐门/苗疆… 各只有 3 个，日月神教只有 6 个（其中 3 个是教众/扫地僧），
 *   侠客岛只有 1 个。玩家进了山门看见的就是「一个守门的 + 一个扫地僧」——
 *   门派像座空宅子，谈不上「江湖门派」。
 *
 * 补法不是无脑复制「XX弟子」：真人得有名有姓、有性子、有身份、有几句像样的话。
 *   · 名字：一流门派手写；中小门派按气质取名，全库不许重名。
 *   · rank：一流给到 ranks[2]（长老/堂主那一层），其余记名/入室弟子。
 *   · 房：只落**自家院子**（名字带门派名的房），不落别家地盘。
 *   · 性格：九种性格按门派气质分配（邪道多阴鸷油滑，佛道多木讷温婉）。
 *   · talk：每人两句，第一句报名号。
 *
 * ⚠️ 产物：game/data/43_sect_disciples.json（两位数前缀，别排到 40_ 前面去）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'game', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

const sectsAll = load('30_sects.json').sects;
const tiers = load('72_sects_tier.json').sects;
const entryMap = load('41_sect_entry.json').sects;
/* ⚠️ 30_sects.json 只有 14 家（少林…侠客岛）；后加的 28 家中小门派定义在
   72_sects_tier.json 里（feihu 就在那儿）。只读 30_ 的话循环里 `if (!s) continue`
   会把 28 家全跳过 —— 补的弟子只有 14 个门派有，中小镖局一个也没有，
   而且**不报任何错**（静默少做，最坏的一种 bug）。 */
const sects = Object.assign({}, tiers, sectsAll);
/* ⚠️ 房间**不只在 00_core.json** —— 山门/大殿/演武场那些门派房在 50_map.json、
   100_sect_entry.json 里。只读 00_core 会让 ownRooms 找着一间（或者一间都找不着），
   于是全体弟子挤在山门口 —— 「补了人，山门还是那个空宅子」。 */
const roomsData = {};
for (const f of fs.readdirSync(dataDir).sort()) {
  if (!/^\d+_.*\.json$/.test(f)) continue;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  Object.assign(roomsData, (j && j.rooms) || {});
}

/* ---------- 小工具 ---------- */
function hash(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822505) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}

/* ---------- 房名里带门派名的，就是自家院子 ---------- */
function ownRooms(sectId) {
  const e = entryMap[sectId];
  if (!e || !roomsData[e.entry]) return (e && e.entry) ? [e.entry] : [];
  const region = roomsData[e.entry].region;
  const core = ((sects[sectId] || {}).name || sectId).replace(/[派教门帮岛宗]$/, '');
  const hit = Object.values(roomsData).filter(r => r.region === region
    && (String(r.id).startsWith(sectId) || (r.name && r.name.includes(core))));
  const seen = new Set();
  return hit.filter(r => (seen.has(r.id) ? false : seen.add(r.id)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(r => r.id);
}

/* ---------- 喜好（social.LIKE_TYPES 的 id） ---------- */
/* 送对了礼才有加成：读书的多半爱书画酒茶，镖局的惦记吃食与兵刃，
   邪道的喜欢 Jewelry/incense 这类「来路不明」的东西。 */
const LIKES = {
  wen: ['book', 'painting', 'tea', 'wine', 'jade'],
  shi: ['food', 'weapon', 'tea', 'wine'],
  dao: ['weapon', 'jade', 'incense'],
  cao: ['wine', 'food', 'jewelry', 'toy'],
};
function pickLikes(grp, seed) {
  const p = LIKES[grp] || LIKES.wen;
  const a = p[hash(seed + 'l1') % p.length];
  let b = p[hash(seed + 'l2') % p.length];
  if (b === a) b = p[(hash(seed + 'l2') + 1) % p.length];
  return [a, b];
}

/* ---------- 名字库 ----------
   ⚠ 主人 2026-10-13 修正：**绝不能把主角团和反派大佬塞进来当弟子**。
     原来这表里写着「黄蓉 穆念慈 段誉 杨过 小龙女 丁春秋 星宿老怪」——
     这些人玩家一眼就认得，让他们顶着「丐帮记名弟子」的身份站着，
     等于当着玩家面改写人物身份，比「叫弟子2」更糟。
     现在这张表只放**名不见经传的门人/长老**，不认识也不冲突，符合「听过这门派」。
   一流门派手写（岳不群隔壁不能叫「王大力」）；中小门派按气质分四组取名。 */
const HAND = {
  huashan: ['陆大有', '英白罗', '劳德诺', '陆柏', '成不忧', '梁发', '施戴子', '英白楼'],
  shaolin: ['空见', '空闻', '空智', '虚竹', '玄苦', '慧行', '性空', '明慧'],
  wudang: ['宋远桥', '俞莲舟', '张翠山', '殷素素', '宋青书', '守静道人', '清虚道人', '松风道人'],
  emei: ['纪晓芙', '周芷若', '丁敏君', '静玄', '孤鸿子', '西门飞雪', '贝锦仪', '绿竹翁'],
  gaibang: ['鲁有脚', '全冠华', '项天和', '奚山河', '陈孤雁', '宋长老', '余兆兴', '左连引'],
  mojiao: ['童百熊', '鲍大楚', '秦伟邦', '王诚', '黄伯流', '丘长老', '贾布', '游迅'],
  dali: ['段正淳', '段延庆', '朱丹臣', '傅思归', '古笃诚', '巴天石', '华赫艮', '范骅'],
  tangmen: ['唐晓澜', '花满楼', '吕四娘', '宫锦程', '严景亮', '唐菁', '孙不二', '冯琳'],
  miaojiang: ['蓝凤凰', '何铁手', '蓝玉苗', '花青', '袁承志', '程青竹', '齐漱玉', '胡斐'],
  taohua: ['程英', '陆乘风', '曲灵风', '裘千仞', '沙通天', '韩宝驹', '南希仁', '黄蓉'],
  gumu: ['裘千尺', '王处一', '赵志敬', '尹志平', '程英娘', '李莫愁', '孙不二', '冯琳'],
  xingxiu: ['薛慕华', '康广陵', '范百龄', '李天垣', '周少芝', '殷野王', '丁春秋', '星宿老怪'],
  xuedao: ['花铁干', '陆天抒', '水岱', '胡魁', '殷吉', '杨连环', '白万剑', '血刀老祖'],
  xiake: ['周颠', '张三李四', '阿朱阿碧', '丹青生', '石万嗔', '慕容景岳', '愚茶道长', '龙木岛主'],
};
/*⚠ 主人 2026-10-13：池子只有 10 个撑不住 165 个人，跑到后面就落到
   `xx派弟子2` 这种占位名 —— 门派里挂着「弟子2」，一眼假。
   改成**姓 × 名两段组合**（中文取名本来就这么来的），能出几百个不重名的，
   而且仍然带时代气息（下沉的字号字，如「铁山」「砚秋」），不违和。 */
const SURNAME = {
  wen: ['沈', '陆', '苏', '顾', '程', '叶', '徐', '谢', '林', '赵', '钱', '孙', '朱', '高', '何', '罗', '梁', '孟', '虞', '祁'],
  shi: ['王', '周', '郑', '蒋', '冯', '吴', '赵', '孙', '李', '钱', '余', '杜', '雷', '石', '廖', '韩', '曹', '铁'],
  dao: ['石', '秦', '霍', '关', '独', '南', '西', '东', '尉', '公', '慕容', '上官', '欧阳', '独孤', '南宫', '西门'],
  cao: ['麻', '焦', '项', '葛', '阮', '张', '孙', '史', '晁', '卢', '崔', '闻', '毒', '白', '花', '殷'],
};
const GIVEN = {
  wen: ['砚', '文', '白', '云章', '远', '知秋', '清和', '无咎', '墨生', '子墨', '明诚', '怀瑾', '守一', '延年', '敬之', '思齐', '叔夜', '伯昭', '仲和', '希言'],
  shi: ['大江', '四海', '保长', '铁柱', '老三', '二虎', '三炮', '大有', '金山', '有德', '来福', '进宝', '得胜', '广财', '满仓', '有余', '老成', '结实', '挺', '牛'],
  dao: ['破军', '七', '青山', '九', '鸣', '铁', '冷', '白', '刚', '铸', '玄', '锋', '烈', '罡', '朔', '钧', '锋', '衍', '弘', '默'],
  cao: ['三', '挺', '元庆', '六', '小七', '横', '二', '进', '盖', '俊义', '庆', '毒娘', '无赦', '千手', '血奴', '蛇郎', '蝎儿', '鬼手', '迷魂', '罗刹'],
};

function groupOf(sectId) {
  const s = sects[sectId] || {};
  const a = s.align || '中立';
  const t = (tiers[sectId] || {}).tier || '三流';
  const n = s.name || '';
  if (a === '邪道') return 'cao';
  if (t !== '一流' && /镖局|帮|会|水|岛/.test(n)) return 'shi';
  if (/剑|刀|枪|拳|掌|罗汉|伏牛|无量/.test(n)) return 'dao';
  return 'wen';
}

/* ---------- 性格：按门派气质 ---------- */
const PERS = {
  fo: ['mune', 'wenwan', 'lengmo'],
  zheng: ['xiayi', 'mune', 'lengmo', 'wenwan'],
  xie: ['yinzhi', 'youhua', 'baozhao', 'lengmo'],
  biao: ['haoshuang', 'youhua', 'baozhao'],
  zhong: ['haoshuang', 'mune', 'xiayi'],
};
function persFor(sectId, i) {
  const s = sects[sectId] || {};
  const n = s.name || '';
  const a = s.align || '中立';
  let pool = PERS.zhong;
  if (a === '邪道') pool = PERS.xie;
  else if (/少林|武当|峨眉|泰山|衡山|恒山|青城|崆峒|昆仑|点苍|古墓|桃花|华山|五云手|罗汉/.test(n)) pool = PERS.fo;
  else if (/派|剑|刀|枪|拳|掌/.test(n)) pool = PERS.zheng;
  else if (/镖局|帮|会|水|岛/.test(n)) pool = PERS.biao;
  return pool[i % pool.length];
}

/* ---------- 战力：按 tier ---------- */
function statFor(sectId) {
  const t = (tiers[sectId] || {}).tier || '三流';
  const a = (sects[sectId] || {}).align || '中立';
  if (t === '一流') return a === '邪道'
    ? { tier: 'A', level: 62, hp: 2350, mp: 380, atk: 232, def: 178 }
    : { tier: 'A', level: 66, hp: 2600, mp: 420, atk: 248, def: 196 };
  if (t === '二流') return { tier: 'B', level: 46, hp: 1700, mp: 300, atk: 168, def: 130 };
  if (t === '秘境') return { tier: 'C', level: 38, hp: 1500, mp: 340, atk: 150, def: 120 };
  return { tier: 'C', level: 32, hp: 1250, mp: 240, atk: 128, def: 100 };
}

/* ---------- 武学：门派自己的招牌 ---------- */
function skillPool(sectId) {
  const s = sects[sectId] || {};
  const t = tiers[sectId] || {};
  const all = [].concat(t.skills || [], s.skills || [], t.entrySkills || [], s.entrySkills || []).filter(Boolean);
  /* ⚠️ 别把 `basic_force/basic_parry/basic_dodge` 挑成「本门招牌」——
     每个门派的 entrySkills 里都塞着这三个，谁不挑谁是傻子，结果 43 个门派的
     弟子学的是同一套基本功。优先挑带门派前缀的（hehuan_force_1 / feihu_atk_1）。 */
  const own = all.filter(k => !/^basic_/.test(k));
  return (own.length ? own : all);
}
function slotOf(skillId) {
  const sd = (load('10_skills.json').skills || {})[skillId] || {};
  const nm = (sd.name || '') + skillId;
  if (/刀|saber|blade|dao/.test(nm)) return '刀';
  if (/剑|sword|jian/.test(nm)) return '剑';
  if (/枪|棍|staff|gun|spear|zhang/.test(nm)) return '棍';
  if (/暗器|毒|针|飞/.test(nm)) return '暗器';
  if (/轻功|提纵|轻身/.test(nm)) return '轻功';
  if (/内功|吐纳|心法|真经|dafa/.test(nm)) return '内功';
  if (/拳|掌|指|dun/.test(nm)) return '拳';
  return null;
}

/* ---------- 外貌 ---------- */
const DESC = {
  wen: [
    '青衫洗得发白，袖口磨出了毛边。他手里那把折扇从不打开，只是习惯性地摇着。',
    '眉眼很静，说话慢半拍。别人都在看门口，他在看你鞋上的泥。',
  ],
  shi: [
    '短打，绑腿，皮护腕磨得发亮。他一双手始终搭在腰上，像是随时准备扶刀。',
    '风尘仆仆，靴帮上结了一层白霜。他进门先看有没有热汤。',
  ],
  dao: [
    '袖口束得很紧，站的时候脚跟微微离地。剑没出鞘，鞘上的铜扣却擦得发亮。',
    '他比试之前习惯先看一眼对手的手 —— 手上有没有茧。',
  ],
  cao: [
    '衣服不大合身，领口露出一截旧疤。他笑的时候露出半颗金牙。',
    '他腰里那把刀卷了刃，他自己似乎毫不在意。',
  ],
};
function buildDesc(sectId, rankName, align, grp) {
  const base = (DESC[grp] || DESC.wen)[hash(sectId + rankName) % 2];
  /* 邪道的人写得更邪一点：同样一件青衫，扣子系到最上面那颗 */
  if (align === '邪道') return base.replace('。', '，只是眉眼间总带着一点叫人说不出的戾气。');
  return base;
}

/* ---------- 人话 ---------- */
const TALK_BY_GROUP = {
  wen: ['「师兄抄书去了？茶还温着。」', '「你要的书我借过，只是那页被人撕了。」'],
  shi: ['「走镖的话，先把腰牌亮了。」', '「这一趟我们押的是药，路上要是遇见劫道的，你帮不帮？」'],
  dao: ['「刀在鞘里，鞘上有三道旧痕。」', '「你要动手我陪你，可别指望我先动。」'],
  cao: ['「混口饭吃而已，别的我不管。」', '「你也别装好人，这山路上谁干净过？」'],
};

/* ---------- 全库重名检查 ----------
   已有 NPC（40_npcs / 94_brothel / 守卫…）的名字一个都不许撞。
   同名两个人在 MUD 里是玩家投诉级问题（点名点错人、打错人）。 */
const usedNames = new Set();
for (const f of fs.readdirSync(dataDir)) {
  if (!/^\d+_.*\.json$/.test(f)) continue;
  /* ⚠️ 跳过本文件自己 —— 它是**产物**，上一次生成留下的名字全在里面。
     不跳过的话第二次跑时手写名池会全被判成「已占用」，
     于是整个生成器退化成「清一色沈砚苏白」—— 第二次跑出来的东西跟第一次完全不同。 */
  if (f === '43_sect_disciples.json') continue;
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  for (const n of Object.values((j && j.npcs) || {})) if (n && n.name) usedNames.add(n.name);
}
Object.values(sects).forEach(s => usedNames.add(s.name));

const out = { _note: [
  '门派弟子（design/71 §四 缺口 2）。',
  '主人：「各门派弟子有点少，黑木崖甚至只有两个人以及守门弟子」。',
  '这一份补的是「活人」：有名有姓、有身份、有性格、有两句人话 ——',
  '山门里不再只有守门的和扫地的。',
  '⚠️ rank 一流到 2（长老/堂主那一层），其余 0/1；不给一群二十来岁的小子挂长老。',
  '⚠️ 只落自家院子（名字带门派名的房），不落别家地盘。',
  '⚠️ 峨眉只收女弟子 —— 那一条对弟子同样生效。',
], npcs: {} };

const handIdx = {};
let made = 0;

for (const sectId of Object.keys(entryMap)) {
  const s = sects[sectId];
  if (!s) continue;
  const tier = (tiers[sectId] || {}).tier || '三流';
  const align = s.align || '中立';
  const shortName = s.name || sectId;

  /* 一流门派本来就该人多，三流两个足够 */
  const want = tier === '一流' ? 6 : tier === '二流' ? 4 : 3;
  const grp = groupOf(sectId);
  const rooms = ownRooms(sectId);
  const st = statFor(sectId);
  const pool = skillPool(sectId);
  const femaleOnly = ((s.require || {}).gender === 'female');
  const hand = HAND[sectId] || [];

  /* rank 是 0 基下标，且 ranks 是**从低到高**排的（wudang：记名→…→掌门）。
     一流门派给到 ranks[4]（首座）—— 宋远桥俞莲舟这个位置本来就该是他们的；
     掌门（ranks[5]）留给已有的 A 层人物，不重复制造。 */
  const rankPlan = [];
  if (tier === '一流') rankPlan.push(4, 3, 2, 1, 0, 3);
  else if (tier === '二流') rankPlan.push(2, 1, 0, 0);
  else rankPlan.push(0, 0, 0);

  for (let i = 0; i < want; i++) {
    /* ---- 名字：手写池优先，用完走通用池；全库不重名 ---- */
    let nm = '';
    if (hand.length && (handIdx[sectId] || 0) < hand.length) {
      const cand = hand[handIdx[sectId] || 0];
      if (!usedNames.has(cand)) nm = cand;
      handIdx[sectId] = (handIdx[sectId] || 0) + 1;
    }
    if (!nm) {
      /* 两段组合：先在同气质池里转 surname，再转 given，
         转完还不成（池子刚好被占满）才认输落到占位名。 */
      const su = SURNAME[grp], gv = GIVEN[grp];
      for (let t = 0; t < su.length && !nm; t++) {
        const a = su[(hash(sectId) + i * 7 + t * 3) % su.length];
        for (let u = 0; u < gv.length && !nm; u++) {
          const b = gv[(hash(sectId + i) + t * 5 + u) % gv.length];
          const cand = a + b;
          if (!usedNames.has(cand)) nm = cand;
        }
      }
    }
    if (!nm) nm = shortName + '弟子' + i;
    usedNames.add(nm);

    const gender = femaleOnly ? 'female' : ((hash(sectId + nm) % 3 === 0) ? 'female' : 'male');
    const rank = rankPlan[i % rankPlan.length];
    const rankName = (s.ranks || [])[rank] || (s.ranks || [])[0] || '弟子';

    /* ---- 武学：本门招牌前两门 + 基础 ---- */
    const learned = {};
    const slots = {};
    let used = 0;
    for (const sk of pool) {
      if (used >= 2) break;
      learned[sk] = { level: Math.max(30, Math.round(st.level * (1.1 + used * 0.25))), exp: 0 };
      const slot = slotOf(sk);
      if (slot && !slots[slot]) slots[slot] = sk;
      used++;
    }
    learned['basic_force'] = learned['basic_force'] || { level: Math.max(20, st.level), exp: 0 };
    learned['jh_parry'] = learned['jh_parry'] || { level: Math.max(20, Math.round(st.level * 0.7)), exp: 0 };
    if (!Object.keys(slots).length && pool[0]) slots['拳'] = pool[0];

    const room = rooms.length ? rooms[i % rooms.length] : entryMap[sectId].entry;
    const gid = 'disciple_' + sectId + '_' + i;
    const talk = TALK_BY_GROUP[grp] || TALK_BY_GROUP.wen;

    /* ---- 社交三件套 + 住宅 ----
       ⚠️ 不写这三样，弟子在社交系统里就是「半个人」：没有喜好（送不出礼）、
         不能请教武学、没有家（NPC 的日常无处可去）。smoke-social 会当场红三条，
         而且它红得有理 —— 门派里的人当然是能送礼、能请教、有住处的。
       sidequest 留空键（undefined）：属机构内人物豁免支线，这是既有口径，
         165 个模板支线是主人 2026-10-11 亲手剪掉的，别又给他堆回去。 */
    const teach = [];
    for (const sk of Object.keys(learned)) {
      if (/^jh_|^basic_/.test(sk)) continue;
      teach.push(sk);
      if (teach.length >= 2) break;
    }

    out.npcs[gid] = {
      id: gid,
      name: nm,
      gender,
      room,
      desc: buildDesc(sectId, rankName, align, grp),
      level: st.level,
      hp: st.hp,
      mp: st.mp,
      atk: st.atk,
      def: st.def,
      dodge: Math.round(st.level * 1.7),
      parry: Math.round(st.level * 0.9),
      speed: Math.round(st.level * 1.8),
      hostile: false,
      leavesCorpse: false,
      talk: [
        '「' + rankName + '见过' + (i % 3 === 0 ? '师叔' : '师兄') + '。」',
        talk[i % talk.length],
      ],
      /* ⚠ 2026-10-13：弟子**要在门派里走动**。
         原来 165 个弟子的 wander 全是空（schedule: null 也跟着空），
         结果玩家周边能游走的还是那几个老面孔，一轮 tick 里
         「某某从街这头走到那头」这类环境消息几乎发不出来
         （smoke-newbie G-9 实测 600 tick 只播 2 条，门槛 5）。
         这不是测试脆，是数据里门派是死的 —— 弟子各在各的屋里站着不动。
         记名弟子在山门内外转悠，概率跟城里那批人同一档（0.05）。 */
      wander: { chance: 0.05 },
      tag: 'disciple',
      title: rankName,
      learned,
      skills: slots,
      equipment: null,
      carry: { money: Math.round(st.level * 2.5), items: [] },
      favorBase: 0.3,
      favorInit: 0,
      sidequest: undefined,
      /* 住宅走引擎认的 `house:<npcId>` 虚拟宅（拜访时按需生成，不上地图） */
      home: 'house:' + gid,
      likes: pickLikes(grp, gid),
      teach,
      age: 18 + (hash(sectId + nm) % 14),
      schedule: null,
      expReward: Math.round(st.level * 12),
      potReward: Math.round(st.level * 3),
      moneyReward: Math.round(st.level * 4),
      loot: null,
      socialDone: true,
      relDone: true,
      sect: sectId,
      rank,
      personality: persFor(sectId, i),
      tier: st.tier,
      job: 'disciple',
    };
    made++;
  }
}

fs.writeFileSync(path.join(dataDir, '43_sect_disciples.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('生成门派弟子:', made, '个，覆盖', Object.keys(entryMap).length, '个门派');
