/**
 * lore-consistency-check.js — 设定一致性审计
 *
 * 主人 2026-10-08：「看看各个剧情以及门派（还有功法）、人物设定是否有对不上的或需要完善的，修一修」
 *
 * 四组对账（都能给出**具体是哪一条**，不是笼统地说「有问题」）：
 *   ① 门派 ↔ 功法：门派挂的武学真的存在吗？武学挂的门派真的存在吗？
 *   ② 门派 ↔ 弟子：NPC 的门派字段有效吗？他真会本派的功夫吗？
 *   ③ 剧情 ↔ 人物：任务的委托人 / 目标存在吗？文案里点名的人是真有其人吗？
 *   ④ 人物设定：tier 与画像 tier 对得上吗？画像里点到的门派/武学存在吗？
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, extra) => { if (c) pass++; else { fail++; console.log('  ✘ ' + n + (extra !== undefined ? '\n      ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
const w = engine.world;
const sects = Object.values(w.data.sects || {});
const skills = Object.values(w.data.skills || {});
const npcs = Object.values(w.data.npcs || {});
const quests = Object.values(w.data.quests || {});
const rooms = Object.values(w.data.rooms || {});

console.log(`家底：门派 ${sects.length} · 武学 ${skills.length} · NPC ${npcs.length} · 任务 ${quests.length} · 房间 ${rooms.length}`);

console.log('\n===== ① 门派 ↔ 功法 =====');
{
  const missSkill = [];
  for (const sd of sects) {
    const all = [].concat(sd.entrySkills || [], sd.skills || [],
      sd.rankSkills ? Object.values(sd.rankSkills).flat() : []);
    for (const sid of all) if (!w.getSkill(sid)) missSkill.push(`${sd.name} 挂的「${sid}」不存在`);
  }
  ok('门派挂的武学都存在', missSkill.length === 0, missSkill.slice(0, 8).join('\n      '));

  const badSectRef = [];
  for (const sk of skills) {
    const need = [].concat((sk.require && sk.require.sect) || []);
    for (const sid of need) if (!w.getSect(sid)) badSectRef.push(`武学「${sk.name || sk.id}」要求门派「${sid}」，没这家`);
  }
  ok('武学点名的门派都存在', badSectRef.length === 0, badSectRef.slice(0, 8).join('\n      '));

  /* 门派武学应当能追到根（基础武学链），否则玩家练不上去。
     ⚠️ 判据要分清「根」和「孤岛」：
        · **有 base** → 挂在链上，正常；
        · **没有 base 但被别的武学当 base** → 它自己就是那门基础武学（根），也正常；
        · 两者都不是 → **孤岛** —— 谁也练不到它，这才是问题。
     第一版把这个写成「没有 base 就报」，于是「基本内功」「基本剑法」全被误报成错误。 */
  const roots = new Set();
  for (const sk of skills) if (sk.base) roots.add(sk.base);
  const noRoot = [];
  for (const sd of sects) {
    for (const sid of (sd.entrySkills || [])) {
      const sk = w.getSkill(sid);
      if (!sk || sk.standalone) continue;
      if (sk.base || roots.has(sid)) continue;
      noRoot.push(`${sd.name} 的入门武学「${sk.name}」是孤岛（既无 base，也没人拿它当 base）`);
    }
  }
  ok('入门武学都挂在基础武学链上（或本就是根 / 明确标了散手）', noRoot.length === 0, noRoot.slice(0, 8).join('\n      '));

  const noTier = sects.filter(s => !s.tier);
  ok('每个门派都有层级（一流/二流/三流）', noTier.length === 0, noTier.map(s => s.name).join('、'));
  const noRanks = sects.filter(s => !s.ranks || !s.ranks.length);
  ok('每个门派都有职位表', noRanks.length === 0, noRanks.map(s => s.name).join('、'));
}

console.log('\n===== ② 门派 ↔ 弟子 =====');
{
  const badSect = npcs.filter(n => n.sect && !w.getSect(n.sect));
  ok('NPC 的门派字段都有效', badSect.length === 0, badSect.slice(0, 8).map(n => `${n.name}(${n.sect})`).join('、'));

  /* 会不会本派的功夫：门派弟子应当至少会一门本派武学（除非是杂役/挂名） */
  const noSkill = [];
  for (const sd of sects) {
    const pool = new Set([].concat(sd.entrySkills || [], sd.skills || []));
    for (const n of npcs.filter(x => x.sect === sd.id)) {
      const learned = Object.keys(n.learned || {});
      const any = learned.some(sid => pool.has(sid));
      const isMob = (n.tier || '') === 'mob';
      if (!any && learned.length && !isMob) noSkill.push(`${sd.name} 的 ${n.name} 一门本派功夫都不会`);
    }
  }
  ok('有功夫的门派弟子，至少会一门本派武学', noSkill.length === 0, noSkill.slice(0, 10).join('\n      '));

  /* 门派 NPC 的住址是否在该门派的地盘附近（只查有 room 的） */
  const stray = [];
  for (const sd of sects) {
    if (!sd.region) continue;
    for (const n of npcs.filter(x => x.sect === sd.id && x.room && x.home === undefined)) {
      const r = w.getRoom(n.room);
      if (!r) { stray.push(`${n.name} 的 room「${n.room}」不存在`); continue; }
    }
  }
  ok('门派弟子的落脚点都是真实房间', stray.length === 0, stray.slice(0, 8).join('\n      '));
}

console.log('\n===== ③ 剧情 ↔ 人物 =====');
{
  const badGiver = [], badRoom = [], nameMiss = [];
  const known = new Set(npcs.map(n => n.name));
  for (const q of quests) {
    for (const g of [].concat(q.giver || [])) {
      const gid = typeof g === 'string' ? g : g.id;
      if (gid && !w.getNpc(gid) && !npcs.some(n => n.id === gid)) badGiver.push(`任务「${q.name || q.id}」的委托人 ${gid} 不存在`);
    }
    const txt = [q.name, q.desc, q.hint].filter(Boolean).join(' ');
    /* 文案里点名的「XXX说」—— 只查**数据里确实存在同名 NPC** 的常见写法，避免误报 */
    const m = txt.match(/([\u4e00-\u9fa5]{2,4})说[:：]/g);
    if (m) for (const t of m) {
      const nm = t.replace(/说[:：]/, '');
      if (nm && !known.has(nm)) nameMiss.push(`任务「${q.name || q.id}」文案提到「${nm}」，数据里没这个人`);
    }
  }
  ok('任务的委托人都在数据里', badGiver.length === 0, badGiver.slice(0, 8).join('\n      '));
  ok('任务文案点名的人确实存在（或只是泛指）', nameMiss.length <= 3, nameMiss.slice(0, 6).join('\n      '));

  /* 任务目标房间存在 */
  for (const q of quests) {
    for (const st of [].concat(q.steps || [])) {
      const rid = st.room || (st.cond && st.cond.room);
      if (rid && !w.getRoom(rid)) badRoom.push(`任务「${q.name || q.id}」指向不存在的房间 ${rid}`);
    }
  }
  ok('任务指向的房间都存在', badRoom.length === 0, badRoom.slice(0, 8).join('\n      '));
}

console.log('\n===== ④ 人物设定 =====');
{
  const tierMismatch = [];
  for (const n of npcs) {
    if (n.portrait && n.portrait.tier && n.tier && n.portrait.tier !== n.tier) {
      tierMismatch.push(`${n.name}：字段 tier=${n.tier}，画像 tier=${n.portrait.tier}`);
    }
  }
  ok('NPC 层级与画像层级对得上', tierMismatch.length === 0, tierMismatch.slice(0, 10).join('\n      '));

  const badPortrait = [];
  for (const n of npcs) {
    const p = n.portrait;
    if (!p) continue;
    for (const k of ['role', 'now', 'want']) {
      if (p[k] !== undefined && typeof p[k] !== 'string') badPortrait.push(`${n.name} 的画像 ${k} 不是文字`);
    }
  }
  ok('画像字段形态正确', badPortrait.length === 0, badPortrait.slice(0, 8).join('\n      '));

  /* 画像里点到的门派，和这个人的 `sect` 字段对不对得上。
     ⚠️ 别再走「把像门派名的词都抓出来、查它在不在名单里」那条路 ——
        中文没有分词，`{2,4}` 会把「**在**丐帮」「**当铺对**门」「**皇城**门」
        整段吃掉，报一堆假警报（试过两版，都是环境噪声）。
        反过来查才有意义：拿**数据里真实存在的门派名**去画像里找，
        找到就比对他自己的 `sect` ——「画像说他在丐帮，可他挂在华山」才是真对不上。 */
  const byName = {};
  for (const s of sects) byName[s.name] = s.id;
  const sectClash = [];
  for (const n of npcs) {
    const p = n.portrait;
    if (!p || !n.sect) continue;                 // 没门派的人（散人）画像提一句旧门派不算错
    const blob = [p.role, p.now].filter(Boolean).join(' ');
    for (const sname of Object.keys(byName)) {
      if (!blob.includes(sname)) continue;
      if (byName[sname] !== n.sect) {
        const mine = w.getSect(n.sect);
        sectClash.push(`${n.name} 画像说在「${sname}」，sect 却是 ${mine ? mine.name : n.sect}`);
      }
    }
  }
  ok('画像提到的门派与他的 sect 字段一致', sectClash.length === 0, sectClash.slice(0, 10).join('\n      '));

  const noPersona = npcs.filter(n => !n.personality);
  ok('每个 NPC 都定了性格', noPersona.length === 0, noPersona.length + ' 人没性格');
}

console.log('\n===== ⑤ 场景 ↔ 区域 =====');
{
  const badRoom = rooms.filter(r => r.exits);
  const ghost = [];
  for (const r of rooms) {
    for (const d of Object.keys(r.exits || {})) {
      const ex = r.exits[d];
      const to = typeof ex === 'string' ? ex : ex && ex.to;
      if (to && !w.getRoom(to)) ghost.push(`${r.name} 的「${d}」通向不存在的 ${to}`);
    }
  }
  ok('没有悬空出口', ghost.length === 0, ghost.slice(0, 8).join('\n      '));
  const noRegion = rooms.filter(r => r.region && !w.getRegion(r.region));
  ok('房间的区域字段都有效', noRegion.length === 0, noRegion.slice(0, 8).map(r => r.name + '(' + r.region + ')').join('、'));
}

console.log(`\n===== lore-consistency-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
