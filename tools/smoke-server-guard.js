/**
 * smoke-server-guard.js —— HTTP 层「不该被公网取到的东西」回归
 *
 * 起一个**真服务**（combined.js，随机高位端口），用**真 HTTP 请求**验证：
 *   ① `/saves/**` 必须取不到（默认关闭；只有显式 `WX_ALLOW_SAVES=1` 才开）
 *      —— 线上实测过 `GET /saves/test_slot.json` 返回 200，
 *         而公网上 `saves/` 是**所有访问者共用的服务端目录**（自动存档按设备 id 落盘），
 *         等于把别人的存档挂在公网 URL 上。
 *   ② 正常入口仍然可用（`/`、`/api/boot`、`/js/ui.js`）—— 防「一刀切封死把游戏也封了」。
 *   ③ `/saves/**` 走的是 404 而不是 500 —— 防「修成崩」。
 *
 * ⚠️ 为什么不用静态 grep 当断言：本项目抓过 11+ 处假绿，其中就有「grep 代码里有没有某字样」。
 *    路由是否真的挡住，只有**发一次请求**才算数。
 * ⚠️ 端口用高位随机值，避免与开发者本机 8800 冲突；测完必杀进程。
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = 18000 + Math.floor(Math.random() * 2000);
/* ⚠️ 存档目录必须隔离（2026-10-18 实测踩到）：
   本守卫 ④-a 断言「未起局 /api/quest → 404」，而服务端 boot 会把仓库 `saves/_live.json`
   当成活档恢复——别的 lane 本地跑测试留下的活档（实测玩家名「严过关」）让「未起局」
   永远不成立，红得莫名其妙。⇒ 起服务时指一个本轮独占的 .livetest 沙盒目录。 */
const SAVE_DIR = require('./_test-tmp').testTmpDir('srvguard');
require('fs').mkdirSync(SAVE_DIR, { recursive: true });
let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function section(t) { console.log('\n' + t); }

function get(p) {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: p, timeout: 6000 }, res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.on('error', e => resolve({ code: 0, body: '', err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '', err: 'timeout' }); });
  });
}

function post(p, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body || {});
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: 'POST', timeout: 6000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => resolve({ code: res.statusCode, body: b }));
    });
    req.on('error', e => resolve({ code: 0, body: '', err: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ code: 0, body: '', err: 'timeout' }); });
    req.write(payload); req.end();
  });
}

/* 等端口就绪（最长 ~12s）：轮询 /api/boot */
async function waitReady() {
  for (let i = 0; i < 40; i++) {
    const r = await get('/api/boot');
    if (r.code === 200) return true;
    await new Promise(r2 => setTimeout(r2, 300));
  }
  return false;
}

(async () => {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'combined.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), SITE_PORT: String(PORT + 1), GAME_PORT: String(PORT + 2),
      WX_SAVE_DIR: SAVE_DIR,
    }),
    stdio: 'ignore',
  });

  let killed = false;
  const kill = () => { if (!killed) { killed = true; try { child.kill('SIGKILL'); } catch (e) { } } };
  process.on('exit', kill);

  try {
    const ready = await waitReady();
    ok('服务能在随机端口起来', ready, 'port=' + PORT);
    if (!ready) throw new Error('服务器未就绪，后续断言无意义');

    section('① 正常入口仍可用（防「一刀切封死」）');
    const home = await get('/');
    ok('①-a 首页 200', home.code === 200, 'HTTP ' + home.code);
    ok('①-b 首页里有页面标题', /武侠行/.test(home.body), '(body 里找不到「武侠行」)');
    const boot = await get('/api/boot');
    ok('①-c /api/boot 200 且 ok:true', boot.code === 200 && /"ok":true/.test(boot.body), 'HTTP ' + boot.code);
    const js = await get('/js/ui.js');
    ok('①-d 前端资源可取（/js/ui.js 200 且有内容）', js.code === 200 && js.body.length > 1000,
      'HTTP ' + js.code + ' len=' + js.body.length);

    section('② /saves/** 必须取不到');
    const s1 = await get('/saves/test_slot.json');
    ok('②-a /saves/<文件> 不是 200（本地存档不上公网）', s1.code !== 200, 'HTTP ' + s1.code);
    ok('②-b 走的是 404 而不是 500（防「修成崩」）', s1.code === 404, 'HTTP ' + s1.code);
    const s2 = await get('/saves/');
    ok('②-c 目录入口也不是 200（无目录列举/读取）', s2.code !== 200, 'HTTP ' + s2.code);
    /* 穿越尝试：即使关掉前缀，也不能靠 ../ 绕出去 */
    const s3 = await get('/saves/../game/data/40_npcs.json');
    ok('②-d 路径穿越取不到游戏数据', s3.code !== 200 || !/"npcs"/.test(s3.body), 'HTTP ' + s3.code);
    const s4 = await get('/saves/%2e%2e/game/data/40_npcs.json');
    ok('②-e 编码穿越同样取不到', s4.code !== 200 || !/"npcs"/.test(s4.body), 'HTTP ' + s4.code);

    section('③ 存档功能本身没被误伤（走 API，不走静态）');
    const saves = await get('/api/saves');
    ok('③-a /api/saves 正常（列档接口 200）', saves.code === 200 && /"ok":true/.test(saves.body),
      'HTTP ' + saves.code);

    /* ④ 未起局（`world.player === null`）时，**任何**路由都不许 500。
       线上实测踩到过：沙箱刚部署完、玩家还没选出身，`POST /api/quest` 因为
       `p.questStage` 读到 null 抛 TypeError → 500 → 前端拿到的是报错而不是
       「退回旧行为」。这类「只在没开局时才炸」的路径，本地测不出来
       （本地测试全都先 newGame 了），只有**真起一个服务、真发一次请求**才算数。 */
    section('④ 未起局时所有路由都不许 5xx');
    const routes = [
      ['/api/state', {}], ['/api/boot', {}], ['/api/births', {}],
      ['/api/saves', {}], ['/api/view', {}], ['/api/mods', {}],
      ['/api/npc', { uid: 'master_yue' }],
      ['/api/quest', { qid: 'q_herb_collect' }],
      ['/api/panel', { panel: 'slaves' }],
      ['/api/exec', { cmd: 'look' }],
      ['/api/quick', { action: 'look' }],
      ['/api/combat', {}],
    ];
    for (const [p, b] of routes) {
      const r = await post(p, b);
      ok('④ ' + p + ' 不是 5xx', r.code > 0 && r.code < 500,
        'HTTP ' + r.code + (r.body ? ' ' + String(r.body).slice(0, 70) : ''));
    }
    /* 明确守住刚修的那条：/api/quest 未起局应回 404 而不是 500 */
    const q0 = await post('/api/quest', { qid: 'q_herb_collect' });
    ok('④-a /api/quest 未起局 → 404（不是 500）', q0.code === 404, 'HTTP ' + q0.code);
  } catch (e) {
    ok('测试自身异常：' + (e && e.message), false);
  } finally {
    kill();
  }

  console.log('\n' + '='.repeat(40));
  console.log(`  HTTP 守卫回归：${pass} 通过 / ${fail} 失败`);
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('='.repeat(40));
  process.exit(fail ? 1 : 0);
})();
