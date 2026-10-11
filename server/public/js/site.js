/* ==========================================================================
   武侠行 Mod 站 · 公共脚本
   ========================================================================== */
(function (global) {
  'use strict';

  const API = '';   /* 同源，所以留空；若分离部署可改成绝对地址 */

  /* ---------------- 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function q(obj) {
    const p = new URLSearchParams();
    Object.keys(obj || {}).forEach(k => {
      if (obj[k] === undefined || obj[k] === null || obj[k] === '') return;
      p.append(k, obj[k]);
    });
    const s = p.toString();
    return s ? ('?' + s) : '';
  }
  function fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function fmtSize(n) {
    if (!n) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function getQuery(k) {
    return new URLSearchParams(location.search).get(k) || '';
  }
  function pick(o, keys) {
    const r = {};
    (keys || []).forEach(k => { if (o[k] !== undefined) r[k] = o[k]; });
    return r;
  }

  /* 把 API 路径转成相对路径 —— 站点既可以挂在根目录（本地单跑），
     也可以挂在 /site/ 前缀下（合并服务），相对路径两种都能用 */
  function rel(p) {
    return String(p == null ? '' : p).replace(/^\//, '');
  }

  async function jget(path, query) {
    const res = await fetch(API + rel(path) + q(query || {}));
    const t = await res.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('返回内容不是 JSON：' + t.slice(0, 160)); }
  }
  async function jpost(path, body) {
    const res = await fetch(API + rel(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const t = await res.text();
    try { return JSON.parse(t); } catch (e) { throw new Error('返回内容不是 JSON：' + t.slice(0, 160)); }
  }

  /* ---------------- Toast ---------------- */
  let toastTimer = null;
  function toast(msg, type, ms) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.body.appendChild(el);
    }
    el.className = type || '';
    el.innerHTML = esc(msg).replace(/\n/g, '<br>');
    el.classList.remove('hide');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hide'), ms || 2600);
  }

  /* ---------------- 顶栏 ---------------- */
  function renderHead(active) {
    const nav = [
      ['index.html', '首页', 'home'],
      ['list.html', 'Mod 列表', 'list'],
      ['tutorial.html', '制作教程', 'tutorial'],
      ['examples.html', '示例 Mod', 'examples'],
      ['upload.html', '发布 Mod', 'upload']
    ];
    const html =
      '<div class="sh-inner">' +
      '<a class="sh-brand" href="index.html" style="text-decoration:none">' +
      '<span class="sh-logo">武侠行</span><span class="sh-sub">MOD · 江 湖 客 棧</span>' +
      '</a>' +
      '<nav class="sh-nav">' +
      nav.map(n => '<a href="' + n[0] + '"' + (active === n[2] ? ' class="active"' : '') + '>' + n[1] + '</a>').join('') +
      '</nav>' +
      '<button class="sh-play" id="sh-play" title="直接在网页里开始游戏">▶ 开始游戏</button>' +
      '</div>';
    const el = document.getElementById('site-head');
    if (el) el.innerHTML = html;
    /* 顶栏常驻「开始游戏」，任何页面一键直达 */
    bindPlayButton(document.getElementById('sh-play'));
  }

  /* ---------------- 简易弹窗 ---------------- */
  function showModal(title, bodyHtml) {
    let m = document.getElementById('wx-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'wx-modal';
      m.className = 'wx-modal';
      document.body.appendChild(m);
    }
    m.innerHTML =
      '<div class="wm-box"><div class="wm-head">' + esc(title) +
      '<button class="wm-x" type="button">×</button></div>' +
      '<div class="wm-body">' + bodyHtml + '</div></div>';
    m.classList.add('on');
    m.querySelector('.wm-x').onclick = closeModal;
    m.onclick = ev => { if (ev.target === m) closeModal(); };
  }
  function closeModal() {
    const m = document.getElementById('wx-modal');
    if (m) m.classList.remove('on');
  }

  function renderFoot() {
    const el = document.getElementById('site-foot');
    if (!el) return;
    const cloudOn = global.WXCLOUD && global.WXCLOUD.available();
    el.innerHTML =
      '<div>武侠行 · Mod 江湖客栈 &nbsp;|&nbsp; 一个属于玩家自己的武侠世界</div>' +
      '<div style="margin-top:6px">' +
      (cloudOn
        ? '☁️ 云端已连接 &nbsp;·&nbsp; Mod 数据实时同步，多设备可见'
        : '💾 本地模式 &nbsp;·&nbsp; 数据存于 <code>server/site-data/</code>') +
      '</div>' +
      '<div style="margin-top:6px;color:#b5ab92">游戏端「网站设置」里填入本站地址即可一键下载 Mod</div>';
  }

  /* ---------------- 统一取数：云端优先，本地兜底 ----------------
     ⚠ 关键：云端查询**成功但返回空**时也必须回落本地。
     云端 mods 表可能是空的（官方示例是 seedOfficialMods 播到本地 site-data 索引里的，
     不进云表），只在 catch 里兜底会让整个列表变成「还没有 Mod」。 */
  async function fetchStats() {
    if (global.WXCLOUD && global.WXCLOUD.available()) {
      try {
        const s = await global.WXCLOUD.db.stats();
        /* 有内容才用云端结果 */
        if (s && (s.mods > 0 || (s.latest || []).length)) return s;
      } catch (e) { }
    }
    const d = await jget('/api/stats');
    return d.stats || d;
  }

  async function fetchList(opts) {
    if (global.WXCLOUD && global.WXCLOUD.available()) {
      try {
        const r = await global.WXCLOUD.db.list(opts);
        /* 云端有结果才用它；空结果回落本地，否则列表会空 */
        if (r && ((r.mods || []).length || r.total > 0)) {
          return { total: r.total, mods: r.mods, page: r.page, size: r.size, cloud: true };
        }
      } catch (e) { }
    }
    const d = await jget('/api/mods', opts);
    return { total: d.total || 0, mods: d.mods || [], page: d.page || 1, size: d.size || 12, cloud: false };
  }

  async function fetchDetail(id) {
    if (global.WXCLOUD && global.WXCLOUD.available()) {
      try {
        const m = await global.WXCLOUD.db.detail(id);
        if (m) return { mod: m, cloud: true };
      } catch (e) { }
    }
    const d = await jget('/api/mods/' + encodeURIComponent(id));
    return d.mod ? { mod: d.mod, cloud: false } : null;
  }

  async function fetchCategories() {
    if (global.WXCLOUD && global.WXCLOUD.available()) {
      try {
        const c = await global.WXCLOUD.db.categories();
        if (c && (Array.isArray(c) ? c.length : Object.keys(c).length)) return c;
      } catch (e) { }
    }
    const d = await jget('/api/categories');
    return d.categories || [];
  }

  /* ---------------- 分类 chip ---------------- */
  function catChips(cats, cur, onPick) {
    let h = '<div class="tb-chips">';
    h += '<button class="chip' + (!cur ? ' active' : '') + '" data-cat="">全部</button>';
    (cats || []).forEach(c => {
      const name = typeof c === 'string' ? c : c.name;
      const n = typeof c === 'string' ? '' : (' ' + c.count);
      h += '<button class="chip' + (cur === name ? ' active' : '') + '" data-cat="' + esc(name) + '">' + esc(name) + esc(n) + '</button>';
    });
    h += '</div>';
    return h;
  }

  /* ---------------- 卡片渲染 ---------------- */
  function modCard(m) {
    const c = m.counts || {};
    const counts = [];
    if (c.rooms) counts.push('<span class="cnt">房间 ' + c.rooms + '</span>');
    if (c.npcs) counts.push('<span class="cnt">人物 ' + c.npcs + '</span>');
    if (c.items) counts.push('<span class="cnt">物品 ' + c.items + '</span>');
    if (c.skills) counts.push('<span class="cnt">武学 ' + c.skills + '</span>');
    if (c.quests) counts.push('<span class="cnt">任务 ' + c.quests + '</span>');
    if (c.rules) counts.push('<span class="cnt">规则 ' + c.rules + '</span>');

    return '<div class="mod-card' + (m.official ? ' official' : '') + '">' +
      '<div class="mc-head"><span class="mc-name">' + esc(m.name || m.id) +
      (m.official ? '<span class="mc-official" title="官方随游戏发布的示例 Mod">官方示例</span>' : '') +
      /* 二创标注（主人 2026-10-11）：来源是服务端钉在记录里的，作者自己删不掉 */
      (m.forkOf ? '<span class="mc-fork" title="二创自《' + esc(m.forkOf.name) + '》（' +
        esc(m.forkOf.official ? '官方' : m.forkOf.owner) + '）">二创</span>' : '') + '</span>' +
      '<span class="mc-cat">' + esc(m.category || '综合') + '</span></div>' +
      '<div class="mc-desc">' + esc(m.desc || '（这位作者很神秘，没有留下简介）') + '</div>' +
      (counts.length ? '<div class="mc-counts">' + counts.join('') + '</div>' : '') +
      '<div class="mc-meta">' +
      '<span>by ' + esc(m.author || '佚名') + '</span>' +
      '<span>v' + esc(m.version || '1.0.0') + '</span>' +
      '<span>↓ ' + (m.downloads || 0) + '</span>' +
      (m.time ? '<span>' + fmtTime(m.time) + '</span>' : '') +
      '</div>' +
      (m.tags && m.tags.length ? '<div class="mc-tags">' + m.tags.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>' : '') +
      '<div class="mc-ops">' +
      '<a class="btn sm red" href="mod.html?id=' + encodeURIComponent(m.id) + '">查看详情</a>' +
      (m.hasFile ? '<a class="btn sm" href="api/mods/' + encodeURIComponent(m.id) + '/file">下载 ZIP</a>' : '') +
      '<button class="btn sm" data-copy-url="mod.html?id=' + esc(m.id) + '">复制链接</button>' +
      '</div></div>';
  }

  /* ---------------- 复制到剪贴板 ---------------- */
  function bindCopy(root) {
    (root || document).querySelectorAll('[data-copy-url]').forEach(b => {
      b.onclick = () => {
        const u = location.origin + location.pathname.replace(/\/[^/]*$/, '/') + b.getAttribute('data-copy-url');
        navigator.clipboard.writeText(u).then(() => toast('链接已复制', 'ok'), () => toast('复制失败', 'err'));
      };
    });
    (root || document).querySelectorAll('[data-copy-text]').forEach(b => {
      b.onclick = () => {
        const sel = b.getAttribute('data-copy-text');
        const src = document.querySelector(sel);
        if (!src) return;
        navigator.clipboard.writeText(src.textContent || src.value || '')
          .then(() => toast('已复制', 'ok'), () => toast('复制失败', 'err'));
      };
    });
  }

  /* ---------------- 下载 zip ---------------- */
  function downloadZip(id) {
    location.href = API + rel('/api/mods/' + encodeURIComponent(id) + '/file');
  }

  /* ------------------------------------------------------------------ *
   * 浏览器端打 ZIP（存储方式，不压缩）—— 用于把云端 Mod 导出成安装包
   * 只实现 store 模式：PK\x03\x04 + 局部头 + 数据 + 中央目录 + EOCD
   * ------------------------------------------------------------------ */
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    if (global.TextEncoder) return new global.TextEncoder().encode(str);
    const s = unescape(encodeURIComponent(str));
    const a = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }

  /** files: [{name, data: Uint8Array}] → Blob */
  function makeZip(files) {
    const chunks = [];
    const central = [];
    let offset = 0;

    const u16 = n => [n & 0xFF, (n >>> 8) & 0xFF];
    const u32 = n => [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF];

    files.forEach(f => {
      const nameBytes = utf8(f.name);
      const data = f.data || new Uint8Array(0);
      const crc = crc32(data);
      const localOffset = offset;

      /* 局部文件头 */
      const local = [].concat(
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0)
      );
      chunks.push(new Uint8Array(local), nameBytes, data);
      offset += local.length + nameBytes.length + data.length;

      /* 中央目录项 */
      central.push([].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(localOffset)
      ));
      central[central.length - 1] = { head: central[central.length - 1], name: nameBytes };
    });

    const cdStart = offset;
    let cdSize = 0;
    central.forEach(c => {
      chunks.push(new Uint8Array(c.head), c.name);
      cdSize += c.head.length + c.name.length;
    });

    const eocd = [].concat(
      u32(0x06054b50), u16(0), u16(0),
      u16(files.length), u16(files.length),
      u32(cdSize), u32(cdStart), u16(0)
    );
    chunks.push(new Uint8Array(eocd));

    return new Blob(chunks, { type: 'application/zip' });
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  /** 把云端 Mod 行导出成可安装的 ZIP（内含 mod.json） */
  async function exportCloudMod(m) {
    const row = m.row || {};
    const content = row.content || row.mod_json || {};
    const merged = Object.assign({}, content);
    /* 确保元信息齐全，游戏端 modloader 认这些字段 */
    if (!merged.id) merged.id = m.id;
    if (!merged.name) merged.name = m.name;
    if (!merged.version) merged.version = m.version || '1.0.0';
    if (!merged.author) merged.author = m.author || '佚名';
    if (!merged.category) merged.category = m.category || '综合';
    if (!merged.desc) merged.desc = m.desc || '';

    const files = [
      { name: m.id + '/mod.json', data: utf8(JSON.stringify(merged, null, 2)) },
      { name: m.id + '/README.txt', data: utf8('武侠行 Mod：' + (m.name || m.id) + '\n作者：' + (m.author || '佚名') + '\n\n安装：游戏内「MOD 管理器」→「从文件安装」选这个 zip。\n') }
    ];
    saveBlob(makeZip(files), (m.id || 'mod') + '.zip');
    toast('安装包已生成', 'ok');
  }

  /* ==========================================================================
   *  游戏网页版入口
   *
   *  站点有两种跑法，游戏地址也不同：
   *    · 合并部署（combined.js）——站点在 /site/，游戏在 /       → '../'
   *    · 独立跑（mod-site.js）  ——站点在 8788，游戏在 8787     → 'http://host:8787/'
   *  服务端 /api/game-url 会算好，这里只负责取 + 兜底。
   * ========================================================================== */
  let _gameUrlCache = null;

  async function fetchGameUrl() {
    if (_gameUrlCache) return _gameUrlCache;
    try {
      const d = await jget('/api/game-url');
      if (d && d.ok && d.url) {
        _gameUrlCache = d.url;
        return d.url;
      }
    } catch (e) { }
    /* 兜底：多数情况下合并部署，试上级目录 */
    _gameUrlCache = '../';
    return _gameUrlCache;
  }

  /** 跳转游戏网页版（新标签页打开，站点不丢） */
  async function playGame(newTab) {
    const u = await fetchGameUrl();
    if (newTab === false) location.href = u;
    else window.open(u, '_blank', 'noopener');
  }

  /** 给一个「开始游戏」按钮挂上跳转 + 自动填 href（便于右键新窗口打开） */
  async function bindPlayButton(btn) {
    if (!btn) return;
    const u = await fetchGameUrl();
    btn.setAttribute('data-game-url', u);
    if (btn.tagName === 'A') btn.setAttribute('href', u);
    if (!btn.__playBound) {
      btn.__playBound = true;
      btn.addEventListener('click', function (ev) {
        ev.preventDefault();
        playGame();
      });
    }
  }

  /* ==========================================================================
   *  下载 Mod → 存本地授权文件夹（没授权就退回浏览器下载）
   *
   *  @param {object} m  Mod 元数据（含 id / name）
   *  @returns {{mode:'folder'|'download', path:string}}
   * ========================================================================== */
  async function saveModLocally(m) {
    const L = global.WXLOCAL;

    /* 1) 云端 Mod：现做一个 zip */
    if (m.row && global.WXCLOUD && global.WXCLOUD.available()) {
      const pkg = await exportCloudMod(m);
      if (L && await L.isReady()) {
        return await L.saveOrDownload(pkg.blob, pkg.filename, m.id);
      }
      saveBlob(pkg.blob, pkg.filename);
      return { mode: 'download', path: pkg.filename };
    }

    /* 2) 本地服务端 Mod：拉 zip 的二进制 */
    const url = rel('api/mods/' + encodeURIComponent(m.id) + '/file');
    const res = await fetch(API + url);
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status);

    /* 从 Content-Disposition 抠文件名 */
    let filename = (m.id || 'mod') + '.zip';
    const cd = res.headers.get('Content-Disposition') || '';
    const mm = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
    if (mm) { try { filename = decodeURIComponent(mm[1]); } catch (e) { filename = mm[1]; } }

    const blob = await res.blob();

    if (L && await L.isReady()) {
      return await L.saveOrDownload(blob, filename, m.id);
    }
    saveBlob(blob, filename);
    return { mode: 'download', path: filename };
  }

  /* ---------------- 导出 ---------------- */
  global.SITE = {
    esc, q, fmtTime, fmtSize, getQuery, pick,
    jget, jpost, rel, toast, renderHead, renderFoot, catChips, modCard,
    bindCopy, downloadZip, makeZip, saveBlob, exportCloudMod, saveModLocally,
    closeModal, showModal,
    fetchStats, fetchList, fetchDetail, fetchCategories,
    fetchGameUrl, playGame, bindPlayButton,
    CATEGORIES: ['剧情', '地图', '功能', '功法', '物品', '门派', '任务', '综合', '美化']
  };


  /* ---------------- 自动启动：初始化云服务（仅 Mod 云端读写） ---------------- */
  (function autoBoot() {
    function boot() {
      if (!global.WXCLOUD) return;
      global.WXCLOUD.init().then(function () { /* 成败都不影响浏览 */ });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  })();

})(window);
