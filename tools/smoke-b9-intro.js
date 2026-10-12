/**
 * smoke-b9-intro.js —— 开场（楔子）专项回归 · 静态卡片版
 *
 * 台账：design/12-owner-bug-list.md B9 · 设计 design/17-intro-rewrite.md
 *
 * 🔴 2026-10-12 口径变更（主人钦定）：
 *   「现在的楔子还不如原来的，还不如回滚回去」——
 *   三轮角色扮演（view.opening：① 我是谁 → ② 我是男是女 → ③ 那扇门）**整套回滚**，
 *   回到老版**一张静态楔子卡片**：`view.intro` 按 `p.birth` 挑版，
 *   点一下「踏入江湖」直接进第一章。
 *
 *   附带修掉主人同时报的**重复问**毛病：
 *     建号界面**已经**选过出身与性别 → 楔子**不再问第二遍**。
 *     ⇒ 出身/性别的唯一入口 = 建号那一步；楔子只讲「你是谁、在哪、手里有什么」。
 *
 * 现在锁死的是：
 *   ① 静态卡：view.intro 按出身挑版，正文/标题都对得上数据
 *   ② **不再重复问**：opening 恒 {show:false}；intro 里**没有任何选项/问句**
 *      （老毛病「进游戏还要再选一次出身与性别」的回归守卫）
 *   ③ 文本禁令：各版正文不含指令名 / 现代词 / 失忆 / 剧透 / 旧舞台
 *   ④ seen_intro 行为不变：看过就不再弹、跨存档留存
 *   ⑤ tutorial.js 导出面照旧（引荐信 / 出身链）
 *   ⑥ 反「同一模具倒 N 份」：各版首句两两互异
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真走 GameEngine → view().intro
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

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }
function section(t) { console.log('\n' + t); }

const SEED = 20261010;
/** 真起一局：走 GameEngine 的完整加载路径（不是空壳 World） */
function boot(birth, gender) {
  const e = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e.boot();
  const bd = (((e.world.data || {}).meta || {}).births || {})[birth] || {};
  e.newGame({ name: '试侠', gender: gender || bd.gender || 'male', birth });
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
 *  ① 静态卡：view.intro 按出身挑版
 * ================================================================ */
section('① 静态楔子卡（真实路径 GameEngine → view().intro）');
{
  const e = boot('hunter');
  const v = e.view().intro;
  ok('① 新玩家 view.intro.show 为真（楔子该弹）', v && v.show === true);
  ok('① 楔子带标题（【楔子】xxx）', /楔子/.test(String(v.title || '')), v.title);
  ok('① 楔子有一段像样的正文', stripTags(v.body).length > 80,
    'len=' + stripTags(v.body).length);

  /* 按出身挑版：不同出身 → 不同正文（不是同一段换名词） */
  const a = stripTags(boot('scholar').view().intro.body);
  const b = stripTags(boot('hunter').view().intro.body);
  ok('① 不同出身 → 正文不同（真的按出身挑版）', a !== b,
    'scholar=' + a.slice(0, 16) + ' | hunter=' + b.slice(0, 16));
  ok('① 书香门第那版确用了「书箱」这一物', a.indexOf('书箱') >= 0, a.slice(0, 24));

  /* 正文里认出了玩家建号时选的出身，而不是「你是谁」式反问 */
  ok('① 楔子已知道你是谁（正文不反问出身）', !/你是谁|你叫什么|选一个/.test(a));
}

/* ================================================================
 *  ② ★「不再重复问」——主人亲报毛病的主守卫
 * ================================================================ */
section('② ★ 不再重复问出身与性别（主人亲报：「进游戏还要再选一次」）');
{
  const e = boot('scholar', 'female');
  const v = e.view();

  /* opening 必须退休：恒 {show:false}（没有 step/options 这些「还要选」的形状） */
  eq('② 老接口 opening 恒 {show:false}', v.opening && v.opening.show, false);
  ok('② opening 没有任何选项（不会弹第二遍出身/性别）',
    !v.opening || !Array.isArray(v.opening.options) || v.opening.options.length === 0,
    'options=' + JSON.stringify(v.opening && v.opening.options));

  /* 楔子正文里不得出现「选项按钮」的痕迹（data-intro-key / intro-rp-opt） */
  const raw = JSON.stringify(v.intro || {});
  ok('② 楔子数据里无选按钮痕迹（data-intro-key / intro-rp-opt）',
    raw.indexOf('intro-key') < 0 && raw.indexOf('intro-rp-opt') < 0);

  /* 建号选的性别必须就是最终性别，不再二次覆盖 */
  eq('② 建号选女 → p.gender 就是 female（楔子不改）', e.world.player.gender, 'female');
  eq('② 建号选 scholar → p.birth 就是 scholar（楔子不改）', e.world.player.birth, 'scholar');

  /* 男女性别下，楔子正文都不问性别 */
  const male = stripTags(boot('scholar', 'male').view().intro.body);
  const female = stripTags(boot('scholar', 'female').view().intro.body);
  ok('② 楔子正文不含「你是男是女」这类提问',
    !/你是男是女|男还是女|男女|是男是女/.test(male + female));
}

/* ================================================================
 *  ③ 文本禁令（各版逐一硬钉）
 * ================================================================ */
section('③ 文本禁令（各版逐一硬钉）');
{
  const CMD_TOKENS = ['look', 'kill', 'attack', 'talk', 'ask', 'save', 'flee', 'defend',
    'accept', 'lian', 'auto', 'north', 'south'];
  const MODERN = ['系统', '属性', '菜单', '指令', '界面', '存档', '面板', '按钮', '点击', '手机', '电脑'];

  const problems = [];
  for (const id of BIRTH_IDS) {
    const text = stripTags(boot(id).view().intro.body);
    if (text.length <= 80) problems.push(id + '(正文太短)');
    const cmdHit = CMD_TOKENS.filter(k => text.indexOf(k) >= 0);
    if (cmdHit.length) problems.push(id + '含指令名:' + cmdHit.join('/'));
    const modHit = MODERN.filter(k => text.indexOf(k) >= 0);
    if (modHit.length) problems.push(id + '含现代词:' + modHit.join('/'));
    if (/失忆|想不起/.test(text)) problems.push(id + '含失忆表述');
    if (/铜牌|东厂|囚车/.test(text)) problems.push(id + '含主线剧透道具');
    if (/破庙|风雪/.test(text)) problems.push(id + '含旧舞台');
  }
  ok('③ ★ 各版通过文本禁令（指令名 / 现代词 / 失忆 / 剧透 / 旧舞台）',
    problems.length === 0, problems.slice(0, 6).join('；') || '全清');
}

/* ================================================================
 *  ④ seen_intro 行为不变：看过就不再弹、跨存档留存
 * ================================================================ */
section('④ seen_intro 行为不变（不变量守卫）');
{
  const e = boot('scholar');
  e.markTutorialFlag('seen_intro');
  eq('④ 看过 → view.intro.show=false', e.view().intro.show, false);

  /* 跨存档留存 */
  const saved = e.save('b9_intro_slot', { _test: true });
  ok('④ 存档写入沙盒成功', saved.ok === true, saved.id);
  const e2 = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e2.boot();
  const loaded = e2.loadSave(saved.id);
  ok('④ 读档成功', loaded.ok === true, loaded.msg);
  eq('④ 跨存档：intro.show 仍为 false（seen_intro 随档走）', e2.view().intro.show, false);
  ok('④ 跨存档：tutorialFlags 仍含 seen_intro',
    Array.isArray(e2.world.player.tutorialFlags)
      && e2.world.player.tutorialFlags.indexOf('seen_intro') >= 0,
    JSON.stringify(e2.world.player.tutorialFlags));
  try { fs.unlinkSync(path.join(SAVE_DIR, saved.id + '.json')); } catch (e3) { /* ignore */ }
}

/* ================================================================
 *  ⑤ tutorial.js 导出面不因回滚而缺
 * ================================================================ */
section('⑤ tutorial.js 的导出面');
{
  ok('⑤ STEPS 仍存在', Array.isArray(tutorial.STEPS));
  ok('⑤ guideState 仍是函数（保留给老档字段用）', typeof tutorial.guideState === 'function');
  ok('⑤ flagForCommand look → did_look',
    typeof tutorial.flagForCommand === 'function' && tutorial.flagForCommand('look') === 'did_look');
  ok('⑤ ★ 引荐信 / 出身链导出齐全（BIRTH_SECT / targetSectFor / handOutLetter）',
    !!tutorial.BIRTH_SECT
    && typeof tutorial.targetSectFor === 'function'
    && typeof tutorial.handOutLetter === 'function');
  ok('⑤ 每个身份都在 BIRTH_SECT 里有映射',
    BIRTH_IDS.every(id => Array.isArray(tutorial.BIRTH_SECT[id]) && tutorial.BIRTH_SECT[id].length),
    BIRTH_IDS.filter(id => !tutorial.BIRTH_SECT[id]).join(',') || '全通');
  ok('⑤ introFor 仍能按出身取版（static card 数据源）',
    typeof tutorial.introFor === 'function'
    && tutorial.introFor({ birth: 'hunter' }, []).show === true);
  ok('⑤ ★ 已删的三轮模块 intro.js 不该再存在（回滚到底）',
    !fs.existsSync(path.join(ROOT, 'game', 'src', 'core', 'intro.js')));
}

/* ================================================================
 *  ⑥ ★ 反「句法模具」守卫：各版首句两两互异
 * ================================================================ */
section('⑥ ★ 反「同一模具倒多份」守卫');
{
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const firstOf = t => (strip(t).split(/(?<=[。！？])/).filter(x => x.trim())[0] || '').trim();
  const seen = new Map(); const dup = [];
  for (const id of BIRTH_IDS) {
    const first = firstOf(boot(id).view().intro.body);
    if (!first) { dup.push(id + '(空)'); continue; }
    if (seen.has(first)) dup.push(`${id} 与 ${seen.get(first)} 首句相同`);
    else seen.set(first, id);
  }
  ok('★ 各出身楔子的**首句两两互异**（反「同一模具倒 N 次」）',
    dup.length === 0, dup.slice(0, 4).join(' ; ') || '全通');
}

/* ================================================================ */
console.log('\n———————————————————————————————');
console.log(`  开场（静态楔子卡）回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('———————————————————————————————');
process.exitCode = fail ? 1 : 0;
