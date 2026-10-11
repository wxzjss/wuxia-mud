/**
 * dualcultivate.js — 双修 / 采补（主人 2026-10-11 重做）
 *
 * 主人原话拆开：
 *   ①「为什么『双修』在秘技里？不应该正常显示在点击角色名字后弹出来的 NPC 互动界面上吗？」
 *      → 从秘技面板**移走**，改挂 NPC 互动面板的按钮。采补同理。
 *   ② 点击时要判定：**双方关系**（情侣/夫妻一档）→ 不是的话再判
 *      **双方性格** + **对方有没有家世**（有家世则看丈夫/妻子还健在不健在）。
 *   ③ 效果：双方好感 + **小幅提升各武学进度 + 内力上限**；有双修类功法提升更大。
 *   ④ 短时间内只能一次（冷却）。
 *   ⑤ 还要判：**是不是晚上**、**周围有没有人** —— 有人时除个别性格的 NPC，一律不答应。
 *   ⑥ 过程「缓慢弹出」，**不能走动也不能点别的按钮**（跟吐纳一个路子）。
 *   ⑦ 中途有人经过 → 对方的性格/身份会做什么说什么、双修对象又会做什么说什么，
 *      效果大打折扣，双修对象好感小幅下降。
 *   ⑧ 双方动作语言神态要**写细**，而且**不能每次一个样**。
 *
 * ⚠️ 与 `arts.js` 的关系：秘技模块里那两条（`art_dual` / 采补）从此只当**配置**用，
 *    真正的入口与流程都在这里。`arts.listFor` 会把这两条筛掉（不然玩家在两个地方
 *    看到同一件事，而且秘技那条既不判晚上也不判有没有人在旁边）。
 *
 * ⚠️ 文字为什么不重样：每场开一次 `seed`（拿对方的 id + 时辰 + 场次哈希而来），
 *    每一轮按 `seed + round` 从池子里取 —— 同一个人不同场次、同一场不同轮，
 *    取的都不一样。池子写得足够宽，循环一轮之前玩家早就换对象了。
 */
'use strict';

const ROUND_MIN = 25;          // 一轮耗掉的游戏时间
const ROUNDS = 4;              // 一场几轮（每轮一次指令，跟前主人要的「缓慢弹出」）
const COOLDOWN_MIN = 360;      // 短时间只能一次：游戏内 6 小时
const BASE_MP = 6;             // 一次双修涨的内力上限（底子）
const BASE_SKILL = 8;          // 每门已学武学涨的进度
const DRAIN_MP = 10;           // 采补：对方掉的内力上限
const DRAIN_GAIN = 9;          // 采补：你得的内力上限

function stateOf(ch) { return (ch && ch.vars && ch.vars.dual) || null; }
function blocksMove(ch) { return !!stateOf(ch); }

/* ------------------------------------------------------------------ *
 *  一、判定
 * ------------------------------------------------------------------ */

/** 拿个小哈希（挑文本用）。⚠️ 末尾必须 >>> 0，带符号负数取模会取到负下标 */
function hash(s) {
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 15; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13;
  return h >>> 0;
}
const pick = (arr, seed) => arr[hash(seed) % arr.length];

/**
 * 按「第几轮」从池子里取，**保证一场之内不重样**。
 *
 * ⚠️ 不能写成 `pick(MID, seed + 'm' + round)`：那是拿不同的字符串去哈希，
 *    撞车全看运气 —— 实测第 1 轮与第 3 轮就取到了同一句（池子 6 句、4 轮）。
 *    这里改成 `(base + round) % n`：起点由 seed 定（每场不同），
 *    步长 1 保证 4 轮之内索引互不相同（池子够长，走不完一圈）。
 */
function pickAt(arr, seed, round) {
  const n = arr ? arr.length : 0;
  if (!n) return '';
  const base = hash(seed) % n;
  return arr[(base + Math.max(0, round)) % n];
}

function idOf(npc) { return npc && (npc.defId || npc.id); }

/** 你跟他是什么关系：夫妻 / 情人 / 都没有 */
function relationTo(world, p, npc) {
  const id = idOf(npc);
  const m = p.marriage || {};
  if (m.spouse && (m.spouse === id || m.spouse === npc.id)) return 'spouse';
  for (const c of (m.concubines || [])) if (c === id || c === npc.id) return 'concubine';
  for (const l of (p.lovers || [])) {
    if (l && (l.npcId === id || l.npcId === npc.id)) return 'lover';
  }
  return 'none';
}

/** 对方有家世吗 —— 有的话，那位还健在吗 */
function familyOf(world, npc) {
  const def = npc.def || {};
  const sp = npc.spouse || def.spouse;
  if (!sp) return { has: false };
  const spDef = (world.data.npcs || {})[sp];
  const spName = (npc.spouseName) || (spDef && spDef.name) || '家眷';
  /* 配偶还在世上（模板里没标 dead）就算「人在」 */
  const alive = !(spDef && spDef.dead);
  return { has: true, name: spName, alive };
}

/** 性格分组 —— 决定「有人在场时肯不肯」以及口吻 */
const BOLD_PERSONAS = ['haoshuang', 'youhua', 'baozhao'];     // 敢、不在乎、或压根不避人

/**
 * 能不能开始。不能就给一句 `why`（面板上按钮灰掉也要说明白差什么）。
 * @param {'dual'|'drain'} kind
 */
function evaluate(world, p, npc, kind) {
  kind = kind || 'dual';
  if (!p || !npc || npc.isPlayer) return { ok: false, why: '此路不通。' };
  if (stateOf(p)) return { ok: false, why: '你正忙着，脱不开身。' };
  if (npc.dead || npc.knockedOut) return { ok: false, why: `${npc.name}现在人事不省。` };
  if (world.battle) return { ok: false, why: '刀都拔出来了，还谈这个？' };
  if (!(world.npcsIn(p.room) || []).some(n => n === npc || idOf(n) === idOf(npc))) {
    return { ok: false, why: `${npc.name}不在这里。` };
  }
  if (require('./neigong').stateOf(p)) return { ok: false, why: '你正坐着吐纳，气行到一半。' };

  /* 冷却 */
  const cd = (p.vars && p.vars.dualCdUntil) || 0;
  const now = world.clockMinutes || 0;
  if (now < cd) {
    const left = Math.ceil((cd - now) / 60);
    return { ok: false, why: `你才疏通了那一趟气，眼下还虚着（大约还要 ${left} 个时辰）。` };
  }

  const rel = relationTo(world, p, npc);
  const persona = (() => { try { return require('./personality').personaIdOf(npc); } catch (e) { return 'mune'; } })();
  const fam = familyOf(world, npc);
  const favor = Math.round(npc.favor || 0);
  const night = !!(world.isNight && world.isNight());
  const others = (world.npcsIn(p.room) || []).filter(n => n !== npc && idOf(n) !== idOf(npc) && !n.dead && !n.knockedOut);

  /* 采补是**单方面**的，不存在「对方同不同意」，但难度另算 */
  if (kind === 'drain') {
    const used = ((npc.vars || {}).drained) || 0;
    if (used >= 10) return { ok: false, why: `${npc.name}已经被取过 ${used} 次，再取不出什么了。` };
    if (!night) return { ok: false, why: '采补得趁夜。天光底下做这个，太扎眼。' };
    if (others.length) return { ok: false, why: '屋里还有旁人，下不去手。' };
    if (persona === 'xiayi' || persona === 'baozhao') {
      return { ok: false, why: `${npc.name}这种人，你按不住（性子太烈）。` };
    }
    const power = (p.maxMp || 0) + (p.atk || 0) * 3;
    const his = (npc.maxMp || 0) + (npc.atk || 0) * 3;
    if (power < his * 0.9) return { ok: false, why: `${npc.name}的斤两不比你轻，按不住。` };
    return { ok: true, rel, persona, fam, favor, night, others, chance: 0.75 };
  }

  /* ---- 双修：这是**两个人都愿意**的事，判定要细 ---- */
  if (rel === 'none') {
    /* ① 没那层关系 → 先看双方性格合不合得来 */
    let aff = 0;
    try { aff = require('./personality').affinityOf(persona, (() => require('./personality').personaIdOf(p))()).delta || 0; } catch (e) { aff = 0; }
    /* ② 再看家世：有家世且配偶还健在 → 一口回绝（个别性子除外） */
    if (fam.has && fam.alive && npc.spouse !== 'player' && BOLD_PERSONAS.indexOf(persona) < 0) {
      return { ok: false, why: `${npc.name}退了一步：「我有家室，${fam.name}还在。这话别再提。」` };
    }
    const need = 55 - Math.max(0, aff) * 2;      // 相性好的人门槛低一点
    if (favor < need) {
      return { ok: false, why: `${npc.name}没听懂，也没打算听懂（好感 ${favor}/${Math.round(need)}）。` };
    }
  } else if (favor < 20) {
    return { ok: false, why: `${npc.name}与你虽是那种关系，可这些日子冷落了她/他（好感 ${favor}）。` };
  }

  /* 晚上更好说话；白天要看人 */
  if (!night && rel === 'none') {
    return { ok: false, why: `${npc.name}看了看日头：「大白天的，说什么浑话。」` };
  }
  /* 旁边有人：除个别性子，一律不答应 */
  if (others.length) {
    if (BOLD_PERSONAS.indexOf(persona) < 0) {
      return {
        ok: false,
        why: `${npc.name}眼角往旁边那几位一扫，把话岔开了（${others.map(o => o.name).join('、')}在这儿，她/他脸皮没那么厚）。`,
      };
    }
  }
  return { ok: true, rel, persona, fam, favor, night, others, chance: 0.85 };
}

/* ------------------------------------------------------------------ *
 *  二、文本池（不重样的关键）
 * ------------------------------------------------------------------ */

/* 开场：三档——夜里独处 / 屋里有旁人但对方不在乎 / 关系已定 */
const OPEN = {
  lover: [
    '{a}把手里的灯往桌上一搁，火苗晃了一下。她没问你为什么来，只是把窗掩上了半分。',
    '你进门时{a}正坐着发怔。她见是你，把披着的衣裳拢了拢，往旁边挪出半尺地方。',
    '{a}吹熄了灯。黑暗里只听得见两个人的呼吸，一声比一声近。',
  ],
  stranger: [
    '{a}半晌没动，像在算什么。末了伸手把门闩拨上，回身看你。',
    '灯芯爆了个花。{a}把灯挑暗了些，坐下来时离你比方才近了半掌。',
    '{a}不说话，只把茶推到你面前，又给自己倒了一盏——那盏一直没喝。',
  ],
  bold: [
    '{a}笑着看了你一眼，一点避人的意思都没有：「外头那几位爱看便看。」',
    '{a}把椅子拖过来，坐得很近，近得你能闻见她衣上的酒气。',
  ],
};

/* 中段：每一轮一句，四轮不重样 */
const MID = [
  '两个人的气先是各走各的，走到第三转上，忽然撞在了一处。{a}的指尖搭在你腕上，那一处的脉跳得很急。',
  '你把手按在{a}后背，顺着脊骨往下引。她的呼吸随着你的手起落，从急到缓，又从缓到急。',
  '{a}的额头抵着你肩膀，头发散在你颈窝里，有点痒。谁也没说话。',
  '屋里的气闷起来了。{a}解开了外衫的带子，动作很慢，眼睛却一直看着你。',
  '有一阵两个人都停了。窗外的更鼓敲过两声，{a}才轻轻出了一口气，把脸埋回去。',
  '{a}的手按在你心口上量了量，忽然笑了：「你比看着沉得住气。」',
];

const CLIMAX = [
  '气到极处，两个人几乎同时一颤。{a}整个人往你身上靠，指甲掐进你背里。',
  '{a}低低地叫了半声，又咬住嘴唇把它咽了回去。你听见她牙齿在抖。',
  '那口气冲上来的时候，你眼前发白，{a}的手攥得死紧，两个人的脉在同一个点上跳。',
];

const END = [
  '过了很久，{a}才从你身上撑起来，把散了的头发拢到耳后。她没看你，只说：「……水在那边。」',
  '窗外有鸟叫了一声。{a}卷着被角坐起来，半晌才说：「天快亮了。」',
  '{a}先起的身，把衣裳一件件穿回去，动作很稳。末了回头看你一眼，那一眼里没什么话。',
];

/* 有人经过：旁人的反应（按性格）+ 双修对象当场做什么（按关系） */
const WATCHER = {
  xiayi: ['{w}在门口站住，脸一沉，把袖子一甩就走了——那副样子像是要去找人。',
    '{w}咳了一声，声音大得能掀屋瓦：「这个时候了，门也不关？」'],
  baozhao: ['{w}骂了一句极难听的，抬脚把门踹上半边：「丢人现眼的东西！」',
    '{w}把手里东西往地上一摔，转身就走，一路骂到了巷口。'],
  lengmo: ['{w}只淡淡扫了一眼，像看见了两件摆设，绕开走了。',
    '{w}停也没停，脚步都没乱一下。'],
  haoshuang: ['{w}愣了一愣，随即哈哈一笑，把门带上：「你们忙。」',
    '{w}退出去时还替你们把门帘放了下来。'],
  youhua: ['{w}嘻嘻笑了两声，话没说完就被你瞪了回去，缩着脖子溜了。',
    '{w}装作什么都没看见，还顺手把廊下那盏灯掐了。'],
  mune: ['{w}站在门口没动，脸涨得通红，半天才憋出一句「对不住」，转身跑了。',
    '{w}像是被烫了手，猛地退出去，撞在门框上也没吭声。'],
  wenwan: ['{w}轻轻把门带上了，隔着门低低说了句：「我什么都没看见。」',
    '{w}愣在门口，脸红透了，回身就走，脚步碎而急。'],
  qienuo: ['{w}啊了一声，东西掉在地上也没捡，连滚带爬地走了。'],
  yinzhi: ['{w}在暗处站了很久。退开的时候一点声音都没有，比当场撞见还让人不自在。'],
  official: ['{w}把腰刀一按：「成何体统！」却没真进来，只留下话：「明日自去衙门说清楚。」'],
  monk: ['{w}念了声佛，把头转开，退得干干净净。'],
};
const PARTNER_SEEN = {
  lover: ['{a}猛地把你推开，扯过衣裳掩住身子，脸上的血色褪得干净：「你……什么时候站在那儿的？」',
    '{a}僵住了，一动不敢动，直到门外脚步声远了才松下来，随即眼睛就红了。'],
  cold: ['{a}没慌，只把衣裳慢慢理好，冷冷看那人一眼：「看够了？」',
    '{a}起身，把灯点上——满室光亮的，反倒像什么事都没有。'],
};

/* 采补：另写一套，味道完全不同 */
const DRAIN_OPEN = [
  '{a}今夜睡得沉。你在床沿坐下，先替他把被角掖了掖。',
  '{a}喝多了，靠在榻上哼了两声就不动了。你把灯挪远了些。',
];
const DRAIN_MID = [
  '你的手按在他腕上，气顺着经脉过去，有一层温热的、像丝一样的东西被你一点点引出来。{a}在睡梦里皱了皱眉。',
  '那一股气很稠。你引得很慢，慢到能觉出它在他身上曾经是怎样的底子。{a}的呼吸短了半拍。',
  '取到第三转，{a}忽然攥了一下被角，嘴里含糊地念了个名字。你停了停，又续上了。',
];
const DRAIN_END = [
  '收手的时候，{a}翻了个身，脸朝着墙，睡得更沉了。桌上那盏灯，油少了浅浅一层。',
  '你把他的手腕放回去，替他搭好被子。屋里的气静下来，只剩他比方才粗了些的呼吸。',
];

/* ------------------------------------------------------------------ *
 *  中途退出：人家那口气，你得自己受着
 *
 *  主人 2026-10-11：「中途退出双修状态的显示，以及伴侣对你这种行为的幽怨
 *  态度语言神态动作等描写」。所以这一池子专写「被撂下的人」——
 *  按关系分两档取（已定的情人/夫妻 / 刚搭上的），跟正文一样用 `seed + 轮次`
 *  取模步进，谁在哪一轮抽身，听到的话都不一样。
 * ------------------------------------------------------------------ */
const QUIT_LOVER = [
  '你刚一起身，{a}扣衣裳的手就停住了。「这就走？」她声音平平的，听着比骂你还难受。',
  '{a}把被子往身上紧了紧，背过身去，半晌只丢下两个字：「随你。」',
  '{a}看了你很久，忽然笑了一下，那笑没到眼睛里：「我当你今晚是不走的。」',
  '你走到门边，身后才轻轻传来一句：「……把门带上。」',
  '{a}伸手要去够灯，够了两下没够着，索性收回手，脸朝着墙不吭声了。',
  '{a}追到门口又停住，到底没再说什么，只把你衣袖捻了又捻，才松开。',
];
const QUIT_STRANGER = [
  '{a}怔了一下，随即把衣裳理好，淡淡道：「是我会错意了。」',
  '{a}坐着没动。等你走到门口，才开口：「往后这种事，别来找我。」',
  '{a}把茶盏往桌上一搁，声音不轻不重：「要走，趁早。」',
  '{a}替你拉开了门。那一下拉得很重，门轴吱呀了一声。',
  '{a}什么也没说，低头去理自己的袖口，理了很久。',
];
const QUIT_DRAIN = [
  '你把手收了回来。那口气走到一半，堵在原处，慢慢散了。',
  '你停了手。{a}翻了个身，睡得正沉，什么都不知道。',
  '你收回手，替他把被子掖好。屋里静下来，像什么都没发生过。',
];

/* ------------------------------------------------------------------ *
 *  三、流程
 * ------------------------------------------------------------------ */

function personaOf(npc) {
  try { return require('./personality').personaIdOf(npc); } catch (e) { return 'mune'; }
}

/** 开场 */
function start(world, p, npc, kind) {
  kind = kind || 'dual';
  const ev = evaluate(world, p, npc, kind);
  if (!ev.ok) return { ok: false, lines: [{ kind: 'warn', text: ev.why }] };
  if (ev.chance && world.rng.next() > ev.chance) {
    return {
      ok: false,
      lines: [
        { kind: 'plain', text: `${npc.name}把脸别开了。这一次，人家没应。` },
        { kind: 'hint', text: '（换个时候再来 —— 夜里、没人的地方，人的心会软一些。）' },
      ],
    };
  }

  const a = npc.name;
  const seed = hash(idOf(npc) + '|' + (world.clockMinutes || 0) + '|' + kind
    + '|' + ((p.vars.dualSeq = (p.vars.dualSeq || 0) + 1)));
  const st = {
    kind, target: idOf(npc), name: a, round: 0, rounds: ROUNDS, seed,
    spoiled: false,
    /* ⚠️ 起手时屋里**已经有的人**先记进 seen —— 只算「中途有人经过」。
       不记的话，本来就在屋里看热闹的那几位会当成刚进门，
       第一轮就被判「撞见」，玩家连一次干净的双修都做不成（第一版就吃了这个亏）。 */
    seen: (world.npcsIn(p.room) || []).map(idOf),
    rel: ev.rel, persona: ev.persona,
  };
  p.vars.dual = st;

  const pool = kind === 'drain' ? DRAIN_OPEN
    : (ev.rel !== 'none' ? OPEN.lover : (BOLD_PERSONAS.indexOf(ev.persona) >= 0 ? OPEN.bold : OPEN.stranger));
  const lines = [{ kind: 'story', text: pick(pool, seed).replace(/\{a\}/g, a) }];
  if (ev.others && ev.others.length) {
    lines.push({
      kind: 'plain',
      text: `（${ev.others.map(o => o.name).join('、')}还在屋里 —— ${a}压根没打算避人。）`,
    });
  }
  lines.push({
    kind: 'hint',
    text: kind === 'drain'
      ? '（此刻起你脱不开身。再点一次「采补」接着往下引；不想继续，点屏幕上随便哪个别的按钮。）'
      : '（此刻起你脱不开身。再点一次「双修」接着往下走；不想继续，点屏幕上随便哪个别的按钮。）',
  });
  return { ok: true, lines };
}

/** 推一轮。返回 {ok, done, lines} */
function round(world, p, opts) {
  const st = stateOf(p);
  if (!st) return { ok: false, lines: [{ kind: 'warn', text: '你还没起手。' }] };
  const npc = (world.npcsIn(p.room) || []).find(n => idOf(n) === st.target)
    || world.getNpc && world.getNpc(st.target);
  if (!npc || npc.dead) {
    delete p.vars.dual;
    return { ok: false, lines: [{ kind: 'warn', text: '人不在了。这一场没成。' }] };
  }
  st.round++;
  world.advanceTime && world.advanceTime(ROUND_MIN);

  const out = [];
  const a = st.name;

  /* ---- 中途有人进来（主人要的那一条）---- */
  const here = (world.npcsIn(p.room) || []).filter(n => idOf(n) !== st.target && !n.dead && !n.knockedOut);
  const fresh = here.filter(n => st.seen.indexOf(idOf(n)) < 0);
  for (const w of fresh) {
    st.seen.push(idOf(w));
    if (!st.spoiled) {
      st.spoiled = true;
      /* 双修对象好感小幅下降 */
      try { require('./social').addFavor(world, npc, -6, '被人撞见'); } catch (e) { /* ignore */ }
    }
    const wp = personaOf(w);
    const wpool = WATCHER[wp] || WATCHER[wp === 'official' ? 'official' : 'lengmo'] || WATCHER.lengmo;
    out.push({ kind: 'story', text: pick(wpool, st.seed + st.round + idOf(w)).replace(/\{w\}/g, w.name) });
    const ppool = st.rel !== 'none' ? PARTNER_SEEN.lover : PARTNER_SEEN.cold;
    out.push({ kind: 'story', text: pick(ppool, st.seed + st.round + 'p').replace(/\{a\}/g, a) });
    out.push({ kind: 'warn', text: '（这一场被搅了。收效要大打折扣。）' });
  }

  /* ---- 正文一句 ---- */
  const isDrain = st.kind === 'drain';
  const body = (st.round >= st.rounds
    ? pickAt(isDrain ? DRAIN_END : CLIMAX, st.seed, st.round)
    : pickAt(isDrain ? DRAIN_MID : MID, st.seed, st.round)).replace(/\{a\}/g, a);
  out.push({ kind: 'story', text: body });

  if (st.round < st.rounds) {
    const more = isDrain ? '（再点一次「采补」。）' : '（再点一次「双修」。）';
    out.push({ kind: 'plain', text: `（第 ${st.round}/${st.rounds} 转。${more}想走开也行，点屏幕上别的按钮。）` });
    return { ok: true, done: false, lines: out };
  }

  /* ---- 收尾：结账 ---- */
  /* 事后那一句（各写各的：双修是两个人的余温，采补是一个人的收拾） */
  out.push({
    kind: 'plain',
    text: pickAt(isDrain ? DRAIN_END : END, st.seed, st.round).replace(/\{a\}/g, a),
  });
  const res = settle(world, p, npc, st);
  delete p.vars.dual;
  p.vars.dualCdUntil = (world.clockMinutes || 0) + COOLDOWN_MIN;
  out.push(...res);
  return { ok: true, done: true, lines: out };
}

/** 结算：好感 / 武学进度 / 内力上限 */
function settle(world, p, npc, st) {
  const lines = [];
  const full = st.spoiled ? 0.35 : 1;          // 被撞见 → 大打折扣
  const persona = st.persona;
  let scale = full;
  /* 「有双修类功法」提升更大：内功槽挂着合欢一脉的功夫，或者秘技里那两门在身 */
  const ng = p.equippedSkills && p.equippedSkills['内功'];
  const dualArts = ['hehuan_force_2', 'hehuan_force_3'];
  const hasDualArt = (ng && dualArts.indexOf(ng) >= 0)
    || dualArts.some(s => p.learned && p.learned[s]);
  if (hasDualArt) scale *= 1.8;

  const mpGain = Math.max(1, Math.round(BASE_MP * scale));
  const skillGain = Math.max(1, Math.round(BASE_SKILL * scale));

  p.maxMpBase = (p.maxMpBase || 50) + mpGain;

  /* 各门武学都往前走一点（「直接小幅提升武学各武学进度」） */
  const touched = [];
  for (const sid of Object.keys(p.learned || {})) {
    const sd = world.getSkill && world.getSkill(sid);
    if (!sd) continue;
    const lv = (p.learned[sid].level) || 0;
    const cap = (typeof p.maxSkillLevelFor === 'function') ? p.maxSkillLevelFor(sid) : 1000;
    if (lv >= cap) continue;
    p.learned[sid].level = Math.min(cap, lv + skillGain);
    touched.push(sd.name);
  }

  if (st.kind === 'drain') {
    /* 采补：对方掉内力上限，你一涨一得，人品也往下走 */
    npc.maxMpBase = Math.max(10, (npc.maxMpBase || 50) - DRAIN_MP);
    if (typeof npc.recalc === 'function') npc.recalc();
    npc.vars = npc.vars || {};
    npc.vars.drained = (npc.vars.drained || 0) + 1;
    p.maxMpBase += (DRAIN_GAIN - mpGain);       // 采补另算一笔
    p.karma = (p.karma || 0) - 6;
    if (typeof p.recalc === 'function') p.recalc();
    lines.push({
      kind: 'sys',
      text: `一夜下来，你的内力上限 +${DRAIN_GAIN}；${npc.name}的内力上限 −${DRAIN_MP}。`,
    });
    lines.push({ kind: 'warn', text: `（这种事做多了，是会被记住的。恶名 ${Math.round((p.kidnap && p.kidnap.wanted) || 0)}。）` });
    try {
      const rf = require('./rumorfeed');
      rf.note(world, 'rs_secret_out', { vars: { where: (world.getRoom(p.room) || {}).name || '此处' } });
    } catch (e) { /* ignore */ }
    return lines;
  }

  /* 双修：两边都好，好感大加 */
  const fr = (() => {
    try { return require('./social').addFavor(world, npc, Math.round(12 * full), '双修'); } catch (e) { return { lines: [] }; }
  })();
  if (typeof p.recalc === 'function') p.recalc();
  lines.push({ kind: 'sys', text: `你的内力上限 +${mpGain}${touched.length ? `，${touched.slice(0, 4).join('、')}${touched.length > 4 ? ' 等' : ''} 各进益 ${skillGain}` : ''}。` });
  if (hasDualArt) lines.push({ kind: 'hint', text: '（你身上这门功夫，本就为这个而设 —— 一趟顶得上一段日子的苦功。）' });
  lines.push(...((fr && fr.lines) || []));
  if (st.spoiled) {
    lines.push({ kind: 'warn', text: `${npc.name}整了整衣裳，半天没看你：「……下回别在有人的地方。」` });
  } else if (st.rel === 'none') {
    lines.push({ kind: 'hint', text: `（${npc.name}待你，比先前近了一层。）` });
  }
  /* 双修不是恶事，但传出去也不好听 */
  try {
    const rf = require('./rumorfeed');
    rf.note(world, 'rs_secret_out', { vars: { where: (world.getRoom(p.room) || {}).name || '此处' } });
  } catch (e) { /* ignore */ }
  return lines;
}

/**
 * 中途退出双修 / 采补（不结账，白走一趟）。
 *
 * 主人 2026-10-11：「双修最好也改成这样（点页面任意其他按钮自动退出）」，
 * 于是这条路也是两个入口：① 过程里点屏幕上任何别的按钮（`engine.exec` 自动调这里）；
 * ② 手敲「收功 / 散功 / 起身」。
 * 屏幕上必须写清「已退出双修状态」，并给出**被撂下那个人的反应**（见 QUIT_* 池）。
 */
function stop(world, p) {
  const st = stateOf(p);
  if (!st) return { ok: false, lines: [{ kind: 'warn', text: '你并没有在做什么。' }] };
  const a = st.name;
  const isDrain = st.kind === 'drain';
  const round = st.round || 0;
  /* 先清状态：退出后这一条的收尾（好感、冷却）不该再受「还在状态里」影响 */
  delete p.vars.dual;
  /* ⚠️ 冷却只按三分之一算 —— 走了一半才停下，跟「做完一场」不是一回事，
     但现在也不能立刻再来（拿全冷却会显得莫名其妙）。 */
  p.vars.dualCdUntil = (world.clockMinutes || 0) + Math.round(COOLDOWN_MIN / 3);

  const pool = isDrain ? QUIT_DRAIN
    : (st.rel !== 'none' ? QUIT_LOVER : QUIT_STRANGER);
  const lines = [
    { kind: 'story', text: pickAt(pool, st.seed, round).replace(/\{a\}/g, a) },
    {
      kind: 'sys',
      text: `已退出${isDrain ? '采补' : '双修'}状态${round ? `（走到第 ${round}/${st.rounds} 转）` : ''} —— 这一趟没走完，白费了。`,
    },
  ];
  /* 双修半道抽身，被撂下的人是会记着的（采补对方全程不知情，不算这一笔） */
  if (!isDrain && st.rel !== 'none') {
    try {
      const npc = (world.npcsIn(p.room) || []).find(n => idOf(n) === st.target)
        || (world.findLiveNpc && world.findLiveNpc(st.target));
      if (npc) require('./social').addFavor(world, npc, -4, '中途撂下人家');
    } catch (e) { /* 记不上账不该挡着退出 */ }
  }
  return { ok: true, lines };
}

module.exports = {
  evaluate, start, round, stop, blocksMove, stateOf, relationTo, familyOf,
  ROUNDS, ROUND_MIN, COOLDOWN_MIN,
};
