/**
 * gen-brothels.js — 第 3 批：给各城市生成青楼房间（差异化）
 *
 * 幂等：青楼房间已存在则跳过；街道出口已连则跳过。
 * 青楼玩法（卖身/接客/赎身）由 work.js + commands.js 提供，NPC 生态留待第 5 批。
 *
 * 用法：node tools/gen-brothels.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const MAP = path.join(__dirname, '..', 'game', 'data', '50_map.json');
const data = JSON.parse(fs.readFileSync(MAP, 'utf8'));
const rooms = data.rooms;

/** 每城一座青楼：街道 + 上楼方向（u），青楼下楼（d）回到街道 */
const BROTHELS = [
  {
    street: 'jiangnan_street', id: 'jiangnan_brothel',
    name: '江南城·怡红院', region: 'jiangnan',
    desc: '粉墙黛瓦的临水小楼，檐下悬着两串红灯笼，丝竹管弦声隔水传来。几个浓妆艳抹的女子倚着栏杆，摇着团扇朝街心娇笑。',
  },
  {
    street: 'luoyang_street', id: 'luoyang_brothel',
    name: '洛阳城·牡丹阁', region: 'luoyang',
    desc: '朱门绣户，金匾高悬「牡丹阁」三字。满园牡丹开得灼灼，进出的皆是锦衣华服的贵人，一派富贵风流气象。',
  },
  {
    street: 'changan_street', id: 'changan_brothel',
    name: '长安城·平康坊', region: 'changan',
    desc: '天下第一等的风月场。坊中曲径通幽，楼阁参差，丝竹之声不绝，五陵年少、胡商胡姬混杂其间，纸醉金迷。',
  },
  {
    street: 'chengdu_street', id: 'chengdu_brothel',
    name: '成都府·翠云楼', region: 'chengdu',
    desc: '竹影婆娑里一座两层小楼，挂着「翠云」的绿绸招子。堂中茶香与脂粉香混作一处，姑娘们软语轻声，闲适慵懒。',
  },
  {
    street: 'xiangyang_street', id: 'xiangyang_brothel',
    name: '襄阳城·凤来仪', region: 'xiangyang',
    desc: '边城要塞里的温柔乡。楼名「凤来仪」，往来多是行伍中的将官与南来北往的客商，酒酣耳热，嗓门洪亮。',
  },
];

let created = 0, linked = 0;
for (const b of BROTHELS) {
  const street = rooms[b.street];
  if (!street) { console.log('⚠ 找不到街道', b.street); continue; }

  // 1) 建青楼房间
  if (!rooms[b.id]) {
    rooms[b.id] = {
      id: b.id, name: b.name, region: b.region, desc: b.desc,
      exits: { d: b.street },
      actions: [
        { label: '卖身', cmd: 'sellbody', keywords: ['卖身', '挂牌', '画押'], desc: '卖身青楼，换一笔银钱（仅女子）' },
        { label: '接客', cmd: 'serve', keywords: ['接客', '应酬'], desc: '应酬客人攒赎身钱（须卖身后）' },
        { label: '赎身', cmd: 'redeem', keywords: ['赎身', '脱籍'], desc: '凑钱赎回身子（须卖身后）' },
      ],
    };
    created++;
  }

  // 2) 街道上楼（u）连到青楼
  if (!street.exits) street.exits = {};
  if (street.exits.u !== b.id) {
    street.exits.u = b.id;
    linked++;
  }
}

fs.writeFileSync(MAP, JSON.stringify(data, null, 2));
console.log(`青楼房间新建 ${created} 座，街道出口连接 ${linked} 条。`);
for (const b of BROTHELS) {
  console.log('  ', b.id, '|', b.name, '| 街道', b.street, '↑');
}
