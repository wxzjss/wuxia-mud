/* ============================================================
 * smoke-sects.js — 门派三层 + 武学矩阵（design/44 R1、design/40 §5）
 *
 * 覆盖主人硬指标：
 *  ① 门派分三层（一流 / 二流 / 三流），另有秘境
 *  ② 每家门派在**它的三个品级**上，内功/招架/轻功/攻击/旁门 五类**各至少一本**
 *  ③ 一流 1/4/7 · 二流 2/5/8 · 三流 3/6/9（主人钦定 147 / 258 / 369）
 *  ④ 每家门派都有故事；三流「几乎无考核」（require 为空）
 *  ⑤ 每家门派都落地了山门（有房间、有掌门 NPC、能拜师）
 *  ⑥ 门派授的基础武学能吃得住（弟子练得动本门功夫）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261012;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

const e0 = boot();
const w = e0.world;
const SECTS = w.data.sects;
const SK = w.data.skills;

/* ---------- ① 三层 ---------- */
section('① 门派分三层');
const tiers = {};
for (const s of Object.values(SECTS)) tiers[s.tier || '(无)'] = (tiers[s.tier || '(无)'] || 0) + 1;
ok('所有门派都有 tier', !tiers['(无)'], JSON.stringify(tiers));
ok('一流 7 家', tiers['一流'] === 7, String(tiers['一流']));
ok('二流 15 家（6 原有 + 8 新增 + 合欢宗）', tiers['二流'] === 15, String(tiers['二流']));
ok('三流 20 家（全新增）', tiers['三流'] === 20, String(tiers['三流']));
ok('共 43 家（含 1 秘境与合欢宗）', Object.keys(SECTS).length === 43, String(Object.keys(SECTS).length));

/* ---------- ② 品级 × 五类 覆盖 ---------- */
section('② 每门派 × 每品级 × 五类 都有武学');
const GRADES = { 一流: [1, 4, 7], 二流: [2, 5, 8], 三流: [3, 6, 9] };
const DOMS = ['force', 'guard', 'fly', 'atk', 'qimen'];
const miss = [];
let checked = 0;
for (const [id, s] of Object.entries(SECTS)) {
  if (!GRADES[s.tier]) continue;          // 秘境不按三层走
  const list = s.skills || [];
  for (const g of GRADES[s.tier]) {
    for (const d of DOMS) {
      checked++;
      const hit = list.some(sid => {
        const sk = SK[sid];
        return sk && sk.grade === g && sid.indexOf('_' + d + '_') >= 0;
      });
      if (!hit) miss.push(`${id}(${s.tier}) ${g}品 ${d}`);
    }
  }
}
ok(`${checked} 个「门派×品级×类别」格全部有武学`, miss.length === 0, miss.slice(0, 10).join(' | '));

/* ---------- ③ 品级对齐 R1 ---------- */
section('③ 品级对齐主人钦定 147 / 258 / 369');
const wrong = [];
for (const [id, s] of Object.entries(SECTS)) {
  const gs = GRADES[s.tier];
  if (!gs) continue;
  for (const sid of (s.skills || [])) {
    const sk = SK[sid];
    if (!sk || sk.grade == null) continue;
    // 只检查本派自家武学（外人武学如华山弟子也用 basic_* 之类）
    if (sid.indexOf(id) !== 0) continue;
    if (gs.indexOf(sk.grade) < 0) wrong.push(`${id}/${sid}@${sk.grade}品`);
  }
}
ok('没有落在本层品级之外的门派武学', wrong.length === 0, wrong.slice(0, 8).join(' '));

/* ---------- ④ 故事 + 三流无考核 ---------- */
section('④ 门派故事 / 三流无考核');
const noStory = Object.entries(SECTS).filter(([, s]) => !s.story).map(([id]) => id);
ok('每家门派都有故事（story）', noStory.length === 0, noStory.join(','));
const hardTrio = [];
for (const [id, s] of Object.entries(SECTS)) {
  if (s.tier !== '三流') continue;
  const rq = s.require || {};
  if (Object.keys(rq).length) hardTrio.push(id);
}
ok('三流门派「几乎无考核」（require 为空）', hardTrio.length === 0, hardTrio.join(','));

/* ---------- ⑤ 山门落地 ---------- */
section('⑤ 每家门派都有地盘与掌门');
const noGate = [], noMaster = [];
for (const [id, s] of Object.entries(SECTS)) {
  if (id === 'xiake') continue;   // 秘境（海上仙山）另有安排
  /* ⚠️ 不能用「房间 id 必须是 {id}_gate」判：老门派的山门房叫 road_huashan_1 这种。
     正解是「本派 region 里有房间」（新门派挂靠城镇 region，也满足）。 */
  const owned = Object.values(w.data.rooms).filter(r => r.region === s.region && !r._privateHost).length;
  if (!owned) noGate.push(id + '(region=' + s.region + ')');
  const hasMaster = Object.values(w.data.npcs).some(n => n.sect === id);
  if (!hasMaster) noMaster.push(id);
}
ok('每家门派在自家区域里都有房间', noGate.length === 0, noGate.join(','));
ok('每家门派都有人（sect 指向它的 NPC）', noMaster.length === 0, noMaster.join(','));
const masterSect = Object.values(w.data.npcs).filter(n => n.sect && SECTS[n.sect]);
ok('门派 NPC 数量 ≥ 42（每家至少一位掌门）', masterSect.length >= 42, String(masterSect.length));
const teachBad = Object.values(w.data.npcs).filter(n => n.sect && SECTS[n.sect] && (n.teach || []).some(t => !SK[t]));
ok('门派 NPC 教的武学都真实存在', teachBad.length === 0, teachBad.map(n => n.id).slice(0, 5).join(','));

/* ---------- ⑥ 入门即授的武学吃得住 ---------- */
section('⑥ 门派入门授的基础武学撑得住本门功夫');
const badEntry = [];
for (const [id, s] of Object.entries(SECTS)) {
  if (id === 'xiake') continue;
  const entry = s.entrySkills || [];
  if (!entry.some(x => SK[x] && SK[x].isBasic)) { badEntry.push(id + '(没授基础武学)'); continue; }
  /* 本门**入门那一代**的每门功夫，它的根（base）必须在入门即授的清单里，
     否则弟子刚进门就有一门功夫永远停在 0 级 —— 这正是「练不动」的来源。 */
  for (const dom of ['force', 'guard', 'fly', 'atk', 'qimen']) {
    const sid = `${id}_${dom}_1`;
    const sk = SK[sid];
    if (!sk || !sk.base) continue;
    if (entry.indexOf(sk.base) < 0) badEntry.push(`${id}/${dom}(缺${sk.base})`);
  }
}
ok('门派入门即授的基础武学覆盖本门五类的根', badEntry.length === 0, badEntry.slice(0, 6).join(' '));

/* ---------- ⑦ 真能拜师 ---------- */
section('⑦ 真能拜师（走 joinSect 真实路径）');
const e1 = boot(); const p1 = e1.world.player;
const r1 = p1.joinSect('jindao');       // 三流，无考核
ok('三流门派（金刀门）拜得进去', r1.ok === true, r1.msg);
ok('拜师后拿到了基础武学（练得动本门功夫）',
  Object.keys(p1.learned).some(k => SK[k] && SK[k].isBasic), Object.keys(p1.learned).join(','));
const e2 = boot(); const p2 = e2.world.player;
const r2 = p2.joinSect('qingcheng');    // 二流，要身法 ≥14
ok('二流门派有考核（条件不足被拒）', r2.ok === false, r2.msg);
p2.baseAttr['身法'] = 20; p2.recalc();
const r3 = p2.joinSect('qingcheng');
ok('条件够了就进得去', r3.ok === true, r3.msg);
const e3 = boot(); const p3 = e3.world.player;
const r4 = p3.joinSect('emei');
ok('女性门槛仍然拦得住（男身拜峨眉被拒）', r4.ok === false, r4.msg);

/* ---------- ⑧ 门派武学真能学 ---------- */
section('⑧ 门派武学沿 base 链学得下去');
const e4 = boot(); const p4 = e4.world.player;
p4.sect = 'jindao'; p4.rank = 5;
const learn = [];
for (const sid of ['jindao_force_1', 'jindao_atk_1', 'jindao_atk_2', 'jindao_atk_3']) {
  learn.push(sid + ':' + (p4.learnSkill(sid, { force: true }).ok ? 'ok' : 'fail'));
}
ok('核心/中阶/入门三代都能学会', learn.every(x => /:ok$/.test(x)), learn.join(' '));
ok('核心武学确实挂在 base 链上（不是孤岛）',
  !!SK['jindao_atk_3'].base && !!SK[SK['jindao_atk_3'].base].base, JSON.stringify([SK['jindao_atk_3'].base]));

console.log(`\n===== smoke-sects: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
