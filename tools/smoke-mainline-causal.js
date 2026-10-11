/* ============================================================
 * smoke-mainline-causal.js — 主线因果链的「接榫」守卫
 *
 * 来由（design/65）：用因果引擎过了一遍主线，查出几处**接榫松动** ——
 *   ① 第二幕的通行证（半块铜牌）押在一条**可选**房间动作上，房间描述却一个字不提；
 *   ② `q_main_sect` 没有门槛，玩家可以在武当直接接下第二幕、读到「一个将死之人塞给你的
 *      半块铜牌」，而那一幕从没发生过 → 阶段 0 永久卡住（先接后拿 + 剧透）；
 *   ③ `moye_backroad`（后山捷径）**只读不设** → 那条路永远不可达；
 *   ④ 「半交」结局要交出的一卷抄本**从未发到玩家手上**。
 * 这四条都是「不报错、只是走不通」型，肉眼极难发现，所以固化成本脚本。
 * ============================================================ */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const e = new GameEngine({ seed: 20261024, mods: false });
e.boot();
const w = e.world;
const Q = w.data.quests || {};

/* 把一份数据里所有字符串摊平（用来做 flag 的「设置 / 读取」两侧计数） */
function flatten(v, out) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => flatten(x, out));
  else if (v && typeof v === 'object') Object.keys(v).forEach(k => flatten(v[k], out));
  return out;
}
const dataFiles = fs.readdirSync(path.join(ROOT, 'game', 'data'))
  .filter(f => /^\d+_.*\.json$/.test(f));
const allStrings = [];
/* ⚠️ 两套「看文本」的口径，别混：
     · `blob`    —— 只含**字符串值**（摊平过的），适合查「文本里出现没出现某个 id」；
     · `rawBlob` —— 数据文件的**原文**（含键名），查 flag 的两侧必须用它 ——
       因为 `"flag": "xxx"` 里的 `flag` 是**键**，不会出现在摊平出来的字符串里。
       第一版拿 blob 查 flag，于是所有 flag 都被判成「没人读」。 */
const rawParts = [];
for (const f of dataFiles) {
  const raw = fs.readFileSync(path.join(ROOT, 'game', 'data', f), 'utf8');
  rawParts.push(raw);
  try { flatten(JSON.parse(raw), allStrings); } catch (err) { }
}
const blob = allStrings.join('\n');
const rawBlob = rawParts.join('\n');

/* ================= ① 第二幕的门槛 ================= */
section('① 第二幕不许「先接后拿」（剧透 + 卡关）');
{
  const q = Q.q_main_sect;
  ok('第二幕在数据里', !!q);
  ok('★ 第二幕有接取门槛（没铜牌接不到）', !!(q && q.require), JSON.stringify(q && q.require));
  ok('★ 门槛就是那块铜牌（know_east_depot）',
    !!(q && q.require && (/know_east_depot/.test(JSON.stringify(q.require)))), JSON.stringify(q && q.require));
  ok('★ 而且门槛提示是人话（不是「你还不满足接取条件」）',
    !!(q && q.requireMsg && q.requireMsg.length > 8), q && q.requireMsg);
  /* 真走一遍：没铜牌时接不到 */
  const p = w.player || w.createPlayer({ name: '试剑', gender: 'male', birth: 'wuxue' });
  const before = p.questStage ? p.questStage('q_main_sect') : -1;
  if (p.setQuestStage) p.setQuestStage('q_main_sect', -1);
  const r = e.exec('接任务 门派之疑');
  const txt = ((r && r.lines) || []).map(l => l.text || '').join(' ');
  ok('★ 没凭据时接不到，且话说得明白', /东西呢|空着手|还不满足/.test(txt), txt.slice(0, 60));
}

/* ================= ② 铜牌那条路要「看得见」 ================= */
section('② 发铜牌的那场夜戏不能藏在看不见的地方');
{
  const room = w.data.rooms.road_huashan_1;
  ok('华山道房间在', !!room);
  ok('★ 房间描述里点到了「官车 / 歇脚」这类引子',
    !!(room && /官车|歇脚|背风/.test(room.desc || '')), (room && room.desc || '').slice(-40));
  const acts = (room && room.actions) || [];
  const je = acts.find(a => /夜宿/.test(a.cmd || ''));
  ok('★ 「夜宿山道」这条 action 还在（铜牌的唯一来源）', !!je, acts.map(a => a.cmd).join(','));
  if (je) {
    const s = JSON.stringify(je);
    ok('★ 两个分支都发铜牌（拦车 / 让开都不落空）',
      (s.match(/depot_token_half/g) || []).length >= 2,
      '出现 ' + (s.match(/depot_token_half/g) || []).length + ' 次');
    ok('★ 拿到铜牌的同时接上第二幕', /q_main_sect/.test(s));
  }
}

/* ================= ③ 没有「只读不设」的 flag ================= */
section('③ 关键 flag 必须两侧都有（设置处 + 读取处）');
{
  /* 只查主线那几个：全库扫「设置处」，再在全库文本里找「读取处」 */
  const KEYS = ['moye_backroad', 'know_east_depot', 'chen_chaoben', 'act3_done', 'act4_done'];
  const bad = [];
  for (const k of KEYS) {
    /* 设置处：effects 里的 flag / flag:xxx */
    const setRe = new RegExp('"flag"[^"]*"[^"]*"' + k + '"|flag:' + k + '[;:"\\s]');
    /* 设置处：DSL 的 `flag:xxx`，或对象形态 `{"type":"flag","args":["xxx"]}` */
    const setN = (rawBlob.match(new RegExp('flag:' + k + '\\b', 'g')) || []).length
      + (rawBlob.match(new RegExp('"args":\\s*\\[\\s*"' + k + '"', 'g')) || []).length;
    /* 读取处：cond 里的 flag / notFlag */
    const readN = (rawBlob.match(new RegExp('"flag":\\s*"' + k + '"', 'g')) || []).length
      + (rawBlob.match(new RegExp('"notFlag":\\s*"' + k + '"', 'g')) || []).length;
    if (!setN) bad.push(k + '(没处设置)');
    if (!readN) bad.push(k + '(没人读)');
  }
  ok('★ 没有断线 flag（埋了没人读 / 读了没人设）', bad.length === 0, bad.join('、') || KEYS.join(' / ') + ' 两侧俱全');
  ok('★ 「后山捷径」现在有设置点了', /探后山/.test(blob), 'mojiao_shanmen 的「探后山」');
}

/* ================= ④ 结局要交的东西真在玩家手上 ================= */
section('④ 「半交」结局要交的那卷抄本，得真发到玩家手上');
{
  const give = /\+item:wulin_zhenyi_chaoben/.test(blob);
  const itemDef = !!(w.data.items && w.data.items.wulin_zhenyi_chaoben);
  ok('★ 抄本有定义', itemDef);
  ok('★ 抄本有发放点（陈语冰抄纸那段）', give);
  ok('★ 且与 chen_chaoben 这个旗标同一处设置（拿到东西=记下这件事）',
    /chen_chaoben;\+item:wulin_zhenyi_chaoben/.test(blob));
}

/* ================= ⑤ 三结局仍然可达 ================= */
section('⑤ 三结局的旗标两侧齐全');
{
  const ENDS = ['ending_jiaojuan', 'ending_banjiao', 'ending_jujiao'];
  const bad = [];
  for (const k of ENDS) {
    /* 三种写法都要认：DSL 的 `flag:xxx` / `ending:xxx`，
       以及对象形态 —— 引擎里 `{"type":"ending","args":["jujiao","拒交"]}`
       会被映射成 `setFlag('ending_jujiao')`，所以 args[0] 是**不带前缀的短名**。
       第一版只认前两种，于是「拒交」被误判成「没处设置」（实测：它只有对象形态）。 */
    const short = k.replace('ending_', '');
    const setN = (rawBlob.match(new RegExp('flag:' + k + '\\b', 'g')) || []).length
      + (rawBlob.match(new RegExp('ending:' + short + '\\b', 'g')) || []).length
      + (rawBlob.match(new RegExp('"type":\\s*"ending"[^}]*"args":\\s*\\[\\s*"' + short + '"', 'g')) || []).length
      + (rawBlob.match(new RegExp('"args":\\s*\\[\\s*"' + k + '"', 'g')) || []).length;
    const readN = (rawBlob.match(new RegExp(k, 'g')) || []).length;
    /* 两侧各出现一次就够：「设置」是走到那一步时置位，「读取」是成就表里的 flagsAny。 */
    if (!setN || !readN) bad.push(k + '(' + setN + '/' + readN + ')');
  }
  ok('★ 交卷 / 半交 / 拒交 三条都设得出、也读得到', bad.length === 0, bad.join('、') || ENDS.join(' / '));
}

console.log(`\n===== smoke-mainline-causal: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
