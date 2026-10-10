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
];

/* 要扫的文件 */
const DATA_DIR = path.join(ROOT, 'game', 'data');
const CORE_DIR = path.join(ROOT, 'game', 'src', 'core');

/* 玩家可见的字段名 */
const VISIBLE_KEYS = new Set([
  'name', 'desc', 'title', 'text', 'answer', 'talk', 'raw', 'msg', 'label', 'hint',
  'topic', 'story', 'goal', 'say', 'line', 'note', 'subtitle', 'stageDesc', 'why',
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

function scanString(str, file, key) {
  if (!str || typeof str !== 'string' || str.length < 6) return;
  /* 去掉明显是代码/标记的串 */
  if (/^[\w_./-]+$/.test(str)) return;
  for (const [label, re] of PATTERNS) {
    const m = str.match(re);
    if (!m) continue;
    const h = { file, key, label, frag: m[0], text: str.length > 90 ? str.slice(0, 90) + '…' : str };
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
  /* 也扫 player-visible 数组里的字符串（help / 剧情池） */
  const re2 = /'(?:[^'\\]|\\.){8,}'/g;
  let m2;
  let n = 0;
  while ((m2 = re2.exec(src)) !== null && n < 4000) {
    n++;
    const s = m2[0].slice(1, -1);
    /* 只留中文长句 */
    if (!/[\u4e00-\u9fa5]/.test(s)) continue;
    if (s.length < 10) continue;
    scanString(s, f, 'inline-str');
  }
}

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
