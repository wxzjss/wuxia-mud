/* 62 间 desc 重写的施工图生成器（游有方）
 * 只读：design/77 §1.2 改名表 + game/data/*.json 的现 desc
 * 输出：tools/_out_62_desc_sheet.tsv
 * 不写 game/data —— 只出表与诊断。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const doc = fs.readFileSync(path.join(ROOT, 'design/77-room-rewrite-sample.md'), 'utf8').split('\n');

// 1) 改名表：82 行
const renames = [];
for (const ln of doc) {
  const m = ln.match(/^\|\s*`([a-z0-9_]+)`\s*\|\s*([^|]+)\|\s*\*\*([^*]+)\*\*\s*\|(.*)\|\s*$/);
  if (m) renames.push({ id: m[1], old: m[2].trim(), name: m[3].trim(), why: m[4].trim() });
}

// 2) §2 已有全文的 20 间
const done = new Set();
for (const ln of doc) {
  const m = ln.match(/^####\s+[A-F]\d+\s+·\s+`([a-z0-9_]+)`/);
  if (m) done.add(m[1]);
}

// 3) 读全部 data，按 id 找房
const rooms = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'game/data'))) {
  if (!f.endsWith('.json')) continue;
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data', f), 'utf8')); } catch { continue; }
  const walk = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o.id === 'string' && typeof o.desc === 'string') rooms.set(o.id, { ...o, _file: f });
    for (const v of Object.values(o)) walk(v);
  };
  walk(d);
}

const len = s => Array.from(String(s || '')).length;

const rows = renames.filter(r => !done.has(r.id));
const head = ['#', 'id', '新名', '旧名', '所在文件', '现desc', '现desc字数', '破折号', '需配新desc', '依据'];
const out = [head.join('\t')];
let i = 0, need = 0, dashN = 0, missing = 0;
for (const r of rows) {
  const rm = rooms.get(r.id);
  const desc = rm ? rm.desc : '';
  const dash = (desc.match(/——/g) || []).length;
  const nd = /需配新\s*desc/.test(r.why) ? '是' : '否';
  if (nd === '是') need++;
  if (dash) dashN++;
  if (!desc) missing++;
  out.push([
    ++i, r.id, r.name, r.old, rm ? rm._file : '❗未找到', desc, len(desc), dash, nd,
    r.why.replace(/\t/g, ' '),
  ].join('\t'));
}

const p = path.join(__dirname, '_out_62_desc_sheet.tsv');
fs.writeFileSync(p, out.join('\n') + '\n', 'utf8');
console.log('写入', p, fs.statSync(p).size, 'B /', out.length, '行');
console.log(`82 改名 − 20 已有全文 = ${rows.length} 间`);
console.log(`其中「需配新 desc」= ${need}；现 desc 含破折号 = ${dashN}；找不到房间 = ${missing}`);
