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
      /* `it.rate` = 靠右那颗百分比（主人 2026-10-11：「『绑架』按钮**右侧**显示成功率」）。
         `.c-label` 是 flex:1，所以 rate 自然被挤到右边；高/低两档换个颜色，一眼能分辨。 */
      const rateCls = it.rate == null ? '' : (it.rate >= 90 ? ' high' : (it.rate <= 25 ? ' low' : ''));
      b.innerHTML = '<span class="c-idx">' + (i + 1) + '</span><span class="c-label">' + esc(it.label || it.text || '') +
        '</span>' + (it.rate == null ? '' : '<span class="c-rate' + rateCls + '">' + esc(String(it.rate)) + '%</span>') +
        (it.hint ? '<span class="c-hint">' + esc(it.hint) + '</span>' : '');
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
    /* 上限构成的悬停提示（主人报「数字自己会跳」）—— 拆开写在 title 上，
       鼠标一停就知道这 142 里哪一截是内功、哪一截是经脉。 */
    (function () {
      const vt = p.vitals;
      if (!vt) return;
      const bits = [];
      const seg = (label, o) => {
        if (!o || !o.total) return;
        const pp = [];
        if (o.base) pp.push('底子 ' + o.base);
        if (o.equip) pp.push('装备 ' + o.equip);
        if (o.other) pp.push('天赋 ' + o.other);
        if (o.skill) pp.push('内功 ' + o.skill);
        if (o.meridian) pp.push('经脉 ' + o.meridian);
        if (pp.length) bits.push(label + '：' + pp.join(' + ') + ' = ' + o.total);
      };
      seg('气血上限', vt.maxHp);
      seg('内力上限', vt.maxMp);
      const tip = bits.join('\n');
      const eh = $('txt-hp'), em = $('txt-mp');
      if (eh) eh.title = tip;
      if (em) em.title = tip;
    })();

    /* 删等级系统后，经验条改为显示「武学境界」（玩家强弱只看武学功法等级） */
    const realm = p.realm || '不通武艺';
    $('bar-exp').style.width = '100%';
    $('txt-exp').textContent = '境界 · ' + realm;
    /* ⚠️ 兜底：字段缺失时宁可显示「—」，也**不许**拼出「undefined 文」
       （玩家视角这叫「我的钱没了」，其实只是这个视图没带玩家）。 */
    $('tb-money').textContent = p.moneyText
      || (typeof p.money === 'number' ? p.money + ' 文' : '—');
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
      /* 服务端来的「选择」（如匪类掠过时的「拦不拦」）—— 日志照常落一行，
         弹窗排到 paintLog 之后弹（不然会被随后的日志盖掉）。 */
      if (l.choices && l.choices.length) _pendingChoices.push({ title: l.choicesTitle || '', list: l.choices });
      logLines.push(item);
    });
    if (logLines.length > MAX_LOG) logLines = logLines.slice(logLines.length - MAX_LOG);
    paintLog();
    flushChoices();
  }

  /* 排队的服务端选择（一次只弹一个，剩下的等下一次） */
  let _pendingChoices = [];
  function flushChoices() {
    if (!_pendingChoices.length) return;
    const q = _pendingChoices.shift();
    choices(q.title || '怎么办？', q.list.map(c => ({ label: c.label, hint: c.hint })), (it) => {
      const hit = q.list.find(c => c.label === it.label);
      if (hit && hit.cmd) doCmd(hit.cmd, { fromButton: true });
    });
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
      runInteractAct(acts[0], name);
      return;
    }
    choices('对「' + name + '」做什么', acts.map(a => ({
      label: a.label || a.cmd,
      hint: a.hint || '',
      cmd: a.cmd,
      /* ⚠️ `act` / `uid` / `qid` 必须原样传给回调（choices 会把整个 it 透传）——
         后端给的第一项是 `{act:'profile', uid:实例id}`：**开详情面板**。
         这里若只认 cmd，就会退回 `look <名字>` 那段文本流，
         也就是主人报的「点了看看却不弹面板」。
         `qid` 是「接取任务」要的：前端靠它去拉任务详情。 */
      act: a.act,
      uid: a.uid,
      qid: a.qid,
    })), it => runInteractAct(it, name));
  }

  /** 执行日志高亮菜单里的一项：认 `act`，否则退回 `cmd` */
  function runInteractAct(a, fallbackName) {
    if (!a) return;
    if (a.act === 'profile') {
      /* 优先用后端给的**实例 id**（一对一）；没有 id 才退回名字。
         退回名字时后端也能按名字找 —— 但重名的人多，尽量别走到那一步。 */
      openNpcProfile({ id: a.uid || a.cmd && a.cmd.replace(/^\S+\s+/, ''), name: fallbackName });
      return;
    }
    /* ★ 主人第四轮：点「接取任务」要**先弹任务详情**，玩家看过再决定接不接 ——
       而不是一点就把任务塞进任务栏。 */
    if (a.act === 'acceptquest') {
      openQuestPreview(a.qid, a.cmd);
      return;
    }
    if (a.cmd) doCmd(a.cmd, { fromButton: true });
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
    const story = g.story || {};
    const tgt = story.target || null;
    let h = '<div class="guide-panel">';

    /* 头：这是「完整流程」页（与「任务」面板里那条只有当前进度不同）。
       标题带「新手教程」四个字 —— 玩家的入口就叫「新手教程」，
       面板抬头跟入口对不上，玩家会怀疑自己点错了地方。 */
    h += '<div class="gp-head">新手教程 · 入江湖　' +
      '<b>' + g.doneCount + ' / ' + g.total + '</b> 章' +
      (g.finished ? '<span class="gp-finish">　✓ 已走完</span>' : '') + '</div>';
    h += '<div class="gp-note">这条路走完，你就算在江湖上站住了。'
      + '左边「任务」里只显示你眼下这一章，这里是全的。</div>';
    if (tgt && tgt.name) {
      h += '<div class="gp-target">这一程的去处：<b>' + esc(tgt.name) + '</b>'
        + (tgt.joined ? '<span class="gp-tag">已入门</span>' : '')
        + (tgt.pitch ? '<div class="gp-pitch">' + esc(tgt.pitch) + '</div>' : '')
        + '</div>';
    }

    /* 全流程：**每一章都列出来**（这是「完整流程」页的意义），
       但剧情旁白只给「已经走到 / 正在走」的那些 —— 后面几章的正文留给玩家自己撞上。 */
    h += '<div class="gp-steps">';
    g.steps.forEach((s, i) => {
      if (s.id === 'free') return;
      const cls = s.done ? 'done'
        : (s.locked ? 'locked' : (g.current && g.current.id === s.id ? 'cur' : 'todo'));
      h += '<div class="gp-step ' + cls + '">' +
        '<span class="gps-idx">' + (s.done ? '✓' : (s.locked ? '🔒' : (s.no || i + 1))) + '</span>' +
        '<div class="gps-body">' +
        '<div class="gps-title">' + esc(s.title) + '</div>' +
        '<div class="gps-goal">' + esc(s.goal) + '</div>' +
        (s.story ? '<div class="gps-story">' + esc(s.story).replace(/\n/g, '<br>') + '</div>' : '') +
        (!s.done && !s.locked ? '<div class="gps-hint">' + esc(s.hint) + '</div>' : '') +
        '</div></div>';
    });
    h += '</div>';
    h += '<div class="gp-foot">引导不捆人。想干什么干什么，回头点这里看就是。</div>';
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

    /* 「绑架」的三种状态（与后端 hl 动作表同一套口径）：
         ready —— 他晕着 + 身上有袋 + 袋没满 → 点了直接装走；
         其余 → 给**明确指引**（打晕他 / 去买袋 / 先安置袋里的人），
                而不是把入口藏起来（「互动少」的病根就是把能点的都藏了）。 */
    const kd = (S.view && S.view.kidnap) || {};
    const kdHasSack = !!kd.hasSack;
    const kdFull = (kd.bags || []).length >= 3;
    const kdReady = !!n.knockedOut && kdHasSack && !kdFull;
    /* 绑架成功率：后端算好的那一份（`view().npcs[].kidnap`），前端只负责显示 ——
       两边各算一套迟早「写着 70% 却输十次」。 */
    const kdRate = (n.kidnap && typeof n.kidnap.pct === 'number') ? n.kidnap.pct : null;
    const kdWhy = (n.kidnap && n.kidnap.why) ? n.kidnap.why : '';

    choices(n.name + (n.title ? ' · ' + n.title : ''), [
      /* ⚠️ 第一项从「查看 (look)」换成「细看此人」——
         主人要的是「点这个按钮弹出一个**新界面**，显示这个人各方面的详细信息，
         **包括人物背景故事**」。原来那个按钮只是往日志里打一段文本（look），
         翻过去就没了；现在开一个真正的详情面板（见 openNpcProfile）。
         文本版的 `look` 仍从详情面板底部进得去，指令也照旧能用。 */
      { label: '细看此人 (profile)', action: 'profile', hint: '来历、武学、关系、作息、背景故事' },
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
      /* ★ 主人第四轮点名：「其他比如偷袭结缘之类的功能呢？」——
         「结缘」本来就有（绑/纳妾/结拜那一组），缺的是**偷袭**。
         与「动手厮杀」的区别写在 hint 里：偷袭是先手重击，但会结仇被告发。 */
      (!n.knockedOut) ? { label: '伺机偷袭 (ambush)', action: 'ambush', hint: '先手重击，但会结仇，多半被告发' } : null,
      /* ★ 主人第四轮加的入口：「绑架」（原来是「装进麻袋」，且**只有对方晕了才显示** ——
         玩家根本不知道有这条路，更不知道得先打晕。现在统一成一个「绑架」按钮，点了按状态分流）：
           · 他已经晕着 + 有袋 + 袋没满 → 直接装袋带走；
           · 他站得好好的 → **先打**（真进战斗），打完晕了再回来点，就能装。
         没带麻袋也**照给**（点了给明确指引「得有条粗麻袋，杂货铺有卖」）——
         把入口藏起来才是「互动少」的病根。 */
      /* 绑架（主人 2026-10-11）：按钮**右侧显示成功率**，判定与掷骰都在后端同一处
         （`kidnap.assess` / `kidnapAttempt`）。晕着的是 100%（必定成功）；
         站着的最多 95% —— 得手就当场套袋，不成就开打。 */
      { label: '绑架 (kidnap)', action: 'kidnap', rate: kdRate,
        hint: kdReady ? '装进麻袋带走'
          : (n.knockedOut
            ? (kdHasSack ? '麻袋满了，先安置一下' : '得先有条粗麻袋（杂货铺有卖）')
            : (kdWhy || '打晕他，再装袋')) },
      canKidnap(n) ? { label: '卖了他 (sellnpc)', action: 'sellnpc', hint: '知情转卖，重罪' } : null,
      (!n.following && (n.favor || 0) > 60) ? { label: '邀他跟随 (follow)', action: 'follow', hint: '他会跟着，但也有自己的事要办' } : null,
      { label: '动手厮杀 (kill)', action: 'kill', hint: '可能致死，谨慎' }
    ].filter(Boolean), it => {
      const BTN = { fromButton: true };
      if (it.action === 'profile') openNpcProfile(n);
      /** 「绑架」（主人 2026-10-11 改）：
       *  **一条路走完** —— 晕着的直接装（必成）；站着的先按成功率掷一次，
       *  得手就当场套袋（不开打），没成才动手。判定与掷骰都在后端同一处
       *  （`kidnap.kidnapAttempt`），前端只负责把按钮上的百分比显示出来。
       *  跟以前不一样的地方：以前站着的人点这个只会 toast 一句「先打晕他」，
       *  等于把最要紧的那一步（成 / 不成的骰子）藏起来了。 */
      else if (it.action === 'kidnap') {
        if (!kdHasSack) { toast('要把人扛走，得先有条粗麻袋（杂货铺有卖）。', 'warn', 2200); return; }
        if (kdFull) { toast('麻袋满了，先把里头的人安置好。', 'warn', 2000); return; }
        doCmd('绑架 ' + n.name, BTN);
      }
      else if (it.action === 'look') doCmd('look ' + n.name, BTN);
      else if (it.action === 'pack') doCmd('装人 ' + n.name, BTN);
      else if (it.action === 'sellnpc') doCmd('卖人 ' + n.name, BTN);
      else if (it.action === 'follow') doCmd('跟随 ' + n.name, BTN);
      else if (it.action === 'talk') doCmd('talk ' + n.name, BTN);
      else if (it.action === 'ask') { askNpc(n); }
      else if (it.action === 'guanxi') doCmd('guanxi ' + n.name, BTN);
      else if (it.action === 'favor') doCmd('favor ' + n.name, BTN);
      else if (it.action === 'give') giveNpc(n);
      else if (it.action === 'givemoney') giveMoneyNpc(n);
      else if (it.action === 'qingjiao') openQingjiao(n);
      else if (it.action === 'qiecuo') doCmd('qiecuo ' + n.name, BTN);
      else if (it.action === 'propose') proposeNpc(n);
      else if (it.action === 'bond') doCmd('结缘 ' + n.name, BTN);
      else if (it.action === 'concubine') doCmd('纳妾 ' + n.name, BTN);
      else if (it.action === 'swear') doCmd('结拜 ' + n.name, BTN);
      else if (it.action === 'sever') doCmd('断义 ' + n.name, BTN);
      else if (it.action === 'steal') stealNpc(n);
      else if (it.action === 'ambush') doCmd('偷袭 ' + n.name, BTN);
      else if (it.action === 'kill') doCmd('kill ' + n.name, BTN);
    }, head);
  }

  /* ============================================================
   *  请教面板（主人 2026-10-11）
   *  「点击请教 npc 会弹出一个界面，里面是一些可请教的武学名称按钮，
   *    不可请教的武学上面会写『不可请教』」。
   *  数据来自后端 `view.npcs[].teachList`（与 `请教 <人>` 指令**同源**）——
   *  能不能请教由后端算好（学会了 / 好感不够 / 要花钱），前端只负责渲染，
   *  绝不在前端另判一套（那正是「两边口径漂移」的老病根）。
   *  ⚠️ `modal()` 里的 `data-cmd` 不会自动绑定（bindModal 只管关窗按钮），
   *     所以这里手动接一次 onclick —— 与面板那边 bindPanelActions 的做法一致。
   * ============================================================ */
  function openQingjiao(n) {
    const list = (n && n.teachList) || [];
    let h = '';
    if (!list.length) {
      h = '<div class="modal-text">' + esc(n.name) + '摇摇头：「我这点本事，教不了人。」</div>';
    } else {
      h = '<div class="modal-text">点一门功夫，向' + esc(n.name) + '请教。' +
        '（拜过师的，师父教徒天经地义；没拜师的，看他与你的交情，或者使钱。）</div>';
      h += '<div class="qj-list">';
      list.forEach(s => {
        h += '<div class="qj-row' + (s.can ? '' : ' off') + '">' +
          '<div class="qj-main"><span class="qj-name">' + esc(s.name) + '</span>' +
          '<span class="qj-meta">' + esc(s.type || '') + (s.quality ? ' · ' + esc(s.quality) : '') + '</span></div>';
        if (s.can) {
          h += '<button class="op-btn" data-cmd="请教 ' + esc(n.name) + ' ' + esc(s.name) + '">请教</button>';
        } else {
          h += '<span class="qj-off">不可请教（' + esc(s.why || '') + '）</span>';
        }
        h += '</div>';
      });
      h += '</div>';
    }
    modal('向 ' + n.name + ' 请教', h, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    const box = document.querySelector('#modal-body');
    if (box) box.querySelectorAll('[data-cmd]').forEach(b => {
      b.onclick = () => { closeModal(); doCmd(b.getAttribute('data-cmd'), { fromButton: true }); };
    });
  }

  /* ============================================================
   *  任务详情预览（主人第四轮：「接取任务」先弹详情，再决定接不接）
   *
   *  数据来自 `api.questPreview(qid)`（后端 `engine.questPreviewOf`）。
   *  底部两个按钮：接下这桩事 / 再说吧 —— **默认不接**，看清楚了再点。
   *  拉不到详情时退回旧行为（直接接），不让玩家卡在「点了没反应」。
   * ============================================================ */
  function questPreviewHtml(q) {
    if (!q) return '<div class="modal-text">（打听不到这桩事。）</div>';
    let h = '';
    const tags = [];
    if (q.type) tags.push(esc(q.type));
    if (q.level) tags.push('推荐修为 ' + q.level);
    if (q.giver) tags.push('委托人 ' + esc(q.giver));
    if (tags.length) h += '<div class="q-prev-tags">' + tags.join(' · ') + '</div>';
    if (q.desc) h += '<div class="q-prev-desc">' + esc(q.desc) + '</div>';
    if (q.stageDesc) h += '<div class="q-prev-line"><b>第一步</b>　' + esc(q.stageDesc) + '</div>';
    if (q.targets && q.targets.length) {
      h += '<div class="q-prev-line"><b>要办的事</b><ul class="q-prev-ul">' +
        q.targets.map(t => '<li>' + esc(t.desc) + '　<span class="q-prev-n">0/' + (t.count || 1) + '</span></li>').join('') +
        '</ul></div>';
    }
    if (q.rewards && q.rewards.length) {
      h += '<div class="q-prev-line"><b>办成了给</b>　' + esc(q.rewards.join('　')) + '</div>';
    }
    if (q.requireText) h += '<div class="q-prev-line q-prev-req"><b>门槛</b>　' + esc(q.requireText) + '</div>';
    if (q.acceptable === false) h += '<div class="q-prev-line q-prev-warn">这桩事已经在你身上了。</div>';
    return h;
  }

  async function openQuestPreview(qid, fallbackCmd) {
    if (!qid) { if (fallbackCmd) doCmd(fallbackCmd, { fromButton: true }); return; }
    let q = null, failed = false;
    try { const d = await api.questPreview(qid); q = (d && d.quest) || null; }
    catch (e) { failed = true; }
    if (!q) {
      toast(failed ? '一时打听不到这桩事的底细。' : '打听不到这桩事。', 'warn');
      if (fallbackCmd) doCmd(fallbackCmd, { fromButton: true });
      return;
    }
    const canTake = q.acceptable !== false;
    modal('任务 · ' + q.name, questPreviewHtml(q),
      '<button class="btn-ink" id="qp-no">再说吧</button>' +
      (canTake
        ? '<button class="btn-ink primary" id="qp-yes">接下这桩事</button>'
        : '<button class="btn-ink" id="qp-yes" disabled>已在你身上</button>'));
    const no = $('qp-no'), yes = $('qp-yes');
    if (no) no.onclick = () => closeModal();
    if (yes && canTake) yes.onclick = () => { closeModal(); doCmd('accept ' + q.name, { fromButton: true }); };
  }

  /* ============================================================
   *  NPC 详情界面（主人要求：点 NPC 菜单里那个按钮 → 弹出新界面，
   *  显示这个人各方面的详细信息，**包括人物背景故事**）
   *
   *  数据来自 `api.npcProfile(uid)`（后端 `engine.npcProfileOf`，按需拉取，
   *  不塞进每次指令的 view 里）。
   *
   *  ★ 背景故事是**分层解锁**的（与「询问」同一套信任门槛）：
   *    没到门槛的条目不隐藏，而是显示「他还信不过你」——
   *    让玩家知道「这里还有东西」，也知道该去办事而不是刷礼物。
   * ============================================================ */
  async function openNpcProfile(n) {
    if (!n) return;
    /* 优先实例 id（一对一），退而求其次用 defId、再退用名字。
       ⚠️ 日志高亮那条路传进来的可能是**一段文本**（「老郎中」）而不是名字 ——
       后端 `npcProfileOf` 也认名字，但「老郎中」本来就不是任何人的真名，
       于是会 404。所以失败时的提示要说清「你看不出这是谁」，
       而不是笼统的「这里没有这个人」——后者会让玩家以为界面坏了。 */
    const key = n.id || n.defId || n.name;
    let pr = null, failed = false;
    try {
      const d = await api.npcProfile(key);
      pr = (d && d.npc) || null;
    } catch (e) {
      failed = true;
    }
    if (!pr) {
      toast((failed ? '一时看不真切' : '看不出「' + (n.name || key) + '」是谁') +
        '，换个人试试。', 'warn');
      return;
    }
    /* 「点名字开互动面板」这一步，日志里先落一句「你看了他一眼」（主人 2026-10-08）——
       面板是「细看」，这一句是「搭眼」；顺序上先抬眼、再细看，读着才顺。 */
    if (pr.glance && pr.glance.text) appendLog([{ type: 'plain', text: pr.glance.text }]);
    modal(pr.name + (pr.title ? ' · ' + pr.title : ''),
      npcProfileHtml(pr),
      '<button class="btn-ink" id="npc-prof-look">打 量</button>' +
      '<button class="btn-ink" id="npc-prof-talk">交 谈</button>' +
      /* 战斗外秘技（迷晕/致幻/暗劲/下毒/催眠/采补/双修）与结缘线（表白/结义/结婚/纳妾） */
      '<button class="btn-ink" id="npc-prof-art">秘 技</button>' +
      '<button class="btn-ink" id="npc-prof-bond">结 缘</button>' +
      '<button class="btn-ink" id="npc-prof-story">人物故事</button>' +
      /* 拜师 / 请教（主人 2026-10-08）：不是师父 → 「拜 师」；已经是师父 → 「请 教」。
         两者互斥，同一位置只出现一个。 */
      (pr.isMaster
        ? '<button class="btn-ink" id="npc-prof-ask">请 教</button>'
        : '<button class="btn-ink" id="npc-prof-baishi">拜 师</button>') +
      /* 师父才有：出师（好聚好散，涨好感）/ 退出师门（断得难看，掉好感 + 收走门派传承武学）。
         ⚠️ 门派师父不出「出师」—— 门内换人是去向职位更高的人「拜师」（主人 2026-10-11）。 */
      (pr.isMaster && !pr.sectMaster
        ? '<button class="btn-ink" id="npc-prof-graduate"' + (pr.graduate && pr.graduate.can ? '' : ' disabled') + '>出 师</button>'
        : '') +
      (pr.isMaster ? '<button class="btn-ink danger" id="npc-prof-quit">退出师门</button>' : '') +
      /* 双修 / 采补（主人 2026-10-11：从「秘技」搬到这里来的）。
         能不能的判定全在后端（晚上 / 旁边有没有人 / 关系 / 家世 / 好感 / 冷却），
         前端只画按钮并原样转述那句 why。 */
      (pr.dual ? '<button class="btn-ink" id="npc-prof-dual"' + (pr.dual.can ? '' : ' disabled') + '>双 修</button>' : '') +
      (pr.drain ? '<button class="btn-ink" id="npc-prof-drain"' + (pr.drain.can ? '' : ' disabled') + '>采 补</button>' : '') +
      (pr.isDisciple ? '<button class="btn-ink" id="npc-prof-teach">传 功</button>' : '') +
      /* 门内争位：同门里位次比你高一位的那位，贡献够就能发起挑战（主人 2026-10-08）。 */
      (pr.challenge ? '<button class="btn-ink" id="npc-prof-challenge"' + (pr.challenge.can ? '' : ' disabled') + '>挑 战</button>' : '') +
      '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    /* 底部两个快捷动作：复用既有指令，不另起一套 */
    const lk = $('npc-prof-look');
    if (lk) lk.onclick = () => { closeModal(); doCmd('look ' + pr.name, { fromButton: true }); };
    const tk = $('npc-prof-talk');
    if (tk) tk.onclick = () => { closeModal(); doCmd('talk ' + pr.name, { fromButton: true }); };
    const ab = $('npc-prof-art');
    if (ab) ab.onclick = () => openArtsPanel(pr);
    const bb = $('npc-prof-bond');
    if (bb) bb.onclick = () => openBondPanel(pr);
    const sb = $('npc-prof-story');
    if (sb) sb.onclick = () => openStoryPanel(pr);
    /* 拜师 = 磕头认师父；请教 = 让师父把功夫教给你。都是既有指令，不另起一套。 */
    const bs = $('npc-prof-baishi');
    if (bs) bs.onclick = () => { closeModal(); doCmd('拜师 ' + pr.name, { fromButton: true }); };
    const ak = $('npc-prof-ask');
    if (ak) ak.onclick = () => { closeModal(); doCmd('请教 ' + pr.name, { fromButton: true }); };
    const cb = $('npc-prof-challenge');
    if (cb) {
      cb.onclick = () => {
        if (pr.challenge && !pr.challenge.can) { toast(pr.challenge.why || '现在还挑不得。', 'warn'); return; }
        closeModal(); doCmd('挑战 ' + pr.name, { fromButton: true });
      };
    }
    const tb = $('npc-prof-teach');
    if (tb) tb.onclick = () => openDisciplePanel(pr);
    /* 出师：门槛不到时按钮是灰的 —— 点它就把差什么说清楚，别让玩家干瞪眼 */
    const gb = $('npc-prof-graduate');
    if (gb) {
      gb.onclick = () => {
        if (pr.graduate && !pr.graduate.can) { toast(pr.graduate.why || '还出不得师。', 'warn', 3200); return; }
        closeModal(); doCmd('出师 ' + pr.name, { fromButton: true });
      };
    }
    /* 双修 / 采补：都是要脱开身的事，先问一句；门槛不到就把差什么原样说出来 */
    for (const [btnId, key, cmd, label] of [
      ['npc-prof-dual', 'dual', '双修', '双 修'],
      ['npc-prof-drain', 'drain', '采补', '采 补'],
    ]) {
      const b = $(btnId);
      if (!b) continue;
      b.onclick = async () => {
        const v = pr[key];
        if (v && !v.can) { toast(v.why || '这会儿不成。', 'warn', 3600); return; }
        const yes = await confirmBox(label,
          '这是一件脱不开身的事：起了手，就得一轮一轮往下走。' +
          '中途想走，点屏幕上随便哪个别的按钮（只是上头那点功夫白费了）。' +
          '屋里若有人经过，场面会很难看。确定吗？', '就 这 么 办');
        if (!yes) return;
        closeModal();
        doCmd(cmd + ' ' + pr.name, { fromButton: true });
      };
    }
    /* 退出师门：断得难看，先问一句（掉好感 + 收走门派传承武学，不能手一滑就点掉） */
    const qb = $('npc-prof-quit');
    if (qb) {
      qb.onclick = async () => {
        const yes = await confirmBox('退出师门',
          '退出师门要与他断得干干净净：好感大掉；若这份师承挂在门派上，' +
          '门里传给你的功夫也会被收回去（别处学的跟基本功夫不受影响）。确定？', '退 出 师 门');
        if (!yes) return;
        closeModal();
        doCmd('退出师门 ' + pr.name, { fromButton: true });
      };
    }
    /* 点「恩怨」里提到的名字 → 看那个人（若你认得他） */
    document.querySelectorAll('#modal-body [data-npcname]').forEach(b => {
      b.onclick = () => {
        const nm = b.getAttribute('data-npcname');
        closeModal();
        doCmd('look ' + nm, { fromButton: true });
      };
    });
  }

  /* ============================================================
   * 秘技面板（战斗外功法）：迷晕 / 致幻 / 暗劲 / 下毒 / 催眠 / 采补 / 双修
   *   数据是全的（后端 arts.listFor 已经算好「能不能用 / 几成」），
   *   前端只负责画按钮 —— 别在这儿再算一遍门槛，两处口径一定会分家。
   * ============================================================ */
  function openArtsPanel(pr) {
    const list = pr.arts || [];
    let h = '';
    if (!list.length) {
      h = '<div class="modal-text">你身上没有能对他使的手段。</div>';
    } else {
      h = '<div class="modal-text">只能对<b>实力不如你</b>的人下手；差得越远越稳。</div>';
      list.forEach(a => {
        const st = a.can ? `可成 ${a.chance}%` : '不可用';
        h += '<div class="np-row"><span class="np-k">' + esc(a.name) + '</span>'
          + '<span class="np-v">' + esc(st)
          + (a.can ? '' : '<br><i class="hint-dim">' + esc(a.why || '') + '</i>')
          + '<br><button class="mini-btn" data-art="' + esc(a.id) + '"' + (a.can ? '' : ' disabled') + '>用</button></span></div>';
      });
    }
    const marks = pr.marks || [];
    if (marks.length) h += '<div class="modal-text hint-dim">他身上：' + esc(marks.join('、')) + '</div>';
    modal('秘技 · ' + pr.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    document.querySelectorAll('#modal-body [data-art]').forEach(b => {
      b.onclick = () => {
        const id = b.getAttribute('data-art');
        const a = list.find(x => x.id === id);
        if (!a) return;
        closeModal();
        doCmd('秘技 ' + pr.name + ' ' + a.name, { fromButton: true });
      };
    });
  }

  /* ============================================================
   * 结缘面板：表白 → 男女朋友 → 才有结婚 / 纳妾；另有结义
   *   「必须先表白」这条门禁在后端（指令层）也有一道，前端只是把不该出现的
   *   按钮藏起来 —— 两处都做，是因为直接敲指令的人也得被拦住。
   * ============================================================ */
  function openBondPanel(pr) {
    const b = pr.bonds || {};
    const lover = !!b.isLover;
    const same = (pr.gender || '') === ((S.view && S.view.player && S.view.player.gender) || '');
    let h = '';
    if (lover) {
      h += '<div class="modal-text">你与' + esc(pr.name) + '已经说开了。往后的名分，从这里接着走。</div>';
      h += '<button class="mini-btn" data-bond="marry">结 婚</button>';
      h += '<button class="mini-btn" data-bond="concubine">纳 妾</button>';
    } else if (same) {
      h += '<div class="modal-text">这条路走不通 —— 这一层意思，对方接不住。</div>';
    } else {
      h += '<div class="modal-text">话还没说出口。要谈婚嫁，先得把这一层意思说明白。</div>';
      h += '<button class="mini-btn" data-bond="love">表 白</button>';
    }
    if (b.takenByOther) h += '<div class="modal-text hint-dim">' + esc(pr.name) + '已与' + esc(b.takenByOther) + '有约。</div>';
    h += '<hr><div class="modal-text">不涉名分，只论义气：</div>';
    h += '<button class="mini-btn" data-bond="bond">结 义</button>';
    modal('结缘 · ' + pr.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    document.querySelectorAll('#modal-body [data-bond]').forEach(btn => {
      btn.onclick = () => {
        const k = btn.getAttribute('data-bond');
        const cmd = k === 'love' ? '表白 ' + pr.name
          : k === 'marry' ? '提亲 ' + pr.name
            : k === 'concubine' ? '纳妾 ' + pr.name
              : '结缘 ' + pr.name;
        closeModal();
        doCmd(cmd, { fromButton: true });
      };
    });
  }

  /* ============================================================
   * 人物故事（好感 > 60 解锁）—— 内容就是画像里写的那几段
   *   门槛不到时**不藏入口**，点进去明说「他还信不过你」，
   *   玩家才知道该去把交情处出来，而不是以为这人没故事。
   * ============================================================ */
  function openStoryPanel(pr) {
    const s = pr.lifeStory || {};
    const fav = Math.round((pr.relation && pr.relation.favor) || 0);
    let h = '';
    if (!s.unlocked) {
      h = '<div class="modal-text">你试着问起他的旧事，' + esc(pr.name) + '笑了一下，把话头岔到别处去了。</div>'
        + '<div class="modal-text hint-dim">交情还不够（好感 ' + fav + ' / 需要 ' + (s.need || 60) + ' 以上）。</div>';
    } else {
      if (s.origin) h += '<div class="panel-sec">来历</div><div class="modal-text">' + esc(s.origin) + '</div>';
      if (s.now) h += '<div class="panel-sec">如今</div><div class="modal-text">' + esc(s.now) + '</div>';
      if (s.want) h += '<div class="panel-sec">想要的</div><div class="modal-text">' + esc(s.want) + '</div>';
      if (s.fear) h += '<div class="panel-sec">怕的</div><div class="modal-text">' + esc(s.fear) + '</div>';
      if (!s.origin && !s.now && !s.want) h += '<div class="modal-text">他不肯多说自己。</div>';
    }
    modal('人物故事 · ' + pr.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
  }

  /* ============================================================
   * 徒弟：传功 / 灌顶
   *   传功 —— 把自身功法教下去（传下去只剩六成火候）
   *   灌顶 —— 拿自己十点内力上限换他十点（内力就是实力上限）
   * ============================================================ */
  function openDisciplePanel(pr) {
    const list = pr.teachables || [];
    let h = '<div class="modal-text">' + esc(pr.name) + '是你门下的弟子。内力上限 <b>' + (pr.maxMp || 0) + '</b>。</div>';
    h += '<div class="panel-sec">传功</div>';
    if (!list.length) h += '<div class="modal-text hint-dim">你自己还没学成什么，没得可传。</div>';
    else {
      h += '<div class="modal-text hint-dim">传下去只剩六成火候。他会的、比你熟的，传不进去。</div>';
      list.slice(0, 24).forEach(sk => {
        h += '<div class="np-row"><span class="np-k">' + esc(sk.name) + '</span>'
          + '<span class="np-v">' + sk.level + ' 级 <button class="mini-btn" data-teach="' + esc(sk.name) + '">传</button></span></div>';
      });
    }
    h += '<div class="panel-sec">灌顶</div>';
    h += '<div class="modal-text">拿自己的内力上限换他的 —— 传功是教招式，灌顶是把自己的底子分他一截。</div>'
      + '<button class="mini-btn" data-teach="__guanding__">为他灌顶</button>';
    modal('传功 · ' + pr.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
    document.querySelectorAll('#modal-body [data-teach]').forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute('data-teach');
        const cmd = k === '__guanding__' ? '灌顶 ' + pr.name : ('传功 ' + pr.name + ' ' + k);
        closeModal();
        doCmd(cmd, { fromButton: true });
      };
    });
  }

  /** 详情面板的 HTML（纯函数：profile → html，方便单独测） */
  function npcProfileHtml(p) {
    if (!p) return '';
    const h = [];
    const sec = (title, body, cls) =>
      (body ? ('<div class="np-' + (cls || 'sec') + '">' +
        (title ? '<div class="np-h">' + esc(title) + '</div>' : '') + body + '</div>') : '');
    const row = (k, v) => (v ? '<div class="np-row"><span class="np-k">' + esc(k) + '</span><span class="np-v">' + v + '</span></div>' : '');

    /* ---- 头：一句定位 + 外观 ---- */
    let head = '<div class="np-lead">' +
      '<span class="np-id">' + esc(p.identity || '') + '</span>' +
      (p.gender ? '<span class="np-tag">' + esc(genderNoun(p.gender)) + (p.age ? ' · ' + p.age + ' 岁' : '') + '</span>' : '') +
      (p.here ? '' : '<span class="np-tag warn">' + esc(p.roomName || '') + '</span>') +
      '</div>';
    if (p.desc) head += '<div class="np-desc">' + esc(p.desc) + '</div>';
    if (p.role) head += '<div class="np-role">' + esc(p.role) + '</div>';

    /* ---- 修为与状态 ---- */
    let stat = row('修为', esc(p.realm || '—') + (p.showLevel && p.level ? '（约 ' + p.level + ' 层）' : ''));
    stat += row('气色', esc(p.hpLine || ''));
    if (p.personality) stat += row('性子', esc(p.personality.name) + (p.personality.desc ? '　' + esc(p.personality.desc) : ''));
    if (p.home) stat += row('住处', esc(p.home));

    /* ---- 与你的关系 ---- */
    let rel = row('交情', esc(p.relation.favorCN));
    rel += row('信任', esc(p.relation.trustCN));
    /* 送礼往来：与送礼面板同一个来源（pstate.gifts），两边说得一样 */
    if (p.relation.gifts && p.relation.gifts.count > 0) {
      const gi = Object.keys(p.relation.gifts.items || {});
      rel += row('往来', '送过 ' + p.relation.gifts.count + ' 次' +
        (p.relation.gifts.money ? '，银钱共 ' + p.relation.gifts.money + ' 文' : '') +
        (gi.length ? '　' + esc(gi.slice(0, 3).join('、')) + (gi.length > 3 ? ' 等' : '') : ''));
    }

    /* ---- 武学 ---- */
    let mart = '';
    if (p.martial.slots.length) {
      mart += '<div class="np-list">' + p.martial.slots.map(s =>
        '<span class="np-chip">' + esc(s.slot) + '·' + esc(s.name) +
        '<i>' + esc(s.tier) + '</i></span>').join('') + '</div>';
    }
    if (p.martial.more.length) {
      mart += '<div class="np-note">此外还习得：' + esc(p.martial.more.join('、')) + '</div>';
    }
    if (!p.martial.slots.length && !p.martial.more.length) mart = '<div class="np-note">看不出会什么武功。</div>';
    if (p.martial.hint) mart += '<div class="np-note dim">' + esc(p.martial.hint) + '</div>';

    /* ---- 装备 / 随身 ---- */
    let gear = '';
    if (p.equip.length) {
      gear += '<div class="np-list">' + p.equip.map(e =>
        '<span class="np-chip">' + esc(e.slot) + '·' + esc(e.name) + '</span>').join('') + '</div>';
    }
    if (p.carry.length) {
      gear += '<div class="np-note">随身带着：' + esc(p.carry.map(c => c.name + (c.count > 1 ? '×' + c.count : '')).join('，')) + '。</div>';
    }
    if (p.money) gear += '<div class="np-note">身上大约 ' + p.money + ' 文钱。</div>';

    /* ---- 能教你什么 ---- */
    let teach = '';
    if (p.teach.length) {
      teach = '<div class="np-list">' + p.teach.map(t =>
        '<span class="np-chip' + (t.can ? '' : ' dim') + '">' + esc(t.name) +
        '<i>' + (t.can ? '可请教' : '好感 ≥' + t.need) + '</i></span>').join('') + '</div>';
    }

    /* ---- 作息 ---- */
    let sch = '';
    if (p.schedule.length) {
      sch = '<div class="np-list">' + p.schedule.map(s =>
        '<span class="np-chip">' + esc(s.cn) + '·' + esc(s.place) + '</span>').join('') + '</div>';
    }

    /* ---- ★ 背景故事（分层解锁）----
       ⚠️ 每块都带 `data-sk`（origin/now/want/fear/obsession/secret）——
         既是给测试的稳定锚点（「未解锁就没有正文」这类断言按 key 打，
         不用在 HTML 里找中文片段），也让日后想加「点某条展开」有抓手。 */
    let story = '';
    if (p.story.length) {
      story = p.story.map(s =>
        '<div class="np-story' + (s.unlocked ? '' : ' locked') + (s.secret ? ' secret' : '') +
        '" data-sk="' + esc(s.key) + '">' +
        '<span class="np-slabel">' + esc(s.label) + '</span>' +
        (s.unlocked
          ? '<span class="np-stext">' + esc(s.text) + '</span>'
          : '<span class="np-slock">' + esc(s.lockHint) + '</span>') +
        '</div>').join('');
    }
    /* 恩怨：谁跟谁有过节（trust ≥ 40 才说得出） */
    let feud = '';
    if (p.feuds.length) {
      feud = p.feuds.map(f =>
        '<div class="np-story' + (f.locked ? ' locked' : '') + '" data-sk="feuds">' +
        '<span class="np-slabel">' + esc(f.kind) + '</span>' +
        '<span class="np-stext">' + (f.locked
          ? '<span class="np-slock">这种话，不是交情够了谁也不肯讲。</span>'
          : '<a class="np-link" data-npcname="' + esc(f.name) + '">' + esc(f.name) + '</a>' +
            (f.why ? '　' + esc(f.why) : '') + (f.since ? '（' + esc(f.since) + '起）' : '')) +
        '</span></div>').join('');
    }

    /* ---- 说话的样子（不设门槛：听口气是听得出来的）---- */
    let voice = '';
    if (p.voice) {
      if (p.voice.catchphrase) voice += '<div class="np-story" data-sk="voice"><span class="np-slabel">口头禅</span><span class="np-stext">「' + esc(p.voice.catchphrase) + '」</span></div>';
      if (p.voice.style) voice += '<div class="np-story" data-sk="voice"><span class="np-slabel">谈吐</span><span class="np-stext">' + esc(p.voice.style) + '</span></div>';
    }
    let routine = '';
    if (p.routine.length) {
      routine = p.routine.map(r =>
        '<div class="np-story" data-sk="routine"><span class="np-slabel">' + esc(r.at) + '</span><span class="np-stext">' + esc(r.act) + '</span></div>').join('');
    }

    h.push(head);
    h.push(sec('', stat, 'sec'));
    h.push(sec('与你的关系', rel));
    h.push(sec('武学', mart));
    h.push(sec('随身行头', gear));
    if (teach) h.push(sec('能教你什么', teach));
    if (sch) h.push(sec('作息', sch));
    if (story) h.push(sec('来历与心事', story, 'sec story'));
    if (feud) h.push(sec('恩怨', feud, 'sec story'));
    if (voice) h.push(sec('说话的口气', voice, 'sec story'));
    if (routine) h.push(sec('平日做什么', routine, 'sec story'));
    if (!p.hasPortrait) {
      h.push('<div class="np-note dim">此人的底细，你只看到这些。</div>');
    }
    return '<div class="npc-prof">' + h.join('') + '</div>';
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

  /* 送礼面板（主人第三轮要求改版）：
     「点『送他东西』按钮，效果改为弹出玩家身上有什么物品（**包括金钱**），
       点击选择赠送，**已经送多少**」

     改动三处：
     ① **金钱并进同一个面板**（原来「送东西」和「给银钱」是两个入口、要来回点）；
     ② 顶部说清**往来**：已送过几次、给过多少银子、最近送的是什么；
     ③ 每件物品若送过，行内标「已送 N 次」。
     ⚠️ 背包空也要开面板 —— 原来 `if (!inv.length) return toast(...)` 直接把面板挡了，
        连「给点银子」都做不到（而钱是可以在钱袋里的）。 */
  function giveNpc(n) {
    const inv = (S.view && S.view.inventory) || [];
    const g = n.gifts || { count: 0, money: 0, items: {} };
    const sentLog = Object.keys(g.items || {});
    const likes = (n.likes || []).map(x => x.name).join('、');

    /* ---- 往来摘要 ---- */
    let head = '';
    if (g.count > 0) {
      head += '<div class="gift-log">此前已送 <b>' + g.count + '</b> 次' +
        (g.money > 0 ? '，其中银钱共 <b>' + g.money + '</b> 文' : '') +
        (sentLog.length ? '　（' + esc(sentLog.slice(0, 4).map(k => k + (g.items[k] > 1 ? '×' + g.items[k] : '')).join('、')) +
          (sentLog.length > 4 ? ' 等' : '') + '）' : '') + '</div>';
    } else {
      head += '<div class="gift-log dim">你还没送过' + pronounTA(n.gender) + '什么。</div>';
    }
    head += '<div class="modal-text">' + (likes ? '似乎偏爱：' + esc(likes) + '。' : '此人不挑，来者不拒。') +
      '　送对了能大大加好感，送太寒碜的反倒跌份。</div>';

    /* ---- 物品 ---- */
    let body = '<div class="mm-sub-title">行囊里的东西</div>';
    if (inv.length) {
      body += '<div class="pick-list">' + inv.map(it => {
        const times = g.items[it.name] || 0;
        return '<button class="pick-row" data-item="' + esc(it.id || it.name) + '">' +
          '<span class="pr-name">' + esc(it.name) + (it.count > 1 ? ' ×' + it.count : '') + '</span>' +
          '<span class="pr-sub">' + esc(it.qualityName || it.typeName || '') +
          (times ? '<i class="gift-times">已送 ' + times + ' 次</i>' : '') + '</span></button>';
      }).join('') + '</div>';
    } else {
      body += '<div class="mm-empty-sm">行囊空空。身上还有银钱，递几张过去也是一份心意。</div>';
    }

    /* ---- 金钱 ---- */
    const money = (S.view && S.view.player && S.view.player.money) || 0;
    body += '<div class="mm-sub-title">银钱（身上还有 ' + money + ' 文）</div>';
    body += '<div class="pick-list">' +
      [50, 100, 300, 800].filter(v => v <= money).map(v =>
        '<button class="pick-row" data-amt="' + v + '"><span class="pr-name">' + v + ' 文</span>' +
        '<span class="pr-sub">' + (v <= 20 ? '薄了些' : v >= 300 ? '够分量' : '') + '</span></button>').join('') +
      '</div>' +
      '<input id="money-input" class="modal-input" placeholder="或自填数额（文，不超过 ' + money + '）">';

    modal('送 ' + n.name + ' 东西', head + body,
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    document.querySelectorAll('.pick-row[data-item]').forEach(b => {
      b.onclick = () => {
        const id = b.getAttribute('data-item');
        closeModal();
        doCmd('give ' + id + ' to ' + n.name, { fromButton: true });
      };
    });
    document.querySelectorAll('.pick-row[data-amt]').forEach(b => {
      b.onclick = () => {
        const v = b.getAttribute('data-amt');
        closeModal();
        /* ⚠️ 格式必须是 `give_money <人名> <钱数>`（后端的签名）。
           老代码发的是 `give_money <钱数> to <人名>` —— 顺序反了，
           点下去只会得到「这里没有「100」。」。
           后端现在两种都认（兼容老档/教程），但前端按签名发才是正路。 */
        doCmd('give_money ' + n.name + ' ' + v, { fromButton: true });
      };
    });
    const inp = $('money-input');
    if (inp) inp.onkeydown = e => {
      if (e.key === 'Enter') {
        const v = inp.value.trim();
        closeModal();
        if (v) doCmd('give_money ' + n.name + ' ' + v);
      }
    };
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

    /* ---- 他认识的人（主人第四轮）----
       「弹出一个页面上面有 NPC 认识的人名字，点击这些名字按钮 NPC 会说关于
        它们的事（根据 NPC 背景画像来）」。
       名单来自**后端** `n.askPeople`（engine.askPeopleOf → commands.npcKnownPeople），
       前端不自己从画像里拼名单 —— 两边共用一份，点了才一定答得上。 */
    const people = (n && n.askPeople) || [];
    if (people.length) {
      h += '<div class="ask-sub">他认识的人' +
        '<span class="ask-sub-hint">（点一个，说说这人）</span></div>' +
        '<div class="ask-topics">' + people.map(pp =>
          '<button class="mini-tag who" data-who="' + esc(pp.name) + '">' +
          esc(pp.name) + '<sup>' + esc(pp.rel || '熟人') + '</sup></button>').join('') +
        '</div>';
    }

    modal('询问 ' + n.name, h, '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    const inp = $('ask-input');
    if (inp) {
      inp.focus();
      inp.onkeydown = e => {
        if (e.key === 'Enter') { const v = inp.value.trim(); closeModal(); if (v) doCmd('ask ' + n.name + ' about ' + v); }
      };
    }
    /* ⚠️ 选择器带 `#modal-body` 前缀（不是裸 `.ask-topics .mini-tag`）：
       ① 真浏览器里也更稳 —— 别的标签页/面板若也有 `.mini-tag` 就不会被误绑；
       ② 测试的 DOM stub 只认 `#id …` 形式，裸后代选择器它抠不到元素
          → onclick 绑不上 → 测试误报「点了没反应」。 */
    document.querySelectorAll('#modal-body .mini-tag').forEach(b => {
      b.onclick = () => {
        const who = b.getAttribute('data-who');
        const v = who || b.getAttribute('data-topic');
        closeModal();
        if (v) doCmd('ask ' + n.name + ' about ' + v, { fromButton: true });
      };
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
    } else if (name === 'practice') {
      title = '练武学';
      html = practiceHtml(v);
    } else if (name === 'auction') {
      title = '拍卖行';
      html = auctionHtml(v);
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
    /* 主线分化（design/67 §5 P1）：你走的是哪条线、走到第几幕。
       不给它一个位置，玩家根本不知道自己被分了线。 */
    if (p.mainline) {
      h += kv('主线', p.mainline.lineName + ' · 第 ' + p.mainline.act + ' 幕'
        + (p.mainline.fromMod ? '（mod 出身 · 中立）' : ''));
    }
    h += kv('门派', p.sectName || '无门无派');
    h += kv('职位', p.rankName || '—');
    h += kv('年龄', p.age ? p.age + ' 岁' : '—');
    h += kv('战绩', (p.kills || 0) + ' 杀');
    /* 昏倒数（存档字段仍叫 deathCount，但**玩家可见的只有「昏倒」**——
       主人要求玩家不会死，只是力竭昏过去、在最近客栈醒转）。
       原来这个数字从来没在界面上露过面，玩家不知道自己昏过几次。 */
    h += kv('昏倒', (p.deathCount || 0) + ' 次');
    /* 文采 / 功名（科举那条线）：不给它一个位置，玩家根本不知道有这回事 */
    if (v.culture) {
      h += kv('文采', v.culture.wencai + (v.culture.nextExam ? '（下一场：' + v.culture.nextExam.name + '）' : ''));
      h += kv('功名', v.culture.gongming || '白身');
    }
    h += '</div><div class="pc-col">';
    h += kv('气血', p.hp + ' / ' + p.maxHp);
    h += kv('内力', p.mp + ' / ' + p.maxMp);
    /* 气血/内力是整数，饱食/饮水是小数 —— 一律过 fmt1（单一入口，别两处写法不一致，
       否则顶栏修好了、这个「状态一览」面板还印 99.9187） */
    h += kv('饱食', fmt1(p.food) + ' / ' + fmt1(p.maxFood));
    h += kv('饮水', fmt1(p.water) + ' / ' + fmt1(p.maxWater));
    /* 潜能已废除（2026-10-11）：面板不再显示这个数。
       原来它与「等级/经验」同栏，三个都是武学重制后的残留；等级/经验仍参与显示，先留着。 */
    h += kv('银两', p.money + ' 文');
    h += kv('杀气', p.karma);
    /* 声望是「键→ 数值」的对象（门派名/恶名等动态键），直接丢给 kv 会变 [object Object] */
    h += kv('声望', repText(p.reputation));
    h += '</div></div>';
    h += vitalNote(p);
    if (p.timeText) h += '<div class="panel-note">' + esc(p.timeText) + '</div>';
    return h;
  }

  /** 上限构成（2026-10-11）—— 主人报「初始最大血 89，没走两步变 149，你怎么还没修好」。
      查下来**不是 bug**：走路完全不涨（实测纯走 40 次纹丝不动），
      涨的是两处 —— ① 内功等级（每级 +1.2 血 / +1.8 内力）② 通奇经八脉（任脉 +12 血/关）。
      真正的毛病是**全仓没有一处交代这钱从哪儿来**，玩家只能看见数字自己跳。
      所以在状态面板把它拆开写明：基础 + 内功 + 经脉 + 装备 = 当前上限。 */
  function vitalNote(p) {
    const vt = p.vitals;
    if (!vt || !vt.maxHp || !vt.maxMp) return '';
    function line(label, o) {
      if (!o || !o.total) return '';
      const parts = [];
      if (o.base) parts.push('底子 ' + o.base);
      if (o.equip) parts.push('装备 ' + o.equip);
      if (o.other) parts.push('天赋 ' + o.other);
      if (o.skill) parts.push('内功 ' + o.skill);
      if (o.meridian) parts.push('经脉 ' + o.meridian);
      if (!parts.length) return '';
      return label + '上限 ' + parts.join(' + ') + ' ＝ ' + o.total;
    }
    const a = line('气血', vt.maxHp), b = line('内力', vt.maxMp);
    if (!a && !b) return '';
    return '<div class="panel-note">' + esc([a, b].filter(Boolean).join('　·　'))
      + '。上限只随内功修为与奇经八脉增长，走路不会凭空涨。</div>';
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

  /* ============================================================
   * 武学面板（武学重制 §2.6）
   *   分三块：已激活 / 散手（无根基，至多三路）/ 所学未激活。
   *   必须显示「品级」「绑在哪门基础武学（及它的等级）」「上限是谁卡的」——
   *   缺了这三项，玩家只会看到「练不动了」却不知道为什么，这是需求②的可玩性命门。
   * ============================================================ */
  const GRADE_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  function gradeTag(g) { return g ? '<i class="tag-grade">' + (GRADE_CN[g] || g) + '品</i>' : ''; }
  function limitHint(s) {
    if (!s.canTrain) {
      return s.limitBy === '基础武学'
        ? '<span class="hint-warn">已至上限（受《' + esc(s.baseName || '') + '》' + s.baseLevel + ' 级所限，先练基础武学）</span>'
        : '<span class="hint-warn">已至上限</span>';
    }
    if (s.limitBy === '基础武学') return '<span class="hint-dim">上限 ' + s.maxLevel + '（依《' + esc(s.baseName || '') + '》' + s.baseLevel + ' 级）</span>';
    return '<span class="hint-dim">上限 ' + s.maxLevel + '</span>';
  }
  /* 练武学（主人 2026-10-08）：已学会的武学排成一列，点一个就自动耗内力练。
     按钮走 data-cmd（bindPanelActions 统一绑），别自己 addEventListener。 */
  function practiceHtml(v) {
    const list = (v && v.practice) || [];
    if (!list.length) {
      return '<div class="modal-text">你手上一门功夫都没有。<br><br>' +
        '先去<b>拜师</b>：屋子里找个人，点「细看此人」→「拜 师」，' +
        '成了师徒，再「请教」他的功夫。往后练功精进，都在这一面板上。</div>';
    }
    let h = '<div class="modal-text">挑一门点下去，人自己就练上了：<b>内力往里头耗</b>，耗干净为止。' +
      '<br><span class="hint-dim">内力上限越高、这门功夫等级越低，练得越快。</span></div>';
    h += '<div class="prac-grid">';
    for (const s of list) {
      const full = !!s.full;
      h += '<button class="btn-ink prac-btn' + (full ? ' prac-full' : '') + '" data-cmd="练武学 ' + esc(s.name) + '"' +
        (full ? ' title="已至上限"' : '') + '>' +
        esc(s.name) + '<span class="prac-lv">' + s.level + '/' + s.cap + (full ? '·满' : '') + '</span>' +
        (s.type ? '<span class="prac-type">' + esc(s.type) + '</span>' : '') +
        '</button>';
    }
    h += '</div>';
    return h;
  }

  /* 「练这门功夫」按钮（主人 2026-10-11）：
       「内功后面需要有『打坐』按钮，拳脚后续有练拳按钮以此类推」。
     · 内功 → 打坐。内功只能靠打坐练，而且打坐还是**冲奇经八脉**的唯一路子。
     · 其余按门类给「练拳 / 练剑 / 练刀 / 练轻功…」，指令统一是 `练武学 <武学名>`。
     ⚠️ 打坐发的是英文 `meditate`，不是中文「打坐」——
        中文那个词在 `PANEL_CMDS` 里曾被当成「打开武学面板」的快捷词，
        用英文别名可以保证不管那张表以后怎么改，这个按钮都是真打坐。 */
  const PRACTICE_LABEL = {
    拳: '练拳', 掌: '练掌', 指: '练指', 腿: '练腿', 爪: '练爪',
    剑: '练剑', 刀: '练刀', 棍: '练棍', 鞭: '练鞭', 暗器: '练暗器',
    轻功: '练轻功', 招架: '练招架', 身法: '练身法', 音波: '练音波',
    医术: '习医', 毒术: '练毒',
  };
  function practiceBtn(s) {
    if (!s || !s.canTrain) return '';          /* 已到上限就不给按钮，免得点了只回一句「练不动了」 */
    const type = String(s.type || ''), cat = String(s.category || '');
    if (type === '内功' || cat === '内功') {
      return '<button class="mini-btn" data-cmd="meditate" title="打坐：回内力，兼冲奇经八脉">打坐</button>';
    }
    const label = PRACTICE_LABEL[type] || PRACTICE_LABEL[cat] || '练功';
    return '<button class="mini-btn" data-cmd="练武学 ' + esc(s.name) + '">' + esc(label) + '</button>';
  }

  function skillsHtml(v) {
    const list = (v.player && v.player.skills) || v.skills || [];
    if (!list.length) return '<div class="modal-text">尚未习得任何武学。</div>';
    const active = list.filter(s => s.equipped);
    const stand = list.filter(s => s.standaloneActive);
    const rest = list.filter(s => !s.equipped && !s.standaloneActive);
    let h = '';

    h += '<div class="panel-sec">已激活</div>';
    if (active.length) {
      h += '<table class="data-table"><thead><tr><th>槽位</th><th>武学</th><th>品级</th><th>等级</th><th>熟练度</th><th>修习</th></tr></thead><tbody>';
      active.forEach(s => {
        const pctStr = s.level >= s.maxLevel ? '圆满' : util.pct(s.exp, s.expNeed) + '%';
        h += '<tr><td>' + esc(s.slot || s.type) + '</td>' +
          '<td class="td-name">' + esc(s.name) + gradeTag(s.grade) +
          (s.baseName ? ' <span class="hint-dim">← 依《' + esc(s.baseName) + '》' + s.baseLevel + '</span>' : '') + '</td>' +
          '<td>' + (s.grade || '—') + '</td>' +
          '<td>' + s.level + ' / ' + s.maxLevel + '</td>' +
          '<td>' + pctStr + '</td>' +
          '<td>' + practiceBtn(s) + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="modal-text hint-dim">武技会被自动带进战斗快捷栏（内功这类没有武技的不会）。</div>';
    } else {
      h += '<div class="modal-text">还没有激活任何武学。用「装备武学 &lt;槽位&gt; &lt;武学名&gt;」装上，或者在下表点「激活」。</div>';
    }

    h += '<div class="panel-sec">散手 · 无根基（' + stand.length + '/3）</div>';
    if (stand.length) {
      h += '<table class="data-table"><thead><tr><th>散手</th><th>品级</th><th>等级</th><th>熟练度</th><th>修习</th></tr></thead><tbody>';
      stand.forEach(s => {
        const pctStr = s.level >= s.maxLevel ? '圆满' : util.pct(s.exp, s.expNeed) + '%';
        h += '<tr><td class="td-name">' + esc(s.name) + gradeTag(s.grade) + '</td>' +
          '<td>' + (s.grade || '—') + '</td><td>' + s.level + ' / ' + s.maxLevel + '</td><td>' + pctStr + '</td>' +
          '<td>' + practiceBtn(s) + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="modal-text hint-dim">散手不属于任何基础武学一系，不占槽位，最多同时运起三路。</div>';
    } else {
      h += '<div class="modal-text hint-dim">暂无散手。这类功夫没有师承的根基，只能自己揣着。</div>';
    }

    h += '<div class="panel-sec">所学未激活</div>';
    if (rest.length) {
      h += '<table class="data-table"><thead><tr><th>武学</th><th>品级</th><th>等级</th><th>熟练度</th><th>修习</th><th></th></tr></thead><tbody>';
      rest.forEach(s => {
        const pctStr = s.level >= s.maxLevel ? '圆满' : util.pct(s.exp, s.expNeed) + '%';
        /* 🔴 基础武学不给「激活」（主人 2026-10-11 原话：「基础武学比如基础内功这种不能激活」）。
           它们开局就自动挂在各自的槽上、常驻生效，是「这一系的上限由它决定」的那一本；
           再摆一个激活按钮只会让人以为自己漏点了一下。 */
        const actBtn = s.isBasic
          ? '<span class="hint-dim" title="基础武学开局即常驻生效，练它就能抬高本系上限">常驻</span>'
          : '<button class="mini-btn" data-cmd="enable ' + esc((s.base && s.type) || s.type || '') + ' ' + esc(s.name) + '">激活</button>';
        h += '<tr><td class="td-name">' + esc(s.name) + gradeTag(s.grade) +
          (s.isBasic ? ' <span class="hint-dim">· 基础武学</span>' : '') +
          (s.baseName ? ' <span class="hint-dim">依《' + esc(s.baseName) + '》</span>' : '') +
          '<br>' + limitHint(s) + '</td>' +
          '<td>' + (s.grade || '—') + '</td>' +
          '<td>' + s.level + ' / ' + s.maxLevel + '</td>' +
          '<td>' + pctStr + '</td>' +
          '<td>' + practiceBtn(s) + '</td>' +
          '<td>' + actBtn + '</td></tr>';
      });
      h += '</tbody></table>';
    } else {
      h += '<div class="modal-text hint-dim">所学的功夫都已安排妥当。</div>';
    }
    h += '<div class="modal-text hint-dim">内功只能绑《基本内功》·招架只能绑《基本招架》·以此类推，每门基础武学同时只挂一门；基础武学练到几级，其所系的其它武学最多也练到几级。</div>';
    return h;
  }

  /* ============================================================
   * 拍卖行面板（design/40 §6.3）：当前拍品 / 后续拍品 / 我的寄拍
   * ============================================================ */
  function auctionHtml(v) {
    const a = v.auction;
    if (!a) return '<div class="modal-text">这里没有拍卖行。大城的市集上才有。</div>';
    let h = '';
    h += '<div class="modal-text">第 <b>' + (a.session + 1) + '</b> 期 · 每 ' + a.intervalDays + ' 日一场 · 距下一场还有 <b>' + a.daysToNext + '</b> 日　身上银钱：' + a.money + ' 文</div>';
    if (a.news && a.news.length) {
      h += '<div class="panel-sec">上期寄拍结算</div>';
      a.news.forEach(n => { h += '<div class="modal-text">' + esc(n) + '</div>'; });
    }
    h += '<div class="panel-sec">正在拍</div>';
    if (a.current) {
      const c = a.current;
      h += '<div class="modal-text"><b>' + esc(c.name) + '</b>' + (c.isHigh ? ' <i class="tag-grade">重器</i>' : '') +
        '<br>' + esc(c.desc || '') + '<br>当前价 <b>' + c.price + '</b> 文　加价 ' + c.step + ' 文' +
        (c.leaderName ? '　领先：' + esc(c.leaderName) : '') +
        '<br><span class="hint-dim">用「出价 &lt;价钱&gt;」出价，例：出价 ' + (c.price + c.step) + '</span></div>';
    } else {
      h += '<div class="modal-text">本期的东西都拍完了。</div>';
    }
    h += '<div class="panel-sec">本期书画（' + (a.lots || []).length + ' 件）</div>';
    if ((a.lots || []).length) {
      h += '<table class="data-table"><thead><tr><th>拍品</th><th>价</th><th>状态</th></tr></thead><tbody>';
      a.lots.forEach(l => {
        h += '<tr><td class="td-name">' + esc(l.name) + (l.isHigh ? ' <i class="tag-on">重器</i>' : '') + '</td>' +
          '<td>' + l.price + '</td><td>' + (l.sold ? ('落槌·' + esc(l.leaderName || '')) : '待拍') + '</td></tr>';
      });
      h += '</tbody></table>';
    }
    h += '<div class="panel-sec">我的寄拍</div>';
    if ((a.pending || []).length) {
      a.pending.forEach(p => { h += '<div class="modal-text">' + esc(p.name) + '（下一场替你出手，落槌抽 8% 佣金）</div>'; });
    } else {
      h += '<div class="modal-text hint-dim">还没寄拍东西。用「寄拍 &lt;物品名&gt;」交给柜上（须值 500 文以上）。</div>';
    }
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
    /* ---- 奇经八脉 ----
       主人 2026-10-11 两条意见，一起落在这里：
         ①「为什么我打坐一下就直接显示我冲开了任脉？（有点太小儿科的感觉）」
            → 后端已改成**进度制 + 顺序推进**（打坐必给进度，攒够才通一关），
              面板就得把「离下一关还差多少」摆在明面上，否则玩家只看见进度条没动。
         ②「经脉在哪看也不知道」
            → 这面板原本只列了「已通/百分比」，既没写下一脉是哪条、
              也没写通了能涨什么。现在补齐：**下一关进度条 + 每条脉的收益 + 冲脉顺序**。 */
    const md = m.meridians || [];
    const ms = m.meridianSummary || null;
    const MMAX = md.length ? (md[0].max || 8) : 8;
    if (md.length) {
      h += '<div class="panel-sec">' + (ms ? '下一关 · ' + esc(ms.name) : '奇经八脉（已全通）') + '</div>';
      if (ms) {
        h += '<div class="modal-text">进度 <b>' + ms.exp + '</b> / ' + ms.need +
          '　· ' + ms.pct + '%　· 通了这关就是第 ' + (ms.lv + 1) + '/' + MMAX + ' 关</div>';
        h += '<div style="height:8px;background:rgba(128,128,128,.22);border-radius:4px;overflow:hidden;margin:4px 0 8px">'
          + '<div style="height:100%;width:' + Math.max(0, Math.min(100, ms.pct)) + '%;background:#c8a04a"></div></div>';
        h += '<div class="modal-text hint-dim">打坐一次攒一分进度（悟性越高攒得越快），攒满就通一关 —— 不是坐一下开一条。</div>';
      } else {
        h += '<div class="modal-text">八脉全通，周身气息再无一处滞涩。</div>';
      }
      h += '<table class="data-table"><thead><tr><th>经脉</th><th>已通</th><th>通了能涨</th></tr></thead><tbody>';
      md.forEach(x => {
        const max = x.max || 8;
        const full = x.lv >= max;
        const hl = x.isNext ? ' style="background:rgba(200,160,74,.16)"' : '';
        h += '<tr' + hl + '><td class="td-name">' + esc(x.name) + (full ? ' ✔' : '') +
          (x.isNext ? '　<i style="opacity:.7;font-style:normal">正在冲</i>' : '') + '</td>' +
          '<td>' + x.lv + ' / ' + max + '</td>' +
          '<td>' + esc(x.bonusText || '周身流转更顺') + '</td></tr>';
      });
      h += '</tbody></table>';
      h += '<div class="modal-text hint-dim">冲脉有先后：任 → 督 → 冲 → 带 → 阴跷 → 阳跷 → 阴维 → 阳维。'
        + '一条通满，才轮到下一条。每通一关，涨多少当场会写在打坐的结果里。</div>';
    } else {
      h += '<div class="panel-sec">奇经八脉</div>';
      h += '<div class="modal-text">还没有内功根基。学一门内功（如《基本内功》），再去「打坐」。</div>';
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

    /* ---- 家园地牢（关押 / 提审 / 陪练 / 放出）----
       ⚠️ 只有开出了地牢（v.kidnap.dungeon.has）才渲染这一栏 ——
         没地牢的人不该看见一栏空牢房，也不该看见一堆点了会说「你还没有地牢」的按钮。 */
    const dg = v.kidnap && v.kidnap.dungeon;
    if (dg && dg.has) {
      h += '<div class="panel-sub">地牢 · ' + dg.level + ' 级（' + (dg.captives || []).length + '/' + dg.cap + '）</div>';
      if (!(dg.captives || []).length) {
        h += '<div class="modal-text">牢里空着。打倒的人装进麻袋扛回来，用「关押 &lt;人名&gt;」押进去。</div>';
      } else {
        h += '<div class="kv-list">';
        (dg.captives || []).forEach(c => {
          h += '<div class="kv"><span class="k">' + esc(c.name || '') + '</span><span class="v">' +
            '服从 ' + (c.obedience || 0) + '　好感 ' + (c.favor || 0) +
            '　气血 ' + (c.hpRatio || 0) + '%' +
            (c.interrogated ? '　已审 ' + c.interrogated + ' 次' : '') +
            (c.days ? '　关了 ' + c.days + ' 天' : '') + '</span></div>';
        });
        h += '</div>';
        h += '<div class="row-ops">' +
          (dg.captives || []).map(c => '<button class="op-btn" data-cmd="提审 ' + esc(c.name || '') + '">提审 ' + esc(c.name || '') + '</button>').join('') +
          (dg.captives || []).map(c => '<button class="op-btn" data-cmd="陪练 ' + esc(c.name || '') + '">陪练 ' + esc(c.name || '') + '</button>').join('') +
          '</div>';
        h += '<div class="row-ops">' +
          (dg.captives || []).map(c => '<button class="op-btn" data-cmd="放出 ' + esc(c.name || '') + '">放出 ' + esc(c.name || '') + '</button>').join('') +
          (dg.captives || []).map(c => '<button class="op-btn" data-cmd="卖人 ' + esc(c.name || '') + '">卖 ' + esc(c.name || '') + '</button>').join('') +
          '</div>';
      }
      h += '<div class="panel-note">牢里没人看着的时候，恨你的人会撬锁跑掉——要么常回家，要么赶紧出手。</div>';
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
          (k.marketStock || []).map(m => '<button class="op-btn" data-cmd="赎回 ' + esc(m.name || '') + '">赎 ' + esc(m.name || '') + '</button>').join('') +
          '</div>';
      }
    } else if (k.inBrothel) {
      /* ★ 主人第四轮：「青楼没有『赎人』按钮」。
         原来青楼这一栏只给一个「看赎人名册」——点了只是往日志打一份名单，
         想要赎人得自己手打「赎回 <人名>」，**入口等于没有**。
         现在把楼里挂赎身牌子的人直接列出来，一人一个「赎」按钮。 */
      h += '<div class="panel-sub">青楼待赎</div>';
      const inHouse = (k.marketStock || []).filter(m => m.to === 'brothel');
      if (!inHouse.length) {
        h += '<div class="modal-text">楼里眼下没有挂着赎身牌子的人。' +
          '（被打晕掳走、转卖到这儿的人，才会出现在名册上。）</div>';
      } else {
        h += '<div class="kv-list">';
        inHouse.forEach(m => {
          h += '<div class="kv"><span class="k">' + esc(m.name || '') + '</span><span class="v">' +
            '赎身 ' + ((m.price || 0) * 2) + ' 文' +
            (m.keeper ? '　（在' + esc(m.keeper) + '手里）' : '') + '</span></div>';
        });
        h += '</div><div class="row-ops">' +
          inHouse.map(m => '<button class="op-btn" data-cmd="赎回 ' + esc(m.name || '') + '">赎出 ' + esc(m.name || '') + '</button>').join('') +
          '</div>';
      }
      h += '<div class="row-ops"><button class="op-btn" data-cmd="赎回">看赎人名册</button></div>';
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
    const ORDER = ['新手', '主线', '支线', '门派', '委托', '江湖', '其他'];
    const groups = {};
    list.forEach(q => {
      const t = String((q && q.type) || '').trim() || '其他';
      (groups[t] = groups[t] || []).push(q);
    });
    const keys = Object.keys(groups).sort((a, b) => {
      const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    /* ---- 新手教程那条特别渲染（主人第四轮）----
       「『任务』里面只会显示当前新手教程进度」—— 所以这里**只给当前这一章**
       （章次 + 剧情 + 目标 + 进度条），不铺开全部章节；
       要看完整流程，点卡片底部那个按钮去「新手教程」面板（那边才是全的）。
       两份内容都来自后端同一份 guide 数据，不在这里另算。 */
    const newbieCard = q => {
      const cur = q.cur || 0, tot = q.count || 1;
      const pct = Math.max(4, Math.round(cur / Math.max(1, tot) * 100));
      let s = '<div class="quest-card newbie">';
      s += '<div class="q-name">' + esc(q.name) + '<span class="qn-badge">进行中</span></div>';
      s += '<div class="q-desc">' + esc(q.desc || '') + '</div>';
      s += '<div class="qnb-bar"><i style="width:' + pct + '%"></i></div>';
      s += '<div class="qnb-count">第 ' + (q.chapter || 1) + ' / ' + tot + ' 章　' + esc(q.chapterTitle || '') + '</div>';
      if (q.stageDesc) s += '<div class="q-stage">' + esc(q.stageDesc) + '</div>';
      if (q.goal) s += '<div class="qnb-goal">当前目标：' + esc(q.goal) + '</div>';
      if (q.hint) s += '<div class="qnb-hint">' + esc(q.hint) + '</div>';
      if (q.targetSect) s += '<div class="qnb-sect">这一程的去处：' + esc(q.targetSect) + '</div>';
      s += '<div class="qnb-foot"><button class="op-btn" data-cmd="guide">看完整流程（新手教程）</button></div>';
      return s + '</div>';
    };

    const card = q => {
      if (q && q.isTutorial) return newbieCard(q);
      let s = '<div class="quest-card"><div class="q-name">' + esc(q.name) + '</div>';
      s += '<div class="q-desc">' + esc(q.desc || '') + '</div>';
      s += '<div class="q-stage">当前阶段：' + esc(q.stageDesc || '—') + '</div>';
      /* 前置没做完（design/67 §5.2 P2）：**明说不解锁**。
         不写这一行，玩家就会陷在「明明到了地方却推不动、也不告诉我为什么」里 —— 那就是静默。 */
      if (q.locked) {
        s += '<div class="q-lock">🔒 还没到时候</div>';
        if (q.lockMsg) s += '<div class="q-lock-msg">' + esc(q.lockMsg) + '</div>';
      }
      if (q.targets && q.targets.length && !q.locked) {
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
      h += '<div class="q-done-title">已完成（' + done.length + '）' +
        '<button class="op-btn" data-cmd="清理已完成">清掉已完成</button></div><div class="q-done-list">';
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

  /* 物品的「有什么用」——主人要求行囊里能直接看见描述与效果。
     ⚠️ 后端 inventoryList 给的字段是 **`equippable`**（双 p），
        旧代码写的是 `it.equipable`（单 p）—— 于是「穿戴 / 持械」两个按钮**从来不显示**。
        （这就是铁律 29：字段名对不上，不报错、只是没有。） */
  const ITEM_STAT_CN = { atk: '攻击', def: '防御', dodge: '身法', parry: '招架', speed: '速度', critRate: '暴击', maxHp: '气血上限', maxMp: '内力上限', hp: '气血', mp: '内力' };
  const ITEM_TYPE_CN = { weapon: '兵器', armor: '护具', food: '吃食', consumable: '丹药', herb: '草药', book: '书册', material: '材料', tool: '家什', misc: '杂物' };
  function itemEffectText(it) {
    const out = [];
    if (it.stats) for (const k of Object.keys(it.stats)) out.push((ITEM_STAT_CN[k] || k) + ' ' + (it.stats[k] > 0 ? '+' : '') + it.stats[k]);
    if (it.healHp) out.push('果腹 +' + it.healHp);
    if (it.healMp) out.push('回复内力 +' + it.healMp);
    if (it.teachName) out.push('可学：「' + it.teachName + '」');
    return out;
  }

  function invHtml(v) {
    const list = v.inventory || [];
    if (!list.length) return '<div class="modal-text">行囊空空如也。</div>';
    let h = '<div class="inv-list">';
    list.forEach(it => {
      const eff = itemEffectText(it);
      const kind = it.slot || ITEM_TYPE_CN[it.type] || '';
      h += '<div class="inv-item">'
        + '<div class="inv-head"><span class="inv-name">' + esc(it.name) + '</span>'
        + (it.count > 1 ? '<span class="inv-count">×' + it.count + '</span>' : '')
        + (kind ? '<span class="inv-type">' + esc(kind) + '</span>' : '') + '</div>'
        + (it.desc ? '<div class="inv-desc">' + esc(it.desc) + '</div>' : '')
        + (eff.length ? '<div class="inv-eff">' + esc(eff.join('　')) + '</div>' : '')
        + '<div class="inv-ops">'
        + (it.usable ? '<button class="op-btn" data-cmd="use ' + esc(it.name) + '">使用</button>' : '')
        + (it.equippable ? '<button class="op-btn" data-cmd="wear ' + esc(it.name) + '">穿戴</button>' : '')
        + (it.equippable ? '<button class="op-btn" data-cmd="wield ' + esc(it.name) + '">持械</button>' : '')
        + '<button class="op-btn" data-cmd="look ' + esc(it.name) + '">细看</button>'
        + '<button class="op-btn" data-cmd="drop ' + esc(it.name) + '">丢弃</button>'
        + '</div></div>';
    });
    h += '</div>';
    return h;
  }

  function eqHtml(v) {
    /* ⚠️ 槽位表**不能在前端另写一份**：这里原来是
       `['武器','副手','头部','身体','手部','足部','腰饰','饰品']`，
       而后端 `equipmentList()` 给的是
       `['头部','颈部','身体','披风','手部','脚部','武器','副手','戒指','饰品']` ——
       两边对不上的结果是「颈部 / 披风 / 戒指」三格永远显示空、
       「足部 / 腰饰」两格永远查不到（后端根本没这两个键）。
       现在直接迭代后端给的数组，只有一份真相。 */
    const list = v.equipment || [];
    let h = '<table class="data-table"><thead><tr><th>部位</th><th>装备</th><th>操作</th></tr></thead><tbody>';
    list.forEach(s => {
      h += '<tr><td>' + esc(s.slot) + '</td>' +
        '<td class="td-name">' + (s.name ? esc(s.name) : '<span class="dim">—空—</span>') + '</td>' +
        '<td class="td-ops">' + (s.name ? '<button class="op-btn" data-cmd="remove ' + esc(s.name) + '">卸下</button>' : '') + '</td></tr>';
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
  /* 地图缩放档位（2026-10-11 重设计新增）。
     为什么需要它：原来格子只有两档尺寸（窄屏 52 / 桌面 30），全图 34 个区域铺开后
     每格 30px、名字只剩 4 个字 —— 想看清某个区域只能靠「飞往」跳过去。
     现在给三档（0.7 远观 / 1 常规 / 1.4 细看），配合画布上的悬浮工具条。 */
  let mapZoom = 1;
  /* 点了「区域名按钮」后要飞过去的目标区域 id。
     因为切到世界地图要重开面板（重渲染），跨渲染记住目标，渲染完再平移。 */
  let pendingPanRegion = null;

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
    /* 缩放档位（画布右上角工具条切换）。抽取环境里没有 mapZoom → 退回 1。 */
    let z = (typeof mapZoom === 'undefined') ? 1 : Number(mapZoom);
    if (!(z > 0)) z = 1;
    const ZMIN = 0.7, ZMAX = 1.4;
    z = Math.min(ZMAX, Math.max(ZMIN, z));
    const MAP_CELL = Math.round((NARROW ? 52 : 30) * z);   // 每格边长（含走廊）
    const MAP_NODE = Math.round((NARROW ? 46 : 26) * z);   // 格子方块边长
    const MAP_PAD = NARROW ? 30 : 34;     // 画布留白
    const M_LINE = NARROW ? 1.15 : 1;     // 名字行距
    /* 名字最多显示几个字：跟着缩放走（放大就能多塞两个字，缩小就砍短些） */
    const M_NAME_MAX = Math.max(3, Math.round((NARROW ? 6 : 4) * z));
    const mFont = r => Math.max(7, Math.round((NARROW ? (r.current ? 14 : 13) : (r.current ? 9 : 8)) * z));

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
    /* 🔴 主人 2026-10-11：「区域地图只居中显示那一块区域，但你区域地块框框外面
       还有那么大一片空地块不删是留着做什么的。」
       根因：取景框用的是后端那个 `regionBoxes[x]`，而它**被 terrain / minW 撑过** ——
       区域面积凑不够时，后端会拿旷野山林把框填大，于是框里留出一大片
       没有任何地块的空地，看着像「画布没铺满」。
       改法：区域模式**按本区域房间的实际范围**取景（真实占地的紧包围盒），
       一格多余的都不留；后端那个 box 只留着取颜色和名字。 */
    let b = b0;
    if (sc === 'region' && curRegion) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const r of rooms) {
        if (r.x < minX) minX = r.x;
        if (r.y < minY) minY = r.y;
        if (r.x > maxX) maxX = r.x;
        if (r.y > maxY) maxY = r.y;
      }
      if (isFinite(minX) && isFinite(minY)) {
        b = { minX, minY, w: (maxX - minX + 1), h: (maxY - minY + 1) };
      } else {
        b = scopeBox ? { minX: scopeBox.x, minY: scopeBox.y, w: scopeBox.w, h: scopeBox.h } : b0;
      }
    }
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
      /* 出口列表里，**跨出本区域**的那几个额外标一句「→ XX」——
         站在区域边上时，光看方向名不知道会走出界（主人 2026-10-11：
         「能否提示该方向继续往前走通往哪个区域」）。同区域内的出口不标，
         免得一行字被括号塞满。 */
      /* ⚠️ 跨区域出口由**后端从真出口**算好（`crossExits`），前端别拿坐标去反查
         隔壁是谁 —— 区域装箱在区域之间留了 2 格空当，跨区域的房间在图上从不相邻。 */
      const regNameOf = rid => ((m.regions || []).find(x => x.id === rid) || {}).name || rid;
      const ce = here.crossExits || {};
      h += '　出口：' + here.exits.map(d => {
        const cn = DIR_CN[d] || d;
        return ce[d] ? cn + '<span class="map-out">→' + esc(regNameOf(ce[d])) + '</span>' : cn;
      }).join(' / ');
    }
    h += '</div>';
    /* --- 第二行：视野切换 + 进度 + 图例（原来这三块各占一整行，把画布挤到下面；
       重设计后并成紧凑的两行 —— 画布才是主角） --- */
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

    /* --- 图例（收成一行小字） --- */
    h += '<div class="map-legend">' +
      '<span><i class="dot dot-here"></i>你在这里</span>' +
      '<span><i class="dot dot-near"></i>一步可达</span>' +
      '<span><i class="dot dot-known"></i>去过</span>' +
      '<span><i class="dot dot-unknown"></i>未探索</span>' +
      '<span><i class="dot dot-edge"></i>出界方向</span>' +
      '<span class="ml-tip">点「一步可达」的格子直接走过去；拖动可平移，右上角可缩放</span></div>';

    /* --- 区域名按钮：点一下就飞过去（主人 2026-10-10 要求）---
       世界地图铺得很大，手机屏翻着累；给一排「区域名」按钮，点谁看谁。
       ⚠️ 区域清单**从后端 m.regions 取**，前端不硬编码名单（后端加了区域自动跟上）。
       点按钮 → 切到世界地图（区域模式只画本区，飞不过去）→ 把视角平移到该区中心。 */
    /* 「飞往」（主人 2026-10-11）：
       「可以改成玩家去过的城市都可以飞到该城市入口处，门派也是一样入口处，
         前提是玩家去过那里」。
       所以这里一分为二 —— **去过的地方点了是真赶路**（落到该区域 entry 房间），
       没去过的保持原样（只把视角平移过去看看）。两者长得不一样，免得误点：
       能飞的带一个 ↗ 与金边，不能飞的压暗。判定（canFly）由后端算好下发，
       前端不自己猜 —— 它拿不到 visited 旗标。 */
    /* 「飞往」这块**已并入底部的「地名索引」**（见返回前一节）——
       原来它在画布上方占一大条横滚按钮，把画布顶到下面去，信息还和「区域总览」重复。
       这里保留原注释只为交代去向，不再渲染。 */

    /* --- 画布（外加一个定位包裹层，好让工具条与「一步可达」浮在画布上） --- */
    const W = b.w * MAP_CELL + MAP_PAD * 2;
    const H = b.h * MAP_CELL + MAP_PAD * 2;
    h += '<div class="map-stage">';
    /* 画布悬浮工具条（重设计新增）：全图铺得很开时，拖远了会找不到自己 ——
       给一个「回到我」；格子太密/太疏时给 ± 缩放。原来这两件事都没办法做。 */
    h += '<div class="map-tools">' +
      '<button class="mt-btn" data-map-tool="here" title="把视角拉回你所在的地块">回到我</button>' +
      '<button class="mt-btn mt-z" data-map-tool="zout" title="缩小，看得更远"' + (z <= ZMIN + 1e-6 ? ' disabled' : '') + '>－</button>' +
      '<span class="mt-zoom" title="当前缩放">' + Math.round(z * 100) + '%</span>' +
      '<button class="mt-btn mt-z" data-map-tool="zin" title="放大，看得更清"' + (z >= ZMAX - 1e-6 ? ' disabled' : '') + '>＋</button>' +
      '</div>';
    h += '<div class="map-canvas' + (NARROW ? ' map-narrow' : '') + '" style="width:' + W + 'px;height:' + H + 'px" tabindex="0">';

    /* 1) 底：整张网格纸（让它看起来是一张连续地图） */
    h += '<div class="map-grid-bg" style="width:' + (b.w * MAP_CELL) + 'px;height:' + (b.h * MAP_CELL) + 'px;' +
      'left:' + MAP_PAD + 'px;top:' + MAP_PAD + 'px;background-size:' + MAP_CELL + 'px ' + MAP_CELL + 'px"></div>';

    /* 2) 区域底色块 —— ★ 只画**真实房间占的那块**（主人第四轮：
       「没有真实地块的那些地图上的背景方块在地图上删了」）。
       后端给的 `w/h` 是被 terrain/minW 撑过的框（面积不够时用旷野山林填出来的），
       比真实房间那一团大得多，所以世界地图上到处是一块块**空底色方块**，像没铺完的砖。
       `roomW/roomH` 才是房间实际占的尺寸（且房间就贴着框的左上角铺），
       换过来底色块就只框住有地块的地方。 */
    const boxes2 = scopeBox ? { [curRegion]: scopeBox } : boxes;
    /* 区域/城市名**单独收集**，最后再画（见下方 regionLabels 的说明） */
    let regionLabels = '';
    Object.keys(boxes2).forEach(k => {
      const box = boxes[k];
      /* 区域模式下这块底色跟着上面的**紧包围盒**走（不再用后端那个撑大的框），
         否则底色块会从画布左上角伸出去，看着比地图还大一圈。 */
      const tight = (sc === 'region' && k === curRegion);
      const x0 = tight ? b.minX : box.x;
      const y0 = tight ? b.minY : box.y;
      const bw0 = tight ? b.w : (box.roomW || box.w);
      const bh0 = tight ? b.h : (box.roomH || box.h);
      const left = (x0 - b.minX) * MAP_CELL + MAP_PAD;
      const top = (y0 - b.minY) * MAP_CELL + MAP_PAD;
      const bw = bw0 * MAP_CELL;
      const bh = bh0 * MAP_CELL;
      /* data-cx/data-cy = 该框中心在画布内容坐标系里的像素位置（区域名按钮「飞过去」用） */
      h += '<div class="map-region-box" style="left:' + left + 'px;top:' + top + 'px;' +
        'width:' + bw + 'px;height:' + bh + 'px;background:' + esc(box.color) + '14;border-color:' + esc(box.color) + '44"' +
        ' data-region-box="' + esc(k) + '"' +
        ' data-cx="' + (left + bw / 2) + '" data-cy="' + (top + bh / 2) + '"></div>';
      /* ★ 城市/区域名**移到外框上方外侧**（主人 2026-10-10 亲报：
         「城市地块被一个大框框住了，城市名字也在框中间被挡着，把城市名字往上移一下移到框外」）。
         原来这个 span 在 `.map-region-box` 内部，而该 box 是 z-index:0 的层叠上下文，
         于是名字被走廊(z-index:1)、房间方块(z-index:2) 层层盖住 —— 看着就像「被挡在框中间」。
         现在把它拆出来、作为 box 的**兄弟节点**画在框顶边之上（top 再上移一个行高），
         并以独立 z-index（.mrb-label 里配 6）压在所有地块/连线之上；
         定位一律用内联 left/top，随便框在哪都不会落回框里。 */
      const lblFont = NARROW ? 15 : 11;
      regionLabels += '<span class="mrb-label" style="left:' + left + 'px;top:' +
        (top - Math.round(lblFont * 1.5)) + 'px;color:' + esc(box.color) +
        ';font-size:' + lblFont + 'px" data-region-box="' + esc(k) + '">' +
        esc(box.name) + '</span>';
    });

    /* 3) 地形装饰（树石山水…）——★ 主人第四轮要求**删掉**：
       「把地图界面树木水流之类的图标删了」。
       原来每个 terrain 格子画一个 ♣/≈/❄ 之类的符号，看着像贴纸，
       而且它们本来只是「区域面积不够时撑框用的填充」，不是真的地块。
       数据里还留着（`50_map.json` 的 terrain、`maplayout` 的 tOut 都不动），
       只是前端**不再画**—— 以后想做成底纹/换成正视图随时能开回来。 */

    /* 4) 走廊：一条 path 画完所有连通线（相邻房间连成一片）
       ★ 跨区域也要连（主人第四轮：「世界地图应该是类似于区域地图那样显示地块与地块
       之间的连接，从一个区域到另一个区域之间的地块之间却没有做出连接」）。
       老写法是 `rooms.find(x => x.x === r.x + dx && x.y === r.y + dy)` ——
       **只在当前渲染的集合里找邻居**。世界地图模式下虽然 rooms 几乎是全图，
       但区域装箱（packRegions）会把各区域推开、中间留空，
       而 region 模式下 rooms 只有当前区域 → 跨区域那条连线永远找不到对方、画不出。
       现在改成用 `m.cells`（**全图坐标表**，mapView 已经给了）建一张「坐标 → 房间」反查表：
       邻居只要坐标对得上就连，区域边界照连不误；另一端不在本次渲染集合里就跳过
       （画出去也没有意义）。 */
    const allCells = m.cells || {};
    const xyKey = (x, y) => x + ',' + y;
    const idByXY = {};
    for (const cid of Object.keys(allCells)) {
      idByXY[xyKey(allCells[cid].x, allCells[cid].y)] = cid;
    }
    const shown = {};
    rooms.forEach(r => { shown[r.id] = r; });
    let paths = '';
    let pathsKnown = '';
    rooms.forEach(r => {
      (r.exits || []).forEach(dir => {
        const d = DIR_OFF[dir];
        if (!d) return;
        const nid = idByXY[xyKey(r.x + d[0], r.y + d[1])];
        const nb = nid ? shown[nid] : null;     /* 只画两端都在图上的 */
        if (!nb) return;
        const x1 = cx(r), y1 = cy(r), x2 = cx(nb), y2 = cy(nb);
        const seg = 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + ' ';
        if (r.visited && nb.visited) pathsKnown += seg;
        else paths += seg;
      });
    });
    /* 4b) 跨区域「桥」（2026-10-11 主人）——
       原话：「我要的世界地图是所有地图首尾连接：如果这个 A 区域地图边缘的地块
       再往前走一步就是 B 区域，那么这个 A 区域的地块就用线连接那块 B 区域的地块，
       整个分散的世界地图合并成一个完整的大地图。」
       上面那条走廊逻辑只在**坐标相邻**时才连线，而 `packRegions` 把各区域推开、
       中间留了空当 —— 跨区域的两个房间在图上不相邻，走廊永远连不上。
       所以后端把这类边单独算成 `m.bridges` 下发（见 engine.mapView），
       这里只负责画：一条虚线，把两端的格子牵起来。
       ⚠️ **只画跨区域的**（`crossRegion`）。同区域但图上不相邻的还有一百多条
          （斜向出口 / 上下层 / 区域内部留空），全画出来整张图会变成蛛网，
          而主人要解决的是「区域与区域之间断开」这件事。 */
    let pathsCrossDim = '';
    let pathsCrossKnown = '';
    (m.bridges || []).forEach(br => {
      if (!br.crossRegion) return;
      const A = shown[br.a], B = shown[br.b];
      if (!A || !B) return;                 /* 两端都在图上才画（区域模式只画本区） */
      const seg = 'M' + cx(A) + ' ' + cy(A) + ' L' + cx(B) + ' ' + cy(B) + ' ';
      if (A.visited && B.visited) pathsCrossKnown += seg;
      else pathsCrossDim += seg;
    });
    h += '<svg class="map-edges" width="' + W + '" height="' + H + '">' +
      '<path d="' + paths + '" class="edge edge-dim"/>' +
      '<path d="' + pathsKnown + '" class="edge edge-known"/>' +
      '<path d="' + pathsCrossDim + '" class="edge edge-dim edge-bridge"/>' +
      '<path d="' + pathsCrossKnown + '" class="edge edge-known edge-bridge"/></svg>';

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
      /* ★ 去掉「战争迷雾」（主人第四轮要求：「地图不要搞那些战争迷雾」）。
         原来是「去过/一步可达才显示名字，没去过的只留一个淡点」——
         世界地图上看过去一片空白小方块，不知道哪儿是哪儿，也没法规划路线。
         现在**所有地块都显示名字**，只用样式区分「去过 / 没去过」：
           · 去过 → 正常白底
           · 没去过 → 淡一些（`dim`）但仍看得清名字
         仍保留「一步可达 / 附近」这两种**功能性**高亮（点一下能走过去），
         那不是迷雾、是有用的信息。 */
      const label = r.current ? '你' : shortName(r.name, M_NAME_MAX);
      h += '<button class="' + cls + (r.visited || r.current ? '' : ' dim') +
        '" style="left:' + left + 'px;top:' + top + 'px;' +
        'width:' + MAP_NODE + 'px;height:' + MAP_NODE + 'px;' +
        '--stripe:' + esc(stripe) + '"' +
        ' title="' + esc(r.name) + (r.region ? '（' + esc((reg && reg.name) || r.region) + '）' : '') +
        (r.dist >= 0 ? '　' + r.dist + ' 步' : '　很远') + '"' +
        ' data-room="' + esc(r.id) + '"' +
        (r.near ? ' data-go="' + esc(r.id) + '"' : '') + '>' +
        '<span class="mn-name" style="font-size:' + mFont(r) + 'px;line-height:' + M_LINE + '">' + esc(label) + '</span></button>';
    });

    /* 区域/城市名：压在所有地块之上画（独立于 .map-region-box 的 z-index:0 上下文，
       名字永远在框外、在最上层，不会被框线或地块挡住）。 */
    h += regionLabels;

    /* 5) 区域边界处的「往这边走是哪儿」（★ 主人 2026-10-11：
       「地图界面每个区域都有边界，能不能在地图上边界处提示该方向继续往前走通往哪个区域」）。
       邻居关系由后端算好（`regionBoxes[x].neighbors`，见 maplayout.computeRegionNeighbors），
       前端只管把牌子贴到两块之间那道缝里。

       ⚠️ 只画东 / 南两个方向：A 在东边的邻居是 B，等价于 B 在西边的邻居是 A，
       两个方向画出来是**同一道缝上的同一件事**，画两遍就是叠字。
       同理区域模式下只画本区一块、邻居不在图上，不画（画了牌子会挂在画布外被裁掉）。 */
    /* 一块牌子。定义在 mapHtml 内部：多个测试脚本会把 mapHtml 源码单独抽出来跑，
       抽出去的环境里没有模块级函数 —— 挂在外面就是 ReferenceError。 */
    const edgeHintHtml = (px, py, arrow, box) =>
      '<span class="map-edge-hint" style="left:' + px + 'px;top:' + py + 'px;' +
      'font-size:' + (NARROW ? 13 : 11) + 'px;' +     /* 手机上一格就小，牌子字号跟着放大 */
      'border-color:' + esc(box.color) + '66" title="往这个方向继续走，就是' + esc(box.name) + '">' +
      '<i class="meh-arrow" style="color:' + esc(box.color) + '">' + arrow + '</i>' +
      esc(box.name) + '</span>';

    let edgeHints = '';
    if (!scopeBox) {
      const xPx = gx => (gx - b.minX) * MAP_CELL + MAP_PAD;
      const yPx = gy => (gy - b.minY) * MAP_CELL + MAP_PAD;
      Object.keys(boxes).forEach(k => {
        const a = boxes[k];
        const nb = a.neighbors || {};
        /* 东：贴在两块之间那道竖缝里，纵向对齐两块的重叠段中点 */
        if (nb.e && boxes[nb.e]) {
          const bx = boxes[nb.e];
          const midY = (Math.max(a.y, bx.y) + Math.min(a.y + a.h, bx.y + bx.h)) / 2;
          edgeHints += edgeHintHtml(xPx((a.x + a.w + bx.x) / 2), yPx(midY), '→', bx);
        }
        /* 南：贴在两块之间那道横缝里，横向上对齐重叠段中点。
           位置上**靠近上边那块**（34% 处）—— 下边那块自己的区域名就写在它框顶上方，
           居中的话两块牌子会撞一起。 */
        if (nb.s && boxes[nb.s]) {
          const bx = boxes[nb.s];
          const y0 = a.y + a.h, y1 = bx.y;
          const midX = (Math.max(a.x, bx.x) + Math.min(a.x + a.w, bx.x + bx.w)) / 2;
          edgeHints += edgeHintHtml(xPx(midX), yPx(y0 + (y1 - y0) * 0.34), '↓', bx);
        }
      });
    }
    h += edgeHints;

    h += '</div>';

    /* --- 快速移动：一步可达（★ 重设计：从画布**下方**挪到画布**里面**贴着底边）
       为什么挪：玩家看地图时眼睛在画布上，出口按钮却在画布外的下一屏 ——
       手机上一屏塞不下，得滑下去找，找完再滑回来看地图。
       贴底之后，看图和点走是同一眼。 */
    const nears = rooms.filter(r => r.near);
    if (nears.length) {
      h += '<div class="map-quick"><span class="mq-title">一步可达</span>';
      nears.forEach(r => {
        h += '<button class="mq-btn" data-go="' + esc(r.id) + '">' + esc(r.name) + '</button>';
      });
      h += '</div>';
    }
    h += '</div>';   /* 关 .map-stage */

    /* --- 地名索引（★ 重设计：把原来**三块**重复的区域清单合成一块）---
       原来这里有：①「飞往」34 个按钮横排、②「区域总览」34 行、③图例里的颜色说明，
       三块都在讲「有哪些区域、去过多少」。现在合成一块「地名索引」：
         · 一行一个区域：颜色点 + 名字 + 已探索数 + ↗（能飞的才带）
         · **去过的排在前面**（能飞的是当下有用的），未去过的收进一个可折叠的「其余 N 处」
       这样默认只占两三行，画布就能占满剩下的高度。 */
    const regs = (m.regions || []).slice();
    const canFly = regs.filter(r => r.canFly);
    const rest = regs.filter(r => !r.canFly);
    const regBtn = (r) => {
      const can = !!r.canFly;
      const tip = can
        ? ('飞往' + r.name + (r.entryName ? '（落在' + r.entryName + '）' : ''))
        : ('没去过' + r.name + '，点了只是把视角移过去');
      return '<button class="mrn-btn' + (r.id === curRegion ? ' cur' : '') + (can ? ' canfly' : ' nofly') + '"' +
        (can ? ' data-fly-region="' + esc(r.name) + '"' : ' data-pan-region="' + esc(r.id) + '"') +
        ' title="' + esc(tip) + '">' +
        '<i class="mrn-dot" style="background:' + esc(r.color || '#999') + '"></i>' +
        '<span class="mrn-name">' + esc(r.name) + '</span>' +
        '<span class="mrn-num">' + (r.visitedCount || 0) + '/' + (r.count || 0) + '</span>' +
        (can ? '<i class="mrn-fly">↗</i>' : '') + '</button>';
    };
    h += '<div class="map-region-nav" title="去过的地方，点一下人就直接过去；没去过的，只能挪挪视角看看">';
    h += '<div class="mrn-head"><span class="mrn-title">地名索引</span>' +
      '<span class="mrn-sub">去过 ' + regs.filter(r => (r.visitedCount || 0) > 0).length + '/' + regs.length +
      ' 处　带 ↗ 的能直接过去</span></div>';
    if (canFly.length) h += '<div class="mrn-grid">' + canFly.map(regBtn).join('') + '</div>';
    else h += '<div class="mrn-empty">还没去过别处。先把脚下这一片走熟。</div>';
    if (rest.length) {
      h += '<details class="mrn-more"' + (canFly.length ? '' : ' open') + '>' +
        '<summary>其余 ' + rest.length + ' 处（没去过，点了只移视角）</summary>' +
        '<div class="mrn-grid">' + rest.map(regBtn).join('') + '</div></details>';
    }
    /* 服务端「区域总览」那份数据仍在（m.regions 的 visitedCount / hasCurrent 都用上了），
       只是不再单独铺一层重复列表 —— 上面每个按钮里已经带了同一组数字。 */
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

  /* 指令帮助
   * ⚠️ 主人 2026-10-11：「把游戏里一些英文指令的教程改成中文指令，
   *    比如拍卖行界面的 bid 教程改成『出价』这种」。
   *    所以这张表**中文在前，英文一律不写进正文** ——
   *    英文别名在后端照旧认（commands.js 的 reg 都还在），只是不再往教程里写，
   *    免得玩家以为非敲英文不可。
   *    ⚠️ 改动时请对着 commands.js 的 reg([...]) 抄中文别名，
   *      别自己编 —— 教程里写一个不存在的命令，玩家点不着就是「静默失效」。 */
  function helpHtml() {
    const groups = [
      ['行走', [
        '北 南 东 西 上 下　（也可写「往北走」「朝东」）',
        '去 <方向|房间名>　前往某处（中文：前往 / 走）',
        '看　查看四周（中文：观察 / 周围）',
        '看 <人物|物品>　细看',
        '爬山坡 / 跳崖 / 渡河　互动出口（看四周时会提示）',
      ]],
      ['交流', [
        '说 <内容>　开口说话（中文：说道）',
        '动作 <动作>　做个动作',
        '喊 <内容>　大声喊（中文：喊话）',
        '密语 <人物> <内容>　只给一个人听',
        '称号 <称号>　换个称号',
      ]],
      ['物品', [
        '行囊　看身上有什么（中文：物品）',
        '捡 <物品>　拾起来（中文：拿 / 拾取）',
        '丢 <物品>　扔下（中文：丢弃 / 放下）',
        '用 <物品>　使用（中文：吃 / 喝 / 服用）',
        '穿 <装备>　穿上身（中文：装备上 / 持）',
        '卸下 <装备>　脱下来（中文：脱）',
      ]],
      ['武学', [
        '武学　武学列表（中文：功夫）',
        '学 <人物> <武学>　向人请教（中文：学习）',
        '练 <武学>　修炼（耗内力；内功可冲奇经八脉）',
        '练　打坐养气（恢复内力）（中文：练功 / 修炼）',
        '淬体 <武学>　外功根基，伤气血耗体力，宜备丹药（中文：淬炼 / 炼体）',
        '炼丹 <方> / 炼器 <方> / 画符 <方>　须有对应器具与材料',
        '装备武学 <槽位> <武学名>　把一门武学放到身上',
        '绝招 <招式>　出手绝招（中文：施展；刀枪棍剑类须持对应兵刃）',
        '忘记 <武学>　忘掉一门',
      ]],
      ['师承 · 宗门', [
        '收徒 <人名>　须好感≥30 且你有武学',
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
        '门派　门派信息',
        '拜师 <门派>　入门（中文：入门）',
        '脱离门派　叛出师门（中文：叛门）',
        '升职　晋升（中文：晋级）',
        '贡献　捐献（中文：捐献）',
      ]],
      ['战斗', [
        '杀 <人物>　出手（中文：攻击 / 打）',
        '逃跑　走为上策（中文：跑）',
        '自动战斗　交给脚本来打',
      ]],
      ['任务', [
        '任务　任务日志',
        '接取 <任务>　接下这件事（中文：接任务）',
        '交任务　回去汇报（中文：交差）',
        '放弃 <任务>　不干了（中文：放弃任务）',
      ]],
      ['店铺 · 拍卖', [
        '货 <商人>　看货（中文：买卖）',
        '买 <物品> [数量]　购买',
        '卖 <物品> [数量]　出售',
        '出价 <价钱>　在拍卖行加价（中文：叫价）',
        '寄拍 <物品名>　交给柜上代拍（中文：寄卖）',
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
        '打工　酒楼跑堂、药店抓药赚钱（费饱食/饮水）',
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
        '存档 / 读档　存读档',
        '模组　看装了哪些模组',
        '地图　江湖舆图（中文：舆图）',
        '状态　自身状态（中文：查看状态）',
        '属性　属性详情',
        '时间　现在什么时辰（中文：时辰）',
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

      /* 画布工具条（重设计新增）：回到我 / 缩放。
         ⚠️ 缩放要**重渲染**才能生效（格子尺寸是渲染时算的），
         而「回到我」只是滚动位置，不重渲染（重渲染会把拖动位置也重置，反而更差）。 */
      document.querySelectorAll('#modal-body [data-map-tool]').forEach(b => {
        b.onclick = () => {
          const t = b.getAttribute('data-map-tool');
          if (t === 'here') { centerMapOnHere(); return; }
          const step = 0.2;
          const next = t === 'zin' ? mapZoom + step : mapZoom - step;
          mapZoom = Math.min(1.4, Math.max(0.7, Math.round(next * 100) / 100));
          closeModal();
          panel('map');
        };
      });

      /* 区域总览：点某个区域 -> 切到世界地图看全图 */
      /* ⚠️ 原来这里绑的是「区域总览」的 `.mro-item` —— 重设计把那块并进了「地名索引」，
         同一个点击目标现在由 `[data-pan-region]` / `[data-fly-region]` 承担（见下方）。
         这里的旧选择器留着无害（匹配不到就是空转），但**不要再往里加逻辑**。 */

      /* ★ 区域名按钮：点一下视角直接飞到该区域（居中显示）（主人 2026-10-10）。
         区域模式只画本区，飞不过去 → 先切世界地图再飞；已在世界地图则当场平移。 */
      document.querySelectorAll('#modal-body [data-pan-region]').forEach(b => {
        b.onclick = () => {
          const rid = b.getAttribute('data-pan-region');
          if (!rid) return;
          if (mapScope !== 'world') {
            mapScope = 'world';
            pendingPanRegion = rid;      /* 跨渲染记住：重开面板后按它平移 */
            closeModal();
            panel('map');
            return;
          }
          centerMapOnRegion(rid);
        };
      });

      /* ★ 「飞往」：去过的地方真赶路（主人 2026-10-11）。
         与上面那条的区别 —— 上面是「看地图」，这条是「上路」。
         发的是后端真指令 `飞往 <地名>`，由后端复核「去过没有」（前端不做安全判定）。 */
      document.querySelectorAll('#modal-body [data-fly-region]').forEach(b => {
        b.onclick = () => {
          const nm = b.getAttribute('data-fly-region');
          if (!nm) return;
          closeModal();
          doCmd('飞往 ' + nm, { fromButton: true });
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
         居中后「你在这里」的红点就在正中，「一步可达」的房间自然落在它四周。
         ★ 视角**自动追随玩家**：本函数在每次地图重渲染时都会跑（开图 / 切视野 / 走一步再开），
         始终把玩家所在格摆在视野中央。
         例外：点了「区域名按钮」要飞往某区域时（pendingPanRegion），本次改为居中到那个区域。 */
      if (pendingPanRegion) {
        const rid = pendingPanRegion;
        pendingPanRegion = null;
        centerMapOnRegion(rid);
      } else {
        centerMapOnHere();
      }
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
    物品: 'inventory', 查看物品: 'inventory', 身上物品: 'inventory', 我的物品: 'inventory',
    score: 'score', sc: 'score', 状态: 'score', 查看状态: 'score', 状态一览: 'score',
    attr: 'attr', 属性: 'attr', 属性详情: 'attr',
    skills: 'skills', skill: 'skills', 武学: 'skills', 武功: 'skills', 查看武学: 'skills',
    auction: 'auction', 拍卖: 'auction', 拍卖行: 'auction', 竞价: 'auction',
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
    符箓: 'martial', 淬体: 'martial',
    /* ⚠️ 这里**不能**放「打坐」。
       原先写的是 `打坐: 'martial'`，于是玩家在输入框敲「打坐」时，
       `panelForCmd` 精确命中 → 本地直接把武学面板弹出来，**根本没有打坐**。
       而教程第 3 步的提示原话就是「敲 lian 练功（『练功』『打坐』都行）」，
       武学修为面板里也写着「再去『打坐』」—— 教了却点不动，是典型的
       「该有的反应没有」。
       （屏幕下方的「打坐」按钮一直用的是英文 `meditate`，正是为了绕开这个坑；
         敲中文的玩家就没被照顾到。现在统一：`打坐` 一律交给后端。）
       `修炼` / `淬体` 保留面板跳转：它们后面还要接一个武学名，光敲两个字
       打开面板让人挑，是说得通的。 */
    /* 练武学（主人 2026-10-10）：屏幕下方快捷键点开，面板上列已学会的武学，点一个就自动练。 */
    practice: 'practice', 练武学: 'practice', 练功房: 'practice',
    sectfounder: 'found', 创宗: 'found', 招贤: 'found', 逐出师门: 'found', 演武: 'found', 大比: 'found', 解散宗门: 'found',
    recruit: 'found', drill: 'found', contest: 'found', disciple: 'found', tutor: 'found', founded: 'found',
    宗门: 'found',
    slaves: 'slaves', 奴册: 'slaves', 奴仆: 'slaves', 护院: 'slaves', 麻袋: 'slaves', 袋: 'slaves',
    地牢: 'slaves', 牢房: 'slaves',
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

    /* 键盘：方向键平移、Home 回到我（重设计新增）。
       画布带 tabindex=0，点一下就能聚焦 —— 桌面端不必非按住鼠标拖。 */
    el.addEventListener('keydown', e => {
      const step = 60;
      const k = e.key;
      if (k === 'ArrowLeft') { el.scrollLeft -= step; }
      else if (k === 'ArrowRight') { el.scrollLeft += step; }
      else if (k === 'ArrowUp') { el.scrollTop -= step; }
      else if (k === 'ArrowDown') { el.scrollTop += step; }
      else if (k === 'Home') { centerMapOnHere(); }
      else return;
      if (e.preventDefault) e.preventDefault();
    });
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

  /* 把视角平移到「某个区域」的正中（区域名按钮「飞过去」）。
     区域框中心在画布内容坐标系里的位置，由 mapHtml 写进 `data-cx / data-cy`
     （见区域底色块那段），这里**从 DOM 反读**，不重算布局几何。
     ⚠️ region 模式只画当前区域一个框 → 找不到目标框时返回 false（调用方已在切世界地图）。 */
  function centerMapOnRegion(regionId) {
    const canvas = document.querySelector('#modal-body .map-canvas');
    if (!canvas) return false;
    const boxes = document.querySelectorAll('#modal-body .map-region-box') || [];
    let box = null;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b && b.getAttribute && b.getAttribute('data-region-box') === regionId) { box = b; break; }
    }
    if (!box) return false;
    const ccx = parseFloat(box.getAttribute('data-cx'));
    const ccy = parseFloat(box.getAttribute('data-cy'));
    if (!isFinite(ccx) || !isFinite(ccy)) return false;
    const vw = canvas.clientWidth || (typeof innerWidth === 'number' ? innerWidth : 0);
    const vh = canvas.clientHeight || 0;
    if (vw > 0 && canvas.scrollWidth > vw) canvas.scrollLeft = Math.max(0, ccx - vw / 2);
    if (vh > 0 && canvas.scrollHeight > vh) canvas.scrollTop = Math.max(0, ccy - vh / 2);
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

  /* ---- 「脱不开身」的状态：吐纳 / 双修 / 采补 ----
     主人 2026-10-11：不要「收功」按钮，**点页面上任何别的按钮就该退出这个状态**。
     走后端的指令由服务端统一处理（`engine.exec` 认出这不是「继续」指令，
     自动收状态再执行），但**本地面板指令压根不过服务端** —— 所以这里要补一趟，
     否则点「背包」只在前端弹个面板，人还坐在那儿吐纳。 */
  function busyState() {
    const v = S.view || {};
    return (v.player && v.player.busy) || null;
  }
  async function exitBusyState() {
    try {
      const d = await api.exec('收功');
      if (d) afterAction(d);
    } catch (e) { /* 退不成也不该挡着开面板 */ }
  }

  /* ============================================================
   *  「脱不开身」的那几件事：点一次就自己往下走（主人 2026-10-11）
   *
   *  主人两轮的说法合起来是：
   *    ·「『吐纳』要求是点击一次后会自动持续吐纳（间隔 1 秒或者你觉得间隔多少秒），
   *       而不是每点一下吐纳一轮」；
   *    ·「双修是要和吐纳一样，点击一下然后间隔多久自动弹出剧情的」。
   *  ⇒ 所以**吐纳、双修、采补三条都自动连发**，一律 1 秒一轮，
   *    剧情会一轮一轮自己弹出来，玩家不用一直点。
   *
   *  ⚠️ 驱动放在**前端**而不是后端：后端一轮就是一轮（指令语义没变），
   *     「自动连发」是界面行为。好处是玩家点别的按钮退出时天然就停了 ——
   *     不用在后端多养一个「谁在自动走」的状态。
   *  ⚠️ 采补也一并接上：它和双修是同一套流程（`dualcultivate.round`），
   *     漏掉它会出现「双修自动、采补还得手点」这种不一致。
   * ============================================================ */
  const AUTO_MS = 1000;
  /* 状态 → 「再走一轮」要发的指令 */
  const AUTO_CMDS = { tune: '吐纳', dual: '双修', drain: '采补' };
  let autoTimer = null;

  function stopAuto() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
  }
  /** 每道指令跑完都问一句：还脱不开身吗？是就排下一轮 */
  function tickAuto() {
    stopAuto();
    const b = busyState();
    if (!b) return;
    const cmd = AUTO_CMDS[b.kind];
    if (!cmd) return;
    autoTimer = setTimeout(() => {
      autoTimer = null;
      /* 这一秒里状态可能已经没了（挨打散功 / 走完四轮 / 玩家点了别的按钮）→ 停 */
      const b2 = busyState();
      if (!b2 || b2.kind !== b.kind) return;
      doCmd(cmd, { fromButton: true });
    }, AUTO_MS);
  }

  async function doCmd(cmd, opts) {
    cmd = String(cmd || '').trim();
    if (!cmd) return;
    /* 记来源：默认当作「用户主动敲的」（老调用点全部保持原行为，不破坏任何既有逻辑） */
    const fromButton = !!(opts && opts.fromButton);
    if (S.busy) { toast('上一道指令还在执行…', 'warn', 1200); return; }

    /* 面板类指令：本地开面板，不打扰后端。
       新手教程标记由 panel() 内部统一上报，这里不再重复上报。
       ⚠️ 吐纳 / 双修 / 采补 当中点面板键，要先把这个状态收掉（见 busyState 注释）。 */
    const pn = panelForCmd(cmd);
    if (pn) {
      pushHistory(cmd);
      appendLog([{ type: 'cmd', text: '> ' + cmd }]);
      if (fromButton) blurCmdInput();
      if (busyState()) await exitBusyState();
      tickAuto();              /* 退出之后（或本来就没在）自动连发自然停 */
      return panel(pn);
    }

    /* 退出游戏：同样本地解决。放在这里而不是后端，是因为「回主菜单」是界面行为
       （要切屏、要刷「继续游戏」按钮），后端返回的文本做不到。 */
    if (isQuitCmd(cmd)) {
      pushHistory(cmd);
      appendLog([{ type: 'cmd', text: '> ' + cmd }]);
      if (fromButton) blurCmdInput();
      stopAuto();                     /* 退出游戏，勾着的定时器要清掉 */
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
      /* 还在吐纳/双修/采补里的话，排下一轮（别的指令一律不排） */
      tickAuto();
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

  /* ============================================================
   *  视图替换的**唯一入口**（主人亲报 bug 的正面修法）
   *
   *  老写法是 `S.view = d.view; renderAll(d.view)` —— 无条件覆盖。
   *  线上沙箱闲置会回收进程，重启后服务端 `world.player` 是 null；
   *  这时玩家随手点一个按钮，返回的就是「没有 player 的视图」：
   *  名字没了、气血 0/1、内力 0/1、金钱 undefined，外加一行「请先创建角色」。
   *  界面看着像进度全丢，其实只是**服务端断了一下**。
   *
   *  三条规矩，缺一条都会复发：
   *    ① 没有角色的视图，**绝不**覆盖有角色的视图
   *    ② 反过来要去把角色找回来：读本地兜底档（autosave_<设备>）
   *    ③ 真找不回来也不留一个空壳界面 —— 说明白 + 回主菜单，进度在存档里
   * ============================================================ */
  let _recovering = false;
  function applyView(v) {
    if (!v) return;
    if (!v.player && S.view && S.view.player) { recoverLostPlayer(); return; }
    S.view = v;
    renderAll(v);
  }

  async function recoverLostPlayer() {
    if (_recovering) return;
    _recovering = true;
    toast('跟江湖断了线，正在接回来……', 'warn', 2600);
    const key = autosaveId();
    let ok = false;
    try {
      /* ⚠️ `api.load` 内部会写 `S.view`。读档失败时服务端回的是**空视图**，
         不把旧 view 存回来的话，这一次「抢救」反而会再清一次界面。 */
      const keep = S.view;
      let d = null;
      try { d = await api.load(key); } catch (e) { d = null; }
      if (d && d.view && d.view.player) ok = true;
      else S.view = keep;
    } catch (e) { /* 统一在下面收尾 */ }
    _recovering = false;
    if (ok) {
      renderAll(S.view);
      appendLog([{ type: 'sys', text: '（接上了。江湖还在原处等你。）' }]);
      return;
    }
    appendLog([
      { type: 'warn', text: '（一时接不上你的角色 —— 进度都在存档里，没丢。）' },
      { type: 'hint', text: '（回主菜单，点「继续游戏」接着走。）' },
    ]);
    toast('接不上角色，请回主菜单点「继续游戏」', 'warn', 4200);
    show('start');
    try {
      const d2 = await api.saves();
      const has = ((d2 && d2.saves) || []).length > 0;
      const btn = $('btn-continue');
      if (btn) btn.style.display = has ? '' : 'none';
    } catch (e) { /* 主菜单自己还会再探一次存档 */ }
  }

  /* 统一处理一次动作的返回 */
  function afterAction(d) {
    if (!d) return;
    const v = d.view || (d.ok !== undefined ? d : null);

    /* 服务端说「角色不在」：**不落日志、不换视图**，直接去接人。
       照旧往下走的话，玩家看到的就是那句「请先创建角色」加一屏归零的属性。 */
    if (d.noPlayer) { recoverLostPlayer(); return; }

    /* 新的一批日志 */
    if (d.log && d.log.length) appendLog(d.log);
    else if (d.lines && d.lines.length) appendLog(d.lines);

    /* 视图（走统一入口，别自己赋值）
       ⚠️ 指令回包**故意不带整张地图**（它是 247 KB，占回包的 88%，
          正是主人报的「点按钮卡半秒」的元凶，见 engine.view(opts) 的注释）。
          地图只在打开「地图」面板时由 `/api/view` 单独取。
          但面板点格子时要读 `S.view.map`，万一这中间跑过一条指令（视图被换掉），
          地图就丢了 —— 所以这里**沿用上一次的地图**，别把它冲成 undefined。
          （地图数据是「已探索到哪」的快照，晚一代没有影响；重开面板会重新取。） */
    if (d.view) {
      if (!d.view.map && S.view && S.view.map) d.view.map = S.view.map;
      applyView(d.view);
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
      await api.save(key);
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
    /* 🔴 视图里**没有玩家**时，绝不许把顶栏渲染成空壳。
       原先写的是 `renderTopbar(v.player || {})` —— 一旦某个响应没带玩家
       （历史根因：`engine.reload` 静默吞掉读档异常 + `app.js` 无条件 `S.view = d.view`），
       顶栏立刻变成「名字空 / 气血 0/1 / 内力 0/1 / 金钱 undefined 文」，
       玩家看到的是「我的角色没了」（主人亲报）。
       正确做法：**已经有过玩家视图 → 保留旧顶栏**（只更新房间/场景等其它区块），
       真的从头到尾没玩家（未开局）才渲染空壳。 */
    if (v.player) renderTopbar(v.player);
    else if (!(S.view && S.view.player)) renderTopbar({});
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
    /* 主人 2026-10-11：「玩家没有装备界面吗？屏幕下方增加快捷键『装备』」。
       面板本来就有（`equipment`），缺的是**一个看得见的手**——它原来只藏在 ☰ 菜单里。 */
    { label: '装备', cmd: 'equipment' },
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
        if (Array.isArray(arr) && arr.length) {
          const mine = arr.filter(x => x && x.cmd);
          /* 老玩家的快捷键存在 localStorage 里，**默认表加了新按钮他们也看不到**。
             这里把「默认有、他这份没有」的补到末尾（不覆盖他自己改过的顺序与文字）——
             不然每次加按钮都只有新号玩家见过。 */
          const have = {};
          mine.forEach(x => { have[x.cmd] = true; });
          DEFAULT_QUICKBAR.forEach(x => {
            if (!have[x.cmd]) mine.push({ label: x.label, cmd: x.cmd });
          });
          return mine;
        }
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
      /* 🔴 主人 2026-10-11：「基本武学又没有『武技』，为什么会在战斗里显示
         『基本内功』『基本拳脚』？战斗中只显示**已激活武学**的武技。」
         并且「把战斗中的『全力一击』删掉」。
         ⇒ 三点口径：
           ① 删掉「全力一击」（`attack` 光杆指令，跟「普通攻击」重复）；
           ② 只收**已激活**（挂在槽位上 / 散手已激活）的武学；
           ③ 基础武学（isBasic，如基本内功 / 基本拳脚）**不摆**，它们本来就没有武技。
          ⚠️ 也不再拿「整门功夫」兜底当按钮 —— 那正是「基本内功」混进战斗栏的由来。 */
      items = [
        { label: '普通攻击', cmd: 'auto' },
        { label: '防御', cmd: 'defend' },
        { label: '逃跑', cmd: 'flee' }
      ];
      const actives = ((p.skills) || []).filter(s =>
        (s.equipped || s.standaloneActive) && !s.isBasic && (s.moves || []).length);
      let added = 0;
      for (const s of actives) {
        if (added >= 3) break;
        for (const mv of (s.moves || []).slice(0, 2)) {
          items.push({ label: mv.name, cmd: 'perform ' + mv.name });
        }
        added++;
      }
    } else {
      items = loadQuickbar();
      if (p.sectName) items.push({ label: '门派', cmd: 'sect' });
      /* 吐纳：练内力上限的唯一路子（主人要求放在屏幕下方快捷键里）。
         吐纳中再点它就是「接着熬一轮」，所以同一个键在两态下都说得通。 */
      items.push({ label: '吐纳', cmd: '吐纳' });
      /* 练武学（主人 2026-10-08）：点开面板，上面是已学会的各门武学，点一门就自动练。 */
      items.push({ label: '练武学', cmd: '练武学' });
      /* 拍卖行：常驻按钮。不在市集点了也只会得到一句「这儿没有拍卖行」，
         比「只有站在市集才冒出来」更好找 —— 玩家不必先记住哪几间房有。 */
      items.push({ label: '拍卖', cmd: 'auction' });
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
      { label: '行囊', panel: 'inventory' },
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
      /* 外观：默认暗色（主人 2026-10-11 要的「浏览器强制暗色」那种整页暗），
         但浅色那套没删 —— 想切回来随时切，不用再改代码。 */
      '<div class="set-row"><label>界面配色</label>' +
      '<button class="switch' + (themeOf(s) === 'dark' ? ' on' : '') + '" id="set-theme">' +
      (themeOf(s) === 'dark' ? '暗色' : '浅色') + '</button></div>' +
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
    /* 界面配色：暗 / 浅 两套（切换立刻生效，方便一边看一边挑） */
    const th = $('set-theme');
    if (th) th.onclick = () => {
      S.settings.theme = themeOf(S.settings) === 'dark' ? 'light' : 'dark';
      th.classList.toggle('on', themeOf(S.settings) === 'dark');
      th.textContent = themeOf(S.settings) === 'dark' ? '暗色' : '浅色';
      applySettings();
    };
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

  /** 当前配色（老存档的 settings 里没有 theme —— 一律当暗色，也就是新的默认） */
  function themeOf(s) { return (s && s.theme === 'light') ? 'light' : 'dark'; }

  function applySettings() {
    const s = S.settings;
    document.documentElement.style.fontSize = (16 * s.font / 100) + 'px';
    document.body.classList.toggle('narrow', !!s.narrow);
    /* 配色：`html.theme-light` 是浅色那一套；不加类就是暗色（默认） */
    document.documentElement.classList.toggle('theme-light', themeOf(s) === 'light');
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
        /* 🔴 存档时刻要用 **savedAt**，不是 `s.time`。
           `s.time` 是**游戏内的分钟数**（开局 481 分钟之类），拿去 new Date()
           就得到 1970-01-01 08:01 —— 主人亲报「所有存档时间一模一样」的根因。
           `savedAt` 才是 `world.serialize()` 里写的 Date.now()。
           顺手把游戏内天数也标出来：老存档没有 savedAt 时也不至于显示成 1970。 */
        const when = s.savedAt ? util.fmtTime(s.savedAt) : '时间不详';
        const dayNo = (typeof s.time === 'number' && s.time >= 0) ? Math.floor(s.time / 1440) + 1 : null;
        const bits = [];
        if (s.summary) bits.push(esc(s.summary));
        if (s.room) bits.push(esc(s.room));
        bits.push('存于 ' + when);
        if (dayNo) bits.push('游戏内第 ' + dayNo + ' 天');
        h += '<div class="save-item"><div class="sv-info">' +
          '<div class="sv-name">' + esc(s.name || s.id) + '</div>' +
          '<div class="sv-meta">' + bits.join(' · ') + '</div>' +
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
    /* 日志高亮菜单那一项的派发（认 `act`，否则退回 `cmd`）。
       挂出来是为了能在测试里**直接跑真实派发** —— 日志里的 `.hl` 按钮是
       `innerHTML` + `querySelectorAll` 造的，假 DOM 里拿不到 paintLog 绑的 onclick，
       不挂出来就只能测「后端给了什么」，测不到「前端认不认」。 */
    runInteractAct,
    /* 「接取任务」的任务详情弹窗（主人第四轮）—— 挂出来便于测试真派发 */
    openQuestPreview,
    bindInput, bindHotkeys, bindSidebar, bindGuide,
    showModCenter, showModMaker, showMarket,
    afterAction, autoSave, autosaveId,
    /* 测试出口：把纯渲染函数挂出来。
       为什么要它：这些函数是 IIFE 内部的闭包，外面拿不到，
       以前只能从真 DOM（modal-body.innerHTML）里读文本，
       写「读字段名对不对」的断言就别扭。
       全是纯函数（view → html 字符串），不碰 DOM 状态，不产生副作用。 */
    __html: { attrHtml, martialHtml, slavesHtml, npcProfileHtml, questPreviewHtml },
  };

})(window);
