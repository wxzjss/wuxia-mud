/* ============================================================
 * smoke-mod-account.js — 上传要登录 + 「我制作的 Mod」
 *
 * 主人 2026-10-11 原话：
 *   「把 mod 制作器里的『一键上传 Mod 网站』功能，做成需要玩家登录才能使用；
 *     在 mod 制作器左侧添加『我制作的 Mod』选项，以后方便更新」
 *
 * ⚠️ 走**真模块真函数**（不是 grep 代码里有没有某字样）：
 *    账号落盘、token 认人、上传门禁、归属判定，全都要实际跑一遍。
 * ⚠️ 数据落在**项目内临时目录**（`tools/_acctest`），跑完删掉 ——
 *    绝不能在开发者的真 `server/site-data/` 里注册账号、塞测试 Mod。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const TMP = path.join(__dirname, '_acctest');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
/* 必须在 require 之前设 —— mod-site.js 在加载时就读 DATA_DIR */
process.env.WX_SITE_DATA = TMP;

const site = require(path.join(ROOT, 'server', 'mod-site.js'));
site.ensureDirs();

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const SPEC = {
  id: 'acct_test_mod', name: '测试用的 Mod', version: '1.0.0',
  category: '剧情', desc: '回归测试用',
  rooms: [{ id: 'acct_r1', name: '一间小屋', desc: '什么都没有。' }],
};

/* ================= 一、注册 / 登录 ================= */
section('① 注册与登录');
const reg = site.apiRegister({ name: '侠客甲', pass: 'secret123' });
ok('注册成功并直接发 token', !!reg.ok && !!reg.token && reg.name === '侠客甲', JSON.stringify(reg).slice(0, 60));

const dup = site.apiRegister({ name: '侠客甲', pass: 'another1' });
ok('同名不给注册', !dup.ok && /有人用/.test(dup.error), dup.error);

const shortPass = site.apiRegister({ name: '侠客乙', pass: '123' });
ok('口令太短不给注册', !shortPass.ok, shortPass.error);

const badLogin = site.apiLogin({ name: '侠客甲', pass: 'wrongpass' });
ok('口令不对 → 明确说「口令不对」', !badLogin.ok && /口令不对/.test(badLogin.error), badLogin.error);

const noUser = site.apiLogin({ name: '查无此人', pass: 'whatever' });
ok('没有这个账号 → 明确说没有', !noUser.ok && /没有这个账号/.test(noUser.error), noUser.error);

const login = site.apiLogin({ name: '侠客甲', pass: 'secret123' });
ok('正确口令能登录', !!login.ok && !!login.token, JSON.stringify(login).slice(0, 50));
ok('token 能换回用户名', site.whoami(login.token) === '侠客甲');
ok('乱编的 token 换不回人', site.whoami('not-a-real-token') === null);
ok('空 token 不算人', site.whoami('') === null);

/* ================= 二、上传门禁 ================= */
section('② 上传必须登录');
const noTok = site.apiUpload({ json: JSON.stringify(SPEC) });
ok('★ 未登录上传被拒', !noTok.ok, noTok.error);
ok('★ 且明确标了 needLogin（前端好弹登录框）', noTok.needLogin === true);

const withBadTok = site.apiUpload({ json: JSON.stringify(SPEC), token: 'forged-token-xyz' });
ok('★ 伪造 token 也过不去', !withBadTok.ok && withBadTok.needLogin === true);

/* 登录后上传 —— 顺便试试「冒充别人署名」 */
const up1 = site.apiUpload({
  json: JSON.stringify(Object.assign({}, SPEC, { author: '冒名顶替者' })),
  token: login.token,
});
ok('★ 登录后能上传', !!up1.ok, JSON.stringify(up1).slice(0, 60));

const rec1 = (site.readIndex().mods || []).find(m => m.id === SPEC.id);
ok('★ 归属记在账号名下（owner）', rec1 && rec1.owner === '侠客甲', rec1 && JSON.stringify(rec1.owner));
ok('★ 署名被服务端写死成账号名（前端传的 author 不作数）',
  rec1 && rec1.author === '侠客甲', rec1 && rec1.author);

/* ================= 三、我制作的 Mod ================= */
section('③ 我制作的 Mod');
const mineNoTok = site.apiMyMods('');
ok('未登录 → 拿不到「我的作品」', !mineNoTok.ok && mineNoTok.needLogin === true);

const mine = site.apiMyMods(login.token);
ok('★ 登录后列得出我的作品', !!mine.ok && mine.mods.some(m => m.id === SPEC.id),
  mine.ok ? mine.mods.map(m => m.id).join(',') : mine.error);
ok('列表带版本/分类/下载量（够渲染卡片）', (() => {
  const m = mine.mods.find(x => x.id === SPEC.id);
  return m && m.version === '1.0.0' && m.category === '剧情' && typeof m.downloads === 'number';
})());

/* ================= 四、别人的作品不许顶掉 ================= */
section('④ 别人的作品顶不掉');
const reg2 = site.apiRegister({ name: '侠客乙', pass: 'secret456' });
ok('第二个账号注册成功', !!reg2.ok);

const steal = site.apiUpload({ json: JSON.stringify(SPEC), token: reg2.token });
ok('★ 改别人的 Mod ID 被拒', !steal.ok && /侠客甲/.test(steal.error || ''), steal.error);
ok('★ 原作品没被改动', (() => {
  const m = (site.readIndex().mods || []).find(x => x.id === SPEC.id);
  return m && m.owner === '侠客甲';
})());

const own2 = site.apiUpload({
  json: JSON.stringify(Object.assign({}, SPEC, { id: 'acct_test_mod_2', name: '乙的作品' })),
  token: reg2.token,
});
ok('乙发自己的东西没问题', !!own2.ok);
const mine2 = site.apiMyMods(reg2.token);
ok('★ 各人只看得到自己的（甲的作品不在乙的列表里）',
  mine2.mods.every(m => m.id !== SPEC.id) && mine2.mods.some(m => m.id === 'acct_test_mod_2'),
  mine2.mods.map(m => m.id).join(','));

/* ================= 五、登出 ================= */
section('⑤ 退出登录');
const tok = login.token;
ok('登出前 token 有效', site.whoami(tok) === '侠客甲');
site.apiLogout(tok);
ok('★ 登出后 token 立刻失效', site.whoami(tok) === null);
const afterOut = site.apiUpload({ json: JSON.stringify(SPEC), token: tok });
ok('★ 登出后不能再上传', !afterOut.ok && afterOut.needLogin === true);

/* ================= 六、口令是哈希存的 ================= */
section('⑥ 口令不落明文');
const acctRaw = fs.readFileSync(path.join(TMP, 'accounts.json'), 'utf-8');
ok('★ 账号文件里没有明文口令', acctRaw.indexOf('secret123') < 0 && acctRaw.indexOf('secret456') < 0);
ok('存的是 salt + hash', /"salt"\s*:\s*"[0-9a-f]{16,}"/.test(acctRaw) && /"hash"\s*:\s*"[0-9a-f]{32,}"/.test(acctRaw));

/* ================= 七、前端：未登录时点上传会被拦住 ================= */
section('⑦ 前端上传入口的登录门禁');
const MODMAKER = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'modmaker.js'), 'utf-8');
(function () {
  /* 最小 DOM/WX stub：只要能跑起 modmaker.js 这个 IIFE，并让它调得动 U.modal */
  const els = {};
  const mkEl = () => ({
    id: '', className: '', style: {}, value: '', textContent: '', innerHTML: '', disabled: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; }, contains(c) { return this._s.has(c); } },
    appendChild(c) { return c; }, querySelectorAll() { return []; }, querySelector() { return null; },
    setAttribute() { }, getAttribute() { return null; }, focus() { }, blur() { }, addEventListener() { },
  });
  global.document = {
    getElementById(id) { if (!els[id]) els[id] = mkEl(); els[id].id = id; return els[id]; },
    createElement: () => mkEl(),
    querySelectorAll: () => [],
    body: mkEl(),
  };
  global.window = global;

  const S = { spec: JSON.parse(JSON.stringify(SPEC)), my: null, siteConfig: {} };
  let uploadCalled = 0;
  let modalOpened = 0;
  const api = {
    siteUpload: async () => { uploadCalled++; return { ok: true }; },
    account: async () => ({ ok: false, error: '不该走到这里（未登录时就该被拦住）' }),
    accountMine: async () => ({ ok: true, name: '侠客甲', mods: [] }),
    siteRemote: async () => ({ ok: true, mod: {} }),
    siteConfig: async () => ({ apiBase: 'http://127.0.0.1:8788' }),
    editorMeta: async () => ({}),
  };
  const util = { esc: s => String(s == null ? '' : s), debounce: f => f, downloadText() { }, downloadB64() { } };
  global.WX = { S, api, util, setMe() { } };
  global.WXUI = {
    toast() { }, closeModal() { },
    /* ⚠️ 必须模拟「玩家在登录框上点了取消」：`askLogin()` 返回的 promise 只在
       按钮被点时落地，stub 里没人点 → `await` 永不返回 → 整个测试静静挂住
       （第一版就是这样，跑到这里就没下文了）。 */
    modal() {
      modalOpened++;
      setTimeout(() => {
        const btn = global.document.getElementById('acc-cancel');
        if (btn && typeof btn.onclick === 'function') btn.onclick();
      }, 0);
    },
    confirmBox: async () => true,
  };
  eval(MODMAKER);
  const MM = global.WXMM;
  ok('modmaker 能加载（IIFE 没崩）', !!MM);

  /* 未登录时点「一键上传」→ 应该弹登录框，绝不发上传请求 */
  return (async () => {
    await MM.doUpload();
    ok('★ 未登录点上传：弹的是登录框', modalOpened > 0, 'modal 次数 ' + modalOpened);
    ok('★ 未登录点上传：没有发出上传请求', uploadCalled === 0, 'siteUpload 次数 ' + uploadCalled);

    /* 标签页里确实有「我制作的 Mod」 */
    ok('★ 左侧标签注册表里有 mine', /'mine'/.test(MODMAKER.slice(MODMAKER.indexOf('const TABS'))));
    ok('未登录时 tabMine 给的是「去登录」而不是空表',
      /还没登录/.test(MODMAKER) && /mm-mine-login/.test(MODMAKER));
  })();
})().then(() => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
}).catch(e => {
  fs.rmSync(TMP, { recursive: true, force: true });
  console.error('异常：', e && e.stack || e);
  process.exit(1);
});
