#!/usr/bin/env node
/**
 * _audit_label_cmd_export.js —— 「此地可做」动作名 vs 真指令 落空清单导出（只读）
 *
 * 用途：把全库 room.actions 里 label≠cmd 的每一条，实跑一次 label，导出 TSV 给修复方当验收基线。
 *       修完（派发层加 label→cmd 等值兜底）后重跑本脚本，应 **0 落空**。
 *
 * 判据（落空 = 是）：
 *   · 输出零行
 *   · 掉进兜底句：`此处暂时没有更多可做的了` / `「X」是什么指令`
 *   · 掉进名词兜底：`这里没有「X」`
 * 其余（含 cond 未满足的 failMsg、面板、价格不足提示）都算「否」——有回应就不算落空。
 *
 * 测试状态（写死在输出里，别拿不同状态的数字互比）：
 *   seed=7 新开局，玩家无前置、无门派、钱 200；只把 p.room 指到目标房后 exec(label)。
 *   已知局限：带 cond 的动作在别的状态下给 failMsg（算否），此处不算落空——修复目标本来就是「有回应」。
 *
 * 用法：node tools/_audit_label_cmd_export.js [--tsv 路径]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);

const FALLBACK = /此处暂时没有更多可做的了|是什么指令|这里没有「/;

(async () => {
  const e = new GameEngine({ seed: 7 });
  await e.boot({});
  await e.newGame({ name: '严过关', gender: 'male' });
  const p = e.world.player;

  const cand = [];
  for (const f of fs.readdirSync(DATA).filter((x) => x.endsWith('.json'))) {
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (err) { continue; }
    const rooms = j.rooms;
    if (!rooms) continue;
    const ents = Array.isArray(rooms) ? rooms.map((r) => [r && r.id, r]) : Object.entries(rooms);
    for (const [rid, r] of ents) {
      if (!r) continue;
      for (const a of arr(r.actions)) {
        if (!a || !a.label || !a.cmd) continue;
        if (a.label.trim() === a.cmd.trim()) continue;
        cand.push({ rid, cmd: a.cmd, label: a.label, file: f });
      }
    }
  }

  const rows = [];
  let lost = 0, cmdLost = 0;
  for (const c of cand) {
    /* ① 键盘路径：exec(label)
       ⚠️ 2026-10-18 补：切房后先 `看` 一次 —— NPC 实例是**进房懒生成**的
       （world.npcsIncludingTemplates 的活体闸），不看不生成；
       否则 `ask 徐半仙 / talk 元怀瑾` 这类内置指令会被误判「这里没有」，
       那是量具的假红，不是数据缺 NPC。真玩家进房必然先看到房间描写。 */
    p.room = c.rid;
    try { await e.exec('看'); } catch (e0) {}
    let out = '', threw = false;
    try {
      const r = await e.exec(c.label);
      out = ((r && r.lines) || []).map((l) => (typeof l === 'string' ? l : l.text || '')).join(' ').trim();
    } catch (err) { threw = true; out = '抛错: ' + err.message; }
    const isLost = threw || !out || FALLBACK.test(out);
    if (isLost) lost++;
    /* ② 点击路径等价物：按钮发的是 a.cmd —— 同一状态再跑一次 cmd，用来证明
          「落空是 label 的问题，不是动作本身的问题」（真 DOM 点击未验，此列是派发层等价） */
    let cmdOut = '', cmdThrow = false;
    try {
      const r2 = await e.exec(c.cmd);
      cmdOut = ((r2 && r2.lines) || []).map((l) => (typeof l === 'string' ? l : l.text || '')).join(' ').trim();
    } catch (err) { cmdThrow = true; cmdOut = '抛错: ' + err.message; }
    const cmdIsLost = cmdThrow || !cmdOut || FALLBACK.test(cmdOut);
    if (cmdIsLost) cmdLost++;
    rows.push({
      ...c, lost: isLost ? '是' : '否', out: out.replace(/[\t\n\r]/g, ' ').slice(0, 60) || '（零行）',
      cmdLost: cmdIsLost ? '是' : '否', cmdOut: cmdOut.replace(/[\t\n\r]/g, ' ').slice(0, 40) || '（零行）',
    });
  }

  const head = [
    '# 动作名(label) vs 真指令(cmd) 落空台账 · 生成 ' + new Date().toISOString(),
    '# 口径：落空=零行/兜底句/名词兜底；状态=seed7 新开局、无前置、钱200，仅切 p.room 后 exec(该列词)',
    '# 两列成对：落空(键盘)=exec(label)；cmd落空(点击等价)=exec(cmd)。真 DOM 点击未验，此列是派发层等价物。',
    '# 用于：派发层加 label→cmd 等值兜底后的验收基线（修完重跑本脚本，应「落空」列 0 个「是」）',
    ['room_id', 'cmd', 'label', '落空(键盘)', '实跑输出摘要', 'cmd落空(点击等价)', 'cmd实跑摘要', '分片'].join('\t'),
  ].join('\n');
  const body = rows.map((r) => [r.rid, r.cmd, r.label, r.lost, r.out, r.cmdLost, r.cmdOut, r.file].join('\t')).join('\n');
  const outPath = arg('tsv') ? path.resolve(ROOT, arg('tsv')) : path.join(ROOT, 'tools', '_out_label_cmd.tsv');
  fs.writeFileSync(outPath, head + '\n' + body + '\n', 'utf8');

  console.log('候选 label≠cmd 动作：' + rows.length);
  console.log('落空：' + lost + '  · 有回应：' + (rows.length - lost));
  console.log('TSV → ' + path.relative(ROOT, outPath));
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
