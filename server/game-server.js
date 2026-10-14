/**
 * server.js — 本地游戏服务（零依赖，仅用 Node 内置模块）
 *
 * 启动后浏览器打开 http://127.0.0.1:PORT 即可游玩。
 * 同时提供 REST API 给前端调用。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const GAME_DIR = path.join(ROOT, 'game');
const { GameEngine } = require(path.join(GAME_DIR, 'src', 'core', 'engine.js'));
const zipmini = require(path.join(GAME_DIR, 'src', 'core', 'zipmini.js'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8',
  '.zip': 'application/zip', '.webmanifest': 'application/manifest+json',
};

function json(res, code, data) {
  const body = Buffer.from(JSON.stringify(data), 'utf8');
  /* ---- 回包 gzip（2026-10-11）----
     主人报「每走一步、每点一个按钮都卡顿」。查下来**服务端只花 1.3 ms**，
     卡的是**回包体积**：一张地图 276 KB，整包 310 KB，而且一直没开压缩。
     中文 JSON 的键名大量重复，gzip 压得极狠（实测能压到十分之一上下），
     远端（手机网络）这一下就是几百毫秒的差别。

     ⚠️ 三条边界：
       · 小于 1 KB 的包不压 —— 压缩本身有开销，小包压了反而更慢更大；
       · 客户端没报 `gzip` 就不压（老浏览器 / 某些代理会去掉这个头），并且回
         `Vary: Accept-Encoding`，免得中间层把「压缩版」缓存给了不支持的客户端；
       · `Content-Length` 必须改成压缩后的长度 —— 写错会让浏览器**一直等剩余字节**
         （表现为「页面卡住不动」，比不压缩还糟）。 */
  const ae = (res.req && res.req.headers && res.req.headers['accept-encoding']) || '';
  if (body.length >= 1024 && /\bgzip\b/.test(ae)) {
    const gz = zlib.gzipSync(body, { level: 5 });
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Encoding': 'gzip',
      'Content-Length': gz.length,
      'Cache-Control': 'no-store',
      'Vary': 'Accept-Encoding',
    });
    res.end(gz);
    return;
  }
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, maxSize) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > (maxSize || 64 * 1024 * 1024)) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* 缓存策略：代码类资源一律不缓存。
 *
 * 血泪教训：之前只有 .html 是 no-store，.js/.css 给了 max-age=300。
 * 结果发版后浏览器刷新页面拿到了新 HTML，却继续跑缓存里的旧 ui.js，
 * 旧代码的 bug 反复报错，用户以为「改了没用」。
 * 游戏本身就是本地/在线随手可重载，缓存收益极低、出错代价极高 —— 全部 no-store。 */
function cacheHeaderFor(ext) {
  const NO_CACHE = ['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map'];
  if (NO_CACHE.indexOf(ext) >= 0) {
    return 'no-store, no-cache, must-revalidate';
  }
  // 图片 / 字体 / 音频等静态素材可以短缓存，出问题重载一次即可
  return 'public, max-age=300';
}

/* 带版本戳的 URL 可以放心长缓存（2026-10-11 主人报「进游戏慢、点按钮卡」）。
 *
 * 为什么敢改上面那条「一律 no-store」：
 *   那条规矩治的是「发了版浏览器还跑旧 ui.js」——根子是**URL 没变**。
 *   而 index.html 里给每个 js 都挂了 `?v=20261011x`：发版改了 v，URL 就变了，
 *   浏览器必然重新拉。也就是说**只要 URL 带 v=，长缓存不会造成跑旧代码**。
 *   css/main.css 没挂 v=，所以它照旧 no-store —— 绝不拿它冒险。
 *
 * 收益：ui.js 224 KB / modmaker 80 KB 这些每次进游戏都要重下的东西，
 *       第一次之后直接走本地缓存（0 字节）。 */
function isVersioned(urlStr) { return /[?&]v=/.test(String(urlStr || '')); }

/* 需要 gzip 的文本类型（二进制压了反而更大，直接跳过） */
const GZIP_EXT = ['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map',
  '.svg', '.txt', '.md', '.webmanifest', '.xml'];

/* 允许「版本戳 URL 长缓存」的类型。刻意不含 .html：
   HTML 是入口，宁可每次校验一下（它才几 KB），也别让玩家卡在旧壳子里。 */
const CACHEABLE_EXT = ['.js', '.mjs', '.css', '.svg', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.jpeg', '.gif', '.ico'];

function serveStatic(req, res, baseDir, relPath) {
  let p = path.normalize(path.join(baseDir, decodeURIComponent(relPath)));
  if (!p.startsWith(baseDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found: ' + relPath); return; }
  const ext = path.extname(p).toLowerCase();
  const stat = fs.statSync(p);
  const type = MIME[ext] || 'application/octet-stream';
  /* 版本戳 URL（且是代码/文本类）→ 长缓存；其余照旧走 no-store */
  const cache = (isVersioned(req.url) && CACHEABLE_EXT.indexOf(ext) >= 0)
    ? 'public, max-age=31536000, immutable'
    : cacheHeaderFor(ext);
  // 范围请求（音频等）
  const range = req.headers.range;
  if (range && /^bytes=/.test(range)) {
    const [s, e] = range.replace('bytes=', '').split('-');
    const start = parseInt(s, 10) || 0;
    const end = e ? parseInt(e, 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Content-Length': end - start + 1,
    });
    fs.createReadStream(p, { start, end }).pipe(res);
    return;
  }
  /* ---- 静态资源 gzip（2026-10-11）----
     实测：ui.js 224 KB → 75 KB，main.css 112 KB → 29 KB。
     ⚠️ 与 Range 二选一 —— 上面已经 return 走了，压过的流给不出正确字节区间。
     ⚠️ 小于 1 KB 的、以及二进制素材不压。 */
  const ae = req.headers['accept-encoding'] || '';
  if (stat.size >= 1024 && /\bgzip\b/.test(ae) && GZIP_EXT.indexOf(ext) >= 0) {
    const gz = zlib.gzipSync(fs.readFileSync(p), { level: 5 });
    res.writeHead(200, {
      'Content-Type': type, 'Content-Encoding': 'gzip', 'Content-Length': gz.length,
      'Cache-Control': cache, 'Vary': 'Accept-Encoding',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    res.end(gz);
    return;
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cache, 'Vary': 'Accept-Encoding' });
  if (req.method === 'HEAD') { res.end(); return; }
  fs.createReadStream(p).pipe(res);
}

/* ------------------------------------------------------------------ *
 * 创建服务器
 * ------------------------------------------------------------------ */
function createServer(opts) {
  opts = opts || {};
  const worldName = opts.worldName || 'wuxia-world';
  const userDataDir = path.join(GAME_DIR, 'userdata', worldName);
  const engine = new GameEngine({ projectRoot: ROOT, userDataDir });
  const bootInfo = engine.boot();

  const server = http.createServer(async (req, res) => {
    const u = url.parse(req.url, true);
    let pn = u.pathname;
    try {
      // ---------- API ----------
      if (pn.startsWith('/api/')) {
        return await handleApi(engine, req, res, pn, u.query);
      }
      // ---------- Mod 网站（如果存在） ----------
      if (pn.startsWith('/mods-site')) {
        const rel = pn.replace('/mods-site', '') || '/';
        return serveStatic(req, res, path.join(ROOT, 'server', 'public'), rel);
      }
      // ---------- Mod 网站 API 代理到站点后端 ----------
      // ---------- 静态资源 ----------
      let rel = pn === '/' ? '/index.html' : pn;
      // 游戏前端
      if (rel.startsWith('/game/')) return serveStatic(req, res, GAME_DIR, rel.replace('/game/', '/'));
      // mods 目录（mod 图标等）
      if (rel.startsWith('/modfiles/')) return serveStatic(req, res, path.join(ROOT, 'mods'), rel.replace('/modfiles/', '/'));
      /* ⚠️ /saves/** 静态读取**默认关闭**，要开必须显式设 `WX_ALLOW_SAVES=1`。
         为什么这样定：
           · 公网部署时 `saves/` 是**所有访问者共用的服务端目录**（自动存档按设备 id 落盘），
             无条件开放 = 把玩家存档挂在公网 URL 上。实测线上
             `GET /saves/test_slot.json` 返回 **200**，猜到文件名就能取到。
           · 前端**从不请求**这个路径（读档走 `/api/load`、存档走 `/api/save`），
             所以关掉它对游戏零影响。
           · 为什么不用「来源是 127.0.0.1 才放行」：线上是反向代理，
             代理与源站同机 ⇒ `socket.remoteAddress` 也是回环，**判定会失效**。
             按「默认拒绝 + 显式开关」才在构造上安全。
         本机单人想直接 curl 自己的存档时，启动前设 WX_ALLOW_SAVES=1 即可。 */
      if (rel.startsWith('/saves/')) {
        if (process.env.WX_ALLOW_SAVES !== '1') return json(res, 404, { ok: false, error: '未找到' });
        return serveStatic(req, res, path.join(ROOT, 'saves'), rel.replace('/saves/', '/'));
      }
      return serveStatic(req, res, path.join(GAME_DIR, 'src', 'renderer'), rel);
    } catch (e) {
      console.error('[server error]', e);
      if (!res.headersSent) json(res, 500, { ok: false, error: String(e && e.message || e) });
      else res.end();
    }
  });

  server.on('error', (e) => {
    console.error('服务启动失败:', e.message);
  });

  /* ---- 兜底存档（_live）：防「闲置被回收 → 玩家角色凭空消失」 ----
     线上沙箱闲置会回收进程，世界全在内存里，重启后 world.player 就是 null，
     而玩家浏览器那一页还开着 —— 下一条指令就变成「请先创建角色」+ 属性归零。
     这里每分钟把当前世界落一次盘；进程重启后第一次收请求时由
     `engine.restoreLive()` 接回来（见下方 handleApi 开头）。
     ⚠️ 不用 unref()：这个定时器就是进程的「心跳」，不该让进程因为无事可做而退出。 */
  const liveTimer = setInterval(() => {
    try { engine.saveLive(); } catch (e) { /* 存不上不该拖垮服务 */ }
  }, 60 * 1000);

  /* 收到终止信号时抢最后一次（沙箱是 SIGTERM 停容器，给的时间不长，所以只做一次同步写） */
  const flushLive = () => {
    try { engine.saveLive(); } catch (e) { /* ignore */ }
  };
  process.once('SIGTERM', flushLive);
  process.once('SIGINT', flushLive);

  // 启动时如果本来就没有玩家、但有兜底档，直接接回来（页面刷新也不用重开）
  try { if (!engine.world.player) engine.restoreLive(); } catch (e) { /* 接不回来就走正常开局 */ }

  return { server, engine, bootInfo, userDataDir, liveTimer };
}

/* ------------------------------------------------------------------ *
 * API 路由
 * ------------------------------------------------------------------ */
async function handleApi(engine, req, res, pn, query, preset) {
  const route = pn.replace('/api/', '');
  const method = req.method;

  /* ---- 进程被回收过 → 先把玩家接回来 ----
     闲置回收是线上真事：容器一重启，内存里的世界就没了。
     ⚠️ **只认「玩家真的动手了」的那几条路由**（走一步 / 开面板 / 打一拳 / 点快捷 / 选菜单），
        不认任何**只读**路由（`boot` / `births` / `saves` / `view` / `quest` / `npc`）。
        理由有二：
          ① 一次「查一下这个任务详情」不该有副作用 —— 它把整份存档接回来是**读操作写出状态**；
          ② 没有玩家的时候，那些路由本来就该照实回「未起局」。
             （`smoke-server-guard` 的 ④-a 正是守这条：未起局 `/api/quest` 要回 404 而不是 200。）
        也不认 `new` —— 玩家明确要新开一局。 */
  const LIVE_ROUTES = ['exec', 'panel', 'combat', 'quick', 'menu', 'guide/mark'];
  if (LIVE_ROUTES.indexOf(route) >= 0 && !engine.world.player) {
    let revived = false;
    try { revived = !!engine.restoreLive().ok; } catch (e) { /* 接不回来按原样走，前端会给出提示 */ }
    /* 每一条指令都存一次太重，这里只在「刚接回来」时补一次 */
    if (revived) { try { engine.saveLive(); } catch (e) { /* ignore */ } }
  }

  let json_body = null;
  if (preset) {
    json_body = preset;
  } else {
    const body = (method === 'POST' || method === 'PUT') ? await readBody(req) : null;
    if (body && body.length) {
      const ct = req.headers['content-type'] || '';
      if (ct.includes('application/json')) {
        try { json_body = JSON.parse(body.toString('utf8')); } catch (e) { return json(res, 400, { ok: false, error: 'JSON 解析失败: ' + e.message }); }
      }
    }
  }

  /* 内部命令（编辑器 / 站点代理）通过 /api/exec 转发；如果 cmd 正好是这类路由，
     直接在这里转发到 handleApi，避免被当成游戏指令吃掉 */
  if (route === 'exec') {
    const c0 = (json_body && (json_body.cmd || json_body.command)) || query.cmd || query.command || '';
    if (typeof c0 === 'string') {
      if (c0.indexOf('editor/') === 0 || c0.indexOf('site/') === 0) {
        return handleApi(engine, req, res, '/api/' + c0, query, json_body);
      }
      /* panel/xxx -> 打开面板，转成游戏指令 */
      if (c0.indexOf('panel/') === 0) {
        const panel = c0.slice(6);
        const r = engine.exec('__panel__' + panel, {});
        return json(res, 200, { ok: true, cmd: c0, lines: r.lines || [], log: r.lines || [], action: r.action || 'panel', openPanel: panel, choices: null, modal: null, ending: null, view: r.view || engine.view({ map: false }) });
      }
    }
  }

  try {
    switch (route) {
      /* --- 状态 --- */
      /* --- 状态 ---
         ⚠️ P0（2026-10-12）· 死路由的两个出路里，这里选**留着 + 去地图**，理由写清楚：
           ① 它**没有生产调用方** —— 前端 `api.state()`（app.js）定义着但没人调用。
              真要删就得前后端一起删（「删干净」），否则留下半边更让人困惑。
           ② 但 `tools/smoke-server-guard.js` 明确把它列进「不许 5xx」的探针名单。
              真删掉 ⇒ 该路由变成未命中 ⇒ 要么我回头去改那个测试的期望值，
              要么 guard 直接红；为了一次纯性能修复去改别人的测试口径，风险更大。
           ③ 留着并把 `view()` 换成 `view({ map: false })`，**性能收益完全相同**
              （它本来也几乎不被调用；万一哪天被调，也不会再甩出 247 KB 的地图）。
           结论：留它、瘦身，比删它划算。等 P1 做路由清理时连同 `api.state()` 一起收。 */
      case 'state': return json(res, 200, { ok: true, boot: engine.bootLog, view: engine.view({ map: false }), meta: engine.world.data.meta });

      /* --- 启动信息（前端启动时拉一次） --- */
      case 'boot': return json(res, 200, {
        ok: true,
        title: engine.world.data.meta.title,
        version: engine.bootLog && engine.bootLog.version || '1.0.0',
        stats: countWorld(engine),
        /* 合并部署（`combined.js` 起了 Mod 站）时，把 Mod 站的地址一起告诉前端 ——
           游戏页据此在顶栏挂一个「⌂ Mod 客栈」的回站入口：Mod 站那边有「▶ 开始游戏」，
           这边也该有路回去，两边才像一家，而不是两个互不相干的站。
           ⚠️ 单独跑 `game-server.js` 时 `COMBINED` 没设 → 这里是 null，
           前端就不注入，免得玩家点到一个 404 的死链。
           ⚠️ 判据必须**在请求里读**环境变量（不能在模块顶部缓存成常量）：
           `combined.js` 是先 require 本模块、随后才设 `process.env.COMBINED = '1'`。 */
        site: (process.env.COMBINED === '1') ? { url: '/site/', name: 'Mod 客栈' } : null,
        warnings: (engine.bootLog && engine.bootLog.warnings) || [],
        mods: (engine.bootLog && engine.bootLog.mods) || [],
      });

      /* --- 重载（启用/禁用 mod 后） --- */
      case 'reload': {
        /* ⚠️ 把 reload 的结果**如实带出去**：读档失败时 `engine.reload()` 会退回旧世界
           （玩家不丢），但必须让前端知道「mod 没换成」。原先把返回值丢掉、恒报 ok:true，
           于是失败被完全吞掉 —— 玩家只看到界面莫名变空。 */
        const rr = engine.reload();
        return json(res, 200, {
          ok: !(rr && rr.ok === false),
          error: (rr && rr.error) || undefined,
          mods: (rr && rr.mods) || 0,
          /* ⚠️ P0-C：这里原本是全站**最后一条**还在无条件下发全量地图（约 212 KB）的路由。
             低频动作（只在 Mod 管理页点一次），砍掉它对单步性能是零收益 ——
             砍它的真正理由是**不留例外**：留着「唯一一条还在发全图的路」，
             以后任何人改地图取数都会漏掉它，然后再花两小时找「怎么还有一条路在发 212 KB」。

             ⚠️ 这里**不能**像 `afterAction` 那样「沿用上一次的地图」：
             `afterAction` 走一步棋，世界结构不会变，沿用旧地图只是晚一代、无害；
             而 `reload` 是**重新载入世界数据**，mod 一换房间就可能增删 ——
             沿用旧地图等于把一份**结构上已经过期**的地图塞回前端，那是错的。
             所以这里就让它为 undefined：前端下次开「地图」面板会走 `/api/view?panel=map`
             重新取一份新的（见 `panel()` 里的回写）。

             前端读点已 grep 确认：只有 `app.js:352` 的 `S.view = d.view` 整包赋值，
             没有任何代码直接读这里的 `d.view.map`；间接读点 `ui.js:3558`（点格子弹地名）
             位于地图面板内部，面板打开时必然已重新取过地图，且有 `S.view.map &&` 空值守卫。 */
          boot: engine.bootLog, view: engine.view({ map: false }), stats: countWorld(engine),
        });
      }

      /* --- 开局 --- */
      case 'new': {
        /* ⚠️ 「身份 × 性别不符」是**用户输入问题**，不是服务端故障 ——
           `World.createPlayer` 会为准性别不对的身份抛错（前端藏起来只是第一道，
           手搓请求绕得过去）。若不在这里拦，异常会冒到外层 catch 变成 **500**：
           既误导排查（看着像服务器崩了），又踩本项目「未起局不许 5xx」的守卫。
           所以：校验类失败一律回 **400 + 人话**。 */
        try {
          return json(res, 200, { ok: true, view: engine.newGame(json_body || {}) });
        } catch (err) {
          return json(res, 400, { ok: false, error: String((err && err.message) || err) });
        }
      }

      case 'births': {
        const meta = engine.world.data.meta;
        const raw = meta.births || {};
        /* 前端按数组消费，这里统一转成数组 */
        const list = Array.isArray(raw)
          ? raw
          : Object.keys(raw).map(id => Object.assign({ id }, raw[id]));
        const traits = engine.world.data.traits || {};
        const traitsList = Array.isArray(traits)
          ? traits
          : Object.keys(traits).map(id => Object.assign({ id }, traits[id]));
        /* 把赠品/起始武学/天赋的英文 id 转成中文名，前端直接展示 */
        const itemsData = engine.world.data.items || {};
        const skillsData = engine.world.data.skills || {};
        const traitsData = engine.world.data.traits || {};
        list.forEach(b => {
          if (Array.isArray(b.items)) b.items = b.items.map(id => (itemsData[id] && itemsData[id].name) || id);
          if (Array.isArray(b.skills)) b.skills = b.skills.map(id => (skillsData[id] && skillsData[id].name) || id);
          if (Array.isArray(b.traits)) b.traits = b.traits.map(id => (traitsData[id] && traitsData[id].name) || id);
        });
        return json(res, 200, {
          ok: true,
          births: list,
          attrs: engine.world.data.attrs || [],
          traits: traitsList,
          title: meta.title,
        });
      }

      /* --- 指令 --- */
      case 'exec': {
        const cmd = (json_body && (json_body.cmd || json_body.command)) || query.cmd || query.command || '';
        const r = engine.exec(cmd, {});
        /* ⚠️ P0（2026-10-12）：**`log` 字段删掉了**。
           原来写的是 `lines: r.lines, log: r.lines` —— 同一个数组发两遍，
           实测开局那一步各 6.4 KB，回包 41.6 KB 里有 **6.4 KB 是纯重复**。
           删了以后：
             · `ui.js` 的 `afterAction` 先读 `d.log`、没有再读 `d.lines`（4052 行起）——
               留着 `lines` 这条路照走，**行为零变化**；
             · `start.js:411` 的 `(d.view && d.view.lines) || d.log || []` 第一优先也是
               `view.lines`，落不到 `d.log` 上。
           顺带把「为什么回包能到 40 KB」的答案钉在这儿：单步回包 = view 28.6 KB
           + lines 6.4 KB（+ 原先重复的那份 log 6.4 KB）——地图并不是唯一的大头。 */
        /* ⚠️ P0（2026-10-12）第二刀：`view.lines` 从**指令回包**里剥掉（-5.2 KB）。
           为什么可以剥、且不损任何信息：
             · `view.lines` 是「当前房间的描述」，`lines` 是「这次指令的结果」，两者不同内容；
             · 全工程读 `view.lines` 的只有 `start.js` 两处（91 行 `continueGame` 读档后、
               414 行开局后），**都在刚进游戏的那一刻**，而那一刻的数据来自
               `/api/new` 与 `/api/load` —— 这两个路由仍然发完整 view（含 lines）；
             · `ui.js` 全文不读 `view.lines`（逐个文件 grep 复核过），走路时用不到它。
           所以剥掉它，玩家看到的字一个不少，回包从 34.8 KB 降到 ~29.6 KB。
           用浅拷贝而不是改 `r.view` 本体：那是 `engine.exec` 的产物，别就地糟蹋。 */
        const execView = r.view ? Object.assign({}, r.view) : r.view;
        if (execView) delete execView.lines;
        return json(res, 200, {
          ok: true, cmd, lines: r.lines, clear: !!r.clear,
          action: r.action || null, openPanel: r.openPanel || null,
          choices: r.choices || null, choicesTitle: r.choicesTitle || null,
          modal: r.modal || null, ending: r.ending || null, view: execView,
          /* 角色不在（多半是进程被回收过）→ 前端据此去接人，**别拿空视图覆盖界面** */
          noPlayer: r.noPlayer || false,
          canRestore: r.canRestore || false,
        });
      }

      /* --- 打开面板（前端 /api/panel 或 /api/exec {cmd:'panel/xxx'}） --- */
      case 'panel': {
        const name = (json_body && json_body.panel) || query.panel || '';
        const r = engine.exec('__panel__' + name, {});
        return json(res, 200, { ok: true, action: 'panel', openPanel: name, lines: r.lines || [], log: r.lines || [], choices: null, modal: null, ending: null, view: r.view || engine.view({ map: false }) });
      }

      case 'menu': {
        const r = engine.menuPick(json_body || {});
        return json(res, 200, { ok: true, lines: r.lines, view: r.view });
      }

      /* --- 新手教程标记上报 ---
         面板类指令（i/score/attr）在前端被拦成面板，不走 exec，
         后端收不到动作，所以前端显式补报。只接受白名单里的 flag。 */
      case 'guide/mark': {
        const flag = json_body && json_body.flag;
        const ok = engine.markTutorialFlag(flag);
        return json(res, 200, { ok: !!ok, view: engine.view({ map: false }) });
      }

      /* --- 战斗 --- */
      case 'combat': {
        const r = engine.combatAction((json_body && json_body.action) || 'attack', json_body || {});
        return json(res, 200, { ok: true, lines: r.lines, view: r.view });
      }

      /* --- 快捷操作 --- */
      case 'quick': {
        // 一键常用动作：装备/使用/拾取/查看
        const act = json_body && json_body.action;
        const uid = json_body && json_body.uid;
        const map = { equip: 'wear', use: 'use', drop: 'drop', look: 'look' };
        return json(res, 200, (() => {
          const r = engine.exec(`${map[act] || act}__uid__${uid}`, {});
          return { ok: true, lines: r.lines, view: r.view };
        })().valueOf());
      }

      /* 视图切换（不发指令，只重新取一份渲染数据给某个面板）。
         🔴 2026-10-11 主人报「点一个按钮就卡」—— 元凶就在这一行：
           旧写法 `engine.view({ map: true })` **不管开的是哪个面板都拖着整张地图**
           （276 KB，占整包 88%），于是点「行囊」也要下载、解析一张舆图。
           现在只在**真要地图**时才带上（前端开地图面板用的就是 `panel: 'map'`）。
           其余面板拿到的 view 不带 map —— 前端 `afterAction` 会沿用上一份地图，
           地图数据是「已探索到哪」的快照，晚一代不影响面板点格子。 */
      case 'view': {
        /* ⚠️ 这份名单**必须**跟「真的会用到 v.map 的面板」对齐：
           少一个 → 那个面板的视图里没有地图数据，前端只能拿上一份缓存或渲染成空，
           而且**不报错**（静默退化）。2026-10-12 加「飞行」面板时同步加进来了。 */
        const wmPanel = String((json_body && json_body.panel) || query.panel || '').toLowerCase();
        const wantMap = wmPanel === 'map' || wmPanel === 'fly';
        /* ⚠️ P0-B B-2（2026-10-13）：几何四件套（cells / regionBoxes / bounds / terrain，
           合计 77.6 KB）**只给地图面板**。「飞行」面板只列区域与飞行代价，
           一个几何字段都不读，跟着一起发是白交 77.6 KB。 */
        const wantGeometry = wmPanel === 'map';
        /* ⚠️ P0-C C-1（2026-10-13）：分批与迷雾，一律 **opt-in**。
           · `region=auto` ⇒ 只发玩家当前所在的州（+ 邻州，见下）。
             ⚠️ 为什么只能是 `auto` 而不是前端传州名：P0 之后指令回包 / 开局 /
                读档都不再下发地图，前端 `S.view.map` 是空的，它压根不知道自己在哪。
           · `neighbors=0` ⇒ 连邻州都不带（前端现在只画本州本层，邻州一根线都画不出来，
                实测江南城带邻州是 17 州 234 间，不带是 1 州 32 间）。
           · `fog=1` ⇒ 未探索的房间只留 `{id,x,y,z,region,known:false}`，不带名字与出口。
                设置项「地图显示未探索地名」打开时前端传 `fog=0`。 */
        const wmRegion = String((json_body && json_body.region) || query.region || '');
        const wmNeighbors = String((json_body && json_body.neighbors) ?? query.neighbors ?? '1');
        const wmFog = String((json_body && json_body.fog) ?? query.fog ?? '0');
        return json(res, 200, {
          ok: true,
          view: engine.view({
            map: wantMap,
            mapGeometry: wantGeometry,
            mapRegion: wmRegion || null,
            mapNeighbors: wmNeighbors !== '0',
            mapFog: wmFog === '1',
          }),
        });
      }

      /* 「请教武学」面板（主人 2026-10-08）：列出这个人的**所有**武学 + 能不能教。
         `api.view(panel)` 只吃一个 panel 名，传不了「请教谁」，所以单开一条。 */
      case 'teach': {
        const uid = (json_body && (json_body.uid || json_body.id || json_body.name)) || null;
        const t = uid == null ? null : engine.teachView(uid);
        if (!t) return json(res, 404, { ok: false, error: '这里没有这个人。' });
        return json(res, 200, { ok: true, teach: t });
      }

      /* 「询问」面板（view 瘦身的懒加载通道，2026-10-13）：
         话题清单 + 认识人名单不再随场景快照下发（view.npcs[].askTopics/askPeople 已撤），
         点「询问」时按需取一次。同 `teach`：单开 route 传「问谁」。 */
      case 'ask': {
        const uid = (json_body && (json_body.uid || json_body.id || json_body.name)) || null;
        const a = uid == null ? null : engine.askView(uid);
        if (!a) return json(res, 404, { ok: false, error: '这里没有这个人。' });
        return json(res, 200, { ok: true, ask: a });
      }

      /* NPC 详情画像（前端「细看此人」的新界面）。
         `api.view(panel)` 只吃一个 panel 名，传不了「看哪个人」，
         所以单开一个 route：POST { uid } → { ok, npc: profile }。 */
      case 'npc': {
        const uid = (json_body && (json_body.uid || json_body.id || json_body.name)) || null;
        const npc = uid == null ? null : engine.npcProfileOf(uid);
        if (!npc) return json(res, 404, { ok: false, error: '这里没有这个人。' });
        return json(res, 200, { ok: true, npc });
      }

      /* NPC 全量简报（view.npcs 瘦身 · 聚集分级的懒加载通路，2026-10-15）。
         聚集场景 view.npcs 只发卡片级字段（slim:true），点开菜单时这里按 uid
         拉全量（婚配/结拜/绑架/送礼/喜好……），形态与旧 view.npcs[] 完全一致。 */
      case 'npcfull': {
        const uid = (json_body && (json_body.uid || json_body.id || json_body.name)) || null;
        const npc = uid == null ? null : engine.npcFullView(uid);
        if (!npc) return json(res, 404, { ok: false, error: '这里没有这个人。' });
        return json(res, 200, { ok: true, npc });
      }

      /* 任务详情预览（「接取任务」先弹详情再决定接不接）。
         同 `npc`：`api.view(panel)` 传不了「看哪个任务」，单开一条。 */
      case 'quest': {
        const qid = (json_body && (json_body.qid || json_body.id || json_body.name)) || null;
        const quest = qid == null ? null : engine.questPreviewOf(qid);
        if (!quest) return json(res, 404, { ok: false, error: '没有这个任务。' });
        return json(res, 200, { ok: true, quest });
      }

      /* --- 存读档（本地化 2026-10-18，主人定调：只保留本地存档功能）---
         存档的唯一权威副本住浏览器 localStorage（js/savestore.js），服务端
         **不再替玩家写 saves/**。四条路由的新分工：
           · `save`    → 纯快照：正文随回包下发，客户端自己落盘（不写文件）；
           · `restore` → 收客户端送回的正文恢复世界（读档/接人共用）；
           · `saves` / `legacy/read` → **只读迁移桥**：老档还在服务器时供前端
             首启一次性导入，不写任何文件、不改世界。
         玩家档的「列表 / 删除」全在前端本地完成，不再有服务端路由。
         （服务端自己的 `_live` 会话抢救与此正交，照旧。） */
      case 'saves': return json(res, 200, { ok: true, saves: engine.listSaves() });
      case 'save': {
        const r = engine.snapshot(json_body && json_body.id);
        return json(res, 200, {
          ok: r.ok, id: r.id, msg: r.msg, data: r.data,
          lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }],
        });
      }
      case 'restore': {
        const r = engine.restoreFrom(json_body && json_body.data);
        /* view 与老 /api/load 同一口径：带 player、不带地图 ——
           ui.js 的 recoverLostPlayer() 靠 `d.view.player` 判定「人接回来了没有」。 */
        const v = (r.view !== undefined) ? r.view : engine.view({ map: false });
        return json(res, 200, Object.assign({ lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }] }, r, { view: v }));
      }
      case 'legacy/read': {
        const data = engine.readSave(json_body && json_body.id);
        if (!data) return json(res, 404, { ok: false, error: '没有这份旧档。' });
        return json(res, 200, { ok: true, id: json_body && json_body.id, data });
      }
      /* ⚠️ `load` / `deletesave` 两条路由已随存档本地化一并摘除（2026-10-18）：
         读档正文由客户端从 localStorage 送 `/api/restore`，列表与删除全在本地。
         服务端不再有「按 id 读盘读档」「删玩家档」的入口。
         （迁移期老档正文走只读的 `legacy/read`，只取不改。） */

      /* --- Mod 管理 --- */
      case 'mods': {
        const list = engine.modLoader.mods.map(m => ({
          id: m.id, name: m.name, version: m.version, author: m.author, description: m.description,
          category: m.category, tags: m.tags, enabled: m.enabled, broken: m.broken, error: m.error,
          counts: m.counts, size: m.size, dir: m.dir, icon: m.icon ? '/modfiles/' + m.id + '/icon.' + path.extname(m.icon).slice(1) : null,
          dependencies: m.dependencies, conflicts: m.conflicts, priority: m.priority, mtime: m.mtime,
          hasScript: m.hasScript, local: !!m.local,
        }));
        return json(res, 200, { ok: true, mods: list, problems: engine.modProblems() });
      }
      case 'mod:toggle': {
        const r = engine.modSetEnabled(json_body.id, !!json_body.enabled);
        return json(res, 200, { ok: r.ok, problems: engine.modProblems(), boot: engine.bootLog });
      }
      case 'mod:order': {
        const r = engine.modSetOrder(json_body.ids || []);
        return json(res, 200, { ok: r.ok, problems: engine.modProblems() });
      }
      case 'mod:remove': {
        const r = engine.modRemove(json_body.id, json_body.hard !== false);
        return json(res, 200, r);
      }
      case 'mod:install': {
        /* 统一入口：{ kind:'json'|'zip'|'folder', ... } */
        const r = engine.modInstall(json_body || {});
        return json(res, r && r.ok ? 200 : 400, Object.assign({ mods: engine.modList(), problems: engine.modProblems() }, r));
      }
      case 'mod:install-local': {
        /* 网页版从浏览器授权的本地文件夹装私有 Mod（落到 mods/_local/） */
        const r = engine.modInstallLocal(json_body || {});
        return json(res, r && r.ok ? 200 : 400, Object.assign({ mods: engine.modList(), problems: engine.modProblems() }, r));
      }
      case 'mod:export': {
        const out = json_body.outPath || path.join(ROOT, 'saves', (json_body.id || 'mod') + '.zip');
        const r = engine.modExportZip(json_body.id, out);
        if (r && r.ok) {
          try { r.base64 = fs.readFileSync(out).toString('base64'); } catch (e) { }
        }
        return json(res, 200, r);
      }
      case 'mod:files': {
        const r = engine.modFiles(json_body.id);
        return json(res, 200, { ok: true, id: json_body.id, files: r });
      }
      case 'mod:read': {
        /* file 为空 => 列出文件清单；否则返回内容 */
        const r = engine.modRead(json_body.id, json_body.file);
        return json(res, 200, r);
      }
      case 'mod:write': {
        const r = engine.modWrite(json_body.id, json_body.file, json_body.content);
        return json(res, r && r.ok ? 200 : 400, Object.assign({ mods: engine.modList(), problems: engine.modProblems() }, r));
      }

      /* --- Mod 制作器 --- */
      case 'editor/meta': return json(res, 200, { ok: true, meta: engine.editorMeta() });

      case 'editor/validate': {
        const spec = (json_body && json_body.spec) || json_body || {};
        const r = engine.validateSpec(spec);
        /* 统一成前端 report 结构 */
        const info = r.info || {};
        const sum = [];
        ['rooms', 'regions', 'npcs', 'items', 'skills', 'sects', 'quests'].forEach(k => {
          if (info[k]) sum.push(k + ' ' + info[k]);
        });
        const report = {
          errors: r.errors || [],
          warnings: r.warnings || [],
          infos: sum.length ? ['本 Mod 共包含：' + sum.join('、')] : [],
          summary: (r.errors && r.errors.length)
            ? ('发现 ' + r.errors.length + ' 个错误、' + (r.warnings || []).length + ' 个警告。')
            : ((r.warnings || []).length ? ('没有错误，但有 ' + r.warnings.length + ' 条建议。') : '一切正常。'),
          info,
        };
        return json(res, 200, { ok: true, report });
      }

      case 'editor/preview': {
        const spec = (json_body && json_body.spec) || json_body || {};
        const r = engine.buildModFiles(engine.normalizeSpec(spec));
        return json(res, 200, { ok: true, manifest: r.files['mod.json'], files: Object.keys(r.files) });
      }

      case 'editor/save': {
        const spec = (json_body && json_body.spec) || json_body || {};
        const r = engine.editorSave(spec, (json_body && json_body.id));
        if (!r.ok) return json(res, 400, { ok: false, error: r.msg || '保存失败' });
        engine.modSetEnabled(r.id, true);
        return json(res, 200, { ok: true, id: r.id, problems: engine.modProblems(), mods: engine.modList() });
      }

      case 'editor/export': {
        const spec = (json_body && json_body.spec) || json_body || {};
        const r = engine.editorExport(spec, (json_body && json_body.id));
        if (!r.ok) return json(res, 400, { ok: false, error: r.msg || '导出失败' });
        return json(res, 200, { ok: true, id: r.id, path: r.path, base64: r.base64 });
      }

      /* --- 测试 mod 效果（不保存） --- */
      case 'editor/testrun': {
        const spec = (json_body && json_body.spec) || json_body || {};
        const nspec = engine.normalizeSpec(spec);
        const built = engine.buildModFiles(nspec);
        const tmpId = '_testmod_' + Date.now().toString(36);
        engine.writeMod(tmpId, built.files);
        engine.modSetEnabled(tmpId, true);
        const w = engine.world;
        const man = built.files['mod.json'] || {};
        const report = {
          loaded: true,
          rooms: Object.keys(man.rooms || {}).length,
          skills: Object.keys(man.skills || {}).length,
          items: Object.keys(man.items || {}).length,
          npcs: Object.keys(man.npcs || {}).length,
          quests: Object.keys(man.quests || {}).length,
          problems: engine.modProblems(),
        };
        report.reachableRooms = Object.keys(man.rooms || {}).filter(id => w.getRoom(id));
        engine.modRemove(tmpId, true);
        return json(res, 200, { ok: true, report });
      }

      /* --- 下载 mod zip（给浏览器下载） --- */
      case 'mod:downloadzip': {
        const out = path.join(ROOT, 'saves', (json_body.id || 'mod') + '.zip');
        const r = engine.modExportZip(json_body.id, out);
        if (!r.ok) return json(res, 400, r);
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${encodeURIComponent(json_body.id)}.zip"`,
          'Content-Length': fs.statSync(out).size,
        });
        return fs.createReadStream(out).pipe(res);
      }

      /* --- 导出全部 mod 清单 --- */
      case 'mod:list-archive': {
        const w = new zipmini.ZipWriter();
        for (const m of engine.modLoader.mods) {
          try { w.addFolder(m.dir, m.id + '/'); } catch (e) { }
        }
        const buf = w.toBuffer();
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': buf.length, 'Content-Disposition': 'attachment; filename="all-mods.zip"' });
        return res.end(buf);
      }
      case 'mod:listarchive': {
        const out = [];
        for (const m of engine.modLoader.mods) out.push({ id: m.id, files: engine.modFiles(m.id) });
        return json(res, 200, { ok: true, list: out });
      }

      /* --- 游戏内各类事物的 ID 一览（Mod 制作器「游戏内 ID」用，主人 2026-10-11） --- */
      case 'gamedata': return json(res, 200, gamedataApi(engine, query));

      /* --- 与 Mod 网站通信 --- */
      case 'site/config': {
        const cfg = readSiteConfig();
        /* 把**实际生效**的地址一起回给前端：设置面板据此显示真相。
           否则玩家看到的是配置里那个 8788，而请求其实发去别处，
           「明明填对了却传不上」比不显示更折磨人。 */
        return json(res, 200, {
          ok: true,
          config: Object.assign({}, cfg, {
            effectiveBase: siteBase(cfg),
            publicBase: sitePublicBase(cfg),
            combined: process.env.COMBINED === '1',
          }),
        });
      }
      case 'site/setconfig': {
        writeSiteConfig(json_body || {});
        return json(res, 200, { ok: true, config: readSiteConfig() });
      }
      case 'site/upload': return await proxyUpload(engine, req, res, json_body);
      case 'site/remote': return await proxyRemote(engine, req, res, query);
      /* 本站账号：登录 / 注册 / 登出 / 我的作品（主人 2026-10-11 上传要登录） */
      case 'site/account': return await proxyAccount(engine, req, res, json_body, query);

      default:
        return json(res, 404, { ok: false, error: '未知接口: ' + route });
    }
  } catch (e) {
    console.error('[api error]', route, e);
    return json(res, 500, { ok: false, error: String(e && e.message || e), stack: String(e && e.stack || '') });
  }
}

/* ------------------------------------------------------------------ *
 * Mod 站点配置 / 代理
 * ------------------------------------------------------------------ */
const SITE_CFG = path.join(ROOT, 'game', 'userdata', 'site-config.json');
function readSiteConfig() {
  const def = { apiBase: 'http://127.0.0.1:8788', author: '', token: '' };
  try {
    if (fs.existsSync(SITE_CFG)) return Object.assign(def, JSON.parse(fs.readFileSync(SITE_CFG, 'utf8')));
  } catch (e) { }
  return def;
}
function writeSiteConfig(c) {
  fs.mkdirSync(path.dirname(SITE_CFG), { recursive: true });
  fs.writeFileSync(SITE_CFG, JSON.stringify(Object.assign(readSiteConfig(), c), null, 2), 'utf8');
}

/**
 * Mod 站地址 —— **服务端转发**用（唯一真相）。
 *
 * 🔴 2026-10-11 主人亲报：「mod 制作器的上传你是不是没连到我们的 mod 站」。
 *    根因：这里原本只有 `cfg.apiBase`，默认写死 `http://127.0.0.1:8788`。
 *    可**合并部署**（combined.js）下，Mod 站只是同一个进程里的一个内部端口，
 *    而且 `listenWithFallback` 在端口被占时还会**顺延**，根本不保证是 8788。
 *    实测（SITE_PORT=8892 起合并服务）：
 *      POST /api/site/upload → {"ok":false,"error":"connect ECONNREFUSED 127.0.0.1:8788"}
 *    ——玩家看到的就是「上传卡住 / 白屏」。
 *
 * 修法：以 combined.js 注入的 `SITE_INTERNAL_URL`（/ 或真实内部地址）为准，
 *      它没给（独立跑游戏端）才退回手动配置 → 再退回默认端口。
 * ⚠️ 顺序不能反：手动配置在合并部署里是**没法填对**的（玩家不知道内部端口），
 *    所以内部地址优先。独立部署时没有这个变量，行为与从前一致。
 */
function siteBase(cfg) {
  const internal = String(process.env.SITE_INTERNAL_URL || '').trim();
  if (internal) return internal.replace(/\/+$/, '');
  return String((cfg && cfg.apiBase) || 'http://127.0.0.1:8788').replace(/\/+$/, '');
}

/**
 * Mod 站地址 —— **给玩家看的链接**用。
 *   合并部署：站挂在公开域的 `/site/`，所以返回相对路径 `/site`；
 *   独立部署：就是站点自己的地址。
 * （转发用 internal、展示用 public，两个不是一个东西，别混用。）
 */
function sitePublicBase(cfg) {
  const env = String(process.env.SITE_PUBLIC_BASE || '').trim();
  if (env) return env.replace(/\/+$/, '');
  if (process.env.COMBINED === '1') return '/site';
  return siteBase(cfg);
}

/**
 * 游戏内各类事物的 ID 一览（Mod 制作器「游戏内 ID」用）。
 *
 * 主人 2026-10-11：「在 mod 制作器里添加游戏内各事物 id 列表……同时添加可通过
 * id 更改游戏内剧情、人物、物品、功法、区域等有 id 的事物」。
 *
 * · `kind` 指定类别；不带 `id` → 回一份**精简清单**（id + 名字 + 一条摘要）；
 * · 带 `id` → 回那一件的**完整内容**，制作器据此「按 ID 改」（生成同 id 的覆盖 Mod）。
 * ⚠️ 列表**只发 id/名字/摘要**，别把整个 `data` 甩给前端 —— 那是 30 多个数据文件、
 *    上千条记录，浏览器会卡住；真正要改哪一件时再单独取那一件。
 */
function gamedataApi(engine, query) {
  /* ⚠️ 2026-10-11 扩容：制作器的「游戏 ID 列表」原本只有 7 类，
     而这两年库里陆续多了**世界事件**（68 条）、**结局**、**天赋/特质** ——
     作者要引用它们、按 id 改它们，却在前端一个入口都没有。
     新增：
       · `endings` / `traits` —— 都是 byId 的表，和 npcs 一样**可以按 id 载入编辑**；
       · `worldEvents` —— 世界事件挂在 `worldEvents.onDayTick` 这个**数组**上，
         而数组在引擎里是「整段替换」语义：改一条会把其余 67 条一起顶掉。
         所以这一类**只提供查看与取 id**，不给「载入编辑」（下面加 `_list` 标记，
         前端据此换成「只读」提示）。
     另：`traits` 顶层是 byId，`attrs` 在部分数据里是数组，两种都兜住。 */
  const KINDS = ['npcs', 'items', 'skills', 'rooms', 'regions', 'quests', 'sects',
    'endings', 'traits', 'worldEvents'];
  const RO_KINDS = ['worldEvents'];   /* 只读：数组语义，改单条会顶掉整组 */
  const w = engine.world;
  const d = (w && w.data) || {};
  const kind = String((query && query.kind) || 'npcs');
  if (KINDS.indexOf(kind) < 0) {
    return { ok: false, error: '未知的类别：' + kind, kinds: KINDS };
  }

  /* 世界事件：把 {onDayTick:[...]} 摊平成一串带 id 的记录，并标明它挂在哪条事件线上 */
  if (kind === 'worldEvents') {
    const src = d.worldEvents || {};
    const flat = [];
    for (const line of Object.keys(src)) {
      for (const ev of [].concat(src[line] || [])) {
        if (!ev) continue;
        flat.push(Object.assign({}, ev, { _list: line }));
      }
    }
    const q0 = String((query && query.q) || '').trim();
    if (query && query.id) {
      const one = flat.find(x => x && x.id === query.id);
      if (!one) return { ok: false, error: '没有这一件：' + query.id };
      return { ok: true, kind, id: query.id, item: one, readonly: true, kinds: KINDS };
    }
    const rows = flat
      .filter(it => !q0 || String(it.id).indexOf(q0) >= 0 || String(it.name || '').indexOf(q0) >= 0)
      .map(it => ({ id: it.id, name: String(it.name || ''), sub: String(it.cat || it._list || '') }));
    return { ok: true, kind, total: flat.length, shown: rows.length, rows, readonly: true, kinds: KINDS };
  }

  const bag = d[kind] || {};
  const asList = Array.isArray(bag)
    ? bag.slice()
    : Object.keys(bag).map(k => Object.assign({ id: k }, bag[k] || {}));

  /* 单件详情 */
  if (query && query.id) {
    const one = Array.isArray(bag)
      ? bag.find(x => x && x.id === query.id)
      : bag[query.id];
    if (!one) return { ok: false, error: '没有这一件：' + query.id };
    return { ok: true, kind, id: query.id, item: one, readonly: RO_KINDS.indexOf(kind) >= 0, kinds: KINDS };
  }

  /* 清单 */
  const q = String((query && query.q) || '').trim();
  const limit = Math.min(3000, parseInt(query && query.limit, 10) || 500);
  const rows = [];
  for (let i = 0; i < asList.length; i++) {
    const it = asList[i];
    if (!it || !it.id) continue;
    const name = String(it.name || it.title || '');
    if (q && String(it.id).indexOf(q) < 0 && name.indexOf(q) < 0) continue;
    rows.push({
      id: it.id, name,
      sub: String(it.type || it.category || it.region || it.tag ||
        (it.level != null ? ('等级 ' + it.level) : '') ||
        (it.price != null ? (it.price + ' 文') : '') || ''),
    });
    if (rows.length >= limit) break;
  }
  return { ok: true, kind, total: asList.length, shown: rows.length, rows, readonly: RO_KINDS.indexOf(kind) >= 0, kinds: KINDS };
}

/** 统计世界内容规模 */
function countWorld(engine) {  const d = (engine.world && engine.world.data) || {};
  const n = (k) => (Array.isArray(d[k]) ? d[k].length : (d[k] ? Object.keys(d[k]).length : 0));
  let mods = 0, modsOn = 0;
  try {
    mods = engine.modLoader.mods.length;
    modsOn = engine.modLoader.mods.filter(m => m.enabled).length;
  } catch (e) { }
  return {
    rooms: n('rooms'), regions: n('regions'), npcs: n('npcs'), items: n('items'),
    skills: n('skills'), sects: n('sects'), quests: n('quests'), dialogues: n('dialogues'),
    monsters: n('monsters'), books: n('books'), shops: n('shops'),
    mods, modsEnabled: modsOn,
  };
}

/**
 * 本站账号（登录 / 注册 / 登出 / 我的作品）—— 转发给 Mod 站点。
 *
 * 主人 2026-10-11：「上传 mod 需要登录才能用」+「制作器里加『我制作的 Mod』」。
 * ⚠️ 站点那边把「没登录」做成 **HTTP 200 + `ok:false` + `needLogin:true`**
 *    （不是 401）—— 这里千万不能把 `ok:false` 当成传输失败，否则前端拿不到
 *    `needLogin` 标记，只能显示一句「网络错误」，登录引导就断了。
 */
async function proxyAccount(engine, req, res, jb, query) {
  const cfg = readSiteConfig();
  const src = jb || {};
  const action = String(src.action || (query && query.action) || '').trim();
  const isGet = (action === 'me' || action === 'mods');
  if (['login', 'register', 'logout', 'me', 'mods'].indexOf(action) < 0) {
    return json(res, 400, { ok: false, error: '未知的账号动作：' + action });
  }
  const payload = {
    name: src.name || '',
    pass: src.pass || '',
    token: src.token || (query && query.token) || '',
  };
  const u = siteBase(cfg) + '/api/account/' + action +
    (isGet && payload.token ? ('?token=' + encodeURIComponent(payload.token)) : '');

  const result = isGet
    ? await httpRequest(u, { method: 'GET' })
    : await httpRequest(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload), 'utf8'),
    });

  if (!result.ok) {
    const d = result.data;
    if (d && typeof d === 'object' && 'ok' in d) return json(res, 200, d);
    return json(res, 200, { ok: false, error: (d && d.error) || result.error || '账号服务不可用' });
  }
  return json(res, 200, result.data || { ok: false, error: '账号服务没有回应' });
}

/** 上传 mod 到站点（JSON API，与本项目 mod-site.js 对接） */
async function proxyUpload(engine, req, res, jb) {
  const cfg = readSiteConfig();
  const spec = jb.spec || null;

  /* 优先用制作器传来的 spec 直接编译；否则用 modId 从磁盘读 */
  let jsonStr = jb.json || null;
  let modId = (spec && spec.id) || jb.modId || jb.id || '';
  let zipB64 = jb.base64 || null;

  if (!jsonStr && modId) {
    const r = engine.modRead(modId, 'mod.json');
    if (r && r.ok && r.content) jsonStr = r.content;
  }
  if (!jsonStr && !zipB64) {
    return json(res, 400, { ok: false, error: '没有可上传的内容（缺少 json / spec / base64）' });
  }

  const payload = {
    json: jsonStr,
    base64: zipB64,
    id: modId,
    note: jb.note || '',
    /* ⚠️ `author` 只是兜底署名 —— 站点会用**登录账号名**覆盖它。
       真正决定「这是谁的作品」的是下面这个 token（主人 2026-10-11：上传要登录）。 */
    author: jb.author || cfg.author || '匿名侠客',
    token: jb.token || '',
  };

  const result = await httpRequest(siteBase(cfg) + '/api/mods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: Buffer.from(JSON.stringify(payload), 'utf8'),
  });

  if (!result.ok) {
    return json(res, 200, { ok: false, error: (result.data && (result.data.error || result.data.msg)) || result.error || '上传失败', url: null });
  }
  /* 站点返回的 url 可能是相对地址（适配 /site/ 前缀部署），这里补全成绝对地址 */
  let pageUrl = (result.data && result.data.url) || '';
  if (pageUrl && !/^https?:/i.test(pageUrl)) {
    pageUrl = sitePublicBase(cfg).replace(/\/+$/, '') + '/' + pageUrl.replace(/^\/+/, '');
  }
  return json(res, 200, {
    ok: true, id: (result.data && result.data.id) || modId,
    updated: !!(result.data && result.data.updated),
    /* 二创标注透传给制作器（主人 2026-10-11）：不是原创就把来源带回前端，
       上传成功的弹窗里明说一句「二创自《X》」。 */
    forkOf: (result.data && result.data.mod && result.data.mod.forkOf) || null,
    url: pageUrl || (sitePublicBase(cfg) + '/mod.html?id=' + encodeURIComponent(modId)),
  });
}

/** 从站点拉取 mod 列表 / 下载安装 */
async function proxyRemote(engine, req, res, query) {  const cfg = readSiteConfig();

  /* 列表 */
  if (query.action === 'list' || !query.action) {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.cat) qs.set('cat', query.cat);
    if (query.sort) qs.set('sort', query.sort);
    if (query.page) qs.set('page', query.page);
    if (query.size) qs.set('size', query.size);
    const suffix = qs.toString() ? ('?' + qs.toString()) : '';
    const r = await httpRequest(siteBase(cfg) + '/api/mods' + suffix, { method: 'GET' });
    if (!r.ok) return json(res, 200, { ok: false, error: r.error || ('HTTP ' + (r.status || '?')), mods: [] });
    const d = r.data || {};
    return json(res, 200, {
      ok: true,
      total: d.total || 0,
      mods: d.mods || [],
      installed: engine.modLoader.mods.map(m => m.id),
    });
  }

  /* 下载并直接安装 */
  if (query.action === 'download') {
    const id = query.id;
    if (!id) return json(res, 400, { ok: false, error: '缺少 id' });
    const r = await httpRequest(siteBase(cfg) + '/api/mods/' + encodeURIComponent(id) + '/download', { method: 'GET' });
    if (!r.ok || !r.data || !r.data.ok) {
      return json(res, 200, { ok: false, error: (r.data && r.data.error) || r.error || '下载失败' });
    }
    /* 直接把 json 装进 mods 目录（零依赖，不依赖 zip 解析） */
    const inst = engine.modInstall({
      kind: 'json',
      id,
      json: r.data.json || null,
      base64: r.data.base64 || null,
      name: r.data.name,
    });
    return json(res, 200, {
      ok: !!(inst && inst.ok),
      error: inst && inst.ok ? null : ((inst && inst.msg) || '安装失败'),
      name: (inst && inst.mod && inst.mod.name) || r.data.name || id,
      mod: inst && inst.mod ? { id: inst.mod.id, name: inst.mod.name } : null,
      mods: engine.modLoader.mods.map(m => ({ id: m.id, name: m.name, enabled: m.enabled })),
    });
  }

  /* 站点健康检查 */
  if (query.action === 'ping') {
    const r = await httpRequest(siteBase(cfg) + '/api/health', { method: 'GET' });
    return json(res, 200, { ok: r.ok, info: r.data || null, error: r.error || null });
  }

  /* 取单个 Mod 的完整内容（「我制作的 Mod → 载入编辑」用；**不安装**）
     ⚠️ 不能复用 action=download —— 那条会把 Mod 直接装进 mods 目录。 */
  if (query.action === 'detail') {
    const id = query.id;
    if (!id) return json(res, 400, { ok: false, error: '缺少 id' });
    const r = await httpRequest(siteBase(cfg) + '/api/mods/' + encodeURIComponent(id), { method: 'GET' });
    if (!r.ok || !r.data || r.data.ok === false) {
      return json(res, 200, { ok: false, error: (r.data && r.data.error) || r.error || '取不到这个 Mod' });
    }
    return json(res, 200, { ok: true, mod: r.data.mod || r.data });
  }

  return json(res, 400, { ok: false, error: '未知 action：' + query.action });
}

function httpRequest(u, opts) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(u);
      const mod = parsed.protocol === 'https:' ? require('https') : require('http');
      const rq = mod.request({
        hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
        method: opts.method || 'GET', headers: opts.headers || {}, timeout: 20000,
      }, (rs) => {
        const chunks = [];
        rs.on('data', c => chunks.push(c));
        rs.on('end', () => {
          const buf = Buffer.concat(chunks);
          if (opts.binary) return resolve({ ok: rs.statusCode < 400, buffer: buf, status: rs.statusCode });
          let data = null;
          try { data = JSON.parse(buf.toString('utf8')); } catch (e) { data = { raw: buf.toString('utf8').slice(0, 2000) }; }
          resolve({ ok: rs.statusCode < 400, data, status: rs.statusCode, error: rs.statusCode >= 400 ? ((data && (data.error || data.msg)) || ('HTTP ' + rs.statusCode)) : null });
        });
      });
      rq.on('error', e => resolve({ ok: false, error: e.message }));
      rq.on('timeout', () => { rq.destroy(); resolve({ ok: false, error: '请求超时' }); });
      if (opts.body) rq.write(opts.body);
      rq.end();
    } catch (e) { resolve({ ok: false, error: e.message }); }
  });
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
if (require.main === module) {
  const port = parseInt(process.argv[2] || process.env.PORT || '8787', 10);
  const { server, engine, bootInfo } = createServer({});
  server.listen(port, '127.0.0.1', () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║        武  侠  行  ·  江湖再启           ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');
    console.log('  游戏地址：http://127.0.0.1:' + port + '/');
    console.log('  数据规模：' + Object.keys(engine.world.data.rooms).length + ' 个地点 · ' +
      Object.keys(engine.world.data.npcs).length + ' 位人物 · ' +
      Object.keys(engine.world.data.skills).length + ' 门武学 · ' +
      Object.keys(engine.world.data.items).length + ' 件物品 · ' +
      Object.keys(engine.world.data.sects).length + ' 个门派');
    console.log('  已加载 Mod：' + engine.modLoader.mods.filter(m => m.enabled).length + ' 个');
    if (bootInfo.bootLog.length) {
      console.log('  加载提示：');
      for (const l of bootInfo.bootLog.slice(0, 10)) console.log('    [' + (l.level || 'info') + '] ' + (l.msg || ''));
    }
    console.log('');
    console.log('  按 Ctrl+C 停止服务');
    console.log('');
  });
}

module.exports = { createServer, httpRequest, gamedataApi };
