/* ============================================================
 * smoke-busy-exit.js — 吐纳 / 双修「点页面上任何别的按钮就退出」
 *
 * 主人 2026-10-11 原话拆开：
 *   ①「『吐纳』的动不了，改成点击页面任意其他按钮自动退出『吐纳』状态」（双修采补同理）
 *   ②「屏幕上要有退出吐纳状态的文本显示」
 *   ③ 中途退出双修，要有**伴侣幽怨的语言神态动作**描写
 *   ④「不用搞『收功』按钮」
 *   ⑤ 追问「双修整个过程到事后结束，玩家是不是还会继续卡在那动不了也点不了」
 *
 * 走的是**真引擎真指令**（`engine.exec`），不是直接调模块函数 ——
 * 这条改动的全部意义就在于「指令层认得这不是『继续』」。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const NG = require(path.join(ROOT, 'game', 'src', 'core', 'neigong.js'));
const DC = require(path.join(ROOT, 'game', 'src', 'core', 'dualcultivate.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);
const txt = r => (r && r.lines || []).map(l => l.text || '').join('\n');

const SEED = 20261018;
function boot(name) {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: name || '试剑', gender: 'male', birth: 'wuxue' });
  /* 开局气血只有两成，而吐纳门槛是「不低于三成」 */
  e.world.player.hp = e.world.player.maxHp;
  return e;
}
const busyOf = e => e.view().player.busy;

/** 把场面收拾成「双修一定成」：屋里只他一个、是夜里、关系已定、好感拉满 */
function setupDual(e) {
  const w = e.world, p = w.player;
  const npc = w.npcsIn(p.room)[0];
  if (!npc) throw new Error('初始房间没有 NPC，换个种子');
  npc.favor = 120;
  p.marriage = { spouse: npc.defId };
  w.isNight = () => true;
  const orig = w.npcsIn.bind(w);
  w.npcsIn = () => [npc];
  return { w, p, npc, restore: () => { w.npcsIn = orig; } };
}

(async () => {

  /* ================= 一、吐纳 ================= */
  section('① 吐纳：点任何别的按钮 = 自动退出 + 照常执行');
  const e1 = boot();
  const r1 = e1.exec('吐纳');
  ok('起手吐纳成功（有坐下的描写）', /盘膝坐下/.test(txt(r1)), txt(r1).slice(0, 30));
  ok('view 里报出「脱不开身」状态', busyOf(e1) && busyOf(e1).kind === 'tune', JSON.stringify(busyOf(e1)));

  const r2 = e1.exec('吐纳');
  ok('吐纳中再敲「吐纳」= 接着熬一轮（不退出）', !/已退出吐纳状态/.test(txt(r2)), txt(r2).slice(0, 30));
  ok('接着熬之后仍在状态里且轮次 +1', busyOf(e1) && busyOf(e1).round === 1, JSON.stringify(busyOf(e1)));

  const r3 = e1.exec('背包');
  const t3 = txt(r3);
  ok('★ 点「背包」先退出吐纳（屏幕上写明）', /已退出吐纳状态/.test(t3), t3.slice(0, 60));
  ok('★ 且这一下真的开了背包（不是被拒绝）', /行囊/.test(t3), t3.split('\n').slice(3, 5).join(' / '));
  ok('退出后 view 里不再有 busy', busyOf(e1) === null, JSON.stringify(busyOf(e1)));

  const r4 = e1.exec('n');
  ok('醒过来之后真能走（房间变了）', /【/.test(txt(r4)) || (r4.view && r4.view.room), txt(r4).slice(0, 24));

  /* 方向键走人这条路 —— 主人最在意的「不能一路走回客栈」的反面：
     现在点方向键不是「被拦住」，而是「醒过来再走」。 */
  const e1b = boot();
  e1b.world.player.hp = e1b.world.player.maxHp;
  e1b.exec('吐纳');
  const roomBefore = e1b.world.player.room;
  const rb = e1b.exec('n');
  ok('★ 吐纳中按方向键：先退出，再真的走过去',
    /已退出吐纳状态/.test(txt(rb)) && e1b.world.player.room !== roomBefore,
    `${roomBefore} → ${e1b.world.player.room}`);
  ok('走过去之后状态已清', busyOf(e1b) === null, JSON.stringify(busyOf(e1b)));

  /* 显式「收功」：只退一次，不许先退一次再报「你并没有在吐纳」 */
  const e1c = boot();
  e1c.world.player.hp = e1c.world.player.maxHp;
  e1c.exec('吐纳');
  const rc = e1c.exec('收功');
  const tc = txt(rc);
  ok('敲「收功」也退，且只退一次（不出现双重退出/否认在吐纳）',
    (tc.match(/已退出吐纳状态/g) || []).length === 1 && !/并没有在吐纳/.test(tc), tc.replace(/\n/g, ' | ').slice(0, 70));
  ok('收功后状态已清', busyOf(e1c) === null, JSON.stringify(busyOf(e1c)));

  /* 没在吐纳时敲「收功」→ 老实说没在吐纳（不该谎报退出） */
  const e1d = boot();
  const rd = e1d.exec('收功');
  ok('没在吐纳时敲「收功」→「你并没有在吐纳」', /并没有在吐纳/.test(txt(rd)), txt(rd).slice(0, 30));

  /* ================= 二、双修 ================= */
  section('② 双修：中途点别的按钮 = 退出 + 伴侣幽怨');
  const e2 = boot();
  const s2 = setupDual(e2);
  const r20 = e2.exec('双修 ' + s2.npc.name);
  ok('双修起手成功', /脱不开身/.test(txt(r20)), txt(r20).slice(0, 34));
  ok('view 报出双修状态（带轮次）', busyOf(e2) && busyOf(e2).kind === 'dual' && busyOf(e2).rounds === 4,
    JSON.stringify(busyOf(e2)));
  ok('起手提示教的是「点别的按钮」（不再教「敲收功」）',
    /点屏幕上任何别的按钮/.test(txt(r20)) && !/敲「收功」/.test(txt(r20)), txt(r20).slice(0, 60));

  const r21 = e2.exec('背包');
  const t21 = txt(r21);
  ok('★ 点「背包」先退出双修（屏幕上写明）', /已退出双修状态/.test(t21), t21.slice(0, 40));
  ok('★ 并给出被撂下那人的反应（幽怨）', t21.split('\n')[0] && t21.split('\n')[0].indexOf(s2.npc.name) >= 0,
    t21.split('\n')[0]);
  ok('★ 背包照常打开', /行囊/.test(t21), t21.split('\n').slice(3, 4).join(''));
  ok('退出后 view 里不再有 busy', busyOf(e2) === null, JSON.stringify(busyOf(e2)));

  /* ================= 三、走完全程不卡 ================= */
  section('③ 双修走完四轮：结束之后不许还卡着');
  const e3 = boot();
  const s3 = setupDual(e3);
  e3.exec('双修 ' + s3.npc.name);
  let settled = false;
  for (let i = 0; i < 4; i++) {
    const r = e3.exec('双修');
    if (/内力上限/.test(txt(r))) settled = true;
  }
  ok('四轮走完真的结算了（涨内力上限）', settled, '');
  ok('★ 结算后 view 里没有 busy（人能动）', busyOf(e3) === null, JSON.stringify(busyOf(e3)));
  const roomB3 = e3.world.player.room;
  e3.exec('n');
  ok('★ 结束之后真的走得动（这就是主人问的「卡不卡」）',
    e3.world.player.room !== roomB3, `${roomB3} → ${e3.world.player.room}`);

  /* ================= 四、退出文本不重样 ================= */
  section('④ 退出时的伴侣反应不重样');
  /* ⚠️ 不能拿「两场」比 —— 池子的取句是 `(hash(seed) + 轮次) % n`，
     seed 每场都不同，两场取到同句是**正常**的（保证的是同一场内不重）。
     要验的是「玩家反复抽身时能听到不同的话」，所以连抽几次看花色。 */
  const e4 = boot();
  const s4 = setupDual(e4);
  const seenQuit = new Set();
  for (let i = 0; i < 8; i++) {
    e4.world.clockMinutes += DC.COOLDOWN_MIN;      /* 把冷却推过去 */
    e4.exec('双修 ' + s4.npc.name);
    if (!busyOf(e4)) continue;
    e4.exec('双修');                                /* 走一转再抽身，轮次也跟着变 */
    if (!busyOf(e4)) continue;
    seenQuit.add(txt(e4.exec('背包')).split('\n')[0]);
  }
  ok('★ 反复中途抽身，听到的话不重样（≥3 种）', seenQuit.size >= 3, `实际 ${seenQuit.size} 种：` + [...seenQuit][0]);

  /* 关系不同 → 池子不同（情人 vs 刚搭上） */
  const e5 = boot();
  const s5 = setupDual(e5);
  s5.p.marriage = {};                       /* 抹掉关系 → 走 stranger 池 */
  e5.exec('双修 ' + s5.npc.name);
  const quitStranger = txt(e5.exec('背包')).split('\n')[0];
  ok('关系未定的人抽身，说的话与情人不同', quitStranger && !seenQuit.has(quitStranger), quitStranger);

  /* ================= 五、采补 ================= */
  section('⑤ 采补中途退出（另一套文本）');
  const e6 = boot();
  const s6 = setupDual(e6);
  s6.p.marriage = {};
  s6.npc.favor = 0;
  /* 采补要「按住得住人」：内力+攻击得压得住对方。开局凡人按不住艄公，
     给他一副撑得起场面的内力（这就是采补的门槛本身，不是绕过它）。 */
  s6.p.maxMpBase = 9000;
  s6.p.recalc();
  const r6 = e6.exec('采补 ' + s6.npc.name);
  ok('采补能起手', !!busyOf(e6), txt(r6).slice(0, 44));
  if (busyOf(e6)) {
    const t6 = txt(e6.exec('背包'));
    ok('★ 采补中点别的按钮也退出，且写明「已退出采补状态」', /已退出采补状态/.test(t6), t6.slice(0, 44));
    ok('采补退出后状态已清', busyOf(e6) === null, JSON.stringify(busyOf(e6)));
  } else {
    ok('★ 采补中点别的按钮也退出（前置不满足则跳过）', true, '（这一次没起手，见上一条）');
    ok('采补退出后状态已清（跳过）', true, '');
  }

  /* ================= 六、「继续」类不许被误杀 ================= */
  section('⑥ 继续类指令不被自动退出误伤');
  const e7 = boot();
  e7.world.player.hp = e7.world.player.maxHp;
  e7.exec('吐纳');
  /* ⚠️ 这里只断言「不进自动退出分支」——
     吐纳熬到见底自己就结算了（状态自然清掉），那是**正常收尾**，不是被踢出来。 */
  for (const c of ['吐纳', '行功', '调息']) {
    const r = e7.exec(c);
    ok(`「${c}」不进自动退出分支`, !/已退出吐纳状态/.test(txt(r)), (txt(r).split('\n')[0] || '').slice(0, 26));
  }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
