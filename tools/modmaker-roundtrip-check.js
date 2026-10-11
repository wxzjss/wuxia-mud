/* ============================================================
 * modmaker-roundtrip-check.js —— Mod 制作器「填了算不算数」往返守卫
 *
 * 缘起（2026-10-11）：主人问「Mod 制作器是否也需要跟进」。按**制作器真实的字段形状**
 * 造一份 spec 走一遍 normalizeSpec → buildModFiles，再真加载进引擎跑，
 * 当场抓到四处「填了等于没填」：
 *   ① 制作器剧情页遍历/新建的是 `spec.quests`，而 buildModFiles 只写 `spec.stories`
 *      ⇒ **整个剧情页被丢掉**（导出的 mod.json 里连 quests 键都没有）。
 *   ② 独立「对话树」页绑定 `spec.dialogues`，buildModFiles 里**没有这个循环**
 *      ⇒ 整页对话被丢掉；而且对话必须挂到 NPC 的 `dialog` 字段上才触发得了。
 *   ③ 阶段「完成时效果」写在 `stage.onDone`，引擎读的是 `stage.effects` ⇒ 永不触发。
 *   ④ 对话节点选项在制作器里是**文本**，引擎直接 `nd.options.filter` ⇒ TypeError。
 *   外加：奖励是对象 `{exp,pot,money}` 而引擎要效果数组；条件框写 `line=orthodox` /
 *   `悟性>=20` 会被 evalCond 当 flag 名读 ⇒ 永远不成立。
 *
 * 这个脚本守的就是「制作器填什么，引擎就吃到什么」。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const { evalCond } = require(path.join(ROOT, 'game/src/core/modapi.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };

(async () => {
  /* ---- 完全照 modmaker.js 的字段路径造 spec ---- */
  const spec = {
    meta: { id: 'mm_probe', name: '制作器往返', version: '1.0.0', author: 'check' },
    quests: [{
      id: 'q_mm_probe', name: '探针任务', type: '支线', giver: 'cy_pre_teaman',
      require: 'line=orthodox && act>=2',
      requireMsg: '这条路不是给你走的。',
      desc: '这是探针',
      rewards: { exp: 100, money: 50, items: 'jade_ring' },
      stages: [
        { desc: '去江南客栈看一眼', kind: 'room', key: 'jiangnan_inn', count: 1, onDone: 'say:小二告诉你镖师往东边去了' },
        {
          desc: '回报',
          kind: 'flag', key: 'mm_probe_done', count: 1,
          lock: { flag: 'pre_a1_chuan', quest: 'sq_pre_a1_chuan' },
          descByLine: { orthodox: '正派说法', outlaw: '反派说法' },
          descByGender: { male: '男的说法', female: '女的说法' },
        },
      ],
    }],
    dialogues: [{
      id: 'dlg_mm_probe', name: '探针对话', npc: 'cy_pre_teaman', start: 'n1',
      nodes: [
        { id: 'n1', text: '你说什么？', options: '我愿闻其详 -> n2\n（开战） -> kill' },
        { id: 'n2', text: '那就说来话长。', options: '' },
      ],
    }],
  };

  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});

  console.log('===== ① 归一化：制作器的字段形状要变成引擎能读的形状 =====');
  const norm = e.normalizeSpec(spec);
  const q = norm.quests[0], st0 = q.stages[0], st1 = q.stages[1];
  ok('★ 阶段 kind/key 变成 targets[]（引擎只认 targets）', Array.isArray(st0.targets) && st0.targets.length === 1);
  ok('★ targets 带 id（不然计数变量名是 q_x_undefined）', st0.targets[0].id === 't0', JSON.stringify(st0.targets[0]));
  ok('★ onDone 归一到 effects（引擎读的是 effects）', st0.effects === 'say:小二告诉你镖师往东边去了', JSON.stringify(st0.effects));
  ok('　onDone 字段已被清掉（不留两套写法）', st0.onDone === undefined);
  ok('　lock / descByLine / descByGender 原样保留', !!(st1.lock && st1.lock.flag === 'pre_a1_chuan' && st1.descByLine.orthodox && st1.descByGender.female));
  ok('★ 奖励对象 → 效果数组（引擎要数组）', Array.isArray(q.rewards) && q.rewards.some(r => r.type === '+exp' && r.args[0] === 100)
    && q.rewards.some(r => r.type === '+money') && q.rewards.some(r => r.type === '+item'), JSON.stringify(q.rewards));
  ok('★ 条件文本 → 条件对象', !!(q.require && q.require.and), JSON.stringify(q.require));
  {
    const d = norm.dialogues[0];
    ok('★ 对话选项文本 → 结构化', Array.isArray(d.nodes[0].options), JSON.stringify(d.nodes[0].options));
    ok('　指向真实节点的判为 next', d.nodes[0].options[0].next === 'n2', JSON.stringify(d.nodes[0].options[0]));
    ok('　不是节点的判为 effect（-> kill 是开战效果）', d.nodes[0].options[1].effect === 'kill', JSON.stringify(d.nodes[0].options[1]));
  }

  console.log('===== ② 条件真能判定（不只是解析成对象） =====');
  {
    e.newGame({ name: '试', birth: 'noble', gender: 'male' });   // noble → orthodox, act=1
    const p = e.world.player;
    const ML = require(path.join(ROOT, 'game/src/core/mainline.js'));
    ok('★ 正派 + 第 1 幕 → 门槛不满足（act>=2 挡住）',
      evalCond(q.require, { player: p, world: e.world }) === false,
      'line=' + ML.stateOf(p).line + ' act=' + ML.stateOf(p).act);
    p.quests['q_main_jianghu'] = 99;   // 第一幕做完 → act=2
    const rAct2 = evalCond(q.require, { player: p, world: e.world });
    ok('★ 正派 + 第 2 幕 → 门槛满足', rAct2 === true,
      'r=' + JSON.stringify(rAct2) + ' typeof=' + typeof rAct2
      + ' line=' + ML.stateOf(p).line + ' act=' + ML.stateOf(p).act
      + ' require=' + JSON.stringify(q.require));
    const p2 = new (require(path.join(ROOT, 'game/src/core/character.js')).Character)({ name: '丙' });
    const e2 = new GameEngine({ seed: 5 });
    await e2.boot({});
    e2.newGame({ name: '丙', birth: 'grudge_orphan', gender: 'male' });   // outlaw
    e2.world.player.quests['q_main_jianghu'] = 99;
    ok('★ 反派 → 门槛不满足（line=orthodox 挡住）',
      evalCond(q.require, { player: e2.world.player, world: e2.world }) === false);
    void p2;
  }
  console.log('===== ③ 制作器写的「悟性>=20」要真读属性（不是读 var） =====');
  {
    const r2 = e.normalizeSpec({ meta: { id: 'm2', name: 'm2' }, quests: [{ id: 'q2', name: 'q2', require: '悟性>=20' }] }).quests[0].require;
    ok('解析成 attr 分支', !!(r2 && r2.attr === '悟性' && r2['>='] === 20), JSON.stringify(r2));
    const p = e.world.player;
    const before = evalCond(r2, { player: p, world: e.world });
    /* ⚠️ 必须改 **baseAttr** 再 recalc： 是 recalc 算出来的派生快照，
       直接写它会被下一次 recalc 抹掉（实测「加了 30 点判定还是 false」）。 */
    p.baseAttr['悟性'] = (p.baseAttr['悟性'] || 0) + 30;
    p.recalc && p.recalc();
    const after = evalCond(r2, { player: p, world: e.world });
    ok('★ 悟性加上去之后判定真的变了（说明读的是属性）', after === true && before === false, before + '→' + after);
  }

  console.log('===== ④ 产物：剧情与对话都要进 mod.json =====');
  const { files, manifest } = e.buildModFiles(norm);
  ok('★ mod.json 里有 quests（原来整个剧情页被丢）', !!(manifest.quests && manifest.quests.q_mm_probe), Object.keys(manifest).join(','));
  ok('★ mod.json 里有 dialogues（原来整个对话页被丢）', !!(manifest.dialogues && manifest.dialogues.dlg_mm_probe), Object.keys(manifest.dialogues || {}).join(','));
  ok('　阶段带 effects', !!(manifest.quests.q_mm_probe.stages[0].effects));
  ok('　阶段带 lock', !!(manifest.quests.q_mm_probe.stages[1].lock));
  ok('★ 对话被挂到 NPC 的 dialog 上（不挂就永远触发不了）',
    !!(manifest.npcs && manifest.npcs.cy_pre_teaman && manifest.npcs.cy_pre_teaman.dialog === 'dlg_mm_probe'),
    JSON.stringify(manifest.npcs && manifest.npcs.cy_pre_teaman));
  ok('　产物里没有 undefined 残留', JSON.stringify(manifest).indexOf('undefined') < 0);
  void files;

  console.log('===== ⑤ 端到端：真加载这份 mod，接任务→到房→看效果触发 =====');
  {
    const { ModLoader } = require(path.join(ROOT, 'game/src/core/modloader.js'));
    const TMP = path.join(ROOT, '.packtest', 'mm_roundtrip');
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (err) { /* ignore */ }
    fs.mkdirSync(TMP, { recursive: true });
    const modDir = path.join(TMP, 'mods', 'mm_probe');
    fs.mkdirSync(modDir, { recursive: true });
    fs.writeFileSync(path.join(modDir, 'mod.json'), JSON.stringify(manifest, null, 2));

    const e3 = new GameEngine({ seed: 42, modsDir: path.join(TMP, 'mods') });   // ⚠️ 选项名是 modsDir
    await e3.boot({});
    e3.newGame({ name: '试三', birth: 'orphan', gender: 'male' });
    const w3 = e3.world, p3 = w3.player;
    void ModLoader;
    ok('★ mod 被加载（quest 进得来）', !!w3.getQuest('q_mm_probe'), Object.keys(w3.data.quests || {}).length + ' 条任务');
    ok('★ 对话进得来', !!(w3.data.dialogues && w3.data.dialogues.dlg_mm_probe));
    ok('★ NPC 身上挂上了 dialog', !!(w3.data.npcs.cy_pre_teaman && w3.data.npcs.cy_pre_teaman.dialog === 'dlg_mm_probe'));
    ok('　阶段的条件对象是引擎认的形状', !!(w3.getQuest('q_mm_probe').stages[1].lock));

    /* 真跑：接任务 → 到目标房 → 回委托人复命，看 effects 那句有没有上屏 */
    p3.room = 'jiangnan_inn';
    p3.setQuestStage('q_mm_probe', 0);
    await e3.exec('看');
    /* ⚠️ 计数变量名从**解析后的阶段**里取，别手写 —— 口径是 `t.var || 'q_'+qid+'_'+t.id`，
       手写一个 `q_mm_probe_t0` 会漏掉前缀（实测踩过）。 */
    const tgt = (e3.stageResolve(p3, w3.getQuest('q_mm_probe').stages[0]) || {}).targets[0] || {};
    const vk = tgt.var || ('q_q_mm_probe_' + tgt.id);
    ok('　到目标房攒上计数', (p3.getVar(vk) || 0) >= 1, vk + '=' + p3.getVar(vk));
    p3.room = 'road_jiangnan_1';
    w3.spawnNpc('cy_pre_teaman', 'road_jiangnan_1', 1, true);
    ok('★ 委托人身上挂上了这条任务（不挂就永远交不了）',
      !!(w3.data.npcs.cy_pre_teaman.quests || []).includes('q_mm_probe'),
      JSON.stringify(w3.data.npcs.cy_pre_teaman.quests));
    const r = await e3.exec('交任务');
    const txt = (r.lines || []).map(l => l.text).join('\n');
    ok('★ 「完成时效果」真的触发了（onDone→effects 的往返通了）', txt.indexOf('小二告诉你镖师往东边去了') >= 0, txt.slice(0, 80));
    ok('　阶段推进到 1', p3.questStage('q_mm_probe') === 1, 'stage=' + p3.questStage('q_mm_probe'));

    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (err) { /* ignore */ }
  }

  console.log('');
  console.log('Mod 制作器往返：' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
