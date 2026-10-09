/**
 * gen-quests-fix.js — 重新生成 310 条支线的 desc（修正「接收人当主语」的 bug）
 *
 * 原 bug：desc 是「<接收人>托你送信…」，把接收人当成了委托人。
 * 修正：desc = 「<giver>托你送信给<接收人>…」。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const npcDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '40_npcs.json'), 'utf8'));
const npcs = npcDoc.npcs || npcDoc;
const questDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), 'utf8'));
const quests = questDoc.quests;

const SIDE_TPL = [
  { key: 'errand', cn: '送信', desc: '托你把一封信送到%s手上。', stages: ['把信送到%s手上', '回去复命'] },
  { key: 'find', cn: '寻人', desc: '让你帮忙找一位久未联系的旧识%s。', stages: ['在%s一带打听消息', '找到%s，把话带到'] },
  { key: 'fetch', cn: '采买', desc: '要你替他跑腿买些日用杂货。', stages: ['去集市买些日用杂货', '把东西交回给%s'] },
  { key: 'herb', cn: '采药', desc: '家里有人病了，缺一味药。', stages: ['去山里采三株%s', '把药材交回'] },
  { key: 'beast', cn: '除害', desc: '近来有野兽作乱，请你出手。', stages: ['杀掉%s', '回去报信'] },
  { key: 'debt', cn: '讨债', desc: '有笔旧账要不回来，想请你出面。', stages: ['找到欠债的%s', '把债讨回来'] },
  { key: 'lost', cn: '寻物', desc: '丢了件要紧物事，急得团团转。', stages: ['在%s附近找找', '把东西交还'] },
  { key: 'escort', cn: '护送', desc: '要出趟远门，路上不太平。', stages: ['护送到%s', '平安抵达'] },
  { key: 'rumor', cn: '打探', desc: '想让你去打听一桩旧事。', stages: ['去%s打听', '回来告诉他打听到的'] },
  { key: 'avenge', cn: '了结', desc: '有桩恩怨压在心里多年。', stages: ['教训%s', '回来复命'] },
];

let fixed = 0;
for (const qid of Object.keys(quests)) {
  if (!/^sq_/.test(qid)) continue;
  const q = quests[qid];
  const giver = npcs[q.giver];
  if (!giver) continue;
  // 判断模板类型（从 name 后缀）
  const tpl = SIDE_TPL.find(t => q.name.endsWith(t.cn)) || SIDE_TPL[0];
  // 接收人 = giver 的第一个关系对象
  const other = (giver.rel && giver.rel.length) ? npcs[giver.rel[0].id] : null;
  const otherName = other ? other.name : '镇上的人';
  const targetRoom = other ? other.room : giver.room;

  q.desc = giver.name + tpl.desc.replace('%s', otherName);
  // 修 stages 描述（把接收人嵌对位置）
  const stage0 = tpl.stages[0].replace('%s', otherName);
  const stage1 = tpl.stages[1].replace('%s', otherName);
  if (q.stages && q.stages[0]) {
    q.stages[0].desc = stage0;
    if (q.stages[0].targets && q.stages[0].targets[0]) {
      q.stages[0].targets[0].desc = stage0;
      q.stages[0].targets[0].key = targetRoom;
    }
  }
  if (q.stages && q.stages[1]) q.stages[1].desc = stage1;
  fixed++;
}

fs.writeFileSync(path.join(ROOT, 'game', 'data', '60_quests.json'), JSON.stringify(questDoc, null, 2));
console.log(`重写支线 desc ${fixed} 条。`);
