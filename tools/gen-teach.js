/* ============================================================
 * gen-teach.js — 给更多 NPC 配「可请教武学」+ 随身财物
 *
 * 规则（按身份给招式池，随机 1~2 门）：
 *   swordsman/escort/constable/hunter → 基本兵器 + 轻功
 *   smith                             → 基本拳脚 + 招架
 *   monk/nun/taoist                   → 内功 + 拳脚
 *   thief                             → 轻功 + 暗器
 *   farmer/groom/boatman/commoner     → 基本拳脚/棍
 *   scholar                           → 少量内功（读书养气）
 *
 * 请教门槛 favorToLearn：功夫越强，门槛越高。
 * 只有 swordsman / escort / smith / constable / hunter 可花钱请教。
 *
 * 幂等：已有 teach 的不动。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const NPC_FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const SKILL_FILE = path.join(ROOT, 'game', 'data', '10_skills.json');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(19990101);
const pick = arr => arr[Math.floor(rng() * arr.length)];
const int = (a, b) => a + Math.floor(rng() * (b - a + 1));
const pickN = (arr, n) => {
  const c = arr.slice(); const out = [];
  while (out.length < n && c.length) out.push(c.splice(Math.floor(rng() * c.length), 1)[0]);
  return out;
};

const doc = JSON.parse(fs.readFileSync(NPC_FILE, 'utf8'));
const skillsDoc = JSON.parse(fs.readFileSync(SKILL_FILE, 'utf8'));
const skills = skillsDoc.skills;
const npcs = doc.npcs;

/* 基本武功一览（人人可学的基础款） */
const BASIC = {
  fist: 'basic_fist',
  sword: 'basic_sword',
  blade: 'basic_blade',
  staff: 'basic_staff',
  dodge: 'basic_dodge',
  parry: 'basic_parry',
  force: 'basic_force',
  hidden: 'basic_hidden',
};
const have = k => skills[BASIC[k]] ? BASIC[k] : null;
const take = ks => ks.map(have).filter(Boolean);

const POOL = {
  swordsman: take(['sword', 'blade', 'dodge', 'parry']),
  escort: take(['blade', 'parry', 'dodge']),
  constable: take(['blade', 'fist', 'parry']),
  hunter: take(['blade', 'dodge', 'fist']),
  smith: take(['fist', 'parry', 'blade']),
  monk: take(['force', 'fist', 'parry']),
  nun: take(['force', 'dodge', 'fist']),
  taoist: take(['force', 'sword', 'dodge']),
  thief: take(['dodge', 'hidden', 'fist']),
  farmer: take(['staff', 'fist']),
  groom: take(['staff', 'dodge']),
  boatman: take(['staff', 'fist']),
  commoner: take(['fist', 'staff']),
  scholar: take(['force']),
  merchant: take(['fist']),
  richman: take(['fist']),
  innkeeper: take(['fist', 'staff']),
  waiter: take(['fist', 'dodge']),
  waiter2: take(['fist']),
  actor: take(['dodge']),
  singer: take(['dodge']),
  gambler: take(['fist', 'hidden']),
  vendor: take(['fist']),
  doctor: take(['force', 'fist']),
  official: take(['force']),
  consort: take(['dodge']),
  madam: take(['fist']),
  thief2: take(['dodge', 'hidden']),
};

const MONEY_TAGS = ['swordsman', 'escort', 'smith', 'constable', 'hunter'];

/* 随身物品池（可偷的东西，按身份给） */
const CARRY_POOL = {
  richman: ['jade_pendant', 'silver_hairpin', 'gold_bangle'],
  merchant: ['jade_pendant', 'porcelain_bowl', 'silver_hairpin'],
  madam: ['gold_bangle', 'pearl_earring', 'rouge_box'],
  consort: ['pearl_earring', 'silver_hairpin', 'rouge_box'],
  official: ['jade_talisman', 'book_classic'],
  scholar: ['book_poem', 'book_classic', 'guqin'],
  smith: ['fine_sword', 'steel_blade'],
  escort: ['steel_blade', 'fine_sword'],
  swordsman: ['fine_sword', 'iron_spear'],
  hunter: ['iron_spear', 'steel_blade'],
  thief: ['jade_pendant', 'silver_hairpin'],
  innkeeper: ['wine_bamboo', 'porcelain_bowl'],
  doctor: ['herb_ginseng', 'herb_lingzhi'],
  monk: ['incense_agarwood', 'sachet_silk'],
  taoist: ['incense_agarwood', 'jade_talisman'],
  courtesan: ['sachet_silk', 'rouge_box'],
  actor: ['jade_flute', 'pipa'],
  singer: ['jade_flute', 'pipa'],
  child: ['clay_figure', 'wood_whistle'],
  vendor: ['candied_fruit', 'mooncake'],
  farmer: ['steamed_bun'],
  commoner: ['steamed_bun', 'mooncake'],
  waiter: ['steamed_bun'],
  waiter2: ['tea_longjing'],
  gambler: ['jade_pendant'],
  boatman: ['wine_jar'],
  groom: ['wood_whistle'],
  richman2: ['painting_landscape'],
};

let touched = 0, moneyTouched = 0, carryTouched = 0;

for (const id of Object.keys(npcs)) {
  const d = npcs[id];
  if (!d.socialDone) continue;
  if (!d.tag) continue;

  /* ---- 1. 请教武学 ---- */
  if (!d.teach) {
    const pool = POOL[d.tag] || take(['fist']);
    if (pool.length) {
      /* 等级越高，会的越多（最多 2 门） */
      const maxN = (d.level || 5) >= 25 ? 2 : 1;
      const got = pickN(pool, int(1, maxN));
      if (got.length) {
        d.teach = got;
        /* 让 NPC 真的会这些功夫（供 learn 校验 / 战斗用） */
        if (!d.learned) d.learned = {};
        for (const sid of got) {
          if (!d.learned[sid]) d.learned[sid] = { level: 20 + (d.level || 5) * int(4, 9) };
        }
        /* 补齐招式槽位 */
        if (!d.skills) d.skills = {};
        const slotOf = { basic_fist: '拳', basic_sword: '剑', basic_blade: '刀', basic_staff: '棍', basic_dodge: '轻功', basic_parry: '招架', basic_force: '内功', basic_hidden: '暗器' };
        for (const sid of got) {
          const sl = slotOf[sid];
          if (sl && !d.skills[sl]) d.skills[sl] = sid;
        }
        touched++;
      }
    }
  }

  /* ---- 2. 请教门槛 ---- */
  if (d.teach && d.favorToLearn === undefined) {
    /* 功夫越好，越好感越难求 */
    const strongest = Math.max(0, ...Object.values(d.learned || {}).map(x => (x && x.level) || 0));
    d.favorToLearn = Math.round(30 + strongest / 8 + (1 - (d.favorBase || 1)) * 25);
  }

  /* ---- 3. 花钱请教（只给部分身份） ---- */
  if (d.teach && d.moneyToLearn === undefined && MONEY_TAGS.includes(d.tag)) {
    const strongest = Math.max(0, ...Object.values(d.learned || {}).map(x => (x && x.level) || 0));
    d.moneyToLearn = Math.round((100 + strongest * 6) / 10) * 10;
    moneyTouched++;
  }

  /* ---- 4. 随身财物 ---- */
  if (!d.carry || !d.carry.items || !d.carry.items.length) {
    const pool = CARRY_POOL[d.tag] || ['steamed_bun'];
    const got = pickN(pool, int(0, Math.min(2, pool.length)));
    if (got.length) {
      if (!d.carry) d.carry = { money: 0, items: [] };
      d.carry.items = got;
      if (!d.carry.money) d.carry.money = Math.round((d.money || 0) * 0.4);
      carryTouched++;
    }
  }
}

fs.writeFileSync(NPC_FILE, JSON.stringify(doc, null, 2), 'utf8');

const social = Object.keys(npcs).filter(i => npcs[i].socialDone);
console.log('新增可请教：', touched);
console.log('新增花钱请教：', moneyTouched);
console.log('新增随身财物：', carryTouched);
console.log('--- 汇总 ---');
console.log('可请教总数：', social.filter(i => npcs[i].teach).length);
console.log('花钱请教总数：', social.filter(i => npcs[i].moneyToLearn).length);
console.log('身上有物：', social.filter(i => npcs[i].carry && (npcs[i].carry.items || []).length).length);
const thresholds = social.filter(i => npcs[i].favorToLearn !== undefined).map(i => npcs[i].favorToLearn);
console.log('好感门槛 区间：', Math.min(...thresholds), '~', Math.max(...thresholds), ' 均值', Math.round(thresholds.reduce((a, b) => a + b, 0) / thresholds.length));
