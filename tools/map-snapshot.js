/* 生成地图渲染快照，方便肉眼检查「是不是一张连续大地图」 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

const UISRC = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
function grab(name) {
  const m = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('未找到 ' + name);
  return m[0];
}
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MAP_CELL = 30, MAP_NODE = 26, MAP_PAD = 34;
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
const built = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
  grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF);

(async () => {
  const e = new GameEngine();
  await e.boot({});
  e.newGame({ name: '快照侠' });
  /* 手动点亮一批房间，好看清 visited 的样子 */
  const ids = e.world.data.rooms ? Object.keys(e.world.data.rooms) : [];
  const p = e.world.player;
  ids.slice(0, 40).forEach(id => { try { p.setFlag('visited_' + id, true); } catch (err) { } });
  const v = e.view();
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">' +
    '<link rel="stylesheet" href="../game/src/renderer/css/main.css"><title>地图快照</title></head>' +
    '<body style="padding:20px;background:#f6f1e4">' +
    '<h2 style="font-family:serif">江湖舆图 · 渲染快照</h2>' + built.mapHtml(v) + '</body></html>';
  fs.writeFileSync(path.join(ROOT, '.map-snapshot.html'), html);
  console.log('已生成 .map-snapshot.html  (' + html.length + ' 字节)');
  console.log('房间 ' + v.map.rooms.length + '　区域 ' + v.map.regions.length + '　已点亮 ' + v.map.explore.visited);
})();
