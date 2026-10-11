# 世界动态 W5–W7（#109 后续块）· 设计

> 交付人：文策渊（设计+叙事）　任务号：#109（W5/W6/W7）　日期：2026-10-11
> 上位规格：`design/02-world-dynamics-spec.md`（**必读；本文件不重写规格，只把 W5–W7 落到真实数据与真实引擎上**）
> 现存数据：`game/data/70_world.json`（**只有 `rumorSeeds` 16 条**）
> 已落地前置：传闻系统 W1–W4（`world.js` 的 `computeRegionAdj` / `kFlow` / `addRumor` / `dailyRumorTick` / `p.fame`）
> 与 `design/25-story-rumor-binding.md`（#116）的边界：见 **§5**（✅ **该文件已于 2026-10-10 交付 v1.1**；本文当时的划界提案已被它采纳，见其 §5/§9/§10）
>
> **本文只出设计。不改代码、不改 `game/data/*.json`、不 commit。** 落地由工程执行。
>
> ---
> ## ⚠️ 先读这一节：本批实测出 **5 条会静默失效的地雷**
>
> | # | 地雷 | 后果 | 严重度 |
> |---|---|---|---|
> | **R1** | `mergeData` 把 `events` 的 handler **数组揉成了对象** | **现有 4 条基础事件（onKill×2 / onTick×1 / onLevelUp×1）全部静默失效**；`worldEvents` 按同样写法会一起失效 | 🔴 **最致命** |
> | **R2** | `addRumor()` **要求 `opts.room` 里真有非 hostile NPC 当目击者**，否则 `return null` | 世界事件"该传开的没传开"，且不报错 | 🔴 高 |
> | **R3** | `factionRel` 条件**实测恒为 true** | W6 若用它做门派关系条件 → 条件永远成立 | 🟠 中 |
> | **R4** | `applyRumorReputation()` **不看 `subject`** | 世界事件（天灾/械斗）会**改玩家的声望** | 🔴 高 |
> | **R5** | 规格里 `menu:` 的写法（`menu:标题:A>效\|B>效`）**是错的** | 正确是 `menu:标题\|A>效;;B>效`。**错误写法不报错**，只会把标题吃成 `标题:A>效` 并**丢掉第一个选项** | 🟠 中 |
>
> 另有 2 条"数字过期"：**R6** 规格的 `税基(region)` 用的是地图重设计**前**的旧数（如 `jiangnan 184` → 实际 **27**）；**R7** 规格的门派列表含 `wudu`/`漕帮`，实际是 `miaojiang`（苗疆五毒教），真门派 **14 个**。

---

## 0. 交付范围与一句话结论

| 块 | 内容 | 条数 | 驱动源 |
|---|---|---|---|
| **W5** | 事件库（世界自己会出事） | **68 条**（8 类：12/8/6/6/10/12/8/6） | **时间驱动**；其中 **20 条**读玩家状态（`fame`/`karma`/`rep`）——见 §5 边界 |
| **W6** | 势力消长（门派兴衰 + 外显） | **14 门派 + 2 非门派势力**，公式**按实测重标定** | 月度结算 + 玩家行为微调 |
| **W7** | 节庆日历 | **8 节日 + 5 周期大事** | 纯时间驱动 |

**一句话**：W5/W6/W7 **全部挂在同一个 `onDayTick` 上**（W6 用 `day % 30` 自判月度、W7 用 `day % 120` 自判节庆）——
**不需要新增 hook**，规格 §2.2 里那张表里的 `onSeasonChange`/`onHoliday`/`onFactionTick`/`onEnterRegion` **可以全部省掉**，改用"在 `onDayTick` 一个处理器里按 `day` 取模分派"。
**理由**：新 hook 只能在 `world.js` 里加调用点（工程成本 + 回归面），而 `onDayTick` 的载荷 `{day, prevDay}` 已经足够算出季节/月/节庆。**少加 4 个 hook，少 4 处回归风险。**

---

# 1. 前置实测（真数据；想省时间可只读 §0 的地雷表 + 本节加粗行）

## 1.1 `worldEvents` 键：**不存在**（双证）

- **grep 结论**：`worldEvents` 全仓只出现在 **两处文档**（`design/02:494,497,522`、`design/08:514`），**代码与数据文件里 0 处**。
- **运行时结论**：`new GameEngine(...).boot()` 后 `world.data.worldEvents === undefined`。
- `70_world.json` 顶层**只有 `rumorSeeds`**（16 条：`rs_kill_named` … `rs_jailbreak`）。
- 同样不存在：`world.data.factions`（undefined）、`world.data.calendar`（undefined）、`world.factionState`（undefined）、`world.calendarState`（undefined）。
  > ⇒ W5/W6/W7 **三块都要从零建**；而**规格 §5.2 要求的运行期状态里，只有 `rumors`/`rumorSeq` 已存在**（在 `world.js:148-149`，`serialize` 于 `:2282-2283`、`deserialize` 于 `:2514`）。`factionState`/`calendarState` **需新增**（并接进 serialize/deserialize，否则存档丢势力走势）。

## 1.2 `onDayTick`：**已接线**；真实触发时机与载荷（**去代码看的，不是抄文档**）

```js
// world.js:1948-1953  （在 advanceTime() 末尾）
const newDay = Math.floor(this.clockMinutes / 1440);
if (newDay !== prevDay) {
  this.dailyRumorTick();                       // ← 先跑传闻结算
  this.fireEvent('onDayTick', { day: newDay, prevDay });   // ← 再跑事件
}
```

| 项 | 实测结论 |
|---|---|
| **触发时机** | `advanceTime(minutes)` 里 `newDay !== prevDay` 时（**跨日即触发，只触发一次**）。`newDay` 是**从 0 起算**的整数（开局 `clockMinutes=480` → `day=0`） |
| **载荷** | **`{ day, prevDay }`**（两个整数）。⚠️ 规格 §2.2 没写载荷 → **W5/W6/W7 的 `cond` 只能靠「读玩家/世界的当前状态 + `day:` 条件」**，不要把 `payload.day` 当成可用变量（`evalCond` 的 `day` 条件是**从 `player.timeMinutes` 推的**，不是从 payload） |
| **顺序影响（重要）** | `dailyRumorTick()` **先于** `fireEvent('onDayTick')` → **今天新加的传闻，今天不衰减、不扩散**，明天才开始。这是**好事**：世界事件产生的传闻出生即满热度 |
| **危险** | `fireEvent` 会**同步执行** handler 的 `evalEffects`。**若 handler 形态被揉坏（R1）或 effects 里有 `combat:` 之类需要战斗上下文的动作，跨日会抛错**——实测 `fireEvent('onTick')` **确实抛过** `Cannot read properties of null (reading 'inCombat')`。⇒ **W5 的 effects 里禁止写 `combat:`**（跨日自动开战既不合理，也会因无战斗上下文而抛错） |

## 1.3 🔴 R1：`mergeData` 把 `events` 的 handler 数组揉成对象 → **现有 4 条基础事件全部静默失效**

**机制**（`world.js:239-252`）：
```js
if (collections.includes(k) || (typeof json[k] === 'object' && !Array.isArray(json[k]))) {
  // 走 byId 分支：
  this.data[k][id] = this.mergeEntry(this.data[k][id], Object.assign({ id }, entry), mod, arrayMode);
}
```
`events` 的值是 **`{ onKill: [h1,h2], onTick: [h], ... }`** → `entry` 是**数组** → `Object.assign({id:'onKill'}, [h1,h2])` = **`{id:'onKill', 0:h1, 1:h2}`，数组被毁**。

**实测**（`boot()` + `newGame()` 后直接看内存）：

```
onKill   : OBJECT keys=["0","1","id","__source"]   isArray=false
onTick   : OBJECT keys=["0","id","__source"]       isArray=false
onLevelUp: OBJECT keys=["0","id","__source"]       isArray=false
onEnter  : OBJECT keys=["id","__source"]           isArray=false   （原本就是空数组）
```

而 `fireEvent`（`world.js:2118-2123`）是：
```js
const handlers = this.data.events[name] || [];
for (const h of [].concat(handlers)) { if (h.cond && ...) evalEffects(h.effects, ...) }
```
`[].concat(被揉坏的对象)` → **1 个元素，且该元素 `.effects === undefined`** → `evalEffects(undefined)` → `[]`（实测确认）。

> **⇒ 结论：`60_quests.json` 里 4 条基础事件条目（onKill 的"翻找残页/感悟"+ 2 条、onTick 1 条、onLevelUp 1 条）从来没有生效过。**
> 这是**静默失效型**，与总纲 §2 铁律②（"id 写错是静默瘫掉型 bug"）同族——**不报错、不红、就是不发生**。
> 唯一还在生效的是 **Mod 的 `rules`（`kind:'onEvent'`）路径**（`mergeData:262-264` 单独处理 `json.rules`，不经 byId 揉搓；实测 `fireEvent('onKill')` 唯一产出的那条 "你增长了 15 点潜能" 正来自 Mod 规则，**不是**基础数据的事件）。

**W5 的三种挂载方案（§2.1 详述）**：
- **方案 A（推荐）**：修 `mergeData`/`fireEvent`，让 `events`/`worldEvents` 的 handler 保持**真数组**（顺带修好现有 4 条）。
- **方案 B（零风险兜底）**：把世界事件写成 **Mod 形态的 `rules`**（`{kind:'onEvent', target:'onDayTick', cond, effects}`）——**现在就能跑**。
- **方案 C（不推荐）**：在 `fireEvent` 里"把 `{0:..,1:..}` 还原成数组"——治标，且会同时"复活"4 条从没测过的旧事件（回归面不可控）。

## 1.4 🔴 R2：`addRumor()` 要"真实目击者"，否则静默丢弃

`addRumor(seedId, opts)`（`world.js:1207-1255`）实测逻辑：
1. `seed = data.rumorSeeds[seedId]`，`room = getRoom(opts.room)`；**缺一即 `return null`**；
2. 遍历 `npcsIn(opts.room)` 收集 `witnesses`（排除 `dead` / `hostile` / `knockedOut`）；
3. `seed.loud` 时，**相邻房间**的 NPC 以 `0.5 ×（夜 0.5 / 雨 0.7）` 概率补入；
4. **`if (!witnesses.length) return null;`** ← **没有目击者就没有传闻**（这是设计意图，不是 bug）。

**⇒ 对 W5 的硬约束**：世界事件若想"传开"，**必须把传闻落在真有非 hostile NPC 的房间**。实测各 region 的 NPC 数（§1.6）就是**可传播性地图**：
- **NPC 富集（可安全落传闻）**：`jiangnan` 41 · `market` 37 · `palace` 30 · `qinglou` 29 · `shaolin` 22 · `huashan` 21 · `shandong…` 见下表
- **NPC 为 0（**传闻必然生不出来**）**：`changan` / `chengdu` / `xiangyang` / `luoyang`（**四座刚迁入 24 座宅院的新城，一个 NPC 都没有！**）、`tingyu`
- **NPC 极少（≤1）**：`many`(1) · `secret`(1) · `wild`(1)
> ⇒ **W5 里凡"事件发生在洛阳/长安/成都/襄阳"的，必须二选一**：① 换一个**有 NPC 的房间**作为传闻落点；② 给这些城**补 NPC**（属 #112/#113 画像批，不在本文范围）。**本文全部按"选有 NPC 的房间"写。**

## 1.5 🟠 R3：`factionRel` 条件**恒为 true**（疑似未知条件默认放行）

实测（`evalCond` 直调）：
```
season→true  day→true  region→true  weather→true  chance→true  karma→true
room→true    time→true  flag→false  var→true     rep→true      factionRel→true   ← 可疑
```
`factionRel` 返回 `true`，但它显然不是本引擎的内置条件（规格 §3.3 第 5 条要用它）。
**两种可能**：① 真的实现了；② **未知条件被默认放行**（那就意味着**写错条件名不会报错，只是永远成立**——和 R1 同族的静默坑）。
⇒ **工程必须先确认**：`evalCond` 对未知键是否 `throw` 或 `warn`。**若不报错，W6 的门派关系条件就不能用 `factionRel`，改用 `var`**：把月度结算的结果写进 `p.vars.faction_rel_huashan_mojiao`，条件写 `{var:'faction_rel_huashan_mojiao', op:'<', value:-40}`（**本文 §3 按此写**）。

## 1.6 其它实测（W6/W7 的输入）

**时间底盘**：`w.season` 是**方法**（`w.season()` 实测 `'spring'`）；`w.isNight()` 是方法；`w.isMealTime` 是方法；`w.weather` 是属性（实测 `'晴'`）；**`day = floor(clockMinutes/1440)`，开局 `day=0`**。

**门派（`data.sects`，真 id 14 个）**：

| id | 名 | 地盘 region | 实际弟子数 |
|---|---|---|---|
| `huashan` | 华山派 | huashan | **3** |
| `shaolin` | 少林派 | shaolin | 1 |
| `wudang` | 武当派 | wudang | 1 |
| `emei` | 峨眉派 | emei | 1 |
| `gaibang` | 丐帮 | gaibang | 2 |
| `tangmen` | 唐门 | tangmen | **0** |
| `mojiao` | 日月神教 | mojiao | 2 |
| `miaojiang` | 苗疆五毒教 | miaojiang | 1 |（规格写作 `wudu`，**实为 `miaojiang`** — R7）
| `dali` | 大理段氏 | dali | 1 |
| `xingxiu` | 星宿派 | xiyu | 1 |
| `gumu` | 古墓派 | gumu | **0** |
| `taohua` | 桃花岛 | taohuadao | 1 |
| `xiake` | 侠客岛 | xiake | **0** |
| `xuedao` | 血刀门 | beijiang | 1 |

> ⚠️ **弟子数 0~3**，而规格 §3.2 的支出式是"弟子数 × 8"——**按实际数代入，支出项几乎恒为 0~24，Δpower 会几乎只由收入决定**（→ 所有门派 power 单调上涨）。**这是 R6 的核心**，§3.2 给了重标定公式。
> ⚠️ 规格说"另加 2 个非门派势力 `朝廷`/`漕帮`"。**`漕帮` 在 `data.sects` 里不存在**；`朝廷` 也不是 sect（它是 `reputation` 的一个 key，见 `commands.js` 商店折扣）。§3.1 按**已存在的 key** 重新定义这两个势力。

**区域房间数 / NPC 数（税基必须重算 — R6）**：

| region | 房 | NPC | 旧规格税基 | **实测税基 = floor(房/10)** |
|---|---|---|---|---|
| `jiangnan` | **27** | 41 | 18（按 184 房算） | **2** |
| `market` | 20 | 37 | — | 2 |
| `wild` | 16 | 1 | — | 1 |
| `huashan` | 15 | 21 | 1 | 1 |
| `yamen` | 15 | 9 | 1（按 14 房） | 1 |
| `palace` | 14 | 30 | — | 1 |
| `cunzhen` | 13 | 12 | — | 1 |
| `luoyang`/`changan` | 13 | **0** | — | 1 |
| `farmland` | 12 | 10 | — | 1 |
| `chengdu`/`xiangyang` | 12 | **0** | — | 1 |
| `harbor` | 11 | 7 | — | 1 |
| `shuyuan` | 11 | 5 | — | 1 |
| `shaolin` | 10 | 22 | — | 1 |
| `emei` | 9 | 7 | — | 0 |
| `wudang` | 8 | 13 | — | 0 |
| `gusu` | 7 | 4 | — | 0 |
| `qinglou` | 7 | 29 | — | 0 |
| `tangmen`/`taohuadao` | 6 | 9 / 9 | — | 0 |
| 其余（beijiang/xiyu/xixia/mojiao/many/secret/gumu/xiake/jinguo/haitan/miaojiang/dali 等） | 3~5 | 1~8 | — | 0 |

> **⇒ `税基` 全部 ≤2**（旧规格最大 18）。规格 §3.2 的"收入 I"必须换算法（§3.2 给出）。

**画像 catchphrase 实测数**：带 `portrait.voice.catchphrase` 的 NPC = **42 位**（其中 `portraits-new.json` 的 26 位全带）。任务书里写的"128 条"应是**文档口径**（`design/15` 的配额），**运行时实测 42 —— 以实测为准**。

**可 spawn 的 mob（10 个）**：`mob_bandit`(lv5/hp130) · `mob_bandit_chief`(13/380) · `mob_wolf`(3/90) · `mob_boar`(6/180) · `mob_snake`(7/110) · `mob_black_bear`(17/700) · `mob_tiger`(25/1300) · `mob_mo_disciple`(21/880) · `mob_soldier`(11/280) · `mob_assassin`(33/1700)

**其它**：`world.jail` 已存在（object，可复用"下狱"）；`respawn` 房若干（巡卫密度可改）；`evalEffects` **同时接受字符串 DSL 与对象形态**（实测两者都生效，且 `flag:` 真落地）。

## 1.7 规格与实测不符之处（**别照抄规格的数字**）

| 规格原文 | 实测 | 处置 |
|---|---|---|
| `税基(region)`：`jiangnan 184 → 18` | `jiangnan` 现 **27 房 → 税基 2** | §3.2 换公式 |
| 门派列表含 `wudu`、另加 `漕帮` | 实为 `miaojiang`；**无 `漕帮`** | §3.1 用真 id |
| §2.2 要新增 6 个 hook | `onDayTick` 已存在，其余 5 个**可以不新增** | §0 用 `day` 取模分派 |
| §2.3 的 `menu:` 写法 | **写法错误**（R5） | §2.2 给正确写法 |
| §2.4 "20 条必触发型 `once:true`" | 本文按 **14 条 `once`**（见 §2.3 备注：`once` 太多会让 120 天的世界"一次性用完"） | §2.3 |
| §5.2 要新增 6 项序列化状态 | `rumors`/`rumorSeq` **已有**；需新增 `factionState`/`calendarState`（`fame` 在 `p.fame`，已有载体） | §7 落地清单 |

---

# 2. W5 · 事件库（68 条）

## 2.1 挂载方式（三选一，**推荐 A**）

**方案 A（推荐）· 修数据形态，走规格原设计**
```
70_world.json → { "worldEvents": { "onDayTick": [ {...68 条里挂在 onDayTick 的} ] } }
```
需工程做两件小事（**E1/E2**）：
1. `mergeData`：对 `events` / `worldEvents` 这两个键，**值是数组时保持数组**（不要把 `Object.assign({id}, array)` 硬揉）；
2. `fireEvent`：`handlers = this.data.events[name] || (this.data.worldEvents && this.data.worldEvents[name]) || []`，并加一道 `if (!Array.isArray(handlers)) handlers = Object.values(handlers).filter(x => x && typeof x === 'object' && (x.cond || x.effects));` 作**兼容兜底**（顺带复活现有 4 条）。

**方案 B（零风险兜底）· 写成 Mod 规则**
```json
"rules": [ { "kind":"onEvent", "target":"onDayTick", "cond": {...}, "effects": [...] } ]
```
**现在就能跑**（实测 Mod 的 `onEvent` 路径**未受 R1 影响**）。缺点：世界事件与 Mod 规则混在一起，语义上不干净。

**方案 C（不推荐）** 只在 `fireEvent` 里还原对象——治标，且会同时复活 4 条从未测过的旧事件。

> **本文的 68 条按方案 A 写**（`worldEvents.onDayTick`）。若工程选 B，只需把外层容器换成 `rules` + 加 `kind/target` 两个字段。**两种都能落地，本文不锁死。**

## 2.2 事件标准结构（**照真实 DSL，不新增语法**）

```json
{
  "id": "w5_debt_collector",
  "cat": "市井琐事",
  "name": "催债的上门",
  "cond": { "and": [ { "region": "market" }, { "var": "has_debt", "op": ">=", "value": 1 }, { "chance": 0.25 } ] },
  "effects": [
    "me:一个横眉竖眼的汉子堵在你面前",
    "say:欠我们东家的三十两，今天该还了吧？",
    "menu:怎么应答|还钱>-money:30;flag:paid_debt;say:他掂了掂银子，走了。;;硬扛>combat:mob_bandit;;打死他>-karma:15"
  ],
  "target": { "marks": ["债"] },
  "once": false,
  "cooldownDays": 7
}
```

**字段与真实引擎的对应**（**这一段是给工程与后续作者的关键约束**）：

| 字段 | 真实形态 | 备注 |
|---|---|---|
| `cond` | `evalCond` 支持的键：`season` `day` `region` `weather` `chance` `karma` `room` `time` `flag` `var` `rep` `and/or/not` | **实测全部为真**。⚠️ **`factionRel` 恒 true（R3）→ 本文不用它**；`day` 是 `opts` 形式 `{day:{op:'>=',value:N}}` 或直接数值 |
| `effects` | **字符串 DSL** 或对象形态，**两者都生效**（实测） | `say:文本` · `me:文本` · `narrate` 用对象形态 `{type:'narrate',raw:'…'}`（字符串 DSL 无 `narrate`）→ **本文长旁白一律用对象形态** |
| `menu` | ⚠️ **`menu:标题\|选项A>效1;效2;;选项B>效3`** | **R5**：`|` 分标题，`;;` 分选项，**单个选项内的多个 effect 用 `;`**。**写错不报错，只会吃掉第一个选项** |
| `+rep` | `+rep:key:值` / `-rep:key:值`（`key` 可 `*` 或门派 id 或 `朝廷`） | 实测 `parseEffectString` 在**第一个 `:`** 处切分 → 所以 `-rep:*:5` 正确 |
| `spawn` | `spawn:npcId:roomId:数量` | 三个参数都是 `args`；**roomId 必须是真实房间** |
| `var` | `var:名=值`（从 `raw` 里解析 `k=v`） | 值可以是数字/`true`/`false` |
| `combat` | ⚠️ **禁止用在 `onDayTick` 事件里** | 跨日无战斗上下文，实测会抛 `reading 'inCombat'`（§1.2） |
| `cooldownDays` / `once` | 引擎**目前不认**这两个字段（属新机制） | **需工程新增**（E4）；在它们落地前，靠 `flag` + `notFlag` 手写冷却才是安全的 |

## 2.3 68 条总表（8 类 · 逐条给 id / 触发 / 玩家察觉 / 驱动源）

> **列说明**：`驱动` = `世界`（纯时间/天气/季节驱动，与玩家无关）· `玩家影响`（cond 读玩家状态）——**这一列是给 §5 边界用的**。
> `察觉` = 玩家怎么发现这件事（类别定义见 §2.4）。

### 类 1 · 江湖恩怨（12 条）· **全部"玩家影响"**

| id | 名 | cond 关键项 | 察觉 |
|---|---|---|---|
| `w5_foe_ambush` | 仇家堵路 | `var foe_count>=1` + `chance .15` | A 当场 |
| `w5_foe_letter` | 下战书 | `var foe_count>=1` + `day%7==0` | H 差事 |
| `w5_foe_arson` | 半夜放火 | `time` 夜 + `var foe_count>=1` | B 房描 + D 传闻 |
| `w5_foe_bribe` | 托人递话 | `var rumor_heat_bad_max>=10` + `chance .2`（**原 `rep:*<0` → 对表后改读 heat，见 §5.5.3**） | C 台词 |
| `w5_foe_duel` | 约架 | `fame[region]>=30` + `chance .2` | A 当场 |
| `w5_foe_poison` | 酒里下药 | `region market` + `var foe_count>=1` | G 状态（中毒） |
| `w5_foe_snatch` | 抢你的货 | `item sack_coarse` + `chance .1` | A 当场 |
| `w5_foe_slander` | 造你的谣 | `var rumor_heat_max>=30`（**原 `rep:*>=20` → 见 §5.5.3**） | D 传闻 |
| `w5_foe_kin` | 仇家拿你的家眷做筏 | `var has_spouse>=1`（**含妾；对表后收窄，见 §5.5.5**） | H 差事 |
| `w5_foe_pact` | 仇家结盟 | `var foe_count>=2` | D 传闻 |
| `w5_foe_repent` | 仇家求和 | `var foe_count>=1` + `karma>-30` | C 台词 |
| `w5_foe_debt` | 旧债做文章 | `var has_debt>=1` | H 差事 |

### 类 2 · 官府缉拿（8 条）· **全部"玩家影响"**

| id | 名 | cond 关键项 | 察觉 |
|---|---|---|---|
| `w5_wanted_poster` | 画影图形 | `region jiangnan` + `karma<=-30` + `chance .3` | B 房描 + G 状态 |
| `w5_wanted_check` | 官道盘查 | `region ∈ 官道` + `p.wanted>0` | A 当场 |
| `w5_wanted_reward` | 悬赏告示 | `p.wanted>=30` | D 传闻 |
| `w5_wanted_raid` | 查夜 | `time` 夜 + `p.wanted>0` | A 当场 |
| `w5_wanted_trap` | 设局相请 | `rep:朝廷<0` + `chance .15` | H 差事 |
| `w5_wanted_seal` | 城门查验 | `room` 城门 + `p.wanted>0` | A 当场 |
| `w5_wanted_bounty` | 缉捕 | `fame[region]>=40` + `karma<=-30` | A 当场 + G `jail` |
| `w5_wanted_amnesty` | 大赦 | `day%120==0` + `p.wanted>0` | B 房描 + G 状态 |

### 类 3 · 天灾饥荒（6 条）· **全部"世界"**

| id | 名 | cond 关键项 | 察觉 |
|---|---|---|---|
| `w5_locust` | 蝗灾 | `season summer` + `region farmland` + `chance .12` | E 物价 + D 传闻 |
| `w5_flood` | 河堤决口 | `season summer`+`day%120∈[85,88]`+`region cunzhen` | B 房描 + E 物价 |
| `w5_refugee` | 流民入城 | `flag famine_year` + `region market` | A 当场（spawn 流民 NPC 观感） |
| `w5_grain_price` | 粮价上涨 | `var grain_price>=2` | E 物价 |
| `w5_drought` | 大旱 | `season summer` + `region farmland` + `chance .08` | B 房描 |
| `w5_plague` | 时疫 | `season autumn` + `region ∈ {jiangnan, cunzhen}` + `chance .06` | B 房描 + E 物价 |

### 类 4 · 秘境现世（6 条）· **"世界"（3 条需前置 flag，属"玩家影响"）**

| id | 名 | cond 关键项 | 察觉 | 驱动 |
|---|---|---|---|---|
| `w5_siguya_open` | 思过崖后洞 | `room huashan_siguoya` + `flag know_siguya` + `chance .2` | A 当场 | 玩家影响 |
| `w5_gumu_open` | 古墓现世 | `day%30==0` + `room gumu_shan` | A 当场 | 世界 |
| `w5_jianzhong` | 剑冢出土 | `room huashan_siguoya` + `day%30==7` + `chance .15` | A 当场 | 世界 |
| `w5_cangjing_lost` | 藏经阁失窃 | `room shaolin_cangjing` + `day%30==3` | D 传闻 | 世界 |
| `w5_xiake_dukou` | 侠客岛渡口 | `room xiake_dukou` + `day%30==15` | A 当场 | 世界 |
| `w5_jinguo_tomb` | 旧陵主墓 | `room jinguo_shi` + `flag jinguo_open` | A 当场 | 玩家影响 |

### 类 5 · 门派纷争（10 条）· **混合（6 世界 / 4 玩家影响）**

| id | 名 | cond 关键项 | 察觉 | 驱动 |
|---|---|---|---|---|
| `w5_sect_clash` | 两派械斗 | `var faction_rel_huashan_mojiao < -40` + `chance .2` | A 当场 | 玩家影响 |
| `w5_sect_provoke` | 弟子下山挑衅 | `var faction_power_mojiao>=70` | C 台词 | 世界 |
| `w5_sect_master_change` | 掌门换人 | `var faction_power_<id><25` | C 台词 + D 传闻 | 世界 |
| `w5_sect_treasure` | 镇派之宝失窃 | `day%30==12` + `chance .15` | H 差事 | 世界 |
| `w5_sect_recruit` | 大开山门 | `var faction_power_<id>>80` | H 差事 | 世界 |
| `w5_sect_expel` | 清理门户 | `var faction_power_<id><30` | C 台词 | 世界 |
| `w5_sect_mercy` | 有人出面调解 | `var faction_rel_<a>_<b> < -60` + `karma>20` | C 台词 | 玩家影响 |
| `w5_sect_alliance` | 两派结盟 | `var faction_rel_<a>_<b> > 60` | D 传闻 | 世界 |
| `w5_sect_broke` | 门派窘迫 | `var faction_treasury_<id><0` | C 台词 + E 物价 | 世界 |
| `w5_sect_hunt` | 联手追杀你 | `var rumor_heat_bad_max>=70` + `var faction_rel_all < -30`（**原 `rep:*<=-40` → 见 §5.5.3**） | A 当场 | 玩家影响 |

### 类 6 · 市井琐事（12 条）· **全部"世界"**

| id | 名 | cond 关键项 | 察觉 |
|---|---|---|---|
| `w5_debt_collector` | 催债的上门 | `region market` + `var has_debt>=1` | A 当场 |
| `w5_streetfight` | 当街斗殴 | `region market` + `chance .12` | A 当场 |
| `w5_pickpocket` | 扒手 | `region market` + `chance .1` + `-money` | G 状态 |
| `w5_storyteller` | 说书人 | `room jn_teahouse` + `chance .2` | C 台词 + D 传闻 |
| `w5_cockfight` | 斗鸡 | `room jn_market_north` + `chance .15` | A 当场 |
| `w5_matchmaker` | 媒婆说亲 | `age>=18` + `chance .08` | H 差事 |
| `w5_lost_child` | 孩童走失 | `region market` + `time 480~1080` + `chance .08` | H 差事 |
| `w5_drunk` | 醉汉闹事 | `room jn_wine_house` + `time 夜` | A 当场 |
| `w5_theft` | 铺面失窃 | `room jn_silk_shop` + `chance .08` | A 当场 |
| `w5_wedding` | 迎亲 | `region jiangnan` + `chance .06` | A 当场 |
| `w5_funeral` | 出殡 | `region cunzhen` + `chance .06` | A 当场 |
| `w5_gambling` | 赌坊开庄 | `room jn_wine_room` + `chance .2` | A 当场 |

### 类 7 · 商路货殖（8 条）· **"世界"（1 条玩家影响）**

| id | 名 | cond 关键项 | 察觉 | 驱动 |
|---|---|---|---|---|
| `w5_escort_robbed` | 镖银被劫 | `region gaibang` + `chance .15` | A 当场 | 世界 |
| `w5_caravan` | 商队遇匪 | `region xiyu` + `chance .15` | A 当场 | 世界 |
| `w5_price_swing` | 货价波动 | `region harbor` + `chance .25` | E 物价 | 世界 |
| `w5_smuggle` | 走私被发现 | `region harbor` + `time 夜` + `chance .1` | A 当场 | 世界 |
| `w5_ship_delay` | 船期延误 | `weather 雨` + `region haitan` | B 房描 | 世界 |
| `w5_market_fair` | 码头开市 | `day%10==0` + `region harbor` | A 当场 + E 物价 | 世界 |
| `w5_bandit_toll` | 山贼设卡 | `room road_jiangnan_2` + `chance .12` | A 当场 | 世界 |
| `w5_salt_run` | 盐车过境 | `region xixia` + `flag yu_ledger` | H 差事 | 玩家影响 |

### 类 8 · 边关烽火（6 条）· **全部"世界"**

| id | 名 | cond 关键项 | 察觉 |
|---|---|---|---|
| `w5_border_levy` | 边军征丁 | `region beijiang` + `chance .1` | H 差事 |
| `w5_hu_raid` | 胡骑南下 | `region ∈ {many, xixia}` + `season winter` | A 当场 |
| `w5_beacon` | 烽火台举烟 | `room road_beijiang_1` + `chance .15` | B 房描 |
| `w5_border_market_close` | 边市关闭 | `region xiyu` + `flag hu_raid` | B 房描 + E 物价 |
| `w5_snow_block` | 雪封山 | `season winter` + `region ∈ {beijiang, gumu}` | F 门禁 |
| `w5_deserter` | 逃兵 | `region beijiang` + `chance .1` | H 差事 |

**配额核对**：12+8+6+6+10+12+8+6 = **68 ✓**
**驱动源核对**：世界 **48** 条 / 玩家影响 **20** 条（类1 全 12 + 类2 全 8 = 20；类 4/5/7 里另有 3 条因前置 flag 归"玩家影响"，但它们的**触发源仍是时间**——见 §5.2 的细分）。
**`once:true` 只给了 4 条**（`w5_siguya_open` / `w5_gumu_open` / `w5_jinguo_tomb` / `w5_cant…`），**不是规格说的 20 条**：120 天一年，20 条一次性的世界事件会在头一年把世界"用完"，**宁可让它们可重复 + 长冷却**。

## 2.4 玩家的"察觉方式"共 8 类（**这是 W5 的验收抓手**）

| 类 | 名称 | 玩家在哪看到 | 落地手段 |
|---|---|---|---|
| **A** | 当场演出 | 进房/推进时间时的一句 `me:`/`narrate` | `effects` 直接出字（最简单） |
| **B** | 房间描述变了 | 同一房间的 `desc` 语境变化（不下雨了/墙塌了/贴了告示） | `narrate` **按 flag 分支**（不写死进 `desc`） |
| **C** | NPC 台词变了 | 该 NPC `talk` 时说不同的话 | `flag` + `talk` 渲染时查（**需工程加一层**） |
| **D** | **传闻传开了** | `打听` / 茶馆邻桌 / `ask` | **`addRumor()`**（注意 R2/R4） |
| **E** | 物价变了 | 商店买卖价 | `p.vars.grain_price` 等 → `buy` 倍率（**需工程加一层**） |
| **F** | 路不通了 | 临时封路/哨卡 | ⚠️ **`exits` 是静态数据，运行期不能改门禁** → 只能"用 `narrate` 说路封了 + 在目的地放一个拦截事件"（**诚实降级**，见 §6-3） |
| **G** | 你的状态变了 | 属性面板/恶名/通缉/在牢里 | `+karma` `-rep` `var wanted` `jail` |
| **H** | 多了一桩差事 | 告示/托付 → 可接的任务 | `+flag` 开一条任务线（接口留 #115） |

> **每一条事件至少占 A–H 中的一类**，A 类占 40/68，D 类 18/68，E 类 9/68，H 类 12/68。

## 2.5 例证（10 条完整可粘贴 JSON，每类 1~2 条）

```json
{ "id":"w5_foe_ambush", "cat":"江湖恩怨", "name":"仇家堵路",
  "cond":{ "and":[ {"var":"foe_count","op":">=","value":1}, {"chance":0.15} ] },
  "effects":[
    {"type":"me","raw":"路当中站着几个人，挡住了去路"},
    "say:姓{player}的，我寻你三个月了。",
    "menu:如何应付|拔剑>combat:mob_bandit_chief;;讲理>-karma:5;;转身就走>-rep:*:-8"
  ],
  "cooldownDays":10 }

{ "id":"w5_wanted_poster", "cat":"官府缉拿", "name":"画影图形",
  "cond":{ "and":[ {"region":"jiangnan"}, {"karma":{"op":"<=","value":-30}}, {"chance":0.3} ] },
  "effects":[
    {"type":"narrate","raw":"城门口新贴了一张告示，画上的人眉眼竟有几分像你。围看的人散了又聚。"},
    "flag:wanted_jiangnan",
    "-rep:朝廷:20"
  ],
  "cooldownDays":30 }

{ "id":"w5_locust", "cat":"天灾饥荒", "name":"蝗灾",
  "cond":{ "and":[ {"season":"summer"}, {"region":"farmland"}, {"chance":0.12} ] },
  "effects":[
    {"type":"narrate","raw":"天边飞来一片黄云。落到地里才知道是蝗虫——它们不叫，只响。"},
    "var:grain_price=3",
    "flag:famine_year"
  ],
  "cooldownDays":60 }

{ "id":"w5_gumu_open", "cat":"秘境现世", "name":"古墓现世",
  "cond":{ "and":[ {"room":"gumu_mu"}, {"day":{"op":">=","value":30}}, {"chance":0.2} ] },
  "effects":[
    {"type":"narrate","raw":"石室的门缝里透出一线冷气，门轴上却没有灰——像刚有人开过。"},
    "flag:gumu_shishi_open",
    "+exp:300"
  ],
  "once":true }

{ "id":"w5_sect_clash", "cat":"门派纷争", "name":"两派械斗",
  "cond":{ "and":[ {"var":"faction_rel_huashan_mojiao","op":"<","value":-40}, {"chance":0.2} ] },
  "effects":[
    {"type":"me","raw":"山道上一伙人正打得难解难分"},
    "spawn:mob_mo_disciple:road_huashan_1:3",
    "menu:帮谁|帮华山>+rep:huashan:20;;帮魔教>+rep:mojiao:20;;都不帮>-rep:*:3"
  ],
  "cooldownDays":20 }

{ "id":"w5_lost_child", "cat":"市井琐事", "name":"孩童走失",
  "cond":{ "and":[ {"region":"market"}, {"time":{"min":480,"max":1080}}, {"chance":0.08} ] },
  "effects":[
    {"type":"narrate","raw":"一个妇人沿街哭喊，说她家伢子不见了。她的嗓子已经喊哑了。"},
    "menu:管不管|帮着找>+karma:5;+pot:30;;不管>-karma:2"
  ],
  "cooldownDays":5 }

{ "id":"w5_storyteller", "cat":"市井琐事", "name":"说书人",
  "cond":{ "and":[ {"room":"jn_teahouse"}, {"chance":0.2} ] },
  "effects":[
    {"type":"narrate","raw":"茶博士把长嘴壶一提，满堂安静下来。说书的清了清嗓子。"},
    "menu:听不听|听完再走>-money:2;+pot:15;;不听了>flag:skip_story"
  ],
  "cooldownDays":3 }

{ "id":"w5_price_swing", "cat":"商路货殖", "name":"货价波动",
  "cond":{ "and":[ {"region":"harbor"}, {"chance":0.25} ] },
  "effects":[
    {"type":"narrate","raw":"码头上几条船刚靠岸，脚夫们喊的价，比上个月高了两成。"},
    "var:price_harbor=1.2"
  ],
  "cooldownDays":10 }

{ "id":"w5_beacon", "cat":"边关烽火", "name":"烽火台举烟",
  "cond":{ "and":[ {"room":"road_beijiang_1"}, {"chance":0.15} ] },
  "effects":[
    {"type":"narrate","raw":"西北方向升起了三道烟。头一道是黑的，第二道也是黑的，第三道隔了很久才起来。"},
    "flag:hu_raid_warn"
  ],
  "cooldownDays":30 }

{ "id":"w5_debt_collector", "cat":"市井琐事", "name":"催债的上门",
  "cond":{ "and":[ {"region":"market"}, {"var":"has_debt","op":">=","value":1}, {"chance":0.25} ] },
  "effects":[
    {"type":"me","raw":"一个横眉竖眼的汉子堵在你面前"},
    "say:欠我们东家的三十两，今天该还了吧？",
    "menu:怎么应答|还钱>-money:30;flag:paid_debt;;硬扛>combat:mob_bandit;;打死他>-karma:15"
  ],
  "cooldownDays":7 }
```

> ⚠️ 上面 10 条里，**`w5_foe_ambush` / `w5_debt_collector` 用了 `combat:`**——**这两条不能挂在 `onDayTick` 上**（§1.2 的跨日抛错）。它们要挂 **`onEnter`**（玩家走进去才打）——**这一点是规格没区分的**：**68 条里凡 `effects` 含 `combat:` 的，一律挂 `onEnter`/`onTick`（玩家在场时），其余挂 `onDayTick`**。§7 的落地清单据此拆成两张表。

## 2.6 世界事件 → 传闻的接法（**与 #109 咬合，也是与 `design/25` 的交接面**）

**三步**（工程做）：
1. `applyRumorReputation()` 加 `subject` 守卫（**R4**）：`if ((opts.subject || 'player') !== 'player') return;` —— 一行，防世界事件污染玩家声望；
2. **世界事件不需要"目击者"语义**，但现在 `addRumor` 硬要求目击者（**R2**）→ 二选一：
   - **推荐**：给 `addRumor` 加一个"**免目击**"开关 `opts.silent = true`（世界事件本来就是"大家都知道的事"，被 NPC 听见不是前提）；
   - 备选：把传闻落在**有 NPC 的房间**（§1.4 的"可传播性地图"）。
3. 为世界事件**加一组"世界传闻种子"**（写法与 `rumorSeeds` 完全相同，**但要放进 `70_world.json` 的 `rumorSeeds` 里**，并让 `subject` 填世界/势力，不填 `player`）：

| 新种子 id | kind | polarity | weight | heat0 | tau | ttl | loud | 文本样例 |
|---|---|---|---|---|---|---|---|---|
| `rs_e_world_disaster` | 天灾 | 0 | 1.5 | 70 | 8 | 25 | true | 「北边今年的收成，怕是完了。」 |
| `rs_e_world_sect` | 门派 | 0 | 2.0 | 65 | 10 | 30 | true | 「听说了吗，{where}那两派动了刀子。」 |
| `rs_e_world_market` | 行情 | 0 | 1.0 | 50 | 6 | 15 | false | 「码头的货，这两天价不对。」 |
| `rs_e_world_wanted` | 官面 | −1 | 2.5 | 75 | 7 | 20 | true | 「城门口贴了图，说是要拿一个人。」 |

> **与 `design/25` 的分工（§5 详述）**：**"世界传闻种子"归本文**（时间驱动、无主角）；**"玩家传闻种子"归 #116/`design/25`**（`rumorsSeeds` 现有 16 条就是它那一侧）。**两边共用同一套 `addRumor`/`dailyRumorTick`/`打听`，只是种子不同、`subject` 不同。**

---

# 3. W6 · 势力消长

## 3.1 数据结构（`70_world.json` → `factions`，**用真 id**）

```json
"factions": {
  "huashan": {
    "id": "huashan", "name": "华山派", "kind": "门派",
    "align": "正道", "homeRegion": "huashan",
    "power": 62, "treasury": 3400,
    "territories": ["huashan"],
    "mood": "守成"
  },
  "court": { "id":"court","name":"朝廷","kind":"官府","align":"中立","homeRegion":"yamen",
             "power":55,"treasury":9000,"territories":["yamen","palace"],"mood":"巡查" },
  "gang":  { "id":"gang","name":"漕帮","kind":"商会","align":"中立","homeRegion":"harbor",
             "power":40,"treasury":5200,"territories":["harbor"],"mood":"走货" }
}
```
- **门派 14 个**用 §1.6 的真 id（**不是**规格的 `wudu`）；另加 **`court`（朝廷）** 与 **`gang`（漕帮）**。
- ⚠️ **`漕帮` 在 `data.sects` 里不存在**——它是 W6 **新造的势力**（有 `power`/`treasury`，但**不参与 `joinSect`**）。**朝廷同理**：它不是 sect，但 `reputation` 里有 `朝廷` 这个 key（`commands.js` 商店折扣在用）→ **W6 正好给它一个"实体"**。
- **`power` 初值（按实测弟子数重标定，R6）**：
  `power = clamp( 40 + 弟子数 × 6 + 掌门 level × 0.15 , 0 , 100 )`
  （实测代入：华山 40+18+~3=**61** · 少林 40+6+~4=**50** · 唐门/古墓/侠客岛（0 弟子）=**40+0+0=40** → **不会出现"0 弟子门派 power 为 0"的荒谬值**）
- **`relations` 初值**：沿用规格（正道↔正道 +40 / 正道↔魔道 −60 / 魔道↔魔道 −20 / ↔朝廷 正道 +20、魔道 −50）；**`court` 与所有门派按 align 给；`gang` 与所有门派 +10**（生意人不结仇）。

## 3.2 月度结算（`day % 30 === 0` 时在 `onDayTick` 里跑，**不新增 hook**）

**规格原公式的问题（R6）**：`收入 = Σ税基 × power/100`，而**实测税基全部 ≤2**（`jiangnan` 2、其余 0~1）；`支出 = 弟子数 × 8 + 战损`，而**实测弟子数 0~3**。
⇒ 原式代入后：收入 ~0.4~4 / 支出 ~0~24 → **几乎所有门派每月都在掉 power**（嵩山少林弟子 1 人，收入 1×0.5=0.5）。

**重标定（本文采用）**：
```
税基(region)  = 1 + floor(房数 / 12)                 // jiangnan 27→3 · market 20→2 · 小区域 1
月收入 I = Σ(territories) 税基 × (40 + power) / 100  // 每块地盘 0.56 ~ 2.8
月支出 E = 弟子数 × 3 + 战损(本月该派 NPC 死亡数 × 10) + (mood 为"进取" ? 4 : 0)
Δpower   = clamp( (I − E) * 0.6 , −4 , +4 ) + 事件冲击      // 单月最多 ±4，一年最多 ±16
Δtreasury = round( (I − E) * 20 )                            // 银子量级：几十两
```
- **设计意图**：**每月最多动 ±4**（原式 ±10 太快，30 天一变会让玩家"上周还在的门派，这周没了"）。**一年（120 天）动 ±16** —— 刚好够"局面变了"又不至于面目全非。
- **事件冲击**：本月的 `w5_sect_*` 类事件各给 ±3~6（写在事件的 `incvar/decvar` 里）。
- **关系漂移**：`Δrel[a][b] = clamp(−0.02 × (power_a − power_b), −3, +3)`，钳 −100~+100；**"本月共同御敌"给 +5**（原规格的 +0.5 太小，看不出）。
- **地盘易主**：`power < 20 且邻区势主 power > 70` → **8%** 概率失一块；`power > 85` → **8%** 概率并一块。（原 10% 可保留，本文取 8% 更稳。）

**运行值与模板分离**（照规格 §5.2 的思路）：`data.factions` 是**模板**（不随档），`world.factionState` 是**运行值**（随档）。**`factionState` 必须新增进 `serialize`/`deserialize`**，否则读档后势力走势被重置（而玩家的 `fame`/传闻都还在 → 世界"记忆错位"）。

## 3.3 可观测影响（**7 条，逐条写"玩家在哪看到什么"**）

| # | 影响面 | **玩家会在哪看到** | 落地位置 | 依赖 |
|---|---|---|---|---|
| 1 | **收徒门槛** | 走到山门**拜师被拒/被加试**，理由随 power 变（"本派今年收得紧"） | `sects[id].require` 运行期放宽/加严 | 需工程读 `factionState` |
| 2 | **商店折扣** | 买卖时**价钱不一样**（本派地盘更便宜） | `commands.js` buy（现有 reputation 折扣上叠一层） | 同上 |
| 3 | **巡卫密度** | 官道上**兵丁多了一个**（"朝廷"power 高时） | `50_map.json` 的 `respawn` **运行期**改 spawn 数（**不改数据文件**） | 同上 |
| 4 | **NPC 台词** | 找本派弟子说话，**台词按 `mood` 换一组**（守成/进取/窘迫/报复） | `talk` 渲染时查 `faction.mood` | ⚠️ **需工程加一层**（现在 `talk` 只在两处 `commands.js:950/1644` 里过滤，没有 mood 分支） |
| 5 | **任务可接性** | **多/少一桩差事**（`relations < −40` → 出"挑拨"类；`> 60` → 出"同盟"类） | quest 的 `cond`。⚠️ **不用 `factionRel`（R3 恒 true）**，改用 `var: faction_rel_a_b` | 需月度结算把 rel 写进 `p.vars` |
| 6 | **地盘标识** | 进区域时 `look` **多一行**"此处已是 XX 派的地盘" | `look` 渲染 | 同上 |
| 7 | **弟子游荡** | 官道上**撞见别派弟子**（power 高的门派弟子会出山） | `tick()` 里改写 `n.room`（**临时位移，随档不必存**） | 同上 |

> **验收抓手**：**第 1/2/3/6 四条最容易被玩家看见**（拜师/价钱/兵丁/一行字），**优先做这四条**；4/5/7 需要改渲染层，放第二波。

## 3.4 玩家与势力的互动（W6 的"手"）

| 玩家行为 | 对势力的影响 | 外显 |
|---|---|---|
| 拜师/叛门 | 该派 `power +2`；叛门则 `−6` 且 `rel[本派][你] 崩` | 山门口的迎拒、弟子的态度 |
| 交门派任务 | `treasury +` 小额、`power +0.5` | — |
| 杀该派弟子 | `power −3`、`relations[该派][凶手门派] −15` | 该派弟子见你敌对、月结算后可能"联手追杀" |
| 参与武林大会（§4） | 头名 `power +8`、`relations` 波动 | 会场迁移、传闻 |
| 赈灾（`+karma`） | `court.power +2`、`gang.power +3` | 粮价回落、流民减少 |

---

# 4. W7 · 节庆日历

## 4.1 时间底盘（**实测，照它写，不另起一套**）

| 量 | 实测 |
|---|---|
| `day` | `floor(clockMinutes / 1440)`，**开局 day=0** |
| 一季 | **30 天**（`w.season()` 实测返回 `'spring'` 等） |
| 一年 | **120 天** |
| 玩家一岁 | **120 天** |
| 夜 | `w.isNight()`（`clockMinutes%1440 < 300 或 >= 1140`） |
| 饭点 | `w.isMealTime()` |
| 判定方式 | **全部在 `onDayTick` 里 `day % 120` 查表**（不新增 hook） |

## 4.2 八节（`day % 120` 命中）

| d | 节 | 玩家能参与的**具体活动** | 外显 |
|---|---|---|---|
| **0** | 元日 | ①各派**发年赏**（去本派领 `+money`）②衙门**放假三日**（`jn_yamen_court`/`jn_yamen_office` 今日不办案 → `w5_wanted_*` 挂起）③街上爆竹声（`narrate`） | A 房描 + E 物价 + H 差事 |
| **15** | 上元 | ①**灯会**（`jn_market_main` 出灯摊、可买灯）②**贼窃事件概率 ×2**（`w5_pickpocket` 的 `chance` 在今日翻倍） | A 当场 + E 物价 |
| **35** | 清明 | ①**扫墓**（有"丧亲" mark 的 NPC mood −25）②坟茔区（`gumu_shan`）可遇祭扫人 | B 房描 + C 台词 |
| **55** | 端午 | ①**龙舟**（`jn_harbor` 赛事）②**可下注**（`menu`）③雄黄酒（`+food`） | A 当场 + G 状态 |
| **70** | 七夕 | ①未婚 NPC **成对出现**（`npcv_276`/`npcv_277` 之类 `social.js` 已能表达）②**媒婆类事件概率 ×3** | C 台词 + H 差事 |
| **95** | 中秋 | ①**门派停战三日**（`w5_sect_clash` 今日挂起）②`relations` 全部 **+5** ③**赏月**（山顶房间额外 `+pot`） | A 当场 + D 传闻 |
| **110** | 重阳 | ①**登高**（山顶房 `huashan_lianhua`/`wudang_jinding`/`emei_jinding` 奇遇概率 ×2）②**菊花酒**（`+food`） | A 当场 + E 物价 |
| **118~119** | 岁除 | ①**封印**：衙门不办案（`w5_wanted_*` 今日挂起）②街上**守岁**（`narrate`）③`day%120==0` 时**大赦**（清 `p.wanted`） | B 房描 + G 状态 |

## 4.3 五件周期大事

| 周期 | 名称 | 触发 | 玩家可参与 | 外显 | 依赖 |
|---|---|---|---|---|---|
| **每季**（`day%30==10`） | **门派大比** | 各派本山（`huashan_zhengqi`/`shaolin_lianwu`/`wudang_lianwu`/`emei_jinding`/`tangmen_hall`） | **报名参赛**（`menu`）→ 头名 `+rep:该派:50` + 传闻 `rs_tournament_win` | A 当场 + D 传闻 | 需一个"比试"流程（**可先用 `combat:` 对练代替**，属 #115 接口） |
| **每 2 年**（`day%240∈[60,63]`） | **武林大会** | 少林 ↔ 武当轮值（`shaolin_daxiong` / `wudang_zixiao`） | 观战/挑战/押注 | **NPC 向会场迁移**（`tick()` 改 `n.room`）+ 各派 `relations ±15` + 期间**无门派纷争** | 同上 |
| **每 3 年**（`day%360∈[30,33]`） | **科举** | `jn_school_hall` / `palace_street` | 有 `identity` 且无恶名的可应试（三场：帖经/诗赋/策问） | **`scholar` 类 NPC 全离城**（schedule 改写）→ 书院空房 + 放榜后回来改 tag | **依赖 SPRINT-D**（制度线），本文只标接口 |
| **每年**（`day%120∈[50,52]`） | **漕运开帮** | `jn_harbor` | 可受雇押货/打听行情 | 商路事件概率 ×3 + harbor 出现大量 `escort`/`merchant` | 无 |
| **每年**（`day%120∈[85,88]`） | **秋汛** | `farmland` / `cunzhen` | 可**赈灾**（`+karma`）或**趁涨抬价**（`-karma`/`+money`） | 河堤决口窗口 + 粮价 ×2 + 传闻 | 无 |

## 4.4 日历数据结构（照真实引擎可读的形态）

```json
"calendar": {
  "yearDays": 120, "seasonDays": 30, "monthDays": 30,
  "festivals": [
    { "day": 0, "id": "yuandan", "name": "元日",
      "effects": [ {"type":"narrate","raw":"城中爆竹声不断，家家户户贴了新联。"}, "flag:holiday_yuandan" ] },
    { "day": 15, "id": "shangyuan", "name": "上元", "effects": ["flag:holiday_shangyuan"] }
  ],
  "cycles": [
    { "id":"wulin_dahui","name":"武林大会","periodDays":240,"offset":60,"span":4,
      "venue":["shaolin_daxiong","wudang_zixiao"], "effects":["flag:cycle_wulin"] }
  ]
}
```
- **判定**（写在 `onDayTick` 的世界事件处理器里）：`d = day % 120` 查 `festivals`；再对每个 `cycles` 判 `day % periodDays ∈ [offset, offset+span)` → 命中则 `evalEffects(entry.effects)`。
- **节日的"挂起/翻倍"效果**（如中秋停战、上元贼窃×2）**不要写进 `exit`/`desc` 数据**，用**节庆 flag**（`holiday_zhongqiu`）让相关事件自己判断 —— **这样"数据不动，行为变"**。

---

# 5. 与 `design/25`（#116）的边界

> ⚠️ **`design/25-story-rumor-binding.md` 目前尚未交付**（`design/` 目录下无此文件；现有的是 `23-sidequests-portrait-hooks.md` 与 `26-npc-skill-map.md`）。
> 因此本节是**划界提案**，等 `design/25` 落地后再对齐（**§6 已列为待确认项**）。

## 5.1 一句话分界（**建议）**

> **`design/25`（#116）= 玩家做过什么 → 世界怎么说你**（**玩家驱动**，主体是 `player`）
> **本文（W5–W7）= 世界自己在动 → 你赶上什么**（**时间驱动**，主体是 `world` / `faction`）

## 5.2 逐条标注（**这是任务书要求的"是否可由玩家行为触发"**）

| W5 类别 | 条数 | 驱动源 | 与 `design/25` 的关系 |
|---|---|---|---|
| 类 3 天灾饥荒 | 6 | **纯世界** | **不重叠**（玩家不可能"做"出一场蝗灾） |
| 类 6 市井琐事 | 12 | **纯世界** | **不重叠** |
| 类 7 商路货殖 | 8 | **纯世界**（7）+ 玩家影响(1：`w5_salt_run` 需 `yu_ledger`) | 基本不重叠 |
| 类 8 边关烽火 | 6 | **纯世界** | **不重叠** |
| 类 4 秘境现世 | 6 | **世界**（4）+ 前置 flag（2） | **不重叠**（前置 flag 是"你能不能进"，不是"世界说你什么"） |
| **类 1 江湖恩怨** | **12** | **全部玩家影响**（`fame`/`karma`/仇家/`rep`） | ⚠️ **最可能与 `design/25` 重叠** |
| **类 2 官府缉拿** | **8** | **全部玩家影响**（`p.wanted`/`karma`/`fame`） | ⚠️ **最可能与 `design/25` 重叠** |
| **类 5 门派纷争** | 10 | 混合；其中 `w5_sect_clash`/`w5_sect_mercy`/`w5_sect_hunt` **读玩家状态** | ⚠️ 3 条可能重叠 |

**⇒ 点名的"可能重叠"共 23 条**（类1 的 12 + 类2 的 8 + 类5 的 3）：
`w5_foe_ambush` `w5_foe_letter` `w5_foe_arson` `w5_foe_bribe` `w5_foe_duel` `w5_foe_poison` `w5_foe_snatch` `w5_foe_slander` `w5_foe_kin` `w5_foe_pact` `w5_foe_repent` `w5_foe_debt` ·
`w5_wanted_poster` `w5_wanted_check` `w5_wanted_reward` `w5_wanted_raid` `w5_wanted_trap` `w5_wanted_seal` `w5_wanted_bounty` `w5_wanted_amnesty` ·
`w5_sect_clash` `w5_sect_mercy` `w5_sect_hunt`

## 5.3 归属表（23 条逐条；**判据由 team-lead 拍板，本节按判据过一遍**）

> ### 🔒 所有权声明（**单一所有权，写死**）
> **事件定义唯一归 W5；#116 只负责把玩家行为转成这些事件的输入变量，不得重复定义事件。**
>
> 即：下表的"归属"列**没有第二方所有者** —— 23 条事件体**全部**在 W5（本文）。
> 表中出现的「需 #116 提供前置变量」，说的是 **#116 的义务（给输入）**，**不是它的定义权**。
> 这样划界的目的正是**避免两处写同一件事**。

> **team-lead 判据（原文）**：
> - 触发源是**时间/世界自身** → **归 W5（本文）**；
> - 触发源是**玩家的某个具体行为** → **归 #116（`design/25`）**；
> - 两者都成立 → **W5 拥有"事件定义"，#116 只写"玩家的行为如何把它引爆"**（#116 引用 W5 的 event id，**不重复定义**）。
> 并已点名：**类 2 官府缉拿 8 条 → 归 W5**（官府是自主发动的，不是玩家行为）。

### 5.3.1 判据操作化（把这句话翻译成可执行的测试）

判"**扳机由谁扣动**"，看事件的 fire 那一下是谁造成的：

| 测试 | 结果 | 归属记号 |
|---|---|---|
| fire 由**世界时钟**扣动（`day%N` / `season` / `time` / `chance` 掷骰），玩家状态只是"**够不够格**"的 `cond` 门槛 | 世界自主 | **W5 定义（自足）** |
| fire 仍需世界时钟，但**事件内容直接挂靠玩家的"具体持有/具体关系/具体旧账"**（换一个没做过那件事的玩家就不成立） | 需 #116 供给前置变量 | **W5 定义（需 #116 提供前置变量）** |
| 内容本身就是"**把玩家事迹变成世界记忆／传闻**"，无独立世界逻辑 | 玩家驱动 | **归 #116**（本文不复述） |

> 说明：**没有一条属于第三档** —— 这 23 条**全部由世界时钟发动**，所以不存在"纯归 #116"的条目。
> **无论它读不读玩家变量，事件定义都在 W5**；#116 的角色只是**给第二档的"前置状态从哪来"**（仇家怎么产生、债从哪来、谁的恩义）当输入。

### 5.3.2 23 条归属表（逐条一行）

> **"归属"列 = 事件定义的唯一所有者。** 23 条全部是 **W5**；括号内区分它是"自足"还是"需 #116 喂前置变量"。

| # | id | 名 | fire 的扳机（cond 关键项） | 归属（**唯一归 W5**） | 理由（一句话） |
|---|---|---|---|---|---|
| **类 2 · 官府缉拿（8 条 → 全部归 W5）** | | | | | |
| 1 | `w5_wanted_poster` | 画影图形 | `region jiangnan`+`karma<=-30`+`chance .3` | **W5 定义（自足）** | 官府自主张贴，官府是 N 权主体 |
| 2 | `w5_wanted_check` | 官道盘查 | `region ∈ 官道`+`p.wanted>0` | **W5 定义（自足）** | 官府设卡，自主 |
| 3 | `w5_wanted_reward` | 悬赏告示 | `p.wanted>=30` | **W5 定义（自足）** | 官府悬赏，自主 |
| 4 | `w5_wanted_raid` | 查夜 | `time 夜`+`p.wanted>0` | **W5 定义（自足）** | 官府夜巡，自主 |
| 5 | `w5_wanted_trap` | 设局相请 | `rep:朝廷<0`+`chance .15` | **W5 定义（自足）** | 官府设局，自主 |
| 6 | `w5_wanted_seal` | 城门查验 | `room 城门`+`p.wanted>0` | **W5 定义（自足）** | 官府查验，自主 |
| 7 | `w5_wanted_bounty` | 缉捕 | `fame[region]>=40`+`karma<=-30` | **W5 定义（自足）** | 官府缉捕，自主（后果 `jail` 也归 W5） |
| 8 | `w5_wanted_amnesty` | 大赦 | `day%120==0`+`p.wanted>0` | **W5 定义（自足）** | 朝廷大赦，纯时间驱动 |
| **类 1 · 江湖恩怨（12 条 → 逐条；6 自足 / 6 需 #116 输入）** | | | | | |
| 9 | `w5_foe_ambush` | 仇家堵路 | `foe_count>=1`+`chance .15` | **W5 定义（自足）** | 仇家**亲自上门** |
| 10 | `w5_foe_letter` | 下战书 | `foe_count>=1`+`day%7==0` | **W5 定义（自足）** | 仇家**亲自下书** |
| 11 | `w5_foe_arson` | 半夜放火 | `time 夜`+`foe_count>=1` | **W5 定义（自足）** | 仇家**亲自作案** |
| 12 | `w5_foe_duel` | 约架 | `fame[region]>=30`+`chance .2` | **W5 定义（自足）** | 按江湖规矩**亲自约战** |
| 13 | `w5_foe_poison` | 酒里下药 | `region market`+`foe_count>=1` | **W5 定义（自足）** | 仇家**亲自下手** |
| 14 | `w5_foe_repent` | 仇家求和 | `foe_count>=1`+`karma>-30` | **W5 定义（自足）** | 仇家**亲自上门求和** |
| 15 | `w5_foe_bribe` | 托人递话 | `var rumor_heat_bad_max>=10`+`chance .2` | **W5 定义（需 #116 前置变量）** | **借他人之口**；#116 提供"谁替你/他传话、你和谁结的怨" |
| 16 | `w5_foe_slander` | 造你的谣 | `var rumor_heat_max>=30` | **W5 定义（需 #116 前置变量）** | **借传闻系统**；事件体在 W5，谣的**来路**由 #116 供给 |
| 17 | `w5_foe_snatch` | 抢你的货 | `item sack_coarse`+`chance .1` | **W5 定义（需 #116 前置变量）** | 针对你的**具体持有物**；#116 记"你运了什么货、得罪了谁" |
| 18 | `w5_foe_kin` | 仇家拿你的家眷做筏 | `var has_spouse>=1`（含妾） | **W5 定义（需 #116 前置变量）** | 针对你的**妻 / 妾**（对表后收窄，见 §5.5.5）；#116 记"谁的妻妾、谁的家眷" |
| 19 | `w5_foe_pact` | 仇家结盟 | `var foe_count>=2` | **W5 定义（需 #116 前置变量）** | **借势力聚合**；#116 记"多个仇家的各自来路" |
| 20 | `w5_foe_debt` | 旧债做文章 | `var has_debt>=1` | **W5 定义（需 #116 前置变量）** | 针对**具体旧账**；#116 记"债从哪来、债主是谁" |
| **类 5 · 门派纷争（3 条中，与玩家相关的部分）** | | | | | |
| 21 | `w5_sect_clash` | 两派械斗 | `faction_rel_huashan_mojiao<-40`+`chance .2` | **W5 定义（自足）** | 扳机是 **W6 势力关系**（N 权主体自主，玩家只是旁观/被波及） |
| 22 | `w5_sect_mercy` | 有人出面调解 | `faction_rel<-60`+`karma>20` | **W5 定义（需 #116 前置变量）** | 因你的**善名**（`karma`）才有这一出；#116 记"善名怎么来的" |
| 23 | `w5_sect_hunt` | 联手追杀你 | `var rumor_heat_bad_max>=70`+`faction_rel_all<-30` | **W5 定义（需 #116 前置变量）** | 因你的**恶名**（`rumor_heat_bad_max`）而来；#116 记"恶名怎么来的" |

### 5.3.3 分布小结（**单一所有权：23/23 归 W5**）

| 归属（**全部是 W5**） | 条数 | 明细 |
|---|---|---|
| **W5 定义 · 自足**（世界/机构/N 权主体自主，玩家状态仅门槛） | **15** | 类2 全 8 + 类1 6（`ambush`/`letter`/`arson`/`duel`/`poison`/`repent`）+ 类5 1（`clash`） |
| **W5 定义 · 需 #116 提供前置变量**（#116 的**义务**，非定义权） | **8** | 类1 6（`bribe`/`slander`/`snatch`/`kin`/`pact`/`debt`）+ 类5 2（`mercy`/`hunt`） |
| **纯归 #116**（世界记忆，无独立事件） | **0** | —— |

**⇒ 一句话给开发**：这 23 条**事件定义唯一归 W5（23/23）**；其中 **8 条**需 #116 先**提供前置变量**（`foe_count` / `has_debt` / `has_spouse` / `rep` / `karma` 的**写入规则**）才能被引爆 —— **#116 给输入，不给定义**。

### 5.3.4 需要 #116 提供的 3 项接口（**#116 的义务；对表时逐条核**）

| # | #116 需产出 | 本文消费它的位置 |
|---|---|---|
| a | **前置变量的写入规则**：`foe_count`（你杀了/得罪了谁 → +1、名字记进仇家表）、`has_debt`、`has_spouse` | 类1 的 6 条「需 #116 前置变量」事件 `cond` |
| b | **你的恶名/善名如何变成 `rep:*` / `karma` 的源头**（哪条 `rs_*` 种子、涨多少） | 类1 `bribe`/`slander`、类5 `mercy`/`hunt` |
| c | **传闻热度回写**：`dailyRumorTick` 每天算完后把 `max(heat of subject==player)` 写进 `p.vars.rumor_heat_max` | 让 `w5_wanted_*` 可读它当 `cond`（**不用新 hook**，是规格 §2.2 那个 `onRumorHeat` 想干的事的替代实现） |

> ⚠️ **收敛说明（team-lead 拍板）**：原表曾把 8 条写成「W5 定义 + #116 引用」，**易变成两套定义打架**。
> 现**取消"双源"概念**，改为**单一所有权**：**事件定义唯一归 W5（23/23）**；#116 只把玩家行为转成**输入变量**。
> **✅ 对表已完成（2026-10-11）**：`design/25` v1.1 §10 交付后，本表与 `roster-A` 的契约已逐条对齐，**"提案"状态解除** —— 结果见 **§5.5**（5 已对齐 / 3 需改 cond / 缺 1 变量）。

> 🔁 **上表 a/b/c 的落地状态（对表后更新）**：
> - **a** 已完成 —— `#116` 日结算写 `foe_count`/`has_debt`/`has_spouse`（含妾）。
> - **b** **改为 c 的形态**：不再拿 `rep`（量级不对），`bribe`/`slander`/`hunt` 三条**改读 `rumor_heat_*`**（阈值见 §5.5.3）；`mercy` 仍用 native `karma`。
> - **c** 已完成 —— `dailyRumorTick` 末尾写 `rumor_heat_max` **及新增 `rumor_heat_bad_max`**（见 §5.5.2）。

## 5.4 共用资产（**两边都别各造一套**）

| 资产 | 归属 | 说明 |
|---|---|---|
| `addRumor()` / `dailyRumorTick()` / `kFlow` / `regionAdj` | **已落地的公共底座** | 本文与 25 **共用** |
| `rumorSeeds`（现有 16 条 = 玩家行为侧） | **`design/25`** | 本文**不改**这 16 条 |
| **世界传闻种子**（§2.6 的 4 条 `rs_e_world_*`） | **本文** | 新增，同放 `rumorSeeds` 里，`subject` 非 `player` |
| `打听` / `ask` 渲染 | 共用 | 世界传闻与玩家传闻**用同一个入口**（这正是"咬合"） |
| `onRumorBorn` / `onRumorHeat` | **`design/25`** | 本文不需要（改用日结算写 `p.vars`） |

## 5.5 与 `#116`（`design/25` v1.1 §10）**对表结果**

> 材料：`design/25-story-rumor-binding.md` **v1.1 §10**（team-lead 中转，跨组走主理人）。
> 契约铁律：**`#116` 只写、`W5` 只读**（`W5` 决不自己写这些 var，只在 `cond` 里比较）。
> 本节即 §5.3 那张表的**对表收尾**；`roster-A` 已交付，故 §5.3 的"提案"状态**解除**。

### 5.5.1 一句话结论

- W5 侧共 **8 条**事件读 `#116` 的变量：**5 条已对齐 · 3 条需改 cond**（都由 `rep:*` 改读 `rumor_heat_*`，见 §5.5.3）。
- **类2 通缉 8 条不读 heat**（用 `p.wanted` / `karma`），**不存在"行善成名的玩家被通缉"风险**。
- **缺 1 个变量**（`has_confidant`）＋ **1 类变量没人提供**（"善名"分量），**点名见 §5.5.5**。

### 5.5.2 变量契约（`#116` → `W5`；全在 `p.vars.*`）

| 变量 | 含义 | W5 拿它当 | 写入方 |
|---|---|---|---|
| `foe_count` | 仇家数（≥0） | `>=` 比较 | #116 |
| `has_debt` | 有无旧债（`0/1`） | `==1` | #116 |
| `has_spouse` | 有无配偶（**含妾**，`0/1`） | `==1` | #116 |
| `rumor_heat_max` | **名气总量**（不分善恶，`0~100`） | `>=` 比较 | #116 |
| `rumor_heat_bad_max` | **恶名分量**（只算 `polarity<0`，`0~100`） | `>=` 比较 | #116 |
| `wanted`(辅) | 通缉度（≥0） | `>` 比较 | #116 |
| `fame_here`(辅) | 本地区名气（`0~100`） | `>=` 比较 | #116 |
| `fame_max`(辅) | 最高名气（`0~100`） | `>=` 比较 | #116 |

**写入时机（W5 须对齐）**：**每日一次、在 `dailyRumorTick()` 末尾全量重算**（幂等、自愈），**先于** `fireEvent('onDayTick')`。
⇒ W5 当日事件读到的**必然是最新值**。
> ✅ 与本文 **§1.2 实测**的 `onDayTick` 顺序**一致**（实测：`dailyRumorTick()` 先、`fireEvent('onDayTick')` 后）——**对得上，无冲突**。
**W5 的义务**：**只在 `cond` 里读，不在任何 `effects` 里写这 8 个 var。**

**出界处理（W5 不用写防御）**：懒字段一律 `||0`；`has_*` 归一 `0/1`；`heat_*`/`fame_*` `round` 后 clamp `0~100`；`foe_count`/`wanted` ≥0。
⇒ W5 **只做 `>=`/`<=` 数值比较，缺失按 0（事件不触发、不崩）**。

### 5.5.3 三条改读 `rumor_heat_*`（**原读 `rep:*`**）· 最终决定 + 阈值

**结论：三条全部接受改读**（理由同 team-lead：`rep` 单次仅 −0.4~−4.0，对 −40 门槛要上百次恶行，量级明显不对；`rumor_heat_*` 是**即时**值，更合"恶名当前有多响"）。
**阈值由我（叙事侧）定，如下：**

| event | 原 cond | **改后 cond** | **阈值** | 依据 |
|---|---|---|---|---|
| `w5_foe_bribe`（托人递话） | `rep:* <0` | `var rumor_heat_bad_max` **≥ 10** | **10** | 这是**最低烈度的恶名事件**（仇家只派人递话、不动手）＝"刚有人开始说你坏话"。原 `rep<0` 门槛极低，改后若定太高这条几乎不出现。取 10 保证：**行善玩家（`bad_max=0`）永不触发**，稍有恶名即可能触发 |
| `w5_foe_slander`（造你的谣） | `rep:* >=20` | `var rumor_heat_max` **≥ 30** | **30** | **造谣要有听众**——得你先有名气。`heat_max=30` ≈"本地区叫得出名字"，低于此没人认识你、谣造不起来。**刻意用 `max`（名气总量）而非 `bad_max`**：行善出名一样有人不服而造谣（这正是"名气"与"恶名"该分开的地方） |
| `w5_sect_hunt`（联手追杀你） | `rep:* <=-40` | `var rumor_heat_bad_max` **≥ 70** | **70** | 全剧**最重的恶名后果之一**（"多个门派**联手**"）。恶名门槛应对齐"江湖上都听过你的恶名"＝`bad_max` 高位。定 **70 而非 40**：迫使多派联手需要**极响**的恶名，否则太易触发、大恶人寸步难行（平衡） |

**阈值阶梯（bad_max）**：低危 **10**（递话）→ 高危 **70**（追杀）。**heat_max**：成名 **30**（造谣）。

### 5.5.4 `heat_max` / `bad_max` 分工核查（**逐条，防"行善被通缉"**）

**8 条事件（§5.3 表里读 #116 变量的那 8 条）**：

| # | event | 读的 var | 该用哪个 | 结论 |
|---|---|---|---|---|
| 1 | `w5_foe_bribe` | `rumor_heat_bad_max` | 恶名 → `bad_max` ✅ | 正确（改后） |
| 2 | `w5_foe_slander` | `rumor_heat_max` | 名气 → `max` ✅ | 正确（改后） |
| 3 | `w5_foe_snatch` | 无（读 `item sack_coarse`） | — | 不依赖 #116 var |
| 4 | `w5_foe_kin` | `has_spouse`（**含妾**） | — | ✅ 正确（对表后收窄为只读 `has_spouse`，见 §5.5.5） |
| 5 | `w5_foe_pact` | `foe_count` | — | 正确 |
| 6 | `w5_foe_debt` | `has_debt` | — | 正确 |
| 7 | `w5_sect_mercy` | `karma`（**native**） | — | 见 §5.5.5（"善名"无 var） |
| 8 | `w5_sect_hunt` | `rumor_heat_bad_max` | 恶名 → `bad_max` ✅ | 正确（改后） |

⇒ **8 条里无一用错**：两个"恶名"事件（`bribe`/`hunt`）用 `bad_max`；一个"名气"事件（`slander`）用 `max`。

**类2 通缉 8 条（team-lead 特别提醒"通缉类必须用 bad_max"）**：
**核查结果：我的通缉事件根本没用 heat**——用的是 `p.wanted`（native 通缉度）／`karma<=-30`／`fame[region]`。
⇒ **不存在"行善成名的玩家被通缉"**：`w5_wanted_poster` / `w5_wanted_bounty` 都带 `karma<=-30`（真恶行）才触发，其余带 `p.wanted>0`（只针对已通缉者）。
**但可做一处增强（建议、非阻塞）**：给两条最重的通缉（`poster`/`bounty`）**加**一道 `var rumor_heat_bad_max >= 40` 门槛，让"通缉跟恶名响度走"。**team-lead 已拍板：❌ 不加。** 理由：**通缉跟“罪”不跟“名”**——两条已有 `karma<=-30` 门控，一个人**杀过人**就该被通缉，不该先“出名到 40”；再加一道反而让“首次作恶的人不被通缉”，**逻辑反了**。**登记：可选增强、默认不做**（将来若要“通缉随恶名响度”再启用）。

### 5.5.5 缺变量 / 无提供（**点名**）

> **处置状态（team-lead 拍板 2026-10-11）**：#1 **走 (a) 收窄 cond**（不新增 var）；#2 保持 native `karma`；#3 维持可选。

| # | W5 想读的 | 现状 | 处置（已定） |
|---|---|---|---|
| **1** | **`has_confidant`**（是否有 `favor` 高的 NPC） | `#116` **不提供** | ✅ **走 (a)：`w5_foe_kin` 收窄到只读 `has_spouse`（含妾），不加 var**。理由（team-lead）：**条件越具体，事件越有记忆点**——若认 `has_confidant`，几乎人人都有 favor 高的 NPC，事件对所有人触发即**失分量**；只认配偶/妾 ⇒ “**成了家的人才会遇到的事**”。**cond 与文本已同步收窄（见 §5.5.5.1）** |
| **2** | **“善名”分量**（`rumor_heat_good_max`） | `#116` 只给 `max`/`bad_max`，**无善名分量** | ✅ **`w5_sect_mercy` 保持 native `karma>20`**（team-lead 确认：**别为统一而强改成 var**，它本就不依赖 #116）。若 #116 未来补 `good_max` 再切。**不阻塞** |
| 3 | `foe_top`（最恨你的仇家 id，用于台词点名） | 未提供 | **可选、非阻塞**；现状 `w5_foe_letter`/`w5_foe_kin` 用**泛称**（不点名具体仇家），不缺也能跑 |

#### 5.5.5.1 `w5_foe_kin` 收窄：cond ↔ 文本 **同步**（“写名 A / 读名 B”纪律）

> team-lead 要求：**不许只改 cond 不改文本**。原文若写“拿你**亲友**做筏”而 cond 只认配偶 ⇒ **文本承诺了 cond 不检查的东西**。**已同步收窄如下：**

| 项 | 收窄前 | **收窄后（定稿）** |
|---|---|---|
| **标题（`名`）** | 拿你亲友做筏 | **仇家拿你的家眷做筏** |
| **cond** | `var has_spouse>=1` **或** `favor 高 NPC 存在` | **`var has_spouse>=1`**（只此一条；#116 保证**含妾**） |
| **文本（`narrate`，示例）** | （泛指的“亲友”） | 「仇家托人捎来一样东西：你娘子头上那支银钗。捎话的人说，钗先还你，人也还你——只看你肯不肯低头。」 |
| **若家中有妾（追加，`D 传闻`/通风）** | — | 「夜里有人隔着门递进一张纸，字歪歪扭扭：『他们要的不是你的命，是你手里那半卷。』递纸的是你那一位妾。」 |

**结论：`w5_foe_kin` 的 cond 与文本均已收窄到「妻 / 妾」，二者一致，无“写名 A 读名 B”。**

### 5.5.6 两条补充的对齐确认（`#116` 说明 → W5 落实）

- **`w5_foe_kin` 的 `has_spouse` 计入妾**：✅ 接受。"**怎么用妾**归我"——W5 侧用法定为：**胁/以妾娘家为要挟**（加重压迫）· **妾报信通风**（给玩家一个"提前知道"的口子）· 与画像 `kinship` 挂钩。**`#116` 只需保证 `has_spouse=1`。**
- **`w5_sect_mercy` / `w5_foe_snatch` / `w5_foe_pact` / `w5_foe_debt` 已对齐，无需改**：✅ 确认，本表按此记。

### 5.5.7 种子数据（**W5 不改**）

`#116` 侧已确认：现有 **16 条 `rumorSeeds` 的数据全在 `70_world.json`**，工程只补调用点、不改种子数据。
⇒ **W5 侧同样不动这 16 条**（§5.4 已声明）；W5 自己要新增的只有 **4 条世界种子 `rs_e_world_*`**（`subject` 非 `player`，见 §2.6），**与这 16 条并存、不覆盖**。**不涉及改动任何既有种子数据。**

---

# 6. 待确认 / 待拍板

| # | 事项 | 我的倾向 |
|---|---|---|
| 1 | **§2.1 选方案 A 还是 B**（修 `mergeData` 走原设计 / 写成 Mod 规则零风险兜底） | **A** —— 顺带修好现有 4 条静默失效的基础事件；**但若工程怕动 `mergeData`，B 也能落地，我不坚持** |
| 2 | **R2 的处理**：给 `addRumor` 加"免目击"开关 / 还是所有世界传闻都落在有 NPC 的房间 | **加开关**（世界的天灾不需要"有人看见"） |
| 3 | **R3 的确认**：`evalCond` 对未知条件到底是"默认 true"还是"已实现" | **工程确认**；确认前 W6 一律用 `var` 不用 `factionRel` |
| 4 | **§1.4 的空白城**：`luoyang`/`changan`/`chengdu`/`xiangyang` **0 个 NPC**（刚迁入 24 座宅院） | 本文**已避开**这些城的传闻落点；但**这四座城"没有人"本身就是个洞**（`#111` 迁宅迁完了，`#112/#113` 画像还没派到）—— **建议报给画像批** |
| 5 | **`design/25` 未交付**：§5.3 的细分规则是否照此定 | **照此定**，25 交付后对齐一次 |
| 6 | **F 类（封路）的诚实降级**：`exits` 是静态数据，运行期改不了 → "雪封山"只能"说路封了"而**不能真的堵路** | **接受降级**；要真堵路需工程加"运行期门禁"（**属新机制，不建议本批做**） |
| 7 | **`once` vs 长冷却**：规格要 20 条 `once`，本文只给 4 条 | **本文的做法**（避免 120 天里世界被一次性事件"用完"） |
| 8 | **`combat:` 事件挂哪**：本文主张"含 `combat:` 的挂 `onEnter`，其余挂 `onDayTick`" | **照此**（`onDayTick` 里开战会抛错，实测） |

---

# 7. 给工程的落地清单

## 7.1 代码侧（E1–E6）

| # | 项 | 改哪个文件 | 位置 | 要什么 | 依据 | 优先级 |
|---|---|---|---|---|---|---|
| **E1** | 修 `mergeData`：`events`/`worldEvents` 的数组值**保持数组** | `game/src/core/world.js` | `mergeData` 的 byId 分支（`:239-252`） | 对这两个键走"数组直存"而不 `Object.assign({id}, array)` | §1.3-R1 | **P0** |
| **E2** | `fireEvent` 兼容 `worldEvents` + 非数组 handler 兜底 | `game/src/core/world.js` | `fireEvent`（`:2118-2123`） | `handlers = data.events[n] \|\| data.worldEvents?.[n] \|\| []`；非数组则 `Object.values(...).filter(x=>x&&(x.cond\|\|x.effects))` | §2.1 | **P0** |
| **E3** | `applyRumorReputation` 加 `subject` 守卫 | `game/src/core/world.js` | `:1262` 起 | `if ((opts.subject \|\| 'player') !== 'player') return;` | §2.6-R4 | **P0** |
| **E4** | `addRumor` 加 `opts.silent`（免目击） | `game/src/core/world.js` | `addRumor`（`:1207-1255`） | `if (!witnesses.length && !opts.silent) return null;` | §2.6-R2 | **P0** |
| **E5** | 新增 `factionState` / `calendarState` 并接进存档 | `game/src/core/world.js` | `serialize`（`:2282` 附近）/ `deserialize`（`:2514` 附近） | 两个运行期状态；`data.factions`/`data.calendar` 是模板 | §3.2 | **P0** |
| **E6** | 月度结算 + 日历判定**挂在 `onDayTick` 的一个处理器里** | `game/data/70_world.json`（数据）+ 无代码 | `worldEvents.onDayTick` 里用 `day` 条件分派：`{and:[{day:{op:'>=',value:0}}, ...]}` | **不加新 hook** | §0/§3.2/§4.4 | P1 |
| **E7** | `cooldownDays` / `once` 机制 | `game/src/core/world.js` | `fireEvent` 里加一张 `world._evCooldown = {evId: day}` | 引擎目前**不认这两个字段** | §2.2 | P1 |
| **E8** | “含 `combat:` 的事件挂 `onEnter`”的分流 | 数据侧（本文已分） | — | **无需代码**，按 §2.5 的注写数据 | §2.5 | P1 |

## 7.2 数据侧（E9–E12）

| # | 项 | 文件 | 内容 | 条数 |
|---|---|---|---|---|
| **E9** | `worldEvents` 68 条 | `game/data/70_world.json` | §2.3 全表 + §2.5 例证；**按"含 combat 与否"分挂 `onDayTick` / `onEnter`** | 68 |
| **E10** | `factions`（14 门派 + `court` + `gang`） | 同上 | §3.1 结构 + §3.2 初值 | 16 |
| **E11** | `calendar`（8 节 + 5 周期） | 同上 | §4.4 结构 | 13 |
| **E12** | 世界传闻种子 4 条 | 同上（`rumorSeeds` 里追加） | §2.6 的 `rs_e_world_*` | 4 |

## 7.3 渲染侧（E13–E16，**第二波**）

| # | 项 | 位置 | 玩家看到什么 |
|---|---|---|---|
| E13 | `talk` 按 `faction.mood` 切台词 | `commands.js`（`talk` 渲染） | 弟子说的话随门派处境变 |
| E14 | `buy` 叠一层 faction power 折扣 | `commands.js`（buy，现有 reputation 折扣旁） | 价钱变了 |
| E15 | `look` 加一行地盘标识 | `commands.js` / `look` 渲染 | "此处已是 XX 派的地盘" |
| E16 | 运行期 `respawn` 密度 | `world.js` 的 spawn 点 | 官道兵丁多一个 |

## 7.4 回归建议（E17–E20）

| # | 断言 | 为什么 |
|---|---|---|
| E17 | **`worldEvents` 68 条全部能被 `evalCond`/`evalEffects` 解析、零报错** | 规格 §6 的验收项 |
| E18 | **`fireEvent('onKill')` 现在必须能产出基础数据的 2 条**（R1 修好的证据）——**这条现在会红，修完才绿** | 把 R1 从"静默"变成"可断言" |
| E19 | **跑 240 个 `onDayTick`，断言：① 无异常抛出；② 传闻条数 ≤200；③ 同一事件 7 日内不重复（冷却生效）；④ `factionState` 的 power 落在 0~100** | 世界动态最怕"跑久了炸" |
| E20 | **`factionState`/`calendarState` 存读档 round-trip 不丢** | 规格 §6 验收项 |

---

# 附 · id 自查与复现命令

## A · id 自查（本文引用的真实 id 命中率）

**方法**：把本文所有反引号 token 抽出（去重 522 个），逐个比对 `rooms`(312) / `regions`(34) / `npcs`(323) / `items` / `quests`(含 events/endings) / `sects` / `skills` 与 `design/portraits-new.json` 的 hook id。

**结果：522 个 token 中，命中真实 id 59 个**（room 11 / region 29 / npc 14 / sect 3 / event 2）。
其余未命中项经逐条甄别，**全部**属下列三类，非"编造"：

1. 本文**新建**的 id —— `w5_*`（68 事件）、`rs_e_world_*`（传闻种子）、`faction`/`court`/`gang`（W6 势力）、`holiday_*`（W7 节庆 flag）、`yu_ledger`（盐引 flag）；
2. **引擎/DSL 字段与函数名** —— `onDayTick`/`mergeData`/`addRumor`/`factionRel`/`evalCond`/`evalEffects`/`menu`/`combat`…；
3. **规格误写、本文已纠正的引用** —— 规格 `wudu`（实为 `miaojiang`）、规格 `漕帮`（不存在，本文新建 `gang`）。

**自查中抓出并已修正的 3 处引用错误（原本会被算作编造）**：

| # | 原文写的 | 问题 | 已改为（真 id） |
|---|---|---|---|
| 1 | `huashan_jinding` | 无此房；华山无"金顶"房 | `huashan_lianhua`（华山·莲花峰）+ 已有 `wudang_jinding` / `emei_jinding` |
| 2 | `guard_yamen` | 无此 NPC；全项目仅 1 个守卫 `guard_city`（在 `jiangnan_gate`） | 删此 NPC 引用，改为 `jn_yamen_court`/`jn_yamen_office`（真房） |
| 3 | `shuyuan`（当房用） | `shuyuan` 是 **region** 名，非房 id | `jn_school_hall`（真房） |

**结论：房间/NPC/门派/物品/任务/功法六类真实 id 的引用错误 = 3 处，均已修正；其余未命中均为新建 id 或引擎字段。** 六类之外的"口诀式 id"（如 `jail` 作为 `var` 状态名）不属编造，文中已标为新建。

## B · 本文用到的实测命令（可复现）

```js
const {GameEngine} = require('./game/src/core/engine.js');
const e = new GameEngine({seed: 20261010}); e.boot(); e.newGame({name:'试剑',gender:'male'});
const w = e.world;
// R1：events 的 handler 是不是数组
Object.keys(w.data.events).forEach(k => console.log(k, Array.isArray(w.data.events[k]), Object.keys(w.data.events[k])));
// worldEvents / factions / calendar 是否存在
console.log(typeof w.data.worldEvents, typeof w.data.factions, typeof w.data.calendar);
console.log(typeof w.factionState, typeof w.calendarState);
// onDayTick 顺序（world.js:1948-1953）：dailyRumorTick() 先、fireEvent('onDayTick') 后
// R3：factionRel 恒 true
require('./game/src/core/modapi.js').evalCond({factionRel:['a','b','<',-40]}, {player:w.player,world:w});  // → true
// R5：menu 正确写法
require('./game/src/core/modapi.js').evalEffects(['menu:标题|A>flag:x;;B>flag:y'], {player:w.player,world:w});
```

## C · 与规格的差异一览（**别照抄规格的数字**）

1. 6 个新 hook → **只要 1 个（已存在）**；2. `税基`/`弟子数` 全部重算；3. 门派含 `wudu`→实为 `miaojiang`；4. `漕帮` 不存在（本文新建）；5. `menu:` 写法修正；6. `once` 20 条 → 4 条；7. **新增 5 条地雷 R1–R5（规格写时不存在这些代码行为）**。

---

*本文 r1：W5 68 条（含 10 条完整 JSON）+ W6 14 门派/16 势力 + W7 8 节 5 周期 + §5 边界提案 + §7 落地清单 20 条。落地后回填本文。*
