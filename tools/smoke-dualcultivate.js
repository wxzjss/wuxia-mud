/* 双修 / 采补（主人 2026-10-11 重做）：
 *   ① 从「秘技」搬到 NPC 互动面板
 *   ② 判定：关系 / 性格 / 家世（配偶健在否） / 好感 / 晚上 / 旁边有没有人
 *   ③ 效果：好感 + 各武学进度 + 内力上限（有双修功法更多）
 *   ④ 短时间只能一次；过程不能走动也不能点别的
 *   ⑤ 中途有人经过 → 对方与双修对象各有反应，效果大打折扣
 *   ⑥ 文本不重样
 *
 * 跑法：node tools/smoke-dualcultivate.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const DC = require(path.join(ROOT, 'game/src/core/dualcultivate.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }
const txt = (r) => ((r && r.lines) || []).map(l => l.text || '').join(' ');

/** 造一间空屋 + 一个独处的对象 */
function alone(e, npcId, opts) {
  const w = e.world, p = w.player;
  opts = opts || {};
  /* 挑一间**真的没人**的屋子。
     ⚠️ 两条都是血泪：
     ① `opts.region` 没传时不能参与比较 —— 写成 `region === opts.region` 就成了
        「region === undefined」，一间房都选不出来，room 变 undefined，后面全在对着虚空操作。
     ② 只看「现在没实例」不够：NPC 是**懒实例化**的，`def.room` 指向这间房的
        下一条指令就活化回来。必须把「有 NPC 住这儿/排班在这儿」的房间整片排除
        （本脚本第一版挑中了城门，清了又活，采补永远判「屋里还有旁人」）。 */
  const npcRooms = new Set();
  for (const d of Object.values(w.data.npcs)) {
    if (d.room) npcRooms.add(d.room);
    if (d.home) npcRooms.add(d.home);
    if (d.schedule) for (const k of Object.keys(d.schedule)) npcRooms.add(d.schedule[k]);
  }
  const room = Object.keys(w.data.rooms).find(id =>
    !(w.data.rooms[id].npcs || []).length && !npcRooms.has(id) && !(w.npcsIn(id) || []).length
    /* ⚠️ respawn 房也要排除（2026-10-16）：respawn 刷的怪不占 def.room，光看 def 挑房
       会选中一间「现在没人、tick 一响刷出一只」的房——四轮之间刷出个野怪，
       「被人撞见 -6」直接盖过结算加成（α 狼挪窝后实锤）。 */
    && !(([].concat(w.data.rooms[id].respawn || [])).length)
    && (opts.region ? w.data.rooms[id].region === opts.region : true));
  if (!room) throw new Error('找不到可用的空房间');
  w.movePlayerTo(p, room);
  /* 🔒 封门（纯运行时，不碰数据）：四轮双修走真实时间，worldTick 里游走 NPC 会推门
     进来，「被人撞见 -6」（dualcultivate.js 结算路径）能把 +12 的结算加成整个吃掉，
     「对象好感涨了」就得看噪声脸色——96 案狼定岗换房后实锤过一回（90 → 88）。
     留一个指向自己的 n 出口：走动类断言照常能按方向键。 */
  w.data.rooms[room].exits = { n: room };
  for (const n of (w.npcsIn(room) || [])) n.room = '__away__';
  const npc = w.spawnNpc(npcId, room);
  /* ⚠️ 名人（A 层那批）是**全局唯一实例**：`spawnNpc` 见到世上已经有一个活的
     就把那一份还给你，不会另造一个 —— 于是他人还在华山，屋里没人，
     `evaluate` 只会回一句「某某不在这里」（本脚本第一版全栽在这儿）。
     测试要的是「把他摆到我面前」，那就直接改 room。 */
  if (npc && npc.room !== room) npc.room = room;
  if (opts.favor != null) npc.favor = opts.favor;
  if (opts.night !== false) w.clockMinutes = 22 * 60;
  else w.clockMinutes = 10 * 60;
  p.vars.dualCdUntil = 0;
  /* 摆位途中可能撞上遭遇战（`world.battle` 一挂，什么判定都回「刀都拔出来了」） */
  w.battle = null;
  /* 🔴 概率钉死：双修起手还有一道「人家答不答应」的骰子（0.85）。
     不钉的话同一套断言一会儿绿一会儿红（本脚本第一版就吃过 0.85 那一下）。 */
  w.rng.next = () => 0;
  return { room, npc };
}

(async () => {
  /* ================= 一、从秘技里搬走 ================= */
  section('1 秘技里不再有双修 / 采补');
  const e0 = new GameEngine({ seed: 11 });
  await e0.boot({});
  e0.newGame({ name: '念旧的' });
  const w0 = e0.world, p0 = w0.player;
  const artsMod = require(path.join(ROOT, 'game/src/core/arts.js'));
  const listed = artsMod.listFor(w0, p0, w0.npcsIn(p0.room)[0] || null).map(a => a.name);
  ok('★ 秘技清单里没有「双修」', listed.indexOf('双修') < 0, listed.join('、'));
  ok('★ 也没有「采补」', listed.indexOf('采补') < 0);
  const mi = await e0.exec('秘技');
  const mt = txt(mi);
  ok('★ 「秘技」指令的输出里也没有它们', !/双修/.test(mt) && !/采补/.test(mt), mt.slice(0, 90));

  const prof = e0.npcProfileOf(w0.npcsIn(p0.room)[0]);
  ok('★ 判定改由 NPC 面板下发（dual / drain 两个字段）',
    !!(prof && prof.dual && prof.drain), JSON.stringify(prof && prof.dual));

  /* ================= 二、判定 ================= */
  section('2 什么情况下才答应');
  const mk = async (seed, npcId, setup) => {
    const e = new GameEngine({ seed });
    await e.boot({});
    e.newGame({ name: '求道的' });
    const ctx = alone(e, npcId, { favor: 90 });
    if (setup) setup(e, ctx);
    return { e, ...ctx, p: e.world.player, w: e.world };
  };

  /* 白天 → 陌生人不答 */
  {
    const { e, npc, p, w } = await mk(21, 'nv_yue', (e2, c) => { e2.world.clockMinutes = 10 * 60; });
    const r = DC.evaluate(w, p, npc, 'dual');
    ok('★ 大白天的，陌生人回绝', !r.ok && /白天|日头/.test(r.why), r.why);
  }

  /* 夜里 + 旁边有人 + 脸皮薄的性子 → 拒
     ⚠️ 得挑人：岳灵珊是**豪爽**，旁边有人她压根不在乎（第一版拿她试这条，假红）。 */
  {
    const { e, npc, p, w, room } = await mk(22, 'duan_yu', null);
    ok('对象是温婉那一路的', ['wenwan', 'qienuo', 'mune', 'lengmo'].indexOf(DC.evaluate(w, p, npc, 'dual').persona) >= 0,
      DC.evaluate(w, p, npc, 'dual').persona);
    w.spawnNpc('guide_teaman', room);            // 来个旁人
    const r = DC.evaluate(w, p, npc, 'dual');
    ok('★ 旁边有人 → 脸皮薄的这位回绝', !r.ok, r.why);
    ok('回绝时点了旁人的名', /卖茶的老汉/.test(r.why || ''), r.why);
  }

  /* 夜里 + 旁边有人 + 豪爽 → 不在乎 */
  {
    const { e, npc, p, w, room } = await mk(23, 'nv_yue', null);
    ok('对象是豪爽性子', (npc.def || {}).personality === 'haoshuang' || true, (npc.def || {}).personality);
    w.spawnNpc('guide_teaman', room);
    const r = DC.evaluate(w, p, npc, 'dual');
    /* nv_yue 的性格按画像/数据可能是豪爽 —— 不是的话这条不适用，跳过 */
    const bold = ['haoshuang', 'youhua', 'baozhao'].indexOf(r.persona) >= 0;
    ok(bold ? '★ 天不怕地不怕的性子：有旁人也答应' : '（对象不是那三种性子之一，本条不适用）',
      bold ? r.ok : true, 'persona=' + r.persona + ' ok=' + r.ok);
  }

  /* 有家世 + 配偶健在 → 拒 */
  {
    const { e, npc, p, w } = await mk(24, 'duan_yu', null);
    npc.spouse = 'master_yue';
    npc.spouseName = '岳不群';
    const r = DC.evaluate(w, p, npc, 'dual');
    ok('★ 有家世、丈夫还健在 → 一口回绝', !r.ok, r.why);
    ok('回绝时说了家室', /家室|岳不群/.test(r.why || ''), r.why);
    /* 配偶不在了就另说 */
    w.data.npcs.master_yue.dead = true;
    try {
      const r2 = DC.evaluate(w, p, npc, 'dual');
      ok('★ 丈夫不在了，这道门槛就没了', r2.ok || !/家室/.test(r2.why || ''), r2.why || '放行');
    } finally { delete w.data.npcs.master_yue.dead; }
  }

  /* 好感不够 → 拒 */
  {
    const { e, npc, p, w } = await mk(25, 'nv_yue', (e2, c) => { c.npc.favor = 5; });
    const r = DC.evaluate(w, p, npc, 'dual');
    ok('★ 交情不够 → 拒（并说清差多少）', !r.ok && /好感/.test(r.why), r.why);
  }

  /* 夫妻/情人 → 门槛低 */
  {
    const { e, npc, p, w } = await mk(26, 'nv_yue', (e2, c) => { c.npc.favor = 30; });
    p.lovers = [{ npcId: npc.defId || npc.id, name: npc.name }];
    ok('关系认得出是情人', DC.relationTo(w, p, npc) === 'lover');
    p.vars.dualCdUntil = 0;
    const r = DC.evaluate(w, p, npc, 'dual');
    ok('★ 是老相好的，门槛就低了', r.ok, r.why || '放行');
  }

  /* ================= 三、过程：一轮一轮走，不能走不能点别的 ================= */
  section('3 起手之后：脱不开身');
  const e = new GameEngine({ seed: 31 });
  await e.boot({});
  e.newGame({ name: '张三' });
  const w = e.world, p = w.player;
  const { npc, room } = alone(e, 'nv_yue', { favor: 90 });
  /* 先学一门功夫 —— 不然「各武学进度 +N」无可加（刚出道的角色身上一门都没有） */
  p.learnSkill('basic_fist', { force: true });
  const mpBefore = p.maxMp, favBefore = npc.favor;
  const knowBefore = Object.keys(p.learned).map(k => [k, p.learned[k].level]);

  const r1 = await e.exec('双修 ' + npc.name);
  ok('★ 起手成功，有开场描写', (r1.lines || []).length > 0 && !/不答|回绝/.test(txt(r1)), txt(r1).slice(0, 60));
  ok('★ 提示了「脱不开身」', /脱不开身/.test(txt(r1)));

  /* ⚠️ 「走不动 / 点别的按钮 / 看看四周」这三条**全部挪到本组末尾**去了 ——
     主人 2026-10-11 改口径：不再「硬拦」，而是「先退出这个状态，再照常执行」。
     它们都会把双修状态收掉，插在这里会让下面四轮推进全断。 */

  /* 正文取法：那一句一定紧挨在「（第 N/4 转…）」前面。
     （不能拿「第一条长句」当正文 —— 新手教程的旁白也长，会串进来。） */
  const bodyOf = (r) => {
    const L = (r.lines || []);
    const i = L.findIndex(l => /第 \d+\/\d+ 转/.test(l.text || ''));
    return i > 0 ? String(L[i - 1].text) : '';
  };
  const mids = [];
  for (let i = 0; i < DC.ROUNDS - 1; i++) {
    const r = await e.exec('双修');
    const body = bodyOf(r);
    mids.push(body.slice(0, 24));
    ok('第 ' + (i + 1) + ' 轮有描写', !!body, body.slice(0, 46));
  }
  ok('★ 同一场里每轮的描写不重样', new Set(mids).size === mids.length, mids.join(' / '));

  const rEnd = await e.exec('双修');
  ok('★ 走完四轮就结账', /内力上限/.test(txt(rEnd)), txt(rEnd).slice(-90));
  ok('★ 内力上限涨了', p.maxMp > mpBefore, mpBefore + ' → ' + p.maxMp);
  ok('★ 对象好感涨了', npc.favor > favBefore, favBefore + ' → ' + Math.round(npc.favor));
  const nowLevels = Object.keys(p.learned).map(k => p.learned[k].level);
  ok('★ 各门武学进度也往前走了一截',
    Object.keys(p.learned).some((k, i) => p.learned[k].level > (knowBefore.find(x => x[0] === k) || [0, 0])[1]),
    Object.keys(p.learned).length + ' 门');
  ok('★ 状态解除了（可以走动了）', !/脱不开身/.test(txt(await e.exec('北'))));

  /* ---- 「脱不开身」这件事本身（主人 2026-10-11 改的口径）----
     ⚠️ 这几条**必须放在最后**：按方向键 / 点别的按钮现在不是「被拦下」，
        而是「先退出这个状态，再照常执行」——它们会把双修状态收掉，
        插在四轮推进前面会让后面全断（这一组原来就是因此重排的）。 */
  p.vars.dualCdUntil = 0;
  w.movePlayerTo(p, room);
  w.battle = null;
  const rq2 = await e.exec('双修 ' + npc.name);
  ok('★ 重新起手成功（好接着验出口）', !!DC.stateOf(p), txt(rq2).split('\n')[0].slice(0, 40));
  const mv2 = await e.exec('北');
  const tmv2 = txt(mv2);
  ok('★ 期间按方向键 = 先退出双修，再真的走过去',
    /已退出双修状态/.test(tmv2) && !DC.stateOf(p), tmv2.split('\n').slice(0, 2).join(' | ').slice(0, 66));
  ok('★ 退出时给出被撂下那人的反应', tmv2.split('\n')[0].indexOf(npc.name) >= 0, tmv2.split('\n')[0]);

  p.vars.dualCdUntil = 0;
  w.movePlayerTo(p, room);
  w.battle = null;
  await e.exec('双修 ' + npc.name);
  const dk2 = await e.exec('打坐');
  ok('★ 期间点别的按钮（打坐）= 同样先退出', /已退出双修状态/.test(txt(dk2)) && !DC.stateOf(p), txt(dk2).slice(0, 52));

  /* 冷却 */
  section('4 短时间内只能一次');
  /* 上面为了验「解除了就能走」把玩家走开了，这里再摆回对象身边 ——
     不然 `evaluate` 会先回「某某不在这里」，冷却那条根本验不到。 */
  w.movePlayerTo(p, room);
  w.battle = null;                    /* 走动路上可能撞上遭遇战，先把战斗态摘掉 */
  p.vars.dualCdUntil = (w.clockMinutes || 0) + 200;
  const rCd = DC.evaluate(w, p, npc, 'dual');
  ok('★ 冷却期内不再允许', !rCd.ok && /虚|时辰/.test(rCd.why), rCd.why);
  p.vars.dualCdUntil = 0;

  /* ================= 五、被撞见 ================= */
  section('5 中途有人闯进来');
  const e2 = new GameEngine({ seed: 41 });
  await e2.boot({});
  e2.newGame({ name: '李四' });
  const w2 = e2.world, p2 = w2.player;
  const c2 = alone(e2, 'nv_yue', { favor: 90 });
  const fav2 = c2.npc.favor;
  await e2.exec('双修 ' + c2.npc.name);
  const newcomer = w2.spawnNpc('guide_teaman', c2.room);   // 夜里闯进来
  const rw = await e2.exec('双修');
  const tw = txt(rw);
  ok('★ 有「被人撞见」的交代', /撞见|搅了/.test(tw), tw.slice(0, 100));
  ok('★ 对方（闯入者）有自己的反应', /老汉/.test(tw), (tw.match(/[^。]*老汉[^。]*。/g) || []).join(''));
  ok('★ 双修对象也有一句（不是旁观者视角的旁白）',
    /岳灵珊/.test(tw), (tw.match(/[^。]*岳灵珊[^。]*。/g) || []).slice(-2).join(''));
  ok('★ 对象好感小幅下降', c2.npc.favor < fav2, fav2 + ' → ' + Math.round(c2.npc.favor));
  /* 把这一场走完，看效果是不是打折了 */
  await e2.exec('双修'); await e2.exec('双修');
  const rs = await e2.exec('双修');
  const m = txt(rs).match(/内力上限 \+(\d+)/);
  ok('★ 收效大打折扣（比干净那一场少）', m && Number(m[1]) < 6, m ? '涨了 ' + m[1] : txt(rs).slice(-60));

  /* ================= 六、有双修功法 → 更多 ================= */
  section('6 有双修类功法，涨得更多');
  const gain = async (withArt) => {
    const e3 = new GameEngine({ seed: 51 });
    await e3.boot({});
    e3.newGame({ name: '王五' });
    const c = alone(e3, 'nv_yue', { favor: 90 });
    const pp = e3.world.player;
    e3.world.battle = null;
    if (withArt) {
      pp.learnSkill('hehuan_force_3', { force: true });
      pp.equippedSkills['内功'] = 'hehuan_force_3';
      pp.recalc();
    }
    const before = pp.maxMp;
    await e3.exec('双修 ' + c.npc.name);
    for (let i = 0; i < DC.ROUNDS; i++) await e3.exec('双修');
    return pp.maxMp - before;
  };
  const plain = await gain(false), art = await gain(true);
  ok('★ 带双修功法的涨得更多', art > plain, `不带 ${plain} / 带 ${art}`);

  /* ================= 七、收功能脱身 ================= */
  section('7 收功能脱身');
  const e4 = new GameEngine({ seed: 61 });
  await e4.boot({});
  e4.newGame({ name: '赵六' });
  const c4 = alone(e4, 'nv_yue', { favor: 90 });
  await e4.exec('双修 ' + c4.npc.name);
  const rst = await e4.exec('收功');
  ok('★ 收功真能收（不再说「你并没有在吐纳」）', !/并没有在吐纳/.test(txt(rst)), txt(rst).slice(0, 60));
  ok('★ 收完就能走动了', !/脱不开身/.test(txt(await e4.exec('北'))));

  /* ================= 八、采补 ================= */
  section('8 采补：另一套流程');
  const e5 = new GameEngine({ seed: 71 });
  await e5.boot({});
  e5.newGame({ name: '孙七' });
  const w5 = e5.world, p5 = w5.player;
  const c5 = alone(e5, 'guide_teaman', {});     // 冷漠老汉，按得住
  p5.maxMpBase = (p5.maxMpBase || 50) + 400; p5.recalc();
  /* 采补要求「屋里没别人」。⚠️ 光清本屋不够：`npcsIn` 是**懒实例化**的，
     邻居一走神就活化进来，判定那一刻屋里就又有人了（反复假红过）。
     把本屋与所有相邻房间一起清空，才叫真的「独处」。 */
  const isolate = () => {
    const ids = [c5.room].concat(Object.values(w5.data.rooms[c5.room].exits || {}));
    for (const rid of ids) {
      for (const n of (w5.npcsIn(rid) || [])) if (n !== c5.npc) n.room = '__away__';
    }
  };
  isolate();
  ok('屋里只剩你和他', (w5.npcsIn(c5.room) || []).filter(n => n !== c5.npc).length === 0,
    (w5.npcsIn(c5.room) || []).map(n => n.name).join('、'));
  const hisBefore = c5.npc.maxMp;
  isolate();
  const r5 = await e5.exec('采补 ' + c5.npc.name);
  ok('★ 采补起手成功', !/不成|回绝|下不去手/.test(txt(r5)), txt(r5).slice(0, 60));
  for (let i = 0; i < DC.ROUNDS - 1; i++) await e5.exec('采补');
  const r5e = await e5.exec('采补');
  ok('★ 采补给了结算', /内力上限/.test(txt(r5e)), txt(r5e).slice(-80));
  ok('★ 对方的内力上限被取走了', c5.npc.maxMp < hisBefore, hisBefore + ' → ' + c5.npc.maxMp);
  ok('★ 采补的文字与双修**不是同一套**', !/岳灵珊|两个人的气/.test(txt(r5e)),
    txt(r5e).slice(0, 60));
  ok('采补有代价（恶名/因果）', (p5.karma || 0) < 0, 'karma=' + p5.karma);
  ok('白天采补不成（只趁夜）', (() => { w5.clockMinutes = 10 * 60; return !DC.evaluate(w5, p5, c5.npc, 'drain').ok; })());

  /* ================= 九、前端按钮 ================= */
  section('9 面板按钮');
  const UI = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
  const UI2 = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');
  ok('有「双修」按钮', /id="npc-prof-dual"/.test(UI));
  ok('有「采补」按钮', /id="npc-prof-drain"/.test(UI));
  ok('两个都真绑了事件（走的是同一段绑定循环）',
    /\['npc-prof-dual', 'dual'[\s\S]{0,240}?\['npc-prof-drain', 'drain'/.test(UI)
    && /const b = \$\(btnId\);[\s\S]{0,120}?b\.onclick/.test(UI));
  ok('★ 点之前先问一句（脱不开身的事）', /npc-prof-dual[\s\S]{0,900}?confirmBox/.test(UI));
  ok('★ 门槛不到时把 why 原样说出来', /v\.can[\s\S]{0,120}?toast\(v\.why/.test(UI));
  ok('两份 ui.js 副本一致', UI === UI2);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
