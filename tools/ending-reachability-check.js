#!/usr/bin/env node
/* ==========================================================================
 *  tools/ending-reachability-check.js —— 结局可达性守卫（2026-10-18）
 *
 * 病根（半成品审计第 8 项）：结局效果只由房间 action 触发，而**任务完成**对
 * 结局零校验——将来多一条完成通路（mod / 新数据 / 剧情分叉），就会出现
 * 「通关了 p.ending 还空着」的静默缺口。当时还顺带发现两处死接缝：
 *   ① 声明在 data.endings 里的结局，没有任何效果引用它（声明了但不会发生）；
 *   ② 引擎从不给回包赋 `ending` 字段 → 前端「故事终章」弹框是死代码。
 *
 * 本守卫守四件事：
 *   A 每条**声明过**的结局，在「可执行面」（room action effects / quest 的
 *     stages.effects / rewards / 菜单 raw）里至少有一个触发点；
 *   B 主线末章 q_main_end 的完成批（含 questdone:q_main_end 的那批效果）
 *     同批/同串里必须有 ending——或者该任务声明了 endingOnComplete 兜底；
 *   C 兜底机制本身可用：合成 endingOnComplete → 完成即落；已有 final → 不覆盖；
 *   D 回包接缝：exec 产物带 `ending`（前端终章弹框的数据源）。
 *
 * 用法：node tools/ending-reachability-check.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const endings = require(path.join(ROOT, 'game', 'src', 'core', 'endings.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  « ' + extra : '')); }
}

/* ---------- 收集「可执行面」里的 ending 引用 ---------- */
function collect() {
  const refs = [];              /* {id, from} */
  const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && /^\d+_/.test(f)).sort();
  const scanText = (s, from) => {
    if (typeof s !== 'string') return;
    const re = /ending:([A-Za-z_][\w]*)/g; let m;
    while ((m = re.exec(s)) !== null) refs.push({ id: m[1], from });
  };
  const scanEffects = (fx, from) => {
    for (const e of (Array.isArray(fx) ? fx : [fx])) {
      if (!e || typeof e !== 'object') continue;
      if (e.type === 'ending' && e.args && e.args[0]) refs.push({ id: e.args[0], from });
      if (typeof e.raw === 'string') scanText(e.raw, from);
    }
  };
  for (const f of files) {
    let d; try { d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
    for (const rid of Object.keys(d.rooms || {})) {
      for (const a of ((d.rooms[rid] || {}).actions || [])) {
        scanEffects(a.effects, f + ':' + rid + ':' + (a.cmd || a.label || '?'));
      }
    }
    for (const qid of Object.keys(d.quests || {})) {
      const q = d.quests[qid] || {};
      for (const st of (q.stages || [])) scanEffects(st.effects, f + ':quest:' + qid + ':stage');
      scanEffects(q.rewards, f + ':quest:' + qid + ':rewards');
      /* A 条补一条触发面：`endingOnComplete` 是**可执行**的声明式兜底
         （任务完成且 final 为空时由 endings.onQuestDone 落定），
         与 effects 里的 ending 等价，必须算「有触发点」——
         否则「声明了兜底」会被判成「声明了但永远不会发生」。2026-10-18 补。 */
      if (typeof q.endingOnComplete === 'string' && q.endingOnComplete.trim()) {
        const id = q.endingOnComplete.split(':')[0].trim();
        if (id) refs.push({ id, from: f + ':quest:' + qid + ':endingOnComplete' });
      }
    }
  }
  return refs;
}

(async () => {
  console.log('\n  ── 结局可达性守卫 ──');
  const e = new GameEngine({ seed: 20261018 });
  await e.boot({});
  e.newGame({ name: '验结人', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;

  /* A 声明的结局必须至少有一个可执行触发点 */
  const refs = collect();
  const reachable = new Set(refs.map(r => r.id));
  const declared = Object.keys(w.data.endings || {});
  ok('A-0 前提：数据里有声明的结局（否则 A 条无意义）', declared.length > 0, declared.join(','));
  const dead = declared.filter(id => !reachable.has(id));
  ok('A ★ 每条声明的结局都有可执行触发点（无「声明了但永远不会发生」）',
    dead.length === 0, dead.length ? '无触发：' + dead.join(',') : '声明 ' + declared.length + ' / 可达 ' + reachable.size);
  /* 反向：引用了但没声明的 id 只作提示（结局台账不依赖声明表，不判红） */
  const undeclared = [...reachable].filter(id => declared.indexOf(id) < 0);
  if (undeclared.length) console.log('    （提示）效果里用到、但 data.endings 未声明的 id：' + undeclared.join('、'));

  /* B 主线末章的完成批必须与结局同批（或声明兜底字段）
     判法：扫全 data 的「效果容器」——
       · 菜单 raw 字符串里同一条串同时出现 questdone:q_main_end 与 ending:；
       · 或某个 effects 数组里同时有 {type:'questdone',args:['q_main_end']} 与 {type:'ending'}。 */
  const qdEnd = w.data.quests.q_main_end;
  ok('B-0 前提：找得到主线末章 q_main_end', !!qdEnd);
  let sameBatch = null;
  (function scan() {
    const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json') && /^\d+_/.test(f));
    const walk = (v, from) => {
      if (typeof v === 'string') {
        if (v.indexOf('questdone:q_main_end') >= 0 && v.indexOf('ending:') >= 0) sameBatch = from;
        return;
      }
      if (Array.isArray(v)) {
        const hasDone = v.some(x => x && x.type === 'questdone' && (x.args || [])[0] === 'q_main_end');
        const hasEnd = v.some(x => x && x.type === 'ending');
        if (hasDone && hasEnd) sameBatch = from;
        v.forEach(x => walk(x, from));
        return;
      }
      if (v && typeof v === 'object') {
        for (const k of Object.keys(v)) walk(v[k], from + '.' + k);
      }
    };
    for (const f of files) {
      let d; try { d = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { continue; }
      walk(d, f);
    }
  })();
  ok('B ★ q_main_end 的完成路径上有结局（同批 ending，或声明 endingOnComplete 兜底）',
    !!qdEnd && (!!qdEnd.endingOnComplete || !!sameBatch),
    qdEnd && qdEnd.endingOnComplete ? 'endingOnComplete=' + qdEnd.endingOnComplete
      : (sameBatch ? '同批位置 ' + sameBatch : '既无兜底也无同批 ending'));

  /* C 兜底机制可用（合成字段，不依赖真数据） */
  const synthetic = { id: 'q_test_echo_end', name: '合成验结', endingOnComplete: 'test_end:测试结局' };
  const beforeFinal = p.ending && p.ending.final;
  p.ending = { achieved: {}, final: null };
  const line = endings.onQuestDone(w, p, synthetic);
  ok('C-1 ★ 完成任务 + 未落结局 ⇒ 兜底结局生效（台账/旗标/结局行三件齐）',
    !!line && line.kind === 'ending' && p.ending.final === 'test_end'
    && p.hasFlag('ending_test_end'));
  const line2 = endings.onQuestDone(w, p, synthetic);
  ok('C-2 ★ 已有 final 结局 ⇒ 兜底不覆盖（三选一先落的路径安全）',
    line2 === null && p.ending.final === 'test_end');
  p.ending.final = beforeFinal;
  if (!beforeFinal) p.ending.final = null;

  /* D 回包接缝：结局行必须变成 exec 产物的 ending 字段（前端终章弹框的数据源） */
  p.room = 'haitan_boat';
  p.setFlag('three_words', true); p.setFlag('haitan_ferry_seen', true);
  p.setFlag('act5_done', false);
  const r = e.exec('上船离港');
  ok('D ★ exec 回包带 ending 字段（「故事终章」弹框不再读空气）',
    !!(r && r.ending && r.ending.id === 'yuanhang'),
    r && r.ending ? JSON.stringify(r.ending) : 'ending=null');

  console.log('\n' + (fail ? '✘ ' + fail + ' 项失败：' + fails.join(' / ') : '✔ 全部通过'));
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(2); });
