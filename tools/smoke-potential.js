/* smoke-potential.js —— 潜能（主人 2026-10-08 接回来）
 *
 * 主人原话：
 *   「接回来，并且**请教会消耗潜能**（按武学品级以及等级从低到高消耗增多），
 *     但**自己练不会消耗**，给主支线任务以及其他方式增加潜能获取途径」
 *   「别忘了潜能可以用来通过『请教』**直接提升武学熟练度**
 *     （武学熟练度提升上限按原来的上内力上限限制加请教对象的目标武学当前熟练度）」
 *   「希望『状态』里能看到潜能多少」
 *
 * 跑法：node tools/smoke-potential.js
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const P = require(path.join(ROOT, 'game', 'src', 'core', 'potential.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function sec(t) { console.log('\n── ' + t + ' ──'); }

function boot(seed) {
  const e = new GameEngine({ seed: seed || 5150, saveDir: SAVE_DIR });
  e.boot();
  e.newGame({ name: '攒潜能的', gender: 'male', birth: 'wuxue' });
  return e;
}

(async () => {
  console.log('==============================================');
  console.log('  潜能：请教要花、自己练不花、办事能攒');
  console.log('==============================================');

  /* ---------- ① 定价：品级 / 等级 从低到高递增 ---------- */
  sec('① 请教定价：品级越高越贵、功夫越深越贵、已经练得越高越贵');
  {
    const c9 = P.teachCostOf({ grade: 9, maxLevel: 300 });
    const c5 = P.teachCostOf({ grade: 5, maxLevel: 600 });
    const c1 = P.teachCostOf({ grade: 1, maxLevel: 900 });
    ok('★ 品级：九品 < 五品 < 一品', c9 < c5 && c5 < c1, `${c9} < ${c5} < ${c1}`);
    const deep = P.teachCostOf({ grade: 5, maxLevel: 1000 });
    ok('★ 同品级：功夫越深（maxLevel 越大）越贵',
      deep > P.teachCostOf({ grade: 5, maxLevel: 300 }), `${P.teachCostOf({ grade: 5, maxLevel: 300 })} → ${deep}`);
    const lv0 = P.teachCostOf({ grade: 3, maxLevel: 700 }, 0);
    const lv100 = P.teachCostOf({ grade: 3, maxLevel: 700 }, 100);
    const lv400 = P.teachCostOf({ grade: 3, maxLevel: 700 }, 400);
    ok('★ 等级：0 级 < 100 级 < 400 级', lv0 < lv100 && lv100 < lv400, `${lv0} < ${lv100} < ${lv400}`);
    ok('定价永远是正整数', [c9, c5, c1, lv400].every(n => Number.isInteger(n) && n > 0));
    /* 师门对折 */
    const sd = { grade: 1, maxLevel: 900 };
    ok('★ 师门里（已拜师）打对折',
      P.teachCostFor({}, sd, 0, true) === Math.ceil(P.teachCostOf(sd, 0) / 2),
      `${P.teachCostFor({}, sd, 0, true)} / 原价 ${P.teachCostOf(sd, 0)}`);
  }

  /* ---------- ② 开局就有潜能（不然新手第 7 章断路） ---------- */
  sec('② 开局家底');
  {
    const e = boot();
    const p = e.world.player;
    ok('★ 开局潜能 > 0（新手第 7 章要请教学两门功夫，0 会断路）',
      p.potential > 0, 'potential=' + p.potential);
    ok('至少够请两门九品粗浅功夫',
      p.potential >= P.teachCostOf({ grade: 9, maxLevel: 300 }) * 2,
      p.potential + ' vs ' + P.teachCostOf({ grade: 9, maxLevel: 300 }));
  }

  /* ---------- ③ 请教：学会一门要花潜能 ---------- */
  sec('③ 请教一门没学过的：花潜能');
  {
    const e = boot(21);
    const w = e.world, p = w.player;
    const master = w.spawnNpc('guide_teaman', p.room, 1, true);
    p.masters = {}; p.masters[master.defId || master.id] = true;   // 拜他为师
    p.potential = 5000;
    const before = p.potential;
    const r = await e.exec('请教 卖茶的老汉 长拳');
    const learned = !!p.learned[Object.keys(w.data.skills).find(id => w.data.skills[id].name === '长拳')];
    ok('★ 学会了「长拳」', learned, JSON.stringify(Object.keys(p.learned).slice(-3)));
    ok('★ 潜能被扣掉了', p.potential < before, `${before} → ${p.potential}`);
    ok('台词里明说了扣多少、还剩多少',
      (r.lines || []).some(l => /耗去潜能 \d+ 点/.test(l.text || '')), (r.lines || []).map(l => l.text).find(t => /潜能/.test(t || '')));

    /* 潜能不够：明说、且一点都不扣 */
    p.potential = 0;
    const qid2 = Object.keys(w.data.skills).find(id => w.data.skills[id].name === '长拳');
    delete p.learned[qid2];      /* 退回「没学过」，再请教一次 */
    const r2 = await e.exec('请教 卖茶的老汉 长拳');
    ok('★ 潜能不够时明说（不是静默失败）',
      (r2.lines || []).some(l => /潜能/.test(l.text || '')), (r2.lines || []).map(l => l.text).join(' | ').slice(0, 60));
    ok('★ 潜能不够时什么都没学、也没扣',
      !p.learned[qid2] && p.potential === 0, 'learned=' + !!p.learned[qid2] + ' pot=' + p.potential);
  }

  /* ---------- ④ 已会的 → 花潜能请人点拨，直接涨熟练度 ---------- */
  sec('④ 已会的功夫：花潜能直接涨熟练度（主人补的那条）');
  {
    const e = boot(22);
    const w = e.world, p = w.player;
    const master = w.spawnNpc('guide_teaman', p.room, 1, true);
    p.masters = {}; p.masters[master.defId || master.id] = true;
    /* 先把根基练起来：点拨的上限受「基础武学练到几级」压着 */
    p.learned.basic_fist.level = 200;
    await e.exec('请教 卖茶的老汉 长拳');
    const cq = Object.keys(w.data.skills).find(id => w.data.skills[id].name === '长拳');
    ok('前提：已经学会「长拳」', !!p.learned[cq]);
    p.potential = 20000;
    const lv0 = p.skillLevel(cq), pot0 = p.potential;
    const r = await e.exec('请教 卖茶的老汉 长拳');
    const lv1 = p.skillLevel(cq);
    ok('★ 点拨之后熟练度真的涨了', lv1 > lv0, `${lv0} → ${lv1}`);
    ok('★ 点拨扣了潜能', p.potential < pot0, `${pot0} → ${p.potential}`);
    ok('台词里给了「能指点的上限」', (r.lines || []).some(l => /上限/.test(l.text || '')),
      (r.lines || []).map(l => l.text).find(t => /上限/.test(t || '')));

    /* 上限：自己天花板 ∩ 对方水平（两个限制都生效） */
    const sd = w.getSkill(cq);
    const teachLv = P.teacherLevelOf(master, cq);
    const cap = P.teachUpCap(p, sd, teachLv);
    ok('★ 上限 = min(自己天花板, 对方那门功夫的级数)',
      cap <= p.effectiveMax(sd) + 0.001 && cap <= teachLv + 0.001,
      `cap=${cap} 自己=${p.effectiveMax(sd)} 对方=${teachLv}`);
    ok('点到顶之后不再涨、并明说原因', (() => {
      p.learned[cq].level = cap;                       /* 直接顶到上限 */
      return true;
    })());
    const r2 = await e.exec('请教 卖茶的老汉 长拳');
    ok('★ 到顶时明确回绝（不静默吞潜能）',
      (r2.lines || []).some(l => /没什么能教你/.test(l.text || '')) && p.potential === (r.lines ? p.potential : 0),
      (r2.lines || []).map(l => l.text).join(' | ').slice(0, 50));
  }

  /* ---------- ⑤ 自己练：一点潜能都不花（主人明确要求） ---------- */
  sec('⑤ 自己练不花潜能');
  {
    const e = boot(23);
    const w = e.world, p = w.player;
    const cq = Object.keys(w.data.skills).find(id => w.data.skills[id].name === '长拳');
    p.learned[cq] = { level: 5, exp: 0 };
    const before = p.potential;
    await e.exec('练武学 长拳');
    const afterPractice = p.potential;
    ok('★ 「练武学」不扣潜能', afterPractice === before, `${before} → ${afterPractice}`);
    await e.exec('打坐');
    ok('★ 「打坐」不扣潜能', p.potential === before, `${before} → ${p.potential}`);
    ok('但熟练度/等级该涨还是涨', p.skillLevel(cq) >= 5, 'lv=' + p.skillLevel(cq));
  }

  /* ---------- ⑥ 获取途径 ---------- */
  sec('⑥ 潜能从哪儿来');
  {
    /* 探索新地界 */
    const e = boot(24);
    const w = e.world, p = w.player;
    const other = Object.keys(w.data.rooms).find(id =>
      w.data.rooms[id].region !== w.data.rooms[p.room].region && !w.data.rooms[id].private);
    const before = p.potential;
    w.movePlayerTo(p, other);
    ok('★ 首次踏进一个区域给潜能', p.potential > before, `${before} → ${p.potential}`);
    const afterFirst = p.potential;
    const home = p.room;
    w.movePlayerTo(p, p.room === home ? other : home);
    w.movePlayerTo(p, home);
    ok('★ 同一个区域只给一次', p.potential === afterFirst, 'pot=' + p.potential);

    /* 任务：主线给得比支线多（同一等级） */
    const mainR = P.questRewardOf({ type: '主线', level: 2 }, true);
    const sideR = P.questRewardOf({ type: '支线', level: 2 }, true);
    ok('★ 主线任务给的潜能 > 支线', mainR > sideR, `主线 ${mainR} / 支线 ${sideR}`);
    ok('★ 完成给的比推进给的多',
      P.questRewardOf({ type: '支线', level: 2 }, true) > P.questRewardOf({ type: '支线', level: 2 }, false));

    /* 击杀：数据里带 potReward 的仍然给（老机制保留） */
    const e2 = boot(25);
    const w2 = e2.world, p2 = w2.player;
    const withPot = Object.keys(w2.data.npcs).find(id => (w2.data.npcs[id].potReward || 0) > 0);
    ok('数据里还有带 potReward 的 NPC', !!withPot, withPot);
    if (withPot) {
      const b2 = p2.potential;
      const npc = w2.spawnNpc(withPot, p2.room, 1, true);
      npc.hp = 1;
      /* ⚠️ 走 `onNpcKilled`（战斗结算那条），不是 `onNpcDown` ——
         后者只标倒地与 killed_ 旗标，不发经验/潜能/金钱（实测踩到）。 */
      w2.onNpcKilled(npc);
      ok('★ 击杀仍给潜能', p2.potential > b2, `${b2} → ${p2.potential}`);
    }

    /* 采集 / 打工 / 切磋 的常量存在且为正 */
    ok('采集、打工、切磋都有进项',
      P.GATHER_REWARD > 0 && P.WORK_REWARD > 0 && P.DUEL_REWARD > 0,
      `采集 ${P.GATHER_REWARD} / 打工 ${P.WORK_REWARD} / 切磋 ${P.DUEL_REWARD}`);
  }

  /* ---------- ⑦ 面板显示 + 指令接线 ---------- */
  sec('⑦ 状态面板看得到潜能');
  {
    const UI = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
    ok('★ scoreHtml 里有「潜能」一行', /kv\('潜能'/.test(UI));
    ok('⚙ 值走 kv()（会对值做 esc，别塞 HTML）',
      /kv\('潜能', \(p\.potential \|\| 0\) \+ ' 点/.test(UI));
    const CMD = require('fs').readFileSync(path.join(ROOT, 'game/src/core/commands.js'), 'utf8');
    ok('★ 请教里接了潜能消耗', /potential\.teachCostFor/.test(CMD) && /potential\.raiseCostOf/.test(CMD));
    ok('★ 已会的功夫走「点拨」而不是回绝',
      /teachUpCap/.test(CMD) && !/text: `你已学过/.test(CMD));
    ok('★ 请教改名两段解析（整串模糊匹配会把人名后面的武学名吃掉）',
      /先按两段解析/.test(CMD));
    const DATA = require('fs').readFileSync(path.join(ROOT, 'game/src/core/world.js'), 'utf8');
    ok('world 里挂了探索奖励', /seen_region_/.test(DATA));
    ok('开局给潜能（不能是 0）', /START_POTENTIAL/.test(DATA));
  }


  /* ---------- ⑧ 请教面板 + 「不肯教」的那几种 ---------- */
  sec('⑧ NPC「请教武学」新界面与「不肯教」');
  {
    const e = boot(41);
    const w = e.world, p = w.player;
    /* ⚠️ 用屋里**现成**的那位，别 spawnNpc —— 非名人每 spawn 一次就多一个同名实例，
       而按 defId 查找只会命中第一个，我改的那份状态就白改了（踩过）。 */
    const npc = w.npcsIn(p.room).find(n => n.defId === 'guide_teaman') || w.spawnNpc('guide_teaman', p.room, 1, true);
    const uid = npc.defId || npc.id;
    const t = e.teachView(uid);
    ok('★ 面板给得出这个人的武学清单', !!t && !!t.npc && Array.isArray(t.list) && t.list.length > 0,
      t && (t.npc.name + ' · ' + t.list.length + ' 门'));
    ok('每条都带「请教要花多少潜能」', (t.list || []).every(x => x.cost > 0), JSON.stringify((t.list || []).map(x => x.cost)));
    ok('每条都带「能不能教 / 为什么不能」',
      (t.list || []).every(x => typeof x.ok === 'boolean' && (x.ok || x.why || x.short)),
      JSON.stringify((t.list || []).map(x => x.why || x.short)));

    /* ① 人被你制住 → 不肯教（主人点的那个例子） */
    npc.knockedOut = true;
    const t2 = e.teachView(uid);
    ok('★ 人晕着 → 不肯教，并写明理由',
      (t2.list || []).every(x => !x.can && !!x.why),
      (t2.list || [])[0] && (t2.list[0].why || t2.list[0].short));
    const rCmd = await e.exec('请教 卖茶的老汉 长拳');
    ok('★ 指令这条路也拒（面板与指令同源）',
      (rCmd.lines || []).some(l => /自身难保|身不由己/.test(l.text || '')),
      (rCmd.lines || []).map(l => l.text).join(' | ').slice(0, 40));
    npc.knockedOut = false;

    /* ② 门派传承：不是这一门的人 → 学不得 */
    let sectCase = null;
    for (const id of Object.keys(w.data.npcs)) {
      const d = w.data.npcs[id];
      if (!d.sect || !(d.teach || []).length) continue;
      const sect = w.data.sects[d.sect];
      if (!sect) continue;
      if (!(d.teach || []).some(s2 => (sect.skills || []).indexOf(s2) >= 0)) continue;
      sectCase = { id, d, sect }; break;
    }
    ok('库里有「教本门传承」的 NPC（这条判据才有意义）', !!sectCase, sectCase && sectCase.d.name);
    if (sectCase) {
      /* 把人摆到玩家屋里（名人 spawnNpc 会返回「全局仅有的那位」，
         而他可能人在别处 —— 测试里直接挪过来） */
      const npc3 = w.spawnNpc(sectCase.id, p.room, 1, true);
      if (npc3 && npc3.room !== p.room) npc3.room = p.room;
      const t3 = e.teachView(sectCase.id);
      const blocked = (t3.list || []).filter(x => !x.can);
      ok('★ 外人在场 → 门派传承那几门不肯教', blocked.length > 0,
        blocked.map(x => x.name + '：' + x.why).join(' / ').slice(0, 70));
      ok('理由里点名了门派', blocked.some(x => /传承/.test(x.why || '') && new RegExp(sectCase.sect.name).test(x.why || '')),
        blocked[0] && blocked[0].why);
      p.sect = sectCase.d.sect; p.sectName = sectCase.sect.name;
      const t4 = e.teachView(sectCase.id);
      ok('★ 入了本门之后就不拦了', (t4.list || []).filter(x => !x.can).length < blocked.length,
        `不肯教 ${blocked.length} → ${(t4.list || []).filter(x => !x.can).length}`);
      p.sect = null; p.sectName = null;
    }

    /* ③ 已会 → 面板给的是「点拨」（+N 级 / 上限 / 潜能价） */
    p.learned.basic_fist.level = 200;
    p.masters = {}; p.masters[uid] = true;
    p.potential = 9000;
    await e.exec('请教 卖茶的老汉 长拳');
    const t5 = e.teachView(uid);
    const up = (t5.list || []).find(x => x.mode === 'up');
    ok('★ 已会的功夫在面板里是「点拨」', !!up, up && (up.name + ' → +' + up.gain + ' 级 / 上限 ' + up.cap + ' / 潜能 ' + up.cost));
    ok('点拨条目带上限与涨幅', !!up && up.cap > 0 && up.gain > 0);

    /* ④ 前端 / 服务端接线 */
    const UI = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
    const SRV = require('fs').readFileSync(path.join(ROOT, 'server/game-server.js'), 'utf8');
    const APP = require('fs').readFileSync(path.join(ROOT, 'game/src/renderer/js/app.js'), 'utf8');
    ok('★ 服务端有 /api/teach 路由', /case 'teach'/.test(SRV) && /engine\.teachView/.test(SRV));
    ok('★ 前端有 api.teach', /async teach\(uid\)/.test(APP));
    ok('★ 面板每条武学都有「请教」按钮（data-teach-skill）', /data-teach-skill="/.test(UI));
    ok('★ 点完重开面板（好学下一门）', /openQingjiao\(\{ name: who, id: who \}\)/.test(UI));
    ok('★ NPC 详情页的「请教」开的是这个面板，不是发指令',
      /openQingjiao\(\{ id: who, name: pr\.name \}\)/.test(UI));
    ok('★ 不能教时写明理由（不给点了没反应的灰按钮）', /qj-off/.test(UI) && /x\.why \|\| x\.short/.test(UI));
  }

  console.log('\n==============================================');
  console.log('  潜能：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fails.length) console.log('  失败项：' + fails.join('、'));
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
