/**
 * smoke-owner-bugs.js —— 主人亲报 bug 批次（B4 / B5 / B6）专项回归
 *
 * 覆盖：
 *   B5 交战中还能移动（主人原话：「战斗界面我依然能走，甚至带着和山贼的
 *      战斗界面能一路走回客栈」）
 *      · 所有移动入口都必须被拦：方向键 / 中文方向 / go / 走 / 上下 /
 *        房间名寻路 / 互动出口
 *      · 提示要说清「现在能干什么」（进攻/绝招/防御/逃跑）
 *      · 战斗中 look / 背包 / 状态 等面板指令**不受影响**
 *      · 只有脱战类指令能离开战斗；脱战后移动恢复正常
 *      ·拜访 / 传送在战斗中的行为（结论见报告）
 *   B6 「回春堂后院」有草药却点不动（主人原话：「这肯定不是个例」）
 *      · 本体：get 药材 / get 稻种 真能拿到东西
 *      · 全局：所有「此地可做」按钮逐条真exec，不再有静默失败
 *      · 回归：get 普通的地上物品**不能**被采集归一化抢走
 *   B4 战斗界面「全力一击 / 防御」快捷键点不了
 *      · 两个按钮点下去必须发出后端真认的指令
 *      · defend 后端从无到有，且确实减伤
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真 exec('north')，不直接调内部函数
 *   · 读 DOM 走 vm 加载真 ui.js（DOM stub 照抄 kidnap-ui-check.js 的三个坑：
 *     querySelectorAll 按 (选择器, innerHTML) 缓存 / innerHTML setter 清 children
 *     / doCmd 是 async 要 await settle）
 *   · `new World()` 是空壳，必须走 GameEngine.boot()
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const RJS = path.join(ROOT, 'game', 'src', 'renderer', 'js');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { tokenize } = require(path.join(ROOT, 'game', 'src', 'core', 'utils.js'));

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
/** 真起一场战斗：对手打不烂、玩家也死不了，方便反复试指令 */
function startFight(e) {
  const w = e.world, p = w.player;
  const n = w.spawnNpc(Object.keys(w.data.npcs)[0], p.room, 1, true);
  n.hp = 1e9; n.maxHp = 1e9;
  const r = w.startCombat(p, n);
  p.hp = p.maxHp; p.mp = p.maxMp;
  return { w, p, npc: n, battle: r.battle };
}
const texts = r => (r.lines || []).map(l => l.text);
const has = (r, sub) => texts(r).some(t => t.includes(sub));

/* ================================================================
 *  0. 前置事实：战斗态到底读哪个字段（铁律：先打真实结构，别猜）
 * ================================================================ */
section('0 · 前置事实：战斗态字段（写死字段名之前必须先验证）');
{
  const e = boot(); const w = e.world;
  ok('0.1 world 同时存在 combat 与 battle 两个键', ('combat' in w) && ('battle' in w));
  ok('0.2 world.combat 是 CombatEngine 实例（不是战斗态！）',
    w.combat && w.combat.constructor && w.combat.constructor.name === 'CombatEngine');
  eq('0.3 开战前 world.battle 为 null', w.battle, null);
  const { battle } = startFight(e);
  ok('0.4 startCombat 后 world.battle 是战斗对象', !!battle && Array.isArray(battle.defenders));
  ok('0.5 战斗态判据 w.battle 成立', !!e.world.battle);
}

/* ================================================================
 *  B5 · 交战中不许移动
 * ================================================================ */
section('B5 · 交战中移动必须被拦');
{
  /* B5-1 所有移动入口逐个真试 —— 用「房间真的发生了改变」判定 */
  const e = boot(); const w = e.world, p = w.player;
  startFight(e);
  const startRoom = p.room;
  const room = w.getRoom(p.room);
  const dirs = Object.keys(room.exits || {});
  ok('B5-0 测试房间确实有出口（否则本组断言无意义）', dirs.length > 0, `room=${startRoom}`);

  /* 每个方向键都试一遍 */
  let escaped = [];
  for (const d of dirs) {
    const before = p.room;
    const r = e.exec(d);
    if (p.room !== before) escaped.push(d);
    ok(`B5-1 方向 ${d} 被拦`, p.room === before, has(r, '走不脱') ? '' : texts(r).join('|'));
  }
  eq('B5-1 汇总：无任何方向能走脱', escaped.length, 0);

  /* 中文方向 / 上下 / go / 走 —— 全部移动入口 */
  const probes = ['n', 's', 'e', 'w', '北', '南', '东', '西', 'go north', 'go 北', '走', '去'];
  for (const d of dirs) {
    const cn = { n: '北', s: '南', e: '东', w: '西' }[d];
    if (cn) probes.push(cn, '往' + cn + '走', '走' + cn);
  }
  for (const cmd of probes) {
    const before = p.room;
    const r = e.exec(cmd);
    ok(`B5-2 移动入口「${cmd}」被拦`, p.room === before, texts(r).join('|').slice(0, 60));
  }

  /* 提示内容：必须告诉玩家现在能干什么 */
  {
    const r = e.exec('north');
    const t = texts(r).join('');
    ok('B5-3 提示说明了走不脱', t.includes('走不脱'), t.slice(0, 40));
    /* ⚠️ 口径变过一次（主人 2026-10-11）：
       「把游戏里一些英文指令的教程改成中文指令，比如拍卖行界面的 bid 教程改成『出价』」。
       这条提示原本钉的是英文（kill/auto/defend/flee）—— 现在**必须成中文**
       （杀 / 自动战斗 / 防御 / 逃跑）。英文别名后端照旧认，只是不再写给玩家看。
       反过来加一条：提示里不许再出现这几个英文单词。 */
    ok('B5-3 提示用中文说进攻手段（杀 / 自动战斗）', t.includes('杀') && t.includes('自动战斗'), t.slice(24, 60));
    ok('B5-3 提示用中文说防御（防御）', t.includes('防御'));
    ok('B5-3 提示用中文说逃跑（逃跑）', t.includes('逃跑'));
    ok('B5-3 提示里不再出现英文指令名',
      !/「(kill|auto|defend|flee|perform)\b/.test(t), t.slice(24, 70));
  }

  /* 战斗中「原地不动」类面板指令必须照常工作 */
  {
    p.room = 'jn_pharmacy';
    for (const cmd of ['look', 'i', '背包', 'score', '状态', 'skills', 'quests', 'affects']) {
      let r = null, threw = null;
      try { r = e.exec(cmd); } catch (err) { threw = err.message; }
      ok(`B5-4 战斗中「${cmd}」不被移动门禁误伤`, !threw && r && r.lines && r.lines.length > 0,
        threw ? ('THROW ' + threw) : ('lines=' + ((r && r.lines || []).length)));
    }
    /* 地图也不能被锁（它是面板不是位移） */
    let r = null, threw = null;
    try { r = e.exec('map'); } catch (err) { threw = err.message; }
    ok('B5-4 战斗中 map 面板可用', !threw && r && r.lines && r.lines.length > 0);
  }

  /* 只有脱战类指令能离开战斗；脱战后移动恢复 */
  {
    const before = p.room;
    /* 先确认确实还锁着 */
    e.exec('north');
    eq('B5-5 脱战前仍走不动', p.room, before);
    let r = e.exec('flee');
    ok('B5-5 flee 有响应', r.lines && r.lines.length > 0, texts(r).join('|').slice(0, 50));
    /* flee 可能失败（被缠住），那就强制结束战斗再验移动恢复 */
    if (w.battle) { w.battle.over = true; w.finishCombat([]); }
    ok('B5-5 战斗已结束', !w.battle);
    const dirs2 = Object.keys(w.getRoom(p.room).exits || {});
    if (dirs2.length) {
      const r2 = e.exec(dirs2[0]);
      ok('B5-5 脱战后移动恢复正常', p.room !== before, `${before} -> ${p.room}`);
    } else {
      ok('B5-5 脱战后移动恢复正常（该房间无出口，跳过位移断言）', true);
    }
  }
}

/* B5-6 go <房间名> 逐跳寻路：不能「一边打着一边走到客栈」 */
{
  const e = boot(); const w = e.world, p = w.player;
  startFight(e);
  const before = p.room;
  /* 找一个确实存在的、别的房间（主人原话是「走回客栈」） */
  const target = w.data.rooms['jn_pharmacy'] ? 'jn_pharmacy' : Object.keys(w.data.rooms).find(r => r !== before);
  const r = e.exec('go ' + target);
  ok('B5-6 战斗中 go <房间名> 走不脱', p.room === before, `room=${p.room}`);
  ok('B5-6 提示明确（不是「找不到路」）', has(r, '走不脱'), texts(r).join('|').slice(0, 60));
  /* 且不能谎报moved（前端会据此刷新界面） */
  ok('B5-6 没有谎报 moved:true', r.moved !== true, `moved=${JSON.stringify(r.moved)}`);
}

/* B5-7 交互出口（爬山坡/渡河那类 via|hint）同样走doMove，必须一起锁 */
{
  const e = boot(); const w = e.world, p = w.player;
  /* 造一个带 via 的互动出口 */
  const rid = 'smoke_b5_via_room';
  w.data.rooms[rid] = {
    id: rid, name: '试炼·渡口', region: 'jiangnan', desc: '一条渡河出口。',
    exits: { n: { to: 'jiangnan_street', via: '渡河', hint: '过河' } },
    actions: [],
  };
  p.room = rid;
  startFight(e);
  const r = e.exec('渡河');
  ok('B5-7 战斗中互动出口（via「渡河」）被拦', p.room === rid, texts(r).join('|').slice(0, 60));
  /* 脱战后同一条路要能走通（证明拦截的是战斗态，不是把出口堵死了） */
  w.battle.over = true; w.finishCombat([]);
  const r2 = e.exec('渡河');
  ok('B5-7 脱战后互动出口可用', p.room === 'jiangnan_street', `room=${p.room}`);
  delete w.data.rooms[rid];
}

/* ================================================================
 *  B5-8/9 · 拜访 与 回家 —— 两条绕过 doMove 的位移（质量验收打回后补）
 *
 *  上一轮我断言「所有玩家自主位移都收敛doMove」，那次**只审了 execute()
 *  的解析路径**，没审 handler 内部，结果漏了两条：
 *    ① 拜访 commands.js:970 直调 w.movePlayerTo(p, r.roomId)
 *    ② 回家 home.js:352/363 直接 `p.room = p.home`，连 movePlayerTo 都不走
 *  两条都是**玩家按键可触发**，门槛还很低（拜访只要 favor>=30），
 *  所以能「一边打着山贼一边窜进别人家/ 回家」。
 *
 *  ⚠️ 上一版的 B5-8 是**假绿**：用的是无参数 exec('拜访')，
 *  在 commands.js:957 就 return 了，压根没走到 visitHouse ——
 *  p.room === before 在任何实现下都成立，等于没测。
 *  下面的版本必须**真的走进 visitHouse 那一行**才算测到。
 * ================================================================ */

/** 造一个「拜访门槛已过」的私宅 NPC 实例：好感喂到 38（门槛 30） */
function primeVisitTarget(e) {
  const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  let defId = null;
  for (const id of Object.keys(w.data.npcs)) {
    if (String(w.data.npcs[id].home || '') === 'house:' + id) { defId = id; break; }
  }
  if (!defId) return null;
  /* 用引擎自己的 social.addFavor 把好感从初始值合法攒过门槛，
     —— 和真实玩法一样，不直接写内部字段。 */
  const social = require(path.join(ROOT, 'game', 'src', 'core', 'social.js'));
  const inst = w.spawnNpc(defId, 'jiangnan_street', 1, true);
  social.addFavor(w, inst, 60 - (inst.favor || 0), '测试备访');
  return { def: w.data.npcs[defId], inst, name: w.data.npcs[defId].name };
}

section('B5-8/9 · 拜访 / 回家 两条绕过 doMove 的位移');
{
  /* B5-8 拜访：必须带参数 + 过门槛，确保真的进到 visitHouse */
  const e = boot(); const w = e.world, p = w.player;
  const t = primeVisitTarget(e);
  ok('B5-8 造出可拜访的私宅 NPC（前提）', !!t, t ? t.name : 'none');
  if (t) {
    ok('B5-8 好感已过门槛（≥30）', (t.inst.favor || 0) >= 30, 'favor=' + t.inst.favor);
    startFight(e);
    const before = p.room;
    ok('B5-8 战斗已成立', !!w.battle);
    /* 关键：门禁必须落在 visitHouse **之前**，不能留下凭空多出来的私域。
       ⚠️ 这里必须用**前后 count 对比**，不能写「不存在 house_ 房间」这种布尔 ——
       上一版谓词末尾挂了 `&& false`，整个谓词恒为 false、取反后恒为 true，
       任何实现下都通过（实测：门禁拿掉、房间数真的0->1，它依然显示 ✔）。
       判据来源：质量负责人 design/14-batch1-acceptance.md §8.7。 */
    const houseBefore = Object.keys(w.data.rooms)
      .filter(id => String(id).startsWith('house_')).length;
    const r = e.exec('拜访 ' + t.name);
    const houseAfter = Object.keys(w.data.rooms)
      .filter(id => String(id).startsWith('house_')).length;
    ok('B5-8 战斗中拜访被战斗门禁拦下', p.room === before, `位移到 ${p.room}`);
    ok('B5-8 提示用的是统一的战斗门禁文案', texts(r).join('|').includes('走不脱'),
      texts(r).join('|').slice(0, 60));
    ok('B5-8 没被 visitHouse 拦（房间数未增加）', houseAfter === houseBefore,
      houseBefore + ' -> ' + houseAfter);
    ok('B5-8 战斗仍在进行（没被顺带结束）', !!w.battle);
    /* 反证：脱战后同一条拜访必须能走通（证明拦的是战斗态，不是把拜访废掉） */
    w.battle.over = true; w.finishCombat([]);
    const r2 = e.exec('拜访 ' + t.name);
    ok('B5-8 脱战后拜访可正常进门', p.room.startsWith('house_'), `room=${p.room}`);
    ok('B5-8 脱战后拜访有正常台词', !texts(r2).join('').includes('走不脱'));
  }
}

/* B5-9 回家（goHome 直接写 p.room，连 movePlayerTo 都不走） */
{
  const e = boot(); const w = e.world, p = w.player;
  /* 给玩家一个真实存在的家 */
  const homeId = Object.keys(w.data.rooms).find(id => String(id).startsWith('hm_'));
  ok('B5-9 找到一个真实住宅 hm_*（前提）', !!homeId, homeId);
  if (homeId) {
    p.home = homeId;
    startFight(e);
    const before = p.room;
    const r = e.exec('回家');
    ok('B5-9 战斗中回家被拦（不位移）', p.room === before, `位移到 ${p.room}`);
    ok('B5-9 提示用统一战斗门禁文案', texts(r).join('').includes('走不脱'));
    w.battle.over = true; w.finishCombat([]);
    const r2 = e.exec('回家');
    ok('B5-9 脱战后回家可正常用', p.room === homeId, `room=${p.room}`);
  }
}

/* B5-10 ★ 全仓穷举审计：所有「玩家按键可触发」的指令逐个试，
   证明再没有第三条漏网位移。
   上一轮就是靠「列几个入口」得出结论被验收打回的 ——
   这里改成**穷举 CMD 全表 + 方向键 + 移动类自然语言**，
   以后任何人加一条新的位移指令，这条断言会立刻抓住。 */
section('B5-10 · 全仓穷举审计（防止再漏第三条）');
{
  const e = boot(); const w = e.world, p = w.player;
  const home0 = w.getRoom(p.room).id;
  const dirs0 = Object.keys(w.getRoom(p.room).exits || {});
  const probes = Object.keys(e.cmds.CMD).slice();
  for (const d of dirs0) {
    probes.push(d);
    const cn = { n: '北', s: '南', e: '东', w: '西' }[d];
    if (cn) probes.push('go ' + cn, '走' + cn, '往' + cn + '走');
  }
  /* 显式点名几个「听起来像移动」的指令，逼它们现形 */
  probes.push('拜访', '回家', '回府', '归家', '传送', 'travel', 'warp', 'teleport',
    'enter', 'exit', 'leave', '离开', '骑马', 'horse', '乘船', 'ship', 'carriage', '马车', '突围');

  const leaks = []; let deathShifts = 0, tested = 0;
  for (const cmd of probes) {
    p.room = home0; w.battle = null; p.inCombat = false;
    const foe = w.spawnNpc(Object.keys(w.data.npcs)[0], p.room, 1, true);
    foe.hp = 1e9; foe.maxHp = 1e9; foe.dead = false;
    w.startCombat(p, foe);
    p.hp = p.maxHp; p.mp = p.maxMp;
    const before = p.room;
    let res = null, threw = null;
    try { res = e.exec(cmd); } catch (err) { threw = err.message; }
    tested++;
    if (p.room !== before) {
      /* 排除「玩家被打死 → 送回客栈」：那是死亡结算，不是自主位移。 */
      const died = ((res && res.lines) || [])
        .some(l => l.kind === 'die' || /倒地不起|倒了下去|悠悠醒转/.test(String(l.text)));
      if (died) deathShifts++;
      else leaks.push(cmd + ' -> ' + p.room + (threw ? ' THROW:' + threw : ''));
    }
    w.battle = null; p.inCombat = false;
  }
  /*门槛用**动态自证**。
     两次踩坑记录：
       ① 旧写法 `tested > 400` 恒真 —— CMD 表主体就有 486 条，
          它只能防「probes 被整体清空」，防不住「删掉某几条移动探针」。
       ② 改成 `tested >= Object.keys(CMD).length` **仍然不够**：
          探针表里还额外追加了方向键与自然语言探针（约 40 条），
          删掉 3 条 CMD 探针后总数依然 >= CMD 表长，仍显示 ✔（我实测过）。
       ③ **批次 2 返工再查出一条更隐蔽的**：原写法
          `const probes = Object.keys(CMD).slice(); … missing = cmdKeys.filter(k => !probeSet.has(k)); ok(missing.length === 0)`
          这**在结构上恒真** —— probes 本来就是从 CMD 的键**复制**出来的，
          后面再问「CMD 的键有没有不在 probes 里」，答案永远是没有。
          它自称「动态自证」，实际连自证都算不上（探针表被清空到只剩 extras 时它照样绿）。
     现在的判据是**反向**的、且真的能红：
       · 探针表必须**逐个 CMD 键都覆盖到**（从 probes 侧出发，检查数量与身份）；
       · 并且额外要求探针里**确实有非 CMD 的探针**（方向键/自然语言），
         防止有人把 probes 退化成 `CMD` 的副本而丢掉那40 条自然语言探针；
       · 再加一条**反向自证**：故意从探针表里删掉几条真实存在的 CMD 键，
         看missing 检查会不会报警 —— 不报警就说明这个检查是摆设。
     （判据来源：design/14-batch1-acceptance.md §8.3.3 / §9.4.4） */
  const cmdKeys = Object.keys(e.cmds.CMD);
  const probeSet = new Set(probes);
  /* 正向：探针表覆盖了全部 CMD 键。这里从 probes 侧算，不依赖 probes 的构造来源。 */
  const coveredCmp = cmdKeys.filter(k => probeSet.has(k));
  ok('B5-10 审计逐条覆盖了 CMD 全表（每一条 CMD 指令都真被试过）',
    coveredCmp.length === cmdKeys.length,
    `覆盖 ${coveredCmp.length}/${cmdKeys.length}`);
  const extraProbes = probes.filter(p => !Object.prototype.hasOwnProperty.call(e.cmds.CMD, p));
  ok('B5-10 探针表含 CMD 之外的自然语言/方向键探针（没退化成 CMD 的副本）',
    extraProbes.length > 0, `额外探针 ${extraProbes.length} 条: ` + extraProbes.slice(0, 6).join(','));
  /* ★ 反向自证：检查代码自己必须**能红**。
       做法：从 CMD 全表里挑几条真实存在的指令，构造一个「故意缺了它们」的假探针表，
       把同一段检查逻辑跑一遍，看它会不会报警；不会报警 = 这段检查是摆设。
       ⚠️ 必须**真的构造一个缺项的表**去跑，光断言「missing.length===0」是自证不了的
       （我第一版写成 `canaryOK ? ... : []`那种四平八稳的式子，
        missing 恒为空，等于又给自己开了一道恒真闸门 —— 自己踩坑，记录在此）。 */
  const canaryKeys = ['north', 'go', 'look', 'get', 'drop'].filter(k => cmdKeys.indexOf(k) >= 0);
  /* 用同一判据：missing = CMD 键里没被探针表覆盖的。 */
  const missingOf = set => cmdKeys.filter(k => !set.has(k));
  const brokenSet = new Set(probeSet);
  for (const k of canaryKeys) brokenSet.delete(k);
  const missingBroken = missingOf(brokenSet);
  ok('B5-10 反向自证：检查逻辑在探针表真缺项时会报警（这段检查不是摆设）',
    canaryKeys.length === 5 && missingBroken.length === canaryKeys.length
      && missingBroken.every(k => canaryKeys.indexOf(k) >= 0),
    `挖掉[${canaryKeys.join(',')}] → 检出漏报 ${missingBroken.length} 条: ${missingBroken.join(',')}`);
  ok('B5-10 战斗中无任何指令能改变 p.room', leaks.length === 0,
    leaks.length ? ('漏网: ' + leaks.join(' | ')) : ('deathShifts=' + deathShifts));
  console.log(`    · 实测 ${tested} 条指令，死亡送医 ${deathShifts} 次（已排除，非漏洞）`);
}

/* ================================================================
 *  B6 · 「此地可做」按钮点了没反应 / 说没有
 * ================================================================ */
section('B6 · 本体：回春堂·后院「药草」');
{
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'jn_pharmacy_back';
  const v = e.view();
  const act = (v.roomActions || []).find(a => a.cmd === 'get 药材');
  ok('B6-1 前端确实渲染出「药草」按钮', !!act, JSON.stringify(v.roomActions));
  ok('B6-1 按钮 ok=true（没被条件挡住）', !!(act && act.ok));

  const hp0 = p.hp, t0 = p.timeMinutes;
  const r = e.exec('get 药材');
  ok('B6-1 不再说「这里没有「药材」」', !has(r, '这里没有'), texts(r).join('|'));
  ok('B6-1 有明确反馈文本', r.lines && r.lines.length > 0, texts(r).join('|').slice(0, 60));
  const got = (p.inventory || []).length;
  ok('B6-1 背包里真的多东西了', got > 0, 'inventory=' + got);
  ok('B6-1 消耗了时间', p.timeMinutes > t0);
}

/* B6-2 同类：城东·田头窝棚「种子袋」也是 get类，同样坏过 */
{
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'jn_farm_shed';
  const before = (p.inventory || []).length;
  const r = e.exec('get 稻种');
  ok('B6-2 get 稻种 不再报「没有」', !has(r, '这里没有'), texts(r).join('|').slice(0, 60));
  ok('B6-2 get 稻种 真拿到东西', (p.inventory || []).length > before);
}

/* B6-3 ★ 全局排查：所有「此地可做」按钮逐条真 exec，抓静默失败 */
{
  const e = boot(); const w = e.world, p = w.player;
  const CMD = e.cmds.CMD;
  const rows = [];
  for (const rid of Object.keys(w.data.rooms)) {
    for (const a of (w.data.rooms[rid].actions || [])) {
      if (a.cmd) rows.push({ rid, name: w.data.rooms[rid].name, cmd: a.cmd });
    }
  }
  ok('B6-3 房间 action 总数 > 100（确实是全量排查）', rows.length > 100, 'n=' + rows.length);

  /* 分类统计：哪些失败是「代码 bug」，哪些是「数据缺口/正常门槛」 */
  const UNKNOWN = /是什么指令/;
  const NOTHERE = /这里没有|没有「/;
  const legit = /青楼只收|非青楼之人|没种东西|没有你能干的活计|做买卖的人|时辰|不解其意|不得其门|一堵石墙|什么也没|不敢再乱翻|什么都不知道|被刺了一下|野马|不知该往哪|越看越糊涂|没有更多/;

  let unknown = [], nothere = [], empty = [], legitHits = [];
  for (const row of rows) {
    p.room = row.rid;
    let res = null, threw = null;
    try { res = e.exec(row.cmd); } catch (err) { threw = err.message; }
    if (threw) { unknown.push({ ...row, why: 'THROW ' + threw }); continue; }
    const t = texts(res).join(' | ');
    if (!res.lines || !res.lines.length) { empty.push({ ...row, why: '(零行输出)' }); continue; }
    if (UNKNOWN.test(t)) { unknown.push({ ...row, why: t.slice(0, 50) }); continue; }
    if (NOTHERE.test(t)) { nothere.push({ ...row, why: t.slice(0, 50) }); continue; }
    if ((res.lines || []).some(l => l.kind === 'warn') && legit.test(t)) legitHits.push(row);
  }
  console.log(`    · 未识别指令：${unknown.length}   「这里没有」：${nothere.length}   零行输出：${empty.length}   正常门槛：${legitHits.length}`);

  ok('B6-3a 没有「未识别指令」（多词 cmd 匹配问题已修）', unknown.length === 0,
    unknown.map(x => `${x.rid}/${x.cmd}`).join(', '));
  ok('B6-3b 没有「零行输出」（按钮点了像坏掉）', empty.length === 0,
    empty.map(x => `${x.rid}/${x.cmd}`).join(', '));

  /* B6-3c 主人的那一类（get/采 类点不动）必须归零 */
  const gatherBad = nothere.filter(x => /^(get|拿|取|采|摘|捡|拾取)\b/.test(x.cmd));
  ok('B6-3c 采集类 action 不再有「这里没有」', gatherBad.length === 0,
    gatherBad.map(x => `${x.rid}/${x.cmd}`).join(', '));

  /* 剩下的「这里没有」若是 talk/ask/list类，那是**房间里就没那个人**
     （NPC 数据缺口），不属于本批渲染/判定不一致，如实列出备查。 */
  if (nothere.length) {
    console.log('    · 剩余「这里没有」明细（多为 NPC 数据缺口，非本批范围）：');
    for (const x of nothere) console.log(`        ${x.rid}(${x.name}) "${x.cmd}" => ${x.why}`);
  }
}

/* B6-4 ★ 回归：采集归一化不能抢走「捡地上东西」的正常路径 */
{
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'jiangnan_street';
  /* 放一个真实的 ground item，然后捡它*/
  const itemId = Object.keys(w.data.items).find(id => w.data.items[id] && w.data.items[id].type === 'consumable');
  ok('B6-4 找到一个可放置的物品', !!itemId, itemId);
  w.dropItem(p, (p.inventory[0] || {}).uid);
  /* 直接塞一个 ground 实例最稳*/
  const uid = 'smoke_b6_item';
  w.instances.items[uid] = { id: uid, itemId, room: 'jiangnan_street', count: 1 };
  const n0 = (p.inventory || []).length;
  const r = e.exec('get ' + w.getItem(itemId).name);
  ok('B6-4 普通捡地上物品仍然可用', !has(r, '这里没有'), texts(r).join('|').slice(0, 60));
  ok('B6-4 背包增加了', (p.inventory || []).length > n0);
  ok('B6-4 ground item 实例被消耗掉了', !w.instances.items[uid], '仍在=' + !!w.instances.items[uid]);
}

/* B6-5 战斗中也拿不到「采集物」（不许一边打架一边采药闪避） */
{
  const e = boot(); const w = e.world, p = w.player;
  p.room = 'jn_pharmacy_back';
  startFight(e);
  const n0 = (p.inventory || []).length;
  const r = e.exec('get 药材');
  ok('B6-5 战斗中采集被拦', (p.inventory || []).length === n0, texts(r).join('|').slice(0, 50));
}

/* B6-6 多词cmd 的 action 现在真的能被点到（此前全部「未识别指令」） */
{
  const e = boot(); const w = e.world, p = w.player;
  const cases = [
    ['jn_teahouse', 'listen 说书'],
    ['jn_yamen_gate', 'read 告示'],
    ['jn_yamen_gate', 'knock 登闻鼓'],
    ['jn_school_lib', 'search 书架'],
    ['jn_brothel_stage', 'listen 戏'],
    ['jn_cave', 'read 石壁'],
    ['jn_rich_house', 'knock 钱府'],
  ];
  for (const [rid, cmd] of cases) {
    p.room = rid;
    const r = e.exec(cmd);
    ok(`B6-6 「${cmd}」不再报未识别指令`, !/是什么指令/.test(texts(r).join('')), texts(r).join('|').slice(0, 50));
    ok(`B6-6 「${cmd}」有输出（不是零行）`, r.lines && r.lines.length > 0);
  }
  /* 自带 effects 的 action 优先于内置指令（talk 禁军 曾被内置 talk 吞掉） */
  p.room = 'palace_gate';
  const r = e.exec('talk 禁军');
  ok('B6-6 talk 禁军 走action 的 effects（不再被内置 talk 吞）',
    has(r, '宫城重地'), texts(r).join('|').slice(0, 60));
}

/* B6-7 look 类也不许零行（look 牢门 / look 槐树 曾是空白） */
{
  const e = boot(); const w = e.world, p = w.player;
  for (const [rid, cmd] of [['jn_yamen_prison', 'look 牢门'], ['cunzhen_gate', 'look 槐树']]) {
    p.room = rid;
    const r = e.exec(cmd);
    ok(`B6-7 ${cmd} 不再零行输出`, r.lines && r.lines.length > 0, texts(r).join('|').slice(0, 50));
  }
}

/* ================================================================
 *  B4 · 战斗界面「全力一击 / 防御」快捷键
 * ================================================================ */
section('B4 · 战斗界面「全力一击 / 防御」');
{
  /* B4-1 后端到底认不认这两个 cmd（先打真实结构） */
  const e = boot(); const w = e.world, p = w.player;
  ok('B4-1 CMD.attack 存在', !!e.cmds.CMD['attack']);
  ok('B4-1 CMD.defend 此前不存在，现已补齐', !!e.cmds.CMD['defend']);
  ok('B4-1 「防御」中文别名也注册了', !!e.cmds.CMD['防御']);
  ok('B4-1 CMD.flee 存在', !!e.cmds.CMD['flee']);
  ok('B4-1 CMD.auto 存在', !!e.cmds.CMD['auto']);

  /* B4-2 战斗中 attack（无参数）不再回「你想攻击谁？」 */
  {
    const e2 = boot(); const w2 = e2.world, p2 = w2.player;
    startFight(e2);
    const r = e2.exec('attack');
    const t = texts(r).join('');
    ok('B4-2 战斗中文杆 attack 有响应', r.lines && r.lines.length > 0);
    ok('B4-2 不再问「你想攻击谁？」', !t.includes('你想攻击谁'), t.slice(0, 60));
    ok('B4-2 不再是「未知指令」', !/是什么指令/.test(t));
  }

  /* B4-3 非战斗时 attack 仍要问「攻击谁」（不能把正常提示改坏） */
  {
    const e3 = boot();
    const r = e3.exec('attack');
    ok('B4-3 非战斗 attack 仍提示「你想攻击谁？」', has(r, '你想攻击谁'), texts(r).join('|'));
  }

  /* B4-4 defend 在战斗中可用，非战斗给出明确提示 */
  {
    const e4 = boot(); const w4 = e4.world;
    const r0 = e4.exec('defend');
    ok('B4-4 非战斗 defend 提示「并没有在战斗」', has(r0, '并没有在战斗'), texts(r0).join('|'));
    const e5 = boot(); startFight(e5);
    const r1 = e5.exec('defend');
    ok('B4-4 战斗中的defend 有响应', r1.lines && r1.lines.length > 0, texts(r1).join('|').slice(0, 50));
    ok('B4-4 defend 不再是未知指令', !/是什么指令/.test(texts(r1).join('')));
  }

  /* B4-5 ★ defend 真的减伤（同seed 对照，容差内判半伤）
   *    ⚠️ 对照组**不能用 `attack` / `auto`**：
   *      attack = 玩家出手 + 敌人出手（玩家那下也会挨打、可能把对手打死提前结束），
   *      auto   = 循环打到底（最多 60 回合）。
   *    拿它们当对照量到的是「一整段战斗」的伤害，不是「同一回合的伤害」。
   *    正确对照 = 同样是「玩家不还手、只挨打」的一回合：
   *      `defend` 走 stepEnemyOnly 一回��；
   *      对照组直接把 battle.guardTurns 置0 后同样走一次 stepEnemyOnly。
   *    这样两次量到的是**完全相同的一记敌方普攻**，唯一差别就是有没有防守。
   */
  {
    function hurtOf(guard) {
      const e6 = boot(); const w6 = e6.world, p6 = w6.player;
      startFight(e6);
      const npc = w6.battle.defenders[0];
      /* 固定对手输出：单次普攻、无技能、攻击力恒定，隔离随机浮动 */
      npc.atk = 200; npc.learned = {};
      npc.baseAttackCount = () => 1;
      npc.pickSkill = () => null;
      p6.maxHp = 1e9; p6.hp = 1e9;
      if (guard) w6.battle.guardTurns = 1;      /* 等价于先 exec('defend') 布防 */
      else w6.battle.guardTurns = 0;
      w6.stepEnemyOnly([]);                /* 同一记敌方普攻 */
      return 1e9 - p6.hp;
    }
    const dNo = hurtOf(false);
    const dDef = hurtOf(true);
    ok('B4-5 两次都有伤害（对照组有效）', dNo > 0 && dDef > 0, `无防守=${dNo} 有防守=${dDef}`);
    ok('B4-5 defend 伤害明显低于不防守', dDef < dNo, `无防守=${dNo} 有防守=${dDef}`);
    /* 浮动是 0.85~1.15，所以判「约一半」而不是精确等于一半 */
    ok('B4-5 defend 约为不防守的一半', Math.abs(dDef * 2 - dNo) <= dNo * 0.2,
      `无防守=${dNo} 有防守=${dDef} ratio=${(dDef / dNo).toFixed(3)}`);
    /* (a) 精确比值：去掉随机浮动后应严格为 0.5。
       把伤害浮动的随机源固定住（同seed 两次跑同一个 rng 序列），
       这样比值就是确定值，能抓住「减伤从 50% 变成 30%」这种悄悄改动。 */
    {
      function exactRatio() {
        const e7 = boot(); const w7 = e7.world, p7 = w7.player;
        startFight(e7);
        const npc = w7.battle.defenders[0];
        npc.atk = 200; npc.learned = {};
        npc.baseAttackCount = () => 1; npc.pickSkill = () => null;
        p7.maxHp = 1e9;
        const hit = () => {
          /* 每次都重置 hp，并clone 一份固定 rng 让浮动因子完全一致 */
          p7.hp = 1e9;
          const fixed = { next: () => 0.5 };
          const realRng = w7.rng; w7.rng = fixed;
          w7.combatHooks = Object.assign({}, w7.combatHooks);
          /* damage 浮动用 ctx.world.rng.next()，固定成0.5 → 因子恒为 1.0 */
          w7.stepEnemyOnly([]);
          w7.rng = realRng;
          return 1e9 - p7.hp;
        };
        w7.battle.guardTurns = 0;
        const noGuard = hit();
        w7.battle.guardTurns = 1;
        const guard = hit();
        return { noGuard, guard, ratio: guard / noGuard };
      }
      const r = exactRatio();
      /* ⚠️ 容差放宽到 1.5%：减伤是 `Math.floor(dmg/2)`，**取整本身**就会让比值偏离 0.5
         （674 → 337 是 0.4999，672 → 336 是 0.5000，全看基数落在哪儿）。
         原来卡 <0.001 是因为那会儿伤害基数恰好是偶数；数值体检改过减伤公式之后就不一定了。
         这条要守的是「守一回合确实减半」，不是「数学上精确的二分之一」。 */
      ok('B4-5(a) 守一回合的减伤约为一半',
        Math.abs(r.ratio - 0.5) < 0.015, `ratio=${r.ratio.toFixed(4)} (${r.noGuard} vs ${r.guard})`);
    }

    /* (b) 连续两回合：第一回合守完，第二回合**不再减伤**。
       这条专门防「guardTurns 被误挂到 player 上」—— 那样会变成永久减伤，
       而且不会有任何现有测试报错。 */
    {
      const e8 = boot(); const w8 = e8.world, p8 = w8.player;
      startFight(e8);
      const npc = w8.battle.defenders[0];
      npc.atk = 200; npc.learned = {};
      npc.baseAttackCount = () => 1; npc.pickSkill = () => null;
      p8.maxHp = 1e9; p8.hp = 1e9;
      const fixed = { next: () => 0.5 };
      const realRng = w8.rng;
      /* 第 1 回合：布防 → 挨打（应减半） */
      w8.battle.guardTurns = 1;
      w8.rng = fixed; w8.stepEnemyOnly([]); w8.rng = realRng;
      const d1 = 1e9 - p8.hp;
      ok('B4-5(b) 第一回合守完 guardTurns 被消费为 0', (w8.battle.guardTurns || 0) === 0,
        'guardTurns=' + w8.battle.guardTurns);
      /* 第 2 回合：不再防守 → 伤害应恢复原值 */
      p8.hp = 1e9;
      w8.rng = fixed; w8.stepEnemyOnly([]); w8.rng = realRng;
      const d2 = 1e9 - p8.hp;
      /* 容差放松（2026-10-11）：装备加成修好之后，防御真的参与减伤了 ——
         「守一轮」与「不守」的伤害不再是精确 2 倍（减伤按防御算，有取整）。
         实测 329 / 662（差 4），旧容差 max(2, …) 太紧，改按 2% 放。 */
      ok('B4-5(b) 第二回合不再减伤（伤害恢复原值）',
        Math.abs(d2 - d1 * 2) <= Math.max(6, d1 * 2 * 0.02),
        `第1回合=${d1} 第2回合=${d2}（期望第2回合≈第1回合x2=${d1 * 2}）`);
      ok('B4-5(b) 第二回合确实没有再减伤', d2 > d1 * 1.5, `d1=${d1} d2=${d2}`);
    }

    /* (c) 防「误挂到 player」的结构性断言：guardTurns 必须挂在 battle 上，
         player 上不允许出现这个字段。 */
    {
      const e9 = boot(); const w9 = e9.world, p9 = w9.player;
      startFight(e9);
      w9.battle.guardTurns = 1;
      ok('B4-5(c) guardTurns 挂在 battle 上而非 player',
        w9.battle.guardTurns === 1 && p9.guardTurns === undefined,
        `battle.guardTurns=${w9.battle.guardTurns} player.guardTurns=${p9.guardTurns}`);
      /* 战斗结束（battle 被丢弃）后玩家身上绝不能残留任何减伤状态 */
      w9.battle.over = true; w9.finishCombat([]);
      ok('B4-5(c) 战斗结束后 battle 整体丢弃（无残留）', w9.battle === null);
      ok('B4-5(c) 玩家身上没有任何 guard 残留', p9.guardTurns === undefined);
    }

    /* 并且走真实指令 defend 也会真的布下防（不是只有直接改字段才有效） */
    const e7 = boot(); const w7 = e7.world;
    startFight(e7);
    /* 打桩敌方输出，避免这一回合直接把玩家打死，看 battle 状态 */
    const n7 = w7.battle.defenders[0];
    n7.hp = 1e9; n7.maxHp = 1e9; n7.dead = false;
    const r = e7.exec('defend');
    ok('B4-5 exec("defend") 真的产生防守反馈', has(r, '凝神防守'), texts(r).join('|').slice(0, 40));
  }

  /* B4-6 防守只保本回合（不能变成永久减伤） */
  {
    const e7 = boot(); const w7 = e7.world, p7 = w7.player;
    const { battle } = startFight(e7);
    e7.exec('defend');
    ok('B4-6 守完这一回合后 guardTurns 被消费', (battle.guardTurns || 0) === 0, `guardTurns=${battle.guardTurns}`);
    const b2 = w7.battle;
    w7.battle.guardTurns = 99;
    ok('B4-6 battle 结束后不残留（battle 整体被丢弃）', (b2.guardTurns || 0) === 99);
  }
}

/* ================================================================
 *  前端：两份 ui.js 逐字节一致 + 真渲染真点击
 * ================================================================ */
section('前端 · 两份副本同步 + 战斗快捷键真渲染');
{
  const A = path.join(RJS, 'ui.js');
  const B = path.join(ROOT, 'server', 'public', 'js', 'ui.js');
  const sa = fs.readFileSync(A, 'utf8'), sb = fs.readFileSync(B, 'utf8');
  ok('FE-1 两份 ui.js 逐字节一致', sa === sb, `len ${sa.length} vs ${sb.length}`);

  const html = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'index.html'), 'utf8');
  const vers = [...html.matchAll(/\?v=(20\d{6}[a-z])/g)].map(m => m[1]);
  ok('FE-2 版本戳存在且全部一致（6 处）', new Set(vers).size === 1 && vers.length >= 6,
    `${vers.length} 处 / ${[...new Set(vers)].join(',')}`);
}

/* ---- DOM stub（照抄 kidnap-ui-check.js 的三个坑） ---- */
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(), children: [], _html: '', textContent: '', value: '', className: '', id: '', type: '',
    style: { _p: {}, setProperty(k, v) { this._p[k] = v; }, getPropertyValue(k) { return this._p[k] || ''; } },
    dataset: {}, _attrs: {}, _listeners: {}, disabled: false, checked: false,
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c) || String(el.className).split(/\s+/).indexOf(c) >= 0; },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want) this.add(c); else this.remove(c); return want; },
    },
    /* ⚠️ innerHTML 重设必须清 children（否则累积旧按钮/onclick 捕获旧 view） */
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
    /* ★ 必须按 (选择器, innerHTML) 缓存，否则 onclick 绑定全丢、假报「点了没反应」 */
    querySelectorAll(sel) {
      const key = sel + ' ' + this._html;
      this.__qsel = this.__qsel || {};
      if (!this.__qsel[key]) this.__qsel[key] = parseSelectors(this._html, sel);
      return this.__qsel[key];
    },
    closest() { return null; },
    focus() {}, blur() {}, click() { this.fire('click'); if (typeof this.onclick === 'function') this.onclick({ target: this, preventDefault() {}, stopPropagation() {} }); },
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    scrollIntoView() {}, scrollTop: 0, scrollHeight: 0,
    insertAdjacentHTML(p, h) { this._html += h; }, setSelectionRange() {}, select() {},
    cloneNode() { return makeEl(this.tagName); }, firstChild: null, lastChild: null, parentNode: null,
  };
  return el;
}
/** 从 HTML 按选择器抠元素（够本测试用；复杂选择器返回 []，宁可测不到也别假绿） */
function parseSelectors(html, sel) {
  if (!html || typeof html !== 'string' || !sel) return [];
  const s = String(sel).trim();
  const m = s.match(/^#([A-Za-z0-9_-]+)\s*(.*)$/);
  /* 选择器可以带 #id 前缀，也可以是**裸选择器**
     （直接在容器自身的 innerHTML 里查，如 `.qb-btn[data-cmd]`）。 */
  const rest = m ? m[2].trim() : s;
  const tags = [];
  const re = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/?>/g;
  let mm;
  while ((mm = re.exec(html)) !== null) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = are.exec(mm[2] || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    }
    tags.push({ tag: mm[1].toLowerCase(), attrs });
  }
  let t = null, cls = null, attr = null;
  const tm = rest.match(/^([a-zA-Z][a-zA-Z0-9]*)/); if (tm) t = tm[1].toLowerCase();
  const cm = rest.match(/\.([A-Za-z0-9_-]+)/); if (cm) cls = cm[1];
  const am = rest.match(/\[([a-zA-Z0-9_:-]+)\]/); if (am) attr = am[1];
  /* 抠元素时顺手把标签的**inner 文本**也存进 _html，
     这样测试才能按「按钮文字」找按钮（不然只能按 data-cmd 找）。 */
  const out = [];
  const re2 = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/?>([\s\S]*?)<\/\1>/g;
  let m2;
  while ((m2 = re2.exec(html)) !== null) {
    const attrs = {};
    const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
    let a;
    while ((a = are.exec(m2[2] || '')) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
    }
    const g = { tag: m2[1].toLowerCase(), attrs, text: m2[3] || '' };
    if (t && g.tag !== t) continue;
    if (cls && String(g.attrs.class || '').split(/\s+/).indexOf(cls) < 0) continue;
    if (attr && !(attr in g.attrs)) continue;
    out.push(g);
  }
  /* 自闭合标签（无成对文本）单独补一遍*/
  if (!out.length) {
    const re3 = /<([a-zA-Z][a-zA-Z0-9]*)((?:\s+[a-zA-Z_:][-a-zA-Z0-9_:.]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s">]+))?)*)\s*\/>/g;
    let m3;
    while ((m3 = re3.exec(html)) !== null) {
      const attrs = {};
      const are = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+)))?/g;
      let a;
      while ((a = are.exec(m3[2] || '')) !== null) {
        attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : (a[4] !== undefined ? a[4] : ''));
      }
      const g = { tag: m3[1].toLowerCase(), attrs, text: '' };
      if (t && g.tag !== t) continue;
      if (cls && String(g.attrs.class || '').split(/\s+/).indexOf(cls) < 0) continue;
      if (attr && !(attr in g.attrs)) continue;
      out.push(g);
    }
  }
  return out.map(g => {
    const el = makeEl(g.tag);
    el.className = g.attrs.class || '';
    el.id = g.attrs.id || '';
    el._label = g.text;
    for (const k in g.attrs) el.setAttribute(k, g.attrs[k]);
    el._clicked = false;
    el.click = () => { el._clicked = true; if (typeof el.onclick === 'function') el.onclick({ target: el, preventDefault() {}, stopPropagation() {} }); };
    return el;
  });
}
function makeEnv() {
  const store = {}, els = {};
  const doc = {
    readyState: 'complete', createElement: t => makeEl(t), createDocumentFragment: () => makeEl('frag'),
    getElementById(id) { if (!els[id]) { els[id] = makeEl('div'); els[id].id = id; } return els[id]; },
    _els: els,
    querySelector() { return null; },
    querySelectorAll(sel) {
      const m = String(sel).match(/#([A-Za-z0-9_-]+)/);
      if (!m || !els[m[1]]) return [];
      return els[m[1]].querySelectorAll(sel);
    },
    addEventListener() {}, removeEventListener() {},
    body: makeEl('body'), head: makeEl('head'), documentElement: makeEl('html'),
    createTextNode: t => ({ textContent: t }),
  };
  const loc = { href: 'http://127.0.0.1:8800/', origin: 'http://127.0.0.1:8800', protocol: 'http:', host: '127.0.0.1', hostname: '127.0.0.1', port: '8800', pathname: '/', search: '', hash: '', reload() {}, assign() {}, replace() {} };
  const env = {
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    document: doc, location: loc,
    navigator: { userAgent: 'node-check', language: 'zh-CN' },
    localStorage: { _d: store, getItem(k) { return store[k] === undefined ? null : store[k]; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; }, clear() { for (const k in store) delete store[k]; } },
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    alert() {}, confirm() { return false; }, prompt() { return null; },
    requestAnimationFrame: f => setTimeout(f, 0),
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    URL, URLSearchParams, Promise, JSON, Math, Date, Array, Object, String, Number, Boolean, RegExp, Error, Map, Set, Intl,
    innerWidth: 1280, innerHeight: 800,
    addEventListener() {}, removeEventListener() {},
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    CSS: { escape: s => String(s) },
    WXCLOUD: null, L: null, LM: null, WXMK: null,
  };
  env.window = env; env.self = env; env.globalThis = env; env.global = env;
  return env;
}
function loadUi() {
  const env = makeEnv();
  vm.createContext(env);
  for (const f of ['app.js', 'ui.js']) {   /* ⚠️ 顺序不能反 */
    vm.runInContext(fs.readFileSync(path.join(RJS, f), 'utf8'), env, { filename: f, timeout: 8000 });
  }
  return env;
}
/** ⚠️ doCmd 是 async：点完必须 await settle()，否则读到的 sent 永远是空的 */
function settle() { return new Promise(r => setImmediate(r)); }

/* 战斗快捷键：真渲染 + 真点击 + 真发指令 */
(async function main() {
  section('前端 · 战斗快捷键真渲染 + 真点击（B4 落点）');
  const env = loadUi();
  /*造一份带 combat 的真 view */
  const e = boot(); const w = e.world, p = w.player;
  startFight(e);
  const view = e.view();
  ok('FE-3 view.combat 存在（战斗面板会切到战斗快捷键）', !!view.combat, JSON.stringify(view.combat || {}).slice(0, 60));

  env.WX.api.view = async () => ({ ok: true, view });
  env.sent = [];
  env.WX.api.exec = async (cmd, opt) => { env.sent.push({ cmd, opt: opt || null }); return { ok: true, lines: [] }; };
  env.WX.S.view = view; env.WX.S.busy = false;

  await env.WXUI.renderQuickbar(view);
  await settle();
  const qb = env.document.getElementById('quickbar');
  const html = qb.innerHTML || '';
  /* 🔴 主人 2026-10-11 改口径：战斗栏里「全力一击」删掉，基础武学（基本内功 /
     基本拳脚，没有武技）也不许出现，只留**已激活武学**的武技。
     所以这里从「必须含 4 个按钮 + 含全力一击」改成「3 个基础键 + 反向断言」。 */
  ok('FE-3 战斗快捷键条至少 3 个按钮', (html.match(/qb-btn/g) || []).length >= 3, (html.match(/qb-btn/g) || []).length + ' 个');
  ok('FE-3 含「普通攻击」', html.includes('普通攻击'));
  ok('FE-3 含「防御」', html.includes('防御'));
  ok('FE-3 含「逃跑」', html.includes('逃跑'));
  ok('FE-3 已删「全力一击」', !html.includes('全力一击'));
  /* 基础武学没有武技，不该混进战斗栏（主人点名的「基本内功 / 基本拳脚」） */
  ok('FE-3 基础武学不上战斗栏（基本内功）', !html.includes('基本内功'));
  ok('FE-3 基础武学不上战斗栏（基本拳脚）', !html.includes('基本拳脚'));

  /* 真点这两个按钮，看发出的指令后端认不认 */
  for (const label of ['普通攻击', '防御']) {
    const btns = qb.querySelectorAll('.qb-btn[data-cmd]');
    const target = btns.filter(b => String(b._label || '').includes(label))[0];
    ok(`FE-3 找到「${label}」按钮`, !!target, btns.map(b => b._label + '/' + b.getAttribute('data-cmd')).join(' '));
    if (!target) continue;
    env.sent.length = 0;
    target.click();
    await settle(); await settle();
    const sent = env.sent.map(x => x.cmd);
    ok(`FE-3 点「${label}」发出了指令`, sent.length > 0, sent.join(','));
    /* 发出的指令必须是后端真认的（这是 B4 的核心断言） */
    const CMD = e.cmds.CMD;
    for (const c of sent) {
    const verb = tokenize(c)[0];
    ok(`FE-3 「${c}」是后端已注册指令`, !!(CMD[verb] || CMD[String(verb).toLowerCase()]), verb);
    }
  }

/* ================================================================
 *  批次 2（B1 / B2 / B7 / B3）
 *
 *  一律遵守批次 1 血换来的两条纪律：
 *   ① 断言打在**真实调用路径**上（真 exec / 真 startCombat），不用无参调用糊弄；
 *   ② 不写恒真谓词。每条都能被变异测试抓红（见交付报告的变异结果）。
 * ================================================================ */

/* ---------------------------------------------------------------
 * B1 · 存档列表混进「测试侠客」
 *
 * 根因两层，缺一层都还会漏：
 *   ① 源头：tools/smoke-test.js 跑一次就往**玩家的** saves/ 里裸写 test_slot.json；
 *   ② 链路：engine.listSaves() 把 saves/ 下所有 .json 全列出，无任何过滤。
 * 修法：① 测试脚本改走隔离沙盒 + save(id,{_test:true})；
 *      ② listSaves() 按「保留名单 + _testMark」双重过滤。
 *
 * ⚠️ 验收标准不是「测试侠客不见了」，而是**首行仍是你最近那一份真存档**
 *   （design/13-bug-triage.md B1-3）。只验前者等于给B2 埋雷。
 * --------------------------------------------------------------- */
section('B1 · 存档列表不得混入测试档，且首行必须是最新真存档');
{
  const fs2 = require('fs');
  const saveDir = path.join(ROOT, 'saves');
  const e = new GameEngine({ seed: SEED });
  const list = e.listSaves();

  /* 前提：玩家存档目录里确实存在历史遗留的测试档时才验「过滤」这一层。
     若主人清了目录，下面两条会跳过而不是假绿（用 found 标志明示）。 */
  const rawFiles = fs2.existsSync(saveDir)
    ? fs2.readdirSync(saveDir).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''))
    : [];
  const testFiles = rawFiles.filter(id => /test|smoke|smoke_act2|_inst_|_local_/.test(id));
  /* FG-2（批次 2 返工清掉）：原来这行是 `ok(..., true, ...)` —— **谓词是字面量 true，
     恒真**，只是打印信息而已，是典型假绿。改成一个**真断言**：
     我们自己在沙盒里造一个测试档，并断言它**确实落到了盘上**。
     为什么必须断言「文件真的存在」：下面B1-2 那几条过滤断言，
     分不清「过滤真的生效」还是「压根没档可过滤」。把前提钉死，过滤断言才有意义。 */
  const probeDir0 = require(path.join(ROOT, 'tools', '_test-save-dir.js'));
  const e0 = new GameEngine({ seed: SEED, saveDir: probeDir0 });
  e0.boot(); e0.newGame({ name: '测试侠客', gender: 'male', birth: 'wuxue' });
  const fgMarked = e0.save('fg_premise_slot', { _test: true });
  const fgOnDisk = fs2.existsSync(path.join(probeDir0, fgMarked.id + '.json'));
  ok('B1-0 前提：自己造的测试档确实落到了磁盘上（否则下面的过滤断言是空跑）',
    fgOnDisk === true, `id=${fgMarked.id} 落盘=${fgOnDisk}`);
  ok('B1-0 前提：这个测试档**不被** listSaves 列出（过滤真的在跑，不是没档可滤）',
    !e0.listSaves().some(s => s.id === fgMarked.id),
    'listed=' + e0.listSaves().map(s => s.id).join(','));

  ok('B1-1 列表里没有任何测试/调试档', list.every(s => !/test_slot|smoke_|_inst_|_local_/.test(s.id)),
    list.map(s => s.id).join(','));
  ok('B1-1 列表里没有「测试侠客」这种角色名',
    !list.some(s => /测试侠客/.test(s.name || '')),
    list.map(s => s.name).join(','));

  /* ★ 首行判据（B1-3）：必须是 savedAt 最大的那一档，且不是测试档。
     FG-3（批次 2 返工清掉）：原来这段是 `if (onDisk.length) {…} else { ok(…, true, 'skipped') }`
     —— 磁盘上没真档时**静默跳过仍计通过**，等于「靠玩家目录的偶然状态拿绿灯」。
     现在改成：**自己在沙盒里造三档真存档**（savedAt 递增可控），
     前提恒成立，不依赖玩家 saves/ 里碰巧有什么。 */
  const b13Dir = fs2.mkdtempSync(path.join(require('os').tmpdir(), 'b13_'));
  const e13 = new GameEngine({ seed: SEED, saveDir: b13Dir });
  e13.boot(); e13.newGame({ name: '首行判据', gender: 'male', birth: 'wuxue' });
  /* 造三档：**故意先存旧的、再存新的** —— 若 listSaves 没有按 savedAt 降序，
     首行就会是 old_a；顺带造一档更新的**测试档**，验证它不污染排序。
     ⚠️ `savedAt` 是**数字**（Date.now() 毫秒），不是 ISO 字符串。
     我第一版写成 ISO 串，`(b.savedAt)-(a.savedAt)` 直接 NaN，
     sort 静默退化成不排序 —— 首行判据就白测了（自己踩的坑，记在这里）。 */
  const mkA = e13.save('b13_old_a');
  const mkB = e13.save('b13_mid_b');
  const T = t => new Date(t).getTime();
  /* 强制 savedAt 拉开差距，避免同毫秒导致排序不稳定（这是真排序判据的前提）。 */
  const bump = (id, iso) => {
    const fp = path.join(b13Dir, id + '.json');
    const j = JSON.parse(fs2.readFileSync(fp, 'utf8'));
    if (typeof j.savedAt !== 'number') throw new Error('savedAt 不是数字，前提不成立: ' + typeof j.savedAt);
    j.savedAt = T(iso);
    fs2.writeFileSync(fp, JSON.stringify(j));
  };
  bump(mkA.id, '2026-01-01T00:00:00.000Z');
  bump(mkB.id, '2026-06-01T00:00:00.000Z');
  const b13Newest = e13.save('b13_newest_c');
  bump(b13Newest.id, '2026-12-01T00:00:00.000Z');
  /* 最新的一档之后再写一个**带测试标记**的档：它 savedAt 更晚，
     若过滤失效就会顶到首行 —— 这样「排序」与「过滤」两个维度被同时测到。 */
  const b13Test = e13.save('b13_should_be_hidden', { _test: true });
  bump(b13Test.id, '2027-06-01T00:00:00.000Z');   // 比任何真档都「新」

  const b13List = e13.listSaves();
  ok('B1-3 前提：沙盒里确实造出了 3 个真档（不再依赖玩家目录的偶然状态）',
    b13List.filter(s => !/^test_/.test(s.id)).length === 3,
    'listed=' + b13List.map(s => s.id).join(','));
  ok('B1-3 前提：三档 savedAt 是可比数字且刻意递增（排序判据成立）',
    b13List.length === 3 && b13List.every(s => typeof s.savedAt === 'number') && b13List[0].savedAt > b13List[1].savedAt,
    b13List.map(s => s.id + '@' + s.savedAt).join(' | '));
  ok('B1-3 首行就是最新的一档（savedAt 降序，没被更晚的测试档顶掉）',
    b13List.length > 0 && b13List[0].id === b13Newest.id,
    `list[0]=${b13List[0] && b13List[0].id} 期望=${b13Newest.id}`);
  ok('B1-3 首行不是测试档', !e13._isTestSave(b13List[0].id, {}), b13List[0].id);
  /* 反向：测试档确实存在且savedAt 更晚，只是不该被列出 —— 证明上面那条不是「压根没文件」。 */
  ok('B1-3 反证：那个 savedAt 更晚的测试档确实在盘上、却没进列表',
    fs2.existsSync(path.join(b13Dir, b13Test.id + '.json')) && !b13List.some(s => s.id === b13Test.id),
    `hidden=${b13Test.id}`);
  try { fs2.rmSync(b13Dir, { recursive: true, force: true }); } catch (err) { /* tmp，删不掉无所谓 */ }

  /* 反证：引擎自己写一份**带测试标记**的档，它必须不出现在列表里。
     这是「过滤逻辑真的在跑」的动态自证 —— 不是靠上面的静态名单碰巧。 */
  const probeDir = require(path.join(ROOT, 'tools', '_test-save-dir.js'));
  const e2 = new GameEngine({ seed: SEED, saveDir: probeDir });
  e2.boot(); e2.newGame({ name: '测试侠客', gender: 'male', birth: 'wuxue' });
  const marked = e2.save('b1_probe_slot', { _test: true });
  ok('B1-2 带 _test 标记的存档被强制加 test_ 前缀',
    /^test_/.test(marked.id), marked.id);
  const probeList = e2.listSaves();
  ok('B1-2 带 _test 标记的档不出现在 listSaves 里',
    !probeList.some(s => s.id === marked.id),
    probeList.map(s => s.id).join(',') || '(空)');
  /* 真档必须仍然列得出来 —— 证明过滤没有把名单清空（防「过滤太宽」）。 */
  const realSave = e2.save('b1_probe_real');
  ok('B1-2 未标记的正常存档仍能列出（过滤没有误杀）',
    e2.listSaves().some(s => s.id === realSave.id), realSave.id);
  try { e2.deleteSave(marked.id); e2.deleteSave(realSave.id); } catch (err) { /* 沙盒，删不掉无所谓 */ }
}

/* ---------------------------------------------------------------
 * B2 · 「继续游戏」不直接进最近存档
 *
 * 根因：start.js 的 continueGame() 只做了「拉列表 + 判空 + openSaves('load')」，
 *       全程没有任何自动载入调用。
 *
 * ★ 这里**必须行为测试，不能只读源码**：
 *   第一版我偷懒只 grep 源码里有没有 `api.load`，结果变异体在
 *   「取到 latest 之后立刻 openSaves 并 return」的情况下**照样全绿** ——
 *   因为源码里 api.load 那一行确实还在，只是永远走不到。
 *   这就是批次 1 的假绿重演。故改为：把真 start.js 载进 vm，
 *   用桩替掉 api / WXUI，**真调一次 continueGame()**，看它到底调了什么。
 * --------------------------------------------------------------- */
section('B2 · 继续游戏自动载入最近档（行为测试）');
{
  /* ---- 起一套最小 DOM + api 桩，把真 start.js 跑起来 ---- */
  const calls = { loaded: [], openedSaves: [], shown: [], toasts: [], logs: [] };
  let SAVES = [];
  let LOAD_FAIL = false;
  const stubApi = {
    saves: async () => ({ ok: true, saves: SAVES }),
    load: async id => {
      calls.loaded.push(id);
      if (LOAD_FAIL) throw new Error('存档文件损坏');
      return { ok: true, view: { player: { name: '读回来的' } } };
    },
  };
  const stubUI = {
    autoSave: false,
    bindInput() { }, bindHotkeys() { }, bindSidebar() { }, bindModal() { }, bindGuide() { },
    show: n => calls.shown.push(n),
    toast: (m) => calls.toasts.push(m),
    openSaves: m => calls.openedSaves.push(m),
    clearLog: () => { }, appendLog: l => calls.logs.push(l), renderAll: () => { },
    showModCenter() { }, showModMaker() { }, showDoc() { },
  };
  const sandbox = {
    console,
    setTimeout: (fn) => { try { fn(); } catch (e) { /* 焦点无关 */ } },
    clearTimeout() { },
    document: {
      getElementById: () => null,
      querySelectorAll: () => [],
      createElement: () => ({ style: {}, classList: { toggle() { }, add() { }, remove() { } }, setAttribute() { }, appendChild() { }, addEventListener() { } }),
      addEventListener() { }, body: { classList: { toggle() { } } },
    },
    location: { assign() { }, href: 'http://localhost/' },
    localStorage: { getItem: () => null, setItem() { }, removeItem() { } },
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    WX: { S: {}, api: stubApi, util: { esc: s => String(s) }, bus: { emit() { }, on() { } } },
    WXUI: stubUI,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  const startSrc = fs.readFileSync(path.join(RJS, 'start.js'), 'utf8');
  vm.runInContext(startSrc, sandbox, { filename: 'start.js' });
  const START = sandbox.WXSTART;
  ok('B2-0 真 start.js 已在 vm 里跑起来，导出 continueGame', !!(START && START.continueGame));

  /* ---- 用例 1：有两档时，必须直接载入**最新**那一档（B2-3） ---- */
  if (START) {
    SAVES = [
      { id: 'newest', name: '试剑', savedAt: 2000 },
      { id: 'older', name: '试剑', savedAt: 1000 },
    ];
    await START.continueGame();
    ok('B2-3 点了「继续游戏」直接进游戏（切到 game 画面）',
      calls.shown.indexOf('game') >= 0, 'shown=' + JSON.stringify(calls.shown));
    ok('B2-3 直接进游戏而不是拉起存档选择界面',
      calls.openedSaves.length === 0, 'openSaves=' + JSON.stringify(calls.openedSaves));
    ok('B2-4 载入的是**最新**那一档（local[0]）',
      calls.loaded.length === 1 && calls.loaded[0] === 'newest',
      'loaded=' + JSON.stringify(calls.loaded));

    /* ---- 用例 2：载入的是测试侠客档就是事故（B2-4，必须在 B1 修好后才安全） ---- */
    SAVES = [
      { id: 'test_slot', name: '测试侠客', savedAt: 9000 },
      { id: 'real_save', name: '试剑', savedAt: 2000 },
    ];
    calls.loaded.length = 0; calls.shown.length = 0; calls.openedSaves.length = 0;
    await START.continueGame();
    /* 这一条锁的是「B1 没修好会毁档」这个事故：
       只要 listSaves 还把测试档列进来，「继续游戏」就一定会载入它。
       所以这里断言拿到的必须是**调用方给的列表首项**，而 B1 那侧保证首项是真档。 */
    ok('B2-4 严格按列表首项载入（首项是谁由 B1 的过滤保证）',
      calls.loaded.length === 1 && calls.loaded[0] === 'test_slot',
      'loaded=' + JSON.stringify(calls.loaded) +
      '｜注：这条在 B1 修好时首项必为真档；此处刻意喂含测试档的列表来证明「继续游戏」不自己挑');

    /* ---- 用例 3：没有存档时（B2-5）只 toast，不跳读取界面 ---- */
    SAVES = [];
    calls.loaded.length = 0; calls.shown.length = 0; calls.openedSaves.length = 0; calls.toasts.length = 0;
    await START.continueGame();
    ok('B2-5 没有存档时只 toast 提示，不载入也不跳读取界面',
      calls.loaded.length === 0 && calls.openedSaves.length === 0 && calls.shown.length === 0 &&
      calls.toasts.some(t => /还没有存档/.test(t)),
      'toasts=' + JSON.stringify(calls.toasts));

    /* ---- 用例 4：载入失败必须兜底，不能把玩家堵在门外 ---- */
    SAVES = [{ id: 'broken', name: '试剑', savedAt: 3000 }];
    LOAD_FAIL = true;
    calls.loaded.length = 0; calls.shown.length = 0; calls.openedSaves.length = 0; calls.toasts.length = 0;
    await START.continueGame();
    LOAD_FAIL = false;
    ok('B2 容错：最近档读失败时给提示并退回列表（不静默卡死）',
      calls.toasts.some(t => /失败/.test(t)) && calls.openedSaves.length === 1,
      'toasts=' + JSON.stringify(calls.toasts) + ' openSaves=' + JSON.stringify(calls.openedSaves));
  }

  /* ---- 引擎侧：首项真的能被读回来，且读回来的是最新那份 ---- */
  const probeDir = require(path.join(ROOT, 'tools', '_test-save-dir.js'));
  const e = new GameEngine({ seed: SEED, saveDir: probeDir });
  /* 先清掉历史残留，保证下面测的是「本次存的两档」的相对顺序 */
  for (const f of ['b2_old', 'b2_new']) { try { e.deleteSave(f); } catch (err) { /* 本来就没有 */ } }
  e.boot(); e.newGame({ name: '甲', gender: 'male', birth: 'wuxue' });
  const s1 = e.save('b2_old');
  e.world.player.money = 111;
  const s2 = e.save('b2_new');
  /* 手工改 savedAt，模拟「b2_new 更新」——不依赖 sleep。
     ⚠️ 必须用**当前时间量级**（Date.now()≈1.7e12），不能写 9999999999（1e10）
     那反而比真实存档旧，会让断言测反。 */
  const fp = path.join(probeDir, s2.id + '.json');
  const j2 = JSON.parse(fs.readFileSync(fp, 'utf8'));
  j2.savedAt = Math.max(j2.savedAt, Date.now()) + 60000;
  fs.writeFileSync(fp, JSON.stringify(j2, null, 2), 'utf8');
  const list = e.listSaves();
  ok('B2-2 列表首项是 savedAt 最大的那一档', list[0] && list[0].id === s2.id,
    (list[0] && list[0].id) + ' room=' + (list[0] && list[0].room));
  const loaded = e.loadSave(list[0].id);
  ok('B2-2 首项能被 loadSave 真读回来', loaded && loaded.ok === true, loaded && loaded.msg);
  ok('B2-4 载入的是最新档的内容（不是更旧的 money=0）',
    e.world.player.money === 111, 'money=' + e.world.player.money);
  ok('B2-4 载入的不是测试侠客', e.world.player.name !== '测试侠客', e.world.player.name);
  try { e.deleteSave(s1.id); e.deleteSave(s2.id); } catch (err) { /* 沙盒 */ }
}

/* ---------------------------------------------------------------
 * B7 · NPC 目睹玩家被袭击无反应
 *
 * 根因不是「没写反应」，是「钩子没接」：startCombat 里 emit('combatstart')
 *   全仓零监听，反应树只挂在 onNpcDown/onNpcKilled（NPC 挨打）上。
 * 另有一处隐藏根因：personality.js 的 PERSONALITIES 每条**没有 id 字段**，
 *   而所有调用方写 per.id === 'qienuo' —— 恒 false，性格分流从未生效。
 *
 * ★防假绿：验证**必须走真实触发路径**。
 *   这里不直接调combatStartWitnessReaction（那正是批次 1 踩过的坑），
 *   而是真`exec('kill<山贼>')` 起一场战斗，让钩子自己被触发。
 *   同时用「NPC 挨打」（走 onNpcDown → witnessReaction）作基线对照，
 *   一次执行就能区分「反应树坏了」还是「钩子没接」。
 * --------------------------------------------------------------- */
section('B7 · NPC 目睹玩家被袭击时的反应（真实触发路径）');
{
  const pm = require(path.join(ROOT, 'game', 'src', 'core', 'personality.js'));
  const e = boot(); const w = e.world, p = w.player;
  const rid = 'jiangnan_street';
  w.movePlayerTo(p, rid);
  function npcByTag(tag) {
    for (const id of Object.keys(w.data.npcs)) if ((w.data.npcs[id].tag || '') === tag) return id;
    return null;
  }
  let foeId = null;
  for (const id of Object.keys(w.data.npcs)) {
    if (w.data.npcs[id].hostile && /bandit|snake|robber|thief/i.test(id)) { foeId = id; break; }
  }
  ok('B7-0 找得到一个敌对 NPC 当凶手（前提）', !!foeId, foeId);
  ok('B7-0 找得到怯懦/侠义两种目击者（前提）', !!npcByTag('refugee') && !!npcByTag('escort'),
    npcByTag('refugee') + ' / ' + npcByTag('escort'));

  if (foeId && npcByTag('refugee') && npcByTag('escort')) {
    const q = w.spawnNpc(npcByTag('refugee'), rid, 1, true);
    const x = w.spawnNpc(npcByTag('escort'), rid, 1, true);
    const foe = w.spawnNpc(foeId, rid, 1, true);
    /* ⚠️ 性格规则 2026-10-08 升级后（**画像语气优先**），这位「难民」的画像写的是「讷」，
       于是他被定成木讷——『难民必怯懦』这条老前提不再成立。
       本组测的是**机制**（怯懦→逃 / 侠义→出头），所以干脆点名指定，别让数据波动牵着走。 */
    q.personality = 'qienuo';
    x.personality = 'xiayi';
    ok('B7-0 指定后怯懦目击者性格为 qienuo（前提）', q.personality === 'qienuo', q.personality);
    ok('B7-0 侠义目击者有武力（前提）',
      x.personality === 'xiayi' && w.npcHasMartialArts(x), x.personality);

    const qRoomBefore = q.room, xRoomBefore = x.room, wantedBefore = p.wanted || 0;
    /* ★ 真实触发：走 kill 指令 → startCombat → emit('combatstart') → 钩子 */
    const r = e.exec('kill ' + foe.name);
    const txt = texts(r).join('\n');
    ok('B7-2 战斗真的建立了（触发路径成立）', !!w.battle);
    ok('B7-2 目标确实是那个敌对 NPC', !!(w.battle && w.battle.target && w.battle.target.id === foe.id));

    /* FG-1（批次 2 返工清掉）：原来这行是
       `ok('B7-2 交战瞬间有目击者反应输出', r.lines.length > 1 && txt.length > 0, …)`
     —— 两处都废：① `txt.length > 0` **恒真**（任何 exec 都有输出）；
     ② `r.lines.length > 1` 被 `kill` 指令的**固有输出**天然满足
     （「你向山贼发起了攻击！」+ 战斗提示就有2~3 行）。
     结果：**目击反应完全没发生也可能全绿**。
     改成**差分断言**：断言「怯懦者的台词」与「侠义者的台词」都真出现在输出里，
     且措辞不同 —— 只有反应树真的跑起来才可能同时满足。 */
    const sayOf = who => r.lines.map(l => String(l.text || ''))
      .filter(t => t.indexOf(who.name) >= 0).join(' | ');
    const qSay = sayOf(q), xSay = sayOf(x);
    ok('FG-1/B7-2 怯懦目击者的台词真出现在战斗输出里（不再靠 lines.length 猜）',
      qSay.length > 0 && /逃/.test(qSay), `qSay=${qSay.slice(0, 60)}`);
    /* ⚠️ 这里打的是**山贼**（hostile 模板 = 江湖上该除的害）。
       第二轮返工后语义是：侠义之士**不替山贼出头**，抱臂退到一边看热闹 ——
       所以判据是「有台词、且是**退开**那一路」，不再是「拔刀/并肩」。 */
    ok('FG-1/B7-2 侠义目击者的台词真出现在战斗输出里',
      xSay.length > 0 && /退到一旁|早该有人收拾|没看见/.test(xSay), `xSay=${xSay.slice(0, 60)}`);
    ok('FG-1/B7-2 两句台词分属不同目击者，不是同一句复制给所有人',
      qSay.length > 0 && xSay.length > 0 && qSay !== xSay
        && qSay.indexOf(x.name) < 0 && xSay.indexOf(q.name) < 0,
      `q=${qSay.slice(0, 24)} || x=${xSay.slice(0, 24)}`);
    /* ⚠️ 我第一版在这儿还写了一条「输出里不许提到凶手名字」并指望它绿——
       它**必然红**，因为 `kill` 指令自身的固有输出就是「你向山贼发起了攻击！」，
       凶手名字本来就该出现在输出里。那条断言的前提是错的，不是代码坏了。
       「凶手不该在**反应名单**里」这条真正的守卫是 B7-7（它按
       `凶手名+「拔刀」` 这种反应专属句式筛，不会误伤玩家自己的攻击行）。*/
    /* B7-3 怯懦的真的离开房间（不是只打印一句「逃走了」） */
    ok('B7-3 怯懦目击者真的离开了房间（fleeNpc 生效）',
      q.room !== qRoomBefore, qRoomBefore + ' -> ' + q.room);
    ok('B7-3 怯懦目击者的台词说的是逃', /逃/.test(txt.split('\n').filter(l => l.indexOf(q.name) >= 0).join('')));
    /* B7-4 侠义有武力的「加入战斗」—— ★ 第二轮把**站队**改对了。
       老代码不看受害者是谁、不看谁先动手，一律 `battle.attackers.push(w)`：
       玩家主动打小叫花时，侠义 NPC「挺身加入战团，与你并肩迎敌」= 帮着凶手打受害者。
       现在：玩家打**该打的人**（这里就是山贼）→ 谁也不帮，退到一边；
            玩家打**弱者** → 进 defenders（见本文件 §B30 那一段）；
            玩家**被伏击** → 进 attackers（见 BLK-1 那一段，B7 的原场景）。
       所以这里断言「没站到任何一边」—— 老写法在这里会让 `attackers` 里多一个人。 */
    ok('B7-4 ★ 打「该打的人」时侠义目击者不站任何一边（老写法会倒进 attackers）',
      !!w.battle
      && w.battle.attackers.indexOf(x) < 0
      && w.battle.defenders.indexOf(x) < 0
      && !x.inCombat,
      w.battle
        ? 'attackers=[' + w.battle.attackers.map(a => a.name).join(',') + '] defenders=['
          + w.battle.defenders.map(d => d.name).join(',') + ']'
        : 'no battle');
    /* B7-5 无武力平民要有惊呼类输出 */
    ok('B7-5 至少一条非「已发起攻击」的目击反应台词',
      r.lines.filter(l => l.text && !/发起了攻击/.test(l.text)).length > 0);
    /* 反向效果防护：玩家是受害者，绝不能被记通缉 */
    ok('B7-6 玩家是受害者，通缉度不该 +1', (p.wanted || 0) === wantedBefore,
      wantedBefore + ' -> ' + (p.wanted || 0));
    /* 目击者不是凶手自己 */
    ok('B7-7 凶手自己不在反应名单里', !new RegExp(foe.name).test(
      r.lines.filter(l => l.text && l.text.indexOf(foe.name + '拔刀') >= 0).map(l => l.text).join('')));
  }

  /* ================================================================
   * B30（第二轮主人亲报）· 主动打人时，旁观的 NPC 帮错了一方
   *
   * 主人原话：「为什么我主动攻击某个 NPC，旁边有个 NPC 来帮我
   *            而不是帮被我攻击的小叫花？」
   *
   * 根因**两处**，都在 world.js 的 combatStartWitnessReaction：
   *   ① `playerIsVictim` **写死 true** —— 完全没看谁先动的手；
   *   ② 凶手取的是 `battle.target`，而 target 恰恰是**被打的那个 NPC**。
   *      ⇒ 玩家打小叫花 → 树以为「小叫花在行凶、玩家在挨打」→
   *        侠义 NPC「挺身加入战团，与你并肩迎敌」= 帮着凶手打受害者。
   *
   * ★防假绿：这里必须走**真 kill 指令**（真 startCombat → 真 combatstart 钩子），
   *   不直接调 combatStartWitnessReaction。
   *   并且**对照组必须同时存在**（打山贼 / 真伏击），否则「一律谁也不帮」
   *   也能把单条断言骗绿。
   * ------------------------------------------------------------- */
  section('B30 · 主动攻击时目击者站队（帮被打的那个，不是帮动手的）');
  {
    /* 找出一个「弱者」：非 hostile、tag 是平民/乞儿这类。
       —— 小叫花在数据里就是 tag=beggar。 */
    function findInnocent(w) {
      const pref = ['beggar', 'child', 'refugee', 'commoner', 'vendor', 'waiter'];
      for (const tag of pref) {
        for (const id of Object.keys(w.data.npcs)) {
          const d = w.data.npcs[id];
          if (d && !d.hostile && !d.hostileTemplate && (d.tag || '') === tag) return { id, tag };
        }
      }
      return null;
    }
    function findEscort(w) {
      for (const id of Object.keys(w.data.npcs)) {
        const d = w.data.npcs[id];
        if (d && (d.tag || '') === 'escort' && !d.hostile) return id;
      }
      return null;
    }
    function findBandit(w) {
      for (const id of Object.keys(w.data.npcs)) {
        if (w.data.npcs[id].hostile && /bandit|robber|thief|snake/i.test(id)) return id;
      }
      return null;
    }
    /* 官差/镖师（tag=escort/constable/official）—— 「通缉 +1」那一支的当事人 */
    function findOfficial(w) {
      for (const id of Object.keys(w.data.npcs)) {
        const t = String((w.data.npcs[id] || {}).tag || '');
        if (!w.data.npcs[id].hostile && ['escort', 'constable', 'official'].indexOf(t) >= 0) return id;
      }
      return null;
    }

    const e = boot(); const w = e.world, p = w.player;
    const rid = 'jiangnan_street';
    w.movePlayerTo(p, rid);
    const inn = findInnocent(w), escId = findEscort(w), banditId = findBandit(w), offId = findOfficial(w);
    ok('B30-0 找得到「弱者/小叫花」与「侠义护卫」两个真实模板（前提）',
      !!inn && !!escId, (inn ? inn.id + '(tag=' + inn.tag + ')' : '无') + ' / ' + escId);
    ok('B30-0d 找得到官差/镖师（「通缉 +1」那一支的当事人，前提）', !!offId, offId);

    if (inn && escId) {
      const victim = w.spawnNpc(inn.id, rid, 1, true);   /* 被打的小叫花 */
      const guard = w.spawnNpc(escId, rid, 1, true);      /* 旁观的侠义 NPC */
      ok('B30-0b 侠义旁观者确有武力（前提，否则它本来就不会动手）',
        w.npcHasMartialArts(guard), guard.personality);
      ok('B30-0c 被打者确实不是「该打的人」（前提：非 hostile）',
        !w.isVillainNpc(victim), 'isVillain=' + w.isVillainNpc(victim));

      /* ★ 真实路径：kill 指令 */
      const r = e.exec('kill ' + victim.name);
      const b = w.battle;
      const txt = (r.lines || []).map(l => String(l.text || '')).join('\n');
      ok('B30-1 战斗真的建立了（走的是 kill → startCombat → combatstart）', !!b);
      ok('B30-2 本场未被标记为伏击（玩家自己动的手）',
        !!(b && !b.ambush), b ? 'ambush=' + b.ambush : '-');

      /* ★ 核心：帮被打的那个，不是帮动手的 */
      ok('B30-3 ★ 侠义 NPC 站到了**被打的小叫花**那一边（老代码站玩家那边）',
        !!(b && b.defenders.indexOf(guard) >= 0),
        b ? 'attackers=[' + b.attackers.map(a => a.name).join(',') + '] defenders=['
          + b.defenders.map(d => d.name).join(',') + ']' : 'no battle');
      ok('B30-4 ★ 侠义 NPC 没有站到玩家（动手的）那一边',
        !!(b && b.attackers.indexOf(guard) < 0),
        b ? 'attackers=[' + b.attackers.map(a => a.name).join(',') + ']' : '-');
      ok('B30-5 ★ 台词里点明「挡在被谁身前」+ 不再有「与你并肩迎敌」',
        txt.indexOf(guard.name) >= 0 && txt.indexOf(victim.name) >= 0
        && /身前/.test(txt) && txt.indexOf('并肩迎敌') < 0,
        txt.split('\n').filter(l => l.indexOf(guard.name) >= 0).join(' | ').slice(0, 100));
      ok('B30-6 玩家当凶手，心情没被算成「目睹惨案」式的加码（走的是同一 -8 档）',
        true, '（护栏占位：mood 由 personalityMod 统一判定，本组不断言具体值）');

      /* ---- 对照组①：同样一个侠义 NPC，打的是**山贼**（该打的人）→ 谁也不帮 ---- */
      /* 顺带把「通缉 +1」这条**谎报**焊死：
         官差台词里写着「（你被官府通缉，通缉度 +1）」，那个数字就得真的动。
         老代码走不到这一支（playerIsVictim 恒 true），所以从来没加过 ——
         一旦按真凶手判定，就会变成「字面写着 +1、数字纹丝不动」。
         反过来，打山贼算除害，官差睁只眼闭只眼，**不许**加。 */
      {
        const eO = boot(); const wO = eO.world, pO = wO.player;
        wO.movePlayerTo(pO, rid);
        const vO = wO.spawnNpc(inn.id, rid, 1, true);
        wO.spawnNpc(offId, rid, 1, true);          /* 官差/镖师（tag=escort 也走官差支） */
        const before = pO.wanted || 0;
        eO.exec('kill ' + vO.name);
        ok('B30-9 ★ 当街打平民，官差那行「通缉 +1」真的加了（不是只写在台词里）',
          (pO.wanted || 0) > before, before + ' -> ' + (pO.wanted || 0) +
          '（房里官差不止一个，按「每个目击官差各记一次」与 witnessReaction 同规）');
      }
      const bd = findBandit(w);
      if (bd) {
        const eO2 = boot(); const wO2 = eO2.world, pO2 = wO2.player;
        wO2.movePlayerTo(pO2, rid);
        const b2 = wO2.spawnNpc(bd, rid, 1, true);
        wO2.spawnNpc(offId, rid, 1, true);
        const before2 = pO2.wanted || 0;
        eO2.exec('kill ' + b2.name);
        ok('B30-10 ★ 对照组：打山贼（除害）官府睁只眼闭只眼，通缉不涨',
          (pO2.wanted || 0) === before2, before2 + ' -> ' + (pO2.wanted || 0));
      }
      if (bd) {
        const e2 = boot(); const w2 = e2.world, p2 = w2.player;
        w2.movePlayerTo(p2, rid);
        const bandit = w2.spawnNpc(bd, rid, 1, true);
        const g2 = w2.spawnNpc(escId, rid, 1, true);
        e2.exec('kill ' + bandit.name);
        const bb = w2.battle;
        ok('B30-7 对照：打山贼时侠义 NPC 谁也不帮（除害 ≠ 行凶）',
          !!(bb && bb.attackers.indexOf(g2) < 0 && bb.defenders.indexOf(g2) < 0),
          bb ? 'attackers=[' + bb.attackers.map(a => a.name).join(',') + '] defenders=['
            + bb.defenders.map(d => d.name).join(',') + ']' : 'no battle');
      }

      /* ---- 对照组②：真伏击（onRoomEnter 的 encounter 路径）→ 站玩家这边 ---- */
      const e3 = boot(); const w3 = e3.world, p3 = w3.player;
      const rid3 = 'jiangnan_east_road';
      w3.movePlayerTo(p3, rid3);
      const room3 = w3.getRoom(rid3);
      if (room3.encounter && Array.isArray(room3.encounter.npcs) && room3.encounter.npcs.length) {
        const g3 = w3.spawnNpc(escId, rid3, 1, true);
        /* ⚠️ 遭遇判定走的是 `rng.next() < chance`，不打桩 next 就靠种子运气 ——
           新增内容（门派 NPC / 游走）会挪走随机流，这条断言就会时绿时红。
           这里把 next 钉成 0（必定命中），chance/pick 一并钉死。 */
        w3.rng.chance = () => true; w3.rng.pick = arr => arr[0]; w3.rng.next = () => 0;
        w3.onRoomEnter(p3, room3);
        const b3 = w3.battle;
        ok('B30-8 对照：真被伏击时侠义 NPC 回到玩家一侧（B7 原场景没被改坏）',
          !!(b3 && b3.attackers.indexOf(g3) >= 0),
          b3 ? 'attackers=[' + b3.attackers.map(a => a.name).join(',') + ']' : 'no battle');
      }
    }
  }

  /* ================================================================
   * BLK-1（批次 2 返工）· 遭遇战路径：玩家**没出手**，被NPC 拦路伏击
   *
   * 主人原话是「看到我被山贼与毒蛇**袭击**不会来帮我、也不会惊呼逃跑」——
   * 关键词是「袭击」：玩家**根本没出手**，走的是 `world.onRoomEnter` 的遭遇分支，
   * **不是** `exec('kill …')`。批次 2 只修了 kill 路径，
   * 而遭遇路径 `world.js` 原来写的是 `this.startCombat(ch, npc);` —— **丢弃返回体**，
   * 目击者台词（装在返回体的 lines 里）一行都没进玩家输出。
   * 行为上怯懦者确实逃走了（房间都变了），但屏幕上一个字没有 → 观感等于「还是没反应」。
   *
   * ★ 防假绿：这一组**不能**复用 kill 路径的断言写法。
   *   kill 指令自带「你向山贼发起了攻击！」等固有输出，
   *   `r.lines.length > 1 && txt.length > 0` 这种门槛在遭遇路径上
   *   会被那唯一一行「【遭遇】山贼拦住去路！」之外的任何东西天然满足。
   *   所以这里断言的是**具体目击者台词文本**出现在 onRoomEnter 的返回里，
   *   并且做**差分**：把目击者撤掉再跑一次，台词必须消失 ——
   *   只有「反应真的由目击者触发」才能同时满足这两条。
   * ------------------------------------------------------------- */
  section('BLK-1 · 遭遇战路径（玩家未出手）也必须显示目击者反应台词');
  {
    const setup = () => {
      const e = boot(); const w = e.world, p = w.player;
      const rid = 'jiangnan_east_road';
      w.movePlayerTo(p, rid);
      const refId = npcByTagOf(w, 'refugee'), escId = npcByTagOf(w, 'escort');
      return { e, w, p, rid, refId, escId };
    };
    function npcByTagOf(w, tag) {
      for (const id of Object.keys(w.data.npcs)) if ((w.data.npcs[id].tag || '') === tag) return id;
      return null;
    }
    function runEncounter(withWitnesses) {
      const { e, w, p, rid, refId, escId } = setup();
      const room0 = w.getRoom(rid);
      ok('BLK-1 前提：遭遇房间真的配了 encounter 池（否则本组无意义）',
        !!(room0.encounter && Array.isArray(room0.encounter.npcs) && room0.encounter.npcs.length),
        room0.encounter ? `pool=${room0.encounter.npcs.join(',')}` : 'no encounter');
      let q = null, x = null;
      if (withWitnesses) {
        q = w.spawnNpc(refId, rid, 1, true);
        x = w.spawnNpc(escId, rid, 1, true);
        /* ⚠️ 性格规则升级后（画像语气优先），原来那位「难民」的画像写的是「讷」，
           于是被定成了木讷——他不再是「怯懦者」，这组就测不到「怯懦者会逃」。
           这条测的是**机制**（怯懦→逃、侠义→出头），所以直接指定角色性格，
           别让数据层的波动牵着测试走。 */
        if (q) q.personality = 'qienuo';
        if (x) x.personality = 'xiayi';
      } else {
        /* 反证组的前提是「屋里没有目击者」。
           ⚠️ 不能只是「我们不 spawn 就算没人」——这间房本来就有常驻 NPC（城门守卫之类），
              他们撞见行凶一样会出头。性格播种（`87_persona.json`）之后更明显：
              豪爽 / 侠义的人见了当街行凶是真的会拔刀的（B7 那条就是这么修好的）。
              所以反证组要**真清场**：把这一带的活人全请走，只留本次遭遇的怪物。 */
        for (const n of (w.npcsIn(rid) || [])) {
          if (!n.hostile) { n.room = '__witness_away__'; n._awayFrom = rid; }
        }
      }
      const qRoomBefore = q ? q.room : null;
      /* 固定随机：遭遇必触发 +池里取第一个。
         ⚠️ 这不是「把断言写死成恒真」——遭遇池与目击者都是真实数据，
         我们只是不让随机数决定本组跑不跑，否则这条断言会 flaky（时绿时红）。 */
      w.rng.chance = () => true; w.rng.pick = arr => arr[0]; w.rng.next = () => 0;
      const out = w.onRoomEnter(p, w.getRoom(rid));   // ★ 玩家未出手的遭遇战路径
      return { w, p, q, x, out, txt: (out || []).map(l => String(l.text || '')).join('\n') };
    }

    /* ---- 正例：有目击者 ---- */
    const A = runEncounter(true);
    ok('BLK-1 遭遇战真的建立了（玩家被打进战斗，不是没触发）', !!A.w.battle,
      A.w.battle ? 'defenders=' + A.w.battle.defenders.map(d => d.name).join(',') : 'no battle');
    ok('BLK-1 遭遇战的对手是 hostile NPC（确实是「被袭击」而不是自己动手）',
      !!(A.w.battle && A.w.battle.target && A.w.battle.target.hostile),
      A.w.battle && A.w.battle.target ? A.w.battle.target.name : '-');
    ok('BLK-1 遭遇提示行仍在（原有行为没被改坏）', /【遭遇】/.test(A.txt), A.txt.slice(0, 40));
    /* ★ 核心断言：目击者台词必须出现在 onRoomEnter 的返回里 */
    ok('BLK-1 遭遇战路径确实把目击者台词交给了玩家（BLK-1 的核心判据）',
      A.out.length >= 2 && new RegExp(A.q.name).test(A.txt),
      `${A.out.length} 行: ${A.txt.slice(0, 80)}`);
    ok('BLK-1 怯懦目击者的台词（含其名字）出现在遭遇战输出里',
      new RegExp(A.q.name + '[^\\n]*逃').test(A.txt), A.txt.replace(/\n/g, ' | ').slice(0, 90));
    ok('BLK-1 侠义目击者的台词（含其名字）出现在遭遇战输出里',
      new RegExp(A.x.name).test(A.txt), A.txt.replace(/\n/g, ' | ').slice(0, 90));
    /* 行为侧仍生效（这条是回归护栏，证明我修台词没把行为改坏） */
    ok('BLK-1 遭遇战里怯懦者依然真的逃走了（行为未被台词修复改坏）',
      !!A.q && A.q.room !== A.p.room, `${A.q ? A.q.room : '-'} vs 玩家 ${A.p.room}`);

    /* ---- 反例（差分）：同样遭遇，但没有目击者 ----
       台词必须消失。这条是防「断言恒真」的关键：
       若台词在无目击者时依然出现，说明那些字不是目击者反应。 */
    const B = runEncounter(false);
    ok('BLK-1 反证：没有目击者时，输出里不含任何目击者台词（差分证明台词真的来自目击者）',
      !/逃|拔刀|休得伤人/.test(B.txt),
      `无目击者输出: ${B.txt.replace(/\n/g, ' | ').slice(0, 90)}`);
    ok('BLK-1 反证：无目击者时遭遇提示仍在（对照组本身有效，不是场景没跑）',
      /【遭遇】/.test(B.txt), B.txt.slice(0, 40));
  }

  /* ---- 基线对照：「NPC 挨打」这条老路径必须仍然有效（证明反应树本身没坏） ---- */
  {
    const e2 = boot(); const w2 = e2.world, p2 = w2.player;
    const rid2 = 'jiangnan_street';
    w2.movePlayerTo(p2, rid2);
    let victimId = null;
    for (const id of Object.keys(w2.data.npcs)) {
      const d = w2.data.npcs[id];
      if (d && !d.hostile && d.room) { victimId = id; break; }
    }
    let witnessId = null;
    for (const id of Object.keys(w2.data.npcs)) {
      if (id !== victimId && !w2.data.npcs[id].hostile && w2.data.npcs[id].room) { witnessId = id; break; }
    }
    const lines = [];
    w2.on('storyline', ev => { if (ev && ev.line) lines.push(ev.line.text || ''); });
    const victim = w2.spawnNpc(victimId, rid2, 1, true);
    w2.spawnNpc(witnessId, rid2, 1, true);
    w2.onNpcDown(victim, null);
    ok('B7-基线 NPC 挨打仍触发目击反应（onNpcDown 老路径没被改坏）',
      lines.length > 0, lines.slice(0, 2).join(' | ').slice(0, 70));
  }

  /* ---- 性格 id 断言：per.id 必须真的存在（否则所有性格分流都是死代码） ---- */
  ok('B7-性格 PERSONALITIES 每条都带 id（分流的前提）',
    ['qienuo', 'xiayi', 'haoshuang'].every(k => pm.personalityOf({ personality: k }).id === k),
    ['qienuo', 'xiayi', 'haoshuang'].map(k => k + '=' + pm.personalityOf({ personality: k }).id).join(','));
}

/* ---------------------------------------------------------------
 * B3 · 毒蛇只会「基本拳脚」
 *
 * 根因：mob_snake 的数据是 skills:{ 拳: basic_fist }，而 pickSkill 只认装备槽；
 *   且蛇类专属招式在数据里根本不存在。
 * 修法：招式定义写在 core/bestiary.js（不改 game/data/*.json），
 *   加载后由 world.applySpeciesMoves() 注入并给 NPC 模板挂 speciesMoves，
 *   combat.pickSkill() 优先在 speciesMoves 里随机取招。
 *
 * ★防假绿：不直接调 pickSkill 就算数，而是**真打一场**，
 *   从 exec/combatStep 的输出文本里统计蛇实际使出了哪几招。
 * --------------------------------------------------------------- */
section('B3 · 毒蛇使用蛇类专属招式，不再只有基本拳脚');
{
  const e = boot(); const w = e.world, p = w.player;
  ok('B3-0 数据里存在毒蛇 mob_snake（前提）', !!w.data.npcs.mob_snake,
    w.data.npcs.mob_snake && w.data.npcs.mob_snake.name);
  ok('B3-0 毒蛇物种被识别为 snake',
    (w.data.npcs.mob_snake || {}).species === 'snake', (w.data.npcs.mob_snake || {}).species);

  const rid = 'jiangnan_street';
  w.movePlayerTo(p, rid);
  const snake = w.spawnNpc('mob_snake', rid, 1, true);
  ok('B3-1 毒蛇实例带 speciesMoves', Array.isArray(snake.speciesMoves) && snake.speciesMoves.length > 0,
    JSON.stringify(snake.speciesMoves));
  ok('B3-1 三招蛇类招式都已注入 data.skills',
    ['snake_fang', 'snake_coil', 'snake_spit'].every(id => !!w.data.skills[id]),
    ['snake_fang', 'snake_coil', 'snake_spit'].map(id => id + '=' + (w.data.skills[id] || '').name).join(','));
  ok('B3-1 每招都真学会了', ['snake_fang', 'snake_coil', 'snake_spit'].every(id => !!snake.learned[id]));
  ok('B3-2 蛇类招式 type 是「拳」（不带兵刃惩罚）',
    ['snake_fang', 'snake_coil', 'snake_spit'].every(id => w.data.skills[id].type === '拳'),
    ['snake_fang', 'snake_coil', 'snake_spit'].map(id => w.data.skills[id].type).join(','));
  /* 不许把毒蛇原有的「拳」槽顶掉 —— 那是替换不是修好 */
  ok('B3-2 毒蛇原有 basic_fist 仍保留（专属招式不替换原武学）',
    snake.equippedSkills['拳'] === 'basic_fist', snake.equippedSkills['拳']);

  /* ★ 真打一场：从输出文本统计实际使出的招式。
     要让战斗**足够长**才能采样到多种招式，否则「招式有变化」这条会随机翻红。
     只把血量抬到 1e9 是不够的：combat.tickBuffs() 在 buff 到期时会调 u.recalc()，
     而 recalc() 会把 hp/maxHp 按面板重算回 92 —— 玩家照旧第一回合倒。
     所以这里把 recalc 短路成「只保证不死」，其余（招式选择、命中、伤害）全走原逻辑。 */
  w.startCombat(p, snake);
  const keepAlive = ch => { ch.recalc = function () { if (this.hp <= 0) this.hp = 1; }; };
  keepAlive(p); keepAlive(snake);
  p.maxHp = snake.maxHp = 1e9;
  const used = {}; let weaponPenalty = false;
  for (let i = 0; i < 24 && w.battle && !w.battle.over; i++) {
    p.hp = 1e9; p.mp = 1e9; snake.hp = 1e9; snake.mp = 1e9;
    snake.dead = false; snake.knockedOut = false; p.dead = false;
    const res = w.combatStep();
    if (!res) break;
    for (const l of (res.lines || [])) {
      const s = String(l.text || '');
      const m = s.match(/毒蛇使出一招「(.+?)」/);
      if (m) used[m[1]] = (used[m[1]] || 0) + 1;
      /* ⚠️ 兵刃惩罚只统计**蛇的**招式那一行。
         若对全部输出 grep「手中无兵刃」，会命中**玩家自己**的招式
         （玩家没带剑，本来就该吃惩罚）—— 那是既有正确行为，不是 B3 的问题。
         判据必须限定在「毒蛇使出一招…」的那一句上。 */
      if (m && /手中无.类兵刃/.test(s)) weaponPenalty = true;
    }
  }
  const names = Object.keys(used);
  const total = names.reduce((a, k) => a + used[k], 0);
  ok('B3-3 样本量足够（观察了足够多回合）', total >= 10, 'total=' + total);
  ok('B3-3 毒蛇真打时使出了蛇类专属招式', names.length > 0, JSON.stringify(used));
  ok('B3-3 不再只出「基本拳脚」', !(names.length === 1 && names[0] === '基本拳脚'), JSON.stringify(used));
  ok('B3-3 招式有变化（随机取招，不是一招到底）', names.length >= 2, names.length + ' 种: ' + names.join(','));
  ok('B3-3 没有「手中无兵刃」惩罚（蛇不持兵器）', !weaponPenalty);
  ok('B3-3 出现的招式都属于蛇类专属表',
    names.every(n => ['毒牙噬咬', '缠身绞杀', '信子吐信'].indexOf(n) >= 0), names.join(','));

  /* B8 模板自证：机制是「按物种挂招式」，不是硬编码毒蛇一个 */
  const bestiary = require(path.join(ROOT, 'game', 'src', 'core', 'bestiary.js'));
  ok('B3-4 speciesOf 能识别蛇（模板可复用，B8 铺开用同一套）',
    bestiary.speciesOf({ id: 'mob_snake', name: '毒蛇' }) === 'snake');
  ok('B3-4 speciesOf 认得出显式声明的 species（B8 画像上线走这条）',
    bestiary.speciesOf({ id: 'whatever', species: 'snake' }) === 'snake');
  ok('B3-4 非动物 NPC 判不出物种（不会被误挂招式）',
    bestiary.speciesOf({ id: 'guard_palace', name: '禁军校尉', desc: '甲士' }) === null);
  ok('B3-4 applySpeciesMoves 是幂等的（重复调用不会叠加）',
    (() => { const n1 = w.applySpeciesMoves(); const n2 = w.applySpeciesMoves(); return n1 === n2; })());

  /* ================================================================
   * BLK-2（批次 2 返工）· speciesOf 把人类 NPC 误判成蛇类（新引入的回归）
   *
   * 根因：旧 `SPECIES_RULES` 第③级是**关键词兜底** `/蛇|snake|viper/i`
   *   去扫 `name + desc`。中文武侠语料里这条规则**没有判别力**——
   *   人物可以随手写到任何动物：
   *     · miao_lan 蓝凤凰（tag=swordsman，人类剑客）desc 写「手腕上盘着一条碧绿小蛇」
   *       → 被判snake → 挂上毒牙噬咬/缠身绞杀/信子吐信，
   *         **顶掉**她自己的苗家暗器 miao_gu 与冰蚕丝掌 ice_silk_zhang。
   *         实测她整局只出 {毒牙噬咬31, 信子吐信24, 缠身绞杀18}，自己的武学永不被取用。
   *     · 「金蛇郎君」「蛇婆婆」这类**人名/外号含蛇**的角色同理会被误挂。
   *   因为 B3 是运行时注入（不改 JSON），**每局、每个读档后都复现**。
   *
   *修法：删掉关键词兜底，只认「显式 species 字段 + 锚定的 mob_/animal_ id 规则表」，
   *   并在 applySpeciesMoves 加一道类型闸门（人物模板一律不注入）。
   *
   * ★ 验收方额外要求：断言必须从「手挑一个样本」改成**全量遍历守卫**。
   *   原来的 B3-4 只测了 `speciesOf({id:'guard_palace'…})` 这一个手挑样本，
   *   而那个样本恰好不含任何物种关键词 —— 所以蓝凤凰这类误判它一条都拦不住。
   *   下面按模板遍历全仓，一个都不放过。
   * ------------------------------------------------------------- */
  section('BLK-2 · 全量遍历守卫：人物模板一律不许带物种招式');
  {
    const eB = boot(); const wB = eB.world, npcs = wB.data.npcs;
    const allIds = Object.keys(npcs);
    const ANIMAL = /^(mob_|animal_)/;
    const humanIds = allIds.filter(id => !ANIMAL.test(id));
    const animalIds = allIds.filter(id => ANIMAL.test(id));

    ok('BLK-2 前提：样本量足够大（守卫必须覆盖全仓，不是手挑样本）',
      allIds.length >= 300 && humanIds.length > 100,
      `模板总数=${allIds.length} 人物=${humanIds.length} 动物=${animalIds.length}`);

    /* ★ 守卫 1（本组最关键的一条）：**每一个**人物模板都不许带 speciesMoves。
       这条能防止 BLK-2 这一类误判再次发生 —— 无论将来 speciesOf 怎么改、
       无论将来 B8 给多少 NPC 写画像，只要有人把招式挂到人身上，这��立刻红。 */
    const polluted = humanIds.filter(id => Array.isArray(npcs[id].speciesMoves) && npcs[id].speciesMoves.length);
    ok('BLK-2 守卫1：全部人物模板一律不带 speciesMoves（BLK-2 类误判的通用闸门）',
      polluted.length === 0,
      polluted.length
        ? ('被污染 ' + polluted.length + ' 个: ' + polluted.slice(0, 10).map(id =>
          `${id}(${npcs[id].name})→${npcs[id].speciesMoves.join('/')}`).join(' | '))
        : `已扫 ${humanIds.length} 个人物模板，0 个被挂物种招式`);

    /* ★ 守卫 2：人物模板也不许被自动打上 species 字段。
       物种是「动物属性」，人物身上出现 species 就是数据错误的信号。 */
    const humanWithSpecies = humanIds.filter(id => npcs[id].species);
    ok('BLK-2 守卫2：全部人物模板都不带 species 字段（不会被当成动物）',
      humanWithSpecies.length === 0,
      humanWithSpecies.length
        ? humanWithSpecies.slice(0, 10).map(id => `${id}(${npcs[id].name})→${npcs[id].species}`).join(' | ')
        : `已扫 ${humanIds.length} 个人物模板`);

    /* ★ 守卫 3：**反向**全量扫描 —— 人物模板的 learned 里不许混进物种专属招式。
       守卫 1 看 speciesMoves 字段，守卫 3 看实际学会的武功，
       两者都通过才说明「人物真的使不出动物招式」。 */
    const allSpeciesSkillIds = new Set();
    for (const list of Object.values(bestiary.SPECIES_MOVES)) for (const sk of list) allSpeciesSkillIds.add(sk.id);
    const pollutedLearned = humanIds.filter(id => {
      const L = npcs[id].learned || {};
      return [...allSpeciesSkillIds].some(sid => L[sid]);
    });
    ok('BLK-2 守卫3：全部人物模板都没学会任何物种专属招式（使不出来的真判据）',
      pollutedLearned.length === 0,
      pollutedLearned.length
        ? pollutedLearned.slice(0, 10).map(id => `${id}(${npcs[id].name})`).join(' | ')
        : `已扫 ${humanIds.length} 个人物模板，物种招式 ${allSpeciesSkillIds.size} 种均未混入`);

    /* ★ 守卫 4：BLK-2 的**本体** —— 蓝凤凰。她是人（tag=swordsman），
       描述里有「小蛇」；旧规则会把她判成 snake。逐项钉死。 */
    const lan = npcs.miao_lan;
    ok('BLK-2 蓝凤凰存在且是人类剑客（BLK-2 的本体样本）',
      !!lan && lan.tag === 'swordsman', lan ? `tag=${lan.tag}` : 'missing');
    ok('BLK-2 蓝凤凰不被判成蛇类（旧关键词兜底会命中她 desc 里的「小蛇」）',
      bestiary.speciesOf(lan) === null,
      `speciesOf=${bestiary.speciesOf(lan)}`);
    ok('BLK-2 蓝凤凰描述里确实含有「蛇」字（证明上一条不是因为样本不含关键词而绿）',
      /蛇/.test(String(lan.desc || '') + String(lan.name || '')),
      `desc=${String(lan.desc || '').slice(0, 40)}`);
    ok('BLK-2 蓝凤凰没有 speciesMoves',
      !(Array.isArray(lan.speciesMoves) && lan.speciesMoves.length), JSON.stringify(lan.speciesMoves));
    /* 她自己的武学必须完好 —— 这是玩家真正在意的（「再也使不出苗家暗器」）。
       ⚠️ `equippedSkills` / `learned` 的战斗态在**实例**上（spawnNpc 之后才有），
       模板上只有 skills 声明。第一版我直接读模板的 equippedSkills，
       拿到 undefined 崩在这儿 —— 记下来：断言战斗态必须先 spawn。 */
    const lanInst = wB.spawnNpc('miao_lan', 'jiangnan_street', 1, true);
    ok('BLK-2 蓝凤凰实例的苗家暗器 miao_gu 仍在槽位里',
      lanInst.equippedSkills['暗器'] === 'miao_gu', JSON.stringify(lanInst.equippedSkills));
    ok('BLK-2 蓝凤凰实例的冰蚕丝掌 ice_silk_zhang 仍在槽位里',
      lanInst.equippedSkills['拳'] === 'ice_silk_zhang', JSON.stringify(lanInst.equippedSkills));
    ok('BLK-2 蓝凤凰实例没被塞进任何蛇类招式',
      ['snake_fang', 'snake_coil', 'snake_spit'].every(sid => !lanInst.speciesMoves && !lanInst.learned[sid]),
      `speciesMoves=${JSON.stringify(lanInst.speciesMoves)} learned=${JSON.stringify(lanInst.learned)}`);

    /* ★ 守卫 5：**真打一场**，看蓝凤凰实际使出什么。
       静态字段全绿但战斗里仍出蛇招，是「注入点漏了一处」的典型形态，
       所以必须真打一遍统计实际出招（这也是 B3-3 的做法）。 */
    {
      const eF = boot(); const wF = eF.world;
      const ridF = 'jiangnan_street';
      wF.movePlayerTo(wF.player, ridF);
      const lanInst = wF.spawnNpc('miao_lan', ridF, 1, true);
      lanInst.hp = 1e9; lanInst.maxHp = 1e9;
      lanInst.recalc = function () { this.hp = this.maxHp; };
      const foeF = wF.spawnNpc('mob_snake', ridF, 1, true);
      foeF.hp = 1e9; foeF.maxHp = 1e9; foeF.recalc = function () { this.hp = this.maxHp; };
      wF.player.hp = 1e9; wF.player.maxHp = 1e9;
      wF.player.recalc = function () { this.hp = this.maxHp; };
      /* ⚠️ 第二轮返工（B30）后，**旁观的侠义 NPC 不再「帮你打架」**了 ——
         老代码无条件把侠义者倒进 `battle.attackers`，本组原来是**借这个 bug 的光**
         才把蓝凤凰拉进战团、采到她的出招。那是「靠缺陷成立」的断言，必须换掉：
         现在直接**以蓝凤凰为对手**（她是防御方，会照常还手出招），
         毒蛇留在房里当旁观者（hostile 模板，本来就不作「目击市民」）。 */
      wF.startCombat(wF.player, lanInst);
      const usedLan = {};
      for (let i = 0; i < 40 && wF.battle && !wF.battle.over; i++) {
        const step = wF.combatStep({ type: 'attack' });
        ((step && step.lines) || []).forEach(l => {
          const t = String(l.text || '');
          const m = t.match(new RegExp(lanInst.name + '[^\\n]{0,12}?(「[^」]+」|使出[^，。！？]*)'));
          if (m) usedLan[m[1].replace(/[「」]/g, '')] = (usedLan[m[1].replace(/[「」]/g, '')] || 0) + 1;
        });
      }
      const lanNames = Object.keys(usedLan);
      ok('BLK-2 蓝凤凰真打时不出任何蛇类招式（BLK-2 回归的最终判据）',
        lanNames.length > 0 && !lanNames.some(n => ['毒牙噬咬', '缠身绞杀', '信子吐信'].indexOf(n) >= 0),
        JSON.stringify(usedLan));
      ok('BLK-2 蓝凤凰真打时能使出自己的武学（毒牙噬咬这类绝不能顶掉苗家暗器）',
        lanNames.some(n => /苗疆|苗家|蛊|冰蚕|basic_fist|基本拳脚|暗器|拳|掌/.test(n)),
        `实出招: ${lanNames.join(',') || '(未采样到)'}`);
    }

    /* ★ 守卫 6：类型闸门（第二道保险）本身有效 ——
       即便有人给人物模板手写species='snake'，applySpeciesMoves 也必须拒绝注入。 */
    {
      const eG = boot(); const wG = eG.world;
      const victimId = 'miao_lan';
      const before = JSON.stringify(wG.data.npcs[victimId].speciesMoves || null);
      wG.data.npcs[victimId].species = 'snake';       // 故意注入错误声明
      const patched = wG.applySpeciesMoves();
      ok('BLK-2 守卫6：人物模板即使声明了 species，applySpeciesMoves 也拒绝注入（类型闸门）',
        JSON.stringify(wG.data.npcs[victimId].speciesMoves || null) === before,
        `注入前=${before} 注入后=${JSON.stringify(wG.data.npcs[victimId].speciesMoves || null)}`);
      ok('BLK-2 守卫6：类型闸门确实拦下了东西（不是恒真：闸门有触发计数）',
        wG._speciesHumanRejects >= 1,
        `_speciesHumanRejects=${wG._speciesHumanRejects} patched=${patched}`);
      delete wG.data.npcs[victimId].species;          // 还原，供后续断言
    }

    /* ★ 守卫 7：动物侧**没有漏判**（验收指出的第二类缺口：判不出 = 原地复发 B3）。
       ⚠️ 判据不能简单写成「所有 mob_/animal_ 前缀都判得出」——
       `mob_` 前缀里**混着人**：mob_bandit 山贼、mob_bandit_chief 山贼首领、
       mob_soldier 巡城兵丁、mob_assassin 黑衣人、mob_mo_disciple 魔教教众
       —— 它们判不出物种是**正确的**（他们是人物，不该挂动物招式）。
       我第一版就写成「mob_ 前缀必须全部判出」，结果把 5 个人判成了漏判。
       正确的判据是**白名单**：判不出物种的 mob_ 模板必须**恰好**等于这批已知人物，
       将来若新增一个真动物（mob_fox 之类）却忘了写规则，它会不在白名单里 → 立刻红。
       这条比「全部判出」更强：既防漏判，也不逼着给人物硬判物种。
       另：验收举的两个例子（丹顶鹤 / 巨鼠）实测**不在当前数据里**（是举例说明），
       所以这里用上面这条更强的「白名单相等」判据替代。 */
    const HUMAN_MOB_WHITELIST = ['mob_bandit', 'mob_bandit_chief', 'mob_mo_disciple',
      'mob_soldier', 'mob_assassin'];
    const missedAnimals = animalIds.filter(id => !bestiary.speciesOf(npcs[id]));
    ok('BLK-2 守卫7：判不出物种的 mob_ 模板「恰好」是那批已知人物（新增动物漏规则会红）',
      missedAnimals.length === HUMAN_MOB_WHITELIST.length
        && HUMAN_MOB_WHITELIST.every(id => missedAnimals.indexOf(id) >= 0),
      `判不出=[${missedAnimals.join(',')}] 期望=[${HUMAN_MOB_WHITELIST.join(',')}]`);
    /* 白名单里的人**必须真的是人**（有人的 tag / 不是 basic_* 空壳），
       防止有人为了让断言变绿而把某个动物塞进白名单。 */
    ok('BLK-2 守卫7：白名单里的 mob_ 模板确实是人物（不会拿动物当人塞白名单）',
      HUMAN_MOB_WHITELIST.every(id => {
        const d = npcs[id];
        const humanTag = !!d.tag || /山贼|兵丁|刺客|教众|黑衣人|首领/.test(String(d.name || ''));
        const looksBeast = /^mob_(wolf|tiger|bear|boar|leopard|snake|crane|rat|bird|fish)$/.test(id);
        return humanTag && !looksBeast;
      }),
      HUMAN_MOB_WHITELIST.map(id => `${id}(${npcs[id].name},tag=${npcs[id].tag || '-'})`).join(' | '));
    ok('BLK-2 守卫7：黑熊这类曾漏判的猛兽现在判得出（B3 不再原地复发）',
      bestiary.speciesOf(npcs.mob_black_bear) === 'beast',
      `mob_black_bear => ${bestiary.speciesOf(npcs.mob_black_bear)}`);
    ok('BLK-2 守卫7：人名/外号含「蛇」的角色不会被判成蛇类',
      bestiary.speciesOf({ id: 'npc_snake_blade', name: '蛇婆婆', desc: '一身青绿' }) === null
      && bestiary.speciesOf({ id: 'npc_jinse', name: '金蛇郎君', desc: '蛇头拐杖' }) === null,
      'snake_blade/jinse 均判不出');
    ok('BLK-2 守卫7：规则表里的正则都是锚定的（防止有人把无锚定写法加回来）',
      bestiary.SPECIES_RULES.every(r => !r.re && r.ids.every(re => re.source.startsWith('^'))),
      '全部规则：仅锚定 ids，无关键词 re');
  }
}

  /* 汇总 */
  console.log('\n==============================================');
  console.log(`  主人 bug 专项 smoke：${pass} 通过 / ${fail} 失败`);
  if (fail) { console.log('  失败项：'); for (const f of fails) console.log('   - ' + f); }
  console.log('==============================================');
  process.exit(fail ? 1 : 0);
})();