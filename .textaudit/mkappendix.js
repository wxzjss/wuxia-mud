const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(ROOT, '.textaudit/changes.md'), 'utf8');
const head = [
  '# 附录 · 玩家可见文本「改前 → 改后」全量对照（TEXT-HUMANIZE）',
  '',
  '> 由 `.textaudit/mkchanges.js` 从「改写前数据快照」与「落盘后数据」逐条比对生成，**不是手抄**，工程/验收可照此逐条核对。',
  '> 字段口径：房间 `rooms.*.desc`；NPC `npcs.*.desc` / `npcs.*.talk` / `npcs.*.askDefault`；任务 `quests.*.desc` / `quests.*.stages[].desc` / `quests.*.rewards[].raw`。',
  '> 规模：87 间房间 desc · 14 个具名 NPC desc · 288 个模板 NPC 台词（33 组原型）· 1 处台词泄漏修正 · 262 条模板任务 desc · 26 条具名任务 desc · 22 条任务收尾 say · 2 条阶段 desc。',
  '',
].join('\n');
fs.writeFileSync(path.join(ROOT, 'design/30b-text-humanize-changes.md'), head + body, 'utf8');
console.log('wrote design/30b-text-humanize-changes.md bytes=', (head + body).length);
