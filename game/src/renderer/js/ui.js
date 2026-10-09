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

    /* 饱食 / 饮水（第三批：生存） */
    const food = p.food || 0, foodMax = p.maxFood || 100;
    const water = p.water || 0, waterMax = p.maxWater || 100;
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

    /* 出口：后端字段是 { dir, name(中文方位), to, toName } */
    const ex = room.exits || [];
    const box = $('exits');
    box.innerHTML = '';
    ex.forEach(e => {
      const b = document.createElement('button');
      b.className = 'exit-btn' + (e.locked ? ' locked' : '');
      b.innerHTML = esc(e.name || e.dir) + (e.toName ? '<i>' + esc(e.toName) + '</i>' : '');
      b.title = e.locked ? ('通往 ' + e.toName + '（尚未满足条件）') : ('前往 ' + e.toName);
      b.onclick = () => doCmd(e.dir);
      box.appendChild(b);
    });
    if (!ex.length) box.innerHTML = '<span class="no-exit">此处无路可走</span>';

    /* 此地可做的事（房间 actions）—— 用不同颜色标出来，点了直接执行 */
    renderRoomActions(v);
  }

  /* 房间交互物：视觉上与普通文字区分，点击弹出「做什么」或灰色提示 */
  function renderRoomActions(v) {
    let box = $('room-actions');
    if (!box) {
      /* DOM 里没有就临时插到出口下面（保证老 HTML 也能用） */
      const exits = $('exits');
      if (!exits || !exits.parentNode) return;
      box = document.createElement('div');
      box.id = 'room-actions';
      box.className = 'room-actions';
      exits.parentNode.insertBefore(box, exits.nextSibling);
    }
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
        doCmd(a.cmd);
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
      b.onclick = () => doCmd(b.getAttribute('data-dir'));
    });
    if (scroll !== false) el.scrollTop = el.scrollHeight;
  }

  /* 日志文本渲染：
     - l.hl = [{text, type, actions:[{label, cmd, hint}]}] → 名词高亮，点击弹菜单
     - l.exits = [dir,...] → 把「北/南…」方向文字变成可点按钮
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

    /* ② 出口方向：按方向名长度降序替换，避免「北」误伤「东北」 */
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
      doCmd(acts[0].cmd);
      return;
    }
    choices('对「' + name + '」做什么', acts.map(a => ({
      label: a.label || a.cmd,
      hint: a.hint || '',
      cmd: a.cmd,
    })), it => {
      if (it.cmd) doCmd(it.cmd);
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
    (v.items || []).forEach(it => {
      const d = document.createElement('button');
      d.className = 'scene-item item';
      d.innerHTML =
        '<span class="si-name">' + esc(it.name) + (it.count > 1 ? ' <i class="tag-count">×' + it.count + '</i>' : '') + '</span>' +
        '<span class="si-sub">' + esc(it.typeName || '') + '</span>';
      d.onclick = () => doCmd('get ' + it.name);
      itemBox.appendChild(d);
    });
    if (!(v.items || []).length) itemBox.innerHTML = '<div class="scene-empty">地上空无一物</div>';

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
      const cls = s.done ? 'done' : (g.current && g.current.id === s.id ? 'cur' : 'todo');
      h += '<div class="gp-step ' + cls + '">' +
        '<span class="gps-idx">' + (s.done ? '✓' : (i + 1)) + '</span>' +
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
    return [];
  }

  /* 点击 NPC 的小菜单 */
  function openNpcMenu(n) {
    /* 头部带一行社交摘要：好感档 / 身份 / 是否可请教·切磋·偷窃 */
    const bits = [];
    if (n.favorTier) bits.push('<b style="color:' + esc(n.favorColor || '#6a6a6a') + '">' + esc(n.favorTier) +
      '</b>（好感 ' + (n.favor || 0) + '）');
    if (n.tagName) bits.push(esc(n.tagName));
    if (n.gender) bits.push(n.gender === 'female' ? '女' : '男');
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
      { label: '送他东西 (give)', action: 'give' },
      { label: '给他银钱 (give_money)', action: 'givemoney' },
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
      { label: '动手厮杀 (kill)', action: 'kill', hint: '可能致死，谨慎' }
    ].filter(Boolean), it => {
      if (it.action === 'look') doCmd('look ' + n.name);
      else if (it.action === 'talk') doCmd('talk ' + n.name);
      else if (it.action === 'ask') { askNpc(n); }
      else if (it.action === 'guanxi') doCmd('guanxi ' + n.name);
      else if (it.action === 'favor') doCmd('favor ' + n.name);
      else if (it.action === 'give') giveNpc(n);
      else if (it.action === 'givemoney') giveMoneyNpc(n);
      else if (it.action === 'qingjiao') doCmd('qingjiao ' + n.name);
      else if (it.action === 'qiecuo') doCmd('qiecuo ' + n.name);
      else if (it.action === 'propose') proposeNpc(n);
      else if (it.action === 'bond') doCmd('结缘 ' + n.name);
      else if (it.action === 'concubine') doCmd('纳妾 ' + n.name);
      else if (it.action === 'swear') doCmd('结拜 ' + n.name);
      else if (it.action === 'sever') doCmd('断义 ' + n.name);
      else if (it.action === 'steal') stealNpc(n);
      else if (it.action === 'kill') doCmd('kill ' + n.name);
    }, head);
  }

  /* 提亲：选场地（酒楼铺张 / 家中简省） */
  function proposeNpc(n) {
    choices('向 ' + n.name + ' 提亲', [
      { label: '酒楼办席 (propose ' + n.name + ' 酒楼)', action: 'hall', hint: '花费 2000 文，宾客可至 24 人，好感加成足' },
      { label: '家中办席 (propose ' + n.name + ' 家中)', action: 'home', hint: '花费 300 文，宾客至多 10 人，好感加成减半' }
    ], it => {
      doCmd('提亲 ' + n.name + ' ' + (it.action === 'hall' ? '酒楼' : '家中'));
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
      b.onclick = () => { const id = b.getAttribute('data-item'); closeModal(); doCmd('give ' + id + ' to ' + n.name); };
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
      b.onclick = () => { const v = b.getAttribute('data-amt'); closeModal(); doCmd('give_money ' + v + ' to ' + n.name); };
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
      if (it.action === 'money') doCmd('steal money from ' + n.name);
      else doCmd('steal ' + n.name);
    });
  }

  async function askNpc(n) {
    /* 让玩家输入关键词 */
    modal('询问 ' + n.name,
      '<div class="modal-text">想问他/她什么？（可写：武学 / 门派 / 江湖 / 任务…）</div>' +
      '<input id="ask-input" class="modal-input" placeholder="关键词">' +
      (n.askTopics && n.askTopics.length
        ? '<div class="ask-topics">' + n.askTopics.map(t => '<button class="mini-tag" data-topic="' + esc(t) + '">' + esc(t) + '</button>').join('') + '</div>'
        : ''),
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');
    const inp = $('ask-input');
    if (inp) {
      inp.focus();
      inp.onkeydown = e => {
        if (e.key === 'Enter') { const v = inp.value.trim(); closeModal(); if (v) doCmd('ask ' + n.name + ' about ' + v); }
      };
    }
    document.querySelectorAll('.mini-tag').forEach(b => {
      b.onclick = () => { const v = b.getAttribute('data-topic'); closeModal(); doCmd('ask ' + n.name + ' about ' + v); };
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
        '<div class="lc-sub">' + (m.spouse.gender === 'female' ? '女' : '男') +
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
          '<i>' + (c.gender === 'female' ? '女' : '男') + (c.age ? ' · ' + c.age : '') + '</i></div>';
      });
      h += '</div>';
    }
    if (m && m.bonds && m.bonds.length) {
      h += '<div class="love-sub">结缘</div><div class="love-row-wrap">';
      m.bonds.forEach(c => {
        h += '<div class="love-chip bond">' + esc(c.name) +
          '<i>' + (c.gender === 'female' ? '女' : '男') + (c.age ? ' · ' + c.age : '') + '</i></div>';
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
            '<i>' + (x.gender === 'female' ? '女' : '男') + (x.age ? ' · ' + x.age : '') +
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
          '<i>' + (n.gender === 'female' ? '女' : '男') + (n.age ? ' · ' + n.age + ' 岁' : '') +
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
    h += '<div class="modal-text" style="margin-top:8px">指令：「买宅」「卖宅」「回家」「布置 &lt;描述&gt;」「置办 &lt;家具&gt;」</div>';
    return h;
  }

  function scoreHtml(v) {
    const p = v.player || {};
    let h = '<div class="panel-cols">';
    h += '<div class="pc-col">';
    h += kv('姓名', p.name);
    h += kv('称号', p.title || '—');
    h += kv('性别', p.gender === 'female' ? '女' : '男');
    h += kv('境界', p.realm || '不通武艺');
    h += kv('门派', p.sectName || '无门无派');
    h += kv('职位', p.rankName || '—');
    h += kv('年龄', p.age ? p.age + ' 岁' : '—');
    h += kv('战绩', (p.kills || 0) + ' 杀');
    h += '</div><div class="pc-col">';
    h += kv('气血', p.hp + ' / ' + p.maxHp);
    h += kv('内力', p.mp + ' / ' + p.maxMp);
    h += kv('饱食', p.food + ' / ' + p.maxFood);
    h += kv('饮水', p.water + ' / ' + p.maxWater);
    h += kv('潜能', p.potential);
    h += kv('银两', p.money + ' 文');
    h += kv('杀气', p.karma);
    h += kv('声望', p.reputation);
    h += '</div></div>';
    if (p.timeText) h += '<div class="panel-note">' + esc(p.timeText) + '</div>';
    return h;
  }

  function attrHtml(v) {
    const p = v.player || {};
    const a = p.attrs || {};
    const d = p.derived || {};
    let h = '<div class="attr-grid">';
    const attrNames = { 力量: '力量', 根骨: '根骨', 身法: '身法', 悟性: '悟性', 福缘: '福缘', 定力: '定力' };
    Object.keys(a).forEach(k => {
      h += '<div class="attr-card"><div class="ac-name">' + esc(attrNames[k] || k) + '</div>' +
        '<div class="ac-val">' + a[k] + '</div></div>';
    });
    h += '</div>';
    if (Object.keys(d).length) {
      h += '<div class="panel-sub">衍生属性</div><div class="panel-cols"><div class="pc-col">';
      const keys = Object.keys(d);
      keys.forEach((k, i) => {
        h += kv(k, d[k]);
        if (i === Math.ceil(keys.length / 2) - 1) h += '</div><div class="pc-col">';
      });
      h += '</div></div>';
    }
    return h;
  }

  function skillsHtml(v) {
    const list = v.skills || [];
    if (!list.length) return '<div class="modal-text">尚未习得任何武学。</div>';
    let h = '<table class="data-table"><thead><tr><th>武学</th><th>类型</th><th>等级</th><th>熟练度</th><th>威力</th></tr></thead><tbody>';
    list.forEach(s => {
      const pctStr = s.level >= s.maxLevel ? '圆满' : util.pct(s.exp, s.expNeed) + '%';
      h += '<tr><td class="td-name">' + esc(s.name) + (s.enabled ? ' <i class="tag-on">已启用</i>' : '') + '</td>' +
        '<td>' + esc(s.typeName || s.type) + '</td>' +
        '<td>' + s.level + ' / ' + s.maxLevel + '</td>' +
        '<td>' + pctStr + '</td>' +
        '<td>' + (s.power != null ? s.power : '—') + '</td></tr>';
    });
    h += '</tbody></table>';
    return h;
  }

  function questsHtml(v) {
    const list = questArr(v);
    const done = (v && !Array.isArray(v) && Array.isArray(v.done)) ? v.done : [];
    if (!list.length && !done.length) return '<div class="modal-text">暂无进行中的任务。</div>';
    let h = '';
    list.forEach(q => {
      h += '<div class="quest-card"><div class="q-name">' + esc(q.name) + '</div>';
      h += '<div class="q-desc">' + esc(q.desc || '') + '</div>';
      h += '<div class="q-stage">当前阶段：' + esc(q.stageDesc || '—') + '</div>';
      if (q.targets && q.targets.length) {
        h += '<div class="q-targets">';
        q.targets.forEach(t => {
          h += '<div class="q-target' + (t.done ? ' done' : '') + '">' +
            '<span>' + esc(t.desc || t.name || '') + '</span>' +
            '<span class="qt-num">' + (t.count != null ? ((t.cur != null ? t.cur : 0) + '/' + (t.count || 1)) : (t.done ? '✔' : '')) + '</span></div>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
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
  const MAP_CELL = 30;         // 每格边长（含走廊）
  const MAP_NODE = 26;         // 格子方块边长
  const MAP_PAD = 34;          // 画布留白
  const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
  const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };

  function mapHtml(v) {
    const m = v.map || {};
    const rooms = m.rooms || [];
    if (!rooms.length) return '<div class="modal-text">地图数据不可用。</div>';

    const b = m.bounds || { minX: 0, minY: 0, w: 1, h: 1 };
    const ex = m.explore || { visited: 0, total: rooms.length };
    const here = rooms.find(r => r.current);

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
    const pct = ex.total ? Math.round(ex.visited / ex.total * 100) : 0;
    h += '<div class="map-progress" title="已探索 ' + ex.visited + '/' + ex.total + '">' +
      '<span class="mp-bar"><i style="width:' + pct + '%"></i></span>' +
      '<span class="mp-txt">江湖探索 ' + ex.visited + '/' + ex.total + '（' + pct + '%）</span></div>';
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
    h += '<div class="map-canvas" style="width:' + W + 'px;height:' + H + 'px">';

    /* 1) 底：整张网格纸（让它看起来是一张连续地图） */
    h += '<div class="map-grid-bg" style="width:' + (b.w * MAP_CELL) + 'px;height:' + (b.h * MAP_CELL) + 'px;' +
      'left:' + MAP_PAD + 'px;top:' + MAP_PAD + 'px"></div>';

    /* 2) 区域底色块（铺满区域包围盒） */
    const boxes = m.regionBoxes || {};
    Object.keys(boxes).forEach(k => {
      const box = boxes[k];
      const left = (box.x - b.minX) * MAP_CELL + MAP_PAD;
      const top = (box.y - b.minY) * MAP_CELL + MAP_PAD;
      const bw = box.w * MAP_CELL;
      const bh = box.h * MAP_CELL;
      h += '<div class="map-region-box" style="left:' + left + 'px;top:' + top + 'px;' +
        'width:' + bw + 'px;height:' + bh + 'px;background:' + esc(box.color) + '14;border-color:' + esc(box.color) + '44">' +
        '<span class="mrb-label" style="color:' + esc(box.color) + '">' + esc(box.name) + '</span></div>';
    });

    /* 3) 走廊：一条 path 画完所有连通线（相邻房间连成一片） */
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
      const label = r.current ? '你' : (known ? shortName(r.name) : '');
      h += '<button class="' + cls + '" style="left:' + left + 'px;top:' + top + 'px;' +
        '--stripe:' + esc(stripe) + '"' +
        ' title="' + esc(r.name) + (r.region ? '（' + esc((reg && reg.name) || r.region) + '）' : '') +
        (r.dist >= 0 ? '　' + r.dist + ' 步' : '　未探索') + '"' +
        ' data-room="' + esc(r.id) + '"' +
        (r.near ? ' data-go="' + esc(r.id) + '"' : '') + '>' +
        '<span class="mn-name">' + esc(label) + '</span></button>';
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

  /* 房间名太长就砍一刀，格子里塞得下 */
  function shortName(n) {
    n = String(n || '');
    return n.length > 4 ? n.slice(0, 4) : n;
  }

  function helpHtml() {
    const groups = [
      ['行走', [
        'n / s / e / w / u / d　（中文：北 南 东 西 上 下）',
        'go <方向|房间名>　（中文：去 / 前往 / 走）',
        'look / l　查看四周（中文：看 / 观察 / 周围）',
        'look <人物|物品>　细看',
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
        'lian / train <武学>　练功（中文：练 / 练功 / 打坐）',
        'enable <武学>　启用',
        'perform / pf <招式>　出招',
        'forget <武学>　遗忘',
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
        if (c) doCmd(c);
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
          /* 优先用方向走（引擎的方向指令最可靠），否则用房间名 */
          doCmd('go ' + room.name);
        };
      });
    }
    /* 社交面板：点某人 → 看详情 */
    if (name === 'social') {
      document.querySelectorAll('#modal-body .social-row[data-npc]').forEach(b => {
        b.onclick = () => {
          const nm = b.getAttribute('data-npc');
          closeModal();
          doCmd('favor ' + nm);
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
          else doCmd('favor ' + nm);
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
    home: 'home', 家宅: 'home', 房产: 'home', 我的家: 'home', 我的家宅: 'home',
    help: 'help', '?': 'help', 帮助: 'help', 指令: 'help', 指令帮助: 'help',
  };

  /** 该指令是不是「打开某个面板」——是就返回面板名 */
  function panelForCmd(cmd) {
    const c = String(cmd || '').trim().toLowerCase();
    return PANEL_CMDS[c] || null;
  }

  let cmdHistory = [];
  let histIdx = -1;

  async function doCmd(cmd) {
    cmd = String(cmd || '').trim();
    if (!cmd) return;
    if (S.busy) { toast('上一道指令还在执行…', 'warn', 1200); return; }

    /* 面板类指令：本地开面板，不打扰后端 */
    const pn = panelForCmd(cmd);
    if (pn) {
      pushHistory(cmd);
      appendLog([{ type: 'cmd', text: '> ' + cmd }]);
      return panel(pn);
    }

    pushHistory(cmd);
    appendLog([{ type: 'cmd', text: '> ' + cmd }]);

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
      if (inp) inp.focus();
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
        if (it.cmd) doCmd(it.cmd);
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
        if (it.action === 'restart') doCmd('rebirth');
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
      (inCombat ? '' : '<button class="qb-btn qb-edit" id="qb-edit" title="编辑快捷键">⚙ 编辑</button>');
    box.querySelectorAll('.qb-btn[data-cmd]').forEach(b => {
      b.onclick = () => doCmd(b.getAttribute('data-cmd'));
    });
    const edit = $('qb-edit');
    if (edit) edit.onclick = openQuickbarEditor;
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

      /* 数字键 1-9 = 方向/快捷 */
      if (e.key >= '1' && e.key <= '9') {
        const idx = +e.key - 1;
        const btns = document.querySelectorAll('#exits .exit-btn');
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

  function bindSidebar() {
    document.querySelectorAll('#sidebar .sb-btn').forEach(b => {
      b.onclick = () => {
        const p = b.getAttribute('data-panel');
        const a = b.getAttribute('data-act');
        if (p) return panel(p);
        if (!a) return;
        if (a === 'save') return openSaves('save');
        if (a === 'loadlist') return openSaves('load');
        if (a === 'modcenter') return showModCenter();
        if (a === 'modmaker') return showModMaker();
        if (a === 'settings') return openSettings();
        if (a === 'backmenu') {
          confirmBox('返回主菜单', '返回主菜单不会丢失进度（请先确认已保存）。', '返 回').then(ok => {
            if (ok) show('start');
          });
        }
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
   *  导出
   * ============================================================ */
  global.WXUI = {
    show, toast, modal, closeModal, bindModal, choices, closeChoices, confirmBox,
    renderAll, renderTopbar, renderRoom, renderRoomActions, renderScene, renderCombat, renderQuickbar,
    appendLog, paintLog, clearLog, doCmd, panel, panelForCmd, openSaves, openSettings, applySettings,
    bindInput, bindHotkeys, bindSidebar, bindGuide,
    showModCenter, showModMaker, showMarket,
    afterAction, autoSave, autosaveId
  };

})(window);
