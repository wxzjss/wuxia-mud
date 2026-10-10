/* _mut-quest.js — 临时变异施加器（B20/E4 专项自证用；非交付物，用完删）
 * 用法:
 *   node tools/_mut-quest.js apply <case>   case = e4-ending | b20-crossregion | b20-badname | b20-saydup
 *   node tools/_mut-quest.js restore
 * 纪律：施加后校验 marker 真进文件；e4-ending 额外跑一次「缺陷真的复现」；还原后 cmp 逐字节一致。
 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const F = path.join(ROOT, 'game/data/60_quests.json');
const BAK = F + '.mutbak';

const mode = process.argv[2], cs = process.argv[3];

if (mode === 'restore') {
  if (!fs.existsSync(BAK)) { console.log('  无备份，跳过'); process.exit(0); }
  fs.copyFileSync(BAK, F);
  if (!fs.readFileSync(F).equals(fs.readFileSync(BAK))) throw new Error('还原失败！');
  fs.unlinkSync(BAK);
  console.log('  [还原] cmp 逐字节一致 ✔');
  process.exit(0);
}

if (mode !== 'apply') { console.error('用法: apply <case> | restore'); process.exit(2); }
if (!fs.existsSync(BAK)) fs.copyFileSync(F, BAK);
const doc = JSON.parse(fs.readFileSync(BAK, 'utf8'));
const q = doc.quests;

function write(marker) {
  const s = JSON.stringify(doc, null, 2) + '\n';
  if (!s.includes(marker)) throw new Error('marker 未进入：' + marker);
  fs.writeFileSync(F, s);
  console.log('  [施加] ' + cs + ' → marker OK: ' + marker);
}

if (cs === 'e4-ending') {
  const r = q['q_main_jianghu'].rewards;
  r.splice(r.findIndex(x => x.type === 'narrate' && /江湖很大/.test(x.raw)), 0,
    { type: 'ending', args: ['jianghu_end', '江湖路远'] });
  write('"type": "ending"');
  /* 复现校验：走完第一幕真的产生 ending_jianghu_end */
  const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
  const e = new GameEngine({ seed: 20260901 }); e.boot(); e.newGame({ name: 'x', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  const gid = Object.keys(w.data.npcs).find(id => Array.isArray(w.data.npcs[id].quests) && w.data.npcs[id].quests.includes('q_main_jianghu'));
  p.sect = Object.keys(w.data.sects)[0]; p.setVar('hasSect', 1);
  const sk = Object.keys(p.learned)[0]; if (sk) p.learned[sk].level = 100;
  for (const x of Object.keys(w.data.quests).filter(i => /^sq_/.test(i)).slice(0, 5)) p.quests[x] = 99;
  p.setVar('sidequests_done', 5); p.setFlag('killed_mojiao_dongfang', true); p.setFlag('learned_yijinjing', true);
  w.movePlayerTo(p, w.data.npcs[gid].room);
  for (let i = 0; i < 12 && p.questStage('q_main_jianghu') < 99; i++) e.exec('交任务');
  console.log('  [复现校验] 第一幕走完实产生: ' + JSON.stringify(Object.keys(p.flags).filter(f => /^ending_/.test(f))));
} else if (cs === 'b20-crossregion') {
  q['sq_npcv_001'].stages[0].targets[0].key = 'emei_qingyin';
  write('"key": "emei_qingyin"');
} else if (cs === 'b20-badname') {
  q['sq_npcv_001'].stages[1].desc = '把东西交回给史倦客';
  write('把东西交回给史倦客');
} else if (cs === 'b20-saydup') {
  for (const k of Object.keys(q).filter(k => /^sq_npcv_/.test(k))) {
    const s = (q[k].rewards || []).find(r => r.type === 'say');
    if (s) s.raw = '点点头：「多谢你了。」';
  }
  write('"raw": "点点头：「多谢你了。」"');
} else { console.error('unknown case'); process.exit(2); }
