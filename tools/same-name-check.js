/* ============================================================
 * same-name-check.js — 同地块禁同名·引擎级清查工具（长期铁律配套）
 *
 * 主人裁定（2026-10-15）：同地块禁止同名 NPC——respawn 再也不许同房同名。
 * 数据侧断言（_apply_same_name_fix.py）管配置；本工具管**引擎实测**：
 *   newGame → 全房走一遍（触发懒生成）→ 120×worldTick（触发 respawn 补员）
 *   → 全房 npcsIn 按显示名计数 → 同房同名即红。
 * 豁免口径（对齐 world.js:34 isCelebrity）：unique===true || tier==='A'——
 *   名人引擎全图去重，出现即被判「同名」必是引擎 bug，单独列出不混入铁律红。
 * 供守卫合验与后续回归共用：node tools/same-name-check.js
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const TICKS = 120; // respawn 逐 tick 补员，120 足够刷满（硬帽 mob_ 8/其他 3）

const eng = new GameEngine({ seed: 20261015 });
eng.boot();
eng.newGame({ name: '清查侠客', gender: 'male' });
const w = eng.world, p = w.player;

const isCelebrity = (def) => !!(def && (def.unique === true || def.tier === 'A'));

/* 全房走一遍：触发懒生成与 encounter 池实例化；战斗即清（探针不是来打架的） */
let visited = 0;
for (const rid of Object.keys(w.data.rooms)) {
  const r = w.movePlayerTo(p, rid);
  if (r && r.ok === false) continue; // 不可达房（封闭/未启用）跳过
  visited++;
  p.hp = p.maxHp;
  if (w.battle) w.battle = null;
}
for (let i = 0; i < TICKS; i++) w.worldTick();

/* 全房按显示名计数 */
const violations = [], celebrityHits = [];
for (const rid of Object.keys(w.data.rooms)) {
  const byName = new Map();
  for (const n of w.npcsIn(rid)) {
    if (n.dead) continue;
    const nm = n.name || (n.def && n.def.name) || n.defId;
    if (isCelebrity(n.def)) { celebrityHits.push([rid, nm, n.defId]); continue; }
    if (!byName.has(nm)) byName.set(nm, []);
    byName.get(nm).push(n.defId);
  }
  for (const [nm, ids] of byName) {
    if (ids.length > 1) violations.push({ room: rid, name: nm, ids });
  }
}

console.log('全房 ' + visited + '/' + Object.keys(w.data.rooms).length + ' 送达，补员 ' + TICKS + ' tick');
if (celebrityHits.length) {
  console.log('名人在场（引擎去重豁免，仅备忘）：');
  for (const [rid, nm, id] of celebrityHits) console.log('  · ' + rid + ' | ' + nm + ' (' + id + ')');
}
if (violations.length) {
  console.log('✘ 同房同名违规 ' + violations.length + ' 处：');
  for (const v of violations) console.log('  ✘ ' + v.room + ' | 同名:[' + v.name + ' x' + v.ids.length + '] ' + v.ids.join(','));
  process.exit(1);
} else {
  console.log('✔ 同房同名 0 处（铁律通过）');
}
