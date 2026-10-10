/* ============================================================
 *  武侠行 · 前端 API 封装 & 全局状态
 *  只依赖浏览器原生 fetch，和后端 server/game-server.js 通信
 * ============================================================ */
(function (global) {
  'use strict';

  /* ---------------- 全局状态 ---------------- */
  const S = {
    boot: null,            // 后端启动信息（引擎元数据、版本、统计）
    view: null,            // 最近一次 /api/state 的完整视图
    screen: 'start',       // 当前屏幕
    busy: false,           // 是否有请求在飞
    modList: [],           // mod 列表缓存
    editorMeta: null,      // 制作器元数据
    spec: null,            // 制作器当前表单数据
    siteConfig: null,      // mod 网站配置
    settings: {            // 本地偏好
      font: 100,
      anim: true,
      autosave: true,
      narrow: false
    },
    my: null               // 当前登录（本站简易身份，存 localStorage）
  };

  /* ---------------- 偏好读写 ---------------- */
  const LS_KEY = 'wxgame.settings.v1';
  const LS_MY = 'wxgame.me.v1';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) Object.assign(S.settings, JSON.parse(raw));
    } catch (e) { /* ignore */ }
    try {
      const me = localStorage.getItem(LS_MY);
      if (me) S.my = JSON.parse(me);
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(S.settings)); } catch (e) { }
  }

  function setMe(me) {
    S.my = me;
    try { localStorage.setItem(LS_MY, JSON.stringify(me)); } catch (e) { }
  }

  /* ---------------- 设备标识（机器码） ----------------
     用于区分不同设备 / 不同玩家，自动存档槽位按它隔离。
     浏览器拿不到真·机器码，这里用「首次生成的随机号 + 浏览器指纹」近似，
     同一台机器同一个浏览器，每次都是同一个号。 */
  const LS_DEVICE = 'wxgame.device.v1';
  function getDeviceId() {
    try {
      const cached = localStorage.getItem(LS_DEVICE);
      if (cached) return cached;
      const nav = (typeof navigator !== 'undefined' && navigator) || {};
      const fp = [nav.userAgent, nav.language, (typeof screen !== 'undefined' && screen.width) || 0,
        (typeof screen !== 'undefined' && screen.height) || 0, (new Date()).getTimezoneOffset()].join('|');
      let h = 0;
      for (let i = 0; i < fp.length; i++) h = (h * 31 + fp.charCodeAt(i)) >>> 0;
      const id = 'dev_' + h.toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      localStorage.setItem(LS_DEVICE, id);
      return id;
    } catch (e) {
      return 'dev_unknown';
    }
  }

  /* ---------------- 底层请求 ---------------- */
  async function jfetch(url, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error('无法连接本地服务：' + e.message + '\n请确认 game-server 是否在运行。');
    }
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; }
    catch (e) { throw new Error('服务返回了非 JSON 内容：' + text.slice(0, 200)); }
    if (!res.ok || data.ok === false) {
      throw new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
    }
    return data;
  }

  function q(obj) {
    const p = new URLSearchParams();
    Object.keys(obj || {}).forEach(k => {
      if (obj[k] === undefined || obj[k] === null) return;
      p.append(k, typeof obj[k] === 'object' ? JSON.stringify(obj[k]) : obj[k]);
    });
    const s = p.toString();
    return s ? ('?' + s) : '';
  }

  /* ---------------- API ---------------- */
  const api = {
    /* 启动信息 */
    async boot() {
      const d = await jfetch('/api/boot');
      S.boot = d;
      return d;
    },

    /* 出生地列表（六种出身） */
    async births() {
      const d = await jfetch('/api/births');
      return d.births || [];
    },

    /* 新建角色 */
    async newGame(payload) {
      const d = await jfetch('/api/new', { method: 'POST', body: JSON.stringify(payload) });
      S.view = d.view || d;
      return d;
    },

    /* 当前状态快照 */
    async state() {
      const d = await jfetch('/api/state');
      if (d.view) S.view = d.view;
      return d;
    },

    /* 执行任意指令 */
    async exec(cmd) {
      const d = await jfetch('/api/exec', { method: 'POST', body: JSON.stringify({ cmd }) });
      if (d.view) S.view = d.view;
      return d;
    },

    /* 新手教程标记上报：面板类指令不进 exec，后端收不到动作，
       由前端在这里补报（详见 ui.js doCmd 的面板分支） */
    async markGuide(flag) {
      try {
        const d = await jfetch('/api/guide/mark', { method: 'POST', body: JSON.stringify({ flag }) });
        if (d.view) S.view = d.view;
        return d;
      } catch (e) {
        /* 上报失败不该影响玩家看面板，静默忽略 */
        return null;
      }
    },

    /* 弹窗中的选项（对话树 / 商店 / 出厂菜单等） */
    async menu(payload) {
      const d = await jfetch('/api/menu', { method: 'POST', body: JSON.stringify(payload) });
      if (d.view) S.view = d.view;
      return d;
    },

    /* 战斗动作 */
    async combat(payload) {
      const d = await jfetch('/api/combat', { method: 'POST', body: JSON.stringify(payload || {}) });
      if (d.view) S.view = d.view;
      return d;
    },

    /* 通用快捷动作（右侧场景栏点击人物 / 物品） */
    async quick(action, uid, extra) {
      const d = await jfetch('/api/quick', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action, uid }, extra || {}))
      });
      if (d.view) S.view = d.view;
      return d;
    },

    /* 视图切换（不发指令，只重新取一份渲染数据） */
    async view(panel) {
      const d = await jfetch('/api/view' + q({ panel }));
      if (d.view) S.view = d.view;
      return d;
    },

    /* 某个 NPC 的详情画像（点「细看此人」时按需拉，不塞进每次 exec 的 view 里） */
    async npcProfile(uid) {
      return await jfetch('/api/npc', { method: 'POST', body: JSON.stringify({ uid }) });
    },

    /* 某个任务的详情（点「接取任务」时先弹详情页，玩家看过再决定接不接） */
    async questPreview(qid) {
      return await jfetch('/api/quest', { method: 'POST', body: JSON.stringify({ qid }) });
    },

    /* 存档 */
    async saves() { return await jfetch('/api/saves'); },
    async save(id) { const d = await jfetch('/api/save', { method: 'POST', body: JSON.stringify({ id }) }); return d; },
    async saveWrite(id, data) { return await jfetch('/api/save/write', { method: 'POST', body: JSON.stringify({ id, data }) }); },
    async load(id) { const d = await jfetch('/api/load', { method: 'POST', body: JSON.stringify({ id }) }); if (d.view) S.view = d.view; return d; },
    async delSave(id) { return await jfetch('/api/deletesave', { method: 'POST', body: JSON.stringify({ id }) }); },

    /* Mod 管理 */
    async mods() {
      const d = await jfetch('/api/mods');
      S.modList = d.mods || [];
      return d;
    },
    async modToggle(id, enabled) {
      const d = await jfetch('/api/mod:toggle', { method: 'POST', body: JSON.stringify({ id, enabled }) });
      S.modList = d.mods || S.modList;
      if (d.view) S.view = d.view;
      return d;
    },
    async modOrder(order) {
      const d = await jfetch('/api/mod:order', { method: 'POST', body: JSON.stringify({ order }) });
      S.modList = d.mods || S.modList;
      if (d.view) S.view = d.view;
      return d;
    },
    async modRemove(id) {
      const d = await jfetch('/api/mod:remove', { method: 'POST', body: JSON.stringify({ id }) });
      S.modList = d.mods || [];
      return d;
    },
    async modInstall(payload) {
      const d = await jfetch('/api/mod:install', { method: 'POST', body: JSON.stringify(payload) });
      S.modList = d.mods || S.modList;
      return d;
    },
    /* 装「本地私有 Mod」（来自浏览器授权的本地文件夹），落 mods/_local/ */
    async modInstallLocal(payload) {
      const d = await jfetch('/api/mod:install-local', { method: 'POST', body: JSON.stringify(payload) });
      S.modList = d.mods || S.modList;
      return d;
    },
    async modExport(id) { return await jfetch('/api/mod:export', { method: 'POST', body: JSON.stringify({ id }) }); },
    async modRead(id, file) { return await jfetch('/api/mod:read', { method: 'POST', body: JSON.stringify({ id, file }) }); },
    async modWrite(id, file, content) { return await jfetch('/api/mod:write', { method: 'POST', body: JSON.stringify({ id, file, content }) }); },
    async modProblems() { return await jfetch('/api/mod:problems'); },
    async modDownloadZip(id) { return await jfetch('/api/mod:downloadzip', { method: 'POST', body: JSON.stringify({ id }) }); },

    /* Mod 制作器 */
    async editorMeta() {
      if (S.editorMeta) return S.editorMeta;
      const d = await jfetch('/api/editor/meta');
      S.editorMeta = d.meta || d;
      return S.editorMeta;
    },
    async editorValidate(spec) {
      const d = await jfetch('/api/editor/validate', { method: 'POST', body: JSON.stringify({ spec }) });
      return d;
    },
    async editorPreview(spec) {
      const d = await jfetch('/api/editor/preview', { method: 'POST', body: JSON.stringify({ spec }) });
      return d;
    },
    async editorSave(spec, id) {
      const d = await jfetch('/api/editor/save', { method: 'POST', body: JSON.stringify({ spec, id }) });
      S.modList = d.mods || S.modList;
      return d;
    },
    async editorExport(spec, id) {
      return await jfetch('/api/editor/export', { method: 'POST', body: JSON.stringify({ spec, id }) });
    },
    async editorTestRun(spec) {
      const d = await jfetch('/api/editor/testrun', { method: 'POST', body: JSON.stringify({ spec }) });
      if (d.view) S.view = d.view;
      return d;
    },

    /* Mod 网站 */
    async siteConfig() {
      const d = await jfetch('/api/site/config');
      S.siteConfig = d.config || d;
      return S.siteConfig;
    },
    async siteSetConfig(config) {
      const d = await jfetch('/api/site/setconfig', { method: 'POST', body: JSON.stringify({ config }) });
      S.siteConfig = d.config || config;
      return d;
    },
    async siteUpload(payload) {
      const d = await jfetch('/api/site/upload', { method: 'POST', body: JSON.stringify(payload) });
      return d;
    },
    async siteRemote(query) {
      const d = await jfetch('/api/site/remote' + q(query || {}));
      return d;
    },
    async siteListArchive(modId) {
      return await jfetch('/api/mod:list-archive', { method: 'POST', body: JSON.stringify({ id: modId }) });
    },

    /* 引擎重载（启用 mod 后重新载入世界） */
    async reload() {
      const d = await jfetch('/api/reload', { method: 'POST', body: JSON.stringify({}) });
      if (d.view) S.view = d.view;
      return d;
    },

    /* 底层透传，便于扩展 */
    jfetch,
    q
  };

  /* ---------------- 小工具 ---------------- */
  const util = {
    /** HTML 转义 */
    esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },
    /** 把 log 数组拼成 HTML */
    logToHtml(lines) {
      return (lines || []).map(l => {
        if (typeof l === 'string') return '<div class="log-line plain">' + util.esc(l) + '</div>';
        const cls = 'log-line ' + (l.type || 'plain');
        return '<div class="' + cls + '">' + util.esc(l.text || '') + '</div>';
      }).join('');
    },
    /** 数值区间 -> 百分比 */
    pct(a, b) {
      if (!b || b <= 0) return 0;
      return Math.max(0, Math.min(100, Math.round(a / b * 100)));
    },
    /** 用分隔符拼接 */
    nl(arr) { return (arr || []).filter(Boolean).join('、'); },
    /** 简易节流 */
    throttle(fn, ms) {
      let t = 0, timer = null, lastArgs = null;
      return function () {
        lastArgs = arguments;
        const now = Date.now();
        if (now - t >= ms) { t = now; fn.apply(null, lastArgs); }
        else if (!timer) {
          timer = setTimeout(() => { timer = null; t = Date.now(); fn.apply(null, lastArgs); }, ms - (now - t));
        }
      };
    },
    /** 防抖 */
    debounce(fn, ms) {
      let timer = null;
      return function () {
        const args = arguments, self = this;
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(self, args), ms);
      };
    },
    /** 生成短 id */
    slug(s, fallback) {
      const out = String(s || '').trim().toLowerCase()
        .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return out || (fallback || ('id_' + Math.random().toString(36).slice(2, 8)));
    },
    /** 深拷贝 */
    clone(o) { return JSON.parse(JSON.stringify(o)); },
    /** 深合并（数组默认替换） */
    merge(base, over, arrayMode) {
      if (over === undefined) return util.clone(base);
      if (base === null || typeof base !== 'object' || Array.isArray(base)) return util.clone(over);
      if (over === null || typeof over !== 'object' || Array.isArray(over)) return util.clone(over);
      const out = util.clone(base);
      Object.keys(over).forEach(k => {
        const bv = out[k], ov = over[k];
        if (Array.isArray(bv) && Array.isArray(ov)) {
          if (arrayMode === 'append') out[k] = bv.concat(util.clone(ov));
          else if (arrayMode === 'prepend') out[k] = util.clone(ov).concat(bv);
          else out[k] = util.clone(ov);
        } else if (bv && ov && typeof bv === 'object' && typeof ov === 'object') {
          out[k] = util.merge(bv, ov, arrayMode);
        } else {
          out[k] = util.clone(ov);
        }
      });
      return out;
    },
    /** 时间戳 -> 本地时间串 */
    fmtTime(ts) {
      const d = new Date(ts);
      const p = n => String(n).padStart(2, '0');
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
        p(d.getHours()) + ':' + p(d.getMinutes());
    },
    /** 星期中文 */
    weekCN(ts) {
      return '日一二三四五六'[new Date(ts).getDay()];
    },
    /** 从文件中读取文本（含 zip） */
    readTextFile(accept) {
      return new Promise((resolve, reject) => {
        const inp = document.createElement('input');
        inp.type = 'file';
        if (accept) inp.accept = accept;
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return reject(new Error('未选择文件'));
          const fr = new FileReader();
          fr.onload = () => resolve({ name: f.name, text: String(fr.result || ''), file: f });
          fr.onerror = () => reject(new Error('读取文件失败'));
          fr.readAsText(f, 'utf-8');
        };
        inp.click();
      });
    },
    /** 下载文本为文件 */
    downloadText(name, text, mime) {
      const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    /** 下载 base64 为文件 */
    downloadB64(name, b64, mime) {
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    },
    /** 从路径取文件名 */
    basename(p) { return String(p || '').split(/[\\/]/).pop(); },
    /** 数组去重 */
    uniq(arr) { return Array.from(new Set(arr || [])); },
    /** 转义正则 */
    reEsc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  };

  /* ---------------- 简易事件总线 ---------------- */
  const bus = (function () {
    const map = {};
    return {
      on(ev, fn) { (map[ev] = map[ev] || []).push(fn); return () => bus.off(ev, fn); },
      off(ev, fn) { if (!map[ev]) return; map[ev] = map[ev].filter(f => f !== fn); },
      emit(ev, payload) { (map[ev] || []).slice().forEach(f => { try { f(payload); } catch (e) { console.error(e); } }); }
    };
  })();

  /* ---------------- 加载本地偏好 ---------------- */
  loadSettings();
  S.deviceId = getDeviceId();

  /* ---------------- 导出 ---------------- */
  global.WX = { S, api, util, bus, saveSettings, setMe, jfetch, q, getDeviceId };

})(window);
