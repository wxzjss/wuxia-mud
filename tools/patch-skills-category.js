/**
 * patch-skills-category.js — 给 10_skills.json 的每个武学补 category 字段
 * （外功 / 内功 / 奇门 / 歪门 / 魔功），并给乐器类武器补 weaponType:'音波'。
 * 幂等：已带 category 的不覆盖（除非被关键字重新归类），可反复跑。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const skillsPath = path.join(root, 'game/data/10_skills.json');
const itemsPath = path.join(root, 'game/data/20_items.json');

const WEAPON_SKILL_TYPES = ['剑', '刀', '棍', '鞭', '暗器'];

function inferCategory(s) {
  const text = (s.name || '') + ' ' + (s.desc || '');
  // 关键字优先（魔功/歪门），可覆盖 type 默认分类
  if (/魔功|血刀|噬魂|幽冥|阴风|邪功|葵花|吸星|化功|辟邪|血影|魔教|白骨|噬/.test(text)) return '魔功';
  if (/毒|蛊|采补|媚|春|销魂|星宿/.test(text)) return '歪门';
  const t = s.type;
  if (t === '内功') return '内功';
  if (t === '音波') return '奇门';
  if (t === '暗器') return '奇门';
  if (WEAPON_SKILL_TYPES.includes(t) || t === '拳' || t === '轻功' || t === '招架' || t === '身法') return '外功';
  return '外功';
}

function main() {
  const sd = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
  const skills = sd.skills || {};
  let changed = 0;
  for (const id of Object.keys(skills)) {
    const s = skills[id];
    const cat = inferCategory(s);
    if (s.category !== cat) { s.category = cat; changed++; }
  }
  fs.writeFileSync(skillsPath, JSON.stringify(sd, null, 2) + '\n');

  // 乐器类武器：补 weaponType 与 category
  const it = JSON.parse(fs.readFileSync(itemsPath, 'utf8'));
  const items = it.items || {};
  let itChanged = 0;
  for (const id of Object.keys(items)) {
    const x = items[id];
    if (/琴|箫|笛|瑟|琵琶|乐器/.test(x.name || '') && x.type === 'weapon') {
      if (x.weaponType !== '音波') { x.weaponType = '音波'; itChanged++; }
      if (x.category !== '乐器') { x.category = '乐器'; itChanged++; }
    }
  }
  if (itChanged) fs.writeFileSync(itemsPath, JSON.stringify(it, null, 2) + '\n');

  // 统计
  const stat = {};
  for (const id of Object.keys(skills)) { const c = skills[id].category; stat[c] = (stat[c] || 0) + 1; }
  console.log('skills category 分布:', JSON.stringify(stat));
  console.log(`skills 改动 ${changed} 条，items 改动 ${itChanged} 条`);
}
main();
