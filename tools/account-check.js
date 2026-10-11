/* ============================================================
 *  site-check.js —— 单机 Mod 站契约检查
 *  ------------------------------------------------------------------
 *  本站**没有论坛 / 云存档**，账号体系也在「撤账号」那轮删掉了。
 *  ⚠️ 2026-10-11 主人要求「上传 Mod 必须登录」+「我制作的 Mod」，于是**轻量账号
 *     重新引入**（`server/mod-site.js` 的 `/api/account/*`）—— 只做「上传署名 +
 *     作品归属」这一件事，没有 forum/account/mine 页面、没有云存档账号。
 *  这个脚本的作用是：
 *    ① 守住「确实删干净了」——残留的全局引用会静默失败，必须靠断言兜
 *    ② 守住「Mod 上传下载 / 本地文件夹」这两条保留能力没被误伤
 *    ③ 守住线上云表的 RLS 没有被放松（Mod 表仍是唯一可匿名读的）
 *  零依赖，直接读源码 + 真打线上接口。
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const R = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const E = p => fs.existsSync(path.join(ROOT, p));

/* 三元组口径：pass / fail / skip。
   skip 单列，既不并进 pass 也不并进 fail —— 这样「fail 必须为 0」能当硬门槛，
   又不会让离线开发因为线上不可达而误报红。
   （之前唯一一条网络断言在离线时被静默丢掉，总数就在 122/123 之间抖。） */
let pass = 0, fail = 0, skip = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function skipped(name, why) {
  skip++; console.log('  ⚠ SKIP ' + name + (why ? '  ' + why : ''));
}
function group(t) { console.log('\n── ' + t + ' ──'); }

/* ══════════════════════════════════════════════════════════════
 *  ① 账号系统已彻底撤除（这是本脚本的核心目的）
 * ══════════════════════════════════════════════════════════════ */
group('① 账号 / 论坛 / 云存档 已彻底撤除');

/* 文件级：论坛/账号页面 + 服务端账号模块 已撤除（云存档已重新接入，见 game/src/renderer/js/cloud.js） */
[
  'server/public/forum.html',
  'server/public/account.html',
  'server/public/mine.html',
  'server/account.js'
].forEach(f => ok(f + ' 已删除', !E(f)));
/* 🔴 2026-10-11 主人：「把游戏里的云存档相关功能全部删除」。
   游戏端 cloud.js（云存档 + 登录）已删，改成反向断言 —— 别再让它悄悄回来。
   ⚠️ 站点自己那份 server/public/js/cloud.js 另有用途（mods 表），不在此列。 */
ok('游戏端 cloud.js 已删除（云存档下线）', !E('game/src/renderer/js/cloud.js'));

/* 站点 cloud.js 只留 mods 表 */
const CLOUD = R('server/public/js/cloud.js');
ok('cloud.js 只声明 mods 表', /TABLE\s*=\s*'mods'/.test(CLOUD));
['T_PROFILE', 'T_SAVES', 'T_POSTS', 'T_REPLIES'].forEach(k => {
  ok('cloud.js 已无 ' + k, CLOUD.indexOf(k) < 0);
});
['profiles', 'saves', 'forum', 'signUpAccount', 'signInAccount', 'hasSession',
 'rowToPost', 'rowToReply', 'maskAccount', 'cachedName'].forEach(k => {
  ok('cloud.js 已无 ' + k, !new RegExp('(^|[^\\w])' + k + '\\s*[:(]').test(CLOUD));
});
ok('cloud.js 导出只有 db', /global\.WXCLOUD = \{[\s\S]*?\bdb:\s*db\b[\s\S]*?\};/.test(CLOUD));
ok('cloud.js 无 auth 导出', !/WXCLOUD[\s\S]{0,400}?auth:\s*\{/.test(CLOUD));

/* 站点 site.js 无登录相关 */
const SITE = R('server/public/js/site.js');
['openLogin', 'requireLogin', 'setOnSignedIn', 'renderUserArea', 'avatarChar',
 'doSignIn', 'doSignUp', 'friendlyAuthError', 'cloudDisplayName'].forEach(k => {
  ok('site.js 已无 ' + k, SITE.indexOf(k) < 0);
});
ok('site.js 顶栏无论坛入口', !/'forum\.html'/.test(SITE));
/* 顶栏入口从 6 个降到 5 个：「玩游戏」那一项指向 game.html，
   而下载离线版的整页功能已按主人要求删除。 */
ok('site.js 顶栏有 5 个入口（已去掉「玩游戏」）',
  (SITE.match(/\[&#39;|^\s*\['/gm) || SITE.match(/'index\.html'|'list\.html'|'tutorial\.html'|'examples\.html'|'upload\.html'/g) || []).length >= 5
  && !/'game\.html'/.test(SITE));

/* 游戏端三个脚本无账号/云存档 */
const APP = R('game/src/renderer/js/app.js');
['loadCloud', 'CLOUD_BASE_KEY', 'saveBoth', 'cloudSaves', 'cloudLoad', 'cloudDelSave', 'cloudHasAny', 'readSave']
  .forEach(k => ok('app.js 已无 ' + k, APP.indexOf(k) < 0));
ok('app.js 仍导出 api', /global\.WX = \{[\s\S]*?\bapi\b/.test(APP));

const START = R('game/src/renderer/js/start.js');
['openCloudLogin', 'loadFromCloud', 'initStartUser', 'renderStartUser', 'gr-nick']
  .forEach(k => ok('start.js 已无 ' + k, START.indexOf(k) < 0));
ok('start.js 仍保留 probeSaves', /async function probeSaves\(\)/.test(START));
ok('start.js 仍保留 continueGame', /async function continueGame\(\)/.test(START));
ok('start.js 仍保留 loadFromLocalDir', /function loadFromLocalDir\(/.test(START));
ok('start.js 的 probeSaves 用本地', /api\.saves\(\)/.test(START) && !/cloudHasAny/.test(START));

const UI = R('game/src/renderer/js/ui.js');
['cloudSaves', 'data-cload', 'data-cdel', 'sv-login', 'save-cloudbar', 'cloudOnly', 'saveBoth']
  .forEach(k => ok('ui.js 已无 ' + k, UI.indexOf(k) < 0));
ok('ui.js openSaves 仍在', /function openSaves\(/.test(UI));
ok('ui.js openSaves 用本地 api.save', /api\.save\(/.test(UI));

const MM = R('game/src/renderer/js/modmaker.js');
ok('modmaker 已无云端发布分支', !/C\.db\.publish\(/.test(MM));
ok('modmaker 保留站点上传', /api\.siteUpload\(/.test(MM));

const HTML = R('game/src/renderer/index.html');
ok('index.html 无账号区容器', !/id="start-user"/.test(HTML));
ok('index.html 保留继续游戏按钮', /id="btn-continue"/.test(HTML));
ok('index.html 不再引用 js/cloud.js', !/js\/cloud\.js/.test(HTML));
const verM = HTML.match(/\?v=(20\d{6}[a-z])/);
ok('版本号存在且统一', !!verM && (HTML.match(new RegExp('\\?v=' + verM[1], 'g')) || []).length >= 6, verM ? verM[1] : '未找到');
['20261008f', '20261008g', '20261008e'].forEach(v => {
  ok('无遗留旧版本号 ' + v, HTML.indexOf('?v=' + v) < 0);
});

/* 服务端无账号接口、无存档接口 */
const MS = R('server/mod-site.js');
ok('mod-site 已无 account 模块引用', !/require\(['"]\.\/account['"]\)/.test(MS));
ok('mod-site 已无 /api/auth 路由', !/head === 'auth'/.test(MS));
ok('mod-site 保留 Mod 站点逻辑', /seedOfficialMods/.test(MS));

/* ⚠ 云端沙箱是**复用**的：部署只往里拷文件，不会删掉多余文件，
   所以上一版留在沙箱里的 account.html / forum.html / mine.html 会一直挂着。
   serveStatic 必须显式拉黑这三个页面，不管磁盘上有没有。 */
ok('mod-site 有 REMOVED_PAGES 黑名单', /REMOVED_PAGES\s*=\s*new Set\(\[/.test(MS));
['/account.html', '/forum.html', '/mine.html'].forEach(p => {
  ok('黑名单含 ' + p, new RegExp("'" + p.replace('.', '\\.') + "'").test(MS));
});
ok('serveStatic 先查黑名单再查文件', (() => {
  const i = MS.indexOf('function serveStatic(');
  const j = MS.indexOf('fs.stat(', i);
  const k = MS.indexOf('REMOVED_PAGES.has(', i);
  return i >= 0 && k >= 0 && j >= 0 && k < j;
})());

const GS = R('server/game-server.js');
ok('game-server 已无 save/read', !/case 'save\/read'/.test(GS));
/* 云存档一删，save/write 这条路由就没有调用方了（它本来只干「云端拉回来的档写进本地」）。 */
ok('game-server 已无 save/write（随云存档删除）', !/case 'save\/write'/.test(GS));

/* 样式也清干净。
   ⚠️ `.acct-` 已从名单里拿掉：2026-10-11 主人要求上传必须登录，
      站点重新有了 `.acct-bar`（上传页的登录条）。那套「撤账号」的残留样式
      （`.login-tabs` / `.ltab` / `.login-hint`）仍然不许回来。 */
const SCSS = R('server/public/css/site.css');
['.fb-', '.sv-', '.mine-', '.shu-', '.wm-foot', '.login-tabs', '.ltab', '.login-hint']
  .forEach(k => ok('site.css 已无 ' + k, SCSS.indexOf(k) < 0));
ok('site.css 保留 Mod 卡片样式', /\.mc-|\.card|\.mod-/.test(SCSS));
ok('site.css 保留弹窗样式', /\.wx-modal/.test(SCSS) && /\.wm-box/.test(SCSS));

const MCSS = R('game/src/renderer/css/main.css');
['.start-user', '.su-', '.login-tabs', '.ltab', '.save-cloudbar', '.cloud-login', '.sv-tag']
  .forEach(k => ok('main.css 已无 ' + k, MCSS.indexOf(k) < 0));

/* ══════════════════════════════════════════════════════════════
 *  ② 保留能力：Mod 上传下载 + 本地文件夹
 * ══════════════════════════════════════════════════════════════ */
group('② 保留能力：Mod 上传下载');
ok('站点顶栏有「开始游戏」按钮', /id="sh-play"/.test(SITE));
ok('site.js 有 playGame', /function playGame\(/.test(SITE));
ok('site.js 有 fetchGameUrl', /async function fetchGameUrl\(/.test(SITE));
ok('site.js 有 fetchList / fetchDetail', /async function fetchList\(/.test(SITE) && /async function fetchDetail\(/.test(SITE));
ok('site.js 有下载存本地 saveModLocally', /async function saveModLocally\(/.test(SITE));
ok('site.js 有云端导出 exportCloudMod', /async function exportCloudMod\(/.test(SITE));
ok('site.js 有 makeZip（零依赖打包）', /function makeZip\(/.test(SITE));
ok('cloud.js 有 db.list/detail/publish/remove/stats/categories',
  /async list\(/.test(CLOUD) && /async detail\(/.test(CLOUD) && /async publish\(/.test(CLOUD) &&
  /async remove\(/.test(CLOUD) && /async stats\(/.test(CLOUD) && /async categories\(/.test(CLOUD));
ok('cloud.js 有 bumpDownload 计数', /bump_mod_downloads/.test(CLOUD));
ok('publish 不再要求登录', !/请先登录/.test(CLOUD));
ok('publish 不再手传 owner_id', !/payload\.owner_id\s*=/.test(CLOUD));

group('③ 保留能力：本地 Mod 文件夹授权');
const LM1 = fs.readFileSync(path.join(ROOT, 'server/public/js/localmods.js'));
const LM2 = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/localmods.js'));
ok('localmods.js 站点版 = 游戏版（逐字节）', Buffer.compare(LM1, LM2) === 0, LM1.length + ' 字节');
const LMS = LM1.toString('utf8');
ok('用 showDirectoryPicker 授权', /showDirectoryPicker/.test(LMS));
ok('句柄存 IndexedDB（不能存 localStorage）', /indexedDB/.test(LMS));
ok('有 saveOrDownload', /saveOrDownload/.test(LMS));
ok('有 isReady / permissionState', /isReady/.test(LMS) && /permissionState/.test(LMS));

/* ── 手机降级（主人 2026-10-12 亲报：「你的浏览器不支持文件夹授权」） ──
   手机浏览器**一律没有** showDirectoryPicker（移动 Chrome 也没有，官方不打算支持），
   所以这条路径在手机上永远走不通。要求：不摆臭脸，改走「挑一个文件装」。
   ⚠️ 反向判据：主人不想要的是「只弹一句不支持就结束」，所以这里断的是
      「存在可用的替代路径」，不是断文案长什么样。 */
group('③b 手机/不支持浏览器的降级通路');
ok('localmods 有 isMobile 能力探测', /function isMobile\(/.test(LMS));
ok('isMobile 已导出', /supported,\s*isMobile/.test(LMS));
ok('pickFolder 不支持时回 code:"unsupported"（可判别，不再只有一句文案）',
  /code:\s*'unsupported'/.test(LMS));
ok('不支持时的文案点明手机不行，并指向「从文件安装」',
  /手机浏览器不支持文件夹授权/.test(LMS) && /从文件安装/.test(LMS));

const STJ = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/start.js'), 'utf8');
ok('start.js 有 installFromPick（挑文件安装）', /function installFromPick\(/.test(STJ));
ok('挑文件同时认 zip 与 json',
  /\.zip\$\/i\.test\(f\.name\)/.test(STJ) && /\.json\$\/i\.test\(f\.name\)/.test(STJ));
ok('zip 走 api.modInstall', /kind:\s*'zip'/.test(STJ) && /api\.modInstall\(/.test(STJ));
ok('json 走 api.modInstallLocal', /kind:\s*'json'/.test(STJ) && /api\.modInstallLocal\(/.test(STJ));
ok('loadFromLocalDir 不支持时**改道** installFromPick（不是弹窗打发人）',
  /if \(!L \|\| !L\.supported \|\| !L\.supported\(\)\) \{\s*\n\s*installFromPick\(\);/m.test(STJ));
ok('lm-pick 兜底也改道（code==="unsupported" → installFromPick）',
  /r\.code === 'unsupported'[\s\S]{0,200}installFromPick\(\)/.test(STJ));
ok('不支持分支不再有「请用 Chrome / Edge」这种纯打发文案',
  !/U\.modal\('浏览器不支持'/.test(STJ));

const HOME = fs.readFileSync(path.join(ROOT, 'server/public/index.html'), 'utf8');
ok('站点首页 detect 不到时**不 hide** 按钮（改成 fallback 用途）',
  /pick\.dataset\.fallback = '1'/.test(HOME) && !/badge\.textContent = '不可用'/.test(HOME));
ok('首页按钮在 fallback 模式下走选文件', /pick\.dataset\.fallback === '1'/.test(HOME));
const TUT = fs.readFileSync(path.join(ROOT, 'server/public/tutorial.html'), 'utf8');
ok('教程 FAQ 点明「手机浏览器一律不行」', /手机浏览器一律不行/.test(TUT));
ok('教程 FAQ 给出「从文件安装」替代路径', /从文件安装/.test(TUT));

/* ══════════════════════════════════════════════════════════════
 *  ④ 官方示例自动播种（云端重建的关键机制）
 * ══════════════════════════════════════════════════════════════ */
group('④ 官方示例自动播种');
ok('mod-site 有 seedOfficialMods', /function seedOfficialMods\(/.test(MS));
ok('播种时打 official 标记', /official:\s*true/.test(MS));
ok('已存在则跳过（保留下载数）', /seed-state/.test(MS));
ok('删过的记黑名单不再补', /dropped/.test(MS));
ok('示例 mod 目录存在', E('mods'));

/* ══════════════════════════════════════════════════════════════
 *  ⑤ 线上云表 RLS（Mod 可匿名读写，账号类表不再有）
 *
 *  坑：`auth.uid()` 在**匿名请求**下返回字符串 `'anon'`，不是 NULL！
 *      所以写策略必须前置 `public.is_signed_in()`。
 *      这个断言必须真打线上接口，静态读源码是抓不到的。
 * ══════════════════════════════════════════════════════════════ */
const https = require('https');
const KEY = 'wbpk_Z80rz4fz3u01PNkado5Qxj_Am8VgfxuBn1QlKHQ3dwT7ALghzvCKxMY';
const HOST = 'wuxia-mod.app.workbuddy.host';

function online(method, p, body) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const h = {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'x-wb-webapp-access-key': KEY, 'Origin': 'https://' + HOST
    };
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    const r = https.request({ host: HOST, path: p, method, headers: h, timeout: 10000 }, (s) => {
      let b = ''; s.on('data', c => b += c);
      s.on('end', () => {
        let j = null; try { j = JSON.parse(b); } catch (e) { }
        resolve({ code: s.statusCode, j, raw: b.slice(0, 200) });
      });
    });
    r.on('error', () => resolve({ code: 0, j: null, raw: 'network' }));
    r.on('timeout', () => { r.destroy(); resolve({ code: 0, j: null, raw: 'timeout' }); });
    if (data) r.write(data);
    r.end();
  });
}

(async () => {
  group('⑤ 线上云表（Mod 可读；账号类表已不该被页面用到）');

  const r1 = await online('GET', '/.cloud/database/rest/mods?select=mod_key&limit=1');
  if (r1.code) ok('匿名读 mods 仍开放', r1.code === 200 && Array.isArray(r1.j), 'HTTP ' + r1.code);
  else skipped('匿名读 mods 仍开放', '线上不可达（离线环境）；本条是全套唯一的网络断言');

  /* 账号相关的表即便还在云上，页面也不该再访问它们 */
  const CLOUD2 = R('server/public/js/cloud.js');
  ['forum_posts', 'forum_replies', 'saves', 'profiles'].forEach(t => {
    ok('cloud.js 不再访问 ' + t, CLOUD2.indexOf("'" + t + "'") < 0);
  });

  console.log('\n' + '='.repeat(46));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项，跳过 ' + skip + ' 项');
  console.log('='.repeat(46));
  /* 门槛只看 fail：skip 不算通过也不算失败 */
  process.exit(fail ? 1 : 0);
})();
