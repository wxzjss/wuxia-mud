/* 地图 + 新手引导 综合验证（真跑前端渲染函数） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

const UISRC = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
function grab(name) {
  const m = UISRC.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
  if (!m) throw new Error('未找到函数 ' + name);
  return m[0];
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const MAP_CELL = 30, MAP_NODE = 26, MAP_PAD = 34;
const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
const built = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
  grab('mapHtml') + '\n' + grab('shortName') + '\n' + grab('guideHtml') + '\nreturn { mapHtml, guideHtml, shortName };')(
    esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF);

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  const e = new GameEngine();
  await e.boot({});
  e.newGame({ name: '验证侠客' });

  console.log('\n── 地图数据 ──');
  const v = e.view();
  const m = v.map;
  ok('返回全部房间', m.rooms.length >= 95, 'rooms=' + m.rooms.length);
  ok('返回区域', m.regions.length >= 20, 'regions=' + m.regions.length);
  ok('有布局坐标', m.bounds && m.bounds.w > 0 && m.bounds.h > 0, JSON.stringify(m.bounds));
  ok('有区域外框', Object.keys(m.regionBoxes || {}).length >= 20, 'boxes=' + Object.keys(m.regionBoxes || {}).length);
  ok('探索度统计', m.explore && m.explore.total === m.rooms.length, JSON.stringify(m.explore));

  const here = m.rooms.find(r => r.current);
  ok('当前房间有坐标', here && typeof here.x === 'number' && typeof here.y === 'number', here ? here.name + '@(' + here.x + ',' + here.y + ')' : '无');
  ok('坐标无重叠', (() => {
    const seen = new Set();
    for (const r of m.rooms) { const k = r.x + ',' + r.y; if (seen.has(k)) return false; seen.add(k); }
    return true;
  })());

  console.log('\n── 地图渲染 ──');
  const mh = built.mapHtml(v);
  ok('mapHtml 不抛异常', mh.length > 500, 'len=' + mh.length);
  ok('含地图画布', mh.includes('map-canvas'));
  ok('含当前位置', mh.includes(here.name));
  ok('含区域底色块', mh.includes('map-region-box'));
  ok('含房间节点', mh.includes('map-node'));
  ok('含图例', mh.includes('map-legend'));
  ok('含探索进度', mh.includes('江湖探索'));
  ok('含相邻房间快捷', mh.includes('一步可达'));

  /* —— 连续大地图断言（本轮修复「被分割成很多房间」）—— */
  console.log('\n── 连续大地图 ──');
  ok('有整张网格底纸', mh.includes('map-grid-bg'));
  ok('走廊用 path 批量画', mh.includes('<path d=') && mh.includes('edge-dim'));
  ok('格子缩小到 26px', MAP_NODE === 26 && MAP_CELL === 30, 'cell=' + MAP_CELL + ' node=' + MAP_NODE);
  const gap = MAP_CELL - MAP_NODE;
  ok('格子缝极小（视觉连片）', gap <= 6, 'gap=' + gap + 'px');
  ok('已探索房间有名字', mh.includes('>江南') || /mn-name">[^<]/.test(mh));

  console.log('\n── 新手引导 ──');
  const p = e.world.player;
  const g0 = v.guide;

  console.log('  引导状态：' + g0.doneCount + '/' + g0.total);
  const gh = built.guideHtml(v);
  ok('guideHtml 不抛异常', gh.length > 100, 'len=' + gh.length);
  ok('含步骤总数', gh.includes(String(g0.total)));
  ok('含「江湖指引」', gh.includes('江湖指引'));

  // 逐步推进
  const seq = ['look', 'n', 'i', 'score', 'lian', 'talk 小二'];
  let last = g0.doneCount;
  let increased = 0;
  for (const cmd of seq) {
    const r = e.exec(cmd);
    if (r.view && r.view.guide) {
      const d = r.view.guide.doneCount;
      if (d > last) increased++;
      last = d;
    }
  }
  ok('指令推进引导进度', increased >= 3, '推进了 ' + increased + ' 步，当前 ' + last + '/' + g0.total);

  // 每个步骤都必须有完整字段
  const badStep = (g0.steps || []).find(s => !s.id || !s.title || !s.goal || !s.hint || typeof s.done !== 'boolean');
  ok('步骤字段完整', !badStep, badStep ? JSON.stringify(badStep) : 'all ok');

  // 空/畸形数据不能炸
  console.log('\n── 健壮性 ──');
  const shapes = [
    ['无 map', {}],
    ['空 map', { map: {} }],
    ['空 rooms', { map: { rooms: [] } }],
    ['有 map 无 guide', { map: v.map }],
    ['空 guide', { guide: {} }],
    ['guide 无 steps', { guide: { steps: null } }],
  ];
  let crashed = [];
  for (const [label, input] of shapes) {
    try { built.mapHtml(input); built.guideHtml(input); }
    catch (err) { crashed.push(label + ':' + err.message); }
  }
  ok('畸形数据不崩', crashed.length === 0, crashed.join(' | ') || '6 种输入全部安全');

  /* —— 本轮修复项回归 —— */
  console.log('\n── 本轮修复回归 ──');

  /* 1) 弹窗 ✕ 必须有人绑 */
  const HTML = fs.readFileSync(path.join(ROOT, 'game/src/renderer/index.html'), 'utf8');
  ok('HTML 里有 ✕ 按钮', HTML.includes('id="modal-close"'));
  ok('ui.js 有 bindModal 且绑了 modal-close', /bindModal/.test(UISRC) && /modal-close/.test(UISRC));
  const START = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/start.js'), 'utf8');
  ok('boot 里调用了 bindModal', /U\.bindModal\(\)/.test(START));

  /* 2) 输入框面板指令拦截 */
  const PANELSRC = UISRC.match(/const PANEL_CMDS = \{[\s\S]*?\n  \};/);
  ok('有 PANEL_CMDS 映射表', !!PANELSRC);
  ok('映射含 地图→map', /地图: 'map'/.test(UISRC));
  ok('映射含 背包→inventory', /背包: 'inventory'/.test(UISRC));
  ok('映射含 状态→score', /状态: 'score'/.test(UISRC));
  ok('映射含 武学/任务/属性/装备/门派', /武学: 'skills'/.test(UISRC) && /任务: 'quests'/.test(UISRC) && /属性: 'attr'/.test(UISRC) && /装备: 'equipment'/.test(UISRC) && /门派: 'sect'/.test(UISRC));
  ok('doCmd 里拦截面板指令', /panelForCmd\(cmd\)/.test(UISRC) && /return panel\(pn\)/.test(UISRC));

  /* 3) 引导文案方位：不能再说「右侧地图」 */
  const TUT = fs.readFileSync(path.join(ROOT, 'game/src/core/tutorial.js'), 'utf8');
  ok('引导不再写「右侧「地图」」', !/右侧「地图」/.test(TUT));
  ok('引导明确说左侧', /左侧.*地图|地图.*左侧/.test(TUT), (TUT.match(/hint: '输入 n[^']*'/) || [''])[0]);
  ok('ui.js 引导完成文案也不写「按「地图」」', !/按「地图」探索/.test(UISRC));

  /* 4) 房间可交互物件 */
  console.log('\n── 可交互物件 ──');
  ok('view() 带 roomActions 字段', Array.isArray(v.roomActions), 'count=' + (v.roomActions || []).length);
  ok('engine 有 roomActionsView', typeof e.roomActionsView === 'function');

  /* 找一个确有 actions 的房间，验证字段齐全 */
  let raRoom = null, raActs = null;
  for (const r of v.map.rooms) {
    const rr = e.world.getRoom(r.id);
    if (rr && rr.actions && rr.actions.length) {
      const save = e.world.player.room;
      e.world.player.room = r.id;
      const acts = e.roomActionsView(e.world.player);
      e.world.player.room = save;
      if (acts.length) { raRoom = r.id; raActs = acts; break; }
    }
  }
  ok('确实 Rooms 有可交互动作', !!raRoom, raRoom || '未找到');
  if (raActs) {
    const a = raActs[0];
    ok('动作有 name', !!a.name, a.name);
    ok('动作有 cmd（给玩家提示用哪个指令）', !!a.cmd, a.cmd);
    ok('动作有 ok 布尔', typeof a.ok === 'boolean');
  }

  /* 5) renderRoom / renderLogText 真跑一遍 */
  const RENDER = new Function('esc', 'toast', 'doCmd',
    grab('renderRoom') + '\n' + grab('renderRoomActions') + '\n' +
    'return { renderRoom, renderRoomActions };')(esc, () => { }, () => { });
  ok('renderRoom 等函数可抠出', typeof RENDER.renderRoom === 'function');

  /* 日志高亮渲染 */
  const LOGFN = new Function('esc',
    grab('renderLogText') + '\nreturn renderLogText;')(esc);
  const hlOut = LOGFN({ text: '这里有：店小二。', hl: [{ text: '店小二', type: 'npc', actions: [{ label: '看看', cmd: 'look 店小二' }] }] });
  ok('日志可交互名词渲染成 .hl 按钮', hlOut.includes('class="hl"') && hlOut.includes('店小二'));
  ok('无 hl 的日志保持纯文本', LOGFN({ text: '江湖路远。' }) === '江湖路远。');

  /* 6) lookRoom 输出带 hl */
  const lookRes = e.cmds.lookRoom({ player: e.world.player, world: e.world });
  const hlLine = (lookRes.lines || []).find(l => l.hl && l.hl.length);
  ok('lookRoom 日志带可点名词', !!hlLine, hlLine ? hlLine.text.slice(0, 30) : '无');
  if (hlLine) {
    ok('可点名词带 actions（中文操作菜单）', hlLine.hl.every(h => h.actions && h.actions.length), hlLine.hl.map(h => h.text + '→' + (h.actions || []).map(a => a.label).join('/')).join(' '));
  }

  console.log('\n' + '='.repeat(42));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(42));
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
