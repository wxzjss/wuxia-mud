/* ambient 动态句守卫（R2，design/77 §2.0.3）
 * §A 行为：真跑 commands.ambientLine（导出的唯一实现，不测拷贝）——
 *          夜句优先 / 无句不显示不兜底 / 空白句当没有 / 无 ambient 返回 null
 * §B 数据：全库 game/data/*.json 的 room.ambient 键集合 ⊆ {晴,阴,雨,雪,风,雾,night}（防英文键混进）
 *          且每个值是非空字符串
 * §C 接线：lookRoom 里真调 ambientLine(room, w) 并 push（防「函数在但没人调」）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const commands = require('../game/src/core/commands.js');

let pass = 0, fail = 0;
const t = (name, cond) => { if (cond) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name); } };

console.log('[A] ambientLine 行为（真实现）');
const { ambientLine } = commands;
t('ambientLine 是导出的函数', typeof ambientLine === 'function');
const mkW = (weather, night) => ({ weather, isNight: () => night });
const roomFull = {
  ambient: { '晴': '日头正好。', night: '夜里林子发黑。', '雨': '雨打针叶。' },
};
t('白天·晴 → 取晴句', ambientLine(roomFull, mkW('晴', false)) === '日头正好。');
t('白天·雨 → 取雨句', ambientLine(roomFull, mkW('雨', false)) === '雨打针叶。');
t('夜 → night 优先（哪怕白天是晴）', ambientLine(roomFull, mkW('晴', true)) === '夜里林子发黑。');
t('夜里下雪但房间有 night 句 → 仍取 night 句（夜句优先于天气，雪无所谓）', ambientLine(roomFull, mkW('雪', true)) === '夜里林子发黑。');
t('白天遇下雪且无雪句 → 不兜底', ambientLine(roomFull, mkW('雪', false)) === null);
t('夜里无 night 键 → 回退 weather 句', ambientLine({ ambient: { '晴': '日头正好。' } }, mkW('晴', true)) === '日头正好。');
t('空白句当没有（夜间 night 只有空格 → 回退天气句）',
  ambientLine({ ambient: { night: '   ', '晴': '日头正好。' } }, mkW('晴', true)) === '日头正好。');
t('空白天气句当没有 → null',
  ambientLine({ ambient: { '雪': '' } }, mkW('雪', false)) === null);
t('无 ambient 字段的房 → null', ambientLine({}, mkW('晴', false)) === null);
t('ambient 不是对象 → null', ambientLine({ ambient: '雨打针叶。' }, mkW('晴', false)) === null);
t('无 room → null', ambientLine(null, mkW('晴', false)) === null);

console.log('[B] 数据键集合 ⊆ {晴,阴,雨,雪,风,雾,night}');
const ALLOWED = new Set(['晴', '阴', '雨', '雪', '风', '雾', 'night']);
const dataDir = path.join(__dirname, '..', 'game', 'data');
let ambRooms = 0, keyBad = [], valBad = [];
for (const f of fs.readdirSync(dataDir).filter(f => f.endsWith('.json'))) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); } catch (e) { continue; }
  const rooms = Array.isArray(j.rooms) ? j.rooms : (j.rooms && typeof j.rooms === 'object' ? Object.values(j.rooms) : []);
  for (const r of rooms) {
    if (!r || !r.ambient || typeof r.ambient !== 'object') continue;
    ambRooms++;
    for (const [k, v] of Object.entries(r.ambient)) {
      if (!ALLOWED.has(k)) keyBad.push(`${f}/${r.id}: 键「${k}」不在 {晴,阴,雨,雪,风,雾,night} 里（英文键？）`);
      if (typeof v !== 'string' || !v.trim()) valBad.push(`${f}/${r.id}: 键「${k}」的值不是非空字符串`);
    }
  }
}
t(`全库共 ${ambRooms} 间带 ambient（>0，别让守卫在零样本上空过）`, ambRooms > 0);
t('无非法键', keyBad.length === 0);
t('每个值都是非空字符串', valBad.length === 0);
if (keyBad.length) keyBad.forEach(s => console.log('    ' + s));
if (valBad.length) valBad.forEach(s => console.log('    ' + s));

console.log('[C] lookRoom 接线');
const code = fs.readFileSync(path.join(__dirname, '..', 'game', 'src', 'core', 'commands.js'), 'utf8');
t('lookRoom 里真调 ambientLine(room, w)', /function\s+lookRoom[\s\S]*?ambientLine\(room,\s*w\)/.test(code));
t('取到句就 push（if (line) … push）', /const\s+line\s*=\s*ambientLine\(room,\s*w\);[\s\S]{0,200}if\s*\(line\)\s*lines\.push/.test(code));
t('句子过 evalTemplate（与 desc 同口径）', /evalTemplate\(line,\s*ctx\)/.test(code));

console.log(`\nambient-check：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
