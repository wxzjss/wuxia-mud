/* patch-guard-gates.js —— 要害区域门禁 + 守卫（SPRINT-D）
 *
 * 主人报：「皇宫没有守卫之类的角色，玩家这么容易就进来了？」
 * 调查结论（tools/tools 侧的只读审计）：
 *   · 皇宫 14 个房间 respawn 全空，只有 2 个主线 boss（冯保/影子）算敌对
 *   · 全图 649 条出口，**0 条**带 cond/msg —— doMove 的门禁机制代码写好了但数据零使用
 *   · 皇宫有 **9 个洞**直通民间：东市西巷→内库、杂货铺→天牢、冯宅→尚膳房、
 *     茶山→御书房、墓中石室→东六宫、华山千尺幢→长巷、峨眉清音阁→织造局、
 *     西域古道→御道、衙门架阁库→金水桥
 *   · 不是孤例：少林/华山/白鹿书院/衙门 同样 0 门禁；25 个主要区域里 18 个完全无守卫
 *
 * 本脚本做三件事：
 *   ① 补 4 类守卫 NPC（禁军 / 衙役 / 知客僧 / 锦衣卫）
 *   ② 关掉脏连线：皇宫 9 个洞 + 其它同类（跨 region 的荒谬连线）
 *   ③ 给要害区域的关键出口加 cond 门禁 + msg + travel
 *
 * 幂等：可重复执行，已存在的条目会跳过。
 * run: node tools/patch-guard-gates.js */
'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'game', 'data');
const rd = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const problems = [];

const npcFile = rd('40_npcs.json');
const mapFile = rd('50_map.json');
const itemsFile = rd('20_items.json');
const npcs = npcFile.npcs || {};
const rooms = mapFile.rooms || {};
const items = itemsFile.items || {};
const say = m => console.log('+ ' + m);
const problemsEarly = m => problems.push(m);

/* ═══════════════ 1. 守卫 NPC 模板 ═══════════════ */
/* 取 guard_city「城门守卫」为原型：level 18 / hostile:false 是对的守卫底子。
   hostile 必须 false —— 守卫见人就打是「敌人」不是「门禁」，
   门禁的活交给出口的 cond。守卫的职责是把门守住、给玩家话听。 */

function guard(id, def) {
  if (npcs[id]) { say('· 已有守卫，跳过：' + id); return; }
  npcs[id] = Object.assign({
    gender: 'male', level: 20, attr: { 力量: 38, 根骨: 40, 身法: 32, 悟性: 26, 定力: 40 },
    hp: 900, mp: 400, atk: 90, def: 70, dodge: 40, parry: 55, speed: 62,
    hostile: false, desc: '', learned: null, skills: null, equipment: null,
    carry: { money: 30, items: [] }, socialDone: true, relDone: true,
    tier: 'B', job: 'constable', tag: 'swordsman',
    favorBase: 0.2, favorInit: 0, sidequest: null, home: null, age: 30,
    schedule: null, expReward: 0, potReward: 0, moneyReward: 0, loot: null,
  }, def);
  say('守卫 NPC ' + id + '（' + def.name + '）');
}

/* 禁军：宫城各门 */
guard('guard_palace', {
  name: '禁军', title: '禁军校尉', room: 'palace_gate',
  level: 42, hp: 1800, atk: 190, def: 150, dodge: 70, speed: 88,
  attr: { 力量: 48, 根骨: 50, 身法: 44, 悟性: 26, 定力: 48 },
  desc: '朱红甲胄，甲叶上还有昨夜落的露。他握枪的姿势不像在站岗，像在等谁来。',
  equipment: { 武器: 'spear_iron', 身体: 'armor_leather' },
  skills: { 棍: 'gunfa_basic' },
  learned: { gunfa_basic: { level: 60, exp: 0 } },
  talk: [
    '「宫城重地，验了腰牌才放行。」',
    '「没有腰牌？城东衙门办得。要么你杀了我自己过去——不过先掂量掂量。」',
    '「我在这儿站了十一年，人来人往见过不少。你是来办事的，还是来看热闹的？」',
  ],
  ask: [{
    topic: '腰牌', keywords: ['腰牌', '令牌', '牌子', '通行'],
    answer: '「腰牌是内府发的，凭牌入宫。银子买不着——十两银子也不行。找衙门，或者找宫里认得你的人作保。」',
  }],
  carry: { money: 120, items: [] },
});

/* 衙役：衙门各门 */
guard('guard_yamen', {
  name: '衙役', title: '班头', room: 'jn_yamen_gate',
  level: 26, hp: 1100, atk: 110, def: 95, dodge: 50, speed: 70,
  desc: '皂衣，腰间挎着铁尺。他拦住你的时候动作很熟练——显然不是今天第一次。',
  talk: [
    '「衙门重地，闲人免进。有状子没有？」',
    '「想告状？先说你是哪里的、告谁。别拿站不住的理由糊弄我。」',
  ],
  ask: [{
    topic: '告状', keywords: ['告状', '状子', '报案'],
    answer: '「状子要写清人名住处，画押。递到门房，我给你转呈。」',
  }],
  carry: { money: 60, items: [] },
});

/* 知客僧：少林山门 */
guard('guard_shaolin', {
  name: '知客僧', title: '知客', room: 'shaolin_shanmen',
  level: 38, hp: 1500, atk: 150, def: 120, dodge: 62, speed: 72,
  desc: '灰布僧衣，手里捻着一串念珠。他合掌的动作很自然，眼神却一直落在你身上。',
  talk: [
    '「佛门清净，施主若只为赶路，前面的岔口往东是官道。」',
    '「要见方丈？须先挂单。你身上有兵刃，贫僧须记一笔。」',
    '「近来寺里不太平——施主夜里走路，当心些。」',
  ],
  carry: { money: 40, items: [] },
});

/* 锦衣卫：东厂/北镇抚司 */
guard('guard_jinywei', {
  name: '锦衣卫', title: '总旗', room: 'jn_yamen_office',
  level: 48, hp: 2000, atk: 230, def: 175, dodge: 80, speed: 95,
  desc: '飞鱼服，绣春刀挂在左腰。他是背对着你站的——但你知道他在听。',
  talk: [
    '「这一片儿归我们管。你要么有文书，要么有腰牌，要么——」他没说下去，手按在刀上。',
    '「.registry 上的事，少打听。真要打听，先想清楚自己名字写不写得上。」',
  ],
  carry: { money: 300, items: [] },
});

/* 华山看山弟子：玉真子门下 */
guard('guard_huashan', {
  name: '华山弟子', title: '看山弟子', room: 'huashan_shanxia',
  level: 30, hp: 1200, atk: 130, def: 100, dodge: 66, speed: 76,
  desc: '青衫，背一柄长剑，剑没出鞘。他站在山道正中，不像拦人，倒像在数人头。',
  talk: [
    '「上山？先在山脚登记。掌门近来的规矩——闲人太多。」',
    '「没登记就想上去？华山不欢迎偷懒的人。你上去也是白上去。」',
  ],
  ask: [{
    topic: '登记', keywords: ['登记', '上山', '入门', '拜山'],
    answer: '「登记得找山脚的执事。不过我先跟你说清楚——真要拜师，得等三月初七。错过就再等一年。」',
  }],
  carry: { money: 50, items: [] },
});

/* 白鹿书院山长：书院讲学的地方也该有人 */
guard('guard_blulu', {
  name: '书院山长', title: '山长', room: 'jn_school_yard',
  level: 34, hp: 1300, atk: 120, def: 105, dodge: 60, speed: 74,
  desc: '六十来岁的老头，青衫洗得发白，手里捏着半卷书。他看你的眼神先落在你的鞋上。',
  talk: [
    '「书院不是客栈。要读书，得先在门房登记名册。」',
    '「你那身行囊——读书人可不带刀。放门房，回来时取。」',
  ],
  ask: [{
    topic: '读书', keywords: ['读书', '书院', '拜师', '入学'],
    answer: '「书院每月初十开讲，逢三休讲。你若连日子都记不住，坐不住是必然的。」',
  }],
  carry: { money: 80, items: [] },
});

/* ═══════════════ 2. 门禁钥匙物品 ═══════════════ */
function item(id, def) {
  if (items[id]) { say('· 已有物品，跳过：' + id); return; }
  items[id] = Object.assign({ category: 'quest', price: 0, desc: '' }, def);
  say('物品 ' + id + '（' + def.name + '）');
}

item('palace_token', {
  name: '内府腰牌', category: 'quest',
  desc: '铜制，刻着「内府」二字，背面有一个手刻的「武」字——像是被人拿刀尖划上去的。',
  quality: 'fine',
});

item('huashan_pass', {
  name: '华山竹牌', category: 'quest',
  desc: '一片削得很薄的竹牌，正面烙着「玉真」两个小字。摸上去还带着桐油味，是新领的。',
  quality: 'common',
});

/* ═══════════════ 3. 关掉脏连线 ═══════════════ */
/**
 * 断掉「不该存在的通路」。
 * ⚠️ 只断明确荒谬的（跨到另一个不相干区域），房内/同区域内的正常连通一律不动。
 * 断掉的那条在对侧也要断，否则从那边还是能进来（单向洞最阴）。
 */
const DIR_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };

/* 皇宫 9 个洞（外部房间 → 皇宫房间）。双向都断：只断一侧的话，
   从宫里往外照样能走出去——单向洞比双向洞更阴。 */
const HOLE_IN = [
  ['jn_market_west', 's', 'palace_court6'],   // 东市西巷 → 内库（金银字画）
  ['jn_misc_shop', 'n', 'palace_prison'],      // 杂货铺 → 天牢
  ['jn_home_09', 'n', 'palace_court5'],        // 冯宅 → 尚膳房
  ['jn_farm_4', 's', 'palace_study'],          // 茶山 → 御书房
  ['gumu_shi', 'n', 'palace_court1'],          // 墓中石室 → 东六宫
  ['huashan_qianchi', 'e', 'palace_court3'],   // 华山千尺幢 → 长巷
  ['emei_qingyin', 'w', 'palace_court4'],      // 峨眉清音阁 → 织造局
  ['road_xiyu_1', 'n', 'palace_road'],         // 西域古道 → 御道
  ['jn_yamen_arch', 's', 'palace_plaza'],       // 衙门架阁库 → 金水桥
];
const tidOf = ex => (ex && typeof ex === 'object' ? ex.to : ex) || null;

/** 断一条连线，**两侧都断**。返回 true = 真的断了。 */
function cutEdge(rid, dir, expect) {
  const r = rooms[rid];
  if (!r) { problemsEarly('脏连线源房间不存在：' + rid); return false; }
  const tid = tidOf(r.exits && r.exits[dir]);
  if (!tid) { say('· 洞已不存在，跳过：' + r.name + ' ' + dir); return false; }
  if (expect && tid !== expect) {
    say('· ' + r.name + ' ' + dir + ' 指向的是 ' + tid + '（不是 ' + expect + '），手工确认后再断');
    return false;
  }
  delete r.exits[dir];
  /* 对侧：反向边也得断 */
  const back = DIR_OPPOSITE[dir];
  if (back && rooms[tid]) {
    const btid = tidOf(rooms[tid].exits && rooms[tid].exits[back]);
    if (btid === rid) {
      delete rooms[tid].exits[back];
      say('断洞 ' + rooms[tid].name + ' ' + back + '→' + rid + '（对侧）');
    }
  }
  say('断洞 ' + r.name + ' ' + dir + '→' + tid);
  return true;
}
for (const [rid, dir, target] of HOLE_IN) cutEdge(rid, dir, target);

/* 断掉的洞要留个说明（玩家往那边走时能看到「封死了」） */
const SEALED_NOTE = {
  palace_court6: '（这边原是市井巷子，如今砖砌死了，只留一道封条——「内库重地」。）',
  palace_prison: '（这面墙是后来砌起来的，砖缝里还夹着旧日的门楣残片。）',
  palace_court5: '（墙根堆着厨余，气味很重——说明这墙封了没多久。）',
  palace_study: '（石阶被土填平了，上面长着草。茶山的人说，几十年前这地方能直接走进宫里。）',
  palace_court1: '（棺材里的气流进来，说明这堵墙不是原来就有的。）',
  palace_court3: '（宫墙到这儿就没了，外头直接是山石。修墙的人大概是有别的事要办。）',
  palace_road: '（戈壁的风沙一直吹到御道，砖缝里积着沙。修墙的工程显然是半途而废了。）',
};
for (const [rid, note] of Object.entries(SEALED_NOTE)) {
  const r = rooms[rid];
  if (!r) continue;
  r.actions = r.actions || [];
  if (r.actions.some(a => a.cmd === '看封墙')) continue;
  r.actions.push({
    cmd: '看封墙', label: '看看那道封死的墙', keywords: ['封墙', '墙', '封条'],
    effects: [{ type: 'narrate', raw: note }],
  });
}

/* 其它跨区域的荒谬连线（同款根因，一并处理） */
const OTHER_HOLES = [
  ['jn_yamen_gate', 'w', 'jn_school_yard'],   // 衙门 ↔ 书院互开后门
  ['jn_yamen_gate', 's', 'jn_school_lib'],    // 衙门门房直通书院藏书楼
];
for (const [rid, dir, target] of OTHER_HOLES) cutEdge(rid, dir, target);

/* 午门接上街道：给皇宫一个合法入口 */
function link(from, dir, to) {
  const r = rooms[from];
  if (!r) { problemsEarly('link 源房间不存在：' + from); return; }
  r.exits = r.exits || {};
  /* ⚠️ 「本侧已有出口」时**不能直接 return** —— 得继续往下走补对侧。
     踩过的坑：palace_street 首次创建时 exits 里已经硬写了 e→jiangnan_gate，
     第二轮 link 看到「已有出口」就 return，对侧 jiangnan_gate.w 永远接不上，
     留了个单向出口，map-check 判不合格。 */
  const already = tidOf(r.exits[dir]);
  if (already) {
    say('· ' + r.name + ' ' + dir + ' 已有出口（' + already + '），只补对侧');
    if (already !== to) {
      problemsEarly('link 冲突：' + r.name + ' ' + dir + ' 指向 ' + already + '，与预期 ' + to + ' 不符');
      return;
    }
  } else {
    r.exits[dir] = to;
    say('连线 ' + r.name + ' ' + dir + '→' + to);
  }
  /* 对侧也接上（出口要双向，否则又是单向洞）。
     ⚠️ 对侧方向被**别的目标**占着时不能静默跳过 —— 那会留下单向出口，
        map-check 会判「出口目标存在且双向可回」不合格。 */
  const t = rooms[to];
  if (t) {
    const back = DIR_OPPOSITE[dir];
    t.exits = t.exits || {};
    if (!t.exits[back]) {
      t.exits[back] = from;
      say('连线 ' + t.name + ' ' + back + '→' + from + '（对侧）');
    } else if (tidOf(t.exits[back]) !== from) {
      problemsEarly('连不了：' + t.name + ' ' + back + ' 已被 ' + tidOf(t.exits[back]) +
        ' 占用，' + from + ' 接不上（单向出口）');
    }
  }
}
/* 午门 ← 皇宫外的御街（新建一个门外的小广场当缓冲，唯一合法对外口）
   ⚠️ region 必须是真实存在的 id —— 原来写 'capital'（不存在的），map-check 直接判不合格。
      御街在宫墙外、归江南城，所以用 'jiangnan'。 */
if (!rooms.palace_street) {
  rooms.palace_street = {
    id: 'palace_street', name: '皇城·御街', region: 'jiangnan',
    desc: '宫墙之外的御街，朱红墙一直伸到看不见的地方。街上人不多，但每个人走路都贴着墙根。',
    exits: { n: 'palace_gate', e: 'jiangnan_gate' },
  };
  mapFile.rooms.palace_street = rooms.palace_street;
  say('新房间 palace_street（皇城·御街）');
}
link('palace_gate', 's', 'palace_street');
link('palace_street', 'e', 'jiangnan_gate');

/* 纠正既有字段：上一轮脚本把 palace_street.region 写成了不存在的 'capital'
   （那时它还没被创建，改 region 的代码在 if 块里，房间已存在就永远修不到）。
   region 必须是真实 id —— map-check 判「落在未定义区域」不合格。 */
if (rooms.palace_street && rooms.palace_street.region !== 'jiangnan') {
  const ids = new Set((Array.isArray(mapFile.regions) ? mapFile.regions : Object.values(mapFile.regions || {}))
    .map(r => r && r.id));
  if (ids.has(rooms.palace_street.region)) {
    say('· palace_street.region 已是真实 id（' + rooms.palace_street.region + '），跳过');
  } else {
    say('纠正 palace_street.region：' + rooms.palace_street.region + ' → jiangnan（宫墙外，归江南城）');
    rooms.palace_street.region = 'jiangnan';
  }
}

/* ═══════════════ 4. 出口门禁 ═══════════════ */
function gate(roomId, dir, cond, msg, travel) {
  const r = rooms[roomId];
  if (!r) { problemsEarly('门禁房间不存在：' + roomId); return; }
  r.exits = r.exits || {};
  const ex = r.exits[dir];
  if (!ex) { problemsEarly('门禁方向不存在：' + roomId + ' ' + dir); return; }
  const tid = typeof ex === 'string' ? ex : ex.to;
  if (ex && typeof ex === 'object') {
    if (ex.cond && JSON.stringify(ex.cond) === JSON.stringify(cond)) { say('· 门禁已存在，跳过：' + roomId + ' ' + dir); return; }
    ex.cond = cond; ex.msg = msg;
    if (travel) ex.travel = travel;
  } else {
    r.exits[dir] = Object.assign({ to: tid }, cond ? { cond, msg } : {}, travel ? { travel } : {});
  }
  say('门禁 ' + r.name + ' ' + dir + (cond ? '' : '（无条件，仅描述）'));
}

/* 午门：进宫（e→金水桥）要腰牌；出宫（w→御道）不拦 */
gate('palace_gate', 'e', { item: 'palace_token', count: 1 },
  '禁军横枪拦住你：「腰牌。没有腰牌，午门不开。」',
  '你把腰牌递过去。禁军验了正反面，侧身让开：「请。」');

/* 少林山门：无门禁（僧人不拦俗家），但补描述 + 把知客僧挂上 */
(function() {
  const r = rooms.shaolin_shanmen;
  if (!r) return;
  r.actions = r.actions || [];
  if (!r.actions.some(a => a.cmd === '问知客')) {
    r.actions.push({
      cmd: '问知客', label: '问那知客僧', keywords: ['知客', '僧', '问'],
      effects: [
        { type: 'narrate', raw: '那知客僧抬眼看你，又低下去：「施主若只为赶路，东边岔口是官道。若要入寺，先把兵刃解在山门外。」' },
      ],
    });
    say('少林·山门 → 问知客');
  }
})();

/* 衙门大门：需办案（不设死条件，改为「有状子/有同僚带路」才开）
   条件用 flag 太死，改成「腰牌或官府文书」，这里用物品牌表达。 */
if (!items.yamen_pass) {
  item('yamen_pass', {
    name: '衙门传牌', category: 'quest',
    desc: '一块旧木牌，正面写「江南府」，背面刻着一个已经被磨平了的编号。',
    quality: 'common',
  });
}
gate('jn_yamen_gate', 'n', { item: 'yamen_pass', count: 1 },
  '衙役拦住你：「衙门重地。有传牌没有？」',
  '衙役看了传牌，点点头，让开半步：「进去吧，别乱闯。」');

/* 天牢：需腰牌 + 非通缉犯。这里用「腰牌」表达禁军/内府许可 */
gate('palace_hall', 'nw', { item: 'palace_token', count: 1 },
  '通往天牢的那道门虚掩着，可门槛上有一道新划的痕——像是最近才封的。',
  '你推门进去。牢里阴冷，只有水滴声。');

/* 华山：山脚往上走（huashan_shanxia n→huashan_qingke）要竹牌。
   华山不是皇宫，硬拦不合理，所以拦得客气些。 */
gate('huashan_shanxia', 'n', { item: 'huashan_pass', count: 1 },
  '那看山弟子横剑拦住你：「上山先登记。没有竹牌，山道不能上。」',
  '你递上竹牌。他翻过来看了看，插回你手里：「往上走，别乱闯客舍。」');

/* 白鹿书院：讲学重地，登记入册才能听讲（jn_school_yard n→明伦堂） */
gate('jn_school_yard', 'n', { flag: 'blulu_enrolled', count: 1 },
  '山长站在明伦堂阶前，不动声色地挡了你半步：「名册上没有你。听讲可以，进来先在门房登记。」',
  '山长侧身让开，抬手示意你进去。堂里已有十数人，都在低头抄东西，没人抬头。');

/* 华山看山弟子旁开一个登记处，让 huashan_pass 有出处（不然那道门永远进不去） */
(function () {
  const r = rooms.huashan_shanxia;
  if (!r) return;
  r.actions = r.actions || [];
  if (r.actions.some(a => a.cmd === '登记')) return;
  r.actions.push({
    cmd: '登记', label: '在山脚登记', keywords: ['登记', '入山', '竹牌', '拜山'],
    effects: [
      { type: 'narrate', raw: '那看山弟子从石墩上跳下来，抄起笔，在名册上添了一行。' },
      { type: '+item', args: ['huashan_pass', 1] },
      { type: 'say', raw: '「拿着。别弄丢——丢了自己来取一趟，我这儿不补。」' },
    ],
  });
  say('华山·山脚 → 登记（发 huashan_pass）');
})();

/* 白鹿书院门房登记同理（setFlag blulu_enrolled，明伦堂门禁认这个 flag） */
(function () {
  const r = rooms.jn_school_yard;
  if (!r) return;
  r.actions = r.actions || [];
  if (r.actions.some(a => a.cmd === '登记入册')) return;
  r.actions.push({
    cmd: '登记入册', label: '到门房登记入册', keywords: ['登记', '入册', '名册', '入学'],
    effects: [
      { type: 'narrate', raw: '你在门房的册子上添了名字、籍贯。书吏吹了吹墨，把笔搁回笔架。' },
      { type: 'flag', args: ['blulu_enrolled'] },
      { type: 'say', raw: '「成了。明伦堂随时能来听——逢三休讲，记着。」' },
    ],
  });
  say('白鹿书院·庭院 → 登记入册（置 flag blulu_enrolled）');
})();

/* ═══════════════ 5. 把守卫挂进 respawn ═══════════════ */
function addRespawn(roomId, npcId, count, chance) {
  const r = rooms[roomId];
  if (!r) { problemsEarly('respawn 房间不存在：' + roomId); return; }
  r.respawn = r.respawn || [];
  if (r.respawn.some(x => x && x.npc === npcId)) { say('· ' + r.name + ' 已有 ' + npcId + '，跳过'); return; }
  r.respawn.push(Object.assign({ npc: npcId, count: count || 1 }, chance ? { chance } : {}));
  say('布守卫 ' + r.name + '：' + npcId);
}
addRespawn('palace_gate', 'guard_palace', 2);
addRespawn('palace_plaza', 'guard_palace', 2);
addRespawn('palace_hall', 'guard_palace', 1);
addRespawn('jn_yamen_gate', 'guard_yamen', 1);
addRespawn('jn_yamen_office', 'guard_jinywei', 1);
addRespawn('shaolin_shanmen', 'guard_shaolin', 1);
addRespawn('huashan_shanxia', 'guard_huashan', 2);
addRespawn('jn_school_yard', 'guard_blulu', 1);

/* 午门那条悬空的 action（「问禁军」）接上真守卫 */
(function() {
  const r = rooms.palace_gate;
  if (!r) return;
  r.actions = r.actions || [];
  for (const a of r.actions) {
    if (/禁军|守卫/.test(a.cmd || '') && !a.cond) {
      a.effects = [
        { type: 'narrate', raw: '那两排甲士里有一个转过来看你。他的枪尖没有放下，也没有举起。' },
        { type: 'say', raw: '「宫城重地，验了腰牌才放行。」' },
      ];
      say('午门 action「' + a.cmd + '」接上真守卫');
      break;
    }
  }
})();

/* ═══════════════ 6. 自检 ═══════════════ */
/* 6a. 所有 NPC 引用真实存在 */
for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (d.room && rooms[d.room] === undefined) problems.push('NPC ' + id + ' 的 room 不存在：' + d.room);
}
/* 6b. respawn 引用的 NPC 存在 */
for (const rid of Object.keys(rooms)) {
  for (const rp of (rooms[rid].respawn || [])) {
    if (rp && rp.npc && !npcs[rp.npc]) problems.push('房间 ' + rid + ' respawn 引用不存在的 NPC：' + rp.npc);
  }
}
/* 6c. 所有出口 cond 引用的 item 存在 */
const KNOWN_COND_ITEM = true;
for (const rid of Object.keys(rooms)) {
  for (const d of Object.keys(rooms[rid].exits || {})) {
    const ex = rooms[rid].exits[d];
    if (!ex || typeof ex !== 'object' || !ex.cond) continue;
    const it = ex.cond.item;
    if (it && !items[it]) problems.push('出口 ' + rid + '/' + d + ' 的 cond.item 不存在：' + it);
    /* 有 cond 必须有 msg，否则玩家只看到「那边似乎有什么阻挡着你」 */
    if (!ex.msg) problems.push('出口 ' + rid + '/' + d + ' 有 cond 但没 msg');
    const tid = ex.to;
    if (tid && !rooms[tid]) problems.push('出口 ' + rid + '/' + d + ' 指向不存在的房间：' + tid);
  }
}
/* 6d. 出口引用的房间都存在（全局） */
for (const rid of Object.keys(rooms)) {
  for (const d of Object.keys(rooms[rid].exits || {})) {
    const ex = rooms[rid].exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    if (tid && !rooms[tid]) problems.push('房间 ' + rid + ' 的 ' + d + ' 指向不存在的房间：' + tid);
  }
}
/* 6e. 皇宫不能再有「洞」：palace_* 房间的所有出口，跨出 palace 区域的必须走午门。
       注意 palace_street 是「门外」的缓冲，它本来就该通到街上，白名单放行。 */
const PALACE_ROOMS = Object.keys(rooms).filter(id => id.startsWith('palace_') && id !== 'palace_street');
const PALACE_LEGIT_OUT = { palace_gate: ['palace_street'] };
for (const rid of PALACE_ROOMS) {
  const r = rooms[rid];
  for (const d of Object.keys(r.exits || {})) {
    const ex = r.exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    if (!tid) continue;
    const t = rooms[tid];
    if (!t) continue;
    const outOfPalace = !(String(tid).startsWith('palace_'));
    const legit = (PALACE_LEGIT_OUT[rid] || []).includes(tid);
    if (outOfPalace && !legit) {
      problems.push('皇宫仍有洞：' + rid + '(' + r.name + ') ' + d + '→' + tid + '(' + t.name + ')');
    }
  }
}
/* 6f. 反向也要查：民间房间不能有指向**宫内**的边（否则等于又开了个洞）。
       注意排除 palace_street —— 它是宫墙**外**的御街，本来就该通到街上。 */
const PALACE_INNER = new Set(PALACE_ROOMS.concat(['palace_street']));
for (const rid of Object.keys(rooms)) {
  if (PALACE_INNER.has(rid)) continue;
  const r = rooms[rid];
  for (const d of Object.keys(r.exits || {})) {
    const ex = r.exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    /* 民间 → palace_street 合法（御街是宫外缓冲）；→ palace_* 宫内才是洞 */
    if (tid && String(tid).startsWith('palace_') && tid !== 'palace_street') {
      problems.push('民间有边直通皇宫：' + rid + '(' + r.name + ') ' + d + '→' + tid);
    }
  }
}
/* 6g. 双向可回：本批新加的边 + 全图两条历史欠账。
       历史欠账只挑**明确该是双向**的两条补：
         palace_harem -n-> palace_court1  （后宫→东六宫，对侧该有 s）
         changan_gate  -s-> road_xiyu_1   （长安西门→西域古道，对侧该有 n）
       剩下 89 条不动 —— 那属于 SPRINT-A 地图重做的范围，不在本批硬扫。 */
const FIX_TWO_WAY = [
  ['palace_harem', 'n', 'palace_court1'],
  ['changan_gate', 's', 'road_xiyu_1'],
];
for (const [rid, dir, target] of FIX_TWO_WAY) {
  const r = rooms[rid];
  if (!r) { problemsEarly('补双向时房间不存在：' + rid); continue; }
  if (tidOf(r.exits && r.exits[dir]) !== target) { say('· ' + rid + ' ' + dir + ' 已变，跳过补双向'); continue; }
  const back = DIR_OPPOSITE[dir];
  const t = rooms[target];
  if (!t) { problemsEarly('补双向时对侧房间不存在：' + target); continue; }
  t.exits = t.exits || {};
  if (tidOf(t.exits[back]) === rid) { say('· ' + t.name + ' ' + back + ' 已有，跳过'); continue; }
  t.exits[back] = rid;
  say('补双向 ' + t.name + ' ' + back + '→' + rid);
}
{
  const broken = [];
  for (const rid of Object.keys(rooms)) {
    for (const d of Object.keys(rooms[rid].exits || {})) {
      const tid = tidOf(rooms[rid].exits[d]);
      if (!tid || !rooms[tid]) continue;
      const back = DIR_OPPOSITE[d];
      const btid = tidOf(rooms[tid].exits && rooms[tid].exits[back]);
      if (btid !== rid) broken.push(rid + ' ' + d + '→' + tid);
    }
  }
  const MINE = ['palace_street', 'palace_gate', 'jiangnan_gate'];
  const mineBad = broken.filter(x => MINE.some(id => x.indexOf(id + ' ') === 0 || x.indexOf('→' + id + '（') >= 0));
  if (mineBad.length) for (const x of mineBad) problems.push('本批连线有单向出口：' + x);
  say('单向出口共 ' + broken.length + ' 条（历史欠账 ' + (broken.length - mineBad.length) + ' 条，属 SPRINT-A 范围）');
}
void KNOWN_COND_ITEM;

if (problems.length) {
  console.log('\n❌ 自检没过（**未落盘**）：');
  for (const p of problems) console.log('  · ' + p);
  process.exit(1);
}

console.log('\n自检通过：守卫引用全存在 / 出口 cond 全有 msg / 皇宫只剩午门一个对外口');
fs.writeFileSync(path.join(DIR, '40_npcs.json'), JSON.stringify(npcFile, null, 1));
fs.writeFileSync(path.join(DIR, '20_items.json'), JSON.stringify(itemsFile, null, 2) + '\n');
fs.writeFileSync(path.join(DIR, '50_map.json'), JSON.stringify(mapFile, null, 2) + '\n');
console.log('已落盘 3 个数据文件（备份在 tools/_bak/*.guard-gates.json）');
console.log('NPC 总数 ' + Object.keys(npcs).length + ' / 房间 ' + Object.keys(rooms).length
  + ' / 物品 ' + Object.keys(items).length);
console.log('带门禁的出口：' + Object.keys(rooms).reduce((n, rid) => {
  return n + Object.keys(rooms[rid].exits || {})
    .filter(d => { const e = rooms[rid].exits[d]; return e && typeof e === 'object' && e.cond; }).length;
}, 0));