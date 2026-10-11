#!/usr/bin/env node
/* ==========================================================================
 *  武侠行 · Mod 网站服务（零依赖，仅用 Node 内置模块）
 *
 *  功能：
 *    - 静态托管 server/public 下的网站页面
 *    - REST API：
 *        GET  /api/mods                     列表（支持 q 搜索、cat 分类、sort 排序）
 *        GET  /api/mods/:id                 单个 Mod 详情
 *        POST /api/mods                     上传 / 更新 Mod（JSON 或 base64 zip）
 *        GET  /api/mods/:id/download        下载 Mod（返回 zip 的 base64 或 json）
 *        GET  /api/mods/:id/file            下载 zip 原文件
 *        POST /api/mods/:id/download-count  下载计数 +1
 *        POST /api/mods/:id/delete          删除（需 token）
 *        GET  /api/categories               分类统计
 *        GET  /api/stats                    站点统计
 *        GET  /api/health                   健康检查
 *        GET  /api/download-game            一键下载整个游戏（zip）
 *        GET  /api/game-pack                打包信息
 *
 *  存储：server/site-data/mods.json（索引） + server/site-data/files/*.zip
 *
 *  用法：node server/mod-site.js [port]      默认 8788
 * ========================================================================== */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const zipmini = require('../game/src/core/zipmini');

/* ==========================================================================
 *  路径与配置
 * ========================================================================== */
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
/* ⚠️ 数据目录可用 `WX_SITE_DATA` 覆盖 —— 测试要在一个**临时目录**里跑账号与上传，
   绝不能在开发者的真 `site-data/` 里注册账号、塞 Mod（跑一次回归就多一个假用户）。 */
const DATA_DIR = process.env.WX_SITE_DATA
  ? path.resolve(process.env.WX_SITE_DATA)
  : path.join(__dirname, 'site-data');
const FILES_DIR = path.join(DATA_DIR, 'files');
const INDEX_FILE = path.join(DATA_DIR, 'mods.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const PORT = parseInt(process.argv[2], 10) || parseInt(process.env.SITE_PORT, 10) || 8788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const CATEGORIES = ['剧情', '地图', '功能', '功法', '物品', '门派', '任务', '综合', '美化'];

/* ==========================================================================
 *  Mod 隐藏溯源 ID（主人 2026-10-11）
 *  --------------------------------------------------------------------------
 *  要堵的是这条路：**下载别人的 Mod → 导入制作器 → 改两笔 → 当自己的发上来**。
 *
 *  做法：发布时给每一份 Mod 分配一个隐藏 ID（`_wxTrace`），写进站点保存的
 *  `mod.json` 里。于是**下载回来的人拿到的文件天生带着它**；制作器导入时会
 *  原样保留（界面上不显示，也不进游戏世界数据）。再发布时服务端认这个 ID：
 *    · 没有 → 新作品，发一个新的给它
 *    · 有，且指向**别人**（含官方示例）→ 拒绝，并点名说出这是谁的作品
 *
 *  ⚠️ 它挡的是「顺手拿来当自己的」，挡不住铁了心手工删字段的人 ——
 *     前端不可信，这是任何客户端侧方案的边界。真正的底线在服务端：
 *     **署名与归属**（`owner`）由服务端写死，前端说破天也不作数。
 * ========================================================================== */
const TRACE_KEY = '_wxTrace';
const OFFICIAL_OWNER = '@official';      /* 官方示例的归属，与任何玩家账号都不同名 */

function newTrace() {
  return 'wxt-' + require('crypto').randomBytes(8).toString('hex');
}
/** 取出内容里带的隐藏溯源 ID（没有就返回空串） */
function traceOf(json) {
  if (!json || typeof json !== 'object') return '';
  const v = json[TRACE_KEY];
  return v ? String(v).slice(0, 64) : '';
}

/* ==========================================================================
 *  存储
 * ========================================================================== */
function ensureDirs() {
  [DATA_DIR, FILES_DIR].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
  if (!fs.existsSync(INDEX_FILE)) {
    fs.writeFileSync(INDEX_FILE, JSON.stringify({ mods: [], updated: Date.now() }, null, 2), 'utf-8');
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify({
      name: '武侠行 Mod 站',
      allowUpload: true,
      adminToken: '',
      maxSize: 64 * 1024 * 1024,
      /* 游戏网页版地址。
         '' = auto（自动判断：合并部署时是站点上级目录，独立跑时是 127.0.0.1:8787）
         也可以填绝对地址，例如 https://wuxia-mod.app.workbuddy.host/ */
      gameUrl: ''
    }, null, 2), 'utf-8');
  }
}

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf-8'));
  } catch (e) {
    return { mods: [], updated: Date.now() };
  }
}

function writeIndex(idx) {
  idx.updated = Date.now();
  fs.writeFileSync(INDEX_FILE, JSON.stringify(idx, null, 2), 'utf-8');
}

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); }
  catch (e) { return { name: '武侠行 Mod 站', allowUpload: true, adminToken: '', maxSize: 64 * 1024 * 1024, gameUrl: '' }; }
}

/* ==========================================================================
 *  官方示例 Mod 自动播种
 *  --------------------------------------------------------------------------
 *  游戏目录 mods/demo_* 是随游戏分发的官方示例 Mod。它们应该默认出现在
 *  Mod 站上（新人一进来就能看到「示例」分类里有什么），但站点索引
 *  server/site-data/mods.json 是独立的 —— 一旦被清空或部署到新机器，
 *  示例就全没了。
 *
 *  所以这里做「自动播种」：
 *    · 每次启动扫描 GAME_MODS_DIR 下的 demo_* 目录
 *    · 索引里没有的补进去；已存在的不动（保留下载数、用户改过的信息）
 *    · 站上被手动删除过的会记进 seed-state.json 的黑名单，不再重复补
 * ========================================================================== */
const GAME_MODS_DIR = process.env.MODS_DIR
  ? path.resolve(process.env.MODS_DIR)
  : path.join(ROOT, 'mods');
const SEED_STATE = path.join(DATA_DIR, 'seed-state.json');

function readSeedState() {
  try { return JSON.parse(fs.readFileSync(SEED_STATE, 'utf-8')); }
  catch (e) { return { dropped: [] }; }
}
function writeSeedState(st) {
  try { fs.writeFileSync(SEED_STATE, JSON.stringify(st, null, 2), 'utf-8'); } catch (e) { }
}

/** 官方示例目录名规则：demo_ 开头 */
function isOfficialDemo(name) {
  return /^demo_/.test(String(name || ''));
}

function seedOfficialMods() {
  let entries = [];
  try {
    entries = fs.readdirSync(GAME_MODS_DIR, { withFileTypes: true })
      .filter(e => e.isDirectory() && !String(e.name).startsWith('.') && !String(e.name).startsWith('_'))
      .map(e => e.name)
      .filter(isOfficialDemo);
  } catch (e) {
    return { ok: false, added: 0, updated: 0, error: e.message };
  }
  if (!entries.length) return { ok: true, added: 0 };

  const idx = readIndex();
  idx.mods = idx.mods || [];
  const state = readSeedState();
  const dropped = new Set(state.dropped || []);
  let added = 0, updated = 0;

  for (const dirName of entries) {
    let json;
    try {
      const mf = path.join(GAME_MODS_DIR, dirName, 'mod.json');
      if (!fs.existsSync(mf)) continue;
      json = JSON.parse(fs.readFileSync(mf, 'utf-8'));
    } catch (e) { continue; }

    /* id 取值与游戏端 modloader 保持一致：顶层 id 优先 */
    const id = safeId(json.id || (json._mod && json._mod.id) || dirName);
    if (!id) continue;
    if (dropped.has(id)) continue;                    /* 被手动删过，尊重 */

    const counts = countContent(json);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    const payload = {
      name: String(json.name || id).slice(0, 60),
      version: String(json.version || '1.0.0').slice(0, 20),
      author: String(json.author || '武侠行官方').slice(0, 40),
      /* 官方示例也带隐藏溯源（主人：「官方示例 Mod 更是如此」）——
         值优先取 mod.json 里本来就写好的那个，这样**从游戏目录导入**与
         **从站点下载**两条路拿到的是同一个 ID，都指回官方。 */
      trace: traceOf(json) || newTrace(),
      owner: OFFICIAL_OWNER,
      category: CATEGORIES.indexOf(json.category) >= 0 ? json.category : '综合',
      desc: String(json.desc || json.description || '').slice(0, 600),
      tags: Array.isArray(json.tags) ? json.tags.slice(0, 10).map(t => String(t).slice(0, 20)) : [],
      gameVersion: json.gameVersion || '1.0.0',
      requires: Array.isArray(json.requires) ? json.requires : [],
      counts,
      note: '官方示例 Mod，随游戏分发',
      json,
      size: JSON.stringify(json).length,
    };

    /* ★ 内容指纹：官方示例是**随游戏分发**的，源码改了就该同步到站点。
       老代码这里是 `if (idx.mods.some(m => m.id === id)) continue;` —— 已有的永远跳过，
       于是「更新示例 mod」只改了仓库、站点上仍是旧那一份，
       玩家在模组站下载到的还是老版（比如 skills.type 写英文、装不上槽位的那版）。
       判据用**内容指纹**而不是 version：改了字段忘了推版本号是常态。
       只覆盖 official 条目（玩家自己上传的同名 mod 不动）。 */
    const hash = require('crypto').createHash('md5')
      .update(JSON.stringify(json)).digest('hex');

    const exist = idx.mods.find(m => m.id === id);
    if (exist) {
      if (exist.official === true && exist.hash !== hash) {
        Object.assign(exist, payload, {
          hash, updated: Date.now(), timeText: nowStr(), file: null, official: true,
        });
        updated++;
      }
      continue;
    }

    idx.mods.push(Object.assign({
      id, hash, time: Date.now(), updated: Date.now(), timeText: nowStr(), file: null, official: true,
    }, payload));
    added++;
  }

  if (added || updated) writeIndex(idx);
  return { ok: true, added, updated, total: idx.mods.length };
}

/* ==========================================================================
 *  游戏网页版地址解析
 *
 *  站点有两种跑法：
 *    A. 合并部署（combined.js）：游戏在公开端口的 /，站点挂在 /site/
 *       → 游戏地址 = 站点的上级目录，即 '../'
 *    B. 独立跑（mod-site.js 8788）：游戏在 8787
 *       → 游戏地址 = http://<当前host去掉端口>:8787/
 *
 *  同时允许 config.gameUrl 手动指定绝对地址覆盖（比如线上的正式域名）。
 *  reqHost 用于 B 场景推断主机名。
 * ========================================================================== */
function resolveGameUrl(reqHost) {
  const cfg = readConfig();

  /* 1) 手动配置优先 */
  const manual = String(cfg.gameUrl || '').trim();
  if (manual) return { url: manual, source: 'config', absolute: true };

  /* 2) 合并部署：环境变量 COMBINED=1 由 combined.js 注入；
        也可以用 GAME_PORT === SITE_PORT 佐证 */
  if (process.env.COMBINED === '1') {
    return { url: '../', source: 'combined-relative', absolute: false };
  }

  /* 3) 独立跑：猜游戏主机的同源 + 游戏端口 */
  const gamePort = parseInt(process.env.GAME_PORT, 10) || 8787;
  let host = String(reqHost || '127.0.0.1:8788').split(':')[0];
  if (!host || host === '0.0.0.0') host = '127.0.0.1';
  return { url: 'http://' + host + ':' + gamePort + '/', source: 'standalone-guess', absolute: true };
}

/* 给页面用的完整信息（含是否支持一键跳转） */
function apiGameUrl(reqHost) {
  const r = resolveGameUrl(reqHost);
  return {
    ok: true,
    url: r.url,
    absolute: r.absolute,
    source: r.source,
    /* 网页版永远是首选，离线包只是备选 */
    webPlayable: true
  };
}

/* ==========================================================================
 *  统计 Mod 内容规模
 * ========================================================================== */
function countContent(json) {
  const c = {};
  ['rooms', 'regions', 'npcs', 'items', 'skills', 'sects', 'quests', 'dialogues', 'rules'].forEach(k => {
    if (Array.isArray(json[k])) c[k] = json[k].length;
  });
  return c;
}

/* ==========================================================================
 *  响应工具
 * ========================================================================== */
function send(res, code, data, headers) {
  const body = typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(code, Object.assign({
    'Content-Type': typeof data === 'string' ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache'
  }, headers || {}));
  res.end(body);
}

function sendJson(res, code, obj) {
  send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

function sendBuf(res, code, buf, headers) {
  res.writeHead(code, Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache'
  }, headers || {}));
  res.end(buf);
}

/* ==========================================================================
 *  请求体读取
 * ========================================================================== */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const max = limit || 64 * 1024 * 1024;
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new Error('请求体过大（上限 ' + Math.round(max / 1048576) + 'MB）')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf-8')); }
  catch (e) { throw new Error('请求体不是合法 JSON：' + e.message); }
}

/* ==========================================================================
 *  生成 id / 时间串
 * ========================================================================== */
function nowStr() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + ':' + p(d.getMinutes());
}

function safeId(s) {
  return String(s || '').trim().replace(/[^\w\u4e00-\u9fa5.-]/g, '_').replace(/^_+|_+$/g, '').slice(0, 80);
}

function safeFileName(s) {
  return String(s || 'mod').replace(/[^\w.-]/g, '_').slice(0, 100);
}

/* ==========================================================================
 *  API：列表
 * ========================================================================== */
function apiList(query) {
  const idx = readIndex();
  let list = (idx.mods || []).slice();

  /* 搜索 */
  const q = (query.q || '').trim().toLowerCase();
  if (q) {
    list = list.filter(m => {
      const hay = [m.id, m.name, m.desc, m.author, (m.tags || []).join(' '), m.category]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /* 分类 */
  if (query.cat) list = list.filter(m => m.category === query.cat);

  /* 标签 */
  if (query.tag) list = list.filter(m => (m.tags || []).indexOf(query.tag) >= 0);

  /* 排序 */
  const sort = query.sort || 'new';
  if (sort === 'new') list.sort((a, b) => (b.time || 0) - (a.time || 0));
  else if (sort === 'hot') list.sort((a, b) => (b.downloads || 0) - (a.downloads || 0));
  else if (sort === 'name') list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  else if (sort === 'update') list.sort((a, b) => (b.updated || 0) - (a.updated || 0));

  /* 官方示例永远置顶（同一档内再按上面的排序）——稳定排序保证不破坏已有顺序 */
  list.sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0));

  /* 分页 */
  const total = list.length;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const size = Math.min(100, Math.max(1, parseInt(query.size, 10) || 40));
  const start = (page - 1) * size;
  const pageList = list.slice(start, start + size);

  /* 不返回完整 json，减小体积 */
  const slim = pageList.map(m => ({
    id: m.id, name: m.name, version: m.version, author: m.author,
    category: m.category, desc: m.desc, tags: m.tags, counts: m.counts,
    forkOf: m.forkOf || null,
    downloads: m.downloads || 0, time: m.time, updated: m.updated,
    hasFile: !!m.file, size: m.size || 0, official: !!m.official
  }));

  return { ok: true, total, page, size, mods: slim };
}

/* ==========================================================================
 *  API：详情
 * ========================================================================== */
function apiDetail(id) {
  const idx = readIndex();
  const m = (idx.mods || []).find(x => x.id === id);
  if (!m) return { ok: false, error: '没有找到这个 Mod：' + id };
  return { ok: true, mod: m };
}

/* ==========================================================================
 *  账号：本站轻量登录
 *  --------------------------------------------------------------------------
 *  主人 2026-10-11：「把 mod 制作器里的『一键上传 mod 网站』功能做成需要玩家登录
 *  才能使用」，紧接着还要「在制作器里加『我制作的 Mod』以便更新」——
 *  后一件天然要求「知道你是谁」，所以两件事是同一件：先有登录，才有归属。
 *
 *  在此之前上传是**全匿名**的（`author` 由前端自己填一个昵称），一上线就会有人
 *  顶着别人的名号发 Mod，也无从做「我的作品」。
 *
 *  零依赖实现：口令用 Node 内置 `crypto.scryptSync` 加随机盐哈希（**不存明文**），
 *  登录发随机 token，token 表落盘（服务重启不掉线）。
 *  ⚠️ 这是「本站轻量账号」，别当网银口令用；但也不许退化成「填个名字就算登录」。
 * ========================================================================== */
const SESSION_DAYS = 30;

function readAccounts() {
  try { return JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf-8')); }
  catch (e) { return { users: {} }; }
}
function writeAccounts(a) { fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(a, null, 2), 'utf-8'); }
function readSessions() {
  try { return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf-8')); }
  catch (e) { return { tokens: {} }; }
}
function writeSessions(s) { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2), 'utf-8'); }

function hashPass(pass, salt) {
  return require('crypto').scryptSync(String(pass), String(salt), 32).toString('hex');
}
function normUser(n) { return String(n || '').trim(); }

/** 拿 token 换用户名；无效/过期返回 null */
function whoami(token) {
  const tk = normUser(token);
  if (!tk) return null;
  const s = readSessions();
  const rec = (s.tokens || {})[tk];
  if (!rec) return null;
  if (rec.exp && rec.exp < Date.now()) return null;
  return rec.name || null;
}
function issueToken(name) {
  const token = require('crypto').randomBytes(24).toString('hex');
  const s = readSessions();
  s.tokens = s.tokens || {};
  s.tokens[token] = { name, exp: Date.now() + SESSION_DAYS * 86400000, at: Date.now() };
  writeSessions(s);
  return token;
}

function apiRegister(body) {
  const cfg = readConfig();
  if (cfg.allowRegister === false) return { ok: false, error: '本站已关闭注册' };
  const name = normUser(body.name);
  const pass = String(body.pass || '');
  if (name.length < 2 || name.length > 16) return { ok: false, error: '昵称要 2~16 个字' };
  if (/\s/.test(name)) return { ok: false, error: '昵称里不能有空格' };
  if (pass.length < 6) return { ok: false, error: '口令至少 6 位' };
  const a = readAccounts();
  const key = name.toLowerCase();
  if (a.users[key]) return { ok: false, error: '这个名字已经有人用了' };
  const salt = require('crypto').randomBytes(16).toString('hex');
  a.users[key] = { name, salt, hash: hashPass(pass, salt), created: Date.now() };
  writeAccounts(a);
  return { ok: true, name, token: issueToken(name), created: true };
}

function apiLogin(body) {
  const name = normUser(body.name);
  const pass = String(body.pass || '');
  if (!name || !pass) return { ok: false, error: '昵称与口令都要填' };
  const a = readAccounts();
  const u = a.users[name.toLowerCase()];
  /* ⚠️ 两条错误分开说：「没有这个账号」是给记错名字的人的，
     「口令不对」是给记错口令的人的。合并成一句「登录失败」看着更安全，
     但在这种小站上只会让人反复试到放弃。 */
  if (!u) return { ok: false, error: '没有这个账号，先注册一个吧' };
  if (hashPass(pass, u.salt) !== u.hash) return { ok: false, error: '口令不对' };
  return { ok: true, name: u.name, token: issueToken(u.name) };
}

function apiLogout(token) {
  const tk = normUser(token);
  const s = readSessions();
  if (tk && s.tokens && s.tokens[tk]) { delete s.tokens[tk]; writeSessions(s); }
  return { ok: true };
}

/** 「我」是谁 + 我发布过哪些 Mod（主人要的「我制作的 Mod」） */
function apiMyMods(token) {
  const name = whoami(token);
  if (!name) return { ok: false, needLogin: true, error: '请先登录' };
  const idx = readIndex();
  /* 归属认 `owner`（上传时由服务端写死成账号名，前端伪造不了）。
     历史上匿名发的那批没有 owner —— 它们**不**算任何人的作品。 */
  const mine = (idx.mods || []).filter(m => m.owner === name);
  return {
    ok: true, name,
    mods: mine.map(m => ({
      id: m.id, name: m.name, version: m.version, category: m.category,
      desc: m.desc || '', tags: m.tags || [],
      updated: m.updated || m.time || 0, timeText: m.timeText || '',
      downloads: m.downloads || 0, counts: m.counts || {},
    })),
  };
}

/** 未登录的提示统一从这里出，免得各接口各说各话 */
const NEED_LOGIN = { ok: false, needLogin: true, error: '请先登录（在 Mod 制作器右上角「登录」）' };

/* ==========================================================================
 *  API：上传
 *  body: { json?: string, base64?: string, name?, note?, author?, force? }
 * ========================================================================== */
function apiUpload(body) {
  const cfg = readConfig();
  if (!cfg.allowUpload) return { ok: false, error: '本站点已关闭上传' };

  /* 主人 2026-10-11：**上传必须登录**（连同「我制作的 Mod」一起做的）。
     匿名发布一上线，就会有人顶着别人的名号乱发东西。 */
  const me = whoami(body.token);
  if (!me) return NEED_LOGIN;

  let jsonStr = body.json || null;
  let zipB64 = body.base64 || null;

  /* 如果只给了 base64 zip，需要解出 mod.json —— 这里交给客户端同时传 json 更简单；
     但为了健壮，若只有 zip 就尝试用内置解析器读取。 */
  if (!jsonStr && zipB64) {
    try {
      jsonStr = readModJsonFromZip(Buffer.from(zipB64, 'base64'));
    } catch (e) {
      return { ok: false, error: 'ZIP 中未找到可解析的 mod.json：' + e.message };
    }
  }

  if (!jsonStr) return { ok: false, error: '缺少 Mod 内容（json 或 base64）' };

  let json;
  try { json = JSON.parse(jsonStr); }
  catch (e) { return { ok: false, error: 'mod.json 格式错误：' + e.message }; }

  const id = safeId(json.id || body.id || json.name);
  if (!id) return { ok: false, error: 'Mod 缺少 id 字段' };
  if (!json.name) return { ok: false, error: 'Mod 缺少 name 字段' };

  /* 校验：至少有一样内容 */
  const counts = countContent(json);
  const totalContent = Object.values(counts).reduce((a, b) => a + b, 0);
  if (totalContent === 0) {
    return { ok: false, error: '这个 Mod 没有任何内容（房间/人物/物品/武学/任务/规则都为 0），无法发布' };
  }

  const idx = readIndex();
  const old = (idx.mods || []).find(m => m.id === id);
  /* 别人的作品不许顶掉 —— 有了登录，「这是谁的作品」才立得住 */
  if (old && old.owner && old.owner !== me) {
    return { ok: false, error: `「${id}」是 ${old.owner} 的作品，你改不了（换个 ID 再发）` };
  }

  /* ★ 隐藏溯源 → **二创**（主人 2026-10-11：「可以做成二创」）
   *
   *  基于别人的作品改，是允许的 —— 但要**说清楚是从谁那儿来的**：
   *  记录里钉一个 `forkOf`（来源 id / 名字 / 原作者），前端伪造不了，
   *  站点上也明明白白标出来。想**当自己的原创**发，是发不成的。
   *  这跟上一版「一律拒绝」守的是同一件事，只是把门口从「不许进」
   *  换成了「进来可以，得报上来路」。 */
  let trace = traceOf(json);
  const src = trace ? (idx.mods || []).find(m => m.trace === trace) : null;
  let forkOf = null;
  if (src && src.owner && src.owner !== me) {
    forkOf = {
      id: src.id,
      name: src.name || src.id,
      owner: src.owner,
      official: src.owner === OFFICIAL_OWNER,
    };
    /* 二创作品拿一个**自己的新 ID**：它已经是一件新东西。
       不换的话，「A → B（二创）→ 别人再下载 B 去改」会被算成「二创自 A」，
       中间那个 B 就被抹掉了。 */
    trace = newTrace();
  } else if (!src) {
    /* 内容里没有可认的溯源（全新作品，或一个查无此人的伪造 ID）→ 发一个新的；
       若这是自己那份老记录的更新，沿用它原来的，别把自己也当成新的。 */
    trace = (old && old.trace) ? old.trace : newTrace();
  }
  /* 自己那份在更新：src.owner === me，trace 原样留着（上面两支都不进） */

  const rec = {
    id,
    name: String(json.name).slice(0, 60),
    version: String(json.version || '1.0.0').slice(0, 20),
    /* 署名一律取账号名 —— 前端传什么都不作数（否则「登录」只是个摆设） */
    author: String(me).slice(0, 40),
    owner: String(me),
    /* 隐藏溯源：既存进记录，也写回**保存的 json** ——
       这样下载的人拿到的文件天生带着它（这就是「下载的 Mod 自带隐藏 ID」）。 */
    trace,
    /* 二创标注：不是原创就写清来源（null = 原创） */
    forkOf,
    category: CATEGORIES.indexOf(json.category) >= 0 ? json.category : '综合',
    desc: String(json.desc || '').slice(0, 600),
    tags: Array.isArray(json.tags) ? json.tags.slice(0, 10).map(t => String(t).slice(0, 20)) : [],
    gameVersion: json.gameVersion || '1.0.0',
    requires: Array.isArray(json.requires) ? json.requires : [],
    counts,
    note: String(body.note || '').slice(0, 300),
    json: Object.assign({}, json, { [TRACE_KEY]: trace }),   /* 完整内容（含隐藏溯源），便于客户端直接下载安装 */
    downloads: old ? (old.downloads || 0) : 0,
    time: old ? old.time : Date.now(),
    updated: Date.now(),
    timeText: nowStr(),
    file: null,
    size: jsonStr.length
  };

  /* 有 zip 就存文件 */
  if (zipB64) {
    try {
      const buf = Buffer.from(zipB64, 'base64');
      if (buf.length > (cfg.maxSize || 64 * 1024 * 1024)) {
        return { ok: false, error: 'ZIP 超过站点大小上限' };
      }
      const fname = safeFileName(id + '_v' + rec.version + '.zip');
      fs.writeFileSync(path.join(FILES_DIR, fname), buf);
      rec.file = fname;
      rec.size = buf.length;
    } catch (e) {
      return { ok: false, error: '保存 ZIP 失败：' + e.message };
    }
  } else if (old && old.file) {
    /* 没传新 zip，保留旧文件 */
    rec.file = old.file;
    rec.size = old.size;
  }

  if (old) {
    const i = idx.mods.indexOf(old);
    idx.mods[i] = rec;
  } else {
    idx.mods.push(rec);
  }
  writeIndex(idx);

  return {
    ok: true,
    id,
    updated: !!old,
    /* 顶层也给一份 forkOf：制作器与转发层直接读这里最省事 */
    forkOf: rec.forkOf || null,
    url: 'mod.html?id=' + encodeURIComponent(id),
    mod: {
      id: rec.id, name: rec.name, version: rec.version,
      author: rec.author, category: rec.category, counts: rec.counts,
      forkOf: rec.forkOf || null
    }
  };
}

/* 从 zip 里找 mod.json（极简实现，复用游戏端 zipmini 的思路） */
function readModJsonFromZip(buf) {
  let zip;
  try { zip = require(path.join(ROOT, 'game', 'src', 'core', 'zipmini.js')); }
  catch (e) { throw new Error('zip 解析模块不可用'); }
  const z = zip.readZip ? zip.readZip(buf) : null;
  if (!z) throw new Error('无法解析 zip');
  const entries = z.getEntries ? z.getEntries() : (z.entries || []);
  for (const e of entries) {
    const name = (e.name || e.entryName || '').toLowerCase();
    if (name === 'mod.json' || name.endsWith('/mod.json')) {
      const data = e.getData ? e.getData() : e.data;
      return Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
    }
  }
  throw new Error('压缩包内没有 mod.json');
}

/* ==========================================================================
 *  API：下载
 * ========================================================================== */
/**
 * 下载时把隐藏溯源塞进 json。
 * 为什么不能只靠发布时写进去：**发布机制上线之前**已经存在的那批记录
 * （以及官方播种的早期条目）身上没有这行 —— 不补的话，那一批等于没被保护。
 */
function withTrace(m) {
  const j = Object.assign({}, (m && m.json) || {});
  const t = (m && m.trace) || '';
  if (t) j[TRACE_KEY] = t;
  return j;
}

function apiDownload(id) {
  const idx = readIndex();
  const m = (idx.mods || []).find(x => x.id === id);
  if (!m) return { ok: false, error: '没有找到这个 Mod：' + id };

  m.downloads = (m.downloads || 0) + 1;
  writeIndex(idx);

  const out = {
    ok: true,
    id: m.id,
    name: m.name,
    version: m.version,
    json: JSON.stringify(withTrace(m), null, 2),
    base64: null
  };

  if (m.file) {
    try {
      const p = path.join(FILES_DIR, m.file);
      if (fs.existsSync(p)) out.base64 = fs.readFileSync(p).toString('base64');
    } catch (e) { /* 忽略 */ }
  }
  return out;
}

/* ==========================================================================
 *  一键下载游戏：把整个项目打包成 zip 给用户
 * ========================================================================== */

/* 打包时排除的目录 / 文件（相对 ROOT 的路径片段） */
const PACK_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.workbuddy', '.vscode', '.idea',
  'saves', 'userdata',
  '_nodedl', '_runtime_cache',
  /* 站点数据（索引/上传的 zip）不该进游戏包 */
  'site-data',
  /* ⚠ 关键：mods/_local 是「用户浏览器授权文件夹」来的私有 Mod，
     绝不能跟着下载包发出去。整个 _local 目录排除。 */
  '_local',
  /* 本地临时验证目录（跑测试时生成，不能发出去） */
  '.livetest', '.packtest', '.maptest',
]);
const PACK_EXCLUDE_FILES = new Set([
  'package-lock.json', '.DS_Store', 'Thumbs.db',
]);

/* ------------------------------------------------------------------ *
 *  便携版 Node：放进包里让用户「解压即玩」，不必自己装 Node.js
 *  打包时 node.exe 会作为 runtime/node.exe 写进去；
 *  没下载过就自动去官网取一份缓存起来（只下一次）。
 * ------------------------------------------------------------------ */
const NODE_VERSION = 'v24.21.0';
const NODE_URL = 'https://nodejs.org/dist/' + NODE_VERSION + '/node-' + NODE_VERSION + '-win-x64.zip';
const NODE_CACHE = path.join(__dirname, '_runtime_cache', 'node.exe');

let _nodeBufPromise = null;

function getPortableNode() {
  if (_nodeBufPromise) return _nodeBufPromise;
  _nodeBufPromise = (async () => {
    try {
      if (fs.existsSync(NODE_CACHE) && fs.statSync(NODE_CACHE).size > 1024 * 1024) {
        return fs.readFileSync(NODE_CACHE);
      }
    } catch (e) { /* 读不到就重新下 */ }

    console.log('  [打包] 首次准备便携版 Node（' + NODE_VERSION + '），需要联网下载一次…');
    try {
      const buf = await downloadBuffer(NODE_URL);
      const exe = extractNodeExe(buf);
      if (!exe || exe.length < 1024 * 1024) throw new Error('解压出来的 node.exe 不完整');
      try {
        fs.mkdirSync(path.dirname(NODE_CACHE), { recursive: true });
        fs.writeFileSync(NODE_CACHE, exe);
      } catch (e) { /* 缓存失败不影响本次打包 */ }
      console.log('  [打包] 便携版 Node 就绪（' + (exe.length / 1024 / 1024).toFixed(1) + ' MB）');
      return exe;
    } catch (e) {
      console.error('  [打包] 便携版 Node 准备失败：' + (e && e.message || e));
      _nodeBufPromise = null;   /* 允许下次重试 */
      return null;
    }
  })();
  return _nodeBufPromise;
}

/** 下载一个 URL 到 Buffer（跟随重定向） */
function downloadBuffer(u, depth) {
  depth = depth || 0;
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('重定向次数过多'));
    let parsed;
    try { parsed = new URL(u); } catch (e) { return reject(e); }
    const mod = parsed.protocol === 'https:' ? require('https') : require('http');
    const rq = mod.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'wuxia-mod-site' },
      timeout: 300000,
    }, (rs) => {
      if (rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location) {
        rs.resume();
        return resolve(downloadBuffer(new URL(rs.headers.location, u).toString(), depth + 1));
      }
      if (rs.statusCode !== 200) {
        rs.resume();
        return reject(new Error('HTTP ' + rs.statusCode));
      }
      const chunks = [];
      rs.on('data', c => chunks.push(c));
      rs.on('end', () => resolve(Buffer.concat(chunks)));
      rs.on('error', reject);
    });
    rq.on('error', reject);
    rq.on('timeout', () => { rq.destroy(); reject(new Error('下载超时')); });
  });
}

/** 从 node 官方 zip 里取出 node.exe（自实现，避免依赖解压库） */
function extractNodeExe(zipBuf) {
  /* 扫局部文件头找 .../node.exe */
  let i = 0;
  while (i + 30 <= zipBuf.length) {
    if (zipBuf.readUInt32LE(i) !== 0x04034b50) { i += 1; continue; }
    const method = zipBuf.readUInt16LE(i + 8);
    const compSize = zipBuf.readUInt32LE(i + 18);
    const nameLen = zipBuf.readUInt16LE(i + 26);
    const extLen = zipBuf.readUInt16LE(i + 28);
    const nameStart = i + 30;
    const name = zipBuf.toString('utf8', nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extLen;

    if (/\/node\.exe$/i.test(name)) {
      const raw = zipBuf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return require('zlib').inflateRawSync(raw);
      throw new Error('不支持的压缩方式：' + method);
    }
    if (compSize > 0) i = dataStart + compSize;
    else i = dataStart;
  }
  return null;
}

/** 递归收集要打包的文件 */
function collectPackFiles(dir, prefix, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (PACK_EXCLUDE_FILES.has(e.name)) continue;
    const full = path.join(dir, e.name);
    const rel = prefix + e.name;
    if (e.isDirectory()) {
      if (PACK_EXCLUDE_DIRS.has(e.name)) continue;
      collectPackFiles(full, rel + '/', out);
    } else if (e.isFile()) {
      out.push({ full, rel });
    }
  }
  return out;
}

/** 生成整包 zip。opts.includeSaves 决定是否带上存档；默认带便携版 Node */
async function buildGameZip(opts) {
  opts = opts || {};
  const w = new zipmini.ZipWriter();
  const baseName = 'jinyong-mud';

  const files = collectPackFiles(ROOT, baseName + '/', []);
  let total = 0;

  for (const f of files) {
    if (!opts.includeSaves && /\/saves\//.test(f.rel)) continue;
    try {
      const buf = fs.readFileSync(f.full);
      w.add(f.rel, buf);
      total += buf.length;
    } catch (e) { /* 跳过读不了的文件 */ }
  }

  /* 便携版 Node：解压即玩，不需要用户自己装 */
  let runtimeIncluded = false;
  if (opts.includeRuntime !== false) {
    const exe = await getPortableNode();
    if (exe) {
      w.add(baseName + '/runtime/node.exe', exe);
      total += exe.length;
      runtimeIncluded = true;
    }
  }

  /* 确保 mods / saves 目录存在（空目录也带上，方便开箱即用） */
  w.add(baseName + '/mods/README.txt',
    '把你的 Mod 放在这里，每个 Mod 一个文件夹。\n' +
    '文件夹里至少有一个 mod.json。\n' +
    '也可以在游戏里用「MOD 管理器」自动安装。\n');
  if (!opts.includeSaves) {
    w.add(baseName + '/saves/.keep', '存档目录\n');
  }

  const buf = w.toBuffer();
  return { buf, files: files.length + (runtimeIncluded ? 1 : 0), rawSize: total, runtimeIncluded };
}

/** GET /api/download-game[?saves=1] —— 直接返回整包 zip */
async function apiDownloadGame(res, query) {
  try {
    const r = await buildGameZip({
      includeSaves: query.saves === '1',
      includeRuntime: query.runtime !== '0',     /* ?runtime=0 可要一个不带 Node 的精简包 */
    });
    const name = 'jinyong-mud-' + new Date().toISOString().slice(0, 10) + '.zip';
    sendBuf(res, 200, r.buf, {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="' + name + '"',
      'Content-Length': r.buf.length,
      'X-Pack-Files': String(r.files),
      'X-Pack-Runtime': r.runtimeIncluded ? '1' : '0',
    });
  } catch (e) {
    sendJson(res, 500, { ok: false, error: '打包失败：' + (e && e.message || e) });
  }
}

/** 打包前的容量预检，供前端提示用 */
function apiGamePackInfo() {
  const files = collectPackFiles(ROOT, '', []);
  let raw = 0, count = 0;
  for (const f of files) {
    if (/^saves\//.test(f.rel)) continue;
    try { raw += fs.statSync(f.full).size; count++; } catch (e) { }
  }
  /* 便携版 Node 是否已经备好（备好则打包会把它一起带上） */
  let runtimeReady = false, runtimeBytes = 0;
  try {
    if (fs.existsSync(NODE_CACHE)) {
      runtimeBytes = fs.statSync(NODE_CACHE).size;
      runtimeReady = runtimeBytes > 1024 * 1024;
    }
  } catch (e) { }

  return {
    ok: true,
    files: count + (runtimeReady ? 1 : 0),
    rawBytes: raw + runtimeBytes,
    version: packVersion(),
    runtime: {
      included: runtimeReady || !!_nodeBufPromise,
      ready: runtimeReady,
      version: NODE_VERSION,
      bytes: runtimeBytes,
    },
  };
}

function packVersion() {
  try {
    const p = path.join(ROOT, 'game', 'data', '00_core.json');
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return (j.meta && j.meta.version) || '1.0.0';
  } catch (e) { return '1.0.0'; }
}

/* ==========================================================================
 *  API：直接下载 zip 文件（浏览器下载）
 * ========================================================================== */
function apiFile(id, res) {
  const idx = readIndex();
  const m = (idx.mods || []).find(x => x.id === id);
  if (!m || !m.file) return sendJson(res, 404, { ok: false, error: '没有可下载的 ZIP' });
  const p = path.join(FILES_DIR, m.file);
  if (!fs.existsSync(p)) return sendJson(res, 404, { ok: false, error: '文件已丢失' });

  m.downloads = (m.downloads || 0) + 1;
  writeIndex(idx);

  const buf = fs.readFileSync(p);
  sendBuf(res, 200, buf, {
    'Content-Type': 'application/zip',
    'Content-Disposition': 'attachment; filename="' + safeFileName(m.id + '.zip') + '"'
  });
}

/* ==========================================================================
 *  API：分类 / 统计
 * ========================================================================== */
function apiCategories() {
  const idx = readIndex();
  const map = {};
  CATEGORIES.forEach(c => { map[c] = 0; });
  (idx.mods || []).forEach(m => {
    const c = m.category || '综合';
    map[c] = (map[c] || 0) + 1;
  });
  const list = Object.keys(map).map(k => ({ name: k, count: map[k] })).filter(x => x.count > 0);
  return { ok: true, categories: list, all: CATEGORIES };
}

function apiStats() {
  const idx = readIndex();
  const mods = idx.mods || [];
  const total = mods.length;
  const downloads = mods.reduce((a, m) => a + (m.downloads || 0), 0);
  const authors = new Set(mods.map(m => m.author).filter(Boolean));
  const tags = {};
  mods.forEach(m => (m.tags || []).forEach(t => { tags[t] = (tags[t] || 0) + 1; }));
  const topTags = Object.keys(tags).map(k => ({ tag: k, count: tags[k] }))
    .sort((a, b) => b.count - a.count).slice(0, 16);

  return {
    ok: true,
    stats: {
      mods: total,
      downloads,
      authors: authors.size,
      topTags,
      latest: mods.slice().sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 6)
        .map(m => ({ id: m.id, name: m.name, author: m.author, desc: m.desc, time: m.time })),
      hot: mods.slice().sort((a, b) => (b.downloads || 0) - (a.downloads || 0)).slice(0, 6)
        .map(m => ({ id: m.id, name: m.name, author: m.author, downloads: m.downloads || 0 }))
    }
  };
}

/* ==========================================================================
 *  API：删除（需 adminToken，若未设 token 则允许本地删除）
 * ========================================================================== */
function apiDelete(id, body) {
  const cfg = readConfig();
  if (cfg.adminToken && body.token !== cfg.adminToken) {
    return { ok: false, error: '管理口令错误' };
  }
  const idx = readIndex();
  const i = (idx.mods || []).findIndex(m => m.id === id);
  if (i < 0) return { ok: false, error: '没有找到这个 Mod' };
  const m = idx.mods[i];
  if (m.file) {
    try { fs.unlinkSync(path.join(FILES_DIR, m.file)); } catch (e) { }
  }
  idx.mods.splice(i, 1);
  writeIndex(idx);
  /* 官方示例被删 → 记进黑名单，重启不再自动补回来（尊重管理动作） */
  if (m.official || isOfficialDemo(id)) {
    const st = readSeedState();
    const s = new Set(st.dropped || []);
    s.add(id);
    st.dropped = Array.from(s);
    writeSeedState(st);
  }
  return { ok: true, id };
}

/* ==========================================================================
 *  静态文件
 * ========================================================================== */

/* 已撤除的页面（账号 / 论坛 / 个人中心）。
   这些文件在本地已删除，但云端沙箱是**复用**的：部署只往里拷文件、
   不会删掉多余文件，于是旧版本残留的 HTML 会一直挂在线上。
   所以这里显式拉黑 —— 不管磁盘上有没有，一律 404。 */
const REMOVED_PAGES = new Set(['/account.html', '/forum.html', '/mine.html']);

function serveStatic(pathname, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  /* 已撤除页面：优先于文件查找，防止云端残留文件被访问到 */
  if (REMOVED_PAGES.has(rel.toLowerCase())) {
    return send(res, 404, '404 Not Found: ' + rel);
  }

  /* 安全：禁止穿越 */
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      /* 找不到就用 index.html（前端路由） */
      if (!path.extname(rel)) {
        const idx = path.join(PUBLIC_DIR, 'index.html');
        if (fs.existsSync(idx)) return sendFile(idx, res);
      }
      return send(res, 404, '404 Not Found: ' + rel);
    }
    sendFile(target, res);
  });
}

function sendFile(p, res) {
  const ext = path.extname(p).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  // 代码类资源强制不缓存：发版后不能让人继续跑旧 js（否则修了 bug 也看不到效果）
  const NO_CACHE = ['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map'];
  const cc = NO_CACHE.indexOf(ext) >= 0 ? 'no-store, no-cache, must-revalidate' : 'public, max-age=300';
  fs.readFile(p, (err, buf) => {
    if (err) return send(res, 500, 'Read error');
    sendBuf(res, 200, buf, { 'Content-Type': type, 'Cache-Control': cc });
  });
}

/* ==========================================================================
 *  主路由
 * ========================================================================== */
async function handle(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname || '/';
  const query = parsed.query || {};
  const method = req.method.toUpperCase();

  /* CORS 预检 */
  if (method === 'OPTIONS') {
    return send(res, 204, '');
  }

  /* ---------- API ---------- */
  if (pathname.startsWith('/api/')) {
    const seg = pathname.slice(5).split('/').filter(Boolean); /* 去掉 'api/' */
    const head = seg[0] || '';

    try {

      /* /api/health */
      if (head === 'health') {
        const cfg = readConfig();
        return sendJson(res, 200, { ok: true, name: cfg.name, time: Date.now(), version: '1.0.0' });
      }

      /* /api/categories */
      if (head === 'categories') {
        return sendJson(res, 200, apiCategories());
      }

      /* /api/stats */
      if (head === 'stats') {
        return sendJson(res, 200, apiStats());
      }

      /* /api/download-game   一键下载整个游戏（zip） */
      if (head === 'download-game') {
        return await apiDownloadGame(res, query);
      }

      /* /api/game-pack       打包信息（文件数 / 体积 / 版本） */
      if (head === 'game-pack') {
        return sendJson(res, 200, apiGamePackInfo());
      }

      /* /api/game-url        游戏网页版地址（站点「开始游戏」按钮用） */
      if (head === 'game-url') {
        return sendJson(res, 200, apiGameUrl(req.headers.host));
      }

      /* /api/config */
      if (head === 'config') {
        const cfg = readConfig();
        return sendJson(res, 200, {
          ok: true,
          config: {
            name: cfg.name, allowUpload: cfg.allowUpload, hasToken: !!cfg.adminToken,
            maxSize: cfg.maxSize, gameUrl: cfg.gameUrl || ''
          },
          game: apiGameUrl(req.headers.host),
          categories: CATEGORIES
        });
      }

      /* /api/account/...   本站账号（主人 2026-10-11：上传要登录 + 我制作的 Mod） */
      if (head === 'account') {
        const act = seg[1] || '';
        const body = (method === 'POST') ? await readJsonBody(req) : {};
        const token = body.token || req.headers['x-wx-token'] || (query && query.token) || '';
        if (act === 'register' && method === 'POST') return sendJson(res, 200, apiRegister(body));
        if (act === 'login' && method === 'POST') return sendJson(res, 200, apiLogin(body));
        if (act === 'logout' && method === 'POST') return sendJson(res, 200, apiLogout(token));
        if (act === 'me' && method === 'GET') {
          const who = whoami(token);
          return sendJson(res, 200, who ? { ok: true, name: who } : { ok: false, needLogin: true, error: '未登录' });
        }
        if (act === 'mods' && method === 'GET') return sendJson(res, 200, apiMyMods(token));
        return sendJson(res, 404, { ok: false, error: '未知账号接口：' + act });
      }

      /* /api/mods ... */
      if (head === 'mods') {
        /* GET /api/mods */
        if (seg.length === 1 && method === 'GET') {
          return sendJson(res, 200, apiList(query));
        }

        /* POST /api/mods  -> 上传 */
        if (seg.length === 1 && method === 'POST') {
          const body = await readJsonBody(req);
          const r = apiUpload(body);
          return sendJson(res, r.ok ? 200 : 400, r);
        }

        const id = seg[1];
        if (!id) return sendJson(res, 400, { ok: false, error: '缺少 Mod id' });

        /* GET /api/mods/:id */
        if (seg.length === 2 && method === 'GET') {
          return sendJson(res, 200, apiDetail(id));
        }

        /* GET /api/mods/:id/download  -> 返回 json/base64 */
        if (seg.length === 3 && seg[2] === 'download' && method === 'GET') {
          return sendJson(res, 200, apiDownload(id));
        }

        /* GET /api/mods/:id/file  -> 直接下载 zip */
        if (seg.length === 3 && seg[2] === 'file' && method === 'GET') {
          return apiFile(id, res);
        }

        /* POST /api/mods/:id/download-count */
        if (seg.length === 3 && seg[2] === 'download-count' && method === 'POST') {
          const idx = readIndex();
          const m = (idx.mods || []).find(x => x.id === id);
          if (!m) return sendJson(res, 404, { ok: false, error: '没有找到这个 Mod' });
          m.downloads = (m.downloads || 0) + 1;
          writeIndex(idx);
          return sendJson(res, 200, { ok: true, downloads: m.downloads });
        }

        /* POST /api/mods/:id/delete */
        if (seg.length === 3 && seg[2] === 'delete' && method === 'POST') {
          const body = await readJsonBody(req);
          const r = apiDelete(id, body);
          return sendJson(res, r.ok ? 200 : 400, r);
        }
      }

      return sendJson(res, 404, { ok: false, error: '未知 API：' + pathname });

    } catch (e) {
      return sendJson(res, 500, { ok: false, error: e.message || String(e) });
    }
  }

  /* ---------- 静态 ---------- */
  if (method === 'GET' || method === 'HEAD') {
    return serveStatic(pathname, res);
  }

  send(res, 405, 'Method Not Allowed');
}

/* ==========================================================================
 *  启动
 * ========================================================================== */
function banner() {
  let idx;
  try { idx = readIndex(); } catch (e) { idx = { mods: [] }; }
  const n = (idx.mods || []).length;
  const dl = (idx.mods || []).reduce((a, m) => a + (m.downloads || 0), 0);
  const base = 'http://127.0.0.1:' + PORT;

  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║                                                      ║');
  console.log('  ║       武 侠 行 · Mod 网 站   (Wuxia Mod Site)         ║');
  console.log('  ║                                                      ║');
  console.log('  ╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log('   网站首页    ' + base + '/');
  console.log('   Mod 列表    ' + base + '/list.html');
  console.log('   制作教程    ' + base + '/tutorial.html');
  console.log('   示例 Mod    ' + base + '/examples.html');
  console.log('   游戏端配置  ' + base + '/api    （在游戏「网站设置」里填这个地址）');
  console.log('');
  console.log('   已收录 Mod  ' + n + ' 个    累计下载 ' + dl + ' 次');
  console.log('   数据目录    ' + DATA_DIR);
  console.log('');
  console.log('   按 Ctrl+C 停止服务');
  console.log('');
}

/* 创建站点 HTTP 服务（不监听）——供合并服务复用 */
function createSiteServer() {
  ensureDirs();
  /* 官方示例 Mod 自动上架（demo_* 目录），已存在的会被跳过 */
  try {
    const seeded = seedOfficialMods();
    if (seeded && seeded.added) {
      console.log('  [seed] 已自动上架 ' + seeded.added + ' 个官方示例 Mod');
    }
  } catch (e) { /* 播种失败不能拖垮服务 */ }
  return http.createServer((req, res) => {
    handle(req, res).catch(e => {
      try { sendJson(res, 500, { ok: false, error: e.message || String(e) }); } catch (x) { }
    });
  });
}

function start() {
  const server = createSiteServer();

  server.on('error', e => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  [错误] 端口 ' + PORT + ' 已被占用。');
      console.error('  换一个端口试试：node server/mod-site.js 8899\n');
    } else {
      console.error('\n  [错误] ' + e.message + '\n');
    }
    process.exit(1);
  });

  server.listen(PORT, '127.0.0.1', () => {
    banner();
    /* 自动打开浏览器（可选，失败不影响） */
    if (process.argv.indexOf('--no-open') < 0) {
      try {
        const cmd = process.platform === 'win32' ? 'start "" '
          : process.platform === 'darwin' ? 'open ' : 'xdg-open ';
        require('child_process').exec(cmd + '"http://127.0.0.1:' + PORT + '/"');
      } catch (e) { /* ignore */ }
    }
  });

  process.on('SIGINT', () => {
    console.log('\n  Mod 网站已停止。\n');
    process.exit(0);
  });
}

if (require.main === module) {
  start();
}

module.exports = { start, createSiteServer, handle, apiList, apiUpload, apiDownload, apiDetail, countContent, apiDownloadGame, apiGamePackInfo, buildGameZip, seedOfficialMods, resolveGameUrl, apiRegister, apiLogin, apiLogout, apiMyMods, whoami, ensureDirs, readIndex, writeIndex };
