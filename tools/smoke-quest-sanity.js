/* ============================================================
 *  smoke-quest-sanity.js —— 玩家可见文本「结构性护栏」（TEXT-HUMANIZE §护栏）
 *
 *  目的：把「改一次」变成「不可能再犯」。
 *  断言全部打在**真数据 + 真引擎**上：
 *    ① 模板变量/占位痕迹（${}、{名}、undefined、.registry…）不得出现在任何玩家可见文本
 *    ② 任务的 target 引用不得指向 NPC 的 id；item/room target 必须真实存在
 *    ③ 「除害」型任务的目标房不得是青楼/客栈/私宅等室内场所
 *    ④ 出家人（monk/nun/taoist）身上的差事必须身份自洽（不得有家眷/家人病这类）
 *    ⑤ 侧线点名之人必须 ∈ giver.rel（覆盖全部 sq_*，不只 sq_npcv_*）
 *    ⑥ 占位词/半截模板不得残留在玩家可见文本里
 *
 *  纪律（照本项目规矩）：
 *    · 无恒真断言：每类都配「变异自证」——先注入缺陷确认转红，再对真数据确认全绿
 *    · 断言读真文件（game/data/*.json）与真引擎（GameEngine.boot + cmds.execute），
 *      不把静态 grep 当断言
 *    · 不写空 catch；不写 `&& false` / 字面 true 当条件
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const P = (f) => path.join(ROOT, f);
const J = (f) => JSON.parse(fs.readFileSync(P(f), 'utf8'));
const { GameEngine } = require(P('game/src/core/engine.js'));
const { normalizeCmd } = require(P('game/src/core/utils.js'));

let pass = 0, fail = 0; const fails = [];
function ok(name, cond, extra) { if (cond) { pass++; console.log('  ✔ ' + name + (extra ? '  ' + extra : '')); } else { fail++; fails.push(name); console.log('  ✘ ' + name + (extra ? '  << ' + extra : '')); } }
function sec(t) { console.log('\n=== ' + t + ' ==='); }

/* ---------------- 真数据 ---------------- */
const DATA = {
  map: J('game/data/50_map.json'),
  npc: J('game/data/40_npcs.json'),
  quest: J('game/data/60_quests.json'),
  item: J('game/data/20_items.json'),
  tutorialSrc: fs.readFileSync(P('game/src/core/tutorial.js'), 'utf8'),
};

/* ---------------- 检查器（对「数据集」求违规，可被变异注入） ---------------- */
/* 返回 { c1:[..], c2:[..], c3:[..], c4:[..], c5:[..], c6:[..] } */
function audit(D) {
  const rooms = D.map.rooms, npcs = D.npc.npcs, quests = D.quest.quests, items = D.item.items;
  const out = { c1: [], c2: [], c3: [], c4: [], c5: [], c6: [] };
  const nameById = {}; for (const [id, n] of Object.entries(npcs)) if (n.name) nameById[id] = n.name;
  const npcIds = new Set(Object.keys(npcs));
  const itemIds = new Set(Object.keys(items));
  const nameSet = new Set(Object.values(nameById));

  /* ---- ① 模板痕迹 ---- */
  const BAD = [
    ['模板字面量', /\$\{[^}\n]{0,40}\}/],
    ['双花括号', /\{\{[^}\n]{0,40}\}\}/],
    ['花括号占位', /\{[A-Za-z_\u4e00-\u9fa5][^}\n]{0,30}\}/],
    ['点号字段', /(?<![0-9A-Za-z_])\.(registry|log|value|args|raw|text|desc|type|count|key|var)\b/],
    ['undefined/NaN', /\bundefined\b|\bNaN\b/],
    ['[object', /\[object\s/],
    ['printf占位', /%[sdif]\b/],
    ['TODO/待补', /\bTODO\b|\bFIXME\b|\bTBD\b|待补|待填|XXXX/],
  ];
  const push1 = (where, text) => { if (typeof text !== 'string') return; for (const [tag, re] of BAD) if (re.test(text)) out.c1.push(where + '[' + tag + ']'); };
  for (const [id, r] of Object.entries(rooms)) { push1('room:' + id + '.name', r.name); push1('room:' + id + '.desc', r.desc); }
  for (const [id, n] of Object.entries(npcs)) {
    push1('npc:' + id + '.desc', n.desc);
    (n.talk || []).forEach((t, i) => push1('npc:' + id + '.talk[' + i + ']', t));
    (n.ask || []).forEach((a, i) => { push1('npc:' + id + '.ask[' + i + ']', a.answer); (a.keywords || []).forEach((k) => push1('npc:' + id + '.ask.kw', k)); });
    push1('npc:' + id + '.askDefault', n.askDefault);
    (n.listen || []).forEach((l, i) => (l.effects || []).forEach((e, j) => push1('npc:' + id + '.listen[' + i + '][' + j + ']', e.raw || e.text)));
  }
  /* tutorial 字符串。
     ⚠️ `{sect}` / `{gate}` / `{art}` 与句库的 `{who}` / `{dir}` / `{place}` 是
        **运行时填充**的模板位（tutorial.fillStory / ambience.fillTpl），
        不是「漏填的占位符」。这里先把这几个已知会被填掉的位换成安全字，
        免得护栏被自家模板语法绊住；「成品里到底还有没有花括号」由
        `smoke-newbie` 真渲染后断言（那边查的是 player 可见的输出，不是源码）。 */
  const KNOWN_TPL = /\{(sect|gate|art|who|dir|place)\}/g;
  (DATA.tutorialSrc.match(/'[^']*'/g) || []).forEach((s, i) => push1('tutorial#' + i, s.replace(/^'|'$/g, '').replace(KNOWN_TPL, 'X')));

  const qWalk = (qid, q, fn) => {
    fn('desc', q.desc);
    fn('name', q.name);
    (q.stages || []).forEach((s, si) => {
      fn('s' + si, s.desc);
      (s.targets || []).forEach((t, ti) => fn('s' + si + '.t' + ti, t.desc));
      (s.rewards || []).forEach((r, ri) => fn('s' + si + '.r' + ri, r.raw || r.text));
      (s.effects || []).forEach((e, ei) => fn('s' + si + '.e' + ei, e.raw || e.text));
    });
    (q.rewards || []).forEach((r, ri) => fn('r' + ri, r.raw || r.text));
  };
  for (const [qid, q] of Object.entries(quests)) qWalk(qid, q, (f, t) => push1('q:' + qid + '.' + f, t));

  /* ---- ② target 引用 ---- */
  /* 注意：kind==='kill' 的 key 本就该是 NPC id（要去杀谁），不在此列；
     被禁的是「物品/地点/标记」槽位填了 NPC 的 id（"采三株许停"这类）。
     「缺 key」的白名单 = 本批**未修**的历史遗留（kill 型不指定具体目标，见报告 §机制上报）；
     白名单里的 id 若被补上 key，下面的反向断言会提示同步删掉这条。 */
  const NO_KEY_BASELINE = new Set(['q_huashan_sword_test', 'q_emei_entry', 'q_bounty_bandit']);
  for (const [qid, q] of Object.entries(quests)) {
    (q.stages || []).forEach((s, si) => (s.targets || []).forEach((t, ti) => {
      const at = qid + '.s' + si + '.t' + ti + ' kind=' + t.kind;
      if (t.key === undefined || t.key === null || t.key === '') {
        if (!(t.kind === 'kill' && NO_KEY_BASELINE.has(qid))) out.c2.push(at + ' 缺 key');
        return;
      }
      if (t.kind !== 'kill' && npcIds.has(t.key)) { out.c2.push(at + ' key 指向 NPC id: ' + t.key); return; }
      if (t.kind === 'item' && !itemIds.has(t.key)) out.c2.push(at + ' item 不存在: ' + t.key);
      if (t.kind === 'room' && !rooms[t.key]) out.c2.push(at + ' room 不存在: ' + t.key);
    }));
  }

  /* ---- ③ 除害型 target 不得室内 ---- */
  const PEST = /野兽|害兽|闹兽|猛兽|作乱|畜生/;
  const INDOOR = /青楼|醉春楼|客栈|酒楼|酒馆|茶馆|茶楼|雅间|雅阁|听雨轩|后厨|戏台|门厅|花厅|库房|器械房|大雄宝殿|天王殿|藏经阁|紫霄宫|王府|宅|府|织造局|尚膳房|内库|天牢|御书房|书院|讲堂|藏书楼|明伦堂|刑房|签押房|架阁库|偏厅|客房|后衙|门房|碾房|小铺|鸡舍|牛棚|猪圈|闺|房$|楼$|堂$|厅$|阁$|室$|院$|店$|铺$/;
  for (const [qid, q] of Object.entries(quests)) {
    const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
    if (!PEST.test(txt)) continue;
    const t0 = q.stages[0].targets && q.stages[0].targets[0];
    if (!t0 || !rooms[t0.key]) continue;
    const nm = rooms[t0.key].name || '';
    if (INDOOR.test(nm)) out.c3.push(qid + ' → ' + t0.key + '「' + nm + '」');
  }

  /* ---- ④ 出家人身份自洽 ---- */
  /* 出家人判定：tag ∈ {monk,nun,taoist}，或称呼里带方丈/大师/师太/道长/禅师/僧/尼/道姑。
     （本项目命名 NPC 的 tag 不可靠：方证大师 / 灭绝师太 的 tag 竟是 swordsman，所以必须并上称呼判据。） */
  const isClergy = (n) => ['monk', 'nun', 'taoist'].includes(n.tag) || /方丈|大师|师太|道长|禅师|僧|尼|道姑/.test((n.title || '') + (n.name || ''));
  for (const [qid, q] of Object.entries(quests)) {
    if (!/^sq_/.test(qid)) continue;
    const gid = qid.replace(/^sq_/, ''); const g = npcs[gid]; if (!g) continue;
    if (!isClergy(g)) continue;
    const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
    if (/家中有人|家里有人|家眷|妻儿|娶|婆娘|内人/.test(txt)) out.c4.push(qid + '(' + g.name + '/' + g.tag + ')');
  }

  /* ---- ⑤ 点名人物 ∈ rel（全部 sq_*） ---- */
  for (const [qid, q] of Object.entries(quests)) {
    if (!/^sq_/.test(qid)) continue;
    const gid = qid.replace(/^sq_/, ''); const g = npcs[gid]; if (!g) { out.c5.push(qid + ' giver 缺失'); continue; }
    const rel = new Set((g.rel || []).map((r) => r.id));
    const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' ');
    for (const mid in nameById) {
      const nm = nameById[mid];
      if (nm.length < 2 || !txt.includes(nm)) continue;
      if (mid === gid) continue;
      if (nm !== g.name && g.name.includes(nm)) continue;   // giver 全名里含该名 → 误判
      if (!rel.has(mid)) out.c5.push(qid + '(' + g.name + ')×' + nm);
    }
  }

  /* ---- ⑥ 占位词 / 半截模板 ---- */
  const PH = ['城里的旧相识', '铺子里的掌柜', '衙门口当差的'];
  for (const [qid, q] of Object.entries(quests)) {
    const txt = [q.desc, ...(q.stages || []).map((s) => s.desc), ...(q.stages || []).flatMap((s) => (s.targets || []).map((t) => t.desc))].join(' ');
    for (const p of PH) if (txt.includes(p)) out.c6.push(qid + ':' + p);
    if (/旧识[^，。]{0,4}(掌柜|当差|相)/.test(txt)) out.c6.push(qid + ':半截模板');
  }
  return out;
}

const clone = (o) => JSON.parse(JSON.stringify(o));
const base = audit(DATA);

/* ============================================================
 *  一 · 真数据：六条护栏必须全零
 * ============================================================ */
sec('① 玩家可见文本：模板变量/占位痕迹（真数据）');
ok('无模板痕迹（' + Object.keys(DATA.map.rooms).length + ' 房间 + ' + Object.keys(DATA.npc.npcs).length + ' NPC + ' + Object.keys(DATA.quest.quests).length + ' 任务 + tutorial）', base.c1.length === 0, base.c1.slice(0, 5).join(','));
ok('样本量非空（否则该断言恒真）', Object.keys(DATA.map.rooms).length > 250 && Object.keys(DATA.npc.npcs).length > 250 && Object.keys(DATA.quest.quests).length > 250);

sec('② 任务 target 引用合法');
ok('无 target 指向 NPC id / 无悬空 item·room', base.c2.length === 0, base.c2.slice(0, 5).join(','));
{
  let total = 0; for (const q of Object.values(DATA.quest.quests)) for (const s of (q.stages || [])) for (const t of (s.targets || [])) total++;
  ok('target 样本量非空', total >= 300, total + ' 个 target');
}

sec('③ 除害型任务目标房必须在野外/街巷/山道');
{
  let pestCount = 0;
  for (const q of Object.values(DATA.quest.quests)) { const txt = [q.desc, ...(q.stages || []).map((s) => s.desc)].join(' '); if (/野兽|害兽|闹兽|猛兽|作乱|畜生/.test(txt)) pestCount++; }
  ok('除害型样本非空（该断言不恒真）', pestCount >= 10, pestCount + ' 条');
  ok('除害型目标房无室内（青楼/客栈/私宅…）', base.c3.length === 0, base.c3.slice(0, 6).join(' | '));
}

sec('④ 出家人差事身份自洽');
{
  const monkQ = Object.keys(DATA.quest.quests).filter((qid) => /^sq_/.test(qid) && DATA.npc.npcs[qid.replace(/^sq_/, '')] && ['monk', 'nun', 'taoist'].includes(DATA.npc.npcs[qid.replace(/^sq_/, '')].tag));
  ok('出家人侧线样本非空', monkQ.length > 0, monkQ.length + ' 条');
  ok('出家人侧线文案无家眷/家室', base.c4.length === 0, base.c4.join(','));
}

sec('⑤ 侧线点名之人 ∈ giver.rel（全部 sq_*，含具名）');
{
  const sqCount = Object.keys(DATA.quest.quests).filter((q) => /^sq_/.test(q)).length;
  ok('sq_* 样本非空', sqCount > 250, sqCount + ' 条');
  ok('无越界点名', base.c5.length === 0, base.c5.slice(0, 6).join(','));
}

sec('⑥ 占位词 / 半截模板清零');
ok('无「城里的旧相识 / 铺子里的掌柜 / 衙门口当差的」', base.c6.length === 0, base.c6.slice(0, 6).join(','));

/* ============================================================
 *  二 · 真引擎：把任务文本走一遍真实指令路径，再查一遍痕迹
 * ============================================================ */
sec('⑦ 真引擎路径（boot + spawn + 真指令），文本同样不得有痕迹');
{
  const e = new GameEngine({ seed: 20261010 }); e.boot();
  e.newGame({ name: '验文本', gender: 'male', birth: 'wuxue' });
  const w = e.world, p = w.player;
  const run = (cmd) => e.cmds.execute(normalizeCmd(cmd), { player: p, world: w, engine: e }) || { lines: [] };
  const txt = (r) => (r.lines || []).map((l) => l.text || '').join('\n');
  /* 挑 6 个「有侧线」的 giver：抽其中 3 个出家人 + 3 个常人。
     判据：该 NPC 的 quests 数组里至少有一条 id 真实存在于任务表（= 真能接到的侧线）。 */
  const hasSide = (id) => Array.isArray(w.data.npcs[id].quests) && w.data.npcs[id].quests.some((x) => w.data.quests[x]);
  const givers = Object.keys(w.data.npcs).filter(hasSide);
  const isMonk = (id) => ['monk', 'nun', 'taoist'].includes(w.data.npcs[id].tag);
  const monk = givers.filter(isMonk).slice(0, 3);
  const norm = givers.filter((id) => !isMonk(id)).slice(0, 3);
  const pick = monk.concat(norm);
  ok('能挑到有侧线的 giver（含出家人）', pick.length >= 4, pick.join(',') + ' | 侧线 giver 共 ' + givers.length + ' 人');
  let dumped = '';
  for (const id of pick) {
    const def = w.data.npcs[id];
    if (!def.room || !w.getRoom(def.room)) continue;
    w.movePlayerTo(p, def.room);
    dumped += txt(run('look')) + '\n';
    dumped += txt(run('talk ' + def.name)) + '\n';
    dumped += txt(run('ask ' + def.name + ' 关于 近况')) + '\n';
  }
  dumped += txt(run('任务')) + '\n';
  const hits = ['${', '{{', 'undefined', 'NaN', '[object', '.registry', '%s'].filter((x) => dumped.includes(x));
  ok('真引擎渲染文本无模板痕迹', hits.length === 0 && dumped.length > 0, hits.join(',') || ('输出 ' + dumped.length + ' 字节'));
  /* 任务面板真能看到 desc（证明"玩家可见"不是想当然） */
  const panel = txt(run('任务'));
  ok('「任务」面板有输出（真看到任务区）', panel.length > 10, panel.length + ' 字节');
}

/* ============================================================
 *  三 · 变异自证：每条护栏先注入缺陷 → 必须转红；真数据 → 全绿
 * ============================================================ */
sec('⑧ 变异自证（每类注入缺陷，确认护栏真能抓到）');
function mutate(name, fn, expectKey) {
  const D = clone(DATA);
  fn(D);
  const a = audit(D);
  const caught = a[expectKey].length > 0;
  ok('变异 ' + name + ' → ' + expectKey + ' 转红', caught, caught ? a[expectKey][0] : '（未抓到，护栏形同虚设）');
}
mutate('room.desc 混入 ${name}', (D) => { D.map.rooms.jiangnan_gate.desc = '城门上刻着 ${name}。'; }, 'c1');
mutate('quest.desc 混入 {客官}', (D) => { D.quest.quests.q_beggar_help.desc = '小叫花说{客官}快去看看。'; }, 'c1');
mutate('npc.talk 混入 undefined', (D) => { D.npc.npcs.master_yue.talk[0] = 'undefined 了。'; }, 'c1');
mutate('target.key 指向 NPC id（人名当药名）', (D) => { D.quest.quests.sq_wen_jiangnan.stages[0].targets[0].key = 'npcv_001'; }, 'c2');
mutate('item target 指向不存在的物品', (D) => { D.quest.quests.q_herb_collect.stages[0].targets[0].key = 'no_such_herb'; }, 'c2');
mutate('除害型目标改回醉春楼·后厨', (D) => { D.quest.quests.sq_npcv_003.stages[0].targets[0].key = 'jn_brothel_kitchen'; }, 'c3');
mutate('出家人侧线写回「家里有人病了」', (D) => { D.quest.quests.sq_shaolin_fangzheng.desc = '方证大师家里有人病了，缺一味药。'; }, 'c4');
mutate('sq_npcv desc 塞入 rel 外的人名（岳不群）', (D) => { D.quest.quests.sq_npcv_003.desc = D.quest.quests.sq_npcv_003.desc + '岳不群也在。'; }, 'c5');
mutate('寻人类写回占位词「铺子里的掌柜」', (D) => { D.quest.quests.sq_npcv_110.desc = '云秋托你寻一位旧识铺子里的掌柜。'; }, 'c6');

/* 反向：确认「未变异」时同一批检查确实为 0（否则变异抓到也不算数） */
sec('⑨ 反向自证（未变异时对应检查为零 → 证明不是恒红）');
ok('c1 未变异为 0', base.c1.length === 0);
ok('c2 未变异为 0', base.c2.length === 0);
ok('c3 未变异为 0', base.c3.length === 0);
ok('c4 未变异为 0', base.c4.length === 0);
ok('c5 未变异为 0', base.c5.length === 0);
ok('c6 未变异为 0', base.c6.length === 0);
/* 白名单保鲜：基线里「kill 型缺 key」的那 3 条必须确实还缺 key，否则该删白名单 */
{
  const stale = ['q_huashan_sword_test', 'q_emei_entry', 'q_bounty_bandit'].filter((qid) => {
    const t0 = DATA.quest.quests[qid] && DATA.quest.quests[qid].stages[0].targets[0];
    return t0 && t0.key !== undefined && t0.key !== null && t0.key !== '';
  });
  ok('缺 key 白名单未过期（' + (3 - stale.length) + '/3 条仍缺 key）', stale.length === 0, stale.join(','));
}

console.log('\n' + '='.repeat(50));
console.log('  任务文本护栏：通过 ' + pass + ' 项，失败 ' + fail + ' 项');
if (fail) { console.log('  失败清单：'); fails.forEach((f) => console.log('   ✘ ' + f)); }
console.log('='.repeat(50));
process.exit(fail ? 1 : 0);
