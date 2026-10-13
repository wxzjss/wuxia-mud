#!/usr/bin/env node
/* ==========================================================================
 *  tools/roomnotes-check.js —— R4 roomNotes 守卫（design/85 · 77 §2.0.2 · 79 §2.1③）
 * --------------------------------------------------------------------------
 *  覆盖：
 *    §A 行为（真跑 writeRoomNote / roomNoteRuleFor）：
 *       成功才写、失败不写、单值静默覆盖、!combat 闸、匹配只认房间 action 语义
 *    §B 规则（85 §三.2 本批 6 条：#3/4/11/14/15/18，一个不多）
 *    §C 接线（三条成功路径都挂了写入；lookRoom 渲染 trace；痕迹句不过 .hl 管线）
 *    §D 数据（全库房间 action 扫描：6 条规则至少各自有真实候选位——不许零样本空过）
 *    §E 视觉（79 §2.1③：trace 层 CSS、朱点主判据、颜色一律变量、不新开 820 断点）
 *  用法：node tools/roomnotes-check.js
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const t = (name, cond, note) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (note ? '  ' + note : '')); }
  else { fail++; console.log('  ✗ ' + name + (note ? '  ' + note : '')); }
};

const C = require('../game/src/core/commands.js');
const cssRaw = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'renderer', 'css', 'main.css'), 'utf8');
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, ' ');
const cmdsSrc = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'core', 'commands.js'), 'utf8');

console.log('[A · 行为] 写入时机 / 覆盖语义（85 §0.2）');
/* 桩 ctx：不在战斗（w.battle / p.inCombat 都空） */
function mkCtx(note) {
  return { player: { room: 'room_test', inCombat: false, roomNotes: note || {} }, world: { battle: null } };
}
const act = (cmd, keywords) => ({ cmd, keywords: keywords || [] });

t('A1 掬泉：cmd 命中「泉水」→ 写入 p.roomNotes[roomId]',
  (() => { const c = mkCtx(); C.writeRoomNote(c, act('掬泉饮水')); return c.player.roomNotes.room_test === '潭边的石上留着一圈水渍。'; })());
t('A2 keywords 命中也算（cmd 不带关键词词面时）',
  (() => { const c = mkCtx(); C.writeRoomNote(c, act('do_stuff', ['上香'])); return c.player.roomNotes.room_test === '香炉里多了一截烧尽的香灰。'; })());
t('A3 不在规则内的 action（如「看告示」）不写',
  (() => { const c = mkCtx(); C.writeRoomNote(c, act('看告示')); return Object.keys(c.player.roomNotes).length === 0; })());
t('A4 单值静默覆盖：同房先后两件事，后者盖前者、无提示',
  (() => { const c = mkCtx(); C.writeRoomNote(c, act('坐歇')); C.writeRoomNote(c, act('净面'));
    return c.player.roomNotes.room_test === '井台的石沿湿了一块。'; })());
t('A5 战斗中不写（!combat 闸）',
  (() => { const c = { player: { room: 'r', inCombat: true, roomNotes: {} }, world: { battle: null } };
    C.writeRoomNote(c, act('上香')); return Object.keys(c.player.roomNotes).length === 0; })());
t('A6 p.roomNotes 未初始化时自动建档（不 throw）',
  (() => { const c = { player: { room: 'r', inCombat: false }, world: {} }; let ok = true;
    try { C.writeRoomNote(c, act('施舍')); } catch (e) { ok = false; }
    return ok && c.player.roomNotes && c.player.roomNotes.r === '破碗里的铜钱叠着两枚。'; })());
t('A7 空 action / 缺 cmd 不炸不写',
  (() => { const c = mkCtx(); let ok = true; try { C.writeRoomNote(c, null); C.writeRoomNote(c, {}); } catch (e) { ok = false; }
    return ok && Object.keys(c.player.roomNotes).length === 0; })());

console.log('[B · 规则] 85 §三.2 本批 6 条（#3 掬泉/#4 坐歇/#11 上香/#14 藏物/#15 施舍/#18 净面）');
t('B1 规则恰好 6 条（带 ⚠️ 字段的 12 条不硬造，等对齐再补）', C.ROOMNOTE_RULES.length === 6, C.ROOMNOTE_RULES.map(r => r.id).join('/'));
t('B2 六条 id 对号', (() => { const ids = C.ROOMNOTE_RULES.map(r => r.id).join(',');
  return ids === 'drink,rest,incense,hide,alms,wash'; })());
t('B3 六条痕迹句非空、无 .hl 词面（痕迹句不过 .hl 管线，85 §二.1）',
  C.ROOMNOTE_RULES.every(r => typeof r.note === 'string' && r.note.trim() && r.note.indexOf('hl') < 0));
t('B4 每条规则 keys 非空（不许零关键词的空规则）', C.ROOMNOTE_RULES.every(r => Array.isArray(r.keys) && r.keys.length > 0));

console.log('[C · 接线] 三条成功路径 + lookRoom 渲染');
/* 成功路径：cond 过 + 限次过 + 有 effects 之后才 evalEffects —— 写入必须挂在这之后、
   且不能挂在 cond/限次/缺 effects 的 return 之前。静态核对三处调用点都长在
   `evalEffects(a.effects` 成功出口的紧前面。 */
const callSites = (cmdsSrc.match(/writeRoomNote\((ctx|c),\s*(a|selfSuff)\)/g) || []).length;
t('C1 房间 action 成功路径挂了写入（≥3 处：主派发 / look 路径 / selfSuff）', callSites >= 3, callSites + ' 处');
t('C2 写入在 evalEffects 之前一行（成功出口的紧前面，失败路径到不了）',
  /writeRoomNote\(ctx, a\);\s*\r?\n\s*return evalEffects\(a\.effects, ctx\)/.test(cmdsSrc));
t('C3 lookRoom 渲染痕迹句：kind trace、单值、不过 .hl（push 无 hl 字段）',
  /p\.roomNotes && p\.roomNotes\[p\.room\][\s\S]{0,120}kind: 'trace'/.test(cmdsSrc)
  && !/kind: 'trace'[\s\S]{0,80}hl:/.test(cmdsSrc));
t('C4 trace 行渲染在动态句之后（push 位置在 ambient/festival 段之后）',
  cmdsSrc.indexOf('kind: \'trace\'') > cmdsSrc.indexOf('ambientLine(room, w)'));

console.log('[D · 数据] 全库房间 action 扫描：候选位台账（不许假阳性，不许静默空过）');
const dataDir = path.join(__dirname, '..', 'game', 'data');
const cover = {}; C.ROOMNOTE_RULES.forEach(r => cover[r.id] = []);
for (const f of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  let j; try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  const rooms = Array.isArray(j.rooms) ? j.rooms : (j.rooms && typeof j.rooms === 'object' ? Object.values(j.rooms) : []);
  for (const r of rooms) {
    if (!r || !Array.isArray(r.actions)) continue;
    for (const a of r.actions) {
      const rule = C.roomNoteRuleFor(a);
      if (rule) cover[rule.id].push(r.id || r.name || f);
    }
  }
}
/* 实测台账（2026-10-15 全库扫描）：6 条常驻位规则里只有 drink 有真实候选位
   （饮水 @wild_pool / @xiyu_oasis）；坐歇/上香/藏物/施舍/净面对应的 action
   **库里还不存在**（拜佛≠上香、打坐≠坐歇、拜师≠施舍）—— 按主理人口令
   「字段对不上的先不硬造」，这 5 条记缺口：引擎机制已就绪，数据侧将来补了
   对应 action，D2 会红着提醒把规则接上。ⓘ KnownZero 是活的缺口台账，不是放水。 */
t('D1 有候选位的规则匹配真实命中（drink ≥1）', cover.drink.length >= 1,
  'drink:' + cover.drink.length + ' @' + cover.drink.join('/'));
t('D2 缺口如实登记：其余 5 条候选位为 0（库里有对应 action 时这里红 → 补台账）',
  ['rest', 'incense', 'hide', 'alms', 'wash'].every(id => cover[id].length === 0),
  ['rest', 'incense', 'hide', 'alms', 'wash'].map(id => id + ':' + cover[id].length).join('  '));
t('D3 无假阳性：词面不得误吞「藏经阁/拜师/坐船」这类同字面 action',
  (() => {
    const bad = [{ cmd: '藏经阁', keywords: ['藏经阁', '经卷'] }, { cmd: '拜师 华山派', keywords: ['拜师'] }, { cmd: '出海', keywords: ['坐船'] }];
    return bad.every(a => !C.roomNoteRuleFor(a));
  })());

console.log('[E · 视觉] 79 §2.1③ trace 层（退两格 / 朱色 / 行首朱点主判据）');
t('E1 .log-line.trace 用变量着色 var(--room-trace)', /\.log-line\.trace\s*\{[^}]*color:\s*var\(--room-trace\)/.test(css));
t('E2 --room-trace = var(--red)（朱是我专用，76 总纲；亮主题级联自 --red，不另覆写）',
  /--room-trace:\s*var\(--red\)/.test(css) && !/--room-trace:\s*#/.test(css));
t('E3 朱点 ::before 主判据在（79 §2.3：没点分不开 ②↔③）',
  /\.log-line\.trace::before\s*\{[^}]*background:\s*var\(--room-trace\)/.test(css));
t('E4 trace 规则块内零硬编码色（颜色一律变量）',
  (css.match(/\.log-line\.trace[^{]*\{[^}]*\}/g) || []).every(b => !/#[0-9a-fA-F]{3,8}/.test(b)));
t('E5 缩进 22px 走变量 --room-indent-3', /--room-indent-3:\s*22px/.test(css)
  && /\.log-line\.trace\s*\{[^}]*padding-left:\s*var\(--room-indent-3\)/.test(css));

console.log('\n—— 本批缺口登记（85 §0.3 ⚠️ 字段，等对齐不硬造）——');
console.log('   weather / isNight / flag:drunk / flag:抄书 / flag:持信 / 击杀定位 → 其余 12 条行为点未落');
console.log(`\nR4 roomnotes-check：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
