#!/usr/bin/env node
/* 武侠行 · 端到端联调测试
 * 用法：先启动两个服务，再 node tools/e2e.js
 */
'use strict';
const http = require('http');

function req(method, url, bodyObj, binary) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method, headers: { 'Content-Type': 'application/json' }
    };
    const r = http.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const d = raw.toString('utf8');
        let json = null;
        try { json = JSON.parse(d); } catch (e) { }
        resolve({ code: res.statusCode, body: d, json, buf: raw, headers: res.headers });
      });
    });
    r.on('error', reject);
    if (bodyObj) r.write(JSON.stringify(bodyObj));
    r.end();
  });
}

const G = 'http://127.0.0.1:8787';
const S = 'http://127.0.0.1:8788';

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  \u2714 ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  \u2718 ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  /* ---------- Mod 站 ---------- */
  console.log('\n\u2500\u2500 Mod 站 (' + S + ') \u2500\u2500');
  let r = await req('GET', S + '/api/health');
  ok('健康检查', r.code === 200 && r.json && r.json.ok, r.json && r.json.name);

  r = await req('GET', S + '/api/stats');
  const st = r.json && r.json.stats;
  ok('统计接口', r.code === 200 && st, st ? ('mods=' + st.mods + ' downloads=' + st.downloads) : '');

  r = await req('GET', S + '/api/categories');
  ok('分类接口', r.code === 200 && r.json && r.json.categories, r.json ? ('分类数=' + (r.json.categories || []).length) : '');

  r = await req('GET', S + '/');
  ok('首页 HTML', r.code === 200 && /武侠行/.test(r.body), 'len=' + r.body.length);
  r = await req('GET', S + '/list.html');
  ok('列表页 HTML', r.code === 200 && /Mod 列表/.test(r.body));
  r = await req('GET', S + '/tutorial.html');
  ok('教程页 HTML', r.code === 200 && /小白/.test(r.body), 'len=' + r.body.length);
  r = await req('GET', S + '/examples.html');
  ok('示例页 HTML', r.code === 200 && /示例/.test(r.body));
  r = await req('GET', S + '/upload.html');
  ok('上传页 HTML', r.code === 200 && /发布/.test(r.body));
  r = await req('GET', S + '/game.html');
  ok('玩game页 HTML', r.code === 200 && /武侠行/.test(r.body));
  /* 网页优先：主按钮是「开始游戏」（跳游戏网页），离线下载降级为备选 */
  ok('玩game页有「开始游戏」主按钮', r.code === 200 && /id="btn-play"/.test(r.body));
  ok('玩game页保留离线下载作备选', r.code === 200 && /离线版/.test(r.body));

  /* 一键下载游戏（核心功能） */
  r = await req('GET', S + '/api/game-pack');
  ok('打包信息接口', r.code === 200 && r.json && r.json.ok && r.json.files > 20,
    r.json ? ('files=' + r.json.files + ' raw=' + (r.json.rawBytes / 1024).toFixed(0) + 'KB v' + r.json.version) : '');

  r = await req('GET', S + '/api/download-game', null, true);
  const zipOk = r.code === 200 && r.buf && r.buf.length > 10000 &&
    r.buf[0] === 0x50 && r.buf[1] === 0x4b; /* PK zip 魔数 */
  ok('一键下载游戏', zipOk, zipOk
    ? ((r.buf.length / 1024).toFixed(0) + ' KB, ' + (r.headers['x-pack-files'] || '?') + ' 文件')
    : ('code=' + r.code));
  ok('下载文件名规范', /jinyong-mud/.test(String(r.headers['content-disposition'] || '')),
    r.headers['content-disposition']);

  /* 首页主入口也改成「开始游戏」（网页优先），并带本地 Mod 文件夹卡片 */
  r = await req('GET', S + '/');
  ok('首页有「开始游戏」主按钮', r.code === 200 && /id="hero-play"/.test(r.body));
  ok('首页有本地 Mod 文件夹卡片', r.code === 200 && /id="localmod-box"/.test(r.body));
  ok('首页加载本地 Mod 模块', r.code === 200 && /js\/localmods\.js/.test(r.body));

  r = await req('GET', S + '/mod.html?id=xxx');
  ok('详情页 HTML', r.code === 200);
  ok('详情页加载本地 Mod 模块', r.code === 200 && /js\/localmods\.js/.test(r.body));
  for (const f of ['css/site.css', 'js/site.js', 'js/examples.js', 'js/localmods.js']) {
    r = await req('GET', S + '/' + f);
    ok('静态 ' + f, r.code === 200 && r.body.length > 500, 'len=' + r.body.length);
  }

  /* ---- 游戏地址解析（「开始游戏」按钮的点） ---- */
  r = await req('GET', S + '/api/game-url');
  ok('game-url 接口', r.code === 200 && r.json && r.json.ok && !!r.json.url, r.json && r.json.url);
  ok('game-url 标注可网页玩', !!(r.json && r.json.webPlayable));
  r = await req('GET', S + '/api/config');
  ok('config 带 game 信息', r.code === 200 && r.json && r.json.game && !!r.json.game.url);
  /* localmods.js 必须暴露 start.js / index.html 用到的全部方法 */
  r = await req('GET', S + '/js/localmods.js');
  (function () {
    const src = r.body || '';
    const need = ['supported', 'permissionState', 'isReady', 'folderName',
      'pickFolder', 'restore', 'forget', 'writeFile', 'readFile',
      'saveOrDownload', 'scanMods'];
    const missing = need.filter(k => !new RegExp('\\b' + k + '\\b').test(src));
    ok('localmods 契约完整', missing.length === 0, missing.length ? ('缺 ' + missing.join(',')) : (need.length + ' 个方法'));
  })();

  /* 上传一个测试 Mod */
  const testMod = {
    id: 'e2e_test_mod',
    name: 'E2E 测试 Mod',
    version: '1.0.0',
    author: '自动测试',
    category: '地图',
    desc: '联调测试用的临时 Mod。',
    tags: ['测试'],
    rooms: [{ id: 'e2e_room', name: '测试房间', desc: '一个用于测试的房间。', exits: { s: 'jiangnan_street' } }]
  };
  r = await req('POST', S + '/api/mods', { json: JSON.stringify(testMod), note: '自动化测试' });
  ok('上传 Mod', r.code === 200 && r.json && r.json.ok, r.json ? (r.json.id || r.json.error) : '');
  const upOk = r.json && r.json.ok;

  if (upOk) {
    r = await req('GET', S + '/api/mods/e2e_test_mod');
    ok('详情可查', r.code === 200 && r.json && r.json.ok && r.json.mod.name === 'E2E 测试 Mod');

    r = await req('GET', S + '/api/mods/e2e_test_mod/download');
    ok('下载接口', r.code === 200 && r.json && r.json.ok && !!r.json.json);

    r = await req('GET', S + '/api/mods?q=E2E');
    ok('搜索命中', r.code === 200 && r.json && r.json.total >= 1, 'total=' + (r.json && r.json.total));

    r = await req('GET', S + '/api/mods?cat=地图');
    ok('分类过滤', r.code === 200 && r.json && r.json.total >= 1, 'total=' + (r.json && r.json.total));

    r = await req('POST', S + '/api/mods/e2e_test_mod/delete', {});
    ok('删除 Mod', r.code === 200 && r.json && r.json.ok);
  }

  /* 无效上传应被拒 */
  r = await req('POST', S + '/api/mods', { json: JSON.stringify({ id: 'bad_mod', name: '空 Mod' }) });
  ok('拒绝空内容 Mod', r.code === 400 && r.json && !r.json.ok, r.json && r.json.error);

  r = await req('POST', S + '/api/mods', { json: 'not json at all' });
  ok('拒绝非法 JSON', r.code === 400 && r.json && !r.json.ok);

  /* ---------- 游戏服务 ---------- */
  console.log('\n\u2500\u2500 游戏服务 (' + G + ') \u2500\u2500');
  r = await req('GET', G + '/api/boot');
  ok('boot 接口', r.code === 200 && r.json, r.json ? JSON.stringify(r.json.stats) : '');

  r = await req('GET', G + '/api/births');
  ok('出身列表', r.code === 200 && r.json && (r.json.births || []).length >= 6, '出身数=' + ((r.json && r.json.births || []).length));

  r = await req('GET', G + '/');
  ok('游戏首页 HTML', r.code === 200 && /武侠行/.test(r.body), 'len=' + r.body.length);

  for (const f of ['js/app.js', 'js/ui.js', 'js/modmaker.js', 'js/docdata.js', 'js/start.js', 'css/main.css']) {
    r = await req('GET', G + '/' + f);
    ok('静态 ' + f, r.code === 200 && r.body.length > 1000, 'len=' + r.body.length);
  }

  /* ---------- 缓存策略回归 ----------
     历史 bug：.html 是 no-store，但 .js/.css 给了 max-age=300，
     发版后用户刷新页面拿到新 HTML 却继续跑缓存里的旧 ui.js，
     旧 bug 反复报错、看起来像「改了没用」。代码类资源必须不缓存。 */
  {
    const noCacheNeeded = ['/', '/js/app.js', '/js/ui.js', '/js/start.js', '/css/main.css'];
    let cached = [];
    for (const f of noCacheNeeded) {
      r = await req('GET', G + f);
      const cc = String((r.headers && r.headers['cache-control']) || '');
      if (!/no-store/.test(cc)) cached.push(f + '(' + (cc || '无头') + ')');
    }
    ok('代码资源禁止缓存', cached.length === 0, cached.join(' | ') || '5 个入口全部 no-store');

    // 带 ?v= 也能正常取到（缓存穿透参数不能被当成文件路径）
    r = await req('GET', G + '/js/ui.js?v=20261008b');
    ok('带 ?v= 仍可取到脚本', r.code === 200 && /questArr/.test(r.body), 'len=' + r.body.length);
  }

  /* 新建角色 */
  r = await req('POST', G + '/api/new', {
    name: '联调侠客', gender: 'male', birth: 'scholar', perks: [],
    attrBonus: { 悟性: 5, 力量: 5 }
  });
  ok('新建角色', r.code === 200 && r.json && r.json.ok !== false, r.json && (r.json.error || 'ok'));
  const view = r.json && (r.json.view || r.json);

  if (view && view.player) {
    ok('返回玩家视图', !!view.player.name, 'name=' + view.player.name + ' hp=' + view.player.hp + '/' + view.player.hpMax);
    ok('返回房间信息', !!view.room && !!view.room.name, 'room=' + (view.room && view.room.name));

    /* 执行几条指令 */
    for (const c of ['look', 'score', 'i', 'skills', 'n', 'map']) {
      r = await req('POST', G + '/api/exec', { cmd: c });
      ok('指令 ' + c, r.code === 200 && r.json && r.json.ok !== false, r.json && r.json.error || '');
    }

    /* 中文口语指令（高自由度关键） */
    for (const c of ['看', '往北走', '查看背包', '查一下状态', '看看武学', '周围']) {
      r = await req('POST', G + '/api/exec', { cmd: c });
      const first = (r.json && (r.json.lines || [])[0]) || {};
      const bad = /是什么指令/.test(String(first.text || ''));
      ok('口语「' + c + '」', r.code === 200 && !bad, String(first.text || '').slice(0, 24));
    }

    /* 面板接口 */
    for (const p of ['score', 'attr', 'skills', 'inventory', 'equipment', 'affects', 'map', 'quests', 'sect', 'help']) {
      r = await req('POST', G + '/api/exec', { cmd: 'panel/' + p });
      ok('面板 ' + p, r.code === 200 && r.json && r.json.openPanel === p, r.json && r.json.openPanel);
    }

    /* 任务视图契约：view.quests 是 {active,done,completedCount} 对象，
       前端 questArr() 必须能安全归一化，绝不能出现 "forEach is not a function" */
    {
      const q = view.quests;
      const norm = Array.isArray(q) ? q : (q && Array.isArray(q.active) ? q.active : (q && Array.isArray(q.quests) ? q.quests : []));
      ok('任务视图可归一化', Array.isArray(norm),
        'type=' + (q === null ? 'null' : typeof q) + ' active=' + norm.length +
        (q && !Array.isArray(q) && q.done ? ' done=' + (q.done || []).length : ''));
      ok('开局有主线任务', norm.length >= 1, 'active=' + norm.length);
      // 每个任务项都必须有渲染所需字段
      const badItem = norm.find(x => !x || typeof x.name !== 'string');
      ok('任务项字段完整', !badItem, badItem ? JSON.stringify(badItem) : 'all ok');
      // 回归：主动触发一次会走 questList 的指令，确认接口层也不炸
      r = await req('POST', G + '/api/exec', { cmd: 'quests' });
      ok('指令 quests', r.code === 200 && r.json && r.json.ok !== false, r.json && (r.json.error || 'ok'));
    }

    /* 编辑器元数据 */
    r = await req('GET', G + '/api/editor/meta');
    const meta = r.json && (r.json.meta || r.json);
    ok('编辑器元数据', r.code === 200 && meta && (meta.attrs || []).length >= 6,
      meta ? ('attrs=' + (meta.attrs || []).length + ' rooms=' + ((meta.rooms || []).length) + ' skills=' + ((meta.skills || []).length)) : '');

    /* 制作器校验 */
    r = await req('POST', G + '/api/editor/validate', {
      spec: {
        id: 'e2e_maker', name: '联调制作器', category: '地图',
        rooms: [{ id: 'e2e_m_room', name: '联调房间', desc: '测试', exits: { s: 'jiangnan_street' } }]
      }
    });
    ok('制作器校验', r.code === 200 && r.json, r.json ? ('errors=' + ((r.json.report || r.json).errors || []).length) : '');

    /* Mod 列表 */
    r = await req('GET', G + '/api/mods');
    const ml = (r.json && r.json.mods) || [];
    ok('Mod 列表', r.code === 200 && ml.length >= 6, '已装=' + ml.length + ' 启用=' + ml.filter(m => m.enabled).length);
    ok('Mod 列表带 local 字段', ml.length > 0 && ml.every(m => typeof m.local === 'boolean'),
      '公共=' + ml.filter(m => !m.local).length + ' 本地=' + ml.filter(m => m.local).length);

    /* ---- 本地私有 Mod（浏览器官网文件夹那条链路） ---- */
    {
      const localMod = {
        id: 'e2e_local_mod', name: 'E2E 本地私有 Mod', version: '1.0.0',
        author: '自动测试', category: '剧情', desc: '只在本机生效，不应能被导出。',
        rooms: [{ id: 'e2e_l_room', name: '本地测试房间', desc: 'x', exits: { s: 'jiangnan_street' } }]
      };
      r = await req('POST', G + '/api/mod:install-local', { kind: 'json', json: localMod });
      ok('装本地私有 Mod', r.code === 200 && r.json && r.json.ok && r.json.local === true,
        r.json ? (r.json.id || r.json.msg) : '');

      r = await req('GET', G + '/api/mods');
      const got = ((r.json && r.json.mods) || []).find(m => m.id === 'e2e_local_mod');
      ok('本地 Mod 被标 local', !!(got && got.local === true));

      /* 落在 mods/_local/ 而不是 mods/ 根（mods 根在项目目录下，由 MODS_DIR 决定） */
      const p = require('path'), fsx = require('fs');
      const modsRoot = process.env.MODS_DIR
        ? p.resolve(process.env.MODS_DIR)
        : p.join(__dirname, '..', 'mods');
      const inLocal = fsx.existsSync(p.join(modsRoot, '_local', 'e2e_local_mod', 'mod.json'));
      const inRoot = fsx.existsSync(p.join(modsRoot, 'e2e_local_mod'));
      ok('本地 Mod 落在 _local 命名空间', inLocal && !inRoot,
        'root=' + modsRoot + ' inLocal=' + inLocal + ' inRoot=' + inRoot);

      /* 私有 Mod 不允许导出（否则会把别人机器上的内容传上站） */
      r = await req('POST', G + '/api/mod:export', { id: 'e2e_local_mod' });
      ok('本地 Mod 拒绝导出', r.code === 200 && r.json && r.json.ok === false, r.json && r.json.msg);

      /* 清掉 */
      r = await req('POST', G + '/api/mod:remove', { id: 'e2e_local_mod', hard: true });
      ok('删除本地 Mod', r.code === 200 && r.json && r.json.ok !== false);
    }

    /* 存档 */
    r = await req('POST', G + '/api/save', { id: 'e2e_slot' });
    ok('保存存档', r.code === 200 && r.json && r.json.ok !== false);
    r = await req('GET', G + '/api/saves');
    ok('存档列表', r.code === 200 && r.json && (r.json.saves || []).some(s => s.id === 'e2e_slot'));
    r = await req('POST', G + '/api/load', { id: 'e2e_slot' });
    ok('读取存档', r.code === 200 && r.json && r.json.ok !== false);
    r = await req('POST', G + '/api/deletesave', { id: 'e2e_slot' });
    ok('删除存档', r.code === 200);

    /* 网站配置 */
    r = await req('GET', G + '/api/site/config');
    ok('站点配置读取', r.code === 200 && r.json, r.json ? JSON.stringify(r.json.config || r.json) : '');

    /* ---------- 前端渲染回归（真加载 ui.js 里的渲染函数） ----------
       历史 bug：view.quests 从数组改成了 {active,done,completedCount} 对象，
       而 questsHtml() 仍按数组调用 .forEach → 开局即报
       "(v.quests || []).forEach is not a function"。
       这里把 questArr / questsHtml 从磁盘源码里抠出来真实执行，防止再次回归。 */
    {
      const fs = require('fs');
      const path = require('path');
      const uiSrc = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'renderer', 'js', 'ui.js'), 'utf8');
      const grab = (name) => {
        const m = uiSrc.match(new RegExp('function ' + name + '\\([\\s\\S]*?\\n  \\}'));
        return m ? m[0] : null;
      };
      const fnQuestArr = grab('questArr');
      const fnQuestSrc = grab('questSrc');
      const fnQuestHtml = grab('questsHtml');
      const fnMapHtml = grab('mapHtml');
      const fnGuideHtml = grab('guideHtml');
      ok('ui.js 含 questArr 归一化', !!fnQuestArr);
      ok('ui.js 含 questSrc 归一化', !!fnQuestSrc);
      ok('ui.js 含 questsHtml', !!fnQuestHtml);
      ok('ui.js 含 mapHtml', !!fnMapHtml);
      ok('ui.js 含 guideHtml', !!fnGuideHtml);

      if (fnQuestArr && fnQuestHtml) {
        const escFn = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const built = new Function('esc', (fnQuestSrc || '') + '\n' + fnQuestArr + '\n' + fnQuestHtml +
          '\nreturn { questArr, questsHtml };')(escFn);

        /* 用真实的 view.quests 走一遍前端渲染路径 */
        let html = '', crashed = null;
        try { html = built.questsHtml(view.quests); } catch (e) { crashed = e.message; }
        ok('questsHtml(真实view) 不抛异常', !crashed, crashed || ('len=' + html.length));
        ok('questsHtml 渲染出主线任务', /江湖路远/.test(html), '');

        /* ⚠️ 真实调用路径：panel() 传的是「整个 view」，不是 view.quests。
           历史 bug：questArr(整view) 拿不到 active → 任务面板永远空白，
           而旧断言只喂 view.quests，完美绕过了真实路径。这里必须两条都测。 */
        let html2 = '', crashed2 = null;
        try { html2 = built.questsHtml(view); } catch (e) { crashed2 = e.message; }
        ok('questsHtml(panel 真实入参=整view) 不抛异常', !crashed2, crashed2 || ('len=' + html2.length));
        ok('任务面板(整view) 渲染出主线任务', /江湖路远/.test(html2), html2.slice(0, 80));

        /* 各类畸形输入都不能炸（Mod / 旧存档 / 空档） */
        const shapes = [
          ['对象', { active: [{ name: 'A', stageDesc: 's' }], done: [], completedCount: 0 }],
          ['纯数组', [{ name: 'B' }]],
          ['已完成', { active: [], done: [{ name: '旧任务' }], completedCount: 1 }],
          ['空对象', {}], ['null', null], ['undefined', undefined], ['字符串', 'x']
        ];
        let shapeBad = [];
        for (const [label, input] of shapes) {
          try { built.questsHtml(input); built.questArr(input); }
          catch (e) { shapeBad.push(label + ':' + e.message); }
        }
        ok('畸形任务数据不崩', shapeBad.length === 0, shapeBad.join(' | ') || '7 种输入全部安全');
      }

      /* --- 地图与新手引导（同样真跑渲染） --- */
      if (fnMapHtml && fnGuideHtml) {
        const escFn2 = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
          ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const MAP_CELL = 30, MAP_NODE = 26, MAP_PAD = 34;
        const DIR_CN = { n: '北', s: '南', e: '东', w: '西', u: '上', d: '下' };
        const DIR_OFF = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0], u: [0, -1], d: [0, 1] };
        const fnShort = grab('shortName') || 'function shortName(n){return n;}';
        const built2 = new Function('esc', 'MAP_CELL', 'MAP_NODE', 'MAP_PAD', 'DIR_CN', 'DIR_OFF',
          fnMapHtml + '\n' + fnShort + '\n' + fnGuideHtml +
          '\nreturn { mapHtml, guideHtml };')(escFn2, MAP_CELL, MAP_NODE, MAP_PAD, DIR_CN, DIR_OFF);

        const mv = view.map;
        ok('地图含全部房间', mv && (mv.rooms || []).length >= 95, 'rooms=' + ((mv && mv.rooms) || []).length);
        ok('地图有坐标', mv && mv.bounds && mv.bounds.w > 0, mv ? JSON.stringify(mv.bounds) : '');
        ok('地图有区域外框', mv && Object.keys(mv.regionBoxes || {}).length >= 20,
          'boxes=' + (mv ? Object.keys(mv.regionBoxes || {}).length : 0));
        ok('地图探索度', mv && mv.explore && mv.explore.total === (mv.rooms || []).length,
          mv ? JSON.stringify(mv.explore) : '');

        // 坐标不能重叠（重叠就说明布局算法坏了）
        const seenCell = new Set();
        let dupCell = null;
        for (const r of (mv.rooms || [])) {
          const k = r.x + ',' + r.y;
          if (seenCell.has(k)) { dupCell = r.name + '@' + k; break; }
          seenCell.add(k);
        }
        ok('地图坐标无重叠', !dupCell, dupCell || ((mv.rooms || []).length + ' 个房间各自独立'));

        let mHtml = '', mCrash = null;
        try { mHtml = built2.mapHtml(view); } catch (e) { mCrash = e.message; }
        ok('mapHtml(真实view) 不抛异常', !mCrash, mCrash || ('len=' + mHtml.length));
        ok('地图渲染含画布/节点/图例',
          /map-canvas/.test(mHtml) && /map-node/.test(mHtml) && /map-legend/.test(mHtml));

        // 新手引导
        const g = view.guide;
        ok('引导状态存在', !!(g && g.steps && g.total > 0), g ? (g.doneCount + '/' + g.total) : '');
        ok('引导步骤字段完整', !!(g.steps || []).find(s => !s.id || !s.title || !s.goal || !s.hint) === false,
          'steps=' + ((g.steps || []).length));
        let gHtml = '', gCrash = null;
        try { gHtml = built2.guideHtml(view); } catch (e) { gCrash = e.message; }
        ok('guideHtml(真实view) 不抛异常', !gCrash, gCrash || ('len=' + gHtml.length));

        // 畸形数据
        let bad2 = [];
        for (const [label, input] of [['空', {}], ['空map', { map: {} }], ['空guide', { guide: {} }]]) {
          try { built2.mapHtml(input); built2.guideHtml(input); } catch (e) { bad2.push(label + ':' + e.message); }
        }
        ok('地图/引导畸形数据不崩', bad2.length === 0, bad2.join(' | ') || '3 种输入安全');
      }
    }

    /* 关键：游戏端能否连上 Mod 站（一键下载） */
    console.log('\n\u2500\u2500 跨服务：游戏 \u2194 Mod 站 \u2500\u2500');

    /* ---- 官方示例 Mod 自动上架 ---- */
    r = await req('GET', S + '/api/mods');
    const allMods = (r.json && r.json.mods) || [];
    const offi = allMods.filter(m => m.official);
    ok('站点收录官方示例', offi.length >= 6, '官方 ' + offi.length + '/' + allMods.length);
    ok('官方示例置顶', allMods.length > 1 && !!allMods[0].official, allMods[0] && allMods[0].id);
    ok('官方示例内容非空', offi.length > 0 && offi.every(m =>
      m.counts && Object.values(m.counts).reduce((a, b) => a + b, 0) > 0));
    ok('官方示例可看详情', await (async () => {
      const d = await req('GET', S + '/api/mods/demo_map');
      return d.code === 200 && d.json && d.json.ok && !!d.json.mod.json;
    })());

    /* ---- 教程页覆盖本轮新增章节 ---- */
    r = await req('GET', S + '/tutorial.html');
    ok('教程含「三种玩法」', r.code === 200 && /三种玩法/.test(r.body));
    ok('教程讲本地 Mod 文件夹', /本地 Mod 文件夹/.test(r.body));
    ok('教程讲手机能玩', /手机/.test(r.body));
    ok('教程列出官方示例 id', /demo_map/.test(r.body) && /demo_func/.test(r.body));
    ok('教程锚点不重复且有 13 节', (function () {
      const ids = (r.body.match(/id="s\d+"/g) || []);
      return ids.length === new Set(ids).size && ids.length >= 13;
    })(), (r.body.match(/id="s\d+"/g) || []).length + ' 节');

    r = await req('POST', G + '/api/site/upload', {
      spec: { id: 'e2e_cross', name: '跨服测试', category: '功能', desc: '联调', rules: [{ name: 'r', kind: 'multiply', target: 'exp', value: 3 }] },
      json: JSON.stringify({ id: 'e2e_cross', name: '跨服测试', category: '功能', desc: '联调', rules: [{ name: 'r', kind: 'multiply', target: 'exp', value: 3 }] }),
      note: '跨服务联调'
    });
    ok('游戏→网站 一键上传', r.code === 200 && r.json && r.json.ok, r.json ? (r.json.url || r.json.error) : '');

    r = await req('GET', G + '/api/site/remote?action=list&q=跨服');
    ok('游戏→网站 市场列表', r.code === 200 && r.json && r.json.ok !== false,
      r.json ? ('total=' + ((r.json.mods || r.json.list || []).length)) : '');

    r = await req('GET', G + '/api/site/remote?action=download&id=e2e_cross');
    ok('游戏→网站 一键下载', r.code === 200 && r.json && r.json.ok === true && !!r.json.mod,
      r.json ? ('name=' + r.json.name + ' installed=' + ((r.json.mods || []).length)) : '');

    /* 清理 */
    await req('POST', S + '/api/mods/e2e_cross/delete', {});
  }

  console.log('\n' + '='.repeat(46));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('='.repeat(46) + '\n');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('\n联调测试异常：', e.message);
  console.error('请确认两个服务都已启动：');
  console.error('  node server/game-server.js 8787');
  console.error('  node server/mod-site.js 8788 --no-open');
  process.exit(2);
});
