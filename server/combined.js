#!/usr/bin/env node
/* ==========================================================================
 *  武侠行 · 合并服务（单端口，云端部署用）
 *  --------------------------------------------------------------------------
 *  把「游戏服务」和「Mod 网站服务」合并到同一个公开端口上：
 *
 *      http://<host>/            → 游戏本体（可直接在网页里玩）
 *      http://<host>/game/...    → 游戏静态资源
 *      http://<host>/api/...     → 游戏 API（exec / boot / saves / mod:xxx ...）
 *      http://<host>/site/       → Mod 网站首页（列表 / 教程 / 示例 / 下载）
 *      http://<host>/site/api/.. → 网站 API（mods / stats / categories ...）
 *
 *  为什么这么分：
 *    - 游戏和网站各自都有 /api/mods 之类的路径，直接混在根目录会撞车，
 *      所以网站整体挂到 /site/ 前缀下，网站页面内部用相对路径请求，天然隔离。
 *    - 网站内部又是「本地单跑」和「合并部署」两种模式通用（相对路径两种都行）。
 *
 *  实现：两个内部服务只监听回环地址，公开端口做一层按路径分发的反向代理。
 *  零依赖，只用 Node 内置模块。
 *
 *  用法：node server/combined.js
 *  环境变量：
 *    PORT        公开监听端口（默认 8800），云端由平台注入
 *    SITE_PORT   网站内部端口（默认 8788，与游戏端默认 apiBase 保持一致）
 *    GAME_PORT   游戏内部端口（默认 8787）
 * ========================================================================== */

'use strict';

const http = require('http');
const url = require('url');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

const PUBLIC_PORT = parseInt(process.env.PORT, 10) || 8800;
const SITE_PORT = parseInt(process.env.SITE_PORT, 10) || 8788;
const GAME_PORT = parseInt(process.env.GAME_PORT, 10) || 8787;
const PUBLIC_HOST = process.env.HOST || '0.0.0.0';

/* 告诉网站服务「你是被合并部署的」——网站据此把「开始游戏」按钮指向站点上级目录。
   必须在 require(mod-site.js) 之前设置，因为它会在加载时读取。 */
process.env.COMBINED = '1';

const gameServer = require(path.join(__dirname, 'game-server.js'));
const modSite = require(path.join(__dirname, 'mod-site.js'));

/* ------------------------------------------------------------------ *
 *  内部服务启动（带端口占用自动顺延）
 * ------------------------------------------------------------------ */
function listenWithFallback(server, startPort, label) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;

    function attempt() {
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve(port);
      });
    }
    function onError(e) {
      server.removeListener('error', onError);
      if (e.code === 'EADDRINUSE' && tries < 8) {
        tries += 1;
        port += 1;
        console.log('  [' + label + '] 端口 ' + (port - 1) + ' 被占用，换用 ' + port);
        attempt();
      } else {
        reject(e);
      }
    }
    attempt();
  });
}

/* ------------------------------------------------------------------ *
 *  反向代理
 * ------------------------------------------------------------------ */
function proxyTo(targetPort, stripPrefix, req, res) {
  let pn = url.parse(req.url).pathname || '/';
  let targetPath = pn;

  if (stripPrefix && pn.indexOf(stripPrefix) === 0) {
    targetPath = pn.slice(stripPrefix.length) || '/';
  }
  if (targetPath.charAt(0) !== '/') targetPath = '/' + targetPath;

  const target = url.parse(req.url);
  const headers = Object.assign({}, req.headers);
  headers.host = '127.0.0.1:' + targetPort;
  delete headers['accept-encoding'];   /* 避免内部压缩导致内容长度不一致 */

  const upstream = http.request({
    hostname: '127.0.0.1',
    port: targetPort,
    path: targetPath + (target.search || ''),
    method: req.method,
    headers: headers,
  }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });

  upstream.on('error', (e) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('内部服务未就绪（' + targetPort + '）：' + e.message);
    } else {
      res.end();
    }
  });

  req.pipe(upstream);
}

/* ------------------------------------------------------------------ *
 *  公开路由
 * ------------------------------------------------------------------ */
function createRouter(sitePort, gamePort) {
  return http.createServer((req, res) => {
    let pn;
    try { pn = decodeURIComponent(url.parse(req.url).pathname || '/'); }
    catch (e) { pn = url.parse(req.url).pathname || '/'; }

    /* /site → /site/   （否则页面里的相对路径会解析到根目录） */
    if (pn === '/site') {
      res.writeHead(302, { Location: '/site/' });
      return res.end();
    }

    /* 网站整体：/site/**  →  内部站点的 /**  */
    if (pn.indexOf('/site/') === 0) {
      return proxyTo(sitePort, '/site', req, res);
    }

    /* 其它一律走游戏（含 /、/game/**、/api/**、/saves/**、静态资源） */
    return proxyTo(gamePort, null, req, res);
  });
}

/* ------------------------------------------------------------------ *
 *  启动
 * ------------------------------------------------------------------ */
async function main() {
  const siteServer = modSite.createSiteServer();
  const sitePort = await listenWithFallback(siteServer, SITE_PORT, '网站');

  /* 🔴 把站点的**真实内部地址**告诉游戏端（2026-10-11）。
     游戏端转发「Mod 上传 / 登录 / 拉列表」时得知道站点在哪儿，
     原先它自己写死 `http://127.0.0.1:8788` —— 可上面的 listenWithFallback
     在端口被占时会**顺延**，一旦不是 8788，上传就直接 ECONNREFUSED
     （主人亲报的「制作器上传没连到 mod 站」就是这个）。
     必须在 gameServer.createServer() 之前设，它在创建时就会读。 */
  process.env.SITE_INTERNAL_URL = 'http://127.0.0.1:' + sitePort;
  if (!process.env.SITE_PUBLIC_BASE) process.env.SITE_PUBLIC_BASE = '/site';

  const { server: gameSrv, engine } = gameServer.createServer({});
  const gamePort = await listenWithFallback(gameSrv, GAME_PORT, '游戏');

  const router = createRouter(sitePort, gamePort);
  router.listen(PUBLIC_PORT, PUBLIC_HOST, () => {
    const rooms = Object.keys(engine.world.data.rooms).length;
    const npcs = Object.keys(engine.world.data.npcs).length;

    console.log('');
    console.log('  ╔══════════════════════════════════════════════════════╗');
    console.log('  ║                                                      ║');
    console.log('  ║     武 侠 行 · 合 并 服 务   (Combined Server)        ║');
    console.log('  ║                                                      ║');
    console.log('  ╚══════════════════════════════════════════════════════╝');
    console.log('');
    console.log('   公开端口    http://' + PUBLIC_HOST + ':' + PUBLIC_PORT);
    console.log('');
    console.log('   ▶ 开始游戏  http://' + PUBLIC_HOST + ':' + PUBLIC_PORT + '/');
    console.log('   ▶ Mod 网站  http://' + PUBLIC_HOST + ':' + PUBLIC_PORT + '/site/');
    console.log('   ▶ Mod 列表  http://' + PUBLIC_HOST + ':' + PUBLIC_PORT + '/site/list.html');
    console.log('   ▶ 做 Mod    http://' + PUBLIC_HOST + ':' + PUBLIC_PORT + '/site/tutorial.html');
    console.log('');
    console.log('   数据规模    ' + rooms + ' 个地点 · ' + npcs + ' 位人物');
    console.log('   内部端口    网站 ' + sitePort + ' · 游戏 ' + gamePort);
    console.log('');
    console.log('   按 Ctrl+C 停止服务');
    console.log('');
  });

  router.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error('\n  [错误] 公开端口 ' + PUBLIC_PORT + ' 已被占用。');
      console.error('  换一个端口：PORT=8811 node server/combined.js\n');
    } else {
      console.error('\n  [错误] ' + e.message + '\n');
    }
    process.exit(1);
  });

  process.on('SIGINT', () => {
    console.log('\n  合并服务已停止。\n');
    process.exit(0);
  });
}

if (require.main === module) {
  main().catch(e => {
    console.error('\n  启动失败：' + (e && e.message || e) + '\n');
    process.exit(1);
  });
}

module.exports = { createRouter, main };
