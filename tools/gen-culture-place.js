/* ============================================================
 * gen-culture-place.js — 文化项目的场所（game/data/80_culture_place.json）
 *
 * 新增 4 间：文墨斋（书院）/ 贡院门厅 + 考棚（衙门）/ 洛阳擂台
 * 另给已有的戏台、听雨轩补「听曲 / 诗会」的入口。
 *
 * ⚠️ `room.actions` 是**数组、replace 语义** —— 重写戏台时必须把原有的
 *    `listen 戏` 那一条原样抄回来，否则老玩法会被整段顶掉。
 * ⚠️ 只写 80 一个文件。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '80_culture_place.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

try { fs.unlinkSync(OUT); } catch (e) { /* 首次 */ }
const e0 = new GameEngine({ seed: 20261011 });
e0.boot();
const w0 = e0.world;
const ROOMS = w0.data.rooms;

const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };
const DIRS = ['e', 'w', 's', 'n', 'ne', 'nw', 'se', 'sw'];
const usedDirs = {};

/** 在某个 region 里找一间还能挂的公共房间，挂出去一个方向 */
function attach(region, gateId) {
  const pool = Object.values(ROOMS)
    .filter(r => r.region === region && !r._privateHost && /^基础数据:50_map\.json$/.test(r.__source || ''))
    .sort((a, b) => (/街|道|广场|堂|楼|门/.test(b.name || '') ? 1 : 0) - (/街|道|广场|堂|楼|门/.test(a.name || '') ? 1 : 0));
  for (const r of pool) {
    const taken = Object.keys(r.exits || {}).concat([...(usedDirs[r.id] || [])]);
    const d = DIRS.find(x => taken.indexOf(x) < 0);
    if (d) {
      (usedDirs[r.id] = usedDirs[r.id] || new Set()).add(d);
      return { host: r.id, dir: d };
    }
  }
  return null;
}

const rooms = {};
const patch = {};

/* ---- 文墨斋（书院 region）---- */
const a1 = attach('shuyuan', 'jn_wenmo_zhai');
if (!a1) { console.error('✘ 书院找不到可挂的房间'); process.exit(1); }
rooms['jn_wenmo_zhai'] = {
  id: 'jn_wenmo_zhai', name: '文墨斋', region: 'shuyuan',
  desc: '一间敞厅，摆着七张案。案上墨迹新旧不一，墙上挂着几张画，最旧的那张已经泛黄。窗下有人在对句，声音压得很低。',
  exits: { [OPP[a1.dir]]: a1.host },
  actions: [
    { label: '看墙上的画', cmd: 'look 画', keywords: ['画', '看画'], desc: '看墙上挂的那几张' },
  ],
};
patch[a1.host] = patch[a1.host] || { id: a1.host, exits: {} };
patch[a1.host].exits[a1.dir] = 'jn_wenmo_zhai';

/* ---- 贡院（衙门 region）---- */
const a2 = attach('yamen', 'jn_gongyuan_gate');
if (!a2) { console.error('✘ 衙门找不到可挂的房间'); process.exit(1); }
rooms['jn_gongyuan_gate'] = {
  id: 'jn_gongyuan_gate', name: '贡院·门厅', region: 'yamen',
  desc: '门厅里挂着历科的榜文，纸都黄了。几张长桌拼在一处，坐着两个书办，手边是厚厚的名册。要应考的在这里报名，考棚在里头。',
  exits: { u: 'jn_gongyuan_hall', [OPP[a2.dir]]: a2.host },
  actions: [
    { label: '报名应考', cmd: '应试', keywords: ['应试', '报考', '科考'], desc: '报名这一场' },
  ],
};
patch[a2.host] = patch[a2.host] || { id: a2.host, exits: {} };
patch[a2.host].exits[a2.dir] = 'jn_gongyuan_gate';

rooms['jn_gongyuan_hall'] = {
  id: 'jn_gongyuan_hall', name: '贡院·考棚', region: 'yamen',
  desc: '考棚一溜排到墙根，每间只容一人一桌。四角站着巡场，谁抬手多看一眼都要被喝住。空气里全是墨与汗的味道。',
  exits: { d: 'jn_gongyuan_gate' },
  actions: [
    { label: '应考', cmd: '应试', keywords: ['应试', '答题', '考试'], desc: '坐下，摊开卷子' },
    { label: '温书', cmd: '温书', keywords: ['温书', '读书'], desc: '考前来不及了，临时抱佛脚' },
  ],
};

/* ---- 洛阳擂台（洛阳 region）---- */
const a3 = attach('luoyang', 'luoyang_arena');
if (!a3) { console.error('✘ 洛阳找不到可挂的房间'); process.exit(1); }
rooms['luoyang_arena'] = {
  id: 'luoyang_arena', name: '洛阳·擂台', region: 'luoyang',
  desc: '一座丈许高的木台，四角缠着红绸。台边的彩棚挂着灯笼，棚里坐的人看不清脸。台板被踩得发亮。',
  exits: { [OPP[a3.dir]]: a3.host },
  actions: [
    { label: '上台应试', cmd: '比武招亲', keywords: ['招亲', '应试', '上台'], desc: '登台' },
  ],
};
patch[a3.host] = patch[a3.host] || { id: a3.host, exits: {} };
patch[a3.host].exits[a3.dir] = 'luoyang_arena';

/* ---- 已有房间：补听曲 / 诗会入口（actions 是 replace，必须写全）---- */
const stageOld = (ROOMS['jn_brothel_stage'] && ROOMS['jn_brothel_stage'].actions) || [];
rooms['jn_brothel_stage'] = {
  id: 'jn_brothel_stage', region: 'qinglou',
  actions: stageOld.concat([
    { label: '听曲', cmd: '听曲', keywords: ['听曲', '点曲', '曲子'], desc: '点一支曲子（可「听曲 <曲牌>」）' },
  ]),
};
rooms['jn_brothel_2'] = {
  id: 'jn_brothel_2', region: 'qinglou',
  actions: [
    { label: '赴诗会', cmd: '赋诗', keywords: ['诗会', '赋诗', '对句'], desc: '席上有人出题' },
  ],
};

fs.writeFileSync(OUT, JSON.stringify({ rooms: Object.assign({}, rooms, patch) }, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('新房间', Object.keys(rooms).length, '；补反向边', Object.keys(patch).length, '间');
console.log('挂靠：', JSON.stringify(Object.fromEntries(Object.entries(usedDirs).map(([k, v]) => [k, [...v]]))));
