/**
 * work.js — 打工系统 + 青楼（卖身/接客/赎身）
 *
 * 第 3 批内容：
 *  - 酒楼跑堂、药店抓药打工赚钱（消耗饱食/口渴）
 *  - 女玩家可卖身青楼：卖身 → 接客攒钱 → 赎身（或高好感有钱 NPC 帮赎）
 *  - 卖身后活动范围受限（青楼附近 N 步内）、复活点改为青楼
 */
'use strict';

const { clamp } = require('./utils');

/** 打工岗位：按房间 id/名字 识别（客栈也算酒楼跑堂） */
const JOBS = [
  /* ⚠️ `inn` 曾经是裸写的，结果 `jn_smith_**inn**er`（铁匠铺·炉房）也被判成「跑堂」——
     JOBS 是**按顺序取第一个命中**的，于是铁匠铺打工挣的是 15 文跑堂钱、
     台词还说「你在铁匠铺·炉房里跑堂」。两处修：
       · `_inn(?![a-z_])` —— 负向断言挡住 `_inner` 这类词（真客栈 id 都以 `_inn` 结尾）；
       · 同时保留中文「客栈」兜底（六家客栈房名都带「客栈」）。 */
  { key: 'waiter', name: '跑堂', wage: 15, timeCost: 30, foodCost: 12, waterCost: 8, roomRe: /(tavern|wine|_inn(?![a-z_])|酒楼|酒馆|酒家|饭庄|客栈|醉仙楼|天香楼|望江楼|汉江楼)/ },
  { key: 'herbalist', name: '抓药', wage: 20, timeCost: 30, foodCost: 10, waterCost: 8, roomRe: /(pharmacy|药铺|医馆|药房|杏林|回春堂|药)/ },
  /* ---- 下面三类是主人第四轮报「点了没反应」时补的 ----
     症状：铁匠铺·炉房「炉火」、青溪村·碾房「石磨」、醉春楼后厨「灶台」
     三个「此地可做」按钮，点下去一律「这里没有你能干的活计（去酒楼或药店看看）」——
     因为原来 JOBS 只认「跑堂 / 抓药」两类，别的房间名一个都不匹配。
     项目铁律「给不出的项**一律不给**」，但这里是**给得出**的：
     铁匠铺拉风箱、碾房推碾、后厨帮厨，都是江湖人挣口饭钱的正经营生。
     所以补 job 而不是删按钮 —— 顺便让这三个房间不再是空摆设。
     ⚠️ 房号正则匹配的是 `room.id + '|' + room.name`（见 canWork），
        id 里带 smith/mill/kitchen 的都认，中文房名也认。 */
  { key: 'smith', name: '拉风箱', wage: 18, timeCost: 30, foodCost: 14, waterCost: 10, roomRe: /(smith|forge|铁匠|铁砧|炉房|打铁)/ },
  { key: 'miller', name: '推碾', wage: 13, timeCost: 30, foodCost: 13, waterCost: 9, roomRe: /(mill|碾房|碾|磨坊|谷仓)/ },
  { key: 'kitchen', name: '帮厨', wage: 14, timeCost: 30, foodCost: 12, waterCost: 9, roomRe: /(kitchen|后厨|灶|伙房)/ },
];

/** 青楼房间识别
 *  ⚠️ 两处判定曾经分叉过（work.js 认「怡红/翠云/凤来」但漏 region；
 *     kidnap.js 认 region 但漏「怡红院/牡丹阁/翠云楼/凤来仪」），
 *     结果是玩家在江南以外的城市赎身会静默走进兜底分支。
 *     现在统一成同一份正则 + 一条 region 捷径，谁都别再单独改。
 *  ⚠️ 只加明确带妓业意味的词，不加裸「楼/阁」——带楼阁的普通建筑太多。*/
const BROTHEL_RE = /青楼|勾栏|教坊|花楼|妓院|妓|窑子|清倌|丽人院|醉春楼|楚馆|平康坊|宜春院|怡红院|牡丹阁|翠云楼|凤来仪|绮罗院|春香阁|听雨楼|望江阁|天香阁/;

function isBrothel(world, roomId) {
  const r = world.getRoom(roomId);
  if (!r) return false;
  if (r.region === 'qinglou') return true;   /* 醉春楼那几间在数据里标了 region */
  return BROTHEL_RE.test(r.name || '');
}

/** 当前房间能不能打工 */
function canWork(world) {
  const p = world.player;
  if (!p) return { ok: false, reason: '无人' };
  if (p.prostitution && p.prostitution.sold) {
    return { ok: false, reason: '你已是青楼之人，自有营生（接客），不必再打零工。' };
  }
  const room = world.getRoom(p.room);
  if (!room) return { ok: false, reason: '这里无工可打' };
  const sig = (room.id || '') + '|' + (room.name || '');
  const job = JOBS.find(j => j.roomRe.test(sig));
  if (!job) return { ok: false, reason: '这里没有你能干的活计（去酒楼或药店看看）' };
  if (p.food < job.foodCost || p.water < job.waterCost) {
    return { ok: false, reason: '你饥渴难耐，实在干不动了（先吃点喝点再来）' };
  }
  return { ok: true, job };
}

/** 打工 */
function work(world) {
  const c = canWork(world);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.reason }] };
  const p = world.player, job = c.job;
  const room = world.getRoom(p.room);
  p.food = clamp(p.food - job.foodCost, 0, p.maxFood);
  p.water = clamp(p.water - job.waterCost, 0, p.maxWater);
  p.money += job.wage;
  world.advanceTime(job.timeCost);
  const wl = [
    { kind: 'story', text: `你在${room.name}里${job.name}，忙前忙后，好一阵操劳。` },
    { kind: 'sys', text: `东家结算工钱，你赚了 ${job.wage} 文钱（饱食 -${job.foodCost}，饮水 -${job.waterCost}）。` },
  ];
  /* 做活儿也在长见识（主人 2026-10-08 的「其他方式」之一，量小） */
  try { require('./potential').grant(p, require('./potential').WORK_REWARD, wl, '闯练'); } catch (e) { }
  return { ok: true, lines: wl };
}

/* ===================== 青楼 ===================== */

const SELL_PRICE = 800;      // 卖身银（立得）
const REDEEM_MULT = 2;       // 赎身价 = 卖身银 × 2
const BROTHEL_RANGE = 3;     // 卖身后活动范围（离青楼 N 步内）

/** 卖身青楼 */
function sellBody(world) {
  const p = world.player;
  /* 主人 2026-10-10：青楼这条路男女皆可走 —— 男儿身在楼里另有去处
     （男客由女倌陪，女客则由男倌陪，规矩是一样的）。这也正是合欢宗收人的由来。 */
  if (p.gender !== 'female' && p.gender !== 'male') {
    return { ok: false, lines: [{ kind: 'warn', text: '楼里认不出你的路数，不敢收。' }] };
  }
  /* 🔴 男儿身**默认不收**（主人 2026-10-11 改的口径）。
     原来男女都一样，画了押就收 —— 可楼里收个男倌是要担干系的（招来的客人不对路、
     嘴不严、手上不干净，砸的是整座楼的牌子）。所以改成：先替苗春办成一桩事
     （青楼支线「楼里的门道」），她认了你的手段，牌子才挂得上。
     女儿身照旧直接进（楼里本来就是做这个的）。
     ⚠️ 判据是 `brothel_permit` 这个 flag —— 由那条支线的**收尾阶段**用 effects 打上，
        所以「做完任务」与「能卖身」永远是同一件事，不会各说各话。 */
  if (p.gender === 'male' && !(p.hasFlag && p.hasFlag('brothel_permit'))) {
    return {
      ok: false, lines: [
        { kind: 'say', text: '苗春把你从头看到脚，笑了一声：「我们这儿不留男的。」她把团扇在掌心敲了敲，「要真想在我楼里落脚——先替我做几天事。手脚干净、嘴严，我才敢用你。」' },
        /* ⚠️ 主人 2026-10-13 报：「点了卖身弹出一句话让我找苗春，可这屋里没有苗春」。
           苗春就在门厅（tag=madam），可门厅那排可点按钮上写的是**「老鸨」**
           （见 62_shops.json 的 jn_brothel_gate.actions），玩家照着「苗春」这个名字
           去屋里找人对不上号。提示得按**屏幕上真看得到的字**说。 */
        { kind: 'hint', text: '（点门厅里那个「老鸨」，接她手里的活「楼里的门道」；去望江阁替她招呼三趟客人，再回来回话。）' },
      ],
    };
  }
  if (!isBrothel(world, p.room)) return { ok: false, lines: [{ kind: 'warn', text: '你得在青楼里，才能谈卖身之事。' }] };
  if (p.prostitution && p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你已身入青楼。' }] };
  const debt = SELL_PRICE * REDEEM_MULT;
  p.money += SELL_PRICE;
  p.prostitution = { sold: true, brothelRoom: p.room, debt, since: world.clockMinutes, served: 0, earnings: 0 };
  const room = world.getRoom(p.room);
  const roleCN = p.gender === 'female' ? '姑娘' : '后生';
  return {
    ok: true, lines: [
      { kind: 'story', text: `你咬咬牙，在${room.name}老鸨手里画了押，领了 ${SELL_PRICE} 文卖身银。老鸨上下打量你一遍，只说了一句：「这${roleCN}，能挂牌子。」` },
      { kind: 'warn', text: `你欠下赎身债 ${debt} 文。每日「接客」所得尽数抵债，还清即可「赎身」脱籍；有交情深的贵人，也肯替你赎身。` },
      { kind: 'hint', text: '（楼里接待满十位之后，自有人来跟你说另一桩事。）' },
    ],
  };
}

/* ------------------------------------------------------------------ *
 *  接客：一晚一位客人，六种人、六种场面
 *
 *  主人 2026-10-11：「『接客』按钮按了怎么都是一些固定的模板话，没有详细描述吗？」
 *  原来只有一句「你强颜欢笑，应酬了一夜的客人」—— 接一百次也是这一句。
 *
 *  ⚠️ 不重样的做法与 dualcultivate 同一套：按 `served`（接过的第几位）取下标，
 *     而不是拿「客人名 + 次数」去哈希 —— 哈希撞车就重复（那边实测撞过）。
 *     取模步进可以保证**前六次一位不重**。
 * ------------------------------------------------------------------ */
const CUSTOMERS = [
  {
    who: '一个赶考的举子',
    open: '一个赶考的举子，袖口还沾着墨。他进门先问有没有安静的地方，说想坐着说说话。',
    mid: '他跟你讲了三遍他写的策论，讲到他爹把盘缠塞给他那天，声音低下去。你没接话，只替他把凉了的茶换了一遍。',
    close: '天快亮他起身整衣，把钱搁在桌上，走前回身作了个揖：「今夜多有叨扰。」',
  },
  {
    who: '一个跑远路的茶商',
    open: '一个跑远路的茶商，靴子上全是泥。他往榻上一歪，先骂了半炷香的镖局，又骂了今年的雨水。',
    mid: '骂完了，他从怀里摸出一小包茶，非要给你尝。他说这条道上走了二十年，就剩这点东西还算干净。',
    close: '他睡得极沉。五更时你叫了两遍才把人叫醒，他含糊说了句「下回还来」，披上衣服就走了。',
  },
  {
    who: '一个从边镇回来的军汉',
    open: '一个从边镇回来的军汉，左臂缠着布。他把腰刀解下来搁在脚边，说刀不许带进屋，这是规矩。',
    mid: '他说他手上过的名字，比这楼里挂的灯还多。说完他自己愣了愣，把话岔开，问你今年多大。',
    close: '他走的时候把刀重新背好，在门口站直了才跨出去。走廊上那两步，走得像在营里。',
  },
  {
    who: '一位家道中落的老秀才',
    open: '一位老秀才，衣裳洗得发白，扣子却一颗不缺。他把带来的两枝桂花插进瓶里，说楼里的脂粉气太重。',
    mid: '他给你念了一段自己年轻时写的赋，念到一半笑自己：「如今只剩这点东西拿得出手。」',
    close: '他不肯多留，说家里还有人在等门。走前把桂花留下了，说插着好看。',
  },
  {
    who: '一个刚接手家业的年轻东家',
    open: '一个年轻东家，衣着讲究，坐下却不知道手往哪儿放。他先问你好不好，问完自己先红了脸。',
    mid: '他说他爹去年走的，柜上那几位老伙计一个都不服他。他一口气说到三更，说到后来是在跟自己说话。',
    close: '天蒙蒙亮他才想起来要走，出门前回头看了你一眼，像是想说什么，到底没开口。',
  },
  {
    who: '两个结伴来的行商',
    open: '两个结伴来的行商，一个话多一个话少。话多的那位一进屋就嚷着要酒，话少的那位只坐在灯影里看你。',
    mid: '酒过两巡，话多的那位开始讲他年轻时丢的那船货。讲到一半，话少的那位替他把话说完了——原来两个人是那一年在码头上认识的。',
    close: '两个人走的时候互相扶着，笑声一路滚下楼梯。桌上那壶酒还剩半壶。',
  },
];

/* ------------------------------------------------------------------ *
 *  今晚的客人是谁（主人 2026-10-11）
 *
 *  原话：「青楼『接客』抓取附近单身异性 npc（根据 npc 设定来）接真实的客人
 *        （然后该 npc 身上的钱会真实花掉一些，增加双方好感，且下次遇到该 npc 时
 *          屏幕上会显示该 npc 看到你后的调侃语气语言表情动作等表现）」
 *
 *  改之前：客人是六条写死的模板（赶考举子 / 茶商 / 军汉…），跟楼里站着谁毫无关系 ——
 *  屋里空无一人，照样「接」进来一位。
 *
 *  改之后：从**本屋 + 相邻一间**挑一个合乎规矩的活人。挑到了就接真客 ——
 *  他身上的钱**真花掉**、两边好感**真涨**、这桩事**记在他身上**
 *  （下次碰面，他会拿这个打趣你）。挑不到，才退回原来那套模板客人：
 *  楼里没客人的夜里，总得有过路的，不能让这个玩法空转。
 * ------------------------------------------------------------------ */

/** 是不是「人」——兽类不算客（复用与拷问/切磋同一套判据口径） */
function isPersonGuest(n) {
  if (!n) return false;
  if (n.isPlayer) return false;
  if (n.dead || n.knockedOut) return false;
  if (n.gender !== 'male' && n.gender !== 'female') return false;   /* 认不出男女的（含兽）不接 */
  if (/\b(狼|虎|熊|蛇|豹|鹰|鼠|猴|蛟|兽|马|驴)/.test(String(n.name || ''))) return false;
  return true;
}

/**
 * 挑今晚的客人。规矩一条条写在下面 —— 生意是生意，不是逮谁算谁。
 * @returns {object|null}
 */
function pickGuest(world, p) {
  const pool = [];
  const addFrom = (roomId) => {
    for (const n of (world.npcsIn(roomId) || [])) {
      if (n && !pool.some(x => x.id === n.id)) pool.push(n);
    }
  };
  addFrom(p.room);
  /* 隔壁一间也算：客人是「上门来的」，不必正站在楼里 */
  const room = world.getRoom(p.room);
  if (room) {
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && world.getRoom(t)) addFrom(t);
    }
  }
  const cands = pool.filter(n =>
    isPersonGuest(n) &&
    n.gender !== p.gender &&                       /* 异性 */
    !(n.spouse || (n.def && n.def.spouse)) &&      /* 单身 */
    !n.shop &&                                     /* 铺子老板要看店，不是客 */
    !(n.followPlayer) &&                           /* 自家跟班不算客 */
    /* 他自己的师父不接 —— 这个不是「设不设定」的问题，是尴尬。
       ⚠️ 这里**不能**用 `def.teach` 当「教拳的」判据：77_npc_skills 给几乎每个
          NPC 都配了功法，一挡就是全场（第一版就是这么把所有人都筛没的）。 */
    !(p.masters && p.masters[n.defId || n.id]) &&
    /* 楼里的人不是客 —— 老鸨、姑娘、帮闲都是自家人 */
    !/madam|courtesan|singer|consort|prostitut/i.test(String((n.def && n.def.tag) || ''))
  );
  if (!cands.length) return null;
  const r = (world.rng && world.rng.next) ? world.rng.next() : Math.random();
  return cands[Math.floor(r * cands.length) % cands.length];
}

/** 客人的路数：按身份（tag / 门派）分档，各写各的话 */
function guestKindOf(n) {
  const tag = String((n.def && n.def.tag) || '') + ' ' + String(n.title || '');
  if (/official|court|锦衣|官|衙|内侍|嫔|捕/.test(tag)) return 'official';
  if (/sword|blade|fist|guard|escort|刀|剑|拳|镖|武|侠|将|兵/.test(tag)) return 'warrior';
  if (/merchant|商|贾|东家|掌柜/.test(tag)) return 'merchant';
  if (/scholar|book|litterateur|书|文|生|秀才|先生|画/.test(tag)) return 'scholar';
  if (/monk|nun|僧|尼|道|和尚/.test(tag)) return 'monk';
  return 'common';
}

/** 各路人马在楼里是什么样子（每组三份，按接过的次数取模步进，不重样） */
const GUEST_SCENE = {
  official: [
    { open: '{a}进门先把氅衣交给随从，眼睛在屋里扫了一圈，才落到你身上。他说话很慢，每个字都像在过秤。',
      mid: '他闭口不谈衙门里的事，倒问你家里还剩下什么人。听你说完，他「唔」了一声，把茶盖拨了两下，没再往下接。',
      close: '天将明时他起身，随手把赏钱搁在桌上，说了一句「今日之事，出得门便忘了」，连头也没回。' },
    { open: '{a}来得很迟，随从都留在门外。他自己解了外袍，说这半年就没睡过一个囫囵觉。',
      mid: '他忽然说起年轻时在城外看人放纸鸢，说着说着停了，问你见过没有。你说见过，他笑了。',
      close: '走时他把窗推开一道缝，站了一会儿才走。他留下的钱不少，话却很少。' },
    { open: '{a}衣冠齐整，坐下先问你识不识字。你说识得几个，他挑了挑眉，倒也没再多问。',
      mid: '他叫你把灯芯剪短些，说亮堂了他不自在。灯暗下来，他的话才慢慢多起来。',
      close: '他临走叮嘱了一句：「方才的话，风一吹就散。」说完自己先笑了，笑得有点苦。' },
  ],
  warrior: [
    { open: '{a}佩刀进门，先依规矩把刀搁在门口，回身时步子很沉。他坐下就着酒吃了一大口肉，没说话。',
      mid: '他身上有新伤。你替他把酒温了一回，他看你一眼，把袖子往上撸了撸，那道口子还在渗。',
      close: '五更他起身把刀重新系上，在门口站直了才推门。走廊上那两步，走得像在营里。' },
    { open: '{a}进来时带着一身寒气，说是刚从城外回来。他把钱袋往桌上一放，先要了壶烫酒。',
      mid: '三杯之后他才开口，说的是他师门那桩旧事。说到一半自己停了，摆摆手说「扯远了」。',
      close: '酒钱多给了两成。他说常年在外的人，碰上能安安静静说句话的地方不多。' },
    { open: '{a}把膀子上的刀伤给你看，说这行做久了，刀口比人头熟。这话他自己先笑了一声。',
      mid: '他问你怕不怕。你说怕。他点点头，说怕的人能活久些。',
      close: '天没亮他就走了，说要赶在开城门前出城。桌上的酒还温着。' },
  ],
  merchant: [
    { open: '{a}一进门就抱怨路不好走、镖局不顶事、这两年的行情一年不如一年。他抱怨的时候手一直在数钱。',
      mid: '骂够了，他从怀里掏出一小包茶，非要给你尝。他说这条道上走了二十年，就剩这一样东西还算干净。',
      close: '他睡得极沉，五更时叫了两遍才醒，含糊说了句「下回还来」，披上衣服就走了。' },
    { open: '{a}是跑水路来的，鞋底还是湿的。他坐下先算了一笔账，算完自己叹口气，把账本合上了。',
      mid: '他说他这辈子最得意的一桩买卖，其实没赚几个钱。「那会儿年轻，」他说，「赔了也高兴。」',
      close: '他把剩下的钱都留在桌上，说出门在外，钱在怀里揣着反而睡不踏实。' },
    { open: '{a}进门先问楼里有没有安静的地方，说想坐着说说话——不是那种话。',
      mid: '他讲了三遍他儿子的事。讲到第三遍的时候他自己也觉出来了，笑了笑，不讲了。',
      close: '他走时作了个揖，说今夜多有叨扰。桌上留的赏钱不多不少，是个懂规矩的数目。' },
  ],
  scholar: [
    { open: '{a}袖口还沾着墨。他把带来的两枝桂花插进瓶里，说楼里的脂粉气太重。',
      mid: '他给你念了一段自己年轻时写的赋，念到一半笑自己：「如今只剩这点东西拿得出手。」',
      close: '他不肯多留，说家里还有人在等门。走前把桂花留下了，说插着好看。' },
    { open: '{a}坐下先端详这间屋子，说墙上的字画挂反了。他起身替楼里正了过来，这才坐回去。',
      mid: '他说他考了三回，三回都差着一口气。说到这儿他顿了顿：「差着一口气，就是差一辈子。」',
      close: '他临走把自己的名帖留下，说往后若有事，可以凭这个去找他。名帖很旧，边角都磨白了。' },
    { open: '{a}话不多，一直在看你案上那半卷书。后来他问你读到哪儿了，你说不太懂。',
      mid: '他就着灯替你讲了半篇。讲到妙处他自己先兴奋起来，声音大了些，又忙压回去。',
      close: '他走的时候天边泛白。他说这一夜讲得比在书院痛快，说完自己先不好意思了。' },
  ],
  monk: [
    { open: '{a}念了声佛才进门，坐下时离你隔着半张桌子。他说施主不必多礼。',
      mid: '他不多话，只替你添了两回茶。末了说了句「各人有各人的苦」，也没说这苦是谁的。',
      close: '天亮他起身合十，把化缘来的钱数出一半搁下，说算是茶钱。他走后屋里静了很久。' },
    { open: '{a}是云游来的，袈裟上补过好几处。他说他走了三千里，见过的人比念过的经多。',
      mid: '你问他累不累。他说脚不累，心累。说完自己念了声佛，像是说漏了嘴。',
      close: '他走时不带一片云，只把门口那双破草鞋脱下来，赤着脚走了。' },
    { open: '{a}进门先替你把这间屋子的窗开了条缝，说闷。他自己反倒站在风口里。',
      mid: '他说他年轻时也在这楼里待过——不是客人。这话说完他就闭了嘴，你不问，他也不说。',
      close: '他天不亮就走了。桌上一盏茶，一口没动。' },
  ],
  common: [
    { open: '{a}摸着手里的酒盏，半晌才开口，说他是头一回进这种地方，让你别笑。',
      mid: '他讲他家里那几亩地、那头牛，讲得很细。讲到后来声音低下去，像是说给自己听。',
      close: '他走前把钱数了两遍，数完脸红了，说就这么点。你说够了，他还是很过意不去。' },
    { open: '{a}进来时脚上还沾着泥，说是从城外走了半日。他先要了碗热汤，喝完了才说话。',
      mid: '他说他娘病着呢，家里那点钱都换成了药。说到这儿他停下，问你有没有见过那种药。',
      close: '他走时把剩下的半包干粮留给你，说夜长，饿了垫垫。那干粮很硬，你收下了。' },
    { open: '{a}是街口那家铺子的伙计，白天你还跟他打过照面。他一进门就挠头，含糊说了句「是我」。',
      mid: '他说他攒了半年工钱就为来一趟，来了又不知道说什么。后来他说了半宿他师傅的不是。',
      close: '走的时候他把门槛绊了一下，踉跄着也没回头，怕你笑他。' },
  ],
};

/** 按「接过的第几位 + 客人 id」取一组，保证同一位客人的三段是成套的 */
function guestScene(kind, seed) {
  const arr = GUEST_SCENE[kind] || GUEST_SCENE.common;
  let h = 2166136261 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return arr[(h >>> 0) % arr.length];
}

/** 接客攒钱（每次一小时） */
function serveCustomer(world) {
  const p = world.player;
  if (!p.prostitution || !p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你又非青楼之人，接的什么客。' }] };
  if (!isBrothel(world, p.room)) return { ok: false, lines: [{ kind: 'warn', text: '你得回青楼里，才能接客。' }] };

  const rnd = (world.rng && world.rng.next) ? world.rng.next() : Math.random();
  const earnBase = 40 + Math.floor(rnd * 30);            // 40~69 文
  const guest = pickGuest(world, p);

  let earn = earnBase;
  const lines = [];

  if (guest) {
    /* ---- 真客：按他的路数演这一晚 ---- */
    const kind = guestKindOf(guest);
    const scene = guestScene(kind, (guest.defId || guest.id) + '|' + (p.prostitution.served || 0));
    const name = guest.name || '客人';
    const sub = (t) => String(t).replace(/\{a\}/g, name);

    lines.push({ kind: 'subtle', text: `—— ${name} ——` });
    lines.push({ kind: 'story', text: sub(scene.open) });
    lines.push({ kind: 'story', text: sub(scene.mid) });
    lines.push({ kind: 'plain', text: sub(scene.close) });

    /* 他身上的钱**真花掉**（不是凭空印给你的）：出得起多少就赏多少 */
    guest.carry = guest.carry || {};
    const purse = Math.max(0, Math.floor(guest.carry.money || 0));
    const want = earnBase + 20;                          /* 这一晚的开销 */
    const paid = Math.min(purse, want);
    if (paid > 0) {
      guest.carry.money = purse - paid;
      earn = paid;
      lines.push({ kind: 'favor', text: `${name}把 ${paid} 文搁在桌上（身上还剩 ${guest.carry.money} 文）。` });
    } else {
      /* 兜里比脸还干净 —— 白陪一场，但人情记下了 */
      earn = 0;
      lines.push({ kind: 'plain', text: `${name}把袖子翻了个遍，一个钱也没翻出来。` });
      lines.push({ kind: 'hint', text: '（这一晚没进项 —— 不过人情是记在人家心里的。）' });
    }

    /* 两边都好：他记你的好，你也算认得一个人 */
    try {
      const social = require('./social');
      const fr = social.addFavor(world, guest, (paid > 0 ? 5 : 8) * (world.favorGainMult ? world.favorGainMult(p) : 1), '有过一晚');
      if (fr && fr.lines && fr.lines.length) lines.push(...fr.lines);
    } catch (e) { /* 记不上账不该挡着接客 */ }

    /* 这桩事记在他身上：下次碰面他要拿这个打趣你（npcMemory.brothelLine） */
    guest.pstate = guest.pstate || {};
    guest.pstate.brothelMet = {
      at: world.clockMinutes || 0,
      times: ((guest.pstate.brothelMet && guest.pstate.brothelMet.times) || 0) + 1,
    };
    p.prostitution.familiar = (p.prostitution.familiar || []).slice();
    if (p.prostitution.familiar.indexOf(guest.defId || guest.id) < 0) {
      p.prostitution.familiar.push(guest.defId || guest.id);
    }
  } else {
    /* ---- 今夜楼里没客人走动：退回原来那几位过路的 ---- */
    const idx = (p.prostitution.served || 0) % CUSTOMERS.length;
    const g = CUSTOMERS[idx];
    lines.push({ kind: 'subtle', text: `—— ${g.who} ——` });
    lines.push({ kind: 'story', text: g.open });
    lines.push({ kind: 'story', text: g.mid });
    lines.push({ kind: 'plain', text: g.close });
  }

  /* 接客所得全部抵赎身债（老鸨抽成，到不了自己腰包），
     不再额外加玩家钱 —— 否则「既得钱又减债」会翻倍 */
  p.prostitution.earnings = (p.prostitution.earnings || 0) + earn;
  p.prostitution.served = (p.prostitution.served || 0) + 1;
  p.prostitution.debt = Math.max(0, p.prostitution.debt - earn);
  p.food = clamp(p.food - 10, 0, p.maxFood);
  p.water = clamp(p.water - 10, 0, p.maxWater);
  p.hp = clamp(p.hp - 8, 1, p.maxHp); // 接客伤身，但不会死
  world.advanceTime(60);

  lines.push({ kind: 'sys', text: `你赚了 ${earn} 文，尽数抵了赎身债，还差 ${p.prostitution.debt} 文。` });
  return { ok: true, lines };
}

/** 赎身（赎身债还清即可脱籍） */
function redeem(world) {
  const p = world.player;
  if (!p.prostitution || !p.prostitution.sold) return { ok: false, lines: [{ kind: 'warn', text: '你又非青楼之人，赎的什么身。' }] };
  const debt = p.prostitution.debt || 0;
  if (debt > 0) return { ok: false, lines: [{ kind: 'warn', text: `赎身债还没还清（还差 ${debt} 文），再「接客」攒一攒吧。` }] };
  p.prostitution = { sold: false, redeemed: true };
  return {
    ok: true, lines: [
      { kind: 'story', text: '你终于还清了赎身债，赎回自己的身子，脱了乐籍。' },
      { kind: 'sys', text: '从今往后，你又是自由之身了。' },
    ],
  };
}

/** 最近的青楼房间 id（卖身时记下，否则 BFS 找） */
function brothelAnchor(world) {
  const p = world.player;
  if (p && p.prostitution && p.prostitution.brothelRoom) return p.prostitution.brothelRoom;
  if (!p) return null;
  if (isBrothel(world, p.room)) return p.room;
  const seen = new Set([p.room]);
  const q = [p.room];
  while (q.length) {
    const id = q.shift();
    const room = world.getRoom(id);
    if (!room) continue;
    for (const d of Object.keys(room.exits || {})) {
      const ex = room.exits[d];
      const t = typeof ex === 'string' ? ex : ex.to;
      if (t && world.getRoom(t) && !seen.has(t)) {
        if (isBrothel(world, t)) return t;
        seen.add(t);
        q.push(t);
      }
    }
  }
  return null;
}

/** 卖身后能否去 roomId（青楼附近 N 步内才放行） */
function withinBrothelRange(world, roomId) {
  const anchor = brothelAnchor(world);
  if (!anchor) return true; // 无青楼则不限制
  if (anchor === roomId) return true;
  const seen = new Set([anchor]);
  let frontier = [anchor];
  for (let step = 0; step < BROTHEL_RANGE; step++) {
    const next = [];
    for (const id of frontier) {
      const room = world.getRoom(id);
      if (!room) continue;
      for (const d of Object.keys(room.exits || {})) {
        const ex = room.exits[d];
        const t = typeof ex === 'string' ? ex : ex.to;
        if (t && world.getRoom(t) && !seen.has(t)) {
          if (t === roomId) return true;
          seen.add(t);
          next.push(t);
        }
      }
    }
    frontier = next;
  }
  return false;
}

module.exports = {
  JOBS, isBrothel, canWork, work,
  sellBody, serveCustomer, redeem, brothelAnchor, withinBrothelRange,
  BROTHEL_RE, SELL_PRICE,
  /* 「接真客」那套（给测试留的门）：挑客判据 / 挑客 / 路数 / 场面池 */
  isPersonGuest, pickGuest, guestKindOf, GUEST_SCENE,
};
