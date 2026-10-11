/* ============================================================
 * gen-portraits-bc.js —— #112 众生画像 · B 层补员 + C 层补满
 *
 * ⚠️ 这是**写入型**脚本（输出 game/data/97_portraits_bc.json），
 *    名字故意不匹配 `smoke-*` / `*-check`，避免被全量回归误跑。
 *
 * 为什么用生成器而不是手写 132 条：
 *   量大（B 层补 57 + C 层补 75），且这批人多是「街面上的人」——
 *   他们需要的是**各有各的活计与心事**，不是各有各的传奇。
 *   所以做法是：每个身份写一小把**具体的**句子（不是空话），
 *   再按人物自身的真实字段（姓名/身份/所在区域/性格/喜好/邻居/关系）拼装。
 *
 * 两条纪律：
 *   ① **确定性**：选句只用 id 的哈希，不掷骰 —— 重跑必须一模一样（否则数据会漂）。
 *   ② **不覆盖已有**：只给 `!portrait` 的人写；已有画像一个字不动。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

/* ---------- 池子统一从共享模块取（#67 起，tools/gen-city-npcs.js 共用同一份） ---------- */
const { H, pick, pickSeq, fill, PERSONA_TONE, ARC, TAG_CN, T, GENERIC, C_T } = require('./lib-portrait-pools.js');
const { FIELD_T, GENERIC_FIELD } = require('./lib-portrait-field.js');


/* ================= 主流程 ================= */
const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;
const regionName = (roomId) => {
  const r = w.data.rooms[roomId];
  const rg = r && w.data.regions[r.region];
  return (rg && rg.name) || (r && r.name) || '城里';
};
/* 城镇型区域 —— 只有这些地方说「街上 / 摆摊 / 铺子」才不别扭。
   判据取「区域 id 白名单 + 区域 tier」，与 portrait-fit-check 的第 ③ 条同源。 */
const TOWN_REGIONS = new Set([
  'yamen', 'cunzhen', 'shuyuan', 'qinglou', 'palace', 'market', 'farmland', 'harbor',
  'luoyang', 'changan', 'chengdu', 'xiangyang', 'jiangnan', 'gusu', 'secret',
]);
const isTownRoom = (roomId) => {
  const r = w.data.rooms[roomId];
  if (!r) return false;
  const rg = w.data.regions[r.region];
  if (TOWN_REGIONS.has(r.region)) return true;
  return !!(rg && ['city', 'town', 'court', 'market', 'street', 'village'].indexOf(rg.tier) >= 0);
};
/* `%{place}`：城镇里用区域名（「洛阳城摆摊的」），
   城镇外用**房间名**（「蜀中官道巡查的捕快」「武当山门…」）——
   房间名天然带着「官道 / 山门 / 练武场」这类可信的地点词。 */
const placeOf = (roomId) => {
  const r = w.data.rooms[roomId];
  if (!r) return '这一带';
  if (isTownRoom(roomId)) return regionName(roomId);
  return String(r.name || '').replace(/·/g, '') || regionName(roomId);
};
const sectNameOf = (n) => {
  const s = n.sect ? w.data.sects[n.sect] : null;
  if (s && s.name) return s.name;
  const byId = { taishan: '泰山派', hengshan: '衡山派', hengshanN: '恒山派', qingcheng: '青城派', kongtong: '崆峒派', kunlun: '昆仑派', diancang: '点苍派', tiezhang: '铁掌帮', wuliang: '无量剑派', hehuan: '合欢宗', baituo: '白驼山', funiu: '伏牛派', baisheng: '百胜刀门', taihu: '太湖帮', poyang: '鄱阳帮', qingzhu: '青竹帮', jujing: '巨鲸帮', jinlong: '金龙帮', huanghe: '黄河帮', dafeng: '大风云飞门', wuyun: '五云手温家', luohan: '罗汉门', kuaidao: '快刀门', tieqiang: '铁枪门', shenquan: '神拳门', zhenyuan: '镇远镖局', feihu: '飞虎镖局', wuhu: '五虎断门刀', jindao: '金刀门', shandong: '泰山派' };
  for (const k of Object.keys(byId)) if ((n.id || '').indexOf(k) === 0) return byId[k];
  return (n.title || '').replace(/(掌门|弟子|掌门人)$/, '') || '这一门';
};

/* `fill` 已从 lib-portrait-pools.js 引入，这里不再重复定义 */

/* ---------- 这个人该用哪套模板 ----------
 * 🔴 主人 2026-10-11 抓到的真 bug：
 *    「古墓派的守阁弟子」被写成了市井口吻 ——
 *    role「谷魔窟做守库人这一行的，一干就是半辈子」、
 *    origin「前些年遭了场事，家当散尽，在这条街上重新立起来」、
 *    routine「在门口坐着，看街上人来人往」。
 *    还补了一句「还有这里也不是『街』啊」。
 *
 *    根因不是模板写错，而是**选模板只看 `tag`**：
 *    门派人物（守库人/弟子/当家）没有 `tag`，于是整批落到 `GENERIC` ——
 *    而 GENERIC 是给「街坊邻里」写的兜底池，满口街面腔。
 *    96 个有门派的 B/C 层人物全在这条错路上。
 *
 *    修法：先看门派身份（标题 / id 后缀），再看 `tag`，最后才用 GENERIC。
 *    标题到模板的对应就是这份数据里的真实取值：
 *    守库人 35 / 门中弟子 29 / 当家 20 / 一派之主 9 / 门主·掌门 2。
 */
function sectRoleOf(n) {
  const id = n.id || '';
  const t = n.title || '';
  if (/^wg_/.test(id)) return 'coach';
  if (/守库|看库|守门|看门|库房/.test(t) || /_keeper$/.test(id)) return 'keeper';
  if (/弟子|门人|门中|记名/.test(t) || /_disciple$/.test(id)) return 'disciple';
  if (/当家|一派之主|门主|掌门|教主|宗主/.test(t) || /_master$/.test(id)) {
    return (H(id) % 2 === 0) ? 'master2' : 'master';
  }
  if (n.sect) return 'disciple';
  return null;
}

function buildB(n, seq) {
  const tag = T[n.tag] ? n.tag : null;
  /* 选模板的**完整顺序**（每一步都有来由，别删）：
     ① 有具名活计 → 看落点：城镇用 T，山野 / 门派 / 官道用 FIELD_T
        （「洛阳城摆摊的」对，「唐门前厅挑担叫卖的」荒腔走板）
     ② 没活计但有门派身份 → 门派模板 C_T（守库人 / 弟子 / 当家）
     ③ 都没有 → 看落点：城镇用 GENERIC（街坊），城镇外用 GENERIC_FIELD */
  const role = tag ? null : sectRoleOf(n);
  const town = isTownRoom(n.room);
  let base;
  if (tag) base = town ? T[tag] : (FIELD_T[tag] || T[tag]);
  else if (role) base = C_T[role];
  else base = town ? GENERIC : GENERIC_FIELD;
  const region = regionName(n.room);
  const place = placeOf(n.room);
  const ta = (n.gender === 'female' || n.gender === '女') ? '她' : '他';
  /* ⚠️ `%{sect}` 在没有门派的人身上（如衙门·守库老吏）要回落成地名，
     否则会拼出「守库老吏看库的老头」这种把职称当门派名的怪句。 */
  const sect = n.sect ? sectNameOf(n) : region;
  const ctx = { name: n.name, region, place, town, title: n.title || '住户', sect, ta };
  const id = n.id;
  const arc = ARC[n.personality] || ARC.yi || ARC.lengmo;
  const p = {
    v: 1, tier: 'B', lock: false,
    role: fill(pickSeq(base.role, seq + 0), ctx),
    origin: fill(pickSeq(base.origin, seq + 1), ctx),
    now: fill(pickSeq(base.now, seq + 2), ctx),
    want: fill(pickSeq(base.want, seq + 3), ctx),
    fear: fill(pickSeq(base.fear, seq + 4), ctx),
    voice: (() => { const v = pickSeq(base.voice, seq + 5); return { tone: pick(PERSONA_TONE[n.personality] || PERSONA_TONE.mune, id + 'to'), catchphrase: fill(v.catchphrase, ctx) }; })(),
    routine: [(() => { const r = pickSeq(base.routine, seq + 6); return { at: r.at, act: fill(r.act, ctx) }; })()],
    arc: { init: fill(arc.init, ctx), warm: fill(arc.warm, ctx) },
    marks: (base.marks || []).slice(0, 2),
  };
  /* 没有 tag 的人（27 个）靠 title 定位；有 title 就别再拼一遍 */
  if (!tag && n.title) p.role = fill(pickSeq(base.role, seq + 0), ctx);
  else if (!tag) p.role = fill(pick(base.roleNoTitle, id + 'r'), ctx);
  return p;
}

function buildC(n, seq) {
  const id = n.id;
  const region = regionName(n.room);
  /* 同 buildB：`%{sect}` 无门派时回落地名 */
  const sect = n.sect ? sectNameOf(n) : region;
  const ta = (n.gender === 'female' || n.gender === '女') ? '她' : '他';
  const ctx = { name: n.name, region, sect, ta };
  let base, tier = 'C';
  /* 统一的身份判定（原来是四行 id 后缀正则，跟 buildB 各写一套 ——
     两边口径一旦不一致，同一个人换层就会换一副腔调）。 */
  base = C_T[sectRoleOf(n) || 'master'] || C_T.master;
  const isCoach = /^wg_/.test(id);
  const p = {
    v: 1, tier, lock: false,
    role: fill(pickSeq(base.role, seq + 0), ctx),
    now: fill(pickSeq(base.now, seq + 2), ctx),
    want: fill(pickSeq(base.want, seq + 3), ctx),
    voice: { tone: pick(PERSONA_TONE[n.personality] || PERSONA_TONE.mune, id + 'to'), catchphrase: fill(pickSeq(base.voice, seq + 5).catchphrase, ctx) },
    marks: (base.marks || []).slice(0, 2),
  };
  /* 武馆教头另有性格与外貌底子（desc 已写得很实），补上 fear 与 routine 让他们更立体 */
  if (isCoach) {
    p.fear = pick(['怕馆里招不到肯下苦功的人', '怕自己老了打不动了'].concat(), id + 'f');
    p.routine = [{ at: 'day', act: '背着手在院里走，看谁的马步先塌' }];
    /* 六位教头各写一句：他们本来就是同一种人，共用一句 origin 会像复制粘贴 */
    p.origin = pickSeq([
      '在武馆里教了二十年的拳，徒弟送走一批又一批。',
      '年轻时在镖行走过几年镖，伤了腿，回来接手了这间馆。',
      '他师父就是教头，师父的师父也是，这院子是他从小长大的地方。',
      '早年考过武举，没中，回来教拳，一教就是半辈子。',
      '他替城里几家大户看过院子，后来嫌不自在，进了武馆。',
      '拜过三个师父，学得最杂，教起来也最不挑人。',
    ], seq);
  }
  return p;
}

/* ---------- 选人 ---------- */
/* 🔴 「只补空位」这个纪律会把坏数据**永久留在磁盘上** ——
 *    智能体（这个脚本自己）迭代过好几版模板，可每一版生成的条目都成了
 *    「已有画像」，下一版再也碰不到它们。主人这次抓到的守阁弟子那三句，
 *    就是最早那版 GENERIC 街坊模板留下的化石。修了模板也白修。
 *    所以补一条：**本文件自己产出的条目，一律重建**（这个文件 100% 是生成物，
 *    `_note` 里就是这么写的），别人写的（96_portraits_a.json 等）一个字不碰。
 *    `lock: true` 的条目视为有人手动定过，原样保留。 */
const SELF = path.join(ROOT, 'game', 'data', '97_portraits_bc.json');
let owned = {}; let locked = {};
try {
  const prev = JSON.parse(fs.readFileSync(SELF, 'utf8'));
  owned = (prev && prev.npcs) || {};
} catch (e) { owned = {}; }
for (const k of Object.keys(owned)) {
  if (owned[k] && owned[k].portrait && owned[k].portrait.lock === true) locked[k] = owned[k];
}
const ownedIds = Object.keys(owned).filter(k => !locked[k]);

const all = Object.values(w.data.npcs);
const bMiss = all.filter(n => n.tier === 'B' && !n.portrait);
const cMiss = all.filter(n => n.tier === 'C' && !n.portrait);
/* 本文件名下、需要重建的那些（tier 以当前数据为准：有人从 C 提到 B 也不会漏） */
const bOwned = all.filter(n => n.tier === 'B' && ownedIds.indexOf(n.id) >= 0);
const cOwned = all.filter(n => n.tier === 'C' && ownedIds.indexOf(n.id) >= 0);
const pickedAll = [];

const HAVE_B = all.filter(n => n.tier === 'B' && n.portrait).length;
const NEED_B = Math.max(0, 60 - HAVE_B);
/* 按 tag 轮转取人：保证「身份散开」，不是清一色武人 */
const byTag = {};
for (const n of bMiss) { const k = T[n.tag] ? n.tag : '_'; (byTag[k] = byTag[k] || []).push(n); }
for (const k of Object.keys(byTag)) byTag[k].sort((a, b) => (b.rel ? b.rel.length : 0) - (a.rel ? a.rel.length : 0) || (a.id < b.id ? -1 : 1));
const picked = [];
const keys = Object.keys(byTag).sort();
let round = 0;
while (picked.length < NEED_B && round < 40) {
  for (const k of keys) {
    if (picked.length >= NEED_B) break;
    const arr = byTag[k];
    if (arr[round]) picked.push(arr[round]);
  }
  round++;
}

/* 组内序号：变体按「同组第几个人」轮转着取，而不是按 id 哈希 ——
   哈希在小样本里会撞堆（21 个看门人抽到同一句口头禅 9 次）。 */
/* ⚠️ 分组必须与**模板选择**同源：原来这里是一串 id 后缀正则，跟 buildB/buildC
   里那套各写一份 —— 两边一旦不一致，同一个人就会被按 A 组取序号、按 B 套模板。
   现在统一问 sectRoleOf()。 */
const cGroupOf = n => {
  const r = sectRoleOf(n);
  return r || (T[n.tag] ? n.tag : '_');
};

/* 需要产出的全集 = 本文件已拥有（重建） ∪ 还缺画像的（补员） */
const bOut = bOwned.concat(picked.filter(n => bOwned.every(x => x.id !== n.id)));
const cOut = cOwned.concat(cMiss.filter(n => cOwned.every(x => x.id !== n.id)));

const seqB = {};
{ const seen = {};
  for (const n of bOut) { const k = cGroupOf(n); seqB[n.id] = seen[k] || 0; seen[k] = (seen[k] || 0) + 1; } }
const seqC = {};
{ const seen = {};
  for (const n of cOut) { const g = cGroupOf(n); seqC[n.id] = seen[g] || 0; seen[g] = (seen[g] || 0) + 1; } }

const out = {
  _note: 'B 层补员 + C 层补满（#112）。生成器：tools/gen-portraits-bc.js'
    + '（确定性 + 组内轮转选句，重跑一致）。'
    + '⚠️ 本文件**完全由生成器拥有**：每次重跑会重建其中每一条（除非某条标了 lock:true）。'
    + '别人写的画像（96_portraits_a.json 等）一个字不动。',
  npcs: {},
};
for (const k of Object.keys(locked)) out.npcs[k] = locked[k];   // 手动定过的原样留着
for (const n of bOut) out.npcs[n.id] = { portrait: buildB(n, seqB[n.id] || 0) };
for (const n of cOut) out.npcs[n.id] = { portrait: buildC(n, seqC[n.id] || 0) };

fs.writeFileSync(SELF, JSON.stringify(out, null, 2) + '\n', 'utf8');
console.log('B 层：重建', bOwned.length, ' + 补员', picked.length, '（B 层总画像', HAVE_B, '，目标 60）');
console.log('C 层：重建', cOwned.length, ' + 补员', cMiss.length);
console.log('共写入', Object.keys(out.npcs).length, '条（其中手动锁住', Object.keys(locked).length, '条）→ game/data/97_portraits_bc.json');
