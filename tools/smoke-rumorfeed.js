/* 传闻的消费端（自拟 🅔）：玩家做的事 → 被传出去 → 回头讲到玩家脸上
 *
 * 断言的**全是玩家真看得见的那句话**，不是内部变量：
 *   · 「风声」指令念出来的原话
 *   · 走进屋听见的那句闲话
 *   · NPC 当面引用的那句传闻
 * 跑法：node tools/smoke-rumorfeed.js
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const rf = require(path.join(ROOT, 'game/src/core/rumorfeed.js'));
const mem = require(path.join(ROOT, 'game/src/core/npcMemory.js'));
const SL = require(path.join(ROOT, 'game/src/core/sectlife.js'));
const CS = require(path.join(ROOT, 'game/src/core/customskill.js'));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  ' + extra : '')); }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

(async () => {
  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});
  e.newGame({ name: '魏某' });
  const w = e.world, p = w.player;

  /* ================= 一、数据：新种子必须和旧种子共存 ================= */
  section('1 传闻种子（新加的不能把旧的顶掉）');
  const seeds = w.data.rumorSeeds || {};
  ok('旧种子还在（rs_kill_named）', !!seeds.rs_kill_named, Object.keys(seeds).length + ' 个种子');
  ok('旧种子全在（≥20）', Object.keys(seeds).length >= 24, Object.keys(seeds).length + ' 个');
  const NEW = ['rs_master_take', 'rs_sect_promote', 'rs_skill_fuse', 'rs_take_disciple'];
  ok('四个新种子都进了 world.data', NEW.every(k => !!seeds[k]), NEW.filter(k => !seeds[k]).join(',') || '全在');
  ok('新种子三档说法齐（true/half/false）',
    NEW.every(k => seeds[k].texts && seeds[k].texts.true && seeds[k].texts.half && seeds[k].texts.false));

  /* ================= 二、note() 统一接线 ================= */
  section('2 note()：把手上的事传出去');
  const withNpc = (w.npcsIn(p.room) || []).length > 0;
  ok('起局房间里有人（目击者）', withNpc, (w.npcsIn(p.room) || []).length + ' 人');
  const r1 = rf.note(w, 'rs_master_take', { vars: { whom: '令狐冲' } });
  ok('★ 有人看见 → 传闻真的生成了', !!r1 && r1.seedId === 'rs_master_take');
  ok('传闻记在玩家头上', r1 && (r1.subject || 'player') === 'player', r1 && r1.subject);
  ok('{who} 填的是玩家名', r1 && r1.vars.who === '魏某', r1 && r1.vars.who);
  ok('{where} 填的是当前地点名', r1 && r1.vars.where === (w.getRoom(p.room) || {}).name,
    r1 && r1.vars.where);
  ok('{whom} 由调用方给', r1 && r1.vars.whom === '令狐冲', r1 && r1.vars.whom);
  ok('★ 同一天同一桩事只传一回（防刷屏）',
    rf.note(w, 'rs_master_take', { vars: { whom: '令狐冲' } }) === null);
  ok('换一桩事照传不误', !!rf.note(w, 'rs_skill_fuse', { vars: { whom: '两仪剑' } }));
  ok('不存在的种子 → null（不假装传了）', rf.note(w, 'rs_no_such_seed', {}) === null);

  /* 无目击者 → 不产生（沿用 addRumor 的「没人看见就没传闻」） */
  const emptyRoom = Object.keys(w.data.rooms).find(id =>
    id !== p.room && (w.data.rooms[id].npcs || []).length === 0
    && w.data.rooms[id].region === w.data.rooms[p.room].region);
  if (emptyRoom) {
    p.vars.rumorNote = {};   /* 清冷却，单独验「没人看见」这一条 */
    const before = w.rumors.length;
    const r0 = rf.note(w, 'rs_take_disciple', { room: emptyRoom, vars: { whom: '某人' } });
    ok('★ 空屋子没人看见 → 不留传闻', r0 === null && w.rumors.length === before,
      '房间 ' + emptyRoom);
  } else {
    ok('空屋子没人看见 → 不留传闻', false, '没找到空房间，本条没验到');
  }

  /* ================= 三、whatTheySay：风波的账单 ================= */
  section('3 whatTheySay()：别人怎么说你');
  const say = rf.whatTheySay(w, 5);
  ok('拿得到条目', say.length >= 2, say.length + ' 条');
  ok('★ 原话里没有没替换掉的占位符', say.every(x => !/[{}]/.test(x.text)),
    JSON.stringify(say.map(x => x.text)));
  ok('★ 原话里出现玩家名（是「关于你」的）', say.every(x => x.text.includes('魏某')));
  ok('带流传地区', say.every(x => Array.isArray(x.regions)));
  ok('按影响降序', say.every((x, i) => i === 0 || rf.score(rf.aboutPlayer(w)[i - 1]) >= rf.score(rf.aboutPlayer(w)[i])));

  /* ================= 四、chatterIn：走进屋，听见有人在说你 ================= */
  section('4 chatterIn()：进屋时的闲话');
  const roomId = Object.keys(w.data.rooms).find(id => (w.npcsIn(id) || []).some(n => !n.dead));
  p.vars.rumorChatter = undefined;
  const chat = rf.chatterIn(w, w.getRoom(roomId));
  ok('★ 有人的屋子 + 事传到这儿了 → 有一句闲话', !!chat && !!chat.text, chat ? chat.text : '无');
  ok('闲话念的是**你自己的事**（含玩家名）', !!chat && chat.text.includes('魏某'));
  ok('闲话有引号（是「听见别人在说」，不是旁白）', !!chat && /「.+」/.test(chat.text));
  ok('★ 一天只念一回', rf.chatterIn(w, w.getRoom(roomId)) === null);

  /* 空屋子不该有人说话 */
  if (emptyRoom) {
    p.vars.rumorChatter = undefined;
    ok('★ 空屋子不会有闲话', rf.chatterIn(w, w.getRoom(emptyRoom)) === null);
  }
  /* 这事还没传到的地方，不该有人知道 */
  const farRegion = Object.keys(w.data.regions).find(rid =>
    !rf.aboutPlayer(w).some(r => (r.spread[rid] || 0) >= 8));
  if (farRegion) {
    const farRoom = Object.keys(w.data.rooms).find(id => w.data.rooms[id].region === farRegion
      && (w.npcsIn(id) || []).some(n => !n.dead));
    if (farRoom) {
      p.vars.rumorChatter = undefined;
      ok('★ 没传到的地方不该有人议论你', rf.chatterIn(w, w.getRoom(farRoom)) === null, farRegion);
    }
  }

  /* ================= 五、NPC 当面引用具体那条 ================= */
  section('5 NPC 记着你：把话递到你脸上');
  const npc = (w.npcsIn(p.room) || []).find(n => !n.dead) || w.npcsIncludingTemplates(p.room)[0];
  npc.favor = 5;
  const line = mem.rumorLine(w, npc);
  ok('★ 他会当面提起（不是泛泛的「听说你侠义」）', !!line && !!line.text, line ? line.text : '无');
  ok('引用的是**具体那件事**（含玩家名）', !!line && line.text.includes('魏某'));
  ok('口气按交情分（交情浅 = 打探）', !!line && /你就是那个|听见一句闲话/.test(line.text), line && line.text);
  ok('★ 同一条传闻对他只说一次', mem.rumorLine(w, npc) === null);
  /* 交情深的人换一套口气 */
  const npc2 = (w.npcsIn(p.room) || []).filter(n => !n.dead)[1];
  if (npc2) {
    npc2.favor = 60;
    const l2 = mem.rumorLine(w, npc2);
    ok('交情深的人口气不同（替你着急）', !!l2 && /你跟我说实话|我听着像你/.test(l2.text), l2 ? l2.text : '无');
  }
  /* greetLines 的总排序里，具体传闻优先于泛泛印象 */
  const npc3 = (w.npcsIn(p.room) || []).filter(n => !n.dead).find(n => n !== npc && n !== npc2);
  if (npc3) {
    npc3.favor = 5;
    const g = mem.greetLines(w, p, npc3);
    ok('★ 见面时优先说的是**具体的传闻**', g.length === 1 && g[0].text.includes('魏某'),
      g.length ? g[0].text : '没说');
  }

  /* ================= 六、真路径：拜师 → 出门就有风声 ================= */
  section('6 真路径一：拜师（走命令，不直调模块）');
  const e2 = new GameEngine({ seed: 99 });
  await e2.boot({});
  e2.newGame({ name: '小鱼客' });
  const w2 = e2.world, p2 = w2.player;
  /* 挑一个 A 层名人，摆到玩家屋里、给足好感 —— 拜师的常例门槛是有货/不是杂鱼/好感 15 */
  const masterId = Object.keys(w2.data.npcs).find(id => {
    const d = w2.data.npcs[id];
    return (d.tier || 'C') === 'A' && d.name && !d.hostile;
  });
  ok('找到一位 A 层名人当师父', !!masterId, masterId);
  if (masterId) {
    const m = w2.spawnNpc(masterId, p2.room);
    m.favor = 60;
    const before = w2.rumors.filter(r => r.seedId === 'rs_master_take').length;
    const res = await e2.exec('拜师 ' + m.name);
    const txt = (res.lines || []).map(l => l.text).join(' ');
    ok('拜师成功（走的是命令）', /磕了三个头|为师/.test(txt), txt.slice(0, 80));
    const after = w2.rumors.filter(r => r.seedId === 'rs_master_take').length;
    ok('★ 拜完师，传闻跟着出去了', after === before + 1, before + ' → ' + after);

    /* 再走一步，看能不能听见闲话（doMove 真路径） */
    const startRoom = p2.room;
    const dirsCn = { n: '北', s: '南', e: '东', w: '西', ne: '东北', nw: '西北', se: '东南', sw: '西南' };
    const exits = Object.keys(w2.getRoom(startRoom).exits || {});
    let heard = null;
    for (const d of exits) {
      if (!dirsCn[d]) continue;
      w2.movePlayerTo(p2, startRoom);
      p2.vars.rumorChatter = undefined;
      const r = await e2.exec(dirsCn[d]);
      const got = (r.lines || []).find(l => l.text && /压低了声音|嘀咕|说嘴|探出头来/.test(l.text));
      if (got) { heard = got; break; }
    }
    ok('★ 走一步会听见有人在议论你（doMove 真路径）', !!heard, heard ? heard.text : '一条都没出');
    ok('闲话里念的是玩家自己的事', !!heard && heard.text.includes('小鱼客'));
  }

  /* ================= 七、真路径：升位 / 自创武学 ================= */
  section('7 真路径二：门派升位');
  const e3 = new GameEngine({ seed: 31 });
  await e3.boot({});
  e3.newGame({ name: '沈某' });
  const w3 = e3.world, p3 = w3.player;
  /* 摆一个「有人的屋子 + 一个像样的门派 + 一份够用的贡献」*/
  const someSect = Object.values(w3.data.sects).find(s => s && s.id && s.name);
  ok('世上确实有门派', !!someSect, someSect && someSect.name);
  if (someSect) {
    p3.sect = someSect.id;
    p3.rank = 0;
    p3.sectContribution = 99999;
    const before = w3.rumors.length;
    const r = SL.promoteByMaster(w3, p3, { name: '某长老', rank: 3 });
    ok('升位成功', !!r.ok, (r.lines || []).map(l => l.text).join(' / ').slice(0, 90));
    ok('★ 升位后传闻跟着出去了',
      w3.rumors.slice(before).some(x => x.seedId === 'rs_sect_promote'),
      w3.rumors.slice(before).map(x => x.seedId).join(',') || '无');
    ok('系统给了「传出去了」的提示',
      (r.lines || []).some(l => l.text && l.text.includes('门外已经有人')));
    const txt = w3.rumors.filter(x => x.seedId === 'rs_sect_promote').map(x => w3.fillRumorText(x)).join(' ');
    ok('传闻里写了升到哪个位分', /外门弟子|内门弟子|执事弟子|首座弟子|副掌门|掌门/.test(txt), txt);
  }

  section('8 真路径三：化用（自创武学）');
  const e4 = new GameEngine({ seed: 55 });
  await e4.boot({});
  e4.newGame({ name: '陆某' });
  const w4 = e4.world, p4 = w4.player;
  /* 找两门同槽、都能练到 280 的武学，直接给到等级（不模拟几百次打坐） */
  const bySlot = {};
  for (const id of Object.keys(w4.data.skills)) {
    const s = w4.data.skills[id];
    if (!s.type || s.custom) continue;
    (bySlot[s.type] = bySlot[s.type] || []).push(id);
  }
  const slot = Object.keys(bySlot).find(k => bySlot[k].length >= 2);
  if (slot) {
    const [aId, bId] = bySlot[slot];
    p4.learnSkill(aId, { force: true });
    p4.learnSkill(bId, { force: true });
    /* ⚠️ 等级必须在 canFuse **之前**给：canFuse 就是拿等级判「够不够火候」的，
       先问后给会得到「你现在 1 级」的拒绝（本脚本自己踩过一次）。 */
    p4.learned[aId].level = CS.MIN_LEVEL + 20;
    p4.learned[bId].level = CS.MIN_LEVEL + 20;
    p4.maxMp = 5000;
    p4.mp = 5000;                       /* canFuse 也查内力够不够，一并先给 */
    const c = CS.canFuse(w4, p4, aId, bId);
    if (c.ok) {
      w4.rng.next = () => 0;            /* 钉死成必成（否则走火分支） */
      const before = w4.rumors.length;
      const f = CS.fuse(w4, p4, aId, bId, '两仪剑');
      ok('化用成功', !!f.ok, (f.lines || []).map(l => l.text).join(' / ').slice(0, 80));
      ok('★ 自创武学也传出去了',
        w4.rumors.slice(before).some(x => x.seedId === 'rs_skill_fuse'),
        w4.rumors.slice(before).map(x => x.seedId).join(',') || '无');
      const ft = w4.rumors.filter(x => x.seedId === 'rs_skill_fuse').map(x => w4.fillRumorText(x)).join(' ');
      ok('传闻里带上了新功夫的名字', ft.includes('两仪剑'), ft);
    } else {
      ok('化用前置条件满足', false, c.why);
    }
  } else {
    ok('找得到同槽的两门武学', false, '数据库里没有');
  }

  /* ================= 九、风声指令 ================= */
  section('9 「风声」指令');
  const e5 = new GameEngine({ seed: 20261011 });
  await e5.boot({});
  e5.newGame({ name: '白某' });
  const empty = await e5.exec('风声');
  const etxt = (empty.lines || []).map(l => l.text).join(' ');
  ok('还没做事的人：给「没人议论你」而不是空白', /还没留下什么话柄|没人议论你/.test(etxt), etxt.slice(0, 60));

  rf.note(e5.world, 'rs_skill_fuse', { vars: { whom: '白氏刀法' } });
  const some = await e5.exec('风声');
  const stxt = (some.lines || []).map(l => l.text).join(' ');
  ok('★ 做了事之后：念出关于你的原话', stxt.includes('白某') && stxt.includes('白氏刀法'), stxt.slice(0, 120));
  ok('标了传到哪儿', /传到/.test(stxt));
  ok('标了走样与否', /话还是原样|走样/.test(stxt));
  ok('给了「会淡下去」的提示', /淡下去/.test(stxt));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
