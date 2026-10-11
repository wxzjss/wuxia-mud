/**
 * auction.js — 拍卖行（design/40 §6.3，主人点名要的新系统）
 *
 * 形态：
 *   · 各大城的市集设「拍卖行」（房间数据里打 `auctionHouse: true` 标记）
 *   · 每 `intervalDays`（默认 3）游戏日开一场，当期 12 件：固定池 + 高价值位
 *   · 高价值位按**品级加权**抽取（越小的品级越稀罕），抽到武学就出「书」
 *   · 玩家 `bid <价>` 竞拍；NPC 按自己心里的价位跟价，不跟就落槌
 *   · `consign <物品> [保底价]` 寄拍高价值物，下期由拍卖行代卖，落槌扣 8% 手续费
 *
 * ⚠️ 状态挂在 `world.auctionState` 上（按场次懒生成），不进存档的玩家对象 ——
 *    这样「同一场次里所有人看到的拍品是同一批」，而不是各人一套。
 */
'use strict';

const DAY_MIN = 1440;

function cfg(world) { return world.data.auction || {}; }

function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY_MIN) + 1; }

/** 当期场次号（每 intervalDays 天一换） */
function sessionOf(world) {
  const iv = Math.max(1, cfg(world).intervalDays || 3);
  return Math.floor((dayOf(world) - 1) / iv);
}

/** 剩余几天开下一场 */
function daysToNext(world) {
  const iv = Math.max(1, cfg(world).intervalDays || 3);
  return iv - ((dayOf(world) - 1) % iv);
}

function weightedGrade(rng, table) {
  const rows = Array.isArray(table) && table.length ? table : [{ grade: 5, w: 1 }];
  let total = 0;
  for (const r of rows) total += (r.w || 0);
  let x = rng.next() * total;
  for (const r of rows) { x -= (r.w || 0); if (x <= 0) return r.grade; }
  return rows[rows.length - 1].grade;
}

/** 按品级找一本武学书（书本 teach 指向该品级的武学）
 *  ⚠️ 抽到的品级不一定有现成的书（新补的 6/7/8 品武学暂时没印书）——
 *     那就退到**最接近的品级**，别整档落空。返回 { id, grade }。 */
function bookOfGrade(world, grade) {
  const books = world.data.books || {};
  const cands = [];
  for (const b of Object.values(books)) {
    const sk = b && b.teach && world.data.skills[b.teach];
    if (sk && sk.grade) cands.push({ id: b.id, grade: sk.grade });
  }
  if (!cands.length) return null;
  let best = cands[0], bestD = 99;
  for (const c of cands) {
    const d = Math.abs(c.grade - grade);
    if (d < bestD || (d === bestD && c.grade < best.grade)) { best = c; bestD = d; }
  }
  return best;
}

function makeLot(world, id, def, isHigh) {
  const rng = world.rng;
  const base = Math.max(50, Math.round((def.value || 200) * (isHigh ? 1.25 : 1)));
  return {
    id: 'lot_' + id + '_' + Math.floor(rng.next() * 1e6),
    item: id,
    name: def.name || id,
    desc: def.desc || '',
    isHigh: !!isHigh,
    startPrice: base,
    price: base,
    step: Math.max(1, Math.ceil(base * (cfg(world).minRaise || 0.05))),
    estValue: Math.round(base * (isHigh ? 1.6 : 1.2)),
    leader: null,        // 'you' | NPC 名
    leaderName: null,
    sold: false,
    soldTo: null,
  };
}

/** 开一场（懒生成，按场次缓存；旧场次直接丢弃） */
function ensureSession(world) {
  const s = sessionOf(world);
  let st = world.auctionState;
  if (st && st.session === s) return st;
  st = world.auctionState = { session: s, lots: [], cursor: 0, consignments: [], news: [] };
  const c = cfg(world);
  const rng = world.rng;
  // 固定池
  const pool = (c.pool || []).slice();
  const n = Math.max(1, (c.slots || 12) - (c.highSlots || 2));
  for (let i = 0; i < n && pool.length; i++) {
    const k = Math.floor(rng.next() * pool.length);
    const id = pool.splice(k, 1)[0];
    const def = world.getItem(id);
    if (!def) continue;
    st.lots.push(makeLot(world, id, def, false));
  }
  // 高价值位：先按品级抽武学书，抽不到再落到珍稀品池
  const highItems = (c.highItems || []).slice();
  for (let i = 0; i < (c.highSlots || 2); i++) {
    const g = weightedGrade(rng, c.highPool);
    const pick = bookOfGrade(world, g);
    if (pick && rng.next() < 0.5) {
      const def = (world.data.books || {})[pick.id];
      if (def) { const lot = makeLot(world, pick.id, def, true); lot.grade = pick.grade; st.lots.push(lot); continue; }
    }
    if (highItems.length) {
      const k = Math.floor(rng.next() * highItems.length);
      const id = highItems.splice(k, 1)[0];
      const def = world.getItem(id);
      if (def) { const lot = makeLot(world, id, def, true); st.lots.push(lot); continue; }
    }
  }
  // 上期寄拍结算
  if (Array.isArray(world._pendingConsign) && world._pendingConsign.length) {
    let gold = 0, lines = [];
    for (const cg of world._pendingConsign) {
      const def = world.getItem(cg.item) || (world.data.books || {})[cg.item] || {};
      const sold = rng.next() < 0.75;   // 七成五能出手
      if (sold) {
        const price = Math.round((def.value || 300) * (0.9 + rng.next() * 0.5));
        const net = Math.round(price * (1 - (cfg(world).feeRate || 0.08)));
        gold += net;
        lines.push(`你寄拍的${def.name || cg.item}落槌 ${price} 文，扣去佣金到手 ${net} 文。`);
      } else {
        const fee = Math.round((def.value || 300) * (cfg(world).listingFee || 0.02));
        gold -= fee;
        lines.push(`你寄拍的${def.name || cg.item}流拍了，上架费 ${fee} 文。`);
      }
    }
    world._pendingConsign = [];
    if (gold) { world.giveMoney && world.giveMoney(gold) || (world.player.money = Math.max(0, (world.player.money || 0) + gold)); }
    st.news = lines;
  }
  return st;
}

/** 当前正在拍的这一件 */
function currentLot(world) {
  const st = ensureSession(world);
  while (st.cursor < st.lots.length && st.lots[st.cursor].sold) st.cursor++;
  return st.lots[st.cursor] || null;
}

/** NPC 跟价：出价超过他心里的价位就不跟了 */
function npcRespond(world, lot) {
  const rng = world.rng;
  if (lot.price * (1 + (cfg(world).minRaise || 0.05)) > lot.estValue) return false;
  if (rng.next() < 0.55) {
    lot.price = Math.ceil(lot.price * (1 + (cfg(world).minRaise || 0.05)));
    lot.leader = 'npc';
    lot.leaderName = ['洛阳的富商', '路过的镖头', '一个戴斗笠的人', '江南来的客商', '本地的老掌柜'][Math.floor(rng.next() * 5)];
    return true;
  }
  return false;
}

/**
 * 出价。
 * @returns {ok, lines[]}
 */
function bid(world, ch, price) {
  const lot = currentLot(world);
  if (!lot) return { ok: false, lines: [{ kind: 'warn', text: '本期拍品已经拍完了，下一场再来。' }] };
  const p = world.player;
  if (!Number.isFinite(price) || price <= 0) return { ok: false, lines: [{ kind: 'warn', text: '你得说个数。' }] };
  const min = lot.leader ? lot.price + lot.step : lot.price;
  if (price < min) return { ok: false, lines: [{ kind: 'warn', text: `当前价 ${lot.price} 文，加价不得少于 ${lot.step} 文。` }] };
  if ((p.money || 0) < price) return { ok: false, lines: [{ kind: 'warn', text: `你身上只有 ${p.money || 0} 文，出不起这个价。` }] };
  lot.price = price; lot.leader = 'you'; lot.leaderName = '你';
  const lines = [{ kind: 'sys', text: `你出价 ${price} 文。` }];
  if (npcRespond(world, lot)) {
    lines.push({ kind: 'say', text: `${lot.leaderName}跟着抬到了 ${lot.price} 文。` });
    return { ok: true, lines };
  }
  // 无人再加 → 落槌
  lot.sold = true; lot.soldTo = 'you';
  p.money -= lot.price;
  const res = world.giveItem(p, lot.item, 1);
  lines.push({ kind: 'sys', text: `“${lot.price} 文，成交！” —— 你拍下了${lot.name}。` });
  if (res && !res.ok) {
    lines.push({ kind: 'warn', text: `（你的行囊装不下，${lot.name}暂存在拍卖行柜上。）` });
  }
  return { ok: true, lines };
}

/** 寄拍 */
function consign(world, ch, keyword, reserve) {
  const p = world.player;
  const c = cfg(world);
  const inv = p.inventory || [];
  const hit = inv.find(i => {
    const id = (i && typeof i === 'object') ? i.id : i;
    const d = world.getItem(id);
    return d && (d.name === keyword || d.name.indexOf(keyword) >= 0 || id === keyword);
  });
  if (!hit) return { ok: false, lines: [{ kind: 'warn', text: `你身上没有「${keyword}」。` }] };
  const id = (hit && typeof hit === 'object') ? hit.id : hit;
  const def = world.getItem(id);
  if ((def.value || 0) < (c.consignMinValue || 500)) {
    return { ok: false, lines: [{ kind: 'warn', text: `${def.name}值不了几个钱，柜上不收（起拍须 ${c.consignMinValue || 500} 文以上）。` }] };
  }
  p.removeItem(id, 1);
  world._pendingConsign = world._pendingConsign || [];
  world._pendingConsign.push({ item: id, reserve: reserve || 0, day: dayOf(world) });
  return { ok: true, lines: [{ kind: 'sys', text: `你把${def.name}交给了柜上，下一场替你出手（落槌抽 ${Math.round((c.feeRate || 0.08) * 100)}% 佣金）。` }] };
}

/** 面板数据 */
function viewOf(world) {
  const st = ensureSession(world);
  const cur = currentLot(world);
  const p = world.player;
  return {
    session: st.session,
    daysToNext: daysToNext(world),
    intervalDays: cfg(world).intervalDays || 3,
    money: p ? (p.money || 0) : 0,
    current: cur ? { id: cur.id, name: cur.name, desc: cur.desc, price: cur.price, step: cur.step, leaderName: cur.leaderName, isHigh: cur.isHigh } : null,
    remaining: st.lots.filter(l => !l.sold).length,
    lots: st.lots.map(l => ({ id: l.id, name: l.name, price: l.price, sold: l.sold, leaderName: l.leaderName, isHigh: l.isHigh })),
    pending: (world._pendingConsign || []).map(c => {
      const d = world.getItem(c.item) || {};
      return { id: c.item, name: d.name || c.item };
    }),
    news: st.news || [],
  };
}

module.exports = { ensureSession, currentLot, bid, consign, viewOf, sessionOf, daysToNext, cfg };
