/**
 * fix-b17-b18.js — 批次 6 · B17 / B18 两条数据错配的确定式修正
 *
 * 一并处理（同一个文件只改这一遍）：
 *
 * ── B17 嫔妃落黑木崖（4 席）──────────────────────────────────────────
 * npcv_053 禹清 / npcv_119 蔡落 / npcv_185 元明月 / npcv_251 田绿
 *   tag=consort（嫔妃，title 也是「嫔妃」），却落在 `mojiao_hall`「黑木崖·大殿」。
 *
 *   **根因（查实）**：`tools/gen-social.js` 的 `placeFor(tag)` 用房间**名**里的
 *   `/宫|殿|苑|御/` 判「是不是宫室」——`黑木崖·大殿` 含「殿」被误判成 palace，
 *   于是 consort（TAG_PLACE=['palace','palace','tower']）被排进去。
 *   同一个坑还造成：`少林·大雄宝殿`（含殿）排进了 4 名内侍、
 *   `武当·紫霄宫`（含宫）排进了 4 名宫中内人（那两处 B19 认定「非错配」，不动）。
 *
 *   **判据（为什么改落点、不改 tag）**：
 *   ① `consort`＝嫔妃＝**宫廷位分**（title 明写「嫔妃」）；另有 5 位同 tag 的嫔妃
 *      本就在 `palace_court2`「皇城·西六宫」——**tag 的合法落点是明确的**；
 *   ② 数据里与「黑木崖」一致的那些字段（district=mojiao / province=江湖 /
 *      neighbors 里的魔教人 / 4 张 C 层画像写「被献到黑木崖的女子」）**全部是
 *      落点错误的下游产物**，不是独立证据（画像作者自己在 npcv_053 的 `_note`
 *      里写了「落点错配…在像内圆场」）；
 *   ③ 若改 tag，则要找一个「魔教女眷」的 tag —— **现有 33 个 tag 里没有这个身份**
 *      （没有 tag 能承接），所以错的是落点，不是 tag。
 *   ⇒ 处理：**落点归位到 `palace_court2`**，并把下游的 district/province/neighbors
 *     一并对齐；4 张 C 层画像同步改写（见 `design/portraits-batch-c.json`）。
 *
 * ── B18 内侍 gender 与 tag 矛盾（5 席）──────────────────────────────
 * npcv_051 麻时 / npcv_117 平白 / npcv_183 何红 / npcv_249 孟望 / npcv_282 窦静
 *   tag=eunuch（内侍/太监，title 也是「内侍」），gender 却是 female。
 *
 *   **根因（查实）**：`tools/gen-social.js:380-381` 的性别规则——
 *   `['courtesan','singer','consort','palace','nun','madam'].includes(tag) ? 'female' : 随机`
 *   ——**`eunuch` 不在强制为男的白名单里**，于是 10 个内侍里随机出了 5 个 female。
 *   同理 `monk` 也没被强制为男（另有 4 个女「和尚」，不属本批，另行登记）。
 *
 *   **判据（为什么改 gender、不改 tag）**：
 *   ① 「内侍/太监」是**定义上只有男性**的身份（tag 与 title 都写明「内侍」）；
 *      「女内侍」在语义上不成立，而「男内侍」完全成立；
 *   ② `gender` 的**下游派生物**（desc 的女式配饰「耳坠/辫子/帔子」、画像 now 里的
 *      「她」）都是**从 gender 生成的**，属循环证据，不构成独立佐证；
 *   ③ tag 是**结构性分配**的——`eunuch` 恰好 9 席，与 C 层批次设计
 *      （`design/15-portrait-roster.md` §5.4「C2＝嫔妃9+宫人9+内侍9+青楼女子6」）
 *      完全对上，说明 tag 是对的、gender 是错的那一边。
 *   ⇒ 处理：**gender → male**（只改 gender 这一边），并把由 gender 派生的
 *     `desc`（女式配饰）与画像 `now`（「她」）一并对齐。
 *     ⚠️ **tag / title / room 一律不动**（依 B18 铁律「不许两边都改」）。
 *     ⚠️ 残留：「4 名内侍落在少林·大雄宝殿」是上面那条房间名误判的下游，
 *        但 B19 已认定同类（武当宫中内人）**非错配**，故本批不动，仅登记。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');

/* ── B17 目标 ── */
const B17 = ['npcv_053', 'npcv_119', 'npcv_185', 'npcv_251'];
const PALACE_ROOM = 'palace_court2';   // 皇城·西六宫（另 5 位嫔妃所在）

/* ── B18 目标：gender → male；desc 换成男内侍口径（原 desc 是女式配饰，从 gender 派生） ── */
const B18_DESC = {
  npcv_051: '手里拿着把拂尘，拂尘穗子白了，面上无须，答话先清一清嗓子。',
  npcv_117: '脚上是软底靴，走起来没声，声音又细又长，一句话能拖到人走神。',
  npcv_183: '说话时手笼在袖里，面上无须，看人时先垂一下眼。',
  npcv_249: '说话时手笼在袖里，肩上搭着件半旧的披风，「宫里」两个字总咽回去。',
  npcv_282: '脚上是软底靴，走起来没声，笑起来也听不见动静，头发白了大半。',
};

function main() {
  const raw = fs.readFileSync(FILE, 'utf8');
  const data = JSON.parse(raw);
  /* 格式闸门：40_npcs.json 是 1 空格缩进，JSON.stringify(null,1) 必须逐字节还原 */
  if (JSON.stringify(data, null, 1) !== raw) {
    console.error('✘ 格式闸门未过：JSON.stringify(data,null,1) 不能逐字节还原原文件，拒绝改写。');
    process.exit(2);
  }
  const npcs = data.npcs;
  const log = [];

  /* ── B17：落点归位 ── */
  const palaceNames = Object.keys(npcs)
    .filter(k => npcs[k].room === PALACE_ROOM && !B17.includes(k))
    .map(k => npcs[k].name);
  B17.forEach((id, i) => {
    const n = npcs[id];
    if (!n) { console.error('✘ B17 目标不存在:', id); process.exit(2); }
    const before = { room: n.room, district: n.district, province: n.province };
    n.room = PALACE_ROOM;
    n.district = 'palace';
    n.province = '京畿道';
    // neighbors：换到新邻居（自 palace_court2 其余住户中轮取 4 位，逐人错开，避免四人同一张名单）
    n.neighbors = palaceNames.slice().concat(palaceNames.slice())
      .slice(i, i + 4).filter(x => x !== n.name).slice(0, 4);
    log.push(`B17 ${id} ${n.name}: room ${before.room}→${n.room} / district ${before.district}→palace / province ${before.province}→京畿道`);
  });

  /* ── B18：gender 归正 + desc 对齐 ── */
  Object.keys(B18_DESC).forEach(id => {
    const n = npcs[id];
    if (!n) { console.error('✘ B18 目标不存在:', id); process.exit(2); }
    if (n.gender !== 'female') { console.error('✘ B18 目标不是 female，环境已变:', id, n.gender); process.exit(2); }
    const beforeG = n.gender, beforeD = n.desc;
    n.gender = 'male';
    n.desc = B18_DESC[id];
    log.push(`B18 ${id} ${n.name}: gender ${beforeG}→male / desc 换男内侍口径（原：${beforeD.slice(0, 14)}…）`);
  });

  fs.writeFileSync(FILE, JSON.stringify(data, null, 1), 'utf8');
  console.log('=== fix-b17-b18 完成（4 + 5 席）===');
  log.forEach(x => console.log('  ' + x));

  /* 复核 */
  const after = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  console.log('复核：');
  console.log('  B17 全部落 palace_court2：', B17.every(k => after.npcs[k].room === PALACE_ROOM));
  console.log('  palace_court2 嫔妃总数：', Object.keys(after.npcs).filter(k => after.npcs[k].room === PALACE_ROOM).length);
  console.log('  B18 全部 male：', Object.keys(B18_DESC).every(k => after.npcs[k].gender === 'male'));
  console.log('  eunuch 里 female 数：', Object.keys(after.npcs).filter(k => after.npcs[k].tag === 'eunuch' && after.npcs[k].gender === 'female').length);
  console.log('  格式仍可逐字节还原：', JSON.stringify(after, null, 1) === fs.readFileSync(FILE, 'utf8'));
}

main();
