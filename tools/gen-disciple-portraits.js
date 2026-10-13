/* gen-disciple-portraits.js —— 给新补的门派弟子/守卫补 C 层画像（design/08 §7.2）
 *
 * smoke-portrait-bc 的硬要求：「C 层槽位补满（一个不剩）」。
 * 这条红是这一批改动带进来的：43_sect_disciples 补了 165 个弟子、
 * 42_sect_guards 补了 41 个守卫，其中 tier=C 的 84 个没有 `portrait`。
 *
 * C 层画像只要五件事（对照 96_portraits_a.json 里已有的 C 层样本）：
 *   role  —— 他在这个江湖里是个什么角色（一句话，带点具体的活儿）
 *   now   —— 他眼下正在过什么日子（**不是**「他是某某弟子」这种自我介绍）
 *   want  —— 他想要什么（小小的、具体的，不要写成人生目标）
 *   voice —— 说话腔调 + 一句口头禅
 *   marks —— 身上一两处记号（外号/门派标记/身体特征）
 *
 * ⚠️ 不写 origin/fear/routine：A 层才配得上那些，C 层填了反而假。
 * ⚠️ 全部按门派气质与姓名 hash 生成，同一个人每次跑出来一样 ——
 *   画像是设定，不是每次刷新随机的。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const dataDir = path.join(ROOT, 'game', 'data');
const load = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));

const sectsAll = load('30_sects.json').sects;
const tiers = load('72_sects_tier.json').sects;
const sects = Object.assign({}, tiers, sectsAll);

function hash(s) {
  let h = 2166136261 >>> 0;
  const t = String(s);
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822505) >>> 0;
  h ^= h >>> 13;
  return h >>> 0;
}
const pick = (arr, seed) => arr[hash(seed) % arr.length];

/* ---- 语气：不再按门派气质挑，而是**按这个人自己的性格**定 ----
   ⚠ 主人 2026-10-13：原来 tone 是「按门派气质」挑的，可persona-portrait-check
     钉着一条更硬的不变量 —— `personaFromVoice(画像语气)` 必须等于他的性格。
     两套口径各挑各的（气质 vs 性格），必然对不上：新补的 160 份画像里
     90 多个人「语气归不了类」，6 个人干脆判反。
   正确做法只有一个来源：**语气由性格决定**，不是反过来。
   每条词都选过、能被 personality.js 的 TONE_KW 认回来（改词前先验一遍）——
     写在表旁边的注释里，改的时候照着对，别又写成认不出来的。 */
const TONE_BY_PERSONA = {
  haoshuang: '嗓门大，说话直爽',
  yinzhi:    '城府深，话里都有算计',
  qienuo:    '结结巴巴，怯生生的',
  xiayi:     '耿直侠气，一句是一句',
  youhua:    '油滑，见人先笑',
  mune:      '慢吞吞，半天才说一句',
  wenwan:    '和气，说话轻',
  baozhao:   '嗓门硬，一句就顶回去',
  lengmo:    '冷淡，话里不带情绪',
};

/* 门派气质 → 一组素材 */
const MOOD = {
  佛道: {
    role: ['在山门下扫了十一年地的老弟子，扫帚柄上磨出了包浆', '管一盏长明灯的，灯芯换得比谁都快',
      '抄经抄到手指变形，字比经上的还端正', '每日三炷香，风雨不误，从没断过'],
    now: ['上个月家里来信，说弟弟染了病，钱还寄不回去', '师父说他心太静，练了三年还没学会怎么跟人说话',
      '眼看就要开春，棉袄该换下来了，可还没攒够钱'],
    want: ['攒够二两银子，把家里那笔债还清', '盼着哪天能跟师兄下山，去看一眼真正的大漠',
      '想讨一本注解来看懂经上那句没头没尾的话'],
    phrase: ['「阿弥陀佛。」', '「施主有事？」', '「山门里不宜喧哗。」'],
    mark: [['僧'], ['道'], ['佛珠'], ['旧布衣']],
  },
  正道: {
    role: ['在演武场边上站了六年的陪练，挨打从不还手', '替师兄弟收尾招的，收得比打得还认真',
      '巡山的，脚步比山猫还轻', '守藏经阁的，闲下来就抄书'],
    now: ['上个月比试输了半招，这一个月每天多练两个时辰', '家书压在枕头底下三个月了，没敢拆',
      '听说掌门要收新弟子，他把位置让给了师弟，自己守着旧摊子'],
    want: ['在下次比试里赢回来', '能替师门接一趟护镖的活', '求一句「你行了」，等了六年没等到'],
    phrase: ['「胜负事小。」', '「同门之间，本该如此。」', '「我这就去办。」'],
    mark: [['掌门亲传'], ['青衫'], ['护腕'], ['旧伤在右腕']],
  },
  邪道: {
    role: ['替上头跑腿的，什么脏活都接，从不多问一句', '在崖上守夜，守了三年没跟人说过一句话',
      '管教里名册的，名字写上去就抹不掉了', '替人收拾尸首的，手比谁都稳'],
    now: ['去年冬天走的那个兄弟，家里的钱还没送过去', '他知道自己迟早也是那个被写进名册的人',
      '有人赏了他一把刀，条件是替人办一件说不清的事'],
    want: ['攒够赎身的银子——虽然没人明说，可他知道有这条道', '往上再挪一挪，哪怕只是一格',
      '把手上的事办完，回家看一眼'],
    phrase: ['「哦。」', '「你猜呢。」', '「别问，问了就得知道。」'],
    mark: [['刀疤'], ['半张脸有麻子'], ['黑衣'], ['指甲缝里有洗不净的黑']],
  },
  镖帮: {
    role: ['扛了六年旗子的，旗子比人还重要', '在库房点货，闭着眼都能点清', '跑外路的，一趟三个月不着家',
      '看夜门的，夜里最精神'],
    now: ['上一趟押货亏了二百两，局里还没追究，也不知追究不追究', '老镖头的腿伤了，局里正缺人顶他的位置',
      '家里的婆娘带着孩子住在城里，他一年见不上两回'],
    want: ['把上一趟亏的补回来', '在局里混个名分，别再被人叫「喂」',
      '等这一趟走完就回家，不干了'],
    phrase: ['「走镖的，认路。」', '「您的货，我担着。」', '「这价钱，砍不动。」'],
    mark: [['护腕'], ['旗'], ['肩上压出的印子'], ['护腰刀']],
  },
  商家: {
    role: ['看铺子的，账本记得比谁都清', '跑街串巷收生意的', '在柜上称银子的，眼睛不抬'],
    now: ['生意比去年冷了三成，掌柜的却还要加租', '他想改行，又放不下攒了十年的那点本钱'],
    want: ['把这个月亏的补回来', '攒够盘下隔壁铺子的钱', '混个「老板」的称呼'],
    phrase: ['「您看这个成色。」', '「这价钱，砍不动。」', '「概不赊账。」'],
    mark: [['算盘'], ['绸衫'], ['金戒指'], ['袖口油渍']],
  },
};

function moodOf(sectId) {
  return MOOD[groupOfMood(sectId)];
}
function groupOfMood(sectId) {
  const s = sects[sectId] || {};
  const a = s.align || '中立';
  const n = s.name || '';
  if (a === '邪道') return '邪道';
  if (/少林|武当|峨眉|泰山|衡山|恒山|青城|崆峒|昆仑|点苍|古墓|桃花|华山|五云手|罗汉/.test(n)) return '佛道';
  if (/镖局|帮|会|水|岛/.test(n)) return '镖帮';
  if (/铁掌|神拳/.test(n)) return '商家';
  return '正道';
}

function buildPortrait(n) {
  const sectId = n.sect || '';
  const m = moodOf(sectId);
  const sectName = (sects[sectId] || {}).name || '本门';
  const seed = n.id;
  const mark = pick(m.mark, seed + 'm');
  /* ⚠️ 素材里写的是「他」（MUD 里泛指），女性 NPC 得换成「她」——
     smoke-portrait-bc 有一条专门盯这个：女性画像的「自己那一栏」出现「他」就是错。
     这几栏里出现的「他」只可能指自己（正文 secret/hooks 不查），
     所以整栏替换是安全的，不用小心翼翼只换词首。 */
  const fem = n.gender === 'female';
  const g = (s) => (fem ? String(s).replace(/他/g, '她') : s);
  const base = {
    v: 1,
    /* ⚠️ tier 必与 NPC 一致。写死 'C' 会造出「B 层 NPC 挂着 C 层画像」，
       smoke-portrait-bc 的「没有串层的画像」就是盯这个。 */
    tier: n.tier === 'B' ? 'B' : 'C',
    lock: false,
    role: g(pick(m.role, seed + 'r')),
    now: g(pick(m.now, seed + 'n')),
    want: g(pick(m.want, seed + 'w')),
    voice: { tone: TONE_BY_PERSONA[n.personality] || TONE_BY_PERSONA.lengmo, catchphrase: pick(m.phrase, seed + 'p') },
    marks: [mark[0]],
    /* 多带一句门派，玩家一眼看得出这是哪家人 —— C 层画像也认得出人 */
    sect: sectName,
  };
  /* ⚠️ B 层画像的必填字段比 C 层多（origin / fear / routine / arc）。
     少写一个，smoke-portrait-bc 的「没有缺字段」就红一条 ——
     不是「画像不好看」，是玩家点开那块是空的。 */
  if (base.tier === 'B') {
    base.origin = g(pick((ORIGIN[groupOfMood(sectId)] || ORIGIN._default), seed + 'o'));
    base.fear = g(pick(FEAR, seed + 'fe'));
    base.routine = [{ at: pick(ROUTINE_AT, seed + 'ra'), act: g(pick(ROUTINE_ACT, seed + 'rb')) }];
    base.arc = pick(ARC, seed + 'ar');
  }
  return base;
}

/* B 层才写得起的「从哪来 / 怕什么 / 日常 / 往后会怎样」 */
const ORIGIN = {
  _default: ['家里兄弟姊妹多，排到自己是最后一个', '早年在别处混过几年，后来嫌那行当脏',
    '本是良家子弟，家道中落才走到这一步'],
  邪道: ['被捡上山的时候还不到十岁，名字是老一辈随手起的',
    '曾是正道门下的弃徒，转投过来之后再没回过头',
    '卖身契按在别人手里，契上写着他的名字'],
  佛道: ['十六岁剃度，师父说是见了佛缘', '家里原本是读书人，出事之后才上山',
    '自幼在寺里长大，没下过山'],
};
const FEAR = ['怕哪天自己也被写成名册上的一行', '怕练不到头，白挨了这多年苦',
  '怕家里人知道自己在这条路上', '怕一个人待太久，待到忘了自己原来是谁'];
const ROUTINE_AT = ['dawn', 'noon', 'dusk', 'night'];
const ROUTINE_ACT = ['天不亮就起来，先扫一遍院子再练功', '晌午靠着墙根打个盹，醒了再练',
  '天擦黑在门口站一会儿，看有没有人上山', '睡得很浅，一有脚步声就醒'];
const ARC = [' someday 会挑明自己当年为什么上山', '迟早要为一个人破一次例',
  '会在某个夜里想清楚自己要什么，只是现在还不想'];

/* ---- 落到数据里 ---- */
const DRY = process.argv.includes('--dry');
/* --force：连已经有画像的也重算一遍。
   素材或规则改了之后必须用它重刷，否则第一次跑出来的旧画像永远留着，
   改生成器等于没改（已经踩过一次：tier 写死 C，改成跟随 tier 却刷不动）。 */
const FORCE = process.argv.includes('--force');
const files = fs.readdirSync(dataDir).filter(f => /^\d+_.*\.json$/.test(f)).sort();
let made = 0;

for (const f of files) {
  const full = path.join(dataDir, f);
  let j = null;
  try { j = JSON.parse(fs.readFileSync(full, 'utf8')); } catch (e) { continue; }
  if (!j || !j.npcs) continue;
  let touched = false;

  for (const [id, d] of Object.entries(j.npcs)) {
    if (!d) continue;
    if (d.portrait && !FORCE) continue;
    /* 只补「有门派身份」的这一类：守卫与弟子。
       别的一律不动 —— 画像是设计内容，不是该由脚本批量糊的东西。 */
    if (d.job !== 'disciple' && d.job !== 'shouwei') continue;
    if (d.tier !== 'C' && d.tier !== 'B') continue;
    d.portrait = buildPortrait(d);
    touched = true;
    made++;
  }

  if (touched && !DRY) fs.writeFileSync(full, JSON.stringify(j, null, 1), 'utf8');
}

console.log(`${DRY ? '[试跑] ' : ''}补 C 层画像 ${made} 份`);
