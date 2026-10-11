/* ============================================================
 * check-data-load.js —— 数据能否被「真的加载进来」守卫
 *
 * 缘起（2026-10-11 实测踩坑）：
 *   `game/data/102_classic_quests.json` 手写时，5 处 menu 行的字符串
 *   结尾把 `"` 误写成 `'`。引号数变成奇数 → `JSON.parse` 抛
 *   `Bad control character in string literal`。
 *   而 `loadBaseData()` 里那个 try/catch **把它吞了**，只往 `world.modLog`
 *   塞一条 error —— 引擎照常启动、游戏照常能玩，
 *   **那 5 条任务却一条都取不到**（`getQuest()` 返回 undefined），
 *   表现为「接任务 XXX → 没有这个任务」+ 任务面板看不见，
 *   而且**不报任何错**。查了半天以为是加载顺序 / replace 语义。
 *
 * 「文件坏了但游戏不崩」是最难查的一类 bug。这个脚本把这些**静默失效**
 * 变成会响的红灯。守五件事：
 *   ① 每个 `NN_*.json` 都能 `JSON.parse`（坏文件直接点名，含行号列号）
 *   ② 引擎 boot 之后 `world.modLog` 里 `level==='error'` 的条数为 0
 *      （`loadBaseData` 里所有被吞掉的解析错都会落在那里）
 *   ③ 每条任务都有**获取通路**：挂在某个 NPC 的 `quests` 上，或是该 NPC 的
 *      `sidequest`（主线/悬赏不在此列 —— 它们各有自己的入口）
 *   ④ 任务目标的 `kind:'room'` / `kind:'item'` 指向的房间/物品**真实存在**
 *      （写错一个字母就是「判定永远 false」的静默瘫掉）
 *   ⑤ 任务 name / 阶段 desc 不许空
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'game', 'data');
const { GameEngine } = require(path.join(ROOT, 'game', 'src', 'core', 'engine.js'));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => { if (cond) pass++; else { fail++; console.log('  ✘ ' + name + (extra !== undefined ? '  ' + extra : '')); } };

(async () => {
  console.log('===== ① 每个数据文件都能 JSON.parse =====');
  {
    const files = fs.readdirSync(DATA).filter(f => f.endsWith('.json')).sort();
    ok('数据文件不少于 40 个（防目录被搬空）', files.length >= 40, files.length + ' 个');
    for (const f of files) {
      let err = null;
      try { JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); }
      catch (e) { err = e.message; }
      /* 坏文件必须点名到「文件 + 原因」，否则等于没查 */
      ok('可解析 ' + f, !err, err || '');
    }
  }

  console.log('===== ② 引擎加载零 error（被吞掉的解析错都在这里） =====');
  const e = new GameEngine({ seed: 20261011 });
  await e.boot({});
  const w = e.world;
  {
    const errs = (w.modLog || []).filter(m => m.level === 'error');
    ok('★ world.modLog 无 error', errs.length === 0, errs.map(m => m.msg).join(' | '));
    const warns = (w.modLog || []).filter(m => m.level === 'warn');
    ok('无「命名不合规」警告（备份文件别放数据目录）', warns.length === 0, warns.map(m => m.msg).join(' | '));
  }

  const quests = w.data.quests || {}, npcs = w.data.npcs || {};
  const rooms = w.data.rooms || {}, items = w.data.items || {};

  /* 只管**基础数据**的任务。Mod 自带的（如 mods/test_mod 的 test_quest）是别人家的东西，
     它挂在哪个 NPC 上、有没有 desc，由那个 mod 自己负责 —— 拿基础数据的规矩去卡它，
     只会天天假红（实测：test_quest 没写 giver，但它在 mod.json 里挂得好好的）。 */
  const isBase = id => String((quests[id] || {}).__source || '').startsWith('基础数据');
  const baseIds = Object.keys(quests).filter(isBase);

  console.log('===== ③ 每条任务都有获取通路 =====');
  {
    const orphans = [];
    for (const id of baseIds) {
      const q = quests[id];
      const type = q.type || '';
      /* 主线靠引擎推、悬赏靠悬赏牌，不走 NPC.quests 这套 */
      if (type === '主线' || type === '悬赏') continue;
      const g = q.giver || q.npc;
      if (!g) { orphans.push(id + '（没写 giver/npc）'); continue; }
      const n = npcs[g];
      if (!n) { orphans.push(id + '（委托人 ' + g + ' 不存在）'); continue; }
      const listed = (Array.isArray(n.quests) && n.quests.includes(id)) || n.sidequest === id;
      if (!listed) orphans.push(id + '（' + g + ' 身上既没挂 quests 也没挂 sidequest）');
    }
    ok('★ 没有孤儿任务（接不到的那种）', orphans.length === 0, orphans.length + ' 条：' + orphans.slice(0, 8).join(' / '));
    console.log('    （基础数据任务 ' + baseIds.length + ' 条，另有 Mod 自带 ' + (Object.keys(quests).length - baseIds.length) + ' 条不在此列）');
  }

  console.log('===== ④ 目标指向的房间 / 物品真实存在 =====');
  {
    const bad = [];
    for (const id of baseIds) {
      for (const s of (quests[id].stages || [])) {
        /* ⚠️ 目标的**四种写法都要扫**：`targets` 之外还有按性别/按线分叉的
           `targetsByGender` / `targetsByLine`（P4 性别双解用）。
           只扫 `targets` 的话，双解那一套里的错字房间号**永远不会被发现** ——
           而它照样是「判定永远 false」的静默瘫掉。 */
        const groups = [s.targets];
        for (const g of ['targetsByGender', 'targetsByLine']) {
          if (s[g]) for (const k of Object.keys(s[g])) groups.push(s[g][k]);
        }
        for (const tg of groups) for (const t of (tg || [])) {
          if (!t) continue;
          if (t.kind === 'room' && t.key && !rooms[t.key]) bad.push(id + ' → 房 ' + t.key);
          if (t.kind === 'item' && t.key && !items[t.key]) bad.push(id + ' → 物 ' + t.key);
        }
      }
    }
    ok('★ 目标房间/物品全存在（含按性别/按线分叉的那几套）', bad.length === 0, bad.length + ' 处：' + bad.slice(0, 8).join(' / '));
  }

  console.log('===== ⑤ 名字与阶段描述不许空 =====');
  {
    const blank = [];
    for (const id of baseIds) {
      const q = quests[id];
      if (!q.name) blank.push(id + '（无 name）');
      for (let i = 0; i < (q.stages || []).length; i++) {
        const s = q.stages[i];
        if (!s || !s.desc) blank.push(id + ' 第 ' + i + ' 段（无 desc）');
      }
    }
    ok('★ 任务名与阶段描述非空', blank.length === 0, blank.length + ' 处：' + blank.slice(0, 8).join(' / '));
  }

  console.log('===== ⑥ 金庸人物支线确实在库里 =====');
  {
    const KEY = ['sq_guo_jing_shoucheng', 'sq_yang_guo_muqian', 'sq_xiao_feng_shenshi',
      'sq_feng_qingyang_shoujian', 'sq_xiao_longnv_chumen'];
    for (const id of KEY) {
      const q = w.getQuest(id);
      ok('★ ' + id + ' 在库里', !!q, q ? '' : '取不到（多半是文件解析失败被吞）');
      if (q) ok('　它挂在委托人身上', !!(npcs[q.giver] && Array.isArray(npcs[q.giver].quests) && npcs[q.giver].quests.includes(id)), q.giver);
    }
  }

  console.log('===== ⑦ 前置锁的 flag 真有人设（design/67 §5.3 P2） =====');
  {
    /* `stage.lock.flag` 是**新的**一类「读 flag」。它有个极难查的失败模式：
       锁写上了、flag 却从来没人设 ⇒ 那一幕**永远卡住**，而游戏不崩、也不报错。
       判据：把这个 flag 在所有数据文件里搜一遍，但**先把 lock 声明本身抠掉** ——
       否则「只在自己身上出现」也会算命中。 */
    let blob = '';
    for (const f of fs.readdirSync(DATA).filter(x => x.endsWith('.json'))) {
      blob += fs.readFileSync(path.join(DATA, f), 'utf8') + '\n';
    }
    const stripped = blob.replace(/"lock"\s*:\s*\{[^}]*\}/g, '""');
    const locks = [];
    for (const id of baseIds) {
      for (const s of (quests[id].stages || [])) {
        if (s && s.lock && s.lock.flag) locks.push({ id, flag: s.lock.flag, quest: s.lock.quest || '' });
      }
    }
    ok('装上了前置锁（本批至少 5 处）', locks.length >= 5, locks.length + ' 处');
    const dead = locks.filter(l => !stripped.includes(l.flag));
    ok('★ 没有被锁死的：每个 lock.flag 都真有地方置位', dead.length === 0,
      dead.map(l => l.id + '→' + l.flag).slice(0, 6).join(' / '));
    const badQuest = locks.filter(l => l.quest && !quests[l.quest]);
    ok('★ 每个 lock.quest 指向的任务真实存在', badQuest.length === 0,
      badQuest.map(l => l.id + '→' + l.quest).join(' / '));
  }

  console.log('');
  console.log('通过 ' + pass + ' / 失败 ' + fail);
  if (fail) process.exitCode = 1;
})();
