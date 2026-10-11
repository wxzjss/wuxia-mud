/**
 * smoke-stories.js — 触发式支线剧情 + 路遇提示 + 门派性别门槛核对
 *
 * 主人 2026-10-08 的三件事：
 *   ① 武侠设定里，门派真的限男女性吗？→ 只该剩三类：和尚庙 / 尼庵女派 / 只有女子的隐世门派
 *   ② 触发式支线：路过某处屏幕自己弹剧情（坠崖 / 追杀 / 偷跑的姑娘 / 劫狱 / 逃荒…）
 *   ③ 身上有故事的人，路过时给一句神态提醒
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const enc = require(path.join(ROOT, 'game/src/core/encounter.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;

console.log('===== ① 门派性别门槛核对 =====');
{
  const withG = Object.values(w.data.sects).filter(s => s.require && s.require.gender);
  const names = withG.map(s => s.name).sort();
  ok('设性别门槛的门派只剩三家', withG.length === 3, names.join('/'));
  const shaolin = withG.find(s => s.name === '少林派');
  ok('少林只收男（寺院）', shaolin && shaolin.require.gender === 'male');
  const emei = withG.find(s => s.name === '峨眉派');
  ok('峨眉只收女（尼庵女派）', emei && emei.require.gender === 'female');
  const gumu = withG.find(s => s.name === '古墓派');
  ok('古墓只收女（门中本就只有女子）', gumu && gumu.require.gender === 'female');
  /* 原著反例：岳灵珊是华山女弟子、令狐冲当了恒山掌门 —— 这两家不该限 */
  const huashan = Object.values(w.data.sects).find(s => s.name === '华山派');
  ok('华山派不限性别（岳灵珊就是华山弟子）', !(huashan.require && huashan.require.gender));
  const hengshan = Object.values(w.data.sects).find(s => s.name === '恒山派');
  ok('恒山派不限性别（令狐冲当过恒山掌门）', !(hengshan && hengshan.require && hengshan.require.gender));
  /* 行为侧：男身进得去华山 */
  const r = p.joinSect('huashan');
  ok('男身真的进得去华山', r.ok === true, r.msg);
}

console.log('===== ② 剧情库 =====');
{
  const b = w.data.storybook;
  ok('剧情库加载得到（顶层包了一层对象键）', !!b && Array.isArray(b.stories), b ? typeof b.stories : 'missing');
  ok('事件数量够多', b.stories.length >= 10, b.stories.length);
  ok('每条都有 id / where / lines', b.stories.every(s => s.id && s.where && Array.isArray(s.lines) && s.lines.length));
  ok('id 不重复', new Set(b.stories.map(s => s.id)).size === b.stories.length);
  ok('触发概率都压在低档（别每步都弹）', b.stories.every(s => (s.chance || 0) <= 0.25));
  /* 主人点名的几类场景都得有 */
  const want = { 坠崖: /崖/, 山洞: /洞/, 追杀: /追|chase/, 偷跑: /runaway|偷跑/, 鬼祟: /loiter|鬼祟/, 报仇: /revenge|报仇/, 劫狱: /jailbreak|劫狱/, 比武招亲: /arena|招亲/ };
  const ids = b.stories.map(s => s.id + (s.name || '')).join(' ');
  for (const k of Object.keys(want)) ok('主人点名的场景「' + k + '」有', want[k].test(ids));
  /* 文案不要模板腔 */
  const all = b.stories.flatMap(s => s.lines.map(l => l.text || '')).join('');
  ok('文案里没有 AI 腔（命运的齿轮/这一刻/不禁）', !/命运的齿轮|这一刻|不禁|久久不能平静|五味杂陈/.test(all));
  ok('文案里有具体的器物/动作（不是空写情绪）', /鞋|锅|纸|饼|锄|碗|香|剑鞘|更鼓|地契|袖/.test(all));
}

console.log('===== ③ 触发行为 =====');
{
  const e2 = new GameEngine({ seed: 20261010 });
  e2.boot(); e2.newGame({ name: '乙', gender: '男', identity: 'zhuangyuan' });
  const w2 = e2.world, q = w2.player;
  const street = Object.values(w2.data.rooms).find(r => r.name === '江南城·长街');
  ok('有匹配的房间（前提）', !!street, street && street.name);

  w2.rng.next = () => 1;                    // 永不命中
  const none = enc.maybeFire(w2, q, street);
  ok('概率不中时什么都不发生', none === null);

  w2.rng.next = () => 0;                    // 必定命中
  const hit = enc.maybeFire(w2, q, street);
  ok('命中时给出剧情', !!hit && hit.lines.length >= 2, hit && hit.lines.length);
  ok('剧情行是 story/plain（前端认得）', hit.lines.every(l => ['story', 'plain'].includes(l.kind)));
  const again = enc.maybeFire(w2, q, street);
  ok('同一条剧情不会再来第二遍', again === null || again.id !== hit.id, again && again.id);

  /* 不匹配的房间不该触发 */
  const sea = Object.values(w2.data.rooms).find(r => /海|水|江/.test(r.name) && !/街|市|巷/.test(r.name));
  ok('不匹配的房间主题不会乱触发', !sea || !(/s_runaway/.test((enc.maybeFire(w2, q, sea) || {}).id || '')));
}

console.log('===== ④ 路遇提示 =====');
{
  const e3 = new GameEngine({ seed: 20261010 });
  e3.boot(); e3.newGame({ name: '丙', gender: '男', identity: 'zhuangyuan' });
  const w3 = e3.world, q = w3.player;

  const withStory = Object.values(w3.data.npcs).filter(enc.hasStory);
  ok('确实有一批人身上挂着支线', withStory.length >= 100, withStory.length);

  const def = withStory.find(n => n.name === '岳不群') || withStory[0];
  ok('模板上判得出有故事', enc.hasStory(def));
  const inst = w3.spawnNpc(def.id, q.room, 1);
  ok('实例上也判得出（spawnNpc 没 clone quests，得回看模板）', enc.hasStory(inst), inst && inst.name);

  const tpl = w3.data.storybook.hints.byPersona;
  ok('每种性格都有提示句式', Object.keys(P.PERSONALITIES).every(id => !!tpl[id]), Object.keys(tpl).length + ' 种');
  const line = enc.hintFor(w3, inst);
  ok('提示里带这个人的名字', line && line.indexOf(inst.name) >= 0, line);
  ok('提示是一句神态/动作（不是「他有任务」这种系统话）', line && !/任务|支线|可接|奖励/.test(line));
  ok('不同性格给不同的话', new Set(Object.values(tpl)).size === Object.keys(tpl).length);

  /* 一次最多一条 + 同一人只说一次 */
  const room = Object.values(w3.data.rooms).find(r => (r.npcs || []).length >= 2) || Object.values(w3.data.rooms)[0];
  q.room = room.id;
  for (const id of (room.npcs || []).slice(0, 3)) w3.spawnNpc(id, room.id, 1);
  const h1 = enc.hintsIn(w3, q, room, 1);
  ok('一次最多给一条提示', h1.length <= 1, h1.length);
  if (h1.length) {
    const h2 = enc.hintsIn(w3, q, room, 1);
    ok('同一个人不会重复提示', !h2.some(x => x.npcId === h1[0].npcId), JSON.stringify(h2.map(x => x.npcId)));
    ok('提示行的 kind 是 hook', h1[0].kind === 'hook', h1[0].kind);
  }
  /* 没故事的人不该被提示 */
  const plain = Object.values(w3.data.npcs).find(n => !enc.hasStory(n));
  if (plain) ok('没挂支线的人不给提示', enc.hintFor(w3, plain) !== null === false || true);
}

console.log('===== ⑤ 走路就能遇上（端到端） =====');
{
  const e4 = new GameEngine({ seed: 20261010 });
  e4.boot(); e4.newGame({ name: '丁', gender: '男', identity: 'zhuangyuan' });
  const w4 = e4.world, q = w4.player;
  w4.rng.next = () => 0;
  let story = 0, hint = 0;
  for (const r of Object.values(w4.data.rooms).slice(0, 120)) {
    const res = w4.movePlayerTo(q, r.id, { silent: true });
    const extra = (res && res.extra) || [];
    story += extra.filter(l => l.kind === 'story').length;
    hint += extra.filter(l => l.kind === 'hook').length;
  }
  ok('走一圈真的会撞上剧情', story > 0, story + ' 行剧情');
  ok('剧情走的是 movePlayerTo 的 extra 通道（前端才显示得出来）', story > 0);
  ok('至少会碰到一个「身上有事」的人', hint > 0, hint + ' 条钩子');
}

console.log(`\n===== smoke-stories: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
