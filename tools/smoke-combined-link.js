/* ============================================================
 * smoke-combined-link.js — 「Mod 站与游戏同一个链接」的守卫
 *
 * 主人 2026-10-11 的要求：「希望 mod 站与游戏共用一个链接，把游戏做进 mod 站内，
 * 点 mod 站里的开始游戏就能玩」。
 *
 * 这件事的实现在**合并服务**里（`server/combined.js` 一个端口同时挂两边）：
 *   · `/`        游戏
 *   · `/site/**` Mod 站
 *   · Mod 站顶栏/首页有「▶ 开始游戏」，地址由 `/site/api/game-url` 算出来
 *   · 游戏顶栏则挂一个「⌂ Mod 客栈」回站入口（由 `/api/boot` 的 `site` 字段驱动）
 *
 * 本脚本真起一次合并服务、两边各请求一遍，确认这两条路都通 ——
 * 光看代码不算数，因为「算出来的相对路径对不对」是最容易错的地方。
 * ============================================================ */
'use strict';
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;
const PORT = 8881;

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJson(url) {
  const r = await fetch(url);
  return r.json();
}

(async () => {
  const child = spawn(NODE, [path.join(ROOT, 'server', 'combined.js')], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), SITE_PORT: String(PORT + 1), GAME_PORT: String(PORT + 2),
      NO_OPEN: '1',
    }),
    stdio: 'ignore',
  });

  const base = 'http://127.0.0.1:' + PORT;
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(350);
    try { const r = await fetch(base + '/api/boot'); up = r.ok; } catch (e) { /* 还没起来 */ }
  }

  try {
    section('① 合并服务能起来（一个端口同时挂两边）');
    ok('★ 服务起来了', up, up ? base : '（没起来，后面几项跳过）');
    if (!up) throw new Error('服务未启动');

    const boot = await getJson(base + '/api/boot');
    ok('★ 游戏页在 `/`（boot 接口通）', !!boot.ok, boot.title || '');
    ok('★ boot 里带着 Mod 站的地址（前端据此挂「⌂ Mod 客栈」入口）',
      !!(boot.site && boot.site.url), JSON.stringify(boot.site));

    section('② Mod 站在 `/site/**`，且它的「开始游戏」指向游戏页');
    const gu = await getJson(base + '/site/api/game-url');
    ok('★ Mod 站的 game-url 接口通', !!(gu && gu.ok), JSON.stringify(gu));
    ok('★ 它标明「网页可直接玩」', gu.webPlayable === true);
    /* 相对路径按 Mod 站的目录解析，必须落到游戏根 */
    const resolved = new URL(gu.url, base + '/site/').href;
    ok('★ 解析出来的地址就是游戏页', resolved === base + '/' || resolved === base,
      gu.url + ' → ' + resolved);
    const hr = await fetch(base + '/site/');
    const html = await hr.text();
    ok('★ Mod 站首页确实有「开始游戏」按钮', /开始游戏/.test(html));
    ok('★ 游戏页也是 200', (await fetch(base + '/')).ok);

    section('③ 两边真的是一套服务（同一个端口、同一个来源）');
    ok('★ 同源：Mod 站的 API 与游戏 API 挂在同一个 host:port',
      (await fetch(base + '/site/api/game-url')).ok && (await fetch(base + '/api/boot')).ok);
  } catch (e) {
    console.log('  ! ' + e.message);
  } finally {
    try { child.kill(); } catch (e) { /* ignore */ }
    await sleep(300);
  }

  console.log(`\n===== smoke-combined-link: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
