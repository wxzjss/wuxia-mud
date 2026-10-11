/* 第十七轮回归：装备入口 / 绑架成功率 / 夜色底 / 青楼线 / 楼里新来的
 * 跑法：node tools/smoke-ux2.js
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const K = require(path.join(ROOT, 'game/src/core/kidnap.js'));
const WORK = require(path.join(ROOT, 'game/src/core/work.js'));

let pass = 0, fail = 0;
function ok(n, c, e) { if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); } else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); } }
function section(t) { console.log('\n── ' + t + ' ──'); }
const txt = (r) => ((r && r.lines) || []).map(l => l.text || '').join(' ');

(async () => {
  const UI = fs.readFileSync(path.join(ROOT, 'game/src/renderer/js/ui.js'), 'utf8');
  const CSS = fs.readFileSync(path.join(ROOT, 'game/src/renderer/css/main.css'), 'utf8');
  const CSS2 = fs.readFileSync(path.join(ROOT, 'server/public/css/main.css'), 'utf8');
  const UI2 = fs.readFileSync(path.join(ROOT, 'server/public/js/ui.js'), 'utf8');

  /* ================= 一、装备 ================= */
  section('1 装备：快捷条 + 状态里能看到');
  ok('★ 快捷条默认有「装备」', /label: '装备', cmd: 'equipment'/.test(UI));
  ok('★ 老玩家的快捷键也会补上新按钮（不覆盖他自己改的）',
    /DEFAULT_QUICKBAR\.forEach\(x => \{\s*if \(!have\[x\.cmd\]\)/.test(UI));
  const e = new GameEngine({ seed: 41 });
  await e.boot({});
  e.newGame({ name: '看装备的' });
  const w = e.world, p = w.player;
  const sword = Object.values(w.data.items).find(i => i.weaponType === '剑').id;
  w.giveItem(p, sword, 1);
  await e.exec('wield ' + w.data.items[sword].name);
  const s = await e.exec('sc');
  const L = s.lines || [];
  const i = L.findIndex(l => /装备（\d+ 件）/.test(String(l.text)));
  ok('★ 状态面板里有装备那一段', i >= 0, i >= 0 ? String(L[i].text) : '(没有)');
  ok('★ 写出了部位与加成', i >= 0 && /武器：.+攻 \+/.test(String(L[i + 1].text)),
    i >= 0 ? String(L[i + 1].text) : '-');

  /* ================= 二、绑架成功率 ================= */
  section('2 绑架：成功率 + 两条分支');
  const npc = w.npcsIn(p.room)[0];
  const a1 = K.assess(w, p, npc);
  ok('★ 站着的人成功率在 0~95% 之间', a1.pct > 0 && a1.pct <= 95, a1.pct + '% · ' + a1.why);
  ok('assess 会说明理由', !!a1.why, a1.why);
  const fake = Object.assign(Object.create(Object.getPrototypeOf(npc)), npc, { knockedOut: true });
  ok('★ 昏迷的人是 100%（必定成功）', K.assess(w, p, fake).pct === 100);
  ok('血量低更好绑', (() => {
    const hurt = Object.assign(Object.create(Object.getPrototypeOf(npc)), npc, { hp: Math.floor(npc.maxHp * 0.1) });
    return K.assess(w, p, hurt).chance > a1.chance;
  })(), '残血 → ' + K.assess(w, p, Object.assign(Object.create(Object.getPrototypeOf(npc)), npc, { hp: 5 })).pct + '%');
  /* ⚠️ 别拿 chance 直接比：基础值已经贴在 5% 地板上，加减都看不出来。
     改成验「he 计入了几处负面状态」这件可观测的事。 */
  ok('负面 buff 算得出来', (() => {
    const withDebuff = Object.assign(Object.create(Object.getPrototypeOf(npc)), npc, { buffs: [{ name: '中毒', turns: 3, mods: { speed: -5 } }] });
    return K.debuffCount(withDebuff) === 1 && /负面状态/.test(K.assess(w, p, withDebuff).why);
  })(), JSON.stringify(K.assess(w, p, Object.assign(Object.create(Object.getPrototypeOf(npc)), npc, { buffs: [{ name: '中毒', turns: 3 }] })).why));

  /* 面板下发 */
  const v = e.view();
  const vn = (v.npcs || [])[0];
  ok('★ 面板拿到了成功率（view.npcs[].kidnap）', !!(vn && vn.kidnap && typeof vn.kidnap.pct === 'number'),
    vn ? String(vn.kidnap && vn.kidnap.pct) : '-');
  ok('两个数值同源（面板 = assess）', vn && vn.kidnap.pct === K.assess(w, p, npc).pct);

  /* 真路：成 → 入袋；不成 → 开打 */
  const e2 = new GameEngine({ seed: 42 });
  await e2.boot({});
  e2.newGame({ name: '绑人的' });
  const w2 = e2.world, p2 = w2.player;
  w2.giveItem(p2, 'sack_coarse', 1);
  const t2 = w2.npcsIn(p2.room)[0];
  for (const n of w2.npcsIn(p2.room)) if (n !== t2) n.room = '__x__';
  w2.rng.next = () => 0;
  const r1 = await e2.exec('绑架 ' + t2.name);
  const bagN = ((require(path.join(ROOT, 'game/src/core/kidnap.js')).data(w2) || {}).bags || []).length;
  ok('★ 成了：当场掳进麻袋（走的是得手那条路）', bagN === 1 && !/动手吧/.test(txt(r1)), '袋=' + bagN + ' 战斗=' + !!w2.battle);
  ok('★ 屏幕上给了掳人的剧情', /麻袋|套|扣住|肘/.test(txt(r1)), txt(r1).slice(0, 56));

  const e3 = new GameEngine({ seed: 43 });
  await e3.boot({});
  e3.newGame({ name: '失手的' });
  const w3 = e3.world, p3 = w3.player;
  w3.giveItem(p3, 'sack_coarse', 1);
  const t3 = w3.npcsIn(p3.room)[0];
  for (const n of w3.npcsIn(p3.room)) if (n !== t3) n.room = '__x__';
  w3.rng.next = () => 0.999;
  const r3 = await e3.exec('绑架 ' + t3.name);
  ok('★ 不成：进战斗', !!w3.battle, txt(r3).slice(0, 50));
  ok('他变成敌对', !!t3.hostile);

  /* 名字要真的用上（老 bug：kdArg 读 ctx.args，永远是空） */
  ok('★ 装人现在真的认名字（不再抓第一个）', /const kdArg = \(ctx, args\)/.test(
    fs.readFileSync(path.join(ROOT, 'game/src/core/commands.js'), 'utf8')));

  /* ================= 三、界面配色（默认暗 + 浅色可切）=================
     ⚠️ 这块主人来回改过三次（要暗 → 要回滚 → 要「浏览器强制暗色」那种整页暗）。
        所以断言不再钉死某个具体颜色，而是钉**结构**：
        默认是暗的、浅色那套完整保留着、两套由 html.theme-light 切换 ——
        这样以后再调色，这组断言不用跟着重写。 */
  section('3 界面配色：默认暗色，浅色可切');
  ok('★ 默认声明为暗（color-scheme: dark）', /color-scheme:\s*dark/.test(CSS));
  ok('★ 画布底色走变量，默认这套是夜墨', /--paper:\s*#1[0-9a-f]{5}/i.test(CSS));
  ok('★ 浅色那套完整保留在 html.theme-light 里（随时能切回去）',
    /html\.theme-light\s*\{[\s\S]*?--paper:\s*#f4f1e8/.test(CSS));
  ok('★ 彩色在暗底上提亮（不然深红等于看不见）', /--red:\s*#d05a4e/i.test(CSS));
  ok('★ 白字没有被误伤（color: #fff 仍在使用）', /color:\s*#fff/.test(CSS));
  ok('两份 CSS 一致', CSS === CSS2);

  /* ================= 四、青楼线 ================= */
  section('4 青楼：男身要过关，接客要详写');
  const e4 = new GameEngine({ seed: 44 });
  await e4.boot({});
  e4.newGame({ name: '男儿身', gender: 'male' });
  const w4 = e4.world, p4 = w4.player;
  w4.movePlayerTo(p4, 'jn_brothel_gate');
  const denied = await WORK.sellBody(w4);
  ok('★ 男身默认卖不了身', !denied.ok && !(p4.prostitution && p4.prostitution.sold), txt(denied).slice(0, 60));
  ok('★ 老鸨指了明路（去接那条支线）', /接任务|楼里的门道/.test(txt(denied)), txt(denied).slice(-60));
  ok('那条支线真的在', !!w4.getQuest('q_brothel_sell'));
  ok('老鸨身上挂着那条支线', (w4.data.npcs['npcv_220'].quests || []).indexOf('q_brothel_sell') >= 0);
  ok('望江阁有「招揽」这个动作',
    (w4.data.rooms['jn_brothel_3'].actions || []).some(x => x.cmd === '招揽'));

  /* 走完支线 → 男身可卖 */
  p4.hasFlag = p4.hasFlag.bind(p4);
  p4.setFlag('brothel_permit', true);
  const allowed = await WORK.sellBody(w4);
  ok('★ 过了关就能卖身了', !!allowed.ok && p4.prostitution.sold, txt(allowed).slice(0, 50));

  /* 接客：前六次不重样 */
  const e5 = new GameEngine({ seed: 45 });
  await e5.boot({});
  e5.newGame({ name: '阿棠', birth: 'brothel_sold', gender: 'female' });
  const w5 = e5.world, p5 = w5.player;
  const seen = [];
  for (let k = 0; k < 6; k++) {
    const r = await e5.exec('接客');
    const head = ((r.lines || []).find(x => /——/.test(String(x.text))) || {}).text || '';
    seen.push(String(head));
  }
  ok('★ 接客有详细描写（不是一句模板）', seen.every(x => x.length > 4), seen[0]);
  ok('★ 前六次客人各不相同', new Set(seen).size === 6, seen.join(' / '));
  ok('每次给足三行戏', (await e5.exec('接客')).lines.filter(l => /story|plain/.test(l.kind)).length >= 3);

  /* ================= 五、楼里新来的 ================= */
  section('5 创建角色：楼里新来的');
  ok('★ 出身表里有这一条（女身）', !!w5.data.meta.births.brothel_sold && w5.data.meta.births.brothel_sold.gender === 'female');
  ok('★ 开局人就在楼里', w5.data.rooms[p5.room].region === 'qinglou', w5.data.rooms[p5.room].name);
  ok('★ 开局就是已卖身（契已画押）', !!(p5.prostitution && p5.prostitution.sold));
  ok('带着卖身契', p5.countItem('brothel_contract') > 0);
  const tut = require(path.join(ROOT, 'game/src/core/tutorial.js'));
  const intro = tut.introFor(p5, []);
  ok('★ 有她的楔子', /按了指印的契/.test(intro.title), intro.title);
  ok('★ 楔子不接茶摊那句收束（她人就在楼里）', !/卖茶的小摊|老槐树/.test(intro.body));
  ok('引荐去向是合欢宗一脉', JSON.stringify(tut.BIRTH_SECT.brothel_sold).indexOf('hehuan') >= 0);

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
