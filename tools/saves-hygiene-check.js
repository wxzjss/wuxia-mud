/**
 * saves-hygiene-check.js — 仓库存档目录卫生守卫（主人真机 2026-10-18「测试侠客」污染案）
 *
 * 事故链：仓库 saves/ 是玩家真档目录（.gitignore 盖住不进 git），但发布 skill 的
 * 上传排除表**不含 saves/** → 本地 saves/ 里的历史测试残留随发布一起上传，
 * 沙箱（复用同一个）的读档列表里就出现了「测试侠客」这类角色。
 *
 * 本守卫盯**源头**：saves/ 里凡出现工具脚本命名 roster 内的角色名即红。
 * 修复路径：把残留档移进 .livetest/saves-quarantine/（可逆，不直删——
 * 万一误判是真人档还能捞回来），下次发布就不再带上去。
 *
 * 用法：node tools/saves-hygiene-check.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SAVES = path.join(ROOT, 'saves');

/* 工具脚本 newGame 用的角色名全 roster（tools/*.js 全量 grep 归并）。
   ⚠️ 只收**确凿的测试名**（试剑/试侠/测试侠客/测速侠/巡检侠客/过客/验收员/探针/
   测试侠/测试）——像「柳霜」「小鱼」这类可能有真人用，不进名单防误伤。 */
const TEST_NAMES = new Set([
  '测试侠客', '测试侠', '测速侠', '巡检侠客', '过客', '试剑', '试侠', '验收员', '探针', '测试',
]);
/* 测试/调试槽位 id（与 engine.js TEST_SAVE_IDS / TEST_SAVE_PREFIXES 同源口径） */
const TEST_ID_RE = /^(test_|smoke_|tmp_|perf_slot)/;

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) { pass++; console.log('  ✔ ' + n + (extra ? '  ' + extra : '')); } else { fail++; console.log('  ✘ ' + n + (extra ? '  ' + extra : '')); } };

console.log('── 仓库存档目录卫生（saves/）──');
const offenders = [];
if (!fs.existsSync(SAVES)) {
  ok('saves/ 目录存在', false, '（连目录都没有？引擎首跑会建）');
} else {
  const files = fs.readdirSync(SAVES).filter(f => f.endsWith('.json'));
  for (const f of files) {
    const id = f.replace(/\.json$/, '');
    let name = '?', savedAt = 0;
    try {
      const j = JSON.parse(fs.readFileSync(path.join(SAVES, f), 'utf8'));
      name = (j.player && j.player.name) || '?';
      savedAt = j.savedAt || 0;
    } catch (e) { /* 解析不了的文件也报 */ }
    const idBad = TEST_ID_RE.test(id);
    const nameBad = TEST_NAMES.has(name);
    if (idBad || nameBad) offenders.push(`${f}（${name}，${savedAt ? new Date(savedAt).toISOString().slice(0, 16) : '时间未知'}）`);
  }
  ok('saves/ 内无测试命名档（id/角色名双判据）', offenders.length === 0,
    offenders.length ? '污染档：' + offenders.join('；') : '现有 ' + files.length + ' 份档全部干净');
}

/* 顺手验子目录（_b8test/_t 这类历史手工目录） */
const subOffenders = [];
for (const d of fs.existsSync(SAVES) ? fs.readdirSync(SAVES).filter(x => { try { return fs.statSync(path.join(SAVES, x)).isDirectory(); } catch (e) { return false; } }) : []) {
  const sd = path.join(SAVES, d);
  for (const f of fs.readdirSync(sd).filter(x => x.endsWith('.json'))) {
    subOffenders.push(d + '/' + f);
  }
}
ok('saves/ 子目录无散落档', subOffenders.length === 0, subOffenders.join('；') || '（空目录不管）');

console.log('\n' + '='.repeat(44));
console.log(`  存档卫生守卫：通过 ${pass} / 失败 ${fail}`);
console.log('='.repeat(44));
if (fail) {
  console.log('  处置：把污染档移进 .livetest/saves-quarantine/（可逆），别直接删。');
}
process.exit(fail ? 1 : 0);
