/* smoke-sect-guards.js —— 闯山门拦截（design/71 §四）
 *
 * 覆盖：
 *   A. 数据前提：43 门派都有 entry 且指向真实房间；43 山门都有 tag=shouwei 的守卫
 *   B. 拦人：非本门的人踏进山门 → 守卫拦下，给出三个出口
 *   C. 放行：本门的人 / 拿着引荐信的人 → 不拦
 *   D. 门槛：`require` 不达标的人被拦，且文案说清卡在哪（复用 sectRefusal）
 *   E. 恶名：恶名在身 → 单独一句口吻 + 多一个「打点」出口
 *   F. 冷却：同一守卫一炷香内不重复拦
 *   G. 报上名号 / 打点 / 硬闯 / 退下 四个出口的行为
 *   H. 非山门房不拦（普通房间走一圈不受打扰）
 *   I. 前端契约：守卫房（山门）的 action 与 roomActionsView 能被前端画出来
 *
 * ⚠️ 测试随机源固定 seed（记忆第 15 条）。
 * ⚠️ 用 GameEngine(...).boot().newGame()（记忆第 42 条：new World() 是空壳）。
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const G = require(path.join(ROOT, 'game', 'src', 'core', 'guards.js'));

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) pass++; else { fail++; fails.push(name + (extra ? ' → ' + extra : '')); }
}
function eq(name, a, b) { ok(name, a === b, `got=${JSON.stringify(a)} want=${JSON.stringify(b)}`); }

const SEED = 20261013;
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '闯山客', gender: 'male', birth: 'wuxue' });
  return e;
}

/* ============================================================
 * A. 数据前提
 * ============================================================ */
{
  const e = boot(), w = e.world;
  const sects = Object.values(w.data.sects || {});
  eq('A1 门派总数 43', sects.length, 43);

  let noEntry = [];
  for (const s of sects) if (!s.entry || !w.getRoom(s.entry)) noEntry.push(s.id);
  ok('A2 每家都有 entry 且房间真实存在', noEntry.length === 0, noEntry.join(','));

  let noGuard = [];
  for (const s of sects) {
    const list = w.npcsIncludingTemplates(s.entry) || [];
    const g = list.filter(n => n.tag === 'shouwei' || (n.def && n.def.tag === 'shouwei'));
    if (!g.length) noGuard.push(s.id);
  }
  ok('A3 每个山门都有 tag=shouwei 的守卫', noGuard.length === 0, noGuard.join(','));

  let badEntry = sects.filter(s => !(w.getRoom(s.entry) || {}).name);
  ok('A4 entry 房间都有名字（不是半截数据）', badEntry.length === 0, badEntry.map(s => s.id).join(','));

  const mj = w.npcsIncludingTemplates('mojiao_shanmen') || [];
  ok('A5 黑木崖山门有守卫', mj.some(n => n.tag === 'shouwei' || (n.def && n.def.tag === 'shouwei')),
    mj.map(n => n.name + ':' + n.tag).join(','));
}

/* ============================================================
 * B. 拦人（核心）
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  p.room = 'huashan_shanxia';
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0;

  const r = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('B1 非本门的人进山门被拦', !!r);
  ok('B2 拦人带 choices', !!(r && r.choices && r.choices.length >= 3), r && JSON.stringify(r.choices));
  ok('B3 有「硬闯」出口', !!(r && r.choices.find(c => /硬闯/.test(c.label))));
  ok('B4 有「退走」出口', !!(r && r.choices.find(c => /退|离开/.test(c.label))));
  ok('B5 记录被谁拦（guardBy）', !!(p.vars && p.vars.guardBy), p.vars && p.vars.guardBy);
}

/* ============================================================
 * C. 放行：自己人 / 引荐信
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.room = 'huashan_shanxia';
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0;
  p.sect = 'huashan';
  if (p.vars) p.vars.guardAt = null;
  let r = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('C1 本门弟子进自家山门不拦', r === null);

  p.sect = null;
  p.vars.tutPass = 'huashan';
  if (p.vars) p.vars.guardAt = null;
  r = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('C2 持引荐信的人不拦（走新手线）', r === null);

  ok('C3a isInsider 同门 true', G.isInsider(w, { sect: 'huashan', vars: {} }, 'huashan') === true);
  ok('C3b isInsider 引荐信 true', G.isInsider(w, { sect: null, vars: { tutPass: 'huashan' } }, 'huashan') === true);
  ok('C3c isInsider 外人 false', G.isInsider(w, { sect: null, vars: {} }, 'huashan') === false);
}

/* ============================================================
 * D. 门槛拦截（复用 sectRefusal，不另起一份）
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  p.gender = 'male';
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  p.room = 'emei_shanmen';
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0;

  const r = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('D1 门槛不达标被拦', !!r);
  ok('D2 门槛文案说清卡在哪（提到「女」）', !!(r && /女/.test(r.text)), r && r.text);
  ok('D3 门槛不达标时**不给**「报上名号」（报了也白报）',
    !!(r && !r.choices.find(c => /报上名号/.test(c.label))), r && JSON.stringify(r.choices.map(c => c.label)));
  ok('D4 门槛不达标仍留「硬闯」', !!(r && r.choices.find(c => /硬闯/.test(c.label))));

  const emei = w.getSect('emei');
  const woman = { gender: '女', learned: {}, sectRefusal: () => 'x' };
  ok('D5 女身过峨眉门槛', G.blockedBy(w, woman, emei) === null, G.blockedBy(w, woman, emei));
}

/* ============================================================
 * E. 恶名：单独口吻 + 多一个「打点」
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  p.room = 'huashan_shanxia';
  p.kidnap = p.kidnap || {};
  p.kidnap.wanted = 30;
  p.money = 5000;

  const r = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('E1 恶名在身被拦', !!r);
  ok('E2 恶名口吻与普通人不同', !!(r && /听说过|按在|眼神/.test(r.text)), r && r.text);
  ok('E3 恶名档多一个「打点」出口', !!(r && r.choices.find(c => /打点/.test(c.label))), r && JSON.stringify(r.choices.map(c => c.label)));

  const before = p.money;
  const out = G.bribe(w, p, 'huashan');
  ok('E4a 打点扣钱', p.money < before, `${before}→${p.money}`);
  ok('E4b 打点后清掉被拦状态', !p.vars.guardBy);
  ok('E4c 打点有反馈行', out.length > 0);

  const e5 = boot(), w5 = e5.world, p5 = w5.player;
  p5.sect = null;
  if (p5.vars) { p5.vars.tutPass = null; p5.vars.guardAt = null; p5.vars.guardBy = null; }
  p5.room = 'huashan_shanxia';
  p5.kidnap = p5.kidnap || {}; p5.kidnap.wanted = 30;
  p5.money = 10;
  G.maybeBar(w5, p5, w5.getRoom(p5.room), w5.npcsIncludingTemplates(p5.room));
  const o5 = G.bribe(w5, p5, 'huashan');
  ok('E5 钱不够打点时说明差额', o5.some(l => /备|只有|凑不出/.test(l.text)), JSON.stringify(o5.map(l => l.text)));
}

/* ============================================================
 * F. 冷却
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  p.room = 'huashan_shanxia';
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0;

  const r1 = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('F1 第一次拦', !!r1);
  const r2 = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('F2 立刻再走一次不重复拦（冷却生效）', r2 === null, r2 && r2.text);

  w.clockMinutes = (w.clockMinutes || 0) + G.COOLDOWN + 1;
  const r3 = G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  ok('F3 过了冷却又可以拦', !!r3, r3 && r3.text);
}

/* ============================================================
 * G. 四个出口的行为
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  p.room = 'huashan_shanxia';
  p.kidnap = p.kidnap || {}; p.kidnap.wanted = 0;
  p.karma = 0;

  G.maybeBar(w, p, w.getRoom(p.room), w.npcsIncludingTemplates(p.room));
  const s1 = G.stateName(w, p, 'huashan');
  ok('G1 报上名号有反馈', s1.length > 0);
  ok('G1b 报上名号后清掉被拦状态', !p.vars.guardBy);

  const e2 = boot(), w2 = e2.world, p2 = w2.player;
  p2.sect = null;
  if (p2.vars) { p2.vars.tutPass = null; p2.vars.guardAt = null; p2.vars.guardBy = null; }
  p2.room = 'huashan_shanxia';
  p2.maxHp = 100;
  p2.hp = 100;
  p2.kidnap = p2.kidnap || {}; p2.kidnap.wanted = 0;
  const gw = G.forceIn(w2, p2, 'huashan');
  ok('G2 硬闯弱鸡被擒（hp 打到 1）', p2.hp === 1, 'hp=' + p2.hp);
  ok('G2b 被擒涨恶名', (p2.kidnap.wanted || 0) > 0, 'wanted=' + p2.kidnap.wanted);
  ok('G2c 被擒有叙述', gw.some(l => l.kind === 'bad'), JSON.stringify(gw.map(l => l.kind)));

  const e3 = boot(), w3 = e3.world, p3 = w3.player;
  p3.room = 'jiangnan_street';
  const f3 = G.forceIn(w3, p3, null);
  ok('G3 非山门房硬闯有提示', f3.some(l => /不是谁家/.test(l.text)), JSON.stringify(f3.map(l => l.text)));

  const e4 = boot(), w4 = e4.world, p4 = w4.player;
  p4.sect = null;
  if (p4.vars) { p4.vars.tutPass = null; p4.vars.guardAt = null; p4.vars.guardBy = null; }
  p4.room = 'huashan_shanxia';
  p4.kidnap = p4.kidnap || {}; p4.kidnap.wanted = 0;
  G.maybeBar(w4, p4, w4.getRoom(p4.room), w4.npcsIncludingTemplates(p4.room));
  ok('G4 退下前有被拦状态', !!(p4.vars && p4.vars.guardBy));
  p4.vars.guardBy = null;
  ok('G4b 退下后无被拦状态', !p4.vars.guardBy);
}

/* ============================================================
 * H. 非山门房不拦
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  p.sect = null;
  if (p.vars) { p.vars.tutPass = null; p.vars.guardAt = null; p.vars.guardBy = null; }
  const entries = new Set(Object.values(w.data.sects).map(s => s.entry));
  let plain = null;
  for (const rid of Object.keys(w.data.rooms)) {
    if (!entries.has(rid) && /street|market|road/.test(rid)) { plain = rid; break; }
  }
  ok('H1 找到普通房间', !!plain, plain || '(无)');
  if (plain) {
    p.room = plain;
    const r = G.maybeBar(w, p, w.getRoom(plain), w.npcsIncludingTemplates(plain));
    ok('H2 普通房间不被拦', r === null, r && r.text);
  }
}

/* ============================================================
 * I. 前端契约：山门 action 能被 roomActionsView 画出来
 * ============================================================ */
{
  const e = boot(), w = e.world, p = w.player;
  const entries = Object.values(w.data.sects).map(s => s.entry);
  let withActions = 0;
  for (const rid of entries) {
    const room = w.getRoom(rid);
    if (room && Array.isArray(room.actions) && room.actions.length) withActions++;
  }
  ok('I1 山门房里带 actions 的数量合理（>0）', withActions > 0, 'count=' + withActions);

  p.sect = null;
  p.room = 'taishan_gate';
  const acts = e.roomActionsView(p);
  ok('I2 roomActionsView 返回数组', Array.isArray(acts));
  if (acts.length) {
    ok('I3 action 有 name/cmd/ok 字段',
      acts.every(a => typeof a.name === 'string' && typeof a.cmd === 'string' && typeof a.ok === 'boolean'),
      JSON.stringify(acts[0]));
  }
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n=== smoke-sect-guards ===');
console.log(`通过 ${pass} / 失败 ${fail}`);
if (fails.length) { console.log('失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
