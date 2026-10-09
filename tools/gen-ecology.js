/**
 * gen-ecology.js — 第 5 批：按身份给 NPC 配装备 + 提升官府/镖师武力
 *
 * 幂等：已有 equipment 的跳过；已改过的 learned 不再重复。
 * 身份 → 装备池（武器/身体/头部），让「侠客持剑、捕快佩刀、猎户带猎刀、盗贼揣短刃」。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const NPC = path.join(__dirname, '..', 'game', 'data', '40_npcs.json');
const data = JSON.parse(fs.readFileSync(NPC, 'utf8'));
const list = data.npcs || data;

/** 身份 → 装备池（槽位 → 候选物品） */
const TAG_EQUIP = {
  swordsman: { 武器: ['fine_sword', 'iron_sword_basic', 'xuantie_sword'], 身体: ['silk_robe', 'leather_armor'] },
  constable: { 武器: ['steel_blade', 'iron_spear'], 身体: ['chain_armor', 'leather_armor'], 头部: ['iron_helmet'] },
  official: { 武器: ['fine_sword'], 身体: ['silk_robe'] },
  escort: { 武器: ['iron_blade', 'steel_blade'], 身体: ['leather_armor', 'chain_armor'] },
  hunter: { 武器: ['hunting_knife', 'iron_blade'], 身体: ['leather_armor'] },
  thief: { 武器: ['butcher_knife'], 身体: ['tattered_cloak', 'cloth_robe'] },
  monk: { 武器: ['wood_staff'], 身体: ['cloth_robe'] },
  taoist: { 武器: ['iron_sword_basic'], 身体: ['cloth_robe'] },
  nun: { 武器: ['wood_staff'], 身体: ['cloth_robe'] },
};

/** 官府/镖师 等身份补「符合身份」的武学（不再只有 basic 基础武学） */
const TAG_EXTRA_SKILL = {
  constable: { slot: '刀', skill: 'kuangfeng_daofa', level: 60 },   // 捕快：狂风快刀（军伍刀法）
  official: { slot: '剑', skill: 'huashan_sword', level: 80 },       // 武官：华山剑法（官身高手）
  escort: { slot: '刀', skill: 'hujia_daofa', level: 70 },           // 镖师：胡家刀法
  thief: { slot: '轻功', skill: 'shaolin_bu', level: 50 },           // 盗贼：飞檐走壁轻功
  hunter: { slot: '刀', skill: 'kuangfeng_daofa', level: 45 },       // 猎人：狂风快刀
};

function rnd(n) { return Math.floor(Math.random() * n); }

let equipAdded = 0, skillAdded = 0;
for (const id of Object.keys(list)) {
  const n = list[id];
  const tag = n.tag;
  const pool = TAG_EQUIP[tag];

  // 1) 配装备
  if (pool) {
    if (!n.equipment) n.equipment = {};
    for (const slot of Object.keys(pool)) {
      if (n.equipment[slot]) continue; // 已有装备不覆盖
      const cands = pool[slot];
      n.equipment[slot] = cands[rnd(cands.length)];
    }
    equipAdded++;
  }

  // 2) 补符合身份的武学（只在还没有高级武学时补，避免覆盖已有绝学）
  const extra = TAG_EXTRA_SKILL[tag];
  if (extra && n.skills && !n.skills[extra.slot]) {
    n.skills[extra.slot] = extra.skill;
    if (!n.learned) n.learned = {};
    n.learned[extra.skill] = { level: extra.level, exp: 0 };
    skillAdded++;
  }
}

fs.writeFileSync(NPC, JSON.stringify(data, null, 2));
console.log(`配装备 NPC: ${equipAdded} 个，补身份武学 NPC: ${skillAdded} 个。`);
