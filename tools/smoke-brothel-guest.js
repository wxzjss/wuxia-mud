/* ============================================================
 * smoke-brothel-guest.js — 青楼「接客」接真实客人（主人 2026-10-11）
 *
 * 主人原话：
 *   「青楼『接客』抓取附近单身异性 npc（根据 npc 设定来）接真实的客人
 *    （然后该 npc 身上的钱会真实花掉一些，增加双方好感，且下次遇到该 npc 时
 *      屏幕上会显示该 npc 看到你后的调侃语气语言表情动作等表现）」
 *
 * 盯四件事：
 *   ① 挑的是**附近单身异性的人**（兽、已婚、同性、倒地、店主、楼里自家人都不算）
 *   ② 他的钱**真的少了**（不是凭空印给玩家的）
 *   ③ 两边好感**真涨**、这桩事**记在他身上**
 *   ④ 下回碰面，他**真能拿这个打趣你**（且三天之内只说一回）
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const WORK = require(path.join(ROOT, 'game', 'src', 'core', 'work.js'));
const MEM = require(path.join(ROOT, 'game', 'src', 'core', 'npcMemory.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);
const txt = r => (r && r.lines || []).map(l => l.text || '').join('\n');

const SEED = 20261018;

/** 把玩家摆进一家真青楼，并给他一个「已卖身」的身份 */
function intoBrothel(e) {
  const w = e.world, p = w.player;
  const roomId = Object.keys(w.data.rooms).find(id => WORK.isBrothel(w, id));
  if (!roomId) throw new Error('数据里找不到青楼房间');
  /* 直接摆过去（不走 movePlayerTo：那条路上有遭遇战/剧情，测试里不需要） */
  p.room = roomId;
  p.prostitution = { sold: true, brothelRoom: roomId, debt: 1600, served: 0, earnings: 0 };
  /* 把屋里楼里的人清走，免得挑客挑到老鸨头上 */
  for (const n of (w.npcsIn(roomId) || [])) { n.room = '__gone__'; }
  return { w, p, roomId };
}

/** 造一个合乎规矩的客人：异性、单身、有现钱 */
function makeGuest(w, roomId, defId, gender, money) {
  const n = w.spawnNpc(defId, roomId);
  n.gender = gender;
  n.spouse = null;
  if (n.def) { n.def = Object.assign({}, n.def, { spouse: null, tag: 'swordsman' }); }
  n.shop = false;
  n.carry = { money: money, items: [] };
  n.favor = 0;
  return n;
}
function boot() {
  const e = new GameEngine({ seed: SEED });
  e.boot();
  e.newGame({ name: '试剑', gender: 'male', birth: 'wuxue' });
  e.world.player.hp = e.world.player.maxHp;
  return e;
}

/* ================= ① 挑客的规矩 ================= */
section('① 谁才算客人');
{
  const e = boot();
  const { w, p, roomId } = intoBrothel(e);

  ok('兽类不算人', !WORK.isPersonGuest({ name: '一条花斑毒蛇', gender: 'other' }));
  ok('倒地的算不了客', !WORK.isPersonGuest({ name: '张三', gender: 'female', knockedOut: true }));
  ok('活着的人算', !!WORK.isPersonGuest({ name: '李四', gender: 'female', carry: {} }));

  /* 屋里只有同性 → 挑不到 */
  makeGuest(w, roomId, 'npcv_001', 'male', 500);
  ok('★ 屋里只有同性 → 今晚没客（不硬凑）', WORK.pickGuest(w, p) === null);

  /* 来个异性但已婚 → 也不算 */
  const married = makeGuest(w, roomId, 'npcv_002', 'female', 500);
  married.spouse = 'someone';
  ok('★ 已婚的不接', WORK.pickGuest(w, p) === null);

  /* 单身异性 → 就是他 */
  const single = makeGuest(w, roomId, 'npcv_003', 'female', 500);
  single.def = Object.assign({}, single.def, { spouse: null });
  const got = WORK.pickGuest(w, p);
  ok('★ 单身异性被挑中', !!got && got.id === single.id, got && got.name);
}

/* ================= ② 接真客：钱真的花掉了 ================= */
section('② 真客：他的钱真花掉、债真还、好感真涨');
{
  const e = boot();
  const { w, p, roomId } = intoBrothel(e);
  const guest = makeGuest(w, roomId, 'npcv_003', 'female', 300);
  const purse0 = guest.carry.money;
  const debt0 = p.prostitution.debt;
  const fav0 = guest.favor || 0;
  const myMoney0 = p.money;

  const r = WORK.serveCustomer(w);
  const t = txt(r);

  ok('★ 接了这位真客（画面里报了他的名字）', t.indexOf(guest.name) >= 0, guest.name);
  ok('★ 他身上的钱真的少了', guest.carry.money < purse0, `${purse0} → ${guest.carry.money}`);
  ok('★ 少掉的那笔真进了这一晚的账', r.ok && p.prostitution.earnings > 0, 'earnings=' + p.prostitution.earnings);
  ok('★ 赎身债跟着减了', p.prostitution.debt < debt0, `${debt0} → ${p.prostitution.debt}`);
  ok('★ 两边好感涨了', (guest.favor || 0) > fav0, `${Math.round(fav0)} → ${Math.round(guest.favor || 0)}`);
  ok('★ 这桩事记在他身上（下次才有得打趣）',
    !!(guest.pstate && guest.pstate.brothelMet && guest.pstate.brothelMet.times === 1),
    JSON.stringify(guest.pstate && guest.pstate.brothelMet));
  ok('玩家的钱没被凭空加上去（进项全抵债）', p.money === myMoney0, `${myMoney0} → ${p.money}`);
}

/* ================= ③ 兜里干净的客人 ================= */
section('③ 身无分文的客人：白陪一场，但人情记下');
{
  const e = boot();
  const { w, p, roomId } = intoBrothel(e);
  const poor = makeGuest(w, roomId, 'npcv_004', 'female', 0);
  const r = WORK.serveCustomer(w);
  ok('照样接得下去（不卡玩法）', r.ok);
  ok('明说他掏不出钱', /一个钱也没翻出来/.test(txt(r)), (txt(r).match(/[^\n]*翻出来[^\n]*/) || [''])[0]);
  ok('★ 但人情记下了（好感涨得更实在）', (poor.favor || 0) > 0, String(Math.round(poor.favor || 0)));
  ok('这一晚没进项', p.prostitution.earnings === 0, 'earnings=' + p.prostitution.earnings);
}

/* ================= ④ 没人可接 → 退回过路的 ================= */
section('④ 夜里没客人走动：退回原来那几位过路的');
{
  const e = boot();
  const { w, p, roomId } = intoBrothel(e);
  const r = WORK.serveCustomer(w);
  ok('屋里屋外都没合适的人也能接（不让玩法空转）', r.ok);
  ok('用的是老那套模板客人', /——/.test(txt(r)), (txt(r).split('\n')[0] || '').slice(0, 24));
  ok('照样抵债', p.prostitution.earnings > 0, 'earnings=' + p.prostitution.earnings);
}

/* ================= ⑤ 下次碰面：他拿这个打趣你 ================= */
section('⑤ 下次碰面，他记得你');
{
  const e = boot();
  const { w, p, roomId } = intoBrothel(e);
  const guest = makeGuest(w, roomId, 'npcv_003', 'female', 300);
  WORK.serveCustomer(w);

  /* ⚠️ 不能拿「有没有『那晚』这种词」当断言 —— 温婉/怯懦那几档本来就写得含蓄
     （脸红、低头、走开），词面上根本不提那件事。判据要落在
     「这句确实出自**专门为这件事写的那池台词**」。 */
  const fromBrothelPool = (text, name) => {
    for (const k of Object.keys(MEM.BROTHEL_LINE || {})) {
      for (const t of MEM.BROTHEL_LINE[k]) {
        if (t.replace(/\{a\}/g, name) === text) return true;
      }
    }
    return false;
  };

  const g1 = MEM.greetLines(w, p, guest);
  ok('★ 一碰面就有话说', g1.length === 1, JSON.stringify(g1).slice(0, 60));
  ok('★ 说的正是楼里那回事（出自那池专用台词）', g1.length && fromBrothelPool(g1[0].text || '', guest.name),
    (g1[0] && g1[0].text || '').slice(0, 40));
  ok('用的是「说话」这一档（say）', g1.length && g1[0].kind === 'say');

  const g2 = MEM.greetLines(w, p, guest);
  ok('★ 三天之内不重复念同一桩（说完就收）', g2.length === 0 || !fromBrothelPool(g2[0].text || '', guest.name),
    g2.length ? g2[0].text.slice(0, 30) : '（这回他没提）');

  w.clockMinutes += 4 * 1440;
  const g3 = MEM.greetLines(w, p, guest);
  ok('★ 隔了几天再说，他还记得', g3.length === 1 && fromBrothelPool(g3[0].text || '', guest.name),
    (g3[0] && g3[0].text || '').slice(0, 34));

  /* 没在楼里见过的普通人，不该冒出这种话 */
  const stranger = makeGuest(w, roomId, 'npcv_005', 'female', 100);
  const g4 = MEM.greetLines(w, p, stranger);
  ok('没来过的人不会说这种话', !g4.length || !/那晚|上回|那日/.test(g4[0].text || ''),
    g4.length ? g4[0].text.slice(0, 26) : '（无话）');
}

/* ================= ⑥ 台词按人按次不重样 ================= */
section('⑥ 同一路人马，场面不重样');
{
  const kinds = ['official', 'warrior', 'merchant', 'scholar', 'monk', 'common'];
  let distinct = 0;
  for (const k of kinds) {
    const arr = WORK.GUEST_SCENE[k];
    if (Array.isArray(arr) && arr.length >= 2) distinct++;
  }
  ok('每一路人都写了好几场（不是一句话套所有）', distinct === kinds.length, distinct + '/' + kinds.length + ' 路');

  const e = boot();
  const { w, p, roomId } = intoBrothel(e);
  const guest = makeGuest(w, roomId, 'npcv_003', 'female', 2000);
  const seen = new Set();
  for (let i = 0; i < 3; i++) {
    guest.carry.money = 2000;
    const r = WORK.serveCustomer(w);
    const body = (r.lines.find(l => l.kind === 'story') || {}).text || '';
    if (body) seen.add(body.slice(0, 22));
  }
  ok('★ 同一位客人反复来，开场都不一样', seen.size >= 2, seen.size + ' 种');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
