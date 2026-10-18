#!/usr/bin/env node
/**
 * sect-batch114-accept.js —— 「29 句入门戏 + 35 条门派差事 + 每日巡山」批次验收探针
 *
 * 派单：team-lead 2026-10-17（D 裁定：达标玩家由引擎自动构造，可自测）；
 * 数据批次：design/114（游有方施工中，本探针可先落盘、不跑）。
 *
 * 三组判据（与 team-lead 预登记的 A/B/C 表一一对应）：
 *   ① 入门戏   A1 通用句清零且 29 句两两不同 · A2 仍真 joinSect · A4 文风铁律（无破折号/有短句）
 *   ② 门派差事 B1 逐派 接→推→交 全链真走 · B2 quest 挂在 giver.def.quests · B3 不许 BARE · B4 完成给贡献
 *   ③ 每日巡山 C  可重复、有冷却、贡献入账
 *
 * ⚠️ 「达标玩家」由本脚本按 `data.sects[*].require` 自动构造（语料表见 SELFTEST 段），
 *    构造后必须 `evalCond(require)` 通过才算数；构不出来 = 探针缺陷（红），不是数据缺陷。
 *
 * 用法：
 *   node tools/sect-batch114-accept.js --selftest         # 判定器/构造器自测（不需要数据）
 *   node tools/sect-batch114-accept.js --dry              # 只看"本批能验什么"（数据未落地也不红）
 *   node tools/sect-batch114-accept.js                    # 正式验收（数据落完再跑；缺数据即红）
 *   node tools/sect-batch114-accept.js --tsv <路径>
 *
 * 文件以 `-accept.js` 命名（不是 `*-check.js`）：**不自动进回归套件**——数据未落地时它必然红，
 *   不该在别人发版窗口里制造噪音。要转常驻守卫，改成 `sect-batch114-check.js` 并删掉 --dry 分支即可。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));
const { evalCond } = require(path.join(ROOT, 'game', 'src', 'core', 'modapi.js'));
const arr = (x) => (Array.isArray(x) ? x : x && typeof x === 'object' ? Object.values(x) : []);
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? process.argv[i + 1] : ''; };

const UNIVERSAL_LINE = '山门里走出一个人，上下打量了你两眼。';

/* ---------------- 达标玩家构造器（可自测） ---------------- */

/**
 * 按 require 把一个新玩家调到"够格"。
 * 支持的键（= 数据里实际在用的形态，取自 43 派 require 实测）：
 *   gender / race / karma / level / attr + 运算符(>= > <= < ==) / 空对象
 * @returns {{ok:boolean, why?:string}}
 */
function makeEligible(w, p, require) {
  const req = require || {};
  const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, '')));
  try {
    for (const [k, v] of Object.entries(req)) {
      if (k === 'gender') p.gender = v;
      else if (k === 'race') p.race = v;
      else if (k === 'karma') {
        const need = num(v);
        p.karma = /<=/.test(String(v)) ? Math.min(p.karma || 0, need) : Math.max(p.karma || 0, need);
      } else if (k === 'level') {
        p.level = Math.max(p.level || 1, num(v));
      } else if (k === 'attr') {
        const name = v;
        const opKey = Object.keys(req).find((x) => /^(>=|>|<=|<|==)$/.test(x));
        const need = opKey ? num(req[opKey]) : 10;
        p.attr = p.attr || {};
        p.baseAttr = p.baseAttr || {};
        p.attr[name] = Math.max(p.attr[name] || 0, need);
        p.baseAttr[name] = Math.max(p.baseAttr[name] || 0, need);
        /* 运算符键本身不消费（它是 attr 的修饰），循环里会走到但无副作用 */
      }
    }
  } catch (e) {
    return { ok: false, why: '构造抛错：' + e.message };
  }
  const pass = evalCond(req, { player: p, world: w });
  return pass ? { ok: true } : { ok: false, why: '构造后 evalCond 仍不过：' + JSON.stringify(req) };
}

/* ---------------- A2：本门独有物象词表（QA 人工判定，2026-10-17） ----------------
 * 判据来源：72_sects_tier 的 story/desc + 本门武学 + 本门房名。每派给 2~4 个"只有这家才有"的词，
 * 入门戏 narrate 命中 ≥1 即算 A2 过。词表是**人工判定表**（不是从文案反推），
 * 所以它验的是"这句有没有写本门"，不是"这句和别派是否不同"（后者由 A1 两两比对负责）。
 * weak：该派最标志性的东西没被写进去（仍判过，但单列观感建议）。
 */
const SECT_MARK = {
  taishan: { mark: ['石阶', '松'], weak: '故事里的「松树」没写，写的是十八盘石阶' },
  hengshan: { mark: ['琴'], weak: '衡山的看家本事是琴，这句只写擦剑' },
  hengshanN: { mark: ['女弟子', '药箱'], weak: '' },
  qingcheng: { mark: ['雾'], weak: '' },
  kongtong: { mark: ['七伤'], weak: '' },
  kunlun: { mark: ['风沙', '两剑', '裹'], weak: '' },
  diancang: { mark: ['石子', '叶'], weak: '' },
  tiezhang: { mark: ['石锁', '掌'], weak: '' },
  hehuan: { mark: ['帘', '笑'], weak: '' },
  jindao: { mark: ['刀'], weak: '' },
  wuhu: { mark: ['五个', '一边'], weak: '' },
  feihu: { mark: ['镖师', '箱'], weak: '' },
  zhenyuan: { mark: ['镖旗', '镖师'], weak: '' },
  shenquan: { mark: ['拳'], weak: '' },
  tieqiang: { mark: ['枪'], weak: '' },
  kuaidao: { mark: ['刀', '桩'], weak: '' },
  luohan: { mark: ['木桩', '拳'], weak: '' },
  wuyun: { mark: ['核桃', '门房'], weak: '温家是皮货兼使毒的家门，这句只写了看门人' },
  dafeng: { mark: ['风', '天'], weak: '' },
  huanghe: { mark: ['船', '跳板'], weak: '' },
  taihu: { mark: ['船', '网', '水'], weak: '' },
  poyang: { mark: ['湖', '旗'], weak: '' },
  qingzhu: { mark: ['竹'], weak: '' },
  jujing: { mark: ['鞋底', '汉子'], weak: '' },
  jinlong: { mark: ['门槛', '油'], weak: '' },
  wuliang: { mark: ['剑声', '剑'], weak: '' },
  funiu: { mark: ['牛'], weak: '' },
  baisheng: { mark: ['肩', '桩'], weak: '' },
  baituo: { mark: ['毡', '风'], weak: '' },
};

/* ---------------- 拒绝文案判定器（可自测） ---------------- */

/**
 * 判定一条"拒绝入门"的文案是否合格。
 * 坏文案样本（现树实测）：「桃花岛不收你：>= 需 18（你 0）。」
 *   → 原始运算符 `>=` / 键名 `attr` / `undefined` / `NaN` 都是代码泄漏；
 *   → 且必须点出卡在哪一项（中文名：性别 / 侠名 / 悟性 / 根骨 / 力量 / 身法 / 定力 / 福缘 / 资质 / 等级 / 族）。
 * @returns {{ok:boolean, why:string}}
 */
const GATE_WORDS = ['女儿身', '男儿身', '侠名', '悟性', '根骨', '力量', '身法', '定力', '福缘', '资质',
  '修为', '等级', '内力', '族', '声望'];
function judgeRefusal(text) {
  const t = String(text || '');
  const leaks = [];
  if (/(>=|<=|==|!=)/.test(t)) leaks.push('原始运算符');
  if (/\battr\b|\bgender\b|\bkarma\b|\brace\b|\blevel\b/.test(t)) leaks.push('英文字段名');
  if (/undefined|NaN|null|\[object/.test(t)) leaks.push('JS 值泄漏');
  if (/需\s*需|收你：\s*$/.test(t)) leaks.push('模板空转');
  if (leaks.length) return { ok: false, why: leaks.join('/') + '：' + t.slice(0, 40) };
  if (!GATE_WORDS.some((w) => t.indexOf(w) >= 0)) return { ok: false, why: '未点出卡在哪一项：' + t.slice(0, 40) };
  return { ok: true, why: t.slice(0, 40) };
}

/**
 * 把一个玩家调到"明确不达标"（用于逼出拒绝文案）。
 * @returns {{ok:boolean, why?:string}} ok=false 表示构不出不达标样本（探针缺陷）
 */
function makeIneligible(w, p, require) {
  const req = require || {};
  const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace(/[^\d.-]/g, '')));
  try {
    for (const [k, v] of Object.entries(req)) {
      if (k === 'gender') p.gender = (v === 'female' ? 'male' : 'female');
      else if (k === 'race') p.race = 'not-' + String(v);
      else if (k === 'karma') p.karma = /<=/.test(String(v)) ? num(v) + 20 : Math.min(0, num(v) - 20);
      else if (k === 'level') p.level = 1;
      else if (k === 'attr') {
        const opKey = Object.keys(req).find((x) => /^(>=|>|<=|<|==)$/.test(x));
        const need = opKey ? num(req[opKey]) : 10;
        p.attr = p.attr || {}; p.baseAttr = p.baseAttr || {};
        p.attr[v] = Math.max(0, need - 5);
        p.baseAttr[v] = Math.max(0, need - 5);
      }
    }
  } catch (e) { return { ok: false, why: '构造抛错：' + e.message }; }
  const stillPass = evalCond(req, { player: p, world: w });
  if (stillPass) return { ok: false, why: '没能造出不达标样本（构造器不合格）：' + JSON.stringify(req) };
  return { ok: true };
}

/* ---------------- 自测：语料表驱动 ---------------- */
function selftest() {
  let pass = 0, fail = 0;
  const ok = (n, c, got) => { if (c) { pass++; console.log('  ✔ ' + n); } else { fail++; console.log('  ✘ ' + n + '  « 实际: ' + JSON.stringify(got)); } };
  const w = { getSkill: () => null };

  const cases = [
    { name: '空 require（丐帮/苗疆/合欢）', req: {}, build: (p) => p, expect: true },
    { name: 'gender female（峨眉/古墓）', req: { gender: 'female' }, build: (p) => { p.gender = 'female'; }, expect: true },
    { name: 'gender male + karma>=0（少林）', req: { gender: 'male', karma: '>=0' }, build: (p) => { p.gender = 'male'; p.karma = 0; }, expect: true },
    { name: 'karma>=20（大理）', req: { karma: '>=20' }, build: (p) => { p.karma = 20; }, expect: true },
    { name: 'karma<=50（摩教）', req: { karma: '<=50' }, build: (p) => { p.karma = 0; }, expect: true },
    { name: 'race human（唐门）', req: { race: 'human' }, build: (p) => { p.race = 'human'; }, expect: true },
    { name: 'attr 悟性 >=18（桃花岛）', req: { attr: '悟性', '>=': 18 }, build: (p) => { p.attr = { 悟性: 18 }; p.baseAttr = { 悟性: 18 }; p.attrTotal = () => 18; }, expect: true },
    { name: 'level>=30（侠客岛）', req: { level: '>=30' }, build: (p) => { p.level = 30; }, expect: true },
    { name: '不达标样本：悟性 10 对 >=18 应判 false', req: { attr: '悟性', '>=': 18 }, build: (p) => { p.attr = { 悟性: 10 }; p.baseAttr = { 悟性: 10 }; p.attrTotal = () => 10; }, expect: false },
  ];

  for (const c of cases) {
    const p = { gender: 'male', race: 'human', karma: 0, level: 1, attr: {}, baseAttr: {}, attrTotal(name) { return (this.attr || {})[name] || 0; } };
    c.build(p);
    /* evalCond 需要 world；用最小桩 */
    const got = (() => { try { return !!evalCond(c.req, { player: p, world: w }); } catch (e) { return 'ERR:' + e.message; } })();
    ok('语料表：' + c.name + ' → ' + c.expect, got === c.expect, got);
  }

  /* 构造器自测：给它一个不够格的玩家，构造后必须过 */
  for (const c of cases.filter((x) => x.expect)) {
    const p = { gender: 'male', race: 'human', karma: 0, level: 1, attr: {}, baseAttr: {}, attrTotal(name) { return (this.attr || {})[name] || 0; } };
    const r = makeEligible(w, p, c.req);
    ok('构造器：' + c.name + ' → ok', r.ok === true, r);
  }

  /* 拒绝文案判定器：坏样本必须红、好样本必须绿（数据里两种都取真实原文） */
  const refusals = [
    { name: '现树坏样本（桃花岛）', text: '桃花岛不收你：>= 需 18（你 0）。', expect: false },
    { name: '现树坏样本（铁掌帮）', text: '铁掌帮不收你：>= 需 16（你 0）。', expect: false },
    { name: 'JS 值泄漏', text: '某派不收你：要 undefined（你 NaN）。', expect: false },
    { name: '模板空转', text: '某派不收你：需 需 12。', expect: false },
    { name: '好样本（峨眉性别）', text: '峨眉派不收你：本门只收女儿身。', expect: true },
    { name: '好样本（karma）', text: '大理段氏不收你：要侠名 20（你 0）——多行善事、少结仇，名声是攒出来的。', expect: true },
    { name: '好样本（属性）', text: '桃花岛不收你：要悟性 18（你 6）——读书、访名师、住得好些都能养。', expect: true },
    { name: '好样本（修为，别漏这类合法词）', text: '侠客岛不收你：要修为 30（你 1）。', expect: true },
  ];
  for (const c of refusals) {
    const r = judgeRefusal(c.text);
    ok('拒绝文案：' + c.name + ' → ' + (c.expect ? '合格' : '判坏'), r.ok === c.expect, r);
  }

  console.log('\n自测 ' + pass + '/' + (pass + fail) + ' 通过');
  return fail === 0;
}

if (process.argv.includes('--selftest')) process.exit(selftest() ? 0 : 1);

/* ---------------- 主流程 ---------------- */
const DRY = process.argv.includes('--dry');
console.log('⓪ 判定器自测');
if (!selftest()) { console.error('自测未过，终止。'); process.exit(1); }

(async () => {
  const e = new GameEngine({ seed: 7 });
  await e.boot({});
  await e.newGame({ name: '验收探', gender: 'male' });
  const w = e.world;
  const entry = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/41_sect_entry.json'), 'utf8')).sects;

  /* 本批范围：本轮 29 家（二流 9 + 三流 20），由 team-lead 名单确定 */
  const BATCH29 = ['taishan', 'hengshan', 'hengshanN', 'qingcheng', 'kongtong', 'kunlun', 'diancang', 'tiezhang', 'hehuan',
    'jindao', 'wuhu', 'feihu', 'zhenyuan', 'shenquan', 'tieqiang', 'kuaidao', 'luohan', 'wuyun', 'dafeng', 'huanghe',
    'taihu', 'poyang', 'qingzhu', 'jujing', 'jinlong', 'wuliang', 'funiu', 'baisheng', 'baituo'];
  const BATCH35 = Object.keys(entry).filter((id) => !['huashan', 'shaolin', 'wudang', 'emei', 'gaibang', 'miaojiang', 'dali', 'taohua'].includes(id));

  const rows = [];
  const push = (group, sect, item, pass, detail) => rows.push({ group, sect, item, pass: pass ? '✔' : '✘', detail });

  /* ---------- ① 入门戏 ---------- */
  const storyOf = {};
  for (const id of BATCH29) {
    const sd = w.getSect(id);
    if (!sd) { push('①入门戏', id, '门派定义', false, 'data.sects 无此条目'); continue; }
    const p = w.player;
    p.sect = null; p.rank = 0; p.karma = 0;
    p.room = (entry[id] && entry[id].entry) || '';
    try { w.npcsIncludingTemplates(p.room); } catch (_) { /* 生成失败不致命 */ }
    const el = makeEligible(w, p, sd.require);
    if (!el.ok) { push('①入门戏', id, '达标玩家构造', false, el.why); continue; }
    let r; try { r = await e.exec('拜师 ' + sd.name); } catch (err) { r = { lines: [{ text: '抛错:' + err.message }] }; }
    const lines = (r && r.lines) || [];
    const story = lines.filter((l) => l.kind === 'story' || l.kind === 'narrate').map((l) => l.text || '').filter(Boolean).join(' ');
    const joined = p.sect === id;
    push('①入门戏', id, 'A2 仍真 joinSect', joined, joined ? 'p.sect=' + p.sect : '未入门');
    push('①入门戏', id, 'A1 非通用句', !!story && story.indexOf(UNIVERSAL_LINE) < 0, story.slice(0, 40) || '（无 narrate）');
    push('①入门戏', id, 'A4 无破折号', !/——|—/.test(story), story.slice(0, 30));
    push('①入门戏', id, 'A4b 有短句(≤6字)', /[^，。；、「」]{1,6}[，。；]/.test(story), story.slice(0, 20));
    /* A2：本门独有物象（人工词表，见 SECT_MARK） */
    {
      const spec = SECT_MARK[id] || { mark: [], weak: '' };
      const hit = spec.mark.filter((w) => story.indexOf(w) >= 0);
      push('①入门戏', id, 'A2 本门独有物象', hit.length > 0, hit.length ? ('命中 ' + hit.join('、')) : ('未命中（词表 ' + spec.mark.join('、') + '）: ' + story.slice(0, 30)));
      if (spec.weak) push('①入门戏', id, 'A2w 观感：弱项', true, spec.weak);
    }
    storyOf[id] = story;
    p.sect = null;
  }
  const stories = Object.values(storyOf).filter(Boolean);
  const dupPairs = [];
  for (let i = 0; i < stories.length; i++) for (let j = i + 1; j < stories.length; j++) if (stories[i] === stories[j]) dupPairs.push(i + '-' + j);
  push('①入门戏', '(全部)', 'A1 29 句两两不同', dupPairs.length === 0, dupPairs.length ? '重复对 ' + dupPairs.join(',') : '唯一');

  /* ---------- ② 门派差事 ---------- */
  /* 归属判据：优先 quest.require.sect（114 批的实际写法），退路用 id 里的门派名 */
  const sectOfQuest = (q) => (q && q.require && q.require.sect) || (/^q_sect_(.+?)_errand$/.exec(q && q.id) || [])[1] || '';
  const allQuests = arr(w.data.quests);
  for (const id of BATCH35) {
    const mine = allQuests.filter((q) => q && q.id && q.id.indexOf('_errand') >= 0 && sectOfQuest(q) === id);
    if (!mine.length) { push('②门派差事', id, 'B0 有差事', false, DRY ? '未落地' : '无 q_sect_*_errand'); continue; }
    for (const q of mine) {
      /* B2 发放人接线 */
      const giver = w.data.npcs && w.data.npcs[q.giver];
      const wired = !!(giver && ((giver.quests || []).includes(q.id) || giver.sidequest === q.id));
      push('②门派差事', id, 'B2 ' + q.id + ' 发放人接线', wired, giver ? (giver.name + '@' + giver.room) : 'giver 不存在');
      /* B2b 发放人是否打了本门标签（聚合查询要靠它；缺标签不算阻断，但要点名） */
      push('②门派差事', id, 'B2b ' + q.id + ' 发放人有本门标签', !!(giver && giver.sect === id), giver ? ('giver.sect=' + (giver.sect || 'undefined')) : 'giver 不存在');
      /* B3 回响 */
      const hasSay = arr(q.rewards).some((x) => x && (x.type === 'say' || x.type === 'narrate') && x.raw);
      push('②门派差事', id, 'B3 ' + q.id + ' 完成有台词', hasSay, hasSay ? '有' : 'BARE');
      /* B1 全链：入门 → 起任务（UI 由 B2 覆盖）→ 达成目标 → 到 giver 房「交差」 */
      const p = w.player;
      p.sect = null; p.rank = 0; p.karma = 0;
      const el = makeEligible(w, p, w.getSect(id) && w.getSect(id).require);
      if (!el.ok) { push('②门派差事', id, 'B1 ' + q.id, false, '构造失败：' + el.why); continue; }
      const jr = p.joinSect(id, { force: true });
      if (!jr.ok) { push('②门派差事', id, 'B1 ' + q.id, false, '入门失败：' + jr.msg); continue; }
      p.setQuestStage(q.id, 0);
      /* B1：逐段推进（支持多段任务）。
         ⚠️ 探针曾只满足第 0 段 → 两段任务永远差一步。修法在**探针**侧做循环，
            不是把数据改成一段——「为配合量具改被测物」会造出假通过。 */
      const stages = arr(q.stages);
      const contribBefore = p.sectContribution || 0;
      let stageNow = p.questStage(q.id);
      let steps = 0;
      while (stageNow >= 0 && stageNow < 99 && steps < 8) {
        steps++;
        const st = stages[stageNow] || {};
        for (const t of arr(st.targets)) {
          if (!t) continue;
          if (t.kind === 'item') { try { w.giveItem(p, t.key, t.count || 1); } catch (err) { /* ignore */ } }
          else if (t.kind === 'flag') { p.setFlag(t.key, true); }
          else {
            if (t.kind === 'room' && t.key) { p.room = t.key; try { w.npcsIncludingTemplates(p.room); } catch (err) { /* ignore */ } }
            p.setVar(t.var || ('q_' + q.id + '_' + t.id), t.count || 1);
          }
        }
        /* 交差：站到 giver 房里发「交差」（引擎真实入口 report/交任务/交差） */
        if (giver && giver.room) { p.room = giver.room; try { w.npcsIncludingTemplates(p.room); } catch (err) { /* ignore */ } }
        let rep; try { rep = await e.exec('交差'); } catch (err) { rep = { lines: [{ text: '抛错:' + err.message }] }; }
        const next = p.questStage(q.id);
        if (next === stageNow) {
          push('②门派差事', id, 'B1 ' + q.id + ' 第 ' + stageNow + ' 段交不出去', false, ((rep.lines || []).map((l) => l.text || '').join(' ')).slice(0, 50));
          break;
        }
        stageNow = next;
      }
      const done = stageNow >= 99;
      push('②门派差事', id, 'B1 ' + q.id + ' 接→交（' + stages.length + ' 段）', done, done ? '已完成' : '未完成：停在 stage ' + stageNow);
      push('②门派差事', id, 'B4 ' + q.id + ' 给贡献', (p.sectContribution || 0) > contribBefore, '贡献 ' + contribBefore + '→' + (p.sectContribution || 0));
      p.sect = null;
    }
  }

  /* ---------- ③ 每日巡山（35 家：全库按 cond.sect 找，不只看 73 的 gate） ----------
     ⚠️ 我第一版只扫 73_sects_place，量出 29 条就报"29 家"——错在**扫描面**：
        另有 6 家的巡山挂在 66/50/88/65（摩教 mojiao_shanmen、唐门 tangmen_gate、古墓 gumu_mu、
        星宿 xiyu_xingxiu、血刀 beijiang_xuedao、侠客岛 xiake_neike）。全库扫是 35 条/35 家。 */
  const patrolBySect = {};
  for (const [rid, r] of Object.entries(w.data.rooms || {})) {
    for (const a of arr(r && r.actions)) {
      if (!/巡山/.test((a.label || '') + (a.cmd || ''))) continue;
      const sid = a.cond && a.cond.sect;
      if (sid) patrolBySect[sid] = { rid, cmd: a.cmd || '巡山', once: !!a.oncePerDay, msg: a.dayMsg || '' };
    }
  }
  for (const id of BATCH35) {
    const sd = w.getSect(id);
    if (!sd) { push('③每日巡山', id, 'C0 门派定义', false, '无门派定义'); continue; }
    const patrol = patrolBySect[id];
    push('③每日巡山', id, 'C0 有巡山动作', !!patrol, patrol ? (patrol.rid + ' · oncePerDay=' + patrol.once) : '全库无 cond.sect 命中的巡山');
    if (!patrol) continue;
    const p = w.player;
    p.sect = null; p.rank = 0; p.karma = 0; p.sectContribution = 0;
    const el = makeEligible(w, p, sd.require);
    if (!el.ok) { push('③每日巡山', id, 'C1 造达标玩家', false, el.why); continue; }
    p.joinSect(id, { force: true });
    p.room = patrol.rid;
    try { w.npcsIncludingTemplates(patrol.rid); } catch (err) { /* ignore */ }
    let r1; try { r1 = await e.exec(patrol.cmd); } catch (err) { r1 = { lines: [{ text: '抛错' }] }; }
    const c1 = p.sectContribution || 0;
    push('③每日巡山', id, 'C1 首次入账', c1 >= 5, '贡献 ' + c1 + ' | ' + ((r1.lines || []).map((l) => l.text || '').join(' ').slice(0, 30)));
    let r2; try { r2 = await e.exec(patrol.cmd); } catch (err) { r2 = { lines: [{ text: '抛错' }] }; }
    const c2 = p.sectContribution || 0;
    push('③每日巡山', id, 'C2 同日第二次被挡', c2 === c1, '贡献 ' + c1 + '→' + c2 + ' | ' + ((r2.lines || []).map((l) => l.text || '').join(' ').slice(0, 30)));
    /* C4 隔日可再巡：用 world.advanceTime(1440) 推进一天（与玩家真实过日同一条路径，
       不是手改 clockMinutes——手改只动一个数，会绕开换日时的其它结算） */
    const dayBefore = Math.floor((w.clockMinutes || 0) / 1440);
    try { w.advanceTime(1440); } catch (err) { /* ignore */ }
    const dayAfter = Math.floor((w.clockMinutes || 0) / 1440);
    let r3; try { r3 = await e.exec(patrol.cmd); } catch (err) { r3 = { lines: [{ text: '抛错' }] }; }
    const c3 = p.sectContribution || 0;
    push('③每日巡山', id, 'C4 隔日可再巡', dayAfter > dayBefore && c3 > c2, '第' + dayBefore + '→' + dayAfter + '天，贡献 ' + c2 + '→' + c3);
    p.sect = null;
  }
  /* C3 非本门不可做：拿第一家做一次越门探针 */
  {
    const a = BATCH29[0], b = BATCH29[1];
    const roomB = (entry[b] && entry[b].entry) || '';
    const p = w.player;
    p.sect = null; p.sectContribution = 0;
    const elA = makeEligible(w, p, w.getSect(a) && w.getSect(a).require);
    if (elA.ok && w.getSect(a)) {
      p.joinSect(a, { force: true });
      p.room = roomB;
      try { w.npcsIncludingTemplates(roomB); } catch (err) { /* ignore */ }
      const before = p.sectContribution || 0;
      let r; try { r = await e.exec('巡山'); } catch (err) { r = { lines: [{ text: '抛错' }] }; }
      const after = p.sectContribution || 0;
      push('③每日巡山', a + '→' + b, 'C3 非本门不可做', after === before, '贡献 ' + before + '→' + after + ' | ' + ((r.lines || []).map((l) => l.text || '').join(' ').slice(0, 30)));
    }
    p.sect = null;
  }

  /* ---------- ④ 拒绝入门文案（发版质量项；预期修完 0/8 坏） ---------- */
  const refusals = [];
  for (const id of Object.keys(entry)) {
    const sd = w.getSect(id);
    if (!sd || !sd.require || !Object.keys(sd.require).length) continue; /* 无门槛 = 没有拒绝文案可验 */
    const p = w.player;
    p.sect = null; p.rank = 0; p.karma = 0; p.level = 1; p.gender = 'male'; p.race = 'human';
    p.attr = {}; p.baseAttr = {};
    const inel = makeIneligible(w, p, sd.require);
    if (!inel.ok) { push('④拒绝文案', id, '造不达标样本', false, inel.why); continue; }
    let r;
    try { r = p.joinSect(id); } catch (err) { r = { ok: false, msg: '抛错:' + err.message }; }
    if (r.ok) { push('④拒绝文案', id, '应被拒却入门了', false, '不达标玩家被放进去了'); p.sect = null; continue; }
    const j = judgeRefusal(r.msg);
    push('④拒绝文案', id, '文案合格', j.ok, j.why);
    if (!j.ok) refusals.push(id + '：' + r.msg);
    p.sect = null;
  }
  push('④拒绝文案', '(合计)', '坏文案数为 0', refusals.length === 0, refusals.length ? refusals.length + ' 派坏：' + refusals.slice(0, 8).join(' ｜ ') : '全合格');

  /* ---------- 输出 ---------- */
  const head = ['# 114 批验收探针台账（' + (DRY ? 'DRY 预备模式' : '正式验收') + '）',
    '# 判据：①入门戏 A1/A2/A4 · ②门派差事 B1~B4 · ③巡山 C0',
    ['组', '门派', '项', '结果', '证据'].join('\t')].join('\n');
  const outPath = arg('tsv') ? path.resolve(ROOT, arg('tsv')) : path.join(ROOT, 'tools', '_out_sect_batch114.tsv');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, head + '\n' + rows.map((r) => [r.group, r.sect, r.item, r.pass, String(r.detail).replace(/[\t\n]/g, ' ')].join('\t')).join('\n') + '\n', 'utf8');

  const bad = rows.filter((r) => r.pass === '✘');
  const byGroup = {};
  for (const r of rows) {
    byGroup[r.group] = byGroup[r.group] || { n: 0, bad: 0 };
    byGroup[r.group].n++; if (r.pass === '✘') byGroup[r.group].bad++;
  }
  console.log('\n§1 结果：断言 ' + rows.length + ' 条 · 通过 ' + (rows.length - bad.length) + ' · 失败 ' + bad.length);
  Object.entries(byGroup).forEach(([g, v]) => console.log('   ' + g + '：' + (v.n - v.bad) + '/' + v.n));
  if (bad.length) {
    console.log('\n§2 失败明细（前 20）');
    bad.slice(0, 20).forEach((r) => console.log('   ✘ ' + r.group + ' | ' + r.sect + ' | ' + r.item + ' — ' + r.detail));
  }
  console.log('\n台账 → ' + path.relative(ROOT, outPath));
  if (DRY) { console.log('（DRY：只列本批能验什么，不做红判定）'); process.exit(0); }
  process.exit(bad.length ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(2); });
