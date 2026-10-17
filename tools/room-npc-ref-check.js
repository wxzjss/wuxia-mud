#!/usr/bin/env node
/**
 * room-npc-ref-check.js —— 「房动作指向的 NPC 是否真存在/真在本房」常驻守卫
 *
 * 出身：审计里 6 处「点了说『这里没有「夫子」』」——动作 cmd 里写着的人名，与房里 NPC 的真名对不上。
 *     一次性台账治不了复发（改名/搬迁/覆盖都会再造一个），故做成套件守卫。
 *     派单：game-design-director-2（2026-10-17），落盘：qa-lead。
 *
 * 判据（三档，红/橙都不许"静默绿"）：
 *   🔴 红：`ask/talk <名字>` 的「名字」在 data.npcs[*].name 里查无此人
 *          ——玩家点了必然得到「这里没有「X」」，属于死键。
 *   🟠 橙：名字查得到，但该 NPC 的 `def.room` 不是本房
 *          ——可能是排班/游走（有意的），也可能是搬房漏改；提示不判红。
 *   🟠 橙：`list <名字>` 里的名字不是 NPC
 *          ——list 常写货摊/掌柜名，不一定是人名，故只提示，不判红。
 *   🟠 橙：`ask/talk` 用了**别名**（如「算命先生」→ 徐半仙）
 *          ——引擎按 name 查人，别名未必命中；提示，让作者改成真名。
 *
 * 为什么别名不静默放行：别名表是我手写的，引擎不认识它。
 *   把别名当"找到"会掩盖「数据写着旧名、引擎查无此人」这一整族——那正是本守卫要抓的。
 *
 * 用法：
 *   node tools/room-npc-ref-check.js            # 全库扫描（套件无参跑）
 *   node tools/room-npc-ref-check.js --selftest # 只跑判定器自测
 *   node tools/room-npc-ref-check.js --inject 'jn_school|ask 查无此人 about 学问'  # 故障注入（只读，内存加一条假动作）
 *
 * 注入是给「这守卫到底会不会红」用的：不写进数据、只加进本次扫描列表。
 * 交付时至少验一条注入红 + 一条正常绿，否则等于没验过它能抓。
 */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };

/* 已知别名（game-design-director-2 提供，2026-10-17）。只用于**提示**，不用于放行。 */
const ALIAS = {
  算命先生: '徐半仙',
  郎中: '陈济仁',
  老鸨: '苗春',
  夫子: '陆见山',
  脚夫: '王大壮',
};

/**
 * 判定单条动作（纯函数，自测直考）
 * @param {string} roomId
 * @param {{cmd?:string,label?:string}} action
 * @param {Set<string>} names    全库 NPC 名字
 * @param {(name:string)=>({name?:string,room?:string}|undefined)} lookup
 * @returns {{level:'red'|'orange'|'ok', code:string, detail:string}}
 */
function judge(roomId, action, names, lookup) {
  const cmd = String((action && action.cmd) || '').trim();
  const mAsk = /^(ask|talk)\s+(\S+)/.exec(cmd);
  if (mAsk) {
    const who = mAsk[2];
    if (!names.has(who)) {
      if (ALIAS[who]) {
        return { level: 'orange', code: 'ALIAS', detail: '写了别名「' + who + '」（真名疑为「' + ALIAS[who] + '」）；引擎按 name 查人，别名未必命中' };
      }
      return { level: 'red', code: 'NPC_NOT_FOUND', detail: '「' + who + '」在 NPC 表里查无此人' };
    }
    const n = lookup(who) || {};
    if (n.room && n.room !== roomId) {
      return { level: 'orange', code: 'NPC_OTHER_ROOM', detail: '「' + who + '」定岗在 ' + n.room + '（排班/游走则无妨）' };
    }
    return { level: 'ok', code: '', detail: '' };
  }
  const mList = /^list\s+(\S+)/.exec(cmd);
  if (mList && !names.has(mList[1])) {
    return { level: 'orange', code: 'LIST_NOT_NPC', detail: 'list 的对象「' + mList[1] + '」不是 NPC（货摊/招牌名？）' };
  }
  return { level: 'ok', code: '', detail: '' };
}

/* ---------------- 自测（命中/不命中各 ≥1，别名走橙） ---------------- */
function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c, got) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + '  « 实际: ' + JSON.stringify(got)); } };
  const names = new Set(['陆见山', '徐半仙']);
  const lookup = (n) => (n === '陆见山' ? { name: '陆见山', room: 'jn_school' } : n === '徐半仙' ? { name: '徐半仙', room: 'jn_fortune' } : undefined);

  const r1 = judge('jn_school', { cmd: 'ask 陆见山 about 学问' }, names, lookup);
  ok('同房真名 → ok（不命中红）', r1.level === 'ok', r1);
  const r2 = judge('jn_school', { cmd: 'ask 夫子 about 学问' }, names, lookup);
  ok('别名（夫子）→ 橙 ALIAS，不判红也不放行（命中橙）', r2.level === 'orange' && r2.code === 'ALIAS', r2);
  const r3 = judge('jn_school', { cmd: 'ask 无名氏 about 学问' }, names, lookup);
  ok('查无此人 → 红（命中红）', r3.level === 'red' && r3.code === 'NPC_NOT_FOUND', r3);
  const r4 = judge('jn_teahouse', { cmd: 'talk 陆见山' }, names, lookup);
  ok('人名但不在本房 → 橙 NPC_OTHER_ROOM', r4.level === 'orange' && r4.code === 'NPC_OTHER_ROOM', r4);
  const r5 = judge('jn_teahouse', { cmd: 'list 茶博士' }, names, lookup);
  ok('list 非 NPC 名 → 橙 LIST_NOT_NPC（不判红）', r5.level === 'orange' && r5.code === 'LIST_NOT_NPC', r5);
  const r6 = judge('jn_teahouse', { cmd: 'drink' }, names, lookup);
  ok('无人名的动作 → ok（不误报）', r6.level === 'ok', r6);

  console.log('\n自测 ' + pass + '/' + (pass + fail) + ' 通过');
  return fail === 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

console.log('⓪ 判定器自测');
if (!selftest()) { console.error('自测未过，终止。'); process.exit(1); }

(async () => {
  const e = new GameEngine({ seed: 7 });
  await e.boot({});
  const w = e.world;
  const byName = new Map();
  for (const n of Object.values(w.data.npcs || {})) if (n && n.name && !byName.has(n.name)) byName.set(n.name, n);
  const names = new Set(byName.keys());
  const lookup = (n) => byName.get(n);

  const rooms = Object.values(w.data.rooms || {});
  let scanned = 0, reds = [], oranges = [];
  /* 故障注入（只读）：'rid|cmd' 形式，内存里加一条假动作，用来证明守卫会红 */
  const inj = arg('inject');
  const injected = inj ? [{ id: inj.split('|')[0], actions: [{ cmd: inj.split('|').slice(1).join('|') }] }] : [];
  for (const r of rooms.concat(injected)) {
    for (const a of arr(r.actions)) {
      scanned++;
      const j = judge(r.id, a, names, lookup);
      if (j.level === 'red') reds.push({ rid: r.id, cmd: a.cmd, ...j });
      else if (j.level === 'orange') oranges.push({ rid: r.id, cmd: a.cmd, ...j });
    }
  }

  console.log('\n§1 扫描：' + rooms.length + ' 房 / ' + scanned + ' 房动作 · NPC 名 ' + names.size + ' 个');
  console.log('  🔴 红 ' + reds.length + ' 条');
  reds.slice(0, 12).forEach((x) => console.log('    ' + x.rid + ' | ' + x.cmd + ' → ' + x.detail));
  console.log('  🟠 橙 ' + oranges.length + ' 条（不判红）');
  oranges.slice(0, 10).forEach((x) => console.log('    ' + x.rid + ' | ' + x.cmd + ' → ' + x.code + ' ' + x.detail));

  if (scanned === 0) { console.error('✘ 扫到 0 条房动作 —— 索引没建起来，拒绝空跑'); process.exit(2); }
  if (reds.length) { console.log('\n✘ ' + reds.length + ' 条红：动作点名的人查无此人（玩家点了必然「这里没有」）'); process.exit(1); }
  console.log('\n✔ 通过：所有 ask/talk 动作点名的人都在 NPC 表里，且定岗本房');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
