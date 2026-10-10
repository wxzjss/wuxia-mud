/**
 * work.js — 打工系统 + 青楼（卖身/接客/赎身）
 *
 * 第 3 批内容：
 *  - 酒楼跑堂、药店抓药打工赚钱（消耗饱食/口渴）
 *  - 女玩家可卖身青楼：卖身 → 接客攒钱 → 赎身（或高好感有钱 NPC 帮赎）
 *  - 卖身后活动范围受限（青楼附近 N 步内）、复活点改为青楼
 */
'use strict';

const { clamp } = require('./utils');

/** 打工岗位：按房间 id/名字 识别（客栈也算酒楼跑堂） */
const JOBS = [
  /* ⚠️ `inn` 曾经是裸写的，结果 `jn_smith_**inn**er`（铁匠铺·炉房）也被判成「跑堂」——
     JOBS 是**按顺序取第一个命中**的，于是铁匠铺打工挣的是 15 文跑堂钱、
     台词还说「你在铁匠铺·炉房里跑堂」。两处修：
       · `_inn(?![a-z_])` —— 负向断言挡住 `_inner` 这类词（真客栈 id 都以 `_inn` 结尾）；
       · 同时保留中文「客栈」兜底（六家客栈房名都带「客栈」）。 */
  { key: 'waiter', name: '跑堂', wage: 15, timeCost: 30, foodCost: 12, waterCost: 8, roomRe: /(tavern|wine|_inn(?![a-z_])|酒楼|酒馆|酒家|饭庄|客栈|醉仙楼|天香楼|望江楼|汉江楼)/ },
  { key: 'herbalist', name: '抓药', wage: 20, timeCost: 30, foodCost: 10, waterCost: 8, roomRe: /(pharmacy|药铺|医馆|药房|杏林|回春堂|药)/ },
  /* ---- 下面三类是主人第四轮报「点了没反应」时补的 ----
     症状：铁匠铺·炉房「炉火」、青溪村·碾房「石磨」、醉春楼后厨「灶台」
     三个「此地可做」按钮，点下去一律「这里没有你能干的活计（去酒楼或药店看看）」——
     因为原来 JOBS 只认「跑堂 / 抓药」两类，别的房间名一个都不匹配。
     项目铁律「给不出的项**一律不给**」，但这里是**给得出**的：
     铁匠铺拉风箱、碾房推碾、后厨帮厨，都是江湖人挣口饭钱的正经营生。
     所以补 job 而不是删按钮 —— 顺便让这三个房间不再是空摆设。
     ⚠️ 房号正则匹配的是 `room.id + '|' + room.name`（见 canWork），
        id 里带 smith/mill/kitchen 的都认，中文房名也认。 */
  { key: 'smith', name: '拉风箱', wage: 18, timeCost: 30, foodCost: 14, waterCost: 10, roomRe: /(smith|forge|铁匠|铁砧|炉房|打铁)/ },
  { key: 'miller', name: '推碾', wage: 13, timeCost: 30, foodCost: 13, waterCost: 9, roomRe: /(mill|碾房|碾|磨坊|谷仓)/ },
  { key: 'kitchen', name: '帮厨', wage: 14, timeCost: 30, foodCost: 12, waterCost: 9, roomRe: /(kitchen|后厨|灶|伙房)/ },
];

/** 青楼房间识别
 *  ⚠️ 两处判定曾经分叉过（work.js 认「怡红/翠云/凤来」但漏 region；
 *     kidnap.js 认 region 但漏「怡红院/牡丹阁/翠云楼/凤来仪」），
 *     结果是玩家在江南以外的城市赎身会静默走进兜底分支。
 *     现在统一成同一份正则 + 一条 region 捷径，谁都别再单独改。
 *  ⚠️ 只加明确带妓业意味的词，不加裸「楼/阁」——带楼阁的普通建筑太多。*/
const BROTHEL_RE = /青楼|勾栏|教坊|花楼|妓院|妓|窑子|清倌|丽人院|醉春楼|楚馆|平康坊|宜春院|怡红院|牡丹阁|翠云楼|凤来仪|绮罗院|春香阁|听雨楼|望江阁|天香阁/;

function isBrothel(world, roomId) {
  const r = world.getRoom(roomId);
  if (!r) return false;
  if (r.region === 'qinglou') return true;   /* 醉春楼那几间在数据里标了 region */
  return BROTHEL_RE.test(r.name || '');
}

/** 当前房间能不能打工 */
function canWork(world) {
  const p = world.player;
  if (!p) return { ok: false, reason: '无人' };
  if (p.prostitution && p.prostitution.sold) {
    return { ok: false, reason: '你已是青楼之人，自有营生（接客），不必再打零工。' };
  }
  const room = world.getRoom(p.room);
  if (!room) return { ok: false, reason: '这里无工可打' };
  const sig = (room.id || '') + '|' + (room.name || '');
  const job = JOBS.find(j => j.roomRe.test(sig));
  if (!job) return { ok: false, reason: '这里没有你能干的活计（去酒楼或药店看看）' };
  if (p.food < job.foodCost || p.water < job.waterCost) {
    return { ok: false, reason: '你饥渴难耐，实在干不动了（先吃点喝点再来）' };
  }
  return { ok: true, job };
}

/** 打工 */
function work(world) {
  const c = canWork(world);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };
  const p = world.player, job = c.job;
  const room = world.getRoom(p.room);
  p.food = clamp(p.food - job.foodCost, 0, p.maxFood);
  p.water = clamp(p.water - job.waterCost, 0, p.maxWater);
  p.money += job.wage;
  world.advanceTime(job.timeCost);
  return {
    ok: true, lines: [
      { kind: 'story', text: `你在${room.name}里${job.name}，忙前忙后，好一阵操劳。` },
      { kind: 'sys', text: `东家结算工钱，你赚了 ${job.wage} 文钱（饱食 -${job.foodCost}，饮水 -${job.waterCost}）。` },
    ],
  };
}

/* ===================== 青楼 ===================== */

const SELL_PRICE = 800;      // 卖身银（立得）
const REDEEM_MULT = 2;       // 赎身价 = 卖身银 × 2
const BROTHEL_RANGE = 3;     // 卖身后活动范围（离青楼 N 步内）

/** 卖身青楼 */
function sellBody(world) {
  const p = world.player;
  if (p.gender !== 'female') return { ok: false, lines: [{ kind: 'warn', text: '青楼只收女儿身。' }] };
  if (!isBrothel(world, p.room)) return { ok: false, lines: [{ kind: 'warn', text: '你得在青楼里，才能谈卖身之事。' }] };
  if (p.prostitution && p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你已身入青楼。' }] };
  const debt = SELL_PRICE * REDEEM_MULT;
  p.money += SELL_PRICE;
  p.prostitution = { sold: true, brothelRoom: p.room, debt, since: world.clockMinutes, served: 0, earnings: 0 };
  const room = world.getRoom(p.room);
  return {
    ok: true, lines: [
      { kind: 'story', text: `你咬咬牙，在${room.name}老鸨手里画了押，领了 ${SELL_PRICE} 文卖身银。从此便是风尘中人。` },
      { kind: 'warn', text: `你欠下赎身债 ${debt} 文。每日「接客」所得尽数抵债，还清即可「赎身」脱籍；有交情深的贵人，也肯替你赎身。` },
    ],
  };
}

/** 接客攒钱（每次一小时） */
function serveCustomer(world) {
  const p = world.player;
  if (!p.prostitution || !p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你又非青楼之人，接的什么客。' }] };
  if (!isBrothel(world, p.room)) return { ok: false, lines: [{ kind: 'warn', text: '你得回青楼里，才能接客。' }] };
  const earn = 40 + Math.floor((world.rng ? world.rng.next() : Math.random()) * 30); // 40~69 文
  // 接客所得全部抵赎身债（老鸨抽成，到不了自己腰包），不再额外加玩家钱——否则「既得钱又减债」会翻倍
  p.prostitution.earnings = (p.prostitution.earnings || 0) + earn;
  p.prostitution.served = (p.prostitution.served || 0) + 1;
  p.prostitution.debt = Math.max(0, p.prostitution.debt - earn);
  p.food = clamp(p.food - 10, 0, p.maxFood);
  p.water = clamp(p.water - 10, 0, p.maxWater);
  p.hp = clamp(p.hp - 8, 1, p.maxHp); // 接客伤身，但不会死
  world.advanceTime(60);
  return {
    ok: true, lines: [
      { kind: 'story', text: '你强颜欢笑，应酬了一夜的客人。' },
      { kind: 'sys', text: `你赚了 ${earn} 文，尽数抵了赎身债，还差 ${p.prostitution.debt} 文。` },
    ],
  };
}

/** 赎身（赎身债还清即可脱籍） */
function redeem(world) {
  const p = world.player;
  if (!p.prostitution || !p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你又非青楼之人，赎的什么身。' }] };
  const debt = p.prostitution.debt || 0;
  if (debt > 0) return { ok: false, lines: [{ kind: 'warn', text: `赎身债还没还清（还差 ${debt} 文），再「接客」攒一攒吧。` }] };
  p.prostitution = { sold: false, redeemed: true };
  return {
    ok: true, lines: [
      { kind: 'story', text: '你终于还清了赎身债，赎回自己的身子，脱了乐籍。' },
      { kind: 'sys', text: '从今往后，你又是自由之身了。' },
    ],
  };
}

/** 最近的青楼房间 id（卖身时记下，否则 BFS 找） */
function brothelAnchor(world) {
  const p = world.player;
  if (p && p.prostitution && p.prostitution.brothelRoom) return p.prostitution.brothelRoom;
  if (!p) return null;
  if (isBrothel(world, p.room)) return p.room;
  const seen = new Set([p.room]);
  const q = [p.room];
  while (q.length) {
    const id = q.shift();
    const room = world.getRoom(id);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && world.getRoom(t) && !seen.has(t)) {
        if (isBrothel(world, t)) return t;
        seen.add(t);
        q.push(t);
      }
    }
  }
  return null;
}

/** 卖身后能否去 roomId（青楼附近 N 步内才放行） */
function withinBrothelRange(world, roomId) {
  const anchor = brothelAnchor(world);
  if (!anchor) return true; // 无青楼则不限制
  if (anchor === roomId) return true;
  const seen = new Set([anchor]);
  let frontier = [anchor];
  for (let step = 0; step < BROTHEL_RANGE; step++) {
    const next = [];
    for (const id of frontier) {
      const room = world.getRoom(id);
      if (!room) continue;
      for (const d of Object.keys(room.exits || {})) {
        const ex = room.exits[d];
        const t = typeof ex === 'string' ? ex : ex.to;
        if (t && world.getRoom(t) && !seen.has(t)) {
          if (t === roomId) return true;
          seen.add(t);
          next.push(t);
        }
      }
    }
    frontier = next;
  }
  return false;
}

module.exports = {
  JOBS, isBrothel, canWork, work,
  sellBody, serveCustomer, redeem, brothelAnchor, withinBrothelRange,
  BROTHEL_RE, SELL_PRICE,
};
