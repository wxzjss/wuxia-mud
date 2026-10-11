/* ============================================================
 * prune-stub-quests.js —— 剪掉模板化「水货」支线（写入型）
 *
 * 主人 2026-10-11：「把那些模板化支线水货支线删掉或每个城市留那么几个」。
 *
 * 实测：全库 379 条支线里，**262 条**是 `sq_npcv_*` —— 一共只有 10 个骨架，
 * 每个骨架重复 24~28 次，纯粹按「NPC 名 + 所在房间」换皮：
 *   《X的采买》《X的采药》《X的除害》《X的送信》《X的护送》
 *   《X的了结》《X的讨债》《X的寻物》《X的寻人》《X的打探》
 * 每个都是「去某间房 → 回来交差」两段式，desc 空洞。
 * 它们占了全部支线的 69%，把真正写过剧情的支线（sq_cy_* / sq_gaibang_* /
 * 门派线…）淹掉了 —— 任务面板一打开全是采买采药。
 *
 * 做法（保守）：**按区域各留 3 条**，其余删掉；并同步清掉 NPC 身上指向
 * 被删支线的 `sidequest` 引用（留着悬空引用会被 encounter 当成「他手里牵着事」）。
 *
 * ⚠️ 只认 `sq_npcv_` 前缀 —— 别的一律不碰（那是**别人写的**，不是模板货）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const QF = path.join(ROOT, 'game', 'data', '60_quests.json');
const NF = path.join(ROOT, 'game', 'data', '40_npcs.json');

const KEEP_PER_REGION = 3;
const DRY = process.argv.indexOf('--dry') >= 0;

const qdoc = JSON.parse(fs.readFileSync(QF, 'utf8'));
const ndoc = JSON.parse(fs.readFileSync(NF, 'utf8'));
const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '50_map.json'), 'utf8'));
const rooms = map.rooms || {};

const stubs = Object.keys(qdoc.quests).filter(id => /^sq_npcv_/.test(id));
const regionOf = (qid) => {
  const g = qdoc.quests[qid] && qdoc.quests[qid].giver;
  const def = ndoc.npcs[g];
  const r = def && rooms[def.room];
  return (r && r.region) || '(无)';
};

/* 按区域分组，每组按 id 排序取前 KEEP 条 */
const byReg = {};
for (const id of stubs) (byReg[regionOf(id)] = byReg[regionOf(id)] || []).push(id);
const keep = new Set();
for (const reg of Object.keys(byReg)) byReg[reg].sort().slice(0, KEEP_PER_REGION).forEach(id => keep.add(id));
const drop = stubs.filter(id => !keep.has(id));
const dropSet = new Set(drop);

console.log(`模板支线 ${stubs.length} 条，覆盖 ${Object.keys(byReg).length} 个区域`);
console.log(`保留 ${keep.size} 条（每区 ≤ ${KEEP_PER_REGION}）／删除 ${drop.length} 条`);
if (DRY) { console.log('（--dry：只看数字，不写文件）'); process.exit(0); }

for (const id of drop) delete qdoc.quests[id];
fs.writeFileSync(QF, JSON.stringify(qdoc, null, 2) + '\n', 'utf8');

/* 清 NPC 侧的悬空引用（40_npcs.json 是 1 空格缩进，逐行文本替换，保住原格式） */
let txt = fs.readFileSync(NF, 'utf8');
let removed = 0;
txt = txt.replace(/\n\s*"sidequest": "sq_npcv_(\d+)",/g, (m, num) => {
  const id = 'sq_npcv_' + num;
  if (!dropSet.has(id)) return m;      // 保留的照旧留着
  removed++;
  return '';
});
/* 个别没有尾逗号的（字段排在最后一位）单独处理 */
txt = txt.replace(/,?\n\s*"sidequest": "sq_npcv_(\d+)"\n(\s*)\}/g, (m, num, indent) => {
  const id = 'sq_npcv_' + num;
  if (!dropSet.has(id)) return m;
  removed++;
  return '\n' + indent + '}';
});
fs.writeFileSync(NF, txt, 'utf8');

console.log(`已删 ${drop.length} 条支线定义，清掉 ${removed} 处 NPC 引用`);
console.log('保留的（每区前 3 条）：' + Array.from(keep).sort().join('、'));
