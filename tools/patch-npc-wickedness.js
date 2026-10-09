/**
 * patch-npc-wickedness.js — 给恶人 NPC 补 wickedness / greed 字段（掳人系统第 1 批）
 *
 * 背景：kidnap.js 的 tickDesperate 用 npc.def.wickedness / npc.def.greed 判定
 *  「亡命之徒会不会主动掳人」。这两个字段之前不存在，导致所有 NPC 恶性都是 0，
 *  tickDesperate 永远返回 false —— 需求里的「山贼主动打晕路人装麻袋」完全没生效。
 *
 * 覆盖：
 *  - 明确点名的 mob_*（山贼 / 刺客 / 魔教教众）
 *  - 按 tag 批量铺（thief / gambler / madam / eunuch），同 tag 内按 id 哈希错开数值，
 *    免得 8 个小偷数值一模一样
 *
 * 幂等：已有字段则跳过（除非 --force）。改完做行级 diff 校验，只应新增行。
 * 用法：node tools/patch-npc-wickedness.js [--force]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'game', 'data', '40_npcs.json');
const FORCE = process.argv.includes('--force');

/** 明确点名：id → { wickedness, greed, tag补 personality可选 } */
const NAMED = {
  mob_bandit:        { wickedness: 82, greed: 70 },
  mob_bandit_chief:  { wickedness: 90, greed: 86 },
  mob_assassin:      { wickedness: 88, greed: 58 },
  mob_mo_disciple:   { wickedness: 76, greed: 55 },
};

/** 按 tag 铺底：tag → { w 中心, g 中心, 抖动 } */
const BY_TAG = {
  thief:   { w: 52, g: 66, jitter: 12 },
  gambler: { w: 38, g: 76, jitter: 14 },
  madam:   { w: 58, g: 84, jitter: 8 },   // 老鸨：本行当家的，知情买卖
  eunuch:  { w: 62, g: 60, jitter: 10 },
  refugee: { w: 14, g: 30, jitter: 8 },   // 亡命之徒：走投无路才会
};

/** 确定性错开：同一 tag 下不同 NPC 数值不同，但可复现 */
function jitterOf(id, span) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const r = (h % (span * 2 + 1)) - span;
  return r;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function main() {
  const before = fs.readFileSync(FILE, 'utf8');
  const data = JSON.parse(before);
  const npcs = data.npcs;

  const added = [];
  const skipped = [];

  for (const id of Object.keys(npcs)) {
    const def = npcs[id];
    let target = NAMED[id];
    if (!target && def.tag && BY_TAG[def.tag]) {
      const base = BY_TAG[def.tag];
      target = {
        wickedness: clamp(base.w + jitterOf(id, base.jitter), 0, 100),
        greed:     clamp(base.g + jitterOf(id + 'g', base.jitter), 0, 100),
      };
    }
    if (!target) continue;

    const has = def.wickedness !== undefined && def.greed !== undefined;
    if (has && !FORCE) { skipped.push(id); continue; }

    // 插在 tag 之后（若无 tag 则插在 hp 之后），保持可读顺序
    const rebuilt = {};
    for (const k of Object.keys(def)) {
      rebuilt[k] = def[k];
      if (k === 'tag' || (k === 'hp' && def.tag === undefined)) {
        rebuilt.wickedness = target.wickedness;
        rebuilt.greed = target.greed;
      }
    }
    if (rebuilt.wickedness === undefined) {
      rebuilt.wickedness = target.wickedness;
      rebuilt.greed = target.greed;
    }
    npcs[id] = rebuilt;
    added.push(`${id}(w${target.wickedness}/g${target.greed})`);
  }

  if (!added.length) {
    console.log(`无变化：已有 ${skipped.length} 个 NPC 带字段（要覆盖加 --force）`);
    return;
  }

  const out = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(FILE, out, 'utf8');

  /* 行级 diff 校验：只允许新增（+），出现 - 说明动了原有内容，要报警
   * ⚠️ 必须先归一化行尾：原文件可能是 CRLF，新写是 LF。不剥 \r 会每行都不匹配，
   *    误报成「整份文件全变」。顺手忽略末尾换行差异（多一个空行也算新增）。 */
  const norm = (s) => s.replace(/\r\n/g, '\n').split('\n');
  const a = norm(before), b = norm(out);
  let removed = 0, addedLines = 0;
  const setA = new Map();
  for (const line of a) setA.set(line, (setA.get(line) || 0) + 1);
  for (const line of b) {
    const c = setA.get(line) || 0;
    if (c > 0) setA.set(line, c - 1);
    else if (line !== '') addedLines++;   // 末尾换行产生的空行不算异常
  }
  for (const c of setA.values()) if (c > 0) removed += c;

  console.log(`已补 ${added.length} 个 NPC：`);
  for (const s of added) console.log('  + ' + s);
  if (skipped.length) console.log(`跳过（已有字段）${skipped.length} 个`);
  console.log(`行数 ${a.length} -> ${b.length}；新增 ${addedLines} 行，丢失 ${removed} 行`);
  if (removed > 0) {
    console.error('!! 有原有行消失，请检查改动范围（可用 git diff 复核）');
    process.exit(1);
  }
}

main();