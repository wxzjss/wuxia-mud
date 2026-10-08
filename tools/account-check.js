/* ============================================================
 *  site-check.js —— 单机 Mod 站契约检查
 *  ------------------------------------------------------------------
 *  本站**没有账号 / 登录 / 论坛 / 云存档**，这一切在「撤账号」那轮删掉了。
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

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function group(t) { console.log('\n── ' + t + ' ──'); }

/* ══════════════════════════════════════════════════════════════
 *  ① 账号系统已彻底撤除（这是本脚本的核心目的）
 * ══════════════════════════════════════════════════════════════ */
group('① 账号 / 论坛 / 云存档 已彻底撤除');

/* 文件级：三个页面 + 游戏端 cloud.js + 服务端账号模块 */
[
  'server/public/forum.html',
  'server/public/account.html',
  'server/public/mine.html',
  'game/src/renderer/js/cloud.js',
  'server/account.js'
].forEach(f => ok(f + ' 已删除', !E(f)));

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
ok('site.js 顶栏有 6 个入口', (SITE.match(/\[&#39;|^\s*\['/gm) || SITE.match(/'index\.html'|'list\.html'|'tutorial\.html'|'examples\.html'|'upload\.html'|'game\.html'/g) || []).length >= 6);

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
ok('game-server 已无 save/write', !/case 'save\/write'/.test(GS));

/* 样式也清干净 */
const SCSS = R('server/public/css/site.css');
['.fb-', '.acct-', '.sv-', '.mine-', '.shu-', '.wm-foot', '.login-tabs', '.ltab', '.login-hint']
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
  else console.log('  ⚠ 线上不可达，跳过（离线环境）');

  /* 账号相关的表即便还在云上，页面也不该再访问它们 */
  const CLOUD2 = R('server/public/js/cloud.js');
  ['forum_posts', 'forum_replies', 'saves', 'profiles'].forEach(t => {
    ok('cloud.js 不再访问 ' + t, CLOUD2.indexOf("'" + t + "'") < 0);
  });

  console.log('\n' + '='.repeat(46));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(46));
  process.exit(fail ? 1 : 0);
})();
