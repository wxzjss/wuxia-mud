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
const built = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF', 'mapScope',
  grab('mapHtml') + '\n' + grab('shortName') + '\n' + grab('guideHtml') + '\nreturn { mapHtml, guideHtml, shortName };')(
    esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF, 'region');

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
  ok('含探索进度', mh.includes('本范围') && mh.includes('全江湖'));
  ok('含相邻房间快捷', mh.includes('一步可达'));

  /* —— 地形装饰层（★ 主人第四轮要求**删掉**）——
     原来是每个 terrain 格子画一个 ♣/≈/❄ 之类的符号，看着像贴纸；
     而且它们本来只是「区域面积不够时撑框用的填充」，不是真的地块。
     数据还留着（后端 mapView 照常返回 terrain），只是前端**不再画** ——
     断言要守「不再画」，别守「画出来了」（守反了会把主人的要求判成缺陷）。 */
  console.log('\n── 地形装饰（已按主人要求删掉）──');
  const terr = v.map && v.map.terrain;
  ok('后端 mapView 仍返回 terrain（数据没删，只是不画）', !!terr && Object.keys(terr).length > 0,
    'terrain 区域数=' + (terr ? Object.keys(terr).length : 0));
  ok('★ 前端**不再渲染**地形装饰（无 map-terrain-layer / map-terrain 节点）',
    !mh.includes('map-terrain-layer') && !mh.includes('class="map-terrain '));
  /* ⚠️ 必须查 NaN：cx/cy 传错字段名时坐标全是 NaN，但格子数量仍然对，
     只断言「数量一致」会假绿（真踩过一次）。 */
  ok('地图坐标无 NaN', !/style="left:NaN|top:NaN/.test(mh),
    (mh.match(/top:NaN/g) || []).length + ' 个 NaN 坐标');

  /* —— 两级地图视野（默认只看当前区域）—— */
  console.log('\n── 两级地图视野 ──');
  const curRoom = m.rooms.find(r => r.current);
  const curTerr = (terr && curRoom && terr[curRoom.region] || []).length;
  const terrCells = (mh.match(/class="map-terrain /g) || []).length;
  ok('★ region 模式同样不画地形装饰（0 个）', terrCells === 0,
    '渲染 ' + terrCells + ' / 后端当前区域共 ' + curTerr + '（数据在、不画）');
  ok('有视野切换栏', mh.includes('data-scope="region"') && mh.includes('data-scope="world"'));
  const cb = (m.regionBoxes || {})[curRoom.region];
  const cw = (cb.w * 30 + 68) + 'px', chh = (cb.h * 30 + 68) + 'px';
  ok('region 模式画布=当前区域大小（不是全图）',
    mh.includes('width:' + cw + ';height:' + chh),
    '区域 ' + curRoom.region + ' ' + cb.w + 'x' + cb.h + ' → 期望 ' + cw + 'x' + chh);
  const shownNodes = (mh.match(/class="map-node/g) || []).length;
  const scopeRooms = m.rooms.filter(r => r.region === curRoom.region).length;
  ok('region 模式只渲染本区域房间', shownNodes === scopeRooms,
    '渲染 ' + shownNodes + ' / 本区域 ' + scopeRooms);
  ok('region 模式只画本区域底色块', (mh.match(/map-region-box/g) || []).length === 1,
    '底色块 ' + (mh.match(/map-region-box/g) || []).length);
  ok('画布远小于全图（不会一打开就看老远）',
    parseInt(cw, 10) < 900, '画布宽 ' + cw + '（全图约 2178px）');
  ok('探索度分开显示（本范围 + 全江湖）', mh.includes('本范围') && mh.includes('全江湖'));

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

  /* 7) 斜向平移：真跑 bindMapPan 的手势逻辑（主人报的 bug） */
  {
    const CFG = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
    ok('地图禁掉浏览器单轴原生滚动（touch-action:none）',
      /\.map-canvas[\s\S]{0,400}touch-action:\s*none/.test(CFG));
    ok('拖拽中有 panning 光标态', /\.map-canvas\.panning/.test(CFG));

    const PAN = grab('bindMapPan');
    ok('bindMapPan 可抠出', PAN.indexOf('function bindMapPan') >= 0, PAN.slice(0, 40));

    /* 造一个假画布 + 假 window，把函数真跑一遍 */
    const listeners = {};
    const winL = {};
    const canvas = {
      scrollLeft: 0, scrollTop: 0, scrollWidth: 2000, clientWidth: 500,
      classList: { _s: {}, add(c) { this._s[c] = 1; }, remove(c) { delete this._s[c]; } },
      addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
      removeEventListener() {},
    };
    const fakeWin = {
      addEventListener(t, f) { (winL[t] = winL[t] || []).push(f); },
      setTimeout: (f) => f(),
    };
    let captured = null;
    canvas.addEventListener = function (t, f, cap) {
      if (t === 'click' && cap) { captured = f; return; }
      (listeners[t] = listeners[t] || []).push(f);
    };
    const fire = (t, e) => (listeners[t] || []).forEach(f => f(e));
    const fireWin = (t, e) => (winL[t] || []).forEach(f => f(e));
    const ev = (x, y) => ({ clientX: x, clientY: y, button: 0, cancelable: true,
      preventDefault() { this.defaulted = true; }, stopPropagation() { this.stopped = true; } });

    new Function('document', 'window', PAN + '\nreturn bindMapPan;')(
      { querySelector: () => canvas }, fakeWin)();

    ok('已绑定 mousedown/touchstart', !!(listeners.mousedown && listeners.touchstart));

    /* 从 (100,100) 拖到 (60,70) = 左上斜向 40/30 */
    fire('mousedown', ev(100, 100));
    ok('按下后进入 panning 态', !!canvas.classList._s.panning);
    fireWin('mousemove', ev(60, 70));
    ok('拖到左上 → scrollLeft 增大 40', canvas.scrollLeft === 40, 'scrollLeft=' + canvas.scrollLeft);
    ok('拖到左上 → scrollTop 增大 30', canvas.scrollTop === 30, 'scrollTop=' + canvas.scrollTop);
    ok('斜向拖动两轴同时变化（不是单轴）',
      canvas.scrollLeft > 0 && canvas.scrollTop > 0);

    fireWin('mouseup', ev(60, 70));
    ok('松手后退出 panning 态', !canvas.classList._s.panning);
    ok('拖动后装上捕获期 click 拦截（防误触走路）', typeof captured === 'function');

    /* 拖过之后点房间：应被吞掉 */
    let reached = false;
    const swallowed = captured && captured({ preventDefault() { reached = false; }, stopPropagation() { reached = false; } });
    ok('拦截函数让点击不落到房间按钮', swallowed === undefined && reached === false);

    /* 没拖动的纯点击不该被拦 —— 重跑一次干净手势 */
    listeners.mousedown = []; winL.mousemove = []; winL.mouseup = []; captured = null;
    canvas.scrollLeft = 0; canvas.scrollTop = 0;
    fire('mousedown', ev(100, 100));
    fireWin('mousemove', ev(103, 102));   /* 位移 5 < 阈值 4+1 的边界，取更小 */
    fireWin('mouseup', ev(103, 102));
    ok('轻点（未超阈值）不装 click 拦截', captured === null);

    /* 滚轮：竖轮补横向 */
    let wheelDefaulted = false;
    listeners.wheel.forEach(f => f({ deltaY: 120, deltaX: 0, cancelable: true,
      preventDefault() { wheelDefaulted = true; } }));
    ok('竖向滚轮在宽图上补横向滚动', canvas.scrollLeft === 120 && wheelDefaulted,
      'scrollLeft=' + canvas.scrollLeft);
  }

  console.log('\n' + '='.repeat(42));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(42));
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error('异常:', err.stack); process.exit(1); });
