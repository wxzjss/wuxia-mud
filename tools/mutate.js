/**
 * mutate.js —— 变异测试施加器（批次 2 返工）
 *
 * 为什么要有这个文件：本项目反复踩「变异静默未生效 → 误判断言是假绿」的坑
 * （验收机bash 环境无 perl，变异体没插进去，跑出来全绿，
 *   差点被当成「断言没测到东西」，结论正好反了）。
 * 所以这里把纪律**写进代码**：
 *   ① 施加后立刻 grep 校验特征串真的在文件里；
 *   ② 施加前把原文件复制成 .bak（逐字节备份）；
 *   ③ 还原后用 cmp 逐字节比对，并断言备份文件还在。
 * 任何一步不符就**直接抛错退出**，绝不放行。
 *
 * 用法：node tools/mutate.js <case>
 *   case = no-personal-id | species-fallback | drop-encounter-lines | check
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NODE = process.execPath;

/** 施加一次变异：把 from 换成 to，施加后 grep 校验 marker 真的进去了。 */
function applyMutate(file, from, to, marker) {
  const fp = path.join(ROOT, file);
  const bak = fp + '.mutbak';
  if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);   // 逐字节备份
  const src = fs.readFileSync(fp, 'utf8');
  const hits = src.split(from).length - 1;
  if (hits !== 1) throw new Error(`[${file}] 目标串出现 ${hits} 次（要求恰好 1 次），拒绝施加`);
  fs.writeFileSync(fp, src.replace(from, to));
  // ★ 施加后立刻校验：marker 必须真的在磁盘上
  const now = fs.readFileSync(fp, 'utf8');
  if (!now.includes(marker)) {
    restore(file);
    throw new Error(`[${file}] 施加后校验失败：marker「${marker}」不在文件里 → 已还原，退出`);
  }
  console.log(`  [施加] ${file}: 已写入并grep 校验通过（marker=${marker}）`);
  return bak;
}

/** 还原：优先用备份逐字节回写，然后用 cmp 确认 100% 一致。 */
function restore(file) {
  const fp = path.join(ROOT, file);
  const bak = fp + '.mutbak';
  if (!fs.existsSync(bak)) { console.log(`  [还原] ${file}: 无备份，跳过`); return true; }
  fs.copyFileSync(bak, fp);
  const a = fs.readFileSync(fp), b = fs.readFileSync(bak);
  const same = a.equals(b);
  if (!same) throw new Error(`[${file}] 还原后与备份不一致！`);
  fs.unlinkSync(bak);
  console.log(`  [还原] ${file}: cmp 逐字节一致 ✔`);
  return true;
}

const CASES = {
  /* 变异 1：摘掉 PERSONALITIES 的 id → 性格分流应变死（B7-3/B7-性格 应变红） */
  'no-personal-id': () => applyMutate(
    'game/src/core/personality.js',
    "  qienuo: { id: 'qienuo', name: '怯懦'",
    "  qienuo: { id: '', name: '怯懦'",
    "qienuo: { id: ''",
  ),

  /* 变异 2：让 speciesOf 退回关键词兜底 → BLK-2 应复现（蓝凤凰被判成蛇类）
     这是 BLK-2 的**真实根因**：旧代码第③级拿一条 /蛇|snake|viper/i 去扫
     name + desc，把人类 NPC 判成蛇类。所以变异体把那一行原样插回来。
     ⚠️ 第一版我写成三步（放宽闸门 + 改宽 ids + 再插一行），
        结果第①步和第③步的目标串是同一句 → 第二步就报「出现 0 次」。
        工具正确拒绝了（这正是它存在的意义），但也说明：
        **变异体应该尽量单点** —— 多步变异既容易自相矛盾，也难归因。
        现在改成单点：只插回旧兜底那一行，其余判据不动。 */
  /* ⚠️ 变异位置很关键，第二版踩过坑：
       我第一版把兜底行插在 `return null` 之前（也就是**类型闸门之后**），
       结果变异体「施加成功」（grep 得到标记）但**蓝凤凰依然判不出蛇类** ——
       因为 `if (!isAnimalId(id)) return null;` 在**前面**就把人物模板挡掉了。
       断言照样全绿 235/0。若就此收工，就会得出「BLK-2 修好了但断言测不出来」的
       **完全错误**的结论 —— 这正是「变异没真正复现缺陷」比「断言是假绿」更危险的地方：
       前者会让人**放弃一个其实有效的断言**，后者只是让人多写一条测试。
       所以变异必须插在**类型闸门之前**（也就是旧代码第③级真正所在的位置：
       它本来就在 id 规则查完之后、无条件对所有模板生效），才忠实复现根因。
       教训：**施加后必须验证「缺陷真的复现了」，不能只验证「代码真的改了」**。 */
  'species-fallback': () => applyMutate(
    'game/src/core/bestiary.js',
    '  const id = String(def.id || \'\');\n  if (!isAnimalId(id)) return null;',
    "  const id = String(def.id || '');\n  if (/蛇|snake|viper/i.test((def.name || '') + ' ' + (def.desc || '')) && !/^mob_snake$/.test(id)) return 'snake';\n  if (!isAnimalId(id)) return null;",
    "if (/蛇|snake|viper/i.test((def.name",
  ),

  /* 变异 2b：**关键词兜底 + 类型闸门一起拆** = 完整还原 BLK-2 现场。
     为什么必须有这一组（第二版实测的教训）：
       只拆闸门、不加兜底（我第一版的 2b）是**无效变异** ——
       锚定规则 `^mob_snake$` 本来就匹配不到 `miao_lan`，
       所以拆了闸门她依然判不出蛇类，断言全绿 235/0。
       若把这份「全绿」当成「第二道保险有效」的证据，就是**假绿**：
       它只证明了「闸门拆了也没用」，没证明「闸门拦得住东西」。
     真正的对照实验是：**造出与修复前完全相同的缺陷状态**（兜底 + 无闸门），
       看注入层的三条守卫（守卫1/3/5）会不会红。
       变异 2 已经证明判别层的断言会红；这一组证明注入层的守卫也会红 ——
       两组都红，才说明「双保险」的两个保险各自都被测到了。 */
  'species-fallback-nogate': () => {
    applyMutate(
      'game/src/core/bestiary.js',
      '  const id = String(def.id || \'\');\n  if (!isAnimalId(id)) return null;',
      "  const id = String(def.id || '');\n  if (/蛇|snake|viper/i.test((def.name || '') + ' ' + (def.desc || '')) && !/^mob_snake$/.test(id)) return 'snake';\n  if (!isAnimalId(id)) return null;",
      "if (/蛇|snake|viper/i.test((def.name",
    );
    /* 同时拆掉 applySpeciesMoves 里的类型闸门（world.js 那一道）。 */
    applyMutate(
      'game/src/core/world.js',
      '      if (!bestiary.isAnimalId(id)) { this._speciesHumanRejects++; continue; }',
      '      if (false && !bestiary.isAnimalId(id)) { this._speciesHumanRejects++; continue; }',
      'if (false && !bestiary.isAnimalId(id))',
    );
  },

  /* 变异 3：遭遇战路径丢弃 startCombat 返回体 → BLK-1 应复现（台词不显示） */
  'drop-encounter-lines': () => applyMutate(
    'game/src/core/world.js',
    '          if (r && Array.isArray(r.lines) && r.lines.length) lines.push(...r.lines);',
    '          if (false && r && Array.isArray(r.lines) && r.lines.length) lines.push(...r.lines);',
    'if (false && r && Array.isArray(r.lines)',
  ),

  /* 变异 B13：把一条已修好的严格反向边重新变成历史「单向门」
     （还原 design/19 §7.1 举例的 jiangnan_market -n-> jn_market_main：
      对侧 jn_market_main.s 指向 jn_fruit_stall 而非回指本人）。
     期望：map-check 断言 2（收紧后）判红；旧断言（只查反向键存在）会全绿。 */
  'b13-asym-edge': () => applyMutate(
    'game/data/50_map.json',
    '"u": "jn_market_main"',
    '"n": "jn_market_main"',
    '"n": "jn_market_main"',
  ),

  /* 变异 B13-a：注释掉 world.deserialize 的「房间不存在 → 回 startRoom」兜底。
     期望：smoke-map-migrate 的「落在 meta.startRoom」+「给了提示」两组变红（旧档软锁复现）。 */
  'b13-save-fallback': () => applyMutate(
    'game/src/core/world.js',
    'if (!this.data.rooms[p.room]) {',
    'if (false && !this.data.rooms[p.room]) {',
    'if (false && !this.data.rooms[p.room]) {',
  ),

  /* 变异 B13-b：拆掉 commands.js 里 go / look 两处「房间不存在」防御。
     期望：smoke-map-migrate 的运行期防御组（4.x）变红（`room.exits` 解引用崩）。 */
  'b13-room-guards': () => {
    applyMutate(
      'game/src/core/commands.js',
      "if (!room) return { lines: [{ kind: 'warn', text: '你似乎不在一个真实所在，辨不清方向。' }] };",
      "if (false && !room) return { lines: [{ kind: 'warn', text: 'x' }] };",
      "if (false && !room) return",
    );
    applyMutate(
      'game/src/core/commands.js',
      "if (!room) return { lines: [{ kind: 'warn', text: '这里一片虚无，四下都看不清。' }] };",
      "if (false && !room) return { lines: [{ kind: 'warn', text: 'y' }] };",
      "text: 'y' }] };",
    );
  },

  /* 变异 P1（画像落地）：spawnNpc 不再 clone portrait → 实例与模板共享引用。
     期望：smoke-portrait-batch 的 2.3/2.4/2.7/2.8 判红（「改一个带全江湖」复现）。 */
  'portrait-no-clone': () => applyMutate(
    'game/src/core/world.js',
    'npc.portrait = def.portrait ? clone(def.portrait) : null;',
    'npc.portrait = def.portrait || null;',
    'npc.portrait = def.portrait || null;',
  ),

  /* 变异 P2（画像落地）：routineNow 不再读 portrait.routine → L0「看见」整层消失。
     期望：smoke-portrait-batch 的 1.L0 与 1.A 判红。 */
  'portrait-drop-routine': () => applyMutate(
    'game/src/core/commands.js',
    'const r = npc && npc.portrait && npc.portrait.routine;',
    'const r = null && npc && npc.portrait && npc.portrait.routine;',
    'const r = null && npc && npc.portrait && npc.portrait.routine;',
  ),

  /* 变异 P3（画像落地）：ask 不再走画像 L2 分支 → 来历/近况/想头/惧怕/禁忌全失效。
     期望：smoke-portrait-batch 的 1.L2 origin/want/fear、1.F taboo 判红。 */
  'portrait-drop-ask': () => applyMutate(
    'game/src/core/commands.js',
    'if (!found && npc.portrait) {',
    'if (false && !found && npc.portrait) {',
    'if (false && !found && npc.portrait) {',
  ),

  /* 变异 B21-a：把 mergeData 的「数组保持数组」修复回退 → events 又会揉成对象。
     期望：smoke-events 的 §0（四个键是否数组）、§1/§1b（通用数组保持）、
           §2（onKill 真掉物品）全部判红。 */
  'b21-events-knead': () => applyMutate(
    'game/src/core/world.js',
    'if (Array.isArray(entry)) {',
    'if (false && Array.isArray(entry)) {',
    'if (false && Array.isArray(entry)) {',
  ),

  /* 变异 B21-b：把「升级 → fireEvent('onLevelUp')」的接线回退。
     期望：smoke-events 的 §3.3（升级真有那句 say）判红；§0 不受影响（数据仍是数组）。 */
  'b21-levelup-unwire': () => applyMutate(
    'game/src/core/world.js',
    "this.on('levelup', ev => { this.fireEvent('onLevelUp', ev || {}); });",
    "this.on('levelup', ev => { if (false) this.fireEvent('onLevelUp', ev || {}); });",
    'if (false) this.fireEvent(\'onLevelUp\'',
  ),

  /* 变异 WI-1（WORLD-INTERACT）：把 fireEvent 读 worldEvents 的那一行回退。
     期望：smoke-world-interact 的 §1（哨兵/冷却/once/兜底）、§2（W5 真跨日）、
           §4.6（大赦）全部判红 —— 这正是「W5 落地必须补这一行」的证据。 */
  'wi-unwire-worldevents': () => applyMutate(
    'game/src/core/world.js',
    '      || (this.data.worldEvents && this.data.worldEvents[name])',
    '      || (0 && (this.data.worldEvents && this.data.worldEvents[name]))',
    '0 && (this.data.worldEvents',
  ),

  /* 变异 WI-2：lookNpc 不再输出画像 role 那一行。
     期望：smoke-world-interact §5 的 5 个「role 出现在 look 输出」判红。 */
  'wi-role-unwire': () => applyMutate(
    'game/src/core/commands.js',
    '    if (npc.portrait && npc.portrait.role) {',
    '    if (false && npc.portrait && npc.portrait.role) {',
    '    if (false && npc.portrait && npc.portrait.role) {',
  ),

  /* 变异 WI-3：voice.style 不再影响 talk 句式。
     期望：smoke-world-interact §5 的四条「style 句式被改写」判红。 */
  'wi-style-unwire': () => applyMutate(
    'game/src/core/personality.js',
    '  const sig = voiceStyleSig(npc);',
    '  const sig = null && voiceStyleSig(npc);',
    '  const sig = null && voiceStyleSig(npc);',
  ),

  /* 变异 WI-4：engine 不再把「推进时间期间的 storyline」排进玩家输出。
     期望：smoke-world-interact §2.1（真 exec 跨日看到事件叙述）判红。 */
  'wi-ticklines-unwire': () => applyMutate(
    'game/src/core/engine.js',
    '    const tick = w.drainTickLines();',
    '    const tick = [];',
    '    const tick = [];',
  ),

  /* 变异 WI-5：节庆日历不再命中。
     期望：smoke-world-interact §4.1~4.4 判红。 */
  'wi-festival-unwire': () => applyMutate(
    'game/src/core/world.js',
    '    const fest = (cal.festivals || []).find(f => f.day === d);',
    '    const fest = null;',
    '    const fest = null;',
  ),

  /* 变异 WI-6：拆掉「前置未满足不算可接」的 require 门（sidequest-land 实测缺口）。
     期望：smoke-world-interact §6.13 判红（冒出不满足前置的假入口）。 */
  'wi-require-unwire': () => applyMutate(
    'game/src/core/commands.js',
    '      if (qd0 && qd0.require && !evalCond(qd0.require, ctx)) continue;',
    '      if (false && qd0 && qd0.require && !evalCond(qd0.require, ctx)) continue;',
    'if (false && qd0 && qd0.require',
  ),

  /* restore：把所有 .mutbak 逐字节还原（还原纪律：还原后必须 cmp 一致） */
  restore: () => {
    const files = ['game/src/core/personality.js', 'game/src/core/bestiary.js',
      'game/src/core/world.js', 'game/src/core/combat.js', 'game/src/core/engine.js',
      'game/src/core/commands.js', 'game/data/50_map.json'];
    for (const f of files) restore(f);
    console.log('  [还原] 全部完成');
  },

  /* 校验：确认三个文件都无备份残留（即已100% 还原） */
  check: () => {
    const files = ['game/src/core/personality.js', 'game/src/core/bestiary.js',
      'game/src/core/world.js', 'game/src/core/combat.js', 'game/src/core/engine.js',
      'game/src/core/commands.js', 'game/data/50_map.json'];
    let bad = 0;
    for (const f of files) {
      const bak = path.join(ROOT, f + '.mutbak');
      if (fs.existsSync(bak)) { console.log(`  ✘ 残留备份: ${f}.mutbak`); bad++; }
    }
    console.log(bad ? `  ✘ check 失败：${bad} 个残留备份` : '  ✔ check 通过：无 .mutbak 残留');
    process.exit(bad ? 1 : 0);
  },
};

const which = process.argv[2];
if (!which || !CASES[which]) {
  console.log('用法: node tools/mutate.js <no-personal-id|species-fallback|species-fallback-nogate|drop-encounter-lines|b13-asym-edge|b13-save-fallback|b13-room-guards|portrait-no-clone|portrait-drop-routine|portrait-drop-ask|b21-events-knead|b21-levelup-unwire|restore|check>');
  process.exit(2);
}
try {
  CASES[which]();
} catch (err) {
  console.error('  ✘ 变异失败: ' + err.message);
  process.exit(1);
}