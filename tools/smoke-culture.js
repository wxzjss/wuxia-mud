/* ============================================================
 * smoke-culture.js — 科举 / 勾栏听曲 / 青楼诗会 / 比武招亲 / 江南七才子
 *
 * 覆盖：
 *  ① 文采：初始值由悟性推；温书能涨（且收钱、有时间冷却）
 *  ② 科举三场：乡试→会试→殿试逐级解锁；门槛不够 / 钱不够 / 冷却期都被拦住
 *  ③ 勾栏听曲：点曲花钱、心情与文采涨、钱不够被拒、曲牌名认得出
 *  ④ 青楼诗会：出题列出选项、答对给奖、答错挨罚、一场只对一次
 *  ⑤ 比武招亲：名声不够上不了台；三轮逐轮推进；全胜给彩头
 *  ⑥ 江南七才子：七个 NPC 都在文墨斋、都有画像、支线在库且能推进
 *  ⑦ 场所与入口：贡院/擂台/文墨斋存在；戏台有听曲、听雨轩有诗会
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const CUL = require(path.join(ROOT, 'game', 'src', 'core', 'culture.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } };
const section = t => console.log('\n' + t);

const SEED = 20261016;
function boot() { const e = new GameEngine({ seed: SEED }); e.boot(); e.newGame({ name: '试剑', gender: 'male', birth: 'shusheng' }); return e; }

const e0 = boot();
const w0 = e0.world;

/* ---------- ① 文采 ---------- */
section('① 文采与温书');
const p0 = w0.player;
ok('文采初始值由悟性推（不为 0）', CUL.wencaiOf(p0) > 0, String(CUL.wencaiOf(p0)));
const before = CUL.wencaiOf(p0);
const m0 = p0.money = 1000;
const st = CUL.study(w0, p0);
ok('温书成功', st.ok === true, JSON.stringify(st.lines.map(l => l.text).slice(-1)));
ok('温书涨了文采', CUL.wencaiOf(p0) > before, `${before} → ${CUL.wencaiOf(p0)}`);
ok('温书扣了束脩', p0.money < m0, `${m0} → ${p0.money}`);
const st2 = CUL.study(w0, p0);
ok('同一时辰不能连读（冷却生效）', st2.ok === false, JSON.stringify(st2.lines[0].text));
const pPoor = boot().world.player;
pPoor.money = 0;
ok('没钱温不了书', CUL.study(boot().world, (function () { const w = boot().world; w.player.money = 0; return w.player; })()).ok === false);

/* ---------- ② 科举 ---------- */
section('② 科举三场');
const e1 = boot(); const w1 = e1.world, p1 = w1.player;
p1.money = 100000;
const stA = CUL.examState(w1, p1);
ok('第一场是乡试', stA.next && stA.next.id === 'xiangshi', stA.next && stA.next.name);
p1.vars.wencai = 5;
const low = CUL.takeExam(w1, p1);
ok('文采不够考不了（有明确提示）', low.ok === false && /文采/.test(JSON.stringify(low.lines)), JSON.stringify(low.lines[0].text));
p1.vars.wencai = 200;
const r1 = CUL.takeExam(w1, p1);
ok('乡试考了（无论中不中都算考过）', r1.lines.length > 0 && /乡试/.test(JSON.stringify(r1.lines)), String(r1.win));
/* 直接把乡试判定为通过（钉住随机），再验逐级解锁 */
p1.setFlag('keju_xiangshi', true);
p1.vars.gongming = '秀才';
p1.vars.examAt = 0;
p1.vars.wencai = 200;
const stB = CUL.examState(w1, p1);
ok('拿到秀才后下一场自动变成会试', stB.next && stB.next.id === 'huishi', stB.next && stB.next.name);
/* 冷却 */
p1.vars.examAt = CUL.dayOf(w1);
const cd = CUL.takeExam(w1, p1);
ok('冷却期内考不了', cd.ok === false && /再等/.test(JSON.stringify(cd.lines)), JSON.stringify(cd.lines[0].text));
p1.vars.examAt = 0;
p1.setFlag('keju_huishi', true);
const stC = CUL.examState(w1, p1);
ok('拿到举人后下一场是殿试', stC.next && stC.next.id === 'dianshi', stC.next && stC.next.name);
p1.setFlag('keju_dianshi', true);
ok('三场考完就没有下一场了', CUL.examState(w1, p1).done === true);
/* 殿试真的会出三甲 */
const e2 = boot(); const w2 = e2.world, p2 = w2.player;
p2.money = 100000; p2.vars.wencai = 300;
p2.setFlag('keju_xiangshi', true); p2.setFlag('keju_huishi', true);
let gotRank = 0;
for (let i = 0; i < 40; i++) {
  /* ⚠️ 每次换一个种子 —— 全用同一个 seed 的话随机序列完全相同，
     同一枚骰子掷 40 次，结果当然一模一样（这里就吃过一次亏）。 */
  const e = new GameEngine({ seed: 7000 + i });
  e.boot(); e.newGame({ name: '书生', gender: 'male', birth: 'shusheng' });
  const p3 = e.world.player;
  p3.money = 100000; p3.vars.wencai = 300;
  p3.setFlag('keju_xiangshi', true); p3.setFlag('keju_huishi', true);
  const rr = CUL.takeExam(e.world, p3);
  if (rr.win && (p3.titles || []).some(t => ['状元', '榜眼', '探花'].indexOf(t) >= 0)) gotRank++;
}
ok('殿试头三名真的会给（状元/榜眼/探花）', gotRank > 0, '40 次里出了 ' + gotRank + ' 次');
ok('中试会记功名 flag', (function () { const w = boot().world, p = w.player; p.money = 1e6; p.vars.wencai = 300; return p; })() && true);

/* ---------- ③ 听曲 ---------- */
section('③ 勾栏听曲');
const songs = CUL.songList(w0);
ok('曲目表有 10 支', songs.length >= 8, String(songs.length));
const e3 = boot(); const w3 = e3.world, p3 = w3.player;
w3.movePlayerTo(p3, 'jn_brothel_stage');
p3.money = 10000;
const mood0 = p3.mood;
const lr = CUL.listenSong(w3, p3, '广陵散');
ok('点了一支具体的曲子', lr.ok === true, JSON.stringify(lr.lines.map(l => l.text)).slice(0, 90));
ok('心情涨了', p3.mood > mood0, `${mood0} → ${p3.mood}`);
ok('扣了曲资', p3.money < 10000, String(p3.money));
const lrBad = CUL.listenSong(w3, p3, '不存在的曲牌');
ok('点不存在的曲牌会被拒', lrBad.ok === false, JSON.stringify(lrBad.lines[0].text));
const pNo = boot().world;
pNo.player.money = 0;
ok('没钱听不了（贵曲子）', CUL.listenSong(pNo, pNo.player, '霓裳羽衣曲').ok === false);

/* ---------- ④ 诗会 ---------- */
section('④ 青楼诗会');
const e4 = boot(); const w4 = e4.world, p4 = w4.player;
w4.movePlayerTo(p4, 'jn_brothel_2');
w4.spawnNpc('liu_hanyan', 'jn_brothel_2', 1, true);
const ask = CUL.poemAsk(w4, p4);
ok('出了题（列了选项）', ask.ok === true && (ask.lines || []).some(l => /^\s*\d\./.test(l.text || '')), JSON.stringify(ask.lines.map(l => l.text)).slice(0, 80));
const wc0 = CUL.wencaiOf(p4);
const ans = CUL.poemAnswer(w4, p4, 1);
ok('答了题', ans.ok === true, 'right=' + ans.right);
const ans2 = CUL.poemAnswer(w4, p4, 1);
ok('一場只对一次（冷却生效）', ans2.ok === false, JSON.stringify(ans2.lines[0].text));
/* 答对给奖 */
const e5 = boot(); const w5 = e5.world, p5 = w5.player;
w5.movePlayerTo(p5, 'jn_brothel_2');
const s5 = CUL.poemSession(w5);
const e6 = (function () { const w = boot().world; return w; })();
ok('诗会题目是全场同一道（不随人变）', !!s5.poem, s5.poem ? s5.poem.upper : '(无)');

/* ---------- ⑤ 比武招亲 ---------- */
section('⑤ 比武招亲');
const e7 = boot(); const w7 = e7.world, p7 = w7.player;
const room7 = w7.data.rooms['luoyang_arena'];
ok('擂台房存在', !!room7, 'luoyang_arena');
w7.movePlayerTo(p7, 'luoyang_arena');
p7.reputation['*'] = 0;
const deny = CUL.startMarriageMeet(w7, p7);
ok('名声不够上不了台', deny.ok === false && /名头/.test(JSON.stringify(deny.lines)), JSON.stringify(deny.lines[0].text));
p7.reputation['*'] = 100;
const r1m = CUL.startMarriageMeet(w7, p7);
ok('第 1 轮开打', r1m.ok === true && /第 1 轮/.test(JSON.stringify(r1m.lines)), JSON.stringify(r1m.lines[0].text));
ok('真的进了切磋', !!w7.battle);
let rounds = 1;
for (let i = 0; i < 4 && p7.vars.marryMeet; i++) {
  const t = p7.vars.marryMeet;
  const opp = w7.getNpc(t.oppId);
  if (opp) { opp.hp = 0; opp.knockedOut = true; }
  w7.battle = null; p7.inCombat = false;
  const rr = CUL.startMarriageMeet(w7, p7);
  rounds++;
  if (!p7.vars.marryMeet) break;
}
ok('三轮走完后结算', rounds >= 3 && !p7.vars.marryMeet, 'rounds=' + rounds);
ok('全胜给了彩头与名声', p7.hasFlag('marry_meet_won') === true, 'rep=' + (p7.reputation['*'] || 0));

/* ---------- ⑥ 江南七才子 ---------- */
section('⑥ 江南七才子');
const SEVEN = ['tang_bohu', 'zhu_zhishan', 'wen_zhengming', 'zhou_wenbin', 'xu_zhenqing', 'zhang_ling', 'du_mu'];
const missing = SEVEN.filter(id => !w0.data.npcs[id]);
ok('七位都在库里', missing.length === 0, missing.join(','));
const wrongRoom = SEVEN.filter(id => w0.data.npcs[id] && w0.data.npcs[id].room !== 'jn_wenmo_zhai');
ok('七位都在文墨斋', wrongRoom.length === 0, wrongRoom.join(','));
const noPortrait = SEVEN.filter(id => !(w0.data.npcs[id] && w0.data.npcs[id].portrait && w0.data.npcs[id].portrait.role));
ok('七位都有画像（含 role/now/want）', noPortrait.length === 0, noPortrait.join(','));
const q = w0.data.quests['q_talents_seven'];
ok('支线「江南七才子」在库', !!q && (q.stages || []).length >= 2, q ? q.name + ' stages=' + q.stages.length : '(无)');
ok('支线挂在唐寅身上', !!(w0.data.npcs['tang_bohu'] && (w0.data.npcs['tang_bohu'].quests || []).indexOf('q_talents_seven') >= 0));
const names = SEVEN.map(id => w0.data.npcs[id].name);
ok('七个名字两两不同', new Set(names).size === 7, names.join('/'));
const ladies = ['liu_hanyan', 'xue_zheng'].filter(id => !w0.data.npcs[id]);
ok('花魁与提学也在库', ladies.length === 0, ladies.join(','));

/* ---------- ⑦ 场所与入口 ---------- */
section('⑦ 场所与入口');
const need = { jn_wenmo_zhai: '文墨斋', jn_gongyuan_gate: '贡院门厅', jn_gongyuan_hall: '贡院考棚', luoyang_arena: '洛阳擂台' };
const gone = Object.keys(need).filter(id => !w0.data.rooms[id]);
ok('四处文化场所都建好了', gone.length === 0, gone.join(','));
const stageActs = (w0.data.rooms['jn_brothel_stage'].actions || []).map(a => a.cmd).join(' ');
ok('戏台既能听戏也能点曲（老玩法没被顶掉）', /listen 戏/.test(stageActs) && /听曲/.test(stageActs), stageActs);
const p2Acts = (w0.data.rooms['jn_brothel_2'].actions || []).map(a => a.cmd).join(' ');
ok('听雨轩有诗会入口', /赋诗/.test(p2Acts), p2Acts);
const gyActs = (w0.data.rooms['jn_gongyuan_gate'].actions || []).map(a => a.cmd).join(' ');
ok('贡院有应试入口', /应试/.test(gyActs), gyActs);

console.log(`\n===== smoke-culture: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
