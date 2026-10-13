/* design/77 §2.3 + §2.4 落库文案自检（游有方，夜班批）
 * 只读 design/77 与 game/data，不改任何数据。
 * 检查四项：破折号 / 字数 / 收法不重复 / 与全库共享串
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(ROOT, 'design/77-room-rewrite-sample.md'), 'utf8');

/* 只取 §2.3 与 §2.4 两节（互不重叠），且只抽 ①②③ 落库区块 */
const B = ['## 2.3 🔴', '## 2.4 夜班批', '## 3.3 藏宝阁'].map(h => doc.indexOf(h));
const seg = doc.slice(B[0], B[1]) + '\n' + doc.slice(B[1], B[2]);

const rooms = []; // {id, fixed, amb[], trace}
const reRoom = /### [GH]\d+ · `([a-z0-9_]+)`[^\n]*\n([\s\S]*?)(?=\n### [GH]\d+ ·|\n### 2\.|\n## )/g;
let m;
while ((m = reRoom.exec(seg))) {
  const body = m[2];
  const fixed = (body.match(/\*\*① 固定描写\*\*\n> (.+)/) || [])[1] || '';
  const amb = [];
  const reAmb = /^\| (晴|阴|雨|雪|风|雾|夜) \| (.+) \|$/gm;
  let a; while ((a = reAmb.exec(body))) amb.push(a[2]);
  const trace = (body.match(/\*\*③ 痕迹句\*\*\n> (.+)/) || [])[1] || '';
  rooms.push({ id: m[1], fixed, amb, trace });
}
console.log('抽到房间数：', rooms.length, '（应 14）');

/* 1) 破折号 */
const all = [];
for (const r of rooms) all.push(r.fixed, ...r.amb, r.trace);
const dash = all.filter(s => s.includes('——'));
console.log('1) 落库句总数', all.length, '；破折号', dash.length, dash.length ? '\n  ' + dash.join('\n  ') : '✅');

/* 2) 固定描写字数 */
const lens = rooms.map(r => ({ id: r.id, n: Array.from(r.fixed).length }));
const bad = lens.filter(x => x.n < 55 || x.n > 80);
console.log('2) 固定描写字数：', lens.map(x => `${x.id}=${x.n}`).join(' '));
if (bad.length) console.log('   ⚠️ 出档：', bad.map(x => `${x.id}(${x.n})`).join(' '));

/* 3) 收法不重复 —— 用痕迹句 + 固定描写末句做指纹 */
const ends = rooms.map(r => (r.trace || r.fixed.split('。').filter(Boolean).pop()));
const dup = ends.filter((e, i) => ends.indexOf(e) !== i);
console.log('3) 收法指纹重复：', dup.length ? '❌ ' + dup.join(' / ') : '0 ✅');

/* 4) 与全库共享串 —— 每个分句去 game/data 里找 */
let corpus = '';
for (const f of fs.readdirSync(path.join(ROOT, 'game/data'))) {
  if (f.endsWith('.json')) corpus += fs.readFileSync(path.join(ROOT, 'game/data', f), 'utf8');
}
const sents = [];
for (const r of rooms) for (const s of r.fixed.split('。')) if (Array.from(s).length >= 8) sents.push(s + '。');
for (const r of rooms) for (const s of r.amb) if (Array.from(s).length >= 8) sents.push(s);
const hit = sents.filter(s => corpus.includes(s));
console.log('4) 与全库共享串：', hit.length ? '❌ ' + hit.join(' | ') : '0 ✅', `（比对 ${sents.length} 句）`);

/* 5) 不写人 —— 8 间夜班房的 npcs 应为空 */
const need = ['emei_path2','dali_path2','tangmen_path2','miaojiang_path2','gaibang_path2','gumu_path2','taohuadao_path2','wd_village_yard'];
const found = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'game/data'))) {
  if (!f.endsWith('.json')) continue;
  let d; try { d = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data', f), 'utf8')); } catch { continue; }
  const walk = o => { if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (need.includes(o.id)) found.set(o.id, o);
    for (const v of Object.values(o)) walk(v); };
  walk(d);
}
const npcBad = need.filter(i => { const o = found.get(i); return !o || (o.npcs && o.npcs.length); });
console.log('5) 夜班 8 间 npcs 非空：', npcBad.length ? '❌ ' + npcBad.join(',') : '0 ✅');
