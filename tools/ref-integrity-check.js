#!/usr/bin/env node
/**
 * ref-integrity-check.js —— 「引用了不存在的 id」守卫（加载层另一半）
 *
 * 为什么要有（2026-10-21）：`shard-merge-check.js` 守的是「合并丢了」，
 * 守不住「合并进来了，但引用的 id 根本不存在」。实例：
 *   enc_0 的 randomitem 指向 `book_cn_long_fist` —— 该书任何分片都没定义，
 *   修好 encounters 合并后，玩家屏幕上直接出现 `你得到了 book_cn_long_fist。`
 *   三种坏形态：① 静默发不出来 ② 原样打 id（本次） ③ 发个空白物。加载期一次拦住。
 *
 * 覆盖的引用点：
 *   · encounters[].effects[] 里 type==='randomitem' 的 args
 *   · 任务 effects/rewards 字符串里的 `+item:<id>` / `+skill:<id>`
 *   · 书的 teach 指向（技能）
 *   · 商店 goods[].item
 *   · 房间 respawn[].item
 *   · NPC carry[] / teach[]
 *
 * 报错文案带**分片出处**（设计总监要求：只说不行不行是不够的）。
 * 自测：⓪ 段 3 条已知答案（存在→绿 / 不存在→红 / 空引用→跳过）。
 * 用法：node tools/ref-integrity-check.js [--verbose]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

/**
 * 已知悬空白名单（**双向校验**，design-director 2026-10-21 提议，QA 加强）
 *   · 新出现的悬空（不在名单里）→ 红
 *   · 名单里的项已经修好（不再悬空）→ **也红**，要求删条目
 * 这样"只能缩不能加"不是靠人自觉，而是被脚本强制：
 *   想加条目 → 首次跑就红；修好了忘删 → 也红。白名单无法腐烂成垃圾桶。
 * 每条必须写：where / id / reason / owner，缺一不可（评审时能追到人）。
 */
const KNOWN_DANGLING = [
  { where: 'encounters/enc_0', id: 'book_cn_long_fist', reason: '待《长拳谱》落库', owner: '数据线' },
];

/**
 * reason 栏禁语（design-director 2026-10-21）：
 *   `reason` 必须是**一个可验证的动作**（如「待《长拳谱》落库」），
 *   不能是「暂不修 / 已知问题 / 后续处理 / 待定 / TODO」这类可以挂三年的空话。
 *   ⇒ 用禁语表在脚本里强制，而不是靠评审时的心情。
 */
const VAGUE_REASON = /暂不修|先不修|已知问题|后续处理|待定|以后再说|以后|TODO|FIXME|待观察/;

/** 判定：ref 为空 → skip；存在 → ok；不存在 → fail */
function verdict(ref, exists) {
  if (!ref) return 'skip';
  return exists ? 'ok' : 'fail';
}

function selftest() {
  let pass = 0, fail = 0;
  const t = (n, c) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n); } };
  t('引用了存在的 id → ok', verdict('steamed_bun', true) === 'ok');
  t('引用了不存在的 id → fail（book_cn_long_fist 那种）', verdict('book_cn_long_fist', false) === 'fail');
  t('空引用 → skip（不算红）', verdict('', false) === 'skip');
  /* 白名单双向：这三条是"白名单不腐烂"的机制证明 */
  const KNOWN_T = [{ where: 'a/x', id: 'gone', reason: 'r', owner: 'o' }];
  const diff = (hits) => {
    const key = (x) => x.where + '→' + x.id;
    const ks = new Map(KNOWN_T.map((k) => [key(k), k]));
    return { unknown: hits.filter((h) => !ks.has(key(h))).length, stale: KNOWN_T.filter((k) => !hits.some((h) => key(h) === key(k))).length };
  };
  t('新悬空不在名单 → 计为新增（会红）', diff([{ where: 'b/y', id: 'new' }]).unknown === 1);
  t('名单项仍悬空 → 不红、也不计过期', (() => { const r = diff([{ where: 'a/x', id: 'gone' }]); return r.unknown === 0 && r.stale === 0; })());
  t('名单项已修好 → 计为过期（也红，逼你删条目）', diff([]).stale === 1);
  /* 白名单条目质量：四栏齐全 + reason 不是空话（否则白名单变许愿池） */
  const entryOk = (k) => !!(k && k.where && k.id && k.reason && k.owner)
    && !VAGUE_REASON.test(String(k.reason)) && String(k.reason).length >= 6;
  t('合格条目（四栏齐 + reason 是可验证动作）→ 过', entryOk({ where: 'a/x', id: 'y', reason: '待《长拳谱》落库', owner: '数据线' }) === true);
  t('reason 写成「暂不修」→ 不过', entryOk({ where: 'a/x', id: 'y', reason: '暂不修', owner: '数据线' }) === false);
  console.log('  自测 ' + pass + '/' + (pass + fail));
  return fail === 0;
}

(async () => {
  console.log('⓪ 判定器自测');
  if (!selftest()) { console.error('自测未过，拒绝下结论'); process.exit(1); }

  /* 分片出处索引：id → 出现在哪些文件（报错要能指出"在哪定义过/从没定义过"） */
  const provenance = new Map();
  const dataDir = path.join(ROOT, 'game', 'data');
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    let txt = '';
    try { txt = fs.readFileSync(path.join(dataDir, f), 'utf8'); } catch (e) { continue; }
    provenance.set(f, txt);
  }
  /* 分片出处：区分「有定义」与「只是被引用」——两者处置完全不同 */
  const inShards = (id) => {
    const hits = [];
    for (const [f, txt] of provenance) {
      if (txt.indexOf('"' + id + '"') < 0) continue;
      const defined = txt.indexOf('"id"' + ':' + ' "' + id + '"') >= 0 || txt.indexOf('"' + id + '": {') >= 0 || txt.indexOf('"' + id + '":{') >= 0;
      hits.push({ file: f, defined });
    }
    return hits;
  };

  const e = new GameEngine({ seed: 20261021 });
  await e.boot({});
  const d = e.world.data;

  const itemIds = new Set(Object.keys(d.items || {}));
  const bookIds = new Set(Object.keys(d.books || {}));
  const skillIds = new Set(Object.keys(d.skills || {}));
  /* ⚠️ 判据口径（team-lead 2026-10-21 裁决）：**不问"在哪张表"，只问"getItem 能不能解析"**。
     · 为什么不查表成员：`getItem` 是**唯一真实解析入口**（商店/掉落/任务奖励/奇遇 give 四条路都走它）。
       直接调它，判据不会随实现（items-only / items 回退 books）漂移；
     · 历史（留档）：第一版查 `items ∪ books` → 放过 2 条空承诺；第二版查 `items` →
       抓到 4 条商店崩溃；裁决后改为调 `getItem`，实现怎么改判据都跟着对。 */
  const w = e.world;
  const resolvable = (id) => !!(w && typeof w.getItem === 'function' && w.getItem(id));
  const hasItem = (id) => resolvable(id);
  const onlyInBooks = (id) => !resolvable(id) && bookIds.has(id) && !itemIds.has(id);

  const bad = [], checked = [];

  /* ① 奇遇 randomitem */
  for (const en of arr(d.encounters)) {
    for (const ef of arr(en && en.effects)) {
      if (!ef || ef.type !== 'randomitem') continue;
      for (const id of arr(ef.args)) {
        const v = verdict(id, hasItem(id));
        if (v === 'skip') continue;
        checked.push(id);
        if (v === 'fail') bad.push({ where: 'encounters/' + en.id, id, kind: 'item', shards: inShards(id), onlyBook: onlyInBooks(id) });
      }
    }
  }

  /* ② 任务 DSL 里的 +item: / +skill: */
  const scanDsl = (where, text) => {
    for (const m of String(text).matchAll(/\+item:([a-z0-9_]+)/gi)) {
      const id = m[1];
      const v = verdict(id, hasItem(id));
      if (v === 'skip') continue;
      checked.push(id);
      if (v === 'fail') bad.push({ where, id, kind: 'item|book', shards: inShards(id) });
    }
    for (const m of String(text).matchAll(/\+skill:([a-z0-9_]+)/gi)) {
      const id = m[1];
      const v = verdict(id, skillIds.has(id));
      if (v === 'skip') continue;
      checked.push(id);
      if (v === 'fail') bad.push({ where, id, kind: 'skill', shards: inShards(id) });
    }
  };
  for (const q of arr(d.quests)) scanDsl('quest/' + (q && q.id), JSON.stringify(q || {}));

  /* ③ 书的 teach（技能） */
  for (const b of arr(d.books)) {
    const t = b && b.teach;
    const id = typeof t === 'string' ? t : (t && (t.skill || t.id));
    if (!id) continue;
    const v = verdict(id, skillIds.has(id));
    checked.push(id);
    if (v === 'fail') bad.push({ where: 'book/' + b.id + '.teach', id, kind: 'skill', shards: inShards(id) });
  }

  /* ④ 商店 goods / 房间 respawn / NPC carry */
  for (const s of arr(d.shops)) for (const g of arr(s && s.goods)) {
    const id = g && g.item;
    const v = verdict(id, hasItem(id));
    if (v === 'skip') continue;
    checked.push(id);
    if (v === 'fail') bad.push({ where: 'shop/' + s.id, id, kind: 'item|book', shards: inShards(id) });
  }
  for (const r of arr(d.rooms)) for (const it of arr(r && r.respawn)) {
    const id = it && (it.item || it.id);
    const v = verdict(id, hasItem(id));
    if (v === 'skip') continue;
    checked.push(id);
    if (v === 'fail') bad.push({ where: 'room/' + r.id + '.respawn', id, kind: 'item|book', shards: inShards(id) });
  }
  for (const n of arr(d.npcs)) for (const it of arr(n && n.carry)) {
    const id = typeof it === 'string' ? it : (it && (it.item || it.id));
    const v = verdict(id, hasItem(id));
    if (v === 'skip') continue;
    checked.push(id);
    if (v === 'fail') bad.push({ where: 'npc/' + n.id + '.carry', id, kind: 'item|book', shards: inShards(id) });
  }

  /* 双向比对：新悬空（红） / 名单过期（也红，逼你删条目） */
  const keyOf = (x) => x.where + '→' + x.id;
  const knownSet = new Map(KNOWN_DANGLING.map((k) => [keyOf(k), k]));
  const unknown = bad.filter((b) => !knownSet.has(keyOf(b)));
  const stale = KNOWN_DANGLING.filter((k) => !bad.some((b) => keyOf(b) === keyOf(k)));

  console.log('\n§1 引用点检查：共查 ' + checked.length + ' 处引用，悬空 ' + bad.length
    + ' 处（已知 ' + (bad.length - unknown.length) + ' · 新增 ' + unknown.length + ' · 名单过期 ' + stale.length + '）');
  for (const b of unknown) {
    console.log('  ✘【新增悬空】' + b.where + ' → ' + b.id + '（' + b.kind + '）'
      + (b.onlyBook ? ' · **books 有定义、items 没有**（发放会空承诺）'
        : b.shards.length
          ? ' · 出现在 ' + b.shards.map((x) => x.file + (x.defined ? '(有定义)' : '(仅被引用)')).join(',')
          : ' · 全库没有任何分片提到过它'));
  }
  for (const b of bad.filter((x) => knownSet.has(keyOf(x)))) {
    const k = knownSet.get(keyOf(b));
    console.log('  ⓘ【已知悬空·不计红】' + b.where + ' → ' + b.id + '（' + k.reason + ' / ' + k.owner + '）');
  }
  for (const k of stale) {
    console.log('  ✘【名单过期】' + k.where + ' → ' + k.id + ' 已不再悬空（' + k.reason + '）——请删除该白名单条目');
  }
  /* 白名单条目质量校验（写歪了直接红，防"许愿池"） */
  const badEntries = KNOWN_DANGLING.filter((k) => !(k && k.where && k.id && k.reason && k.owner)
    || VAGUE_REASON.test(String(k.reason)) || String(k.reason).length < 6);
  for (const k of badEntries) {
    console.log('  ✘【白名单条目不合格】' + JSON.stringify(k)
      + ' —— reason 必须是可验证动作（如「待《X》落库」），不能写「暂不修/已知问题/后续处理」');
  }
  /* 公开欠条：只要不是 0，每次跑都打出来（人看得见才算有人看） */
  if (KNOWN_DANGLING.length) {
    const byOwner = {};
    KNOWN_DANGLING.forEach((k) => { byOwner[k.owner] = (byOwner[k.owner] || 0) + 1; });
    console.log('  白名单 ' + KNOWN_DANGLING.length + ' 条'
      + '（' + Object.keys(byOwner).map((o) => o + ' ' + byOwner[o]).join(' · ') + '）：');
    for (const k of KNOWN_DANGLING) console.log('    · ' + k.where + ' → ' + k.id + '（' + k.reason + '）');
  }

  const fail = unknown.length + stale.length + badEntries.length;
  console.log('\n' + (fail
    ? '✘ ' + fail + ' 项未过（新增悬空 ' + unknown.length + ' · 名单过期 ' + stale.length + ' · 条目不合格 ' + badEntries.length + '）'
    : '✔ 引用完整性通过（新增悬空 0 · 白名单 ' + KNOWN_DANGLING.length + ' 条无过期）'));
  process.exit(fail ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
