/* SPRINT-A：修单向出口
 * 补齐所有横向出口的反向（u/d 上下楼本就是对称的，不动）。
 * 幂等：已有反向则跳过。
 */
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');
const map = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const R = map.rooms || {};

const OPP = { n: 's', s: 'n', e: 'w', w: 'e', ne: 'sw', sw: 'ne', nw: 'se', se: 'nw' };

function targetOf(v) {
  return typeof v === 'string' ? v : (v && v.to);
}

let added = 0;
const log = [];
for (const id of Object.keys(R)) {
  const exits = R[id].exits || {};
  for (const dir of Object.keys(OPP)) {
    const to = targetOf(exits[dir]);
    if (!to || !R[to]) continue;
    const back = R[to].exits || {};
    if (back[OPP[dir]]) continue;
    R[to].exits = back;
    back[OPP[dir]] = id;
    added++;
    log.push(R[to].name + '(' + R[to].region + ') +' + OPP[dir] + ' -> ' + R[id].name);
  }
}

fs.writeFileSync(MAP, JSON.stringify(map, null, 2));
console.log('补反向出口 ' + added + ' 条');
log.forEach(s => console.log('  + ' + s));