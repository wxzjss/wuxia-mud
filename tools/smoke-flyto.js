/* ============================================================
 * smoke-flyto.js — 「飞往」：去过的地方才能飞到它的入口
 *
 * 主人 2026-10-11：「地图里有一个『飞往』……可以改成玩家去过的城市都可以
 *   飞到该城市入口处，门派也是一样入口处，前提是玩家去过那里」。
 *
 * ⚠️ 这条最该钉住的是**「没去过不许飞」**这条闸 ——
 *   它一漏，整个江湖的走路就白设计了（想去哪点哪）。
 *   所以「没去过 → 拒绝」与「去过 → 落地」必须成对断言。
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
const txt = (r) => ((r && r.lines) || []).map(l => l.text || '').join(' ');

const eng = new GameEngine({ seed: 4242 });
eng.boot();
eng.newGame({ name: '测试侠客', gender: 'male' });
const w = eng.world, p = w.player;

console.log('\n① 区域入口数据齐备（飞的目标必须真实存在）');
{
  const regs = Object.values(w.data.regions || {});
  /* ⚠️ 不要求「每个区域都写 entry」—— 官方示例 Mod（听雨山庄）与玩家自制 Mod 都不会写。
     要求改成了「有 entry 就必须指向真房间」，另外单独测「没写时的回落」。
     把「必填字段」当断言是最容易挡住 Mod 的那类过严测试。 */
  const badEntry = regs.filter(r => r.entry && !w.getRoom(r.entry));
  const noEntry = regs.filter(r => !r.entry);
  ok('★ 写了 entry 的区域，entry 都指向真实房间', badEntry.length === 0,
    badEntry.length ? badEntry.map(r => r.name + '→' + r.entry).join(', ') : '（全部命中）');
  ok('★ 没写 entry 的区域能回落到本区第一个房间（Mod 友好）',
    noEntry.every(r => Object.values(w.data.rooms).some(x => x.region === r.id)),
    noEntry.length ? noEntry.map(r => r.name).join(', ') + '（走回落）' : '全部自带 entry');
  ok('★ 每个 entry 都指向真实房间（写错就是飞进虚空）', badEntry.length === 0,
    badEntry.length ? badEntry.map(r => r.name + '→' + r.entry).join(', ') : '（全部命中）');
}

console.log('\n② 没去过 → 不许飞');
{
  const R = 'huashan';
  const r = w.data.regions[R];
  p.room = 'cunzhen_gate';                       // 随便站个青溪村
  const r1 = txt(eng.exec('飞往 ' + r.name));
  ok('★ 没去过时被拒绝', p.room === 'cunzhen_gate', '仍在 ' + p.room);
  ok('★ 拒绝时说明原因（不是静默不动）', /没去过|不认得|走一趟/.test(r1), r1.slice(0, 34));
}

console.log('\n③ 去过 → 落到该区域入口');
{
  const R = 'huashan';
  const r = w.data.regions[R];
  p.setFlag('visited_' + r.entry, true);          // 假装去过华山山门下
  const r1 = txt(eng.exec('飞往 ' + r.name));
  ok('★ 去过就能飞', p.room === r.entry, '落到 ' + p.room + '（' + w.getRoom(r.entry).name + '）');
  ok('★ 落地的就是 entry 那个房间', p.room === r.entry);
  ok('★ 有到达提示', /来到|到了/.test(r1), r1.slice(0, 34));
}

console.log('\n④ 认地名：正式名 / 区域 id / 简称都能认');
{
  const r = w.data.regions['wudang'];
  p.setFlag('visited_' + r.entry, true);
  p.room = 'cunzhen_gate';
  eng.exec('飞往 wudang');
  const byId = p.room === r.entry;
  p.room = 'cunzhen_gate';
  eng.exec('飞往 ' + r.name);
  const byName = p.room === r.entry;
  ok('★ 用区域 id 能飞', byId);
  ok('★ 用中文地名能飞', byName);
  const r2 = txt(eng.exec('飞往 南极仙翁的洞府'));
  ok('★ 不存在的地名给明确答复', /没有叫/.test(r2), r2.slice(0, 30));
}

console.log('\n⑤ 战斗中不许飞（否则打不过就跑，逃命指令白设计了）');
{
  const r = w.data.regions['emei'];
  p.setFlag('visited_' + r.entry, true);
  p.room = 'cunzhen_gate';
  const before = p.room;
  /* ⚠️ 造的假战斗必须满足 combatView 读的字段（defenders 里每个要有 buffs 数组），
     否则 exec 收尾渲染 view 时就炸 —— 那是测试自己的锅，不是功能的锅。 */
  w.battle = {
    round: 1,
    attackers: [p],
    defenders: [{
      id: 'dummy', name: '拦路的道士', title: '', level: 1, hp: 10, maxHp: 10,
      mp: 0, maxMp: 0, buffs: [],
    }],
  };
  const r3 = txt(eng.exec('飞往 ' + r.name));
  delete w.battle;
  ok('★ 战斗中飞不动', p.room === before, '仍在 ' + p.room);
  ok('★ 给出了原因', /交手|走不脱/.test(r3), r3.slice(0, 30));
  /* 提示语里不许再出现英文指令（主人 2026-10-11 的同类要求） */
  ok('★ 战斗提示用的是中文指令', !/「(kill|auto|perform|defend|flee)\b/.test(r3), r3.slice(24, 66));
}

console.log('\n⑥ 地图面板下发的 regions 带得上「能不能飞」');
{
  const v = eng.view('map');
  const m = v && v.map ? v.map : v;
  const regs = (m && m.regions) || [];
  ok('★ 每个区域带 entry / entryName / canFly',
    regs.length > 0 && regs.every(x => ('canFly' in x) && ('entry' in x)),
    regs.length + ' 个区域');
  const r = w.data.regions['shaolin'];
  p.setFlag('visited_' + r.entry, true);
  const v2 = eng.view('map');
  const m2 = v2 && v2.map ? v2.map : v2;
  const row = (m2.regions || []).find(x => x.id === 'shaolin');
  ok('★ 去过之后 canFly 变 true', row && row.canFly === true,
    row ? (row.name + ' canFly=' + row.canFly + ' entry=' + row.entryName) : '（找不到少林行）');
  const row2 = (m2.regions || []).find(x => x.id === 'xiyu');
  ok('★ 没去过的仍是 false', row2 && row2.canFly === false,
    row2 ? row2.name + ' canFly=' + row2.canFly : '（找不到西域行）');
}

console.log(`\n===== smoke-flyto: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
