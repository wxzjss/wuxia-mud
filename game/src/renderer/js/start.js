/* ============================================================
 *  武侠行 · 启动流程 + Mod 管理器 + Mod 市场 + 文档页
 * ============================================================ */
(function (global) {
  'use strict';

  const { S, api, util, bus } = global.WX;
  const U = global.WXUI;
  const $ = id => document.getElementById(id);
  const esc = util.esc;

  /* ============================================================
   *  启动
   * ============================================================ */
  async function boot() {
    U.bindInput();
    U.bindHotkeys();
    U.bindSidebar();
    if (U.bindModal) U.bindModal();
    if (U.bindGuide) U.bindGuide();
    U.applySettings();
    bindStartScreen();
    bindGlobalButtons();

    try {
      const info = await api.boot();
      const st = info.stats || {};
      const parts = [];
      if (st.rooms) parts.push(st.rooms + ' 处场景');
      if (st.npcs) parts.push(st.npcs + ' 位人物');
      if (st.skills) parts.push(st.skills + ' 门武学');
      if (st.items) parts.push(st.items + ' 件物品');
      if (st.quests) parts.push(st.quests + ' 条任务');
      if (st.mods) parts.push(st.mods + ' 个 Mod');
      $('start-stats').textContent = parts.join(' · ');
      if (info.warnings && info.warnings.length) {
        setTimeout(() => U.toast('Mod 加载提示：' + info.warnings.join('；'), 'warn', 5000), 900);
      }
      /* 本地有存档就亮出「继续游戏」 */
      await probeSaves();
      /* 云服务：初始化 + 处理微信回调 + 刷新登录状态 */
      await initCloud();
    } catch (e) {
      $('start-stats').innerHTML = '<span style="color:#9c2b25">' + esc('本地服务未启动：' + e.message) + '</span>';
      console.error(e);
    }
  }

  /* ============================================================
   *  云服务：登录 + 云存档（极简登录：手机验证码 / 微信）
   * ============================================================ */
  let _cloudUser = null;

  async function initCloud() {
    const C = global.WXCLOUD;
    if (!C) return;
    try {
      await C.init();
      if (!C.available()) return;
      /* 微信回调：每次启动无条件处理一次 */
      try { await C.auth.handleWechatCallback(); } catch (e) { }
      /* 刷新登录状态 */
      _cloudUser = await C.auth.user();
      paintLoginButton();
      /* 登录后：把云存档拉到本地，换设备也能接着玩 */
      if (_cloudUser) await pullCloudSaves();
    } catch (e) { }
  }

  /* 登录后拉云存档 → 本地落盘（幂等覆盖），刷新「继续游戏」 */
  async function pullCloudSaves() {
    const C = global.WXCLOUD;
    try {
      const list = await C.saves.list();
      if (!list || !list.length) return;
      for (const s of list) {
        if (!s.save_key || !s.data) continue;
        try { await api.saveWrite(s.save_key, s.data); } catch (e) { }
      }
      await probeSaves();
    } catch (e) { }
  }

  function paintLoginButton() {
    const btn = $('btn-login');
    if (!btn) return;
    if (_cloudUser) {
      const name = _cloudUser.email || _cloudUser.phone || _cloudUser.nickname || '已登录';
      btn.textContent = '云存档 · ' + name;
      btn.classList.add('logged');
    } else {
      btn.textContent = '登 录 · 云 存 档';
      btn.classList.remove('logged');
    }
  }

  function openLogin() {
    const C = global.WXCLOUD;
    if (!C) { U.toast('云服务未加载', 'warn'); return; }
    C.init().then(ok => {
      if (!ok || !C.available()) { U.toast('云端不可用（非 http 环境或 SDK 加载失败）', 'warn', 3600); return; }
      paintLoginBody();
    });
  }

  async function paintLoginBody() {
    const C = global.WXCLOUD;
    _cloudUser = await C.auth.user();

    let body = '';
    if (_cloudUser) {
      const name = _cloudUser.email || _cloudUser.phone || _cloudUser.nickname || '侠客';
      body = '<div class="modal-text" style="margin-bottom:12px">当前已登录：<b>' + esc(name) + '</b><br>' +
        '<span class="dim">存档会自动同步到云端，换设备登录同一账号即可接着玩。</span></div>';
      U.modal('云 存 档', body,
        '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>' +
        '<button class="btn-ink danger" id="lg-out">退 出 登 录</button>');
      $('lg-out').onclick = async () => {
        await C.auth.signOut();
        _cloudUser = null;
        paintLoginButton();
        U.toast('已退出登录', 'ok');
        paintLoginBody();
      };
      return;
    }

    body =
      '<div class="modal-text" style="margin-bottom:10px">登录后存档自动上云，<b>换设备也能接着玩</b>。不登录也能正常玩（存档存本机）。</div>' +
      '<div class="login-sec">' +
      '<div class="ls-title">手机号验证码登录</div>' +
      '<div class="login-row"><input id="lg-phone" class="modal-input" placeholder="输入 11 位手机号" maxlength="11">' +
      '<button class="btn-mini" id="lg-send">获取验证码</button></div>' +
      '<div class="login-row"><input id="lg-code" class="modal-input" placeholder="输入验证码" maxlength="6"></div>' +
      '<div class="login-row"><button class="btn-ink primary" id="lg-go">登 录</button></div>' +
      '</div>' +
      '<div class="login-sec">' +
      '<div class="ls-title">微信登录</div>' +
      '<button class="btn-ink" id="lg-wechat">微信扫码登录</button>' +
      '</div>';

    U.modal('登 录 · 云 存 档', body,
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>');

    let pending = null;
    $('lg-send').onclick = async () => {
      const phone = ($('lg-phone').value || '').trim();
      if (!/^1\d{10}$/.test(phone)) { U.toast('请输入正确的 11 位手机号', 'warn'); return; }
      const btn = $('lg-send');
      btn.disabled = true;
      const r = await C.auth.sendPhoneCode(phone);
      btn.disabled = false;
      if (r.error) { U.toast('发送失败：' + (r.error.message || '请重试'), 'error', 4000); return; }
      pending = r.data;
      U.toast('验证码已发送，请查收短信', 'ok', 3000);
    };
    $('lg-go').onclick = async () => {
      const code = ($('lg-code').value || '').trim();
      if (!pending) { U.toast('请先获取验证码', 'warn'); return; }
      if (!code) { U.toast('请输入验证码', 'warn'); return; }
      const r = await C.auth.verifyPhone(pending, code);
      if (r.error) { U.toast('登录失败：' + (r.error.message || '验证码错误'), 'error', 4000); return; }
      _cloudUser = r.data && r.data.user;
      paintLoginButton();
      U.toast('登录成功！存档将自动上云', 'ok', 3000);
      U.closeModal();
    };
    $('lg-wechat').onclick = async () => {
      const r = await C.auth.wechatUrl();
      if (r.error) { U.toast('微信登录：' + (r.error.message || '未开启'), 'error', 4000); return; }
      if (r.data && r.data.url) location.assign(r.data.url);
    };
  }

  /* ============================================================
   *  继续游戏：本地有存档时显示
   * ============================================================ */
  let _hasSave = false;

  async function probeSaves() {
    let local = [];
    try { const d = await api.saves(); local = d.saves || []; } catch (e) { }
    _hasSave = local.length > 0;
    const btn = $('btn-continue');
    if (btn) btn.style.display = _hasSave ? '' : 'none';
    /* 有存档时，「创建角色」降为次要按钮，避免误点丢掉进度 */
    const nb = $('btn-newgame');
    if (nb) {
      nb.classList.toggle('primary', !_hasSave);
    }
    return _hasSave;
  }

  /** 继续游戏：打开存档列表选一个读 */
  async function continueGame() {
    let local = [];
    try { const d = await api.saves(); local = d.saves || []; } catch (e) { }
    if (!local.length) { U.toast('还没有存档，先创建角色吧', 'warn'); return; }
    U.openSaves('load');
  }

  /* ============================================================
   *  主菜单按钮
   * ============================================================ */
  function bindStartScreen() {
    document.querySelectorAll('#screen-start [data-act]').forEach(b => {
      const a = b.getAttribute('data-act');
      if (a === 'newgame') b.onclick = () => openCreate();
      else if (a === 'continue') b.onclick = () => continueGame();
      else if (a === 'loadgame') b.onclick = () => U.openSaves('load');
      else if (a === 'login') b.onclick = () => openLogin();
      else if (a === 'modcenter') b.onclick = () => U.showModCenter();
      else if (a === 'modmaker') b.onclick = () => U.showModMaker();
      else if (a === 'guidedoc') b.onclick = () => openDoc();
    });
  }

  /* 所有屏幕的「返回」按钮 */
  function bindGlobalButtons() {
    document.querySelectorAll('.screen [data-act="back"]').forEach(b => {
      b.onclick = () => {
        if (S.screen === 'game') return;
        U.show(S.view && S.view.player ? 'game' : 'start');
      };
    });

    /* 制作器 / 管理器的返回 */
    const mmBack = document.querySelector('#screen-modmaker .mm-header [data-act="back"]');
    if (mmBack) mmBack.onclick = () => U.show(S.view && S.view.player ? 'game' : 'start');
    const mcBack = document.querySelector('#screen-modcenter .mm-header [data-act="back"]');
    if (mcBack) mcBack.onclick = () => U.show(S.view && S.view.player ? 'game' : 'start');
    const mkBack = document.querySelector('#screen-market .mm-header [data-act="back"]');
    if (mkBack) mkBack.onclick = () => U.show(S.view && S.view.player ? 'game' : 'start');
    const docBack = document.querySelector('#screen-doc .mm-header [data-act="back"]');
    if (docBack) docBack.onclick = () => U.show(S.view && S.view.player ? 'game' : 'start');
  }

  /* ============================================================
   *  创建角色
   * ============================================================ */
  let BIRTHS = [];
  let PERKS = [];
  let ATTRS = [];
  const ALLOC = { bonus: 10, base: {} };
  let curGender = 'male';
  let curBirth = '';

  async function openCreate() {
    U.show('create');
    try {
      const [births, meta] = await Promise.all([
        api.births(),
        api.editorMeta()
      ]);
      BIRTHS = births || [];
      ATTRS = (meta && meta.attrs) || [];
      PERKS = await loadPerks();
    } catch (e) {
      U.toast('加载失败：' + e.message, 'error');
      return;
    }
    renderBirths();
    renderPerks();
    initAttrs();
    renderAttrs();
    bindCreateActions();
  }

  async function loadPerks() {
    /* 天赋用 mods 接口里的 traits 或 boot 数据；这里直接问引擎元数据 */
    try {
      const d = await api.jfetch('/api/editor/meta');
      const m = d.meta || d;
      if (m.traits && m.traits.length) return m.traits;
    } catch (e) { }
    /* 兜底：从引擎 boot 里取 */
    try {
      const d = await api.jfetch('/api/births');
      if (d.traits) return d.traits;
    } catch (e) { }
    return [];
  }

  function renderBirths() {
    const box = $('c-births');
    box.innerHTML = BIRTHS.map(b =>
      '<button class="birth-card" data-birth="' + esc(b.id) + '">' +
      '<div class="bc-name">' + esc(b.name) + '</div>' +
      '<div class="bc-desc">' + esc(b.desc || '') + '</div>' +
      '<div class="bc-bonus">' + (b.attr ? Object.keys(b.attr).map(k => k + '+' + b.attr[k]).join('  ') : '') +
      (b.items ? '　赠：' + b.items.slice(0, 3).join('、') : '') + '</div></button>').join('');
    box.querySelectorAll('.birth-card').forEach(c => {
      c.onclick = () => {
        curBirth = c.getAttribute('data-birth');
        box.querySelectorAll('.birth-card').forEach(x => x.classList.remove('active'));
        c.classList.add('active');
      };
    });
    if (BIRTHS.length) {
      curBirth = BIRTHS[0].id;
      box.querySelector('.birth-card').classList.add('active');
    }
  }

  function renderPerks() {
    const box = $('c-perks');
    if (!PERKS.length) { box.innerHTML = '<div class="dim">（本版本暂无天赋数据）</div>'; return; }
    box.innerHTML = PERKS.map(p => {
      const eff = fmtTraitEffects(p);
      return '<button class="perk-card" data-perk="' + esc(p.id || p.name) + '">' +
        '<div class="pc-name">' + esc(p.name) + '</div>' +
        '<div class="pc-desc">' + esc(p.desc || '') + '</div>' +
        (eff.length ? '<div class="pc-eff">' + eff.map(esc).join('　') + '</div>' : '') +
        '</button>';
    }).join('');
    box.querySelectorAll('.perk-card').forEach(c => {
      c.onclick = () => {
        const on = c.classList.toggle('active');
        const sel = box.querySelectorAll('.perk-card.active');
        if (sel.length > 2) { c.classList.remove('active'); U.toast('最多选 2 个天赋', 'warn', 1500); }
      };
    });
  }

  /* 把天赋的 attr（{悟性:5}）和 effects（stat +N）转成「悟性+5 气血+60」这种可读文字 */
  function fmtTraitEffects(p) {
    const bits = [];
    if (p.attr) {
      Object.keys(p.attr).forEach(k => {
        const v = p.attr[k];
        bits.push(k + (v > 0 ? '+' + v : v));
      });
    }
    const STAT_CN = { atk: '攻击', def: '防御', dodge: '闪避', parry: '招架', speed: '身法', maxHp: '气血上限', maxMp: '内力上限', critRate: '暴击率', lifesteal: '吸血', reflect: '反伤', armorPen: '破防' };
    (p.effects || []).forEach(e => {
      if (e && e.type === 'stat' && e.key) {
        const v = e.value || 0;
        bits.push((STAT_CN[e.key] || e.key) + (v > 0 ? '+' + v : v));
      }
    });
    return bits;
  }

  function initAttrs() {
    ALLOC.base = {};
    ATTRS.forEach(a => { ALLOC.base[a] = 10; });
    ALLOC.bonus = 10;
  }

  function renderAttrs() {
    const box = $('c-attrs');
    box.innerHTML = ATTRS.map(a =>
      '<div class="alloc-row"><span class="ar-name">' + esc(a) + '</span>' +
      '<button class="ar-btn" data-dd="' + esc(a) + '">−</button>' +
      '<span class="ar-val" id="ar-' + esc(a) + '">' + ALLOC.base[a] + '</span>' +
      '<button class="ar-btn" data-ii="' + esc(a) + '">＋</button>' +
      '<input class="ar-range" type="range" min="10" max="30" value="' + ALLOC.base[a] + '" data-rr="' + esc(a) + '">' +
      '</div>').join('');
    $('c-points').textContent = ALLOC.bonus;

    box.querySelectorAll('[data-ii]').forEach(b => b.onclick = () => adjust(b.getAttribute('data-ii'), 1));
    box.querySelectorAll('[data-dd]').forEach(b => b.onclick = () => adjust(b.getAttribute('data-dd'), -1));
    box.querySelectorAll('[data-rr]').forEach(r => {
      r.oninput = () => {
        const a = r.getAttribute('data-rr');
        const want = +r.value;
        const cur = ALLOC.base[a];
        const diff = want - cur;
        if (diff > 0 && diff > ALLOC.bonus) { r.value = cur; return; }
        ALLOC.base[a] = want;
        ALLOC.bonus -= diff;
        syncAttrs();
      };
    });
  }

  function adjust(a, d) {
    if (d > 0) {
      if (ALLOC.bonus <= 0) { U.toast('没有剩余点数了', 'warn', 1200); return; }
      if (ALLOC.base[a] >= 30) { U.toast('属性上限 30', 'warn', 1200); return; }
      ALLOC.base[a]++; ALLOC.bonus--;
    } else {
      if (ALLOC.base[a] <= 10) return;
      ALLOC.base[a]--; ALLOC.bonus++;
    }
    syncAttrs();
  }

  function syncAttrs() {
    ATTRS.forEach(a => {
      const el = $('ar-' + a);
      if (el) el.textContent = ALLOC.base[a];
    });
    $('c-points').textContent = ALLOC.bonus;
    document.querySelectorAll('[data-rr]').forEach(r => {
      r.value = ALLOC.base[r.getAttribute('data-rr')];
    });
  }

  function bindCreateActions() {
    /* 性别 */
    document.querySelectorAll('#c-gender .seg-btn').forEach(b => {
      b.onclick = () => {
        curGender = b.getAttribute('data-v');
        document.querySelectorAll('#c-gender .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      };
    });

    /* 随机分配 */
    $('c-roll').onclick = () => {
      let left = 10;
      ATTRS.forEach(a => ALLOC.base[a] = 10);
      while (left > 0) {
        const a = ATTRS[Math.floor(Math.random() * ATTRS.length)];
        if (ALLOC.base[a] < 30) { ALLOC.base[a]++; left--; }
      }
      ALLOC.bonus = 0;
      syncAttrs();
    };

    /* 重置 */
    $('c-reset').onclick = () => { initAttrs(); syncAttrs(); };

    /* 返回 */
    const back = document.querySelector('#screen-create [data-act="back"]');
    if (back) back.onclick = () => U.show('start');

    /* 开始 */
    $('c-start').onclick = startGame;
  }

  async function startGame() {
    const name = ($('c-name').value || '').trim();
    if (!name) { U.toast('请先起个名字', 'warn'); $('c-name').focus(); return; }
    if (name.length > 12) { U.toast('名字最多 12 个字', 'warn'); return; }

    const perks = Array.from(document.querySelectorAll('#c-perks .perk-card.active'))
      .map(c => c.getAttribute('data-perk'));

    const extra = {};
    ATTRS.forEach(a => { extra[a] = ALLOC.base[a] - 10; });

    try {
      const d = await api.newGame({
        name,
        gender: curGender,
        birth: curBirth,
        perks,
        attrBonus: extra
      });
      U.clearLog();
      U.appendLog([{ type: 'title', text: '武 侠 行' }, { type: 'subtitle', text: '江湖路远，就此启程。' }, { type: 'plain', text: '' }]);
      if (d.log) U.appendLog(d.log);
      U.show('game');
      U.renderAll(S.view);
      /* 创建完角色立即存档（一步一存档的第一份） */
      if (U.autoSave) U.autoSave();
      setTimeout(() => $('cmd-input').focus(), 200);
      bus.emit('gamestart');
    } catch (e) {
      U.toast('创建失败：' + e.message, 'error', 4000);
    }
  }

  /* ============================================================
   *  MOD 管理器
   * ============================================================ */
  const MC = { list: [], sel: null };

  function mcOpen() {
    bindMcButtons();
    refreshMods();
  }

  function bindMcButtons() {
    const pairs = [
      ['mc-install', installFromZip],
      ['mc-install-folder', installFromFolder],
      ['mc-local-dir', loadFromLocalDir],
      ['mc-open-folder', openModFolder],
      ['mc-open-web', openModWeb],
      ['mc-browse', () => U.showMarket()],
      ['mc-reload', reloadAll]
    ];
    pairs.forEach(([id, fn]) => {
      const b = $(id);
      if (b && !b.__b) { b.__b = true; b.onclick = fn; }
    });
  }

  async function refreshMods() {
    const box = $('mc-list');
    if (!box) return;
    try {
      const d = await api.mods();
      MC.list = d.mods || [];
    } catch (e) {
      box.innerHTML = '<div class="mc-empty">加载失败：' + esc(e.message) + '</div>';
      return;
    }

    if (!MC.list.length) {
      box.innerHTML = '<div class="mc-empty">还没有安装任何 Mod。<br>点上方「从文件安装」，或去「在线 Mod 市场」逛逛。</div>';
      return;
    }

    box.innerHTML = MC.list.map((m, i) =>
      '<div class="mc-item' + (m.enabled ? ' on' : '') + (MC.sel === m.id ? ' sel' : '') + '" data-id="' + esc(m.id) + '">' +
      '<div class="mci-order">' + (i + 1) + '</div>' +
      '<div class="mci-main">' +
      '<div class="mci-name">' + esc(m.name || m.id) + (m.version ? ' <i>v' + esc(m.version) + '</i>' : '') +
      (m.local ? ' <span class="mci-local">本地</span>' : '') + '</div>' +
      '<div class="mci-meta">' + esc(m.category || '综合') + ' · ' + esc(m.author || '佚名') + '</div>' +
      '</div>' +
      '<div class="mci-ops">' +
      '<button class="sw' + (m.enabled ? ' on' : '') + '" data-sw="' + esc(m.id) + '" title="启用/禁用">' + (m.enabled ? '开' : '关') + '</button>' +
      '<button class="mini-btn" data-up="' + esc(m.id) + '" title="上移">↑</button>' +
      '<button class="mini-btn" data-down="' + esc(m.id) + '" title="下移">↓</button>' +
      '</div></div>').join('');

    box.querySelectorAll('.mc-item').forEach(el => {
      el.onclick = e => {
        if (e.target.closest('button')) return;
        MC.sel = el.getAttribute('data-id');
        refreshMods();
        showModDetail(MC.sel);
      };
    });
    box.querySelectorAll('[data-sw]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const id = b.getAttribute('data-sw');
      const m = MC.list.find(x => x.id === id);
      try {
        await api.modToggle(id, !m.enabled);
        await refreshMods();
        U.toast((!m.enabled ? '已启用 ' : '已禁用 ') + (m.name || id), 'ok', 1600);
      } catch (err) { U.toast(err.message, 'error'); }
    });
    box.querySelectorAll('[data-up]').forEach(b => b.onclick = e => { e.stopPropagation(); mcMove(b.getAttribute('data-up'), -1); });
    box.querySelectorAll('[data-down]').forEach(b => b.onclick = e => { e.stopPropagation(); mcMove(b.getAttribute('data-down'), 1); });

    refreshProblems();
  }

  async function mcMove(id, dir) {
    const order = MC.list.map(m => m.id);
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    try {
      await api.modOrder(order);
      await refreshMods();
    } catch (e) { U.toast(e.message, 'error'); }
  }

  async function refreshProblems() {
    const box = $('mc-problems');
    if (!box) return;
    try {
      const d = await api.modProblems();
      const p = d.problems || d;
      const items = [];
      (p.errors || []).forEach(x => items.push({ t: 'err', m: x }));
      (p.warnings || []).forEach(x => items.push({ t: 'warn', m: x }));
      if (!items.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<div class="mcp-title">冲突 / 问题</div>' + items.map(x =>
        '<div class="mcp-line ' + x.t + '">' + (x.t === 'err' ? '✘ ' : '⚠ ') + esc(x.m) + '</div>').join('');
      box.classList.add('show');
    } catch (e) { box.classList.remove('show'); }
  }

  async function showModDetail(id) {
    const box = $('mc-detail');
    const m = MC.list.find(x => x.id === id);
    if (!m) { box.innerHTML = '<div class="mc-empty">← 选择一个 Mod 查看详情</div>'; return; }

    let files = [];
    try {
      const d = await api.modRead(id, '');
      files = d.files || [];
    } catch (e) { }

    const c = m.counts || {};
    box.innerHTML =
      '<div class="mcd-head"><div class="mcd-name">' + esc(m.name || m.id) + '</div>' +
      '<div class="mcd-id">' + esc(m.id) + '</div></div>' +
      '<div class="mcd-tags">' +
      '<span class="mini-tag static">' + esc(m.category || '综合') + '</span>' +
      (m.version ? '<span class="mini-tag static">v' + esc(m.version) + '</span>' : '') +
      (m.author ? '<span class="mini-tag static">' + esc(m.author) + '</span>' : '') +
      (m.enabled ? '<span class="mini-tag on">已启用</span>' : '<span class="mini-tag off">未启用</span>') +
      (m.local ? '<span class="mini-tag local">本地私有</span>' : '') +
      '</div>' +
      '<div class="mcd-desc">' + esc(m.desc || '（无简介）') + '</div>' +
      '<div class="mcd-counts">' +
      countChip('房间', c.rooms) + countChip('人物', c.npcs) + countChip('物品', c.items) +
      countChip('武学', c.skills) + countChip('门派', c.sects) + countChip('任务', c.quests) +
      countChip('对话', c.dialogues) + countChip('规则', c.rules) +
      '</div>' +
      (m.requires && m.requires.length ? '<div class="mcd-req">依赖：' + m.requires.map(esc).join('、') + '</div>' : '') +
      (files.length ? '<div class="mcd-files"><div class="mcd-sub">文件</div>' +
        files.map(f => '<div class="mcd-file" data-file="' + esc(f) + '">📄 ' + esc(f) + '</div>').join('') + '</div>' : '') +
      '<div class="mcd-ops">' +
      (m.local
        ? '<span class="mcd-localtip">本地私有 Mod 不能导出 / 上传</span>'
        : '<button class="btn-ink small" data-op="export">导出 ZIP</button>') +
      '<button class="btn-ink small" data-op="editjson">查看 mod.json</button>' +
      '<button class="btn-ink small" data-op="loadmaker">载入制作器</button>' +
      '<button class="btn-ink small danger" data-op="remove">删除</button>' +
      '</div>';

    box.querySelectorAll('[data-op]').forEach(b => b.onclick = () => mcDetailOp(b.getAttribute('data-op'), id));
    box.querySelectorAll('[data-file]').forEach(b => b.onclick = () => mcViewFile(id, b.getAttribute('data-file')));
  }

  function countChip(label, n) {
    if (!n) return '';
    return '<span class="mcd-chip">' + esc(label) + ' ' + n + '</span>';
  }

  async function mcDetailOp(op, id) {
    const m = MC.list.find(x => x.id === id) || {};
    if (op === 'export') {
      try {
        const d = await api.modExport(id);
        if (d.base64) util.downloadB64((id || 'mod') + '.zip', d.base64, 'application/zip');
        else if (d.path) U.toast('已导出到：' + d.path, 'ok', 4000);
      } catch (e) { U.toast(e.message, 'error'); }
    } else if (op === 'editjson') {
      mcViewFile(id, 'mod.json');
    } else if (op === 'loadmaker') {
      try {
        const d = await api.modRead(id, 'mod.json');
        const obj = JSON.parse(d.content || '{}');
        S.spec = global.WXMM.jsonToSpec(obj);
        global.WXMM.mark();
        U.showModMaker();
        U.toast('已载入制作器', 'ok');
      } catch (e) { U.toast('载入失败：' + e.message, 'error'); }
    } else if (op === 'remove') {
      const ok = await U.confirmBox('删除 Mod', '确定删除「' + (m.name || id) + '」吗？文件会被移入回收目录。', '删 除');
      if (!ok) return;
      try {
        await api.modRemove(id);
        MC.sel = null;
        await refreshMods();
        $('mc-detail').innerHTML = '<div class="mc-empty">← 选择一个 Mod 查看详情</div>';
        U.toast('已删除', 'ok');
      } catch (e) { U.toast(e.message, 'error'); }
    }
  }

  async function mcViewFile(id, file) {
    try {
      const d = await api.modRead(id, file);
      const content = d.content || '';
      let html;
      if (/\.json$/i.test(file)) {
        let obj;
        try { obj = JSON.parse(content); } catch (e) { obj = null; }
        html = obj
          ? '<textarea class="mm-json" id="mcf-editor">' + esc(JSON.stringify(obj, null, 2)) + '</textarea>'
          : '<textarea class="mm-json" id="mcf-editor">' + esc(content) + '</textarea>';
      } else {
        html = '<pre class="mc-file-pre">' + esc(content.slice(0, 20000)) + '</pre>';
      }
      const editable = /\.(json|js|txt|md|css|html)$/i.test(file);
      U.modal(file, html,
        editable ? '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>' +
          '<button class="btn-ink primary" id="mcf-save">保 存</button>'
          : '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>');
      const sv = $('mcf-save');
      if (sv) sv.onclick = async () => {
        const v = $('mcf-editor').value;
        if (/\.json$/i.test(file)) {
          try { JSON.parse(v); } catch (e) { U.toast('JSON 格式错误：' + e.message, 'error', 4000); return; }
        }
        try {
          await api.modWrite(id, file, v);
          U.toast('已保存', 'ok');
          U.closeModal();
        } catch (e) { U.toast(e.message, 'error'); }
      };
    } catch (e) { U.toast(e.message, 'error'); }
  }

  /* 从 ZIP 安装 */
  async function installFromZip() {
    try {
      const { text, name, file } = await util.readTextFile('.zip');
      if (!/\.zip$/i.test(name)) { U.toast('请选择 .zip 文件', 'warn'); return; }
      /* 读成 base64 交给后端 */
      const b64 = await fileToB64(file);
      const d = await api.modInstall({ kind: 'zip', name, base64: b64 });
      await refreshMods();
      U.toast('安装成功：' + ((d.mod && d.mod.name) || name), 'ok');
    } catch (e) {
      if (e && e.message === '未选择文件') return;
      U.toast('安装失败：' + e.message, 'error', 4000);
    }
  }

  function installFromFolder() {
    U.modal('从文件夹安装',
      '<div class="modal-text">请选择一个 Mod 文件夹（里面应有 mod.json）。<br><br>' +
      '<span class="dim">浏览器安全限制下无法直接读整个文件夹，将逐个读取文件夹中所有文件。</span></div>' +
      '<input type="file" id="folder-input" webkitdirectory directory multiple style="margin-top:12px">',
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>' +
      '<button class="btn-ink primary" id="folder-go">读 取</button>');
    $('folder-go').onclick = async () => {
      const inp = $('folder-input');
      const files = Array.from(inp.files || []);
      if (!files.length) { U.toast('未选择文件夹', 'warn'); return; }
      const out = [];
      for (const f of files) {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split('/');
        parts.shift(); /* 去掉根目录名 */
        out.push({ path: parts.join('/'), base64: await fileToB64(f) });
      }
      U.closeModal();
      try {
        const d = await api.modInstall({ kind: 'folder', files: out, name: (files[0].webkitRelativePath || '').split('/')[0] });
        await refreshMods();
        U.toast('安装成功：' + ((d.mod && d.mod.name) || '') , 'ok');
      } catch (e) { U.toast('安装失败：' + e.message, 'error', 4000); }
    };
  }

  /* ------------------------------------------------------------------ *
   * 本地 Mod 文件夹（浏览器 File System Access 授权）
   *
   * 跟「从文件夹安装」的区别：
   *   · 「从文件夹安装」要每次手动选文件夹（<input webkitdirectory>），装成普通 Mod
   *   · 这里是「授权一次、长期记住」。之后在 Mod 站下载 Mod 会自动写进这个文件夹，
   *     点本按钮则从这个文件夹把 Mod 扫进来（装到 mods/_local/，带「本地」标签）
   * ------------------------------------------------------------------ */
  async function loadFromLocalDir() {
    const L = global.WXLOCAL;
    if (!L) { U.toast('当前浏览器不支持本地文件夹，请用 Chrome / Edge', 'warn', 3600); return; }
    if (!L.supported) {
      U.modal('浏览器不支持',
        '<div class="modal-text">你的浏览器不支持「文件系统访问」接口，无法授权本地 Mod 文件夹。<br><br>' +
        '建议改用 <b>Chrome</b> 或 <b>Edge</b>，就可以把 Mod 直接存进本地文件夹了。<br>' +
        '现在也可以继续用「从文件安装」（选 zip）。</div>',
        '<button class="btn-ink" onclick="WXUI.closeModal()">知 道 了</button>');
      return;
    }

    U.modal('加载本地 Mod 文件夹',
      '<div class="modal-text">' +
      '授权一个本地文件夹当「Mod 文件夹」，之后：<br>' +
      '· 在 Mod 站下载的 Mod 会直接存进去<br>' +
      '· 点下面的按钮把里面的 Mod 全部加载进游戏<br><br>' +
      '<span class="dim">Mod 会装到 mods/_local/，只在本机生效，不会被上传。</span>' +
      '</div>' +
      '<div class="mm-local-state" id="lm-state">正在读取…</div>',
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>' +
      '<button class="btn-ink" id="lm-pick">选 择 文 件 夹</button>' +
      '<button class="btn-ink primary" id="lm-load">加 载 进 游 戏</button>');

    const stateEl = $('lm-state');
    async function paint() {
      if (!stateEl) return;
      try {
        await L.restore();
        const st = await L.permissionState();
        const name = L.folderName();
        if (name && st === 'granted') {
          stateEl.innerHTML = '✔ 已授权文件夹：<b>' + esc(name) + '</b>';
          stateEl.className = 'mm-local-state ok';
        } else if (name) {
          stateEl.innerHTML = '⚠ 已记住 <b>' + esc(name) + '</b>，但需要重新确认一次权限（点「加载进游戏」时浏览器会问）。';
          stateEl.className = 'mm-local-state warn';
        } else {
          stateEl.innerHTML = '还没有选择文件夹。先点「选择文件夹」。';
          stateEl.className = 'mm-local-state';
        }
      } catch (e) {
        stateEl.textContent = '读取状态失败：' + e.message;
      }
    }
    paint();

    $('lm-pick').onclick = async () => {
      try {
        const r = await L.pickFolder();
        if (!r || !r.ok) {
          if (r && r.aborted) return;
          U.toast((r && r.error) || '没有选择文件夹', 'warn');
          return;
        }
        await paint();
        U.toast('已记住这个文件夹：' + (r.name || ''), 'ok');
      } catch (e) {
        if (e && (e.name === 'AbortError')) return;
        U.toast('选择失败：' + e.message, 'error');
      }
    };

    $('lm-load').onclick = async () => {
      const btn = $('lm-load');
      btn.disabled = true; btn.textContent = '读 取 中…';
      try {
        const st = await L.permissionState();
        if (st !== 'granted') {
          const r = await L.restore(true);
          if (!r || !r.ok) {
            U.toast('需要先授权文件夹（点「选择文件夹」）', 'warn', 3600);
            btn.disabled = false; btn.textContent = '加 载 进 游 戏';
            return;
          }
        }
        const found = await L.scanMods();
        if (!found.length) {
          U.toast('这个文件夹里没找到 Mod（要有 mod.json 或 xxx.json）', 'warn', 4000);
          btn.disabled = false; btn.textContent = '加 载 进 游 戏';
          return;
        }
        let done = 0, fail = 0, lastErr = '';
        for (const m of found) {
          try {
            if (m.kind === 'json') {
              const r = await api.modInstallLocal({ kind: 'json', json: m.json, id: m.id });
              if (r && r.ok === false) throw new Error(r.msg || '安装失败');
            } else if (m.kind === 'folder') {
              const files = [];
              for (const f of m.files) {
                files.push({ path: f.path, base64: await fileToB64(f.file) });
              }
              const r = await api.modInstallLocal({ kind: 'folder', files, id: m.id, name: m.id });
              if (r && r.ok === false) throw new Error(r.msg || '安装失败');
            }
            done++;
          } catch (e) { fail++; lastErr = e.message || String(e); }
        }
        await refreshMods();
        U.closeModal();
        U.toast('已加载 ' + done + ' 个本地 Mod' + (fail ? '（' + fail + ' 个失败：' + lastErr + '）' : ''), fail ? 'warn' : 'ok', 4200);
      } catch (e) {
        U.toast('加载失败：' + e.message, 'error', 4000);
        btn.disabled = false; btn.textContent = '加 载 进 游 戏';
      }
    };
  }

  function fileToB64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const s = String(fr.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      fr.onerror = () => reject(new Error('读取失败'));
      fr.readAsDataURL(file);
    });
  }

  async function openModFolder() {
    try { await api.jfetch('/api/openfolder', { method: 'POST', body: JSON.stringify({ kind: 'mods' }) }); U.toast('已尝试打开 Mod 目录', 'ok'); }
    catch (e) { U.toast('无法打开，请手动前往游戏目录 mods/', 'warn', 3200); }
  }

  async function openModWeb() {
    let cfg = S.siteConfig;
    try { cfg = await api.siteConfig(); } catch (e) { }
    const url = (cfg && cfg.siteUrl) || (cfg && cfg.apiBase) || 'http://127.0.0.1:8788';
    window.open(url.replace(/\/api\/?$/, ''), '_blank');
  }

  async function reloadAll() {
    const ok = await U.confirmBox('重载 Mod', '重载会重新载入全部 Mod 与世界数据。当前进度若未保存将丢失，确定继续吗？', '重 载');
    if (!ok) return;
    try {
      await api.reload();
      await refreshMods();
      U.toast('已重载', 'ok');
      if (S.view && S.view.player) U.renderAll(S.view);
    } catch (e) { U.toast('重载失败：' + e.message, 'error'); }
  }

  /* ============================================================
   *  MOD 市场（在线）
   * ============================================================ */
  const MK = { list: [], kw: '' };

  function mkOpen() {
    bindMkButtons();
    mkSearch();
  }

  function bindMkButtons() {
    const go = $('mk-go');
    if (go && !go.__b) { go.__b = true; go.onclick = mkSearch; }
    const inp = $('mk-search');
    if (inp && !inp.__b) {
      inp.__b = true;
      inp.onkeydown = e => { if (e.key === 'Enter') mkSearch(); };
    }
    const cfg = $('mk-sitecfg');
    if (cfg && !cfg.__b) { cfg.__b = true; cfg.onclick = mkSiteConfig; }
  }

  async function mkSiteConfig() {
    let cfg = S.siteConfig || {};
    try { cfg = await api.siteConfig(); } catch (e) { }
    U.modal('Mod 网站设置',
      '<div class="settings">' +
      '<div class="set-row"><label>网站 API 地址</label><input type="text" id="mk-cfg-api" class="modal-input" value="' + esc(cfg.apiBase || 'http://127.0.0.1:8788') + '"></div>' +
      '<div class="set-row"><label>网站首页地址</label><input type="text" id="mk-cfg-site" class="modal-input" value="' + esc(cfg.siteUrl || '') + '" placeholder="留空则用 API 地址"></div>' +
      '<div class="set-row"><label>上传署名</label><input type="text" id="mk-cfg-me" class="modal-input" value="' + esc((S.my && S.my.name) || '') + '" placeholder="你的昵称"></div>' +
      '</div>',
      '<button class="btn-ink" onclick="WXUI.closeModal()">取 消</button>' +
      '<button class="btn-ink primary" id="mk-cfg-save">保 存</button>');
    $('mk-cfg-save').onclick = async () => {
      const c = {
        apiBase: $('mk-cfg-api').value.trim() || 'http://127.0.0.1:8788',
        siteUrl: $('mk-cfg-site').value.trim() || '',
      };
      global.WX.setMe({ name: $('mk-cfg-me').value.trim() || '匿名侠客' });
      try {
        await api.siteSetConfig(c);
        U.closeModal();
        U.toast('已保存网站设置', 'ok');
        mkSearch();
      } catch (e) { U.toast(e.message, 'error'); }
    };
  }

  async function mkSearch() {
    const box = $('mk-list');
    MK.kw = ($('mk-search') && $('mk-search').value.trim()) || '';
    box.innerHTML = '<div class="mk-loading">正在连接 Mod 网站…</div>';
    let list = [], err = null;
    try {
      const d = await api.siteRemote({ action: 'list', q: MK.kw });
      list = d.mods || d.list || [];
    } catch (e) { err = e; }

    if (err) {
      box.innerHTML =
        '<div class="mk-offline">' +
        '<div class="mko-title">⚠ 无法连接 Mod 网站</div>' +
        '<div class="mko-msg">' + esc(err.message) + '</div>' +
        '<div class="mko-tip">请确认 Mod 网站服务已启动（在项目目录运行 <code>node server/mod-site.js</code>）。<br>' +
        '若网站部署在别处，点右上角「网站设置」填写正确地址。</div>' +
        '<div class="mko-ops"><button class="btn-ink small" id="mk-retry">重 试</button>' +
        '<button class="btn-ink small" id="mk-cfg2">网站设置</button></div>' +
        '</div>';
      const r = $('mk-retry'); if (r) r.onclick = mkSearch;
      const c2 = $('mk-cfg2'); if (c2) c2.onclick = mkSiteConfig;
      return;
    }

    MK.list = list;
    if (!list.length) {
      box.innerHTML = '<div class="mk-empty">没有找到 Mod。' + (MK.kw ? '换个关键词试试？' : '快去制作器里做一个，一键上传吧！') + '</div>';
      return;
    }

    box.innerHTML = list.map((m, i) =>
      '<div class="mk-card">' +
      '<div class="mkc-top">' +
      '<div class="mkc-name">' + esc(m.name || m.id) + '</div>' +
      '<div class="mkc-cat">' + esc(m.category || '综合') + '</div>' +
      '</div>' +
      '<div class="mkc-desc">' + esc(m.desc || '') + '</div>' +
      '<div class="mkc-meta">' +
      '<span>' + esc(m.author || '佚名') + '</span>' +
      '<span>v' + esc(m.version || '1.0.0') + '</span>' +
      (m.downloads != null ? '<span>↓ ' + m.downloads + '</span>' : '') +
      (m.time ? '<span>' + util.fmtTime(m.time) + '</span>' : '') +
      '</div>' +
      (m.tags && m.tags.length ? '<div class="mkc-tags">' + m.tags.map(t => '<span class="mini-tag static">' + esc(t) + '</span>').join('') + '</div>' : '') +
      '<div class="mkc-ops">' +
      '<button class="btn-ink small primary" data-install="' + esc(m.id) + '">一键下载安装</button>' +
      '<button class="btn-ink small" data-detail="' + i + '">详情</button>' +
      '<button class="btn-ink small" data-open="' + i + '">网页查看</button>' +
      '</div></div>').join('');

    box.querySelectorAll('[data-install]').forEach(b => b.onclick = () => mkInstall(b.getAttribute('data-install'), b));
    box.querySelectorAll('[data-detail]').forEach(b => b.onclick = () => mkDetail(MK.list[+b.getAttribute('data-detail')]));
    box.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
      const m = MK.list[+b.getAttribute('data-open')];
      const base = ((S.siteConfig && (S.siteConfig.siteUrl || S.siteConfig.apiBase)) || 'http://127.0.0.1:8788').replace(/\/api\/?$/, '');
      window.open(base + '/mod.html?id=' + encodeURIComponent(m.id), '_blank');
    });
  }

  function mkDetail(m) {
    U.modal(m.name || m.id,
      '<div class="mk-detail">' +
      '<div class="mkc-tags">' + (m.tags || []).map(t => '<span class="mini-tag static">' + esc(t) + '</span>').join('') + '</div>' +
      '<div class="mcd-desc">' + esc(m.desc || '（无简介）') + '</div>' +
      '<div class="mcd-counts">' +
      countChip('房间', m.counts && m.counts.rooms) + countChip('人物', m.counts && m.counts.npcs) +
      countChip('物品', m.counts && m.counts.items) + countChip('武学', m.counts && m.counts.skills) +
      countChip('任务', m.counts && m.counts.quests) + '</div>' +
      '<div class="mk-detail-meta">作者：' + esc(m.author || '佚名') + ' · 版本：' + esc(m.version || '1.0.0') +
      (m.time ? ' · 上传于 ' + util.fmtTime(m.time) : '') + '</div>' +
      '</div>',
      '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>' +
      '<button class="btn-ink primary" data-install="' + esc(m.id) + '">一键下载安装</button>');
    const b = document.querySelector('#modal-foot [data-install]');
    if (b) b.onclick = () => { U.closeModal(); mkInstall(m.id); };
  }

  async function mkInstall(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
    try {
      const d = await api.siteRemote({ action: 'download', id });
      if (!d.base64 && !d.json) throw new Error('网站未返回 Mod 内容');
      const inst = await api.modInstall({
        kind: 'json',
        id,
        json: d.json || null,
        base64: d.base64 || null,
        name: d.name
      });
      await refreshMods();
      U.toast('安装成功：' + ((inst.mod && inst.mod.name) || d.name || id) + '（记得在管理器中启用）', 'ok', 3500);
      if (btn) { btn.textContent = '✔ 已安装'; }
    } catch (e) {
      U.toast('安装失败：' + e.message, 'error', 4000);
      if (btn) { btn.disabled = false; btn.textContent = '一键下载安装'; }
    }
  }

  /* ============================================================
   *  文档页
   * ============================================================ */
  function openDoc() {
    U.show('doc');
    const box = $('doc-body');
    box.innerHTML =
      '<div class="doc-tabs">' +
      '<button class="doc-tab active" data-dt="guide">游戏说明</button>' +
      '<button class="doc-tab" data-dt="maker">Mod 制作教程</button>' +
      '<button class="doc-tab" data-dt="examples">示例 Mod</button>' +
      '<button class="doc-tab" data-dt="about">关于</button>' +
      '</div><div id="doc-inner"></div>';

    const inner = $('doc-inner');
    const paint = k => {
      if (k === 'guide') inner.innerHTML = global.WXDOC.gameGuide();
      else if (k === 'maker') inner.innerHTML = '<div class="doc-mm">' + global.WXDOC.makerTutorial() + '</div>';
      else if (k === 'examples') {
        inner.innerHTML = '<div class="doc-sec"><h3>示例 Mod</h3>' +
          '<p class="doc-lead">下面这些是最基础的示例，可以直接「载入制作器」当模板改。</p>' +
          '<div class="ex-grid">' + global.WXDOC.examplesHtml() + '</div></div>';
        bindExamples();
      } else {
        inner.innerHTML = aboutHtml();
      }
      inner.scrollTop = 0;
    };
    box.querySelectorAll('.doc-tab').forEach(b => {
      b.onclick = () => {
        box.querySelectorAll('.doc-tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        paint(b.getAttribute('data-dt'));
      };
    });
    paint('guide');
  }

  function bindExamples() {
    document.querySelectorAll('[data-example]').forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute('data-example');
        const e = global.WXDOC.EXAMPLES[k];
        U.modal(e.title, '<textarea class="mm-json" readonly>' + esc(JSON.stringify(e.json, null, 2)) + '</textarea>',
          '<button class="btn-ink" onclick="WXUI.closeModal()">关 闭</button>' +
          '<button class="btn-ink primary" data-copy="' + k + '">复 制</button>');
        const c = document.querySelector('#modal-foot [data-copy]');
        if (c) c.onclick = () => {
          navigator.clipboard.writeText(JSON.stringify(global.WXDOC.EXAMPLES[k].json, null, 2))
            .then(() => U.toast('已复制', 'ok'), () => U.toast('复制失败', 'warn'));
        };
      };
    });
    document.querySelectorAll('[data-example-load]').forEach(b => {
      b.onclick = () => {
        const k = b.getAttribute('data-example-load');
        const e = global.WXDOC.EXAMPLES[k];
        S.spec = global.WXMM.jsonToSpec(util.clone(e.json));
        global.WXMM.mark();
        U.showModMaker();
        U.toast('已载入：' + e.title, 'ok');
      };
    });
  }

  function aboutHtml() {
    const st = (S.boot && S.boot.stats) || {};
    return '<div class="doc-sec"><h2>关于《武侠行》</h2>' +
      '<p class="doc-lead">一款单机、离线、可无限扩展的武侠 MUD。</p>' +
      '<div class="doc-grid">' +
      '<div class="doc-card"><b>世界规模</b><p>' +
      (st.rooms || '—') + ' 处场景 · ' + (st.npcs || '—') + ' 位人物 · ' + (st.skills || '—') + ' 门武学 · ' +
      (st.items || '—') + ' 件物品 · ' + (st.sects || '—') + ' 个门派 · ' + (st.quests || '—') + ' 条任务</p></div>' +
      '<div class="doc-card"><b>技术</b><p>Node.js 零外部依赖（仅用内置 http / fs / zlib），数据驱动架构，全内容 JSON 化。</p></div>' +
      '<div class="doc-card"><b>理念</b><p>高自由度：不写代码也能改世界的每一处。所有内容都是数据，所有数据都能被 Mod 覆盖。</p></div>' +
      '</div>' +
      '<h3>开源与致谢</h3>' +
      '<p>灵感来自北大侠客行等经典文字 MUD。世界设定取材于金庸先生笔下的江湖，仅作学习与娱乐用途。</p>' +
      '</div>';
  }

  /* ============================================================
   *  屏幕切换钩子
   * ============================================================ */
  bus.on('screen', name => {
    if (name === 'modmaker') {
      if (global.WXMM) global.WXMM.open();
    } else if (name === 'modcenter') {
      mcOpen();
    } else if (name === 'market') {
      mkOpen();
    }
  });

  /* ============================================================
   *  启动
   * ============================================================ */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* 暴露给 UI 模块 */
  global.WXMC = { open: mcOpen, refresh: refreshMods };
  global.WXMK = { open: mkOpen, search: mkSearch };
  global.WXSTART = { boot, openCreate, openDoc, continueGame, probeSaves, loadFromLocalDir };

})(window);
