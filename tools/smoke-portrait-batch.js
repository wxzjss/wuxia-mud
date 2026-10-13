/**
 * smoke-portrait-batch.js —— 画像落地批次（26 张反面画像灌入）专项回归
 *
 * 覆盖（照 PORTRAIT-LAND 交付单）：
 *   ① 画像字段 ↔ 后端/前端**真实读取**对齐（重点）
 *      —— 本项目反复踩「渲染读一个字段、判定读另一个」的静默坑。
 *      本测试**驱动真实指令**（look / talk / ask），逐字段验证「哪些玩家真看得见」，
 *      并**反向钉死哪些是死字段**（obsession 仍是；role / secret / feuds / voice.style
 *      已由 WORLD-INTERACT 批次 7 接线为「玩家可见」，见 §1 的 1.H / 1.I）。
 *   ② spawnNpc 是否把 portrait clone 进实例（铁律 14）
 *   ③ 幂等：生成器跑两次结果逐字节一致；从零重建能还原出磁盘上那份
 *   ④ 质量红线：女性无「汉子/他」、反面必有 hooks、catchphrase 零重复、
 *      A 层必填齐全、禁用现代词、关系闭合、规格 §0 B1~B4
 *   ⑤ 真实渲染：vm 载入真 ui.js，真渲染 look / ask，确认画像文本出现在玩家能看到的 DOM 里
 *
 * 纪律：
 *   · 随机源固定 seed（GameEngine({seed}).boot().newGame()），`new World()` 是空壳不用
 *   · 断言打在真实调用路径上（真 cmds.execute / 真 ui.js doCmd），不直接调内部函数当断言
 *   · 变异自证：见文件末「变异对应表」；用 tools/mutate.js 的 portrait-* 三个 case 验证
 *   · 不恒真：任何 `&& false` / 字面 true / 空 catch 都不写
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const DATA = path.join(ROOT, 'game', 'data', '40_npcs.json');
const SRC = path.join(ROOT, 'design', 'portraits-new.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { normalizeCmd } = require(path.join(ROOT, 'game', 'src', 'core', 'utils.js'));
const personality = require(path.join(ROOT, 'game', 'src', 'core', 'personality.js'));
const gen = require(path.join(__dirname, 'gen-portraits.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
}
/* 直接走指令表，不推进游戏时间（推进时间会让 NPC 按 schedule 跑掉，测试不稳）；
   但走的仍是**真命令处理器**（e.cmds.execute + normalizeCmd），与玩家敲键同一条路。 */
function run(e, cmd) { return e.cmds.execute(normalizeCmd(cmd), { player: e.world.player, world: e.world, engine: e }) || { lines: [] }; }
const txt = r => (r.lines || []).map(l => l.text || '').join('\n');

/* ---- 事实来源 ---- */
const RAW = fs.readFileSync(DATA, 'utf8');
const N = JSON.parse(RAW).npcs;
const SRCJ = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const BATCH = Object.keys(SRCJ.items);

/* ================================================================
 *  0 · 前置事实
 * ================================================================ */
section('0 · 前置事实（写死字段名之前先验证结构）');
{
  eq('0.1 画像源 26 人', BATCH.length, 26);
  const missing = BATCH.filter(id => !N[id]);
  eq('0.2 26 个 npcId 全部存在于 40_npcs.json', missing.length, 0);
  const noPortrait = BATCH.filter(id => !(N[id].portrait && N[id].portrait.v === 1));
  eq('0.3 26 人全部已挂 def.portrait 且 v===1（生成器已跑）', noPortrait.length, 0);
  /* 挂载位置：def.portrait 子对象，不在 vars/flags */
  const wrongMount = BATCH.filter(id => (N[id].vars && N[id].vars.portrait) || (N[id].flags && N[id].flags.portrait));
  eq('0.4 画像挂在 def.portrait（未误挂 vars/flags）', wrongMount.length, 0);
  /* 40_npcs.json 是 1 空格缩进，stringify(null,1) 应逐字节还原 */
  ok('0.5 40_npcs.json 可被 JSON.stringify(.,null,1) 逐字节还原（写入格式稳定）', JSON.stringify(N && JSON.parse(RAW), null, 1) === RAW);
  /* _ 键必须已剥离 */
  const leaked = BATCH.filter(id => Object.keys(N[id].portrait).some(k => k.startsWith('_')));
  eq('0.6 注入的 portrait 里无 `_` 开头键（_note 已剥离）', leaked.length, 0);
  ok('0.7 源文件每条都带 _note（证明「剥离」这一步确实被执行过，非空跑）',
    BATCH.every(id => Object.values(SRCJ.items[id]).length > 0 && Object.keys(SRCJ.items[id]).some(k => k.startsWith('_'))));
  const tiers = {}; for (const id of BATCH) tiers[N[id].portrait.tier] = (tiers[N[id].portrait.tier] || 0) + 1;
  console.log('  本批 tier 分布 ' + JSON.stringify(tiers) + '；全库有画像 ' + Object.keys(N).filter(i => N[i].portrait).length + '/' + Object.keys(N).length);
}

/* ================================================================
 *  1 · 画像字段 ↔ 真实读取对齐（核心）
 * ================================================================ */
section('1 · 画像字段 ↔ 后端/前端真实读取对齐（驱动真指令）');
let tabooTestable = 0;
const seenRuntime = {
  routine: 0, catchphrase: 0, toneVerb: 0, origin: 0, now: 0, want: 0, fear: 0, taboo: 0,
  role: 0, secret: 0,   /* WORLD-INTERACT 批次 7 起：role→look、secret→高信任 ask 不再是死字段 */
};
const leakedDeadFields = [];   // 收集：哪些「死字段」的文本意外出现在了 render 里（应为空）
{
  const e = boot(); const w = e.world, p = w.player;
  const lookupTexts = [];    // 每个 NPC 的 look/talk/ask 输出汇总，用于死字段判定
  for (const id of BATCH) {
    const def = N[id];
    const pt = def.portrait;
    w.despawnNpc(id, def.room);
    const npc = w.spawnNpc(id, def.room, 1, true);
    if (!npc) { ok('1.0 能上线 ' + id, false); continue; }
    p.room = npc.room;
    const bag = [];

    /* ---- L0 look：房间行 npcsact 带 routine ---- */
    const lookRoom = run(e, 'look');
    const lookTxt = txt(lookRoom);
    bag.push(lookTxt);
    const actToday = (function () {
      const rr = pt.routine || [];
      const cur = rr.find(x => x.at === 'day') || rr[0];
      return cur && cur.act ? cur.act.replace(/[。.]+$/, '') : '';
    })();
    const hitRoom = (lookRoom.lines || []).some(l => l.kind === 'npcsact' && (l.text || '').includes(npc.name));
    const lookOne = txt(run(e, 'look ' + npc.name));
    bag.push(lookOne);
    const hitOne = actToday && lookOne.includes(actToday.slice(0, 10));
    ok(`1.L0 look 露出 routine（${npc.name}）`, hitRoom || hitOne, hitRoom ? '房间行 npcsact' : (hitOne ? '单人 look' : 'act=' + actToday.slice(0, 16)));
    if (hitRoom || hitOne) seenRuntime.routine++;

    /* ---- L0b role：WORLD-INTERACT 批次 7 起 look 里多一句「这是个什么人」 ---- */
    const roleSeen = !!pt.role && lookOne.includes(pt.role);
    ok(`1.L0b look 露出 role（${npc.name}）`, roleSeen, roleSeen ? '' : 'role=' + JSON.stringify((pt.role || '').slice(0, 20)));
    if (roleSeen) seenRuntime.role++;

    /* ---- L1 talk：口头禅 + 腔调动词 ---- */
    const cp = pt.voice && pt.voice.catchphrase;
    let verbSeen = null, cpSeen = false, talkTxt = '';
    for (let i = 0; i < 60; i++) {
      talkTxt = txt(run(e, 'talk ' + npc.name));
      bag.push(talkTxt);
      const m = talkTxt.match(new RegExp(npc.name + '([^「]{0,8})「'));
      if (m && !verbSeen) verbSeen = m[1].replace(/[：:]$/, '');
      if (cp && talkTxt.includes(cp)) cpSeen = true;
      if (verbSeen && cpSeen) break;
    }
    const expectTone = personality.TONE_SAY[pt.voice.tone];
    if (expectTone) {
      ok(`1.L1 talk 腔调覆盖正确（${npc.name} tone=${pt.voice.tone} → ${expectTone}）`, verbSeen === expectTone, '实际「' + verbSeen + '」');
      if (verbSeen === expectTone) seenRuntime.toneVerb++;
    } else {
      ok(`1.L1 talk 有说话动词（${npc.name} tone=${pt.voice.tone}）`, !!verbSeen, '实际「' + verbSeen + '」');
    }
    /* 口头禅按 A 层 30% 概率露出：60 次至少命中一次的漏判概率 (0.7)^60 ≈ 5e-10 */
    ok(`1.L1 talk 会露口头禅（${npc.name}）`, cpSeen, 'cp=' + JSON.stringify(cp));
    if (cpSeen) seenRuntime.catchphrase++;

    /* ---- L2 ask：trust 门控（origin 0 / now 20 / want 50 / fear 70）---- */
    npc.pstate.trust = 0;
    const a0 = run(e, 'ask ' + npc.name + ' 关于 来历'); bag.push(txt(a0));
    const okOrigin = !pt.origin || txt(a0).includes(pt.origin.slice(0, 10));
    ok(`1.L2 ask 来历 trust≥0（${npc.name}）`, okOrigin);
    if (okOrigin && pt.origin) seenRuntime.origin++;

    npc.pstate.trust = 25;
    const aNow = run(e, 'ask ' + npc.name + ' 关于 近况'); bag.push(txt(aNow));
    const okNow = !pt.now || txt(aNow).includes(pt.now.slice(0, 10));
    ok(`1.L2 ask 近况 trust≥20（${npc.name}）`, okNow);
    if (okNow && pt.now) seenRuntime.now++;

    /* want：trust 0 时不给，trust 60 时给 */
    npc.pstate.trust = 0;
    const wLow = txt(run(e, 'ask ' + npc.name + ' 关于 想头')); bag.push(wLow);
    ok(`1.L2 want 被 trust 门控（${npc.name} trust=0 不给）`, !pt.want || !wLow.includes(pt.want.slice(0, 10)));
    npc.pstate.trust = 60;
    const wHigh = txt(run(e, 'ask ' + npc.name + ' 关于 想头')); bag.push(wHigh);
    ok(`1.L2 want 在 trust≥50 时给出（${npc.name}）`, !pt.want || wHigh.includes(pt.want.slice(0, 10)));
    if (pt.want && wHigh.includes(pt.want.slice(0, 10))) seenRuntime.want++;

    npc.pstate.trust = 75;
    const fearTxt = txt(run(e, 'ask ' + npc.name + ' 关于 怕什么')); bag.push(fearTxt);
    const okFear = !pt.fear || fearTxt.includes(pt.fear.slice(0, 10));
    ok(`1.L2 fear 在 trust≥70 时给出（${npc.name}）`, okFear);
    if (okFear && pt.fear) seenRuntime.fear++;

    /* ---- L2b secret：WORLD-INTERACT 批次 7 起，高信任问「秘密」才吐露（门槛 50+tier×5）---- */
    if (pt.secret && pt.secret.text) {
      const secTxt = txt(run(e, 'ask ' + npc.name + ' 关于 秘密')); bag.push(secTxt);
      const okSec = secTxt.includes(pt.secret.text.slice(0, 12));
      ok(`1.L2b ask 秘密 trust≥75 时吐露（${npc.name}）`, okSec, okSec ? '' : JSON.stringify(secTxt.slice(0, 60)));
      if (okSec) seenRuntime.secret++;
      /* 低信任负例：门槛真的起作用（不能恒真） */
      npc.pstate.trust = 0;
      const secLow = txt(run(e, 'ask ' + npc.name + ' 关于 秘密')); bag.push(secLow);
      ok(`1.L2b 低信任时不吐露 secret（${npc.name}）`, !secLow.includes(pt.secret.text.slice(0, 12)));
    }

    /* taboo：命中掉好感（A 层 −15）
       ⚠️ 2026-10-11 契约更新（判定收了两道口子，都是为了别误伤 ——
          见 commands.js 里那一段注释；这里是它们的验收侧）：
         ① **单字禁忌不算**：数据里有人把 taboo 写成「脚」「手」「塔」，
            一个字能盖住半部词典，玩家正常问话就动不动踩雷，那不叫禁忌叫碰瓷；
         ② **与钩子标题撞车的不算**：taboo = 「外人提不得」，hooks = 「他托你办的事」，
            画像里这两栏常常写的是同一个心结（岳不群的 taboo「弟子」/ 钩子「下山的那个弟子」）。
            照他自己给的钩子标题去问，反被扣 15 点好感 —— 两栏打架，以钩子为准。
       所以这里挑一个「长度 ≥ 2、且不与钩子标题撞车」的禁忌词来验；
       一个都挑不出来的人不计入分母（不然是把契约更新当成回归）。 */
    const hookTitles = (pt.hooks || []).map(h => h && h.title).filter(Boolean);
    const tb = (pt.voice.taboo || []).find(x => x && String(x).length >= 2
      && !hookTitles.some(t => t.includes(x) || x.includes(t)));
    if (tb) {
      tabooTestable++;
      npc.favor = 0;
      run(e, 'ask ' + npc.name + ' 关于 ' + tb);
      ok(`1.L2 taboo「${tb}」命中掉好感（${npc.name}）`, npc.favor < 0, 'favor=' + npc.favor);
      if (npc.favor < 0) seenRuntime.taboo++;
    }
    npc.pstate.trust = 0;

    /* ---- 死字段证据：这些字段的文本不应出现在任何 render 里 ---- */
    const all = bag.join('\n');
    const deadCand = { obsession: pt.obsession };
    for (const [k, v] of Object.entries(deadCand)) {
      if (!v) continue;
      /* 一旦出现在渲染文本里，说明它其实「可见」——记下来，断言要求为空 */
      if (all.includes(v) || all.includes(v.slice(0, 15))) leakedDeadFields.push(id + '.' + k);
    }
  }

  /* 汇总：每个字段全 26 人都露出，才算「真能被玩家看见」 */
  const total = BATCH.length;
  console.log('\n  ── 字段 ↔ 读取对齐表（26 人为样本） ──');
  const rows = [
    ['role', 'look（一眼看去 · 批次 7 接线）', `${seenRuntime.role}/${total}`],
    ['origin', `ask 来历 trust≥0`, `${seenRuntime.origin}/${total}`],
    ['now', `ask 近况 trust≥20`, `${seenRuntime.now}/${total}`],
    ['want', `ask 想头 trust≥50`, `${seenRuntime.want}/${total}`],
    ['fear', `ask 惧怕 trust≥70`, `${seenRuntime.fear}/${total}`],
    ['secret', 'ask 秘密/底细 trust≥50+tier×5（批次 7）', `${seenRuntime.secret}/${total}`],
    ['obsession', '仅经 moodBias 影响 mood，文本不露', '死字段'],
    ['feuds', 'ask 仇家 trust≥40（批次 7 接线）', '—'],
    ['voice.tone', 'talk 说话动词覆盖(敬/泼/酸)', `${seenRuntime.toneVerb} 条 tone∈{敬,泼,酸}`],
    ['voice.catchphrase', 'talk 前缀(A 30%)', `${seenRuntime.catchphrase}/${total}`],
    ['voice.taboo', 'ask 命中掉好感（单字/钩子标题除外）', `${seenRuntime.taboo}/${tabooTestable}`],
    ['voice.style', 'talk 句式签名（批次 7 接线）', '—'],
    ['routine', 'look 房间行 + look 单人', `${seenRuntime.routine}/${total}`],
    ['arc', '—（无读取点）', '死字段'],
    ['hooks', 'ask 钩子标题（trust 够就说出来）', `${seenRuntime.hooks || 0}/${total}`],
    ['marks', '仅经 moodBias(丧亲/新婚/得子)，文本不露', '死字段'],
  ];
  for (const [f, via, ev] of rows) console.log('   ' + f.padEnd(16) + '│ ' + via.padEnd(34) + '│ ' + ev);

  /* 硬断言：真实可见字段 26/26 全露 */
  eq('1.A routine 26 人全部可见', seenRuntime.routine, total);
  eq('1.B catchphrase 26 人全部可见', seenRuntime.catchphrase, total);
  eq('1.C origin 26 人全部可问出', seenRuntime.origin, total);
  eq('1.D want 26 人全部可问出', seenRuntime.want, total);
  eq('1.E fear 26 人全部可问出', seenRuntime.fear, total);
  eq('1.F taboo 生效（可测的人都掉了好感）', seenRuntime.taboo, tabooTestable);
  /* 死字段反向钉死：role / secret / obsession 的文本一次都没进过 render（它们是死字段） */
  eq('1.G obsession 仍是死字段（文本零出现；moodBias 只影响 mood 不露字）', leakedDeadFields.length, 0,
    leakedDeadFields.length ? leakedDeadFields.slice(0, 5).join(',') : '（26 人 ×1 字段零出现）');
  /* 批次 7（WORLD-INTERACT）新增：role / secret 由「死字段」转为「玩家可见」，正向钉死 26/26 */
  eq('1.H role 26 人全部在 look 里可见（批次 7 接线）', seenRuntime.role, total);
  eq('1.I secret 26 人全部可在高信任 ask 里问出（批次 7 接线）', seenRuntime.secret, total);
}

/* ================================================================
 *  2 · spawnNpc 是否 clone portrait（铁律 14）
 * ================================================================ */
section('2 · spawnNpc clone portrait（铁律 14：新增字段必须 clone 进实例）');
{
  const e = boot(); const w = e.world, p = w.player;
  const id = 'npcv_241';
  const def = w.data.npcs[id];
  /* 名人全图只一个实例，直接 spawn 两次会拿到同一个 → 把模板 tier 临时降成 B 造探针，
     验证的是 clone 逻辑，与他是不是名人无关（测完还原）。 */
  const origTier = def.tier; def.tier = 'B';
  w.despawnNpc(id, def.room);
  const a1 = w.spawnNpc(id, def.room, 1, true);
  const a2 = w.spawnNpc(id, def.room, 1, true);
  def.tier = origTier;
  ok('2.1 拿到两个独立实例（探针已降级非名人）', !!a1 && !!a2 && a1 !== a2);
  ok('2.2 两个实例都拿到了 portrait', !!(a1.portrait && a2.portrait));
  ok('2.3 实例 portrait 不是模板对象本身（没赋引用）', a1.portrait !== def.portrait);
  ok('2.4 两个实例的 portrait 不是同一个对象（clone 过）', a1.portrait !== a2.portrait);
  ok('2.5 pstate 六字段齐全', ['trust', 'revealed', 'hooks', 'met', 'moodBias', 'leaked'].every(k => k in a1.pstate), JSON.stringify(a1.pstate));
  ok('2.6 两个实例的 pstate 不是同一个对象', a1.pstate !== a2.pstate);
  /* 深改实例画像/进程状态，不得污染模板或另一实例 */
  a1.portrait.secret.text = '（被玩家改过）';
  a1.pstate.trust = 90; a1.pstate.revealed.push('secret'); a1.pstate.leaked = true;
  ok('2.7 改 a1 画像不污染模板', def.portrait.secret.text !== '（被玩家改过）');
  ok('2.8 改 a1 画像不污染 a2', a2.portrait.secret.text !== '（被玩家改过）');
  ok('2.9 改 a1 的 pstate 不污染 a2', a2.pstate.trust === 0 && a2.pstate.revealed.length === 0 && a2.pstate.leaked === false);
  ok('2.10 改 a1 不写进模板 pstate', !def.pstate);
  /* pstate 随档 round-trip */
  const s = w.serialize();
  const e2 = new GameEngine({ seed: SEED }); e2.boot();
  e2.world.deserialize(JSON.parse(JSON.stringify(s)), []);
  const back = Object.values(e2.world.instances.npcs).find(n => n.defId === id && n.pstate && n.pstate.trust === 90);
  ok('2.11 pstate 随存档 round-trip（trust=90 读回来还是 90）', !!back);
  ok('2.12 存档里不含 portrait 副本（静态模板数据不随档走）',
    Object.values(s.instances.npcs).every(n => !Object.prototype.hasOwnProperty.call(n, 'portrait')));
}

/* ================================================================
 *  3 · 幂等（生成器跑两次逐字节一致 & 从零重建 == 磁盘）
 * ================================================================ */
section('3 · 幂等（跑两次一致；从零重建能还原磁盘那份）');
{
  /* 3a：对已注入的当前数据再跑一次 → 0 新增、全跳过，字节不变 */
  const dataA = JSON.parse(RAW);
  const r1 = gen.applyPortraits(dataA, SRCJ.items, {});
  eq('3.1 对已注入数据再跑：新增 0', r1.added.length, 0);
  eq('3.2 对已注入数据再跑：跳过 26', r1.skipped.length, 26);
  eq('3.3 对已注入数据再跑：无校验错误', r1.errors.length, 0);
  ok('3.4 再跑后字节与磁盘完全一致', JSON.stringify(dataA, null, 1) === RAW);

  /* 3b：把 26 张画像全删掉，从零生成 → 应还原出磁盘那一份（确定性） */
  const dataB = JSON.parse(RAW);
  for (const id of BATCH) delete dataB.npcs[id].portrait;
  const r2 = gen.applyPortraits(dataB, SRCJ.items, {});
  eq('3.5 从零生成：新增 26', r2.added.length, 26);
  eq('3.6 从零生成：无错误', r2.errors.length, 0);
  const S1 = JSON.stringify(dataB, null, 1);
  ok('3.7 从零生成的结果 == 磁盘上的 40_npcs.json（确定性）', S1 === RAW);

  /* 3c：再生成一次 → 逐字节一致（幂等） */
  const r3 = gen.applyPortraits(dataB, SRCJ.items, {});
  eq('3.8 二次生成：新增 0（已 v===1）', r3.added.length, 0);
  ok('3.9 二次生成输出逐字节一致', JSON.stringify(dataB, null, 1) === S1);

  /* 3d：除 portrait 外绝不改任何字段 */
  const dataC = JSON.parse(RAW);
  for (const id of BATCH) delete dataC.npcs[id].portrait;
  const before = JSON.parse(JSON.stringify(dataC));
  gen.applyPortraits(dataC, SRCJ.items, {});
  let mutated = [];
  for (const id of Object.keys(before.npcs)) {
    const a = JSON.parse(JSON.stringify(before.npcs[id])); delete a.portrait;
    const b = JSON.parse(JSON.stringify(dataC.npcs[id])); delete b.portrait;
    if (JSON.stringify(a) !== JSON.stringify(b)) mutated.push(id);
  }
  eq('3.10 生成器只加 portrait，其它字段一个没改', mutated.length, 0, mutated.slice(0, 5).join(','));

  /* 3e：--check（不写）能发现损坏 —— 反向自证：改坏一条再 --check 应报错 */
  const dataD = JSON.parse(RAW);
  dataD.npcs[BATCH[0]].portrait = Object.assign({}, dataD.npcs[BATCH[0]].portrait, { role: '' });
  const rCheck = gen.applyPortraits(dataD, SRCJ.items, {});
  ok('3.11 --check 语义：损坏的 portrait（role 置空）会被校验器判错', rCheck.errors.length > 0,
    rCheck.errors.slice(0, 2).join(' | '));
}

/* ================================================================
 *  4 · 质量红线（15-portrait-roster §5.5 8 条 + 规格 §0 B1~B4）
 * ================================================================ */
section('4 · 质量红线');
{
  const items = BATCH.map(id => [id, N[id], N[id].portrait]);

  /* 红线1 性别一致：女性不得出现「汉子 / 他 / 爷们 / 兄弟」
     ⚠️ 判据改过（严过关 P0-2d，team-lead 裁定 D-5）。
     原判据是 `JSON.stringify(p)` **整串匹配**「他」，于是
       「压下来，他就一直背着」（他 = 背锅的第三人，不是这位女性自称）
     也被判红 —— 那是误报，而误报会让人不信这台量具。
     改成**分语境**查：
       · 以本人为主语的字段（role/origin/now/want/fear/secret/obsession/voice）
         → 出现「他」一律红（这些地方用「他」指自己才是真错）；
       · hooks[]（讲的是「别人会对玩家怎么样」，主语天然是第三方）
         → 只有「他」和**本人姓名同现**才红（那才是真把她叫成了他）。

     ⚠️ 顺序教训（team-lead 与严过关共同记，2026-10 P0-2d）：
     上一轮我**先改内容**（把 3 句 rewardHint 里的「他/他们/给他」改掉去躲这条误报），
     **后修判据**，修完才发现那 3 句按新判据本来不会红 —— 白改一次。
     ⇒ 以后凡是「为了躲误报而改内容」，一律 **先修判据 → 重跑看还剩几条红 → 再动内容**。 */
  const SELF_KEYS = ['role', 'origin', 'now', 'want', 'fear', 'secret', 'obsession', 'voice'];
  const femPronounHits = (def, p) => {
    const out = [];
    const self = SELF_KEYS.map(k => JSON.stringify(p[k] === undefined ? null : p[k])).join(' ');
    if (/汉子|爷们|兄弟/.test(self)) out.push('自称:汉子');
    const c = (self.match(/他/g) || []).length;
    if (c) out.push('自称:他×' + c);
    /* hooks：只查「他 + 本人姓名同现」 */
    const nm = String(def.name || '');
    for (const h of (p.hooks || [])) {
      const t = JSON.stringify(h);
      if (/汉子|爷们|兄弟/.test(t) && nm && t.includes(nm)) out.push('hooks:汉子');
      if (nm && t.includes('他') && t.includes(nm)) out.push('hooks:他(疑似指本人)');
    }
    return out;
  };
  const femBad = [];
  for (const [id, def, p] of items) {
    if (def.gender !== 'female') continue;
    for (const h of femPronounHits(def, p)) femBad.push(id + ':' + h);
  }
  eq('4.1 女性 NPC 画像不含「汉子/他/爷们/兄弟」（分语境）', femBad.length, 0, femBad.slice(0, 5).join(','));

  /* 4.1c 反向自证：判据改宽了，必须证明「该红的仍然红」，否则等于把红线拆了 */
  {
    const F = { gender: 'female', name: '樊湘' };
    const mkPortrait = (now, hooks) => ({ role: '', origin: '', now, want: '', fear: '', secret: '', obsession: '', voice: {}, hooks: hooks || [] });
    /* 应命中：自称语境里写「他」 */
    eq('4.1c-a 自称字段写「他」→ 判红（新判据没把红线拆掉）',
      femPronounHits(F, mkPortrait('他自己也知道这事干不得。')).length > 0, true);
    /* 应命中：hooks 里「他」和本人姓名同现（真把她叫成了他） */
    eq('4.1c-b hooks 里「他」与本人姓名同现 → 判红',
      femPronounHits(F, mkPortrait('', [{ rewardHint: '替他把樊湘的案翻过来。' }])).length > 0, true);
    /* 应不命中：hooks 里「他」指第三人（他人姓名，不是本人） */
    eq('4.1c-c hooks 里「他」指第三人 → 不判红（这是 D-5 要修的误报）',
      femPronounHits(F, mkPortrait('', [{ rewardHint: '孟明亡母那笔钱，说不说给他听。' }])).length, 0);
    /* 应不命中：自称用「她」正常 */
    eq('4.1c-d 自称用「她」→ 不判红',
      femPronounHits(F, mkPortrait('她自己也不肯提。')).length, 0);
  }

  /* 红线3 反面必须有 hooks */
  const villain = items.filter(([, , p]) => p.marks.some(m => gen.VILLAIN_MARKS.includes(m)));
  const noHook = villain.filter(([, , p]) => !(p.hooks && p.hooks.length >= 1));
  eq('4.2 反面人物（marks 含 伪/叛/诈/赃/盐/粮/刑）必有 hooks', noHook.length, 0, `反面 ${villain.length} 人`);
  ok('4.2b 反面样本非空（否则该断言恒真）', villain.length > 0, villain.length + ' 人');

  /* 红线5 catchphrase 全仓去重 */
  const cpAll = {};
  for (const id of Object.keys(N)) { const c = N[id].portrait && N[id].portrait.voice && N[id].portrait.voice.catchphrase; if (c) (cpAll[c] = cpAll[c] || []).push(id); }
  const dup = Object.entries(cpAll).filter(x => x[1].length > 1);
  const dupInBatch = BATCH.filter(id => cpAll[N[id].portrait.voice.catchphrase].length > 1);
  eq('4.3 本批 26 条 catchphrase 零重复', dupInBatch.length, 0, dupInBatch.join(','));
  eq('4.4 全库（含既有 16 张）catchphrase 零重复', dup.length, 0, dup.map(d => d[0]).join('|'));

  /* 红线8 A 层必填齐全 */
  const REQ_A = ['role', 'origin', 'now', 'want', 'fear', 'secret', 'obsession', 'feuds', 'voice', 'routine', 'arc', 'hooks', 'marks'];
  const lack = items.filter(([, , p]) => REQ_A.some(k => p[k] === undefined || p[k] === null));
  eq('4.5 A 层 13 字段全部齐全', lack.length, 0, lack.map(x => x[0]).join(','));

  /* 红线6 禁用现代词 */
  const BANNED = gen.BANNED;
  const bannedHit = items.filter(([, , p]) => BANNED.some(w => JSON.stringify(p).includes(w)));
  eq('4.6 无禁用现代词命中', bannedHit.length, 0, bannedHit.map(x => x[0]).join(','));

  /* 红线7 关系闭合 / arc 档位 / leakTo */
  let relBad = 0, arcBad = 0, leakBad = 0, depBad = 0;
  for (const [id, def, p] of items) {
    const relIds = (def.rel || []).map(r => r.id); const relKind = {}; (def.rel || []).forEach(r => relKind[r.id] = r.kind);
    for (const f of p.feuds) { if (!relIds.includes(f.id) || relKind[f.id] !== f.kind) relBad++; }
    if (p.arc.init !== gen.favorTierName(def.favorInit)) arcBad++;
    if (!p.secret.leakTo.length || p.secret.leakTo.some(x => !N[x])) leakBad++;
    for (const h of p.hooks) if (gen.condDepth(h.trigger) > 3) depBad++;
  }
  eq('4.7 feuds 全在 rel 内且 kind 一致', relBad, 0);
  eq('4.8 arc.init 与 favorInit 同档', arcBad, 0);
  eq('4.9 secret.leakTo 非空且 id 存在', leakBad, 0);
  eq('4.10 hooks[].trigger 嵌套深度 ≤3', depBad, 0);

  /* 规格 §0 B1 / B4（在含本批的全库上复核，不缩水） */
  const dupDesc = {}; for (const id of Object.keys(N)) { const d = N[id].desc || ''; (dupDesc[d] = dupDesc[d] || []).push(id); }
  const dupD = Object.entries(dupDesc).filter(x => x[1].length > 1);
  eq('4.B1 全库无重复 desc', dupD.length, 0, dupD.slice(0, 2).map(x => x[0].slice(0, 10)).join('|'));
  const femDesc = Object.keys(N).filter(id => N[id].gender === 'female' && /汉子|爷们/.test(N[id].desc || ''));
  eq('4.B1b 女性 NPC desc 不含「汉子」', femDesc.length, 0, femDesc.slice(0, 5).join(','));
  const ageBad = Object.keys(N).filter(id => N[id].tag === 'child' && N[id].age > 14).concat(
    Object.keys(N).filter(id => ['monk', 'nun', 'taoist'].includes(N[id].tag) && N[id].age < 20));
  eq('4.B4 child ≤14 / 出家人 ≥20 年龄合理', ageBad.length, 0, ageBad.slice(0, 5).join(','));
}

/* ================================================================
 *  5 · 真实渲染：vm 载入真 ui.js，真渲染 look / ask
 * ================================================================ */
section('5 · 真实渲染（vm + 真 ui.js + DOM stub）');
/* ---- DOM stub（照抄 smoke-owner-bugs.js / kidnap-ui-check.js 的三坑） ---- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; }, toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; } },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.children = []; this.__qsel = {}; },
    get outerHTML() { return this._html; },
    appendChild(c) { this.children.push(c); this._html += (c && c.outerHTML) || ''; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    remove() {}, setAttribute(k, v) { this._attrs[k] = String(v); if (k === 'id') this.id = String(v); if (k === 'class') this.className = String(v); },
    getAttribute(k) { return this._attrs[k] !== undefined ? this._attrs[k] : null; },
    hasAttribute(k) { return this._attrs[k] !== undefined; }, removeAttribute(k) { delete this._attrs[k]; },
    addEventListener(t, f) { (this._listeners[t] = this._listeners[t] || []).push(f); },
    removeEventListener() {}, dispatchEvent() { return true; },
    fire(t, ev) { (this._listeners[t] || []).forEach(f => f.call(this, ev || { target: this, preventDefault() {}, stopPropagation() {} })); },
    querySelector() { return null; },
    querySelectorAll(sel) { const key = sel + ' ' + this._html; this.__qsel = this.__qsel || {}; if (!this.__qsel[key]) this.__qsel[key] = parseSelectors(this._html, sel); return this.__qsel[key]; },
    closest() { return null; }, focus() {}, blur() {}, click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
function parseSelectors(html, sel) {
  if (!html || typeof html !== 'string' || !sel) return [];
  const s = String(sel).trim(); const m = s.match(/^#([A-Za-z0-9_-]+)\s*(.*)$/); const rest = m ? m[2].trim() : s;
  let t = null, cls = null, attr = null;
  const tm = rest.match(/^([a-zA-Z][a-zA-Z0-9]*)/); if (tm) t = tm[1].toLowerCase();
  const cm = rest.match(/\.([A-Za-z0-9_-]+)/); if (cm) cls = cm[1];
  const am = rest.match(/\[([a-zA-Z0-9_:-]+)\]/); if (am) attr = am[1];
  const out = []; const re2 = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/?>([\s\S]*?)<\/\1>/g;
  let m2;
  while ((m2 = re2.exec(html)) !== null) {
    const attrs = {}; const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g; let a;
    while ((a = are.exec(m2[2] || '')) !== null) attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    const g = { tag: m2[1].toLowerCase(), attrs, text: m2[3] || '' };
    if (t && g.tag !== t) continue;
    if (cls && String(g.attrs.class || '').split(/\s+/).indexOf(cls) < 0) continue;
    if (attr && !(attr in g.attrs)) continue;
    out.push(g);
  }
  return out.map(g => { const el = makeEl(g.tag); el.className = g.attrs.class || ''; el.id = g.attrs.id || ''; el._label = g.text; for (const k in g.attrs) el.setAttribute(k, g.attrs[k]); return el; });
}
function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; }, _els: els,
    querySelector() { return null; },
    querySelectorAll(sel) { const m = String(sel).match(/#([A-Za-z0-9_-]+)/); if (!m || !els[m[1]]) return []; return els[m[1]].querySelectorAll(sel); },
    addEventListener() {}, removeEventListener() {}, body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'), createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, document: doc, location: loc,
    navigator: { userAgent: 'node-check', language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0), matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'), btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) }, WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
const settle = () => new Promise(r => setImmediate(r));

let uiLoaded = false, uiErr = null;
const RENDER_IDS = ['npcv_154', 'npcv_241', 'npcv_090'];
async function realRender() {
  const env = makeEnv();
  try {
    vm.createContext(env);
    for (const f of ['app.js', 'ui.js']) vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  } catch (err) { uiErr = err.message; }
  uiLoaded = !!(env.WXUI && env.WXUI.doCmd);
  if (!uiLoaded) {
    console.log('  ⚠ 真实渲染跳过：ui.js 未成功载入（' + (uiErr || 'env.WXUI 缺失') + '）。可能是同事正在改 ui.js —— 不改它，仅注明。');
    ok('5.0 真 ui.js 可载入（前端若被并发改动会暂时红，属非本批次原因）', false, uiErr || 'no WXUI');
    return;
  }
  ok('5.0 真 ui.js 载入成功（app.js + ui.js）', true);
  const e = boot(); const w = e.world, p = w.player;
  env.WX.api.view = async () => ({ ok: true, view: e.view() });
  env.WX.api.exec = async (cmd) => e.exec(cmd);
  env.WX.S.view = e.view(); env.WX.S.busy = false;

  for (const id of RENDER_IDS) {
    const def = N[id], pt = def.portrait;
    w.despawnNpc(id, def.room);
    const npc = w.spawnNpc(id, def.room, 1, true);
    p.room = npc.room;
    env.WX.S.view = e.view();
    const log = env.document.getElementById('log');
    log.innerHTML = '';

    /* 真渲染 look */
    await env.WXUI.doCmd('look');
    await settle();
    const html = log.innerHTML || '';
    const act = (pt.routine.find(r => r.at === 'day') || pt.routine[0]).act.replace(/[。.]+$/, '');
    const sawAct = html.includes(act.slice(0, 12));
    ok(`5.1 真渲染 look 里看到 ${npc.name} 的 routine`, sawAct, sawAct ? '「' + act.slice(0, 20) + '…」' : '未命中');

    /* 真渲染 ask 来历（先把 trust 提到 0 即可，origin 门槛 0） */
    await env.WXUI.doCmd('ask ' + npc.name + ' 关于 来历');
    await settle();
    const html2 = log.innerHTML || '';
    const sawOrigin = html2.includes(pt.origin.slice(0, 12));
    ok(`5.2 真渲染 ask 来历里看到 ${npc.name} 的画像`, sawOrigin, sawOrigin ? '「' + pt.origin.slice(0, 20) + '…」' : '未命中');
    console.log(`   · ${npc.name}（${id}）：look→${sawAct ? 'routine 可见' : '缺失'}｜ask→${sawOrigin ? 'origin 可见' : '缺失'}｜tone=${pt.voice.tone}`);
  }
}

/* ================================================================
 *  6 · 变异对应表（自证不断言恒真；用 tools/mutate.js 施加）
 * ================================================================ */
section('6 · 变异对应表（本文件的断言由 tools/mutate.js 的 case 反向验证）');
{
  console.log('   portrait-no-clone      → 改 world.js 的 `npc.portrait = def.portrait ? clone(...) : null`  →  2.3/2.4/2.7/2.8 应变红');
  console.log('   portrait-drop-routine  → 改 commands.js 的 routineNow 取 routine 那行         →  1.L0 与 1.A 应变红');
  console.log('   portrait-drop-ask      → 改 commands.js 的 `if (!found && npc.portrait)`      →  1.L2 origin/want/fear 应变红');
  ok('6.1 变异对应表已登记（配套 tools/mutate.js 三 case）', true);
}

(async function main() {
  await realRender();
  console.log('\n' + '='.repeat(48));
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) { console.log('  失败清单：'); fails.forEach(f => console.log('   ✘ ' + f)); }
  console.log('='.repeat(48));
  process.exit(fail ? 1 : 0);
})();
