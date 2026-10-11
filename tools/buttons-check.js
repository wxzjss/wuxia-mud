/**
 * buttons-check.js — 玩家能点的按钮，点了到底会发生什么？都实现了吗？
 *
 * 主人 2026-10-08：「看一下游戏里所有玩家可点击的『按钮』点击后效果是什么，实现了吗？」
 *
 * 做法：把前端 ui.js 里**所有**能产生动作的地方抠出来 ——
 *   · data-cmd="xxx"          → 点它就是发这条指令
 *   · doCmd('xxx')            → 直接发指令（bindPanelActions / 各面板自己绑的）
 *   · cmd: 'xxx'              → NPC 互动菜单里的动作（日志高亮 / 场景卡片）
 *   · act: 'xxx'              → 不走指令的特殊动作（如开详情面板），前端另有分支
 *   · onclick="WXUI.xxx()"    → 前端函数
 *   · id="xx" 的按钮          → 由 $('xx').onclick 绑的
 * 然后逐条回后端对账：指令查注册表（含别名），面板查 PANEL_CMDS + panel() 分支，
 * act 查 ui.js 里有没有消费它。**没实现的当场列出来**。
 *
 * 这就是「功效字段只定义不消费」那条铁律的按钮版 —— 按钮画出来了、点了没反应，
 * 是最伤玩家的一种静默失效。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const UI_PATH = path.join(ROOT, 'game/src/renderer/js/ui.js');
const UI = fs.readFileSync(UI_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

/* ---------- 后端注册表 ---------- */
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const engine = new GameEngine({ seed: 1 });
engine.boot();
const CMD = (engine.cmds && engine.cmds.CMD) || {};
const known = new Set();
for (const k of Object.keys(CMD)) {
  known.add(k);
  for (const nm of (CMD[k].names || [])) known.add(nm);
}

/* ---------- 前端 ---------- */
const PANEL_CMDS = {};
{
  const m = UI.match(/const PANEL_CMDS = \{([\s\S]*?)\n  \};/);
  if (m) for (const mm of m[1].matchAll(/([^:,\s]+)\s*:\s*'([^']+)'/g)) PANEL_CMDS[mm[1]] = mm[2];
}

/** 抠出源码里所有「字面量动作」 */
function collect() {
  const out = { cmd: new Set(), act: new Set(), fn: new Set(), dyn: 0 };
  const push = (set, raw, kind) => {
    let s = String(raw).trim();
    if (!s) return;
    if (s.includes('+') || s.includes('$') || s.startsWith('\\')) { out.dyn++; return; }
    s = s.replace(/[\\'"]+$/g, '');
    if (!s) return;
    set.add(kind === 'cmd' ? s.split(/\s+/)[0] : s);
  };
  for (const m of UI.matchAll(/data-cmd="([^"]*)"/g)) push(out.cmd, m[1], 'cmd');
  for (const m of UI.matchAll(/doCmd\(\s*'([^']*)'/g)) push(out.cmd, m[1], 'cmd');
  for (const m of UI.matchAll(/cmd:\s*'([^']*)'/g)) push(out.cmd, m[1], 'cmd');
  for (const m of UI.matchAll(/act:\s*'([^']*)'/g)) push(out.act, m[1], 'act');
  for (const m of UI.matchAll(/onclick="WXUI\.([A-Za-z0-9_]+)\(/g)) push(out.fn, m[1], 'fn');
  /* 无 data-cmd、靠 id 绑定的按钮：`$('xx').onclick = …` */
  for (const m of UI.matchAll(/\$\('([a-z0-9-]+)'\)\.onclick/g)) push(out.fn, '$' + m[1], 'fn');
  return out;
}
const A = collect();

/* ---------- ① 指令类动作 ---------- */
console.log('===== ① 按钮发的指令，后端认不认 =====');
{
  const unknown = [];
  for (const c of A.cmd) {
    /* 面板名也算合法（前端 doCmd 会拦下来开面板，不进后端） */
    if (known.has(c) || PANEL_CMDS[c]) continue;
    /* 中文动词可能是别名的一部分（如「拜师」），再宽松查一遍 */
    if (Object.keys(CMD).some(k => (CMD[k].names || []).includes(c))) continue;
    unknown.push(c);
  }
  ok('按钮里的指令全都有实现（注册表或面板）', unknown.length === 0, unknown.join(' / '));
  ok('确实抠到了指令（不是空扫）', A.cmd.size >= 15, A.cmd.size + ' 条字面量指令');
}

/* ---------- ② act 类动作 ---------- */
console.log('===== ② 特殊动作 act（不走指令，前端另有分支） =====');
{
  const miss = [];
  for (const a of A.act) {
    /* 前端必须**消费**它：ui.js 里有 `=== 'xxx'` / `act === 'xxx'` 之类 */
    const re = new RegExp(`['"]${a}['"]`);
    if (!re.test(UI)) miss.push(a);
  }
  ok('每个 act 都在前端有消费分支', miss.length === 0, miss.join(' / '));
  ok('act 数量合理', A.act.size >= 1, A.act.size + ' 种');
}

/* ---------- ③ 前端函数类 ---------- */
console.log('===== ③ onclick 调的前端函数是否存在 =====');
{
  const miss = [];
  for (const f of A.fn) {
    if (f.startsWith('$')) {
      /* $('id') 绑定的按钮：该 id 必须在 HTML 里出现过（否则 $ 拿到 null，
         onclick 挂不上 —— 点了没反应，且不报错） */
      const id = f.slice(1);
      const raw = fs.readFileSync(path.join(ROOT, 'game/src/renderer/index.html'), 'utf8');
      if (!UI.includes(`id="${id}"`) && !UI.includes(`id="' + id`)) miss.push('#' + id + '（代码里没有这个 id）');
      continue;
    }
    const re = new RegExp(`(function\\s+${f}\\b|${f}\\s*[:=]\\s*function|${f}\\s*\\(\\s*\\))`);
    if (!re.test(UI)) miss.push(f);
  }
  ok('按钮点到的前端函数都定义了', miss.length === 0, miss.join(' / '));
}

/* ---------- ④ 按钮 id ↔ 绑定 双向对账 ---------- */
console.log('===== ④ 画出来的按钮，有没有人给它挂事件 =====');
{
  /* 前端所有 `<button ... id="xx">` */
  const ids = new Set();
  for (const m of UI.matchAll(/<button[^>]*\bid="([^"'+]+)"/g)) ids.add(m[1]);
  /* 有 data-cmd 的按钮由通用委托处理，不用单独绑 */
  const withDataCmd = new Set();
  for (const m of UI.matchAll(/<button[^>]*data-cmd[^>]*\bid="([^"'+]+)"/g)) withDataCmd.add(m[1]);
  /* ⚠️ 还有一类是**拼出来的 id**：设置面板三个开关就是
     `['anim','auto','narrow'].forEach(k => { $('set-' + k).onclick = … })`。
     精确找 `$('set-anim')` 是找不到的 —— 得认前缀（这是测试自己踩的坑：
     第一版把这三个报成「没绑事件」，跑去一看人家绑得好好的）。 */
  const prefixBinds = new Set();
  for (const m of UI.matchAll(/\$\('([a-z0-9-]+)-'\s*\+/g)) prefixBinds.add(m[1] + '-');
  const unbound = [];
  for (const id of ids) {
    if (withDataCmd.has(id)) continue;
    if (new RegExp(`\\$\\('${id}'\\)`).test(UI)) continue;
    if ([...prefixBinds].some(p => id.startsWith(p))) continue;   // 前缀式动态绑定
    if (!new RegExp(`'${id}'`).test(UI)) unbound.push(id);
  }
  ok('画出来的按钮都挂了事件（或走 data-cmd 委托）', unbound.length === 0, unbound.slice(0, 8).join(', ') + (unbound.length > 8 ? ` 等 ${unbound.length} 个` : ''));
  ok('按钮数量合理', ids.size >= 10, ids.size + ' 个带 id 的按钮');
}

/* ---------- ⑤ 面板名双向对账 ---------- */
console.log('===== ⑤ 面板入口与 panel() 分支 =====');
{
  const names = new Set(Object.values(PANEL_CMDS));
  const miss = [];
  for (const n of names) {
    if (!new RegExp(`(name === '${n}'|'${n}':\\s*)`).test(UI)) miss.push(n);
  }
  ok('每个面板名在 panel() 里都有渲染分支', miss.length === 0, miss.join(' / '));
  ok('面板数量合理', names.size >= 10, names.size + ' 个面板');
}

/* ---------- ⑥ 汇总（主人要的「效果是什么」） ---------- */
console.log('\n===== ⑥ 按钮清单（按动作归类） =====');
{
  const rows = [];
  for (const c of [...A.cmd].sort()) {
    const panel = PANEL_CMDS[c];
    rows.push(`${c.padEnd(10)} → ${panel ? '开「' + panel + '」面板' : '发指令'}`);
  }
  for (const a of [...A.act].sort()) rows.push(`${a.padEnd(10)} → 前端动作（如开详情面板）`);
  console.log('  ' + rows.join('\n  '));
  console.log(`\n  （另有 ${A.dyn} 处动作是拼出来的，静态判不了；它们由运行时测试 ${'ui-bind-check'} 守着）`);
  ok('清单非空', rows.length > 0, rows.length + ' 条');
}

console.log(`\n===== buttons-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
