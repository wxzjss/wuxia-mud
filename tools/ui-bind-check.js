/* 最小 DOM stub：真跑 ui.js 的 bindModal / doCmd 面板拦截 / renderRoomActions
   用途：在没有浏览器的环境下验证前端交互绑定真的生效 */
const fs = require('fs');
const HTML = fs.readFileSync('game/src/renderer/index.html', 'utf8');
const UI = fs.readFileSync('game/src/renderer/js/ui.js', 'utf8');

const els = {};
let focused = false;
function mkEl(tag) {
  const el = {
    tagName: tag, id: '', className: '', style: {}, children: [], value: '',
    textContent: '', disabled: false, title: '', __attrs: {}, __html: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { const on = (f === undefined) ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) {
      this.children.push(c);
      /* 模拟真实 DOM：appendChild 后父元素的 innerHTML 会含子元素 */
      const inner = (c && c.__html != null && c.__html !== '') ? c.__html : ((c && c.textContent) || '');
      this.__html += inner;
      return c;
    },
    insertBefore(c) { return this.appendChild(c); },
    querySelectorAll() { return []; },
    querySelector() { return null; },
    setAttribute(k, v) { this.__attrs[k] = v; this[k] = v; },
    getAttribute(k) { return this.__attrs[k] !== undefined ? this.__attrs[k] : null; },
    focus() { focused = true; }, blur() { }, addEventListener() { }
  };
  /* innerHTML 用 getter/setter 桥接到 __html */
  Object.defineProperty(el, 'innerHTML', {
    get() { return this.__html; },
    set(v) { this.__html = String(v); this.children = []; },
    enumerable: true, configurable: true
  });
  return el;
}

global.document = {
  getElementById(id) { if (!els[id]) { els[id] = mkEl('div'); els[id].id = id; } return els[id]; },
  createElement: t => mkEl(t),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener() { },
  documentElement: { style: {} },
  body: { classList: mkEl('body').classList }
};
global.window = global;

const S = { busy: false, view: null, settings: { font: 100, anim: true, autosave: true, narrow: false }, screen: 'game' };

const api = { exec: async () => ({ ok: true }), view: async () => ({ view: {} }), combat: async () => ({}), menu: async () => ({}) };
const util = {
  esc: s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
  pct: () => 0, fmtTime: () => ''
};
global.WX = { S, api, util, bus: { emit() { } } };

/* doCmd 内部走的是闭包里的 panel()，覆盖 WXUI.panel 没用；
   改成观测 api.view(panelName) —— panel() 一定会调它。
   顺便让 view 带上一个 npc，好让社交面板真跑得起来。 */
const STUB_NPC = {
  id: 'npcv_001', name: '云中鹤', title: '剑客', level: 22, hostile: false,
  favor: 42, favorTier: '友善', favorColor: '#2f7a4a', tag: 'swordsman', tagName: '剑客',
  gender: 'male', canQingjiao: true, canQiecuo: true, canSteal: true,
  likes: [{ id: 'painting', name: '名画' }], hasHome: true, homeName: '云中鹤的家',
};
api.view = async (p) => { panelCalls.push(p); return { view: { npcs: [STUB_NPC], player: {} } }; };

eval(UI);
const U = global.WXUI;

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  /* ① 弹窗 ✕ */
  console.log('\n① 弹窗关闭');
  U.bindModal();
  const closeBtn = els['modal-close'], mask = els['modal-mask'];
  ok('#modal-close 拿到了 onclick', typeof closeBtn.onclick === 'function');
  mask.classList.remove('hidden');
  closeBtn.onclick();
  ok('点 ✕ 关掉弹窗', mask.classList.contains('hidden'));
  mask.classList.remove('hidden');
  mask.onclick({ target: mask });
  ok('点遮罩空白关掉弹窗', mask.classList.contains('hidden'));
  mask.classList.remove('hidden');
  const inner = mkEl('div');
  mask.onclick({ target: inner });
  ok('点弹窗内部不关（防误关）', !mask.classList.contains('hidden'));

  /* ② 输入框面板指令 */
  console.log('\n② 输入框面板指令拦截');
  const cases = [
    ['地图', 'map'], ['map', 'map'], ['查看地图', 'map'], ['舆图', 'map'],
    ['背包', 'inventory'], ['i', 'inventory'], ['行囊', 'inventory'],
    ['状态', 'score'], ['sc', 'score'], ['score', 'score'],
    ['武学', 'skills'], ['任务', 'quests'], ['属性', 'attr'],
    ['门派', 'sect'], ['装备', 'equipment'], ['帮助', 'help'],
    /* 🔴 2026-10-12 主人「新手教程剧情全删」：面板别名表里
       「指引 / 新手教程 / 引导 → guide」整路摘掉，不再进 PANEL_CMDS。
       所以这一条从「期望 guide」改成「**不该**被前端拦成面板」（交给服务端当普通指令）。 */
    ['指引', null],
  ];
  const bad = [];
  for (const [cmd, exp] of cases) {
    panelCalls = [];
    await U.doCmd(cmd);
    /* exp === null ⇒ 期望「前端不拦」：panelCalls 应为空（或首项不等于任何面板名） */
    if (exp === null) {
      if (panelCalls.length) bad.push(cmd + '→' + panelCalls[0] + '(期望不拦)');
    } else if (panelCalls[0] !== exp) bad.push(cmd + '→' + panelCalls[0] + '(期望 ' + exp + ')');
  }
  ok('全部面板指令正确打开对应面板（含「指引」已不再被拦）', bad.length === 0, bad.length ? bad.join(', ') : cases.length + '/' + cases.length);

  panelCalls = [];
  await U.doCmd('look');
  ok('普通指令 look 不被拦截', panelCalls.length === 0);
  await U.doCmd('n');
  ok('移动指令 n 不被拦截', panelCalls.length === 0);

  /* ③ renderRoomActions 真跑 */
  console.log('\n③ 房间可交互物件');
  const v = {
    room: { name: '铁匠铺', region: '江南', env: '春 · 辰时 · 晴', desc: '炉火正旺。', exports: [], exits: [{ dir: 'e', name: '东', toName: '江南大街' }] },
    roomActions: [
      { name: '打铁', cmd: '打铁', ok: true, reason: '' },
      { name: '出海', cmd: '出海', ok: false, reason: '需 100 文' }
    ]
  };
  const execd = [];
  const prevDoCmd = U.doCmd;
  U.doCmd = c => execd.push(c);
  U.renderRoom(v);
  U.doCmd = prevDoCmd;
  const box = els['room-actions'];
  ok('生成了交互物按钮', /ra-btn/.test(box.innerHTML), box.innerHTML.slice(0, 80));
  ok('可做的动作不带 ra-locked', /ra-btn"[^>]*>打铁/.test(box.innerHTML));
  ok('条件不足的动作带 ra-locked', /ra-locked/.test(box.innerHTML));
  ok('房间名/区域/环境已正确渲染',
    els['room-name'].textContent === '铁匠铺' && els['room-region'].textContent === '· 江南',
    els['room-name'].textContent + ' | ' + els['room-region'].textContent + ' | ' + els['room-env'].textContent);

  /* ④ 社交 UI：场景卡好感徽标 / NPC 菜单 / 人情往来面板
        ⚠ 这组必须「真执行渲染函数」，光看接口字段抓不到渲染层崩溃 */
  console.log('\n④ 社交界面（好感 / NPC 菜单 / 人情往来）');

  const npc = STUB_NPC;
  U.renderScene({
    room: { name: '东市大街', region: '东市', env: '春 · 午时 · 晴' },
    npcs: [npc], items: [], quests: [], guide: null,
  });
  const npcBox = els['scene-npcs'];
  /* ⚠ stub 的 appendChild 只塞 children、不拼 innerHTML，
     所以卡片内容要读 children[0].innerHTML（真实 DOM 里两者等价） */
  const card = npcBox.children[0];
  const cardHtml = card ? card.innerHTML : '';
  ok('NPC 卡片渲染出好感徽标', /tag-favor/.test(cardHtml), (cardHtml.match(/tag-favor[^<]*<\/i>/) || [''])[0]);
  ok('好感徽标带后端给的颜色', /color:#2f7a4a/.test(cardHtml));
  ok('好感徽标带档位与数值', /友善 \+42/.test(cardHtml));
  ok('NPC 卡片渲染出身份标签', /tag-role[^>]*>剑客/.test(cardHtml));

  /* openNpcMenu：菜单是闭包内部函数，不导出。
     走真实路径触发 —— renderScene 里给每张 NPC 卡片的 onclick 就是它。 */
  const npcCard = npcBox.children[0];
  ok('NPC 卡片绑定了点击处理', !!(npcCard && typeof npcCard.onclick === 'function'));
  const cl = document.getElementById('choices-list');   /* 惰性创建，必须先取 */
  if (npcCard && npcCard.onclick) npcCard.onclick();   /* = openNpcMenu(npc) */
  const menuHtml = cl.innerHTML + '|' + els['choices-title'].textContent;
  ok('NPC 菜单有「送他东西」入口', /送他东西/.test(menuHtml), els['choices-title'].textContent);
  ok('NPC 菜单有「给他银钱」入口', /给他银钱/.test(menuHtml));
  ok('NPC 菜单有「看人物关系」入口', /看人物关系/.test(menuHtml));
  ok('NPC 菜单有「请教武学」入口', /请教武学/.test(menuHtml));
  ok('NPC 菜单有「切磋武艺」入口', /切磋武艺/.test(menuHtml));
  ok('NPC 菜单有「伺机偷窃」入口', /伺机偷窃/.test(menuHtml));
  ok('NPC 菜单头部显示好感与身份', /友善/.test(cl.innerHTML) && /剑客/.test(cl.innerHTML) && /云中鹤的家/.test(cl.innerHTML));

  /* 条件性入口：不能请教 / 不能偷时不该出现 */
  U.renderScene({
    room: { name: '某处', region: '东市', env: '' },
    npcs: [Object.assign({}, npc, { canQingjiao: false, canSteal: false })],
    items: [], quests: [], guide: null,
  });
  els['scene-npcs'].children[0].onclick();
  ok('canQingjiao=false 时不显示「请教武学」', !/请教武学/.test(cl.innerHTML));
  ok('canSteal=false 时不显示「伺机偷窃」', !/伺机偷窃/.test(cl.innerHTML));
  ok('但「送他东西」始终在', /送他东西/.test(cl.innerHTML));

  /* 人情往来面板：真跑 socialHtml（走 WXUI.panel 公开入口） */
  await U.panel('social');
  const mb = els['modal-body'].innerHTML;
  ok('人情往来面板渲染出 NPC 行', /social-row/.test(mb), mb.slice(0, 60));
  ok('面板行含好感档与数值', /友善/.test(mb) && /\+42/.test(mb));
  ok('面板行含能力标签（可请教等）', /可请教/.test(mb));
  ok('面板行含喜爱之物', /喜 名画/.test(mb));
  ok('面板标题为「人情往来」', els['modal-title'].textContent === '人情往来');

  /* ⑤ 姻缘 · 结拜 · 家宅（第二批）
        ⚠ 同上：必须真执行渲染函数。字段名错配（如后端给 spouse、前端读 spouseName）
          在 JS 里是完全静默的 —— 只有断言能抓。 */
  console.log('\n⑤ 姻缘 / 结拜 / 家宅');

  /* 面板指令拦截 */
  const LOVE_CASES = [
    ['姻缘', 'love'], ['姻缘簿', 'love'], ['婚配', 'love'], ['义亲', 'love'],
    ['家宅', 'home'], ['房产', 'home'], ['我的家宅', 'home'],
  ];
  const bad2 = [];
  for (const [cmd, exp] of LOVE_CASES) {
    panelCalls = [];
    await U.doCmd(cmd);
    if (panelCalls[0] !== exp) bad2.push(cmd + '→' + panelCalls[0] + '(期望 ' + exp + ')');
  }
  ok('姻缘/家宅面板指令全部命中', bad2.length === 0, bad2.length ? bad2.join(', ') : LOVE_CASES.length + '/' + LOVE_CASES.length);

  /* 姻缘面板：给一份「已婚 + 结拜 + 伴侣居所」的 view */
  const LOVE_VIEW = {
    player: { name: '试剑', gender: 'male', age: 22 },
    npcs: [
      Object.assign({}, STUB_NPC, { marriedToMe: true, spouseName: '试剑', taken: true, canSwear: false }),
      { id: 'npcv_002', name: '苏景行', gender: 'male', age: 59, favor: 88,
        favorTier: '亲密', favorColor: '#1f6f9a', kinLabel: '义父', addressMe: '义子', canSwear: false },
      { id: 'npcv_003', name: '柳若', gender: 'female', age: 24, favor: 120,
        favorTier: '知己', favorColor: '#8a5ac2', taken: false, canSwear: true },
    ],
    marriage: {
      stage: 'done',
      spouse: { id: 'nv_yue', name: '岳灵珊', gender: 'female', age: 31, home: 'hm_nv_yue', homeName: '岳灵珊的家' },
      concubines: [{ id: 'nv_a', name: '小翠', gender: 'female', age: 19 }],
      bonds: [{ id: 'nv_b', name: '柳霜', gender: 'female', age: 26 }],
      plan: null,
    },
    kinship: {
      father: [{ id: 'npcv_002', name: '苏景行', label: '义父', gender: 'male', age: 59, favor: 88, dead: false }],
      mother: [], sons: [], daughters: [],
      brothers: [{ id: 'npcv_009', name: '张铁', label: '义兄', gender: 'male', age: 30, favor: 70, dead: false }],
      sisters: [], total: 2,
    },
    home: {
      hasHome: true,
      home: { id: 'hm_player_1', name: '试剑的家', tier: 'courtyard', capacity: 8, furniture: 2 },
      homes: [{ id: 'hm_player_1', name: '试剑的家', tier: 'courtyard', price: 3000 }],
      estateValue: 3600,
      partnerHome: { id: 'hm_nv_yue', name: '岳灵珊的家', of: '岳灵珊' },
      tiers: [
        { id: 'cottage', name: '一间小屋', price: 800, capacity: 3 },
        { id: 'courtyard', name: '一座小院', price: 3000, capacity: 8 },
      ],
    },
  };
  api.view = async (p) => { panelCalls.push(p); return { view: LOVE_VIEW }; };

  await U.panel('love');
  const lb = els['modal-body'].innerHTML;
  ok('姻缘面板标题正确', els['modal-title'].textContent === '姻缘 · 义亲', els['modal-title'].textContent);
  ok('渲染出正室卡片', /love-card spouse/.test(lb) && /岳灵珊/.test(lb));
  ok('正室卡片带居所', /岳灵珊的家/.test(lb));
  ok('渲染出妾室', /小翠/.test(lb));
  ok('渲染出结缘', /柳霜/.test(lb));
  ok('渲染出义亲分组「义父」', /义父/.test(lb) && /苏景行/.test(lb));
  ok('渲染出义兄弟分组', /义兄弟/.test(lb) && /张铁/.test(lb));
  ok('「此地可议」列出在场可结拜的人', /柳若/.test(lb) && /可结拜/.test(lb));
  ok('已配偶的人标「正室」而非「可结拜」', /marriage|正室/.test(lb));

  await U.panel('home');
  const hb = els['modal-body'].innerHTML;
  ok('家宅面板标题正确', els['modal-title'].textContent === '我的家宅', els['modal-title'].textContent);
  ok('渲染出名下产业', /试剑的家/.test(hb));
  ok('渲染出家当总值', /3600/.test(hb));
  ok('渲染出伴侣居所', /岳灵珊的家/.test(hb));
  ok('渲染出可置办宅子', /一间小屋/.test(hb) && /800/.test(hb));

  /* NPC 菜单的姻缘/结拜入口（异性 → 有提亲） */
  api.view = async () => ({ view: { npcs: [STUB_NPC], player: { gender: 'female' } } });
  U.renderScene({ room: { name: '某处', region: '', env: '' }, npcs: [STUB_NPC], items: [], quests: [], guide: null, player: { gender: 'female' } });
  els['scene-npcs'].children[0].onclick();
  const m1 = cl.innerHTML;
  ok('异性 NPC 菜单有「提亲议婚」', /提亲议婚/.test(m1));
  ok('NPC 菜单有「结缘」', /结缘/.test(m1));
  ok('NPC 菜单有「纳为妾室」', /纳为妾室/.test(m1));
  ok('NPC 菜单有「结拜」', /结拜/.test(m1));

  /* 同性 → 不给提亲（只给结缘） */
  U.renderScene({
    room: { name: '某处', region: '', env: '' },
    npcs: [Object.assign({}, STUB_NPC, { gender: 'male', canSwear: true })],
    items: [], quests: [], guide: null, player: { gender: 'male' },
  });
  els['scene-npcs'].children[0].onclick();
  ok('同性 NPC 隐藏「提亲议婚」', !/提亲议婚/.test(cl.innerHTML));
  ok('同性 NPC 仍有「结缘」', /结缘/.test(cl.innerHTML));

  /* 已是义亲 → 显示「割袍断义」而非「结拜」 */
  U.renderScene({
    room: { name: '某处', region: '', env: '' },
    npcs: [Object.assign({}, STUB_NPC, { kinLabel: '义父', canSwear: false })],
    items: [], quests: [], guide: null, player: { gender: 'male' },
  });
  els['scene-npcs'].children[0].onclick();
  ok('已结拜 → 显示「割袍断义」', /割袍断义/.test(cl.innerHTML));
  ok('已结拜 → 不再显示「结拜」', !/与 TA 结拜/.test(cl.innerHTML));
  ok('菜单头部显示「你的义父」', /你的义父/.test(cl.innerHTML));

  /* ⑥ 状态面板：字段名错配回归。
        ⚠ 属性重制后 playerBrief 字段改成 maxHp/maxMp/realm（删了 level/exp/expNeed），
        scoreHtml 一度还读旧字段名（hpMax/mpMax/expNeed/birthName）→ 整排 undefined 乱码。 */
  console.log('\n⑥ 状态面板字段');
  const SCORE_VIEW = { player: {
    name: '试剑', title: '少侠', gender: 'male', realm: '初窥门径',
    sectName: '华山派', rankName: '弟子', age: 22, kills: 5,
    hp: 50, maxHp: 68, mp: 10, maxMp: 20, food: 80, maxFood: 100, water: 70, maxWater: 100,
    potential: 200, money: 150, karma: 0,
    /* 真实结构是「键→数值」对象（门派名/恶名等动态键），不是数字 */
    reputation: { '华山派': 30, '恶名': 5 },
  } };
  const prevView6 = api.view;
  api.view = async () => ({ view: SCORE_VIEW });
  await U.panel('score');
  api.view = prevView6;
  const mb2 = els['modal-body'].innerHTML;
  ok('状态面板不出现 undefined', !/undefined/.test(mb2), mb2.slice(0, 140));
  ok('状态面板标题为「状态一览」', els['modal-title'].textContent === '状态一览');
  ok('气血显示正确数值', /气血/.test(mb2) && /50 \/ 68/.test(mb2));
  ok('内力显示正确数值', /内力/.test(mb2) && /10 \/ 20/.test(mb2));
  ok('声望渲染成可读文本（不是 [object Object]）',
    /声望/.test(mb2) && !/object Object/.test(mb2) && /华山派 30/.test(mb2), mb2.match(/声望[^<]*<[^>]*>([^<]*)</)?.[1]);
  ok('显示境界而非等级', /境界/.test(mb2) && /初窥门径/.test(mb2) && !/等级/.test(mb2));
  ok('显示饱食饮水（生存）', /饱食/.test(mb2) && /80 \/ 100/.test(mb2) && /饮水/.test(mb2));

  /* ⑤ 布局去重：屏幕只能有一处「此地可做」，方向按钮归「出口」
       背景：主人报「屏幕上有两个『此地可做』，第一个上面还有一排东南西北方向按钮」。
       改法：房间面板删掉 #exits / #room-actions，方向按钮排跟日志的「出口」行走。
       ⚠️ 本 stub 的 getElementById 会自动造元素，所以真 HTML 里删没删必须查源码。 */
  console.log('\n⑤ 布局去重（此地可做唯一 + 出口按钮归位）。');
  ok('index.html 已删掉房间面板的 #exits 块', !/id="exits"/.test(HTML));
  ok('index.html 已删掉房间面板的 #room-actions 块', !/id="room-actions"/.test(HTML));
  ok('index.html 仍保留 #log（出口行走这里）', /id="log"/.test(HTML));
  /* 不许再有「临时造一个 room-actions 块插进 DOM」的旧逻辑 —— 那正是第二处的来源 */
  ok('renderRoomActions 缺 DOM 时直接 return，不再动态造块',
    /function renderRoomActions[\s\S]{0,200}if \(!box\) return;/.test(UI)
    && !/box\.id = 'room-actions'/.test(UI));
  ok('🩸 方向按钮排 exitBtnRowHtml 已删除（九宫格就是全部）',
    !/function exitBtnRowHtml/.test(UI) && !/exit-btns/.test(UI));
  ok('appendLog 把 exitMap 传给渲染层', /item\.exitMap = l\.exitMap/.test(UI));
  ok('paintLog 给 .exit-inline 绑了点击', /\.exit-inline/.test(UI));
  ok('🩸 数字键 1-9 改取最后一个 .exit-map 里的 .exit-inline',
    /\.exit-map/.test(UI) && /host\.querySelectorAll\('\.exit-inline'\)/.test(UI));
  /* 真跑一遍渲染，确认九宫格真的出来了且带 data-dir */
  const logBox = els['log'];
  const prevDoCmd2 = U.doCmd;
  U.doCmd = () => { };
  const lines = [
    { kind: 'action', text: '此地可做：住店、告示。' },
    {
      kind: 'exits', text: '出口：西·江南城·长街　北·任停的家。',
      exits: ['w', 'n'],
      exitMap: { w: { dir: 'w', name: '江南城·长街' }, n: { dir: 'n', name: '任停的家' } },
      exitBtns: [
        { dir: 'w', name: '西', toName: '江南城·长街', locked: false },
        { dir: 'n', name: '北', toName: '任停的家', locked: false },
      ],
      roomName: '悦来客栈',
    },
  ];
  U.appendLog(lines);
  U.doCmd = prevDoCmd2;
  const lb2 = logBox.innerHTML;
  ok('出口行渲染出九宫格', /class="em-grid"/.test(lb2), lb2.slice(-260));
  ok('🩸 出口行不再有「出口：」前缀文本',
    !/出口：/.test(lb2.replace(/&[a-z]+;/g, '')), lb2.slice(-200));
  ok('🩸 出口行不再渲染那排重复按钮',
    !/exit-btns/.test(lb2) && !/class="exit-btn/.test(lb2), lb2.slice(-260));
  ok('按钮带 data-dir（能直接发方向指令）',
    /data-dir="w"/.test(lb2) && /data-dir="n"/.test(lb2), lb2.slice(-260));
  ok('按钮上写得出目标地名', /江南城·长街/.test(lb2));
  ok('房间面板不再无条件画这两块（只在 DOM 还在时兜底）',
    /if \(\$\('exits'\)\) renderExitButtons/.test(UI)
    && /if \(\$\('room-actions'\)\) renderRoomActions/.test(UI));
  ok('全局只有一处「此地可做」标签（room-actions 块已从 HTML 移除）',
    !/id="room-actions"/.test(HTML) && !/insertBefore\(box, exits\.nextSibling\)/.test(UI));

  /* ⑦ 吐纳 / 双修「点别的按钮就退出」（主人 2026-10-11）
        ⚠️ 本地面板指令**不经过服务端**（`panelForCmd` 直接在前端开面板），
           所以「点任何别的按钮都退出这个状态」这条，前端得自己补一趟 ——
           必须真跑一次 doCmd 才验得到（静态扫源码不算数）。 */
  console.log('\n⑦ 吐纳 / 双修中开面板先退出');
  const execdBusy = [];
  const prevExec2 = api.exec;
  const prevView7 = api.view;
  api.exec = async (c) => { execdBusy.push(c); return { ok: true, lines: [], view: { player: { name: '试剑' } } }; };
  /* ⚠️ 前面的组会把 api.view 换成「不记录 panelCalls」的桩，所以要自带一个 */
  api.view = async (p) => { panelCalls.push(p); return { view: { npcs: [STUB_NPC], player: {} } }; };

  S.view = { player: { busy: { kind: 'tune', round: 1 } } };
  panelCalls = [];
  await U.doCmd('背包');
  ok('★ 吐纳中点「背包」先走一趟服务端退出', execdBusy[0] === '收功', JSON.stringify(execdBusy));
  ok('★ 而且背包照常打开（不是被拒绝）', panelCalls[0] === 'inventory', JSON.stringify(panelCalls));

  execdBusy.length = 0; panelCalls = [];
  S.view = { player: { busy: { kind: 'dual', name: '云中鹤', round: 2, rounds: 4 } } };
  await U.doCmd('地图');
  ok('★ 双修中点「地图」也先退出', execdBusy[0] === '收功', JSON.stringify(execdBusy));
  ok('★ 地图照常打开', panelCalls[0] === 'map', JSON.stringify(panelCalls));

  execdBusy.length = 0; panelCalls = [];
  S.view = { player: {} };
  await U.doCmd('状态');
  ok('没在吐纳/双修时，开面板不该多发那一趟退出', execdBusy.length === 0, JSON.stringify(execdBusy));
  ok('状态面板照常打开', panelCalls[0] === 'score', JSON.stringify(panelCalls));

  execdBusy.length = 0; panelCalls = [];
  S.view = { player: { busy: { kind: 'tune' } } };
  await U.doCmd('吐纳');
  ok('「吐纳」不是面板指令，交给服务端（前端不该吞掉它）',
    panelCalls.length === 0 && execdBusy[0] === '吐纳', JSON.stringify(execdBusy));

  api.exec = prevExec2;
  api.view = prevView7;
  S.view = null;

  console.log('\n' + '='.repeat(42));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(42));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('异常:', e.stack); process.exit(1); });
