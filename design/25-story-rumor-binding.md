# 《故事 → 传闻 → 世界记忆》绑定设计（#116）

交付人：文策渊（设计+叙事）　任务号：#116　日期：2026-10-11　**版本：v1.1**（主理人五项裁定已落入；新增 §9 埋点建议表 / §10 接口契约）
上游规格：`design/02-world-dynamics-spec.md` · `design/27-world-dynamics-w5-w7.md`（W5–W7，**事件定义方**）
引擎依据：`game/src/core/world.js`（`addRumor`/`dailyRumorTick`/`applyRumorReputation`）· `modapi.js`（`evalCond`）· `marriage.js` · `kidnap.js`
配套：`design/23-sidequests-portrait-hooks.md`（52 条支线）· `design/15-portrait-roster.md`

> **本文只出设计。不改代码、不改 `game/data/*.json`、不 commit。** 落地由工程执行。
> 本文所有引擎结论**均为实测**（`new GameEngine({seed:20261010}).boot()` + 直读 `world.js`/`modapi.js` 源码行），**不照抄规格文档**。
>
> ⚠️ **行号说明（重要）**：本文源码行号为 **git `fe5f8e7`（2026-10-10）快照**，已逐条重新核对。`world.js` 正被工程高频改动，**行号会漂移**——落地请以**符号名**为准（`dailyRumorTick` / `addRumor` / `applyRumorReputation` / `witnessKinsmanReaction` / `p.kidnap` / `p.marriage` 等），行号仅作定位辅助。

---

## §0 边界声明（**主理人已定，照写**）

> ### 🔒 所有权（单一所有权，写死）
> **事件定义唯一归 W5（`design/27-world-dynamics-w5-w7.md`）；#116 只负责把玩家行为转成这些事件的输入变量，不得重复定义事件。**

**推论（本文遵守）**：
1. 本文**不新增任何事件**，不再出现"世界会传出风声"那类**世界侧事件**；凡涉及风声，一律**引用 W5 的 `w5_*` / `rs_e_world_*` event id**，不另起一套。
2. 本文只做两件事：**(a) 把玩家行为 → 变量**（§1）· **(b) 把玩家行为 → `rs_*` 传闻种子**（§2 的 16 条种子归属）。
3. W5 的 23 条"可能重叠"事件（类1 12 + 类2 8 + 类5 3）**全部仍归 W5**；其中 **8 条**（`w5_foe_bribe` / `w5_foe_slander` / `w5_foe_snatch` / `w5_foe_kin` / `w5_foe_pact` / `w5_foe_debt` / `w5_sect_mercy` / `w5_sect_hunt`）**消费本文 §1 的变量**。#116 **给输入，不给定义**。

---

## §1 三项接口（#116 的义务）

### §1.0 统一写入点：**全部放进 `dailyRumorTick()` 末尾，每日重算一次**

> 这是本文最重要的一条设计决定。三项接口**都不采用"发生某件事时 +1"的写法**，而是**每天结算时从当前状态重算一遍**。

| 项 | 为什么放这里 |
|---|---|
| **幂等** | 重算 = 纯函数。漏写一天，次日自愈；**永远不会"多写一次就永久错"**（主理人明确要求） |
| **与接口 c 同处** | interface c 本来就要在 `dailyRumorTick` 里遍历 `rumors` → **一次进函数，四个 var 一起写** |
| **顺序天然正确** | `world.js:1973 dailyRumorTick()` **先于** `:1974 fireEvent('onDayTick')` → 同一天 W5 事件读到的**一定是最新值**（WT 的 cond 不会读到昨天的数） |
| **零新增 hook** | 不加 `onRumorHeat` / `onDayTick` 之外的任何 hook |

**实测依据（`world.js:1973-1974`）**：
```js
const newDay = Math.floor(this.clockMinutes / 1440);
if (newDay !== prevDay) { this.dailyRumorTick(); this.fireEvent('onDayTick', {day:newDay, prevDay}); }
```

### §1.a `foe_count` —— 玩家有多少个仇家

**结论：既不是 `rel` 的 `仇` 边，也不是 `kidnap.wanted`；两者都排除。真正的源是「运行时被玩家激怒的 `npc.hostile`」。**

**排除理由（实测）**
- **`rel` 的 `仇` 边不能用**：`rel` 是 **NPC↔NPC** 的关系网（实测 1050 条边、其中 `仇` 138 条，两端全是 `npcv_*`）。**玩家对象根本没有 `rel` 字段**（实测 `world.player` 的键里无 `rel`）。
- **`kidnap.wanted` 不是"仇家"**：它是**掳人/奴役**系统的通缉档（`p.kidnap.wanted`，`world.js:2192` 初始化 `wanted:0`），记"你作案被报了几次官"，与"谁恨你"无关。

**真正来源（实测）**
| 源 | 位置 | 含义 |
|---|---|---|
| `witnessKinsmanReaction()` | `world.js:1156-1202` | 玩家杀/打倒 NPC 的**至亲/至交** → `w.hostile = true`（`:1191`）+ `w.pstate.avengers.push(victim.defId)`（`:1197`） |
| 当场行凶/反抗 | `world.js:1654`（置 true）/ `:1694`（解除） | 玩家在其面前动手 |
| 掳人系统 | `kidnap.js:520`（守卫）/ `:607` / `:658` / `:1204`（受害者或同伙），`:1216` 解除 | 掳人行为激怒在场者 |
| **模板自带** | `world.js:780/790`、`character.js:154` | `def.hostile === true`（**Boss / mob，天生敌对，不算"因你结仇"**） |

**定案规则（幂等 · 零新增写入 · 可自愈）**
```
foe_count = |{ npc ∈ world.instances.npcs :
                npc.hostile === true
                AND !(npc.def && npc.def.hostile === true)   // 排除模板天生敌对（Boss/mob）
              }|
```
- **关键洞察**：`hostile` 有两个来源 —— **模板**（`def.hostile`）与**运行时**（因玩家而置 true）。**"`hostile===true` 但 `def.hostile!==true`" = 因你而结的仇** → 这个差值本身就是幂等的，**不需要在任何地方埋"记仇"计数**。
- **仇家名单**（W5 若要显示名字）：直接用既有 `npc.pstate.avengers`（`world.js:1196-1197` 已在写，其注释原文就写着「**#116 衔接**」）。
- **取值 / 上限**：`int ≥ 0`，上限 = 当前活着的实例 NPC 数（实际远小于此）。W5 用它做 `>=1` / `>=2` 门槛。
- **为什么不用"发生时 +1"**：一旦某 NPC 被解除敌对（`world.js:1694`）或离场（`delete instances.npcs`），计数器就永久多一个；**重算式自动归零**。

### §1.b `has_debt` —— 玩家是否欠着债

**结论：唯一载体 = `p.kidnap.debt`（玩家被掳后的赎金债）。**

**定案规则**
```
has_debt = (p.kidnap && p.kidnap.debt && (p.kidnap.debt.paidOff || 0) < (p.kidnap.debt.ransom || 0)) ? 1 : 0
```
- **载体实测**：`world.js:2192` `p.kidnap = { bags, slaves, guards, wageDue, wanted, reports, debt: null }`；`debt` 结构 `{ ransom, paidOff, days, by, market }`（`engine.js:444-447` 有快照）。
- **归 `false` 的时机**：还清 → `debt` 置 `null`（`kidnap.workOffDebt` / `redeemSelf`）**或** `paidOff >= ransom` → 上面表达式自然回 0。**无需额外埋点。**
- **必须排除的一处**：`commands.js:1490` 的 `ps.debt`（「赎身债还差 N 文」）是 **NPC 青楼女子的赎身债，不是玩家的** —— 不要算进 `has_debt`。
- **取值**：`0 / 1`（W5 写 `var has_debt >= 1`，故用 0/1 最稳）。

### §1.c `has_spouse` —— 玩家是否有配偶

**结论：从 `p.marriage` 直读，重算，不缓存。**

**定案规则**
```
has_spouse = (p.marriage && (p.marriage.spouse || (p.marriage.concubines || []).length > 0)) ? 1 : 0
```
- **载体实测**：`marriage.js:71` `p.marriage = { spouse: null, concubines: [], bonds: [], stage, plan }`；开局实测 `{"spouse":null,"concubines":[],"bonds":[],"stage":"none","plan":null}`。
- **计入妾 ✅（主理人已裁定）**：`has_spouse` = **正室或妾皆算**（`spouse || concubines.length>0`）。理由 + 它在 `w5_foe_kin` 里的**具体作用**（否则工程只看到个布尔值不知该干嘛）：
  - `w5_foe_kin`「**拿你亲友做筏**」（cond `var has_spouse>=1`）打的是"亲友"这张**人情网络**——**妾在其中是真节点**（有身份、有居所、有往来），不是摆设。
  - **具体演法（供 W5 事件体取材；定义权 100% 归 W5）**：仇家**胁/绑妾**逼你就范 → 妾**报信/通风** → 或**以妾的娘家为要挟**。⇒ #116 的**全部义务**只是"你有妾时 `has_spouse=1`"；**具体怎么用妾，是 W5 的事。**
  - 若将来只想认正室：删掉 `concubines` 那半句即可（**变量名不变，仍叫 `has_spouse`**）。
- **是否缓存成 var**：**要**（W5 的 `cond` 只能读 `var`，见 §1.e）→ 每日子结算写 `p.vars.has_spouse`。
- **取值**：`0 / 1`。

### §1.d 三项接口的**写入伪代码**（工程照此实现）

```js
/* 插在 dailyRumorTick() 末尾（world.js:1345 之后）——每日一次，全部重算 */
const p = this.player;
if (p) {
  if (!p.vars) p.vars = {};                       // world.js:2184 已建，防御性兜底

  // a) 仇家数：运行时 hostile − 模板天生 hostile
  let foes = 0;
  for (const id of Object.keys(this.instances.npcs || {})) {
    const npc = this.instances.npcs[id];
    if (!npc || npc.dead) continue;               // 死人不算（可回溯，但已无威胁）
    if (npc.hostile !== true) continue;
    if ((npc.def || {}).hostile === true) continue; // 排除 Boss/mob
    foes++;
  }
  p.vars.foe_count = foes;

  // b) 负债：只有被掳的赎金债算
  const d = p.kidnap && p.kidnap.debt;
  p.vars.has_debt = (d && (d.paidOff || 0) < (d.ransom || 0)) ? 1 : 0;

  // c) 配偶：正室或妾
  const m = p.marriage || {};
  p.vars.has_spouse = (m.spouse || (m.concubines || []).length > 0) ? 1 : 0;

  // d) 通缉：把懒字段 p.wanted 收进 var（W5 读它）
  p.vars.wanted = p.wanted || 0;

  // e) 地域知名度：evalCond 无 fame 键（见 §2.4）→ 必须转 var
  const f = p.fame || {};
  let fmax = 0; for (const rg of Object.keys(f)) if (f[rg] > fmax) fmax = f[rg];
  p.vars.fame_max = Math.round(fmax);
  const here = this.getRoom(p.room);
  p.vars.fame_here = Math.round((here && f[here.region]) || 0);

  // f) 传闻热度（接口 c，见 §3）——两个分工变量（主理人裁定加 bad_max）
  let hmax = 0, hbad = 0;
  for (const r of this.rumors) {
    if (r.subject !== 'player') continue;
    if (r.heat > hmax) hmax = r.heat;                    // 名气总量（不分善恶）
    if (r.polarity < 0 && r.heat > hbad) hbad = r.heat;  // 恶名分量（只算极性为负）
  }
  p.vars.rumor_heat_max = Math.round(hmax);
  p.vars.rumor_heat_bad_max = Math.round(hbad);
}
```

### §1.e ⚠️ 前置坑：`var` 是 W5 **唯一能读**的自定义输入通道（实测）

`evalCond`（`modapi.js`）支持的自定义数值读取只有：
- `{rep: "key"}` → `p.reputation[key] || 0`（`modapi.js:94 / 196-226 / 225`）
- `{var: "name", op:">=", value:N}` → `p.getVar("name") || 0`（`modapi.js:213`）
- 直接比较 `{"key>=": N}` → `fieldValue()`（`modapi.js:74-96`），**未知 key 落到 `default: return p.getVar(key) || 0`**

⇒ **`foe_count` / `has_debt` / `has_spouse` / `wanted` / `fame_*` / `rumor_heat_max` / `rumor_heat_bad_max` 全部必须写成 `p.vars.*`，W5 用 `{var:"..."}` 读。** 这也是 W5 表格里已经写成 `{"var":"foe_count","op":">=","value":1}` 的原因 —— **口径一致，无需改 W5。**

---

## §2 接口 b：恶名 / 善名 → `rep` / `karma` 的源头

### §2.1 `rep` 的**唯一**生成点（实测，只有一个）

`applyRumorReputation()`（`world.js:1282-1299`），在**传闻出生的那一刻一次性结算**（`addRumor` 内 `:1269` 调用）：

```
Δrep = seed.polarity × seed.weight × (seed.heat0 / 100)
key  = 涉及 NPC 有 sect → 该门派 id
       else 落点 region 对应某门派地盘(sect.region/homeRegion) → 该门派 id
       else '*'          （全江湖声望）
```

**除它之外，只有一处直接改 rep**：`witnessKinsmanReaction()`（`world.js:1200`）`p.reputation[sect] -= (isKin ? 30 : 15)`（目击杀亲，按门派扣）。

### §2.2 **16 条 `rs_*` 种子 → `Δrep` 全表**（按实测 `polarity/weight/heat0` 算出）

| seed | 玩家行为（**谁触发**） | polarity | weight | heat0 | **Δrep** | marks |
|---|---|---|---|---|---|---|
| `rs_kill_named` | 杀**具名** NPC | −1 | 3 | 85 | **−2.55** | 血案 |
| `rs_kill_civilian` | 杀**无名** NPC | −1 | 4 | 95 | **−3.80** | 血案·草菅 |
| `rs_theft_caught` | 偷窃被抓 | −1 | 1.5 | 55 | **−0.83** | 盗窃 |
| `rs_resist_arrest` | 拒捕 / 抗官 | −1 | 2.5 | 80 | **−2.00** | 抗官·血案 |
| `rs_save_life` | 救人一命 | +1 | 2 | 60 | **+1.20** | 义举 |
| `rs_alms` | 施舍 | +1 | 0.8 | 30 | **+0.24** | 善名 |
| `rs_tournament_win` | 比武夺魁 | +1 | 3.5 | 90 | **+3.15** | 扬名 |
| `rs_sect_join` | 拜入门派 | +1 | 2.5 | 75 | **+1.88** | 江湖 |
| `rs_sect_betray` | 叛门 | −1 | 2.5 | 75 | **−1.88** | 背叛 |
| `rs_deadbeat` | 赖账 | −1 | 1 | 40 | **−0.40** | 失信 |
| `rs_break_marriage` | 休妻 / 毁婚 | −1 | 1.5 | 50 | **−0.75** | 风评 |
| `rs_secret_out` | 泄密 | −1 | 2 | 70 | **−1.40** | 秘辛 |
| `rs_dungeon_clear` | 破秘境 / 清地牢 | +1 | 2.5 | 70 | **+1.75** | 奇遇 |
| `rs_drunkard` | 酗酒 | 0 | 0.5 | 25 | **0.00** | 醉乡 |
| `rs_bigspender` | 挥金 | 0 | 1 | 45 | **0.00** | 豪奢 |
| `rs_jailbreak` | 越狱 | −1 | 4 | 100 | **−4.00** | 重案·血案 |

> **量级提醒（给数值）**：单次恶行只掉 **0.4~4.0 点 `rep`**（且是**一次性**，不随时间累积），而 W5 的门槛是 `rep:* <= -40`（`w5_sect_hunt`）—— **要 -40 需要约 10~100 次恶行**。若 W5 认为门槛太高，**调 `heat0/weight` 或改读 `rumor_heat_max`（§3）更合适**。这条已在 §5 列为待拍板。

### §2.3 🔴 **实测：16 条种子里只有 2 条被代码调用** —— 其余 14 条是死数据

全仓 `addRumor(` 调用点**只有 1 处**：
```
world.js:960   this.addRumor(named ? 'rs_kill_named' : 'rs_kill_civilian', {...})
```
⇒ **`rs_theft_caught` / `rs_resist_arrest` / `rs_save_life` / `rs_alms` / `rs_tournament_win` / `rs_sect_join` / `rs_sect_betray` / `rs_deadbeat` / `rs_break_marriage` / `rs_secret_out` / `rs_dungeon_clear` / `rs_drunkard` / `rs_bigspender` / `rs_jailbreak` 这 14 条定义了但从未被调用**（与 `design/27` §1.3 报的"4 条基础事件静默失效"同族）。

**⇒ 现状：`rep` 只对"杀人"生效。** 所以"恶名/善名 → rep"这条链**目前是断的**。
**#116 的处置**：§2.2 表的"玩家行为"列**就是这些种子该被调的时机**；**调用点需工程补** → **逐条作业单见 §9「埋点建议表」**（含触发动作 / 落地语义位置 / `opts` / 目击）。**这属工程活（已立 B22），本文只给"埋点作业单"。**

### §2.4 `p.reputation` 与 `p.fame` 是**两条不同的轴**（**口径写死**）

| 轴 | 载体 | 键 | 维度 | 谁在写 | 取值范围 |
|---|---|---|---|---|---|
| **门派/机构声望** | `p.reputation[key]` | 门派 id（`huashan`…）· `'*'`（全江湖）· `'朝廷'` | **无 region 维度** | `applyRumorReputation()`（出生时一次性）· `witnessKinsmanReaction`（扣门派） | 无上限（可负） |
| **地域知名度** | `p.fame[region]` | region id | **地域维度** | `dailyRumorTick()`（`world.js:1340`，每日累加） | **0 ~ 100**（clamp） |

**⇒ W5 要读哪一个？两个都要，口径如下（写死）：**
- W5 的 `rep:*` → **`p.reputation['*']`**（`evalCond` 有 `rep` 键，`{rep:'*'}` 可直接读，**无需转 var**）。
- W5 的 `rep:朝廷` → **`p.reputation['朝廷']`**（同上，直接读）。
- W5 的 `fame[region]` → **`p.fame[region]`** ⚠️ **但 `evalCond` 没有 `fame` 键**（见下）。

⚠️ **`fame` 不能直接写 cond（实测坑）**：`fieldValue()`（`modapi.js:74-96`）的 `case` 列表里**没有 `fame`** → 落到 `default: return p.getVar(key) || 0`。后果：
- 写 `{"fame>=": 40}` → `p.getVar('fame') || 0` → **0 ≥ 40 = false** → **静默永假**（`w5_wanted_bounty` 永远不会触发）
- 写 `{fame: 'jiangnan'}` → **`evalCond` 里没有任何分支处理 `cond.fame`** → **静默放行**（条件形同不存在）

**⇒ #116 定案：`fame` 必须转 var。** 由 §1.d 写入：
- **`p.vars.fame_here`** = 玩家**当前所在 region** 的 `p.fame[region]`（**口径 = 当前 region，不是最大值**）
- **`p.vars.fame_max`** = **所有 region 的最大值**（取用时机：需要"全江湖都听过你"时）
- W5 改写：`fame[region]>=40` → **`{var:"fame_here",op:">=",value:40}`**

> **✅ 主理人裁定（3）**：`w5_wanted_bounty` 的 `fame[region]>=40` **走 `fame_here`**（本地悬赏按本地威望更合理）。**依据**：`fame[region]` 在 `evalCond` 里**根本不可达**（无 `fame` 键，见上）→ 必须转 var；且 `fame_here`（当前 region）比 `fame_max` 更贴"画影图形贴在你所在城门"。

### §2.5 `karma` 的来源（**不经传闻**，W5 直接 `{karma:...}` 读）

实测三条：
1. **`evalEffects` 的 `+karma` / `-karma`**（`modapi.js` effect 表）—— 支线 `menu` 分支、事件 `effects` 都在用（`design/23` 的 52 条支线大量使用）。
2. **`npc.def.karmaGain`**（`world.js:921`）—— 击杀/交互时按 NPC 定义加减（`def.good ? +5 : -2` 兜底）。
3. **固定事件**（`world.js:901` `p.karma += 2`）。

⇒ **`karma` 无需本文件定义写入规则**（它已有 3 条既有通道）；W5 的 `w5_foe_repent`(`karma>-30`) / `w5_sect_mercy`(`karma>20`) **直接可用**。

### §2.6 `wanted`：两条同名不同义，**写死口径**

| 载体 | 含义 | 谁写 | W5 读它吗 |
|---|---|---|---|
| **`p.wanted`** | **作案被目击次数**累计（`world.js:1022/1201/1719` 各 `+1`） | 偷窃被抓 / 目击杀亲 / 行凶被报案 | ✅ W5 的 `p.wanted>0` / `>=30` **指这个** |
| `p.kidnap.wanted` | **掳人**通缉档（0…n） | `kidnap.js` | ❌ 不是它 |

⇒ 由 §1.d 写 `p.vars.wanted = p.wanted || 0`（`p.wanted` 是**懒字段**，开局实测 `undefined`，**必须 `|| 0`**）。

### §2.7 恶名 / 善名 → W5 读取源（**✅ 主理人裁定 4**：改用 `rumor_heat_*`；**本批不动 `rep` 量级**）

`rep` 单次仅 ±0.4~4.0（§2.2），而 W5 门槛 `rep:*<=-40` 要 **10~100 次恶行**才触发一次势力事件 → **量级明显不对**。
**裁定：本批只把 W5 的读取源从 `rep` 改成 `rumor_heat_*`，不调 `rep` 的量级。**

| W5 事件 | 原 cond | 改读（建议） | 读的是 |
|---|---|---|---|
| `w5_sect_hunt` | `rep:* <= -40` | `{var:"rumor_heat_bad_max",op:">=",value:<阈值>}` | 恶名分量 |
| `w5_foe_bribe` | `rep:* <0` | `{var:"rumor_heat_bad_max",op:">=",value:1}` | 恶名分量 |
| `w5_foe_slander` | `rep:* >=20` | `{var:"rumor_heat_max",op:">=",value:<阈值>}` | 名气总量（善恶都算，被造谣=你够有名） |

> ⚠️ **`rep` 量级问题已另立 B23，本批不改** —— `rep` 可能被别处消费（`applyRumorReputation` / `witnessKinsmanReaction`），动它风险外溢。**`rep` 本身保留、`rs_*` 种子照常结算，只是 W5 的"触发器"改用更直观的即时 `heat`。**
> 阈值（`<阈值>`）由 W5 定：`heat` 是 **0~100 即时热度、不累积**，比 `rep` 直观得多。

---

## §3 接口 c：`p.vars.rumor_heat_max`（让 W5 **不新增 hook** 就读到"我有多出名"）

### §3.1 ① 技术上可行吗？**可行 ✅**（实测）

W5 提的做法我合过代码，**成立**：
- `dailyRumorTick()`（`world.js:1301-1346`）内部就是 `for (const r of this.rumors)`，**每条 rumor 都有 `subject` 与 `heat`**：
  - `subject`：`addRumor()` `:1262` `subject: opts.subject || 'player'` —— **默认就是 `'player'`**，世界侧传闻才显式传别的 subject。
  - `heat`：`:1309` `r.heat = Math.round(r.heat0 * Math.exp(-dt / tau))`，**每次日结算都会重算**。
- ⇒ `max(heat where subject==='player')` **在函数内直接可算**，不需要任何额外索引。
- **顺序也对**：`dailyRumorTick()` 在 `fireEvent('onDayTick')` **之前**（`:1973` vs `:1974`）→ 当天 W5 事件读到的是**刚算好的值**。

### §3.2 ② 定案：**写进 §1.d**（就叫 `p.vars.rumor_heat_max`，**不改名**）

```js
let hmax = 0, hbad = 0;
for (const r of this.rumors) {
  if (r.subject !== 'player') continue;
  if (r.heat > hmax) hmax = r.heat;                    // 名气总量
  if (r.polarity < 0 && r.heat > hbad) hbad = r.heat;  // 恶名分量（§3.3）
}
p.vars.rumor_heat_max = Math.round(hmax);
p.vars.rumor_heat_bad_max = Math.round(hbad);
```
- **取值**：`0 ~ 100`（`heat` 由 `heat0 ≤ 100` 指数衰减而来，恒 ≤ 100）。
- **语义**：**你名下最强的一条活跃传闻此刻有多响**（全局标量，**不分 region**）。
- **衰减自愈**：传闻消亡（`maxS<5` 或超 `ttl`，`:1333`）后自动从 `this.rumors` 移除 → 次日 `hmax` 自动回落。**幂等。**

### §3.3 ③ ✅ 采纳 `rumor_heat_bad_max`（**主理人裁定 2**）—— 两变量**分工写清**

W5 要的是「**恶名**热度」，而 `heat` **不分善恶**（`rs_save_life` / `rs_tournament_win` 也很烫 → **一个行善成名的玩家不该被通缉**）。故**加 `rumor_heat_bad_max`**（`rumor_heat_max` 名字**不动**），两者分工如下：

| 变量 | 含义 | 算法 | 谁读（举例） |
|---|---|---|---|
| `p.vars.rumor_heat_max` | **名气总量**（不分善恶） | `max(r.heat where subject==='player')` | `w5_foe_slander`（名气大才被人造谣）等"声望/名气"类 |
| `p.vars.rumor_heat_bad_max` | **恶名分量**（只算恶行） | `max(r.heat where subject==='player' && r.polarity<0)` | `w5_sect_hunt` / `w5_wanted_*` / `w5_foe_bribe` 等"恶名"类 |

> **一句话分工**：`heat_max` = **"你有多出名"**；`heat_bad_max` = **"你有多招人恨"**。
> 另有**可选** `p.vars.rumor_heat_here`（只算 `r.spread[当前 region]` 的 max，给"本地恶名"用）—— **非本次裁定项**，W5 若要再说。

---

## §4 引用规则（**照 §0 的单一所有权**）

| 场景 | **不要**这样写 | **要**这样写 |
|---|---|---|
| 想让"官府来抓你" | 自己定义一条抓人事件 | 引用 W5 的 `w5_wanted_poster` / `w5_wanted_bounty` …（它们自己挂在 `onDayTick` 上） |
| 想让"仇家上门" | 自己写一条伏击 | 引用 `w5_foe_ambush` / `w5_foe_letter` … |
| 想让"门派追杀你" | 自己写 | 引用 `w5_sect_hunt` |
| 支线需要"世界传开风声" | 自建传闻事件 | 调既有 `addRumor(seedId, {room, subject, about, vars})`（**公共底座**，见 §5） |

**本文新增的唯一"世界侧"东西 = `p.vars.*` 八个变量**（**5 核心**：`foe_count` / `has_debt` / `has_spouse` / `rumor_heat_max` / `rumor_heat_bad_max`；**3 辅助**：`wanted` / `fame_here` / `fame_max`），**不新增事件、不新增 hook、不新增 `rs_*` 种子**（`design/27` §5.4 已定：世界侧 4 条 `rs_e_world_*` 归 W5）。

**flag 命名（团队规范）**：全库统一 **`jiuye_*`** 前缀。**本文不引用任何 flag**（全部走 `p.vars.*`）→ 无冲突；若工程落地时把某个 `p.vars` 改为 flag 触发，请对齐 `jiuye_*`。

---

## §5 共用资产（**两边都别各造一套**）

| 资产 | 归属 | 本文态度 |
|---|---|---|
| `addRumor()` / `dailyRumorTick()` / `kFlow` / `regionAdj` | **已落地底座** | 共用（本文只在 `dailyRumorTick` **末尾追加写入**，不改其既有逻辑） |
| `rumorSeeds` 现有 **16 条**（玩家行为侧） | **#116（本文）** | §2.2 定义其归属与 Δrep；**新增调用点由工程补**（§2.3） |
| 世界传闻种子（`design/27` §2.6 的 `rs_e_world_*`） | **W5** | 本文不碰 |
| `打听` / `ask` 渲染 | 共用 | 同一个入口 |
| `onRumorBorn` / `onRumorHeat` hook | **本文不需要** | 用日结算写 `p.vars` 替代（这正是接口 c 的意义） |

---

## §6 id 自查

| 类别 | 结果 |
|---|---|
| 本文引用的 **`rs_*` 种子** | **16/16 ∈ `70_world.json` `rumorSeeds`**（逐条实测，另算出各自 Δrep） |
| 引用的 **`w5_*` event id** | **23/23 ∈ `design/27` §5.3.2 表**（引用，不定义）；其中 **8 条**消费 §1/§10 变量 |
| 引用的 **字段/函数** | `p.reputation` `p.fame` `p.karma` `p.wanted` `p.vars` `p.marriage` `p.kidnap.debt` `npc.hostile` `npc.def.hostile` `npc.pstate.avengers` `world.instances.npcs` `world.rumors[].subject/.heat/.polarity/.spread` —— **全部来自源码实测**（行号见文首说明，以符号名为准） |
| 本文**新增** | **8 个 `p.vars.*`**（5 核心：`foe_count` `has_debt` `has_spouse` `rumor_heat_max` `rumor_heat_bad_max`；3 辅助：`wanted` `fame_here` `fame_max`）——**无新增事件、无新增 hook、无新增种子** |
| 本文**埋点作业单** | §9 = **14 条**（16 条种子中未接线的 14 条；`rs_kill_named`/`rs_kill_civilian` 已接线，列为对照） |
| **编造** | **0** |

---

## §7 与工程可能冲突的点（**最重要一栏**）

| # | 点 | 我的口径 | 工程可能另做 | 建议 |
|---|---|---|---|---|
| 1 | **写入时机** | **每日在 `dailyRumorTick` 末尾重算**（幂等） | 可能想"发生某件事时 +1" | ⚠️ **必须重算**：+1 式一旦解除敌对/离场就永久错，**无法自愈**（主理人明确要求幂等） |
| 2 | **`has_spouse` 是否含妾** | 含（`concubines`） | 可能只认正室 | ✅ **已裁定含妾**（见 §1.c，含 `w5_foe_kin` 用法） |
| 3 | **`fame` 无 cond 键** | 定案走 `p.vars.fame_here`/`fame_max` | 可能想给 `evalCond` 加 `fame` 键 | ✅ **已裁定走 `fame_here`**（§2.4）；加 cond 键要动 `modapi.js`（回归面大），**不采纳** |
| 4 | **14 条种子未接线** | 需工程补调用点（§2.3） | 可能只修 `mergeData` 不补种子 | ⚠️ **不补则"善名/恶名"只对杀人生效**，`rs_save_life` 等永远不产生 rep |
| 5 | **`rep` 量级** | 单次 ±0.4~4.0，到 `-40` 需 10~100 次 | 可能觉得门槛太高 | ✅ **已裁定 W5 改读 `rumor_heat_*`**（§2.7）；`rep` 量级**另立 B23，本批不改** |
| 6 | **`foe_count` 是否算死人** | **不算**（`!npc.dead`） | 可能算 | 死仇家不该再上门；若要"余党复仇"，用 `pstate.avengers` 另做 |
| 7 | **`p.vars` 随档** | 实测**随档**（`serialize` `world.js:2247` 含 `vars`） | — | ✅ 无需改 serialize |
| 8 | **`p.fame` / `p.wanted` 是懒字段** | 开局实测 `undefined` | 可能直接 `p.fame[x]` 取值 → 崩 | ⚠️ **一律 `(p.fame||{})[...] || 0`** |

---

## §8 裁定记录（**✅ 主理人已定，v1.1 生效**）

| # | 事项 | 结论 |
|---|---|---|
| 1 | `has_spouse` 是否计入妾 | ✅ **计入**（含 `concubines`）；`w5_foe_kin` 用它做"亲友"（§1.c） |
| 2 | 是否加 `rumor_heat_bad_max` | ✅ **加**——分工见 §3.3（`heat_max`=名气总量 / `heat_bad_max`=恶名分量） |
| 3 | `w5_wanted_bounty` 的 `fame[region]>=40` | ✅ 走 **`var fame_here`**（依据：`fame` 在 `evalCond` 不可达，§2.4） |
| 4 | `rep` 门槛 | ✅ W5 **改读 `rumor_heat_*`**（§2.7）；`rep` 量级另立 **B23**，本批不改 |
| 5 | 14 条种子调用点 | ✅ 归**工程**（B22）；本文件出 **§9 埋点建议表** |

---

## §9 埋点建议表（**B22 作业单** · 给工程照落 · 只写设计不写代码）

> 📄 **本表已拆成独立作业单 → `design/28-rumor-seed-hooks.md`**
> （含 4 列埋点表 + 3 条落地注意 + **14 行核对表**，便于工程逐条打勾、验收逐条核）。
> **下表的改动请同步到 `design/28`**，以 `design/28` 为工程落地依据。

> **前提**：16 条种子的**数据已全在 `70_world.json`**（`polarity`/`weight`/`heat0`/`tauDays`/`ttlDays`/`loud`/`texts`/`marks`）——**工程只补「调用点」，不改种子数据。**
>
> **`opts` 契约**：`addRumor(seedId, { room, subject, about, vars:{ who, where, whom } })`
> - `room` **必填**（定 `originRegion`）；`subject` 默认 `'player'`（**玩家行为恒可不传**）；`about` = 相关 NPC/门派 `defId`（**决定 Δrep 落到哪个门派键**，§2.1）；`vars.{who,where,whom}` 供种子 `texts` 的 `{who}/{where}/{whom}` 插值。
> - **目击规则（引擎既有，非新增）**：**同房间非 hostile 非晕倒 NPC 必为目击**；**种子 `loud===true` 时邻房间 50%**（夜 ×0.5 / 雨 ×0.7）；**目击者 0 → 引擎拒绝生成传闻**（无人区不传）。
>
> ⚠️ **行号一律不写**：落地位置给的是**模块 + 语义位置**（团队规范）。

| # | 种子（kind · 极性） | 触发动作（玩家行为） | 落地位置（模块 · 语义） | `opts` | 目击（`loud`） |
|---|---|---|---|---|---|
| 1 | `rs_theft_caught`（偷窃 · −1） | 偷窃**被抓** | `commands.js` · 偷窃指令（`steal/偷`）的「被抓/败露」分支 | `room=<案发房>`, `about=<被偷者defId>`, `vars:{who=玩家名,where=房名,whom=被偷对象名}` | **false** → 仅同房间 |
| 2 | `rs_resist_arrest`（抗官 · −1） | **拒捕/抗官**（被官差追捕时动手） | `world.js` · 「行凶报案 / `p.wanted`+1」同一语义点（`witnessKinsmanReaction` 附近）；或 `commands.js` 官差交互的「反抗」分支 | `room=<冲突房>`, `about=<捕快/官府defId>`, `vars:{…,whom=捕快名}` | **true** → 邻房（打斗声） |
| 3 | `rs_save_life`（救人 · +1） | **救人一命**（把濒死 NPC 从死边缘救回/送药救命） | 支线 `effects` 或世界事件结算的「救人成功」分支 | `room=<救人现场>`, `about=<被救者defId>`, `vars:{…,whom=被救者名}` | **false** → 仅同房间 |
| 4 | `rs_alms`（行善 · +1） | **施舍**（给乞丐/贫民钱物） | `commands.js` · `give_money/给钱`、`give/给`、`song/送礼` 中「对象∈乞丐/平民」的分支 | `room=<施舍处>`, `about=<受施者defId>`, `vars:{…,whom=受施者名}` | **false** → 仅同房间 |
| 5 | `rs_tournament_win`（扬名 · +1） | **比武夺魁**（擂台/大比夺头名） | `combat.js` 或比武结算的 **win** 分支（若现仅有 `qiecuo/切磋`，挂在「连胜/夺魁」结算语义） | `room=<比武场>`, `subject:'player'`, `vars:{…,whom='众目睽睽'}` | **true** → 邻房（满场喝彩） |
| 6 | `rs_sect_join`（门派 · +1） | **拜入门派** | `commands.js` · `join/拜师/入门` 成功分支（`joinSect`） | `room=<山门>`, `about=<门派id>`, `vars:{…,where=门派名}` | **true** → 邻房 |
| 7 | `rs_sect_betray`（门派 · −1） | **叛门/脱派** | `commands.js` · `leave/脱离门派/叛门` 成功分支（`leaveSect`） | `room=<山门>`, `about=<门派id>` | **true** → 邻房 |
| 8 | `rs_deadbeat`（失信 · −1） | **赖账**（欠债逾期不还且被债主察觉） | `kidnap.js` · 债务系统 或 催债语义（`w5_debt_collector`）的「逾期/赖账」分支 | `room=<债主处>`, `about=<债主defId>`, `vars:{…,whom=债主名}` | **false** → 仅同房间 |
| 9 | `rs_break_marriage`（风评 · −1） | **休妻/毁婚** | `marriage.js` · 退亲/离异，或 `commands.js` · `sever/断义`/`marriage` 的解除分支 | `room=<所在房>`, `about=<配偶defId>`, `vars:{…,whom=配偶名}` | **false** → 仅同房间（家丑） |
| 10 | `rs_secret_out`（揭私 · −1） | **泄密**（把某 NPC 的 `secret` 说出去） | `commands.js` · `talk/say` 涉及秘辛话题，或支线 `effects` 的「揭私」分支 | `room=<对话处>`, `about=<秘辛所属NPC的defId>` | **true** → 邻房（传得快） |
| 11 | `rs_dungeon_clear`（奇遇 · +1） | **破秘境/清地牢** | 秘境通关结算点（`world.js` 或对应秘境 mod 的通关处） | `room=<秘境>`, `about=<秘境id>`, `vars:{…,whom=秘境之名}` | **false** → ⚠️ **见下注意** |
| 12 | `rs_drunkard`（市井 · 0） | **酗酒**（酒馆连饮/醉倒） | `commands.js` · `use/吃/喝` 饮酒累计超阈值，或酒馆特殊事件 | `room=<酒馆>`, `vars:{…,where=酒馆名}` | **false** → 仅同房间 |
| 13 | `rs_bigspender`（豪客 · 0） | **挥金**（单笔消费超阈值） | `commands.js` / 交易结算的「金额超阈值」分支（买宅/办酒/请客） | `room=<消费处>`, `vars:{…,whom='掌柜'}` | **false** → 仅同房间 |
| 14 | `rs_jailbreak`（重案 · −1） | **越狱**（越狱/突围成功） | `kidnap.js` · `escapeMarket`（黑市突围），或 jail 系统的「越狱成功」分支 | `room=<牢房/黑市>`, `about=<官府defId>`, `vars:{…,where='牢房'}` | **true** → 邻房（大动静） |

**⚠️ 三条落地注意（给工程）**：
1. **`rs_dungeon_clear` 的「目击者 0」陷阱**：独闯秘境常**无人在场** → 引擎会**直接拒绝生成**（`addRumor` 内 `if (!witnesses.length) return null`）。若要"出秘境后被传"，应在**玩家回到有 NPC 的房间**时补触发，或把该种子 `loud` 调 `true` 并确保邻房有人。
2. **`about` 决定 rep 落点**：涉及门派弟子或发生在门派地盘时，`about` 传该 defId → Δrep 落到**门派键**（`applyRumorReputation`，§2.1）；否则落 `'*'`（全江湖）。
3. **已接线的 2 条（对照，仅 1 处既有调用点）**：`rs_kill_named` / `rs_kill_civilian` 已在 `world.js` · 击杀 NPC 处调用（`named` 由 `sect/tier/unique/portrait` 判定）。**B22 要补的是上表 14 条。**

---

## §10 接口契约（**W5 ↔ #116 对表用**）

### §10.1 变量契约（**#116 只写 · W5 只读**）

| 变量 | 取值 | 来源 | 写入时机 |
|---|---|---|---|
| `p.vars.foe_count` | int ≥0 | 运行时 `hostile` − 模板 `def.hostile` | `dailyRumorTick` 末尾 |
| `p.vars.has_debt` | 0 / 1 | `p.kidnap.debt` 未还清 | 同上 |
| `p.vars.has_spouse` | 0 / 1 | `p.marriage.spouse` 或 `concubines` | 同上 |
| `p.vars.rumor_heat_max` | int 0~100 | `max heat`（subject=player） | 同上 |
| `p.vars.rumor_heat_bad_max` | int 0~100 | `max heat where polarity<0` | 同上 |
| `p.vars.wanted`（辅助） | int ≥0 | `p.wanted` | 同上 |
| `p.vars.fame_here`（辅助） | int 0~100 | 当前 region 的 `p.fame` | 同上 |
| `p.vars.fame_max`（辅助） | int 0~100 | 所有 region 的 `p.fame` 最大值 | 同上 |

### §10.2 写入时机（**契约**）
**每日一次、`dailyRumorTick()` 末尾全量重算**（幂等自愈），**先于** `fireEvent('onDayTick')` → W5 当日事件必读到最新值。
**约束**：W5 **不得**在别处写这些 var；#116 **不得**用「发生时 +1」。

### §10.3 出界处理（**契约**）
- 懒字段一律 `|| 0`（`p.wanted` / `p.fame` 开局实测 `undefined`）。
- `has_*` 归一 **`0/1`**（W5 写 `>=1`）。
- `heat_*` / `fame_*` → `Math.round` 后 **clamp 到 0~100**；`foe_count` / `wanted` → **≥0**。
- **W5 只做 `>=` / `<=` 数值比较，不依赖变量类型/存在性**（缺失按 0 处理）。**缺失即 0 → 事件不触发，不会崩。**

### §10.4 8 条 W5 事件逐条对照

| # | event | W5 现 cond | #116 供给 | 状态 |
|---|---|---|---|---|
| 15 | `w5_foe_bribe` | `rep:* <0` + `chance .2` | `var rumor_heat_bad_max` | ⚠️ **建议改读**（§2.7） |
| 16 | `w5_foe_slander` | `rep:* >=20` | `var rumor_heat_max` | ⚠️ **建议改读**（§2.7） |
| 17 | `w5_foe_snatch` | `item sack_coarse` + `chance .1` | `about`（货/结怨来路） | ✅ 无需数值 var |
| 18 | `w5_foe_kin` | `var has_spouse>=1` 或 favor高NPC | `var has_spouse` | ✅ 已对齐 |
| 19 | `w5_foe_pact` | `var foe_count>=2` | `var foe_count` | ✅ 已对齐 |
| 20 | `w5_foe_debt` | `var has_debt>=1` | `var has_debt` | ✅ 已对齐 |
| 22 | `w5_sect_mercy` | `faction_rel<-60` + `karma>20` | `karma`（既有 3 通道） | ✅ 可直接用 |
| 23 | `w5_sect_hunt` | `rep:* <=-40` + `faction_rel_all<-30` | `var rumor_heat_bad_max` | ⚠️ **建议改读**（§2.7） |

> **附带受益**（非 §1 三接口，但同用本文 var）：`w5_debt_collector`（类6，`var has_debt>=1`）、`w5_wanted_*`（类2，读 `p.wanted` / `fame_here`）。

---

> ### 🔒 复述边界声明（照 §0）
> **事件定义唯一归 W5；#116 只负责把玩家行为转成这些事件的输入变量，不得重复定义事件。**
