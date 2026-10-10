/**
 * smoke-b9-intro.js —— B9「初始引导剧情重写（楔子）」专项回归
 *
 * 台账：design/12-owner-bug-list.md B9
 * 设计：design/17-intro-rewrite.md（4 版全文 + §5.2 落地实现）
 * 落点：game/src/core/tutorial.js · introFor()（+ BIRTH_TO_INTRO / INTRO_VARIANTS）
 *
 * 锁死（都是这次特意改掉的东西，防止将来有人改回去）：
 *   ① 取版矩阵：6 个 birth → 4 版；缺失 / 未知 birth 一律回落 V1（寒门草莽），且**无随机数**
 *   ② 文本禁令：4 版都不含「指令名」、不含「系统/属性/任务」等现代词，
 *      更不含「失忆」表述与「铜牌 / 东厂」主线剧透道具
 *   ③ 舞台一致：楔子里的地名与**真实出生房间** `road_jiangnan_1` 的 desc 同源（老槐树 / 茶摊）
 *   ④ seen_intro 行为不变：看过就不再弹、跨存档留存
 *
 * 铁律遵守：
 *   · 随机源固定 seed（new GameEngine({seed}).boot().newGame()）
 *   · 断言打在**真实调用路径**上：真走 GameEngine → view().intro（内部即 tutorial.introFor），
 *     并另直接调 introFor() 做单点复核
 *   · `new World()` 是空壳（dataDirs 没设），必须走 GameEngine.boot()
 *   · 存档走独立沙盒（tools/_test-save-dir.js），不碰玩家 saves/
 *   · 不改 game/data/*.json（取的是已有字段 birth / meta.startRoom）
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
  e.newGame({ name: '试侠', gender: 'male', birth });
  return e;
}
/** 直接调 introFor：验证「函数本身」的取版逻辑（第二人称、数组 flags） */
const intro = (birth, flags) => tutorial.introFor({ birth }, flags || []);
/** 去掉 HTML 标签，只留纯文本正文（用于内容类断言，避免把 class="intro-p" 当正文） */
const stripTags = html => String(html || '').replace(/<[^>]*>/g, '');

/* ================================================================
 *  0. 前置事实：先确认真实的出生房间 / 出身表，再写死断言（别猜）
 * ================================================================ */
section('0 · 前置事实：出生房间与出身表（写死之前先验证）');
let ROOM = null, META = null, BIRTH_IDS = null;
{
  const e = boot('orphan'); const w = e.world;
  META = w.data.meta;
  ROOM = w.data.rooms[META.startRoom];

  eq('0.1 meta.startRoom 是 road_jiangnan_1', META.startRoom, 'road_jiangnan_1');
  ok('0.2 该房间真实存在', !!ROOM, 'room=' + META.startRoom);
  ok('0.3 出生房间 desc 里确有「老槐树」（楔子舞台的依据）',
    !!ROOM && ROOM.desc.indexOf('老槐树') >= 0, ROOM && ROOM.desc);
  ok('0.4 出生房间 desc 里确有卖茶的小摊（茶摊的依据）',
    !!ROOM && /卖茶|茶摊/.test(ROOM.desc), ROOM && ROOM.desc);

  BIRTH_IDS = Object.keys(META.births || {});
  ok('0.5 出身表恰为 6 个 id（scholar/hunter/merchant/orphan/wuxue/noble）',
    ['scholar', 'hunter', 'merchant', 'orphan', 'wuxue', 'noble'].every(id => BIRTH_IDS.includes(id))
    && BIRTH_IDS.length === 6, BIRTH_IDS.join(','));
}

/* ================================================================
 *  ① 取版矩阵：6 birth → 4 版；缺失/未知 → V1
 * ================================================================ */
section('① 取版矩阵：按 player.birth 分版（真实路径 GameEngine → view().intro）');
{
  const T1 = '【楔子】一双破草鞋';   // V1 寒门草莽
  const T2 = '【楔子】一柄空剑鞘';   // V2 武家官家
  const T3 = '【楔子】一口旧书箱';   // V3 书香门第
  const T4 = '【楔子】一袋碎银';     // V4 商贾之后

  /* 6 个 id 的期望归属 */
  const EXPECT = {
    orphan: T1, hunter: T1,     // 寒门草莽
    wuxue: T2, noble: T2,       // 武家官家
    scholar: T3,                // 书香门第
    merchant: T4,               // 商贾之后
  };

  /* A. 真实引擎路径：逐个 birth 起局，读 view().intro.title */
  for (const id of Object.keys(EXPECT)) {
    const e = boot(id);
    eq(`① ${id} → ${EXPECT[id]}`, e.view().intro.title, EXPECT[id]);
    ok(`① ${id} 起局后 player.birth 正确落盘`, e.world.player.birth === id,
      'p.birth=' + e.world.player.birth);
  }

  /* B. 直接调 introFor（不看引擎，单看函数取版） */
  for (const id of Object.keys(EXPECT)) {
    eq(`① introFor(${id}) 直接调 = ${EXPECT[id]}`, intro(id).title, EXPECT[id]);
  }

  /* C. 缺失 / 未知 birth → 回落 V1 */
  eq('① birth 缺失(undefined) → V1', intro(undefined).title, T1);
  eq('① birth 缺失(null) → V1', intro(null).title, T1);
  eq('① birth 未知值("nonsense") → V1', intro('nonsense').title, T1);
  eq('① 未知 birth 走真实引擎 → V1', boot('nonsense').view().intro.title, T1,
    'boot("nonsense")');
  eq('① 不传 birth 走真实引擎 → V1', boot(undefined).view().intro.title, T1);

  /* D. 4 版文本互异（否则「分版」名不副实） */
  const bodies = new Set([T1, T2, T3, T4].map(t => {
    const id = { [T1]: 'orphan', [T2]: 'wuxue', [T3]: 'scholar', [T4]: 'merchant' }[t];
    return intro(id).body;
  }));
  eq('① 4 版 body 两两互异', bodies.size, 4);

  /* E. 同名版本共享同一 body（orphan 与 hunter 应完全一致） */
  eq('① orphan 与 hunter 共用同一版 body', intro('orphan').body, intro('hunter').body);
  eq('① wuxue 与 noble 共用同一版 body', intro('wuxue').body, intro('noble').body);
}

/* ================================================================
 *  ② 文本禁令：无指令名 / 无现代词 / 无失忆 / 无铜牌剧透
 * ================================================================ */
section('② 文本禁令（4 版逐一硬钉）');
{
  const V1 = intro('orphan'), V2 = intro('wuxue'), V3 = intro('scholar'), V4 = intro('merchant');
  const CASES = [['V1 寒门草莽', V1], ['V2 武家官家', V2], ['V3 书香门第', V3], ['V4 商贾之后', V4]];

  /* 指令名（玩家敲的命令，绝不能写进旁白） */
  const CMD_TOKENS = ['look', 'kill', 'attack', 'talk', 'ask', 'save', 'flee', 'defend',
    'accept', 'lian', 'go', 'auto', 'north', 'south'];
  /* 现代词 / 说明书腔（主人说的「AI 感」重灾区）+ 电子设备词 */
  const MODERN = ['系统', '属性', '任务', '菜单', '指令', '界面', '存档', '面板', '按钮', '点击', '手机', '电脑'];

  for (const [tag, v] of CASES) {
    const text = stripTags(v.body);
    /* 非平凡：正文必须够长，否则下面的「不含…」是空集恒真 */
    ok(`② ${tag} 正文非平凡（去标签后 > 120 字）`, text.length > 120, 'len=' + text.length);
    /* HTML 结构：5 段 intro-p（末段为 intro-p intro-em，故用带前缀匹配） */
    ok(`② ${tag} 有 5 段 intro-p（末段含 intro-em）`,
      (v.body.match(/class="intro-p/g) || []).length === 5,
      'count=' + (v.body.match(/class="intro-p/g) || []).length);
    ok(`② ${tag} 末段是独立的 intro-em 引导段`,
      (v.body.match(/class="intro-p intro-em"/g) || []).length === 1);

    /* 去标签后不含任何 ASCII 字母（中文旁白里出现英文命令名是典型破功） */
    ok(`② ${tag} 正文不含 ASCII 字母/数字`, !/[A-Za-z0-9]/.test(text),
      (text.match(/[A-Za-z0-9]+/) || [''])[0]);

    /* 逐条点名禁令 */
    const cmdHit = CMD_TOKENS.filter(k => text.indexOf(k) >= 0);
    ok(`② ${tag} 不含指令名`, cmdHit.length === 0, cmdHit.join(','));
    const modHit = MODERN.filter(k => text.indexOf(k) >= 0);
    ok(`② ${tag} 不含现代词/说明书腔`, modHit.length === 0, modHit.join(','));
    ok(`② ${tag} 不含「失忆」相关表述（失忆/想不起/记不起）`,
      !/失忆|想不起|记不起/.test(text));
    ok(`② ${tag} 不含主线剧透道具「铜牌 / 东厂 / 囚车」`,
      !/铜牌|东厂|囚车/.test(text));
    ok(`② ${tag} 已删除旧舞台「破庙 / 风雪」`, !/破庙|风雪/.test(text));
  }
}

/* ================================================================
 *  ③ 舞台一致：楔子地名与真实出生房间 desc 同源
 * ================================================================ */
section('③ 舞台一致：文本 = 真实出生房间（road_jiangnan_1）');
{
  const CASES = [intro('orphan'), intro('wuxue'), intro('scholar'), intro('merchant')];
  CASES.forEach((v, i) => {
    const text = stripTags(v.body);
    ok(`③ 版本#${i + 1} 舞台在「江南大路」`, text.indexOf('江南大路') >= 0);
    ok(`③ 版本#${i + 1} 舞台有「老槐树」（与房间 desc 同源）`, text.indexOf('老槐树') >= 0);
    ok(`③ 版本#${i + 1} 舞台有茶摊 / 卖茶（与房间 desc 同源）`, /茶摊|卖茶/.test(text));
  });
  /* 反向：文本里出现的地名，真实房间 desc 里必须也真的有（不是只在文本里编） */
  const roomText = String(ROOM.desc || '');
  ok('③ 真实房间 desc 也含「老槐树」（同源而非文本自造）', roomText.indexOf('老槐树') >= 0, roomText);
  ok('③ 真实房间 desc 也含卖茶小摊', /卖茶|茶摊/.test(roomText), roomText);
}

/* ================================================================
 *  ④ seen_intro 行为不变：看过就不再弹、跨存档留存
 * ================================================================ */
section('④ seen_intro 行为不变（不变量守卫）');
{
  /* 新玩家：show=true，且带标题与正文 */
  const e = boot('scholar');
  const v0 = e.view().intro;
  ok('④ 新玩家 intro.show=true', v0.show === true);
  eq('④ 新玩家 intro.title = 版本标题', v0.title, '【楔子】一口旧书箱');
  ok('④ 新玩家 intro.body 非空', typeof v0.body === 'string' && v0.body.length > 100);

  /* 看过：show=false，且 title/body 清空（返回值结构不变） */
  e.markTutorialFlag('seen_intro');
  const v1 = e.view().intro;
  eq('④ 看过 → show=false', v1.show, false);
  eq('④ 看过 → title 空串', v1.title, '');
  eq('④ 看过 → body 空串', v1.body, '');
  ok('④ 返回值结构恒为 {show,title,body} 三键',
    ['show', 'title', 'body'].every(k => k in v1) && Object.keys(v1).length === 3,
    Object.keys(v1).join(','));

  /* 跨存档留存：存档 → 新引擎读回，seen_intro 仍在、intro 不再弹 */
  const saved = e.save('b9_intro_slot', { _test: true });
  ok('④ 存档写入沙盒成功', saved.ok === true, saved.id);
  const e2 = new GameEngine({ seed: SEED, saveDir: SAVE_DIR });
  e2.boot();
  const loaded = e2.loadSave(saved.id);
  ok('④ 读档成功', loaded.ok === true, loaded.msg);
  const v2 = e2.view().intro;
  eq('④ 跨存档：intro.show 仍为 false（seen_intro 随档走）', v2.show, false);
  ok('④ 跨存档：tutorialFlags 仍含 seen_intro',
    Array.isArray(e2.world.player.tutorialFlags)
      && e2.world.player.tutorialFlags.indexOf('seen_intro') >= 0,
    JSON.stringify(e2.world.player.tutorialFlags));

  /* 收尾：清掉本次测试档，不留垃圾 */
  try { fs.unlinkSync(path.join(SAVE_DIR, saved.id + '.json')); } catch (e) { /* ignore */ }
}

/* ================================================================
 *  ⑤ introFor 未破坏同文件其它导出（STEPS / guideState / flagForCommand）
 * ================================================================ */
section('⑤ 本次只改 introFor，同文件其它导出不受影响');
{
  ok('⑤ STEPS 仍存在且含 look 步', Array.isArray(tutorial.STEPS) && tutorial.STEPS.some(s => s.id === 'look'));
  ok('⑤ guideState 仍是函数', typeof tutorial.guideState === 'function');
  ok('⑤ flagForCommand 仍是函数且 look → did_look',
    typeof tutorial.flagForCommand === 'function' && tutorial.flagForCommand('look') === 'did_look');
  ok('⑤ module.exports 未新增楔子内部表（BIRTH_TO_INTRO 保持内部实现）',
    tutorial.BIRTH_TO_INTRO === undefined && tutorial.INTRO_VARIANTS === undefined);
}

/* ================================================================
 *  ⑥ B16 · 4 版末段收束差异化（不再同构）+ 两条现代口语/孤立短句修正
 * ================================================================ */
section('⑥ B16 · 4 版结尾差异化（防退回同构）');
{
  const v1 = intro('orphan'), v2 = intro('wuxue'), v3 = intro('scholar'), v4 = intro('merchant');
  const emOf = v => (v.body.match(/<p class="intro-p intro-em">([\s\S]*?)<\/p>/) || [, ''])[1];
  const e1 = emOf(v1), e2 = emOf(v2), e3 = emOf(v3), e4 = emOf(v4);

  /* 末段两两互异（旧版是同一句法骨架「先〈动作〉…看清…」＝同构） */
  eq('⑥ 4 版末段正文两两互异', new Set([e1, e2, e3, e4]).size, 4);
  ok('⑥ 末段不再出现旧模具「先〈动作〉…」句式',
    ![e1, e2, e3, e4].some(t => /^先[^，]*，/.test(t)),
    [e1, e2, e3, e4].join(' | '));

  /* 4 种收束各自的独特标记（B16 §3.5.2：身体动作／未说完的话／算不通的账／那伙人转述的威胁） */
  ok('⑥ V1 收在身体的一个具体动作（碎石硌着脚心）', e1.indexOf('碎石硌着脚心') >= 0, e1);
  ok('⑥ V2 收在一句未说完的话（后半句咽了回去）', e2.indexOf('后半句咽了回去') >= 0, e2);
  ok('⑥ V3 收在一个算不通的账（名帖却一张没有）', e3.indexOf('名帖却一张没有') >= 0, e3);
  ok('⑥ V4 收在那伙人转述的威胁（别再往南来）', e4.indexOf('别再往南来') >= 0, e4);
  /* V4 末段 r2.1 由「含引号对话」改为「无引号转述」（不在场的人撂下的话） */
  ok('⑥ V4 末段是无引号转述（不再出现「」对话引号）', e4.indexOf('「') < 0 && e4.indexOf('」') < 0, e4);

  /* 一并处理的修正①：V2 现代口语「趴下」→「伏低」 */
  ok('⑥ V2 不再含现代口语「趴下」', v2.body.indexOf('趴下') < 0);
  ok('⑥ V2 改用武侠语域「伏低」', v2.body.indexOf('伏低') >= 0);

  /* 一并处理的修正②：V4 孤立短句「骡子驮着货。」已并入上下文 */
  ok('⑥ V4 不再有孤立短句「骡子驮着货。」', v4.body.indexOf('骡子驮着货。') < 0);
  ok('⑥ V4 骡子句已并入上下文（两箱货 / 垂着耳朵站在道边）',
    v4.body.indexOf('骡子驮着两箱货') >= 0 && v4.body.indexOf('垂着耳朵站在道边') >= 0);
  /* r2.1：删现代口语「乖乖」（改用「垂着耳朵」）；「善茬」也已随 V4p5 重写删除 */
  ok('⑥ V4 不再含 r2 新引入的现代口语「乖乖」', v4.body.indexOf('乖乖') < 0);
  ok('⑥ V4 不再含现代口语「善茬」', v4.body.indexOf('善茬') < 0);
  /* ⚠️ r2.1 有意为之的断句：「命是轻的。」必须是句号（拉低节奏方差），不得改回破折号 */
  ok('⑥ V4 p2 保持「命是轻的。」句号断句（不得改回破折号）',
    v4.body.indexOf('命是轻的。') >= 0 && v4.body.indexOf('命是轻的——') < 0);

  /* V3 第4段只留前一句 —— 防「信上只写着进城寻人」重复出现（叙事策划点名的 trap） */
  ok('⑥ V3 第4段仅「你掏出那封信，纸角已被汗浸软。」一句',
    v3.body.indexOf('<p class="intro-p">你掏出那封信，纸角已被汗浸软。</p>') >= 0);
  ok('⑥ V3 第4段已删去后半句「没写这一路上有多少拦路的」',
    v3.body.indexOf('没写这一路上有多少拦路的') < 0);
  eq('⑥ V3「信上只写着进城寻人」全篇只出现 1 次（防重复 trap）',
    (stripTags(v3.body).match(/信上只写着进城寻人/g) || []).length, 1);

  /* V1 用「入了门派」（r2.1 定稿，命中 wuxia 语域词「门派」），不留旧「拜了师」 */
  ok('⑥ V1 用「入了门派」而非旧「拜了师」',
    v1.body.indexOf('入了门派') >= 0 && v1.body.indexOf('拜了师') < 0);
}

/* ================================================================ */
console.log('\n———————————————————————————————');
console.log(`  B9 楔子回归：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('———————————————————————————————');
process.exitCode = fail ? 1 : 0;
