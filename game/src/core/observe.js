/**
 * observe.js — 看人时的神态小动作 + 岔路口的路牌（主人 2026-10-08）
 *
 * 主人要的两样：
 *   ① 玩家「看」的时候，屏幕上落几句**具体动作**——「某某某看了某某某一眼」「某某某看了看四周」。
 *      不是复述身份，是让这一屋子人**活着**。
 *   ② 走到**岔路口**，屏幕要说「此地有个路牌，东边是什么地方、西边是哪个门派」。
 *
 * 一条分寸：小动作**要稳**。同一间屋、同一个时辰里反复「看」，不能每次换一个姿势——
 * 那样屋子像个抽风的木偶戏。所以按「房间 + 人 + 时辰」哈希选句，同一时辰内是定的。
 */
'use strict';

const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下', ne: '东北', nw: '西北', se: '东南', sw: '西南', in: '内', out: '外' };

/* ============================================================
 * ① 人物小动作
 * ============================================================ */

/** 一个人的闲态（按性格挑）——「某某某看了看四周」都在这儿 */
const IDLE = {
  lengmo: ['{a}靠墙站着，一直没动，像没听见屋里的动静。', '{a}把手里的东西翻了个面，又翻了回去。', '{a}望着门外，也不知在看什么。'],
  haoshuang: ['{a}把茶碗往桌上一顿，声音不轻。', '{a}一条腿搭在长凳上，跟谁都像认识多年。', '{a}拍了拍衣襟上的灰，拍得挺响。'],
  baozhao: ['{a}把凳子往后蹬了半尺，脚底蹭出一声。', '{a}的手指在桌沿上敲个不停，自己也没察觉。'],
  qienuo: ['{a}缩在柱子后头，眼睛却一直瞟着门口。', '{a}把手拢在袖子里，来回搓着。', '{a}看了看四周，见没人留意才松了松肩。'],
  youhua: ['{a}看看这个，又看看那个，脸上一直挂着笑。', '{a}一眼一眼地打量来人的衣裳鞋帽。', '{a}把袖子拢了拢，顺手把桌上的灰拂到别人那边。'],
  yinzhi: ['{a}坐在最里头，茶凉了也没叫人换。', '{a}垂下眼皮，像是睡着了，手指却在袖中动着。', '{a}看了看四周，视线在门口多停了一瞬。'],
  mune: ['{a}低头看着自己脚面，半天没换过姿势。', '{a}把随身的东西摆了一遍，又摆了一遍。', '{a}看了看四周，还是没开口。'],
  wenwan: ['{a}捧着杯子，指节上有点红。', '{a}把桌上的水渍一点点抹干净。', '{a}看了看四周，把歪了的凳子扶正。'],
  xiayi: ['{a}把佩剑横在膝上，擦得极慢。剑早就不脏了。', '{a}坐得笔直，谁进门都看一眼。', '{a}看了看四周，手一直没离剑鞘。'],
};

/** 两个人之间的一眼——「某某某看了某某某一眼」 */
const GLANCE = [
  '{a}朝{b}那边看了一眼，很快收回来。',
  '{a}的目光在{b}身上停了一下，没作声。',
  '{a}往{b}那边偏了偏身子，又坐正了。',
  '{a}和{b}对上一眼，两个人都把脸转开了。',
  '{a}压低了声气对{b}说了句什么，{b}只是摇头。',
];

/** 玩家打量某人时，那人当下的反应（看性格 + 好感） */
const SEEN = {
  lengmo: ['{a}察觉你在看他，没回头，也没换个姿势。', '{a}任你看，像看的是别人。'],
  haoshuang: ['{a}见你打量，索性转过身来由你看，还咧嘴笑了笑。', '{a}大大方方地迎着你的目光，反倒看得你有些不好意思。'],
  baozhao: ['{a}被你一看就恼了，横过眼来：「看什么？」', '{a}把身子一侧，拿背对着你。'],
  qienuo: ['{a}发觉你在看他，肩膀缩了一下，把头埋得更低。', '{a}匆匆看你一眼，又赶紧垂下眼去。'],
  youhua: ['{a}见你看他，立刻笑开了，还往你这边挪了半步。', '{a}由你看，自己也顺势把你从上到下看了一遍。'],
  yinzhi: ['{a}好像没发觉，又好像早知道了——他连眼皮都没抬。', '{a}等你看够了，才慢慢转过头来，冲你点了下头。'],
  mune: ['{a}与你的目光撞上，愣了一下，才想起要点头。', '{a}抬头看你，看了半晌，什么也没说。'],
  wenwan: ['{a}觉察到你的视线，微微欠了欠身，耳根有点红。', '{a}抬眼看你一下，很快又低下去。'],
  xiayi: ['{a}迎上你的目光，正一正身子，算是见礼。', '{a}朝你看了一眼，把手从剑上挪开了——是让你放心的意思。'],
};

/* ------------------------------------------------------------------ *
 * 「仔细看」才看得出的东西 —— **按营生（tag）走**
 *
 * 主人 2026-10-08：「玩家点『看』互动 NPC 时屏幕上应该写**仔细观察** NPC」。
 * 所以「看」这一路给的是**看得见的证据**：手上的茧、袖口的压痕、鞋底的泥。
 * 至于「看了一眼」那句过渡，挪到「点名字开互动界面」那一步去了（见 glanceAt）。
 * ------------------------------------------------------------------ */
const DETAIL = {
  swordsman: '虎口上有一层茧，右手比左手厚出一分——是常年握剑磨的。',
  hunter: '指节上有几道旧疤，是拆兽夹留下的；靴筒里还插着一把小刀。',
  smith: '手背通红，指甲缝里嵌着洗不净的铁灰。',
  doctor: '指甲修得极短，指腹上留着一层洗不掉的药色。',
  farmer: '裤脚挽到小腿，脚上全是泥，脚趾甲厚得像片壳。',
  beggar: '一双草鞋，脚趾露在外头，脚背冻得发紫。',
  boatman: '两肩一高一低，是常年撑篙压出来的。',
  escort: '腰间一块旧腰牌，边角磨圆了；走路时左脚比右脚轻。',
  constable: '腰上挂刀的那一侧衣料塌下去一块，是常年坠着磨的。',
  official: '袖口有一圈压得极平的暗痕——罩官服压出来的。',
  eunuch: '走路时袖口不动，两只手在里头拢着，不叫人看见。',
  merchant: '袖口磨得发亮，指头上有一圈戒痕，戒子摘了。',
  courtesan: '鬓边那支钗是旧样式，插得很稳，一看就是自己挽的。',
  scholar: '右手食指侧面有一层薄茧，是握笔磨的；指甲修得整齐。',
  monk: '僧鞋的底子补过三回，补丁摞补丁。',
  taoist: '道袍洗得发白，领口却是新的——刚换过。',
  thief: '眼睛总往人腰上瞟，右手习惯性地贴着裤缝。',
  child: '个子刚到你腰，鞋大了半码，走路啪嗒响。',
  commoner: '衣裳干净，补丁打在里侧，是仔细人。',
};

/** 一眼扫过的部位（性格兜底：没营生可看就看神情） */
const DETAIL_FALLBACK = {
  lengmo: '眼皮很少动，看什么都像隔着一层。',
  haoshuang: '走路带风，肩膀是敞着的。',
  baozhao: '脖子上的筋绷着，随时要发作的样子。',
  qienuo: '肩膀总往里收，像是随时准备让路。',
  youhua: '眼睛转得比别人快半拍，先看人腰上的钱袋。',
  yinzhi: '笑得客气，眼睛却没跟着笑。',
  mune: '目光落在脚前三尺，谁也不看。',
  wenwan: '手指绞着衣角，绞出一道道印。',
  xiayi: '站姿很正，手离兵刃总留着一寸。',
};

/* 「点名字开互动面板」时的那一句过渡（主人：**这时候**才显示「看了一眼」） */
const GLANCE_AT = [
  '你看了{a}一眼，把这人从头到脚过了一遍。',
  '你朝{a}那边多看了两眼——这人身上有点说不清的地方。',
  '你看了{a}一眼。{a}像是察觉了什么，又像没有。',
  '你抬眼看了看{a}。{a}那边没有动静。',
];

/** 小哈希：同输入同结果，用来在「一个时辰内」稳定地挑句 */
function pick(arr, seed) {
  if (!arr || !arr.length) return '';
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return arr[(h >>> 0) % arr.length];
}

/** 这一屋子的「时辰片」——同片内小动作不变 */
function beatSeed(world, room) {
  const d = Math.floor((world.clockMinutes || 0) / 120);   // 两小时一片
  return `${room.id}|${d}`;
}

/**
 * 房间里的动态：有人就看一眼别人，没人看就看看四周。
 * @returns {Array<{kind:string,text:string}>} 0~2 行
 */
function roomBeats(world, room, npcs) {
  const out = [];
  const live = (npcs || []).filter(n => n && n.name && !n.dead && !n.knockedOut);
  if (!live.length) return out;
  const seed = beatSeed(world, room);
  if (live.length >= 2) {
    const a = live[0], b = live[1];
    const t = pick(GLANCE, seed + '|g').replace(/\{a\}/g, a.name).replace(/\{b\}/g, b.name);
    if (t) out.push({ kind: 'plain', text: t });
  } else {
    const per = require('./personality').personaIdOf(live[0]);
    const t = pick(IDLE[per] || IDLE.mune, seed + '|i').replace(/\{a\}/g, live[0].name);
    if (t) out.push({ kind: 'plain', text: t });
  }
  return out;
}

/**
 * 玩家「看」某人（点「看」/「打量」）——「仔细观察」这一路：
 *   ① **细看才看得出的东西**（按营生：手上的茧、袖口的压痕、鞋底的泥）
 *   ② **那人对你的反应**（按性格）
 * @returns {Array<{kind:string,text:string}>} 0~2 行
 */
function lookBeat(world, npc) {
  const out = [];
  if (!npc) return out;
  const tag = npc.tag || (npc.def && npc.def.tag) || '';
  const per = require('./personality').personaIdOf(npc);
  const seed = `${npc.defId || npc.id}|${Math.floor((world.clockMinutes || 0) / 120)}`;
  const det = DETAIL[tag] || DETAIL_FALLBACK[per] || DETAIL_FALLBACK.mune;
  if (det) out.push({ kind: 'plain', text: `你仔细打量${npc.name}——${det}` });
  const seen = pick(SEEN[per] || SEEN.mune, seed + '|s');
  if (seen) out.push({ kind: 'plain', text: seen.replace(/\{a\}/g, npc.name) });
  return out;
}

/**
 * 「点名字、开互动面板」那一步的一句过渡 —— 主人原话：
 * 「玩家点击 NPC 的名字按钮打开互动界面过程中屏幕上才显示『看了一眼』」。
 * ⚠️ 这句是**开面板时**的，不是「看」的时候的 —— 两者分工别搞混
 *    （第一版把「看了一眼」放进了 lookNpc，主人当场指出来了）。
 */
function glanceAt(world, npc) {
  if (!npc) return null;
  const seed = `${npc.defId || npc.id}|${Math.floor((world.clockMinutes || 0) / 120)}|g`;
  const t = pick(GLANCE_AT, seed);
  return t ? { kind: 'plain', text: t.replace(/\{a\}/g, npc.name) } : null;
}

/* ============================================================
 * ② 岔路口的路牌
 * ============================================================ */

/** 这个区域叫什么（有门派驻就叫门派名，否则用区域名） */
function placeName(world, regionId, fallback) {
  if (!regionId) return fallback || '';
  const sect = Object.values((world.data && world.data.sects) || {}).find(s => s.region === regionId);
  if (sect) return sect.name;
  const rg = world.getRegion && world.getRegion(regionId);
  return (rg && rg.name) || fallback || '';
}

/**
 * 岔路口的路牌。
 * 判据（主人的话）：「如果有岔路分别指向不同的区域」—— 所以是**跨区域的出口 ≥ 2 个**。
 * 同一个城里的几条街不算岔路（那是巷子），只通向别处才算。
 */
function signpostFor(world, room) {
  if (!room || !room.exits) return null;
  const byRegion = {};
  for (const dir of Object.keys(room.exits)) {
    if (dir === 'u' || dir === 'd' || dir === 'in' || dir === 'out') continue;  // 上下 / 里外不是岔路
    const ex = room.exits[dir];
    const to = typeof ex === 'string' ? ex : ex && ex.to;
    const tr = to && world.getRoom(to);
    if (!tr) continue;
    const rg = tr.region || '';
    if (!rg || rg === room.region) continue;                                    // 同区域的连片街道不算
    (byRegion[rg] = byRegion[rg] || []).push({ dir, name: tr.name, region: rg });
  }
  const regions = Object.keys(byRegion);
  if (regions.length < 2) return null;         // 只有一个方向通别处 —— 那是条大路，不是岔路口
  const order = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
  const items = [];
  for (const rg of regions) {
    const list = byRegion[rg].slice().sort((a, b) => order.indexOf(a.dir) - order.indexOf(b.dir));
    const dirs = list.map(x => DIR_CN[x.dir] || x.dir).join('／');
    items.push({ dir: list[0].dir, dirCn: dirs, region: rg, place: placeName(world, rg, list[0].name), room: list[0].name });
  }
  items.sort((a, b) => order.indexOf(a.dir) - order.indexOf(b.dir));
  const body = items.map(it => `${it.dirCn}：${it.place}`).join('　');
  return {
    kind: 'plain',
    text: `路口立着块半人高的木牌，漆掉得差不多了，字还认得出——${body}。`,
    sign: items,
  };
}

module.exports = { roomBeats, lookBeat, glanceAt, signpostFor, placeName, DIR_CN, IDLE, GLANCE, SEEN, DETAIL, DETAIL_FALLBACK, GLANCE_AT };
