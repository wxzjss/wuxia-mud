#!/usr/bin/env node
/* ============================================================
 * prune-test-npc.js —— 清掉残留的测试数据 `test_npc`
 *
 * team-lead 裁定：删。理由（他写给我的原话）：
 *   「留着会持续消耗后续每一次『扫全库 NPC』的判断成本（这次就绊了你一下），
 *     而且它的名字叫「测试NPC」—— 哪天某个生成器顺手给它补上 room，
 *     它就直接出现在玩家面前了。惰性的脏数据也是债。」
 *
 * 他要求删之前确认三件事，本脚本逐条做并在末尾打出来：
 *   ① 三个文件里它各自是独立一行/独立键，删掉不破坏 JSON
 *      ⇒ 做法：**JSON.parse → delete → 再 stringify**，不靠文本替换，
 *        语法上不可能写坏（这也是 D7「读磁盘 ≠ 引擎合并」那一族坑的另一种规避）
 *   ② 删完跑一次真引擎 boot，确认结构没坏
 *   ③ tools/npc-skills.js:252 的跳过名单里引用了它，一并清掉（否则留个指向空气的引用）
 *
 * 用法： node tools/prune-test-npc.js [--dry]
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const DRY = process.argv.indexOf('--dry') >= 0;

const TARGET = 'test_npc';
/* ⚠️ 是 **4 个**文件不是 3 个：我第一次只找到 77/86/87，因为取证时用了
   `grep ... | head -3` 把第四条截掉了 —— 真正给它补 `carry`（身上钱数）的是
   `91_npclife.json`。教训：**清点类命令不要 head**，否则漏掉的那条会在
   删完之后从引擎里冒出来打你的脸（本次实测就是这么发生的）。 */
const FILES = ['77_npc_martial.json', '86_npc_neili.json', '87_persona.json', '91_npclife.json'];
const SKIP_FILE = path.join(ROOT, 'tools', 'npc-skills.js');
const MOD_FILE = path.join(ROOT, 'mods', 'test_mod', 'mod.json');

/* ⚠️ mods/ 不在 game/ 下，本来**不在我的派工范围**。上轮我把这第五处来源报到
   team-lead，他的裁定（P0-2d）是：
     「② 删 mods/test_mod/mod.json 的 test_npc 块 —— 批准。你已证 lore 17/0 且
       4 个依赖套件全不受影响，这就是我要的证据。」
   所以这一步是**授权后**才加的，不是我自己扩范围。
   已证副作用：lore-consistency-check 17/0、check-data-load 72/0、
   smoke-mod-account 33/0、smoke-sidequest 57/0、smoke-test 无异常。
   （本文件里保留 test_room / test_quest / test_skill / test_item —— 那几个是
     mod 数据合并的验证样本，team-lead 只批删 test_npc，不多动。） */
const AUTHORIZED_MOD_DELETE = true;

/* ---------- ① 数据文件：解析 → 删键 → 写出 ---------- */
let removed = 0;
const cache = {};
for (const f of FILES) {
  const p = path.join(DATA, f);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));   // ① 能 parse 说明原本就是合法 JSON
  cache[f] = { json, hit: 0 };
  for (const coll of Object.keys(json)) {
    const root = json[coll];
    if (!root || typeof root !== 'object') continue;
    if (Object.prototype.hasOwnProperty.call(root, TARGET)) {
      delete root[TARGET];
      cache[f].hit++;
      removed++;
    }
  }
}
console.log('① 数据文件：命中并删除 ' + removed + ' 处（'
  + FILES.map(f => f + ' ' + cache[f].hit).join(' · ') + '）');

/* ---------- ③ 清掉跳过名单里的引用 ---------- */
let skipLine = '';
{
  let src = fs.readFileSync(SKIP_FILE, 'utf8');
  const before = src;
  src = src.replace(/^(\s*)'test_npc',\s*(?='demo_swordman')/m, '');
  if (src !== before) {
    skipLine = '已从 SKIP_IDS 里摘掉 ' + TARGET + '（demo_swordman 保留）';
    if (!DRY) fs.writeFileSync(SKIP_FILE, src, 'utf8');
  } else {
    skipLine = '未找到可摘的行（可能已清过），请人工确认';
  }
}
console.log('③ ' + skipLine);

/* ---------- ④ 测试模组：授权后删（解析 → 删键 → 写出，绝不文本替换） ---------- */
let modRemoved = 0;
if (AUTHORIZED_MOD_DELETE && fs.existsSync(MOD_FILE)) {
  const mj = JSON.parse(fs.readFileSync(MOD_FILE, 'utf8'));
  if (mj.npcs && Object.prototype.hasOwnProperty.call(mj.npcs, TARGET)) {
    delete mj.npcs[TARGET];
    modRemoved = 1;
    if (!DRY) fs.writeFileSync(MOD_FILE, JSON.stringify(mj, null, 2) + '\n', 'utf8');
  }
  console.log('④ 测试模组：' + (modRemoved ? '已删 npcs.' + TARGET + '（授权后）' : '未发现 npcs.' + TARGET + '（可能已删）'));
}

if (DRY) { console.log('\n--dry：不落盘。'); process.exit(0); }

for (const f of FILES) {
  if (!cache[f].hit) continue;
  fs.writeFileSync(path.join(DATA, f), JSON.stringify(cache[f].json, null, 1) + '\n', 'utf8');
  console.log('已写入 ' + f);
}

/* ---------- ② 真引擎 boot：结构没坏 + 目标确实没了 ---------- */
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const e = new GameEngine({ seed: 20261022, mods: false });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });

const N = e.world.data.npcs;
console.log('\n② 真引擎 boot 断言：');
console.log('  引擎起得来、NPC 总数 = ' + Object.keys(N).length);

/* ⚠️ 关键发现：把 game/data 里的 4 处全删干净之后，引擎里**还**看得到 test_npc
   （名字「测试NPC」）。追下去发现它的真身是 **mods/test_mod/mod.json** ——
   `engine.js:123` 无条件设了 this.modsDir，`world.js` 的 modDirs 也就无条件带上，
   `mods:false` 只关掉 mod 的脚本 API、**关不掉 mod 的数据合并**。
   ⇒ 每次 boot 都会把「测试NPC / 测试房间 / 测试任务」并进世界数据。
   这一段**不属于本批派工范围**（mods/ 不在 game/ 下），只报告、不删。 */
let inData = 0;
for (const f of FILES) {
  if (fs.readFileSync(path.join(DATA, f), 'utf8').indexOf(TARGET) >= 0) inData++;
}
console.log('  ' + (inData === 0 ? '✔ game/data 的 ' + FILES.length + ' 个文件里已无 ' + TARGET
  : '✘ game/data 仍有 ' + inData + ' 个文件含 ' + TARGET));
const modPath = path.join(ROOT, 'mods', 'test_mod', 'mod.json');
const modHas = fs.existsSync(modPath) && fs.readFileSync(modPath, 'utf8').indexOf(TARGET) >= 0;
console.log('  ' + (N[TARGET]
  ? '✘ 引擎里仍能取到 ' + TARGET + '（name=' + N[TARGET].name + '）—— 来源是 '
    + (modHas ? 'mods/test_mod/mod.json（测试模组，每次 boot 都被合并进来）' : '未查明')
  : '✔ 引擎 data.npcs 里已无 ' + TARGET + '（数据 4 处 + 模组 1 处，共 5 处全清）'));

/* 只统计「game/data 里出来的」中文夹拉丁名字，不把 mod 治罪 */
let bad = 0;
for (const id of Object.keys(N)) {
  const nm = String((N[id] && N[id].name) || '');
  if (/[A-Za-z]{2,}/.test(nm) && /[一-龥]/.test(nm)) {
    if (id === TARGET && modHas) continue;
    bad++; console.log('  ✘ ' + id + ' = ' + nm);
  }
}
console.log('  ' + (bad ? '✘ game/data 仍有 ' + bad + ' 处中文夹拉丁的 NPC 名'
  : '✔ game/data 已无「中文里夹拉丁」的 NPC 名'));
process.exit(inData || bad || N[TARGET] ? 1 : 0);
