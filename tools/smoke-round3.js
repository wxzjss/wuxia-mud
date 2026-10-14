/**
 * smoke-round3.js —— 第三轮三项（主人亲报）专项回归
 *
 *  §F 玩家「昏倒」（不是死）+ 最近客栈醒转
 *      —— 走**真实链路**：真 engine、真 startCombat、真 combatStep 打倒自己、
 *         真 exec('look') 触发 postProcess 的苏醒流程。
 *  §M mod 生态字段口径：加载器归一化 / 官方示例 mod / mod 制作器 / 模组站内容同步
 *      —— 根因是「游戏本体的 skills.type 是中文槽位名，示例 mod 与制作器兜底写英文」，
 *         写英文的武学**装不上任何槽位**（半静默失效）。
 *
 * 纪律：
 *   · 不 new World() 空壳；走 new GameEngine({seed}).boot().newGame()
 *   · 断言打在**真实调用路径**上（真 exec / 真 startCombat / 真 normalizeSpec）
 *   · 无恒真断言；随机源固定 seed
 *   · 不写盘（站点内容同步那条只读比对 hash）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const survival = require(path.join(ROOT, 'game', 'src', 'core', 'survival.js'));
const modfields = require(path.join(ROOT, 'game', 'src', 'core', 'modfields.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}
function section(t) { console.log('\n' + t); }
/* ⚠️ 2026-10-17 M68 判据连带：官方示例 mod 默认关（enabledByDefault:false，玩家侧
   默认干净）。要验示例 mod 本身的段（M-2 族）在测试环境**显式开**对应 mod——
   只改 modLoader 内存态（state.enabled + m.enabled）。
   ⚠️ 污染案根因补充（同日）：boot() 末尾 resolveLoadOrder() 会**无条件 saveState()**，
   「只改内存态」也会被写进工作目录 mods-state.json（今晨根目录残留即此来路，
   连带 demo-mods-check ④ 假红）——isolatedEngine 构造后 no-op saveState，零写盘，
   玩家侧默认关口径不变（mainline35 §⑩ 同族口径）。 */
const isolatedEngine = (opts) => {
  const e = new GameEngine(opts);
  e.modLoader.saveState = function () {};
  return e;
};
const enableModsInMem = (e, ids) => {
  for (const id of ids) {
    e.modLoader.state.enabled[id] = true;
    const m = e.modLoader.mods.find(x => x.id === id);
    if (m) m.enabled = true;
  }
  return e;
};
const boot = (seed, mods) => {
  const e = isolatedEngine({ seed: seed || 20261011, saveDir: SAVE_DIR });
  if (mods && mods.length) enableModsInMem(e, mods);
  e.boot(); e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
  return e;
};
/** 把玩家打到昏倒（真战斗），返回战斗过程里出现过的所有行 */
function beatSelfUp(e, roomId, foeId) {
  const w = e.world, p = w.player;
  w.movePlayerTo(p, roomId);
  const foe = w.spawnNpc(foeId, roomId, 1, true);
  p.hp = 1; p.maxHp = Math.max(100, p.maxHp);
  w.startCombat(p, foe);
  let out = [];
  for (let i = 0; i < 60 && w.battle && !w.battle.over; i++) {
    const st = w.combatStep({ type: 'attack' });
    out = out.concat((st && st.lines) || []);
  }
  return { w, p, foe, out };
}
const txt = arr => (arr || []).map(x => String(x.text || '')).join('\n');

/* ================================================================
 * §F 昏倒
 * ================================================================ */
section('§F 玩家力竭昏倒（不是「死」）→ 最近客栈醒转');
{
  const e = boot(7);
  const w = e.world, p = w.player;
  const from = 'huashan_siguoya';
  const m0 = p.money = 1000;
  const { out } = beatSelfUp(e, from, 'emei_miejue');

  /* ---- F-1 昏倒行：语义是「昏」，不是「死」 ---- */
  const faintLines = out.filter(l => l.kind === 'faint');
  ok('F-1 被打倒时输出的是 faint（昏倒）行', faintLines.length > 0,
    JSON.stringify(faintLines.map(l => l.text)));
  ok('F-1b ★ 玩家可见的文案里**一个「死」字都没有**',
    !/死/.test(txt(out)), txt(out).split('\n').filter(l => /死/.test(l)).join(' | ') || '(无)');
  ok('F-1c 旧的 combat「倒了下去」不再出现（观感从「被打死」改成「晕过去」）',
    !out.some(l => l.kind === 'combat' && /倒了下去/.test(l.text || '')));

  /* ---- F-2 醒转：落点必须是「最近的客栈」 ---- */
  const expectInn = survival.nearestInn(w, from);
  const r2 = e.exec('look');           /* 真 exec → postProcess → 苏醒 */
  const wake = (r2.lines || []).filter(l => l.kind === 'faint').map(l => l.text).join(' ');
  ok('F-2 苏醒台词出现在玩家输出里（不是只存在内部）', wake.length > 0, wake);
  ok('F-2b ★ 苏醒地点是 BFS 最近的客栈', p.room === expectInn,
    `落点 ${p.room}(${(w.getRoom(p.room) || {}).name}) / 期望 ${expectInn}`);
  ok('F-2c 落点确实是「客栈」（名字里带客栈）', /客栈/.test((w.getRoom(p.room) || {}).name || ''),
    (w.getRoom(p.room) || {}).name);
  ok('F-2d 苏醒台词说的是「昏」与「醒转」，且带地名', /醒转|醒过来/.test(wake) && wake.indexOf((w.getRoom(p.room) || {}).name) >= 0, wake);

  /* ---- F-3 结算：报的数字必须等于实扣（老的「谎报」就是这个）---- */
  const lostShown = (() => {
    const m = /银钱少了 (\d+) 文/.exec(txt(r2.lines));
    return m ? parseInt(m[1], 10) : null;
  })();
  ok('F-3 ★ 台词里的「银钱少了 N 文」= 实际扣掉的数（不再谎报）',
    lostShown != null && lostShown === m0 - p.money,
    `台词 ${lostShown} / 实扣 ${m0 - p.money}`);
  ok('F-3b 扣的正好是两成（结算只在一处做，不重复扣）',
    m0 - p.money === Math.floor(m0 * 0.2), `${m0} → ${p.money}`);

  /* ---- F-4 昏倒计数：战斗这条路也要计（老代码从不计）---- */
  ok('F-4 ★ 战斗中被打倒也计入「昏倒数」（老代码只在饿昏/渴昏时计）',
    p.deathCount === 1, 'deathCount=' + p.deathCount);
  ok('F-4b 醒转之后 dead 标记复位（不会卡在「已昏」）', p.dead === false);

  /* ---- F-5 world.playerDeath 只管标记与计数，不许再动钱包 ---- */
  {
    const e5 = boot(8); const w5 = e5.world, p5 = w5.player;
    p5.money = 500; p5.exp = 1000;
    w5.playerDeath();
    ok('F-5 ★ world.playerDeath 不再扣钱扣经验（结算只归 respawnAtInn 一处）',
      p5.money === 500 && p5.exp === 1000 && p5.dead === true && p5.deathCount === 1,
      `money=${p5.money} exp=${p5.exp} dead=${p5.dead} count=${p5.deathCount}`);
  }

  /* ---- F-6 饿昏这条路与战斗那条**同规则**（老代码这条压根不扣钱）---- */
  {
    const e6 = boot(9); const w6 = e6.world, p6 = w6.player;
    p6.money = 800; p6.exp = 1000;
    w6.movePlayerTo(p6, 'huashan_siguoya');
    /* 直接摆出「饿到血空」的当场状态，再走**真 exec** ——
       postProcess 里那条饥渴分支就是真实入口（不必真等几百个 tick 慢慢饿）。 */
    p6.food = 0; p6.water = 0; p6.hp = 0; p6.dead = false;
    const r6 = e6.exec('look');
    const all6 = txt(r6.lines);
    ok('F-6 饿昏/渴昏这条真走到了（出现饥渴昏倒行）', /栽倒在地|人事不省/.test(all6), all6.split('\n')[0]);
    ok('F-6b ★ 饿昏与战斗昏倒同规则：同样扣两成银钱、同样落客栈',
      p6.money === 800 - Math.floor(800 * 0.2) && /客栈/.test((w6.getRoom(p6.room) || {}).name || ''),
      `money 800 → ${p6.money}，落点 ${(w6.getRoom(p6.room) || {}).name}`);
    ok('F-6c 饿昏路径的输出同样不含「死」字', !/死/.test(all6), all6.replace(/\n/g, ' | ').slice(0, 70));
    ok('F-6d 饿昏也计入昏倒数', p6.deathCount === 1, 'deathCount=' + p6.deathCount);
  }

  /* ---- F-7 respawnAtInn 是唯一入口（同名逻辑不许再出现第二份）---- */
  {
    const wSrc = fs.readFileSync(path.join(ROOT, 'game/src/core/engine.js'), 'utf8');
    const wSrc2 = fs.readFileSync(path.join(ROOT, 'game/src/core/world.js'), 'utf8');
    ok('F-7 ★ 复活结算只写在 survival.respawnAtInn 里（engine 内联那份已删除）',
      /survival\.respawnAtInn\(/.test(wSrc)
      && !/p\.money = Math\.floor\(p\.money \* 0\.8\)|const lost = Math\.floor\(p\.money \* 0\.2\)/.test(wSrc),
      'engine 调用 respawnAtInn 且不再自己算 lost');
    ok('F-7b world.playerDeath 里也没有扣钱代码',
      !/money -= lost|p\.money -=/.test(wSrc2.slice(wSrc2.indexOf('playerDeath()'), wSrc2.indexOf('playerDeath()') + 600)));
  }
}

/* ================================================================
 * §M mod 生态字段口径
 * ================================================================ */
section('§M mod 字段口径：加载归一化 / 官方示例 / 制作器 / 站点同步');
{
  const SLOTS = ['拳', '剑', '刀', '棍', '鞭', '暗器', '内功', '轻功', '招架', '身法'];
  const CATS = ['外功', '内功', '奇门', '旁门', '魔功'];

  /* ---- M-1 官方示例 mod：type 必须是中文槽位 ---- */
  {
    const demo = JSON.parse(fs.readFileSync(path.join(ROOT, 'mods/demo_skill/mod.json'), 'utf8'));
    const bad = (demo.skills || []).filter(s => SLOTS.indexOf(String(s.type)) < 0);
    ok('M-1 ★ 官方示例 mod 的武学 type 全是合法中文槽位（不再写 sword/force/dodge）',
      (demo.skills || []).length > 0 && bad.length === 0,
      bad.length ? bad.map(s => s.id + ':' + s.type).join(',') : (demo.skills || []).map(s => s.id + ':' + s.type).join(' '));
    const badCat = (demo.skills || []).filter(s => CATS.indexOf(String(s.category)) < 0);
    ok('M-1b 官方示例 mod 都填了五大类 category', badCat.length === 0,
      badCat.length ? badCat.map(s => s.id).join(',') : (demo.skills || []).map(s => s.category).join('/'));
    const npc = (demo.npcs || [])[0];
    const npcSlots = Object.keys((npc && npc.skills) || {});
    ok('M-1c 示例 mod 的 NPC 也示范了「挂武学到槽位」（原来 skills 是空的，会教的剑法自己不会）',
      npcSlots.length > 0 && npcSlots.every(k => SLOTS.indexOf(k) >= 0),
      npc ? npc.id + ' skills=' + JSON.stringify(npcSlots) : '(无 NPC)');
  }

  /* ---- M-2 加载后：示例 mod 的武学真能装进槽位（真 enable）----
     本段验示例 mod 本身 → 测试环境显式开 demo_skill（M68 默认关的判据连带，
     enableModsInMem：内存态开启，玩家侧默认关不变） */
  {
    const e = boot(7, ['demo_skill']); const w = e.world, p = w.player;
    const s = w.getSkill('taixu_jianyi');
    ok('M-2 示例 mod 的武学加载后 type 是「剑」、category 是「外功」',
      !!s && s.type === '剑' && s.category === '外功', s ? s.type + '/' + s.category : '未加载');
    p.learned['taixu_jianyi'] = { level: 1, exp: 0 };
    const r = e.exec('enable 太虚剑意');
    ok('M-2b ★ `enable` 真把它装进了「剑」槽（写英文时这一步只会得到「没有「sword」这个槽位」）',
      p.equippedSkills['剑'] === 'taixu_jianyi',
      txt(r.lines) + ' → 剑=' + p.equippedSkills['剑']);
    /* 会教的剑法自己得会 */
    const hermit = w.spawnNpc('taixu_hermit', p.room, 1, true);
    ok('M-2c 示例 mod 的 NPC 真的会自己的剑法（不是只会基本拳脚）',
      w.npcHasMartialArts(hermit) && !!hermit.learned['taixu_jianyi'],
      JSON.stringify(Object.keys(hermit.learned || {})));
  }

  /* ---- M-3 归一化函数：英文别名 → 中文；幂等 ---- */
  {
    const data = { skills: {
      a: { type: 'sword' }, b: { type: 'force' }, c: { type: 'dodge' },
      d: { type: 'blade', maxLevel: 0 }, e: { type: '内功', category: '内功' },
    } };
    const r1 = modfields.normalizeWorldData(data);
    ok('M-3 ★ 英文别名被纠正：sword→剑 / force→内功 / dodge→轻功 / blade→刀',
      data.skills.a.type === '剑' && data.skills.b.type === '内功'
      && data.skills.c.type === '轻功' && data.skills.d.type === '刀',
      [data.skills.a.type, data.skills.b.type, data.skills.c.type, data.skills.d.type].join('/'));
    ok('M-3b 缺 category 的按槽位补五大类', data.skills.a.category === '外功' && data.skills.b.category === '内功',
      data.skills.a.category + '/' + data.skills.b.category);
    ok('M-3c 已有的中文 category 不动（不覆盖作者的选择）', data.skills.e.category === '内功');
    ok('M-3d maxLevel 非法/缺省补成本体默认 300', data.skills.d.maxLevel === 300, String(data.skills.d.maxLevel));
    const r2 = modfields.normalizeWorldData(data);
    ok('M-3e ★ 幂等：第二遍不再改动（changed=0）', r2.changed === 0,
      '第一遍 ' + r1.changed + ' 处，第二遍 ' + r2.changed + ' 处');
    ok('M-3f 认不出的 type 原样保留（不瞎猜，别把自定义槽位改掉）',
      modfields.normSkillType('诡异') === '诡异');
  }

  /* ---- M-4 制作器：校验会提示、导出保留 category/quality ---- */
  {
    const e = boot(7);
    const spec = {
      meta: { id: 't_mod', name: '测试', description: 'x' },
      skills: [
        { id: 'k1', name: '测试剑', type: 'sword', maxLevel: 100 },
        { id: 'k2', name: '坏槽位', type: '诡异', maxLevel: 10 },
      ],
    };
    const rep = e.validateSpec(spec);
    ok('M-4 ★ 制作器校验会把「写英文别名」直接提示出来',
      (rep.warnings || []).some(w => /sword/.test(w) && /纠正为/.test(w)),
      (rep.warnings || []).find(w => /sword/.test(w)) || '(没提示)');
    ok('M-4b 校验会指出「诡异」不是合法槽位（不然玩家进游戏才发现装不上）',
      (rep.warnings || []).some(w => /诡异/.test(w) && /槽位/.test(w)),
      (rep.warnings || []).find(w => /诡异/.test(w)) || '(没提示)');
    const files = e.buildModFiles(e.normalizeSpec(spec));
    const k1 = files.files['mod.json'].skills.k1;
    ok('M-4c ★ 导出的 mod.json 里带上了 category 与 quality（原来白名单式只挑字段，填了会被悄悄丢掉）',
      k1.category === '外功' && !!k1.quality, JSON.stringify(k1).slice(0, 140));
    ok('M-4d 导出的 type 已是中文槽位名', k1.type === '剑', k1.type);
    const meta = e.editorMeta();
    ok('M-4e 编辑器元数据给了中文槽位表与五大类表（制作器下拉的单一事实源）',
      meta.skillTypes.length >= 10 && meta.skillTypes.every(t => SLOTS.indexOf(t) >= 0)
      && Array.isArray(meta.skillCategories) && meta.skillCategories.length === 5,
      meta.skillTypes.join('') + ' / ' + (meta.skillCategories || []).join(''));
  }

  /* ---- M-5 模组站内容与磁盘示例同步（只读比对，不写盘）---- */
  {
    const idxPath = path.join(ROOT, 'server/site-data/mods.json');
    if (!fs.existsSync(idxPath)) {
      ok('M-5 模组站数据文件存在', false, '缺 ' + idxPath);
    } else {
      const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
      /* ⚠️ 指纹口径必须与 mod-site.js 的 seedOfficialMods **完全一致**：
         那边是 `md5(JSON.stringify(解析后的 json))`（紧凑序列化），
         不是文件字节的 md5 —— 文件是 2 空格缩进 + 尾换行。
         口径不一致这条断言会恒红，而且红得没有意义。 */
      const fp = s => crypto.createHash('md5').update(JSON.stringify(JSON.parse(s))).digest('hex');
      const demos = fs.readdirSync(path.join(ROOT, 'mods'))
        .filter(d => d.startsWith('demo_') && fs.existsSync(path.join(ROOT, 'mods', d, 'mod.json')));
      const stale = [];
      for (const d of demos) {
        const raw = fs.readFileSync(path.join(ROOT, 'mods', d, 'mod.json'), 'utf8');
        const entry = (idx.mods || []).find(m => m.id === d);
        if (!entry) { stale.push(d + '(站点没有)'); continue; }
        if (entry.hash !== fp(raw)) stale.push(d + '(内容不一致)');
      }
      ok('M-5 ★ 模组站里的官方示例与磁盘上的一致（改了示例文件，站点那份要跟着更新）',
        stale.length === 0, stale.join('、') || demos.length + ' 个示例全部同步');
      ok('M-5b 站点条目带 official 标记与内容指纹（seed 靠它判断要不要覆盖）',
        (idx.mods || []).filter(m => m.official).every(m => !!m.hash && m.official === true),
        (idx.mods || []).filter(m => m.official).map(m => m.id).join(','));
    }
  }
}

console.log('\n' + '='.repeat(48));
console.log(`  第三轮专项回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
