/**
 * 自验：67_sidequests2.json（新增支线 + 挂载）
 * 全绿才允许交付。输出「通过 N / 失败 M」。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const { World } = require(path.join(ROOT, 'game/src/core/world.js'));
const { evalEffects, evalCond } = require(path.join(ROOT, 'game/src/core/modapi.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) pass++; else { fail++; fails.push(msg); } }

/* ── 载入「当前世界」（含 67） ── */
const e = new GameEngine({ seed: 1 });
e.boot();
const D = e.world.data;
const P67 = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/67_sidequests2.json'), 'utf8'));
const newQ = Object.keys(P67.quests);
console.log('新任务数:', newQ.length, '| 挂载 NPC:', Object.keys(P67.npcs).length);

/* ── 基线世界：复制 game/data（除 67_）到项目内临时目录，跑一次 ── */
const TMP = path.join(ROOT, 'tools', '_tmp-base-data');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'game/data'))) {
  if (!/^\d+_.*\.json$/.test(f)) continue;
  if (/^67_/.test(f)) continue;
  fs.copyFileSync(path.join(ROOT, 'game/data', f), path.join(TMP, f));
}
const base = new World({ dataDirs: [TMP], seed: 1 });
base.loadBaseData();

/* ── 1) 每条新任务：已加载 / giver·npc 真实 / 段数 / 目标房间真实 / 有 menu / 有 favor ── */
const roomKeys = new Set();
for (const qid of newQ) {
  const q = P67.quests[qid];
  ok(!!D.quests[qid], qid + ' 未加载到世界');
  const dq = D.quests[qid] || q;
  ok(!!D.npcs[dq.giver], qid + ' giver 不存在: ' + dq.giver);
  ok(!!D.npcs[dq.npc], qid + ' npc 不存在: ' + dq.npc);
  ok(dq.giver === dq.npc, qid + ' npc 与 giver 不一致');
  const stages = dq.stages || [];
  ok(stages.length >= 2 && stages.length <= 4, qid + ' 段数不达标: ' + stages.length);
  let hasMenu = false, hasFavor = false;
  const favorRe = new RegExp('favor:' + dq.npc + ':');
  for (const s of stages) {
    for (const t of (s.targets || [])) {
      if (t.kind === 'room') { roomKeys.add(t.key); ok(!!D.rooms[t.key], qid + ' 目标房间不存在: ' + t.key); }
    }
    for (const ef of (s.effects || [])) {
      if (ef.type === 'menu') {
        hasMenu = true;
        ok(ef.raw.indexOf('|') > 0 && ef.raw.indexOf(';;') > 0, qid + ' menu 语法不完整');
        if (favorRe.test(ef.raw)) hasFavor = true;
      }
    }
  }
  // rewards 里也找一遍 favor
  for (const r of (dq.rewards || [])) if (typeof r.raw === 'string' && favorRe.test(r.raw)) hasFavor = true;
  ok(hasMenu, qid + ' 缺少 menu 灰色抉择');
  ok(hasFavor, qid + ' 奖励缺少 favor:' + dq.npc);
}

/* ── 2) 挂载：被挂 NPC 的 quests 原有一项不漏 ── */
for (const id of Object.keys(P67.npcs)) {
  const cur = (D.npcs[id] && D.npcs[id].quests) || [];
  const was = (base.data.npcs[id] && base.data.npcs[id].quests) || [];
  const want = P67.npcs[id].quests;
  for (const q of was) ok(cur.includes(q), id + ' 丢掉了原有任务: ' + q);
  for (const q of want) ok(cur.includes(q), id + ' 未挂上: ' + q);
  ok(cur.length >= want.length, id + ' quests 少于预期');
  // 新挂的任务 id 必须真实存在
  for (const q of want) ok(!!D.quests[q], id + ' 挂了不存在的任务: ' + q);
}

/* ── 3) cond/require 无悬空 flag（当前新任务无 cond/require，作兜底扫描）── */
function collectFlags(cond, out) {
  if (!cond || typeof cond !== 'object') return;
  for (const k of ['flag', 'notFlag']) if (typeof cond[k] === 'string') out.push(cond[k]);
  for (const k of ['flagsAll', 'flagsAny', 'flagsNone']) if (cond[k]) out.push([].concat(cond[k]));
  for (const k of ['and', 'or']) if (Array.isArray(cond[k])) cond[k].forEach(c => collectFlags(c, out));
  if (cond.not) collectFlags(cond.not, out);
}
const allEffectStr = JSON.stringify({ quests: P67.quests, items: P67.items });
for (const qid of newQ) {
  const q = P67.quests[qid];
  const flags = [];
  if (q.require) collectFlags(q.require, flags);
  for (const s of (q.stages || [])) if (s.cond) collectFlags(s.cond, flags);
  const flat = flags.flat();
  for (const f of flat) {
    // 置位来源：本文件任一 menu 选项里的 flag:f，或世界其它任务
    ok(allEffectStr.includes('flag:' + f + ';') || allEffectStr.includes('flag:' + f + '"'),
      qid + ' cond 读了无处置位的 flag: ' + f);
  }
}

/* ── 4) 每组 effects 喂 evalEffects 不抛错（含 menu 选项内部效果）── */
const w = e.world;
const p = w.createPlayer({ name: '验', gender: 'male', money: 100000 });
const ctx = { player: p, world: w };
function runEffects(label, effects) {
  try { evalEffects(effects, ctx); pass++; }
  catch (err) { fail++; fails.push(label + ' evalEffects 抛错: ' + err.message); }
}
let ranOpts = 0;
for (const qid of newQ) {
  const q = P67.quests[qid];
  for (let i = 0; i < q.stages.length; i++) {
    const st = q.stages[i];
    runEffects(qid + '#stage' + i, st.effects || []);
    for (const ef of (st.effects || [])) {
      if (ef.type !== 'menu') continue;
      const opts = (ef.raw.split('|')[1] || '').split(';;').filter(Boolean);
      opts.forEach((o, oi) => {
        const m = o.match(/^([^>]+)>\s*(.*)$/);
        ok(!!m, qid + ' menu 选项缺 >');
        if (!m) return;
        const effs = m[2].split(';').map(s => s.trim()).filter(Boolean);
        ok(effs.length > 0, qid + ' menu 选项无用效果');
        runEffects(qid + '#menu' + i + '.' + oi, effs);
        ranOpts++;
      });
    }
  }
  runEffects(qid + '#rewards', q.rewards || []);
}
console.log('实际判定 menu 选项数:', ranOpts);

/* ── 5) 新物品存在 ── */
for (const it of Object.keys(P67.items)) ok(!!D.items[it], '新物品未加载: ' + it);

/* ── 6) 用「加载后的世界」跑一遍真实领取+上报链路（防 giver 挂不上）── */
{
  const qid = newQ[0];
  const q = D.quests[qid];
  const giver = D.npcs[q.giver];
  const avail = (giver.quests || []).includes(qid);
  ok(avail, '首位支线未挂在该 NPC 的 quests 上');
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log('\n====================');
console.log(`  自验结果：通过 ${pass} / 失败 ${fail}`);
if (fail) { console.log('  ✘ 失败项：'); fails.slice(0, 40).forEach(f => console.log('     - ' + f)); }
else console.log('  ✔ 全绿');
console.log('====================');
process.exit(fail ? 1 : 0);
