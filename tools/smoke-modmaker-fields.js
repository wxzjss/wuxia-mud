/* ============================================================
 * smoke-modmaker-fields.js —— Mod 制作器「字段对表」守卫（2026-10-12）
 *
 * 由来：主人让「看一下 Mod 制作器需不需要更新完善」。
 * 体检发现——**引擎一年来加的东西，制作器有一半没入口**：
 *   · NPC `learned`（会的功法，全库 470 处）      —— 没入口
 *   · 房间 `actions`（打水/打铁/住店/采药，301 处）—— 没入口
 *   · NPC `ask`（打探消息，141 处）                —— 没入口
 *   · 武学 `effects` 类型只列 9 种，引擎支持 15 种  —— 缺 6 种
 *   · 武学 `bonus` 缺 dodge/parry/speed/lifesteal  —— 引擎早在消费
 *   · 武学被动加成文案写「每 10 级 +N」，实际是 `sqrt(lv/300)` 缩放 —— **语义错**
 *
 * 这个脚本把「**引擎真实消费的**」当唯一真相，断制作器不能漏。
 * 为什么不用「示例 mod 里有什么」当真相：示例 mod 也是人写的，可能同样漏；
 * 而引擎的 `switch/case` 与数据消费点是**代码事实**，漏了会真不生效。
 *
 * ⚠️ 对表比印象可靠 —— 这次体检全靠对表才发现缺了 470 处的字段。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const MK_PATH = path.join(ROOT, 'game/src/renderer/js/modmaker.js');
const COMBAT_PATH = path.join(ROOT, 'game/src/core/combat.js');
const CHAR_PATH = path.join(ROOT, 'game/src/core/character.js');
const MK = fs.readFileSync(MK_PATH, 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n); }
  else { fail++; console.log('  ✘ ' + n + (e !== undefined ? '  ' + e : '')); }
};
const section = t => console.log('\n── ' + t + ' ──');

/* ---------- ① 制作器必须覆盖的高价值字段 ---------- */
section('① 高价值字段必须都有入口（引擎消费 + 数据主流）');
{
  /* 判据：modmaker.js 里出现过 `xx.N.字段` 或 `data-bind="xx.N.字段"` 的形态。
     用宽松正则：`'npcs.' + i + '.learned'` 与 `data-bind="npcs.3.ask"` 都算。 */
  const has = (kind, field) => {
    const concat = new RegExp("'" + kind + "\\.'\\s*\\+\\s*\\w+\\s*\\+\\s*'\\." + field + "'");
    const direct = new RegExp('["\']' + kind + '\\.\\d+\\.' + field + '["\']');
    const bind = new RegExp('data-bind="' + kind + '\\.\\d+\\.' + field + '"');
    return concat.test(MK) || direct.test(MK) || bind.test(MK);
  };
  /* 有些字段不是 `xx.N.field` 形态，而是「结构写回」形态：
     · rooms.exits   —— 走 `S.spec.rooms[i].exits[dir] = v`（每方向一个输入框）
     · skills.effects —— 走 `S.spec.skills[i].effects.push(...)`（动态行）
     这类入口同样算「有入口」，但要按各自的写法断，不能硬套 xx.N.field。 */
  const hasWrite = re => re.test(MK);
  const need = [
    ['npcs', 'learned', 'NPC 会的功法（全库 470 处；对位主人钦定的 B8）'],
    ['npcs', 'ask', 'NPC 可打探的消息（全库 141 处）'],
    ['npcs', 'askDefault', 'NPC 问不出别的时的回答'],
    ['npcs', 'teach', 'NPC 可请教的武学'],
    ['npcs', 'talk', 'NPC 打招呼的话'],
    ['npcs', 'loot', 'NPC 掉落'],
    ['rooms', 'actions', '房间互动（打水/打铁/住店/采药；全库 301 处）'],
    ['rooms', 'onEnter', '房间进入效果'],
    ['skills', 'bonus.maxHp', '武学被动加成'],
  ];
  need.forEach(([k, f, why]) => {
    ok('  ' + k + '.' + f + '  ← ' + why, has(k, f), '制作器里找不到入口');
  });

  /* 结构写回型入口（单独判形态） */
  ok('  rooms.exits  ← 房间出口（每方向一个输入框，写回 exits[dir]）',
    hasWrite(/rooms\[i\]\.exits\[dir\]\s*=/) && /data-exit="/.test(MK),
    '制作器里找不到入口');
  ok('  skills.effects  ← 武学招式效果（动态效果行，push 进 effects[]）',
    hasWrite(/skills\[i\]\.effects\.push\(/) && /data-add-effect="/.test(MK),
    '制作器里找不到入口');
}

/* ---------- ② 武学效果类型：制作器下拉 == 引擎支持 ---------- */
section('② 武学招式效果类型不许比引擎少');
{
  /* 真相来源：combat.js 里 `case 'xxx':` 的效果类型 */
  const combat = fs.readFileSync(COMBAT_PATH, 'utf8');
  const engineTypes = new Set();
  for (const m of combat.matchAll(/case '([a-zA-Z+_-]+)':/g)) engineTypes.add(m[1]);
  /* 制作器下拉里的类型清单（effectRow 的 types 数组） */
  const mm = MK.match(/const types = \[([\s\S]*?)\];/);
  const uiTypes = new Set(mm ? [...mm[1].matchAll(/'([a-zA-Z+_-]+)'/g)].map(x => x[1]) : []);

  ok('②-1 抠到了引擎效果类型（前提）', engineTypes.size > 5, engineTypes.size + ' 种');
  ok('②-2 抠到了制作器效果下拉（前提）', uiTypes.size > 5, uiTypes.size + ' 种');

  /* 引擎有、制作器没有的 —— 这才是「作者根本不知道有这东西」的缺口 */
  const missing = [...engineTypes].filter(t => !uiTypes.has(t) && t !== 'cond');
  ok('②-3 ★ 引擎支持的效果类型，制作器一个都不能漏', missing.length === 0,
    missing.length ? '缺：' + missing.join('、') : '引擎 ' + engineTypes.size + ' 种全在');

  /* 关键几种再点名断一次（防止有人把整条断言删了） */
  ['aoe', 'confuse', 'silence', 'mp', 'custom'].forEach(t => {
    ok('②-4 关键效果「' + t + '」有下拉项', uiTypes.has(t));
  });
}

/* ---------- ③ 武学被动加成：制作器 == 引擎消费的键 ---------- */
section('③ 被动加成字段不许比引擎少');
{
  const ch = fs.readFileSync(CHAR_PATH, 'utf8');
  /* 引擎消费哪些键：character.js 里 `else if (bk === 'xxx')` */
  const consumed = new Set();
  for (const m of ch.matchAll(/bk === '([a-zA-Z]+)'/g)) consumed.add(m[1]);
  ok('③-1 抠到引擎消费的加成键（前提）', consumed.size >= 6, [...consumed].join(','));

  /* 制作器里 bonus.xxx 的入口 */
  const ui = new Set();
  for (const m of MK.matchAll(/bonus\.([a-zA-Z]+)'/g)) ui.add(m[1]);
  const miss = [...consumed].filter(k => !ui.has(k));
  ok('③-2 ★ 引擎消费的加成键，制作器一个都不能漏', miss.length === 0,
    miss.length ? '缺：' + miss.join('、') : [...consumed].join('、') + ' 全在');
}

/* ---------- ④ 文案不许说谎（最坑的一类） ---------- */
section('④ 文案与真实语义一致');
{
  /* ⚠️ 关键：注释里可以提旧错误文案（那是「纠错记录」，不是给作者看的提示），
     所以先把 JS 注释抠掉再断 —— 否则守卫会被自己的纠错注释噎死。 */
  const MK_NC = MK
    .replace(/\/\*[\s\S]*?\*\//g, ' ')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');  // 行注释（排除 http:// 里的 //）
  /* 「每 N 级 +N」是旧量程的写法；现在是 sqrt(lv/300) 收敛曲线 */
  ok('④-1 ★ 不再出现「每 10 级 +N」这类按等级线性脑补的提示（注释里的纠错记录不算）',
    !/每\s*\d+\s*级\s*\+/.test(MK_NC), '文案还在教作者按等级线性算');
  ok('④-1b 顺带断「随等级生效」这类旧说法也别留在正文里',
    !/随等级生效/.test(MK_NC));
  ok('④-2 说出了真实缩放口径（300 熟练度拿满 1 份）',
    /300\s*熟练度/.test(MK));
  /* maxLevel 的标签不能叫「最高等级」（会让人以为是角色等级） */
  ok('④-3 maxLevel 的标签叫「熟练度上限」而不是「最高等级」',
    /熟练度上限/.test(MK) && !/field\('最高等级'/.test(MK));
  /* 熟练度六级要提一下（作者得知道分母是什么档） */
  ok('④-4 提示里说明了熟练度分级（登峰造极）', /登峰造极/.test(MK));
}

/* ---------- ⑤ 转换函数真能往返（不只是存在） ---------- */
section('⑤ 三个「多行文本 ⇄ 真结构」转换必须真能往返');
{
  function grab(name) {
    const m = MK.match(new RegExp('  function ' + name + '\\([\\s\\S]*?\\n  \\}'));
    if (!m) throw new Error('未找到 ' + name);
    return m[0];
  }
  const code = ['learnedToLines', 'linesToLearned', 'askToLines', 'linesToAsk',
    'actionsToLines', 'linesToActions'].map(grab).join('\n');
  const F = new Function(code + ';return {learnedToLines,linesToLearned,askToLines,linesToAsk,actionsToLines,linesToActions};')();

  /* learned：对象 ⇄ 行文本 */
  const L = { huashan_sword: { level: 450 }, zixia_gong: { level: 480 } };
  const Lb = F.linesToLearned(F.learnedToLines(L));
  ok('⑤-1 learned 往返保住 id 与熟练度',
    Lb.huashan_sword && Lb.huashan_sword.level === 450 && Lb.zixia_gong.level === 480,
    JSON.stringify(Lb));
  ok('⑤-2 learned 认全角冒号（中文输入法下太常见）',
    F.linesToLearned('a：100').a && F.linesToLearned('a：100').a.level === 100);
  ok('⑤-3 learned 只给 id 时按标准熟练度 300 兜底',
    F.linesToLearned('basic_sword').basic_sword.level === 300);

  /* ask：对象数组 ⇄ 行文本 */
  const A = [{ topic: '紫霞神功', keywords: ['紫霞', '内功'], answer: '镇派内功。' }];
  const Ab = F.linesToAsk(F.askToLines(A));
  ok('⑤-4 ask 往返保住话题/关键词/回答',
    Ab[0] && Ab[0].topic === '紫霞神功' && Ab[0].keywords.length === 2 && Ab[0].answer === '镇派内功。',
    JSON.stringify(Ab));
  ok('⑤-5 ask 认「映射对象」写法（{"话题":"答案"}）',
    F.askToLines({ 话题: '答案' }).indexOf('话题') === 0);
  ok('⑤-6 ask 回答里带 `|` 不被截断',
    F.linesToAsk('话题 | 词 | 前半|后半')[0].answer === '前半|后半');

  /* actions：对象数组 ⇄ 行文本 */
  const Ac = [{ label: '打水', cmd: 'drink', keywords: ['井'], effects: [{ type: 'say', raw: '清凉' }] }];
  const Acb = F.linesToActions(F.actionsToLines(Ac));
  ok('⑤-7 actions 往返保住按钮名/指令/关键词/效果',
    Acb[0] && Acb[0].label === '打水' && Acb[0].cmd === 'drink'
    && Acb[0].keywords[0] === '井' && Acb[0].effects[0] === 'say:清凉',
    JSON.stringify(Acb));
  ok('⑤-8 actions 多条效果按分号拆开',
    F.linesToActions('打水 | drink | 井 | say:清凉; +water:100')[0].effects.length === 2);
}

/* ---------- ⑥ 转换真的接进了输入绑定（否则填了等于没填） ---------- */
section('⑥ 转换函数必须真接到 data-bind 上');
{
  ok('⑥-1 learned 的输入会过 linesToLearned',
    /\\\.learned\$\/\.test\(path\)[\s\S]{0,200}linesToLearned/.test(MK)
    || /\.learned\$.test\(path\)[\s\S]{0,200}linesToLearned/.test(MK));
  ok('⑥-2 ask 的输入会过 linesToAsk', /linesToAsk\(v\)/.test(MK));
  ok('⑥-3 actions 的输入会过 linesToActions', /linesToActions\(v\)/.test(MK));
}

/* ---------- ⑦ 引擎侧导出白名单也得带上（双向对表） ---------- */
section('⑦ 引擎导出时不许把这些字段丢掉');
{
  const eng = fs.readFileSync(path.join(ROOT, 'game/src/core/engine.js'), 'utf8');
  ok('⑦-1 导出 NPC 时带上 learned', /learned:\s*n\.learned/.test(eng));
  ok('⑦-2 导出 NPC 时带上 ask', /ask:\s*\(n\.ask \|\| \[\]\)/.test(eng));
  ok('⑦-3 导出房间时带上 actions', /actions:\s*r\.actions/.test(eng));
}

console.log('');
console.log('Mod 制作器字段守卫：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
