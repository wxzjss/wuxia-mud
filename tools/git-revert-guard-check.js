#!/usr/bin/env node
/* ============================================================
 * git-revert-guard-check.js —— 「删了又被还原」守卫
 *
 * 缘起：mods/test_mod/mod.json 里的 test_npc 被改回去过**至少三次**（19:19、19:39、20:14）。
 *       删 → 被改回 → 再删 → 再被改回，这个循环手动转下去没尽头。
 *       团队长的裁定：**加断言，让"被改回"这件事自己报错。**
 *
 * ⚠️⚠️ 归因更正（2026-10-12 20:20，我上一轮自己写错过，钉在这里别再犯）：
 *   **不是 git。** 实测 `git check-ignore -v mods/test_mod/mod.json` → `.gitignore:18:mods/test_mod/`，
 *   这个文件**根本不被 git 跟踪**，`git checkout` 不可能还原它；`git show HEAD:mods/test_mod/mod.json`
 *   直接报 `exists on disk, but not in 'HEAD'`。前两次往 git 身上归因是错的。
 *
 * ✅✅ 真凶已抓到（2026-10-12 20:25，实测复现，不是推测）：
 *   **`tools/smoke-test.js`。** 它 buildModFiles 出一个 `meta.id='test_mod'` 的模组
 *   （里面就有 `npcs:[{id:'test_npc'}]`），然后 `engine.writeMod('test_mod', …)`
 *   **写进了仓库真实的 mods/ 目录**，还 `modSetEnabled('test_mod', true)`。
 *   实测：跑之前 md5 18a02350（干净）→ 跑完 **cb711aec、1601 字节、test_npc=true**，
 *   与 20:14 / 20:23 两次现场留下的 md5 完全一致；`mods-state.json` 同时被写。
 *   而 `smoke-test.js` 匹配回归收录规则 `^smoke-.*\.js$` ⇒
 *   **每跑一次全量回归，test_npc 就被写回一次**，还顺手把 mods-state 改了。
 *   ⇒ 在 smoke-test.js 改掉之前，**删多少次都没用**。修法见本文件末尾「修复顺序」。
 *   （已排除：引擎 boot 不写 —— `mods:false` 与默认两种 boot 各跑两次，md5 纹丝不动。）
 *
 * 守三条：
 *   ① 引擎 NPC 表里不得有 test_npc（结果层 —— 不管它从哪来，出现就红）
 *   ② 磁盘数据层不得有 test_npc（定位层 —— 报出在哪个文件，好去删）
 *   ③ mods/test_mod/mod.json 必须与「已批准基线」逐字节一致
 *
 * 关于第 ③ 条为什么不是直接比 git HEAD：
 *   团队长要求「与 git HEAD 逐字节一致 ⇒ 疑似被 checkout 还原」。
 *   **实测本机 node 内 spawn git 一律 EBUSY**（spawnSync('git',…) → err EBUSY，
 *   连试两次都一样；Bash 里 git 正常）。也就是说：git 那条判据在这台机器上
 *   **永远走跳过分支**，挂着它就是挂一个永远绿的摆设 —— 正是「断言恒真」那条铁律。
 *   ⇒ 主判据改成**基线比对**：`tools/_mod_baseline/test_mod.mod.json` 是已批准删除
 *     后那份的副本（md5 18a02350…）。工作区与它不一致 = 有人动过（含被 git 还原）。
 *     基线比对不依赖 git，脱离 git 也不假红。
 *   git 那条**保留但降级为辅助**：拿得到 HEAD 就多比对一次，拿不到就**明说跳过原因**，
 *     不静默、不判红。
 *
 * 用法：
 *   node tools/git-revert-guard-check.js             门禁（红则 exit 1）
 *   node tools/git-revert-guard-check.js --selftest  自测（证明它真能红）
 * ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const MOD_REL = 'mods/test_mod/mod.json';
const MOD = path.join(ROOT, MOD_REL);
const BASELINE = path.join(__dirname, '_mod_baseline', 'test_mod.mod.json');
const TARGET = 'test_npc';

let pass = 0, fail = 0;
const out = [];
const ok = (n, c, extra) => {
  if (c) { pass++; out.push('  ✔ ' + n); }
  else { fail++; out.push('  ✘ ' + n + (extra ? '\n      ' + extra : '')); }
};

/* ---------------- 工具 ---------------- */

const md5 = b => crypto.createHash('md5').update(b).digest('hex');

/** 逐字节相同 */
function bytesEqual(a, b) {
  if (!a || !b) return false;
  return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

/** 跑一条外部命令（**异步 spawn**，不是 spawnSync）。
 *  ⚠️ 为什么不能用 spawnSync：本环境实测 spawnSync 被整体拦住 ——
 *    spawnSync('cmd', ['/c','echo','hi']) 都返回 err EBUSY，同步接口一个都跑不起来；
 *    而异步 spawn('git',…) 完全正常（实测 `git rev-parse --short HEAD` → 61c729a，退出码 0）。
 *    我上一轮把「拿不到 git」归到 git 头上是**归因过窄**：坏的是 spawnSync 这条通路，
 *    不是 git。同步写法换个环境就可能断，所以一律走异步。
 *  拿不到就返回 { buf: null, why } —— 绝不抛异常、绝不判红。 */
function runCmd(cmd, args) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { return resolve({ buf: null, code: null, why: '调用 ' + cmd + ' 抛异常：' + e.message }); }
    const chunks = []; let errText = ''; let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    child.stdout.on('data', (d) => chunks.push(Buffer.from(d)));
    child.stderr.on('data', (d) => { errText += String(d); });
    child.on('error', (e) => done({ buf: null, code: null, why: '调用 ' + cmd + ' 失败：' + (e.code || e.message) }));
    child.on('close', (code) => {
      if (code !== 0) {
        const first = errText.split(/\r?\n/).filter(Boolean)[0] || '';
        return done({ buf: null, code, why: cmd + ' 退出码 ' + code + (first ? '（' + first.trim() + '）' : '') });
      }
      const b = Buffer.concat(chunks);
      if (!b.length) return done({ buf: null, code, why: cmd + ' 返回空' });
      done({ buf: b, code, why: null });
    });
  });
}

/** 拿 git HEAD 版本 */
function headBytes(rel) {
  return runCmd('git', ['show', 'HEAD:' + rel]);
}

/** 引擎 NPC 表里有没有 TARGET（只看 id，不看名字） */
function findInNpcTable(npcs) {
  const hits = [];
  for (const id of Object.keys(npcs || {})) {
    if (id === TARGET || id.indexOf(TARGET) >= 0) hits.push(id);
  }
  return hits;
}

/** 磁盘数据层：哪些文件的 npcs 集合里挂着 TARGET */
function findInDataFiles() {
  const hits = [];
  for (const f of fs.readdirSync(DATA).filter(x => /^\d+_.*\.json$/.test(x))) {
    let j; try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    const colls = ['npcs', 'npcTemplates', 'npclife'];
    for (const c of colls) {
      const root = j[c];
      if (!root || typeof root !== 'object') continue;
      for (const id of Object.keys(root)) if (id === TARGET || id.indexOf(TARGET) >= 0) hits.push(f + ' → ' + c + '.' + id);
    }
  }
  return hits;
}

/* ---------------- 自测 ---------------- */

async function selftest() {
  console.log('  还原守卫 · 自测');
  const A = Buffer.from('{"a":1}');
  const B = Buffer.from('{"a":1}');
  const C = Buffer.from('{"a":2}');
  const D = Buffer.concat([A, Buffer.from(' ')]);

  /* ① 比对器：命中/不命中都要有（这是第 ③ 条判据的全部依据） */
  ok('判据1 相同内容 → 判相同（能红）', bytesEqual(A, B) === true);
  ok('判据2 差一个字符 → 判不同', bytesEqual(A, C) === false);
  ok('判据3 只多一个尾随空格 → 判不同（逐字节，不是字符串比较）', bytesEqual(A, D) === false);
  ok('判据4 任一侧拿不到 → 判不同（不许因为读不到就当成一样放过）',
    bytesEqual(A, null) === false && bytesEqual(null, B) === false);

  /* ② TARGET 检测：造已知答案 */
  ok('判据5 NPC 表里有 test_npc → 命中 1 条', findInNpcTable({ test_npc: {}, npc_a: {} }).length === 1);
  ok('判据6 没有 → 不命中（防恒真）', findInNpcTable({ npc_a: {}, npc_b: {} }).length === 0);
  ok('判据7 嵌在 id 中间也能抓到（清理时漏过一次）', findInNpcTable({ disciple_test_npc_0: {} }).length === 1);

  /* ③ 第 ③ 条在真实数据上**不是恒真**：现在必须判「与基线一致」 */
  const cur = fs.readFileSync(MOD);
  const base = fs.readFileSync(BASELINE);
  ok('判据8 基线文件存在：tools/_mod_baseline/test_mod.mod.json', fs.existsSync(BASELINE));
  ok('判据9 真实数据：工作区 mod.json 与基线一致（现在是对的）', bytesEqual(cur, base) === true);
  ok('判据10 真实数据：mod.json 里没有 test_npc 字样', !/test_npc/.test(cur.toString('utf8')));
  /* 反证：把基线换成一份**已知不同**的内容，必须判不一致 —— 证明判据 9 不是恒真 */
  ok('判据11 反证·防恒真：给基线加一个换行 → 立刻判不一致（说明判据 9 真的在比，不是永远 true）',
    bytesEqual(cur, Buffer.concat([base, Buffer.from('\n')])) === false);

  /* ④ git 分支：要么拿到 Buffer，要么拿到 null + 原因，绝不抛、绝不默认通过 */
  const h = await headBytes(MOD_REL);
  ok('判据12 git 分支不抛异常：返回值是 Buffer 或 null', h.buf === null || Buffer.isBuffer(h.buf));
  ok('判据13 拿不到时必须带回原因（' + (h.why || '本次拿到了 HEAD 版本') + '）',
    h.buf === null ? (typeof h.why === 'string' && h.why.length > 0) : true);
  /* 判据14：异步 spawn 这条通路本身得是活的 —— 否则上面 3 条全是「什么都没跑到」的空跑。
     用一个 HEAD 里**确实存在**的文件试（mod.json 不在 HEAD 里，拿它试只会永远失败）。 */
  const probe = await runCmd('git', ['rev-parse', '--short', 'HEAD']);
  ok('判据14 spawn 通路活着：git rev-parse 要么有输出要么有原因（' + (probe.buf ? String(probe.buf).trim() : probe.why) + '）',
    (probe.buf && String(probe.buf).trim().length > 0) || (typeof probe.why === 'string' && probe.why.length > 0));

  console.log(out.join('\n'));
  console.log('\n  自测结果：' + pass + '/' + (pass + fail) + ' 通过');
  return fail === 0 ? 0 : 1;
}

/* ---------------- 门禁 ---------------- */

async function main() {
  if (process.argv.indexOf('--selftest') >= 0) return selftest();

  console.log('还原守卫：test_npc / mods/test_mod/mod.json\n');

  /* git 相关的活儿**先发起**（异步），下面 ①②③ 照旧同步跑完再取结果 */
  const hPromise = headBytes(MOD_REL);

  /* 归因护栏：这个文件到底归不归 git 管？先说清楚，免得下次又往 git 身上赖。
     只打印，不判红 —— git 跟踪与否是环境事实，不是这个守卫要守的对错。 */
  {
    const gi = path.join(ROOT, '.gitignore');
    let ignored = false, line = '';
    try {
      const lines = fs.readFileSync(gi, 'utf8').split(/\r?\n/);
      lines.forEach((l) => { if (l.trim() && l.indexOf('mods/test_mod') >= 0) { ignored = true; line = l.trim(); } });
    } catch (e) { /* 没有 .gitignore 就当没忽略，不影响判定 */ }
    console.log('  · 归因提示：' + MOD_REL + (ignored
      ? ' 被 .gitignore 忽略（' + line + '）⇒ **git 不可能还原它**，别再往 git 身上赖'
      : ' 未被 .gitignore 忽略 ⇒ git 有可能还原它，见下面第 ④ 条'));
  }

  /* ① 结果层：引擎 NPC 表 */
  let npcTable = {};
  try {
    const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
    const e = new GameEngine({ seed: 20261010, mods: false });
    e.boot();
    e.newGame({ name: '试剑', gender: 'male' });
    npcTable = (e.world && e.world.data && e.world.data.npcs) || {};
  } catch (err) {
    fail++;
    out.push('  ✘ 引擎起不来，无法查 NPC 表\n      ' + err.message);
  }
  const hits = findInNpcTable(npcTable);
  ok('① 引擎 NPC 表里没有 ' + TARGET + '（共 ' + Object.keys(npcTable).length + ' 人）',
    hits.length === 0,
    '命中 ' + hits.slice(0, 5).join('、') + '\n      修复：node tools/prune-test-npc.js');

  /* ② 定位层：磁盘数据文件 */
  const dh = findInDataFiles();
  ok('② game/data/*.json 里没有 ' + TARGET, dh.length === 0,
    '命中 ' + dh.join('、') + '\n      修复：node tools/prune-test-npc.js');

  /* ③ 基线层：mod.json 与已批准副本逐字节一致 */
  if (!fs.existsSync(MOD)) {
    fail++;
    out.push('  ✘ ③ 找不到 ' + MOD_REL);
  } else if (!fs.existsSync(BASELINE)) {
    fail++;
    out.push('  ✘ ③ 找不到基线 tools/_mod_baseline/test_mod.mod.json（基线丢了，这条守卫就瞎了）');
  } else {
    const cur = fs.readFileSync(MOD);
    const base = fs.readFileSync(BASELINE);
    ok('③ ' + MOD_REL + ' 与已批准基线逐字节一致（md5 ' + md5(cur).slice(0, 8) + '…）',
      bytesEqual(cur, base),
      '工作区 md5 ' + md5(cur) + ' ≠ 基线 md5 ' + md5(base)
      + '\n      ⇒ 这个文件被改回去了，本文件已批准的删除被撤销。'
      + '\n      ⚠️ 别往 git 身上归因：' + MOD_REL + ' 在 .gitignore 里，git 不跟踪它。'
      + '\n      ✅ 真凶已知：**tools/smoke-test.js** —— 它把 `test_mod` 模组写进仓库真实的 mods/ '
      + '\n      并 enable 它，而它在回归里（^smoke-.*）⇒ **每跑一次全量回归就写回一次**。'
      + '\n      ⇒ 先修 smoke-test.js（让它写到临时 modsDir），再删；否则删了也会回来。'
      + '\n      （其它会写它的路径：engine.modInstall/modInstallLocal，engine.js:2384/2458，'
      + '\n      入口 server/game-server.js:599/604 与 renderer start.js:737/842。）'
      + '\n      临时修复：node tools/prune-test-npc.js'
      + '\n      （若这次改动是新的、有意为之，请先跟团队长确认，再更新基线：cp ' + MOD_REL + ' tools/_mod_baseline/test_mod.mod.json）');
  }

  /* ④ 辅助：git HEAD 比对（拿不到就明说跳过；注意本文件不在 HEAD 里，属正常跳过） */
  const h = await hPromise;
  if (!h.buf) {
    out.push('  ⏭ ④ 跳过「与 git HEAD 比对」：' + h.why);
    out.push('      本条**不依赖 git** —— 拿不到 HEAD 时它降级为上面的基线比对，不会假红。');
  } else {
    const cur = fs.readFileSync(MOD);
    ok('④ ' + MOD_REL + ' 与 git HEAD 版本不一致（不一致才是「改过」）',
      !bytesEqual(cur, h.buf),
      '与 git HEAD 逐字节一致 ⇒ 这次「改回」是 git 干的。本文件已批准的删除被撤销。\n'
      + '      修复：node tools/prune-test-npc.js');
  }

  console.log(out.join('\n'));
  console.log('\n' + (fail ? '✘ 还原守卫不通过：' + fail + ' 条' : '✔ 还原守卫通过：' + pass + ' 条'));
  return fail ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => {
  console.error('还原守卫自己炸了：' + (e && e.stack || e));
  process.exit(1);
});
