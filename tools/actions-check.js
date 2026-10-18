/**
 * actions-check.js —— 房间「此地可做」按钮的**真执行守卫**
 *
 * 为什么要有这条：
 *   主人第四轮报：「回春堂点老郎中以及那个柜子都显示没有这个人」。
 *   一查不是两处，是 **21 处** —— 东市绸缎庄/当铺/果子摊、醉仙楼、翰墨斋、
 *   白鹿书院、衙门、醉春楼、码头、铁匠铺、杂货铺、村口小铺…… 同一族的病：
 *   `action.cmd` 写的是**岗位 / 铺子名**（`talk 郎中`、`list 药铺`、`list 铁匠`），
 *   而 `talk`/`list`/`ask` 这些指令都按**真名**去找人 ⇒ 点下去只会得到
 *   「这里没有「郎中」。」「这里没有做买卖的人。」
 *
 *   这是「**不报错就不生效**」族里最难自查的一类：
 *   数据看着对、代码也跑得动，只有**真按一下**才知道目标不存在。
 *   所以本守卫**不看数据长相**，而是把玩家传到每个房间、**真执行每条 action**，
 *   抓「目标不存在」类的失败回执。报一处就查全部，靠的就是它。
 *
 * 断言三类：
 *   A. 每条 action **真执行**后不得出现「目标不存在」类回执（核心）
 *   B. 每条 action 必须有 label（参合庄曾有一条 label 缺失 → 按钮显示成 `undefined`）
 *   C. 每条 action 的 cmd 首词必须是**已注册指令**（不在指令表里的，点了等于没写）
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SAVE_DIR = require('./_test-save-dir');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0; const fails = [];
function ok(n, c, e) {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; fails.push(n); console.log('  ✘ ' + n + (e ? '  << ' + e : '')); }
}

/* 「目标不存在」类的失败回执。**只收这一类** ——
   cond 不满足的 failMsg（「你还不会…」）是设计内的，不算失败。 */
const FAIL_RE = /这里没有|没有做买卖|没有商贩|没听说过|这里一片虚无|不知道有|查无此人|没有这个人|没有你能干的活计|是什么指令|EXC:/;

const e = new GameEngine({ seed: 20261012, saveDir: SAVE_DIR });
e.boot(); e.newGame({ name: '试侠', gender: 'male', birth: 'wuxue' });
const w = e.world, p = w.player;

/* 已注册指令表：cmd 首词必须命中（房间 action 自己也算「已注册」的一种用法 ——
   `look 告示` 这类是 look 指令去回查 room.actions，首词仍是 look）。 */
const CMD = {};
for (const n of Object.keys(w.data.npcs)) void n;
// buildCommands 的指令表通过 world 的 ctx 拿不到，改用「真执行首词」的间接判据：
// 若首词不是任何指令，exec 会给统一回复（「「xx」是什么指令？」），已被 FAIL_RE 收住。

console.log('§ 真执行：320 房 · 每条「此地可做」都要真的做得了');
const roomIds = Object.keys(w.data.rooms);
const missingLabel = [];
const dead = [];
let totalActions = 0;

for (const rid of roomIds) {
  const r = w.data.rooms[rid];
  const acts = r.actions || [];
  if (!acts.length) continue;
  w.movePlayerTo(p, rid);
  for (const a of acts) {
    totalActions++;
    const cmd = String(a.cmd || '').trim();
    /* ⚠️ **不是**「label 必填」：项目实际规范是 label 可选，
       `roomActionsView()` 用 `label || cmd || keywords[0] || 房间名` 兜底出显示名
       （野外/门派的采药·打坐·参悟那批就只写了 cmd，显示成「采药」「打坐」，正合适）。
       所以判据是「**能算出显示名**」，不是「必须有 label」——
       第一版把它写成 label 必填，40 条正常数据被误判成红（断言过严也是假红）。 */
    const dispName = a.label || cmd || (a.keywords || [])[0] || r.name;
    if (!dispName) missingLabel.push(r.name + '（cmd=' + cmd + '）');
    if (!cmd) { dead.push({ room: r.name, label: a.label, cmd, why: '没有 cmd（点了不会有任何事）' }); continue; }
    /* ⚠️ 卖身是**不可逆的身份改变**，而本脚本是**同一个角色**把全图 action 走一遍：
       走过青楼执行一次 sellbody，这个人从此「已是青楼之人」，
       后面铁匠铺/碾房/灶台的打工全被拦（不是那些 action 坏了，是角色被前面的改动带偏了）。
       跳过它，并把它交给 smoke-survival 那类「专测卖身」的用例去验。 */
    if (/^sellbody|^卖身/.test(cmd)) continue;
    let lines = [];
    try { lines = (e.exec(cmd).lines || []); } catch (err) { lines = [{ text: 'EXC:' + err.message }]; }
    const bad = lines.map(l => String(l.text || '')).find(t => FAIL_RE.test(t));
    if (bad) dead.push({ room: r.name, label: a.label, cmd, why: bad.slice(0, 46) });
  }
}

ok('A-1 扫到房间 action（不是空跑）', totalActions > 50, totalActions + ' 条 / ' + roomIds.length + ' 房');
ok('A-2 ★ 每条 action 真执行后都没有「目标不存在」类回执（报一处查全部）',
  dead.length === 0,
  dead.length ? dead.map(d => d.room + '[' + d.label + ']`' + d.cmd + '`→' + d.why).join(' ｜ ')
    : totalActions + ' 条全部有真实效果');
ok('B-1 ★ 每条 action 都能算出**显示名**（label → cmd → keywords 首个 → 房间名）',
  missingLabel.length === 0, missingLabel.join('、') || '全部有可显示的名字');

/* ---- 抽样：几条「主人报过」的要能真出东西 ---- */
{
  const probe = (rid, cmd, wantRe, name) => {
    w.movePlayerTo(p, rid);
    /* 打工类 action 会消耗饱食/饮水；本文件用一个角色连跑全图，前几条动作
       会把饥渴吃到 0，后面 get 到「你饥渴难耐，实在干不动了」——那是正确行为，
       不是目标不存在。夹具每探一条前补满，避免跨用例污染。 */
    p.food = p.maxFood; p.water = p.maxWater;
    const lines = (e.exec(cmd).lines || []).map(l => String(l.text || '')).join(' ');
    ok('C ' + name, wantRe.test(lines), lines.slice(0, 60) || '(空)');
  };
  probe('jn_pharmacy', 'talk 陈济仁', /陈济仁|病来如山倒|医术|药材/, '回春堂「老郎中」能真的搭上话');
  probe('jn_pharmacy', 'list 陈济仁', /回春堂|金创药|货摊/, '回春堂「药柜」能真的看货');
  probe('jn_smith_inner', 'work 打铁', /拉风箱|工钱/, '铁匠铺「炉火」能真的打工');
  probe('cunzhen_mill', 'work 碾房', /推碾|工钱/, '碾房「石磨」能真的打工');
  probe('jn_brothel_kitchen', 'work 后厨', /帮厨|工钱/, '醉春楼「灶台」能真的打工');
  probe('gusu_canhe', 'look 秘录', /册子|秘录|容/, '参合庄「查阅秘录」有实际内容');
}

console.log('\n' + '='.repeat(48));
console.log(`  房间动作守卫：${pass} 通过 / ${fail} 失败`);
if (fails.length) console.log('  失败项：' + fails.join('、'));
console.log('='.repeat(48));
process.exit(fail ? 1 : 0);
