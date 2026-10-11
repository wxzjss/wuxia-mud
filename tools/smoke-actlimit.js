/* ============================================================
 * smoke-actlimit.js — 房间动作的限次（`once` / `oncePerDay`）
 *
 * 来由（主人 2026-10-11）：
 *   「重阳宫那里有个论道会无限获得潜能点的改一下」。
 *   查下来不止重阳宫 —— 全地图 16 个「参悟/观景」型动作都能原地连点无限刷。
 *
 * ⚠️ 这条断言要能抓住**两类**回归：
 *   ① 限次机制本身失效（连点两次都给收益）
 *   ② 记账没进存档（读档后又能刷一遍）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};

const eng = new GameEngine({ seed: 20261011 });
eng.boot();
eng.newGame({ name: '测试侠客', gender: 'male' });
const w = eng.world;
const p = w.player;

function go(roomId) { p.room = roomId; }
function act(cmd) { return eng.exec(cmd); }
function txt(r) {
  return ((r && (r.lines || r.log)) || []).map(l => l.text || '').join(' ');
}
function mpMax() { return p.maxMp; }

console.log('\n① 限次数据齐备');
{
  const rooms = w.data.rooms;
  const onceActs = [], dayActs = [];
  for (const id of Object.keys(rooms)) {
    for (const a of (rooms[id].actions || [])) {
      if (a.once) onceActs.push(id + '|' + a.cmd);
      if (a.oncePerDay) dayActs.push(id + '|' + a.cmd);
    }
  }
  ok('★ 有房间动作声明了 once（一辈子一次）', onceActs.length >= 10, onceActs.length + ' 处');
  ok('★ 有房间动作声明了 oncePerDay（每天一次）', dayActs.length >= 1, dayActs.join(', '));
  ok('★ 重阳宫的「论道」已改成每天一次', dayActs.some(x => x.indexOf('gumu_quanzhen') >= 0),
    dayActs.filter(x => x.indexOf('gumu_quanzhen') >= 0).join(',') || '（没找到）');
  ok('★ 全库不再有 +pot 效果（潜能已废除）', !JSON.stringify(rooms).includes('"+pot"'));
}

console.log('\n② 一次性动作：只有第一次给收益');
{
  /* ⚠️ 挑动作要挑**没有 cond** 的：带 cond 的（如侠客岛石壁要悟性≥25、
        古墓心经要女性）会先被 cond 拦下，测不到限次这条路径 —— 第一版就挑错了。 */
  const ROOM = 'xiake_neike';              // 侠客岛·内堂 研究图谱（原 +pot 600，无条件）
  go(ROOM);
  const a = (w.data.rooms[ROOM].actions || [])[0];
  const first = mpMax();
  const r1 = txt(act(a.cmd));
  const afterFirst = mpMax();
  const r2 = txt(act(a.cmd));
  const afterSecond = mpMax();
  ok('★ 第一次参悟给到内力上限', afterFirst > first, first + ' → ' + afterFirst);
  ok('★ 第二次参悟被拦住（不是又给一遍）', afterSecond === afterFirst,
    '第二次后仍是 ' + afterSecond);
  ok('★ 拦下来时给的是明确提示，不是静默', /悟透|新得/.test(r2), r2.slice(0, 30));
  ok('★ 第一次确实有台词', r1.length > 0, r1.slice(0, 24));
}

console.log('\n③ 每日一次：当天只给一回，隔天恢复');
{
  const ROOM = 'gumu_quanzhen';            // 重阳宫 论道
  go(ROOM);
  const a = (w.data.rooms[ROOM].actions || [])[0];
  p.mp = 0;
  const r1 = txt(act(a.cmd));
  const mp1 = p.mp;
  p.mp = 0;
  const r2 = txt(act(a.cmd));
  ok('★ 当天第一回有效', mp1 > 0, '内力恢复到 ' + mp1);
  ok('★ 当天第二回被拦住', p.mp === 0, '内力仍是 0');
  ok('★ 拦住时的提示说的是「明日再来」', /明日|今日/.test(r2), r2.slice(0, 30));
  /* 拨到第二天 */
  p.mp = 0;
  w.clockMinutes += 1440;
  act(a.cmd);
  ok('★ 到第二天又能做一回了', p.mp > 0, '内力恢复到 ' + p.mp);
}

console.log('\n④ 限次记账必须随档走（否则读档=重置）');
{
  const room = 'taohuadao_zhu';   // 桃花岛·竹林 观竹（无条件）
  go(room);
  const a = (w.data.rooms[room].actions || [])[0];
  act(a.cmd);
  const usedAfter = Object.keys(p.actionUsed || {}).length;
  ok('★ 做过之后账本上有记录', usedAfter > 0, usedAfter + ' 条');
  const save = w.serialize();
  ok('★ 存档里带着账本', save.player.actionUsed && Object.keys(save.player.actionUsed).length > 0,
    JSON.stringify(save.player.actionUsed).slice(0, 60));
  const before = mpMax();
  const r = txt(act(a.cmd));
  ok('★ 读档前再点是拦住的', mpMax() === before);
}

console.log(`\n===== smoke-actlimit: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
