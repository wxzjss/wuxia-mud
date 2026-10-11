# 第三幕《伪秘籍》+ 第一幕夜戏（E6）· 工程落地报告

> 交付人：eng-act3　任务号：主线三幕落地（E6 / E9 / E10 / E13 / E14 / E15）
> 落地文件：**`game/data/65_mainline_act3.json`**（唯一新增/修改的产品数据文件）
> 自验脚本：`tools/_tmp-act3-verify.js`（临时，可复现）　自验结果：**通过 151 / 失败 0**；`tools/map-check.js`：**PASSED 6492 / 0**
> 依据：`design/21-mainline-act3-5.md`（§2.9.2 / §3.1–§3.8 / §8 / §8.6 / §3.9）、`design/24-mainline-script.md`（逐字文案）

---

## 0. 一句话结论

E6 夜戏、E10 两个 Boss、E9 四件物品、E13 任务、E14 挂任务、E15 的 13 个 action **全部落地并跑绿**；
**未动任何出口、未改 `game/src/**`、未动 `40_npcs.json`/`50_map.json`/`60_quests.json`**（E6 的「从 q_main_jianghu 搬走三条奖励」经核对**数据里已不存在**，无需再动）。
仅有一类「引擎能力缺口」清单见 §3（战斗胜负分支），已按等价写法降级并如实登记。

---

## 1. 逐项对照表（设计条目 → 落地成什么）

### E6 · 第一幕夜戏（§2.9.2）

| 设计条目 | 落地 | 说明 |
|---|---|---|
| `road_huashan_1` 新增 1 个 action「夜宿山道」，关键词 夜宿/山道/扎营 | ✅ `rooms.road_huashan_1.actions[0]`，`cmd=夜宿山道`，`keywords=[夜宿,山道,扎营]` | **未动任何出口**（w/n/e 一概不碰） |
| `cond:{and:[{hasSect:true},{notFlag:'jiuye_done'}]}` | ✅ 原样 | 需拜过师；`failMsg` 另写（设计未给，见 §3-6） |
| 8 步 effects（含 menu 抉择 / combat / +item / flags / quest） | ✅ | 见下 |
| ① 天色山道 ② 「三更，山下来了人…」 ③ 官差「让开。这是公文。」 | ✅ narrate×4 + say×1（用 `design/24` 场 1-5 逐字） | 文案逐字 |
| ④ `menu`：动手>jiuye_fought · 退开>jiuye_stood_aside | ✅ `menu`（标题「（拦，还是不拦）」），两选项 label 用逐字「（拦在车前）」「（退到道旁）」 | **`menu:标题\|A>效;;B>效` 正确写法**；已断言首选项未被吞 |
| ⑤ 动手 → `combat` vs `mob_soldier` | ✅ 选项一内 `combat:mob_soldier` | mob_soldier lv? hp280，现成 mob |
| ⑥⑦⑧ 铜牌 + flag + 接二幕 | ✅ 两分支结尾都含 `flag:know_east_depot` `+item:depot_token_half` `flag:jiuye_done` `quest:q_main_sect:0` | **两路都拿铜牌**（设计如此） |

> ⚠️ 实现取舍：引擎的 `menu` 只是「把选项推给前端」，**同一 effects 数组里 menu 之后的顶层 effect 会在点击动作时立刻执行**（不等玩家选）。为让「先抉择、再落点」的顺序正确，我把**共用结尾复制进两个选项内部**（不放在 menu 之后）。代价正确、无副作用差异。

### E10 · 两个 Boss 的 `bossPhases`（§3.4）

| 设计条目 | 落地 | 说明 |
|---|---|---|
| `blood_saber` 三阶段 刀血/化血/血遁 | ✅ `npcs.blood_saber.bossPhases`（逐字抄 §3.4 的 JSON） | `at` 1→0.6→0.3 严格递减；`lifesteal`/`summon` 语义与引擎一致 |
| `xingxiu_laoxian` 三阶段 毒雾/化功/诡计 | ✅ `npcs.xingxiu_laoxian.bossPhases` | 同上；`summon.npc=mob_mo_disciple`（现成） |
| 只写 `bossPhases` 字段、不冲掉别字段 | ✅ | 对象按键合并，已断言 `hp/name` 仍在 |

### E9 · 第三幕物品（§8.3）

| 设计 | 落地 | 说明 |
|---|---|---|
| `xuedao_copy_half` 血刀门·半卷抄本 | ✅ `items.xuedao_copy_half`（type book，mainline/clue，noSell） | 3-4 落 |
| `fake_manual` 速成秘籍（伪） | ✅ `items.fake_manual` | 3-7 战利品/证物（并入选项战斗后发） |
| `yu_ledger_item` 盐场假账册 | ✅ `items.yu_ledger_item` | 3-7 取证场发 |
| `star_cure_item` 星宿海解药 | ✅ `items.star_cure_item`（consumable，+hp60 + 台词） | 由「问解药·拉回」分支发 |
| 复用 `depot_token_half`（消耗） | ✅ 未新增 | E6 发、3-3 可 `-item` 交出 |

### E13 · 任务 `q_main_snow`（§3.7 / §8.1）

| 设计条目 | 落地 | 说明 |
|---|---|---|
| id 名 类型 等级 giver | ✅ `q_main_snow`｜【主线】伪秘籍｜主线｜40｜`shaolin_fangzheng` | |
| 入场条件 `act2_done` | ✅ `require:{flag:'act2_done'}` | 走引擎的 `qd.require`（可接任务过滤器） |
| 7 段，cond 依次 | ✅ 7 段，cond 依次 `snow_lead` / `pass_shankou` / `or(blood_deal,blood_saber_hostile)` / `xuedao_copy` / `blood_saber_down` / `or(zhenyi_bait,poisoned_xingxiu,refuse_fake)` / `know_zhenyi`(next 99) | |
| rewards | ✅ `+exp12000` `+pot6000` `+title闻腥者` `flag act3_done` `flag know_zhenyi` `quest ['q_main_moye',0]` + narrate（第四幕引子） | `q_main_moye` 由 `66_mainline_act45.json` 提供（已核对），故 `quest` 行能正常出字 |

> 与 `66_mainline_act45.json`（四/五幕）的**无冲突**已核对：两者 npcs / quests / rooms / items **互不重叠**（且 65 先于 66 加载）。

### E14 · 方证挂任务（§8.1 / §7.1-1）

| 设计 | 落地 | 说明 |
|---|---|---|
| `shaolin_fangzheng.quests += q_main_snow` | ✅ **全量**：`["q_shaolin_entry","q_yijinjing","q_main_sect","q_main_snow"]` | 数组是 replace 语义 → 必须写全量，原有 3 项一个不少（已断言） |

### E15 · 13 个房间 action（§8.5）

| 房间 | action（cmd） | cond 门控 | 落点（新 flag / item） |
|---|---|---|---|
| `shaolin_daxiong` | 问缺卷 | `know_xuemao & !snow_lead` | `snow_lead` |
| `shaolin_cangjing` | 看经架 | `snow_lead` | `zhengju_shaolin` |
| `road_beijiang_1` | 看车辙 | `snow_lead` | `road_found` |
| `beijiang_shankou` | 摸哨 | `road_found & !pass_shankou` | 有 `yue_zhi_road`：`pass_shankou`+`shankou_quiet`（免战）；否则 `combat mob_assassin`+`pass_shankou` |
| `beijiang_xuedao` | 见刀主 | `pass_shankou & !blood_deal & !blood_saber_hostile` | 菜单三选（交铜牌 / 以抄本换 / 不交）→ `blood_deal`·`depot_token_given`·`xuedao_knows_token` / `blood_deal`·`blood_deal_trade` / `blood_saber_hostile`·`combat blood_saber`·`blood_saber_down` |
| `beijiang_houzhai` | 摸后寨 | `pass_shankou & !xuedao_copy`（**C-3：不加 `blood_deal` 前置**） | `+item xuedao_copy_half` + `xuedao_copy` |
| `xiyu_shule` | 问商队 | `pass_shankou` | `shule_to_xingxiu` |
| `xiyu_xingxiu` | 见老仙 | `shule_to_xingxiu & !三选一已走` | 菜单三选 → `poisoned_xingxiu` / `refuse_fake` / `zhenyi_bait` + Boss 战 + `xingxiu_down` + `+item fake_manual` |
| `xixia_yanchang` | 问煮盐人 | `or(xingxiu_down,zhenyi_bait) & !zhengju_yanchang`（**C-5 用 `or`**） | `+item yu_ledger_item` + `zhengju_yanchang` |
| `road_xixia_1` | 截信 | `xingxiu_down & !know_zhenyi` | `questdone q_main_snow`（走 rewards → `know_zhenyi`·`act3_done`·接四幕） |
| `jn_market_main` | 问北线 | `snow_lead & !yue_zhi_road & !npv180_warm & !npv180_broken` | 拉回→`yue_zhi_road`+`npv180_warm`(+favor)；堕落→`npv180_broken`+`+money300` |
| `jn_brothel_room` | 问抄纸 | `snow_lead & !chen_chaoben & !252_warm & !252_broken` | 拉回→`chen_chaoben`+`252_warm`；堕落→`252_broken`+`+karma -10` |
| `jn_fruit_stall` | 问解药 | `snow_lead & !ruan_cure & !npv090_warm & !npv090_broken` | 拉回→`ruan_cure`+`npv090_warm`+`+item star_cure_item`；堕落→`npv090_broken`+`+karma -10` |

> 13 个 action **全部带齐** `cmd` + `label` + `keywords` + `cond` + `failMsg` + `effects`（已逐条断言）。

### 血泪硬约束的遵守（三条）

1. **数组 replace 语义**：目标房间里**已有 action 的 4 个**（`shaolin_daxiong`「问方证」、`shaolin_cangjing`「翻经」、`road_beijiang_1`「追囚车」、`jn_fruit_stall`「list 柳甜儿」）**原样抄进新文件再追加**新 action；`road_huashan_1` 无既有 action。`shaolin_fangzheng.quests` 写**全量**。`blood_saber`/`xingxiu_laoxian` 只写 `bossPhases`。→ 自验断言「actions 数量 = 原有+新增」「fangzheng 原有项一个不少」全绿。
2. **不报错≠生效**：所有引用的 room / npc / item / skill id 均核对存在（脚本断言）；所有 effect `type` / cond 键均核对为 `modapi.js` 已支持；`menu` 用 `menu:标题\|A>效;;B>效` 正确写法（已断言**首选项未被吞**）。
3. **数据格式**：2 空格缩进 + 文件尾换行；写完**读回** JSON.parse + 尾换行 + 第 2 行缩进校验通过（`sha1 f77388efd1ce70bc2b7a20798cddcfcc853bc9c9`，42197 bytes，结尾 `}\n`）。

---

## 2. 自验结果（真跑）

```
node tools/_tmp-act3-verify.js      → 通过 151 / 失败 0
node tools/map-check.js             → PASSED 6492 通过 / 0 失败（未动出口，保持全绿）
```

自验覆盖：任务加载/giver/stages=7/require/rewards；方证 quests 全量；14 个房间 actions 数量=原有+新增 且新 cmd 都在；六件套齐备；两个 `bossPhases` 存在且 `at` 严格递减、skill/summon 存在、其它字段未被冲；4 件物品存在；每个 cond 与每组 effects 用假 ctx 跑 `evalCond`/`evalEffects` 不抛错；`menu` 首选项未丢；
**场景模拟**（真点 menu 选项）：E6 两路、摸哨免战/开战、见刀主 2/3 选项、见老仙 2/3 选项、问解药、截信 questdone→rewards 结算。

---

## 3. 未做项与偏差（如实登记）

### 3-1 战斗胜负分支：引擎不支持（本次唯一硬缺口）

`modapi.js` 的 `combat` 只是 `startCombat`，**同一 action 的 effects 在「战斗开始」即全部执行**；引擎也没有「战斗结算后回到本 action 继续跑分支」的声明式机制（`combatHooks.onEnd` 是 JS 注入，数据文件够不到）。因此设计里**依赖「打赢/打输」分叉**的落点无法精确落地：

- **3-2 摸哨**：设计「打输 → 被押进前庭（`blood_saber_hostile` + `-item depot_token_half`）」**未做**。已实现的是「打赢 → `pass_shankou`」。**需要**：战斗结算钩子（或 `combat` 支持 `onWin`/`onLose` effects）。
- **3-5 刀血**：设计「赢 → `blood_saber_down`（A/B 路线追加 `blood_saber_ally` + `+item xuedao_copy_half`）」；且 3-5 的触发（`xuedao_copy` 后他反悔）**在 §8.5 的 13 个 action 清单里没有对应 action**。已实现的只有「硬来」路（见刀主·不交）在开战后置 `blood_saber_down`。**A/B 路线打 Boss** 目前无接口 → 该路线 stage4 的 `blood_saber_down` 无法满足（但**不影响**幕末 `截信` 完成，因 `questdone` 无条件置 99）。**需要**：补一个 3-5 的独立 action（或结算钩子）。
- **3-7 诡计（丁春秋）**：设计「打赢 → `xingxiu_down` + `+item fake_manual`」。§8.5 同样**没有 3-7 的独立 Boss action**。已实现的退化写法：把 3-7 的 Boss 战**并进 `见老仙` 三个选项**（`练`/`不练` 用 `design/24` 3-7「登场」逐字旁白串接，`揭破` 本就提前开战），战后置 `xingxiu_down` + `+item fake_manual`。**这是「接战即置」的降级**（未判胜负）——否则 `截信` 的 `xingxiu_down` 门控永远打不开，整幕不能收尾。**需要**：战斗结算钩子才能改为真·打赢才置位。

> 上述都属「引擎不支持，未硬写」，改用等价且可跑的已支持写法，并按任务要求在此列清。

### 3-2 未落地的设计条目

- **3-0-D「问盐册」（俞初 / `road_xixia_1`）未做**：`design/24` 与 `design/21 §3.3` 都写了这一场（给软路径 `yu_ledger`），但 **§3.7 ④ 只列 13 个 action、且不含它**，本任务 E15 亦只要求 13 个。按指令做 13 个，**此场留空**。后果：`yu_ledger` 软路径暂无获取口（`yu_ledger_item` 仍由 `问煮盐人` 正常发放，取证不受阻）。
- **3-6「不练·变体」的 `+buff`（战前加 buff）未做**：项目无对应 buff id，且 §3.6 注明数值待 `05-balance-spec`。`star_cure_item` 只落成消耗品（`+hp60` + 台词），**未**做成战前 buff 减负。
- **3-5「→ `hm_blood_saber`（血刀老祖的家）」转场未接线**：无对应 action，未做。
- **4-2 / 5-4 读 `jiuye_stood_aside` / `jiuye_fought` 的台词**：属第四/五幕，不在本批。

### 3-3 文案来源说明（哪逐字、哪自写）

- **逐字用 `design/24`**：第一幕夜戏全段、3-0-A/B/C、3-1、3-2、3-3、3-4、3-6、3-7 的旁白与台词（含 `menu` 选项 label）。
- **设计未给、按项目语感自写**（武侠口语、无现代词、不用「您」）：各 action 的 `failMsg`、`label`、`keywords`；4 件物品的 `desc`、`q_main_snow` 的 `name/desc/stages[].desc`；`menu` 的标题；两处 `3-7 登场` 串接到 `练`/`不练` 选项的旁白（该句本身取自 `design/24` 3-7 原文）。
- 一处**保留原字符**：3-4 旁白里 `design/24` 用的是 ASCII 直引号 `"抄书人"`，JSON 内转义为 `\"抄书人\"` 保留逐字（未改成「」）。

### 3-4 边界遵守

- **未 commit**（留工作区）。
- **未改 `game/src/**`**。
- 唯一新增/修改的产品文件：`game/data/65_mainline_act3.json`；另新建本报告 `design/37-act3-report.md` 与临时脚本 `tools/_tmp-act3-verify.js`。
- 经核对，`q_main_jianghu.rewards` 里**已不含** `know_east_depot`/`depot_token_half`/`quest q_main_sect 0` 三条（E5 已被其它改动完成），故本次**未动 `60_quests.json`** 即满足 E6 的口径。

---

## 4. 建议的后续（给下一批 / 引擎侧）

1. **引擎**：给 `combat` 加 `onWin`/`onLose` 等效 effects（或让 `combat` 支持「打赢后回到 action 继续跑」），才能把 3-2 打输、3-5 赢输分支、3-7 真·打赢结算精确落地。
2. **数据**：补 3-5（刀血）与 3-7（诡计）的独立 Boss action，或按引擎新能力改回菜单外的分支写位。
3. **数据**：按需补 3-0-D「问盐册」。
4. 三幕端到端 smoke：按 `design/21 §9` 回归建议，为 14 个 action 各加一条「cond 满足 → effects 跑完 → flag 置位」断言（可参照本报告的自验脚本）。
