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
      narrow: false,
      /* 界面配色：`dark`（默认，主人 2026-10-11 要的整页暗）/ `light`。
         老存档里没有这一项 —— ui.js 的 themeOf() 一律当 dark，也就是新默认。 */
      theme: 'dark',
      /* P0-C C-1「地图显示未探索地名」：**默认关** ⇒ 未探索的地块只显示留白，
         不剧透名字与出口（后端 fog=1）。
         ⚠️ 老存档的 localStorage 里没有这一项 —— `loadSettings` 用的是
            `Object.assign(S.settings, 存档)`，缺的键自动吃到这里的默认值 `false`，
            不需要写迁移。 */
      mapnames: false
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
  /**
   * 视图替换的守卫（唯一入口，别在 api 各方法里自己 `S.view = d.view`）。
   *
   * 为什么要有：线上沙箱闲置会回收进程，重启后服务端 `world.player` 为 null，
   * 这时调用**任何**接口回来的都是「没有角色的视图」。原先十来处写法都是
   * 「只要回来的对象带 view 就直接赋值」，会把有角色的视图盖成空视图 ——
   * 玩家看到名字消失、属性归零，外加一句「请先创建角色」（主人亲报）。
   *
   * 规矩：**没有角色的视图不许覆盖有角色的视图**；反过来（本来就没角色）照常。
   * 真把角色弄丢了，由 ui.js 的 `recoverLostPlayer()` 负责接人。
   */
  function keepView(d) {
    if (d && d.view && (d.view.player || !(S.view && S.view.player))) S.view = d.view;
    return d;
  }

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
      keepView(d);
      return d;
    },

    /* 执行任意指令 */
    async exec(cmd) {
      const d = await jfetch('/api/exec', { method: 'POST', body: JSON.stringify({ cmd }) });
      keepView(d);
      return d;
    },

    /* 新手教程标记上报：面板类指令不进 exec，后端收不到动作，
       由前端在这里补报（详见 ui.js doCmd 的面板分支） */
    async markGuide(flag) {
      try {
        const d = await jfetch('/api/guide/mark', { method: 'POST', body: JSON.stringify({ flag }) });
        keepView(d);
        return d;
      } catch (e) {
        /* 上报失败不该影响玩家看面板，静默忽略 */
        return null;
      }
    },

    /* 弹窗中的选项（对话树 / 商店 / 出厂菜单等） */
    async menu(payload) {
      const d = await jfetch('/api/menu', { method: 'POST', body: JSON.stringify(payload) });
      keepView(d);
      return d;
    },

    /* 战斗动作 */
    async combat(payload) {
      const d = await jfetch('/api/combat', { method: 'POST', body: JSON.stringify(payload || {}) });
      keepView(d);
      return d;
    },

    /* 通用快捷动作（右侧场景栏点击人物 / 物品） */
    async quick(action, uid, extra) {
      const d = await jfetch('/api/quick', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action, uid }, extra || {}))
      });
      keepView(d);
      return d;
    },

    /* 视图切换（不发指令，只重新取一份渲染数据） */
    /* ⚠️ P0-C C-1：`opts` 是分批 / 迷雾的开关（`region` / `neighbors` / `fog`）。
       不传 ⇒ 服务端走 P0-B 的老路径，行为一个字节不变；
       只有「地图」面板会传（见 ui.js 的 `panel('map')`）。
       ⚠️ 为什么签名是 `(panel, opts)` 而不是多传几个位置参数：
          回归里有四套（`smoke-mapui` / `smoke-map-layer-filter` /
          `smoke-round2-map` / `smoke-uiux`）把 `api.view` 整体 stub 成
          `async (p) => ...`，只吃第一个参数 —— 保持第一个参数是 panel，
          那些 stub 就还能继续工作，不至于为了加功能把别人的测试全掀了。 */
    async view(panel, opts) {
      const d = await jfetch('/api/view' + q(Object.assign({ panel }, opts || {})));
      keepView(d);
      return d;
    },

    /* 某个 NPC 的详情画像（点「细看此人」时按需拉，不塞进每次 exec 的 view 里） */
    async npcProfile(uid) {
      return await jfetch('/api/npc', { method: 'POST', body: JSON.stringify({ uid }) });
    },

    /* 某个 NPC 的「请教武学」清单（点「请教武学」时开新界面，列出他所有武学） */
    async teach(uid) {
      return await jfetch('/api/teach', { method: 'POST', body: JSON.stringify({ uid }) });
    },


    /* 某个 NPC 的「询问」数据（view 瘦身懒加载：话题 + 他认识的人，点「询问」时拉） */
    async ask(uid) {
      return await jfetch('/api/ask', { method: 'POST', body: JSON.stringify({ uid }) });
    },

    /* 某个任务的详情（点「接取任务」时先弹详情页，玩家看过再决定接不接） */
    async questPreview(qid) {
      return await jfetch('/api/quest', { method: 'POST', body: JSON.stringify({ qid }) });
    },

    /* 存档 */
    async saves() { return await jfetch('/api/saves'); },
    async save(id) { const d = await jfetch('/api/save', { method: 'POST', body: JSON.stringify({ id }) }); return d; },
    async load(id) { const d = await jfetch('/api/load', { method: 'POST', body: JSON.stringify({ id }) }); keepView(d); return d; },
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
      keepView(d);
      return d;
    },
    async modOrder(order) {
      const d = await jfetch('/api/mod:order', { method: 'POST', body: JSON.stringify({ order }) });
      S.modList = d.mods || S.modList;
      keepView(d);
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
      keepView(d);
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
      /* 上传必须带登录 token（主人 2026-10-11：一键上传要登录才能用）。
         token 存在 S.my 里（localStorage），不再让玩家临时填个昵称就发。 */
      const body = Object.assign({}, payload, { token: (S.my && S.my.token) || '' });
      const d = await jfetch('/api/site/upload', { method: 'POST', body: JSON.stringify(body) });
      return d;
    },

    /* ---- 本站账号（登录 / 注册 / 登出 / 我的作品）----
       走的是游戏服 → Mod 站点的转发，前端只需要认 `ok` 与 `needLogin`。 */
    async account(action, payload) {
      const d = await jfetch('/api/site/account', {
        method: 'POST',
        body: JSON.stringify(Object.assign({ action }, payload || {})),
      });
      return d;
    },
    async accountMine() {
      const d = await jfetch('/api/site/account?action=mods&token=' +
        encodeURIComponent((S.my && S.my.token) || ''));
      return d;
    },

    /* 游戏内各类事物的 ID（制作器「游戏内 ID」用；带 id 就取那一件的完整内容） */
    async gamedata(kind, opts) {
      try {
        return await jfetch('/api/gamedata' + q(Object.assign({ kind }, opts || {})));
      } catch (e) {
        /* 读不到就回一个 ok:false —— 制作器那边统一按「读不到」渲染，
           不要让异常冒到调用点去（那会变成一个没有提示的空白页）。 */
        return { ok: false, error: e.message || String(e) };
      }
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
      /* 🔴 **只在「新视图真的有角色」时才替换当前视图**。
         原先是无条件 `S.view = d.view`：一旦后端因读档失败返回了「没有玩家」的视图
         （历史上 engine.reload 会静默吞掉读档异常），顶栏立刻变成
         「名字空 / 气血 0/1 / 内力 0/1 / 金钱 undefined 文」——
         主人亲报的现象就是这么来的。宁可**保留旧视图**，也别把界面渲染成假的。 */
      if (d && d.view && d.view.player) S.view = d.view;
      else if (d && d.ok === false) {
        /* 后端已经退回旧世界了，这里只提示，不动视图 */
        try { if (global.WXUI && WXUI.toast) WXUI.toast('重载失败，已保留原进度：' + (d.error || '未知原因'), 'error', 4000); } catch (e) { /* 提示失败不影响主流程 */ }
      }
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
    /** 超长数字缩写显示（design/99 定案：天文经验曲线速率自洽、只是显示崩，
       比换曲线便宜 —— 显示层缩写，真实数值不动）。
       < 10000 原样；≥ 万 → 12.4万（一位小数，去尾零）；≥ 亿 → 1.2亿。 */
    fmtBig(n) {
      n = Math.floor(Number(n) || 0);
      if (n < 10000) return String(n);
      const trim = x => String(x).replace(/\.0$/, '');
      if (n < 1e8) return trim(Math.round(n / 1000) / 10) + '万';
      return trim(Math.round(n / 1e7) / 10) + '亿';
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
