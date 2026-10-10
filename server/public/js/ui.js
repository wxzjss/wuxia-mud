/* ============================================================
 *  武侠行 · UI 渲染层
 *  负责：屏幕切换、状态栏、房间、日志、场景栏、战斗、弹窗、toast
 * ============================================================ */
(function (global) {
  'use strict';

  const { S, api, util, bus } = global.WX;
  const $ = id => document.getElementById(id);
  const esc = util.esc;

  /* ============================================================
   *  屏幕切换
   * ============================================================ */
  const SCREENS = ['start', 'create', 'game', 'modmaker', 'modcenter', 'market', 'doc'];

  function show(name) {
    if (SCREENS.indexOf(name) < 0) name = 'start';
    S.screen = name;
    SCREENS.forEach(s => {
      const el = $('screen-' + s);
      if (el) el.classList.toggle('active', s === name);
    });
    bus.emit('screen', name);
  }

  /* ============================================================
   *  Toast
   * ============================================================ */
  let toastTimer = null;
  function toast(msg, type, ms) {
    const t = $('toast');
    if (!t) return;
    t.className = 'toast ' + (type || 'info');
    t.innerHTML = esc(msg).replace(/\n/g, '<br>');
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms || 2600);
  }

  /* ============================================================
   *  通用弹窗
   * ============================================================ */
  function modal(title, bodyHtml, footHtml) {
    $('modal-title').textContent = title || '';
    $('modal-body').innerHTML = bodyHtml || '';
    $('modal-foot').innerHTML = footHtml || '';
    $('modal-mask').classList.remove('hidden');
  }
  function closeModal() { $('modal-mask').classList.add('hidden'); }

  /* 弹窗的关闭按钮 / 点遮罩空白处关闭 —— 之前 ✕ 没人绑，点了当然没反应 */
  function bindModal() {
    const btn = $('modal-close');
    if (btn) btn.onclick = () => closeModal();
    const mask = $('modal-mask');
    if (mask) {
      mask.onclick = e => { if (e.target === mask) closeModal(); };
    }
    const cMask = $('choices-mask');
    if (cMask) {
      cMask.onclick = e => { if (e.target === cMask) closeChoices(); };
    }
  }

  function closeChoices() { $('choices-mask').classList.add('hidden'); }

  function choices(title, list, onPick, headHtml) {
    $('choices-title').textContent = title || '请选择';
    const box = $('choices-list');
    box.innerHTML = '';
    /* 可选的头部摘要（NPC 菜单用来显示好感/身份/住处） */
    if (headHtml) {
      const hd = document.createElement('div');
      hd.className = 'choices-head';
      hd.innerHTML = headHtml;
      box.appendChild(hd);
    }
    (list || []).forEach((it, i) => {
      const b = document.createElement('button');
      b.className = 'choice-btn';
      b.innerHTML = '<span class="c-idx">' + (i + 1) + '</span><span class="c-label">' + esc(it.label || it.text || '') +
        '</span>' + (it.hint ? '<span class="c-hint">' + esc(it.hint) + '</span>' : '');
      b.onclick = () => { closeChoices(); onPick && onPick(it, i); };
      box.appendChild(b);
    });
    $('choices-mask').classList.remove('hidden');
  }

  /* 简易确认框（Promise） */
  function confirmBox(title, text, okText) {
    return new Promise(resolve => {
      modal(title, '<div class="modal-text">' + esc(text) + '</div>',
        '<button class="btn-ink" id="cf-no">取 消</button>' +
        '<button class="btn-ink primary" id="cf-yes">' + esc(okText || '确 定') + '</button>');
      $('cf-no').onclick = () => { closeModal(); resolve(false); };
      $('cf-yes').onclick = () => { closeModal(); resolve(true); };
    });
  }

  /* ============================================================
   *  状态栏
   * ============================================================ */
  /* 数值显示：最多留一位小数（主人报的「饱食度与饮水小数点不要超过一位」）。
     生存系统内部按小数扣（`p.food -= 0.5` / 分钟回复按比例加），原值常有
     99.9187 这种四位小数。向下取整到一位（99.9187 → 99.9）：
       · 既满足「不超过一位小数」，
       · 又不会像四舍五入那样把 99.96 显示成满值 100.0（没满却写满，等于谎报）。
     整数原样返回（100 → 100，不补 .0）。 */
  function fmt1(n) {
    const v = Number(n);
    if (!isFinite(v)) return 0;
    return Math.floor(v * 10) / 10;
  }
  /* 顶栏 / 面板都要用，单一入口，别各写各的（否则又会出现「一处取整一处不取」）。 */

  function renderTopbar(p) {
    if (!p) return;
    $('tb-name').textContent = p.name || '侠客';
    $('tb-sect').textContent = p.sectName ? ('【' + p.sectName + (p.rankName ? ' · ' + p.rankName : '') + '】') : '【无门无派】';
    $('tb-title').textContent = p.title ? ('「' + p.title + '」') : '';

    const hp = p.hp || 0, hpMax = p.maxHp || 1;
    const mp = p.mp || 0, mpMax = p.maxMp || 1;
    $('bar-hp').style.width = util.pct(hp, hpMax) + '%';
    $('bar-mp').style.width = util.pct(mp, mpMax) + '%';
    $('txt-hp').textContent = '气血 ' + hp + '/' + hpMax;
    $('txt-mp').textContent = '内力 ' + mp + '/' + mpMax;

    /* 删等级系统后，经验条改为显示「武学境界」（玩家强弱只看武学功法等级） */
    const realm = p.realm || '不通武艺';
    $('bar-exp').style.width = '100%';
    $('txt-exp').textContent = '境界 · ' + realm;
    $('tb-money').textContent = p.moneyText || (p.money + ' 文');
    $('tb-time').textContent = (p.timeText || '');

    /* 饱食 / 饮水（第三批：生存）
       ⚠️ 一律走 fmt1()：生存系统按小数扣（`p.food -= 0.5` 之类），
       直接拼原值会在顶栏出现「饱食 99.9187/100」这种数字 —— 又长又丑，
       手机上还会被挤断成「饱和100」。（主理人真机截图发现）
       上限也过一遍 fmt1（maxFood 可能是 100.0 / 100.5 这类数据）。 */
    const food = fmt1(p.food), foodMax = fmt1(p.maxFood || 100);
    const water = fmt1(p.water), waterMax = fmt1(p.maxWater || 100);
    const barFood = $('bar-food'), barWater = $('bar-water');
    if (barFood) {
      barFood.style.width = util.pct(food, foodMax) + '%';
      barFood.className = 'fill' + (p.starving ? ' critical' : (food < 25 ? ' low' : ''));
      $('txt-food').textContent = '饱食 ' + food + '/' + foodMax;
    }
    if (barWater) {
      barWater.style.width = util.pct(water, waterMax) + '%';
      barWater.className = 'fill' + (p.parched ? ' critical' : (water < 25 ? ' low' : ''));
      $('txt-water').textContent = '饮水 ' + water + '/' + waterMax;
    }
    /* 青楼卖身标记 */
    const soldEl = $('tb-sold');
    if (soldEl) {
      if (p.prostitution && p.prostitution.sold) {
        soldEl.textContent = '【青楼中人】';
        soldEl.style.display = '';
      } else {
        soldEl.style.display = 'none';
      }
    }
  }

  /* ============================================================
   *  房间面板
   * ============================================================ */
  function renderRoom(v) {
    const room = v.room || {};
    $('room-name').textContent = room.name || '未知之地';
    /* 后端给的是 room.region（区域名），不是 regionName */
    $('room-region').textContent = room.region ? ('· ' + room.region) : '';
    $('room-env').textContent = room.env || '';

    let desc = room.desc || '';
    $('room-desc').innerHTML = esc(desc).replace(/\n/g, '<br>');

    /* ⚠️ 出口按钮 + 「此地可做」按钮**不再**画在房间面板里了。
       以前这两块（#exits / #room-actions）挤在房间描述下面，跟日志流里
       已经有的「出口：…」行、「此地可做：…」行完全重复——主人报「屏幕上有
       两个『此地可做』」。现在统一：
         · 方向按钮排 → 跟日志的「出口」行走（renderLogText 里的 exitBtns）
         · 可做的事   → 日志的「此地可做」行（本来就是可点的 hl 高亮）
       这里只保留「最近一次的」两个块做兜底（万一有人跑老 HTML / 老 view 结构），
       DOM 里没有就整体跳过，绝不再插 DOM 造成第二处。 */
    if ($('exits')) renderExitButtons(v);
    if ($('room-actions')) renderRoomActions(v);
  }

  /* 出口方向按钮（保底路径：只在 HTML 里仍有 #exits 时才画） */
  function renderExitButtons(v) {
    const room = v.room || {};
    const ex = (v && v.exits) || (room && room.exits) || [];
    const box = $('exits');
    box.innerHTML = '';
    ex.forEach(e => {
      const b = document.createElement('button');
      b.className = 'exit-btn' + (e.locked ? ' locked' : '');
      b.setAttribute('data-dir', e.dir || '');
      b.innerHTML = esc(e.name || e.dir) + (e.toName ? '<i>' + esc(e.toName) + '</i>' : '');
      b.title = e.locked ? ('通往 ' + e.toName + '（尚未满足条件）') : ('前往 ' + e.toName);
      b.onclick = () => doCmd(e.dir, { fromButton: true });
      box.appendChild(b);
    });
    if (!ex.length) box.innerHTML = '<span class="no-exit">此处无路可走</span>';
  }

  /* 「此地可做」按钮（保底路径：只在 HTML 里仍有 #room-actions 时才画） */
  function renderRoomActions(v) {
    let box = $('room-actions');
    if (!box) return;   /* DOM 里没有就什么都不做 —— 绝不临时插一个新块 */
    const acts = v.roomActions || [];
    if (!acts.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
    box.style.display = '';
    box.innerHTML = '<span class="ra-label">此地可做：</span>' +
      acts.map((a, i) =>
        '<button class="ra-btn' + (a.ok ? '' : ' ra-locked') + '" data-ra="' + i + '"' +
        ' title="' + esc(a.ok ? ('点击执行：' + a.cmd) : (a.reason || '暂时不行')) + '">' +
        esc(a.name) + '</button>').join('') +
      '<span class="ra-hint" id="ra-hint"></span>';

    box.querySelectorAll('.ra-btn').forEach(b => {
      b.onclick = () => {
        const a = acts[+b.getAttribute('data-ra')];
        if (!a) return;
        if (!a.ok) {
          /* 条件不足 → 屏幕上一段灰色提示（像「出口」说明那样的灰字） */
          const hint = $('ra-hint');
          if (hint) hint.textContent = '「' + a.name + '」' + (a.reason ? '：' + a.reason : '现在做不了');
          return;
        }
        doCmd(a.cmd, { fromButton: true });
      };
    });
  }

  /* ============================================================
   *  日志
   * ============================================================ */
  const MAX_LOG = 600;
  let logLines = [];

  function appendLog(lines) {
    if (!lines) return;
    const arr = Array.isArray(lines) ? lines : [lines];
    arr.forEach(l => {
      if (!l) return;
      if (typeof l === 'string') { logLines.push({ type: 'plain', text: l }); return; }
      /* 后端给的是 kind（如 warn/npcs/items），前端按 type 渲染 —— 这里统一归一化，
         否则所有日志都会退化成 plain，样式和可交互高亮都不会生效。 */
      const type = l.type || l.kind || 'plain';
      let text = l.text || '';
      if (l.repeat && l.repeat > 1) text += '（×' + l.repeat + '）';
      const item = { type, text };
      if (l.hl && l.hl.length) item.hl = l.hl;
      if (l.exits) item.exits = l.exits;
      /* exitMap / exitBtns：出口行的方向按钮排（跟着「出口」行走） */
      if (l.exitMap) item.exitMap = l.exitMap;
      if (l.exitBtns && l.exitBtns.length) item.exitBtns = l.exitBtns;
      if (l.roomName) item.roomName = l.roomName;
      logLines.push(item);
    });
    if (logLines.length > MAX_LOG) logLines = logLines.slice(logLines.length - MAX_LOG);
    paintLog();
  }

  /* 日志里 hl 的完整信息（含 actions 数组，不能塞进 DOM，用索引关联） */
  let _hlRegistry = [];

  function paintLog(scroll) {
    const el = $('log');
    _hlRegistry = [];
    el.innerHTML = logLines.map((l, i) => {
      const cls = 'log-line ' + (l.type || 'plain');
      return '<div class="' + cls + '" data-li="' + i + '">' + renderLogText(l, _hlRegistry) + '</div>';
    }).join('');
    /* 日志里高亮的可交互名词 -> 弹出「能做什么」的中文菜单 */
    el.querySelectorAll('.hl').forEach(b => {
      b.onclick = () => {
        const h = _hlRegistry[+b.getAttribute('data-hl')];
        if (h) openInteractMenu(h);
      };
    });
    /* 出口方向可点击：点「北」就走一格 */
    el.querySelectorAll('.exit-inline').forEach(b => {
      b.onclick = () => doCmd(b.getAttribute('data-dir'), { fromButton: true });
    });
    /* 「出口」行下方那排按钮**已删**（主人要求：九宫格就是全部，别再 redundancy） */
    if (scroll !== false) el.scrollTop = el.scrollHeight;
  }

  /* 出口方位图：**3×3 CSS Grid**，不再用手工全角空格做ASCII 对齐。
     ⚠️ 旧写法是 ASCII 画（`　　　` + `──` + `↑↓`），可中心房间名长度不固定，
       于是「北/南」永远跟中心点对不齐；斜角（ne/nw/se/sw）更只是拼在最后一行，
       压根没落在四角。改成 grid 后中心格固定居中，八个方向各占一格，天生对齐。 */
  function exitMapHtml(exitMap, roomName) {
    const CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下', ne: '东北', nw: '西北', se: '东南', sw: '西南', in: '内', out: '外' };
    const g = d => exitMap[d] || null;
    const btn = (dir, name) =>
      '<button class="exit-inline em-' + dir + '" data-dir="' + esc(dir) + '" title="向' + (CN[dir] || dir) + '走，前往「' + esc(name) + '」">' + esc(name) + '</button>';

    /* 九宫格：nw n ne ／ w 中心 e ／ sw s se */
    const slot = dir => {
      const m = g(dir);
      return '<span class="ec">' + (m ? btn(dir, m.name) : '') + '</span>';
    };
    const cells = slot('nw') + slot('n') + slot('ne')
      + slot('w')
      + '<span class="ec em-core"><b class="cur">' + esc(roomName || '这里') + '</b></span>'
      + slot('e')
      + slot('sw') + slot('s') + slot('se');

    /* 上/下/内/外 不是八方位，单独一行附在下面（不占九宫格） */
    const vert = [];
    for (const d of ['u', 'd', 'in', 'out']) {
      const m = g(d);
      if (m) vert.push(btn(d, m.name));
    }

    return '<span class="exit-map">' +
      '<span class="em-grid">' + cells + '</span>' +
      (vert.length ? '<span class="em-vert">' + vert.join('') + '</span>' : '') +
      '</span>';
  }

  /* 日志文本渲染：
     - l.hl = [{text, type, actions:[{label, cmd, hint}]}] → 名词高亮，点击弹菜单
     - l.exitMap = {dir:{dir,to,name}} → 出口 ASCII 方位图（可点击前往）
     - l.exits = [dir,...] → 把「北/南…」方向文字变成可点按钮（保底）
     reg 是 hl 注册表（传进来，好让测试能独立调用） */
  function renderLogText(l, reg) {
    let raw = esc(l.text || '');

    /* ① 可交互名词 */
    const hls = l.hl;
    if (hls && hls.length) {
      hls.forEach(h => {
        if (!h.text) return;
        const needle = esc(h.text);
        const idx = raw.indexOf(needle);
        if (idx < 0) return;
        const hi = reg ? reg.length : 0;
        if (reg) reg.push(h);
        const tag = '<button class="hl" data-hl="' + hi + '" title="点击查看能做什么">' + needle + '</button>';
        raw = raw.slice(0, idx) + tag + raw.slice(idx + needle.length);
      });
    }

    /* ② 出口：有 exitMap 就只渲染九宫格方位图。
          ⚠️ 主人口令：① 不要「出口：」前缀文本 ② 不要九宫格下面那排重复按钮。
          以前这两样都在，是同一批出口显示两遍。 */
    if (l.exitMap && Object.keys(l.exitMap).length) {
      return exitMapHtml(l.exitMap, l.roomName);
    }

    /* ③ 出口方向（无 exitMap 时的保底）：按方向名长度降序替换，避免「北」误伤「东北」 */
    if (l.exits && l.exits.length) {
      const CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下', ne: '东北', nw: '西北', se: '东南', sw: '西南', in: '内', out: '外' };
      const ordered = l.exits.slice().sort((a, b) => ((CN[b] || b).length - (CN[a] || a).length));
      ordered.forEach(d => {
        const cn = CN[d] || d;
        if (raw.indexOf(cn) < 0) return;
        raw = raw.replace(cn, '<button class="exit-inline" data-dir="' + esc(d) + '" title="向' + cn + '走">' + cn + '</button>');
      });
    }
    return raw;
  }

  /* 点「这里有」的名词 → 弹一个「对它做什么」的中文菜单（类似 NPC 菜单） */
  function openInteractMenu(h) {
    const name = h && h.text || '';
    const acts = (h && h.actions) || [];
    if (!acts.length) return;
    /* 只有一个动作就直接执行，别弹窗 */
    if (acts.length === 1) {
      doCmd(acts[0].cmd, { fromButton: true });
      return;
    }
    choices('对「' + name + '」做什么', acts.map(a => ({
      label: a.label || a.cmd,
      hint: a.hint || '',
      cmd: a.cmd,
    })), it => {
      if (it.cmd) doCmd(it.cmd, { fromButton: true });
    });
  }

  function clearLog() { logLines = []; paintLog(); }

  /* ============================================================
   *  右侧场景栏
   * ============================================================ */
  function renderScene(v) {
    /* 缓存当前场景 view，供 openNpcMenu 读玩家性别等 */
    if (v && v.player) S.view = v;
    renderGuide(v);
    maybeShowIntro(v);

    const npcBox = $('scene-npcs');
    npcBox.innerHTML = '';
    (v.npcs || []).forEach(n => {
      const d = document.createElement('button');
      d.className = 'scene-item npc' + (n.hostile ? ' hostile' : '');
      /* 好感度色点 + 身份标签：颜色由后端 favorColor 给，前端不自己判档 */
      const favorChip = (n.favor != null && n.favorTier)
        ? '<i class="tag-favor" style="color:' + esc(n.favorColor || '#6a6a6a') + '">' +
          esc(n.favorTier) + ' ' + (n.favor > 0 ? '+' : '') + n.favor + '</i>'
        : '';
      const tagChip = n.tagName ? '<i class="tag-role">' + esc(n.tagName) + '</i>' : '';
      d.innerHTML =
        '<span class="si-name">' + esc(n.name) + (n.hostile ? ' <i class="tag-hostile">敌</i>' : '') + tagChip + '</span>' +
        '<span class="si-sub">' + esc(n.title || (n.level ? n.level + '级' : '')) + favorChip + '</span>';
      d.onclick = () => openNpcMenu(n);
      npcBox.appendChild(d);
    });
    if (!(v.npcs || []).length) npcBox.innerHTML = '<div class="scene-empty">四下无人</div>';

    const itemBox = $('scene-items');
    itemBox.innerHTML = '';
    /* 后端字段是顶层 v.groundItems（{ uid, itemId, name, count }），不是 v.items */
    const groundList = (v && v.groundItems) || (v && v.items) || [];
    groundList.forEach(it => {
      const d = document.createElement('button');
      d.className = 'scene-item item';
      d.innerHTML =
        '<span class="si-name">' + esc(it.name) + (it.count > 1 ? ' <i class="tag-count">×' + it.count + '</i>' : '') + '</span>' +
        '<span class="si-sub">' + esc(it.typeName || (it.itemId ? '物品' : '')) + '</span>';
      d.onclick = () => doCmd('get ' + (it.name || it.itemId), { fromButton: true });
      itemBox.appendChild(d);
    });
    if (!groundList.length) itemBox.innerHTML = '<div class="scene-empty">地上空无一物</div>';

    const qBox = $('scene-quests');
    qBox.innerHTML = '';
    const qActive = questArr(v.quests);
    qActive.forEach(q => {
      const d = document.createElement('button');
      d.className = 'scene-item quest';
      d.innerHTML =
        '<span class="si-name">' + esc(q.name) + '</span>' +
        '<span class="si-sub">' + esc(q.stageDesc || '进行中') + '</span>';
      d.onclick = () => panel('quests');
      qBox.appendChild(d);
    });
    if (!qActive.length) qBox.innerHTML = '<div class="scene-empty">暂无任务</div>';
  }

  /* ============================================================
   *  新手引导
   *
   *  服务端按玩家真实进度算出 guide 状态（见 core/tutorial.js），
   *  这里负责：右侧常驻「当前该做什么」+ 点击「详情」看全部步骤。
   * ============================================================ */

  /* 沉浸式开场（楔子）：玩家首次进入江湖时弹叙事剧情，看过（seen_intro）后不再弹。
   * 与后端 tutorial.introFor 配合；点击「踏入江湖」上报标记并关闭。 */
  function maybeShowIntro(v) {
    const it = v && v.intro;
    if (!it || !it.show) return;
    if (S.introShown) return;             // 本次会话已弹过，防重复弹
    S.introShown = true;
    modal(it.title || '楔子', it.body || '',
      '<button id="intro-go" class="btn-primary">踏入江湖</button>');
    const b = $('intro-go');
    if (b) b.onclick = () => {
      if (api && api.markGuide) api.markGuide('seen_intro');
      closeModal();
    };
  }

  function renderGuide(v) {
    const g = v && v.guide;
    const block = $('guide-block');
    if (!block) return;

    /* 没有引导数据（老存档/异常）就把整块收起来，别占地方 */
    if (!g || !g.steps) { block.style.display = 'none'; return; }

    /* 全部完成 -> 收起常驻块（新手已经不需要了） */
    if (g.finished) {
      block.classList.add('guide-done');
      const goalEl = $('guide-goal');
      const hintEl = $('guide-hint');
      const cntEl = $('guide-count');
      const barEl = $('guide-bar');
      if (cntEl) cntEl.textContent = g.doneCount + ' / ' + g.total;
      if (barEl) barEl.style.width = '100%';
      if (goalEl) goalEl.textContent = '引导已完成，江湖任你行！';
      if (hintEl) hintEl.textContent = '点「详情」回看，或点左侧「地图」探索九十九处地点';
      return;
    }

    block.classList.remove('guide-done');
    const cntEl = $('guide-count');
    const barEl = $('guide-bar');
    const goalEl = $('guide-goal');
    const hintEl = $('guide-hint');

    if (cntEl) cntEl.textContent = g.doneCount + ' / ' + g.total;
    if (barEl) barEl.style.width = Math.round(g.doneCount / (g.total || 1) * 100) + '%';
    if (goalEl) goalEl.textContent = g.current ? g.current.goal : '';
    if (hintEl) hintEl.textContent = g.current ? g.current.hint : '';
  }

  /* 引导详情面板：全部步骤清单 */
  function guideHtml(v) {
    const g = v && v.guide;
    if (!g || !g.steps) return '<div class="modal-text">引导数据不可用。</div>';
    let h = '<div class="guide-panel">';
    h += '<div class="gp-head">江湖指引　' +
      '<b>' + g.doneCount + ' / ' + g.total + '</b> 已完成' +
      (g.finished ? '<span class="gp-finish">　✓ 全部完成</span>' : '') + '</div>';
    h += '<div class="gp-steps">';
    g.steps.forEach((s, i) => {
      const cls = s.done ? 'done'
        : (s.locked ? 'locked' : (g.current && g.current.id === s.id ? 'cur' : 'todo'));
      h += '<div class="gp-step ' + cls + '">' +
        '<span class="gps-idx">' + (s.done ? '✓' : (s.locked ? '🔒' : (i + 1))) + '</span>' +
        '<div class="gps-body">' +
        '<div class="gps-title">' + esc(s.title) + '</div>' +
        '<div class="gps-goal">' + esc(s.goal) + '</div>' +
        (!s.done ? '<div class="gps-hint">' + esc(s.hint) + '</div>' : '') +
        '</div></div>';
    });
    h += '</div>';
    h += '<div class="gp-foot">引导不会限制你 —— 想干嘛就干嘛，随时点这里回看。</div>';
    h += '</div>';
    return h;
  }

  /* 任务数据归一化：服务端返回 {active, done, completedCount}，
     也兼容旧格式 / Mod 直接给数组的情况 —— 一律转成「进行中的任务数组」 */
  function questArr(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (Array.isArray(v.active)) return v.active;
    if (Array.isArray(v.quests)) return v.quests;
    /* 传进来的可能是整个 view（panel() 就是这么传的）→ 再剥一层 */
    if (v.quests && typeof v.quests === 'object') return questArr(v.quests);
    return [];
  }

  /** 任务数据来源归一化：可能是 view 本身，也可能是 view.quests */
  function questSrc(v) {
    if (!v || Array.isArray(v)) return v;
    if (v.quests && typeof v.quests === 'object' && !Array.isArray(v.quests)) return v.quests;
    return v;
  }

  /* 点击 NPC 的小菜单 */
  /** 能不能掳这个人：得有袋子 + 对方已经打倒（晕着）
   *  判定全从前端已有数据来，不额外请求 —— NPC 菜单要秒开。
   *  ⚠️ 别在这里多判 `n.hostile`：模板里 hostile 是**常驻标记**（山贼/魔教
   *     模板一出生就是 true，打输后也不清），而这些恰恰是最该被装进麻袋的人 ——
   *     后端 packNpc 也不拦 hostile，只拦「牵着任务的」。
   *     多判这一条的后果：打倒的山贼在菜单里点不到「装进麻袋」，
   *     掳人系统最主的那条路在前端就断了（已踩）。 */
  function canKidnap(n) {
    if (!n || !n.knockedOut) return false;
    const k = (S.view && S.view.kidnap) || null;
    if (!k) return false;
    if (!k.hasSack) return false;
    /* 袋子满了就别给了，给了也是白给（后端会拒） */
    return (k.bags || []).length < 3;
  }

  function openNpcMenu(n) {
    /* 头部带一行社交摘要：好感档 / 身份 / 是否可请教·切磋·偷窃 */
    const bits = [];
    if (n.favorTier) bits.push('<b style="color:' + esc(n.favorColor || '#6a6a6a') + '">' + esc(n.favorTier) +
      '</b>（好感 ' + (n.favor || 0) + '）');
    if (n.tagName) bits.push(esc(n.tagName));
    if (n.gender) bits.push(genderNoun(n.gender));
    if (n.age) bits.push(n.age + ' 岁');
    if (n.homeName) bits.push('居 ' + esc(n.homeName));
    /* 与我已有的关系（婚配 / 结拜）—— 放最前面最显眼 */
    if (n.marriedToMe) bits.unshift('<b style="color:#c0306a">你的正室</b>');
    else if (n.isConcubine) bits.unshift('<b style="color:#c0306a">你的妾室</b>');
    else if (n.bonded) bits.unshift('<b style="color:#c0609a">与你结缘</b>');
    if (n.kinLabel) bits.unshift('<b style="color:#8a5ac2">你的' + esc(n.kinLabel) + '</b>');
    else if (n.taken && n.spouseName) bits.push('已配 ' + esc(n.spouseName));
    const head = bits.length ? '<div class="modal-text" style="margin-bottom:8px">' + bits.join(' · ') + '</div>' : '';

    const me = (S.view && S.view.player) || {};
    const sameGender = (me.gender || 'male') === (n.gender || 'male');
    const canKin = n.canSwear !== false && !n.kinLabel && !n.marriedToMe;
    /* 婚配入口：同性只给「结缘」，异性给「提亲 + 结缘」 */
    const marryHint = sameGender ? null : { label: '提亲议婚 (propose)', action: 'propose' };

    choices(n.name + (n.title ? ' · ' + n.title : ''), [
      { label: '查看 (look)', action: 'look' },
      n.canTalk !== false ? { label: '交谈 (talk)', action: 'talk' } : null,
      { label: '询问 (ask)', action: 'ask' },
      { label: '看人物关系 (guanxi)', action: 'guanxi' },
      { label: '查看好感 (favor)', action: 'favor' },
      { label: '送' + pronounTA(n.gender) + '东西 (give)', action: 'give' },
      { label: '给' + pronounTA(n.gender) + '银钱 (give_money)', action: 'givemoney' },
      n.canQingjiao ? { label: '请教武学 (qingjiao)', action: 'qingjiao' } : null,
      n.canQiecuo !== false ? { label: '切磋武艺 (qiecuo)', action: 'qiecuo', hint: '点到为止，不结仇' } : null,
      /* ---- 姻缘 ---- */
      marryHint,
      { label: '与 TA 结缘 (bond)', action: 'bond', hint: sameGender ? '同性结缘，须不满 45 岁' : '不占正室之位' },
      { label: '纳为妾室 (concubine)', action: 'concubine', hint: '须先有正室' },
      /* ---- 结拜 ---- */
      canKin ? { label: '与 TA 结拜 (swear)', action: 'swear', hint: '义父义母 / 义兄弟义姐妹' } : null,
      n.kinLabel ? { label: '割袍断义 (sever)', action: 'sever', hint: '断后会掉好感' } : null,
      /* ---- 风险 ---- */
      n.canSteal ? { label: '伺机偷窃 (steal)', action: 'steal', hint: '失手会被通缉' } : null,
      /* ---- 掳人（主人加的玩法：只对**打倒的**人露出来）----
         条件从 v.kidnap 读：你得有袋子 + 对方已经晕了。
         ⚠️ 不给「强掳站着的人」留入口 —— 那是绑架玩法之外的东西，且游戏里
            装袋模块本来就拒绝没晕倒的人，前端给了按钮也只会吃一发警告。 */
      canKidnap(n) ? { label: '装进麻袋 (pack)', action: 'pack', hint: '当众下手必被告发' } : null,
      canKidnap(n) ? { label: '卖了他 (sellnpc)', action: 'sellnpc', hint: '知情转卖，重罪' } : null,
      (!n.following && (n.favor || 0) > 60) ? { label: '邀他跟随 (follow)', action: 'follow', hint: '他会跟着，但也有自己的事要办' } : null,
      { label: '动手厮杀 (kill)', action: 'kill', hint: '可能致死，谨慎' }
    ].filter(Boolean), it => {
      const BTN = { fromButton: true };
      if (it.action === 'look') doCmd('look ' + n.name, BTN);
      else if (it.action === 'pack') doCmd('装人 ' + n.name, BTN);
      else if (it.action === 'sellnpc') doCmd('卖人 ' + n.name, BTN);
      else if (it.action === 'follow') doCmd('跟随 ' + n.name, BTN);
      else if (it.action === 'talk') doCmd('talk ' + n.name, BTN);
      else if (it.action === 'ask') { askNpc(n); }
      else if (it.action === 'guanxi') doCmd('guanxi ' + n.name, BTN);
      else if (it.action === 'favor') doCmd('favor ' + n.name, BTN);
      else if (it.action === 'give') giveNpc(n);
      else if (it.action === 'givemoney') giveMoneyNpc(n);
      else if (it.action === 'qingjiao') doCmd('qingjiao ' + n.name, BTN);
      else if (it.action === 'qiecuo') doCmd('qiecuo ' + n.name, BTN);
      else if (it.action === 'propose') proposeNpc(n);
      else if (it.action === 'bond') doCmd('结缘 ' + n.name, BTN);
      else if (it.action === 'concubine') doCmd('纳妾 ' + n.name, BTN);
      else if (it.action === 'swear') doCmd('结拜 ' + n.name, BTN);
      else if (it.action === 'sever') doCmd('断义 ' + n.name, BTN);
      else if (it.action === 'steal') stealNpc(n);
      else if (it.action === 'kill') doCmd('kill ' + n.name, BTN);
    }, head);
  }

  /* 提亲：选场地（酒楼铺张 / 家中简省） */
  function proposeNpc(n) {
    choices('向 ' + n.name + ' 提亲', [
      { label: '酒楼办席 (propose ' + n.name + ' 酒楼)', action: 'hall', hint: '花费 2000 文，宾客可至 24 人，好感加成足' },
      { label: '家中办席 (propose ' + n.name + ' 家中)', action: 'home', hint: '花费 300 文，宾客至多 10 人，好感加成减半' }
    ], it => {
      doCmd('提亲 ' + n.name + ' ' + (it.action === 'hall' ? '酒楼' : '家中'), { fromButton: true });
    });
  }

  /* 送礼：列出背包里可送的东西，点一下直接送 */
  function giveNpc(n) {
    const inv = (S.view && S.view.inventory) || [];
    if (!inv.length) { toast('行囊空空，没什么可送的。', 'error'); return; }
    const likes = (n.likes || []).map(x => x.name).join('、');
    const rows = inv.map(it =>
      '<button class="pick-row" data-item="' + esc(it.id || it.name) + '">' +
      '<span class="pr-name">' + esc(it.name) + (it.count > 1 ? ' ×' + it.count : '') + '</span>' +
      '<span class="pr-sub">' + esc(it.qualityName || it.typeName || '') + '</span></button>'
    ).join('');
    modal('送 ' + n.name + ' 东西',
      '<div class="modal-text">' + (likes ? '他/她似乎偏爱：' + esc(likes) : '此人不挑，来者不拒。') +
      ' 送对了能大大加好感，送太寒碜的反倒跌份。</div>' +
      '<div class="pick-list">' + rows + '</div>',
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    document.querySelectorAll('.pick-row').forEach(b => {
      b.onclick = () => { const id = b.getAttribute('data-item'); closeModal(); doCmd('give ' + id + ' to ' + n.name, { fromButton: true }); };
    });
  }

  /* 给钱：预设几档金额，也可自填 */
  function giveMoneyNpc(n) {
    modal('给 ' + n.name + ' 银钱',
      '<div class="modal-text">钱能通神，也能通人心。给多少，看你的诚意。</div>' +
      '<div class="pick-list">' +
      [50, 100, 300, 800].map(v => '<button class="pick-row" data-amt="' + v + '"><span class="pr-name">' + v + ' 文</span></button>').join('') +
      '</div>' +
      '<input id="money-input" class="modal-input" placeholder="或自填数额（文）">',
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    document.querySelectorAll('.pick-row[data-amt]').forEach(b => {
      b.onclick = () => { const v = b.getAttribute('data-amt'); closeModal(); doCmd('give_money ' + v + ' to ' + n.name, { fromButton: true }); };
    });
    const inp = $('money-input');
    if (inp) inp.onkeydown = e => {
      if (e.key === 'Enter') { const v = inp.value.trim(); closeModal(); if (v) doCmd('give_money ' + v + ' to ' + n.name); }
    };
  }

  /* 偷窃：选目标（钱 or 具体的物），后端做判定 */
  function stealNpc(n) {
    choices('对 ' + n.name + ' 下手', [
      { label: '摸他的钱袋', action: 'money' },
      { label: '偷他身上的物件', action: 'item' }
    ], it => {
      if (it.action === 'money') doCmd('steal money from ' + n.name, { fromButton: true });
      else doCmd('steal ' + n.name, { fromButton: true });
    });
  }

  /* 询问：得让玩家知道**能问什么**。
   * ⚠️ 主人报：「点询问我怎么知道应该询问什么？」
   *   原来这里只有一句「可写：武学/门派/江湖/任务…」+ 一个光输入框，
   *   而 n.askTopics 后端**从来没发过** → 按钮区永远不渲染。
   *   现在后端 engine.askTopicsOf() 按他实际能答什么给清单，这里负责渲染：
   *   ① 专属话题 / 通用话题 → 可点按钮，一键问
   *   ② 带 hint 的（trust 门槛那类）→ 灰掉但**照样显示门槛**，让玩家知道要先去办事
   *   ③ 输入框保留（玩家可以自己编），但降级成「或自己写」的次要选择 */
  function askNpc(n) {
    const topics = (n && n.askTopics) || [];
    let h = '';
    if (topics.length) {
      h += '<div class="modal-text" style="margin-bottom:6px">挑一个问，或者自己写：</div>' +
        '<div class="ask-topics">' + topics.map(t => {
          const tip = t.hint ? ' title="' + esc(t.hint) + '"' : '';
          const cls = t.hint ? 'mini-tag dim' : 'mini-tag';
          /* 有门槛的也给按钮：点了会得到「你还问不着」的明确提示，
             总比不给、让玩家自己瞎猜强 */
          return '<button class="' + cls + '" data-topic="' + esc(t.topic) + '"' + tip + '>' +
            esc(t.topic) + (t.hint ? '<sup>' + esc(t.hint) + '</sup>' : '') + '</button>';
        }).join('') + '</div>';
    } else {
      /* 兜底文案也别太没谱 —— 后端现在保证至少有通用三项，
         这里是双保险，防后端哪天真返空 */
      h += '<div class="modal-text" style="margin-bottom:6px">这人没什么特别可打听的。不过问问总是无妨：</div>' +
        '<div class="ask-topics">' +
        ['你是谁', '近况', '江湖消息'].map(x =>
          '<button class="mini-tag" data-topic="' + esc(x) + '">' + esc(x) + '</button>').join('') +
        '</div>';
    }
    h += '<input id="ask-input" class="modal-input" placeholder="或自己写想问的（回车）">';
    modal('询问 ' + n.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    const inp = $('ask-input');
    if (inp) {
      inp.focus();
      inp.onkeydown = e => {
        if (e.key === 'Enter') { const v = inp.value.trim(); closeModal(); if (v) doCmd('ask ' + n.name + ' about ' + v); }
      };
    }
    document.querySelectorAll('.ask-topics .mini-tag').forEach(b => {
      b.onclick = () => { const v = b.getAttribute('data-topic'); closeModal(); doCmd('ask ' + n.name + ' about ' + v, { fromButton: true }); };
    });
  }

  /* ============================================================
   *  战斗面板
   * ============================================================ */
  function renderCombat(v) {
    const panel = $('combat-panel');
    if (!v.combat) { panel.classList.add('hidden'); return; }
    panel.classList.remove('hidden');

    const c = v.combat;
    $('combat-turn').textContent = '第 ' + (c.turn || 1) + ' 回合';

    const box = $('combat-enemies');
    box.innerHTML = '';
    (c.enemies || []).forEach(e => {
      const d = document.createElement('div');
      d.className = 'ce-card' + (e.dead ? ' dead' : '') + (e.targeted ? ' targeted' : '');
      d.innerHTML =
        '<div class="ce-name">' + esc(e.name) + (e.level ? ' <i>' + e.level + '级</i>' : '') + '</div>' +
        '<div class="ce-hp"><div class="fill" style="width:' + util.pct(e.hp, e.maxHp) + '%"></div>' +
        '<span>' + e.hp + '/' + e.maxHp + '</span></div>' +
        (e.buffs && e.buffs.length ? '<div class="ce-buffs">' + e.buffs.map(b => esc(b)).join(' · ') + '</div>' : '');
      d.onclick = () => combatAct('target', e.uid);
      box.appendChild(d);
    });

    const ab = $('combat-actions');
    ab.innerHTML = '';
    (c.actions || []).forEach(a => {
      const b = document.createElement('button');
      b.className = 'cb-btn' + (a.disabled ? ' disabled' : '');
      b.innerHTML = esc(a.label) + (a.hint ? '<i>' + esc(a.hint) + '</i>' : '');
      if (!a.disabled) b.onclick = () => combatAct(a.action || a.cmd, a.key);
      ab.appendChild(b);
    });
  }

  async function combatAct(action, key) {
    try {
      const d = await api.combat({ action, key });
      afterAction(d);
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ============================================================
   *  左侧面板（状态/属性/武学/任务/门派/背包/装备/效果/地图/帮助）
   * ============================================================ */
  async function panel(name) {
    let v = S.view;
    try {
      const d = await api.view(name);
      v = d.view || v;
    } catch (e) { /* 用缓存 */ }
    if (!v) return;
    const p = v.player || {};

    /* 新手教程：面板类指令不进后端，打开面板等于「玩家做了这一步」。
       集中在这里上报，任何入口（命令/侧栏按钮/快捷键）都不会漏。
       后端 markTutorialFlag 幂等，重复上报无副作用。 */
    const gf = panelGuideFlag(name);
    if (gf && api.markGuide) {
      await api.markGuide(gf);
      v = S.view || v;
    }

    let title = '', html = '';

    if (name === 'score') {
      title = '状态一览';
      html = scoreHtml(v);
    } else if (name === 'attr') {
      title = '属性详情';
      html = attrHtml(v);
    } else if (name === 'skills') {
      title = '武学修为';
      html = skillsHtml(v);
    } else if (name === 'quests') {
      title = '任务日志';
      html = questsHtml(v);
    } else if (name === 'sect') {
      title = '门派';
      html = sectHtml(v);
    } else if (name === 'inventory') {
      title = '随身行囊';
      html = invHtml(v);
    } else if (name === 'equipment') {
      title = '穿戴装备';
      html = eqHtml(v);
    } else if (name === 'affects') {
      title = '身状态效果';
      html = affectsHtml(v);
    } else if (name === 'map') {
      title = '江湖舆图';
      html = mapHtml(v);
    } else if (name === 'social') {
      title = '人情往来';
      html = socialHtml(v);
    } else if (name === 'love') {
      title = '姻缘 · 义亲';
      html = loveHtml(v);
    } else if (name === 'home') {
      title = '我的家宅';
      html = homeHtml(v);
    } else if (name === 'martial') {
      title = '武学修为';
      html = martialHtml(v);
    } else if (name === 'found') {
      title = '宗门 · 师承';
      html = sectFounderHtml(v);
    } else if (name === 'slaves') {
      title = '奴册 · 护院 · 麻袋';
      html = slavesHtml(v);
    } else if (name === 'guide') {
      title = '江湖指引';
      html = guideHtml(v);
    } else if (name === 'help') {
      title = '指令帮助';
      html = helpHtml();
    } else {
      title = name;
      html = '<div class="modal-text">暂无内容</div>';
    }

    modal(title, html, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    bindPanelActions(name);
  }

  /* --- 各面板 HTML --- */

  function kv(k, val, cls) {
    return '<div class="kv ' + (cls || '') + '"><span class="k">' + esc(k) + '</span><span class="v">' + esc(val) + '</span></div>';
  }

  /* 人情往来：当前在场的人一览（好感档 / 身份 / 能做什么） */
  function socialHtml(v) {
    const list = (v.npcs || []).filter(n => !n.hostile);
    if (!list.length) return '<div class="modal-text">四下无人，暂时没什么人情往来。</div>';
    let h = '<div class="modal-text">同在此处的人，好感高低一目了然。点一下能看详情、送礼、请教。</div>';
    h += '<div class="social-list">';
    list.forEach(n => {
      const color = n.favorColor || '#6a6a6a';
      const acts = [];
      if (n.canQingjiao) acts.push('可请教');
      if (n.canQiecuo) acts.push('可切磋');
      if (n.canSteal) acts.push('有财物');
      if (n.hasHome) acts.push('有家室');
      h += '<div class="social-row" data-npc="' + esc(n.name) + '">' +
        '<div class="sr-main">' +
        '<span class="sr-name">' + esc(n.name) + '</span>' +
        (n.tagName ? '<span class="sr-tag">' + esc(n.tagName) + '</span>' : '') +
        '</div>' +
        '<div class="sr-favor" style="color:' + esc(color) + '">' + esc(n.favorTier || '平常') +
        ' <b>' + (n.favor > 0 ? '+' : '') + (n.favor || 0) + '</b></div>' +
        (acts.length ? '<div class="sr-acts">' + acts.map(a => '<i>' + esc(a) + '</i>').join('') + '</div>' : '') +
        (n.likes && n.likes.length ? '<div class="sr-likes">喜 ' + esc(n.likes.map(x => x.name).join('、')) + '</div>' : '') +
        '</div>';
    });
    h += '</div>';
    return h;
  }

  /* ============================================================
   *  姻缘 · 义亲面板
   * ============================================================ */
  function loveHtml(v) {
    const m = v.marriage || null;
    const k = v.kinship || null;
    let h = '';

    /* ---- 婚姻 ---- */
    h += '<div class="panel-sec">姻缘</div>';
    if (m && m.spouse) {
      h += '<div class="love-card spouse">' +
        '<div class="lc-role">正室</div>' +
        '<div class="lc-name">' + esc(m.spouse.name) + '</div>' +
        '<div class="lc-sub">' + genderNoun(m.spouse.gender) +
        (m.spouse.age ? ' · ' + m.spouse.age + ' 岁' : '') + '</div>' +
        (m.spouse.homeName ? '<div class="lc-sub">居 ' + esc(m.spouse.homeName) + '（你可出入布置）</div>' : '') +
        '</div>';
    } else {
      h += '<div class="modal-text">尚未娶亲。与异性高好感之人可「提亲」，同性可「结缘」。</div>';
    }

    if (m && m.plan) {
      h += '<div class="love-card plan">' +
        '<div class="lc-role">在议</div>' +
        '<div class="lc-name">' + esc(m.plan.name) + '</div>' +
        '<div class="lc-sub">' + esc(m.plan.venueName || '') +
        ' · 聘礼 ' + (m.plan.gift || 0) + ' 文 + 席面 ' + (m.plan.cost || 0) + ' 文</div>' +
        '<div class="lc-sub">发「办酒」开席，宾客到齐后发「入洞房」。</div>' +
        '</div>';
    }

    if (m && m.concubines && m.concubines.length) {
      h += '<div class="love-sub">妾室</div><div class="love-row-wrap">';
      m.concubines.forEach(c => {
        h += '<div class="love-chip">' + esc(c.name) +
          '<i>' + genderNoun(c.gender) + (c.age ? ' · ' + c.age : '') + '</i></div>';
      });
      h += '</div>';
    }
    if (m && m.bonds && m.bonds.length) {
      h += '<div class="love-sub">结缘</div><div class="love-row-wrap">';
      m.bonds.forEach(c => {
        h += '<div class="love-chip bond">' + esc(c.name) +
          '<i>' + genderNoun(c.gender) + (c.age ? ' · ' + c.age : '') + '</i></div>';
      });
      h += '</div>';
    }

    /* ---- 义亲 ---- */
    h += '<div class="panel-sec">义亲结拜</div>';
    if (!k || !k.total) {
      h += '<div class="modal-text">尚无结拜之亲。与人好感相投后，可「结拜」义结金兰。</div>';
    } else {
      const groups = [
        ['father', '义父'], ['mother', '义母'],
        ['brothers', '义兄弟'], ['sisters', '义姐妹'],
        ['sons', '义子'], ['daughters', '义女'],
      ];
      for (const [key, cn] of groups) {
        if (!k[key] || !k[key].length) continue;
        h += '<div class="love-sub">' + cn + '</div><div class="love-row-wrap">';
        k[key].forEach(x => {
          h += '<div class="love-chip kin' + (x.dead ? ' dead' : '') + '">' + esc(x.name) +
            '<i>' + genderNoun(x.gender) + (x.age ? ' · ' + x.age : '') +
            ' · 好感 ' + (x.favor || 0) + '</i></div>';
        });
        h += '</div>';
      }
    }

    /* ---- 在本房间能做的事 ---- */
    const here = (v.npcs || []).filter(n => !n.hostile);
    if (here.length) {
      h += '<div class="panel-sec">此地可议</div><div class="love-row-wrap">';
      here.forEach(n => {
        const tags = [];
        if (n.marriedToMe) tags.push('<b style="color:#c0306a">正室</b>');
        else if (n.kinLabel) tags.push('<b style="color:#8a5ac2">' + esc(n.kinLabel) + '</b>');
        else {
          if (n.taken) tags.push('<i>已有婚配</i>');
          else if (!n.marriedToMe) tags.push('<i>可提亲/结缘</i>');
          if (n.canSwear !== false && !n.kinLabel) tags.push('<i>可结拜</i>');
        }
        h += '<div class="love-chip act" data-npc="' + esc(n.name) + '">' + esc(n.name) +
          '<i>' + genderNoun(n.gender) + (n.age ? ' · ' + n.age + ' 岁' : '') +
          ' · 好感 ' + (n.favor || 0) + '</i>' +
          '<span class="lc-tags">' + tags.join(' ') + '</span></div>';
      });
      h += '</div>';
      h += '<div class="modal-text" style="margin-top:8px">点人名可直接打开菜单。</div>';
    }
    return h;
  }

  /* ============================================================
   *  家宅面板
   * ============================================================ */
  function homeHtml(v) {
    const hs = v.home || null;
    let h = '';
    if (!hs || (!hs.hasHome && !(hs.homes || []).length)) {
      h += '<div class="modal-text">你尚无片瓦遮身。</div>';
      h += '<div class="modal-text">去<b>衙门·签押房</b>发「买宅」置办一处。最便宜的一间小屋 800 文。</div>';
    } else {
      h += '<div class="panel-sec">名下产业</div>';
      (hs.homes || []).forEach(x => {
        h += '<div class="love-chip home">' + esc(x.name) +
          '<i>' + esc((hs.tiers || []).find(t => t.id === x.tier) ? (hs.tiers || []).find(t => t.id === x.tier).name : x.tier) +
          ' · ' + (x.price || 0) + ' 文</i></div>';
      });
      h += '<div class="modal-text">家当总值 <b>' + (hs.estateValue || 0) + '</b> 文</div>';
      if (hs.home) {
        h += '<div class="panel-sec">现居</div>';
        h += '<div class="love-card spouse"><div class="lc-name">' + esc(hs.home.name) + '</div>' +
          '<div class="lc-sub">可放 ' + hs.home.capacity + ' 件家当，已有 ' + hs.home.furniture + ' 件</div></div>';
      }
    }
    if (hs && hs.partnerHome) {
      h += '<div class="panel-sec">伴侣居所</div>';
      h += '<div class="love-chip home">' + esc(hs.partnerHome.name) +
        '<i>' + esc(hs.partnerHome.of) + '的家 · 你可出入布置</i></div>';
    }
    if (hs && hs.tiers && hs.tiers.length) {
      h += '<div class="panel-sec">可置办的宅子（衙门签押房）</div>';
      hs.tiers.forEach(t => {
        h += '<div class="love-chip tier">' + esc(t.name) + '<i>' + t.price + ' 文 · 可放 ' + t.capacity + ' 件</i></div>';
      });
    }
    /* ---- 家园新地块（开垦）---- */
    if (hs && hs.plots && hs.plots.length) {
      h += '<div class="panel-sec">家园地块</div>';
      hs.plots.forEach(pl => {
        if (pl.locked) {
          h += '<div class="love-chip home" style="opacity:.45">' + esc(pl.name) +
            '<i>需主院等级更高</i></div>';
        } else if (pl.level > 0) {
          h += '<div class="love-chip home"><b>' + esc(pl.name) + '</b> ' + pl.level + ' 级' +
            (pl.level >= pl.maxLevel ? '（顶级）' : ' · 发「开垦 ' + esc(pl.name) + '」扩建') +
            '<i>' + esc(pl.desc) + '</i></div>';
        } else {
          const mats = Object.keys(pl.mats || {}).map(k => esc(k) + '×' + pl.mats[k]).join('、');
          h += '<div class="love-chip tier">○ ' + esc(pl.name) +
            '<i>' + pl.cost + ' 文' + (mats ? ' · 需 ' + mats : '') + '</i></div>';
        }
      });
      const ef = hs.estateEffects;
      if (ef) {
        const bits = [];
        if (ef.trainMult > 0) bits.push('修炼快 ' + Math.round(ef.trainMult * 100) + '%');
        if (ef.cutiRate > 0) bits.push('淬体易 ' + Math.round(ef.cutiRate * 100) + '%');
        if (ef.wisdom > 0) bits.push('悟性 +' + Math.round(ef.wisdom));
        if (ef.craftRate > 0) bits.push('炼制稳 ' + Math.round(ef.craftRate * 100) + '%');
        if (ef.moodUp > 0) bits.push('心情 +' + Math.round(ef.moodUp));
        if (ef.discipleCap > 0) bits.push('可容弟子 +' + ef.discipleCap);
        if (bits.length) h += '<div class="modal-text">家园增益：' + esc(bits.join(' · ')) + '</div>';
      }
    }
    /* ---- 我资助建过家的 NPC ---- */
    if (hs && hs.sponsored && hs.sponsored.length) {
      h += '<div class="panel-sec">受你资助的人</div>';
      hs.sponsored.forEach(s => {
        h += '<div class="love-chip spouse">' + esc(s.name) +
          '<i>家：' + esc(s.roomName) + ' · ' + s.cost + ' 文</i></div>';
      });
    }
    h += '<div class="modal-text" style="margin-top:8px">指令：「买宅」「卖宅」「回家」「布置 &lt;描述&gt;」「置办 &lt;家具&gt;」「地块」「开垦 &lt;地块&gt;」「资助 &lt;人名&gt;」</div>';
    return h;
  }

  function scoreHtml(v) {
    const p = v.player || {};
    let h = '<div class="panel-cols">';
    h += '<div class="pc-col">';
    h += kv('姓名', p.name);
    h += kv('称号', p.title || '—');
    h += kv('性别', genderNoun(p.gender));
    h += kv('境界', p.realm || '不通武艺');
    h += kv('门派', p.sectName || '无门无派');
    h += kv('职位', p.rankName || '—');
    h += kv('年龄', p.age ? p.age + ' 岁' : '—');
    h += kv('战绩', (p.kills || 0) + ' 杀');
    h += '</div><div class="pc-col">';
    h += kv('气血', p.hp + ' / ' + p.maxHp);
    h += kv('内力', p.mp + ' / ' + p.maxMp);
    /* 气血/内力是整数，饱食/饮水是小数 —— 一律过 fmt1（单一入口，别两处写法不一致，
       否则顶栏修好了、这个「状态一览」面板还印 99.9187） */
    h += kv('饱食', fmt1(p.food) + ' / ' + fmt1(p.maxFood));
    h += kv('饮水', fmt1(p.water) + ' / ' + fmt1(p.maxWater));
    h += kv('潜能', p.potential);
    h += kv('银两', p.money + ' 文');
    h += kv('杀气', p.karma);
    /* 声望是「键→ 数值」的对象（门派名/恶名等动态键），直接丢给 kv 会变 [object Object] */
    h += kv('声望', repText(p.reputation));
    h += '</div></div>';
    if (p.timeText) h += '<div class="panel-note">' + esc(p.timeText) + '</div>';
    return h;
  }

  /** 声望对象 → 可读文本：取数值最高的 3 项 */
  function repText(rep) {
    if (rep == null) return '—';
    if (typeof rep === 'number' || typeof rep === 'string') return String(rep);
    const keys = Object.keys(rep).filter(k => rep[k]);
    if (!keys.length) return '—';
    keys.sort((a, b) => (rep[b] || 0) - (rep[a] || 0));
    const top = keys.slice(0, 3).map(k => k + ' ' + rep[k]).join(' · ');
    return keys.length > 3 ? top + ' …' : top;
  }

  function attrHtml(v) {
    const p = v.player || {};
    /* ⚠️ 字段名是 `attr` 不是 `attrs`，`derived` 后端压根不发。
       原来读 `v.player.attrs` 全 undefined → 点「属性」弹一个空框（主人报的）。
       读错字段名的典型：数组/对象写出来是「0 个元素」，不是报错。
       兜底两份都读，这样后端哪天真的加了 attrs 也不冲突。 */
    const a = p.attr || p.attrs || {};
    const d = p.derived || {};
    const attrNames = { 力量: '力量', 根骨: '根骨', 身法: '身法', 悟性: '悟性', 福缘: '福缘', 定力: '定力' };
    let h = '';
    const keys = Object.keys(a);
    if (keys.length) {
      h += '<div class="attr-grid">';
      keys.forEach(k => {
        h += '<div class="attr-card"><div class="ac-name">' + esc(attrNames[k] || k) + '</div>' +
          '<div class="ac-val">' + a[k] + '</div></div>';
      });
      h += '</div>';
    } else {
      h += '<div class="modal-text">尚未定型。修行与历练会把你该有的本事长出来。</div>';
    }
    /* 衍生属性：后端没给 derived 时，用顶层战斗数值凑一份（都是 playerBrief 里的实字段） */
    const derived = Object.keys(d).length ? d : {
      攻击: p.atk, 防御: p.def, 身法: p.dodge, 格挡: p.parry, 速度: p.speed,
      暴击率: p.critRate != null ? Math.round(p.critRate * 100) + '%' : null,
      气血: p.maxHp, 内力: p.maxMp, 资质: (v.martial && v.martial.aptitude) || null,
    };
    const dkeys = Object.keys(derived).filter(k => derived[k] != null);
    if (dkeys.length) {
      h += '<div class="panel-sub">衍生属性</div><div class="panel-cols"><div class="pc-col">';
      dkeys.forEach((k, i) => {
        h += kv(k, derived[k]);
        if (i === Math.ceil(dkeys.length / 2) - 1) h += '</div><div class="pc-col">';
      });
      h += '</div></div>';
    }
    return h;
  }

  function skillsHtml(v) {
    const list = (v.player && v.player.skills) || v.skills || [];
    if (!list.length) return '<div class="modal-text">尚未习得任何武学。</div>';
    let h = '<table class="data-table"><thead><tr><th>武学</th><th>门类</th><th>类型</th><th>等级</th><th>熟练度</th><th>威力</th></tr></thead><tbody>';
    list.forEach(s => {
      const pctStr = s.level >= s.maxLevel ? '圆满' : util.pct(s.exp, s.expNeed) + '%';
      h += '<tr><td class="td-name">' + esc(s.name) + (s.equipped || s.enabled ? ' <i class="tag-on">已启用</i>' : '') + '</td>' +
        '<td>' + esc(s.category || s.typeName || s.type) + '</td>' +
        '<td>' + esc(s.typeName || s.type) + (s.weaponType ? '（需' + esc(s.weaponType) + '）' : '') + '</td>' +
        '<td>' + s.level + ' / ' + s.maxLevel + '</td>' +
        '<td>' + pctStr + '</td>' +
        '<td>' + (s.power != null ? s.power : '—') + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /* ============================================================
   * 武学修为面板（武学重制）：奇经八脉 / 修炼诸途 / 功法门类 / 弟子 / 宗门
   * ============================================================ */
  function martialHtml(v) {
    const m = v.martial || {};
    const pl = v.player || {};
    let h = '';

    /* 资质 + 奇经八脉 */
    h += '<div class="panel-sec">资质 · 奇经八脉</div>';
    h += '<div class="modal-text">资质 <b>' + (m.aptitude || 0) + '</b>　' +
      esc(m.maxLevelHint || '') + '</div>';
    const md = m.meridians || [];
    if (md.length) {
      h += '<table class="data-table"><thead><tr><th>经脉</th><th>进度</th><th>已通</th></tr></thead><tbody>';
      md.forEach(x => {
        const pctv = Math.round((x.lv / (x.max || 8)) * 100);
        h += '<tr><td class="td-name">' + esc(x.name) + '</td>' +
          '<td>' + x.lv + ' / ' + (x.max || 8) + '</td>' +
          '<td>' + (x.lv >= (x.max || 8) ? '✔ 通' : pctv + '%') + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="modal-text">内功修炼时有机会冲击奇经八脉，通脉越多，内力上限、气血与招式越强。</div>';
    }

    /* 修炼诸途 */
    const ways = m.ways || [];
    if (ways.length) {
      h += '<div class="panel-sec">修炼诸途</div>';
      ways.forEach(w => {
        h += '<div class="love-chip home">' + esc(w.name) + '<i>' + esc(w.desc) + '</i></div>';
      });
    }

    /* 炼制配方统计 */
    const rc = m.recipes || {};
    const rcKeys = Object.keys(rc);
    if (rcKeys.length) {
      const CN = { alchemy: '炼丹', forge: '炼器', rune: '画符阵' };
      h += '<div class="panel-sec">炼制配方</div>';
      h += '<div class="modal-text">' + rcKeys.map(k => CN[k] || k + ' ' + rc[k] + ' 方').join('　') + '</div>';
    }

    /* 功法门类统计 */
    const list = (pl.skills) || v.skills || [];
    if (list.length) {
      const byCat = {};
      list.forEach(s => { const c = s.category || s.type || '外功'; byCat[c] = (byCat[c] || 0) + 1; });
      h += '<div class="panel-sec">功法门类</div>';
      h += '<div class="modal-text">' + Object.keys(byCat).map(k => k + ' ' + byCat[k] + ' 部').join('　') + '</div>';
      /* 熟练度分级表 */
      const TIERS = ['入门', '初成', '小成', '大成', '融会', '登峰造极'];
      h += '<div class="modal-text" style="margin-top:6px">熟练度分级：' +
        TIERS.map((t, i) => esc(t) + (i === 5 ? '' : ' ›')).join('　') + '</div>';
    }

    /* 弟子 */
    const ds = m.disciples || [];
    h += '<div class="panel-sec">弟子（' + ds.length + '）</div>';
    if (!ds.length) {
      h += '<div class="modal-text">尚未收徒。发「收徒 &lt;人名&gt;」可收有资质者为徒，「授艺 &lt;人名&gt; &lt;武学&gt;」传其武学。</div>';
    } else {
      ds.forEach(d => {
        h += '<div class="love-chip spouse">' + esc(d.name) +
          '<i>' + (d.realm || '—') + ' · 武学 ' + d.skillLv + ' 级 · 信任 ' + d.trust + ' · 好感 ' + d.favor + '</i></div>';
      });
    }

    /* 自建宗门 */
    h += '<div class="panel-sec">宗门</div>';
    if (m.mySect) {
      h += '<div class="love-card spouse"><div class="lc-name">' + esc(m.mySect.name) +
        '</div><div class="lc-sub">' + esc(m.mySect.style || '') + ' · 门人 ' + m.mySect.members +
        ' · 威望 ' + m.mySect.prestige + (m.mySect.hall ? ' · 山门 ' + esc(m.mySect.hall) : '') + '</div></div>';
      h += '<div class="modal-text">指令：「招贤」「演武」「大比」「解散宗门」</div>';
    } else {
      h += '<div class="modal-text">你尚未自立门户。发「创宗 &lt;名字&gt;」自立山头，收门徒、办活动、参与门派大比。</div>';
    }

    h += '<div class="modal-text" style="margin-top:8px">指令：「修炼 &lt;武学&gt;」「打坐」「淬体 &lt;武学&gt;」「炼丹 &lt;方&gt;」「炼器 &lt;方&gt;」「画符 &lt;方&gt;」</div>';
    return h;
  }

  /** 宗门/师承面板（跳到 martial 的宗门段，保留独立入口） */
  function sectFounderHtml(v) { return martialHtml(v); }

  /* ============================================================
   *  奴册面板（掳人 / 奴役 / 护院）
   *
   *  三栏：麻袋里 / 名下的人 / 护院，外加恶名与家资名额。
   *  ⚠️ 数据全从 v.kidnap 取（engine.view 的顶层字段）。
   *  ⚠️ 每个操作按钮都走 data-cmd（bindPanelActions 统一绑），别自己 addEventListener，
   *     那样会被 fromButton 的输入法防弹漏掉（血泪 #8：点了没反应先搜有没有绑事件）。
   * ============================================================ */
  function slavesHtml(v) {
    const k = v.kidnap;
    if (!k) return '<div class="modal-text">（还没有名册。）</div>';
    let h = '';

    /* ---- 恶名：这一栏最重要，掳人卖人的代价全挂在这儿 ---- */
    const bad = k.wanted > 0;
    h += '<div class="modal-text">' +
      (bad
        ? '<span style="color:#b23c3c">恶名 ' + (k.wanted || 0) + '　' + esc(k.wantedName || '') + '</span>　—— ' + esc(k.wantedDesc || '') + (k.reports ? '（已被告发 ' + (k.reports || 0) + ' 次）' : '') 
        : '恶名 0　未及罪。还没人报官，但你欠下的账，迟早要算。') +
      '</div>';

    /* ---- 自己被掳：三条出路 ---- */
    if (k.debt) {
      h += '<div class="kv" style="border-color:#b23c3c"><span class="k">你在黑市</span><span class="v" style="color:#b23c3c">赎金 ' +
        (k.debt.ransom || 0) + ' 文　已抵 ' + (k.debt.paidOff || 0) + ' 文　第 ' + ((k.debt.days || 0) + 1) + '/5 天</span></div>';
      h += '<div class="row-ops">' +
        '<button class="op-btn" data-cmd="赎身">赎身（掏钱）</button>' +
        '<button class="op-btn" data-cmd="突围">突围（硬打）</button>' +
        '<button class="op-btn" data-cmd="打工">打工还债</button>' +
        '</div>';
    }

    /* ---- 家资名额（唐制按身份给限额）---- */
    const q = k.quota || {};
    h += kv('家资', (q.tierName || '寒素') + '　奴 ' + (q.usedSlaves || 0) + '/' + (q.slaves || 0) + '　护院 ' + (q.usedGuards || 0) + '/' + (q.guards || 0));
    if (k.wageDue > 0) {
      h += kv('欠工钱', (k.wageDue || 0) + ' 文　拖久了护院要走人', 'bad');
      h += '<div class="row-ops"><button class="op-btn" data-cmd="发工钱">发工钱</button></div>';
    }

    /* ---- 麻袋 ---- */
    h += '<div class="panel-sub">麻袋里' + (k.hasSack ? '（你身上还有空袋）' : '（你身上没有空袋了）') + '</div>';
    if (!(k.bags || []).length) {
      h += '<div class="modal-text">空的。用「装人 &lt;人名&gt;」把打倒的人装进来。</div>';
    } else {
      h += '<div class="kv-list">';
      (k.bags || []).forEach(b => {
        const st = { out: '还在昏迷', struggling: '已经醒了，在袋里挣', burst: '正在往外冲' }[b.state] || b.state;
        const hh = Math.floor((b.minutesIn || 0) / 60);
        h += '<div class="kv"><span class="k">第' + (b.idx || '?') + '袋　' + esc(b.name || '') + '</span><span class="v">' +
          esc(st) + '　装了 ' + hh + ' 个时辰' + '</span></div>';
      });
      h += '</div>';
      h += '<div class="row-ops">' +
        (k.bags || []).map(b => '<button class="op-btn" data-cmd="放人 ' + (b.idx || 1) + '">放出 ' + esc(b.name || '') + '</button>').join('') +
        (k.bags || []).map(b => '<button class="op-btn" data-cmd="卖人 ' + esc(b.name || '') + '">卖掉 ' + esc(b.name || '') + '</button>').join('') +
        '</div>';
    }

    /* ---- 名下的人 ---- */
    h += '<div class="panel-sub">名下的人</div>';
    if (!(k.slaves || []).length) {
      h += '<div class="modal-text">无。要买奴得去黑市——律制按身份限额，你现在的家资养不起几个人。</div>';
    } else {
      h += '<div class="kv-list">';
      (k.slaves || []).forEach(s => {
        const busy = s.task ? (s.task + '，还剩 ' + Math.round((s.minutesLeft || 0) / 30) + ' 个时辰') :
          (s.waitingAt ? ('在' + s.waitingAt + '等你') : '闲着');
        h += '<div class="kv"><span class="k">' + esc(s.name || '') + '</span><span class="v">' +
          '服从 ' + (s.obedience || 0) + '　好感 ' + (s.favor || 0) + '　' + esc(busy) +
          ((s.obedience || 0) <= 80 && (s.favor || 0) <= 80 ? '　<span style="color:#b07a2a">（无人看管易逃）</span>' : '') +
          '</span></div>';
      });
      h += '</div>';
      h += '<div class="panel-sub">派活（做工 / 采买 / 跑腿 / 洗衣）</div><div class="row-ops">' +
        (k.slaves || []).map(s => ['做工', '采买', '跑腿', '洗衣'].map(tk =>
          '<button class="op-btn" data-cmd="使唤 ' + esc(s.name || '') + ' ' + tk + '">' + esc(s.name || '') + '·' + tk + '</button>'
        ).join('')).join('') +
        '</div>';
      h += '<div class="row-ops">' +
        (k.slaves || []).map(s => '<button class="op-btn" data-cmd="卖人 ' + esc(s.name || '') + '">卖 ' + esc(s.name || '') + '</button>').join('') +
        '</div>';
      /* 有护院才能派人盯 */
      if ((k.guards || []).length) {
        h += '<div class="panel-sub">派人盯着（护院在看着才不敢跑）</div><div class="row-ops">' +
          (k.slaves || []).map(s => '<button class="op-btn" data-cmd="监督 ' + esc(s.name || '') + '">盯 ' + esc(s.name || '') + '</button>').join('') +
          '</div>';
      }
    }

    /* ---- 护院 ---- */
    h += '<div class="panel-sub">护院</div>';
    if (!(k.guards || []).length) {
      h += '<div class="modal-text">无。得回自家宅院雇——指令「雇护院 &lt;人名&gt;」。</div>';
    } else {
      h += '<div class="kv-list">';
      (k.guards || []).forEach(g => {
        const busy = g.supervising ? ('正盯着' + g.supervising + '，还剩 ' + Math.round((g.minutesLeft || 0) / 30) + ' 个时辰') : '看家';
        h += '<div class="kv"><span class="k">' + esc(g.name || '') + '</span><span class="v">' +
          '武力 ' + (g.power || 0) + '　日薪 ' + (g.wage || 0) + ' 文　' + busy +
          ((g.loyalty || 0) < 30 ? '　<span style="color:#b23c3c">（离心）</span>' : '') + '</span></div>';
      });
      h += '</div>';
      h += '<div class="row-ops"><button class="op-btn" data-cmd="发工钱">结清工钱</button></div>';
    }

    /* ---- 黑市在售 ---- */
    if (k.inBlackMarket) {
      h += '<div class="panel-sub">黑市在售</div>';
      if (!(k.marketStock || []).length) {
        h += '<div class="modal-text">今日无人待售。</div>';
      } else {
        h += '<div class="kv-list">';
        (k.marketStock || []).forEach(m => {
          h += '<div class="kv"><span class="k">' + esc(m.name || '') + '</span><span class="v">' +
            (m.to === 'brothel' ? '青楼' : '黑市') + '　' + (m.price || 0) + ' 文</span></div>';
        });
        h += '</div><div class="row-ops">' +
          (k.marketStock || []).map(m => '<button class="op-btn" data-cmd="买奴 ' + esc(m.name || '') + '">买 ' + esc(m.name || '') + '</button>').join('') +
          '</div>';
      }
    } else if (k.inBrothel) {
      h += '<div class="panel-sub">你在青楼</div><div class="row-ops">' +
        '<button class="op-btn" data-cmd="赎回">看赎人名册</button></div>';
    }

    /* ---- 跟随的人 ---- */
    const fol = (v.npcs || []).filter(n => n.following);
    if (fol.length) {
      h += '<div class="panel-sub">跟着你走的人</div><div class="modal-text">' +
        fol.map(n => esc(n.name)).join('、') + '</div>';
    }

    h += '<div class="modal-text" style="margin-top:10px;font-size:12px;opacity:.72">' +
      '手段都在律法里：略卖良人为奴婢，杖一百、流三千里；知情买者与犯人同罪。' +
      '奴婢限额按身份给——王公之家不过二十人。</div>';
    return h;
  }

  function questsHtml(v) {
    const src = questSrc(v);
    const list = questArr(src);
    const done = (src && !Array.isArray(src) && Array.isArray(src.done)) ? src.done : [];
    if (!list.length && !done.length) return '<div class="modal-text">暂无进行中的任务。</div>';

    /* 分组显示（主人报的「点任务快捷键弹出来的还是旧主线」）。
       原来是一把梭平铺：只要身上挂着主线，打开面板第一屏全是主线，
       支线/门派/委托全被压到下面，看着就像「任务面板只有主线」。
       现在按类型分组、主线在最上，一眼能分清「我该走的故事」和「我手头的差事」。
       类型名直接用数据里的 `type` 字段（60_quests.json 里就是中文：主线/支线/门派/委托…），
       不认识的类型归到「其他」，不丢内容。 */
    const ORDER = ['主线', '支线', '门派', '委托', '江湖', '其他'];
    const groups = {};
    list.forEach(q => {
      const t = String((q && q.type) || '').trim() || '其他';
      (groups[t] = groups[t] || []).push(q);
    });
    const keys = Object.keys(groups).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    const card = q => {
      let s = '<div class="quest-card"><div class="q-name">' + esc(q.name) + '</div>';
      s += '<div class="q-desc">' + esc(q.desc || '') + '</div>';
      s += '<div class="q-stage">当前阶段：' + esc(q.stageDesc || '—') + '</div>';
      if (q.targets && q.targets.length) {
        s += '<div class="q-targets">';
        q.targets.forEach(t => {
          s += '<div class="q-target' + (t.done ? ' done' : '') + '">' +
            '<span>' + esc(t.desc || t.name || '') + '</span>' +
            '<span class="qt-num">' + (t.count != null ? ((t.cur != null ? t.cur : 0) + '/' + (t.count || 1)) : (t.done ? '✔' : '')) + '</span></div>';
        });
        s += '</div>';
      }
      return s + '</div>';
    };

    let h = '';
    if (list.length) {
      keys.forEach(k => {
        h += '<div class="q-group-title">' + esc(k) +
          '<span class="qg-num">' + groups[k].length + '</span></div>';
        groups[k].forEach(q => { h += card(q); });
      });
      /* 身上只有主线时给一句提示。不写「请前往XX领取」那种说明书腔，
         只说江湖上的道理 —— 支线本来就靠搭话、帮忙换来的。 */
      const hasSide = (groups['支线'] || []).length > 0 || (groups['委托'] || []).length > 0;
      if (!hasSide) {
        h += '<div class="panel-note">手上还没有别人的事。江湖上那些差事，' +
          '都是跟人搭话、搭把手换来的 —— 见了面，问一句「有什么事」。</div>';
      }
    }
    if (done.length) {
      h += '<div class="q-done-title">已完成（' + done.length + '）</div><div class="q-done-list">';
      done.forEach(d => {
        const name = (d && d.name) ? d.name : (typeof d === 'string' ? d : '');
        h += '<div class="q-done-item">✔ ' + esc(name) + '</div>';
      });
      h += '</div>';
    }
    return h;
  }

  function sectHtml(v) {
    const p = v.player || {};
    const s = v.sect;
    if (!p.sectName) {
      return '<div class="modal-text">你尚未拜入任何门派。<br><br>可在各派山门处向掌门「拜师」加入。' +
        (v.sectList && v.sectList.length ? '<div class="panel-sub">可加入的门派</div>' + v.sectList.map(x =>
          '<div class="sect-line"><b>' + esc(x.name) + '</b><span>' + esc(x.desc || '') + '</span></div>').join('') : '') +
        '</div>';
    }
    let h = '';
    h += kv('门派', p.sectName);
    h += kv('职位', p.rankName || '弟子');
    h += kv('贡献', p.contribution != null ? p.contribution : 0);
    if (s) {
      if (s.desc) h += '<div class="panel-note">' + esc(s.desc) + '</div>';
      if (s.skills && s.skills.length) {
        h += '<div class="panel-sub">本门武学</div><div class="tag-row">' +
          s.skills.map(k => '<span class="mini-tag static">' + esc(k) + '</span>').join('') + '</div>';
      }
    }
    return h;
  }

  function invHtml(v) {
    const list = v.inventory || [];
    if (!list.length) return '<div class="modal-text">行囊空空如也。</div>';
    let h = '<table class="data-table"><thead><tr><th>物品</th><th>类型</th><th>数量</th><th>操作</th></tr></thead><tbody>';
    list.forEach(it => {
      h += '<tr><td class="td-name">' + esc(it.name) + '</td>' +
        '<td>' + esc(it.typeName || '') + '</td>' +
        '<td>' + it.count + '</td>' +
        '<td class="td-ops">' +
        (it.usable ? '<button class="op-btn" data-cmd="use ' + esc(it.name) + '">使用</button>' : '') +
        (it.equipable ? '<button class="op-btn" data-cmd="wear ' + esc(it.name) + '">穿戴</button>' : '') +
        (it.equipable ? '<button class="op-btn" data-cmd="wield ' + esc(it.name) + '">持械</button>' : '') +
        '<button class="op-btn" data-cmd="look ' + esc(it.name) + '">查看</button>' +
        '<button class="op-btn" data-cmd="drop ' + esc(it.name) + '">丢弃</button>' +
        '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function eqHtml(v) {
    const e = v.equipment || {};
    let h = '<table class="data-table"><thead><tr><th>部位</th><th>装备</th><th>操作</th></tr></thead><tbody>';
    const slots = ['武器', '副手', '头部', '身体', '手部', '足部', '腰饰', '饰品'];
    slots.forEach(slot => {
      const it = e[slot];
      h += '<tr><td>' + esc(slot) + '</td>' +
        '<td class="td-name">' + (it ? esc(it.name) : '<span class="dim">—空—</span>') + '</td>' +
        '<td class="td-ops">' + (it ? '<button class="op-btn" data-cmd="remove ' + esc(it.name) + '">卸下</button>' : '') + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function affectsHtml(v) {
    const list = v.affects || [];
    if (!list.length) return '<div class="modal-text">当前无任何状态效果。</div>';
    let h = '<table class="data-table"><thead><tr><th>名称</th><th>类型</th><th>剩余回合</th><th>效果</th></tr></thead><tbody>';
    list.forEach(a => {
      h += '<tr><td class="td-name">' + esc(a.name) + '</td><td>' + esc(a.kind || '') + '</td>' +
        '<td>' + (a.turns != null ? a.turns : '—') + '</td><td>' + esc(a.desc || '') + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  /* ============================================================
   *  江湖舆图（连续大地图）
   *
   *  后端已把每个房间算成网格坐标（见 core/maplayout.js）。
   *  这里把它画成「一格连一格」的连续地图：
   *    · 格子点满不留缝 —— 看起来是一整张图，不是一堆孤立方块
   *    · 走廊用粗线穿过格心，相邻房间连成一片
   *    · 区域用整片底色块铺开，边界即区域轮廓
   *    · 去过的地方显示名字，没去过的只留一个淡点
   * ============================================================ */
  /* 地图尺寸两套（按视口宽度选，见 mapHtml 顶部）：
     桌面维持 30/26/8，手机窄屏放大到 52/46/13 —— 房间名才看得全。
     之所以在 mapHtml 内部算而不放模块级常量：多个测试脚本会把 mapHtml 源码
     单独抽出来在别的环境跑，模块级常量在抽取环境里取不到。 */
  /* ⚠️ 八方向都要有（主人报的「地图显示问题 / 附近位置对不上」）。
     数据里 `exits` 用的是 `n/s/e/w/ne/nw/se/sw`（全图 650 条出口里有 **124 条是斜向**，
     占 19%）。这张表原来只写了 6 个方向，于是：
       · 方位名漏斜向 → 地图抬头印出「出口：北 / 南 / 西 / 东 / **ne**」这种半中半英；
       · 走廊连线漏斜向 → `const d = DIR_OFF[dir]; if (!d) return;` 直接跳过，
         斜着相连的两个房间画出来**互不相连**、看着像隔了老远，
         玩家自然觉得「地图上的位置跟实际对不上」。
     u/d 仍是「上下层」：不画连线（不同楼层画条直线等于骗人），只在出口名里显示。 */
  const DIR_CN = {
    n: '北', s: '南', e: '东', w: '西', u: '上', d: '下',
    ne: '东北', nw: '西北', se: '东南', sw: '西南',
  };
  const DIR_OFF = {
    n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0],
    ne: [1, -1], nw: [-1, -1], se: [1, 1], sw: [-1, 1],
  };

  /* ---- 地图视野范围（两级）：默认只看当前区域，可切世界地图 ----
     主人明确要求：打开地图默认显示**当前区域**，另有开关看全部区域。
     用模块级变量记住选择，重开面板时保持。 */
  let mapScope = 'region';   // 'region' | 'world'

  function mapHtml(v) {
    /* ---- 尺寸自适应（主人报的 bug：手机上地块名看不清 / 看不全）----
       视口宽度 < 640 视为手机窄屏：把格子与字号一起放大，
       名字从「最多 4 字」放宽到「最多 6 字」，46px 方块两行塞得下。
       桌面端（≥640）维持原值 30/26/8，观感零改动。 */
    let vw = 0;
    try {
      if (typeof global !== 'undefined' && global && typeof global.innerWidth === 'number') vw = global.innerWidth;
    } catch (e) { vw = 0; }
    const NARROW = vw > 0 && vw < 640;
    const MAP_CELL = NARROW ? 52 : 30;    // 每格边长（含走廊）
    const MAP_NODE = NARROW ? 46 : 26;    // 格子方块边长
    const MAP_PAD = NARROW ? 30 : 34;     // 画布留白
    const M_LINE = NARROW ? 1.15 : 1;     // 名字行距
    const M_NAME_MAX = NARROW ? 6 : 4;    // 名字最多显示几个字
    const mFont = r => NARROW ? (r.current ? 14 : 13) : (r.current ? 9 : 8);

    const m = v.map || {};
    const allRooms = m.rooms || [];
    if (!allRooms.length) return '<div class="modal-text">地图数据不可用。</div>';

    /* 当前区域 = 有 current 标记的房间所属区域 */
    const here = allRooms.find(r => r.current);
    const curRegion = here ? here.region : null;
    /* mapScope 是模块级状态（记住「当前区域 / 天下全图」的选择）。
       ⚠️ 多个测试脚本会把本函数单独抽出来跑，抽取环境里没有 mapScope；
       故读取一律走本地 sc，只在确实存在时才回写模块状态 —— 抽出环境也能跑。 */
    let sc = (typeof mapScope === 'undefined') ? 'world' : mapScope;
    if (sc === 'region' && !curRegion) sc = 'world';
    if (typeof mapScope !== 'undefined') mapScope = sc;

    const boxes = m.regionBoxes || {};
    /* region 模式：只留当前区域这块 box；world 模式：全图 */
    const scopeBox = (sc === 'region' && boxes[curRegion]) ? boxes[curRegion] : null;

    const rooms = (sc === 'region' && curRegion)
      ? allRooms.filter(r => r.region === curRegion)
      : allRooms;
    if (!rooms.length) return '<div class="modal-text">此区域暂无地图数据。</div>';

    /* 视野裁到本区域 box（多留 1 格余量，房间别贴边） */
    const b0 = m.bounds || { minX: 0, minY: 0, w: 1, h: 1 };
    const b = scopeBox
      ? {
        minX: scopeBox.x, minY: scopeBox.y,
        w: scopeBox.w, h: scopeBox.h,
      }
      : b0;
    const ex = m.explore || { visited: 0, total: allRooms.length };
    const scopeCount = rooms.length;
    const scopeVisited = rooms.filter(r => r.visited).length;

    /* 坐标换算：格心 */
    const cx = r => (r.x - b.minX) * MAP_CELL + MAP_PAD + MAP_CELL / 2;
    const cy = r => (r.y - b.minY) * MAP_CELL + MAP_PAD + MAP_CELL / 2;

    let h = '<div class="map-wrap">';

    /* --- 顶部：当前位置 + 探索进度 --- */
    h += '<div class="map-head">';
    h += '<div class="map-now">你在 <b>' + esc(here ? here.name : '未知') + '</b>';
    if (here && here.exits && here.exits.length) {
      h += '　出口：' + here.exits.map(d => DIR_CN[d] || d).join(' / ');
    }
    h += '</div>';
    /* --- 视野切换：当前区域 / 天下全图 --- */
    h += '<div class="map-scope">';
    h += '<button class="ms-btn' + (sc === 'region' ? ' on' : '') + '" data-scope="region">当前区域</button>';
    h += '<button class="ms-btn' + (sc === 'world' ? ' on' : '') + '" data-scope="world">天下全图</button>';
    h += '<span class="ms-where">' +
      (sc === 'region'
        ? '只显示你脚下这一片：' + esc(((m.regions || []).find(x => x.id === curRegion) || {}).name || '—')
        : '天下三十四州，尽收眼底') +
      '</span></div>';

    const pct = scopeCount ? Math.round(scopeVisited / scopeCount * 100) : 0;
    h += '<div class="map-progress" title="本范围已探索 ' + scopeVisited + '/' + scopeCount +
      '；全江湖 ' + ex.visited + '/' + ex.total + '">' +
      '<span class="mp-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="mp-txt">本范围 ' + scopeVisited + '/' + scopeCount +
      '　全江湖 ' + ex.visited + '/' + ex.total + '</span></div>';
    h += '</div>';

    /* --- 图例 --- */
    h += '<div class="map-legend">' +
      '<span><i class="dot dot-here"></i>你在这里</span>' +
      '<span><i class="dot dot-near"></i>一步可达</span>' +
      '<span><i class="dot dot-known"></i>去过</span>' +
      '<span><i class="dot dot-unknown"></i>未探索</span>' +
      '<span class="ml-tip">点「一步可达」的格子直接走过去</span></div>';

    /* --- 画布 --- */
    const W = b.w * MAP_CELL + MAP_PAD * 2;
    const H = b.h * MAP_CELL + MAP_PAD * 2;
    h += '<div class="map-canvas' + (NARROW ? ' map-narrow' : '') + '" style="width:' + W + 'px;height:' + H + 'px">';

    /* 1) 底：整张网格纸（让它看起来是一张连续地图） */
    h += '<div class="map-grid-bg" style="width:' + (b.w * MAP_CELL) + 'px;height:' + (b.h * MAP_CELL) + 'px;' +
      'left:' + MAP_PAD + 'px;top:' + MAP_PAD + 'px;background-size:' + MAP_CELL + 'px ' + MAP_CELL + 'px"></div>';

    /* 2) 区域底色块（铺满区域包围盒）—— region 模式只画当前区域 */
    const boxes2 = scopeBox ? { [curRegion]: scopeBox } : boxes;
    Object.keys(boxes2).forEach(k => {
      const box = boxes[k];
      const left = (box.x - b.minX) * MAP_CELL + MAP_PAD;
      const top = (box.y - b.minY) * MAP_CELL + MAP_PAD;
      const bw = box.w * MAP_CELL;
      const bh = box.h * MAP_CELL;
      h += '<div class="map-region-box" style="left:' + left + 'px;top:' + top + 'px;' +
        'width:' + bw + 'px;height:' + bh + 'px;background:' + esc(box.color) + '14;border-color:' + esc(box.color) + '44">' +
        '<span class="mrb-label" style="color:' + esc(box.color) + ';font-size:' + (NARROW ? 15 : 11) + 'px">' + esc(box.name) + '</span></div>';
    });

    /* 3) 地形装饰（树石山水…）
       注意：后端 maplayout 已把区域内相对坐标翻译成全局布局坐标，
       这里和 rooms 用同一套 cx()/cy() 换算，**不要再减 box.x/box.y**。
       层级放在区域底色之后、走廊之前，才会被房间格与走廊压住。 */
    const TERRAIN_GLYPH = {
      tree: '♣', rock: '▲', grass: '⁛', water: '≈', sand: '·',
      snow: '❄', road: '▬', wall: '▓', farm: '⌗', cloud: '☁',
    };
    const TERRAIN_CLS = {
      tree: 'tr-tree', rock: 'tr-rock', grass: 'tr-grass', water: 'tr-water',
      sand: 'tr-sand', snow: 'tr-snow', road: 'tr-road', wall: 'tr-wall',
      farm: 'tr-farm', cloud: 'tr-cloud',
    };
    const terrain = m.terrain || {};
    const terrRegions = (sc === 'region' && curRegion) ? [curRegion] : Object.keys(terrain);
    let terrainHtml = '';
    terrRegions.forEach(rid => {
      (terrain[rid] || []).forEach(t => {
        const gx = cx({ x: t.x });
        const gy = cy({ y: t.y });
        terrainHtml += '<i class="map-terrain ' + (TERRAIN_CLS[t.type] || 'tr-grass') +
          '" style="left:' + gx + 'px;top:' + gy + 'px;width:' + MAP_CELL + 'px;height:' + MAP_CELL + 'px;' +
          'line-height:' + MAP_CELL + 'px;font-size:' + (NARROW ? 24 : 15) + 'px" title="' + esc(t.type) + '">' +
          (TERRAIN_GLYPH[t.type] || '⁛') + '</i>';
      });
    });
    h += '<div class="map-terrain-layer">' + terrainHtml + '</div>';

    /* 4) 走廊：一条 path 画完所有连通线（相邻房间连成一片） */
    const posOf = {};
    rooms.forEach(r => { posOf[r.id] = r; });
    let paths = '';
    let pathsKnown = '';
    rooms.forEach(r => {
      (r.exits || []).forEach(dir => {
        const d = DIR_OFF[dir];
        if (!d) return;
        const nb = rooms.find(x => x.x === r.x + d[0] && x.y === r.y + d[1]);
        if (!nb) return;
        const x1 = cx(r), y1 = cy(r), x2 = cx(nb), y2 = cy(nb);
        const seg = 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + ' ';
        if (r.visited && nb.visited) pathsKnown += seg;
        else paths += seg;
      });
    });
    h += '<svg class="map-edges" width="' + W + '" height="' + H + '">' +
      '<path d="' + paths + '" class="edge edge-dim"/>' +
      '<path d="' + pathsKnown + '" class="edge edge-known"/></svg>';

    /* 4) 房间格子：方块填满格子，连成一整片 */
    const off = (MAP_CELL - MAP_NODE) / 2;
    rooms.forEach(r => {
      const left = (r.x - b.minX) * MAP_CELL + MAP_PAD + off;
      const top = (r.y - b.minY) * MAP_CELL + MAP_PAD + off;
      let cls = 'map-node';
      if (r.current) cls += ' here';
      else if (r.near) cls += ' near';
      else if (r.reach) cls += ' reach';
      else if (r.visited) cls += ' known';
      else cls += ' unknown';
      const reg = (m.regions || []).find(x => x.id === r.region);
      const stripe = reg ? reg.color : '#999';
      const known = r.visited || r.current || r.near || r.reach;
      /* 窄屏名字最多 6 字（46px 方块两行塞得下），桌面仍是 4 字 */
      const label = r.current ? '你' : (known ? shortName(r.name, M_NAME_MAX) : '');
      h += '<button class="' + cls + '" style="left:' + left + 'px;top:' + top + 'px;' +
        'width:' + MAP_NODE + 'px;height:' + MAP_NODE + 'px;' +
        '--stripe:' + esc(stripe) + '"' +
        ' title="' + esc(r.name) + (r.region ? '（' + esc((reg && reg.name) || r.region) + '）' : '') +
        (r.dist >= 0 ? '　' + r.dist + ' 步' : '　未探索') + '"' +
        ' data-room="' + esc(r.id) + '"' +
        (r.near ? ' data-go="' + esc(r.id) + '"' : '') + '>' +
        '<span class="mn-name" style="font-size:' + mFont(r) + 'px;line-height:' + M_LINE + '">' + esc(label) + '</span></button>';
    });

    h += '</div>';

    /* --- 快速移动：一步可达 --- */
    const nears = rooms.filter(r => r.near);
    if (nears.length) {
      h += '<div class="map-quick"><span class="mq-title">一步可达</span>';
      nears.forEach(r => {
        h += '<button class="mq-btn" data-go="' + esc(r.id) + '">' + esc(r.name) + '</button>';
      });
      h += '</div>';
    }

    /* --- 区域总览 --- */
    h += '<div class="map-regions-overview">';
    (m.regions || []).slice().sort((a, bb) => (bb.visitedCount || 0) - (a.visitedCount || 0)).forEach(r => {
      h += '<div class="mro-item' + (r.hasCurrent ? ' cur' : '') + '" data-region="' + esc(r.id) + '">' +
        '<i class="mro-dot" style="background:' + esc(r.color || '#999') + '"></i>' +
        '<span class="mro-name">' + esc(r.name) + '</span>' +
        '<span class="mro-num">' + (r.visitedCount || 0) + '/' + (r.count || 0) + '</span></div>';
    });
    h += '</div>';

    h += '</div>';
    return h;
  }

  /* 房间名太长就砍一刀，格子里塞得下。
     max = 小屏可放宽（窄屏 6 字、桌面 4 字）；不传时保持老行为（4 字）。 */
  function shortName(n, max) {
    n = String(n || '');
    const cap = max || 4;
    return n.length > cap ? n.slice(0, cap) : n;
  }

  function helpHtml() {
    const groups = [
      ['行走', [
        'n / s / e / w / u / d　（中文：北 南 东 西 上 下）',
        'go <方向|房间名>　（中文：去 / 前往 / 走）',
        'look / l　查看四周（中文：看 / 观察 / 周围）',
        'look <人物|物品>　细看',
        '爬山坡 / 跳崖 / 渡河　互动出口（看四周时会提示）',
      ]],
      ['交流', [
        'say <内容>　说话（中文：说）',
        'me <动作>　做动作（中文：动作）',
        'shout <内容>　大喊（中文：喊）',
        'tell <人物> <内容>　密语（中文：密语）',
        'nick <称号>　改称号（中文：称号）',
      ]],
      ['物品', [
        'i / inventory　背包（中文：背包 / 行囊）',
        'get <物品>　拾取（中文：捡 / 拿 / 拾取）',
        'drop <物品>　丢弃（中文：丢 / 放下）',
        'use <物品>　使用（中文：吃 / 喝 / 使用）',
        'wear <装备> / wield <武器>　穿戴（中文：穿 / 装备上 / 持）',
        'remove <装备>　卸下（中文：卸下 / 脱）',
      ]],
      ['武学', [
        'skills　武学列表（中文：武学 / 武功）',
        'learn <人物> <武学>　请教（中文：学 / 学习）',
        'lian / train <武学>　修炼（耗内力；内功可冲奇经八脉）',
        'lian / train　打坐（恢复内力）（中文：练 / 练功 / 打坐）',
        'cuti <武学>　淬体（外功根基，伤气血耗体力，宜备丹药）',
        '炼丹 <方> / 炼器 <方> / 画符 <方>　须有对应器具与材料',
        'enable <武学>　启用',
        'perform / pf <招式>　出招（刀枪棍剑类须持对应兵刃）',
        'forget <武学>　遗忘',
      ]],
      ['师承 · 宗门', [
        '收徒 <人名>　收徒（须好感≥30 且你有武学）',
        '弟子　列弟子',
        '授艺 <人名> <武学>　传艺',
        '逐出师门 <人名>　逐出弟子',
        '创宗 <名字>　自立门户（中文：建宗 / 开宗立派）',
        '招贤 <人名> / 演武 / 大比 / 解散宗门',
      ]],
      ['家园', [
        '地块　看家园地块（中文：家园地块）',
        '开垦 <地块>　在主院开垦或扩建（中文：拓地 / 开辟）',
        '资助 <人名> [档位]　替 NPC 盖宅（中文：建家）',
      ]],
      ['门派', [
        'sect　门派信息（中文：门派）',
        'join <门派>　拜师（中文：拜师 / 入门）',
        'leave　叛出师门',
        'promote　晋升',
        'contribute　贡献',
      ]],
      ['战斗', [
        'kill <人物>　出手（中文：动手）',
        'flee　逃跑',
        'auto　自动战斗',
      ]],
      ['任务', [
        'quests　任务日志（中文：任务）',
        'accept <任务>　接任务（中文：接取 / 接任务）',
        'report　汇报（中文：交任务 / 交差）',
        'abandon <任务>　放弃（中文：放弃 / 放弃任务）',
      ]],
      ['店铺', [
        'list <商人>　看货',
        'buy <物品> [数量]　购买',
        'sell <物品> [数量]　出售',
      ]],
      ['姻缘', [
        '提亲 <人名> [酒楼|家中]　议亲下聘',
        '请客 <人名>　邀人来喝喜酒',
        '办酒　正式开席（宾客到齐加好感）',
        '入洞房　在你或 TA 的家中成礼',
        '纳妾 <人名>　须先有正室',
        '结缘 <人名>　不限性别，须不满 45 岁',
        '姻缘　查看配偶 / 妾室 / 结缘',
      ]],
      ['结拜', [
        '结拜 <人名>　自动判辈分（义父义母 / 义兄弟义姐妹）',
        '亲人　义亲名册',
        '断义 <人名>　割袍断义',
      ]],
      ['家宅', [
        '买宅 <名称>　须在衙门·签押房（最便宜 800 文）',
        '卖宅 / 回家　转手 / 回府',
        '布置 <描述>　改自家陈设',
        '置办 <家具>　添置家当',
        '家宅　查看名下产业',
      ]],
      ['营生', [
        '打工 / work　酒楼跑堂、药店抓药赚钱（费饱食/饮水）',
        '卖身　卖身青楼换银钱（仅女子，去青楼）',
        '接客　应酬攒赎身钱（卖身后）',
        '赎身　凑钱脱籍',
        '身世　查看营生 / 卖身状态',
      ]],
      ['采集·农事', [
        '打水　水源边打水解渴（需容器：陶罐/皮水囊/水葫芦）',
        '切割　切野兽尸体取肉皮（需利器：猎刀/剔骨尖刀）',
        '加工　客栈/酒楼把生肉做熟',
        '买地　田头佃户家置田',
        '种植 <稻种|菜种> / 收割　种庄稼收成',
        '偷庄稼　偷别人田（被发现会通缉）',
      ]],
      ['系统', [
        'save / load　存读档（中文：存档 / 读档）',
        'mods　模组',
        'map　地图（中文：地图 / 舆图）',
        'score / sc　状态（中文：状态）',
        'attr　属性（中文：属性）',
        'time　时辰（中文：时间）',
      ]],
      ['中文口语', ['「往北走」「看看四周」「查看背包」「打坐」「练功」等自然语言均可识别']]
    ];
    let h = '<div class="help-grid">';
    groups.forEach(g => {
      h += '<div class="help-card"><div class="hc-title">' + esc(g[0]) + '</div><ul>' +
        g[1].map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
    });
    h += '</div>';
    return h;
  }

  function bindPanelActions(name) {
    /* 表格里的操作按钮 -> 执行指令 */
    document.querySelectorAll('#modal-body .op-btn').forEach(b => {
      b.onclick = () => {
        const c = b.getAttribute('data-cmd');
        closeModal();
        if (c) doCmd(c, { fromButton: true });
      };
    });

    /* 地图：点击一步可达的房间 -> 自动走过去 */
    if (name === 'map') {
      document.querySelectorAll('#modal-body [data-go]').forEach(b => {
        b.onclick = () => {
          const id = b.getAttribute('data-go');
          const room = (S.view && S.view.map && (S.view.map.rooms || []).find(r => r.id === id)) || null;
          if (!room) return;
          closeModal();
          /* ★ 优先用**方向**走，别再只认房间名（主人报的「地图上显示的附近位置与
             人物实际所在位置不符」）。
             原来这一步写的是 `doCmd('go ' + room.name)`（注释里写着「优先用方向，
             否则用房间名」，代码却只做了后半句）。`go <名字>` 是**按名字找**：
             江湖上同名/近名的房间一多（「客栈」「山道」「小巷」满地都是），
             点的是地图上紧挨着你的那一格，人却被带去了**另一个同名房间** ——
             位置自然「对不上」。
             方向是**当前房间自己的出口**（`view.exits[].dir → to`），一对一，
             不可能走错。只有「一步可达」的格子才有方向，所以查不到才退回名字。 */
          const ex = ((S.view && S.view.exits) || [])
            .find(x => x && x.to === id && !x.locked);
          if (ex) return doCmd(ex.dir, { fromButton: true });
          doCmd('go ' + room.name, { fromButton: true });
        };
      });

      /* 视野切换：当前区域 / 天下全图 */
      document.querySelectorAll('#modal-body [data-scope]').forEach(b => {
        b.onclick = () => {
          mapScope = b.getAttribute('data-scope') || 'region';
          closeModal();
          panel('map');
        };
      });

      /* 区域总览：点某个区域 -> 切到世界地图看全图 */
      document.querySelectorAll('#modal-body .mro-item[data-region]').forEach(b => {
        b.onclick = () => {
          mapScope = 'world';
          closeModal();
          panel('map');
        };
      });

      /* 触屏没有 hover，方块上的 title 提示看不到 ——
         点「看得到但走不到」的格子，弹出完整房间名（主人报的「地块名看不全」）。
         可走的格子（data-go）已另有 onclick，跳过，别抢它的「走过去」。
         未探索的仍保持神秘，只提示「尚未探索」，不剧透名字。 */
      document.querySelectorAll('#modal-body .map-node[data-room]').forEach(b => {
        if (b.getAttribute('data-go')) return;
        b.onclick = () => {
          const id = b.getAttribute('data-room');
          const room = (S.view && S.view.map && (S.view.map.rooms || []).find(r => r.id === id)) || null;
          if (!room) return;
          const known = room.visited || room.current || room.near || room.reach;
          if (!known) return toast('此处尚未探索');
          const rn = ((S.view.map.regions || []).find(x => x.id === room.region) || {}).name || '';
          toast(room.name + (rn ? '（' + rn + '）' : '') + (room.dist >= 0 ? '　' + room.dist + ' 步' : ''));
        };
      });

      /* 斜向平移（主人报的 bug：只能上下/左右滑，滑不出斜角）
         浏览器原生触摸滚动一次只沿一个轴，这里自己接管 pointer 手势：
         按下 → 记起点；移动 → 同时改 scrollLeft 和 scrollTop（真斜向）；
         松开 → 若位移超过阈值则吞掉这次点击，避免拖完误触「走过去」。 */
      bindMapPan();

      /* 开图先把自己挪到视野正中（主人报的「地图上显示的附近位置与人物实际所在位置不符」）。
         画布是「整块区域」大小（窄屏一个 16×16 的区域 = 892×892px），手机可视区只有
         ~343×400。不居中的话，开图停在左上角：玩家自己的格子大概率在视野外，
         眼前看到的全是「别处」，自然觉得地图和实际对不上 —— 再加当时横向还划不动
         （见 .map-canvas 的 max-width 注释），等于永远找不到自己。
         居中后「你在这里」的红点就在正中，「一步可达」的房间自然落在它四周。 */
      centerMapOnHere();
    }
    /* 社交面板：点某人 → 看详情 */
    if (name === 'social') {
      document.querySelectorAll('#modal-body .social-row[data-npc]').forEach(b => {
        b.onclick = () => {
          const nm = b.getAttribute('data-npc');
          closeModal();
          doCmd('favor ' + nm, { fromButton: true });
        };
      });
    }
    /* 姻缘面板：点某人 → 打开他的完整菜单 */
    if (name === 'love') {
      document.querySelectorAll('#modal-body .love-chip[data-npc]').forEach(b => {
        b.onclick = () => {
          const nm = b.getAttribute('data-npc');
          const n = ((S.view && S.view.npcs) || []).find(x => x.name === nm);
          closeModal();
          if (n) openNpcMenu(n);
          else doCmd('favor ' + nm, { fromButton: true });
        };
      });
    }
  }

  /* ============================================================
   *  指令执行
   *
   *  面板类指令（地图 / 背包 / 状态…）不走后端，直接在本地弹面板。
   *  这样「输入框打地图」和「点左侧按钮」体验一致 —— 以前只有按钮能用。
   * ============================================================ */
  const PANEL_CMDS = {
    map: 'map', 地图: 'map', 舆图: 'map', 江湖舆图: 'map', 查看地图: 'map', 打开地图: 'map',
    i: 'inventory', inventory: 'inventory', 背包: 'inventory', 查看背包: 'inventory', 行囊: 'inventory',
    score: 'score', sc: 'score', 状态: 'score', 查看状态: 'score', 状态一览: 'score',
    attr: 'attr', 属性: 'attr', 属性详情: 'attr',
    skills: 'skills', skill: 'skills', 武学: 'skills', 武功: 'skills', 查看武学: 'skills',
    quests: 'quests', quest: 'quests', 任务: 'quests', 任务日志: 'quests',
    sect: 'sect', 门派: 'sect',
    equipment: 'equipment', eq: 'equipment', 装备: 'equipment', 穿戴: 'equipment',
    affects: 'affects', 效果: 'affects', 状态效果: 'affects',
    guide: 'guide', 指引: 'guide', 新手教程: 'guide', 引导: 'guide',
    social: 'social', 社交: 'social', 人脉: 'social', 好感: 'social', 人际关系: 'social',
    love: 'love', 姻缘: 'love', 姻缘簿: 'love', 婚配: 'love', 义亲: 'love', 亲人: 'love',
    home: 'home', 家宅: 'home', 房产: 'home', 我的家: 'home', 我的家宅: 'home', 家园: 'home',
    地块: 'home', 家园地块: 'home', 开垦: 'home', 拓地: 'home', 开辟: 'home', plots: 'home', plot: 'home',
    武馆: 'martial', martial: 'martial',
    修炼: 'martial', 炼丹: 'martial', 炼器: 'martial', 画符: 'martial', 制符: 'martial', 布阵: 'martial',
    符箓: 'martial', 淬体: 'martial', 打坐: 'martial',
    sectfounder: 'found', 创宗: 'found', 招贤: 'found', 逐出师门: 'found', 演武: 'found', 大比: 'found', 解散宗门: 'found',
    recruit: 'found', drill: 'found', contest: 'found', disciple: 'found', tutor: 'found', founded: 'found',
    宗门: 'found',
    slaves: 'slaves', 奴册: 'slaves', 奴仆: 'slaves', 护院: 'slaves', 麻袋: 'slaves', 袋: 'slaves',
    help: 'help', '?': 'help', 帮助: 'help', 指令: 'help', 指令帮助: 'help',
  };

  /** 该指令是不是「打开某个面板」——是就返回面板名 */
  function panelForCmd(cmd) {
    const c = String(cmd || '').trim().toLowerCase();
    return PANEL_CMDS[c] || null;
  }

  /* 「退出游戏」也走本地拦截：退出的动作**只能由界面完成**（后端最多回你一句话，
     关不掉这一局）。所以和面板指令一样，在 doCmd 里就地处理，不打扰后端。
     后端 commands.js 也注册了同名指令 —— 那是给纯文本客户端 / mod 留的体面答复，
     顺带让 help 的「系统」组列得出来。两边都要在，别只留一边。 */
  const QUIT_CMDS = ['quit', 'exit', '退出游戏', '退出', '离开游戏', '回主菜单'];
  function isQuitCmd(cmd) {
    return QUIT_CMDS.indexOf(String(cmd || '').trim().toLowerCase()) >= 0;
  }

  /* 面板 → 新手教程标记。用函数声明而非 const，避免 panel() 在 719 行
     提前访问它时的 TDZ 报错（panel 早于 const 声明但调用发生在加载后，
     仍然用函数更稳妥）。 */
  function panelGuideFlag(name) {
    return { inventory: 'did_bag', score: 'did_score', attr: 'did_score' }[name] || null;
  }

  /* 地图画布双轴（斜向）拖拽平移 */
  function bindMapPan() {
    const el = document.querySelector('#modal-body .map-canvas');
    if (!el || el.__panBound) return;
    el.__panBound = true;
    const sx = { x: 0, y: 0, l: 0, t: 0, on: false, moved: 0 };

    /* ⚠️ 主人报的 bug「手滑动地图划不动」的根因就在这里：
       TouchEvent 上**没有** clientX/clientY —— 坐标在 e.touches[0] 里。
       旧代码对 touchstart/touchmove 直接读 e.clientX（= undefined），
       dx 于是成了 NaN，el.scrollLeft 被赋成 NaN（浏览器忽略），
       结果：桌面上鼠标拖得动，手机上怎么划都不动。
       统一入口按「鼠标事件 → e.clientX / 触摸事件 → touches[0].clientX」取坐标。 */
    const ptOf = e => {
      if (!e) return null;
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && typeof t.clientX === 'number') return { x: t.clientX, y: t.clientY };
      if (typeof e.clientX === 'number') return { x: e.clientX, y: e.clientY };
      return null;
    };

    const down = e => {
      if (e.button != null && e.button !== 0) return;
      const p = ptOf(e);
      if (!p) return;
      sx.on = true; sx.moved = 0;
      sx.x = p.x; sx.y = p.y;
      sx.l = el.scrollLeft; sx.t = el.scrollTop;
      el.classList.add('panning');
    };
    const move = e => {
      if (!sx.on) return;
      const p = ptOf(e);
      if (!p) return;
      const dx = p.x - sx.x, dy = p.y - sx.y;
      sx.moved = Math.max(sx.moved, Math.abs(dx) + Math.abs(dy));
      el.scrollLeft = sx.l - dx;
      el.scrollTop = sx.t - dy;
      if (sx.moved > 4 && e.cancelable) e.preventDefault();
    };
    const up = () => {
      if (!sx.on) return;
      sx.on = false;
      el.classList.remove('panning');
      /* 拖过就别让 click 生效（否则拖完一下会误走路） */
      if (sx.moved > 4) {
        /* 捕获阶段拦，房间格子上挂的 onclick 就不会触发 */
        const swallow = e => { e.preventDefault(); e.stopPropagation(); };
        el.addEventListener('click', swallow, true);
        setTimeout(() => el.removeEventListener('click', swallow, true), 0);
      }
    };
    el.addEventListener('mousedown', down);
    el.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', up);
    window.addEventListener('touchend', up);
    /* 滚轮：横向滚动条在桌面端才看得到，这里补一条竖轮→横移 */
    el.addEventListener('wheel', e => {
      if (e.shiftKey) return;
      if (e.deltaY && !e.deltaX && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += e.deltaY;
        if (e.cancelable) e.preventDefault();
      }
    }, { passive: false });
  }

  /* 把地图画布滚到「你在这里」那一格的正中。
     ⚠️ 房间格子的坐标写在内联 style 里（left/top 由 mapHtml 算好），
     所以这里**从 DOM 反读**，不再把几何算法抄第二遍（抄了迟早和 mapHtml 走偏）。
     用 getAttribute('style') 而不是 el.style.left：DOM stub（测试用的假 DOM）
     只实现了 setAttribute，解析内联串两边都能拿到。 */
  function centerMapOnHere() {
    const canvas = document.querySelector('#modal-body .map-canvas');
    if (!canvas) return false;
    const nodes = document.querySelectorAll('#modal-body .map-node') || [];
    let here = null;
    for (let i = 0; i < nodes.length; i++) {
      const cls = String((nodes[i] && nodes[i].className) || '');
      if (cls.split(/\s+/).indexOf('here') >= 0) { here = nodes[i]; break; }
    }
    if (!here) return false;
    const st = String((here.getAttribute && here.getAttribute('style')) || '');
    const ml = st.match(/left:\s*(-?[\d.]+)px/);
    const mt = st.match(/top:\s*(-?[\d.]+)px/);
    const mw = st.match(/width:\s*(-?[\d.]+)px/);
    if (!ml || !mt) return false;
    const left = parseFloat(ml[1]), top = parseFloat(mt[1]);
    const side = mw ? parseFloat(mw[1]) : 26;   /* 格子边长（窄屏 46 / 桌面 26），居中要减半个 */
    /* 可视尺寸优先取画布本身（受 max-width/max-height 夹过）；
       取不到（老浏览器 / 假 DOM）就退回视口宽，至少别把 scrollLeft 留在 0。 */
    const vw = canvas.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 0);
    const vh = canvas.clientHeight || 0;
    if (vw > 0 && canvas.scrollWidth > vw) canvas.scrollLeft = Math.max(0, left - (vw - side) / 2);
    if (vh > 0 && canvas.scrollHeight > vh) canvas.scrollTop = Math.max(0, top - (vh - side) / 2);
    return true;
  }

  let cmdHistory = [];
  let histIdx = -1;

  /* ============================================================
   *  手机端输入法防弹（主人报的 bug）
   *
   *  症状：在手机上点屏幕上的可交互按钮（出口「北」、NPC 菜单里的「查看/交谈」…），
   *        那一瞬间输入法会弹出来，正好把刚更新的内容遮住，得手动点掉。
   *
   *  根因：doCmd() 结束时无条件 `inp.focus()`。
   *        点按钮 → onclick 调 doCmd → focus 抢回输入框 → 移动端浏览器认为
   *        「用户要输入」，于是拉起软键盘。iOS Safari 尤其明显：
   *        在 input 之外的按钮上点击，有时还会连带把 input 置为激活态。
   *
   *  修法（三条一起，缺一不可）：
   *    1. 只在「本次指令是用户**主动在输入框里敲回车**」时才把焦点还给输入框；
   *       从按钮/面板点进来的绝不抢。
   *    2. 按钮点击时先主动 blur 输入框，断掉移动端那条「点击即激活」的隐式链。
   *    3. 记录「命令是哪儿来的」（fromButton / fromInput），
   *       据此决定结束要不要 refocus。
   * ============================================================ */

  /** 判断是不是触屏设备（用于决定要不要折腾输入法的行为） */
  function isTouchDevice() {
    try {
      if (typeof navigator === 'undefined') return false;
      if (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) return true;
      if ('ontouchstart' in global) return true;
      return /Android|iPhone|iPad|iPod|Mobile|Win Phone/i.test((navigator.userAgent || ''));
    } catch (e) { return false; }
  }

  /** 主动把输入框的焦点与激活态都断掉（治 iOS「点了按钮输入框反而亮了」） */
  function blurCmdInput() {
    const inp = $('cmd-input');
    if (!inp) return;
    try { if (typeof inp.blur === 'function') inp.blur(); } catch (e) { /* 老浏览器 stub 没这方法 */ }
    try { inp.classList.remove('focused'); } catch (e) { /* noop */ }
    /* 触屏机型：再补一刀 readonly —— 部分 Android 浏览器即使 blur 了，
       只要 input 处于「可编辑」状态，下一次 touchend 仍会拉起软键盘。
       下一帧再放开，防某些机型忽略 blur。桌面端不做这层，避免影响正常输入。 */
    if (!isTouchDevice()) return;
    try { inp.setAttribute('readonly', 'readonly'); } catch (e) { /* noop */ }
    setTimeout(() => {
      try { inp.removeAttribute('readonly'); } catch (e) { /* noop */ }
    }, 80);
  }

  async function doCmd(cmd, opts) {
    cmd = String(cmd || '').trim();
    if (!cmd) return;
    /* 记来源：默认当作「用户主动敲的」（老调用点全部保持原行为，不破坏任何既有逻辑） */
    const fromButton = !!(opts && opts.fromButton);
    if (S.busy) { toast('上一道指令还在执行…', 'warn', 1200); return; }

    /* 面板类指令：本地开面板，不打扰后端。
       新手教程标记由 panel() 内部统一上报，这里不再重复上报。 */
    const pn = panelForCmd(cmd);
    if (pn) {
      pushHistory(cmd);
      appendLog([{ type: 'cmd', text: '> ' + cmd }]);
      if (fromButton) blurCmdInput();
      return panel(pn);
    }

    /* 退出游戏：同样本地解决。放在这里而不是后端，是因为「回主菜单」是界面行为
       （要切屏、要刷「继续游戏」按钮），后端返回的文本做不到。 */
    if (isQuitCmd(cmd)) {
      pushHistory(cmd);
      appendLog([{ type: 'cmd', text: '> ' + cmd }]);
      if (fromButton) blurCmdInput();
      return quitGame();
    }

    pushHistory(cmd);
    appendLog([{ type: 'cmd', text: '> ' + cmd }]);

    /* 按钮点进来的：先把输入框的焦点/激活态断掉，别在指令执行期间就把键盘拉起来 */
    if (fromButton) blurCmdInput();

    S.busy = true;
    setCmdEnabled(false);
    try {
      const d = await api.exec(cmd);
      afterAction(d);
    } catch (e) {
      appendLog([{ type: 'warn', text: e.message }]);
      toast(e.message, 'error');
    } finally {
      S.busy = false;
      setCmdEnabled(true);
      const inp = $('cmd-input');
      /* 只在「本来就是从输入框敲回车来的」时才把焦点还回去。
         按钮来的绝不在这里 focus，否则手机键盘又弹出来（就是主人报的这个 bug）。 */
      if (inp && !fromButton) inp.focus();
    }
  }

  function pushHistory(cmd) {
    if (cmdHistory[cmdHistory.length - 1] !== cmd) cmdHistory.push(cmd);
    if (cmdHistory.length > 120) cmdHistory.shift();
    histIdx = cmdHistory.length;
  }

  function setCmdEnabled(on) {
    const inp = $('cmd-input'), btn = $('cmd-send');
    if (inp) inp.disabled = !on;
    if (btn) btn.disabled = !on;
  }

  /* 统一处理一次动作的返回 */
  function afterAction(d) {
    if (!d) return;
    const v = d.view || (d.ok !== undefined ? d : null);

    /* 新的一批日志 */
    if (d.log && d.log.length) appendLog(d.log);
    else if (d.lines && d.lines.length) appendLog(d.lines);

    /* 视图 */
    if (d.view) {
      S.view = d.view;
      renderAll(d.view);
    }

    /* 需要弹选择框 */
    if (d.choices) {
      choices(d.choicesTitle || '请选择', d.choices, it => {
        if (it.cmd) doCmd(it.cmd, { fromButton: true });
        else if (it.action) api.menu({ action: it.action, key: it.key, uid: it.uid }).then(afterAction).catch(e => toast(e.message, 'error'));
      });
    }

    /* 弹窗（例如商店） */
    if (d.modal) {
      modal(d.modal.title || '', d.modal.body || '', d.modal.foot || '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    }

    /* 致命 / 结束 */
    if (d.ending) {
      choices('—— ' + (d.ending.title || '故事终章') + ' ——', [
        { label: '重新开始江湖', action: 'restart' },
        { label: '返回主菜单', action: 'menu' }
      ], it => {
        if (it.action === 'restart') doCmd('rebirth', { fromButton: true });
        else show('start');
      });
    }

    /* 一步一存档：每次指令执行后都落一次盘（走一步/输指令/点按钮/增减状态物品
       都走 doCmd → afterAction，这里统一兜住） */
    if (d.view) autoSave();
  }

  /* ============================================================
   *  自动存档（一步一存：每次指令后落盘；槽位按设备标识隔离）
   * ============================================================ */
  let _autosaveTimer = null;
  let _autosavePending = false;
  function autosaveId() {
    const dev = (global.WX && global.WX.S && global.WX.S.deviceId) || 'dev';
    return 'autosave_' + dev;
  }
  function autoSave() {
    if (!S.settings.autosave) return;
    if (!S.view || !S.view.player) return;
    if (_autosavePending) return;   /* 上一次还在写，跳过（防高频重复） */
    _autosavePending = true;
    const key = autosaveId();
    api.save(key)
      .then(d => cloudSave(key, d && d.data))
      .catch(() => { /* 静默，失败不打扰 */ })
      .finally(() => { _autosavePending = false; });
  }

  /* ============================================================
   *  退出游戏（quit / 退出游戏 / 侧栏「返回主菜单」共用这一条路）
   *
   *  三条规矩，都是「别让玩家白玩」：
   *    ① 先问一句 —— 敲错一个字就退出，谁都要骂人；
   *    ② 退出前**先存档**（有人关掉了自动存档，也不能因此丢进度）；
   *    ③ 回主菜单后要把「继续游戏」按钮刷出来 —— 否则刚退出就看不到自己的档，
   *       玩家会以为进度没了。
   * ============================================================ */
  async function quitGame() {
    /* 没进游戏（还在标题/创建角色）时不必问，也没什么可存 */
    if (!S.view || !S.view.player) { show('start'); return; }
    const ok = await confirmBox('退出游戏', '退出前会先替你存好进度。确定回主菜单吗？', '退 出');
    if (!ok) return;

    appendLog([{ type: 'info', text: '你收拢行囊，退出了江湖。' }]);
    let saved = false;
    try {
      const key = autosaveId();
      const d = await api.save(key);
      cloudSave(key, d && d.data);
      saved = true;
    } catch (e) {
      /* 存不上也不能把人锁在游戏里 —— 只是老实告诉玩家这次没存成 */
    }

    show('start');
    try {
      const d = await api.saves();
      const has = ((d && d.saves) || []).length > 0;
      const btn = $('btn-continue');
      if (btn) btn.style.display = has ? '' : 'none';
      const nb = $('btn-newgame');
      if (nb) nb.classList.toggle('primary', !has);
    } catch (e) {
      /* 主菜单自己还会再探一次存档，这里失败不影响 */
    }
    toast(saved ? '已退出游戏（进度已保存）' : '已退出游戏（这次没能存上，下次记得手动存档）',
      saved ? 'ok' : 'warn');
  }

  /* 登录态下把存档也落一份到云端（换设备接着玩） */
  function cloudSave(key, data) {
    const C = global.WXCLOUD;
    if (!C || !C.available() || !data) return;
    C.auth.user().then(user => {
      if (!user) return;
      const p = (S.view && S.view.player) || {};
      C.saves.upsert(key, data, {
        name: p.name, level: p.level, room: p.room, playTime: data.clockMinutes || 0
      }).catch(() => { /* 云存失败静默，本地已有 */ });
    }).catch(() => {});
  }
  function startAutoSave() {
    /* 兜底：万一玩家挂机不动，也 5 分钟补一次（一步一存是主力） */
    if (_autosaveTimer) clearInterval(_autosaveTimer);
    _autosaveTimer = setInterval(() => autoSave(), 5 * 60 * 1000);
  }

  /* ============================================================
   *  统一渲染
   * ============================================================ */
  function renderAll(v) {
    if (!v) return;
    renderTopbar(v.player || {});
    renderRoom(v);
    renderScene(v);
    renderCombat(v);
    renderQuickbar(v);
    /* 有玩家了就启动自动存档定时器（懒启动，幂等） */
    if (v.player) startAutoSave();
  }

  /* 快捷指令条 */
  /* ---- 快捷键（可自定义，存 localStorage）---- */
  const DEFAULT_QUICKBAR = [
    { label: '查看四周', cmd: 'look' },
    { label: '背包', cmd: 'i' },
    { label: '武学', cmd: 'skills' },
    { label: '状态', cmd: 'sc' },
    { label: '打坐', cmd: 'meditate' },
    { label: '运功疗伤', cmd: 'heal' },
    { label: '地图', cmd: 'map' },
    { label: '任务', cmd: 'quests' },
    { label: '帮助', cmd: 'help' },
    { label: '新手教程', cmd: 'guide' },
  ];

  function loadQuickbar() {
    try {
      const s = localStorage.getItem('wx_quickbar');
      if (s) {
        const arr = JSON.parse(s);
        if (Array.isArray(arr) && arr.length) return arr.filter(x => x && x.cmd);
      }
    } catch (e) { }
    return DEFAULT_QUICKBAR.map(x => ({ label: x.label, cmd: x.cmd }));
  }
  function saveQuickbar(list) {
    try { localStorage.setItem('wx_quickbar', JSON.stringify(list)); } catch (e) { }
  }

  function renderQuickbar(v) {
    const box = $('quickbar');
    if (!box) return;
    const p = v.player || {};
    const inCombat = !!v.combat;
    let items;

    if (inCombat) {
      items = [
        { label: '普通攻击', cmd: 'auto' },
        { label: '全力一击', cmd: 'attack' },
        { label: '防御', cmd: 'defend' },
        { label: '逃跑', cmd: 'flee' }
      ];
    } else {
      items = loadQuickbar();
      if (p.sectName) items.push({ label: '门派', cmd: 'sect' });
    }

    box.innerHTML = items.map(it =>
      '<button class="qb-btn" data-cmd="' + esc(it.cmd) + '">' + esc(it.label) + '</button>').join('') +
      /* ☰ 菜单：手机端唯一的面板 / 系统入口。
         ⚠️ 窄屏（≤820px）CSS 会把 #sidebar 整个 display:none，桌面上点得到的
            属性 / 装备 / 姻缘义亲 / 家宅 / 保存进度 / 设置 / 返回主菜单，
            在手机上**一个入口都没有**（「设置」「保存进度」也不在指令表里）；
            战斗态快捷条又被换成攻击键，连背包都点不开（触屏验收第 9 条因此必挂）。
         桌面端侧栏还在，.qb-menu 由 CSS 藏起来（见 main.css），不重复。 */
      '<button class="qb-btn qb-menu" id="qb-menu" title="打开菜单（面板 / 存档 / 设置）">☰ 菜单</button>' +
      (inCombat ? '' : '<button class="qb-btn qb-edit" id="qb-edit" title="编辑快捷键">⚙ 编辑</button>');
    box.querySelectorAll('.qb-btn[data-cmd]').forEach(b => {
      b.onclick = () => doCmd(b.getAttribute('data-cmd'), { fromButton: true });
    });
    const menuBtn = $('qb-menu');
    if (menuBtn) menuBtn.onclick = openSideMenu;
    const edit = $('qb-edit');
    if (edit) edit.onclick = openQuickbarEditor;
  }

  /* 手机端「☰ 菜单」：等价于左侧栏那套面板 + 系统动作。
     数据与侧栏同源（下面 bindSidebar / doSidebarAct 共用），别各写一份。
     ⚠️ 不变式（`tools/smoke-uiux.js` §7 会钉住）：**本清单必须覆盖 `index.html`
        `#sidebar` 里每一个 `data-panel` / `data-act`** —— 否则窄屏（侧栏 display:none）
        那个面板在手机上就又没有入口了，而且不会有人发现。
     ⚠️ 本清单比侧栏多出两项（`slaves` 奴册·护院 / `guide` 江湖指引）：它们**根本不在
        侧栏里**，桌面端只能靠指令或快捷条进；留在 ☰ 里是有意的，§7 把它们记为「已知多余项」，
        别的多余项仍会报红。 */
  function openSideMenu() {
    const list = [
      { label: '状态', panel: 'score' },
      { label: '属性', panel: 'attr' },
      { label: '武学', panel: 'skills' },
      { label: '任务', panel: 'quests' },
      { label: '门派', panel: 'sect' },
      { label: '武学修为', panel: 'martial' },
      { label: '宗门 · 师承', panel: 'found' },
      { label: '背包', panel: 'inventory' },
      { label: '装备', panel: 'equipment' },
      { label: '状态效果', panel: 'affects' },
      { label: '人情往来', panel: 'social' },
      { label: '姻缘义亲', panel: 'love' },
      { label: '我的家宅', panel: 'home' },
      { label: '奴册 · 护院', panel: 'slaves' },
      { label: '地图', panel: 'map' },
      { label: '指令帮助', panel: 'help' },
      { label: '江湖指引', panel: 'guide' },
      { label: '保存进度', act: 'save', hint: '存到本机' },
      { label: '读取存档', act: 'loadlist' },
      { label: 'MOD 管理', act: 'modcenter' },
      { label: 'MOD 制作器', act: 'modmaker' },
      { label: '设置', act: 'settings' },
      { label: '返回主菜单', act: 'backmenu', hint: '会先替你存档' },
    ];
    choices('菜单', list, it => {
      if (it.panel) return panel(it.panel);
      if (it.act) return doSidebarAct(it.act);
    });
  }

  /* 编辑快捷键：增删改 + 恢复默认 */
  function openQuickbarEditor() {
    let list = loadQuickbar();

    function paint() {
      const box = $('qb-edit-list');
      box.innerHTML = list.map((it, i) =>
        '<div class="qb-edit-row">' +
        '<input class="qb-e-label" data-i="' + i + '" value="' + esc(it.label) + '" placeholder="按钮文字">' +
        '<input class="qb-e-cmd" data-i="' + i + '" value="' + esc(it.cmd) + '" placeholder="指令">' +
        '<button class="mini-btn danger" data-del="' + i + '">删</button>' +
        '</div>').join('');
      box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
        list.splice(+b.getAttribute('data-del'), 1);
        paint();
      });
      box.querySelectorAll('.qb-e-label').forEach(inp => inp.oninput = () => { list[+inp.getAttribute('data-i')].label = inp.value; });
      box.querySelectorAll('.qb-e-cmd').forEach(inp => inp.oninput = () => { list[+inp.getAttribute('data-i')].cmd = inp.value; });
    }

    modal('编辑快捷键',
      '<div class="modal-text">按钮文字随便起，指令填<b>英文或中文</b>都行（如 look、背包、help、guide）。改完点保存。</div>' +
      '<div class="qb-edit-list" id="qb-edit-list"></div>' +
      '<button class="btn-mini" id="qb-add">＋ 加一行</button>',
      '<button class="btn-ink" id="qb-reset">恢复默认</button>' +
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>' +
      '<button class="btn-ink primary" id="qb-save">保 存</button>');

    paint();

    $('qb-add').onclick = () => { list.push({ label: '', cmd: '' }); paint(); };
    $('qb-reset').onclick = () => { list = DEFAULT_QUICKBAR.map(x => ({ label: x.label, cmd: x.cmd })); paint(); };
    $('qb-save').onclick = () => {
      const clean = list.filter(x => x && x.cmd && x.cmd.trim());
      if (!clean.length) { toast('至少要有一个快捷键', 'warn'); return; }
      saveQuickbar(clean);
      closeModal();
      renderQuickbar(S.view || {});
      toast('快捷键已保存', 'ok');
    };
  }

  /* ============================================================
   *  设置面板
   * ============================================================ */
  function openSettings() {
    const s = S.settings;
    modal('设置',
      '<div class="settings">' +
      '<div class="set-row"><label>字体大小</label><input type="range" id="set-font" min="80" max="140" step="5" value="' + s.font + '"><span id="set-font-v">' + s.font + '%</span></div>' +
      '<div class="set-row"><label>界面动画</label><button class="switch' + (s.anim ? ' on' : '') + '" id="set-anim">' + (s.anim ? '开' : '关') + '</button></div>' +
      '<div class="set-row"><label>自动存档</label><button class="switch' + (s.autosave ? ' on' : '') + '" id="set-auto">' + (s.autosave ? '开' : '关') + '</button></div>' +
      '<div class="set-row"><label>紧凑模式</label><button class="switch' + (s.narrow ? ' on' : '') + '" id="set-narrow">' + (s.narrow ? '开' : '关') + '</button></div>' +
      '<div class="set-row"><label>Mod 网站地址</label><input type="text" id="set-site" class="modal-input" value="' + esc((S.siteConfig && S.siteConfig.apiBase) || 'http://127.0.0.1:8788') + '"></div>' +
      '</div>',
      '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>' +
      '<button class="btn-ink primary" id="set-save">保 存</button>');

    $('set-font').oninput = e => {
      const v = +e.target.value;
      $('set-font-v').textContent = v + '%';
      document.documentElement.style.fontSize = (16 * v / 100) + 'px';
    };
    ['anim', 'auto', 'narrow'].forEach(k => {
      const btn = $('set-' + k);
      btn.onclick = () => {
        S.settings[k] = !S.settings[k];
        btn.classList.toggle('on', S.settings[k]);
        btn.textContent = S.settings[k] ? '开' : '关';
        if (k === 'narrow') applySettings();
      };
    });
    $('set-save').onclick = async () => {
      const site = $('set-site').value.trim();
      global.WX.saveSettings();
      if (site) {
        try {
          const cfg = Object.assign({}, S.siteConfig || {}, { apiBase: site });
          await api.siteSetConfig(cfg);
        } catch (e) { toast('网站地址保存失败：' + e.message, 'warn'); }
      }
      applySettings();
      closeModal();
      toast('设置已保存', 'ok');
    };
  }

  function applySettings() {
    const s = S.settings;
    document.documentElement.style.fontSize = (16 * s.font / 100) + 'px';
    document.body.classList.toggle('narrow', !!s.narrow);
    const bg = $('bg-art');
    if (bg) bg.style.display = s.anim ? '' : 'none';
  }

  /* ============================================================
   *  存档面板
   * ============================================================ */
  async function openSaves(mode) {
    let list = [];
    try {
      const d = await api.saves();
      list = d.saves || [];
    } catch (e) { toast(e.message, 'error'); return; }

    let h = '';

    if (mode === 'save') {
      h += '<div class="modal-text" style="margin:6px 0 12px">' +
        '点任意一份存档即可覆盖它；或点下方「新建存档」。</div>';
    }

    if (!list.length) {
      h += '<div class="modal-text">暂无存档。</div>';
    } else {
      h += '<div class="save-list">';
      list.forEach(s => {
        h += '<div class="save-item"><div class="sv-info">' +
          '<div class="sv-name">' + esc(s.name || s.id) + '</div>' +
          '<div class="sv-meta">' + esc(s.summary || '') + ' · ' + util.fmtTime(s.time || Date.now()) + '</div>' +
          '</div><div class="sv-ops">' +
          (mode === 'load' ? '<button class="op-btn primary" data-load="' + esc(s.id) + '">读取</button>' : '') +
          (mode === 'save' ? '<button class="op-btn primary" data-save="' + esc(s.id) + '">覆盖</button>' : '') +
          '<button class="op-btn danger" data-del="' + esc(s.id) + '">删除</button>' +
          '</div></div>';
      });
      h += '</div>';
    }

    modal(mode === 'load' ? '读取存档' : '保存进度', h,
      (mode === 'save' ? '<button class="btn-ink primary" id="sv-new">新建存档</button>' : '') +
      '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');

    /* 读档 */
    document.querySelectorAll('#modal-body [data-load]').forEach(b => b.onclick = async () => {
      const id = b.getAttribute('data-load');
      closeModal();
      try {
        await api.load(id);
        appendLog([{ type: 'sys', text: '已读取存档：' + id }]);
        renderAll(S.view);
        show('game');
        toast('读取成功', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    });

    /* 覆盖 */
    document.querySelectorAll('#modal-body [data-save]').forEach(b => b.onclick = async () => {
      const id = b.getAttribute('data-save');
      try {
        await api.save(id);
        toast('已保存到 ' + id, 'ok');
        openSaves('save');
      } catch (e) { toast(e.message, 'error'); }
    });

    /* 删除 */
    document.querySelectorAll('#modal-body [data-del]').forEach(b => b.onclick = async () => {
      const id = b.getAttribute('data-del');
      const ok = await confirmBox('删除存档', '确定要删除存档「' + id + '」吗？此操作不可撤销。', '删 除');
      if (!ok) return;
      try { await api.delSave(id); toast('已删除存档', 'ok'); openSaves(mode); }
      catch (e) { toast(e.message, 'error'); }
    });

    const nw = $('sv-new');
    if (nw) nw.onclick = async () => {
      const id = 'save_' + Date.now().toString(36);
      try {
        await api.save(id);
        toast('已新建存档 ' + id, 'ok');
        openSaves('save');
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  /* ============================================================
   *  输入框绑定
   * ============================================================ */
  function bindInput() {
    const inp = $('cmd-input');
    const send = $('cmd-send');
    if (!inp) return;

    const submit = () => {
      const v = inp.value.trim();
      if (!v) return;
      inp.value = '';
      doCmd(v);
    };
    if (send) send.onclick = submit;

    inp.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); return; }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (histIdx > 0) { histIdx--; inp.value = cmdHistory[histIdx] || ''; }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (histIdx < cmdHistory.length - 1) { histIdx++; inp.value = cmdHistory[histIdx] || ''; }
        else { histIdx = cmdHistory.length; inp.value = ''; }
        return;
      }
      if (e.key === 'Escape') { inp.value = ''; inp.blur(); }
    };
  }

  /* 全局快捷键 */
  function bindHotkeys() {
    document.addEventListener('keydown', e => {
      /* Esc 关弹窗 */
      if (e.key === 'Escape') {
        if (!$('choices-mask').classList.contains('hidden')) { closeChoices(); return; }
        if (!$('modal-mask').classList.contains('hidden')) { closeModal(); return; }
      }
      /* 只在游戏界面生效 */
      if (S.screen !== 'game') return;
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;

      /* ⚠️ 面板 / 选择框开着时，屏蔽方向与字母快捷键（还有 1-9 的方向键）。
         否则：开着「背包」「地图」看内容时按 w/a/s/d 会**在弹窗背后偷偷走动**
         —— 弹窗不关、日志在底下变，玩家以为只是翻页。
         数字键更隐蔽：九宫格在弹窗后面的日志里，按 1 会走到「上一个房间」的出口。 */
      const openMask = id => { const m = $(id); return !!(m && m.classList && !m.classList.contains('hidden')); };
      if (openMask('modal-mask') || openMask('choices-mask')) return;

      /* 数字键 1-9 = 方向/快捷。
         方向按钮只剩九宫格（.exit-map）里了。
         ⚠️ 日志里堆着历史房间的出口图，必须只取**最后一个** .exit-map，
         否则数字键会走到上一个房间去。 */
      if (e.key >= '1' && e.key <= '9') {
        const idx = +e.key - 1;
        const rows = document.querySelectorAll('.exit-map');
        const host = rows.length ? rows[rows.length - 1] : null;
        const btns = host
          ? host.querySelectorAll('.exit-inline')
          : document.querySelectorAll('#exits .exit-btn');
        if (btns[idx]) { e.preventDefault(); btns[idx].click(); }
        return;
      }
      /* 单字母方向 */
      const map = { w: 'n', s: 's', a: 'w', d: 'e', q: 'nw', e: 'ne', z: 'sw', c: 'se' };
      const k = e.key.toLowerCase();
      if (map[k] && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); doCmd(map[k]); return;
      }
      if (k === 'l') { e.preventDefault(); doCmd('look'); return; }
      if (k === 'i') { e.preventDefault(); doCmd('i'); return; }
    });
  }

  /* ============================================================
   *  侧栏按钮绑定
   * ============================================================ */
  function bindGuide() {
    const btn = $('guide-detail');
    if (btn) btn.onclick = () => panel('guide');
    const blk = $('guide-block');
    /* 点引导卡片主体也能打开详情 */
    if (blk) {
      const body = blk.querySelector('.guide-body');
      if (body) body.onclick = () => panel('guide');
    }
  }

  /* 侧栏「动作」按钮的统一处理（左侧栏与手机 ☰ 菜单共用一处，别写两份） */
  function doSidebarAct(a) {
    if (a === 'save') return openSaves('save');
    if (a === 'loadlist') return openSaves('load');
    if (a === 'modcenter') return showModCenter();
    if (a === 'modmaker') return showModMaker();
    if (a === 'settings') return openSettings();
    if (a === 'backmenu') {
      /* 与 quit 指令共用同一套：先确认、再存档、再回主菜单。
         以前这里只切屏不存档 —— 关掉自动存档的人点它会白丢一段进度。 */
      return quitGame();
    }
  }

  function bindSidebar() {
    document.querySelectorAll('#sidebar .sb-btn').forEach(b => {
      b.onclick = () => {
        const p = b.getAttribute('data-panel');
        const a = b.getAttribute('data-act');
        if (p) return panel(p);
        if (!a) return;
        doSidebarAct(a);
      };
    });
  }

  /* ============================================================
   *  Mod 管理器 / 制作器 / 市场 的入口占位（具体实现见各自模块）
   * ============================================================ */
  function showModCenter() {
    show('modcenter');
    if (global.WXMC && global.WXMC.open) global.WXMC.open();
  }
  function showModMaker() {
    show('modmaker');
    if (global.WXMM && global.WXMM.open) global.WXMM.open();
  }
  function showMarket() {
    show('market');
    if (global.WXMK && global.WXMK.open) global.WXMK.open();
  }

  /* ============================================================
   *  性别名词 / 指代 —— 前端镜像（真相源：game/src/core/pronouns.js）
   *
   *  ⚠️ 为什么这里另有一份：前端（浏览器里 / 测试的 vm 里）**拿不到 core 模块**
   *     （没有 require），而后端 NPC 视图目前只发 `gender` 的**原始值**，
   *     不发算好的名词。判据只能在这里镜像一次。
   *  ⚠️ 铁律：**不许再散落 `gender === 'female' ? '女' : '男'`** —— 那正是
   *     B11/B15 的成因：`gender === 'other'`（毒蛇/灰狼等 6 个）会落进 else，
   *     被显示成「男」（主人实测：点毒蛇，菜单头写着「山中猛兽 · 男」）。
   *     所有按性别渲染名词的地方一律走 genderNoun()。
   *  → 待后端把 `genderNoun` 直接放进 NPC 视图字段后，这里应改为「只读后端给的名词」，
   *     届时前端这份镜像可删（登记于 design/13-owner-bug-fix-report.md）。
   *  ⚠️ 位置：本块是纯辅助函数，放在文件末尾（导出之前）只是为与其它渲染辅助相邻；
   *     函数声明会**提升**，上方调用点（openNpcMenu / scoreHtml / loveHtml …）照样能用，
   *     与位置无关。历史：本块曾被挪到这里以避开 smoke-combat 的**行号**白名单假红；
   *     该护栏现已改为「整行原文 + 次数」，不再钉行号，位置因此自由。
   * ============================================================ */
  function genderNoun(x) {
    const g = (x && typeof x === 'object') ? x.gender : x;
    if (g === 'female') return '女';
    if (g === 'male') return '男';
    return '不明';            /* other / 缺失：兽 & 性别成谜的人 */
  }
  /* 指代「对方」的人称（菜单文案用）：他 / 她；性别成谜用「TA」。
     —— 与既有「与 TA 结缘 / 与 TA 结拜」同一写法，不为兽类生造「它」。 */
  function pronounTA(x) {
    const g = (x && typeof x === 'object') ? x.gender : x;
    if (g === 'female') return '她';
    if (g === 'male') return '他';
    return 'TA';
  }

  /* ============================================================
   *  导出
   * ============================================================ */
  global.WXUI = {
    show, toast, modal, closeModal, bindModal, choices, closeChoices, confirmBox,
    renderAll, renderTopbar, renderRoom, renderRoomActions, renderScene, renderCombat, renderQuickbar,
    appendLog, paintLog, clearLog, doCmd, panel, panelForCmd, openSaves, openSettings, applySettings,
    quitGame, isQuitCmd,
    centerMapOnHere, fmt1,
    bindInput, bindHotkeys, bindSidebar, bindGuide,
    showModCenter, showModMaker, showMarket,
    afterAction, autoSave, autosaveId,
    /* 测试出口：把纯渲染函数挂出来。
       为什么要它：这些函数是 IIFE 内部的闭包，外面拿不到，
       以前只能从真 DOM（modal-body.innerHTML）里读文本，
       写「读字段名对不对」的断言就别扭。
       全是纯函数（view → html 字符串），不碰 DOM 状态，不产生副作用。 */
    __html: { attrHtml, martialHtml, slavesHtml },
  };

})(window);
