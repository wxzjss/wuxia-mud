#!/usr/bin/env node
/**
 * sect-joinable-check.js —— 「凡 data.sects 有条目，就必须有路拜进去」守门断言
 *
 * 团队长 2026-10-17 裁定：29 家山门按钮空壳（只 narrate、不 joinSect）属阻断，修完要钉死防回潮。
 * 判据是**并集**：任一通路成立即算可达，避免"重复也算漏"——
 *   ① 专属入口：站在自家山门口 execut「拜师 <门派名>」→ 入门成功 或 门槛拒绝（说明机制通、只是条件不满足）
 *   ② 通用入口：收徒大典 `参加大典 <门派名>`（sectlife.festivalInfo 有有限 inDays ⇒ 该派有开山日）
 *   🔴 两条都不成立 = 红（玩家没有任何一条路能拜进去）
 *
 * ⚠️ 关于「南贤/北丑」：team-lead 提到的通用拜师 NPC 在数据里 **0 命中**（`grep 南贤|北丑` 空）。
 *    实际存在的通用入口是**收徒大典**（commands.js:4279，按日轮转、每派一天）。本守卫按真实机制断言。
 *
 * ⚠️ 「门槛拒绝」算通过：性别/悟性/karma 不满足是**设计**（峨眉只收女），不是断头。
 *    若哪天连拒绝文案都没了、只剩空转，本守卫会红——那才是"机制被摘掉"。
 *
 * 用法：
 *   node tools/sect-joinable-check.js                 # 全库断言（套件无参跑）
 *   node tools/sect-joinable-check.js --selftest      # 判定器自测
 *   node tools/sect-joinable-check.js --tsv <路径>    # 另存逐派台账
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };

/**
 * 判定一次「拜师」执行结果（纯函数，自测直考）
 * @returns {{ok:boolean, code:string}}
 */
function judgeJoin(joined, text) {
  if (joined) return { ok: true, code: 'JOINED' };
  const t = String(text || '');
  if (/不收|只收|需 |不足|不够|没有资格|身上没有/.test(t)) return { ok: true, code: 'GATED' }; // 机制在，只是条件不满足
  return { ok: false, code: 'NOOP' };                                                          // 空转：点了没进入任何判定
}

function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c, got) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + '  « 实际: ' + JSON.stringify(got)); } };
  ok('入门成功 → ok', judgeJoin(true, '').ok === true);
  ok('门槛拒绝（本门只收女儿身）→ ok（机制通）', judgeJoin(false, '峨眉派不收你：本门只收女儿身。').ok === true);
  ok('空转（只有一句描写）→ 红（命中）', judgeJoin(false, '山门里走出一个人，上下打量了你两眼。').ok === false);
  ok('查无此类指令 → 红（命中）', judgeJoin(false, '「拜师 某某」是什么指令？').ok === false);
  console.log('\n自测 ' + pass + '/' + (pass + fail) + ' 通过');
  return fail === 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

console.log('⓪ 判定器自测');
if (!selftest()) { console.error('自测未过，终止。'); process.exit(1); }

(async () => {
  const e = new GameEngine({ seed: 7 });
  await e.boot({});
  await e.newGame({ name: '探派', gender: 'male' });
  const w = e.world, p = w.player;
  const SL = require(path.join(ROOT, 'game', 'src', 'core', 'sectlife.js'));

  const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', '41_sect_entry.json'), 'utf8')).sects;
  const ids = Object.keys(entry);
  const rows = [];
  /* 故障注入：--inject <sectId> 把该派两条通路都判死，用来证明本守卫会红（不动数据） */
  const injectId = arg('inject');

  for (const id of ids) {
    const sd = w.getSect(id);
    if (!sd) { rows.push({ id, name: '(无门派定义)', own: '—', fest: '—', verdict: '✗', why: 'data.sects 无此条目' }); continue; }
    p.sect = null; p.rank = 0; p.sectContribution = 0;
    p.room = entry[id].entry;
    try { w.npcsIncludingTemplates(p.room); } catch (_) { /* 生成失败不致命 */ }
    let r;
    try { r = await e.exec('拜师 ' + sd.name); } catch (err) { r = { lines: [{ text: '抛错:' + err.message }] }; }
    const txt = ((r && r.lines) || []).map((l) => l.text || '').join(' ');
    const ownJ = judgeJoin(p.sect === id, txt);

    let festDays = null;
    try { const f = SL.festivalInfo(w, id); festDays = f && Number.isFinite(f.inDays) ? f.inDays : null; } catch (_) { festDays = null; }
    if (injectId && injectId === id) { ownJ.ok = false; ownJ.code = 'NOOP'; festDays = null; } /* 注入 */

    const reachable = ownJ.ok || festDays !== null;
    rows.push({
      id, name: sd.name,
      own: ownJ.ok ? ownJ.code : 'NOOP',
      fest: festDays === null ? '无开山日' : ('inDays=' + festDays),
      verdict: reachable ? '✔' : '✗',
      why: reachable ? '' : '专属入口空转且无收徒大典日程',
    });
    p.sect = null;
  }

  const bad = rows.filter((r) => r.verdict === '✗');
  const head = ['# 门派可入门断言台账 · 判据：专属入口（入门成功/门槛拒绝）∪ 收徒大典（有限 inDays）',
    'sect\tname\t专属入口\t收徒大典\t结论\t原因'].join('\n');
  const outPath = arg('tsv') ? path.resolve(ROOT, arg('tsv')) : path.join(ROOT, '.livetest', 'sect-joinable.tsv');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, head + '\n' + rows.map((r) => [r.id, r.name, r.own, r.fest, r.verdict, r.why].join('\t')).join('\n') + '\n', 'utf8');

  console.log('\n§1 门派 ' + rows.length + ' 家 · 可达 ' + (rows.length - bad.length) + ' · 不可达 ' + bad.length);
  console.log('   专属入口：入门成功 ' + rows.filter((r) => r.own === 'JOINED').length
    + ' · 门槛拒绝 ' + rows.filter((r) => r.own === 'GATED').length
    + ' · 空转 ' + rows.filter((r) => r.own === 'NOOP').length);
  console.log('   收徒大典：有日程 ' + rows.filter((r) => /^inDays=/.test(r.fest)).length + ' 家');
  if (bad.length) {
    console.log('\n✘ 不可达（玩家没有任何一条路拜进去）:');
    bad.forEach((r) => console.log('   ' + r.id + ' ' + r.name + ' — ' + r.why));
    console.log('台账 → ' + path.relative(ROOT, outPath));
    process.exit(1);
  }
  console.log('\n✔ 通过：每家都能拜进去（专属入口或收徒大典）；台账 → ' + path.relative(ROOT, outPath));
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
