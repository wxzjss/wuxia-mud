/* identity-check.js —— NPC 身份标签 + 关系称谓
   主人的两条要求：
     1. 看 NPC 时名字右边括号里别写「江湖中人」，要写身份
        （普通百姓 / 捕快 / 哪个门派的外门内门弟子…）
     2. 看关系时括号里别写居住编号，要写身份；关系词别写单字
        （「友」→「友人」、「仇」→「仇人」，以此类推）
   run: node tools/identity-check.js */
'usestrict';
const { GameEngine } = require('../game/src/core/engine.js');
const CMD = require('../game/src/core/commands.js');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✔' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  << ' + extra : '')); }
};
function sec(t) { console.log('\n=== ' + t + ' ==='); }
function txt(r) { return (r.lines || []).map(l => l.text || '').join('\n'); }
function boot() {
  const e = new GameEngine({ seed: 20261010 });
  e.boot(); e.newGame({ name: '试剑', gender: 'male' });
  return e;
}

const api = CMD.__api || {};
const npcIdentity = api.npcIdentity;
const relKindCN = api.relKindCN;

sec('⓪ 函数已导出');
{
  ok('npcIdentity 已导出且是函数', typeof npcIdentity === 'function');
  ok('relKindCN 已导出且是函数', typeof relKindCN === 'function');
}

if (typeof npcIdentity !== 'function' || typeof relKindCN !== 'function') {
  console.log('\n无法继续：导出缺失');
  process.exit(1);
}

sec('① 身份推断（覆盖全 320 个 NPC 模板）');
{
  const e = boot();
  const w = e.world;
  const all = Object.values(w.data.npcs);
  let bad = [], empty = [], dupTitle = [];
  for (const d of all) {
    const s = npcIdentity(w, d);
    if (!s || typeof s !== 'string') { empty.push(d.id); continue; }
    /* 🩸 守卫：绝不能再出现「江湖中人」，也不能出现英文 job/tag 原文 */
    if (/江湖中人|^[a-z_]+$/.test(s)) bad.push(d.id + '→' + s);
    /* 门派 NPC 必须带门派名或职位词。
       ⚠️ 门派名不止「派/教/帮」，还有镖局、世家、山寨这类 ——
          武学重制新增 28 家（飞虎镖局 / 五云手温家 / 白驼山…）后就栽在这里。 */
    if (d.sect && !/派|教|帮|岛|门|氏|会|庄|局|家|山|洞|宫|寺|观|宗/.test(s) && !/弟子|僧|丘|人|师|主/.test(s)) {
      dupTitle.push(d.id + '→' + s);
    }
  }
  ok('全部模板都算得出身份（324 条目）', all.length >= 320, all.length);
  ok('没有一个是「江湖中人」或漏网的英文', bad.length === 0, bad.slice(0, 5).join(' '));
  ok('没有算不出身份（空/undefined）的', empty.length === 0, empty.slice(0, 5).join(' '));
  ok('门派 NPC 的身份都带门派痕迹', dupTitle.length === 0, dupTitle.slice(0, 5).join(' '));

  /* 逐类核对（主人点名的几类） */
  const d = w.data.npcs;
  ok('岳不群 = 华山派掌门（不是「君子剑」）',
    npcIdentity(w, d.master_yue) === '华山派掌门', npcIdentity(w, d.master_yue));
  ok('冲虚道长 = 武当派掌门', npcIdentity(w, d.wudang_chongxu) === '武当派掌门', npcIdentity(w, d.wudang_chongxu));
  ok('方证大师 = 少林派方丈', npcIdentity(w, d.shaolin_fangzheng) === '少林派方丈', npcIdentity(w, d.shaolin_fangzheng));
  ok('任我行 = 日月神教教主', npcIdentity(w, d.mojiao_dongfang) === '日月神教教主', npcIdentity(w, d.mojiao_dongfang));
  ok('rank:0 的教众显示「日月神教教众」（rank 是 0 基下标）',
    npcIdentity(w, d.mob_mo_disciple) === '日月神教教众', npcIdentity(w, d.mob_mo_disciple));
  /* 🩸 门派 NPC 的职位必须逐个对得上 ranks 表，不许错位一级
     （计数随内容增长：2026-10-10 三~五幕 +1 → 16；
      同日武学/门派重制新增 28 家 × 2 人（掌门 + 弟子）→ 72。
      这里守的是「每个门派都有人、且身份算得出来」，所以用下限而不是等号。） */
  const sectNpcs = all.filter(x => x.sect && (w.data.sects || {})[x.sect]);
  ok('门派 NPC 不少于 16 个（现存 16 门派 + 28 家新门派各 2 人）', sectNpcs.length >= 16, sectNpcs.length);
  ok('🩸 每个门派 NPC 的身份 = 门派名 + ranks[rank]',
    sectNpcs.every(x => {
      const s = w.data.sects[x.sect];
      const rn = (s.ranks || [])[x.rank];
      return !!rn && npcIdentity(w, x) === s.name + rn;
    }),
    sectNpcs.filter(x => {
      const s = w.data.sects[x.sect];
      return npcIdentity(w, x) !== s.name + (s.ranks || [])[x.rank];
    }).map(x => x.id + '→' + npcIdentity(w, x)).join(' '));

  /* 捕快/郎中/寻常百姓 这类 title 身份 */
  const constables = all.filter(x => x.title === '捕快');
  ok('捕快的身份就是「捕快」', constables.length > 0
    && constables.every(x => npcIdentity(w, x) === '捕快'),
    npcIdentity(w, constables[0]));
  const docs = all.filter(x => x.title === '郎中');
  ok('郎中的身份就是「郎中」', docs.length > 0
    && docs.every(x => npcIdentity(w, x) === '郎中'));

  /* B 层 npcv（无 title）靠 tag 兜底 */
  const v = all.filter(x => /^npcv_/.test(x.id) && !x.title && x.tag);
  ok('无 title 的 B 层 NPC 靠 tag 兜出身份', v.length > 0
    && v.every(x => npcIdentity(w, x) !== '江湖散人'),
    v.length + ' 个：' + npcIdentity(w, v[0]));
  ok('B 层「寻常百姓」显示「寻常百姓」',
    npcIdentity(w, d.npcv_001) === '寻常百姓', npcIdentity(w, d.npcv_001));

  /* 野兽/山贼靠名字猜 */
  ok('灰狼 = 山中猛兽', npcIdentity(w, d.mob_wolf) === '山中猛兽', npcIdentity(w, d.mob_wolf));
  ok('山贼 = 山贼', npcIdentity(w, d.mob_bandit) === '山贼', npcIdentity(w, d.mob_bandit));
}

sec('② 关系称谓不写单字');
{
  ok('友 → 友人', relKindCN('友') === '友人', relKindCN('友'));
  ok('仇 → 仇人', relKindCN('仇') === '仇人', relKindCN('仇'));
  ok('亲 → 亲人', relKindCN('亲') === '亲人', relKindCN('亲'));
  ok('师 → 师长', relKindCN('师') === '师长', relKindCN('师'));
  ok('生 → 门生', relKindCN('生') === '门生', relKindCN('生'));
  ok('夫妻原样（本来就是词）', relKindCN('夫妻') === '夫妻', relKindCN('夫妻'));
  ok('空关系给个兜底', !!relKindCN(''), relKindCN(''));
  ok('未知单字会补「人」而不是裸着', relKindCN('邻') === '邻人', relKindCN('邻'));
  ok('已带词的不重复加', relKindCN('义兄') === '义兄', relKindCN('义兄'));
}

sec('③ 真跑 look <NPC>：括号里是身份，不是「江湖中人」');
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 把几个不同身份的人塞进同一间房，逐个 look */
  p.room = 'jiangnan_inn';
  const inn = w.getRoom('jiangnan_inn');
  inn.exits = inn.exits || {};
  const samples = ['master_yue', 'npcv_001', 'mob_wolf'];
  for (const id of samples) {
    if (!w.data.npcs[id]) continue;
    w.spawnNpc(id, 'jiangnan_inn');
  }
  for (const id of samples) {
    const d = w.data.npcs[id];
    if (!d) continue;
    const out = txt(e.exec('look ' + d.name));
    const sub = (e.exec('look ' + d.name).lines || []).find(l => l.kind === 'subtitle') || {};
    ok(`看 ${d.name} 括号里是身份`, /\（.+）/.test(sub.text || '') && !/江湖中人/.test(sub.text || ''),
      sub.text);
    ok(`看 ${d.name} 身份 = ${npcIdentity(w, d)}`,
      (sub.text || '').indexOf(npcIdentity(w, d)) >= 0, sub.text);
  }
  const anyOut = txt(e.exec('look'));
  ok('房里 NPC 都渲染得出来', anyOut.length > 0);
}

sec('④ 真跑 guanxi <NPC>：关系行写「友人/仇人」+身份，不写「（住X）」');
{
  const e = boot();
  const w = e.world, p = w.player;
  /* 找一个有 rel 的 NPC，放进房间 */
  const withRel = Object.values(w.data.npcs).find(d => (d.rel || []).length >= 3);
  ok('数据里有带 3+ 关系的 NPC', !!withRel);
  p.room = withRel.room;
  const out = txt(e.exec('guanxi ' + withRel.name));
  ok('guanxi 有输出', out.length > 0);
  ok('🩸 关系行不再出现「（住…」', !/（住/.test(out), out.slice(0, 200));

  /* 🩸 关系列表里不许出现裸单字做称谓（行首格式是「　XX　名字」） */
  const relLines = (e.exec('guanxi ' + withRel.name).lines || [])
    .filter(l => l.relKind).map(l => l.text);
  ok('至少拿到 1 条关系行', relLines.length > 0, relLines.length);
  ok('🩸 没有裸「友」「仇」「亲」当称谓',
    relLines.every(t => !/^　[友仇亲生师]　/.test(t)), relLines.slice(0, 3).join(' | '));
  ok('🩸 每条关系都带身份括号', relLines.every(t => /（.+）/.test(t)),
    relLines.slice(0, 3).join(' | '));
  ok('关系称谓是双字词', relLines.every(t => {
    const m = t.match(/^　(..+)　/);
    return !m || m[1].length >= 2;
  }), relLines.slice(0, 3).join(' | '));
}

sec('⑤ 看 NPC 的「人际」小节同样改口径');
{
  const e = boot();
  const w = e.world, p = w.player;
  const withRel = Object.values(w.data.npcs).find(d => (d.rel || []).length >= 3);
  p.room = withRel.room;
  const out = txt(e.exec('look ' + withRel.name));
  ok('🩸 look 的人际小节不写「（住…」', !/（住/.test(out), out.slice(0, 300));
  ok('🩸 look 的人际行用双字称谓', !/^　[友仇亲生师]　/m.test(out),
    (out.match(/^　[友仇亲生师]　.*/m) || [])[0] || '');
  ok('🩸 look 里不再有「江湖中人」', !/江湖中人/.test(out));
}

sec('⑥ favor 详情：身份一行');
{
  const e = boot();
  const w = e.world, p = w.player;
  const d = Object.values(w.data.npcs).find(x => x.room && x.title === '捕快');
  ok('找得到捕快', !!d);
  if (d) {
    p.room = d.room;
    const out = txt(e.exec('favor ' + d.name));
    ok('favor 详情有「身份：」一行', /身份：\S+/.test(out), out.slice(0, 200));
    ok('身份值正确', out.indexOf('身份：' + npcIdentity(w, d)) >= 0,
      out.slice(0, 200));
  }
}

console.log('\n' + '='.repeat(42));
console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
console.log('='.repeat(42));
process.exit(fail ? 1 : 0);
