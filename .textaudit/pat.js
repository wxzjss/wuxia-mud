const fs = require('fs');
const path = require('path');
const P = (f) => path.join(path.resolve(__dirname, '..'), f);
const lines = fs.readFileSync(P('.textaudit/rooms.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
let pat = {};
const bumps = (k) => { pat[k] = (pat[k] || 0) + 1; };
for (const [id, name, desc] of lines) {
  if (/正在/.test(desc)) bumps('含"正在"');
  if (/隐约/.test(desc)) bumps('含"隐约"');
  if (/一应俱全/.test(desc)) bumps('一应俱全');
  if (/一派[^，。]{0,6}气象/.test(desc)) bumps('一派…气象');
  if (/依稀/.test(desc)) bumps('依稀');
  if (/(伙|个|位|群)[^，。]{0,10}(正在|在)/.test(desc)) bumps('存在句有X在Y');
  if (/[，。](一位|一个|几个|一名|一群|几十)/.test(desc)) bumps('结尾引入人物');
  if (/好不|煞是|十分|非常|格外|分外|异常/.test(desc)) bumps('程度副词');
  if (/(富贵风流|纸醉金迷|闲适慵懒|一派|气象|光景|景象)/.test(desc)) bumps('概括词气象/光景');
}
console.log(JSON.stringify(pat, null, 1));
const tailMap = {};
for (const [id, name, desc] of lines) { const t = desc.slice(-18); (tailMap[t] = tailMap[t] || []).push(id + '|' + name); }
console.log('--- 重复结尾(>=3) ---');
Object.entries(tailMap).filter(([k, v]) => v.length >= 3).sort((a, b) => b[1].length - a[1].length).forEach(([k, v]) => console.log(v.length, '尾:' + k, '=>', v.slice(0, 10).join(' / ')));
const fullMap = {};
for (const [id, name, desc] of lines) { (fullMap[desc] = fullMap[desc] || []).push(id); }
console.log('--- 完全相同描述 ---');
Object.entries(fullMap).filter(([k, v]) => v.length > 1).forEach(([k, v]) => console.log(v.length, '|', k.slice(0, 44), '=>', v.join(',')));
