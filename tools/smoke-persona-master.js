/**
 * smoke-persona-master.js — 性格相性 + 拜师/请教/练武学 专项回归
 *
 * 覆盖主人 2026-10-08 的两块新需求：
 *   · 性格分类 / 初见增降好感 / 触发后的神态 / 主角也有性格
 *   · 拜师 → 请教（必定成功、已会不可请教、整条 base 链一并给）→ 练武学（连练/停手/加速）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));
const practice = require(path.join(ROOT, 'game/src/core/practice.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) { pass++; } else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
engine.newGame({ name: '小鱼', gender: '男', identity: 'zhuangyuan' });
const w = engine.world, p = w.player;

console.log('===== ① 性格分类 =====');
{
  const names = Object.values(P.PERSONALITIES).map(x => x.name);
  ok('九种性格都在', names.length === 9, names.join('/'));
  const grouped = Object.values(P.PERSONA_GROUPS).flatMap(g => g.personas);
  ok('每组列出的性格都是真性格', grouped.every(g => P.PERSONALITIES[g]), grouped.join(','));
  const uniq = new Set(grouped);
  ok('九种性格一个不漏地归了组', uniq.size === 9, [...uniq].length);
  ok('四种分组', Object.keys(P.PERSONA_GROUPS).length === 4, Object.keys(P.PERSONA_GROUPS).join('/'));
  ok('反查表能把每个性格映射回组', names.every((_, i) => !!P.groupOf(Object.keys(P.PERSONALITIES)[i])));
  ok('组名给得出', Object.values(P.PERSONA_GROUPS).every(g => P.groupName(g.id) === g.name));
}

console.log('===== ② 初见相性 =====');
{
  const a1 = P.affinityOf('xiayi', 'yinzhi');
  ok('侠义 × 阴鸷：点名特例生效且为负', a1.delta === -8 && a1.kind === 'pair', JSON.stringify(a1.delta));
  ok('侠义 × 阴鸷：有神态文案', typeof a1.react === 'string' && a1.react.length > 8);
  const a2 = P.affinityOf('haoshuang', 'haoshuang');
  ok('豪爽 × 豪爽：一见如故为正', a2.delta > 0, a2.delta);
  const a3 = P.affinityOf('xiayi', 'haoshuang');
  ok('同组（刚直）走得近', a3.delta > 0, a3.delta);
  const a4 = P.affinityOf('xiayi', 'youhua');
  ok('刚直 × 机巧：不对路为负', a4.delta < 0, a4.delta);
  ok('相性表是对称的', P.affinityOf('yinzhi', 'xiayi').delta === a1.delta);
  ok('每一条组规则都写了神态', Object.values(P.GROUP_AFFINITY).every(v => v.react && v.react.length > 6));
  ok('每一条点名特例都写了神态', Object.values(P.PAIR_AFFINITY).every(v => v.react && v.react.length > 6));
  /* 四组两两都有规矩：不能有「见了面没反应」的空白组合 */
  const gs = Object.keys(P.PERSONA_GROUPS);
  let missing = [];
  for (let i = 0; i < gs.length; i++) for (let j = i; j < gs.length; j++) {
    if (!P.GROUP_AFFINITY[[gs[i], gs[j]].sort().join('|')]) missing.push(gs[i] + '|' + gs[j]);
  }
  ok('四种分组两两之间都有规矩', missing.length === 0, missing.join(','));
}

console.log('===== ③ 主角性格 + 初见触发 =====');
{
  ok('主角有性格', !!P.personalityOf(p), p.personality);
  ok('主角性格能归组', !!P.groupName(P.groupOf(P.personaIdOf(p))));
  /* 找一个会功夫、不敌对的人拜师 */
  const def = Object.values(w.data.npcs).find(d => d.id === 'master_yue');
  w.movePlayerTo(p, def.room, { silent: true });
  const before = Object.keys(p.vars.metPersona || {}).length;
  const r = w.movePlayerTo(p, def.room, { silent: true });   // 再来一次，已见就不该重复
  const after = Object.keys(p.vars.metPersona || {}).length;
  ok('初见记录会写进 vars.metPersona', after >= before);
  /* 直接调一次，验证「同一个人只结算一次」 */
  const live = w.spawnNpc('master_yue', def.room, 1);
  const first = P.meetAffinity(w, p, live);
  const second = P.meetAffinity(w, p, live);
  ok('同一个人只结算一次', second === null, JSON.stringify(second));
}

console.log('===== ④ 拜师 =====');
let master = null;
{
  master = w.spawnNpc('master_yue', p.room, 1);
  master.favor = 0;
  const r0 = engine.exec('拜师 岳不群');
  ok('好感不够时拒绝', r0.lines.some(l => /萍水相逢/.test(l.text || '')), (r0.lines[0] || {}).text);
  ok('拒绝时给出所需好感', r0.lines.some(l => /好感需 15/.test(l.text || '')));

  master.favor = 60;
  const r1 = engine.exec('拜师 岳不群');
  ok('好感够了可以拜师', !!p.masters && !!p.masters['master_yue'], JSON.stringify(p.masters));
  ok('拜师有磕头的戏', r1.lines.some(l => /磕了三个头/.test(l.text || '')));
  ok('重复拜师被拦', engine.exec('拜师 岳不群').lines.some(l => /已拜过/.test(l.text || '')));
}

console.log('===== ⑤ 请教 =====');
{
  const r = engine.exec('请教 岳不群');
  ok('拜师后面板标注「师父必教」', r.lines.some(l => /师父必教/.test(l.text || '')));
  ok('拜师后提示用请教', r.lines.some(l => /请教 岳不群/.test(l.text || '')));

  const r2 = engine.exec('请教 岳不群 养吾剑法');
  const learned = sid => !!(p.learned[sid]);
  ok('请教必定学会（不看好感/钱）', Object.keys(p.learned).some(k => (w.getSkill(k) || {}).name === '养吾剑法'), Object.keys(p.learned).join(','));
  ok('学到的就是 1 级', Object.values(p.learned).some(v => v.level === 1));
  ok('整条 base 链一并给了', Object.keys(p.learned).some(k => (w.getSkill(k) || {}).id === 'basic_sword'), Object.keys(p.learned).map(k => (w.getSkill(k) || {}).name).join(','));

  const r3 = engine.exec('请教 岳不群 养吾剑法');
  ok('已学会的不能再请教', r3.lines.some(l => /已学过/.test(l.text || '')), (r3.lines[0] || {}).text);
  ok('被拒时不误教别的功夫', !r3.lines.some(l => /你学会了/.test(l.text || '')));
}

console.log('===== ⑥ 练武学 =====');
{
  const list = practice.listFor(w, p);
  ok('面板清单非空', list.length > 0, list.length);
  ok('清单每项都有 level/cap', list.every(x => typeof x.level === 'number' && typeof x.cap === 'number'));

  p.maxMpBase = 1500; p.recalc(); p.mp = p.maxMp;
  const swordId = 'basic_sword';
  const before = p.learned[swordId].level;
  const r = practice.practice(w, p, swordId);
  ok('能练起来（涨了级）', p.learned[swordId].level > before, before + ' → ' + p.learned[swordId].level);
  ok('练了不止一轮（内力够就一直练）', r.rounds > 1, r.rounds);
  ok('内力真的被消耗', r.mpUsed > 0, r.mpUsed);
  ok('结算文案里有等级变化', r.lines.some(l => /→/.test(l.text || '')));

  /* 内力见底就停 */
  p.mp = 0;
  const r2 = practice.practice(w, p, swordId);
  ok('内力不足时不空转', r2.rounds === 0, r2.rounds);
  ok('内力不足的说明用「内力耗尽」', r2.lines.some(l => /内力耗尽/.test(l.text || '')), (r2.lines[0] || {}).text);

  /* 内力上限越高练得越快（同 seed 的两份世界，只差内力上限） */
  const probe = (mpBase) => {
    const e2 = new GameEngine({ seed: 999 });
    e2.boot(); e2.newGame({ name: 'x', gender: '男', identity: 'zhuangyuan' });
    const p2 = e2.world.player;
    p2.learnSkill('basic_sword', { force: true });
    p2.maxMpBase = mpBase; p2.recalc(); p2.mp = p2.maxMp;
    const b = p2.learned['basic_sword'].level;
    practice.practice(e2.world, p2, 'basic_sword');
    return p2.learned['basic_sword'].level - b;
  };
  const slow = probe(0);
  const fast = probe(4000);
  ok('内力上限高的练得更快', fast > slow, `上限0→${slow}级 / 上限4000→${fast}级`);

  /* 战斗态不让练 */
  w.battle = { turns: 1 };
  const rb = practice.practice(w, p, swordId);
  ok('交手中不让练', rb.ok === false, JSON.stringify(rb.reason));
  w.battle = null;

  const miss = practice.practice(w, p, 'nonexistent_skill');
  ok('练不存在的武学被拦', miss.ok === false);
}

console.log(`\n===== smoke-persona-master: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
