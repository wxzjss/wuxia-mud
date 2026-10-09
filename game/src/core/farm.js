/**
 * farm.js — 农田（第 4 批）
 *
 *  - 买地（田头佃户家 / 窝棚，200 文）
 *  - 种植（稻种 / 菜种 → 种下 → 生长）
 *  - 收割（成熟后收成稻米 / 青菜）
 *  - 偷庄稼（偷别人田，被发现 → 通缉度 +1）
 */
'use strict';

const FARM_RE = /田|农田|稻田|菜地|田埂/;
const GROW_MIN = { seed_rice: 4320, seed_vegetable: 1440 }; // 3 天 / 1 天
const HARVEST_ITEM = { seed_rice: 'rice', seed_vegetable: 'vegetable' };
const HARVEST_N = { seed_rice: 4, seed_vegetable: 5 };
const LAND_PRICE = 200;

function isFarmRoom(world, roomId) {
  const room = world.getRoom(roomId);
  return !!room && FARM_RE.test(room.name || '');
}

/** BFS 找离 fromRoom 最近的农田房间 */
function nearestFarm(world, fromRoom) {
  const seen = new Set([fromRoom]);
  const q = [fromRoom];
  while (q.length) {
    const id = q.shift();
    const room = world.getRoom(id);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && world.getRoom(t) && !seen.has(t)) {
        if (isFarmRoom(world, t)) return t;
        seen.add(t);
        q.push(t);
      }
    }
  }
  return null;
}

/** 买地（田头佃户家 / 窝棚） */
function buyLand(world) {
  const p = world.player;
  const room = world.getRoom(p.room);
  if (!room || !/佃户|窝棚|田头/.test(room.name || '')) {
    return { ok: false, lines: [{ kind: 'warn', text: '你得去田头的佃户家或窝棚，才能谈买地。' }] };
  }
  if (p.farm && p.farm.plot) return { ok: false, lines: [{ kind: 'warn', text: '你已有一块田，贪多嚼不烂。' }] };
  if (p.money < LAND_PRICE) return { ok: false, lines: [{ kind: 'warn', text: `买地需 ${LAND_PRICE} 文，你不够。` }] };
  p.money -= LAND_PRICE;
  const plot = nearestFarm(world, p.room) || 'jn_farm_1';
  p.farm = { plot, seedId: null, plantedAt: 0 };
  return {
    ok: true, lines: [
      { kind: 'story', text: `你与佃户说定，花 ${LAND_PRICE} 文买下一块${(world.getRoom(plot) || {}).name || '田'}，从此也是有田的人了。` },
      { kind: 'hint', text: '到自家田里「种植 <稻种|菜种>」，成熟后「收割」。' },
    ],
  };
}

/** 种植 */
function plant(world, seedId) {
  const p = world.player;
  if (!p.farm || !p.farm.plot) return { ok: false, lines: [{ kind: 'warn', text: '你还没有田，先去田头「买地」。' }] };
  if (p.room !== p.farm.plot) return { ok: false, lines: [{ kind: 'warn', text: '你得在自己那块田里种植。' }] };
  if (p.farm.seedId) return { ok: false, lines: [{ kind: 'warn', text: '田里已经种着东西了（先「收割」再说）。' }] };
  if (!GROW_MIN[seedId]) return { ok: false, lines: [{ kind: 'warn', text: '这不能当种子种。' }] };
  if (!(p.inventory || []).some(i => i.id === seedId)) return { ok: false, lines: [{ kind: 'warn', text: '你身上没有这种子。' }] };
  world.removeItem(p, seedId, 1);
  p.farm.seedId = seedId;
  p.farm.plantedAt = world.clockMinutes;
  const growDays = GROW_MIN[seedId] / 1440;
  return {
    ok: true, lines: [
      { kind: 'story', text: '你弯腰把种子点进土里，浇了水，盼着它生根发芽。' },
      { kind: 'sys', text: `约需 ${growDays.toFixed(1)} 天（游戏时间）长成。` },
    ],
  };
}

/** 收割 */
function harvest(world) {
  const p = world.player;
  if (!p.farm || !p.farm.plot || !p.farm.seedId) return { ok: false, lines: [{ kind: 'warn', text: '田里还没种东西（先「种植」）。' }] };
  if (p.room !== p.farm.plot) return { ok: false, lines: [{ kind: 'warn', text: '你得在自己那块田里收割。' }] };
  const grow = GROW_MIN[p.farm.seedId];
  const elapsed = world.clockMinutes - p.farm.plantedAt;
  if (elapsed < grow) {
    const remain = Math.round((grow - elapsed) / 1440 * 10) / 10;
    return { ok: false, lines: [{ kind: 'warn', text: `庄稼还没长成（约还需 ${remain} 天）。` }] };
  }
  const itemId = HARVEST_ITEM[p.farm.seedId];
  const n = HARVEST_N[p.farm.seedId];
  world.giveItem(p, itemId, n);
  const name = (world.getItem(itemId) || {}).name || itemId;
  p.farm.seedId = null;
  p.farm.plantedAt = 0;
  world.advanceTime(30);
  return {
    ok: true, lines: [
      { kind: 'story', text: '庄稼成熟了！你卷起袖子忙活半天，把收成归了仓。' },
      { kind: 'sys', text: `你收获了 ${name} x${n}。` },
      { kind: 'hint', text: '还想再种，就备好稻种/菜种（「种植 <稻种|菜种>」）。' },
    ],
  };
}

/** 偷庄稼（偷别人田，被发现 → 通缉） */
function stealCrop(world) {
  const p = world.player;
  const room = world.getRoom(p.room);
  if (!room || !FARM_RE.test(room.name || '')) {
    return { ok: false, lines: [{ kind: 'warn', text: '这里没有庄稼可偷。' }] };
  }
  if (p.farm && p.farm.plot === p.room) {
    return { ok: false, lines: [{ kind: 'warn', text: '这是你自己的田，还偷什么。' }] };
  }
  const roll = world.rng ? world.rng.next() : Math.random();
  const caught = roll < 0.4; // 40% 被发现
  if (caught) {
    p.wanted = (p.wanted || 0) + 1;
    world.advanceTime(10);
    return {
      ok: false, lines: [
        { kind: 'warn', text: '你刚掰下几根青菜，田主就提着锄头从窝棚里冲了出来：「好个偷庄稼的贼！」' },
        { kind: 'sys', text: '你被逮个正着，通缉度 +1（官府已记下你的模样）。' },
      ],
    };
  }
  world.giveItem(p, 'vegetable', 2);
  world.advanceTime(15);
  return {
    ok: true, lines: [
      { kind: 'story', text: '你猫着腰溜进田里，飞快掰了几把青菜，趁着没人发觉溜之大吉。' },
      { kind: 'sys', text: '你偷到了青菜 x2。' },
    ],
  };
}

module.exports = { FARM_RE, GROW_MIN, isFarmRoom, nearestFarm, buyLand, plant, harvest, stealCrop };
