# 106 · 卷四第一批施工单（黑木崖腹地，游有方 2026-10-18）

> 承接 97 §九.4 #6。铁律照 105/102：S3 范式｜散人双通道真走｜指路 ≥1｜rewards 不并主线｜
> 幂等 apply + 独立 check｜朱雀 ≤10｜命令撞车纪律｜**挂房动作挂「最后定义该房且带 actions 键」的分片**。
> 落法：`tools/_apply_j4b_batch1.py`（两连跑幂等 + 断言）＋ `tools/_j4b_batch1_check.js` 真走。

## 一、素材盘点（全部现成，零新人设）

| 资产 | 位置 | 状态 |
|---|---|---|
| 皮朝颜 | npcv_164，room `mojiao_shanmen`（40_npcs） | 61 npcs 已有接案动作「问赌坊」「问枯井」 |
| 案1 那笔周转银子 | 61 `hk_npcv_164_yinzi`，1-stage，require 无 | 收束菜单双选（替她查账 / 回报教中）＝原壳，后移 |
| 案2 死人账 | 61 `hk_npcv_164_sirenzhang`，1-stage，require `questDone: yinzi` | 收束菜单双选（揭发 / 掩盖）＝原壳，**本轮保 1-stage** |
| 山门 / 大殿 / 绣阁 / 渔船 | `66_mainline_act45.json` rooms（**四房都有 actions**） | 挂房一律挂 66（批 5 血泪纪律） |
| 哨卡主线咬合 | `sentinel1`（山门哨卡通过旗）、`moye_sentinel`（三道哨卡全过）、`act3_done`（上崖前置） | 均 66 现成，不新造 |
| 卷四末海路 | `haitan_boat`（东海岸边，「渡海」需 `has_canjuan` → `taohua_road` 卷五） | 本轮加「问船期」= 接引不代步 |

## 二、案 A · 那笔周转银子（4-stage S3 改造）

**一句话**：她管了半辈子账，攒下一井银子。井是空的，账上那笔「采买」还在。

| stage | 场景 | 内容 | flag |
|---|---|---|---|
| 0 接案（新写） | mojiao_shanmen | 她说账上有一笔动过的银子，走的不在明账；要查成色，先去大殿翻旧账 | — |
| 1 大殿旧账 | mojiao_hall | 旧账里同一笔进出记了两遍，一遍「采买」，一遍只画个圈 | `yinzi_ledger` |
| 2 崖后枯井 | mojiao_shanmen | 井口压着青石，井壁有绳沟，井底没有水声 | `yinzi_well` |
| 3 收束（原壳原样后移） | mojiao_hall | 原 narrate（茶渍账本）+ say（「一枚没动」）+ 原菜单双选**逐字不动** | next 99 |

- **原壳里的「一枚没动」与新写 s2「井早就空了」是同一件事的两面**：她说的不是假话，是她一直没敢去看。案 2 收束语已证井底空（canon），本批不重复揭示。
- **卷界锁**：`lock: act3_done`，msg「黑木崖上的账，是过了雪谷之后的事」。说明：卷四案发生地就在黑木崖，**入口即卷界**（能上崖必有 `act3_done`），所以锁取卷四界 `act3_done` 而**不取** `know_depot_master`——后者是卷四主线末才落的旗，取它会把腹地支线钉死在主线通关之后，伤体验。这是对「收束锁卷界」范式的**有意收窄**，记档在此。
- 接案动作「问赌坊」cond 补 `act3_done`（入口锁）＋ 保留原 `not quest`。
- 指路 2 处：大殿「翻旧账」、山门「摸井沿」（cond 各挂对应 quest 进行中）。

## 三、案 B · 死人账（保 1-stage，只补前置）

- 原壳已是一台完整收束：target mojiao_shanmen（同房计数）→ 交差 → narrate（那批孩子是她经手的）+ say + 菜单双选。
- **本轮只修一处缺口**：接案动作「问枯井」cond 原只有 `not quest`，会绕过 `require.questDone: yinzi`（批 5 同类缺口），补成 `and[not quest, questDone yinzi]`。
- 不做 4-stage 化的理由：它是案 A 的**余波收束**，戏力在两句台词与双选上；加水 stage 只会稀释。范围纪律：卷四本批预算给 L4 三场与海路接引。

## 四、件② L4 腰牌过哨三场（mojiao_shanmen，正/邪/散三立场）

按 95 §二 b 案：**karma + rep 双轴**，零引擎改动（不做 align 读取）。三场是**同一道哨卡的三条走法**，玩家自选其一，落同一旗 `sentinel1`（等价主线山门哨卡通过，与「闯山门」「探后山」并列的第三条路）。

| 场 | cmd / keywords | cond | 戏核 |
|---|---|---|---|
| ① 正派·亮腰牌 | 亮腰牌 / [亮腰牌, 腰牌, 门派牌] | `and[act3_done, hasSect, karma>=20, notFlag sentinel1]` | 递牌验门派：「同道的路，我们不为难」 |
| ② 邪派·报号 | 报号 / [报号, 递名帖, 报名号] | `and[act3_done, or[karma<=-20, rep 日月神教>=40], notFlag sentinel1]` | 只报名号，哨卫笑：「崖上收的就是你这种人」 |
| ③ 散人·对暗号（karma 轴） | 对暗号 / [对暗号, 暗号, 留话] | `and[act3_done, noSect, notFlag sentinel1]` + 内部 `if karma>=20` | 善缘放行（有人替他留过话）；karma<20 → 不拦也不让，指回正门/后山 |

- **散人双通道**：③ 是散人专属通道，karma 轴判放行（95 §二 b 的 b 案落地）；不满足时**不给假入口**（明说这条道不认生人），主线原有「闯山门」「探后山」照旧可走。
- **与批 5 北疆验牌的分工（不撞戏）**：北疆 `beijiang_shankou`「递牌」验的是**单子**——运单与往来簿对账，认货认人；黑木崖「亮腰牌/报号/对暗号」验的是**人**——门派牌、名号、善缘，一张纸都不看。文案上北疆有簿子与「对过账」，黑木崖全程没有账。
- 三场均为零 rewards；不动 `moye_sentinel`（三哨全过仍由绣楼戏落）。

## 五、件③ 卷四末海路接引场（haitan_boat）

- cmd「问船期」/ [问船期, 船期, 几时开船]，cond `and[act4_done, notFlag haitan_ferry_seen]`。
- 戏：艄公补网不抬头 → 一个月两趟，一趟往东（岛上没有活人想你上去），一趟往南（京里来的人在码头等货）→「你要走哪一趟，想好了再来。船不等人，人也不必等船。」
- 与既有「渡海」分工：**渡海 = 真走**（要 `has_canjuan`、落 `taohua_road` 进卷五）；**问船期 = 接引**（问路不走路，纯去处提示，零 rewards）。
- flag `haitan_ferry_seen`（一次即止，不进主线判定）。

## 六、验收（固定栏）

1. 案 A 全 stage 真走通（造玩家、置 act3_done、接案 → s1/s2 计数 → 回山门交差 → 收束菜单真选）。
2. 原壳快照逐字核对（narrate / say / menu raw 三条）。
3. 收束 `lock=act3_done`、`next=99`、新 stage 零 rewards。
4. 指路 2 处真触发 + keywords 全库不撞（避让「探后山/闯山门/过前殿/回大殿/过前殿」既有动作与全局主词）。
5. L4 三场：正（hasSect+karma）/ 邪（karma 负或魔教 rep）/ 散（karma 轴两分支）真走 + `sentinel1` 断言；不满足时不给假入口。
6. 海路接引：act4_done 前不给入口，之后真触发 + 去重。
7. 朱雀 per-asset ≤10 ＋ ai-flavor ＋ map-check ＋ smoke-sidequest ＋ quest-sanity ＋ check-data-load 不回归。

## 七、风险与可砍项

| # | 风险 | 处置 |
|---|---|---|
| 1 | 三场都落 `sentinel1`，与主线「闯山门」互斥（notFlag） | 有意为之：同一条哨卡只过一次；三场是三条走法，先到先得 |
| 2 | 散人场与邪派场并存：karma<20 的散人「对暗号」被拒、「报号」能进 | 设计意图：恶名也是路。档内写明「三通道按玩家选择，非互斥判定」，不视为 bug |
| 3 | 案 B 保 1-stage 与批 4/5「4-stage」范式不一致 | 有意收窄：它是余波收束，戏力在两句台词；范围预算给 L4 三场与海路 |
| 4 | 收束锁取 `act3_done` 而非 `know_depot_master` | 有意收窄，理由见 §二；若要严格锁卷四末，改一个 flag 即可，但会伤腹地可玩性 |
| 5 | 皮朝颜两案在未过卷三时不可见（山门不可达） | 入口 cond `act3_done` 兜底，不靠 require 猜 |

## 八、落地记档（2026-10-18 收官，游有方）

**状态：绿。** apply 两连跑幂等（全「已落，跳过」）；真走 **42/0**；朱雀 **0 条 >10**（1663 条全量）；ai-flavor 0/0；map-check 6484/0；smoke-sidequest 57/0；quest-sanity 30/0；check-data-load 76/0。

| 件 | 载体（分片） | cmd / keywords | cond 口径 | flag |
|---|---|---|---|---|
| 案A 那笔周转银子 | 61（4-stage） | 接案「问赌坊」 | `and[act3_done, not quest]` | yinzi_ledger / yinzi_well / 原菜单 flag hk_sirenzhang |
| 案A 收束 | 61（原壳后移） | — | `lock: act3_done` + `next 99` | 原菜单双选逐字 |
| 案B 死人账 | 61（保 1-stage） | 接案「问枯井」 | `and[not quest, questDone yinzi]` | 原菜单 flag hk_npcv_164_sirenzhang_expose |
| 指路（66） | mojiao_hall / mojiao_shanmen | 翻旧账 / 摸井沿 | `{"quest": hk_npcv_164_yinzi}` | yinzi_ledger / yinzi_well |
| L4 ①正 | 66 · mojiao_shanmen | 亮腰牌 / [亮腰牌,腰牌,门派牌] | `and[act3_done, hasSect, karma>=20, notFlag sentinel1]` | sentinel1 |
| L4 ②邪 | 66 · mojiao_shanmen | 报号 / [报号,递名帖,报名号] | `and[act3_done, or[karma<=-20, rep 日月神教>=40], notFlag sentinel1]` | sentinel1 |
| L4 ③散 | 66 · mojiao_shanmen | 对暗号 / [对暗号,暗号,留话] | `and[act3_done, noSect, notFlag sentinel1]` + 内层 `if karma>=20` | sentinel1（karma 不足明说不放） |
| 海路接引 | 66 · haitan_boat（**排 actions 头部**） | 问船期 / [问船期,船期,几时开船] | `and[act4_done, notFlag haitan_ferry_seen]` | haitan_ferry_seen |

**本批新踩的坑（防复发）**
1. **既有动作的 keyword 会吞新 cmd（子串吞词）**：`haitan_boat`「渡海」keywords 含单字『船』，任何含「船」的输入先命中渡海（cond 不满足就吃它的 failMsg）。修法：新动作**排到 actions 头部**（`questKeyword` 按数组序先到先得），并在 apply 里加断言「既有动作 keyword 若是新 cmd 子串，其 idx 必须在新动作之后」。
2. **平台差异**：`mojiao_shanmen / mojiao_hall / haitan_boat` 的 actions 全在 `66_mainline_act45.json`（50_map 同房无 actions 键）→ 一律挂 66。批 5 的「挂最后定义分片」纪律第二次验证成立。

**有意收窄（已在 §二/§七 记理由，供 lead 复核）**
1. 卷四界锁取 `act3_done` 而非 `know_depot_master`——后者是卷四主线末才落的旗，取它会把腹地支线钉死在主线通关之后。
2. 案 B 保 1-stage，只补前置 cond——它是案 A 的余波收束，戏力在两句台词与双选。
3. L4 三场都落 `sentinel1`（与主线「闯山门」同旗）——同一条哨卡只过一次，三条走法先到先得。
