const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const Q = J('game/data/60_quests.json').quests;
const N = J('game/data/40_npcs.json').npcs;
const M = J('game/data/50_map.json').rooms;
const IT = J('game/data/20_items.json').items;
const npcNames = new Set(Object.values(N).map((n) => n.name).filter(Boolean));
const itemNames = new Set(Object.values(IT).map((i) => i.name).filter(Boolean));
const itemIds = new Set(Object.keys(IT));

/* 房间室内判定：名字/关键词 */
const INDOOR = /客栈|酒楼|雅间|茶馆|茶棚|铺|坊|宅|府|院|堂|厅|阁|楼|庙|寺|观|庵|殿|库|房|牢|狱|馆|斋|轩|居|棚|屋|室|巢|窑|局|栈|市|巷|街/;
const OUTDOOR_SEEMS = /山|坡|林|道|路|野|谷|潭|洞|崖|湖|江|河|海|滩|原|岭|谷|口|场/;

console.log('=== 全部任务的 stage0 目标 kind 分布（60_quests）===');
const kinds = {};
for (const q of Object.values(Q)) {
  const t = (q.stages && q.stages[0] && q.stages[0].targets && q.stages[0].targets[0]) || null;
  const k = t ? t.kind : '(none)';
  kinds[k] = (kinds[k] || 0) + 1;
}
console.log(JSON.stringify(kinds));

console.log('\n=== 非 room 类 stage0 目标的任务（前 60）===');
for (const [qid, q] of Object.entries(Q)) {
  const t = (q.stages && q.stages[0] && q.stages[0].targets && q.stages[0].targets[0]) || null;
  if (!t || t.kind === 'room') continue;
  console.log(`  ${qid} [${q.type}] kind=${t.kind} key=${t.key} | desc=${q.desc}`);
  console.log(`      stage0="${q.stages[0].desc}" | t.desc="${t.desc || ''}"`);
}

console.log('\n=== 采药/采买类：stage0.desc 里出现的「物」是否是真物品 ===');
for (const [qid, q] of Object.entries(Q)) {
  const s0 = (q.stages[0] && q.stages[0].desc) || '';
  const m = /采(?:三|一|两|五)?株?([\u4e00-\u9fa5]{2,4})/.exec(s0);
  if (!m) continue;
  const x = m[1];
  const isNpc = npcNames.has(x);
  const isItem = itemNames.has(x) || itemIds.has(x);
  if (!isItem) console.log(`  ${qid} | 取到「${x}」 NPC名?=${isNpc} 物品名?=${isItem} | stage0="${s0}"`);
}

console.log('\n=== 送信/寻人类：被点名的人是否是真 NPC 名 ===');
for (const [qid, q] of Object.entries(Q)) {
  const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
  const cands = [];
  let m;
  const re1 = /旧识([\u4e00-\u9fa5]{2,6})/g; while ((m = re1.exec(txt))) cands.push(['旧识', m[1]]);
  const re2 = /捎给([\u4e00-\u9fa5]{2,8})/g; while ((m = re2.exec(txt))) cands.push(['捎给', m[1]]);
  const re3 = /送到([\u4e00-\u9fa5]{2,8})手上/g; while ((m = re3.exec(txt))) cands.push(['送到', m[1]]);
  for (const [tag, x] of cands) {
    if (!npcNames.has(x)) console.log(`  ${qid} | ${tag}「${x}」 不是 NPC 名 | ${txt.slice(0, 70)}`);
  }
}

console.log('\n=== 除害类：目标房间是否室内 ===');
for (const [qid, q] of Object.entries(Q)) {
  if (!/野兽/.test(q.desc || '')) continue;
  const t = q.stages[0].targets[0];
  const r = M[t.key]; if (!r) { console.log(`  ${qid} 目标房不存在 ${t.key}`); continue; }
  const name = r.name || '';
  if (INDOOR.test(name) && !OUTDOOR_SEEMS.test(name)) console.log(`  ${qid} | 目标=${t.key}「${name}」 desc="${q.desc}"`);
}
