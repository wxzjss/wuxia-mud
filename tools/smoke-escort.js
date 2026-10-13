/* ============================================================
 * smoke-escort.js —— 镖局 · 送镖守卫（design/67 §4）
 *
 * 主人 2026-10-11：「游戏好像也没有镖局以及送镖（送往其他城市有概率会被劫镖）任务」。
 *
 * 全程真跑：在镖局柜台看镖单 → 接镖 → 押镖时**不许飞往** → 路上掷劫镖（固定随机源强制命中）
 * → 讫城柜台交镖 → 按镖物完整度结镖银 → 押镖态清空。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const E = require(path.join(ROOT, 'game/src/core/escort.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); } };
const txt = r => (r && (r.lines || []).map(l => l.text).join('\n')) || '';

(async () => {
  const e = new GameEngine({ seed: 11 });
  await e.boot({});
  e.newGame({ name: '镖师' });
  const w = e.world, p = w.player;

  console.log('===== ① 镖局与镖单 =====');
  {
    ok('飞虎镖局山门是真实房间', !!w.getRoom('feihu_gate'));
    ok('镇远镖局山门是真实房间', !!w.getRoom('zhenyuan_gate'));
    p.room = 'feihu_gate';
    const list = E.listFor(w, p);
    ok('★ 镖局柜台给得出镖单', list.length === 3, list.length + ' 张');
    ok('三种档（常镖/重镖/暗镖）', list.map(b => b.grade).join(',') === '常镖,重镖,暗镖', list.map(b => b.grade).join(','));
    ok('★ 是跨城镖（长安 → 洛阳）', list[0].fromCity === '长安' && list[0].toCity === '洛阳',
      list[0].fromCity + ' → ' + list[0].toCity);
    ok('重镖比常镖贵', list[1].pay > list[0].pay, list[1].pay + ' vs ' + list[0].pay);
    ok('重镖比常镖险', list[1].risk > list[0].risk, list[1].risk + ' vs ' + list[0].risk);
  }

  console.log('===== ② 接镖 → 押镖态 =====');
  {
    const r = await e.exec('接镖 2');
    ok('接镖有回应', /接下了/.test(txt(r)), txt(r).slice(0, 60));
    const st = E.statusOf(p);
    ok('★ 进了押镖态', !!st);
    ok('押镖态记住了讫城', !!(st && st.to === '镇远镖局'), st && st.to);
    const again = await e.exec('接镖 1');
    ok('★ 手上押着镖时不能再接', /还押着/.test(txt(again)), txt(again).slice(0, 50));
  }

  console.log('===== ③ 押镖时不许行路 / 飞往已下线 =====');
  {
    const r = await e.exec('行路 洛阳');
    ok('★ 押镖时「行路」被拦下', /飞不得/.test(txt(r)), txt(r).slice(0, 60));
    ok('人没被传送走', p.room === 'feihu_gate', p.room);
    /* 2026-10-14 飞往空投语义整体下线：对所有人统一一句世界内拒绝（不特判押镖） */
    const f = await e.exec('飞往 洛阳');
    ok('「飞往」对所有人统一拒绝（空投语义下线）', /驿站渡口|行路/.test(txt(f)), txt(f).slice(0, 60));
    ok('飞往后人仍在原地', p.room === 'feihu_gate', p.room);
  }

  console.log('===== ④ 路上被劫（固定随机源强制命中） =====');
  {
    const st = E.statusOf(p);
    const realRng = w.rng;
    w.rng = { next: () => 0 };            // 恒小于概率 → 必中
    const lines = E.onMove(w, p, 'road_wild_1');
    w.rng = realRng;
    ok('★ 掷到劫镖有台词', lines.length > 0 && /人影|摸走/.test(lines.map(l => l.text).join('')), JSON.stringify(lines).slice(0, 80));
    ok('★ 掉了一份镖物', st.lost === 1, 'lost=' + st.lost);
    /* 走到讫城镖局 → 提示交镖。
       ⚠️ 这里要**真的把玩家挪过去**：onMove 只负责「到了说一句」，
          不会替玩家走路（走路永远是 doMove 的事）。第一版只在断言里走了一步
          却没搬人，于是后面交镖被「这儿是飞虎镖局」挡回来了。 */
    const arr = E.onMove(w, p, 'zhenyuan_gate');
    ok('到讫城给「可交镖」提示', /交镖/.test(arr.map(l => l.text).join('')), JSON.stringify(arr).slice(0, 80));
    p.room = 'zhenyuan_gate';
  }

  console.log('===== ⑤ 交镖结银（按镖物完整度） =====');
  {
    const st = E.statusOf(p);
    const intact = st.pot - st.lost;
    const before = p.money;
    const r = await e.exec('交镖');
    ok('交镖有回应', /镖交了/.test(txt(r)), txt(r).slice(0, 60));
    ok('★ 镖银按完整度打折（掉一份就少一份钱）', p.money > before && p.money - before < st.pay,
      `${before} → ${p.money}（满额 ${st.pay}）`);
    ok('★ 押镖态已清空', !E.statusOf(p));
    ok('交完之后「飞往」不再被拦', !E.flyingBlocked(p));
  }

  console.log('===== ⑥ 走错镖局 / 空手交镖 =====');
  {
    const r1 = await e.exec('交镖');
    ok('没押镖时交镖 → 给话不崩', /没有要交的镖/.test(txt(r1)), txt(r1).slice(0, 50));
    /* 在镇远接的镖，讫城是飞虎 —— 站在起点柜台上交镖，必须被挡回来（还没走到） */
    p.room = 'zhenyuan_gate';
    await e.exec('接镖 1');
    const r2 = await e.exec('交镖');
    ok('★ 押到起点柜台上交不了（讫城还没到）', /是要送到/.test(txt(r2)), txt(r2).slice(0, 60));
    /* 走到讫城才给结 */
    p.room = 'feihu_gate';
    const r3 = await e.exec('交镖');
    ok('★ 走到讫城才给结', /镖交了/.test(txt(r3)), txt(r3).slice(0, 60));
  }

  console.log('===== ⑦ 不在柜台时 =====');
  {
    if (E.statusOf(p)) await e.exec('交镖');
    p.room = 'road_wild_1';
    const r = await e.exec('镖单');
    ok('不在镖局 → 明确说清柜台在哪', /柜台在山门/.test(txt(r)), txt(r).slice(0, 60));
    ok('不在镖局接不了镖', /柜台/.test(txt(await e.exec('接镖 1'))));
  }

  console.log(`\n===== smoke-escort: ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail ? 1 : 0);
})();
