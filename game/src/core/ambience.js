'use strict';
/* ==========================================================================
 *  ambience.js —— 世界氛围（场所环境音 + NPC 走动消息）
 *
 *  主人原话：
 *    「给世界添加游戏细节，比如说玩家走到青楼那里时会有莺莺燕燕喊官人来玩啊
 *      之类的话，来到寺院之类的地方会传来僧人诵经的话，来到赌场有时会听到
 *      会有人发出不服输的声音，NPC 会随机移动，移动时屏幕上会显示某某某去了
 *      何方，NPC 来到你这里时屏幕上会显示某某某灰头土脸走进客栈（如果玩家在
 *      客栈）如果 NPC 只是路过玩家当前地格则会显示某某某急匆匆经过
 *      （不要一模一样的句子，多一些随机句子，不然会视觉疲劳）」
 *
 *  两份东西：
 *    ① `ambientLine()` —— 进/看一个地方时，抽一条**场所环境音**。
 *       句库在 `ambient-pools.js`（纯数据，16 类场所，每类 11+ 条）。
 *    ② `wanderLines()` —— NPC 走动时，按「离开 / 进来 / 路过」三类播一句。
 *       句库同样在 `ambient-pools.js`（三类，每类 14+ 条）。
 *
 *  ⚠️ 别在代码里再写一份句子表。加句子一律去 `ambient-pools.js`，
 *     这里只做「选哪一句」（本项目血泪：同一个功能两份数据，改一份漏一份）。
 * ========================================================================== */

const { PLACE_LINES, MOVE_LINES, ARRIVE_INN_ONLY } = require('./ambient-pools');
const INN_ONLY = new Set(ARRIVE_INN_ONLY || []);

/* --------------------------------------------------------------------------
 *  一、这个地方算什么场所
 *
 *  用**房间名 + 房间 id** 的正则判定（与 kidnap.inBrothel 同一套思路）：
 *  数据侧不用动，改一条正则就多覆盖一片。
 *  ⚠️ 顺序即优先级，**先具体后笼统**：
 *     「少林·练武场」既是寺也是武场，放前面那条说话更贴；
 *     「街」这种笼统的必须垫底，否则「庙前街」会被判成街。
 *  ⚠️ 加新场所时先 grep 房间表确认真名（历史上 inBrothel 漏了四座城的青楼，
 *     表现为「在江南以外的地方静默走兜底分支」——不报错，就是不生效）。
 * -------------------------------------------------------------------------- */
const PLACE_RULES = [
  ['brothel', /青楼|醉春楼|怡红院|牡丹阁|翠云楼|凤来仪|平康坊|楚馆|宜春院|窑子|清倌|丽人院|绮罗院|春香阁|听雨楼|望江阁|春宵|勾栏/],
  ['gambling', /赌坊|赌场|赌局|博戏|骰|牌九|聚宝局/],
  /* 寺庵在道观之前 —— 「少林」「天龙寺」这类自带佛门气 */
  ['temple', /寺|庙|庵|禅|塔林|大雄宝殿|天王殿|藏经阁|放生池|少林|舍利|僧/],
  ['taoist', /道观|道院|三清|老君|真武|太和宫|紫霄|玉虚|太极宫|丹房|丹炉|武当|云台观/],
  ['pharmacy', /药铺|药堂|药局|回春堂|医馆|药圃|本草/],
  ['smithy', /铁匠|锻|炉房|兵器铺|打铁|铸/],
  ['school', /书院|书塾|学堂|私塾|翰墨|贡院/],
  ['inn', /客栈|旅店|逆旅|驿站|驿馆/],
  ['tavern', /酒楼|酒肆|酒家|茶楼|茶馆|茶肆|醉仙楼|杏花村/],
  ['yamen', /衙门|县衙|府衙|大堂|公堂|巡检司/],
  ['dock', /码头|渡口|渡船|船家|江边|港口|船坞|纤道/],
  ['market', /东市|西市|市集|集市|market|货栈|牙行/],
  ['sect', /山门|演武|练武场|正气堂|大殿|堡门|殿$|堂$/],
  ['farm', /田|畦|稻|麦|农|打谷|磨坊|碾房/],
  ['mountain', /山|岭|谷|崖|峡|林|野|坡|涧|峰/],
  ['street', /街|巷|路|道口|弄|胡同/],
];

/** 屋里太私密/太安静的地方不播环境音（牢里念经就出戏了） */
const QUIET_ROOM = /牢|囚|密室|秘道|暗室|地窖|寝|卧|家|宅|院中|石室|棺|墓|衙门·大堂/;

/** 这个房间是什么场所（判定不出来返回 null） */
function placeOf(world, room) {
  if (!room) return null;
  if (room.ambient) return room.ambient;      // 数据可以显式指定，优先
  const hay = String(room.id || '') + ' ' + String(room.name || '');
  for (const [k, re] of PLACE_RULES) if (re.test(hay)) return k;
  return null;
}

/* --------------------------------------------------------------------------
 *  二、场所环境音
 * -------------------------------------------------------------------------- */

/** 抽一句环境音；判定不出场所 / 太安静 / 句库为空时返回 null（调用方跳过） */
function ambientLine(world, room) {
  if (!world || !room) return null;
  if (QUIET_ROOM.test(String(room.name || ''))) return null;
  const k = placeOf(world, room);
  const pool = k && PLACE_LINES[k];
  if (!pool || !pool.length) return null;
  const text = world.rng.pick(pool);
  if (!text) return null;
  return { kind: 'ambient', text, place: k };
}

/* --------------------------------------------------------------------------
 *  三、NPC 走动消息
 *
 *  worldTick 把这一轮真发生的走动收成 events 交进来：
 *    { npc, from, to }
 *  这里分三类播报：
 *    · leave  —— 从玩家所在房间走掉        「某某往北去了」
 *    · arrive —— 走进玩家所在房间          「某某灰头土脸走进客栈」
 *    · passby —— 在**隔壁两间**之间移动、没进屋，而你所在的是开阔地方
 *                                          「某某急匆匆打你身边经过」
 *
 *  ⚠️ 必须**限量**：全城几百号人都在走，一次 tick 播几十条会把日志刷烂。
 *     这里三类合起来一次最多 3 条，且同一个人只播一次。
 *  ⚠️ 距离限制：只有「涉及玩家所在房间」或「隔壁两间」的走动才看得见 ——
 *     玩家在江南城，不该听说洛阳有人往南走了。
 * -------------------------------------------------------------------------- */

/** 一次 tick 最多播几条（超了就直接丢弃，不排队） */
const MAX_PER_TICK = 3;

/** 反查方向：从 fromRoom 往哪个方向能到 toRoom */
function dirOf(world, fromRoomId, toRoomId) {
  const r = world.getRoom(fromRoomId);
  if (!r || !r.exits) return '';
  const { DIR_CN } = require('./commands');
  for (const d of Object.keys(r.exits)) {
    const ex = r.exits[d];
    const tid = typeof ex === 'string' ? ex : (ex && ex.to);
    if (tid === toRoomId) return DIR_CN[d] || d;
  }
  return '';
}

/** 哪些场所算「开阔地」—— 只有在这儿才谈得上「有人打你身边经过」 */
const OPEN_PLACES = new Set(['street', 'market', 'mountain', 'dock', 'farm', 'tavern', 'inn', 'yamen', 'temple', 'taoist', 'sect', 'gambling', 'school', 'brothel']);

/** 填占位符。模板只允许 {who} / {dir} / {place} 三个（句库的自检也钉这三个） */
function fillTpl(s, who, dir, place) {
  return String(s)
    .replace(/\{who\}/g, who || '有人')
    .replace(/\{dir\}/g, dir || '别处')
    .replace(/\{place\}/g, place || '这里');
}

/**
 * @param world
 * @param events  [{npc, from, to}]
 * @returns {Array<{kind, text}>}
 */
function wanderLines(world, events) {
  const p = world && world.player;
  if (!p || !events || !events.length) return [];
  const here = p.room;
  const hereRoom = world.getRoom(here);
  if (!hereRoom) return [];
  const herePlace = placeOf(world, hereRoom);
  const placeName = hereRoom.name || '这里';
  const atInn = herePlace === 'inn' || herePlace === 'tavern';
  const open = OPEN_PLACES.has(herePlace);
  /* 隔壁房间集合（含自己）：只有落在这个圈里的走动才「看得见」 */
  const neighbors = new Set([here]);
  for (const d of Object.keys(hereRoom.exits || {})) {
    const ex = hereRoom.exits[d];
    const tid = typeof ex === 'string' ? ex : (ex && ex.to);
    if (tid) neighbors.add(tid);
  }

  const out = [];
  const said = new Set();
  const say = (kind, npc, dirVal) => {
    if (out.length >= MAX_PER_TICK) return;
    if (!npc || said.has(npc.name)) return;
    let pool = MOVE_LINES[kind];
    if (!pool || !pool.length) return;
    /* 客栈味的那几条只在客栈/酒楼用，别的地方串味 */
    if (kind === 'arrive' && !atInn) {
      const filtered = pool.filter(s => !INN_ONLY.has(s));
      if (filtered.length) pool = filtered;
    }
    said.add(npc.name);
    out.push({ kind: 'ambient', text: fillTpl(world.rng.pick(pool), npc.name, dirVal, placeName), who: npc.name });
  };

  /* ① 先播「走进来」（比「走掉」更该被看见） */
  for (const ev of events) {
    if (out.length >= MAX_PER_TICK) break;
    if (ev.to !== here || ev.from === here) continue;
    /* 同一个人这一 tick 只播一次；方向取「他打哪边来」的反向，读起来更顺 */
    say('arrive', ev.npc, dirOf(world, here, ev.from) || dirOf(world, ev.from, here));
  }
  /* ② 再播「走出去」 */
  for (const ev of events) {
    if (out.length >= MAX_PER_TICK) break;
    if (ev.from !== here) continue;
    say('leave', ev.npc, dirOf(world, here, ev.to));
  }
  /* ③ 最后才是「路过」：两边都在隔壁圈里、都不进玩家的屋，且玩家在开阔地 */
  if (open) {
    for (const ev of events) {
      if (out.length >= MAX_PER_TICK) break;
      if (ev.from === here || ev.to === here) continue;
      if (!neighbors.has(ev.from) || !neighbors.has(ev.to)) continue;
      say('passby', ev.npc, dirOf(world, ev.from, ev.to));
    }
  }
  return out;
}

/* --------------------------------------------------------------------------
 *  四、默认游走
 *
 *  数据里只有 1 个 NPC（山贼）写了 `wander` —— 也就是说 343 个 NPC 里
 *  只有 1 个会动，「NPC 会随机移动」这件事其实**从来没发生过**。
 *  这里给公共场所的普通 NPC 补一个默认值。
 *
 *  ⚠️ 四条边界，少一条世界就乱（第一条是实测踩出来的）：
 *    1. **有铺子的人不能走** —— 摊主一走，「看看货物」的按钮就点不着了。
 *    2. **有作息的人只在守本职时才溜达** —— 222 个 NPC 带 schedule，
 *       落班回家路上要是再被游走搬一次，人就飘没了。
 *       （⚠️ 第一版写的是「有 schedule 就一律不动」，结果**市集里一个会走的都没有**
 *        —— 那儿的 NPC 个个有作息，等于这个功能对最热闹的地方完全失效。）
 *    3. **只在公共场所走** —— 住家、偏屋、牢里、私域的不动。
 *    4. **数据可以钉死** —— `noWander: true`（关键 NPC，如发引荐信的老汉）一律不动。
 * -------------------------------------------------------------------------- */
const ROAM_PLACES = new Set(['street', 'market', 'dock', 'farm', 'mountain', 'tavern', 'school', 'gambling']);

function defaultWanderFor(world, def) {
  if (!world || !def) return null;
  if (def.wander) return def.wander;
  if (def.noWander) return null;                 // 数据钉住的（关键 NPC）不动
  if (def.shop) return null;                     // 有铺子的守着摊
  if (def.schedule) {
    const post = def.schedule.day || def.schedule.night;
    if (post && post !== def.room) return null;  // 不在本职岗位上（比如正往家走）就别乱转
  }
  const room = world.getRoom(def.room);
  if (!room || room.private) return null;
  const place = placeOf(world, room);
  if (!place || !ROAM_PLACES.has(place)) return null;
  return { chance: 0.05 };
}

/* --------------------------------------------------------------------------
 *  五、玩家附近的人「活化」
 *
 *  NPC 是**懒实例化**的（boot 完只有 3 个实例，其余是模板，玩家进那间屋才 spawn）。
 *  所以「隔壁屋的人走动」这件事，得先把隔壁屋的人变成实例，否则永远看不到。
 * -------------------------------------------------------------------------- */
function ensureNearbyNpcs(world, depth) {
  const p = world && world.player;
  if (!p) return 0;
  const hereRoom = world.getRoom(p.room);
  if (!hereRoom) return 0;
  const want = new Set([p.room]);
  for (const d of Object.keys(hereRoom.exits || {})) {
    const ex = hereRoom.exits[d];
    const tid = typeof ex === 'string' ? ex : (ex && ex.to);
    if (tid) want.add(tid);
  }
  if ((depth || 1) > 1) {
    for (const rid of Array.from(want)) {
      const r = world.getRoom(rid);
      for (const d of Object.keys((r && r.exits) || {})) {
        const ex = r.exits[d];
        const tid = typeof ex === 'string' ? ex : (ex && ex.to);
        if (tid) want.add(tid);
      }
    }
  }
  let n = 0;
  /* 🔴 先算一份**全局「还活着」的 defId 集合** —— 这是本函数曾经最致命的一处漏判：
     `spawnNpc` 只对**名人**「已有就返回那位」，对**非名人每次都新建实例**。
     原先这里没有任何「已经活着」的判断，于是**每个 worldTick（30 分钟）**
     都替玩家周围的每个常驻 NPC 再 spawn 一份 —— 玩得越久副本越多，
     房间行变成「这里有：张掌柜（商人） x7、…」，而且**副本会随存档写下去**，
     重进也修不掉（主人 2026-10-10 亲报的「所有人名字后面 ×7 / ×6」，就是这个）。
     ⚠️ `_npcsByRoom[rid]` 收录的是「常驻本房、不游走」的人（每 defId 一条），
        所以对这些人**全局只该有一个活实例**；用全局集合判，既不会漏，
        也不会误伤「一个房间故意放 3 只山贼」那种（那些走 `room.respawn`，不在此表里）。 */
  const alive = new Set();
  for (const inst of Object.values(world.instances.npcs || {})) {
    if (inst && inst.defId && !inst.dead) alive.add(inst.defId);
  }
  for (const rid of want) {
    for (const defId of (world._npcsByRoom[rid] || [])) {
      if (alive.has(defId)) continue;          // 已经活着 → 绝不再 spawn（防副本）
      const before = Object.keys(world.instances.npcs).length;
      try { world.spawnNpc(defId, rid, 1, true); } catch (e) { /* 单个 NPC 坏了不拖垮世界 */ }
      if (Object.keys(world.instances.npcs).length > before) { alive.add(defId); n++; }
    }
  }
  return n;
}

module.exports = {
  PLACE_RULES, ROAM_PLACES, MAX_PER_TICK,
  placeOf, ambientLine, wanderLines, defaultWanderFor, ensureNearbyNpcs, dirOf, fillTpl,
};
