/**
 * treasury.js — 重地：藏经阁（三层）/ 藏宝阁 / 国库 / 衙门库房（design/44 R5）
 *
 * 三条规矩（主人原话）：
 *  ① 藏经阁**分三层**，存的是**非本门派**的武学 —— 想学别家的功夫，得进别家的藏经阁
 *  ② 进去要**一定身份地位 + 花贡献**（这里用门派职级 + sectContribution）
 *  ③ 重地由「扫地僧」级高手把守：一流势力一流高手守，二流二流守，依此类推
 *
 * 「贡献」= `p.sectContribution`（与门派晋升同一个池子）：门派大比、门派任务都会给。
 * 所以「进藏经阁」的代价是真的要去门里干活，不是白拿。
 */
'use strict';

function cfg(world) { return world.data.treasury || {}; }

function tierOfSect(world, sid) {
  const s = world.data.sects && world.data.sects[sid];
  return (s && s.tier) || '三流';
}

/** 玩家当前所在的重地（没有就返回 null） */
function here(world) {
  const p = world.player;
  if (!p) return null;
  const room = world.data.rooms[p.room];
  return room && room.treasuryKind ? room : null;
}

/** 这处重地归谁：门派 / 朝廷 / 衙门 */
function ownerOf(world, room) {
  if (!room) return null;
  if (room.treasurySect) {
    const s = world.data.sects[room.treasurySect] || {};
    return { kind: 'sect', id: room.treasurySect, name: s.name || room.treasurySect, tier: s.tier || '三流' };
  }
  if (room.treasuryKind === 'royal') return { kind: 'court', id: 'court', name: '朝廷', tier: '一流' };
  if (room.treasuryKind === 'house') return { kind: 'yamen', id: 'yamen', name: '衙门', tier: '二流' };
  return null;
}

/** 门派贡献够不够进这一层 */
function floorGate(world, ch, floor) {
  const contrib = ch.sectContribution || 0;
  const rank = ch.rank || 0;
  if (rank < (floor.minRank || 0)) return { ok: false, why: `这一层要门中${['外门', '内门', '执事', '首座', '长老', '掌门'][floor.minRank] || '更高的'}身份才准进。` };
  if (contrib < (floor.minContrib || 0)) return { ok: false, why: `门里规矩：进这一层要攒够 ${floor.minContrib} 贡献（你手上 ${contrib}）。` };
  return { ok: true };
}

/** 藏经阁一层里「你还没学过、也不属本门派」的武学 */
function shelfOf(world, ch, floor, owner) {
  const out = [];
  const mine = new Set((() => {
    const s = world.data.sects && world.data.sects[ch.sect];
    return (s && s.skills) || [];
  })());
  for (const sd of Object.values(world.data.skills || {})) {
    if (!sd || !sd.id) continue;
    if (sd.grade == null) continue;
    if (floor.grades.indexOf(sd.grade) < 0) continue;
    if (sd.standalone) continue;                    // 散手不进货架
    if (ch.learned[sd.id]) continue;                // 学过的不用再抄
    if (ch.sect && mine.has(sd.id)) continue;       // 自家的功夫不在自家阁里
    out.push(sd);
  }
  out.sort((a, b) => (a.grade - b.grade) || String(a.name).localeCompare(String(b.name)));
  return out;
}

/** 层视图：三层各自的可不可进、架上有几本 */
function libraryView(world, ch) {
  const c = cfg(world);
  const lib = c.library || {};
  const room = here(world);
  const owner = ownerOf(world, room);
  const contrib = ch.sectContribution || 0;
  const floors = (lib.floors || []).map(f => {
    const gate = floorGate(world, ch, f);
    const shelf = gate.ok ? shelfOf(world, ch, f, owner) : [];
    return {
      id: f.id, name: f.name, grades: f.grades, cost: f.cost || 0,
      minRank: f.minRank, minContrib: f.minContrib,
      can: gate.ok, why: gate.ok ? null : gate.why,
      count: shelf.length, desc: f.desc || '',
    };
  });
  return { owner, contrib, rank: ch.rank || 0, floors, kind: room ? room.treasuryKind : null };
}

/** 某层的书单 */
function shelfView(world, ch, floorId) {
  const c = cfg(world);
  const lib = c.library || {};
  const floor = (lib.floors || []).find(f => f.id === Number(floorId) || f.name === floorId);
  if (!floor) return { ok: false, lines: [{ kind: 'warn', text: '没有这一层。' }] };
  const gate = floorGate(world, ch, floor);
  if (!gate.ok) return { ok: false, lines: [{ kind: 'warn', text: gate.why }] };
  const owner = ownerOf(world, here(world));
  const shelf = shelfOf(world, ch, floor, owner);
  const lines = [{ kind: 'title', text: `【${floor.name} · 可抄录 ${shelf.length} 本】` }];
  lines.push({ kind: 'plain', text: floor.desc || '' });
  if (!shelf.length) {
    lines.push({ kind: 'plain', text: '这一层的东西，你已经没有可抄的了。' });
  } else {
    const byGrade = {};
    for (const sd of shelf) (byGrade[sd.grade] = byGrade[sd.grade] || []).push(sd);
    for (const g of Object.keys(byGrade).sort((a, b) => a - b)) {
      const cn = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'][g] || g;
      lines.push({ kind: 'plain', text: `${cn}品：${byGrade[g].map(s => s.name).join('、')}` });
    }
  }
  lines.push({ kind: 'hint', text: `抄录一本要花贡献（品级越高越贵）。用「抄录 <武学名>」。` });
  return { ok: true, lines, floor, shelf };
}

/** 抄录（学武学，扣门派贡献） */
function copy(world, ch, keyword) {
  const c = cfg(world);
  const lib = c.library || {};
  const room = here(world);
  const owner = ownerOf(world, room);
  if (!ch.sect) return { ok: false, lines: [{ kind: 'warn', text: '你无门无派，抄了武学也没出处。' }] };
  const kw = String(keyword || '').trim();
  if (!kw) return { ok: false, lines: [{ kind: 'warn', text: '要抄哪一本？' }] };
  let hit = null, hitFloor = null;
  for (const f of (lib.floors || [])) {
    if (!floorGate(world, ch, f).ok) continue;
    const shelf = shelfOf(world, ch, f, owner);
    const sd = shelf.find(s => s.name === kw || s.id === kw || s.name.indexOf(kw) >= 0);
    if (sd) { hit = sd; hitFloor = f; break; }
  }
  if (!hit) {
    return {
      ok: false,
      lines: [
        { kind: 'warn', text: `你在架子上没找着「${kw}」。` },
        { kind: 'hint', text: '（要么本门已经教过，要么这一层不够格翻，要么本门用的就是这门功夫。）' },
      ],
    };
  }
  const cost = (lib.copyCost || {})[String(hit.grade)] || (hit.grade * 40);
  if ((ch.sectContribution || 0) < cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `抄这一本要 ${cost} 贡献，你手上只有 ${ch.sectContribution || 0}。` }] };
  }
  const cr = ch.learnSkill(hit.id, { force: true });
  if (!cr.ok) return { ok: false, lines: [{ kind: 'warn', text: cr.msg }] };
  ch.sectContribution -= cost;
  return {
    ok: true,
    lines: [
      { kind: 'plain', text: `你把《${hit.name}》摊在案上，一笔一笔描下来。守阁人站在背后看了半晌，没说话。` },
      { kind: 'sys', text: `花去贡献 ${cost}。你学会了「${hit.name}」（${hit.grade}品）。` },
      { kind: 'sys', text: `余下贡献 ${ch.sectContribution}。` },
    ],
  };
}

/** 藏宝阁/国库/库房的货架 */
function vaultView(world, ch) {
  const room = here(world);
  const kind = room ? room.treasuryKind : null;
  if (kind === 'library') return { ok: false, lines: [{ kind: 'warn', text: '这里是藏经阁，不是藏宝阁。' }] };
  const c = cfg(world);
  const table = kind === 'royal' ? c.royal : kind === 'house' ? c.house : c.vault;
  if (!table) return { ok: false, lines: [{ kind: 'warn', text: '这里没有可看的东西。' }] };
  const owner = ownerOf(world, room);
  const lines = [{ kind: 'title', text: `【${owner ? owner.name : ''}${kind === 'royal' ? '国库' : '藏宝阁'}】` }];
  lines.push({ kind: 'plain', text: (table.note || '') });
  const goods = (table.goods || []);
  const byKind = {};
  for (const g of goods) (byKind[g.kind || '什物'] = byKind[g.kind || '什物'] || []).push(g);
  for (const k of Object.keys(byKind)) {
    lines.push({
      kind: 'plain',
      text: `${k}：${byKind[k].map(g => { const d = world.getItem(g.item) || {}; return `${d.name || g.item}（${g.cost}）`; }).join('　')}`,
    });
  }
  lines.push({ kind: 'sys', text: `你现在有贡献 ${ch.sectContribution || 0}。` });
  lines.push({ kind: 'hint', text: '用「兑换 <物品名>」。' });
  return { ok: true, lines, table, owner };
}

function redeem(world, ch, keyword) {
  const room = here(world);
  const kind = room ? room.treasuryKind : null;
  const c = cfg(world);
  const table = kind === 'royal' ? c.royal : kind === 'house' ? c.house : c.vault;
  if (!table) return { ok: false, lines: [{ kind: 'warn', text: '这里没有可换的东西。' }] };
  const kw = String(keyword || '').trim();
  if (!kw) return { ok: false, lines: [{ kind: 'warn', text: '要换什么？' }] };
  const hit = (table.goods || []).find(g => {
    const d = world.getItem(g.item) || {};
    return d.name === kw || g.item === kw || (d.name && d.name.indexOf(kw) >= 0);
  });
  if (!hit) return { ok: false, lines: [{ kind: 'warn', text: `货架上没有「${kw}」。` }] };
  if ((ch.sectContribution || 0) < hit.cost) {
    return { ok: false, lines: [{ kind: 'warn', text: `${(world.getItem(hit.item) || {}).name}要 ${hit.cost} 贡献，你手上只有 ${ch.sectContribution || 0}。` }] };
  }
  const r = world.giveItem(ch, hit.item, 1);
  if (!r || r.ok === false) return { ok: false, lines: [{ kind: 'warn', text: '你的行囊装不下了。' }] };
  ch.sectContribution -= hit.cost;
  return {
    ok: true,
    lines: [
      { kind: 'plain', text: '守库人在册子上划了一笔，把东西递过来。' },
      { kind: 'sys', text: `花去贡献 ${hit.cost}，换得${(world.getItem(hit.item) || {}).name}。余下贡献 ${ch.sectContribution}。` },
    ],
  };
}

/** 守卫的拦门话（条件不够时用） */
function guardLine(world) {
  const g = cfg(world).guard || {};
  return g.denyLine || '「牌子不够。」他把门一挡。';
}

module.exports = { cfg, here, ownerOf, libraryView, shelfView, copy, vaultView, redeem, tierOfSect, guardLine, floorGate };
