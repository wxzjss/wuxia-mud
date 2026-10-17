# 107 · 卷五第一批施工单（皇城腹地 + 结局回响，游有方 2026-10-18）

> 承接 97 §九.4 #7。批 7 范围：夏承志天牢两案（2-stage）＋ 结局回响 2 场 ＋ M6 只读盘点。
> 铁律照 105/106：幂等 apply + 独立 check 真走｜朱雀 ≤10｜命令撞车纪律｜
> **挂房动作挂「最后定义该房且带 actions 键」的分片**｜零 rewards 不并主线。

## 一、素材与机制盘点（先说真话）

| 件 | 现状 | 本轮处置 |
|---|---|---|
| `hk_npcv_082_mibao`「埋在院里那份副本」 | 1-stage，require `{"not":{"flag":"know_depot_master"}}`（**时限案**），target `jn_yamen_court` | 2-stage（接案 + 原壳收束），收束**不加锁** |
| `hk_npcv_082_hua`「书房里那幅画」 | 1-stage，require `{"questDone":"mibao"}`，target `palace_prison` | 2-stage（接案 + 原壳收束），收束**不加锁** |
| 结局机制 | 效果 `ending:<key>:<标题>` 会落 `ending_<key>` 旗（modapi.js:828 三写过渡） | 回响场 cond 直接读 `ending_*` 旗 |
| 已落结局 | **jiaojuan（交卷）/ banjiao（半交）/ jujiao（拒交）** —— 分别由 palace_hall 面圣/面圣带抄本/收场 的菜单落 | 回响覆盖这三个 |
| **远航（yuanhang）** | **89 §五 设计已定，实现未落**：全库无 `ending:yuanhang`，也无 `nv_huang_trust` / `xiakedao_invited` 旗 | 回响场② 预留 `ending_yuanhang` 分支（当前不可达，等卷五主线落点），**另报 lead 定落点** |

## 二、件① 夏承志两案 2-stage（口径①：时限压接案点）

**为什么 2-stage 而不是 4-stage**：`mibao` 的 require 是 `notFlag know_depot_master`——「卷四主线未完结才可接」。require 只管接案不管在途；4-stage 会让玩家在 s1/s2 期间通了卷四主线后**永久卡在中间**（交不了也接不了）。2-stage 把时限只压在接案一个点上，收束不再要求任何旗。

**案A 埋在院里那份副本**
| stage | 场景 | 内容 |
|---|---|---|
| 0 接案（新写） | palace_prison | 天牢廊下，他说每递一回就埋一份；院角那层土留着等你刨，刨出来拿去**衙门大堂**见元怀瑾（台词指路） |
| 1 收束（原壳原样，无锁） | jn_yamen_court | 原 narrate（他领你到院角刨土）+ say（留后路）+ 双选菜单**逐字不动** |

- 接案动作「问旧仆」cond 补时限：`and[not quest, notFlag know_depot_master]`（原只有 `not quest`，会绕过 require——批 5/6 同类缺口第三次现形）。
- **指路判据**：s0 台词点破「衙门大堂」＋ 原壳 target 就是该房，双保险；不另加房动作（原壳 narrate 已经演「他领你刨土」，再加一个自己刨的房动作会与收束重复动作）。

**案B 书房里那幅画**
| stage | 场景 | 内容 |
|---|---|---|
| 0 接案（新写） | palace_prison | 他坐在廊下旧凳上：老爷书房那幅画他理了三十年，一次没敢多看；请你替他去**御书房**看一眼画上那片水 |
| 1 收束（原壳原样，无锁） | palace_prison | 原 say（画上记的事是我写进去的）+ narrate（手在袖子里攥了一下）+ 双选菜单**逐字不动** |

- 接案动作「问那幅画」cond 补前置：`and[not quest, questDone mibao]`。
- 指路动作：`palace_study`「看那幅画」（cond `{"quest": hua}`）→ narrate×2：画上是一片水，水里许多小圈；和绣阁那面绣架是同一幅底稿（回收 66「回大殿」的旧意象）。
- 挂 50_map：`palace_study` / `palace_prison` 的 actions 只在 50_map（66 无这两房）。

## 三、件② 结局回响 2 场（两场 × 各 2 结局，四结局全覆盖）

**切分（按「交了 / 没交」的亲缘）**

| 场 | 落点 | 覆盖结局 | cond |
|---|---|---|---|
| ①「殿上余响」 | `palace_hall`（挂 66） | **交卷**（jiaojuan）／**半交**（banjiao） | `and[or[ending_jiaojuan, ending_banjiao], notFlag echo_hall_seen]` |
| ②「出宫余响」 | `palace_road`（挂 66） | **拒交**（jujiao）／**远航**（yuanhang，预留） | `and[or[ending_jujiao, ending_yuanhang], notFlag echo_road_seen]` |

- **每场内部用 `cond` 效果按旗分支**，一场只出一句，不并列罗列：
  - 场① 交卷 →「案上那本册子还摊着，末页的名字墨色没干透 / 街上念你的名字，念的是书里那一行，你站在那行字外头」；半交 →「笔尖上的墨凝成一颗，没落下去 / 往后江湖上提起那一年，说的都是别人」。
  - 场② 拒交 →「城门上贴着你的画像，风把边角吹起来又按回去 / 有人放过酒，也有人吐过唾沫，两样你都收下」；远航 →「船离岸的时候，岸上的人都还站在原地 / 海上的雾把皇城收进去，收得很干净」。
- 落 `echo_hall_seen` / `echo_road_seen` 去重（一次即止）。
- **零 rewards、不并主线**；`cmd` 用「殿上余响 / 出宫余响」并**排到 actions 头部**——`palace_road` 既有「过御道」keywords 含『御道』，任何含御道的 cmd 会被它先命中（批 6「渡海/船」同族）。

## 四、件③ M6 只读盘点
单独出档 `design/108-m6-daily-vs-side.md`：79 条 `sq_npcv_*` 按「有人有事有收口（够格留支线名分）vs 六种壳（采药/采买/送信/讨债/打探/了结）」分类 + 判据表。**只读，不动数据**。

## 五、验收
1. 两案 2-stage 真走（接案→原壳收束→菜单真选）；原壳逐字快照。
2. **时限兜底**：已接 mibao 在途 → 置 `know_depot_master`（模拟卷四通关）→ 回来仍能交、菜单照出。
3. 时限入口：`know_depot_master` 已置 → 接不了案。
4. 回响两场：置对应 `ending_*` → 一句话出现且**同场另一结局的句子不出现**；去重；不满足时不给假入口。
5. 朱雀 per-asset ≤10 ＋ ai-flavor ＋ map-check ＋ smoke-sidequest ＋ quest-sanity ＋ check-data-load。

## 六、风险与可砍项

| # | 风险 | 处置 |
|---|---|---|
| 1 | **远航结局实现未落**（无 `ending:yuanhang`、无 `nv_huang_trust`/`xiakedao_invited`）→ 场② 的远航分支当前不可达 | 回响文本先落（cond 预留），落点报 lead 定（建议卷五主线在东海登船处补 `ending:yuanhang`）；不自行扩主线 |
| 2 | 时限案老档：玩家已接 mibao 但卷四已通关 | 收束无锁 + 兜底断言实测（验收 2） |
| 3 | 两场回响都排在 actions 头部 | 只在 cond 满足时可见；不满足回「现在做不了这个」，不挡既有动作（验收 4 实测） |
| 4 | 回响依赖 `ending_*` 旗，若引擎 `ending` 效果口径变更 | 断言直接读旗（`ending_jiaojuan` 等），不读 `p.ending` 结构，稳 |

## 七、落地记档（2026-10-18 收官，游有方）

**状态：绿。** apply 两连跑幂等；真走 **33/0**；朱雀 0 条 >10（1663 条）；ai-flavor 0/0；map-check 6484/0；smoke-sidequest 57/0；quest-sanity 30/0；check-data-load 76/0。

| 件 | 载体 | cmd | cond | flag |
|---|---|---|---|---|
| 案A 埋在院里那份副本 | 61（2-stage） | 接案「问旧仆」 | `and[not quest, notFlag know_depot_master]` | 原菜单 keep / give |
| 案B 书房里那幅画 | 61（2-stage） | 接案「问那幅画」 | `and[not quest, questDone mibao]` | 原菜单 clear |
| 指路（50_map） | palace_study | 端详那幅画 / [那幅画, 画上那片水, 书房画] | `{"quest": hua}` | — |
| 回响①殿上余响 | 66 · palace_hall（排头） | 殿上余响 | `and[or[ending_jiaojuan, ending_banjiao], notFlag echo_hall_seen]` | echo_hall_seen |
| 回响②出宫余响 | 66 · palace_road（排头） | 出宫余响 | `and[or[ending_jujiao, ending_yuanhang], notFlag echo_road_seen]` | echo_road_seen |

**本批新踩的坑（防复发）**
1. **以「看」开头的 cmd 会被内置 look 截走**：`看那幅画` 实测走成「看名词」（回房间描写 + 可接任务行），房动作根本没执行；而 keywords 里的「那幅画」「画上那片水」正常命中。既有条目「看封墙」之所以活着是历史遗留。**纪律：新动作不要以「看」开头**（本轮改词 `端详那幅画`）。
   - 我此前向 lead/寇豆码报过「看当铺告帖 / 看行情帖 实测能命中，cmd 可以以内置主词开头」——**该结论只对那几条老条目成立，不能推广**。本次实测推翻推广性，归因更正记录在此。
2. 改 cmd 时幂等键是 cmd，旧条目会残留并与新条目共 keywords → 必须在 apply 里显式清理旧 cmd（本轮已加）。
3. 「过御道」有自定义 failMsg（「御道还长……」），check 断言不能假定统一的「现在做不了这个」——判据应看**副作用 flag 是否落下**。

**留给别的 lane 的件**
1. **远航结局已落（`haitan_boat`「上船离港」）**，按 lead 裁定**不放悬空旗**：cond 收窄为现网真有三旗 `and[three_words, haitan_ferry_seen, notFlag act5_done, notFlag act5_sail]`——`three_words` 卷五 stage3 真落、`haitan_ferry_seen` 批6 接引场（逼玩家先问船期）、面圣了结后不再放人走。效果落 `ending:yuanhang:远航` + `act5_sail`（去重），零 rewards、不 questdone 主线。
   - **卷五主线 backlog（记档待补）**：89 §五 原设计的 `nv_huang_trust≥70` / `xiakedao_invited` 两旗**全库无 setter**（悬空旗）。待卷五主线补 setter 后，把 cond 放宽为 `or[three_words, nv_huang_trust>=70, xiakedao_invited]`。
2. M6 落地（追踪器分组 / `daily:true` 字段）→ 见 `design/108-m6-daily-vs-side.md`，等寇豆码 lane；**lead 已定：先出表（附录 A 79 条逐条）核完再动，降名分不先落**。
