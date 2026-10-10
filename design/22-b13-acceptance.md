# §22 B13 世界区块重设计 —— 独立验收报告

> **验收人**：质量负责人（严守真）· **未参与 B13 实现**
> **方法**：全部结论**独立实跑复现**，不采信工程自报；自报与实测不符处以实测为准。
> 变异体**自己施加、自己还原**，还原后 `md5`/`cmp` 逐字节校验。
> **纪律**：验收期间**只读不改产品代码**（仅 50_map.json 做了「备份→变异→还原」的受控操作，已 `cmp` 验证零残留）。
> **验收日期**：2026-10-10 · **机器**：Windows / Git Bash · Node `22.22.2-6`
> **项目路径**：`C:/Users/35453/WorkBuddy/2026-10-08-00-02-57/jinyong-mud`
> **冻结基线（本报告全部结论以此为准）**：
> `50_map.json baf7a2a48301ec158527d3a7cf99ea91` · `map-check.js 802a90fef00ec45b5ff806348037bc0b` ·
> `world.js 4e935778a3ee5de6fac43fc5f63cb8a7` · `engine.js 9ae0cac032a5385297833ca866501b79` ·
> `40_npcs.json dcbdef287ab2a1309d1162dcf2f69eb2`（20s 采样确认已冻结）

---

## 0. 结论速览

| 验收维度 | 判定 | 一句话 |
|---|---|---|
| 数据口径（312 房 / 34 区 / 删 29 / 增 50） | 🟢 PASS | 独立计数与自报**逐项吻合**；`pre-b13` 备份与 `git HEAD` **逐字节相同**，可确认 B13 是 50_map 的唯一改动者 |
| **删房间「零引用」**（R1） | 🟢 PASS | 29 房逐个独立扫 **quest/NPC/代码/测试/meta** —— **全 0 命中**。零引用结论**为真** |
| **存档迁移「幽灵房」**（R10，本报告最关键） | 🟡 **CONCERNS → 已修** | **首次实测（13:50）复现「永久软锁」**（见 §3）；**修复与回归测试于 13:51 在验收途中补上**，冻结态已正确回出生点且**有测试覆盖**（`smoke-map-migrate.js` 32/0） |
| 57 处非对称边处置（R5） | 🟢 PASS | 独立重扫：**旧 57 → 新 0**；`57 = 42(修复) + 15(随删房消失)` **分账逐条对上** |
| 「有意单向 = 0」判断 | 🟢 PASS | 独立找到「跳崖/爬上去」等 `via/hint` 特殊通道，**皆有真反向边**；未发现设计性单向门 |
| 新增断言强度（§9/§10/§11） | 🟡 CONCERNS | §10 对「宅院堆回江南」**有效**；**§9「总数 280–340」过宽**（±28）；§10 缺「江南 ≤1」直测项 |
| R4 生成器回流守卫 | 🟢 PASS | 两脚本实测 **exit=2**，`50_map` md5 **零变化**（cmp 一致） |
| 改动范围未越界 | 🟢 PASS | `b13-apply.js` 只写 `50_map.json`；`40_npcs.json` 的 diff **只有 `portrait` 一个键**（非 B13） |
| 全量回归（31 套 + map-check/guide/e2e） | 🟢 PASS | 冻结态 **31/31 smoke 全绿**、`map-check 6491/0`、`mapguide 72/0`、`e2e 122/0`、连通性 **312/312** |
| `smoke-portrait` 红项归属 | 🟢 与 B13 **无关** | 失败断言是**画像覆盖**（读 `40_npcs.portrait`），且**该断言已被并行画像任务用 git diff 放松**；B13 未动任何 NPC |

### B13 整体判定：**CONCERNS —— 建议「有条件放行」**

数据与图结构层面（房间/区块/反向边/零引用/R4/回归）**全部经独立复核为真**，是本轮质量最高的部分。
放行前需登记、**均不构成功能阻塞**的几条如下：

- **CN-B13-1（最重要）**：**R10「存档迁移」在本轮交付时并不成立**——交付件（13:50 那版）读一张停在已删房的旧档会**永久软锁**（§3 有完整复现步骤）。修复（`deserialize` 兜底 + `go`/`look` 运行期防御）与回归测试 `smoke-map-migrate.js` 是在**验收途中（13:51）**才补上的。冻结态**已修复且有测试**，故不阻塞放行，但**自报「引擎有回出生点兜底」与交付时刻不符**，属「边验边补」。
- **CN-B13-2**：`map-check` §9 总数区间 **280–340 过宽**（目标 312，±9%），把「总数灌水」的旧病留了口子（§6 有变异证据 + 收紧建议）。
- **CN-B13-3**：§10 只在 `jn_home_` 前缀上守江南，未对 `jiangnan` 做「富户 ≤1」的直测（§6）。
- **CN-B13-4（过程）**：验收期间 `world.js`/`engine.js`/`commands.js`/`smoke-portrait.js`/`40_npcs.json` **多文件被并行改写**，我早期的实测对象已被顶替。**本报告所有结论以 §0 冻结 md5 为准**；请后续验收引用该组 md5。

---

## 1. 数据口径（独立计数，不读自报）

用 `git show HEAD:game/data/50_map.json` 取基线，与 `tools/_bak/50_map.json.pre-b13` 比对：

```
cmp tools/_bak/50_map.json.pre-b13 tools/_bak/qa-old-50-map.json（= git HEAD）
→ IDENTICAL    ⇒ B13 是 50_map.json 的唯一未提交改动者，基线可信
```

| 项 | 基线(HEAD) | 交付 | 独立复核 |
|---|---|---|---|
| 房间数 | **291** | **312** | ✅ |
| region 数 | **34** | **34** | ✅ 恒 34（断言 3 硬编码） |
| 删除房间 | — | **29** | ✅ 逐个列出＝`jn_home_02..30`（名字：李宅/王宅/…/城西·郑家） |
| 新增房间 | — | **50** | ✅ 6 巷 + 24 宅 + 20 补建 |

对账：`291 − 29(删) + 50(增) = 312` ✅
新宅：`ly_home_01..04 · ca_home_01..04 · cd_home_01..03 · xy_home_01..03 · hb_home_01..04 · gs_home_01..03 · ya_home_01..03` = **24** ✅（含「姑苏·慕容别院」`gs_home_01`）

**主脉络零删**：`road_jiangnan_1`（出生点）`jiangnan_market / jiangnan_inn / jiangnan_temple / jiangnan_gate / palace_street / jn_resident_1/2/3 / jn_rich_house` 均在位；`meta.startRoom = road_jiangnan_1` 未变。

---

## 2. ★ 删房间「零引用」独立复核（重点项 1 —— R1「误删主线房」）

**不信自报的 grep，自己从源码/数据两条独立路径重扫。**

### 2.1 全仓字面扫描（29 个 id）

```
grep -rn "jn_home_(02..30)"（排除 /design/ 与 .pre-b13 备份）
→ 命中仅 2 处：tools/gen-map.js（生成器，已加守卫）、tools/patch-guard-gates.js（一行注释）
→ 60_quests / 40_npcs / 00_core / 70_world / game/src/** / tools/smoke-*.js 全部 **0 命中**
```

### 2.2 结构化字段扫描（不靠子串，逐字段判）

| 引用面 | 结果 |
|---|---|
| `60_quests.json` 房间引用（把 JSON 里所有命中现有房间 id 的 token 抽出来） | 命中 **110 个现存房间**，其中**被删 29 房 = 0** |
| `40_npcs.json` 的 `home` → 被删房 | **0** |
| `40_npcs.json` 的 `room / spawnRoom / startRoom / district` → 被删房 | **0** |
| `00_core.json` / `70_world.json` 全字段 | **0** |
| `meta.startRoom` | `road_jiangnan_1`（未变、真实存在） |
| `50_map.json meta.homeRooms`（38 项） | 全为现存房，**无被删房** |

### 2.3 悬空出口清理

独立重扫当前图 **0 条悬空出口**（§4 同表）。`jn_resident_1/2/3`、`jn_home_01` 指向被删房的出口已按方案 §6.1 同步清除（`map-check` §11 dangling=0 佐证）。

**结论：29 房的「0 quest / 0 NPC / 0 代码引用」为真，误删主线房的 R1 风险不成立。** ✅

---

## 3. ★★ 存档迁移「幽灵房」实测（重点项 2 —— 决定遗留①能否接受）

### 3.1 复现步骤（自己造档，走真 `deserialize`）

```js
// tools/_qa-b13-save.js（我自建，只读不改产品代码）
const e1=new GameEngine({seed:20261010}); e1.boot();
e1.newGame({name:'测试侠客',gender:'male',birth:'orphan'});
const save=e1.world.serialize();
save.player.room='jn_home_05';                  // 篡改：玩家停在已删房
const e2=new GameEngine({seed:20261010}); e2.boot();
e2.world.deserialize(save,null);                // 真读档
e2.exec('look'); e2.exec('go 江南大路');        // 真指令
```

### 3.2 首次实测（**13:50**，交付件原状）→ **永久软锁（定性 FAIL）**

```
after load, p.room = jn_home_05        ← 静默留在「不存在的房间」，无任何兜底
getRoom(p.room)    = undefined
view()   → room=null，lines=[这里一片虚无。]             （不崩）
exec 北 / go 北     → 「你似乎迷失在了虚空之中。」          （走不动）
exec "go 江南大路"  → THREW: Cannot read properties of undefined (reading 'exits')   ← 真的抛异常
exec 存档          → 成功，但 room 仍是 jn_home_05（坏档可继续存回）
可脱困指令（逃/回城/回家/自杀/重生/goto/寻路…）全无效
```

**判定**：不崩，但产生**幽灵房间状态**且**无任何恢复路径** —— 老玩家若把档停在这 29 间之一，读档即**永久软锁**（走不动、`go <房名>` 崩、只能存个更坏的档）。这正是任务书说的「会崩或产生幽灵房间状态 → 判 FAIL」的情形。
（`go <房间名>` 抛异常属**第二个**缺陷：`commands.js` 的 go handler 未防御 `undefined` 房间。）

### 3.3 复核途中（**13:51**）源码被并行改写 —— 修复 + 测试一并补上

`world.js`(13:51:12)、`engine.js`(13:51:24)、`commands.js` 在此期间被编辑，新增：

- **① `world.deserialize` 收尾兜底**：`if (!this.data.rooms[p.room]) { p.room = meta.startRoom; this._migrateNotice=…; p.log.push(…); this._roomMigrated={from,to}; }`
- **② `commands.js` go handler** `if (!room) return …'辨不清方向'`；**③ look 出口回退分支** `if (!room) return …'一片虚无'`
- **④ 新增回归 `tools/smoke-map-migrate.js`（32 项）**，且 `engine.view()` 把提示顶在 `room.desc` 前、`exec()` 首行清提示（「一动就撤」）

### 3.4 冻结态复测 → 已修复

```
after load, p.room = road_jiangnan_1（存在）
_roomMigrated = {from:'jn_home_05', to:'road_jiangnan_1'}
view.room.name = 江南大路；desc 顶部 = 「（你原先所在的地方已不存于世间，恍惚间你竟又回到了江南大路。）」
exec 北 → 正常走到 jiangnan_gate（移动恢复）
合法档读档：_roomMigrated=undefined、位置不变（不误伤）
smoke-map-migrate.js → 通过 32 / 失败 0
```

**结论**：
- **交付时刻（自报落款）的 B13 不满足 R10**；**冻结态已满足**（回出生点 + 提示 + 运行期防御 + 有回归测试）。
- 遗留①（未加「旧 id→新 id 迁移表」）**可接受**：方案 R10 本就允许「迁移表 **或** 回退起点」二选一，现走的是后者，且**不静默**（log + 描述 + `_roomMigrated`）。
- ⚠️ 请把 §0 那组 md5 作为验收对象；**13:50 之前的任何结论均已失效**（我早期的软锁结论属于被顶替的旧版）。

---

## 4. ★ 57 处非对称边处置 —— 独立重扫与分账（重点项 3 —— R5）

**自写扫描器**（不复用 `map-check` 代码），枚举 `rooms[*].exits`，`A.d→B ⇒ B.OPP(d)===A`：

| 图 | 房间 | 出口边 | **严格非对称边** | `oneWay:true` | 悬空 |
|---|---|---|---|---|---|
| 基线（HEAD） | 291 | 635 | **57** | 0 | 0 |
| 交付（冻结） | 312 | 650 | **0** | **0** | **0** |

**57 处分账（我独立重算，逐条列表核对）：**

```
涉及被删房的非对称边 = 15 条   （源/目标 ∈ jn_home_02..30；随删房自然消失）
两端均存活的非对称边 = 42 条   （= 需修复的）
→ 对其中 42 条在新图逐一复查：仍在图中且仍非对称的 = 0 条 ✅
```

| 项 | 自报 | 我独立重扫 | 结论 |
|---|---|---|---|
| 历史非对称总数 | 57 | **57** | ✅ 一致 |
| 随删房消失 | 15 | **15** | ✅ 一致（逐条列出：14 条以 `jn_home_*` 为源、1 条以 `jiangnan_temple -n-> jn_home_21`） |
| 修复 | 42 | **42**（且新图中残留 = 0） | ✅ 一致 |
| 有意单向 | 0 | 见 §5 | ✅ 无图边层面的反例 |

**数字对得上，无差异，不判 CONCERNS。**

### 4.1 我自己的变异（先确认缺陷真复现，再判红绿）

把 `shaolin_houshan` 的出口 `e→shaolin_cangjing` 改为 `n→shaolin_cangjing`（对侧 `shaolin_cangjing` 只有 `w→shaolin_houshan`，无 `s`）：

```
map-check → FAILED 6489 通过 / 2 失败
  - 非严格反向：shaolin_cangjing -w-> shaolin_houshan，但 shaolin_houshan -e-> (无此出口)
  - 非严格反向：shaolin_houshan -n-> shaolin_cangjing，但 shaolin_cangjing -s-> (无此出口)
还原 → cmp 逐字节 IDENTICAL，md5 回到 baf7a2a4…；map-check 恢复 6491/0
```

**先复现、后判红、还原零残留。** 断言 2（收紧为 `back[opp]===id`）**具备真实区分度**，不是假绿。✅

---

## 5. ★ 质疑「有意单向 = 0」（重点项 4）

自己找证据，不接受一句话结论。全图扫 `坠落/密道/传送/只进不出/oneWay/滑/爬` 等线索：

| 候选 | 实测 | 是否单向 |
|---|---|---|
| **峨眉·舍身崖** `emei_she_ru` | `d → {to:emei_ya_di, **via:'万丈悬崖', hint:'跳崖'**}` | ❌ 不是 —— 对侧 `emei_ya_di . u → {to:emei_she_ru, via:'陡峭崖壁', hint:'爬上去'}`，`d/u` 互为反向，**严格对称** |
| **桃花岛·渡口** `taohuadao_dock` | action `回程 → goto haitan_dock`（回程传送） | ❌ 不是图边 —— 房间本身另有正常 `w→haitan_boat` 出口；`goto` 是 action，不进反向边审计 |
| **回家** `home.js goHome` | 传送回主宅 | ❌ 不是图边 |
| 「只进不出的地牢」「坠落」 | 全图无此类出口 | — |

**结论**：图里**确实没有设计性单向门**；「舍身崖」这类特殊通道用的是 **`{to, via, hint}` 交互出口**，它**仍然要求配一条真反向边**（现状已配）。「有意单向 = 0」的判断**成立**（**限图边层面**）。
> 建议（非阻塞）：把「`via/hint` 交互出口也必须严格双向」这条经验写进 `map-check` 注释或铁律，防将来有人用 `oneWay:true` 给真单向门开后门。

---

## 6. ★ 新增断言强度判断（重点项 5 —— 防「宽松断言自我放行」）

逐条做**变异判别测试**（自建变异体、跑完还原）：

| 变异 | 期望抓 | 实测 |
|---|---|---|
| **A** 重新灌回 29 座 `jn_home_*` 到江南 | §9/§10 应红 | **FAILED 6614/4** —— 「江南仍独占：56 房」「总数 341 异常」「江南仍堆着 30 座填充宅院」 ✅ |
| **B** 把 `ly_home_01` 的 region 改成 `wild`（荒郊民宅） | §10 应红 | **FAILED 6488/1** —— 「wild 不该有富户民宅，实为 1」 ✅ |
| **C** 灌 23 座 filler 使总数→335、江南→50 | §9 应红 | **FAILED 6592/2** —— 靠「江南 >30」抓到；但**总数 335 落在 280–340 内、未被总数断言拦住** ⚠️ |

**我的判断：**

1. **`§9 总数 280–340` 过宽（CN-B13-2）**：目标 312，区间 ±28（≈±9%）。变异 C 证明：把 23 座填充房摊到非 `jiangnan` 的区里、总数 335，**能整体溜过 §9**。旧病根正是「354 间填充物」。**建议收紧为 305–320**（±≈1 个宅院的容忍），或改为「按 tier 的区间 + 总数硬上限 320」。
2. **`§9 n>=3` 恰当**（含 `xixia=3`）；设计写「≥4 方可玩」，但 3 是明示底线，且 `§9 n<=30` 兜住独占。
3. **`§10 7 城各 3–5` 有效（强）**：变异 A/B 都证明它能抓「宅院堆回江南 / 堆错地方」。**这是针对 B13 所报病根的最强守门。**
4. **`§10` 有一个小口子（CN-B13-3）**：`荒郊秘境零民宅` 名单里**没有 `jiangnan`**；江南民宅只靠「`jn_home_` 前缀 ≤1」+「§9 ≤30」间接守。若有人用非 `jn_home_` 前缀（如 `zz_home_01`）在江南放**少量**宅（≤3、总量不破 30），可整体溜过。**建议**给 §10 增一条 `ok((perReg.jiangnan||0) <= 1, …)`（把江南也纳入 `perReg` 直测），与 `jnHome<=1` 双保险。
5. **`§11` 悬空 + 白名单**：白名单为空、`oneWay` 计数 0，`ok(oneWayEdges.length === ONE_WAY_ALLOWLIST.length)` 保证「标记数 = 白名单数」，**能防把 bug 用 `oneWay` 合法化**；强度足够。

---

## 7. ★ R4 生成器回流守卫实测（重点项 6 —— 先备份，跑完验零改动）

```
md5(50_map) BEFORE = baf7a2a48301ec158527d3a7cf99ea91
node tools/gen-map.js    → exit=2（打印「检测到 B13 版本…禁止在成品数据上运行」）
node tools/gen-homes.js  → exit=2（同上）
md5(50_map) AFTER  = baf7a2a48301ec158527d3a7cf99ea91   （cmp 逐字节 IDENTICAL）
```

**守卫有效：两脚本都在写入前 `process.exit(2)`，`50_map.json` 零改动。** ✅
守卫实现：比对哨兵房 `['ly_home_01','many_ruin','secret_cage','gs_home_01']` 是否存在；`FORCE_GEN_MAP=1/FORCE_GEN_HOMES=1` 才放行（需显式、可追责）。

> **一处措辞修正（non-blocking）**：自报称 `patch-guard-gates.js` 的 `jn_home_09` 旧洞「`cutEdge` 会自动跳过」。实际读码：`cutEdge` 第一行 `if (!r) { problemsEarly('脏连线源房间不存在：'+rid); return false; }` —— 对**已删房**走的是「记为 problem」，最终 `problems.length` 非空 → 打印「❌ 自检没过（**未落盘**）」并 `exit(1)`。**效果安全（不会静默覆盖），但「自动跳过」的说法不准确**；它是**硬失败退出**而非跳过。该脚本不进 CI，影响可忽略。

---

## 8. 改动范围未越界（重点项 7）

- **B13 数据改动 = 只动 `50_map.json`**：`tools/_bak/b13-apply.js` 头注释「输出：game/data/50_map.json」，全文**只对 50_map.json 调 `writeFileSync`**，`require` 的只有 `maplayout.js`（只读布局）。
- **`40_npcs.json` 不是 B13 改的**：与 HEAD 逐字段 diff ——
  ```
  同 329 个 NPC，新增 id 0、删除 id 0；
  room 字段变化 = 0；home 字段变化 = 0；
  全库唯一新增键 = portrait
  ```
  ⇒ 那 `+3160 行`是**并行画像任务**加的 `portrait`，与 B13 无关。
- `ui.js` / `start.js` 的改动属**其它批次**（B14/B15 前端），非 B13。
- `tools/` 下 B13 相关：`map-check.js`（断言）、`gen-map.js`/`gen-homes.js`（守卫）、`patch-guard-gates.js`（注释）—— 与自报一致。

**结论：未发现 B13 越界改 `ui.js`/`start.js`/其它 `game/data/*.json`。** ✅

---

## 9. 全量回归 + `smoke-portrait` 红项独立归属（重点项 8）

### 9.1 冻结态回归（我自己全跑）

```
map-check.js        PASSED 6491 通过 / 0 失败     （= 自报 6491/0，吻合）
mapguide-check.js   通过 72 / 失败 0
e2e.js              通过 122 / 失败 0
account/identity/input-guard/look-detail/martial-ui/game-ui/dom-page/ui-bind/kidnap-ui  → 全 exit=0
tools/smoke-*.js    共 31 套（并行任务本轮新增 1 套）→ 31/31 exit=0、0 个 ✘
连通性 BFS(road_jiangnan_1)：312/312 可达、0 不可达、0 零出口孤立房
```

### 9.2 `smoke-portrait` 红项归属 —— **判定：与 B13 无关**（给证据，不止复跑）

工程自报「1 红＝`smoke-portrait`，是并行画像任务在途所致」。我独立取证：

1. **失败断言是「画像覆盖」，不是地图**：committed 原句为 `ok('无画像 NPC 数量 > 300', noPortrait.length > 300, …)`，读的是 `40_npcs.npcs[*].portrait`。
2. **该断言已被并行画像任务当场放松**：`git diff tools/smoke-portrait.js` 显示
   `→ noPortrait.length > Object.keys(npcs).length*0.7`，注释「第六批后 307 → 画像落地 +26 张 → 281；改用比例」。⇒ 红项来自**画像数据/阈值**，与地图无关。
3. **B13 未动任何 NPC**：§8 已证 `40_npcs` 的 room/home 变化 = 0。
4. 现覆盖：42 张画像 / 无画像(有房) 277；`277 > 329*0.7=230.3` ⇒ 冻结态 **127/0 绿**。
5. **一处措辞需修正**：自报「`smoke-portrait` **完全不涉及地图数据**」**不准确** —— 该套件 `:242` 确实读 `50_map.json` 并断言 NPC 所在地块的 region（青楼/农田/村庄/醉春楼）。只是**它读地图的那几条断言与 B13 无关**（B13 没挪 NPC），故仍绿。**正确表述**：「该套件的红项来自画像覆盖，非地图；B13 不移动 NPC，故其地图相关断言不受影响」。
6. ⚠️ 该文件本轮**也在被并行改写**（属 §0 的 moving-target 一组）。

**⇒ 独立结论：`smoke-portrait` 红项归因于并行画像任务，与 B13 无关。** ✅

---

## 10. 三条遗留 + B5 待办的定性

| 遗留 | 定性 | 依据 |
|---|---|---|
| ① 未加「旧 id→新 id 迁移表」 | ✅ **可接受** | 方案 R10 允许「迁移表 或 回退起点」二选一；现为**回退 `meta.startRoom` + 非静默提示**，冻结态实测生效且 `smoke-map-migrate` 32/0 覆盖（见 §3） |
| ② R9 命名归属（`wild` 里的城西 `jn_*`、江南里的 `palace_street`、两个「黑市」）**只登记未改** | ✅ **可接受** | 属**既有**问题、非本次引入；`palace_street` 被 `smoke-guards` 锁死，擅动风险高。登记到 B13-续 合理 |
| ③ `test_room` 未删 | ✅ **可接受（措辞需修正）** | `test_room` **不在** `50_map.json`；它来自 **`mods/test_mod/mod.json`**（`mods-state.json` 中 `test_mod` 为 enabled）→ 并入运行时世界（故引擎合并后 317 房）。自报「仅存在于 smoke-test 内存夹具」**不准确**，但**确非成品基础数据**，且属 mods 层（用户可控），不阻塞 |
| **B5 触屏实机验** | 🔴 **仍未完成，不得追认** | 桌面端键盘验**不算数**；须主人真机执行（`design/16-touch-acceptance-checklist.md`）。本轮未做、也无法做 |

---

## 11. 放行意见

- **B13 数据/图结构层（房间口径、零引用、57→0 反向边、R4 守卫、改动范围、31 套回归、312/312 连通）经独立复核全部为真，判定 PASS。**
- **唯一曾达到「阻塞」级别的 R10（存档软锁），交付时真实存在、已在验收途中修复并被新测试钉死；冻结态 PASS。**
- **整体判定：🟡 CONCERNS —— 建议「有条件放行」**，无 🔴 功能阻塞项，但须登记下列条目：

**待回填（不阻塞，建议下一批内处理）：**
- **CN-B13-1**：`R10 修复属「边验边补」**；若 `smoke-map-migrate.js` 未被纳入常规回归清单，请务必纳入（否则兜底是无测试的裸代码路径）。同时**自报「交付即有兜底」应更正为「交付后补」**。
- **CN-B13-2**：`map-check` §9「总数 280–340」建议收紧至 **305–320**（变异 C 已证明 335 能溜过）。
- **CN-B13-3**：§10 建议加 `ok((perReg.jiangnan||0) <= 1)`，把江南纳入直测（与 `jn_home_` 前缀双保险）。
- **CN-B13-4**：验收期多文件并行改写（moving target）——**已用 §0 冻结 md5 锁定结论**；建议后续验收一律先冻结 md5 再判。

**保留待办（不得追认）：**
- **B5 触屏实机验证仍未完成**，只能主人真机做（§10）。

**质量门是建议性门控**：以上为我的独立判定；**最终放行由主人决定**。

---

## 12. 验收操作记录（供审计）

1. **只读审查**：`design/12-owner-bug-list.md`·B13 段 / `19-map-rebalance.md` / `18-batch4-acceptance.md` §1–§13（方法论）/ `game/data/50_map.json` / `tools/map-check.js` / `world.js`（deserialize/reviveInstances）/ `engine.js`（view/exec/loadSave）/ `commands.js`（doMove/go/lookRoom）/ `home.js` / `gen-map.js` / `gen-homes.js` / `patch-guard-gates.js`。
2. **独立脚本**（自建，置于 `tools/_qa-b13-*.js`，验收后删除）：删房零引用扫描 · 存档软锁复现 · 逃逸指令穷举 · 严格非对称边重扫（旧/新）· 57 分账 · 引用完整性 · 连通性 BFS。
3. **变异（自己施加、自己还原、`cmp` 校验）**：① 非对称边（`shaolin_houshan`）→ 6489/2 红 → 还原逐字节一致；② 灌回 29 宅（§9/§10 红）；③ `ly_home_01`→`wild`（§10 红）；④ 灌 23 填充房（§9 红、暴露 §9 过宽）。
4. **R4 守卫**：`gen-map.js`/`gen-homes.js` 实跑 exit=2，`50_map.json` md5 前后一致（cmp 一致）。
5. **回归**：地图/引导/e2e 三个 check + 31 套 smoke + 9 个 UI check 全跑；连通性 BFS。
6. **未执行**：任何 `git commit`；任何产品代码的**持久**修改（`50_map.json` 的变异已 100% 还原，md5 `baf7a2a4…` 与验收前一致）。
7. **时间线留痕（moving target）**：首次存档复现（约 13:50）→ 发现永久软锁；`world.js`(13:51:12)/`engine.js`(13:51:24)/`commands.js` 被并行改写并新增 `smoke-map-migrate.js`；20s 采样确认冻结后，本报告全部结论以 §0 冻结 md5 为准。

*（本报告为独立验收结论，与工程自报如有出入，以本报告实测为准。）*

---

# §13 收尾确认（回应主理人四项复核）

> **触发**：主理人告知工程已落地 CN-B13-1..4 + 3 处措辞更正，要求我做**简短确认**（不必重跑全套）。
> **复核日期**：2026-10-10（约 14:04）· **方法**：自建变异体、自行还原、`cmp` 校验；只读不改产品代码。

## 13.0 复核基线对照

| 文件 | 我上次冻结 md5 | 本次实测 md5 | 变化 |
|---|---|---|---|
| `game/data/50_map.json` | `baf7a2a4…` | `baf7a2a48301ec158527d3a7cf99ea91` | ✅ **未变** |
| `game/src/core/world.js` | `4e935778…` | `4e935778a3ee5de6fac43fc5f63cb8a7` | ✅ 未变 |
| `game/src/core/engine.js` | `9ae0cac0…` | `9ae0cac032a5385297833ca866501b79` | ✅ 未变 |
| `game/src/core/commands.js` | *（冻结时未记录其 md5）* | `7c4a107e415db56786e077befd80e3c3`，mtime **13:55:48** | ⚠️ **见 §13.3** |
| `tools/map-check.js` | `802a90fe…` | `08d8e157cb15cd0a65e3d8b09fd3dd1b` | ✅ 预期内（CN-B13-2/3 改的就是它） |

## 13.1 ✅ 确认 1 · §9 收紧（`305–320`）真的有效

自建变异：注入 **12 座 filler**（落在 `farmland`）→ 总数 **324**（**在旧区间 ≤340 内、超新区间 >320**）：

```
总数 324，最大区 jiangnan=27
FAIL  9 区块均衡度
  - 房间总数异常：324（B13 目标 312，容差 305–320）
FAILED 6547 通过 / 1 失败
还原 → cmp 逐字节 IDENTICAL；50_map md5 回到 baf7a2a4…
```

**结论：收紧有效。** 324 在旧区间（≤340）下**不会**报红，新区间**准确判红** —— 正是 CN-B13-2 要堵的口子。✅

## 13.2 ✅ 确认 2 · §10 江南直测真的有效

自建变异：在 `jiangnan` 塞一座**非 `jn_home_` 前缀**的民宅 `zz_home_01`（绕过前缀断言，只测新增的 `perReg.jiangnan` 直测）：

```
FAIL  10 富户宅分布
  - 江南仍堆着 2 座富户民宅（应 ≤ 1）
FAILED 6496 通过 / 1 失败
还原 → cmp 逐字节 IDENTICAL；50_map md5 回到 baf7a2a4…
```

**结论：有效。** 新增的 `ok((perReg.jiangnan||0) <= 1)` 正是我 §6 建议的那道双保险，实测能抓住「非前缀民宅堆回江南」。✅

## 13.3 ⚠️ 确认 3 · `map-check` 6492/0 ✅；产品代码变化情况

- `map-check` 实测 **PASSED 6492 通过 / 0 失败**（§10 新增 1 条，与自报吻合）。✅
- `world.js` / `engine.js`：md5 与冻结值**逐字节相同** ⇒ 未再变。✅
- **`commands.js`：mtime = 13:55:48，晚于我的冻结时刻（约 13:53:1x）—— 已查明来源，非外来改动。**
  - 我**未在冻结时记录 commands.js 的 md5**，故先按「疑似并行动作」**上报**。主理人随后**按内容特征核实**归因。
  - **结论：是 `eng-mapdata` 自己 B13 收尾的第二遍编辑**，不是外来改动。依据：
    ① 它报的三处 null-room 守卫**全部在位且用词一致**（`:195`「你似乎不在一个真实所在，辨不清方向。」/ `:276`「这里一片虚无。」/ `:479`「这里一片虚无，四下都看不清。」）；
    ② `doMove` 处**接住 `movePlayerTo` 返回 `{ok:false}` 的守卫也在位**，并带一段 4 行注释（原文写明「B13 连带收尾：`movePlayerTo` 对目标不存在返回 `{ok:false}`……`doMove` 此前**忽略**了返回值、照样报 `moved:true`」）；
    ③ 行号从自报的 191/475 → 实测 195/479，**正好是这段 4 行注释推下去的** ⇒ 13:55 那次即「加 `doMove` 守卫 + 注释」这一遍，属同一次收尾。
  - **旁证**：`commands.js` 内**无任何 B8/功法痕迹**（`skillMap`/`npcSkill`/`applySkillMap` 全无命中），`tools/smoke-npc-skills.js` 亦未出现 ⇒ `eng-b8` 未碰 `commands.js`。
  - **⇒ 无外来改动，不影响 B13 结论。** 全量 **31 套 smoke 仍 31/31 绿**。
- 全量回归（本次重跑）：**31 套 smoke 全部 `exit=0`、零 `✘`** ✅

## 13.4 ✅ 确认 4 · 第 3 处措辞更正成立（`test_room` 来源）

**独立证实 —— 工程自查的更正成立。**

```
grep test_room game/data/50_map.json            → 0（不在成品基础图）
grep test_room mods/test_mod/mod.json           → 命中（L39 房间定义 + L81 NPC.room）
grep test_room tools/smoke-test.js              → 命中（L76 内存夹具自带一份同名房）
引擎合并后世界：rooms=317，test_room 在，region=wild；regions=35
```

- **运行时/成品的 `test_room` 来自已启用 mod `mods/test_mod/mod.json`**（`mods-state.json` 中 `test_mod: enabled`，L39 房间定义 + L81 NPC.room）→ 并入引擎世界（317 房 / 35 区），**属用户可控的 mods 层**。
- `tools/smoke-test.js:76` 里**另有一份同名「内存夹具」**（独立、临时，**不落盘、不并入成品**，仅 `require` 期间存在）—— 二者**同 id 但性质不同**。
- **准确表述 = 「两处都有、但性质不同」**：`mods/test_mod/mod.json` 的是**落盘 mod 数据**（会并入运行时），smoke-test 的是**同名临时夹具**（不落盘）。故「`test_room` 来自 smoke 夹具（不进成品）」这一说法**不准确**；工程自查的**更正成立**。✅
  （注：主理人原表述为「两处都有」，本条据实测进一步**分清了二者性质**。）

## 13.5 收尾判定

| 主理人要求确认项 | 结果 |
|---|---|
| 1 §9 收紧有效 | ✅ 确认（324 判红，旧区间漏、新区间中） |
| 2 §10 江南直测有效 | ✅ 确认（`zz_home_01` 判红） |
| 3 `map-check` 6492/0 + 产品代码未变 | ✅ 6492/0；world/engine 未变；commands.js 的 13:55:48 改动**已查明 = `eng-mapdata` 自身 B13 收尾（加 `doMove` 守卫 + 4 行注释），非外来改动**（§13.3） |
| 4 第 3 处措辞更正成立 | ✅ 确认：`test_room` 两处都有但性质不同——`mods/test_mod/mod.json`（落盘 mod 数据，并入运行时）vs `tools/smoke-test.js:76`（同名临时内存夹具，不落盘）（§13.4） |
| 附加：`smoke-map-migrate` 纳入常规回归 / 冻结 md5 纪律 | ✅ 已核实（README §十一 明文，design/12 基线列 `32/0`） |

**→ B13 数据面 + 连带面 + 验收收尾均定稿，CN-B13-1..4 全部落实，CONCERNS 解除。**
**无遗留留痕**：`commands.js` 13:55:48 的改动已查明为 `eng-mapdata` 自身的 B13 收尾编辑（`doMove` 守卫 + 注释），**非外来改动、不影响 B13 结论**。
**保留待办（不得追认）**：**B5 触屏实机验仍未完成**，只能主人真机做。

*（§13 为收尾追加；§0–§12 未改动。）*
