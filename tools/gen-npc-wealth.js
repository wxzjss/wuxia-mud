/**
 * gen-npc-wealth.js — NPC 的家底（主人 2026-10-08）
 *
 * 「一些背景是富贵人家的 NPC 包里真的会有很多钱，穷人包里真的会没多少钱，
 *   江湖人士侠客盗贼门派弟子包里真的会有各种物品道具甚至功法」
 *
 * 现状：463 个 NPC 里有 322 个写了 `carry`，可翻开一看 **`money` 全是 0** ——
 * 字段是有的，数从来没填过（「只定义不消费」的又一个变体：定义了，没数）。
 * 于是岳不群和路边乞丐的钱袋一模一样。
 *
 * 按「营生 × 分部」给一档家底，再按 id 哈希在档内浮动，保证同一个人每次跑结果一致。
 * ⚠️ 只补 `carry.money` 为 0 / 缺失的，作者手填过的一律不动。
 * ⚠️ 门派弟子按身份补一件「随身的东西」（兵器/丹药/散碎银子），
 *    盗贼身上有赃物，郎中背药箱 —— 这些是「看得出他是个什么人」的物证。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 营生 → [下限, 上限]（文）。富的按身份定，穷的也按身份定。 */
const BY_TAG = {
  richman: [3000, 12000], merchant: [800, 4000], official: [2000, 8000],
  eunuch: [5000, 20000], palace: [1000, 6000], consort: [3000, 15000],
  madam: [1500, 6000], gambler: [20, 800], thief: [10, 1200],
  smith: [200, 1200], innkeeper: [400, 2000], vendor: [150, 900],
  constable: [180, 700], escort: [200, 1000], swordsman: [60, 700],
  actor: [60, 500], singer: [80, 800], courtesan: [150, 1500],
  doctor: [120, 800], hunter: [40, 300], farmer: [5, 60],
  beggar: [0, 12], boatman: [15, 120], groom: [10, 90], waiter: [10, 80],
  waiter2: [10, 80], scholar: [30, 400], monk: [5, 80], nun: [5, 80],
  taoist: [10, 150], child: [0, 20], refugee: [0, 8], commoner: [20, 200],
};
/* 分部系数：A 层名角、B 层有名字的、C 层寻常人 */
const TIER_K = { A: 3.0, B: 1.4, C: 0.6, mob: 0.25 };

/* 营生 → 随身会带的那件「物证」（从现有物品里挑，挑不到就不给） */
const CARRY_HINT = {
  swordsman: ['jinchuang_yao'], thief: ['silver'], smith: ['iron_blade'],
  doctor: ['jinchuang_yao'], hunter: ['dried_meat'], constable: ['iron_blade'],
  escort: ['jinchuang_yao'], scholar: ['book_basic'], monk: ['jinchuang_yao'],
  taoist: ['jinchuang_yao'], merchant: ['silver'], gambler: ['silver'],
  actor: ['wine_jar'], singer: ['wine_jar'], beggar: [], farmer: [], refugee: [],
};

function hashN(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}

const dataDir = path.join(ROOT, 'game/data');
const FILES = fs.readdirSync(dataDir).filter(f => /^\d\d_.*\.json$/.test(f) && f !== '91_npclife.json').sort();
const merged = {};
for (const f of FILES) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  if (!j.npcs) continue;
  const pairs = Array.isArray(j.npcs) ? j.npcs.map(n => [(n && n.id) || null, n]) : Object.entries(j.npcs);
  for (const [k, n] of pairs) {
    const id = (n && n.id) || k;
    if (!id || !n) continue;
    merged[id] = Object.assign(merged[id] || {}, n, { id });
  }
}

/* 现有物品 id（挑「物证」时要用） */
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const probe = new GameEngine({ seed: 1 });
probe.boot();
const hasItem = id => !!probe.world.getItem(id);

const out = {};
let filled = 0, kept = 0, gaveItems = 0;
for (const id of Object.keys(merged)) {
  const n = merged[id];
  const carry = n.carry || {};
  const oldMoney = typeof carry.money === 'number' ? carry.money : null;
  const patch = {};

  /* 钱：作者写过正数的就不动 */
  if (!oldMoney) {
    const rng = BY_TAG[n.tag] || BY_TAG.commoner;
    const k = TIER_K[n.tier] === undefined ? 1 : TIER_K[n.tier];
    const lo = Math.floor(rng[0] * k), hi = Math.max(lo + 1, Math.floor(rng[1] * k));
    const roll = hashN(id + 'w') % (hi - lo + 1);
    patch.carry = Object.assign({}, carry, { money: lo + roll });
    filled++;
  } else kept++;

  /* 随身的东西：只给「有营生、且身上确实一件没有」的人补一件 */
  const items = [].concat(carry.items || []);
  if (!items.length) {
    const hint = (CARRY_HINT[n.tag] || []).filter(hasItem);
    if (hint.length) {
      patch.carry = Object.assign({}, (patch.carry || carry), { items: [hint[hashN(id + 'i') % hint.length]] });
      gaveItems++;
    }
  }
  if (Object.keys(patch).length) out[id] = patch;
}

const payload = { npcs: out };
const dest = path.join(dataDir, '91_npclife.json');
fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + '\n');

console.log(`gen-npc-wealth: 扫描 ${Object.keys(merged).length} 个 NPC`);
console.log(`  补钱袋 ${filled} 人 · 保留作者手填 ${kept} 人 · 补随身物证 ${gaveItems} 人`);
console.log(`  写出 ${path.relative(ROOT, dest)}`);

/* 自检：抽查几个人的家底 */
for (const nm of ['岳不群', '洪七公', '小叫花', '张掌柜']) {
  const n = Object.values(merged).find(x => x.name === nm);
  if (!n) continue;
  const c = (out[n.id] && out[n.id].carry) || n.carry || {};
  console.log(`  · ${nm}（${n.tag || '无营生'}·${n.tier || '?'}）→ ${c.money || 0} 文 ${itemsOf(c)}`);
}
function itemsOf(c) { const a = [].concat(c.items || []); return a.length ? '，带 ' + a.join('/') : ''; }
