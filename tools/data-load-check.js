/* ==========================================================================
 * tools/data-load-check.js —— 加载层 fail-fast 守卫（闸一）
 * --------------------------------------------------------------------------
 * 它守的病（三兄弟，同一个根）：
 *   ① `loadBaseData()` 把坏 JSON 吞掉：只 console/modLog 记一笔，引擎照常起，
 *      游戏照常能玩，而那半个文件里的东西**一条都取不到**。
 *      实测代价（2026-10-11）：`102_classic_quests.json` 5 处引号写成单引号
 *      ⇒ 5 条任务凭空消失，表现为「接任务 → 没有这个任务」，
 *      **不崩、不报错，回归 131 套全绿**。
 *   ② 分片叠加的「浅合并」：房间在磁盘上分片存，前一片给 name/desc，
 *      后一片只补 exits。若按「整条覆盖」合并，name 就被后一片冲掉，
 *      而且**不报错**（房间变成 {id, exits}，界面上一片空白名字）。
 *   ③ 报错不定位：514 个数据文件里找一个坏引号是体力活。
 *
 * 修法（在 `game/src/core/dataload.js`）：
 *   · 坏 JSON ⇒ 抛 DataLoadError，带 **文件名 + 行号 + 列号 + 原始片段**
 *   · 结构不合法（集合键是原语 / 数组条目缺 id）⇒ 同样抛
 *   · 分片按 **数值前缀** 排序（`10_` 在 `101_` 之前；旧版字典序正相反）
 *   · 分片叠加走 **深合并**
 *
 * 本脚本怎么验（**只认退出码**）：
 *   A. 干净数据 ⇒ 绿（真跑一遍 `GameEngine.boot()`）
 *   B. 注入故障 ⇒ **必须红**：坏 JSON ×3 种 / 集合键写错 / 条目缺 id / 顶层不是对象
 *   C. 分片叠加 ⇒ name/desc 保住、exits 合并；并有**浅合并反向对照**，
 *      证明这条断言不是空断言（换成整条覆盖，它当场就红）
 *   D. 排序 ⇒ 数值前缀（10 < 101），编号大的后加载、后覆盖
 *   E. `dataload.COLLECTIONS` 与 `world.js` 源码里的 `collections` **不许漂移**
 *
 * ⚠️ 与 `check-data-load.js` 的分工：那边守「**内容**能不能取到」（任务有没有
 *    通路、目标房间存不存在）；这边守「**加载器**会不会把错吞掉」。两个都得在。
 * ========================================================================== */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const WORLDJS = path.join(ROOT, 'game', 'src', 'core', 'world.js');

const dataload = require(path.join(ROOT, 'game', 'src', 'core', 'dataload.js'));
const { World } = require(path.join(ROOT, 'game', 'src', 'core', 'world.js'));
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) pass++;
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); }
};
const head = t => console.log('\n===== ' + t + ' =====');

/* 临时数据目录：所有注入故障都在这里发生，**绝不碰 game/data/**。
   ⚠️ 2026-10-12 改：从 `os.tmpdir()` 迁到**项目内** `.livetest/`（统一隔离写法；
   系统临时目录在别的机器上权限不可控）。带 pid 以免并发跑互相踩。 */
const TMP = path.join(ROOT, '.livetest', 'dataload-' + process.pid);
fs.mkdirSync(TMP, { recursive: true });
function tmpDir(tag) {
  const d = path.join(TMP, tag);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function write(dir, name, text) {
  fs.writeFileSync(path.join(dir, name), text, 'utf8');
  return path.join(dir, name);
}
/** 只喂临时目录的 World：不走 boot，专测加载层 */
function loadOnly(dir) {
  const w = new World({ dataDirs: [dir], seed: 1 });
  w.loadBaseData();
  return w;
}
/** 期望 fn() 抛错；返回错误对象（没抛返回 null，并记一条失败） */
function expectThrow(name, fn) {
  let e = null;
  try { fn(); } catch (err) { e = err; }
  ok('★ ' + name, !!e, e ? '' : '没有抛错 —— 坏数据被吞了（这正是这个守卫要防的）');
  return e;
}
/** 断言错误信息里带得齐：文件名 + 行号列号 + 原文片段 */
function expectLocated(tag, e, fname) {
  if (!e) return;
  const m = String(e.message || '');
  ok('　' + tag + ' · 点名文件 ' + fname, m.indexOf(fname) >= 0, m.slice(0, 120));
  ok('　' + tag + ' · 给到行号列号', /第 \d+ 行第 \d+ 列/.test(m), m.split('\n')[0]);
  ok('　' + tag + ' · 带原始片段（有 ^ 指着出错那一列）', m.indexOf('^') >= 0);
}

(async () => {
  /* ---------------------------------------------------------------- A */
  head('A · 干净数据必须绿（真跑一遍 boot）');
  {
    let bootErr = null;
    let g = null;
    try {
      g = new GameEngine({ seed: 20261012 });
      g.boot({});
    } catch (e) { bootErr = e; }
    ok('★ 引擎能起来（干净数据不该抛）', !bootErr, bootErr ? String(bootErr.message).slice(0, 400) : '');
    if (g) {
      const errs = (g.world.modLog || []).filter(m => m.level === 'error');
      ok('★ modLog 无 error', errs.length === 0, errs.map(m => m.msg).join(' | ').slice(0, 300));
      const rooms = g.world.data.rooms || {};
      const ids = Object.keys(rooms);
      ok('房间数量合理（≥ 400，防数据目录被搬空）', ids.length >= 400, ids.length + ' 间');
      /* 分片叠加的**端对端**断言：任何一间房被后一片「冲名」都会在这里现形 */
      const noName = ids.filter(id => !rooms[id].name);
      ok('★ 每间房都有 name（分片没把名字冲掉）', noName.length === 0, noName.slice(0, 6).join(','));
      const noDesc = ids.filter(id => !rooms[id].desc);
      ok('★ 每间房都有 desc', noDesc.length === 0, noDesc.slice(0, 6).join(','));
      const noExits = ids.filter(id => !rooms[id].exits || !Object.keys(rooms[id].exits).length);
      ok('★ 每间房都有 exits', noExits.length === 0, noExits.slice(0, 6).join(','));
      /* 具体点名一间**确实分片存**的房：73 给 name/desc，82 只补 exits */
      const t = rooms['taishan_hall'];
      ok('★ taishan_hall 分片叠加后 name 还在', !!(t && t.name), t ? JSON.stringify(t).slice(0, 160) : '取不到');
      ok('　taishan_hall 的 exits 是两片合并的结果', !!(t && t.exits && t.exits.d && t.exits.e),
        t && t.exits ? JSON.stringify(t.exits) : '');
    }
  }

  /* ---------------------------------------------------------------- B */
  head('B · 坏 JSON 必须红，且定位到行号');
  {
    /* B1：引号写成单引号 —— 就是 2026-10-11 那次的原样（V8 这类错误不给 position，
       必须靠 dataload 的兜底扫描器定位） */
    const d = tmpDir('bad-quote');
    write(d, '01_rooms.json', '{\n  "rooms": {\n    "a_room": {\n      "id": "a_room",\n      "name": "测试房",\n      "desc": "来者是客。\n    }\n  }\n}');
    const e1 = expectThrow('B1 单引号（缺右引号）→ 抛错', () => loadOnly(d));
    expectLocated('B1', e1, '01_rooms.json');

    /* B2：多余逗号（V8 这类会给 position） */
    const d2 = tmpDir('bad-comma');
    write(d2, '02_rooms.json', '{\n  "rooms": {\n    "a": { "id": "a", "name": "A" },\n  }\n}');
    const e2 = expectThrow('B2 多余逗号 → 抛错', () => loadOnly(d2));
    expectLocated('B2', e2, '02_rooms.json');

    /* B3：字符串里裸换行 */
    const d3 = tmpDir('bad-control');
    write(d3, '03_rooms.json', '{\n  "rooms": {\n    "a": { "id": "a", "desc": "第一行\n第二行" }\n  }\n}');
    const e3 = expectThrow('B3 字符串里裸换行 → 抛错', () => loadOnly(d3));
    expectLocated('B3', e3, '03_rooms.json');

    /* B1 的定位必须**指到出错的那一行**（第 6 行 `"desc": "来者是客。`） */
    if (e1) {
      const m = /(第 \d+) 行/.exec(String(e1.message));
      ok('　B1 行号落在 5~7 行之间（真指到了那一处，不是报第 1 行糊弄）',
        !!m && (parseInt(m[1].replace('第 ', ''), 10) >= 5) && (parseInt(m[1].replace('第 ', ''), 10) <= 7),
        m ? m[1] : '没解析出行号');
    }
  }

  head('C · 结构不合法必须红');
  {
    /* C1：集合键写成原语 —— 旧实现 `typeof json[k]==='object'` 不成立 ⇒ 整个键被跳过，一声不吭 */
    const d1 = tmpDir('bad-shape');
    write(d1, '01_x.json', '{"rooms": 123}');
    const e1 = expectThrow('C1 集合键是数字 → 抛错', () => loadOnly(d1));
    ok('　C1 说清是「键 rooms」的问题', !!e1 && /rooms/.test(String(e1.message)));

    /* C2：数组条目缺 id —— 旧实现 `if (!item || !item.id) continue;` 直接丢 */
    const d2 = tmpDir('bad-noid');
    write(d2, '02_x.json', '{"rooms": [{"name":"有 id 吗"},{"id":"b","name":"B"}]}');
    const e2 = expectThrow('C2 数组条目缺 id → 抛错', () => loadOnly(d2));
    ok('　C2 点名「缺 id」', !!e2 && /缺 id/.test(String(e2.message)));

    /* C3：顶层不是对象 */
    const d3 = tmpDir('bad-top');
    write(d3, '03_x.json', '["a","b"]');
    expectThrow('C3 顶层是数组 → 抛错', () => loadOnly(d3));

    /* C4：干净的同形数据不该误伤 */
    const d4 = tmpDir('ok-shape');
    write(d4, '01_ok.json', '{"rooms": [{"id":"a","name":"A"}], "meta": {"startRoom":"a"}}');
    let e4 = null;
    try { loadOnly(d4); } catch (e) { e4 = e; }
    ok('★ C4 同形但合法的数据不误伤', !e4, e4 ? String(e4.message).slice(0, 200) : '');
  }

  /* ---------------------------------------------------------------- D */
  head('D · 分片叠加：深合并，后一片不许冲掉前一片的 name');
  {
    const d = tmpDir('shard');
    /* 前一片：给全字段（照抄 `73_sects_place.json` 里 taishan_hall 的形状） */
    write(d, '73_sects_place.json', JSON.stringify({
      rooms: {
        taishan_hall: {
          id: 'taishan_hall', name: '泰山派·演武场', region: 'changan',
          desc: '场子里三五个弟子正拆招。', exits: { d: 'taishan_gate' },
        },
      },
    }));
    /* 后一片：只补一个出口（照抄 `82_treasury_place.json` 的形状） */
    write(d, '82_treasury_place.json', JSON.stringify({
      rooms: { taishan_hall: { id: 'taishan_hall', exits: { e: 'taishan_library' } } },
    }));
    let w = null, err = null;
    try { w = loadOnly(d); } catch (e) { err = e; }
    ok('★ D0 两片都能加载', !err && !!w, err ? String(err.message).slice(0, 300) : '');
    if (w) {
      const r = w.data.rooms['taishan_hall'];
      ok('★ D1 name 还在（没被后一片冲掉）', r && r.name === '泰山派·演武场', r ? String(r.name) : '取不到');
      ok('★ D2 desc 还在', r && r.desc === '场子里三五个弟子正拆招。', r ? String(r.desc) : '');
      ok('★ D3 region 还在', r && r.region === 'changan', r ? String(r.region) : '');
      ok('★ D4 exits 是**合并**不是替换（d 和 e 都在）',
        r && r.exits && r.exits.d === 'taishan_gate' && r.exits.e === 'taishan_library',
        r && r.exits ? JSON.stringify(r.exits) : '');
    }

    /* ---- 反向对照：证明上面四条不是空断言 ----
       把同一对分片用「整条覆盖」（Object.assign 到容器上）合一遍：
       这正是「浅合并」的写法。它必须**丢掉 name**，否则说明
       D1 那条断言根本测不出问题（换了实现也不会红）。 */
    const base = { id: 'taishan_hall', name: '泰山派·演武场', region: 'changan', desc: '场子里三五个弟子正拆招。', exits: { d: 'taishan_gate' } };
    const over = { id: 'taishan_hall', exits: { e: 'taishan_library' } };
    const shallow = Object.assign({}, { taishan_hall: base }, { taishan_hall: over }).taishan_hall;
    ok('★ D5 反向对照：整条覆盖确实会丢 name（所以 D1 不是空断言）', shallow.name === undefined, JSON.stringify(shallow));
    ok('　D6 反向对照：深合并保住 name', dataload.deepMerge(base, over, { arrayMode: 'replace' }).name === '泰山派·演武场');
  }

  /* ---------------------------------------------------------------- E */
  head('E · 排序：按数值前缀（10_ 在 101_ 之前）');
  {
    ok('★ E1 compareDataFileName(10_a, 101_b) < 0（旧版字典序正相反）',
      dataload.compareDataFileName('10_skills.json', '101_classic_npcs.json') < 0);
    ok('　E2 compareDataFileName(2_a, 10_b) < 0', dataload.compareDataFileName('2_a.json', '10_b.json') < 0);
    ok('　E3 数字前缀相同则按剩余部分排（全序稳定）',
      dataload.compareDataFileName('73_a.json', '73_b.json') < 0 && dataload.compareDataFileName('73_b.json', '73_a.json') > 0);

    /* 端对端：2_ 与 10_ 都写同一个字段，编号大的后加载 ⇒ 它的值胜出 */
    const d = tmpDir('order');
    write(d, '2_early.json', JSON.stringify({ rooms: { r1: { id: 'r1', name: '编号2' } } }));
    write(d, '10_late.json', JSON.stringify({ rooms: { r1: { id: 'r1', name: '编号10' } } }));
    const w = loadOnly(d);
    ok('★ E4 编号大的后加载、后覆盖（10 赢过 2）',
      w.data.rooms.r1 && w.data.rooms.r1.name === '编号10', w.data.rooms.r1 ? String(w.data.rooms.r1.name) : '取不到');

    /* 真实目录的排序快照：数量够多 + 前几个是 00/10/20 这种小编号 */
    const realFiles = dataload.listDataFiles(DATA);
    ok('★ E5 真实数据目录能列出 ≥ 40 个文件', realFiles.length >= 40, realFiles.length + ' 个');
    ok('　E6 100 以上的编号排在 10 之后（不再插队）',
      realFiles.indexOf('101_classic_npcs.json') > realFiles.indexOf('10_skills.json'),
      realFiles.slice(0, 5).join(' , '));
  }

  /* ---------------------------------------------------------------- F */
  head('F · 集合键清单不许与 world.js 漂移');
  {
    const src = fs.readFileSync(WORLDJS, 'utf8');
    const m = /const collections = \[([^\]]*)\]/.exec(src);
    ok('★ F1 能从 world.js 源码里抠出 collections 数组', !!m);
    if (m) {
      const srcList = m[1].split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
      const mine = dataload.COLLECTIONS;
      const onlySrc = srcList.filter(x => mine.indexOf(x) < 0);
      const onlyMine = mine.filter(x => srcList.indexOf(x) < 0);
      ok('★ F2 两边一致（加了新集合键必须同步改 dataload.js）',
        onlySrc.length === 0 && onlyMine.length === 0,
        'world.js 独有：' + onlySrc.join(',') + '　dataload 独有：' + onlyMine.join(','));
    }
  }

  /* ---------------------------------------------------------------- H */
  head('H · 分级：game/data 硬失败，mods/ 报出来但不许拖垮 boot');
  {
    /* H1 主数据坏 ⇒ 必须抛，且抬头点名 game/data */
    const d = tmpDir('h1-base');
    write(d, '01_x.json', '{"rooms": {"a": {"id":"a", "name":"A"}},,}');
    const e1 = expectThrow('H1 主数据坏 JSON → 抛错', () => loadOnly(d));
    ok('　H1 抬头点名「主数据 / game/data」',
      !!e1 && /主数据/.test(String(e1.message)) && /game\/data/.test(String(e1.message)),
      e1 ? String(e1.message).split('\n')[0] : '');

    /* H2 Mod 坏 ⇒ **不许抛**，但要响亮地报出来（modLog 里有一条点名 mods/ 的 error）
       背景：mods/ 是玩家装的。不能因为某个玩家装了个坏 Mod，游戏就起不来。 */
    const modsDir = tmpDir('h2-mods');
    const md = path.join(modsDir, 'zbroken');
    fs.mkdirSync(md, { recursive: true });
    /* mod.json 本身是好的（坏在**另一个数据文件**上，才会走到 loadMods 的解析路径） */
    write(md, 'mod.json', '{"_mod":{"id":"zbroken","name":"坏Mod"},"items":{"ok_item":{"id":"ok_item","name":"好东西"}}}');
    write(md, 'extra.json', '{"rooms": {"m": {"id":"m", "name":"M"}},,}');

    const saveDir = tmpDir('h2-save');
    const prevSave = process.env.WX_SAVE_DIR;
    process.env.WX_SAVE_DIR = saveDir;
    let g = null, bootErr = null;
    try {
      g = new GameEngine({ seed: 20261012, modsDir });
      g.boot({});
    } catch (e) { bootErr = e; }
    process.env.WX_SAVE_DIR = prevSave;
    ok('★ H2 坏 Mod 不拖垮 boot（游戏照样起得来）', !bootErr,
      bootErr ? String(bootErr.message).slice(0, 300) : '');
    if (g) {
      const errs = (g.world.modLog || []).filter(m => m.level === 'error');
      const mine = errs.filter(m => /mods\//.test(String(m.msg)));
      ok('★ H3 坏 Mod 被**报出来**（modLog 里有一条点名 mods/ 的 error）',
        mine.length >= 1, errs.map(m => String(m.msg).slice(0, 80)).join(' | ') || '一条 error 都没有');
      ok('　H4 报错里带文件名 + 行号（不是一句「加载失败」糊过去）',
        mine.length >= 1 && /extra\.json/.test(String(mine[0].msg)) && /第 \d+ 行第 \d+ 列/.test(String(mine[0].msg)),
        mine.length ? String(mine[0].msg).split('\n').slice(0, 2).join(' / ') : '');
      ok('　H5 报出来归报出来，主数据没被连累（房间还在）',
        Object.keys(g.world.data.rooms || {}).length >= 400, Object.keys(g.world.data.rooms || {}).length + ' 间');
      ok('　H6 同一个 Mod 里**好的那份**照常生效（跳过坏文件，前面的不回滚）',
        !!(g.world.data.items || {}).ok_item, 'ok_item ' + ((g.world.data.items || {}).ok_item ? '在' : '没在'));
    }

    /* H8 **入口 mod.json 自己就是坏的** —— 第三种「不报错就是不生效」：
       这种 mod 被 `readModDir()` 标成 `{broken:true, enabled:false}`，
       **根本进不到 loadMods**，也不进 bootLog（modloader.js:124 / 250 / 273）。
       以前是全程沉默：玩家以为装上了，其实一条内容都没进世界。
       要求：报出来，但仍不许拖垮 boot。 */
    {
      const bm = tmpDir('h8-mods');
      const bd = path.join(bm, 'zbrokenmeta');
      fs.mkdirSync(bd, { recursive: true });
      write(bd, 'mod.json', '{"_mod":{"id":"zbrokenmeta","name":"坏元数据"},,}');

      const prev = process.env.WX_SAVE_DIR;
      process.env.WX_SAVE_DIR = tmpDir('h8-save');
      let g3 = null, e3 = null;
      try { g3 = new GameEngine({ seed: 1, modsDir: bm }); g3.boot({}); } catch (e) { e3 = e; }
      process.env.WX_SAVE_DIR = prev;
      ok('★ H8 入口 mod.json 坏了也不拖垮 boot', !e3, e3 ? String(e3.message).slice(0, 300) : '');
      if (g3) {
        const errs = (g3.world.modLog || []).filter(m => m.level === 'error');
        const mine = errs.filter(m => /zbrokenmeta/.test(String(m.msg)));
        ok('★ H9 坏 mod.json 被**报出来**（不再全程沉默）', mine.length >= 1,
          errs.map(m => String(m.msg).slice(0, 90)).join(' | ') || '一条 error 都没有');
        ok('　H10 报的是「元数据解析失败」，不是含糊的「加载失败」',
          mine.length >= 1 && /元数据解析失败/.test(String(mine[0].msg)),
          mine.length ? String(mine[0].msg).split('\n')[0] : '');
        ok('　H11 主数据没被连累（房间还在）',
          Object.keys(g3.world.data.rooms || {}).length >= 400,
          Object.keys(g3.world.data.rooms || {}).length + ' 间');
      }
    }

    /* H7 反向对照：干净的 Mod 不该产生 error（防「见 mods 就报」） */
    const okMods = tmpDir('h7-mods');
    const od = path.join(okMods, 'zgood');
    fs.mkdirSync(od, { recursive: true });
    write(od, 'mod.json', '{"_mod":{"id":"zgood","name":"好Mod"},"items":{"g_item":{"id":"g_item","name":"G"}}}');
    let g2 = null, e2 = null;
    const ps = process.env.WX_SAVE_DIR;
    process.env.WX_SAVE_DIR = tmpDir('h7-save');
    try { g2 = new GameEngine({ seed: 1, modsDir: okMods }); g2.boot({}); } catch (e) { e2 = e; }
    process.env.WX_SAVE_DIR = ps;
    ok('★ H7 干净 Mod 不产生 error（反向对照，防误报）',
      !e2 && g2 && (g2.world.modLog || []).filter(m => m.level === 'error').length === 0,
      g2 ? (g2.world.modLog || []).filter(m => m.level === 'error').map(m => String(m.msg).slice(0, 80)).join(' | ') : String(e2 && e2.message));
  }

  /* ---------------------------------------------------------------- G */
  head('G · 坏数据不许污染真数据目录（本轮只写临时目录）');
  {
    /* ⚠️ 判据跟着隔离目录一起改：现在是项目内 `.livetest/`，不再是 os.tmpdir()。
       不改这条的话，迁移过去之后它反而会红 —— 那就成了「守着旧写法」的假红。 */
    ok('★ G1 注入故障全在项目内隔离目录 .livetest/ 里（不写仓库真实目录、不碰系统临时目录）',
      TMP.indexOf(path.join(ROOT, '.livetest')) === 0, TMP);
    const stillOk = fs.existsSync(path.join(DATA, '73_sects_place.json'));
    ok('　G2 game/data/73_sects_place.json 还在', stillOk);

    /* ------------------------------------------------------------------
       G3~G7 · 备份文件不许住在 game/data/（2026-10-12 实案）
       5 个 `NN_xxx_bak_yyy.json` 备份带数字前缀，被 loadBaseData 当真数据
       加载：50_map_bak 排序在 50_map 之后（'_'>'.'），把 rooms.X.actions
       **整组替换**回旧快照；40_npcs 的 bak 走 byId 合并盖掉 B8 新值。
       全程不报错——比坏 JSON 更隐蔽。这里从文件名层面堵死。 */
    const BAD_NAME = /bak|backport|old/i;
    /** 列出 dir 里文件名含备份字样的数据文件（守卫的判据本体，供变异验证） */
    function badDataNames(dir) {
      return dataload.listDataFiles(dir).filter(f => BAD_NAME.test(f));
    }
    const realBad = badDataNames(DATA);
    ok('★ G3 真实数据目录无备份名文件（bak/backport/old 一个不许有）',
      realBad.length === 0, realBad.join(', ') || '干净');
    ok('　G4 真实数据目录能列出文件（判据不是在空目录上空转）',
      dataload.listDataFiles(DATA).length >= 40, dataload.listDataFiles(DATA).length + ' 个');

    /* 变异验证：往临时目录塞一个假 bak 名，判据必须红 —— 证明 G3 不是空断言 */
    const dMut = tmpDir('g-bak-mut');
    write(dMut, '40_npcs_bak_pre_xxx.json', '{"npcs":{}}');
    write(dMut, '01_ok.json', '{"rooms":{"a":{"id":"a","name":"A"}}}');
    const mutBad = badDataNames(dMut);
    ok('★ G5 变异：塞进假 bak 名 → 判据当场抓到', mutBad.length === 1 && mutBad[0] === '40_npcs_bak_pre_xxx.json',
      JSON.stringify(mutBad));
    /* 误报对照：backport / old 大小写变体也必须抓 */
    write(dMut, '02_thing_OLD.json', '{"npcs":{}}');
    const mutBad2 = badDataNames(dMut);
    ok('　G6 大小写变体（OLD）也抓到', mutBad2.length === 2, JSON.stringify(mutBad2));

    /* 干净反向对照：正常命名不误伤 */
    const dClean = tmpDir('g-bak-clean');
    write(dClean, '01_ok.json', '{"rooms":{"a":{"id":"a","name":"A"}}}');
    ok('★ G7 干净目录零误报', badDataNames(dClean).length === 0,
      JSON.stringify(badDataNames(dClean)));
  }

  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) { /* 清不掉不碍事 */ }

  console.log('');
  console.log('── data-load-check：通过 ' + pass + ' / 失败 ' + fail + ' ──');
  if (fail) process.exitCode = 1;
})();
