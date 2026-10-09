/* ============================================================
 * patch-traits-items.js — SPRINT2：补充 NPC/玩家深度特性 + 天材地果
 *   · 新增「习武奇才」特性（trainMult，练武进度飞快）
 *   · 强化「身法灵活」（原身轻如燕 → 身法+6，闪避/速度大增）
 *   · 新增天材地果类物品（服用永久提升资质/悟性/根骨，供修炼体系使用）
 * 幂等：已存在则不覆盖。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

const corePath = path.join(root, 'game/data/00_core.json');
const itemPath = path.join(root, 'game/data/20_items.json');
const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
const it = JSON.parse(fs.readFileSync(itemPath, 'utf8'));
let changed = 0;

core.traits = core.traits || {};
if (!core.traits.martial_prodigy) {
  core.traits.martial_prodigy = { name: '习武奇才', trainMult: 1.6, desc: '习武奇才，修炼任何武技进度飞快，所得经验远胜常人。' };
  changed++;
}
if (core.traits.swift) {
  core.traits.swift.name = '身法灵活';
  core.traits.swift.attr = Object.assign(core.traits.swift.attr || {}, { 身法: 6 });
  core.traits.swift.desc = '身法灵活自如，身法属性大增，闪避与出手速度远超常人。';
  changed++;
}
if (!core.traits.iron_bone) {
  core.traits.iron_bone = { name: '筋骨强健', attr: { 根骨: 5 }, desc: '天生筋骨强健，根骨远胜常人，气血与防御更厚。' };
  changed++;
}
if (!core.traits.powerful) {
  core.traits.powerful = { name: '力大无穷', attr: { 力量: 5 }, desc: '天生神力，力量惊人，出手沉重，攻敌更狠。' };
  changed++;
}

const items = it.items || {};
const newItems = {
  tiancai_rencan: { id: 'tiancai_rencan', name: '天材人參', type: 'treasure', category: '天材地果', desc: '天地灵气孕育的奇参，服之可大增资质与根骨。', value: 3000, stackable: true, stackMax: 9, use: [{ type: '+attr', args: ['资质', 4] }, { type: '+attr', args: ['根骨', 2] }] },
  wuji_guo: { id: 'wuji_guo', name: '悟极果', type: 'treasure', category: '天材地果', desc: '传说中的悟道仙果，服之可增悟性。', value: 3000, stackable: true, stackMax: 9, use: [{ type: '+attr', args: ['悟性', 4] }] },
  xuecan_hua: { id: 'xuecan_hua', name: '血参花', type: 'treasure', category: '天材地果', desc: '生于绝地的血参之花，服之气血与根骨皆增。', value: 1500, stackable: true, stackMax: 9, use: [{ type: '+attr', args: ['根骨', 3] }, { type: '+attr', args: ['力量', 2] }] },
};
for (const k of Object.keys(newItems)) {
  if (!items[k]) { items[k] = newItems[k]; changed++; }
}

fs.writeFileSync(corePath, JSON.stringify(core, null, 2) + '\n');
fs.writeFileSync(itemPath, JSON.stringify(it, null, 2) + '\n');
console.log('patch traits/items 改动', changed, '条');
