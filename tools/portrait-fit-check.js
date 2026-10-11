/* ============================================================
 * portrait-fit-check.js — 画像的「口吻」必须跟「身份 + 地点」相容
 *
 * 来由（主人 2026-10-11）：
 *   「为什么古墓派守阁弟子说『前些年遭了些事，家当散尽，在这条街上重新立起来』？
 *     这是她的身份会说的话吗？还有『古墓派的守阁弟子在门口坐着，看街上人来人往』，
 *     以及**这里也不是『街』啊**，肯定不止这一处存在问题，看看其他地方有没有问题」
 *
 *   查下来确实不止一处：**96 个有门派的 B/C 层人物**全被套上了`GENERIC` 街坊模板
 *   （选模板只看 `tag`，门派人物没有 tag → 整批落到街坊兜底池）。
 *   修的是生成器（tools/gen-portraits-bc.js），这个脚本负责**守住不再犯**。
 *
 * 三条判据（都只查「背景三件套」role/origin/routine ——
 * now/want/fear/voice 里出现「街上」是正常的，人物本来就会提到街）：
 *   ① 占位符必须全替换掉（`%{xxx}` 漏在外面就是把模板漏给玩家看了）
 *   ② 有门派的人，背景里不许出现市井行当词
 *   ③ 背景里提到「街 / 铺 / 摊」的人，所在区域必须是城镇型的
 * ============================================================ */
'use strict';
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};

const e = new GameEngine({ seed: 1, mods: false });
e.boot();
const w = e.world;

/* 市井行当词：铺子 / 柜台 / 摊 / 街面 / 邻里…… 在门派里出现就是串味了 */
const MARKET_WORDS = /铺子|铺面|柜台|摊子|摊前|摆摊|街面|街上|街坊|街头|邻里|邻居|胡同|巷口|集市|市集|买卖|字号|掌柜|主顾|本小利薄/;
/* 城镇型区域：这些地方说「街」是对的 */
const TOWN_TIERS = new Set(['city', 'town', 'court', 'market', 'street', 'village']);
const TOWN_REGIONS = new Set([
  'yamen', 'cunzhen', 'shuyuan', 'qinglou', 'palace', 'market', 'farmland', 'harbor',
  'luoyang', 'changan', 'chengdu', 'xiangyang', 'jiangnan', 'gusu', 'secret',
]);

const fields = ['role', 'origin', 'routine'];
const textOf = (p, f) => {
  const v = p[f];
  if (!v) return '';
  if (Array.isArray(v)) return v.map(x => (x && x.act) || '').join(' ');
  return String(v);
};

const all = Object.values(w.data.npcs);
const withPortrait = all.filter(n => n.portrait && typeof n.portrait === 'object');

console.log(`\n（全库 ${all.length} 人，带画像 ${withPortrait.length} 人）`);

console.log('\n① 模板占位符必须全部替换掉');
{
  const bad = [];
  for (const n of withPortrait) {
    const s = JSON.stringify(n.portrait);
    if (/%\{[a-z]+\}/.test(s)) bad.push(n.id + '：' + (s.match(/%\{[a-z]+\}/) || [''])[0]);
  }
  ok('★ 没有把 `%{xxx}` 模板漏给玩家看', bad.length === 0,
    bad.length ? '\n      ' + bad.slice(0, 8).join('\n      ') : '（干净）');
}

console.log('\n② 门派人物不许用市井行当的口吻');
{
  const bad = [];
  for (const n of withPortrait) {
    if (!n.sect) continue;
    const hit = fields.filter(f => MARKET_WORDS.test(textOf(n.portrait, f)));
    if (hit.length) {
      const one = textOf(n.portrait, hit[0]).slice(0, 38);
      bad.push(`${n.id}（${n.name}·${n.sect}）${hit.join('/')}：「${one}」`);
    }
  }
  ok('★ 带门派的人，背景里没有市井腔（铺子/柜台/街坊/摊子…）', bad.length === 0,
    bad.length ? `共 ${bad.length} 处\n      ` + bad.slice(0, 8).join('\n      ') : '（干净）');
}

console.log('\n③ 「现在在哪、在做什么」不许写着街面，人却站在山谷里');
{
  /* ⚠️ 判据只能看 **role / routine**（现在所在与所做），并且只认**真指街面**的词。
     第一版把 `origin` 也算进来、还放进 `摊子|铺子` 这种宽泛词，
     于是这 3 条被误判：
       npcv_134「原先在城里摆摊，摊子被拆了，挑着担子上了路」（说的明明是过去）
       npcv_138「家中原是药商，一场疫病把铺子赔光」（同上）
       npcv_263「华山后山边上支摊子开局」（山道边设赌局本来就是江湖常态）
     过严的守卫会逼着人把好句子改坏，比漏报更糟。 */
  const ON_STREET = /街上|街面|街口|街市|铺子里|铺面|柜台后|柜台前|胡同|巷口|集市|市集|街坊/;
  const bad = [];
  for (const n of withPortrait) {
    const cur = ['role', 'routine'].map(f => textOf(n.portrait, f)).join(' ');
    if (!ON_STREET.test(cur)) continue;
    const room = w.data.rooms[n.room];
    const rid = room && room.region;
    const reg = rid && w.data.regions[rid];
    const isTown = TOWN_REGIONS.has(rid) || (reg && TOWN_TIERS.has(reg.tier));
    if (!isTown) {
      const hit = (cur.match(ON_STREET) || [''])[0];
      bad.push(`${n.id}（${n.name}）在「${reg ? reg.name : n.room}」，画像却写着「${hit}」`);
    }
  }
  ok('★ 没有「人在山谷/门派里，画像却写着街面」的错位', bad.length === 0,
    bad.length ? `共 ${bad.length} 处\n      ` + bad.slice(0, 8).join('\n      ') : '（干净）');
}

console.log('\n④ 画像不许写出「他不认识的自己」（身份与门派名对不上）');
{
  /* role 里点名的门派必须就是他自己的门派 —— 生成器插的是 %{sect}，
     但万一手工改过、或者 sectNameOf 回落错了，就会出现「华山派的人在少林看库」。 */
  const bad = [];
  const sectNames = Object.values(w.data.sects || {}).map(s => s.name).filter(Boolean);
  for (const n of withPortrait) {
    if (!n.sect) continue;
    const mine = (w.data.sects[n.sect] || {}).name;
    if (!mine) continue;
    const role = textOf(n.portrait, 'role');
    const others = sectNames.filter(s => s !== mine && role.indexOf(s) >= 0);
    if (others.length) bad.push(`${n.id}：门派是${mine}，画像里却写着${others.join('/')}`);
  }
  ok('★ role 里点名的门派就是他自己的门派', bad.length === 0,
    bad.length ? '\n      ' + bad.slice(0, 6).join('\n      ') : '（干净）');
}

console.log(`\n===== portrait-fit-check: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
