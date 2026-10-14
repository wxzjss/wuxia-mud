/**
 * demo-mods-check.js — 示例 Mod 体检（主人 2026-10-08：「看看示例 mod 有没有需要改动的」）
 *
 * 示例 mod 是**给人抄的模板** —— 它自己不规范，抄出来的东西就不规范。
 * 所以这里查三件事：
 *   ① 能不能解析（mod.json 是 JSON，不能有注释 —— 我自己就在这儿栽过一次）
 *   ② 引用的 id 是否真实存在（房间 / 武学 / 物品 / NPC，主数据与 mod 自身合起来算）
 *   ③ 新增的字段规范（NPC 要有 tag 与 personality；物品要有 type）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '\n      ' + extra : '')); } };

/* ⚠️ 2026-10-17 隔离（今晨 mods-state.json 三份污染案）：ModLoader 构造时会
 * loadState 读工作目录旁的 mods-state.json——测试残留（哪怕别的流程落的）会把
 * demo 当已启用 → ④「默认全部关闭」假红；而 boot() 末尾 resolveLoadOrder() 又会
 * **无条件 saveState()** 把内存态写盘（只改内存也会被这条隐式路径落盘）。
 * 两头都堵：①state 清零后重扫（enabled 只认 mod.json 的 enabledByDefault）
 * ②saveState no-op（本测试零写盘）。玩家/服务器侧状态文件不受任何影响。 */
const isolatedEngine = (opts) => {
  const e = new GameEngine(opts);
  e.modLoader.state = { enabled: {}, order: [], installedFromWeb: {} };
  e.modLoader.scan();
  e.modLoader.saveState = function () {};
  return e;
};

const engine = isolatedEngine({ seed: 1 });
engine.boot();
const w = engine.world;
const hasRoom = id => !!w.getRoom(id);
const hasSkill = id => !!w.getSkill(id);
const hasItem = id => !!w.getItem(id);

const modDirs = fs.readdirSync(path.join(ROOT, 'mods'))
  .filter(d => d.startsWith('demo_'))
  .map(d => path.join(ROOT, 'mods', d));

console.log(`示例 mod ${modDirs.length} 个`);

console.log('\n===== ① 能否解析 =====');
{
  const bad = [];
  for (const dir of modDirs) {
    const f = path.join(dir, 'mod.json');
    if (!fs.existsSync(f)) { bad.push(dir + ' 没有 mod.json'); continue; }
    try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { bad.push(path.basename(dir) + '：' + e.message.slice(0, 60)); }
  }
  ok('每个示例 mod 都是合法 JSON（不能有注释）', bad.length === 0, bad.join('\n      '));
}

console.log('\n===== ② 引用完整性 =====');
{
  const miss = [];
  for (const dir of modDirs) {
    const name = path.basename(dir);
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    const own = new Set([
      ...(j.rooms || []).map(r => r.id),
      ...(j.skills || []).map(s => s.id),
      ...(j.items || []).map(s => s.id),
      ...(j.npcs || []).map(s => s.id),
      ...(j.books || []).map(s => s.id),
    ]);
    const there = id => own.has(id) || hasRoom(id) || hasSkill(id) || hasItem(id);

    for (const r of (j.rooms || [])) {
      for (const d of Object.keys(r.exits || {})) {
        const ex = r.exits[d];
        const to = typeof ex === 'string' ? ex : ex && ex.to;
        if (to && !there(to)) miss.push(`${name}/${r.id} 的「${d}」指向不存在的 ${to}`);
      }
      for (const it of (r.items || [])) {
        const iid = typeof it === 'string' ? it : it && it.id;
        if (iid && !there(iid)) miss.push(`${name}/${r.id} 里摆了不存在的物品 ${iid}`);
      }
    }
    for (const n of (j.npcs || [])) {
      if (n.room && !there(n.room)) miss.push(`${name}/${n.id} 站在不存在的房间 ${n.room}`);
      /* ⚠ 2026-10-13 修存量口径：teach/learned 早年查 hasSkill（合并后世界），
         行 59-68 的房/物早就是 there（own+世界）——同一节两种口径。
         demo mods 默认关（enabledByDefault:false，重击批：官方示例是给 Mod 作者
         参考的，不该默认注入玩家主世界）之后，mod 自带的武学不再合并进世界，
         hasSkill 抓不到 own 里的定义 → 假红。统一走 there。 */
      for (const sid of [].concat(n.teach || [])) if (sid && !there(sid)) miss.push(`${name}/${n.id} 要教不存在的武学 ${sid}`);
      for (const sid of Object.keys(n.learned || {})) if (!there(sid)) miss.push(`${name}/${n.id} 会一门不存在的武学 ${sid}`);
    }
    for (const q of (j.quests || [])) {
      const g = q.giver && (typeof q.giver === 'string' ? q.giver : q.giver.id);
      if (g && !own.has(g) && !w.getNpc(g)) miss.push(`${name}/${q.id} 的委托人 ${g} 不存在`);
    }
  }
  ok('示例 mod 引用的房间 / 武学 / 物品 / 人都存在', miss.length === 0, miss.slice(0, 10).join('\n      '));
}

console.log('\n===== ③ 字段规范（示例是给人抄的，尤其要规范） =====');
{
  const noPersona = [], noTag = [];
  let npcCount = 0;
  for (const dir of modDirs) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    for (const n of (j.npcs || [])) {
      npcCount++;
      if (!n.personality || !P.PERSONALITIES[n.personality]) noPersona.push(path.basename(dir) + '/' + (n.name || n.id));
      if (!n.tag) noTag.push(path.basename(dir) + '/' + (n.name || n.id));
    }
  }
  ok('示例 mod 里有 NPC（前提）', npcCount > 0, npcCount + ' 个');
  ok('示例 mod 的 NPC 都写了 personality', noPersona.length === 0, noPersona.join('、'));
  ok('示例 mod 的 NPC 都写了 tag（细看才看得出行当）', noTag.length === 0, noTag.join('、'));

  const badItem = [];
  for (const dir of modDirs) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'mod.json'), 'utf8'));
    for (const it of (j.items || [])) if (!it.type) badItem.push(path.basename(dir) + '/' + (it.name || it.id));
  }
  ok('示例 mod 的物品都有 type', badItem.length === 0, badItem.join('、'));
}

console.log('\n===== ④ 加载后真的进得来（不报错） =====');
{
  /* 全部示例 mod 一起启用，boot 一遍 —— 有冲突 / 坏字段会在这一步炸出来 */
  let err = '';
  try {
    const e2 = isolatedEngine({ seed: 1 });   /* 同隔离：清零重扫 + no-op 写回 */
    e2.boot();
    const mods = e2.modLoader && e2.modLoader.mods ? e2.modLoader.mods.filter(m => /^demo_/.test(m.id)) : [];
    ok('示例 mod 被加载器认出来了', mods.length >= 5, mods.length + ' 个');
    /* 2026-10-13 口径反转（重击批）：官方示例 mod 默认**关闭**——示例是给 Mod
       作者参考的，默认注入玩家主世界会把示例 NPC/怪放进新手动线（主人真机
       实锤：出生点挤着示例游侠+漂来的山贼）。玩家想看示例可手动开。
       判据改为：全部 demo_ 默认关 + mod.json 显式写了 enabledByDefault:false。 */
    const off = mods.filter(m => m.enabled);
    ok('示例 mod 默认全部关闭（enabledByDefault:false，可手动开）', off.length === 0, off.map(m => m.id).join('、'));
  } catch (e) { err = String(e && e.message || e); }
  ok('带示例 mod 启动不报错', !err, err);
}

console.log(`\n===== demo-mods-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
