/**
 * ai-flavor-scan.js —— 玩家可见文本的「AI 味」体检（humanizer 口径）
 *
 * 只看**玩家真能读到的字**：游戏数据里的 desc/name/text/answer/talk，
 * 以及 core 里写死的 kind:'say'/'story'/'plain' 文案。
 * 不查代码注释（那不是给玩家看的）。
 *
 * 命中即列出，人工判断后逐条改。这些模式不是「绝对不能用」，
 * 而是在中文里**成批出现**时最像机器写的 —— 单条出现多半没问题，
 * 同一段里撞三条以上就该改。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

/* 中文 AI 套话（humanizer 里那些英文模式的对应物 + 中文特有的公文腔/升华腔）
 *
 * ⚠️ 只收**低误报**的模式。第一版把「三连短句」「感叹号」也收进来了，
 *    结果 210 条全是误报 —— 那是刻意写的白描（「斗笠压得低，遮住半张脸，
 *    虎口与指节都结着厚茧」），中文本来就这么写。
 *    判据：这个模式**成批出现**才算 AI 味；一条两条不当回事。
 */
const PATTERNS = [
  ['升华腔', /彰显|承载着|诠释|见证着|诉说着|昭示|象征|寓意|折射出|映照出|交织成|编织成|谱写|无声地诉说|静静诉说/],
  ['空洞过渡', /值得一提|众所周知|不言而喻|总而言之|综上所述|由此可见|堪称|可谓|随着[\u4e00-\u9fa5]{0,14}的(发展|推进|演变|到来)|在这个[\u4e00-\u9fa5]{0,10}的时代|大背景下|无疑(是|地)?[\u4e00-\u9fa5]/],
  ['伪深度', /令人(叹为观止|深思|回味|神往)|别有一番(滋味|风味|风味)|独树一帜|无与伦比|淋漓尽致|跃然纸上|栩栩如生|活灵活现|美不胜收/],
  ['公文腔', /旨在|致力于|着眼于|着力于|秉承|秉持|弘扬|赋能|助力|构建|营造出|塑造出|赋予/],
  ['翻译腔', /使得|从而|进而|对于[\u4e00-\u9fa5]{1,10}而言|某种程度上|总体而言|整体而言|同时也是|不仅是[\u4e00-\u9fa5]{0,8}，更是/],
  ['空赞词', /完美(地|的)?|极致|非凡|震撼|惊艳|瑰丽|绚丽|璀璨|辉煌|叹为观止/],
  ['模板收尾', /(的|了)[\u4e00-\u9fa5]{0,10}之旅|一段[\u4e00-\u9fa5]{0,8}的(旅程|传奇|故事)|谱写[\u4e00-\u9fa5]{0,8}(篇章|传奇)/],
  /* 🔴 「观察腔：不X，只Y」—— 主人 2026-10-11 亲报的那句
     「一条黄狗趴在墙根晒太阳，人来也不躲，只抬了抬眼皮」。
     机器写环境描写时最爱这个形状：**先否定一个社交反应，再补一个极小的动作**，
     读着像有人站在旁边给你做注解。
     ⚠️ 范围收得很紧（只认 看/理/动/躲/答/吭/理会/言语/管/顾/抬眼/抬头 这几个动词，
     后面必须紧跟「只/却/仅 + 一…」），这是故意的：
     「不求招式花巧，只求一刀比一刀快」「不图伤敌，只求货在人在」这类**成句**
     是中文里本来就有的狠话，放宽了会一起打死（实测放宽到 12 条命中，全是好句子）。
     当前全库命中 0 —— 这条规矩是**守着别让它回来**的。 */
  ['观察腔（不X只Y）', /(?:也|都)?[不没](?:看|理|动|躲|答|吭|理会|言语|管|顾|抬眼|抬头)[^，。\n]{0,4}，\s*(?:只|却|仅)[^\n]{0,6}(?:[\u4e00-\u9fa5]了[\u4e00-\u9fa5]|一眼|一下|一声)/],
  /* 🔴 对偶定义「不是A，是B」——主人 2026-10-11 亲报的那句
     「不是钱，是一封旧信，封皮上只按了个指印」。
     这是 AI 写中文最典型的一层壳：**先立一个靶子（不是X），再抛出答案（是Y）**。
     它读着不像在写事，像有人站在旁边给你做注解 —— 旁白里成批出现时最刺眼。
     ⚠️ 判红范围收得很紧，两条豁免：
       ① **人物台词豁免**（`talk`/`answer`/`say` 字段，或整句在「」『』里）——
          「这不是狠话，是账」「蛊不是术，是命」这种是人的强调语气，是好句子；
       ② 只认**逗号紧接**的形态（「不是X，是Y」），不认跨句、跨分号的散装组合。 */
  ['对偶定义（不是A是B）', /不是[^，。！？；\n]{1,14}，(?:而是|是)[^，。！？；\n]{1,26}/, { speechExempt: true }],

  /* 🔴 「模板句式复用」——主人 2026-10-11 亲报的第二批。
     原话：「旁边还有一个黄修的盗贼，细看里面有一句『看人先看腰，站得离人很近，又不觉得近』
            ai 感很强，而且**一下子就发现俩那肯定不是个例**。」
     顺着扫，果然不止两处：`看人先看X` 全库 **4 处**（腰/手/脸色再衣裳/鞋），
     `站得离人很近，又不觉得近` **2 处**，`等…才抬眼` **2 处**。
     这几种壳的共同点不是「用词」，而是**同一副骨架反复套**：
       · 「看人先看X」   —— 一个动宾开头的工整小句，谁都能往里填
       · 「A，又不A」    —— 悖论式对偶，读着像金句，其实没信息
       · 「等…才…」      —— 时间状语 + 动作，前后两半字数还对称
     ⚠️ 判据只认**这几个具体骨架**，不做泛化的「工整句」检测 ——
        中文里对称句天生就多，泛化会误杀一大片（这个脚本上一轮已经栽过一次）。 */
  ['模板句式（看/问/听人先看X）', /(?:看|问|听|见|说|认)人先(?:看|问|听|见|说|认)[^，。；\n]{0,8}/],
  ['悖论对偶（…，又不觉得…）', /[^，。；\n]{2,10}，又不觉得[^，。；\n]{1,10}/],
  ['对称对偶（等…才…）', /等[^，。；\n]{1,12}才[^，。；\n]{1,8}[，。；]/],

  /* 🔴 网文腔「开口就X」—— 主人 2026-10-11 亲报的第三批。
     原话：「还有像这种『开口就…』这种 ai 味网文句式也留意一下」。
     源头在生成器的语气池里（`gen-fix-npcs.js` 的 c[] 第一项、
     `lib-portrait-pools.js` 的 ARC.haoshuang.init），
     一炮就是 22 个「豪爽」角色共用一句「一开口就是笑，先递茶再说话」。
     形状特征：把**说话方式**写成条件反射，读着像旁边有人贴标签。 */
  ['网文腔（开口就/张口就）', /[开张]口就|张嘴就|一开口就/],

  /* 🔴 「一副骨架反复套」—— 比用词更像 AI 的东西。
     判据不是句式，而是**同一串字在玩家可见文本里出现 ≥4 次**。
     主人三次亲报（「看人先看腰」×4、22 个豪爽角色同款、11 个读书人同款抄书动作）
     都是这个病。单个用词没法判，**复用次数**能判，而且几乎零误报。
     ⚠️ 实体名/台词这类天然会重复的不算 —— 只统计长度 ≥12 且不像专名的串。 */
  ['模板复用（同一句 ≥4 次）', null, { reuse: 4 }],
];

/* ============================================================
 * 守卫自证 —— 拿「已知必错」的样本反考自己
 *
 * 为什么要有：这个脚本的规则**收得很紧**（怕误杀好句子），
 * 收紧了就很容易悄悄失效 —— 正则写歪一个字符，命中数就永远是 0，
 * 而 0 命中看起来和「全库干净」一模一样。
 * 上一轮 `dark-bg-check` 就吃过这个亏（只认 rgba 不认十六进制，一路绿灯）。
 * 所以：样本必须被判红，判不出来就非 0 退出。
 * ============================================================ */
const FIXTURES = [
  ['看人先看腰，站得离人很近，又不觉得近。', true],
  ['见人过来就低头，等走远了才抬眼。', true],
  ['他打量人，从脸色一直看到衣裳。', false],
  ['她挨得比谁都近，偏没人留意。', false],
  /* ⚠️ 这里**只考正则本身**，不考「台词豁免」——
     「这不是狠话，是账。」这种句子**原始正则会命中**，
     是扫描阶段按字段（talk/answer/say）与「」包着才放行的。
     把它当 `false` 塞进来，考的是「豁免层」而不是「正则层」，
     于是自证永远红（第一版就是这么挂的）。
     豁免层的回归由下面的实际扫描 + speechExempt 单测覆盖。 */
  ['这不是狠话，是账。', true],
];
{
  let bad = 0;
  for (const [t, want] of FIXTURES) {
    const got = PATTERNS.some(([, re]) => { if (!re) return false; re.lastIndex = 0; return re.test(t); });
    if (got !== want) { bad++; console.log('  ✘ 自证失败：' + JSON.stringify(t.slice(0, 22)) + ' 期望' + want + ' 实得' + got); }
  }
  if (bad) { console.log('\n===== AI 味规则自证失败：有样本判不出来 ====='); process.exit(1); }
  console.log('（规则自证：' + FIXTURES.length + ' 个样本全部判定正确）\n');
}

/* 要扫的文件 */
const DATA_DIR = path.join(ROOT, 'game', 'data');
const CORE_DIR = path.join(ROOT, 'game', 'src', 'core');

/* 玩家可见的字段名 */
const VISIBLE_KEYS = new Set([
  'name', 'desc', 'title', 'text', 'answer', 'talk', 'raw', 'msg', 'label', 'hint',
  'topic', 'story', 'goal', 'say', 'line', 'note', 'subtitle', 'stageDesc', 'why',
  /* ⚠️ NPC 的问答表也是**玩家能读到的字**（问一句他答一句），第一版没列进来，
     于是「当一收三。不是我狠…」这类台词被判成旁白，白吃一条命中。 */
  'ask', 'askDefault',
]);

/* 出戏词：NPC 嘴里／世界描述里蹦出**网游/现代**词汇，最伤沉浸感（这是「不真实感」的正主）。
 *  只查「人会说的话」那几类字段（talk/answer/raw/say/story），不查 UI 文案（那里本来就该说「面板」）。
 *  ⚠️ 词表要小心假阳性：「副本」是正经中文（文书的副本）、「数据」在衙门账目里也讲得通，
 *     这两个都不收。收进来的必须**一眼就是网游词**。
 *  ⚠️ 「经验」收，但「经验老到」「经验丰富」是成语，靠 EXEMPT 放行。 */
const OUT_OF_WORLD = /任务|经验值?|升级|属性点|面板|点击|按钮|系统|刷新|技能书|副本任务|NPC|玩家|界面|存档|读档|战力|血量|蓝量|道具栏|背包格/;
const OUT_EXEMPT = /经验老到|经验丰富|为人老到/;
const HUMAN_KEYS = new Set(['talk', 'answer', 'raw', 'say', 'story', 'text', 'desc', 'why']);

/* 已知没问题、不判红的例外（命中就跳过，附上为什么）。
 * 加例外必须写清理由 —— 不然这里迟早变成一个「什么都放行」的垃圾桶。 */
const ALLOW = [
  { re: /使得/, why: '「走镖、看家、砍柴都使得的」＝用得的，地道中文，不是翻译腔' },
  { re: /堪称走运/, why: '「堪称走运」是口语，不是「堪称一绝」那种公文腔' },
  { re: /进而|从而|与此同时/, f: 'world.js', why: '代码里的变量名/字符串，不是玩家可见文案' },
  { re: /开口就是这一句/, why: '「东坡的《念奴娇》，上半阕开口就是这一句」——讲的是**词的第一句**，事实陈述，不是人物说话习惯的贴标签' },
];
function allowed(h) {
  return ALLOW.some(a => {
    /* ⚠️ 要拿**整句**去试，不能只试命中片段 ——
       「堪称走运」的命中片段只有「堪称」，只比对 frag 的话例外永远不生效（实测）。 */
    if (!a.re.test(h.frag || '') && !a.re.test(h.text || '')) return false;
    if (!a.f) return true;
    return String(h.file || '').indexOf(a.f) >= 0 || (a.f === 'world.js' && /\.js$/.test(h.file || ''));
  });
}

const hits = [];
const oow = [];

/* ---- 复用台账（「一副骨架反复套」的判据，扫完统一结算） ----
   为什么单独做：句式正则只能认「长什么样」，认不出「同一句套了多少遍」。
   主人三次亲报的问题里，有两次是纯粹的数量问题（22 个角色同一句、
   11 个角色同一个动作），正则一条都抓不到。 */
const REUSE_MIN = 4;
const counts = new Map();      // 串 → 出现次数
const firstSeen = new Map();   // 串 → 第一个出处

/* 台词字段：这些话是**人物在说**，不是旁白在解释 —— 带强调语气的对偶句在这里是人的口吻 */
const SPEECH_KEYS = new Set(['talk', 'answer', 'say', 'line', 'subtitle', 'ask', 'askDefault']);
/** 整句被引号包着 → 也是人在说话（`raw: '「…」'` 这种） */
function isSpeech(str, key) {
  if (SPEECH_KEYS.has(key)) return true;
  const t = String(str).trim();
  return /^[「『][\s\S]*[」』][。！？]?$/.test(t);
}
/** menu / narrate 这类 DSL 串：里面分号竖线一大堆，不是给玩家连着读的句子，规则别在这儿咬 */
function isDsl(str) {
  return /[>;|]/.test(str) && /(?:narrate|combat|flag|money|exp|pot|favor|rep|var|item|menu):/.test(str);
}

function scanString(str, file, key) {
  if (!str || typeof str !== 'string' || str.length < 6) return;
  /* 去掉明显是代码/标记的串 */
  if (/^[\w_./-]+$/.test(str)) return;
  if (isDsl(str)) return;
  /* 复用台账：人名/称谓天然会重（"王掌柜" 出现 30 次不是 AI 味），所以按字段排除，
     并且要求长度 ≥12（短串本就容易撞）。 */
  if (str.length >= 12 && key !== 'name' && key !== 'title' && key !== 'titles') {
    counts.set(str, (counts.get(str) || 0) + 1);
    if (!firstSeen.has(str)) firstSeen.set(str, { file, key: key || '-' });
  }
  for (const [label, re, opt] of PATTERNS) {
    if (!re) continue;                       /* 复用档没有正则，见上面的台账 */
    const m = str.match(re);
    if (!m) continue;
    const h = { file, key, label, frag: m[0], text: str.length > 90 ? str.slice(0, 90) + '…' : str };
    if (opt && opt.speechExempt && isSpeech(str, key)) continue;
    if (allowed(h)) continue;
    hits.push(h);
  }
  if (HUMAN_KEYS.has(key) && !OUT_EXEMPT.test(str)) {
    const m2 = str.match(OUT_OF_WORLD);
    if (m2) oow.push({ file, key, frag: m2[0], text: str.length > 90 ? str.slice(0, 90) + '…' : str });
  }
}

function walk(obj, file, key, depth) {
  if (depth > 8) return;
  if (typeof obj === 'string') { scanString(obj, file, key); return; }
  if (Array.isArray(obj)) { obj.forEach(v => walk(v, file, key, depth + 1)); return; }
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) {
    const keep = VISIBLE_KEYS.has(k) || depth < 2;
    walk(obj[k], file, keep ? k : key, depth + 1);
  }
}

/* 1) 数据文件 */
for (const f of fs.readdirSync(DATA_DIR)) {
  if (!/^\d+_.*\.json$/.test(f)) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch (e) { continue; }
  walk(j, f, '', 0);
}

/* 2) core 里写死的玩家可见文案：抓 kind 后跟的 text/raw */
for (const f of fs.readdirSync(CORE_DIR)) {
  if (!/\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(CORE_DIR, f), 'utf8');
  const re = /kind:\s*'(?:say|story|plain|sys|hint|warn|title|subtitle|combat|roomname|desc)'[^}]{0,20}text:\s*(`[^`]*`|'[^']*')/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    scanString(m[1].slice(1, -1), f, 'inline');
  }
  /* 也扫 player-visible 数组里的字符串（help / 剧情池）
     ⚠️ 要**跳过注释**：注释里也有引号、也有中文长句，但它们不是给玩家看的字。
        第一版没跳，于是 combat.js/commands.js 的注释连续命中「不是A是B」——
        那是工程笔记，改了没意义；而真正的玩家文案反而被淹在噪声里。 */
  const lines = src.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (/^(\/\/|\*|\/\*)/.test(t)) continue;          /* 整行注释 / 块注释内 */
    const code = line.replace(/(^|[^:'"`])\/\/.*$/, '$1'); /* 行尾注释 */
    let m2;
    const re2 = /'(?:[^'\\]|\\.){8,}'/g;
    let n = 0;
    while ((m2 = re2.exec(code)) !== null && n < 400) {
      n++;
      const s = m2[0].slice(1, -1);
      /* 只留中文长句 */
      if (!/[\u4e00-\u9fa5]/.test(s)) continue;
      if (s.length < 10) continue;
      scanString(s, f, 'inline-str');
    }
  }
}

/* ---- 复用结算：同一串 ≥REUSE_MIN 次的进「待办清单」 ----
   ⚠️ 这一档**不判红**，只列清单。原因：
     六座城的同一种身份（襄阳的捕快 / 洛阳的捕快）本来就是**同一份画像按城克隆**，
     重复是数据结构，不是写作偷懒 —— 拿它判红，回归会永远红着，
     守卫一红就没人看，等于没有守卫。
     它的用法是：**开局时扫一眼，挑真正会被玩家当面比出来的那几条改**。 */
const reuseList = [];
for (const [s, n] of counts) {
  if (n < REUSE_MIN) continue;
  if (s.indexOf('${') >= 0) continue;              /* 代码里的模板串，不是文案 */
  const c = firstSeen.get(s) || { file: '-', key: '-' };
  reuseList.push({ n, file: c.file, key: c.key, text: s });
}
reuseList.sort((a, b) => b.n - a.n);

/* 输出 */
const byFile = {};
for (const h of hits) (byFile[h.file] = byFile[h.file] || []).push(h);
const files = Object.keys(byFile).sort();
console.log('=== AI 味命中清单（' + hits.length + ' 条 / ' + files.length + ' 个文件）===\n');
for (const f of files) {
  console.log('── ' + f + ' (' + byFile[f].length + ')');
  const seen = new Set();
  for (const h of byFile[f]) {
    const k = h.label + '|' + h.frag;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log('   [' + h.label + '] 「' + h.frag + '」 @' + (h.key || '-') );
    console.log('      ' + h.text.replace(/\s+/g, ' '));
  }
  console.log('');
}

/* 出戏词单列（这是「不真实感」的正主，比 AI 腔调更伤） */
console.log('=== 出戏词（NPC 嘴里蹦网游/现代词）共 ' + oow.length + ' 条 ===\n');
for (const h of oow) {
  console.log('   [' + h.frag + '] ' + h.file + ' @' + h.key);
  console.log('      ' + h.text.replace(/\s+/g, ' '));
}

/* 复用清单（不判红，当待办看） */
console.log('\n=== 样板复用清单（同一句 ≥' + REUSE_MIN + ' 次 · 不判红 · 共 ' + reuseList.length + ' 条）===');
console.log('（六座城的同身份画像按城克隆属结构性重复，不必逐条改；挑玩家会当面比出来的改）\n');
for (const r of reuseList.slice(0, 40)) {
  console.log('   ×' + String(r.n).padStart(2) + '  ' + r.text.replace(/\s+/g, ' ').slice(0, 46) + '   @' + r.file);
}
if (reuseList.length > 40) console.log('   … 另有 ' + (reuseList.length - 40) + ' 条，同上处理');

/* ---- 判红：两类都算失败 ----
   这个脚本是**回归守卫**（名字带 -check，会被全量回归扫到），
   所以命中就必须非零退出 —— 只打印不判红等于没守。 */
const bad = hits.length + oow.length;
console.log('\n' + '='.repeat(46));
console.log(`  AI 味体检：AI 腔调 ${hits.length} 条 · 出戏词 ${oow.length} 条`);
if (bad) {
  console.log('  ✘ 有命中，逐条改掉或加进 ALLOW 并写明理由');
} else {
  console.log('  ✔ 玩家可见文本没有明显 AI 腔调与出戏词');
}
console.log('='.repeat(46));
process.exit(bad ? 1 : 0);
