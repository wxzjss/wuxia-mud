/* ============================================================
 * dark-bg-check.js — 「暗色主题下不许有白块 + 窄屏不许竖排」的守卫
 *
 * 来由（主人 2026-10-11）：
 *   「把『创建角色』『读取存档』这些背景是白色的按钮变成黑色，
 *     把游戏内的白色背景全变成黑色」
 *   后来又补一句：「mod 站也暗色化」，并报了一个手机端症状：
 *   「『武侠行』三个字与其旁边几个小字是从上往下竖着排列的，
 *     『制作教程』『示例 mod』这些也是从上往下竖着的」。
 *
 * 这个脚本不查「有没有写过某个色值」，而是**把变量解开、算出最终颜色**再判亮暗 ——
 * 因为浅色有一万种写法（`#fff` / `#fffdf9` / `rgba(255,255,255,.55)` …），
 * 逐个列是列不完的。
 *
 * ⚠️ 这个守卫自己漏报过一次，教训写在这里：
 *   第一版只认 `rgba()`，**不认十六进制**，于是 `.moon` 的 `#fffdf4`、
 *   以及 21 处 `background: var(--ink)`（字色当实心底）被整片静默放过，
 *   脚本一路绿灯。**守卫漏报比不给守卫更坏：它会让人以为已经查干净了。**
 *   所以本文件末尾带 `--self-test`：拿几个「已知必错」的样本来反考自己，
 *   样本判不出来就退出码非 0。跑全量回归时会顺带跑一次。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const FILES = [
  { label: '游戏 main.css', rel: 'game/src/renderer/css/main.css' },
  { label: 'Mod 站 site.css', rel: 'server/public/css/site.css' },
];

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

/* ============================================================
 * 一、CSS 注释扫描
 * ------------------------------------------------------------
 * 除了「哪些行落在注释里」，还顺手记下**每段注释结束之后紧跟的那个非空白字符**。
 * 这一项是踩出来的：注释正文里只要出现「星号+斜杠」这么一组字符，
 * 注释就会在那里被提前截断，剩下的半句变成无法解析的垃圾 token，
 * CSS 解析器会一路吞到下一个能闭合的地方 —— 连累的往往是紧随其后的整条 @media。
 * （写这段说明的时候真就又踩了一次：CSSOM 里只剩一段媒体查询。）
 * ============================================================ */
function scanComments(src) {
  const lines = new Set(), ranges = [], tails = [];
  let i = 0, line = 1, inC = false, start = 0;
  while (i < src.length) {
    if (src[i] === '\n') { line++; if (inC) lines.add(line); i++; continue; }
    if (inC) lines.add(line);
    if (!inC && src[i] === '/' && src[i + 1] === '*') { inC = true; start = i; i += 2; continue; }
    if (inC && src[i] === '*' && src[i + 1] === '/') {
      inC = false;
      ranges.push({ from: start, to: i + 2, line: src.slice(0, start).split('\n').length });
      let k = i + 2;
      while (k < src.length && /\s/.test(src[k])) k++;
      tails.push({ after: src[k] === undefined ? '' : src[k], line: src.slice(0, i + 2).split('\n').length });
      i += 2; continue;
    }
    i++;
  }
  return { lines, ranges, tails, unterminated: inC };
}

/* ---------- 变量表 / 颜色解析 ---------- */
function varsIn(blockText) {
  const out = {};
  const re = /(--[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(blockText)) !== null) out[m[1]] = m[2].trim();
  return out;
}
/** 取某处后面那一个 `{ … }` 的整块内容 */
function blockOf(src, at) {
  const s = src.indexOf('{', at);
  if (s < 0) return '';
  let d = 0;
  for (let j = s; j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (d === 0) return src.slice(s + 1, j); }
  }
  return '';
}
const WHITE = { r: 255, g: 255, b: 255 };
/**
 * `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` 统一解析成 {r,g,b,a}。
 * ⚠️ 十六进制这一支是后补的 —— 少了它，写死的浅色会被整片漏掉。
 */
function parseFull(v) {
  const s = String(v).trim();
  let m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : parseFloat(m[4]) };
  m = s.match(/#([0-9a-fA-F]{3,8})\b/);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a };
  }
  if (/^\s*white\s*$/i.test(s)) return { r: 255, g: 255, b: 255, a: 1 };
  return null;
}
function resolve(value, vars) {
  let v = String(value), guard = 0;
  while (v.indexOf('var(') >= 0 && guard++ < 10) {
    v = v.replace(/var\((--[a-z0-9-]+)(?:\s*,\s*([^)]*))?\)/g, (all, name, fb) => {
      if (vars[name]) return vars[name];
      if (fb) return fb;
      return 'transparent';
    });
  }
  return v;
}
/* 判「亮不亮」：按 alpha 合成到夜墨底上再看结果。
   `rgba(255,255,255,.05)` 三通道都是 255，可它叠在夜墨上几乎看不见 ——
   只看通道值会把所有半透明暗面误判成白块。 */
const NIGHT = { r: 0x23, g: 0x1c, b: 0x15 };   /* 约等于暗色主题的 --paper 一带 */
function composite(v) {
  const c = parseFull(v);
  if (!c) return null;
  return {
    r: Math.round(c.r * c.a + NIGHT.r * (1 - c.a)),
    g: Math.round(c.g * c.a + NIGHT.g * (1 - c.a)),
    b: Math.round(c.b * c.a + NIGHT.b * (1 - c.a)),
  };
}
const isLight = (c) => c && c.r >= 178 && c.g >= 172 && c.b >= 160;
const colorsIn = (val) => String(val).match(/rgba?\([^)]*\)|#[0-9a-fA-F]{3,8}\b|\bwhite\b/gi) || [];

/** §9 的判据本体（抽成纯函数，⓪ 自测的 F1–F4 要拿它反考自己）。
 *  比对前先 `resolve()` 展开 `var()` —— **比的是最终计算值，不是字面写法**：
 *  「游戏侧写 `var(--xxx)` 间接引用、站点侧仍写字面量」只要展开后同值就该绿，
 *  否则会逼着人放弃「别两处各写一份」的变量纪律。
 *
 *  🔴 悬空洞（严过关 F4 复现的假绿）：`resolve()` 查不到变量时回退 'transparent'。
 *     两边同名变量**都**悬空 ⇒ 'transparent' === 'transparent' ⇒ 假绿，
 *     而真实浏览器里两边的这个变量都会落回继承/初始值——两页是不是同一套根本没验到。
 *     ⇒ 判定：解析结果含 transparent 而**原值没写** transparent ⇒ 这条算不一致。 */
function nightInkDiff(mainVars, siteVars) {
  const keys = ['--paper', '--paper-2', '--ink', '--line', '--red', '--gold', '--surface-3', '--solid'];
  const out = [];
  for (const k of keys) {
    const ra = mainVars[k] === undefined ? '(缺)' : mainVars[k];
    const rb = siteVars[k] === undefined ? '(缺)' : siteVars[k];
    if (ra === '(缺)' && rb === '(缺)') continue;    /* 两边都没有：不在比对范围 */
    if (ra === '(缺)' || rb === '(缺)') { out.push(k + ': 一边没有定义 游戏=' + ra + ' / 站点=' + rb); continue; }
    const ga = resolve(ra, mainVars);
    const gb = resolve(rb, siteVars);
    const holeA = /transparent/i.test(ga) && !/transparent/i.test(ra);
    const holeB = /transparent/i.test(gb) && !/transparent/i.test(rb);
    if (holeA || holeB) {
      out.push(k + ': 🔴 悬空（resolve 后 transparent 而原值不是）游戏=' + ga + ' / 站点=' + gb);
      continue;
    }
    if (ga !== gb) out.push(k + ': 游戏=' + ga + ' / 站点=' + gb);
  }
  return out;
}
/** 注释结束后紧跟的字符，合法的 CSS 续接集合 */
const LEGAL_AFTER = /[}@.#*:\[a-zA-Z0-9_\-/;,)%!+~>|=]/;

/* ============================================================
 * 二、守卫自证
 * 拿「已知必错」的样本反考自己，判不出来就非 0 退出。
 * 默认跑一次（这样全量回归会顺带覆盖它），`--self-test` 只额外打印明细。
 * ============================================================ */
const SELF_FIXTURES = (() => {
  /* ⚠️ 下面这几行字面量里**故意**带了「星号+斜杠」——
     因为要考的就是「注释正文里混进这组字符会不会被发现」。
     它们是字符串内容，不是真注释，所以不会污染本文件。 */
  const fixtures = [
    {
      name: '注释被正文里的注释符提前截断，连累后面的 @media',
      src: '/* 别写 */ 这种东西 */\n@media (max-width: 900px) { .a { color: red } }\n',
      want: 'tail',
    },
    {
      name: '注释开头写了、结尾漏了（把后面的 @media 整条吃掉）',
      src: '/* 忘了收尾\n@media (max-width: 620px) { .a { color: red } }\n',
      want: 'unterminated',
    },
    {
      name: '干净文件（不许误报）',
      src: '/* 正常注释 */\n.a { color: red; }\n@media (max-width: 620px) { .a { color: blue } }\n',
      want: 'clean',
    },
    {
      name: '十六进制浅色背景（第一版守卫漏报的就是这个形状）',
      src: '.moon { background: #fffdf4; }\n',
      want: 'hexlight',
    },
  ];
  return fixtures.map(t => {
    const c = scanComments(t.src);
    const tailBad = c.tails.some(x => x.after !== '' && !LEGAL_AFTER.test(x.after));
    const mediaDead = t.src.split('\n').some((l, i) => /^\s*@media/.test(l) && c.lines.has(i + 1));
    const m = t.src.match(/background\s*:\s*([^;]+);/);
    const p = m ? composite(colorsIn(m[1])[0] || '') : null;
    const hexLight = !!(p && isLight(p));
    const got = c.unterminated ? 'unterminated' : tailBad ? 'tail' : mediaDead ? 'media' : hexLight ? 'hexlight' : 'clean';
    return { name: t.name, got, want: t.want, good: got === t.want };
  });
})();

section('⓪ 守卫自证（拿「已知必错」的样本反考自己，判不出来就是守卫已经瞎了）');
{
  const det = SELF_FIXTURES.filter(x => !x.good);
  if (process.argv.includes('--self-test')) {
    SELF_FIXTURES.forEach(x => console.log('    ' + (x.good ? '✔' : '✘') + ' ' + x.name + ' → 判为 ' + x.got + '（期望 ' + x.want + '）'));
  }
  ok('★ ' + SELF_FIXTURES.length + ' 个必错样本全部能被判出来', det.length === 0,
    det.length ? det.map(x => x.name + ' 判成了 ' + x.got).join(' | ') : '（守卫还睁着眼）');
}

/* ⓪b §9 判据自证（严过关 F1–F4，样本语义照搬他的 .livetest/dbg-fixture-make.js）：
   ⚠️ 不直接用他那份生成器——它靠替换现网 CSS 里的字面量（`--gold-night: #cfa64a;`）
   来注入故障，而那个字面量已经不在 main.css 里了，F4 会「注入失败」。
   ⇒ 这里用**合成对**复刻同样的四种形状，判据本体 nightInkDiff 是同一个，
     判据改了、样本跟着走，永不脱钩。 */
const NIGHT_FIXTURES = [
  {
    name: 'F1 对照：两边字面量相同 ⇒ 期望绿',
    main: ':root { --gold: #cfa64a; }', site: ':root { --gold: #cfa64a; }', wantRed: false,
  },
  {
    name: 'F2 必须命中：站点侧换了别的值 ⇒ 期望红',
    main: ':root { --gold: #cfa64a; }', site: ':root { --gold: #000000; }', wantRed: true,
  },
  {
    name: 'F3 反向：两边 var 间接引用、各自有定义、展开同值 ⇒ 期望绿（不许误伤间接引用）',
    main: ':root { --gold-night: #cfa64a; --gold: var(--gold-night); }',
    site: ':root { --gold-night: #cfa64a; --gold: var(--gold-night); }', wantRed: false,
  },
  {
    name: 'F4 漏洞样本：两边引用同一个谁都没定义的变量 ⇒ 期望红（旧判据假绿的就是这个）',
    main: ':root { --gold: var(--gold-night); }', site: ':root { --gold: var(--gold-night); }', wantRed: true,
  },
];
{
  const bad = [];
  for (const t of NIGHT_FIXTURES) {
    const d = nightInkDiff(varsIn(t.main), varsIn(t.site));
    const gotRed = d.length > 0;
    if (gotRed !== t.wantRed) bad.push(t.name + ' 判成了' + (gotRed ? '红' : '绿'));
    if (process.argv.includes('--self-test')) {
      console.log('    ' + (gotRed === t.wantRed ? '✔' : '✘') + ' ' + t.name
        + (d.length ? ' → ' + d[0] : ''));
    }
  }
  ok('★ §9 判据自证（严过关 F1–F4）：' + NIGHT_FIXTURES.length + ' 组样本全部判对', bad.length === 0,
    bad.length ? bad.join(' | ') : 'F4 的假绿洞已堵上（两边悬空 ⇒ 红）');
}

/* ============================================================
 * 三、逐文件体检
 * ============================================================ */
const fileData = {};
for (const f of FILES) {
  const src = fs.readFileSync(path.join(ROOT, f.rel), 'utf8');
  const lines = src.split('\n');
  const cmt = scanComments(src);
  const rootVars = varsIn(blockOf(src, src.indexOf(':root')));
  const li = src.lastIndexOf('html.theme-light {');
  const lightVars = varsIn(li >= 0 ? blockOf(src, li) : '');

  /* 浅色主题整块豁免（它是「浅色」的定义，本来就该浅） */
  const lightRanges = [];
  {
    let start = null, depth = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('html.theme-light') >= 0) { start = i; depth = 0; }
      if (start !== null) {
        depth += (lines[i].match(/\{/g) || []).length - (lines[i].match(/\}/g) || []).length;
        if (depth <= 0 && lines.slice(start, i + 1).join('').indexOf('{') >= 0) { lightRanges.push([start, i]); start = null; }
      }
    }
  }
  const inLight = (i) => lightRanges.some(([a, b]) => i >= a && i <= b);

  /* 记住当前规则的选择器（选择器可能写在上一行，比如 `#bg-art .moon {`） */
  let sel = '', buf = '';
  const selAt = [];
  for (let i = 0; i < lines.length; i++) {
    buf += ' ' + lines[i];
    if (lines[i].indexOf('{') >= 0) { sel = buf.slice(0, buf.indexOf('{')).trim(); buf = ''; }
    else if (lines[i].indexOf('}') >= 0) { buf = ''; sel = ''; }
    selAt[i] = sel;
  }
  /* 装饰豁免（每一条都写清楚为什么，免得变成「什么都放行」的垃圾桶）：
     · `#bg-art` 里的远山与月 —— 水墨背景的笔触与月亮，不是 UI 面；
       夜里的月亮本来就该亮，把月亮也涂黑属于改错东西。
     · `.ink-line` —— 标题下那一道 3px 的「墨线」，它**必须**跟纸色反着来才看得见：
       浅纸下是深墨线、夜墨下是浅墨线，所以它只能借字色那一族。 */
  const isDecor = (i) => /#bg-art|\.moon\b|\.ink-line\b/.test(selAt[i] || '');

  fileData[f.rel] = { src, lines, cmt, rootVars, lightVars, inLight, selAt, isDecor, label: f.label };
}

for (const f of FILES) {
  const D = fileData[f.rel];
  const { lines, cmt, rootVars, lightVars, inLight, isDecor } = D;
  const inComment = cmt.lines;

  section('【' + D.label + '】① 默认（暗色）主题下，不许有偏亮的背景');
  {
    const bad = [];
    let checked = 0;
    for (let i = 0; i < lines.length; i++) {
      if (inLight(i) || inComment.has(i + 1) || isDecor(i)) continue;
      const m = lines[i].match(/background(?:-color)?\s*:\s*([^;]+);/);
      if (!m) continue;
      const val = resolve(m[1], rootVars);
      if (/transparent|none/i.test(val) && !/rgb|#/.test(val)) continue;
      checked++;
      for (const c of colorsIn(val)) {
        const p = composite(c);
        if (p && isLight(p)) {
          bad.push((i + 1) + ': ' + c + ' → 合成 rgb(' + p.r + ',' + p.g + ',' + p.b + ')  ← ' + lines[i].trim().slice(0, 52));
        }
      }
    }
    ok('★ 亮色背景为 0（远山/月/墨线这些装饰已豁免）', bad.length === 0,
      bad.length ? '\n      ' + bad.slice(0, 10).join('\n      ') : checked + ' 条背景声明全部为深色');
  }

  section('【' + D.label + '】② 背景用到的变量都真有定义');
  {
    const used = new Set();
    const re = /background(?:-color)?\s*:\s*([^;]+);/g;
    let m;
    while ((m = re.exec(D.src)) !== null) {
      (m[1].match(/var\((--[a-z0-9-]+)\)/g) || []).forEach(x => used.add(x.slice(4, -1)));
    }
    /* 游戏页在「设置」里能切回浅纸，所以那边的变量**必须两套齐备** ——
       少一个，切过去就是一块没定义的底色（多半是透明，露出夜墨）。
       Mod 站是单主题页面（没有切换开关），只要求 :root 里有，但要声明 color-scheme: dark。 */
    const hasLight = /html\.theme-light\s*\{/.test(D.src);
    /* ⚠️ 豁免名单：`--tb-*` 顶栏那一簇**刻意不在浅色块里覆写**。
       理由（design/78 §1.2 / §7.2）：顶栏是一条**不可换肤**的恒暗色带，
       `html.theme-light` 里根本就没有 `#topbar` 的覆写 —— 玩家切成浅色，
       顶栏底还是 #3a342c→#2b2721。所以顶栏内部只该有一套值；
       给它补一套"浅色值"反而会让它压在暗底上降到 2.04（银两与称号直接看不见）。
       这与 design/78 的 `78/T-V-6`（浅色块内 --tb-* 覆写数 === 0）是同一条规矩的两面。
       ⇒ 这条断言守的是"换肤的变量别漏一套"，顶栏不换肤，不在它的管辖范围。 */
    const NO_LIGHT_NEEDED = /^--tb-/;
    const miss = hasLight
      ? [...used].filter(v => (!rootVars[v] || !lightVars[v]) && !NO_LIGHT_NEEDED.test(v))
      : [...used].filter(v => !rootVars[v]);
    const excused = hasLight
      ? [...used].filter(v => NO_LIGHT_NEEDED.test(v) && !lightVars[v])
      : [];
    ok(hasLight ? '★ 每个主题色变量在「暗」与「浅」两套里都有值' : '★ 单主题页面：变量在 :root 里齐备',
      miss.length === 0,
      miss.length ? miss.join(', ')
        : [...used].length + ' 个变量齐备' + (hasLight ? '（两套）' : '（单套）')
          + (excused.length ? ' · 豁免 ' + excused.length + ' 个' : ''));
    if (!hasLight) {
      ok('★ 单主题页面必须声明 color-scheme: dark（不声明会被浏览器强制暗色再反相一次）',
        /color-scheme:\s*dark/.test(D.src), 'html { color-scheme: dark }');
    }
  }

  section('【' + D.label + '】③ 注释不许吞掉真代码');
  {
    const medias = lines.map((t, i) => ({ i, t })).filter(x => /^\s*@media/.test(x.t));
    const dead = medias.filter(x => inComment.has(x.i + 1));
    ok('★ 没有被注释吃掉的 @media 块（注释开头写了、结尾漏了会这样）',
      medias.length > 0 && dead.length === 0 && !cmt.unterminated,
      dead.length ? dead.map(x => (x.i + 1) + ': ' + x.t.trim()).join(' | ')
        : medias.length + ' 段媒体查询全部生效');
    const badTail = cmt.tails.filter(t => t.after !== '' && !LEGAL_AFTER.test(t.after));
    ok('★ 注释没有被「正文里的注释符」提前截断',
      badTail.length === 0,
      badTail.length
        ? badTail.map(t => '第 ' + t.line + ' 行注释后紧跟非法字符「' + t.after + '」').join(' | ')
        : cmt.ranges.length + ' 段注释的收尾都干净');
  }

  section('【' + D.label + '】④ 没有自引用的变量');
  {
    /* `--surface-hi: var(--surface-hi);` 这种自己指自己，按 CSS 规则等于「无效」，
       所有用到它的地方会静默退化成 inherit/transparent —— 不报错，就是没效果。 */
    const self = [];
    for (const [k, v] of Object.entries(rootVars)) if (new RegExp('var\\(\\s*' + k + '\\s*\\)').test(v)) self.push(k);
    for (const [k, v] of Object.entries(lightVars)) if (new RegExp('var\\(\\s*' + k + '\\s*\\)').test(v)) self.push('theme-light ' + k);
    ok('★ 没有 `--x: var(--x)` 这种自己指自己', self.length === 0, self.join(', ') || '（干净）');
  }

  section('【' + D.label + '】⑤ 字色那一族不许拿来当实心底');
  {
    /* 主人报的「白色按钮」里最阴的一批：这些按钮的底写的是 `background: var(--ink)`。
       浅色主题里 `--ink` 是深墨，当底天经地义；默认主题翻成暗色后同一个变量
       变成**近白字色** ⇒ 浅底 + 浅字，字直接没了（共 21 处，肉眼极难归因）。
       规矩：实心底必须走 `--solid`。 */
    const bad = [];
    for (let i = 0; i < lines.length; i++) {
      if (inLight(i) || inComment.has(i + 1)) continue;
      const m = lines[i].match(/background(?:-color)?\s*:\s*([^;]+);/);
      if (!m) continue;
      if (/var\(--ink(-[1-4])?\)/.test(m[1]) && !/linear-gradient/.test(m[1])) {
        bad.push((i + 1) + ': ' + lines[i].trim().slice(0, 56));
      }
    }
    ok('★ 没有「字色当实心底」（实心一律走 --solid）', bad.length === 0,
      bad.length ? '\n      ' + bad.slice(0, 8).join('\n      ') : '（干净）');
  }
}

section('【游戏 main.css】⑥ 主人点名的两处：按钮与创建面板');
{
  const D = fileData['game/src/renderer/css/main.css'];
  const grab = (sel) => {
    const i = D.src.indexOf(sel + ' {');
    if (i < 0) return null;
    const m = D.src.slice(i, D.src.indexOf('}', i)).match(/background(?:-color)?\s*:\s*([^;]+);/);
    return m ? resolve(m[1], D.rootVars) : null;
  };
  for (const [sel, name] of [
    ['.btn-ink', '「读取存档 / 登录 / MOD 管理」这类按钮（.btn-ink）'],
    ['.btn-ink.primary', '「创建角色 / 继续游戏」主按钮（.btn-ink.primary）'],
    ['.create-box', '创建角色面板（.create-box）整块']]) {
    const v = grab(sel);
    const p = v === null ? null : composite(colorsIn(v)[0] || v);
    ok('★ ' + name + '底色是深的', v !== null && p !== null && !isLight(p), v === null ? '（找不到该规则）' : v);
  }
}

section('【游戏 main.css】⑥b 主人点名的「白框」「透明板」「月亮」');
{
  const D = fileData['game/src/renderer/css/main.css'];
  const css = D.src, vars = D.rootVars;
  const decl = (sel, prop, at) => {
    const i = at !== undefined ? at : css.indexOf(sel + ' {');
    if (i < 0) return null;
    const seg = css.slice(i, css.indexOf('}', i));
    const m = seg.match(new RegExp(prop + '\\s*:\\s*([^;]+);'));
    return m ? m[1].trim() : null;
  };
  /** 解出这个属性的第一个颜色的 alpha（不透明板 = 1） */
  const alphaOf = (sel, at) => {
    const v = decl(sel, '(?:background|background-color)', at);
    if (v === null) return null;
    const c = parseFull(colorsIn(resolve(v, vars))[0] || '');
    return c ? c.a : null;
  };
  const darkEnough = (sel, at) => {
    const v = decl(sel, '(?:background|background-color)', at);
    if (v === null) return null;
    const p = composite(colorsIn(resolve(v, vars))[0] || '');
    return p ? !isLight(p) : null;
  };

  /* 主人 2026-10-11：「打开地图 / 任务 / 帮助界面，背景怎么是透明的」
     —— 弹窗 `.modal` 用的是 `--surface-3`。上一轮把它写成 `rgba(255,255,255,.07)`，
     于是页面上的字直接透过弹窗看得见。**「板子」必须是不透明的**，
     半透明是 `--card`（悬停洗色）的本意，两者不能混。 */
  const PLATES = [['.modal', '地图 / 任务 / 帮助 弹窗（.modal）'],
    ['.exit-btn', '出口按钮（.exit-btn）'],
    ['.quest-card', '任务卡（.quest-card）'],
    ['.help-card', '帮助卡（.help-card）'],
    ['.map-canvas', '地图画布（.map-canvas）'],
    ['.love-card', '姻缘卡（.love-card）']];
  const seeThrough = [];
  for (const [sel, name] of PLATES) {
    const a = alphaOf(sel);
    if (a === null) { seeThrough.push(name + '（找不到规则）'); continue; }
    if (a < 0.9) seeThrough.push(name + ' alpha=' + a);
  }
  ok('★ 「板子」一律不透明（地图/任务/帮助弹窗、各类卡片不再透出底下的字）',
    seeThrough.length === 0, seeThrough.length ? seeThrough.join(' | ') : PLATES.length + ' 块板子都是实心');

  /* 主人 2026-10-11：「九宫格方向行走的地名按钮是白字没问题但包围白字的框内背景也是白的」
     「『发送』按钮也是这样」。白字配白底 = 字没了 —— 这两个底必须够深。 */
  const lightFills = [];
  const iInline = css.indexOf('.log-line .exit-map .exit-inline {');
  if (darkEnough('.log-line .exit-map .exit-inline', iInline) !== true) lightFills.push('九宫格地名按钮');
  if (darkEnough('#cmd-send') !== true) lightFills.push('发送按钮（#cmd-send）');
  ok('★ 九宫格地名按钮 / 发送按钮：白字底下是深底', lightFills.length === 0,
    lightFills.length ? '底色偏亮：' + lightFills.join(' | ') : '（两处都是深底）');

  /* 指令栏的列宽上限（主人 2026-10-11 通栏改过又**回滚**）：
     现在必须仍与房间卡/日志/快捷条一样收在 `--col-w` 里居中。 */
  const bar = (() => {
    const i = css.indexOf('#cmdbar {');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  })();
  ok('★ 指令栏仍收在 --col-w 居中（主人回滚了「通栏」那版）',
    bar.length > 0 && /max-width:\s*var\(--col-w\)/.test(bar)
    && /margin-left:\s*auto/.test(bar) && /margin-right:\s*auto/.test(bar),
    (bar.match(/max-width:\s*[^;]+;/) || ['（无 max-width）'])[0]);

  /* 主人 2026-10-11：地图上的「连线」太扎眼 ⇒ 调透明。
     判据：两条走廊描边色（写死的浅色 → 已收进变量 `--edge-dim` / `--edge-known`）
     解出来后透明度都不许太高。 */
  const edgeAlpha = (varName) => {
    const v = D.rootVars[varName];
    if (!v) return null;
    const c = parseFull(colorsIn(v)[0] || '');
    return c ? c.a : null;
  };
  const dimA = edgeAlpha('--edge-dim'), knownA = edgeAlpha('--edge-known');
  ok('★ 地图连线已收进变量且够透明（≤ 0.5）',
    dimA !== null && knownA !== null && dimA <= 0.5 && knownA <= 0.5,
    '--edge-dim alpha=' + dimA + ' / --edge-known alpha=' + knownA);
  ok('★ 连线样式走变量（不许再写死浅色）',
    /\.map-edges \.edge-dim \{[^}]*var\(--edge-dim\)/.test(css)
    && /\.map-edges \.edge-known \{[^}]*var\(--edge-known\)/.test(css));

  /* 主人 2026-10-11：右上角月亮跟压在上面的浅色字都是白的，看不清 ⇒ 调低透明度。
     ⚠️ 判据要算**实际落在屏幕上的透明度** = 月亮自己那圈最亮的 alpha × 外层 `#bg-art` 的 opacity。
     只看月亮自己的 alpha 会漏掉外层那道 0.5 的折减（或反过来重复扣一次）。 */
  /* ⚠️ 别用  抠：选择器可能是**并列列表**
     （中屏背景与主菜单共用同一套配方之后就成了
      ）——
     写死单选择器会抠到空串，alpha 读成 0，好端端的样式被判成缺陷。 */
  const iMoonM = css.match(/#bg-art \.moon[^{]*\{/);
  const iMoon = iMoonM ? iMoonM.index : -1;
  const moonSeg = iMoon < 0 ? '' : css.slice(iMoon, css.indexOf('}', iMoon));
  const moonBg = (moonSeg.match(/background:\s*([^;]+);/) || ['', ''])[1];
  const moonMax = Math.max(0, ...colorsIn(moonBg).map(c => (parseFull(c) || { a: 0 }).a));
  const artOpacity = parseFloat((css.match(/#bg-art \{[^}]*opacity:\s*([\d.]+)/) || [, '1'])[1]);
  const moonOnScreen = moonMax * artOpacity;
  ok('★ 月亮透明度已压低（落到屏幕上 ≤ 0.35）', moonMax > 0 && moonOnScreen <= 0.35,
    '最亮 alpha=' + moonMax.toFixed(2) + ' × 外层 ' + artOpacity + ' ≈ ' + moonOnScreen.toFixed(2));
}

section('【游戏 main.css】⑦ 浅色主题仍在（设置里切得回去）');
{
  const D = fileData['game/src/renderer/css/main.css'];
  ok('★ html.theme-light 块还在，且给出了浅纸底',
    /html\.theme-light/.test(D.src) && D.lightVars['--surface'] !== undefined
    && isLight(parseFull(D.lightVars['--surface'])),
    D.lightVars['--surface'] || '（缺 --surface）');
  /* 这条原来写成「把根变量的值代进浅色表再判亮」—— 根变量是不含 var 的字面量，
     代进去等于没代，判的仍是暗色那个值。它过去能过纯属巧合：
     旧值 `rgba(255,255,255,.07)` 的三通道是 255，而当时这里用的是**只看通道**的 parseColor，
     于是把「几乎全透明的浅色」判成了「浅色」。现在直接查浅色表自己的值，才问的是真问题。 */
  const lightPlates = ['--surface-3', '--card-2', '--surface'];
  const notLight = lightPlates.filter(k => !isLight(parseFull(D.lightVars[k])));
  ok('★ 切到浅色时面板 / 按钮 / 卡片回到白纸底', notLight.length === 0,
    notLight.length ? notLight.map(k => k + '=' + D.lightVars[k]).join(' | ')
      : lightPlates.map(k => D.lightVars[k]).join(' / '));
  /* 顺带把「板子必须不透明」也在浅色那套上查一遍（两套的语义要对齐，
     不然切换主题时会出现「这边实心那边透明」）。 */
  const seeThroughLight = lightPlates.filter(k => {
    const c = parseFull(D.lightVars[k]);
    return c && c.a < 0.9;
  });
  ok('★ 浅色那套的板子同样是实心（两套语义对齐）', seeThroughLight.length === 0,
    seeThroughLight.length ? seeThroughLight.map(k => k + ' alpha=' + parseFull(D.lightVars[k]).a).join(' | ')
      : '三块板子都是实心');
}

section('【Mod 站 site.css】⑧ 窄屏不许竖排');
{
  /* 主人 2026-10-11 亲报：「『武侠行』三个字与其旁边几个小字是从上往下竖着排列的」
     「『制作教程』『示例 mod』也是竖着的」。
     病根：窄屏靠 flex 换行，但每一串**没有 nowrap** —— 中文默认允许逐字断行，
     宽度一不够，字就一个一个往下摞。
     这条断言钉住那几条 nowrap；顺带要 620px 断点在（横向滚动与字号收缩都在那里）。 */
  const D = fileData['server/public/css/site.css'];
  const css = D.src;
  /* 把「选择器→声明体」拆成一张表。
     不能用 `css.indexOf(sel + ' {')` —— 选择器可以是多行逗号列表
     （`.a, .b,\n.c { … }`），按字符串找会漏掉这种最该覆盖的写法。 */
  const rules = [];
  {
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) rules.push({ sels: m[1].split(',').map(x => x.trim()), body: m[2] });
  }
  const hasNowrap = (sel) => rules.some(r => r.sels.indexOf(sel) >= 0 && /white-space:\s*nowrap/.test(r.body));

  const need = ['.sh-logo', '.sh-sub', '.sh-nav a'];
  const miss = need.filter(s => !hasNowrap(s));
  ok('★ 顶栏每一串都带 white-space: nowrap', miss.length === 0,
    miss.length ? '缺：' + miss.join(', ') : need.join(' / '));

  /* 同一病根的其余成员：它们都躺在 `display:flex; flex-wrap:wrap` 的父元素里，
     默认能被压到 min-content＝一个字宽，中文就逐字换行。 */
  const pills = ['.btn', '.chip', '.tag', '.cnt', '.lm-badge', '.toc-list a'];
  const missPill = pills.filter(s => !hasNowrap(s));
  ok('★ 「药丸」类小标签（按钮/标签/徽章/目录）整串不拆', missPill.length === 0,
    missPill.length ? '缺：' + missPill.join(', ') : pills.join(' / '));

  const m = css.match(/@media\s*\(max-width:\s*620px\)\s*\{/);
  const i620 = m ? css.indexOf(m[0]) : -1;
  const seg620 = i620 < 0 ? '' : blockOf(css, i620);
  ok('★ 620px 断点在，且导航改成横向滚动（不拆字）',
    i620 >= 0 && /\.sh-nav[\s\S]*?overflow-x:\s*auto/.test(seg620) && /flex-wrap:\s*nowrap/.test(seg620),
    i620 >= 0 ? '断点位于第 ' + css.slice(0, i620).split('\n').length + ' 行' : '（找不到 620px 断点）');
  /* 段落不许 nowrap：整段说明横着冲出去会把卡片顶宽（第一版真这么错过一次） */
  const seg620NoHint = seg620.replace(/\.hero-hint\s+b\b[^{]*\{[^}]*\}/g, '');
  ok('★ 620px 里没有把整段说明文字 nowrap（只允许段落内的短强调串）',
    !/\.hero-hint\s*[,{]/.test(seg620NoHint), '（.hero-hint 段落本身必须能换行）');
}

section('⑨ 两个页面共用同一套夜墨（从 Mod 站点进游戏不许闪一下）');
{
  const a = fileData['game/src/renderer/css/main.css'].rootVars;
  const b = fileData['server/public/css/site.css'].rootVars;
  const diff = nightInkDiff(a, b);
  ok('★ 两处的夜色一致（展开 var() 后逐字相同，悬空引用算不一致）', diff.length === 0,
    diff.length ? '\n      ' + diff.join('\n      ') : '8 个变量一致');
}

console.log(`\n===== dark-bg-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
