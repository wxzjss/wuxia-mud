/* ============================================================
 * smoke-flyto.js — 「飞往」：练成轻功就能飞，远处费内力
 *
 * 口径变更（主人 2026-10-13）：
 *   > 「让飞行现在不限制必须先去到某个区域。」
 *
 * 老规矩是「必须 `visited_<entry>`（去过那个门口）」，现已拆掉。换成两道武侠里
 * 本来就有的门槛：
 *   ① 脚下得有轻功（`learned` 里至少一门 `type:'轻功'`）—— 不会轻功飞不起来；
 *   ② 内力要够 —— 远路费内力，够不到就落不了地。
 *
 * 所以「没去过但有轻功 → 能飞」与「有轻功但内力不足 → 拒绝」必须成对断言；
 * 前者钉住「去过」这道闸真的拆了，后者钉住「内力」不是摆设。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const flight = require(path.join(ROOT, 'game', 'src', 'core', 'flight.js'));

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

/* 找一门能学的轻功（开局 learned 只有拳脚/内功） */
const qinggongId = Object.values(w.data.skills).find(s => s.type === '轻功' && s.base === 'basic_fist' || (s.type === '轻功' && !s.base)).id;
const learnQG = () => { p.learned[qinggongId] = { exp: 0, level: 1 }; w.getSkill(qinggongId); };

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
}

console.log('\n② 不会轻功 → 飞不起来（不再用「没去过」当理由）');
{
  const r = w.data.regions['huashan'];
  p.room = 'cunzhen_gate';
  delete p.flags['visited_' + r.entry];      // 明确「没去过」
  const r1 = txt(eng.exec('飞往 ' + r.name));
  ok('★ 不会轻功时被拒绝', p.room === 'cunzhen_gate', '仍在 ' + p.room);
  ok('★ 理由说的是「轻功」，不是「没去过」', /轻功/.test(r1) && !/没去过/.test(r1), r1.slice(0, 40));
  ok('★ 顺手告诉玩家上哪儿学轻功', /梯云纵|逍遥游|轻功/.test(r1), r1.slice(0, 70));
}

console.log('\n③ 学会轻功 → 没去过也照样飞（老闸已拆）');
{
  const r = w.data.regions['huashan'];
  ok('★ 前提：真的没去过华山', !p.hasFlag('visited_' + r.entry));
  learnQG();
  p.mp = p.maxMp = 999;                        // 先给足内力，③ 只验「去过」这道闸没了
  const r1 = txt(eng.exec('飞往 ' + r.name));
  ok('★ 没去过也能飞到入口', p.room === r.entry, '落到 ' + p.room + '（' + w.getRoom(r.entry).name + '）');
  ok('★ 落地的就是 entry 那个房间', p.room === r.entry);
  ok('★ 有到达提示', /来到|到了/.test(r1), r1.slice(0, 40));
  ok('★ 落地后自动记下「去过」', !!p.hasFlag('visited_' + r.entry));
}

console.log('\n④ 认地名：正式名 / 区域 id / 简称都能认');
{
  const r = w.data.regions['wudang'];
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

console.log('\n⑤ 内力是燃料：远路耗内力，内力不够落不了地');
{
  const r = w.data.regions['xiyu'];
  p.room = 'cunzhen_gate';
  const steps = flight.stepDistance(w, p.room, r.entry);
  const cost = flight.flightCost(p, w, steps);
  ok('★ 算出西行的步数与耗力', steps > 0 && cost > 0, steps + ' 步 / ' + cost + ' 点内力');
  p.mp = Math.max(0, cost - 1);                // 差一口气
  const before = p.room;
  const r1 = txt(eng.exec('飞往 ' + r.name));
  ok('★ 内力不够时被拒绝', p.room === before, '仍在 ' + p.room);
  ok('★ 说清要多少、自己还剩多少', new RegExp('要?\\s*' + cost + '.*内力').test(r1) && new RegExp('剩').test(r1), r1.slice(0, 50));
  ok('★ 给出恢复办法', /打坐|客栈/.test(r1), r1.slice(0, 80));
  p.mp = cost;                                 // 刚好够
  eng.exec('飞往 ' + r.name);
  ok('★ 够内力就飞得到', p.room === r.entry, '落到 ' + p.room);
  ok('★ 飞完内力真的扣了', Math.floor(p.mp) === 0, '余 ' + Math.floor(p.mp));
}

console.log('\n⑥ 轻功越深，同样路程越省（门槛不是一刀切）');
{
  const steps = 30;
  p.learned[qinggongId] = { exp: 0, level: 1 };
  const c1 = flight.flightCost(p, w, steps);
  p.learned[qinggongId] = { exp: 0, level: 60 };
  const c2 = flight.flightCost(p, w, steps);
  ok('★ 高阶轻功更省内力', c2 < c1, 'lv1=' + c1 + ' → lv60=' + c2);
  p.learned[qinggongId] = { exp: 0, level: 1 };
}

console.log('\n⑦ 战斗中不许飞（否则打不过就跑，逃命指令白设计了）');
{
  const r = w.data.regions['emei'];
  p.mp = 999;
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

console.log('\n⑧ 地图面板下发的 regions 带得上「能不能飞」（与后端同源）');
{
  const v = eng.view('map');
  const m = v && v.map ? v.map : v;
  const regs = (m && m.regions) || [];
  ok('★ 每个区域带 entry / entryName / canFly / flyReason',
    regs.length > 0 && regs.every(x => ('canFly' in x) && ('entry' in x) && ('flyReason' in x)),
    regs.length + ' 个区域');
  const r = w.data.regions['shaolin'];
  p.mp = 999;
  const v2 = eng.view('map');
  const m2 = v2 && v2.map ? v2.map : v2;
  const row = (m2.regions || []).find(x => x.id === 'shaolin');
  ok('★ 学会轻功后 canFly 变 true（不再看「去过没有」）', row && row.canFly === true,
    row ? (row.name + ' canFly=' + row.canFly + ' 耗' + row.flyCost + ' 步' + row.flySteps) : '（找不到少林行）');
  /* 内力抽干 ⇒ 同一行仍带得出「差多少」，前端据此给话 */
  const savedMp = p.mp;
  p.mp = 0;
  const m3 = (() => { const x = eng.view('map'); return x && x.map ? x.map : x; })();
  const row3 = (m3.regions || []).find(x => x.id === 'shaolin');
  ok('★ 内力不足时 canFly=false 且 flyReason 说清差多少',
    row3 && row3.canFly === false && /还差/.test(row3.flyReason || ''),
    row3 ? row3.flyReason : '（找不到少林行）');
  p.mp = savedMp;
}

console.log('\n⑨ 不会轻功时地图视图要给出可执行的理由（前端拿不到 learned）');
{
  for (const k of Object.keys(p.learned)) if (w.getSkill(k) && w.getSkill(k).type === '轻功') delete p.learned[k];
  p.mp = 999;
  const m4 = (() => { const x = eng.view('map'); return x && x.map ? x.map : x; })();
  const rows = (m4.regions || []);
  ok('★ 全部 canFly=false', rows.every(x => x.canFly === false));
  /* ⚠️ 脚下这一处不是「飞不到」，是「已经站在那儿」—— 别把它算进「轻功」那批。
     否则这条断言在玩家刚开局的默认位置（江南）永远假红。 */
  const other = rows.filter(x => x.entry !== p.room);
  ok('★ 别处的理由里说的是轻功', other.length > 0 && other.every(x => /轻功/.test(x.flyReason || '')),
    (other[0] && other[0].flyReason) || '');
  ok('★ 脚下这一处说「已经站在那儿」',
    (rows.find(x => x.entry === p.room) || {}).flyReason === '你已经站在那儿了。');
  learnQG();
}

console.log(`\n===== smoke-flyto: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
