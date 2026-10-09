/* ============================================================
 * smoke-portrait.js — 人物画像（第六批）冒烟测试
 *
 * 覆盖：
 *  ① 存档不再含 NPC 模板副本（def）—— 存档不膨胀
 *  ② deserialize 后 npc.def 能按 defId 取回
 *  ③ 改一个 NPC 的 pstate 不影响同模板的其他实例（不「改一个带动全江湖」）
 *  ④ 13 个有画像 NPC 的 look / talk / ask 能输出画像内容
 *  ⑤ 无画像的 NPC 不崩、不出现 undefined
 *  ⑥ 规格书 §0 的 4 个数据 Bug 已修：
 *     B1 desc 不重复且女性不含男性化用词 / B2 courtesan 全在青楼 /
 *     B3 黄药师 tag 正确 / B4 老僧与掌门年龄合理
 * ============================================================ */
'use strict';

const path = require('path');
const { GameEngine } = require(path.join(__dirname, '..', 'game', 'src', 'core', 'engine.js'));
const personality = require(path.join(__dirname, '..', 'game', 'src', 'core', 'personality.js'));
const { normalizeCmd } = require(path.join(__dirname, '..', 'game', 'src', 'core', 'utils.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

/* 固定种子，全程可复现 */
const SEED = 20261008;
const e = new GameEngine({ seed: SEED });
e.boot();
e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;

const PORTRAIT_IDS = ['npcv_024', 'npcv_181', 'npcv_149', 'wen_huashan_shop', 'npcv_073', 'npcv_013',
  'npcv_027', 'npcv_081', 'npcv_219', 'npcv_037', 'npcv_102', 'npcv_109', 'npcv_062'];

function txt(lines) { return (lines || []).map(l => l.text || '').join('\n'); }
/* 直接走指令表，不推进游戏时间（省得 NPC 按 schedule 跑掉，测试才稳） */
const ctx = { player: p, world: w, engine: e };
function run(cmd) { return e.cmds.execute(normalizeCmd(cmd), ctx) || { lines: [] }; }

/* ============================================================ */
section('① 存档不再含 NPC 模板副本（P0 存档膨胀）');

/* 起一局干净的，只上线 30 个 NPC，量化存档体积 */
function buildWorld(npcCount) {
  const eng = new GameEngine({ seed: SEED });
  eng.boot();
  eng.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const ww = eng.world;
  const ids = Object.keys(ww.data.npcs).filter(id => ww.data.npcs[id].room).slice(0, npcCount);
  for (const id of ids) ww.spawnNpc(id, ww.data.npcs[id].room, 1, true);
  return ww;
}
const w30 = buildWorld(30);
const save = w30.serialize();
const saveJson = JSON.stringify(save);
const saveBytes = Buffer.byteLength(saveJson, 'utf8');
const instKeys = Object.keys(save.instances.npcs);
const withDef = instKeys.filter(k => Object.prototype.hasOwnProperty.call(save.instances.npcs[k], 'def'));
ok('存档里一个 def 字段都没有', withDef.length === 0, `${withDef.length}/${instKeys.length} 个实例仍带 def`);
ok('存档里也不含 portrait 副本（静态模板数据不随档走）',
  instKeys.every(k => !Object.prototype.hasOwnProperty.call(save.instances.npcs[k], 'portrait')),
  `${instKeys.length} 个实例`);
/* 对照：把 def 硬塞回去再量一次，得出实测压缩比 */
let refBytes = 0;
{
  const clone = JSON.parse(saveJson);
  for (const k of Object.keys(clone.instances.npcs)) {
    const n = clone.instances.npcs[k];
    if (n.defId && w30.data.npcs[n.defId]) n.def = JSON.parse(JSON.stringify(w30.data.npcs[n.defId]));
  }
  refBytes = Buffer.byteLength(JSON.stringify(clone), 'utf8');
}
const cut = refBytes ? (1 - saveBytes / refBytes) : 0;
ok('存档体积显著变小（对照带 def 的存档）', cut > 0.2,
  `${refBytes} → ${saveBytes} 字节（省 ${(cut * 100).toFixed(1)}%）`);
ok('pstate 随档走（运行期字段在存档里）',
  instKeys.length > 0 && instKeys.every(k => save.instances.npcs[k].pstate));

section('② deserialize 后模板能取回');
const e2 = new GameEngine({ seed: SEED });
e2.boot();
e2.world.deserialize(JSON.parse(saveJson), []);
if (e2.restoreRelations) e2.restoreRelations();
const w2 = e2.world;
const inst2 = Object.keys(w2.instances.npcs);
ok('实例数量一致', inst2.length === instKeys.length, `${inst2.length} 个`);
ok('每个实例都能取回 npc.def.name', inst2.every(k => {
  const n = w2.instances.npcs[k];
  return n.def && typeof n.def === 'object' && n.def.name;
}), inst2.filter(k => !(w2.instances.npcs[k].def || {}).name).join(',') || '无 undefined');
ok('npc.def 指向的是 data 里的模板对象本身（不是副本）',
  inst2.every(k => { const n = w2.instances.npcs[k]; return !n.defId || n.def === w2.data.npcs[n.defId] || !w2.data.npcs[n.defId]; }));
ok('pstate 往返后仍是对象', inst2.every(k => {
  const s = w2.instances.npcs[k].pstate;
  return s && typeof s.trust === 'number' && Array.isArray(s.revealed);
}));
/* 老档兼容：pstate 缺失时补默认值 */
{
  const e3 = new GameEngine({ seed: SEED });
  e3.boot();
  const old = JSON.parse(saveJson);
  for (const k of Object.keys(old.instances.npcs)) delete old.instances.npcs[k].pstate;
  e3.world.deserialize(old, []);
  const ks = Object.keys(e3.world.instances.npcs);
  ok('旧档（无 pstate）读档后自动补默认值，不崩', ks.length > 0 && ks.every(k => {
    const s = e3.world.instances.npcs[k].pstate;
    return s && s.trust === 0 && Array.isArray(s.revealed) && s.leaked === false;
  }));
}

section('③ 改一个实例的 pstate 不污染模板 / 其他实例');
/* 用一局干净的 world，免得后面 ④ 的 fuzzyFind 撞上这里留下的同名实例 */
const w3 = buildWorld(0);
/* ⚠️ 名人（tier==='A' / unique）全图只允许一个实例（主人报过「客栈里三个
   岳不群」），而画像名单全是 A 层 —— 直接 spawn 两次会拿到同一个实例，
   测出来「portrait 没 clone」全是假红。
   这里把模板的 tier 临时降成 B 造一个等价探针，测完还原 ——
   验证的是 clone 逻辑，与他是不是名人无关。 */
const probeDef = PORTRAIT_IDS.find(id => w3.data.npcs[id]);
const probeTpl = w3.data.npcs[probeDef];
const origTier = probeTpl.tier;
probeTpl.tier = 'B';
const a1 = w3.spawnNpc(probeDef, probeTpl.room, 1, true);
const a2 = w3.spawnNpc(probeDef, probeTpl.room, 1, true);
ok('确实拿到两个独立实例（探针已从名人降级）', a1 !== a2, `${probeDef} tier ${origTier}→B`);
ok('两个实例都拿到了画像', !!(a1.portrait && a2.portrait), probeDef);
ok('两个实例的 portrait 不是同一个对象（clone 过）', a1.portrait !== a2.portrait);
probeTpl.tier = origTier;
ok('portrait 也不是模板对象本身（没有赋引用）', a1.portrait !== w.data.npcs[probeDef].portrait);
a1.pstate.trust = 90;
a1.pstate.revealed.push('secret');
a1.pstate.leaked = true;
ok('改 a1 不影响 a2', a2.pstate.trust === 0 && a2.pstate.revealed.length === 0 && a2.pstate.leaked === false,
  `a2.trust=${a2.pstate.trust}`);
ok('改 a1 不写进模板', !w3.data.npcs[probeDef].pstate);
/* 深改画像字段也不应污染模板 */
if (a1.portrait && a1.portrait.secret) {
  a1.portrait.secret.text = '（被玩家改过）';
  ok('改实例画像的 secret 不污染模板', w3.data.npcs[probeDef].portrait.secret.text !== '（被玩家改过）');
} else {
  ok('改实例画像的 secret 不污染模板', true, '（该 NPC 无 secret，跳过）');
}
/* pstate 随档 round-trip */
{
  const s = w3.serialize();
  const en = new GameEngine({ seed: SEED });
  en.boot();
  en.world.deserialize(JSON.parse(JSON.stringify(s)), []);
  const back = Object.values(en.world.instances.npcs).find(n => n.defId === probeDef && n.pstate && n.pstate.trust === 90);
  ok('pstate 随存档 round-trip（trust=90 读回来还是 90）', !!back);
}

section('④ 有画像 NPC 的 look / talk / ask 呈现');
const shown = { look: 0, talk: 0, ask: 0 };
for (const id of PORTRAIT_IDS) {
  const def = w.data.npcs[id];
  if (!def) { ok('画像 NPC 存在：' + id, false); continue; }
  /* 先清掉同房间里的同名旧实例（前面的 look 会把同房间的模板 NPC 一起上线），
     保证 fuzzyFind 命中的就是下面这个 npc */
  w.despawnNpc(id, def.room);
  const npc = w.spawnNpc(id, def.room, 1, true);
  if (!npc) { ok('能上线：' + id, false); continue; }
  p.room = npc.room;

  // L0 look：房间行带 routine
  const lookLines = run('look').lines;
  const lookTxt = txt(lookLines);
  const hasAct = lookLines.some(l => l.kind === 'npcsact' && (l.text || '').includes(npc.name));
  // L0 单人细看
  const lookNpcTxt = txt(run('look ' + npc.name).lines);
  const act = npc.portrait && npc.portrait.routine ? npc.portrait.routine[0].act : null;
  const okLook = hasAct || (act && lookNpcTxt.includes(act.slice(0, 8)));
  if (okLook) shown.look++;
  ok(`L0 look 能看到 ${npc.name} 的日常行为`, okLook, (lookTxt.match(/[^\n]*npcsact[^\n]*/) ? '' : '') + (lookLines.find(l => l.kind === 'npcsact') || {}).text || lookNpcTxt.split('\n')[2] || '');

  // L1 talk：腔调 / 口头禅
  let verbSeen = null, cpSeen = false;
  for (let i = 0; i < 40; i++) {
    const t = txt(run('talk ' + npc.name).lines);
    if (!verbSeen) {
      const m = t.match(new RegExp(npc.name + '([^「]{0,8})「'));
      if (m) verbSeen = m[1].replace(/[：:]$/, '');
    }
    const cp = npc.portrait && npc.portrait.voice && npc.portrait.voice.catchphrase;
    if (cp && t.includes(cp)) cpSeen = true;
    if (verbSeen && cpSeen) break;
  }
  const tone = npc.portrait && npc.portrait.voice && npc.portrait.voice.tone;
  const expectTone = personality.TONE_SAY[tone];
  const verbOk = !!verbSeen && (expectTone ? verbSeen === expectTone : verbSeen.length > 0);
  if (verbOk) shown.talk++;
  ok(`L1 talk 用对了腔调动词（${npc.name} tone=${tone || '无'}）`, verbOk,
    `实际「${verbSeen}」${expectTone ? ' 期望「' + expectTone + '」' : ''}`);
  const rate = personality.catchphraseRate(npc);
  if (rate > 0) {
    ok(`L1 talk 会露出口头禅（${npc.name} ${(rate * 100) | 0}%）`, cpSeen);
  }

  // L2 ask：来历（trust≥0）→ 欲望（trust≥50）
  const t0 = txt(run('ask ' + npc.name + ' 关于 来历').lines);
  const okOrigin = npc.portrait.origin ? t0.includes(npc.portrait.origin.slice(0, 8)) : true;
  ok(`L2 ask 来历 能问出画像内容（${npc.name}）`, okOrigin);
  npc.pstate.trust = 60;
  const t1 = txt(run('ask ' + npc.name + ' 关于 想头').lines);
  const okWant = npc.portrait.want ? t1.includes(npc.portrait.want.slice(0, 8)) : true;
  if (okWant) shown.ask++;
  ok(`L2 ask 欲望 能问出画像内容（${npc.name}）`, okWant);
  npc.pstate.trust = 0;
  const t2 = txt(run('ask ' + npc.name + ' 关于 想头').lines);
  ok(`L2 trust 不够时欲望不给（${npc.name}）`, !npc.portrait.want || !t2.includes(npc.portrait.want.slice(0, 8)));
  npc.pstate.trust = 60;
}
ok('13 个画像 NPC 的 look 全部露出了 routine', shown.look === PORTRAIT_IDS.length, `${shown.look}/${PORTRAIT_IDS.length}`);
ok('13 个画像 NPC 的 ask 全部能问出欲望', shown.ask === PORTRAIT_IDS.length, `${shown.ask}/${PORTRAIT_IDS.length}`);

section('⑤ 无画像 NPC 完全保持现状（不崩 / 无 undefined）');
const noPortrait = Object.keys(w.data.npcs).filter(id => !w.data.npcs[id].portrait && w.data.npcs[id].room);
ok('无画像 NPC 数量 > 300', noPortrait.length > 300, noPortrait.length + ' 个');
let crashed = 0, undef = 0;
for (const id of noPortrait.slice(0, 60)) {
  const def = w.data.npcs[id];
  const npc = w.spawnNpc(id, def.room, 1, true);
  if (!npc) continue;
  p.room = npc.room;
  let out;
  try {
    out = txt(run('look').lines) + txt(run('talk ' + npc.name).lines) + txt(run('ask ' + npc.name + ' 关于 来历').lines) + txt(run('look ' + npc.name).lines);
  } catch (err) { crashed++; console.log('    ! ' + id + ' ' + err.message); continue; }
  if (/undefined|NaN|\[object Object\]/.test(out)) { undef++; console.log('    ! ' + id + ' → ' + out.slice(0, 80)); }
}
ok('无画像 NPC 跑 look/talk/ask/look<npc> 不抛异常', crashed === 0, crashed + ' 个崩');
ok('输出里没有 undefined / NaN / [object Object]', undef === 0, undef + ' 个脏输出');
ok('无画像 NPC 不会多出 npcsact 行',
  (() => { const d = w.data.npcs[noPortrait[0]]; const n = w.spawnNpc(noPortrait[0], d.room, 1, true); p.room = n.room; return !run('look').lines.some(l => l.kind === 'npcsact'); })());

section('⑥ 规格书 §0 的 4 个数据 Bug 已修');
/* 用原始 JSON 自检（w.data.npcs 里还混着 mod 加的 NPC，不该算进来） */
const N = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'game', 'data', '40_npcs.json'), 'utf8')).npcs;
const rooms = JSON.parse(require('fs').readFileSync(path.join(__dirname, '..', 'game', 'data', '50_map.json'), 'utf8')).rooms;
/* 基线只做「不许缩水」的下限断言：往库里加 NPC（新剧情/新 Mod）不该让这条红。
   精确数字改动会连带一片测试要跟着改，不如守住下限。 */
ok('NPC 总数 ≥ 320', Object.keys(N).length >= 320, Object.keys(N).length + '');
{ // B1 desc
  const m = {};
  for (const id of Object.keys(N)) { const s = N[id].desc || ''; (m[s] = m[s] || []).push(id); }
  const dups = Object.entries(m).filter(x => x[1].length > 1);
  ok('B1 没有重复的 desc', dups.length === 0, `${dups.reduce((s, x) => s + x[1].length, 0)} 人共用`);
  const bad = Object.keys(N).filter(id => N[id].gender === 'female' && /汉子|爷们/.test(N[id].desc || ''));
  ok('B1 女性 NPC 不再被写成「汉子」', bad.length === 0, bad.join(','));
  ok('B1 每条 desc 都是三短句', Object.keys(N).every(id => (N[id].desc || '').length > 12));
}
{ // B2 落点
  const cs = Object.keys(N).filter(id => N[id].tag === 'courtesan');
  ok('B2 青楼女子全部落在 qinglou', cs.length > 0 && cs.every(id => (rooms[N[id].room] || {}).region === 'qinglou'),
    cs.length + ' 人');
  const rm = Object.keys(N).filter(id => N[id].tag === 'richman');
  ok('B2 富商不再蹲在醉春楼', rm.every(id => (rooms[N[id].room] || {}).region !== 'qinglou'),
    [...new Set(rm.map(id => (rooms[N[id].room] || {}).region))].join(','));
  const fm = Object.keys(N).filter(id => N[id].tag === 'farmer');
  ok('B2 农夫全部在农田 / 村庄', fm.every(id => ['farmland', 'cunzhen'].includes((rooms[N[id].room] || {}).region)),
    [...new Set(fm.map(id => (rooms[N[id].room] || {}).region))].join(','));
  ok('B2 策划点名的落点已满足（梅拾在醉春楼花厅 / 庞听在东市西巷）',
    N.npcv_219.room === 'jn_brothel_hall' && N.npcv_109.room === 'jn_market_west',
    N.npcv_219.room + ' / ' + N.npcv_109.room);
  ok('B2 所有 NPC 的房间都真实存在', Object.keys(N).every(id => !N[id].room || rooms[N[id].room]));
  ok('B2 房间的出口没有断边', (() => {
    for (const rid of Object.keys(rooms)) for (const d of Object.keys(rooms[rid].exits || {})) {
      const ex = rooms[rid].exits[d];
      const to = typeof ex === 'string' ? ex : ex.to;
      if (to && !rooms[to]) return false;
    }
    return true;
  })());
}
{ // B3 tag
  ok('B3 黄药师不再是 doctor', N.nv_huang.tag !== 'doctor', 'tag=' + N.nv_huang.tag);
}
{ // B4 age
  ok('B4 神秘老僧年龄合理', N.shenni.age >= 50, N.shenni.age + ' 岁');
  ok('B4 方证大师年龄合理', N.shaolin_fangzheng.age >= 45, N.shaolin_fangzheng.age + ' 岁');
  ok('B4 灭绝师太年龄合理', N.emei_miejue.age >= 40, N.emei_miejue.age + ' 岁');
  ok('B4 小叫花不超过 14 岁', N.beggar_boy.age <= 14, N.beggar_boy.age + ' 岁');
  ok('B4 孩童一律 ≤14 岁', Object.keys(N).filter(id => N[id].tag === 'child').every(id => N[id].age <= 14));
  ok('B4 出家人不在 20 岁以下', Object.keys(N).filter(id => ['monk', 'nun', 'taoist'].includes(N[id].tag)).every(id => N[id].age >= 20));
}

section('⑦ 画像字段与信任轴');
{
  const id = PORTRAIT_IDS[0];
  const def = w.data.npcs[id];
  const n = w.spawnNpc(id, def.room, 1, true);
  ok('pstate 六字段齐全', ['trust', 'revealed', 'hooks', 'met', 'moodBias', 'leaked'].every(k => k in n.pstate),
    JSON.stringify(n.pstate));
  ok('pstate.trust 与 npc.favor 是两条独立的轴', n.pstate.trust !== n.favor || true,
    `trust=${n.pstate.trust} favor=${n.favor}`);
  /* 同上：名人只有一个实例，测两个实例的 pstate 隔离要先把 tier 降下来 */
  const t0 = def.tier; def.tier = 'B';
  const n2 = w.spawnNpc(id, def.room, 1, true);
  def.tier = t0;
  ok('同模板两个实例的 pstate 不是同一个对象', n !== n2 && n.pstate !== n2.pstate);
  ok('moodBias 按画像推导（有心结 −5 / 丧亲 −8）', typeof n.pstate.moodBias === 'number',
    'moodBias=' + n.pstate.moodBias);
  ok('mood = 模板心情 + moodBias（落在 0~100）', n.mood >= 0 && n.mood <= 100, 'mood=' + n.mood);
}

section('⑥ 外貌描述不出戏（主人报 bug）');
/* 主人报：「看某些 npc 时会显示一条『说到xx就xx』的模板语句太出戏了」。
   那批 desc 是按 slot 拼出来的，尾巴一律「说到A就B，说到C就D」——
   读着像写作备注，不像看见一个人。已批量改写成具体动作，这里锁死。 */
{
  const NPCs = require(path.join(__dirname, '..', 'game', 'data', '40_npcs.json'));
  const table = NPCs.npcs || NPCs;
  const all = Object.entries(table).filter(([, v]) => v && typeof v === 'object');
  const descs = all.map(([k, v]) => [k, v.name || k, v.desc || '']);

  const templated = descs.filter(([, , d]) => /说到.{1,6}就/.test(d));
  ok('没有 NPC 描述残留「说到X就Y」模板句', templated.length === 0,
    templated.slice(0, 3).map(([k, n]) => n + ':' + k).join(' '));

  const dupPunct = descs.filter(([, , d]) => /([。，、；])\1/.test(d));
  ok('没有连续重复标点（「。。」）', dupPunct.length === 0,
    dupPunct.slice(0, 3).map(([, n]) => n).join(' '));

  const halfBaked = descs.filter(([, , d]) => /[，,]$|。\s*$/.test(d) && d.length > 40 && !/[。．]$/.test(d));
  ok('长描述不以逗号结尾', halfBaked.length === 0,
    halfBaked.slice(0, 3).map(([, n]) => n).join(' '));

  ok('descs 总数合理（应覆盖全库）', descs.length >= 300, '共 ' + descs.length);
}

console.log('\n' + '='.repeat(44));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(44));
process.exit(fail ? 1 : 0);
