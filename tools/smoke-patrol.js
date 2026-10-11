/* ============================================================
 * smoke-patrol.js —— 官府巡街与盘查守卫（design/67 §3）
 *
 * 主人 2026-10-11：「几乎所有城市都没有官府巡逻的人」。
 * 守四件事：
 *   ① 六座城 + 书院的街上**真有官差**（tag=constable/official），不是只有衙门里
 *   ② **恶名 0 的人绝不被拦**（误伤无辜比漏放坏人更糟）
 *   ③ 恶名够高 → 真被拦下，且给全三个出口（报名 / 打点 / 拒捕）
 *   ④ 三个出口**走真实指令路径**都生效（报名/打点改得动恶名与银钱；
 *      拒捕就是普通的「打」，不另造分支）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const patrol = require(path.join(ROOT, 'game/src/core/patrol.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const text = r => (r && (r.lines || []).map(l => l.text).join('\n')) || '';

(async () => {
  const e = new GameEngine({ seed: 5 });
  await e.boot({});
  e.newGame({ name: '巡街' });
  const w = e.world, p = w.player;

  console.log('===== ① 街上真有官差 =====');
  {
    const WATCH = { constable: 1, official: 1 };
    const CITY = {
      xiangyang: ['xiangyang_street', 'xiangyang_market', 'xy_home_'],
      luoyang: ['luoyang_street', 'luoyang_market', 'ly_home_'],
      chengdu: ['chengdu_street', 'chengdu_market', 'cd_home_'],
      changan: ['changan_street', 'changan_market', 'ca_home_'],
      gusu: ['gusu_', 'gs_home_'],
      harbor: ['jn_harbor', 'hb_home_'],
    };
    const countOf = (reg) => Object.values(w.data.npcs).filter(n => {
      if (!WATCH[n.tag]) return false;
      const r = w.data.rooms[n.room];
      return r && r.region === reg;
    }).length;
    for (const reg of Object.keys(CITY)) {
      ok(`${reg} 有巡街官差`, countOf(reg) >= 1, countOf(reg) + ' 人');
    }
  }

  console.log('===== ② 恶名 0 → 绝不误伤 =====');
  {
    p.kidnap = p.kidnap || {};
    p.kidnap.wanted = 0;
    let hit = null;
    for (let i = 0; i < 20 && !hit; i++) {
      delete (p.vars || {}).patrolAt;
      hit = patrol.maybeCheck(w, p, w.getRoom('xiangyang_street'), w.npcsIncludingTemplates('xiangyang_street'));
    }
    ok('★ 清白的人走二十趟也不被盘查', hit === null);
  }

  console.log('===== ③ 恶名高 → 被拦，且给全三个出口 =====');
  {
    p.kidnap.wanted = 60;
    let got = null;
    for (let i = 0; i < 40 && !got; i++) {
      delete (p.vars || {}).patrolAt;
      got = patrol.maybeCheck(w, p, w.getRoom('xiangyang_street'), w.npcsIncludingTemplates('xiangyang_street'));
    }
    ok('★ 恶名 60 的人在街上会被拦下', !!got);
    ok('给了三个出口', !!(got && got.choices && got.choices.length === 3),
      got ? (got.choices || []).map(c => c.label).join('/') : '(无)');
    ok('拒捕走的是**既有**的「打」指令（不另造战斗分支）',
      !!(got && got.choices.some(c => /^打 /.test(c.cmd))));
  }

  console.log('===== ④ 冷却是真的（不能走一步查一次） =====');
  {
    const room = 'xiangyang_street';
    p.kidnap.wanted = 60;
    delete (p.vars || {}).patrolAt;
    const first = patrol.maybeCheck(w, p, w.getRoom(room), w.npcsIncludingTemplates(room));
    ok('第一次拦下了', !!first);
    const second = patrol.maybeCheck(w, p, w.getRoom(room), w.npcsIncludingTemplates(room));
    ok('★ 紧接着再来一次 → 冷却挡住，不再拦', second === null);
  }

  console.log('===== ⑤ 「报名」真走指令路径 =====');
  {
    p.vars = p.vars || {};
    p.vars.patrolBy = 'cy_xy_patrol_1';
    p.kidnap.wanted = 10;
    const r = await e.exec('报名');
    ok('「报名」有回应', text(r).length > 6);
    ok('★ 低恶名 → 名册翻不着，放行且恶名下降', p.kidnap.wanted < 10, '恶名=' + p.kidnap.wanted);
    ok('盘查账已清（不能站着反复报名）', !p.vars.patrolBy);
  }

  console.log('===== ⑥ 「打点」真走指令路径 =====');
  {
    p.vars.patrolBy = 'cy_xy_patrol_1';
    p.kidnap.wanted = 40;
    p.money = 5000;
    const before = p.money;
    const r = await e.exec('打点');
    ok('「打点」有回应', text(r).length > 6);
    ok('★ 扣了银子', p.money === before - 40 * 20, `${before} → ${p.money}`);
    ok('★ 恶名减半', p.kidnap.wanted === 20, '恶名=' + p.kidnap.wanted);
  }

  console.log('===== ⑦ 钱不够 → 不打点、不误扣 =====');
  {
    p.vars.patrolBy = 'cy_xy_patrol_1';
    p.kidnap.wanted = 60;
    p.money = 10;
    await e.exec('打点');
    ok('★ 钱不够时一分不扣', p.money === 10);
    ok('★ 钱不够时恶名不减（没做成就是没做成）', p.kidnap.wanted === 60);
  }

  console.log('===== ⑧ 没被拦时报名/打点不报错 =====');
  {
    delete p.vars.patrolBy;
    const r1 = await e.exec('报名');
    const r2 = await e.exec('打点');
    ok('空手「报名」不崩且给话', text(r1).length > 0 && !/undefined|NaN/.test(text(r1)));
    ok('空手「打点」不崩且给话', text(r2).length > 0 && !/undefined|NaN/.test(text(r2)));
  }

  console.log(`\n===== smoke-patrol: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
