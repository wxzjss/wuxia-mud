const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const P = (f) => path.join(ROOT, f);

// Load all lines
function load(f) {
  return fs.readFileSync(P('.textaudit/' + f), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
}
const rooms = load('rooms.tsv').map(([id, name, desc]) => ({ kind: 'room', id, name, text: desc }));
const npcRaw = load('npcs.tsv').map((a) => ({ kind: a[0].toLowerCase(), id: a[1], who: a[2], text: a.slice(3).join('\t') }));
const questRaw = load('quests.tsv').map((a) => ({ kind: a[0].toLowerCase(), id: a[1], who: a[2] || '', text: a.slice(a.length === 2 ? 2 : 3).join('\t') }));

const ALL = [...rooms, ...npcRaw, ...questRaw];

// sanitize quest lines parsed loosely - qdesc has name+desc
const all = [];
for (const r of rooms) all.push(r);
for (const a of load('npcs.tsv')) {
  const kind = a[0], id = a[1], who = a[2], text = a[3] || '';
  all.push({ kind, id, who, text });
}
for (const a of load('quests.tsv')) {
  const kind = a[0];
  let id, who, text;
  if (kind === 'QDESC') { id = a[1]; who = a[2]; text = a[3] || ''; }
  else if (kind === 'ENDING' || kind === 'ACH') { id = a[1]; who = ''; text = a[2] || ''; }
  else { id = a[1]; who = ''; text = a[2] || ''; }
  all.push({ kind, id, who, text });
}

const RULES = [
  ['1-套话空话', /神秘莫测|危机四伏|命运的齿轮|一段传奇|传奇就此|江湖会记得|不可思议|不禁|不由得|仿佛|似乎|隐约|莫名的|说不出的|难以言喻|难以名状|令人(?:神往|向往|心悸|不安)|深不可测|高深莫测|别有洞天|世外桃源|美不胜收|叹为观止|叹为观止/],
  ['1b-仿佛似乎', /仿佛|似乎|好似|犹如|宛如/],
  ['2-说明书腔', /本游戏|你将扮演|你可以(?:在这里|与)|可以互动|可与其互动|点击|按钮|界面|菜单|请输入|属性栏|背包|系统提示/],
  ['3-排比对仗', /[^，。；]{1,8}、[^，。；]{1,8}、[^，。；]{1,8}、|既要[^。]{0,20}又要[^。]{0,20}(?:还要|更要)|三重境界|三个层次|无[^，。]{0,6}，无[^，。]{0,6}，无/],
  ['4-过度解释', /显然|意味着|这说明|由此可见|换言之|也就是说|可见|不难看出|正是|恰恰是/],
  ['5-现代翻译腔', /系统|属性|界面|任务(?!人)|风险|综合来看|值得一提的是|在这个世界上|一种[^，。]{0,6}的感觉|层面|维度|机制|流程|反馈|体验|氛围感|沉浸/],
  ['7-抽象形容无实体', /(?:气息|氛围|气势|韵味|意境|感觉|感受)(?:扑面而来|油然而生|迎面而来|十足|浓厚)/],
  ['passive被动', /被打动|被感染|被吸引|被震撼|被包裹|让人感到|使人感到|令人感到/],
];

const flags = new Map();
for (const item of all) {
  const hit = [];
  for (const [name, re] of RULES) {
    if (re.test(item.text || '')) hit.push(name);
  }
  if (hit.length) flags.set(item, hit);
}

// counts
const counts = {};
for (const [item, hit] of flags) for (const h of hit) counts[h] = (counts[h] || 0) + 1;
console.log('TOTAL lines scanned:', all.length);
console.log('FLAGGED lines:', flags.size, '(', (flags.size / all.length * 100).toFixed(1), '%)');
console.log('by rule:', JSON.stringify(counts, null, 0));

// by kind
const byKind = {};
for (const item of all) byKind[item.kind] = (byKind[item.kind] || 0) + 1;
const flagKind = {};
for (const [item] of flags) flagKind[item.kind] = (flagKind[item.kind] || 0) + 1;
console.log('total by kind:', JSON.stringify(byKind));
console.log('flagged by kind:', JSON.stringify(flagKind));

// dump flagged sorted by hit count
const sorted = [...flags.entries()].sort((a, b) => b[1].length - a[1].length);
const out = sorted.map(([item, hit]) => `${hit.length}\t${hit.join(',')}\t${item.kind}\t${item.id}\t${item.who || ''}\t${item.text}`).join('\n');
fs.writeFileSync(P('.textaudit/flagged.tsv'), out, 'utf8');
console.log('wrote flagged.tsv:', sorted.length, 'rooms flagged:', flagKind.room || 0);
