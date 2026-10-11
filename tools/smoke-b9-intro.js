/**
 * smoke-b9-intro.js —— 楔子（开场剧情）专项回归
 *
 * 台账：design/12-owner-bug-list.md B9 · 设计 design/17-intro-rewrite.md
 * 落点：game/src/core/tutorial.js · introFor()
 *
 * 历史沿革（读代码的人先看这一段）：
 *   · 第一版：4 版共用（6 个身份归 4 版）——「寒门草莽 / 武家官家 / 书香 / 商贾」。
 *   · 第五轮重做：身份扩到 13 个，**一身份一版**（主人要「每个身份的新手教程
 *     引导都是不同势力方向」，四版共用的写法讲不出十三种去处）。
 *     同时补上结尾的「交接」：楔子讲完必须把玩家交给茶摊老汉（旧版讲到一半就断了，
 *     主人问「玩家进入游戏触发的剧情没有后续吗」就是问这个）。
 *
 * 现在锁死的是（都是特意改掉的东西，防人改回去）：
 *   ① 取版矩阵：**每个身份一版、13 版两两互异**；缺失 / 未知身份一律回落 orphan 版，且无随机数
 *   ② 文本禁令：13 版都不含「指令名」与「系统/属性/任务」等现代词，
 *      不含「失忆」表述与「铜牌 / 东厂 / 囚车」主线剧透道具，也不提旧舞台「破庙 / 风雪」
 *   ③ 舞台一致：楔子地名与**真实出生房间** `road_jiangnan_1` 的 desc 同源（江南大路 / 老槐树 / 茶摊）
 *   ④ 结构：每版 5 段 intro-p，**末段（交接）是唯一的 intro-em 强调段**
 *   ⑤ seen_intro 行为不变：看过就不再弹、跨存档留存
 *   ⑥ 玩家自己不会「死」在楔子里（昏倒语义）
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真走 GameEngine → view().intro，并另直接调 introFor() 复核
 *   · `new World()` 是空壳（dataDirs 没设），必须走 GameEngine.boot()
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
function boot(birth) {
  const e = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e.boot();
  /* ⚠️ **按身份自己的性别开局**，别写死 male ——
     2026-10-10 起「与性别强绑定的身份」带 gender 门槛（庵堂孤儿/守墓人之后只收女、
     山门弃婴只收男），`World.createPlayer` 会**硬校验**并抛错。
     写死 male 再传女身身份 = 在测一个**不合法的组合**，根本跑不出结果（本测试曾因此整块崩）。
     从数据读 gender，既跟着数据走，也不会因为以后新增性别门槛而再红。 */
  const bd = (((e.world.data || {}).meta || {}).births || {})[birth] || {};
  e.newGame({ name: '试侠', gender: bd.gender || 'male', birth });
  return e;
}
/** 直接调 introFor：验证「函数本身」的取版逻辑（数组 flags） */
const intro = (birth, flags) => tutorial.introFor({ birth }, flags || []);
/** 去掉 HTML 标签，只留纯文本正文 */
const stripTags = html => String(html || '').replace(/<[^>]*>/g, '');

/* ================================================================
 *  0. 前置事实：先确认真实的出生房间 / 出身表，再写死断言（别猜）
 * ================================================================ */
section('0 · 前置事实：出生房间与出身表（写死之前先验证）');
let ROOM = null, META = null, BIRTH_IDS = null;
{
  const w = boot('orphan').world;
  META = w.data.meta;
  ROOM = w.data.rooms[META.startRoom];

  eq('0.1 meta.startRoom 是 road_jiangnan_1', META.startRoom, 'road_jiangnan_1');
  ok('0.2 该房间真实存在', !!ROOM, 'room=' + META.startRoom);
  ok('0.3 出生房间 desc 里确有「老槐树」（楔子舞台的依据）',
    !!ROOM && ROOM.desc.indexOf('老槐树') >= 0, ROOM && ROOM.desc);
  ok('0.4 出生房间 desc 里确有卖茶的小摊（茶摊的依据）',
    !!ROOM && /卖茶|茶摊/.test(ROOM.desc), ROOM && ROOM.desc);

  BIRTH_IDS = Object.keys(META.births || {});
  ok('0.5 出身表含原 6 个 id，且已扩到 ≥12（第五轮加身份，让每家势力都有一个方向）',
    ['scholar', 'hunter', 'merchant', 'orphan', 'wuxue', 'noble'].every(id => BIRTH_IDS.includes(id))
    && BIRTH_IDS.length >= 12, BIRTH_IDS.join(','));
}

/* ================================================================
 *  ① 取版矩阵：一身份一版；缺失/未知 → orphan 版
 * ================================================================ */
section('① 取版矩阵：每个身份一版（真实路径 GameEngine → view().intro）');
{
  /* 口径变更（主人 2026-10-11）：「mod 出身或不选出身的中立剧情」——
   没出身 / 出身 id 不在官方表里（mod 自带）的人，走**中立楔子**，
   不再回落成「孤儿出身」那一版（那等于把中立这条路吞了）。 */
  const FALLBACK = '【楔子】没有名字的那一个';   // 中立版，也是回落版

  /* A. 真实引擎路径：逐个身份起局，读 view().intro */
  const titles = {};
  const roundTrip = [];
  for (const id of BIRTH_IDS) {
    const e = boot(id);
    const v = e.view().intro;
    titles[id] = v.title;
    if (e.world.player.birth !== id) roundTrip.push(id);
    if (!v.show || !v.title || !v.body) roundTrip.push(id + '(空)');
  }
  ok('① 每个身份起局都能读到非空楔子，且 player.birth 正确落盘',
    roundTrip.length === 0, roundTrip.join(',') || BIRTH_IDS.length + ' 版');

  /* B. 直接调 introFor（不看引擎，单看函数取版） */
  const mismatch = BIRTH_IDS.filter(id => intro(id).title !== titles[id]);
  ok('① 直接调 introFor 与真实路径取到同一版', mismatch.length === 0, mismatch.join(','));

  /* C. 一身份一版：标题与正文都两两互异 */
  eq('① ★ 13 个身份的楔子标题两两互异（不再四版共用）',
    new Set(Object.values(titles)).size, BIRTH_IDS.length);
  eq('① ★ 13 版 body 两两互异',
    new Set(BIRTH_IDS.map(id => intro(id).body)).size, BIRTH_IDS.length);

  /* D. 缺失 / 未知 / 不传 → 回落 orphan 版 */
  eq('① birth 缺失(undefined) → 中立版', intro(undefined).title, FALLBACK);
  eq('① birth 缺失(null) → 中立版', intro(null).title, FALLBACK);
  eq('① birth 未知值("nonsense") → 中立版', intro('nonsense').title, FALLBACK);
  eq('① 未知 birth 走真实引擎 → 中立版', boot('nonsense').view().intro.title, FALLBACK, 'boot("nonsense")');
  eq('① 不传 birth 走真实引擎 → 中立版', boot(undefined).view().intro.title, FALLBACK);

  /* E. 每个身份的楔子都要有「往哪去」的方向感（不是十三份同一个模板换名词） */
  const noDir = [];
  for (const id of BIRTH_IDS) {
    if (!tutorial.BIRTH_SECT[id]) { noDir.push(id + '(无势力映射)'); continue; }
    const body = intro(id).body;
    if (!/往北|北边|山门|门派|去处|路/.test(body)) noDir.push(id + '(没写方向)');
  }
  ok('① 每版楔子都写了「往哪去」的方向感',
    noDir.length === 0, noDir.join(',') || '全通');
}

/* ================================================================
 *  ② 文本禁令（13 版逐一硬钉）
 * ================================================================ */
section('② 文本禁令（13 版逐一硬钉）');
{
  /* 指令名（玩家敲的命令，绝不能写进旁白） */
  const CMD_TOKENS = ['look', 'kill', 'attack', 'talk', 'ask', 'save', 'flee', 'defend',
    'accept', 'lian', 'go', 'auto', 'north', 'south'];
  /* 现代词 / 说明书腔 + 电子设备词 */
  const MODERN = ['系统', '属性', '任务', '菜单', '指令', '界面', '存档', '面板', '按钮', '点击', '手机', '电脑'];

  const problems = [];
  for (const id of BIRTH_IDS) {
    const v = intro(id);
    const text = stripTags(v.body);
    if (text.length <= 120) problems.push(id + '(正文太短)');
    if (/[A-Za-z0-9]/.test(text)) problems.push(id + '含 ASCII:' + (text.match(/[A-Za-z0-9]+/) || [''])[0]);
    const cmdHit = CMD_TOKENS.filter(k => text.indexOf(k) >= 0);
    if (cmdHit.length) problems.push(id + '含指令名:' + cmdHit.join('/'));
    const modHit = MODERN.filter(k => text.indexOf(k) >= 0);
    if (modHit.length) problems.push(id + '含现代词:' + modHit.join('/'));
    if (/失忆|想不起|记不起/.test(text)) problems.push(id + '含失忆表述');
    if (/铜牌|东厂|囚车/.test(text)) problems.push(id + '含主线剧透道具');
    if (/破庙|风雪/.test(text)) problems.push(id + '含旧舞台');
    /* 玩家自己不会「死」（昏倒语义；数据别处的「死」是正常中文，这里只管玩家自身） */
    if (/你[^。！？]{0,12}死|死[^。！？]{0,8}你/.test(text)) problems.push(id + '说玩家自己死了');
  }
  ok('② ★ 13 版全部通过文本禁令（指令名 / 现代词 / 失忆 / 剧透 / 旧舞台 / 玩家之死）',
    problems.length === 0, problems.slice(0, 6).join('；') || '全清');

  /* HTML 结构：5 段 intro-p，且**只有末段**是 intro-em（交接段） */
  const struct = [];
  for (const id of BIRTH_IDS) {
    const body = intro(id).body;
    const n = (body.match(/class="intro-p/g) || []).length;
    const em = (body.match(/class="intro-p intro-em"/g) || []).length;
    if (n !== 5) struct.push(id + '(段数 ' + n + ')');
    else if (em !== 1) struct.push(id + '(intro-em ' + em + ')');
    /* 「楼里新来的」的强调段是苗春那句话，不是茶摊交接段（她人就在楼里）——
       结构（5 段 / 末段唯一强调）照守，只不要求强调段必须是交接段。 */
    else if (id !== 'brothel_sold' && !/class="intro-p intro-em"[^>]*>[\s\S]*卖茶的小摊/.test(body)) struct.push(id + '(强调段不是交接段)');
  }
  ok('② ★ 每版 5 段 intro-p，末段为唯一的 intro-em 强调段（＝交接段；楼里新来的用自己的强调段）',
    struct.length === 0, struct.join(',') || '全通');
}

/* ================================================================
 *  ③ 舞台一致：楔子地名与真实出生房间 desc 同源
 * ================================================================ */
section('③ 舞台一致：文本 = 真实出生房间（road_jiangnan_1）');
{
  const bad = [];
  for (const id of BIRTH_IDS) {
    /* ⚠️ 「楼里新来的」（主人 2026-10-11 加的女身）**不在江南大路开局** ——
       她人就在醉春楼，楔子讲的是楼里的事。强求她也站在老槐树底下，
       等于把「出身各不同」这件事改回「出身都一个样」。 */
    if (id === 'brothel_sold') continue;
    const text = stripTags(intro(id).body);
    if (text.indexOf('江南大路') < 0) bad.push(id + '(无江南大路)');
    if (text.indexOf('老槐树') < 0) bad.push(id + '(无老槐树)');
    if (!/茶摊|卖茶/.test(text)) bad.push(id + '(无茶摊)');
  }
  ok('③ ★ 各版舞台都是「江南大路 · 老槐树 · 茶摊」（与出生房间同源；楼里新来的除外）',
    bad.length === 0, bad.join(',') || '全通');
  const roomText = String(ROOM.desc || '');
  ok('③ 真实房间 desc 也含「老槐树」（同源而非文本自造）', roomText.indexOf('老槐树') >= 0, roomText);
  ok('③ 真实房间 desc 也含卖茶小摊', /卖茶|茶摊/.test(roomText), roomText);
}

/* ================================================================
 *  ④ 交接：楔子讲完必须把玩家交给茶摊老汉（第五轮补的接口）
 * ================================================================ */
section('④ 握手：楔子结尾交给茶摊老汉（旧版讲完就断了）');
{
  const bad = [];
  for (const id of BIRTH_IDS) {
    /* 「楼里新来的」不接茶摊那段收束（`introFor` 里 handoff:false）——
       她人就在楼里，老汉那碗茶轮不到她喝。 */
    if (id === 'brothel_sold') continue;
    const text = stripTags(intro(id).body);
    if (!/卖茶的小摊/.test(text) || !/老汉/.test(text)) bad.push(id + '(没有老汉)');
    else if (!/坐下/.test(text)) bad.push(id + '(老汉没开口)');
  }
  ok('④ ★ 各版结尾都把玩家递给茶摊老汉，并让他开口（楼里新来的除外）',
    bad.length === 0, bad.join(',') || '全通');

  /* 老汉这个人真的在出生房里（不是旁白里编的） */
  const w = boot('orphan').world;
  const def = w.data.npcs.guide_teaman;
  ok('④ ★ 老汉是真实 NPC，且就在出生房', !!def && def.room === 'road_jiangnan_1',
    def ? def.name + '@' + def.room : '(不存在)');
  ok('④ 老汉被数据钉住不走开（noWander）—— 不然他一走，玩家就找不着引荐人了',
    !!(def && def.noWander));
}

/* ================================================================
 *  ⑤ seen_intro 行为不变：看过就不再弹、跨存档留存
 * ================================================================ */
section('⑤ seen_intro 行为不变（不变量守卫）');
{
  const e = boot('scholar');
  const v0 = e.view().intro;
  ok('⑤ 新玩家 intro.show=true', v0.show === true);
  eq('⑤ 新玩家 intro.title = 该身份那版标题', v0.title, intro('scholar').title);
  ok('⑤ 新玩家 intro.body 非空', typeof v0.body === 'string' && v0.body.length > 100);

  e.markTutorialFlag('seen_intro');
  const v1 = e.view().intro;
  eq('⑤ 看过 → show=false', v1.show, false);
  eq('⑤ 看过 → title 空串', v1.title, '');
  eq('⑤ 看过 → body 空串', v1.body, '');
  ok('⑤ 返回值结构恒为 {show,title,body} 三键',
    ['show', 'title', 'body'].every(k => k in v1) && Object.keys(v1).length === 3,
    Object.keys(v1).join(','));

  /* 跨存档留存 */
  const saved = e.save('b9_intro_slot', { _test: true });
  ok('⑤ 存档写入沙盒成功', saved.ok === true, saved.id);
  const e2 = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e2.boot();
  const loaded = e2.loadSave(saved.id);
  ok('⑤ 读档成功', loaded.ok === true, loaded.msg);
  eq('⑤ 跨存档：intro.show 仍为 false（seen_intro 随档走）', e2.view().intro.show, false);
  ok('⑤ 跨存档：tutorialFlags 仍含 seen_intro',
    Array.isArray(e2.world.player.tutorialFlags)
      && e2.world.player.tutorialFlags.indexOf('seen_intro') >= 0,
    JSON.stringify(e2.world.player.tutorialFlags));
  try { fs.unlinkSync(path.join(SAVE_DIR, saved.id + '.json')); } catch (e3) { /* ignore */ }
}

/* ================================================================
 *  ⑥ 同文件其它导出不受影响（第五轮新增的导出也要在）
 * ================================================================ */
section('⑥ tutorial.js 的导出面');
{
  ok('⑥ STEPS 仍存在且含 look 步', Array.isArray(tutorial.STEPS) && tutorial.STEPS.some(s => s.id === 'look'));
  ok('⑥ guideState 仍是函数', typeof tutorial.guideState === 'function');
  ok('⑥ flagForCommand 仍是函数且 look → did_look',
    typeof tutorial.flagForCommand === 'function' && tutorial.flagForCommand('look') === 'did_look');
  ok('⑥ ★ 第五轮新增导出齐全（BIRTH_SECT / SECT_GATE / INTRO_VARIANTS / targetSectFor / tutorialQuestOf / handOutLetter）',
    !!tutorial.BIRTH_SECT && !!tutorial.SECT_GATE && !!tutorial.INTRO_VARIANTS
    && typeof tutorial.targetSectFor === 'function'
    && typeof tutorial.tutorialQuestOf === 'function'
    && typeof tutorial.handOutLetter === 'function');
  ok('⑥ 每个身份都在 BIRTH_SECT 里有映射（漏一个，那条新手线就断了）',
    BIRTH_IDS.every(id => Array.isArray(tutorial.BIRTH_SECT[id]) && tutorial.BIRTH_SECT[id].length),
    BIRTH_IDS.filter(id => !tutorial.BIRTH_SECT[id]).join(',') || '全通');
}

/* ================================================================
 * ⑦ ★ 反「句法模具」守卫（2026-10-10 新增，补 ai-flavor-check 的盲区）
 *
 * 为什么单开一条：`tools/ai-flavor-check.js` **抓词不抓句法** —— 它在
 * 「13 版楔子 13/13 都以『江南大路的日头…』开头、11/13 中段收尾逐字相同」
 * 的时候**照样 0 命中**（主人报「楔子 AI 味太重」时，脚本是绿的）。
 * 句法同构是最典型的 AI 味，却只有靠人眼/靠这条守卫才抓得住：
 *   ⇒ 断言 **13 版的首句两两互异**（去 HTML、去空白后比较）。
 * 日后谁再把楔子写成同一个模具倒出来的，这条会立刻红。
 * ================================================================ */
{
  const strip = s => String(s || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const seen = new Map();
  const dup = [];
  for (const id of BIRTH_IDS) {
    const r = tutorial.introFor({ birth: id }, []);
    const txt = strip(r && r.body);
    const first = (txt.split(/(?<=[。！？])/).filter(x => x.trim())[0] || '').trim();
    if (!first) { dup.push(id + '(空)'); continue; }
    if (seen.has(first)) dup.push(`${id} 与 ${seen.get(first)} 首句相同`);
    else seen.set(first, id);
  }
  ok('★ 13 版楔子的**首句两两互异**（反「同一模具倒 13 次」；ai-flavor-check 抓不到句法模具）',
    dup.length === 0, dup.slice(0, 4).join(' ; '));

  /* 顺带：每版正文至少 3 段（短到一段就不成戏了），且都不是纯机制说明 */
  const tooShort = [];
  for (const id of BIRTH_IDS) {
    const r = tutorial.introFor({ birth: id }, []);
    const paras = String(r && r.body || '').match(/<p[ >]/g) || [];
    if (paras.length < 3) tooShort.push(id + ':' + paras.length);
  }
  ok('  每版楔子正文 ≥3 段', tooShort.length === 0, tooShort.join(','));
}

/* ================================================================ */
console.log('\n———————————————————————————————');
console.log(`  楔子回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('———————————————————————————————');
process.exitCode = fail ? 1 : 0;
