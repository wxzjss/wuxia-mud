/**
 * gather.js — 采集（第 4 批）
 *
 *  - 打水：所有水源房间，需背包有「容器」（陶罐/皮水囊/水葫芦等）
 *  - 尸体切割：动物（野兽）尸体 → 生肉/兽皮，需「利器」（tool 标签武器）
 *  - 生肉加工：客栈/酒楼把生肉/生鱼做成熟食
 *
 * 随机一律走 world.rng（可固定种子）。
 */
'use strict';

const { clamp } = require('./utils');

/* 水源识别：用「井/潭/溪/洲」等安全单字 + 「碧水/清泉/水声/江边/河边」等组合词。
   不能用裸「江/河/湖/泉」——会误匹配「江南」「河南」「泉州」等地名。 */
const WATER_RE = /井|潭|溪|洲|碧水|清泉|泉水|泉眼|水声|水源|湖边|河边|江边|溪边|湖畔|江河|水井/;
const KITCHEN_RE = /(tavern|wine|inn|酒楼|客栈|酒家|饭庄|醉仙楼|天香楼|望江楼|汉江楼)/;

/** 背包里有没有能盛水的容器 */
function hasContainer(world, p) {
  return (p.inventory || []).some(i => {
    const d = world.getItem(i.id);
    return d && (d.type === 'container' || (d.tags || []).includes('container'));
  });
}

/** 背包里有没有利器（tool 标签武器） */
function hasTool(world, p) {
  return (p.inventory || []).some(i => {
    const d = world.getItem(i.id);
    return d && (d.tags || []).includes('tool');
  });
}

/** 当前房间是不是水源 */
function isWaterRoom(world, roomId) {
  const room = world.getRoom(roomId);
  if (!room) return false;
  return WATER_RE.test((room.name || '') + (room.desc || ''));
}

/** 打水（需容器） */
function drawWater(world) {
  const p = world.player;
  if (!isWaterRoom(world, p.room)) {
    return { ok: false, lines: [{ kind: 'warn', text: '这里没有水可打。' }] };
  }
  if (!hasContainer(world, p)) {
    return { ok: false, lines: [{ kind: 'warn', text: '你两手空空，没有盛水的容器（陶罐 / 皮水囊 / 水葫芦之类）。' }] };
  }
  p.water = clamp(p.water + 80, 0, p.maxWater);
  world.advanceTime(10);
  return {
    ok: true, lines: [
      { kind: 'story', text: '你俯身用容器舀起清水，掬饮几口，清凉解渴。' },
      { kind: 'sys', text: '你打水解了渴（饮水 +80）。' },
    ],
  };
}

/** 切割尸体（需利器，只能切野兽） */
function butcher(world, corpseId) {
  const p = world.player;
  const corpse = world.instances && world.instances.corpses && world.instances.corpses[corpseId];
  if (!corpse) return { ok: false, lines: [{ kind: 'warn', text: '这里没有这具尸体。' }] };
  if (corpse.room !== p.room) return { ok: false, lines: [{ kind: 'warn', text: '这具尸体不在这里。' }] };
  if (corpse.kind !== 'beast') {
    return { ok: false, lines: [{ kind: 'warn', text: '这具尸身是个人。割尸取肉这等丧尽天良之事，你终究下不去手。' }] };
  }
  if (!hasTool(world, p)) {
    return { ok: false, lines: [{ kind: 'warn', text: '你需要一把利器（猎刀 / 剔骨尖刀之类）才能切割。' }] };
  }
  const rng = world.rng || Math.random;
  const gains = [];
  const meat = 2 + Math.floor((typeof rng === 'function' ? rng() : rng.next()) * 3); // 2~4 块生肉
  world.giveItem(p, 'raw_meat', meat);
  gains.push('生肉 x' + meat);
  if ((typeof rng === 'function' ? rng() : rng.next()) < 0.7) {
    world.giveItem(p, 'animal_pelt', 1);
    gains.push('兽皮 x1');
  }
  delete world.instances.corpses[corpseId];
  world.advanceTime(20);
  return {
    ok: true, lines: [
      { kind: 'story', text: '你抄起利器，三下五除二把这头畜生的尸身剖开。' },
      { kind: 'sys', text: `你得到了：${gains.join('、')}。` },
      { kind: 'hint', text: '生肉腥臊，须到客栈 / 酒楼「加工」成熟食才能安心吃。' },
    ],
  };
}

/** 生肉/生鱼加工成 熟食（客栈/酒楼） */
function cook(world) {
  const p = world.player;
  const room = world.getRoom(p.room);
  if (!room) return { ok: false, lines: [{ kind: 'warn', text: '这里没法加工吃食。' }] };
  if (!KITCHEN_RE.test((room.id || '') + '|' + (room.name || ''))) {
    return { ok: false, lines: [{ kind: 'warn', text: '你得去客栈或酒楼，才有灶火加工吃食。' }] };
  }
  const raw = (p.inventory || []).find(i => i.id === 'raw_meat' || i.id === 'raw_fish');
  if (!raw) return { ok: false, lines: [{ kind: 'warn', text: '你身上没有生肉 / 生鱼可加工。' }] };
  const cookedId = raw.id === 'raw_meat' ? 'cooked_meat' : 'cooked_fish';
  const fee = 5;
  if (p.money < fee) return { ok: false, lines: [{ kind: 'warn', text: `加工需 ${fee} 文钱，你不够。` }] };
  p.money -= fee;
  world.removeItem(p, raw.id, 1);
  world.giveItem(p, cookedId, 1);
  world.advanceTime(15);
  const rawName = (world.getItem(raw.id) || {}).name || '生食';
  const cookedName = (world.getItem(cookedId) || {}).name || '熟食';
  return {
    ok: true, lines: [
      { kind: 'story', text: `你把${rawName}交给厨下，灶火一撩，不多时便端出一份热腾腾的${cookedName}。` },
      { kind: 'sys', text: `加工费 ${fee} 文。` },
    ],
  };
}

module.exports = { WATER_RE, KITCHEN_RE, hasContainer, hasTool, isWaterRoom, drawWater, butcher, cook };
