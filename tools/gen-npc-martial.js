/* ============================================================
 * gen-npc-martial.js — NPC 武学丰富化（design/40 §8）
 *   产出 game/data/77_npc_martial.json
 *
 * 主人原话：「既然武学变这么普遍了，理应给 NPC 武学丰富一下」。
 * 规则：
 *   · 已经有 sect 的（门派弟子/掌门）**不动** —— 他们的武学由门派那一套给足了；
 *   · 其余 NPC 按「描述/名字里的行当」分配 **江湖大众武学**（jh_* / jh2_* / cn_*），
 *     等级压在低档（10~60），只求「他确实会两手」，不为难玩家的战斗体验。
 * ⚠️ 只写 77_npc_martial.json 一个文件；skills/learned 是对象，按键合并。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'game', 'data', '77_npc_martial.json');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

const e0 = new GameEngine({ seed: 20261011 });
/* 先删掉自己的旧产物再 boot —— 否则第二次运行读到的「已有武学」里
   有一半是自己上次写的，增量会一路缩到 0（看起来像「全都配过了」）。 */
try { fs.unlinkSync(OUT); } catch (e) { /* 首次运行没有 */ }
e0.boot();
const w0 = e0.world;
const SK = w0.data.skills;

/* 行当 → 该会什么（槽位: 武学 id，以及练到什么火候） */
const TRADES = [
  { re: /剑客|剑术|剑法|剑师|使剑/, skills: { 剑: 'jh_sword', 内功: 'jh_neigong' }, lv: 40 },
  { re: /刀客|刀手|刀法|使刀|刀师/, skills: { 刀: 'jh_blade', 内功: 'jh_neigong' }, lv: 40 },
  { re: /镖|趟子手|走镖/, skills: { 刀: 'cn_hidden_blade', 招架: 'jh_parry', 内功: 'jh_neigong' }, lv: 35 },
  { re: /僧|和尚|比丘|沙弥|尼|师太|方丈/, skills: { 拳: 'jh_fist', 内功: 'jh_neigong', 招架: 'jh_parry' }, lv: 38 },
  { re: /道士|道姑|真人|道长/, skills: { 剑: 'jh_sword', 轻功: 'jh_dodge', 内功: 'jh_neigong' }, lv: 38 },
  { re: /捕快|捕头|衙役|差役|公差/, skills: { 棍: 'jh_staff', 招架: 'jh_parry' }, lv: 30 },
  { re: /掌柜|商人|伙计|小贩|货郎|茶博士/, skills: { 拳: 'cn_long_fist' }, lv: 20 },
  { re: /渔|船|水手|纤夫|艄公/, skills: { 棍: 'bang_wharf_staff', 轻功: 'jh_dodge' }, lv: 28 },
  { re: /猎户|猎人|樵夫|农夫|庄客/, skills: { 棍: 'jh_staff', 拳: 'jh_fist' }, lv: 26 },
  { re: /乞丐|叫花|丐/, skills: { 棍: 'jh_staff', 轻功: 'jh_dodge' }, lv: 32 },
  { re: /护院|家丁|庄丁|看家/, skills: { 拳: 'jh_fist', 招架: 'jh_parry' }, lv: 24 },
  { re: /女侠|姑娘|妇人|女子/, skills: { 剑: 'jh_sword', 轻功: 'jh_dodge' }, lv: 30 },
  { re: /书生|秀才|先生|账房|师爷/, skills: { 拳: 'cn_long_fist', 内功: 'jh_neigong' }, lv: 22 },
  { re: /药|郎中|大夫|医/, skills: { 内功: 'cn_breath_art', 拳: 'jh_fist' }, lv: 25 },
  { re: /屠|屠夫|肉/, skills: { 刀: 'jh_blade' }, lv: 30 },
  { re: /铁匠|石匠|木匠|工匠/, skills: { 拳: 'jh_fist', 棍: 'jh_staff' }, lv: 28 },
];
/* 默认：只给最粗浅的拳脚 —— 别默认塞内功（那会让「书生没练过内功」这类判据失去意义） */
const DEFAULT_TRADE = { skills: { 拳: 'jh_fist' }, lv: 18 };
/* 兵刃槽 → 该配的兵器 */
const BLADE_ITEM = { 剑: 'fine_sword', 刀: 'iron_blade', 棍: 'bamboo_stick', 鞭: 'long_whip' };

const out = {};
let touched = 0, skipped = 0;
for (const n of Object.values(w0.data.npcs)) {
  if (n.isPlayer) continue;
  /* 门派的人不动（他们那套已经齐了）；已经有武学的也不覆盖 */
  if (n.sect) { skipped++; continue; }
  if (n.skills && Object.keys(n.skills).some(k => n.skills[k])) { skipped++; continue; }
  const text = `${n.name || ''} ${n.title || ''} ${n.desc || ''} ${n.tag || ''}`;
  const trade = TRADES.find(t => t.re.test(text)) || DEFAULT_TRADE;
  const skills = {}, learned = {};
  for (const slot of Object.keys(trade.skills)) {
    const id = trade.skills[slot];
    if (!SK[id]) continue;
    skills[slot] = id;
    learned[id] = { level: Math.max(5, Math.round(trade.lv * (0.6 + ((n.id || '').length % 5) * 0.1))) };
  }
  if (!Object.keys(skills).length) continue;
  /* 兵刃系招式必须配得上对应兵器，否则 weaponPenalty 给 ×0.45 —— 他等于白练 */
  const blade = Object.keys(skills).find(k => BLADE_ITEM[k]);
  out[n.id] = blade
    ? { skills, learned, equipment: Object.assign({}, n.equipment, { 武器: BLADE_ITEM[blade] }) }
    : { skills, learned };
  touched++;
}

/* 第二遍：把**兵刃与招式**对齐（学刀却拎着剑这类老账）。
   谁是准？**武器是准** —— 人物设定里写着他拿什么，就让他会什么；
   反过来把武器换成招式那样，会把一个「剑客」改成「刀客」，人设就崩了。
   · 有武器 → 招式迁就到武器那一系（basic_blade → basic_sword，同档次平移）
   · 没武器 → 按招式补一把
   只动基础数据里的 NPC；mod 的人归 mod 管，别越界。 */
let fixed = 0;
const ALT = {
  basic_blade: 'basic_sword', jh_blade: 'jh_sword', basic_staff: 'basic_sword',
  jh_staff: 'jh_sword', bang_wharf_staff: 'jh_sword', basic_sword: 'basic_sword', jh_sword: 'jh_sword',
};
for (const n of Object.values(w0.data.npcs)) {
  if (n.isPlayer || n.sect) continue;
  if (!/^基础数据/.test(n.__source || '')) continue;
  const slots = Object.keys(n.skills || {}).filter(k => BLADE_ITEM[k] && n.skills[k]);
  if (!slots.length) continue;
  const have = (n.equipment || {})['武器'];
  const haveDef = have ? w0.getItem(have) : null;
  const wpnType = haveDef && haveDef.weaponType;
  if (wpnType && BLADE_ITEM[wpnType]) {
    if (slots[0] === wpnType) continue;                      // 已经一致，别动
    const oldId = n.skills[slots[0]];
    const newId = ALT[oldId] || 'jh_sword';
    if (!SK[newId]) continue;
    const skills = Object.assign({}, n.skills);
    delete skills[slots[0]];
    skills[wpnType] = newId;
    const learned = Object.assign({}, n.learned || {});
    if (learned[oldId]) { learned[newId] = learned[oldId]; delete learned[oldId]; }
    out[n.id] = Object.assign({}, out[n.id], { skills, learned });
    fixed++;
  } else {
    out[n.id] = Object.assign({}, out[n.id], {
      equipment: Object.assign({}, n.equipment, { 武器: BLADE_ITEM[slots[0]] }),
    });
    fixed++;
  }
}
console.log('（其中兵刃/招式对齐：' + fixed + ' 人）');

fs.writeFileSync(OUT, JSON.stringify({ npcs: out }, null, 2) + '\n', 'utf8');
console.log('写入', OUT);
console.log('补了武学的 NPC：', touched, '；跳过（门派/已有武学）：', skipped);
