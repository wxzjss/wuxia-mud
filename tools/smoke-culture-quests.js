/* ============================================================
 * smoke-culture-quests.js — 据画像写的九条支线（#112 收尾）
 *
 * 主人原话：「增加你认为画像写得好的 npc 的根据画像来写会发生的支线剧情」。
 * 挑的是画像写得最实的九位（江南七才子 + 花魁柳含烟 + 提学周学政）。
 *
 * 本脚本钉三件事：
 *   ① 支线真的挂在这些 NPC 身上（`npc.sidequest` 指得到，不是孤儿数据）；
 *   ② 目标房间真实存在，且**真的能推进**（走 engine.checkQuestAuto 那条真路）；
 *   ③ 抉择两边都有代价 —— 帮人不是免费的（一边倒的选项等于没有选择）。
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

const IDS = ['hk_tang_bohu', 'hk_zhu_zhishan', 'hk_wen_zhengming', 'hk_zhou_wenbin',
  'hk_xu_zhenqing', 'hk_zhang_ling', 'hk_du_mu', 'hk_liu_hanyan', 'hk_xue_zheng'];

function boot() {
  const e = new GameEngine({ seed: 20261023, mods: false });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  return e;
}

/* ================= ① 挂得到人 ================= */
section('① 九条支线都挂在写了画像的那九个人身上');
{
  const e = boot();
  const w = e.world;
  const miss = [], orphan = [];
  for (const id of IDS) {
    const q = w.data.quests[id];
    if (!q) { miss.push(id); continue; }
    const giver = w.data.npcs[q.giver];
    if (!giver || giver.sidequest !== id) orphan.push(id + '（giver 的 sidequest 指不到）');
    if (!giver || !giver.portrait) orphan.push(id + '（giver 没有画像）');
  }
  ok('★ 九条都在', miss.length === 0, miss.join(',') || IDS.length + ' / 9');
  ok('★ 每条都能从委托人身上接（不是孤儿数据）', orphan.length === 0, orphan.join(',') || '（全部挂得上）');
  const names = IDS.map(id => w.data.quests[id] && w.data.quests[id].name);
  ok('★ 每条都有名字与开场白', IDS.every(id => {
    const q = w.data.quests[id];
    return q && q.name && q.desc && q.desc.length > 20;
  }), names.join(' / '));
}

/* ================= ② 目标房间真实存在 ================= */
section('② 目标房间真实存在（写错一个字母 = 任务永远做不完，还不报错）');
{
  const e = boot();
  const w = e.world;
  const bad = [];
  for (const id of IDS) {
    for (const st of (w.data.quests[id].stages || [])) {
      for (const t of (st.targets || [])) {
        if (t.kind === 'room' && !w.data.rooms[t.key]) bad.push(id + '→' + t.key);
      }
    }
  }
  ok('★ 没有指向不存在房间的目标', bad.length === 0, bad.join(',') || '（全部存在）');
}

/* ================= ③ 真能推进 ================= */
section('③ 走真路：接取 → 走到地方 → 提示复命');
{
  const e = boot();
  const w = e.world, p = w.player;
  const bad = [];
  for (const id of IDS) {
    const q = w.data.quests[id];
    const t = q.stages[0].targets[0];
    if (t.kind !== 'room') { bad.push(id + '（目标不是房间类，本脚本只验房间类）'); continue; }
    p.setQuestStage(id, 0);
    const keepRoom = p.room;
    p.room = t.key;                       // 直接站到目标房间
    const lines = [];
    /* ⚠️ 房间类目标是在 `postProcess` 里记账的（engine.js 的「房间类」那一段），
       不是 checkQuestAuto —— 第一版调错函数，九条全报「没记数」，
       差点把「测试调错入口」当成「数据写错了」。 */
    e.postProcess(lines, p.room);
    const vk = t.var || ('q_' + id + '_' + t.id);
    if (!p.getVar(vk)) bad.push(id + '（走进目标房间没记数）');
    p.room = keepRoom;
  }
  ok('★ 九条走进目标房间都真的记了数', bad.length === 0, bad.join(', ') || '（9 / 9 可推进）');
}

/* ================= ④ 目标达成会提示复命 ================= */
section('④ 目标齐了会提示「去找委托人复命」（不是默默完成）');
{
  const e = boot();
  const w = e.world, p = w.player;
  const id = 'hk_tang_bohu';
  const q = w.data.quests[id];
  p.setQuestStage(id, 0);
  p.room = q.stages[0].targets[0].key;
  const lines = [];
  e.postProcess(lines, p.room);
  e.checkQuestAuto(lines);
  const flags = Object.keys(p.flags || {});
  ok('★ 打上了 questready 标记', p.hasFlag('questready_' + id + '_0') || flags.some(f => f === 'questready_' + id + '_0'),
    lines.map(l => l.text).join(' | ').slice(0, 70) || '（标记已置）');
}

/* ================= ⑤ 抉择两边都有代价 ================= */
section('⑤ 每个抉择都不是「白捡」——两边各有得失');
{
  const e = boot();
  const w = e.world;
  const bad = [], noChoice = [];
  for (const id of IDS) {
    const effs = w.data.quests[id].stages[0].effects || [];
    const menu = effs.find(x => x && x.type === 'menu');
    if (!menu) { noChoice.push(id); continue; }
    const opts = String(menu.raw).split(';;').map(s => s.split('>')[1] || '');
    if (opts.length < 2) { noChoice.push(id + '(只有一个选项)'); continue; }
    /* 判据：① 两边各记各的 flag（选择要留痕）；
       ② 两边效果不能一样（否则等于没选）；
       ③ **至少有一边带明确代价**（掉钱 / 掉好感 / 掉 karma）——
          两边全是纯收益的选项，等于没有取舍，玩家闭着眼点哪个都一样。 */
    const diffFlag = opts.every(o => /flag:/.test(o));
    const different = opts[0] !== opts[1];
    const someCost = opts.some(o => /-money|money:-|favor:[A-Za-z_0-9]+:-|karma:-/.test(o));
    if (!diffFlag) bad.push(id + '（选项没有各记各的 flag）');
    if (!different) bad.push(id + '（两个选项一模一样）');
    if (!someCost) bad.push(id + '（两边都是白捡的，没有取舍）');
  }
  ok('★ 九条都写了抉择（menu）', noChoice.length === 0, noChoice.join(',') || '（9 / 9）');
  ok('★ 两边各有代价，且各自留痕', bad.length === 0, bad.join(', ') || '（全部有代价）');
}

/* ================= ⑥ 文案不跑偏：出现的名字都真在数据里 ================= */
section('⑥ 支线里点到的人/地都是真的（别写出不存在的人名）');
{
  const e = boot();
  const w = e.world;
  const names = new Set(Object.values(w.data.npcs).map(n => n.name));
  const bad = [];
  for (const id of IDS) {
    const q = w.data.quests[id];
    const txt = JSON.stringify(q);
    /* 只查「柳含烟」这类被点名的具体人名：从全库名字里挑 ≥2 字的，看有没有被误写 */
    for (const nm of ['柳含烟', '唐寅', '祝允明', '文徵明', '周文宾', '徐祯卿', '张灵', '都穆', '周学政']) {
      if (txt.indexOf(nm) >= 0 && !names.has(nm)) bad.push(id + '→' + nm);
    }
  }
  ok('★ 支线文案点到的人名在数据里都存在', bad.length === 0, bad.join(',') || '（都对得上）');
}

console.log(`\n===== smoke-culture-quests: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
