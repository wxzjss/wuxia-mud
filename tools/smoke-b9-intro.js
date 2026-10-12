/**
 * smoke-b9-intro.js —— 开场（楔子）专项回归 · 角色扮演版
 *
 * 台账：design/12-owner-bug-list.md B9 · 设计 design/17-intro-rewrite.md
 *
 * 🔴 2026-10-12 重大口径变更（主人钦定）：
 *   老版楔子 = `view.intro`（**一张静态卡片**，点「踏入江湖」就完）。
 *   新版     = `view.opening`（**三轮角色扮演**：① 我是谁 → ② 我是男是女 →
 *              ③ 那扇门（出身分版旁白 + 前世回忆），演完才进第一章）。
 *   ⇒ 老接口 `view.intro` **退休**：恒回 `{show:false}`（保留键给老代码兜底），
 *      正文/标题不再由它给。老版本文件里那套「13 版静态正文五十项硬钉」随之作废
 *      ——那些字现在住在 `intro.js` 的 RP 屏里，由 ①~④ 段按新接口重守。
 *
 * 现在锁死的是：
 *   ① 三轮状态机：birth → gender → close → done，每一步 p.vars 跟着落盘
 *   ② 每一屏都是**真数据**：出身选项来自 meta.births、性别两选、收尾含老汉
 *   ③ 文本禁令：各屏正文不含指令名 / 现代词 / 失忆 / 剧透 / 旧舞台
 *   ④ 老接口退休：view.intro 恒 {show:false}、tutorial.introFor 仍在但不被 view 调用
 *   ⑤ seen_intro 行为不变：看过就不再弹、跨存档留存
 *   ⑥ tutorial.js 导出面不因下线而缺（引荐信 / 出身链照旧可用）
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真走 GameEngine → view().opening
 *   · `new World()` 是空壳，必须走 GameEngine.boot()
 *   · 存档走独立沙盒（tools/_test-save-dir.js），不碰玩家 saves/
 */
'use strict';
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const tutorial = require(path.join(ROOT, 'game', 'src', 'core', 'tutorial.js'));
const introMod = require(path.join(ROOT, 'game', 'src', 'core', 'intro.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
/** 真起一局：走 GameEngine 的完整加载路径（不是空壳 World） */
function boot(birth) {
  const e = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e.boot();
  const bd = (((e.world.data || {}).meta || {}).births || {})[birth] || {};
  /* 起始留一屏：不传 birth，第一屏停在「我是谁」 */
  e.newGame({ name: '试侠', gender: bd.gender || 'male', birth });
  return e;
}
/** 一局干净的新游戏，停在第一屏（不选出身） */
function fresh() {
  const e = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e.boot();
  e.newGame({ name: '试侠', gender: 'male' });
  return e;
}
const stripTags = html => String(html || '').replace(/<[^>]*>/g, '');

/* ================================================================
 *  0. 前置事实：先确认真实的出生房间 / 出身表，再写死断言
 * ================================================================ */
section('0 · 前置事实：出生房间与出身表（写死之前先验证）');
let ROOM = null, META = null, BIRTH_IDS = null;
{
  const w = boot('orphan').world;
  META = w.data.meta;
  ROOM = w.data.rooms[META.startRoom];

  eq('0.1 meta.startRoom 是 road_jiangnan_1', META.startRoom, 'road_jiangnan_1');
  ok('0.2 该房间真实存在', !!ROOM, 'room=' + META.startRoom);
  ok('0.3 出生房间 desc 里确有「老槐树」', !!ROOM && ROOM.desc.indexOf('老槐树') >= 0, ROOM && ROOM.desc);
  ok('0.4 出生房间 desc 里确有卖茶的小摊', !!ROOM && /卖茶|茶摊/.test(ROOM.desc), ROOM && ROOM.desc);

  BIRTH_IDS = Object.keys(META.births || {});
  ok('0.5 出身表含原 6 个 id，且已扩到 ≥12',
    ['scholar', 'hunter', 'merchant', 'orphan', 'wuxue', 'noble'].every(id => BIRTH_IDS.includes(id))
    && BIRTH_IDS.length >= 12, BIRTH_IDS.join(','));
}

/* ================================================================
 *  ① 三轮状态机：birth → gender → close → done
 * ================================================================ */
section('① 三轮状态机（真实路径 GameEngine → view().opening）');
{
  const e = fresh();
  const v0 = e.view().opening;
  ok('① 开局停在第一屏', v0 && v0.show === true, 'step=' + (v0 && v0.step));
  eq('① 第一屏 step=birth', v0.step, 'birth');
  ok('① 第一屏带出身选项（来自 meta.births；有性别门槛，只列本人可选的）',
    (v0.options || []).length >= 6 && (v0.options || []).length <= BIRTH_IDS.length,
    'opts=' + (v0.options || []).length + ' births=' + BIRTH_IDS.length);
  ok('① 第一屏提示是「我是谁」这一类',
    /是谁|身份|出身|名字/.test(String(v0.hint || '')), v0.hint);

  /* 选一个出身 */
  e.exec('开场 hunter');
  eq('① 选完出身 → p.birth 落盘', e.world.player.birth, 'hunter');
  const v1 = e.view().opening;
  eq('① 第二屏 step=gender', v1.step, 'gender');
  ok('① 第二屏给男女两选', (v1.options || []).length >= 2,
    (v1.options || []).map(o => o.label).join('/'));

  e.exec('开场 female');
  eq('① 选完性别 → p.gender 落盘', e.world.player.gender, 'female');
  const v2 = e.view().opening;
  eq('① 第三屏 step=close', v2.step, 'close');
  ok('① 第三屏是收尾旁白（前世回忆）', String(v2.body || '').length > 60,
    'len=' + String(v2.body || '').length);

  e.exec('开场 go');
  const v3 = e.view().opening;
  /* 演完之后 opening 退化成 {show:false}（没有 step 键）——
     这就是「不再出屏」的形状。进度落在 p.vars._intro 上。 */
  eq('① 收尾之后不再出屏（show=false）', v3.show, false);
  ok('① 演完后 opening 退化成 {show:false}（无 step 键）', v3.step === undefined,
    'step=' + v3.step);

  /* 三屏的状态都落在 p.vars._intro（跨存档能接着演） */
  const st = (e.world.player.vars || {})._intro;
  ok('① 进度落在 p.vars._intro 上（step=done，跨档可续）',
    !!st && st.step === 'done' && st.birth === 'hunter' && st.gender === 'female',
    JSON.stringify(st));
}

/* ================================================================
 *  ② 每一屏都是真数据（出身表 / 性别 / 老汉）
 * ================================================================ */
section('② 每一屏渲染的是真数据，不是硬编码');
{
  /* 出身选项的 key 必须都在 meta.births 里 */
  const e = fresh();
  const opts = e.view().opening.options || [];
  const bad = opts.filter(o => !BIRTH_IDS.includes(o.key));
  ok('② 第一屏每个出身选项都对应真出身', bad.length === 0,
    bad.map(o => o.key).join(',') || opts.length + ' 项');

  /* 换一个出身，第三屏正文应当跟着换（不是十三份同一段） */
  const e2 = fresh(); e2.exec('开场 scholar'); e2.exec('开场 male');
  const b1 = e2.view().opening.body;
  const e3 = fresh(); e3.exec('开场 hunter'); e3.exec('开场 male');
  const b2 = e3.view().opening.body;
  ok('② 不同出身 → 第三屏正文不同（不是同一段换名词）', b1 !== b2,
    'scholar=' + stripTags(b1).slice(0, 20) + ' | hunter=' + stripTags(b2).slice(0, 20));

  /* 老汉这个人真的在出生房里（收尾旁白的引荐人来路） */
  const w = boot('orphan').world;
  const def = w.data.npcs.guide_teaman;
  ok('② 老汉是真实 NPC，且就在出生房', !!def && def.room === 'road_jiangnan_1',
    def ? def.name + '@' + def.room : '(不存在)');
  ok('② 老汉被数据钉住不走开（noWander）', !!(def && def.noWander));
  ok('② 第三屏提了茶摊老汉（引荐信与老汉谈话获取）',
    /老汉|茶摊/.test(stripTags(b2)), stripTags(b2).slice(0, 40));
}

/* ================================================================
 *  ③ 文本禁令（各屏逐一硬钉）
 * ================================================================ */
section('③ 文本禁令（各屏逐一硬钉）');
{
  const CMD_TOKENS = ['look', 'kill', 'attack', 'talk', 'ask', 'save', 'flee', 'defend',
    'accept', 'lian', 'go', 'auto', 'north', 'south'];
  const MODERN = ['系统', '属性', '任务', '菜单', '指令', '界面', '存档', '面板', '按钮', '点击', '手机', '电脑'];

  const problems = [];
  for (const id of BIRTH_IDS) {
    /* 走完三屏，把 three 屏的正文拼起来查 */
    const e = fresh();
    e.exec('开场 ' + id);
    const g = e.view().opening;
    e.exec('开场 female');
    const c = e.view().opening;
    const text = stripTags((g.body || '') + (c.body || ''));
    if (text.length <= 80) problems.push(id + '(正文太短)');
    const cmdHit = CMD_TOKENS.filter(k => text.indexOf(k) >= 0);
    if (cmdHit.length) problems.push(id + '含指令名:' + cmdHit.join('/'));
    const modHit = MODERN.filter(k => text.indexOf(k) >= 0);
    if (modHit.length) problems.push(id + '含现代词:' + modHit.join('/'));
    if (/失忆|想不起/.test(text)) problems.push(id + '含失忆表述');
    if (/铜牌|东厂|囚车/.test(text)) problems.push(id + '含主线剧透道具');
    if (/破庙|风雪/.test(text)) problems.push(id + '含旧舞台');
  }
  ok('③ ★ 各版各屏通过文本禁令（指令名 / 现代词 / 失忆 / 剧透 / 旧舞台）',
    problems.length === 0, problems.slice(0, 6).join('；') || '全清');

  /* 首屏正文不得出现「前世」以外的转生剧透式表述：这里只守「穿越要暗示、不能明说」 */
  const e0 = fresh();
  e0.exec('开场 scholar'); e0.exec('开场 male');
  const cbody = stripTags(e0.view().opening.body);
  ok('③ 收尾屏用「恍惚 / 熟悉」这类暗示，不点破穿越',
    !/穿越|重生|现代|21世纪/.test(cbody), cbody.slice(0, 50));
}

/* ================================================================
 *  ④ 老接口退休：view.intro 恒 {show:false}
 * ================================================================ */
section('④ 老接口退休（view.intro 恒空壳；introFor 仍在）');
{
  const e = fresh();
  const v = e.view().intro;
  eq('④ 新玩家 view.intro.show 恒为 false', v.show, false);
  ok('④ 结构仍是 {show:false}（老代码读它不炸）',
    v && v.show === false);

  ok('④ tutorial.introFor 仍在（老函数没删，只是 view 不再调它）',
    typeof tutorial.introFor === 'function');
  /* 反证：introFor 直接调仍能拿到老静态卡（说明它是「退休」不是「拆掉」） */
  const r = tutorial.introFor({ birth: 'hunter' }, []);
  ok('④ introFor 直接调仍回老静态卡（保留做兼容，不被 view 消费）',
    r && typeof r.show === 'boolean' && typeof r.title === 'string');

  ok('④ 新接口 view.opening 才是真数据源',
    e.view().opening && typeof e.view().opening.step === 'string');
}

/* ================================================================
 *  ⑤ seen_intro 行为不变：看过就不再弹、跨存档留存
 * ================================================================ */
section('⑤ seen_intro 行为不变（不变量守卫）');
{
  const e = boot('scholar');     // boot() 带了 birth → 直接从第二屏起步
  e.markTutorialFlag('seen_intro');
  const v1 = e.view().opening;
  eq('⑤ 看过 → opening.show=false', v1.show, false);

  /* 跨存档留存 */
  const saved = e.save('b9_intro_slot', { _test: true });
  ok('⑤ 存档写入沙盒成功', saved.ok === true, saved.id);
  const e2 = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e2.boot();
  const loaded = e2.loadSave(saved.id);
  ok('⑤ 读档成功', loaded.ok === true, loaded.msg);
  eq('⑤ 跨存档：opening.show 仍为 false（seen_intro 随档走）', e2.view().opening.show, false);
  ok('⑤ 跨存档：tutorialFlags 仍含 seen_intro',
    Array.isArray(e2.world.player.tutorialFlags)
      && e2.world.player.tutorialFlags.indexOf('seen_intro') >= 0,
    JSON.stringify(e2.world.player.tutorialFlags));
  try { fs.unlinkSync(path.join(SAVE_DIR, saved.id + '.json')); } catch (e3) { /* ignore */ }
}

/* ================================================================
 *  ⑥ tutorial.js 导出面不因「教程下线」而缺
 * ================================================================ */
section('⑥ tutorial.js / intro.js 的导出面');
{
  ok('⑥ STEPS 仍存在', Array.isArray(tutorial.STEPS));
  ok('⑥ guideState 仍是函数（保留给老档字段用）', typeof tutorial.guideState === 'function');
  ok('⑥ flagForCommand look → did_look',
    typeof tutorial.flagForCommand === 'function' && tutorial.flagForCommand('look') === 'did_look');
  ok('⑥ ★ 引荐信 / 出身链导出齐全（BIRTH_SECT / targetSectFor / handOutLetter）',
    !!tutorial.BIRTH_SECT
    && typeof tutorial.targetSectFor === 'function'
    && typeof tutorial.handOutLetter === 'function');
  ok('⑥ 每个身份都在 BIRTH_SECT 里有映射',
    BIRTH_IDS.every(id => Array.isArray(tutorial.BIRTH_SECT[id]) && tutorial.BIRTH_SECT[id].length),
    BIRTH_IDS.filter(id => !tutorial.BIRTH_SECT[id]).join(',') || '全通');

  /* 新开场模块的导出 */
  ok('⑥ intro.js 导出 screenFor / sectGlimpse / sectGlimpseHtml',
    typeof introMod.screenFor === 'function'
    && typeof introMod.sectGlimpse === 'function'
    && typeof introMod.sectGlimpseHtml === 'function');
}

/* ================================================================
 *  ⑦ ★ 反「句法模具」守卫：各屏首句两两互异
 * ================================================================ */
section('⑦ ★ 反「同一模具倒多份」守卫');
{
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const firstOf = t => (strip(t).split(/(?<=[。！？])/).filter(x => x.trim())[0] || '').trim();
  const seen = new Map(); const dup = [];
  for (const id of BIRTH_IDS) {
    const e = fresh();
    e.exec('开场 ' + id); e.exec('开场 female');
    const txt = strip(e.view().opening.body);
    const first = firstOf(txt);
    if (!first) { dup.push(id + '(空)'); continue; }
    if (seen.has(first)) dup.push(`${id} 与 ${seen.get(first)} 首句相同`);
    else seen.set(first, id);
  }
  ok('★ 各出身收尾屏的**首句两两互异**（反「同一模具倒 N 次」）',
    dup.length === 0, dup.slice(0, 4).join(' ; ') || '全通');
}

/* ================================================================ */
console.log('\n———————————————————————————————');
console.log(`  开场（角色扮演）回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('———————————————————————————————');
process.exitCode = fail ? 1 : 0;
