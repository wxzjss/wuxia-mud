/**
 * persona-portrait-check.js — 性格与画像核对 + 「性格判断入口是否统一」守卫
 *
 * 主人 2026-10-08 的两句追问，就是本脚本的两组断言：
 *   ① 「npc 性格与其画像背景性格核对了吗？」
 *      → 每个有 `portrait.voice.tone` 的 NPC，其性格必须与画像语气**对得上**。
 *        第一版是错的：画像写「讷」的 55 人被哈希分成了温婉/怯懦，
 *        写「冷」的瞎眼老丐成了「豪爽」，写「泼」的成了「油滑」。
 *   ② 「与性格判断有关系统都核对了吗？」
 *      → 静态扫描 core/，若有模块**绕过 `personaIdOf` 自己兜底**（`x.personality || 'mune'`），
 *        那条路会和别处判出不同的性格（同一个人在 A 处是侠义、在 B 处成了木讷）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game/src/core/engine.js'));
const P = require(path.join(ROOT, 'game/src/core/personality.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); } };

const engine = new GameEngine({ seed: 20261010 });
engine.boot();
const w = engine.world;
const all = Object.values(w.data.npcs);

console.log('===== ① 人人有性格 =====');
{
  const missing = all.filter(n => !P.PERSONALITIES[P.personaIdOf(n)]);
  ok('每个 NPC 都判得出性格', missing.length === 0, missing.map(n => n.name).slice(0, 5).join(','));
  const dist = {};
  for (const n of all) { const id = P.personaIdOf(n); dist[id] = (dist[id] || 0) + 1; }
  const worst = Object.keys(dist).sort((a, b) => dist[b] - dist[a])[0];
  const share = dist[worst] / all.length;
  ok('没有哪一类性格占超过四成（否则相性系统形同虚设）', share <= 0.4,
    `${P.PERSONALITIES[worst].name} ${Math.round(share * 100)}%`);
  ok('九种性格都有人', Object.keys(dist).length === 9, Object.keys(dist).length + ' 种');
}

console.log('===== ② 性格 ↔ 画像语气 核对 =====');
{
  const voiced = all.filter(n => n.portrait && n.portrait.voice && n.portrait.voice.tone);
  ok('确实有一批 NPC 带画像语气（前提）', voiced.length >= 50, voiced.length + ' 人');
  const mismatch = [], unmapped = [];
  for (const n of voiced) {
    const want = P.personaFromVoice(n);
    if (!want) { unmapped.push(n.name + '「' + n.portrait.voice.tone + '」'); continue; }
    if (P.personaIdOf(n) !== want) {
      mismatch.push(`${n.name}：画像「${n.portrait.voice.tone}」应=${P.PERSONALITIES[want].name}，实=${(P.personalityOf(n) || {}).name}`);
    }
  }
  ok('画像语气能归到性格（归不掉的应当是极少数）', unmapped.length <= 2, unmapped.join(' / '));
  ok('带画像的人，性格与画像语气一致', mismatch.length === 0, mismatch.slice(0, 6).join(' | '));
}

console.log('===== ③ 抽查（人手核对） =====');
{
  const cases = [
    ['瞎眼老丐', 'lengmo', '画像 tone「冷」'],
    ['小叫花', 'youhua', '画像 tone「油」'],
    ['任我行', 'yinzhi', '画像 tone「慢，低，像在数着什么」→ 城府'],
    ['冯保', 'yinzhi', '画像 tone「每个字都像秤过的」→ 城府'],
    ['影子', 'lengmo', '画像 tone「没有语气」'],
    ['胡录事', 'qienuo', '画像 tone「谨慎、公事公办，一急就结巴」'],
    ['岳不群', 'yinzhi', '点名（无画像）'],
    ['东方不败', 'yinzhi', '点名（无画像）'],
    ['洪七公', 'haoshuang', '点名（无画像）'],
    ['黄药师', 'lengmo', '点名（无画像）'],
    ['灭绝师太', 'baozhao', '点名（无画像）'],
    ['令狐冲', 'haoshuang', '点名（无画像）'],
  ];
  for (const [name, want, why] of cases) {
    const n = all.find(x => x.name === name);
    if (!n) { ok(`${name} 在数据里`, false, '未找到'); continue; }
    ok(`${name} = ${P.PERSONALITIES[want].name}`, P.personaIdOf(n) === want, `${why}，实=${(P.personalityOf(n) || {}).name}`);
  }
}

console.log('===== ④ 性格判断入口是否统一（静态扫描） =====');
{
  const dir = path.join(ROOT, 'game/src/core');
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js') && f !== 'personality.js');
  /* 绕过统一入口的写法：自己拿 `.personality || '某个默认'` 兜底。
     这样同一个人在不同模块会判出不同性格 —— 必须走 personaIdOf。 */
  const bad = [];
  const re = /\.personality\s*\|\|\s*['"]/;
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    txt.split('\n').forEach((line, i) => {
      if (re.test(line) && !/personaIdOf/.test(line)) bad.push(`${f}:${i + 1} ${line.trim().slice(0, 70)}`);
    });
  }
  ok('没有模块绕过 personaIdOf 自己兜底性格', bad.length === 0, bad.slice(0, 6).join('\n      '));

  /* personalityForTag 是「按身份猜」的老入口，只应出现在 personaIdOf 内部 */
  const stray = [];
  for (const f of files) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    txt.split('\n').forEach((line, i) => {
      if (/personalityForTag/.test(line)) stray.push(`${f}:${i + 1}`);
    });
  }
  ok('personalityForTag 不再被各模块直接调用（只该封在 personaIdOf 里）', stray.length === 0, stray.join(', '));
}

console.log('===== ⑤ 组与相性自洽 =====');
{
  ok('九种性格都归了组', Object.keys(P.PERSONALITIES).every(id => !!P.PERSONA_GROUP_OF[id]));
  const gs = Object.keys(P.PERSONA_GROUPS);
  let missing = [];
  for (let i = 0; i < gs.length; i++) for (let j = i; j < gs.length; j++) {
    if (!P.GROUP_AFFINITY[[gs[i], gs[j]].sort().join('|')]) missing.push(gs[i] + '|' + gs[j]);
  }
  ok('四组两两都有规矩', missing.length === 0, missing.join(','));
  ok('每条规矩都写了神态', Object.values(P.GROUP_AFFINITY).every(v => v.react && v.react.length > 6)
    && Object.values(P.PAIR_AFFINITY).every(v => v.react && v.react.length > 6));
}

console.log(`\n===== persona-portrait-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
