/**
 * gen-npc-neili.js — 给「没写内力」的 NPC 补上内力上限
 *
 * 为什么非补不可（2026-10-10 数值体检）：
 *   主人定的规矩是「内力上限 = NPC 的实力上限，内力越高功法火候越深」，
 *   代码（neigong.npcLevelFromMp）早就接好了，但全库 463 个 NPC 里**只有 130 个写了 mp**，
 *   剩下 333 人一律取默认值 50 → 火候只能算出 0~1 级。
 *   结果就是「A 层唐寅(story 名人) 和 路边山贼 的火候一模一样」——
 *   系统看着做了，实则对七成以上的 NPC 静默失效（铁律「不报错就是不生效」族）。
 *
 * 补法：内力与「这个人有多能打」相称。手上没有更权威的战力指标，
 *   就用作者已经写在模板里的 hp（气血）当尺子 —— 血厚的人本来就该内力深。
 *   mp = round(hp × k)，k 按 tier 分层。
 *
 * ⚠️ 只补 `typeof mp !== 'number'` 的人，**绝不覆盖作者手填的内力**。
 * ⚠️ 与 40_npcs.json 同名顶层键 `npcs`（在 collections 名单里 → byId 对象），
 *   所以 deepMerge 会按键合并进已有 NPC，只加一个 mp 字段，不动别的。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 各层系数：内力上限 ≈ 气血 × k。刻度是照着「火候 = 内力/40」倒推的——
   A 层大佬（气血 6000）→ 内力 ~9600 → 火候 240；三流杂鱼（气血 300）→ 内力 150 → 火候 3。*/
const K = { A: 1.6, B: 1.1, C: 0.5, mob: 0.08 };
const K_DEFAULT = 0.8;
const MP_CAP = 20000;          // 硬顶：防某条异常气血把内力顶到天上
const MP_FLOOR = 30;           // 地板：别给纯文职 NPC 造出「内力 5」这种残值

const dataDir = path.join(ROOT, 'game/data');
const files = fs.readdirSync(dataDir).filter(f => /^\d\d_.*\.json$/.test(f)).sort();
const FILES = files.filter(f => f !== '86_npc_neili.json');

// 先按加载顺序叠一遍，拿到每个 NPC 最终看到的 tier / hp / mp（含后面文件的覆盖）
// ⚠️ `npcs` 是 byId 容器，**id 在 key 上**——不少文件（如 79_culture_npcs）对象内部并不写 id，
//    只认 `n.id` 会把这几个文件整批漏掉（唐寅那九位就是这么漏网的）。
const merged = {};
for (const f of FILES) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  if (!j.npcs) continue;
  const pairs = Array.isArray(j.npcs)
    ? j.npcs.map(n => [(n && n.id) || null, n])
    : Object.entries(j.npcs);
  for (const [key, n] of pairs) {
    const id = (n && n.id) || key;
    if (!id || !n) continue;
    merged[id] = Object.assign(merged[id] || {}, n, { id });
  }
}

const out = {};
let filled = 0, keptManual = 0, skipped = 0;
const byTier = {};
for (const id of Object.keys(merged)) {
  const n = merged[id];
  if (typeof n.mp === 'number') { keptManual++; continue; }
  /* 没写气血的（如 79 里那几位才子）走 Character 的默认值 100，
     否则这批人会整批「无气血跳过」——他们照样是有内力深浅的。 */
  const hp = typeof n.hp === 'number' ? n.hp : 100;
  const k = K[n.tier] !== undefined ? K[n.tier] : K_DEFAULT;
  let mp = Math.round(hp * k);
  mp = Math.max(MP_FLOOR, Math.min(MP_CAP, mp));
  out[id] = { mp };
  filled++;
  byTier[n.tier || '（无 tier）'] = (byTier[n.tier || '（无 tier）'] || 0) + 1;
}

const payload = { npcs: {} };
for (const id of Object.keys(out).sort()) payload.npcs[id] = out[id];

const dest = path.join(dataDir, '86_npc_neili.json');
fs.writeFileSync(dest, JSON.stringify(payload, null, 2) + '\n');

console.log(`gen-npc-neili: 扫描 ${Object.keys(merged).length} 个 NPC`);
console.log(`  补内力 ${filled} 人 · 保留作者手填 ${keptManual} 人 · 无气血跳过 ${skipped} 人`);
console.log('  按层分布:', JSON.stringify(byTier));
console.log(`  写出 ${path.relative(ROOT, dest)}`);

// 自检：读回并抽查换算出的火候
const neigong = require(path.join(ROOT, 'game/src/core/neigong.js'));
const probes = ['sx_shanzei', 'jn_xier'];
const sample = Object.keys(payload.npcs).slice(0, 3);
for (const id of [...probes, ...sample]) {
  const n = merged[id];
  if (!n || !out[id]) continue;
  console.log(`  · ${n.name || id}(${n.tier}) 气血${n.hp} → 内力 ${out[id].mp} → 火候 ${neigong.npcLevelFromMp({ maxMpBase: out[id].mp })}`);
}
