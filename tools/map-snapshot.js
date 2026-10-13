/* 生成地图渲染快照，方便肉眼检查渲染效果（**不进回归**：文件名不匹配 smoke-* / *-check）
 *
 * 🔴 P0-C：一次生成**两版**，让主人能对照着看迷雾开关的效果：
 *    .map-snapshot.html      —— 「地图显示未探索地名」**打开**（fog=0）：所有地块显示名字
 *    .map-snapshot-fog.html  —— **默认**（fog=1）：未探索的地块只留白，不剧透名字与出口
 *   两版除了「未探索的格子有没有名字」之外**应当一模一样**：
 *   格子数、坐标、连线、朱印位置都必须相同（迷雾只裁字段，不裁格子）。
 *   这条正是 `smoke-map-region-filter.js` §8-3 / §4-4 机器验过的东西，
 *   这里生成出来是给**人眼**再确认一遍。
 *
 * 用法：node tools/map-snapshot.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

const UISRC = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
function grab(name) {
  const m = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('未找到 ' + name);
  return m[0];
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* ⚠️ 这三个数是**历史遗留的形参**：C-2 之后 `mapHtml` 自己按四档断点算格距
   （XS66 / S60 / M56 / L52，见 ui.js 的 `tier`），不再吃外部传进来的值。
   留着是因为 `new Function` 的形参表改了也没坏处，但**别照着这里的 30 去推算布局** ——
   它已经不参与渲染了。 */
const MAP_CELL = 30, MAP_NODE = 26, MAP_PAD = 34;
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
const built = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
  grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF);

/** 与 ui.js 的 `mapViewOpts()` 同源：`region` 只能写 auto（前端不知道自己在哪个州） */
function viewOf(e, fog) {
  return e.view({ map: true, mapRegion: 'auto', mapNeighbors: false, mapFog: fog });
}

function page(title, note, body) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="../game/src/renderer/css/main.css"><title>' + title + '</title></head>' +
    '<body style="padding:20px;background:#f6f1e4">' +
    '<h2 style="font-family:serif">' + title + '</h2>' +
    '<p style="font-family:serif;font-size:13px;color:#6b5f4a;max-width:640px;line-height:1.7">' + note + '</p>' +
    body + '</body></html>';
}

(async () => {
  const e = new GameEngine();
  await e.boot({});
  e.newGame({ name: '快照侠' });

  /* ⚠️ 点亮**当前州**里的一批房间，而不是 `data.rooms` 的前 40 个。
     分批之后视野只剩本州本层，点亮点别的州的房间在快照上根本看不见，
     于是「已探索 vs 未探索」的对比无从看起 —— 两版快照会看起来一模一样，
     那这版快照就白生成了。 */
  const probe = viewOf(e, false);
  const here = (probe.map.rooms || []).find(r => r.current) || {};
  const p = e.world.player;
  const inRegion = Object.keys(e.world.data.rooms || {})
    .filter(id => {
      const r = e.world.data.rooms[id];
      return r && r.region === here.region;
    });
  inRegion.slice(0, 12).forEach(id => { try { p.setFlag('visited_' + id, true); } catch (err) { } });

  const vOff = viewOf(e, false);   /* fog=0：设置项「地图显示未探索地名」打开 */
  const vOn = viewOf(e, true);     /* fog=1：默认 */

  const namedOff = vOff.map.rooms.filter(r => r.name).length;
  const namedOn = vOn.map.rooms.filter(r => r.name).length;
  const hOff = built.mapHtml(vOff), hOn = built.mapHtml(vOn);
  const count = (h) => (h.match(/data-room="/g) || []).length;

  fs.writeFileSync(path.join(ROOT, '.map-snapshot.html'), page(
    '江湖舆图 · 渲染快照（未探索地名 = 显示）',
    '这一版模拟玩家在设置里打开「地图显示未探索地名」。<b>所有地块都显示名字</b>，' +
    '走过的是浓墨，没走过的淡一档。用来对照另一版看「开关打开后是什么样」。',
    hOff));
  fs.writeFileSync(path.join(ROOT, '.map-snapshot-fog.html'), page(
    '江湖舆图 · 渲染快照（默认 · 迷雾留白）',
    '这一版是<b>游戏默认</b>的样子：未探索的地块<b>只有留白，不显示名字也不给出出口</b> —— ' +
    '「没去过」就是纸上什么都没写，而不是写了个看不清的字。' +
    '走过的地方（含紧邻一步）照常显示全名。<br>' +
    '⚠️ 除了「未探索的格子里有没有字」，两版的格子数、位置、连线、朱印位置<b>必须完全一致</b> —— ' +
    '迷雾只裁字段，不裁格子。若发现两版布局有差，那是 bug，不是设计。',
    hOn));

  console.log('已生成 .map-snapshot.html       （未探索地名 = 显示，fog=0）');
  console.log('已生成 .map-snapshot-fog.html   （默认 · 迷雾留白，fog=1）');
  console.log('');
  console.log('  本州房间 ' + vOn.map.rooms.length + '　有名字的：不开雾 ' + namedOff +
    ' · 开雾 ' + namedOn + '　（差 ' + (namedOff - namedOn) + ' = 未探索被裁掉的）');
  console.log('  已点亮 ' + vOn.map.explore.visited + ' / 全世界 ' + vOn.map.explore.total +
    '　（分母仍是全世界房间数，不随分批缩水）');
  console.log('  两版格子数 ' + count(hOff) + ' vs ' + count(hOn) + '　← 必须相等');
})();
