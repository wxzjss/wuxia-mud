/**
 * arts.js — 战斗外秘技（在 NPC 交互界面使用）+ 合欢宗功法
 *
 * 共同规矩（主人原话）：
 *  · **只对实力比自己弱的 NPC 使得出**；按实力差距掷骰，**差得越远越稳**
 *  · 需要**先激活**对应功法（装在槽位上或作为散手运着）
 *  · 合欢宗的迷惑类还要看**好感**：好感越高越容易成
 *
 * 效果一览：
 *   迷晕 knockout · 致幻 stray（在附近几条街打转）· 暗劲 hiddenforce（受伤大增）
 *   下毒 poison · 催眠 charm（短时间对你言听计从）· 采补 drain · 双修 dual
 */
'use strict';

function cfg(world) { return world.data.arts || {}; }
function hh(world) { const h = world.data.hehuan; return (h && h.hehuan) || h || {}; }

/**
 * 全部秘技 = 通用秘技（83）+ 各门派/势力专属（85）。
 * ⚠️ 两份数据在不同顶层键下（`arts` / `sectArts`）—— 同键会被按键合并、后者整段顶掉前者。
 */
function listOf(world) {
  const a = (world.data.arts || {}).list || [];
  const b = (world.data.sectArts || {}).list || [];
  return a.concat(b);
}

/** 战力：气血/内力/攻防身法加权（等级早已废除，不比等级） */
function powerOf(u) {
  if (!u) return 1;
  const hp = u.maxHp || 100, mp = u.maxMp || 50;
  const atk = u.atk || 5, def = (typeof u.defFinal === 'number' ? u.defFinal : (u.defBase || 2));
  const dodge = u.dodge || 0, parry = u.parry || 0;
  return Math.max(1, hp * 0.6 + mp * 0.5 + atk * 4 + def * 2.5 + dodge * 1.5 + parry * 1.5);
}

/** 这门功法「运着」吗？——装在槽位上，或作为散手激活着 */
function isActive(ch, sid) {
  if (!sid) return false;
  if (!ch.learned || !ch.learned[sid]) return false;
  if (Object.values(ch.equippedSkills || {}).indexOf(sid) >= 0) return true;
  if ((ch.standaloneActive || []).indexOf(sid) >= 0) return true;
  return false;
}

function artUsable(world, ch, art) {
  const need = art.needSkills || [];
  if (!need.some(sid => isActive(ch, sid))) {
    const names = need.map(sid => (world.getSkill(sid) || {}).name || sid).join(' / ');
    return { ok: false, why: `须先运起：${names}` };
  }
  if (art.sectOnly && ch.sect !== art.sectOnly) {
    const s = world.data.sects[art.sectOnly] || {};
    return { ok: false, why: `这是${s.name || art.sectOnly}的功夫` };
  }
  if ((ch.mp || 0) < (art.mpCost || 0)) return { ok: false, why: `内力不足（需 ${art.mpCost || 0}）` };
  return { ok: true };
}

/** 成功率：只对弱者、差距越大越稳；合欢迷惑类另加好感权重
 *  ⚠️ `allowStronger` 的那几种（疗伤 / 授内力 / 安抚）**不受强弱限制** ——
 *     替人上药、分人一截内力，本来就不需要打得过对方。 */
function chanceOf(world, ch, npc, art) {
  const mine = powerOf(ch), his = powerOf(npc);
  if (his >= mine && !art.allowStronger) {
    return { ok: false, chance: 0, why: '对方的功力不在你之下，这种手段使不出来' };
  }
  const gap = Math.max(0, (mine - his) / Math.max(1, mine));          // 0~1
  let c = (art.baseChance || 0.5) * (0.35 + gap * 1.3);
  if (art.allowStronger && his >= mine) c = (art.baseChance || 0.5) * 0.8 + 0.15;
  if (art.favorBonus) c += Math.min(0.35, Math.max(0, npc.favor || 0) / 300);
  return { ok: true, chance: Math.max(0.05, Math.min(0.95, c)) };
}

/** NPC 身上已有的印记（面板要显示「已中招」） */
function marksOf(npc) {
  const v = (npc && npc.vars) || {};
  const out = [];
  if (v.stray && v.stray.until > 0) out.push('迷了路');
  if (v.hiddenForce && v.hiddenForce.until > 0) out.push('带暗劲');
  if (v.charmed && v.charmed.until > 0) out.push('被你拿住心神');
  if (v.drained) out.push(`被采补 ${v.drained} 次`);
  return out;
}

/** 面板用：这个人身上能对他用哪些秘技 */
function listFor(world, ch, npc) {
  if (!ch || !npc || npc.isPlayer) return [];
  const out = [];
  for (const art of listOf(world)) {
    /* 🔴 「双修」「采补」**不再列在秘技里**（主人 2026-10-11）：
       这两桩要判晚上、判旁边有没有人、判双方关系与家世，还要一轮一轮往下走 ——
       塞在一个「点一下就结算」的列表里，判定根本挂不住，玩家也看不到过程。
       它们现在挂在「点 NPC 名字 → 互动面板」的按钮上，流程在 `dualcultivate.js`。
       数据留着（`83_arts.json` 里那两条）当配置与文案来源，只是不在这儿露面。 */
    if (art.effect === 'dual' || art.effect === 'drain') continue;
    const u = artUsable(world, ch, art);
    const c = u.ok ? chanceOf(world, ch, npc, art) : { ok: false, chance: 0, why: u.why };
    let extra = null;
    if (art.effect === 'drain') {
      const used = ((npc.vars || {}).drained) || 0;
      const max = art.perNpcMax || 10;
      if (used >= max) extra = { ok: false, why: `这个人已经被采补过 ${used} 次，再取不出什么了` };
    }
    if (art.effect === 'dual' && art.favorNeed && (npc.favor || 0) < art.favorNeed) {
      extra = { ok: false, why: `交情不够（好感 ${Math.round(npc.favor || 0)}/${art.favorNeed}）` };
    }
    const usable = u.ok && c.ok && !extra;
    out.push({
      id: art.id, name: art.name, cat: art.cat || '', desc: art.desc || '',
      mpCost: art.mpCost || 0,
      can: usable,
      chance: c.chance ? Math.round(c.chance * 100) : 0,
      why: !u.ok ? u.why : (!c.ok ? c.why : (extra ? extra.why : null)),
    });
  }
  return out;
}

/** 真用一次 */
function use(world, ch, npc, artId) {
  const art = listOf(world).find(a => a.id === artId || a.name === artId);
  if (!art) return { ok: false, lines: [{ kind: 'warn', text: '没有这一手。' }] };
  if (!npc) return { ok: false, lines: [{ kind: 'warn', text: '这里没有这个人。' }] };
  const u = artUsable(world, ch, art);
  if (!u.ok) return { ok: false, lines: [{ kind: 'warn', text: u.why + '。' }] };
  const c = chanceOf(world, ch, npc, art);
  if (!c.ok) return { ok: false, lines: [{ kind: 'warn', text: c.why + '。' }] };
  if (art.effect === 'drain') {
    const used = ((npc.vars || {}).drained) || 0;
    if (used >= (art.perNpcMax || 10)) {
      return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}已经被采补过 ${used} 次了，身上再没什么可取。` }] };
    }
  }
  if (art.effect === 'dual' && art.favorNeed && (npc.favor || 0) < art.favorNeed) {
    return { ok: false, lines: [{ kind: 'warn', text: `${npc.name}与你的交情还不到这一步。` }] };
  }
  ch.mp = Math.max(0, (ch.mp || 0) - (art.mpCost || 0));
  const win = world.rng.next() < c.chance;
  const t = s => String(s || '').replace(/\{name\}/g, npc.name);
  if (!win) {
    /* 失手：对方会记住你不怀好意 —— 掉好感，但不是「什么都没发生」 */
    npc.favor = (npc.favor || 0) - 4;
    return {
      ok: true, win: false,
      lines: [
        { kind: 'plain', text: t(art.fail) },
        { kind: 'sys', text: `${npc.name}似乎留了心（好感 −4）。` },
      ],
    };
  }
  const v = npc.vars || (npc.vars = {});
  const now = world.clockMinutes || 0;
  const lines = [{ kind: 'plain', text: t(art.ok) }];
  switch (art.effect) {
    case 'knockout': {
      npc.hp = 0; npc.dead = true; npc.knockedOut = true;
      lines.push({ kind: 'sys', text: `${npc.name}倒在地上，人事不省。` });
      break;
    }
    case 'stray': {
      v.stray = { until: (art.minutes || 240), home: npc.room, left: art.minutes || 240 };
      lines.push({ kind: 'sys', text: `${npc.name}在街上转了两圈，又转回原地。（大约 ${art.minutes || 240} 分钟内，他都走不远。）` });
      break;
    }
    case 'hiddenforce': {
      v.hiddenForce = { left: art.seconds || 1800, mult: art.mult || 1.6 };
      lines.push({ kind: 'sys', text: `一缕暗劲已经埋下了（他受伤会重得多）。` });
      break;
    }
    case 'poison': {
      npc.addBuff({ name: '暗毒', turns: art.turns || 40, mods: {}, tag: 'dot_暗毒', dot: { value: art.dot || 20, source: ch.id } });
      lines.push({ kind: 'sys', text: `${npc.name}中了毒，自己还不知道。` });
      break;
    }
    case 'charm': {
      const gain = (hh(world).charm && hh(world).charm.favorGain) || 40;
      v.charmed = { left: art.minutes || 120 };
      v.charmBase = npc.favor || 0;
      npc.favor = (npc.favor || 0) + gain;
      lines.push({ kind: 'sys', text: `${npc.name}对你言听计从（好感 +${gain}，约 ${art.minutes || 120} 分钟后会醒过神来）。` });
      break;
    }
    case 'drain': {
      const cur = npc.maxMp || 0;
      const take = Math.max(1, Math.floor(cur * (art.ratio || 0.1)));
      npc.maxMpBase = Math.max(10, (npc.maxMpBase || 50) - take);
      npc.recalc && npc.recalc();
      ch.maxMpBase = (ch.maxMpBase || 50) + take;
      ch.recalc && ch.recalc();
      v.drained = (((npc.vars || {}).drained) || 0) + 1;
      lines.push({ kind: 'sys', text: `你取走了 ${take} 点内力上限（${npc.name}：第 ${v.drained}/${art.perNpcMax || 10} 次）。` });
      /* 对方记忆：他会记得「自己愿意」，但性格不同反应不同 */
      const per = (require('./personality').personalityOf(npc)) || {};
      const hasHome = !!(npc.def && npc.def.home) || !!npc.home;
      const react = hasHome
        ? `${npc.name}整了整衣裳，忽然想起家里还有人等着，匆匆走了。`
        : (per.name === '刚烈' || per.tag === '刚烈')
          ? `${npc.name}醒过神来，脸上青一阵白一阵，摔门走了。`
          : `${npc.name}看着你笑了笑，像是自己做了什么愿意的事。`;
      lines.push({ kind: 'plain', text: react });
      break;
    }
    case 'dual': {
      const g = art.gain || 8;
      npc.maxMpBase = (npc.maxMpBase || 50) + g;
      npc.recalc && npc.recalc();
      ch.maxMpBase = (ch.maxMpBase || 50) + g;
      ch.recalc && ch.recalc();
      npc.favor = (npc.favor || 0) + 8;
      lines.push({ kind: 'sys', text: `两人内力上限各涨 ${g}（好感 +8）。` });
      break;
    }
    /* ---- 各门派/势力专属（85_sect_arts.json）---- */
    case 'gift': {
      /* 讨要：先掏他随身的钱，没钱就从他带的东西里拿一件 */
      const carry = npc.carry || (npc.carry = { items: [], money: 0 });
      let got = null;
      if ((carry.money || 0) > 0) {
        const take = Math.min(carry.money, 20 + Math.floor(world.rng.next() * 180));
        carry.money -= take; ch.money = (ch.money || 0) + take;
        got = take + ' 文';
      } else if ((carry.items || []).length) {
        const iid = carry.items.shift();
        const d = world.getItem(iid) || {};
        world.giveItem(ch, iid, 1);
        got = d.name || iid;
      } else if (npc.equipment && npc.equipment['武器']) {
        const iid = npc.equipment['武器'];
        const d = world.getItem(iid) || {};
        npc.equipment['武器'] = null;
        world.giveItem(ch, iid, 1);
        got = d.name || iid;
      }
      lines.push(got
        ? { kind: 'sys', text: `你从他手上得了 ${got}。` }
        : { kind: 'plain', text: '他翻了半天，什么也没翻出来。' });
      npc.favor = (npc.favor || 0) - 2;      // 讨东西总归伤交情
      break;
    }
    case 'soothe': {
      npc.hostile = false;
      npc.anger = 0;
      if (npc.mood !== undefined) npc.mood = Math.min(100, (npc.mood || 50) + 8);
      npc.favor = (npc.favor || 0) + 4;
      lines.push({ kind: 'sys', text: `${npc.name}的火气下去了（好感 +4）。` });
      break;
    }
    case 'awe': {
      /* 记**回合数**：战斗里没有时间推进，按秒记是记了个寂寞 */
      v.awe = { left: Math.max(1, Math.ceil((art.seconds || 3600) / 60)) };
      lines.push({ kind: 'sys', text: `${npc.name}一时半刻不敢对你动手。` });
      break;
    }
    case 'heal_npc': {
      const heal = Math.ceil((npc.maxHp || 100) * 0.5);
      npc.hp = Math.min(npc.maxHp, (npc.hp || 0) + heal);
      npc.favor = (npc.favor || 0) + (art.favor || 15);
      lines.push({ kind: 'sys', text: `${npc.name}的伤好了些（气血 ${npc.hp}/${npc.maxHp}，好感 +${art.favor || 15}）。` });
      break;
    }
    case 'mp_gift': {
      const g2 = art.val || 6;
      npc.maxMpBase = (npc.maxMpBase || 50) + g2;
      npc.recalc && npc.recalc();
      const lifted2 = require('./neigong').syncNpcByMp(world, npc);
      npc.favor = (npc.favor || 0) + (art.favor || 20);
      lines.push({ kind: 'sys', text: `${npc.name}的内力上限 +${g2}（现 ${Math.floor(npc.maxMp)}），好感 +${art.favor || 20}。` });
      if (lifted2) lines.push({ kind: 'sys', text: `他一身的功夫跟着水涨船高（${lifted2} 门被顶上去）。` });
      break;
    }
    case 'interrogate': {
      /* 问出底细：优先把画像里那条没解锁的「秘密」掏出来 */
      const pt = npc.portrait || {};
      npc.pstate = npc.pstate || {};
      const revealed = npc.pstate.revealed || (npc.pstate.revealed = []);
      let told = null;
      for (const k of ['secret', 'fear', 'want', 'origin']) {
        if (pt[k] && revealed.indexOf(k) < 0) { revealed.push(k); told = pt[k]; break; }
      }
      npc.pstate.trust = Math.min(100, (npc.pstate.trust || 0) + 5);
      lines.push(told
        ? { kind: 'story', text: `${npc.name}像是不由自主地开了口：「${String(told).slice(0, 120)}」` }
        : { kind: 'plain', text: `${npc.name}嘴里翻来覆去都是些无关紧要的话，掏不出更多了。` });
      break;
    }
    case 'lure': {
      v.lure = { left: art.minutes || 180, host: ch.id };
      lines.push({ kind: 'sys', text: `${npc.name}这一阵子会跟着你走（约 ${art.minutes || 180} 分钟）。` });
      break;
    }
    case 'curse': {
      const cut = art.val || 8;
      npc.maxMpBase = Math.max(10, (npc.maxMpBase || 50) - cut);
      npc.recalc && npc.recalc();
      lines.push({ kind: 'sys', text: `你化去了${npc.name} ${cut} 点内力上限（现 ${Math.floor(npc.maxMp)}）——这一去就回不来了。` });
      break;
    }
    case 'mark': {
      v.marked = true;
      lines.push({ kind: 'sys', text: `你在${npc.name}身上留了个记号。往后他走到哪儿，你都找得着。` });
      break;
    }
    default: break;
  }
  return { ok: true, win: true, lines };
}

/** 合欢宗入宗：卖身青楼 + 接待满十位 */
function hehuanGate(world, ch) {
  const rule = hh(world).joinNeed || { sold: true, served: 10 };
  const ps = ch.prostitution || {};
  if (ch.sect === 'hehuan') return { ok: false, already: true, msg: '你已是合欢宗的人。' };
  if (ch.sect) {
    const s = world.data.sects[ch.sect] || {};
    return { ok: false, msg: `你已在${s.name || ch.sect}门下，须先脱离。` };
  }
  if (rule.sold && !ps.sold) return { ok: false, msg: '你还没在楼里挂过牌子。' };
  if ((ps.served || 0) < (rule.served || 10)) {
    return { ok: false, msg: `楼里的日子还不够（接待 ${ps.served || 0}/${rule.served || 10} 位）。`, cur: ps.served || 0, need: rule.served || 10 };
  }
  return { ok: true };
}

module.exports = { cfg, hh, listOf, powerOf, isActive, artUsable, chanceOf, listFor, use, marksOf, hehuanGate };
