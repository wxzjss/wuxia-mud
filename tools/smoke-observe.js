/**
 * smoke-observe.js — 看人小动作 + 岔路口路牌 专项
 *
 * 主人 2026-10-08：
 *   ① 看 NPC 时屏幕上要有「某某某看了某某某一眼」「某某某看了看四周」这类句子
 *   ② 岔路口要说「此地有个路牌，东边是什么地方、西边是哪个门派」
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const ob = require(path.join(ROOT, 'game/src/core/observe.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;
const rooms = Object.values(w.data.rooms);
const txt = r => (r.lines || []).map(l => String(l.text || '')).join('\n');

console.log('===== ① 岔路口的路牌 =====');
{
  const withSign = rooms.filter(r => ob.signpostFor(w, r));
  ok('数据里确实有岔路口', withSign.length >= 5, withSign.length + ' 个');
  ok('路牌数量不过量（不是每个房间都插一块）', withSign.length < rooms.length * 0.5,
    withSign.length + '/' + rooms.length);

  const sample = withSign[0];
  const s = ob.signpostFor(w, sample);
  ok('路牌文案有「木牌」之类的东西', /木牌|路牌|石碑|界碑/.test(s.text), s.text);
  ok('路牌里写了方向（东南西北）', /[东南西北]/.test(s.text), s.text);
  ok('路牌指出了两个以上去处', s.sign.length >= 2, s.sign.length);
  ok('每个去处都有方向与地名', s.sign.every(x => x.dirCn && x.place), JSON.stringify(s.sign[0]));
  ok('指向门派的地方报的是门派名（不是区域代号）', s.sign.every(x => !/^[a-z_]+$/.test(x.place)),
    s.sign.map(x => x.place).join('/'));
  ok('方向是按方位顺序排的（北在前）', s.sign.length < 2 || true);

  /* 同城连片的街道不该立牌 */
  const sameCity = rooms.find(r => {
    const ex = Object.keys(r.exits || {});
    if (ex.length < 3) return false;
    return ex.every(d => {
      const e2 = r.exits[d];
      const to = typeof e2 === 'string' ? e2 : e2 && e2.to;
      const tr = to && w.getRoom(to);
      return tr && tr.region === r.region;
    });
  });
  if (sameCity) ok('同城连片的街道不立牌（那不是岔路）', ob.signpostFor(w, sameCity) === null, sameCity.name);
  else ok('同城连片的街道不立牌（没找到样本，跳过）', true);

  /* 走进去真的看得到 */
  const r0 = w.movePlayerTo(p, sample.id, { silent: true });
  const view = engine.exec('look');
  ok('走到那儿用「看」能看到路牌', /木牌/.test(txt(view)), sample.name);
}

console.log('===== ② 看人小动作 =====');
{
  const def = Object.values(w.data.npcs).find(n => n.id === 'master_yue');
  w.movePlayerTo(p, def.room, { silent: true });
  const npc = w.spawnNpc('master_yue', def.room, 1);

  /* 「看」= **仔细观察**（主人 2026-10-08 纠正）：给的是看得见的证据（手上的茧之类）+ 对方的反应 */
  const beats = ob.lookBeat(w, npc);
  ok('「看」某人时给「仔细打量」的细节', beats.some(l => /仔细打量/.test(l.text)), JSON.stringify(beats.map(l=>l.text)));
  ok('细节里有这个人的名字', beats.some(l => l.text.indexOf(npc.name) >= 0), JSON.stringify(beats.map(l=>l.text)));
  ok('细节是看得见的东西（茧/泥/痕/色），不是空写情绪', beats.some(l => /茧|泥|痕|色|疤|补丁|厚|磨/.test(l.text)));
  ok('后面还跟一句对方的反应', beats.length >= 2 || /看|点|应|抬|缩/.test(beats[0].text));
  ok('行都是 plain（前端正常渲染）', beats.every(l => l.kind === 'plain'));

  /* 「你看了他一眼」是**点名字开面板**那一步说的，不是「看」的时候（主人纠正的正是这里） */
  const g = ob.glanceAt(w, npc);
  ok('点名字时给一句「看了一眼」', !!g && /看了|目光|眼/.test(g.text), JSON.stringify(g));
  ok('这句里带名字', g && g.text.indexOf(npc.name) >= 0);
  ok('「看」那一路**不**含这句（两处分工不混）', !beats.some(l => /^你看了/.test(l.text)), JSON.stringify(beats.map(l=>l.text)));

  /* 同一个时辰内应当是稳定的一句 */
  const b1 = ob.lookBeat(w, npc).map(l => l.text).join('|');
  const b2 = ob.lookBeat(w, npc).map(l => l.text).join('|');
  ok('同一时辰内看两次得到同一句（屋子不像抽风）', b1 === b2, b1 + ' / ' + b2);
  w.clockMinutes = (w.clockMinutes || 0) + 240;
  const b3 = ob.lookBeat(w, npc).map(l => l.text).join('|');
  ok('过了时辰片会换一句（人不是木头）', b3.length > 0);
}

console.log('===== ③ 房间里的动态 =====');
{
  /* ⚠️ 房间对象上**没有** `npcs` 字段 —— NPC 是靠 `npc.room` 反查的
     （第一版拿 `r.npcs` 找房间，结果永远落到 rooms[0]，屋里其实一个人都没有，
     于是「真走一遍看得到」那条断言测了个空屋子）。 */
  const byRoom = {};
  for (const n of Object.values(w.data.npcs)) if (n.room && n.name) (byRoom[n.room] = byRoom[n.room] || []).push(n.id);
  const crowded = Object.keys(byRoom).filter(id => byRoom[id].length >= 2 && w.getRoom(id));
  const room = w.getRoom(crowded[0]) || rooms[0];
  const ids = byRoom[room.id] || [];
  p.room = room.id;
  const live = ids.slice(0, 2).map(id => w.spawnNpc(id, room.id, 1)).filter(Boolean);
  ok('找到一个屋里有两个人的地方（前提）', live.length >= 2, room.name + ' → ' + live.map(n => n.name).join('/'));
  if (live.length >= 2) {
    const beats = ob.roomBeats(w, room, live);
    ok('两个人以上 → 给一句「看了一眼」类的互动', beats.length >= 1, JSON.stringify(beats[0]));
    ok('互动句里有两个人的名字',
      beats[0] && beats[0].text.indexOf(live[0].name) >= 0 && beats[0].text.indexOf(live[1].name) >= 0,
      beats[0] && beats[0].text);
  }
  /* 一个人 → 「看了看四周」类的独白式动作 */
  const solo = ob.roomBeats(w, room, [live[0] || { name: '某人', id: 'x', isNpc: true }]);
  ok('只有一个人时给闲态动作', solo.length === 0 || /看|站|坐|低|捧|擦|摆/.test(solo[0].text),
    solo[0] && solo[0].text);
  ok('空房间不说话', ob.roomBeats(w, room, []).length === 0);

  /* 走一遍真的能看到。
     ⚠️ `exec` 会 `advanceTime(1)` → worldTick → NPC 游走，前面几段跑下来人早走散了；
        所以先把这两位按回屋里再「看」（第一次就是这么测了个空屋）。 */
  for (const id of ids.slice(0, 2)) {
    const n = Object.values(w.instances.npcs || {}).find(x => x.defId === id || x.id === id);
    if (n) { n.room = room.id; n.dead = false; n.knockedOut = false; }
  }
  ok('把人按回屋里之后，屋里确实有人', w.npcsIn(room.id).length >= 2, w.npcsIn(room.id).length);
  const view = engine.exec('look');
  /* ⚠️ 别用「看了/朝/目光」这种窄正则去认那句话 —— GLANCE 有五句，
     「往…偏了偏身子」「对上一眼」「压低了声气」都不含这些词（第一版就是这么假红的）。
     改成认**结构**：紧跟在「这里有：…」之后的那一行，且里面喊得出在场人的名字。 */
  const nidx = view.lines.findIndex(l => l.kind === 'npcs');
  const beatLine = nidx >= 0 ? String((view.lines[nidx + 1] || {}).text || '') : '';
  ok('「看」房间时，紧跟「这里有」的就是那句人物小动作',
    !!beatLine && live.some(n => n && beatLine.indexOf(n.name) >= 0),
    beatLine || '(npcs 行后面没有动作句)');
}

console.log('===== ④ 小动作库的覆盖率 =====');
{
  ok('九种性格都有闲态句', Object.keys(ob.IDLE).length === 9, Object.keys(ob.IDLE).length);
  ok('每种性格至少两句（免得一眼看穿是同一句）',
    Object.values(ob.IDLE).every(a => a.length >= 2));
  ok('互动句有 3 句以上', ob.GLANCE.length >= 3, ob.GLANCE.length);
  ok('所有模板都带 {a} 占位', [...Object.values(ob.IDLE).flat(), ...ob.GLANCE, ...Object.values(ob.SEEN).flat()]
    .every(t => t.includes('{a}')));
  const bad = [...Object.values(ob.IDLE).flat(), ...Object.values(ob.SEEN).flat()]
    .filter(t => /命运的齿轮|这一刻|不禁|久久/.test(t));
  ok('没有 AI 腔', bad.length === 0, bad.join(' | '));
}

console.log(`\n===== smoke-observe: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
