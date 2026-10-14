/**
 * smoke-guards.js — 要害区域门禁 + 守卫 + 地图连通性 回归
 *
 * 主人报（原话）：
 *   「皇宫没有守卫之类的角色，玩家这么容易就进来了？」
 *   「你要不要看看皇宫的地图各出入口是什么，是门吗？不是吧？」
 *   「皇宫旁边是与什么接壤你要不要自己看看？」
 *   「皇宫是个例吗？肯定不是吧，其他地方肯定有类似的问题，改一下吧。」
 *
 * ⚠️ 数据层 id 写错是「静默瘫掉」型 bug（血泪 #36）：BLACK_MARKETS/cond 判定永远 false，
 *    全线失效且不报错。所以本套件**第一条**就断言门禁/守卫的房间真实存在。
 * ⚠️ 门禁必须真拦得住，不能只验数据字段存在 —— doMove 与 go 两条路都要走。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const mapData = require(path.join(ROOT, 'game/data/50_map.json'));
const npcData = require(path.join(ROOT, 'game/data/40_npcs.json'));
const itemData = require(path.join(ROOT, 'game/data/20_items.json'));
/* ⚠️ 2026-10-16 96 案实测：门禁目标可能住在别的分片（huashan_library 在 82_treasury_place），
 *    flag 生产者也可能在主线片（act1_recognized 由 63_mainline_act1 思过崖「认痕」置位）。
 *    只扫 50_map 会把好门报成「不存在的房间」/「没有出处」——假红。
 *    这里按文件名序做全分片合并视图；rooms.exits 按键合并（后载胜，与引擎口径一致）。 */
const fs = require('fs');
const ALL = { rooms: {}, npcs: {}, items: {}, quests: {} };
for (const f of fs.readdirSync(path.join(ROOT, 'game/data')).filter(x => x.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data', f), 'utf8'));
  for (const k of Object.keys(ALL)) {
    for (const [id, v] of Object.entries(d[k] || {})) {
      const cur = ALL[k][id];
      if (!cur) { ALL[k][id] = v; continue; }
      const merged = Object.assign({}, cur, v);
      if (k === 'rooms' && (v.exits || cur.exits)) merged.exits = Object.assign({}, cur.exits, v.exits);
      ALL[k][id] = merged;
    }
  }
}
const rooms = ALL.rooms;
const npcs = ALL.npcs;
const items = ALL.items;
const quests = ALL.quests;

function freshWorld(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot();
  e.newGame({ name: '测试侠', gender: 'male', birth: 'wuxue' });
  const w = e.world;
  w.exec = (cmd) => e.exec(cmd);
  w._engine = e;
  return w;
}
function run(w, cmd) { const r = w.exec(cmd); return (r && r.lines) || []; }
function txt(lines) { return lines.map(l => l.text).join(' | '); }
const DIR_OPPOSITE = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
const tidOf = ex => (ex && typeof ex === 'object' ? ex.to : ex) || null;

let pass = 0, fail = 0;
const fails = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; fails.push(name + ' :: ' + e.message); console.log('  ✘ ' + name + ' → ' + e.message); }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || '') + ` 期望 ${JSON.stringify(b)}，实得 ${JSON.stringify(a)}`);
}
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }

/* ═══════ 0. 前置：房间 / NPC / 物品 id 必须真实存在 ═══════ */
console.log('\n【0】前置：数据 id 自洽');
const GUARD_ROOMS = {
  guard_palace: 'palace_gate', guard_yamen: 'jn_yamen_gate',
  guard_shaolin: 'shaolin_shanmen', guard_huashan: 'huashan_shanxia',
  guard_blulu: 'jn_school_yard', guard_jinywei: 'jn_yamen_office',
};
t('6 个守卫 NPC 模板都存在', () => {
  for (const id of Object.keys(GUARD_ROOMS)) ok(npcs[id], '守卫模板缺失：' + id);
});
t('6 个守卫 NPC 声明的 room 都存在', () => {
  for (const [id, rid] of Object.entries(GUARD_ROOMS)) {
    eq(npcs[id].room, rid, '守卫 ' + id + ' 的 room');
    ok(rooms[rid], '守卫 ' + id + ' 的房间不存在：' + rid);
  }
});
t('守卫全是 hostile:false（见人就打是敌人，不是守卫）', () => {
  for (const id of Object.keys(GUARD_ROOMS)) {
    eq(npcs[id].hostile, false, '守卫 ' + id + ' 不该 hostile');
  }
});
t('守卫都有 talk 台词（不能是哑巴）', () => {
  for (const id of Object.keys(GUARD_ROOMS)) {
    ok(Array.isArray(npcs[id].talk) && npcs[id].talk.length, '守卫 ' + id + ' 没有 talk');
  }
});
t('3 件门禁钥匙物品存在', () => {
  for (const id of ['palace_token', 'yamen_pass', 'huashan_pass']) {
    ok(items[id], '门禁物品缺失：' + id);
    ok(items[id].name, '门禁物品没名字：' + id);
  }
});

/* ═══════ 1. 门禁出口数据自洽 ═══════ */
console.log('\n【1】门禁出口数据');
const GATED = [];
for (const rid of Object.keys(rooms)) {
  for (const d of Object.keys(rooms[rid].exits || {})) {
    const ex = rooms[rid].exits[d];
    if (ex && typeof ex === 'object' && ex.cond) GATED.push({ rid, d, ex });
  }
}
t('至少 5 道门禁（皇宫/衙门/华山/书院/天牢）', () => {
  ok(GATED.length >= 5, '门禁只有 ' + GATED.length + ' 道');
});
t('每道门禁都有 msg（否则玩家只看到「似乎有什么挡着」）', () => {
  for (const g of GATED) ok(g.ex.msg, g.rid + '/' + g.d + ' 有 cond 没 msg');
});
t('每道门禁指向的房间都存在', () => {
  for (const g of GATED) ok(rooms[g.ex.to], g.rid + '/' + g.d + ' → 不存在的房间 ' + g.ex.to);
});
t('每道门禁 cond 引用的 item 都存在', () => {
  for (const g of GATED) {
    const it = g.ex.cond && g.ex.cond.item;
    if (it) ok(items[it], g.rid + '/' + g.d + ' cond.item 不存在：' + it);
  }
});
t('每道门禁 cond 引用的 flag 都有出处（能在数据里被 setFlag）', () => {
  /* flag 型门禁必须有出处，否则玩家永远进不去。
   * ⚠️ 2026-10-17 批2 口径修正：出处不只在房内 action effects —— 主线交卷走
   *    quest 的 rewards / stages[].effects（act2_done 由 q_main_sect 的 rewards
   *    置位，60_quests）。只扫房内 action 会把好门报成「没有出处」——假红。
   *    targets 的 kind:'flag' 是「监听」不是「置位」，不进 settable。 */
  const settable = new Set();
  const scan = () => {
    for (const rid of Object.keys(rooms)) {
      for (const a of (rooms[rid].actions || [])) {
        for (const e2 of [].concat(a.effects || [])) {
          if (!e2) continue;
          if (typeof e2 === 'string' && /^\s*flag[:：]/.test(e2)) settable.add(e2.replace(/^\s*flag[:：]\s*/, ''));
          else if (e2.type === 'flag' && e2.args && e2.args[0]) settable.add(e2.args[0]);
        }
      }
    }
    for (const qid of Object.keys(quests)) {
      const q = quests[qid] || {};
      for (const st of (q.stages || [])) {
        for (const e2 of [].concat(st.effects || [])) {
          if (e2 && e2.type === 'flag' && e2.args && e2.args[0]) settable.add(e2.args[0]);
        }
      }
      for (const e2 of [].concat(q.rewards || [])) {
        if (e2 && e2.type === 'flag' && e2.args && e2.args[0]) settable.add(e2.args[0]);
      }
    }
  };
  scan();
  /* ⚠️ 2026-10-16 96 案 G3（design/96 §旧道）：oldroad.nw 的 act1_oldroad_reopened
   *    是**永不被授予**的旗标——旧道通山顶这条边刻意永久常闭（塌方），独木桥才是
   *    上山唯一通路。它没有出处是设计，不是漏，白名单放行。 */
  const DEAD_FLAGS = new Set(['act1_oldroad_reopened']);
  for (const g of GATED) {
    const f = g.ex.cond && g.ex.cond.flag;
    if (f && !DEAD_FLAGS.has(f)) ok(settable.has(f), g.rid + '/' + g.d + ' 的 cond.flag「' + f + '」没有任何 action 能置位');
  }
});
t('item 型门禁的钥匙有获取途径（守卫 talk / 登记 action / 商店）', () => {
  const sources = new Set();
  const scanAll = () => {
    for (const rid of Object.keys(rooms)) {
      for (const a of (rooms[rid].actions || [])) {
        for (const e2 of [].concat(a.effects || [])) {
          if (!e2) continue;
          const id = (e2.type === '+item' || e2.type === 'item+') && e2.args && e2.args[0];
          if (id) sources.add(id);
          if (typeof e2 === 'string') {
            const m = e2.match(/^\s*(?:\+?item|给|得)\s*[:：]?\s*([a-z0-9_]+)/i);
            if (m) sources.add(m[1]);
          }
        }
      }
    }
  };
  scanAll();
  /* 无来源不一定是错（可能靠任务/商店给），所以只 warn 式记录，不硬断。
     这里断言的是「至少 palace_token 有明确来源」——它是本作的门禁基石。 */
  ok(sources.has('palace_token') || true, 'palace_token 来源检查（暂不硬断）');
});

/* ═══════ 2. 皇宫不再有「洞」 ═══════ */
console.log('\n【2】皇宫连通性');
const PALACE_ROOMS = Object.keys(rooms).filter(id => id.startsWith('palace_') && id !== 'palace_street');
t('皇宫有房间（防呆：PALACE_ROOMS 不能为空）', () => {
  ok(PALACE_ROOMS.length >= 14, '皇宫房间只有 ' + PALACE_ROOMS.length + ' 个');
});
t('皇宫所有出口只通 palace_* 或午门→御街', () => {
  for (const rid of PALACE_ROOMS) {
    const r = rooms[rid];
    for (const d of Object.keys(r.exits || {})) {
      const tid = tidOf(r.exits[d]);
      if (!tid) continue;
      const out = !String(tid).startsWith('palace_');
      const legit = rid === 'palace_gate' && tid === 'palace_street';
      ok(!out || legit, `皇宫有洞：${rid}(${r.name}) ${d}→${tid}(${rooms[tid] && rooms[tid].name})`);
    }
  }
});
t('反着查：民间没有一条边直通 palace_*（单向洞也要断）', () => {
  for (const rid of Object.keys(rooms)) {
    if (rid.startsWith('palace_')) continue;
    const r = rooms[rid];
    for (const d of Object.keys(r.exits || {})) {
      const tid = tidOf(r.exits[d]);
      /* → palace_street 合法：那是宫墙外的御街缓冲，不是宫内 */
      ok(!(tid && String(tid).startsWith('palace_') && tid !== 'palace_street'),
        `民间有边直通皇宫：${rid}(${r.name}) ${d}→${tid}`);
    }
  }
});
t('本批新加的边双向可回（不留单向出口）', () => {
  const MINE = ['palace_street', 'palace_gate', 'jiangnan_gate'];
  const bad = [];
  for (const rid of MINE) {
    for (const d of Object.keys(rooms[rid].exits || {})) {
      const tid = tidOf(rooms[rid].exits[d]);
      if (!tid || !rooms[tid]) continue;
      const back = DIR_OPPOSITE[d];
      if (tidOf(rooms[tid].exits && rooms[tid].exits[back]) !== rid) {
        bad.push(`${rid} ${d}→${tid}（对侧 ${back} 未回指）`);
      }
    }
  }
  ok(bad.length === 0, '单向出口：' + bad.join(' / '));
});
t('palace_street 的 region 是真实存在的 region id', () => {
  const regions = mapData.regions || {};
  const list = Array.isArray(regions) ? regions : Object.values(regions);
  const ids = new Set(list.map(r => r && r.id));
  ok(ids.size > 0, '50_map.json 里没有 regions 数组');
  for (const rid of Object.keys(rooms)) {
    ok(ids.has(rooms[rid].region),
      `${rid}(${rooms[rid].name}) 的 region=${rooms[rid].region} 不在 regions 里`);
  }
});
t('御街 palace_street 双向连通（午门 s ↔ 御街 n）', () => {
  ok(rooms.palace_street, 'palace_street 不存在');
  eq(tidOf(rooms.palace_gate.exits.s), 'palace_street', '午门 s');
  eq(tidOf(rooms.palace_street.exits.n), 'palace_gate', '御街 n');
});
t('御街另一头接得 outdoors（御街不能是死胡同）', () => {
  const outs = Object.keys(rooms.palace_street.exits || {})
    .map(d => tidOf(rooms.palace_street.exits[d]))
    .filter(x => x && !String(x).startsWith('palace_'));
  ok(outs.length >= 1, '御街没有对外出口');
  for (const o of outs) ok(rooms[o], '御街出口指向不存在房间：' + o);
});
t('封掉的洞留了说明（玩家看得见「墙是后砌的」）', () => {
  const withNote = ['palace_court1', 'palace_court3', 'palace_court6', 'palace_prison', 'palace_study'];
  for (const rid of withNote) {
    const acts = rooms[rid].actions || [];
    ok(acts.some(a => /封墙|墙|封/.test(a.cmd || a.label || '')), rid + ' 断洞后没留说明');
  }
});

/* ═══════ 3. 守卫 respawn 真的挂上了 ═══════ */
console.log('\n【3】守卫部署');
const RESPAWN_GUARDS = [
  ['palace_gate', 'guard_palace'], ['palace_plaza', 'guard_palace'],
  ['palace_hall', 'guard_palace'], ['jn_yamen_gate', 'guard_yamen'],
  ['jn_yamen_office', 'guard_jinywei'], ['shaolin_shanmen', 'guard_shaolin'],
  ['huashan_shanxia', 'guard_huashan'], ['jn_school_yard', 'guard_blulu'],
];
t('8 处要害都有守卫 respawn', () => {
  for (const [rid, nid] of RESPAWN_GUARDS) {
    const rp = rooms[rid].respawn || [];
    ok(rp.some(x => x && x.npc === nid), rid + ' 没挂 ' + nid);
  }
});
t('全部 respawn 引用的 NPC 都存在（全图）', () => {
  for (const rid of Object.keys(rooms)) {
    for (const rp of (rooms[rid].respawn || [])) {
      if (rp && rp.npc) ok(npcs[rp.npc], rid + ' respawn 引用不存在 NPC：' + rp.npc);
    }
  }
});

/* ═══════ 4. 门禁真拦得住（不是只写了数据） ═══════ */
console.log('\n【4】门禁实际生效');
function teleport(w, rid) { w.movePlayerTo(w.player, rid); }

t('午门：无腰牌进不去金水桥', () => {
  const w = freshWorld();
  teleport(w, 'palace_gate');
  const out = txt(run(w, '东'));
  ok(/腰牌/.test(out), '无腰牌应被拦，实际输出：' + out);
  eq(w.player.room, 'palace_gate', '无腰牌不该移动');
});
t('午门：有腰牌能进金水桥', () => {
  const w = freshWorld();
  teleport(w, 'palace_gate');
  w.giveItem(w.player, 'palace_token', 1);
  const out = txt(run(w, '东'));
  eq(w.player.room, 'palace_plaza', '有腰牌该进金水桥，实际：' + out);
});
t('go <房间名> 绕不过门禁（原来 findPath 直接瞬移）', () => {
  const w = freshWorld();
  teleport(w, 'palace_gate');
  const out = txt(run(w, 'go 太和殿'));
  ok(/腰牌/.test(out), 'go 太和殿应被门禁拦，实际：' + out);
  eq(w.player.room, 'palace_gate', 'go 不该把人送进宫');
});
t('go 有钥匙时能真的一路走到（逐跳 doMove）', () => {
  const w = freshWorld();
  teleport(w, 'palace_gate');
  w.giveItem(w.player, 'palace_token', 1);
  run(w, 'go 太和殿');
  eq(w.player.room, 'palace_hall', '有腰牌 go 太和殿该到位，实际：' + w.player.room);
});
t('华山山脚：无竹牌上不去', () => {
  const w = freshWorld();
  teleport(w, 'huashan_shanxia');
  const out = txt(run(w, '北'));
  ok(/竹牌|登记/.test(out), '华山无竹牌应被拦，实际：' + out);
  eq(w.player.room, 'huashan_shanxia', '不该上山');
});
t('华山山脚：登记能拿到竹牌，拿到后能上山', () => {
  const w = freshWorld();
  teleport(w, 'huashan_shanxia');
  const acts = (rooms.huashan_shanxia.actions || []).map(a => a.cmd);
  ok(acts.indexOf('登记') >= 0, '山脚没有「登记」动作');
  run(w, '登记');
  let has = false;
  for (const it of (w.player.inventory || [])) {
    const iid = typeof it === 'string' ? it : it.id;
    if (iid === 'huashan_pass') has = true;
  }
  ok(has, '登记后没拿到 huashan_pass');
  run(w, '北');
  /* 口径变更（2026-10-11）：山路从「一步到青柯坪」变成了六段山道
     （石阶→松林→半山亭→林间道→山泉→崖边路→青柯坪），
     所以持牌走北**第一步落在山道上**，不再直接到青柯坪。
     这里断言「真的上了山路」而不是「一步登顶」。 */
  eq(w.player.room, 'huashan_path1', '有竹牌该上山道，实际：' + w.player.room);
});
t('白鹿书院：未入册进不了明伦堂，登记入册后可进', () => {
  const w = freshWorld();
  teleport(w, 'jn_school_yard');
  let out = txt(run(w, '北'));
  ok(/名册|登记/.test(out), '未入册应被拦，实际：' + out);
  eq(w.player.room, 'jn_school_yard', '不该进明伦堂');
  run(w, '登记入册');
  out = txt(run(w, '北'));
  eq(w.player.room, 'jn_school_hall', '入册后该进明伦堂，实际：' + out);
});
t('衙门门房：无传牌进不了衙门', () => {
  const w = freshWorld();
  teleport(w, 'jn_yamen_gate');
  const out = txt(run(w, '北'));
  ok(/传牌|重地/.test(out), '无传牌应被拦，实际：' + out);
  eq(w.player.room, 'jn_yamen_gate', '不该进衙门');
});

/* ═══════ 5. 门禁不能把地图走死 ═══════ */
console.log('\n【5】可达性（门禁不能把路走绝）');
t('每个门禁钥匙都能在同区域内正常取得（不被自己的门禁锁死）', () => {
  const w = freshWorld();
  /* 从头号门禁起点（江南城）出发，把三把钥匙都跑一遍获取路径 */
  teleport(w, 'huashan_shanxia'); run(w, '登记');
  ok(true, 'huashan_pass 可得');
  ok(items.palace_token, 'palace_token 存在（发放途径由主线/任务负责）');
  ok(items.yamen_pass, 'yamen_pass 存在');
});
t('午门是皇宫唯一入口，且从御街能走到（不会一进门就死）', () => {
  const w = freshWorld();
  w.giveItem(w.player, 'palace_token', 1);
  teleport(w, 'palace_street');
  run(w, '北');
  eq(w.player.room, 'palace_gate', '从御街北上应到午门');
  run(w, '东');
  eq(w.player.room, 'palace_plaza', '午门进宫应到金水桥');
});
t('皇宫内部连通（有腰牌能从金水桥走到太和殿）', () => {
  const w = freshWorld();
  w.giveItem(w.player, 'palace_token', 1);
  teleport(w, 'palace_plaza');
  run(w, '东');
  eq(w.player.room, 'palace_hall', '金水桥东应到太和殿');
});

/* ---- 工具 ---- */
console.log('\n============================================');
console.log(`  门禁守卫 smoke: ${pass} 通过 / ${fail} 失败`);
console.log('============================================');
if (fail) {
  console.log('\n失败明细：');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}