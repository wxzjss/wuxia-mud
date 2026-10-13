# 95 · S3 卷二骨架施工单（起草稿，只读不动 data）

> 依 90 §五 S3 四件：六案六线矩阵 / 门派咬合四层落位 / 声望键位落定 / 卷一末收束接缝。
> 引擎能力逐项 grep 核实（modapi.js evalCond 全表 + character.js + commands.js），现成/缺口如实标注。

## 〇、起草前勘误（先说，影响多项裁决）

**evalCond 实测支持 time 和 chance**（modapi.js 328–359 行，我此前在 94 号报告「无时间字段」「无随机」是错的——只 grep 了 modapi 实现没对 condKeys 全表，engine.js 2652 行的 condKeys 列表里 time/season/weather/chance/karma/rep/quest/stage 全都在）。已补入 94 §八勘误、82 号措辞已改。影响：时辰门可做（请重开 94 四裁决之 4）；随机判定存在但 82「莽撞自选」维持为**设计立场**。

---

## 一、六案六线矩阵（软锁池 A · 中原六区）

**纪律**：数量不增只重排（90 经济节）；每案=一个具体的人的具体麻烦（89 §七·d）；从 60/61 池挑件改造，改什么如实列。

| 区 | 案名（暂） | 复用哪条 | 案由（具体的人的具体麻烦） | 改什么 | 线索 flag |
|---|---|---|---|---|---|
| 衙门府 | 府衙那只箱子 | 61 `hk_npcv_091`（屈疏：府衙那只箱子/两个小子的棉袄） | 抄档人屈疏压着一箱账——报上去两个孩子过不了冬，不报这案子就烂在箱子里 | ①NPC 落点 jn→yamen_office（N1 自查重跑）②收口句加联动段「箱底那张纸的印记，你见过——门里库房的封条上就是这一个」 | `clue_yamen` |
| 洛阳 | 仓里那三个月 | 61 `hk_npcv_174`（俞初：仓里那三个月/掌心里那把米） | 官仓亏空三个月，管仓的老吏拿自己的米填——填不满，也不想再填了 | ①落点迁 luoyang_*（官仓房）②同款联动收口句（印记/编号与门里库房对上） | `clue_luoyang` |
| 长安 | 那半张盐引 | 61 `hk_npcv_215`（闵春晓：那半张盐引/孟明亡母那笔钱） | 半张盐引牵出亡母的抚恤——有人拿死人的名头领了三年的引 | ①落点迁 changan_*②联动句同款 | `clue_changan` |
| 襄阳 | 江上那三条船 | 61 `hk_npcv_208`（：江上那三条船/十年前那条船） | 汉水漕船十年前三条没到——船钱有人领，船没人见过 | ①落点迁 xiangyang_*（码头房）②联动句同款 | `clue_xiangyang` |
| 成都 | 秤砣上那点尘 | 61 `hk_npcv_237`（：那口刀伤/秤砣上那点尘） | 市秤缺斤两，管市的把提意见的人打伤了——伤在明处，秤在暗处 | ①落点迁 chengdu_*（市集房）②联动句同款 | `clue_chengdu` |
| 姑苏 | 枫桥那个人贩子 | 61 `hk_npcv_223`（蓝若愚：枫桥那个人贩子/城外那个瞎婆）——**已在 gusu，零迁址** | 人贩子借漕船带货，瞎婆的儿子十年前就是那「货」里的一批 | ①案由补一句与东厂掳人暗线的呼应（不点破，只说「这种船不止走漕米」）②联动句同款 | `clue_gusu` |

**拼图解扣（零引擎缺口）**：每案收口 effects 加 `incvar clue_count` + 对应 clue flag；委托线 NPC（方证/冲虚两条，65 成稿）的「浮名」action 写 `cond:{var:'clue_count',op:'>=',4}` + `notFlag:act2_mole_named`——破任意四案，内鬼名字自己浮出来。收口文本不解释机制，只说「这几桩案子搁在一起看，少的东西是同一路人拿走的」。
**工期兜底**（90 已批）：砍到四案时拼图门槛 4→3（var 条件改 3），矩阵照用。

## 二、门派咬合四层落位表

| 层 | 落位 | 引擎能力 |
|---|---|---|
| L1 卷二·拜山（闯山门） | 71 设计三 guards.js 现成；43 门派各家山门拦截已跑。主线侧 `q_main_sect` require know_east_depot 已修（60_quests:6966 有 require，65 §2 处置落库确认） | **现成** |
| L2 卷二·查案（sectContrib 兑换线索） | 兑换点设各家**传功堂/执事 NPC**：一个 action「问门里的差事」，effects 走差事系统给线索。差事给贡献（commands.js:4251）与 `spendSectContrib`（character.js:927）都是现成 | ⚠️ **半个缺口**：DSL 无 ±sectContribution effect（modapi 无 case）。两条路：a) 引擎加 `case 'contrib': p.sectContribution += num(...)`（一处小改，正负通吃）；b) 兑换点走门派商店货币。**建议 a**——一并请寇豆码，与 view 瘦身同批。落库前线索兑换先用 flag 代替（线索直接由差事收口给，不走贡献扣减），不阻塞 |
| L3 卷三·身份分岔 | 文书线 action `cond:{hasSect:true}`；黑市线 `cond:{noSect:true}`（散人花黑价、加一条黑市人脉 flag）。condKeys 实有 sect/sectNot/hasSect/noSect | **现成** |
| L4 卷四·立场（哨卡过法） | 亮腰牌过哨：cond 需查「门派 align」——condKeys **无 align 键**。两案：a) 引擎加 align 读取（evalCond 一处）；b) 用 karma 代替（正派弟子过哨 ≈ karma 正 + hasSect + 该派 rep≥N）——89 黑木崖本就设计 karma 双轴。**建议 b**：零引擎改动，且「腰牌过哨」叙事上就是名声+身份，rep 键写门派名现成（`cond:{rep:'华山派',op:'>=',value:50}`） | b 案现成 / a 案缺口 |

## 三、声望键位落定表（89 §七·补二 → 落数）

**键位清单**（p.reputation 字典，0–300 区间，锚点 20/80/150/300 沿 90 §四·补）：

| 键 | 写入来源（全走「做了什么」） | 读在哪 |
|---|---|---|
| `*` | 比武扬名（culture.js 已有）/走镖收口/文化项目 | 思过崖、卷三名头场 |
| 洛阳/长安/襄阳/姑苏/成都/衙门 | 六案收口各 +60（该区键）+ 平匪患类支线 | 各区准入、本地人给不给面子 |
| 漕帮 | 襄阳船案收口 +20、漕运差事 | 漕帮码头（89 错位表：不看武力看交情） |
| 各门派名（华山派/武当派/…） | 门派差事（已有 rank 系数）、门内任务 | L4 腰牌过哨、门内文书 |
| 侠义/恶名 | 绑架/硬闯（**已有，不动**）；82 禁令：只随事件涨跌，不随交易变化（M4 批注随下批落） | 皇宫内苑/禁地双轴 |
| flag 点名声望 | 作保：当铺掌柜/船家/驿丞各一条「替你说过话」flag | 少数点名场合（丙案 flag 部分） |

**思过崖门槛 cond 草案**（89 错位表：卷一后 + 剑法 + 名头）：

```json
{ "and": [
  { "flag": "act1_recognized" },
  { "skill": "基本剑法", "op": ">=", "value": 30 },
  { "rep": "*", "op": ">=", "value": 80 }
] }
```

- 落点：huashan_qingke w 出口（思过崖入口）改带此 cond；`say` 拒文案照铁律念名声现状+指路：「守崖的弟子拦下你：『思过崖是本门清修地。你的名头，江湖上还没人提过。』——擂台上赢几场，或者替人走一趟镖，再来。」（数值 80=本地扬名锚，数值侧可核调）
- 乙分支玩家（act1_kept_silent）名头无来源时会卡死在 80——**开一个乙分支专属来源**：卷二某支线「替人作证」事件 +40 `*`（呼应乙分支「三回没有人」的回响，第一次有人替他说话是他自己挣的）——一处 narrate+rep，S3 落。
- 分区域风声（rf.reputationLines 扩展）：小改，报寇豆码排队；S3 先用现有全局风声。

## 四、卷一末收束件：act1 → q_main_sect 接缝

**现状核对**（逐处 grep）：

- 铜牌发放场：65 `road_huashan_1「夜宿山道」`（拦/不拦双分支都给 know_east_depot + depot_token_half + q_main_sect:0）——**cond 是 `{and:[{hasSect:true},{notFlag:'jiuye_done'}]}`**。
- `q_main_sect` require know_east_depot 已修（65 §2 落库）。
- act1 收口 flag：act1_recognized（认痕，63 片）。

**接缝方案**：

1. **散人断线（必须修）**：夜宿山道 cond `hasSect:true` 把散人锁死——散人拿不到 know_east_depot，q_main_sect require 永不满足，**散人线在卷二入口就断**（89 §四铁律「散人线全程可行」直接冲突）。改法：cond 改 `{and:[{flag:'act1_recognized'},{notFlag:'jiuye_done'}]}`——认痕夜=「入过一次山门」的戏（成不成弟子不论，89 L1 原意），弟子与散人同场撞上拦车戏，咬合更紧（74 味：那晚你都在崖上，下山路上撞见车马，天经地义）。
2. **时序钉死**：拦车戏加 `cond.time` 夜段（{min:1140,max:359}，酉末~卯前）——勘误后 time 可用，74 味「将死之人」必须夜里出现，白撞见就成了案发现场旅游。
3. **双分支给牌统一**（65 已成，只核）：拦/不拦都给牌与 flag——保留，89「被拒也是戏」的对称写法。
4. act2 开场（拜山）require 不动；`act1_*` 串在 S3 不再新增，只在 63 片收口句尾部把「你把那句话带到了/没带到」的选择回响接进方证/冲虚委托的开场白各一句（改动 2 处 talk，S3 内做）。

## 五、风险与可砍项

| # | 风险 | 处置 |
|---|---|---|
| 1 | 六案迁址触发 N1/N2 与 dangling-ref 大面积回归 | 每案迁址独立落、落一件跑一次 persona+smoke-sidequest；可砍到四案（门槛 4→3） |
| 2 | L2 兑换点无 ±contrib effect | flag 过渡方案已给；引擎 `case 'contrib'` 并入寇豆码下一批 |
| 3 | 乙分支名头来源若忘落，乙玩家卡思过崖 | 写进 S3 验收清单：乙档走通思过崖 |
| 4 | 拦车戏 cond 改动影响 65 现有 smoke 期望值 | 落库时同步改 smoke 期望并注释记因 |
| 5 | 时辰门重开（94 勘误）若你维持原裁决 | 山门照旧 item-only，95 §四.2 的 time 条件也不落——一条裁决管两处 |

## 五·补、team-lead 四裁决（2026-10-13，全批）

1. 时辰门重开：批（94 §八勘误采纳，P5 山门照 §四.2 落）。
2. L2 contrib effect：批，已派寇豆码（view 瘦身后）；落库前 flag 过渡。
3. 乙分支名头补丁：批（「第一次有人替他说话，是他自己挣的」——机制即叙事）。
4. 散人断线：必修，**记入窗口批清单与 P4/P5 同窗落**（cond 改 act1_recognized + time 夜段 + smoke 期望同步），不单独开窗。

「莽撞自选」理由改设计立场：采纳（立场比借口硬）。95 号过审，S3 稿就位。

## 六、S3 落库顺序（草案，开工时细化）

1. 接缝修复（散人断线，一处 cond + smoke 期望）——最先，它是卷二的闸
2. 六案逐区落（迁址+flag+incvar+联动句，六批各独立收口）
3. 委托线浮名 action（var>=4）
4. 思过崖门槛 cond + 乙分支名头来源 + 拒文案
5. 声望键位写入挂接（六案收口 +rep 等，随案夹带）
6. 全量回归 + lore/三关/朱雀 + 乙档走通验收

---

## 七、第一批落库记录（2026-10-15，游有方）

**交付**：两案走通全链（接案→查访→收束，含门派咬合层与散人路径）+ 声望挂点第一批 + 卷二入口接引。验收脚本 `tools/_juan2_batch1.js`（30/0）。

| 项 | 落点 | 改动 |
|---|---|---|
| 案 A 洛阳·仓里那三个月 | `69_juan2_s3.json` 重声明 hk_npcv_174_tuntang/zhangxin + 新房 ly_granary（洛阳·官仓，luoyang_market se 进、nw 回）+ 40_npcs npcv_174 room→ly_granary、title→管仓的老吏 | 目标房 jn_granary→ly_granary；收口加骑缝章联动段（弧口朝左）+ flag clue_luoyang + incvar clue_count；+60 洛阳 rep |
| 案 B 衙门府·府衙那只箱子 | 同档重声明 hk_npcv_091_xiangzi/mianao + 40_npcs npcv_091 room→jn_yamen_office | 收口加封条印记联动段（门里库房封条同印）+ flag clue_yamen + incvar clue_count；+60 衙门 rep；mianao 目标随迁差房（desc 同步改写） |
| 门派咬合层（L2 flag 过渡） | npcv_174/npcv_091 各加双通道 action | 门派：亮腰牌 / 问门里的差事（cond hasSect，once，flag act2_ly_ledger / act2_ya_errand）；散人：塞银子 / 替他跑腿（cond noSect，同 flag）——路径不同、线索同源 |
| 声望挂点 | 收口效果级 `+rep` | ⚠️ 机制差异如实记：commands.js:5852 的 repGainOnQuest 挂 **NPC def**，同 NPC 多案会重复加成（蒋倦名下两案都走 tryReportQuest），故第一批落效果级 +rep（每案一次、逐案精确），键位表口径不变 |
| 散人自查 | `_juan2_batch1.js` §⑤ | 散人档两案全链收口（clue×2 + rep×2），clue_count=2，var>=4 拼图门槛可达 |

**我的 tools 判据改动**（已报备口径）：smoke-sidequest「hk_* 与各数据文件之和一致」从声明条数改为**跨文件按 id 去重**——S3 改造批在新分片整条重声明既有案是常态，重声明不虚增、新增才计数。

**守卫终态**：20 套全绿（data-load 61/0、dangling 25/0、map-edge 34/0、sidequest 57/0 等）；69/40_npcs 均 LF、stringify 口径符合。

**待办（第二批）**：长安/襄阳/成都/姑苏四案同款改造；拼图浮名 action（var>=4，方证/冲虚委托线）；思过崖门槛 cond + 乙分支名头来源；L2 contrib effect 等寇豆码。

## 八、第二批落库记录（2026-10-16，游有方）

**交付**：四案（长安/襄阳/成都/姑苏）照第一批范式走通全链 + 浮名收束件 + 乙分支名头补丁 + 思过崖门槛 + L2 contrib 逐案落。验收 `tools/_juan2_batch2.js`（51/0），第一批套件 30/0，全套 107 套守卫全绿。落库脚本 `tools/_apply_juan2_batch2.py`（幂等）。

| 项 | 落点 | 改动 |
|---|---|---|
| 长安·那半张盐引 | 69 重声明 hk_npcv_215_yanyin | 目标 tangmen_hall→changan_market；收口弧口朝左骑缝印联动段；clue_changan；+rep 长安 60；npcv_215 room→changan_market |
| 襄阳·江上那三条船 | 69 重声明 hk_npcv_208_feng | 目标 jn_harbor_wharf→xiangyang_market；船号铲痕/出仓单联动段；clue_xiangyang；+rep 襄阳 60；npcv_208 room→xiangyang_market、title→漕头 |
| 成都·秤砣上那点尘 | 69 重声明 hk_npcv_237_cheng | 目标 jn_yizhuang→chengdu_lane；烙印缺角联动段（首段 narrate 随迁址改写）；clue_chengdu；+rep 成都 60；npcv_237 room→chengdu_market；次级案刀伤随迁 chengdu_market |
| 姑苏·枫桥那个人贩子 | 69 重声明 hk_npcv_223_meimei | **零迁址**；对质收口加弯钩暗记联动段（不止走漕米，呼应东厂暗线不点破）；clue_gusu；+rep 姑苏 60；npcv_223 留燕子坞 |
| 双通道咬合 | 四 NPC 全量 actions | 门派：验官文/亮漕帖/出示腰牌/调门里卷宗（hasSect+once+flag act2_ca/xy/cd/gs_ledger+**contrib 本门 40**）；散人：市上打听/帮船户搬货/替他出诊/陪他守夜（noSect，同 flag 无 contrib）——路径不同、线索同源 |
| 第一批 contrib 补挂 | npcv_174 亮腰牌 / npcv_091 问门里的差事 | 各补 `{contrib:['本门',40]}`（寇豆码 effect 已可用，替换 95 §二 flag 过渡） |
| 乙分支名头补丁 | 蒋倦处「请他作证」 | cond `and[act1_kept_silent, questDone tuntang, notFlag act2_witness_done]`；narrate×2（「仓里亏空那三个月，也没人信我」）+ flag + `+rep ['*',40]`——「第一次有人替他说话，是他自己挣的」 |
| 浮名 action | shaolin_fangzheng / wudang_chongxu | cmd 问那路人的名头；cond `and[{var:clue_count>=4},{notFlag:act2_mole_named}]`；narrate×2（四样物证摆开→同一路人拿走的→名字写掌心）+ flag |
| 思过崖门槛 | 69 huashan_qingke exits.w（gated exit：cond+say+msg+travel 四件套） | **or 形**：`{or:[{notFlag:act1_recognized},{and:[{skill:basic_sword>=30},{rep:*>=80}]}]}` |

**裁决记档**：
1. **思过崖 cond 改 or 形（95 §三草案修正）**：原 and 直落 `{and:[act1_recognized, skill, rep]}` 会锁死 act1 认痕——认痕发生在崖上，而崖的唯一入口就是青柯坪 w；认痕之前玩家没有 act1_recognized，会被自己的终点拦在门外。or 形语义：认痕前自由上崖（act1 流程不变），认痕后须名头（卷二起的门槛）。skill 键用 **basic_sword**（skill id），非「基本剑法」名——95 草案按名写，落库按 id 修正。
2. **浮名门槛维持 var>=4（95 口径不上调）**：可攒线索共 6（第一批 2 + 第二批 4），4=「过半」门槛既有紧迫感又留容错（漏一案仍可收束）；上调 6 会把容错归零。工期兜底条款（砍四案 4→3）继续有效。
3. **次级案重声明最小化**：四条次级案中仅 daoshang（刀伤）因迁址重声明；mengming/shaochuan/laoxiapo 目标未动，**不重声明**（69 不落无改动拷贝，避免日后 61 池改动被旧分片覆盖）。与第一批「全部重声明」的做法不同，特此记档。
4. **收口暗句统一**：四案 rewards 追加同一句「这几桩案子搁在一起看，少的东西是同一路人拿走的。」——与第一批两案同句成回响，玩家跑满四案自然被推向方证/冲虚问名头。

**测试教训（本批一病）**：验收桩里 `p.setFlag('act1_recognized')` 不带值——引擎 `setFlag(f,v)` 在 `v===undefined` 时是**删 flag**（modapi setFlag 陷阱同一族），门槛放行断言假绿。修正为 `setFlag(f, true)` 后 51/0。**报错不响的桩，比红的桩更危险**。

**守卫终态**：107 套全绿（含 smoke-portrait-batch 376/0——40_npcs stringify 口径 indent=1 无尾换行，本批 patch 初版误写 indent=2，已修口径重写盘）。69 片 indent=2 尾换行 LF；40_npcs indent=1 无尾换行 LF。

**待办移交**：追踪旁白双份 / 裸「细看」别名（寇豆码，挂账）；NPC 级 repGainOnQuest quest 级判据（寇豆码，挂账）。
