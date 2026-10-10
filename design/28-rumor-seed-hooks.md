# 《传闻种子埋点作业单》· B22

> **用途**：这是给**工程**照落的作业单（拆自 `design/25-story-rumor-binding.md` §9）。
> **只补「调用点」，不改种子数据** —— 16 条种子的数据**已全在 `game/data/70_world.json`**
> （`polarity` / `weight` / `heat0` / `tauDays` / `ttlDays` / `loud` / `texts` / `marks`）。
>
> **任务号**：#116 → 工程侧 **B22** ｜ 台账见 `design/12-owner-bug-list.md`
> **边界**：**本表只写设计，不写代码**。

---

## 一、现状（为什么需要这张表）

| 项 | 数字 |
|---|---|
| `70_world.json` 里已定义的种子 | **16 条** |
| **已被代码调用的** | **仅 2 条**（`rs_kill_named` / `rs_kill_civilian`） |
| **需补调用点的** | **14 条**（本表） |
| 全仓 `addRumor(` 调用点 | **仅 1 处**（`world.js` 击杀 NPC 处，一个三元表达式） |

⇒ **后果**：善恶名 → 声望（`rep`）的链条基本是断的。
**现状 `rep` 只对「杀人」生效** —— 偷窃、救人、行善、越狱、叛门……**全都不产生任何世界后果**。

---

## 二、`opts` 契约与目击规则（引擎既有，**非新增机制**）

```js
addRumor(seedId, { room, subject, about, vars: { who, where, whom } })
```

- **`room` 必填** —— 决定 `originRegion`（传闻从哪个区域起）
- **`subject` 默认 `'player'`** —— 玩家行为恒可不传
- **`about`** = 相关 NPC / 门派 `defId` —— **决定 Δrep 落到哪个键**（门派键 or `'*'`）
- **`vars.{who, where, whom}`** —— 供种子 `texts` 里的 `{who}` / `{where}` / `{whom}` 插值

**目击规则（引擎既有）**：
- 同房间**非 `hostile` 非晕倒**的 NPC **必为目击**
- 种子 `loud === true` 时，**邻房间 50%**（夜 ×0.5 / 雨 ×0.7）
- **目击者 0 → 引擎拒绝生成传闻**（无人区不传）

> ⚠️ **落地位一律按「模块 + 语义位置」写，不写行号**（团队规范：行号会漂移）。

---

## 三、14 条埋点（作业主体）

| # | 种子（kind · 极性） | 触发动作（玩家行为） | 落地位置（模块 · 语义） | `opts` | 目击（`loud`） |
|---|---|---|---|---|---|
| 1 | `rs_theft_caught`（偷窃 · −1） | 偷窃**被抓** | `commands.js` · 偷窃指令（`steal`/`偷`）的「被抓/败露」分支 | `room=<案发房>`, `about=<被偷者defId>`, `vars:{who,where,whom=被偷对象}` | **false** → 仅同房间 |
| 2 | `rs_resist_arrest`（抗官 · −1） | **拒捕/抗官**（被官差追捕时动手） | `world.js` · 「行凶报案 / `p.wanted`+1」同一语义点；或 `commands.js` 官差交互的「反抗」分支 | `room=<冲突房>`, `about=<捕快/官府defId>`, `vars:{…,whom=捕快名}` | **true** → 邻房（打斗声） |
| 3 | `rs_save_life`（救人 · +1） | **救人一命**（把濒死 NPC 救回 / 送药救命） | 支线 `effects` 或世界事件结算的「救人成功」分支 | `room=<救人现场>`, `about=<被救者defId>`, `vars:{…,whom=被救者名}` | **false** → 仅同房间 |
| 4 | `rs_alms`（行善 · +1） | **施舍**（给乞丐/贫民钱物） | `commands.js` · `give_money`/`给钱`、`give`/`给`、`song`/`送礼` 中「对象 ∈ 乞丐/平民」的分支 | `room=<施舍处>`, `about=<受施者defId>`, `vars:{…,whom=受施者名}` | **false** → 仅同房间 |
| 5 | `rs_tournament_win`（扬名 · +1） | **比武夺魁**（擂台/大比夺头名） | `combat.js` 或比武结算的 **win** 分支（若现仅有 `qiecuo`/切磋，挂在「连胜/夺魁」结算语义） | `room=<比武场>`, `subject:'player'`, `vars:{…,whom='众目睽睽'}` | **true** → 邻房（满场喝彩） |
| 6 | `rs_sect_join`（门派 · +1） | **拜入门派** | `commands.js` · `join`/`拜师`/`入门` 成功分支（`joinSect`） | `room=<山门>`, `about=<门派id>`, `vars:{…,where=门派名}` | **true** → 邻房 |
| 7 | `rs_sect_betray`（门派 · −1） | **叛门/脱派** | `commands.js` · `leave`/`脱离门派`/`叛门` 成功分支（`leaveSect`） | `room=<山门>`, `about=<门派id>` | **true** → 邻房 |
| 8 | `rs_deadbeat`（失信 · −1） | **赖账**（欠债逾期不还且被债主察觉） | `kidnap.js` · 债务系统或催债语义（`w5_debt_collector`）的「逾期/赖账」分支 | `room=<债主处>`, `about=<债主defId>`, `vars:{…,whom=债主名}` | **false** → 仅同房间 |
| 9 | `rs_break_marriage`（风评 · −1） | **休妻/毁婚** | `marriage.js` · 退亲/离异，或 `commands.js` · `sever`/`断义` 的解除分支 | `room=<所在房>`, `about=<配偶defId>`, `vars:{…,whom=配偶名}` | **false** → 仅同房间（家丑） |
| 10 | `rs_secret_out`（揭私 · −1） | **泄密**（把某 NPC 的 `secret` 说出去） | `commands.js` · `talk`/`say` 涉及秘辛话题，或支线 `effects` 的「揭私」分支 | `room=<对话处>`, `about=<秘辛所属NPC的defId>` | **true** → 邻房（传得快） |
| 11 | `rs_dungeon_clear`（奇遇 · +1） | **破秘境/清地牢** | 秘境通关结算点（`world.js` 或对应秘境 mod 的通关处） | `room=<秘境>`, `about=<秘境id>`, `vars:{…,whom=秘境之名}` | **false** → ⚠️ **见注意 1** |
| 12 | `rs_drunkard`（市井 · 0） | **酗酒**（酒馆连饮/醉倒） | `commands.js` · `use`/`吃`/`喝` 饮酒累计超阈值，或酒馆特殊事件 | `room=<酒馆>`, `vars:{…,where=酒馆名}` | **false** → 仅同房间 |
| 13 | `rs_bigspender`（豪客 · 0） | **挥金**（单笔消费超阈值） | `commands.js` / 交易结算的「金额超阈值」分支（买宅/办酒/请客） | `room=<消费处>`, `vars:{…,whom='掌柜'}` | **false** → 仅同房间 |
| 14 | `rs_jailbreak`（重案 · −1） | **越狱**（越狱/突围成功） | `kidnap.js` · `escapeMarket`（黑市突围），或 jail 系统的「越狱成功」分支 | `room=<牢房/黑市>`, `about=<官府defId>`, `vars:{…,where='牢房'}` | **true** → 邻房（大动静） |

---

## 四、三条落地注意（**必读，前两条会踩坑**）

1. **⚠️ `rs_dungeon_clear` 的「目击者 0」陷阱**
   独闯秘境常常**无人在场** → 引擎会**直接拒绝生成**（`addRumor` 内 `if (!witnesses.length) return null`）。
   **正解**：在**玩家回到有 NPC 的房间**时补触发，或把该种子 `loud` 调 `true` 并确保邻房有人。
   **不要**为了让它在秘境里生效而改「目击者 0 也生成」—— 那会破坏"无人区不传"的世界规则。

2. **⚠️ `about` 决定 `rep` 落点**
   涉及**门派弟子**或发生在**门派地盘**时，`about` 传该 `defId` → Δrep 落到**门派键**；
   否则落 `'*'`（全江湖）。**这一列不能随便填**，填错会让声望涨错地方（且不报错）。

3. **已接线的 2 条（仅作对照，不必重做）**
   `rs_kill_named` / `rs_kill_civilian` 已在 `world.js` 击杀 NPC 处调用
   （`named` 由 `sect` / `tier` / `unique` / `portrait` 判定）。
   ⇒ **B22 要补的是上表 14 条。**

---

## 五、核对表（工程逐条打勾 · 验收逐条核）

| # | 种子 | 调用点已补 | 备注 |
|---|---|---|---|
| 1 | `rs_theft_caught` | ☐ | |
| 2 | `rs_resist_arrest` | ☐ | |
| 3 | `rs_save_life` | ☐ | |
| 4 | `rs_alms` | ☐ | |
| 5 | `rs_tournament_win` | ☐ | |
| 6 | `rs_sect_join` | ☐ | |
| 7 | `rs_sect_betray` | ☐ | |
| 8 | `rs_deadbeat` | ☐ | |
| 9 | `rs_break_marriage` | ☐ | |
| 10 | `rs_secret_out` | ☐ | |
| 11 | `rs_dungeon_clear` | ☐ | ⚠️ 注意 1 |
| 12 | `rs_drunkard` | ☐ | |
| 13 | `rs_bigspender` | ☐ | |
| 14 | `rs_jailbreak` | ☐ | |

**验收建议断言**（供工程参考）：
- 全仓 `addRumor(` 调用点 **≥ 15 处**（14 条 + 既有 1 处三元）
- **逐条真触发**：用固定 seed 走真实 `exec` 路径触发该行为 → 断言该 seed 的传闻**真的生成了**
  （`world.rumors` 里出现对应 `seedId`）
- ⚠️ **不许用静态 grep「代码里有 `addRumor('rs_xxx'`」当断言** —— 那是假绿（本项目已抓出 11+ 处同类）

---

*源：`design/25-story-rumor-binding.md` §9 ｜ 拆出人：主理人（2026-10-10）｜ 变更请同步回 §9*
