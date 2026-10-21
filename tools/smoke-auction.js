/* ============================================================
 * smoke-auction.js — 拍卖行（design/40 §6.3）
 *
 * 覆盖：
 *  ① 市集房间带拍卖行标记；别的房间点了会被拒
 *  ② 每期拍品数量与结构（固定池 + 高价值位）
 *  ③ 出价：低于当前价被拒 / 加成 / NPC 跟价 / 落槌成交扣钱交货
 *  ④ 寄拍：不值钱的被拒 / 值钱的收下并从背包移出
 *  ⑤ 高价值位按品级加权抽（越小的品级越少见）
 *  ⑥ 场次按日轮换（每 intervalDays 天一换）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const AU = require(path.join(ROOT, 'game', 'src', 'core', 'auction.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261013;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' }); return e; }

const e0 = boot();
const w0 = e0.world;

/* ---------- ① 场所 ---------- */
section('① 拍卖行有地方');
const houses = Object.values(w0.data.rooms).filter(r => r.auctionHouse);
ok('至少有 1 间市集挂了拍卖行标记', houses.length >= 1, houses.map(r => r.id).join(','));
const eR = boot(); const pR = eR.world.player;
const rBad = eR.exec('bid 100');
ok('不在拍卖行出价会被拒', JSON.stringify(rBad.lines).indexOf('没有拍卖行') >= 0, JSON.stringify(rBad.lines && rBad.lines[0]));

/* ---------- ② 拍品 ---------- */
section('② 每期拍品结构');
const e1 = boot(); const w1 = e1.world, p1 = w1.player;
const st = AU.ensureSession(w1);
ok('当期上架 ≥ 10 件', st.lots.length >= 10, String(st.lots.length));
ok('拍品引用真实物品（或书）', st.lots.every(l => !!(w1.getItem(l.item) || (w1.data.books || {})[l.item])),
  st.lots.map(l => l.item).join(','));
ok('起拍价 > 0', st.lots.every(l => l.startPrice > 0));

/* ---------- ③ 出价 ---------- */
section('③ 出价（真走 bid）');
w1.movePlayerTo(p1, 'luoyang_market');
const lot = AU.currentLot(w1);
ok('有正在拍的一件', !!lot, lot ? lot.name : '(无)');
const rLow = AU.bid(w1, p1, 1);
ok('低于当前价被拒', rLow.ok === false, JSON.stringify(rLow.lines[0].text));
p1.money = 9999999;
/* 钉住随机：NPC 一律不加价 → 一次出价即落槌 */
w1.rng.next = () => 0.99;
const before = p1.money;
const rOk = AU.bid(w1, p1, lot.startPrice + lot.step);
ok('出价被接受并成交', rOk.ok === true && lot.sold === true, JSON.stringify(rOk.lines.map(l => l.text)));
ok('成交后真的扣了钱', p1.money < before, before + ' → ' + p1.money);
ok('成交后东西进了背包', p1.countItem(lot.item) >= 1, 'count=' + p1.countItem(lot.item));

/* 价格不足 */
const e2 = boot(); const w2 = e2.world, p2 = w2.player;
p2.money = 10;
const lot2 = AU.currentLot(w2);
const rPoor = AU.bid(w2, p2, lot2.startPrice + lot2.step);
ok('钱不够会被拒', rPoor.ok === false, JSON.stringify(rPoor.lines[0].text));

/* NPC 跟价 */
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
p3.money = 9999999;
const lot3 = AU.currentLot(w3);
w3.rng.next = () => 0;          // 必触发跟价
const rNpc = AU.bid(w3, p3, lot3.startPrice);
ok('NPC 会跟价（未落槌，价格被抬高）', lot3.sold === false && lot3.price > lot3.startPrice,
  lot3.price + ' / leader=' + lot3.leaderName);

/* ---------- ④ 寄拍 ---------- */
section('④ 寄拍');
const e4 = boot(); const w4 = e4.world, p4 = w4.player;
w4.movePlayerTo(p4, 'luoyang_market');
w4.giveItem(p4, 'c_lihua_zhen', 1);      // 值 2600
w4.giveItem(p4, 't_bone_powder', 1);     // 值 1200 —— 也够
const rC1 = AU.consign(w4, p4, '不存在的破铜烂铁');
ok('身上没有的东西寄不了', rC1.ok === false, JSON.stringify(rC1.lines[0].text));
const rC2 = AU.consign(w4, p4, '暴雨梨花针');
ok('值钱的收下了', rC2.ok === true, JSON.stringify(rC2.lines[0].text));
ok('寄拍后从背包移出', p4.countItem('c_lihua_zhen') === 0, 'count=' + p4.countItem('c_lihua_zhen'));

/* ---------- ⑤ 高价值位按品级加权 ---------- */
section('⑤ 高价值位按品级加权抽');
const counts = {};
/* ⚠️ 2026-10-18：原来每轮都 boot() —— 400 次全量启动实测 416ms/次 ≈ 166s，
   已把 smoke 推过 120s 超时线（数据涨到 316 quest/547 房/837 NPC 后）。
   本段只验「抽品级的统计分布」，不需要新世界：复用一个 world，每轮
   删 auctionState + 换随机源即可（实测 400 轮 834ms，结论不变）。
   不要靠调大超时解决 —— 那会让全量长期虚高，还会把真红藏进超时里。 */
const e5 = boot(); const w5 = e5.world;
for (let i = 0; i < 400; i++) {
  /* ⚠️ 必须先删掉当期状态：`engine.view()` 在 newGame 时就被调过一次，
     `auctionView()` 已经把本期拍品生成好了 —— 不清掉，后面换什么随机源都没用
     （生成只发生一次），这是最容易骗过自己的那种假测试。 */
  delete w5.auctionState;
  w5.rng.next = () => Math.random();
  const s5 = AU.ensureSession(w5);
  for (const l of s5.lots) if (l.isHigh && l.grade) counts[l.grade] = (counts[l.grade] || 0) + 1;
}
const keys = Object.keys(counts).map(Number).sort((a, b) => a - b);
ok('高价值位确实按品级分出档次', keys.length >= 4, JSON.stringify(counts));
const lowShare = (counts[1] || 0) + (counts[2] || 0) + (counts[3] || 0);
const highShare = (counts[7] || 0) + (counts[8] || 0) + (counts[9] || 0);
ok('低品级（1~3）比高品级（7~9）更少见', lowShare < highShare, `低品 ${lowShare} < 高品 ${highShare}`);

/* ---------- ⑥ 场次轮换 ---------- */
section('⑥ 场次按日轮换');
const e6 = boot(); const w6 = e6.world;
const s1 = AU.sessionOf(w6);
w6.clockMinutes += 1440 * (w6.data.auction.intervalDays || 3);
const s2 = AU.sessionOf(w6);
ok('过了 intervalDays 天就换场次', s2 > s1, `${s1} → ${s2}`);
ok('daysToNext 在 1..intervalDays 之间', AU.daysToNext(w6) >= 1 && AU.daysToNext(w6) <= (w6.data.auction.intervalDays || 3));

console.log(`\n===== smoke-auction: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
