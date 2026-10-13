/* fix-npc-weapons.js —— 给「有兵刃招式却没家伙」的 NPC 补上兵刃
 *
 * 主人 bug 台账 B8 的配套数据修正：
 *   combat.weaponPenalty 对「手里没对应兵刃」的人打 0.45 折，日志里还会刷
 *   「手中无X类兵刃」。smoke-npc-skills 的硬不变量钉的就是这条：
 *   兵刃系槽位（刀/剑/棍/鞭/枪）配了招式，就必须握着对应 weaponType 的兵器。
 *
 * 为什么做成独立工具而不是各生成器里手写：
 *   补人的数据源有 40_npcs / 42_sect_guards / 43_sect_disciples / 91_npclife …
 *   每加一批新 NPC 就会再冒一批空手的，靠人肉记不如让工具兜一遍。
 *
 * 挑哪把：按门派档次优先挑本门的东西（「太白剑」给剑侠、「血刀」给血刀门），
 *   挑不到就给基础款（木剑/砍山刀/白蜡杆/铁枪/长鞭）——
 *   守门弟子和记名弟子人手一把名剑反而假。
 *
 * 用法：node tools/fix-npc-weapons.js            （打印清单后落盘）
 *       node tools/fix-npc-weapons.js --dry      （只看不动）
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'game', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

const items = load('20_items.json').items || {};

/* 兵刃槽 → 基础款兵器 */
const BASE_WEAPON = { 刀: 'iron_blade', 剑: 'iron_sword_basic', 棍: 'wood_staff', 鞭: 'long_whip', 枪: 'iron_spear' };
const SLOTS = Object.keys(BASE_WEAPON);

/* 只在「确实是本门的东西」时用名兵；否则一律基础款。
   ⚠️ 别按 id 猜档次去发倚天剑 —— 一个 B 层路人握着倚天剑，
   玩家第一反应是「这人怎么捡的」，不是「这人厉害」。 */
const BASE = { 剑: 'iron_sword_basic', 刀: 'iron_blade', 棍: 'wood_staff', 鞭: 'long_whip', 枪: 'iron_spear' };

/** 这个门派有没有自己的家伙（名字/描述里带门派名的兵器） */
function sectWeapon(sectId, slot) {
  if (!sectId) return null;
  let best = null;
  for (const it of Object.values(items)) {
    if (it.weaponType !== slot) continue;
    const hay = `${it.name || ''}${(it.desc || '')}${it.id}`;
    if (!hay.includes(sectId)) continue;
    if (!best) best = it.id;
  }
  return best;
}

const DRY = process.argv.includes('--dry');
const files = fs.readdirSync(dataDir).filter(f => /^\d+_.*\.json$/.test(f)).sort();
const fixed = [];
let totalFixed = 0;

for (const f of files) {
  const full = path.join(dataDir, f);
  let j = null;
  try { j = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { continue; }
  if (!j || !j.npcs) continue;
  let touched = false;

  for (const [id, d] of Object.entries(j.npcs)) {
    if (!d || !d.skills) continue;
    const need = SLOTS.filter(slot => {
      if (!d.skills[slot]) return false;
      const wpn = (d.equipment || {})['武器'];
      const it = wpn ? items[wpn] : null;
      return !(it && it.weaponType === slot);
    });
    if (!need.length) continue;

    /* 一件兵器只能对一个槽。多个槽缺家伙时，只补**第一个** ——
       招式与兵器一一对应才说得通，硬塞两三把在身上反而不像人。 */
    const slot = need[0];
    const sectId = d.sect || String(id).replace(/^sectguard_/, '').replace(/^disciple_(.+?)_\d+$/, '$1');
    let pick = sectWeapon(sectId, slot);
    if (!pick || !items[pick]) pick = BASE[slot];
    if (!pick) continue;

    d.equipment = Object.assign({}, d.equipment, { 武器: pick });
    touched = true;
    totalFixed++;
    fixed.push(`${id}(${d.name}) ${slot} → ${pick}(${items[pick].name})`);
  }

  if (touched && !DRY) fs.writeFileSync(full, JSON.stringify(j, null, 1), 'utf8');
}

for (const line of fixed) console.log('  · ' + line);
console.log(`\n${DRY ? '[试跑] ' : ''}补兵刃 ${totalFixed} 处，涉及 ${new Set(fixed.map(x => x.split('(')[0])).size} 个 NPC`);
