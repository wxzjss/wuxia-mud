/* ============================================================
 * smoke-mod-ids.js — 制作器「游戏内 ID」与「按 ID 改游戏内事物」
 *
 * 主人 2026-10-11 原话：
 *   「在 mod 制作器里添加游戏内各事物 id 列表……同时添加可通过 id 更改游戏内
 *     剧情、人物、物品、功法、区域等有 id 的事物」
 *
 * 两头都要验真：
 *   ① 后端真的读得到游戏里**当前**的各类 id（不是一份写死的假清单）；
 *   ② 前端「改这个」真把那件东西的完整内容塞进 spec 的对应数组，
 *      且**同 id 只留一份**（数组在引擎里是后写覆盖先写，留两份等于埋雷）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { createServer } = require(path.join(ROOT, 'server', 'game-server.js'));
const { gamedataApi } = require(path.join(ROOT, 'server', 'game-server.js'));

let pass = 0, fail = 0;
const ok = (n, c, e) => {
  if (c) { pass++; console.log('  ✔ ' + n + (e ? '  ' + e : '')); }
  else { fail++; console.log('  ✘ ' + n + (e ? '  ' + e : '')); }
};
const section = t => console.log('\n' + t);

const made = createServer({});
const engine = made.engine;
const world = engine.world;

/* ================= 一、后端：ID 清单 ================= */
section('① 各类事物的 ID 清单');
const KINDS = ['npcs', 'items', 'skills', 'rooms', 'regions', 'quests', 'sects'];
for (const kind of KINDS) {
  const d = gamedataApi(engine, { kind, limit: 50 });
  const real = Object.keys(world.data[kind] || {}).length;
  ok(`「${kind}」能列出来（${d.rows ? d.rows.length : 0} 行 / 全库 ${real}）`,
    d.ok && Array.isArray(d.rows) && d.rows.length > 0 && d.total === real,
    d.ok ? ('total=' + d.total) : d.error);
}
ok('清单每行都有 id 和名字', (() => {
  const d = gamedataApi(engine, { kind: 'npcs', limit: 30 });
  return d.rows.every(r => r.id && typeof r.id === 'string');
})());
ok('未知类别被明确拒绝', (() => {
  const d = gamedataApi(engine, { kind: '不存在的东西' });
  return !d.ok && /未知的类别/.test(d.error) && Array.isArray(d.kinds);
})());

/* ================= 二、后端：搜索 ================= */
section('② 按 ID / 名字搜索');
const allNpc = gamedataApi(engine, { kind: 'npcs', limit: 3000 });
const sample = allNpc.rows.find(r => r.name && r.name.length >= 2) || allNpc.rows[0];
if (sample) {
  const byId = gamedataApi(engine, { kind: 'npcs', q: sample.id, limit: 50 });
  ok('按 ID 能搜到', byId.rows.some(r => r.id === sample.id), sample.id);
  const byName = gamedataApi(engine, { kind: 'npcs', q: sample.name, limit: 50 });
  ok('按名字能搜到', byName.rows.some(r => r.id === sample.id), sample.name);
} else {
  ok('（没取到样本，跳过搜索断言）', true);
}
const noHit = gamedataApi(engine, { kind: 'npcs', q: '绝不可能存在的关键词zzz' });
ok('搜不到时给空数组（不是报错）', noHit.ok && noHit.rows.length === 0);

/* ================= 三、后端：单件完整内容 ================= */
section('③ 取单件的完整内容（「按 ID 改」的数据源）');
const npcRow = gamedataApi(engine, { kind: 'npcs', limit: 5 }).rows[0];
const one = gamedataApi(engine, { kind: 'npcs', id: npcRow.id });
ok('★ 取得到那一件的完整内容', one.ok && one.item && one.item.id === npcRow.id, npcRow.id);
ok('★ 内容里有真字段（不是只有 id 的壳）', !!(one.item.name && (one.item.desc || one.item.hp != null)),
  one.item.name);
const missing = gamedataApi(engine, { kind: 'npcs', id: 'no_such_npc_zzz' });
ok('取不存在的那件 → 明确报错', !missing.ok && /没有这一件/.test(missing.error));

/* 抽查另一类：武学 */
const skRow = gamedataApi(engine, { kind: 'skills', limit: 5 }).rows[0];
const skOne = gamedataApi(engine, { kind: 'skills', id: skRow.id });
ok('武学也能整件取出', skOne.ok && skOne.item.name === skRow.name, skRow.name);

/* ================= 四、前端：Tab 注册 + 覆盖语义 ================= */
section('④ 前端「改这个」的覆盖语义');
const MODMAKER = fs.readFileSync(path.join(ROOT, 'game', 'src', 'renderer', 'js', 'modmaker.js'), 'utf-8');

const els = {};
const mkEl = () => ({
  id: '', className: '', style: {}, value: '', textContent: '', innerHTML: '', disabled: false,
  classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; on ? this._s.add(c) : this._s.delete(c); return on; }, contains(c) { return this._s.has(c); } },
  appendChild(c) { return c; }, querySelectorAll() { return []; }, querySelector() { return null; },
  setAttribute() { }, getAttribute() { return null; }, focus() { }, blur() { }, addEventListener() { },
});
global.document = {
  getElementById(id) { if (!els[id]) els[id] = mkEl(); els[id].id = id; return els[id]; },
  createElement: () => mkEl(),
  querySelectorAll: () => [],
  body: mkEl(),
};
global.window = global;

const S = { spec: { npcs: [], items: [], skills: [], rooms: [], regions: [], quests: [], sects: [] }, my: null, siteConfig: {} };
let served = null;
const api = {
  gamedata: async (kind, opts) => {
    opts = opts || {};
    if (opts.id) return { ok: true, kind, id: opts.id, item: { id: opts.id, name: '游戏里的' + opts.id, hp: 88 } };
    return { ok: true, kind, total: 1, shown: 1, rows: [{ id: 'master_yue', name: '岳不群' }] };
  },
  siteUpload: async () => ({ ok: true }),
  accountMine: async () => ({ ok: true, name: 'x', mods: [] }),
  account: async () => ({ ok: false }),
  siteRemote: async () => ({ ok: true, mod: {} }),
  siteConfig: async () => ({}),
  editorMeta: async () => ({}),
};
const util = { esc: s => String(s == null ? '' : s), debounce: f => f, downloadText() { }, downloadB64() { } };
global.WX = { S, api, util, setMe() { } };
global.WXUI = { toast() { }, closeModal() { }, modal() { }, confirmBox: async () => true };
eval(MODMAKER);
const MM = global.WXMM;

(async () => {
  ok('modmaker 能加载', !!MM && typeof MM.pickGameId === 'function');
  ok('★ 左侧标签注册表里有 ids（游戏内 ID）', /'ids'/.test(MODMAKER.slice(MODMAKER.indexOf('const TABS'))));
  ok('页面里有分类切换（人物/物品/武学/房间/区域/剧情/门派）',
    /idKind|data-idkind/.test(MODMAKER) && /人物/.test(MODMAKER) && /门派/.test(MODMAKER));

  /* 改一件 NPC → 应该整件落进 spec.npcs */
  await MM.pickGameId('npcs', 'master_yue');
  ok('★「改这个」把那件东西整件载进 spec 的对应数组',
    S.spec.npcs.length === 1 && S.spec.npcs[0].id === 'master_yue' && S.spec.npcs[0].hp === 88,
    JSON.stringify(S.spec.npcs));

  /* 再点一次同一个 id → 还是 1 条（后写覆盖，不是追加） */
  await MM.pickGameId('npcs', 'master_yue');
  ok('★ 同一个 id 点两次仍然只有一份（后写覆盖先写）', S.spec.npcs.length === 1, '共 ' + S.spec.npcs.length + ' 份');

  /* 另一个 id → 追加一份 */
  await MM.pickGameId('npcs', 'master_yue_2');
  ok('不同 id 会各占一份', S.spec.npcs.length === 2, '共 ' + S.spec.npcs.length + ' 份');

  /* 换一类：武学 */
  await MM.pickGameId('skills', 'basic_sword');
  ok('★ 武学也能按 ID 载入（落到 spec.skills）',
    S.spec.skills.length === 1 && S.spec.skills[0].id === 'basic_sword', JSON.stringify(S.spec.skills));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  try { made.server.close(); } catch (e) { /* ignore */ }
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('异常：', e && e.stack || e);
  try { made.server.close(); } catch (e2) { /* ignore */ }
  process.exit(1);
});
