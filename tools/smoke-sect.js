/* ============================================================
 * smoke-sect.js — 玩家自建宗门（武学重制 S2）回归测试
 *
 * 覆盖：
 *  ① 创宗（钱不够/成功/重复被拒）
 *  ② 招贤 / 逐出
 *  ③ 演武（内力不足/成功加威望）
 *  ④ 门派大比（无人被拒/约战不崩）
 *  ⑤ 解散（摘山门房间+清 mySect）
 * ============================================================ */
'use strict';

const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261009;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '宗主', gender: 'male', birth: 'wuxue' }); return e; }

/* ============================================================ */
section('① 创宗');
{
  const e = boot(); const w = e.world, p = w.player;
  p.money = 100;
  let r = e.exec('创宗 凌霄阁');
  ok('钱不够被拒', !r.lines.some(l => l.kind === 'title'), JSON.stringify(r.lines.map(l => l.text)));

  p.money = 6000;
  r = e.exec('创宗 凌霄阁');
  ok('成功创立', !!p.mySect && p.mySect.name === '凌霄阁');
  ok('p.sect 指向自建宗门', p.sect === p.mySect.id);
  ok('开办银已扣', p.money === 1000, 'money=' + p.money);
  ok('山门房间已建', !!p.mySect.base && !!w.getRoom(p.mySect.base));
  ok('山门挂进 p.homes（随档走）', (p.homes || []).some(h => h.id === p.mySect.base));

  r = e.exec('创宗 另一宗');
  ok('重复创宗被拒', !r.lines.some(l => l.kind === 'title'));
}

/* ============================================================ */
section('② 招贤 / 逐出');
{
  const e = boot(); const w = e.world, p = w.player;
  p.money = 6000; e.exec('创宗 凌霄阁');
  // 弄个真实 NPC 到玩家房间
  const defId = Object.keys(w.data.npcs).find(id => w.data.npcs[id].name && !w.data.npcs[id].isBoss);
  w.spawnNpc(defId, p.room, 1, true);
  const npc = w.npcsIncludingTemplates(p.room).find(n => n.defId === defId);
  const favBefore = npc.favor || 0;

  let r = e.exec('招贤 ' + npc.name);
  ok('招贤成功', p.mySect.members.includes(defId), JSON.stringify(r.lines.map(l => l.text)));
  ok('被招者好感 +20', (npc.favor || 0) - favBefore === 20);

  r = e.exec('招贤 ' + npc.name);
  ok('重复招贤被拒', !r.lines.some(l => l.kind === 'sys'));

  r = e.exec('逐出 ' + npc.name);
  ok('逐出成功', !p.mySect.members.includes(defId));
}

/* ============================================================ */
section('③ 演武');
{
  const e = boot(); const w = e.world, p = w.player;
  p.money = 6000; e.exec('创宗 凌霄阁');
  const defId = Object.keys(w.data.npcs).find(id => w.data.npcs[id].name && !w.data.npcs[id].isBoss);
  w.spawnNpc(defId, p.room, 1, true);
  e.exec('招贤 ' + w.data.npcs[defId].name);

  p.mp = 10;
  let r = e.exec('演武');
  ok('内力不足被拒', !r.lines.some(l => l.kind === 'title'));

  p.mp = 100;
  w.worldTick = () => {}; // 隔离动态世界事件，专测演武逻辑
  const presBefore = p.mySect.prestige;
  r = e.exec('演武');
  ok('演武成功（威望 +8）', p.mySect.prestige === presBefore + 8, 'prestige=' + p.mySect.prestige);
  ok('演武次数累计', p.mySect.drills === 1);
}

/* ============================================================ */
section('④ 门派大比');
{
  const e = boot(); const w = e.world, p = w.player;
  p.money = 6000; e.exec('创宗 凌霄阁');
  let r = e.exec('大比');
  ok('无人被拒', !r.lines.some(l => l.kind === 'title'));

  const defId = Object.keys(w.data.npcs).find(id => w.data.npcs[id].name && !w.data.npcs[id].isBoss);
  w.spawnNpc(defId, p.room, 1, true);
  e.exec('招贤 ' + w.data.npcs[defId].name);
  p.mySect.prestige = 0;
  r = e.exec('大比');
  ok('约战不崩且返回结果', r.lines.some(l => l.kind === 'title'));
  ok('战绩有累计（胜或负）', p.mySect.wins + p.mySect.losses === 1, `wins=${p.mySect.wins} losses=${p.mySect.losses}`);
}

/* ============================================================ */
section('⑤ 解散宗门');
{
  const e = boot(); const w = e.world, p = w.player;
  p.money = 6000; e.exec('创宗 凌霄阁');
  const base = p.mySect.base;
  e.exec('解散宗门');
  ok('mySect 清空', p.mySect === null);
  ok('p.sect 复位', p.sect === null);
  ok('山门房间已摘', !w.getRoom(base));
  ok('p.homes 不再含山门', !(p.homes || []).some(h => h.id === base));
}

/* ============================================================ */
console.log(`\n=== 自建宗门 smoke: ${pass} 通过 / ${fail} 失败 ===`);
process.exit(fail ? 1 : 0);
