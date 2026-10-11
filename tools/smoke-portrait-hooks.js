/* ============================================================
 * smoke-portrait-hooks.js — 画像钩子（portrait.hooks）能不能真问出来
 *
 * 画像里 `hooks` 是**唯一指向「接下来能干什么」**的一栏（26 席反面 + A 层都配了）。
 * 落地时发现它是**双重死数据**：
 *   ① 全仓没有任何地方读 `portrait.hooks` —— 写了 51 个人，一个也问不出来；
 *   ② 它的 `trigger` 一律读 `var: trust_<npcId>`，而 `p.vars` 里那个键
 *      **从来没人写过**（真身是 `npc.pstate.trust`，两个名字对不上）→ 恒不成立。
 * 本脚本把这两条都钉死，免得日后又被「静默」掉。
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);
const textsOf = r => ((r && r.lines) || []).map(l => l.text || '').join(' ');

function boot() {
  const e = new GameEngine({ seed: 20261022, mods: false });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}

/* ================= ① 有钩子的人与结构 ================= */
section('① 钩子数据齐备');
{
  const e = boot();
  const w = e.world;
  const withHooks = Object.values(w.data.npcs).filter(n => n.portrait && n.portrait.hooks && n.portrait.hooks.length);
  ok('★ 至少 40 个人写了钩子', withHooks.length >= 40, withHooks.length + ' 人');
  const bad = [];
  for (const n of withHooks) {
    for (const h of n.portrait.hooks) {
      if (!h.id || !h.title || !h.seed) bad.push(n.id + '/' + (h.id || '?'));
    }
  }
  ok('★ 每条钩子都有 id / title / seed（缺一个就说不出口）', bad.length === 0, bad.slice(0, 6).join(',') || '（齐）');
}

/* ================= ② trust 变量真的有人写 ================= */
section('② `p.vars.trust_<npcId>` 不再恒为 0');
{
  const e = boot();
  const w = e.world, p = w.player;
  const yue = w.spawnNpc('master_yue', p.room, 1, true);
  yue.pstate = yue.pstate || { trust: 0, revealed: [], hooks: {} };
  yue.pstate.trust = 66;
  ok('（前提）这位确实有钩子', !!(yue.portrait && yue.portrait.hooks && yue.portrait.hooks.length));
  ok('（前提）变量此刻是空的（老代码就是这样）',
    p.getVar('trust_master_yue') === undefined || p.getVar('trust_master_yue') === 0,
    '值=' + p.getVar('trust_master_yue'));
  w.syncTrustVar(yue);
  ok('★ 同步之后 p.vars.trust_master_yue = 66', p.getVar('trust_master_yue') === 66, '值=' + p.getVar('trust_master_yue'));
}

/* ================= ③ 面板里看得到 ================= */
section('③ 「询问」面板会列出他的钩子（否则玩家不知道能问）');
{
  const e = boot();
  const w = e.world, p = w.player;
  const yue = w.spawnNpc('master_yue', p.room, 1, true);
  const topics = e.askTopicsOf(yue).map(x => x.topic);
  const titles = yue.portrait.hooks.map(h => h.title);
  ok('★ 钩子标题进了话题列表', titles.some(t => topics.includes(t)),
    '列出的：' + topics.join(' / '));
  /* 交情不够时应当是「有门槛」的那种列法（不是死路） */
  const row = e.askTopicsOf(yue).find(x => titles.includes(x.topic));
  ok('★ 交情不够时给出门槛提示（不是空按钮）', !!row && !!row.hint, row ? row.hint : '（没找到）');
}

/* ================= ④ 真问一遍：门槛 → 说出口 → 已记下 ================= */
section('④ 走真指令：ask <人> about <钩子标题>');
{
  const e = boot();
  const w = e.world, p = w.player;
  const yue = w.spawnNpc('master_yue', p.room, 1, true);
  yue.pstate = yue.pstate || { trust: 0, revealed: [], hooks: {} };
  yue.pstate.trust = 0;
  const hk = yue.portrait.hooks.find(h => h.id === 'hk_master_yue_dizi') || yue.portrait.hooks[0];

  const r1 = e.exec('ask 岳不群 about ' + hk.title);
  const t1 = textsOf(r1);
  ok('★ 交情不够：不撒谎也不白给，把话头留下', /还不到同你说的时候|信不过|先替/.test(t1), t1.slice(0, 70));
  /* ⚠️ 钩子标题与 taboo 撞车是老坑：岳不群的 taboo 里有「弟子」，
     而钩子标题就叫「下山的那个弟子」—— 照着他自己给的话头去问，
     反倒先被当成踩雷扣 15 点好感（画像两栏打架）。这里钉死。 */
  ok('★ 照钩子标题问话不算踩禁忌（不扣好感）', !/好感 -/.test(t1), t1.slice(0, 80));
  ok('★ 此时没有记进 pstate.hooks（还不到时候）', !(yue.pstate.hooks && yue.pstate.hooks[hk.id]));

  yue.pstate.trust = 90;
  const r2 = e.exec('ask 岳不群 about ' + hk.title);
  const t2 = textsOf(r2);
  ok('★ 交情够了：把钩子说出来', t2.indexOf(hk.seed.slice(0, 8)) >= 0, t2.slice(0, 90));
  ok('★ 顺带报出「做成了能得什么」', !hk.rewardHint || t2.indexOf(hk.rewardHint.slice(0, 6)) >= 0,
    (hk.rewardHint || '').slice(0, 30));
  ok('★ 记进了 npc.pstate.hooks（存档留痕）', !!(yue.pstate.hooks && yue.pstate.hooks[hk.id]));

  const r3 = e.exec('ask 岳不群 about ' + hk.title);
  ok('★ 再问一次会说「你在办了」，不重复啰嗦', /已经在办/.test(textsOf(r3)), textsOf(r3).slice(0, 60));
}

/* ================= ⑤ 泛问也能问出 ================= */
section('⑤ 泛问「有什么难处」也接得住');
{
  const e = boot();
  const w = e.world, p = w.player;
  const yue = w.spawnNpc('master_yue', p.room, 1, true);
  yue.pstate = yue.pstate || { trust: 0, revealed: [], hooks: {} };
  yue.pstate.trust = 90;
  const r = e.exec('ask 岳不群 about 有什么难处');
  const t = textsOf(r);
  const seeds = yue.portrait.hooks.map(h => h.seed.slice(0, 6));
  ok('★ 泛问能挑出一条钩子答出来', seeds.some(s => t.indexOf(s) >= 0), t.slice(0, 80));
}

/* ================= ⑥ 没有钩子的人不受影响 ================= */
section('⑥ 没有画像/没有钩子的人，询问走原来的路');
{
  const e = boot();
  const w = e.world, p = w.player;
  const n = w.spawnNpc('mob_bandit', p.room, 1, true);
  const r = e.exec('ask 山贼 about 有什么难处');
  ok('★ 依然有回应（不是空白）', textsOf(r).length > 0, textsOf(r).slice(0, 60));
}

console.log(`\n===== smoke-portrait-hooks: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
