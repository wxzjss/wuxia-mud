/* look-detail-check.js —— 「看告示」派发 + 查看 NPC 的详细信息
   修的两个 bug：
     1. 客栈「此地可做」显示「告示」，点下去却说「这里没有告示」
        （normalizeCmd 把「看告示」改写成 `look 告示`，look 找不到 NPC/物品就报错）
     2. 看 NPC 只有三行字，看不出他装备了什么、带什么东西、武功练到什么程度
   run: node tools/look-detail-check.js */
'use strict';
const { GameEngine } = require('../game/src/core/engine.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function txt(r) { return (r.lines || []).map(l => l.text || '').join('\n'); }
function boot(seed) {
  const e = new GameEngine({ seed: seed || 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  return e;
}

/* ---------- ① 告示：各种说法都要能触发，且不串房间 ---------- */
sec('① 告示派发');
{
  const e = boot();
  const w = e.world, p = w.player;
  p.room = 'jiangnan_inn';
  const inn = w.getRoom('jiangnan_inn');
  const act = (inn.actions || []).find(a => (a.keywords || []).includes('告示'));
  ok('悦来客栈真的有告示 action', !!act, JSON.stringify(act));

  for (const cmd of ['看告示', '告示', '看 告示', '看告示了', '看榜']) {
    const r = e.exec(cmd);
    ok(`「${cmd}」能读出告示`, /悬赏|山贼|纹银/.test(txt(r)), txt(r).slice(0, 60));
  }
  ok('读告示不是「这里没有」', !/这里没有/.test(txt(e.exec('看告示'))));

  /* 房间里没有告示时，必须老老实实说没有（exits 是对象，不能用 .length） */
  const streets = Object.keys(w.data.rooms).find(rid => {
    const r = w.data.rooms[rid];
    return r && !(r.actions || []).some(a => (a.keywords || []).includes('告示'))
      && Object.keys(r.exits || {}).length;
  });
  ok('找得到一个无告示的房间做对照', !!streets, streets);
  p.room = streets;
  const r2 = e.exec('看告示');
  const t2 = txt(r2);
  ok('无告示房间不会被误触发', !/悬赏|山贼猖獗/.test(t2), streets + ' -> ' + t2.slice(0, 50));
  ok('无告示房间给出「没有」提示', /没有/.test(t2), t2.slice(0, 50));

  /* 「此地可做」列表里显示的名字必须等于真正能跑的那个 cmd */
  p.room = 'jiangnan_inn';
  const av = e.roomActionsView(p);
  const list = JSON.stringify(av || []);
  ok('可做列表里出现告示', /告示/.test(list), list.slice(0, 200));
  const gao = (av || []).find(x => /告示/.test(x.name || x.label || x.cmd || ''));
  ok('告示按钮显示名就是「告示」而不是「看告示」',
    gao && /^(看|读)?\s*告示$/.test((gao.name || gao.label || '').trim()), gao && JSON.stringify(gao));
  ok('点了按钮发的 cmd 确实能读出告示',
    gao ? /悬赏|山贼/.test(txt(e.exec(gao.cmd))) : false,
    gao && gao.cmd);
}

/* ---------- ② 看 NPC：装备 / 随身 / 功法级别 ---------- */
sec('② NPC 详细信息');
{
  const e = boot(4242);
  const w = e.world, p = w.player;

  /* 造一个「装备齐全、身怀巨款、练到登峰」的对手，逐条验 */
  /* ⚠️ 模板里写的字段是 skills（装备哪一门），实例上才是 equippedSkills */
  let target = null;
  for (const id of Object.keys(w.data.npcs)) {
    const d = w.data.npcs[id];
    if (d.skills && Object.values(d.skills).filter(Boolean).length >= 2) { target = d; break; }
  }
  ok('库里有装备功法的 NPC 模板', !!target, target && target.id);

  if (target) {
    /* 直接改实例：装备一件真物品 + 给钱 + 把某门武功练到登峰 */
    const e2 = boot(4243);
    const w2 = e2.world, p2 = w2.player;
    const n = w2.spawnNpc(target.id, p2.room, 1, true);
    ok('NPC 实例生成', !!n && !!n.id, n && n.id);

    /* 找一件真存在的物品 */
    const iid = Object.keys(w2.data.items)[0];
    n.equipment = Object.assign({}, n.equipment || {}, { 武器: iid });
    n.carry = Object.assign({}, n.carry || {}, { money: 348 });
    const sid = Object.values(n.equippedSkills || {}).filter(Boolean)[0];
    n.learned = n.learned || {};
    if (sid) n.learned[sid] = { level: 950 };
    n.favor = 60; n.pstate = Object.assign({}, n.pstate || {}, { trust: 50 });

    const out = txt(e2.exec('看 ' + n.name));
    const itemName = (w2.getItem(iid) || {}).name;
    ok('显示「身上穿着」', /身上穿着/.test(out), out.slice(0, 200));
    ok('穿着里带 slot 与物品名', out.includes('武器') && out.includes(itemName || '@@'), itemName);
    ok('显示「随身带着」', /随身带着/.test(out), out.slice(0, 200));
    ok('随身带的钱数写出来', /348\s*文/.test(out), out.slice(0, 240));
    ok('显示「他习有」', /他习有/.test(out), out.slice(0, 240));
    ok('交情深时给出功法级别（登峰造极）', /登峰造极/.test(out), out.slice(0, 260));
  }

  /* ---------- ③ 交情门槛：陌生人看不到级别 ---------- */
  sec('③ 交情门槛');
  {
    const e3 = boot(4244);
    const w3 = e3.world, p3 = w3.player;
    let t3 = null;
    for (const id of Object.keys(w3.data.npcs)) {
      const d = w3.data.npcs[id];
      if (d.skills && Object.values(d.skills).filter(Boolean).length) { t3 = d; break; }
    }
    ok('交情门槛用例找到模板', !!t3, t3 && t3.id);
    const n3 = t3 ? w3.spawnNpc(t3.id, p3.room, 1, true) : null;
    const sid = n3 && Object.values(n3.equippedSkills || {}).filter(Boolean)[0];
    n3.learned = n3.learned || {};
    if (sid) n3.learned[sid] = { level: 950 };
    n3.favor = 0; n3.pstate = { trust: 0 };
    const out3 = txt(e3.exec('看 ' + n3.name));
    ok('陌生人看不到「登峰造极」', !/登峰造极/.test(out3), out3.slice(0, 200));
    ok('但会给出「看不透」的提示', /看不透|看不出|素不相识|交情尚浅/.test(out3), out3.slice(0, 240));

    /* 提到中途交情应该能解锁一半 */
    n3.favor = 20;
    const out4 = txt(e3.exec('看 ' + n3.name));
    ok('交情尚浅：仍不给级别，但换一句提示', !/登峰造极/.test(out4) && /交情尚浅/.test(out4), out4.slice(0, 240));
  }

  /* ---------- ④ 描述不许出戏 ---------- */
  sec('④ 外貌描述不出戏');
  {
    let bad = [];
    for (const id of Object.keys(w.data.npcs)) {
      const d = w.data.npcs[id];
      if (/说到.{1,8}就/.test(d.desc || '')) bad.push(id);
    }
    ok('无「说到X就Y」模板句', bad.length === 0, bad.slice(0, 5).join(', '));
    let dup = [];
    for (const id of Object.keys(w.data.npcs)) {
      const d = w.data.npcs[id];
      if (/[。，、！？]{2,}/.test(d.desc || '')) dup.push(id);
    }
    ok('无连续重复标点', dup.length === 0, dup.slice(0, 5).join(', '));
  }
}

/* ---------- ⑤ 裸词「细看」也是看（主人真机 2026-10-13）---------- */
sec('⑤ 裸词「细看」并入 look 别名表');
{
  const e4 = boot(77);
  const bare = txt(e4.exec('细看'));
  ok('裸「细看」= 看房间（不报不是指令）', /【/.test(bare) && !/不懂|不是指令|没明白/.test(bare), bare.slice(0, 60));
  const v4 = e4.view();
  const someone = (v4.npcs || [])[0];
  if (someone) {
    const r = e4.exec('细看 ' + someone.name);
    ok('「细看 <人名>」照常走人物详情', (r.lines || []).length > 0 && !/不懂|不是指令/.test(txt(r)), txt(r).slice(0, 60));
  }
}

/* 拿一个确定存在的 key 备用（找不到就返回 undefined，不影响主流程） */

console.log('\n' + '='.repeat(48));
console.log(`  看/详情 回归: ${pass} 通过 / ${fail} 失败`);
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);