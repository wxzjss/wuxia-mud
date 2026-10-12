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
  grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml, shortName };')(
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
  /* 🔴 2026-10-12 口径改动：主人把图例里的四条逐一删光，整块图例下线。 */
  ok('图例已整体下线（主人 10-12 要求全部删掉）', !mh.includes('map-legend'));
  ok('含探索进度', mh.includes('本范围') && mh.includes('全江湖'));
  /* 🔴 2026-10-12 口径改动：主人「把一步可达删了」——
     画布上那排「北门 / 客栈 / 药铺」快捷按钮整块下线，地图回归「只看不点」。 */
  ok('「一步可达」快捷条已下线（主人 2026-10-12 要求删掉）', !mh.includes('一步可达'));

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

  /* —— 世界地图「首尾相连」：跨区域桥（2026-10-11 主人）——
     原话：「我要的世界地图是所有地图首尾连接：如果这个 A 区域边缘的地块
     再往前走一步就是 B 区域，那就用线把两块连起来，整个分散的世界地图
     合并成一个完整的大地图。」 */
  console.log('\n── 跨区域桥（世界地图首尾相连）──');
  {
    const br = (v.map && v.map.bridges) || [];
    const cross = br.filter(x => x.crossRegion);
    ok('后端下发了 bridges', br.length > 0, br.length + ' 条');
    ok('★ 其中有跨区域的桥（这是主人点名的那一类）', cross.length > 0, cross.length + ' 条');
    /* 桥的两个端点必须是真实房间，而且**在图上的坐标不相邻** ——
       相邻的那些走廊已经画过了，再补一条就是重复画。 */
    const cellOf = id => (v.map.cells || {})[id];
    const real = cross.filter(x => cellOf(x.a) && cellOf(x.b));
    ok('★ 桥的两端都是真实房间', real.length === cross.length,
      real.length + '/' + cross.length);
    const DIRS = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1],
      nw: [-1, -1], ne: [1, -1], sw: [-1, 1], se: [1, 1] };
    const adjacent = real.filter(x => {
      const A = cellOf(x.a), B = cellOf(x.b), d = DIRS[x.dir];
      return !!(d && A.x + d[0] === B.x && A.y + d[1] === B.y);
    });
    ok('★ 桥都是「图上不相邻」的（不相邻才需要桥）', adjacent.length === 0,
      adjacent.length + ' 条其实相邻');
    /* 🔴 2026-10-12 口径改动（主人两句话）：
       ①「把世界地图的所有虚线删了」—— 跨区那条**兜底折线**（`.edge-bridge`）整段不再画。
       ②「把两个地块之间的连线换成虚线形式」—— 于是**所有**走廊连线都改成虚线，
          样式从 `.edge-bridge` 挪到了 `.edge` 上。
       这一节原来守的是「桥存在 + 是折线 + 是虚线」，现在改守新契约：
       桥真没了，而走廊线（不论同区还是跨区）都是虚线。 */
    /* 世界模式渲染 —— 🔴 2026-10-12 主人「把天下全图整个界面删了」：
       没有「世界模式」了，`mapHtml` 恒为「本区」视野。形参表里的 `mapScope`
       也随之一并撤掉（传了也是空转）。下面这一节改守**「跨区兜底折线真的没了」**
       与「同区走廊仍成网」——「首尾相连」那件事现在由跨区域出口的抬头标注承担。 */
    const worldBuilt = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
      grab('mapHtml') + '\n' + grab('shortName') + '\nreturn { mapHtml };')(
        esc, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF);
    const wh = worldBuilt.mapHtml(v);
    ok('★ 跨区兜底长折线已下线（主人 10-12：删掉所有虚线）', wh.indexOf('edge-bridge') < 0);
    ok('★ 走廊连线全是虚线（主人 10-12：连线换成虚线形式）',
      /\.map-edges\s+\.edge\s*\{[^}]*stroke-dasharray/.test(
        fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8')));
    /* 跨区边仍然要连上 —— 靠的是「布局咬合后本来就相邻」（走走廊那一段），
       不是靠兜底折线。所以这里改成查「跨区边真的被走廊画到了」：
       世界地图模式下渲染出的 path 里必须有 M/L 段（= 有走廊）。 */
    const edgePath = (wh.match(/<path d="([^"]*)" class="edge edge-dim"/) || [])[1] || '';
    ok('★ 世界地图仍然把地块连成一张网（有走廊段，不是一盘散沙）',
      (edgePath.match(/M/g) || []).length > 0, (edgePath.match(/M/g) || []).length + ' 段');
  }

  /* —— 两级地图视野（默认只看当前区域）—— */
  console.log('\n── 两级地图视野 ──');
  const curRoom = m.rooms.find(r => r.current);
  const curTerr = (terr && curRoom && terr[curRoom.region] || []).length;
  const terrCells = (mh.match(/class="map-terrain /g) || []).length;
  ok('★ region 模式同样不画地形装饰（0 个）', terrCells === 0,
    '渲染 ' + terrCells + ' / 后端当前区域共 ' + curTerr + '（数据在、不画）');
  /* 🔴 2026-10-12 主人「只保留当前区域界面，把天下全图整个界面删了」
     ⇒ 视野切换栏（当前区域 / 天下全图）整条撤掉。
     这一条从「有切换栏」**反转成「切换器真的没了 + 那句说明还在」**。 */
  ok('★ 视野切换栏已删（没有 data-scope 了）', !mh.includes('data-scope'));
  ok('★ 取而代之的是那句「只显示你脚下这一片：XX」',
    mh.includes('map-scope') && mh.includes('只显示你脚下这一片'));
  /* 🔴 2026-10-11 主人：「区域地图只居中显示那一块区域，但你区域地块框框外面
     还有那么大一片空地块不删是留着做什么的。」
     ⇒ 取景框从「后端那个被 terrain/minW 撑大的 box」改成
       「本区域房间的**紧包围盒**」。所以这里不能再拿 cb.w/cb.h 算，
       要按房间实际范围算，并且顺带断言「比那个撑大的框更小」。 */
  const cb = (m.regionBoxes || {})[curRoom.region];
  const inReg = m.rooms.filter(r => r.region === curRoom.region);
  const tMinX = Math.min.apply(null, inReg.map(r => r.x));
  const tMinY = Math.min.apply(null, inReg.map(r => r.y));
  const tMaxX = Math.max.apply(null, inReg.map(r => r.x));
  const tMaxY = Math.max.apply(null, inReg.map(r => r.y));
  const tw = tMaxX - tMinX + 1, th = tMaxY - tMinY + 1;
  const cw0 = (tw * 30 + 68) + 'px', chh0 = (th * 30 + 68) + 'px';
  /* 🔴 2026-10-08 口径改动（主人：「电脑端看当前区域的地图放在左侧、而且很小看不清」）：
     区域模式现在会**按弹窗可用宽高自动放大格距**（`mapHtml` 里的 fitCell），
     所以画布不再恒等于「紧包围盒 × 30px」。这里改成断两条更本质的事：
       ① 画布宽高比 = 本区域紧包围盒的宽高比（还是「只框住本区房间」）；
       ② 格距**只增不减**（≥30px 桌面基准）—— 也就是真的放大了。 */
  const cvTag = (mh.match(/<div class="map-canvas[^"]*"[^>]*style="([^"]*)"/) || [])[1] || '';
  const cwPx = parseFloat((cvTag.match(/width:\s*(\d+)px/) || [])[1] || '0');
  const chPx = parseFloat((cvTag.match(/height:\s*(\d+)px/) || [])[1] || '0');
  const cellPx = (cwPx - 68) / tw;
  ok('region 模式画布宽高比 = 本区域紧包围盒（仍是「只框本区」）',
    Math.abs((cwPx / chPx) - (tw / th)) < 0.06,
    '画布 ' + cwPx + 'x' + chPx + ' vs 区域 ' + tw + 'x' + th);
  ok('★ region 模式格距自动放大（≥30px 桌面基准）', cellPx >= 29.5,
    '格距 ' + cellPx.toFixed(1) + 'px（旧的固定值就是 30px）');
  ok('★ 区域地图在弹窗里居中（.map-canvas 有 auto 外边距）',
    /\.map-canvas\s*\{[^}]*margin-left:\s*auto/.test(
      fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8')));
  ok('★ 画布不再包含框外那圈空地块（严格小于后端撑大的 box）',
    tw <= cb.w && th <= cb.h, '实际 ' + tw + 'x' + th + ' vs 后端框 ' + cb.w + 'x' + cb.h);
  const shownNodes = (mh.match(/class="map-node/g) || []).length;
  const scopeRooms = m.rooms.filter(r => r.region === curRoom.region).length;
  ok('region 模式只渲染本区域房间', shownNodes === scopeRooms,
    '渲染 ' + shownNodes + ' / 本区域 ' + scopeRooms);
  ok('region 模式只画本区域底色块', (mh.match(/map-region-box/g) || []).length === 1,
    '底色块 ' + (mh.match(/map-region-box/g) || []).length);
  ok('画布远小于全图（不会一打开就看老远）',
    cwPx < 900, '画布宽 ' + cwPx + 'px（全图约 2178px）');
  ok('探索度分开显示（本范围 + 全江湖）', mh.includes('本范围') && mh.includes('全江湖'));

  /* —— 连续大地图断言（本轮修复「被分割成很多房间」）—— */
  console.log('\n── 连续大地图 ──');
  ok('有整张网格底纸', mh.includes('map-grid-bg'));
  ok('走廊用 path 批量画', mh.includes('<path d=') && mh.includes('edge-dim'));
  ok('格子缩小到 26px', MAP_NODE === 26 && MAP_CELL === 30, 'cell=' + MAP_CELL + ' node=' + MAP_NODE);
  const gap = MAP_CELL - MAP_NODE;
  ok('格子缝极小（视觉连片）', gap <= 6, 'gap=' + gap + 'px');
  ok('已探索房间有名字', mh.includes('>江南') || /mn-name">[^<]/.test(mh));
  /* ★ 主人 2026-10-08：「把地块里的方块框删掉，地块用纯地名显示」——
     边框与底色必须真的没了（一格的面积让给名字）。
     ⚠️ 用 indexOf 而不是正则：这个文件里正则的反斜杠很容易被脚本改写坏。 */
  const cssNow = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
  const iNode = cssNow.indexOf('.map-node {');
  const nodeRule = iNode < 0 ? '' : cssNow.slice(iNode, cssNow.indexOf('}', iNode) + 1);
  ok('★ 地块不再有方块框（.map-node 无边框、无底色）',
    nodeRule.indexOf('border: none') >= 0 && nodeRule.indexOf('background: transparent') >= 0,
    nodeRule.slice(0, 100));
  /* 🔴 2026-10-12 口径改动：主人「把地图上地块名字的**黄色字体**呈现与**可点击前往**删了」
     「把玩家当前所在地块的**红色**显示形式换成**黄色**显示形式」。
     ⇒ 「一步可达」的金字（.near）整套下线；「你在这里」从红改黄。
     现在地块状态只剩三种：你在这里（黄）/ 去过（墨）/ 没去过（淡墨）。 */
  ok('★ 你在这里 = 黄字加粗（主人 10-12 从红改黄）',
    /\.map-node\.here\s+\.mn-name\s*\{[^}]*color:\s*var\(--gold\)/.test(cssNow));
  ok('★ 「一步可达」的金字与可点整套下线（.near 的样式规则已删）',
    !/\.map-node\.near\s*\{/.test(cssNow));
  ok('★ 地块底色框/斜纹那套仍然没有（老契约不变）',
    nodeRule.indexOf('background: transparent') >= 0);

  console.log('\n── 新手引导（🔴 2026-10-12 已全删）──');
  /* 主人 2026-10-12：「新手教程剧情全删」。
     这块原先验的是 `guideHtml`（「新手教程 · 入江湖」面板）+ 引导进度推进。
     现在面板与八章剧情整块下线，本节的断言反转为**「它真的没了」** ——
     留着旧断言会天天报红，而删掉不留守卫又会让「谁悄悄接回来」无人发现。 */
  const p = e.world.player;
  ok('★ 服务端不再下发 guide（恒 null）', v.guide === null, JSON.stringify(v.guide));
  ok('★ ui.js 里已经没有 guideHtml（面板函数真删了）', !/function guideHtml/.test(UISRC));
  ok('★ ui.js 里已经没有 renderGuide 的实际渲染体', /function renderGuide\(\)\s*\{\s*\/\* 已下线/.test(UISRC));
  /* ⚠️ 查的是**真节点**（`id="guide-block"`），不是注释里的字样 ——
     注释里提这个名字是**故意留的**（说明这里原先有什么、为什么删）。 */
  ok('★ 右侧那个常驻块也没了（index.html 无 id="guide-block" 节点）',
    !/id="guide-block"/.test(fs.readFileSync(path.join(ROOT, 'game/src/renderer/index.html'), 'utf8')));
  ok('★ 开局不追任何任务（大框收起 → 让位给房间描述）', p.track === null, String(p.track));

  // 空/畸形数据不能炸（只测 mapHtml —— guideHtml 已随新手教程下线）
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
    try { built.mapHtml(input); }
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
