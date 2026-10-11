/* ============================================================
 * gen-mountain-paths.js —— 给名山补「上山路」+ 山脚村庄（写入型）
 *
 * 主人 2026-10-11：
 *   「城市与城市（或门派或皇宫或其他区域）挨太近了（基本走两步就到另一个区域），
 *     野外的占比反而很小」
 *   「还有一些『山』特别小，走两步就没了，完全不能给人这山真的很高的感觉
 *     （还有古代一般山脚下都有村庄，这却反而没有）很违和」
 *
 * 做法：
 *   ① **上山路**：每座 sect / mad 山，在「山门 → 山上第一间房」那条边上
 *      插入 4 间山道（石阶 / 半山亭 / 林间道 / 崖边），把「两步就上山」
 *      变成「走五六步才到」。
 *   ② **山脚村**：给四座名山各配一座山脚村（村口 / 打谷场 / 茶棚 / 山神庙），
 *      从山门村接进去 —— 古人上山先在村里歇脚、问路、雇挑夫，这是常识。
 *
 * ⚠️ 只写 game/data/100_mountain_paths.json 一个文件；
 *    既有的山门房用「同名键合并」的方式补一个出口，**不动别的字段**。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '88_mountain_paths.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;
const R = w.data.rooms;

/* 要改造的山（region id） */
const MOUNTAINS = ['huashan', 'shaolin', 'wudang', 'emei', 'dali', 'tangmen', 'miaojiang', 'gaibang', 'gumu', 'mojiao', 'taohuadao'];

/* 山道六段的写法：各有各的样子，不是「石阶 1/2/3/4」。
   六段而不是四段 —— 主人要的是「给人这山真的很高的感觉」，走四步还不够；
   六步（外加山门那一步）才算「爬上去」。 */
const SEG = [
  { k: 'steps', name: '石阶', desc: '石阶一级级往上，凿在岩壁上。走了不知多少级，回头一看，山门已经小成拇指大。' },
  { k: 'pine', name: '松林', desc: '一片老松，枝子横着长，把路遮得半明半暗。风过时满山响，像有人在远处说话。' },
  { k: 'rest', name: '半山亭', desc: '半山一处歇脚的旧亭，柱子被摸得发亮。亭里有人留下的水囊，还有一堆没人收的柴。' },
  { k: 'wood', name: '林间道', desc: '道从林子中间穿过去。树密得看不见天，脚下的落叶一脚踩下去，能陷半寸。' },
  { k: 'spring', name: '山泉', desc: '一眼泉水从石缝里渗出来，接在石槽里，槽沿磨得圆了。上上下下的人都在这里歇一歇，喝一口。' },
  { k: 'cliff', name: '崖边路', desc: '路贴着崖壁走，只容一人。风从下头往上灌，衣角一直响。' },
];

const out = { _note: '名山的上山路与山脚村（gen-mountain-paths.js 生成，重跑一致）。只补房间与出口，不改既有字段。', rooms: {}, npcs: {} };

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'u', 'd'];
/* ⚠️ 一定要带 u/d（上下）—— 黑木崖的山路用的就是 `u`（上山）/`d`（下山）。
   漏了它们，`BACK[dir]` 会是 undefined，反向边全写错
   （map-check 的「非严格反向」一口气报十几条）。 */
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };
const dirOf = (from, to) => Object.keys(R[from].exits || {}).find(d => {
  const ex = R[from].exits[d]; return (typeof ex === 'string' ? ex : ex.to) === to;
});

let pathCount = 0, villageCount = 0;

for (const reg of MOUNTAINS) {
  const rg = w.data.regions[reg];
  if (!rg) continue;
  const ids = Object.keys(R).filter(x => R[x].region === reg);
  if (!ids.length) continue;
  /* 山门 = 该区域里**有跨区出口**的那间房（玩家是从那儿进来的）。
     但「山道」不该插在「山脚道 → 山脚」之间 —— 那等于把山路架在山脚外头。
     正确的插入点是**山脚那一间**（名字含「脚下/山脚」），退一步才是「山门」。 */
  const crossers = ids.filter(x => Object.keys(R[x].exits || {}).some(d => {
    const ex = R[x].exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    return R[tid] && R[tid].region !== reg;
  }));
  /* 插入点（= 上山路的起点）的挑选顺序：
     ① 名字含「脚下 / 山脚」的房 —— **它未必有跨区出口**
        （「华山脚下」两个方向都在区内，第一版因此把它漏掉了，
          结果山道接在了更外面那条 `华山道·山脚` 上）
     ② 名字含「山门」的房
     ③ 有跨区出口的房（玩家必然是从那儿进来的）
     ④ 兜底：区内第一个 */
  /* ⚠️ 只认「脚下」，不认「山脚」—— 「华山道·山脚」（那条**山外的道**）名字里也有「山脚」，
     第一版因此被它抢了插入点，山道架到了华山**外头**（实测「站在华山脚下往北走不动」）。 */
  const gate = ids.find(x => /脚下/.test(R[x].name || ''))
    || ids.find(x => /山门/.test(R[x].name || ''))
    || crossers[0] || ids[0];
  /* 山上第一间 = 山门在**本区内**的那个出口。
     ⚠️ 要排除两类「不是上山」的区内出口：
       · `road_*`（山脚那条外面的道 —— 从「山脚」往那儿走是**下山**）
       · 名字含「脚下/山脚」的（同一条路的另一头）
     第一版没排除，于是把山道接在了「山脚 → 山脚道」这条**下山路**上，
     实测「站在华山脚下往北走不动」。 */
  const first = Object.keys(R[gate].exits || {}).map(d => {
    const ex = R[gate].exits[d]; return typeof ex === 'string' ? ex : ex.to;
  }).find(t => R[t] && R[t].region === reg && !/^road_/.test(t) && !/脚下|山脚/.test(R[t].name || ''));
  if (!first) continue;
  /* 幂等：第二次跑时，山门通往的已经是本生成器产出的山道 —— 跳过，别再套一层。 */
  if (/_path\d+$/.test(first)) continue;

  const dir = dirOf(gate, first);
  if (!dir) continue;
  const back = BACK[dir] || 's';

  /* ---- ① 四段山道 ---- */
  const chain = SEG.map((s, i) => reg + '_path' + (i + 1));
  chain.forEach((id, i) => {
    const s = SEG[i];
    const nxt = i === chain.length - 1 ? first : chain[i + 1];
    const prv = i === 0 ? gate : chain[i - 1];
    out.rooms[id] = {
      id, name: rg.name + '·' + s.name, region: reg,
      desc: s.desc + '（再往上，' + ((w.data.rooms[nxt] || {}).name || '山门') + '就在前头。）',
      exits: { [dir]: nxt, [back]: prv },
    };
    pathCount++;
  });
  /* 山门 → 第一段；山上第一间 → 最后一段（反向）
     🔴 必须**保留原出口对象**（`{to, cond, msg, travel}`）—— 华山的出口上挂着
        「无竹牌上不去」的门禁（`cond` + `msg` + `travel`），
        第一版直接写成裸字符串 `{n:'huashan_path1'}`，把门禁整个冲掉了
        （smoke-guards 当场判红：「无竹牌应被拦」，实际一路畅通）。 */
  const oldEx = (R[gate].exits || {})[dir];
  const keepCond = (oldEx && typeof oldEx === 'object') ? oldEx : null;
  out.rooms[gate] = out.rooms[gate] || { id: gate, exits: {} };
  out.rooms[gate].exits = Object.assign({}, out.rooms[gate].exits, {
    [dir]: keepCond ? Object.assign({}, keepCond, { to: chain[0] }) : chain[0],
  });
  out.rooms[first] = out.rooms[first] || { id: first, exits: {} };
  out.rooms[first].exits = Object.assign({}, out.rooms[first].exits, { [back]: chain[chain.length - 1] });
}

/* ---- ② 山脚村：四座名山各一座（村口 → 打谷场 / 茶棚 / 山神庙） ---- */
const VILLAGES = [
  { reg: 'huashan', id: 'hs_village', name: '玉泉村', desc: '华山脚下的村子，几十户人家，家家门口堆着柴。往山上去的香客、挑夫、赶考的，都在这儿歇脚。' },
  { reg: 'shaolin', id: 'sl_village', name: '柏谷村', desc: '少室山下的村子。村里多半姓王，世代替寺里种菜、挑水。' },
  { reg: 'wudang', id: 'wd_village', name: '遇真村', desc: '武当山脚的村子，屋舍依着溪水排。村里的老人多半会两手粗浅的导引术，说是跟山上的道人学的。' },
  { reg: 'emei', id: 'em_village', name: '伏虎村', desc: '峨眉山脚的村子，村口的石头真被打磨成一只伏着的老虎。往上走三天才到金顶。' },
];

for (const v of VILLAGES) {
  const rg = w.data.regions[v.reg];
  if (!rg) continue;
  const ids = Object.keys(R).filter(x => R[x].region === v.reg);
  const gate = ids.find(x => Object.keys(R[x].exits || {}).some(d => {
    const ex = R[x].exits[d];
    const tid = typeof ex === 'string' ? ex : ex.to;
    return R[tid] && R[tid].region !== v.reg;
  })) || ids[0];
  const kou = v.id + '_kou';
  /* 幂等：村口已经接上过就跳过 */
  const hasKou = Object.keys(R[gate].exits || {}).some(d => {
    const ex = R[gate].exits[d]; const tid = typeof ex === 'string' ? ex : ex.to;
    return /_kou$/.test(tid);
  });
  if (hasKou) continue;
  /* 🔴 山门通往村子这条边，必须用**空着的方向**。
     第一版硬写了 `n`，而山门原本的 `n` 正是「上山的路」——
      一句赋值把上山路整个改成了村口（map-check 的「非严格反向」当场抓出来：
      `sl_village_kou -n-> road_shaolin_1，但 sl_village_yard -s-> sl_village_kou`）。 */
  const usedDirs = Object.assign({}, R[gate].exits || {}, (out.rooms[gate] || {}).exits || {});
  const toVillage = DIRS.find(d => !usedDirs[d]) || 'e';
  const yard = v.id + '_yard';
  const tea = v.id + '_tea';
  const shrine = v.id + '_shrine';
  out.rooms[kou] = {
    id: kou, name: v.name + '·村口', region: v.reg, desc: v.desc + '村口一棵老槐树下坐着几个人。',
    exits: { n: yard, [BACK[toVillage]]: gate },
  };
  out.rooms[yard] = { id: yard, name: v.name + '·打谷场', region: v.reg, desc: '一块平整的土场，摊着刚收的谷子。场边堆着几副挑山的竹杠。', exits: { s: kou, e: tea, w: shrine } };
  out.rooms[tea] = { id: tea, name: v.name + '·茶棚', region: v.reg, desc: '半敞的茶棚，长条凳磨得发亮。上山的人在这儿喝一碗再走。', exits: { w: yard } };
  out.rooms[shrine] = { id: shrine, name: v.name + '·山神庙', region: v.reg, desc: '一间小小的山神庙，供着山神与土地。庙前的香炉里插着半截没烧完的香。', exits: { e: yard } };
  out.rooms[gate] = out.rooms[gate] || { id: gate, exits: {} };
  out.rooms[gate].exits = Object.assign({}, out.rooms[gate].exits, { [toVillage]: kou });

  /* 村里的三个人：一个指路的老人、一个挑夫、一个卖茶的 */
  out.npcs[v.id + '_old'] = {
    id: v.id + '_old', name: '村口老丈', gender: 'male', tag: 'farmer', title: v.name + '村口老丈',
    room: kou, home: 'house:' + v.id + '_old', personality: 'mune',
    desc: '蹲在槐树底下，手里捏着根旱烟杆，烟早就灭了。',
    talk: ['上山的路，天亮前走，天黑前下。', '每年都有不听劝的。'],
    age: 68, likes: ['tea'], level: 3, hp: 60, atk: 6, def: 4, dodge: 3, speed: 8, money: 20, hostile: false,
    tier: 'C', district: v.reg, homeless: true, schedule: { day: kou, night: kou },
    portrait: { v: 1, tier: 'C', lock: false,
      role: '在村口坐了一辈子的老丈，上山的路他闭着眼也走得下来',
      origin: '年轻时也上过山，替寺里（观里）挑过三年水，后来腿不行了，就在村口坐着。',
      now: '近来上山的生面孔多，他看着，也不多问。',
      want: '把这条路的规矩，说给还愿意听的人', fear: '怕哪一年雪大，封了山，村里断了进项',
      voice: { tone: '木讷，半天挤一句', catchphrase: '慢慢走，别急。' },
      routine: [{ at: 'day', act: '蹲在槐树底下，看上山下山的人' }],
      marks: ['乡'] },
  };
  out.npcs[v.id + '_porter'] = {
    id: v.id + '_porter', name: '挑山汉子', gender: 'male', tag: 'porter', title: v.name + '挑夫',
    room: yard, home: 'house:' + v.id + '_porter', personality: 'haoshuang',
    desc: '肩上搭着一条汗巾，脚下踩着一双草鞋，小腿上的青筋盘着。',
    talk: ['一趟三十文，包上下。', '价钱是死的，人是活的。'],
    age: 34, likes: ['wine'], level: 8, hp: 130, atk: 18, def: 10, dodge: 8, speed: 12, money: 60, hostile: false,
    tier: 'C', district: v.reg, homeless: true, schedule: { day: yard, night: tea },
    portrait: { v: 1, tier: 'C', lock: false,
      role: '村里替人挑货上山的汉子，一趟三十文',
      origin: '从小跟着爹挑山，肩膀上的茧是他爹看着长出来的。',
      now: '近来香客少，他一天只跑得了一趟。',
      want: '攒够钱，换一副好竹杠', fear: '怕哪一天自己挑不动了',
      voice: { tone: '豪爽，笑声先到', catchphrase: '东西给我，你只管走。' },
      routine: [{ at: 'day', act: '把竹杠往肩上一搭，脚尖一点就起了' }],
      marks: ['工'] },
  };
  out.npcs[v.id + '_tea'] = {
    id: v.id + '_tea', name: '茶棚婆子', gender: 'female', tag: 'vendor', title: v.name + '茶棚主',
    room: tea, home: 'house:' + v.id + '_tea', personality: 'wenwan',
    desc: '围裙上落着一层茶渍，手上的铜壶擦得发亮。',
    talk: ['一碗三文，续水不要钱。', '上山前多喝一口，山上的水贵。'],
    age: 51, likes: ['tea'], level: 4, hp: 70, atk: 7, def: 5, dodge: 4, speed: 9, money: 80, hostile: false,
    tier: 'C', district: v.reg, homeless: true, schedule: { day: tea, night: yard },
    portrait: { v: 1, tier: 'C', lock: false,
      role: '山脚村茶棚的婆子，一碗三文，续水不要钱',
      origin: '这茶棚是她男人留下的，男人走后她一个人撑了十二年。',
      now: '棚子的柱子该换了，她一直没舍得动。',
      want: '把棚子再撑十二年', fear: '怕哪一年村里修路，把棚子挪走',
      voice: { tone: '温和，先把人让过', catchphrase: '坐，水刚开的。' },
      routine: [{ at: 'day', act: '提着铜壶在长条凳之间转，见碗空了就续' }],
      marks: ['商'] },
  };
  villageCount++;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('写入', pathCount, '间山道 /', villageCount, '座山脚村（' + Object.keys(out.rooms).length + ' 间房、' + Object.keys(out.npcs).length + ' 人）→', OUT);
