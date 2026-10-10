/**
 * gen-npc-skills.js — B8「按身份给 NPC 配功法」的落地产出（确定式生成器）
 *
 * 用法：
 *   node tools/gen-npc-skills.js --check    # 只报告，不写盘
 *   node tools/gen-npc-skills.js            # 写回 game/data/10_skills.json + 40_npcs.json
 *
 * 做两件事（同一遍完成）：
 *   ① 把关卡 `npc-skills.js` 里的 6 门「江湖通用」功法追加进 `10_skills.json`
 *      （已存在则跳过，幂等）；
 *   ② 按 `npc-skills.js` 的身份规则表给每个 NPC 落功法
 *      （**只加不夺**：basic_* 升身份功法 + 补缺的支持槽；已有真功夫一律保留）。
 *
 * 与 B3 的关系：规则表结构同源（id/sect/tag 三级显式判据、无关键词猜测），
 * 差别只在**落地时机**——B3 运行时注入（挂 world.js），B8 生成期落回数据
 * （避免碰正在被并行修改的 world.js，且「谁会什么」在 JSON 里可查可断言）。
 *
 * 安全阀：
 *   · 两文件都先过「JSON.stringify 逐字节还原」格式闸门，不过即拒绝改写；
 *   · 幂等：重复运行结果一致（非 basic 槽不再动、learned 已有不再动）；
 *   · 收尾自动清「悬空 learned 引用」（技能 id 在 skills 里不存在的），并报告。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NPCS_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const SKILLS_FILE = path.join(ROOT, 'game', 'data', '10_skills.json');
const ITEMS_FILE = path.join(ROOT, 'game', 'data', '20_items.json');
const { GENERIC_SKILLS, PLAIN_WEAPON, planForNpc, applyPlan } = require('./npc-skills');

const CHECK = process.argv.includes('--check');

function readJsonGuarded(file, indent, trailer) {
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw);
  const rebuilt = JSON.stringify(data, null, indent) + (trailer || '');
  if (rebuilt !== raw) {
    console.error('✘ 格式闸门未过（' + path.relative(ROOT, file) + '）：无法逐字节还原，拒绝改写。');
    process.exit(2);
  }
  return { raw, data };
}

const skillsFile = readJsonGuarded(SKILLS_FILE, 2, '\n');
const items = JSON.parse(fs.readFileSync(ITEMS_FILE, 'utf8')).items;
const npcFile = readJsonGuarded(NPCS_FILE, 1, '');

/* ---- ① 注入 6 门江湖通用功法（追加到 skills 末尾；已存在则跳过） ---- */
const skills = skillsFile.data.skills;
const injectedSkills = [];
for (const sk of GENERIC_SKILLS) {
  if (skills[sk.id]) continue;
  skills[sk.id] = JSON.parse(JSON.stringify(sk));
  injectedSkills.push(sk.id);
}
const isKnown = (id) => !!skills[id];

/* ---- ② 按身份规则表落功法 ---- */
const npcs = npcFile.data.npcs;
const knownSeed = (id) => !!skillsFile.data.skills[id];

/* 给模板装/换兵刃。
   ⚠️ 键序：新建设备对象时要插在 `portrait` **之前**。
   `gen-portraits.js` 的重建方式是「先 delete portrait 再赋回」→ portrait 永远排在对象**末位**；
   `smoke-portrait-batch.js` §3.7 断言「从零重建 == 磁盘」。若我们把 equipment 追加到 portrait **之后**，
   磁盘键序就变成 [..., portrait, equipment]，而重建产出 [..., equipment, portrait] → 3.7 变红（纯键序差异）。
   故新建设备对象时显式插在 portrait 前，保持 portrait 末位不变。 */
function setWeapon(def, itemId) {
  if (!def.equipment || typeof def.equipment !== 'object' || Array.isArray(def.equipment)) {
    const eq = { 武器: itemId };
    if (def.portrait === undefined) { def.equipment = eq; return; }
    const rebuilt = {};
    for (const k of Object.keys(def)) {
      if (k === 'portrait') rebuilt.equipment = eq;
      rebuilt[k] = def[k];
    }
    for (const k of Object.keys(def)) delete def[k];
    Object.assign(def, rebuilt);
  } else {
    def.equipment['武器'] = itemId;
  }
}

/* 兵刃闸门：这个 NPC 现在握着该系兵刃吗？没握就补一把最普通的（见 PLAIN_WEAPON）。 */
const weaponLog = [];
function weaponTypeOf(def) {
  const wpn = (def.equipment || {})['武器'];
  const it = wpn ? items[wpn] : null;
  return it ? it.weaponType : null;
}
/* 武学体系里「有的」兵刃系（与 combat.js 的 WEAPON_REQUIRED 一致）。
   ⚠️ 「枪」不在其中——全库没有任何 type='枪' 的招式，`WEAPON_REQUIRED` 也没有枪这一键，
   装了枪的 NPC 使任何兵刃系招式都吃 0.8 折……不，是吃 0.45 惩罚（type 对不上）。
   所以「手里只有枪」的 NPC 等于没兵刃，改配一把同身份的普通兵刃。 */
const USABLE_WEAPON_TYPES = { 剑: 1, 刀: 1, 棍: 1, 鞭: 1, 暗器: 1, 音波: 1 };
function ensureWeapon(def, slot) {
  if (weaponTypeOf(def) === slot) return true;          // 已有匹配兵刃
  const cur = (def.equipment || {})['武器'];
  const heldType = cur ? weaponTypeOf(def) : null;
  const plain = PLAIN_WEAPON[slot];
  if (cur && USABLE_WEAPON_TYPES[heldType]) return false;   // 手里已有别的**可用**兵器 → 不夺，退拳脚
  if (!plain) return false;                              // 暗器/音波无普通兵刃可配
  setWeapon(def, plain);
  weaponLog.push((def.id || '?') + ' ' + (def.name || '') + (cur
    ? '：' + cur + '(' + heldType + ')无对应武学系 → 改配 ' + plain
    : '：补普通兵刃 ' + slot + '→' + plain));
  return true;
}

const changed = [];
let touched = 0;
const notCovered = [];
const perSlot = {};
for (const id of Object.keys(npcs)) {
  const def = npcs[id];
  const plan = planForNpc(def, id);
  if (!plan) { notCovered.push(id); continue; }
  const rec = applyPlan(def, plan, { isKnown: knownSeed, id: id, ensureWeapon: ensureWeapon });
  if (rec) {
    touched++;
    changed.push(rec);
    for (const x of rec.attack.concat(rec.support)) {
      const slot = x.split(':')[0];
      perSlot[slot] = (perSlot[slot] || 0) + 1;
    }
  }
}

/* ---- ②b 同类排查：装着兵刃系招式的 NPC，手里必须有对应兵刃 ----
   理由：combat.weaponPenalty 对「兵刃系招式 + 没有对应兵刃」打 0.45 折 + 日志「手中无X类兵刃」。
   全库实测 **B8 之前就有 49 处**这样的空装（山贼有刀法没刀、捕快拿枪使刀法…）——
   与本批同类根因（招式与装备对不上），一并补掉。暗器/音波无对应兵器道具（无法满足），豁免。 */
const weaponRepair = [];
const canNever = {};
(function ensureAllWeapons() {
  for (const id of Object.keys(npcs)) {
    const def = npcs[id];
    if (!def.skills) continue;
    for (const slot of Object.keys(def.skills)) {
      if (!USABLE_WEAPON_TYPES[slot]) continue;          // 暗器/音波：无兵器道具，豁免
      if (!def.skills[slot]) continue;
      if (weaponTypeOf(def) === slot) continue;          // 已匹配
      const cur = (def.equipment || {})['武器'];
      const heldType = cur ? weaponTypeOf(def) : null;
      if (cur && USABLE_WEAPON_TYPES[heldType]) {        // 手里有别的可用兵器 → 不夺
        canNever[slot + ':' + heldType] = (canNever[slot + ':' + heldType] || 0) + 1;
        continue;
      }
      const plain = PLAIN_WEAPON[slot];
      if (!plain) { canNever[slot] = (canNever[slot] || 0) + 1; continue; }
      setWeapon(def, plain);
      weaponRepair.push(id + ' ' + (def.name || '') + ' → ' + slot + '=' + def.skills[slot] + '（' + (cur ? cur + '↔' : '无兵器↔') + plain + '）');
    }
  }
})();

/* ---- ③ 清理悬空 learned 引用（保留既有字段的规整，属修错不是删字段） ---- */
const danglingLearned = [];
for (const id of Object.keys(npcs)) {
  const L = npcs[id].learned;
  if (!L) continue;
  for (const sid of Object.keys(L)) {
    if (!isKnown(sid)) {
      delete L[sid];
      danglingLearned.push(id + '·' + sid);
    }
  }
}

/* ---- ④ 自检：每个槽里的技能都必须在 learned 里（否则 pickSkill 会跳过 = 白装） ---- */
const slotNotLearned = [];
const danglingSlots = [];
for (const id of Object.keys(npcs)) {
  const def = npcs[id];
  if (!def.skills) continue;
  for (const slot of Object.keys(def.skills)) {
    const sid = def.skills[slot];
    if (!sid) continue;
    if (!isKnown(sid)) { danglingSlots.push(id + ':' + slot + '=' + sid); continue; }
    // 只有「显式写了 learned」的模板才需要 learned 齐备；没写 learned 的走 spawnNpc 自动派生
    if (def.learned && def.learned[sid] === undefined && Object.keys(def.learned).length) {
      slotNotLearned.push(id + ':' + slot + '=' + sid);
    }
  }
}

/* ---- ⑤ 写盘 / 报告 ---- */
if (!CHECK) {
  fs.writeFileSync(SKILLS_FILE, JSON.stringify(skillsFile.data, null, 2) + '\n', 'utf8');
  fs.writeFileSync(NPCS_FILE, JSON.stringify(npcFile.data, null, 1), 'utf8');
}

console.log('=== gen-npc-skills ' + (CHECK ? '（--check，未写盘）' : '（已写盘）') + ' ===');
console.log('① 新注入江湖通用功法：' + (injectedSkills.length ? injectedSkills.join('、') : '（无，已存在）'));
console.log('② 本次落功法的 NPC 数：' + touched + ' / 全库 ' + Object.keys(npcs).length);
console.log('   按槽统计：' + JSON.stringify(perSlot));
console.log('   未覆盖（判不出身份，原样不动）：' + notCovered.length + ' 条');
if (notCovered.length) console.log('     ' + notCovered.join(', '));
console.log('   ★ 补普通兵刃（无兵刃的兵刃系武人）：' + weaponLog.length + ' 席');
weaponLog.slice(0, 12).forEach(x => console.log('     ' + x));
if (weaponLog.length > 12) console.log('     …');
const fell = changed.filter(r => r.fellBack && r.fellBack.length).map(r => r.id + ':' + r.fellBack.join('/'));
console.log('   ★ 退走拳脚（有兵刃系身份但使不上兵刃）：' + fell.length + (fell.length ? '（' + fell.join(', ') + '）' : ''));
console.log('   ★ 同类排查·补既有空装兵刃：' + weaponRepair.length + ' 处' + (weaponRepair.length ? '（' + weaponRepair.slice(0, 8).join('；') + (weaponRepair.length > 8 ? ' …' : '') + '）' : ''));
console.log('   ★ 无法补（手里已有别的可用兵器 / 无对应兵器道具）：' + JSON.stringify(canNever));
console.log('③ 清理悬空 learned 引用：' + danglingLearned.length + ' 处' + (danglingLearned.length ? '（' + danglingLearned.join(', ') + '）' : ''));
console.log('④ 自检：槽技能未挂 learned 的 =' + slotNotLearned.length + (slotNotLearned.length ? '（' + slotNotLearned.slice(0, 8).join(', ') + '）' : '（全齐）'));
console.log('   悬空槽引用 =' + danglingSlots.length + (danglingSlots.length ? '（' + danglingSlots.join(', ') + '）' : '（无）'));

/* 样例：抽 6 个身份各异的看变化 */
console.log('\n— 样例（6 人）—');
for (const id of ['npcv_002', 'npcv_027', 'npcv_081', 'npcv_058', 'npcv_051', 'npcv_073']) {
  if (!npcs[id]) continue;
  console.log('  ' + id + ' ' + npcs[id].name + '（tag=' + npcs[id].tag + ',tier=' + npcs[id].tier + '）  ' +
    JSON.stringify(npcs[id].skills) + '  learned=' + Object.keys(npcs[id].learned || {}).join('/'));
}
if (slotNotLearned.length || danglingSlots.length) process.exit(1);
