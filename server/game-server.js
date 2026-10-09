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

function serveStatic(req, res, baseDir, relPath) {
  let p = path.normalize(path.join(baseDir, decodeURIComponent(relPath)));
  if (!p.startsWith(baseDir)) { res.writeHead(403); res.end('Forbidden'); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found: ' + relPath); return; }
  const ext = path.extname(p).toLowerCase();
  const stat = fs.statSync(p);
  const type = MIME[ext] || 'application/octet-stream';
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
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': cacheHeaderFor(ext) });
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
      if (rel.startsWith('/saves/')) return serveStatic(req, res, path.join(ROOT, 'saves'), rel.replace('/saves/', '/'));
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

  return { server, engine, bootInfo, userDataDir };
}

/* ------------------------------------------------------------------ *
 * API 路由
 * ------------------------------------------------------------------ */
async function handleApi(engine, req, res, pn, query, preset) {
  const route = pn.replace('/api/', '');
  const method = req.method;

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
        return json(res, 200, { ok: true, cmd: c0, lines: r.lines || [], log: r.lines || [], action: r.action || 'panel', openPanel: panel, choices: null, modal: null, ending: null, view: r.view || engine.view() });
      }
    }
  }

  try {
    switch (route) {
      /* --- 状态 --- */
      case 'state': return json(res, 200, { ok: true, boot: engine.bootLog, view: engine.view(), meta: engine.world.data.meta });

      /* --- 启动信息（前端启动时拉一次） --- */
      case 'boot': return json(res, 200, {
        ok: true,
        title: engine.world.data.meta.title,
        version: engine.bootLog && engine.bootLog.version || '1.0.0',
        stats: countWorld(engine),
        warnings: (engine.bootLog && engine.bootLog.warnings) || [],
        mods: (engine.bootLog && engine.bootLog.mods) || [],
      });

      /* --- 重载（启用/禁用 mod 后） --- */
      case 'reload': {
        engine.reload();
        return json(res, 200, { ok: true, boot: engine.bootLog, view: engine.view(), stats: countWorld(engine) });
      }

      /* --- 开局 --- */
      case 'new':
        return json(res, 200, { ok: true, view: engine.newGame(json_body || {}) });

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
        return json(res, 200, { ok: true, cmd, lines: r.lines, log: r.lines, clear: !!r.clear, action: r.action || null, openPanel: r.openPanel || null, choices: r.choices || null, choicesTitle: r.choicesTitle || null, modal: r.modal || null, ending: r.ending || null, view: r.view });
      }

      /* --- 打开面板（前端 /api/panel 或 /api/exec {cmd:'panel/xxx'}） --- */
      case 'panel': {
        const name = (json_body && json_body.panel) || query.panel || '';
        const r = engine.exec('__panel__' + name, {});
        return json(res, 200, { ok: true, action: 'panel', openPanel: name, lines: r.lines || [], log: r.lines || [], choices: null, modal: null, ending: null, view: r.view || engine.view() });
      }

      case 'menu': {
        const r = engine.menuPick(json_body || {});
        return json(res, 200, { ok: true, lines: r.lines, view: r.view });
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

      case 'view': return json(res, 200, { ok: true, view: engine.view() });

      /* --- 存读档 --- */
      case 'saves': return json(res, 200, { ok: true, saves: engine.listSaves() });
      case 'save': {
        const r = engine.save(json_body && json_body.id);
        return json(res, 200, Object.assign({ lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }], view: engine.view() }, r));
      }
      /* 云存档 → 本地落盘（前端从云拉下来后写进本地 saves/） */
      case 'save/write': {
        const r = engine.writeSave(json_body && json_body.id, json_body && json_body.data);
        return json(res, 200, r);
      }
      case 'load': {
        const r = engine.loadSave(json_body && json_body.id);
        return json(res, 200, Object.assign({ lines: [{ kind: r.ok ? 'sys' : 'warn', text: r.msg }], view: engine.view() }, r));
      }
      case 'deletesave': {
        const r = engine.deleteSave(json_body && json_body.id);
        return json(res, 200, { ok: r.ok, saves: engine.listSaves() });
      }

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

      /* --- 与 Mod 网站通信 --- */
      case 'site/config': {
        const cfg = readSiteConfig();
        return json(res, 200, { ok: true, config: cfg });
      }
      case 'site/setconfig': {
        writeSiteConfig(json_body || {});
        return json(res, 200, { ok: true, config: readSiteConfig() });
      }
      case 'site/upload': return await proxyUpload(engine, req, res, json_body);
      case 'site/remote': return await proxyRemote(engine, req, res, query);

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

/** 统计世界内容规模 */
function countWorld(engine) {
  const d = (engine.world && engine.world.data) || {};
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
    author: jb.author || cfg.author || '匿名侠客',
  };

  const result = await httpRequest(cfg.apiBase + '/api/mods', {
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
    pageUrl = cfg.apiBase.replace(/\/+$/, '') + '/' + pageUrl.replace(/^\/+/, '');
  }
  return json(res, 200, {
    ok: true, id: (result.data && result.data.id) || modId,
    updated: !!(result.data && result.data.updated),
    url: pageUrl || (cfg.apiBase + '/mod.html?id=' + encodeURIComponent(modId)),
  });
}

/** 从站点拉取 mod 列表 / 下载安装 */
async function proxyRemote(engine, req, res, query) {
  const cfg = readSiteConfig();

  /* 列表 */
  if (query.action === 'list' || !query.action) {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.cat) qs.set('cat', query.cat);
    if (query.sort) qs.set('sort', query.sort);
    if (query.page) qs.set('page', query.page);
    if (query.size) qs.set('size', query.size);
    const suffix = qs.toString() ? ('?' + qs.toString()) : '';
    const r = await httpRequest(cfg.apiBase + '/api/mods' + suffix, { method: 'GET' });
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
    const r = await httpRequest(cfg.apiBase + '/api/mods/' + encodeURIComponent(id) + '/download', { method: 'GET' });
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
    const r = await httpRequest(cfg.apiBase + '/api/health', { method: 'GET' });
    return json(res, 200, { ok: r.ok, info: r.data || null, error: r.error || null });
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

module.exports = { createServer, httpRequest };
