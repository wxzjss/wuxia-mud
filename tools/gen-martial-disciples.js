/* ============================================================
 * gen-martial-disciples.js — 生成「门派武学矩阵」(game/data/74_martial_sects.json)
 *
 * 依据：主人钦定口径 design/44-owner-rulings.md R1（147/258/369）
 *   · 一流门派：核心**一品** / 中阶**四品** / 入门**七品**
 *   · 二流门派：核心**二品** / 中阶**五品** / 入门**八品**
 *   · 三流门派：核心**三品** / 中阶**六品** / 入门**九品**
 * 规格：每个门派在**三个品级**上各覆盖 5 类（内功/招架/轻功/攻击/旁门）= 15 门。
 * 三流门派共用一套「江湖通用武学」（jh2_*，主人原话：三流武学是大部分人都会的大众货）。
 *
 * ⚠️ 本脚本**只写 74_martial_sects.json 一个文件**，不碰任何既有数据。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '74_martial_sects.json');

/* ---------- 门派表 ---------- */
/* code = 短码（武学 id 前缀）；wp = 主兵器(type)；motif = 母题效果标签 */
const SECTS = [
  // —— 一流（1/4/7 品）——
  { id: 'huashan', name: '华山', tier: 1, wp: '剑', motif: 'ignoreDef', force: true },
  { id: 'shaolin', name: '少林', tier: 1, wp: '拳', motif: 'heal', force: true },
  { id: 'wudang', name: '武当', tier: 1, wp: '拳', motif: 'parryUp', force: true },
  { id: 'emei', name: '峨眉', tier: 1, wp: '剑', motif: 'extraHit', force: true },
  { id: 'gaibang', name: '丐帮', tier: 1, wp: '棍', motif: 'stun', force: true },
  { id: 'mojiao', name: '日月神教', tier: 1, wp: '拳', motif: 'drain', force: true },
  { id: 'dali', name: '大理段氏', tier: 1, wp: '拳', motif: 'silence', force: true },
  // —— 二流（2/5/8 品）——
  { id: 'tangmen', name: '唐门', tier: 2, wp: '暗器', motif: 'poison', force: true },
  { id: 'miaojiang', name: '苗疆五毒教', tier: 2, wp: '暗器', motif: 'poison', force: true },
  { id: 'taohua', name: '桃花岛', tier: 2, wp: '刀', motif: 'confuse', force: true },
  { id: 'gumu', name: '古墓派', tier: 2, wp: '剑', motif: 'extraHit', force: true },
  { id: 'xingxiu', name: '星宿派', tier: 2, wp: '拳', motif: 'poison', force: true },
  { id: 'xuedao', name: '血刀门', tier: 2, wp: '刀', motif: 'lifesteal', force: true },
  { id: 'taishan', name: '泰山', tier: 2, wp: '剑', motif: 'buffAtk' },
  { id: 'hengshan', name: '衡山', tier: 2, wp: '剑', motif: 'debuffSpd' },
  { id: 'hengshanN', name: '恒山', tier: 2, wp: '剑', motif: 'heal' },
  { id: 'qingcheng', name: '青城', tier: 2, wp: '剑', motif: 'dot' },
  { id: 'kongtong', name: '崆峒', tier: 2, wp: '拳', motif: 'selfHarm' },
  { id: 'kunlun', name: '昆仑', tier: 2, wp: '剑', motif: 'extraHit' },
  { id: 'diancang', name: '点苍', tier: 2, wp: '剑', motif: 'ignoreDef' },
  { id: 'tiezhang', name: '铁掌帮', tier: 2, wp: '拳', motif: 'armorPen' },
  /* 合欢宗：青楼背后的势力。功法以「迷惑 + 采补」为主 —— motif 用 charm，
     它出来的招式会带 confuse（迷幻），配合 arts.js 里的采补/双修才是全套。 */
  { id: 'hehuan', name: '合欢', tier: 2, wp: '拳', motif: 'charm' },
  // —— 三流（3/6/9 品）——
  { id: 'jindao', name: '金刀门', tier: 3, wp: '刀', motif: '' },
  { id: 'wuhu', name: '五虎断门刀', tier: 3, wp: '刀', motif: '' },
  { id: 'feihu', name: '飞虎镖局', tier: 3, wp: '刀', motif: '' },
  { id: 'zhenyuan', name: '镇远镖局', tier: 3, wp: '刀', motif: '' },
  { id: 'shenquan', name: '神拳门', tier: 3, wp: '拳', motif: '' },
  { id: 'tieqiang', name: '铁枪门', tier: 3, wp: '棍', motif: '' },
  { id: 'kuaidao', name: '快刀门', tier: 3, wp: '刀', motif: '' },
  { id: 'luohan', name: '罗汉门', tier: 3, wp: '拳', motif: '' },
  { id: 'wuyun', name: '五云手温家', tier: 3, wp: '拳', motif: '' },
  { id: 'dafeng', name: '大风云飞门', tier: 3, wp: '刀', motif: '' },
  { id: 'huanghe', name: '黄河帮', tier: 3, wp: '棍', motif: '' },
  { id: 'taihu', name: '太湖帮', tier: 3, wp: '刀', motif: '' },
  { id: 'poyang', name: '鄱阳帮', tier: 3, wp: '棍', motif: '' },
  { id: 'qingzhu', name: '青竹帮', tier: 3, wp: '刀', motif: '' },
  { id: 'jujing', name: '巨鲸帮', tier: 3, wp: '刀', motif: '' },
  { id: 'jinlong', name: '金龙帮', tier: 3, wp: '拳', motif: '' },
  { id: 'wuliang', name: '无量剑派', tier: 3, wp: '剑', motif: '' },
  { id: 'funiu', name: '伏牛派', tier: 3, wp: '拳', motif: '' },
  { id: 'baisheng', name: '百胜刀门', tier: 3, wp: '刀', motif: '' },
  { id: 'baituo', name: '白驼山', tier: 3, wp: '拳', motif: '' },
];

/* ---------- 品级 → 数值 ---------- */
const GRADE_OF = { 1: { core: 1, mid: 4, entry: 7 }, 2: { core: 2, mid: 5, entry: 8 }, 3: { core: 3, mid: 6, entry: 9 } };
const MAXLV = { 1: 900, 2: 850, 3: 800, 4: 750, 5: 700, 6: 650, 7: 600, 8: 550, 9: 500 };
const DIFF = g => Math.round((0.7 + (9 - g) * 0.14) * 100) / 100;
const TRAIN = g => 40 + (9 - g) * 60;
const DMG = g => Math.round((1.05 + (9 - g) * 0.15) * 100) / 100;
const MPB = g => 50 + (9 - g) * 70;

/* ---------- 命名 ---------- */
const FORCE_W = { entry: '养气诀', mid: '玄功', core: '神功' };
const GUARD_W = { entry: '守势', mid: '格挡术', core: '护体功' };
const FLY_W = { entry: '身法', mid: '轻身术', core: '踏云步' };
const QIMEN_W = { entry: '小术', mid: '秘技', core: '秘传' };

function atkName(sec, kind) {
  const wp = sec.wp;
  if (kind === 'entry') return `${sec.name}基础${wp === '拳' ? '拳脚' : wp + '法'}`;
  if (kind === 'mid') return `${sec.name}${wp === '拳' ? '掌' : wp}精要`;
  return `${sec.name}绝${wp === '拳' ? '掌' : wp}`;
}

/* ---------- 母题 → 效果 ---------- */
function effectsFor(motif, kind) {
  const strong = kind === 'core', mid = kind === 'mid';
  const ch = strong ? 0.42 : mid ? 0.32 : 0.22;
  switch (motif) {
    case 'ignoreDef': return [{ type: 'ignoreDef' }, ...(strong ? [{ type: 'cond', if: { chance: ch }, then: [{ type: 'extraHit', value: 1 }] }] : [])];
    case 'extraHit': return [{ type: 'cond', if: { chance: ch }, then: [{ type: 'extraHit', value: strong ? 2 : 1 }] }];
    case 'stun': return [{ type: 'cond', if: { chance: ch }, then: [{ type: 'stun', chance: 1, turns: strong ? 2 : 1 }] }];
    case 'drain': return [{ type: 'cond', if: { chance: ch }, then: [{ type: 'drain', ratio: strong ? 0.35 : 0.25 }] }];
    case 'lifesteal': return [{ type: 'buff', name: '血勇', turns: 3, mods: { atk: strong ? 50 : 30, lifesteal: 0.1 } }];
    case 'poison': return [{ type: 'dot', name: '毒', turns: strong ? 5 : 4, value: (strong ? 55 : mid ? 40 : 28) }];
    case 'dot': return [{ type: 'dot', name: '暗伤', turns: 4, value: strong ? 48 : 32 }];
    case 'confuse': return [{ type: 'confuse', chance: ch + 0.1, turns: 2 }];
    case 'silence': return [{ type: 'silence', chance: ch, turns: 2 }, { type: 'stun', chance: ch * 0.6, turns: 1 }];
    case 'heal': return [{ type: 'heal', value: strong ? 90 : 50 }];
    case 'parryUp': return [{ type: 'buff', name: '太极', turns: 3, mods: { parry: strong ? 45 : 28, dodge: strong ? 45 : 28 } }];
    case 'buffAtk': return [{ type: 'buff', name: '蓄力', turns: 3, mods: { atk: strong ? 60 : 35 } }];
    case 'debuffSpd': return [{ type: 'debuff', name: '音扰', turns: 3, mods: { speed: strong ? -35 : -22, parry: -15 } }];
    case 'selfHarm': return [{ type: 'buff', name: '七伤', turns: 3, mods: { atk: strong ? 90 : 55, def: strong ? -25 : -15 } }];
    case 'armorPen': return [{ type: 'buff', name: '摧坚', turns: 3, mods: { armorPen: strong ? 0.3 : 0.18 } }];
    case 'aoe': return [{ type: 'cond', if: { chance: ch }, then: [{ type: 'aoe' }] }];
    /* 合欢宗：招式里带「惑」—— 打中不一定伤人，但会乱了对方心神 */
    case 'charm': return [
      { type: 'confuse', chance: ch + 0.12, turns: 2 },
      ...(strong ? [{ type: 'debuff', name: '失魂', turns: 3, mods: { atk: -30, parry: -25 } }] : []),
    ];
    default: return [];
  }
}

/* ---------- 生成 ---------- */
const skills = {};
const books = {};

function uid(code, domain, kind) {
  const t = kind === 'entry' ? 1 : kind === 'mid' ? 2 : 3;
  return `${code}_${domain}_${t}`;
}
const KIND_T = { entry: 1, mid: 2, core: 3 };

for (const sec of SECTS) {
  const G = GRADE_OF[sec.tier];
  const code = sec.id;
  for (const kind of ['entry', 'mid', 'core']) {
    const g = G[kind];
    // 内功
    {
      const id = uid(code, 'force', kind);
      skills[id] = {
        id, name: `${sec.name}${FORCE_W[kind]}`, type: '内功', category: sec.tier === 1 ? '内功' : '旁门',
        grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
        damageMult: 0, accuracy: 0, mpCost: 0, mpBonus: MPB(g),
        bonus: { maxMp: Math.round(MPB(g) * 0.6), maxHp: Math.round(MPB(g) * 0.4) },
        effects: [],
        base: kind === 'entry' ? 'basic_force' : uid(code, 'force', kind === 'mid' ? 'entry' : 'mid'),
        desc: `${sec.name}一脉的吐纳法门，${kind === 'core' ? '是本派压箱底的内功' : kind === 'mid' ? '练到这一层，真气才算有了根' : '入门弟子的第一门功课'}。`,
      };
    }
    // 招架
    {
      const id = uid(code, 'guard', kind);
      skills[id] = {
        id, name: `${sec.name}${GUARD_W[kind]}`, type: '招架', category: '外功',
        grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
        damageMult: 0, accuracy: 0, mpCost: 0,
        bonus: { parry: 40 + (9 - g) * 22 },
        effects: [],
        base: kind === 'entry' ? 'basic_parry' : uid(code, 'guard', kind === 'mid' ? 'entry' : 'mid'),
        desc: `${sec.name}的护身手法。${kind === 'core' ? '门中长者说，先学挨打，才谈得上打人。' : '架势摆得正，才谈得上卸力。'}`,
      };
    }
    // 轻功
    {
      const id = uid(code, 'fly', kind);
      skills[id] = {
        id, name: `${sec.name}${FLY_W[kind]}`, type: '轻功', category: '外功',
        grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
        damageMult: 0, accuracy: 0, mpCost: 0,
        bonus: { dodge: 45 + (9 - g) * 24, speed: Math.round((9 - g) * 8) },
        effects: [],
        base: kind === 'entry' ? 'basic_dodge' : uid(code, 'fly', kind === 'mid' ? 'entry' : 'mid'),
        desc: `${sec.name}的提纵法门，${kind === 'core' ? '脚下一动，人已在丈外' : '走山路、翻墙头都用得上'}。`,
      };
    }
    // 攻击（主兵器）
    {
      const id = uid(code, 'atk', kind);
      skills[id] = {
        id, name: atkName(sec, kind), type: sec.wp, category: sec.tier === 1 ? '外功' : '旁门',
        grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
        damageMult: DMG(g), accuracy: 88 + (9 - g), mpCost: 4 + (9 - g) * 4,
        effects: effectsFor(sec.motif, kind),
        base: kind === 'entry'
          ? ({ 剑: 'basic_sword', 刀: 'basic_blade', 拳: 'basic_fist', 棍: 'basic_staff', 鞭: 'basic_whip', 暗器: 'basic_throw' }[sec.wp] || 'basic_fist')
          : uid(code, 'atk', kind === 'mid' ? 'entry' : 'mid'),
        desc: `${sec.name}的${sec.wp === '拳' ? '拳脚' : sec.wp + '上功夫'}。${kind === 'core' ? '本派成名的一手，多有人栽在这上头。' : kind === 'mid' ? '比入门那几式狠，也比它难练。' : '招式不多，练熟却要功夫。'}`,
      };
    }
    // 旁门
    {
      const id = uid(code, 'qimen', kind);
      skills[id] = {
        id, name: `${sec.name}${QIMEN_W[kind]}`, type: sec.wp === '暗器' ? '暗器' : sec.wp, category: '旁门',
        grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
        damageMult: Math.round(DMG(g) * 0.85 * 100) / 100, accuracy: 86 + (9 - g), mpCost: 6 + (9 - g) * 4,
        base: kind === 'entry'
          ? ({ 剑: 'basic_sword', 刀: 'basic_blade', 拳: 'basic_fist', 棍: 'basic_staff', 鞭: 'basic_whip', 暗器: 'basic_throw' }[sec.wp] || 'basic_fist')
          : uid(code, 'qimen', kind === 'mid' ? 'entry' : 'mid'),
        effects: effectsFor(sec.motif, kind),
        moves: kind === 'core' ? [{ id: `${id}_m1`, name: `${sec.name}${kind === 'core' ? '杀手' : '绝技'}`, trigger: 'active', mpCost: 18, cooldown: 3, damageMult: 1.25 }] : undefined,
        desc: `${sec.name}不轻易示人的一手。${kind === 'core' ? '非嫡传弟子不传。' : '门里也只教个大概，剩下的靠自己悟。'}`,
      };
    }
  }
  // 每派一本门派武学书（最高品那门攻击武学），供藏经阁/拍卖/奇遇用
  const topId = uid(code, 'atk', 'core');
  books[`book_${code}_atk`] = {
    id: `book_${code}_atk`, name: `《${skills[topId].name}》`, type: 'book',
    desc: `记着${sec.name}这一手的抄本，纸页边上还有前人的批注。`,
    teach: topId, cost: 600, timeCost: 300, value: 4200,
    require: { skill: 'basic_force', '>=': 80 },
  };
}

/* ============================================================
 * 三流门派共用的「江湖通用武学」（主人原话：三流武学是大部分人都会的大众货）
 * 三品 / 六品 / 九品 × 五类 = 15 门，全部以 basic_* 为根，无门派限制
 * ============================================================ */
const JH_GROUPS = [
  { key: 'force', name: { entry: '江湖吐纳功', mid: '江湖混元功', core: '江湖浑天气功' }, type: '内功', cat: '内功' },
  { key: 'guard', name: { entry: '江湖卸力法', mid: '江湖铁布衫', core: '江湖金钟罩' }, type: '招架', cat: '外功' },
  { key: 'fly', name: { entry: '江湖轻身术', mid: '江湖草上飞', core: '江湖燕子三抄水' }, type: '轻功', cat: '外功' },
  { key: 'atk', name: { entry: '江湖快刀十二式', mid: '江湖乱披风刀法', core: '江湖绝命三刀' }, type: '刀', cat: '外功' },
  { key: 'qimen', name: { entry: '江湖袖箭手', mid: '江湖泼风暗器', core: '江湖暴雨梨花针' }, type: '暗器', cat: '旁门' },
];
const JH_G = { entry: 9, mid: 6, core: 3 };
const JH_MOTIF = { force: null, guard: null, fly: null, atk: 'extraHit', qimen: 'poison' };
for (const grp of JH_GROUPS) {
  for (const kind of ['entry', 'mid', 'core']) {
    const g = JH_G[kind];
    const id = `jh2_${grp.key}_${KIND_T[kind]}`;
    const isHp = grp.type === '内功';
    const isWp = grp.type === '刀' || grp.type === '暗器';
    skills[id] = {
      id, name: grp.name[kind], type: grp.type, category: grp.cat,
      grade: g, maxLevel: MAXLV[g], difficulty: DIFF(g), trainCost: TRAIN(g),
      damageMult: isWp ? DMG(g) : 0, accuracy: isWp ? 86 + (9 - g) : 0,
      mpCost: isWp ? 4 + (9 - g) * 4 : 0,
      ...(isHp ? { mpBonus: MPB(g), bonus: { maxMp: Math.round(MPB(g) * 0.6), maxHp: Math.round(MPB(g) * 0.4) } } : {}),
      ...(grp.type === '招架' ? { bonus: { parry: 40 + (9 - g) * 22 } } : {}),
      ...(grp.type === '轻功' ? { bonus: { dodge: 45 + (9 - g) * 24, speed: Math.round((9 - g) * 8) } } : {}),
      effects: isWp ? effectsFor(JH_MOTIF[grp.key], kind) : [],
      base: kind === 'entry'
        ? ({ 内功: 'basic_force', 招架: 'basic_parry', 轻功: 'basic_dodge', 刀: 'basic_blade', 暗器: 'basic_throw' }[grp.type])
        : `jh2_${grp.key}_${KIND_T[kind] - 1}`,
      desc: `走镖的、撑船的、看家护院的都会几手。${kind === 'core' ? '练到这一层的人，江湖上已经不多。' : kind === 'mid' ? '比街边把式强，比名门正差得远。' : '街上教拳的师傅，多半就从这几式讲起。'}`,
    };
  }
}

fs.writeFileSync(OUT, JSON.stringify({ skills, books }, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('门派武学', Object.keys(skills).filter(k => !k.startsWith('jh2_')).length, '门，江湖通用', Object.keys(skills).filter(k => k.startsWith('jh2_')).length, '门，书', Object.keys(books).length, '本');
