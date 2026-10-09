'use strict';
/* ==========================================================================
 *  gen-district.js —— 区域归位 + 拆填充物（步骤 2/2b/2c 合一）
 *
 * 背景：动手前实测发现三层病，比原规格写的还严重：
 *   ① hm_* 住宅的 region 全是乱的 —— 岳不群的家 region=jiangnan（他在华山），
 *      方证大师的家 region=xiangyang（他在少林）。gen-homes.js 造的。
 *   ② fang_* 巷陌把不同体系的人家串在一起，四个掌门挤在一家客栈的巷子里。
 *   ③ 313 条支线 desc 模板化，「有没有支线」已无法区分 NPC 主次。
 *
 * 顺序（不能乱）：
 *   step1  删 fang_*（巷陌）—— 纯连线用的，没有内容
 *   step2  hm_* 按 A 层判定分流：A 层留下并迁到正确的 region；C 层删掉改虚拟住宅
 *   step3  清理所有指向被删房间的出口（双向）
 *   step4  NPC 的 room / home / schedule 全部对齐到新 region
 *   step5  meta.homeRooms 同步
 *
 * A 层判定：有画像/ rank>=3 / 有门派且 rank>=2 —— 这些人家的门牌得挂对地方。
 * ========================================================================== */
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');
const NPC = path.join(__dirname, '..', 'game', 'data', '40_npcs.json');
const BACK = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw', u: 'd', d: 'u' };

const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const npcs = JSON.parse(fs.readFileSync(NPC, 'utf8')).npcs;
const rooms = map.rooms;

/* 门派 → 该派驻地房间（住宅必须挂在本派区域，不能挂进城门） */
const SECT_ANCHOR = {
  huashan:   'huashan_zhengqi',
  shaolin:   'shaolin_daxiong',
  wudang:    'wudang_zixiao',
  emei:      'emei_jinding',
  taohua:    'taohuadao_qingyin',
  taohuadao: 'taohuadao_qingyin',
  dali:      'dali_wangfu',
  miaojiang: 'miaojiang_sheng',
  tangmen:   'tangmen_gate',
  gaibang:   'gaibang_po_miao',
  mojiao:    'mojiao_shanmen',
  xingxiu:   'xiyu_xingxiu',
  xuedao:    'beijiang_xuedao',
};

/* 区域内的显要建筑（无门派时按本区挑） */
const ANCHORS = {
  huashan:   ['huashan_zhengqi', 'huashan_yunu', 'huashan_siguoya', 'huashan_lianhua', 'huashan_shanxia'],
  shaolin:   ['shaolin_cangjing', 'shaolin_daxiong', 'shaolin_lianwu', 'shaolin_shanmen'],
  wudang:    ['wudang_zixiao', 'wudang_jinding', 'wudang_taihe', 'wudang_shanmen'],
  emei:      ['emei_yard', 'emei_jinding', 'emei_qingyin', 'emei_shanmen'],
  taohuadao: ['taohuadao_qingyin', 'taohuadao_she', 'taohuadao_dock'],
  dali:      ['dali_wangfu', 'dali_tianlong'],
  miaojiang: ['miaojiang_sheng', 'miaojiang_gu'],
  mojiao:    ['mojiao_shanmen', 'mojiao_hall'],
  gumu:      ['gumu_mu'],
  beijiang:  ['beijiang_xuedao'],
  xixia:     ['xixia_ice'],
  xiyu:      ['xiyu_oasis', 'xiyu_xingxiu'],
  gusu:      ['gusu_town', 'gusu_yanzi', 'gusu_canhe', 'gusu_shi'],
  jiangnan:  ['jiangnan_street', 'jiangnan_inn', 'jiangnan_qiao', 'jiangnan_gate'],
  market:    ['jn_market_main', 'jn_market_north'],
  cunzhen:   ['cunzhen_street', 'cunzhen_gate'],
  shuyuan:   ['jn_school_yard', 'jn_study_1'],
  yamen:     ['jn_yamen_court', 'jn_yamen_arch'],
  palace:    ['palace_road', 'palace_gate'],
  harbor:    ['jn_harbor', 'jn_harbor_wharf'],
  farmland:  ['jn_farm_road'],
  wild:      ['road_nan_1'],
  haitan:    ['haitan_dock'],
  xiake:     ['xiake_neike'],
  jinguo:    ['jinguo_ruin_d'],
  many:      ['road_many_1'],
  secret:    ['secret_black_market'],
  qinglou:   ['jiangnan_brothel'],
  tangmen2:  ['tangmen_gate'],
};

const isTierA = n => !!(n && (n.portrait ||
  (typeof n.rank === 'number' && n.rank >= 3) ||
  (n.sect && typeof n.rank === 'number' && n.rank >= 2)));

const isHome = rid => /^hm_/.test(rid);
const log = [];
const drop = new Set();

/* ───────────────────── step1: 删 fang_* ───────────────────── */
let fangN = 0;
for (const id in rooms) if (/^fang_/.test(id)) { drop.add(id); fangN++; }

/* ───────────────── step2: hm_* 分流 ───────────────── */
const keepHomes = [];    /* A 层，要迁region */
const virtualized = [];  /* C 层，改虚拟住宅 */
let hmN = 0;
for (const id in rooms) {
  if (!/^hm_/.test(id)) continue;
  hmN++;
  const owner = rooms[id].owner;
  const def = npcs[owner];
  if (isTierA(def)) keepHomes.push(id);
  else { drop.add(id); if (owner && npcs[owner]) virtualized.push(owner); }
}

/* ───────────────── step3: 删房间 + 清出口 ───────────────── */
for (const id of drop) delete rooms[id];
let cleaned = 0;
for (const id in rooms) {
  const ex = rooms[id].exits;
  if (!ex) continue;
  for (const d of Object.keys(ex)) {
    const to = typeof ex[d] === 'string' ? ex[d] : (ex[d] && ex[d].to);
    if (to && drop.has(to)) { delete ex[d]; cleaned++; }
  }
}

/* ───────────────── step4: A 层住宅迁到正确的 region ───────────────── */
const homeFix = [];
for (const hid of keepHomes) {
  const r = rooms[hid];
  const owner = r.owner;
  const def = npcs[owner] || {};

  /* 目标区域：门派 → 该派驻地所在区；否则 → owner 常驻处所在区 */
  let targetRegion = null;
  const sectAnchor = SECT_ANCHOR[def.sect];
  if (sectAnchor && rooms[sectAnchor]) targetRegion = rooms[sectAnchor].region;
  if (!targetRegion && def.room && rooms[def.room]) targetRegion = rooms[def.room].region;
  if (!targetRegion) targetRegion = r.region;

  /* 落脚点：优先本派驻地 / 本区显要建筑，且**同区域 + 非住宅** */
  const cands = [];
  if (sectAnchor && rooms[sectAnchor] && sectAnchor !== hid) cands.push(sectAnchor);
  for (const a of (ANCHORS[targetRegion] || [])) cands.push(a);
  if (def.room && rooms[def.room] && def.room !== hid) cands.push(def.room);
  for (const rid in rooms) {
    if (rid === hid || isHome(rid)) continue;
    if (rooms[rid].region === targetRegion) cands.push(rid);
  }

  let anchor = null, dir = null;
  for (const a of cands) {
    if (!rooms[a] || a === hid || isHome(a)) continue;         /* 规则②：非住宅 */
    if (rooms[a].region !== targetRegion) continue;              /* 规则①：同区域 */
    const d = ['s', 'n', 'e', 'w'].find(dd =>
      !rooms[hid].exits[dd] && !rooms[a].exits[BACK[dd]]);
    if (!d) continue;
    anchor = a; dir = d; break;
  }
  if (!anchor) { homeFix.push('❌ ' + hid + '(' + (def.name || owner) + ') 找不到同区落脚点'); continue; }

  r.region = targetRegion;                                        /* ← 这就是修根 */
  r.exits = r.exits || {};
  r.exits[dir] = anchor;
  rooms[anchor].exits = rooms[anchor].exits || {};
  rooms[anchor].exits[BACK[dir]] = hid;
  r.homeTier = r.homeTier || 'B';
  r.homeCapacity = r.homeCapacity || 1;
  if (!def.tier) def.tier = 'A';
  homeFix.push('✅ ' + String(def.name || owner).padEnd(6) + hid.padEnd(22) + '→ ' + rooms[anchor].name + ' [' + targetRegion + ']');
}

/* ───────────────── step5: C 层虚拟住宅 + NPC 对齐 ───────────────── */
const virt = [];
for (const nid of virtualized) {
  const def = npcs[nid];
  if (!def) continue;
  const oldHome = def.home;
  const oldHomeIsDropped = oldHome && drop.has(oldHome);
  def.house = 'house:' + nid;
  if (!def.tier) def.tier = 'C';
  if (!def.district) def.district = (def.room && rooms[def.room]) ? rooms[def.room].region : 'jiangnan';
  if (!def.unlock) def.unlock = { favor: 30 };
  if (oldHomeIsDropped) def.homeless = true;
  /* 家没了 → 夜归回岗位 */
  if (def.schedule && def.schedule.night && drop.has(def.schedule.night)) {
    def.schedule.night = def.schedule.day || null;
  }
  if (oldHome && !drop.has(oldHome)) {
    log.push('⚠️ ' + nid + ' 原家 ' + oldHome + ' 未被删但仍转虚拟，需人工确认');
  }
  virt.push(nid);
}

/* 残留检查：还有 NPC 指向不存在的 home */
const badHome = [];
for (const nid in npcs) {
  const h = npcs[nid].home;
  if (h && !rooms[h] && h !== 'house:' + nid) badHome.push(nid + ' → ' + h);
}

/* ───────────────── step6: meta.homeRooms ───────────────── */
map.meta = map.meta || {};
if (Array.isArray(map.meta.homeRooms)) {
  map.meta.homeRooms = map.meta.homeRooms.filter(r => rooms[r]);
}

/* 孤立房间 */
const orphans = [];
for (const id in rooms) if (!Object.keys(rooms[id].exits || {}).length) orphans.push(id);

/* ───────────────── 落盘 ───────────────── */
fs.writeFileSync(MAP, JSON.stringify(map, null, 1), 'utf8');
fs.writeFileSync(NPC, JSON.stringify({ npcs }, null, 1), 'utf8');

const roomN = Object.keys(rooms).length;
console.log('【step1】删 fang_* %d 间', fangN);
console.log('【step2】hm_* %d 间 → 保留 A 层 %d / 转虚拟 %d', hmN, keepHomes.length, virtualized.length);
console.log('【step3】清残留出口 %d 条', cleaned);
console.log('【step4】A 层住宅归位 %d 间：', homeFix.length);
homeFix.forEach(l => console.log('    ' + l));
console.log('【step5】虚拟住宅 %d 人（C 层）', virt.length);
console.log('【step6】房间总数 %d → %d', 620, roomN);
log.forEach(l => console.log('    ' + l));
console.log('');
console.log(badHome.length ? '❌ NPC home 悬空: ' + badHome.join(', ') : '✅ 无 NPC home 悬空');
console.log(orphans.length ? '❌ 孤立房间 ' + orphans.length + ': ' + orphans.join(' ') : '✅ 无孤立房间');

/* 硬规则自检 */
let interlinked = 0, crossRegion = 0;
for (const id in rooms) {
  if (!isHome(id)) continue;
  for (const d of Object.keys(rooms[id].exits || {})) {
    const to = rooms[id].exits[d];
    if (isHome(to)) interlinked++;
    else if (rooms[to] && rooms[to].region !== rooms[id].region) crossRegion++;
  }
}
console.log(interlinked ? '❌ 住宅互连 ' + interlinked + ' 处' : '✅ 无住宅互连（房屋不连片）');
console.log(crossRegion ? '❌ 住宅跨区 ' + crossRegion + ' 处' : '✅ 住宅均在本区');
