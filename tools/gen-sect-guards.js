/* gen-sect-guards.js —— 生成 43 门派山门守卫数据（design/71 §四）
 *
 * 输出：game/data/42_sect_guards.json
 * 每个门派 1~2 名守卫，落在自家的 entry（山门）房。
 * 守卫用显式 tag `shouwei`（照 patrol.js 的纪律：不猜名字、不猜 title）。
 *
 * 强度按门派 tier / align：
 *   一流 + 正道/中立 → A 级看门人（少，1 人，配 1 名随侍）—— 大派守备森严
 *   一流 + 邪道     → B 级（日月神教/星宿，oil 味重）
 *   二流            → B/C
 *   帮会/镖局       → C
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'game', 'data');

function load(f) { return JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); }

const sects = load('30_sects.json').sects;
const tiers = load('72_sects_tier.json').sects;
const entryMap = load('41_sect_entry.json').sects;

/* 门派 → 守卫冠名（门派里对「看门的」怎么称呼） */
const KEEPER_TITLE = {
  huashan: { name: '华山弟子', title: '看山弟子', body: '青衫，背一柄长剑，剑没出鞘。他站在山道正中，不像拦人，倒像在数人头。' },
  shaolin: { name: '知客僧', title: '知客', body: '灰布僧衣，手里捻着一串念珠。他合掌的动作很自然，眼神却一直落在你身上。' },
  wudang: { name: '知客道人', title: '知客', body: '月白道袍，拂尘搭在臂弯。他先看你的脚，再看你的手。' },
  emei: { name: '峨眉弟子', title: '迎客弟子', body: '素衣女弟子，鬓边别一朵杜鹃。她挡在门前的样子很客气，脚下却一步不让。' },
  gaibang: { name: '丐帮弟子', title: '把风弟子', body: '破衫赤足，蹲在庙门槛上啃干粮。他抬眼看你的时候，眼睛很亮。' },
  mojiao: { name: '教众', title: '守崖教众', body: '黑衣，脸上没表情。他手里横着刀柄，刀尖朝下。' },
  dali: { name: '王府侍卫', title: '门卫', body: '锦袍金带，腰里悬着剑。他站在阶下，背挺得笔直。' },
  tangmen: { name: '堡门守卫', title: '守门人', body: '黑衣，袖口很宽。他两只手都拢在袖子里，看不出在做什么。' },
  miaojiang: { name: '五毒教众', title: '守门弟子', body: '赤足，脚踝缠着细铃。他站在圣堂门口，腰间挂着个用布盖住的竹篓。' },
  taohua: { name: '桃花岛弟子', title: '渡口迎客', body: '青衣小帽，站在渡口的木桩上。他说话时总先笑一笑。' },
  gumu: { name: '古墓弟子', title: '护墓弟子', body: '白衣，面罩轻纱。她拦在墓道口，声音很轻：「来者何人？」' },
  xingxiu: { name: '星宿弟子', title: '迎客弟子', body: '一身番僧打扮，脸上堆着笑。笑得越亲热，眼神越冷。' },
  xuedao: { name: '血刀弟子', title: '守门弟子', body: '红衣，刀鞘上缠着褪色的绳。他看你的眼神像在看一件物什。' },
  xiake: { name: '侠客岛仆役', title: '引路仆役', body: '灰衣仆役，垂手立在渡口。他不多话，只等你开口。' },
};
/* 通用师门看门人（40 家中小门派） */
const SMALL_KEEPER = (sectName) => ({
  name: sectName + '弟子',
  title: '守门弟子',
  body: '一身本门短打，腰里别着家伙，堵在门里那一侧。',
});

/* 守卫性格（lore-consistency-check 钉着「每个 NPC 都定了性格」）。
   正道名门规矩重 → 木讷/侠义；邪道门里没人守规矩 → 阴鸷/油滑；
   镖局帮会市井气重 → 豪爽/油滑。挑的时候看的是「这家门派的气质」，
   不是随机分配 —— 峨眉弟子的木讷和黑木崖教众的阴鸷站在一起才对味。 */
const GUARD_MOOD = {
  huashan: 'xiayi', shaolin: 'mune', wudang: 'mune', emei: 'wenwan',
  gaibang: 'youhua', mojiao: 'yinzhi', dali: 'lengmo', tangmen: 'lengmo',
  miaojiang: 'qienuo', taohua: 'wenwan', gumu: 'lengmo', xingxiu: 'youhua',
  xuedao: 'baozhao', xiake: 'mune',
  _default: 'mune',
};

function alignOf(id) {
  const s = sects[id] || {};
  return s.align || '中立';
}
function tierOf(id) {
  const t = tiers[id] || {};
  return t.tier || '三流';
}

/* tier → 守卫战力档（level / hp / atk / def） */
function statFor(id) {
  const t = tierOf(id);
  const a = alignOf(id);
  if (t === '一流') {
    if (a === '邪道') return { tier: 'B', level: 40, hp: 1650, atk: 165, def: 128 };
    return { tier: 'A', level: 46, hp: 1850, atk: 195, def: 150 };
  }
  if (t === '二流') return { tier: 'B', level: 32, hp: 1250, atk: 125, def: 100 };
  return { tier: 'C', level: 24, hp: 950, atk: 92, def: 76 };
}

/* 守卫守门武学：按门派招牌武学的前 1~2 门（用起来像自家人） */
function skillPick(id) {
  const s = sects[id] || {};
  const t = tiers[id] || {};
  const pool = [].concat(t.entrySkills || [], t.skills || [], s.entrySkills || [], s.skills || []);
  const seen = new Set();
  const picked = [];
  for (const k of pool) {
    if (!k || seen.has(k)) continue;
    seen.add(k);
    picked.push(k);
    if (picked.length >= 2) break;
  }
  return picked;
}

const out = { _note: [
  '43 门派山门守卫（design/71 §四 缺口 1 的补法）。',
  '现状：全库只有 guard_city / guard_shaolin / guard_huashan 三个守卫，其余山门没人看着 ——',
  '「闯山门要拦」的前提是**有人拦**，所以先补人。',
  '守卫 tag = shouwei（显式标签，照 patrol.js 的纪律：不猜名字、不猜 title）。',
  '守卫落在自家 entry（41_sect_entry.json），与「飞往」落点是同一来源。',
  '强度按门派 tier：一流正道 A / 一流邪道 B / 二流 B / 其余 C。',
  '⚠️ id 用 sectguard_<sectId>，**不占用/覆盖** 40_npcs.json 里已存在的 guard_shaolin / guard_huashan ——',
  '   那两个是「有生有色的老人物」（带 ask / sidequest / rel），本文件只补白地，不重写旧人。',
], npcs: {} };

/* 已存在同名守卫的门派：跳过，别覆盖旧人（旧人带 ask/sidequest/rel，信息量更大）。
   ⚠️ 但要**补一个 tag=shouwei** —— 旧守卫的 tag 是 `swordsman`，
      拦截逻辑只认 shouwei；不补的话华山的看山弟子拦不住人（静默失效）。
      增量合并（world.mergeData）只改 tag 这一笔，旧字段一个不动。 */
const HAS_KEEPER = { shaolin: 'guard_shaolin', huashan: 'guard_huashan' };

for (const [sectId, oldId] of Object.entries(HAS_KEEPER)) {
  out.npcs[oldId] = { id: oldId, tag: 'shouwei' };
  console.log('  已有守卫，仅补 tag=shouwei:', sectId, '->', oldId);
}

const list = Object.keys(entryMap);
for (const id of list) {
  if (HAS_KEEPER[id]) continue;
  const entry = entryMap[id].entry;
  const s = sects[id];
  const st = statFor(id);
  const kp = KEEPER_TITLE[id] || SMALL_KEEPER((s && s.name) || id);
  const pickSkills = skillPick(id);
  const learned = {};
  for (const sk of pickSkills) learned[sk] = { level: Math.max(40, Math.min(96, st.level * 2)), exp: 0 };
  learned['jh_parry'] = learned['jh_parry'] || { level: Math.max(30, st.level), exp: 0 };
  const skills = {};
  /* 主武学按名字猜兵器（粗略即可，教的是**这家**的功夫） */
  const first = pickSkills[0] || '';
  if (/blade|dao/.test(first)) skills['刀'] = first;
  else if (/sword|jian/.test(first)) skills['剑'] = first;
  else if (/staff|gun|zhang/.test(first)) skills['棍'] = first;
  else if (/fist|quan|zhang/.test(first)) skills['拳'] = first;
  else if (first) skills['拳'] = first;
  skills['招架'] = 'jh_parry';

  /* 峨眉只收女弟子 —— 守门的也得是女的，否则「女派站个男弟子」当场出戏 */
  const gender = (s && s.require && s.require.gender === 'female') || id === 'gumu' ? 'female' : 'male';

  const gid = 'sectguard_' + id;
  out.npcs[gid] = {
    id: gid,
    name: kp.name,
    gender,
    room: entry,
    desc: kp.body,
    level: st.level,
    hp: st.hp,
    mp: 300,
    atk: st.atk,
    def: st.def,
    dodge: Math.round(st.level * 1.6),
    parry: 50,
    speed: Math.round(st.level * 1.9),
    hostile: false,
    leavesCorpse: true,
    talk: [
      '「哪家的？来做什么？」',
      '「本门不是客栈。要进，得有个说法。」',
    ],
    tag: 'shouwei',
    title: kp.title,
    learned,
    skills,
    equipment: null,
    carry: { money: Math.round(st.level * 3), items: [] },
    favorBase: 0.2,
    favorInit: 0,
    sidequest: null,
    /* 守门的也得有睡觉的地方 —— 41 个守卫全写 home:null，
       smoke-social 的「无家的是特殊身份」直接被顶穿（41/526）。
       跟弟子一样用虚拟私宅，不上地图（守卫的家在山门后院，玩家拜访不着）。 */
    home: 'house:' + gid,
    age: 30,
    schedule: null,
    expReward: 0,
    potReward: 0,
    moneyReward: 0,
    loot: null,
    socialDone: true,
    relDone: true,
    sect: id,
    /* ⚠️ `rank` 必写，且必须是 ranks 里真有的下标。
       npcIdentity(w, npc) 的门派分支**优先于 title/job**：
       门派 + ranks[rank] → 「武当派记名弟子」；不写 rank 会落到 ranks[0]
       （碰巧对，但纯属侥幸），而 identity-check 那条
       「门派 NPC 身份 = 门派名 + ranks[rank]」会判它不符。守门人没资格论辈分，
       一律按 ranks[0]（记名弟子 / 教众 / 外门），是最老实也最不出戏的写法。 */
    rank: 0,
    /* ⚠️ `personality` 必写 —— lore-consistency-check 钉着「每个 NPC 都定了性格」。
       守卫千人一面的话，交谈时所有人一个腔调。给一份按门派气质的。 */
    personality: GUARD_MOOD[id] || GUARD_MOOD._default,
    tier: st.tier,
    job: 'shouwei',
  };
}

fs.writeFileSync(path.join(dataDir, '42_sect_guards.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('生成守卫 NPC:', Object.keys(out.npcs).length, '个');
