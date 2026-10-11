/**
 * culture.js — 文化项目：科举 / 勾栏听曲 / 青楼诗会 / 比武招亲
 *
 * 设计要点：
 *  · **文采**（`ch.vars.wencai`）是这一整套的核心资源：温书攒、听曲涨、诗会奖、科举考它。
 *    缺省值由悟性推（悟性/2），所以读书人出身的角色天然占优。
 *  · 所有「什么时候能再来一次」都按**游戏日**算（`vars.*Cd` 存上次的时间戳），
 *    不用真实时间 —— 玩家的时间感来自游戏里的日升月落。
 *  · 状态挂在 `world.cultureState`（诗会当期题目、招亲赛程）与 `ch.vars`（个人进度）两边：
 *    诗会的题目是**全场同一道**（大家对着同一句出下联），个人进度才进 vars。
 */
'use strict';

const DAY = 1440;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function cfg(world) { return world.data.culture || {}; }
function dayOf(world) { return Math.floor((world.clockMinutes || 0) / DAY) + 1; }

/* ---------------- 文采 ---------------- */

function wencaiOf(ch) {
  if (typeof ch.vars.wencai === 'number') return ch.vars.wencai;
  return Math.floor((ch.attrTotal('悟性') || 10) / 2);
}
function addWencai(ch, n) {
  ch.vars.wencai = clamp(wencaiOf(ch) + n, 0, 999);
  return ch.vars.wencai;
}

/** 温书：花时间与一点束脩，换文采。次数不限，但有冷却（同一时辰只读一次）。 */
function study(world, ch) {
  const c = cfg(world).exam || {};
  const now = world.clockMinutes || 0;
  /* 冷却窗口要比「读一次花的时间」长，否则前脚读完（时间已推进 60 分）
     后脚就能再读，冷却形同虚设 —— 差正好等于窗口，`< window` 恒 false。 */
  if (ch.vars.studyAt && (now - ch.vars.studyAt) < ((c.studyMinutes || 60) + 60)) {
    return { ok: false, lines: [{ kind: 'warn', text: '你刚合上书，眼睛还发花，歇一会儿再读。' }] };
  }
  const cost = c.studyCost || 20;
  if ((ch.money || 0) < cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `买纸买墨也要 ${cost} 文，你身上不够。` }] };
  }
  ch.money -= cost;
  ch.vars.studyAt = now;
  const g = c.studyGain || [1, 3];
  const gain = g[0] + Math.floor(world.rng.next() * (g[1] - g[0] + 1));
  addWencai(ch, gain);
  world.advanceTime && world.advanceTime(c.studyMinutes || 60);
  return {
    ok: true,
    lines: [
      { kind: 'plain', text: '你寻了处僻静地方，把书摊开。读到一半有人来赶，说是这儿不许摆摊。你换了个地方接着读。' },
      { kind: 'sys', text: `文采 +${gain}（现 ${wencaiOf(ch)}）。` },
    ],
  };
}

/* ---------------- 科举 ---------------- */

function examState(world, ch) {
  const c = cfg(world).exam || {};
  const lv = c.levels || [];
  /* 「下一场」= 第一个**还没通过**的场次 —— 判据是本场的 `prize.flag`，不是 `need.flag`。
     🩸 曾经拿 `need.flag` 判，结果是：过了乡试的人被算成「会试已通过」（因为会试的
        need 正是 keju_xiangshi），于是一路跳到殿试、还说会试考过了。 */
  let next = null;
  for (const L of lv) {
    const passed = !(L.prize && L.prize.flag) || ch.hasFlag(L.prize.flag);
    if (!passed) { next = L; break; }
  }
  return { levels: lv, next, done: !next, wencai: wencaiOf(ch) };
}

/** 这一场能不能考 */
function canTakeExam(world, ch, lv) {
  if (!lv) return { ok: false, msg: '科考这条路你已经走完了。' };
  const c = cfg(world).exam || {};
  const cd = c.cooldownDays || 30;
  if (ch.vars.examAt && (dayOf(world) - ch.vars.examAt) < cd) {
    return { ok: false, msg: `上一场才考完，再等 ${cd - (dayOf(world) - ch.vars.examAt)} 日开考。` };
  }
  const need = lv.need || {};
  if (need.flag && !ch.hasFlag(need.flag)) return { ok: false, msg: `${lv.name}须先取得前一场功名。` };
  if (need.wencai && wencaiOf(ch) < need.wencai) {
    return { ok: false, msg: `${lv.name}这一场，你自觉笔头还差些火候（文采 ${wencaiOf(ch)}/${need.wencai}）。先去「温书」。` };
  }
  if (need.attr) {
    const { evalCond } = require('./modapi');
    if (!evalCond({ attr: need.attr, '>=': need['>='] }, { player: ch, world })) {
      return { ok: false, msg: `${lv.name}的卷子要动脑子，你的${need.attr}还跟不上。` };
    }
  }
  if ((ch.money || 0) < (lv.fee || 0)) return { ok: false, msg: `报名要交 ${lv.fee} 文，你身上不够。` };
  return { ok: true };
}

function takeExam(world, ch, levelId) {
  const st = examState(world, ch);
  const lv = levelId ? (st.levels || []).find(L => L.id === levelId || L.title === levelId) : st.next;
  if (!lv) return { ok: false, lines: [{ kind: 'warn', text: '眼下没有你能考的场次。' }] };
  const chk = canTakeExam(world, ch, lv);
  if (!chk.ok) return { ok: false, lines: [{ kind: 'warn', text: chk.msg }] };
  ch.money -= (lv.fee || 0);
  ch.vars.examAt = dayOf(world);
  world.advanceTime && world.advanceTime(240);
  const wc = wencaiOf(ch);
  const over = wc - (lv.need.wencai || 0);
  const chance = clamp(0.35 + over * 0.02, 0.12, 0.92);
  const win = world.rng.next() < chance;
  const lines = [
    { kind: 'title', text: `【${lv.name}】` },
    { kind: 'plain', text: lv.openLine || '' },
  ];
  const pr = lv.prize || {};
  if (win) {
    lines.push({ kind: 'story', text: lv.passLine || '' });
    if (pr.money) { ch.money += pr.money; lines.push({ kind: 'sys', text: `得赏钱 ${pr.money} 文。` }); }
    if (pr.rep) { ch.reputation['*'] = (ch.reputation['*'] || 0) + pr.rep; lines.push({ kind: 'sys', text: `名声 +${pr.rep}。` }); }
    if (pr.flag) ch.setFlag(pr.flag, true);
    ch.vars.gongming = lv.title;
    if (!ch.titles.includes(lv.title)) ch.titles.push(lv.title);
    lines.push({ kind: 'sys', text: `你成了${lv.title}。` });
    /* 殿试头三名额外给个彩头 */
    if (lv.id === 'dianshi') {
      /* 一次掷骰决定名次 —— 别写成嵌套三元（每层都再摇一次，概率会串味） */
      const r = world.rng.next();
      const rank = r < 0.15 ? 1 : r < 0.4 ? 2 : r < 0.7 ? 3 : 0;
      const rt = (cfg(world).exam.rankTitles || {})[String(rank)];
      if (rt) {
        if (!ch.titles.includes(rt)) ch.titles.push(rt);
        addWencai(ch, 5);
        lines.push({ kind: 'sys', text: `一甲——你是今科的${rt}。` });
      }
    }
    ch.vars.examCd = dayOf(world);
    return { ok: true, lines, win: true };
  }
  lines.push({ kind: 'story', text: lv.failLine || '' });
  lines.push({ kind: 'hint', text: '（回去「温书」攒文采，下一场再来。）' });
  return { ok: true, lines, win: false };
}

/* ---------------- 勾栏听曲 ---------------- */

function songList(world) { return cfg(world).songs || []; }

function listenSong(world, ch, keyword) {
  const list = songList(world);
  if (!list.length) return { ok: false, lines: [{ kind: 'warn', text: '台上没人唱曲。' }] };
  let song = null;
  if (keyword) {
    song = list.find(s => s.id === keyword || s.name === keyword || s.name.indexOf(keyword) >= 0);
    if (!song) return { ok: false, lines: [{ kind: 'warn', text: `曲牌里没有「${keyword}」。` }] };
  } else {
    song = list[Math.floor(world.rng.next() * list.length)];
  }
  if ((ch.money || 0) < song.price) {
    return { ok: false, lines: [{ kind: 'warn', text: `点一支「${song.name}」要 ${song.price} 文，你身上不够。` }] };
  }
  ch.money -= song.price;
  ch.mood = clamp((ch.mood || 50) + (song.mood || 0), 0, 100);
  if (song.wencai) addWencai(ch, song.wencai);
  const lines = [
    { kind: 'title', text: `【勾栏听曲 · ${song.name}】` },
    { kind: 'plain', text: song.desc || '' },
    { kind: 'sys', text: `花去 ${song.price} 文。心情 +${song.mood || 0}${song.wencai ? `，文采 +${song.wencai}` : ''}。` },
  ];
  /* 台上的歌姬记你一份人情（同房间第一个 NPC） */
  const singer = (world.npcsIn ? world.npcsIn(ch.room) : []).find(n => !n.isPlayer && !n.dead);
  if (singer && song.favor) {
    singer.favor = (singer.favor || 0) + song.favor;
    lines.push({ kind: 'say', text: `${singer.name}曲罢起身，朝你这桌微微颔首。` });
  }
  return { ok: true, lines, song: song.id };
}

/* ---------------- 青楼诗会 ---------------- */

function poemSession(world) {
  const c = cfg(world);
  const iv = (c.poemMeet && c.poemMeet.intervalDays) || 15;
  const s = Math.floor((dayOf(world) - 1) / iv);
  let st = world.cultureState;
  if (!st || st.poemSession !== s) {
    const poems = c.poems || [];
    const pick = poems.length ? poems[Math.floor(world.rng.next() * poems.length)] : null;
    st = world.cultureState = Object.assign({}, st || {}, { poemSession: s, poem: pick, poemAnswers: {} });
  }
  return st;
}

/** 出题：把当前的上句摆出来（选项编号固定 1..N） */
function poemAsk(world, ch) {
  const st = poemSession(world);
  if (!st.poem) return { ok: false, lines: [{ kind: 'warn', text: '今日席上无人出题。' }] };
  const c = cfg(world);
  const cd = ((c.poemMeet || {}).intervalDays) || 15;
  if (ch.vars.poemAt && (dayOf(world) - ch.vars.poemAt) < cd) {
    return { ok: false, lines: [{ kind: 'warn', text: `这一场你已经对过了。${cd - (dayOf(world) - ch.vars.poemAt)} 日后再开席。` }] };
  }
  const lines = [
    { kind: 'title', text: '【青楼诗会】' },
    { kind: 'plain', text: '花厅里摆了七八张案，几位穿绸的客人正说笑。花魁在屏风前站着，手里一柄团扇。' },
    { kind: 'say', text: `「${st.poem.upper}——」她念了上句，把扇子一收，「诸位接一句。」` },
  ];
  st.poem.options.forEach((o, i) => lines.push({ kind: 'plain', text: `　${i + 1}. ${o}` }));
  const wc = wencaiOf(ch);
  if (wc >= (((c.poemMeet || {}).hintWencai) || 50)) {
    lines.push({ kind: 'hint', text: `（你读过这一句。${st.poem.hint || ''}）` });
  }
  lines.push({ kind: 'hint', text: '用「对句 <序号>」答。' });
  return { ok: true, lines };
}

function poemAnswer(world, ch, idx) {
  const st = poemSession(world);
  if (!st.poem) return { ok: false, lines: [{ kind: 'warn', text: '今日席上无人出题。' }] };
  const n = parseInt(idx, 10);
  if (!(n >= 1 && n <= st.poem.options.length)) {
    return { ok: false, lines: [{ kind: 'warn', text: '报个卷上的号。' }] };
  }
  const c = cfg(world);
  const cd = ((c.poemMeet || {}).intervalDays) || 15;
  if (ch.vars.poemAt && (dayOf(world) - ch.vars.poemAt) < cd) {
    return { ok: false, lines: [{ kind: 'warn', text: '这一场你已经对过了。' }] };
  }
  ch.vars.poemAt = dayOf(world);
  const right = (n - 1) === st.poem.answer;
  const rw = (c.poemMeet && c.poemMeet.reward) || {};
  const lines = [];
  if (right) {
    lines.push({ kind: 'say', text: '花魁挑了下眉：「接得住。」席上有人叫好，也有人明显不痛快。' });
    if (rw.money) { ch.money += rw.money; lines.push({ kind: 'sys', text: `席上赏了 ${rw.money} 文。` }); }
    if (rw.wencai) { addWencai(ch, rw.wencai); lines.push({ kind: 'sys', text: `文采 +${rw.wencai}。` }); }
    if (rw.favor) {
      const lady = (world.npcsIn ? world.npcsIn(ch.room) : []).find(x => !x.isPlayer && !x.dead);
      if (lady) { lady.favor = (lady.favor || 0) + rw.favor; lines.push({ kind: 'sys', text: `${lady.name}看你的眼神不同了些。` }); }
    }
    ch.reputation['*'] = (ch.reputation['*'] || 0) + 3;
  } else {
    lines.push({ kind: 'plain', text: '你答得慢了半拍，旁边一位客人已经先开了口，字字都在调上。' });
    const ff = (c.poemMeet && c.poemMeet.failFavor) || -2;
    const lady = (world.npcsIn ? world.npcsIn(ch.room) : []).find(x => !x.isPlayer && !x.dead);
    if (lady) lady.favor = (lady.favor || 0) + ff;
    lines.push({ kind: 'sys', text: '席上笑了一阵，没人为难你，可你脸上挂不住。' });
  }
  return { ok: true, lines, right };
}

/* ---------------- 比武招亲 ---------------- */

function meetState(world, ch) {
  const c = cfg(world).marriageMeet || {};
  const t = ch.vars.marryMeet;
  return { cfg: c, t };
}

function startMarriageMeet(world, ch) {
  const c = cfg(world).marriageMeet || {};
  const t0 = ch.vars.marryMeet;
  if (t0 && t0.oppId) {
    const prev = world.getNpc(t0.oppId);
    const won = prev && (prev.dead || prev.knockedOut || prev.hp <= 0);
    if (!won) return { ok: false, lines: [{ kind: 'warn', text: '台上那一位还没下去呢。' }] };
    t0.wins = (t0.wins || 0) + 1; t0.round = (t0.round || 1) + 1; t0.oppId = null;
  } else if (!t0) {
    if (((ch.reputation['*'] || 0)) < (c.minRep || 20)) {
      return { ok: false, lines: [{ kind: 'warn', text: `擂台下设了彩棚，管事打量你两眼：「这位……还是先去闯出点名头再来罢。」（名声 ${ch.reputation['*'] || 0}/${c.minRep || 20}）` }] };
    }
    ch.vars.marryMeet = { round: 1, wins: 0, oppId: null };
  }
  const tt = ch.vars.marryMeet;
  const total = c.rounds || 3;
  if (tt.round > total) {
    const pr = c.prize || {};
    if (pr.money) ch.money += pr.money;
    if (pr.rep) ch.reputation['*'] = (ch.reputation['*'] || 0) + pr.rep;
    ch.vars.marryMeetDone = true;
    ch.setFlag('marry_meet_won', true);
    ch.vars.marryMeet = null;
    return {
      ok: true,
      lines: [
        { kind: 'title', text: '【比武招亲 · 落幕】' },
        { kind: 'story', text: '你从台上下来，管事抢上前递了盏茶。彩棚的帘子掀开一角，里头有人看了你一眼，又放下了。' },
        { kind: 'sys', text: `${tt.wins} 胜。聘礼彩头 ${pr.money || 0} 文，名声 +${pr.rep || 0}。` },
        { kind: 'hint', text: '（若要提亲，须亲自寻到那户人家去说。）' },
      ],
    };
  }
  const pool = tt.round === 1 ? ['mob_bandit'] : tt.round === 2 ? ['npcv_134'] : ['tiezhang_master'];
  const nid = pool.find(x => world.data.npcs[x]);
  if (!nid) return { ok: false, lines: [{ kind: 'warn', text: '擂台上的好手今日没来，改日再试。' }] };
  const foe = world.spawnNpc(nid, ch.room, 1, true);
  foe.name = tt.round === 1 ? '擂台的护院' : tt.round === 2 ? '来应试的武师' : `${foe.name}`;
  tt.oppId = foe.id;
  const dr = world.startDuel(ch, foe);
  return {
    ok: true,
    lines: [
      { kind: 'title', text: `【比武招亲 · 第 ${tt.round} 轮 / 共 ${total} 轮】` },
      { kind: 'plain', text: '台下黑压压一片人。擂台的木板被踩得咯吱响，红绸在风里飘。' },
    ].concat(dr.lines || []),
  };
}

/* ---------------- 给前端/别的模块看的一眼总览 ---------------- */

function summary(world, ch) {
  if (!ch) return null;
  const st = examState(world, ch);
  return {
    wencai: st.wencai,
    gongming: ch.vars.gongming || null,
    titles: ch.titles || [],
    nextExam: st.next ? { id: st.next.id, name: st.next.name, title: st.next.title, need: st.next.need } : null,
    examDone: st.done,
    songs: songList(world).length,
  };
}

module.exports = {
  cfg, wencaiOf, addWencai, study,
  examState, canTakeExam, takeExam,
  songList, listenSong,
  poemSession, poemAsk, poemAnswer,
  startMarriageMeet,
  summary, dayOf,
};
